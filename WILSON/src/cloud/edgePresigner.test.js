// =============================================================================
// edgePresigner.test.js — F8 (wave 2, 2026-11-13), step (f), the review's C5.
//
// makeS3Presigner (supabase/functions/_shared/s3Presign.ts) derives the SigV4
// signing key once per UTC day and region for one bucket, instead of once a
// URL. Not one signature byte may move, so every URL it makes is compared with
// presignS3Request (itself pinned to AWS's published example in
// src/tools/rabbit_v0.1.0/storage/s3Presign.test.js) for the same input. And
// the cache must not ignore the day: ONE presigner signing at 23:59:59 UTC
// and at 00:00:00 the next day must match presignS3Request for each instant.
// Every secret here is made up in this file.
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { presignS3Request, makeS3Presigner } from '../../supabase/functions/_shared/s3Presign.ts'

afterEach(() => { vi.restoreAllMocks() })

const SECRET = 'test-secret/with+odd=chars é'
const TARGETS = [
  ['AWS, virtual-host', { region: 'us-east-1', bucket: 'wilson-media' }],
  ['a custom endpoint (path style by default)', { endpoint: 'https://s3.us-west-004.backblazeb2.com', region: 'us-west-004', bucket: 'b2-bucket' }],
  ['AWS, path style forced', { region: 'eu-west-2', bucket: 'media', forcePathStyle: true }],
  ['a custom endpoint, virtual-host forced', { endpoint: 'https://minio.example.com:9000', region: 'us-east-1', bucket: 'v', forcePathStyle: false }],
]
const KEYS = ['projects/p/files/a.mov', 'with space/and (parens)/x*y!.exr', 'unicodé/ファイル.png', 'render..v2.mov', 'a/b/c/d/e/f.txt']
const SHAPES = [['GET', 300], ['PUT', 900], ['DELETE', 60], ['HEAD', 604800]]

const hmacSigns = () => {
  const spy = vi.spyOn(globalThis.crypto.subtle, 'sign')
  return () => spy.mock.calls.filter((c) => (c[0]?.name ?? c[0]) === 'HMAC').length
}

