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

import { byMilestoneDate } from './milestoneOrder'
import { splitSetAside, joinSetAside, hasSetAside } from './setAside'
import { compareViewRows, compareGroupingRows, groupingKeyOf } from './tableViewsModel'

// Post-overhaul S5b (0090): the tables whose rows can be SET ASIDE by the open
// bid version, or hang off one that is (the edges). An event on one of them
// is applied over EVERY row — the live and the set-aside — and the bundle is
// split again after, so a row another window set aside leaves this one's
// live schedule (with its edges), and one it brought back returns.
const SET_ASIDE_TABLES = new Set(['tasks', 'phases', 'milestones', 'task_dependencies', 'phase_dependencies'])

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
  // 0077: key dates, and KEY DATES ONLY. Audrey ruled on 2026-09-07 that
  // milestones live-sync between windows the way tasks do, and that scenes,
  // shots, levels and experiences deliberately KEEP the reload limit — a
  // conscious difference, not an oversight, recorded as one in
  // SYSTEMS_HANDBOOK §4.5 and §13.3. Adding any of those four here without
  // its arm in the broadcast trigger would be worse than the limit it
  // replaced: the merge would stand ready for events the database never
  // sends, and nothing would ever say so.
  milestones:         'milestones',
  // Bins on the cloud (BC1, 0091 §8; Audrey's B7: "a flag or a take
  // assignment appears for everyone without reloading"). The three project
  // tables joined fn_realtime_broadcast's project_id arm, each with its
  // trigger — the migration's post-conditions pin all three, so this merge
  // never stands ready for an event the database does not send.
  // bin_locations is a WORKSPACE table and is not broadcast (a location is
  // named once; the client re-reads the list on open).
  bins:               'bins',
  bin_files:          'binFiles',
  shot_takes:         'shotTakes',
  // FX2 (0096): a task's items joined the project_id arm (sixteen tables);
  // 0096's post-conditions pin it, so this merge never stands ready for an
  // event the database does not send. NOT task_links (the URL links above).
  task_items:         'taskItems',
  // VW1c (0098): the views and the groupings joined the project_id arm
  // (eighteen tables; her Q3d: a teammate's save reaches an open table at
  // once); 0098's post-condition 11g and suite 101 pin both.
  table_views:        'tableViews',
  item_groupings:     'itemGroupings',
}

