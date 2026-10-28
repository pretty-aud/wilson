// =============================================================================
// _shared/readUrls.ts — P1 (night 4, 2026-10-28): the storage-read-urls
// function's whole decision, pure and runtime-agnostic.
//
// NETWORK_STORAGE_DESIGN.md §9.2. A workspace on its own S3 bucket keeps its
// bodies AND its thumbnails there (S44: a still frame is the content), so the
// browser and the desktop need signed GETs to show them. storage-presign signs
// ONE key per call at 300 s under a budget sized for uploads; a panel of fifty
// thumbnails cannot afford fifty of those. This is the batch, GET only.
//
// No Deno.* and no network imports, so the repo's vitest imports this exact
// file across the boundary (the presignPath.ts arrangement): every refusal is
// tested here, against fakes. storage-read-urls/index.ts supplies only what
// touches the world — the guard, the limiter, the two reads made AS THE
// CALLER, the workspace's config and the signer.
//
// 🚨 THIS IS AN AUTHORISATION BOUNDARY: a signed URL is bearer authority over
// one object for its expiry. The refusals, in order:
//   1. requireActiveMember (the guard) — a live membership, not just a JWT.
//   2. The rate limit — its own bucket, so thumbnails and uploads never spend
//      each other's budget.
//   3. The body: bounded by its length BEFORE it is parsed; 1..100 keys;
//      `stream` only for one key.
//   4. Per key, checkRowShapedPath: row-shaped and canonical, and a money
//      segment (INVOICES, FINANCE, LEGAL, any case) refused before any
//      project or row is asked. Money never leaves Supabase.
//   5. At most two projects, each asked can_presign_project_read ONCE, as
//      the caller (`=== true`; an error is a refusal).
//   6. 🚨 THE ROW, AS THE CALLER. A key is signed only when a live `s3` files
//      row the caller can SELECT, IN THE KEY'S OWN PROJECT, owns it — its
//      storage_path IS the key (a body), or its storage_path + '.jpg' is the
//      key and its thumbnail_url says so (a thumbnail). files_select is
//      EVALUATED by that read, not copied (the S33 rule): against a READER,
//      a trashed file, a purged row whose body waits for collection, or an
//      object WILSON never wrote is not signed. And because
//      files.thumbnail_url is client-writable, a thumbnail is only ever the
//      key derived from the row's OWN body. ⚠️ Against a WRITER of the
//      project it holds less: files_insert/_update let a writer set
//      storage_path, so a writer can make a row vouch for any key under
//      their own project — the reach storage-presign's GET already gives
//      them (review round 1; OUTSTANDING OSP-01, OSP-07). The row must be in
//      the key's project, so a writer of one project can vouch for nothing
//      in another.
//      The read is BY FOLDER (`storage_path LIKE '<folder>/%'`, the key's
//      folder holds only ids), never by key, so no filename travels in a
//      URL or lands in an API log (review round 1, finding 4).
//   7. The workspace on s3 with a config and a usable secret (index.ts).
// The answer names a refusal by a code, never a sentence that could carry a
// filename, and nothing here logs a key.
// =============================================================================

import { checkRowShapedPath } from './presignPath.ts'

/** The bound on one call; the client splits a longer list. */
export const READ_URLS_MAX_KEYS = 100
/** The bound on the predicate calls one request can cause. */
export const READ_URLS_MAX_PROJECTS = 2
/** The bound on the row reads one request can cause (one per folder). */
export const READ_URLS_MAX_FOLDERS = 10
/** Read before parsing: 100 keys of the 1024 the path gate allows, and change. */
export const READ_URLS_MAX_BODY_BYTES = 128 * 1024
/** What uploadFile writes: projects/<pid>/<entity>/<id>/<ts>-<name>, or deeper. */
export const READ_URLS_MIN_SEGMENTS = 5

// The expiries, by what the URL is for (§9.2). A thumbnail is read again by
// every tile that mounts, so it lives the hour rabbit-thumbnails' signed URLs
// have; a body read once (an image, a PDF, a text) only has to START, like a
// download; a body that streams (<video>, <audio>) issues range requests for
// as long as it plays, and gets the hour the Petal arm's fileUrl has.
export const THUMBNAIL_EXPIRES = 3600
export const STREAM_EXPIRES = 3600
export const READ_ONCE_EXPIRES = 300

// 🚨 THE HOUR IS FOR WHAT ACTUALLY STREAMS (review round 1, finding 2). The
// client's `stream` flag is a request, not a fact: a PDF or a still asked
// for "as a stream" would otherwise get the hour. The key names the object,
// so its extension decides. These are the client's own lists — VIDEO_EXTENSIONS
// (storage/videoThumbnails.js) and filePreview.js's AUDIO_EXTENSIONS —
// held to this set by storagePresignBoundary.test.js. A video with an
// extension outside it is read once: it plays five minutes, then re-mints.
export const STREAMABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'm2v',
  'mts', 'm2ts', 'mxf', 'r3d', 'ari', 'arri', 'braw', 'dnx', 'dnxhd', 'dnxhr',
  'mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'weba',
])

