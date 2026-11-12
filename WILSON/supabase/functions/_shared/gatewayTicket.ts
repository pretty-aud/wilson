// =============================================================================
// _shared/gatewayTicket.ts — GW1 (post-overhaul, 2026-10-10): the ticket.
//
// A ticket is the ONLY authority a browser carries to the file gateway (D1:
// the sign-in token never reaches it). The cloud mints one per clip for two
// minutes after evaluating the Bins gate AS THE CALLER (gateway-ticket); the
// gateway checks the signature on every request. The wire is the
// controller's, fixed for GW1 and GW2 alike ("The wire, fixed" in both
// briefs) — this file is its cloud half, and nothing here may drift from it:
//
//   claims  keys in EXACTLY this order and nothing else:
//           v (the number 1), kid, gw, ws, sub, clip, loc (lower-case UUID
//           strings), path (the cloud's relative_path, forward slashes),
//           seq (boolean), mt (the media type string the row holds;
//           advisory), rv (boolean), iat, exp (integer Unix seconds,
//           exp = iat + 120), jti (32 lower-case hex, 128 random bits)
//   payload base64url, no padding, of the UTF-8 bytes of
//           JSON.stringify(claims) — no whitespace
//   sig     base64url, no padding, of the Ed25519 signature over the ASCII
//           bytes of `v1.<payload>`
//   ticket  `v1.<payload>.<sig>`; a gateway refuses one longer than 4096
//           characters before parsing; iat is the not-before; 30 s of clock
//           skew each way
//
// One reading of the wire this file had to make, said where GW2 and GW3
// will look (docs/design/gateway-ticket-vectors.json "notes"): `mt` is the
// row's mime_type, and a row that holds none (bin_files.mime_type is
// nullable) carries the EMPTY STRING, so `mt` is always a string. The
// gateway decides the type from the resolved file's own extension (§5);
// `mt` is advisory.
//
// verifyTicket below is the cloud's REFERENCE verifier: the vectors and the
// tests run it so the cloud proves it can read what it writes. The gateway
// program has its own (GW2), and the vectors are how the two meet.
// =============================================================================

import {
  JTI_RE, KID_RE, UUID_RE,
  fromBase64, fromBase64Url, toBase64, toBase64Url, makeKid,
} from './gatewayWire.ts'

export const TICKET_VERSION = 1
export const TICKET_TTL_SECONDS = 120
export const TICKET_MAX_LENGTH = 4096
export const TICKET_SKEW_SECONDS = 30
/** The previous signing key stays acceptable this long after a rotation (the wire). */
export const PREVIOUS_KEY_GRACE_SECONDS = 600
/** A signing key is retired and replaced after a year (§5 step 4). */
export const KEY_ROTATE_AFTER_SECONDS = 365 * 24 * 3600
export const MT_MAX_LENGTH = 255

export const CLAIM_ORDER = [
  'v', 'kid', 'gw', 'ws', 'sub', 'clip', 'loc', 'path', 'seq', 'mt', 'rv', 'iat', 'exp', 'jti',
] as const

export type TicketClaims = {
  v: 1
  kid: string
  gw: string
  ws: string
  sub: string
  clip: string
  loc: string
  path: string
  seq: boolean
  mt: string
  rv: boolean
  iat: number
  exp: number
  jti: string
}

export type ClaimsInput = {
  kid: string
  gw: string
  ws: string
  sub: string
  clip: string
  loc: string
  path: string
  seq: boolean
  mt: string | null | undefined
  rv: boolean
  iat: number
  jti: string
}

/**
 * The cloud's relative_path CHECK (0091 bin_files_relative_path_shape_chk),
 * restated in code: a ticket never carries a path the database would have
 * refused, even if a row were somehow written past the CHECK. Length is
 * counted in CHARACTERS, as Postgres's length() counts them.
 */
export function isCloudRelativePath(p: unknown): p is string {
  if (typeof p !== 'string' || p === '') return false
  if (/(^\/|\/$|\/\/|\\|:)/.test(p)) return false
  if (/(^|\/)\.\.?(\/|$)/.test(p)) return false
  if (/[. ](\/|$)/.test(p)) return false
  return Array.from(p).length <= 1024
}

function isPositiveSafeInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0
}

/**
 * Build the claims object with its keys in the wire's order. Throws a plain
 * Error naming the first bad field: a mint must never sign a malformed
 * claim, and the function turns the throw into a refusal sentence.
 */
export function buildClaims(input: ClaimsInput): TicketClaims {
  const { kid, gw, ws, sub, clip, loc, path, seq, rv, iat, jti } = input
  if (typeof kid !== 'string' || !KID_RE.test(kid)) throw new Error('kid')
  const ids: Array<[string, unknown]> = [['gw', gw], ['ws', ws], ['sub', sub], ['clip', clip], ['loc', loc]]
  for (const [name, id] of ids) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw new Error(name)
  }
  if (!isCloudRelativePath(path)) throw new Error('path')
  if (typeof seq !== 'boolean') throw new Error('seq')
  if (typeof rv !== 'boolean') throw new Error('rv')
  if (!isPositiveSafeInt(iat)) throw new Error('iat')
  if (typeof jti !== 'string' || !JTI_RE.test(jti)) throw new Error('jti')
  const mt = input.mt == null ? '' : input.mt
  if (typeof mt !== 'string' || mt.length > MT_MAX_LENGTH) throw new Error('mt')
  // The literal below IS the order (JSON.stringify keeps insertion order).
  return {
    v: TICKET_VERSION,
    kid,
    gw,
    ws,
    sub,
    clip,
    loc,
    path,
    seq,
    mt,
    rv,
    iat,
    exp: iat + TICKET_TTL_SECONDS,
    jti,
  }
}

