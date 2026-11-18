// =============================================================================
// storageApi — Session 37: client bindings for the S3-compatible storage Edge
// Functions (storage-presign, storage-secret; P1 added storage-read-urls, the
// batch of GETs for thumbnails and previews). House style follows
// adminApi.js: raw fetch to /functions/v1/<name> with { apikey,
// authorization: Bearer } headers (supabase.functions.invoke is deliberately
// not used anywhere in this codebase).
//
// Two calling conventions, on purpose:
//   * presignStorage THROWS on failure — it is called from inside the storage
//     registry's provider contract, where every function throws instead of
//     resolving (the otterFetch trap: an unchecked resolve turns a 403 into a
//     success).
//   * the storage-secret bindings return { ok, status, data } like adminApi —
//     they are called from StorageSection, which renders sentences, not
//     stack traces.
//
// 🚨 The secret plaintext appears exactly once here, in flight, inside
// storageSecretSet's request body. It is never logged, never stored, never
// echoed back — the response carries the key hint only (0028's rule applied
// to tenant credentials).
// =============================================================================

import { releaseStaleUploads } from '../tools/rabbit_v0.1.0/storage/uploadReservation.js'
import { isMoneyKey } from '../tools/rabbit_v0.1.0/storage/index.js'
import { supabase } from './auth/supabaseClient'
import { callEdgeFunction } from './edgeFunctions'

// F11 (A1): the transport is callEdgeFunction's, with NO ceiling of its own,
// on purpose: FX11's contract (storageApiProbe.test.js) is that the connection
// dot's probe bounds its own calls with its own signal, which reaches fetch as
// itself, and that every other caller sends no signal, as it always has. A
// ceiling here would replace both. That a presign from an upload or a preview
// has no bound but the caller's is recorded (OUTSTANDING F11-04).

// `opts.token` / `opts.signal` (FX11): the connection dot's bucket probe calls
// with the access token it read from an auth EVENT and its own abort signal,
// so the probe never calls getSession() — an abandoned getSession() keeps
// auth-js's global lock (OUTSTANDING's auth-js lock entry) — and a hung
// request is aborted, not left running. An aborted call rethrows its
// AbortError; every other caller passes nothing and is unchanged.
// Answers { ok, status, data } with the function's own `detail` on a refusal,
// as before; a 2xx that is not a JSON object is not ok (F11), with no detail,
// so each wrapper's own numbered sentence still names the status.
async function callStorageFn(name, body, { token: given = null, signal = undefined } = {}) {
  const r = await callEdgeFunction(name, body ?? {}, { token: given || undefined, signal })
  if (r.ok) return { ok: true, status: r.status, data: r.data }
  if (r.code === 'unauthorized' && !r.data) {
    return { ok: false, status: 401, data: { error: 'unauthorized', detail: 'Session expired — sign in again.' } }
  }
  if (r.status === 0) return { ok: false, status: 0, data: { error: r.code, detail: r.words } }
  if (r.code === 'bad_answer') return { ok: false, status: r.status, data: {} }
  return { ok: false, status: r.status, data: r.data ?? {} }
}

// ── Track C / 0074 — opening Files ──────────────────────────────────────────
/**
 * Release this person's own STALE upload reservations (Audrey's ruling 2,
 * 2026-09-07): rows a closed tab or a crash left open, which would otherwise
 * hold their bytes against the company's quota for 24 h. FileManager calls
 * this when Files opens on the Supabase backend; the keys THIS tab is still
 * uploading are kept (uploadReservation.js tracks them). Rides the shared
 * authed client like the storage-usage read beside it (workspaceStorage.js),
 * not the RABBIT adapter — the reservation is quota infrastructure, not
 * project content. Best-effort, never throws; resolves the number closed.
 */
export function releaseStaleUploadReservations() {
  return releaseStaleUploads(supabase)
}

/**
 * Mint a presigned URL for one request against one row-shaped path.
 * THROWS on refusal, with the server's sentence — see header.
 *
 * @param {'put'|'get'|'del'|'head'} op
 * @param {string} path row-shaped storage_path (never carries the prefix)
 * @param {{token?: string, signal?: AbortSignal}} [opts] see callStorageFn
 * @returns {Promise<{url: string, method: string, expiresAt: string}>}
 */
export async function presignStorage(op, path, opts) {
  const res = await callStorageFn('storage-presign', { op, path }, opts)
  if (!res.ok || !res.data?.url) {
    const detail = res.data?.detail || res.data?.error || `presign failed (${res.status})`
    // The status rides on the error (FX11): the connection dot tells a
    // refusal (401/403) from a function that did not answer (0, 5xx).
    throw Object.assign(new Error(`[s3] ${detail}`), { status: res.status })
  }
  return res.data
}

/**
 * MO1 (0120): ask Petal's server to look at one object in the company's own
 * bucket. It is the last step of writing a move's new copy: the commit takes a
 * key there only on this look. THROWS on a refusal, or on a bucket that could
 * not answer, because nothing here may read as "absent" by accident.
 *
 * @param {string} path row-shaped storage_path (never carries the prefix)
 * @returns {Promise<boolean>} whether the object is there
 */
export async function lookAtStorageObject(path, opts) {
  const res = await callStorageFn('storage-presign', { op: 'look', path }, opts)
  if (!res.ok || typeof res.data?.seen !== 'boolean') {
    const detail = res.data?.detail || res.data?.error || `the look failed (${res.status})`
    throw Object.assign(new Error(`[s3] ${detail}`), { status: res.status })
  }
  return res.data.seen
}

