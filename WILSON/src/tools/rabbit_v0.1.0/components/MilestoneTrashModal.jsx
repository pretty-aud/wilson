// =============================================================================
// MilestoneTrashModal — Track A bundle A2 session 2 (2026-09-07), ruling 38.
//
// "Recently deleted" for key dates, with Restore. Mounted by TimelineView,
// which owns the toolbar button that opens it — the same ownership shape as
// DependencyRewireModal / DetailPane.
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
// =============================================================================

import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Trash2, Undo2, X, Diamond } from 'lucide-react'
import GatedAction from '../../../permissions/GatedAction'

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

export default function MilestoneTrashModal({
  open,
  onClose,
  onList,
  onRestore,
  canWrite = true,
  writeReason = null,
  purgeScheduled = true,
}) {
  const [rows, setRows]       = useState(null)   // null = still loading
  const [error, setError]     = useState(null)
  const [busyId, setBusyId]   = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setRows((await onList?.()) || [])
    } catch (err) {
      // A failed trash read must not read as an empty trash: "nothing here"
      // and "we could not look" are different answers and the second one is
      // the one worth acting on.
      setRows([])
      setError(err?.message || String(err))
    }
  }, [onList])

  useEffect(() => { if (open) { setRows(null); load() } }, [open, load])

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
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(28, 25, 23, 0.78)' }}
      // The timeline listens for mousedown to start drags; a click on this
      // backdrop must not reach it (the A2 session 1 lesson).
      onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose?.() }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="rounded-sm flex flex-col w-full max-w-lg"
        style={{ backgroundColor: '#292524', border: '1px solid #44403c', maxHeight: '70vh' }}
      >
        <div
          className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
          style={{ borderBottom: '1px solid #44403c', backgroundColor: '#1c1917' }}
        >
          <Trash2 className="w-3.5 h-3.5" style={{ color: '#f59e0b' }} />
          <span
            className="text-[10.5px] font-mono uppercase tracking-widest font-bold flex-1"
            style={{ color: '#f59e0b' }}
          >
            Recently deleted key dates
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-sm transition-colors hover:bg-stone-800"
            style={{ color: '#a8a29e' }}
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="px-4 py-3 overflow-y-auto flex flex-col gap-2 text-[11.5px] font-mono">
          {rows === null && (
            <p style={{ color: '#78716c' }}>Loading…</p>
          )}

          {rows !== null && rows.length === 0 && !error && (
            <p style={{ color: '#78716c' }}>
              Nothing here. Deleted key dates appear in this list.
            </p>
          )}

          {rows !== null && rows.map(row => {
            const left = daysLeft(row)
            return (
              <div
                key={row.id}
                className="flex items-center gap-3 px-3 py-2 rounded-sm"
                style={{ backgroundColor: '#1c1917', border: '1px solid #44403c' }}
              >
                <Diamond
                  className="w-3 h-3 flex-shrink-0"
                  style={{ color: row.color || '#f59e0b' }}
                />
                <div className="flex-1 min-w-0">
                  <div className="truncate" style={{ color: '#d6d3d1' }}>
                    {row.title || 'Untitled key date'}
                  </div>
                  <div className="text-[10px] mt-0.5" style={{ color: '#78716c' }}>
                    Deleted {formatDeletedAt(row.deleted_at)}
                    {purgeScheduled && left !== null
                      ? ` · removed for good in ${left} day${left === 1 ? '' : 's'}`
                      : ''}
                  </div>
                </div>
                <GatedAction allowed={canWrite} reason={writeReason}>
                  <button
                    type="button"
                    onClick={() => handleRestore(row)}
                    disabled={busyId === row.id}
                    className="flex items-center gap-1 px-2.5 py-1 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-stone-800 flex-shrink-0"
                    style={{
                      color:  busyId === row.id ? '#78716c' : '#f59e0b',
                      cursor: busyId === row.id ? 'wait' : 'pointer',
                    }}
                  >
                    <Undo2 className="w-3 h-3" />
                    Restore
                  </button>
                </GatedAction>
              </div>
            )
          })}

          {error && (
            <p style={{ color: '#fb923c' }}>{error}</p>
          )}
        </div>
      </div>
    </div>
  )

  // Portalled for the reason the rewire modal is: `position: fixed` inside the
  // timeline's scroll container is at the mercy of any transformed ancestor.
  return createPortal(node, document.body)
}
