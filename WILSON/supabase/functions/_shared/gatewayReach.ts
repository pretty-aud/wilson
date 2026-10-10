// =============================================================================
// _shared/gatewayReach.ts — GW1 (post-overhaul, 2026-10-10): the reach check's
// SSRF guard and its probe (GATEWAY_DESIGN.md §4, §10 row 16).
//
// The cloud connects to ONE thing an admin typed — the gateway's registered
// outside address — and must never become a way to reach Petal's own
// services or anyone's private network. So, in this order:
//
//   1. the address itself: { host, port }; a public literal, or a public DNS
//      name that is not local, reserved, or a Supabase host (checkOutsideAddress)
//   2. a name is RESOLVED, and every answer must be public (vetResolved): one
//      private, loopback, link-local, CGNAT, multicast, reserved or
//      transition address and nothing is contacted
//   3. the connection goes to the validated address LITERAL, the name used
//      only for SNI and ordinary public certificate verification, so no
//      second resolution can swap the target (review round 1, F12)
//   4. GET /v1/health, the nonce in `Wilson-Reach-Nonce`, 5 s for the whole
//      exchange, 4 KB read at most, redirects never followed, no body sent
//   5. reached ONLY when the answer carries `nonce_proof`, the HMAC of the
//      nonce under the credential's hash (gatewayWire.reachProof), which only
//      the enrolled gateway can make (F16). GW1's review round 1, finding 1:
//      the design's plain echo proved nothing, since the nonce rides the
//      request and any server reflecting a header would pass
//   6. the INSIDE port is tried on the same public addresses and should be
//      refused or time out; a TCP accept there is the red line (§4)
//
// The network is injected (ReachDeps), so the whole decision is unit-tested
// in Node (src/cloud/gatewayEdge.test.js); denoReachDeps() is the real one.
// If the runtime has no raw TCP + startTls, the probe falls back to fetch of
// the name after the same resolution and vetting (method 'pinned_fetch'),
// and says so in its result — fetch resolves the name again itself, which
// is the residual the brief names for that case.
// =============================================================================

import { parseIpv4, parseIpv6 } from './gatewayShapes.ts'
import { timingSafeEqual } from './gatewayWire.ts'

export type IpClass =
  | 'public' | 'loopback' | 'private' | 'link_local' | 'cgnat' | 'multicast'
  | 'unspecified' | 'reserved' | 'documentation' | 'transition' | 'invalid'

function inV4(a: number[], net: number[], bits: number): boolean {
  const ip = ((a[0] << 24) | (a[1] << 16) | (a[2] << 8) | a[3]) >>> 0
  const n = ((net[0] << 24) | (net[1] << 16) | (net[2] << 8) | net[3]) >>> 0
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return ((ip & mask) >>> 0) === ((n & mask) >>> 0)
}

function classifyV4(a: number[]): IpClass {
  if (inV4(a, [0, 0, 0, 0], 8)) return 'unspecified'
  if (inV4(a, [10, 0, 0, 0], 8) || inV4(a, [172, 16, 0, 0], 12) || inV4(a, [192, 168, 0, 0], 16)) return 'private'
  if (inV4(a, [100, 64, 0, 0], 10)) return 'cgnat'
  if (inV4(a, [127, 0, 0, 0], 8)) return 'loopback'
  if (inV4(a, [169, 254, 0, 0], 16)) return 'link_local'
  if (inV4(a, [192, 0, 2, 0], 24) || inV4(a, [198, 51, 100, 0], 24) || inV4(a, [203, 0, 113, 0], 24)) return 'documentation'
  if (inV4(a, [192, 88, 99, 0], 24)) return 'transition'
  if (inV4(a, [192, 0, 0, 0], 24) || inV4(a, [198, 18, 0, 0], 15)) return 'reserved'
  if (inV4(a, [224, 0, 0, 0], 4)) return 'multicast'
  if (inV4(a, [240, 0, 0, 0], 4)) return 'reserved'
  return 'public'
}

