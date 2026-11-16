// =============================================================================
// edgeSweeps.test.js — F7 (wave 2, 2026-11-13). Three Edge Functions RUN.
//
// storage-gc, ai-files and operator-ai-files are driven here through their own
// Deno.serve handlers. The guard modules, the key and S3 modules are replaced;
// `ctx.admin` is a small in-memory stand-in for supabase-js that applies every
// filter a function sends (eq, in, like, order, limit, range, json paths) to
// rows planted here; `fetch` is a stand-in for the AI provider's file store.
// So a read that leaves a row out leaves it out, and what follows from that
// (a deletion, a total) is what the function really does.
//
// The other files that reach these functions (storageGcReserved, storageGc
// ShotTwins, aiFileStore) pin source text or pure rules; this one is the only
// place the handlers run, which is why it is a file of its own: its module
// replacements would replace modules those files import for real.
// =============================================================================

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

const WS = '11111111-1111-4111-8111-111111111111'
const OTHER_WS = '22222222-2222-4222-8222-222222222222'
const PID = 'aaaaaaaa-0000-4000-8000-000000000001'
const ADMIN = 'a0000000-0000-4000-8000-0000000000a1'

// ── The stand-in for supabase-js ─────────────────────────────────────────────
function likeToRegExp(pattern) {
  const esc = (c) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  let re = '^'
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '\\' && i + 1 < pattern.length) { re += esc(pattern[++i]); continue }
    re += c === '%' ? '[\\s\\S]*' : c === '_' ? '[\\s\\S]' : esc(c)
  }
  return new RegExp(re + '$')
}

// PostgREST's list grammar (QueryParams.hs, v12.2.3), ported (round 1, r1-gc):
//   pListVal     = lexeme '(' *> pListElement `sepBy1` ',' <* lexeme ')'      -- and NO end of input: a tail is ignored
//   pListElement = try (pQuotedValue <* notFollowedBy (noneOf ",)")) <|> many (noneOf ",)")
//   pQuotedValue = '"' *> many (noneOf "\\\"" <|> ('\\' *> anyChar)) <* '"'
function parseList(s) {
  let i = 0
  const ws = () => { while (s[i] === ' ' || s[i] === '\t') i++ }
  ws(); if (s[i] !== '(') throw new Error('PGRST100: expected (')
  i++; ws()
  const out = []
  for (;;) {
    const save = i
    let val = null
    if (s[i] === '"') {
      let j = i + 1, acc = '', ok = false
      while (j < s.length) {
        if (s[j] === '\\') { if (j + 1 < s.length) { acc += s[j + 1]; j += 2; continue } break }
        if (s[j] === '"') { ok = true; j++; break }
        acc += s[j]; j++
      }
      if (ok && (j >= s.length || s[j] === ',' || s[j] === ')')) { val = acc; i = j }
    }
    if (val === null) {
      i = save
      let acc = ''
      while (i < s.length && s[i] !== ',' && s[i] !== ')') acc += s[i++]
      val = acc
    }
    out.push(val)
    if (s[i] === ',') { i++; continue }
    break
  }
  ws(); if (s[i] !== ')') throw new Error('PGRST100: expected )')
  return out
}
// postgrest-js 1.16.1's `.in()`: quotes a value holding , ( or ) and escapes nothing.
const postgrestJsIn = (values) => `(${[...new Set(values)].map((v) => (typeof v === 'string' && /[,()]/.test(v) ? `"${v}"` : `${v}`)).join(',')})`

function valueOf(row, column) {
  const j = column.split('->>')
  if (j.length === 2) {
    const o = row[j[0]]
    const v = o && typeof o === 'object' ? o[j[1]] : undefined
    return v === undefined || v === null ? null : String(v)
  }
  return row[column] ?? null
}

