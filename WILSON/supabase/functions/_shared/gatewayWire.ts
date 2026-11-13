// =============================================================================
// _shared/gatewayWire.ts — GW1 (post-overhaul, 2026-10-10): the file
// gateway's wire, the parts that are not the ticket.
//
// The shapes are the controller's, fixed so GW1 (the cloud) and GW2 (the
// gateway program) agree without talking — "The wire, fixed" in
// docs/sessions/briefs/po-gw1-gateway-cloud.md, word for word the same in
// po-gw2-gateway-service.md:
//
//   * enrolment token  `wgt_` + 32 characters of base32 (RFC 4648 alphabet,
//     upper case, 160 random bits); the cloud stores SHA-256 (hex) of the
//     WHOLE string's UTF-8 bytes. The admin's RPC makes it in SQL
//     (gateway_make_enrolment_token, 0093); gateway-enrol checks its shape
//     with ENROL_TOKEN_RE before hashing it.
//   * gateway credential  `wgc_` + base64url (no padding) of 32 random
//     bytes; stored as SHA-256 (hex) of the whole string; carried as
//     `Authorization: Bearer <credential>` on every gateway call.
//   * signing-key id  1–16 characters of [a-z0-9]; the public half travels
//     as STANDARD base64 of the raw 32 bytes.
//   * jti  32 lower-case hex characters, 128 random bits.
//
// Runtime-agnostic on purpose (the s3Presign.ts arrangement): WebCrypto,
// TextEncoder and btoa/atob only, so the Edge Functions (Deno) and vitest
// (Node) run the same bytes, and the vectors in
// docs/design/gateway-ticket-vectors.json come from this code.
// =============================================================================

export const ENROL_TOKEN_RE = /^wgt_[A-Z2-7]{32}$/
export const CREDENTIAL_RE = /^wgc_[A-Za-z0-9_-]{43}$/
export const KID_RE = /^[a-z0-9]{1,16}$/
export const JTI_RE = /^[0-9a-f]{32}$/
// Lower-case only: every id in a ticket is a lower-case UUID string (the
// wire), and Postgres prints uuids lower-case, so an upper-case id is a
// caller that did not come from the database.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  crypto.getRandomValues(out)
  return out
}

export function toHex(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

/** RFC 4648 base32, upper case, no padding. 20 bytes → exactly 32 characters. */
export function base32Encode(bytes: Uint8Array): string {
  let out = ''
  let buffer = 0
  let bits = 0
  for (const b of bytes) {
    buffer = (buffer << 8) | b
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31]
      bits -= 5
    }
    buffer &= (1 << bits) - 1
  }
  if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31]
  return out
}

/** Standard base64 with padding (the public key's wire form). */
export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

/** Standard base64 → bytes. Throws on anything atob refuses. */
export function fromBase64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** base64url WITHOUT padding (RFC 4648 §5). */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * base64url without padding → bytes, STRICT: only the url alphabet, no
 * padding, and a length a real encoding can have (length % 4 !== 1). A
 * lenient decoder would accept two spellings of one signature; the ticket
 * must have exactly one.
 */
export function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) {
    throw new Error('not base64url without padding')
  }
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bytes = fromBase64(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  // Canonical: re-encoding must give back the same text (the unused low
  // bits of the last character must be zero).
  if (toBase64Url(bytes) !== s) throw new Error('not canonical base64url')
  return bytes
}

/** `wgt_` + 32 base32 characters: 160 random bits. */
export function makeEnrolmentToken(): string {
  return 'wgt_' + base32Encode(randomBytes(20))
}

/** `wgc_` + base64url (no padding) of 32 random bytes: 43 characters. */
export function makeCredential(): string {
  return 'wgc_' + toBase64Url(randomBytes(32))
}

/** 32 lower-case hex characters, 128 random bits. */
export function makeJti(): string {
  return toHex(randomBytes(16))
}

/** `k` + 12 lower-case hex characters: 13 of the wire's 1–16 [a-z0-9]. */
export function makeKid(): string {
  return 'k' + toHex(randomBytes(6))
}

