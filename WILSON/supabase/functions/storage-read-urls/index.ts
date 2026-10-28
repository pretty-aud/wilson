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
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders, reply } from '../_shared/adminGuard.ts'
import { requireActiveMember, type MemberContext } from '../_shared/memberGuard.ts'
import { isRateLimited, envInt } from '../_shared/rateLimit.ts'
import { decryptStorageSecret, storageSecretCryptoConfigured } from '../_shared/storageSecretCrypto.ts'
import { presignS3Request, type S3Target } from '../_shared/s3Presign.ts'
import { handleReadUrls } from '../_shared/readUrls.ts'

type S3Config = {
  endpoint?: string
  region: string
  bucket: string
  prefix?: string
  accessKeyId: string
  forcePathStyle?: boolean
}

Deno.serve(async (req: Request) => {
  // The caller's own client: the anon key carrying the caller's JWT, so the
  // predicate and the row read run under real RLS and real claims (the S33
  // rule — evaluated as the caller, never replicated).
  let callerClient: ReturnType<typeof createClient> | null = null
  const asCaller = () => (callerClient ??= createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${(req.headers.get('authorization') ?? '').slice(7)}` } } },
  ))

  const out = await handleReadUrls<MemberContext>(req, {
    guard: async () => {
      const g = await requireActiveMember(req)
      return g.ok ? { ok: true, ctx: g.ctx } : { ok: false, res: g.res }
    },

    rateLimited: (ctx) => isRateLimited(ctx.admin, 'storage-read-urls', ctx.callerId,
      envInt('STORAGE_READ_URLS_RPM', 120), 60),

    canReadProject: async (_ctx, projectId) => {
      const { data, error } = await asCaller().rpc('can_presign_project_read', { p_project: projectId })
      return error ? false : data
    },

    ownedRows: async (_ctx, projectIds, paths) => {
      const { data, error } = await asCaller()
        .from('files')
        .select('storage_path, thumbnail_url')
        .eq('storage_provider', 's3')
        .is('deleted_at', null)
        .in('project_id', projectIds)
        .in('storage_path', paths)
      if (error) throw new Error(error.message)
      return (data ?? []) as { storage_path: string | null; thumbnail_url: string | null }[]
    },

    // The workspace's choice. ctx.workspaceId is the guard's verified claim,
    // and the predicate proved every project asked lives in that workspace,
    // so this config is the right tenant's by construction. The mode is not
    // checked: a GET, as in storage-presign — a workspace back on Petal cloud
    // still reaches what it wrote.
    loadSigner: async (ctx) => {
      const { data: ws, error: wsErr } = await ctx.admin
        .from('workspace_storage')
        .select('provider, provider_config')
        .eq('workspace_id', ctx.workspaceId)
        .maybeSingle()
      if (wsErr) return { ok: false, status: 500, body: { error: 'storage_read_failed', detail: wsErr.message } }
      if (ws?.provider !== 's3' || !ws.provider_config) {
        return {
          ok: false, status: 409,
          body: { error: 'refused', detail: 'this workspace has no S3-compatible storage configured — an admin sets it in Admin Terminal → Storage' },
        }
      }
      if (!storageSecretCryptoConfigured()) {
        return { ok: false, status: 503, body: { error: 'crypto_unavailable', detail: 'WILSON_STORAGE_KEY_SECRET is not configured on this environment' } }
      }
      const { data: sec, error: secErr } = await ctx.admin
        .from('workspace_storage_secrets')
        .select('secret_ciphertext')
        .eq('workspace_id', ctx.workspaceId)
        .maybeSingle()
      if (secErr) return { ok: false, status: 500, body: { error: 'secret_read_failed', detail: secErr.message } }
      if (!sec?.secret_ciphertext) {
        return {
          ok: false, status: 409,
          body: { error: 'refused', detail: 'no bucket secret is stored for this workspace — an admin saves it in Admin Terminal → Storage' },
        }
      }
      let secret: string
      try {
        secret = await decryptStorageSecret(sec.secret_ciphertext as string)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, status: 500, body: { error: 'secret_unusable', detail: `the stored bucket secret cannot be decrypted (${message}) — re-enter it in Admin Terminal → Storage` } }
      }
      const cfg = ws.provider_config as S3Config
      const target: S3Target = {
        endpoint: cfg.endpoint,
        region: cfg.region,
        bucket: cfg.bucket,
        forcePathStyle: cfg.forcePathStyle,
      }
      return {
        ok: true,
        // The prefix is applied HERE and only here: storage_path stays
        // row-shaped in the database, and the client never sees or sends it.
        sign: (key, expiresSeconds) => presignS3Request({
          target,
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: secret,
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
