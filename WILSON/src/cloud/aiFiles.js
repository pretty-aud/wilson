// =============================================================================
// aiFiles — upload documents to Anthropic's Files API through ai-files.
//
// The companion to aiProxy.js. Same locked decision (#21): the browser never
// holds an Anthropic key, so the upload goes through an Edge Function that
// attaches it server-side. Same house style as aiProxy.js and adminApi.js —
// raw fetch to /functions/v1/<name> with { apikey, authorization: Bearer },
// never supabase.functions.invoke.
//
// -----------------------------------------------------------------------------
// WHY UPLOAD AT ALL — the 546
// -----------------------------------------------------------------------------
// D.O.G. used to inline every source document as base64 inside the ai-proxy
// request body. Measured 2026-08-11: Audrey's real decks carry ~232k input
// tokens of documents, and ai-proxy's worker was being KILLED (HTTP 546)
// parsing and re-serialising that body before it ever reached Anthropic — it
// logged no usage row at all, which is how a request that never happened and a
// request that failed look identical.
//
// Uploading once and referencing `file_id` makes the relayed body a few KB
// regardless of how much source material a deck carries. It does NOT reduce
// input tokens — the document is still billed as input on every call that
// references it — so this fixes the failure, not the cost.
// =============================================================================

import { supabase } from './auth/supabaseClient'
import { withTimeout, TimeoutError, AUTH_TIMEOUT_MS } from './auth/withTimeout'
import { devFixtures } from '../dev/devFixtures'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * The beta Anthropic requires on the upload AND on every messages request that
 * references the resulting file_id.
 *
 * Exported because the second half is the caller's job: a call site that sends
 * a `file` source without putting this in its `betas` gets a 400 from Anthropic
 * that says nothing about beta headers. ai-files sets it on the upload itself.
 */
export const FILES_BETA = 'files-api-2025-04-14'

/**
 * FX12: every upload asks the store to delete it after this long, by itself.
 * Equal to the sweep's age (SWEEP_AGE_HOURS in _shared/aiFileStore.ts) and
 * longer than D.O.G.'s cache TTL (aiFileCache.js), so a cached id is always
 * dropped before the store lets it go.
 */
export const UPLOAD_EXPIRY_SECONDS = 24 * 60 * 60

const FRIENDLY = {
  unauthorized: 'Sign in to use AI features.',
  forbidden: 'Your account is not active in this workspace.',
  rate_limited: 'Too many uploads at once — try again in a moment.',
  ai_not_configured: 'AI is not configured for this workspace yet — ask your admin.',
  validation_failed: 'That file could not be prepared for upload.',
  upstream_unreachable: 'Could not reach the AI service — try again.',
  network: 'Network error — check your connection.',
  session_stalled: 'Could not read your session — check your connection and try again.',
  // FX12: the delete, list and sweep routes.
  timeout: 'The AI’s file store did not answer in time — try again.',
  mfa_required: 'This needs a fresh sign-in with your authenticator code.',
  mfa_check_failed: 'Could not check your two-factor sign-in — try again in a moment.',
  mfa_enrollment_required: 'This needs two-factor sign-in turned on for your account.',
  delete_failed: 'The AI’s file store could not be cleaned just now — try again.',
  list_failed: 'The AI’s file store could not be read just now — try again.',
  sweep_failed: 'The clean-up stopped part-way — see Logs for WIL-6002.',
  bad_answer: 'The AI’s file store answered something unreadable.',
  store_rate_limited: 'Too many requests to the AI’s file store — try again in a minute.',
  // An ai-files from before FX12 answers 405 to the store's routes: the
  // client can reach an environment before its function is deployed.
  method_not_allowed: 'This environment’s server has not been updated to manage the AI’s file store yet.',
}

export class AIFileError extends Error {
  constructor(message, status = 0, code = null) {
    super(message)
    this.name = 'AIFileError'
    this.status = status
    this.code = code
  }
}

/**
 * base64 -> Blob, in chunks.
 *
 * Chunked rather than one `atob` call because these are real source documents,
 * not thumbnails — a single atob over a 60MB base64 string builds one enormous
 * intermediate string before a single byte is written. Decoding in slices keeps
 * peak memory near the file's actual size. The slice length is a multiple of 4
 * so it never splits a base64 quantum, which would corrupt the output silently.
 */
