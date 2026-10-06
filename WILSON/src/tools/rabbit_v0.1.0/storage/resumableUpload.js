// =============================================================================
// storage/resumableUpload.js — Session 42: the TUS path, so cloud mode can hold
// the customer's actual media. NETWORK_STORAGE_DESIGN.md §3.6 Path 2.
//
// Audrey, 2026-08-05: "i need to be able to store media so 50MB is not
// acceptable. im going to have multiple GB files at times."
//
// Standard uploads reach 5 GB, so this is NOT what makes multi-GB possible on
// its own — migration 0057's cap is. What this buys is the three things a
// single PUT cannot give: objects above 5 GB, continuation after a dropped
// connection, and a progress figure for an upload that runs for an hour.
//
// ── 🚨 THE THRESHOLD IS THE OLD CAP, AND THAT IS A SAFETY ARGUMENT ──────────
//
// Supabase recommends resumable above 6 MB. This module switches at 50 MiB —
// the exact ceiling that stood until migration 0057 — so EVERY upload that was
// possible before S42 keeps taking the byte-for-byte identical code path it has
// always taken, and only genuinely new territory takes new code. A regression
// in this file therefore cannot reach any upload that worked yesterday.
//
// ── 🚨 WHY THIS DOES NOT BREAK THE QUOTA (measured, storage-api v1.68.1) ────
//
// `completeUpload` calls `db.upsertObject(...)` REGARDLESS of the isUpsert flag,
// so `x-upsert: false` is NOT what keeps migration 0055/0057's RESTRICTIVE
// INSERT policy binding. What keeps it binding is that supabaseAdapter.uploadFile
// mints a UNIQUE key per attempt (`.../<Date.now()>-<name>`): with no
// conflicting row the upsert takes its INSERT branch. Reusing a key would take
// the UPDATE branch and silently escape the quota entirely.
//
// The permission check runs TWICE — once at upload creation via
// `db.testPermission()` (a trial insert that is rolled back) and once for real
// at completion. The creation-time trial carries `contentLength` while the
// committed row carries `size`, which is why 0057's
// rabbit_object_incoming_bytes() reads either. Consequence worth knowing: an
// over-quota upload is refused BEFORE the bytes move, not after an hour.
//
// ── 🚨 NO CROSS-SESSION RESUME, DELIBERATELY ────────────────────────────────
//
// tus-js-client's findPreviousUploads() matches on a fingerprint derived from
// the FILE, not the destination. Our keys carry Date.now(), so a second attempt
// at the same file targets a different object — and resuming the stored URL
// would stream the bytes to the OLD key while the `files` row names the new
// one, producing an orphan and a missing file at once. So previous uploads are
// never looked up, and the fingerprint below is keyed on the destination so
// nothing else can match it either.
//
// Resume after a dropped connection DOES work, within the attempt: tus asks the
// server for its offset and continues from there. Resuming across an app
// restart would need a deterministic key, which the quota's INSERT-branch
// argument above depends on NOT having.
// =============================================================================

import * as tus from 'tus-js-client'

// 🚨 READ AT CALL TIME, NOT AT IMPORT. A module-level `const X =
// import.meta.env.Y` freezes the value when the module is first evaluated,
// which makes it untestable and made this file impossible to cover in CI: the
// runner has no `.env*` files (they are gitignored), so the constants were
// undefined the moment the module loaded and every test touching putResumable
// failed there and only there. Predicted by S42's own pre-deploy review and
// missed because that finding fell outside the verification budget.
const supabaseUrl  = () => import.meta.env.VITE_SUPABASE_URL
const supabaseAnon = () => import.meta.env.VITE_SUPABASE_ANON_KEY

// The ceiling that stood from 0027 until 0057. See the header.
export const RESUMABLE_THRESHOLD_BYTES = 52_428_800 // 50 MiB

// 🚨 SUPABASE REQUIRES EXACTLY 6 MB AND SAYS SO: "it must be set to 6MB (for
// now) do not change it". This is not a tuning knob.
export const TUS_CHUNK_SIZE = 6 * 1024 * 1024

/**
 * Should this body go through the resumable protocol?
 * Size is read defensively: a File with no size (or a Blob) falls back to the
 * standard path, which is the one that has always worked.
 */
export function shouldUseResumable(body) {
  const size = Number(body?.size)
  return Number.isFinite(size) && size > RESUMABLE_THRESHOLD_BYTES
}

/**
 * 🚨 DO NOT RETRY A REFUSAL.
 *
 * tus retries network errors and 5xx, which is right. But an RLS refusal — the
 * quota gate, a suspended plan, a path the caller may not write — comes back as
 * 4xx and is PERMANENT: retrying it five times over 38 seconds turns an instant,
 * explainable "no" into a long pause followed by the same "no".
 *
 * 423 is the exception storage-api actually uses: it locks an object while
 * another upload holds it, and that clears on its own.
 */
export function shouldRetryTusError(err) {
  const status = err?.originalResponse?.getStatus?.()
  if (status === 423) return true
  // 🚨 401 IS THE ONE 4xx THAT IS NOT PERMANENT, and treating it as permanent is
  // the defect this session's own pre-deploy review found (HIGH, confirmed by
  // two independent verifiers). An access token lives at most `jwt_expiry`
  // (3600 s) and getSession() legitimately returns one with as little as 91 s
  // left — auth-js only refreshes inside EXPIRY_MARGIN_MS. This is the first
  // code in the repo that can run longer than a JWT, so it is the first place
  // where a token dies mid-operation.
  //
  // onBeforeRequest below re-reads a FRESH token for every request, so a retry
  // here is not the same doomed string being resent — it is a genuine second
  // attempt with new credentials. Both halves are needed: without the hook a
  // retry resends the dead token; without this line the hook never gets a
  // second request to decorate.
  if (status === 401) return true
  if (typeof status === 'number' && status >= 400 && status < 500) return false
  return true
}

