// ============================================================
// budgetMath.test.js — Session 24
// ============================================================
//
// Before this file there was ZERO automated coverage of money arithmetic at
// any layer — no vitest, no pgTAP. That is the same gap that let a total
// failure of task creation ship unnoticed (OUTSTANDING, S23), except the
// blast radius here is what a production is bid at and whether it made a
// profit.
//
// Each block below pins a rule that is easy to "simplify" into a bug, and
// says what the bug would look like.
//
// Post-overhaul F2 (OUTSTANDING REV-02): the project's settings, the
// task-based bid and one line's money moved in, with bidTotals' tests from
// budgetVersionModel.test.js; the last block reads the Budget's files so no
// copy of a rule comes back.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  effectivePct,
  applyMarginAndContingency,
  profit,
  resolveRate,
  buildRoleRates,
  round2,
  AGENCY_DEFAULT_PCT,
  projectBudgetSettings,
  taskBaseCost,
  bidTotals,
  lineMoney,
} from './budgetMath'
import { selectProjectBudgetRollup } from '../../tools/rabbit_v0.1.0/state/selectors'

describe('effectivePct — the project default is a FALLBACK, not a seed', () => {
  it('inherits the project default when the line has not set one', () => {
    expect(effectivePct(null, 12.5)).toBe(12.5)
    expect(effectivePct(undefined, 12.5)).toBe(12.5)
  })

  it('uses the line value when it has one', () => {
    expect(effectivePct(20, 12.5)).toBe(20)
  })

  // 🚨 The one that matters. `0` is a deliberate "no margin on this line".
  // Writing `line.margin_pct || projectDefault` would promote every explicit
  // 0% to the project default — a silent over-bid nobody notices until a
  // reconciliation. This test fails the moment someone makes that edit.
  it('treats an explicit ZERO as a real value, not as absent', () => {
    expect(effectivePct(0, 12.5)).toBe(0)
    expect(effectivePct('0', 12.5)).toBe(0)
  })

  it('falls back to 0 when neither the line nor the project has a value', () => {
    expect(effectivePct(null, null)).toBe(0)
    expect(effectivePct(undefined, undefined)).toBe(0)
  })

  // Resetting a line to inherit is done by writing NULL back
  // (CrewTeamTab.jsx:439). Pin that round trip.
  it('a line reset to NULL starts inheriting again', () => {
    expect(effectivePct(35, 10)).toBe(35)
    expect(effectivePct(null, 10)).toBe(10)
  })
})

describe('applyMarginAndContingency — both apply to the BASE, never compounded', () => {
  it('computes each on the base cost independently', () => {
    const r = applyMarginAndContingency(1000, 20, 10)
    expect(r.marginAmt).toBe(200)
    expect(r.contingencyAmt).toBe(100)
    expect(r.total).toBe(1300)
  })

  // 🚨 The compounding bug. If contingency were applied first and margin
  // charged on top (1000 -> 1100 -> +20% = 1320), the total would be 1320,
  // not 1300. A budget that applies these in the wrong order is wrong in a
  // way nobody notices for months, so the difference is asserted explicitly.
  it('does NOT charge margin on top of contingency', () => {
    const r = applyMarginAndContingency(1000, 20, 10)
    expect(r.total).toBe(1300)
    expect(r.total).not.toBe(1320)
  })

  it('keeps base, margin and contingency separately so profit stays derivable', () => {
    const r = applyMarginAndContingency(2500, 15, 5)
    // Actual cost to the company is recoverable by subtraction — which is
    // impossible if only the marked-up total is stored.
    expect(r.total - r.marginAmt - r.contingencyAmt).toBe(r.baseCost)
  })

  it('rounds money to 2dp', () => {
    const r = applyMarginAndContingency(333.33, 7.5, 0)
    expect(r.marginAmt).toBe(25)
    expect(r.total).toBe(358.33)
  })

  it('is a no-op at 0% and 0%', () => {
    const r = applyMarginAndContingency(1000, 0, 0)
    expect(r.total).toBe(1000)
    expect(r.marginAmt).toBe(0)
  })
})

describe('profit — bid minus what it really cost', () => {
  it('is positive when the job came in under the bid', () => {
    expect(profit(1300, 1000)).toBe(300)
  })

  it('goes negative when actuals overrun the bid', () => {
    expect(profit(1300, 1500)).toBe(-200)
  })

  // Profit is NOT the planned margin. The whole reason actuals are tracked
  // per pay period is that the two come apart.
  it('is not the same figure as the margin that was planned', () => {
    const bid = applyMarginAndContingency(1000, 20, 10)
    expect(bid.marginAmt).toBe(200)
    expect(profit(bid.total, 1250)).toBe(50)   // overran; profit != 200
  })
})

