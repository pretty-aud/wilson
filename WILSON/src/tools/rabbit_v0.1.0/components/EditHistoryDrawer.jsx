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
// UI overhaul B3c (TL-24): the kit Drawer, xl (420, B3c-KR-1), with its
// backdrop (a click there closed it, and still does) and Escape. It clears
// the Electron title bar through the kit's --titlebar-offset; it used to
// slide under it. It sits at the kit's z-index 60, above the entity detail
// popups (z-50) it is opened from; it was z-[70] to clear their nested
// pickers (z-[60]) too, which close when History is opened.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, RotateCcw, X } from 'lucide-react'
import { Drawer } from '../../../ui/Drawer'
import { IconButton } from '../../../ui/IconButton'
import { Banner } from '../../../ui/Banner'
import { Loading } from '../../../ui/Loading'
import { EmptyState } from '../../../ui/EmptyState'
import { useRabbit } from '../state/RabbitProvider'
import { usePermissions } from '../../../permissions/usePermissions'
import {
  ENTITY_LABELS, entryActionMeta, ACTION_META, RESTORE_META,
  diffLines, snapshotSummary, formatHistoryTimestamp, actorName,
} from './editHistoryFormat'
import { canRevertEntry, revertActionLabel } from './editHistoryRevert'
// UI overhaul B3: the turning icons and the action badge's colours are
// named variants in the Timeline lane's sheet.
import '../views/rabbitTimeline.css'

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
    <Drawer
      open
      onClose={onClose}
      backdrop
      width="xl"
      title="Edit history"
      label="Edit history"
      className="rb-hist"
      actions={
        <>
          <IconButton size="sm" title="Refresh" onClick={load}>
            <RefreshCw aria-hidden="true" className="rb-hist-spin" data-spinning={loading ? 'true' : 'false'} />
          </IconButton>
          <IconButton size="sm" icon={X} title="Close" onClick={onClose} />
        </>
      }
      footer={
        <p className="text-caption rb-hist-foot">
          History is kept for 90 days. Reverts are ordinary edits — they
          appear here too, and Ctrl+Z undoes them.
        </p>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="text-dense truncate rb-hist-entity">
          {ENTITY_LABELS[entityType] || entityType}{entityLabel ? ` · ${entityLabel}` : ''}
        </div>
        {!cloudMode ? (
          <Banner tone="info">
            Edit history is only recorded in cloud (supabase) mode. The
            current adapter ({adapterMode}) does not capture changes.
          </Banner>
        ) : error ? (
          <Banner tone="danger">Could not load history: {error}</Banner>
        ) : loading && entries.length === 0 ? (
          <Loading label="Loading history" />
        ) : entries.length === 0 ? (
          <EmptyState compact title="No recorded changes in the last 90 days." />
        ) : (
          <>
            {revertError && <Banner tone="danger">Revert failed: {revertError}</Banner>}
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
              <div className="text-caption px-3 py-2 text-center rb-hist-more">
                Showing the latest 100 changes — older entries exist within
                the retention window.
              </div>
            )}
          </>
        )}
      </div>
    </Drawer>
  )
}

function HistoryEntry({ entry, onRevert, reverting, disabled }) {
  // entryActionMeta classifies soft-delete transitions as Deleted / Restored.
  const meta = entryActionMeta(entry) || { label: entry.action }
  const lines = diffLines(entry)
  const summary = entry.action !== 'update' ? snapshotSummary(entry) : null

  return (
    <div className="rounded-control px-3 py-2.5 flex flex-col gap-1.5 rb-hist-entry">
      <div className="flex items-center gap-2">
        <span className="text-label uppercase font-semibold px-1.5 py-0.5 rounded-control flex-shrink-0 rb-hist-action"
          data-action={meta === ACTION_META.create ? 'create'
            : meta === ACTION_META.update ? 'update'
            : meta === ACTION_META.delete ? 'delete'
            : meta === RESTORE_META ? 'restore' : 'other'}>
          {meta.label}
        </span>
        <span className="text-dense font-semibold truncate flex-1 rb-hist-actor">
          {actorName(entry)}
        </span>
        <span className="text-dense font-mono tabular-nums flex-shrink-0 rb-hist-when">
          {formatHistoryTimestamp(entry.created_at)}
        </span>
        {onRevert && (
          <IconButton size="sm" title={revertActionLabel(entry)} onClick={() => onRevert(entry)} disabled={disabled}>
            <RotateCcw aria-hidden="true" className="rb-hist-spin" data-spinning={reverting ? 'true' : 'false'} />
          </IconButton>
        )}
      </div>

      {summary && (
        <div className="text-dense truncate rb-hist-summary" title={summary}>
          {summary}
        </div>
      )}

      {lines.length > 0 && (
        <div className="flex flex-col gap-1">
          {lines.map(l => (
            <div key={l.field} className="text-dense flex items-baseline gap-1.5 min-w-0">
              <span className="flex-shrink-0 rb-hist-field">{l.field}:</span>
              <span className="truncate rb-hist-from" title={l.from}>
                {l.from}
              </span>
              <span className="flex-shrink-0 rb-hist-arrow">&rarr;</span>
              <span className="truncate rb-hist-to" title={l.to}>{l.to}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
