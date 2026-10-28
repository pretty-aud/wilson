// =============================================================================
// storage/s3Provider.js — Session 37: the SECOND provider through the
// registry, and the first BYO one (NETWORK_STORAGE_DESIGN.md §4a2/§4a2b).
//
// One implementation covers AWS S3, Backblaze B2, Wasabi, Hetzner, Cloudflare
// R2 and MinIO — they all speak the same API; only the endpoint differs.
//
// THE SHAPE: every operation is presign-then-fetch. The storage-presign Edge
// Function holds the authorisation boundary (project write/read predicates,
// money-segment refusal, path shape) and the ONLY copy of the bucket secret;
// this module never sees a credential, an endpoint or the workspace prefix —
// it sends the ROW-SHAPED key and receives a URL. The bytes then travel
// DIRECTLY between this client and the customer's bucket: Petal never
// proxies them (§4a2's "direct" condition — a relay would bill Petal for
// every gigabyte of every customer's media, forever). Since P1, reading for
// DISPLAY (getUrl, getUrls) goes through storage-read-urls instead, the same
// shape with its own boundary (below).
//
// Every function THROWS on failure instead of resolving — the registry
// contract, and the otterFetch trap's antidote: an unchecked resolve turns a
// 403 into a success.
//
// 🚨 CORS applies on BOTH surfaces. The browser build obviously; but the
// desktop renderer is Chromium with webSecurity on, so it enforces CORS
// exactly the same way. (The S37 brief claimed desktop uploads bypass CORS —
// measured otherwise; the outcome block records the correction.) The bucket
// needs its one-time CORS rule either way — §12.7a carries the JSON — and the
// error sentence below names it, because a missing CORS rule surfaces as a
// bare TypeError with no status and no server log: the single most likely
// support call this feature generates.
// =============================================================================

import { isMoneyKey } from './index.js'

// ── P1 (night 4): reading for display — NETWORK_STORAGE_DESIGN.md §9.3 ─────
//
// The previews of an s3 workspace live in ITS bucket (S44: a still frame is
// the content), so showing them needs signed GETs, and a panel needs dozens at
// once. storage-read-urls signs up to 100 keys a call, each only if a row the
// caller can read owns it, and answers per key: a thumbnail for an hour, a
// body read once for five minutes, one streaming body for an hour.
//
// THE CACHE is module-level, as the pet's course index is: a panel remounted
// within the hour must not sign its thumbnails again. A URL is handed out
// again only while more than RENEW_MARGIN of its life is left, measured on
// THIS clock from when its call was SENT (a skewed clock cannot stretch it),
// so a tile that mounts late never gets a URL about to die. App.jsx clears
// it whenever the person or the workspace changes; the clear bumps a
// generation, and a call still in flight checks it before it writes, so an
// answer meant for the last person never refills the cache for the next.

/** _shared/readUrls.ts READ_URLS_MAX_KEYS — storagePresignBoundary.test.js pins them equal. */
export const S3_READ_BATCH = 100
/** A cached URL is handed out only with more than this left (FileManager re-asks every 5 min). */
export const S3_READ_RENEW_MARGIN_MS = 10 * 60 * 1000

const readCache = new Map() // key → { url, until }
let readGeneration = 0

export function clearS3ReadUrlCache() {
  readCache.clear()
  readGeneration += 1
}

// Why a key was refused, in words a person can act on. Never the key itself:
// a key carries a filename.
const REFUSED = Object.freeze({
  money: 'money and Legal files stay in Petal\'s storage, so this one cannot be opened from your bucket',
  shape: 'this file\'s storage path is not one WILSON writes, so it cannot be opened from your bucket',
  project: 'you cannot open the files of this project',
  row: 'this file is not one you can open any more',
})

/** _shared/readUrls.ts READ_URLS_MAX_FOLDERS — pinned equal beside S3_READ_BATCH. */
export const S3_READ_FOLDERS = 10

// One call per project (the signer takes at most two), at most S3_READ_BATCH
// keys and S3_READ_FOLDERS folders each (the signer reads its rows one folder
// at a time), in the order the keys came.
function readBatches(keys) {
  const byProject = new Map()
  for (const k of keys) {
    const p = k.split('/')[1] || ''
    if (!byProject.has(p)) byProject.set(p, [])
    byProject.get(p).push(k)
  }
  const out = []
  for (const group of byProject.values()) {
    let batch = []
    let folders = new Set()
    for (const k of group) {
      const folder = k.slice(0, k.lastIndexOf('/'))
      const full = batch.length >= S3_READ_BATCH || (!folders.has(folder) && folders.size >= S3_READ_FOLDERS)
      if (full) { out.push(batch); batch = []; folders = new Set() }
      batch.push(k)
      folders.add(folder)
    }
    if (batch.length) out.push(batch)
  }
  return out
}

/**
 * @param {(op: 'put'|'get'|'del'|'head', path: string) => Promise<{url: string}>} presign
 *   src/cloud/storageApi.presignStorage, injected (the createSupabaseStorageProvider
 *   pattern: the adapter owns its dependencies; the provider stays unit-testable).
 * @param {(keys: string[], opts?: {stream?: boolean}) => Promise<{urls: object, expires: object, refused: object}>} [presignReads]
 *   src/cloud/storageApi.presignReadUrls (P1). Without it there is no display:
 *   getUrl answers null and getUrls an empty map — a stated gap, never a throw.
 * @param {{now?: () => number}} [opts] the clock, a test seam.
 */
