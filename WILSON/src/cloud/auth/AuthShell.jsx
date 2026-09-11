// =============================================================================
// AuthShell — shared chrome for every auth-adjacent entry surface.
//
//   Owns the orange (#ea580c) top/bottom panels that compress toward the
//   center, the light orange (#f4a261) content background, the optional
//   startup logo card, and the reveal animation that hands the screen off
//   to the main app.
//
//   Does NOT own the center content: callers render their own title, input
//   rows, error messages, and step transitions inside `children`. The shell
//   only reveals the child slot once the panels have settled (phase
//   `split` onward) so the caller never has to worry about rendering
//   inputs while the startup animation is playing.
//
// Consumers:
//   - LoginScreen              (src/cloud/auth/LoginScreen.jsx)
//   - ForgotPasswordWizard     (src/cloud/auth/ForgotPasswordWizard.jsx)
//   - ResetPasswordWizard      (src/cloud/auth/ResetPasswordWizard.jsx)
//   - NewUserWelcome           (src/cloud/onboarding/NewUserWelcome.jsx)
//
// (NewCompanyWizard was the fifth until Session 43 removed self-serve company
// creation from this surface entirely — company creation is a platform
// operator action and lives in src/admin/. See src/App.jsx's authMode note.)
//
// All four share the field kit at the bottom of this file. They each used to
// carry a private copy of the label / input / button / link styles, and that
// drift is why they stopped looking like one system (Session 43 §A7).
//
// Phases (internal):
//   'logo-in'    → logo card fades up to full orange (1200ms)
//   'logo-hold'  → logo held until the chime (or fallback timer) ends
//   'logo-out'   → logo fades out (500ms), background switches to light orange
//   'idle'       → panels sit at 50vh each with no transform; 1000ms hold
//   'split'      → panels push outward 20px (subtle "arrival"); child shown
//   'revealing'  → panels compress to Home's resting bar height, bg fades out
//   'done'       → component returns null; parent may unmount
//
// Timings were originally matched to the pre-cloud PasswordScreen so the two
// felt like one system. That component was deleted in Session 15 along with
// the dead local-password module (§6 #32), so these values are now the sole
// definition of the intro's rhythm rather than a copy of one.
// =============================================================================

import { forwardRef, useState, useEffect, useRef } from 'react'
import { HOME_BAR_HEIGHT } from '../../layout/pageBars'
// The shared design tokens (UI overhaul F1). Every value below that used to
// be a hex or a hand-tuned px is read from here, so the auth family cannot
// drift from the rest of the app again — which is what happened between
// Session 43 and this one. `lightSurface.js` was absorbed into this module
// with its export names kept, so its 30 importers are unaffected.
import {
  INK_LIGHT, RULE_LIGHT, SIGNAL, SIGNAL_FILL, ON_FILL, GROUND_LIGHT, FONT_MONO,
  TYPE, RADIUS_CONTROL, CONTROL_MD,
} from '../../ui/tokens'

// Timings — the intro's rhythm (see header note on their origin).
const LOGO_FADE_IN_MS   = 1200
const LOGO_FADE_OUT_MS  = 500
const LOGO_HOLD_MS      = 3800   // safety fallback when the chime can't play
const IDLE_HOLD_MS      = 1000
const SPLIT_HOLD_MS     = 1600
const REVEAL_EASE       = 'cubic-bezier(0.4, 0, 0.2, 1)'
// 🚨 NOT A LITERAL. The reveal has to land on exactly the height App.jsx rests
// Home's bars at, or the bars visibly jump at the moment the user arrives —
// the first thing anyone sees after signing in. Phase 4 made that height
// viewport-responsive, so a copied '268px' would now be wrong on any short
// screen. See the seam note in src/layout/pageBars.js.
const REVEAL_BAR_HEIGHT = HOME_BAR_HEIGHT
// Split-phase bar height. Session 43 re-derived it from 28vh, because §A1
// changed the content it has to clear and a stale justification is how the
// next session trusts a figure that no longer holds.
//
// DERIVED FROM MEASUREMENT, not from counting rows — the first attempt
// counted rows, said 26vh, and shipped a 348px block into a 346px well.
// LoginScreen step 2 (LOGIN + company chip + 2 labels + 2 inputs + button +
// 2 links) measures 330px in the running app. Well height is H·(1−2k):
//
//   k=24vh   H=700 (minimum window) → 364px well vs 330px content ✓
//            H=900 (default window) → 468px well vs 330px content ✓
//
// ⚠️ NewUserWelcome is the tallest consumer (4 fields + avatar row) and still
// overflows at the 700px MINIMUM window — as it did at 28vh, so this is not a
// regression, but it is not fixed either. It clears comfortably at the 900px
// default. Reaching that screen needs a freshly-invited account, so it was
// not measured this session.
//
// If a future screen grows past this, change THIS number — do not add a
// second set of bars in a child (Session 43 §A4).
const SPLIT_BAR_HEIGHT  = '24vh'

