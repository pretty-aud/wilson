// =============================================================================
// InviteMemberDialog — admin-only modal for inviting a new workspace member.
//
// Calls the invite-member Edge Function, which creates the auth user (sending
// our invite.html template via Resend) and the workspace_members row with
// onboarded_at=null. The invitee receives an email, follows the recovery
// link into ResetPasswordWizard, sets their password, and lands on
// NewUserWelcome on first sign-in.
//
// Rendered from TeamMembersPage behind a <PermissionGate requires="member.invite">.
// The dialog itself ALSO checks the role — defense in depth against a
// future refactor accidentally dropping the gate.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { usePermissions } from '../../permissions/usePermissions'
import { LIGHT_INK, LIGHT_RULE } from '../../components/lightSurface'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export default function InviteMemberDialog({ open, onClose, onInvited }) {
  const perms = usePermissions()
  const [email, setEmail]         = useState('')
  const [username, setUsername]   = useState('')
  const [displayName, setDisplayName] = useState('')
  const [appRole, setAppRole]     = useState('user')
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState('')
  const [success, setSuccess]     = useState(null)
  const emailRef                  = useRef(null)

  // Reset form whenever we open.
  useEffect(() => {
    if (!open) return
    setEmail(''); setUsername(''); setDisplayName(''); setAppRole('user')
    setError(''); setSuccess(null); setBusy(false)
    // Focus after the overlay's transition settles.
    const t = setTimeout(() => emailRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [open])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  const handleSubmit = useCallback(async (e) => {
    e?.preventDefault()
    if (busy) return
    const emailV    = email.trim().toLowerCase()
    const usernameV = username.trim().toLowerCase()
    const displayV  = displayName.trim()
    if (!EMAIL_RE.test(emailV))        return setError('Enter a valid email.')
    if (!USERNAME_RE.test(usernameV))  return setError('Username: lowercase letters/digits/._- , 2–32 chars.')
    if (displayV.length > 80)          return setError('Display name max 80 chars.')

    setBusy(true); setError('')
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess?.session?.access_token
      if (!token) {
        setError('Session expired — sign in again.')
        setBusy(false)
        return
      }

      const res = await fetch(`${SUPABASE_URL}/functions/v1/invite-member`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: SUPABASE_ANON,
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email:        emailV,
          username:     usernameV,
          display_name: displayV || null,
          app_role:     appRole,
        }),
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        const map = {
          forbidden:         'You must be a workspace admin to invite members.',
          unauthorized:      'Session expired — sign in again.',
          username_taken:    'That username is already in use in this workspace.',
          email_taken:       'That email is already associated with a WILSON account.',
          validation_failed: 'Please check the form for errors.',
          invite_failed:     'Email delivery failed. Try again in a minute.',
          // Session 17: invite-member enforces the MFA step-up (§6 #46).
          // Same vocabulary as adminApi.js / operatorApi.js.
          mfa_required:      'This action needs a fresh MFA sign-in. Sign out and back in with your authenticator code.',
          mfa_check_failed:  'Could not verify your MFA status. Try again in a moment.',
        }
        setError(map[json.error] ?? `Invite failed (${res.status}).`)
        setBusy(false)
        return
      }

      setSuccess({ email: emailV, username: usernameV })
      // The 201 body has no display_name (the Edge Function defaults it to
      // the username server-side) — pass along what the admin typed so the
      // Team Members list can show the real name without a refetch.
      onInvited?.({ ...json, display_name: displayV || null })
      setBusy(false)
    } catch (err) {
      setError(err?.message ?? 'Unknown error.')
      setBusy(false)
    }
  }, [busy, email, username, displayName, appRole, onInvited])

  if (!open) return null

  // Defensive: never render the form to a non-admin, even if the parent
  // forgot to gate.
  if (perms.ready && perms.role !== 'admin') {
    return (
      <Overlay onClose={onClose}>
        <p style={{ margin: 0, fontSize: '13px' }}>
          Only workspace admins can invite members.
        </p>
        <FooterClose onClose={onClose} />
      </Overlay>
    )
  }

  return (
    <Overlay onClose={busy ? undefined : onClose}>
      {success ? (
        <>
          <h2 style={titleStyle}>Invite sent</h2>
          <p style={{ margin: '0 0 16px 0', fontSize: '13px', lineHeight: 1.55 }}>
            We emailed <strong>{success.email}</strong> with a link to set their
            password. Their username on this workspace is{' '}
            <code style={codeStyle}>{success.username}</code>.
          </p>
          <FooterClose onClose={onClose} label="Done" />
        </>
      ) : (
        <form onSubmit={handleSubmit}>
          <h2 style={titleStyle}>Invite a workspace member</h2>
          <Field label="Email">
            <input
              ref={emailRef}
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              style={inputStyle}
              aria-label="Email"
            />
          </Field>
          <Field label="Username" hint="Lowercase. Scoped to this workspace.">
            <input
              type="text"
              autoComplete="off"
              value={username}
              onChange={(e) => setUsername(e.target.value.slice(0, 32))}
              disabled={busy}
              style={inputStyle}
              aria-label="Username"
            />
          </Field>
          <Field label="Display name (optional)">
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value.slice(0, 80))}
              disabled={busy}
              style={inputStyle}
              aria-label="Display name"
            />
          </Field>
          <Field label="Role">
            <select
              value={appRole}
              onChange={(e) => setAppRole(e.target.value)}
              disabled={busy}
              style={inputStyle}
              aria-label="Role"
            >
              <option value="user">User</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
          </Field>

          {error && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#b91c1c' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              style={btnSecondary}
            >Cancel</button>
            <button type="submit" disabled={busy} style={btnPrimary}>
              {busy ? 'Sending…' : 'Send invite'}
            </button>
          </div>
        </form>
      )}
    </Overlay>
  )
}

