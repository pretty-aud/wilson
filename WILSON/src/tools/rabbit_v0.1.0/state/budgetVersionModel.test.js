// =============================================================================
// budgetVersionModel.test.js — post-overhaul S5, step 5: the one pure answer
// the Summary, the Timeline, the provider's mutators and the questions read.
// Every "changes nothing" case has a control that the same helper DOES see a
// change one field over, so a helper that always says "clean" fails here.
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  bidTotals, projectBudgetSettings, scheduleSpan, snapshotFromLive, readVersion,
  varianceAgainst, versionDelta, versionDiff, planOpen, planIsEmpty,
  sortVersionsNewest, selectedVersionOf, previousVersionOf, deltaWords, SNAPSHOT_KIND,
} from './budgetVersionModel'
import { selectProjectBudgetRollup } from './selectors'

const project = {
  id: 'p1', budget_margin_pct: 10, budget_contingency_pct: 5,
  budget_agency_enabled: true, budget_agency_pct: 15,
}
const roleRates = { editor: 500, director: 800 }
const phases = [
  { id: 'ph1', name: 'Pre', parent_phase_id: null, start_date: '2026-09-01', end_date: '2026-09-20', sort_order: 0, color: '#fff' },
  { id: 'ph2', name: 'Sub', parent_phase_id: 'ph1', start_date: '2026-09-05', end_date: '2026-09-10', sort_order: 1, color: '#fff' },
]
const tasks = [
  { id: 't1', title: 'Cut', phase_id: 'ph1', start_date: '2026-09-02', end_date: '2026-09-04', bid_days: 2, logged_days: 5, assigned_role_slug: 'editor', status: 'in_progress' },
  { id: 't2', title: 'Direct', phase_id: 'ph2', start_date: '2026-09-05', end_date: '2026-09-08', bid_days: 1.5, logged_days: 0, assigned_role_slug: 'director', status: 'bidding' },
]
const milestones = [{ id: 'm1', title: 'Lock', date: '2026-10-01', phase_id: 'ph1', color: '#0f0' }]
const live = () => snapshotFromLive({ tasks, phases, milestones, project, roleRates, savedAt: '2026-10-05T10:00:00.000Z', savedBy: 'u1' })

describe('bidTotals — the Budget screen\'s arithmetic, once (F7)', () => {
  it('overall = before-agency + the agency fee on the BASE; margin and contingency on the base, never compounded', () => {
    const t = bidTotals({ tasks, roleRates, ...projectBudgetSettings(project) })
    // base = 2 × 500 + 1.5 × 800 = 2200
    expect(t.baseCost).toBe(2200)
    expect(t.marginAmt).toBe(220)
    expect(t.contingencyAmt).toBe(110)
    expect(t.beforeAgency).toBe(2530)
    expect(t.agencyAmt).toBe(330)
    expect(t.overall).toBe(2860)
  })
  it('CONTROL: with the agency fee off, overall IS the before-agency total', () => {
    const t = bidTotals({ tasks, roleRates, ...projectBudgetSettings({ ...project, budget_agency_enabled: false }) })
    expect(t.overall).toBe(t.beforeAgency)
    expect(t.agencyAmt).toBe(0)
  })
  it('rounds as BudgetView does: margin and contingency to cents, the fee to the whole unit', () => {
    const t = bidTotals({ tasks: [{ bid_days: 1, assigned_role_slug: 'x' }], roleRates: { x: 333.333 }, marginPct: 10, contingencyPct: 0, agencyEnabled: true, agencyPct: 15 })
    expect(t.marginAmt).toBe(33.33)
    expect(t.beforeAgency).toBe(366.66)
    expect(t.agencyAmt).toBe(50)
  })
  it('its base is the selectors\' rollup total, unknown roles and zero days included', () => {
    const odd = [...tasks, { id: 't3', bid_days: 3, assigned_role_slug: 'nobody' }, { id: 't4', bid_days: 0, assigned_role_slug: 'editor' }]
    expect(bidTotals({ tasks: odd, roleRates }).baseCost).toBe(selectProjectBudgetRollup({ tasks: odd, roleRates }).total)
  })
  it('the agency fee defaults to 20% when the project never set it (BudgetView\'s reading)', () => {
    expect(projectBudgetSettings({ budget_agency_enabled: true }).agencyPct).toBe(20)
    expect(projectBudgetSettings({}).agencyEnabled).toBe(false)
  })
})

