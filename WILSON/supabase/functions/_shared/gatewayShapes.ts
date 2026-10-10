// =============================================================================
// _shared/gatewayShapes.ts — GW1 (post-overhaul, 2026-10-10): the shape checks
// every gateway function runs THIRD (after the caller check and the rate
// limit), and the caller's address. Pure and runtime-agnostic, so vitest
// pins them (src/cloud/gatewayEdge.test.js).
//
// The rule for every parser here: take only the known fields, check each
// one's type and size, drop the rest, and answer a refusal CODE plus a
// SENTENCE a person can read. The database re-checks what it stores (0093's
// CHECKs and validators): these exist so a malformed call is refused at the
// door with a sentence instead of at a constraint with an SQLSTATE.
//
// Field names. Appendix C fixes the answers' shapes; it does not fix every
// request field's spelling, and GW2 builds the gateway in tandem without
// talking to this session. So each parser accepts the spelling the design
// uses FIRST and a few obvious variants after it, and "The API for GW2 and
// GW3" in the hand-off names the canonical one. GW3 reconciles the rest.
// =============================================================================

import { CREDENTIAL_RE, ENROL_TOKEN_RE, UUID_RE, bearerOf } from './gatewayWire.ts'

export const PLATFORMS = ['windows', 'container'] as const
export const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+/
export const REACH_STATES = ['reachable', 'not_reachable', 'not_mounted', 'not_connected'] as const
export const MAX_TICKET_IDS = 50
export const MAX_CONFIRM = 100
export const MAX_EVENT_ROWS = 200
export const MAX_INSIDE_ADDRESSES = 16
export const DEFAULT_INSIDE_PORT = 8443

export type Refusal = { ok: false; status: number; code: string; detail: string }
const refuse = (status: number, code: string, detail: string): Refusal => ({ ok: false, status, code, detail })

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function firstString(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string') return v
  }
  return undefined
}

// ── Addresses ────────────────────────────────────────────────────────────────

/** A dotted-quad IPv4 literal with no leading zeros, as Postgres prints one. */
export function parseIpv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s)
  if (!m) return null
  const parts = m.slice(1).map((x) => (x.length > 1 && x.startsWith('0') ? NaN : Number(x)))
  return parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null
}

/** An IPv6 literal → eight 16-bit groups, or null. Accepts :: and an embedded IPv4 tail. */
export function parseIpv6(s: string): number[] | null {
  if (!/^[0-9a-fA-F:.]+$/.test(s) || !s.includes(':')) return null
  let head = s
  let v4: number[] | null = null
  const lastColon = s.lastIndexOf(':')
  if (s.slice(lastColon + 1).includes('.')) {
    v4 = parseIpv4(s.slice(lastColon + 1))
    if (!v4) return null
    head = s.slice(0, lastColon + 1) + '0:0'
  }
  const dbl = head.split('::')
  if (dbl.length > 2) return null
  const toGroups = (part: string) => (part === '' ? [] : part.split(':'))
  const left = toGroups(dbl[0])
  const right = dbl.length === 2 ? toGroups(dbl[1]) : []
  if ([...left, ...right].some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null
  const missing = 8 - left.length - right.length
  if (dbl.length === 1 ? missing !== 0 : missing < 1) return null
  const groups = [...left, ...Array(dbl.length === 2 ? missing : 0).fill('0'), ...right].map((g) => parseInt(g, 16))
  if (v4) {
    groups[6] = (v4[0] << 8) | v4[1]
    groups[7] = (v4[2] << 8) | v4[3]
  }
  return groups.length === 8 ? groups : null
}

/** RFC 1918 or unique-local (fc00::/7): the only literals an inside address may be. */
export function isPrivateLiteral(host: string): boolean {
  const v4 = parseIpv4(host)
  if (v4) {
    return v4[0] === 10 || (v4[0] === 172 && v4[1] >= 16 && v4[1] <= 31) || (v4[0] === 192 && v4[1] === 168)
  }
  const v6 = parseIpv6(host)
  return !!v6 && (v6[0] & 0xfe00) === 0xfc00
}

/**
 * One inside address, as 0093's gateway_inside_host_ok judges it: a private
 * literal, the computer's own one-label name, or that name under .local. A
 * public name or address is never an inside address — a member's browser
 * probes these, and must not be sent out of the office by one.
 */
export function isInsideHost(host: unknown): host is string {
  if (typeof host !== 'string' || host.length < 1 || host.length > 253) return false
  if (parseIpv4(host) || parseIpv6(host)) return isPrivateLiteral(host)
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.local)?$/.test(host)
}

