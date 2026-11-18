// =============================================================================
// ForgotPasswordWizard — user-initiated password reset.
//
// Triggered from LoginScreen via the "forgot password?" link. Collects the
// username (workspace-scoped, same rules as LoginScreen), resolves it to an
// email via resolve-login, then calls supabase.auth.resetPasswordForEmail.
// Supabase delivers our recovery.html template via Resend; the user clicks
// through to ResetPasswordWizard.
//
// F11 (REV-05; Audrey's answer in F11's chat, 2026-11-18: "Show it, with
// 'Change company'"): the reset asks for the COMPANY the way the login does.
// It used to send the username alone, and resolve-login answers a miss when a
// bare username exists in two companies, so that person got no email while
// this screen said one was on its way. Now the company this device last signed
// in to (or, with none, a `?company=` link) is shown above the username, as the
// login's step 2 shows it, with "Change company" back to a company field; with
// no company known the wizard opens on that field. On sending, the company is
// verified (its canonical slug) and the username resolved within it, so the
// reset goes to that company's address; a company step that cannot be answered
// is the timeout sentence, never a guessed slug. The steps are signIn.js's.
//
// Security:
//   - The "sent" screen is identical whether the username existed or not, and
//     reached the same way: a hit waits for the reset request (bounded, every
//     error swallowed), a miss for 220 ms, as before. Resolve-login's own
//     constant-time floor guards the sub-request.
//   - What may now read differently is decided by nothing about a PERSON: the
//     company step (the login answers the same, bounded by its limiter), the
//     per-address 429 (a count of this address's own requests), and a server
//     that did not answer at all (the network). Per security rules we never
//     surface "user not found" text.
//
// Session 2 handoff called out a StrictMode deadlock pattern around timer-
// based effects with a ref guard + clearTimeout cleanup. We follow the
// AuthShell pattern: phase/ref checks inside the timer callback, EMPTY
// cleanup, no clearTimeout in the cleanup path.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import AuthShell, {
  AUTH_TITLE_STYLE,
  AUTH_INPUT_STYLE,
  AUTH_BUTTON_STYLE,
  AUTH_BUTTON_BUSY_STYLE,
  AUTH_LINK_STYLE,
  AUTH_LINK_BUSY_STYLE,
  AUTH_HINT_STYLE,
  AUTH_PROSE_STYLE,
  AUTH_ERROR_STYLE,
  AUTH_GAP_WITHIN_FIELD,
  AUTH_GAP_BETWEEN_FIELDS,
  AUTH_GAP_BETWEEN_BLOCKS,
  AuthField,
} from './AuthShell'
import { supabase } from './supabaseClient'
import { SLUG_RE } from './workspaceSlug'
import { withTimeout, AUTH_TIMEOUT_MS } from './withTimeout'
import { verifyCompany, resolveLogin, readLastCompany, saveLastCompany, companyFromDeepLink } from './signIn'

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/

// The login's own sentences for the same three events (LoginScreen.jsx's
// COMPANY_NOT_FOUND, RATE_LIMITED_ERROR and TIMEOUT_ERROR; the test pins them
// equal), so the reset and the sign-in speak with one voice.
export const COMPANY_NOT_FOUND = 'Company not found.'
export const RATE_LIMITED_ERROR = 'Too many attempts. Wait a minute and try again.'
export const TIMEOUT_ERROR = 'The server did not respond. Check your connection and try again.'

// Recovery landing URL — must be listed in auth.additional_redirect_urls in
// supabase/config.toml (the wizard mounts at /#/recovery in App.jsx).
function recoveryRedirectUrl() {
  if (typeof window === 'undefined') return ''
  const origin = window.location.origin
  return `${origin}/#/recovery`
}

