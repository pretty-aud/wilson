// =============================================================================
// realtimeMerge — pure event-application logic for Session 7 live sync.
// No React, no adapter — unit-tested in realtimeMerge.test.js.
//
// Events arrive from the per-project broadcast channel (migration 0016:
// fn_realtime_broadcast → realtime.broadcast_changes) already normalized by
// the adapter to:
//
//   { table, op: 'INSERT'|'UPDATE'|'DELETE', record, oldRecord }
//
// record/oldRecord are FULL rows (or null on the missing side) — this is the
// broadcast payload shape, and the reason broadcast was chosen over
// postgres_changes: soft-delete UPDATEs deliver here, where postgres_changes
// would withhold them (the new row fails the subscriber's SELECT policy —
// the Session 6 lesson applied to realtime).
//
// LWW per field (locked decision) is realized as:
//   * writes go to the DB as per-field patches (adapter patch* methods), so
//     the row in Postgres is already a per-field last-writer-wins merge;
//   * incoming rows replace local state field-by-field EXCEPT fields with a
//     pending (in-flight) local write — those keep the local value until the
//     write settles and re-broadcasts;
//   * a row-level stale guard drops events whose updated_at is older than
//     the local row's (out-of-order delivery).
//
// applyRealtimeEvent is PURE: (bundle, event, opts) → { bundle, effects }.
// It never touches the adapter; side-effects are returned as descriptors the
// provider executes (refetches, roster refresh, project teardown).
// =============================================================================

// Bundle collection per broadcast table. project_members and projects are
// handled specially (roster slice / index + bundle.project).
export const TABLE_TO_COLLECTION = {
  phases:             'phases',
  assets:             'assets',
  tasks:              'tasks',
  files:              'files',
  comments:           'comments',
  task_dependencies:  'dependencies',
  // 0061: phase→phase edges live in their own table but share the collection.
  phase_dependencies: 'dependencies',
  task_links:         'taskLinks',
  asset_versions:     'assetVersions',
}

// 0061: `kind` is not a column on either edge table — it is implied by WHICH
// TABLE the row came from, and the adapter's loader stamps it on read. A
// broadcast payload arrives straight from the DB trigger, so it carries no
// kind at all and must be stamped here too.
//
// 🚨 Miss this and a phase edge created by a collaborator arrives as
// `kind: undefined`, DetailPane reads it as `d.kind || 'task'`, looks the
// endpoints up in rowIndexByTaskId, misses, and draws nothing. The edge is in
// local state and on screen it does not exist — and it would appear correctly
// for that user after a reload, which is the worst possible bug shape.
const DEPENDENCY_KIND_BY_TABLE = {
  task_dependencies:  'task',
  phase_dependencies: 'phase',
}

export function stampKindFromTable(table, row) {
  const kind = DEPENDENCY_KIND_BY_TABLE[table]
  return kind && row ? { ...row, kind } : row
}

// Collections whose render order comes from sort_order at load time
// (adapter list* calls ORDER BY sort_order) — keep that invariant after
// live inserts/updates.
const SORTED_COLLECTIONS = new Set(['phases', 'assets'])

function isTrashed(row) {
  return row != null && row.deleted_at != null
}

function sortByOrder(rows) {
  return rows.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
}

/**
 * Row-level out-of-order guard: true when the incoming row is strictly
 * older than the local one. Tables without updated_at (files, comments,
 * link tables) never trip it.
 */
export function isStaleIncoming(current, incoming) {
  if (!current?.updated_at || !incoming?.updated_at) return false
  const a = Date.parse(current.updated_at)
  const b = Date.parse(incoming.updated_at)
  if (Number.isNaN(a) || Number.isNaN(b)) return false
  return b < a
}

/**
 * Per-field LWW merge of an incoming full row over the local row.
 * `pendingFields` (Set|null) holds fields with in-flight local writes —
 * the local value wins for those until the write settles.
 */
export function mergeRow(current, incoming, pendingFields) {
  if (!current) return incoming
  if (isStaleIncoming(current, incoming)) return current
  if (!pendingFields || pendingFields.size === 0) {
    return { ...current, ...incoming }
  }
  const next = { ...current }
  for (const k of Object.keys(incoming)) {
    if (!pendingFields.has(k)) next[k] = incoming[k]
  }
  return next
}

function upsertInto(rows, incoming, pendingFields, sorted) {
  const idx = rows.findIndex(r => r.id === incoming.id)
  let next
  if (idx === -1) {
    next = [...rows, incoming]
  } else {
    const merged = mergeRow(rows[idx], incoming, pendingFields)
    if (merged === rows[idx]) return rows // stale event — no new array
    next = rows.slice()
    next[idx] = merged
  }
  return sorted ? sortByOrder(next) : next
}

/**
 * Remove a row plus the local mirror of the cascades the views rely on —
 * the same shapes the delete mutators apply locally (deleteAsset also drops
 * its tasks; deleteTask also drops its dependency edges). In the DB the
 * children were never touched (transitive hiding via live-parent SELECT
 * policies), which is why remote restores refetch instead of reinserting.
 */
