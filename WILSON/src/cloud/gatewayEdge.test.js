// =============================================================================
// gatewayEdge.test.js — GW1 (post-overhaul, 2026-10-10).
//
// The gateway functions' PURE parts, imported across the Deno/Node line
// (storagePresignBoundary.test.js's arrangement): the shape checks every
// function runs third (gatewayShapes.ts), the reach check's SSRF guard and
// its probe driven through a fake network (gatewayReach.ts), and the sealing
// of the signing keys (gatewayKeyCrypto.ts). The functions themselves are
// thin over these and over 0093's RPCs (suite 96); the text pins at the end
// keep the five functions to the house order and to the S33 rule.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  isInsideHost, isPrivateLiteral, cleanInsideAddresses, clientAddress, compareVersions,
  parseEnrolRequest, parseSyncRequest, parseTicketRequest, parseEventsRequest, parseReachRequest,
  webAppOrigins, isSingleCertificatePem,
} from '../../supabase/functions/_shared/gatewayShapes.ts'
import {
  classifyIp, isPublicIp, checkOutsideAddress, vetResolved, parseHealthResponse,
  probeOutside, probeInside, NONCE_HEADER,
} from '../../supabase/functions/_shared/gatewayReach.ts'
import {
  sealSigningKey, openSigningKey, GatewayKeyCryptoUnavailable,
} from '../../supabase/functions/_shared/gatewayKeyCrypto.ts'
import { makeEnrolmentToken } from '../../supabase/functions/_shared/gatewayWire.ts'

const REPO = join(__dirname, '..', '..')
const read = (...p) => readFileSync(join(REPO, ...p), 'utf8')

const PEM = '-----BEGIN CERTIFICATE-----\n' + Buffer.from(Uint8Array.from([0x30, ...Array(90).fill(0x5a)])).toString('base64') + '\n-----END CERTIFICATE-----\n'
const UUID = '0b5e8f4a-1c2d-4e3f-8a9b-0c1d2e3f4a5b'
const UUID2 = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

describe('inside addresses — what a member\'s browser may be sent to probe', () => {
  it.each([
    ['192.168.1.10', true], ['10.0.0.1', true], ['172.16.0.1', true], ['172.31.255.254', true],
    ['172.32.0.1', false], ['8.8.8.8', false], ['127.0.0.1', false], ['169.254.1.1', false],
    ['010.0.0.1', false], ['fd12:3456::1', true], ['fc00::1', true], ['fe80::1', false], ['::1', false],
    ['2001:db8::1', false], ['studio-nas', true], ['studio-nas.local', true], ['evil.example.com', false],
    ['Studio', false], ['-bad', false], ['', false],
  ])('%s → %s', (host, want) => {
    expect(isInsideHost(host)).toBe(want)
  })

  it('cleanInsideAddresses lower-cases, pairs bare hosts with inside_port, drops the rest, dedupes, caps at sixteen', () => {
    expect(cleanInsideAddresses(['192.168.1.10', 'Studio-NAS', '8.8.8.8', 'studio-nas', 42], 9443)).toEqual([
      { host: '192.168.1.10', port: 9443 }, { host: 'studio-nas', port: 9443 },
    ])
    expect(cleanInsideAddresses([{ host: '10.0.0.5', port: 8443 }, { host: '10.0.0.5', port: 0 }, { address: 'nas.local', port: 8443 }])).toEqual([
      { host: '10.0.0.5', port: 8443 }, { host: 'nas.local', port: 8443 },
    ])
    expect(cleanInsideAddresses(Array.from({ length: 40 }, (_, i) => `10.0.0.${i + 1}`))).toHaveLength(16)
    expect(cleanInsideAddresses('192.168.1.10')).toEqual([])
    expect(isPrivateLiteral('192.168.0.1')).toBe(true)
  })
})