export function base64ToBlob(base64, mediaType = 'application/octet-stream') {
  const clean = String(base64 || '').replace(/\s/g, '')
  const CHUNK = 1024 * 384 // 393216 — divisible by 4
  const parts = []
  for (let offset = 0; offset < clean.length; offset += CHUNK) {
    const slice = clean.slice(offset, offset + CHUNK)
    const binary = atob(slice)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    parts.push(bytes)
  }
  return new Blob(parts, { type: mediaType })
}

const NEUTRAL_NAMES = {
  'application/pdf': 'document.pdf',
  'text/plain': 'document.txt',
  'image/jpeg': 'image.jpg',
  'image/png': 'image.png',
  'image/gif': 'image.gif',
  'image/webp': 'image.webp',
}

/** The name the store keeps for an upload: its kind, never the person's file name. */
export function neutralFileName(mediaType) {
  const type = String(mediaType || '').split(';')[0].trim().toLowerCase()
  return NEUTRAL_NAMES[type] || 'document'
}

/**
 * Upload one document and get back its Anthropic file id.
 *
 * @param {object} input
 * @param {string|Blob} input.data      base64 string (what D.O.G. holds) or a Blob
 * @param {string} [input.filename]     accepted and NOT sent (FX12): the store keeps
 *                                      a neutral name, neutralFileName(type)
 * @param {string} [input.mediaType]    MIME type; required when `data` is base64
 * @param {object} [opts]               { signal } — AbortSignal, same as fetch
 * @returns {Promise<{id:string, size_bytes?:number, mime_type?:string}>}
 * @throws {AIFileError|DOMException} .status carries the HTTP status
 */
