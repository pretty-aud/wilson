// =============================================================================
// LoginScreen — terminal-aesthetic username-first sign-in, built on AuthShell.
//
// Three stages:
//   1. 'username'  — single input, posted to /functions/v1/resolve-login.
//                    Server returns { exists, email } in constant time.
//                    We do NOT differentiate "not found" from "rate-limited"
//                    in UI copy (matches the resolver's constant-time guarantee).
//   2. 'password'  — same input becomes a password field. On submit we call
//                    supabase.auth.signInWithPassword({ email, password }).
//                    If the user has exactly one workspace membership we skip
//                    straight to the reveal. Otherwise we advance to stage 3.
//   3. 'workspace' — list of the user's active workspaces. Arrow keys move the
//                    cursor, Enter selects. `issue-session` sets the active
//                    workspace; refreshSession picks up the new JWT claims.
//
// Security notes:
//   - The same generic error ("Sign-in failed. Check username and password.")
//     is used for every failure mode below rate-limiting.
//   - On username-not-found we still transition to the password stage and
//     attempt auth with a fake email so UI timing doesn't leak usernames.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { saveSession } from './sessionStorage'
import AuthShell, { AUTH_TEXT_STYLE, AuthCursor } from './AuthShell'

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

export default function LoginScreen({ onAuthenticated, onCreateCompany, prefilledUsername }) {
  // ── Shell phase gate ───────────────────────────────────────────────────
  const [ready, setReady]         = useState(false)
  const [revealing, setRevealing] = useState(false)

  // ── Auth flow state ───────────────────────────────────────────────────
  const [stage, setStage]                 = useState('username')
  const [username, setUsername]           = useState(prefilledUsername ?? '')
  const [password, setPassword]           = useState('')
  const [resolvedEmail, setResolvedEmail] = useState(null)
  const [error, setError]                 = useState('')
  const [busy, setBusy]                   = useState(false)
  const [pendingSession, setPendingSession] = useState(null) // captured post-signIn
  const [workspaces, setWorkspaces]         = useState([])
  const [workspaceIndex, setWorkspaceIndex] = useState(0)
  const [stageFade, setStageFade]           = useState(1)

  // Final session to hand off to the parent once the reveal finishes.
  const finalSessionRef = useRef(null)
  const inputRef = useRef(null)

  // Focus the input whenever the stage enters 'username' or 'password'.
  useEffect(() => {
    if (!ready) return
    if (stage === 'username' || stage === 'password') {
      inputRef.current?.focus()
    }
  }, [ready, stage])

  // Fade the stage row when it swaps. The bars stay put (owned by AuthShell).
  useEffect(() => {
    setStageFade(0)
    const t = setTimeout(() => setStageFade(1), 150)
    return () => clearTimeout(t)
  }, [stage])

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleUsernameSubmit = useCallback(async (e) => {
    e?.preventDefault()
    if (busy) return
    const u = username.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9._-]{1,31}$/.test(u)) {
      setError(GENERIC_ERROR)
      return
    }
    setBusy(true)
    setError('')
    try {
      const { exists, email } = await resolveLogin({ username: u })
      // Always advance — never reveal whether the username existed.
      setResolvedEmail(exists ? email : null)
      setStage('password')
    } catch {
      setError(GENERIC_ERROR)
    } finally {
      setBusy(false)
    }
  }, [busy, username])

  const completeSignIn = useCallback(async (session, workspaceId) => {
    await issueSession(session.access_token, workspaceId)
    const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession()
    const finalSession = refreshErr ? session : refreshed.session
    if (!finalSession) {
      setError(GENERIC_ERROR)
      setBusy(false)
      return
    }
    await saveSession({
      access_token:  finalSession.access_token,
      refresh_token: finalSession.refresh_token,
      expires_at:    finalSession.expires_at,
      user:          finalSession.user,
    })
    finalSessionRef.current = finalSession
    setRevealing(true)
  }, [])

  const handlePasswordSubmit = useCallback(async (e) => {
    e?.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      // If resolver said "not found", submit against an unreachable email so
      // auth timing still mirrors a real attempt.
      const email = resolvedEmail ?? `__miss+${crypto.randomUUID()}@invalid.local`
      const { data, error: signInErr } = await supabase.auth.signInWithPassword({
        email, password,
      })
      if (signInErr || !data.session) {
        setError(GENERIC_ERROR)
        setBusy(false)
        return
      }
      setPendingSession(data.session)

      // How many workspaces does this user belong to?
      const ws = await fetchUserWorkspaces()
      if (ws.length > 1) {
        setWorkspaces(ws)
        setWorkspaceIndex(0)
        setStage('workspace')
        setBusy(false)
      } else {
        // 0 or 1 workspaces — let issue-session pick the default and move on.
        await completeSignIn(data.session, null)
      }
    } catch {
      setError(GENERIC_ERROR)
      setBusy(false)
    }
  }, [busy, password, resolvedEmail, completeSignIn])

  const handleWorkspaceChoose = useCallback(async (wsId) => {
    if (busy || !pendingSession) return
    setBusy(true)
    setError('')
    await completeSignIn(pendingSession, wsId)
  }, [busy, pendingSession, completeSignIn])

  const backToUsername = useCallback(() => {
    setStage('username')
    setPassword('')
    setError('')
  }, [])

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
  const inputStyle = {
    ...AUTH_TEXT_STYLE,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    caretColor: 'transparent', // native caret hidden; we render AuthCursor
    textAlign: 'center',
    width: '18ch',
  }

  return (
    <AuthShell
      isRevealing={revealing}
      onIntroComplete={() => setReady(true)}
      onAnimationComplete={() => onAuthenticated?.(finalSessionRef.current)}
      showLogoIntro
      playStartupSound={false}
    >
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '18px', minWidth: '320px',
        opacity: stageFade, transition: 'opacity 150ms ease-out',
      }}>
        {/* Static title — present on every stage so only the label+input
            swap underneath, per the Session 2 aesthetic spec. */}
        <div style={AUTH_TEXT_STYLE}>LOGIN</div>

        {stage === 'username' && (
          <form onSubmit={handleUsernameSubmit}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <div style={{ ...AUTH_TEXT_STYLE, fontSize: '11px', opacity: 0.8 }}>USERNAME</div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <input
                ref={inputRef}
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value.slice(0, 32))}
                disabled={busy}
                style={inputStyle}
                aria-label="Username"
              />
              <AuthCursor />
            </div>
            {onCreateCompany && (
              <button
                type="button"
                onClick={onCreateCompany}
                style={{
                  marginTop: '14px', background: 'transparent', border: 'none',
                  color: '#fff', fontFamily: 'monospace', fontSize: '11px',
                  textDecoration: 'underline', cursor: 'pointer', padding: 0,
                  opacity: 0.75,
                }}
              >
                new company?
              </button>
            )}
          </form>
        )}

        {stage === 'password' && (
          <form onSubmit={handlePasswordSubmit}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <div style={{ ...AUTH_TEXT_STYLE, fontSize: '11px', opacity: 0.8 }}>
              PASSWORD <span style={{ opacity: 0.6 }}>· {username}</span>
              <button
                type="button" onClick={backToUsername}
                style={{
                  marginLeft: '8px', background: 'transparent', border: 'none',
                  color: '#fff', fontFamily: 'monospace', fontSize: '11px',
                  textDecoration: 'underline', cursor: 'pointer', padding: 0,
                }}
              >
                change
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <input
                ref={inputRef}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                style={inputStyle}
                aria-label="Password"
              />
              <AuthCursor />
            </div>
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
