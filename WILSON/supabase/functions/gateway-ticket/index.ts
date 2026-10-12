// =============================================================================
// gateway-ticket — GW1 (post-overhaul, 2026-10-10): the web app asks for
// two-minute, one-clip tickets to play bin clips through a gateway
// (GATEWAY_DESIGN.md §5 steps 1–4; D1, D5; Appendix C).
//
// 🚨 THIS IS AN AUTHORISATION BOUNDARY, storage-presign's kind: a ticket is
// bearer authority over one clip on one gateway for two minutes, so minting
// one for a clip the caller may not read would make this a signing oracle.
// In order:
//
//   1. the caller: requireActiveMember — GoTrue validates the sign-in token
//      AND the live workspace_members row must be active (not the claim
//      alone, TPN-AUTH-008)
//   2. the rate limit, per person, FAILING OPEN (D27, as storage-presign
//      does: every mint is already bounded by the caller's own RLS, and a
//      limiter that failed closed would end every playback of every
//      customer on one database hiccup)
//   3. the shape: a gateway id and 1–50 clip ids
//   4. the predicates, EVALUATED AS THE CALLER (the S33 rule): a client
//      carrying the caller's own token reads gateways_visible (the gateway is
//      the caller's company's, live, its fingerprint confirmed) and calls
//      gateway_clips_for_tickets, SECURITY INVOKER over bin_files' RLS — a
//      clip the caller cannot see is simply absent and answered `missing`,
//      exactly as one that does not exist (no oracle). Never the service
//      role.
//   5. the workspace equality ASSERTED per row (F23): the clip's, the
//      caller's and the gateway's company must be one; one refusal if not
//   6. the mint: the company's Ed25519 key opened for this call
//      (gatewaySigning.ts), the claims in the wire's order, rv from the
//      switch per row; every mint RECORDED in gateway_ticket_mints before
//      any ticket is answered (no tickets without their record, F3)
//
// The answer: { tickets: { <bin_file_id>: ticket }, missing: [id],
// refused: [{ id, reason }], expires_at }. `refused` names a clip the caller
// may read but that cannot travel as a ticket (its path would make the
// ticket longer than the gateway reads, 4096 characters).
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { requireActiveMember } from '../_shared/memberGuard.ts'
import { isRateLimited, envInt } from '../_shared/rateLimit.ts'
import { answer, preflight, readJson, refusal, withMemberSentence, versionFloors } from '../_shared/gatewayGuard.ts'
import { compareVersions, parseTicketRequest } from '../_shared/gatewayShapes.ts'
import { buildClaims, signTicket, TICKET_MAX_LENGTH, TICKET_TTL_SECONDS } from '../_shared/gatewayTicket.ts'
import { makeJti } from '../_shared/gatewayWire.ts'
import { signingKeyFor } from '../_shared/gatewaySigning.ts'
import { GatewayKeyCryptoUnavailable } from '../_shared/gatewayKeyCrypto.ts'