/** base64url (no padding) of the UTF-8 bytes of JSON.stringify(claims). */
export function encodePayload(claims: TicketClaims): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(claims)))
}

/** `v1.<payload>.<sig>` — the signature is over the ASCII bytes of `v1.<payload>`. */
export async function signTicket(privateKey: CryptoKey, claims: TicketClaims): Promise<string> {
  const signingInput = 'v1.' + encodePayload(claims)
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, new TextEncoder().encode(signingInput))
  return signingInput + '.' + toBase64Url(new Uint8Array(sig))
}

export type VerifyOptions = {
  /** kid → public key. The caller decides which kids are live (current + the grace window). */
  publicKeys: Record<string, CryptoKey>
  gatewayId: string
  workspaceId?: string
  /** Unix seconds. */
  now: number
  /** The outside door also requires rv: true (§9 point 5). */
  door?: 'inside' | 'outside'
}

export type VerifyReason =
  | 'too_long' | 'malformed' | 'unknown_kid' | 'bad_signature' | 'not_yet_valid'
  | 'expired' | 'wrong_gateway' | 'wrong_workspace' | 'remote_viewing_off'

export type VerifyResult =
  | { ok: true; claims: TicketClaims }
  | { ok: false; reason: VerifyReason }

/**
 * The cloud's reference verifier. Order: length, shape, the claims' exact
 * keys and types, the kid, the signature, the dates with 30 s of skew, the
 * gateway and workspace, and on the outside door rv. Each refusal is a
 * reason code; the gateway answers every one of them as 401 with no body.
 */
export async function verifyTicket(ticket: string, opts: VerifyOptions): Promise<VerifyResult> {
  if (typeof ticket !== 'string' || ticket.length > TICKET_MAX_LENGTH) return { ok: false, reason: 'too_long' }
  const parts = ticket.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return { ok: false, reason: 'malformed' }
  let claims: Record<string, unknown>
  let sig: Uint8Array
  try {
    claims = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(parts[1])))
    sig = fromBase64Url(parts[2])
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return { ok: false, reason: 'malformed' }
  const keys = Object.keys(claims)
  if (keys.length !== CLAIM_ORDER.length || keys.some((k, i) => k !== CLAIM_ORDER[i])) {
    return { ok: false, reason: 'malformed' }
  }
  let typed: TicketClaims
  try {
    typed = buildClaims({
      kid: claims.kid as string, gw: claims.gw as string, ws: claims.ws as string,
      sub: claims.sub as string, clip: claims.clip as string, loc: claims.loc as string,
      path: claims.path as string, seq: claims.seq as boolean, mt: claims.mt as string,
      rv: claims.rv as boolean, iat: claims.iat as number, jti: claims.jti as string,
    })
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (typeof claims.mt !== 'string' || claims.v !== TICKET_VERSION || claims.exp !== typed.exp) {
    return { ok: false, reason: 'malformed' }
  }
  if (sig.length !== 64) return { ok: false, reason: 'bad_signature' }
  const key = Object.prototype.hasOwnProperty.call(opts.publicKeys, typed.kid) ? opts.publicKeys[typed.kid] : undefined
  if (!key) return { ok: false, reason: 'unknown_kid' }
  const good = await crypto.subtle.verify({ name: 'Ed25519' }, key, sig, new TextEncoder().encode('v1.' + parts[1]))
  if (!good) return { ok: false, reason: 'bad_signature' }
  if (opts.now < typed.iat - TICKET_SKEW_SECONDS) return { ok: false, reason: 'not_yet_valid' }
  if (opts.now > typed.exp + TICKET_SKEW_SECONDS) return { ok: false, reason: 'expired' }
  if (typed.gw !== opts.gatewayId) return { ok: false, reason: 'wrong_gateway' }
  if (opts.workspaceId !== undefined && typed.ws !== opts.workspaceId) return { ok: false, reason: 'wrong_workspace' }
  if (opts.door === 'outside' && typed.rv !== true) return { ok: false, reason: 'remote_viewing_off' }
  return { ok: true, claims: typed }
}

// ── The signing keys ─────────────────────────────────────────────────────────
// Ed25519 per workspace. The private half is kept as PKCS#8 DER (base64)
// and encrypted at rest under WILSON_GATEWAY_KEY_SECRET by
// gatewayKeyCrypto.ts before it reaches the database; the public half is the
// raw 32 bytes in STANDARD base64, which is also its wire form at sync.

export type GeneratedSigningKey = {
  kid: string
  publicKey: string
  privatePkcs8: string
  privateKey: CryptoKey
}

export async function generateSigningKey(kid: string = makeKid()): Promise<GeneratedSigningKey> {
  if (!KID_RE.test(kid)) throw new Error('kid')
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  return { kid, publicKey: toBase64(raw), privatePkcs8: toBase64(pkcs8), privateKey: pair.privateKey }
}

export async function importSigningPrivateKey(pkcs8B64: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey('pkcs8', fromBase64(pkcs8B64), { name: 'Ed25519' }, false, ['sign'])
}

export async function importSigningPublicKey(rawB64: string): Promise<CryptoKey> {
  const raw = fromBase64(rawB64)
  if (raw.length !== 32) throw new Error('an Ed25519 public key is 32 bytes')
  return await crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, true, ['verify'])
}

/** The public key's shape on the wire and in the database: standard base64 of 32 bytes. */
export const PUBLIC_KEY_B64_RE = /^[A-Za-z0-9+/]{43}=$/
