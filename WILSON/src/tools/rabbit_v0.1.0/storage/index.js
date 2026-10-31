// =============================================================================
// storage/index.js — Session 36: the storage provider REGISTRY.
//
// NETWORK_STORAGE_DESIGN.md §4a2b. Audrey, 2026-08-07, verbatim:
//   "So remember its bring your own storage solution … nas, gdrive, AWS s3
//    buckets, etc are all going to be options if we add the gdrive solution
//    dont remove other options"
//
// Bring-your-own-storage is a FAMILY. This module is the ONE place that knows
// which providers exist, what a provider IS, and where a given file's body
// lives. S37 (S3-compatible) and S38 (Google Drive) each add ONE entry here
// and ONE value to migration 0050's CHECK — never a fork of the 116-method
// backend adapter.
//
// 🚨 A PROVIDER IS FOUR FUNCTIONS, NEVER AN ADAPTER FORK.
//   put(key, body, opts) -> { key }     get(key) -> Blob
//   del(key) -> void                    exists(key) -> boolean
// plus describe() for the configuration-time reachability probe (the S34
// pattern: tell someone their storage is unreachable while they are SETTING
// it, not at their first download six screens away), and — since P1 —
// getUrl(key, expiresIn, opts), the URL a preview or a player reads (REQUIRED
// below says why it joined).
// `googleDriveAdapter.js` is 57 readOnly() stubs across 68 methods, modelled
// on single-user JSON bundles and predating workspaces, RLS, the folder tree
// and the manifest. It is the shape to AVOID, not to finish.
//
// 🚨 THE ASSUMPTION THIS MODULE EXISTS TO BREAK. Measured 2026-08-07: nothing
// in the repo reads `files.storage_provider` to decide where to fetch a body.
// All three adapters fetch unconditionally from their own backend, so routing
// is decided by ADAPTER SELECTION — per session, not per file. That is fine
// while every row says 'supabase'. The day a workspace switches provider it
// silently orphans everything already written. resolveFileProvider() below is
// the fix: a body is fetched from the provider THE ROW NAMES, never from the
// workspace's current setting.
// =============================================================================

// ── The vocabularies, and why there are two ─────────────────────────────────
// They are different axes and must not be merged:
//   * WORKSPACE_PROVIDERS — what the workspace CHOSE (configuration).
//     Mirrors migration 0050's workspace_storage_provider_chk exactly.
//   * FILE_PROVIDERS — where THIS body actually is (a fact about one file).
//     Mirrors the public.storage_provider enum (0000_rabbit_base_schema.sql).
// A financial file is 'supabase' whatever the workspace chose, which is why
// one vocabulary could never serve both.

export const WORKSPACE_PROVIDERS = Object.freeze({
  PETAL:   'petal',    // Petal-operated cloud (Supabase). mode 'central'.
  NETWORK: 'network',  // The customer's own filesystem root — NAS or server (S34).
  S3:      's3',       // The customer's own S3-compatible bucket (S37).
})

export const WORKSPACE_PROVIDER_VALUES = Object.freeze(
  Object.values(WORKSPACE_PROVIDERS),
)

export const FILE_PROVIDERS = Object.freeze({
  SUPABASE:     'supabase',
  GOOGLE_DRIVE: 'google_drive',
  LOCAL_SERVER: 'local_server',
  S3:           's3',   // 0051 adds the enum value alongside this entry.
})

