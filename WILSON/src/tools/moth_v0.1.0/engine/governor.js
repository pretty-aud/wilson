// =============================================================================
// governor.js — when M.O.T.H. drops to its lighter mode (MO2a, the brief's
// item 4; MOTH_PLANNING_BRIEF.md §12a.6; PLAN_MOTH.md "Proposed fallback").
//
// Sustained frame failures switch to the light mode; it switches back only
// after a longer run of good frames and a minimum stay (hysteresis), so it
// never flaps. A person's choice in Settings ('full' or 'light') overrides it
// both ways. Reduced motion is a different thing (calm mode, glow.js): it is
// a request about motion, never a claim that the machine is slow.
//
// It is fed only frames that were drawn back to back while something moved;
// an idle Moth draws nothing and therefore records nothing.
// =============================================================================

export const GOVERNOR_DEFAULTS = Object.freeze({
  budgetMs: 20, // the p95 target at 60 fps (PLAN_MOTH §5 Session 2)
  windowFrames: 60,
  enterBadRatio: 0.25, // a window is bad when a quarter of its frames miss the budget…
  enterWindows: 2, // …and two bad windows in a row switch to light
  exitBadRatio: 0.05, // a window is good when almost none miss…
  exitWindows: 4, // …and four good windows in a row switch back
  minDwellMs: 5000, // and never sooner than this after the last switch
})

export const MODES = Object.freeze(['full', 'light'])
export const OVERRIDES = Object.freeze(['auto', 'full', 'light'])

export function createFrameGovernor(options = {}) {
  const o = { ...GOVERNOR_DEFAULTS, ...options }
  const now = typeof o.now === 'function' ? o.now : () => Date.now()
  let auto = 'full'
  let override = OVERRIDES.includes(o.override) ? o.override : 'auto'
  let frames = 0
  let bad = 0
  let badRun = 0
  let goodRun = 0
  let lastSwitch = -Infinity
  let switches = 0

  const mode = () => (override === 'auto' ? auto : override)

  return {
    /** One drawn frame's duration in ms. Returns the mode in effect. */
    record(frameMs) {
      if (!Number.isFinite(frameMs) || frameMs < 0) return mode()
      frames++
      if (frameMs > o.budgetMs) bad++
      if (frames >= o.windowFrames) {
        const ratio = bad / frames
        frames = 0
        bad = 0
        if (ratio >= o.enterBadRatio) { badRun++; goodRun = 0 } else if (ratio <= o.exitBadRatio) { goodRun++; badRun = 0 } else { badRun = 0; goodRun = 0 }
        const t = now()
        if (t - lastSwitch >= o.minDwellMs) {
          if (auto === 'full' && badRun >= o.enterWindows) { auto = 'light'; lastSwitch = t; switches++; badRun = 0 }
          else if (auto === 'light' && goodRun >= o.exitWindows) { auto = 'full'; lastSwitch = t; switches++; goodRun = 0 }
        }
      }
      return mode()
    },
    mode,
    autoMode: () => auto,
    setOverride(v) { override = OVERRIDES.includes(v) ? v : 'auto'; return mode() },
    override: () => override,
    switches: () => switches,
  }
}
