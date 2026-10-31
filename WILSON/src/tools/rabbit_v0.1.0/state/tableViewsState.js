// ============================================================
// RABBIT — custom table views in the provider (VW1c, 2026-10-17)
// ============================================================
//
// docs/design/CUSTOM_VIEWS_DESIGN.md §4.4, §4.5 and §5.5 (as corrected at
// VW1c's step 0). The provider (RabbitProvider.jsx) calls useTableViewsState
// once and puts what it returns on the context; the rules are
// state/tableViewsModel.js's, the backends' answers adapters/index.js's.
//
//   * ctx.tableViews / ctx.itemGroupings: the bundle's rows (every adapter's
//     loadProject returns them; the live merge keeps them current).
//   * ctx.tableViewsAvailable: whether this backend keeps views (false on a
//     cloud without 0098 and on Google Drive: the screens say "not on this
//     server yet"); ctx.tableViewsError: a load's read error in words, else
//     null (the dropdown's error state — never a failed project load).
//   * The mutators — addTableView, updateTableView (the settings save, always
//     conditional on a revision), renameTableView, deleteTableView,
//     reorderTableViews, addItemGrouping, removeItemGrouping — each answers
//     what the backend said and offers its undo in the shell's undo toast, and
//     NONE enters the keyboard history (design §4.4: view changes never enter
//     the Timeline's Ctrl+Z). A settings save's undo writes the old config
//     only while the view still has the revision the save left; a rename's
//     only while it still has the name it set; a reorder's always; a new
//     view's undo deletes it only while it still has the revision it was made
//     with; a delete's undo makes the view again with its id. A refused undo
//     says why (the provider's notice) and closes; a failed request, or a
//     passing fault (the connection, a timeout, a deadlock, an expired
//     token), keeps the toast up to try again.
//   * The last used view (Q4): read once per sign-in (the desktop: per start),
//     its own request; until it answers, or for a visit where it failed or
//     took longer than 2 s, `status` is not 'ready' and nothing is written.
//   * The changes for now (Q3b): per table of the open project — the view it
//     started from, that view's revision, the config — in memory, outside the
//     bundle and the undo history: kept across tabs, dropped on a project
//     switch or a reload.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import {
  isTableKey, normalizeViewName, viewNameProblem, viewConfigProblem, writeViewConfig, allViewOf,
  viewsOfTable, nextViewPosition, planReorderViews, normalizeEntityIds, groupingKeyOf, groupingProblem,
  groupingsOfTable, findGroupingBySet, planForgetItem, compareViewRows, compareGroupingRows,
  tableViewLastKey, readTableViewLast, mergeTableViewLast,
} from './tableViewsModel'

export const TABLE_VIEWS_UNAVAILABLE_WORDS = 'Saved views are not on this server yet.'
// VW1d code review round 2 (R2-2): a view whose settings from another WILSON
// leave no room for a change.
const OTHER_SETTINGS_FILL_WORDS = 'settings from another WILSON fill this view; save your change as a new view'
export const TABLE_VIEW_LAST_WAIT_MS = 2000

function tableViewsUnavailableError() {
  const err = new Error(TABLE_VIEWS_UNAVAILABLE_WORDS)
  err.code = 'table_views_unavailable'
  return err
}

function wordsError(message, code) {
  const err = new Error(message)
  err.code = code
  return err
}

const ORDER = { tableViews: compareViewRows, itemGroupings: compareGroupingRows }

// The cloud's words when its policies drop a grouping's write without any
// (supabaseAdapter's TABLE_VIEWS_REFUSALS.groupingGate).
export const GROUPINGS_GATE_WORDS = 'You can no longer change groupings on this project.'

/**
 * A refusal that may pass on a second try, so an undo keeps its toast up
 * (review round 2, R2-3): the connection (SQLSTATE class 08), a transaction
 * rolled back (40: a serialization failure, a deadlock), the server's
 * resources (53), a cancel (57: a statement timeout, a shutdown),
 * PostgREST's own connection and pool errors (PGRST000 to PGRST003), and a
 * token it could not read or that has expired (PGRST301, PGRST303), which
 * the client renews.
 */
