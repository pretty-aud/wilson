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
//   7. MO1 (0120): `look` signs nothing for the client. The server makes the
//      signed HEAD itself, to a vetted address (s3Reach.ts, as the storage-gc
//      drain does), and on a 200 records the look for the move's commit
//      (_shared/s3Look.ts). It asks the rights to WRITE the key, and the active
//      choice, as a PUT does: it is the last step of writing a move's new copy.
//
// verify_jwt = false + in-function validation, like every function here
// (the gateway can't validate this project's ES256 JWTs).
//
// F8 (wave 2, 2026-11-13): step 6's two reads (the configuration and the
// sealed secret) are _shared/workspaceBucket.ts's loadWorkspaceBucket, shared
// with storage-read-urls and storage-secret's probe; the two now run at once
// and are judged in the order above. Every refusal's status and sentence is
// still worded HERE, from the loader's code. The project's own host for the
// look's vet is gatewayReachRun.supabaseHost(). The caller's own client (step
// 5) is adminGuard.callerClient(req), with no auth options, as before.
// =============================================================================

import { callerClient, corsHeaders, reply } from '../_shared/adminGuard.ts'
import { requireActiveMember } from '../_shared/memberGuard.ts'
import { isRateLimited, envInt } from '../_shared/rateLimit.ts'
import { checkRowShapedPath } from '../_shared/presignPath.ts'
import { presignS3Request, s3HostAndPath } from '../_shared/s3Presign.ts'
import { vetS3Host, s3Request, s3ReachDeps } from '../_shared/s3Reach.ts'
import { lookAtObject } from '../_shared/s3Look.ts'
import { loadWorkspaceBucket } from '../_shared/workspaceBucket.ts'
import { supabaseHost as platformHost } from '../_shared/gatewayReachRun.ts'
import { readBodyJson, SMALL_JSON_MAX_BYTES, TOO_LARGE } from '../_shared/gatewayWire.ts'