function makeDb() {
  const db = {
    tables: {},
    objects: {}, // bucket -> [{ path, created_at }]
    log: [], // every query and storage call a function sent, in order
    fail: () => null, // (query) => an error message, or an error of any shape ({ raw }), or null
    removeFail: () => null, // (bucket, paths) => error message | null
    maxRows: 1000, // PostgREST's max_rows: a setting, 1000 in config.toml
    nextId: 1000,
    clock: Date.parse('2026-11-13T00:00:00.000Z'),
  }
  const rowsOf = (t) => (db.tables[t] ??= [])
  class Query {
    constructor(table) { this.table = table; this.op = 'select'; this.filters = []; this.orders = []; this.cap = null; this.from = 0; this.to = null; this.single = false }
    select(cols) { this.cols = cols; return this }
    insert(payload) { this.op = 'insert'; this.payload = payload; return this }
    update(payload) { this.op = 'update'; this.payload = payload; return this }
    eq(c, v) { this.filters.push({ k: 'eq', c, v }); return this }
    // As on the wire: postgrest-js builds the list, PostgREST parses it back (a bad one fails the read).
    in(c, vs) { return this.filter(c, 'in', postgrestJsIn(vs)) }
    filter(c, op, text) {
      if (op !== 'in') throw new Error(`stand-in: filter op ${op}`)
      try { this.filters.push({ k: 'in', c, v: parseList(text), wire: text }) } catch (e) { this.parseError = e.message }
      return this
    }
    gt(c, v) { this.filters.push({ k: 'gt', c, v }); return this }
    like(c, v) { this.filters.push({ k: 'like', c, v }); return this }
    order(c, o = {}) { this.orders.push({ c, asc: o.ascending !== false }); return this }
    limit(n) { this.cap = n; return this }
    range(a, b) { this.from = a; this.to = b; return this }
    maybeSingle() { this.single = true; return this }
    matches(row) {
      return this.filters.every((f) => {
        const v = valueOf(row, f.c)
        if (f.k === 'eq') return v !== null && v === f.v
        if (f.k === 'in') return v !== null && f.v.includes(v)
        if (f.k === 'gt') return v !== null && String(v) > String(f.v)
        if (f.k === 'like') return v !== null && likeToRegExp(f.v).test(v)
        return false
      })
    }
    then(resolve, reject) { return Promise.resolve().then(() => this.run()).then(resolve, reject) }
    // Only the columns the select names come back, as PostgREST answers.
    project(r) {
      if (!this.cols || this.cols.trim() === '*') return { ...r }
      const out = {}
      for (const c of this.cols.split(',').map((x) => x.trim())) out[c] = r[c]
      return out
    }
    run() {
      db.log.push({ table: this.table, op: this.op, filters: this.filters.map((f) => ({ ...f })), payload: this.payload })
      if (this.parseError) return { data: null, error: { message: this.parseError, code: 'PGRST100' } }
      const failed = db.fail(this)
      if (failed) return { data: null, error: typeof failed === 'object' && 'raw' in failed ? failed.raw : { message: failed } }
      const rows = rowsOf(this.table)
      if (this.op === 'insert') {
        for (const p of [].concat(this.payload)) rows.push({ id: db.nextId++, created_at: new Date(db.clock).toISOString(), ...p })
        return { data: null, error: null }
      }
      if (this.op === 'update') {
        for (const r of rows) if (this.matches(r)) Object.assign(r, this.payload)
        return { data: null, error: null }
      }
      let out = rows.filter((r) => this.matches(r))
      for (const o of [...this.orders].reverse()) {
        out = [...out].sort((a, b) => {
          const x = a[o.c], y = b[o.c]
          return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1)
        })
      }
      if (this.to !== null) out = out.slice(this.from, this.to + 1)
      if (this.cap !== null) out = out.slice(0, this.cap)
      // PostgREST's max_rows, which binds service_role too.
      out = out.slice(0, typeof db.maxRows === 'object' ? (db.maxRows[this.table] ?? 1000) : db.maxRows)
      if (this.single) return { data: out[0] ? this.project(out[0]) : null, error: null }
      return { data: out.map((r) => this.project(r)), error: null }
    }
  }
  const storage = {
    from(bucket) {
      return {
        async list(prefix, opts = {}) {
          db.log.push({ storage: 'list', bucket, prefix })
          const base = prefix ? `${prefix}/` : ''
          const seen = new Map()
          for (const o of db.objects[bucket] ?? []) {
            if (!o.path.startsWith(base)) continue
            const rest = o.path.slice(base.length)
            const i = rest.indexOf('/')
            if (i < 0) seen.set(rest, { name: rest, id: `obj-${o.path}`, created_at: o.created_at })
            else if (!seen.has(rest.slice(0, i))) seen.set(rest.slice(0, i), { name: rest.slice(0, i), id: null })
          }
          const entries = [...seen.values()].sort((a, b) => (a.name < b.name ? -1 : 1))
          const offset = opts.offset ?? 0
          return { data: entries.slice(offset, offset + (opts.limit ?? 100)), error: null }
        },
        async remove(paths) {
          db.log.push({ storage: 'remove', bucket, paths: [...paths] })
          const failed = db.removeFail(bucket, paths)
          if (failed) return { data: null, error: { message: failed } }
          const list = db.objects[bucket] ?? []
          const removed = list.filter((o) => paths.includes(o.path))
          db.objects[bucket] = list.filter((o) => !paths.includes(o.path))
          return { data: removed.map((o) => ({ name: o.path })), error: null }
        },
      }
    },
  }
  db.admin = { from: (t) => new Query(t), storage, rpc: async () => ({ data: [{ abandoned: 0, completed: 0 }], error: null }) }
  return db
}

// ── The AI provider's file store, as `fetch` ─────────────────────────────────
function makeStore() {
  // goneOnDelete: the store lost the file between the list and the delete (it answers 404 and lists it no more).
  // limited: every delete answers 429 (the store's rate limit), which ends a sweep's run.
  const store = { files: new Map(), calls: [], failDelete: new Set(), goneOnDelete: new Set(), limited: false }
  store.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    const method = (init.method ?? 'GET').toUpperCase()
    store.calls.push({ method, path: url.pathname, query: url.search })
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (url.hostname !== 'api.anthropic.com') return json({ error: { type: 'not_found' } }, 404)
    const m = url.pathname.match(/^\/v1\/files\/(.+)$/)
    if (method === 'DELETE' && m) {
      const id = decodeURIComponent(m[1])
      if (store.limited) return json({ error: { type: 'rate_limit_error' } }, 429)
      if (store.failDelete.has(id)) return json({ error: { type: 'api_error' } }, 500)
      if (store.goneOnDelete.has(id)) store.files.delete(id)
      if (!store.files.has(id)) return json({ error: { type: 'not_found_error' } }, 404)
      store.files.delete(id)
      return json({ id, type: 'file_deleted' })
    }
    if (method === 'GET' && url.pathname === '/v1/files') {
      const ids = url.searchParams.getAll('ids[]')
      const all = [...store.files.values()]
      const data = ids.length ? all.filter((f) => ids.includes(f.id)) : all
      return json({ data, has_more: false })
    }
    return json({ error: { type: 'not_found_error' } }, 404)
  }
  return store
}

