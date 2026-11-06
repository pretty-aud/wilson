// =============================================================================
// s3Reach.test.js — P8 (night 5, 2026-10-28), TPN-NET-016.
//
// The S3 endpoint's vet and the one request a Petal-side function makes to
// it (supabase/functions/_shared/s3Reach.ts), imported across the Deno/Node
// line in gatewayEdge.test.js's arrangement, driven through a FAKE network:
// a resolver that answers what the test says, a TLS connect that records the
// literal, the port and the server name it was asked for and plays a canned
// answer, a fetch that records its options. Then the text pins: the two
// functions that reach a company's bucket go through the helper and nowhere
// else, with the sentences a person reads.
//
// Before P8, storage-secret's probe and storage-gc's drain called fetch() on a
// presigned URL with its defaults — redirects followed, the host as typed,
// no timeout — so every case below either had no guard to fail, or passed
// the request through.
// =============================================================================

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  vetS3Host, s3Request, parseHttpAnswer, S3_REQUEST_TIMEOUT_MS, S3_ANSWER_MAX_BYTES,
} from '../../supabase/functions/_shared/s3Reach.ts'

const REPO = join(__dirname, '..', '..')
const read = (...p) => readFileSync(join(REPO, ...p), 'utf8')

const PUBLIC = '93.184.216.34' // a public address (203.0.113.0/24 is TEST-NET-3, documentation, and refused)
const PUBLIC2 = '93.184.216.35'

function deps({ resolve = {}, tls = null, fetch: fetchImpl = null } = {}) {
  return {
    resolve: async (name) => { const a = resolve[name]; if (!a) throw new Error('no such name'); return a },
    now: () => Date.now(),
    ...(tls ? { connectTls: tls } : {}),
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  }
}

/** A TLS connect that records what it was asked to reach and plays `answer` once. */
function fakeTls(answer, log) {
  return async (ip, port, serverName) => {
    const entry = { ip, port, serverName, request: '', closed: false }
    log.push(entry)
    const bytes = new TextEncoder().encode(answer)
    let off = 0
    return {
      write: async (b) => { entry.request += new TextDecoder().decode(b); return b.length },
      read: async (buf) => {
        if (off >= bytes.length) return null
        const n = Math.min(buf.length, bytes.length - off)
        buf.set(bytes.subarray(off, off + n))
        off += n
        return n
      },
      close() { entry.closed = true },
    }
  }
}

const SIGNED = (host, key = 'wilson-media/.wilson-probe/server-1') => `https://${host}/${key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIA%2F20261028%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20261028T000000Z&X-Amz-Expires=120&X-Amz-SignedHeaders=host&X-Amz-Signature=abc`

