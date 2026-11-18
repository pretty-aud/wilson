// =============================================================================
// edgeFunctions — F11 (the review's shared-client A1; OUTSTANDING F8-06): the
// ONE way the client calls an Edge Function.
//
// Every helper built the same request by hand (sixteen fetches in eleven
// files): read the token, POST JSON with `apikey` and `Bearer`, read the
// answer, word the refusal. Their ceilings differed for no stated reason, most
// had none, and none had words for F8's 413 `too_large`. They now call
// callEdgeFunction and keep their own names, signatures and answers; only the
// transport is here. supabase.functions.invoke is still not used anywhere.
//
// The rules it keeps for every caller:
//   - The token: given (an auth event's, the sign-in's own, the page's last
//     moments), none (`anon: true`, resolve-login), or one bounded session
//     read (readSessionToken). getSession is the only reader that refreshes an
//     expired token, and the bound keeps a stalled read from hanging a screen:
//     a stall is `session_stalled`, never "sign in again".
//   - The ceiling: an AbortController armed at the call (withTimeout races but
//     never aborts, handbook §17). In JSON mode it covers the answer's body
//     too; in `raw` mode (callAI's stream) it is cleared the moment the answer
//     STARTS, so reading a stream is never bounded. Each caller chooses its
//     ceiling on purpose; a caller's own signal still stops it, and an abort
//     the caller made is rethrown as fetch reported it.
//   - The answer: `res.ok` is read once, BEFORE the body; the body is read
//     once with `res.json()` inside a try; `res.text()` and `res.headers` are
//     never touched here (tests answer with bare `{ ok, json }` objects, and
//     gatewayApi.test.js pins the order ['ok', 'json']). A 2xx whose body is
//     not a JSON object is `bad_answer`, never a success: it is what a portal
//     or a proxy answers, not a function.
//   - The words: a caller's own table first, then EDGE_WORDS, then the
//     caller's own numbered sentence. EDGE_WORDS holds only what reads the same
//     everywhere or was worded nowhere: `too_large` (F8-06) among them.
//
// Edge Function calls stay outside the connection watchdog, as
// RECONNECT_DESIGN §5 says; the ceiling is their own bound.
// =============================================================================

import { supabase } from './auth/supabaseClient'
import { withTimeout, TimeoutError, AUTH_TIMEOUT_MS } from './auth/withTimeout'

/** The base vocabulary. A caller's own table is read first; these answer a code it does not word. */
export const EDGE_WORDS = Object.freeze({
  network: 'Network error — check your connection.',
  session_stalled: 'Could not read your session — check your connection and try again.',
  // F8-06: F8 gave the functions a 413 with `{ error: 'too_large' }`, and no table had words for it.
  too_large: 'That request is too large to send. Make it smaller and try again.',
  http_413: 'That request is too large to send. Make it smaller and try again.',
  timeout: 'The server did not answer in time. It may still have gone through, so check before trying again.',
  bad_answer: 'The server answered in a way WILSON could not read. Try again in a moment.',
})