// FX2 (0096): a broadcast row is the WHOLE table row, and task_items carries
// five GENERATED columns (asset_id … experience_id) that no other backend has
// and no reader uses; they are dropped so a live row has the shape a load
// gives (the adapter selects without them).
const TASK_ITEM_GENERATED = ['asset_id', 'scene_id', 'shot_id', 'level_id', 'experience_id']
function shapeTaskItem(table, row) {
  if (table !== 'task_items' || !row || typeof row !== 'object') return row
  const out = { ...row }
  for (const k of TASK_ITEM_GENERATED) delete out[k]
  return out
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

// Collections whose render order is an invariant of the LOAD, each with the
// comparator that produces it — so a live insert or update lands where a
// reload would have put it.
//
// 🚨 This was a Set of names and one hardcoded sort_order comparator until
// 0077. Key dates order by DATE, not by sort_order (they carry the column and
// ignore it), so adding 'milestones' to the old Set would have re-sorted every
// live key date into the wrong place — a defect visible only on the OTHER
// window, and only until its next reload. ProjectTasksView renders milestone
// rows in array order, so this is a real position on a real screen.
const bySortOrder = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
// BC1: the cloud's listBins orders bins and files by (sort_order, id) and
// takes by (shot, position, id); a live insert lands where a reload would
// put it. The id tie-break keeps two rows at one sort_order stable.
const bySortOrderThenId = (a, b) => bySortOrder(a, b) || String(a.id).localeCompare(String(b.id))
const byShotPositionId = (a, b) => String(a.shot_id).localeCompare(String(b.shot_id))
  || ((a.position ?? 0) - (b.position ?? 0)) || String(a.id).localeCompare(String(b.id))

// VW1c (0098): the loads' orders, stated once in tableViewsModel — views by
// table, then the dropdown's own order (position, created_at, id), groupings
// by table, kind, created_at, id — so a live row lands where a reload puts it.
const COLLECTION_ORDER = {
  phases:     bySortOrder,
  assets:     bySortOrder,
  milestones: byMilestoneDate,
  bins:       bySortOrderThenId,
  binFiles:   bySortOrderThenId,
  shotTakes:  byShotPositionId,
  tableViews:    compareViewRows,
  itemGroupings: compareGroupingRows,
}

// Collections whose rows can hide NOTHING when they are trashed, so a remote
// RESTORE of one needs no refetch. MEASURED, not assumed: on 2026-09-07
// `pg_constraint` on dev reported no foreign key anywhere in the schema whose
// confrelid is public.milestones, so a key date has no children to bring back.
//
// Only milestones are listed. Files, comments and the link tables are probably
// leaves too, but "probably" is not a measurement and the refetch they get is
// pre-existing behaviour this change has no business altering. R1 raised the
// cost: without this, pressing Restore in the trash panel reloads the WHOLE
// project in every open window — twice in the window that pressed it, since
// restoreMilestone already re-lists — on a routine gesture that the live-sync
// work exists to make cheap.
const LEAF_COLLECTIONS = new Set(['milestones'])

function isTrashed(row) {
  return row != null && row.deleted_at != null
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

function upsertInto(rows, incoming, pendingFields, compare) {
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
  // An UPDATE re-sorts as well as an INSERT: moving a key date's date, or a
  // phase's sort_order, moves its row.
  return compare ? next.slice().sort(compare) : next
}

/**
 * Remove a row plus the local mirror of the cascades the views rely on —
 * the same shapes the delete mutators apply locally (deleteTask also drops
 * its dependency edges; deletePhase its). In the DB the children were never
 * touched (transitive hiding via live-parent SELECT policies), which is why
 * remote restores refetch instead of reinserting.
 *
 * VW1m (2026-10-16), her Q-M2 ("The tasks stay"): an asset's soft or hard
 * delete from another window never drops a task (its arm here took the tasks
 * whose MAIN asset it was, as 0034's cascade and asset hop did; 0097 sets
 * the key null and sees a task through its own project). The asset alone
 * goes, by the default arm; its task items stay, hidden while it is in the
 * trash (her Q-N4), and a hard delete's CASCADE on them arrives as their own
 * task_items DELETE events.
 */
function removeWithMirror(bundle, table, id) {
  switch (table) {
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
 *   { type: 'versions-refetch' }              — another window moved the OPEN
 *                                               bid version (S5b), or saved, made
 *                                               or deleted one (R1, S5-02: 0101's
 *                                               thin budget_versions event), so
 *                                               this window re-reads them
 */
export function applyRealtimeEvent(bundle, evt, opts = {}) {
  if (evt && SET_ASIDE_TABLES.has(evt.table)) {
    const stamped = (r) => r != null && r.set_aside_at != null
    if (hasSetAside(bundle) || stamped(evt.record) || stamped(evt.oldRecord)) {
      const res = applyEventCore(joinSetAside(bundle), evt, opts)
      if (res.bundle === null) return { bundle, effects: res.effects }
      return { bundle: splitSetAside(res.bundle), effects: res.effects }
    }
  }
  const res = applyEventCore(bundle, evt, opts)
  return res.bundle === null ? { bundle, effects: res.effects } : res
}

// The event logic itself, unaware of set-aside rows (applyRealtimeEvent above
// hands it every row and splits after). Answers bundle: null for "nothing
// changed", so the caller keeps its own identities.
function applyEventCore(bundle, evt, opts = {}) {
  const noop = { bundle: null, effects: [] }
  if (!evt || !evt.table || !evt.op) return noop
  const { table, op } = evt
  // 0061: stamp the dependency `kind` from the source table before anything
  // reads the row. Non-dependency tables pass through untouched.
  const record    = shapeTaskItem(table, stampKindFromTable(table, evt.record    ?? null))
  const oldRecord = shapeTaskItem(table, stampKindFromTable(table, evt.oldRecord ?? null))
  const pending   = typeof opts.pendingFields === 'function' ? opts.pendingFields : () => null

  // ── roster: lives outside the bundle — signal only ──────────────────────
  if (table === 'project_members') {
    return { bundle, effects: [{ type: 'roster' }] }
  }

  // ── bid versions: a signal only (R1, S5-02). 0101 sends a version's id and
  // project, never its row (a bid version is money, and this channel is every
  // reader's): the versions are read again, through RLS.
  if (table === 'budget_versions') {
    return { bundle, effects: [{ type: 'versions-refetch' }] }
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
      // S5b: another window opened (or closed) a bid version. Its rows
      // arrive here one by one, but the versions themselves are not
      // broadcast, so this window re-reads them — or it would measure
      // "unsaved changes" against a version that is no longer the open one.
      // This window's own write echoes back with the pointer it already
      // holds, and asks for nothing.
      if ((record?.open_budget_version_id ?? null) !== (bundle.project.open_budget_version_id ?? null)) {
        effects.push({ type: 'versions-refetch' })
      }
      const merged = mergeRow(bundle.project, record, pending('projects', id))
      if (merged !== bundle.project) {
        return { bundle: { ...bundle, project: merged }, effects }
      }
    }
    return { bundle, effects }
  }

  const col = TABLE_TO_COLLECTION[table]
  if (!col) return noop
  const compare = COLLECTION_ORDER[col] || null
  const rows = bundle[col] || []

  if (op === 'INSERT') {
    if (!record?.id || isTrashed(record)) return noop
    // FX2 (0096): a task names an item once (the unique key). A row this
    // window holds for the same (task, kind, entity) under ANOTHER id — its
    // own add that the database answered with a collaborator's row — gives
    // way to the stored one, or the item would show twice.
    // VW1c (0098): a grouping is unique by (table, kind, set) the same way —
    // this window's own add, answered with a teammate's stored row, gives way.
    const base = col === 'taskItems'
      ? rows.filter(r => r.id === record.id || !(r.task_id === record.task_id
        && r.entity_type === record.entity_type && r.entity_id === record.entity_id))
      : col === 'itemGroupings'
        ? rows.filter(r => r.id === record.id || !(r.table_key === record.table_key
          && r.kind === record.kind && groupingKeyOf(r.entity_ids) === groupingKeyOf(record.entity_ids)))
        : rows
    return { bundle: { ...bundle, [col]: upsertInto(base, record, pending(table, record.id), compare) }, effects: [] }
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
      // Restore: the row returns; hidden children (dependency edges under a
      // restored task; a restored asset's comments and versions, which 0014
      // and 0004 see through it) need a refetch — they were never trashed in
      // the DB, only hidden transitively. A leaf has none, so it takes the
      // row back and nothing else (see LEAF_COLLECTIONS). VW1m (2026-10-16):
      // an asset's tasks are no longer among them (0097: a task is seen
      // through its own project, and this merge never dropped them), and its
      // task items never left this window (hidden while it was in the trash).
      return {
        bundle: { ...bundle, [col]: upsertInto(rows, record, pending(table, record.id), compare) },
        effects: LEAF_COLLECTIONS.has(col) ? [] : [{ type: 'refetch' }],
      }
    }
    const next = upsertInto(rows, record, pending(table, record.id), compare)
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
