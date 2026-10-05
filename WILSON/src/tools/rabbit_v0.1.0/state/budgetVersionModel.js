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
const TASK_FIELDS = [
  'id', 'title', 'phase_id', 'start_date', 'end_date', 'bid_days',
  'assigned_role_slug', 'assigned_position', 'status',
  'scene_id', 'shot_id', 'asset_id', 'level_id', 'experience_id',
  'assigned_user_id', 'priority',
]
const TASK_SCHEDULE = [
  'phase_id', 'start_date', 'end_date', 'bid_days', 'assigned_role_slug',
  'assigned_position', 'status', 'scene_id', 'shot_id', 'asset_id',
]
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
 */
export function snapshotFromLive({
  tasks = [], phases = [], milestones = [], project = null, roleRates = {},
  shotList = null, savedAt = new Date().toISOString(), savedBy = null,
  previous = null, previousName = null,
}) {
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
    tasks: (tasks || []).map(t => pick(t, TASK_FIELDS)),
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

function rowsDelta(before, after, fields) {
  const a = byId(before)
  const b = byId(after)
  let added = 0
  let removed = 0
  let changed = 0
  for (const id of b.keys()) if (!a.has(id)) added += 1
  for (const [id, row] of a) {
    if (!b.has(id)) { removed += 1; continue }
    if (changedFields(row, b.get(id), fields).length) changed += 1
  }
  return { added, removed, changed }
}

function ratesChanged(a = {}, b = {}) {
  const out = []
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
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
  const tasks = rowsDelta(prev?.tasks, next?.tasks, TASK_SCHEDULE)
  return {
    against: prevName || null,
    bidDays: round2(num(n.totalBidDays) - num(p.totalBidDays)),
    tasksAdded: tasks.added,
    tasksRemoved: tasks.removed,
    ratesChanged: ratesChanged(prev?.roleRates, next?.roleRates).length,
    margin: fromTo(p.marginPct, n.marginPct),
    contingency: fromTo(p.contingencyPct, n.contingencyPct),
    total: p.overall == null || n.overall == null ? null : round2(n.overall - p.overall),
    span: p.spanDays == null || n.spanDays == null ? null : n.spanDays - p.spanDays,
  }
}

/**
 * The live rows against a version: is anything unsaved, and what. `snapshot`
 * is the version's; `live` a snapshotFromLive of the rows on screen. Tasks,
 * phases and key dates compare their SCHEDULE fields (never a title, never
 * logged days); the rates, margin, contingency and agency compare as numbers;
 * `shotListId`, when given, compares the list the version is based on.
 */
export function versionDiff(snapshot, live, { shotListId, liveShotListId } = {}) {
  const s = snapshot || {}
  const tasks = rowsDelta(s.tasks, live?.tasks, TASK_SCHEDULE)
  const phases = rowsDelta(s.phases, live?.phases, PHASE_SCHEDULE)
  const milestones = rowsDelta(s.milestones, live?.milestones, MILESTONE_SCHEDULE)
  const rates = ratesChanged(s.roleRates, live?.roleRates)
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
 * version"), as a plan the provider runs as ONE undo step:
 *   phases / tasks / milestones: { update: [{ id, patch, before }], create: [row] }
 *     — a row the version holds and the live project still has gets its
 *     schedule fields back; one it has lost is recreated from the snapshot
 *     (with its saved id); a row added SINCE the version was saved stays as
 *     it is (her F2). logged_days is never in a patch.
 *   settings: the project's margin / contingency / agency, as a patch + before
 *   rates: [{ roleSlug, rate, before }] — the roles whose live rate differs
 * Phases come first (a recreated sub-phase's parent, a recreated task's
 * phase), parents before children.
 *
 * `known` ({ scenes, shots, assets }: Sets of the ids that exist now) keeps a
 * link to a row that has gone out of the writes: a patch leaves that link as
 * it is, a recreated row is written without it. The cloud's same-project FKs
 * would refuse it, and opening must not stop half way for a deleted shot. A
 * phase link is known when the live project or the version holds the phase
 * (the version's phases are all present once the plan has run).
 */
export function planOpen(snapshot, { tasks = [], phases = [], milestones = [], project = null, roleRates = {}, known = null } = {}) {
  const s = snapshot || {}
  const plan = { phases: { update: [], create: [] }, tasks: { update: [], create: [] }, milestones: { update: [], create: [] }, settings: null, rates: [], droppedLinks: 0 }
  const phaseIds = new Set([...(phases || []), ...(s.phases || [])].filter(Boolean).map(p => String(p.id)))
  const linkKnown = {
    phase_id: phaseIds,
    parent_phase_id: phaseIds,
    scene_id: known?.scenes || null,
    shot_id: known?.shots || null,
    asset_id: known?.assets || null,
  }
  const isGone = (f, v) => v != null && linkKnown[f] instanceof Set && !linkKnown[f].has(String(v))

  const planRows = (snapRows, liveRows, scheduleFields, allFields, into) => {
    const live = byId(liveRows)
    for (const row of snapRows || []) {
      if (!row || row.id == null) continue
      const cur = live.get(String(row.id))
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

  planRows(sortParentsFirst(s.phases), phases, PHASE_SCHEDULE, PHASE_FIELDS, plan.phases)
  planRows(s.tasks, tasks, TASK_SCHEDULE, TASK_FIELDS, plan.tasks)
  planRows(s.milestones, milestones, MILESTONE_SCHEDULE, MILESTONE_FIELDS, plan.milestones)

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

  for (const [slug, rate] of Object.entries(s.roleRates || {})) {
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
  return !plan || (
    !plan.phases.update.length && !plan.phases.create.length
    && !plan.tasks.update.length && !plan.tasks.create.length
    && !plan.milestones.update.length && !plan.milestones.create.length
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
