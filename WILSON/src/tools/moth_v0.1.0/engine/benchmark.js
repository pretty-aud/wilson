// =============================================================================
// benchmark.js — measuring the engine against PLAN_MOTH's targets (MO2a, the
// brief's item 5): 1,000 dots and 2,000 lines at 60 fps with p95 frames at or
// under 20 ms; low power 300 and 600 at 30 fps, p95 at or under 34 ms;
// feedback within 100 ms; no loop when settled.
//
// Two parts. frameStats() summarises samples. driveMotion() moves the camera
// once per animation frame for N frames and records the frame intervals;
// the renderer's own work per frame comes from its onFrame hook through a
// recorder. MO2 replays this on her PC with the debug sample and her saved
// local test project (PLAN_MOTH §9 Q6); MO2a ran it in the cloud on the
// fixture generator (the hand-off records the machine and the numbers).
// =============================================================================

export const TARGETS = Object.freeze({
  normal: Object.freeze({ dots: 1000, lines: 2000, fps: 60, p95Ms: 20 }),
  lowPower: Object.freeze({ dots: 300, lines: 600, fps: 30, p95Ms: 34 }),
  feedbackMs: 100,
})

/** p50, p95, max and mean of a list of milliseconds (nearest-rank percentiles). */
export function frameStats(samples) {
  const xs = samples.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  const n = xs.length
  if (!n) return { count: 0, p50: null, p95: null, max: null, mean: null, fps: null }
  const rank = (p) => xs[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))]
  const mean = xs.reduce((s, v) => s + v, 0) / n
  return { count: n, p50: rank(0.5), p95: rank(0.95), max: xs[n - 1], mean, fps: mean > 0 ? 1000 / mean : null }
}

/** Collects the renderer's per-frame work (pass recorder.onFrame to createRenderer). */
export function createFrameRecorder() {
  let work = []
  return {
    onFrame(s) { if (s && Number.isFinite(s.workMs)) work.push(s.workMs) },
    reset() { work = [] },
    work: () => frameStats(work),
  }
}

/**
 * Call step(i) once per animation frame for `frames` frames and resolve with
 * the intervals between frames: { intervals: frameStats }.
 */
export function driveMotion({ frames = 300, step, requestFrame = (fn) => requestAnimationFrame(fn) }) {
  return new Promise((resolve) => {
    const gaps = []
    let prev = null
    let i = 0
    const tick = (ts) => {
      if (prev != null) gaps.push(ts - prev)
      prev = ts
      if (i >= frames) { resolve({ intervals: frameStats(gaps) }); return }
      step(i++)
      requestFrame(tick)
    }
    requestFrame(tick)
  })
}

/** Whether a run meets a target: p95 of both the work and the frame interval. */
export function meetsTarget(result, target) {
  const p95 = Math.max(result.work.p95 ?? Infinity, result.intervals.p95 ?? Infinity)
  return p95 <= target.p95Ms
}
