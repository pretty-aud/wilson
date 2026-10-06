// =============================================================================
// periodLabel.test.js — post-overhaul S5c (P1-32a, the Budget's half): the
// Crew/team and Talent period headers read the project's start through
// dates.js and step on the calendar. Run in Audrey's zone (Eastern), where
// both old faults showed: a stored date read as UTC midnight named the day
// before, and 14 × 86,400,000 ms across the clocks going back landed on the
// evening before.
// =============================================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { periodLabel } from './periodLabel'

let zone
beforeAll(() => { zone = process.env.TZ; process.env.TZ = 'America/New_York' })
afterAll(() => { if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone })

describe('periodLabel', () => {
  it('the start date is the day it names, in the header as it always printed (MM/DD)', () => {
    expect(periodLabel(0, 'fortnightly', '2026-12-01')).toBe('P1 12/01')
    expect(periodLabel(0, 'weekly', '2026-12-01')).toBe('Wk1 12/01')
    expect(periodLabel(3, 'count', '2026-12-01')).toBe('#4')
  })
  it('periods step on the calendar, across the clocks going back (1 Nov 2026)', () => {
    expect(periodLabel(1, 'fortnightly', '2026-10-25')).toBe('P2 11/08')
    expect(periodLabel(2, 'weekly', '2026-10-25')).toBe('Wk3 11/08')
    expect(periodLabel(1, 'fortnightly', '2026-03-01')).toBe('P2 03/15')
  })
  it('no start date counts from today, at its midnight', () => {
    expect(periodLabel(1, 'weekly', null, new Date(2026, 9, 5, 18, 30))).toBe('Wk2 10/12')
  })
  it('Crew/team and Talent read their headers here, and no stored date through new Date(…)', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    for (const f of ['CrewTeamTab.jsx', 'TalentTab.jsx']) {
      const src = readFileSync(join(here, f), 'utf8')
      expect(src, f).toMatch(/from '\.\/periodLabel'/)
      expect(src, f).toMatch(/periodLabel\(i, columnMode, projectStart\)/)
      expect(src, f).not.toMatch(/new Date\(/)
    }
  })
})