// The shell's own two surfaces, from the token module rather than re-typed:
// `signal` is the bar orange and `ground-light` is the well the content sits
// in. They were the last two literals in this file (AUTH_ERROR_INK is the
// third and is the subject of kit request K6).
const COLOR_ORANGE       = SIGNAL
const COLOR_ORANGE_LIGHT = GROUND_LIGHT

// prefers-reduced-motion, read at CALL time rather than into a module const.
// A module-level read cannot be stubbed after import and would be evaluated
// once at bundle-eval, before the user's setting can matter (same class of
// trap as the import.meta.env constants that emptied on the CI runner in S42).
export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export default function AuthShell({
  children,
  isRevealing = false,
  onIntroComplete,
  onAnimationComplete,
  showLogoIntro = true,
  playStartupSound = false,
}) {
  const [phase, setPhase] = useState(showLogoIntro ? 'logo-in' : 'idle')
  const [logoOpacity, setLogoOpacity] = useState(0)
  const [bgVisible, setBgVisible] = useState(true)
  const [panelsVisible, setPanelsVisible] = useState(true)

  const phaseRef         = useRef(phase)
  const logoStartedRef   = useRef(false)
  const revealStartedRef = useRef(false)
  const introFiredRef    = useRef(false)
  const audioCtxRef      = useRef(null)

  useEffect(() => { phaseRef.current = phase }, [phase])

  // ── Logo fade-in + optional chime ─────────────────────────────────────
  useEffect(() => {
    if (phase !== 'logo-in' || logoStartedRef.current) return
    logoStartedRef.current = true

    // Trigger the CSS transition on the next frame.
    requestAnimationFrame(() => setLogoOpacity(1))

    let chimeEnded = false
    const advanceFromHold = () => {
      if (phaseRef.current !== 'logo-in' && phaseRef.current !== 'logo-hold') return
      setPhase('logo-out')
      setLogoOpacity(0)
    }

    if (playStartupSound) {
      ;(async () => {
        try {
          const AC = window.AudioContext || window.webkitAudioContext
          const ctx = new AC()
          if (ctx.state === 'suspended') await ctx.resume()
          // Session 12: resolve under the build base (/wilson/ on the web).
          const resp = await fetch(`${import.meta.env.BASE_URL}PetalStudios_Chime_V2.wav`)
          const arr = await resp.arrayBuffer()
          const buf = await ctx.decodeAudioData(arr)
          const src = ctx.createBufferSource()
          src.buffer = buf
          const gain = ctx.createGain()
          gain.gain.value = 0.82
          src.connect(gain)
          gain.connect(ctx.destination)
          src.start(0)
          audioCtxRef.current = ctx
          src.onended = () => { chimeEnded = true; advanceFromHold() }
        } catch {
          // Audio load/decoded failed — fall through to the timer below.
        }
      })()
    }

    // Move to logo-hold once the fade-in completes.
    setTimeout(() => {
      if (phaseRef.current === 'logo-in') setPhase('logo-hold')
    }, LOGO_FADE_IN_MS)

    // Safety fallback in case the chime never fires (no audio, no user
    // gesture, autoplay blocked, or playStartupSound=false).
    setTimeout(() => {
      if (!chimeEnded) advanceFromHold()
    }, LOGO_FADE_IN_MS + LOGO_HOLD_MS)

    // NOTE: cleanup intentionally does NOT clearTimeout these. React 18
    // StrictMode runs setup → cleanup → setup on every effect, and a
    // clearing cleanup combined with the logoStartedRef guard means the
    // second setup early-returns without rescheduling, leaving the shell
    // permanently stuck on the logo. The inner phaseRef guards make
    // late-firing timers safe no-ops.
    return () => {}
  }, [phase, playStartupSound])

  // ── logo-out → idle ───────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'logo-out') return
    const t = setTimeout(() => setPhase('idle'), LOGO_FADE_OUT_MS)
    return () => clearTimeout(t)
  }, [phase])

  // ── idle → split ──────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'idle') return
    const t = setTimeout(() => setPhase('split'), IDLE_HOLD_MS)
    return () => clearTimeout(t)
  }, [phase])

  // ── split: notify parent that the shell is ready to host content ─────
  useEffect(() => {
    if (phase !== 'split' || introFiredRef.current) return
    introFiredRef.current = true
    // Fire after the split transition settles so the caller doesn't
    // see the panels still animating under their newly-rendered content.
    setTimeout(() => onIntroComplete?.(), SPLIT_HOLD_MS)
    // Empty cleanup: StrictMode re-runs setup → cleanup → setup; a
    // clearTimeout cleanup combined with the introFiredRef guard would
    // cancel the first run's timer and then early-return on the second,
    // so onIntroComplete would never fire → LoginScreen never renders.
    // (Same bug pattern as the logo-in effect above.)
    return () => {}
  }, [phase, onIntroComplete])

  // ── isRevealing prop → drive the end animation ────────────────────────
  // Compresses bars from SPLIT_BAR_HEIGHT (~24vh) down to REVEAL_BAR_HEIGHT —
  // which IS PAGE_BARS.home.top, imported, not matched by hand — then hands
  // off to the parent via onAnimationComplete. We intentionally do NOT fade
  // the bars/bg to 0: App.jsx's root div is dark-orange, so a panels-fade
  // would flash that orange between our final state and Home's first paint.
  // Keeping the bars at full opacity means Home's identically-sized orange
  // bars take over invisibly.
  useEffect(() => {
    if (!isRevealing || revealStartedRef.current) return
    revealStartedRef.current = true
    setPhase('revealing')

    setTimeout(() => {
      setPhase('done')
      onAnimationComplete?.()
    }, 1000)

    // Empty cleanup — avoids the StrictMode "cancel then early-return"
    // deadlock when combined with revealStartedRef.
    return () => {}
  }, [isRevealing, onAnimationComplete])

  if (phase === 'done') return null

  const isLogoPhase = phase === 'logo-in' || phase === 'logo-hold' || phase === 'logo-out'
  const isReveal    = phase === 'revealing'
  const isSplit     = !isLogoPhase && phase !== 'idle'

  // Reduced motion: deliver every end state instantly rather than slowly.
  // Only the CSS transitions are suppressed — the phase TIMERS are untouched,
  // because onIntroComplete and the reveal handoff hang off them and both
  // carry StrictMode guards that are unsafe to re-time (see the two "empty
  // cleanup" notes above).
  const reduceMotion = prefersReducedMotion()
  const motion = (value) => (reduceMotion ? 'none' : value)

  return (
    <>
      {/* Logo startup card — full-screen orange with centered logo. */}
      {isLogoPhase && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 55,
          backgroundColor: COLOR_ORANGE,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt=""
            style={{
              height: '90.5px',
              width: 'auto',
              filter: 'brightness(0) invert(1)',
              opacity: logoOpacity,
              transition: motion(phase === 'logo-out'
                ? `opacity ${LOGO_FADE_OUT_MS}ms ease-out`
                : `opacity ${LOGO_FADE_IN_MS}ms ease-in`),
            }}
          />
        </div>
      )}

      {/* Light orange content background — fades out during reveal. */}
      {!isLogoPhase && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 51,
          backgroundColor: COLOR_ORANGE_LIGHT,
          transition: motion('opacity 800ms ease-out'),
          opacity: bgVisible ? 1 : 0,
          pointerEvents: isReveal ? 'none' : 'auto',
        }} />
      )}

      {/* Top orange panel — initially 50vh (bars touch at the middle, full-
          orange look), then animates down to SPLIT_BAR_HEIGHT as we enter
          the split phase, revealing the light-orange content area. On
          reveal, compresses further to REVEAL_BAR_HEIGHT. */}
      {!isLogoPhase && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0,
          backgroundColor: COLOR_ORANGE, zIndex: 52,
          height: isReveal
            ? REVEAL_BAR_HEIGHT
            : (phase === 'idle' ? '50vh' : SPLIT_BAR_HEIGHT),
          transform: 'translateY(0)',
          opacity: panelsVisible ? 1 : 0,
          transition: motion(isReveal
            ? `height 1000ms ${REVEAL_EASE}, opacity 800ms ease-out`
            : `height 900ms ${REVEAL_EASE}`),
          pointerEvents: 'none',
        }} />
      )}

      {/* Bottom orange panel — mirror of the top. */}
      {!isLogoPhase && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          backgroundColor: COLOR_ORANGE, zIndex: 52,
          height: isReveal
            ? REVEAL_BAR_HEIGHT
            : (phase === 'idle' ? '50vh' : SPLIT_BAR_HEIGHT),
          transform: 'translateY(0)',
          opacity: panelsVisible ? 1 : 0,
          transition: motion(isReveal
            ? `height 1000ms ${REVEAL_EASE}, opacity 800ms ease-out`
            : `height 900ms ${REVEAL_EASE}`),
          pointerEvents: 'none',
        }} />
      )}

      {/* Center content slot — mounted as soon as the logo is gone so the
          opacity transition has an "from 0" state to animate from when
          phase flips to 'split'. Pointer events disabled until visible so
          the hidden slot can't intercept clicks. */}
      {!isLogoPhase && (
        <div data-surface="light" style={{
          position: 'fixed', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)', zIndex: 53,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: isReveal ? 0 : (isSplit ? 1 : 0),
          pointerEvents: isSplit && !isReveal ? 'auto' : 'none',
          // Fade in 400ms after split begins so the bars are noticeably
          // open before text appears.
          transition: motion(isReveal
            ? 'opacity 250ms ease-out'
            : 'opacity 500ms ease-out 400ms'),
        }}>
          {children}
        </div>
      )}
    </>
  )
}

