// =============================================================================
// gateway-enrol — GW1 (post-overhaul, 2026-10-10): a gateway enrols itself
// with the one-use token an admin made in Settings (GATEWAY_DESIGN.md §2 step
// 3; Appendix C).
//
// The caller is a GATEWAY holding an enrolment token (wgt_ + 32 base32, the
// wire), not a person: there is no sign-in here, so the token IS the
// credential for this one call, and the limiter is the only volume control.
// In order (the house order every gateway function keeps):
//
//   1. the caller: the token's SHAPE (Bearer, or `token` in the body); no
//      database is touched for a malformed one
//   2. the rate limit, per caller address, FAILING CLOSED (D27,
//      `failOpen: false`: a pre-authentication endpoint, resolve-login's
//      posture — a limiter that cannot count refuses)
//   3. the body's shape: platform, version, one PEM certificate (never a
//      key), inside addresses filtered to what the database admits
//   4. the predicate: gateway_enrol_apply (service role — there is no user
//      to act as) spends the token in ONE UPDATE … RETURNING (F14), creates
//      the gateway with the fingerprint the DATABASE computes from the PEM,
//      and stores only the SHA-256 of the credential made here
//
// The credential (`wgc_` + 43 base64url) is answered ONCE and never stored or
// logged; the token is spent whether or not the gateway keeps the answer, so
// a token seen twice is a token stolen (§2). The workspace's first signing
// key is made here if it has none, so `signing_keys` is never empty for a
// gateway that enrolled after the secret was set.
//
// verify_jwt = false (config.toml): the caller has no sign-in token at all.
// =============================================================================

import { isRateLimited, envInt } from '../_shared/rateLimit.ts'
import { answer, preflight, refusal, serviceClient, readJson, SYNC_INTERVAL_S } from '../_shared/gatewayGuard.ts'
import { clientAddress, parseEnrolRequest, webAppOrigins } from '../_shared/gatewayShapes.ts'
import { makeCredential, sha256Hex } from '../_shared/gatewayWire.ts'
import { ensureSigningKey } from '../_shared/gatewaySigning.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return refusal(405, 'method_not_allowed', 'Use POST.')

  // 1. The caller: the token's shape first — nothing else is read for a
  //    request that cannot be an enrolment.
  const body = await readJson(req, 64 * 1024)
  const parsed = parseEnrolRequest(req.headers.get('authorization'), body?.value)
  if (!parsed.ok && parsed.code === 'token_malformed') return refusal(parsed.status, parsed.code, parsed.detail)

  // 2. The rate limit, per address, failing CLOSED (D27).
  const admin = serviceClient()
  const source = clientAddress(req.headers)
  if (await isRateLimited(admin, 'gateway-enrol', source ?? 'unknown',
      envInt('GATEWAY_ENROL_PER_MINUTE', 10), 60, { failOpen: false })) {
    return refusal(429, 'rate_limited', 'Too many enrolment attempts from this address; wait a minute and try again.')
  }

  // 3. The shape.
  if (body === null) return refusal(400, 'bad_request', 'The request body is not JSON.')
  if (!parsed.ok) return refusal(parsed.status, parsed.code, parsed.detail)

  // 4. The predicate: the token spent once, the gateway made, the hash kept.
  const credential = makeCredential()
  const { data, error } = await admin.rpc('gateway_enrol_apply', {
    p_token_hash: await sha256Hex(parsed.value.token),
    p_credential_hash: await sha256Hex(credential),
    p_gateway: parsed.value.gateway,
    p_source: source,
  })
  if (error) {
    if (error.code === '54000') {
      return refusal(409, 'too_many_gateways', 'This company already has ten gateways. An admin can Forget one in Settings, Storage, File gateway; the token is still good.')
    }
    if (error.code === '23514') {
      return refusal(400, 'refused', 'WILSON could not store this gateway: one of its details is not in the shape the cloud keeps.')
    }
    console.error(`gateway-enrol: ${error.code ?? ''} ${error.message}`)
    return refusal(503, 'enrol_failed', 'WILSON could not enrol the gateway just now; the token was not used, so try again in a minute.')
  }
  const result = data as Record<string, unknown> | null
  if (!result?.ok) {
    return refusal(401, 'token_refused', 'This enrolment token is not valid: it was used already, cancelled, or is more than 24 hours old. Make a new one in Settings, Storage, File gateway.')
  }

  const workspaceId = result.workspace_id as string
  let signingKeys: Array<{ kid: string; public_key: string }> = []
  try {
    const key = await ensureSigningKey(admin, workspaceId)
    if (key) signingKeys = [{ kid: key.kid, public_key: key.public_key }]
  } catch (e) {
    // Not fatal: the first ticket makes the key, and the next sync carries it.
    console.error(`gateway-enrol: signing key not ready: ${(e as Error).message}`)
  }

  return answer({
    gateway_id: result.gateway_id,
    credential,
    workspace_name: result.workspace_name,
    signing_keys: signingKeys,
    web_app_origins: webAppOrigins(Deno.env.get('WILSON_SITE_URL'), Deno.env.get('WILSON_GATEWAY_WEB_ORIGINS')),
    sync_interval_s: SYNC_INTERVAL_S,
  })
})
