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
import AuthShell, {
  AUTH_TITLE_STYLE,
  AUTH_BUTTON_STYLE,
  AUTH_BUTTON_BUSY_STYLE,
  AUTH_PROSE_STYLE,
  AUTH_ERROR_STYLE,
  AUTH_GAP_BETWEEN_FIELDS,
  AUTH_GAP_BETWEEN_BLOCKS,
  AuthField,
  AuthPasswordInput,
} from './AuthShell'
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

  // Session 43 §A7: field + button styling comes from AuthShell.
  const primaryButton = (isBusy) => ({
    ...AUTH_BUTTON_STYLE,
    ...(isBusy ? AUTH_BUTTON_BUSY_STYLE : null),
  })

  // AUTH-21. The press is the auth family's affordance and this surface had
  // none of it — the same control that presses on the sign-in screen sat dead
  // under the finger here, which is worse than nobody having it. A two percent
  // :active scale in CSS: no handler, nothing written to the DOM node, nothing
  // to leave stuck at 0.98 when a mouse-up lands somewhere else.
  //
  // One literal per file rather than one per button, because its permanent
  // home is `.ui-btn:active` in the kit (hand-off kit request K1) and the day
  // that lands these are grepped and deleted. LoginScreen and MfaSection carry
  // the same line; the single exported token they should all share belongs in
  // AuthShell and is not this file's to add.
  const PRESS_CLASS = 'active:scale-[0.98]'

  return (
    <AuthShell
      isRevealing={revealing}
      onIntroComplete={() => setReady(true)}
      onAnimationComplete={() => onDone?.()}
      showLogoIntro={false}
      playStartupSound={false}
    >
      {/* AUTH-09: the outer stack separates BLOCKS — the title from whichever
          stage is mounted — so it takes the block gap. 18px was hand-typed here
          and in three sibling files, and 14px below was off the scale entirely. */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: AUTH_GAP_BETWEEN_BLOCKS, minWidth: '320px',
      }}>
        {/* Q2 / AUTH-11: sentence case. The visible AuthField labels below stay
            UPPERCASE — Label is the one role that keeps its case. */}
        <div style={AUTH_TITLE_STYLE}>New password</div>

        {stage === 'loading' && (
          // AUTH-05 / AUTH-11: a status sentence, not a label. It was
          // `VERIFYING LINK…` in the hint role, typographically identical to
          // the field labels beside it.
          <div style={AUTH_PROSE_STYLE}>Verifying link…</div>
        )}

        {stage === 'confirm' && (
          // AUTH-10: centred column, left-aligned sentence. The wrapper's
          // `maxWidth: 38ch` and `textAlign: center` belong to the prose role.
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: AUTH_GAP_BETWEEN_BLOCKS }}>
            {/* AUTH-12: was 14 / 500 / +0.04em / textTransform none, inline. */}
            <div style={AUTH_PROSE_STYLE}>
              {link?.type === 'invite'
                ? 'Welcome to WILSON. Confirm below to activate your account and choose a password.'
                : 'Confirm below to continue resetting your password.'}
            </div>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={busy}
              className={PRESS_CLASS}
              style={primaryButton(busy)}
            >
              {busy ? 'Confirming…' : 'Continue'}
            </button>
          </div>
        )}

        {stage === 'invalid' && (
          // The longest paragraph on the surface, and the one the 60ch measure
          // in AUTH_PROSE_STYLE exists for (AUTH-10, AUTH-12).
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: AUTH_GAP_BETWEEN_BLOCKS }}>
            <div style={AUTH_PROSE_STYLE}>
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
              className={PRESS_CLASS}
              style={AUTH_BUTTON_STYLE}
            >
              Back to login
            </button>
          </div>
        )}

        {stage === 'form' && (
          <form onSubmit={handleSubmit}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  gap: AUTH_GAP_BETWEEN_FIELDS,
                }}>
            <AuthField label="NEW PASSWORD">
              <AuthPasswordInput
                ref={pwRef}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                aria-label="New password"
              />
            </AuthField>
            <AuthField label="CONFIRM">
              <AuthPasswordInput
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={busy}
                aria-label="Confirm new password"
              />
            </AuthField>

            <button type="submit" disabled={busy} className={PRESS_CLASS} style={primaryButton(busy)}>
              {busy ? 'Updating…' : 'Set password'}
            </button>
          </form>
        )}

        {stage === 'done' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: AUTH_GAP_BETWEEN_BLOCKS }}>
            {/* ⚠️ Playwright matches this sentence on /password updated/i.
                Only its typographic role changed (AUTH-12); the wording is
                load-bearing. */}
            <div style={AUTH_PROSE_STYLE}>
              Password updated. Sign in with your new password.
            </div>
            <button
              type="button"
              onClick={handleDone}
              className={PRESS_CLASS}
              style={AUTH_BUTTON_STYLE}
            >
              Continue
            </button>
          </div>
        )}

        {error && <div style={AUTH_ERROR_STYLE}>{error}</div>}
      </div>
    </AuthShell>
  )
}
