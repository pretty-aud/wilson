// =============================================================================
// _shared/s3Reach.ts — P8 (night 5, 2026-10-28), TPN-NET-016: every request
// a Petal-side function makes to a company's S3 endpoint goes through here.
//
// storage-secret's bucket test (PUT → GET → DELETE of a probe object) and
// storage-gc's drain (a signed DELETE per queued key) used to call fetch()
// on a presigned URL with its defaults: redirects followed, the host taken as
// typed, no timeout. An endpoint of https://10.0.0.5, or a public host
// answering 301 to http://169.254.169.254/…, aimed the Edge runtime at
// addresses inside the platform and read back each status (TPN-NET-016).
//
// This file is gatewayReach.ts's probe for S3 (the reach check's SSRF guard,
// GATEWAY_DESIGN.md §4), built from its pieces and nothing new of its own:
//
//   1. vetS3Host: the host the signer will put in the URL — the ENDPOINT's
//      host, or the bucket-prefixed host of a virtual-hosted bucket (what
//      s3HostAndPath produces, SNI and Host header alike) — is a public
//      literal, or a public name that is not local, reserved or a Supabase
//      host (checkOutsideAddress's rules); a name is RESOLVED and every
//      answer must be public (vetResolved): one private, loopback,
//      link-local, CGNAT, multicast, reserved or documentation address and
//      nothing is contacted.
//   2. s3Request: ONE HTTP/1.1 request over TLS to the vetted address
//      LITERAL, the name used for SNI only (the measured `literal_tls`, GW1
//      on dev, 2026-10-10), so no second resolution can swap the target. A
//      SigV4 query-signed request allows it: the signature covers the Host
//      header and UNSIGNED-PAYLOAD, never the socket's peer. Content-Length
//      always; no Expect, no chunking; Connection: close. Every 3xx is
//      REFUSED (`redirect: true`, nothing followed); one deadline for the
//      whole exchange; the answer's body capped.
//   3. Where the runtime has no raw TCP + startTls, fetch of the vetted
//      name with redirect: 'manual' and a timeout, and `method:
//      'pinned_fetch'` says so: fetch resolves the name again itself, which
//      is the residual the reach check records for the same case.
//
// The network is injected (ReachDeps, gatewayReach.ts), so the whole
// decision is unit-tested in Node (src/cloud/s3Reach.test.js) with a fake
// resolver and a fake TLS connect that records what it was asked to reach.
// =============================================================================

import { parseIpv4, parseIpv6 } from './gatewayShapes.ts'
import {
  isPublicIp, vetResolved, denoReachDeps, LOCAL_NAME_SUFFIX, SUPABASE_HOST_SUFFIX, DNS_NAME_RE,
  type ReachDeps, type Conn,
} from './gatewayReach.ts'

export const S3_REQUEST_TIMEOUT_MS = 10_000
export const S3_ANSWER_MAX_BYTES = 64 * 1024

export type S3HostRefusal = 'malformed' | 'not_public' | 'local_name' | 'supabase_host' | 'dns'

export type VettedS3Host =
  | { ok: true; hostname: string; port: number; address: string; literal: boolean }
  | { ok: false; reason: S3HostRefusal; detail: string; address?: string }