describe('snapshotFromLive — what a version carries (F1, F6, F7, F8)', () => {
  it('carries phases (sub-phases with their parent), task dates, key dates, rates, settings, both totals, bid days and span', () => {
    const s = live()
    expect(s.kind).toBe(SNAPSHOT_KIND)
    expect(s.phases.map(p => [p.id, p.parent_phase_id])).toEqual([['ph1', null], ['ph2', 'ph1']])
    expect(s.tasks[0]).toMatchObject({ id: 't1', start_date: '2026-09-02', end_date: '2026-09-04', bid_days: 2, assigned_role_slug: 'editor', status: 'in_progress' })
    expect(s.milestones).toEqual([expect.objectContaining({ id: 'm1', date: '2026-10-01' })])
    expect(s.roleRates).toEqual(roleRates)
    expect(s).toMatchObject({ marginPct: 10, contingencyPct: 5, agencyEnabled: true, agencyPct: 15, totalBidDays: 3.5 })
    expect(s.totals).toMatchObject({ overall: 2860, beforeAgency: 2530 })
    expect(s.span).toEqual({ start: '2026-09-01', end: '2026-10-01' })
    expect(s.spanDays).toBe(30)
    expect(s.saved_by).toBe('u1')
  })
  it('🚨 never carries logged_days (logged time is the truth; a version carries bid days)', () => {
    const s = live()
    for (const t of s.tasks) expect(t).not.toHaveProperty('logged_days')
    expect(JSON.stringify(s)).not.toMatch(/logged/)
  })
  it('leaves trashed key dates out', () => {
    const s = snapshotFromLive({ tasks, phases, milestones: [...milestones, { id: 'm2', date: '2026-12-01', deleted_at: '2026-10-01T00:00:00Z' }], project, roleRates })
    expect(s.milestones.map(m => m.id)).toEqual(['m1'])
    expect(s.span.end).toBe('2026-10-01')
  })
  it('stores a date as the local day it names (a Date and a string give one value)', () => {
    const s = snapshotFromLive({ tasks: [{ id: 'x', start_date: new Date(2026, 8, 3), end_date: '2026-09-04' }], phases: [], milestones: [], project, roleRates })
    expect(s.tasks[0].start_date).toBe('2026-09-03')
  })
  it('the automatic line is null for the first version and filled against the one before', () => {
    expect(live().delta).toBeNull()
    const prev = snapshotFromLive({ tasks: tasks.slice(0, 1), phases, milestones, project: { ...project, budget_margin_pct: 8 }, roleRates: { editor: 450, director: 800 } })
    const s = snapshotFromLive({ tasks, phases, milestones, project, roleRates, previous: prev, previousName: 'v1' })
    expect(s.delta).toMatchObject({ against: 'v1', bidDays: 1.5, tasksAdded: 1, tasksRemoved: 0, ratesChanged: 1, margin: { from: 8, to: 10 } })
    expect(s.delta.total).toBe(round(s.totals.overall - prev.totals.overall))
  })
})

const round = (n) => Math.round(n * 100) / 100

describe('readVersion — every version keeps showing its numbers', () => {
  it('reads the S5 shape as written', () => {
    const r = readVersion({ snapshot: live() })
    expect(r).toMatchObject({ shape: 'living', overall: 2860, beforeAgency: 2530, overallKnown: true, hasTimeline: true, spanDays: 30, totalBidDays: 3.5 })
  })
  it('an old version (grandTotal, flat tasks) has no timeline and no span, and its overall is its stored total, agency unknown', () => {
    const r = readVersion({ snapshot: { tasks: [{ id: 't1', bid_days: 2 }], grandTotal: 1200, baseCost: 1000, totalBidDays: 2 } })
    expect(r).toMatchObject({ shape: 'old', overall: 1200, beforeAgency: 1200, overallKnown: false, hasTimeline: false, spanDays: null, totalBidDays: 2 })
  })
  it('an old LOCKED version whose lock recorded the fee adds it to the overall', () => {
    const r = readVersion({ snapshot: { grandTotal: 1200, lineItemTotals: { grandTotal: 1200, agencyEnabled: true, agencyAmt: 150, agencyPct: 15 } } })
    expect(r).toMatchObject({ overall: 1350, beforeAgency: 1200, overallKnown: true })
  })
  it('a version with no total at all reads null (never a confident $0)', () => {
    expect(readVersion({ snapshot: { total: 171500, lines: 31 } }).overall).toBeNull()
    expect(readVersion({ snapshot: {} }).overall).toBeNull()
  })
})