// ── The modules the three functions import, replaced ────────────────────────
const guard = { ctx: null, events: [], platformEvents: [] }
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
vi.mock('../../supabase/functions/_shared/adminGuard.ts', () => ({
  corsHeaders: {},
  reply,
  requireWorkspaceAdmin: async () => ({ ok: true, ctx: guard.ctx }),
  logAdminEvent: async (_ctx, ev) => { guard.events.push(ev) },
}))
vi.mock('../../supabase/functions/_shared/memberGuard.ts', () => ({
  requireActiveMember: async () => ({ ok: true, ctx: guard.ctx }),
}))
vi.mock('../../supabase/functions/_shared/operatorGuard.ts', () => ({
  corsHeaders: {},
  reply,
  requirePlatformOperator: async () => ({ ok: true, ctx: { admin: guard.ctx.admin, callerId: 'operator-1' } }),
  logPlatformEvent: async (_ctx, ev) => { guard.platformEvents.push(ev) },
}))
vi.mock('../../supabase/functions/_shared/rateLimit.ts', () => ({ isRateLimited: async () => false, envInt: (_n, f) => f }))
vi.mock('../../supabase/functions/_shared/aiKeyCrypto.ts', () => ({ decryptAiKey: async () => 'tenant-key', aiKeyCryptoConfigured: () => true }))
vi.mock('../../supabase/functions/_shared/aiFilesKey.ts', () => ({ resolveUploadKey: async () => ({ ok: true, key: 'platform-key' }) }))
vi.mock('../../supabase/functions/_shared/storageSecretCrypto.ts', () => ({ decryptStorageSecret: async () => 'test-secret' }))
vi.mock('../../supabase/functions/_shared/s3Presign.ts', () => ({
  presignS3Request: async ({ key, method }) => `https://bucket.example.test/${key}?method=${method}`,
  s3HostAndPath: () => ({ host: 'bucket.example.test', path: '/' }),
}))
const s3 = { deleted: [] }
vi.mock('../../supabase/functions/_shared/s3Reach.ts', () => ({
  vetS3Host: async (host) => ({ ok: true, host, address: '203.0.113.7' }),
  s3Request: async ({ url }) => { s3.deleted.push(new URL(url).pathname.slice(1)); return { status: 204, redirect: false } },
  s3ReachDeps: () => ({}),
}))

const handlers = {}
let store
beforeAll(async () => {
  let last = null
  vi.stubGlobal('Deno', {
    serve: (h) => { last = h },
    env: { get: (k) => ({ SUPABASE_URL: 'https://project.example.test', ANTHROPIC_API_KEY: 'platform-key' })[k] },
  })
  vi.stubGlobal('fetch', (...a) => store.fetch(...a))
  for (const name of ['storage-gc', 'ai-files', 'operator-ai-files']) {
    last = null
    await import(`../../supabase/functions/${name}/index.ts`)
    handlers[name] = last
  }
})

let db
beforeEach(() => {
  db = makeDb()
  store = makeStore()
  guard.ctx = { admin: db.admin, workspaceId: WS, callerId: ADMIN }
  guard.events = []
  guard.platformEvents = []
  s3.deleted = []
})

async function call(name, method = 'POST', body = undefined) {
  const init = { method }
  if (body !== undefined) { init.body = JSON.stringify(body); init.headers = { 'content-type': 'application/json' } }
  const res = await handlers[name](new Request(`https://fn.example.test/${name}`, init))
  return { status: res.status, body: await res.json() }
}

// ═════════════════════════════════════════════════════════════════════════════
// storage-gc
// ═════════════════════════════════════════════════════════════════════════════
const PROVIDERS = ['supabase', 'google_drive', 'local_server', 's3', 'network_share']
const OLD = '2026-01-01T00:00:00.000Z'
const key = (leaf) => `projects/${PID}/assets/${leaf}`

function queue(row) {
  const r = { id: db.nextId++, workspace_id: WS, status: 'pending', provider: 'supabase', kind: 'body', bucket_id: 'rabbit-files', ...row }
  ;(db.tables.storage_gc_queue ??= []).push(r)
  return r
}
function object(bucket, path) { (db.objects[bucket] ??= []).push({ path, created_at: OLD }) }
function fileRow(row) {
  ;(db.tables.files ??= []).push({ id: `f-${db.nextId++}`, workspace_id: WS, project_id: PID, deleted_at: null, thumbnail_url: null, ...row })
}
function s3Workspace() {
  ;(db.tables.workspace_storage ??= []).push({ workspace_id: WS, provider: 's3', provider_config: { region: 'us-east-1', bucket: 'b', accessKeyId: 'AKIDTEST' } })
  ;(db.tables.workspace_storage_secrets ??= []).push({ workspace_id: WS, secret_ciphertext: 'sealed' })
}
const queueRow = (r) => db.tables.storage_gc_queue.find((q) => q.id === r.id)
const inBucket = (bucket, path) => (db.objects[bucket] ?? []).some((o) => o.path === path)

