// =============================================================================
// aiProxy — Session 12 (locked #21): the ONLY client path to Anthropic.
//
// Every AI feature in WILSON (D.O.G., O.T.T.E.R., Validator, the agent, the
// pet companion, RABBIT intake) calls callAI() with the same body it used to
// send to api.anthropic.com — { model, max_tokens, system, messages, tools?,
// betas? } — plus a `tool` attribution tag for the Admin Terminal's spend
// view. The ai-proxy Edge Function attaches the key server-side, streams the
// upstream response (150s Edge deadline vs long generations), and this
// helper reassembles the SSE into the classic non-streaming message object,
// so call sites are transport-blind.
//
// House style follows adminApi.js: raw fetch to /functions/v1/<name> with
// { apikey, authorization: Bearer } — supabase.functions.invoke is
// deliberately not used anywhere in this codebase. Unlike adminApi, this
// THROWS on failure (AIProxyError with .status) because every call site
// already has try/catch + retry loops keyed on HTTP status codes.
//
// There is NO direct-to-Anthropic fallback, on either host — a second code
// path is how gap #21 happened (locked #21).
// =============================================================================

import { supabase } from './auth/supabaseClient'
import { withTimeout, TimeoutError, AUTH_TIMEOUT_MS } from './auth/withTimeout'
import { assembleStreamedMessage } from './anthropicStream'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

const FRIENDLY = {
  unauthorized: 'Sign in to use AI features.',
  forbidden: 'Your account is not active in this workspace.',
  rate_limited: 'Too many AI requests at once — retrying shortly.',
  ai_not_configured: 'AI is not configured for this workspace yet — ask your admin.',
  validation_failed: 'Malformed AI request.',
  bad_json: 'Malformed AI request.',
  method_not_allowed: 'Malformed AI request.',
  upstream_unreachable: 'Could not reach the AI service — try again.',
  network: 'Network error — check your connection.',
  // Distinct from `unauthorized` on purpose: a stalled session read is a
  // network problem, and "sign in again" is the wrong remedy for it.
  session_stalled: 'Could not read your session — check your connection and try again.',
}

export class AIProxyError extends Error {
  constructor(message, status = 0, code = null) {
    super(message)
    this.name = 'AIProxyError'
    this.status = status
    this.code = code
  }
}

/**
 * Call Anthropic through the ai-proxy Edge Function.
 *
 * @param {object} body   The Anthropic request body the call site already
 *                        builds: { model, max_tokens, system, messages,
 *                        tools?, betas? } plus WILSON's `tool` tag.
 * @param {object} [opts] { signal } — AbortSignal, same semantics as fetch.
 * @returns {Promise<object>} the non-streaming-shaped message object.
 * @throws {AIProxyError|DOMException} .status carries the HTTP status
 *         (429/503/529 are what the call sites' retry loops key on);
 *         aborts reject with the usual AbortError.
 */
export async function callAI(body, { signal } = {}) {
  // Session 21. This await sits in front of EVERY AI call in WILSON, and it
  // was unbounded: a stalled getSession() left the caller's spinner running
  // forever with nothing in the console.
  //
  // The ceiling alone is not the whole fix. Letting a timeout fall through to
  // the `!token` branch below would report "Sign in to use AI features." to a
  // signed-in user whose network stalled — the precise misdiagnosis
  // modelSources.js:233 exists to prevent, and it sends them to a remedy that
  // cannot work. A stall gets its own code and message.
  let token = null
  try {
    const { data } = await withTimeout(
      supabase.auth.getSession(), AUTH_TIMEOUT_MS, 'reading your session',
    )
    token = data?.session?.access_token ?? null
  } catch (err) {
    if (err instanceof TimeoutError) {
      throw new AIProxyError(FRIENDLY.session_stalled, 0, 'session_stalled')
    }
    /* anything else: fall through to the !token branch */
  }
  if (!token) {
    throw new AIProxyError(FRIENDLY.unauthorized, 401, 'unauthorized')
  }

  let res
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/ai-proxy`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: SUPABASE_ANON,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body ?? {}),
      signal,
    })
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    throw new AIProxyError(FRIENDLY.network, 0, 'network')
  }

  const ctype = res.headers.get('content-type') || ''
  if (!res.ok || !ctype.includes('text/event-stream')) {
    const json = await res.json().catch(() => ({}))
    const code = json.error ?? `http_${res.status}`
    // Surface Anthropic's own message when the proxy forwarded one — the
    // retry regexes at call sites match on wording like "Overloaded".
    const upstreamMsg = json.anthropic?.error?.message
    const msg = upstreamMsg || FRIENDLY[code] || `AI request failed (${res.status}).`
    throw new AIProxyError(msg, res.status, code)
  }

  return assembleStreamedMessage(res)
}

/** True when an error from callAI is worth an automatic retry. */
export function isRetryableAIError(err) {
  const status = err?.status
  if (status === 429 || status === 503 || status === 529) return true
  return /overloaded|rate.?limit|capacity/i.test(err?.message || '')
}
