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

const FRIENDLY = {
  unauthorized: 'Sign in to use AI features.',
  forbidden: 'Your account is not active in this workspace.',
  rate_limited: 'Too many uploads at once — try again in a moment.',
  ai_not_configured: 'AI is not configured for this workspace yet — ask your admin.',
  validation_failed: 'That file could not be prepared for upload.',
  upstream_unreachable: 'Could not reach the AI service — try again.',
  network: 'Network error — check your connection.',
  session_stalled: 'Could not read your session — check your connection and try again.',
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

/**
 * Upload one document and get back its Anthropic file id.
 *
 * @param {object} input
 * @param {string|Blob} input.data      base64 string (what D.O.G. holds) or a Blob
 * @param {string} input.filename       shown in Anthropic's file list; not content
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
  // The field name is Anthropic's contract, not ours. ai-files forwards the
  // multipart stream untouched, so this is the only place it is set.
  form.append('file', blob, filename || 'document')

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
