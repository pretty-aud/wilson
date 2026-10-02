// ============================================================
// RABBIT — the Scenes tab's shot lists (post-overhaul S3b, steps 3–6)
// ============================================================
//
// Everything about lists the Scenes tab does, in one place outside the
// 3,500-line ScenesView: the bar (ShotListBar), its More menu, the questions
// its verbs ask, the picker, the New / Save as… / Edit details dialog, Add
// from another list, and the one place their refusals are shown. ScenesView
// renders it between its tiles and its toolbar and hands it the list on
// screen (useViewedShotList) and the seats (useProjectAccess).
//
// Every write goes through S3a's ctx mutators; none is added here. A
// refusal BEFORE a write is thrown by the mutator in the backend's own
// words (shotListModel's sentences); a refusal BY the backend also lands in
// ctx.error (S3a: "surface ctx.error near the bar, never swallow it"). So:
// a verb asked in a dialog shows its refusal in that dialog's error slot; a
// verb on the bar shows it in the kit Banner under the bar; and ctx.error is
// shown there too when it changes while the tab is open and no dialog has
// already said it (`onError`, owned by ScenesView, so a row's verbs report
// to the same Banner).
//
// The picker stays open under the questions its rows ask (each a kit Dialog
// over it on the modal stack), so a list made active or archived from it is
// seen to change there.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X, Archive, ArchiveRestore, Undo2, Eraser, CheckCircle2, Pencil, ListPlus, Scissors } from 'lucide-react'
import { Banner, Button, IconButton, StatusBadge } from '../../../../ui'
import GatedAction from '../../../../permissions/GatedAction'
import { sortShotLists } from '../../state/shotListModel'
import { showDate } from '../../dates'
import ShotListBar from './ShotListBar'
import ShotListPicker from './ShotListPicker'
import ShotListForm from './ShotListForm'
import AddFromListDialog from './AddFromListDialog'
import ListConfirm from './ListConfirm'
import AnswerDialog from './AnswerDialog'
import SaveEditDialog from './SaveEditDialog'
import { recoverWords, discardWords } from './editCopy'
import { confirmLeave } from '../../state/leaveGuard'
import { listSaveState, restoreRouteFor, restoreEditRouteFor } from './shotListState'
import { removeQuestion, activeListLeaves, SET_ACTIVE_KEEPS, NOT_ACTIVE_KEEPS } from './membershipCopy'
import { UNLISTED, unlistedSceneRows } from './useViewedShotList'
import '../rabbitScenes.css'

const OTHER_TABS = 'the Timeline, Budget, Tasks, Assets, Bins and every other tab'
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const ALL = 'all'
// "Not in any list" and every row: in number order, as the tables sort them.
const byNumber = (field) => (a, b) => (a[field] ?? Infinity) - (b[field] ?? Infinity) || String(a.name || '').localeCompare(String(b.name || ''))

/**
 * ctx      useRabbit()
 * viewed   useViewedShotList(): { id, list, mode, scenes, shots, view }
 * gate     { write, writeReason, activate, activateReason }
 * userId   the signed-in user (usePermissions), for the maker's restore
 * error / onError   the Banner's sentence, owned by ScenesView
 * remove   { ask: { kind, ids, done } | null, close } — a row's or a
 *          selection's Remove from this list, asked here (step 6)
 * startEdit   post-overhaul S3c, step 4: "New edit from this list" — the
 *          first-change question with no change yet (ScenesView's
 *          useEditChanges), the keyboard's way to an edit besides the drag
 * pageActive  R.A.B.B.I.T. is the page on screen: "Recover unsaved edit?"
 *          asks only then (every page stays mounted; a dialog in <body>
 *          would sit over another page)
 */
