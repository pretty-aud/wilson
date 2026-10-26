// =============================================================================
// budgetVersionModel.js — bid versions as living documents (post-overhaul S5).
//
// Audrey's F2 (2026-10-05): a bid version is OPENED into the live Timeline
// and Budget, Save writes the live rows back INTO it, and "Save as new
// version" is the only way a new one appears. Three per-project states, three
// words — OPEN (projects.open_budget_version_id), SELECTED (the variance
// baseline: budget_versions.is_active, a misnamed column we never rename) and
// LOCKED (projects.budget_active_version_id, "Budget active — in production").
//
// Pure, so the Summary, the Timeline, the provider's mutators and the
// questions all read one answer:
//
//   snapshotFromLive  the live rows as a version's snapshot (F1 phases, task
//                     dates and key dates; F6 the span; F7 the totals; F8 the
//                     automatic line against the version before it)
//   bidTotals         the Budget screen's arithmetic, once: the overall total
//                     WITH the agency fee when it is on, the before-agency
//                     total beside it (F7)
//   readVersion       any version, old shape or new, as the screen reads it
//   versionDiff       live against a version: isDirty and the Δ fields
//   planOpen          the writes that load a version into the live rows
//
// 🚨 logged_days is NEVER part of a snapshot (logged time is the truth; a
// version carries bid days), and nothing here ever writes it.
// Dates go through dates.js: a stored DATE is the local day it names.
// =============================================================================

import { calendarDaysBetween, toIsoDate } from '../dates'

export const SNAPSHOT_KIND = 'bid'

// The fields a version carries for each row, and the subset that is the
// SCHEDULE — compared for "unsaved changes" and written back on open. Names
// and colours ride along for the read-only gantt (and for recreating a row
// the live project has lost), but a rename is not an unsaved change to a
// bid: the brief restores "dates, bid days, role, position, status and
// links", not titles.
// Post-overhaul S5d: `assignee_id` rides along too — the person the task is
// assigned to (0013's canonical column; `assigned_user_id` is a column
// reserved for v0.2 that nothing writes). The Timeline groups a VIEWED
// version by team from it; like a title, a change of assignee is not an
// unsaved change to a bid. A plain UUID with no foreign key, so a lost task
// re-made from the snapshot keeps it safely.
const TASK_FIELDS = [
  'id', 'title', 'phase_id', 'start_date', 'end_date', 'bid_days',
  'assigned_role_slug', 'assigned_position', 'status',
  'scene_id', 'shot_id', 'asset_id', 'level_id', 'experience_id',
  'assigned_user_id', 'assignee_id', 'priority',
]
// VW1m (2026-10-16): a task's links are compared and written apart from its
// other schedule fields (taskLinksChanged; planOpen's `items`), so the
// schedule proper no longer names them.
const TASK_SCHEDULE = [
  'phase_id', 'start_date', 'end_date', 'bid_days', 'assigned_role_slug',
  'assigned_position', 'status',
]