export default function ForgotPasswordWizard({ onBackToLogin }) {
  const [ready, setReady]     = useState(false)
  const [revealing, setRevealing] = useState(false)
  // The company: this device's last (B1), else a `?company=` link's. Shown,
  // not asked again, when there is one; asked when there is none. The
  // remembered one comes first (review round 1, 1E): the login's company step
  // saves the company it just verified, so it is newer than a link the app was
  // opened with, which the person may have corrected there.
  const [company, setCompany]     = useState(() => (
    readLastCompany()
    || companyFromDeepLink(typeof window === 'undefined' ? '' : window.location.search)
  ))
  // The canonical slug once THIS wizard has verified the company (the company
  // field's Continue); otherwise it is verified when the link is sent.
  const [companySlug, setCompanySlug] = useState('')
  const [username, setUsername]   = useState('')
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState('')
  // 'company' -> 'form' -> 'sent' once we've dispatched (or pretended to dispatch) the email.
  const [stage, setStage]         = useState(() => (company.trim() ? 'form' : 'company'))
  const inputRef                  = useRef(null)
  const companyRef                = useRef(null)

  useEffect(() => {
    if (!ready) return
    if (stage === 'form') inputRef.current?.focus()
    if (stage === 'company') companyRef.current?.focus()
  }, [ready, stage])

  // The company step, as the login's: verify it, keep its canonical slug.
  // Answers { slug }, or { refused: 'limited' | 'unavailable' | 'not_found' } after saying why.
  const checkCompany = useCallback(async (typed) => {
    const v = await verifyCompany(typed)
    if (v.limited) { setError(RATE_LIMITED_ERROR); return { refused: 'limited' } }
    // Unlike the login, no derived slug (review round 1, 1E): a company step
    // that could not be answered (no answer, a 5xx, an unreadable reply) is
    // the timeout sentence and nothing is sent. A guessed slug is nearly never
    // a company's real one, so the lookup would miss and "sent" would be said
    // with nothing sent: REV-05's own symptom.
    if (v.unavailable) { setError(TIMEOUT_ERROR); return { refused: 'unavailable' } }
    // ONE wording for "no such company" and "suspended", as the login's.
    if (!v.exists || !SLUG_RE.test(v.slug ?? '')) { setError(COMPANY_NOT_FOUND); return { refused: 'not_found' } }
    saveLastCompany(typed)
    return { slug: v.slug }
  }, [])

  const handleCompanySubmit = useCallback(async (e) => {
    e?.preventDefault()
    if (busy) return
    const typed = company.trim()
    if (typed.length < 2 || typed.length > 80) {
      setError('Enter your company.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const checked = await checkCompany(typed)
      if (!checked.slug) return
      setCompanySlug(checked.slug)
      setStage('form')
    } finally {
      setBusy(false)
    }
  }, [busy, company, checkCompany])

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
      const typed = company.trim()
      const checked = companySlug ? { slug: companySlug } : await checkCompany(typed)
      const slug = checked.slug
      if (!slug) {
        // The remembered company is not (or no longer) a company: ask for it. A throttle keeps the form.
        if (checked.refused === 'not_found') setStage('company')
        setBusy(false)
        return
      }
      let found
      try {
        found = await resolveLogin(u, slug)
      } catch {
        // No answer at all, or one that could not be read: nothing about the username is known.
        setError(TIMEOUT_ERROR)
        setBusy(false)
        return
      }
      if (found.limited) {
        setError(RATE_LIMITED_ERROR)
        setBusy(false)
        return
      }
      // Whether or not the user exists, we pretend to send. On 'exists' we
      // actually dispatch resetPasswordForEmail; otherwise we sleep a bit to
      // match timing.
      if (found.exists && found.email) {
        try {
          await withTimeout(supabase.auth.resetPasswordForEmail(found.email, {
            redirectTo: recoveryRedirectUrl(),
          }), AUTH_TIMEOUT_MS, 'reset email')
        } catch {
          // Even on a real failure we surface the generic "sent" message; the
          // security trade-off is that a real SMTP outage is invisible to users.
          // Resend's uptime makes this an acceptable default.
        }
      } else {
        await new Promise((r) => setTimeout(r, 220))
      }
      setStage('sent')
      setBusy(false)
    } catch {
      // The company step never throws; anything else ends as before: "sent".
      setStage('sent')
      setBusy(false)
    }
  }, [busy, username, company, companySlug, checkCompany])

  const handleChangeCompany = useCallback(() => {
    setError('')
    setCompanySlug('')
    setStage('company')
  }, [])

  const handleBack = useCallback(() => {
    // Fade the shell out the same way LoginScreen does so the parent's
    // route swap feels continuous with the existing chrome.
    setRevealing(true)
  }, [])

  // AUTH-21, one copy per file until kit request K1 lands `.ui-btn:active`.
  // 🚨 R2: round 1 gave the press to all four of ResetPasswordWizard's buttons
  // on the grounds that "the same control that presses on the sign-in screen
  // sat dead under the finger here", and then left THIS file's second filled
  // primary — the 'sent' stage's "Back to login", the same label, the same
  // AUTH_BUTTON_STYLE, in the same wrapper as the one it fixed — without it.
  // The two wizards are reached from the same email, so one button pressed and
  // its twin did not. The literal was also written out at the submit rather
  // than named, which is how the second site was missed; it is a const now, so
  // the file has one copy and the eventual deletion is one line.
  const PRESS_CLASS = 'active:scale-[0.98]'
  const submitStyle = { ...AUTH_BUTTON_STYLE, ...(busy ? AUTH_BUTTON_BUSY_STYLE : null) }
  const linkStyle = { ...AUTH_LINK_STYLE, ...(busy ? AUTH_LINK_BUSY_STYLE : null) }
  const formStyle = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: AUTH_GAP_BETWEEN_FIELDS }

  // Session 43 §A7: field styling comes from AuthShell so this wizard and the
  // login screen cannot drift apart again.
  return (
    <AuthShell
      isRevealing={revealing}
      onIntroComplete={() => setReady(true)}
      onAnimationComplete={() => onBackToLogin?.()}
      showLogoIntro={false}
      playStartupSound={false}
    >
      {/* AUTH-09: the outer stack separates BLOCKS — the title from the form,
          the form from a whole-screen message — so it takes the block gap. The
          field-to-field gap lives inside the form. It was 18px in both places,
          hand-typed, so spacing carried no grouping information. */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: AUTH_GAP_BETWEEN_BLOCKS, minWidth: '320px',
      }}>
        {/* Q2 / AUTH-11: sentence case. This was `RESET PASSWORD` at the H1
            step — the page transition's voice borrowed for a page heading. */}
        <div style={AUTH_TITLE_STYLE}>Reset password</div>

        {stage === 'company' && (
          <form onSubmit={handleCompanySubmit} style={formStyle}>
            <div style={AUTH_PROSE_STYLE}>
              Enter your company, then your username. We'll email a reset link.
            </div>

            <AuthField label="COMPANY">
              <input
                ref={companyRef}
                type="text"
                autoComplete="organization"
                value={company}
                onChange={(e) => setCompany(e.target.value.slice(0, 80))}
                disabled={busy}
                style={AUTH_INPUT_STYLE}
                aria-label="Company"
              />
            </AuthField>

            <button type="submit" disabled={busy} className={PRESS_CLASS} style={submitStyle}>
              {busy ? 'Checking…' : 'Continue'}
            </button>

            <button type="button" onClick={handleBack} disabled={busy} style={linkStyle}>
              Back to login
            </button>
          </form>
        )}

        {stage === 'form' && (
          <form onSubmit={handleSubmit} style={formStyle}>
            {/* AUTH-05 / AUTH-12: a sentence, so it is the prose role, not the
                hint role — the Body step, sentence case, left aligned inside
                the centred column, measure capped by AUTH_PROSE_STYLE rather
                than by a hand-typed 32ch. */}
            <div style={AUTH_PROSE_STYLE}>
              Enter your username. We'll email a reset link.
            </div>

            {/* The company, shown as the login's step 2 shows it: what was
                typed, not the slug. */}
            <div style={AUTH_HINT_STYLE} data-reset-company>{company.trim()}</div>

            <AuthField label="USERNAME">
              <input
                ref={inputRef}
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value.slice(0, 32))}
                disabled={busy}
                style={AUTH_INPUT_STYLE}
                aria-label="Username"
              />
            </AuthField>

            <button type="submit" disabled={busy} className={PRESS_CLASS} style={submitStyle}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>

            {/* The login's row: two quiet links, one divider. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: AUTH_GAP_WITHIN_FIELD }}>
              <button type="button" onClick={handleChangeCompany} disabled={busy} style={linkStyle}>
                Change company
              </button>
              <span aria-hidden="true" style={AUTH_HINT_STYLE}>·</span>
              <button type="button" onClick={handleBack} disabled={busy} style={linkStyle}>
                Back to login
              </button>
            </div>
          </form>
        )}

        {stage === 'sent' && (
          // AUTH-10: the column stays centred, the sentence inside it does not.
          // The wrapper's own `maxWidth: 38ch` and `textAlign: center` are gone
          // — the measure belongs to the prose role, and centred prose gives
          // every line a different left edge.
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: AUTH_GAP_BETWEEN_BLOCKS }}>
            {/* AUTH-12: one of the four inline copies of an unnamed prose role
                (14 / 500 / +0.04em). Weight 500 existed nowhere else in the app. */}
            <div style={AUTH_PROSE_STYLE}>
              If an account matches that username, a reset link is on its way. Check your inbox — it expires in 1 hour.
            </div>
            <button type="button" onClick={handleBack} className={PRESS_CLASS} style={AUTH_BUTTON_STYLE}>
              Back to login
            </button>
          </div>
        )}

        {error && <div style={AUTH_ERROR_STYLE}>{error}</div>}
      </div>
    </AuthShell>
  )
}
