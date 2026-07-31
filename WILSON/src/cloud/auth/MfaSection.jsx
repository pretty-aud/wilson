// =============================================================================
// MfaSection — Session 9 (locked decision #9: MFA for all admin tiers).
//
// Three exports:
//   MfaEnrollPanel    — the QR + secret + verify-code block (shared).
//   MfaEnrollGate     — full-screen post-login overlay (App.jsx mounts it for
//                       admins/operators with no verified TOTP factor —
//                       the same pendingOnboarding overlay pattern).
//   MfaSecuritySection — Settings > Profile security block: status, enroll,
//                       disable (blocked for admins).
//
// Enrollment flow: mfa.enroll('totp') → QR/secret → challenge+verify(code).
// A previously abandoned unverified factor is unenrolled first — GoTrue
// keeps them around and they'd shadow the fresh one.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { ShieldCheck, ShieldOff, Copy, Check } from 'lucide-react'
import { supabase } from './supabaseClient'
import AuthShell, { AUTH_TEXT_STYLE } from './AuthShell'
import { usePermissions } from '../../permissions'
import { reportAppEvent } from '../errorCodes'
import { withTimeout, AUTH_TIMEOUT_MS } from './withTimeout'

async function listVerifiedTotp() {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw error
  const all = data?.totp ?? []
  return {
    verified: all.filter(f => f.status === 'verified'),
    unverified: all.filter(f => f.status !== 'verified'),
  }
}

function qrSrc(qr) {
  if (!qr) return null
  return qr.startsWith('data:') ? qr : `data:image/svg+xml;utf8,${encodeURIComponent(qr)}`
}

// ── Shared enroll panel ──────────────────────────────────────────────────
// dark=true renders on the auth-overlay (white on orange); dark=false uses
// the settings-light tokens.
export function MfaEnrollPanel({ dark = false, onEnrolled }) {
  const [phase, setPhase] = useState('loading') // loading | show | verifying | error
  const [factor, setFactor] = useState(null)    // { id, qr, secret }
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const startedRef = useRef(false)

  const begin = useCallback(async () => {
    setPhase('loading')
    setError(null)
    try {
      // Clear abandoned unverified factors so the fresh QR is the only one.
      try {
        const { unverified } = await listVerifiedTotp()
        for (const f of unverified) {
          try { await supabase.auth.mfa.unenroll({ factorId: f.id }) } catch { /* stale */ }
        }
      } catch { /* listing is best-effort */ }
      const { data, error: enrollErr } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
      if (enrollErr || !data) throw enrollErr ?? new Error('enroll failed')
      setFactor({
        id: data.id,
        qr: data.totp?.qr_code ?? null,
        secret: data.totp?.secret ?? null,
      })
      setPhase('show')
    } catch (err) {
      setError(err?.message || 'Enrollment failed.')
      setPhase('error')
      reportAppEvent({ code: 'WIL-1004', eventType: 'auth', context: { step: 'enroll' }, error: err })
    }
  }, [])

  // StrictMode-safe one-shot start (ref guard, no cleanup — the enroll
  // round-trip must not be cancelled by the dev double-mount).
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    begin()
  }, [begin])

  const verify = useCallback(async (e) => {
    e?.preventDefault()
    const c = code.replace(/\s+/g, '')
    if (!/^[0-9]{6}$/.test(c) || !factor?.id) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    setPhase('verifying')
    setError(null)
    try {
      // Session 17: bounded. An unbounded verify left this button reading
      // "Activating…" indefinitely while the factor was already verified
      // server-side — the user could not tell enrolment had worked.
      const { data: ch, error: chErr } = await withTimeout(
        supabase.auth.mfa.challenge({ factorId: factor.id }),
        AUTH_TIMEOUT_MS, 'MFA challenge')
      if (chErr || !ch?.id) throw chErr ?? new Error('challenge failed')
      const { error: vErr } = await withTimeout(
        supabase.auth.mfa.verify({ factorId: factor.id, challengeId: ch.id, code: c }),
        AUTH_TIMEOUT_MS, 'MFA verify')
      if (vErr) {
        setError('Code rejected — try the next one from your app.')
        setPhase('show')
        setCode('')
        return
      }
      // Give SUCCESS its own terminal state. Previously this path only called
      // onEnrolled() and left phase at 'verifying', so the button was stuck on
      // "Activating…" unless the parent unmounted this component instantly —
      // which the enrol gate does NOT do: it hands off to a 1s reveal
      // animation first. A success with no terminal state of its own is a
      // success the user cannot see.
      setPhase('enrolled')
      onEnrolled?.()
    } catch (err) {
      setError(err?.name === 'TimeoutError'
        ? 'The server did not respond. Check your connection and try again.'
        : (err?.message || 'Verification failed.'))
      setPhase('show')
      reportAppEvent({ code: 'WIL-1004', eventType: 'auth', context: { step: 'verify' }, error: err })
    }
  }, [code, factor, onEnrolled])

  const copySecret = useCallback(async () => {
    if (!factor?.secret) return
    try {
      await navigator.clipboard.writeText(factor.secret)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable — secret stays visible */ }
  }, [factor])

  const fg = dark ? '#ffffff' : '#1c1917'
  const sub = dark ? 'rgba(255,255,255,0.75)' : '#57534e'

  if (phase === 'loading') {
    return <div className="text-xs font-mono" style={{ color: sub }}>Preparing enrollment…</div>
  }
  if (phase === 'error') {
    return (
      <div className="flex flex-col gap-2 items-start">
        <div className="text-xs font-mono" style={{ color: '#dc2626' }}>{error}</div>
        <button
          type="button"
          onClick={() => { startedRef.current = true; begin() }}
          className="text-xs font-mono px-3 py-1.5 rounded-sm"
          style={{ backgroundColor: '#1c1917', color: '#f4a261' }}
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={verify} className="flex flex-col items-center gap-3">
      {factor?.qr && (
        <img
          src={qrSrc(factor.qr)}
          alt="Authenticator enrollment QR code"
          style={{ width: 168, height: 168, backgroundColor: '#fff', borderRadius: 4, padding: 6 }}
        />
      )}
      <div className="text-[11px] font-mono text-center leading-relaxed" style={{ color: sub, maxWidth: 300 }}>
        Scan with any authenticator app (1Password, Google Authenticator, Authy…)
        or enter the secret manually:
      </div>
      {factor?.secret && (
        <button
          type="button"
          onClick={copySecret}
          className="flex items-center gap-2 text-[11px] font-mono px-2 py-1 rounded-sm"
          style={{ color: fg, backgroundColor: dark ? 'rgba(255,255,255,0.12)' : 'rgba(120,70,30,0.12)' }}
          title="Copy secret"
        >
          <span style={{ letterSpacing: '0.08em', wordBreak: 'break-all' }}>{factor.secret}</span>
          {copied ? <Check className="w-3 h-3 flex-shrink-0" /> : <Copy className="w-3 h-3 flex-shrink-0" />}
        </button>
      )}
      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^0-9\s]/g, ''))}
        placeholder="000000"
        aria-label="Authenticator code"
        className="px-3 py-2 text-sm font-mono rounded-sm focus:outline-none text-center"
        style={{
          letterSpacing: '0.35em',
          width: 160,
          backgroundColor: dark ? 'rgba(255,255,255,0.14)' : 'rgba(120,70,30,0.55)',
          color: dark ? '#fff' : '#fde8d0',
          border: 'none',
        }}
      />
      {error && <div className="text-[11px] font-mono" style={{ color: dark ? '#ffd7c2' : '#dc2626' }}>{error}</div>}
      <button
        type="submit"
        disabled={phase === 'verifying' || phase === 'enrolled'}
        className="text-xs font-bold uppercase tracking-widest px-5 py-2 rounded-sm"
        style={{
          backgroundColor: dark ? '#fff' : '#ea580c',
          color: dark ? '#ea580c' : '#fff7ed',
          border: dark ? 'none' : '1px solid #c2410c',
          opacity: phase === 'verifying' || phase === 'enrolled' ? 0.6 : 1,
          cursor: phase === 'verifying' || phase === 'enrolled' ? 'default' : 'pointer',
        }}
      >
        {phase === 'enrolled' ? 'MFA active ✓' : phase === 'verifying' ? 'Activating…' : 'Activate MFA'}
      </button>
    </form>
  )
}