// VW1m (2026-10-16), Q-N7 (batch 16, not yet asked; its interim choice is
// "every item of every kind"): a version keeps each task's ITEMS —
// `items: { asset: [ids], scene, shot, level, experience }`, each list's ids
// sorted — beside the five single
// fields above, which then hold the older apps' copy (each kind's first item
// in the order added) so a build that reads only those still finds one. The
// kinds and their fields are taskItemsModel's ITEM_KINDS and KIND_FIELD,
// said again here because this file imports dates.js and nothing else
// (src/dev/devFixtures.test.js pins that: the fixtures build their bids with
// it). A task row saved without `items` is the older shape: a version saved
// before this change, or by a backend that keeps no items.
const ITEM_FIELD = { asset: 'asset_id', scene: 'scene_id', shot: 'shot_id', level: 'level_id', experience: 'experience_id' }
const ITEM_KINDS = Object.keys(ITEM_FIELD)
const TASK_LINK_FIELDS = new Set(Object.values(ITEM_FIELD))
// The three links a version compared and wrote back before (the cloud's
// three columns): still the rule where no side keeps items.
const LEGACY_LINKS = ['scene_id', 'shot_id', 'asset_id']
const PHASE_FIELDS = ['id', 'name', 'parent_phase_id', 'start_date', 'end_date', 'sort_order', 'color', 'description']
const PHASE_SCHEDULE = ['parent_phase_id', 'start_date', 'end_date']
const MILESTONE_FIELDS = ['id', 'title', 'date', 'color', 'description', 'phase_id']
const MILESTONE_SCHEDULE = ['date', 'phase_id']
const DATE_FIELDS = new Set(['start_date', 'end_date', 'date'])

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const num = (v, fallback = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** A row's value as a version keeps it: a date as its local y-m-d, '' as null. */
function norm(field, v) {
  if (v === undefined || v === '') return null
  if (DATE_FIELDS.has(field)) return v == null ? null : (toIsoDate(v) ?? null)
  if (field === 'bid_days' || field === 'sort_order') return v == null ? null : num(v, null)
  return v
}

function pick(row, fields) {
  const out = {}
  for (const f of fields) out[f] = norm(f, row?.[f])
  return out
}

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const noItems = () => Object.fromEntries(ITEM_KINDS.map(k => [k, []]))

/** VW1m: task_items rows → Map(taskId → { asset: [ids], … }), each list once per id and sorted. */
function itemIdsByTask(items) {
  const out = new Map()
  for (const i of Array.isArray(items) ? items : []) {
    if (!i || i.task_id == null || !ITEM_FIELD[i.entity_type] || i.entity_id == null || i.entity_id === '') continue
    const key = String(i.task_id)
    let rec = out.get(key)
    if (!rec) { rec = noItems(); out.set(key, rec) }
    const id = String(i.entity_id)
    if (!rec[i.entity_type].includes(id)) rec[i.entity_type].push(id)
  }
  for (const rec of out.values()) for (const k of ITEM_KINDS) rec[k].sort(byCodeUnit)
  return out
}

/** A version's (or a live snapshot's) task items, or null for a row of the older shape. */
function itemsOfRow(row) {
  const s = row?.items
  return s && typeof s === 'object' && !Array.isArray(s) ? s : null
}
const idsIn = (items, kind) => (Array.isArray(items?.[kind]) ? items[kind].filter(v => v != null && v !== '').map(String) : [])
function sameSet(a, b) {
  const sa = new Set(a)
  const sb = new Set(b)
  return sa.size === sb.size && [...sa].every(x => sb.has(x))
}

// VW1m review round 2 (R2-1): which items the project shows. `known` is
// planOpen's ({ scenes, shots, assets, levels, experiences }: Sets of the ids
// that exist now; knownIdsOf), the rows the provider's hiddenItemIdsOf reads.
// An item whose row is not among them is HIDDEN (in the trash, or not loaded:
// her Q-N4): no screen shows it and no open writes it (the provider's set
// keeps it), so a snapshot keeps the live items only and every compare reads
// the live items of both sides. Counted, a task with an asset added and then
// deleted read "Unsaved changes" for good. No `known`: every id is live.
const KNOWN_KEY = { asset: 'assets', scene: 'scenes', shot: 'shots', level: 'levels', experience: 'experiences' }
const isShown = (known, kind, id) => {
  const set = known?.[KNOWN_KEY[kind]]
  return !(set instanceof Set) || set.has(String(id))
}

/** VW1m review round 2 (R2-1): `known` from the project's rows, as the provider's knownRowIds builds it (scenes and shots: every row, not the active list's). */
export function knownIdsOf({ assets, scenes, shots, levels, experiences } = {}) {
  const ids = (rows) => new Set((rows || []).filter(r => r && r.id != null).map(r => String(r.id)))
  return { scenes: ids(scenes), shots: ids(shots), assets: ids(assets), levels: ids(levels), experiences: ids(experiences) }
}

/** VW1m review round 2 (R2-1): the task_items rows whose row the project shows (`known`); every row without `known`. */
export function liveItemsOnly(items, known) {
  if (!Array.isArray(items) || !known) return items
  return items.filter(i => i && ITEM_FIELD[i.entity_type] && isShown(known, i.entity_type, i.entity_id))
}

/**
 * VW1m (2026-10-16), Q-N7 interim: whether a task's links differ between a
 * version's row (`saved`) and the live one (or between two versions, F8).
 *   both carry items       → any kind's SET differs (the order is never a
 *                            change: no item counts for more than another);
 *   only the live one does → (a version saved before) a saved single item
 *                            the task no longer has; an item added since is
 *                            no change, as opening it removes nothing;
 *   the live one does not  → (a backend that keeps no items) the three
 *                            single fields, as before.
 * Review round 2 (R2-1): with `known`, an item whose row the project does
 * not show is no change on either side (hidden: no open could show it).
 */
function taskLinksChanged(saved, live, known = null) {
  const s = itemsOfRow(saved)
  const l = itemsOfRow(live)
  const shown = (items, kind) => idsIn(items, kind).filter(id => isShown(known, kind, id))
  if (l) {
    if (s) return ITEM_KINDS.some(k => !sameSet(shown(s, k), shown(l, k)))
    return ITEM_KINDS.some(k => {
      const v = norm(ITEM_FIELD[k], saved?.[ITEM_FIELD[k]])
      return v != null && isShown(known, k, v) && !shown(l, k).includes(String(v))
    })
  }
  return LEGACY_LINKS.some(f => norm(f, saved?.[f]) !== norm(f, live?.[f]))
}

/**
 * The project's budget settings, read exactly as BudgetView reads them (the
 * agency fee defaults to 20% when it has never been set).
 */
export function projectBudgetSettings(project) {
  return {
    marginPct: Number(project?.budget_margin_pct ?? 0) || 0,
    contingencyPct: Number(project?.budget_contingency_pct ?? 0) || 0,
    agencyEnabled: project?.budget_agency_enabled === true,
    agencyPct: Number(project?.budget_agency_pct ?? 20),
  }
}

/**
 * The Budget's own arithmetic (BudgetView's waterfall, the selectors' rollup):
 * base = Σ bid_days × the role's day rate; margin and contingency each on the
 * BASE, rounded to cents (0037: never compounded); the before-agency total
 * rounded to cents; the agency fee on the BASE, rounded to the whole unit;
 * overall = before-agency + the fee when it is on (F7: "the total with the
 * agency % is ... the overall total").
 */
export function bidTotals({ tasks, roleRates = {}, marginPct = 0, contingencyPct = 0, agencyEnabled = false, agencyPct = 0 }) {
  let baseCost = 0
  for (const t of tasks || []) {
    if (!t?.bid_days) continue
    const role = t.assigned_role_slug || 'unassigned'
    const rate = roleRates[role] ?? 0
    baseCost += Number(t.bid_days) * Number(rate)
  }
  const marginAmt = round2(baseCost * (num(marginPct) / 100))
  const contingencyAmt = round2(baseCost * (num(contingencyPct) / 100))
  const beforeAgency = round2(baseCost + marginAmt + contingencyAmt)
  const agencyAmt = agencyEnabled ? Math.round(baseCost * (num(agencyPct) / 100)) : 0
  return { baseCost, marginAmt, contingencyAmt, agencyAmt, beforeAgency, overall: beforeAgency + agencyAmt }
}

/**
 * The calendar span the schedule covers: from its earliest date (a task's or
 * a phase's start, a key date) to its latest (an end, a key date), in whole
 * calendar days (F6: "142 d", the dates in a tooltip). null when it holds no
 * dates at all.
 */
export function scheduleSpan({ tasks = [], phases = [], milestones = [] }) {
  const starts = []
  const ends = []
  for (const r of [...tasks, ...phases]) {
    const s = toIsoDate(r?.start_date)
    const e = toIsoDate(r?.end_date)
    if (s) starts.push(s)
    if (e) ends.push(e)
  }
  for (const m of milestones) {
    const d = toIsoDate(m?.date)
    if (d) { starts.push(d); ends.push(d) }
  }
  if (!starts.length && !ends.length) return null
  const all = [...starts, ...ends].sort()
  const start = (starts.length ? starts.sort()[0] : all[0])
  const end = (ends.length ? ends.sort()[ends.length - 1] : all[all.length - 1])
  return { start, end, spanDays: calendarDaysBetween(start, end) }
}

const totalBidDaysOf = (tasks) => (tasks || []).reduce((s, t) => s + num(t?.bid_days), 0)

/**
 * The live rows as a version's snapshot (the shape every new or re-saved
 * version carries from S5 on). `previous` is the snapshot of the version
 * before this one by created_at, for F8's automatic line (null for the first).
 *
 * VW1m (2026-10-16), Q-N7 interim: `items` — the project's task_items rows,
 * where the backend keeps them (null where it keeps none) — gives each task
 * its `items: { asset: [ids], scene, shot, level, experience }`. Review round
 * 2 (R2-1): the callers pass the LIVE items only (liveItemsOnly): one in the
 * trash is the task's, hidden while there, and no part of a bid.
 * `itemsUnknown` — ids of tasks whose items the caller could not read — keeps
 * those in the older shape (their own single fields), which an open never
 * removes by. The single fields are taken from the rows as given: the
 * provider passes the older apps' copy in them.
 */
export function snapshotFromLive({
  tasks = [], items = null, itemsUnknown = null, phases = [], milestones = [], project = null, roleRates = {},
  shotList = null, savedAt = new Date().toISOString(), savedBy = null,
  previous = null, previousName = null,
}) {
  const byTask = Array.isArray(items) ? itemIdsByTask(items) : null
  const unknown = new Set([...(itemsUnknown || [])].map(String))
  const taskRow = (t) => {
    const row = pick(t, TASK_FIELDS)
    if (byTask && t?.id != null && !unknown.has(String(t.id))) row.items = byTask.get(String(t.id)) || noItems()
    return row
  }
  const settings = projectBudgetSettings(project)
  const totals = bidTotals({ tasks, roleRates, ...settings })
  // A trashed key date is not part of the schedule — not in the version, and
  // not in its span either.
  const liveMilestones = (milestones || []).filter(m => m && !m.deleted_at)
  const span = scheduleSpan({ tasks, phases, milestones: liveMilestones })
  const snap = {
    kind: SNAPSHOT_KIND,
    saved_at: savedAt,
    saved_by: savedBy,
    tasks: (tasks || []).map(taskRow),
    phases: (phases || []).map(p => pick(p, PHASE_FIELDS)),
    milestones: liveMilestones.map(m => pick(m, MILESTONE_FIELDS)),
    roleRates: { ...roleRates },
    ...settings,
    totals: { beforeAgency: totals.beforeAgency, overall: totals.overall, baseCost: round2(totals.baseCost), agencyAmt: totals.agencyAmt },
    totalBidDays: totalBidDaysOf(tasks),
    spanDays: span ? span.spanDays : null,
    span: span ? { start: span.start, end: span.end } : null,
    shot_list: shotList ? { id: shotList.id, title: shotList.title, version: shotList.version } : null,
    delta: null,
  }
  snap.delta = previous ? versionDelta(previous, snap, previousName) : null
  return snap
}

/**
 * Any stored version as the screen reads it. The S5 shape is read as written;
 * an OLDER one (grandTotal / baseCost / totalBidDays and flat tasks, the lock's
 * lineItemTotals) keeps showing its numbers, with:
 *   hasTimeline false → "no timeline captured" (F1)
 *   spanDays null     → "—" (F6)
 *   overallKnown      whether the agency fee is in `overall`. An old version
 *                     stored only the before-agency total; when its lock
 *                     recorded the fee (lineItemTotals) the overall is known.
 */
export function readVersion(version) {
  const s = version?.snapshot || {}
  const isNew = s.kind === SNAPSHOT_KIND && s.totals && typeof s.totals === 'object'
  if (isNew) {
    return {
      shape: 'living',
      overall: num(s.totals.overall),
      beforeAgency: num(s.totals.beforeAgency),
      overallKnown: true,
      agencyEnabled: s.agencyEnabled === true,
      agencyPct: num(s.agencyPct),
      marginPct: num(s.marginPct),
      contingencyPct: num(s.contingencyPct),
      totalBidDays: num(s.totalBidDays),
      spanDays: s.spanDays == null ? null : num(s.spanDays),
      span: s.span || null,
      // The S5 shape always captured the schedule (an empty one is still one).
      hasTimeline: Array.isArray(s.phases) && Array.isArray(s.tasks),
      tasks: Array.isArray(s.tasks) ? s.tasks : [],
      phases: Array.isArray(s.phases) ? s.phases : [],
      milestones: Array.isArray(s.milestones) ? s.milestones : [],
      roleRates: s.roleRates || {},
      delta: s.delta || null,
      savedAt: s.saved_at || null,
    }
  }
  const lit = s.lineItemTotals || null
  const before = lit?.grandTotal ?? s.grandTotal ?? s.baseCost ?? null
  const overallKnown = !!lit && typeof lit.agencyEnabled === 'boolean'
  const agency = overallKnown && lit.agencyEnabled ? num(lit.agencyAmt) : 0
  return {
    shape: 'old',
    overall: before == null ? null : num(before) + agency,
    beforeAgency: before == null ? null : num(before),
    overallKnown,
    agencyEnabled: overallKnown ? lit.agencyEnabled === true : null,
    agencyPct: overallKnown ? num(lit.agencyPct) : null,
    marginPct: s.marginPct == null ? null : num(s.marginPct),
    contingencyPct: s.contingencyPct == null ? null : num(s.contingencyPct),
    totalBidDays: s.totalBidDays == null ? null : num(s.totalBidDays),
    spanDays: null,
    span: null,
    hasTimeline: false,
    tasks: Array.isArray(s.tasks) ? s.tasks : [],
    phases: [],
    milestones: [],
    roleRates: s.roleRates || {},
    delta: null,
    savedAt: s.lockedAt || null,
  }
}

/**
 * Variance of the live budget against a version, comparing like with like
 * (F7): the overall totals when the version's is known; otherwise (an old
 * version that never stored the agency fee) the before-agency totals.
 */
export function varianceAgainst(live, read) {
  if (!read || read.overall == null) return null
  const useOverall = read.overallKnown
  const bidTotal = useOverall ? read.overall : read.beforeAgency
  const currentTotal = useOverall ? live.overall : live.beforeAgency
  const diff = currentTotal - bidTotal
  return { bidTotal, currentTotal, diff, pctChange: bidTotal > 0 ? (diff / bidTotal) * 100 : 0, basis: useOverall ? 'overall' : 'beforeAgency' }
}

function byId(rows) {
  const m = new Map()
  for (const r of rows || []) if (r && r.id != null) m.set(String(r.id), r)
  return m
}

function changedFields(a, b, fields) {
  const out = []
  for (const f of fields) if (norm(f, a?.[f]) !== norm(f, b?.[f])) out.push(f)
  return out
}

// `linksChanged(beforeRow, afterRow)`, for tasks: VW1m's link comparison.
function rowsDelta(before, after, fields, linksChanged = null) {
  const a = byId(before)
  const b = byId(after)
  let added = 0
  let removed = 0
  let changed = 0
  for (const id of b.keys()) if (!a.has(id)) added += 1
  for (const [id, row] of a) {
    if (!b.has(id)) { removed += 1; continue }
    if (changedFields(row, b.get(id), fields).length || (linksChanged && linksChanged(row, b.get(id)))) changed += 1
  }
  return { added, removed, changed }
}

/**
 * The roles some rows bid with: each task's role, 'unassigned' for none (as
 * bidTotals reads a rate). Post-overhaul S5c review round 1 (R1-03): a
 * snapshot keeps the whole rate map, but only these roles' rates change what
 * a bid costs — a role the rate card gained that no task uses made every
 * version read "unsaved" for good, and an open pin it as a project rate.
 */
function rolesOf(...taskLists) {
  const out = new Set()
  for (const list of taskLists) for (const t of list || []) if (t) out.add(t.assigned_role_slug || 'unassigned')
  return out
}

/** The roles whose rate differs between two maps — of `roles` when given, else of either map. */
function ratesChanged(a = {}, b = {}, roles = null) {
  const out = []
  const keys = roles ? [...roles] : [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])]
  for (const k of keys) {
    if (num(a?.[k], null) !== num(b?.[k], null)) out.push(k)
  }
  return out.sort()
}

