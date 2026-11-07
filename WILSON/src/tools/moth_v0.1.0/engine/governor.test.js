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

  // A machine where full frames cost 28 ms and light frames 12 ms of script:
  // light is cheaper by design, so "good in light" must not mean "go back".
  const runOwnEffect = (g, clock, seconds) => {
    for (let s = 0; s < seconds; s++) {
      clock.t += 1000
      for (let i = 0; i < 60; i++) {
        const ms = g.mode() === 'light' ? 12 : 28
        g.record(ms, ms)
      }
    }
    return g.switches()
  }

  it('under its own effect it switches once and stays (no flapping, design round U29)', () => {
    const { g, clock } = make()
    expect(runOwnEffect(g, clock, 120)).toBe(1)
    expect(g.mode()).toBe('light')
  })

  it('CONTROL: an exit rule that only asks "under budget in light" flaps on the same machine', () => {
    let mode = 'full'
    let switches = 0
    let badRun = 0
    let goodRun = 0
    let last = -Infinity
    for (let s = 0; s < 120; s++) {
      const ms = mode === 'light' ? 12 : 28
      if (ms > 20) { badRun++; goodRun = 0 } else { goodRun++; badRun = 0 }
      if (s * 1000 - last >= 5000) {
        if (mode === 'full' && badRun >= 2) { mode = 'light'; switches++; last = s * 1000 }
        else if (mode === 'light' && goodRun >= 4) { mode = 'full'; switches++; last = s * 1000 }
      }
    }
    expect(switches).toBeGreaterThan(1)
  })

  it('a healthy 60 Hz machine leaves light: frames 16.7 ms late but 2 ms of script count as headroom', () => {
    const { g, clock } = make()
    feed(g, clock, 2, 0.5) // into light
    expect(g.mode()).toBe('light')
    for (let w = 0; w < 4; w++) {
      clock.t += 2000
      for (let i = 0; i < W; i++) g.record(16.7, 2)
    }
    expect(g.mode()).toBe('full')
  })

  it('CONTROL: judging headroom on the frame time (not the script work) never leaves light at 60 Hz', () => {
    const { g, clock } = make()
    feed(g, clock, 2, 0.5)
    for (let w = 0; w < 8; w++) {
      clock.t += 2000
      for (let i = 0; i < W; i++) g.record(16.7) // workMs defaults to the frame time
    }
    expect(g.mode()).toBe('light')
  })

  it('dropping back to light soon after leaving doubles the next minimum stay', () => {
    const { g, clock } = make()
    feed(g, clock, 2, 0.5) // light at t=4 s
    feed(g, clock, 4, 0) // full at t=12 s (dwell 5 s met)
    feed(g, clock, 3, 0.5) // light again at t=18 s (5 s after the last switch): the stay becomes 10 s
    expect(g.mode()).toBe('light')
    expect(feed(g, clock, 4, 0)).toBe('light') // t=26 s: only 8 s since the switch
    expect(feed(g, clock, 1, 0)).toBe('full') // t=28 s: 10 s
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
