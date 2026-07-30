// =============================================================================
// ai-proxy Edge Function — Session 12 (locked decision #21)
//
// The ONLY path between WILSON clients and api.anthropic.com, on BOTH hosts.
// No Anthropic key ever reaches a client: the browser build must not ship a
// credential, and Electron deliberately uses the same path so there is no
// desktop/web divergence (a second code path is exactly how gap #21 happened).
//
//   * Auth: verify_jwt=false (ES256 gateway opt-out, same as issue-session);
//     claims from the TOKEN payload + a LIVE workspace_members row check via
//     _shared/memberGuard.ts — a deactivated member must not spend money.
//   * Key resolution: per-workspace key first (workspace_ai_keys — the table
//     landed with the S15 operator console, migration 0028; the read still
//     fails soft), then the platform key in the ANTHROPIC_API_KEY secret.
//     This seam is what makes admin-portal key management a config change,
//     not a rewrite. The stored value is AES-256-GCM ciphertext, not a key:
//     see _shared/aiKeyCrypto.ts for why (short version — the nightly
//     pg_dump goes off-platform to B2).
//   * Streaming: the upstream request is ALWAYS stream:true and the SSE is
//     piped through verbatim. Edge Functions must emit a response within
//     150s; O.T.T.E.R. generations regularly run past that, so a synchronous
//     proxy would 504 and lose the generation. First byte of an SSE arrives
//     immediately, so only the 400s wall clock governs. The client reassembles
//     the stream into the classic non-streaming message object
//     (src/cloud/aiProxy.js) — no call site sees SSE.
//   * Usage: each completed request logs model + input/output tokens to
//     app_events (0021) via service role — event_type 'system', WIL-6001/2
//     (the 'admin' stream and WIL-41xx are server-reserved for admin audit
//     lines; this is spend telemetry, not an audit line). Context carries
//     technical metadata only, never prompt content (TPN).
//   * Rate limit: DURABLE, per workspace, shared by every isolate
//     (public.fn_rate_limit_hit, migration 0028 — MASTER_PLAN §6 #16 closed
//     in S15). It used to be an in-memory Map, which meant the real limit
//     was AI_PROXY_RPM × however many isolates happened to be warm, resetting
//     on every cold start — an unknowable number on the one endpoint whose
//     overage is billed by Anthropic.
// =============================================================================

import { corsHeaders, reply } from '../_shared/adminGuard.ts'
import { requireActiveMember, type MemberContext } from '../_shared/memberGuard.ts'
import { isRateLimited, envInt } from '../_shared/rateLimit.ts'
import { decryptAiKey } from '../_shared/aiKeyCrypto.ts'

type MemberCtxAdmin = MemberContext['admin']

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

// envInt applies the same NaN guard the in-memory limiter needed:
// Number('60rpm') is NaN, and every comparison against NaN is false, which
// would silently switch the limiter off rather than fall back to a default.
const RPM = envInt('AI_PROXY_RPM', 60)

