// =============================================================================
// editHistoryRevert — pure planning for "revert to this state" (Session 7).
// No React, no adapter — unit-tested in editHistoryRevert.test.js.
//
// A revert is a NEW write expressed through the ordinary mutators, so it is
// itself captured in edit history (auditable) and undoable — no bespoke DB
// machinery. Semantics per entry:
//
//   update (plain)        → inverse patch: every diffed field back to .old
//   update (Deleted)      → restore via the trash RPC   (migration 0014)
//   update (Restored)     → soft delete via the trash RPC
//   create                → soft delete (the entity exists → trash it)
//   delete (hard, pre-0014 or purge) → recreate from the {old} snapshot
//
// Under LWW-per-field a revert does NOT try to rewind later edits — it
// applies the inverse of THIS entry as the newest write. That is the honest
// contract for collaborative editing: "put these fields back to what they
// were before this change", not "time-travel the row".
//
// Only entity types with full provider mutator coverage are revertable —
// the drawer hides the button elsewhere.
// =============================================================================

import { softDeleteTransition } from './editHistoryFormat'

// entity_type → mutator capability. Every listed table supports:
//   patch (update mutator), trash + restore (0014 RPCs), recreate (add* /
//   upsert keeps the original id, so child references survive).
// projects: recreate is impossible (createProject mints a fresh id — child
// rows would orphan), so hard-delete entries are not revertable there.
export const REVERTABLE_TABLES = {
  projects: { patch: true, trash: true, recreate: false },
  phases:   { patch: true, trash: true, recreate: true },
  assets:   { patch: true, trash: true, recreate: true },
  tasks:    { patch: true, trash: true, recreate: true },
}

// Columns that must never ride along on a revert write: server-managed
// audit stamps, identity/tenancy, and the trash columns (RPC-only — a
// plain UPDATE carrying deleted_at would violate the 0014 policies).
const EXCLUDED_FIELDS = new Set([
  'id', 'workspace_id',
  'created_at', 'created_by', 'updated_at', 'updated_by',
  'last_updated_at', 'last_updated_by',
  'deleted_at', 'deleted_by',
])

/**
 * Plan the revert for one history entry.
 * Returns one of:
 *   { kind: 'inverse-patch', table, id, patch, forwardPatch }
 *       patch        — every diffed field back to its .old value
 *       forwardPatch — the same fields at their .new values (what UNDOING
 *                      the revert re-applies; used where the executor
 *                      must push its own history entry)
 *   { kind: 'restore',       table, id }
 *   { kind: 'soft-delete',   table, id }
 *   { kind: 'recreate',      table, id, row }
 *   { kind: 'unsupported', reason }
 *   { kind: 'noop' }               — nothing revertable in the diff
 */
export function buildRevertPlan(entry) {
  if (!entry || !entry.entity_type || !entry.entity_id) {
    return { kind: 'unsupported', reason: 'malformed history entry' }
  }
  const table = entry.entity_type
  const caps = REVERTABLE_TABLES[table]
  if (!caps) {
    return { kind: 'unsupported', reason: `no revert support for ${table}` }
  }
  const id = entry.entity_id

  if (entry.action === 'update') {
    const transition = softDeleteTransition(entry)
    if (transition === 'deleted') {
      return caps.trash
        ? { kind: 'restore', table, id }
        : { kind: 'unsupported', reason: `no restore path for ${table}` }
    }
    if (transition === 'restored') {
      return caps.trash
        ? { kind: 'soft-delete', table, id }
        : { kind: 'unsupported', reason: `no trash path for ${table}` }
    }
    if (!caps.patch) {
      return { kind: 'unsupported', reason: `no update path for ${table}` }
    }
    const diff = entry.diff || {}
    const patch = {}
    const forwardPatch = {}
    for (const k of Object.keys(diff)) {
      if (EXCLUDED_FIELDS.has(k)) continue
      const cell = diff[k]
      if (!cell || typeof cell !== 'object' || !('old' in cell)) continue
      patch[k] = cell.old
      forwardPatch[k] = 'new' in cell ? cell.new : undefined
    }
    if (Object.keys(patch).length === 0) return { kind: 'noop' }
    return { kind: 'inverse-patch', table, id, patch, forwardPatch }
  }

  if (entry.action === 'create') {
    return caps.trash
      ? { kind: 'soft-delete', table, id }
      : { kind: 'unsupported', reason: `no trash path for ${table}` }
  }

  if (entry.action === 'delete') {
    if (!caps.recreate) {
      return { kind: 'unsupported', reason: `cannot recreate a hard-deleted ${table}` }
    }
    const snap = entry.diff?.old
    if (!snap || typeof snap !== 'object' || !snap.id) {
      return { kind: 'unsupported', reason: 'delete entry has no usable snapshot' }
    }
    const row = {}
    for (const k of Object.keys(snap)) {
      // id survives (recreate must keep it); audit + trash stamps do not.
      if (k !== 'id' && EXCLUDED_FIELDS.has(k)) continue
      row[k] = snap[k]
    }
    return { kind: 'recreate', table, id, row }
  }

  return { kind: 'unsupported', reason: `unknown action ${entry.action}` }
}

/**
 * Cheap drawer-side check: does this entry get a Revert button at all?
 * (Execution can still fail — row since purged, permissions, etc. — the
 * provider surfaces those as errors.)
 */
export function canRevertEntry(entry) {
  const plan = buildRevertPlan(entry)
  return plan.kind !== 'unsupported' && plan.kind !== 'noop'
}

/** Human label for the revert action, for the button title/confirm copy. */
export function revertActionLabel(entry) {
  const plan = buildRevertPlan(entry)
  switch (plan.kind) {
    case 'inverse-patch': return 'Revert these field changes'
    case 'restore':       return 'Restore (undo this delete)'
    case 'soft-delete':   return plan && entry.action === 'create'
      ? 'Delete (undo this create)'
      : 'Delete again (undo this restore)'
    case 'recreate':      return 'Recreate this entity'
    default:              return 'Revert'
  }
}
