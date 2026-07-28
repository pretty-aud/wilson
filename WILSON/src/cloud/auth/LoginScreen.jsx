// =============================================================================
// LoginScreen — terminal-aesthetic sign-in, built on AuthShell.
//
// Two stages:
//   1. 'auth'      — single form with USERNAME + PASSWORD + SIGN IN button.
//                    On submit:
//                      a. POST /functions/v1/resolve-login with the username →
//                         { exists, email }. Server replies in constant time.
//                      b. supabase.auth.signInWithPassword({ email, password }).
//                         If username was unknown, we sign in against an
//                         unreachable fake email so request timing still looks
//                         like a real attempt (prevents username enumeration).
//                      c. Fetch workspace memberships. One workspace → reveal
//                         the app; more than one → advance to stage 2.
//   2. 'workspace' — list of the user's active workspaces. Arrow keys move the
//                    cursor, Enter selects. `issue-session` sets the active
//                    workspace; refreshSession picks up the new JWT claims.
//
// Security notes:
//   - The same generic error ("Sign-in failed. Check username and password.")
//     is used for every failure mode below rate-limiting.
//   - Response-body shape + timing are uniform across found / not-found /
//     rate-limited (the Edge Function's job; we just mirror that here).
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { saveSession } from './sessionStorage'
import AuthShell, { AUTH_TEXT_STYLE } from './AuthShell'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

const GENERIC_ERROR = 'SIGN-IN FAILED. CHECK USERNAME AND PASSWORD.'

async function resolveLogin({ username, workspaceSlug }) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/resolve-login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE_ANON,
    },
    body: JSON.stringify({
      username,
      ...(workspaceSlug ? { workspace_slug: workspaceSlug } : {}),
    }),
  })
  if (!res.ok) return { exists: false, email: null }
  return res.json()
}

