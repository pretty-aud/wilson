// ─────────────────────────────────────────────────────────────────────────────
// FileAuditDrawer — Session 14, Block C (the Notion-style per-file audit).
//
// "Who touched this file, when": renders the file lifecycle stream —
// uploaded / moved / relinked / trashed / restored / purged — from
// adapter.listFileEvents(). In cloud mode that is the trigger-fed
// file_events table (migration 0027, readable by every project reader,
// not just admins — unlike edit_history); in local_server mode it is the
// bundle.fileEvents log the Express routes append to. This is
// TPN-CONT-002's chain-of-custody surface in product clothing.
//
// UX laws applied (Session 9 requirement, ≥5 named):
//   - Jakob's Law: same drawer anatomy as EditHistoryDrawer — users who
//     know one history surface already know this one.
//   - Law of Common Region: each event is one bordered card; the stream
//     is one scrollable region.
//   - Law of Similarity: event badges reuse the ACTION_META color language
//     (green = creation, orange = change, red = destruction).
//   - Cognitive Load / Chunking: one event = badge + actor + time + the
//     path change, nothing else; paths render old → new on their own lines.
//   - Selective Attention: 'purged' certificates get the red treatment so
//     the destructive fact is the one that stands out.
//   - Doherty Threshold: instant open with a loading state; refresh is
//     one click.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  X, RefreshCw, FileClock, Upload, MoveRight, Link2, Trash2, RotateCcw, Flame,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import { formatHistoryTimestamp } from './editHistoryFormat'

export const FILE_EVENT_META = {
  uploaded: { label: 'Uploaded', color: '#4ade80', Icon: Upload },
  moved:    { label: 'Moved',    color: '#fb923c', Icon: MoveRight },
  relinked: { label: 'Relinked', color: '#fb923c', Icon: Link2 },
  trashed:  { label: 'Trashed',  color: '#fca5a5', Icon: Trash2 },
  restored: { label: 'Restored', color: '#4ade80', Icon: RotateCcw },
  purged:   { label: 'Purged',   color: '#f87171', Icon: Flame },
}

export default function FileAuditDrawer({ fileId, projectId, fileName, onClose }) {
  const { getAdapter, adapterMode } = useRabbit()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  const supported = typeof getAdapter()?.listFileEvents === 'function'

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await getAdapter()?.listFileEvents?.(fileId, projectId) ?? []
      if (mountedRef.current) setEvents(rows)
    } catch (err) {
      if (mountedRef.current) setError(err.message || String(err))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [getAdapter, fileId, projectId])

  useEffect(() => { load() }, [load])

  return (
    <>
      <div className="fixed inset-0 z-[70]" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 z-[70] flex flex-col"
        style={{ width: 420, backgroundColor: '#1c1917', borderLeft: '2px solid #ea580c', boxShadow: '0 0 60px rgba(0,0,0,0.5)' }}
        role="dialog" aria-label="File activity">

        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
          style={{ backgroundColor: '#292524', borderBottom: '1px solid #44403c' }}>
          <FileClock className="w-4 h-4 flex-shrink-0" style={{ color: '#fb923c' }} />
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] font-mono uppercase tracking-wider font-bold" style={{ color: '#fb923c' }}>
              File activity
            </div>
            <div className="text-[10.5px] font-mono truncate" style={{ color: '#78716c' }}>
              {fileName || fileId}
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
          {!supported ? (
            <div className="text-[11.5px] font-mono px-3 py-4 rounded"
              style={{ color: '#78716c', backgroundColor: '#292524', border: '1px solid #44403c' }}>
              File activity is not recorded by the current adapter ({adapterMode}).
            </div>
          ) : error ? (
            <div className="text-[11.5px] font-mono px-3 py-4 rounded"
              style={{ color: '#fca5a5', backgroundColor: 'rgba(153,27,27,0.15)', border: '1px solid #7f1d1d' }}>
              Could not load file activity: {error}
            </div>
          ) : loading && events.length === 0 ? (
            <div className="text-[11.5px] font-mono px-3 py-4" style={{ color: '#78716c' }}>
              Loading…
            </div>
          ) : events.length === 0 ? (
            <div className="text-[11.5px] font-mono px-3 py-4" style={{ color: '#78716c' }}>
              No recorded activity for this file.
            </div>
          ) : (
            events.map(evt => <FileEventCard key={evt.id} evt={evt} />)
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 flex-shrink-0 text-[10px] font-mono"
          style={{ color: '#57534e', borderTop: '1px solid #44403c' }}>
          {adapterMode === 'supabase'
            ? 'Recorded server-side for every upload, move, relink, trash, restore and purge.'
            : 'Recorded locally for uploads, relinks and deletes in this project.'}
        </div>
      </div>
    </>
  )
}

function FileEventCard({ evt }) {
  const meta = FILE_EVENT_META[evt.event] || { label: evt.event, color: '#a8a29e', Icon: FileClock }
  const { Icon } = meta
  const actor = evt.actor_label || (evt.actor_user_id ? evt.actor_user_id.slice(0, 8) : 'system')
  return (
    <div className="rounded px-3 py-2.5 flex flex-col gap-1.5"
      style={{ backgroundColor: '#292524', border: '1px solid #44403c' }}>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-mono uppercase tracking-wider font-bold"
          style={{ color: meta.color, backgroundColor: `${meta.color}1a`, border: `1px solid ${meta.color}40` }}>
          <Icon className="w-3 h-3" /> {meta.label}
        </span>
        <span className="text-[10.5px] font-mono flex-1 truncate" style={{ color: '#a8a29e' }}>{actor}</span>
        <span className="text-[10px] font-mono flex-shrink-0" style={{ color: '#78716c' }}>
          {formatHistoryTimestamp(evt.created_at)}
        </span>
      </div>
      {(evt.old_path || evt.new_path) && (
        <div className="flex flex-col gap-0.5 text-[10px] font-mono" style={{ color: '#78716c' }}>
          {evt.old_path && (
            <span className="truncate" title={evt.old_path}>
              {evt.new_path ? <s style={{ opacity: 0.7 }}>{evt.old_path}</s> : evt.old_path}
            </span>
          )}
          {evt.new_path && (
            <span className="truncate" style={{ color: '#a8a29e' }} title={evt.new_path}>
              → {evt.new_path}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
