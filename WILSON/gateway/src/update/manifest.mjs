// =============================================================================
// The release channel's manifest (design §8, D13; review round 2, R20).
//
//   stable.json      { version, published_at, minimum_version, hard_minimum_version,
//                      artefacts: { "windows-x64": { url, sha256, size },
//                                   "container": { image, digest } }, notes }
//   stable.json.sig  standard base64 of the 64-byte Ed25519 signature over the
//                    exact bytes of stable.json (whitespace around it ignored)
//
// Accepted only when: the signature verifies with one of the two compiled-in
// release keys; `published_at` is newer than the last manifest accepted (so a
// stale signed manifest cannot hold a gateway back); and, for an update, the
// version is newer than the running one. The artefact's hash is checked after
// download (verifyArtefact) and again by the updater on its own copy,
// immediately before the swap (swap.mjs; R7).
//
// THE KEY SLOTS ARE EMPTY until GW4 makes the release keys (its pipeline signs
// with the private halves, kept in the release workflow's secret). Never a
// test key here: a key whose private half sits in this public repository
// would let anyone publish a "release". With no key, every manifest is
// refused and the health line says updates are off until one is set.
// =============================================================================

import crypto from 'node:crypto';
import { b64StdDecodeStrict } from '../wire/b64.mjs';
import { signingKeyFromWire } from '../wire/formats.mjs';

export const CHANNEL_URL = 'https://releases.petalstudios.com/wilson-gateway/stable.json';

/** Two slots, so one can be rotated (§8, §10 row 14). GW4 fills them: { kid, public_key } (standard base64, raw 32 bytes). */
export const RELEASE_KEYS_WIRE = Object.freeze([]);

export function compiledReleaseKeys() {
  return RELEASE_KEYS_WIRE.map(signingKeyFromWire).filter(Boolean).map((k) => k.key);
}

const VERSION_RE = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

export function parseVersion(v) {
  const m = typeof v === 'string' ? VERSION_RE.exec(v) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** -1, 0 or 1; an unparseable version sorts below every real one. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x && !y) return 0;
  if (!x) return -1;
  if (!y) return 1;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

function artefactShapeOk(platformKey, a) {
  if (!a || typeof a !== 'object') return false;
  if (platformKey === 'windows-x64') {
    let u;
    try { u = new URL(a.url); } catch { return false; }
    return u.protocol === 'https:' && typeof a.sha256 === 'string' && HEX64_RE.test(a.sha256) && Number.isSafeInteger(a.size) && a.size > 0 && a.size <= 1024 * 1024 * 1024;
  }
  if (platformKey === 'container') return typeof a.image === 'string' && a.image.length <= 256 && /^sha256:[0-9a-f]{64}$/.test(String(a.digest));
  return false;
}

/**
 * @returns {{ ok: true, manifest: object, newer: boolean } | { ok: false, reason: string }}
 */
export function verifyManifest({ manifestBytes, signatureText, keys = compiledReleaseKeys(), lastPublishedAt = null, runningVersion, platformKey }) {
  if (!keys || keys.length === 0) return { ok: false, reason: 'no_release_key' };
  const sig = b64StdDecodeStrict(String(signatureText ?? '').trim());
  if (!sig || sig.length !== 64) return { ok: false, reason: 'signature_shape' };
  const bytes = Buffer.from(manifestBytes);
  const good = keys.some((k) => { try { return crypto.verify(null, bytes, k, sig); } catch { return false; } });
  if (!good) return { ok: false, reason: 'signature' };
  let m;
  try { m = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return { ok: false, reason: 'json' }; }
  if (!m || typeof m !== 'object' || !parseVersion(m.version)) return { ok: false, reason: 'shape' };
  const published = Date.parse(m.published_at);
  if (typeof m.published_at !== 'string' || !Number.isFinite(published)) return { ok: false, reason: 'shape' };
  for (const k of ['minimum_version', 'hard_minimum_version']) if (m[k] != null && !parseVersion(m[k])) return { ok: false, reason: 'shape' };
  if (!m.artefacts || !artefactShapeOk(platformKey, m.artefacts[platformKey])) return { ok: false, reason: 'shape' };
  if (lastPublishedAt != null && !(published > Date.parse(lastPublishedAt))) return { ok: false, reason: 'stale' };
  return { ok: true, manifest: m, newer: compareVersions(m.version, runningVersion) > 0 };
}

/** The downloaded artefact is the one the signed manifest names: size and SHA-256. */
export function verifyArtefact(bytes, { sha256, size }) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== size || !HEX64_RE.test(String(sha256))) return false;
  const got = crypto.createHash('sha256').update(bytes).digest();
  return crypto.timingSafeEqual(got, Buffer.from(sha256, 'hex'));
}
