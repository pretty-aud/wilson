// =============================================================================
// MilestoneTrashModal — Track A bundle A2 session 2 (2026-09-07), ruling 38.
//
// "Recently deleted" for key dates, with Restore. Mounted by TimelineView,
// which owns the toolbar button that opens it — the same ownership shape as
// DependencyRewireModal / DetailPane — and, since Audrey's 2026-09-07
// decision, by ProjectTasksView too (`Deleted key dates`).
//
// WHY IT IS A PANEL AND NOT A FILTER ON THE TIMELINE. In cloud a trashed
// milestone is invisible to every table read by design: 0067's
// milestones_select carries `deleted_at IS NULL`, which is what keeps it off
// the Gantt. The rows here come from milestones_trash_index, a SECURITY
// DEFINER function, and on the desktop from the bundle's own trashed rows.
// Either way they are not in ctx.milestones and cannot be.
//
// The undo toast is the fast path (it fires on every delete); this is the slow
// one, for a key date deleted yesterday, in another session, or by someone
// else. Both had to exist — the toast is gone the moment it is dismissed.
//
// Merged over the UI overhaul (2026-09-29): the kit Dialog at the form width,
// on lane B4's list anatomy (`rb-warn-`, rabbitFiles.css), portalled into
// <body> as the lane's dialogs are; the kit brings the backdrop, Escape and
// the focus trap. A failed read or a refused restore is the Dialog's footer
// error (the kit's contract). Every message is unchanged; Restore is the kit
// Button behind the same GatedAction.
// =============================================================================

import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Undo2, Diamond } from 'lucide-react'
import GatedAction from '../../../permissions/GatedAction'
import { Dialog, Button, Loading } from '../../../ui'
import '../views/rabbitFiles.css'

// The retention that purge_soft_deleted() applies (0014 §4, default 30 days;
// milestones joined that sweep in 0067). The cloud sends purges_at outright;
// the desktop has no purge job at all, so this derives the same countdown from
// deleted_at and the panel says which case it is in.
const RETENTION_DAYS = 30

function daysLeft(row) {
  const at = row?.purges_at
    ? Date.parse(row.purges_at)
    : (row?.deleted_at ? Date.parse(row.deleted_at) + RETENTION_DAYS * 86400000 : NaN)
  if (!Number.isFinite(at)) return null
  return Math.max(0, Math.ceil((at - Date.now()) / 86400000))
}

function formatDeletedAt(value) {
  if (!value) return 'unknown'
  const t = Date.parse(value)
  if (!Number.isFinite(t)) return 'unknown'
  return new Date(t).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

// The timeline listens for mousedown to start drags, and React events bubble
// through a portal to the React ancestors: a press on this dialog's backdrop
// must not reach the gantt (the A2 session 1 lesson).
const stop = (e) => e.stopPropagation()

export default function MilestoneTrashModal({
  open,
  onClose,
  onList,
  onRestore,
  canWrite = true,
  writeReason = null,
  purgeScheduled = true,
  adapterMode = null,
}) {
  // Three states, not two. `undefined` = still loading; `null` = this storage
  // backend does not keep deleted key dates (googleDriveAdapter implements none
  // of the milestone methods); an array = a real answer, possibly empty. R1 of
  // this session found the first version collapsing the middle case into "the
  // trash is empty", which is the mistake unwrapOptionalTable's own comment
  // condemns — a backend that was never asked and a backend with nothing to
  // report gave the same answer.
  const [rows, setRows]       = useState(undefined)
  const [error, setError]     = useState(null)
  const [busyId, setBusyId]   = useState(null)

  // 🚨 A SEQUENCE GUARD, because a stale answer here is not merely stale.
  // Close the panel, switch project, reopen before the first request settles,
  // and the older resolution can land last — showing the PREVIOUS project's
  // deleted key dates, from which a Restore would act on that project's row by
  // id. Only the newest request may write state (R2).
  const runId = useRef(0)

  const load = useCallback(async () => {
    const mine = ++runId.current
    setError(null)
    try {
      const got = await onList?.()
      if (runId.current !== mine) return
      setRows(got === null || got === undefined ? null : got)
    } catch (err) {
      if (runId.current !== mine) return
      // A failed trash read must not read as an empty trash: "nothing here"
      // and "we could not look" are different answers and the second one is
      // the one worth acting on.
      setRows([])
      setError(err?.message || String(err))
    }
  }, [onList])

  useEffect(() => { if (open) { setRows(undefined); load() } }, [open, load])

  if (!open) return null

  const handleRestore = async (row) => {
    setBusyId(row.id)
    setError(null)
    try {
      const restored = await onRestore?.(row.id)
      // false is not an error: the adapter answers false when the row was
      // already live, which happens when someone else restored it first. Say
      // so rather than silently dropping the row from the list.
      if (restored === false) setError('That key date had already been restored.')
      await load()
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setBusyId(null)
    }
  }

  const node = (
    <div onMouseDown={stop} onClick={stop}>
      <Dialog
        width="form"
        title="Recently deleted key dates"
        dismissOnBackdrop
        onClose={onClose}
        error={error}
      >
        <div className="rb-warn-body">
          {rows === undefined && (
            <Loading label="Loading deleted key dates" />
          )}

          {rows === null && (
            // Named, the way EditHistoryDrawer and FileAuditDrawer name theirs.
            <p className="rb-warn-msg">
              This storage backend does not keep deleted key dates
              {adapterMode ? ` (${adapterMode})` : ''}.
            </p>
          )}

          {Array.isArray(rows) && rows.length === 0 && !error && (
            <p className="rb-warn-msg">
              Nothing here. Deleted key dates appear in this list.
            </p>
          )}

          {Array.isArray(rows) && rows.length > 0 && (
            <div className="rb-warn-tasks">
              <div className="rb-warn-list">
                {rows.map(row => {
                  const left = daysLeft(row)
                  return (
                    <div key={row.id} className="rb-warn-task">
                      {/* The key date's own colour is data, carried as a custom
                          property the sheet's rb-warn-glyph reads (as the Tasks
                          lane carries --rb-ms); a key date with no colour gets
                          the sheet's fallback, the warning amber the Timeline's
                          key dates use. The one style this file writes
                          (rabbitFilesCss.test.js, STYLES). */}
                      <Diamond
                        className="rb-warn-glyph"
                        aria-hidden="true"
                        style={{ '--rb-warn-glyph': row.color }}
                      />
                      <span className="rb-warn-task-title">
                        {row.title || 'Untitled key date'}
                        <span className="rb-warn-caption">
                          Deleted {formatDeletedAt(row.deleted_at)}
                          {purgeScheduled && left !== null
                            ? ` · removed for good in ${left} day${left === 1 ? '' : 's'}`
                            : ''}
                        </span>
                      </span>
                      <GatedAction allowed={canWrite} reason={writeReason}>
                        <Button
                          size="sm"
                          Icon={Undo2}
                          onClick={() => handleRestore(row)}
                          loading={busyId === row.id}
                          loadingLabel="Restoring…"
                        >
                          Restore
                        </Button>
                      </GatedAction>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </Dialog>
    </div>
  )

  // Portalled for the reason the rewire modal is: `position: fixed` inside the
  // timeline's scroll container is at the mercy of any transformed ancestor.
  return createPortal(node, document.body)
}
