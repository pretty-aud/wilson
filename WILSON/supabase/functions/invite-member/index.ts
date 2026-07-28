// =============================================================================
// invite-member Edge Function
//
// Admin-only. Called by TeamMembersPage's "Invite user" dialog. Takes an
// email + workspace-scoped username + optional display_name + app_role,
// and:
//   1. Verifies the caller is an admin of the active workspace via the
//      JWT's app_metadata.app_role claim. Service-role side-channel
//      forbidden; we only trust the signed token from the authenticated
//      client.
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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Where the invite link lands when the invitee clicks through the email.
// Falls back to SUPABASE_URL so the function still works in environments
// where WILSON_SITE_URL isn't set (local dev), though the redirect then
// bounces off the Supabase default and back to site_url in config.toml.
const SITE_URL = Deno.env.get('WILSON_SITE_URL') ?? 'http://localhost:5203'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, apikey',
}

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const ROLE_SET    = new Set(['admin', 'manager', 'user'])

type Body = {
  email?: string
  username?: string
  display_name?: string
  app_role?: 'admin' | 'manager' | 'user'
}

function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)

  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7)
    : ''
  if (!token) return reply({ error: 'unauthorized' }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  // 1. Resolve + verify caller. admin.auth.getUser(token) gives us the
  //    user_id and app_metadata (including workspace_id + app_role baked
  //    by the custom_access_token_hook).
  const { data: caller, error: callerErr } = await admin.auth.getUser(token)
  if (callerErr || !caller.user) return reply({ error: 'unauthorized' }, 401)

  // Session 9: claims live in the TOKEN payload (custom_access_token_hook),
  // not the getUser() record — decode the already-validated JWT.
  const payload = (() => {
    try {
      const part = token.split('.')[1] ?? ''
      const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
      return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)))
    } catch { return {} }
  })()
  const pmd = payload.app_metadata ?? {}
  const md = caller.user.app_metadata ?? {}
  const callerWorkspaceId =
    typeof pmd.workspace_id === 'string' ? pmd.workspace_id :
    typeof md.workspace_id === 'string' ? md.workspace_id : null
  const callerRole = typeof pmd.app_role === 'string' ? pmd.app_role : null
  if (!callerWorkspaceId || callerRole !== 'admin') {
    return reply({ error: 'forbidden' }, 403)
  }

  // Session 9: live-row check — claims outlive a demotion/deactivation by up
  // to the token TTL; the membership row is authoritative.
  const { data: callerRow } = await admin
    .from('workspace_members')
    .select('app_role, is_active')
    .eq('workspace_id', callerWorkspaceId)
    .eq('user_id', caller.user.id)
    .maybeSingle()
  if (!callerRow || !callerRow.is_active || callerRow.app_role !== 'admin') {
    return reply({ error: 'forbidden' }, 403)
  }

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
    .eq('user_id', caller.user.id)
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
