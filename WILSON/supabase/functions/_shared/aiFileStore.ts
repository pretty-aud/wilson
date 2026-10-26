// =============================================================================
// _shared/aiFileStore.ts — FX12 (post-overhaul, 2026-10-25): the pure rules
// for what WILSON may see and delete in the AI provider's file store.
//
// D.O.G. uploads PDFs, pictures and large texts to Anthropic's Files API
// through ai-files and references them by id (S19, the 546 fix). Nothing ever
// deleted them (OUTSTANDING DG1-03). ai-files' DELETE and GET routes and
// operator-ai-files' summary and sweep let go of them; this file is every
// rule those routes apply, kept free of Deno and of the network so vitest
// pins it (src/cloud/aiFileStore.test.js, the gatewayTicket arrangement).
//
// -----------------------------------------------------------------------------
// 🚨 ONE KEY, THREE ENVIRONMENTS, EVERY WORKSPACE
// -----------------------------------------------------------------------------
// The platform key backs wilson-dev, wilson-staging and wilson-prod and every
// company on each. Its file list is the union of all of them. The ONLY line
// between "ours to delete" and "someone else's" is this environment's own
// upload rows (app_events WIL-6001, `context.tool = 'ai-files'`, the row
// ai-files writes after each upload). A sweep that trusted the file's age
// alone would delete another environment's live uploads mid-deck.
//
// -----------------------------------------------------------------------------
// 🚨 AN UPLOAD ROW IS NOT PROOF ON ITS OWN
// -----------------------------------------------------------------------------
// 0021's `app_events_insert` policy lets ANY active member insert a row into
// their own workspace with any code but WIL-41xx and any context. A member
// could therefore write `{ code: 'WIL-6001', context: { tool: 'ai-files',
// file_id: <someone else's id> } }` and, if a row's word were enough, list or
// delete another company's (or another environment's) file. So a row counts
// only when it BINDS to the stored file (`bindsToFile`): the size and type it
// recorded from the upload's own answer equal the store's, and the row was
// written within minutes of the file's creation. Size and type of another
// company's file never leave that company (its rows are read by its own
// admins only), and the trigger stamps `created_at` on every member insert,
// so a forger cannot backdate. And a file that rows of two workspaces name is
// CONTESTED and is never any workspace's to delete.
//
// -----------------------------------------------------------------------------
// 🚨 A FILENAME IS CONTENT
// -----------------------------------------------------------------------------
// The store keeps each file's name (a client's pre-release material, TPN).
// Nothing here returns it: `publicFile` is the only shape any route answers
// with, and it has no name. Ids, sizes and times only.
// =============================================================================

/** Files older than this are the sweep's; a deck's continuation loop is minutes. */
export const SWEEP_AGE_HOURS = 24

/**
 * How long after the store's own creation time an upload row may be written
 * and still bind. The row is written after the upload's answer arrives; the
 * store may stamp the file when the upload starts, and a large upload on a
 * slow line takes minutes. Generous on purpose: a forger still needs the
 * file's exact size and type, which never leave its company.
 */
export const BIND_AFTER_MS = 60 * 60 * 1000
/** Clock skew allowed the other way (the row before the file). */
export const BIND_BEFORE_MS = 5 * 60 * 1000

/** The store answers at most 100 ids per lookup (`ids[]`). */
export const IDS_PER_LOOKUP = 100
/** The store's own maximum page size for a full list. */
export const LIST_PAGE_LIMIT = 1000
/** A full list stops here and says so (1,000,000 files). */
export const MAX_LIST_PAGES = 1000
/**
 * Deletions per sweep run. File calls share one org-wide limit (~500 a
 * minute) with every company's uploads in every environment, so a sweep runs
 * in a small, bounded burst and the rest waits for the next click (said by
 * `truncated`), as storage-gc's MAX_OBJECTS does.
 */
export const SWEEP_MAX_DELETES = 150

/** Anthropic's ids: `file_` and an opaque base62 tail. */
const FILE_ID_RE = /^file_[A-Za-z0-9]{8,96}$/

export function isFileId(s: unknown): s is string {
  return typeof s === 'string' && FILE_ID_RE.test(s)
}