// ── Key resolution: per-workspace → platform fallback (locked #21) ───────────
async function resolveAnthropicKey(
  admin: MemberCtxAdmin,
  workspaceId: string,
): Promise<{ key: string; source: 'workspace' | 'platform' } | null> {
  try {
    // workspace_ai_keys (0028) holds AES-256-GCM ciphertext written by
    // operator-ai-keys, never a plaintext key. Any failure here — table
    // missing, no row for this tenant, WILSON_AI_KEY_SECRET unset, an
    // envelope this build cannot open — falls through to the platform key
    // rather than failing the request. That is deliberate: a tenant key is
    // a billing preference, not an authorization boundary, and an operator
    // rotating a secret must not take a company's AI features offline.
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

// ── Usage telemetry (best-effort; never blocks or fails the stream) ──────────
type UsageTally = {
  model: string
  tool: string | null
  inputTokens: number | null
  outputTokens: number | null
  stopReason: string | null
  // Which key paid for this call. Computed since S12 but never recorded;
  // with per-workspace keys actually in use (S15) the operator console's
  // spend view needs to separate "this company's own key" from "billed to
  // the platform", and app_events is where that number comes from.
  keySource: 'workspace' | 'platform' | null
}

async function logUsage(
  admin: MemberCtxAdmin,
  workspaceId: string,
  callerId: string,
  tally: UsageTally,
  ok: boolean,
): Promise<void> {
  try {
    await admin.from('app_events').insert({
      workspace_id: workspaceId,
      actor_user_id: callerId,
      event_type: 'system',
      code: ok ? 'WIL-6001' : 'WIL-6002',
      severity: ok ? 'info' : 'warning',
      message: ok
        ? `AI request completed (${tally.model})`
        : `AI request failed (${tally.model})`,
      context: {
        model: tally.model,
        tool: tally.tool,
        input_tokens: tally.inputTokens,
        output_tokens: tally.outputTokens,
        stop_reason: tally.stopReason,
        key_source: tally.keySource,
      },
    })
  } catch { /* telemetry never breaks the request */ }
}

// ── SSE usage sniffer ─────────────────────────────────────────────────────────
// Pipes bytes through untouched while parsing `data:` lines for message_start
// (input_tokens) and message_delta (output_tokens, stop_reason). On stream end
// the tally is logged. Parsing rides a line buffer so events split across
// chunk boundaries are still seen.
function usageSniffer(
  tally: UsageTally,
  onDone: (completed: boolean) => void,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder()
  let lineBuf = ''
  // Anthropic can 200 and then end the stream with an in-stream `error`
  // event (overloaded_error under load). The stream still closes normally,
  // so track it — otherwise every failed-and-retried attempt would be
  // logged WIL-6001 "completed".
  let sawError = false

  const sniffLine = (line: string) => {
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') return
    try {
      const evt = JSON.parse(payload)
      if (evt.type === 'message_start' && evt.message?.usage) {
        tally.inputTokens = evt.message.usage.input_tokens ?? null
      } else if (evt.type === 'message_delta') {
        if (evt.usage?.output_tokens != null) tally.outputTokens = evt.usage.output_tokens
        if (evt.delta?.stop_reason) tally.stopReason = evt.delta.stop_reason
      } else if (evt.type === 'error') {
        sawError = true
        tally.stopReason = evt.error?.type ?? 'error'
      }
    } catch { /* not JSON we care about */ }
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk)
      lineBuf += decoder.decode(chunk, { stream: true })
      const lines = lineBuf.split('\n')
      lineBuf = lines.pop() ?? ''
      for (const line of lines) sniffLine(line.trimEnd())
    },
    flush() {
      if (lineBuf) sniffLine(lineBuf.trimEnd())
      onDone(!sawError)
    },
    cancel() {
      // Client went away mid-stream. Anthropic still bills what was
      // generated, so record what we saw before the disconnect.
      onDone(false)
    },
  })
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

  if (await isRateLimited(admin, 'ai-proxy', workspaceId, RPM, 60)) {
    return reply({ error: 'rate_limited' }, 429)
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return reply({ error: 'bad_json' }, 400) }

  // Model ids are short; the cap keeps a hostile string out of the
  // app_events message/context CHECKs (0021: message ≤ 2000, context ≤ 8000).
  const model = typeof body.model === 'string' ? body.model.slice(0, 100) : ''
  const maxTokens = typeof body.max_tokens === 'number' ? body.max_tokens : 0
  const messages = Array.isArray(body.messages) ? body.messages : null
  if (!model || !maxTokens || maxTokens < 1 || !messages || messages.length === 0) {
    const field = !model ? 'model' : (!maxTokens || maxTokens < 1) ? 'max_tokens' : 'messages'
    return reply({
      error: 'validation_failed',
      errors: [{ field, error: 'required' }],
    }, 400)
  }

  // `tool` is WILSON's own attribution hint (which tool spent the tokens).
  // It is logged, never forwarded upstream. `betas` becomes the
  // anthropic-beta header, exactly as the direct callers set it.
  const tool = typeof body.tool === 'string' ? body.tool.slice(0, 40) : null
  const betas = typeof body.betas === 'string' ? body.betas : null

  // Whitelist the upstream body — clients cannot smuggle arbitrary fields
  // (stream is forced on, and the key never comes from the client).
  const upstreamBody: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages,
    stream: true,
  }
  if (body.system != null) upstreamBody.system = body.system
  if (Array.isArray(body.tools) && body.tools.length > 0) upstreamBody.tools = body.tools

  const resolved = await resolveAnthropicKey(admin, workspaceId)
  if (!resolved) {
    // 501, not 503: this is a permanent config state, and every client retry
    // loop treats 429/503/529 as transient — a 503 here would burn ~21s of
    // pointless retries before the honest message surfaced. 501 matches the
    // otterFetch precedent for "this surface isn't available here".
    return reply({ error: 'ai_not_configured' }, 501)
  }

  const upstreamHeaders: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': resolved.key,
    'anthropic-version': ANTHROPIC_VERSION,
  }
  if (betas) upstreamHeaders['anthropic-beta'] = betas

  let upstream: Response
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify(upstreamBody),
      signal: req.signal,
    })
  } catch {
    return reply({ error: 'upstream_unreachable' }, 502)
  }

  const tally: UsageTally = {
    model,
    tool,
    inputTokens: null,
    outputTokens: null,
    stopReason: null,
    keySource: resolved.source,
  }

  if (!upstream.ok || !upstream.body) {
    // Forward Anthropic's status verbatim — every client retry loop keys on
    // 429/503/529. The error JSON keeps Anthropic's shape under `anthropic`
    // so callers can surface the real message.
    const errJson = await upstream.json().catch(() => ({}))
    await logUsage(admin, workspaceId, callerId, tally, false)
    return reply({ error: 'upstream_error', anthropic: errJson }, upstream.status || 502)
  }

  const done = (completed: boolean) => {
    const p = logUsage(admin, workspaceId, callerId, tally, completed)
    // Supabase's runtime keeps background work alive via waitUntil; fall
    // back to letting the promise float (best-effort either way).
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime
    if (rt?.waitUntil) rt.waitUntil(p)
  }

  return new Response(upstream.body.pipeThrough(usageSniffer(tally, done)), {
    status: 200,
    headers: {
      ...corsHeaders,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
    },
  })
})