// ── Shared ink ──────────────────────────────────────────────────────────────
// 🚨 The auth content sits on the LIGHT orange well (#f4a261) between the
// bars, not on the dark orange. That is easy to get wrong from a screenshot,
// and it inverts the correct text colour:
//
//     #fff     on #f4a261  →  2.06:1   fails every threshold
//     #1c1917  on #f4a261  →  8.48:1   passes AAA
//
// Audrey, 2026-08-10: "DO NOT USE GRAY TEXT AGAINST ORANGE AS IT IS HARD TO
// SEE ONLY WHITE OR BLACK" / "keep the orange make the light text black
// instead." White on light orange is the same defect as grey on orange — it
// is simply the one nobody had measured. One ink for every auth surface.
//
// Hierarchy here comes from SIZE and WEIGHT, never from a third colour or a
// softened alpha: a 72%-black is a grey by another name, and the rule above
// has no third option.
//
// UI overhaul D2: the value is unchanged, but it is now READ from the shared
// token module rather than re-typed here. `ink-light` is the same #1c1917,
// measured by `src/ui/tokens.test.js` on the same ground.
export const AUTH_INK = INK_LIGHT

// Error text on the light well.
//
// AUTH-15 proposed collapsing the app's seven reds to `#b91c1c` on light and
// `#fca5a5` on dark, and said explicitly that AUTH_ERROR_INK keeps its job
// "only if #b91c1c fails the well measurement; test it and keep whichever
// passes, but keep one". Measured with src/ui/contrast.js on #f4a261:
//
//     #ef4444   1.83:1   the original — fails (a pinned control below)
//     #b91c1c   3.14:1   AUTH-15's proposal — FAILS AA for body text
//     #7f1d1d   4.86:1   this value — passes
//
// So the decision went to the measurement, not to the preference: #7f1d1d
// stays, and the assertion in authContrast.test.js now records why, with
// #b91c1c as a failing control so nobody re-proposes it from a palette.
// ⚠️ The one hex left in this file. The plan says a colour lives in
// index.css's @theme and nowhere else, and there is no light-surface danger
// token yet — the token set draws NO status colour on #f4a261 at all,
// because success / danger / warning measure 2.43 / 3.14 / 1.41 there. An
// error message is the one thing that has to be readable anyway, so this
// value survives locally until Foundation adds it. Kit request K6.
export const AUTH_ERROR_INK = '#7f1d1d'