function validPort(p: unknown): p is number {
  return typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= 65535
}

/**
 * The inside addresses a gateway reports, as [{ host, port }]: objects, or
 * bare host strings paired with `inside_port` (the design says "its inside
 * addresses and the inside port"). Names lower-cased; anything the database
 * would refuse dropped, not fatal; at most sixteen, no duplicates.
 */
export function cleanInsideAddresses(list: unknown, insidePort?: unknown): Array<{ host: string; port: number }> {
  if (!Array.isArray(list)) return []
  const port = validPort(insidePort) ? insidePort : DEFAULT_INSIDE_PORT
  const out: Array<{ host: string; port: number }> = []
  const seen = new Set<string>()
  for (const item of list) {
    let host: unknown
    let p: unknown = port
    if (typeof item === 'string') host = item
    else if (isObject(item)) {
      host = item.host ?? item.address
      p = item.port ?? port
    }
    if (typeof host !== 'string') continue
    const h = host.trim().toLowerCase()
    if (!isInsideHost(h) || !validPort(p)) continue
    const key = h + ':' + p
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ host: h, port: p })
    if (out.length >= MAX_INSIDE_ADDRESSES) break
  }
  return out
}

/**
 * The caller's public address — the rule resolve-login MEASURED on
 * wilson-dev (2026-09-06): Cloudflare's `cf-connecting-ip`; failing that the
 * X-Forwarded-For hop BEFORE the platform's own relay — never the first hop,
 * which the caller writes, and never the last, which is the relay and
 * changes per request (a sync compared on it would see "a new public
 * address" every ten seconds). Copied, not imported: resolve-login is not
 * this bundle's.
 */
export function clientAddress(headers: Headers): string | null {
  const cf = headers.get('cf-connecting-ip')?.trim()
  const ok = (s: string | undefined) => !!s && (parseIpv4(s) !== null || parseIpv6(s) !== null)
  if (ok(cf)) return cf!
  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean)
    const pick = parts.length >= 2 ? parts[parts.length - 2] : parts[0]
    if (ok(pick)) return pick
  }
  const real = headers.get('x-real-ip')?.trim()
  return ok(real) ? real! : null
}

/** major.minor.patch numeric comparison; anything after the patch is ignored. -1, 0, 1. */
export function compareVersions(a: string, b: string): number {
  const pa = /^(\d+)\.(\d+)\.(\d+)/.exec(a)
  const pb = /^(\d+)\.(\d+)\.(\d+)/.exec(b)
  if (!pa || !pb) return 0
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i])
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

// ── The PEM ──────────────────────────────────────────────────────────────────

/** Exactly one CERTIFICATE block, nothing else (a private key is refused). */
export function isSingleCertificatePem(pem: unknown): pem is string {
  if (typeof pem !== 'string' || pem.length > 16384) return false
  return /^\s*-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----\s*$/.test(pem)
}

// ── gateway-enrol ────────────────────────────────────────────────────────────

export type EnrolBody = {
  token: string
  gateway: {
    name: string
    platform: string
    version: string
    hostname: string | null
    inside_addresses: Array<{ host: string; port: number }>
    root_cert_pem: string
  }
}

/** The enrolment call: the token (Bearer, or `token` in the body) and the gateway's facts. */
export function parseEnrolRequest(authorization: string | null, raw: unknown): { ok: true; value: EnrolBody } | Refusal {
  const body = isObject(raw) ? raw : {}
  const bearer = bearerOf(authorization)
  const token = bearer || firstString(body, ['token', 'enrolment_token', 'enrollment_token']) || ''
  if (!ENROL_TOKEN_RE.test(token)) {
    return refuse(401, 'token_malformed', 'The enrolment token is wgt_ followed by 32 letters and digits; copy it again from Settings, Storage, File gateway.')
  }
  if (!isObject(raw)) return refuse(400, 'bad_request', 'The request body is not a JSON object.')
  const platform = firstString(body, ['platform'])
  if (!platform || !(PLATFORMS as readonly string[]).includes(platform)) {
    return refuse(400, 'bad_platform', 'platform must be windows or container.')
  }
  const version = firstString(body, ['version'])
  if (!version || !VERSION_RE.test(version) || version.length > 64) {
    return refuse(400, 'bad_version', 'version must start with major.minor.patch, like 1.0.0.')
  }
  const hostnameRaw = firstString(body, ['hostname', 'host_name'])
  const hostname = hostnameRaw ? hostnameRaw.trim().slice(0, 255) : null
  const nameRaw = (firstString(body, ['name']) ?? hostname ?? '').trim()
  const name = (nameRaw || 'Gateway').slice(0, 80)
  const pem = firstString(body, ['root_cert_pem', 'root_certificate', 'root_pem', 'root'])
  if (!isSingleCertificatePem(pem)) {
    return refuse(400, 'bad_certificate', "root_cert_pem must be exactly one PEM certificate (the root's PUBLIC certificate, never its key).")
  }
  const inside = cleanInsideAddresses(body.inside_addresses ?? body.addresses, body.inside_port)
  return { ok: true, value: { token, gateway: { name, platform, version, hostname, inside_addresses: inside, root_cert_pem: pem } } }
}

