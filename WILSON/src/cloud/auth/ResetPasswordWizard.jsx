// =============================================================================
// ResetPasswordWizard — lands users arriving from an invite or reset email.
//
// Two link shapes reach this screen; `recoveryLink.js` explains both and owns
// the parsing. In short:
//
//   'verify'  — Session 18. The email carries GoTrue's `{{ .TokenHash }}` to
//               this page and NOTHING is spent until the user clicks. We call
//               verifyOtp({ token_hash, type }) on that click.
//   'session' — the older `{{ .ConfirmationURL }}` shape: GoTrue has already
//               verified and handed us access+refresh tokens in the fragment,
//               so we install them with setSession(). Still accepted, because
//               links minted before this change stay valid for up to 24 h.
//
// WHY THE CLICK MATTERS. Measured on wilson-staging 2026-07-31: two invites
// were confirmed 12.0 s and 16.7 s after being sent — one to a corporate
// domain, one to Gmail — before either recipient opened the mail. The old link
// was a bare GET that redeems on fetch, so anything following links to scan
// them spent it first. A GET must not mutate state; the button is the fix.
//
// detectSessionInUrl is DISABLED on our supabase client (see
// supabaseClient.js), so nothing here happens implicitly — we parse the URL
// ourselves and act only when we mean to.
//
// On success the session is a regular authenticated session (no re-login
// needed); we sign the user out and route them back to LoginScreen so they
// explicitly sign in with the new password. This doubles as a sanity check
// that the new password works, and it is how the invite path round-trips
// through NewUserWelcome.
//
// Mounted from App.jsx when looksLikeRecoveryLink() matches (see
// recoveryRedirectUrl() in ForgotPasswordWizard.jsx).
//
// Every auth await here is bounded — Session 17's rule (§6 #69): a pending
// promise strands the button forever, a rejected one is recoverable.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import AuthShell, { AUTH_TEXT_STYLE } from './AuthShell'
import { supabase } from './supabaseClient'
import { parseRecoveryLink } from './recoveryLink'
import { withTimeout, AUTH_TIMEOUT_MS, TimeoutError } from './withTimeout'

// Drop the credential-bearing part of the URL once it has been used, so a
// refresh cannot re-trigger the flow and the token stops riding along in
// window titles and referrer headers.
function scrubUrl() {
  try {
    const clean = `${window.location.pathname}#/recovery`
    window.history.replaceState(null, '', clean)
  } catch { /* non-critical */ }
}

export default function ResetPasswordWizard({ onDone }) {
  const [ready, setReady]         = useState(false)
  const [revealing, setRevealing] = useState(false)
  // loading | confirm | form | done | invalid
  const [stage, setStage]         = useState('loading')
  const [link, setLink]           = useState(null)   // parseRecoveryLink result
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState('')
  const pwRef                     = useRef(null)
  const installedRef              = useRef(false)

  // Read the link once on mount. Empty cleanup — see Session 2 handoff re:
  // StrictMode cleanup deadlock.
  useEffect(() => {
    if (installedRef.current) return
    installedRef.current = true
    ;(async () => {
      const parsed = parseRecoveryLink(
        typeof window === 'undefined' ? '' : window.location.hash,
        typeof window === 'undefined' ? '' : window.location.search,
      )
      if (!parsed) {
        setStage('invalid')
        return
      }

      // Session 18 shape: redeem NOTHING yet. Park on a button and let the
      // human spend the token. This branch must stay free of network calls —
      // that is the entire point of it.
      if (parsed.kind === 'verify') {
        setLink(parsed)
        setStage('confirm')
        return
      }

      // Older shape: GoTrue already verified, so the tokens in the fragment
      // are a live session. Install it.
      try {
        const { error: setErr } = await withTimeout(
          supabase.auth.setSession({
            access_token:  parsed.access_token,
            refresh_token: parsed.refresh_token,
          }),
          AUTH_TIMEOUT_MS,
          'setSession',
        )
        if (setErr) {
          setStage('invalid')
          return
        }
      } catch {
        // Includes TimeoutError. There is no useful retry from here — the
        // link is one-shot — so send them to the same explanation.
        setStage('invalid')
        return
      }
      setLink(parsed)
      scrubUrl()
      setStage('form')
    })()
    return () => {}
  }, [])

  // The click that spends the token. Only reachable from stage 'confirm'.
  const handleConfirm = useCallback(async () => {
    if (busy || !link) return
    setBusy(true); setError('')
    try {
      const { error: vErr } = await withTimeout(
        supabase.auth.verifyOtp({ token_hash: link.token_hash, type: link.type }),
        AUTH_TIMEOUT_MS,
        'verifyOtp',
      )
      if (vErr) {
        // Genuinely spent, expired, or already used. Same explanation as a
        // malformed link — from the user's side they are the same problem.
        setBusy(false)
        setStage('invalid')
        return
      }
      scrubUrl()
      setBusy(false)
      setStage('form')
    } catch (err) {
      // A stalled network must not be reported as a dead link — that sends
      // someone off to ask for a new invite when this one is still good.
      setBusy(false)
      setError(
        err instanceof TimeoutError
          ? 'The server did not respond. Check your connection and try again.'
          : (err?.message ?? 'Unknown error.'),
      )
    }
  }, [busy, link])

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

        {stage === 'confirm' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', maxWidth: '38ch', textAlign: 'center' }}>
            <div style={{ ...AUTH_TEXT_STYLE, fontSize: '14px', fontWeight: 500, letterSpacing: '0.04em', textTransform: 'none' }}>
              {link?.type === 'invite'
                ? 'Welcome to WILSON. Confirm below to activate your account and choose a password.'
                : 'Confirm below to continue resetting your password.'}
            </div>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={busy}
              style={{
                ...AUTH_TEXT_STYLE,
                fontSize: '12px', fontWeight: 600, letterSpacing: '0.18em',
                background: '#fff', border: 'none', color: '#ea580c',
                padding: '10px 34px', borderRadius: '2px',
                cursor: busy ? 'default' : 'pointer',
                opacity: busy ? 0.55 : 1,
              }}
            >
              {busy ? 'Confirming…' : 'Continue'}
            </button>
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
