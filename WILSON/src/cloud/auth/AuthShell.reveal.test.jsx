/** @vitest-environment jsdom */
// =============================================================================
// AuthShell.reveal.test.jsx — post-overhaul S6a (2026-10-09).
//
// Audrey: after the password is accepted the light-orange band "expands and
// becomes taller and then goes to the welcome"; it should go straight to the
// size it has when the WELCOME title is on screen. Measured (S6a hand-off):
// the reveal landed on Home's resting bars and the welcome then compressed
// from there — two tweens with a still between them, and on a window over
// ~1117px tall the first one GREW the band (Home's bar caps at 268px while
// the split bar is 24vh).
//
// What this pins, on the REAL component driven through its phases:
//
//   1. From `split` to the WELCOME title, the bar heights the user is shown —
//      the shell's split, the shell's reveal, then App's welcome bars — never
//      shrink at any window height (so the band never grows), and the reveal
//      LANDS on the welcome's height, so App's welcome adds no second tween.
//   2. The reveal is ONE height tween, on a duration and curve §3.4 allows,
//      and under reduced motion it is a cut (`transition: none`).
//   3. Only the sign-in lands on the welcome; every other consumer still
//      lands on Home's resting bars, exactly as before.
//
// 🚨 Heights are EVALUATED at a set of window heights, not compared as text —
// the house rule of pageBars.test.js: a regex over `min(…)` passes just as
// happily when the arithmetic inside it is wrong. jsdom keeps the expressions
// (normalised: `calc((100vh - 544px) / 2)` comes back `0.5 * (100vh - 544px)`),
// and the evaluator below throws on anything it does not recognise.
//
// The CONTROL plants today's sign-in — the reveal landing on Home — through
// the same component and the same assertion, and requires it to FAIL.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import AuthShell from './AuthShell'
import { HOME_BAR_HEIGHT, COMPRESSED_BAR_HEIGHT } from '../../layout/pages'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(resolve(here, rel), 'utf8').replace(/\r\n/g, '\n')