describe('storage-gc: the harness runs the function', () => {
  it('an empty workspace runs clean and certifies the run', async () => {
    const { status, body } = await call('storage-gc')
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(guard.events.map((e) => e.code)).toEqual(['WIL-3003'])
  })
})

// Safety rule 1 of storage-gc: NEVER delete an object a live OR trashed files
// row references. The read that answers it must leave out NO row that names
// the object: not by provider, not by workspace, not by trash state.
describe('storage-gc: a queued object that a files row still names is never deleted', () => {
  for (const provider of PROVIDERS) {
    it(`a Petal body named by a ${provider} row's storage_path stays`, async () => {
      const k = key(`body-${provider}.pdf`)
      object('rabbit-files', k)
      const q = queue({ object_path: k })
      fileRow({ storage_provider: provider, storage_path: k })
      const { body } = await call('storage-gc')
      expect(inBucket('rabbit-files', k)).toBe(true)
      expect(queueRow(q).status).toBe('skipped')
      expect(body.counts.queue_deleted).toBe(0)
    })

    it(`a Petal picture named by a ${provider} row's thumbnail_url stays`, async () => {
      const k = key(`pic-${provider}.png.jpg`)
      object('rabbit-thumbnails', k)
      const q = queue({ object_path: k, bucket_id: 'rabbit-thumbnails', kind: 'thumbnail' })
      fileRow({ storage_provider: provider, storage_path: key(`pic-${provider}.png`), thumbnail_url: k })
      await call('storage-gc')
      expect(inBucket('rabbit-thumbnails', k)).toBe(true)
      expect(queueRow(q).status).toBe('skipped')
    })

    for (const column of ['storage_path', 'thumbnail_url']) {
      it(`a company-bucket object named by a ${provider} row's ${column} stays (s3 asks both columns)`, async () => {
        s3Workspace()
        const k = key(`s3-${provider}-${column}.bin`)
        const q = queue({ object_path: k, bucket_id: 'byo-s3', provider: 's3', kind: column === 'thumbnail_url' ? 'thumbnail' : 'body' })
        fileRow({ storage_provider: provider, storage_path: column === 'storage_path' ? k : key('another.bin'), thumbnail_url: column === 'thumbnail_url' ? k : null })
        await call('storage-gc')
        expect(s3.deleted).toEqual([])
        expect(queueRow(q).status).toBe('skipped')
      })
    }
  }

  it('a trashed row still names its object', async () => {
    const k = key('trashed.pdf')
    object('rabbit-files', k)
    const q = queue({ object_path: k })
    fileRow({ storage_provider: 'supabase', storage_path: k, deleted_at: '2026-11-01T00:00:00Z' })
    await call('storage-gc')
    expect(inBucket('rabbit-files', k)).toBe(true)
    expect(queueRow(q).status).toBe('skipped')
  })

  it("another company's row naming the same key still keeps it (the read has no workspace filter)", async () => {
    const k = key('shared-key.pdf')
    object('rabbit-files', k)
    const q = queue({ object_path: k })
    fileRow({ storage_provider: 'supabase', storage_path: k, workspace_id: OTHER_WS })
    await call('storage-gc')
    expect(inBucket('rabbit-files', k)).toBe(true)
    expect(queueRow(q).status).toBe('skipped')
  })

  it('CONTROL: with no row naming it, the same object is deleted and certified', async () => {
    const k = key('garbage.pdf')
    object('rabbit-files', k)
    const q = queue({ object_path: k })
    fileRow({ storage_provider: 'supabase', storage_path: key('someone-else.pdf') })
    const { body } = await call('storage-gc')
    expect(inBucket('rabbit-files', k)).toBe(false)
    expect(queueRow(q).status).toBe('deleted')
    expect(body.counts.queue_deleted).toBe(1)
  })

  it('a guard read that fails deletes nothing and marks the row failed', async () => {
    const k = key('unread.pdf')
    object('rabbit-files', k)
    const q = queue({ object_path: k })
    db.fail = (query) => (query.table === 'files' && query.op === 'select' ? 'statement timeout' : null)
    const { body } = await call('storage-gc')
    expect(inBucket('rabbit-files', k)).toBe(true)
    expect(queueRow(q).status).toBe('failed')
    expect(queueRow(q).detail).toMatch(/^restorability check failed, nothing deleted: statement timeout/)
    expect(body.counts.queue_failed).toBe(1)
  })
})

