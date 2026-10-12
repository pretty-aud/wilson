// =============================================================================
// The wire's fixed formats (the GW2 brief's "The wire, fixed", word for word
// in GW1's brief too, so the cloud and the gateway agree without talking).
//
//   Enrolment token   wgt_ + 32 characters of base32 (RFC 4648, upper case,
//                     160 random bits). The cloud stores SHA-256 (hex) of the
//                     WHOLE string's UTF-8 bytes; 24 h, single use.
//   Credential        wgc_ + base64url (no padding) of 32 random bytes; stored
//                     as SHA-256 (hex) of the whole string; carried as
//                     `Authorization: Bearer <credential>` on every call.
//   kid               1–16 characters of [a-z0-9].
//   Signing key       Ed25519, the public half as STANDARD base64 of the raw
//                     32 bytes (`signing_keys: [{ kid, public_key }]`).
// =============================================================================

import crypto from 'node:crypto';
import { b64urlDecodeStrict, b64StdDecodeStrict, b64urlEncode, base32Encode } from './b64.mjs';

export const ENROL_TOKEN_RE = /^wgt_[A-Z2-7]{32}$/;
export const KID_RE = /^[a-z0-9]{1,16}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const JTI_RE = /^[0-9a-f]{32}$/;

/** SHA-256 of a string's UTF-8 bytes, lower-case hex (how the cloud stores token and credential). */
export function sha256Hex(s) {
  return crypto.createHash('sha256').update(Buffer.from(String(s), 'utf8')).digest('hex');
}

export function isEnrolToken(s) {
  return typeof s === 'string' && ENROL_TOKEN_RE.test(s);
}

/** A credential is `wgc_` + the canonical base64url of exactly 32 bytes. */
export function isCredential(s) {
  if (typeof s !== 'string' || !s.startsWith('wgc_')) return false;
  const bytes = b64urlDecodeStrict(s.slice(4));
  return !!bytes && bytes.length === 32;
}

/** Made by the cloud; here for the fake cloud and the tests only. */
export function makeEnrolToken() {
  return 'wgt_' + base32Encode(crypto.randomBytes(20));
}

/** Made by the cloud; here for the fake cloud and the tests only. */
export function makeCredential() {
  return 'wgc_' + b64urlEncode(crypto.randomBytes(32));
}

// The fixed DER prefix of an Ed25519 SubjectPublicKeyInfo (RFC 8410): the raw
// 32-byte key follows it.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * One `{ kid, public_key }` from a sync answer → `{ kid, key: KeyObject }`, or
 * null when either half is not the fixed shape (refused, never half-used).
 */
export function signingKeyFromWire(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const { kid, public_key: pub } = entry;
  if (typeof kid !== 'string' || !KID_RE.test(kid)) return null;
  const raw = b64StdDecodeStrict(pub);
  if (!raw || raw.length !== 32) return null;
  try {
    const key = crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
    return key.asymmetricKeyType === 'ed25519' ? { kid, key } : null;
  } catch {
    return null;
  }
}

/** The wire's public half of an Ed25519 KeyObject (standard base64 of the raw 32 bytes). */
export function publicKeyToWire(keyObject) {
  const der = keyObject.export({ format: 'der', type: 'spki' });
  return Buffer.from(der.subarray(der.length - 32)).toString('base64');
}

/**
 * The reach key (GW3, 2026-10-11, reconciled with GW1's review round 2): what
 * the reach check's proof is keyed by. Never the credential's own hash (the
 * key every cloud call is looked up by, which the platform's request logs
 * keep): the lower-case hex SHA-256 of the UTF-8 bytes of 'wilson-reach-key:'
 * followed by the credential. The gateway derives it from its credential; the
 * cloud derives the same at enrolment (gateway_secrets.reach_key) and sends it
 * nowhere. The vectors file's `for_gw2_from_gw1.reach_probe.proof_vector` is
 * the worked example (credential → reach_key → nonce_proof).
 */
export function reachKeyOf(credential) {
  if (!isCredential(credential)) throw new Error('reachKeyOf: the credential is wgc_ and 43 base64url characters');
  return sha256Hex('wilson-reach-key:' + credential);
}

/**
 * The reach check's proof (GW1 review round 1, finding 1: an echo of the nonce
 * proves nothing, since the nonce rides the probe's request and any server
 * that reflects a header would pass). HMAC-SHA256 with key = the UTF-8 bytes
 * of the reach key's 64 hex characters and message = the UTF-8 bytes of the
 * nonce, as 64 lower-case hex characters. Only the credential's holder can
 * make it; the cloud computes the same from the reach key it keeps.
 */
export function reachProof(reachKey, nonce) {
  if (typeof reachKey !== 'string' || !/^[0-9a-f]{64}$/.test(reachKey)) throw new Error('reachProof: the reach key is 64 lower-case hex');
  if (typeof nonce !== 'string' || !nonce) throw new Error('reachProof: the nonce is a string');
  return crypto.createHmac('sha256', Buffer.from(reachKey, 'utf8')).update(Buffer.from(nonce, 'utf8')).digest('hex');
}

/** Equal-length, constant-time comparison of two secrets given as strings; false on any length difference. */
export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // Compare against a same-length buffer either way, so the time does not
  // say which byte differed; the length difference itself is not secret here.
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, Buffer.alloc(ab.length));
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}