/** Every address class the guard knows; only 'public' may be contacted. */
export function classifyIp(ip: string): IpClass {
  const v4 = parseIpv4(ip)
  if (v4) return classifyV4(v4)
  const g = parseIpv6(ip)
  if (!g) return 'invalid'
  if (g.every((x) => x === 0)) return 'unspecified'
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return 'loopback'
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return 'transition' // ::ffff:a.b.c.d
  if (g.slice(0, 6).every((x) => x === 0)) return 'reserved'                     // ::a.b.c.d (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b && (g.slice(2, 6).every((x) => x === 0) || g[2] === 1)) return 'transition' // NAT64
  if (g[0] === 0x100 && g.slice(1, 4).every((x) => x === 0)) return 'reserved'    // 100::/64 discard
  if (g[0] === 0x2001 && g[1] === 0xdb8) return 'documentation'
  if (g[0] === 0x2001 && g[1] === 0) return 'transition'                          // Teredo 2001::/32
  if (g[0] === 0x2002) return 'transition'                                        // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return 'private'
  if ((g[0] & 0xffc0) === 0xfe80) return 'link_local'
  if ((g[0] & 0xff00) === 0xff00) return 'multicast'
  if ((g[0] & 0xe000) !== 0x2000) return 'reserved'                               // outside 2000::/3
  return 'public'
}

export function isPublicIp(ip: string): boolean {
  return classifyIp(ip) === 'public'
}

const LOCAL_SUFFIX = /\.(local|localhost|internal|intranet|lan|home|corp|localdomain|home\.arpa|invalid|test|example|onion)$/
const SUPABASE_SUFFIX = /(^|\.)supabase\.(co|in|net|com)$/
const NAME_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/

export type AddressCheck =
  | { ok: true; host: string; port: number; literal: boolean }
  | { ok: false; reason: 'malformed' | 'not_public' | 'local_name' | 'supabase_host' }

/** Step 1: the address an admin set (0093's gateway_outside_address_ok, restated). */
export function checkOutsideAddress(address: unknown, supabaseHost?: string): AddressCheck {
  if (!address || typeof address !== 'object' || Array.isArray(address)) return { ok: false, reason: 'malformed' }
  const { host, port } = address as Record<string, unknown>
  if (typeof host !== 'string' || typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, reason: 'malformed' }
  }
  if (host.length < 1 || host.length > 253) return { ok: false, reason: 'malformed' }
  if (parseIpv4(host) || parseIpv6(host)) {
    return isPublicIp(host) ? { ok: true, host, port, literal: true } : { ok: false, reason: 'not_public' }
  }
  if (!NAME_RE.test(host)) return { ok: false, reason: 'malformed' }
  if (host === 'localhost' || LOCAL_SUFFIX.test(host)) return { ok: false, reason: 'local_name' }
  if (SUPABASE_SUFFIX.test(host) || (supabaseHost && host === supabaseHost.toLowerCase())) {
    return { ok: false, reason: 'supabase_host' }
  }
  return { ok: true, host, port, literal: false }
}

/** Step 2: every resolved address must be public, and there must be one. */
export function vetResolved(addresses: string[]): { ok: true; addresses: string[] } | { ok: false; reason: 'no_address' | 'not_public'; address?: string } {
  const unique = [...new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean))]
  if (unique.length === 0) return { ok: false, reason: 'no_address' }
  for (const a of unique) {
    if (!isPublicIp(a)) return { ok: false, reason: 'not_public', address: a }
  }
  return { ok: true, addresses: unique }
}

// ── The HTTP answer ──────────────────────────────────────────────────────────

export type HealthAnswer = { status: number; nonceProof: string | null; redirect: boolean }

