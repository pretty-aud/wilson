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
//   - NewCompanyWizard         (src/cloud/onboarding/NewCompanyWizard.jsx)
//   - NewUserWelcome           (src/cloud/onboarding/NewUserWelcome.jsx)
//   - Future: password-reset / forgot-username wizards (Session 3)
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
// Timings are matched to PasswordScreen so the two feel like one system.
// Keep them in sync if either changes.
// =============================================================================

import { useState, useEffect, useRef } from 'react'

// Timings — matched to PasswordScreen (src/components/PasswordScreen.jsx).
const LOGO_FADE_IN_MS   = 1200
const LOGO_FADE_OUT_MS  = 500
const LOGO_HOLD_MS      = 3800   // safety fallback when the chime can't play
const IDLE_HOLD_MS      = 1000
const SPLIT_HOLD_MS     = 1600
const REVEAL_EASE       = 'cubic-bezier(0.4, 0, 0.2, 1)'
const REVEAL_BAR_HEIGHT = '268px'

const COLOR_ORANGE       = '#ea580c'
const COLOR_ORANGE_LIGHT = '#f4a261'

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
          const resp = await fetch('/PetalStudios_Chime_V2.wav')
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
    const tHold = setTimeout(() => {
      if (phaseRef.current === 'logo-in') setPhase('logo-hold')
    }, LOGO_FADE_IN_MS)

    // Safety fallback in case the chime never fires (no audio, no user
    // gesture, autoplay blocked, or playStartupSound=false).
    const tSafety = setTimeout(() => {
      if (!chimeEnded) advanceFromHold()
    }, LOGO_FADE_IN_MS + LOGO_HOLD_MS)

    return () => {
      clearTimeout(tHold)
      clearTimeout(tSafety)
    }
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
    // Fire after the compress transition settles so the caller doesn't
    // see the 20px push happening under their newly-rendered content.
    const t = setTimeout(() => onIntroComplete?.(), SPLIT_HOLD_MS)
    return () => clearTimeout(t)
  }, [phase, onIntroComplete])

  // ── isRevealing prop → drive the end animation ────────────────────────
  useEffect(() => {
    if (!isRevealing || revealStartedRef.current) return
    revealStartedRef.current = true
    setPhase('revealing')

    const tFade = setTimeout(() => {
      setBgVisible(false)
      setPanelsVisible(false)
    }, 1000)

    const tDone = setTimeout(() => {
      setPhase('done')
      onAnimationComplete?.()
    }, 1800)

    return () => {
      clearTimeout(tFade)
      clearTimeout(tDone)
    }
  }, [isRevealing, onAnimationComplete])

  if (phase === 'done') return null

  const isLogoPhase = phase === 'logo-in' || phase === 'logo-hold' || phase === 'logo-out'
  const isReveal    = phase === 'revealing'
  const isSplit     = !isLogoPhase && phase !== 'idle'
  const showContent = !isLogoPhase && phase !== 'idle'

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
            src="/logo.png"
            alt=""
            style={{
              height: '90.5px',
              width: 'auto',
              filter: 'brightness(0) invert(1)',
              opacity: logoOpacity,
              transition: phase === 'logo-out'
                ? `opacity ${LOGO_FADE_OUT_MS}ms ease-out`
                : `opacity ${LOGO_FADE_IN_MS}ms ease-in`,
            }}
          />
        </div>
      )}

      {/* Light orange content background — fades out during reveal. */}
      {!isLogoPhase && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 51,
          backgroundColor: COLOR_ORANGE_LIGHT,
          transition: 'opacity 800ms ease-out',
          opacity: bgVisible ? 1 : 0,
          pointerEvents: isReveal ? 'none' : 'auto',
        }} />
      )}

      {/* Top orange panel — compresses from 50vh to REVEAL_BAR_HEIGHT. */}
      {!isLogoPhase && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0,
          backgroundColor: COLOR_ORANGE, zIndex: 52,
          height: isReveal ? REVEAL_BAR_HEIGHT : '50vh',
          transform: isReveal ? 'translateY(0)' : (isSplit ? 'translateY(-20px)' : 'translateY(0)'),
          opacity: panelsVisible ? 1 : 0,
          transition: isReveal
            ? `height 1000ms ${REVEAL_EASE}, transform 1000ms ${REVEAL_EASE}, opacity 800ms ease-out`
            : `transform 600ms ${REVEAL_EASE}`,
          pointerEvents: 'none',
        }} />
      )}

      {/* Bottom orange panel — mirror of the top. */}
      {!isLogoPhase && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          backgroundColor: COLOR_ORANGE, zIndex: 52,
          height: isReveal ? REVEAL_BAR_HEIGHT : '50vh',
          transform: isReveal ? 'translateY(0)' : (isSplit ? 'translateY(20px)' : 'translateY(0)'),
          opacity: panelsVisible ? 1 : 0,
          transition: isReveal
            ? `height 1000ms ${REVEAL_EASE}, transform 1000ms ${REVEAL_EASE}, opacity 800ms ease-out`
            : `transform 600ms ${REVEAL_EASE}`,
          pointerEvents: 'none',
        }} />
      )}

      {/* Center content slot — rendered once bars have arrived. Children
          sit above the panels (zIndex 53) and fade out during reveal. */}
      {showContent && (
        <div style={{
          position: 'fixed', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)', zIndex: 53,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: isReveal ? 0 : 1,
          transition: isReveal ? 'opacity 250ms ease-out' : 'none',
          // Callers style their own typography; AuthShell stays neutral.
        }}>
          {children}
        </div>
      )}
    </>
  )
}

// ── Reusable terminal-style typography ──────────────────────────────────────
// Helper callers can spread onto a <span> or <label> to match the
// PasswordScreen vibe without re-typing the style each time.
export const AUTH_TEXT_STYLE = {
  color: '#fff',
  fontWeight: 'bold',
  textTransform: 'uppercase',
  letterSpacing: '0.15em',
  fontSize: '20.5px',
  fontFamily: 'monospace',
}

// Reusable blinking cursor glyph. Relies on @keyframes blink in src/index.css.
export function AuthCursor() {
  return (
    <span style={{ animation: 'blink 1.06s step-end infinite' }}>_</span>
  )
}
