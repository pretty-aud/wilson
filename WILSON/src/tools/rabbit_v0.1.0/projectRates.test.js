// =============================================================================
// projectRates.test.js — Session 27.
//
// The rates mirror is the one file in WILSON whose PATH is a security control.
//
// On Supabase, public.rabbit_money_segment() (migration 0042) decides which
// storage paths are manager-only. The three base rabbit-files policies negate
// it; the four money policies assert it. A rates file written to a segment
// that function does not recognise is not "less protected" — it is served to
// any authenticated project member by the base SELECT policy, which is exactly
// the population project_rate_overrides_select denies.
//
// Nothing about that failure is loud. It is the same shape as 0038, which
// shipped the invoice segment in the wrong case and inverted the gate: the
// document became invisible to the managers allowed to read it and visible to
// everybody else, with no error anywhere. 0039 had to fix it in six places.
//
// So these tests are less about the JSON than about the string.
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  RATES_SEGMENT, RATES_FILENAME, RATES_VERSION,
  projectRatesPath, buildProjectRatesMirror, serializeProjectRates,
} from './projectRates'

const PROJECT = { id: 'p1', title: 'Wilson Feature', budget_currency: 'GBP' }

const OVERRIDES = [
  { id: 'r2', member_id: 'u2', role_slug: null, day_rate: 850, wage: 42, currency: 'GBP', notes: 'senior' },
  { id: 'r1', member_id: null, role_slug: 'animator', day_rate: 600, week_rate: 2800 },
]

describe('the gated path', () => {
  it('puts the rates under a THIRD path segment', () => {
    // The gate reads foldername[3]. Two segments means no third element, which
    // is what makes PROJECT.json team-readable — correct for the manifest and
    // catastrophic here.
    const parts = projectRatesPath('p1').split('/')
    expect(parts).toEqual(['projects', 'p1', 'FINANCE', 'RATES.json'])
    expect(parts[2]).toBe(RATES_SEGMENT)
  })

  it('pins the exact segment migration 0042 gates', () => {
    // Asserted literally, not just referenced. A test that only compares the
    // constant to itself passes for any value, including an ungated one.
    expect(RATES_SEGMENT).toBe('FINANCE')
    expect(RATES_FILENAME).toBe('RATES.json')
  })

  it('never lands the rates at the project root', () => {
    // The failure mode with real consequences: a path with no third segment
    // falls through to the base policy and the whole team can read it.
    expect(projectRatesPath('p1').split('/').length).toBeGreaterThan(3)
  })
})

describe('buildProjectRatesMirror', () => {
  it('carries every rate field, keyed by scope', () => {
    const m = buildProjectRatesMirror(PROJECT, OVERRIDES, '2026-08-04T00:00:00Z')
    expect(m.wilson_rates_version).toBe(RATES_VERSION)
    expect(m.count).toBe(2)
    const member = m.overrides.find(o => o.member_id === 'u2')
    expect(member).toMatchObject({ scope: 'member', day_rate: 850, wage: 42, currency: 'GBP' })
    const role = m.overrides.find(o => o.role_slug === 'animator')
    expect(role).toMatchObject({ scope: 'role', day_rate: 600, week_rate: 2800 })
  })

  it('marks exactly one axis per row', () => {
    // The database CHECK refuses a row keyed by both, because it would have no
    // single resolution order. The mirror has to be readable the same way.
    for (const o of buildProjectRatesMirror(PROJECT, OVERRIDES).overrides) {
      expect(o.scope === 'member' ? !!o.member_id : !!o.role_slug).toBe(true)
      if (o.scope === 'member') expect(o.role_slug).toBeNull()
    }
  })

  it('is stable across runs so a re-write is not a spurious diff', () => {
    const a = serializeProjectRates(buildProjectRatesMirror(PROJECT, OVERRIDES, 'T'))
    const b = serializeProjectRates(buildProjectRatesMirror(PROJECT, [...OVERRIDES].reverse(), 'T'))
    expect(a).toBe(b)
  })

  it('states its own confidentiality inside the file', () => {
    // Someone who finds this on a drive has none of the surrounding context.
    // The two things they must learn from the file itself are that editing it
    // changes nothing and that it is not for passing around.
    const m = buildProjectRatesMirror(PROJECT, OVERRIDES)
    expect(m.authority).toBe('database')
    expect(m.confidentiality).toMatch(/MANAGER-ONLY/)
    expect(m.note).toMatch(/MIRROR/)
  })

  it('adds a member name only when the caller supplies one', () => {
    // A rates file listing bare UUIDs is useless for the one job it has.
    const named = buildProjectRatesMirror(PROJECT, OVERRIDES, null, { u2: 'Sam Reyes' })
    expect(named.overrides.find(o => o.member_id === 'u2').member_name).toBe('Sam Reyes')
    const bare = buildProjectRatesMirror(PROJECT, OVERRIDES)
    expect(bare.overrides.find(o => o.member_id === 'u2')).not.toHaveProperty('member_name')
  })

  it('survives an empty or missing override list', () => {
    // Clearing the last override must still write a file — one that says
    // "none" — rather than leaving the previous rates in the folder as though
    // they were current.
    expect(buildProjectRatesMirror(PROJECT, []).count).toBe(0)
    expect(buildProjectRatesMirror(PROJECT, undefined).overrides).toEqual([])
    expect(buildProjectRatesMirror(null, null).project_id).toBeNull()
  })

  it('does not leak the raw database row', () => {
    // The override rows carry workspace_id and audit columns. The mirror is a
    // description of the project, not a table dump.
    const m = buildProjectRatesMirror(PROJECT, [
      { id: 'r1', role_slug: 'a', day_rate: 1, workspace_id: 'ws', created_by: 'u9' },
    ])
    expect(m.overrides[0]).not.toHaveProperty('workspace_id')
    expect(m.overrides[0]).not.toHaveProperty('created_by')
    expect(m.overrides[0]).not.toHaveProperty('id')
  })
})