function removeWithMirror(bundle, table, id) {
  switch (table) {
    case 'assets':
      return {
        ...bundle,
        assets: bundle.assets.filter(a => a.id !== id),
        tasks:  bundle.tasks.filter(t => t.asset_id !== id),
      }
    case 'tasks':
      return {
        ...bundle,
        tasks: bundle.tasks.filter(t => t.id !== id),
        dependencies: (bundle.dependencies || []).filter(
          d => d.predecessor_id !== id && d.successor_id !== id,
        ),
      }
    // 0061: the phase mirror of the case above. Before 0061 a phase edge could
    // not exist in cloud, so there was nothing to prune and no case here; now
    // there is. Matches RabbitProvider.deletePhase, which does the same locally.
    case 'phases':
      return {
        ...bundle,
        phases: bundle.phases.filter(p => p.id !== id),
        dependencies: (bundle.dependencies || []).filter(
          d => d.predecessor_id !== id && d.successor_id !== id,
        ),
      }
    default: {
      const col = TABLE_TO_COLLECTION[table]
      if (!col) return bundle
      return { ...bundle, [col]: (bundle[col] || []).filter(r => r.id !== id) }
    }
  }
}

/**
 * Apply one normalized broadcast event to the bundle.
 *
 * opts:
 *   pendingFields(table, id) → Set<string>|null — in-flight local writes
 *   activeProjectId          → the open project (topic owner)
 *
 * Returns { bundle, effects } where effects ⊆
 *   { type: 'roster' }                        — project_members changed
 *   { type: 'project-patch', record }         — index entry needs merging
 *   { type: 'project-trashed', id }           — project soft/hard deleted
 *   { type: 'refetch' }                       — container restored; children
 *                                               must be refetched (debounced)
 */
export function applyRealtimeEvent(bundle, evt, opts = {}) {
  const noop = { bundle, effects: [] }
  if (!evt || !evt.table || !evt.op) return noop
  const { table, op } = evt
  // 0061: stamp the dependency `kind` from the source table before anything
  // reads the row. Non-dependency tables pass through untouched.
  const record    = stampKindFromTable(table, evt.record    ?? null)
  const oldRecord = stampKindFromTable(table, evt.oldRecord ?? null)
  const pending   = typeof opts.pendingFields === 'function' ? opts.pendingFields : () => null

  // ── roster: lives outside the bundle — signal only ──────────────────────
  if (table === 'project_members') {
    return { bundle, effects: [{ type: 'roster' }] }
  }

  // ── projects: the topic's own row → bundle.project + index effects ──────
  if (table === 'projects') {
    const id = record?.id ?? oldRecord?.id
    if (!id) return noop
    if (op === 'DELETE' || (op === 'UPDATE' && isTrashed(record))) {
      return { bundle, effects: [{ type: 'project-trashed', id }] }
    }
    if (op === 'UPDATE' && isTrashed(oldRecord) && !isTrashed(record)) {
      // Restore of the topic project. Normally unreachable (a trashed
      // project's client already tore down), but harmless to honor.
      return { bundle, effects: [{ type: 'project-patch', record }, { type: 'refetch' }] }
    }
    if (op === 'INSERT') {
      return { bundle, effects: [{ type: 'project-patch', record }] }
    }
    const effects = [{ type: 'project-patch', record }]
    if (bundle.project?.id === id) {
      const merged = mergeRow(bundle.project, record, pending('projects', id))
      if (merged !== bundle.project) {
        return { bundle: { ...bundle, project: merged }, effects }
      }
    }
    return { bundle, effects }
  }

  const col = TABLE_TO_COLLECTION[table]
  if (!col) return noop
  const sorted = SORTED_COLLECTIONS.has(col)
  const rows = bundle[col] || []

  if (op === 'INSERT') {
    if (!record?.id || isTrashed(record)) return noop
    return { bundle: { ...bundle, [col]: upsertInto(rows, record, pending(table, record.id), sorted) }, effects: [] }
  }

  if (op === 'DELETE') {
    const id = oldRecord?.id ?? record?.id
    if (!id) return noop
    return { bundle: removeWithMirror(bundle, table, id), effects: [] }
  }

  if (op === 'UPDATE') {
    if (!record?.id) return noop
    const wasTrashed = isTrashed(oldRecord)
    const nowTrashed = isTrashed(record)
    if (nowTrashed && !wasTrashed) {
      return { bundle: removeWithMirror(bundle, table, record.id), effects: [] }
    }
    if (nowTrashed) return noop // trashed → still trashed (purge stamps etc.)
    if (wasTrashed) {
      // Restore: the row returns; hidden children (tasks under a restored
      // asset, dependency edges under a restored task) need a refetch —
      // they were never trashed in the DB, only hidden transitively.
      return {
        bundle: { ...bundle, [col]: upsertInto(rows, record, pending(table, record.id), sorted) },
        effects: [{ type: 'refetch' }],
      }
    }
    const next = upsertInto(rows, record, pending(table, record.id), sorted)
    if (next === rows) return noop
    return { bundle: { ...bundle, [col]: next }, effects: [] }
  }

  return noop
}

/**
 * Normalize the raw supabase-js broadcast message payload
 * ({ operation, table, schema, record, old_record }) to the event shape
 * applyRealtimeEvent consumes. Null for anything malformed.
 */
export function normalizeBroadcastPayload(payload) {
  if (!payload || typeof payload !== 'object') return null
  const { table, operation } = payload
  if (!table || !operation) return null
  return {
    table,
    op: operation,
    record:    payload.record     ?? null,
    oldRecord: payload.old_record ?? null,
  }
}