export type KeySource = 'platform' | 'workspace'

/** One upload row, as ai-files' logUpload writes it. */
export type UploadRow = {
  fileId: string
  workspaceId: string
  actorUserId: string | null
  createdAt: string
  sizeBytes: number | null
  mimeType: string | null
  keySource: KeySource
}

/** One stored file, as the store lists it (the name is never kept here). */
export type StoredFile = {
  id: string
  created_at: string
  size_bytes: number
  mime_type: string | null
  expires_at: string | null
}

/**
 * An app_events row → an upload row, or null when it is not one.
 *
 * Only the UPLOAD's own shape counts: code WIL-6001, `tool: 'ai-files'`, a
 * file id, and NO `stage` (every other row this function family writes — the
 * upload's failures, every delete certificate, every sweep — carries a
 * `stage`, so a delete certificate naming an id can never attribute it).
 * A missing `key_source` is read as the platform key (the only one before
 * S12's tenant keys); any other value refuses the row.
 */
export function uploadRowOf(row: unknown): UploadRow | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  if (r.code !== 'WIL-6001') return null
  const ctx = r.context
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) return null
  const c = ctx as Record<string, unknown>
  if (c.tool !== 'ai-files') return null
  if ('stage' in c) return null
  if (!isFileId(c.file_id)) return null
  if (typeof r.workspace_id !== 'string' || !r.workspace_id) return null
  if (typeof r.created_at !== 'string' || !Number.isFinite(Date.parse(r.created_at))) return null
  const ks = c.key_source ?? 'platform'
  if (ks !== 'platform' && ks !== 'workspace') return null
  const size = typeof c.size_bytes === 'number' && Number.isFinite(c.size_bytes) ? c.size_bytes : null
  return {
    fileId: c.file_id,
    workspaceId: r.workspace_id,
    actorUserId: typeof r.actor_user_id === 'string' ? r.actor_user_id : null,
    createdAt: r.created_at,
    sizeBytes: size,
    mimeType: typeof c.mime_type === 'string' ? c.mime_type : null,
    keySource: ks,
  }
}

/**
 * One file object from the store → the fields WILSON keeps. The filename is
 * dropped HERE, at the first touch, so nothing downstream can carry it.
 */
export function storedFileOf(obj: unknown): StoredFile | null {
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  if (!isFileId(o.id)) return null
  if (typeof o.created_at !== 'string' || !Number.isFinite(Date.parse(o.created_at))) return null
  const size = typeof o.size_bytes === 'number' && Number.isFinite(o.size_bytes) && o.size_bytes >= 0 ? o.size_bytes : 0
  return {
    id: o.id,
    created_at: o.created_at,
    size_bytes: size,
    mime_type: typeof o.mime_type === 'string' ? o.mime_type : null,
    expires_at: typeof o.expires_at === 'string' ? o.expires_at : null,
  }
}

/**
 * Does this upload row truly describe this stored file? Size and type equal
 * (both recorded from the upload's own answer, so a genuine row always
 * matches), and the row written between BIND_BEFORE_MS before and
 * BIND_AFTER_MS after the store created the file. Anything missing refuses:
 * a row that cannot be checked is not believed.
 */
export function bindsToFile(row: UploadRow, file: StoredFile): boolean {
  if (row.fileId !== file.id) return false
  if (row.sizeBytes === null || row.sizeBytes !== file.size_bytes) return false
  if (!row.mimeType || !file.mime_type || row.mimeType !== file.mime_type) return false
  const rowAt = Date.parse(row.createdAt)
  const fileAt = Date.parse(file.created_at)
  if (!Number.isFinite(rowAt) || !Number.isFinite(fileAt)) return false
  return rowAt >= fileAt - BIND_BEFORE_MS && rowAt <= fileAt + BIND_AFTER_MS
}

export type Attribution =
  | { file: StoredFile; kind: 'attributed'; owner: UploadRow }
  | { file: StoredFile; kind: 'no_row' }      // no row of this environment names it
  | { file: StoredFile; kind: 'unbound' }     // rows name it; none binds
  | { file: StoredFile; kind: 'contested' }   // rows of two workspaces bind

