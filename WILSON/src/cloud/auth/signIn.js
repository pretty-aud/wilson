// =============================================================================
// signIn — F11 (the review's shared-client A2; REV-05): the sign-in's steps,
// written once. LoginScreen, ForgotPasswordWizard, WorkspaceSwitcher,
// MfaSection and the operator console's OperatorLogin each wrote their own copy
// (issueSession twice, one returning null and one throwing; resolveLogin twice,
// the reset wizard's without the company; the second-factor step five times).
// The SCREENS keep their words, their timing and their order; these functions
// carry only the requests and the GoTrue calls, every one bounded at
// AUTH_TIMEOUT_MS (withTimeout.js: "every await gets a ceiling").
//
// 🚨 The username path's defence is the screens' and stays there: one generic
// error for every failure, the fake-email sign-in on a miss, the uniform
// "sent" screen. Nothing here tells a caller more than the function said.
// resolve-login and issue-session are called through callEdgeFunction
// (edgeFunctions.js), exactly as the screens sent them.
// =============================================================================

import { supabase } from './supabaseClient'
import { withTimeout, TimeoutError, AUTH_TIMEOUT_MS } from './withTimeout'
import { callEdgeFunction } from '../edgeFunctions'

// ── The company, remembered per device (B1) ──────────────────────────────────
// The last company that cleared the company step on THIS DEVICE, so the next
// sign-in, and the reset wizard, start with it. Per device, never per account.
// A display name, not a credential, so plain localStorage on both hosts.
const LAST_COMPANY_KEY = 'wilson.lastCompany'
export function readLastCompany() {
  try { return localStorage.getItem(LAST_COMPANY_KEY) ?? '' } catch { return '' }
}
export function saveLastCompany(name) {
  try { localStorage.setItem(LAST_COMPANY_KEY, name) } catch { /* private mode, quota */ }
}
// A deep link may pre-fill the company: `?company=<name or slug>` in the
// query. Query only — the hash belongs to recovery links (recoveryLink.js).
// It is still verified like anything typed; a link cannot skip the step.
export function companyFromDeepLink(search) {
  try {
    return (new URLSearchParams(search).get('company') ?? '').trim().slice(0, 80)
  } catch {
    return ''
  }
}

// ── resolve-login ────────────────────────────────────────────────────────────

/**
 * The company step (Session 43; contract v2): does this company exist, and what
 * is its canonical slug. Never throws.
 *   { unavailable: true }                        not deployed, unreadable, no answer (the gate is not enforced)
 *   { unavailable: false, limited: true, exists: false, slug: null }   a 429 from a deployment that understands it
 *   { unavailable: false, exists, slug }
 * `unavailable` is not a refusal: an older resolve-login answers `{exists:false}`
 * to a body without a username, which is why the contract version decides.
 */
export async function verifyCompany(company) {
  const r = await callEdgeFunction('resolve-login', { company }, { anon: true, timeoutMs: AUTH_TIMEOUT_MS })
  // 429 is a refusal from a deployment that DOES understand the contract — it
  // must not read as "not deployed", or a throttled caller would be waved
  // through the company step on a derived slug with the gate off.
  if (r.status === 429) return { unavailable: false, limited: true, exists: false, slug: null }
  if (!r.ok || r.data?.v !== 2) return { unavailable: true }
  return { unavailable: false, exists: !!r.data.exists, slug: r.data.slug ?? null }
}

/**
 * A username (within a company when `slug` is given) to its email.
 *   { exists: true, email, limited: false }       a hit
 *   { exists: false, email: null, limited: true } a 429 (decided by the caller's address alone)
 *   { exists: false, email: null }                every other answer: the miss
 * Throws TimeoutError past AUTH_TIMEOUT_MS, and an Error when no answer came or
 * a 2xx could not be read, as the screens' own fetch did; each screen words it.
 * Without `slug` a username in two companies is a miss (resolve-login answers
 * so): every caller now sends the company it verified.
 */
