// =============================================================================
// admin-user-security Edge Function — Session 9 (Admin Terminal)
//
// Admin-only, read-only. Security posture for one member of the caller's
// workspace: email, last sign-in, ban state, MFA enrollment. Feeds the
// user-detail panel's Security block. Never returns secrets.
// =============================================================================

import { corsHeaders, reply, requireWorkspaceAdmin } from '../_shared/adminGuard.ts'

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

  const { data: target } = await admin
    .from('workspace_members')
    .select('username, is_active')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!target) return reply({ error: 'not_found' }, 404)

  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(userId)
  if (userErr || !userData.user) return reply({ error: 'lookup_failed' }, 502)

  let factorCount = 0
  try {
    const { data: factorData } = await admin.auth.admin.mfa.listFactors({ userId })
    factorCount = (factorData?.factors ?? []).filter(
      (f: { factor_type?: string; status?: string }) =>
        f.factor_type === 'totp' && f.status === 'verified',
    ).length
  } catch { /* MFA API unavailable → report unenrolled */ }

  const u = userData.user as Record<string, unknown>
  return reply({
    user_id: userId,
    username: target.username,
    is_active: target.is_active,
    email: (u.email as string) ?? null,
    last_sign_in_at: (u.last_sign_in_at as string) ?? null,
    banned_until: (u.banned_until as string) ?? null,
    mfa_enrolled: factorCount > 0,
    factor_count: factorCount,
  }, 200)
})
