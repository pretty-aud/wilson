// =============================================================================
// operatorApi — Session 15: client bindings for the operator Edge Functions.
//
// Mirrors src/cloud/adminApi.js exactly, including the rule that
// supabase.functions.invoke is never used anywhere in this codebase: raw
// fetch to /functions/v1/<name> with { apikey, authorization: Bearer }.
// Omitting `apikey` fails at the gateway before the function runs.
//
// Every call returns { ok, status, data } and NEVER throws on an HTTP error;
// data.friendly carries the human string. The one place that differs from
// adminApi: there is no reportAppEvent here. app_events is workspace-scoped
// and an operator has no workspace, so a client-side error line would have
// nowhere to land — the server side writes public.platform_audit instead.
// =============================================================================

import { supabase } from '../cloud/auth/supabaseClient'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

const FRIENDLY = {
  unauthorized: 'Session expired — sign in again.',
  forbidden: 'This account is not a platform operator.',
  operator_check_failed: 'Could not verify operator status. Try again in a moment.',
  mfa_required: 'Sign in again and enter your authenticator code.',
  mfa_check_failed: 'Could not verify your MFA status. Try again in a moment.',
  mfa_enrollment_required:
    'The operator console requires two-factor authentication. Enrol an authenticator in WILSON → Settings → Security, then sign in here again.',
  validation_failed: 'Some fields are invalid — check the form.',
  slug_taken: 'That slug is already in use by another company.',
  email_taken: 'That email already has an account.',
  not_found: 'That company no longer exists.',
  already_suspended: 'That company is already suspended.',
  not_suspended: 'That company is not suspended.',
  confirmation_mismatch: 'The slug you typed does not match.',
  key_rejected: 'Anthropic rejected that key — check it and try again.',
  key_crypto_not_configured:
    'Key storage is not configured for this environment (WILSON_AI_KEY_SECRET is unset).',
  rate_limited: 'Too many requests — wait a minute and try again.',
  scan_failed: 'Could not enumerate this company’s files; nothing was deleted.',
  teardown_failed: 'Teardown failed partway — check the audit log before retrying.',
  provision_failed: 'Company creation failed. Nothing was kept.',
  create_failed: 'Company creation failed. Nothing was kept.',
  update_failed: 'Update failed. Try again in a minute.',
  encrypt_failed: 'Could not encrypt the key — nothing was stored.',
  bad_json: 'Malformed request.',
  method_not_allowed: 'Malformed request.',
  // Session 20 — the model catalogue.
  model_rejected: 'Anthropic does not recognise that model ID — nothing was saved.',
  model_not_approved: 'That model is not in the approved catalogue.',
  model_retired: 'That model is retired — restore it before making it a default.',
  read_failed: 'Could not read the model catalogue. Try again in a moment.',
}

async function callOperatorFn(name, body) {
  let token = null
  try {
    const { data } = await supabase.auth.getSession()
    token = data?.session?.access_token ?? null
  } catch { /* fall through to unauthorized */ }
  if (!token) {
    return { ok: false, status: 401, data: { error: 'unauthorized', friendly: FRIENDLY.unauthorized } }
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: SUPABASE_ANON,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body ?? {}),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      const friendly = FRIENDLY[json.error] ?? `Request failed (${res.status}).`
      return { ok: false, status: res.status, data: { ...json, friendly } }
    }
    return { ok: true, status: res.status, data: json }
  } catch {
    return { ok: false, status: 0, data: { error: 'network', friendly: 'Network error — check your connection.' } }
  }
}

/** Cross-tenant roll-up: one row per company with member/project/file counts. */
export function listWorkspaces() {
  return callOperatorFn('operator-workspaces', { action: 'list' })
}

/** Create a company and its first admin. Returns a show-once password. */
export function createWorkspace({ name, slug, adminUsername, adminDisplayName, adminEmail }) {
  return callOperatorFn('operator-workspaces', {
    action: 'create',
    name,
    slug,
    admin_username: adminUsername,
    admin_display_name: adminDisplayName || '',
    admin_email: adminEmail || '',
  })
}

export function renameWorkspace(workspaceId, name) {
  return callOperatorFn('operator-workspaces', { action: 'rename', workspace_id: workspaceId, name })
}

/** Soft delete — reversible. Members lose access; nothing is destroyed. */
export function setWorkspaceSuspended(workspaceId, suspended) {
  return callOperatorFn('operator-workspaces', {
    action: suspended ? 'suspend' : 'restore',
    workspace_id: workspaceId,
  })
}

/**
 * Irreversible. `confirmSlug` must equal the company's slug — the server
 * checks it too, so this is not a client-side-only safeguard.
 */
export function teardownWorkspace(workspaceId, confirmSlug) {
  return callOperatorFn('operator-workspaces', {
    action: 'teardown',
    workspace_id: workspaceId,
    confirm_slug: confirmSlug,
  })
}

/** Store a per-company Anthropic key. It is never readable again. */
export function setWorkspaceAiKey(workspaceId, apiKey) {
  return callOperatorFn('operator-ai-keys', { action: 'set', workspace_id: workspaceId, api_key: apiKey })
}

export function clearWorkspaceAiKey(workspaceId) {
  return callOperatorFn('operator-ai-keys', { action: 'clear', workspace_id: workspaceId })
}

// ── Session 20: the model control plane ──────────────────────────────────────
// These go through an Edge Function rather than PostgREST for a reason worth
// stating: migration 0031 gives platform_approved_models and
// platform_model_defaults NO write policy and revokes the write privileges, so
// there is no direct path even for an operator. That is what makes the
// Anthropic validation below non-optional instead of a courtesy.

/** The catalogue plus every platform default, in one call. */
export function listModels() {
  return callOperatorFn('operator-models', { action: 'list' })
}

/**
 * Add a model to the catalogue, or update one that is already there.
 *
 * The server validates the id against Anthropic first: a 404 is refused
 * outright, while a rate limit or an outage is inconclusive and saves the row
 * marked `unverified` rather than rejecting a model that is probably fine.
 * The result's `validated` says which happened.
 */
export function approveModel({ modelId, label, hint, sortOrder }) {
  return callOperatorFn('operator-models', {
    action: 'approve',
    model_id: modelId,
    label,
    hint: hint || '',
    sort_order: typeof sortOrder === 'number' ? sortOrder : 100,
  })
}

/**
 * Retire (or restore) a model. Always soft — the row stays, so a company that
 * had already selected it keeps generating. The response reports how many
 * workspace and user overrides still point at it.
 */
export function setModelRetired(modelId, retired) {
  return callOperatorFn('operator-models', {
    action: retired ? 'retire' : 'restore',
    model_id: modelId,
  })
}

/** Pin the platform default for one function. Empty model = built-in floor. */
export function setPlatformDefault({ registryKey, modelId, effort }) {
  return callOperatorFn('operator-models', {
    action: 'set_default',
    registry_key: registryKey,
    model_id: modelId || '',
    effort: effort || '',
  })
}

export function clearPlatformDefault(registryKey) {
  return callOperatorFn('operator-models', {
    action: 'clear_default',
    registry_key: registryKey,
  })
}

/** True when the function isn't deployed in this environment yet. */
export function isMissingFunction(result) {
  return result?.status === 404 && !result?.data?.error
}