/** SHA-256 (hex) of the string's UTF-8 bytes — the token's and the credential's stored form. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return toHex(new Uint8Array(digest))
}

/**
 * Constant-time equality for two strings of the same alphabet (the hashes).
 * Both are walked to the longer length whatever the first difference, so
 * the time says nothing about where they differ (§10 row 19).
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const n = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < n; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

/**
 * The reach key (GW1 review round 2, finding 1): what the reach check's
 * proof is keyed by. Never the credential's hash: that is the key every
 * gateway call is looked up by, sent as a request-URL filter, which the
 * platform's request logs keep — a key in a log must not prove "this is your
 * gateway".
 *
 *   reach key = SHA-256 (lower-case hex) of the UTF-8 bytes of
 *               'wilson-reach-key:' followed by the credential
 *
 * The gateway derives it from its credential; the cloud is handed it once,
 * at enrolment (gateway_secrets.reach_key), and sends it nowhere.
 */
export async function reachKeyOf(credential: string): Promise<string> {
  if (!CREDENTIAL_RE.test(credential)) throw new Error('reachKeyOf: the credential is wgc_ and 43 base64url characters')
  return await sha256Hex('wilson-reach-key:' + credential)
}

/**
 * The reach check's proof (GW1 review round 1, finding 1). The cloud's probe
 * carries the check's nonce in `Wilson-Reach-Nonce`, so an ECHO of it proves
 * nothing: any server that reflects a header would pass. The gateway answers
 * `nonce_proof` instead:
 *
 *   HMAC-SHA256(key = the UTF-8 bytes of the reach key's 64 hex characters
 *               (reachKeyOf; round 2 — round 1 keyed it by the credential's
 *               hash),
 *               message = the UTF-8 bytes of the 32-hex nonce)
 *
 * as 64 lower-case hex characters. Only the holder of the credential can make
 * it, and the cloud computes it from the reach key it keeps (never the
 * credential). The vector is in docs/design/gateway-ticket-vectors.json.
 */
export async function reachProof(reachKey: string, nonce: string): Promise<string> {
  if (!SHA256_HEX_RE.test(reachKey)) throw new Error('reachProof: the reach key is 64 lower-case hex')
  if (!/^[0-9a-f]{32}$/.test(nonce)) throw new Error('reachProof: the nonce is 32 lower-case hex')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(reachKey),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(nonce))
  return toHex(new Uint8Array(mac))
}

/**
 * A request's JSON body, read under a byte limit (review round 1, note 6):
 * a declared length over the limit is refused before a byte is read, and the
 * body is read through its stream, stopping one chunk past the limit — never
 * buffered whole first. `{ value: undefined, length }` when there is nothing
 * or too much (the caller compares `length`), `null` when it is not JSON.
 *
 * F8 (wave 2, 2026-11-13): it DECODES AS IT READS. It used to keep every
 * chunk, then join them into one buffer, then decode: for a moment the body
 * twice over, one copy more than the runtime's own `req.json()`, which for
 * ai-proxy's large bodies could kill the worker at a smaller body than before.
 * Now each chunk goes through one streaming TextDecoder into the text and is
 * let go. A streaming decoder gives exactly the text decoding the whole would
 * (the Encoding Standard's rule): a character split across two chunks, a
 * byte-order mark split or alone (stripped, so a lone one is "nothing sent"),
 * bytes that are not UTF-8 (U+FFFD), all the same; edgeBodyReader.test.js
 * holds that against the old reader, chunking by chunking. Every return value
 * is the old one.
 *
 * The decoder is flushed exactly once on EVERY path (review round 1, R3): at
 * the end of the body, where its text is the body's last; and, its text
 * discarded, past the cap or when the stream fails mid-read, so it never
 * keeps the first bytes of a character after the reader has returned.
 */
export async function readJsonLimited(req: Request, maxBytes: number): Promise<{ value: unknown; length: number } | null> {
  const declared = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) return { value: undefined, length: declared }
  if (!req.body) return { value: undefined, length: 0 }
  const reader = req.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let total = 0
  let flushed = false
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.length
      if (total > maxBytes) {
        try { await reader.cancel() } catch { /* already done */ }
        return { value: undefined, length: total }
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    flushed = true
  } finally {
    // Past the cap, or a read that threw: flushed too, and what it gives is not kept.
    if (!flushed) decoder.decode()
  }
  if (!text) return { value: undefined, length: 0 }
  try {
    return { value: JSON.parse(text), length: total }
  } catch {
    return null
  }
}

