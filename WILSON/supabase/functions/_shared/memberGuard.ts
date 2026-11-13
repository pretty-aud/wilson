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
//
// F8 (wave 2, 2026-11-13): composed from adminGuard.ts's shared pieces:
// authenticate (the bearer, GoTrue, the claims) and liveMembership WITHOUT
// withRole (the select stays `is_active` alone). What stays its own: no role
// is asked, no MFA, and the refusals and their order below.
// =============================================================================

import { authenticate, liveMembership, reply, type GuardClient } from './adminGuard.ts'

export type MemberContext = {
  admin: GuardClient
  callerId: string
  workspaceId: string
}

type GuardResult =
  | { ok: true; ctx: MemberContext }
  | { ok: false; res: Response }

export async function requireActiveMember(req: Request): Promise<GuardResult> {
  const who = await authenticate(req)
  if (!who.ok) return { ok: false, res: reply({ error: 'unauthorized' }, 401) }
  const { admin, user, claims } = who.caller

  // Claims from the TOKEN payload (adminGuard rationale): workspace_id is
  // minted by custom_access_token_hook; only a best-effort copy lands in
  // raw_app_meta_data. Any ACTIVE member: the role is not asked.
  if (!claims.workspaceId) {
    return { ok: false, res: reply({ error: 'forbidden' }, 403) }
  }

  // Only is_active is read. A failed read is "no row": 403.
  const { row: liveRow } = await liveMembership(admin, claims.workspaceId, user.id)
  if (!liveRow || !liveRow.is_active) {
    return { ok: false, res: reply({ error: 'forbidden' }, 403) }
  }

  return { ok: true, ctx: { admin, callerId: user.id, workspaceId: claims.workspaceId } }
}
