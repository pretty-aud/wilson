// =============================================================================
// gateway-events — GW1 (post-overhaul, 2026-10-10): a gateway posts the
// viewings that went out through its OUTSIDE door, from its journal, in
// batches (GATEWAY_DESIGN.md §6; Appendix C). Office viewing writes nothing
// (her G6).
//
// In order:
//   1. the caller: the gateway's credential (requireGateway)
//   2. the rate limit, per gateway, FAILING CLOSED (D27): the journal
//      retries, and an audit flood must not land because the limiter could
//      not count
//   3. the batch's shape: ≤ 200 rows, ≤ 512 KB
//   4. the database's part, as the service role (gateway_events_apply): every
//      attribution DERIVED, never taken from the payload (F3) — the gateway
//      and company from the credential's row, the clip's project and name
//      from bin_files (or its mint, for a clip removed since), the viewer's
//      label from workspace_members; a clip or viewer not of this company
//      refused, a jti naming another viewer, clip or gateway refused, a pair
//      never minted within thirty days refused, a missing or aged-out mint
//      written flagged unverified_mint (R4); external_id is
//      '<this gateway>:<viewing_id>' (F9), so a retried batch writes nothing
//      twice; every string truncated (F10).
//
// The answer, { accepted: [viewing_id], rejected: [{ viewing_id, reason }] },
// tells the journal what it may delete: accepted rows (a retry of one already
// written is accepted again), and rejected rows, which will never land.
// =============================================================================

import { isRateLimited, envInt } from '../_shared/rateLimit.ts'
import { answer, preflight, readJson, refusal, requireGateway } from '../_shared/gatewayGuard.ts'
import { parseEventsRequest } from '../_shared/gatewayShapes.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return refusal(405, 'method_not_allowed', 'Use POST.')

  // 1. The caller.
  const guard = await requireGateway(req)
  if (!guard.ok) return guard.res
  const { admin, gatewayId } = guard.ctx

  // 2. The rate limit (fails CLOSED, D27).
  if (await isRateLimited(admin, 'gateway-events', gatewayId,
      envInt('GATEWAY_EVENTS_PER_MINUTE', 30), 60, { failOpen: false })) {
    return refusal(429, 'rate_limited', 'Too many event batches from this gateway this minute; the journal keeps them and tries again.')
  }

  // 3. The shape.
  const body = await readJson(req, 512 * 1024)
  if (body === null) return refusal(400, 'bad_request', 'The events body is not JSON.')
  const parsed = parseEventsRequest(body.value, body.length)
  if (!parsed.ok) return refusal(parsed.status, parsed.code, parsed.detail)

  // 4. The database's part: derive, check, write.
  const { data, error } = await admin.rpc('gateway_events_apply', { p_gateway: gatewayId, p_rows: parsed.rows })
  if (error) {
    if (error.code === '42501') {
      return refusal(401, 'revoked', 'This gateway was forgotten in Settings, so WILSON no longer takes its viewings.')
    }
    console.error(`gateway-events: ${error.code ?? ''} ${error.message}`)
    return refusal(503, 'events_failed', 'WILSON could not write these viewings just now; the journal keeps them and tries again.')
  }
  const r = (data ?? {}) as Record<string, unknown>
  return answer({ accepted: r.accepted ?? [], rejected: r.rejected ?? [] })
})
