// =============================================================================
// governor.test.js — the lighter mode (MO2a; MOTH_PLANNING_BRIEF.md §12a.6;
// PLAN_MOTH "Proposed fallback"): sustained frame failures switch to light,
// with hysteresis and a manual override. Each rule has a PLANTED control.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { createFrameGovernor, GOVERNOR_DEFAULTS } from './governor.js'

const W = GOVERNOR_DEFAULTS.windowFrames

/** Feed `windows` windows whose share of slow frames is `badRatio`, `dt` ms apart per window. */
function feed(g, clock, windows, badRatio, dt = 2000) {
  for (let w = 0; w < windows; w++) {
    clock.t += dt
    const bad = Math.round(W * badRatio)
    for (let i = 0; i < W; i++) g.record(i < bad ? 40 : 8)
  }
  return g.mode()
}

const make = (o = {}) => {
  const clock = { t: 0 }
  return { clock, g: createFrameGovernor({ now: () => clock.t, ...o }) }
}

describe('frame governor', () => {
  it('starts full and stays full on good frames', () => {
    const { g, clock } = make()
    expect(feed(g, clock, 10, 0)).toBe('full')
  })

  it('one bad window is a hiccup, not a switch; sustained failure switches to light', () => {
    const { g, clock } = make()
    expect(feed(g, clock, 1, 0.5)).toBe('full')
    expect(feed(g, clock, 1, 0)).toBe('full') // the run is broken
    expect(feed(g, clock, 1, 0.5)).toBe('full')
    expect(feed(g, clock, 1, 0.5)).toBe('light')
    expect(g.switches()).toBe(1)
  })

  it('hysteresis: back to full only after four good windows, never on the first', () => {
    const { g, clock } = make()
    feed(g, clock, 2, 0.5)
    expect(g.mode()).toBe('light')
    expect(feed(g, clock, 1, 0)).toBe('light')
    expect(feed(g, clock, 2, 0)).toBe('light')
    expect(feed(g, clock, 1, 0)).toBe('full')
  })

  it('a middling window (between the two thresholds) neither enters nor leaves', () => {
    const { g, clock } = make()
    feed(g, clock, 2, 0.5)
    expect(feed(g, clock, 3, 0)).toBe('light')
    expect(feed(g, clock, 1, 0.15)).toBe('light') // resets the good run
    expect(feed(g, clock, 3, 0)).toBe('light')
    expect(feed(g, clock, 1, 0)).toBe('full')
  })

  it('it never flips sooner than the minimum stay', () => {
    const { g, clock } = make({ minDwellMs: 60000 })
    feed(g, clock, 2, 0.5)
    expect(g.mode()).toBe('light')
    expect(feed(g, clock, 8, 0, 1000)).toBe('light') // 8 s of good frames: too soon
    expect(feed(g, clock, 4, 0, 20000)).toBe('full')
  })

  it('CONTROL: a governor without hysteresis flaps on alternating windows; this one does not', () => {
    const flappy = () => {
      let m = 'full'
      return { record: (bad) => (m = bad ? 'light' : 'full'), mode: () => m }
    }
    const f = flappy()
    const seen = new Set()
    for (let i = 0; i < 8; i++) { f.record(i % 2 === 0); seen.add(f.mode()) }
    expect(seen.size).toBe(2) // the naive one flaps
    const { g, clock } = make()
    const modes = new Set()
    for (let i = 0; i < 8; i++) modes.add(feed(g, clock, 1, i % 2 === 0 ? 0.5 : 0))
    expect([...modes]).toEqual(['full']) // ours never left
  })

  it('the manual override wins both ways and auto returns to the measured mode', () => {
    const { g, clock } = make()
    expect(g.setOverride('light')).toBe('light')
    expect(feed(g, clock, 6, 0)).toBe('light')
    g.setOverride('auto')
    expect(g.mode()).toBe('full')
    feed(g, clock, 2, 0.5)
    expect(g.setOverride('full')).toBe('full')
    expect(g.autoMode()).toBe('light')
    expect(g.setOverride('nonsense')).toBe('light') // unknown means auto
  })

  it('ignores junk samples (no frame, no change)', () => {
    const { g } = make()
    for (const v of [NaN, -1, Infinity, undefined]) g.record(v)
    expect(g.mode()).toBe('full')
  })
})