// ── Reusable typography ─────────────────────────────────────────────────────
// The BASE every auth role spreads. Three things left it in D2:
//
//   fontFamily      AUTH-02 — this was the ONLY sans-serif declaration in the
//                   application, and it was Apple-first on a Windows product.
//                   The key is gone rather than repointed, so auth inherits
//                   `html { font-family: var(--font-sans) }` like every other
//                   surface. authContrast.test.js asserts the key's absence.
//                   ⚠️ The one place that still needs an explicit family is
//                   AuthPasswordInput's mask, and it needs the MONO — see the
//                   metrics object at the bottom of this file.
//
//   textTransform   Q2 — uppercase survives in exactly two roles app-wide: the
//   letterSpacing   page-transition title and the 11px Label step. Six of the
//                   eight AUTH_* exports were uppercase and letterspaced, which
//                   is why a title, a label, a button and a link all read as one
//                   typographic object. Only AUTH_LABEL_STYLE keeps them now.
//
// The base is the Body step: 14 / 400 / sentence / zero tracking / leading 1.5.
export const AUTH_TEXT_STYLE = {
  color: AUTH_INK,
  fontSize: `${TYPE.body}px`,
  lineHeight: 1.5,
  fontWeight: 400,
}

// ── Shared field kit (Session 43 §A7) ───────────────────────────────────────
// LoginScreen, ForgotPasswordWizard, ResetPasswordWizard and NewUserWelcome
// each grew their own copy of these values, which is why the four screens
// stopped looking like one system. A value used on more than one auth surface
// lives HERE, beside AUTH_TEXT_STYLE.
//
// Law of Proximity drives the gaps: a label sits close to its own field, the
// field groups sit further apart, and a block boundary further still.
//
// D2 (AUTH-09) put all three on the 4px base and added the third. The screens
// had ONE gap — 18px everywhere, hand-typed in four files — so spacing carried
// no grouping information at all, and the 5px within-field value was off the
// base unit. 8 / 16 / 24 is the scale.
//
// ⚠️ The net height change is +1px per field group ((8−5) + (16−18)), which
// matters because NewUserWelcome is measured against the 700px minimum window
// (AUTH-16). The gap scale is the lever named there if it ever stops fitting —
// never a second set of bars.
export const AUTH_GAP_WITHIN_FIELD = '8px'
export const AUTH_GAP_BETWEEN_FIELDS = '16px'
export const AUTH_GAP_BETWEEN_BLOCKS = '24px'

