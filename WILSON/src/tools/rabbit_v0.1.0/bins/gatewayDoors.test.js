// =============================================================================
// gatewayDoors.test.js — GW3: the browser's half of the gateway's HTTP surface
// (GATEWAY_DESIGN.md §2, §5, §7; GW2's hand-off "For GW3"), against a fake
// fetch. What this pins:
//   * the probe: every inside address asked in parallel, the FIRST 200 that
//     names the inside door kept, the outside address tried only after none
//     answered, where ANY HTTP answer (its /v1/path is 404 by design) means the
//     outside door; nothing answering is null; a timeout is not a crash;
//   * a <video> reads no header: the door is known from which ADDRESS answered,
//     never from Wilson-Gateway-Path;
//   * the clip URL carries the ticket in the query, encoded; the renewal posts
//     { jti, t } and only 204 is a renewal; the HEAD reports the status a
//     <video> cannot; a network error is status 0, never a throw;
//   * the ticket's claims are read from its payload (jti, exp), never its
//     signature.
// =============================================================================

import { describe, it, expect, vi } from 'vitest'
import {
  doorBase, clipUrl, ticketClaims, ticketExpiresAt, probeGateway, renewStream, headClip, postTicketRequest, realGatewayDoors,
  PROBE_TIMEOUT_MS, RENEW_AFTER_MS, TICKET_BATCH_MAX, DOOR_CALL_TIMEOUT_MS,
} from './gatewayDoors'

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url')
const ticketWith = (claims) => `v1.${b64url(JSON.stringify(claims))}.${b64url('sig')}`
const res = (status, body = null, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => { if (body === null) throw new Error('no body'); return body },
})
const gateway = (over = {}) => ({ id: 'g1', inside_addresses: [{ host: '192.168.1.10', port: 8443 }, { host: 'studio-nas.local', port: 8443 }], outside_address: { host: 'gateway.example.com', port: 8444 }, ...over })

describe('the fixed numbers are the design\'s', () => {
  it('1.5 s per probe, a renewal at 75 s, fifty ids a ticket call', () => {
    expect(PROBE_TIMEOUT_MS).toBe(1500)
    expect(RENEW_AFTER_MS).toBe(75_000)
    expect(TICKET_BATCH_MAX).toBe(50)
  })
})

describe('the URLs', () => {
  it('a door is https://host:port, an IPv6 literal bracketed, the inside port 8443 when none is given', () => {
    expect(doorBase('192.168.1.10', 8443)).toBe('https://192.168.1.10:8443')
    expect(doorBase('fd00::10', 8443)).toBe('https://[fd00::10]:8443')
    expect(doorBase('studio-nas.local', undefined)).toBe('https://studio-nas.local:8443')
  })
  it('the clip URL carries the ticket in the query, encoded (§5 step 5)', () => {
    expect(clipUrl('https://192.168.1.10:8443', 'c1', 'v1.a.b')).toBe('https://192.168.1.10:8443/v1/clips/c1?t=v1.a.b')
    expect(clipUrl('https://x:1', 'c1', 'a+b/c')).toBe('https://x:1/v1/clips/c1?t=a%2Bb%2Fc')
  })
})

describe('the ticket\'s claims, read from the payload alone', () => {
  it('jti and exp come back; the signature is never read; a malformed ticket is null', () => {
    const t = ticketWith({ v: 1, jti: 'abc', exp: 1791633700 })
    expect(ticketClaims(t)).toMatchObject({ jti: 'abc', exp: 1791633700 })
    expect(ticketExpiresAt(t)).toBe(1791633700 * 1000)
    for (const bad of [null, '', 'v2.x.y', 'v1.x', `v1.${b64url('not json')}.s`, 42]) expect(ticketClaims(bad)).toBeNull()
    expect(ticketExpiresAt(ticketWith({ jti: 'x' }))).toBeNull()
  })
  it('a non-ASCII path in the payload is read as the cloud wrote it (UTF-8)', () => {
    expect(ticketClaims(ticketWith({ path: 'Día 02/Entrevista toma 3.mp4' })).path).toBe('Día 02/Entrevista toma 3.mp4')
  })
})

