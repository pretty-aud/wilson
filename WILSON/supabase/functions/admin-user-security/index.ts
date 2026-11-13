// =============================================================================
// admin-user-security Edge Function — Session 9 (Admin Terminal)
//
// Admin-only, read-only. Security posture for one member of the caller's
// workspace: email, last sign-in, ban state, MFA enrollment. Feeds the
// user-detail panel's Security block. Never returns secrets.
//
// F8 (wave 2, 2026-11-13): the TARGET's factor read is adminGuard's
// hasVerifiedTotp, the block the guards share. Here a read that fails (its
// error channel or a throw) is reported as unenrolled, as it always was: this
// is a READ of a posture, never a gate, so it must not refuse as the guards do.
// =============================================================================

import { corsHeaders, hasVerifiedTotp, reply, requireWorkspaceAdmin } from '../_shared/adminGuard.ts'
import { readBodyJson, SMALL_JSON_MAX_BYTES, TOO_LARGE } from '../_shared/gatewayWire.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)

  const guard = await requireWorkspaceAdmin(req)
  if (!guard.ok) return guard.res
  const { admin, workspaceId } = guard.ctx

  // F8: read under a cap (largest real body 50 bytes). Past it: 413. Not
  // JSON: the old bad_json. The value is handed on untouched (JSON null still throws below, F8-05).
  let body: { user_id?: string }
  const sent = await readBodyJson(req, SMALL_JSON_MAX_BYTES)
  if (sent.kind === 'too_large') return reply({ ...TOO_LARGE }, 413)
  if (sent.kind === 'not_json') return reply({ error: 'bad_json' }, 400)
  body = sent.value as { user_id?: string }
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

  // MFA API unavailable → report unenrolled.
  const totp = await hasVerifiedTotp(admin, userId)
  const factorCount = totp.ok ? totp.count : 0

  const u: { email?: unknown; last_sign_in_at?: unknown; banned_until?: unknown } = userData.user
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