// Which store a NEW body goes to for a given workspace provider. S37 adds
// 's3' here and to 0050's CHECK in the same session as the adapter.
//
// ⚠️ NETWORK MAPS TO A PROVIDER THIS REGISTRY DOES NOT REGISTER, ON PURPOSE.
// 'network' means the body sits on the customer's own filesystem, which only
// the Electron main process can reach — a browser cannot write to a NAS. That
// path runs through localServerAdapter and Express, which do not use this
// registry at all. So fileProviderFor('network') is a correct STATEMENT ABOUT
// WHERE A BODY LIVES, while getStorageProvider('local_server') will throw:
// there is no cloud-side implementation and there should not be one.
//
// 🚨 S37 (done): uploadFile's constant became activeWorkspaceProvider(row) —
// one argument, as promised, for 's3' (which HAS a registered
// implementation). The exception S36's review raised stands: a cloud-mode
// workspace configured as 'network' has no cloud upload path and is refused
// with a sentence in uploadFile, before this map is consulted.
const NEW_BODY_GOES_TO = Object.freeze({
  [WORKSPACE_PROVIDERS.PETAL]:   FILE_PROVIDERS.SUPABASE,
  [WORKSPACE_PROVIDERS.NETWORK]: FILE_PROVIDERS.LOCAL_SERVER,
  [WORKSPACE_PROVIDERS.S3]:      FILE_PROVIDERS.S3,
})

// ── Which provider accepts NEW bodies right now ─────────────────────────────
// The ONE definition of "active", mirroring the two layers that already gate
// retained state on MODE (App.jsx pushes a root only when mode is 'byos';
// 0049 refuses a project folder unless mode is 'byos'): a workspace on
// 'central' is on Petal cloud NOW, whatever provider it has RETAINED —
// central + network + a path, and central + s3 + a config, are the legal,
// inert, remembered states 0048/0050 designed for. Reads never come through
// here: a body is fetched from the provider THE ROW NAMES
// (resolveFileProvider), which is exactly what keeps a switched workspace's
// old bodies reachable.
export function activeWorkspaceProvider(storageRow) {
  if (!storageRow || storageRow.mode !== 'byos') return WORKSPACE_PROVIDERS.PETAL
  const provider = storageRow.provider
  // byos with no real provider cannot exist under 0050's mode_provider_chk;
  // seeing it means a malformed or pre-0050 row. Fail CLOSED with a sentence
  // — defaulting to Petal here would silently route a customer's media to a
  // store they explicitly moved away from.
  if (!provider || provider === WORKSPACE_PROVIDERS.PETAL) {
    throw new Error(
      'this workspace is set to its own storage but names no provider — reload, and check Admin Terminal → Storage',
    )
  }
  return provider
}

// ── P1 (night 4): what a cloud surface says of a NAS workspace's media ──────
// NETWORK_STORAGE_DESIGN.md §9.4, measured: a workspace whose ACTIVE provider
// is 'network' keeps its media on its own server, recorded in the desktop's
// Local Server mode; the cloud holds no `files` row for any of it (uploadFile
// refuses one), so the browser has nothing to list or preview, and its file
// panels would otherwise read as empty. This is the sentence they say instead
// (the design round found it needs no new ruling: uploadFile says the same
// when it refuses, and Bins says it for footage). Whether those files are ever
// listed in the cloud is Audrey's question (Q1 of walkthrough 85, P1).
export const SERVER_MEDIA_SENTENCE =
  'This company keeps its media on its own server, so files are added and opened in the WILSON desktop app (Local Server mode). Footage on the server is listed in Bins.'

/** Whether the workspace's ACTIVE choice is its own server; false on any doubt. */
export function storesMediaOnServer(storageRow) {
  try {
    return activeWorkspaceProvider(storageRow) === WORKSPACE_PROVIDERS.NETWORK
  } catch {
    return false
  }
}

// ── 🚨 The invariant that must survive every provider ───────────────────────
// §4a2b invariant 2: money-gated files NEVER leave Supabase.
//
// INVOICES/ and FINANCE/ are manager-only because the storage path's third
// segment says so and POSTGRES enforces it (public.rabbit_money_segment,
// 0042 — which took 0038 -> 0039 to get right after shipping inverted).
// Drive has opaque ids and its own sharing model; S3 has bucket policies.
// Neither binds to a WILSON project role, so moving invoices to either
// re-opens the exact hole 0039 closed, somewhere RLS cannot see it.
//
// This is the client half of the pin and it sits at the ONE place that
// already decides the money path, so the row and the path segment cannot
// disagree. The other half is migration 0050's files_money_provider_chk,
// which refuses the same rows for a devtools caller, a hand-made PostgREST
// request, or a future adapter that forgets — refusals in depth (the S34
// rule), because this is the one invariant whose failure is silent.
// The locked folders, the client's ONE copy of public.rabbit_money_segment's
// vocabulary (0042 + 0088's LEGAL; the Deno copy is _shared/moneySegments.ts,
// and storagePresignBoundary.test.js holds the two to each other). A key whose
// THIRD segment is one of them is money-gated: the s3 read signer is never
// asked for it (storageApi.presignReadUrls answers it itself), and the
// connection dot never reads one. Case-folded, as the SQL is.
export const MONEY_SEGMENTS = Object.freeze(['INVOICES', 'FINANCE', 'LEGAL'])

