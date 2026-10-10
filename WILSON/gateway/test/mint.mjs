// =============================================================================
// The cloud's half of the ticket, for the fake cloud and the tests ONLY.
// Nothing under gateway/src mints: the gateway holds no signing key (D1).
// =============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAIM_ORDER, TICKET_LIFE_S } from '../src/wire/ticket.mjs';
import { publicKeyToWire } from '../src/wire/formats.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Claims in the wire's order from a partial object (missing keys default). */
export function claimsOf(partial) {
  const iat = partial.iat ?? Math.floor(Date.now() / 1000);
  const base = {
    v: 1,
    kid: 'k1',
    gw: '00000000-0000-4000-8000-000000000001',
    ws: '00000000-0000-4000-8000-000000000002',
    sub: '00000000-0000-4000-8000-000000000003',
    clip: '00000000-0000-4000-8000-000000000004',
    loc: '00000000-0000-4000-8000-000000000005',
    path: 'A001/clip.mp4',
    seq: false,
    mt: 'video/mp4',
    rv: false,
    iat,
    exp: iat + TICKET_LIFE_S,
    jti: crypto.randomBytes(16).toString('hex'),
  };
  const out = {};
  for (const k of CLAIM_ORDER) out[k] = k in partial ? partial[k] : base[k];
  if (!('exp' in partial)) out.exp = out.iat + TICKET_LIFE_S;
  return out;
}

/** v1.<payload>.<sig> exactly as the wire fixes it. */
export function mintTicket(claims, privateKey) {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const sig = crypto.sign(null, Buffer.from('v1.' + payload, 'ascii'), privateKey);
  return 'v1.' + payload + '.' + sig.toString('base64url');
}

/** A fresh throwaway Ed25519 pair in the wire's shape. */
export function makeSigningKey(kid = 'k1') {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return { kid, privateKey, publicKey, wire: { kid, public_key: publicKeyToWire(publicKey) } };
}

/** The committed fixture (gateway/test/vectors.json): its key pair and tickets. */
export function loadVectors(file = path.join(HERE, 'vectors.json')) {
  const v = JSON.parse(fs.readFileSync(file, 'utf8'));
  const privateKey = crypto.createPrivateKey({ key: Buffer.from(v.private_key_pkcs8, 'base64'), format: 'der', type: 'pkcs8' });
  return { ...v, privateKey };
}