describe('the probe (§2): the inside addresses in parallel, then the outside address', () => {
  it('the first inside address that names the inside door wins; the outside address is not asked', async () => {
    const asked = []
    const fetchImpl = vi.fn(async (url) => {
      asked.push(url)
      if (url.startsWith('https://192.168.1.10:8443/')) return res(200, { gateway_id: 'g1', path: 'inside', version: '0.1.0' })
      throw new TypeError('fetch failed')
    })
    const r = await probeGateway(gateway(), { fetchImpl, timeoutMs: 200 })
    expect(r).toEqual({ door: 'inside', base: 'https://192.168.1.10:8443', gatewayId: 'g1' })
    expect(asked.sort()).toEqual(['https://192.168.1.10:8443/v1/path', 'https://studio-nas.local:8443/v1/path'])
    expect(asked.some((u) => u.includes('gateway.example.com'))).toBe(false)
  })
  it('no inside answer: the outside address is tried, and its 404 IS the outside door (R17)', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.startsWith('https://gateway.example.com:8444/')) return res(404)
      throw new TypeError('fetch failed')
    })
    expect(await probeGateway(gateway(), { fetchImpl, timeoutMs: 100 })).toEqual({ door: 'outside', base: 'https://gateway.example.com:8444', gatewayId: 'g1' })
  })
  it('an inside address answering as ANOTHER gateway (its id in the body) is not this gateway\'s door; the next address that names this one is', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.startsWith('https://192.168.1.10:8443/')) return res(200, { gateway_id: 'g2', path: 'inside', version: '0.1.0' })
      if (url.startsWith('https://studio-nas.local:8443/')) return res(200, { gateway_id: 'g1', path: 'inside', version: '0.1.0' })
      return res(404)
    })
    expect(await probeGateway(gateway(), { fetchImpl, timeoutMs: 100 })).toEqual({ door: 'inside', base: 'https://studio-nas.local:8443', gatewayId: 'g1' })
    const onlyOther = vi.fn(async (url) => (url.startsWith('https://192.168.1.10') ? res(200, { gateway_id: 'g2', path: 'inside' }) : Promise.reject(new TypeError('x'))))
    expect(await probeGateway(gateway({ inside_addresses: [{ host: '192.168.1.10', port: 8443 }], outside_address: null }), { fetchImpl: onlyOther, timeoutMs: 100 })).toBeNull()
    const noId = vi.fn(async () => res(200, { path: 'inside' }))
    expect(await probeGateway(gateway({ outside_address: null }), { fetchImpl: noId, timeoutMs: 100 })).toBeNull()
  })
  it('an inside address answering 200 with no path, or another body, is not the inside door', async () => {
    const fetchImpl = vi.fn(async (url) => (url.startsWith('https://192.168.1.10') ? res(200, { ok: true }) : res(404)))
    expect(await probeGateway(gateway({ outside_address: null }), { fetchImpl, timeoutMs: 100 })).toBeNull()
  })
  it('nothing answering anywhere is null; a slow door is abandoned at the timeout, not awaited', async () => {
    const fetchImpl = vi.fn((url, { signal }) => new Promise((_, reject) => { signal?.addEventListener('abort', () => reject(new Error('aborted'))) }))
    const t0 = Date.now()
    expect(await probeGateway(gateway(), { fetchImpl, timeoutMs: 60 })).toBeNull()
    expect(Date.now() - t0).toBeLessThan(1500)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    for (const [, init] of fetchImpl.mock.calls) expect(init.cache).toBe('no-store')
  })
  it('a 200 from the OUTSIDE address naming itself inside is still the outside door: the viewer reached a public address', async () => {
    const fetchImpl = vi.fn(async (url) => (url.includes('gateway.example.com') ? res(200, { path: 'inside', gateway_id: 'g1' }) : res(500)))
    expect((await probeGateway(gateway({ inside_addresses: [] }), { fetchImpl })).door).toBe('outside')
  })
  it('no gateway, no fetch: null', async () => {
    expect(await probeGateway(null, { fetchImpl: vi.fn() })).toBeNull()
    expect(await probeGateway(gateway(), { fetchImpl: null })).toBeNull()
  })
})

