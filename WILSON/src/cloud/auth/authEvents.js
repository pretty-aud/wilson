// =============================================================================
// authEvents — Track B bundle B2, part 2: the client's own rows in
// public.auth_events (migration 0070).
//
// Four kinds are the client's to write — sign_in, sign_out, idle_timeout,
// session_cap — and only as successes. Everything that identifies the row
// (user, company, session id, address, user agent, time) is stamped by
// trg_auth_events_stamp from the caller's JWT and auth.sessions; the body
// carries nothing but the kind, the outcome, the source and a small context.
// An identity column sent from here would be overwritten anyway; a failure
// or a hook source is refused by the INSERT policy (suite 74 pins both).
//
// Why the client writes a sign_in row when the password hook logs one too:
// the hook's row is the one nobody can suppress, and it carries no address
// (GoTrue hands the hook none). The client's row is the one WITH the
// address, the company and the surface. Both exist on purpose.
//
// `context.surface` says which door the row came through — 'app' for /wilson
// and 'admin' for /wilsonadmin — because the same person can hold a session
// on each, and the operator console's Sign-ins view needs to tell its own
// sign-ins from the same operator's product sign-ins. It is the one field
// the trigger leaves alone.
//
// Best-effort, bounded, and LOUD on the error channel (TPN-LOG-006): a
// PostgREST builder resolves with { error } rather than rejecting, so the
// result is checked and reported to the console, and the caller receives an
// { ok } it may ignore. Never throws. Never holds a sign-out for longer than
// AUTH_EVENT_TIMEOUT_MS — a person leaving must be able to leave.
// =============================================================================

import { supabase } from './supabaseClient'
import { withTimeout } from './withTimeout'

/* global __WILSON_SURFACE__ */
export const SURFACE =
  typeof __WILSON_SURFACE__ === 'string' ? __WILSON_SURFACE__ : 'app'

/** The kinds the INSERT policy accepts from a client (0070). */
export const CLIENT_EVENT_KINDS = Object.freeze([
  'sign_in', 'sign_out', 'idle_timeout', 'session_cap',
])

/**
 * Shorter than AUTH_TIMEOUT_MS on purpose: this is a log row on the way out
 * of the app, not a step the person is waiting on. If the network is the
 * silent-hang kind (see connectionWatchdog.js) a 15-second wait here would
 * turn "Sign out" into fifteen seconds of nothing.
 */
export const AUTH_EVENT_TIMEOUT_MS = 4000

/**
 * Insert one client row. Resolves to { ok: true } or { ok: false, reason }.
 *
 * @param {'sign_in'|'sign_out'|'idle_timeout'|'session_cap'} kind
 * @param {object} [context]   small, technical, no PII — merged over { surface }
 * @param {{ client?: object, timeoutMs?: number }} [opts]  test seams
 */
export async function recordAuthEvent(kind, context = {}, opts = {}) {
  const { client = supabase, timeoutMs = AUTH_EVENT_TIMEOUT_MS } = opts
  if (!CLIENT_EVENT_KINDS.includes(kind)) {
    console.warn(`[wilson] auth_events: refusing unknown kind "${kind}"`)
    return { ok: false, reason: 'unknown_kind' }
  }
  const row = {
    kind,
    outcome: 'success',
    source: 'client',
    context: { surface: SURFACE, ...context },
  }
  try {
    const { error } = await withTimeout(
      client.from('auth_events').insert(row),
      timeoutMs, `auth_events ${kind}`,
    )
    if (error) {
      // The error channel is the whole point (TPN-LOG-006): a refused insert
      // resolves, it does not reject, and it must not look like success.
      console.warn(`[wilson] auth_events ${kind} refused:`, error.code ?? '', error.message ?? error)
      return { ok: false, reason: error.code || error.message || 'error' }
    }
    return { ok: true }
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError'
    console.warn(`[wilson] auth_events ${kind} ${timedOut ? 'timed out' : 'failed'}:`, err?.message ?? err)
    return { ok: false, reason: timedOut ? 'timeout' : (err?.message || 'error') }
  }
}