export function createS3StorageProvider(presign, presignReads = null, { now = () => Date.now() } = {}) {
  // fetch throws a bare TypeError for every browser-blocked shape (CORS,
  // mixed content, DNS). Distinguish it from an HTTP refusal so the sentence
  // names the actual fix.
  async function fetchOrExplain(url, init, what) {
    try {
      return await fetch(url, init)
    } catch {
      throw new Error(
        `[s3] the browser was blocked before the ${what} reached the bucket — ` +
        'usually the bucket\'s missing CORS rule (Systems Handbook §12.7a has the JSON to paste), ' +
        'or the endpoint is unreachable from this network',
      )
    }
  }

  return {
    name: 's3',

    // upsert semantics: a presigned PUT always overwrites — S3 has no
    // upsert:false. Overwrite safety comes from the KEY, which embeds
    // Date.now() (uploadFile), so two distinct uploads can never share one.
    async put(key, body, opts = {}) {
      const signed = await presign('put', key)
      const res = await fetchOrExplain(signed.url, {
        method: 'PUT',
        body,
        // Content-type travels unsigned (SignedHeaders=host) — advisory for
        // the provider's metadata, irrelevant to authorisation.
        headers: opts.contentType || body?.type
          ? { 'content-type': opts.contentType || body.type }
          : undefined,
      }, 'upload')
      if (!res.ok) {
        throw new Error(`[s3] storage upload failed: the bucket refused it (HTTP ${res.status})`)
      }
      return { key }
    },

    async get(key) {
      const signed = await presign('get', key)
      const res = await fetchOrExplain(signed.url, { method: 'GET' }, 'download')
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? '[s3] storage download failed: the object is gone from the bucket'
            : `[s3] storage download failed: the bucket refused it (HTTP ${res.status})`,
        )
      }
      return await res.blob()
    },

    async del(key) {
      const signed = await presign('del', key)
      const res = await fetchOrExplain(signed.url, { method: 'DELETE' }, 'delete')
      // S3 DELETE is idempotent-success (204 for an already-gone KEY), so a
      // 404 is never "the object was missing" — it is the BUCKET failing to
      // resolve. Raised, not swallowed: this comment used to say so while the
      // code tolerated 404 anyway (S37 review).
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? '[s3] storage delete failed: the bucket did not resolve (404) — check the bucket name, endpoint and path-style setting'
            : `[s3] storage delete failed: the bucket refused it (HTTP ${res.status})`,
        )
      }
    },

    async exists(key) {
      const signed = await presign('head', key)
      const res = await fetchOrExplain(signed.url, { method: 'HEAD' }, 'check')
      if (res.ok) return true
      if (res.status === 404) return false
      // 403 without ListBucket is S3's shape for "missing, but I won't say
      // so" — with our own signed HEAD that should not occur; anything else
      // is a real fault and must not read as "absent" (a false "missing"
      // is how a GC deletes a body it merely could not see).
      throw new Error(`[s3] storage check failed: HTTP ${res.status}`)
    },

    // P1: the URL a preview stage or a player reads — signed fresh every time,
    // because its life starts when the stage starts. `stream` asks for the
    // hour a <video> or <audio> needs; anything else is read once (300 s).
    // `expiresIn` is the Petal arm's argument; the read signer decides here.
    //
    // ⚠️ `{ download }` ANSWERS null, and downloadUrl's caller falls back to
    // the Blob path through storage-presign, as before P1: a cross-origin
    // `a.download` is ignored, and the attachment disposition would have to
    // be signed into the URL, which the read signer does not do.
    //
    // A refused key THROWS its reason, so the preview says why instead of
    // "no preview" (the supabase arm throws a signing error the same way).
    async getUrl(key, _expiresIn, opts = {}) {
      if (opts.download || !presignReads) return null
      const res = await presignReads([key], { stream: opts.stream === true })
      const url = res?.urls?.[key]
      if (url) return url
      throw new Error(`[s3] ${REFUSED[res?.refused?.[key]] || 'your bucket did not answer for this file'}`)
    },

    // P1: display URLs for many keys — the thumbnails of a panel. Cached (see
    // the header); money keys never asked; a refused key simply has no URL,
    // so its tile is the file-type icon, as a Petal key RLS refuses is. A call
    // that fails THROWS, and the caller (RabbitProvider.thumbnailUrls) keeps
    // the panel standing.
    async getUrls(keys) {
      const out = new Map()
      if (!presignReads) return out
      const t = now()
      const ask = []
      for (const k of new Set((keys || []).filter((x) => typeof x === 'string' && x))) {
        if (isMoneyKey(k)) continue
        const hit = readCache.get(k)
        if (hit && hit.until - t > S3_READ_RENEW_MARGIN_MS) out.set(k, hit.url)
        else ask.push(k)
      }
      const generation = readGeneration
      for (const batch of readBatches(ask)) {
        const sentAt = now()
        const res = await presignReads(batch)
        for (const k of batch) {
          const url = res?.urls?.[k]
          if (!url) continue
          out.set(k, url)
          const seconds = Number(res?.expires?.[k]) || 0
          if (seconds > 0 && generation === readGeneration) {
            readCache.set(k, { url, until: sentAt + seconds * 1000 })
          }
        }
      }
      return out
    },

    // The configuration-time probe for THIS provider lives with the config:
    // StorageSection drives the storage-secret Edge Function's probe (a real
    // server-side round trip plus the client CORS half). describe() states
    // that rather than duplicating a weaker copy of it here.
    async describe() {
      return {
        provider: 's3',
        label: 'S3-compatible bucket',
        configurable: true,
        detail:
          'The workspace\'s own bucket (AWS S3, Backblaze B2, Wasabi, Hetzner, ' +
          'Cloudflare R2 or MinIO). Configured and probed in Admin Terminal → ' +
          'Storage; transfers are presigned and go direct to the bucket.',
      }
    },
  }
}