describe('varianceAgainst — like with like', () => {
  it('compares the overall totals when the version knows its fee', () => {
    const v = varianceAgainst({ overall: 3000, beforeAgency: 2600 }, readVersion({ snapshot: live() }))
    expect(v).toMatchObject({ basis: 'overall', bidTotal: 2860, currentTotal: 3000, diff: 140 })
  })
  it('CONTROL: an old version that never stored the fee compares the before-agency totals', () => {
    const v = varianceAgainst({ overall: 3000, beforeAgency: 2600 }, readVersion({ snapshot: { grandTotal: 2500 } }))
    expect(v).toMatchObject({ basis: 'beforeAgency', bidTotal: 2500, currentTotal: 2600, diff: 100 })
  })
  it('no total, no variance', () => {
    expect(varianceAgainst({ overall: 1, beforeAgency: 1 }, readVersion({ snapshot: {} }))).toBeNull()
  })
})

describe('versionDiff — "unsaved changes"', () => {
  const saved = live()
  const diffWith = (over) => versionDiff(saved, snapshotFromLive({ tasks, phases, milestones, project, roleRates, ...over }))
  it('the same rows are clean', () => {
    expect(diffWith({}).isDirty).toBe(false)
  })
  it('a rename and a logged day are not unsaved changes to a bid', () => {
    expect(diffWith({ tasks: tasks.map(t => ({ ...t, title: `${t.title}!`, logged_days: 99 })) }).isDirty).toBe(false)
  })
  it('CONTROL: a moved bar, a changed bid day, a new task, a removed task are', () => {
    expect(diffWith({ tasks: tasks.map((t, i) => (i ? t : { ...t, end_date: '2026-09-05' })) }).isDirty).toBe(true)
    expect(diffWith({ tasks: tasks.map((t, i) => (i ? t : { ...t, bid_days: 3 })) }).tasks.changed).toBe(1)
    expect(diffWith({ tasks: [...tasks, { id: 't9', bid_days: 1 }] }).tasks.added).toBe(1)
    expect(diffWith({ tasks: tasks.slice(1) }).tasks.removed).toBe(1)
  })
  it('a phase\'s dates or parent, a key date, a rate, margin, contingency and the agency fee each count', () => {
    expect(diffWith({ phases: phases.map((p, i) => (i ? { ...p, parent_phase_id: null } : p)) }).phases.changed).toBe(1)
    expect(diffWith({ milestones: [{ ...milestones[0], date: '2026-10-02' }] }).milestones.changed).toBe(1)
    expect(diffWith({ roleRates: { ...roleRates, editor: 501 } }).ratesChanged).toEqual(['editor'])
    expect(diffWith({ project: { ...project, budget_margin_pct: 11 } }).settings.margin).toEqual({ from: 10, to: 11 })
    expect(diffWith({ project: { ...project, budget_agency_enabled: false } }).isDirty).toBe(true)
  })
  it('the list the version is based on counts when both are given', () => {
    expect(versionDiff(saved, saved, { shotListId: 'a', liveShotListId: 'a' }).isDirty).toBe(false)
    expect(versionDiff(saved, saved, { shotListId: 'a', liveShotListId: 'b' }).isDirty).toBe(true)
  })
})

