// ============================================================
// RABBIT — one table's views on screen (VW1d, 2026-10-25)
// ============================================================
//
// docs/design/CUSTOM_VIEWS_DESIGN.md §4.2 to §4.5 (as VW1d's step 0 review
// corrected them). The hook a table calls once: which view is on screen, the
// config it shows (the view's, or the change for now), the bar's state, and
// the verbs the Views dropdown, the cards and the bar use. Everything below
// the provider's API (state/tableViewsState.js) is derived on render
// (finding 4); its own state is the last save's refusal per view (the bar's
// danger row and its Try again), the views seen this visit (a view deleted
// by a teammate while on screen says so; one the last used map names but is
// gone opens on *All* without a word, §4.5), and, only where the provider
// has no views API, the change for now itself (code review round 1, R1-14).
//
// Her answers: Q3 and Q3b (a change is for the moment, kept across tabs,
// dropped on a project switch or a reload), Q3d (a teammate's save follows;
// one's own change stays), Q4 (the last used view), Q-G1 (a New view is
// saved at once, starting as All), Q-G3 (Save over a teammate's newer save
// asks first: the caller asks, then `save({ over: true })`), Q-H (choosing a
// view drops a change for now without asking).
//
// A table without the provider's views API (a test double, or a backend the
// screen reaches before VW1c's provider) still works: the change for now is
// kept here, and *All* is the only view.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ALL_VIEW_ID, allViewOf as builtInAll, readViewConfig } from '../../state/tableViewsModel'
import { viewOnScreen, sameEffect, barStateOf, copyName } from './viewScreenModel'

/**
 * @param {object} p
 * @param {object} p.ctx           the provider's context (useRabbit())
 * @param {string} p.tableKey      'tasks' (VW1e: the other tables)
 * @param {object} p.description   the table's description (tasksTableView.js)
 * @param {boolean} p.canWrite     the seat may save views (Q2, Q-F)
 * @param {Function} [p.nameOf]    a person's name by id, or null (the roster)
 * @param {Function} [p.notify]    a passing message (the kit toast): "Shoot week was deleted. Showing All."
 */
