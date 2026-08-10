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
//   'revealing'  → panels compress to 268px, light-orange bg fades out
//   'done'       → component returns null; parent may unmount
//
// Timings were originally matched to the pre-cloud PasswordScreen so the two
// felt like one system. That component was deleted in Session 15 along with
// the dead local-password module (§6 #32), so these values are now the sole
// definition of the intro's rhythm rather than a copy of one.
// =============================================================================

import { forwardRef, useState, useEffect, useRef } from 'react'

// Timings — the intro's rhythm (see header note on their origin).
const LOGO_FADE_IN_MS   = 1200
const LOGO_FADE_OUT_MS  = 500
const LOGO_HOLD_MS      = 3800   // safety fallback when the chime can't play
const IDLE_HOLD_MS      = 1000
const SPLIT_HOLD_MS     = 1600
const REVEAL_EASE       = 'cubic-bezier(0.4, 0, 0.2, 1)'
const REVEAL_BAR_HEIGHT = '268px'
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
  // Compresses bars from SPLIT_BAR_HEIGHT (~28vh) down to REVEAL_BAR_HEIGHT
  // (268px) — which matches PAGE_BARS.home.top/bottom in App.jsx — then
  // hands off to the parent via onAnimationComplete. We intentionally do
  // NOT fade the bars/bg to 0: App.jsx's root div is dark-orange, so a
  // panels-fade would flash that orange between our final state and Home's
  // first paint. Keeping the bars at full opacity means Home's matching
  // orange 268px bars take over invisibly.
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
        <div style={{
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
// Modern geometric sans-serif via the OS-preferred system font stack.
// Callers can override fontSize / letterSpacing / fontWeight locally.
export const AUTH_TEXT_STYLE = {
  color: AUTH_INK,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  fontSize: '20.5px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
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

// Step-to-step motion INSIDE the shell. This is a content change, not a page
// change, so it takes the interactive-response band (160–240ms) rather than
// the shell's own 900ms height curve. Running both at once on different
// curves is what reads as "not smooth".
// The departure is quicker than the arrival — an exit that lingers reads as
// hesitation, an entrance that hurries reads as a jump.
export const AUTH_STEP_MS     = 200
export const AUTH_STEP_OUT_MS = 100
export const AUTH_STEP_EASE   = 'cubic-bezier(0.2, 0, 0, 1)'

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
}

// Primary action. The one white surface on the screen — now that the type is
// black, the white fill is genuinely the standout element (Von Restorff)
// rather than one white thing among many.
// The white FILL only measures 2.06:1 against the well, so on its own the
// button's edge is barely there — WCAG 1.4.11 wants 3:1 for a component
// boundary. A hard 2px rule fixes it at 8.49:1 and is WILSON's house answer
// anyway: "surfaces stack via solid borders, not elevation" (visual-language
// §Borders). Padding is trimmed by the border width so the box is unchanged.
export const AUTH_BUTTON_STYLE = {
  ...AUTH_TEXT_STYLE,
  fontSize: '12px',
  fontWeight: 700,
  letterSpacing: '0.18em',
  background: '#fff',
  color: AUTH_INK,
  border: `2px solid ${AUTH_INK}`,
  padding: '8px 32px',
  borderRadius: '2px',
  cursor: 'pointer',
}

export const AUTH_LINK_STYLE = {
  background: 'transparent',
  border: 'none',
  color: AUTH_INK,
  fontFamily: AUTH_TEXT_STYLE.fontFamily,
  fontSize: '12px',
  fontWeight: 500,
  letterSpacing: '0.04em',
  textDecoration: 'underline',
  cursor: 'pointer',
  padding: 0,
}

export const AUTH_HINT_STYLE = {
  ...AUTH_TEXT_STYLE,
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '0.14em',
}

export const AUTH_ERROR_STYLE = {
  ...AUTH_TEXT_STYLE,
  fontSize: '11px',
  fontWeight: 700,
  color: AUTH_ERROR_INK,
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
export const AuthPasswordInput = forwardRef(function AuthPasswordInput(
  { value, onChange, disabled, style, ...rest },
  ref,
) {
  // Shared metrics. Both layers must resolve to the SAME font, size, spacing,
  // alignment, line-height and padding or the asterisks and the caret drift
  // apart. They are declared once and spread into both.
  const metrics = {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
    fontSize: '17px',
    fontWeight: 400,
    letterSpacing: '0.18em',
    textAlign: 'center',
    lineHeight: '1.2',
    padding: '4px 0 6px',
  }
  return (
    // inline-grid with both children in cell 1/1: the overlay inherits the
    // input's exact box rather than a hand-tuned `top` offset, so the two
    // stay aligned across zoom levels and font fallbacks.
    <span style={{ display: 'inline-grid' }}>
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
