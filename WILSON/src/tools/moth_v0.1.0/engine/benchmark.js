// =============================================================================
// benchmark.js — measuring the engine against PLAN_MOTH's targets (MO2a, the
// brief's item 5): 1,000 dots and 2,000 lines at 60 fps with p95 frames at or
// under 20 ms; low power 300 and 600 at 30 fps, p95 at or under 34 ms;
// feedback within 100 ms; no loop when settled.
//
// What a page needs to read its own frames: frameStats() summarises samples,
// and createFrameRecorder() collects the renderer's per-frame numbers through
// its onFrame hook. MO2's caller is the debug-mode frame readout, which is
// how the acceptance replay on her PC reads the targets with the debug
// sample and her saved local test project (PLAN_MOTH §9 Q6). MO2a measured
// in the cloud on the fixture generator with a scratch harness that is not
// committed (the hand-off records the machine, the procedure and the numbers).
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

/**
 * Collects the renderer's per-frame numbers (pass recorder.onFrame to
 * createRenderer): script work, and the sample the governor saw (the larger
 * of work and lateness during motion).
 */
export function createFrameRecorder() {
  let work = []
  let sample = []
  return {
    onFrame(s) {
      if (!s) return
      if (Number.isFinite(s.workMs)) work.push(s.workMs)
      if (Number.isFinite(s.sampleMs)) sample.push(s.sampleMs)
    },
    reset() { work = []; sample = [] },
    work: () => frameStats(work),
    sample: () => frameStats(sample),
  }
}