export function isTransientCode(code) {
  if (typeof code !== 'string') return false
  return /^(08|40|53|57)[0-9A-Z]{3}$/.test(code) || /^PGRST00[0-3]$/.test(code)
    || code === 'PGRST301' || code === 'PGRST303'
}

// A grouping's own id that the backend still holds: the desktop's route says
// so by name, the cloud (and the fixtures, its twin) by the primary key's
// 23505.
function groupingIdTaken(err) {
  return err?.code === 'item_grouping_id_taken'
    || (err?.code === '23505' && /item_groupings_pkey/.test(String(err?.message || '')))
}

// A set refused because an item it names is not in the project: the cloud's
// 23503 (0098's check), the desktop's route by name.
const ITEM_NOT_BACK_CODES = new Set(['23503', 'item_grouping_entity_not_found'])

// ── The sweep, for the provider's deletes (design §5.2) ─────────────────
// A delete for good (a scene, shot, level or experience on every backend; an
// asset where the backend removes the row: the desktop) takes the item out of
// every grouping that names it. The backend does it (0098's sweep; the Local
// Server's and the fixtures' twins); the provider mirrors it on screen and
// its undo puts the groupings back as they were, after the row.

/** The groupings of `kind` that name any of `ids`, copied as they are now. */
export function groupingsNaming(groupings, kind, ids) {
  const set = new Set((ids || []).map(String))
  return (Array.isArray(groupings) ? groupings : [])
    .filter(g => g && g.kind === kind && (g.entity_ids || []).some(x => set.has(String(x))))
    .map(g => ({ ...g, entity_ids: [...(g.entity_ids || [])] }))
}

/**
 * The groupings after each of `ids` (of `kind`) is deleted for good
 * (planForgetItem, in turn), the ids taken in code-unit order: when two
 * groupings shrink to one set in one delete (a scene with its shots, a bulk
 * delete), the one that survives is the desktop's and the fixtures' (review
 * round 1, R1-2; the provider's bulk delete sends its requests in the same
 * order: review round 2, R2-1). The cloud's cascade walks a scene's shots in
 * its own order: the live channel brings its answer, and the undo asks the
 * backend, not the screen (restoreGroupingRows).
 */