/**
 * Upload one body through the TUS resumable endpoint.
 *
 * Resolves with { key } to match the storage provider's put() contract, and
 * THROWS on every failure — the registry contract is that a provider function
 * throws rather than resolving, because an unchecked resolve turns a 403 into a
 * success (the otterFetch trap, which cost the O.T.T.E.R. Validator every fix
 * Audrey ever accepted). A chunked upload has many more places to swallow a
 * failure than a single request does.
 *
 * @param {object}   args
 * @param {string}   args.bucket        bucket id — passed, not assumed, because
 *                                      the caller owns the "which bucket" rule
 * @param {string}   args.key           object key inside the bucket
 * @param {Blob|File} args.body
 * @param {string}   args.accessToken   the caller's session JWT, read once for
 *                                      the pre-flight check below
 * @param {() => Promise<string|null>} [args.getAccessToken]
 *        🚨 A FUNCTION, NOT A STRING, AND THIS IS THE WHOLE POINT. See the
 *        header note on token lifetime. Called before EVERY request so a token
 *        that expires mid-upload is replaced rather than resent.
 * @param {string}  [args.contentType]
 * @param {(sent: number, total: number) => void} [args.onProgress]
 */
export function putResumable({
  bucket, key, body, accessToken, getAccessToken, contentType, onProgress,
}) {
  const baseUrl = supabaseUrl()
  if (!baseUrl) {
    throw new Error('[supabase] resumable upload needs VITE_SUPABASE_URL')
  }
  if (!accessToken) {
    // Never start an upload that cannot possibly be authorised — a missing
    // token would otherwise surface as an opaque 401 after the first chunk.
    throw new Error('[supabase] resumable upload needs a signed-in session')
  }

  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(body, {
      endpoint: `${baseUrl}/storage/v1/upload/resumable`,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      headers: {
        authorization: `Bearer ${accessToken}`,
        apikey: supabaseAnon(),
        // Defensive rather than load-bearing — see the header: completeUpload
        // upserts either way, and it is the unique key that keeps the INSERT
        // branch (and so the quota policy) in play.
        'x-upsert': 'false',
      },
      // Send the first chunk with the creation request: one fewer round trip,
      // and it makes an over-quota refusal arrive immediately.
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      // Keyed on the DESTINATION, not the file — see the header. Two different
      // uploads of the same bytes to two different keys must never collide.
      fingerprint: async () => `wilson/${bucket}/${key}`,
      chunkSize: TUS_CHUNK_SIZE,
      // 🚨 THE TOKEN MUST BE READ PER REQUEST, NOT FROZEN AT START.
      //
      // tus-js-client re-reads `options.headers` for every request (creation,
      // each PATCH, each HEAD) — but nothing mutates that object, so a bearer
      // string baked in above would be resent unchanged for the life of the
      // upload. `jwt_expiry` is 3600 s and auth-js hands back any token with
      // 90 s or more of life left without refreshing it, while the supabase
      // client rotates its own session in the background. So the first draft of
      // this file guaranteed that no upload lasting longer than its token could
      // ever finish — on the one path that only runs above 50 MiB, which is
      // precisely the multi-GB traffic this module exists to carry.
      //
      // storage-api registers JWT verification ahead of the tus route, so every
      // PATCH is authenticated; an expired token is a 401 on the next chunk.
      // onBeforeRequest is the hook tus provides for exactly this.
      //
      // ⚠️ FAILS SOFT. If the refresh cannot be read we leave the existing
      // header alone rather than clearing it: the stale token may still be
      // valid, and stripping authorization guarantees a 401 that the retry
      // arm would then have to absorb.
      onBeforeRequest: typeof getAccessToken === 'function'
        ? async (req) => {
            try {
              const fresh = await getAccessToken()
              if (fresh) req.setHeader('authorization', `Bearer ${fresh}`)
            } catch { /* keep the header we already have */ }
          }
        : undefined,
      metadata: {
        bucketName:  bucket,
        objectName:  key,
        contentType: contentType || body?.type || 'application/octet-stream',
        cacheControl: '3600',
      },
      onShouldRetry: shouldRetryTusError,
      onProgress: typeof onProgress === 'function'
        ? (sent, total) => { try { onProgress(sent, total) } catch { /* a progress bar must never fail an upload */ } }
        : undefined,
      onError: (err) => {
        // Surface the server's own sentence where there is one. storage-api
        // returns a JSON body on refusal; tus wraps it in originalResponse.
        const status = err?.originalResponse?.getStatus?.()
        const raw    = err?.originalResponse?.getBody?.()
        let detail = ''
        try {
          const parsed = raw ? JSON.parse(raw) : null
          detail = parsed?.message || parsed?.error || ''
        } catch { detail = typeof raw === 'string' ? raw.slice(0, 200) : '' }
        reject(new Error(
          `[supabase] resumable upload failed${status ? ` (${status})` : ''}: ` +
          (detail || err?.message || 'unknown error'),
        ))
      },
      onSuccess: () => resolve({ key }),
    })

    // 🚨 NO findPreviousUploads() — see the header. Resuming a fingerprint
    // matched on the file would stream these bytes to a previous attempt's key.
    upload.start()
  })
}