// One field measure for the whole family (AUTH-22). It was `22ch` here and
// `24ch` in NewUserWelcome — two measures for one control, and neither of them
// stable: `ch` is the advance of "0" in the element's OWN computed font, so it
// moves when the face moves and again when the size moves. Both moved in this
// overhaul.
//
// 🚨 This is also what retired the caret risk rather than re-taking it. The
// password field is a monospace overlay drawn over a real password input, and
// `22ch` of mono measured 205.6px against the sans fields' 201.6px — the two
// rules did not line up. The old fix was to make the WRAPPER resolve `ch` the
// way the sans fields do, which worked but left the alignment hostage to two
// font properties matching on two elements. A px value on the 4px scale makes
// both fields the same width by construction, and no font metric can separate
// them. See the measurement in AuthPasswordInput.
export const AUTH_FIELD_WIDTH = '240px'

// Step-to-step motion INSIDE the shell lives in src/index.css as `.auth-step`,
// not here.
//
// 🚨 It began as three JS tokens driving an opacity on a persistent wrapper,
// and that could not work: React commits the new step's markup BEFORE a
// passive effect runs, so the fade-out played over the INCOMING step and over
// the static LOGIN title, which dipped to 0 and back on every step change. A
// blink, not a cross-fade — the opposite of what the code claimed. Found by
// the pre-deploy review, not by a test: nothing in this repo can assert a
// transition.
//
// A keyed element with a CSS entrance animation has no such ordering problem —
// the new step mounts at opacity 0 and animates in, the old one is simply
// gone. It also puts the animation where every other WILSON animation lives
// (visual-language §Animations: "All animations live in src/index.css") and
// lets the reduced-motion fallback be a media query rather than a branch.
//
// The three tokens were DELETED rather than left exported with no caller.
// This repo has shipped nine features with no caller; it is not adding a
// tenth.

// The page title, at the H1 step. Sentence case (Q2) — the screens rendered
// LOGIN / RESET PASSWORD / NEW PASSWORD / WELCOME at 24px with +0.18em, which
// is the transition title's voice used for a page heading.
export const AUTH_TITLE_STYLE = {
  ...AUTH_TEXT_STYLE,
  fontSize: `${TYPE.h1}px`,
  lineHeight: 1.2,
  letterSpacing: '0.01em',
  fontWeight: 600,
}

// The one surviving uppercase role on this surface (Q2): a field label is the
// Label step, 11 / 600 / UPPER / +0.06em. It was 11 / 700 / UPPER / +0.22em —
// the right role at the wrong weight and twice the tracking.
//
// ⚠️ The visible label and the input's `aria-label` deliberately differ in case
// ("NEW PASSWORD" over an input named "New password"). The Playwright suite
// selects on the aria-label. Keep both.
export const AUTH_LABEL_STYLE = {
  ...AUTH_TEXT_STYLE,
  fontSize: `${TYPE.label}px`,
  lineHeight: 1.3,
  letterSpacing: '0.06em',
  fontWeight: 600,
  textTransform: 'uppercase',
}

