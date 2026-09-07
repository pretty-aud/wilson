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
// every gigabyte of every customer's media, forever).
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

/**
 * @param {(op: 'put'|'get'|'del'|'head', path: string) => Promise<{url: string}>} presign
 *   src/cloud/storageApi.presignStorage, injected (the createSupabaseStorageProvider
 *   pattern: the adapter owns its dependencies; the provider stays unit-testable).
 */
export function createS3StorageProvider(presign) {
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
