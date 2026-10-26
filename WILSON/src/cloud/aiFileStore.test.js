// =============================================================================
// aiFileStore.test.js — FX12 (post-overhaul, 2026-10-25, OUTSTANDING DG1-03).
//
// Pins supabase/functions/_shared/aiFileStore.ts (the rules) and
// aiFilesUpstream.ts (the calls, against a fake store) across the Deno/Node
// line, the gatewayTicket.test.js arrangement: the Edge-side files are
// imported directly; they are runtime-agnostic on purpose.
//
// Every rule that keeps one company's files from another's has a FAILING
// CONTROL beside it: the same input with the one property that makes it
// someone else's, asserted to be refused. A rule that only ever saw the happy
// case passes whether it checks anything or not.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  SWEEP_AGE_HOURS, BIND_AFTER_MS, BIND_BEFORE_MS, IDS_PER_LOOKUP, SWEEP_MAX_DELETES, SMALL_BODY_MAX,
  isFileId, uploadRowOf, storedFileOf, bindsToFile, attribute, isSweepable, isExpired, publicFile,
  totalsOf, filesOfWorkspace, sweepPlan, operatorCounts, readListPage, listQuery, idLookupQueries,
  deleteOutcome, readSmallJson, deleteVerdict, certifiedGoneIds,
} from '../../supabase/functions/_shared/aiFileStore.ts'
import {
  lookupFiles, listAllFiles, fileMetadata, deleteFile, readUploadRows, readUploadRowsNaming,
  writeCertificate, readCertifiedGone, pooled, UpstreamError,
} from '../../supabase/functions/_shared/aiFilesUpstream.ts'

const REPO = join(__dirname, '..', '..')
const W1 = '11111111-1111-4111-8111-111111111111'
const W2 = '22222222-2222-4222-8222-222222222222'
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const NOW = Date.parse('2026-10-25T12:00:00Z')
const H = 60 * 60 * 1000
const iso = (ms) => new Date(ms).toISOString()

// Ids shaped like the store's; the names in fixtures are deliberately not
// anything a real client file could be called.
const id = (n) => `file_011Test${String(n).padStart(12, '0')}`

function file(n, { at = NOW - 30 * H, size = 1000 + n, mime = 'application/pdf', expires = null, filename = 'fixture.pdf' } = {}) {
  return { id: id(n), type: 'file', filename, mime_type: mime, size_bytes: size, created_at: iso(at), downloadable: false, expires_at: expires }
}
function row(n, { ws = W1, actor = U1, at, size, mime = 'application/pdf', key = 'platform', extra = {} } = {}) {
  const f = file(n)
  return {
    code: 'WIL-6001', workspace_id: ws, actor_user_id: actor,
    created_at: at ?? iso(Date.parse(f.created_at) + 2000),
    context: { tool: 'ai-files', key_source: key, file_id: id(n), size_bytes: size ?? f.size_bytes, mime_type: mime, ...extra },
  }
}
const stored = (n, o) => storedFileOf(file(n, o))
const upload = (n, o) => uploadRowOf(row(n, o))

describe('isFileId', () => {
  it('takes the store\'s ids and refuses anything that could reach another path', () => {
    expect(isFileId('file_011CNha8iCJcU1wXNR6q4V8w')).toBe(true)
    for (const bad of ['', 'file_', 'file_../x', 'file_abc/def', 'FILE_011CNha8iCJcU', 'file_011CNha8 iCJ', null, 42, ['file_011CNha8iCJcU1wXNR6q4V8w']]) {
      expect(isFileId(bad)).toBe(false)
    }
  })
})

describe('uploadRowOf: only the upload\'s own row counts', () => {
  it('reads ai-files\' upload row', () => {
    expect(upload(1)).toMatchObject({ fileId: id(1), workspaceId: W1, actorUserId: U1, sizeBytes: 1001, mimeType: 'application/pdf', keySource: 'platform' })
  })
  it('a missing key_source is the platform key; an unknown one refuses the row', () => {
    const r = row(1); delete r.context.key_source
    expect(uploadRowOf(r).keySource).toBe('platform')
    expect(uploadRowOf(row(1, { key: 'workspace' })).keySource).toBe('workspace')
    expect(uploadRowOf(row(1, { key: 'someone-else' }))).toBe(null)
  })
  it('CONTROL: a row with a stage (a certificate, a failure) never reads as an upload', () => {
    for (const stage of ['delete', 'delete_refused', 'sweep', 'upstream_error']) {
      expect(uploadRowOf(row(1, { extra: { stage } }))).toBe(null)
    }
  })
  it('CONTROL: another tool\'s row, a failure code, a bad id or no workspace refuses', () => {
    expect(uploadRowOf({ ...row(1), code: 'WIL-6002' })).toBe(null)
    expect(uploadRowOf({ ...row(1), context: { ...row(1).context, tool: 'ai-proxy' } })).toBe(null)
    expect(uploadRowOf({ ...row(1), context: { ...row(1).context, file_id: 'file_../../x' } })).toBe(null)
    expect(uploadRowOf({ ...row(1), workspace_id: null })).toBe(null)
    expect(uploadRowOf({ ...row(1), context: [] })).toBe(null)
    expect(uploadRowOf(null)).toBe(null)
  })
})