// ── Presentational helpers ────────────────────────────────────────────────
function Overlay({ children, onClose }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        background: 'rgba(28, 25, 23, 0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        background: '#fff8f1', color: '#1c1917',
        borderRadius: 4, padding: '22px 24px',
        width: 'min(420px, 92vw)',
        boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
      }}>
        {children}
      </div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'block', marginTop: 12, fontSize: 11, letterSpacing: '0.1em', color: LIGHT_INK, textTransform: 'uppercase' }}>
      {label}
      <div style={{ marginTop: 4 }}>{children}</div>
      {hint && <div style={{ marginTop: 4, fontSize: 11, letterSpacing: 0, textTransform: 'none', color: LIGHT_INK }}>{hint}</div>}
    </label>
  )
}

function FooterClose({ onClose, label = 'Close' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
      <button type="button" onClick={onClose} style={btnPrimary}>{label}</button>
    </div>
  )
}

const titleStyle = {
  margin: '0 0 14px 0', fontSize: 16, fontWeight: 600, letterSpacing: '0.04em', color: '#1c1917',
}
const inputStyle = {
  width: '100%', padding: '7px 10px', fontSize: 14,
  background: '#fff', color: '#1c1917',
  border: `1px solid ${LIGHT_RULE}`, borderRadius: 3,
}
const codeStyle = {
  fontFamily: 'Menlo, Consolas, monospace',
  background: '#f5f5f4', padding: '1px 6px', borderRadius: 2,
}
const btnPrimary = {
  background: '#ea580c', color: '#fff',
  border: 'none', borderRadius: 2,
  padding: '8px 18px', fontSize: 12, fontWeight: 600,
  letterSpacing: '0.12em', textTransform: 'uppercase',
  cursor: 'pointer',
}
const btnSecondary = {
  ...btnPrimary,
  background: 'transparent', color: '#44403c',
  border: `1px solid ${LIGHT_RULE}`,
}
