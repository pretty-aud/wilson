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
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { UserPlus } from 'lucide-react'
import { adminCreateUser } from '../../cloud/adminApi'
import { USERNAME_RE, EMAIL_RE } from '../../cloud/auth/inviteParsing'

const fieldStyle = {
  width: '100%', padding: '7px 9px', fontSize: 12,
  backgroundColor: 'rgba(244, 162, 97, 0.12)', color: '#f4a261',
  border: '1px solid #44403c', borderRadius: 3,
}
const labelClass = 'block text-[10px] font-bold uppercase tracking-wider mb-1'
const hintClass = 'text-[10px] mt-1 leading-relaxed'

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

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

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
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 80, backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose?.() }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          backgroundColor: '#1c1917', border: '2px solid #ea580c', borderRadius: '6px',
          padding: '20px 22px', width: 'min(440px, 92vw)', color: '#f4a261',
        }}
      >
        <div className="flex items-center gap-2 mb-4">
          <UserPlus className="w-4 h-4" style={{ color: '#ea580c' }} />
          <h2 className="font-mono uppercase text-sm tracking-widest" style={{ color: '#ea580c' }}>
            Create with password
          </h2>
        </div>

        <div className="mb-3">
          <label className={labelClass} style={{ color: '#a8a29e' }}>Username</label>
          <input
            ref={usernameRef}
            type="text"
            autoComplete="off"
            value={username}
            // Live normalize, never block: lowercase + length cap on the fly.
            onChange={(e) => setUsername(e.target.value.toLowerCase().slice(0, 32))}
            disabled={busy}
            style={fieldStyle}
            aria-label="Username"
          />
          <div className={`at-hint ${hintClass}`} data-invalid={String(!!username && !usernameValid)}>
            Lowercase letters, digits, ._- — 2-32 chars. Scoped to this workspace.
          </div>
        </div>

        <div className="mb-3">
          <label className={labelClass} style={{ color: '#a8a29e' }}>Display name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value.slice(0, 80))}
            disabled={busy}
            style={fieldStyle}
            aria-label="Display name"
          />
        </div>

        <div className="mb-3">
          <label className={labelClass} style={{ color: '#a8a29e' }}>Role</label>
          <select
            value={appRole}
            onChange={(e) => setAppRole(e.target.value)}
            disabled={busy}
            style={fieldStyle}
            aria-label="Role"
          >
            <option value="user">User</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        <div className="mb-3">
          <label className={labelClass} style={{ color: '#a8a29e' }}>Email (optional)</label>
          <input
            type="text"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            style={fieldStyle}
            aria-label="Email"
          />
          <div className={hintClass} style={{ color: '#78716c' }}>
            Optional. Without an email they can't self-reset; admins reset instead.
          </div>
        </div>

        <div className="mb-4">
          <label className={labelClass} style={{ color: '#a8a29e' }}>Rate-card access</label>
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

        {error && (
          <div
            className="mb-3 text-xs font-mono px-3 py-2 rounded-sm"
            style={{ backgroundColor: 'rgba(220, 38, 38, 0.1)', color: '#dc2626' }}
          >
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="at-disable-40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors"
            style={{ backgroundColor: 'transparent', color: '#a8a29e', border: '1px solid #44403c' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="at-disable-40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors"
            style={{ backgroundColor: '#ea580c', color: '#fff' }}
          >
            {busy ? 'Creating…' : 'Create user'}
          </button>
        </div>
      </form>
    </div>
  )
}

function CheckRow({ checked, disabled, onToggle, label, note }) {
  return (
    <label
      className="at-check-row flex items-center gap-2 py-1 cursor-pointer select-none"
      data-dim={String(!!disabled && !note)}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        className="accent-orange-600"
      />
      <span className="text-xs font-mono" style={{ color: '#fde8d0' }}>{label}</span>
      {note && <span className="text-[10px]" style={{ color: '#78716c' }}>{note}</span>}
    </label>
  )
}