// ── Post-login gate for admin tiers ──────────────────────────────────────
// v1 allows a per-sign-in deferral ("asks again next sign-in") — the gate
// re-fires on every login until a verified factor exists. Hard, no-deferral
// enforcement lands with the S11 TPN pass (needs the CI probe admin
// enrolled first). Enrolled admins are already challenged at sign-in.
export function MfaEnrollGate({ onComplete, onDefer }) {
  const [revealing, setRevealing] = useState(false)
  // Session 17 — same handoff safety net as LoginScreen. AuthShell returns
  // null once its reveal reaches 'done', but THIS wrapper div is
  // position:fixed inset:0 z-index:60 — so if onComplete never fires, the
  // user is left under a full-screen invisible overlay showing App's orange
  // root through it, swallowing every click. Exactly one path completes.
  const completedRef = useRef(false)
  const fallbackRef = useRef(null)
  const complete = useCallback(() => {
    if (completedRef.current) return
    completedRef.current = true
    if (fallbackRef.current) clearTimeout(fallbackRef.current)
    onComplete?.()
  }, [onComplete])
  useEffect(() => () => { if (fallbackRef.current) clearTimeout(fallbackRef.current) }, [])
  const startReveal = useCallback(() => {
    setRevealing(true)
    fallbackRef.current = setTimeout(() => {
      if (!completedRef.current) {
        console.warn('[wilson] MFA gate reveal did not fire — closing directly')
        complete()
      }
    }, 4000)
  }, [complete])
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60 }}>
      <AuthShell
        showLogoIntro={false}
        isRevealing={revealing}
        onAnimationComplete={complete}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <div style={{ ...AUTH_TEXT_STYLE, fontSize: '13px', letterSpacing: '0.18em' }}>
            SECURE YOUR ADMIN ACCOUNT
          </div>
          <div style={{ ...AUTH_TEXT_STYLE, fontSize: '10px', fontWeight: 400, opacity: 0.75, maxWidth: 320, textAlign: 'center', letterSpacing: '0.06em', lineHeight: 1.6 }}>
            WORKSPACE ADMINS SIGN IN WITH AN AUTHENTICATOR CODE. SET IT UP ONCE —
            YOU&apos;LL BE ASKED FOR A CODE AT EVERY SIGN-IN.
          </div>
          <MfaEnrollPanel dark onEnrolled={startReveal} />
          <div style={{ display: 'flex', gap: '18px' }}>
            <button
              type="button"
              onClick={() => onDefer?.()}
              style={{
                background: 'transparent', border: 'none', color: '#fff',
                fontFamily: AUTH_TEXT_STYLE.fontFamily, fontSize: '11px',
                textDecoration: 'underline', cursor: 'pointer', opacity: 0.6,
              }}
            >
              Set up later
            </button>
            <button
              type="button"
              onClick={() => window.wilsonSignOut?.()}
              style={{
                background: 'transparent', border: 'none', color: '#fff',
                fontFamily: AUTH_TEXT_STYLE.fontFamily, fontSize: '11px',
                textDecoration: 'underline', cursor: 'pointer', opacity: 0.6,
              }}
            >
              Sign out instead
            </button>
          </div>
        </div>
      </AuthShell>
    </div>
  )
}

