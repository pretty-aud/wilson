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
import { X, Archive, ArchiveRestore, Undo2, Eraser, CheckCircle2, Pencil } from 'lucide-react'
import { Banner, IconButton } from '../../../../ui'
import ShotListBar from './ShotListBar'
import ShotListPicker from './ShotListPicker'
import ShotListForm from './ShotListForm'
import ListConfirm from './ListConfirm'
import { listSaveState, restoreRouteFor } from './shotListState'
import { UNLISTED } from './useViewedShotList'
import '../rabbitScenes.css'

const OTHER_TABS = 'the Timeline, Budget, Tasks, Assets, Bins and every other tab'
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * ctx      useRabbit()
 * viewed   useViewedShotList(): { id, list, mode, scenes, shots, view }
 * gate     { write, writeReason, activate, activateReason }
 * userId   the signed-in user (usePermissions), for the maker's restore
 * error / onError   the Banner's sentence, owned by ScenesView
 */
export default function ShotLists({ ctx, viewed, gate, userId, error, onError }) {
  // The picker, and over it (or alone) one question or form: { kind, row }.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerError, setPickerError] = useState(null)
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
  const listVerbs = (row, { onScreen }) => {
    const out = []
    const rowActive = row.id === activeId
    const rowSave = onScreen ? saveState : listSaveState({ list: row, scenes: allScenes || [], shots: allShots || [], items: items || [] })
    const held = (items || []).some(i => i.shot_list_id === row.id)
    if (!onScreen && !rowActive) {
      out.push(gate.activate
        ? { label: 'Set active', Icon: CheckCircle2, onClick: () => setDialog({ kind: 'setActive', row }) }
        : { label: 'Set active', Icon: CheckCircle2, disabled: true, hint: 'managers only' })
    }
    out.push(gate.write
      ? { label: 'Edit details…', Icon: Pencil, onClick: () => setDialog({ kind: 'form', mode: 'details', row }) }
      : { label: 'Edit details…', Icon: Pencil, disabled: true, hint: 'read-only' })
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

  return (
    <>
      <ShotListBar
        viewed={viewed}
        label={list ? label(list) : ''}
        activeList={activeList}
        activeLabel={activeList ? label(activeList) : ''}
        hasLiveList={hasLiveList}
        saveState={saveState}
        withdrawn={!!(list && ctx?.isWithdrawn?.(list))}
        recent={recent}
        recentLabel={recent ? label(recent.row) : ''}
        gate={gate}
        on={{
          newList: () => setDialog({ kind: 'form', mode: 'new' }),
          openPicker: () => { setPickerError(null); setPickerOpen(true) },
          save: () => run(() => ctx.saveShotListSnapshot(list.id)),
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
          {`You made “${label(target)}” and nobody has saved it or started an edit on it, so you can take it back. It is set aside, not deleted: it shows as “Recently removed” until you leave the Scenes tab, and stays in Shot lists under Archived.`}
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
    </>
  )
}