describe('storedFileOf / publicFile: the filename never leaves the first touch', () => {
  it('keeps the id, time, size, type and expiry, and drops the name', () => {
    const f = stored(1, { filename: 'NOT-TO-BE-SEEN.pdf' })
    expect(f).toEqual({ id: id(1), created_at: iso(NOW - 30 * H), size_bytes: 1001, mime_type: 'application/pdf', expires_at: null })
    expect(JSON.stringify(f)).not.toContain('NOT-TO-BE-SEEN')
  })
  it('publicFile answers id, time, size and expiry, and nothing else', () => {
    const f = stored(1, { expires: iso(NOW - H) })
    expect(Object.keys(publicFile(f, NOW)).sort()).toEqual(['created_at', 'expired', 'expires_at', 'id', 'size_bytes'])
    expect(publicFile(f, NOW).expired).toBe(true)
    expect(publicFile(stored(2, { expires: iso(NOW + H) }), NOW).expired).toBe(false)
    expect(isExpired(stored(3), NOW)).toBe(false)
  })
  it('round 1, note b: a file the store answers without a size is refused, not given size 0 (a forged size_bytes: 0 would bind to it)', () => {
    const { size_bytes, ...noSize } = file(1)
    expect(storedFileOf(noSize)).toBe(null)
    expect(storedFileOf({ ...file(1), size_bytes: 'big' })).toBe(null)
    // CONTROL: a real size of 0 (an empty file) is a size.
    expect(storedFileOf({ ...file(1), size_bytes: 0 }).size_bytes).toBe(0)
    expect(size_bytes).toBe(1001)
  })
  it('refuses an object with no real id or time', () => {
    expect(storedFileOf({ ...file(1), id: '../x' })).toBe(null)
    expect(storedFileOf({ ...file(1), created_at: 'yesterday' })).toBe(null)
  })
})

describe('bindsToFile: a row is believed only when it truly describes the stored file', () => {
  it('a genuine row binds', () => {
    expect(bindsToFile(upload(1), stored(1))).toBe(true)
  })
  it('CONTROL: a forged row that guesses the size wrong does not bind', () => {
    expect(bindsToFile(upload(1, { size: 1002 }), stored(1))).toBe(false)
  })
  it('CONTROL: the wrong type, or no size or type recorded, does not bind', () => {
    expect(bindsToFile(upload(1, { mime: 'image/png' }), stored(1))).toBe(false)
    const r = row(1); delete r.context.size_bytes
    expect(bindsToFile(uploadRowOf(r), stored(1))).toBe(false)
    const m = row(1); delete m.context.mime_type
    expect(bindsToFile(uploadRowOf(m), stored(1))).toBe(false)
  })
  it('CONTROL: a row written long after the file (a forger who learned the id later) does not bind', () => {
    const fileAt = Date.parse(stored(1).created_at)
    expect(bindsToFile(upload(1, { at: iso(fileAt + BIND_AFTER_MS) }), stored(1))).toBe(true)
    expect(bindsToFile(upload(1, { at: iso(fileAt + BIND_AFTER_MS + 1) }), stored(1))).toBe(false)
    expect(bindsToFile(upload(1, { at: iso(fileAt - BIND_BEFORE_MS) }), stored(1))).toBe(true)
    expect(bindsToFile(upload(1, { at: iso(fileAt - BIND_BEFORE_MS - 1) }), stored(1))).toBe(false)
  })
  it('round 1, finding 3: the window is minutes, not an hour (measured: the genuine row lands 229 ms after)', () => {
    const fileAt = Date.parse(stored(1).created_at)
    expect(BIND_AFTER_MS).toBeLessThanOrEqual(5 * 60 * 1000)
    expect(bindsToFile(upload(1, { at: iso(fileAt + 30000) }), stored(1))).toBe(true)
    // CONTROL: ten minutes after (a person reading Logs and forging) does not.
    expect(bindsToFile(upload(1, { at: iso(fileAt + 10 * 60 * 1000) }), stored(1))).toBe(false)
  })
  it('CONTROL: a row naming another file never binds', () => {
    expect(bindsToFile(upload(1), stored(2))).toBe(false)
  })
})