/** Parse a raw HTTP/1.x response (headers + at most 4 KB) for the status and the nonce's proof. */
export function parseHealthResponse(raw: string): HealthAnswer | null {
  const headEnd = raw.indexOf('\r\n\r\n')
  const head = headEnd >= 0 ? raw.slice(0, headEnd) : raw
  const m = /^HTTP\/1\.[01] (\d{3})/.exec(head)
  if (!m) return null
  const status = Number(m[1])
  let body = headEnd >= 0 ? raw.slice(headEnd + 4) : ''
  if (/\r\ntransfer-encoding:\s*chunked/i.test(head)) {
    let out = ''
    let rest = body
    for (;;) {
      const nl = rest.indexOf('\r\n')
      if (nl < 0) break
      const size = parseInt(rest.slice(0, nl), 16)
      if (!Number.isFinite(size) || size <= 0) break
      out += rest.slice(nl + 2, nl + 2 + size)
      rest = rest.slice(nl + 2 + size + 2)
    }
    body = out
  }
  let nonceProof: string | null = null
  if (status === 200) {
    try {
      const j = JSON.parse(body)
      if (j && typeof j === 'object' && typeof j.nonce_proof === 'string') nonceProof = j.nonce_proof
    } catch { /* not JSON: not our gateway */ }
  }
  return { status, nonceProof, redirect: status >= 300 && status < 400 }
}

// ── The probe ────────────────────────────────────────────────────────────────

export type Conn = {
  write(b: Uint8Array): Promise<number>
  read(b: Uint8Array): Promise<number | null>
  close(): void
}

export type ReachDeps = {
  /** A and AAAA answers for a name. */
  resolve(name: string): Promise<string[]>
  /** TCP to the literal, then TLS with serverName for SNI and verification. Absent where the runtime cannot. */
  connectTls?: (ip: string, port: number, serverName: string, timeoutMs: number) => Promise<Conn>
  /** A bare TCP connect (the inside-port test). */
  connectTcp?: (ip: string, port: number, timeoutMs: number) => Promise<{ close(): void }>
  /** The fallback when there is no connectTls: fetch of the (vetted) name. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>
  now(): number
}

export type OutsideResult = {
  ok: boolean
  detail: 'reached' | 'timed_out' | 'refused' | 'certificate' | 'not_this_gateway' | 'switch_off'
        | 'not_public' | 'dns' | 'malformed' | 'local_name' | 'supabase_host' | 'gateway_not_syncing'
  ms: number | null
  certificate: 'ok' | 'untrusted' | 'unknown'
  is_this_gateway: boolean
  method: 'literal_tls' | 'pinned_fetch' | 'none'
  address: string | null
  /** An expected proof was there to compare with (the credential's hash was read). */
  proof_checked: boolean
}

export const NONCE_HEADER = 'Wilson-Reach-Nonce'
export const PROBE_TIMEOUT_MS = 5000
export const PROBE_MAX_BYTES = 4096

// Review round 1, note 5: only a certificate's own failure is 'certificate'.
// Any other TLS failure (a plain-HTTP listener, a broken handshake) means
// something answered that does not speak the gateway's TLS: 'protocol'.
function classifyError(e: unknown): 'certificate' | 'refused' | 'timed_out' | 'protocol' {
  const msg = `${(e as Error)?.name ?? ''} ${(e as Error)?.message ?? String(e)}`
  if (/certificate|UnknownIssuer|NotValidForName|BadCertificate|CertExpired|CertNotValid|self.signed/i.test(msg)) return 'certificate'
  if (/refused|ECONNREFUSED|ConnectionRefused|reset|ECONNRESET/i.test(msg)) return 'refused'
  if (/TimedOut|timed out|timeout/i.test(msg)) return 'timed_out'
  if (/tls|handshake|InvalidData|corrupt|record|alert|UnexpectedEof|eof/i.test(msg)) return 'protocol'
  return 'timed_out'
}

/**
 * The inside port the check knocks on, or null when it must not: the same
 * port as the outside address's would knock on the outside door itself and
 * raise the red line falsely (review round 1, finding 3).
 */
