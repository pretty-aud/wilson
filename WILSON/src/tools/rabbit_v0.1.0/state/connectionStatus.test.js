// =============================================================================
// connectionStatus.test.js — the connection dot's probe and its words
// (post-overhaul FX11, 2026-10-16). Pure: every network call is a fake.
//
// Pinned here:
//   * an answer reads res.ok — a 401/403 is "not answering for you", never
//     "connected"; a 404 is an answer only where a missing object proves the
//     store answered (a bucket asked for one object);
//   * every check is bounded AND aborted at the ceiling (the signal the fetch
//     was given fires), never rejects, and an abort from outside reads
//     `cancelled`;
//   * each backend asks the right place: the cloud's database and Petal
//     cloud's files bucket, a company bucket through the presign function
//     (with the token and the signal, never getSession), a NAS from the
//     desktop only, the Local Server's own route, the fixtures' seam;
//   * the three colours and the words, each part in words;
//   * the module never reaches auth-js (rule 3 in its header).
// =============================================================================
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  answerOfResponse, bounded, adapterKindOf, bucketProbeKey, petalProbePath, probeConnection, connectionView, isSettled,
  FILES_PLACE, FILES_BUCKET, LOCAL_CONNECTION_ROUTE, CONNECTION_TIMEOUT_MS,
} from './connectionStatus.js'

const here = dirname(fileURLToPath(import.meta.url))
const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body })
const PID = '11111111-2222-3333-4444-555555555555'

// A fake fetch: answers by URL, records every call with its signal.
function fakeFetch(answer) {
  const calls = []
  const fn = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init })
    const a = answer(String(url), init)
    if (a instanceof Error) throw a
    return a
  })
  fn.calls = calls
  return fn
}

function cloudDeps(over = {}) {
  return {
    supabaseUrl: 'https://db.example',
    anonKey: 'anon',
    token: () => 'tok',
    storageChoice: () => undefined,
    rememberStorageChoice: vi.fn(),
    bucketKey: () => null,
    desktop: false,
    ...over,
  }
}

describe('answerOfResponse: fetch resolves for every status, so the answer reads res.ok', () => {
  it('2xx is an answer; 401 and 403 are "not answering for you"; anything else is not an answer', () => {
    expect(answerOfResponse(res(200))).toEqual({ ok: true })
    expect(answerOfResponse(res(204))).toEqual({ ok: true })
    expect(answerOfResponse(res(401))).toEqual({ ok: false, why: 'refused', status: 401 })
    expect(answerOfResponse(res(403))).toEqual({ ok: false, why: 'refused', status: 403 })
    expect(answerOfResponse(res(500))).toEqual({ ok: false, why: 'error', status: 500 })
    expect(answerOfResponse(res(404))).toEqual({ ok: false, why: 'error', status: 404 })
    expect(answerOfResponse(null)).toEqual({ ok: false, why: 'unreachable' })
  })
  it('a 404 is an answer only where it is asked to be (the bucket answered; the object is not there) — and a 403 still is not', () => {
    expect(answerOfResponse(res(404), { missingIsAnswer: true })).toEqual({ ok: true })
    expect(answerOfResponse(res(403), { missingIsAnswer: true }).ok).toBe(false)
  })
})