/**
 * Who, in this environment, owns each stored file.
 *
 * `rows` must be EVERY upload row of this environment that names any of
 * these files, across ALL workspaces — never one workspace's alone, or a
 * forged row in that workspace could not be told from a contested file.
 * Two binding rows in ONE workspace (the same file reported twice) still
 * attribute it, to the earliest row.
 */
export function attribute(files: StoredFile[], rows: UploadRow[]): Attribution[] {
  const byId = new Map<string, UploadRow[]>()
  for (const r of rows) {
    const list = byId.get(r.fileId)
    if (list) list.push(r); else byId.set(r.fileId, [r])
  }
  return files.map((file): Attribution => {
    const named = byId.get(file.id) ?? []
    if (!named.length) return { file, kind: 'no_row' }
    const binding = named.filter(r => bindsToFile(r, file))
    if (!binding.length) return { file, kind: 'unbound' }
    const workspaces = new Set(binding.map(r => r.workspaceId))
    if (workspaces.size > 1) return { file, kind: 'contested' }
    const owner = [...binding].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0]
    return { file, kind: 'attributed', owner }
  })
}

/** Older than the sweep's age, by the STORE's clock (the file's own time). */
export function isSweepable(file: StoredFile, nowMs: number, ageHours = SWEEP_AGE_HOURS): boolean {
  const at = Date.parse(file.created_at)
  return Number.isFinite(at) && nowMs - at > ageHours * 60 * 60 * 1000
}

/** Past its `expires_at`: its content is gone; the store keeps its name up to 30 days. */
export function isExpired(file: StoredFile, nowMs: number): boolean {
  if (!file.expires_at) return false
  const at = Date.parse(file.expires_at)
  return Number.isFinite(at) && at <= nowMs
}

/**
 * The one shape a route may answer for a file: no name, no type. `expires_at`
 * is the store's own clock for an upload that asked to expire (null when it
 * did not: every upload before FX12).
 */
export function publicFile(file: StoredFile, nowMs: number) {
  return {
    id: file.id,
    created_at: file.created_at,
    size_bytes: file.size_bytes,
    expires_at: file.expires_at,
    expired: isExpired(file, nowMs),
  }
}

export type Totals = { count: number; total_bytes: number; oldest: string | null }

export function totalsOf(files: StoredFile[]): Totals {
  let total = 0
  let oldest: string | null = null
  for (const f of files) {
    total += f.size_bytes
    if (oldest === null || Date.parse(f.created_at) < Date.parse(oldest)) oldest = f.created_at
  }
  return { count: files.length, total_bytes: total, oldest }
}

/**
 * The files ONE workspace may see or sweep: attributed to it, and, for a
 * member who is not the workspace's admin, uploaded by that member.
 */
export function filesOfWorkspace(
  attributions: Attribution[],
  workspaceId: string,
  onlyActor: string | null = null,
): { file: StoredFile; owner: UploadRow }[] {
  const out: { file: StoredFile; owner: UploadRow }[] = []
  for (const a of attributions) {
    if (a.kind !== 'attributed') continue
    if (a.owner.workspaceId !== workspaceId) continue
    if (onlyActor !== null && a.owner.actorUserId !== onlyActor) continue
    out.push({ file: a.file, owner: a.owner })
  }
  return out
}

/** The sweep's choice: the oldest first, at most SWEEP_MAX_DELETES. */
export function sweepPlan<T extends { file: StoredFile }>(
  candidates: T[],
  nowMs: number,
  ageHours = SWEEP_AGE_HOURS,
  max = SWEEP_MAX_DELETES,
): { take: T[]; recent: number; truncated: boolean } {
  const due = candidates
    .filter(c => isSweepable(c.file, nowMs, ageHours))
    .sort((a, b) => Date.parse(a.file.created_at) - Date.parse(b.file.created_at))
  return {
    take: due.slice(0, max),
    recent: candidates.length - due.length,
    truncated: due.length > max,
  }
}