describe('vetS3Host — the host a presigned URL names (step 1)', () => {
  it.each([
    ['10.0.0.5', 'not_public'], ['192.168.1.2:9000', 'not_public'], ['172.16.0.9', 'not_public'],
    ['169.254.169.254', 'not_public'], ['127.0.0.1:9000', 'not_public'], ['100.64.0.1', 'not_public'],
    ['[fd00::1]:9000', 'not_public'], ['[::1]', 'not_public'], ['0.0.0.0', 'not_public'],
    ['224.0.0.1', 'not_public'], ['192.0.2.1', 'not_public'],
  ])('🚨 a literal inside a private, loopback, link-local, CGNAT, multicast or reserved range is refused: %s', async (host, reason) => {
    const tls = vi.fn()
    const v = await vetS3Host(host, deps({ tls }))
    expect(v).toMatchObject({ ok: false, reason })
    expect(v.detail).toMatch(/inside a private network/)
    expect(tls).not.toHaveBeenCalled()
  })
  it('a public literal is vetted as it is, with its port', async () => {
    expect(await vetS3Host('93.184.216.9', deps())).toEqual({ ok: true, hostname: '93.184.216.9', port: 443, address: '93.184.216.9', literal: true })
    expect(await vetS3Host('93.184.216.9:9000', deps())).toMatchObject({ ok: true, port: 9000, literal: true })
  })
  it.each([
    ['localhost', 'local_name'], ['nas.local', 'local_name'], ['storage.lan', 'local_name'], ['minio.internal', 'local_name'],
    ['minio.home.arpa', 'local_name'], ['s3.corp', 'local_name'], ['bucket.example', 'local_name'], ['onlyonelabel', 'local_name'],
    ['x.supabase.co', 'supabase_host'], ['eqjzmnvkrakroyqxfsvw.supabase.in', 'supabase_host'],
  ])('🚨 a local, bare or WILSON name is refused before any resolution: %s', async (host, reason) => {
    const d = deps()
    d.resolve = vi.fn()
    expect(await vetS3Host(host, d)).toMatchObject({ ok: false, reason })
    expect(d.resolve).not.toHaveBeenCalled()
  })
  it('the project\'s own host is refused by name too', async () => {
    expect(await vetS3Host('files.petal.example.com', deps(), { supabaseHost: 'files.petal.example.com' })).toMatchObject({ ok: false, reason: 'supabase_host' })
  })
  it('🚨 a public name resolving to ANY private address is refused, naming it, and nothing is contacted', async () => {
    const tls = vi.fn()
    const v = await vetS3Host('bucket.s3.example.com', deps({ resolve: { 'bucket.s3.example.com': [PUBLIC, '10.0.0.5'] }, tls }))
    expect(v).toMatchObject({ ok: false, reason: 'not_public', address: '10.0.0.5' })
    expect(v.detail).toContain('10.0.0.5')
    expect(tls).not.toHaveBeenCalled()
  })
  it('a public name resolving to public addresses is vetted with its FIRST answer, lower-cased', async () => {
    const v = await vetS3Host('Bucket.S3.Example.com:9000', deps({ resolve: { 'bucket.s3.example.com': [PUBLIC, PUBLIC2] } }))
    expect(v).toEqual({ ok: true, hostname: 'bucket.s3.example.com', port: 9000, address: PUBLIC, literal: false })
  })
  it('a name that does not resolve is the forcePathStyle sentence (the measured shape of a wrong style)', async () => {
    const v = await vetS3Host('nope.s3.example.com', deps({ resolve: {} }))
    expect(v).toMatchObject({ ok: false, reason: 'dns' })
    expect(v.detail).toMatch(/forcePathStyle/)
  })
  it('a host carrying a path, a query, credentials or a bad port is malformed', async () => {
    for (const h of ['s3.example.com/minio', 's3.example.com?x=1', 'user:pw@s3.example.com', 's3.example.com:70000', '']) {
      expect((await vetS3Host(h, deps())).ok, h).toBe(false)
    }
  })
})