// ── The credential (sync, events) ────────────────────────────────────────────

export function credentialOf(authorization: string | null): string | null {
  const c = bearerOf(authorization)
  return CREDENTIAL_RE.test(c) ? c : null
}

// ── gateway-sync ─────────────────────────────────────────────────────────────

export type SyncReport = {
  name: string | null
  version: string | null
  hostname: string | null
  inside_addresses?: Array<{ host: string; port: number }>
  reach: Record<string, string>
  health: Record<string, unknown>
}
export type ConfirmItem = { clip: string; loc: string; path: string }

function shortString(v: unknown, max: number): string | undefined {
  return typeof v === 'string' ? v.slice(0, max) : undefined
}
function smallInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1e12 ? v : undefined
}

/**
 * The heartbeat's report, reduced to what the cloud keeps: the version, the
 * host name, the inside addresses, reach per location (UUID → one of the
 * four words) and a bounded health object (the doors, the update state, the
 * certificate dates, the refused public peers, the relay signal, the office
 * ranges echoed, the cloud it talks to). Unknown keys are dropped. `confirm`
 * (≤ 100 { clip, loc, path }) is the catalogue check's question (D22).
 */
export function parseSyncRequest(raw: unknown): { ok: true; report: SyncReport; confirm: ConfirmItem[] } | Refusal {
  if (raw === null || raw === undefined) raw = {}
  if (!isObject(raw)) return refuse(400, 'bad_request', 'The sync body is not a JSON object.')
  const reachIn = isObject(raw.reach) ? raw.reach : {}
  const reach: Record<string, string> = {}
  for (const [k, v] of Object.entries(reachIn).slice(0, 200)) {
    if (UUID_RE.test(k) && typeof v === 'string' && (REACH_STATES as readonly string[]).includes(v)) reach[k] = v
  }
  const h = isObject(raw.health) ? raw.health : raw
  const doorsIn = isObject(h.doors) ? h.doors : {}
  const certIn = isObject(h.certificate) ? h.certificate : {}
  const relayIn = isObject(doorsIn.relay_warning) ? doorsIn.relay_warning : null
  const health: Record<string, unknown> = {
    doors: {
      inside: shortString(doorsIn.inside, 64) ?? null,
      outside: shortString(doorsIn.outside, 64) ?? null,
      refused_public: smallInt(doorsIn.refused_public) ?? 0,
      inside_bound: Array.isArray(doorsIn.inside_bound)
        ? doorsIn.inside_bound.filter((x) => typeof x === 'string').slice(0, 16).map((x) => (x as string).slice(0, 60))
        : [],
      relay_warning: relayIn
        ? { address: shortString(relayIn.address, 45) ?? null, viewers: smallInt(relayIn.viewers) ?? 0 }
        : null,
    },
    update: shortString(h.update, 128) ?? null,
    certificate: {
      leaf_not_after: shortString(certIn.leaf_not_after, 40) ?? null,
      root_not_after: shortString(certIn.root_not_after, 40) ?? null,
      outside: shortString(certIn.outside, 40) ?? null,
      expires_warning: shortString(certIn.expires_warning, 120) ?? null,
    },
    office_ranges_applied: Array.isArray(h.office_ranges_applied)
      ? h.office_ranges_applied.filter((x) => typeof x === 'string').slice(0, 8).map((x) => (x as string).slice(0, 49))
      : [],
    cloud: shortString(h.cloud, 255) ?? null,
    smb_dialect: shortString(h.smb_dialect, 16) ?? null,
    minimum_version_ok: typeof h.minimum_version_ok === 'boolean' ? h.minimum_version_ok : null,
  }
  const report: SyncReport = {
    name: shortString(raw.name, 80) ?? null,
    version: typeof raw.version === 'string' && VERSION_RE.test(raw.version) ? raw.version.slice(0, 64) : null,
    hostname: shortString(raw.hostname, 255) ?? null,
    reach,
    health,
  }
  if (raw.inside_addresses !== undefined || raw.addresses !== undefined) {
    report.inside_addresses = cleanInsideAddresses(raw.inside_addresses ?? raw.addresses, raw.inside_port)
  }
  const confirmIn = Array.isArray(raw.confirm) ? raw.confirm : []
  if (confirmIn.length > MAX_CONFIRM) {
    return refuse(400, 'too_many_confirm', 'At most 100 clips can be confirmed in one sync.')
  }
  const confirm: ConfirmItem[] = []
  for (const c of confirmIn) {
    if (isObject(c) && typeof c.clip === 'string' && UUID_RE.test(c.clip) && typeof c.loc === 'string' && UUID_RE.test(c.loc)
        && typeof c.path === 'string' && c.path.length > 0 && c.path.length <= 2048) {
      confirm.push({ clip: c.clip, loc: c.loc, path: c.path })
    }
  }
  return { ok: true, report, confirm }
}

