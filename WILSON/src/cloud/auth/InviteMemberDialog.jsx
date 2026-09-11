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
//
// Session D2 (AUTH-06, A8): the hand-rolled overlay is gone. This is the
// shared `src/ui/Dialog` — one backdrop, `paper-raised`, 6px radius, the one
// shadow, header / body / footer, Escape and the busy lock owned by the kit.
// A Dialog is always a dark floating surface, wherever it opens (index.css:
// "a dark island inside a light page"), so the inks here are the dark tokens
// and the near-white card Audrey banned is deleted with it. Backdrop click
// no longer dismisses: this is a form, and a stray click must not discard it.
// The fields are Field + Input / Select, which gives the stack one left edge
// and the 11px Label / 4px / 12px Caption proximity ratio (A8).
//
// ⚠️ Every `aria-label` below is load-bearing: tests/e2e/auth.spec.ts selects
// on "Email" and "Username" and matches /send invite/i and /invite sent/i.
// Change the CSS role, never the text.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { usePermissions } from '../../permissions/usePermissions'
import { Button, Dialog, Field, Input, Select } from '../../ui'
import { FONT_MONO, PAPER_RECESSED, RADIUS_CONTROL, RULE, TYPE } from '../../ui/tokens'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// The footer's submit button lives outside the <form> (Dialog owns the
// footer), so it is associated by id rather than by nesting.
const FORM_ID = 'invite-member-form'

const ROLE_OPTIONS = [
  { value: 'user',    label: 'User' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin',   label: 'Admin' },
]

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

  // Escape is Dialog's job now (topmost only, and never mid-send).

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

  // The kit Input blurs the field on Enter (its Escape-reverts contract), and
  // a blurred field no longer triggers the form's implicit submission — so
  // send explicitly. preventDefault keeps it to exactly one submit.
  const submitOnEnter = useCallback((e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    handleSubmit()
  }, [handleSubmit])

  if (!open) return null

  // Defensive: never render the form to a non-admin, even if the parent
  // forgot to gate.
  if (perms.ready && perms.role !== 'admin') {
    return (
      <Dialog
        title="Invite member"
        width="form"
        onClose={onClose}
        footer={<Button variant="primary" onClick={onClose}>Close</Button>}
      >
        <p style={{ margin: 0 }}>Only workspace admins can invite members.</p>
      </Dialog>
    )
  }

  if (success) {
    return (
      <Dialog
        title="Invite sent"
        width="form"
        onClose={onClose}
        footer={<Button variant="primary" onClick={onClose}>Done</Button>}
      >
        <p style={{ margin: 0 }}>
          We emailed <strong style={{ fontWeight: 600 }}>{success.email}</strong> with a link to set their
          password. Their username on this workspace is{' '}
          <code style={codeStyle}>{success.username}</code>.
        </p>
      </Dialog>
    )
  }

  return (
    <Dialog
      title="Invite member"
      width="form"
      onClose={onClose}
      busy={busy}
      error={error || null}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" form={FORM_ID} disabled={busy}>
            {busy ? 'Sending…' : 'Send invite'}
          </Button>
        </>
      }
    >
      {/* The Fields are adjacent siblings so the kit's 16px between / 4px
          within ratio applies; no wrapper adds a per-field margin (A8). */}
      <form id={FORM_ID} onSubmit={handleSubmit}>
        <Field label="Email">
          <Input
            ref={emailRef}
            type="email"
            autoComplete="off"
            value={email}
            onChange={setEmail}
            onKeyDown={submitOnEnter}
            disabled={busy}
            aria-label="Email"
          />
        </Field>
        <Field label="Username" hint="Lowercase. Scoped to this workspace.">
          <Input
            type="text"
            autoComplete="off"
            value={username}
            onChange={(v) => setUsername(v.slice(0, 32))}
            onKeyDown={submitOnEnter}
            disabled={busy}
            aria-label="Username"
          />
        </Field>
        <Field label="Display name (optional)">
          <Input
            type="text"
            value={displayName}
            onChange={(v) => setDisplayName(v.slice(0, 80))}
            onKeyDown={submitOnEnter}
            disabled={busy}
            aria-label="Display name"
          />
        </Field>
        <Field label="Role">
          <Select
            value={appRole}
            onChange={(v) => setAppRole(v ?? 'user')}
            options={ROLE_OPTIONS}
            disabled={busy}
            aria-label="Role"
          />
        </Field>
      </form>
    </Dialog>
  )
}

// The username is an identifier, which is one of the roles mono keeps (Q4).
// It sits on the dark dialog, so the chip is the recessed paper with the one
// hairline — no second ground, no second radius.
const codeStyle = {
  fontFamily: FONT_MONO,
  fontSize: TYPE.dense,
  backgroundColor: PAPER_RECESSED,
  border: `1px solid ${RULE}`,
  borderRadius: RADIUS_CONTROL,
  padding: '1px 6px',
}