export async function resolveLogin(username, slug) {
  const r = await callEdgeFunction('resolve-login', { username, ...(slug ? { workspace_slug: slug } : {}) }, { anon: true, timeoutMs: AUTH_TIMEOUT_MS })
  if (r.ok) {
    const hit = r.data.exists === true && typeof r.data.email === 'string'
    return { exists: hit, email: hit ? r.data.email : null, limited: false }
  }
  if (r.status === 429) return { limited: true, exists: false, email: null }
  if (r.code === 'timeout') throw new TimeoutError('resolve-login', AUTH_TIMEOUT_MS)
  if (r.status === 0 || r.code === 'bad_answer') throw new Error(r.words)
  return { exists: false, email: null }
}

// ── issue-session ────────────────────────────────────────────────────────────

/**
 * Make `workspaceId` the session's active workspace (the token's claim; a
 * refresh then picks it up). With the access token the caller holds — the
 * sign-in's own, or the switcher's.
 *   { ok: true, data } | { ok: false, status, code } for an answer that refused
 * Throws TimeoutError past AUTH_TIMEOUT_MS, and an Error when no answer came or
 * it could not be read. The login ignores a refusal (OUTSTANDING F11-07); the
 * switcher says "issue-session failed: <status>".
 */
export async function issueSession(accessToken, workspaceId) {
  if (!accessToken) return { ok: false, status: 401, code: 'unauthorized' }
  const r = await callEdgeFunction('issue-session', workspaceId ? { workspace_id: workspaceId } : {}, { token: accessToken, timeoutMs: AUTH_TIMEOUT_MS })
  if (r.ok) return { ok: true, data: r.data }
  if (r.code === 'timeout') throw new TimeoutError('issue-session', AUTH_TIMEOUT_MS)
  if (r.status === 0 || r.code === 'bad_answer') throw new Error(r.words)
  return { ok: false, status: r.status, code: r.code }
}

// ── The second factor ────────────────────────────────────────────────────────

/**
 * After a password sign-in: does this session need its authenticator code, and
 * which factor answers it. { factorId } or null (no step: not enrolled, or
 * already aal2). Both reads bounded; throws TimeoutError (a stall must never
 * skip the step: the login rethrows it) or whatever the SDK threw.
 */
export async function mfaStepNeeded() {
  const { data: aal } = await withTimeout(
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(), AUTH_TIMEOUT_MS, 'MFA level check')
  if (!(aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2')) return null
  const { data: factors } = await withTimeout(
    supabase.auth.mfa.listFactors(), AUTH_TIMEOUT_MS, 'factor list')
  const totp = (factors?.totp ?? []).find((f) => f.status === 'verified')
  return totp ? { factorId: totp.id } : null
}

/**
 * Challenge and verify one TOTP code, each bounded. { rejected: true } for a
 * wrong code; { rejected: false, session } otherwise — the aal2 session
 * verify() RETURNS (Session 17: a getSession() straight after verify deadlocked
 * on auth-js's lock), else one bounded getSession for an auth-js that omits it.
 * `{ session: false }` skips that (the enrol panel only needs the verdict).
 * Throws TimeoutError, or the challenge's own error; each screen words both.
 */
export async function verifyTotp(factorId, code, { session: wantSession = true } = {}) {
  const { data: ch, error: chErr } = await withTimeout(
    supabase.auth.mfa.challenge({ factorId }), AUTH_TIMEOUT_MS, 'MFA challenge')
  if (chErr || !ch?.id) throw chErr ?? new Error('challenge failed')
  const { data: vData, error: vErr } = await withTimeout(
    supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code }), AUTH_TIMEOUT_MS, 'MFA verify')
  if (vErr) return { rejected: true }
  if (!wantSession) return { rejected: false, session: null }
  let session = vData?.access_token ? vData : null
  if (!session) {
    const { data: fresh } = await withTimeout(supabase.auth.getSession(), AUTH_TIMEOUT_MS, 'session read')
    session = fresh?.session ?? null
  }
  return { rejected: false, session }
}