export function insidePortToProbe(insidePort: unknown, outsidePort: unknown): number | null {
  const p = Number(insidePort)
  if (!Number.isInteger(p) || p < 1 || p > 65535) return null
  return p === Number(outsidePort) ? null : p
}

async function withDeadline<T>(p: Promise<T>, ms: number, onLate?: (v: T) => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let done = false
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      if (!done) reject(Object.assign(new Error('timed out'), { name: 'TimedOut' }))
    }, Math.max(1, ms))
  })
  try {
    return await Promise.race([p, timeout])
  } catch (e) {
    p.then((v) => { if (onLate) onLate(v) }, () => {})
    throw e
  } finally {
    done = true
    if (timer) clearTimeout(timer)
  }
}

async function readUpTo(conn: Conn, max: number, deadline: number, now: () => number): Promise<string> {
  const buf = new Uint8Array(max)
  let n = 0
  while (n < max) {
    const left = deadline - now()
    if (left <= 0) break
    let got: number | null
    try {
      got = await withDeadline(conn.read(buf.subarray(n)), left)
    } catch {
      break
    }
    if (got === null) break
    n += got
  }
  return new TextDecoder().decode(buf.subarray(0, n))
}

/**
 * Steps 2–5 for the outside address. `switchOn` turns a refusal or a
 * timeout into the §4b proof's own line ('switch_off': nothing answers from
 * outside while the switch is off, which is what the check should find).
 */