describe('bounded: a ceiling that aborts, and never a rejection', () => {
  it('at the ceiling the signal the check was given is aborted and the answer is timeout', async () => {
    vi.useFakeTimers()
    try {
      let seen = null
      const p = bounded((signal) => { seen = signal; return new Promise(() => {}) }, { timeoutMs: 1000 })
      await vi.advanceTimersByTimeAsync(999)
      expect(seen.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await expect(p).resolves.toEqual({ ok: false, why: 'timeout' })
      expect(seen.aborted).toBe(true)
    } finally { vi.useRealTimers() }
  })
  it('a fetch that rejects on abort reads timeout, not unreachable', async () => {
    vi.useFakeTimers()
    try {
      const p = bounded((signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))), { timeoutMs: 50 })
      await vi.advanceTimersByTimeAsync(50)
      await expect(p).resolves.toEqual({ ok: false, why: 'timeout' })
    } finally { vi.useRealTimers() }
  })
  it('an abort from outside reads cancelled; a thrown check reads unreachable; a value passes through', async () => {
    const outside = new AbortController()
    const p = bounded((signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('x')))), { signal: outside.signal })
    outside.abort()
    await expect(p).resolves.toEqual({ ok: false, why: 'cancelled' })
    await expect(bounded(async () => { throw new TypeError('Failed to fetch') })).resolves.toEqual({ ok: false, why: 'unreachable' })
    await expect(bounded(async () => ({ ok: true, x: 1 }))).resolves.toEqual({ ok: true, x: 1 })
  })
  it('the default ceiling is bounded (seconds, not a minute)', () => {
    expect(CONNECTION_TIMEOUT_MS).toBeGreaterThan(1000)
    expect(CONNECTION_TIMEOUT_MS).toBeLessThanOrEqual(10000)
  })
})

describe('adapterKindOf and bucketProbeKey', () => {
  it('names the backend; the fixtures are told by the adapter they are', () => {
    expect(adapterKindOf('supabase', { mode: 'supabase' })).toBe('cloud')
    expect(adapterKindOf('supabase', { mode: 'fixtures' })).toBe('fixtures')
    expect(adapterKindOf('local_server', { mode: 'local_server' })).toBe('local')
    expect(adapterKindOf('google_drive', {})).toBe('drive')
    expect(adapterKindOf(null, null)).toBeNull()
  })
  it('a mode with no adapter yet (the provider before its boot, on its DEFAULT mode) is pending: checking, and nothing is asked', async () => {
    expect(adapterKindOf('local_server', null)).toBe('pending')
    expect(adapterKindOf('supabase', undefined)).toBe('pending')
    expect(connectionView({ kind: 'pending' })).toMatchObject({ state: 'checking', tone: 'neutral', words: 'Database: checking · Files: checking' })
    const localFetch = vi.fn()
    await expect(probeConnection('pending', { localFetch })).resolves.toEqual({ database: null, files: null })
    expect(localFetch).not.toHaveBeenCalled()
  })
  it('a real file kept in the bucket first (of the open project), else a row-shaped key nobody writes, else nothing', () => {
    const files = [
      { project_id: 'other', storage_provider: 's3', storage_path: 'projects/other/files/x/1-a.mov' },
      { project_id: PID, storage_provider: 'supabase', storage_path: 'projects/p/files/x/1-b.mov' },
      { project_id: PID, storage_provider: 's3', storage_path: 'projects/p/files/x/1-gone.mov', deleted_at: '2026-10-01' },
      { project_id: PID, storage_provider: 's3', storage_path: `projects/${PID}/files/x/1-c.mov` },
    ]
    expect(bucketProbeKey({ files, projectId: PID })).toEqual({ path: `projects/${PID}/files/x/1-c.mov`, real: true })
    expect(bucketProbeKey({ files: [], projectId: PID })).toEqual({ path: `projects/${PID}/connection-check/wilson-connection-check`, real: false })
    expect(bucketProbeKey({ files: [], projectIds: [PID] })).toEqual({ path: `projects/${PID}/connection-check/wilson-connection-check`, real: false })
    expect(bucketProbeKey({})).toBeNull()
    // The presign gate's shape (_shared/presignPath.ts): projects/<uuid>/<non-money>/…, plain segments.
    const key = bucketProbeKey({ projectId: PID }).path.split('/')
    expect(key[0]).toBe('projects')
    expect(key.length).toBeGreaterThanOrEqual(3)
    for (const s of key) expect(s).toMatch(/^[A-Za-z0-9._-]+$/)
    expect(['INVOICES', 'FINANCE', 'LEGAL']).not.toContain(key[2].toUpperCase())
  })
})

