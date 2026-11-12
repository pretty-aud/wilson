// =============================================================================
// admin-set-active Edge Function — Session 9 (Admin Terminal)
//
// Admin-only deactivate / reactivate with TOKEN REVOCATION (the Session 4
// deferral). Deactivation is three layers deep:
//   1. workspace_members.is_active = false — the 0020 read-alignment makes
//      every table read AND the workspace channel deny immediately, even
//      while the old access token is still technically valid;
//   2. GoTrue ban (ban_duration) — refresh stops working, so the session
//      dies for good within the access-token TTL. Ban only when the user
//      has NO other active workspace membership (multi-workspace safety);
//   3. best-effort global sign-out of the user's refresh-token family.
//
// Last-admin protection is enforced twice: a friendly pre-check here (409
// last_admin) and the 0020 DB trigger as the real backstop.
// =============================================================================

import {
  corsHeaders,
  reply,
  requireWorkspaceAdmin,
  logAdminEvent,
} from '../_shared/adminGuard.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)

  const guard = await requireWorkspaceAdmin(req)
  if (!guard.ok) return guard.res
  const { admin, workspaceId, callerId } = guard.ctx

  let body: { user_id?: string; active?: boolean }
  try { body = await req.json() } catch { return reply({ error: 'bad_json' }, 400) }
  const userId = typeof body.user_id === 'string' ? body.user_id : ''
  const active = body.active
  if (!userId || typeof active !== 'boolean') {
    return reply({
      error: 'validation_failed',
      errors: [{ field: !userId ? 'user_id' : 'active', error: 'required' }],
    }, 400)
  }

  const { data: target } = await admin
    .from('workspace_members')
    .select('username, app_role, is_active')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!target) return reply({ error: 'not_found' }, 404)

  if (target.is_active === active) {
    return reply({ user_id: userId, active, changed: false }, 200)
  }

  // Friendly last-admin pre-check (the 0020 trigger is the backstop).
  if (!active && target.app_role === 'admin' && target.is_active) {
    const { count } = await admin
      .from('workspace_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('app_role', 'admin')
      .eq('is_active', true)
      .neq('user_id', userId)
    if ((count ?? 0) === 0) return reply({ error: 'last_admin' }, 409)
  }

  const { error: updErr } = await admin
    .from('workspace_members')
    .update({ is_active: active })
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
  if (updErr) {
    if (/last active admin/i.test(updErr.message)) {
      return reply({ error: 'last_admin' }, 409)
    }
    return reply({ error: 'update_failed', detail: updErr.message }, 500)
  }

  // Ban / unban with multi-workspace safety.
  let banned = false
  const { data: memberships } = await admin
    .from('workspace_members')
    .select('workspace_id, is_active')
    .eq('user_id', userId)
  const otherActive = (memberships ?? []).filter(
    (m: { workspace_id: string; is_active: boolean }) =>
      m.is_active && m.workspace_id !== workspaceId,
  )

  try {
    if (!active && otherActive.length === 0) {
      await admin.auth.admin.updateUserById(userId, { ban_duration: '87600h' })
      banned = true
      // Best-effort revocation of the refresh-token family. Endpoint
      // availability varies by GoTrue version; failures are fine — the ban
      // already stops refresh, and RLS already went dark.
      try {
        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}/logout`, {
          method: 'POST',
          headers: { apikey: SERVICE_ROLE, authorization: `Bearer ${SERVICE_ROLE}` },
        })
      } catch { /* best-effort */ }
    } else if (active) {
      await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' })
    }
  } catch { /* ban is defense-in-depth; is_active already flipped */ }

  // If the deactivated user's active-workspace claim points here, repoint it
  // at another live membership so their next refresh (multi-workspace users)
  // lands somewhere valid.
  if (!active && otherActive.length > 0) {
    try {
      await admin.auth.admin.updateUserById(userId, {
        app_metadata: { workspace_id: otherActive[0].workspace_id },
      })
    } catch { /* hook re-derives on next issue-session */ }
  }

  await logAdminEvent(guard.ctx, {
    code: active ? 'WIL-4104' : 'WIL-4103',
    message: `${active ? 'Reactivated' : 'Deactivated'} "${target.username}"`,
    context: { target_user_id: userId, by: callerId, banned },
  })

  return reply({ user_id: userId, active, changed: true, banned }, 200)
})