const fromTo = (a, b) => (num(a, null) === num(b, null) ? null : { from: num(a, null), to: num(b, null) })

/**
 * F8's automatic line, as fields: this snapshot against the one before it.
 * Δ bid days, tasks added / removed, rates changed, margin and contingency
 * from → to, Δ overall total, Δ span. Pure numbers; the words are deltaWords.
 */
export function versionDelta(prev, next, prevName = null) {
  const p = readVersion({ snapshot: prev })
  const n = readVersion({ snapshot: next })
  const tasks = rowsDelta(prev?.tasks, next?.tasks, TASK_SCHEDULE, taskLinksChanged)
  // Like with like (review round 1, R1-09; varianceAgainst's rule): an OLD
  // version that never stored the agency fee is compared before agency,
  // or an unchanged schedule would read "+" the whole fee.
  const total = p.overallKnown
    ? (p.overall == null || n.overall == null ? null : round2(n.overall - p.overall))
    : (p.beforeAgency == null || n.beforeAgency == null ? null : round2(n.beforeAgency - p.beforeAgency))
  return {
    against: prevName || null,
    bidDays: round2(num(n.totalBidDays) - num(p.totalBidDays)),
    tasksAdded: tasks.added,
    tasksRemoved: tasks.removed,
    ratesChanged: ratesChanged(prev?.roleRates, next?.roleRates, rolesOf(prev?.tasks, next?.tasks)).length,
    margin: fromTo(p.marginPct, n.marginPct),
    contingency: fromTo(p.contingencyPct, n.contingencyPct),
    total,
    span: p.spanDays == null || n.spanDays == null ? null : n.spanDays - p.spanDays,
  }
}