describe('s3Request — one request to the vetted literal (step 2)', () => {
  const vetted = { ok: true, hostname: 'bucket.s3.example.com', port: 443, address: PUBLIC, literal: false }

  it('🚨 connects to the VETTED LITERAL with the name as SNI, writes one HTTP/1.1 request with Host, Content-Length and Connection: close, and reads the answer', async () => {
    const log = []
    const d = deps({ tls: fakeTls('HTTP/1.1 200 OK\r\nContent-Length: 12\r\nx-amz-id-2: abc\r\n\r\nwilson-probe', log) })
    const r = await s3Request({ url: SIGNED('bucket.s3.example.com'), method: 'PUT', body: 'wilson-probe', vetted, deps: d })
    expect(r).toEqual({ status: 200, text: 'wilson-probe', redirect: false, method: 'literal_tls', address: PUBLIC })
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ ip: PUBLIC, port: 443, serverName: 'bucket.s3.example.com', closed: true })
    const [requestLine, ...headerLines] = log[0].request.split('\r\n')
    expect(requestLine).toBe(`PUT /wilson-media/.wilson-probe/server-1?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIA%2F20261028%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20261028T000000Z&X-Amz-Expires=120&X-Amz-SignedHeaders=host&X-Amz-Signature=abc HTTP/1.1`)
    expect(headerLines).toContain('Host: bucket.s3.example.com')
    expect(headerLines).toContain('Content-Length: 12')
    expect(headerLines).toContain('Connection: close')
    expect(headerLines.some((l) => /^Expect:/i.test(l) || /^Transfer-Encoding:/i.test(l))).toBe(false)
    expect(log[0].request.endsWith('\r\n\r\nwilson-probe')).toBe(true)
  })
  it('a port other than 443 rides the Host header and the connect', async () => {
    const log = []
    const d = deps({ tls: fakeTls('HTTP/1.1 204 No Content\r\n\r\n', log) })
    const v = { ...vetted, hostname: 'minio.example.com', port: 9000 }
    const r = await s3Request({ url: SIGNED('minio.example.com:9000'), method: 'DELETE', vetted: v, deps: d })
    expect(r).toMatchObject({ status: 204, text: '', redirect: false })
    expect(log[0]).toMatchObject({ port: 9000, serverName: 'minio.example.com' })
    expect(log[0].request.split('\r\n')).toContain('Host: minio.example.com:9000')
    expect(log[0].request.split('\r\n')).toContain('Content-Length: 0')
  })
  it('🚨 every 3xx is REFUSED and nothing is followed: one connection, no second', async () => {
    const log = []
    const d = deps({ tls: fakeTls('HTTP/1.1 301 Moved Permanently\r\nLocation: http://169.254.169.254/latest/meta-data/\r\nContent-Length: 0\r\n\r\n', log) })
    const r = await s3Request({ url: SIGNED('bucket.s3.example.com'), method: 'GET', vetted, deps: d })
    expect(r).toMatchObject({ status: 301, redirect: true, method: 'literal_tls' })
    expect(log).toHaveLength(1)
    for (const status of ['302 Found', '307 Temporary Redirect', '308 Permanent Redirect']) {
      const l2 = []
      const r2 = await s3Request({ url: SIGNED('bucket.s3.example.com'), method: 'GET', vetted, deps: deps({ tls: fakeTls(`HTTP/1.1 ${status}\r\nLocation: https://elsewhere.example.com/\r\n\r\n`, l2) }) })
      expect(r2.redirect, status).toBe(true)
      expect(l2).toHaveLength(1)
    }
  })
  it('🚨 a URL naming a host that was not vetted is refused before any connect', async () => {
    const tls = vi.fn()
    await expect(s3Request({ url: SIGNED('other.s3.example.com'), method: 'GET', vetted, deps: deps({ tls }) })).rejects.toThrow(/not vetted/)
    await expect(s3Request({ url: SIGNED('bucket.s3.example.com:9000'), method: 'GET', vetted, deps: deps({ tls }) })).rejects.toThrow(/not vetted/)
    await expect(s3Request({ url: 'http://bucket.s3.example.com/x', method: 'GET', vetted, deps: deps({ tls }) })).rejects.toThrow(/https/)
    expect(tls).not.toHaveBeenCalled()
  })
  it('a connect that fails or times out is the caller\'s error (the probe\'s "connect" stage), the socket closed', async () => {
    const d = deps({ tls: async () => { throw Object.assign(new Error('connection refused'), { name: 'ConnectionRefused' }) } })
    await expect(s3Request({ url: SIGNED('bucket.s3.example.com'), method: 'GET', vetted, deps: d })).rejects.toThrow(/refused/)
    const log = []
    const slow = async (ip, port, serverName) => { log.push({ ip, port, serverName }); return new Promise(() => {}) }
    const t0 = Date.now()
    await expect(s3Request({ url: SIGNED('bucket.s3.example.com'), method: 'GET', vetted, deps: deps({ tls: slow }), timeoutMs: 30 })).rejects.toThrow(/did not answer within the time allowed/)
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(S3_REQUEST_TIMEOUT_MS).toBe(10_000)
  })
  it('an answer that is not HTTP is refused; a chunked body is decoded; the body is capped', () => {
    expect(parseHttpAnswer(new TextEncoder().encode('garbage'), 1024)).toBeNull()
    const chunked = parseHttpAnswer(new TextEncoder().encode('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n6\r\nwilson\r\n6\r\n-probe\r\n0\r\n\r\n'), 1024)
    expect(chunked.status).toBe(200)
    expect(new TextDecoder().decode(chunked.body)).toBe('wilson-probe')
    const big = parseHttpAnswer(new TextEncoder().encode(`HTTP/1.1 200 OK\r\nContent-Length: 100000\r\n\r\n${'x'.repeat(100000)}`), 64)
    expect(big.body.length).toBe(64)
    expect(S3_ANSWER_MAX_BYTES).toBe(64 * 1024)
  })
  it('without raw TLS: fetch of the vetted name with redirect: manual and a timeout, said as pinned_fetch; an opaque redirect is refused', async () => {
    const calls = []
    const fetchImpl = async (url, init) => {
      calls.push({ url, init })
      if (calls.length === 1) return { status: 0, type: 'opaqueredirect', body: null }
      return { status: 200, type: 'basic', body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('wilson-probe')); c.close() } }) }
    }
    const d = deps({ fetch: fetchImpl })
    const r1 = await s3Request({ url: SIGNED('bucket.s3.example.com'), method: 'GET', vetted, deps: d })
    expect(r1).toMatchObject({ status: 0, redirect: true, method: 'pinned_fetch', address: null })
    expect(calls[0].init.redirect).toBe('manual')
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
    const r2 = await s3Request({ url: SIGNED('bucket.s3.example.com'), method: 'PUT', body: 'wilson-probe', vetted, deps: d })
    expect(r2).toMatchObject({ status: 200, text: 'wilson-probe', redirect: false, method: 'pinned_fetch' })
    expect(new TextDecoder().decode(calls[1].init.body)).toBe('wilson-probe')
  })
})