describe('attribute: whose each stored file is', () => {
  it('no row of this environment: left alone (another environment\'s)', () => {
    expect(attribute([stored(1)], [])[0].kind).toBe('no_row')
  })
  it('a forged row in another workspace does not take a genuine file', () => {
    const [a] = attribute([stored(1)], [upload(1), upload(1, { ws: W2, actor: U2, size: 5 })])
    expect(a.kind).toBe('attributed')
    expect(a.owner.workspaceId).toBe(W1)
  })
  it('CONTROL: only a forged row: unbound, nobody\'s', () => {
    expect(attribute([stored(1)], [upload(1, { ws: W2, size: 5 })])[0].kind).toBe('unbound')
  })
  it('two workspaces\' binding rows: the EARLIEST wins (a forger learns the id from the genuine row, so is later)', () => {
    const fileAt = Date.parse(stored(1).created_at)
    const [a] = attribute([stored(1)], [upload(1, { ws: W2, actor: U2, at: iso(fileAt + 60000) }), upload(1, { at: iso(fileAt + 200) })])
    expect(a.kind).toBe('attributed')
    expect(a.owner.workspaceId).toBe(W1)
  })
  it('CONTROL (round 1, finding 6): no file is "nobody\'s" because two rows bind; there is no contested kind', () => {
    const kinds = attribute([stored(1), stored(2), stored(3)], [upload(1), upload(1, { ws: W2, actor: U2 }), upload(3, { size: 1 })]).map(a => a.kind)
    expect(kinds).toEqual(['attributed', 'no_row', 'unbound'])
  })
  it('two binding rows in one workspace attribute to the earliest', () => {
    const fileAt = Date.parse(stored(1).created_at)
    const [a] = attribute([stored(1)], [upload(1, { actor: U2, at: iso(fileAt + 9000) }), upload(1, { at: iso(fileAt + 1000) })])
    expect(a.kind).toBe('attributed')
    expect(a.owner.actorUserId).toBe(U1)
  })
})

describe('filesOfWorkspace: what one workspace (or one member) may see', () => {
  const atts = attribute([stored(1), stored(2), stored(3)], [upload(1), upload(2, { actor: U2 }), upload(3, { ws: W2, actor: U2 })])
  it('the admin sees the workspace\'s, the member their own', () => {
    expect(filesOfWorkspace(atts, W1).map(f => f.file.id)).toEqual([id(1), id(2)])
    expect(filesOfWorkspace(atts, W1, U1).map(f => f.file.id)).toEqual([id(1)])
  })
  it('CONTROL: another workspace\'s file is never in the list, whoever asks', () => {
    expect(filesOfWorkspace(atts, W1).map(f => f.file.id)).not.toContain(id(3))
    expect(filesOfWorkspace(atts, W2).map(f => f.file.id)).toEqual([id(3)])
  })
})

describe('deleteVerdict: what a member\'s DELETE does with one id (round 1, finding 1)', () => {
  const ctx = (over = {}) => ({
    rows: [upload(1)], stored: new Map([[id(1), stored(1)]]), certified: new Set(), workspaceId: W1, callerId: U1, ...over,
  })
  it('the caller\'s own upload, stored and bound: delete', () => {
    expect(deleteVerdict(id(1), ctx())).toBe('delete')
  })
  it('a forged row naming an id the store lacks: not_found, never gone (no oracle, no false certificate)', () => {
    expect(deleteVerdict(id(9), ctx({ rows: [upload(9)], stored: new Map() }))).toBe('not_found')
  })
  it('CONTROL: the same absent id that this workspace\'s own certificate deleted before: gone', () => {
    expect(deleteVerdict(id(9), ctx({ rows: [upload(9)], stored: new Map(), certified: new Set([id(9)]) }))).toBe('gone')
  })
  it('a stored file the caller\'s row does not bind to (a guessed size): not_found', () => {
    expect(deleteVerdict(id(1), ctx({ rows: [upload(1, { size: 5 })] }))).toBe('not_found')
  })
  it('another company\'s EARLIER binding row: not_found for the later one, even with a binding forge', () => {
    const fileAt = Date.parse(stored(1).created_at)
    const rows = [upload(1, { ws: W2, actor: U2, at: iso(fileAt + 100) }), upload(1, { at: iso(fileAt + 30000) })]
    expect(deleteVerdict(id(1), ctx({ rows }))).toBe('not_found')
    // CONTROL: the owner itself.
    expect(deleteVerdict(id(1), ctx({ rows, workspaceId: W2, callerId: U2 }))).toBe('delete')
  })
  it('a colleague\'s upload, or the caller\'s own row in another company: not_found', () => {
    expect(deleteVerdict(id(1), ctx({ rows: [upload(1, { actor: U2 })] }))).toBe('not_found')
    expect(deleteVerdict(id(1), ctx({ rows: [upload(1, { ws: W2 })] }))).toBe('not_found')
  })
  it('a colleague\'s id the workspace already deleted: not_found to anyone but its uploader', () => {
    const gone = { rows: [upload(9, { actor: U2 })], stored: new Map(), certified: new Set([id(9)]) }
    expect(deleteVerdict(id(9), ctx(gone))).toBe('not_found')
    // CONTROL: the uploader hears it is gone.
    expect(deleteVerdict(id(9), ctx({ ...gone, callerId: U2 }))).toBe('gone')
  })
})