/**
 * The live rows against a version: is anything unsaved, and what. `snapshot`
 * is the version's; `live` a snapshotFromLive of the rows on screen. Tasks,
 * phases and key dates compare their SCHEDULE fields (never a title, never
 * logged days); the rates, margin, contingency and agency compare as numbers;
 * `shotListId`, when given, compares the list the version is based on.
 * VW1m (2026-10-16), Q-N7 interim: a task's links compare as taskLinksChanged
 * says — any item added or removed is an unsaved change, its order never.
 * Review round 2 (R2-1): `known` (knownIdsOf) — only the items the project
 * shows are compared, the version's and the live ones.
 */
export function versionDiff(snapshot, live, { shotListId, liveShotListId, known = null } = {}) {
  const s = snapshot || {}
  const tasks = rowsDelta(s.tasks, live?.tasks, TASK_SCHEDULE, (a, b) => taskLinksChanged(a, b, known))
  const phases = rowsDelta(s.phases, live?.phases, PHASE_SCHEDULE)
  const milestones = rowsDelta(s.milestones, live?.milestones, MILESTONE_SCHEDULE)
  const rates = ratesChanged(s.roleRates, live?.roleRates, rolesOf(s.tasks, live?.tasks))
  const settings = {
    margin: fromTo(s.marginPct, live?.marginPct),
    contingency: fromTo(s.contingencyPct, live?.contingencyPct),
    agencyEnabled: (s.agencyEnabled === true) === (live?.agencyEnabled === true) ? null : { from: s.agencyEnabled === true, to: live?.agencyEnabled === true },
    agencyPct: fromTo(s.agencyPct, live?.agencyPct),
  }
  const shotList = shotListId !== undefined && liveShotListId !== undefined && (shotListId || null) !== (liveShotListId || null)
  const isDirty = tasks.added + tasks.removed + tasks.changed
    + phases.added + phases.removed + phases.changed
    + milestones.added + milestones.removed + milestones.changed
    + rates.length > 0
    || Object.values(settings).some(Boolean)
    || shotList
  return { isDirty, tasks, phases, milestones, ratesChanged: rates, settings, shotList }
}

