// =============================================================================
// storage-secret — Session 37: the workspace bucket secret, and the
// configuration-time probe.
//
// The admin half of S3-compatible storage. Four actions, all
// requireWorkspaceAdmin (live admin row + MFA step-up, adminGuard):
//
//   * set    — encrypt (AES-256-GCM, _shared/storageSecretCrypto.ts, master
//              key WILSON_STORAGE_KEY_SECRET) and upsert into
//              workspace_storage_secrets. Returns the key hint. The
//              plaintext is read once from the request and never stored,
//              logged or echoed — the 0028 rule: no client ever reads a
//              credential back.
//   * clear  — delete the row.
//   * status — { configured, keyHint } for the Storage section's "…9f2c".
//   * probe  — the S34 pattern at CONFIGURATION time, §3 of the brief: a
//              REAL round trip, not a formality, with a sentence a person
//              can act on. Two halves:
//                - server-side PUT → GET → DELETE of a tiny probe object,
//                  which proves endpoint + addressing style + credentials +
//                  bucket, with the failure stage named (a wrong
//                  forcePathStyle presents as a DNS failure, and the
//                  sentence says so rather than "bucket not found");
//                - presigned PUT/GET/DELETE URLs for a SECOND probe key,
//                  which the CLIENT then exercises — the only way to test
//                  CORS, because CORS only exists in the caller's browser
//                  context. Server ok + client network-error = the CORS
//                  sentence, and §12.7a carries the JSON rule to paste.
//
// The probe object lives under `.wilson-probe/…` inside the workspace's
// prefix — deliberately OUTSIDE projects/, so it can never collide with a
// row-shaped key and never trips the money or reserved rules.
// =============================================================================

import { corsHeaders, reply, requireWorkspaceAdmin, logAdminEvent } from '../_shared/adminGuard.ts'
import { isRateLimited, envInt } from '../_shared/rateLimit.ts'
import {
  encryptStorageSecret, decryptStorageSecret, storageKeyHint,
  storageSecretCryptoConfigured,
} from '../_shared/storageSecretCrypto.ts'
import { presignS3Request, type S3Target } from '../_shared/s3Presign.ts'

type S3Config = {
  endpoint?: string
  region: string
  bucket: string
  prefix?: string
  accessKeyId: string
  forcePathStyle?: boolean
}