export default function ShotLists({ ctx, viewed, gate, userId, error, onError, remove, startEdit = null, pageActive = false }) {
  // The picker, and over it (or alone) one question or form: { kind, row }.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerError, setPickerError] = useState(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [dialog, setDialog] = useState(null)
  const close = useCallback(() => setDialog(null), [])
  const closePicker = useCallback(() => { setPickerOpen(false); setPickerError(null) }, [])

  const lists = ctx?.shotLists || []
  const label = useCallback((row) => (ctx?.formatShotListLabel ? ctx.formatShotListLabel(row) : ''), [ctx])
  const activeList = ctx?.activeShotList || null
  const activeId = ctx?.project?.active_shot_list_id || null
  const hasLiveList = lists.some(l => !l.archived_at)
  const list = viewed.list
  const items = ctx?.shotListItems
  const allScenes = ctx?.allScenes
  const allShots = ctx?.allShots
  const saveState = useMemo(
    () => (list ? listSaveState({ list, scenes: allScenes || [], shots: allShots || [], items: items || [] }) : null),
    [list, allScenes, allShots, items],
  )
  // The provider's notion of "who made it" (RabbitProvider's withdrawUserId):
  // the signed-in user on a backend with users — the dev fixtures report
  // one too — and none on the Local Server, where the maker test is skipped.
  const makerUserId = ctx?.adapterMode === 'supabase' ? (userId || null) : undefined
  const restoreRoute = (row) => restoreRouteFor({ list: row, canActivate: gate.activate, canWrite: gate.write, makerUserId })
  const recent = ctx?.recentlyWithdrawn?.kind === 'shot_list' ? ctx.recentlyWithdrawn : null
  // Post-overhaul S3c, step 3: a withdrawn EDIT is "Recently removed" too
  // (S3a left it for this bundle): Open shows it on its list, read-only;
  // Restore puts it back.
  const recentEdit = ctx?.recentlyWithdrawn?.kind === 'edit' ? ctx.recentlyWithdrawn : null

  // ctx.error, when it changes while the tab is open: not the one it held
  // before (another tab's), and not one a dialog or this bar has already
  // shown in its own words.
  const ctxError = ctx?.error || null
  const errorAtMount = useRef(ctxError)
  const shown = useRef(null)
  useEffect(() => {
    if (!ctxError || ctxError === errorAtMount.current || ctxError === shown.current) return
    onError(ctxError)
  }, [ctxError, onError])
  /** Run a verb; its refusal goes to `report` (the Banner, or the picker's slot). */
  const runWith = useCallback((report) => async (fn) => {
    try {
      report(null)
      await fn()
    } catch (err) {
      const msg = err?.message || String(err)
      shown.current = msg
      report(msg)
    }
  }, [])
  const run = useMemo(() => runWith(onError), [runWith, onError])
  const runInPicker = useMemo(() => runWith(setPickerError), [runWith])
  /** Run a verb from a question; its refusal stays in the question (rethrown). Its result is returned (S3c: Save edit shows the edit it made). */
  const inDialog = useCallback(async (fn) => {
    try {
      return await fn()
    } catch (err) {
      shown.current = err?.message || String(err)
      throw err
    }
  }, [])

  // ── the verbs ──
  // Post-overhaul S3c, step 7 (D12): a draft never hides behind another view,
  // so showing another list or edit — the selector, the picker's Open, New
  // shot list, "Active: …", Recently removed — takes it off screen: the
  // leave guard asks first (Save edit / Discard changes / Keep editing), at
  // the press, before anything is made or shown.
  const draftHere = viewed.edit?.mode === 'draft'
  const guarded = (fn) => async (...args) => {
    if (draftHere && !(await confirmLeave('edit'))) return undefined
    return fn(...args)
  }
  const showList = (id, opts) => viewed.view(id, opts)
  const restoreRow = async (row) => {
    if (restoreRoute(row) === 'archive') await ctx.archiveShotList(row.id, false)
    else await ctx.restoreWithdrawn({ kind: 'shot_list', id: row.id })
  }
  // An edit is shown on its list: the list as it is (archived lists opened
  // on purpose, read-only), with the edit on screen.
  const showEdit = (editRow) => {
    const home = lists.find(l => l.id === editRow?.shot_list_id)
    if (!home) return
    showList(home.id, home.archived_at ? { archived: true } : undefined)
    viewed.viewEdit?.(editRow.id, home.id)
  }
  const openRecent = () => {
    if (recent) { closePicker(); showList(recent.id, { archived: true }) }
    else if (recentEdit) { closePicker(); showEdit(recentEdit.row) }
  }
  const restoreRecent = (report) => report(async () => {
    const mark = recent || recentEdit
    await ctx.restoreWithdrawn()
    closePicker()
    if (mark?.kind === 'edit') showEdit(mark.row)
    else if (mark?.id) showList(mark.id)
  })

  // A live list's verbs by seat (D8), for the bar's More menu (the list on
  // screen: `onScreen`, whose Set active is on the bar itself) and a picker
  // row's menu. A verb that only asks to be sure has no ellipsis; one that
  // opens a form for more (Edit details…, Add from another list…) has one.
  // Add from another list… leads the bar's menu: filling the list on screen
  // is what the menu is most often opened for (step 6).
  const listVerbs = (row, { onScreen }) => {
    const out = []
    const rowActive = row.id === activeId
    const rowSave = onScreen ? saveState : listSaveState({ list: row, scenes: allScenes || [], shots: allShots || [], items: items || [] })
    const held = (items || []).some(i => i.shot_list_id === row.id)
    if (onScreen) {
      out.push(gate.write
        ? { label: 'Add from another list…', Icon: ListPlus, onClick: () => setDialog({ kind: 'addFrom', row }) }
        : { label: 'Add from another list…', Icon: ListPlus, disabled: true, hint: 'read-only' })
      // S3c step 4: an edit of this list, in its order — asked first (D13).
      if (startEdit) {
        out.push(gate.write
          ? { label: 'New edit from this list', Icon: Scissors, onClick: startEdit }
          : { label: 'New edit from this list', Icon: Scissors, disabled: true, hint: 'read-only' })
      }
    }
    if (!onScreen && !rowActive) {
      out.push(gate.activate
        ? { label: 'Set active', Icon: CheckCircle2, onClick: () => setDialog({ kind: 'setActive', row }) }
        : { label: 'Set active', Icon: CheckCircle2, disabled: true, hint: 'managers only' })
    }
    out.push(gate.write
      ? { label: 'Edit details…', Icon: Pencil, onClick: () => setDialog({ kind: 'form', mode: 'details', row }) }
      : { label: 'Edit details…', Icon: Pencil, disabled: true, hint: 'read-only' })
    // D4: Clear empties a list never saved — the active one too. Review
    // round 1 (R1-08) took it off the active list (clearing that empties
    // every other tab, and every project's backfilled "Shot list 1" is
    // active and never saved); round 2 (R2-07) put it back, since that
    // narrowed Audrey's ruling without her: the question says what it does
    // to the other tabs instead, and walkthrough 51 asks her.
    if (gate.write && rowSave?.kind === 'never' && held) {
      out.push({ label: 'Clear this list', Icon: Eraser, onClick: () => setDialog({ kind: 'clear', row }) })
    }
    if (gate.write && ctx?.canWithdrawShotList?.(row.id)) {
      out.push({ label: 'Withdraw', Icon: Undo2, onClick: () => setDialog({ kind: 'withdraw', row }) })
    }
    if (!rowActive) {
      out.push(gate.activate
        ? { label: 'Archive', Icon: Archive, onClick: () => setDialog({ kind: 'archive', row }) }
        : { label: 'Archive', Icon: Archive, disabled: true, hint: 'managers only' })
    }
    return out
  }

  // ── Edits (post-overhaul S3c, step 3) ──
  // The edit on screen (useViewedShotList's `edit`): the bar's selector
  // lists the list's live edits — and the archived one on screen, opened on
  // purpose — then the draft (step 4); "List order" is no edit. While an
  // edit is on screen the bar's More menu holds the EDIT's verbs, by seat
  // (D8; S3a's withdraw rule): Withdraw for the maker of an untouched edit,
  // Archive for a manager or an admin, Restore on an archived one for
  // whoever may.
  const editOnScreen = viewed.edit || { mode: 'none' }
  const editRow = editOnScreen.mode === 'edit' ? editOnScreen.row : null
  const listEdits = list ? (ctx?.editsOf?.(list.id) || []) : []
  const restoreEditRoute = (row) => restoreEditRouteFor({ edit: row, canActivate: gate.activate, canWrite: gate.write, makerUserId })
  const restoreEdit = async (row) => {
    if (restoreEditRoute(row) === 'archive') await ctx.archiveEdit(row.id, false)
    else await ctx.restoreWithdrawn({ kind: 'edit', id: row.id })
  }
  const editVerbs = (row) => {
    if (!row) return []
    if (row.archived_at) {
      return restoreEditRoute(row)
        ? [{ label: 'Restore this edit', Icon: ArchiveRestore, onClick: () => run(async () => { await restoreEdit(row) }) }]
        : []
    }
    const out = []
    if (gate.write && ctx?.canWithdrawEdit?.(row.id)) {
      out.push({ label: 'Withdraw this edit', Icon: Undo2, onClick: () => setDialog({ kind: 'withdrawEdit', row }) })
    }
    out.push(gate.activate
      ? { label: 'Archive this edit', Icon: Archive, onClick: () => setDialog({ kind: 'archiveEdit', row }) }
      : { label: 'Archive this edit', Icon: Archive, disabled: true, hint: 'managers only' })
    return out
  }
  // Post-overhaul S3c, step 5 (D13–D15): the edit's verbs on the bar, where
  // the list's Save / Save as… / Set active stand in List order — so the bar
  // never offers two Saves at once. Save edit is there whenever an edit is on
  // screen (it does not jump in on the first change): greyed with the reason
  // on a saved edit, and on a draft the kit Button's attention — the signal
  // edge pulsing once every 1.2s, "● Unsaved" before it, one polite
  // announcement. Discard changes beside it, on a draft only; it asks.
  const draftOnScreen = editOnScreen.mode === 'draft' ? editOnScreen.draft : null
  const editVerbsOnBar = editOnScreen.mode !== 'none' ? (
    <>
      <GatedAction
        allowed={gate.write && !!draftOnScreen}
        reason={!gate.write ? gate.writeReason
          : editRow?.archived_at ? 'This edit is set aside: restore it to change it.'
          : `Nothing to save: “${label(editRow)}” is as it was saved. A change to the cut starts its next version.`}
      >
        <Button
          size="sm"
          attention={!!draftOnScreen}
          attentionLabel={draftOnScreen ? `“${label(draftOnScreen)}” is not saved yet` : undefined}
          onClick={() => setDialog({ kind: 'saveEdit', row: draftOnScreen })}
        >
          Save edit
        </Button>
      </GatedAction>
      {draftOnScreen && (
        <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'discardEdit', row: draftOnScreen })}>Discard changes</Button>
      )}
    </>
  ) : null
  const editBar = (viewed.mode === 'list' || viewed.mode === 'archived') && list ? {
    onScreen: editOnScreen.mode !== 'none',
    value: editOnScreen.mode === 'draft' ? 'draft' : editRow ? editRow.id : '',
    options: [
      ...listEdits
        .filter(e => !e.archived_at || e.id === editRow?.id)
        .map(e => ({ value: e.id, label: `${label(e)}${e.archived_at ? ' (archived)' : ''}` })),
      ...(editOnScreen.mode === 'draft' ? [{ value: 'draft', label: `${editOnScreen.draft.title} · v${editOnScreen.draft.version} (not saved)` }] : []),
    ],
    onChange: guarded((v) => { if (v !== 'draft') viewed.viewEdit?.(v || null) }),
    title: editRow?.summary || undefined,
    badge: editRow?.archived_at ? <StatusBadge status="archived" label={ctx?.isWithdrawn?.(editRow) ? 'Withdrawn' : 'Archived'} /> : null,
    note: editRow && !editRow.archived_at ? `Saved ${showDate(editRow.created_at)}` : null,
    verbs: editVerbsOnBar,
  } : null

  const moreItems = editRow ? editVerbs(editRow)
    : editOnScreen.mode === 'draft' ? []
    : viewed.mode === 'list' && list ? listVerbs(list, { onScreen: true })
    : viewed.mode === 'archived' && list && restoreRoute(list)
      ? [{ label: 'Restore', Icon: ArchiveRestore, onClick: () => run(async () => { await restoreRow(list); showList(list.id) }) }]
      : []

  const unlisted = { scenes: (ctx?.unlistedScenes || []).length, shots: (ctx?.unlistedShots || []).length }
  // What a question counts: the list on screen's rows (its tiles' totals);
  // another list's through S3a's own selectors.
  const rowsOf = (row) => (row.id === list?.id
    ? { scenes: viewed.scenes.length, shots: viewed.shots.length }
    : { scenes: (ctx?.scenesOf?.(row.id) || []).length, shots: (ctx?.shotsOf?.(row.id) || []).length })
  const target = dialog?.row

  // ── New shot list, Save as…, Edit details (step 5) ──
  const formSource = dialog?.kind === 'form' ? (dialog.mode === 'details' ? dialog.row : list) : null
  // Where a new list starts by default: the list on screen; with none, what
  // the tab shows — every scene and shot (the project's first list, D11's
  // set); in the "Not in any list" view, nothing (those rows are added to it
  // from there, one "Add to list…" at a time).
  const defaultFrom = viewed.mode === 'list' || viewed.mode === 'archived' ? 'screen'
    : viewed.mode === 'unlisted' ? 'empty' : 'all'
  const submitForm = async ({ title, version, summary, from }) => {
    if (dialog.mode === 'details') {
      const row = dialog.row
      // Only what changed: a rename does not re-send the summary, nor the
      // other way round (S3a's last-write-wins, closed by the patch path).
      const patch = {}
      if (title !== row.title) patch.title = title
      if ((summary || null) !== (row.summary || null)) patch.summary = summary
      if (Object.keys(patch).length) await inDialog(() => ctx.updateShotList(row.id, patch))
      close()
      return
    }
    // New / Save as…: the new list becomes the one on screen. It becomes the
    // ACTIVE one only when the project has none and this person may make one
    // active (the first-list rule) — in one undo step with its making. An
    // activation the backend refuses does not unmake the list: it is said in
    // the Banner, and the bar offers Set active to whoever may.
    let made = null
    let notActive = null
    await inDialog(() => ctx.runBatch(async () => {
      made = await ctx.addShotList({
        title,
        version,
        summary,
        // Save as… is always 'screen' (the form fixes it).
        ...(from === 'screen' ? { from: formSource.id } : from === 'all' ? { fromAll: true } : {}),
      })
      if (!activeId && gate.activate) {
        try { await ctx.setActiveShotList(made.id) } catch (err) { notActive = err?.message || String(err) }
      }
    }))
    close()
    closePicker()
    if (made) showList(made.id)
    if (notActive) {
      shown.current = notActive
      onError(`“${label(made)}” was made, but not made active: ${notActive}`)
    }
  }

  // ── Add from another list… (step 6) ──
  // Where rows may come from: every other LIVE list (an archived one is set
  // aside; restore it to take from it), then the rows no live list holds,
  // then every row of the project — S3a's selectors, each in its own order.
  // Review round 1 (R1-12): about the list it opened on — if the list on
  // screen changes under it, it closes (as the Remove question does), never
  // retargets, and does not come back with the list. The effect closes it;
  // the id check keeps the one render before the effect from drawing it
  // over the new list (no test can see that frame: the planted fault that
  // removes only the check survives, recorded in the hand-off).
  const addFromOpen = dialog?.kind === 'addFrom' && viewed.mode === 'list' && !!list && dialog.row?.id === list.id
  const dialogKind = dialog?.kind
  const dialogRowId = dialog?.row?.id
  useEffect(() => {
    if (dialogKind === 'addFrom' && (viewed.mode !== 'list' || viewed.id !== dialogRowId)) setDialog(null)
  }, [dialogKind, dialogRowId, viewed.mode, viewed.id])
  const addSources = useMemo(() => {
    if (!addFromOpen) return []
    return [
      ...sortShotLists(lists.filter(l => !l.archived_at && l.id !== list.id)).map(l => ({ key: l.id, label: label(l) })),
      { key: UNLISTED, label: 'Not in any list' },
      { key: ALL, label: 'Every scene and shot in this project' },
    ]
  }, [addFromOpen, lists, list, label])
  const unlistedScenes = ctx?.unlistedScenes
  const unlistedShots = ctx?.unlistedShots
  const scenesOf = ctx?.scenesOf
  const shotsOf = ctx?.shotsOf
  const sceneById = ctx?.sceneById
  const addRowsOf = useCallback((key) => {
    // The tab's own "Not in any list" rows: a heading for each unlisted shot
    // whose scene a list holds, in scene number order.
    if (key === UNLISTED) return { scenes: unlistedSceneRows({ unlistedScenes, unlistedShots, sceneById }), shots: [...(unlistedShots || [])].sort(byNumber('shot_number')) }
    if (key === ALL) return { scenes: [...(allScenes || [])].sort(byNumber('scene_number')), shots: [...(allShots || [])].sort(byNumber('shot_number')) }
    return { scenes: scenesOf?.(key) || [], shots: shotsOf?.(key) || [] }
  }, [unlistedScenes, unlistedShots, sceneById, allScenes, allShots, scenesOf, shotsOf])
  const onScreenSets = useMemo(() => ({
    scenes: new Set(viewed.scenes.map(s => s.id)),
    shots: new Set(viewed.shots.map(s => s.id)),
  }), [viewed.scenes, viewed.shots])
  // It opens on the first source with something to add — not on an empty
  // "Not in any list", nor on a list the one on screen already holds whole;
  // with nothing to add anywhere, on every row (each ticked and greyed).
  const addDefault = useMemo(() => {
    const addable = (key) => {
      const r = addRowsOf(key)
      return r.scenes.some(s => !onScreenSets.scenes.has(s.id)) || r.shots.some(s => !onScreenSets.shots.has(s.id))
    }
    return (addSources.find(s => addable(s.key)) || addSources[addSources.length - 1])?.key ?? null
  }, [addSources, addRowsOf, onScreenSets])

  // ── Remove from this list (step 6) ──
  // Asked here, with the other list questions, so its refusal is said once:
  // in the question. The words (membershipCopy) name where each row stays —
  // the OTHER live lists that hold it — or that none does.
  const removeAsk = remove?.ask && viewed.mode === 'list' && list ? remove.ask : null
  const removeWords = removeAsk ? removeQuestion({
    kind: removeAsk.kind,
    rows: removeAsk.ids.map(id => ({
      name: (removeAsk.kind === 'scene' ? ctx?.sceneById?.(id) : ctx?.shotById?.(id))?.name || 'Untitled',
      homes: (ctx?.listsContaining?.(id) || []).filter(l => !l.archived_at && l.id !== list.id).map(label),
    })),
    shotCount: removeAsk.kind === 'scene' ? viewed.shots.filter(s => removeAsk.ids.includes(s.scene_id)).length : 0,
    // Review round 1 (R1-08): the scene's shots that NO other live list
    // holds go into no list with it, and an active list's rows leave every
    // other tab — both said, not left for the person to find out.
    homelessShots: removeAsk.kind === 'scene'
      ? viewed.shots.filter(s => removeAsk.ids.includes(s.scene_id)
        && !(ctx?.listsContaining?.(s.id) || []).some(l => !l.archived_at && l.id !== list.id)).length
      : 0,
    listLabel: label(list),
    active: list.id === activeId,
  }).join(' ') : ''

  // ── "Recover unsaved edit?" (post-overhaul S3c, step 4) ──
  // A copy a previous run left (the provider's recoverableEditDrafts: this
  // person's, this project's, no live draft of its list), asked while the
  // page is on screen, once per visit to the tab: "Not now" keeps the copy
  // for the next visit. Recover makes it the list's draft again and shows
  // that list (a list with a draft shows the draft); Discard drops it. A
  // copy whose list is archived or gone can only be discarded, said why.
  const [putOff, setPutOff] = useState(() => new Set())
  const recoverable = pageActive ? (ctx?.recoverableEditDrafts || []).find(c => !putOff.has(c.listId)) || null : null
  const recoverList = recoverable ? lists.find(l => l.id === recoverable.listId) || null : null

  return (
    <>
      <ShotListBar
        viewed={viewed}
        label={list ? label(list) : ''}
        activeList={activeList}
        activeLabel={activeList ? label(activeList) : ''}
        hasLiveList={hasLiveList}
        saveState={saveState}
        saving={saving}
        withdrawn={!!(list && ctx?.isWithdrawn?.(list))}
        recent={recent || recentEdit}
        recentLabel={recent ? label(recent.row)
          : recentEdit ? `${label(recentEdit.row)}, an edit of ${label(lists.find(l => l.id === recentEdit.row.shot_list_id)) || 'its list'}` : ''}
        gate={gate}
        edit={editBar}
        on={{
          newList: guarded(() => setDialog({ kind: 'form', mode: 'new' })),
          openPicker: () => { setPickerError(null); setPickerOpen(true) },
          // Review round 1 (R1-13): one Save at a time — a double press
          // recorded two version points.
          save: () => {
            if (savingRef.current) return
            savingRef.current = true
            setSaving(true)
            run(() => ctx.saveShotListSnapshot(list.id)).finally(() => { savingRef.current = false; setSaving(false) })
          },
          saveAs: () => setDialog({ kind: 'form', mode: 'saveAs' }),
          setActive: () => setDialog({ kind: 'setActive', row: list }),
          showList: guarded((id) => showList(id)),
          openRecent: guarded(openRecent),
          restoreRecent: guarded(() => restoreRecent(run)),
        }}
        moreItems={moreItems}
      />

      {error && (
        <Banner
          tone="danger"
          action={<IconButton size="sm" Icon={X} title="Dismiss" onClick={() => onError(null)} />}
        >
          {error}
        </Banner>
      )}

      {pickerOpen && (
        <ShotListPicker
          lists={lists}
          activeId={activeId}
          viewedId={viewed.id}
          label={label}
          isWithdrawn={ctx?.isWithdrawn}
          unlisted={unlisted}
          recent={recent || recentEdit}
          rowMenu={(row) => listVerbs(row, { onScreen: false })}
          restoreFor={(row) => (restoreRoute(row) ? () => runInPicker(() => restoreRow(row)) : null)}
          gate={gate}
          error={pickerError}
          editsOf={ctx?.editsOf}
          editMenu={(row) => (row.archived_at
            ? (restoreEditRoute(row) ? [{ label: 'Restore this edit', Icon: ArchiveRestore, onClick: () => runInPicker(() => restoreEdit(row)) }] : [])
            : editVerbs(row))}
          on={{
            open: guarded((id, opts) => { closePicker(); showList(id, opts) }),
            openUnlisted: guarded(() => { closePicker(); showList(UNLISTED) }),
            openRecent: guarded(openRecent),
            restoreRecent: guarded(() => restoreRecent(runInPicker)),
            newList: guarded(() => setDialog({ kind: 'form', mode: 'new' })),
            close: closePicker,
            openEdit: guarded((e) => { closePicker(); showEdit(e) }),
          }}
        />
      )}

      {dialog?.kind === 'saveEdit' && target && list && (
        <SaveEditDialog
          draft={target}
          list={list}
          edits={ctx?.edits || []}
          label={label}
          onClose={close}
          onSubmit={async ({ title, version, summary }) => {
            const listId = list.id
            try {
              const saved = await inDialog(() => ctx.saveEditDraft(listId, { title, version, summary }))
              close()
              viewed.viewEdit?.(saved.id, listId)
            } catch (err) {
              // Written, but its Save refused: the edit IS there — show it,
              // and say what was not done where the bar's refusals are said.
              if (!err?.savedRow) throw err
              close()
              viewed.viewEdit?.(err.savedRow.id, listId)
              onError(err.message)
            }
          }}
        />
      )}

      {dialog?.kind === 'discardEdit' && target && list && (
        <ListConfirm
          title="Discard changes?"
          confirmLabel="Discard changes"
          onCancel={close}
          onConfirm={() => inDialog(async () => { ctx.discardEditDraft(list.id); close() })}
        >
          {discardWords({ draft: target, basedOn: (ctx?.edits || []).find(e => e.id === target.basedOnEditId) || null })}
        </ListConfirm>
      )}

      {recoverable && !dialog && !pickerOpen && (
        <AnswerDialog
          title="Recover unsaved edit?"
          stayLabel="Not now"
          onStay={() => setPutOff(prev => new Set(prev).add(recoverable.listId))}
          answers={[
            { label: 'Discard edit', variant: 'danger', onClick: () => ctx.dismissStoredEditDraft(recoverable.listId) },
            ...(recoverList && !recoverList.archived_at ? [{
              label: 'Recover edit',
              variant: 'primary',
              onClick: async () => {
                if (draftHere && recoverable.listId !== list?.id && !(await confirmLeave('edit'))) return
                ctx.recoverEditDraft(recoverable.listId)
                showList(recoverable.listId)
              },
            }] : []),
          ]}
        >
          {recoverWords({ copy: recoverable, list: recoverList })}
        </AnswerDialog>
      )}

      {dialog?.kind === 'form' && (
        <ShotListForm
          mode={dialog.mode}
          source={formSource}
          lists={lists}
          counts={{
            screen: { scenes: viewed.scenes.length, shots: viewed.shots.length },
            all: { scenes: (allScenes || []).length, shots: (allShots || []).length },
          }}
          defaultFrom={defaultFrom}
          label={label}
          onSubmit={submitForm}
          onClose={close}
        />
      )}

      {dialog?.kind === 'setActive' && target && (
        <ListConfirm
          title="Make this the active list?"
          confirmLabel="Make active"
          variant="primary"
          onCancel={close}
          onConfirm={() => inDialog(async () => { await ctx.setActiveShotList(target.id); close() })}
        >
          {`“${label(target)}” becomes the list ${OTHER_TABS} show. ${SET_ACTIVE_KEEPS}`}
          {activeList && activeList.id !== target.id ? ` “${label(activeList)}” is not changed, and can be made active again.` : ''}
        </ListConfirm>
      )}

      {dialog?.kind === 'archive' && target && (
        <ListConfirm
          title="Archive this list?"
          confirmLabel="Archive"
          onCancel={close}
          onConfirm={() => inDialog(async () => { await ctx.archiveShotList(target.id, true); close() })}
        >
          {`“${label(target)}” moves to Archived in Shot lists. Nothing in it is deleted, and a project manager or a workspace admin can restore it. ${NOT_ACTIVE_KEEPS}`}
        </ListConfirm>
      )}

      {dialog?.kind === 'withdraw' && target && (
        <ListConfirm
          title="Withdraw this list?"
          confirmLabel="Withdraw"
          onCancel={close}
          onConfirm={() => inDialog(async () => { await ctx.withdrawShotList(target.id); close() })}
        >
          {/* Review round 1 (R1-15): "You made" only where the maker test
              applies — the Local Server has no users, and offers Withdraw
              on any untouched list. */}
          {`${makerUserId === undefined ? `Nobody has saved “${label(target)}” or started an edit on it, so it can be taken back.` : `You made “${label(target)}” and nobody has saved it or started an edit on it, so you can take it back.`} It is set aside, not deleted: it shows as “Recently removed” until you leave the Scenes tab, and stays in Shot lists under Archived. ${NOT_ACTIVE_KEEPS}`}
        </ListConfirm>
      )}

      {/* Post-overhaul S3c, step 3: an edit's own two questions. After
          either, the list on screen goes back to List order — the edit is
          set aside, and reads under Archived in Shot lists. */}
      {dialog?.kind === 'withdrawEdit' && target && (
        <ListConfirm
          title="Withdraw this edit?"
          confirmLabel="Withdraw"
          onCancel={close}
          onConfirm={() => inDialog(async () => { await ctx.withdrawEdit(target.id); close(); viewed.viewEdit?.(null) })}
        >
          {`${makerUserId === undefined ? `Nobody has continued “${label(target)}” with a newer edit, so it can be taken back.` : `You made “${label(target)}” and nobody has continued it with a newer edit, so you can take it back.`} It is set aside, not deleted: it shows as “Recently removed” until you leave the Scenes tab, and stays in Shot lists under its list's edits.`}
        </ListConfirm>
      )}

      {dialog?.kind === 'archiveEdit' && target && (
        <ListConfirm
          title="Archive this edit?"
          confirmLabel="Archive"
          onCancel={close}
          onConfirm={() => inDialog(async () => { await ctx.archiveEdit(target.id, true); close(); viewed.viewEdit?.(null) })}
        >
          {`“${label(target)}” is set aside: the list's edit selector stops offering it, and Shot lists shows it under its list's edits, archived. Nothing in it is deleted, and a project manager or a workspace admin can restore it.`}
        </ListConfirm>
      )}

      {dialog?.kind === 'clear' && target && (
        <ListConfirm
          title="Clear this list?"
          confirmLabel="Clear list"
          onCancel={close}
          onConfirm={() => inDialog(async () => {
            const own = (items || []).filter(i => i.shot_list_id === target.id)
            await ctx.removeFromShotList(target.id, {
              sceneIds: own.filter(i => i.scene_id).map(i => i.scene_id),
              shotIds: own.filter(i => i.shot_id).map(i => i.shot_id),
            })
            close()
          })}
        >
          {`Takes ${plural(rowsOf(target).scenes, 'scene')} and ${plural(rowsOf(target).shots, 'shot')} out of “${label(target)}”. Nothing is deleted: each stays in the project and in any other list that holds it. A list can be cleared only until it is first saved.${target.id === activeId ? ` ${activeListLeaves(false)}` : ''}`}
        </ListConfirm>
      )}

      {addFromOpen && (
        <AddFromListDialog
          targetLabel={label(list)}
          sources={addSources}
          defaultFrom={addDefault}
          rowsOf={addRowsOf}
          inList={onScreenSets}
          sceneById={ctx?.sceneById}
          shotById={ctx?.shotById}
          onAdd={(what) => inDialog(async () => { await ctx.addToShotList(list.id, what); close() })}
          onClose={close}
        />
      )}

      {removeAsk && (
        <ListConfirm
          title="Remove from this list?"
          confirmLabel="Remove from list"
          onCancel={remove.close}
          onConfirm={() => inDialog(async () => {
            await ctx.removeFromShotList(list.id, removeAsk.kind === 'scene' ? { sceneIds: removeAsk.ids } : { shotIds: removeAsk.ids })
            remove.close()
            removeAsk.done?.()
          })}
        >
          {removeWords}
        </ListConfirm>
      )}
    </>
  )
}