/**
 * The writes that load a version into the live rows (F2's "Edit this
 * version"), as a plan the provider runs as ONE undo step. Audrey's ruling
 * (a) of 2026-10-05: the version shows EXACTLY its own schedule.
 *   phases / tasks / milestones: { update: [{ id, patch, before }], create: [row] }
 *     — a row the version holds that the project still has (live or set
 *     aside) gets its schedule fields back; one it has lost is recreated from
 *     the snapshot (with its saved id). logged_days is never in a patch.
 *   bringBack: { tasks, phases, milestones } — ids of rows the version holds
 *     that are SET ASIDE now: they come back, the same rows, before their
 *     patches are written. Never recreated (S5b: a set-aside row is whole).
 *   setAside: { tasks, phases, milestones } — ids of LIVE rows the version
 *     does not hold: they leave the live schedule, kept whole, until a version
 *     that holds them is opened. Less `keep` (constraint 4: the person keeps
 *     rows with work on them; a kept task keeps its phase, and a kept phase
 *     its parents, so it never lands under a phase that is gone).
 *   settings: the project's margin / contingency / agency, as a patch + before
 *   rates: [{ roleSlug, rate, before }] — the roles whose live rate differs
 * Phases come first (a recreated sub-phase's parent, a recreated task's
 * phase), parents before children.
 *
 * `setAside` ({ tasks, phases, milestones }: the project's set-aside rows) is
 * what makes a held row come BACK instead of being re-made: without it every
 * set-aside row the version holds would read as lost.
 *
 * `known` ({ scenes, shots, assets, levels, experiences }: Sets of the ids
 * that exist now) keeps a link to a row that has gone out of the writes: a
 * patch leaves that link as it is, a recreated row is written without it.
 * The cloud's same-project FKs would refuse it, and opening must not stop
 * half way for a deleted shot. A phase link is known when the live project
 * or the version holds the phase (the version's phases are all present once
 * the plan has run). `droppedLinks` counts the links left out.
 *
 * VW1m (2026-10-16), Q-N7 interim: `items` — the live task_items rows where
 * the backend keeps them, else null (then a task's links are its single
 * fields, patched and re-made as before). With them, a task's links are never
 * in its patch or its re-made row; they are `items: [{ id, kind, ids, gone,
 * exact }]`, one per held task and kind to write:
 *   exact true  (a version saved with items) → the kind becomes exactly
 *               `ids` (the provider's setTaskItemsOfKind). An id whose row is
 *               gone is left out and counted, in `gone`, unless the task still
 *               has it (an asset in the trash stays the task's, hidden). A
 *               re-made task gets an entry for every kind.
 *   exact false (a version saved before) → each of `ids` (its saved single
 *               item, where the task lost it) is added; nothing is removed.
 * Review round 2 (R2-1): the version's items are measured against the task's
 * LIVE items (a row `known` names): a hidden one (in the trash) is never
 * written, never counted and never a difference — the provider's set keeps
 * it (R1-1) — so an open a hidden item alone told apart wrote nothing.
 */
