// =============================================================================
// _shared/gatewayGuard.ts — GW1 (post-overhaul, 2026-10-10): the caller check
// for the calls a GATEWAY makes (gateway-sync, gateway-events), and the
// reply helpers every gateway function shares.
//
// A gateway proves itself with its credential (`wgc_` + 43 base64url, the
// wire), carried as `Authorization: Bearer <credential>`. The cloud stores
// only its SHA-256 (gateway_secrets, service role only) and looks the call
// up by that hash: the credential itself is never compared, logged or kept.
// A revoked gateway (Forget) is refused at once — revoked_at, not the
// secret row, is the authority (the row goes a minute later, with the
// sweep). Every refusal is 401 with a code and a sentence; the gateway's
// own answer to a 401 is to close both doors (GW2).
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders } from './adminGuard.ts'
import { sha256Hex } from './gatewayWire.ts'
import { credentialOf } from './gatewayShapes.ts'

export type GatewayContext = {
  admin: ReturnType<typeof createClient>
  gatewayId: string
  workspaceId: string
  gateway: Record<string, unknown>
}

/** A JSON answer with the house CORS headers and no caching. */
export function answer(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

/** The CORS preflight: no body (a 204 may not carry one). */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders })
}

/** A refusal: a stable code and a sentence a person can read (storage-presign's shape). */
export function refusal(status: number, code: string, detail: string): Response {
  return answer({ error: code, detail }, status)
}

/**
 * memberGuard answers 401/403 with a code and no sentence; the gateway's two
 * member-facing functions add the sentence a person reads.
 */
export function withMemberSentence(res: Response): Response {
  if (res.status === 401) {
    return refusal(401, 'unauthorized', 'Sign in again: WILSON could not confirm who is asking for this.')
  }
  if (res.status === 403) {
    return refusal(403, 'forbidden', 'Your account is not an active member of this company, so WILSON will not do this for it.')
  }
  return res
}

export function serviceClient(): ReturnType<typeof createClient> {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

type Guard = { ok: true; ctx: GatewayContext } | { ok: false; res: Response }

export async function requireGateway(req: Request): Promise<Guard> {
  const credential = credentialOf(req.headers.get('authorization'))
  if (!credential) {
    return { ok: false, res: refusal(401, 'unauthorized', "This call needs the gateway's credential (Authorization: Bearer wgc_…).") }
  }
  const admin = serviceClient()
  const hash = await sha256Hex(credential)
  const { data: secret, error: secretErr } = await admin
    .from('gateway_secrets')
    .select('gateway_id')
    .eq('credential_hash', hash)
    .maybeSingle()
  if (secretErr) {
    return { ok: false, res: refusal(503, 'lookup_failed', "WILSON could not check the gateway's credential just now; the gateway will try again.") }
  }
  if (!secret?.gateway_id) {
    return { ok: false, res: refusal(401, 'unknown_gateway', "WILSON does not know this gateway's credential: it was forgotten, or never enrolled. Enrol it again with a new token from Settings, Storage, File gateway.") }
  }
  const { data: gw, error: gwErr } = await admin
    .from('gateways')
    .select('id, workspace_id, name, version, revoked_at, created_at')
    .eq('id', secret.gateway_id)
    .maybeSingle()
  if (gwErr) {
    return { ok: false, res: refusal(503, 'lookup_failed', 'WILSON could not check the gateway just now; the gateway will try again.') }
  }
  if (!gw || gw.revoked_at) {
    return { ok: false, res: refusal(401, 'revoked', 'This gateway was forgotten in Settings, so WILSON no longer answers it. Close both doors.') }
  }
  return { ok: true, ctx: { admin, gatewayId: gw.id as string, workspaceId: gw.workspace_id as string, gateway: gw } }
}

/** Read a JSON body with a size cap; null when it is not JSON. */
export async function readJson(req: Request, maxBytes: number): Promise<{ value: unknown; length: number } | null> {
  const text = await req.text()
  if (text.length > maxBytes) return { value: undefined, length: text.length }
  if (!text) return { value: undefined, length: 0 }
  try {
    return { value: JSON.parse(text), length: text.length }
  } catch {
    return null
  }
}

/** The environment's configured version floors (§8), '0.0.0' when unset. */
export function versionFloors(): { minimum: string; hard: string } {
  const ok = (v: string | undefined) => (v && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(v.trim()) ? v.trim() : '0.0.0')
  return {
    minimum: ok(Deno.env.get('WILSON_GATEWAY_MINIMUM_VERSION')),
    hard: ok(Deno.env.get('WILSON_GATEWAY_HARD_MINIMUM_VERSION')),
  }
}

export const SYNC_INTERVAL_S = 10
