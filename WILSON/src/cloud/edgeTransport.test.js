// =============================================================================
// edgeTransport.test.js — F8 (wave 2, 2026-11-13), step (d).
//
// The reach check (gatewayReach.ts) and the S3 endpoint's probe (s3Reach.ts)
// now share one host rule (checkPublicHost) and one raw-HTTP transport
// (withDeadline, readBytesUpTo, connectLiteralTls, exchangeOnce,
// readBodyCapped). Sharing must not move either caller's answers, so:
//
//   1. THE HOST TABLE: the same host given to both callers, each answering in
//      its own word (DESIGN.md §6.3 and §2.5). The rows where the words differ
//      are older than F8 and stay: a host that is not a DNS name is
//      `malformed` at the reach check and `local_name` at the S3 vet; the reach
//      check judges the host as typed (no lower-casing, a bare IPv6 literal),
//      the S3 vet reads it through a URL (lower-cased, brackets, `010.0.0.1`
//      read as 8.0.0.1).
//   2. THE TRANSPORT: each side's timeout keeps its words (the S3 sentence
//      reaches a person); a failed write is `not_this_gateway` at the reach
//      probe and THROWS out of s3Request; the byte caps; a redirect.
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  checkOutsideAddress, checkPublicHost, probeOutside,
  withDeadline, readBytesUpTo, connectLiteralTls, exchangeOnce, readBodyCapped, TIMED_OUT,
} from '../../supabase/functions/_shared/gatewayReach.ts'
import { vetS3Host, s3Request, S3_TIMED_OUT } from '../../supabase/functions/_shared/s3Reach.ts'

const PUBLIC = '93.184.216.34'
const OWN = 'files.petal.example.com'

const RESOLVE = {
  'gateway.example.com': [PUBLIC],
  'private.example.com': [PUBLIC, '10.0.0.5'],
  [OWN]: [PUBLIC],
}

function net({ tls = null, fetchImpl = null } = {}) {
  const calls = { resolve: [], tls: [], fetch: [] }
  const deps = {
    resolve: async (name) => { calls.resolve.push(name); const a = RESOLVE[name]; if (!a) throw new Error('no such name'); return a },
    now: () => Date.now(),
  }
  if (tls) deps.connectTls = async (ip, port, serverName, ms) => { calls.tls.push({ ip, port, serverName }); return tls(ip, port, serverName, ms) }
  if (fetchImpl) deps.fetch = async (url, init) => { calls.fetch.push({ url, init }); return fetchImpl(url, init) }
  return { deps, calls }
}

/** The reach check's word for a host: the address check, then the probe's own resolution and vetting. */
async function reachWord(host, own) {
  const chk = checkOutsideAddress({ host, port: 443 }, own)
  if (!chk.ok) return chk.reason
  // Past the vet the probe contacts the host; a 404 there is `not_this_gateway`, which this table calls ok.
  const { deps } = net({ fetchImpl: async () => new Response('nope', { status: 404 }) })
  const r = await probeOutside({ host, port: 443 }, '0123456789abcdef0123456789abcdef', { switchOn: true, supabaseHost: own }, deps)
  return r.detail === 'not_this_gateway' ? 'ok' : r.detail
}

/** The S3 vet's word for the same host. */
async function s3Word(host, own) {
  const v = await vetS3Host(host, net().deps, own ? { supabaseHost: own } : {})
  return v.ok ? 'ok' : v.reason
}

