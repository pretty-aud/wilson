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

const COLOR_ORANGE       = '#ea580c'
const COLOR_ORANGE_LIGHT = '#f4a261'

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
//     #1c1917  on #f4a261  →  8.49:1   passes AAA
//
// Audrey, 2026-08-10: "DO NOT USE GRAY TEXT AGAINST ORANGE AS IT IS HARD TO
// SEE ONLY WHITE OR BLACK" / "keep the orange make the light text black
// instead." White on light orange is the same defect as grey on orange — it
// is simply the one nobody had measured. One ink for every auth surface.
//
// Hierarchy here comes from SIZE and WEIGHT, never from a third colour or a
// softened alpha: a 72%-black is a grey by another name, and the rule above
// has no third option.
export const AUTH_INK = '#1c1917'

// Error text. A darkened form of WILSON's existing #ef4444 danger ink rather
// than a fourth colour — #ef4444 itself measures 1.83:1 on #f4a261 and is
// unreadable there. #7f1d1d measures 4.86:1.
export const AUTH_ERROR_INK = '#7f1d1d'

// ── Reusable typography ─────────────────────────────────────────────────────
// The app's one sans, read from `@theme` in src/index.css (UI overhaul F1,
// 2026-09-11 — the Apple-first system stack that used to live here was the
// only sans declaration in the app and competed with the global face). Kept
// as an explicit key because AuthPasswordInput's wrapper reads it to make
// `22ch` resolve identically on the wrapper and the input; T3 re-measures
// that caret alignment now that the face has changed.
// Callers can override fontSize / letterSpacing / fontWeight locally.
export const AUTH_TEXT_STYLE = {
  color: AUTH_INK,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  fontSize: '20.5px',
  fontFamily: 'var(--font-sans)',
}

// ── Shared field kit (Session 43 §A7) ───────────────────────────────────────
// LoginScreen, ForgotPasswordWizard, ResetPasswordWizard and NewUserWelcome
// each grew their own copy of these values, which is why the four screens
// stopped looking like one system. A value used on more than one auth surface
// lives HERE, beside AUTH_TEXT_STYLE.
//
// Law of Proximity drives the two gaps: a label sits 5px from its own field
// and 22px from the next field group, so the pairing is read before anything
// else on the screen. That ratio is the cheapest fix on these screens and the
// one doing most of the work.
// 5px vs 18px is a 3.6:1 ratio, which is what makes the pairing read. The
// first draft used 22px and measured 348px of content against a 346px well
// at the 700px minimum window — the ratio does the work, not the absolute
// size, so the smaller value is both correct and the one that fits.
export const AUTH_GAP_WITHIN_FIELD = '5px'
export const AUTH_GAP_BETWEEN_FIELDS = '18px'

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

export const AUTH_TITLE_STYLE = {
  ...AUTH_TEXT_STYLE,
  fontSize: '24px',
  letterSpacing: '0.18em',
}

export const AUTH_LABEL_STYLE = {
  ...AUTH_TEXT_STYLE,
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.22em',
}

export const AUTH_INPUT_STYLE = {
  ...AUTH_TEXT_STYLE,
  fontSize: '17px',
  fontWeight: 400,
  textTransform: 'none',
  letterSpacing: '0.02em',
  background: 'transparent',
  border: 'none',
  borderBottom: `1px solid ${AUTH_INK}`,
  outline: 'none',
  caretColor: AUTH_INK,
  textAlign: 'center',
  width: '22ch',
  padding: '4px 0 6px',
  // Explicit, because AuthPasswordInput's mask metrics pin 1.2 and an
  // unstated `normal` resolved to 1.5 on the sans face — the plain fields
  // came out 36.17px tall against the password field's 31.06px, so the gap
  // between a label and its rule visibly differed from row to row. Measured,
  // not eyeballed.
  lineHeight: '1.2',
}

// Primary action. The one white surface on the screen — now that the type is
// black, the white fill is genuinely the standout element (Von Restorff)
// rather than one white thing among many.
// Primary action. Audrey, 2026-08-10: "do not have white buttons" and then
// "make the button something more minimal and clean."
//
// The white fill was the wrong shape twice over — 2.06:1 against the well, so
// it needed a 2px rule just to have an edge: two treatments doing one job. A
// solid dark fill fixed that but overcorrected, dropping a heavy block onto a
// screen whose entire language is hairlines.
//
// So: no fill, and the SAME 1px rule the input fields use. One rule weight
// across the whole screen, nothing filled, nothing shadowed. The button reads
// as a button because of its box and its letter-spacing, not because it is
// louder than everything around it.
//
// Hierarchy still works because it is the only bounded thing on the screen —
// Von Restorff by enclosure rather than by weight (Law of Common Region doing
// the job a fill was doing badly).
// Audrey, 2026-08-10, final: "make the buttons for sign in and authenticate be
// a dark orange. remove the outline to the button."
//
// So: #ea580c fill, no border. One filled shape, the app's own primary orange,
// against the light-orange well.
//
// Audrey, 2026-08-10: "lets round the corners. lets also make it a different
// darker orange. not the same as the header and footer."
//
// #c2410c (orange-700) — already in WILSON's palette as the border on the
// Settings orange buttons, so this is an existing ink at a new job rather than
// a fourth colour. Clearly separated from the #ea580c bars.
//
// Going darker flips the label back to WHITE, and that is a measurement:
//                     on #ea580c        on #c2410c
//     #ffffff           3.56:1 ✗          5.18:1 ✓
//     #1c1917           4.91:1 ✓          3.38:1 ✗
// The darker fill is the one that carries white, which is also WILSON's
// house pairing for an orange button everywhere else in the app.
//
// It improves the boundary too: 1.73:1 against the well at #ea580c, 2.51:1
// here. Still under the 3:1 that WCAG 1.4.11 wants for a component edge — a
// filled orange block on an orange page reads by hue rather than luminance —
// but the label is strong and the shape is unambiguous.
export const AUTH_BUTTON_STYLE = {
  ...AUTH_TEXT_STYLE,
  fontSize: '12px',
  fontWeight: 700,
  letterSpacing: '0.18em',
  background: '#c2410c',
  color: '#ffffff',
  border: 'none',
  padding: '12px 38px',
  borderRadius: '6px',
  cursor: 'pointer',
}

