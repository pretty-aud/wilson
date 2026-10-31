// =============================================================================
// s3Provider.test.js — Session 37.
//
// The S3 provider's contract behaviour with the presign and fetch layers
// faked: every operation presigns first, every HTTP refusal THROWS (the
// otterFetch trap's antidote), and a browser-blocked fetch — the shape a
// missing CORS rule produces — throws a sentence that names CORS and where
// the fix is written down, because that failure otherwise surfaces as a bare
// "TypeError: Failed to fetch" with no status and no server log.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createS3StorageProvider, clearS3ReadUrlCache, S3_READ_BATCH, S3_READ_FOLDERS, S3_READ_RENEW_MARGIN_MS } from './s3Provider'

const KEY = 'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/1-dailies.mov'

function makeProvider({ presignCalls = [], responses = [] } = {}) {
  const presign = vi.fn(async (op, path) => {
    presignCalls.push([op, path])
    return { url: `https://signed.example/${op}`, method: op.toUpperCase() }
  })
  const provider = createS3StorageProvider(presign)
  return { provider, presign }
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
afterEach(() => { vi.unstubAllGlobals() })

describe('put', () => {
  it('presigns then PUTs the body to the signed URL', async () => {
    const presignCalls = []
    const { provider } = makeProvider({ presignCalls })
    fetch.mockResolvedValueOnce({ ok: true, status: 200 })
    const body = new Blob(['x'], { type: 'video/quicktime' })
    await expect(provider.put(KEY, body)).resolves.toEqual({ key: KEY })
    expect(presignCalls).toEqual([['put', KEY]])
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://signed.example/put')
    expect(init.method).toBe('PUT')
    expect(init.body).toBe(body)
  })

  it('throws on an HTTP refusal instead of resolving (the otterFetch trap)', async () => {
    const { provider } = makeProvider()
    fetch.mockResolvedValueOnce({ ok: false, status: 403 })
    await expect(provider.put(KEY, new Blob(['x']))).rejects.toThrow(/refused it \(HTTP 403\)/)
  })

  it('names CORS and §12.7 when the browser blocks the request outright', async () => {
    const { provider } = makeProvider()
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(provider.put(KEY, new Blob(['x']))).rejects.toThrow(/CORS rule.*§12\.7/s)
  })

  it('propagates a presign refusal verbatim — the server sentence is the message', async () => {
    const presign = vi.fn(async () => {
      throw new Error('[s3] money-gated files never leave Supabase — this path cannot be presigned')
    })
    const provider = createS3StorageProvider(presign)
    await expect(provider.put(KEY, new Blob(['x']))).rejects.toThrow(/money-gated files never leave Supabase/)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('get', () => {
  it('presigns then downloads, returning the blob', async () => {
    const presignCalls = []
    const { provider } = makeProvider({ presignCalls })
    const blob = new Blob(['bytes'])
    fetch.mockResolvedValueOnce({ ok: true, status: 200, blob: async () => blob })
    await expect(provider.get(KEY)).resolves.toBe(blob)
    expect(presignCalls).toEqual([['get', KEY]])
  })

  it('a 404 says the object is GONE, not that the download "failed"', async () => {
    const { provider } = makeProvider()
    fetch.mockResolvedValueOnce({ ok: false, status: 404 })
    await expect(provider.get(KEY)).rejects.toThrow(/gone from the bucket/)
  })
})

describe('del', () => {
  it('a 2xx is success — S3 DELETE is idempotent for an absent KEY', async () => {
    const { provider } = makeProvider()
    fetch.mockResolvedValueOnce({ ok: true, status: 204 })
    await expect(provider.del(KEY)).resolves.toBeUndefined()
  })

  // 🚨 404 IS NOT "already gone". An absent key returns 204; a 404 means the
  // BUCKET did not resolve — renamed, wrong endpoint, wrong addressing style.
  // This used to be tolerated, which let storage-gc stamp a TPN-CONT-002
  // disposal certificate on a body still sitting in the customer's bucket
  // (S37 adversarial review).
  it('throws on 404 — that is the BUCKET missing, not the object', async () => {
    const { provider } = makeProvider()
    fetch.mockResolvedValueOnce({ ok: false, status: 404 })
    await expect(provider.del(KEY)).rejects.toThrow(/bucket did not resolve/)
  })

  it('throws on a real refusal', async () => {
    const { provider } = makeProvider()
    fetch.mockResolvedValueOnce({ ok: false, status: 403 })
    await expect(provider.del(KEY)).rejects.toThrow(/HTTP 403/)
  })
})

describe('exists', () => {
  it('200 → true, 404 → false', async () => {
    const { provider } = makeProvider()
    fetch.mockResolvedValueOnce({ ok: true, status: 200 })
    await expect(provider.exists(KEY)).resolves.toBe(true)
    fetch.mockResolvedValueOnce({ ok: false, status: 404 })
    await expect(provider.exists(KEY)).resolves.toBe(false)
  })

  it('anything else THROWS — a false "missing" is how a GC deletes a body it could not see', async () => {
    const { provider } = makeProvider()
    fetch.mockResolvedValueOnce({ ok: false, status: 500 })
    await expect(provider.exists(KEY)).rejects.toThrow(/HTTP 500/)
  })
})

describe('the contract', () => {
  it('exposes all four functions plus describe', async () => {
    const { provider } = makeProvider()
    for (const fn of ['put', 'get', 'del', 'exists', 'describe']) {
      expect(typeof provider[fn]).toBe('function')
    }
    const d = await provider.describe()
    expect(d.provider).toBe('s3')
    expect(d.configurable).toBe(true)
  })
})

// =============================================================================
// P1 (night 4): reading for display — getUrl (a preview, a player) and
// getUrls (a panel's thumbnails) through storage-read-urls, faked here as
// `presignReads`. NETWORK_STORAGE_DESIGN.md §9.3.
// =============================================================================

const P1 = 'aaaa1111-0000-0000-0000-000000000001'
const P2 = 'bbbb2222-0000-0000-0000-000000000002'
const thumb = (n, p = P1) => `projects/${p}/assets/a1/1754612345678-f${n}.png.jpg`

function reader({ refuse = {}, expires = 3600, fail = false } = {}) {
  const calls = []
  const presignReads = vi.fn(async (keys, opts) => {
    calls.push({ keys: [...keys], opts })
    if (fail) throw Object.assign(new Error('[s3] the preview addresses could not be signed (500)'), { status: 500 })
    const urls = {}
    const exp = {}
    const refused = {}
    for (const k of keys) {
      if (refuse[k]) refused[k] = refuse[k]
      else { urls[k] = `https://bucket.example/${k}?sig=${calls.length}`; exp[k] = expires }
    }
    return { urls, expires: exp, refused }
  })
  return { presignReads, calls }
}

describe('getUrl — one key, signed fresh (P1)', () => {
  beforeEach(() => clearS3ReadUrlCache())

  it('a preview stage reads once (no stream flag); a player asks for the stream', async () => {
    const { presignReads, calls } = reader()
    const provider = createS3StorageProvider(vi.fn(), presignReads)
    await expect(provider.getUrl(KEY, 3600)).resolves.toMatch(/^https:\/\/bucket\.example\//)
    await provider.getUrl(KEY, 3600, { stream: true })
    expect(calls.map((c) => [c.keys, c.opts])).toEqual([[[KEY], { stream: false }], [[KEY], { stream: true }]])
  })

  it('is never served from the cache: a player\'s hour starts when the player starts', async () => {
    const { presignReads, calls } = reader()
    const provider = createS3StorageProvider(vi.fn(), presignReads)
    await provider.getUrl(KEY, 3600, { stream: true })
    await provider.getUrl(KEY, 3600, { stream: true })
    expect(calls).toHaveLength(2)
  })

  it('a refused key throws its reason in words, never the key', async () => {
    const { presignReads } = reader({ refuse: { [KEY]: 'row' } })
    const provider = createS3StorageProvider(vi.fn(), presignReads)
    const err = await provider.getUrl(KEY, 3600).catch((e) => e)
    expect(err.message).toMatch(/^\[s3\] this file is not one you can open any more$/)
    expect(err.message).not.toContain('dailies')
  })

  it('{ download } answers null and asks nothing: downloads keep the Blob path through storage-presign', async () => {
    const { presignReads } = reader()
    const provider = createS3StorageProvider(vi.fn(), presignReads)
    await expect(provider.getUrl(KEY, 300, { download: 'dailies.mov' })).resolves.toBeNull()
    expect(presignReads).not.toHaveBeenCalled()
  })

  it('without a read signer there is no display: null and an empty map, never a throw', async () => {
    const provider = createS3StorageProvider(vi.fn())
    await expect(provider.getUrl(KEY, 3600)).resolves.toBeNull()
    await expect(provider.getUrls([thumb(1)])).resolves.toEqual(new Map())
  })
})

describe('getUrls — a panel\'s thumbnails, batched and cached (P1)', () => {
  beforeEach(() => clearS3ReadUrlCache())

  it('batches: one call per project, at most S3_READ_BATCH keys each, in the order the keys came', async () => {
    const { presignReads, calls } = reader()
    const provider = createS3StorageProvider(vi.fn(), presignReads)
    const keys = [...Array.from({ length: 130 }, (_, i) => thumb(i)), thumb(1, P2)]
    const map = await provider.getUrls(keys)
    expect(map.size).toBe(131)
    expect(calls.map((c) => c.keys.length)).toEqual([S3_READ_BATCH, 30, 1])
    expect(calls[2].keys).toEqual([thumb(1, P2)])
    expect(calls[0].keys[0]).toBe(thumb(0))
  })

  it('at most S3_READ_FOLDERS folders a call: the signer reads its rows one folder at a time (round 1)', async () => {
    const { presignReads, calls } = reader()
    const provider = createS3StorageProvider(vi.fn(), presignReads)
    const keys = Array.from({ length: 12 }, (_, i) => `projects/${P1}/assets/a${i}/1754612345678-f.png.jpg`)
    await provider.getUrls(keys)
    expect(calls.map((c) => new Set(c.keys.map((k) => k.slice(0, k.lastIndexOf('/')))).size)).toEqual([S3_READ_FOLDERS, 2])
  })

  it('a refused key has no URL — its tile is the file-type icon', async () => {
    const { presignReads } = reader({ refuse: { [thumb(2)]: 'row' } })
    const provider = createS3StorageProvider(vi.fn(), presignReads)
    const map = await provider.getUrls([thumb(1), thumb(2), thumb(3)])
    expect([...map.keys()]).toEqual([thumb(1), thumb(3)])
  })

  it('🚨 never asks the signer for a money key', async () => {
    const { presignReads, calls } = reader()
    const provider = createS3StorageProvider(vi.fn(), presignReads)
    const money = [`projects/${P1}/INVOICES/x/1-a.pdf.jpg`, `projects/${P1}/legal/x/1-c.pdf.jpg`, `projects/${P1}/Finance/RATES.json`]
    const map = await provider.getUrls([...money, thumb(1)])
    expect(calls.flatMap((c) => c.keys)).toEqual([thumb(1)])
    expect(map.has(money[0])).toBe(false)
  })

  it('serves a cached URL while more than the renewal margin is left, and RENEWS it before it expires', async () => {
    let t = 1_000_000
    const { presignReads, calls } = reader({ expires: 3600 })
    const provider = createS3StorageProvider(vi.fn(), presignReads, { now: () => t })
    const first = (await provider.getUrls([thumb(1)])).get(thumb(1))
    t += 49 * 60 * 1000 // 11 minutes left: still handed out
    expect((await provider.getUrls([thumb(1)])).get(thumb(1))).toBe(first)
    expect(calls).toHaveLength(1)
    t += 60 * 1000 // 10 minutes left: renewed, before the hour is up
    const renewed = (await provider.getUrls([thumb(1)])).get(thumb(1))
    expect(calls).toHaveLength(2)
    expect(renewed).not.toBe(first)
    expect(S3_READ_RENEW_MARGIN_MS).toBe(10 * 60 * 1000)
  })

  it('a URL\'s life is counted from when its call was SENT, on this clock', async () => {
    let t = 0
    const presignReads = vi.fn(async (keys) => {
      t += 5 * 60 * 1000 // a slow answer
      return { urls: Object.fromEntries(keys.map((k) => [k, `u-${k}`])), expires: Object.fromEntries(keys.map((k) => [k, 900])), refused: {} }
    })
    const provider = createS3StorageProvider(vi.fn(), presignReads, { now: () => t })
    await provider.getUrls([thumb(1)])
    // 6 min 40 s after the send: 8 min 20 s left counted from the SEND (under
    // the margin: renewed), 13 min 20 s if it were counted from the answer.
    t = 400_000
    await provider.getUrls([thumb(1)])
    expect(presignReads).toHaveBeenCalledTimes(2)
  })

  it('🚨 a clear while a call is in flight: its answer is handed back but never refills the cache', async () => {
    let release
    const gate = new Promise((r) => { release = r })
    const presignReads = vi.fn(async (keys) => {
      await gate
      return { urls: Object.fromEntries(keys.map((k) => [k, `u-${k}`])), expires: Object.fromEntries(keys.map((k) => [k, 3600])), refused: {} }
    })
    const provider = createS3StorageProvider(vi.fn(), presignReads)
    const pending = provider.getUrls([thumb(1)])
    clearS3ReadUrlCache() // the person signed out
    release()
    await pending
    await provider.getUrls([thumb(1)])
    expect(presignReads).toHaveBeenCalledTimes(2)
  })

  it('a call that fails throws (RabbitProvider.thumbnailUrls keeps the panel standing)', async () => {
    const { presignReads } = reader({ fail: true })
    const provider = createS3StorageProvider(vi.fn(), presignReads)
    await expect(provider.getUrls([thumb(1)])).rejects.toThrow(/could not be signed/)
  })

  it('App.jsx clears the cache whenever the person or the workspace changes', () => {
    const app = readFileSync(join(process.cwd(), 'src', 'App.jsx'), 'utf8')
    expect(app).toMatch(/clearS3ReadUrlCache\(\);\s*\}, \[perms\.ready, perms\.userId, perms\.workspaceId\]\)/)
  })
})