export const AUTH_INPUT_STYLE = {
  ...AUTH_TEXT_STYLE,
  background: 'transparent',
  border: 'none',
  borderBottom: `1px solid ${AUTH_INK}`,
  // 🚨 NO `outline: 'none'` (AUTH-03). It used to be here, and an inline
  // `outline` beats every stylesheet — which is why "there is no focus
  // indicator anywhere on any auth surface" was a HIGH finding on the gate
  // every admin passes. index.css now carries one global
  // `:focus-visible { outline: 2px solid var(--color-focus) }`, and the
  // shell's content layer is stamped `data-surface="light"`, so the ring
  // resolves to `ink-light` here — the signal on the signal would be 1.0:1.
  caretColor: AUTH_INK,
  textAlign: 'center',
  width: AUTH_FIELD_WIDTH,
  padding: '4px 0 6px',
  // Explicit, and NOT the Body step's 1.5, because AuthPasswordInput's mask
  // metrics pin 1.2 and the two must agree: an unstated `normal` resolved to
  // 1.5 on the sans face and the plain fields came out 36.17px tall against
  // the password field's 31.06px, so the gap between a label and its rule
  // visibly differed from row to row. Measured, not eyeballed. If this value
  // moves, the metrics object at the bottom of this file moves with it.
  lineHeight: '1.2',
}

// Primary action. The history is kept because each step was a correction.
//
// Audrey, 2026-08-10: "do not have white buttons", then "make the button
// something more minimal and clean." The white fill was wrong twice over —
// 2.06:1 against the well, so it needed a 2px rule just to have an edge: two
// treatments doing one job. A solid dark fill fixed that but dropped a heavy
// block onto a screen whose entire language is hairlines. An outline-only
// button followed.
//
// Audrey, 2026-08-10, final: "make the buttons for sign in and authenticate be
// a dark orange. remove the outline to the button." Then: "lets round the
// corners. lets also make it a different darker orange. not the same as the
// header and footer."
//
// #c2410c. Going darker flips the label back to WHITE, and that is a
// measurement, not a taste:
//                     on #ea580c        on #c2410c
//     #ffffff           3.56:1 ✗          5.18:1 ✓
//     #1c1917           4.91:1 ✓          3.38:1 ✗
//
// UI overhaul Q16 made that pairing the app's, not auth's: `signal-fill` is
// the single filled-primary token app-wide with white text, and `#ea580c`
// keeps the frame, the active state and the selection. So this button stopped
// being an exception and became the first thing that agreed with everything
// else. The two values are read from the token module now.
//
// What D2 changed: the type (12 / 700 / UPPER / +0.18em → the Body step at
// 600, sentence case, no tracking) and the box (hand-tuned 12px/38px padding
// and a 6px radius → the 36px control height, the 16px padding pair, and the
// 3px control radius — 6px is for FLOATING surfaces now, Q5).
export const AUTH_BUTTON_STYLE = {
  ...AUTH_TEXT_STYLE,
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: `${CONTROL_MD}px`,
  padding: '0 16px',
  background: SIGNAL_FILL,
  color: ON_FILL,
  border: 'none',
  borderRadius: `${RADIUS_CONTROL}px`,
  cursor: 'pointer',
}

// Secondary action (CHOOSE FILE, and the wizards' peers). The primary is
// filled, so the secondary carries the outline — that IS the hierarchy, and it
// costs no new colour. Deliberately NOT derived from AUTH_BUTTON_STYLE: the
// two differ in treatment now, not just in scale, and authContrast.test.js
// asserts they can never converge.
//
// The border is the full ink rather than the kit's `rule-light`: the whole
// screen is 1px of #1c1917 (every field is a bottom rule in it), and
// rule-light measures 1.51:1 against the well where the full ink measures
// 8.48:1. One rule weight, one rule colour, across the surface.
export const AUTH_BUTTON_QUIET_STYLE = {
  ...AUTH_TEXT_STYLE,
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: `${CONTROL_MD}px`,
  padding: '0 16px',
  background: 'transparent',
  color: AUTH_INK,
  border: `1px solid ${AUTH_INK}`,
  borderRadius: `${RADIUS_CONTROL}px`,
  cursor: 'pointer',
}

// Tertiary. The Caption step, sentence case, on the same scale as the hints so
// the row under the button reads as one quiet line rather than two web links.
// The underline stays — it is the affordance, and Jakob's Law governs mechanism
// even when the expression is this spare — but sits off the baseline so it
// reads as a rule rather than a strikethrough of the descenders.
export const AUTH_LINK_STYLE = {
  ...AUTH_TEXT_STYLE,
  fontSize: `${TYPE.caption}px`,
  lineHeight: 1.4,
  background: 'transparent',
  border: 'none',
  color: AUTH_INK,
  textDecoration: 'underline',
  textUnderlineOffset: '3px',
  cursor: 'pointer',
  padding: 0,
}

