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
//     says why (the provider's notice) and closes; a failed request keeps the
//     toast up to try again.
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
export const TABLE_VIEW_LAST_WAIT_MS = 2000

export function tableViewsUnavailableError() {
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

/** The groupings after each of `ids` (of `kind`) is deleted for good (planForgetItem, in turn). */
export function sweepGroupings(groupings, kind, ids) {
  let rows = Array.isArray(groupings) ? groupings : []
  for (const id of ids || []) {
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
 * Undo of a delete for good: each grouping put back as it was — removed and
 * made again with its id where it shrank (a grouping has no update), made
 * again where it went. Run after the row itself is back (the backends check
 * every id names a row of the project). A set that is stored already (a
 * teammate made it meanwhile) is left as it is.
 */
export async function restoreGroupingRows({ adapter, projectId, originals, bundleRef, setBundle }) {
  for (const g of originals || []) {
    const current = (bundleRef.current.itemGroupings || []).find(x => String(x.id) === String(g.id))
    if (current && groupingKeyOf(current.entity_ids) === groupingKeyOf(g.entity_ids)) continue
    if (current) await adapter.removeItemGrouping(g.id, projectId)
    const stored = await adapter.addItemGrouping({
      id: g.id, project_id: projectId, table_key: g.table_key, kind: g.kind, entity_ids: g.entity_ids,
    })
    const apply = (b) => {
      const list = (b.itemGroupings || []).filter(x => String(x.id) !== String(g.id) && String(x.id) !== String(stored?.id))
      return { ...b, itemGroupings: stored ? [...list, stored].sort(compareGroupingRows) : list }
    }
    setBundle(apply)
    bundleRef.current = apply(bundleRef.current)
  }
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
  // words to say when it was refused (nothing to retry); a thrown error keeps
  // the toast up to try again. Never on another project than the visit's: a
  // step that finished after a project switch offers nothing (runWithUndoToast's
  // rule), and an Undo pressed after one does nothing.
  const offerUndo = useCallback((words, visit, run) => {
    if (typeof showUndoToast !== 'function' || !words) return
    if (visit !== projectVisitRef.current) return
    showUndoToast(words, async () => {
      if (visit !== projectVisitRef.current) return
      const outcome = await run()
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
        await adapterRef.current.removeItemGrouping(stored.id, projectId)
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
    dropRows('itemGroupings', [id], visit)
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
  useEffect(() => {
    const seq = ++lastSeqRef.current
    const a = adapterRef.current
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapterMode, authUserId])

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
  const [drafts, setDrafts] = useState({})
  useEffect(() => { setDrafts({}) }, [activeProjectId, adapterMode])
  const viewDraftOf = useCallback((tableKey) => drafts[tableKey] || null, [drafts])
  const setViewDraft = useCallback((tableKey, draft) => {
    if (!isTableKey(tableKey)) return
    setDrafts(d => (draft ? { ...d, [tableKey]: { viewId: draft.viewId ?? null, baseRevision: draft.baseRevision ?? null, config: draft.config ?? null } } : d))
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