// Expiry per method. A PUT's signature is validated when the request STARTS,
// so a multi-GB upload may stream past it — 15 minutes is headroom for a
// slow link to BEGIN, not a cap on transfer time.
const EXPIRES: Record<string, number> = { put: 900, get: 300, del: 300, head: 300, look: 60 }
const METHOD: Record<string, 'PUT' | 'GET' | 'DELETE' | 'HEAD'> = {
  put: 'PUT', get: 'GET', del: 'DELETE', head: 'HEAD', look: 'HEAD',
}
// 🚨 The allowlist is this ARRAY, never `op in METHOD`. `in` walks the
// prototype chain, so 'constructor', '__proto__' and 'toString' all satisfy
// a check meant to admit four values — and each then ran the whole
// authorisation path, decrypted the bucket secret, and failed at the signer
// as a 500 rather than at the door as a 400. Found by S37's review.
const OPS = ['put', 'get', 'del', 'head', 'look'] as const

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)

  const guard = await requireActiveMember(req)
  if (!guard.ok) return guard.res
  const ctx = guard.ctx

  // 🚨 S44 RAISED THIS FROM 120 TO 240, AND THE REASON IS ARITHMETIC, NOT
  // COMFORT. Since S44 a thumbnail lives at its body's provider, so an s3
  // workspace's IMAGE upload costs TWO presigns where it used to cost one: the
  // body via s3Provider.put, then the derived preview via putThumbnailTo ->
  // the same registry put. The old ceiling was sized when that was one call.
  //
  // Left at 120, a user dragging in 100 stills is refused from roughly file 60
  // — and the refusals land on the SECOND call of each pair, so their bodies
  // have already landed and what they actually see is a half-illustrated grid
  // and "too many presign requests — wait a minute and retry", with nothing
  // connecting that to thumbnails. 240 restores the same 120 FILES per minute
  // this limit has always meant.
  //
  // ⚠️ Not a containment guarantee: isRateLimited fails OPEN on an RPC error by
  // deliberate design (rateLimit.ts), and the fixed window admits up to ~2x
  // across a boundary (0028). It is a budget. The real bound on a single
  // request is that this function signs exactly ONE key.
  if (await isRateLimited(ctx.admin, 'storage-presign', ctx.callerId,
      envInt('STORAGE_PRESIGN_RPM', 240), 60)) {
    return reply({ error: 'rate_limited', detail: 'too many presign requests — wait a minute and retry' }, 429)
  }

  // F8: read under a cap (largest real body 1,047 bytes, a 1,024-character
  // path), after the guard and the limiter as before. Past it: 413. Not JSON:
  // the old sentence. The value is handed on untouched (F8-05).
  let body: { op?: string; path?: string }
  const sent = await readBodyJson(req, SMALL_JSON_MAX_BYTES)
  if (sent.kind === 'too_large') return reply({ ...TOO_LARGE }, 413)
  if (sent.kind === 'not_json') return reply({ error: 'bad_request', detail: 'the request body is not JSON' }, 400)
  body = sent.value as { op?: string; path?: string }

  const op = typeof body.op === 'string' ? body.op : ''
  if (!(OPS as readonly string[]).includes(op)) {
    return reply({ error: 'bad_request', detail: 'op must be one of put, get, del, head, look' }, 400)
  }

  const shape = checkRowShapedPath(body.path)
  if (!shape.ok) return reply({ error: 'refused', detail: shape.detail }, 403)

  // The project predicate, evaluated AS THE CALLER (header §5). The anon-key
  // client carries the caller's own Authorization header, so PostgREST runs
  // the SECURITY INVOKER predicate under their JWT — real RLS, real claims.
  // adminGuard.callerClient, with no auth options: this file never passed any.
  const asCaller = callerClient(req)
  // MO1 (0115): the key no longer says where a file is, because a moved file keeps its key. The
  // database decides: a key a row claims answers to that row; a new key answers to its project.
  const { data: allowed, error: predErr } = await asCaller.rpc('can_presign_object', {
    p_path: body.path,
    p_op: op === 'look' ? 'put' : op,
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
  // A PUT (and a look) needs the ACTIVE choice; get, head and del reach what
  // was written (header §6).
  const cfg = await loadWorkspaceBucket(ctx.admin, ctx.workspaceId, {
    requireByos: op === 'put' || op === 'look',
    withMode: true,
  })
  if (!cfg.ok) {
    switch (cfg.code) {
      case 'storage_read_failed':
        return reply({ error: 'storage_read_failed', detail: cfg.message }, 500)
      case 'not_s3':
        return reply({
          error: 'refused',
          detail: 'this workspace has no S3-compatible storage configured — an admin sets it in Admin Terminal → Storage',
        }, 409)
      case 'not_active':
        return reply({
          error: 'refused',
          detail: 'this workspace is on Petal cloud right now — its S3 configuration is retained but inactive, so new files do not go to the bucket',
        }, 409)
      case 'crypto_unavailable':
        return reply({ error: 'crypto_unavailable', detail: 'WILSON_STORAGE_KEY_SECRET is not configured on this environment' }, 503)
      case 'secret_read_failed':
        return reply({ error: 'secret_read_failed', detail: cfg.message }, 500)
      case 'no_secret':
        return reply({
          error: 'refused',
          detail: 'no bucket secret is stored for this workspace — an admin saves it in Admin Terminal → Storage',
        }, 409)
      case 'secret_unusable':
        // Fail CLOSED with a sentence — unlike ai-proxy's deliberate fail-soft,
        // there is no platform fallback for a customer's bucket, and silently
        // routing their media anywhere else would be the exact failure §4a2b
        // exists to prevent.
        return reply({ error: 'secret_unusable', detail: `the stored bucket secret cannot be decrypted (${cfg.message}) — re-enter it in Admin Terminal → Storage` }, 500)
    }
  }
  const { target, secret } = cfg
  // The prefix is applied HERE and only here (header §3): storage_path stays
  // row-shaped in the database (0051 — split_part money axis; prefix edits
  // must not orphan keys), and the client never sees or supplies it.
  const key = cfg.prefix ? `${cfg.prefix}/${body.path}` : (body.path as string)

  if (op === 'look') {
    const deps = s3ReachDeps()
    const supabaseHost = platformHost()
    const out = await lookAtObject({
      host: () => s3HostAndPath(target, 'probe').host,
      vet: (host) => vetS3Host(host, deps, { supabaseHost }),
      sign: () => presignS3Request({
        target,
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: secret,
        method: METHOD[op],
        key,
        expiresSeconds: EXPIRES[op],
        now: new Date(),
      }),
      request: (url, vetted) => s3Request({ url, method: 'HEAD', vetted, deps }),
      record: () => ctx.admin.rpc('s3_body_look_record', {
        p_workspace: ctx.workspaceId,
        p_path: body.path,
        p_user: ctx.callerId,
      }),
    })
    return reply(out.body, out.status)
  }

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
