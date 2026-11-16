// =============================================================================
// ticket.test.mjs — the ticket parser and verifier against the wire fixed in
// the GW1/GW2 briefs: the committed vectors, the 4096-character cap before
// parsing, the canonical form, every claim's shape, the signature (and an
// unknown kid that says nothing of the claims), the dates with 30 s of skew,
// and the gateway/workspace scope.
// =============================================================================

import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { parseTicket, authenticateTicket, checkTicketScope, verifyTicket, MAX_TICKET_CHARS, CLAIM_ORDER } from '../src/wire/ticket.mjs';
import { signingKeyFromWire, publicKeyToWire, isEnrolToken, isCredential, makeEnrolToken, makeCredential, sha256Hex, constantTimeEqual } from '../src/wire/formats.mjs';
import { b64urlDecodeStrict, b64StdDecodeStrict, base32Encode } from '../src/wire/b64.mjs';
import { claimsOf, mintTicket, makeSigningKey, loadVectors } from './mint.mjs';

const V = loadVectors();
const vectorKey = signingKeyFromWire({ kid: V.kid, public_key: V.public_key });
const keyFor = (kid) => (kid === V.kid ? vectorKey.key : null);
const scope = { nowS: V.now, gatewayId: V.gateway_id, workspaceId: V.workspace_id };

