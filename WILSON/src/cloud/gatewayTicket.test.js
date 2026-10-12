// =============================================================================
// gatewayTicket.test.js — GW1 (post-overhaul, 2026-10-10).
//
// Pins supabase/functions/_shared/gatewayTicket.ts and gatewayWire.ts across
// the Deno/Node line (the s3Presign.test.js arrangement: the Edge-side files
// are imported directly; they are runtime-agnostic on purpose), and holds
// docs/design/gateway-ticket-vectors.json to them.
//
// 🚨 THE VECTORS ARE CHECKED TWICE: once by the cloud's own reference
// verifier and once by node:crypto with no help from the module under test.
// A self-consistent wrong encoding passes every round trip and fails only
// against an implementation that did not produce it (s3Presign.test.js's
// lesson) — GW2's verifier is that implementation on the other side, and
// node:crypto is this side's stand-in for it.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicKey, createPrivateKey, verify as nodeVerify, sign as nodeSign, createHash } from 'node:crypto'
import {
  CLAIM_ORDER, TICKET_MAX_LENGTH, TICKET_TTL_SECONDS, TICKET_SKEW_SECONDS,
  buildClaims, encodePayload, signTicket, verifyTicket, generateSigningKey,
  importSigningPrivateKey, importSigningPublicKey, isCloudRelativePath, PUBLIC_KEY_B64_RE,
} from '../../supabase/functions/_shared/gatewayTicket.ts'
import {
  ENROL_TOKEN_RE, CREDENTIAL_RE, KID_RE, JTI_RE, UUID_RE,
  base32Encode, makeEnrolmentToken, makeCredential, makeJti, makeKid, sha256Hex,
  timingSafeEqual, toBase64Url, fromBase64Url, bearerOf,
} from '../../supabase/functions/_shared/gatewayWire.ts'

const REPO = join(__dirname, '..', '..')
const VECTORS = JSON.parse(readFileSync(join(REPO, 'docs', 'design', 'gateway-ticket-vectors.json'), 'utf8'))

/** node:crypto's own Ed25519 public key from the raw 32 bytes (via JWK), no module code involved. */
function nodePublicKey(rawB64) {
  const x = Buffer.from(rawB64, 'base64').toString('base64url')
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' })
}

const ID = {
  gw: '3b0c6f0e-7d43-4b8a-9a77-0c9b1d2e3f40',
  ws: '11111111-1111-1111-1111-111111111111',
  sub: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  clip: '0b5e8f4a-1c2d-4e3f-8a9b-0c1d2e3f4a5b',
  loc: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
}
const claimsInput = (over = {}) => ({
  kid: 'ktest01', ...ID, path: 'A001/A001_C001.mov', seq: false, mt: 'video/quicktime',
  rv: false, iat: 1791633600, jti: '0123456789abcdef0123456789abcdef', ...over,
})

