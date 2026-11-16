// =============================================================================
// s3Look.test.js — MO1 (0120): every answer of the server's look at a move's new
// copy in a company's own bucket. The steps are injected
// (supabase/functions/_shared/s3Look.ts, imported across the Deno/Node boundary
// as s3Reach.test.js does). Suite 123 is the database's half.
// =============================================================================
import { describe, it, expect, vi } from 'vitest'
import { lookAtObject } from '../../supabase/functions/_shared/s3Look.ts'

const VETTED = { ok: true, hostname: 'bucket.example.com', port: 443, address: '93.184.216.34', literal: false }

function steps(over = {}) {
  return {
    host: vi.fn(() => 'bucket.example.com'),
    vet: vi.fn(async () => VETTED),
    sign: vi.fn(async () => 'https://bucket.example.com/key?sig=1'),
    request: vi.fn(async () => ({ status: 200, redirect: false })),
    record: vi.fn(async () => ({ data: true, error: null })),
    ...over,
  }
}

describe('the look at an object in a company\'s own bucket', () => {
  it('a 200 is a sighting, recorded, and said so', async () => {
    const s = steps()
    expect(await lookAtObject(s)).toEqual({ status: 200, body: { ok: true, seen: true } })
    expect(s.vet).toHaveBeenCalledWith('bucket.example.com')
    expect(s.request).toHaveBeenCalledWith('https://bucket.example.com/key?sig=1', VETTED)
    expect(s.record).toHaveBeenCalledTimes(1)
  })

  it('a 404 is not there, and nothing is recorded', async () => {
    const s = steps({ request: vi.fn(async () => ({ status: 404, redirect: false })) })
    expect(await lookAtObject(s)).toEqual({ status: 200, body: { ok: true, seen: false } })
    expect(s.record).not.toHaveBeenCalled()
  })

  it('a 403 says the bucket refused the server, in words an admin can act on, and is not read as absent', async () => {
    const s = steps({ request: vi.fn(async () => ({ status: 403, redirect: false })) })
    const out = await lookAtObject(s)
    // 409: patiently() would upload the whole file again for a 5xx, and this will not pass.
    expect(out.status).toBe(409)
    expect(out.body.detail).toContain('access rules')
    expect(out.body.seen).toBeUndefined()
  })

  it('a name that does not resolve just now is a fault that may pass, not a refusal', async () => {
    const s = steps({ vet: vi.fn(async () => ({ ok: false, reason: 'dns', detail: 'no such name' })) })
    expect(await lookAtObject(s)).toEqual({ status: 502, body: { error: 'look_failed', detail: 'no such name' } })
    expect(s.request).not.toHaveBeenCalled()
  })

  it.each([500, 503, 204, 206])('a %i is a fault, not an answer either way', async (status) => {
    const s = steps({ request: vi.fn(async () => ({ status, redirect: false })) })
    const out = await lookAtObject(s)
    expect(out.status).toBe(502)
    expect(out.body.error).toBe('look_failed')
    expect(out.body.seen).toBeUndefined()
    expect(s.record).not.toHaveBeenCalled()
  })

  it('🚨 a redirect is followed nowhere, even a 301 that also says 200 somewhere', async () => {
    const s = steps({ request: vi.fn(async () => ({ status: 200, redirect: true })) })
    const out = await lookAtObject(s)
    expect(out.body.error).toBe('look_failed')
    expect(out.body.detail).toContain('redirect')
    expect(s.record).not.toHaveBeenCalled()
  })

  it('🚨 a host that fails the vet is never contacted, and its reason is said', async () => {
    const s = steps({ vet: vi.fn(async () => ({ ok: false, detail: 'the S3 endpoint is not public' })) })
    expect(await lookAtObject(s)).toEqual({ status: 409, body: { error: 'refused', detail: 'the S3 endpoint is not public' } })
    expect(s.sign).not.toHaveBeenCalled()
    expect(s.request).not.toHaveBeenCalled()
    expect(s.record).not.toHaveBeenCalled()
  })

  it('a config the signer cannot use, a signer that throws and a bucket that cannot be reached are faults', async () => {
    for (const over of [
      { host: vi.fn(() => { throw new Error('no region') }) },
      { vet: vi.fn(async () => { throw new Error('dns down') }) },
      { sign: vi.fn(async () => { throw new Error('bad key') }) },
      { request: vi.fn(async () => { throw new Error('timed out') }) },
    ]) {
      const s = steps(over)
      const out = await lookAtObject(s)
      expect(out.status).toBe(502)
      expect(out.body.error).toBe('look_failed')
      expect(s.record).not.toHaveBeenCalled()
    }
  })

  it('a sighting the database could not note is not a sighting', async () => {
    const s = steps({ record: vi.fn(async () => ({ data: null, error: { message: 'down' } })) })
    const out = await lookAtObject(s)
    expect(out.status).toBe(500)
    expect(out.body.error).toBe('look_not_recorded')
    // The client has deleted the copy by the time a person reads this, so it must not say the copy is there.
    expect(out.body.detail).not.toContain('is there')
    expect(out.body.seen).toBeUndefined()
  })

  it.each([false, null, undefined, 'true', 1])('🚨 the database answering %s is a refusal: only true is a look', async (data) => {
    const out = await lookAtObject(steps({ record: vi.fn(async () => ({ data, error: null })) }))
    expect(out.status).toBe(409)
    expect(out.body.error).toBe('refused')
    expect(out.body.seen).toBeUndefined()
  })
})
