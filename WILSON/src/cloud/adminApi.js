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

import { supabase } from './auth/supabaseClient'
import { devFixtures, devWriteRefused } from '../dev/devFixtures'
import { reportAppEvent } from './errorCodes'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

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

async function callAdminFn(name, body) {
  // Dev fixtures (2026-09-11, dev builds only): there is no Edge Function behind
  // fixture data; the action is refused with a toast and the same answer shape.
  if (import.meta.env.DEV && devFixtures()) {
    const refused = devWriteRefused(`The admin action "${name}"`)
    return { ok: false, status: 501, data: { error: 'dev_fixtures_refused', friendly: refused.message } }
  }
  let token = null
  try {
    const { data } = await supabase.auth.getSession()
    token = data?.session?.access_token ?? null
  } catch { /* fall through to unauthorized */ }
  if (!token) {
    return { ok: false, status: 401, data: { error: 'unauthorized', friendly: FRIENDLY.unauthorized } }
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: SUPABASE_ANON,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body ?? {}),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      const friendly = FRIENDLY[json.error] ?? `Request failed (${res.status}).`
      // eventType 'error' (not 'admin'): the 0021 insert policy reserves the
      // 'admin' stream for server-stamped Edge Function writes.
      if (json.error === 'last_admin') {
        reportAppEvent({ code: 'WIL-4202', severity: 'warning', eventType: 'error', context: { fn: name } })
      } else if (res.status >= 500) {
        reportAppEvent({ code: 'WIL-4201', severity: 'error', eventType: 'error', context: { fn: name, error: json.error ?? res.status } })
      }
      return { ok: false, status: res.status, data: { ...json, friendly } }
    }
    return { ok: true, status: res.status, data: json }
  } catch (err) {
    reportAppEvent({ code: 'WIL-4201', severity: 'error', eventType: 'error', context: { fn: name, error: 'network' }, error: err })
    return { ok: false, status: 0, data: { error: 'network', friendly: 'Network error — check your connection.' } }
  }
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
  return callAdminFn('admin-user-security', { user_id: userId })
}

/** True when the edge function is deployed (feature-detect helper). */
export function isMissingFunction(result) {
  return result?.status === 404 && !result?.data?.error
}