// ── gateway-events ───────────────────────────────────────────────────────────

export function parseEventsRequest(raw: unknown, rawLength: number): { ok: true; rows: unknown[] } | Refusal {
  if (rawLength > 512 * 1024) return refuse(413, 'too_large', 'An events batch is at most 512 KB.')
  const rows = isObject(raw) ? raw.rows ?? raw.events ?? raw.viewings : Array.isArray(raw) ? raw : undefined
  if (!Array.isArray(rows)) return refuse(400, 'bad_request', 'The body must carry rows: an array of viewings.')
  if (rows.length === 0) return refuse(400, 'empty', 'An events batch carries at least one viewing.')
  if (rows.length > MAX_EVENT_ROWS) return refuse(400, 'too_many_rows', 'An events batch carries at most 200 viewings.')
  return { ok: true, rows }
}

// ── gateway-ticket ───────────────────────────────────────────────────────────

export function parseTicketRequest(raw: unknown): { ok: true; gatewayId: string; ids: string[] } | Refusal {
  if (!isObject(raw)) return refuse(400, 'bad_request', 'The request body is not a JSON object.')
  const gatewayId = raw.gateway_id
  if (typeof gatewayId !== 'string' || !UUID_RE.test(gatewayId)) {
    return refuse(400, 'bad_gateway_id', "gateway_id must be a gateway's id.")
  }
  const ids = raw.bin_file_ids
  if (!Array.isArray(ids) || ids.length === 0) {
    return refuse(400, 'bad_ids', 'bin_file_ids must list at least one clip.')
  }
  if (ids.length > MAX_TICKET_IDS) return refuse(400, 'too_many', 'At most 50 clips can be asked for at once.')
  if (ids.some((x) => typeof x !== 'string' || !UUID_RE.test(x))) {
    return refuse(400, 'bad_ids', "Every entry of bin_file_ids must be a clip's id.")
  }
  return { ok: true, gatewayId, ids: [...new Set(ids as string[])] }
}

// ── gateway-reach ────────────────────────────────────────────────────────────

export function parseReachRequest(raw: unknown): { ok: true; gatewayId: string } | Refusal {
  if (!isObject(raw) || typeof raw.gateway_id !== 'string' || !UUID_RE.test(raw.gateway_id)) {
    return refuse(400, 'bad_gateway_id', "gateway_id must be a gateway's id.")
  }
  return { ok: true, gatewayId: raw.gateway_id }
}

// ── The answers' configuration ───────────────────────────────────────────────

/** The web app's origins for the gateway's CORS: the site URL's origin plus any listed extras. */
export function webAppOrigins(siteUrl: string | undefined, extra: string | undefined): string[] {
  const out = new Set<string>()
  for (const raw of [siteUrl ?? '', ...(extra ?? '').split(',')]) {
    const s = raw.trim()
    if (!s) continue
    try {
      const u = new URL(s)
      if (u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) {
        out.add(u.origin)
      }
    } catch { /* not a URL: skipped */ }
  }
  return [...out]
}