describe('planOpen — loading a version into the live rows', () => {
  const saved = live()
  it('a version equal to the live rows plans nothing', () => {
    expect(planIsEmpty(planOpen(saved, { tasks, phases, milestones, project, roleRates }))).toBe(true)
  })
  it('puts back the schedule fields that differ, with what they were, and nothing else', () => {
    const moved = tasks.map((t, i) => (i ? t : { ...t, start_date: '2026-09-10', end_date: '2026-09-12', title: 'Renamed', logged_days: 7 }))
    const plan = planOpen(saved, { tasks: moved, phases, milestones, project, roleRates })
    expect(plan.tasks.update).toEqual([{ id: 't1', patch: { start_date: '2026-09-02', end_date: '2026-09-04' }, before: { start_date: '2026-09-10', end_date: '2026-09-12' } }])
    expect(JSON.stringify(plan)).not.toMatch(/logged_days|Renamed/)
  })
  it('recreates a row the project has lost, with its saved id; leaves a row added since alone (F2)', () => {
    const plan = planOpen(saved, { tasks: [tasks[1], { id: 'new', bid_days: 4 }], phases, milestones: [], project, roleRates })
    expect(plan.tasks.create.map(t => t.id)).toEqual(['t1'])
    expect(plan.tasks.create[0]).not.toHaveProperty('logged_days')
    expect(plan.tasks.update.find(u => u.id === 'new')).toBeUndefined()
    expect(plan.milestones.create.map(m => m.id)).toEqual(['m1'])
  })
  it('recreates a parent phase before its sub-phase', () => {
    const plan = planOpen({ ...saved, phases: [...saved.phases].reverse() }, { tasks, phases: [], milestones, project, roleRates })
    expect(plan.phases.create.map(p => p.id)).toEqual(['ph1', 'ph2'])
  })
  it('restores margin, contingency and the agency fee, and the role rates that differ', () => {
    const plan = planOpen(saved, { tasks, phases, milestones, project: { ...project, budget_margin_pct: 20, budget_agency_enabled: false }, roleRates: { ...roleRates, editor: 600 } })
    expect(plan.settings.patch).toEqual({ budget_margin_pct: 10, budget_agency_enabled: true })
    expect(plan.settings.before).toEqual({ budget_margin_pct: 20, budget_agency_enabled: false })
    expect(plan.rates).toEqual([{ roleSlug: 'editor', rate: 500, before: 600 }])
  })
})

describe('lists of versions', () => {
  const vs = [
    { id: 'a', created_at: '2026-10-01T09:00:00Z', is_active: true },
    { id: 'b', created_at: '2026-10-03T09:00:00Z', is_active: true },
    { id: 'c', created_at: '2026-10-02T09:00:00Z', is_active: false },
  ]
  it('newest first (F13)', () => {
    expect(sortVersionsNewest(vs).map(v => v.id)).toEqual(['b', 'c', 'a'])
  })
  it('the selected bid is the newest selected row when old data holds two', () => {
    expect(selectedVersionOf(vs).id).toBe('b')
    expect(selectedVersionOf(vs.map(v => ({ ...v, is_active: false })))).toBeNull()
  })
  it('the version before another, by created_at', () => {
    expect(previousVersionOf(vs, vs[1]).id).toBe('c')
    expect(previousVersionOf(vs, vs[0])).toBeNull()
  })
})

describe('deltaWords — the automatic line', () => {
  it('names each change, signed, against the version before', () => {
    const words = deltaWords({ against: 'v1', bidDays: 3.5, tasksAdded: 2, tasksRemoved: 1, ratesChanged: 2, margin: { from: 10, to: 12 }, contingency: null, total: -4200, span: 6 }, { money: n => `$${n}`, days: n => String(n) })
    expect(words).toBe('vs v1: +3.5 bid days · 2 tasks added · 1 removed · 2 rates changed · margin 10% → 12% · −$4200 · +6 d')
  })
  it('says "no change" when nothing moved, and nothing at all for the first version', () => {
    expect(deltaWords({ against: 'v1', bidDays: 0, tasksAdded: 0, tasksRemoved: 0, ratesChanged: 0, margin: null, contingency: null, total: 0, span: 0 })).toBe('vs v1: no change')
    expect(deltaWords(null)).toBe('')
  })
})

describe('versionDelta', () => {
  it('reads an OLD previous version too (its total, its bid days)', () => {
    const d = versionDelta({ grandTotal: 2000, totalBidDays: 2, tasks: [{ id: 't1' }] }, live(), 'old')
    expect(d).toMatchObject({ against: 'old', bidDays: 1.5, tasksAdded: 1, span: null })
    expect(d.total).toBe(860)
  })
})

describe('scheduleSpan', () => {
  it('runs from the earliest date to the latest, key dates included; null with no dates', () => {
    expect(scheduleSpan({ tasks, phases, milestones })).toEqual({ start: '2026-09-01', end: '2026-10-01', spanDays: 30 })
    expect(scheduleSpan({ tasks: [{ id: 'x' }] })).toBeNull()
  })
})
