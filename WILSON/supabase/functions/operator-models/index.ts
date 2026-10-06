// =============================================================================
// operator-models — Session 20
//
// The write half of the model control plane. Migration 0031 gives
// platform_approved_models and platform_model_defaults a read policy and NO
// write policy, and revokes the write privileges from `authenticated`, so this
// function under service_role is the ONLY way either table changes — including
// for a platform operator holding a browser session.
//
// That is not defence in depth for its own sake; it is what makes D5
// enforceable. D5 says a model id must be validated against Anthropic before
// it can be saved. If an operator could INSERT through PostgREST, the
// validation below would be decorative and one crafted request would put an
// unvalidated id into every company's picker.
//
// -----------------------------------------------------------------------------
// VALIDATION POLARITY — read this before reusing validateKey
// -----------------------------------------------------------------------------
// The S20 plan says this "reuses the proven validateKey call shape" from
// operator-ai-keys. The BODY is the same — a 1-token POST /v1/messages — but
// the STATUS HANDLING is inverted, and copying it wholesale would be a bug:
//
//   validateKey is validating a KEY. It returns ok for anything that is not
//   401/403, INCLUDING a 404, because an unknown model with a good key still
//   proves the key authenticates.
//
//   validateModel is validating a MODEL. A 404 is precisely the signal that
//   means refuse.
//
// So:
//   404 (or an error type of not_found_error)  -> REFUSE. The model is not real.
//   2xx                                        -> validated.
//   401/403                                    -> our platform key is bad. We
//                                                 learned nothing about the
//                                                 model: inconclusive.
//   429 / 5xx / network / anything else        -> inconclusive.
//
// Inconclusive is NOT invalid. The row saves with validation='unverified' and
// the response says `validated: false` so the console can show it honestly.
// Refusing a good model because Anthropic was briefly busy would be its own
// bug — the same clause operator-ai-keys carries, for the same reason.
// =============================================================================

import {
  corsHeaders,
  reply,
  requirePlatformOperator,
  logPlatformEvent,
} from '../_shared/operatorGuard.ts'
import { isRateLimited, envInt } from '../_shared/rateLimit.ts'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

// Mirrors isWellFormedModelId() in src/lib/aiModels.js and the CHECK on
// platform_approved_models.model_id. Shape only — Anthropic is the authority
// on whether an id resolves, which is what the probe below is for.
const MODEL_ID_RE = /^claude-[a-z0-9][a-z0-9.-]{2,63}$/
// Mirrors EFFORT_LEVELS in src/lib/aiModels.js and the CHECK on
// platform_model_defaults.effort.
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
// Shape of a REGISTRY key. Deliberately not an enumeration of the 28 — the
// registry lives in code and a new call site must not need a redeploy here.
const REGISTRY_KEY_RE = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+)+$/

type ModelCheck = {
  verdict: 'valid' | 'rejected' | 'inconclusive'
  status: number
  detail?: string
}

/**
 * Ask Anthropic whether this model id resolves, with the platform key.
 * See the polarity note in the header — this is NOT validateKey with a
 * different argument.
 */