function probeKey(prefix: string | undefined, label: string): string {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, '0')).join('')
  const key = `.wilson-probe/${label}-${Date.now()}-${rand}`
  return prefix ? `${prefix}/${key}` : key
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)

  const guard = await requireWorkspaceAdmin(req)
  if (!guard.ok) return guard.res
  const ctx = guard.ctx

  if (await isRateLimited(ctx.admin, 'storage-secret', ctx.callerId,
      envInt('STORAGE_SECRET_RPM', 20), 60)) {
    return reply({ error: 'rate_limited', detail: 'too many requests — wait a minute and retry' }, 429)
  }

  let body: { action?: string; secret?: string }
  try {
    body = await req.json()
  } catch {
    return reply({ error: 'bad_request', detail: 'the request body is not JSON' }, 400)
  }

  // ── set ────────────────────────────────────────────────────────────────────
  if (body.action === 'set') {
    if (!storageSecretCryptoConfigured()) {
      return reply({ error: 'crypto_unavailable', detail: 'WILSON_STORAGE_KEY_SECRET is not configured on this environment' }, 503)
    }
    const secret = typeof body.secret === 'string' ? body.secret.trim() : ''
    if (secret.length < 8 || secret.length > 512) {
      return reply({ error: 'bad_request', detail: 'the secret must be between 8 and 512 characters' }, 400)
    }
    let ciphertext: string
    try {
      ciphertext = await encryptStorageSecret(secret)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return reply({ error: 'encrypt_failed', detail: message }, 500)
    }
    const hint = storageKeyHint(secret)
    const { error } = await ctx.admin.from('workspace_storage_secrets').upsert({
      workspace_id: ctx.workspaceId,
      secret_ciphertext: ciphertext,
      key_hint: hint,
      key_version: 1,
      updated_at: new Date().toISOString(),
      updated_by: ctx.callerId,
    }, { onConflict: 'workspace_id' })
    if (error) return reply({ error: 'save_failed', detail: error.message }, 500)
    await logAdminEvent(ctx, {
      code: 'WIL-3005',
      message: 'Workspace bucket secret saved',
      context: { key_hint: hint },
    })
    return reply({ ok: true, keyHint: hint })
  }

  // ── clear ──────────────────────────────────────────────────────────────────
  if (body.action === 'clear') {
    const { error } = await ctx.admin.from('workspace_storage_secrets')
      .delete().eq('workspace_id', ctx.workspaceId)
    if (error) return reply({ error: 'clear_failed', detail: error.message }, 500)
    await logAdminEvent(ctx, {
      code: 'WIL-3006',
      message: 'Workspace bucket secret cleared',
    })
    return reply({ ok: true })
  }

  // ── status ─────────────────────────────────────────────────────────────────
  if (body.action === 'status') {
    const { data, error } = await ctx.admin.from('workspace_storage_secrets')
      .select('key_hint').eq('workspace_id', ctx.workspaceId).maybeSingle()
    if (error) return reply({ error: 'status_failed', detail: error.message }, 500)
    return reply({
      ok: true,
      configured: !!data,
      keyHint: data?.key_hint ?? null,
      cryptoConfigured: storageSecretCryptoConfigured(),
    })
  }

  // ── probe ──────────────────────────────────────────────────────────────────
  if (body.action === 'probe') {
    const { data: ws, error: wsErr } = await ctx.admin
      .from('workspace_storage')
      .select('provider, provider_config')
      .eq('workspace_id', ctx.workspaceId)
      .maybeSingle()
    if (wsErr) return reply({ error: 'storage_read_failed', detail: wsErr.message }, 500)
    if (ws?.provider !== 's3' || !ws.provider_config) {
      return reply({ error: 'refused', detail: 'save the bucket configuration first — there is nothing to probe yet' }, 409)
    }
    const { data: sec, error: secErr } = await ctx.admin
      .from('workspace_storage_secrets')
      .select('secret_ciphertext')
      .eq('workspace_id', ctx.workspaceId)
      .maybeSingle()
    if (secErr) return reply({ error: 'secret_read_failed', detail: secErr.message }, 500)
    if (!sec?.secret_ciphertext) {
      return reply({ error: 'refused', detail: 'no bucket secret is stored — save the secret, then probe' }, 409)
    }
    let secret: string
    try {
      secret = await decryptStorageSecret(sec.secret_ciphertext as string)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return reply({ error: 'secret_unusable', detail: `the stored secret cannot be decrypted (${message}) — re-enter it` }, 500)
    }

    const cfg = ws.provider_config as S3Config
    const target: S3Target = {
      endpoint: cfg.endpoint, region: cfg.region, bucket: cfg.bucket,
      forcePathStyle: cfg.forcePathStyle,
    }
    const sign = (method: 'PUT' | 'GET' | 'DELETE', key: string) =>
      presignS3Request({
        target, accessKeyId: cfg.accessKeyId, secretAccessKey: secret,
        method, key, expiresSeconds: 120, now: new Date(),
      })

    // Server-side round trip: PUT → GET → DELETE. Any thrown fetch is an
    // unreachable endpoint (DNS/TLS/addressing), which gets the
    // forcePathStyle sentence — measured shape: a wrong style resolves a
    // bucket subdomain that does not exist.
    const serverKey = probeKey(cfg.prefix, 'server')
    const stages: Record<string, number> = {}
    const payload = 'wilson-probe'
    try {
      let t0 = Date.now()
      const putRes = await fetch(await sign('PUT', serverKey), { method: 'PUT', body: payload })
      stages.put_ms = Date.now() - t0
      if (!putRes.ok) {
        const status = putRes.status
        const detail =
          status === 403 ? 'the bucket refused the credentials (403) — check the access key id and the secret' :
          status === 404 ? `no such bucket "${cfg.bucket}" at this endpoint (404) — check the bucket name and region` :
          `the probe upload was refused (HTTP ${status})`
        await logAdminEvent(ctx, { code: 'WIL-3007', message: 'Bucket probe failed', context: { stage: 'put', status } })
        return reply({ error: 'probe_failed', stage: 'put', status, detail }, 502)
      }
      t0 = Date.now()
      const getRes = await fetch(await sign('GET', serverKey), { method: 'GET' })
      stages.get_ms = Date.now() - t0
      const text = getRes.ok ? await getRes.text() : ''
      if (!getRes.ok || text !== payload) {
        await logAdminEvent(ctx, { code: 'WIL-3007', message: 'Bucket probe failed', context: { stage: 'get', status: getRes.status } })
        return reply({
          error: 'probe_failed', stage: 'get', status: getRes.status,
          detail: getRes.ok
            ? 'the probe object read back with different content — something between WILSON and the bucket is rewriting bodies'
            : `the probe object could not be read back (HTTP ${getRes.status})`,
        }, 502)
      }
      t0 = Date.now()
      const delRes = await fetch(await sign('DELETE', serverKey), { method: 'DELETE' })
      stages.del_ms = Date.now() - t0
      if (!delRes.ok && delRes.status !== 404) {
        await logAdminEvent(ctx, { code: 'WIL-3007', message: 'Bucket probe failed', context: { stage: 'del', status: delRes.status } })
        return reply({
          error: 'probe_failed', stage: 'del', status: delRes.status,
          detail: `the probe object uploaded and read back but could not be deleted (HTTP ${delRes.status}) — the key needs DeleteObject too, or purge and GC cannot work`,
        }, 502)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await logAdminEvent(ctx, { code: 'WIL-3007', message: 'Bucket probe failed', context: { stage: 'connect' } })
      return reply({
        error: 'probe_failed', stage: 'connect',
        detail: `could not reach the bucket endpoint (${message}) — check the endpoint URL, and try the other addressing style: a wrong forcePathStyle presents as exactly this DNS failure`,
      }, 502)
    }

    // The client half: presigns for a SECOND key the browser exercises
    // itself. CORS only exists in the caller's context — a server that can
    // reach the bucket proves nothing about the browser's ability to.
    const clientKey = probeKey(cfg.prefix, 'client')
    const clientProbe = {
      putUrl: await sign('PUT', clientKey),
      getUrl: await sign('GET', clientKey),
      delUrl: await sign('DELETE', clientKey),
      expiresAt: new Date(Date.now() + 120 * 1000).toISOString(),
    }
    await logAdminEvent(ctx, { code: 'WIL-3007', message: 'Bucket probe succeeded (server half)', context: stages })
    return reply({ ok: true, server: stages, clientProbe })
  }

  return reply({ error: 'bad_request', detail: 'action must be one of set, clear, status, probe' }, 400)
})