export async function uploadAIFile({ data, filename, mediaType }, { signal } = {}) {
  // Same bounded session read as callAI. An unbounded getSession() leaves the
  // caller's spinner running forever with nothing in the console, and a stall
  // must not be reported as "sign in" — that sends someone to a remedy that
  // cannot work. See aiProxy.js for the full rationale.
  let token = null
  try {
    const { data: sess } = await withTimeout(
      supabase.auth.getSession(), AUTH_TIMEOUT_MS, 'reading your session',
    )
    token = sess?.session?.access_token ?? null
  } catch (err) {
    if (err instanceof TimeoutError) {
      throw new AIFileError(FRIENDLY.session_stalled, 0, 'session_stalled')
    }
    /* anything else: fall through to the !token branch */
  }
  if (!token) throw new AIFileError(FRIENDLY.unauthorized, 401, 'unauthorized')

  const blob = data instanceof Blob ? data : base64ToBlob(data, mediaType)
  const form = new FormData()
  // FX12: the store deletes the file by itself after UPLOAD_EXPIRY_SECONDS,
  // so a crash, a window killed before its deletes left, or a file nobody
  // swept is gone within a day. Before `file`, so it is read before the body.
  form.append('expires_in_seconds', String(UPLOAD_EXPIRY_SECONDS))
  // The field name is Anthropic's contract, not ours. ai-files forwards the
  // multipart stream untouched, so this is the only place it is set.
  //
  // FX12 (review round 1, finding 5): the store KEEPS the name it is given,
  // listed beside the file for as long as it is there, and a client's file
  // name is their pre-release material. So it is given a neutral one that
  // keeps only the kind (`document.pdf`, `image.png`); the part's own type is
  // what the store reads the file as. `filename` is accepted and not sent.
  void filename
  form.append('file', blob, neutralFileName(blob.type || mediaType))

  let res
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/ai-files`, {
      method: 'POST',
      // NOTE: no content-type header. The browser must set it itself so the
      // multipart boundary is generated — setting it by hand produces a body
      // the upstream cannot parse, and the error names neither cause.
      headers: {
        apikey: SUPABASE_ANON,
        authorization: `Bearer ${token}`,
      },
      body: form,
      signal,
    })
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    throw new AIFileError(FRIENDLY.network, 0, 'network')
  }

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const code = json.error ?? `http_${res.status}`
    const upstreamMsg = json.anthropic?.error?.message
    const msg = upstreamMsg || FRIENDLY[code] || `File upload failed (${res.status}).`
    throw new AIFileError(msg, res.status, code)
  }
  if (!json?.id) {
    throw new AIFileError('The AI service accepted the file but returned no id.', res.status, 'no_file_id')
  }
  return json
}

// =============================================================================
// FX12 (2026-10-25, OUTSTANDING DG1-03): letting go of what was uploaded
// =============================================================================
//
// ai-files' DELETE takes a member's OWN ids (one, or a short list), and an
// admin's sweep of the workspace's files older than a day; its GET lists what
// this workspace has stored (ids, times, sizes; never a filename). Every call
// here has its own AbortController with a timeout (withTimeout races but never
// aborts: SYSTEMS_HANDBOOK §17), reads `res.ok` before the body, and reads a
// refusal's body defensively (a non-JSON 546 must not become a SyntaxError
// that hides the status).

const FILES_URL = () => `${SUPABASE_URL}/functions/v1/ai-files`
/** Ids per DELETE: a short list, far under keepalive's 64 KB in flight. */
export const DELETE_BATCH = 25
const CALL_TIMEOUT_MS = 15000
const SWEEP_TIMEOUT_MS = 120000
const FILE_ID_RE = /^file_[A-Za-z0-9]{8,96}$/

// The signed-in token as of the last auth event, so the page's last moments
// (pagehide) can issue the deletes without awaiting a session read that would
// never finish. Everything else reads the session, bounded, as the upload does.
let currentToken = null
try {
  supabase?.auth?.onAuthStateChange?.((_event, session) => {
    currentToken = session?.access_token ?? null
  })
} catch { /* a test double without onAuthStateChange */ }

async function readToken() {
  let token = null
  try {
    const { data: sess } = await withTimeout(
      supabase.auth.getSession(), AUTH_TIMEOUT_MS, 'reading your session',
    )
    token = sess?.session?.access_token ?? null
  } catch (err) {
    if (err instanceof TimeoutError) throw new AIFileError(FRIENDLY.session_stalled, 0, 'session_stalled')
  }
  if (!token) throw new AIFileError(FRIENDLY.unauthorized, 401, 'unauthorized')
  return token
}

/** An AbortController with a timeout, joined to the caller's signal. */
function timedSignal(outer, ms) {
  const c = new AbortController()
  const timer = setTimeout(() => c.abort(), ms)
  const onAbort = () => c.abort()
  if (outer) {
    if (outer.aborted) c.abort()
    else outer.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: c.signal,
    timedOut: () => c.signal.aborted && !outer?.aborted,
    done: () => { clearTimeout(timer); outer?.removeEventListener?.('abort', onAbort) },
  }
}

async function callFiles(method, { body, token, signal, keepalive = false, timeoutMs = CALL_TIMEOUT_MS }) {
  const t = timedSignal(signal, timeoutMs)
  try {
    let res
    try {
      res = await fetch(FILES_URL(), {
        method,
        keepalive,
        headers: {
          apikey: SUPABASE_ANON,
          authorization: `Bearer ${token}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: t.signal,
      })
    } catch (err) {
      if (signal?.aborted) throw err // the caller's own abort, as fetch reports it
      if (t.timedOut()) throw new AIFileError(FRIENDLY.timeout, 0, 'timeout')
      throw new AIFileError(FRIENDLY.network, 0, 'network')
    }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      const code = typeof j?.error === 'string' ? j.error : `http_${res.status}`
      // The upload's words say "uploads"; these routes are not uploads (review round 2, note 9).
      const words = code === 'rate_limited' ? FRIENDLY.store_rate_limited : FRIENDLY[code]
      throw new AIFileError(words || `The AI’s file store refused (${res.status}).`, res.status, code)
    }
    const j = await res.json().catch(() => null)
    if (!j || typeof j !== 'object' || Array.isArray(j)) {
      throw new AIFileError(FRIENDLY.bad_answer, res.status, 'bad_answer')
    }
    return j
  } catch (err) {
    if (t.timedOut() && !(err instanceof AIFileError)) throw new AIFileError(FRIENDLY.timeout, 0, 'timeout')
    throw err
  } finally {
    t.done()
  }
}