describe('the vectors file (docs/design/gateway-ticket-vectors.json)', () => {
  it('has the five tickets the brief names, with their verdicts', () => {
    expect(VECTORS.tickets.map((t) => [t.name, t.verdict])).toEqual([
      ['valid_rv_false', 'valid'],
      ['valid_rv_true', 'valid'],
      ['expired', 'expired'],
      ['another_gateway', 'wrong_gateway'],
      ['flipped_signature_byte', 'bad_signature'],
    ])
  })

  it('carries the fixture key pair in the wire\'s forms, and the two halves belong together', async () => {
    const k = VECTORS.key
    expect(k.alg).toBe('Ed25519')
    expect(KID_RE.test(k.kid)).toBe(true)
    expect(PUBLIC_KEY_B64_RE.test(k.public_key)).toBe(true)
    expect(Buffer.from(k.public_key, 'base64')).toHaveLength(32)
    expect(VECTORS.signing_keys).toEqual([{ kid: k.kid, public_key: k.public_key }])
    // The PKCS#8 and the JWK are the same private key, and it signs for the public half.
    const fromPkcs8 = createPrivateKey({ key: Buffer.from(k.private_key_pkcs8, 'base64'), format: 'der', type: 'pkcs8' })
    const fromJwk = createPrivateKey({ key: k.private_key_jwk, format: 'jwk' })
    const msg = Buffer.from('v1.the-two-halves')
    const s1 = nodeSign(null, msg, fromPkcs8)
    const s2 = nodeSign(null, msg, fromJwk)
    expect(s1.equals(s2)).toBe(true) // Ed25519 is deterministic
    expect(nodeVerify(null, msg, nodePublicKey(k.public_key), s1)).toBe(true)
    expect(k.private_key_jwk.x).toBe(Buffer.from(k.public_key, 'base64').toString('base64url'))
  })

  it('every ticket is v1.<payload>.<sig> with the claims in the wire\'s order, no whitespace, exp = iat + 120', () => {
    for (const t of VECTORS.tickets) {
      const [v, payload, sig] = t.ticket.split('.')
      expect(v).toBe('v1')
      expect(payload).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(sig).toMatch(/^[A-Za-z0-9_-]{86}$/) // 64 bytes, no padding
      const json = Buffer.from(payload, 'base64url').toString('utf8')
      expect(json).toBe(JSON.stringify(t.claims))
      expect(json).not.toMatch(/\s(?=(?:[^"]*"[^"]*")*[^"]*$)/) // no whitespace outside strings
      const parsed = JSON.parse(json)
      expect(Object.keys(parsed)).toEqual([...CLAIM_ORDER])
      expect(parsed.v).toBe(1)
      expect(parsed.exp).toBe(parsed.iat + 120)
      expect(JTI_RE.test(parsed.jti)).toBe(true)
      for (const id of ['gw', 'ws', 'sub', 'clip', 'loc']) expect(UUID_RE.test(parsed[id])).toBe(true)
      expect(t.ticket.length).toBeLessThanOrEqual(TICKET_MAX_LENGTH)
    }
  })

  it('the non-ASCII path travels as UTF-8 inside the payload', () => {
    const t = VECTORS.tickets.find((x) => x.name === 'valid_rv_true')
    expect(t.claims.path).toBe('Día 02/Entrevista toma 3.mp4')
    const bytes = Buffer.from(t.ticket.split('.')[1], 'base64url')
    expect(bytes.includes(Buffer.from('Día', 'utf8'))).toBe(true)
  })

  it('🚨 node:crypto, independently: the valid and the expired and the other-gateway tickets carry good signatures; the flipped one does not', () => {
    const pub = nodePublicKey(VECTORS.key.public_key)
    for (const t of VECTORS.tickets) {
      const [, payload, sig] = t.ticket.split('.')
      const good = nodeVerify(null, Buffer.from(`v1.${payload}`, 'ascii'), pub, Buffer.from(sig, 'base64url'))
      expect([t.name, good]).toEqual([t.name, t.verdict !== 'bad_signature'])
    }
  })

  it('the cloud\'s reference verifier gives every ticket its verdict on the inside door, and rv decides the outside door', async () => {
    const keys = { [VECTORS.key.kid]: await importSigningPublicKey(VECTORS.key.public_key) }
    const { gateway_id: gatewayId, workspace_id: workspaceId, now } = VECTORS.verifier
    for (const t of VECTORS.tickets) {
      const inside = await verifyTicket(t.ticket, { publicKeys: keys, gatewayId, workspaceId, now, door: 'inside' })
      const outside = await verifyTicket(t.ticket, { publicKeys: keys, gatewayId, workspaceId, now, door: 'outside' })
      expect([t.name, inside.ok ? 'valid' : inside.reason]).toEqual([t.name, t.verdict])
      const wantOutside = t.name === 'valid_rv_false' ? 'remote_viewing_off' : t.verdict
      expect([t.name, outside.ok ? 'valid' : outside.reason]).toEqual([t.name, wantOutside])
    }
  })

  it('each refused ticket fails exactly one check (its verdict does not depend on a verifier\'s order)', () => {
    const { gateway_id: gw, now } = VECTORS.verifier
    for (const t of VECTORS.tickets) {
      const c = t.claims
      const failures = [
        t.verdict === 'bad_signature',
        now > c.exp + TICKET_SKEW_SECONDS || now < c.iat - TICKET_SKEW_SECONDS,
        c.gw !== gw,
      ].filter(Boolean).length
      expect([t.name, failures]).toEqual([t.name, t.verdict === 'valid' ? 0 : 1])
    }
  })
})

describe('buildClaims — the wire\'s claims, nothing malformed is ever signed', () => {
  it('orders the keys exactly as the wire does and sets exp = iat + 120', () => {
    const c = buildClaims(claimsInput())
    expect(Object.keys(c)).toEqual([...CLAIM_ORDER])
    expect(c.exp - c.iat).toBe(TICKET_TTL_SECONDS)
    expect(c.v).toBe(1)
  })

  it('a row that holds no media type carries the empty string (mt is always a string)', () => {
    expect(buildClaims(claimsInput({ mt: null })).mt).toBe('')
    expect(buildClaims(claimsInput({ mt: undefined })).mt).toBe('')
  })

  it.each([
    ['kid', { kid: 'K1' }], ['kid', { kid: '' }], ['kid', { kid: 'a'.repeat(17) }], ['kid', { kid: 'k-1' }],
    ['gw', { gw: ID.gw.toUpperCase() }], ['ws', { ws: 'not-a-uuid' }], ['sub', { sub: '' }],
    ['clip', { clip: 42 }], ['loc', { loc: null }],
    ['path', { path: '/A001/x.mov' }], ['path', { path: 'A001/x.mov/' }], ['path', { path: 'A001//x.mov' }],
    ['path', { path: 'A001\\x.mov' }], ['path', { path: 'C:/x.mov' }], ['path', { path: '../x.mov' }],
    ['path', { path: 'A/./x.mov' }], ['path', { path: 'A/../x.mov' }], ['path', { path: 'A./x.mov' }],
    ['path', { path: 'A /x.mov' }], ['path', { path: '' }], ['path', { path: 'a'.repeat(1025) }],
    ['seq', { seq: 'false' }], ['rv', { rv: 1 }], ['iat', { iat: 1.5 }], ['iat', { iat: -1 }],
    ['iat', { iat: '1791633600' }], ['jti', { jti: 'ABCDEF0123456789abcdef0123456789' }],
    ['jti', { jti: '0123' }], ['mt', { mt: 'x'.repeat(256) }], ['mt', { mt: 7 }],
  ])('refuses a bad %s', (field, over) => {
    expect(() => buildClaims(claimsInput(over))).toThrow(field)
  })

  it('isCloudRelativePath admits what 0091\'s CHECK admits, counting characters as Postgres does', () => {
    expect(isCloudRelativePath('A001/A001_C001.mov')).toBe(true)
    expect(isCloudRelativePath('Día 02/Entrevista toma 3.mp4')).toBe(true)
    expect(isCloudRelativePath('.hidden/x.mov')).toBe(true) // a dot-led name is a name, not "."
    expect(isCloudRelativePath('😀'.repeat(1024))).toBe(true) // 1024 characters, 2048 UTF-16 units
    expect(isCloudRelativePath('😀'.repeat(1025))).toBe(false)
  })
})

describe('sign and verify, round trip and refusals', () => {
  it('a fresh key signs a ticket the reference verifier accepts, and node:crypto agrees', async () => {
    const k = await generateSigningKey('kround1')
    const claims = buildClaims(claimsInput({ kid: 'kround1' }))
    const t = await signTicket(k.privateKey, claims)
    const keys = { kround1: await importSigningPublicKey(k.publicKey) }
    const r = await verifyTicket(t, { publicKeys: keys, gatewayId: ID.gw, workspaceId: ID.ws, now: claims.iat })
    expect(r).toEqual({ ok: true, claims })
    const [, payload, sig] = t.split('.')
    expect(nodeVerify(null, Buffer.from(`v1.${payload}`), nodePublicKey(k.publicKey), Buffer.from(sig, 'base64url'))).toBe(true)
  })

  it('a key stored as PKCS#8 and imported again signs for the same public half', async () => {
    const k = await generateSigningKey('kstored1')
    const again = await importSigningPrivateKey(k.privatePkcs8)
    const claims = buildClaims(claimsInput({ kid: 'kstored1' }))
    const t = await signTicket(again, claims)
    const keys = { kstored1: await importSigningPublicKey(k.publicKey) }
    expect((await verifyTicket(t, { publicKeys: keys, gatewayId: ID.gw, now: claims.iat })).ok).toBe(true)
  })

  it('the skew is 30 s each way, inclusive', async () => {
    const k = await generateSigningKey('kskew1')
    const claims = buildClaims(claimsInput({ kid: 'kskew1' }))
    const t = await signTicket(k.privateKey, claims)
    const keys = { kskew1: await importSigningPublicKey(k.publicKey) }
    const at = async (now) => {
      const r = await verifyTicket(t, { publicKeys: keys, gatewayId: ID.gw, now })
      return r.ok ? 'valid' : r.reason
    }
    expect(await at(claims.iat - 30)).toBe('valid')
    expect(await at(claims.iat - 31)).toBe('not_yet_valid')
    expect(await at(claims.exp + 30)).toBe('valid')
    expect(await at(claims.exp + 31)).toBe('expired')
  })

  it('refuses a tampered payload, an unknown kid, another workspace, an over-long string and every malformed spelling', async () => {
    const k = await generateSigningKey('ktamp1')
    const claims = buildClaims(claimsInput({ kid: 'ktamp1' }))
    const t = await signTicket(k.privateKey, claims)
    const keys = { ktamp1: await importSigningPublicKey(k.publicKey) }
    const opts = { publicKeys: keys, gatewayId: ID.gw, workspaceId: ID.ws, now: claims.iat }
    const reason = async (ticket, o = opts) => {
      const r = await verifyTicket(ticket, o)
      return r.ok ? 'valid' : r.reason
    }
    const [v, payload, sig] = t.split('.')
    const forged = encodePayload({ ...claims, rv: true })
    expect(await reason(`${v}.${forged}.${sig}`)).toBe('bad_signature')
    expect(await reason(t, { ...opts, publicKeys: {} })).toBe('unknown_kid')
    expect(await reason(t, { ...opts, workspaceId: '22222222-2222-2222-2222-222222222222' })).toBe('wrong_workspace')
    expect(await reason('v1.' + 'A'.repeat(TICKET_MAX_LENGTH))).toBe('too_long')
    expect(await reason(`v2.${payload}.${sig}`)).toBe('malformed')
    expect(await reason(`${v}.${payload}`)).toBe('malformed')
    expect(await reason(`${v}.${payload}=.${sig}`)).toBe('malformed') // padding is not the wire
    expect(await reason(`${v}.${payload}.${sig}=`)).toBe('malformed')
    // Keys reordered, a key added, a key missing: each is malformed even though the JSON is valid.
    const reordered = toBase64Url(new TextEncoder().encode(JSON.stringify({ kid: claims.kid, v: 1, ...claims })))
    expect(await reason(`${v}.${reordered}.${sig}`)).toBe('malformed')
    const extra = toBase64Url(new TextEncoder().encode(JSON.stringify({ ...claims, admin: true })))
    expect(await reason(`${v}.${extra}.${sig}`)).toBe('malformed')
    const { mt: _mt, ...missing } = claims
    expect(await reason(`${v}.${toBase64Url(new TextEncoder().encode(JSON.stringify(missing)))}.${sig}`)).toBe('malformed')
    // A whitespace-padded JSON of the same claims is a different payload: the signature does not cover it.
    const spaced = toBase64Url(new TextEncoder().encode(JSON.stringify(claims, null, 1)))
    expect(await reason(`${v}.${spaced}.${sig}`)).toBe('bad_signature')
  })
})

describe('the wire\'s other shapes (gatewayWire.ts)', () => {
  it('base32 is RFC 4648\'s own (the RFC\'s test vectors, without padding)', () => {
    const enc = (s) => base32Encode(new TextEncoder().encode(s))
    expect(enc('')).toBe('')
    expect(enc('f')).toBe('MY')
    expect(enc('fo')).toBe('MZXQ')
    expect(enc('foo')).toBe('MZXW6')
    expect(enc('foob')).toBe('MZXW6YQ')
    expect(enc('fooba')).toBe('MZXW6YTB')
    expect(enc('foobar')).toBe('MZXW6YTBOI')
  })

  it('an enrolment token is wgt_ + 32 base32 characters (160 bits); a credential wgc_ + 43 base64url', () => {
    for (let i = 0; i < 50; i++) {
      expect(ENROL_TOKEN_RE.test(makeEnrolmentToken())).toBe(true)
      const c = makeCredential()
      expect(CREDENTIAL_RE.test(c)).toBe(true)
      expect(fromBase64Url(c.slice(4))).toHaveLength(32)
      expect(JTI_RE.test(makeJti())).toBe(true)
      expect(KID_RE.test(makeKid())).toBe(true)
    }
    expect(ENROL_TOKEN_RE.test('wgt_' + 'A'.repeat(31))).toBe(false)
    expect(ENROL_TOKEN_RE.test('wgt_' + 'a'.repeat(32))).toBe(false) // upper case only
    expect(ENROL_TOKEN_RE.test('wgt_' + '1'.repeat(32))).toBe(false) // 0, 1, 8, 9 are not base32
  })

  it('the stored form is SHA-256 (hex) of the WHOLE string\'s UTF-8 bytes', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    const token = makeEnrolmentToken()
    expect(await sha256Hex(token)).toBe(createHash('sha256').update(token, 'utf8').digest('hex'))
  })

  it('timingSafeEqual compares whole strings, any length', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
    expect(timingSafeEqual('', '')).toBe(true)
  })

  it('fromBase64Url is strict: no padding, the url alphabet, canonical only', () => {
    expect(Array.from(fromBase64Url('AQID'))).toEqual([1, 2, 3])
    expect(() => fromBase64Url('AQI=')).toThrow()
    expect(() => fromBase64Url('AQ+D')).toThrow()
    expect(() => fromBase64Url('A')).toThrow()
    expect(() => fromBase64Url('AR')).toThrow() // the low bits of the last character are not zero
  })

  it('bearerOf reads the scheme case-insensitively and nothing else', () => {
    expect(bearerOf('Bearer wgc_x')).toBe('wgc_x')
    expect(bearerOf('bearer  wgc_x ')).toBe('wgc_x')
    expect(bearerOf('Basic abc')).toBe('')
    expect(bearerOf(null)).toBe('')
  })
})