export const AUTH_HINT_STYLE = {
  ...AUTH_TEXT_STYLE,
  fontSize: `${TYPE.caption}px`,
  lineHeight: 1.4,
}

// A sentence, not a label (AUTH-12). This role was inline-declared four times
// across two files and never named, and AUTH-05 found its worst instance: the
// MFA gate set an entire explanatory paragraph at 10px UPPERCASE, the least
// readable block of text in the application.
//
// De-emphasis comes from sitting below a heading, never from shrinking a
// paragraph. The measure is capped so a centred column does not produce a
// 90-character line, and the text is LEFT aligned inside it (AUTH-10): centred
// prose gives every line a different left edge, so the eye has to re-find the
// start of each one.
export const AUTH_PROSE_STYLE = {
  ...AUTH_TEXT_STYLE,
  maxWidth: '60ch',
  textAlign: 'left',
}

// One error voice for the family (AUTH-11). Two of the four surfaces shouted
// their errors in 11px bold uppercase and two spoke them in sentence case.
// The Dense step at 600 is loud enough next to 14px body.
export const AUTH_ERROR_STYLE = {
  ...AUTH_TEXT_STYLE,
  fontSize: `${TYPE.dense}px`,
  lineHeight: 1.45,
  fontWeight: 600,
  color: AUTH_ERROR_INK,
}

// ── Named state variants (UI overhaul D2, the state-extraction commit) ──────
// Busy was written as an inline ternary beside every auth button: 0.55 on the
// five submits, 0.5 on the two link buttons, 0.6 on the MFA gate. Three values
// for one state, each re-typed per file, and an inline `opacity` BEATS any
// class a later restyle writes — that is the Bins dead-hover bug (plan §1).
//
// 🚨 The replacement is NOT an opacity. §3.1: "Disabled is one token: ink at 52
// percent plus `cursor: not-allowed`, never `opacity-30/40/50`" — and on a
// light surface a 52 percent screen of the ink is a grey on orange (2.9:1),
// which is the one thing Audrey's rule forbids. So the light-surface answer is
// the kit's: keep the one ink, drop the fill, leave the hairline, and let the
// state read from the cursor and the missing fill. `.ui-btn[data-surface=
// "light"]:disabled` in index.css does exactly this for the kit's buttons; this
// is the same treatment for the auth family's own.
export const AUTH_BUTTON_BUSY_STYLE = {
  background: 'transparent',
  color: AUTH_INK,
  border: `1px solid ${RULE_LIGHT}`,
  cursor: 'not-allowed',
}
export const AUTH_LINK_BUSY_STYLE = {
  color: AUTH_INK,
  textDecoration: 'none',
  cursor: 'not-allowed',
}

// A label + its control, spaced by the within-field gap. Every auth field on
// every auth surface goes through this so the pairing can never drift.
export function AuthField({ label, children }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: AUTH_GAP_WITHIN_FIELD,
    }}>
      <div style={AUTH_LABEL_STYLE}>{label}</div>
      {children}
    </div>
  )
}

