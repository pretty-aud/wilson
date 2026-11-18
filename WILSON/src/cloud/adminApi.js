// =============================================================================
// adminApi — Session 9: client bindings for the Admin Terminal Edge
// Functions. House style: raw fetch to /functions/v1/<name> with
// { apikey, authorization: Bearer } headers and a json.error → friendly
// message map (the InviteMemberDialog pattern — supabase.functions.invoke
// is deliberately not used anywhere in this codebase).
//
// Every call returns { ok, status, data } and NEVER throws on HTTP errors;
// `data.friendly` carries the human-readable failure string. Show-once
// passwords appear ONLY in the resolved data of adminCreateUser /
// adminResetPassword — callers must not persist them.
// =============================================================================

import { devFixtures, devWriteRefused } from '../dev/devFixtures'
import { reportAppEvent } from './errorCodes'
import { callEdgeFunction } from './edgeFunctions'

// F11 (A1): the transport is callEdgeFunction's; the words, the answers and the
// reports are this file's, as they were. Ceilings, chosen on purpose: a read
// (the security posture) 15 s; a write 60 s, far past the second or so these
// take, because a write cut short may have landed (admin-create-user's answer
// carries a show-once password), and the timeout's words say to check first.
const READ_MS = 15000
const WRITE_MS = 60000

const FRIENDLY = {
  unauthorized: 'Session expired — sign in again.',
  forbidden: 'Only active workspace admins can do this.',
  mfa_required: 'This action needs a fresh MFA sign-in. Sign out and back in with your authenticator code.',
  validation_failed: 'Some fields are invalid — check the form.',
  username_taken: 'That username is already taken in this workspace.',
  email_taken: 'That email already has an account.',
  last_admin: 'This is the last active admin — promote someone else first.',
  not_found: 'That member no longer exists in this workspace.',
  create_failed: 'User creation failed. Try again in a minute.',
  reset_failed: 'Password reset failed. Try again in a minute.',
  update_failed: 'Update failed. Try again in a minute.',
  membership_create_failed: 'User creation failed partway — try again.',
  lookup_failed: 'Could not load security details.',
  bad_json: 'Malformed request.',
  method_not_allowed: 'Malformed request.',
}

// Dev fixtures (2026-09-11, dev builds only): there is no Edge Function behind
// fixture data. A WRITE is refused with a toast (the refusal bus) and the same
// answer shape; the one READ (security posture) is a capability gap and answers
// quietly — a toast on a read is wrong (review round 2). Labels are what the
// toast says; the function slug never reaches the copy.
const FIXTURE_LABELS = {
  'admin-create-user': 'Creating a user',
  'admin-reset-password': 'Resetting a password',
  'admin-set-active': "Changing a member's access",
}

async function callAdminFn(name, body, { write = true } = {}) {
  if (import.meta.env.DEV && devFixtures()) {
    const friendly = write
      ? devWriteRefused(FIXTURE_LABELS[name] || 'This admin action').message
      : 'Security details are not available on fixture data.'
    return { ok: false, status: 501, data: { error: 'dev_fixtures_refused', friendly } }
  }
  const r = await callEdgeFunction(name, body ?? {}, { timeoutMs: write ? WRITE_MS : READ_MS, words: FRIENDLY })
  if (r.ok) return { ok: true, status: r.status, data: r.data }
  if (r.code === 'unauthorized' && !r.data) {
    return { ok: false, status: 401, data: { error: 'unauthorized', friendly: FRIENDLY.unauthorized } }
  }
  if (r.status === 0) {
    // No answer: the network, the ceiling, or a session read that stalled. Reported as a network failure was.
    if (r.code !== 'session_stalled') {
      reportAppEvent({ code: 'WIL-4201', severity: 'error', eventType: 'error', context: { fn: name, error: r.code }, error: r.cause })
    }
    return { ok: false, status: 0, data: { error: r.code, friendly: r.words } }
  }
  const json = r.data ?? {}
  if (r.code === 'bad_answer') {
    return { ok: false, status: r.status, data: { error: 'bad_answer', friendly: r.words } }
  }
  const friendly = r.words ?? `Request failed (${r.status}).`
  // eventType 'error' (not 'admin'): the 0021 insert policy reserves the
  // 'admin' stream for server-stamped Edge Function writes.
  if (json.error === 'last_admin') {
    reportAppEvent({ code: 'WIL-4202', severity: 'warning', eventType: 'error', context: { fn: name } })
  } else if (r.status >= 500) {
    reportAppEvent({ code: 'WIL-4201', severity: 'error', eventType: 'error', context: { fn: name, error: json.error ?? r.status } })
  }
  return { ok: false, status: r.status, data: { ...json, friendly } }
}

// The invite's own words (one table where the two dialogs kept a copy each, "one vocabulary app-wide").
const INVITE_WORDS = {
  forbidden:         'You must be a workspace admin to invite members.',
  unauthorized:      'Session expired — sign in again.',
  username_taken:    'That username is already in use in this workspace.',
  email_taken:       'That email is already associated with a WILSON account.',
  validation_failed: 'Please check the form for errors.',
  invite_failed:     'Email delivery failed. Try again in a minute.',
  // Session 17: invite-member enforces the MFA step-up (§6 #46).
  mfa_required:      'This action needs a fresh MFA sign-in. Sign out and back in with your authenticator code.',
  mfa_check_failed:  'Could not verify your MFA status. Try again in a moment.',
}

/**
 * F11 (A1): invite one member (InviteMemberDialog, MultiInviteDialog), the request
 * each dialog built by hand. Answers { ok, status, data } and never throws; on a
 * failure `data.friendly` is the sentence, `Invite failed (<status>).` for a code
 * nobody words. Each dialog keeps its own dev-fixtures refusal before this call.
 * Not through callAdminFn: an invite reports nothing to app_events, as before.
 */
export async function inviteMember({ email, username, displayName = null, appRole }) {
  const r = await callEdgeFunction('invite-member', {
    email,
    username,
    display_name: displayName || null,
    app_role: appRole,
  }, { timeoutMs: WRITE_MS, words: INVITE_WORDS })
  if (r.ok) return { ok: true, status: r.status, data: r.data }
  const friendly = r.words ?? `Invite failed (${r.status}).`
  return { ok: false, status: r.status, data: { ...(r.data ?? {}), error: r.code, friendly } }
}

/** Create a user with show-once credentials. */
export function adminCreateUser({ username, displayName, appRole, email, grantRateCardView, grantRateCardEdit }) {
  return callAdminFn('admin-create-user', {
    username,
    display_name: displayName || null,
    app_role: appRole,
    email: email || undefined,
    grant_rate_card_view: !!grantRateCardView,
    grant_rate_card_edit: !!grantRateCardEdit,
  })
}

/** Generate a fresh show-once password for a member. */
export function adminResetPassword(userId) {
  return callAdminFn('admin-reset-password', { user_id: userId })
}

/** Deactivate (with token revocation) or reactivate a member. */
export function adminSetActive(userId, active) {
  return callAdminFn('admin-set-active', { user_id: userId, active: !!active })
}

/** Security posture for the user-detail panel (MFA, ban, last sign-in). */
export function adminUserSecurity(userId) {
  return callAdminFn('admin-user-security', { user_id: userId }, { write: false })
}

/** True when the edge function is deployed (feature-detect helper). */
export function isMissingFunction(result) {
  return result?.status === 404 && !result?.data?.error
}