/**
 * Delete these uploads (the caller's own; the function refuses any other as
 * `not_found`). Answers `[{ id, outcome }]`, outcome one of deleted, gone,
 * not_found, key_unavailable, failed.
 *
 * `keepalive: true` is for the page's last moments: every batch is issued at
 * once and synchronously (no await before the fetches when `token` is given),
 * and the browser finishes them after the page is gone. A sendBeacon cannot
 * carry the bearer header, so it is fetch.
 *
 * @param {string[]} ids
 * @param {{ signal?: AbortSignal, keepalive?: boolean, token?: string }} [opts]
 */
export async function deleteAIFiles(ids, { signal, keepalive = false, token } = {}) {
  const list = [...new Set((ids || []).filter(id => typeof id === 'string' && FILE_ID_RE.test(id)))]
  if (!list.length) return []
  const bearer = token ?? await readToken()
  const batches = []
  for (let i = 0; i < list.length; i += DELETE_BATCH) batches.push(list.slice(i, i + DELETE_BATCH))
  const one = (batch) => callFiles('DELETE', { body: { file_ids: batch }, token: bearer, signal, keepalive })
    .then(j => (Array.isArray(j.results) ? j.results : []))
  if (keepalive) return (await Promise.all(batches.map(one))).flat()
  const results = []
  for (const batch of batches) results.push(...await one(batch))
  return results
}

/** One id; answers its `{ id, outcome }` or null. */
export async function deleteAIFile(id, opts) {
  return (await deleteAIFiles([id], opts))[0] ?? null
}

/**
 * What this workspace has in the store (a member: their own; an admin: the
 * workspace's): `{ scope, older_than_hours, count, total_bytes, oldest,
 * sweepable, unreachable, files: [{ id, created_at, size_bytes, expires_at,
 * expired }] }`. Never a filename.
 */
export async function listAIFiles({ signal } = {}) {
  const fx = import.meta.env.DEV ? devFixtures() : null
  if (fx?.aiFiles) return fx.aiFiles.list()
  return callFiles('GET', { token: await readToken(), signal })
}

/**
 * The admin's sweep: deletes this workspace's files older than the function's
 * age (24 h), oldest first, at most 150 a run. Answers `{ ok, counts, after }`.
 */
export async function sweepAIFiles({ signal } = {}) {
  const fx = import.meta.env.DEV ? devFixtures() : null
  if (fx?.aiFiles) return fx.aiFiles.sweep()
  return callFiles('DELETE', { body: { sweep: true }, token: await readToken(), signal, timeoutMs: SWEEP_TIMEOUT_MS })
}

// ── Who holds ids: the app's close and sign-out let go of them all ──────────
// D.O.G. registers its cache (`holdAIFiles(takeAll)`); App calls
// releaseAllAIFiles before a sign-out revokes the token, and the first holder
// hooks `pagehide`, the last event a closing window or tab reliably gets.

const holders = new Set()
let unloadHooked = false

/** Register a holder; `takeAll()` answers its ids and forgets them. Answers the unregister. */
export function holdAIFiles(takeAll) {
  holders.add(takeAll)
  if (!unloadHooked && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    unloadHooked = true
    window.addEventListener('pagehide', () => { releaseAllAIFiles({ keepalive: true }) })
  }
  return () => { holders.delete(takeAll) }
}

/**
 * Let go of every id any holder has. Best-effort and never throws: what a
 * failed delete leaves, the store's own expiry and the admin's sweep take.
 * With `keepalive`, the deletes are issued before this returns its promise.
 */
export function releaseAllAIFiles({ keepalive = false } = {}) {
  const ids = []
  for (const take of holders) {
    try { ids.push(...(take() || [])) } catch { /* a holder that throws holds nothing */ }
  }
  if (!ids.length) return Promise.resolve([])
  const token = keepalive && currentToken ? currentToken : undefined
  return deleteAIFiles(ids, { keepalive, token }).catch((err) => {
    console.warn(`[wilson] could not let go of ${ids.length} AI file(s):`, err?.code || err?.message || err)
    return []
  })
}

/** Test seam: the token pagehide would use. */
export function __setCurrentTokenForTests(token) { currentToken = token }
