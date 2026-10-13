// =============================================================================
// timelineVersionView.js — a bid version's schedule as the Timeline draws it
// while VIEWING it (post-overhaul S5d, step 2). Pure, so what a view shows is
// tested on its own (timelineVersionView.test.js).
//
// Audrey, F2 (2026-10-05): "viewing a version is read-only. to edit a version
// press "Edit this version"". Viewing writes nothing: nothing is set aside,
// nothing is brought back. The Timeline feeds what this returns through the
// SAME props and memos it draws the live rows with (`schedule` →
// `overviewSpan`), so going to a version and back to Current is a span move
// the gantt's re-anchoring keeps (S5p's rule): never a remount.
//
// What a view draws, and from where:
//   · its phases, tasks and key dates AS SAVED — the snapshot's own rows. The
//     live rows are never read by id for anything the snapshot holds: a task
//     set aside, renamed or re-dated since the save would otherwise show
//     today's title or dates (the brief's "facts that will bite");
//   · the dependency arrows between ITS rows, as those rows carry them now.
//     A version keeps no edges — they live on the rows themselves, so opening
//     the version (Edit this version) brings its rows back with exactly these
//     edges: the view shows what editing would load. An edge is kept only when
//     both its ends are rows of the version; the set-aside rows' edges count
//     (`setAsideDependencies`), or a version whose rows are off the Timeline
//     now would lose arrows a moment's Edit would show;
//   · a task's assignee: the version's own (versions keep it from S5d on), or —
//     for a version saved before, which cannot carry it — the row's as it is
//     now, the one thing such a snapshot cannot say (the brief: resolve only
//     what a snapshot cannot carry from live data).
// Names a snapshot does not hold — an asset's, a scene's, a level's, a
// person's — the row builders resolve from the project as it is now, and say
// "no longer in the project" where it is gone.
// =============================================================================

import { readVersion } from '../state/budgetVersionModel'

const idOf = (r) => (r && r.id != null ? String(r.id) : null)

/**
 * `version` (a budget_versions row) → { version, tasks, phases, milestones,
 * dependencies } for the Timeline's memos, or null when the version carries
 * no schedule (saved before S5: "no timeline captured", F1 — it cannot be
 * viewed). `live`: { tasks, setAsideTasks, dependencies, setAsideDependencies }
 * as the provider holds them.
 */
export function versionView(version, { tasks = [], setAsideTasks = [], dependencies = [], setAsideDependencies = [] } = {}) {
  if (!version) return null
  const r = readVersion(version)
  if (!r.hasTimeline) return null
  // The rows as they are now, by id — read for the assignee alone, and only
  // when the snapshot does not carry it. A live row wins over a set-aside one.
  const now = new Map()
  for (const t of [...(setAsideTasks || []), ...(tasks || [])]) {
    const id = idOf(t)
    if (id) now.set(id, t)
  }
  const viewTasks = []
  for (const t of r.tasks) {
    const id = idOf(t)
    if (!id) continue
    const row = { ...t }
    if (!Object.prototype.hasOwnProperty.call(t, 'assignee_id')) row.assignee_id = now.get(id)?.assignee_id ?? null
    viewTasks.push(row)
  }
  const viewPhases = r.phases.filter(idOf).map(p => ({ ...p }))
  const viewMilestones = r.milestones.filter(idOf).map(m => ({ ...m }))
  const held = { task: new Set(viewTasks.map(idOf)), phase: new Set(viewPhases.map(idOf)) }
  const seen = new Set()
  const edges = []
  for (const d of [...(dependencies || []), ...(setAsideDependencies || [])]) {
    if (!d) continue
    const ids = held[d.kind === 'phase' ? 'phase' : 'task']
    if (!ids.has(String(d.predecessor_id)) || !ids.has(String(d.successor_id))) continue
    const key = d.id != null ? String(d.id) : `${d.kind || 'task'}:${d.predecessor_id}>${d.successor_id}`
    if (seen.has(key)) continue
    seen.add(key)
    edges.push(d)
  }
  return { version, tasks: viewTasks, phases: viewPhases, milestones: viewMilestones, dependencies: edges }
}

/** Whether a version can be viewed on the Timeline (it carries a schedule). */
export function canViewVersion(version) {
  return !!version && readVersion(version).hasTimeline
}
