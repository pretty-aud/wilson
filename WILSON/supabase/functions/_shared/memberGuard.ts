// =============================================================================
// _shared/memberGuard.ts — Session 12
//
// Caller validation for MEMBER-level Edge Functions (ai-proxy). Same model
// as adminGuard.ts (verify_jwt=false; the gateway can't validate this
// project's ES256 JWTs), with two deliberate differences:
//
//   * any ACTIVE member qualifies — app_role is not checked. The live
//     workspace_members row is still authoritative: a deactivated member's
//     token keeps its claims for up to the TTL, and ai-proxy is a spend
//     endpoint, so the row check is what stops them spending money.
//   * no MFA step-up. That gate exists for admin ACTIONS; enrolled users
//     are already TOTP-challenged at sign-in by GoTrue, and demanding aal2
//     for every AI call would break nothing-sensitive member flows.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders, decodeJwtPayload, reply } from './adminGuard.ts'

export type MemberContext = {
  admin: ReturnType<typeof createClient>
  callerId: string
  workspaceId: string
}

type GuardResult =
  | { ok: true; ctx: MemberContext }
  | { ok: false; res: Response }

export async function requireActiveMember(req: Request): Promise<GuardResult> {
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

  // Claims from the TOKEN payload (adminGuard rationale): workspace_id is
  // minted by custom_access_token_hook; only a best-effort copy lands in
  // raw_app_meta_data.
  const payload = decodeJwtPayload(token)
  const pmd = (payload.app_metadata ?? {}) as Record<string, unknown>
  const md = caller.user.app_metadata ?? {}
  const workspaceId =
    typeof pmd.workspace_id === 'string' ? pmd.workspace_id :
    typeof md.workspace_id === 'string' ? md.workspace_id : null
  if (!workspaceId) {
    return { ok: false, res: reply({ error: 'forbidden' }, 403) }
  }

  const { data: liveRow } = await admin
    .from('workspace_members')
    .select('is_active')
    .eq('workspace_id', workspaceId)
    .eq('user_id', caller.user.id)
    .maybeSingle()
  if (!liveRow || !liveRow.is_active) {
    return { ok: false, res: reply({ error: 'forbidden' }, 403) }
  }

  return { ok: true, ctx: { admin, callerId: caller.user.id, workspaceId } }
}