export async function probeOutside(
  address: unknown, nonce: string,
  opts: { switchOn: boolean; supabaseHost?: string; timeoutMs?: number; expectedProof?: string | null },
  deps: ReachDeps,
): Promise<OutsideResult> {
  const limit = opts.timeoutMs ?? PROBE_TIMEOUT_MS
  // Review round 1, finding 1: the host is this gateway only when it answers
  // the proof only the credential's holder can make (gatewayWire.reachProof);
  // with no expected proof to compare, nothing is ever "reached".
  const expected = typeof opts.expectedProof === 'string' && /^[0-9a-f]{64}$/.test(opts.expectedProof) ? opts.expectedProof : null
  const proves = (got: string | null): boolean => expected !== null && typeof got === 'string' && /^[0-9a-f]{64}$/.test(got) && timingSafeEqual(got, expected)
  const proof_checked = expected !== null
  const base = { ms: null, certificate: 'unknown' as const, is_this_gateway: false, method: 'none' as const, address: null, proof_checked }
  const chk = checkOutsideAddress(address, opts.supabaseHost)
  if (!chk.ok) return { ok: false, detail: chk.reason, ...base }
  let addresses: string[]
  if (chk.literal) {
    addresses = [chk.host]
  } else {
    let resolved: string[] = []
    try {
      resolved = await withDeadline(deps.resolve(chk.host), limit)
    } catch {
      resolved = []
    }
    const vet = vetResolved(resolved)
    if (!vet.ok) {
      return { ok: false, detail: vet.reason === 'no_address' ? 'dns' : 'not_public', ...base, address: vet.address ?? null }
    }
    addresses = vet.addresses
  }
  const target = addresses[0]
  const started = deps.now()
  const deadline = started + limit
  // Review round 1, note 5: an IPv6 literal is bracketed on every port.
  const hostName = chk.literal && chk.host.includes(':') ? `[${chk.host}]` : chk.host
  const hostHeader = chk.port === 443 ? hostName : `${hostName}:${chk.port}`
  const request = `GET /v1/health HTTP/1.1\r\nHost: ${hostHeader}\r\nUser-Agent: WILSON-reach-check/1\r\nAccept: application/json\r\n${NONCE_HEADER}: ${nonce}\r\nConnection: close\r\n\r\n`
  const offDetail = (d: 'refused' | 'timed_out'): OutsideResult['detail'] => (opts.switchOn ? d : 'switch_off')

  if (deps.connectTls) {
    let conn: Conn
    try {
      conn = await withDeadline(deps.connectTls(target, chk.port, chk.host, limit), limit, (late) => late.close())
    } catch (e) {
      const kind = classifyError(e)
      const ms = deps.now() - started
      if (kind === 'certificate') {
        return { ok: false, detail: 'certificate', ms, certificate: 'untrusted', is_this_gateway: false, method: 'literal_tls', address: target, proof_checked }
      }
      if (kind === 'protocol') {
        return { ok: false, detail: 'not_this_gateway', ms, certificate: 'unknown', is_this_gateway: false, method: 'literal_tls', address: target, proof_checked }
      }
      return { ok: false, detail: offDetail(kind), ms, certificate: 'unknown', is_this_gateway: false, method: 'literal_tls', address: target, proof_checked }
    }
    let raw = ''
    try {
      await withDeadline(conn.write(new TextEncoder().encode(request)), Math.max(1, deadline - deps.now()))
      raw = await readUpTo(conn, PROBE_MAX_BYTES, deadline, deps.now)
    } catch {
      raw = ''
    } finally {
      try { conn.close() } catch { /* closed */ }
    }
    const ms = deps.now() - started
    const answer = parseHealthResponse(raw)
    if (!answer) {
      return { ok: false, detail: 'not_this_gateway', ms, certificate: 'ok', is_this_gateway: false, method: 'literal_tls', address: target, proof_checked }
    }
    const mine = !answer.redirect && answer.status === 200 && proves(answer.nonceProof)
    return { ok: mine, detail: mine ? 'reached' : 'not_this_gateway', ms, certificate: 'ok', is_this_gateway: mine, method: 'literal_tls', address: target, proof_checked }
  }

  if (!deps.fetch) return { ok: false, detail: 'timed_out', ...base }
  const url = `https://${chk.literal && chk.host.includes(':') ? `[${chk.host}]` : chk.host}:${chk.port}/v1/health`
  try {
    const res = await deps.fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { [NONCE_HEADER]: nonce, accept: 'application/json', 'user-agent': 'WILSON-reach-check/1' },
      signal: AbortSignal.timeout(limit),
    })
    let text = ''
    if (res.body) {
      const reader = res.body.getReader()
      let total = 0
      const parts: Uint8Array[] = []
      while (total < PROBE_MAX_BYTES) {
        const { value, done } = await reader.read()
        if (done || !value) break
        parts.push(value)
        total += value.length
      }
      try { await reader.cancel() } catch { /* done */ }
      const all = new Uint8Array(Math.min(total, PROBE_MAX_BYTES))
      let off = 0
      for (const p of parts) {
        const take = Math.min(p.length, all.length - off)
        all.set(p.subarray(0, take), off)
        off += take
        if (off >= all.length) break
      }
      text = new TextDecoder().decode(all)
    }
    const ms = deps.now() - started
    let proof: string | null = null
    if (res.status === 200) {
      try { const j = JSON.parse(text); proof = typeof j?.nonce_proof === 'string' ? j.nonce_proof : null } catch { proof = null }
    }
    const redirect = res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)
    const mine = !redirect && res.status === 200 && proves(proof)
    return { ok: mine, detail: mine ? 'reached' : 'not_this_gateway', ms, certificate: 'ok', is_this_gateway: mine, method: 'pinned_fetch', address: target, proof_checked }
  } catch (e) {
    const kind = classifyError(e)
    const ms = deps.now() - started
    if (kind === 'certificate') {
      return { ok: false, detail: 'certificate', ms, certificate: 'untrusted', is_this_gateway: false, method: 'pinned_fetch', address: target, proof_checked }
    }
    if (kind === 'protocol') {
      return { ok: false, detail: 'not_this_gateway', ms, certificate: 'unknown', is_this_gateway: false, method: 'pinned_fetch', address: target, proof_checked }
    }
    return { ok: false, detail: offDetail(kind), ms, certificate: 'unknown', is_this_gateway: false, method: 'pinned_fetch', address: target, proof_checked }
  }
}