export function streams(key: string): boolean {
  const leaf = key.slice(key.lastIndexOf('/') + 1)
  const dot = leaf.lastIndexOf('.')
  return dot > 0 && STREAMABLE_EXTENSIONS.has(leaf.slice(dot + 1).toLowerCase())
}

const THUMB_SUFFIX = '.jpg'

export type Refusal = 'shape' | 'money' | 'project' | 'row'

export type OwnedRow = { project_id?: string | null; storage_path: string | null; thumbnail_url: string | null }

/** Every segment but the last: what the row read is scoped by. */
export function folderOf(key: string): string {
  return key.slice(0, key.lastIndexOf('/'))
}

type Signer = (key: string, expiresSeconds: number) => Promise<string>

export type ReadUrlsDeps<Ctx> = {
  guard: () => Promise<{ ok: true; ctx: Ctx } | { ok: false; res: unknown }>
  rateLimited: (ctx: Ctx) => Promise<boolean>
  /** can_presign_project_read as the caller; anything but true refuses. */
  canReadProject: (ctx: Ctx, projectId: string) => Promise<unknown>
  /** Live s3 files rows the CALLER can select in `projectId` whose
   *  storage_path lies under `folder` (`LIKE '<folder>/%'`), with their
   *  project_id. Throws when the read fails. */
  ownedRows: (ctx: Ctx, projectId: string, folder: string) => Promise<OwnedRow[]>
  /** The workspace's bucket, or the answer that says why there is none. */
  loadSigner: (ctx: Ctx) => Promise<
    | { ok: true; sign: Signer }
    | { ok: false; status: number; body: Record<string, unknown> }
  >
}

export type ReadUrlsOutcome =
  | { preflight: true }
  | { res: unknown }
  | { status: number; body: Record<string, unknown> }

type RequestLike = {
  method: string
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
}

const refuse = (status: number, error: string, detail?: string): ReadUrlsOutcome =>
  ({ status, body: detail ? { error, detail } : { error } })

/** The body's keys, deduplicated in the order sent, or a sentence. */
export function parseReadRequest(body: unknown):
  | { ok: true; keys: string[]; stream: boolean }
  | { ok: false; detail: string } {
  const b = (body ?? {}) as { keys?: unknown; stream?: unknown }
  const raw = b.keys
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > READ_URLS_MAX_KEYS
      || raw.some((k) => typeof k !== 'string')) {
    return { ok: false, detail: `keys must be a list of 1 to ${READ_URLS_MAX_KEYS} storage paths` }
  }
  const keys = [...new Set(raw as string[])]
  const stream = b.stream === true
  if (stream && keys.length !== 1) {
    return { ok: false, detail: 'a streaming address is signed for one file at a time' }
  }
  return { ok: true, keys, stream }
}

/**
 * Which keys the caller's own rows own, and as what. A body when a row's
 * storage_path is the key; a thumbnail when a row's storage_path + '.jpg' is
 * the key AND its thumbnail_url says so (thumbnailKeyFor's one rule). A key
 * that is both is a body — the shorter-lived of the two.
 *
 * 🚨 A row vouches only for a key in ITS OWN project (review round 1,
 * finding 1): the key's second segment, case-folded, must be the row's
 * project_id. Otherwise a writer of one project could insert a row there
 * whose storage_path names a key in another project they can only read.
 */
export function classifyOwned(keys: string[], rows: OwnedRow[]): Map<string, 'body' | 'thumbnail'> {
  const bodies = new Set<string>()
  const thumbs = new Set<string>()
  for (const r of rows) {
    if (typeof r?.storage_path !== 'string' || r.storage_path === '') continue
    const keyProject = (r.storage_path.split('/')[1] || '').toLowerCase()
    if (typeof r.project_id !== 'string' || r.project_id.toLowerCase() !== keyProject) continue
    bodies.add(r.storage_path)
    if (r.thumbnail_url === `${r.storage_path}${THUMB_SUFFIX}`) thumbs.add(r.thumbnail_url)
  }
  const out = new Map<string, 'body' | 'thumbnail'>()
  for (const k of keys) {
    if (bodies.has(k)) out.set(k, 'body')
    else if (thumbs.has(k)) out.set(k, 'thumbnail')
  }
  return out
}