describe('certifiedGoneIds: only the function\'s own certificates count (round 1, findings 1 and 4)', () => {
  const cert = (n, over = {}, ctxOver = {}) => ({
    workspace_id: W1, event_type: 'admin', code: 'WIL-6001',
    context: { tool: 'ai-files', stage: 'delete', file_id: id(n), outcome: 'deleted', ...ctxOver }, ...over,
  })
  it('a deleted or gone certificate of this workspace, in the admin stream', () => {
    expect([...certifiedGoneIds([cert(1), cert(2, {}, { outcome: 'gone' })], W1)].sort()).toEqual([id(1), id(2)])
  })
  it('CONTROL: a member-written ("system") row of the same shape is a forgery and counts for nothing', () => {
    expect(certifiedGoneIds([cert(1, { event_type: 'system' })], W1).size).toBe(0)
  })
  it('CONTROL: another workspace\'s, a failure, a refusal or another stage counts for nothing', () => {
    const rows = [cert(1, { workspace_id: W2 }), cert(2, { code: 'WIL-6002' }, { outcome: 'failed' }), cert(3, {}, { stage: 'delete_refused' }), cert(4, {}, { outcome: 'not_found' }), cert(5, {}, { tool: 'ai-proxy' })]
    expect(certifiedGoneIds(rows, W1).size).toBe(0)
  })
})

describe('the sweep\'s choice', () => {
  it(`takes files older than ${SWEEP_AGE_HOURS} hours, oldest first`, () => {
    const c = [stored(1, { at: NOW - 30 * H }), stored(2, { at: NOW - 50 * H }), stored(3, { at: NOW - 2 * H })].map(file => ({ file }))
    const plan = sweepPlan(c, NOW)
    expect(plan.take.map(x => x.file.id)).toEqual([id(2), id(1)])
    expect(plan.recent).toBe(1)
    expect(plan.truncated).toBe(false)
  })
  it('CONTROL: a file one minute younger than the age stays (an in-flight deck\'s)', () => {
    expect(isSweepable(stored(1, { at: NOW - SWEEP_AGE_HOURS * H + 60000 }), NOW)).toBe(false)
    expect(isSweepable(stored(1, { at: NOW - SWEEP_AGE_HOURS * H - 60000 }), NOW)).toBe(true)
  })
  it(`stops at ${SWEEP_MAX_DELETES} a run and says so`, () => {
    const c = Array.from({ length: SWEEP_MAX_DELETES + 3 }, (_, i) => ({ file: stored(i, { at: NOW - (100 + i) * H }) }))
    const plan = sweepPlan(c, NOW)
    expect(plan.take).toHaveLength(SWEEP_MAX_DELETES)
    expect(plan.truncated).toBe(true)
    expect(plan.take[0].file.id).toBe(id(SWEEP_MAX_DELETES + 2))
  })
})

describe('operatorCounts: counts, never ids or names', () => {
  it('splits the store into attributed, no row, unbound and contested', () => {
    const files = [stored(1), stored(2), stored(3), stored(4), stored(5, { at: NOW - H, expires: iso(NOW - 1) })]
    // File 5's row is written two seconds after ITS upload (an hour ago);
    // file 4's second row (another company's) a minute after the first.
    const f4 = Date.parse(stored(4).created_at)
    const rows = [upload(1), upload(5, { ws: W2, at: iso(NOW - H + 2000) }), upload(3, { size: 1 }), upload(4), upload(4, { ws: W2, at: iso(f4 + 62000) })]
    const c = operatorCounts(attribute(files, rows), NOW)
    expect(c.all.count).toBe(5)
    expect(c.attributed).toMatchObject({ count: 3, workspaces: 2, sweepable: 2 })
    expect(c.no_row.count).toBe(1)
    expect(c.unbound.count).toBe(1)
    expect(c).not.toHaveProperty('contested')
    expect(c.expired).toBe(1)
    const text = JSON.stringify(c)
    expect(text).not.toMatch(/file_/)
    expect(text).not.toContain(W1)
    expect(text).not.toContain('fixture')
  })
  it('totals: count, bytes, oldest', () => {
    expect(totalsOf([stored(1, { at: NOW - 5 * H }), stored(2, { at: NOW - 9 * H })])).toEqual({ count: 2, total_bytes: 2003, oldest: iso(NOW - 9 * H) })
    expect(totalsOf([])).toEqual({ count: 0, total_bytes: 0, oldest: null })
  })
})