describe('resolveRate — project override beats the company rate card', () => {
  const entries = [
    { role_slug: 'animator', day_rate: 800, wage: 500 },
    { role_slug: 'producer', member_id: 'u1', day_rate: 1000, wage: 600 },
  ]

  it('falls back to the company rate card when there is no override', () => {
    const r = resolveRate({ roleSlug: 'animator', entries, overrides: [] })
    expect(r.rate).toBe(800)
    expect(r.source).toBe('rate_card_role')
  })

  // 🚨 The point of the whole override table.
  it('prefers a project override for the role', () => {
    const overrides = [{ role_slug: 'animator', day_rate: 950 }]
    const r = resolveRate({ roleSlug: 'animator', entries, overrides })
    expect(r.rate).toBe(950)
    expect(r.source).toBe('project_override_role')
  })

  it('prefers a person-scoped override over a role-scoped one', () => {
    const overrides = [
      { role_slug: 'producer', day_rate: 900 },
      { member_id: 'u1', wage: 700 },
    ]
    const r = resolveRate({
      roleSlug: 'producer', memberId: 'u1', entries, overrides, preferInternal: true,
    })
    expect(r.rate).toBe(700)
    expect(r.source).toBe('project_override_member')
  })

  // Assigning a real person switches the line to their INTERNAL rate; the
  // external/day rate is mainly a bidding instrument.
  it('uses the internal rate once a real person holds the line', () => {
    const r = resolveRate({ memberId: 'u1', entries, overrides: [], preferInternal: true })
    expect(r.rate).toBe(600)
    expect(r.source).toBe('rate_card_member')
  })

  it('uses the external day rate while the line is still an unstaffed role', () => {
    const r = resolveRate({ roleSlug: 'animator', entries, overrides: [], preferInternal: false })
    expect(r.rate).toBe(800)
  })

  // 🚨 A missing rate and a genuine zero rate are different facts. Returning
  // 0 for "no rate yet" is how a bid silently under-quotes.
  it('returns null — not 0 — when nothing prices the line', () => {
    const r = resolveRate({ roleSlug: 'nobody-has-this', entries, overrides: [] })
    expect(r.rate).toBeNull()
    expect(r.source).toBe('none')
  })

  it('honours a genuine zero rate rather than treating it as absent', () => {
    const r = resolveRate({
      roleSlug: 'intern', entries: [{ role_slug: 'intern', day_rate: 0 }], overrides: [],
    })
    expect(r.rate).toBe(0)
    expect(r.source).toBe('rate_card_role')
  })
})

describe('buildRoleRates — the slug -> rate map the budget tabs consume', () => {
  const entries = [
    { role_slug: 'animator', day_rate: 800 },
    { role_slug: 'editor', day_rate: 700 },
  ]

  it('maps every rate-card role', () => {
    expect(buildRoleRates(entries, [])).toEqual({ animator: 800, editor: 700 })
  })

  it('lets a project override win', () => {
    const map = buildRoleRates(entries, [{ role_slug: 'animator', day_rate: 950 }])
    expect(map.animator).toBe(950)
    expect(map.editor).toBe(700)
  })

  // A person-scoped override prices one line, not the whole role.
  it('ignores person-scoped overrides when building the ROLE map', () => {
    const map = buildRoleRates(entries, [{ member_id: 'u1', role_slug: null, day_rate: 5 }])
    expect(map.animator).toBe(800)
  })

  it('is empty when there is no rate card at all', () => {
    // The live state of the beta on 2026-08-03: zero rate cards, zero
    // entries. Every total is legitimately zero until Audrey enters rates,
    // and the UI must say so rather than rendering a confident $0.
    expect(buildRoleRates([], [])).toEqual({})
  })
})

