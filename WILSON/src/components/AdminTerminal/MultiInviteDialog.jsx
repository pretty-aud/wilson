// =============================================================================
// MultiInviteDialog — Slack-style bulk invite (Session 9). Paste a blob of
// emails, review the parsed rows, fire one invite-member call per row.
//
// UX laws embodied:
//   Postel's Law — the textarea accepts commas/spaces/newlines/semicolons
//     and "Name <email>" forms (parseInviteList); output rows are strict.
//   Goal-Gradient Effect — "k of n sent" progress line during the run.
//   Doherty Threshold — per-row status flips (queued → sending → result)
//     the moment each request settles.
//   Peak-End Rule — end-state summary ("5 invited · 2 failed") with failed
//     rows kept editable behind RETRY FAILED.
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { Mail, Check, X, Loader2 } from 'lucide-react'
import { supabase } from '../../cloud/auth/supabaseClient'
import { parseInviteList, USERNAME_RE } from '../../cloud/auth/inviteParsing'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

// Same error map InviteMemberDialog uses — one vocabulary app-wide.
const ERROR_MAP = {
  forbidden:         'You must be a workspace admin to invite members.',
  unauthorized:      'Session expired — sign in again.',
  username_taken:    'That username is already in use in this workspace.',
  email_taken:       'That email is already associated with a WILSON account.',
  validation_failed: 'Please check the form for errors.',
  invite_failed:     'Email delivery failed. Try again in a minute.',
  // Session 17: invite-member enforces the MFA step-up (§6 #46). Kept in the
  // same vocabulary as adminApi.js / operatorApi.js.
  mfa_required:      'This action needs a fresh MFA sign-in. Sign out and back in with your authenticator code.',
  mfa_check_failed:  'Could not verify your MFA status. Try again in a moment.',
}

const fieldStyle = {
  backgroundColor: 'rgba(244, 162, 97, 0.12)', color: '#f4a261',
  border: '1px solid #44403c', borderRadius: 3,
}