/** <VITE_SUPABASE_URL>/functions/v1/<name>, read at the call (a test's stubEnv is seen). */
export function edgeFunctionUrl(name) {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`
}

/**
 * The signed-in token, from one bounded session read. Answers the token or null;
 * throws TimeoutError when the read stalls past AUTH_TIMEOUT_MS.
 */
export async function readSessionToken() {
  let data
  try {
    ({ data } = await withTimeout(supabase.auth.getSession(), AUTH_TIMEOUT_MS, 'reading your session'))
  } catch (err) {
    if (err instanceof TimeoutError) throw err
    return null
  }
  return data?.session?.access_token ?? null
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * Call one Edge Function.
 *
 * @param {string} name  the function's slug
 * @param {object|FormData|undefined} body  JSON (with its content-type) unless a FormData, which goes as it is
 *   (the browser writes the multipart boundary); undefined sends no body (a GET)
 * @param {object} [opts]
 * @param {string} [opts.token]       use this token; otherwise one bounded session read
 * @param {boolean} [opts.anon]       no token at all (resolve-login): the apikey header alone
 * @param {AbortSignal} [opts.signal] the caller's own stop
 * @param {number} [opts.timeoutMs]   the ceiling; none when absent
 * @param {object} [opts.words]       the caller's own words, by code, read before EDGE_WORDS
 * @param {string} [opts.method]      'POST' unless said
 * @param {boolean} [opts.keepalive]  for the page's last moments
 * @param {boolean} [opts.raw]        answer the Response once it starts, unread (callAI's stream)
 * @returns {Promise<object>} one of:
 *   { ok: true, status, data }                    a 2xx with a JSON object
 *   { ok: true, status, res }                     raw mode: any HTTP answer, unread
 *   { ok: false, status, code, data, words }      a refusal (data: its body, or null), or no request:
 *       unauthorized (401: no token), session_stalled (0), network (0), timeout (0), bad_answer (a 2xx)
 *   `words` is the caller's word or EDGE_WORDS' for the code, else null (the caller's own numbered sentence).
 */
export async function callEdgeFunction(name, body, opts = {}) {
  const { anon = false, signal, timeoutMs, words = {}, method = 'POST', keepalive = false, raw = false } = opts
  const say = (code) => words[code] ?? EDGE_WORDS[code] ?? null
  const refused = (status, code, data = null, cause) => ({ ok: false, status, code, data, words: say(code), ...(cause ? { cause } : {}) })

  let token = null
  if (!anon) {
    // No await when the caller gave the token: the page's last moments issue their deletes synchronously.
    if (opts.token) token = opts.token
    else {
      try { token = await readSessionToken() } catch { return refused(0, 'session_stalled') }
    }
    if (!token) return refused(401, 'unauthorized')
  }

  const json = body !== undefined && !(typeof FormData !== 'undefined' && body instanceof FormData)
  const headers = {
    ...(json ? { 'content-type': 'application/json' } : {}),
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  }

  // The ceiling, joined to the caller's signal. A signal reaches fetch only when there is one of the two.
  const ceiling = timeoutMs > 0 && typeof AbortController === 'function' ? new AbortController() : null
  let timer = null
  let onOuterAbort = null
  if (ceiling) {
    timer = setTimeout(() => ceiling.abort(), timeoutMs)
    if (signal) {
      onOuterAbort = () => ceiling.abort()
      if (signal.aborted) ceiling.abort()
      else signal.addEventListener('abort', onOuterAbort, { once: true })
    }
  }
  const stop = () => {
    if (timer) clearTimeout(timer)
    timer = null
    if (onOuterAbort) signal?.removeEventListener?.('abort', onOuterAbort)
    onOuterAbort = null
  }
  const timedOut = () => !!ceiling?.signal.aborted && !signal?.aborted

  const init = {
    method,
    headers,
    ...(json ? { body: JSON.stringify(body) } : body !== undefined ? { body } : {}),
    // As the caller sent it: the file store's calls always named it (false or true); nobody else did.
    ...('keepalive' in opts ? { keepalive: !!keepalive } : {}),
    ...(ceiling ? { signal: ceiling.signal } : signal ? { signal } : {}),
  }

  let res
  try {
    res = await fetch(edgeFunctionUrl(name), init)
  } catch (err) {
    stop()
    if (signal?.aborted) throw err
    if (timedOut()) return refused(0, 'timeout', null, err)
    return refused(0, 'network', null, err)
  }

  if (raw) {
    // The answer has started: the ceiling ends here, and the caller's own signal stays joined, so stopping a
    // stream still stops its reading (the fetch's signal is the ceiling's, which the caller's abort aborts).
    if (timer) clearTimeout(timer)
    timer = null
    return { ok: true, status: res.status, res }
  }

  try {
    const ok = res.ok
    let data = null
    try { data = await res.json() } catch { data = null }
    if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
    if (timedOut()) return refused(0, 'timeout')
    if (ok) return isPlainObject(data) ? { ok: true, status: res.status, data } : refused(res.status, 'bad_answer')
    const body = isPlainObject(data) ? data : null
    const code = typeof body?.error === 'string' ? body.error : `http_${res.status}`
    return refused(res.status, code, body)
  } finally {
    stop()
  }
}
