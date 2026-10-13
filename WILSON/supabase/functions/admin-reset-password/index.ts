// =============================================================================
// admin-reset-password Edge Function — Session 9 (Admin Terminal)
//
// Admin-only. Generates a fresh show-once password for a member of the
// caller's workspace (locked decision #8: admins RESET, never read).
// Works for deactivated members too (reset-then-reactivate flows).
// =============================================================================

import {
  corsHeaders,
  reply,
  requireWorkspaceAdmin,
  generatePassword,
  logAdminEvent,
} from '../_shared/adminGuard.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)

  const guard = await requireWorkspaceAdmin(req)
  if (!guard.ok) return guard.res
  const { admin, workspaceId } = guard.ctx

  let body: { user_id?: string }
  try { body = await req.json() } catch { return reply({ error: 'bad_json' }, 400) }
  const userId = typeof body.user_id === 'string' ? body.user_id : ''
  if (!userId) return reply({ error: 'validation_failed', errors: [{ field: 'user_id', error: 'required' }] }, 400)

  // The target must be a member of the CALLER's workspace — admins cannot
  // reset arbitrary auth users.
  const { data: target } = await admin
    .from('workspace_members')
    .select('username')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!target) return reply({ error: 'not_found' }, 404)

  const password = generatePassword()
  const { error: updErr } = await admin.auth.admin.updateUserById(userId, { password })
  if (updErr) return reply({ error: 'reset_failed', detail: updErr.message }, 502)

  await logAdminEvent(guard.ctx, {
    code: 'WIL-4102',
    message: `Reset password for "${target.username}"`,
    context: { target_user_id: userId },
  })

  return reply({
    user_id: userId,
    username: target.username,
    password, // show-once — never retrievable again
  }, 200)
})