describe('the store\'s pages', () => {
  it('reads the generally-available shape (next_page) and the beta shape (has_more, last_id)', () => {
    expect(readListPage({ data: [file(1)], next_page: 'cursor-2' }).next).toEqual({ page: 'cursor-2' })
    expect(readListPage({ data: [file(1)], next_page: null }).next).toBe(null)
    expect(readListPage({ data: [file(1)], has_more: true, last_id: id(1) }).next).toEqual({ after_id: id(1) })
    expect(readListPage({ data: [file(1)], has_more: false, last_id: id(1) }).next).toBe(null)
    expect(readListPage({ nope: true })).toBe(null)
  })
  it('counts a malformed entry rather than passing it on, and keeps no name', () => {
    const p = readListPage({ data: [file(1), { id: 'bogus' }], next_page: null })
    expect(p.files).toHaveLength(1)
    expect(p.malformed).toBe(1)
    expect(JSON.stringify(p)).not.toContain('fixture.pdf')
  })
  it('a page query carries the cursor; an id lookup is 100 ids at most, unique and well-formed', () => {
    expect(listQuery(null)).toBe('limit=1000')
    expect(listQuery({ page: 'c2' })).toBe('limit=1000&page=c2')
    expect(listQuery({ after_id: id(9) })).toBe(`limit=1000&after_id=${id(9)}`)
    const ids = [...Array.from({ length: 250 }, (_, i) => id(i)), id(3), 'not-an-id']
    const qs = idLookupQueries(ids)
    expect(qs).toHaveLength(3)
    expect(qs.map(q => new URLSearchParams(q).getAll('ids[]').length)).toEqual([IDS_PER_LOOKUP, IDS_PER_LOOKUP, 50])
    expect(qs.join('&')).not.toContain('not-an-id')
  })
  it('a delete\'s status is its outcome; 404 is gone', () => {
    expect([200, 204, 404, 400, 429, 500, 0].map(deleteOutcome)).toEqual(['deleted', 'deleted', 'gone', 'failed', 'failed', 'failed', 'failed'])
  })
})

describe('readSmallJson: the delete route never reads a large body', () => {
  const req = (body, headers = {}) => new Request('https://x.test/', { method: 'DELETE', body, headers, duplex: 'half' })
  it('reads a small object', async () => {
    expect(await readSmallJson(req(JSON.stringify({ file_id: id(1) })))).toEqual({ file_id: id(1) })
  })
  it('CONTROL: a declared length past the cap is refused unread', async () => {
    expect(await readSmallJson(req('{}', { 'content-length': String(SMALL_BODY_MAX + 1) }))).toBe(null)
  })
  it('CONTROL: a streamed body past the cap is abandoned', async () => {
    const big = JSON.stringify({ file_id: id(1), pad: 'x'.repeat(SMALL_BODY_MAX) })
    let pulled = 0
    const stream = new ReadableStream({
      pull(c) { pulled++; if (pulled > 200) { c.close(); return } c.enqueue(new TextEncoder().encode(big.slice((pulled - 1) * 64, pulled * 64))) },
    })
    expect(await readSmallJson(req(stream))).toBe(null)
    expect(pulled).toBeLessThan(60)
  })
  it('an array, a string or bad JSON is no object', async () => {
    expect(await readSmallJson(req('[1]'))).toBe(null)
    expect(await readSmallJson(req('"x"'))).toBe(null)
    expect(await readSmallJson(req('{nope'))).toBe(null)
    expect(await readSmallJson(new Request('https://x.test/', { method: 'DELETE' }))).toBe(null)
  })
})

// ── The calls, against a fake store ──────────────────────────────────────────

function fakeStore(files, { failPage = null, failDelete = null } = {}) {
  const calls = []
  const store = new Map(files.map(f => [f.id, f]))
  const f = async (url, init = {}) => {
    const u = new URL(url)
    calls.push({ method: init.method || 'GET', path: u.pathname, query: u.search, headers: init.headers })
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (u.pathname === '/v1/files' && u.searchParams.getAll('ids[]').length) {
      return json({ data: u.searchParams.getAll('ids[]').map(i => store.get(i)).filter(Boolean), next_page: null })
    }
    if (u.pathname === '/v1/files') {
      const all = [...store.values()]
      const page = Number(u.searchParams.get('page') || '0')
      if (failPage === page) return json({ type: 'error', error: { type: 'api_error', message: `boom on ${id(1)}` } }, 500)
      const size = 2
      const slice = all.slice(page * size, page * size + size)
      return json({ data: slice, next_page: page * size + size < all.length ? String(page + 1) : null })
    }
    const fid = decodeURIComponent(u.pathname.split('/').pop())
    if ((init.method || 'GET') === 'DELETE') {
      if (failDelete === fid) return json({ type: 'error', error: { type: 'rate_limit_error' } }, 429)
      if (!store.has(fid)) return json({ type: 'error', error: { type: 'not_found_error' } }, 404)
      store.delete(fid)
      return json({ id: fid, type: 'file_deleted' })
    }
    return store.has(fid) ? json(store.get(fid)) : json({ type: 'error', error: { type: 'not_found_error' } }, 404)
  }
  return { f, calls, store }
}

