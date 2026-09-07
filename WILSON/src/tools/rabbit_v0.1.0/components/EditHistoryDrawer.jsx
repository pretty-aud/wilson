// =============================================================================
// EditHistoryDrawer — right-side drawer showing edit_history rows for one
// RABBIT entity (Session 5, migration 0012). Session 7 adds per-entry
// "revert to this state": plain edits apply an inverse patch, Deleted
// entries restore via the trash RPC, Created/Restored entries soft-delete
// again, hard-delete snapshots recreate the row with its original id.
// Every revert routes through the ordinary provider mutators, so it is
// captured in history itself and undoable like any other edit.
//
// Data comes from adapter.listEditHistory(entityType, entityId) — supabase
// mode only; local_server / google_drive resolve to [] and we show the
// mode notice instead of an empty timeline. RLS already scopes reads to
// admin/manager in their own workspace; the rabbit.history.view/.revert
// gates on the UI are presentation-only, per the permissions layer's
// contract — the entity write policies are the enforcement.
//
// z-[70]: above the entity detail popups (z-50) and their nested pickers
// (z-[60]) so History can be opened on top of either.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { History, RefreshCw, RotateCcw, X } from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import { usePermissions } from '../../../permissions/usePermissions'
import {
  ENTITY_LABELS, entryActionMeta,
  diffLines, snapshotSummary, formatHistoryTimestamp, actorName,
} from './editHistoryFormat'
import { canRevertEntry, revertActionLabel } from './editHistoryRevert'