export default function MultiInviteDialog({ open, onClose, onInvited }) {
  const [text, setText] = useState('')
  const [rows, setRows] = useState([]) // { email, username, role, status, error }
  const [invalid, setInvalid] = useState([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null) // { sent, total } | null
  const [done, setDone] = useState(false)

  // StrictMode-safe mounted flag (body sets true, cleanup sets false).
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!open) return
    setText(''); setRows([]); setInvalid([])
    setBusy(false); setProgress(null); setDone(false)
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  function handleText(next) {
    setText(next)
    const parsed = parseInviteList(next)
    setInvalid(parsed.invalid)
    setDone(false)
    // Reconcile by email so admin edits (username/role) and sent statuses
    // survive re-parsing while they keep typing.
    setRows(prev => {
      const byEmail = new Map(prev.map(r => [r.email, r]))
      return parsed.entries.map(e =>
        byEmail.get(e.email) ?? { email: e.email, username: e.username, role: 'user', status: 'queued', error: null })
    })
  }

  function patchRow(email, patch) {
    setRows(prev => prev.map(r => (r.email === email ? { ...r, ...patch } : r)))
  }

  const pending = rows.filter(r => r.status !== 'ok')
  const badUsernames = pending.some(r => !USERNAME_RE.test(r.username))
  const okCount = rows.filter(r => r.status === 'ok').length
  const failCount = rows.filter(r => r.status === 'failed').length

  // ONE fetch per row, sequential — the Edge Function rate-limits and each
  // row needs its own success/failure verdict anyway.
  async function send(targets) {
    if (busy || targets.length === 0 || badUsernames) return
    setBusy(true)
    setDone(false)
    setProgress({ sent: 0, total: targets.length })

    const { data: sess } = await supabase.auth.getSession()
    if (!mountedRef.current) return
    const token = sess?.session?.access_token
    if (!token) {
      setRows(prev => prev.map(r => (targets.some(t => t.email === r.email)
        ? { ...r, status: 'failed', error: 'Session expired — sign in again.' }
        : r)))
      setBusy(false)
      setDone(true)
      return
    }

    let sent = 0
    for (const target of targets) {
      if (!mountedRef.current) return
      patchRow(target.email, { status: 'sending', error: null })
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/invite-member`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            apikey: SUPABASE_ANON,
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            email: target.email,
            username: target.username,
            display_name: null,
            app_role: target.role,
          }),
        })
        const json = await res.json().catch(() => ({}))
        if (!mountedRef.current) return
        if (res.status === 201) {
          patchRow(target.email, { status: 'ok', error: null })
          onInvited?.({ ...json, display_name: json.username })
        } else {
          patchRow(target.email, { status: 'failed', error: ERROR_MAP[json.error] ?? `Invite failed (${res.status}).` })
        }
      } catch (err) {
        if (!mountedRef.current) return
        patchRow(target.email, { status: 'failed', error: err?.message ?? 'Network error.' })
      }
      sent += 1
      setProgress({ sent, total: targets.length })
    }
    if (!mountedRef.current) return
    setBusy(false)
    setDone(true)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 80, backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose?.() }}
    >
      <div
        className="flex flex-col"
        style={{
          backgroundColor: '#1c1917', border: '2px solid #ea580c', borderRadius: '6px',
          padding: '20px 22px', width: 'min(620px, 94vw)', maxHeight: '86vh', color: '#f4a261',
        }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Mail className="w-4 h-4" style={{ color: '#ea580c' }} />
          <h2 className="font-mono uppercase text-sm tracking-widest" style={{ color: '#ea580c' }}>
            Invite by email
          </h2>
        </div>

        <textarea
          value={text}
          onChange={(e) => handleText(e.target.value)}
          disabled={busy}
          rows={3}
          placeholder="Paste emails — commas, spaces or new lines"
          className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500 resize-y"
          style={fieldStyle}
        />
        {invalid.length > 0 && (
          <div className="mt-1.5 text-[11px] font-mono" style={{ color: '#fbbf24' }}>
            Skipped (not emails): {invalid.slice(0, 6).join(', ')}{invalid.length > 6 ? ` +${invalid.length - 6} more` : ''}
          </div>
        )}

        {rows.length > 0 && (
          <div className="mt-3 overflow-y-auto wilson-light-scroll" style={{ maxHeight: '38vh' }}>
            {rows.map(row => {
              const usernameOk = USERNAME_RE.test(row.username)
              return (
                <div key={row.email} style={{ borderBottom: '1px solid #292524', opacity: row.status === 'ok' ? 0.75 : 1 }}>
                <div className="flex items-center gap-2 py-1.5">
                  <span className="flex-1 text-xs font-mono truncate" style={{ color: '#fde8d0' }} title={row.email}>
                    {row.email}
                  </span>
                  <input
                    type="text"
                    value={row.username}
                    disabled={busy || row.status === 'ok'}
                    onChange={(e) => patchRow(row.email, { username: e.target.value.toLowerCase().slice(0, 32), status: row.status === 'failed' ? 'queued' : row.status, error: null })}
                    className="w-36 px-2 py-1 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    style={{ ...fieldStyle, border: usernameOk ? fieldStyle.border : '1px solid #dc2626' }}
                    aria-label={`Username for ${row.email}`}
                  />
                  <select
                    value={row.role}
                    disabled={busy || row.status === 'ok'}
                    onChange={(e) => patchRow(row.email, { role: e.target.value })}
                    className="px-1.5 py-1 text-[11px] font-mono rounded-sm focus:outline-none cursor-pointer"
                    style={fieldStyle}
                    aria-label={`Role for ${row.email}`}
                  >
                    <option value="user">User</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                  <RowStatus row={row} usernameOk={usernameOk} />
                </div>
                {row.status === 'failed' && row.error && (
                  <div className="pb-1.5 text-[11px] font-mono" style={{ color: '#ef4444' }}>
                    {row.error}
                  </div>
                )}
                </div>
              )
            })}
          </div>
        )}

        {progress && (
          <div className="mt-2 text-[11px] font-mono" style={{ color: '#a8a29e' }}>
            {busy
              ? `${progress.sent} of ${progress.total} sent`
              : done && `${okCount} invited · ${failCount} failed`}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors disabled:opacity-40"
            style={{ backgroundColor: 'transparent', color: '#a8a29e', border: '1px solid #44403c' }}
          >
            {done && okCount > 0 ? 'Done' : 'Cancel'}
          </button>
          {done && failCount > 0 ? (
            <button
              type="button"
              onClick={() => send(rows.filter(r => r.status === 'failed'))}
              disabled={busy || badUsernames}
              className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors disabled:opacity-40"
              style={{ backgroundColor: '#ea580c', color: '#fff' }}
            >
              Retry failed ({failCount})
            </button>
          ) : (
            <button
              type="button"
              onClick={() => send(pending)}
              disabled={busy || pending.length === 0 || badUsernames}
              className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors disabled:opacity-40"
              style={{ backgroundColor: '#ea580c', color: '#fff' }}
              title={badUsernames ? 'Fix the flagged usernames first.' : undefined}
            >
              {busy ? 'Sending…' : `Send ${pending.length} invite${pending.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function RowStatus({ row, usernameOk }) {
  if (!usernameOk) {
    return <span className="w-20 text-[10px] font-bold uppercase text-right" style={{ color: '#dc2626' }}>Bad name</span>
  }
  if (row.status === 'sending') {
    return <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" style={{ color: '#f4a261' }} />
  }
  if (row.status === 'ok') {
    return (
      <span className="w-20 flex items-center justify-end gap-1 text-[10px] font-bold uppercase" style={{ color: '#22c55e' }}>
        <Check className="w-3 h-3" /> Invited
      </span>
    )
  }
  if (row.status === 'failed') {
    return (
      <span className="w-20 flex items-center justify-end gap-1 text-[10px] font-bold uppercase" style={{ color: '#ef4444' }} title={row.error || 'Failed'}>
        <X className="w-3 h-3" /> Failed
      </span>
    )
  }
  return <span className="w-20 text-[10px] font-mono uppercase text-right" style={{ color: '#78716c' }}>Queued</span>
}
