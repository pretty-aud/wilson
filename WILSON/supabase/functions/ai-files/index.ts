// =============================================================================
// ai-files Edge Function — the upload half of locked decision #21.
//
// WHY THIS EXISTS
// -----------------------------------------------------------------------------
// On 2026-08-10/11 D.O.G. could not generate a deck at all. ai-proxy returned
// HTTP 546 — the Supabase Edge Runtime killing the worker for exceeding its
// resource ceiling INSTEAD of returning a response. Measured from app_events:
// D.O.G.'s last successful deck (2026-08-03) carried 232,275 input tokens of
// base64 documents; every attempt since logged NO usage row at all, and
// ai-proxy logs one even when a stream is cancelled mid-generation. So the
// worker was dying before it reached Anthropic — while doing `req.json()` on a
// multi-megabyte body and `JSON.stringify()`ing it straight back out.
//
// Neither `effort` nor `max_tokens` can reach that: both govern OUTPUT. The fix
// is to stop pushing whole documents through the Edge worker's JSON body at
// all. Files are uploaded ONCE to Anthropic's Files API and referenced by
// `file_id` thereafter, so the body ai-proxy relays stays a few KB no matter
// how much source material a deck carries — Audrey's constraint, verbatim:
// "do not put a limit to how long it takes or lengths of output or inputs".
//
// -----------------------------------------------------------------------------
// 🚨 THE ONE INVARIANT: NEVER MATERIALISE THE BODY
// -----------------------------------------------------------------------------
// `req.body` is piped straight into the upstream fetch with `duplex: 'half'`.
// Do NOT add `req.json()`, `req.formData()`, `req.arrayBuffer()`, `req.text()`,
// or anything that buffers — every one of them reintroduces exactly the failure
// this function exists to fix, and it will present as a 546 with no log line
// rather than as an error you can read.
//
// The multipart boundary and the `file` field name are built by the client
// (src/cloud/aiFiles.js), so `content-type` is forwarded verbatim. This
// function inspects nothing about the payload; it authenticates the caller,
// attaches the key, and gets out of the way.
// =============================================================================

import { corsHeaders, reply } from '../_shared/adminGuard.ts'
import { requireActiveMember, type MemberContext } from '../_shared/memberGuard.ts'
import { isRateLimited, envInt } from '../_shared/rateLimit.ts'
import { decryptAiKey } from '../_shared/aiKeyCrypto.ts'

type MemberCtxAdmin = MemberContext['admin']

const ANTHROPIC_FILES_URL = 'https://api.anthropic.com/v1/files'
const ANTHROPIC_VERSION = '2023-06-01'
// Required on the upload AND on every messages request that references the
// resulting file_id. The client sends the second one via ai-proxy's `betas`
// passthrough — see src/cloud/aiProxy.js and the callAI body in D.O.G.
const FILES_BETA = 'files-api-2025-04-14'

// Uploads are cheap for Anthropic but not free for us to relay, and a runaway
// client could otherwise pin a worker. Shares AI_PROXY_RPM's default rather
// than inventing a second knob nobody knows exists.
const RPM = envInt('AI_FILES_RPM', envInt('AI_PROXY_RPM', 60))

// ── Key resolution ───────────────────────────────────────────────────────────
// 🚨 DUPLICATED FROM ai-proxy/index.ts ON PURPOSE. Keep the two in step.
//
// It is not shared through _shared/ because that would require redeploying
// ai-proxy, and on 2026-08-11 ai-proxy was measured byte-identical to this
// repo on all three environments while being the ONLY working AI path in the
// product (O.T.T.E.R. runs through it). Preserving that identity was worth ~20
// duplicated lines. If you ever do extract this, extract it for both callers in
// one commit and redeploy both — a half-migration is worse than the copy.
//
// Same fail-soft rule as the original: any failure reading the per-workspace
// key falls through to the platform key rather than failing the request. A
// tenant key is a billing preference, not an authorization boundary.
async function resolveAnthropicKey(
  admin: MemberCtxAdmin,
  workspaceId: string,
): Promise<{ key: string; source: 'workspace' | 'platform' } | null> {
  try {
    const { data, error } = await admin
      .from('workspace_ai_keys')
      .select('key_ciphertext, key_version')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (!error && data?.key_ciphertext) {
      const plain = await decryptAiKey(data.key_ciphertext as string)
      if (plain) return { key: plain, source: 'workspace' }
    }
  } catch { /* fall through to platform key */ }
  const platform = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
  return platform ? { key: platform, source: 'platform' } : null
}

