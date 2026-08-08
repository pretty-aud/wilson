// =============================================================================
// storage-presign — Session 37: the authorisation boundary for S3-compatible
// storage (§4a2/§4a2b, the first BYO provider).
//
// Mints a short-lived presigned URL for ONE request against ONE object key
// in the workspace's own bucket. The client then talks to the customer's
// provider DIRECTLY — Petal never proxies the bytes (§4a2's "direct"
// condition: a relay would put Petal on the egress bill for every gigabyte
// of every customer's media, forever, and make it a content-bearing
// sub-processor).
//
// 🚨 THIS IS AN AUTHORISATION BOUNDARY, NOT A FORMALITY. A presigned URL is
// bearer authority over METHOD + KEY + EXPIRY; minting one for a key the
// caller may not touch turns this function into a signing oracle for any
// authenticated user. The refusals, in order:
//
//   1. requireActiveMember — a live workspace_members row, not just a JWT.
//   2. Rate limit (durable fixed-window, the operator-write shape).
//   3. The path must be ROW-SHAPED and canonical: projects/<uuid>/…, the
//      exact form supabaseAdapter.uploadFile writes, every segment in the
//      sanitiser's own charset, no dot segments, no empty segments. The
//      workspace prefix is NOT accepted from the client — it is applied
//      HERE, from provider_config, so a client can neither escape its
//      tenant prefix nor smuggle a second one.
//   4. 🚨 Money-segment keys are refused WHOLESALE, both directions
//      (_shared/moneySegments.ts, 0042's vocabulary, case-folded). Money
//      never leaves Supabase (§4a2b invariant 2) — there is no financial
//      presign to authorise, so a money-shaped key is always hostile or a
//      bug, and either way the answer is a sentence, not a URL.
//   5. The project predicate, EVALUATED as the caller rather than
//      replicated (the S33 rule): can_presign_project_write/read (0051) are
//      SECURITY INVOKER and are called over PostgREST with the CALLER'S OWN
//      JWT, so auth.uid(), current_workspace_id(), project visibility and
//      can_write_project's arms all answer as the real user. `=== true` is
//      required — null, undefined and error all refuse (COALESCE in SQL,
//      strict equality here; NULL fails OPEN in an IF and this is the
//      lesson's other half).
//   6. The workspace must actually BE on s3: for PUT, mode 'byos' +
//      provider 's3' (an ACTIVE choice — a retained, inert s3 config does
//      not accept new bodies, mirroring how a retained NAS root is not
//      resolved). For GET/HEAD/DELETE the mode check is deliberately
//      dropped: a workspace that switched back to Petal cloud must not
//      orphan the bodies it already wrote (resolve-from-the-row, S36) — the
//      retained provider_config is exactly what keeps them reachable.
//
// verify_jwt = false + in-function validation, like every function here
// (the gateway can't validate this project's ES256 JWTs).
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders, reply } from '../_shared/adminGuard.ts'
import { requireActiveMember } from '../_shared/memberGuard.ts'
import { isRateLimited, envInt } from '../_shared/rateLimit.ts'
import { checkRowShapedPath } from '../_shared/presignPath.ts'
import { decryptStorageSecret, storageSecretCryptoConfigured } from '../_shared/storageSecretCrypto.ts'
import { presignS3Request, type S3Target } from '../_shared/s3Presign.ts'

// Expiry per method. A PUT's signature is validated when the request STARTS,
// so a multi-GB upload may stream past it — 15 minutes is headroom for a
// slow link to BEGIN, not a cap on transfer time.
const EXPIRES: Record<string, number> = { put: 900, get: 300, del: 300, head: 300 }
const METHOD: Record<string, 'PUT' | 'GET' | 'DELETE' | 'HEAD'> = {
  put: 'PUT', get: 'GET', del: 'DELETE', head: 'HEAD',
}
// 🚨 The allowlist is this ARRAY, never `op in METHOD`. `in` walks the
// prototype chain, so 'constructor', '__proto__' and 'toString' all satisfy
// a check meant to admit four values — and each then ran the whole
// authorisation path, decrypted the bucket secret, and failed at the signer
// as a 500 rather than at the door as a 400. Found by S37's review.
const OPS = ['put', 'get', 'del', 'head'] as const