describe('makeS3Presigner: byte for byte presignS3Request (F8 f)', () => {
  it.each(TARGETS)('%s: every key, method and expiry', async (_, target) => {
    const now = new Date('2026-11-13T12:34:56.789Z')
    const p = makeS3Presigner({ target, accessKeyId: 'AKIDEXAMPLE', secretAccessKey: SECRET })
    for (const key of KEYS) {
      for (const [method, expiresSeconds] of SHAPES) {
        const want = await presignS3Request({ target, accessKeyId: 'AKIDEXAMPLE', secretAccessKey: SECRET, method, key, expiresSeconds, now })
        expect(await p.presign({ method, key, expiresSeconds, now }), `${method} ${key}`).toBe(want)
      }
    }
  })

  it('🚨 ONE presigner across midnight UTC: 23:59:59 and 00:00:00 the next day each sign under their own day', async () => {
    const target = TARGETS[0][1]
    const bucket = { target, accessKeyId: 'AKIDEXAMPLE', secretAccessKey: SECRET }
    const p = makeS3Presigner(bucket)
    for (const iso of ['2026-11-13T23:59:59.000Z', '2026-11-14T00:00:00.000Z', '2026-11-13T23:59:59.999Z']) {
      const now = new Date(iso)
      const want = await presignS3Request({ ...bucket, method: 'GET', key: 'k/a.exr', expiresSeconds: 300, now })
      expect(await p.presign({ method: 'GET', key: 'k/a.exr', expiresSeconds: 300, now }), iso).toBe(want)
    }
    // And the two days really are different signatures (the test can tell).
    const a = await p.presign({ method: 'GET', key: 'k/a.exr', expiresSeconds: 300, now: new Date('2026-11-13T23:59:59.000Z') })
    const b = await p.presign({ method: 'GET', key: 'k/a.exr', expiresSeconds: 300, now: new Date('2026-11-14T00:00:00.000Z') })
    expect(a.split('X-Amz-Signature=')[1]).not.toBe(b.split('X-Amz-Signature=')[1])
  })

  it('the work: four HMACs to derive once, then one a URL; a second day derives again; presignS3Request still five a URL', async () => {
    const target = TARGETS[1][1]
    const bucket = { target, accessKeyId: 'AKIDEXAMPLE', secretAccessKey: SECRET }
    const count = hmacSigns()
    const p = makeS3Presigner(bucket)
    const day1 = new Date('2026-11-13T10:00:00Z')
    for (let i = 0; i < 100; i++) await p.presign({ method: 'GET', key: `k/${i}.exr`, expiresSeconds: 300, now: day1 })
    expect(count()).toBe(104)
    await p.presign({ method: 'GET', key: 'k/x.exr', expiresSeconds: 300, now: new Date('2026-11-14T10:00:00Z') })
    expect(count()).toBe(104 + 5)
    await presignS3Request({ ...bucket, method: 'GET', key: 'k/y.exr', expiresSeconds: 300, now: day1 })
    expect(count()).toBe(104 + 5 + 5)
  })

  it('two presigners share nothing: each derives its own key (nothing kept between requests or companies)', async () => {
    const count = hmacSigns()
    const now = new Date('2026-11-13T10:00:00Z')
    const a = makeS3Presigner({ target: TARGETS[0][1], accessKeyId: 'AKIDA', secretAccessKey: 'secret-a' })
    const b = makeS3Presigner({ target: TARGETS[0][1], accessKeyId: 'AKIDB', secretAccessKey: 'secret-b' })
    await a.presign({ method: 'GET', key: 'k', expiresSeconds: 60, now })
    await b.presign({ method: 'GET', key: 'k', expiresSeconds: 60, now })
    expect(count()).toBe(10)
    const want = await presignS3Request({ target: TARGETS[0][1], accessKeyId: 'AKIDB', secretAccessKey: 'secret-b', method: 'GET', key: 'k', expiresSeconds: 60, now })
    expect(await b.presign({ method: 'GET', key: 'k', expiresSeconds: 60, now })).toBe(want)
  })

  it('a derivation that failed is not kept: the next URL derives again and is right', async () => {
    const target = TARGETS[0][1]
    const bucket = { target, accessKeyId: 'AKIDEXAMPLE', secretAccessKey: SECRET }
    const p = makeS3Presigner(bucket)
    const now = new Date('2026-11-13T10:00:00Z')
    const real = globalThis.crypto.subtle.sign.bind(globalThis.crypto.subtle)
    const spy = vi.spyOn(globalThis.crypto.subtle, 'sign').mockImplementationOnce(async () => { throw new Error('derivation failed') })
    await expect(p.presign({ method: 'GET', key: 'k/a', expiresSeconds: 60, now })).rejects.toThrow('derivation failed')
    spy.mockImplementation(real)
    await new Promise((r) => setTimeout(r, 0))
    const before = spy.mock.calls.length
    const want = await presignS3Request({ ...bucket, method: 'GET', key: 'k/a', expiresSeconds: 60, now })
    const afterDirect = spy.mock.calls.length
    expect(await p.presign({ method: 'GET', key: 'k/a', expiresSeconds: 60, now })).toBe(want)
    expect(spy.mock.calls.length - afterDirect).toBe(5) // derived again (4) and signed (1)
    expect(afterDirect - before).toBe(5)
  })

  it('the refusals keep their words', async () => {
    const p = makeS3Presigner({ target: TARGETS[0][1], accessKeyId: 'A', secretAccessKey: 'S' })
    const now = new Date()
    await expect(p.presign({ method: 'GET', key: '../x', expiresSeconds: 60, now })).rejects.toThrow('refusing to presign a non-canonical key: ../x')
    await expect(p.presign({ method: 'GET', key: 'x', expiresSeconds: 0, now })).rejects.toThrow('presign expiry out of range: 0')
    const bad = makeS3Presigner({ target: { endpoint: 'http://plain.example.com', region: 'r', bucket: 'b' }, accessKeyId: 'A', secretAccessKey: 'S' })
    await expect(bad.presign({ method: 'GET', key: 'x', expiresSeconds: 60, now })).rejects.toThrow(/must be https/)
  })
})
