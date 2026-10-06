// =============================================================================
// setAside.js — rows SET ASIDE by the open bid version (post-overhaul S5b,
// step 0; migration 0090). Pure: the three adapters, the fixtures, the
// realtime merge, the provider and the questions all read one answer.
//
// Audrey's ruling (a) of 2026-10-05: each bid version shows exactly its own
// schedule. Opening a version makes the live Timeline and Budget equal to it;
// tasks, phases and key dates it does not hold are SET ASIDE (`set_aside_at`)
// — kept whole (comments, files, links, dependencies, assignments, logged
// days, scene and shot links), never in a trash, never purged — and come
// back, the same rows, when a version that holds them is opened. The design:
// docs/sessions/handoffs/po-s5b-2026-10-05.md, "Step 0".
//
//   splitSetAside    a loaded bundle → the LIVE arrays (tasks, phases,
//                    milestones, dependencies) + the four set-aside keys.
//                    Every reader of ctx.tasks / phases / milestones /
//                    dependencies therefore hides them without being changed.
//   joinSetAside     the reverse, for code that must see every row
//   holdersOf        the saved versions that can bring a row back
//   workOn           what a row carries that a person made or the Budget
//                    counts: logged days, comments, files (constraint 4)
//   removalOf        Remove from this version, or Delete (constraint 9)
//   rowsInNoVersion  live rows no saved version holds (constraint 8)
// =============================================================================

import { readVersion } from './budgetVersionModel'

/** The bundle keys the set-aside rows travel under (EMPTY_BUNDLE has each). */
export const SET_ASIDE_KEYS = Object.freeze({
  tasks: 'setAsideTasks',
  phases: 'setAsidePhases',
  milestones: 'setAsideMilestones',
  dependencies: 'setAsideDependencies',
})

/** A row is set aside when it carries the stamp and is not in the trash (a trashed row never is). */
export function isSetAside(row) {
  return !!row && row.set_aside_at != null && row.set_aside_at !== '' && row.deleted_at == null
}

// Split one collection, keeping each array's identity when nothing moved (the
// realtime merge splits after every event; a new array would re-render every
// reader of ctx.tasks for a comment arriving).
function splitRows(live, aside) {
  const L = live || []
  const A = aside || []
  let moved = false
  const liveOut = []
  const asideOut = []
  for (const r of L) {
    if (isSetAside(r)) { asideOut.push(r); moved = true } else liveOut.push(r)
  }
  for (const r of A) {
    if (isSetAside(r)) asideOut.push(r); else { liveOut.push(r); moved = true }
  }
  return {
    live: moved ? liveOut : L,
    aside: moved || asideOut.length !== A.length ? asideOut : A,
  }
}

/**
 * A loaded (or merged) bundle with its set-aside rows split out. Edges
 * touching a set-aside task or phase leave `dependencies` too — they would
 * draw to nothing and count in the dependency checks — and come back with it.
 * A bundle that never had a set-aside row comes back with the same arrays.
 */
export function splitSetAside(bundle) {
  if (!bundle || typeof bundle !== 'object') return bundle
  const t = splitRows(bundle.tasks, bundle.setAsideTasks)
  const p = splitRows(bundle.phases, bundle.setAsidePhases)
  const m = splitRows(bundle.milestones, bundle.setAsideMilestones)
  const asideIds = new Set([...t.aside, ...p.aside].map(r => String(r.id)))
  const deps = bundle.dependencies || []
  const asideDeps = bundle.setAsideDependencies || []
  let liveDeps = deps
  let nextAsideDeps = asideDeps
  if (asideIds.size || asideDeps.length) {
    const touches = (d) => asideIds.has(String(d?.predecessor_id)) || asideIds.has(String(d?.successor_id))
    const all = [...deps, ...asideDeps]
    const keep = all.filter(d => !touches(d))
    const away = all.filter(touches)
    liveDeps = keep.length === deps.length && keep.every((d, i) => d === deps[i]) ? deps : keep
    nextAsideDeps = away.length === asideDeps.length && away.every((d, i) => d === asideDeps[i]) ? asideDeps : away
  }
  return {
    ...bundle,
    tasks: t.live,
    phases: p.live,
    milestones: m.live,
    dependencies: liveDeps,
    [SET_ASIDE_KEYS.tasks]: t.aside,
    [SET_ASIDE_KEYS.phases]: p.aside,
    [SET_ASIDE_KEYS.milestones]: m.aside,
    [SET_ASIDE_KEYS.dependencies]: nextAsideDeps,
  }
}