/**
 * Step 6: does anything accept a TCP connection on the INSIDE port at the
 * same public addresses? It should not (§4's red line). Only addresses the
 * outside step already vetted as public are ever tried.
 */
export async function probeInside(publicAddresses: string[], port: number, deps: ReachDeps): Promise<boolean> {
  for (const ip of publicAddresses.slice(0, 2)) {
    if (!isPublicIp(ip)) continue
    if (deps.connectTcp) {
      try {
        const c = await withDeadline(deps.connectTcp(ip, port, 3000), 3000, (late) => late.close())
        try { c.close() } catch { /* closed */ }
        return true
      } catch {
        continue
      }
    }
    if (deps.fetch) {
      const host = ip.includes(':') ? `[${ip}]` : ip
      try {
        await deps.fetch(`https://${host}:${port}/`, { redirect: 'manual', signal: AbortSignal.timeout(3000) })
        return true
      } catch (e) {
        const k = classifyError(e)
        if (k === 'certificate' || k === 'protocol') return true
      }
    }
  }
  return false
}

/** The real network: Deno's raw TCP + startTls where the runtime has them, fetch otherwise. */
export function denoReachDeps(): ReachDeps {
  // deno-lint-ignore no-explicit-any
  const D: any = (globalThis as any).Deno
  const resolve = async (name: string): Promise<string[]> => {
    if (typeof D?.resolveDns === 'function') {
      const out: string[] = []
      for (const type of ['A', 'AAAA']) {
        try { out.push(...(await D.resolveDns(name, type))) } catch { /* no records of this type */ }
      }
      if (out.length) return out
    }
    // DNS over HTTPS, one answer set, pinned by the caller's vetting.
    const out: string[] = []
    for (const [type, code] of [['A', 1], ['AAAA', 28]] as const) {
      try {
        const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, {
          headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(3000),
        })
        const j = await r.json()
        for (const a of j?.Answer ?? []) if (a?.type === code && typeof a.data === 'string') out.push(a.data)
      } catch { /* none */ }
    }
    return out
  }
  const deps: ReachDeps = { resolve, now: () => Date.now(), fetch: (u, i) => fetch(u, i) }
  if (typeof D?.connect === 'function') {
    deps.connectTcp = async (ip, port) => await D.connect({ hostname: ip, port, transport: 'tcp' })
    if (typeof D?.startTls === 'function') {
      // Review round 1, note 5: the connect and the handshake share one
      // deadline, and the TCP socket is closed when it passes — a peer that
      // never finishes the handshake must not hold a socket per check.
      deps.connectTls = async (ip, port, serverName, timeoutMs = PROBE_TIMEOUT_MS) => {
        // deno-lint-ignore no-explicit-any
        let tcp: any = null
        let late = false
        const work = (async () => {
          const c = await D.connect({ hostname: ip, port, transport: 'tcp' })
          if (late) { try { c.close() } catch { /* closed */ } throw new Error('timed out') }
          tcp = c
          const tls = await D.startTls(c, { hostname: serverName })
          if (typeof tls.handshake === 'function') await tls.handshake()
          return tls as Conn
        })()
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          return await Promise.race([work, new Promise<never>((_, reject) => {
            timer = setTimeout(() => { late = true; reject(Object.assign(new Error('timed out'), { name: 'TimedOut' })) }, Math.max(1, timeoutMs))
          })])
        } catch (e) {
          if (tcp) { try { tcp.close() } catch { /* closed or handed to TLS */ } }
          work.then((t) => { try { t.close() } catch { /* closed */ } }, () => {})
          throw e
        } finally {
          if (timer) clearTimeout(timer)
        }
      }
    }
  }
  return deps
}