export function useTableView({ ctx, tableKey, description, canWrite = false, nameOf = () => null, notify = null }) {
  const api = !!ctx && typeof ctx.viewsOf === 'function' && typeof ctx.viewDraftOf === 'function'
  const [localDraft, setLocalDraft] = useState(null)
  const draft = api ? ctx.viewDraftOf(tableKey) : localDraft
  const writeDraft = useCallback((d) => {
    if (api && typeof ctx.setViewDraft === 'function') ctx.setViewDraft(tableKey, d)
    else setLocalDraft(d)
  }, [api, ctx, tableKey])

  const views = useMemo(() => (api ? ctx.viewsOf(tableKey) : []), [api, ctx, tableKey])
  const available = api && ctx.tableViewsAvailable === true
  const lastStatus = ctx?.tableViewLast?.status || 'unavailable'
  const lastId = typeof ctx?.lastViewOf === 'function' ? ctx.lastViewOf(tableKey) : null
  const screen = viewOnScreen({ draft, views, lastStatus, lastId })
  const allView = useMemo(() => (typeof ctx?.allViewOf === 'function' ? ctx.allViewOf(tableKey) : builtInAll(tableKey)), [ctx, tableKey])
  const row = screen.row
  const isAll = screen.id === ALL_VIEW_ID && !screen.deleted
  const name = row ? row.name : screen.deleted ? (draft?.name || 'This view') : 'All'
  const read = useMemo(() => (row ? readViewConfig(row.config, tableKey) : { config: allView.config, newer: false, unreadable: false }), [row, tableKey, allView])
  const saved = read.config
  // VW1e: the columns in front of the name count too (her Q-J).
  const fx = useMemo(() => ({ tableKey, fieldKeys: description.fieldKeys, fixed: description.fixed, leadingKeys: description.leadingKeys || [] }), [tableKey, description])

  // A change of one's own: the change for now shows the table otherwise than
  // the view it began from AND otherwise than the view now (a teammate who
  // saved the same change leaves nothing to save).
  const draftConfig = draft?.config || null
  const ownChange = !!draftConfig
    && !sameEffect(draftConfig, draft.baseConfig || saved, fx)
    && !sameEffect(draftConfig, saved, fx)
  // The view's revision past the change's (her Q3d: the live merge brought a
  // teammate's save, or a refused Save brought it in).
  const moved = !!row && !!draftConfig && draft.baseRevision != null && Number(row.revision) !== Number(draft.baseRevision)
  // On screen: one's own change; a change that changes nothing while the
  // view has not moved (it may hold an empty filter row); else the view.
  const fromDraft = !!draftConfig && (ownChange || !moved)
  const config = fromDraft ? draftConfig : saved

  // The last save's refusal, per view (the only state the bar keeps).
  const [refusals, setRefusals] = useState({})
  // A refusal holds for the revision it met: a teammate's save after it (the
  // live merge moves the row's revision) makes it stale, and the bar says
  // their save instead — with Save asking first, and a newer WILSON's Save
  // greyed (code review round 2, R2-1: the stale "could not be saved" row,
  // checked before the moved one, offered a Try again that could never land).
  const stored = refusals[String(screen.id)] || null
  const refusal = stored && (!row || stored.revision == null || Number(stored.revision) === Number(row.revision)) ? stored : null
  const clearRefusal = useCallback((id) => setRefusals(r => {
    if (!(String(id) in r)) return r
    const next = { ...r }
    delete next[String(id)]
    return next
  }), [])

  const selection = useCallback((id, rowNow) => ({
    viewId: id,
    baseRevision: rowNow ? rowNow.revision : 0,
    baseConfig: null,
    config: null,
    name: rowNow ? rowNow.name : (id === ALL_VIEW_ID ? 'All' : null),
  }), [])

  // The view a table opened on (the last used one) is pinned for the visit,
  // so a teammate's delete of it is noticed like one of a chosen view.
  useEffect(() => {
    if (!draft && !screen.waiting && row) writeDraft(selection(row.id, row))
  }, [draft, screen.waiting, row, writeDraft, selection])

  // A view deleted meanwhile with no change of one's own: the table goes to
  // All, saying so when the view was on screen this visit (design §4.2).
  const seenRef = useRef(new Set())
  for (const v of views) seenRef.current.add(String(v.id))
  const ownDeletesRef = useRef(new Set())
  const deletedId = screen.deleted ? String(screen.id) : null
  useEffect(() => {
    if (!deletedId || ownChange) return
    const said = draft?.name || 'The view'
    writeDraft(selection(ALL_VIEW_ID, null))
    if (seenRef.current.has(deletedId) && !ownDeletesRef.current.has(deletedId)) notify?.(`${said} was deleted. Showing All.`)
  }, [deletedId, ownChange]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── The change for now ──
  /** Change the config on screen: `next` a patch or a function of the config now. */
  const update = useCallback((next) => {
    const now = config
    const value = typeof next === 'function' ? next(now) : { ...now, ...next }
    const keep = !!draftConfig && ownChange
    writeDraft({
      viewId: screen.id,
      baseRevision: keep ? draft.baseRevision : (row ? row.revision : 0),
      baseConfig: keep ? (draft.baseConfig || saved) : saved,
      config: value,
      name,
    })
    clearRefusal(screen.id)
  }, [config, draftConfig, ownChange, draft, row, saved, screen.id, name, writeDraft, clearRefusal])

  /** Choose a view (Q-H: a change for now is dropped without asking); it becomes the last used one (Q4). */
  const choose = useCallback((id) => {
    const target = id === ALL_VIEW_ID ? null : views.find(v => String(v.id) === String(id)) || null
    const viewId = target ? target.id : ALL_VIEW_ID
    writeDraft(selection(viewId, target))
    clearRefusal(viewId)
    if (typeof ctx?.setTableViewLast === 'function') ctx.setTableViewLast(tableKey, viewId)
  }, [views, writeDraft, selection, clearRefusal, ctx, tableKey])

  /** Reset: the view as saved (a deleted one's: back to All). */
  const reset = useCallback(() => {
    if (screen.deleted) { writeDraft(selection(ALL_VIEW_ID, null)); return }
    writeDraft(selection(screen.id, row))
    clearRefusal(screen.id)
  }, [screen.deleted, screen.id, row, writeDraft, selection, clearRefusal])

  /**
   * Save the change into the view (the bar's Save): conditional on the
   * revision the change began from, or, `over` (Q-G3, after asking), on the
   * teammate's now. Answers the backend's status; `changed` and `deleted`
   * bring the row in or take it out (the bar then derives its state),
   * `filtered` and a failure are kept for the bar.
   */
  const save = useCallback(async ({ over = false } = {}) => {
    if (!row || typeof ctx?.updateTableView !== 'function') return null
    const id = row.id
    try {
      const res = await ctx.updateTableView(id, config, { expectRevision: over ? row.revision : draft?.baseRevision ?? row.revision })
      if (res?.status === 'saved' && res.row) {
        writeDraft(selection(res.row.id, res.row))
        clearRefusal(id)
      } else if (res?.status === 'filtered') {
        setRefusals(r => ({ ...r, [String(id)]: { kind: 'filtered', revision: row.revision } }))
      } else {
        // `changed` / `deleted`: the row the backend brought (or took) says
        // what the bar says now; an older refusal no longer does (review
        // round 2, R2-1).
        clearRefusal(id)
      }
      return res?.status || null
    } catch (err) {
      setRefusals(r => ({ ...r, [String(id)]: { kind: 'failed', reason: err?.message || String(err), revision: row.revision } }))
      return 'failed'
    }
  }, [row, ctx, config, draft, writeDraft, selection, clearRefusal])

  /** Save as new view: a new view holding the change, applied and made the last used one. Throws a refusal in words. */
  const saveAsNew = useCallback(async (newName) => {
    const stored = await ctx.addTableView({ tableKey, name: newName, config })
    writeDraft(selection(stored.id, stored))
    if (typeof ctx?.setTableViewLast === 'function') ctx.setTableViewLast(tableKey, stored.id)
    return stored
  }, [ctx, tableKey, config, writeDraft, selection])

  // ── The dropdown's verbs ──
  /** New view (Q-G1): saved for everyone at once, starting as All, applied. */
  const create = useCallback(async (newName) => {
    const stored = await ctx.addTableView({ tableKey, name: newName })
    writeDraft(selection(stored.id, stored))
    if (typeof ctx?.setTableViewLast === 'function') ctx.setTableViewLast(tableKey, stored.id)
    return stored
  }, [ctx, tableKey, writeDraft, selection])

  /** Duplicate: "Shoot week copy", at the end (Q5c). */
  const duplicate = useCallback((view) => ctx.addTableView({ tableKey, name: copyName(view.name), config: view.config }), [ctx, tableKey])

  const rename = useCallback((view, newName) => ctx.renameTableView(view.id, newName), [ctx])

  /** Delete for everyone (the dropdown asks first); the view on screen goes to All. */
  const remove = useCallback(async (view) => {
    ownDeletesRef.current.add(String(view.id))
    const res = await ctx.deleteTableView(view.id)
    if ((res?.status === 'removed' || res?.status === 'deleted') && String(screen.id) === String(view.id)) {
      writeDraft(selection(ALL_VIEW_ID, null))
    }
    return res
  }, [ctx, screen.id, writeDraft, selection])

  const reorder = useCallback((ids) => ctx.reorderTableViews(tableKey, ids), [ctx, tableKey])

  // ── The bar (design §4.4) ──
  // Who saved the view after the change began (Q-G3's question names them):
  // the person in another window, another computer (the signed-out desktop
  // writes no `revised_by`), or a teammate by name.
  const changedBy = !moved ? null
    : row?.revised_by && ctx?.authUserId && String(row.revised_by) === String(ctx.authUserId) ? 'me'
      : !row?.revised_by ? 'computer'
        : (nameOf(row.revised_by) || 'Someone')
  const bar = barStateOf({
    isAll,
    name,
    ownChange,
    deleted: screen.deleted,
    moved,
    revisedBy: row?.revised_by ?? null,
    me: ctx?.authUserId ?? null,
    whoName: row?.revised_by ? nameOf(row.revised_by) : null,
    canWrite,
    available,
    refusal,
    newer: read.newer,
  })

  return {
    api,
    available,
    error: api ? ctx.tableViewsError || null : null,
    views,
    allView,
    viewId: screen.id,
    name,
    deleted: screen.deleted,
    waiting: screen.waiting,
    config,
    // The config on screen is the change for now's (not the view's own).
    fromDraft,
    changedBy,
    bar,
    canEdit: canWrite && available,
    update, choose, reset, save, saveAsNew, create, duplicate, rename, remove, reorder,
  }
}