export default function EditHistoryDrawer({ entityType, entityId, entityLabel, onClose }) {
  const { getAdapter, adapterMode, revertHistoryEntry } = useRabbit()
  const { can } = usePermissions()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [revertingId, setRevertingId] = useState(null)
  const [revertError, setRevertError] = useState(null)
  const mountedRef = useRef(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await getAdapter()?.listEditHistory?.(entityType, entityId) ?? []
      if (mountedRef.current) setEntries(rows)
    } catch (err) {
      if (mountedRef.current) setError(err.message || String(err))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [getAdapter, entityType, entityId])

  useEffect(() => {
    // StrictMode-safe: the cleanup of the first dev mount strands false
    // unless the effect body resets it (same fix as useWorkspaceMembers).
    mountedRef.current = true
    load()
    return () => { mountedRef.current = false }
  }, [load])

  const cloudMode = adapterMode === 'supabase'
  const mayRevert = cloudMode
    && typeof revertHistoryEntry === 'function'
    && can('rabbit.history.revert')

  const handleRevert = useCallback(async (entry) => {
    if (revertingId != null) return
    setRevertingId(entry.id)
    setRevertError(null)
    try {
      await revertHistoryEntry(entry)
      if (mountedRef.current) await load() // the revert wrote new history
    } catch (err) {
      if (mountedRef.current) setRevertError(err.message || String(err))
    } finally {
      if (mountedRef.current) setRevertingId(null)
    }
  }, [revertingId, revertHistoryEntry, load])

  return (
    <>
      <div className="fixed inset-0 z-[70]" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 z-[70] flex flex-col"
        style={{ width: 420, backgroundColor: '#1c1917', borderLeft: '2px solid #ea580c', boxShadow: '0 0 60px rgba(0,0,0,0.5)' }}
        role="dialog" aria-label="Edit history">

        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
          style={{ backgroundColor: '#292524', borderBottom: '1px solid #44403c' }}>
          <History className="w-4 h-4 flex-shrink-0" style={{ color: '#fb923c' }} />
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] font-mono uppercase tracking-wider font-bold" style={{ color: '#fb923c' }}>
              Edit history
            </div>
            <div className="text-[10.5px] font-mono truncate" style={{ color: '#78716c' }}>
              {ENTITY_LABELS[entityType] || entityType}{entityLabel ? ` · ${entityLabel}` : ''}
            </div>
          </div>
          <button type="button" onClick={load} title="Refresh"
            className="p-1.5 rounded hover:bg-stone-700 transition-colors flex-shrink-0" style={{ color: '#a8a29e' }}>
            <RefreshCw className={`w-3.5 h-3.5${loading ? ' animate-spin' : ''}`} />
          </button>
          <button type="button" onClick={onClose} title="Close"
            className="p-1.5 rounded hover:bg-stone-700 transition-colors flex-shrink-0" style={{ color: '#a8a29e' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
          {!cloudMode ? (
            <div className="text-[11.5px] font-mono px-3 py-4 rounded"
              style={{ color: '#78716c', backgroundColor: '#292524', border: '1px solid #44403c' }}>
              Edit history is only recorded in cloud (supabase) mode. The
              current adapter ({adapterMode}) does not capture changes.
            </div>
          ) : error ? (
            <div className="text-[11.5px] font-mono px-3 py-4 rounded"
              style={{ color: '#fca5a5', backgroundColor: 'rgba(153,27,27,0.15)', border: '1px solid #7f1d1d' }}>
              Could not load history: {error}
            </div>
          ) : loading && entries.length === 0 ? (
            <div className="text-[11.5px] font-mono px-3 py-4" style={{ color: '#78716c' }}>
              Loading…
            </div>
          ) : entries.length === 0 ? (
            <div className="text-[11.5px] font-mono px-3 py-4" style={{ color: '#78716c' }}>
              No recorded changes in the last 90 days.
            </div>
          ) : (
            <>
              {revertError && (
                <div className="text-[11px] font-mono px-3 py-2 rounded"
                  style={{ color: '#fca5a5', backgroundColor: 'rgba(153,27,27,0.15)', border: '1px solid #7f1d1d' }}>
                  Revert failed: {revertError}
                </div>
              )}
              {entries.map(entry => (
                <HistoryEntry
                  key={entry.id}
                  entry={entry}
                  onRevert={mayRevert && canRevertEntry(entry) ? handleRevert : null}
                  reverting={revertingId === entry.id}
                  disabled={revertingId != null}
                />
              ))}
              {entries.length >= 100 && (
                <div className="text-[10.5px] font-mono px-3 py-2 text-center" style={{ color: '#78716c' }}>
                  Showing the latest 100 changes — older entries exist within
                  the retention window.
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 flex-shrink-0 text-[10px] font-mono"
          style={{ color: '#57534e', borderTop: '1px solid #44403c' }}>
          History is kept for 90 days. Reverts are ordinary edits — they
          appear here too, and Ctrl+Z undoes them.
        </div>
      </div>
    </>
  )
}

function HistoryEntry({ entry, onRevert, reverting, disabled }) {
  // entryActionMeta classifies soft-delete transitions as Deleted / Restored.
  const meta = entryActionMeta(entry) || { label: entry.action, color: '#a8a29e' }
  const lines = diffLines(entry)
  const summary = entry.action !== 'update' ? snapshotSummary(entry) : null

  return (
    <div className="rounded px-3 py-2.5 flex flex-col gap-1.5"
      style={{ backgroundColor: '#292524', border: '1px solid #44403c' }}>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-sm flex-shrink-0"
          style={{ color: meta.color, border: `1px solid ${meta.color}`, opacity: 0.9 }}>
          {meta.label}
        </span>
        <span className="text-[11.5px] font-mono font-semibold truncate flex-1" style={{ color: '#d6d3d1' }}>
          {actorName(entry)}
        </span>
        <span className="text-[10px] font-mono flex-shrink-0" style={{ color: '#78716c' }}>
          {formatHistoryTimestamp(entry.created_at)}
        </span>
        {onRevert && (
          <button
            type="button"
            onClick={() => onRevert(entry)}
            disabled={disabled}
            title={revertActionLabel(entry)}
            className="p-1 rounded hover:bg-stone-700 transition-colors flex-shrink-0 disabled:opacity-40"
            style={{ color: '#fb923c' }}
          >
            <RotateCcw className={`w-3.5 h-3.5${reverting ? ' animate-spin' : ''}`} />
          </button>
        )}
      </div>

      {summary && (
        <div className="text-[11px] font-mono truncate" style={{ color: '#a8a29e' }} title={summary}>
          {summary}
        </div>
      )}

      {lines.length > 0 && (
        <div className="flex flex-col gap-1">
          {lines.map(l => (
            <div key={l.field} className="text-[11px] font-mono flex items-baseline gap-1.5 min-w-0">
              <span className="flex-shrink-0" style={{ color: '#78716c' }}>{l.field}:</span>
              <span className="truncate" style={{ color: '#a8a29e', textDecoration: 'line-through', textDecorationColor: '#57534e' }} title={l.from}>
                {l.from}
              </span>
              <span className="flex-shrink-0" style={{ color: '#57534e' }}>&rarr;</span>
              <span className="truncate" style={{ color: '#d6d3d1' }} title={l.to}>{l.to}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