export function sweepGroupings(groupings, kind, ids) {
  let rows = Array.isArray(groupings) ? groupings : []
  const ordered = [...new Set((ids || []).map(String))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  for (const id of ordered) {
    const { remove, update } = planForgetItem(rows, kind, id)
    if (remove.length === 0 && update.length === 0) continue
    const gone = new Set(remove.map(String))
    const next = new Map(update.map(u => [String(u.id), u.entity_ids]))
    rows = rows.filter(g => !gone.has(String(g.id)))
      .map(g => (next.has(String(g.id)) ? { ...g, entity_ids: next.get(String(g.id)) } : g))
  }
  return rows
}

/**
 * Undo of a delete for good: each grouping put back as it was, run after the
 * row itself is back. Answers, for each original, the stored row that now
 * holds its set.
 *
 *   * One the delete removed is made again with its id.
 *   * One it shrank is made again FIRST, under a new id (a grouping has no
 *     update, and its own id is still taken), and the shrunk row removed
 *     only once that has landed: when the backend refuses the set (an item
 *     it names did not come back — the row's own restore failed), nothing
 *     has changed and the shrunk grouping stays (review round 1, R1-1:
 *     removing first lost the grouping for good).
 *   * Which of the two is the BACKEND's answer, not the screen's (review
 *     round 2, R2-1): two groupings that shrink to one set leave the one
 *     whose item went first, and the cloud walks a scene's shots in its own
 *     order, so the screen's mirror (sweepGroupings) can show the other. A
 *     grouping the screen shows as gone is tried under its own id; an id
 *     the backend still holds (the desktop's item_grouping_id_taken, the
 *     cloud's and the fixtures' primary-key 23505) is a shrunk row the
 *     screen did not show, and its set is made again under a new id like
 *     any other. Whenever the set lands under another id than the
 *     original's, the original's id is removed (none there: nothing done).
 *   * A set stored already (a teammate made it meanwhile, or the grouping is
 *     as it was) is not made twice: the backend answers the stored row.
 *   * A removal the cloud's policies filter out keeps the row, and throws in
 *     words (review round 2, R2-6).
 * Throws the backend's refusal.
 */
export async function restoreGroupingRows({ adapter, projectId, originals, bundleRef, setBundle }) {
  const put = (removeIds, stored) => {
    const gone = new Set(removeIds.map(String))
    const apply = (b) => {
      const list = (b.itemGroupings || []).filter(x => !gone.has(String(x.id)) && String(x.id) !== String(stored?.id))
      return { ...b, itemGroupings: stored ? [...list, stored].sort(compareGroupingRows) : list }
    }
    setBundle(apply)
    bundleRef.current = apply(bundleRef.current)
  }
  const answered = []
  for (const g of originals || []) {
    const shown = (bundleRef.current.itemGroupings || []).find(x => String(x.id) === String(g.id))
    if (shown && groupingKeyOf(shown.entity_ids) === groupingKeyOf(g.entity_ids)) { answered.push(shown); continue }
    const add = (id) => adapter.addItemGrouping({ id, project_id: projectId, table_key: g.table_key, kind: g.kind, entity_ids: g.entity_ids })
    let stored
    if (shown) {
      stored = await add(uuidv4())
    } else {
      try {
        stored = await add(g.id)
      } catch (err) {
        if (!groupingIdTaken(err)) throw err
        stored = await add(uuidv4())
      }
    }
    put([], stored)
    if (stored?.id != null && String(stored.id) !== String(g.id)) {
      const res = await adapter.removeItemGrouping(g.id, projectId)
      if (res?.status === 'filtered') throw wordsError(GROUPINGS_GATE_WORDS, '42501')
      put([g.id], null)
    }
    answered.push(stored)
  }
  return answered
}

/**
 * The provider's undo of a delete for good (RabbitProvider's
 * restoreGroupingsAfterDelete): restoreGroupingRows one grouping at a time,
 * so one that cannot be made again does not stop the rest (the history
 * runner swallows an op's throw: review round 1, R1-1). Each entry of
 * `originals` — the array the history entry captured — is re-keyed IN PLACE
 * to the id its set went back under, so the entry's next undo, after a redo
 * shrank that row again, finds it (review round 2, R2-2: it looked for the
 * first capture's id, and the shrunk row stayed beside the restored set).
 * Answers the refusals, in order.
 */
export async function restoreGroupingsInTurn({ adapter, projectId, originals, bundleRef, setBundle }) {
  const refusals = []
  if (!Array.isArray(originals)) return refusals
  for (let i = 0; i < originals.length; i += 1) {
    const g = originals[i]
    try {
      const [row] = await restoreGroupingRows({ adapter, projectId, originals: [g], bundleRef, setBundle })
      if (row?.id != null && String(row.id) !== String(g.id)) originals[i] = { ...g, id: row.id }
    } catch (err) {
      refusals.push(err)
    }
  }
  return refusals
}

/**
 * The notice after restoreGroupingsInTurn, or null when every grouping went
 * back: an item not back in the project in the provider's words, any other
 * refusal in its own (review round 2, R2-5: every refusal was blamed on a
 * missing item).
 */
export function groupingRestoreNotice(refusals) {
  const list = (Array.isArray(refusals) ? refusals : []).filter(Boolean)
  if (list.length === 0) return null
  const other = list.find(err => !ITEM_NOT_BACK_CODES.has(err?.code))
  if (!other) {
    return list.length === 1
      ? 'A grouping was not put back as it was: an item it names is not back in the project.'
      : `${list.length} groupings were not put back as they were: an item they name is not back in the project.`
  }
  const words = String(other?.message || other).trim()
  return list.length === 1
    ? `A grouping was not put back as it was. ${words}`
    : `${list.length} groupings were not put back as they were. ${words}`
}

// ── The hook ────────────────────────────────────────────────────────────

/**
 * @param {object} deps
 * @param {{ current: object }} deps.adapterRef
 * @param {{ current: object }} deps.bundleRef
 * @param {Function} deps.setBundle
 * @param {object} deps.bundle          this render's bundle (for the memos)
 * @param {string|null} deps.activeProjectId
 * @param {string} deps.adapterMode
 * @param {string|null} deps.authUserId the person signed in (the map is theirs)
 * @param {{ current: number }} deps.projectVisitRef  a project switch's generation
 * @param {Function} deps.showUndoToast (message, onUndo, opts)
 * @param {Function} deps.setError      the provider's notice for a refused undo
 */
export function useTableViewsState({
  adapterRef, bundleRef, setBundle, bundle, activeProjectId, adapterMode, authUserId,
  projectVisitRef, showUndoToast, setError,
}) {
  const projectIdRef = useRef(activeProjectId)
  projectIdRef.current = activeProjectId

  // Whether this backend keeps views: the adapter learns it at each load, so
  // it is read again per bundle (taskItemsAvailable's shape).
  const available = useMemo(
    () => typeof adapterRef.current?.tableViewsAvailable === 'function' && adapterRef.current.tableViewsAvailable() === true,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bundle, adapterMode],
  )
  const loadError = useMemo(
    () => (typeof adapterRef.current?.tableViewsLoadError === 'function' ? adapterRef.current.tableViewsLoadError() : null) || null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bundle, adapterMode],
  )
  const availableRef = useRef(available)
  availableRef.current = available

  const requireAvailable = useCallback(() => {
    if (!availableRef.current) throw tableViewsUnavailableError()
    if (!projectIdRef.current) throw wordsError('Open a project first.', 'no_project')
  }, [])

  // The bundle's rows, written where this visit's project still is.
  const applyRows = useCallback((key, rows, visit) => {
    if (visit !== projectVisitRef.current) return
    const incoming = (rows || []).filter(Boolean)
    if (incoming.length === 0) return
    const apply = (b) => {
      const ids = new Set(incoming.map(r => String(r.id)))
      const list = (b[key] || []).filter(r => !ids.has(String(r.id)))
      return { ...b, [key]: [...list, ...incoming].sort(ORDER[key]) }
    }
    setBundle(apply)
    bundleRef.current = apply(bundleRef.current)
  }, [bundleRef, setBundle, projectVisitRef])

  const dropRows = useCallback((key, ids, visit) => {
    if (visit !== projectVisitRef.current) return
    const gone = new Set((ids || []).map(String))
    const apply = (b) => ({ ...b, [key]: (b[key] || []).filter(r => !gone.has(String(r.id))) })
    setBundle(apply)
    bundleRef.current = apply(bundleRef.current)
  }, [bundleRef, setBundle, projectVisitRef])

  const findView = useCallback((id) => (bundleRef.current.tableViews || []).find(v => String(v.id) === String(id)) || null, [bundleRef])
  const findGrouping = useCallback((id) => (bundleRef.current.itemGroupings || []).find(g => String(g.id) === String(id)) || null, [bundleRef])

  // The undo toast's Undo: `run` answers true when the undo landed, or the
  // words to say when it was refused (nothing to retry). A refusal the
  // backend gave in words — an error carrying a code: a SQLSTATE, a route's
  // refusal — is said and the toast closes (design §4.4: "A refused undo
  // shows a kit notice"; review round 1, R1-4: thrown, it kept the toast up
  // for ever, Undo failing the same way each press); a failure with no code
  // (the request never answered), or a passing fault's (isTransientCode:
  // review round 2, R2-3), keeps the toast up to try again. Never
  // on another project than the visit's: a step that finished after a
  // project switch offers nothing (runWithUndoToast's rule), and an Undo
  // pressed after one does nothing.
  const offerUndo = useCallback((words, visit, run) => {
    if (typeof showUndoToast !== 'function' || !words) return
    if (visit !== projectVisitRef.current) return
    showUndoToast(words, async () => {
      if (visit !== projectVisitRef.current) return
      let outcome
      try {
        outcome = await run()
      } catch (err) {
        if (typeof err?.code === 'string' && err.code !== '' && !isTransientCode(err.code)) {
          setError?.(err.message || String(err))
          return
        }
        throw err
      }
      if (typeof outcome === 'string') setError?.(outcome)
    })
  }, [showUndoToast, setError, projectVisitRef])

  const refusedUndoWords = (res, name) => {
    if (res?.status === 'deleted') return `${name} was deleted meanwhile, so nothing was undone.`
    if (res?.status === 'filtered') return 'You can no longer change views on this project.'
    return `${name} was changed meanwhile, so it was kept as it is.`
  }

  // ── Views ──

  /**
   * A new view, saved for everyone at once (Q-G1): starting as *All* (a
   * config of `{ version }`) or holding the settings it was made from (Save
   * as new view); placed after the table's last (Q5c). Answers the stored row.
   */
  const addTableView = useCallback(async ({ tableKey, name, config } = {}, opts = {}) => {
    requireAvailable()
    if (!isTableKey(tableKey)) throw wordsError(`${tableKey} is not a table with views.`, 'table_view_invalid')
    const clean = normalizeViewName(name)
    const problem = viewNameProblem(clean)
    if (problem) throw wordsError(problem, 'table_view_invalid')
    const next = writeViewConfig(null, config || {})
    const configProblem = viewConfigProblem(next)
    if (configProblem) throw wordsError(configProblem, 'table_view_invalid')
    const projectId = projectIdRef.current
    const visit = projectVisitRef.current
    const stored = await adapterRef.current.addTableView({
      id: opts.id || uuidv4(),
      project_id: projectId,
      table_key: tableKey,
      name: clean,
      position: Number.isFinite(opts.position) ? opts.position : nextViewPosition(bundleRef.current.tableViews, tableKey),
      config: next,
    })
    applyRows('tableViews', [stored], visit)
    offerUndo(opts.words ?? `${clean} saved for everyone`, visit, async () => {
      const res = await adapterRef.current.deleteTableView(stored.id, { projectId, expectRevision: stored.revision })
      if (res?.status === 'removed') { dropRows('tableViews', [stored.id], visit); return true }
      if (res?.status === 'changed' && res.row) applyRows('tableViews', [res.row], visit)
      if (res?.status === 'deleted') { dropRows('tableViews', [stored.id], visit); return true }
      return refusedUndoWords(res, clean)
    })
    return stored
  }, [requireAvailable, adapterRef, bundleRef, projectVisitRef, applyRows, dropRows, offerUndo])

  /**
   * Save a view's settings (the bar's Save): written only while the view still
   * holds `expectRevision` (the revision the change for now started from;
   * the view's own when none is given). Answers the backend's TableViewWrite;
   * on `changed` the stored row comes into the bundle (the bar then says a
   * teammate changed it), on `deleted` the row leaves.
   */
  const updateTableView = useCallback(async (id, config, { expectRevision, words } = {}) => {
    requireAvailable()
    const before = findView(id)
    if (!before) return { status: 'deleted' }
    const next = writeViewConfig(before.config, config)
    const problem = viewConfigProblem(next)
    // VW1d code review round 2 (R2-2): the stored view's own settings from
    // another WILSON (kept on write, design §5.1) can fill the 32 KB alone;
    // then the change itself fits and only a new view (which carries just
    // this build's settings) can hold it — said so, not "at most 32 KB".
    if (problem && !viewConfigProblem(writeViewConfig(null, config))) {
      throw wordsError(OTHER_SETTINGS_FILL_WORDS, 'table_view_invalid')
    }
    if (problem) throw wordsError(problem, 'table_view_invalid')
    const projectId = projectIdRef.current
    const visit = projectVisitRef.current
    const expected = expectRevision ?? before.revision
    const res = await adapterRef.current.updateTableView(id, { config: next }, { projectId, expectRevision: expected })
    if (res?.status === 'saved' && res.row) {
      applyRows('tableViews', [res.row], visit)
      offerUndo(words ?? `${before.name} saved`, visit, async () => {
        const back = await adapterRef.current.updateTableView(id, { config: before.config }, { projectId, expectRevision: res.row.revision })
        if (back?.status === 'saved' && back.row) { applyRows('tableViews', [back.row], visit); return true }
        if (back?.status === 'changed' && back.row) applyRows('tableViews', [back.row], visit)
        if (back?.status === 'deleted') dropRows('tableViews', [id], visit)
        return refusedUndoWords(back, before.name)
      })
    } else if (res?.status === 'changed' && res.row) {
      applyRows('tableViews', [res.row], visit)
    } else if (res?.status === 'deleted') {
      dropRows('tableViews', [id], visit)
    }
    return res
  }, [requireAvailable, findView, adapterRef, projectVisitRef, applyRows, dropRows, offerUndo])

  /** Rename a view (never a new revision: the bar is not raised). */
  const renameTableView = useCallback(async (id, name, { words } = {}) => {
    requireAvailable()
    const before = findView(id)
    if (!before) return { status: 'deleted' }
    const clean = normalizeViewName(name)
    const problem = viewNameProblem(clean)
    if (problem) throw wordsError(problem, 'table_view_invalid')
    if (clean === before.name) return { status: 'saved', row: before }
    const projectId = projectIdRef.current
    const visit = projectVisitRef.current
    const res = await adapterRef.current.updateTableView(id, { name: clean }, { projectId })
    if (res?.status === 'saved' && res.row) {
      applyRows('tableViews', [res.row], visit)
      offerUndo(words ?? `Renamed to ${clean}`, visit, async () => {
        const back = await adapterRef.current.updateTableView(id, { name: before.name }, { projectId, expectName: clean })
        if (back?.status === 'saved' && back.row) { applyRows('tableViews', [back.row], visit); return true }
        if (back?.status === 'changed' && back.row) applyRows('tableViews', [back.row], visit)
        if (back?.status === 'deleted') dropRows('tableViews', [id], visit)
        return refusedUndoWords(back, clean)
      })
    } else if (res?.status === 'deleted') {
      dropRows('tableViews', [id], visit)
    }
    return res
  }, [requireAvailable, findView, adapterRef, projectVisitRef, applyRows, dropRows, offerUndo])

  /** Delete a view for everyone (the dropdown asks first); its undo makes it again with its id. */
  const deleteTableView = useCallback(async (id, { words } = {}) => {
    requireAvailable()
    const before = findView(id)
    if (!before) return { status: 'deleted' }
    const projectId = projectIdRef.current
    const visit = projectVisitRef.current
    const res = await adapterRef.current.deleteTableView(id, { projectId })
    if (res?.status === 'removed' || res?.status === 'deleted') dropRows('tableViews', [id], visit)
    if (res?.status === 'removed') {
      offerUndo(words ?? `${before.name} deleted`, visit, async () => {
        const stored = await adapterRef.current.addTableView({
          id: before.id, project_id: projectId, table_key: before.table_key,
          name: before.name, position: before.position, config: before.config,
        })
        applyRows('tableViews', [stored], visit)
        return true
      })
    }
    return res
  }, [requireAvailable, findView, adapterRef, projectVisitRef, applyRows, dropRows, offerUndo])

  /**
   * Put a table's views in a new order (reorder_table_views' rule: the named
   * first, the rest after). On screen at once; put back if the backend
   * refuses. Its undo puts the order back, unconditionally.
   */
  const reorderTableViews = useCallback(async (tableKey, ids, { words } = {}) => {
    requireAvailable()
    const views = bundleRef.current.tableViews || []
    const changes = planReorderViews(views, tableKey, ids)
    if (changes.length === 0) return []
    const before = viewsOfTable(views, tableKey)
    const beforeIds = before.map(v => v.id)
    const projectId = projectIdRef.current
    const visit = projectVisitRef.current
    const moved = new Map(changes.map(c => [String(c.id), c.position]))
    applyRows('tableViews', before.filter(v => moved.has(String(v.id))).map(v => ({ ...v, position: moved.get(String(v.id)) })), visit)
    let rows
    try {
      rows = await adapterRef.current.reorderTableViews(projectId, tableKey, ids)
    } catch (err) {
      applyRows('tableViews', before, visit)
      throw err
    }
    applyRows('tableViews', rows || [], visit)
    offerUndo(words ?? 'Views reordered', visit, async () => {
      const back = await adapterRef.current.reorderTableViews(projectId, tableKey, beforeIds)
      applyRows('tableViews', back || [], visit)
      return true
    })
    return rows || []
  }, [requireAvailable, bundleRef, adapterRef, projectVisitRef, applyRows, offerUndo])

  // ── Groupings ──

  /**
   * Make a grouping for a set of items (Create grouping, Q-D3; saved for the
   * project, Q-D2). A set already stored for that table and kind answers the
   * stored grouping and writes nothing (the dialog says it exists).
   */
  const addItemGrouping = useCallback(async ({ tableKey, kind, entityIds } = {}, opts = {}) => {
    requireAvailable()
    const projectId = projectIdRef.current
    const row = { id: opts.id || uuidv4(), project_id: projectId, table_key: tableKey, kind, entity_ids: normalizeEntityIds(entityIds) }
    const problem = groupingProblem(row)
    if (problem) throw wordsError(problem, 'item_grouping_invalid')
    const existing = findGroupingBySet(bundleRef.current.itemGroupings, tableKey, kind, row.entity_ids)
    if (existing) return existing
    const visit = projectVisitRef.current
    const stored = await adapterRef.current.addItemGrouping(row)
    applyRows('itemGroupings', [stored], visit)
    if (stored && String(stored.id) === String(row.id)) {
      offerUndo(opts.words ?? 'Grouping created', visit, async () => {
        const res = await adapterRef.current.removeItemGrouping(stored.id, projectId)
        // Review round 2 (R2-6): `filtered` (the cloud's policies dropped
        // the delete) keeps it on screen, and says why.
        if (res?.status === 'filtered') return GROUPINGS_GATE_WORDS
        dropRows('itemGroupings', [stored.id], visit)
        return true
      })
    }
    return stored
  }, [requireAvailable, bundleRef, adapterRef, projectVisitRef, applyRows, dropRows, offerUndo])

  /** Remove a grouping (its group's menu asks first, Q-D5); rows keep their items. */
  const removeItemGrouping = useCallback(async (id, { words } = {}) => {
    requireAvailable()
    const before = findGrouping(id)
    if (!before) return { removed: false }
    const projectId = projectIdRef.current
    const visit = projectVisitRef.current
    const res = await adapterRef.current.removeItemGrouping(id, projectId)
    // Review round 1 (R1-3): off the screen only when it is off the backend;
    // `filtered` (the cloud's policies dropped the delete) keeps it, and the
    // caller says why.
    if (res?.removed || res?.status === 'deleted') dropRows('itemGroupings', [id], visit)
    if (res?.removed) {
      offerUndo(words ?? 'Grouping removed', visit, async () => {
        try {
          const stored = await adapterRef.current.addItemGrouping({
            id: before.id, project_id: projectId, table_key: before.table_key, kind: before.kind, entity_ids: before.entity_ids,
          })
          applyRows('itemGroupings', [stored], visit)
          return true
        } catch (err) {
          // An item it named is no longer in the project (deleted, or in the
          // trash): nothing to try again.
          if (err?.code === '23503' || err?.code === 'item_grouping_entity_not_found') {
            return 'An item in that grouping is no longer in the project, so it was not made again.'
          }
          throw err
        }
      })
    }
    return res
  }, [requireAvailable, findGrouping, adapterRef, projectVisitRef, dropRows, applyRows, offerUndo])

  // ── Selectors ──
  const tableViews = bundle.tableViews || EMPTY
  const itemGroupings = bundle.itemGroupings || EMPTY
  const viewsOf = useCallback((tableKey) => viewsOfTable(tableViews, tableKey), [tableViews])
  const groupingsOf = useCallback((tableKey, kind) => groupingsOfTable(itemGroupings, tableKey, kind), [itemGroupings])

  // ── The last used view (Q4, design §4.5) ──
  const [last, setLast] = useState({ status: 'loading', map: {} })
  const lastRef = useRef(last)
  lastRef.current = last
  const lastSeqRef = useRef(0)
  // Read again for every adapter (an object, read at render) and every
  // person. Not by the mode alone: the signed-out desktop's boot chooses
  // 'local_server', which is already the provider's default mode, so the mode
  // never changed and the read ran only at mount, before there was an
  // adapter — the desktop never read its map (VW1c, found in the session).
  const adapterNow = adapterRef.current
  useEffect(() => {
    const seq = ++lastSeqRef.current
    const a = adapterNow
    if (!a || typeof a.getTableViewLast !== 'function') {
      setLast({ status: 'unavailable', map: {} })
      return undefined
    }
    setLast({ status: 'loading', map: {} })
    let settled = false
    const timer = setTimeout(() => {
      if (settled || seq !== lastSeqRef.current) return
      settled = true
      setLast({ status: 'failed', map: {} })
    }, TABLE_VIEW_LAST_WAIT_MS)
    Promise.resolve()
      .then(() => a.getTableViewLast())
      .then((res) => {
        if (settled || seq !== lastSeqRef.current) return
        settled = true
        clearTimeout(timer)
        const map = res && typeof res.map === 'object' && res.map && !Array.isArray(res.map) ? res.map : {}
        setLast({ status: res?.available === false ? 'unavailable' : 'ready', map })
      }, () => {
        if (settled || seq !== lastSeqRef.current) return
        settled = true
        clearTimeout(timer)
        setLast({ status: 'failed', map: {} })
      })
    return () => { settled = true; clearTimeout(timer) }
  }, [adapterNow, adapterMode, authUserId])

  // Writes go one behind another, so two quick choices land in their order.
  const lastQueueRef = useRef(Promise.resolve())
  const setTableViewLast = useCallback((tableKey, viewId) => {
    const projectId = projectIdRef.current
    const a = adapterRef.current
    if (lastRef.current.status !== 'ready' || !projectId || !isTableKey(tableKey) || !viewId) return Promise.resolve(null)
    if (typeof a?.setTableViewLast !== 'function') return Promise.resolve(null)
    const key = tableViewLastKey(projectId, tableKey)
    const seq = lastSeqRef.current
    setLast(s => (s.status === 'ready' ? { ...s, map: mergeTableViewLast(s.map, key, viewId, Date.now()) } : s))
    const run = lastQueueRef.current.then(async () => {
      try {
        const map = await a.setTableViewLast(key, viewId)
        if (seq !== lastSeqRef.current) return null
        if (map && typeof map === 'object' && !Array.isArray(map)) setLast(s => (s.status === 'ready' ? { ...s, map } : s))
        return map || null
      } catch {
        return null // the choice stays on screen; the next one writes again
      }
    })
    lastQueueRef.current = run.then(() => undefined, () => undefined)
    return run
  }, [adapterRef])

  const lastViewOf = useCallback((tableKey) => (
    last.status === 'ready' && activeProjectId ? readTableViewLast(last.map, activeProjectId, tableKey) : null
  ), [last, activeProjectId])

  // ── The changes for now (Q3b) ──
  // VW1d (2026-10-25): a change also keeps the view's settings it began
  // from (`baseConfig`: an empty filter row, or a teammate's save over a
  // change that changes nothing, is told apart from a real change) and the
  // view's name (the bar names a view deleted meanwhile, §4.4). A draft with
  // no `config` only says which view is on screen (chosen, or the last used
  // one the table opened on), kept across tabs like a change.
  const [drafts, setDrafts] = useState({})
  useEffect(() => { setDrafts({}) }, [activeProjectId, adapterMode])
  const viewDraftOf = useCallback((tableKey) => drafts[tableKey] || null, [drafts])
  const setViewDraft = useCallback((tableKey, draft) => {
    if (!isTableKey(tableKey)) return
    setDrafts(d => (draft ? {
      ...d,
      [tableKey]: {
        viewId: draft.viewId ?? null,
        baseRevision: draft.baseRevision ?? null,
        config: draft.config ?? null,
        baseConfig: draft.baseConfig ?? null,
        name: typeof draft.name === 'string' ? draft.name : null,
      },
    } : d))
  }, [])
  const clearViewDraft = useCallback((tableKey) => {
    setDrafts(d => {
      if (!(tableKey in d)) return d
      const next = { ...d }
      delete next[tableKey]
      return next
    })
  }, [])

  // One object, kept while its parts are, so the provider's context value
  // changes only when something here does.
  return useMemo(() => ({
    tableViews, itemGroupings, available, loadError,
    viewsOf, allViewOf, groupingsOf,
    addTableView, updateTableView, renameTableView, deleteTableView, reorderTableViews,
    addItemGrouping, removeItemGrouping,
    tableViewLast: last, setTableViewLast, lastViewOf,
    viewDraftOf, setViewDraft, clearViewDraft,
  }), [
    tableViews, itemGroupings, available, loadError, viewsOf, groupingsOf,
    addTableView, updateTableView, renameTableView, deleteTableView, reorderTableViews,
    addItemGrouping, removeItemGrouping, last, setTableViewLast, lastViewOf,
    viewDraftOf, setViewDraft, clearViewDraft,
  ])
}

const EMPTY = Object.freeze([])
