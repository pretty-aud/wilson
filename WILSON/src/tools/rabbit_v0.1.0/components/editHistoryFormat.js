// =============================================================================
// editHistoryFormat — pure helpers for rendering edit_history rows
// (Session 5, migration 0012). No React, no adapter — unit-tested in
// editHistoryFormat.test.js.
//
// A history row looks like:
//   { action: 'create'|'update'|'delete', actor_label, actor_user_id,
//     entity_type, entity_id, diff, created_at }
// with diff shapes:
//   create → { new: {...row} }        (nulls stripped server-side)
//   delete → { old: {...row} }
//   update → { col: { old, new }, ... }  (audit-noise columns excluded)
// =============================================================================

import { LINK_FIELDS } from '../state/taskItemsModel'

// The action's colour is the drawer's CSS (`.rb-hist-action[data-action]` on
// the success / ink-2 / danger tokens); P1-66 deleted the `color` hexes this
// table carried and nothing read.
export const ACTION_META = {
  create: { label: 'Created' },
  update: { label: 'Edited' },
  delete: { label: 'Deleted' },
}

// Soft delete / restore (Session 6, migration 0014): the deleted_at flip is
// captured as an ordinary 'update' diff, and HIDDEN_FIELDS suppresses the
// raw deleted_at/deleted_by lines — without the entryActionMeta() relabel
// the row would render as an empty edit. RESTORE_META has no matching DB
// action; it exists only for this client-side relabel.
export const RESTORE_META = { label: 'Restored' }

// Friendly singular labels for the 13 RABBIT entity_type table names.
export const ENTITY_LABELS = {
  projects:          'project',
  phases:            'phase',
  assets:            'asset',
  tasks:             'task',
  files:             'file',
  comments:          'comment',
  rate_cards:        'rate card',
  rate_card_entries: 'rate card entry',
  asset_versions:    'asset version',
  task_dependencies: 'task dependency',
  task_links:        'task link',
  ingestion_runs:    'ingestion run',
  ingestion_chunks:  'ingestion chunk',
}

// Bookkeeping columns that carry no meaning for a human reading history.
const HIDDEN_FIELDS = new Set([
  'id', 'workspace_id', 'project_id',
  'created_at', 'created_by', 'updated_at', 'updated_by',
  'last_updated_at', 'last_updated_by', 'deleted_at', 'deleted_by',
])

// Fields most likely to identify a row to a human, in preference order.
const HEADLINE_FIELDS = ['title', 'name', 'label', 'body', 'url', 'role_label', 'version_no', 'status']

function displayValue(v) {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

// VW1m (2026-10-16), Q-N8 (batch 16, not yet asked; interim: no history of
// a task's items). Review round 1 (R1-2): a task's single link columns
// (asset_id, scene_id, shot_id, level_id, experience_id) are the older apps'
// copy of its items, which the cloud still writes whenever a kind's first
// item changes (0097 section 7a) and 0012's capture records as a task edit.
// Read in words, removing the first of two assets said "Asset: Lighthouse
// -> Lantern", a swap that never happened. They show no line, old or new; an
// entry with nothing else to say is not shown (historyEntryShown). They have
// no Revert (editHistoryRevert.js). Another table's field of the same name
// keeps its line.
const TASK_LINK_COLUMNS = new Set(LINK_FIELDS)
const isTaskLinkColumn = (entry, k) => entry?.entity_type === 'tasks' && TASK_LINK_COLUMNS.has(k)

/**
 * Per-field change lines for an 'update' row:
 * [{ field, from, to }] sorted by field name. Empty for create/delete.
 * A task's link columns have no line (R1-2).
 */
export function diffLines(entry) {
  if (!entry || entry.action !== 'update' || !entry.diff) return []
  return Object.keys(entry.diff)
    .filter(k => !HIDDEN_FIELDS.has(k) && !isTaskLinkColumn(entry, k))
    .sort()
    .map(k => ({
      field: k,
      from: displayValue(entry.diff[k]?.old),
      to:   displayValue(entry.diff[k]?.new),
    }))
}

/**
 * Whether the drawer shows a history row at all (R1-2): every row but a
 * task's 'update' whose only changes were its link columns, which would read
 * as an empty edit. A soft delete or restore among them still shows (its
 * badge says it).
 */
export function historyEntryShown(entry) {
  if (!entry || entry.action !== 'update' || !entry.diff || entry.entity_type !== 'tasks') return true
  if (!Object.keys(entry.diff).some(k => TASK_LINK_COLUMNS.has(k))) return true
  return diffLines(entry).length > 0 || softDeleteTransition(entry) != null
}

/**
 * Soft-delete transition inside an 'update' row: 'deleted' when the diff
 * flips deleted_at null→set, 'restored' for set→null, else null.
 */
export function softDeleteTransition(entry) {
  if (!entry || entry.action !== 'update') return null
  const d = entry.diff?.deleted_at
  if (!d || typeof d !== 'object') return null
  const wasLive = d.old === null || d.old === undefined
  const isLive  = d.new === null || d.new === undefined
  if (wasLive && !isLive) return 'deleted'
  if (!wasLive && isLive) return 'restored'
  return null
}

/**
 * Action meta for a history row — ACTION_META keyed by action, except the
 * soft-delete transitions, which relabel as Deleted (delete styling) /
 * Restored.
 */
export function entryActionMeta(entry) {
  const transition = softDeleteTransition(entry)
  if (transition === 'deleted')  return ACTION_META.delete
  if (transition === 'restored') return RESTORE_META
  return ACTION_META[entry?.action] || { label: entry?.action || '' }
}

/**
 * Short identifying summary for a create/delete snapshot — the first
 * headline-ish field present, e.g. 'Comp shot 010'. Null when nothing
 * presentable exists.
 */
export function snapshotSummary(entry) {
  const snap = entry?.diff?.new ?? entry?.diff?.old
  if (!snap || typeof snap !== 'object') return null
  for (const f of HEADLINE_FIELDS) {
    if (snap[f] !== null && snap[f] !== undefined && snap[f] !== '') {
      return String(snap[f])
    }
  }
  return null
}

/** 'Jul 28, 2026, 2:14 AM' — absolute; history is an audit surface, not chat. */
export function formatHistoryTimestamp(iso) {
  if (iso === null || iso === undefined || iso === '') return ''
  const d = new Date(iso)
  // new Date(null) is the epoch, so nullish must be handled above.
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

/** Actor for display: captured label, else 'System' (service/migration writes). */
export function actorName(entry) {
  return entry?.actor_label || (entry?.actor_user_id ? 'Former member' : 'System')
}
