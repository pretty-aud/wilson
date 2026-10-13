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
import { createS3StorageProvider } from './s3Provider'

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
