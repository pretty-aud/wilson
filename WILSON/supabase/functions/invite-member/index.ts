// =============================================================================
// invite-member Edge Function
//
// Admin-only. Called by TeamMembersPage's "Invite user" dialog. Takes an
// email + workspace-scoped username + optional display_name + app_role,
// and:
//   1. Verifies the caller through the shared `_shared/adminGuard.ts` —
//      token claims, a LIVE workspace_members row, and the MFA step-up.
//      Session 17 (§6 #46): this function used to reimplement the claims +
//      live-row check inline and had NO MFA step-up, while its sibling
//      admin-create-user — the other path to the same outcome — was blocked
//      at aal1. Since ROLE_SET includes 'admin', that let an admin holding a
//      verified factor mint another admin from an aal1 session, which locked
//      decision #9 ("MFA for all admin tiers") does not allow.
//   2. Creates the auth user via admin.inviteUserByEmail. Supabase mints
//      an invite recovery token and sends our invite.html template with
//      the company_name + inviter_name + username passed as .Data.*.
//   3. Inserts the workspace_members row with onboarded_at=null — the
//      NewUserWelcome wizard fires on the invited user's first sign-in.
//
// On any DB-side failure, the orphan auth user is deleted (best effort).
// Email delivery failures surface as 502 without rolling back the user
// (the admin can resend via a dashboard reset-password link).
//
// This function does NOT call issue-session or refreshSession; the
// invited user's JWT is minted by signInWithPassword the first time they
// log in, at which point the custom_access_token_hook picks up their
// workspace_id from the single membership row we created.
// =============================================================================

import { corsHeaders, reply, requireWorkspaceAdmin } from '../_shared/adminGuard.ts'

// Where the invite link lands when the invitee clicks through the email.
// Falls back to SUPABASE_URL so the function still works in environments
// where WILSON_SITE_URL isn't set (local dev), though the redirect then
// bounces off the Supabase default and back to site_url in config.toml.
const SITE_URL = Deno.env.get('WILSON_SITE_URL') ?? 'http://localhost:5203'

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const ROLE_SET    = new Set(['admin', 'manager', 'user'])

type Body = {
  email?: string
  username?: string
  display_name?: string
  app_role?: 'admin' | 'manager' | 'user'
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)

  // 1. Resolve + verify caller: token claims, live workspace_members row,
  //    and the MFA step-up — all of it in the shared guard, so this path
  //    cannot drift from admin-create-user again (§6 #46).
  const guard = await requireWorkspaceAdmin(req)
  if (!guard.ok) return guard.res
  const { admin, callerId, workspaceId: callerWorkspaceId } = guard.ctx

  // 2. Parse + validate the invite payload.
  let body: Body
  try { body = await req.json() } catch { return reply({ error: 'bad_json' }, 400) }

  const email       = typeof body.email       === 'string' ? body.email.trim().toLowerCase()       : ''
  const username    = typeof body.username    === 'string' ? body.username.trim().toLowerCase()    : ''
  const displayName = typeof body.display_name=== 'string' ? body.display_name.trim()              : ''
  const appRole     = typeof body.app_role    === 'string' ? body.app_role                         : 'user'

  const errors: Array<{ field: string; error: string }> = []
  if (!EMAIL_RE.test(email))        errors.push({ field: 'email',        error: 'invalid shape' })
  if (!USERNAME_RE.test(username))  errors.push({ field: 'username',     error: 'invalid shape' })
  if (displayName.length > 80)      errors.push({ field: 'display_name', error: 'length 0–80' })
  if (!ROLE_SET.has(appRole))       errors.push({ field: 'app_role',     error: 'must be admin|manager|user' })
  if (errors.length) return reply({ error: 'validation_failed', errors }, 400)

  // 3. Pre-flight: username already taken in this workspace?
  const { data: usernameHit } = await admin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', callerWorkspaceId)
    .eq('username', username)
    .maybeSingle()
  if (usernameHit) return reply({ error: 'username_taken' }, 409)

  // Fetch the workspace name + caller display_name for the email
  // template's .Data fields. Best-effort; we still send on miss.
  const { data: ws } = await admin
    .from('workspaces')
    .select('name')
    .eq('id', callerWorkspaceId)
    .maybeSingle()
  const { data: inviterRow } = await admin
    .from('workspace_members')
    .select('display_name, username')
    .eq('workspace_id', callerWorkspaceId)
    .eq('user_id', callerId)
    .maybeSingle()

  const companyName = ws?.name ?? 'your WILSON workspace'
  const inviterName = inviterRow?.display_name ?? inviterRow?.username ?? 'A teammate'

  // 4. Mint the invite. inviteUserByEmail creates (or re-sends to) the
  //    auth.users row AND triggers the invite template with the variables
  //    below available as {{ .Data.* }}.
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
    email,
    {
      data: {
        company_name: companyName,
        inviter_name: inviterName,
        username,
      },
      redirectTo: `${SITE_URL}/#/recovery`,  // ResetPasswordWizard gate
    },
  )
  if (inviteErr || !invited.user) {
    const taken = /already|duplicate/i.test(inviteErr?.message ?? '')
    return reply({
      error: taken ? 'email_taken' : 'invite_failed',
      detail: inviteErr?.message ?? 'unknown',
    }, taken ? 409 : 502)
  }

  // 5. Membership row with onboarded_at=null (so NewUserWelcome fires on
  //    first sign-in). Cleanup the orphan auth user if the insert fails.
  const { error: memErr } = await admin.from('workspace_members').insert({
    workspace_id: callerWorkspaceId,
    user_id:      invited.user.id,
    app_role:     appRole,
    username,
    display_name: displayName || username,
    is_active:    true,
  })
  if (memErr) {
    try { await admin.auth.admin.deleteUser(invited.user.id) } catch { /* best-effort */ }
    return reply({ error: 'membership_create_failed', detail: memErr.message }, 500)
  }

  // 6. Pre-seed app_metadata.workspace_id so the first JWT carries the
  //    right claim without an issue-session round trip.
  try {
    await admin.auth.admin.updateUserById(invited.user.id, {
      app_metadata: { workspace_id: callerWorkspaceId },
    })
  } catch { /* hook will fill it on first sign-in */ }

  return reply({
    user_id:      invited.user.id,
    email,
    username,
    app_role:     appRole,
    workspace_id: callerWorkspaceId,
  }, 201)
})
