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

const BUCKET = 'rabbit-files'

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
    async put(key, body, opts = {}) {
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