export function planOpen(snapshot, { tasks = [], phases = [], milestones = [], setAside = null, keep = null, project = null, roleRates = {}, known = null, items = null } = {}) {
  const s = snapshot || {}
  const plan = {
    phases: { update: [], create: [] }, tasks: { update: [], create: [] }, milestones: { update: [], create: [] },
    bringBack: { tasks: [], phases: [], milestones: [] },
    setAside: { tasks: [], phases: [], milestones: [] },
    items: [],
    settings: null, rates: [], droppedLinks: 0,
  }
  const aside = setAside || {}
  const itemsOn = Array.isArray(items)
  const phaseIds = new Set([...(phases || []), ...(s.phases || [])].filter(Boolean).map(p => String(p.id)))
  const linkKnown = {
    phase_id: phaseIds,
    parent_phase_id: phaseIds,
    scene_id: known?.scenes || null,
    shot_id: known?.shots || null,
    asset_id: known?.assets || null,
    level_id: known?.levels || null,
    experience_id: known?.experiences || null,
  }
  const isGone = (f, v) => v != null && linkKnown[f] instanceof Set && !linkKnown[f].has(String(v))

  const planRows = (kind, snapRows, liveRows, scheduleFields, allFields, into) => {
    const live = byId(liveRows)
    const away = byId(aside[kind])
    for (const row of snapRows || []) {
      if (!row || row.id == null) continue
      let cur = live.get(String(row.id))
      if (!cur && away.has(String(row.id))) {
        cur = away.get(String(row.id))
        plan.bringBack[kind].push(cur.id)
      }
      if (!cur) {
        const rec = {}
        for (const f of allFields) {
          if (row[f] === undefined || row[f] === null) continue
          if (isGone(f, row[f])) { plan.droppedLinks += 1; continue }
          rec[f] = row[f]
        }
        into.create.push(rec)
        continue
      }
      const fields = changedFields(cur, row, scheduleFields)
      const patch = {}
      const before = {}
      for (const f of fields) {
        const v = norm(f, row[f])
        if (isGone(f, v)) { plan.droppedLinks += 1; continue }
        patch[f] = v
        before[f] = cur[f] ?? null
      }
      if (Object.keys(patch).length) into.update.push({ id: cur.id, patch, before })
    }
  }

  // VW1m: each held task's items (after planRows: a task it re-makes has no
  // items here yet, so every kind is written for it).
  const planTaskItems = (snapRows, liveItems) => {
    const have = itemIdsByTask(liveItems)
    const remade = new Set(plan.tasks.create.map(r => String(r.id)))
    for (const row of snapRows || []) {
      if (!row || row.id == null) continue
      const isNew = remade.has(String(row.id))
      const has = isNew ? noItems() : (have.get(String(row.id)) || noItems())
      const saved = itemsOfRow(row)
      for (const kind of ITEM_KINDS) {
        const f = ITEM_FIELD[kind]
        if (saved) {
          // R2-1: the live items only; a hidden one the task has is kept by
          // the set, so it is neither in `ids` nor counted in `gone`.
          const now = has[kind].filter(id => !isGone(f, id))
          const ids = []
          const gone = []
          for (const id of idsIn(saved, kind)) {
            if (!isGone(f, id)) ids.push(id)
            else if (!has[kind].includes(id)) gone.push(id)
          }
          plan.droppedLinks += gone.length
          if (isNew || !sameSet(ids, now)) plan.items.push({ id: row.id, kind, ids, gone, exact: true })
          continue
        }
        const v = norm(f, row[f])
        if (v == null || has[kind].includes(String(v))) continue
        if (isGone(f, v)) { plan.droppedLinks += 1; continue }
        plan.items.push({ id: row.id, kind, ids: [String(v)], gone: [], exact: false })
      }
    }
  }

  planRows('phases', sortParentsFirst(s.phases), phases, PHASE_SCHEDULE, PHASE_FIELDS, plan.phases)
  if (itemsOn) {
    planRows('tasks', s.tasks, tasks, TASK_SCHEDULE, TASK_FIELDS.filter(f => !TASK_LINK_FIELDS.has(f)), plan.tasks)
    planTaskItems(s.tasks, items)
  } else {
    planRows('tasks', s.tasks, tasks, [...TASK_SCHEDULE, ...LEGACY_LINKS], TASK_FIELDS, plan.tasks)
  }
  planRows('milestones', s.milestones, milestones, MILESTONE_SCHEDULE, MILESTONE_FIELDS, plan.milestones)

  // Live rows the version does not hold leave the live schedule (ruling (a)),
  // less those kept. A kept task keeps its phase, and a kept phase its parent
  // chain, while the version itself does not hold them.
  const held = (rows) => new Set((rows || []).filter(Boolean).map(r => String(r.id)))
  const heldBy = { tasks: held(s.tasks), phases: held(s.phases), milestones: held(s.milestones) }
  const kept = { tasks: new Set([...(keep?.tasks || [])].map(String)), phases: new Set([...(keep?.phases || [])].map(String)), milestones: new Set() }
  const livePhases = byId(phases)
  const keepPhaseChain = (phaseId) => {
    let id = phaseId == null ? null : String(phaseId)
    let guard = livePhases.size + 1
    while (id && guard-- > 0 && livePhases.has(id) && !heldBy.phases.has(id)) {
      kept.phases.add(id)
      const parent = livePhases.get(id).parent_phase_id
      id = parent == null ? null : String(parent)
    }
  }
  for (const t of tasks || []) if (t && kept.tasks.has(String(t.id))) keepPhaseChain(t.phase_id)
  for (const id of [...kept.phases]) keepPhaseChain(livePhases.get(id)?.parent_phase_id)
  for (const [kind, rows] of [['tasks', tasks], ['phases', phases], ['milestones', milestones]]) {
    for (const r of rows || []) {
      if (!r || r.id == null) continue
      const id = String(r.id)
      if (!heldBy[kind].has(id) && !kept[kind].has(id)) plan.setAside[kind].push(r.id)
    }
  }

  const cur = projectBudgetSettings(project)
  const want = {
    budget_margin_pct: num(s.marginPct, cur.marginPct),
    budget_contingency_pct: num(s.contingencyPct, cur.contingencyPct),
    budget_agency_enabled: typeof s.agencyEnabled === 'boolean' ? s.agencyEnabled : cur.agencyEnabled,
    budget_agency_pct: num(s.agencyPct, cur.agencyPct),
  }
  const have = {
    budget_margin_pct: cur.marginPct,
    budget_contingency_pct: cur.contingencyPct,
    budget_agency_enabled: cur.agencyEnabled,
    budget_agency_pct: cur.agencyPct,
  }
  const patch = {}
  const before = {}
  for (const k of Object.keys(want)) {
    if (want[k] !== have[k]) { patch[k] = want[k]; before[k] = project?.[k] ?? null }
  }
  plan.settings = Object.keys(patch).length ? { patch, before } : null

  // Only the roles the version's tasks bid with (S5c, R1-03): a role nobody
  // uses is not the bid's to set.
  const bidRoles = rolesOf(s.tasks)
  for (const [slug, rate] of Object.entries(s.roleRates || {})) {
    if (!bidRoles.has(slug)) continue
    const r = num(rate, null)
    if (r == null) continue
    const live = num(roleRates?.[slug], null)
    if (live !== r) plan.rates.push({ roleSlug: slug, rate: r, before: live })
  }
  plan.rates.sort((a, b) => a.roleSlug.localeCompare(b.roleSlug))
  return plan
}