type ClipRow = {
  bin_file_id: string
  project_id: string
  workspace_id: string
  location_id: string
  relative_path: string
  is_sequence: boolean
  mime_type: string | null
  file_name: string | null
  remote_viewing: boolean
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return refusal(405, 'method_not_allowed', 'Use POST.')

  // 1. The caller: a live, active member.
  const guard = await requireActiveMember(req)
  if (!guard.ok) return withMemberSentence(guard.res)
  const ctx = guard.ctx

  // 2. The rate limit (fails open, D27).
  if (await isRateLimited(ctx.admin, 'gateway-ticket', ctx.callerId, envInt('GATEWAY_TICKET_PER_MINUTE', 60), 60)) {
    return refusal(429, 'rate_limited', 'Too many ticket requests this minute; wait a moment and press play again.')
  }

  // 3. The shape.
  const body = await readJson(req, 16 * 1024)
  if (body === null) return refusal(400, 'bad_request', 'The request body is not JSON.')
  const parsed = parseTicketRequest(body.value)
  if (!parsed.ok) return refusal(parsed.status, parsed.code, parsed.detail)

  // 4. The predicates, as the caller (the S33 rule).
  const token = (req.headers.get('authorization') ?? '').slice(7)
  const asCaller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: gateway, error: gwErr } = await asCaller
    .from('gateways_visible')
    .select('id, workspace_id, version')
    .eq('id', parsed.gatewayId)
    .maybeSingle()
  if (gwErr) {
    return refusal(503, 'gateway_check_failed', 'WILSON could not check the gateway just now; press play again in a moment.')
  }
  if (!gateway) {
    return refusal(404, 'gateway_unavailable', "That gateway is not available to you: it was forgotten, it is another company's, or its fingerprint has not been confirmed yet.")
  }
  if (compareVersions(gateway.version as string, versionFloors().hard) < 0) {
    return refusal(409, 'gateway_too_old', "This gateway's version must be updated before it can serve clips (Settings, Storage, File gateway).")
  }
  const { data: rows, error: clipErr } = await asCaller.rpc('gateway_clips_for_tickets', { p_ids: parsed.ids })
  if (clipErr) {
    return refusal(503, 'clip_check_failed', 'WILSON could not check these clips just now; press play again in a moment.')
  }
  const visible = (rows ?? []) as ClipRow[]

  // 5. One company, asserted (F23).
  if (gateway.workspace_id !== ctx.workspaceId
      || visible.some((row) => row.workspace_id !== ctx.workspaceId)) {
    console.error(`gateway-ticket: workspace mismatch for caller ${ctx.callerId}`)
    return refusal(403, 'workspace_mismatch', "These clips, this gateway and your sign-in do not belong to one company, so no ticket was made.")
  }

  // 6. The mint, recorded before it is answered.
  const found = new Set(visible.map((row) => row.bin_file_id))
  const missing = parsed.ids.filter((id) => !found.has(id))
  if (visible.length === 0) {
    return answer({ tickets: {}, missing, refused: [], expires_at: null })
  }
  let key: { kid: string; privateKey: CryptoKey }
  try {
    key = await signingKeyFor(ctx.admin, ctx.workspaceId)
  } catch (e) {
    if (e instanceof GatewayKeyCryptoUnavailable) {
      return refusal(503, 'crypto_unavailable', 'WILSON_GATEWAY_KEY_SECRET is not configured on this environment, so no ticket can be signed.')
    }
    console.error(`gateway-ticket: ${(e as Error).message}`)
    return refusal(503, 'key_unavailable', 'WILSON could not open the ticket key just now; press play again in a moment.')
  }
  const iat = Math.floor(Date.now() / 1000)
  const tickets: Record<string, string> = {}
  const refused: Array<{ id: string; reason: string }> = []
  const mints: Array<Record<string, unknown>> = []
  for (const row of visible) {
    let ticket: string
    const jti = makeJti()
    try {
      ticket = await signTicket(key.privateKey, buildClaims({
        kid: key.kid, gw: gateway.id as string, ws: ctx.workspaceId, sub: ctx.callerId,
        clip: row.bin_file_id, loc: row.location_id, path: row.relative_path, seq: row.is_sequence,
        mt: row.mime_type, rv: row.remote_viewing === true, iat, jti,
      }))
    } catch {
      refused.push({ id: row.bin_file_id, reason: 'not_playable' })
      continue
    }
    if (ticket.length > TICKET_MAX_LENGTH) {
      refused.push({ id: row.bin_file_id, reason: 'too_long' })
      continue
    }
    tickets[row.bin_file_id] = ticket
    mints.push({
      jti, workspace_id: ctx.workspaceId, gateway_id: gateway.id, user_id: ctx.callerId,
      bin_file_id: row.bin_file_id, project_id: row.project_id, file_name: (row.file_name ?? '').slice(0, 500),
    })
  }
  if (mints.length > 0) {
    const { error: mintErr } = await ctx.admin.from('gateway_ticket_mints').insert(mints)
    if (mintErr) {
      console.error(`gateway-ticket: mint log failed: ${mintErr.message}`)
      return refusal(503, 'mint_log_failed', 'WILSON could not record these tickets, so it did not hand them out; press play again in a moment.')
    }
  }
  return answer({
    tickets,
    missing,
    refused,
    expires_at: new Date((iat + TICKET_TTL_SECONDS) * 1000).toISOString(),
  })
})
