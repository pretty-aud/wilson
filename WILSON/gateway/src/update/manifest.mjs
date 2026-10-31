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
// stale signed manifest cannot hold a gateway back) and not more than a day
// ahead of this computer's clock (a manifest dated in the future would make
// every later one look stale); and, for an update, the version is newer than
// the running one. The artefact's hash is checked after download
// (verifyArtefact) and again by the updater on its own copy, immediately
// before the swap (swap.mjs; R7).
//
// GW4 (2026-10-11): the release host is GitHub Releases of the public
// pretty-aud/wilson repository (her ruling): the channel is the latest
// release's stable.json, and every URL a manifest names is a release asset of
// THAT repository, so a stolen signing key alone cannot point a gateway at an
// artefact hosted anywhere else: its holder would also need to publish on the
// repository (the two factors the hardening guide names). The downloads follow
// GitHub's redirect to its asset storage (releaseFetch.mjs: HTTPS only, at
// most three hops, every host on GitHub's list).
//
// The key slots: slot 1 holds the release key GW4 made (its private half is
// the release workflow's secret GATEWAY_RELEASE_SIGNING_KEY and nowhere else);
// slot 2 stays EMPTY for a rotation (§10 row 14). Never a test key here: a key
// whose private half sits in this public repository would let anyone sign a
// "release".
// =============================================================================

import crypto from 'node:crypto';
import { b64StdDecodeStrict } from '../wire/b64.mjs';
import { signingKeyFromWire } from '../wire/formats.mjs';

/** The repository whose Releases are the channel (her ruling of 2026-10-11). */
export const RELEASE_REPOSITORY = 'pretty-aud/wilson';
export const CHANNEL_URL = `https://github.com/${RELEASE_REPOSITORY}/releases/latest/download/stable.json`;
/** Where every Windows artefact a manifest names must live: a release asset of this repository. */
export const ARTEFACT_URL_PREFIX = `https://github.com/${RELEASE_REPOSITORY}/releases/download/`;
/** The image a manifest names for the container (GitHub's Container Registry, by digest). */
export const CONTAINER_IMAGE = 'ghcr.io/pretty-aud/wilson-gateway';

/** Two slots, so one can be rotated (§8, §10 row 14): { kid, public_key } (standard base64, raw 32 bytes). */
export const RELEASE_KEY_SLOTS = 2;
export const RELEASE_KEYS_WIRE = Object.freeze([
  // Slot 1: made 2026-10-11 by GW4 (SPKI SHA-256 11aedaf2d7c56f75400482912d4c70175cd4f7686e9c409c6853f6a18fde7a9a).
  Object.freeze({ kid: 'rel2026a', public_key: '9PA1nN0OWisaCjXfdVb2GxCleXo4Z6HqiwpdZezzuGQ=' }),
  // Slot 2: empty until a rotation.
]);

/** The keys a gateway trusts: the slots as compiled (P8, TPN-ENC-016: the list is a parameter so the pipeline's tests can prove a successor in slot 2 before one exists). */
export function compiledReleaseKeys(keysWire = RELEASE_KEYS_WIRE) {
  return keysWire.slice(0, RELEASE_KEY_SLOTS).map(signingKeyFromWire).filter(Boolean).map((k) => k.key);
}

const VERSION_RE = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
// A tag and an asset name inside the repository's release path: what the
// release workflow names them (gateway-v1.2.3, wilson-gateway-1.2.3-windows-x64.tar.gz).
const ASSET_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export const FUTURE_SLACK_MS = 24 * 3600_000;

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

/** The highest real version among those given, or null. */
export function highestVersion(...vs) {
  let best = null;
  for (const v of vs) if (parseVersion(v) && (best === null || compareVersions(v, best) > 0)) best = v;
  return best;
}

/**
 * A Windows artefact's URL as a manifest may name it: exactly
 * https://github.com/pretty-aud/wilson/releases/download/<tag>/<asset>, with no
 * port, no credentials, no query and no fragment.
 */
export function artefactUrlOk(url) {
  if (typeof url !== 'string' || url.length > 512 || !url.startsWith(ARTEFACT_URL_PREFIX)) return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.hostname !== 'github.com' || u.port !== '' || u.username || u.password || u.search || u.hash) return false;
  if (u.href !== url) return false; // one spelling: no dot segments, no escapes rewritten
  return ASSET_PATH_RE.test(url.slice(ARTEFACT_URL_PREFIX.length));
}

function artefactShapeOk(platformKey, a) {
  if (!a || typeof a !== 'object') return false;
  if (platformKey === 'windows-x64') {
    return artefactUrlOk(a.url) && typeof a.sha256 === 'string' && HEX64_RE.test(a.sha256) && Number.isSafeInteger(a.size) && a.size > 0 && a.size <= 1024 * 1024 * 1024;
  }
  if (platformKey === 'container') return a.image === CONTAINER_IMAGE && /^sha256:[0-9a-f]{64}$/.test(String(a.digest));
  return false;
}

/**
 * @param o.sameIsStale  true (the updater, at the swap): a manifest dated exactly
 *                       as the last one accepted is stale. false (the gateway,
 *                       daily): it is the same manifest seen again, so a failed
 *                       download is tried again the next day.
 * @returns {{ ok: true, manifest: object, newer: boolean } | { ok: false, reason: string }}
 */
export function verifyManifest({ manifestBytes, signatureText, keys = compiledReleaseKeys(), lastPublishedAt = null, runningVersion, platformKey, now = Date.now(), sameIsStale = true }) {
  if (!keys || keys.length === 0) return { ok: false, reason: 'no_release_key' };
  const sig = b64StdDecodeStrict(String(signatureText ?? '').trim());
  if (!sig || sig.length !== 64) return { ok: false, reason: 'signature_shape' };
  const bytes = Buffer.from(manifestBytes);
  const good = keys.some((k) => { try { return crypto.verify(null, bytes, k, sig); } catch { return false; } });
  if (!good) return { ok: false, reason: 'signature' };
  let m;
  try { m = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return { ok: false, reason: 'json' }; }
  if (!m || typeof m !== 'object' || Array.isArray(m) || !parseVersion(m.version)) return { ok: false, reason: 'shape' };
  const published = Date.parse(m.published_at);
  if (typeof m.published_at !== 'string' || !Number.isFinite(published)) return { ok: false, reason: 'shape' };
  for (const k of ['minimum_version', 'hard_minimum_version']) if (m[k] != null && !parseVersion(m[k])) return { ok: false, reason: 'shape' };
  if (!m.artefacts || typeof m.artefacts !== 'object' || !artefactShapeOk(platformKey, m.artefacts[platformKey])) return { ok: false, reason: 'shape' };
  if (published > now + FUTURE_SLACK_MS) return { ok: false, reason: 'future' };
  if (lastPublishedAt != null) {
    const last = Date.parse(lastPublishedAt);
    if (Number.isFinite(last) && (sameIsStale ? !(published > last) : published < last)) return { ok: false, reason: 'stale' };
  }
  return { ok: true, manifest: m, newer: compareVersions(m.version, runningVersion) > 0 };
}

/** The downloaded artefact is the one the signed manifest names: size and SHA-256. */
export function verifyArtefact(bytes, { sha256, size }) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== size || !HEX64_RE.test(String(sha256))) return false;
  const got = crypto.createHash('sha256').update(bytes).digest();
  return crypto.timingSafeEqual(got, Buffer.from(sha256, 'hex'));
}
