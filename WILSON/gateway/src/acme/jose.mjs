// =============================================================================
// ACME's JSON Web Signatures (RFC 8555 §6.2, RFC 7515, RFC 7638): the
// account key is ECDSA P-256 and every request is signed ES256 (the raw r||s
// signature JOSE uses, not DER). Node's crypto only; nothing here touches the
// network.
// =============================================================================

import crypto from 'node:crypto';

export const b64u = (buf) => Buffer.from(buf).toString('base64url');

/** A new account or certificate key: ECDSA P-256. */
export function newP256Key() {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
}

/** The public JWK of a P-256 key, with only the members RFC 7638 orders. */
export function jwkOf(key) {
  const pub = key.type === 'private' ? crypto.createPublicKey(key) : key;
  const j = pub.export({ format: 'jwk' });
  if (j.kty !== 'EC' || j.crv !== 'P-256') throw new Error('acme: the account key is not ECDSA P-256');
  return { crv: j.crv, kty: j.kty, x: j.x, y: j.y };
}

/** RFC 7638: SHA-256 over the required members in lexicographic order, no whitespace. */
export function thumbprint(jwk) {
  const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}","y":"${jwk.y}"}`;
  return b64u(crypto.createHash('sha256').update(canonical, 'utf8').digest());
}

/** RFC 8555 §8.1: token "." thumbprint. */
export function keyAuthorization(token, accountThumbprint) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{22,}$/.test(token)) throw new Error('acme: the challenge token is not base64url (at least 128 bits)');
  return `${token}.${accountThumbprint}`;
}

/**
 * A flattened JWS for one request. `payload` null is POST-as-GET (an empty
 * payload); `kid` names the account, otherwise the JWK is embedded (newAccount).
 */
export function signJws({ key, url, nonce, payload, kid = null }) {
  const header = { alg: 'ES256', nonce, url, ...(kid ? { kid } : { jwk: jwkOf(key) }) };
  const protectedB64 = b64u(JSON.stringify(header));
  const payloadB64 = payload === null ? '' : b64u(JSON.stringify(payload));
  const signature = crypto.sign('sha256', Buffer.from(`${protectedB64}.${payloadB64}`, 'ascii'), { key, dsaEncoding: 'ieee-p1363' });
  return { protected: protectedB64, payload: payloadB64, signature: b64u(signature) };
}
