// =============================================================================
// dependencyStatus.js — Phase 7 (docs/fixes/phase-7-dependency-status-warning),
// Track A bundle A2, 2026-09-06.
//
// The ONE definition of "done", and the one predecessor check built on it.
//
// Before this file there were two copies of "done": `isTaskDone` in
// selectors.js (feeds the asset roll-up and the asset-status warning) and a
// module-private `isDone` in AssetStatusWarningModal.jsx (feeds that modal's
// list). They agreed by luck. The Phase 7 brief's own words: two definitions
// is a defect, not a style preference — the Create Egg bug (`form === 'ghost'`
// in one place, `ghost || corpse` in the other) and 0059 both came from a
// second copy drifting. Both consumers now import from here, and
// dependencyStatusSurfaces.test.js fails if a third copy appears.
//
// Pure: no React, no context, no adapter. Every function takes plain arrays,
// which is what lets the check be unit-tested in this repo, where nothing
// mounts a component (vitest.config.js is environment: 'node').
//
// Vocabulary — measured from the status <select>s, not assumed:
//   tasks  (TaskDetailPopup, ProjectTasksView, ProjectAssetsView, the
//           TimelineView task editor): waiting_to_start, in_progress,
//           pending_review, needs_revisions, approved, final, blocked,
//           on_hold, omitted
//   phases (0063; the TimelineView phase editor): not_started, active,
//           completed, delayed
// The two vocabularies do not overlap, so ONE set serves both kinds without a
// kind parameter: approved / final / omitted are the task done states (as
// selectors.js has always said), completed is the phase one. `omitted` counts
// as done on purpose — an omitted predecessor will never complete, and warning
// about it forever would train the reader to click through.
// =============================================================================

export const DONE_STATUSES = Object.freeze(['approved', 'final', 'omitted', 'completed'])
const DONE = new Set(DONE_STATUSES)

/** True when a status string means "this will not move again". */
export function isDoneStatus(status) {
  return DONE.has(status)
}

/** True when an item (task, asset or phase row) is in a done status. */
export function isDone(item) {
  return !!item && DONE.has(item.status)
}

// Which edge table a dependency row belongs to. The `dependencies` collection
// carries task→task AND phase→phase edges in one array; `kind` is the
// discriminator RabbitProvider.linkTasks / linkPhases stamp. Anything that is
// not literally 'phase' is a task edge — the same rule as
// supabaseAdapter.dependencyKind and DetailPane's `d.kind || 'task'`;
// dependencyStatus.test.js pins that the adapter's copy still agrees. Kept
// local so this module stays outside the adapter's import graph.
export function edgeKind(dep) {
  return dep?.kind === 'phase' ? 'phase' : 'task'
}

/**
 * The predecessors of one item that are NOT done.
 *
 * Every dependency the UI can create is finish-to-start (`dep_type` defaults
 * to 'FS' and no .jsx ever writes SS / FF / SF — measured by the Phase 7
 * brief on 2026-08-12 and again on 2026-09-06), so "the predecessor must be
 * done" is strictly correct today. If the UI ever exposes the other three
 * types this has to learn them: start-to-start does not need a finished
 * predecessor.
 *
 * An edge whose predecessor is not in the item list is ignored, the way every
 * consumer of the graph (visibleDeps, buildSchedule, selectCriticalPath)
 * already ignores edges with unknown endpoints.
 *
 * @returns {Array<object>} predecessor rows in edge order, each once; [] when none.
 */
export function unfinishedPredecessors({ id, kind = 'task', dependencies, tasks, phases }) {
  const pool = kind === 'phase' ? phases : tasks
  const byId = new Map()
  for (const row of pool || []) if (row && row.id != null) byId.set(row.id, row)
  const out = []
  const seen = new Set()
  for (const dep of dependencies || []) {
    if (!dep || dep.successor_id !== id) continue
    if (edgeKind(dep) !== kind) continue
    const pred = byId.get(dep.predecessor_id)
    if (!pred || isDone(pred) || seen.has(pred.id)) continue
    seen.add(pred.id)
    out.push(pred)
  }
  return out
}

/**
 * The warning for a status write, or null when there is nothing to say.
 *
 * Fires only for a move INTO a done status from a status that is not done —
 * approved → final is not a move to done, and a change that leaves the item
 * unfinished never needs a predecessor. Bulk writes pass every selected item
 * and get ONE result naming the offenders, so the caller shows one summary
 * instead of one modal per row.
 *
 * `dependencies` must be the loaded edge array. When it is not an array the
 * caller has no dependency data at all (the Dashboard's cross-project task
 * model is the case today) and the answer is null: the check cannot run,
 * which is a stated limit, not a clean bill of health.
 *
 * @returns {null | { kind, toStatus, total, offenders: Array<{ item, unfinished }> }}
 */
export function statusWarning({ items, kind = 'task', toStatus, dependencies, tasks, phases }) {
  if (!isDoneStatus(toStatus)) return null
  if (!Array.isArray(dependencies)) return null
  const list = Array.isArray(items) ? items.filter(Boolean) : []
  const offenders = []
  for (const item of list) {
    if (isDone(item)) continue
    const unfinished = unfinishedPredecessors({ id: item.id, kind, dependencies, tasks, phases })
    if (unfinished.length > 0) offenders.push({ item, unfinished })
  }
  if (offenders.length === 0) return null
  return { kind, toStatus, total: list.length, offenders }
}

/** Display name for a task or phase row; never empty. */
export function itemLabel(item, kind = 'task') {
  if (!item) return kind === 'phase' ? 'Untitled phase' : 'Untitled task'
  if (kind === 'phase') return item.name || 'Untitled phase'
  return item.title || item.assigned_position || 'Untitled task'
}

/** 'waiting_to_start' → 'Waiting to start'. */
export function humanStatus(status) {
  if (!status) return '—'
  const s = String(status).replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}
