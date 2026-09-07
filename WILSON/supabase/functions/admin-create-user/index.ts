// =============================================================================
// admin-create-user Edge Function — Session 9 (Admin Terminal)
//
// Admin-only. Creates a workspace member WITH credentials (the brief's
// "create users" path, distinct from invite-member's email invite):
//   * generates a strong show-once password server-side (locked decision
//     #8: passwords are show-once at creation, never visible afterward);
//   * email is OPTIONAL — when absent we synthesize a non-deliverable
//     address on the workspace's behalf (username-first login doesn't need
//     a real inbox; forgot-password then simply isn't available and the
//     admin resets instead);
//   * seats the member with onboarded_at=null so NewUserWelcome fires on
//     their first sign-in, and applies the Session 9 rate-card grants.
//
// The 201 response carries the password ONCE. It is never persisted
// anywhere WILSON can read back.
// =============================================================================

import {
  corsHeaders,
  reply,
  requireWorkspaceAdmin,
  generatePassword,
  logAdminEvent,
} from '../_shared/adminGuard.ts'

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const ROLE_SET = new Set(['admin', 'manager', 'user'])

type Body = {
  username?: string
  display_name?: string
  app_role?: 'admin' | 'manager' | 'user'
  email?: string
  grant_rate_card_view?: boolean
  grant_rate_card_edit?: boolean
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)

  const guard = await requireWorkspaceAdmin(req)
  if (!guard.ok) return guard.res
  const { admin, workspaceId } = guard.ctx

  let body: Body
  try { body = await req.json() } catch { return reply({ error: 'bad_json' }, 400) }

  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
  const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : ''
  const appRole = typeof body.app_role === 'string' ? body.app_role : 'user'
  const emailIn = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const grantView = body.grant_rate_card_view === true
  const grantEdit = body.grant_rate_card_edit === true

  const errors: Array<{ field: string; error: string }> = []
  if (!USERNAME_RE.test(username)) errors.push({ field: 'username', error: 'invalid shape' })
  if (displayName.length > 80) errors.push({ field: 'display_name', error: 'length 0–80' })
  if (!ROLE_SET.has(appRole)) errors.push({ field: 'app_role', error: 'must be admin|manager|user' })
  if (emailIn && !EMAIL_RE.test(emailIn)) errors.push({ field: 'email', error: 'invalid shape' })
  if (errors.length) return reply({ error: 'validation_failed', errors }, 400)

  const { data: usernameHit } = await admin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('username', username)
    .maybeSingle()
  if (usernameHit) return reply({ error: 'username_taken' }, 409)

  // Synthesized addresses are unique per (workspace, username) and land on
  // a domain we control; they exist only to satisfy GoTrue's email shape.
  // Local part must stay a valid dotted-atom: collapse runs of non-alnum to
  // single dots and trim edge dots (usernames like 'a__b.' would otherwise
  // synthesize an RFC-invalid address and 502).
  const emailSynthesized = !emailIn
  const localSafe = username.replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') || 'user'
  const email = emailIn ||
    `wilson.${workspaceId.slice(0, 8)}.${localSafe}@mail.petalstudios.co`

  const password = generatePassword()

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName || username, username },
    app_metadata: { workspace_id: workspaceId },
  })
  if (createErr || !created.user) {
    const taken = /already|duplicate/i.test(createErr?.message ?? '')
    return reply({
      error: taken ? 'email_taken' : 'create_failed',
      detail: createErr?.message ?? 'unknown',
    }, taken ? 409 : 502)
  }

  const { error: memErr } = await admin.from('workspace_members').insert({
    workspace_id: workspaceId,
    user_id: created.user.id,
    app_role: appRole,
    username,
    display_name: displayName || username,
    is_active: true,
    grant_rate_card_view: grantView,
    grant_rate_card_edit: grantEdit,
  })
  if (memErr) {
    try { await admin.auth.admin.deleteUser(created.user.id) } catch { /* best-effort */ }
    return reply({ error: 'membership_create_failed', detail: memErr.message }, 500)
  }

  await logAdminEvent(guard.ctx, {
    code: 'WIL-4101',
    message: `Created user "${username}" (${appRole})`,
    context: { target_user_id: created.user.id, app_role: appRole, email_synthesized: emailSynthesized },
  })

  return reply({
    user_id: created.user.id,
    username,
    email,
    email_synthesized: emailSynthesized,
    app_role: appRole,
    password, // show-once — never retrievable again
  }, 201)
})
