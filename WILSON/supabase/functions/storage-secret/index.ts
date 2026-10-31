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
  storageSecretCryptoConfigured, storageSecretCurrentVersion,
} from '../_shared/storageSecretCrypto.ts'
import { presignS3Request, s3HostAndPath, type S3Target } from '../_shared/s3Presign.ts'
// P8 (TPN-NET-016): every request to the bucket goes to a VETTED public
// address, over one TLS connection to that literal, no redirect followed.
import { vetS3Host, s3Request, s3ReachDeps } from '../_shared/s3Reach.ts'

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
    // P8 (TPN-NET-016): a secret is stored only for an endpoint WILSON would
    // send it to. The row's endpoint (saved by the browser under 0106's CHECK,
    // which refuses a private literal and a local name) is resolved here and
    // refused if any answer is inside a private network — a name the CHECK
    // cannot resolve is caught at this save and at every use.
    {
      const { data: wsRow, error: wsRowErr } = await ctx.admin
        .from('workspace_storage')
        .select('provider, provider_config')
        .eq('workspace_id', ctx.workspaceId)
        .maybeSingle()
      if (wsRowErr) return reply({ error: 'storage_read_failed', detail: wsRowErr.message }, 500)
      if (wsRow?.provider === 's3' && wsRow.provider_config) {
        const c = wsRow.provider_config as S3Config
        let host: string
        try {
          host = s3HostAndPath({ endpoint: c.endpoint, region: c.region, bucket: c.bucket, forcePathStyle: c.forcePathStyle }, 'probe').host
        } catch (err) {
          return reply({ error: 'refused', detail: err instanceof Error ? err.message : String(err) }, 409)
        }
        const vet = await vetS3Host(host, s3ReachDeps(), { supabaseHost: new URL(Deno.env.get('SUPABASE_URL') ?? 'https://invalid').hostname })
        if (!vet.ok) {
          await logAdminEvent(ctx, { code: 'WIL-3007', message: 'Bucket secret refused', context: { stage: 'endpoint', reason: vet.reason } })
          return reply({ error: 'refused', detail: `${vet.detail} — the secret was not saved` }, 409)
        }
      }
    }
    const { error } = await ctx.admin.from('workspace_storage_secrets').upsert({
      workspace_id: ctx.workspaceId,
      secret_ciphertext: ciphertext,
      key_hint: hint,
      key_version: storageSecretCurrentVersion() ?? 1, // P8 (TPN-ENC-015): the version the envelope names
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

    // P8 (TPN-NET-016): the host the signer puts in every URL (the bucket's
    // own, when virtual-hosted) is vetted ONCE — a public literal, or a
    // public name whose every answer is public — and the three requests
    // below go to that one address, the name used for SNI only; a 3xx is
    // refused, never followed. s3Reach.ts; the reach check's own rules.
    const serverKey = probeKey(cfg.prefix, 'server')
    let endpointHost: string
    try {
      endpointHost = s3HostAndPath(target, serverKey).host
    } catch (err) {
      return reply({ error: 'refused', detail: err instanceof Error ? err.message : String(err) }, 409)
    }
    const deps = s3ReachDeps()
    const vetted = await vetS3Host(endpointHost, deps, { supabaseHost: new URL(Deno.env.get('SUPABASE_URL') ?? 'https://invalid').hostname })
    if (!vetted.ok) {
      await logAdminEvent(ctx, { code: 'WIL-3007', message: 'Bucket probe failed', context: { stage: 'endpoint', reason: vetted.reason } })
      return reply({ error: 'refused', stage: 'endpoint', detail: vetted.detail }, 409)
    }
    const redirected = (stage: string, status: number) => reply({
      error: 'probe_failed', stage, status,
      detail: `the bucket endpoint answered a redirect (HTTP ${status}), which WILSON does not follow — give the endpoint the bucket answers at directly`,
    }, 502)

    // Server-side round trip: PUT → GET → DELETE. Any thrown request is an
    // unreachable endpoint (DNS/TLS/addressing), which gets the
    // forcePathStyle sentence — measured shape: a wrong style resolves a
    // bucket subdomain that does not exist.
    const stages: Record<string, number | string> = { method: 'none' }
    const payload = 'wilson-probe'
    try {
      let t0 = Date.now()
      const putRes = await s3Request({ url: await sign('PUT', serverKey), method: 'PUT', body: payload, vetted, deps })
      stages.put_ms = Date.now() - t0
      stages.method = putRes.method
      if (putRes.redirect) {
        await logAdminEvent(ctx, { code: 'WIL-3007', message: 'Bucket probe failed', context: { stage: 'redirect', status: putRes.status } })
        return redirected('put', putRes.status)
      }
      if (putRes.status < 200 || putRes.status >= 300) {
        const status = putRes.status
        const detail =
          status === 403 ? 'the bucket refused the credentials (403) — check the access key id and the secret' :
          status === 404 ? `no such bucket "${cfg.bucket}" at this endpoint (404) — check the bucket name and region` :
          `the probe upload was refused (HTTP ${status})`
        await logAdminEvent(ctx, { code: 'WIL-3007', message: 'Bucket probe failed', context: { stage: 'put', status } })
        return reply({ error: 'probe_failed', stage: 'put', status, detail }, 502)
      }
      t0 = Date.now()
      const getRes = await s3Request({ url: await sign('GET', serverKey), method: 'GET', vetted, deps })
      stages.get_ms = Date.now() - t0
      if (getRes.redirect) {
        await logAdminEvent(ctx, { code: 'WIL-3007', message: 'Bucket probe failed', context: { stage: 'redirect', status: getRes.status } })
        return redirected('get', getRes.status)
      }
      const getOk = getRes.status >= 200 && getRes.status < 300
      const text = getOk ? getRes.text : ''
      if (!getOk || text !== payload) {
        await logAdminEvent(ctx, { code: 'WIL-3007', message: 'Bucket probe failed', context: { stage: 'get', status: getRes.status } })
        return reply({
          error: 'probe_failed', stage: 'get', status: getRes.status,
          detail: getOk
            ? 'the probe object read back with different content — something between WILSON and the bucket is rewriting bodies'
            : `the probe object could not be read back (HTTP ${getRes.status})`,
        }, 502)
      }
      t0 = Date.now()
      const delRes = await s3Request({ url: await sign('DELETE', serverKey), method: 'DELETE', vetted, deps })
      stages.del_ms = Date.now() - t0
      if (delRes.redirect) {
        await logAdminEvent(ctx, { code: 'WIL-3007', message: 'Bucket probe failed', context: { stage: 'redirect', status: delRes.status } })
        return redirected('del', delRes.status)
      }
      if ((delRes.status < 200 || delRes.status >= 300) && delRes.status !== 404) {
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