describe('projectBudgetSettings — the project\'s settings, read once for every surface (F2)', () => {
  // Audrey's ruling of 2026-10-31: with the fee switched on and no
  // percentage ever typed, the fee is 20%. Before F2 the Summary read 20 and
  // the Crew tab, the Topsheet and the line computations read 0.
  it('the agency fee is 20% when it is on and no percentage was ever typed', () => {
    expect(AGENCY_DEFAULT_PCT).toBe(20)
    for (const unset of [undefined, null, '']) {
      expect(projectBudgetSettings({ budget_agency_enabled: true, budget_agency_pct: unset }).agencyPct, String(unset)).toBe(20)
    }
  })
  it('CONTROL: a typed percentage is kept — a typed 0 included', () => {
    expect(projectBudgetSettings({ budget_agency_enabled: true, budget_agency_pct: 0 }).agencyPct).toBe(0)
    expect(projectBudgetSettings({ budget_agency_enabled: true, budget_agency_pct: 10 }).agencyPct).toBe(10)
    expect(projectBudgetSettings({ budget_agency_enabled: true, budget_agency_pct: '12.5' }).agencyPct).toBe(12.5)
  })
  it('margin and contingency are 0 when unset; the fee is off unless switched on', () => {
    expect(projectBudgetSettings({})).toEqual({ marginPct: 0, contingencyPct: 0, agencyEnabled: false, agencyPct: 20 })
    expect(projectBudgetSettings(null)).toEqual({ marginPct: 0, contingencyPct: 0, agencyEnabled: false, agencyPct: 20 })
    expect(projectBudgetSettings({ budget_margin_pct: 12, budget_contingency_pct: '5', budget_agency_enabled: 'yes' }))
      .toMatchObject({ marginPct: 12, contingencyPct: 5, agencyEnabled: false })
  })
})

describe('taskBaseCost — the task-based base, one loop', () => {
  const roleRates = { editor: 500, director: 800 }
  it('sums bid days × the role\'s rate, by role; a task with no role is "unassigned", a role with no rate the fallback', () => {
    const tasks = [
      { bid_days: 2, assigned_role_slug: 'editor' }, { bid_days: 1.5, assigned_role_slug: 'director' },
      { bid_days: 1, assigned_role_slug: 'editor' }, { bid_days: 3, assigned_role_slug: 'nobody' },
      { bid_days: 2 }, { bid_days: 0, assigned_role_slug: 'editor' }, null,
    ]
    const r = taskBaseCost({ tasks, roleRates, fallbackDayRate: 100 })
    expect(r.total).toBe(1500 + 1200 + 300 + 200)
    expect(r.byRole.editor).toEqual({ role: 'editor', days: 3, cost: 1500 })
    expect(r.byRole.nobody).toEqual({ role: 'nobody', days: 3, cost: 300 })
    expect(r.byRole.unassigned).toEqual({ role: 'unassigned', days: 2, cost: 200 })
  })
  it('the selectors\' rollup is this loop', () => {
    const tasks = [{ bid_days: 2, assigned_role_slug: 'editor' }, { bid_days: 3, assigned_role_slug: 'nobody' }]
    expect(selectProjectBudgetRollup({ tasks, roleRates, fallbackDayRate: 50, currency: 'EUR' }))
      .toEqual({ ...taskBaseCost({ tasks, roleRates, fallbackDayRate: 50 }), currency: 'EUR' })
  })
})

// Moved from budgetVersionModel.test.js with bidTotals (F2).
describe('bidTotals — the Budget screen\'s arithmetic, once (F7)', () => {
  const project = {
    id: 'p1', budget_margin_pct: 10, budget_contingency_pct: 5,
    budget_agency_enabled: true, budget_agency_pct: 15,
  }
  const roleRates = { editor: 500, director: 800 }
  const tasks = [
    { id: 't1', bid_days: 2, assigned_role_slug: 'editor' },
    { id: 't2', bid_days: 1.5, assigned_role_slug: 'director' },
  ]
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
  it('with the fee on and no percentage typed, the fee is the one default, 20% of the base', () => {
    const t = bidTotals({ tasks, roleRates, ...projectBudgetSettings({ ...project, budget_agency_pct: undefined }) })
    expect(t.agencyAmt).toBe(440)
    expect(t.overall).toBe(2970)
  })
})

