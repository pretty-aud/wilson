// =============================================================================
// ForgotPasswordWizard — user-initiated password reset.
//
// Triggered from LoginScreen via the "forgot password?" link. Collects the
// username (workspace-scoped, same rules as LoginScreen), resolves it to an
// email via resolve-login, then calls supabase.auth.resetPasswordForEmail.
// Supabase delivers our recovery.html template via Resend; the user clicks
// through to ResetPasswordWizard.
//
// Security:
//   - Success message is identical whether the username existed or not, so
//     timing + response shape don't leak membership. Resolve-login's own
//     constant-time floor already guards the sub-request.
//   - Per security rules we never surface "user not found" text.
//
// Session 2 handoff called out a StrictMode deadlock pattern around timer-
// based effects with a ref guard + clearTimeout cleanup. We follow the
// AuthShell pattern: phase/ref checks inside the timer callback, EMPTY
// cleanup, no clearTimeout in the cleanup path.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import AuthShell, { AUTH_TEXT_STYLE } from './AuthShell'
import { supabase } from './supabaseClient'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/

// Recovery landing URL — must be listed in auth.additional_redirect_urls in
// supabase/config.toml (the wizard mounts at /#/recovery in App.jsx).
function recoveryRedirectUrl() {
  if (typeof window === 'undefined') return ''
  const origin = window.location.origin
  return `${origin}/#/recovery`
}

async function resolveLogin(username) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/resolve-login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: SUPABASE_ANON,
      },
      body: JSON.stringify({ username }),
    })
    if (!res.ok) return { exists: false, email: null }
    return res.json()
  } catch {
    return { exists: false, email: null }
  }
}

export default function ForgotPasswordWizard({ onBackToLogin }) {
  const [ready, setReady]     = useState(false)
  const [revealing, setRevealing] = useState(false)
  const [username, setUsername]   = useState('')
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState('')
  // 'form' -> 'sent' once we've dispatched (or pretended to dispatch) the email.
  const [stage, setStage]         = useState('form')
  const inputRef                  = useRef(null)

  useEffect(() => {
    if (ready && stage === 'form') inputRef.current?.focus()
  }, [ready, stage])

  const handleSubmit = useCallback(async (e) => {
    e?.preventDefault()
    if (busy) return
    const u = username.trim().toLowerCase()
    if (!USERNAME_RE.test(u)) {
      setError('Enter a valid username.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { exists, email } = await resolveLogin(u)
      // Whether or not the user exists, we pretend to send. On 'exists' we
      // actually dispatch resetPasswordForEmail; otherwise we sleep a bit to
      // match timing.
      if (exists && email) {
        await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: recoveryRedirectUrl(),
        })
      } else {
        await new Promise((r) => setTimeout(r, 220))
      }
      setStage('sent')
      setBusy(false)
    } catch {
      // Even on a real failure we surface the generic "sent" message; the
      // security trade-off is that a real SMTP outage is invisible to users.
      // Resend's uptime makes this an acceptable default.
      setStage('sent')
      setBusy(false)
    }
  }, [busy, username])

  const handleBack = useCallback(() => {
    // Fade the shell out the same way LoginScreen does so the parent's
    // route swap feels continuous with the existing chrome.
    setRevealing(true)
  }, [])

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
      onAnimationComplete={() => onBackToLogin?.()}
      showLogoIntro={false}
      playStartupSound={false}
    >
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '16px', minWidth: '320px',
      }}>
        <div style={{ ...AUTH_TEXT_STYLE, fontSize: '24px', letterSpacing: '0.18em' }}>
          RESET PASSWORD
        </div>

        {stage === 'form' && (
          <form onSubmit={handleSubmit}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
            <div style={{ ...AUTH_TEXT_STYLE, fontSize: '11px', opacity: 0.75, maxWidth: '32ch', textAlign: 'center' }}>
              ENTER YOUR USERNAME. WE'LL EMAIL A RESET LINK.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
              <div style={labelStyle}>USERNAME</div>
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
                cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.55 : 1,
              }}
            >
              {busy ? 'Sending…' : 'Send reset link'}
            </button>

            <button
              type="button"
              onClick={handleBack}
              style={{
                background: 'transparent', border: 'none',
                color: '#fff',
                fontFamily: AUTH_TEXT_STYLE.fontFamily,
                fontSize: '12px', fontWeight: 500, letterSpacing: '0.04em',
                textDecoration: 'underline',
                cursor: 'pointer', padding: 0, opacity: 0.75,
                marginTop: '4px',
              }}
            >
              Back to login
            </button>
          </form>
        )}

        {stage === 'sent' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', maxWidth: '38ch', textAlign: 'center' }}>
            <div style={{ ...AUTH_TEXT_STYLE, fontSize: '14px', fontWeight: 500, letterSpacing: '0.04em', textTransform: 'none' }}>
              If an account matches that username, a reset link is on its way. Check your inbox — it expires in 1 hour.
            </div>
            <button
              type="button"
              onClick={handleBack}
              style={{
                ...AUTH_TEXT_STYLE,
                fontSize: '12px', fontWeight: 600, letterSpacing: '0.18em',
                marginTop: '6px',
                background: '#fff', border: 'none', color: '#ea580c',
                padding: '10px 34px', borderRadius: '2px', cursor: 'pointer',
              }}
            >
              Back to login
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
