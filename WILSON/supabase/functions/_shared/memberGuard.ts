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
//
// The second merger (OUTSTANDING F8-03): `{ withRole: true }` reads the row
// with its role (`app_role, is_active`), decides exactly as without it, and
// hands back what it learnt (`authenticated`), so a caller that asks the admin
// guard of the same request, or the caller's live role, asks neither GoTrue
// nor the row again. Only ai-files asks for it; every other caller's read is
// unchanged.
// =============================================================================

import { authenticate, liveMembership, reply, type Authenticated, type GuardClient } from './adminGuard.ts'

export type MemberContext = {
  admin: GuardClient
  callerId: string
  workspaceId: string
}

type GuardResult =
  | { ok: true; ctx: MemberContext; authenticated?: Authenticated }
  | { ok: false; res: Response }

export async function requireActiveMember(req: Request, opts: { withRole?: boolean } = {}): Promise<GuardResult> {
  const who = await authenticate(req)
  if (!who.ok) return { ok: false, res: reply({ error: 'unauthorized' }, 401) }
  const { admin, user, claims } = who.caller

  // Claims from the TOKEN payload (adminGuard rationale): workspace_id is
  // minted by custom_access_token_hook; only a best-effort copy lands in
  // raw_app_meta_data. Any ACTIVE member: the role is not asked.
  if (!claims.workspaceId) {
    return { ok: false, res: reply({ error: 'forbidden' }, 403) }
  }

  // Only is_active is read (with withRole, app_role beside it, never judged
  // here). A failed read is "no row": 403.
  const live = await liveMembership(admin, claims.workspaceId, user.id, { withRole: opts.withRole === true })
  const liveRow = live.row
  if (!liveRow || !liveRow.is_active) {
    return { ok: false, res: reply({ error: 'forbidden' }, 403) }
  }

  const ctx = { admin, callerId: user.id, workspaceId: claims.workspaceId }
  return opts.withRole === true
    ? { ok: true, ctx, authenticated: { caller: who.caller, live } }
    : { ok: true, ctx }
}