describe('lineMoney — one line\'s money, every tab\'s (F2)', () => {
  const on10 = projectBudgetSettings({ budget_contingency_pct: 5, budget_agency_enabled: true, budget_agency_pct: 10 })

  // 🚨 REV-02. The Crew tab charged margin and contingency on the base PLUS
  // the agency fee (2000 + 200 → +$220 and +$110) and the Talent tab on the
  // base plus both fees; handbook §17's rule, and bidTotals', is the base.
  it('margin and contingency on the BASE, never on the base plus the fees', () => {
    const m = lineMoney(2000, { sheet: 'crew', margin_pct: 10, contingency_pct: null }, on10)
    expect(m).toEqual({ marginPct: 10, contingencyPct: 5, marginAmt: 200, contingencyAmt: 100, agencyFee: 200, bidTotal: 2200 })
    expect(m.marginAmt).not.toBe(220)
    expect(m.contingencyAmt).not.toBe(110)
  })
  it('the agency fee: the project\'s when it is on, the one default when none was typed, none when off or opted out', () => {
    const none = projectBudgetSettings({ budget_agency_enabled: true })
    expect(lineMoney(2000, null, none).agencyFee).toBe(400)
    expect(lineMoney(2000, null, none).bidTotal).toBe(2400)
    expect(lineMoney(2000, { agency_opt_out: true }, none).agencyFee).toBe(0)
    expect(lineMoney(2000, null, { ...none, agencyEnabled: false }).agencyFee).toBe(0)
  })
  it('a talent line\'s own representation fee stacks with the agency fee, both on the base', () => {
    const talent = { sheet: 'talent', talent_agency_fee_pct: 15 }
    const none = projectBudgetSettings({ budget_agency_enabled: true })
    expect(lineMoney(9000, talent, none)).toMatchObject({ agencyFee: 3150, bidTotal: 12150 })
    expect(lineMoney(9000, talent, { ...none, agencyEnabled: false })).toMatchObject({ agencyFee: 1350, bidTotal: 10350 })
    // CONTROL: the representation fee is a talent line's alone.
    expect(lineMoney(9000, { ...talent, sheet: 'crew' }, none).agencyFee).toBe(1800)
  })
  it('a line\'s own percentage wins, an explicit 0 included; none inherits the project\'s', () => {
    expect(lineMoney(1000, { margin_pct: 0, contingency_pct: 0 }, { marginPct: 12, contingencyPct: 8 }))
      .toMatchObject({ marginPct: 0, contingencyPct: 0, marginAmt: 0, contingencyAmt: 0 })
    expect(lineMoney(1000, { margin_pct: null }, { marginPct: 12, contingencyPct: 8 }))
      .toMatchObject({ marginPct: 12, contingencyPct: 8, marginAmt: 120, contingencyAmt: 80 })
    expect(lineMoney(1000, null, null)).toEqual({ marginPct: 0, contingencyPct: 0, marginAmt: 0, contingencyAmt: 0, agencyFee: 0, bidTotal: 1000 })
  })
  it('rounds each amount to cents, as applyMarginAndContingency and bidTotals do', () => {
    const m = lineMoney(333.33, { sheet: 'talent', talent_agency_fee_pct: 15, margin_pct: 7.5 }, projectBudgetSettings({}))
    expect(m.marginAmt).toBe(25)
    expect(m.agencyFee).toBe(50)
    expect(round2(49.995)).toBe(50)
  })
})

// The Budget's files, read: every rule above is defined here and nowhere else.
describe('one module: no Budget surface keeps a copy of a rule (F2)', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const rabbit = join(here, '../../tools/rabbit_v0.1.0')
  const FILES = [
    ...readdirSync(here).filter(f => /\.jsx?$/.test(f) && !/\.test\./.test(f) && f !== 'budgetMath.js').map(f => join(here, f)),
    join(rabbit, 'views/BudgetView.jsx'),
    ...readdirSync(join(rabbit, 'views/budget')).filter(f => /\.jsx?$/.test(f) && !/\.test\./.test(f)).map(f => join(rabbit, 'views/budget', f)),
    join(rabbit, 'state/budgetVersionModel.js'),
    join(rabbit, 'state/selectors.js'),
  ]
  const code = (f) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  // The three shapes the copies took: the inheritance rule inline (fourteen
  // times), a settings read with a default of its own (four, two defaults),
  // and a second round2.
  const COPY = [
    /_pct\s*!=\s*null\s*\?\s*Number\(/,
    /budget_(margin|contingency|agency)_pct\s*\?\?/,
    /\bround2\s*=|function\s+round2\b/,
  ]
  const copiesIn = (text) => COPY.filter(re => re.test(text)).map(String)

  it('no file reads a percentage itself, defaults one, or rounds money its own way', () => {
    expect(FILES.length).toBeGreaterThan(12)
    for (const f of FILES) expect(copiesIn(code(f)), f).toEqual([])
  })
  it('CONTROL: each shape the copies took is caught', () => {
    for (const planted of [
      'const mPct = line.margin_pct != null ? Number(line.margin_pct) : defaultMarginPct',
      'const agencyPct = Number(project?.budget_agency_pct ?? 0) / 100',
      'const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100',
      'function round2(n) { return n }',
    ]) expect(copiesIn(planted), planted).toHaveLength(1)
  })
})