describe('the store calls', () => {
  it('a full list follows every page before answering, and keeps no name', async () => {
    const { f, calls } = fakeStore([file(1), file(2), file(3), file(4), file(5)])
    const out = await listAllFiles('k', { fetchImpl: f })
    expect(out.files.map(x => x.id)).toEqual([id(1), id(2), id(3), id(4), id(5)])
    expect(out.pages).toBe(3)
    expect(out.truncated).toBe(false)
    expect(calls.map(c => new URLSearchParams(c.query).get('page'))).toEqual([null, '1', '2'])
    expect(JSON.stringify(out)).not.toContain('fixture')
  })
  it('CONTROL: a page that fails ends the list with an error, never a short list', async () => {
    const { f } = fakeStore([file(1), file(2), file(3)], { failPage: 1 })
    await expect(listAllFiles('k', { fetchImpl: f })).rejects.toThrow(UpstreamError)
  })
  it('the error names the store\'s type and status, never its message (which can name a file)', async () => {
    const { f } = fakeStore([file(1), file(2), file(3)], { failPage: 1 })
    const err = await listAllFiles('k', { fetchImpl: f }).catch(e => e)
    expect(err.status).toBe(500)
    expect(err.message).toContain('api_error')
    expect(err.message).not.toContain(id(1))
  })
  it('a list that would run past its page cap says truncated', async () => {
    const { f } = fakeStore([file(1), file(2), file(3), file(4), file(5)])
    const out = await listAllFiles('k', { fetchImpl: f, maxPages: 2 })
    expect(out.truncated).toBe(true)
    expect(out.files).toHaveLength(4)
  })
  it('a lookup asks for exactly the named ids, and an id the store lacks is simply absent', async () => {
    const { f, calls } = fakeStore([file(1), file(2)])
    const out = await lookupFiles('k', [id(1), id(9)], { fetchImpl: f })
    expect(out.map(x => x.id)).toEqual([id(1)])
    expect(calls).toHaveLength(1)
    expect(new URLSearchParams(calls[0].query).getAll('ids[]')).toEqual([id(1), id(9)])
  })
  it('no call sends the beta header, every call sends the key and the version', async () => {
    const { f, calls } = fakeStore([file(1)])
    await lookupFiles('k', [id(1)], { fetchImpl: f })
    await fileMetadata('k', id(1), { fetchImpl: f })
    await deleteFile('k', id(1), { fetchImpl: f })
    await listAllFiles('k', { fetchImpl: f })
    for (const c of calls) {
      expect(c.headers['anthropic-beta']).toBeUndefined()
      expect(c.headers['x-api-key']).toBe('k')
      expect(c.headers['anthropic-version']).toBe('2023-06-01')
    }
  })
  it('metadata: the file, or null for 404; delete answers the status; a bad id never reaches the store', async () => {
    const { f, calls } = fakeStore([file(1)], { failDelete: id(2) })
    expect((await fileMetadata('k', id(1), { fetchImpl: f })).id).toBe(id(1))
    expect(await fileMetadata('k', id(7), { fetchImpl: f })).toBe(null)
    expect(await deleteFile('k', id(1), { fetchImpl: f })).toBe(200)
    expect(await deleteFile('k', id(1), { fetchImpl: f })).toBe(404)
    expect(await deleteFile('k', id(2), { fetchImpl: f })).toBe(429)
    const before = calls.length
    expect(await deleteFile('k', 'file_../x', { fetchImpl: f })).toBe(400)
    expect(await fileMetadata('k', 'file_../x', { fetchImpl: f })).toBe(null)
    expect(calls.length).toBe(before)
  })
  it('an unreachable store is status 0 for a delete (failed, never gone)', async () => {
    const boom = async () => { throw new TypeError('network') }
    expect(await deleteFile('k', id(1), { fetchImpl: boom })).toBe(0)
    expect(deleteOutcome(0)).toBe('failed')
  })
  it('pooled runs every item, at most `limit` at once', async () => {
    let live = 0; let peak = 0
    const out = await pooled([1, 2, 3, 4, 5], 2, async (n) => {
      live++; peak = Math.max(peak, live)
      await new Promise(r => setTimeout(r, 5))
      live--
      return n * 2
    })
    expect(out).toEqual([2, 4, 6, 8, 10])
    expect(peak).toBe(2)
  })
})

// ── This environment's rows, against a fake client ───────────────────────────