describe('probeConnection: the cloud on Petal cloud', () => {
  it('asks the database (one HEAD of projects) and the files bucket (one listed object), each with the token and its own abort signal', async () => {
    const fetch = fakeFetch((url) => (url.includes('workspace_storage') ? res(200, []) : res(200, [])))
    const r = await probeConnection('cloud', cloudDeps({ fetch }))
    expect(r).toEqual({ database: { ok: true }, files: { ok: true, place: FILES_PLACE.petal } })
    const db = fetch.calls.find((c) => c.url.includes('/rest/v1/projects'))
    expect(db.init.method).toBe('HEAD')
    const list = fetch.calls.find((c) => c.url === `https://db.example/storage/v1/object/list/${FILES_BUCKET}`)
    expect(list.init.method).toBe('POST')
    expect(JSON.parse(list.init.body)).toEqual({ prefix: '', limit: 1, offset: 0 })
    for (const c of fetch.calls) {
      expect(c.init.headers.authorization).toBe('Bearer tok')
      expect(c.init.headers.apikey).toBe('anon')
      expect(c.init.signal).toBeInstanceOf(AbortSignal)
    }
  })
  it('a storage that refuses (403) is "not answering for you", the database still answering: amber, not green', async () => {
    const fetch = fakeFetch((url) => (url.includes('/storage/v1/') ? res(403, {}) : res(200, [])))
    const r = await probeConnection('cloud', cloudDeps({ fetch }))
    expect(r.database).toEqual({ ok: true })
    expect(r.files).toEqual({ ok: false, why: 'refused', status: 403, place: FILES_PLACE.petal })
    expect(connectionView({ kind: 'cloud', result: r }).state).toBe('files')
  })
  it('a storage that does not answer within the ceiling is aborted and reads timeout', async () => {
    vi.useFakeTimers()
    try {
      let storageSignal = null
      const fetch = fakeFetch((url, init) => {
        if (url.includes('/storage/v1/')) { storageSignal = init.signal; return new Promise(() => {}) }
        return res(200, [])
      })
      const p = probeConnection('cloud', cloudDeps({ fetch }), { timeoutMs: 500 })
      await vi.advanceTimersByTimeAsync(500)
      const r = await p
      expect(r.database).toEqual({ ok: true })
      expect(r.files).toEqual({ ok: false, why: 'timeout' })
      expect(storageSignal.aborted).toBe(true)
    } finally { vi.useRealTimers() }
  })
  it('no network: both parts unreachable — red', async () => {
    const fetch = fakeFetch(() => new TypeError('Failed to fetch'))
    const r = await probeConnection('cloud', cloudDeps({ fetch }))
    expect(r.database).toEqual({ ok: false, why: 'unreachable' })
    expect(connectionView({ kind: 'cloud', result: r }).state).toBe('offline')
  })
  it('no token yet: nothing is fetched, both parts read "not signed in"', async () => {
    const fetch = fakeFetch(() => res(200, []))
    const r = await probeConnection('cloud', cloudDeps({ fetch, token: () => null }))
    expect(fetch).not.toHaveBeenCalled()
    expect(r.database).toEqual({ ok: false, why: 'signed-out' })
  })
  it('a storage choice that cannot be read is not guessed as Petal cloud: the files read "not known"', async () => {
    const fetch = fakeFetch((url) => (url.includes('workspace_storage') ? res(500, {}) : res(200, [])))
    const r = await probeConnection('cloud', cloudDeps({ fetch }))
    expect(r.files).toEqual({ ok: false, why: 'unknown' })
    expect(fetch.calls.some((c) => c.url.includes('/storage/v1/'))).toBe(false)
  })
  it('R1-3: a storage choice whose body cannot be read, or is cut off at the ceiling, is "not known" and is not remembered', async () => {
    const garbled = fakeFetch((url) => (url.includes('workspace_storage') ? { status: 200, ok: true, json: async () => { throw new SyntaxError('x') } } : res(200, [])))
    const deps = cloudDeps({ fetch: garbled })
    const r = await probeConnection('cloud', deps)
    expect(r.files).toEqual({ ok: false, why: 'unknown' })
    expect(deps.rememberStorageChoice).not.toHaveBeenCalled()
    vi.useFakeTimers()
    try {
      const slowBody = fakeFetch((url) => (url.includes('workspace_storage')
        ? { status: 200, ok: true, json: () => new Promise((resolve) => setTimeout(() => resolve([{ mode: 'central', provider: 'petal' }]), 10_000)) }
        : res(200, [])))
      const d2 = cloudDeps({ fetch: slowBody })
      const p = probeConnection('cloud', d2, { timeoutMs: 500 })
      await vi.advanceTimersByTimeAsync(500)
      expect((await p).files).toEqual({ ok: false, why: 'timeout' })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(d2.rememberStorageChoice).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
  it('R1-8: with a file of the open project on Petal cloud, the store is asked about that object (the HEAD supabase-js\'s exists() sends); without one, a list', async () => {
    const path = `projects/${PID}/files/a b/1-c.mov`
    const at = (status) => fakeFetch((url) => (url.includes('/storage/v1/object/rabbit-files/') ? res(status) : res(200, [])))
    const ok = at(200)
    expect((await probeConnection('cloud', cloudDeps({ fetch: ok, petalPath: () => path }))).files).toEqual({ ok: true, place: FILES_PLACE.petal })
    const call = ok.calls.find((c) => c.url.includes('/storage/v1/object/rabbit-files/'))
    expect(call.url).toBe(`https://db.example/storage/v1/object/rabbit-files/projects/${PID}/files/a%20b/1-c.mov`)
    expect(call.init.method).toBe('HEAD')
    expect(call.init.headers).toEqual({ apikey: 'anon', authorization: 'Bearer tok' })
    expect(ok.calls.some((c) => c.url.includes('/object/list/'))).toBe(false)
    // "Not found" answers (400 / 404) are the store answering; 401/403 refusing; 5xx failing.
    for (const [status, files] of [[400, { ok: true }], [404, { ok: true }], [403, { ok: false, why: 'refused', status: 403 }], [502, { ok: false, why: 'error', status: 502 }]]) {
      expect((await probeConnection('cloud', cloudDeps({ fetch: at(status), petalPath: () => path }))).files).toEqual({ ...files, place: FILES_PLACE.petal })
    }
  })
  it('the file read is never a money or Legal body, nor another project\'s, nor a removed one', () => {
    const f = (o) => ({ project_id: PID, storage_provider: 'supabase', storage_path: `projects/${PID}/files/x/1-a.pdf`, ...o })
    expect(petalProbePath({ files: [f({ is_financial: true })], projectId: PID })).toBeNull()
    expect(petalProbePath({ files: [f({ storage_path: `projects/${PID}/INVOICES/x/1-a.pdf` })], projectId: PID })).toBeNull()
    expect(petalProbePath({ files: [f({ storage_path: `projects/${PID}/legal/x/1-a.pdf` })], projectId: PID })).toBeNull()
    expect(petalProbePath({ files: [f({ project_id: 'other' })], projectId: PID })).toBeNull()
    expect(petalProbePath({ files: [f({ deleted_at: '2026-10-01' })], projectId: PID })).toBeNull()
    expect(petalProbePath({ files: [f({})], projectId: null })).toBeNull()
    expect(petalProbePath({ files: [f({ is_financial: true }), f({})], projectId: PID })).toBe(`projects/${PID}/files/x/1-a.pdf`)
    expect(bucketProbeKey({ files: [f({ storage_provider: 's3', storage_path: `projects/${PID}/FINANCE/x/1.pdf` })], projectId: PID }).real).toBe(false)
  })
  it('the storage choice is read once and remembered; a remembered choice is not read again', async () => {
    const fetch = fakeFetch((url) => (url.includes('workspace_storage') ? res(200, [{ mode: 'central', provider: 'petal' }]) : res(200, [])))
    const deps = cloudDeps({ fetch })
    await probeConnection('cloud', deps)
    expect(deps.rememberStorageChoice).toHaveBeenCalledWith({ mode: 'central', provider: 'petal' })
    const again = fakeFetch(() => res(200, []))
    await probeConnection('cloud', cloudDeps({ fetch: again, storageChoice: () => ({ mode: 'central', provider: 'petal' }) }))
    expect(again.calls.some((c) => c.url.includes('workspace_storage'))).toBe(false)
  })
})

describe('probeConnection: the company\'s own bucket, and a NAS', () => {
  const s3 = { mode: 'byos', provider: 's3' }
  it('asks the bucket for one object through the presign function — with the token and the signal, never getSession — and a 404 is the bucket answering', async () => {
    const presign = vi.fn(async () => ({ url: 'https://bucket.example/signed' }))
    const fetch = fakeFetch((url) => (url.startsWith('https://bucket.example') ? res(404) : res(200, [])))
    const r = await probeConnection('cloud', cloudDeps({ fetch, presign, storageChoice: () => s3, bucketKey: () => ({ path: `projects/${PID}/files/x/1-c.mov`, real: true }) }))
    expect(presign).toHaveBeenCalledTimes(1)
    const [op, key, opts] = presign.mock.calls[0]
    expect([op, key, opts.token]).toEqual(['head', `projects/${PID}/files/x/1-c.mov`, 'tok'])
    expect(opts.signal).toBeInstanceOf(AbortSignal)
    expect(fetch.calls.find((c) => c.url.startsWith('https://bucket.example')).init.method).toBe('HEAD')
    expect(r.files).toEqual({ ok: true, place: FILES_PLACE.s3 })
  })
  it('a bucket that refuses (403) is not connected; a presign refusal is "not answering for you"; a presign that failed otherwise is "not answering"', async () => {
    const presign = vi.fn(async () => ({ url: 'https://bucket.example/signed' }))
    const fetch = fakeFetch((url) => (url.startsWith('https://bucket.example') ? res(403) : res(200, [])))
    const r = await probeConnection('cloud', cloudDeps({ fetch, presign, storageChoice: () => s3, bucketKey: () => ({ path: 'projects/p/x/y', real: true }) }))
    expect(r.files).toMatchObject({ ok: false, why: 'refused', place: FILES_PLACE.s3 })
    const refusing = vi.fn(async () => { throw Object.assign(new Error('[s3] you cannot presign for this project'), { status: 403 }) })
    expect((await probeConnection('cloud', cloudDeps({ fetch, presign: refusing, storageChoice: () => s3, bucketKey: () => ({ path: 'projects/p/x/y', real: true }) }))).files)
      .toEqual({ ok: false, why: 'refused', place: FILES_PLACE.s3 })
    const down = vi.fn(async () => { throw Object.assign(new Error('[s3] Network error'), { status: 0 }) })
    expect((await probeConnection('cloud', cloudDeps({ fetch, presign: down, storageChoice: () => s3, bucketKey: () => ({ path: 'projects/p/x/y', real: true }) }))).files)
      .toEqual({ ok: false, why: 'error', place: FILES_PLACE.s3 })
  })
  it('R1-1: a key nobody writes answered 403 (a bucket key without ListBucket, the handbook\'s own setup) is unchecked — never amber, never announced; a 404 there is the bucket answering', async () => {
    const presign = vi.fn(async () => ({ url: 'https://bucket.example/signed' }))
    const synthetic = { path: `projects/${PID}/connection-check/wilson-connection-check`, real: false }
    const bucket = (status) => fakeFetch((url) => (url.startsWith('https://bucket.example') ? res(status) : res(200, [])))
    const at403 = await probeConnection('cloud', cloudDeps({ fetch: bucket(403), presign, storageChoice: () => s3, bucketKey: () => synthetic }))
    expect(at403.files).toEqual({ ok: null, why: 'no-file', place: FILES_PLACE.s3 })
    const v = connectionView({ kind: 'cloud', result: at403 })
    expect(v.state).toBe('unchecked')
    expect(v.tone).toBe('neutral')
    expect(isSettled(v.state)).toBe(false)
    expect(v.words).toBe("Database: connected · Files: your company's own bucket, checked once this project has a file there")
    const at404 = await probeConnection('cloud', cloudDeps({ fetch: bucket(404), presign, storageChoice: () => s3, bucketKey: () => synthetic }))
    expect(at404.files).toEqual({ ok: true, place: FILES_PLACE.s3 })
    // A real file answered 403 IS the bucket refusing: amber.
    const real403 = await probeConnection('cloud', cloudDeps({ fetch: bucket(403), presign, storageChoice: () => s3, bucketKey: () => ({ path: `projects/${PID}/files/x/1-c.mov`, real: true }) }))
    expect(real403.files).toMatchObject({ ok: false, why: 'refused' })
    // A key nobody writes, refused by the presign function itself: still amber.
    const refusing = vi.fn(async () => { throw Object.assign(new Error('[s3] you cannot presign for this project'), { status: 403 }) })
    expect((await probeConnection('cloud', cloudDeps({ fetch: bucket(404), presign: refusing, storageChoice: () => s3, bucketKey: () => synthetic }))).files)
      .toEqual({ ok: false, why: 'refused', place: FILES_PLACE.s3 })
  })
  it('with no project to ask about, the bucket is not asked and the files are unchecked (neither green nor amber)', async () => {
    const presign = vi.fn()
    const fetch = fakeFetch(() => res(200, []))
    const r = await probeConnection('cloud', cloudDeps({ fetch, presign, storageChoice: () => s3, bucketKey: () => null }))
    expect(presign).not.toHaveBeenCalled()
    expect(r.files).toEqual({ ok: null, why: 'no-project', place: FILES_PLACE.s3 })
    expect(connectionView({ kind: 'cloud', result: r }).state).toBe('unchecked')
  })
  it('a central workspace that kept an S3 config is on Petal cloud (activeWorkspaceProvider): the bucket is not asked', async () => {
    const presign = vi.fn()
    const fetch = fakeFetch(() => res(200, []))
    const r = await probeConnection('cloud', cloudDeps({ fetch, presign, storageChoice: () => ({ mode: 'central', provider: 's3' }) }))
    expect(presign).not.toHaveBeenCalled()
    expect(r.files.place).toBe(FILES_PLACE.petal)
  })
  it('a NAS: a browser cannot reach one (amber, said so); the desktop asks its own route and reads the files root only when it is the company\'s', async () => {
    const nas = { mode: 'byos', provider: 'network' }
    const fetch = fakeFetch(() => res(200, []))
    const browser = await probeConnection('cloud', cloudDeps({ fetch, storageChoice: () => nas }))
    expect(browser.files).toEqual({ ok: false, why: 'not-here', place: FILES_PLACE.network })
    const route = (files) => fakeFetch((url) => (url === LOCAL_CONNECTION_ROUTE ? res(200, { data: { ok: true }, files }) : res(404)))
    const up = await probeConnection('cloud', cloudDeps({ fetch, desktop: true, localFetch: route({ ok: true, kind: 'workspace' }), storageChoice: () => nas }))
    expect(up.files).toEqual({ ok: true, place: FILES_PLACE.network })
    const down = await probeConnection('cloud', cloudDeps({ fetch, desktop: true, localFetch: route({ ok: false, why: 'timeout', kind: 'workspace' }), storageChoice: () => nas }))
    expect(down.files).toEqual({ ok: false, why: 'timeout', place: FILES_PLACE.network })
    const notYet = await probeConnection('cloud', cloudDeps({ fetch, desktop: true, localFetch: route({ ok: true, kind: 'machine' }), storageChoice: () => nas }))
    expect(notYet.files).toEqual({ ok: false, why: 'not-set', place: FILES_PLACE.network })
  })
})

describe('probeConnection: the Local Server, the fixtures, Google Drive', () => {
  it('the Local Server: one GET of its own route; the database is its data folder, the files its files root, named by kind', async () => {
    const localFetch = fakeFetch(() => res(200, { data: { ok: true }, files: { ok: true, kind: 'workspace' } }))
    const r = await probeConnection('local', { localFetch })
    expect(localFetch.calls).toHaveLength(1)
    expect(localFetch.calls[0].url).toBe(LOCAL_CONNECTION_ROUTE)
    expect(localFetch.calls[0].init.signal).toBeInstanceOf(AbortSignal)
    expect(r).toEqual({ database: { ok: true }, files: { ok: true, place: FILES_PLACE.network } })
    const nasDown = await probeConnection('local', { localFetch: fakeFetch(() => res(200, { data: { ok: true }, files: { ok: false, why: 'timeout', kind: 'workspace' } })) })
    expect(connectionView({ kind: 'local', result: nasDown })).toMatchObject({ state: 'files', tone: 'warning' })
    const demo = await probeConnection('local', { localFetch: fakeFetch(() => res(200, { data: { ok: true }, files: { ok: true, kind: 'demo' } })) })
    expect(demo.files.place).toBe(FILES_PLACE.demo)
  })
  it('the Local Server unreachable, refusing (401) or without its demo folder (503) is red, both parts', async () => {
    for (const [answer, why] of [[new TypeError('Failed to fetch'), 'unreachable'], [res(401, {}), 'refused'], [res(503, {}), 'unavailable']]) {
      const r = await probeConnection('local', { localFetch: fakeFetch(() => answer) })
      expect(r.database).toEqual({ ok: false, why })
      expect(r.files).toEqual({ ok: false, why })
      expect(connectionView({ kind: 'local', result: r }).state).toBe('offline')
    }
  })
  it('a malformed answer from the route is not read as connected', async () => {
    const r = await probeConnection('local', { localFetch: fakeFetch(() => res(200, { data: { ok: 'yes' } })) })
    expect(r.database.ok).toBe(false)
  })
  it('the fixtures answer from their own seam, all three colours', async () => {
    const at = async (answer) => connectionView({ kind: 'fixtures', result: await probeConnection('fixtures', { adapter: { connectionProbe: async () => answer } }) }).state
    expect(await at({ database: true, files: true })).toBe('connected')
    expect(await at({ database: true, files: false })).toBe('files')
    expect(await at({ database: false, files: false })).toBe('offline')
    expect(await at(null)).toBe('offline')
  })
  it('Google Drive: the adapter\'s own probe of its root folder answers both parts', async () => {
    const r = await probeConnection('drive', { adapter: { status: async () => ({ online: true }) } })
    expect(r).toEqual({ database: { ok: true }, files: { ok: true, place: FILES_PLACE.drive } })
    const off = await probeConnection('drive', { adapter: { status: async () => ({ online: false }) } })
    expect(off.database.ok).toBe(false)
    // R1-10: the adapter's own reason is kept.
    const signedOut = await probeConnection('drive', { adapter: { status: async () => ({ online: false, error: 'not signed in' }) } })
    expect(signedOut.database).toEqual({ ok: false, why: 'signed-out' })
  })
  it('no backend: nothing is asked', async () => {
    await expect(probeConnection(null, {})).resolves.toEqual({ database: null, files: null })
  })
})

describe('connectionView: three colours, each part in words', () => {
  const answered = (database, files) => ({ database, files })
  it('green: "Database: connected · Files: Petal cloud, connected · Live updates: on" — the brief\'s own words', () => {
    const v = connectionView({ kind: 'cloud', result: answered({ ok: true }, { ok: true, place: FILES_PLACE.petal }), realtimeStatus: 'live', projectOpen: true })
    expect(v).toEqual({ state: 'connected', tone: 'success', words: 'Database: connected · Files: Petal cloud, connected · Live updates: on', summary: 'Everything is connected' })
  })
  it('amber: the database answers and the files do not, the place named', () => {
    const v = connectionView({ kind: 'cloud', result: answered({ ok: true }, { ok: false, why: 'refused', place: FILES_PLACE.s3 }), realtimeStatus: 'live', projectOpen: true })
    expect(v.state).toBe('files')
    expect(v.tone).toBe('warning')
    expect(v.words).toBe("Database: connected · Files: your company's own bucket, not answering for you · Live updates: on")
    expect(v.summary).toMatch(/files are not answering \(your company's own bucket\); the database is connected/)
  })
  it('red: the database does not answer, whatever the files say', () => {
    const v = connectionView({ kind: 'cloud', result: answered({ ok: false, why: 'timeout' }, { ok: true, place: FILES_PLACE.petal }) })
    expect(v).toMatchObject({ state: 'offline', tone: 'danger' })
    expect(v.words).toBe('Database: not answering · Files: Petal cloud, connected')
  })
  it('the browser offline answers for the cloud at once, before any probe; the Local Server is not asked about the network', () => {
    const cloud = connectionView({ kind: 'cloud', result: answered({ ok: true }, { ok: true, place: FILES_PLACE.petal }), browserOffline: true })
    expect(cloud.state).toBe('offline')
    expect(cloud.words).toBe('Database: no network · Files: Petal cloud, no network')
    const local = connectionView({ kind: 'local', result: answered({ ok: true }, { ok: true, place: FILES_PLACE.app }), browserOffline: true })
    expect(local.state).toBe('connected')
  })
  it('red says why in its one sentence: no network, not signed in, the Local Server, or not answering', () => {
    const red = (kind, database) => connectionView({ kind, result: answered(database, { ok: false, why: 'unreachable' }) }).summary
    expect(connectionView({ kind: 'cloud', browserOffline: true }).summary).toBe('Offline: no network')
    expect(red('cloud', { ok: false, why: 'signed-out' })).toBe('Not signed in: the database does not answer')
    expect(red('local', { ok: false, why: 'unreachable' })).toBe('The Local Server is not answering')
    expect(red('cloud', { ok: false, why: 'timeout' })).toBe('Offline: the database is not answering')
  })
  it('before the first answer: neutral, "checking", never green', () => {
    expect(connectionView({ kind: 'cloud' })).toMatchObject({ state: 'checking', tone: 'neutral', words: 'Database: checking · Files: checking' })
  })
  it('the Local Server names itself and says live updates are off; the cloud says live updates only with a project open', () => {
    const local = connectionView({ kind: 'local', result: answered({ ok: true }, { ok: true, place: FILES_PLACE.demo }) })
    expect(local.words).toBe('Database: the Local Server, connected · Files: the open demo folder, connected · Live updates: off')
    expect(connectionView({ kind: 'cloud', result: answered({ ok: true }, { ok: true, place: FILES_PLACE.petal }), realtimeStatus: 'off', projectOpen: false }).words)
      .toBe('Database: connected · Files: Petal cloud, connected')
    expect(connectionView({ kind: 'cloud', result: answered({ ok: true }, { ok: true, place: FILES_PLACE.petal }), realtimeStatus: 'error', projectOpen: true }).words)
      .toMatch(/Live updates: reconnecting$/)
    expect(connectionView({ kind: 'cloud', result: answered({ ok: true }, { ok: true, place: FILES_PLACE.petal }), realtimeStatus: 'connecting', projectOpen: true }).words)
      .toMatch(/Live updates: connecting$/)
  })
  it('the dot is never green unless BOTH parts answered (the property, every combination)', () => {
    const answers = [null, { ok: true }, { ok: false, why: 'timeout' }, { ok: false, why: 'refused' }, { ok: null, why: 'no-project' }]
    for (const kind of ['cloud', 'local', 'drive', 'fixtures']) {
      for (const database of answers) {
        for (const files of answers) {
          for (const browserOffline of [false, true]) {
            const v = connectionView({ kind, result: { database, files }, browserOffline })
            const remoteOffline = browserOffline && (kind === 'cloud' || kind === 'drive')
            const green = database?.ok === true && files?.ok === true && !remoteOffline
            expect(v.state === 'connected', JSON.stringify({ kind, database, files, browserOffline })).toBe(green)
            expect(v.tone === 'success').toBe(green)
            if (database && database.ok !== true) expect(v.state).toBe('offline')
          }
        }
      }
    }
  })
  it('settled states are the three colours only', () => {
    expect(['connected', 'files', 'offline'].every(isSettled)).toBe(true)
    expect(['checking', 'unchecked', 'none'].some(isSettled)).toBe(false)
  })
  it('no backend: neutral and says so', () => {
    expect(connectionView({ kind: null })).toMatchObject({ state: 'none', tone: 'neutral', words: 'No backend is set up' })
  })
})

describe('rule 3: the probe never reaches auth-js', () => {
  it('the module imports no Supabase client and calls no getSession / supabase-js storage', () => {
    const src = readFileSync(join(here, 'connectionStatus.js'), 'utf8')
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    expect(code).not.toMatch(/supabaseClient|@supabase|getSession|\.auth\.|\.storage\.from\(/)
    expect(code).not.toMatch(/withTimeout/)
  })
})