/** What `await req.json()` gave a function, read under a byte cap (F8). */
export type BodyRead =
  /** Parsed: ANY JSON value, `null`, a number or an array included, exactly as req.json() handed it over. */
  | { kind: 'json'; value: unknown }
  /** What made req.json() throw: an empty body, text that is not JSON, or a body that failed while it was read. */
  | { kind: 'not_json' }
  /** Declared or read past the cap: refused, never read to its end. */
  | { kind: 'too_large'; length: number }

/**
 * F8 (wave 2, 2026-11-13): the bounded stand-in for `await req.json()`. Each
 * of the fourteen functions that read their body with an unbounded
 * `req.json()` reads it here and keeps its own answers by `kind`: `not_json`
 * is what its `catch` answered, `json` hands the value on UNTOUCHED (a JSON
 * `null` included: thirteen of them still throw on it, as before, F8-05; do
 * not make that kinder here), and `too_large` is the one new answer, 413.
 */
export async function readBodyJson(req: Request, maxBytes: number): Promise<BodyRead> {
  let read: { value: unknown; length: number } | null
  try {
    read = await readJsonLimited(req, maxBytes)
  } catch {
    return { kind: 'not_json' } // the stream failed: req.json() threw there too
  }
  if (read === null) return { kind: 'not_json' }
  if (read.length > maxBytes) return { kind: 'too_large', length: read.length }
  if (read.value === undefined) return { kind: 'not_json' } // nothing was sent: req.json() threw on ''
  return { kind: 'json', value: read.value }
}

/** The house answer for a body past its cap (gateway-sync, gatewayShapes, readUrls): the words beside the code. */
export const TOO_LARGE = { error: 'too_large', detail: 'the request is too large' } as const

// ── The caps (F8, DESIGN.md §7.4) ───────────────────────────────────────────
// Each number is MEASURED from the largest body a real caller builds that the
// function's own validators accept, in UTF-8 bytes (a field outside ASCII at
// three bytes a character). No caller is in electron/.

/**
 * The eleven admin, operator and storage actions. Largest real bodies:
 * admin-create-user 649, admin-reset-password 50, admin-set-active 65,
 * admin-user-security 50, invite-member 591, operator-ai-keys 583 (a
 * 500-character key), operator-models 942, operator-storage-plans 1,610 (a
 * 500-character note: the largest), operator-workspaces 929, storage-presign
 * 1,047 (a 1,024-character path), storage-secret 1,564 (a 512-character
 * secret). 16 KiB is ten times the largest, and gateway-ticket's own cap.
 */
export const SMALL_JSON_MAX_BYTES = 16 * 1024

/**
 * resolve-login (largest real body 254 bytes: `{ company }` of 80 three-byte
 * characters, LoginScreen.jsx) and issue-session (55 bytes, `{ workspace_id }`,
 * LoginScreen.jsx and WorkspaceSwitcher.jsx). 4 KiB is sixteen times the
 * larger, and gateway-reach's own cap.
 */
export const SIGN_IN_JSON_MAX_BYTES = 4 * 1024

/**
 * ai-proxy: the provider's 32 MiB request ceiling (as the client itself
 * records it, referenceModel.js) plus 1 MiB for the fields WILSON adds and
 * strips (`tool`, `betas`, `stream`). No client-side bound on inline text
 * exists (the D.O.G. picker alone admits 20 × 262,144 characters, before
 * project files and notes), and no caller sends an inline picture or PDF any
 * more (they go as file ids), so nothing tighter can be read from the code:
 * any lower number could refuse a request that works today. It bounds an
 * unbounded read; it does not say the relay survives 33 MiB (F8-08).
 */
export const AI_PROXY_JSON_MAX_BYTES = 33 * 1024 * 1024

/** The bearer value of an Authorization header, or '' (case-insensitive scheme). */
export function bearerOf(header: string | null | undefined): string {
  const h = header ?? ''
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : ''
}
