// =============================================================================
// storage-read-urls — P1 (night 4, 2026-10-28): signed GETs for the
// thumbnails and previews of a workspace on its own S3 bucket, in a batch.
//
// NETWORK_STORAGE_DESIGN.md §9.2. Every decision is in _shared/readUrls.ts,
// pure and tested from the repo's vitest; this file supplies only what touches
// the world. GET ONLY: there is no op field and no PUT, DELETE or HEAD here.
// Petal never proxies the bytes — the answer is URLs, and the browser or the
// desktop reads the customer's bucket directly (§4a2's "direct" condition).
//
// Why a function of its own rather than an op on storage-presign (§9.2):
// storage-presign's bound is that it signs exactly ONE key, and its budget is
// sized in uploads; a batch would change both for every op sharing them. This
// one has its own limiter bucket, a different answer and different expiries,
// and ships without redeploying the upload path's boundary.
//
// verify_jwt = false + in-function validation, like every function here (the
// gateway can't validate this project's ES256 JWTs).
//
// F8 (wave 2, 2026-11-13): loadSigner's two reads (the configuration and the
// sealed secret) are _shared/workspaceBucket.ts's loadWorkspaceBucket, shared
// with storage-presign and storage-secret's probe; the two now run at once
// and are judged in the order they always were. The refusals are worded HERE,
// in this function's own words (bucketRefusal below), unchanged since P1. The
// caller's own client is adminGuard.callerClient(req), built lazily as before.
// =============================================================================

import { callerClient, corsHeaders, reply, type ServiceClient } from '../_shared/adminGuard.ts'
import { requireActiveMember, type MemberContext } from '../_shared/memberGuard.ts'
import { isRateLimited, envInt } from '../_shared/rateLimit.ts'
import { makeS3Presigner } from '../_shared/s3Presign.ts'
import { handleReadUrls } from '../_shared/readUrls.ts'
import { loadWorkspaceBucket, type BucketRefusal } from '../_shared/workspaceBucket.ts'

/** The loader's refusals, in this function's own words (unchanged since P1). */
function bucketRefusal(r: BucketRefusal): { ok: false; status: number; body: Record<string, unknown> } {
  switch (r.code) {
    case 'storage_read_failed': return { ok: false, status: 500, body: { error: 'storage_read_failed', detail: r.message } }
    case 'not_s3': return {
      ok: false, status: 409,
      body: { error: 'refused', detail: 'this workspace has no S3-compatible storage configured — an admin sets it in Admin Terminal → Storage' },
    }
    // Never asked for here (requireByos is false: a read), so never answered;
    // worded as storage-presign words it, so no code is left without a sentence.
    case 'not_active': return {
      ok: false, status: 409,
      body: { error: 'refused', detail: 'this workspace is on Petal cloud right now — its S3 configuration is retained but inactive, so new files do not go to the bucket' },
    }
    case 'crypto_unavailable': return { ok: false, status: 503, body: { error: 'crypto_unavailable', detail: 'WILSON_STORAGE_KEY_SECRET is not configured on this environment' } }
    case 'secret_read_failed': return { ok: false, status: 500, body: { error: 'secret_read_failed', detail: r.message } }
    case 'no_secret': return {
      ok: false, status: 409,
      body: { error: 'refused', detail: 'no bucket secret is stored for this workspace — an admin saves it in Admin Terminal → Storage' },
    }
    case 'secret_unusable': return { ok: false, status: 500, body: { error: 'secret_unusable', detail: `the stored bucket secret cannot be decrypted (${r.message}) — re-enter it in Admin Terminal → Storage` } }
  }
}

Deno.serve(async (req: Request) => {
  // The caller's own client: the anon key carrying the caller's JWT, so the
  // predicate and the row read run under real RLS and real claims (the S33
  // rule — evaluated as the caller, never replicated).
  // Built lazily, once, the first time a row is read (adminGuard.callerClient,
  // with no auth options: this file never passed any).
  let own: ServiceClient | null = null
  const asCaller = () => (own ??= callerClient(req))

  const out = await handleReadUrls<MemberContext>(req, {
    guard: async () => {
      const g = await requireActiveMember(req)
      return g.ok ? { ok: true, ctx: g.ctx } : { ok: false, res: g.res }
    },

    rateLimited: (ctx) => isRateLimited(ctx.admin, 'storage-read-urls', ctx.callerId,
      envInt('STORAGE_READ_URLS_RPM', 120), 60),

    // BY FOLDER, never by key (review round 1, finding 4): the patterns hold
    // only the key's folder — ids and an entity word — so no filename travels
    // in the query string or lands in an API log. DIRECTLY in the folder (a
    // scene's folder does not pull in its shots' files: review round 2,
    // finding 1). One page after `afterId`; readUrls.ts walks the pages to
    // the first empty one and matches the keys.
    rowPage: async (_ctx, folder, afterId, limit) => {
      let q = asCaller()
        .from('files')
        .select('id, project_id, storage_path, thumbnail_url')
        .eq('storage_provider', 's3')
        .is('deleted_at', null)
        .like('storage_path', `${folder}/%`)
        .not('storage_path', 'like', `${folder}/%/%`)
      if (afterId) q = q.gt('id', afterId)
      const { data, error } = await q.order('id').limit(limit)
      if (error) throw new Error(error.message)
      return (data ?? []) as { id: string; project_id: string | null; storage_path: string | null; thumbnail_url: string | null }[]
    },

    // The workspace's choice. ctx.workspaceId is the guard's verified claim,
    // and the predicate proved every project asked lives in that workspace,
    // so this config is the right tenant's by construction. The mode is not
    // checked: a GET, as in storage-presign — a workspace back on Petal cloud
    // still reaches what it wrote.
    loadSigner: async (ctx) => {
      const cfg = await loadWorkspaceBucket(ctx.admin, ctx.workspaceId, { requireByos: false })
      if (!cfg.ok) return bucketRefusal(cfg)
      // F8 (C5): ONE presigner for this request's batch, made from this one
      // loaded bucket and dropped with it (nothing kept between requests or
      // companies): the signing key is derived once a day, not once a URL.
      // Each URL keeps its own clock, as before.
      const presigner = makeS3Presigner({ target: cfg.target, accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secret })
      return {
        ok: true,
        // The prefix is applied HERE and only here: storage_path stays
        // row-shaped in the database, and the client never sees or sends it.
        sign: (key, expiresSeconds) => presigner.presign({
          method: 'GET',
          key: cfg.prefix ? `${cfg.prefix}/${key}` : key,
          expiresSeconds,
          now: new Date(),
        }),
      }
    },
  })

  if ('preflight' in out) return new Response(null, { headers: corsHeaders })
  if ('res' in out) return out.res as Response
  return reply(out.body, out.status)
})
