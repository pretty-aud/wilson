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
import { X, Archive, ArchiveRestore, Undo2, Eraser, CheckCircle2, Pencil, ListPlus } from 'lucide-react'
import { Banner, IconButton } from '../../../../ui'
import { sortShotLists } from '../../state/shotListModel'
import ShotListBar from './ShotListBar'
import ShotListPicker from './ShotListPicker'
import ShotListForm from './ShotListForm'
import AddFromListDialog from './AddFromListDialog'
import ListConfirm from './ListConfirm'
import { listSaveState, restoreRouteFor } from './shotListState'
import { removeQuestion } from './membershipCopy'
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
 */
export default function ShotLists({ ctx, viewed, gate, userId, error, onError, remove }) {
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
  /** Run a verb from a question; its refusal stays in the question (rethrown). */
  const inDialog = useCallback(async (fn) => {
    try {
      await fn()
    } catch (err) {
      shown.current = err?.message || String(err)
      throw err
    }
  }, [])

  // ── the verbs ──
  const showList = (id, opts) => viewed.view(id, opts)
  const restoreRow = async (row) => {
    if (restoreRoute(row) === 'archive') await ctx.archiveShotList(row.id, false)
    else await ctx.restoreWithdrawn({ kind: 'shot_list', id: row.id })
  }
  const openRecent = () => { if (recent) { closePicker(); showList(recent.id, { archived: true }) } }
  const restoreRecent = (report) => report(async () => {
    const id = recent?.id
    await ctx.restoreWithdrawn()
    closePicker()
    if (id) showList(id)
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
    }
    if (!onScreen && !rowActive) {
      out.push(gate.activate
        ? { label: 'Set active', Icon: CheckCircle2, onClick: () => setDialog({ kind: 'setActive', row }) }
        : { label: 'Set active', Icon: CheckCircle2, disabled: true, hint: 'managers only' })
    }
    out.push(gate.write
      ? { label: 'Edit details…', Icon: Pencil, onClick: () => setDialog({ kind: 'form', mode: 'details', row }) }
      : { label: 'Edit details…', Icon: Pencil, disabled: true, hint: 'read-only' })
    // Review round 1 (R1-08): not on the ACTIVE list — clearing it empties
    // every other tab (D4 already keeps Archive off it), and every project's
    // backfilled "Shot list 1" is active and never saved. For Audrey: should
    // Clear ever reach the active list?
    if (gate.write && rowSave?.kind === 'never' && held && !rowActive) {
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

  const moreItems = viewed.mode === 'list' && list ? listVerbs(list, { onScreen: true })
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
        recent={recent}
        recentLabel={recent ? label(recent.row) : ''}
        gate={gate}
        on={{
          newList: () => setDialog({ kind: 'form', mode: 'new' }),
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
          showList: (id) => showList(id),
          openRecent,
          restoreRecent: () => restoreRecent(run),
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
          recent={recent}
          rowMenu={(row) => listVerbs(row, { onScreen: false })}
          restoreFor={(row) => (restoreRoute(row) ? () => runInPicker(() => restoreRow(row)) : null)}
          gate={gate}
          error={pickerError}
          on={{
            open: (id, opts) => { closePicker(); showList(id, opts) },
            openUnlisted: () => { closePicker(); showList(UNLISTED) },
            openRecent,
            restoreRecent: () => restoreRecent(runInPicker),
            newList: () => setDialog({ kind: 'form', mode: 'new' }),
            close: closePicker,
          }}
        />
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
          {`“${label(target)}” becomes the list ${OTHER_TABS} show.`}
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
          {`“${label(target)}” moves to Archived in Shot lists. Nothing in it is deleted, and a project manager or a workspace admin can restore it.`}
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
          {`${makerUserId === undefined ? `Nobody has saved “${label(target)}” or started an edit on it, so it can be taken back.` : `You made “${label(target)}” and nobody has saved it or started an edit on it, so you can take it back.`} It is set aside, not deleted: it shows as “Recently removed” until you leave the Scenes tab, and stays in Shot lists under Archived.`}
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
          {`Takes ${plural(rowsOf(target).scenes, 'scene')} and ${plural(rowsOf(target).shots, 'shot')} out of “${label(target)}”. Nothing is deleted: each stays in the project and in any other list that holds it. A list can be cleared only until it is first saved.`}
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