async function validateModel(modelId: string): Promise<ModelCheck> {
  const key = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
  if (!key) {
    // No key to probe with. Permanent config state, not a transient failure,
    // but it still tells us nothing about the model.
    return { verdict: 'inconclusive', status: 0, detail: 'ANTHROPIC_API_KEY is not set on this project' }
  }

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })

    if (res.ok) return { verdict: 'valid', status: res.status }

    const body = await res.json().catch(() => ({}))
    const errType = body?.error?.type ?? ''
    const errMsg = body?.error?.message ?? `HTTP ${res.status}`

    // The one case that means "this model does not exist".
    if (res.status === 404 || errType === 'not_found_error') {
      return { verdict: 'rejected', status: res.status, detail: errMsg }
    }

    // Our credential is bad. That is worth saying out loud, but it is not
    // evidence about the model.
    if (res.status === 401 || res.status === 403) {
      return {
        verdict: 'inconclusive',
        status: res.status,
        detail: `the platform Anthropic key was rejected (${errMsg}) — the model could not be checked`,
      }
    }

    return { verdict: 'inconclusive', status: res.status, detail: errMsg }
  } catch (err) {
    // Unreachable upstream is inconclusive, never invalid.
    return { verdict: 'inconclusive', status: 0, detail: String((err as Error)?.message ?? err) }
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
  const KNOWN = ['list', 'approve', 'retire', 'restore', 'set_default', 'clear_default']
  if (!KNOWN.includes(action)) {
    return reply({ error: 'validation_failed', errors: [{ field: 'action', error: 'unknown' }] }, 400)
  }

  // ── list ──────────────────────────────────────────────────────────────────
  // Read-only, so it runs before the write rate limiter. The console calls it
  // on every render of the models section.
  if (action === 'list') {
    const { data: models, error: modelsErr } = await ctx.admin
      .from('platform_approved_models')
      .select('model_id, label, hint, sort_order, validation, validated_at, retired_at, created_at, updated_at')
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true })
    if (modelsErr) return reply({ error: 'read_failed', detail: modelsErr.message }, 500)

    const { data: defaults, error: defErr } = await ctx.admin
      .from('platform_model_defaults')
      .select('registry_key, model_id, effort, updated_at')
    if (defErr) return reply({ error: 'read_failed', detail: defErr.message }, 500)

    return reply({ models: models ?? [], defaults: defaults ?? [] })
  }

  const limited = await isRateLimited(
    ctx.admin, 'operator-write', ctx.callerId, envInt('OPERATOR_WRITE_RPM', 20), 60,
  )
  if (limited) return reply({ error: 'rate_limited' }, 429)

  // ── approve ───────────────────────────────────────────────────────────────
  if (action === 'approve') {
    const modelId = typeof body.model_id === 'string' ? body.model_id.trim() : ''
    const label = typeof body.label === 'string' ? body.label.trim() : ''
    const hint = typeof body.hint === 'string' ? body.hint.trim() : ''
    const sortOrder = typeof body.sort_order === 'number' ? Math.trunc(body.sort_order) : 100

    if (!MODEL_ID_RE.test(modelId)) {
      return reply({ error: 'validation_failed', errors: [{ field: 'model_id', error: 'shape' }] }, 400)
    }
    if (label.length < 1 || label.length > 64) {
      return reply({ error: 'validation_failed', errors: [{ field: 'label', error: 'length' }] }, 400)
    }
    if (hint.length > 200) {
      return reply({ error: 'validation_failed', errors: [{ field: 'hint', error: 'length' }] }, 400)
    }

    // D5. This is the gate the RLS design exists to protect.
    const check = await validateModel(modelId)
    if (check.verdict === 'rejected') {
      return reply({
        error: 'model_rejected',
        detail: check.detail ?? 'Anthropic does not recognise this model id',
        status: check.status,
      }, 400)
    }

    const validated = check.verdict === 'valid'
    const nowIso = new Date().toISOString()

    const { error } = await ctx.admin
      .from('platform_approved_models')
      .upsert({
        model_id: modelId,
        label,
        hint,
        sort_order: sortOrder,
        validation: validated ? 'validated' : 'unverified',
        validated_at: validated ? nowIso : null,
        // Re-approving a retired model brings it back; that is what the
        // console's "restore" does too, and doing it here as well means an
        // operator cannot get stuck with a retired row they cannot re-add.
        retired_at: null,
        retired_by: null,
        approved_by: ctx.callerId,
        updated_at: nowIso,
      }, { onConflict: 'model_id' })
    if (error) return reply({ error: 'update_failed', detail: error.message }, 500)

    await logPlatformEvent(ctx, {
      action: 'model.approved',
      code: 'WIL-7020',
      severity: validated ? 'info' : 'warning',
      message: validated
        ? `Approved model ${modelId} (validated against Anthropic)`
        : `Approved model ${modelId} WITHOUT validation — Anthropic was unreachable or inconclusive`,
      context: { model_id: modelId, label, validated, status: check.status, detail: check.detail ?? null },
    })

    return reply({ model_id: modelId, validated, status: check.status, detail: check.detail ?? null })
  }

  // ── retire / restore ──────────────────────────────────────────────────────
  // Soft, always. Both override tables FK this row, so a hard delete would
  // either fail against a company that had selected it or orphan their choice.
  if (action === 'retire' || action === 'restore') {
    const modelId = typeof body.model_id === 'string' ? body.model_id.trim() : ''
    if (!MODEL_ID_RE.test(modelId)) {
      return reply({ error: 'validation_failed', errors: [{ field: 'model_id', error: 'shape' }] }, 400)
    }

    const { data: existing } = await ctx.admin
      .from('platform_approved_models')
      .select('model_id, label')
      .eq('model_id', modelId)
      .maybeSingle()
    if (!existing) return reply({ error: 'not_found' }, 404)

    const retiring = action === 'retire'
    const { error } = await ctx.admin
      .from('platform_approved_models')
      .update({
        retired_at: retiring ? new Date().toISOString() : null,
        retired_by: retiring ? ctx.callerId : null,
        updated_at: new Date().toISOString(),
      })
      .eq('model_id', modelId)
    if (error) return reply({ error: 'update_failed', detail: error.message }, 500)

    // How many companies and people were still pointing at it. An operator
    // retiring a model that 40 people have selected should know that before
    // they hear about it from the 40 people.
    const { count: wsCount } = await ctx.admin
      .from('workspace_model_overrides')
      .select('workspace_id', { count: 'exact', head: true })
      .eq('model_id', modelId)
    const { count: userCount } = await ctx.admin
      .from('user_model_overrides')
      .select('user_id', { count: 'exact', head: true })
      .eq('model_id', modelId)

    await logPlatformEvent(ctx, {
      action: retiring ? 'model.retired' : 'model.restored',
      code: retiring ? 'WIL-7021' : 'WIL-7022',
      severity: retiring ? 'warning' : 'info',
      message: retiring
        ? `Retired model ${modelId} (${wsCount ?? 0} company and ${userCount ?? 0} user overrides still point at it)`
        : `Restored model ${modelId} to the catalogue`,
      context: {
        model_id: modelId,
        workspace_overrides: wsCount ?? 0,
        user_overrides: userCount ?? 0,
      },
    })

    return reply({
      model_id: modelId,
      retired: retiring,
      // Retiring does not rewrite anyone's saved choice — the row stays
      // readable so resolution keeps working. These counts tell the console
      // how many surfaces will now show a model that is no longer offered.
      workspace_overrides: wsCount ?? 0,
      user_overrides: userCount ?? 0,
    })
  }

  // ── set_default / clear_default ───────────────────────────────────────────
  const registryKey = typeof body.registry_key === 'string' ? body.registry_key.trim() : ''
  if (!REGISTRY_KEY_RE.test(registryKey) || registryKey.length > 64) {
    return reply({ error: 'validation_failed', errors: [{ field: 'registry_key', error: 'shape' }] }, 400)
  }

  if (action === 'clear_default') {
    const { error } = await ctx.admin
      .from('platform_model_defaults')
      .delete()
      .eq('registry_key', registryKey)
    if (error) return reply({ error: 'update_failed', detail: error.message }, 500)

    await logPlatformEvent(ctx, {
      action: 'model.default_cleared',
      code: 'WIL-7024',
      message: `Cleared the platform default for ${registryKey} (falls back to the built-in model)`,
      context: { registry_key: registryKey },
    })
    return reply({ registry_key: registryKey, cleared: true })
  }

  // set_default
  const modelId = typeof body.model_id === 'string' ? body.model_id.trim() : ''
  const effortRaw = typeof body.effort === 'string' ? body.effort.trim() : ''
  const effort = effortRaw === '' ? null : effortRaw

  if (modelId !== '' && !MODEL_ID_RE.test(modelId)) {
    return reply({ error: 'validation_failed', errors: [{ field: 'model_id', error: 'shape' }] }, 400)
  }
  if (effort !== null && !EFFORT_LEVELS.includes(effort)) {
    return reply({ error: 'validation_failed', errors: [{ field: 'effort', error: 'unknown' }] }, 400)
  }

  // A default may only name a model that is IN the catalogue and LIVE. The FK
  // in 0031 already refuses anything absent; this check additionally refuses a
  // retired one, and returns a readable error instead of a constraint string.
  if (modelId !== '') {
    const { data: cat } = await ctx.admin
      .from('platform_approved_models')
      .select('model_id, retired_at')
      .eq('model_id', modelId)
      .maybeSingle()
    if (!cat) return reply({ error: 'model_not_approved', detail: modelId }, 400)
    if (cat.retired_at) return reply({ error: 'model_retired', detail: modelId }, 400)
  }

  const { error } = await ctx.admin
    .from('platform_model_defaults')
    .upsert({
      registry_key: registryKey,
      model_id: modelId === '' ? null : modelId,
      effort,
      updated_by: ctx.callerId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'registry_key' })
  if (error) return reply({ error: 'update_failed', detail: error.message }, 500)

  await logPlatformEvent(ctx, {
    action: 'model.default_set',
    code: 'WIL-7023',
    message: `Set the platform default for ${registryKey} to ${modelId || '(built-in)'}${effort ? ` at ${effort} effort` : ''}`,
    context: { registry_key: registryKey, model_id: modelId || null, effort },
  })

  return reply({ registry_key: registryKey, model_id: modelId || null, effort })
})