describe('clientAddress — resolve-login\'s measured rule', () => {
  const h = (o) => new Headers(o)
  it('takes cf-connecting-ip first', () => {
    expect(clientAddress(h({ 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }))).toBe('203.0.113.5')
  })
  it('else the forwarded hop BEFORE the relay — never the caller-written first hop', () => {
    expect(clientAddress(h({ 'x-forwarded-for': '6.6.6.6, 203.0.113.5, 13.248.1.1' }))).toBe('203.0.113.5')
    expect(clientAddress(h({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9')
  })
  it('refuses anything that is not an address', () => {
    expect(clientAddress(h({ 'cf-connecting-ip': 'evil', 'x-forwarded-for': 'a, b' }))).toBeNull()
    expect(clientAddress(h({}))).toBeNull()
  })
})

describe('parseEnrolRequest — gateway-enrol\'s shape', () => {
  const body = (over = {}) => ({ platform: 'container', version: '1.0.0', hostname: 'studio-nas', root_cert_pem: PEM, inside_addresses: [{ host: '192.168.1.10', port: 8443 }], ...over })
  it('takes the token from Bearer or the body, and the gateway\'s facts', () => {
    const token = makeEnrolmentToken()
    const a = parseEnrolRequest(`Bearer ${token}`, body())
    expect(a.ok).toBe(true)
    expect(a.value.token).toBe(token)
    expect(a.value.gateway).toMatchObject({ name: 'studio-nas', platform: 'container', version: '1.0.0', hostname: 'studio-nas' })
    expect(parseEnrolRequest(null, body({ token })).ok).toBe(true)
  })
  it('refuses a malformed token before anything else (401)', () => {
    expect(parseEnrolRequest('Bearer wgt_short', body())).toMatchObject({ ok: false, status: 401, code: 'token_malformed' })
    expect(parseEnrolRequest(null, {})).toMatchObject({ ok: false, code: 'token_malformed' })
  })
  it.each([
    [{ platform: 'linux' }, 'bad_platform'], [{ version: 'one' }, 'bad_version'],
    [{ root_cert_pem: undefined }, 'bad_certificate'],
    [{ root_cert_pem: '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIA==\n-----END PRIVATE KEY-----' }, 'bad_certificate'],
    [{ root_cert_pem: PEM + PEM }, 'bad_certificate'],
  ])('refuses %j as %s', (over, code) => {
    expect(parseEnrolRequest(`Bearer ${makeEnrolmentToken()}`, body(over))).toMatchObject({ ok: false, code })
  })
  it('a public inside address never reaches the database', () => {
    const r = parseEnrolRequest(`Bearer ${makeEnrolmentToken()}`, body({ inside_addresses: ['8.8.8.8', '192.168.1.10'] }))
    expect(r.value.gateway.inside_addresses).toEqual([{ host: '192.168.1.10', port: 8443 }])
  })
  it('isSingleCertificatePem: one certificate block only', () => {
    expect(isSingleCertificatePem(PEM)).toBe(true)
    expect(isSingleCertificatePem(PEM.replace('CERTIFICATE', 'PRIVATE KEY'))).toBe(false)
    expect(isSingleCertificatePem('x'.repeat(20000))).toBe(false)
  })
})

describe('parseSyncRequest — the heartbeat, reduced to what the cloud keeps', () => {
  it('keeps reach for UUIDs and the four words only, bounds health, drops unknown keys', () => {
    const r = parseSyncRequest({
      version: '1.2.3', hostname: 'h', name: 'Studio',
      reach: { [UUID]: 'reachable', [UUID2]: 'exploded', 'not-a-uuid': 'reachable' },
      health: { doors: { inside: 'open', outside: 'open:8444', refused_public: 3, sneaky: 'x' }, update: 'u'.repeat(500), extra: 'dropped' },
      evil: true,
    })
    expect(r.ok).toBe(true)
    expect(r.report.reach).toEqual({ [UUID]: 'reachable' })
    expect(r.report.health.doors).toMatchObject({ inside: 'open', outside: 'open:8444', refused_public: 3 })
    expect(r.report.health.doors.sneaky).toBeUndefined()
    expect(r.report.health.update).toHaveLength(128)
    expect(r.report.health.extra).toBeUndefined()
    expect(r.report.evil).toBeUndefined()
  })
  it('confirm: at most 100, malformed entries dropped', () => {
    const ok = parseSyncRequest({ confirm: [{ clip: UUID, loc: UUID2, path: 'A/x.mov' }, { clip: 'x', loc: UUID2, path: 'p' }, 'junk'] })
    expect(ok.confirm).toEqual([{ clip: UUID, loc: UUID2, path: 'A/x.mov' }])
    expect(parseSyncRequest({ confirm: Array(101).fill({ clip: UUID, loc: UUID2, path: 'p' }) })).toMatchObject({ ok: false, code: 'too_many_confirm' })
    expect(parseSyncRequest(null).ok).toBe(true)
    expect(parseSyncRequest([1]).ok).toBe(false)
  })
})

describe('the other shapes', () => {
  it('parseTicketRequest: a gateway id and 1–50 lower-case clip ids, deduplicated', () => {
    expect(parseTicketRequest({ gateway_id: UUID, bin_file_ids: [UUID2, UUID2] })).toEqual({ ok: true, gatewayId: UUID, ids: [UUID2] })
    expect(parseTicketRequest({ gateway_id: UUID.toUpperCase(), bin_file_ids: [UUID2] })).toMatchObject({ ok: false, code: 'bad_gateway_id' })
    expect(parseTicketRequest({ gateway_id: UUID, bin_file_ids: [] })).toMatchObject({ ok: false, code: 'bad_ids' })
    expect(parseTicketRequest({ gateway_id: UUID, bin_file_ids: Array(51).fill(UUID2) })).toMatchObject({ ok: false, code: 'too_many' })
    expect(parseTicketRequest({ gateway_id: UUID, bin_file_ids: ['x'] })).toMatchObject({ ok: false, code: 'bad_ids' })
  })
  it('parseEventsRequest: rows, events or a bare array; 1–200; ≤ 512 KB', () => {
    expect(parseEventsRequest({ rows: [{}] }, 10)).toEqual({ ok: true, rows: [{}] })
    expect(parseEventsRequest([{}], 10).ok).toBe(true)
    expect(parseEventsRequest({ events: [{}] }, 10).ok).toBe(true)
    expect(parseEventsRequest({ rows: [] }, 10)).toMatchObject({ ok: false, code: 'empty' })
    expect(parseEventsRequest({ rows: Array(201).fill({}) }, 10)).toMatchObject({ ok: false, code: 'too_many_rows' })
    expect(parseEventsRequest({ rows: [{}] }, 600 * 1024)).toMatchObject({ ok: false, code: 'too_large' })
  })
  it('parseReachRequest and compareVersions', () => {
    expect(parseReachRequest({ gateway_id: UUID })).toEqual({ ok: true, gatewayId: UUID })
    expect(parseReachRequest({})).toMatchObject({ ok: false })
    expect(compareVersions('1.2.10', '1.2.9')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0-beta')).toBe(0)
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1)
  })
  it('webAppOrigins: https anywhere, http only on this computer, junk dropped, no duplicates', () => {
    expect(webAppOrigins('https://beta.example.com/app', 'http://localhost:5288, http://evil.com, nonsense, https://beta.example.com')).toEqual([
      'https://beta.example.com', 'http://localhost:5288',
    ])
  })
})

describe('the SSRF guard (§10 row 16)', () => {
  it.each([
    ['8.8.8.8', 'public'], ['1.1.1.1', 'public'], ['10.1.2.3', 'private'], ['172.16.5.4', 'private'],
    ['192.168.0.1', 'private'], ['127.0.0.1', 'loopback'], ['169.254.169.254', 'link_local'],
    ['100.64.0.1', 'cgnat'], ['0.0.0.0', 'unspecified'], ['224.0.0.1', 'multicast'], ['255.255.255.255', 'reserved'],
    ['198.18.0.1', 'reserved'], ['203.0.113.7', 'documentation'], ['::1', 'loopback'], ['::', 'unspecified'],
    ['fe80::1', 'link_local'], ['fd00::1', 'private'], ['ff02::1', 'multicast'], ['::ffff:127.0.0.1', 'transition'],
    ['::ffff:8.8.8.8', 'transition'], ['64:ff9b::808:808', 'transition'], ['2002:c0a8:101::1', 'transition'],
    ['2001::1', 'transition'], ['2001:db8::1', 'documentation'], ['2606:4700:4700::1111', 'public'],
    ['::127.0.0.1', 'reserved'], ['4000::1', 'reserved'], ['nonsense', 'invalid'],
  ])('%s is %s', (ip, cls) => {
    expect(classifyIp(ip)).toBe(cls)
    expect(isPublicIp(ip)).toBe(cls === 'public')
  })

  it('checkOutsideAddress: a public literal or a public name, never local, never Supabase', () => {
    expect(checkOutsideAddress({ host: 'gateway.example.com', port: 8444 })).toEqual({ ok: true, host: 'gateway.example.com', port: 8444, literal: false })
    expect(checkOutsideAddress({ host: '8.8.4.4', port: 443 })).toMatchObject({ ok: true, literal: true })
    expect(checkOutsideAddress({ host: '192.168.1.10', port: 8444 })).toEqual({ ok: false, reason: 'not_public' })
    expect(checkOutsideAddress({ host: 'nas.local', port: 8444 })).toEqual({ ok: false, reason: 'local_name' })
    expect(checkOutsideAddress({ host: 'x.localhost', port: 8444 })).toEqual({ ok: false, reason: 'local_name' })
    expect(checkOutsideAddress({ host: 'abc.supabase.co', port: 443 })).toEqual({ ok: false, reason: 'supabase_host' })
    expect(checkOutsideAddress({ host: 'my.project.example', port: 443 })).toEqual({ ok: false, reason: 'local_name' })
    expect(checkOutsideAddress({ host: 'gw.company.com', port: 443 }, 'gw.company.com')).toEqual({ ok: false, reason: 'supabase_host' })
    expect(checkOutsideAddress({ host: 'localhost', port: 8444 })).toEqual({ ok: false, reason: 'malformed' })
    expect(checkOutsideAddress({ host: 'gateway.example.com', port: 0 })).toEqual({ ok: false, reason: 'malformed' })
    expect(checkOutsideAddress({ host: 'Gateway.Example.com', port: 8444 })).toEqual({ ok: false, reason: 'malformed' })
    expect(checkOutsideAddress(null)).toEqual({ ok: false, reason: 'malformed' })
  })

  it('vetResolved: every answer public, at least one', () => {
    expect(vetResolved(['8.8.8.8', '2606:4700:4700::1111'])).toEqual({ ok: true, addresses: ['8.8.8.8', '2606:4700:4700::1111'] })
    expect(vetResolved(['8.8.8.8', '10.0.0.5'])).toEqual({ ok: false, reason: 'not_public', address: '10.0.0.5' })
    expect(vetResolved([])).toEqual({ ok: false, reason: 'no_address' })
  })

  it('parseHealthResponse: the status, the echo, a redirect, chunked bodies', () => {
    expect(parseHealthResponse('HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n{"ok":true,"nonce_echo":"abc"}')).toEqual({ status: 200, nonceEcho: 'abc', redirect: false })
    expect(parseHealthResponse('HTTP/1.1 302 Found\r\nlocation: http://10.0.0.1/\r\n\r\n')).toEqual({ status: 302, nonceEcho: null, redirect: true })
    expect(parseHealthResponse('HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n1f\r\n{"ok":true,"nonce_echo":"abc"}\r\n0\r\n\r\n')).toMatchObject({ nonceEcho: 'abc' })
    expect(parseHealthResponse('SSH-2.0-OpenSSH_9.0')).toBeNull()
  })
})

// A fake network: records what it was asked, answers what the test says.
function fakeNet({ resolve = ['93.184.215.14'], tls, tcp, fetchImpl } = {}) {
  const calls = { resolve: [], tls: [], tcp: [], fetch: [] }
  const deps = {
    now: () => Date.now(),
    resolve: async (name) => { calls.resolve.push(name); return resolve },
  }
  if (tls) {
    deps.connectTls = async (ip, port, serverName) => {
      calls.tls.push({ ip, port, serverName })
      return tls(ip, port, serverName)
    }
  }
  if (tcp) deps.connectTcp = async (ip, port) => { calls.tcp.push({ ip, port }); return tcp(ip, port) }
  if (fetchImpl) deps.fetch = async (url, init) => { calls.fetch.push({ url, init }); return fetchImpl(url, init) }
  return { deps, calls }
}
function connAnswering(text) {
  let sent = ''
  let done = false
  return {
    get sent() { return sent },
    write: async (b) => { sent += new TextDecoder().decode(b); return b.length },
    read: async (buf) => {
      if (done) return null
      done = true
      const bytes = new TextEncoder().encode(text).subarray(0, buf.length)
      buf.set(bytes)
      return bytes.length
    },
    close: () => {},
  }
}

describe('probeOutside — the probe through a fake network', () => {
  const addr = { host: 'gateway.example.com', port: 8444 }
  const nonce = '0123456789abcdef0123456789abcdef'

  it('🚨 resolves ONCE, vets, and connects to the validated LITERAL with the name as SNI only; the nonce rides a header', async () => {
    let conn
    const { deps, calls } = fakeNet({ tls: () => (conn = connAnswering(`HTTP/1.1 200 OK\r\n\r\n{"ok":true,"nonce_echo":"${nonce}"}`)) })
    const r = await probeOutside(addr, nonce, { switchOn: true }, deps)
    expect(r).toMatchObject({ ok: true, detail: 'reached', is_this_gateway: true, method: 'literal_tls', certificate: 'ok', address: '93.184.215.14' })
    expect(calls.resolve).toEqual(['gateway.example.com'])
    expect(calls.tls).toEqual([{ ip: '93.184.215.14', port: 8444, serverName: 'gateway.example.com' }])
    expect(conn.sent).toMatch(/^GET \/v1\/health HTTP\/1\.1\r\n/)
    expect(NONCE_HEADER).toBe('Wilson-Reach-Nonce') // the header GW2's /v1/health reads (the hand-off's API for GW2 and GW3)
    expect(conn.sent).toContain(`Wilson-Reach-Nonce: ${nonce}\r\n`)
    expect(conn.sent).toContain('Host: gateway.example.com:8444\r\n')
  })

  it('🚨 a name resolving to a private address contacts nothing', async () => {
    const { deps, calls } = fakeNet({ resolve: ['10.0.0.5'], tls: () => { throw new Error('must not connect') } })
    expect(await probeOutside(addr, nonce, { switchOn: true }, deps)).toMatchObject({ ok: false, detail: 'not_public', address: '10.0.0.5' })
    expect(calls.tls).toEqual([])
  })

  it('one private answer among public ones is enough to refuse (DNS rebinding through a mixed answer)', async () => {
    const { deps, calls } = fakeNet({ resolve: ['8.8.8.8', '127.0.0.1'], tls: () => { throw new Error('must not connect') } })
    expect(await probeOutside(addr, nonce, { switchOn: true }, deps)).toMatchObject({ detail: 'not_public' })
    expect(calls.tls).toEqual([])
  })

  it('no answer is dns; a Supabase host and a local name are refused before resolving', async () => {
    const empty = fakeNet({ resolve: [] })
    expect(await probeOutside(addr, nonce, { switchOn: true }, empty.deps)).toMatchObject({ detail: 'dns' })
    const sb = fakeNet()
    expect(await probeOutside({ host: 'xyz.supabase.co', port: 443 }, nonce, { switchOn: true }, sb.deps)).toMatchObject({ detail: 'supabase_host' })
    expect(sb.calls.resolve).toEqual([])
    expect(await probeOutside({ host: 'gw.internal', port: 443 }, nonce, { switchOn: true }, sb.deps)).toMatchObject({ detail: 'local_name' })
  })

  it('an answer without the echo, or with the wrong one, is not this gateway; a redirect is never followed', async () => {
    const wrong = fakeNet({ tls: () => connAnswering('HTTP/1.1 200 OK\r\n\r\n{"ok":true,"nonce_echo":"nope"}') })
    expect(await probeOutside(addr, nonce, { switchOn: true }, wrong.deps)).toMatchObject({ ok: false, detail: 'not_this_gateway', is_this_gateway: false })
    const redirect = fakeNet({ tls: () => connAnswering('HTTP/1.1 302 Found\r\nLocation: https://10.0.0.1/\r\n\r\n') })
    expect(await probeOutside(addr, nonce, { switchOn: true }, redirect.deps)).toMatchObject({ detail: 'not_this_gateway' })
    expect(redirect.calls.tls).toHaveLength(1)
    const echoNot200 = fakeNet({ tls: () => connAnswering(`HTTP/1.1 404 Not Found\r\n\r\n{"nonce_echo":"${nonce}"}`) })
    expect(await probeOutside(addr, nonce, { switchOn: true }, echoNot200.deps)).toMatchObject({ detail: 'not_this_gateway' })
  })

  it('refused, a certificate failure and silence each have their word; with the switch off the first and last are the §4b proof', async () => {
    const refused = fakeNet({ tls: () => { throw Object.assign(new Error('Connection refused (os error 111)'), { name: 'ConnectionRefused' }) } })
    expect(await probeOutside(addr, nonce, { switchOn: true }, refused.deps)).toMatchObject({ detail: 'refused' })
    expect(await probeOutside(addr, nonce, { switchOn: false }, refused.deps)).toMatchObject({ detail: 'switch_off', ok: false })
    const cert = fakeNet({ tls: () => { throw new Error('invalid peer certificate: UnknownIssuer') } })
    expect(await probeOutside(addr, nonce, { switchOn: true }, cert.deps)).toMatchObject({ detail: 'certificate', certificate: 'untrusted' })
    const silent = fakeNet({ tls: () => new Promise(() => {}) })
    expect(await probeOutside(addr, nonce, { switchOn: true, timeoutMs: 40 }, silent.deps)).toMatchObject({ detail: 'timed_out' })
    expect(await probeOutside(addr, nonce, { switchOn: false, timeoutMs: 40 }, silent.deps)).toMatchObject({ detail: 'switch_off' })
  })

  it('reads at most 4 KB of an answer: an echo past the first 4 KB is never seen', async () => {
    const late = JSON.stringify({ pad: 'x'.repeat(5000), nonce_echo: nonce })
    const big = fakeNet({ tls: () => connAnswering('HTTP/1.1 200 OK\r\n\r\n' + late) })
    expect(await probeOutside(addr, nonce, { switchOn: true }, big.deps)).toMatchObject({ detail: 'not_this_gateway', is_this_gateway: false })
    const early = JSON.stringify({ nonce_echo: nonce, pad: 'x'.repeat(100) })
    const small = fakeNet({ tls: () => connAnswering('HTTP/1.1 200 OK\r\n\r\n' + early) })
    expect(await probeOutside(addr, nonce, { switchOn: true }, small.deps)).toMatchObject({ detail: 'reached' })
  })

  it('a public literal is contacted as itself, with no resolution', async () => {
    const lit = fakeNet({ tls: () => connAnswering(`HTTP/1.1 200 OK\r\n\r\n{"nonce_echo":"${nonce}"}`) })
    expect(await probeOutside({ host: '8.8.4.4', port: 443 }, nonce, { switchOn: true }, lit.deps)).toMatchObject({ ok: true, address: '8.8.4.4' })
    expect(lit.calls.resolve).toEqual([])
  })

  it('without raw TLS the probe falls back to a fetch of the vetted name, manual redirects, and says so', async () => {
    const fb = fakeNet({
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, nonce_echo: nonce }), { status: 200 }),
    })
    const r = await probeOutside(addr, nonce, { switchOn: true }, fb.deps)
    expect(r).toMatchObject({ ok: true, method: 'pinned_fetch' })
    expect(fb.calls.fetch[0].url).toBe('https://gateway.example.com:8444/v1/health')
    expect(fb.calls.fetch[0].init.redirect).toBe('manual')
    expect(fb.calls.fetch[0].init.headers[NONCE_HEADER]).toBe(nonce)
    const fbPrivate = fakeNet({ resolve: ['192.168.0.9'], fetchImpl: async () => { throw new Error('must not fetch') } })
    expect(await probeOutside(addr, nonce, { switchOn: true }, fbPrivate.deps)).toMatchObject({ detail: 'not_public' })
    expect(fbPrivate.calls.fetch).toEqual([])
  })
})

describe('probeInside — the inside port must not answer from the internet', () => {
  it('a TCP accept on a public address is the red line; a refusal is not; a private address is never tried', async () => {
    const open = fakeNet({ tcp: async () => ({ close() {} }) })
    expect(await probeInside(['8.8.4.4'], 8443, open.deps)).toBe(true)
    const shut = fakeNet({ tcp: async () => { throw new Error('Connection refused') } })
    expect(await probeInside(['8.8.4.4'], 8443, shut.deps)).toBe(false)
    const priv = fakeNet({ tcp: async () => ({ close() {} }) })
    expect(await probeInside(['10.0.0.1'], 8443, priv.deps)).toBe(false)
    expect(priv.calls.tcp).toEqual([])
  })
})

describe('the signing keys, sealed (gatewayKeyCrypto.ts)', () => {
  const master = Buffer.alloc(32, 7).toString('base64')
  const other = Buffer.alloc(32, 9).toString('base64')
  const WS = '11111111-1111-1111-1111-111111111111'
  it('seals and opens; a fresh IV every time', async () => {
    const a = await sealSigningKey('pkcs8-bytes', WS, 'k1', master)
    const b = await sealSigningKey('pkcs8-bytes', WS, 'k1', master)
    expect(a).not.toBe(b)
    expect(await openSigningKey(a, WS, 'k1', master)).toBe('pkcs8-bytes')
  })
  it('🚨 a sealed key does not open for another workspace, another kid or another master key', async () => {
    const sealed = await sealSigningKey('pkcs8-bytes', WS, 'k1', master)
    await expect(openSigningKey(sealed, '22222222-2222-2222-2222-222222222222', 'k1', master)).rejects.toThrow()
    await expect(openSigningKey(sealed, WS, 'k2', master)).rejects.toThrow()
    await expect(openSigningKey(sealed, WS, 'k1', other)).rejects.toThrow()
  })
  it('refuses a short master key and names a missing one', async () => {
    await expect(sealSigningKey('x', WS, 'k1', Buffer.alloc(16).toString('base64'))).rejects.toThrow(/exactly 32 bytes/)
    await expect(sealSigningKey('x', WS, 'k1', '')).rejects.toBeInstanceOf(GatewayKeyCryptoUnavailable)
  })
})

describe('the five functions keep the house order and the S33 rule (text pins)', () => {
  const fn = (name) => read('supabase', 'functions', name, 'index.ts')
  const order = (src, marks) => marks.map((m) => src.indexOf(m))
  it('each refuses in order: the caller, the rate limit, the shape, the predicate', () => {
    const enrol = fn('gateway-enrol')
    const [shape1, limit, pred] = order(enrol, ['parseEnrolRequest(', "isRateLimited(admin, 'gateway-enrol'", "rpc('gateway_enrol_apply'"])
    expect(shape1).toBeGreaterThan(0)
    expect(limit).toBeGreaterThan(shape1)
    expect(pred).toBeGreaterThan(limit)
    for (const [name, guard, bucket, parse, rpc] of [
      ['gateway-sync', 'requireGateway(req)', "'gateway-sync'", 'parseSyncRequest(', "rpc('gateway_sync_apply'"],
      ['gateway-events', 'requireGateway(req)', "'gateway-events'", 'parseEventsRequest(', "rpc('gateway_events_apply'"],
      ['gateway-ticket', 'requireActiveMember(req)', "'gateway-ticket'", 'parseTicketRequest(', "rpc('gateway_clips_for_tickets'"],
      ['gateway-reach', 'requireActiveMember(req)', "'gateway-reach'", 'parseReachRequest(', "rpc('gateway_reach_begin'"],
    ]) {
      const src = fn(name)
      const at = order(src, [guard, bucket, parse, rpc])
      expect([name, at.every((v) => v > 0)]).toEqual([name, true])
      expect([name, at[0] < at[1] && at[1] < at[2] && at[2] < at[3]]).toEqual([name, true])
    }
  })
  it('the limiters fail closed on enrol and events, open on ticket, sync and reach (D27)', () => {
    expect(fn('gateway-enrol')).toMatch(/'gateway-enrol'[\s\S]*?failOpen: false/)
    expect(fn('gateway-events')).toMatch(/'gateway-events'[\s\S]*?failOpen: false/)
    for (const name of ['gateway-ticket', 'gateway-sync', 'gateway-reach']) expect([name, fn(name).includes('failOpen: false')]).toEqual([name, false])
  })
  it('🚨 the ticket\'s predicates run AS THE CALLER (an anon-key client carrying their token), never the service role', () => {
    const src = fn('gateway-ticket')
    expect(src).toMatch(/asCaller\s*\.from\('gateways_visible'\)/)
    expect(src).toMatch(/asCaller\.rpc\('gateway_clips_for_tickets'/)
    expect(src).toContain("Deno.env.get('SUPABASE_ANON_KEY')")
    expect(src).not.toMatch(/ctx\.admin\.rpc\('gateway_clips_for_tickets'/)
    expect(src).toMatch(/from\('gateway_ticket_mints'\)\.insert\(mints\)[\s\S]*?return answer\(/)
  })
  it('every function is registered with verify_jwt = false', () => {
    const toml = read('supabase', 'config.toml')
    for (const name of ['gateway-enrol', 'gateway-sync', 'gateway-events', 'gateway-ticket', 'gateway-reach']) {
      expect([name, new RegExp(`\\[functions\\.${name}\\]\\s*\\nverify_jwt = false`).test(toml)]).toEqual([name, true])
    }
  })
})
