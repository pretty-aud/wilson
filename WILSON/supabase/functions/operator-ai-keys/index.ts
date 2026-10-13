// =============================================================================
// operator-ai-keys — Session 15 (Platform Operator Console, locked #21)
//
// Per-company Anthropic API key management: the config surface for the seam
// ai-proxy has resolved against since S12. Two actions, `set` and `clear`;
// there is deliberately no `get`.
//
// A key goes IN and never comes back out. The operator who sets it is the
// last party to see it in plaintext — after that the row holds AES-256-GCM
// ciphertext (_shared/aiKeyCrypto.ts) plus a four-character hint, and the
// only reader is ai-proxy with service role. That is locked decision #8
// ("passwords are show-once at creation, never visible afterward") applied
// to tenant credentials, and it is why the console lists keys as "…9f2c"
// rather than offering a reveal.
//
// The key is validated by USING it: a `set` makes one minimal call to
// Anthropic before storing anything. A key that is typo'd, revoked, or
// belongs to a suspended account would otherwise be stored happily and only
// surface as a wall of failed generations for that company days later —
// with ai-proxy's fail-soft quietly spending the PLATFORM key in the
// meantime, which is the expensive failure mode.
// =============================================================================

import {
  corsHeaders,
  reply,
  requirePlatformOperator,
  logPlatformEvent,
} from '../_shared/operatorGuard.ts'
import { isRateLimited, envInt } from '../_shared/rateLimit.ts'
import {
  encryptAiKey,
  keyHint,
  aiKeyCryptoConfigured,
} from '../_shared/aiKeyCrypto.ts'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
// Cheapest possible round trip that still proves the credential works.
const VALIDATION_MODEL = 'claude-haiku-4-5-20251001'

/**
 * Prove the key authenticates. A 401/403 from Anthropic means the key is
 * bad and we refuse to store it; anything else (rate limit, overload,
 * network) is inconclusive and must NOT be read as invalid — refusing a
 * good key because Anthropic was briefly busy would be its own bug.
 */
async function validateKey(key: string): Promise<{ ok: boolean; status: number; detail?: string }> {
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: VALIDATION_MODEL,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    if (res.status === 401 || res.status === 403) {
      const j = await res.json().catch(() => ({}))
      return { ok: false, status: res.status, detail: j?.error?.message ?? 'rejected by Anthropic' }
    }
    return { ok: true, status: res.status }
  } catch (err) {
    // Unreachable upstream is inconclusive, not invalid.
    return { ok: true, status: 0, detail: String((err as Error).message ?? err) }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)

  const guard = await requirePlatformOperator(req)
  if (!guard.ok) return guard.res
  const ctx = guard.ctx

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return reply({ error: 'bad_json' }, 400) }

  const action = typeof body.action === 'string' ? body.action : ''
  if (action !== 'set' && action !== 'clear') {
    return reply({ error: 'validation_failed', errors: [{ field: 'action', error: 'unknown' }] }, 400)
  }

  const limited = await isRateLimited(
    ctx.admin, 'operator-write', ctx.callerId, envInt('OPERATOR_WRITE_RPM', 20), 60,
  )
  if (limited) return reply({ error: 'rate_limited' }, 429)

  const workspaceId = typeof body.workspace_id === 'string' ? body.workspace_id : ''
  if (!workspaceId) {
    return reply({ error: 'validation_failed', errors: [{ field: 'workspace_id', error: 'required' }] }, 400)
  }

  const { data: ws } = await ctx.admin
    .from('workspaces')
    .select('id, name, slug')
    .eq('id', workspaceId)
    .maybeSingle()
  if (!ws) return reply({ error: 'not_found' }, 404)

  // ── clear ─────────────────────────────────────────────────────────────────
  // The company falls back to the platform key on its next AI call — that is
  // ai-proxy's resolution order, not an outage.
  if (action === 'clear') {
    const { error } = await ctx.admin
      .from('workspace_ai_keys')
      .delete()
      .eq('workspace_id', workspaceId)
    if (error) return reply({ error: 'update_failed', detail: error.message }, 500)

    await logPlatformEvent(ctx, {
      action: 'ai_key.cleared',
      workspaceId,
      workspaceSlug: ws.slug as string,
      workspaceName: ws.name as string,
      code: 'WIL-7011',
      severity: 'warning',
      message: `Cleared the Anthropic key for ${ws.slug} (falls back to the platform key)`,
    })
    return reply({ workspace_id: workspaceId, has_key: false })
  }

  // ── set ───────────────────────────────────────────────────────────────────
  if (!aiKeyCryptoConfigured()) {
    // 501, not 503 — a missing secret is a permanent config state, and the
    // console should say "configure WILSON_AI_KEY_SECRET" rather than invite
    // a retry (the S12 ai_not_configured precedent).
    return reply({ error: 'key_crypto_not_configured' }, 501)
  }

  const key = typeof body.api_key === 'string' ? body.api_key.trim() : ''
  if (key.length < 20 || key.length > 500) {
    return reply({ error: 'validation_failed', errors: [{ field: 'api_key', error: 'length' }] }, 400)
  }

  const check = await validateKey(key)
  if (!check.ok) {
    return reply({ error: 'key_rejected', detail: check.detail }, 400)
  }

  let ciphertext: string
  try {
    ciphertext = await encryptAiKey(key)
  } catch (err) {
    return reply({ error: 'encrypt_failed', detail: String((err as Error).message ?? err) }, 500)
  }

  const { error } = await ctx.admin
    .from('workspace_ai_keys')
    .upsert({
      workspace_id: workspaceId,
      key_ciphertext: ciphertext,
      key_hint: keyHint(key),
      key_version: 1,
      updated_at: new Date().toISOString(),
      updated_by: ctx.callerId,
    }, { onConflict: 'workspace_id' })
  if (error) return reply({ error: 'update_failed', detail: error.message }, 500)

  await logPlatformEvent(ctx, {
    action: 'ai_key.set',
    workspaceId,
    workspaceSlug: ws.slug as string,
    workspaceName: ws.name as string,
    code: 'WIL-7010',
    message: `Set the Anthropic key for ${ws.slug} (…${keyHint(key)})`,
    // The hint only. Never the key, never the ciphertext — an audit row is
    // readable by every operator and lands in the nightly dump.
    context: { key_hint: keyHint(key), validated: check.status !== 0 },
  })

  return reply({
    workspace_id: workspaceId,
    has_key: true,
    key_hint: keyHint(key),
    // false when Anthropic was unreachable — the key was stored on the
    // benefit of the doubt and the console says so rather than implying a
    // verification that never happened.
    validated: check.status !== 0,
  })
})
