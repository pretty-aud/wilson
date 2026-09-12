// =============================================================================
// CreateUserDialog — admin creates an account with a generated password
// (Session 9). The username-first sibling of InviteMemberDialog: no email
// required — the Edge Function synthesizes one when absent, and the admin
// hands over credentials via CredentialsPopup.
//
// UX laws embodied:
//   Postel's Law — inputs normalize as you type (lowercase, length caps),
//     never block keystrokes; validation only gates submit.
//   Jakob's Law — same dark-modal shape and flow as the existing dialogs.
//
// ── UI overhaul C3b (AT-16, AT-34, AT-21) ───────────────────────────────────
//
// The second of the four private modal shells to become the kit `Dialog`.
// Everything the flow did, it still does: Escape closes unless busy, the
// backdrop closes unless busy (`dismissOnBackdrop`), the submit is gated on
// the same two validations, and the show-once password still goes straight
// to the parent and is never held here.
//
// 🚨 THE FORM ELEMENT MOVED INSIDE THE DIALOG BODY and the submit button now
// reaches it by `form={FORM_ID}`. `Dialog` renders header / body / footer as
// siblings, so a <form> wrapping all three is not available — and an implicit
// submit that no longer fires is the silent way to break a dialog whose only
// keyboard path is Enter. The id is what keeps Enter working from every field.
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { adminCreateUser } from '../../cloud/adminApi'
import { USERNAME_RE, EMAIL_RE } from '../../cloud/auth/inviteParsing'
import Dialog from '../../ui/Dialog'
import Button from '../../ui/Button'
import Field from '../../ui/Field'
import Input from '../../ui/Input'
import Select from '../../ui/Select'

const FORM_ID = 'at-create-user-form'

const ROLE_OPTIONS = [
  { value: 'user', label: 'User' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
]

export default function CreateUserDialog({ open, onClose, onCreated }) {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [appRole, setAppRole] = useState('user')
  const [email, setEmail] = useState('')
  const [grantView, setGrantView] = useState(false)
  const [grantEdit, setGrantEdit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const usernameRef = useRef(null)

  // Reset per opening (same lifecycle as InviteMemberDialog).
  useEffect(() => {
    if (!open) return undefined
    setUsername(''); setDisplayName(''); setAppRole('user'); setEmail('')
    setGrantView(false); setGrantEdit(false)
    setBusy(false); setError('')
    const t = setTimeout(() => usernameRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [open])

  if (!open) return null

  const usernameValid = USERNAME_RE.test(username)
  const emailV = email.trim().toLowerCase()

  async function handleSubmit(e) {
    e?.preventDefault()
    if (busy) return
    if (!usernameValid) return setError('Username: lowercase letters/digits/._- , 2-32 chars, starts with a letter or digit.')
    if (emailV && !EMAIL_RE.test(emailV)) return setError('Email looks invalid — leave it blank or fix it.')
    setBusy(true)
    setError('')
    const res = await adminCreateUser({
      username,
      displayName: displayName.trim() || null,
      appRole,
      email: emailV || undefined,
      grantRateCardView: grantEdit || grantView, // edit implies view
      grantRateCardEdit: grantEdit,
    })
    if (!res.ok) {
      setError(res.data?.friendly || `Create failed (${res.status}).`)
      setBusy(false)
      return
    }
    setBusy(false)
    // data carries the SHOW-ONCE password — hand it straight to the parent,
    // which opens CredentialsPopup. Never stored here.
    onCreated?.(res.data, { displayName: displayName.trim() || null })
  }

  return (
    <Dialog
      title="Create with password"
      width="form"
      busy={busy}
      error={error || null}
      dismissOnBackdrop
      onClose={() => onClose?.()}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            type="submit"
            form={FORM_ID}
            variant="primary"
            loading={busy}
            loadingLabel="Creating…"
          >
            Create user
          </Button>
        </>
      )}
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="at-form">
        {/* The hint keeps `at-hint` and its `data-invalid` rather than
            becoming a plain string: it goes amber the moment the typed
            username stops matching the pattern, which is the only feedback
            this field has before submit. C3 extracted that branch; dropping
            the attribute here would leave the rule dead. */}
        <Field
          label="Username"
          hint={(
            <span className="at-hint" data-invalid={String(!!username && !usernameValid)}>
              Lowercase letters, digits, ._- — 2-32 chars. Scoped to this workspace.
            </span>
          )}
        >
          <Input
            ref={usernameRef}
            autoComplete="off"
            value={username}
            // Live normalize, never block: lowercase + length cap on the fly.
            onChange={(v) => setUsername(String(v).toLowerCase().slice(0, 32))}
            disabled={busy}
            aria-label="Username"
          />
        </Field>

        <Field label="Display name">
          <Input
            value={displayName}
            onChange={(v) => setDisplayName(String(v).slice(0, 80))}
            disabled={busy}
            aria-label="Display name"
          />
        </Field>

        <Field label="Role">
          <Select
            value={appRole}
            onChange={(v) => setAppRole(v)}
            options={ROLE_OPTIONS}
            disabled={busy}
            aria-label="Role"
          />
        </Field>

        <Field
          label="Email (optional)"
          hint="Optional. Without an email they can't self-reset; admins reset instead."
        >
          <Input
            autoComplete="off"
            value={email}
            onChange={(v) => setEmail(v)}
            disabled={busy}
            aria-label="Email"
          />
        </Field>

        <div className="at-grant-group">
          <span className="at-group-label">Rate-card access</span>
          <CheckRow
            checked={grantEdit || grantView}
            disabled={busy || grantEdit}
            onToggle={() => setGrantView(v => !v)}
            label="Can view rate card"
            note={grantEdit ? 'Included with edit access' : null}
          />
          <CheckRow
            checked={grantEdit}
            disabled={busy}
            onToggle={() => setGrantEdit(v => !v)}
            label="Can edit rate card"
          />
        </div>
      </form>
    </Dialog>
  )
}

function CheckRow({ checked, disabled, onToggle, label, note }) {
  return (
    <label
      className="at-check-row"
      data-dim={String(!!disabled && !note)}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        className="at-checkbox"
      />
      <span className="at-check-label">{label}</span>
      {note && <span className="at-check-note">{note}</span>}
    </label>
  )
}