/** Every row, live and set aside, in one array per collection (the four set-aside keys empty). */
export function joinSetAside(bundle) {
  if (!bundle || typeof bundle !== 'object') return bundle
  const join = (a, b) => (b && b.length ? [...(a || []), ...b] : (a || []))
  return {
    ...bundle,
    tasks: join(bundle.tasks, bundle.setAsideTasks),
    phases: join(bundle.phases, bundle.setAsidePhases),
    milestones: join(bundle.milestones, bundle.setAsideMilestones),
    dependencies: join(bundle.dependencies, bundle.setAsideDependencies),
    [SET_ASIDE_KEYS.tasks]: [],
    [SET_ASIDE_KEYS.phases]: [],
    [SET_ASIDE_KEYS.milestones]: [],
    [SET_ASIDE_KEYS.dependencies]: [],
  }
}

/** True when the bundle holds any set-aside row or edge. */
export function hasSetAside(bundle) {
  return !!bundle && Object.values(SET_ASIDE_KEYS).some(k => (bundle[k] || []).length > 0)
}

const KINDS = ['tasks', 'phases', 'milestones']

/**
 * The saved versions that can bring a row back: those that hold its id AND
 * can be opened. A version saved before S5 ("no timeline captured") cannot be
 * opened, so it can never bring anything back and never counts as a holder.
 * `except` leaves one version out (the open one, for "another version").
 */
export function holdersOf(versions, kind, id, { except = null } = {}) {
  const key = String(id)
  const out = []
  for (const v of versions || []) {
    if (!v || (except != null && v.id === except)) continue
    const read = readVersion(v)
    if (!read.hasTimeline) continue
    if ((read[kind] || []).some(r => r && String(r.id) === key)) out.push(v)
  }
  return out
}

/**
 * What a row about to be set aside carries that a person made or the Budget
 * counts (constraint 4): a task's logged days, the comments on a task or a
 * phase, the files linked to it (the desktop's managed files too). Key dates
 * carry none of these. null when there is nothing.
 */
export function workOn(kind, row, { comments = [], files = [], managedFiles = [] } = {}) {
  if (!row || kind === 'milestones') return null
  const id = String(row.id)
  const entity = kind === 'tasks' ? 'task' : 'phase'
  const fk = kind === 'tasks' ? 'task_id' : 'phase_id'
  const loggedDays = kind === 'tasks' ? (Number(row.logged_days) || 0) : 0
  const nComments = (comments || []).filter(c => c && c.deleted_at == null && c.entity_type === entity && String(c.entity_id) === id).length
  const nFiles = [...(files || []), ...(managedFiles || [])].filter(f => f && f.deleted_at == null && f[fk] != null && String(f[fk]) === id).length
  if (!loggedDays && !nComments && !nFiles) return null
  return { loggedDays, comments: nComments, files: nFiles }
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const days = (n) => `${Math.round(n * 100) / 100} ${n === 1 ? 'day' : 'days'}`

/** "1.5 days logged, 2 comments, 1 file" — '' for no work. */
export function workWords(work) {
  if (!work) return ''
  const parts = []
  if (work.loggedDays) parts.push(`${days(work.loggedDays)} logged`)
  if (work.comments) parts.push(plural(work.comments, 'comment'))
  if (work.files) parts.push(plural(work.files, 'file'))
  return parts.join(', ')
}

/**
 * Remove from this version, or Delete (constraint 9). While a version is
 * open and no budget is active, a row ANOTHER saved version holds is set
 * aside — it stays in that version — and any other row is deleted the
 * ordinary way. With no version open, or under a lock, every delete is the
 * ordinary one. → [{ id, verb: 'remove' | 'delete', holders: [version] }]
 */
export function removalOf({ kind, ids, versions, openVersionId = null, locked = false }) {
  return (ids || []).map((id) => {
    if (locked || !openVersionId) return { id, verb: 'delete', holders: [] }
    const holders = holdersOf(versions, kind, id, { except: openVersionId })
    return { id, verb: holders.length ? 'remove' : 'delete', holders }
  })
}

/**
 * The live rows that NO saved version holds (constraint 8): setting one aside
 * would hide it for ever, so the question before an open covers them — Save
 * puts them in a version, Discard deletes them the ordinary way.
 */
export function rowsInNoVersion(live, versions) {
  const held = { tasks: new Set(), phases: new Set(), milestones: new Set() }
  for (const v of versions || []) {
    const read = readVersion(v)
    if (!read.hasTimeline) continue
    for (const k of KINDS) for (const r of read[k] || []) if (r && r.id != null) held[k].add(String(r.id))
  }
  const out = {}
  for (const k of KINDS) out[k] = (live?.[k] || []).filter(r => r && !held[k].has(String(r.id)))
  return out
}

/** How many rows a { tasks, phases, milestones } set holds. */
export function countRows(set) {
  return KINDS.reduce((n, k) => n + ((set && set[k]) || []).length, 0)
}
