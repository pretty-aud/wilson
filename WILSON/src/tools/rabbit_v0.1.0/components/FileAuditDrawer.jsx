// ─────────────────────────────────────────────────────────────────────────────
// FileAuditDrawer — Session 14, Block C (the Notion-style per-file audit).
//
// "Who touched this file, when": renders the file lifecycle stream —
// uploaded / downloaded / moved / relinked / trashed / restored / purged —
// from adapter.listFileEvents(). In cloud mode that is the trigger-fed
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
//
// UI overhaul B4c, surface 7 (2026-09-25): the kit Drawer (R4-12), right,
// xl (420, its width), on lane B4's sheet, rabbitFiles.css (`rb-audit-`) —
// EditHistoryDrawer's anatomy, as the Jakob's Law line above promises. The
// kit brings the Electron title bar's offset (the panel ran under it), the
// raised paper and its hairline, Escape, and the backdrop whose click still
// closes it; Refresh and Close are the kit's named IconButtons. The title is
// "File activity" in sentence case (it was set in capitals). The file's name
// sits under the header, in the mono; the unsupported and error notices are
// the kit Banner, the wait the kit Loading, the empty stream the kit
// EmptyState; each event a card on the paper under one hairline, its badge
// the kit Badge in the tone of the colour language above — creation the
// success ink, a change ink-2, destruction the danger ink, a read ink-3 (the
// signal orange is the one active treatment now, so "change" is no longer
// orange; trashed and purged share the one danger token, the flame and the
// word still set a purge apart). No window.confirm here.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  X, RefreshCw, FileClock, Upload, Download, MoveRight, Link2, Trash2, RotateCcw, Flame,
} from 'lucide-react'
import { Drawer, IconButton, Badge, Banner, Loading, EmptyState } from '../../../ui'
import '../views/rabbitFiles.css'
import { useRabbit } from '../state/RabbitProvider'
import { formatHistoryTimestamp } from './editHistoryFormat'

// `tone` is the badge's place in the colour language, read by the sheet
// (`data-tone`): create | change | destroy | read.
export const FILE_EVENT_META = {
  uploaded:   { label: 'Uploaded',   tone: 'create',  Icon: Upload },
  // S33 (0047): a read, not a change — the quiet ink, outside the
  // creation/change/destruction language on purpose.
  downloaded: { label: 'Downloaded', tone: 'read',    Icon: Download },
  moved:      { label: 'Moved',      tone: 'change',  Icon: MoveRight },
  relinked:   { label: 'Relinked',   tone: 'change',  Icon: Link2 },
  trashed:    { label: 'Trashed',    tone: 'destroy', Icon: Trash2 },
  restored:   { label: 'Restored',   tone: 'create',  Icon: RotateCcw },
  purged:     { label: 'Purged',     tone: 'destroy', Icon: Flame },
}

export default function FileAuditDrawer({ fileId, projectId, fileName, onClose }) {
  const { getAdapter, adapterMode } = useRabbit()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)
  // StrictMode-safe (EditHistoryDrawer's fix): React's dev double mount runs
  // this cleanup once before the real mount, and a body that did not set the
  // flag back left it false — so in a dev build every answer was dropped and
  // the drawer said "Loading…" for ever. A production build mounts once and
  // is unchanged.
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

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
    <Drawer
      open
      onClose={onClose}
      backdrop
      side="right"
      width="xl"
      label="File activity"
      title="File activity"
      actions={(
        <>
          {/* The glyph turns while the stream loads. */}
          <IconButton size="sm" title="Refresh" onClick={load}>
            <RefreshCw aria-hidden="true" className="rb-audit-spin" data-spinning={loading ? 'true' : 'false'} />
          </IconButton>
          <IconButton size="sm" icon={X} title="Close" onClick={onClose} />
        </>
      )}
      footer={(
        <p className="rb-audit-foot">
          {adapterMode === 'supabase'
            ? 'Recorded server-side for every upload, move, relink, trash, restore and purge.'
            : 'Recorded locally for uploads, relinks and deletes in this project.'}
        </p>
      )}
    >
      <div className="rb-audit-body">
        <div className="rb-audit-file">
          {fileName || fileId}
        </div>
        {!supported ? (
          <Banner tone="info">
            File activity is not recorded by the current adapter ({adapterMode}).
          </Banner>
        ) : error ? (
          <Banner tone="danger">
            Could not load file activity: {error}
          </Banner>
        ) : loading && events.length === 0 ? (
          <Loading label="Loading…" />
        ) : events.length === 0 ? (
          <EmptyState compact title="No recorded activity for this file." />
        ) : (
          events.map(evt => <FileEventCard key={evt.id} evt={evt} />)
        )}
      </div>
    </Drawer>
  )
}

function FileEventCard({ evt }) {
  const meta = FILE_EVENT_META[evt.event] || { label: evt.event, tone: 'other', Icon: FileClock }
  const actor = evt.actor_label || (evt.actor_user_id ? evt.actor_user_id.slice(0, 8) : 'system')
  return (
    <div className="rb-audit-entry">
      <div className="rb-audit-entry-head">
        <Badge className="rb-audit-event" data-tone={meta.tone} Icon={meta.Icon}>
          {meta.label}
        </Badge>
        <span className="rb-audit-actor">{actor}</span>
        <span className="rb-audit-when">
          {formatHistoryTimestamp(evt.created_at)}
        </span>
      </div>
      {(evt.old_path || evt.new_path) && (
        <div className="rb-audit-paths">
          {evt.old_path && (
            <span className="rb-audit-path" title={evt.old_path}>
              {/* Struck through when the file moved on from it. */}
              {evt.new_path ? <s className="rb-audit-from">{evt.old_path}</s> : evt.old_path}
            </span>
          )}
          {evt.new_path && (
            <span className="rb-audit-path rb-audit-to" title={evt.new_path}>
              → {evt.new_path}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
