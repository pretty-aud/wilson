// =============================================================================
// benchmark.test.js — the measuring helpers (MO2a). The numbers themselves
// are measured in a browser (the hand-off records them); here: the statistics
// are right, and the driver stops when asked.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { frameStats, createFrameRecorder, driveMotion, meetsTarget, TARGETS } from './benchmark.js'

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

  it('the recorder keeps work times only', () => {
    const r = createFrameRecorder()
    r.onFrame({ workMs: 3 }); r.onFrame({ workMs: 5 }); r.onFrame({}); r.onFrame(null)
    expect(r.work().count).toBe(2)
    r.reset()
    expect(r.work().count).toBe(0)
  })

  it('driveMotion steps exactly N times and measures N intervals', async () => {
    let t = 0
    const steps = []
    const res = await driveMotion({ frames: 5, step: (i) => steps.push(i), requestFrame: (fn) => setTimeout(() => fn((t += 16)), 0) })
    expect(steps).toEqual([0, 1, 2, 3, 4])
    expect(res.intervals.count).toBe(5)
    expect(res.intervals.p95).toBe(16)
  })

  it('meetsTarget needs both the work and the interval under the p95 line', () => {
    const ok = { work: { p95: 4 }, intervals: { p95: 16.8 } }
    const slow = { work: { p95: 4 }, intervals: { p95: 33 } }
    expect(meetsTarget(ok, TARGETS.normal)).toBe(true)
    expect(meetsTarget(slow, TARGETS.normal)).toBe(false)
    expect(meetsTarget(slow, TARGETS.lowPower)).toBe(true)
  })
})
