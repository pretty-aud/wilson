// =============================================================================
// NewCompanyWizard — self-serve onboarding for a brand-new company.
//
// Three steps rendered inside AuthShell so the chrome matches LoginScreen
// and NewUserWelcome. Posts to /functions/v1/provision-workspace (service
// role) which creates the workspaces row, auth user, and admin membership.
//
//   step 'company'  — company name + slug (auto-derived from name)
//   step 'profile'  — username, email, display name, password
//   step 'submit'   — progress + server response; on success, hand off to
//                     the parent so the user can sign in with the creds
//                     they just picked.
//
// On success we DO NOT auto-sign-in. The handoff returns the admin's email
// + slug to the parent (App), which mounts LoginScreen pre-filled. This
// keeps the auth surface single: all sessions pass through signInWithPassword.
// =============================================================================

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AuthShell, { AUTH_TEXT_STYLE, AuthCursor } from '../auth/AuthShell'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

const SLUG_RE     = /^[a-z0-9][a-z0-9-]{1,62}$/
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function slugify(s) {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 62)
}

async function provisionWorkspace(payload) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/provision-workspace`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE_ANON,
    },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

export default function NewCompanyWizard({ onProvisioned, onCancel }) {
  const [ready, setReady]         = useState(false)
  const [revealing, setRevealing] = useState(false)
  const [step, setStep]           = useState('company') // 'company' | 'profile' | 'submit'
  const [stepFade, setStepFade]   = useState(1)

  // Form state
  const [companyName, setCompanyName] = useState('')
  const [slug, setSlug]               = useState('')
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false)
  const [username, setUsername]       = useState('')
  const [email, setEmail]             = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword]       = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')

  // Submission state
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState('')
  const firstInputRef       = useRef(null)
  const provisionedRef      = useRef(null)

  // Auto-derive slug from name unless the user has edited it manually.
  useEffect(() => {
    if (slugManuallyEdited) return
    setSlug(slugify(companyName))
  }, [companyName, slugManuallyEdited])

  // Focus the first input when a form step enters.
  useEffect(() => {
    if (!ready) return
    if (step === 'company' || step === 'profile') {
      firstInputRef.current?.focus()
    }
  }, [ready, step])

  // Stage fade on step transitions.
  useEffect(() => {
    setStepFade(0)
    const t = setTimeout(() => setStepFade(1), 150)
    return () => clearTimeout(t)
  }, [step])

  // ── Validators ────────────────────────────────────────────────────────
  const companyValid = useMemo(() => {
    return companyName.trim().length >= 1
        && companyName.trim().length <= 80
        && SLUG_RE.test(slug)
  }, [companyName, slug])

  const profileValid = useMemo(() => {
    return USERNAME_RE.test(username.trim().toLowerCase())
        && EMAIL_RE.test(email.trim().toLowerCase())
        && password.length >= 10
        && password.length <= 128
        && password === passwordConfirm
        && (displayName.trim().length === 0 || displayName.trim().length <= 80)
  }, [username, email, password, passwordConfirm, displayName])

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleCompanySubmit = useCallback((e) => {
    e?.preventDefault()
    if (!companyValid) { setError('CHECK COMPANY NAME + SLUG.'); return }
    setError('')
    setStep('profile')
  }, [companyValid])

  const handleProfileSubmit = useCallback(async (e) => {
    e?.preventDefault()
    if (!profileValid) {
      const reason =
        password.length < 10 ? 'PASSWORD MUST BE AT LEAST 10 CHARACTERS.' :
        password !== passwordConfirm ? 'PASSWORDS DO NOT MATCH.' :
        !EMAIL_RE.test(email.trim().toLowerCase()) ? 'INVALID EMAIL.' :
        'CHECK PROFILE FIELDS.'
      setError(reason)
      return
    }
    setError('')
    setBusy(true)
    setStep('submit')
    try {
      const { ok, status, data } = await provisionWorkspace({
        company_name: companyName.trim(),
        slug:         slug.trim().toLowerCase(),
        username:     username.trim().toLowerCase(),
        email:        email.trim().toLowerCase(),
        password,
        display_name: displayName.trim() || username.trim(),
      })
      if (!ok) {
        const msg =
          data.error === 'slug_taken'     ? 'WORKSPACE SLUG ALREADY IN USE.' :
          data.error === 'email_taken'    ? 'EMAIL ALREADY HAS AN ACCOUNT.' :
          data.error === 'username_taken' ? 'USERNAME ALREADY TAKEN.' :
          data.error === 'rate_limited'   ? 'TOO MANY REQUESTS. TRY AGAIN LATER.' :
          data.error === 'validation_failed' ? 'VALIDATION FAILED. CHECK YOUR INPUTS.' :
          `PROVISIONING FAILED (${status}).`
        setError(msg)
        setBusy(false)
        setStep('profile')
        return
      }
      provisionedRef.current = {
        email: email.trim().toLowerCase(),
        username: username.trim().toLowerCase(),
        workspace_slug: data.workspace_slug,
      }
      setRevealing(true)
    } catch (err) {
      setError(`NETWORK ERROR: ${err.message || 'unknown'}`)
      setBusy(false)
      setStep('profile')
    }
  }, [profileValid, companyName, slug, username, email, password, passwordConfirm, displayName])

  // ── Render helpers ────────────────────────────────────────────────────
  const inputStyle = {
    ...AUTH_TEXT_STYLE,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    caretColor: 'transparent',
    textAlign: 'center',
    width: '22ch',
    fontSize: '16px',
  }

  return (
    <AuthShell
      isRevealing={revealing}
      onIntroComplete={() => setReady(true)}
      onAnimationComplete={() => onProvisioned?.(provisionedRef.current)}
      showLogoIntro
      playStartupSound={false}
    >
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '18px', minWidth: '360px',
        opacity: stepFade, transition: 'opacity 150ms ease-out',
      }}>
        <div style={AUTH_TEXT_STYLE}>NEW COMPANY</div>

        {step === 'company' && (
          <form onSubmit={handleCompanySubmit}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <FieldLabel>COMPANY NAME</FieldLabel>
            <TerminalInput
              ref={firstInputRef}
              value={companyName}
              onChange={(v) => setCompanyName(v.slice(0, 80))}
              style={inputStyle}
              aria-label="Company name"
              autoComplete="organization"
            />

            <FieldLabel>SLUG</FieldLabel>
            <TerminalInput
              value={slug}
              onChange={(v) => { setSlug(slugify(v)); setSlugManuallyEdited(true) }}
              style={inputStyle}
              aria-label="Workspace slug"
            />
            <SmallHint>URL-SAFE · A-Z 0-9 DASH · 2–63 CHARS</SmallHint>

            <WizardButton disabled={!companyValid}>CONTINUE</WizardButton>
            <WizardLink onClick={onCancel}>back to sign in</WizardLink>
          </form>
        )}

        {step === 'profile' && (
          <form onSubmit={handleProfileSubmit}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <SmallHint>COMPANY: {companyName} · {slug}</SmallHint>

            <FieldLabel>USERNAME</FieldLabel>
            <TerminalInput
              ref={firstInputRef}
              value={username}
              onChange={(v) => setUsername(v.slice(0, 32))}
              style={inputStyle}
              aria-label="Username"
              autoComplete="username"
            />

            <FieldLabel>EMAIL</FieldLabel>
            <TerminalInput
              value={email}
              onChange={(v) => setEmail(v.slice(0, 120))}
              style={{ ...inputStyle, width: '28ch' }}
              type="email"
              aria-label="Email"
              autoComplete="email"
            />

            <FieldLabel>DISPLAY NAME</FieldLabel>
            <TerminalInput
              value={displayName}
              onChange={(v) => setDisplayName(v.slice(0, 80))}
              style={inputStyle}
              aria-label="Display name"
              placeholder={username}
            />

            <FieldLabel>PASSWORD · MIN 10</FieldLabel>
            <TerminalInput
              value={password}
              onChange={setPassword}
              style={inputStyle}
              type="password"
              aria-label="Password"
              autoComplete="new-password"
            />

            <FieldLabel>CONFIRM PASSWORD</FieldLabel>
            <TerminalInput
              value={passwordConfirm}
              onChange={setPasswordConfirm}
              style={inputStyle}
              type="password"
              aria-label="Confirm password"
              autoComplete="new-password"
            />

            <WizardButton disabled={!profileValid || busy}>
              {busy ? 'CREATING…' : 'CREATE COMPANY'}
            </WizardButton>
            <WizardLink onClick={() => setStep('company')}>back</WizardLink>
          </form>
        )}

        {step === 'submit' && (
          <div style={{ ...AUTH_TEXT_STYLE, fontSize: '14px' }}>
            PROVISIONING WORKSPACE<AuthCursor />
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

// ── Tiny building blocks to keep the wizard body readable ──────────────────
function FieldLabel({ children }) {
  return (
    <div style={{ ...AUTH_TEXT_STYLE, fontSize: '11px', opacity: 0.8 }}>
      {children}
    </div>
  )
}

function SmallHint({ children }) {
  return (
    <div style={{ ...AUTH_TEXT_STYLE, fontSize: '10px', opacity: 0.55 }}>
      {children}
    </div>
  )
}

function WizardButton({ children, disabled }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      style={{
        ...AUTH_TEXT_STYLE,
        marginTop: '4px',
        fontSize: '13px',
        background: 'transparent',
        border: '2px solid #fff',
        padding: '6px 18px',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  )
}

function WizardLink({ children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'transparent',
        border: 'none',
        color: '#fff',
        fontFamily: 'monospace',
        fontSize: '11px',
        textDecoration: 'underline',
        cursor: 'pointer',
        padding: 0,
        opacity: 0.75,
      }}
    >
      {children}
    </button>
  )
}

// Real <input> styled terminal — captures IME/autofill while our AuthCursor
// sits to the right of it to visually mimic a command prompt.
const TerminalInput = forwardRef(function TerminalInput(
  { value, onChange, style, type = 'text', ...rest },
  ref,
) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <input
        ref={ref}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={style}
        {...rest}
      />
      <AuthCursor />
    </div>
  )
})
