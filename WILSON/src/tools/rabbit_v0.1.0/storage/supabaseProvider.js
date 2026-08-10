// =============================================================================
// storage/supabaseProvider.js — Session 36: the FIRST provider through the
// registry, and deliberately not a new one.
//
// This wraps the calls supabaseAdapter has always made
// (`client.storage.from('rabbit-files')`) in the four-function contract, so
// that contract has a LIVE CALLER from day one rather than waiting for S37.
//
// 🚨 That is not ceremony. SEVEN features have shipped in this project with no
// caller (folder tree S27, task templates S28, quiz history S30,
// setOtterAdapterMode, workspaces.storage_mode, POST /api/pet/reset, S31's
// settings half). A green test over a dead path is the repo's costliest
// pattern, and an interface nobody calls is the same shape one level up. So
// S36's registry routes the storage traffic that already exists: behaviour is
// unchanged, every existing test still passes, and S37 adds an entry to the
// map instead of a branch to the adapter.
//
// THE BUCKET IS NOT A PARAMETER. 'rabbit-files' is the private bucket whose
// eight RLS policies (0042) are the money gate; the avatars bucket is public
// and 2 MB and has nothing to do with project media. A `bucket` argument here
// would be an invitation to point project files at the wrong policy set.
// =============================================================================

import { putResumable, shouldUseResumable } from './resumableUpload.js'
import { withTimeout } from '../../../cloud/auth/withTimeout.js'

const BUCKET = 'rabbit-files'

// The session read is bounded for the reason OUTSTANDING.md records: an
// abandoned getSession() holds auth-js's global per-storageKey lock, and every
// later auth operation queues behind it with no acquire timeout. Bounding it
// here does not fix that class — nothing at a call site can — but it keeps a
// stalled session from hanging an upload with no message.
const AUTH_TIMEOUT_MS = 8000

/**
 * @param {() => Promise<any>} requireClient resolves the authed supabase-js
 *   client. Passed in rather than imported so the adapter keeps ownership of
 *   client lifecycle and the provider stays unit-testable with a fake.
 */
