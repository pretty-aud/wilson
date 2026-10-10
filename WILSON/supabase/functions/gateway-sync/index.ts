// =============================================================================
// gateway-sync — GW1 (post-overhaul, 2026-10-10): the gateway's heartbeat,
// every ten seconds and at once when a clip needs confirming
// (GATEWAY_DESIGN.md §2, §4, §5, §8, §9 point 4; Appendix C).
//
// In order:
//   1. the caller: the gateway's credential (requireGateway — its SHA-256
//      looked up, a revoked gateway refused at once: its answer to a 401 is
//      to close both doors)
//   2. the rate limit, per gateway, FAILING OPEN (D27: a limiter hiccup must
//      not close every customer's outside door): six heartbeats a minute and
//      thirty on-demand confirmations beyond them
//   3. the report's shape (gatewayShapes.parseSyncRequest: known fields only,
//      bounded; ≤ 100 clips to confirm)
//   4. the database's part, as the service role (gateway_sync_apply) — the
//      one read Appendix C gives the service role here: whether each clip
//      to confirm is a catalogued clip of THIS company at that location and
//      path (D22). It also applies the report, compares the call's source
//      address with the last one (R6: a change withdraws the published
//      address and begins a check), hands over a waiting reach nonce, and
//      answers the switch, the outside address, the office ranges, the live
//      signing keys and the locations.
//
// A check the database begins here rides this answer's nonce and is knocked
// on at the gateway's NEXT sync (GW1 review round 2, finding 8): the database
// hands it over then, once, and it is probed in the background after that
// answer has gone (EdgeRuntime.waitUntil), a second later. By then the
// gateway has had an answer carrying the nonce, so one answer lost on the way
// cannot read as "not your gateway".
// =============================================================================

import { isRateLimited, envInt } from '../_shared/rateLimit.ts'
import { answer, preflight, readJson, refusal, requireGateway, versionFloors, SYNC_INTERVAL_S } from '../_shared/gatewayGuard.ts'
import { clientAddress, parseSyncRequest, webAppOrigins } from '../_shared/gatewayShapes.ts'
import { ensureSigningKey } from '../_shared/gatewaySigning.ts'
import { runReachCheck, type BegunCheck } from '../_shared/gatewayReachRun.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return refusal(405, 'method_not_allowed', 'Use POST.')

  // 1. The caller.
  const guard = await requireGateway(req)
  if (!guard.ok) return guard.res
  const { admin, gatewayId, workspaceId } = guard.ctx

  // 2. The rate limit (fails open, D27).
  if (await isRateLimited(admin, 'gateway-sync', gatewayId, envInt('GATEWAY_SYNC_PER_MINUTE', 36), 60)) {
    return refusal(429, 'rate_limited', 'Too many syncs from this gateway this minute; the next heartbeat will do.')
  }

  // 3. The shape.
  const body = await readJson(req, 256 * 1024)
  if (body === null) return refusal(400, 'bad_request', 'The sync body is not JSON.')
  if (body.length > 256 * 1024) return refusal(413, 'too_large', 'A sync report is at most 256 KB.')
  const parsed = parseSyncRequest(body.value)
  if (!parsed.ok) return refusal(parsed.status, parsed.code, parsed.detail)

  // 4. The database's part.
  const { data, error } = await admin.rpc('gateway_sync_apply', {
    p_gateway: gatewayId,
    p_report: parsed.report,
    p_source: clientAddress(req.headers),
    p_confirm: parsed.confirm,
  })
  if (error) {
    console.error(`gateway-sync: ${error.code ?? ''} ${error.message}`)
    return refusal(503, 'sync_failed', 'WILSON could not take this sync just now; the gateway keeps its last answer and tries again.')
  }
  const r = (data ?? {}) as Record<string, unknown>
  if (r.revoked) {
    return refusal(401, 'revoked', 'This gateway was forgotten in Settings, so WILSON no longer answers it. Close both doors.')
  }

  let signingKeys = (r.signing_keys as Array<{ kid: string; public_key: string }>) ?? []
  if (signingKeys.length === 0) {
    try {
      const key = await ensureSigningKey(admin, workspaceId)
      signingKeys = [{ kid: key.kid, public_key: key.public_key }]
    } catch (e) {
      console.error(`gateway-sync: no signing key yet: ${(e as Error).message}`)
    }
  }

  const floors = versionFloors()
  const name = r.name as string
  const reply = answer({
    remote_viewing: r.remote_viewing === true,
    outside_address: r.outside_address ?? null,
    office_ranges: r.office_ranges ?? [],
    signing_keys: signingKeys,
    web_app_origins: webAppOrigins(Deno.env.get('WILSON_SITE_URL'), Deno.env.get('WILSON_GATEWAY_WEB_ORIGINS')),
    bin_locations: r.bin_locations ?? [],
    confirmed: r.confirmed ?? [],
    minimum_version: floors.minimum,
    hard_minimum_version: floors.hard,
    check_update_now: r.check_update_now === true,
    check_reach_now: r.check_reach_now === true,
    reach_nonce: r.reach_nonce ?? null,
    renamed: parsed.report.name !== name ? name : null,
    sync_interval_s: SYNC_INTERVAL_S,
  })

  const begun = r.background_check as BegunCheck | null
  if (begun && begun.check_id && begun.nonce && begun.address) {
    const task = runReachCheck(admin, gatewayId, begun, null, 1000).catch((e) =>
      console.error(`gateway-sync: background reach check failed: ${(e as Error).message}`))
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime
    if (typeof rt?.waitUntil === 'function') rt.waitUntil(task)
  }
  return reply
})