describe('the wiring is real: the two functions that reach a bucket go through s3Reach, and nowhere else', () => {
  const secret = read('supabase', 'functions', 'storage-secret', 'index.ts')
  const gc = read('supabase', 'functions', 'storage-gc', 'index.ts')
  const helper = read('supabase', 'functions', '_shared', 's3Reach.ts')
  it('storage-secret vets the endpoint at the secret\'s save and at the probe, sends the three requests through s3Request, and refuses a redirect with its sentence', () => {
    expect(secret).toContain("import { vetS3Host, s3Request, s3ReachDeps } from '../_shared/s3Reach.ts'")
    expect(secret).not.toMatch(/await fetch\(/)
    expect((secret.match(/await vetS3Host\(/g) || []).length).toBe(2)
    expect((secret.match(/await s3Request\(\{ url: await sign\('(PUT|GET|DELETE)', serverKey\)/g) || []).length).toBe(3)
    expect(secret).toContain("return reply({ error: 'refused', detail: `${vet.detail} — the secret was not saved` }, 409)")
    expect(secret).toContain("return reply({ error: 'refused', stage: 'endpoint', detail: vetted.detail }, 409)")
    expect(secret).toContain('the bucket endpoint answered a redirect (HTTP ${status}), which WILSON does not follow')
    // The vet is per probe, the three requests share it: resolved once, one address.
    expect(secret.indexOf('const vetted = await vetS3Host(endpointHost, deps')).toBeLessThan(secret.indexOf("await s3Request({ url: await sign('PUT'"))
  })
  it('storage-gc vets the endpoint once per run and drains through s3Request; a redirect fails the row and deletes nothing', () => {
    expect(gc).toContain("import { vetS3Host, s3Request, s3ReachDeps, type VettedS3Host } from '../_shared/s3Reach.ts'")
    expect(gc).not.toMatch(/await fetch\(/)
    expect(gc).toContain("const res = await s3Request({ url, method: 'DELETE', vetted: s3.vetted, deps: s3Deps })")
    expect(gc).toContain("if (!vetted.ok) return fail(`${vetted.detail} — nothing was deleted`)")
    expect(gc).toContain('which WILSON does not follow — give the endpoint the bucket answers at directly. Nothing was deleted.')
    // S37's own rule stands beside it: a 404 is the bucket not resolving, never a success.
    expect(gc).toContain("detail: 'the bucket itself did not resolve (404)")
  })
  it('the helper is built from the reach check\'s pieces, not a second copy of them', () => {
    expect(helper).toContain("import {\n  isPublicIp, vetResolved, denoReachDeps, LOCAL_NAME_SUFFIX, SUPABASE_HOST_SUFFIX, DNS_NAME_RE,\n  type ReachDeps, type Conn,\n} from './gatewayReach.ts'".replace(/\n/g, helper.includes('\r\n') ? '\r\n' : '\n'))
    expect(helper).not.toMatch(/function classifyV4|function classifyIp/)
    expect(helper).toContain("redirect: 'manual'")
  })
})
