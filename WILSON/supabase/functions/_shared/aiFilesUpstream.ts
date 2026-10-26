// =============================================================================
// _shared/aiFilesUpstream.ts — FX12 (post-overhaul, 2026-10-25): the calls
// ai-files and operator-ai-files make to the AI provider's file store and to
// this environment's upload rows. The rules they apply are in aiFileStore.ts.
//
// Every call here is bounded (an AbortSignal with a timeout, combined with the
// caller's own) and reads `res.ok` before anything else. `fetch` resolves for
// every status; a list that stopped at a refusal must say so, never pass for
// a short list. Nothing here returns a filename: the store's objects go
// through `storedFileOf` (aiFileStore.ts) the moment they are parsed.
//
// The beta header is deliberately NOT sent. The Files API is generally
// available, and only without the header does the store answer `expires_at`
// and accept `ids[]` (a lookup of exactly the ids WILSON names, so a
// workspace's list never fetches another company's metadata at all). Upload
// stays on ai-files' own byte-identical branch, with its header.
// =============================================================================

import type { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import {
  MAX_LIST_PAGES, certifiedGoneIds, idLookupQueries, isFileId, listQuery, readListPage, storedFileOf,
  uploadRowOf, type ListPage, type StoredFile, type UploadRow,
} from './aiFileStore.ts'

type Client = ReturnType<typeof createClient>

export const ANTHROPIC_FILES_URL = 'https://api.anthropic.com/v1/files'
export const ANTHROPIC_VERSION = '2023-06-01'
/** One call to the store gives up after this long. */
export const UPSTREAM_TIMEOUT_MS = 20_000

/** The timeout, joined to the caller's signal by hand (AbortSignal.any is newer than some runtimes). */
function signalFor(outer?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
  if (!outer) return t
  const c = new AbortController()
  const stop = () => { if (!c.signal.aborted) c.abort(outer.aborted ? outer.reason : t.reason) }
  if (outer.aborted || t.aborted) stop()
  outer.addEventListener('abort', stop, { once: true })
  t.addEventListener('abort', stop, { once: true })
  return c.signal
}

function headers(key: string): Record<string, string> {
  return { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION }
}

export class UpstreamError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'UpstreamError'
    this.status = status
  }
}

/** The store's own error type, never its message (it can name the id or the file). */
async function upstreamError(res: Response, what: string): Promise<UpstreamError> {
  const j = await res.json().catch(() => ({})) as { error?: { type?: unknown } }
  const type = typeof j?.error?.type === 'string' ? j.error.type : 'unknown'
  return new UpstreamError(`${what}: HTTP ${res.status} (${type})`, res.status)
}