describe('the host rule, the same host at both callers, each in its own word (F8 d)', () => {
  it.each([
    // host                           reach check     S3 vet          why they differ, if they do
    ['localhost',                     'malformed',    'local_name'],   // not a DNS name: the drift that stays (F8-04)
    ['nas',                           'malformed',    'local_name'],
    ['under_score.example.com',       'malformed',    'local_name'],
    ['example.com.',                  'malformed',    'local_name'],
    ['Gateway.Example.com',           'malformed',    'ok'],           // the S3 vet's URL lower-cases; the reach check does not
    ['[::1]',                         'malformed',    'not_public'],   // the reach check takes a bare literal, refuses brackets
    ['::1',                           'not_public',   'malformed'],    // a URL needs brackets
    ['[2606:4700:4700::1111]',        'malformed',    'ok'],
    ['2606:4700:4700::1111',          'ok',           'malformed'],
    ['010.0.0.1',                     'malformed',    'ok'],           // the URL parser reads it as 8.0.0.1, as the signer's URL does
    ['1.2.3',                         'malformed',    'ok'],           // ... and this as 1.2.0.3
    ['nas.local',                     'local_name',   'local_name'],
    ['minio.internal',                'local_name',   'local_name'],
    ['x.localhost',                   'local_name',   'local_name'],
    ['abc.supabase.co',               'supabase_host', 'supabase_host'],
    ['10.0.0.5',                      'not_public',   'not_public'],
    ['192.168.1.10',                  'not_public',   'not_public'],
    ['169.254.169.254',               'not_public',   'not_public'],
    ['8.8.4.4',                       'ok',           'ok'],
    ['gateway.example.com',           'ok',           'ok'],
    ['private.example.com',           'not_public',   'not_public'],   // one private answer is enough
    ['nowhere.example.com',           'dns',          'dns'],          // does not resolve
    [OWN,                             'ok',           'ok'],           // not the project's host unless it is named so
  ])('%s: reach %s, S3 %s', async (host, reach, s3) => {
    expect(await reachWord(host)).toBe(reach)
    expect(await s3Word(host)).toBe(s3)
  })

  it('the project\'s own host is a Supabase host at both, compared lower-cased on the own side', async () => {
    expect(await reachWord(OWN, OWN)).toBe('supabase_host')
    expect(await s3Word(OWN, OWN)).toBe('supabase_host')
    expect(await reachWord(OWN, OWN.toUpperCase())).toBe('supabase_host')
    expect(await s3Word(OWN, OWN.toUpperCase())).toBe('supabase_host')
  })

  it('checkPublicHost itself: the four refusals in order, the host judged exactly as given', () => {
    expect(checkPublicHost('8.8.4.4')).toEqual({ ok: true, literal: true })
    expect(checkPublicHost('2606:4700:4700::1111')).toEqual({ ok: true, literal: true })
    expect(checkPublicHost('gateway.example.com')).toEqual({ ok: true, literal: false })
    expect(checkPublicHost('10.0.0.5')).toEqual({ ok: false, reason: 'not_public' })
    expect(checkPublicHost('localhost')).toEqual({ ok: false, reason: 'not_a_name' })
    expect(checkPublicHost('Gateway.Example.com')).toEqual({ ok: false, reason: 'not_a_name' })
    expect(checkPublicHost('nas.local')).toEqual({ ok: false, reason: 'local_name' })
    expect(checkPublicHost('x.supabase.co')).toEqual({ ok: false, reason: 'supabase_host' })
    expect(checkPublicHost(OWN, OWN)).toEqual({ ok: false, reason: 'supabase_host' })
    // A local name under Supabase's suffix? The local suffix is asked first.
    expect(checkPublicHost('supabase.local')).toEqual({ ok: false, reason: 'local_name' })
  })

  it('a refused host is never resolved and never contacted, at either caller', async () => {
    for (const host of ['localhost', 'nas.local', 'abc.supabase.co', '10.0.0.5']) {
      const n = net({ tls: () => { throw new Error('must not connect') } })
      await probeOutside({ host, port: 443 }, 'n', { switchOn: true }, n.deps)
      await vetS3Host(host, n.deps)
      expect(n.calls.resolve, host).toEqual([])
      expect(n.calls.tls, host).toEqual([])
    }
  })
})

// ── The transport ────────────────────────────────────────────────────────────

const never = () => new Promise(() => {})