export async function handleReadUrls<Ctx>(req: RequestLike, deps: ReadUrlsDeps<Ctx>): Promise<ReadUrlsOutcome> {
  if (req.method === 'OPTIONS') return { preflight: true }
  if (req.method !== 'POST') return refuse(405, 'method_not_allowed')

  const guard = await deps.guard()
  if (!guard.ok) return { res: guard.res }
  const ctx = guard.ctx

  if (await deps.rateLimited(ctx)) {
    return refuse(429, 'rate_limited', 'too many preview requests — wait a minute and retry')
  }

  // Bounded BEFORE it is parsed: a body is read whole by req.json().
  const declared = req.headers.get('content-length')
  const length = declared === null || declared.trim() === '' ? NaN : Number(declared)
  if (!Number.isFinite(length)) return refuse(411, 'length_required', 'the request must say its length')
  if (length > READ_URLS_MAX_BODY_BYTES) return refuse(413, 'too_large', 'the request is too large')

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return refuse(400, 'bad_request', 'the request body is not JSON')
  }
  const parsed = parseReadRequest(body)
  if (!parsed.ok) return refuse(400, 'bad_request', parsed.detail)
  const { keys, stream } = parsed

  const reason = new Map<string, Refusal>()
  const projectOf = new Map<string, string>()
  for (const key of keys) {
    const shape = checkRowShapedPath(key)
    if (!shape.ok) reason.set(key, shape.code)
    // What uploadFile writes is never shallower than an entity's folder: a
    // shallower key would scope the row read to a whole project.
    else if (key.split('/').length < READ_URLS_MIN_SEGMENTS) reason.set(key, 'shape')
    else projectOf.set(key, shape.projectId)
  }

  const projects = [...new Set(projectOf.values())]
  if (projects.length > READ_URLS_MAX_PROJECTS) {
    return refuse(400, 'bad_request', `at most ${READ_URLS_MAX_PROJECTS} projects per call`)
  }

  // ONCE per distinct project, as the caller. Strict: null, undefined, an
  // error and a throw all refuse.
  const readable = new Set<string>()
  await Promise.all(projects.map(async (p) => {
    try {
      if ((await deps.canReadProject(ctx, p)) === true) readable.add(p)
    } catch { /* a failed check is a refusal */ }
  }))
  const asked: string[] = []
  for (const [key, p] of projectOf) {
    if (readable.has(p)) asked.push(key)
    else reason.set(key, 'project')
  }

  // The row, as the caller, ONE READ PER FOLDER: a thumbnail sits beside its
  // body, so a key's folder holds its row either way, and the read carries
  // only ids — never a filename (review round 1, finding 4). A read that
  // fails fails the call CLOSED: nothing is signed on a guess.
  const byFolder = new Map<string, string[]>()
  for (const key of asked) {
    const f = folderOf(key)
    if (!byFolder.has(f)) byFolder.set(f, [])
    byFolder.get(f)!.push(key)
  }
  if (byFolder.size > READ_URLS_MAX_FOLDERS) {
    return refuse(400, 'bad_request', `at most ${READ_URLS_MAX_FOLDERS} folders per call`)
  }
  const kind = new Map<string, 'body' | 'thumbnail'>()
  for (const [folder, inFolder] of byFolder) {
    let rows: OwnedRow[]
    try {
      rows = await deps.ownedRows(ctx, projectOf.get(inFolder[0])!, folder)
    } catch {
      return refuse(500, 'row_read_failed', 'the files could not be checked just now — try again')
    }
    for (const [k, v] of classifyOwned(inFolder, rows)) kind.set(k, v)
  }
  for (const key of asked) if (!kind.has(key)) reason.set(key, 'row')

  const urls: Record<string, string> = {}
  const expires: Record<string, number> = {}
  const refused: Record<string, Refusal> = {}

  if (kind.size > 0) {
    const signer = await deps.loadSigner(ctx)
    if (!signer.ok) return { status: signer.status, body: signer.body }
    // In the order the keys were sent.
    for (const key of keys) {
      const k = kind.get(key)
      if (!k) continue
      const seconds = k === 'thumbnail'
        ? THUMBNAIL_EXPIRES
        : (stream && streams(key) ? STREAM_EXPIRES : READ_ONCE_EXPIRES)
      try {
        urls[key] = await signer.sign(key, seconds)
      } catch (err) {
        // The signer's own sentences name the endpoint, which an admin can act
        // on; one of them names the KEY, and a key carries a filename.
        const message = err instanceof Error ? err.message : String(err)
        return refuse(500, 'presign_failed',
          message.includes(key) ? 'a file\'s address could not be signed' : message)
      }
      expires[key] = seconds
    }
  }
  for (const key of keys) {
    const r = reason.get(key)
    if (r) refused[key] = r
  }
  return { status: 200, body: { ok: true, urls, expires, refused } }
}
