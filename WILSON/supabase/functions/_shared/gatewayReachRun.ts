// =============================================================================
// _shared/gatewayReachRun.ts — GW1 (post-overhaul, 2026-10-10): one reach
// check, run and recorded. Used by gateway-reach (an admin pressed Check
// reach) and by gateway-sync (the daily check, a new public address, the
// switch just turned on — R6), so both record the same result the same way.
//
// The check was begun in the database (gateway_reach_begin, or by
// gateway_sync_apply itself), which wrote the nonce the gateway receives at
// its sync. This probes (gatewayReach.ts: the SSRF guard, the literal-
// address TLS, the nonce's proof, the inside port) and hands the result to
// gateway_reach_finish, which records it only while the check is still the
// running one AND the outside address is still the one probed.
//
// Review round 1, finding 1: the probe's nonce rides the request, so an echo
// proves nothing; the host must answer the proof only the credential's
// holder can make (gatewayWire.reachProof), computed here from the reach key
// the cloud keeps in gateway_secrets — read as the service role, by the
// gateway's id, never shown. Round 2, finding 1: the reach key, never the
// credential's hash, which every gateway call sends in a request URL.
// Round 2, finding 4: the inside port answers 'gateway' (the red line) only
// for the inside door's own signature, a close at once.
// =============================================================================

import type { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { denoReachDeps, insidePortToProbe, isPublicIp, probeInside, probeOutside, type InsideAnswer, type OutsideResult } from './gatewayReach.ts'
import { reachProof } from './gatewayWire.ts'

type Client = ReturnType<typeof createClient>

export type BegunCheck = {
  check_id: string
  nonce: string
  address: { host: string; port: number }
  remote_viewing: boolean
  inside_port?: number
}

export type ReachResult = {
  outside: Pick<OutsideResult, 'ok' | 'detail' | 'ms' | 'certificate' | 'is_this_gateway' | 'method' | 'proof_checked'>
  /** The gateway's inside door answered from the internet (its close-at-once signature). */
  inside_answered: boolean
  /** Something else answers on the inside port at that address (a tunnel's edge, a load balancer). */
  inside_other: boolean
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
  let expectedProof: string | null = null
  try {
    const { data: secret } = await admin.from('gateway_secrets').select('reach_key').eq('gateway_id', gatewayId).maybeSingle()
    const key = (secret as { reach_key?: string } | null)?.reach_key
    if (key) expectedProof = await reachProof(key, begun.nonce)
  } catch {
    expectedProof = null
  }
  const outside = await probeOutside(begun.address, begun.nonce,
    { switchOn: !!begun.remote_viewing, supabaseHost: supabaseHost(), expectedProof }, deps)
  let inside: InsideAnswer = 'none'
  const insidePort = insidePortToProbe(begun.inside_port ?? 8443, begun.address?.port)
  if (outside.address && isPublicIp(outside.address) && insidePort !== null) {
    inside = await probeInside([outside.address], insidePort, deps)
  }
  const result: ReachResult = {
    outside: {
      ok: outside.ok, detail: outside.detail, ms: outside.ms, certificate: outside.certificate,
      is_this_gateway: outside.is_this_gateway, method: outside.method, proof_checked: outside.proof_checked,
    },
    inside_answered: inside === 'gateway',
    inside_other: inside === 'other',
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