async function issueSession(accessToken, workspaceId) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/issue-session`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE_ANON,
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(workspaceId ? { workspace_id: workspaceId } : {}),
  })
  if (!res.ok) return null
  return res.json()
}

// Read the user's memberships after sign-in. RLS on workspaces restricts this
// to rows the user can actually see (see supabase/migrations/0002_rls_workspaces.sql).
async function fetchUserWorkspaces() {
  const { data, error } = await supabase
    .from('workspaces')
    .select('id, name, slug')
    .order('name', { ascending: true })
  if (error) return []
  return data ?? []
}

export default function LoginScreen({ onAuthenticated, onCreateCompany, onForgotPassword, prefilledUsername }) {
  // ── Shell phase gate ───────────────────────────────────────────────────
  const [ready, setReady]         = useState(false)
  const [revealing, setRevealing] = useState(false)

  // ── Auth flow state ───────────────────────────────────────────────────
  // stage: 'auth' (username + password) | 'mfa' (Session 9 TOTP challenge,
  // between password success and everything else) | 'workspace' (chooser)
  const [stage, setStage]                   = useState('auth')
  const [username, setUsername]             = useState(prefilledUsername ?? '')
  const [password, setPassword]             = useState('')
  const [error, setError]                   = useState('')
  const [busy, setBusy]                     = useState(false)
  const [pendingSession, setPendingSession] = useState(null)
  const [workspaces, setWorkspaces]         = useState([])
  const [workspaceIndex, setWorkspaceIndex] = useState(0)
  const [stageFade, setStageFade]           = useState(1)
  const [mfaFactorId, setMfaFactorId]       = useState(null)
  const [mfaCode, setMfaCode]               = useState('')

  const finalSessionRef = useRef(null)
  const usernameInputRef = useRef(null)
  const mfaInputRef = useRef(null)

  // Focus username when the shell settles and whenever we return to auth stage.
  useEffect(() => {
    if (ready && stage === 'auth') usernameInputRef.current?.focus()
    if (ready && stage === 'mfa') mfaInputRef.current?.focus()
  }, [ready, stage])

  // Fade on stage transitions (only matters for auth → workspace swap).
  useEffect(() => {
    setStageFade(0)
    const t = setTimeout(() => setStageFade(1), 150)
    return () => clearTimeout(t)
  }, [stage])

  // ── Handlers ──────────────────────────────────────────────────────────
  const completeSignIn = useCallback(async (session, workspaceId) => {
    try {
      let effectiveSession = session
      // Only round-trip through issue-session + refresh when the user is
      // explicitly choosing a different workspace. For a single-workspace
      // user the custom_access_token_hook has already baked the right
      // workspace_id into the token returned by signInWithPassword; extra
      // calls would just burn a request and (per Session 1) currently 401.
      if (workspaceId) {
        await issueSession(session.access_token, workspaceId)
        const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession()
        if (!refreshErr && refreshed?.session) effectiveSession = refreshed.session
      }
      await saveSession({
        access_token:  effectiveSession.access_token,
        refresh_token: effectiveSession.refresh_token,
        expires_at:    effectiveSession.expires_at,
        user:          effectiveSession.user,
      })
      finalSessionRef.current = effectiveSession
      setRevealing(true)
    } catch (err) {
      console.warn('[wilson] completeSignIn failed:', err?.message ?? err)
      setError(GENERIC_ERROR)
      setBusy(false)
    }
  }, [])

  // Single submit handler: resolve username → email → signInWithPassword →
  // either reveal (1 workspace) or advance to chooser (>1 workspace).
  const handleAuthSubmit = useCallback(async (e) => {
    e?.preventDefault()
    if (busy) return
    const u = username.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9._-]{1,31}$/.test(u) || password.length === 0) {
      setError(GENERIC_ERROR)
      return
    }
    setBusy(true)
    setError('')
    try {
      const { exists, email: resolved } = await resolveLogin({ username: u })
      // If resolver says "not found", sign in with an unreachable email so the
      // request timing still looks like a real attempt (prevents username
      // enumeration via response time).
      const email = exists ? resolved : `__miss+${crypto.randomUUID()}@invalid.local`

      const { data, error: signInErr } = await supabase.auth.signInWithPassword({ email, password })
      if (signInErr || !data.session) {
        setError(GENERIC_ERROR)
        setBusy(false)
        return
      }
      setPendingSession(data.session)

      // Session 9 (locked #9): enrolled users clear the TOTP challenge
      // BEFORE workspace resolution or reveal — the challenge upgrades the
      // session to aal2, which the admin Edge Functions require.
      try {
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
        if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
          const { data: factors } = await supabase.auth.mfa.listFactors()
          const totp = (factors?.totp ?? []).find(f => f.status === 'verified')
          if (totp) {
            setMfaFactorId(totp.id)
            setMfaCode('')
            setStage('mfa')
            setBusy(false)
            return
          }
        }
      } catch { /* unenrolled (or MFA API unavailable) → proceed as aal1 */ }

      const ws = await fetchUserWorkspaces()
      if (ws.length > 1) {
        setWorkspaces(ws)
        setWorkspaceIndex(0)
        setStage('workspace')
        setBusy(false)
      } else {
        await completeSignIn(data.session, null)
      }
    } catch {
      setError(GENERIC_ERROR)
      setBusy(false)
    }
  }, [busy, username, password, completeSignIn])

  // TOTP verify → the SDK swaps in an aal2 session; continue exactly where
  // the password path left off (chooser vs reveal).
  const handleMfaSubmit = useCallback(async (e) => {
    e?.preventDefault()
    if (busy || !mfaFactorId) return
    const code = mfaCode.replace(/\s+/g, '')
    if (!/^[0-9]{6}$/.test(code)) {
      setError('CODE REJECTED. TRY AGAIN.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: mfaFactorId })
      if (chErr || !ch?.id) throw chErr ?? new Error('challenge failed')
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: ch.id,
        code,
      })
      if (vErr) {
        setError('CODE REJECTED. TRY AGAIN.')
        setMfaCode('')
        setBusy(false)
        return
      }
      const { data: fresh } = await supabase.auth.getSession()
      const session = fresh?.session
      if (!session) {
        setError(GENERIC_ERROR)
        setBusy(false)
        return
      }
      setPendingSession(session)
      const ws = await fetchUserWorkspaces()
      if (ws.length > 1) {
        setWorkspaces(ws)
        setWorkspaceIndex(0)
        setStage('workspace')
        setBusy(false)
      } else {
        await completeSignIn(session, null)
      }
    } catch {
      setError('CODE REJECTED. TRY AGAIN.')
      setBusy(false)
    }
  }, [busy, mfaFactorId, mfaCode, completeSignIn])

  const handleWorkspaceChoose = useCallback(async (wsId) => {
    if (busy || !pendingSession) return
    setBusy(true)
    setError('')
    await completeSignIn(pendingSession, wsId)
  }, [busy, pendingSession, completeSignIn])

  // Arrow-key navigation for the workspace chooser.
  useEffect(() => {
    if (stage !== 'workspace') return
    const onKey = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setWorkspaceIndex((i) => {
          const delta = e.key === 'ArrowDown' ? 1 : -1
          return (i + delta + workspaces.length) % workspaces.length
        })
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const chosen = workspaces[workspaceIndex]
        if (chosen) handleWorkspaceChoose(chosen.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stage, workspaces, workspaceIndex, handleWorkspaceChoose])

  // ── Render helpers ────────────────────────────────────────────────────
  // Native caret in white — browsers blink it gently; disappears when the
  // input isn't focused. Text is lowercased-normal (not uppercase) so the
  // typed value reads naturally against the uppercase labels above.
  const inputStyle = {
    ...AUTH_TEXT_STYLE,
    fontSize: '17px',
    fontWeight: 400,
    textTransform: 'none',
    letterSpacing: '0.02em',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid rgba(255,255,255,0.55)',
    outline: 'none',
    caretColor: '#fff',
    textAlign: 'center',
    width: '22ch',
    padding: '4px 0 6px',
  }
  const labelStyle = {
    ...AUTH_TEXT_STYLE,
    fontSize: '11px',
    fontWeight: 600,
    opacity: 0.8,
    letterSpacing: '0.22em',
  }

  return (
    <AuthShell
      isRevealing={revealing}
      onIntroComplete={() => setReady(true)}
      onAnimationComplete={() => onAuthenticated?.(finalSessionRef.current)}
      showLogoIntro
      playStartupSound={true}
    >
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '16px', minWidth: '320px',
        opacity: stageFade, transition: 'opacity 150ms ease-out',
      }}>
        {/* Static title. In reveal, the parent fades the whole block. */}
        <div style={{ ...AUTH_TEXT_STYLE, fontSize: '24px', letterSpacing: '0.18em' }}>
          LOGIN
        </div>

        {stage === 'auth' && (
          <form onSubmit={handleAuthSubmit}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
              <div style={labelStyle}>USERNAME</div>
              <input
                ref={usernameInputRef}
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value.slice(0, 32))}
                disabled={busy}
                style={inputStyle}
                aria-label="Username"
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
              <div style={labelStyle}>PASSWORD</div>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                style={inputStyle}
                aria-label="Password"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              style={{
                ...AUTH_TEXT_STYLE,
                fontSize: '12px',
                fontWeight: 600,
                letterSpacing: '0.18em',
                marginTop: '6px',
                background: '#fff',
                border: 'none',
                color: '#ea580c',
                padding: '10px 34px',
                borderRadius: '2px',
                cursor: busy ? 'default' : 'pointer',
                opacity: busy ? 0.55 : 1,
                transition: 'opacity 150ms ease-out, transform 100ms ease-out',
              }}
              onMouseDown={(e) => !busy && (e.currentTarget.style.transform = 'scale(0.98)')}
              onMouseUp={(e)   => (e.currentTarget.style.transform = 'scale(1)')}
              onMouseLeave={(e)=> (e.currentTarget.style.transform = 'scale(1)')}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>

            {onForgotPassword && (
              <button
                type="button"
                onClick={onForgotPassword}
                style={{
                  background: 'transparent', border: 'none',
                  color: '#fff',
                  fontFamily: AUTH_TEXT_STYLE.fontFamily,
                  fontSize: '12px',
                  fontWeight: 500,
                  letterSpacing: '0.04em',
                  textDecoration: 'underline',
                  cursor: 'pointer', padding: 0,
                  opacity: 0.6, marginTop: '2px',
                }}
              >
                Forgot password?
              </button>
            )}

            {onCreateCompany && (
              <button
                type="button"
                onClick={onCreateCompany}
                style={{
                  background: 'transparent', border: 'none',
                  color: '#fff',
                  fontFamily: AUTH_TEXT_STYLE.fontFamily,
                  fontSize: '12px',
                  fontWeight: 500,
                  letterSpacing: '0.04em',
                  textDecoration: 'underline',
                  cursor: 'pointer', padding: 0,
                  opacity: 0.75, marginTop: '4px',
                }}
              >
                New company?
              </button>
            )}
          </form>
        )}

        {stage === 'mfa' && (
          <form onSubmit={handleMfaSubmit}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
              <div style={labelStyle}>AUTHENTICATOR CODE</div>
              <input
                ref={mfaInputRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/[^0-9\s]/g, ''))}
                disabled={busy}
                style={{ ...inputStyle, letterSpacing: '0.35em', textAlign: 'center' }}
                aria-label="Authenticator code"
              />
            </div>
            <div style={{ ...AUTH_TEXT_STYLE, fontSize: '10px', fontWeight: 400, opacity: 0.7, letterSpacing: '0.08em' }}>
              ENTER THE 6-DIGIT CODE FROM YOUR AUTHENTICATOR APP
            </div>
            <button
              type="submit"
              disabled={busy}
              style={{
                ...AUTH_TEXT_STYLE,
                fontSize: '12px',
                fontWeight: 600,
                letterSpacing: '0.18em',
                marginTop: '6px',
                background: '#fff',
                border: 'none',
                color: '#ea580c',
                padding: '10px 34px',
                borderRadius: '2px',
                cursor: busy ? 'default' : 'pointer',
                opacity: busy ? 0.55 : 1,
                transition: 'opacity 150ms ease-out, transform 100ms ease-out',
              }}
              onMouseDown={(e) => !busy && (e.currentTarget.style.transform = 'scale(0.98)')}
              onMouseUp={(e)   => (e.currentTarget.style.transform = 'scale(1)')}
              onMouseLeave={(e)=> (e.currentTarget.style.transform = 'scale(1)')}
            >
              {busy ? 'Verifying…' : 'Verify'}
            </button>
          </form>
        )}

        {stage === 'workspace' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <div style={{ ...AUTH_TEXT_STYLE, fontSize: '11px', opacity: 0.8 }}>
              SELECT WORKSPACE
            </div>
            <ul style={{
              listStyle: 'none', padding: 0, margin: 0,
              display: 'flex', flexDirection: 'column', gap: '4px',
              minWidth: '280px',
            }}>
              {workspaces.map((ws, i) => {
                const selected = i === workspaceIndex
                return (
                  <li key={ws.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setWorkspaceIndex(i)}
                      onClick={() => handleWorkspaceChoose(ws.id)}
                      disabled={busy}
                      style={{
                        ...AUTH_TEXT_STYLE,
                        fontSize: '15px',
                        background: 'transparent',
                        border: 'none',
                        cursor: busy ? 'default' : 'pointer',
                        width: '100%',
                        textAlign: 'left',
                        padding: '4px 8px',
                        display: 'flex', alignItems: 'center', gap: '10px',
                        opacity: selected ? 1 : 0.6,
                      }}
                    >
                      <span style={{ width: '12px' }}>{selected ? '>' : ' '}</span>
                      <span>{ws.name}</span>
                      <span style={{ fontSize: '11px', opacity: 0.6 }}>{ws.slug}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <div style={{ ...AUTH_TEXT_STYLE, fontSize: '10px', opacity: 0.5, marginTop: '8px' }}>
              ↑ ↓ TO MOVE · ENTER TO SELECT
            </div>
          </div>
        )}

        {error && (
          <div style={{ ...AUTH_TEXT_STYLE, fontSize: '11px', color: '#fee2e2' }}>
            {error}
          </div>
        )}
      </div>
    </AuthShell>
  )
}
