// =============================================================================
// ResetPasswordWizard — lands users arriving from the recovery email.
//
// Supabase Auth's recovery flow sends the user back to our redirectTo URL
// with a URL fragment like:
//   #access_token=...&refresh_token=...&type=recovery&expires_in=3600
//
// detectSessionInUrl is DISABLED on our supabase client (see
// supabaseClient.js), so we parse the fragment ourselves and call
// supabase.auth.setSession() to install the recovery token, then prompt the
// user for a new password and call supabase.auth.updateUser({ password }).
//
// On success the session is a regular authenticated session (no re-login
// needed); we sign the user out and route them back to LoginScreen so they
// explicitly sign in with the new password. This doubles as a sanity check
// that the new password works.
//
// This wizard ALSO handles the invited-user path: invite-member's
// inviteUserByEmail uses the same recovery flow under the hood, so
// newly-invited users land here first to set their password.
//
// Mounted from App.jsx when the URL hash matches /#/recovery (see
// recoveryRedirectUrl() in ForgotPasswordWizard.jsx).
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import AuthShell, { AUTH_TEXT_STYLE } from './AuthShell'
import { supabase } from './supabaseClient'

// Parse an access_token + refresh_token out of the URL fragment Supabase
// writes when it redirects back from the recovery email. Supabase's fragment
// layout is: "#/recovery#access_token=...&refresh_token=...&type=recovery"
// OR "#access_token=...&refresh_token=...&type=recovery" depending on
// whether the app uses a HashRouter. We cope with either shape.
function parseRecoveryFragment() {
  if (typeof window === 'undefined') return null
  const raw = window.location.hash || ''
  // Pull the querystring-like tail after the last '#'.
  const tail = raw.includes('#') ? raw.slice(raw.lastIndexOf('#') + 1) : raw
  if (!tail.includes('access_token=')) return null
  const params = new URLSearchParams(tail)
  if (params.get('type') !== 'recovery') return null
  return {
    access_token:  params.get('access_token')  ?? '',
    refresh_token: params.get('refresh_token') ?? '',
  }
}

