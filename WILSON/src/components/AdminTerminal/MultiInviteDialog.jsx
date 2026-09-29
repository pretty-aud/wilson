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
//
// ── UI overhaul C3b (AT-16, AT-34, AT-26, AT-30) ────────────────────────────
//
// The third private modal shell to become the kit `Dialog`: same flow, same
// two-button footer, same backdrop dismissal while idle, plus the focus trap
// and focus return the surface had nowhere (AT-34). It takes the `reading`
// width because the row is four columns — address, username, role, verdict —
// and the `form` width squeezes the address to nothing.
//
// The five per-row verdicts were five hand-written spans in four colours,
// two of them reds that disagree; they are one `StatusBadge` now, so the
// status is a dot plus its own word rather than colour alone (AT-30).
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../cloud/auth/supabaseClient'
import { parseInviteList, USERNAME_RE } from '../../cloud/auth/inviteParsing'
import { devFixtures, devWriteRefused } from '../../dev/devFixtures'
import Dialog from '../../ui/Dialog'
import Button from '../../ui/Button'
import TextArea from '../../ui/TextArea'
import Input from '../../ui/Input'
import Select from '../../ui/Select'
import Spinner from '../../ui/Spinner'
import StatusBadge from '../../ui/StatusBadge'
import Banner from '../../ui/Banner'

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

// 🚨 THE TWO FIELD STYLE OBJECTS ARE GONE, and the trap they were written to
// avoid is gone with them. Every field here is now `Input` / `TextArea` /
// `Select`, which carry no inline style at all: the well, the ink and the
// edge come from `.ui-input`. That matters because of what C3's review round
// 1 found — an inline `border` SHORTHAND also sets `border-color`, which no
// class rule can beat, so the username field's red invalid edge was deleted
// outright by a shared style object and the user was blocked from sending
// with no marker on the control. `.at-invite-name[data-invalid='true']`
// (0,2,0) now beats `.ui-input` (0,1,0) on specificity with nothing inline in
// the way, which is the structural fix rather than the careful-ordering one.

// One list, three call sites on this surface (here, CreateUserDialog and the
// roster's role picker), in the order the role matrix ranks them.
const ROLE_OPTIONS = [
  { value: 'user', label: 'User' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
]

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

  // No Escape listener here: `Dialog` owns the key, gates it on `busy`
  // exactly as this did, and answers only when it is the TOPMOST modal —
  // which a bare `window` listener cannot check. Its sibling
  // `CreateUserDialog` dropped the same block; leaving this one meant two
  // handlers racing to close one dialog, harmless only for as long as
  // nothing opens above it.

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

    // Dev fixtures (dev builds only): invites are refused loudly, never sent.
    // BEFORE the session read: tester mode has no session, so a guard below the
    // token check is dead code (review round 2). 'failed' is the status this
    // dialog renders and counts; anything else falls through to "Queued".
    if (import.meta.env.DEV && devFixtures()) {
      const refused = devWriteRefused('Inviting members')
      setRows(prev => prev.map(r => (targets.some(t => t.email === r.email)
        ? { ...r, status: 'failed', error: refused.message }
        : r)))
      setBusy(false)
      setDone(true)
      return
    }

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
    <Dialog
      title="Invite by email"
      width="reading"
      busy={busy}
      dismissOnBackdrop
      onClose={() => onClose?.()}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>
            {done && okCount > 0 ? 'Done' : 'Cancel'}
          </Button>
          {done && failCount > 0 ? (
            <Button
              variant="primary"
              onClick={() => send(rows.filter(r => r.status === 'failed'))}
              disabled={busy || badUsernames}
            >
              Retry failed ({failCount})
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => send(pending)}
              disabled={busy || pending.length === 0 || badUsernames}
              loading={busy}
              loadingLabel="Sending…"
              title={badUsernames ? 'Fix the flagged usernames first.' : undefined}
            >
              {`Send ${pending.length} invite${pending.length === 1 ? '' : 's'}`}
            </Button>
          )}
        </>
      )}
    >
        <TextArea
          value={text}
          onChange={handleText}
          disabled={busy}
          rows={3}
          placeholder="Paste emails — commas, spaces or new lines"
          className="at-invite-paste"
        />
        {invalid.length > 0 && (
          <Banner tone="warning" className="at-invite-skipped">
            Skipped (not emails): {invalid.slice(0, 6).join(', ')}{invalid.length > 6 ? ` +${invalid.length - 6} more` : ''}
          </Banner>
        )}

        {rows.length > 0 && (
          <div className="at-invite-list wilson-dark-scroll">
            {rows.map(row => {
              const usernameOk = USERNAME_RE.test(row.username)
              return (
                <div key={row.email} className="at-invite-row" data-sent={String(row.status === 'ok')}>
                <div className="at-invite-cells">
                  <span className="at-invite-email" title={row.email}>
                    {row.email}
                  </span>
                  <Input
                    size="sm"
                    value={row.username}
                    disabled={busy || row.status === 'ok'}
                    onChange={(v) => patchRow(row.email, { username: String(v).toLowerCase().slice(0, 32), status: row.status === 'failed' ? 'queued' : row.status, error: null })}
                    className="at-invite-name"
                    data-invalid={String(!usernameOk)}
                    aria-label={`Username for ${row.email}`}
                  />
                  <Select
                    size="sm"
                    value={row.role}
                    disabled={busy || row.status === 'ok'}
                    onChange={(v) => patchRow(row.email, { role: v })}
                    options={ROLE_OPTIONS}
                    className="at-invite-role"
                    aria-label={`Role for ${row.email}`}
                  />
                  <RowStatus row={row} usernameOk={usernameOk} />
                </div>
                {row.status === 'failed' && row.error && (
                  <div className="at-invite-error">
                    {row.error}
                  </div>
                )}
                </div>
              )
            })}
          </div>
        )}

        {progress && (
          <div className="at-invite-progress">
            {busy
              ? `${progress.sent} of ${progress.total} sent`
              : done && `${okCount} invited · ${failCount} failed`}
          </div>
        )}
    </Dialog>
  )
}

/**
 * The row's verdict. Five states, one component, one fixed-width slot so the
 * three editable cells to its left never shift as a row resolves.
 *
 * `sending` is the one state that is not a verdict — it is the wait — so it
 * stays a spinner rather than borrowing a status tone that would read as an
 * outcome.
 */
function RowStatus({ row, usernameOk }) {
  if (!usernameOk) {
    return <StatusBadge tone="danger" label="Bad name" className="at-invite-status" />
  }
  if (row.status === 'sending') {
    return <Spinner size="sm" label="Sending" className="at-invite-status" />
  }
  if (row.status === 'ok') {
    return <StatusBadge tone="success" label="Invited" className="at-invite-status" />
  }
  if (row.status === 'failed') {
    return <StatusBadge tone="danger" label="Failed" title={row.error || 'Failed'} className="at-invite-status" />
  }
  return <StatusBadge tone="neutral" label="Queued" className="at-invite-status" />
}