// ── Settings > Profile security block ────────────────────────────────────
export function MfaSecuritySection() {
  const perms = usePermissions()
  const [state, setState] = useState({ loading: true, enrolled: false, factorId: null })
  const [enrolling, setEnrolling] = useState(false)
  const [confirmDisable, setConfirmDisable] = useState(false)
  const [error, setError] = useState(null)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const { verified } = await listVerifiedTotp()
      if (!mountedRef.current) return
      setState({ loading: false, enrolled: verified.length > 0, factorId: verified[0]?.id ?? null })
    } catch {
      if (!mountedRef.current) return
      setState({ loading: false, enrolled: false, factorId: null })
    }
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const isAdminTier = perms.role === 'admin' || perms.isPlatformOperator

  const disable = useCallback(async () => {
    if (!state.factorId) return
    setError(null)
    try {
      const { error: err } = await supabase.auth.mfa.unenroll({ factorId: state.factorId })
      if (err) throw err
      setConfirmDisable(false)
      refresh()
    } catch (err) {
      setError(err?.message || 'Could not disable MFA.')
    }
  }, [state.factorId, refresh])

  return (
    <div>
      <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">Two-Factor Authentication</h2>
      <p className="text-xs text-stone-950 mb-4 leading-relaxed">
        A 6-digit authenticator code on top of your password.
        {isAdminTier ? ' Required for admins.' : ' Recommended for everyone.'}
      </p>

      {state.loading ? (
        <div className="text-xs font-mono" style={{ color: '#57534e' }}>Checking status…</div>
      ) : enrolling ? (
        <div className="p-4 rounded-sm" style={{ backgroundColor: 'rgba(120,70,30,0.12)' }}>
          <MfaEnrollPanel onEnrolled={() => { setEnrolling(false); refresh() }} />
        </div>
      ) : (
        <div className="flex items-center gap-3">
          {state.enrolled ? (
            <>
              <span className="flex items-center gap-1.5 text-xs font-mono" style={{ color: '#15803d' }}>
                <ShieldCheck className="w-4 h-4" /> Enabled
              </span>
              {isAdminTier ? (
                <span className="text-[11px] font-mono" style={{ color: '#57534e' }}>
                  Admins must keep MFA on.
                </span>
              ) : confirmDisable ? (
                <span className="flex items-center gap-2">
                  <span className="text-[11px] font-mono" style={{ color: '#dc2626' }}>Disable MFA?</span>
                  <button type="button" onClick={disable} className="text-[11px] font-mono px-2 py-1 rounded-sm" style={{ backgroundColor: '#dc2626', color: '#fff' }}>Disable</button>
                  <button type="button" onClick={() => setConfirmDisable(false)} className="text-[11px] font-mono px-2 py-1 rounded-sm" style={{ backgroundColor: 'rgba(120,70,30,0.18)', color: '#57534e' }}>Keep it</button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDisable(true)}
                  className="flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded-sm"
                  style={{ color: '#dc2626', backgroundColor: 'rgba(220,38,38,0.08)' }}
                >
                  <ShieldOff className="w-3 h-3" /> Disable
                </button>
              )}
            </>
          ) : (
            <>
              <span className="text-xs font-mono" style={{ color: '#57534e' }}>Not enrolled</span>
              <button
                type="button"
                onClick={() => setEnrolling(true)}
                className="text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-sm"
                style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}
              >
                Set up
              </button>
            </>
          )}
        </div>
      )}

      {error && <div className="mt-2 text-[11px] font-mono" style={{ color: '#dc2626' }}>{error}</div>}
    </div>
  )
}
