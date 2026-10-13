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

import { describe, it, expect } from 'vitest'
import {
  effectivePct,
  applyMarginAndContingency,
  profit,
  resolveRate,
  buildRoleRates,
} from './budgetMath'

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