export function createSupabaseStorageProvider(requireClient) {
  const bucket = async () => (await requireClient()).storage.from(BUCKET)

  return {
    name: 'supabase',

    // upsert:false is load-bearing: every ordinary upload is a distinct user
    // action and a silent overwrite would destroy a version nobody asked to
    // replace. (The manifest and rates writers pass upsert:true deliberately
    // and do not ride this path — see writeProjectManifest/writeProjectRates.)
    //
    // ── 🚨 SESSION 42: TWO TRANSPORTS, ONE CONTRACT ─────────────────────────
    //
    // The branch lives HERE rather than in uploadFile on purpose. `put` is one
    // of the five REQUIRED registry functions and its signature does not
    // change, so uploadFile — the single writer that already decides the key,
    // the provider and the money pin — gains no new decision to get wrong, and
    // s3Provider is untouched (it has no TUS endpoint; S3 multipart is separate
    // work and this session did not do it).
    //
    // 🚨 THE THRESHOLD IS THE PRE-0057 CAP, WHICH MAKES THIS CHANGE UNABLE TO
    // REGRESS ANYTHING THAT WORKED. Every body that could be uploaded before
    // this session is <= 50 MiB and still takes the identical standard call
    // below; only sizes that were previously IMPOSSIBLE take the new path.
    //
    // ⚠️ NO FALLBACK FROM RESUMABLE TO STANDARD. A failed resumable upload is
    // reported, never retried down the other transport: above 5 GB the standard
    // path cannot succeed at all, and below it a silent second attempt would
    // turn one refusal (an RLS quota denial, say) into two uploads' worth of
    // egress and a second identical error the user never asked for.
    async put(key, body, opts = {}) {
      if (shouldUseResumable(body)) {
        const client = await requireClient()
        // 🚨 A READER, NOT A READING. The upload can outlive the token — see
        // resumableUpload.js's onBeforeRequest note — so this closure is called
        // again before every request rather than once here. Reading the session
        // ONCE and passing the string is the defect this session's pre-deploy
        // review found, and it broke exactly the multi-GB uploads S42 exists
        // for. supabase-js refreshes in the background; asking it each time is
        // what lets that refresh reach the upload.
        const readToken = async () => {
          const { data } = await withTimeout(
            client.auth.getSession(), AUTH_TIMEOUT_MS, 'reading your session',
          )
          return data?.session?.access_token ?? null
        }
        let token = null
        try {
          token = await readToken()
        } catch (e) {
          throw new Error(`[supabase] storage upload failed: ${e?.message || 'could not read your session'}`)
        }
        return putResumable({
          bucket: BUCKET,
          key,
          body,
          accessToken: token,
          getAccessToken: readToken,
          contentType: opts.contentType || body?.type || 'application/octet-stream',
          onProgress: opts.onProgress,
        })
      }

      const b = await bucket()
      const { error } = await b.upload(key, body, {
        cacheControl: '3600',
        upsert: false,
        contentType: opts.contentType || body?.type || 'application/octet-stream',
      })
      if (error) throw new Error(`[supabase] storage upload failed: ${error.message}`)
      return { key }
    },

    async get(key) {
      const b = await bucket()
      const { data, error } = await b.download(key)
      if (error) throw new Error(`[supabase] storage download failed: ${error.message}`)
      return data
    },

    async del(key) {
      const b = await bucket()
      const { error } = await b.remove([key])
      if (error) throw new Error(`[supabase] storage delete failed: ${error.message}`)
    },

    // Supabase Storage has no HEAD, so this lists the key's own directory and
    // looks for the leaf. Scoped with `search` so a busy project folder does
    // not page — and the 100-object default limit cannot produce a false
    // "missing" for an exact-name search.
    async exists(key) {
      const b = await bucket()
      const slash = key.lastIndexOf('/')
      const dir = slash === -1 ? '' : key.slice(0, slash)
      const leaf = slash === -1 ? key : key.slice(slash + 1)
      const { data, error } = await b.list(dir, { search: leaf, limit: 100 })
      if (error) throw new Error(`[supabase] storage list failed: ${error.message}`)
      return (data || []).some(o => o.name === leaf)
    },

    // ── Session 40: a URL a <video> can stream from ─────────────────────────
    //
    // 🚨 OPTIONAL BY DESIGN — NOT a sixth entry in REQUIRED. `get()` returns a
    // whole Blob, which is the right shape for a download and the wrong one for
    // playback: a <video> needs a URL it can issue Range requests against, and
    // a 5 GB master cannot be a Blob at all. But adding `getUrl` to
    // storage/index.js's REQUIRED list would make registerStorageProvider
    // REFUSE every provider that lacks it — and s3's implementation is exactly
    // the deferred work (its presigned GET expires in 300s, against this
    // function's 3600s, and there is no S3 workspace on any environment to
    // verify a longer-lived one against). So callers ask with `?.` and a
    // provider that cannot mint one simply has no playback, which is the
    // fail-closed direction.
    //
    // When s3 can do it, this becomes REQUIRED and both implement it. That is a
    // one-line change here and a session's work there; putting it in REQUIRED
    // now would break registration for the provider that cannot yet comply.
    //
    // ⚠️ 3600s is Supabase's signing horizon, not a promise about playback. A
    // clip longer than the remaining validity stops mid-stream with a 403 the
    // element reports as a stall; the player re-mints on error rather than
    // holding a sticky failure flag over an expiring URL (S39's own review
    // finding, one bucket over).
    // ── Session 42: the third argument, and why it is not cosmetic ──────────
    //
    // 🚨 `a.download` IS IGNORED FOR A CROSS-ORIGIN URL. A signed Supabase URL
    // is a different origin from the app, so an anchor pointing at it would
    // NAVIGATE rather than download — displaying video and images inline, and
    // saving everything else under the storage key's mangled leaf name instead
    // of the file's real one.
    //
    // `{ download: '<filename>' }` makes storage-api answer with
    // `Content-Disposition: attachment; filename=...`, which works cross-origin
    // and fixes the name at the same time. It is the only mechanism that does.
    async getUrl(key, expiresIn = 3600, opts = {}) {
      const b = await bucket()
      // Only pass the option when asked: the S40 video player wants an inline,
      // range-requestable URL, and Content-Disposition: attachment would make a
      // <video> download the file instead of playing it.
      const signOpts = opts.download ? { download: opts.download } : undefined
      const { data, error } = await b.createSignedUrl(key, expiresIn, signOpts)
      if (error) throw new Error(`[supabase] storage url failed: ${error.message}`)
      return data?.signedUrl || null
    },

    // The configuration-time probe (S34's rabbit:probe-storage-root pattern
    // generalised). Petal cloud needs no reachability check — it is the same
    // host the app is already authenticated against, so a failure here would
    // already have failed sign-in. Providers with a customer-supplied endpoint
    // (S37's bucket, S38's Drive folder) do the real work in their own
    // describe() and report a sentence a person can act on.
    async describe() {
      return {
        provider: 'supabase',
        label: 'Petal cloud',
        reachable: true,
        configurable: false,
        detail: 'Petal-operated storage. No setup — it rides the connection you are already signed in on.',
      }
    },
  }
}