function fakeClient(rows, { failAt = null } = {}) {
  const inserts = []
  const queries = []
  const client = {
    from(table) {
      const q = { table, filters: [], range: null, insert: null }
      const api = {
        select() { return api },
        eq(col, val) { q.filters.push(['eq', col, val]); return api },
        in(col, vals) { q.filters.push(['in', col, vals]); return api },
        order() { return api },
        range(a, b) {
          q.range = [a, b]; queries.push(q)
          if (failAt !== null && a >= failAt) return Promise.resolve({ data: null, error: { message: 'read failed' } })
          let out = rows.filter(r => q.filters.every(([op, col, val]) => {
            const v = col.startsWith('context->>') ? r.context?.[col.slice('context->>'.length)] : r[col]
            return op === 'eq' ? v === val : val.includes(v)
          }))
          return Promise.resolve({ data: out.slice(a, b + 1), error: null })
        },
        insert(row) { inserts.push(row); return Promise.resolve({ error: row.__refuse ? { message: 'refused' } : null }) },
      }
      return api
    },
  }
  return { client, inserts, queries }
}

describe('the upload rows', () => {
  it('pages past 1,000 rows (PostgREST\'s cap) and keeps only upload rows', async () => {
    const rows = [
      ...Array.from({ length: 1500 }, (_, i) => row(i)),
      row(9001, { extra: { stage: 'delete' } }),
      { ...row(9002), context: { ...row(9002).context, tool: 'ai-proxy' } },
    ]
    const { client, queries } = fakeClient(rows)
    const out = await readUploadRows(client, W1)
    expect(out).toHaveLength(1500)
    expect(queries.map(q => q.range[0])).toEqual([0, 1000])
  })
  it('CONTROL: a read that fails throws, never passes for "no rows"', async () => {
    const { client } = fakeClient(Array.from({ length: 1500 }, (_, i) => row(i)), { failAt: 1000 })
    await expect(readUploadRows(client, W1)).rejects.toThrow('upload rows')
  })
  it('naming ids reads EVERY workspace\'s rows, so a contest is seen', async () => {
    const { client } = fakeClient([row(1), row(1, { ws: W2 }), row(2)])
    const out = await readUploadRowsNaming(client, [id(1)])
    expect(out.map(r => r.workspaceId).sort()).toEqual([W1, W2])
  })
  it('a certificate always carries tool and stage, and says when it was refused', async () => {
    const { client, inserts } = fakeClient([])
    expect(await writeCertificate(client, { workspaceId: W1, actorUserId: U1, ok: true, message: 'm', context: { stage: 'delete', file_id: id(1), outcome: 'deleted' } })).toBe(true)
    // Round 1, finding 4: ALWAYS the admin stream, which members cannot insert.
    expect(inserts[0]).toMatchObject({ code: 'WIL-6001', event_type: 'admin', context: { tool: 'ai-files', stage: 'delete' } })
    expect(uploadRowOf(inserts[0])).toBe(null)
    expect(await writeCertificate(client, { workspaceId: W1, actorUserId: U1, ok: false, message: 'm', context: { stage: 'delete', __x: 1 } })).toBe(true)
    expect(inserts[1].code).toBe('WIL-6002')
    expect(inserts[1].severity).toBe('warning')
    expect(inserts[1].event_type).toBe('admin')
    await writeCertificate(client, { workspaceId: W1, actorUserId: U1, ok: false, quiet: true, message: 'm', context: { stage: 'delete_refused' } })
    expect(inserts[2]).toMatchObject({ code: 'WIL-6002', severity: 'info', event_type: 'admin' })
  })
  it('readCertifiedGone reads this workspace\'s admin-stream delete certificates, nothing else', async () => {
    const cert = (n, over = {}, ctxOver = {}) => ({ workspace_id: W1, event_type: 'admin', code: 'WIL-6001', context: { tool: 'ai-files', stage: 'delete', file_id: id(n), outcome: 'deleted', ...ctxOver }, ...over })
    const { client } = fakeClient([cert(1), cert(2, { event_type: 'system' }), cert(3, { workspace_id: W2 }), cert(4, {}, { outcome: 'gone' })])
    expect([...await readCertifiedGone(client, W1, null)].sort()).toEqual([id(1), id(4)])
    expect([...await readCertifiedGone(client, W1, [id(4), id(9)])]).toEqual([id(4)])
  })
})

// ── The function's source: the invariant and the upload branch ──────────────

const fnSrc = readFileSync(join(REPO, 'supabase', 'functions', 'ai-files', 'index.ts'), 'utf8').replace(/\r\n/g, '\n')
const stripTs = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')