/** `[fd00::1]` → `fd00::1`; anything else as it is. */
function bareHost(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

/**
 * Step 1 for one host[:port] as the signer writes it into the URL. The
 * sentence in `detail` is the one a person reads in Admin Terminal → Storage.
 */
export async function vetS3Host(hostPort: string, deps: ReachDeps, opts: { supabaseHost?: string; timeoutMs?: number } = {}): Promise<VettedS3Host> {
  let u: URL
  try {
    u = new URL(`https://${hostPort}`)
  } catch {
    return { ok: false, reason: 'malformed', detail: 'the S3 endpoint is not a host WILSON can read' }
  }
  if (u.username || u.password || (u.pathname && u.pathname !== '/') || u.search || u.hash) {
    return { ok: false, reason: 'malformed', detail: 'the S3 endpoint must be a host only (https://host or https://host:port)' }
  }
  const hostname = bareHost(u.hostname).toLowerCase()
  const port = u.port ? Number(u.port) : 443
  if (!Number.isInteger(port) || port < 1 || port > 65535 || hostname.length < 1 || hostname.length > 253) {
    return { ok: false, reason: 'malformed', detail: 'the S3 endpoint is not a host WILSON can read' }
  }
  if (parseIpv4(hostname) || parseIpv6(hostname)) {
    if (!isPublicIp(hostname)) {
      return { ok: false, reason: 'not_public', address: hostname, detail: `the S3 endpoint is an address inside a private network (${hostname}); WILSON sends bucket requests to public endpoints only` }
    }
    return { ok: true, hostname, port, address: hostname, literal: true }
  }
  if (hostname === 'localhost' || !DNS_NAME_RE.test(hostname) || LOCAL_NAME_SUFFIX.test(hostname)) {
    return { ok: false, reason: 'local_name', detail: `the S3 endpoint names a host inside a private network (${hostname}); WILSON sends bucket requests to public endpoints only` }
  }
  if (SUPABASE_HOST_SUFFIX.test(hostname) || (opts.supabaseHost && hostname === opts.supabaseHost.toLowerCase())) {
    return { ok: false, reason: 'supabase_host', detail: 'the S3 endpoint cannot be a WILSON host' }
  }
  let resolved: string[] = []
  try {
    resolved = await withDeadline(deps.resolve(hostname), opts.timeoutMs ?? S3_REQUEST_TIMEOUT_MS)
  } catch {
    resolved = []
  }
  const vet = vetResolved(resolved)
  if (!vet.ok) {
    if (vet.reason === 'no_address') {
      return { ok: false, reason: 'dns', detail: `the S3 endpoint's name (${hostname}) does not resolve; check the endpoint URL, and try the other addressing style: a wrong forcePathStyle presents as exactly this DNS failure` }
    }
    return { ok: false, reason: 'not_public', address: vet.address, detail: `the S3 endpoint's name (${hostname}) resolves to an address inside a private network (${vet.address}); WILSON sends bucket requests to public endpoints only` }
  }
  return { ok: true, hostname, port, address: vet.addresses[0], literal: false }
}

export type S3Answer = {
  status: number
  /** The answer's body, as text, at most S3_ANSWER_MAX_BYTES. */
  text: string
  /** A 3xx: nothing was followed; the caller refuses. */
  redirect: boolean
  method: 'literal_tls' | 'pinned_fetch'
  /** The address the request went to (the vetted literal), or null for the fetch fallback. */
  address: string | null
}

async function withDeadline<T>(p: Promise<T>, ms: number, onLate?: (v: T) => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let done = false
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      if (!done) reject(Object.assign(new Error('the S3 endpoint did not answer within the time allowed'), { name: 'TimedOut' }))
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

/** Reads until the peer closes, the cap or the deadline, whichever first. */
async function readUpTo(conn: Conn, max: number, deadline: number, now: () => number): Promise<Uint8Array> {
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
  return buf.subarray(0, n)
}

/** An HTTP/1.x answer's status, headers and body (Content-Length or chunked), from raw bytes. */
export function parseHttpAnswer(raw: Uint8Array, maxBody: number): { status: number; headers: Record<string, string>; body: Uint8Array } | null {
  const text = new TextDecoder('latin1').decode(raw)
  const headEnd = text.indexOf('\r\n\r\n')
  const head = headEnd >= 0 ? text.slice(0, headEnd) : text
  const m = /^HTTP\/1\.[01] (\d{3})/.exec(head)
  if (!m) return null
  const status = Number(m[1])
  const headers: Record<string, string> = {}
  for (const line of head.split('\r\n').slice(1)) {
    const i = line.indexOf(':')
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
  }
  let body = headEnd >= 0 ? raw.subarray(headEnd + 4) : new Uint8Array(0)
  if (/chunked/i.test(headers['transfer-encoding'] ?? '')) {
    const parts: Uint8Array[] = []
    let at = 0
    let total = 0
    for (;;) {
      const lineEnd = indexOfCrlf(body, at)
      if (lineEnd < 0) break
      const size = parseInt(new TextDecoder('latin1').decode(body.subarray(at, lineEnd)).split(';')[0], 16)
      if (!Number.isFinite(size) || size <= 0) break
      const start = lineEnd + 2
      const chunk = body.subarray(start, Math.min(start + size, body.length))
      parts.push(chunk)
      total += chunk.length
      at = start + size + 2
      if (at > body.length || total >= maxBody) break
    }
    const out = new Uint8Array(Math.min(total, maxBody))
    let off = 0
    for (const p of parts) {
      const take = Math.min(p.length, out.length - off)
      out.set(p.subarray(0, take), off)
      off += take
      if (off >= out.length) break
    }
    body = out
  } else if (headers['content-length'] !== undefined) {
    const len = Number(headers['content-length'])
    if (Number.isFinite(len) && len >= 0) body = body.subarray(0, Math.min(len, maxBody))
  }
  return { status, headers, body: body.subarray(0, maxBody) }
}

function indexOfCrlf(b: Uint8Array, from: number): number {
  for (let i = from; i + 1 < b.length; i++) if (b[i] === 13 && b[i + 1] === 10) return i
  return -1
}

/**
 * Step 2: one request to `url` (a presigned S3 URL whose host is `vetted`),
 * to the vetted address. `body` is sent whole with its Content-Length.
 */
export async function s3Request(
  { url, method, body, vetted, deps, timeoutMs = S3_REQUEST_TIMEOUT_MS, maxBodyBytes = S3_ANSWER_MAX_BYTES }:
  { url: string; method: 'PUT' | 'GET' | 'DELETE' | 'HEAD'; body?: Uint8Array | string | null; vetted: VettedS3Host & { ok: true }; deps: ReachDeps; timeoutMs?: number; maxBodyBytes?: number },
): Promise<S3Answer> {
  const u = new URL(url)
  if (u.protocol !== 'https:') throw new Error('the S3 endpoint must be https://')
  const urlHost = bareHost(u.hostname).toLowerCase()
  const urlPort = u.port ? Number(u.port) : 443
  if (urlHost !== vetted.hostname || urlPort !== vetted.port) {
    throw new Error('the request names a host that was not vetted')
  }
  const payload = body == null ? new Uint8Array(0) : typeof body === 'string' ? new TextEncoder().encode(body) : body
  const started = deps.now()
  const deadline = started + timeoutMs

  if (deps.connectTls) {
    const hostHeader = vetted.port === 443 ? u.hostname : `${u.hostname}:${vetted.port}`
    const head = [
      `${method} ${u.pathname}${u.search} HTTP/1.1`,
      `Host: ${hostHeader}`,
      'User-Agent: WILSON-storage/1',
      'Accept: */*',
      `Content-Length: ${payload.length}`,
      'Connection: close',
      '', '',
    ].join('\r\n')
    const request = new Uint8Array(head.length + payload.length)
    request.set(new TextEncoder().encode(head), 0)
    request.set(payload, head.length)
    const conn = await withDeadline(deps.connectTls(vetted.address, vetted.port, vetted.hostname, timeoutMs), timeoutMs, (late) => late.close())
    let raw: Uint8Array
    try {
      await withDeadline(conn.write(request), Math.max(1, deadline - deps.now()))
      raw = await readUpTo(conn, maxBodyBytes + 16 * 1024, deadline, deps.now)
    } finally {
      try { conn.close() } catch { /* closed */ }
    }
    const answer = parseHttpAnswer(raw, maxBodyBytes)
    if (!answer) throw new Error('the S3 endpoint answered something that is not HTTP')
    return {
      status: answer.status,
      text: new TextDecoder().decode(answer.body),
      redirect: answer.status >= 300 && answer.status < 400,
      method: 'literal_tls',
      address: vetted.address,
    }
  }

  if (!deps.fetch) throw new Error('no way to reach the S3 endpoint in this runtime')
  const res = await deps.fetch(url, {
    method,
    body: method === 'PUT' ? payload : undefined,
    redirect: 'manual',
    headers: { 'user-agent': 'WILSON-storage/1', accept: '*/*' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  const redirect = res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)
  let text = ''
  if (!redirect && res.body) {
    const reader = res.body.getReader()
    const parts: Uint8Array[] = []
    let total = 0
    while (total < maxBodyBytes) {
      const { value, done } = await reader.read()
      if (done || !value) break
      parts.push(value)
      total += value.length
    }
    try { await reader.cancel() } catch { /* done */ }
    const all = new Uint8Array(Math.min(total, maxBodyBytes))
    let off = 0
    for (const p of parts) {
      const take = Math.min(p.length, all.length - off)
      all.set(p.subarray(0, take), off)
      off += take
      if (off >= all.length) break
    }
    text = new TextDecoder().decode(all)
  }
  return { status: res.status, text, redirect, method: 'pinned_fetch', address: null }
}

/** The real network (gatewayReach's), for the functions. */
export function s3ReachDeps(): ReachDeps {
  return denoReachDeps()
}