function conn({ answer = '', write = null } = {}) {
  const bytes = typeof answer === 'string' ? new TextEncoder().encode(answer) : answer
  let off = 0
  const c = {
    sent: '', closed: false, reads: 0,
    write: write ?? (async (b) => { c.sent += new TextDecoder().decode(b); return b.length }),
    read: async (buf) => {
      c.reads += 1
      if (off >= bytes.length) return null
      const n = Math.min(buf.length, bytes.length - off, 1000)
      buf.set(bytes.subarray(off, off + n))
      off += n
      return n
    },
    close() { c.closed = true },
  }
  return c
}

const SIGNED = 'https://bucket.s3.example.com/k?X-Amz-Signature=abc'
const VETTED = { ok: true, hostname: 'bucket.s3.example.com', port: 443, address: PUBLIC, literal: false }
const ADDR = { host: 'gateway.example.com', port: 8444 }

describe('the transport, shared, each side keeping its words and its errors (F8 d)', () => {
  it('withDeadline: the reach check\'s two words by default, the S3 sentence when given; both named TimedOut', async () => {
    expect(TIMED_OUT).toBe('timed out')
    await expect(withDeadline(never(), 10)).rejects.toMatchObject({ name: 'TimedOut', message: 'timed out' })
    await expect(withDeadline(never(), 10, undefined, S3_TIMED_OUT)).rejects.toMatchObject({ name: 'TimedOut', message: 'the S3 endpoint did not answer within the time allowed' })
    expect(await withDeadline(Promise.resolve(7), 1000)).toBe(7)
  })

  it('the connect that never answers: the S3 side says its sentence, the reach check its two words (read as timed_out)', async () => {
    const silent = net({ tls: never })
    await expect(s3Request({ url: SIGNED, method: 'GET', vetted: VETTED, deps: silent.deps, timeoutMs: 20 }))
      .rejects.toMatchObject({ name: 'TimedOut', message: 'the S3 endpoint did not answer within the time allowed' })
    await expect(connectLiteralTls(silent.deps, PUBLIC, 443, 'x.example.com', 20)).rejects.toMatchObject({ name: 'TimedOut', message: 'timed out' })
    expect(await probeOutside(ADDR, 'n', { switchOn: true, timeoutMs: 20 }, silent.deps)).toMatchObject({ detail: 'timed_out' })
  })

  it('a write that never finishes: s3Request throws the S3 sentence, the connection closed', async () => {
    const c = conn({ write: never })
    const n = net({ tls: () => c })
    await expect(s3Request({ url: SIGNED, method: 'PUT', body: 'x', vetted: VETTED, deps: n.deps, timeoutMs: 20 }))
      .rejects.toMatchObject({ name: 'TimedOut', message: 'the S3 endpoint did not answer within the time allowed' })
    expect(c.closed).toBe(true)
  })

  it('🚨 a failed write: the reach probe reads it as nothing answered (not_this_gateway, the certificate ok); s3Request lets it through', async () => {
    const broken = () => conn({ write: async () => { throw new Error('broken pipe') } })
    const r1 = net({ tls: broken })
    expect(await probeOutside(ADDR, 'n', { switchOn: true }, r1.deps)).toMatchObject({ ok: false, detail: 'not_this_gateway', certificate: 'ok', method: 'literal_tls' })
    let c
    const s = net({ tls: () => (c = broken()) })
    await expect(s3Request({ url: SIGNED, method: 'GET', vetted: VETTED, deps: s.deps })).rejects.toThrow('broken pipe')
    expect(c.closed).toBe(true)
  })

  it('a connection that arrives after the deadline is closed', async () => {
    const late = conn()
    const n = net({ tls: () => new Promise((r) => setTimeout(() => r(late), 40)) })
    await expect(connectLiteralTls(n.deps, PUBLIC, 443, 'x.example.com', 10)).rejects.toMatchObject({ name: 'TimedOut' })
    await new Promise((r) => setTimeout(r, 60))
    expect(late.closed).toBe(true)
  })

  it('the byte cap: exchangeOnce and readBytesUpTo read at most their cap, and close', async () => {
    const c = conn({ answer: 'x'.repeat(10_000) })
    const got = await exchangeOnce(c, new Uint8Array([1]), 4096, Date.now() + 1000, () => Date.now())
    expect(got.length).toBe(4096)
    expect(c.closed).toBe(true)
    const d = conn({ answer: 'abc' })
    expect(new TextDecoder().decode(await readBytesUpTo(d, 4096, Date.now() + 1000, () => Date.now()))).toBe('abc')
    // A read that never answers ends at the deadline; readBytesUpTo never throws.
    const stuck = { read: never, write: async () => 0, close() {} }
    expect((await readBytesUpTo(stuck, 64, Date.now() + 20, () => Date.now())).length).toBe(0)
  })

  it('the reach probe reads at most 4 KB through the shared reader; a proof past it is never seen', async () => {
    const n = net({ tls: () => conn({ answer: 'HTTP/1.1 200 OK\r\n\r\n' + JSON.stringify({ pad: 'x'.repeat(5000), nonce_proof: 'a'.repeat(64) }) }) })
    expect(await probeOutside(ADDR, 'n', { switchOn: true, expectedProof: 'a'.repeat(64) }, n.deps)).toMatchObject({ detail: 'not_this_gateway' })
  })

  it('readBodyCapped: at most the cap, then the stream cancelled', async () => {
    let pulled = 0
    let cancelled = false
    const body = new ReadableStream({
      pull(c) { pulled += 1; c.enqueue(new Uint8Array(1000).fill(65)) },
      cancel() { cancelled = true },
    })
    const got = await readBodyCapped(body, 2500)
    expect(got.length).toBe(2500)
    expect(cancelled).toBe(true)
    expect(pulled).toBeLessThan(6)
    expect((await readBodyCapped(new Response('short').body, 2500)).length).toBe(5)
  })

  it('the fetch fallback: s3Request caps the body, and does not read the body of a redirect', async () => {
    let pulled = 0
    const s = net({
      fetchImpl: async () => ({ status: 200, type: 'basic', body: new ReadableStream({ pull(c) { pulled += 1; c.enqueue(new TextEncoder().encode('y'.repeat(1000))) } }) }),
    })
    const r = await s3Request({ url: SIGNED, method: 'GET', vetted: VETTED, deps: s.deps, maxBodyBytes: 1500 })
    expect(r).toMatchObject({ status: 200, redirect: false, method: 'pinned_fetch' })
    expect(r.text).toBe('y'.repeat(1500))
    expect(s.calls.fetch[0].init.redirect).toBe('manual')
    let redirectPulled = 0
    const red = net({
      fetchImpl: async () => ({ status: 302, type: 'basic', body: new ReadableStream({ pull(c) { redirectPulled += 1; c.enqueue(new Uint8Array(10)) } }) }),
    })
    const r2 = await s3Request({ url: SIGNED, method: 'GET', vetted: VETTED, deps: red.deps })
    expect(r2).toMatchObject({ status: 302, redirect: true, text: '' })
    // A ReadableStream pulls once on its own to fill its queue; nothing READ it past that.
    expect(redirectPulled).toBeLessThanOrEqual(1)
    expect(red.calls.fetch).toHaveLength(1)
  })

  it('a redirect on the literal path: one connection, nothing followed, at both callers', async () => {
    const s = net({ tls: () => conn({ answer: 'HTTP/1.1 301 Moved\r\nLocation: http://169.254.169.254/\r\nContent-Length: 0\r\n\r\n' }) })
    expect(await s3Request({ url: SIGNED, method: 'GET', vetted: VETTED, deps: s.deps })).toMatchObject({ status: 301, redirect: true })
    expect(s.calls.tls).toHaveLength(1)
    const r = net({ tls: () => conn({ answer: 'HTTP/1.1 302 Found\r\nLocation: https://10.0.0.1/\r\n\r\n' }) })
    expect(await probeOutside(ADDR, 'n', { switchOn: true }, r.deps)).toMatchObject({ detail: 'not_this_gateway' })
    expect(r.calls.tls).toHaveLength(1)
  })
})