// ── A CSS length expression at a window height ──────────────────────────────
// Lengths in px and vh, + − × ÷, parentheses, calc/min/max. Anything else
// throws, so a value the evaluator cannot read can never pass by accident.
function resolveAt(expr, viewportPx) {
  const js = String(expr)
    .replace(/(-?\d+(?:\.\d+)?)vh/g, (_, n) => `(${n}*${viewportPx}/100)`)
    .replace(/(-?\d+(?:\.\d+)?)px/g, '$1')
    .replace(/calc\(/g, '(')
    .replace(/min\(/g, 'Math.min(')
    .replace(/max\(/g, 'Math.max(')
  if (!/^(?:Math\.min|Math\.max|[\d.\s+\-*/(),])+$/.test(js)) {
    throw new Error(`unrecognised length expression: ${expr}`)
  }
  return Function(`"use strict"; return (${js})`)()
}

// Short windows (the bars vanish below 544px), Electron's 700 floor, the two
// walkthrough sizes, both sides of every knee in the two bar shapes (1046,
// 1076, ~1117), and tall displays.
const VIEWPORTS = [420, 500, 600, 700, 800, 900, 1000, 1046, 1076, 1100, 1116, 1118, 1200, 1300, 1440, 1600, 2160]
const TOL = 0.01

// The two orange panels, read off the live DOM. They are the only z-52 layers
// the shell draws, top then bottom in source order.
const panels = () => [...document.querySelectorAll('div')].filter((d) => d.style.zIndex === '52')

// Drive the real shell idle → split → revealing → done and record what each
// phase gives the two panels. showLogoIntro=false starts at `idle`, the same
// machine the logo phases hand on to.
function drive(props = {}) {
  vi.useFakeTimers()
  const onAnimationComplete = vi.fn()
  const shell = (extra) => (
    <AuthShell showLogoIntro={false} onAnimationComplete={onAnimationComplete} {...props} {...extra}>
      <div>form</div>
    </AuthShell>
  )
  const { rerender } = render(shell({}))
  const phases = {}
  const take = (name) => {
    const [top, bottom] = panels()
    expect(top.style.height, `${name}: both panels share one height`).toBe(bottom.style.height)
    phases[name] = { height: top.style.height, transition: top.style.transition }
  }
  take('idle')
  act(() => { vi.advanceTimersByTime(1000) })     // IDLE_HOLD_MS → split
  take('split')
  rerender(shell({ isRevealing: true }))
  take('revealing')
  act(() => { vi.advanceTimersByTime(1000) })     // the reveal's hand-off timer
  phases.done = { panels: panels().length, handedOff: onAnimationComplete.mock.calls.length }
  return phases
}

// The heights the user is shown from the split until the WELCOME title: the
// shell's split, the shell's reveal, then the bars App mounts its welcome on
// (COMPRESSED — see playWelcome in App.jsx, and the App pins below).
const signInSequence = (phases) => [phases.split.height, phases.revealing.height, COMPRESSED_BAR_HEIGHT]

// The property: at every window height the bars never get THINNER from one
// step to the next (so the band between them never grows), and the step that
// hands over to the welcome is the welcome's own height (no second tween).
function oneMotionFailures(sequence) {
  const out = []
  for (const v of VIEWPORTS) {
    const px = sequence.map((e) => resolveAt(e, v))
    for (let i = 1; i < px.length; i++) {
      if (px[i] < px[i - 1] - TOL) out.push(`H=${v}: bar ${px[i - 1].toFixed(1)} → ${px[i].toFixed(1)} (the band GREW)`)
    }
    const landed = px[px.length - 2]; const welcome = px[px.length - 1]
    if (Math.abs(landed - welcome) > TOL) out.push(`H=${v}: reveal lands at ${landed.toFixed(1)}, welcome at ${welcome.toFixed(1)} (a second tween)`)
  }
  return out
}

describe('the evaluator', () => {
  it('reads the four shapes the panels are given, as jsdom normalises them', () => {
    expect(resolveAt('50vh', 900)).toBe(450)
    expect(resolveAt('calc(50vh - 20px)', 900)).toBe(430)
    expect(resolveAt('min(24vh, max(0px, 0.5 * (100vh - 544px)))', 900)).toBe(178)
    expect(resolveAt('min(24vh, max(0px, 0.5 * (100vh - 544px)))', 1300)).toBe(312)
    expect(resolveAt('min(24vh, max(0px, 0.5 * (100vh - 544px)))', 420)).toBe(0)
    expect(resolveAt(HOME_BAR_HEIGHT, 900)).toBe(180)
    expect(resolveAt(HOME_BAR_HEIGHT, 1300)).toBe(268)
  })

  it('throws on what it cannot read, rather than resolving it to something plausible', () => {
    expect(() => resolveAt('clamp(10px, 5vw, 20px)', 900)).toThrow(/unrecognised/)
    expect(() => resolveAt('50%', 900)).toThrow(/unrecognised/)
    expect(() => resolveAt('auto', 900)).toThrow(/unrecognised/)
  })
})

describe('the sign-in reveal: one motion, from the form to the WELCOME title', () => {
  it('runs idle → split → revealing → done and hands off exactly once', () => {
    const p = drive({ revealTo: 'welcome' })
    expect(p.idle.height).toBe('50vh')
    expect(p.done).toEqual({ panels: 0, handedOff: 1 })
  })

  it('never lets the band grow, at any window height, and lands on the welcome', () => {
    const p = drive({ revealTo: 'welcome' })
    expect(oneMotionFailures(signInSequence(p))).toEqual([])
  })

  it('lands on the welcome seam itself, not a copy of its number', () => {
    const p = drive({ revealTo: 'welcome' })
    for (const v of VIEWPORTS) {
      expect(resolveAt(p.revealing.height, v), `H=${v}`).toBe(resolveAt(COMPRESSED_BAR_HEIGHT, v))
    }
  })

  // 🚨 THE PLANTED FAULT. Today's sign-in: the reveal lands on Home's resting
  // bars and the welcome compresses from there. Through the same component
  // and the same assertion it must fail — the expand on a tall window AND the
  // second tween at every size. If this passes, the property above is not
  // testing anything.
  it('CONTROL: the pre-S6a sign-in (reveal to Home, then the welcome) fails it', () => {
    const p = drive({ revealTo: 'home' })
    const failures = oneMotionFailures(signInSequence(p))
    // the expand Audrey saw: windows over ~1117px tall
    expect(failures.some((f) => f.startsWith('H=1200:') && f.includes('the band GREW'))).toBe(true)
    expect(failures.some((f) => f.startsWith('H=1116:') && f.includes('the band GREW'))).toBe(false)
    expect(failures.some((f) => f.startsWith('H=1118:') && f.includes('the band GREW'))).toBe(true)
    // the two tweens: at the walkthrough sizes too
    expect(failures.some((f) => f.startsWith('H=900:') && f.includes('a second tween'))).toBe(true)
    expect(failures.some((f) => f.startsWith('H=700:') && f.includes('a second tween'))).toBe(true)
  })

  it('CONTROL: a reveal that overshoots past the welcome and comes back fails it too', () => {
    const p = drive({ revealTo: 'welcome' })
    expect(oneMotionFailures([p.split.height, 'calc(50vh - 10px)', COMPRESSED_BAR_HEIGHT])).not.toEqual([])
    expect(oneMotionFailures([p.split.height, '60vh', COMPRESSED_BAR_HEIGHT])).not.toEqual([])
  })

  it('is ONE height tween, on a duration and curve §3.4 allows', () => {
    const p = drive({ revealTo: 'welcome' })
    const m = /^height (\d+)ms (cubic-bezier\([^)]*\))/.exec(p.revealing.transition)
    expect(m, p.revealing.transition).not.toBeNull()
    // §3.4: "Decorative reveals stay above 400ms"; the reveal keeps its own
    // 1000ms and the curve the page transition uses.
    expect(Number(m[1])).toBe(1000)
    expect(Number(m[1])).toBeGreaterThan(400)
    expect(m[2].replace(/\s/g, '')).toBe('cubic-bezier(0.4,0,0.2,1)')
    expect(p.revealing.transition.match(/height/g)).toHaveLength(1)
  })
})

describe('reduced motion: the reveal is a cut', () => {
  const reduce = () => vi.stubGlobal('matchMedia', (q) => ({
    matches: q === '(prefers-reduced-motion: reduce)', media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  }))

  it('gives the panels no transition in any phase, and the same landing height', () => {
    reduce()
    const p = drive({ revealTo: 'welcome' })
    expect(p.split.transition).toBe('none')
    expect(p.revealing.transition).toBe('none')
    expect(oneMotionFailures(signInSequence(p))).toEqual([])
  })

  it('CONTROL: without the preference the same panels do tween', () => {
    const p = drive({ revealTo: 'welcome' })
    expect(p.revealing.transition).not.toBe('none')
    expect(p.revealing.transition).toMatch(/^height 1000ms/)
  })
})

describe('only the sign-in lands on the welcome', () => {
  it('every other consumer still lands on Home, by default', () => {
    const p = drive({})
    for (const v of VIEWPORTS) {
      expect(resolveAt(p.revealing.height, v), `H=${v}`).toBe(resolveAt(HOME_BAR_HEIGHT, v))
    }
  })

  it('an unknown landing falls back to Home rather than to an invalid height', () => {
    const p = drive({ revealTo: 'nowhere' })
    expect(resolveAt(p.revealing.height, 900)).toBe(resolveAt(HOME_BAR_HEIGHT, 900))
  })

  // Source pins: rendering LoginScreen pulls in the Supabase client, and the
  // four other consumers are wizards and gates — what matters is which of
  // them ASKS for the welcome, and that is one prop in one file.
  const consumers = {
    'LoginScreen.jsx': read('LoginScreen.jsx'),
    'ForgotPasswordWizard.jsx': read('ForgotPasswordWizard.jsx'),
    'ResetPasswordWizard.jsx': read('ResetPasswordWizard.jsx'),
    'MfaSection.jsx': read('MfaSection.jsx'),
    'NewUserWelcome.jsx': read('../onboarding/NewUserWelcome.jsx'),
  }
  const shellTag = (src) => {
    const at = src.indexOf('<AuthShell')
    return src.slice(at, src.indexOf('>', src.indexOf('isRevealing', at)))
  }

  it('LoginScreen asks for the welcome; the other four do not', () => {
    expect(shellTag(consumers['LoginScreen.jsx'])).toMatch(/\brevealTo="welcome"/)
    for (const [file, src] of Object.entries(consumers)) {
      if (file === 'LoginScreen.jsx') continue
      expect(src, file).not.toMatch(/revealTo=/)
    }
  })

  it('CONTROL: the tag reader sees a prop that is there', () => {
    expect(shellTag('x <AuthShell isRevealing={r} revealTo="welcome"\n onX={1}>')).toMatch(/revealTo="welcome"/)
    expect(shellTag('x <AuthShell\n revealTo="home"\n isRevealing={r}>')).not.toMatch(/revealTo="welcome"/)
  })
})

// ── App's half of the seam ───────────────────────────────────────────────────
// At the hand-over App's bars must STAND at COMPRESSED — a cut, in the same
// commit that removes the sign-in screen — whether the chrome mounts then or
// was already mounted under it (review round 1, R1-01: a resumed session on a
// recovery link). App.jsx is not rendered here (it is the whole application);
// the frame instrument is the end-to-end proof —
// `scripts/signin-welcome-frames.mjs --check`, and `--resumed` for the second
// path — and these pin the lines it depends on. Round 1 (R1-02) found the
// first draft's pins accepted "the welcome a tick late"; each pin below has a
// control built from exactly that kind of near miss.
describe('App picks the welcome up where the reveal left it', () => {
  const app = read('../../App.jsx')
  const welcomeFn = () => {
    const at = app.indexOf('const playWelcome = useCallback(')
    expect(at).toBeGreaterThan(0)
    return app.slice(at, app.indexOf('}, []);', at))
  }
  // The real mount, not the `<LoginScreen/>` a comment above handleAuth names.
  const loginHandler = () => {
    const at = app.search(/<LoginScreen\s+notice=/)
    expect(at).toBeGreaterThan(0)
    return app.slice(at, app.indexOf('/>', at))
  }
  // The whole hand-over handler: these two calls, comments, then playWelcome()
  // as its LAST statement — nothing wrapped around it, nothing deferred.
  const HANDLER = /onAuthenticated=\{\(session\) => \{\s*handleAuth\(session\);\s*handleAnimationComplete\(\);\s*(?:\/\/[^\n]*\n\s*)*playWelcome\(\);\s*\}\}/
  // Each bar's transition is a cut while `welcomeCut` holds.
  const barStyle = (marker) => {
    const at = app.indexOf(marker)
    expect(at, marker).toBeGreaterThan(0)
    return app.slice(at, app.indexOf('}}', at))
  }

  it('the welcome bars are the seam, read from the registry', () => {
    expect(app).toMatch(/const COMPRESSED = \{ top: COMPRESSED_BAR_HEIGHT, bottom: COMPRESSED_BAR_HEIGHT \};/)
    expect(app).not.toMatch(/'calc\(50vh - 20px\)'/)
    // …and 'compressing' is one of the states that puts the bars there, so
    // the hand-over's first state already stands at COMPRESSED.
    expect(app).toMatch(/const isCompressed = transitionState === 'compressing' \|\| transitionState === 'title-hold';/)
    expect(app).toMatch(/const topHeight = isCompressed \? COMPRESSED\.top : pageBars\.top;/)
    expect(app).toMatch(/const bottomHeight = isCompressed \? COMPRESSED\.bottom : pageBars\.bottom;/)
  })

  it('the hand-over starts the welcome itself, not an effect or a tick later', () => {
    expect(loginHandler()).toMatch(HANDLER)
    expect(app).not.toMatch(/setWelcomeQueued/)
  })

  it('CONTROL: the handler pin refuses the welcome a tick late', () => {
    const now = `onAuthenticated={(session) => {
            handleAuth(session);
            handleAnimationComplete();
            // S6a: in this commit
            playWelcome();
          }}`
    expect(now).toMatch(HANDLER)
    for (const late of [
      now.replace('playWelcome();', 'setTimeout(() => { playWelcome(); }, 0);'),
      now.replace('playWelcome();', 'requestAnimationFrame(() => { playWelcome(); });'),
      now.replace('playWelcome();', 'setTimeout(playWelcome, 0);'),
      now.replace('playWelcome();', 'setWelcomeQueued(true);'),
      now.replace('handleAnimationComplete();', 'handleAnimationComplete();\n            await settle();'),
    ]) expect(late).not.toMatch(HANDLER)
  })

  it('the bars cut at the hand-over: no transition until title-hold', () => {
    for (const marker of ['{/* ===== TOP ORANGE BAR ===== */}', '{/* ===== NAV STRIP', '{/* ===== BOTTOM ORANGE BAR']) {
      expect(barStyle(marker), marker).toMatch(/transition: welcomeCut \? 'none' : `height /)
    }
    const fn = welcomeFn()
    // the cut is set with 'compressing' and lifted with 'title-hold'
    expect(fn).toMatch(/setWelcomeCut\(true\);\s*setTransitionState\('compressing'\);/)
    expect(fn).toMatch(/setWelcomeCut\(false\);\s*setTransitionState\('title-hold'\);/)
  })

  it('CONTROL: a bar that keeps its tween at the hand-over fails the cut pin', () => {
    const before = "<div className=\"wilson-chrome\" style={{\n            height: topHeight,\n            transition: `height 600ms ${EASE}`,\n          }}"
    expect(before).not.toMatch(/transition: welcomeCut \? 'none' : `height /)
  })

  it('the welcome does not compress again, and a hidden window cannot park it', () => {
    const fn = welcomeFn()
    expect(fn).not.toMatch(/TRANSITION\.compress/)
    // title-hold two frames later, or after the fallback when no frames run
    // (R1-03), whichever is first — and only once, with style flushed before
    // the cut is lifted (R2-02) so the lift cannot start a tween.
    expect(fn).toMatch(/const holdTitle = \(\) => \{\s*if \(held\) return;\s*held = true;\s*void document\.documentElement\.getBoundingClientRect\(\);\s*setWelcomeCut\(false\);/)
    expect(fn).toMatch(/requestAnimationFrame\(\(\) => requestAnimationFrame\(holdTitle\)\);\s*setTimeout\(holdTitle, WELCOME_FRAMES_FALLBACK_MS\);/)
  })

  // ── Review round 2 (R2-01): three plants passed every pin above. ──────────
  // `playWelcome` deferring its OWN body, a fallback of 0 (measured: the
  // --resumed path's expand came back), and a second place lifting the cut.
  // The cut must be set synchronously, lifted in exactly one place, and the
  // timer must outlast the hand-over's commit.
  const preamble = (fnSrc) => fnSrc.slice(0, fnSrc.indexOf("setTransitionState('compressing');"))
  const DEFERRAL = /setTimeout|requestAnimationFrame|queueMicrotask|await|Promise|\.then\(/
  const fallbackMs = (src) => Number(/const WELCOME_FRAMES_FALLBACK_MS = (\d+);/.exec(src)?.[1])

  it('the cut is set synchronously, in the hand-over\'s own call', () => {
    const pre = preamble(welcomeFn())
    expect(pre).toMatch(/^const playWelcome = useCallback\(\(\) => \{/)
    expect(pre).toMatch(/setWelcomeCut\(true\);\s*$/)
    expect(pre).not.toMatch(DEFERRAL)
  })

  it('the cut is lifted in exactly one place, and the fallback outlasts the commit', () => {
    expect(app.match(/setWelcomeCut\(/g)).toHaveLength(2)
    expect(fallbackMs(app)).toBeGreaterThanOrEqual(300)
  })

  it('CONTROL: the three round-2 plants fail those pins', () => {
    const fn = welcomeFn()
    // P1: playWelcome defers its own body
    const deferred = fn.replace(/(const playWelcome = useCallback\(\(\) => \{)/, '$1\n    setTimeout(() => {')
    expect(preamble(deferred)).toMatch(DEFERRAL)
    // P2: a fallback of 0
    expect(fallbackMs(app.replace(/WELCOME_FRAMES_FALLBACK_MS = \d+;/, 'WELCOME_FRAMES_FALLBACK_MS = 0;'))).toBeLessThan(300)
    // P3: a second place lifting the cut
    const lifted = `${app}\n  useLayoutEffect(() => { if (welcomeCut) setWelcomeCut(false); }, [welcomeCut]);`
    expect(lifted.match(/setWelcomeCut\(/g)).not.toHaveLength(2)
  })

  it('the page header in the top bar cuts with the bars (R2-03)', () => {
    const top = app.slice(app.indexOf('{/* ===== TOP ORANGE BAR ===== */}'), app.indexOf('{renderTopBarContent()}'))
    expect(top).toMatch(/opacity: contentFaded \? 0 : 1,[\s\S]*?transition: welcomeCut \? 'none' : 'opacity 250ms ease',/)
  })

  it('CONTROL: the pre-S6a welcome reads as a second compress', () => {
    const before = `const playWelcome = useCallback(() => {
    setTransitionState('compressing');
    setTimeout(() => {
      setTransitionState('title-hold');
    }, TRANSITION.compress);
  }, []);`
    expect(before).toMatch(/TRANSITION\.compress/)
    expect(before).not.toMatch(/requestAnimationFrame\(\(\) => requestAnimationFrame\(holdTitle\)\)/)
  })
})