/** Exactly these ids' files, as the store has them; an id it lacks is absent. */
export async function lookupFiles(
  key: string, ids: string[], opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<StoredFile[]> {
  const f = opts.fetchImpl ?? fetch
  const out: StoredFile[] = []
  for (const q of idLookupQueries(ids)) {
    const res = await f(`${ANTHROPIC_FILES_URL}?${q}`, { headers: headers(key), signal: signalFor(opts.signal) })
    if (!res.ok) throw await upstreamError(res, 'file lookup')
    const page = readListPage(await res.json().catch(() => null))
    if (!page) throw new UpstreamError('file lookup: the answer was not a list', res.status)
    out.push(...page.files)
  }
  return out
}

/** Every file the key holds, every page, before answering. */
export async function listAllFiles(
  key: string, opts: { fetchImpl?: typeof fetch; signal?: AbortSignal; maxPages?: number } = {},
): Promise<{ files: StoredFile[]; pages: number; truncated: boolean; malformed: number }> {
  const f = opts.fetchImpl ?? fetch
  const maxPages = opts.maxPages ?? MAX_LIST_PAGES
  const files: StoredFile[] = []
  const seen = new Set<string>()
  let cursor: ListPage['next'] = null
  let pages = 0
  let malformed = 0
  for (;;) {
    if (pages >= maxPages) return { files, pages, truncated: true, malformed }
    const res = await f(`${ANTHROPIC_FILES_URL}?${listQuery(cursor)}`, { headers: headers(key), signal: signalFor(opts.signal) })
    if (!res.ok) throw await upstreamError(res, 'file list')
    const page = readListPage(await res.json().catch(() => null))
    if (!page) throw new UpstreamError('file list: the answer was not a list', res.status)
    pages++
    malformed += page.malformed
    for (const file of page.files) {
      if (seen.has(file.id)) continue // a file that moved between pages is counted once
      seen.add(file.id)
      files.push(file)
    }
    if (!page.next) return { files, pages, truncated: false, malformed }
    cursor = page.next
  }
}

/** One file's metadata; null when the store has no such file (404). */
export async function fileMetadata(
  key: string, id: string, opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<StoredFile | null> {
  if (!isFileId(id)) return null
  const f = opts.fetchImpl ?? fetch
  const res = await f(`${ANTHROPIC_FILES_URL}/${encodeURIComponent(id)}`, { headers: headers(key), signal: signalFor(opts.signal) })
  if (res.status === 404) return null
  if (!res.ok) throw await upstreamError(res, 'file metadata')
  const file = storedFileOf(await res.json().catch(() => null))
  if (!file || file.id !== id) throw new UpstreamError('file metadata: the answer named another file', res.status)
  return file
}

/** Delete one file. Answers the status (the caller maps it with deleteOutcome); 0 = unreachable. */
export async function deleteFile(
  key: string, id: string, opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<number> {
  if (!isFileId(id)) return 400
  const f = opts.fetchImpl ?? fetch
  try {
    const res = await f(`${ANTHROPIC_FILES_URL}/${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: headers(key), signal: signalFor(opts.signal),
    })
    await res.body?.cancel().catch(() => {})
    return res.status
  } catch {
    return 0
  }
}

// ── This environment's upload rows ───────────────────────────────────────────
// PostgREST answers at most max_rows (1000) per read even for service_role, so
// every read pages. An error is THROWN: a read that failed must never pass for
// "no rows", which would turn every file into "no row of this environment".

const ROW_PAGE = 1000
const ROW_COLUMNS = 'workspace_id, actor_user_id, created_at, code, context'

/** Every upload row of one workspace (or of every workspace when null). */
export async function readUploadRows(admin: Client, workspaceId: string | null): Promise<UploadRow[]> {
  const out: UploadRow[] = []
  for (let from = 0; ; from += ROW_PAGE) {
    let q = admin.from('app_events').select(ROW_COLUMNS)
      .eq('code', 'WIL-6001').eq('context->>tool', 'ai-files')
    if (workspaceId) q = q.eq('workspace_id', workspaceId)
    const { data, error } = await q.order('id', { ascending: true }).range(from, from + ROW_PAGE - 1)
    if (error) throw new Error(`upload rows: ${error.message}`)
    for (const r of data ?? []) {
      const row = uploadRowOf(r)
      if (row) out.push(row)
    }
    if (!data || data.length < ROW_PAGE) return out
  }
}

/** Every upload row of this environment, in ANY workspace, naming these ids. */
export async function readUploadRowsNaming(admin: Client, ids: string[]): Promise<UploadRow[]> {
  const unique = [...new Set(ids.filter(isFileId))]
  const out: UploadRow[] = []
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100)
    for (let from = 0; ; from += ROW_PAGE) {
      const { data, error } = await admin.from('app_events').select(ROW_COLUMNS)
        .eq('code', 'WIL-6001').eq('context->>tool', 'ai-files')
        .in('context->>file_id', batch)
        .order('id', { ascending: true }).range(from, from + ROW_PAGE - 1)
      if (error) throw new Error(`upload rows: ${error.message}`)
      for (const r of data ?? []) {
        const row = uploadRowOf(r)
        if (row) out.push(row)
      }
      if (!data || data.length < ROW_PAGE) break
    }
  }
  return out
}

/**
 * The ids this workspace's own certificates say it already deleted or found
 * gone (aiFileStore.certifiedGoneIds): `admin`-stream rows, which no member
 * can insert. `ids` narrows the read; null reads them all (the list skips
 * them before asking the store, review round 1, finding 2).
 */
export async function readCertifiedGone(admin: Client, workspaceId: string, ids: string[] | null): Promise<Set<string>> {
  const raw: unknown[] = []
  const batches = ids === null ? [null] : (() => {
    const unique = [...new Set(ids.filter(isFileId))]
    const out: string[][] = []
    for (let i = 0; i < unique.length; i += 100) out.push(unique.slice(i, i + 100))
    return out
  })()
  for (const batch of batches) {
    for (let from = 0; ; from += ROW_PAGE) {
      let q = admin.from('app_events').select('workspace_id, event_type, code, context')
        .eq('workspace_id', workspaceId).eq('event_type', 'admin').eq('code', 'WIL-6001')
        .eq('context->>tool', 'ai-files').eq('context->>stage', 'delete')
      if (batch) q = q.in('context->>file_id', batch)
      const { data, error } = await q.order('id', { ascending: true }).range(from, from + ROW_PAGE - 1)
      if (error) throw new Error(`certificates: ${error.message}`)
      raw.push(...(data ?? []))
      if (!data || data.length < ROW_PAGE) break
    }
  }
  return certifiedGoneIds(raw, workspaceId)
}

/**
 * A certificate row. WIL-6001 / 6002 again (0021's code CHECK is a closed
 * set) with `tool: 'ai-files'` and ALWAYS a `stage`, which is what keeps a
 * certificate from ever reading as an upload (aiFileStore.uploadRowOf), and
 * ALWAYS in the `admin` stream, which 0021 reserves for server-stamped writes
 * (members cannot insert it), so a certificate cannot be forged (review
 * round 1, finding 4). Answers whether it landed: supabase-js reports a
 * refused insert on the error channel, and a deletion with no certificate is
 * the blindness the handbook warns of, so the caller counts the misses.
 */
export async function writeCertificate(
  admin: Client,
  fields: {
    workspaceId: string
    actorUserId: string
    ok: boolean
    /** A refusal or a note, not a failure: severity info. */
    quiet?: boolean
    message: string
    context: Record<string, unknown> & { stage: string }
  },
): Promise<boolean> {
  try {
    const { error } = await admin.from('app_events').insert({
      workspace_id: fields.workspaceId,
      actor_user_id: fields.actorUserId,
      event_type: 'admin',
      code: fields.ok ? 'WIL-6001' : 'WIL-6002',
      severity: fields.ok || fields.quiet ? 'info' : 'warning',
      message: fields.message,
      // Technical metadata only: ids, counts, outcomes. Never a filename.
      context: { tool: 'ai-files', ...fields.context },
    })
    if (error) {
      console.error(`[ai-files] certificate refused (${fields.context.stage}): ${error.message}`)
      return false
    }
    return true
  } catch (err) {
    console.error(`[ai-files] certificate threw (${fields.context.stage}): ${String((err as Error)?.message ?? err)}`)
    return false
  }
}

/** Run `fn` over `items`, `limit` at a time, in order of completion. */
export async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}