// Secondary action (CHOOSE FILE). Now that the primary is filled, the
// secondary keeps the outline — that IS the hierarchy, and it costs no new
// colour. Deliberately NOT derived from AUTH_BUTTON_STYLE any more: the two
// differ in treatment now, not just in scale.
export const AUTH_BUTTON_QUIET_STYLE = {
  ...AUTH_TEXT_STYLE,
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.18em',
  background: 'transparent',
  color: AUTH_INK,
  border: `1px solid ${AUTH_INK}`,
  padding: '7px 16px',
  borderRadius: '6px',
  cursor: 'pointer',
}

// Tertiary. Small caps on the same scale as the hints, so the row under the
// button reads as one quiet line rather than two web links. The underline
// stays — it is the affordance, and Jakob's Law governs mechanism even when
// the expression is this spare — but sits off the baseline so it reads as a
// rule rather than a strikethrough of the descenders.
export const AUTH_LINK_STYLE = {
  ...AUTH_TEXT_STYLE,
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '0.16em',
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
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '0.16em',
}

export const AUTH_ERROR_STYLE = {
  ...AUTH_TEXT_STYLE,
  fontSize: '11px',
  fontWeight: 700,
  color: AUTH_ERROR_INK,
}

// ── Named state variants (UI overhaul D2, the state-extraction commit) ──────
// Busy was written as an inline ternary beside every auth button: 0.55 on the
// five submits, 0.5 on the two link buttons, 0.6 on the MFA gate. Three values
// for one state, each re-typed per file, and an inline `opacity` BEATS any
// class a later restyle writes — that is the Bins dead-hover bug (plan §1).
//
// The branch is a named object now, so the state is one thing with one value
// and a restyle cannot silently drop it. The numbers below are the ones that
// were already on screen: this commit is provably visual-neutral, and the
// token swap is the commit after it.
//
// The cursor half is redundant with the global `:disabled` rule in index.css
// once a button carries `disabled`, and every one of these already does; it is
// kept here only until the values move, so that this commit changes nothing a
// screenshot can see.
export const AUTH_BUTTON_BUSY_STYLE = { opacity: 0.55, cursor: 'default' }
export const AUTH_LINK_BUSY_STYLE = { opacity: 0.5, cursor: 'default' }

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
export const AuthPasswordInput = forwardRef(function AuthPasswordInput(
  { value, onChange, disabled, style, ...rest },
  ref,
) {
  // Shared metrics. Both layers must resolve to the SAME font, size, spacing,
  // alignment, line-height and padding or the asterisks and the caret drift
  // apart. They are declared once and spread into both.
  //
  // fontWeight 700 is set on BOTH layers, not just the visible one. The
  // asterisks are meant to read bold (Audrey, 2026-08-10), but bolding only
  // the overlay would risk the two layers resolving to different advance
  // widths if the monospace face's bold cut is not metric-compatible — and
  // that difference is exactly what drifts the caret away from the last
  // asterisk. The input's text is transparent, so weighting it costs nothing
  // visually and buys identical metrics by construction.
  const metrics = {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
    fontSize: '17px',
    fontWeight: 700,
    letterSpacing: '0.18em',
    textAlign: 'center',
    lineHeight: '1.2',
    padding: '4px 0 6px',
  }
  return (
    // inline-grid with both children in cell 1/1: the overlay inherits the
    // input's exact box rather than a hand-tuned `top` offset, so the two
    // stay aligned across zoom levels and font fallbacks.
    //
    // 🚨 The width is resolved HERE, not on the input. `ch` is one advance of
    // the ELEMENT'S OWN font, so a 22ch monospace input came out 205.6px
    // against the sans fields' 201.6px — the password rule was 4px longer
    // than the username rule and their left edges did not line up. Measured,
    // not theorised. Setting the sans face on the wrapper makes 22ch mean the
    // same thing it means everywhere else, and both grid children stretch to
    // fill it.
    // ⚠️ `ch` depends on font-SIZE as well as font-family. Setting only the
    // family here left the wrapper inheriting 16px against the input's 17px,
    // and 22ch came out 189.75px instead of 201.6px — exactly 16/17 of it.
    // Both properties have to match the field they are standing in for.
    <span style={{
      display: 'inline-grid',
      gridTemplateColumns: '1fr',
      fontFamily: AUTH_TEXT_STYLE.fontFamily,
      fontSize: AUTH_INPUT_STYLE.fontSize,
      width: AUTH_INPUT_STYLE.width,
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
          outline: 'none',
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