describe('the renewal and the HEAD (§5 steps 6 and 7)', () => {
  it('renew posts { jti, t } as JSON to /v1/clips/<id>/renew; only 204 is a renewal', async () => {
    const fetchImpl = vi.fn(async () => res(204))
    expect(await renewStream('https://d:1', 'c1', { jti: 'j', ticket: 'v1.a.b' }, { fetchImpl })).toEqual({ ok: true, status: 204 })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://d:1/v1/clips/c1/renew')
    expect(init.method).toBe('POST')
    expect(init.headers['content-type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ jti: 'j', t: 'v1.a.b' })
    expect(await renewStream('https://d:1', 'c1', { jti: 'j', ticket: 't' }, { fetchImpl: async () => res(401) })).toEqual({ ok: false, status: 401 })
    expect(await renewStream('https://d:1', 'c1', { jti: 'j', ticket: 't' }, { fetchImpl: async () => { throw new TypeError('x') } })).toEqual({ ok: false, status: 0 })
  })
  it('HEAD reports the status a <video> cannot read, and the door the response names; nothing answering is 0', async () => {
    const fetchImpl = vi.fn(async () => res(404, null, { 'wilson-gateway-path': 'outside' }))
    expect(await headClip('https://d:1', 'c1', 'v1.a.b', { fetchImpl })).toEqual({ status: 404, door: 'outside' })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://d:1/v1/clips/c1?t=v1.a.b')
    expect(fetchImpl.mock.calls[0][1].method).toBe('HEAD')
    expect(await headClip('https://d:1', 'c1', 't', { fetchImpl: async () => { throw new TypeError('x') } })).toEqual({ status: 0, door: null })
  })
  it('round 2, note 12: a HEAD or a renewal nobody answers is status 0 at five seconds, never awaited for the browser\'s own minutes — even from a fetch that ignores its signal', async () => {
    vi.useFakeTimers()
    try {
      expect(DOOR_CALL_TIMEOUT_MS).toBe(5000)
      const hang = vi.fn(() => new Promise(() => {}))
      let head = null
      let renew = null
      headClip('https://d:1', 'c1', 't', { fetchImpl: hang }).then((r) => { head = r })
      renewStream('https://d:1', 'c1', { jti: 'j', ticket: 't' }, { fetchImpl: hang }).then((r) => { renew = r })
      await vi.advanceTimersByTimeAsync(4_900)
      expect(head).toBeNull()
      expect(renew).toBeNull()
      await vi.advanceTimersByTimeAsync(200)
      expect(head).toEqual({ status: 0, door: null })
      expect(renew).toEqual({ ok: false, status: 0 })
      // The signal is handed to fetch, so a real fetch is aborted, not left open: the HEAD's and the renewal's.
      expect(hang.mock.calls).toHaveLength(2)
      expect(hang.mock.calls[0][1].method).toBe('HEAD')
      expect(hang.mock.calls[0][1].signal.aborted).toBe(true)
      expect(hang.mock.calls[1][1].method).toBe('POST')
      expect(hang.mock.calls[1][1].signal.aborted).toBe(true)
      // CONTROL: an answer before the deadline is the answer.
      const quick = vi.fn(async () => res(206))
      expect(await headClip('https://d:1', 'c1', 't', { fetchImpl: quick })).toEqual({ status: 206, door: null })
    } finally { vi.useRealTimers() }
  })
})

describe('postTicketRequest (the fixtures\' Playwright mode): res.ok before any body', () => {
  it('a 200 with tickets is read; a refusal is its status; a body in another shape is refused; a network error is 0', async () => {
    const ok = await postTicketRequest('/__fake-cloud/gateway-ticket', { gateway_id: 'g1', bin_file_ids: ['c1'] }, { fetchImpl: async () => res(200, { tickets: { c1: 'v1.a.b' }, missing: [], refused: [] }) })
    expect(ok).toMatchObject({ ok: true, data: { tickets: { c1: 'v1.a.b' }, missing: [], refused: [], expires_at: null } })
    expect(await postTicketRequest('/x', {}, { fetchImpl: async () => res(401, { error: 'x' }) })).toMatchObject({ ok: false, status: 401 })
    expect(await postTicketRequest('/x', {}, { fetchImpl: async () => res(200, { nothing: true }) })).toMatchObject({ ok: false, code: 'bad_answer' })
    expect(await postTicketRequest('/x', {}, { fetchImpl: async () => { throw new TypeError('x') } })).toMatchObject({ ok: false, status: 0 })
  })
})

describe('the production doors object', () => {
  it('is frozen and answers the four verbs with the module\'s functions', () => {
    expect(Object.isFrozen(realGatewayDoors)).toBe(true)
    expect(Object.keys(realGatewayDoors).sort()).toEqual(['clipUrl', 'head', 'probe', 'renew'])
    expect(realGatewayDoors.clipUrl).toBe(clipUrl)
  })
})
