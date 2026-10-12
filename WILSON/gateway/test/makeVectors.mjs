// =============================================================================
// Writes gateway/test/vectors.json: a THROWAWAY Ed25519 key pair (both halves,
// a fixture, never a real key), its kid, and five tickets with their verdicts,
// in the wire's format (the brief's "Test vectors"). Run once; the file is
// committed. Ed25519 is deterministic, so ticket.test.mjs re-mints every
// ticket from the committed private key and claims and demands the same bytes.
//
//   node gateway/test/makeVectors.mjs
// =============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HERE, mintTicket } from './mint.mjs';
import { publicKeyToWire } from '../src/wire/formats.mjs';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const kid = 'gw2fixture1';
const gw = '6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f601';
const ws = '0a1b2c3d-4e5f-4a6b-9c7d-8e9fa0b1c2d3';
const now = 1791590400; // 2026-10-10T00:00:00Z, the vectors' reference clock
const base = (over) => ({
  v: 1,
  kid,
  gw,
  ws,
  sub: '11111111-2222-4333-8444-555555555555',
  clip: '99999999-8888-4777-b666-555555555555',
  loc: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  path: 'Day 01/A001C003_240612_R1AB.mov',
  seq: false,
  mt: 'video/quicktime',
  rv: false,
  iat: now - 10,
  exp: now - 10 + 120,
  jti: crypto.randomBytes(16).toString('hex'),
  ...over,
});

const cases = [
  { name: 'valid_rv_false', claims: base({ rv: false }), verdict: 'valid', reason: null },
  { name: 'valid_rv_true', claims: base({ rv: true }), verdict: 'valid', reason: null },
  { name: 'expired', claims: base({ iat: now - 400, exp: now - 400 + 120 }), verdict: 'invalid', reason: 'expired' },
  { name: 'another_gateway', claims: base({ gw: '7f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f602' }), verdict: 'invalid', reason: 'wrong_gateway' },
  { name: 'flipped_signature_byte', claims: base({}), verdict: 'invalid', reason: 'signature', flip: true },
];

const tickets = cases.map((c) => {
  let ticket = mintTicket(c.claims, privateKey);
  if (c.flip) {
    const [v, payload, sig] = ticket.split('.');
    const bytes = Buffer.from(sig, 'base64url');
    bytes[10] ^= 0x01;
    ticket = [v, payload, bytes.toString('base64url')].join('.');
  }
  return { name: c.name, ticket, claims: c.claims, verdict: c.verdict, reason: c.reason };
});

const out = {
  description: 'GW2 fixture: a throwaway Ed25519 key pair, never a real key. Tickets in the wire format of the GW1/GW2 briefs ("The wire, fixed"). Verdicts at `now` for gateway `gateway_id` in workspace `workspace_id`.',
  alg: 'Ed25519',
  kid,
  public_key: publicKeyToWire(publicKey),
  private_key_pkcs8: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  gateway_id: gw,
  workspace_id: ws,
  now,
  skew_s: 30,
  tickets,
};
fs.writeFileSync(path.join(HERE, 'vectors.json'), JSON.stringify(out, null, 2) + '\n');
console.log('wrote', path.join(HERE, 'vectors.json'));
