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

export const ACTION_META = {
  create: { label: 'Created', color: '#4ade80' },
  update: { label: 'Edited',  color: '#fb923c' },
  delete: { label: 'Deleted', color: '#fca5a5' },
}

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

/**
 * Per-field change lines for an 'update' row:
 * [{ field, from, to }] sorted by field name. Empty for create/delete.
 */
export function diffLines(entry) {
  if (!entry || entry.action !== 'update' || !entry.diff) return []
  return Object.keys(entry.diff)
    .filter(k => !HIDDEN_FIELDS.has(k))
    .sort()
    .map(k => ({
      field: k,
      from: displayValue(entry.diff[k]?.old),
      to:   displayValue(entry.diff[k]?.new),
    }))
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