const k1 = makeSigningKey('k1');
const k1For = (kid) => (kid === 'k1' ? k1.publicKey : null);
const NOW = 1791590400;
const S = { nowS: NOW, gatewayId: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002' };
const mint = (over = {}) => mintTicket(claimsOf({ iat: NOW - 5, ...over }), k1.privateKey);
// Hand-made payloads: sign whatever text is given, to test the canonical rules.
const signText = (text, key = k1.privateKey) => {
  const payload = Buffer.from(text, 'utf8').toString('base64url');
  return 'v1.' + payload + '.' + crypto.sign(null, Buffer.from('v1.' + payload, 'ascii'), key).toString('base64url');
};

describe('the committed vectors (gateway/test/vectors.json)', () => {
  it('every ticket gets its stated verdict and reason', () => {
    expect(V.tickets).toHaveLength(5);
    for (const t of V.tickets) {
      const r = verifyTicket(t.ticket, { keyFor, ...scope });
      expect(r.ok, t.name).toBe(t.verdict === 'valid');
      if (t.verdict !== 'valid') expect(r.reason, t.name).toBe(t.reason);
      else expect(r.claims, t.name).toEqual(t.claims);
    }
  });
  it('Ed25519 is deterministic: re-minting each claims object with the fixture key gives the committed bytes', () => {
    for (const t of V.tickets.filter((x) => x.name !== 'flipped_signature_byte')) {
      expect(mintTicket(t.claims, V.privateKey), t.name).toBe(t.ticket);
    }
  });
  it('the fixture public key is the wire shape (standard base64 of 32 raw bytes) and matches the private half', () => {
    expect(V.public_key).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(publicKeyToWire(crypto.createPublicKey(V.privateKey))).toBe(V.public_key);
  });
});

describe('the length cap runs before any parsing', () => {
  it('4097 characters are refused as too long, whatever they hold', () => {
    const long = 'v1.' + 'A'.repeat(MAX_TICKET_CHARS - 2);
    expect(long.length).toBe(MAX_TICKET_CHARS + 1);
    expect(parseTicket(long)).toEqual({ ok: false, reason: 'too_long' });
  });
  it('exactly 4096 characters are parsed (and refused for their shape, not their length)', () => {
    const at = 'v1.' + 'A'.repeat(MAX_TICKET_CHARS - 3);
    expect(at.length).toBe(MAX_TICKET_CHARS);
    expect(parseTicket(at).reason).toBe('shape');
  });
  it('a valid ticket padded past the cap by its own path is refused for length', () => {
    const t = mint({ path: 'a/' + 'b'.repeat(1000) });
    expect(t.length).toBeLessThanOrEqual(MAX_TICKET_CHARS);
    expect(verifyTicket(t, { keyFor: k1For, ...S }).ok).toBe(true);
    expect(parseTicket(t + 'x'.repeat(MAX_TICKET_CHARS)).reason).toBe('too_long');
  });
});

describe('the shape: v1.<payload>.<sig>, strict base64url', () => {
  const good = mint();
  const [v, p, s] = good.split('.');
  it('accepts the minted ticket', () => { expect(parseTicket(good).ok).toBe(true); });
  it.each([
    ['not a string', 42],
    ['two parts', `${v}.${p}`],
    ['four parts', `${v}.${p}.${s}.x`],
    ['another version', `v2.${p}.${s}`],
    ['upper-case prefix', `V1.${p}.${s}`],
    ['padding on the payload', `${v}.${p}=.${s}`],
    ['standard base64 characters', `${v}.${p.replace(/-/g, '+').replace(/_/g, '/')}x+/.${s}`],
    ['a signature of 63 bytes', `${v}.${p}.${Buffer.alloc(63, 1).toString('base64url')}`],
    ['a signature of 65 bytes', `${v}.${p}.${Buffer.alloc(65, 1).toString('base64url')}`],
    ['an empty payload', `${v}..${s}`],
  ])('refuses %s', (_name, t) => {
    expect(parseTicket(t).ok).toBe(false);
  });
  it('refuses a non-canonical signature spelling (stray low bits decode to the same bytes)', () => {
    // 64 bytes → 86 base64url characters; the last carries 2 spare bits.
    const last = s[s.length - 1];
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const twin = alphabet[alphabet.indexOf(last) + 1];
    const t2 = `${v}.${p}.${s.slice(0, -1)}${twin}`;
    expect(Buffer.from(s, 'base64url').equals(Buffer.from(t2.split('.')[2], 'base64url'))).toBe(true);
    expect(parseTicket(t2).ok).toBe(false);
  });
});

describe('the payload and the canonical claims', () => {
  const claims = claimsOf({ iat: NOW - 5 });
  const text = JSON.stringify(claims);
  it('the canonical text is accepted', () => { expect(parseTicket(signText(text)).ok).toBe(true); });
  it('invalid UTF-8 is refused', () => {
    const payload = Buffer.from([0x7b, 0xff, 0xfe, 0x7d]).toString('base64url');
    expect(parseTicket(`v1.${payload}.${Buffer.alloc(64).toString('base64url')}`).reason).toBe('payload');
  });
  it('not JSON, an array or a number is refused', () => {
    expect(parseTicket(signText('{nope')).reason).toBe('payload');
    expect(parseTicket(signText('[1,2]')).reason).toBe('claims');
    expect(parseTicket(signText('7')).reason).toBe('claims');
  });
  it('whitespace anywhere is refused (JSON.stringify writes none)', () => {
    expect(parseTicket(signText(JSON.stringify(claims, null, 1))).reason).toBe('claims');
    expect(parseTicket(signText(text.replace('"v":1', '"v": 1'))).reason).toBe('claims');
  });
  it('a duplicate key is refused (the parser keeps the last; the canonical form shows it)', () => {
    expect(parseTicket(signText(text.replace('"rv":false', '"rv":false,"rv":true'))).ok).toBe(false);
    expect(parseTicket(signText(text.slice(0, -1) + ',"v":1}')).ok).toBe(false);
  });
  it('another spelling of a number is refused', () => {
    expect(parseTicket(signText(text.replace(`"iat":${claims.iat}`, `"iat":${claims.iat}.0`))).ok).toBe(false);
    expect(parseTicket(signText(text.replace(`"v":1`, '"v":1e0'))).ok).toBe(false);
  });
  it('keys out of order, missing or extra are refused', () => {
    const reordered = { kid: claims.kid, v: 1, ...Object.fromEntries(CLAIM_ORDER.slice(2).map((k) => [k, claims[k]])) };
    expect(parseTicket(signText(JSON.stringify(reordered))).reason).toBe('claims');
    const missing = { ...claims }; delete missing.mt;
    expect(parseTicket(signText(JSON.stringify(missing))).reason).toBe('claims');
    expect(parseTicket(signText(JSON.stringify({ ...claims, extra: 1 }))).reason).toBe('claims');
  });
  it.each([
    ['v is 2', { v: 2 }],
    ['v is "1"', { v: '1' }],
    ['kid upper case', { kid: 'K1' }],
    ['kid of 17 characters', { kid: 'a'.repeat(17) }],
    ['kid empty', { kid: '' }],
    ['gw upper case', { gw: '00000000-0000-4000-8000-00000000000A' }],
    ['ws not a uuid', { ws: 'workspace' }],
    ['sub braced', { sub: '{00000000-0000-4000-8000-000000000003}' }],
    ['clip a number', { clip: 4 }],
    ['loc missing a group', { loc: '00000000-0000-4000-8000' }],
    ['path empty', { path: '' }],
    ['path 1025 characters', { path: 'a'.repeat(1025) }],
    ['path not a string', { path: ['a'] }],
    ['seq a string', { seq: 'false' }],
    ['rv a number', { rv: 1 }],
    ['mt a number', { mt: 7 }],
    ['mt 256 characters', { mt: 'v'.repeat(256) }],
    ['iat a fraction', { iat: NOW + 0.5, exp: NOW + 120.5 }],
    ['iat zero', { iat: 0, exp: 120 }],
    ['exp not iat + 120', { exp: NOW - 5 + 121 }],
    ['jti upper case', { jti: 'A'.repeat(32) }],
    ['jti 31 characters', { jti: 'a'.repeat(31) }],
  ])('refuses %s', (_name, over) => {
    expect(parseTicket(signText(JSON.stringify({ ...claims, ...over }))).ok).toBe(false);
  });
  it('mt may be null (0091 lets the row hold no media type) or any short string', () => {
    expect(parseTicket(signText(JSON.stringify({ ...claims, mt: null }))).ok).toBe(true);
    expect(parseTicket(signText(JSON.stringify({ ...claims, mt: '' }))).ok).toBe(true);
  });
  it('a path with characters beyond ASCII is carried as UTF-8 and accepted', () => {
    const t = mint({ path: 'Día 1/Ñandú — clip.mov' });
    expect(verifyTicket(t, { keyFor: k1For, ...S }).claims.path).toBe('Día 1/Ñandú — clip.mov');
  });
});

describe('the signature', () => {
  it('a ticket signed by another key is refused', () => {
    const other = makeSigningKey('k1');
    const t = mintTicket(claimsOf({ iat: NOW - 5 }), other.privateKey);
    expect(authenticateTicket(t, { keyFor: k1For }).reason).toBe('signature');
  });
  it('a flipped payload byte is refused', () => {
    const [v, p, s] = mint().split('.');
    const bytes = Buffer.from(p, 'base64url');
    bytes[bytes.length - 3] ^= 0x01; // inside the claims, still valid JSON? either way refused
    expect(authenticateTicket(`${v}.${bytes.toString('base64url')}.${s}`, { keyFor: k1For }).ok).toBe(false);
  });
  it('an unknown kid answers unknown_kid with the kid and NOTHING of the unauthenticated claims', () => {
    const r = authenticateTicket(mint({ kid: 'k9' }), { keyFor: k1For });
    expect(r).toEqual({ ok: false, reason: 'unknown_kid', kid: 'k9' });
  });
  it('a keyFor that answers a key of another type is refused, not thrown', () => {
    const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    expect(authenticateTicket(mint(), { keyFor: () => publicKey }).ok).toBe(false);
  });
});

describe('the dates (iat is the not-before; 30 s of skew each way)', () => {
  const at = (iat, nowS) => verifyTicket(mint({ iat }), { keyFor: k1For, ...S, nowS });
  it('accepts across the ticket life', () => {
    expect(at(NOW, NOW).ok).toBe(true);
    expect(at(NOW, NOW + 119).ok).toBe(true);
  });
  it('accepts a ticket from up to 30 s in the future, refuses 31 s', () => {
    expect(at(NOW + 30, NOW).ok).toBe(true);
    expect(at(NOW + 31, NOW).reason).toBe('not_yet');
  });
  it('accepts until 30 s after exp, refuses at exp + 30', () => {
    expect(at(NOW, NOW + 120 + 29).ok).toBe(true);
    expect(at(NOW, NOW + 120 + 30).reason).toBe('expired');
  });
});

describe('the scope: this gateway, this workspace', () => {
  it('another gateway or workspace is refused, and so is a gateway that does not know its own ids', () => {
    expect(verifyTicket(mint({ gw: '00000000-0000-4000-8000-0000000000ff' }), { keyFor: k1For, ...S }).reason).toBe('wrong_gateway');
    expect(verifyTicket(mint({ ws: '00000000-0000-4000-8000-0000000000ff' }), { keyFor: k1For, ...S }).reason).toBe('wrong_workspace');
    expect(verifyTicket(mint(), { keyFor: k1For, ...S, gatewayId: null }).reason).toBe('wrong_gateway');
    expect(verifyTicket(mint(), { keyFor: k1For, ...S, workspaceId: '' }).reason).toBe('wrong_workspace');
  });
  it('checkTicketScope alone reads only the dates and the two ids', () => {
    expect(checkTicketScope(claimsOf({ iat: NOW }), S)).toEqual({ ok: true });
  });
});

describe('the fixed token, credential and key formats', () => {
  it('an enrolment token is wgt_ + 32 base32 characters (160 bits)', () => {
    for (let i = 0; i < 50; i++) expect(isEnrolToken(makeEnrolToken())).toBe(true);
    expect(isEnrolToken('wgt_' + 'A'.repeat(31))).toBe(false);
    expect(isEnrolToken('wgt_' + 'a'.repeat(32))).toBe(false);
    expect(isEnrolToken('wgt_' + '1'.repeat(32))).toBe(false); // 0, 1, 8, 9 are not base32
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI'); // RFC 4648 §10
  });
  it('a credential is wgc_ + canonical base64url of exactly 32 bytes', () => {
    for (let i = 0; i < 50; i++) expect(isCredential(makeCredential())).toBe(true);
    const c = makeCredential();
    expect(isCredential(c + 'A')).toBe(false);
    expect(isCredential('wgc_' + Buffer.alloc(31).toString('base64url'))).toBe(false);
    expect(isCredential(c.replace('wgc_', 'wgt_'))).toBe(false);
    expect(isCredential(c + '=')).toBe(false);
  });
  it('sha256Hex is of the WHOLE string, prefix included, lower-case hex', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const t = makeEnrolToken();
    expect(sha256Hex(t)).not.toBe(sha256Hex(t.slice(4)));
  });
  it('a signing key is refused unless kid and key are exactly the wire shape', () => {
    const good = makeSigningKey('abc123').wire;
    expect(signingKeyFromWire(good)?.kid).toBe('abc123');
    expect(signingKeyFromWire({ ...good, kid: 'ABC' })).toBeNull();
    expect(signingKeyFromWire({ ...good, public_key: good.public_key.replace('=', '') })).toBeNull();
    expect(signingKeyFromWire({ ...good, public_key: Buffer.alloc(31).toString('base64') })).toBeNull();
    // The base64url spelling of a key differs from the standard one only when the
    // key has a '+' or '/' in it (three keys in four): pick such a key.
    let spelled = good;
    for (let i = 0; i < 64 && !/[+/]/.test(spelled.public_key); i++) spelled = makeSigningKey('abc123').wire;
    expect(spelled.public_key).toMatch(/[+/]/);
    expect(signingKeyFromWire({ ...spelled, public_key: Buffer.from(spelled.public_key, 'base64').toString('base64url') + '=' })).toBeNull();
    expect(signingKeyFromWire(null)).toBeNull();
  });
  it('strict decoders refuse what Node would quietly accept', () => {
    expect(b64urlDecodeStrict('ab cd')).toBeNull();
    expect(b64urlDecodeStrict('abc=')).toBeNull();
    expect(b64StdDecodeStrict('YWJj')).toEqual(Buffer.from('abc'));
    expect(b64StdDecodeStrict('YWJ')).toBeNull();
    expect(b64StdDecodeStrict('YW-j')).toBeNull();
  });
  it('constantTimeEqual answers equality and never throws on a length difference', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual(null, 'abc')).toBe(false);
  });
});