// F7 (C3): the guard is asked once per chunk of paths, not once per row.
describe('storage-gc: the guard reads a page of the queue in chunks, and decides each row as before', () => {
  const guardReads = () => db.log.filter((q) => q.table === 'files' && q.op === 'select'
    && q.filters.some((f) => f.k === 'in' && (f.c === 'storage_path' || f.c === 'thumbnail_url')))
  const longKey = (i) => key(`${'deep/'.repeat(12)}${String(i).padStart(4, '0')}-a-long-file-name-for-the-chunk.pdf`)

  it('a page of 120 long keys costs a few reads, not 120, and no read per row', async () => {
    for (let i = 0; i < 120; i++) { object('rabbit-files', longKey(i)); queue({ object_path: longKey(i) }) }
    const { body } = await call('storage-gc')
    const reads = guardReads()
    // More reads than the three slices of 50: a slice is cut into chunks (round 2: `> 1` was met by the slices alone).
    expect(reads.length).toBeGreaterThan(Math.ceil(120 / 50))
    expect(reads.length).toBeLessThan(10)
    // Each list as the request carries it, form-encoded (a comma goes as %2C), keeps to the 6,000-character budget.
    for (const r of reads) {
      const list = r.filters.find((f) => f.k === 'in' && (f.c === 'storage_path' || f.c === 'thumbnail_url')).wire
      expect(new URLSearchParams({ v: list }).toString().length - 2).toBeLessThanOrEqual(6000 + 6)
    }
    expect(db.log.filter((q) => q.table === 'files' && q.filters.some((f) => f.k === 'eq' && f.c === 'storage_path')).length).toBe(0)
    expect(body.counts.queue_deleted).toBe(120)
  })

  it('a named key in a later chunk is found and kept', async () => {
    for (let i = 0; i < 120; i++) { object('rabbit-files', longKey(i)); queue({ object_path: longKey(i) }) }
    fileRow({ storage_provider: 'supabase', storage_path: longKey(119) })
    await call('storage-gc')
    expect(inBucket('rabbit-files', longKey(119))).toBe(true)
    expect(inBucket('rabbit-files', longKey(0))).toBe(false)
    expect(db.tables.storage_gc_queue.find((q) => q.object_path === longKey(119)).status).toBe('skipped')
  })

  it("a chunk whose read fails fails each of its rows, and nothing of it is deleted; the other chunks go on", async () => {
    for (let i = 0; i < 120; i++) { object('rabbit-files', longKey(i)); queue({ object_path: longKey(i) }) }
    db.fail = (q) => (q.table === 'files' && q.filters.some((f) => f.k === 'in' && f.c === 'storage_path' && f.v.includes(longKey(0))) ? 'connection reset' : null)
    const { body } = await call('storage-gc')
    const failedRows = db.tables.storage_gc_queue.filter((q) => q.status === 'failed')
    expect(failedRows.length).toBeGreaterThan(0)
    for (const q of failedRows) {
      expect(inBucket('rabbit-files', q.object_path)).toBe(true)
      expect(q.detail).toBe('restorability check failed, nothing deleted: connection reset')
    }
    expect(body.counts.queue_failed).toBe(failedRows.length)
    expect(body.counts.queue_deleted).toBe(120 - failedRows.length)
    expect(inBucket('rabbit-files', longKey(0))).toBe(true) // longKey(0) is in the failed chunk: kept
  })

  it('an answer past PostgREST\'s 1,000 rows is read to its end: the row that names the key is on page two', async () => {
    const k = key('named-on-page-two.pdf')
    const other = key('named-by-many.pdf')
    object('rabbit-files', k)
    object('rabbit-files', other)
    queue({ object_path: other })
    const q = queue({ object_path: k })
    for (let i = 0; i < 1050; i++) fileRow({ storage_provider: 'supabase', storage_path: other })
    fileRow({ storage_provider: 'supabase', storage_path: k })
    await call('storage-gc')
    expect(inBucket('rabbit-files', k)).toBe(true)
    expect(queueRow(q).status).toBe('skipped')
  })

  // Round 1 (r1-gc, SECURITY): a key holding `")` once ended postgrest-js's list early, and every key after it
  // in the chunk was never asked, so each was deleted while a row named it.
  const HOSTILE = [
    key('q")z.png.jpg'), key('a"b,c.png.jpg'), key('back\\slash (1).png.jpg'), key('"quoted".png.jpg'),
    ' ' + key('leading-space.png.jpg'), key('Budget (final), v2.png.jpg'), key('plain-after.png.jpg'),
  ]
  for (const at of [0, 3, 6]) {
    it(`a hostile key at position ${at + 1} of a chunk: every key in it is still asked, and every named one kept`, async () => {
      const keys = [...HOSTILE]
      keys.splice(at, 0, keys.splice(0, 1)[0]) // the `")` key moved to this position
      for (const k of keys) {
        object('rabbit-thumbnails', k)
        queue({ object_path: k, bucket_id: 'rabbit-thumbnails', kind: 'thumbnail' })
        fileRow({ storage_provider: 'supabase', storage_path: k.replace(/\.jpg$/, ''), thumbnail_url: k })
      }
      await call('storage-gc')
      for (const k of keys) {
        expect(inBucket('rabbit-thumbnails', k)).toBe(true)
        expect(db.tables.storage_gc_queue.find((q) => q.object_path === k).status).toBe('skipped')
      }
    })
  }

  it('and an unnamed hostile key is still found free, alone: the exact read decides it', async () => {
    const k = key('q")z.png.jpg')
    object('rabbit-thumbnails', k)
    const q = queue({ object_path: k, bucket_id: 'rabbit-thumbnails', kind: 'thumbnail' })
    await call('storage-gc')
    expect(queueRow(q).status).toBe('deleted')
    expect(db.log.some((x) => x.table === 'files' && x.filters.some((f) => f.k === 'eq' && f.c === 'thumbnail_url' && f.v === k))).toBe(true)
  })

  for (const [label, raw] of [['an empty object', {}], ['a bare string', 'Bad gateway'], ['an error with no message', { error: 'upstream' }]]) {
    it(`a read whose error is ${label} still fails the row closed`, async () => {
      const k = key(`err-${label.length}.pdf`)
      object('rabbit-files', k)
      const q = queue({ object_path: k })
      db.fail = (query) => (query.table === 'files' && query.op === 'select' ? { raw } : null)
      await call('storage-gc')
      expect(inBucket('rabbit-files', k)).toBe(true)
      expect(queueRow(q).status).toBe('failed')
    })
  }

  it('with max_rows set to 3, five rows naming five keys of one chunk are all read', async () => {
    db.maxRows = { files: 3 } // the guard's reads capped; the queue's own page is not
    const keys = [0, 1, 2, 3, 4].map((i) => key(`capped-${i}.pdf`))
    for (const k of keys) { object('rabbit-files', k); queue({ object_path: k }); fileRow({ storage_provider: 'supabase', storage_path: k }) }
    await call('storage-gc')
    for (const k of keys) {
      expect(inBucket('rabbit-files', k)).toBe(true)
      expect(db.tables.storage_gc_queue.find((q) => q.object_path === k).status).toBe('skipped')
    }
  })

  it('an s3 row asks both columns: a failed storage_path read fails it even when a picture names it', async () => {
    s3Workspace()
    const k = key('s3-both.bin')
    const q = queue({ object_path: k, bucket_id: 'byo-s3', provider: 's3' })
    fileRow({ storage_provider: 's3', storage_path: key('other.bin'), thumbnail_url: k })
    db.fail = (query) => (query.table === 'files' && query.filters.some((f) => f.k === 'in' && f.c === 'storage_path') ? 'timeout' : null)
    await call('storage-gc')
    expect(queueRow(q).status).toBe('failed')
    expect(s3.deleted).toEqual([])
  })

  // Round 2 (r2-gc): each of these turned red on a plant the cases above let pass.
  it('a named key in the SECOND chunk of the first slice is kept', async () => {
    for (let i = 0; i < 50; i++) { object('rabbit-files', longKey(i)); queue({ object_path: longKey(i) }) }
    fileRow({ storage_provider: 'supabase', storage_path: longKey(45) })
    await call('storage-gc')
    expect(inBucket('rabbit-files', longKey(45))).toBe(true)
    expect(inBucket('rabbit-files', longKey(0))).toBe(false)
  })

  it('with max_rows set to 3 and ids not in insertion order, every named key is still seen (the pages go by id)', async () => {
    db.maxRows = { files: 3 }
    const ids = ['f-9', 'f-1', 'f-5', 'f-3', 'f-7']
    const keys = ids.map((id) => key(`order-${id}.pdf`))
    keys.forEach((k, i) => {
      object('rabbit-files', k)
      queue({ object_path: k })
      ;(db.tables.files ??= []).push({ id: ids[i], workspace_id: WS, project_id: PID, deleted_at: null, thumbnail_url: null, storage_provider: 'supabase', storage_path: k })
    })
    await call('storage-gc')
    expect(keys.filter((k) => !inBucket('rabbit-files', k))).toEqual([])
  })

  it('a row that comes to name a key of a later slice while the first slice is acted on keeps it (a slice is read, then acted on)', async () => {
    const keys = Array.from({ length: 60 }, (_, i) => key(`slice-${i}.pdf`))
    for (const k of keys) { object('rabbit-files', k); queue({ object_path: k }) }
    const late = keys[55]
    const from = db.admin.storage.from
    db.admin.storage.from = (b) => {
      const s = from(b)
      return { ...s, remove: async (paths) => { if (paths[0] === keys[0]) fileRow({ storage_provider: 'supabase', storage_path: late }); return s.remove(paths) } }
    }
    await call('storage-gc')
    expect(inBucket('rabbit-files', late)).toBe(true)
    expect(inBucket('rabbit-files', keys[0])).toBe(false)
  })

  it('an answer that is not a list (a 404 with an empty body: data null, error null) fails the row', async () => {
    const k = key('nolist.pdf')
    object('rabbit-files', k)
    const q = queue({ object_path: k })
    db.fail = (query) => (query.table === 'files' && query.op === 'select' ? { raw: null } : null)
    await call('storage-gc')
    expect(inBucket('rabbit-files', k)).toBe(true)
    expect(queueRow(q).status).toBe('failed')
  })

  it("a key that is not plain, whose exact read fails, is failed, not deleted", async () => {
    const k = key('Budget (final), v2.pdf')
    object('rabbit-files', k)
    const q = queue({ object_path: k })
    db.fail = (query) => (query.table === 'files' && query.filters.some((f) => f.k === 'eq' && f.c === 'storage_path') ? 'timeout' : null)
    await call('storage-gc')
    expect(inBucket('rabbit-files', k)).toBe(true)
    expect(queueRow(q).status).toBe('failed')
  })

  it('when only the confirming page fails, a key page one proved named is kept as named; the free key is failed', async () => {
    const k = key('named.pdf'), free = key('free.pdf')
    object('rabbit-files', k); object('rabbit-files', free)
    const qk = queue({ object_path: k }), qf = queue({ object_path: free })
    fileRow({ storage_provider: 'supabase', storage_path: k })
    db.fail = (query) => (query.table === 'files' && query.filters.some((f) => f.k === 'gt') ? 'connection reset' : null)
    const { body } = await call('storage-gc')
    expect(queueRow(qk).status).toBe('skipped')
    expect(queueRow(qf).status).toBe('failed')
    expect(inBucket('rabbit-files', free)).toBe(true)
    expect(body.counts.queue_failed).toBe(1)
  })
})

