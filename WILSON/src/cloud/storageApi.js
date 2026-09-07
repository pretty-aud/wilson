// =============================================================================
// storageApi — Session 37: client bindings for the S3-compatible storage Edge
// Functions (storage-presign, storage-secret). House style follows
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

import { supabase } from './auth/supabaseClient'
import { releaseStaleUploads } from '../tools/rabbit_v0.1.0/storage/uploadReservation.js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

async function sessionToken() {
  try {
    const { data } = await supabase.auth.getSession()
    return data?.session?.access_token ?? null
  } catch {
    return null
  }
}

async function callStorageFn(name, body) {
  const token = await sessionToken()
  if (!token) {
    return { ok: false, status: 401, data: { error: 'unauthorized', detail: 'Session expired — sign in again.' } }
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
    return { ok: res.ok, status: res.status, data: json }
  } catch {
    return { ok: false, status: 0, data: { error: 'network', detail: 'Network error — check your connection.' } }
  }
}

/**
 * Mint a presigned URL for one request against one row-shaped path.
 * THROWS on refusal, with the server's sentence — see header.
 *
 * @param {'put'|'get'|'del'|'head'} op
 * @param {string} path row-shaped storage_path (never carries the prefix)
 * @returns {Promise<{url: string, method: string, expiresAt: string}>}
 */
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

export async function presignStorage(op, path) {
  const res = await callStorageFn('storage-presign', { op, path })
  if (!res.ok || !res.data?.url) {
    const detail = res.data?.detail || res.data?.error || `presign failed (${res.status})`
    throw new Error(`[s3] ${detail}`)
  }
  return res.data
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
