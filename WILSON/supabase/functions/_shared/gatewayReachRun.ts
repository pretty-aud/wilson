// =============================================================================
// _shared/gatewayReachRun.ts — GW1 (post-overhaul, 2026-10-10): one reach
// check, run and recorded. Used by gateway-reach (an admin pressed Check
// reach) and by gateway-sync (the daily check, a new public address, the
// switch just turned on — R6), so both record the same result the same way.
//
// The check was begun in the database (gateway_reach_begin, or by
// gateway_sync_apply itself), which wrote the nonce the gateway receives at
// its sync. This probes (gatewayReach.ts: the SSRF guard, the literal-
// address TLS, the nonce echo, the inside port) and hands the result to
// gateway_reach_finish, which records it only while the check is still the
// running one AND the outside address is still the one probed.
// =============================================================================

import type { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { denoReachDeps, isPublicIp, probeInside, probeOutside, type OutsideResult } from './gatewayReach.ts'

type Client = ReturnType<typeof createClient>

export type BegunCheck = {
  check_id: string
  nonce: string
  address: { host: string; port: number }
  remote_viewing: boolean
  inside_port?: number
}

export type ReachResult = {
  outside: Pick<OutsideResult, 'ok' | 'detail' | 'ms' | 'certificate' | 'is_this_gateway' | 'method'>
  inside_answered: boolean
}

export function supabaseHost(): string | undefined {
  try {
    return new URL(Deno.env.get('SUPABASE_URL') ?? '').hostname || undefined
  } catch {
    return undefined
  }
}

/** Probe, then record. `delayMs` lets the gateway take in the nonce its sync just carried. */
export async function runReachCheck(
  admin: Client, gatewayId: string, begun: BegunCheck, actor: string | null, delayMs = 0,
): Promise<{ recorded: boolean; result: ReachResult }> {
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
  const deps = denoReachDeps()
  const outside = await probeOutside(begun.address, begun.nonce,
    { switchOn: !!begun.remote_viewing, supabaseHost: supabaseHost() }, deps)
  let insideAnswered = false
  if (outside.address && isPublicIp(outside.address)) {
    insideAnswered = await probeInside([outside.address], begun.inside_port ?? 8443, deps)
  }
  const result: ReachResult = {
    outside: {
      ok: outside.ok, detail: outside.detail, ms: outside.ms, certificate: outside.certificate,
      is_this_gateway: outside.is_this_gateway, method: outside.method,
    },
    inside_answered: insideAnswered,
  }
  return { recorded: await finish(admin, gatewayId, begun, result, actor), result }
}

/** Record a result without probing (the gateway never picked the nonce up). */
export async function finish(admin: Client, gatewayId: string, begun: BegunCheck, result: ReachResult, actor: string | null): Promise<boolean> {
  const { data, error } = await admin.rpc('gateway_reach_finish', {
    p_gateway: gatewayId, p_check_id: begun.check_id, p_address: begun.address,
    p_result: result, p_actor: actor,
  })
  if (error) {
    console.error(`gateway reach check not recorded: ${error.message}`)
    return false
  }
  return data === true
}
