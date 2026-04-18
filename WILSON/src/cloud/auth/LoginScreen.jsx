// =============================================================================
// LoginScreen — username-first two-step sign-in.
//
//   Step 1: single "Username" input  -> POST /functions/v1/resolve-login
//           Server returns { exists, email } in constant time. We do NOT
//           differentiate "user not found" from "rate-limited" in UI copy.
//
//   Step 2: same input becomes "Password", with username shown above in
//           small print. -> supabase.auth.signInWithPassword({ email, password })
//
//   On success: optionally call issue-session to set an active workspace,
//   refresh the session to pick up the new JWT claims, persist via
//   sessionStorage.saveSession, then notify parent.
//
// The generic error message "Sign-in failed. Check username and password."
// is used for every failure mode below rate-limit, to match the resolver's
// constant-time guarantee.
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { saveSession } from './sessionStorage'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

const GENERIC_ERROR = 'Sign-in failed. Check username and password.'

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

export default function LoginScreen({ onAuthenticated }) {
  const [stage, setStage] = useState('username') // 'username' | 'password'
  const [username, setUsername] = useState('')
  const [workspaceSlug, setWorkspaceSlug] = useState('')
  const [password, setPassword] = useState('')
  const [resolvedEmail, setResolvedEmail] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [stage])

  async function handleUsernameSubmit(e) {
    e.preventDefault()
    if (busy) return
    const u = username.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9._-]{1,31}$/.test(u)) {
      setError(GENERIC_ERROR)
      return
    }
    setBusy(true)
    setError('')
    try {
      const { exists, email } = await resolveLogin({
        username: u,
        workspaceSlug: workspaceSlug.trim() || undefined,
      })
      // Even if `exists` is false, we advance to the password stage so that
      // an attacker can't learn usernames from the UI transition. The
      // subsequent signInWithPassword will fail with the same generic error.
      setResolvedEmail(exists ? email : null)
      setStage('password')
    } catch {
      setError(GENERIC_ERROR)
    } finally {
      setBusy(false)
    }
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      // If resolver said "not found", fall through to a fake auth call with an
      // unreachable email so timing still matches a real attempt.
      const email = resolvedEmail ?? `__miss+${crypto.randomUUID()}@invalid.local`

      const { data, error: signInErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInErr || !data.session) {
        setError(GENERIC_ERROR)
        setBusy(false)
        return
      }

      // Issue session — picks the user's default (or only) workspace.
      // Multi-workspace chooser UI lands in Session 2.
      await issueSession(data.session.access_token, null)

      // Refresh so the new JWT carries workspace_id from app_metadata.
      const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession()
      const finalSession = refreshErr ? data.session : refreshed.session

      if (!finalSession) {
        setError(GENERIC_ERROR)
        setBusy(false)
        return
      }

      await saveSession({
        access_token: finalSession.access_token,
        refresh_token: finalSession.refresh_token,
        expires_at: finalSession.expires_at,
        user: finalSession.user,
      })

      onAuthenticated?.(finalSession)
    } catch {
      setError(GENERIC_ERROR)
      setBusy(false)
    }
  }

  function backToUsername() {
    setStage('username')
    setPassword('')
    setError('')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0e0e10] text-[#e8e2d7]">
      <form
        onSubmit={stage === 'username' ? handleUsernameSubmit : handlePasswordSubmit}
        className="w-full max-w-sm px-8 py-10 rounded-xl bg-[#17171a] border border-[#2a2a2e] shadow-2xl"
      >
        <h1 className="text-2xl font-semibold mb-1 tracking-wide">WILSON</h1>
        <p className="text-sm text-[#8a8580] mb-6">
          {stage === 'username' ? 'Sign in' : 'Enter your password'}
        </p>

        {stage === 'password' && (
          <div className="mb-4 text-xs text-[#8a8580]">
            Signed in as <span className="text-[#e8e2d7]">{username}</span>
            {workspaceSlug && <> · <span className="text-[#e8e2d7]">{workspaceSlug}</span></>}
            <button
              type="button"
              onClick={backToUsername}
              className="ml-2 text-[#9a6438] hover:underline"
            >
              change
            </button>
          </div>
        )}

        {stage === 'username' ? (
          <>
            <label className="block text-xs uppercase tracking-wider text-[#8a8580] mb-2">
              Username
            </label>
            <input
              ref={inputRef}
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-[#0e0e10] border border-[#2a2a2e] rounded px-3 py-2 mb-3 focus:border-[#9a6438] outline-none"
              disabled={busy}
            />
            <label className="block text-xs uppercase tracking-wider text-[#8a8580] mb-2">
              Workspace <span className="lowercase text-[#5a554f]">(optional)</span>
            </label>
            <input
              type="text"
              autoComplete="organization"
              value={workspaceSlug}
              onChange={(e) => setWorkspaceSlug(e.target.value)}
              placeholder="petal-studios"
              className="w-full bg-[#0e0e10] border border-[#2a2a2e] rounded px-3 py-2 mb-4 focus:border-[#9a6438] outline-none"
              disabled={busy}
            />
          </>
        ) : (
          <>
            <label className="block text-xs uppercase tracking-wider text-[#8a8580] mb-2">
              Password
            </label>
            <input
              ref={inputRef}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[#0e0e10] border border-[#2a2a2e] rounded px-3 py-2 mb-4 focus:border-[#9a6438] outline-none"
              disabled={busy}
            />
          </>
        )}

        {error && <div className="text-sm text-[#d77] mb-3">{error}</div>}

        <button
          type="submit"
          disabled={busy}
          className="w-full py-2 rounded bg-[#9a6438] hover:bg-[#b0754a] disabled:opacity-60 transition"
        >
          {busy ? '…' : stage === 'username' ? 'Continue' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
