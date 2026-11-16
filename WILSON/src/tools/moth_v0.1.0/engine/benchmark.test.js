// =============================================================================
// benchmark.test.js — the measuring helpers (MO2a). The numbers themselves
// are measured in a browser (the hand-off records them); here: the statistics
// are right and the recorder keeps what the renderer reports.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { frameStats, createFrameRecorder, TARGETS } from './benchmark.js'

describe('benchmark helpers', () => {
  it('nearest-rank percentiles over 1..100', () => {
    const s = frameStats(Array.from({ length: 100 }, (_, i) => i + 1).reverse())
    expect([s.count, s.p50, s.p95, s.max]).toEqual([100, 50, 95, 100])
    expect(s.mean).toBe(50.5)
  })

  it('CONTROL: a p95 read off the unsorted list is caught by the same check', () => {
    const xs = Array.from({ length: 100 }, (_, i) => 100 - i)
    const wrong = xs[Math.ceil(0.95 * xs.length) - 1]
    expect(wrong).not.toBe(frameStats(xs).p95)
  })

  it('empty or junk input gives nulls, not NaN', () => {
    expect(frameStats([NaN, undefined]).p95).toBe(null)
  })

  it('the recorder keeps work and governor samples, and resets', () => {
    const r = createFrameRecorder()
    r.onFrame({ workMs: 3, sampleMs: 16 }); r.onFrame({ workMs: 5, sampleMs: 40 }); r.onFrame({}); r.onFrame(null)
    expect(r.work().count).toBe(2)
    expect(r.sample().max).toBe(40)
    r.reset()
    expect(r.work().count).toBe(0)
    expect(r.sample().count).toBe(0)
  })

  it('the targets are the plan\'s numbers (PLAN_MOTH §5 Session 2)', () => {
    expect(TARGETS.normal).toEqual({ dots: 1000, lines: 2000, fps: 60, p95Ms: 20 })
    expect(TARGETS.lowPower).toEqual({ dots: 300, lines: 600, fps: 30, p95Ms: 34 })
    expect(TARGETS.feedbackMs).toBe(100)
  })
})