// ── Telemetry ────────────────────────────────────────────────────────────────
// Reuses ai-proxy's WIL-6001/6002 codes deliberately: 0021's `code` CHECK is a
// closed set, and a brand-new code would fail the insert. The `tool` tag
// separates these rows from generation rows.
//
// This exists because the ABSENCE of telemetry is what made the 546 outage take
// three passes to diagnose — a failure that logs nothing is indistinguishable
// from a request that was never made.
async function logUpload(
  admin: MemberCtxAdmin,
  workspaceId: string,
  callerId: string,
  ok: boolean,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await admin.from('app_events').insert({
      workspace_id: workspaceId,
      actor_user_id: callerId,
      event_type: 'system',
      code: ok ? 'WIL-6001' : 'WIL-6002',
      severity: ok ? 'info' : 'warning',
      message: ok ? 'AI file upload completed' : 'AI file upload failed',
      // Technical metadata only — never filename content or payload bytes (TPN).
      context: { tool: 'ai-files', ...detail },
    })
  } catch { /* telemetry never breaks the request */ }
}

// ── Handler ──────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)

  const guard = await requireActiveMember(req)
  if (!guard.ok) return guard.res
  const { admin, workspaceId, callerId } = guard.ctx

  if (await isRateLimited(admin, 'ai-files', workspaceId, RPM, 60)) {
    return reply({ error: 'rate_limited' }, 429)
  }

  // The multipart boundary lives in this header. Without it the upstream
  // cannot parse the stream, so a missing content-type is a client bug worth
  // naming rather than forwarding into an opaque upstream 400.
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return reply({
      error: 'validation_failed',
      errors: [{ field: 'content-type', error: 'expected multipart/form-data' }],
    }, 400)
  }
  if (!req.body) {
    return reply({
      error: 'validation_failed',
      errors: [{ field: 'body', error: 'required' }],
    }, 400)
  }

  const resolved = await resolveAnthropicKey(admin, workspaceId)
  if (!resolved) {
    // 501 not 503, matching ai-proxy: a missing key is a permanent config
    // state, and every client retry loop treats 503 as transient.
    return reply({ error: 'ai_not_configured' }, 501)
  }

  let upstream: Response
  try {
    upstream = await fetch(ANTHROPIC_FILES_URL, {
      method: 'POST',
      headers: {
        'content-type': contentType,
        'x-api-key': resolved.key,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': FILES_BETA,
      },
      // 🚨 The whole point. `req.body` is a ReadableStream and is forwarded
      // without ever being read into memory here. `duplex: 'half'` is REQUIRED
      // to send a stream body — without it the runtime throws before the
      // request leaves, and the fix looks like an unrelated network error.
      body: req.body,
      // deno-lint-ignore no-explicit-any
      duplex: 'half',
      signal: req.signal,
    } as RequestInit & { duplex: 'half' })
  } catch (err) {
    await logUpload(admin, workspaceId, callerId, false, {
      key_source: resolved.source,
      stage: 'upstream_fetch',
      detail: String((err as Error)?.message ?? err).slice(0, 200),
    })
    return reply({ error: 'upstream_unreachable' }, 502)
  }

  // Anthropic's response is small JSON either way, so reading it here is safe —
  // this is the one body in this function that is allowed to be materialised.
  const json = await upstream.json().catch(() => ({}))

  if (!upstream.ok) {
    await logUpload(admin, workspaceId, callerId, false, {
      key_source: resolved.source,
      stage: 'upstream_error',
      status: upstream.status,
    })
    // Forward the status verbatim so client retry loops keep working, and keep
    // Anthropic's own shape under `anthropic` exactly as ai-proxy does.
    return reply({ error: 'upstream_error', anthropic: json }, upstream.status || 502)
  }

  await logUpload(admin, workspaceId, callerId, true, {
    key_source: resolved.source,
    file_id: (json as Record<string, unknown>)?.id ?? null,
    size_bytes: (json as Record<string, unknown>)?.size_bytes ?? null,
    mime_type: (json as Record<string, unknown>)?.mime_type ?? null,
  })

  return reply(json as Record<string, unknown>, 200)
})
