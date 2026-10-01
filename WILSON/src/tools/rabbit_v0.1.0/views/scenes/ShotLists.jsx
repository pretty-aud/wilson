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
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X, Archive, ArchiveRestore, Undo2, Eraser } from 'lucide-react'
import { Banner, IconButton } from '../../../../ui'
import ShotListBar from './ShotListBar'
import ListConfirm from './ListConfirm'
import { listSaveState, restoreRouteFor } from './shotListState'
import '../rabbitScenes.css'

const OTHER_TABS = 'the Timeline, Budget, Tasks, Assets, Bins and every other tab'

/**
 * ctx      useRabbit()
 * viewed   useViewedShotList(): { id, list, mode, scenes, shots, view }
 * gate     { write, writeReason, activate, activateReason }
 * userId   the signed-in user (usePermissions), for the maker's restore
 * error / onError   the Banner's sentence, owned by ScenesView
 */
export default function ShotLists({ ctx, viewed, gate, userId, error, onError }) {
  const [dialog, setDialog] = useState(null)
  const close = useCallback(() => setDialog(null), [])

  const lists = ctx?.shotLists || []
  const label = useCallback((row) => (ctx?.formatShotListLabel ? ctx.formatShotListLabel(row) : ''), [ctx])
  const activeList = ctx?.activeShotList || null
  const hasLiveList = lists.some(l => !l.archived_at)
  const list = viewed.list
  const items = ctx?.shotListItems
  const allScenes = ctx?.allScenes
  const allShots = ctx?.allShots
  const saveState = useMemo(
    () => (list ? listSaveState({ list, scenes: allScenes || [], shots: allShots || [], items: items || [] }) : null),
    [list, allScenes, allShots, items],
  )
  const ownItems = useMemo(() => (list ? (items || []).filter(i => i.shot_list_id === list.id) : []), [items, list])
  const isActive = viewed.mode === 'list' && !!activeList && activeList.id === list?.id
  // The provider's notion of "who made it" (RabbitProvider's withdrawUserId):
  // the signed-in user on a backend with users — the dev fixtures report
  // one too — and none on the Local Server, where the maker test is skipped.
  const makerUserId = ctx?.adapterMode === 'supabase' ? (userId || null) : undefined
  const restoreRoute = viewed.mode === 'archived'
    ? restoreRouteFor({ list, canActivate: gate.activate, canWrite: gate.write, makerUserId })
    : null
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
  /** Run a verb from the bar; its refusal goes to the Banner. */
  const run = useCallback(async (fn) => {
    try {
      onError(null)
      await fn()
    } catch (err) {
      const msg = err?.message || String(err)
      shown.current = msg
      onError(msg)
    }
  }, [onError])
  /** Run a verb from a dialog; its refusal stays in the dialog (rethrown). */
  const inDialog = useCallback(async (fn) => {
    try {
      await fn()
    } catch (err) {
      shown.current = err?.message || String(err)
      throw err
    }
  }, [])

  // ── the verbs ──
  const save = () => run(() => ctx.saveShotListSnapshot(list.id))
  const showList = (id) => viewed.view(id)
  const openRecent = () => { if (recent) viewed.view(recent.id, { archived: true }) }
  const restoreRecent = () => run(async () => {
    const id = recent?.id
    await ctx.restoreWithdrawn()
    if (id) viewed.view(id)
  })
  const restore = () => run(async () => {
    if (restoreRoute === 'archive') await ctx.archiveShotList(list.id, false)
    else await ctx.restoreWithdrawn({ kind: 'shot_list', id: list.id })
    // Restored, it is a list like any other: remember it.
    viewed.view(list.id)
  })

  const moreItems = []
  if (viewed.mode === 'list' && list) {
    const takeOut = []
    if (gate.write && saveState?.kind === 'never' && ownItems.length > 0) {
      takeOut.push({ label: 'Clear this list…', Icon: Eraser, onClick: () => setDialog({ kind: 'clear' }) })
    }
    if (gate.write && ctx?.canWithdrawShotList?.(list.id)) {
      takeOut.push({ label: 'Withdraw…', Icon: Undo2, onClick: () => setDialog({ kind: 'withdraw' }) })
    }
    if (!isActive) {
      takeOut.push(gate.activate
        ? { label: 'Archive…', Icon: Archive, onClick: () => setDialog({ kind: 'archive' }) }
        : { label: 'Archive…', Icon: Archive, disabled: true, hint: 'managers only' })
    }
    moreItems.push(...takeOut)
  } else if (viewed.mode === 'archived' && restoreRoute) {
    moreItems.push({ label: 'Restore', Icon: ArchiveRestore, onClick: restore })
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

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
          openPicker: () => setDialog({ kind: 'picker' }),
          save,
          saveAs: () => setDialog({ kind: 'form', mode: 'saveAs' }),
          setActive: () => setDialog({ kind: 'setActive' }),
          showList,
          openRecent,
          restoreRecent,
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

      {dialog?.kind === 'setActive' && list && (
        <ListConfirm
          title="Make this the active list?"
          confirmLabel="Make active"
          variant="primary"
          onCancel={close}
          onConfirm={() => inDialog(async () => { await ctx.setActiveShotList(list.id); close() })}
        >
          {`“${label(list)}” becomes the list ${OTHER_TABS} show.`}
          {activeList ? ` “${label(activeList)}” is not changed, and can be made active again.` : ''}
        </ListConfirm>
      )}

      {dialog?.kind === 'archive' && list && (
        <ListConfirm
          title="Archive this list?"
          confirmLabel="Archive"
          onCancel={close}
          onConfirm={() => inDialog(async () => { await ctx.archiveShotList(list.id, true); close() })}
        >
          {`“${label(list)}” moves to Archived in Shot lists. Nothing in it is deleted, and a project manager or a workspace admin can restore it.`}
        </ListConfirm>
      )}

      {dialog?.kind === 'withdraw' && list && (
        <ListConfirm
          title="Withdraw this list?"
          confirmLabel="Withdraw"
          onCancel={close}
          onConfirm={() => inDialog(async () => { await ctx.withdrawShotList(list.id); close() })}
        >
          {`You made “${label(list)}” and nobody has saved it or started an edit on it, so you can take it back. It is set aside, not deleted: it shows as “Recently removed” until you leave the Scenes tab, and stays in Shot lists under Archived.`}
        </ListConfirm>
      )}

      {dialog?.kind === 'clear' && list && (
        <ListConfirm
          title="Clear this list?"
          confirmLabel="Clear list"
          onCancel={close}
          onConfirm={() => inDialog(async () => {
            await ctx.removeFromShotList(list.id, {
              sceneIds: ownItems.filter(i => i.scene_id).map(i => i.scene_id),
              shotIds: ownItems.filter(i => i.shot_id).map(i => i.shot_id),
            })
            close()
          })}
        >
          {`Takes ${plural(viewed.scenes.length, 'scene')} and ${plural(viewed.shots.length, 'shot')} out of “${label(list)}”. Nothing is deleted: each stays in the project and in any other list that holds it. A list can be cleared only until it is first saved.`}
        </ListConfirm>
      )}
    </>
  )
}