export default function ResetPasswordWizard({ onDone }) {
  const [ready, setReady]         = useState(false)
  const [revealing, setRevealing] = useState(false)
  const [stage, setStage]         = useState('loading')  // loading | form | done | invalid
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState('')
  const pwRef                     = useRef(null)
  const installedRef              = useRef(false)

  // Install the recovery session once on mount. Empty cleanup — see
  // Session 2 handoff re: StrictMode cleanup deadlock.
  useEffect(() => {
    if (installedRef.current) return
    installedRef.current = true
    ;(async () => {
      const tokens = parseRecoveryFragment()
      if (!tokens || !tokens.access_token || !tokens.refresh_token) {
        setStage('invalid')
        return
      }
      const { error: setErr } = await supabase.auth.setSession({
        access_token:  tokens.access_token,
        refresh_token: tokens.refresh_token,
      })
      if (setErr) {
        setStage('invalid')
        return
      }
      // Clear the fragment so a refresh doesn't re-trigger the flow and so
      // the tokens stop appearing in any window title / referrer header.
      try {
        const clean = `${window.location.pathname}${window.location.search}#/recovery`
        window.history.replaceState(null, '', clean)
      } catch { /* non-critical */ }
      setStage('form')
    })()
    return () => {}
  }, [])

  useEffect(() => {
    if (ready && stage === 'form') pwRef.current?.focus()
  }, [ready, stage])

  const handleSubmit = useCallback(async (e) => {
    e?.preventDefault()
    if (busy) return
    if (password.length < 10 || password.length > 128) {
      setError('Password must be 10–128 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true); setError('')
    try {
      const { error: upErr } = await supabase.auth.updateUser({ password })
      if (upErr) {
        setError(upErr.message || 'Could not update password.')
        setBusy(false)
        return
      }
      // Sign out so the user has to re-auth with the new password — this is
      // both a sanity check and how we round-trip through NewUserWelcome
      // when the invite path lands here.
      await supabase.auth.signOut()
      setStage('done')
      setBusy(false)
    } catch (err) {
      setError(err?.message ?? 'Unknown error.')
      setBusy(false)
    }
  }, [busy, password, confirm])

  const handleDone = useCallback(() => {
    setRevealing(true)
  }, [])

  const inputStyle = {
    ...AUTH_TEXT_STYLE,
    fontSize: '17px', fontWeight: 400, textTransform: 'none',
    letterSpacing: '0.02em',
    background: 'transparent', border: 'none',
    borderBottom: '1px solid rgba(255,255,255,0.55)',
    outline: 'none', caretColor: '#fff', textAlign: 'center',
    width: '22ch', padding: '4px 0 6px',
  }
  const labelStyle = {
    ...AUTH_TEXT_STYLE, fontSize: '11px', fontWeight: 600,
    opacity: 0.8, letterSpacing: '0.22em',
  }

  return (
    <AuthShell
      isRevealing={revealing}
      onIntroComplete={() => setReady(true)}
      onAnimationComplete={() => onDone?.()}
      showLogoIntro={false}
      playStartupSound={false}
    >
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '16px', minWidth: '320px',
      }}>
        <div style={{ ...AUTH_TEXT_STYLE, fontSize: '24px', letterSpacing: '0.18em' }}>
          NEW PASSWORD
        </div>

        {stage === 'loading' && (
          <div style={{ ...AUTH_TEXT_STYLE, fontSize: '12px', opacity: 0.8 }}>
            VERIFYING LINK…
          </div>
        )}

        {stage === 'invalid' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', maxWidth: '38ch', textAlign: 'center' }}>
            <div style={{ ...AUTH_TEXT_STYLE, fontSize: '14px', fontWeight: 500, letterSpacing: '0.04em', textTransform: 'none' }}>
              This link has already been used, or it has expired.
              {' '}
              Invite and reset links work only once — and some email providers
              open links automatically to scan them, which uses the link up
              before you click it. Ask your workspace admin to send a new one,
              or to create your account with a password instead.
            </div>
            <button
              type="button"
              onClick={handleDone}
              style={{
                ...AUTH_TEXT_STYLE,
                fontSize: '12px', fontWeight: 600, letterSpacing: '0.18em',
                background: '#fff', border: 'none', color: '#ea580c',
                padding: '10px 34px', borderRadius: '2px', cursor: 'pointer',
              }}
            >
              Back to login
            </button>
          </div>
        )}

        {stage === 'form' && (
          <form onSubmit={handleSubmit}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
              <div style={labelStyle}>NEW PASSWORD</div>
              <input
                ref={pwRef}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                style={inputStyle}
                aria-label="New password"
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
              <div style={labelStyle}>CONFIRM</div>
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={busy}
                style={inputStyle}
                aria-label="Confirm new password"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              style={{
                ...AUTH_TEXT_STYLE,
                fontSize: '12px', fontWeight: 600, letterSpacing: '0.18em',
                marginTop: '6px',
                background: '#fff', border: 'none', color: '#ea580c',
                padding: '10px 34px', borderRadius: '2px',
                cursor: busy ? 'default' : 'pointer',
                opacity: busy ? 0.55 : 1,
              }}
            >
              {busy ? 'Updating…' : 'Set password'}
            </button>
          </form>
        )}

        {stage === 'done' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', maxWidth: '38ch', textAlign: 'center' }}>
            <div style={{ ...AUTH_TEXT_STYLE, fontSize: '14px', fontWeight: 500, letterSpacing: '0.04em', textTransform: 'none' }}>
              Password updated. Sign in with your new password.
            </div>
            <button
              type="button"
              onClick={handleDone}
              style={{
                ...AUTH_TEXT_STYLE,
                fontSize: '12px', fontWeight: 600, letterSpacing: '0.18em',
                background: '#fff', border: 'none', color: '#ea580c',
                padding: '10px 34px', borderRadius: '2px', cursor: 'pointer',
              }}
            >
              Continue
            </button>
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