// Round 2 (r2-gc, r2-tests): the orphan scan, driven: a projects row makes the folder this company's.
describe('storage-gc: the orphan scan keeps every object a files row names', () => {
  const ourProject = () => { (db.tables.projects ??= []).push({ id: PID, workspace_id: WS }) }
  const longKey = (i) => key(`${'deep/'.repeat(12)}${String(i).padStart(4, '0')}-a-long-file-name-for-the-chunk.pdf`)

  it('with max_rows set to 3, five referenced objects of one chunk are all kept (the read is paged by id)', async () => {
    ourProject()
    db.maxRows = { files: 3 }
    const keys = [0, 1, 2, 3, 4].map((i) => key(`ref-${i}.pdf`))
    for (const k of keys) { object('rabbit-files', k); fileRow({ storage_provider: 'supabase', storage_path: k }) }
    await call('storage-gc')
    expect(keys.filter((k) => !inBucket('rabbit-files', k))).toEqual([])
  })

  it('a referenced key holding `, ( )` and a space is kept (the exact read); CONTROL: the free one beside it goes', async () => {
    ourProject()
    const k = key('Budget (final), v2.pdf')
    const hostile = key('q")z.pdf')
    const free = key('free.pdf')
    for (const p of [k, hostile, free]) object('rabbit-files', p)
    fileRow({ storage_provider: 'supabase', storage_path: k })
    fileRow({ storage_provider: 'supabase', storage_path: hostile })
    const { body } = await call('storage-gc')
    expect(inBucket('rabbit-files', k)).toBe(true)
    expect(inBucket('rabbit-files', hostile)).toBe(true)
    expect(inBucket('rabbit-files', free)).toBe(false)
    expect(body.counts.orphans_deleted).toBe(1)
  })

  it('a referenced key in a later chunk is kept', async () => {
    ourProject()
    for (let i = 0; i < 70; i++) object('rabbit-files', longKey(i))
    fileRow({ storage_provider: 'supabase', storage_path: longKey(65) })
    await call('storage-gc')
    expect(inBucket('rabbit-files', longKey(65))).toBe(true)
    expect(inBucket('rabbit-files', longKey(0))).toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// ai-files and operator-ai-files: the sweep's totals
// ═════════════════════════════════════════════════════════════════════════════
const HOUR = 60 * 60 * 1000
let seq = 0
function upload({ age, size = 1000 + seq, ws = WS, actor = ADMIN, rowFor = true, keySource = 'platform' } = {}) {
  const id = `file_test${String(++seq).padStart(8, '0')}`
  const at = new Date(Date.now() - age).toISOString()
  store.files.set(id, { id, type: 'file', filename: 'a client deck.pdf', created_at: at, size_bytes: size, mime_type: 'application/pdf', expires_at: null })
  if (rowFor) {
    ;(db.tables.app_events ??= []).push({
      id: db.nextId++, workspace_id: ws, actor_user_id: actor, created_at: new Date(Date.parse(at) + 300).toISOString(),
      code: 'WIL-6001', event_type: 'system', severity: 'info',
      context: { tool: 'ai-files', file_id: id, size_bytes: size, mime_type: 'application/pdf', key_source: keySource },
    })
  }
  return id
}
const storeListings = () => store.calls.filter((c) => c.method === 'GET' && c.path === '/v1/files').length

describe('ai-files: an admin sweep answers the totals a second listing would', () => {
  function plant() {
    upload({ age: 72 * HOUR }) // swept
    upload({ age: 48 * HOUR }) // swept
    const stuck = upload({ age: 30 * HOUR }) // its delete fails: stays
    store.failDelete.add(stuck)
    store.goneOnDelete.add(upload({ age: 40 * HOUR })) // already gone when its delete arrives: 404
    upload({ age: 1 * HOUR }) // recent: stays
    upload({ age: 72 * HOUR, ws: OTHER_WS, actor: 'b0000000-0000-4000-8000-0000000000b1' }) // another company's: never ours
  }

  it('after the sweep, its `after` equals what the list then answers', async () => {
    plant()
    const swept = await call('ai-files', 'DELETE', { sweep: true })
    expect(swept.status).toBe(200)
    expect(swept.body.counts).toMatchObject({ deleted: 2, gone: 1, failed: 1, skipped_recent: 1 })
    const listed = await call('ai-files', 'GET')
    expect(listed.status).toBe(200)
    const { count, total_bytes, oldest, sweepable } = listed.body
    expect(swept.body.after).toEqual({ count, total_bytes, oldest, sweepable })
    expect(count).toBe(2)
  })

  it('the run certificate says the same remaining count', async () => {
    plant()
    const swept = await call('ai-files', 'DELETE', { sweep: true })
    const cert = db.tables.app_events.find((r) => r.context?.stage === 'sweep')
    expect(cert.context.remaining).toBe(swept.body.after.count)
  })

  it('a sweep asks the store for its list once, not again after the deletions', async () => {
    plant()
    await call('ai-files', 'DELETE', { sweep: true })
    expect(storeListings()).toBe(1)
    // ...and reads this environment's rows once: the upload rows, the certificates, the notes, the rows naming the ids.
    expect(db.log.filter((q) => q.table === 'app_events' && q.op === 'select').length).toBe(4)
  })

  // Round 2 (r2-ai): the outcomes that leave a file in the store, each still counted as remaining.
  it("a run the store's rate limit ends: the files it never asked about ('skipped') and the refused ones remain", async () => {
    for (const age of [72, 60, 50, 40]) upload({ age: age * HOUR })
    upload({ age: 1 * HOUR })
    store.limited = true
    const swept = await call('ai-files', 'DELETE', { sweep: true })
    expect(swept.status).toBe(200)
    expect(swept.body.counts).toMatchObject({ deleted: 0, gone: 0, failed: 2, truncated: true })
    store.limited = false
    const listed = await call('ai-files', 'GET')
    const { count, total_bytes, oldest, sweepable } = listed.body
    expect(swept.body.after).toEqual({ count, total_bytes, oldest, sweepable })
    expect(count).toBe(5)
  })

  it("a file whose company key cannot be read at its delete ('unreachable') remains", async () => {
    ;(db.tables.workspace_ai_keys ??= []).push({ workspace_id: WS, key_ciphertext: 'sealed', key_version: 1 })
    upload({ age: 72 * HOUR }) // the platform's key: swept
    upload({ age: 60 * HOUR, keySource: 'workspace' }) // the company's own key
    let keyReads = 0
    // The listing reads the key (1st), the sweep's delete reads it again (2nd: it fails), a later list reads it (3rd).
    db.fail = (q) => (q.table === 'workspace_ai_keys' && ++keyReads === 2 ? 'connection reset' : null)
    const swept = await call('ai-files', 'DELETE', { sweep: true })
    expect(swept.status).toBe(200)
    expect(swept.body.counts).toMatchObject({ deleted: 1, unreachable: 1 })
    const listed = await call('ai-files', 'GET')
    const { count, total_bytes, oldest, sweepable } = listed.body
    expect(swept.body.after).toEqual({ count, total_bytes, oldest, sweepable })
    expect(count).toBe(1)
  })
})

describe('pooled answers in the order of its items, whatever order the calls finish in', () => {
  it('the slowest first still answers first', async () => {
    const { pooled } = await import('../../supabase/functions/_shared/aiFilesUpstream.ts')
    const delays = [40, 30, 20, 10, 0]
    const out = await pooled(delays, 2, (d) => new Promise((r) => setTimeout(() => r(`done ${d}`), d)))
    expect(out).toEqual(delays.map((d) => `done ${d}`))
  })
})

describe("operator-ai-files: the operator's sweep answers the counts a summary would", () => {
  function plant() {
    upload({ age: 72 * HOUR })
    upload({ age: 50 * HOUR, ws: OTHER_WS, actor: null })
    const stuck = upload({ age: 30 * HOUR })
    store.failDelete.add(stuck)
    store.goneOnDelete.add(upload({ age: 40 * HOUR }))
    upload({ age: 2 * HOUR })
    upload({ age: 90 * HOUR, rowFor: false }) // another environment's: left alone
  }

  it('after the sweep, its `after` equals what a summary then answers', async () => {
    plant()
    const swept = await call('operator-ai-files', 'POST', { action: 'sweep' })
    expect(swept.status).toBe(200)
    expect(swept.body.counts).toMatchObject({ deleted: 2, gone: 1, failed: 1, skipped_recent: 1, workspaces: 2 })
    const summary = await call('operator-ai-files', 'POST', { action: 'summary' })
    expect(summary.status).toBe(200)
    expect(swept.body.after).toEqual(summary.body.counts)
    expect(summary.body.counts.no_row.count).toBe(1)
  })

  it("the run's platform_audit line says the same", async () => {
    plant()
    const swept = await call('operator-ai-files', 'POST', { action: 'sweep' })
    const line = guard.platformEvents.find((e) => e.context?.stage === 'operator-sweep')
    expect(line.context.remaining_attributed).toBe(swept.body.after.attributed.count)
    expect(line.context.left_alone).toBe(swept.body.after.no_row.count + swept.body.after.unbound.count)
  })

  it('a sweep lists the store and reads the upload rows once', async () => {
    plant()
    await call('operator-ai-files', 'POST', { action: 'sweep' })
    expect(storeListings()).toBe(1)
    const rowReads = db.log.filter((q) => q.table === 'app_events' && q.op === 'select')
    expect(rowReads.length).toBe(1)
  })

  it("a run the store's rate limit ends: the files it never asked about ('skipped') and the refused ones remain", async () => {
    for (const age of [72, 60, 50, 40]) upload({ age: age * HOUR })
    store.limited = true
    const swept = await call('operator-ai-files', 'POST', { action: 'sweep' })
    expect(swept.status).toBe(200)
    expect(swept.body.counts).toMatchObject({ deleted: 0, gone: 0, failed: 2, truncated: true })
    store.limited = false
    const summary = await call('operator-ai-files', 'POST', { action: 'summary' })
    expect(swept.body.after).toEqual(summary.body.counts)
    expect(summary.body.counts.attributed.count).toBe(4)
  })
})