/** Phases with every parent before its children (a recreated sub-phase needs its parent first). */
function sortParentsFirst(phases) {
  const list = (phases || []).filter(Boolean)
  const ids = new Set(list.map(p => String(p.id)))
  const out = []
  const placed = new Set()
  let guard = list.length + 1
  while (out.length < list.length && guard-- > 0) {
    for (const p of list) {
      if (placed.has(String(p.id))) continue
      const parent = p.parent_phase_id == null ? null : String(p.parent_phase_id)
      if (!parent || !ids.has(parent) || placed.has(parent)) { out.push(p); placed.add(String(p.id)) }
    }
  }
  for (const p of list) if (!placed.has(String(p.id))) out.push(p) // a cycle: keep the rest as stored
  return out
}

/** True when a plan writes nothing. */
export function planIsEmpty(plan) {
  const none = (set) => !set || (!set.tasks?.length && !set.phases?.length && !set.milestones?.length)
  return !plan || (
    !plan.phases.update.length && !plan.phases.create.length
    && !plan.tasks.update.length && !plan.tasks.create.length
    && !plan.milestones.update.length && !plan.milestones.create.length
    && none(plan.bringBack) && none(plan.setAside)
    && !(plan.items || []).length
    && !plan.settings && !plan.rates.length
  )
}

