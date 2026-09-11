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
// and the near-white card Audrey banned is deleted with it. All three panes
// pass `dismissOnBackdrop` because the hand-rolled overlay dismissed on a
// backdrop click and C1 does not let a restyle change what a click does;
// Dialog's `busy` already suppresses `tryClose()`, which is exactly what
// `onClose={busy ? undefined : onClose}` used to do mid-send.
// The fields are Field + Input / Select, which gives the stack one left edge
// and the 11px Label / 4px / 12px Caption proximity ratio (A8).
//
// 🚨 R2 REVERSAL — the invite error renders in the BODY, under the last
// field, as the kit `Banner tone="danger"`. It is NOT passed to Dialog's
// `error` prop. `.ui-dialog-error > span` is
// `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`
// (index.css), so that slot is exactly ONE clipped line. At `width="form"`
// (560px) the footer row is 512px shared with Cancel + Send invite (~185px),
// two 8px gaps and the 16px AlertTriangle with its 6px gap — roughly 290px,
// about 43 characters of 13px Dense. The longest message this dialog can
// produce is 89: "This action needs a fresh MFA sign-in. Sign out and back in
// with your authenticator code." The clipped half is the INSTRUCTION, and it
// survived only in a `title` tooltip that no keyboard user can reach.
// `.ui-banner-text` is `flex: 1; min-width: 0` with no nowrap, so the Banner
// wraps; `.ui-dialog-body` already scrolls. The pre-D2 code put the error in
// exactly this place (a wrapping block after the Role field, above the
// buttons), so this is a restore, not a new arrangement. UpdatePrompt now
// reads the same way — one idiom across both of this session's dialogs.
//
// The cost is real and is FILED rather than paid for with the message —
// Banner is a full-bleed strip (`8px var(--spacing-gutter)`) nested inside
// `.ui-dialog-body`'s own 24px, so its text is inset 48px from the card edge
// and its `border-bottom` hairline stops 24px short of both edges. Not fixed
// with an inline style on the component (overriding a kit component at the
// call site is the Bins dead-hover pattern the kit header forbids):
//
//   🚨 K9  `.ui-dialog-error > span` should wrap — drop `white-space: nowrap`
//          and `text-overflow: ellipsis`. `.ui-dialog-foot` is already
//          `flex-wrap: wrap; align-items: center`, so a two-line error lays
//          out correctly. Until it lands, Dialog's `error` slot may only
//          carry strings short enough to fit; neither caller's are.
//   🚨 K10 Dialog should take a wrapping error slot in the BODY — or Banner
//          should have a nested/inset variant — so a long failure does not
//          have to choose between double padding and truncation.
//
// On the dialog's `paper-raised` the danger tint flattens to #413333: the
// label measures 10.63:1 and the AlertTriangle 6.34:1. Banner's role for
// tone="danger" is `alert`, the same announcement `.ui-dialog-error`'s span
// was making, so nothing is lost to a screen reader.
//
// ⚠️ Every `aria-label` below is load-bearing: tests/e2e/auth.spec.ts selects
// on "Email" and "Username" and matches /send invite/i and /invite sent/i.
// Change the CSS role, never the text.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { supabase } from './supabaseClient'
import { usePermissions } from '../../permissions/usePermissions'
import { Banner, Button, Dialog, Field, Input, Select } from '../../ui'
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

  // 🚨 OPEN — a C1 behaviour change, NOT a settled decision. Say it plainly:
  // the first Escape DESTROYS what the admin typed into the focused field and
  // does not close the dialog; a second Escape closes it. Pre-D2 the first
  // Escape closed the dialog from anywhere. Mechanism: Dialog listens on
  // `document` (above React's root container), and the kit Input owns Escape
  // inside a field — it reverts the value to what it was on focus, blurs, and
  // calls `e.stopPropagation()` on the synthetic event, which calls the
  // native one at React's root, so the key never reaches `document`
  // (src/ui/Input.jsx — a ruled Bins behaviour: "Escape in a take's note
  // closed the takes dialog and dropped the note"). The open effect resets
  // Email to '' before focusing, so the reverted value is '': the typed
  // address is gone.
  //
  //   🚨 K11 Input's Escape-revert and Dialog's Escape-close collide in EVERY
  //          Dialog that holds an Input. Foundation's to reconcile — e.g.
  //          `useEscapeRevert.cancel` stops propagation only when the field
  //          is actually dirty, so a pristine field lets Escape through.
  //
  // 🚨 QUESTION FOR AUDREY, not a ruling made here: this file restored the
  // backdrop click on C1 grounds, and the C1 standard must not be split — but
  // the two fixes R2 proposed both cost more than they buy, so neither is
  // taken unilaterally:
  //   • Dropping the `emailRef` auto-focus is NOT a one-line free fix. That
  //     focus is PRE-session behaviour (byte-identical in d2238ca, comment
  //     included), so removing it is a fresh C1 breach — and Dialog does no
  //     focus management of its own, so the dialog would open with focus left
  //     on the TeamMembersPage trigger, behind the backdrop. That trades a
  //     two-press Escape for an unfocused modal and a lost auto-focus.
  //   • Defeating the kit at the call site (an `onKeyDownCapture` that beats
  //     Input's handler) turns off a ruled Bins behaviour in this one dialog
  //     and nowhere else — the same caller-overrides-kit pattern the kit
  //     header forbids. A form-level `onKeyDown` does not work at all: Input
  //     returns before calling the caller's handler.
  // So it stays as the kit has it, recorded as OPEN against K11 and as a C1
  // exception awaiting a ruling — not as a resolved finding.

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
  //
  // R2 noted this pane carried no heading pre-D2 and now takes the form's
  // title, so "Invite a workspace member" sits above a sentence that refuses
  // it. Kept, deliberately: Dialog's header bar renders either way (title,
  // subtitle, X), and `title` is the ONLY thing that becomes the dialog's
  // `aria-label` (Dialog.jsx) — dropping it leaves an empty header and an
  // unnamed modal, which is worse than a title that names the action the
  // admin attempted. Inventing a third string here would be the copy change
  // R1 objected to on this same file, so the wording question (this title,
  // the form's title, and TeamMembersPage's "Invite User" trigger are three
  // different phrasings of one action) goes to the hand-off instead.
  if (perms.ready && perms.role !== 'admin') {
    return (
      <Dialog
        title="Invite a workspace member"
        width="form"
        onClose={onClose}
        dismissOnBackdrop
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
        dismissOnBackdrop
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
      title="Invite a workspace member"
      width="form"
      onClose={onClose}
      dismissOnBackdrop
      busy={busy}
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

        {/* R2: the error wraps here, under the last field and directly above
            the footer's buttons — the place the pre-D2 block occupied. 16px
            is the kit's between-blocks step, the same `.ui-field + .ui-field`
            rhythm; it is a sibling AFTER the last Field, so the four Fields
            are still adjacent and still carry their own 16px (A8). */}
        {error && (
          <div style={{ marginTop: 16 }}>
            <Banner tone="danger" Icon={AlertTriangle}>{error}</Banner>
          </div>
        )}
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