/**
 * P1: signed GETs for an s3 workspace's thumbnails and previews, many keys
 * per call (storage-read-urls, NETWORK_STORAGE_DESIGN.md §9.2). THROWS on a
 * whole-call refusal with the server's sentence and its status, as
 * presignStorage does; a key the server refused comes back in `refused` with
 * its code ('shape' | 'money' | 'project' | 'row').
 *
 * 🚨 A MONEY KEY NEVER LEAVES THIS FUNCTION. It is the only caller of the
 * read signer, and a key under INVOICES, FINANCE or LEGAL is answered here as
 * refused 'money' without being sent — the signer refuses it too, but money
 * never leaves Supabase, so the question is never asked.
 *
 * @param {string[]} keys row-shaped storage paths (never a prefix), ≤ 100
 * @param {{stream?: boolean, token?: string, signal?: AbortSignal}} [opts]
 *   `stream` (one key): the hour a <video> or <audio> needs, not 300 s.
 * @returns {Promise<{urls: Object<string,string>, expires: Object<string,number>, refused: Object<string,string>}>}
 */
export async function presignReadUrls(keys, { stream = false, ...opts } = {}) {
  const send = []
  const local = {}
  for (const key of keys || []) {
    if (isMoneyKey(key)) local[key] = 'money'
    else if (!send.includes(key)) send.push(key)
  }
  if (send.length === 0) return { urls: {}, expires: {}, refused: local }
  const res = await callStorageFn('storage-read-urls',
    stream ? { keys: send, stream: true } : { keys: send }, opts)
  if (!res.ok || !res.data?.urls) {
    const detail = res.data?.detail || res.data?.error || `the preview addresses could not be signed (${res.status})`
    throw Object.assign(new Error(`[s3] ${detail}`), { status: res.status })
  }
  return {
    urls: res.data.urls,
    expires: res.data.expires || {},
    refused: { ...local, ...(res.data.refused || {}) },
  }
}

/** Save the bucket secret (admin). Returns { ok, status, data: { keyHint } }. */
export function storageSecretSet(secret) {
  return callStorageFn('storage-secret', { action: 'set', secret })
}

/** Remove the stored bucket secret (admin). */
export function storageSecretClear() {
  return callStorageFn('storage-secret', { action: 'clear' })
}

/** { configured, keyHint, cryptoConfigured } for the Storage section. */
export function storageSecretStatus() {
  return callStorageFn('storage-secret', { action: 'status' })
}

/**
 * The configuration-time probe, server half: a real PUT→GET→DELETE round
 * trip from the Edge Function, plus presigned URLs for the client half.
 * The client half (runS3ClientProbe) is what detects CORS — a server that
 * can reach the bucket proves nothing about this browser's ability to.
 */
export function storageProbe() {
  return callStorageFn('storage-secret', { action: 'probe' })
}

/**
 * The client half of the probe: exercise the presigned PUT/GET/DELETE from
 * THIS context (browser or desktop renderer — both are Chromium, both
 * enforce CORS, so both need the bucket's CORS rule; §12.7a carries it).
 *
 * Returns { ok: true, roundTripMs } or { ok: false, stage, cors, detail } —
 * `cors: true` marks the signature failure shape of a missing CORS rule: the
 * server half already round-tripped, so a network-level failure HERE is the
 * browser refusing, not the bucket.
 */
export async function runS3ClientProbe(clientProbe) {
  const started = Date.now()
  const payload = 'wilson-probe-client'
  let stage = 'put'
  try {
    const putRes = await fetch(clientProbe.putUrl, { method: 'PUT', body: payload })
    if (!putRes.ok) {
      return { ok: false, stage, cors: false, detail: `the probe upload was refused (HTTP ${putRes.status})` }
    }
    stage = 'get'
    const getRes = await fetch(clientProbe.getUrl, { method: 'GET' })
    if (!getRes.ok || (await getRes.text()) !== payload) {
      return { ok: false, stage, cors: false, detail: `the probe object could not be read back (HTTP ${getRes.status})` }
    }
    stage = 'del'
    const delRes = await fetch(clientProbe.delUrl, { method: 'DELETE' })
    if (!delRes.ok && delRes.status !== 404) {
      return { ok: false, stage, cors: false, detail: `the probe object could not be deleted (HTTP ${delRes.status})` }
    }
    return { ok: true, roundTripMs: Date.now() - started }
  } catch {
    // fetch THROWS (rather than resolving with a status) only for the shapes
    // the browser blocks before a response exists: CORS, mixed content, DNS,
    // a proxy refusing the host. Two facts narrow it: the server half just
    // round-tripped to this bucket with these credentials, and THIS client
    // just reached the Edge Function — so neither the bucket nor the
    // network in general is down. CORS is named first because it is the
    // overwhelmingly likely cause, and the alternative is named too rather
    // than asserting a single diagnosis.
    return {
      ok: false,
      stage,
      cors: true,
      detail: 'this app was blocked before the request reached the bucket. Almost always the bucket\'s missing CORS rule — paste the CORS JSON from the setup guide (Systems Handbook §12.7a) into the bucket settings and probe again. If the rule is already there, something on this network (a proxy or firewall) is blocking the bucket\'s host.',
    }
  }
}