export function isMoneyKey(path) {
  if (typeof path !== 'string') return false
  const seg = path.split('/')[2]
  return typeof seg === 'string' && seg !== '' && MONEY_SEGMENTS.includes(seg.toUpperCase())
}

export function fileProviderFor(workspaceProvider, { financial = false } = {}) {
  if (financial) return FILE_PROVIDERS.SUPABASE
  const mapped = NEW_BODY_GOES_TO[workspaceProvider]
  if (!mapped) {
    throw new Error(
      // The constraint is named, not numbered: 0050 CREATED
      // workspace_storage_provider_chk, 0051 widened it to 's3', and the next
      // provider widens it again. Pointing at a migration NUMBER sends the
      // next session to the file that no longer defines the live rule.
      `unknown storage provider "${workspaceProvider}" — add it to WORKSPACE_PROVIDERS and widen workspace_storage_provider_chk (DROP + ADD, never a wrapped re-ADD) in the same session`,
    )
  }
  return mapped
}

// ── The registry ────────────────────────────────────────────────────────────
// Keyed by FILE_PROVIDERS value, because that is what a file row names and
// what a read has to resolve.

const registry = new Map()

// P1 (night 4): `getUrl(key, expiresIn, opts)` JOINS THE CONTRACT. It was
// optional from S40 until now because s3 could not honour it — its only
// signer was storage-presign's one-key, 300 s GET, which kills a clip at five
// minutes and a grid at six. storage-read-urls (NETWORK_STORAGE_DESIGN.md
// §9.2) gives s3 its own, so all three registered providers implement it:
// supabase signs, local_server answers its own server's URL (or NOT_HERE),
// s3 asks the read signer. A provider without it is now refused here.
const REQUIRED = ['put', 'get', 'del', 'exists', 'describe', 'getUrl']

export function registerStorageProvider(name, impl) {
  if (!Object.values(FILE_PROVIDERS).includes(name)) {
    throw new Error(`cannot register unknown storage provider "${name}"`)
  }
  // A provider that is missing a function is the googleDriveAdapter shape
  // arriving by the back door — refuse it at registration rather than at the
  // first upload of somebody's rushes.
  const missing = REQUIRED.filter(fn => typeof impl?.[fn] !== 'function')
  if (missing.length) {
    throw new Error(`storage provider "${name}" is missing: ${missing.join(', ')}`)
  }
  registry.set(name, impl)
  return impl
}

export function getStorageProvider(name) {
  const impl = registry.get(name)
  if (!impl) throw new Error(`no storage provider registered for "${name}"`)
  return impl
}

export function hasStorageProvider(name) {
  return registry.has(name)
}

// 🚨 Resolve a body's home from the ROW, never from the workspace's current
// setting — a workspace that switches provider must not orphan what it has
// already written.
export function resolveFileProvider(fileRow) {
  const name = fileRow?.storage_provider
  if (!name) {
    throw new Error('this file row names no storage provider — its body cannot be located')
  }
  return getStorageProvider(name)
}

// Test seam. Underscore-prefixed by convention, but it IS a normal export of a
// module the app imports — calling it at runtime would leave every later
// resolveFileProvider() throwing "no storage provider registered". Only
// storageRegistry.test.js calls it.
export function __resetStorageRegistry() {
  registry.clear()
}