describe('ai-files: the upload branch is byte-identical, and nothing materialises a body', () => {
  it('the upload branch hashes as it did before FX12 (634693d5…)', () => {
    const mark = "  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)"
    expect(fnSrc.split(mark)).toHaveLength(2)
    const tail = fnSrc.slice(fnSrc.indexOf(mark))
    expect(createHash('sha256').update(tail).digest('hex')).toBe('634693d5bc1f73caa40dd892d4688038bfb3696e4315f84cefe24926f22042ef')
  })
  it('the key resolver and the upload\'s logger hash as they did before FX12 (68da6f50…)', () => {
    const a = fnSrc.indexOf('// ── Key resolution')
    const end = '  } catch { /* telemetry never breaks the request */ }\n}\n'
    const seg = fnSrc.slice(a, fnSrc.indexOf(end) + end.length)
    expect(createHash('sha256').update(seg).digest('hex')).toBe('68da6f5079d90a65d172acfbb0a861251bcb87fd8eedb80baf6df6ebfcbbdb0b')
  })
  it('the new routes are dispatched before the upload, and the preflight names their methods', () => {
    const code = stripTs(fnSrc)
    const del = code.indexOf("if (req.method === 'DELETE') return await handleDelete(req)")
    const get = code.indexOf("if (req.method === 'GET') return await handleList(req)")
    const post = code.indexOf("if (req.method !== 'POST')")
    expect(del).toBeGreaterThan(-1)
    expect(get).toBeGreaterThan(del)
    expect(post).toBeGreaterThan(get)
    expect(fnSrc).toMatch(/'access-control-allow-methods': 'POST, GET, DELETE, OPTIONS'/)
  })
  it('nothing in the function reads a body whole', () => {
    const code = stripTs(fnSrc)
    for (const m of ['req.json(', 'req.formData(', 'req.arrayBuffer(', 'req.text(', 'req.blob(']) expect(code).not.toContain(m)
    expect(code).toContain('readSmallJson(req)')
  })
  it('round 1, finding 2: a delete asks the store once per key (ids[]), never once per id; the list skips certified ids', () => {
    const code = stripTs(fnSrc)
    expect(code).not.toContain('fileMetadata(')
    const own = code.slice(code.indexOf('async function deleteOwn('), code.indexOf('async function isLiveAdmin('))
    expect(own).toMatch(/lookupFiles\(key, sourceIds\)/)
    expect(own).toMatch(/deleteVerdict\(id, \{ rows, stored, certified, workspaceId, callerId \}\)/)
    expect(own).toMatch(/certify_failed: certifyFailed/)
    const list = code.slice(code.indexOf('async function storedForWorkspace('), code.indexOf('async function handleDelete('))
    expect(list).toMatch(/readCertifiedGone\(admin, workspaceId, null\)/)
    expect(list).toMatch(/own\.filter\(r => !gone\.has\(r\.fileId\)\)/)
  })
  it('round 1, finding 2: the new routes spend their own per-caller bucket, never the workspace\'s upload budget', () => {
    const code = stripTs(fnSrc)
    for (const fn of ['async function handleDelete(', 'async function handleList(']) {
      const at = code.indexOf(fn)
      // To the next function, or to Deno.serve (handleList is the last one).
      const ends = ['\nasync function ', '\nDeno.serve('].map(m => code.indexOf(m, at + 10)).filter(i => i > at)
      const body = code.slice(at, Math.min(...ends))
      expect(body, fn).toMatch(/isRateLimited\(admin, 'ai-files-manage', callerId, MANAGE_RPM, 60\)/)
      expect(body, fn).not.toMatch(/isRateLimited\(admin, 'ai-files', workspaceId/)
    }
  })
  it('the sweep takes the admin guard; the member\'s delete only its own ids', () => {
    const code = stripTs(fnSrc)
    const sweepAt = code.indexOf('if (body.sweep === true)')
    expect(code.indexOf('requireWorkspaceAdmin(req)', sweepAt)).toBeGreaterThan(sweepAt)
    expect(code).toMatch(/r\.fileId === id && r\.workspaceId === workspaceId && r\.actorUserId === callerId/)
  })
})

describe('operator-ai-files and config.toml', () => {
  const opSrc = readFileSync(join(REPO, 'supabase', 'functions', 'operator-ai-files', 'index.ts'), 'utf8')
  const toml = readFileSync(join(REPO, 'supabase', 'config.toml'), 'utf8')
  it('the operator function takes the operator guard and reads only the platform key\'s store', () => {
    const code = stripTs(opSrc)
    expect(code).toContain('requirePlatformOperator(req)')
    expect(code).toContain("Deno.env.get('ANTHROPIC_API_KEY')")
    expect(code).not.toContain('decryptAiKey')
    expect(code).toMatch(/r\.keySource === 'platform'/)
  })
  it('both functions opt out of the gateway\'s HS256-only check, as every function here does', () => {
    expect(toml).toMatch(/\[functions\.ai-files\]\r?\nverify_jwt = false/)
    expect(toml).toMatch(/\[functions\.operator-ai-files\]\r?\nverify_jwt = false/)
  })
})
