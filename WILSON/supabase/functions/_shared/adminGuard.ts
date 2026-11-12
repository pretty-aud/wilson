// =============================================================================
// _shared/adminGuard.ts — Session 9
//
// Common plumbing for the Admin Terminal Edge Functions
// (admin-create-user / admin-reset-password / admin-set-active /
// admin-user-security). All of them:
//
//   * run with verify_jwt = false (the Edge gateway can't validate this
//     project's ES256 JWTs — same rationale as issue-session) and validate
//     the caller in-function via admin.auth.getUser(token);
//   * require app_role=admin in the JWT claims AND an ACTIVE admin row in
//     workspace_members (live-row check — a deactivated/demoted admin's
//     token keeps its claims for up to the TTL; the row is authoritative);
//   * enforce MFA step-up: when the caller has a verified TOTP factor, the
//     token must carry aal2 (403 mfa_required otherwise). Locked decision
//     #9 — MFA for all admin tiers — enforced where it matters most. Since
//     S15 a failure to ESTABLISH that state is refused too (503), rather
//     than waved through (§6 #17).
//
// Sibling guards: _shared/memberGuard.ts (any active member — ai-proxy) and
// _shared/operatorGuard.ts (the platform tier — the /wilsonadmin console,
// where MFA is a hard requirement rather than a conditional step-up).
//
// Also home to the show-once password generator (locked decision #8) and
// the best-effort app_events writer.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

export const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, apikey',
}

export function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const part = token.split('.')[1] ?? ''
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    return JSON.parse(atob(pad))
  } catch {
    return {}
  }
}

export type AdminContext = {
  admin: ReturnType<typeof createClient>
  callerId: string
  workspaceId: string
}

type GuardResult =
  | { ok: true; ctx: AdminContext }
  | { ok: false; res: Response }

export async function requireWorkspaceAdmin(req: Request): Promise<GuardResult> {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7)
    : ''
  if (!token) return { ok: false, res: reply({ error: 'unauthorized' }, 401) }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  const { data: caller, error: callerErr } = await admin.auth.getUser(token)
  if (callerErr || !caller.user) {
    return { ok: false, res: reply({ error: 'unauthorized' }, 401) }
  }

  // Claims come from the TOKEN payload, not the getUser() record:
  // app_role/workspace_id are minted by custom_access_token_hook into the
  // JWT and never persisted to raw_app_meta_data (only workspace_id gets
  // seeded there, best-effort). The token is already validated above, so
  // decoding its payload is safe.
  const payload = decodeJwtPayload(token)
  const pmd = (payload.app_metadata ?? {}) as Record<string, unknown>
  const md = caller.user.app_metadata ?? {}
  const workspaceId =
    typeof pmd.workspace_id === 'string' ? pmd.workspace_id :
    typeof md.workspace_id === 'string' ? md.workspace_id : null
  const claimRole = typeof pmd.app_role === 'string' ? pmd.app_role : null
  if (!workspaceId || claimRole !== 'admin') {
    return { ok: false, res: reply({ error: 'forbidden' }, 403) }
  }

  // Live-row check: claims can outlive a demotion/deactivation by the token
  // TTL; the membership row cannot.
  const { data: liveRow } = await admin
    .from('workspace_members')
    .select('app_role, is_active')
    .eq('workspace_id', workspaceId)
    .eq('user_id', caller.user.id)
    .maybeSingle()
  if (!liveRow || !liveRow.is_active || liveRow.app_role !== 'admin') {
    return { ok: false, res: reply({ error: 'forbidden' }, 403) }
  }

  // MFA step-up: enrolled admins must present an aal2 token.
  //
  // Session 15 (MASTER_PLAN §6 #17, TPN TS-1.6) — this block used to swallow
  // a listFactors failure and continue. That failed OPEN: an aal1 token
  // belonging to an enrolled admin got full admin-function access whenever
  // the GoTrue admin-MFA endpoint hiccuped, which is exactly the moment you
  // least want it. It now fails CLOSED. Note supabase-js reports most
  // failures on the `error` channel rather than throwing, so an unchecked
  // `error` would have been a second, quieter version of the same bug.
  //
  // Verified safe for CI: no job calls an adminGuard-backed function. The
  // Playwright auth lane exercises invite-member — which as of Session 17
  // routes through THIS guard too (§6 #46), so that lane now depends on a
  // GoTrue that can serve admin/mfa/listFactors. The seeded probe admin has
  // no verified factor, so hasVerified stays false and the aal2 gate never
  // fires; a listFactors outage would 503 the invite rather than pass it.
  let hasVerified = false
  try {
    const { data: factorData, error: factorErr } = await admin.auth.admin.mfa.listFactors({
      userId: caller.user.id,
    })
    if (factorErr) throw factorErr
    hasVerified = (factorData?.factors ?? []).some(
      (f: { factor_type?: string; status?: string }) =>
        f.factor_type === 'totp' && f.status === 'verified',
    )
  } catch {
    // 503: transient and retryable, unlike the 403s above. The caller cannot
    // fix this by enrolling or re-authenticating.
    return { ok: false, res: reply({ error: 'mfa_check_failed' }, 503) }
  }
  if (hasVerified && decodeJwtPayload(token).aal !== 'aal2') {
    return { ok: false, res: reply({ error: 'mfa_required' }, 403) }
  }

  // The stronger gate — refuse admins who have never enrolled at all — is
  // OPT-IN via WILSON_REQUIRE_ADMIN_MFA. It is off by default deliberately:
  // turning it on locks every un-enrolled admin out of the Admin Terminal in
  // that environment, and whether Audrey and the existing prod admins hold
  // verified TOTP factors is not something this session can verify from
  // here. Flipping the secret is a one-line change once enrolment is
  // confirmed — see docs/OWED_AUDREY.md. Until then TPN-AUTH-003 stays
  // partially remediated rather than being claimed on an assumption.
  if (!hasVerified && (Deno.env.get('WILSON_REQUIRE_ADMIN_MFA') ?? '') === '1') {
    return { ok: false, res: reply({ error: 'mfa_enrollment_required' }, 403) }
  }

  return { ok: true, ctx: { admin, callerId: caller.user.id, workspaceId } }
}

// Show-once credential generator (locked decision #8). Unambiguous charset
// (no 0/O/1/l/I), rejection-sampled so every character is uniform.
const PW_CHARSET =
  'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789-#'

export function generatePassword(length = 20): string {
  const out: string[] = []
  const max = 256 - (256 % PW_CHARSET.length)
  while (out.length < length) {
    const buf = new Uint8Array(length * 2)
    crypto.getRandomValues(buf)
    for (const b of buf) {
      if (b < max && out.length < length) out.push(PW_CHARSET[b % PW_CHARSET.length])
    }
  }
  return out.join('')
}

// Best-effort admin audit event. Service-role insert: the 0021 stamp trigger
// trusts our actor stamp and fills the label.
export async function logAdminEvent(
  ctx: AdminContext,
  fields: { code: string; message: string; context?: Record<string, unknown> },
): Promise<void> {
  try {
    await ctx.admin.from('app_events').insert({
      workspace_id: ctx.workspaceId,
      actor_user_id: ctx.callerId,
      event_type: 'admin',
      code: fields.code,
      severity: 'info',
      message: fields.message,
      context: fields.context ?? {},
    })
  } catch {
    // Logging never blocks the action.
  }
}
