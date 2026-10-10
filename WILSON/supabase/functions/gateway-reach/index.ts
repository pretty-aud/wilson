// =============================================================================
// gateway-reach — GW1 (post-overhaul, 2026-10-10): Check reach, an admin's
// button in Settings, Storage, File gateway (GATEWAY_DESIGN.md §4, §10 row
// 16; G3: the company exposes the gateway itself and WILSON only checks).
//
// In order:
//   1. the caller: requireActiveMember, then a LIVE admin row (the switch's
//      rule, D23 — not the token's claim)
//   2. the rate limit, six a minute per COMPANY, failing open (D27)
//   3. the shape: a gateway id
//   4. the predicate AS THE CALLER (the S33 rule): the gateway must be
//      readable through the caller's own token from the gateways table,
//      whose RLS is a live admin of its company — then the database begins
//      ONE check for it (gateway_reach_begin: a second admin reads "a check
//      is running", R16), writing a fresh nonce the gateway picks up at its
//      next sync, within ten seconds
//   5. the probe (gatewayReach.ts): the SSRF guard (only the registered
//      outside address; a name resolved and every answer public; the
//      Supabase hosts refused), TLS to the validated address LITERAL with
//      the name as SNI only, GET /v1/health with the nonce, 5 s, 4 KB, no
//      redirects; reached only on the nonce echo; then the INSIDE port on
//      the same public address, which should refuse
//   6. the result recorded (gateway_reach_finish: only while this is still
//      the running check and the address is still the one probed) — reach_ok
//      gates gateways_visible's outside address — and written to the audit
//
// The answer: { outside: { ok, detail, ms, certificate, is_this_gateway,
// method }, inside_answered, checked_at }. Settings words each detail
// (§4's seven sentences and the few this file adds).
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { requireActiveMember } from '../_shared/memberGuard.ts'
import { isRateLimited, envInt } from '../_shared/rateLimit.ts'
import { answer, preflight, readJson, refusal, withMemberSentence } from '../_shared/gatewayGuard.ts'
import { parseReachRequest } from '../_shared/gatewayShapes.ts'
import { finish, runReachCheck, type BegunCheck, type ReachResult } from '../_shared/gatewayReachRun.ts'

const DELIVERY_WAIT_MS = 15000

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return refusal(405, 'method_not_allowed', 'Use POST.')

  // 1. The caller: an active member, and a LIVE admin.
  const guard = await requireActiveMember(req)
  if (!guard.ok) return withMemberSentence(guard.res)
  const ctx = guard.ctx
  const { data: row } = await ctx.admin
    .from('workspace_members')
    .select('app_role, is_active')
    .eq('workspace_id', ctx.workspaceId)
    .eq('user_id', ctx.callerId)
    .maybeSingle()
  if (!row || !row.is_active || row.app_role !== 'admin') {
    return refusal(403, 'forbidden', 'Only a workspace admin can check whether the gateway is reachable from outside.')
  }

  // 2. The rate limit (per company, fails open).
  if (await isRateLimited(ctx.admin, 'gateway-reach', ctx.workspaceId, envInt('GATEWAY_REACH_PER_MINUTE', 6), 60)) {
    return refusal(429, 'rate_limited', 'Six checks a minute at most; wait a moment and check again.')
  }

  // 3. The shape.
  const body = await readJson(req, 4 * 1024)
  if (body === null) return refusal(400, 'bad_request', 'The request body is not JSON.')
  const parsed = parseReachRequest(body.value)
  if (!parsed.ok) return refusal(parsed.status, parsed.code, parsed.detail)

  // 4. The predicate as the caller, then one check begun.
  const token = (req.headers.get('authorization') ?? '').slice(7)
  const asCaller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: visible, error: visErr } = await asCaller
    .from('gateways')
    .select('id')
    .eq('id', parsed.gatewayId)
    .is('revoked_at', null)
    .maybeSingle()
  if (visErr) return refusal(503, 'gateway_check_failed', 'WILSON could not check the gateway just now; try again in a moment.')
  if (!visible) return refusal(404, 'not_found', "That gateway is not in this company's list.")

  const { data: begunRaw, error: beginErr } = await ctx.admin.rpc('gateway_reach_begin', {
    p_gateway: parsed.gatewayId, p_workspace: ctx.workspaceId,
  })
  if (beginErr) return refusal(503, 'check_failed', 'WILSON could not start the check just now; try again in a moment.')
  const begun = (begunRaw ?? {}) as Record<string, unknown>
  if (!begun.began) {
    if (begun.reason === 'busy') return refusal(409, 'busy', 'A check is running for this gateway; its result appears here in a few seconds.')
    if (begun.reason === 'no_address') return refusal(409, 'no_address', 'Give the gateway its outside address first: the public name or address people outside the office will reach it at.')
    return refusal(404, 'not_found', "That gateway is not in this company's list.")
  }
  const check = begun as unknown as BegunCheck

  // The gateway takes the nonce at its next sync (≤ 10 s). Wait for it.
  const deadline = Date.now() + DELIVERY_WAIT_MS
  let delivered = false
  while (Date.now() < deadline) {
    const { data: g } = await ctx.admin
      .from('gateways')
      .select('reach_nonce_delivered_at, reach_check_id')
      .eq('id', parsed.gatewayId)
      .maybeSingle()
    if (!g || g.reach_check_id !== check.check_id) break
    if (g.reach_nonce_delivered_at) { delivered = true; break }
    await new Promise((r) => setTimeout(r, 500))
  }

  if (!delivered) {
    const result = {
      outside: { ok: false, detail: 'gateway_not_syncing', ms: null, certificate: 'unknown', is_this_gateway: false, method: 'none' },
      inside_answered: false,
    }
    await finish(ctx.admin, parsed.gatewayId, check, result as ReachResult, ctx.callerId)
    return answer({ ...result, checked_at: new Date().toISOString() })
  }

  // 5–6. Probe (a second for the gateway to take the nonce in), record.
  const { result } = await runReachCheck(ctx.admin, parsed.gatewayId, check, ctx.callerId, 1000)
  return answer({ ...result, checked_at: new Date().toISOString() })
})