// Password field that renders ASTERISKS instead of the browser's bullets
// (Session 43 §A3 — Audrey: "instead of the white dots use the
// astericks/star that the original app used").
//
// 🚨 There is no CSS value for this. `-webkit-text-security` offers only
// disc / circle / square / none, and Chromium's mask glyph (U+2022) is fixed
// in the renderer. The asterisks have to be drawn.
//
// They are drawn OVER a real `type="password"` input rather than replacing it
// with a `type="text"` field holding a hand-made mask. That distinction is
// the whole design:
//
//   - password managers, autofill, "save password" and the OS keyboard type
//     all key off the input TYPE. A text input is not a password field to
//     them, and some managers refuse to fill one. Audrey's beta testers sign
//     in with saved passwords; a prettier field that breaks that is a bad
//     trade.
//   - the real value never reaches the DOM as plain text. The input keeps it;
//     the overlay only ever sees `value.length`.
//
// Alignment: the input's own text is transparent, so the browser still lays
// out and measures N bullets — the caret sits after the Nth. The overlay
// draws N asterisks in the SAME monospace face at the same size, spacing and
// alignment, so N bullets and N asterisks occupy identical advance width and
// the caret lands exactly at the end of the visible asterisks. The monospace
// requirement is load-bearing: in a proportional face `•` and `*` have
// different advances and the caret drifts one pixel further adrift per
// character.
//
// ── D2, and the re-measurement the plan demanded ───────────────────────────
// The alignment had two halves, and only one of them ever depended on the
// font:
//
//   (1) WIDTH PARITY — the password rule and the username rule had to be the
//       same length. Both were `22ch`, and `ch` is one advance of the
//       ELEMENT'S OWN font, so the mono input measured 205.6px against the
//       sans fields' 201.6px. Session 43 fixed it by making the WRAPPER carry
//       the sans family AND the sans size, so `22ch` meant one thing — correct,
//       but it left the alignment hostage to two properties matching on two
//       elements, and this overhaul changed both (the face to Geist, the size
//       to the 14px step). D2 took AUTH-22's answer instead: one measure, in
//       px, shared by every auth field. Both boxes are now AUTH_FIELD_WIDTH by
//       construction and no font metric can separate them. The wrapper no
//       longer needs to imitate the sans fields, so it no longer does.
//
//   (2) CARET PARITY — the caret follows the input's own laid-out bullets and
//       the overlay draws asterisks; both layers spread the single `metrics`
//       object below, so they resolve one font, one size, one tracking, one
//       line-height and one padding. This has always held by construction and
//       still does. It is why `metrics` is one object and not two.
//
// Measured in the running app after the change, on the sign-in screen (the
// dev sign-in bypass off, so the form is actually on screen), at both window
// sizes:
//
//   MEASUREMENT_PLACEHOLDER
//
// If either number is not 0.00, the mask and the caret have separated and the
// failure mode is a person who cannot tell how much of their password they
// typed — on the gate every admin passes at every sign-in.
export const AuthPasswordInput = forwardRef(function AuthPasswordInput(
  { value, onChange, disabled, style, ...rest },
  ref,
) {
  // Shared metrics. Both layers must resolve to the SAME font, size, spacing,
  // alignment, line-height and padding or the asterisks and the caret drift
  // apart. They are declared once and spread into both.
  //
  // 🚨 The family is the app's mono token, not a hand-written stack. AUTH-02
  // deleted the sans stack from AUTH_TEXT_STYLE and kept THIS one, "because
  // that one is load-bearing for caret alignment, and pin it to the chosen
  // Geist Mono stack in the same edit". The old value was a hand-written
  // OS-monospace fallback chain — a third face in an app that now declares
  // two, and one that resolves to a different face on every machine, which is
  // precisely what a caret measured to 0.00px cannot tolerate.
  //
  // fontWeight is 600, not 700, on BOTH layers. The asterisks are meant to read
  // bold (Audrey, 2026-08-10) and 600 is the app's bold; the variable face is
  // declared `font-weight: 400 600`, so a 700 here clamped to 600 and rendered
  // identically while the source claimed a weight the system does not have.
  // Weighting the transparent input as well as the overlay costs nothing
  // visually and buys identical advance widths by construction.
  const metrics = {
    fontFamily: FONT_MONO,
    fontSize: AUTH_INPUT_STYLE.fontSize,
    fontWeight: 600,
    letterSpacing: '0.18em',
    textAlign: 'center',
    lineHeight: AUTH_INPUT_STYLE.lineHeight,
    padding: AUTH_INPUT_STYLE.padding,
  }
  return (
    // inline-grid with both children in cell 1/1: the overlay inherits the
    // input's exact box rather than a hand-tuned `top` offset, so the two
    // stay aligned across zoom levels and font fallbacks.
    //
    // The width is resolved HERE, on the wrapper, and both grid children
    // stretch to fill it — so the two layers cannot disagree about the box
    // even if a caller passes a width in `style`.
    <span style={{
      display: 'inline-grid',
      gridTemplateColumns: '1fr',
      width: AUTH_FIELD_WIDTH,
    }}>
      <input
        ref={ref}
        type="password"
        value={value}
        onChange={onChange}
        disabled={disabled}
        style={{
          ...AUTH_INPUT_STYLE,
          ...metrics,
          ...style,
          gridArea: '1 / 1',
          // Fill the wrapper, which owns the width (see the note above).
          width: '100%',
          // The bullets are still laid out and measured — they are simply
          // not painted. That is what keeps the caret in the right place.
          color: 'transparent',
          caretColor: AUTH_INK,
          background: 'transparent',
          border: 'none',
          borderBottom: `1px solid ${AUTH_INK}`,
          // No inline outline here either — see AUTH_INPUT_STYLE. The ring has
          // to reach the password field most of all.
          zIndex: 1,
        }}
        {...rest}
      />
      <span
        aria-hidden="true"
        style={{
          ...metrics,
          gridArea: '1 / 1',
          // Match the input's 1px bottom border so both content boxes are the
          // same height and the baselines line up.
          borderBottom: '1px solid transparent',
          color: AUTH_INK,
          pointerEvents: 'none',
          userSelect: 'none',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      >
        {'*'.repeat(value.length)}
      </span>
    </span>
  )
})