/** Newest first (F13), by created_at then id, so equal stamps keep one order. */
export function sortVersionsNewest(versions) {
  return [...(versions || [])].sort((a, b) =>
    String(b?.created_at || '').localeCompare(String(a?.created_at || '')) || String(b?.id).localeCompare(String(a?.id)))
}

/** The SELECTED bid (is_active): the newest selected row, should older data hold two. */
export function selectedVersionOf(versions) {
  return sortVersionsNewest((versions || []).filter(v => v?.is_active))[0] || null
}

/** The version saved before `version` by created_at (F8's comparison), or null. */
export function previousVersionOf(versions, version) {
  const at = String(version?.created_at || '')
  const older = sortVersionsNewest((versions || []).filter(v => v && v.id !== version?.id && String(v.created_at || '') < at))
  return older[0] || null
}

/**
 * F8's automatic line in words ("vs v1: +3.5 bid days · 2 tasks added · 1
 * removed · 2 rates changed · margin 10% → 12% · +$4,200 · +6 d"). `money` formats
 * a signed amount; returns '' when nothing changed or there is nothing before.
 */
export function deltaWords(delta, { money = (n) => String(n), days = (n) => String(n) } = {}) {
  if (!delta) return ''
  const parts = []
  const signed = (n, f) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${f(Math.abs(n))}`
  if (delta.bidDays) parts.push(`${signed(delta.bidDays, days)} bid days`)
  if (delta.tasksAdded) parts.push(`${delta.tasksAdded} task${delta.tasksAdded === 1 ? '' : 's'} added`)
  if (delta.tasksRemoved) parts.push(`${delta.tasksRemoved} removed`)
  if (delta.ratesChanged) parts.push(`${delta.ratesChanged} rate${delta.ratesChanged === 1 ? '' : 's'} changed`)
  if (delta.margin) parts.push(`margin ${delta.margin.from ?? 0}% → ${delta.margin.to ?? 0}%`)
  if (delta.contingency) parts.push(`contingency ${delta.contingency.from ?? 0}% → ${delta.contingency.to ?? 0}%`)
  if (delta.total) parts.push(signed(delta.total, money))
  if (delta.span) parts.push(`${signed(delta.span, String)} d`)
  const head = delta.against ? `vs ${delta.against}: ` : ''
  return parts.length ? `${head}${parts.join(' · ')}` : (delta.against ? `${head}no change` : '')
}