type S3Config = {
  endpoint?: string
  region: string
  bucket: string
  prefix?: string
  accessKeyId: string
  forcePathStyle?: boolean
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)

  const guard = await requireActiveMember(req)
  if (!guard.ok) return guard.res
  const ctx = guard.ctx

  if (await isRateLimited(ctx.admin, 'storage-presign', ctx.callerId,
      envInt('STORAGE_PRESIGN_RPM', 120), 60)) {
    return reply({ error: 'rate_limited', detail: 'too many presign requests — wait a minute and retry' }, 429)
  }

  let body: { op?: string; path?: string }
  try {
    body = await req.json()
  } catch {
    return reply({ error: 'bad_request', detail: 'the request body is not JSON' }, 400)
  }

  const op = typeof body.op === 'string' ? body.op : ''
  if (!(OPS as readonly string[]).includes(op)) {
    return reply({ error: 'bad_request', detail: 'op must be one of put, get, del, head' }, 400)
  }

  const shape = checkRowShapedPath(body.path)
  if (!shape.ok) return reply({ error: 'refused', detail: shape.detail }, 403)

  // The project predicate, evaluated AS THE CALLER (header §5). The anon-key
  // client carries the caller's own Authorization header, so PostgREST runs
  // the SECURITY INVOKER predicate under their JWT — real RLS, real claims.
  const token = (req.headers.get('authorization') ?? '').slice(7)
  const asCaller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  )
  const predicate = op === 'get' || op === 'head'
    ? 'can_presign_project_read'
    : 'can_presign_project_write'
  const { data: allowed, error: predErr } = await asCaller.rpc(predicate, {
    p_project: shape.projectId,
  })
  if (predErr) {
    return reply({ error: 'refused', detail: `the project check failed: ${predErr.message}` }, 403)
  }
  if (allowed !== true) {
    return reply({ error: 'refused', detail: 'you cannot presign for this project' }, 403)
  }

  // The workspace's storage choice. ctx.workspaceId is the guard's verified
  // claim, and the predicate above already proved the project lives in that
  // same workspace — so this config is the right tenant's by construction.
  const { data: ws, error: wsErr } = await ctx.admin
    .from('workspace_storage')
    .select('mode, provider, provider_config')
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle()
  if (wsErr) return reply({ error: 'storage_read_failed', detail: wsErr.message }, 500)

  if (ws?.provider !== 's3' || !ws.provider_config) {
    return reply({
      error: 'refused',
      detail: 'this workspace has no S3-compatible storage configured — an admin sets it in Admin Terminal → Storage',
    }, 409)
  }
  if (op === 'put' && ws.mode !== 'byos') {
    return reply({
      error: 'refused',
      detail: 'this workspace is on Petal cloud right now — its S3 configuration is retained but inactive, so new files do not go to the bucket',
    }, 409)
  }

  if (!storageSecretCryptoConfigured()) {
    return reply({ error: 'crypto_unavailable', detail: 'WILSON_STORAGE_KEY_SECRET is not configured on this environment' }, 503)
  }
  const { data: sec, error: secErr } = await ctx.admin
    .from('workspace_storage_secrets')
    .select('secret_ciphertext')
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle()
  if (secErr) return reply({ error: 'secret_read_failed', detail: secErr.message }, 500)
  if (!sec?.secret_ciphertext) {
    return reply({
      error: 'refused',
      detail: 'no bucket secret is stored for this workspace — an admin saves it in Admin Terminal → Storage',
    }, 409)
  }

  let secret: string
  try {
    secret = await decryptStorageSecret(sec.secret_ciphertext as string)
  } catch (err) {
    // Fail CLOSED with a sentence — unlike ai-proxy's deliberate fail-soft,
    // there is no platform fallback for a customer's bucket, and silently
    // routing their media anywhere else would be the exact failure §4a2b
    // exists to prevent.
    const message = err instanceof Error ? err.message : String(err)
    return reply({ error: 'secret_unusable', detail: `the stored bucket secret cannot be decrypted (${message}) — re-enter it in Admin Terminal → Storage` }, 500)
  }

  const cfg = ws.provider_config as S3Config
  const target: S3Target = {
    endpoint: cfg.endpoint,
    region: cfg.region,
    bucket: cfg.bucket,
    forcePathStyle: cfg.forcePathStyle,
  }
  // The prefix is applied HERE and only here (header §3): storage_path stays
  // row-shaped in the database (0051 — split_part money axis; prefix edits
  // must not orphan keys), and the client never sees or supplies it.
  const key = cfg.prefix ? `${cfg.prefix}/${body.path}` : (body.path as string)

  try {
    const url = await presignS3Request({
      target,
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: secret,
      method: METHOD[op],
      key,
      expiresSeconds: EXPIRES[op],
      now: new Date(),
    })
    return reply({
      ok: true,
      url,
      method: METHOD[op],
      expiresAt: new Date(Date.now() + EXPIRES[op] * 1000).toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return reply({ error: 'presign_failed', detail: message }, 500)
  }
})