/** The operator's counts: never an id, never a workspace's name, never a filename. */
export function operatorCounts(attributions: Attribution[], nowMs: number, ageHours = SWEEP_AGE_HOURS) {
  const all = attributions.map(a => a.file)
  const of = (kind: Attribution['kind']) => attributions.filter(a => a.kind === kind).map(a => a.file)
  const attributed = attributions.filter((a): a is Extract<Attribution, { kind: 'attributed' }> => a.kind === 'attributed')
  return {
    all: totalsOf(all),
    attributed: {
      ...totalsOf(attributed.map(a => a.file)),
      workspaces: new Set(attributed.map(a => a.owner.workspaceId)).size,
      sweepable: attributed.filter(a => isSweepable(a.file, nowMs, ageHours)).length,
    },
    no_row: totalsOf(of('no_row')),
    unbound: totalsOf(of('unbound')),
    contested: totalsOf(of('contested')),
    expired: all.filter(f => isExpired(f, nowMs)).length,
  }
}

// ── The store's pages ────────────────────────────────────────────────────────
//
// The store answers a list in one of two shapes. Without the beta header (the
// Files API is generally available now, and these routes send none): `{ data,
// next_page }`, the cursor passed back as `page`. With `files-api-2025-04-14`:
// `{ data, has_more, last_id }`, the cursor passed back as `after_id`. Both are
// read, so a change of shape upstream ends a list honestly instead of after
// its first page.

export type ListPage = { files: StoredFile[]; next: { page: string } | { after_id: string } | null; malformed: number }

export function readListPage(json: unknown): ListPage | null {
  if (!json || typeof json !== 'object') return null
  const j = json as Record<string, unknown>
  if (!Array.isArray(j.data)) return null
  const files: StoredFile[] = []
  let malformed = 0
  for (const obj of j.data) {
    const f = storedFileOf(obj)
    if (f) files.push(f); else malformed++
  }
  let next: ListPage['next'] = null
  if (typeof j.next_page === 'string' && j.next_page) next = { page: j.next_page }
  else if (j.has_more === true && typeof j.last_id === 'string' && j.last_id) next = { after_id: j.last_id }
  return { files, next, malformed }
}

/** The query string of one list page. */
export function listQuery(cursor: ListPage['next']): string {
  const q = new URLSearchParams({ limit: String(LIST_PAGE_LIMIT) })
  if (cursor && 'page' in cursor) q.set('page', cursor.page)
  if (cursor && 'after_id' in cursor) q.set('after_id', cursor.after_id)
  return q.toString()
}

/** The query strings that look up exactly these ids, IDS_PER_LOOKUP at a time. */
export function idLookupQueries(ids: string[]): string[] {
  const unique = [...new Set(ids.filter(isFileId))]
  const out: string[] = []
  for (let i = 0; i < unique.length; i += IDS_PER_LOOKUP) {
    const q = new URLSearchParams()
    for (const id of unique.slice(i, i + IDS_PER_LOOKUP)) q.append('ids[]', id)
    out.push(q.toString())
  }
  return out
}

/** The largest body the delete route reads: `{ "file_id": "file_…" }` is ~60 bytes. */
export const SMALL_BODY_MAX = 2048

/**
 * Read a tiny JSON object body, refusing (null) past SMALL_BODY_MAX bytes.
 *
 * ai-files' one invariant is about the UPLOAD: its multipart stream is never
 * materialised. The delete route's body is a few dozen bytes of JSON, so
 * reading it does not touch that invariant — but a member could still send a
 * large body to a JSON route, so it is read in chunks and abandoned at the
 * cap rather than handed to `req.json()` whole. A declared length past the
 * cap is refused before a byte is read.
 */
export async function readSmallJson(req: Request, max = SMALL_BODY_MAX): Promise<Record<string, unknown> | null> {
  const declared = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > max) return null
  if (!req.body) return null
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const c of chunks) { bytes.set(c, at); at += c.byteLength }
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes))
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
  } catch {
    return null
  }
}

/** A delete's answer → its certificate's outcome. 404 is gone (counted as such). */
export function deleteOutcome(status: number): 'deleted' | 'gone' | 'failed' {
  if (status >= 200 && status < 300) return 'deleted'
  if (status === 404) return 'gone'
  return 'failed'
}
