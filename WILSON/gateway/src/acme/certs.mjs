// =============================================================================
// The two certificates ACME needs from the gateway, written with its own DER
// encoder (../certs/der.mjs; the gateway takes no dependency):
//
//   the CSR          PKCS#10 (RFC 2986) for ONE DNS name, signed with a fresh
//                    P-256 key: CN and subjectAltName both the outside name
//   the challenge    TLS-ALPN-01 (RFC 8737 §3): self-signed, P-256, the
//   certificate      subjectAltName exactly one dNSName (the name being
//                    validated), and the acmeIdentifier extension, CRITICAL,
//                    holding the SHA-256 of the key authorization as an
//                    OCTET STRING
// =============================================================================

import crypto from 'node:crypto';
import tls from 'node:tls';
import { seq, set, int, oid, bool, octets, bitString, utf8, time, explicit, implicitPrimitive, implicitConstructed } from '../certs/der.mjs';

const OID = {
  ecdsaWithSHA256: '1.2.840.10045.4.3.2',
  commonName: '2.5.4.3',
  extensionRequest: '1.2.840.113549.1.9.14',
  subjectAltName: '2.5.29.17',
  basicConstraints: '2.5.29.19',
  acmeIdentifier: '1.3.6.1.5.5.7.1.31', // id-pe-acmeIdentifier, RFC 8737 §6.1
};
export const ACME_IDENTIFIER_OID = OID.acmeIdentifier;

// A DNS name the gateway asks a certificate for: lower case, LDH labels, at
// least two labels, at most 253 characters. Never an IP literal (Let's
// Encrypt's free route here is names; design §3).
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export function acmeNameOk(name) {
  if (typeof name !== 'string' || name.length > 253 || name !== name.toLowerCase()) return false;
  const labels = name.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return false;
  return !/^[0-9]+$/.test(labels[labels.length - 1]); // a last label of digits is an address, not a name
}

const algorithm = () => seq(oid(OID.ecdsaWithSHA256));
const cnName = (cn) => seq(set(seq(oid(OID.commonName), utf8(cn))));
const sanDns = (name) => seq(seq(oid(OID.subjectAltName), octets(seq(implicitPrimitive(2, Buffer.from(name, 'ascii'))))));

/** PKCS#10 for `name`, DER, signed by `key` (a P-256 private KeyObject). */
export function makeCsr(name, key) {
  if (!acmeNameOk(name)) throw new Error(`acme: ${name} is not a DNS name to ask a certificate for`);
  const spki = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' });
  const attributes = implicitConstructed(0, seq(oid(OID.extensionRequest), set(sanDns(name))));
  const info = seq(int(0), cnName(name), spki, attributes);
  const signature = crypto.sign('sha256', info, key); // DER ECDSA-Sig-Value, as X.509 wants
  return seq(info, algorithm(), bitString(signature));
}

function serial() {
  const b = crypto.randomBytes(16);
  b[0] = (b[0] & 0x3f) | 0x40;
  return b;
}

/**
 * The TLS-ALPN-01 challenge certificate for `name` and this key authorization,
 * with its own fresh key, ready as a secure context for the outside door.
 */
export function makeChallengeCertificate(name, keyAuthorization, { now = Date.now() } = {}) {
  if (!acmeNameOk(name)) throw new Error(`acme: ${name} is not a DNS name`);
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const digest = crypto.createHash('sha256').update(keyAuthorization, 'utf8').digest();
  const ext = (id, critical, value) => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));
  const subject = cnName(name);
  const tbs = seq(
    explicit(0, int(2)),
    int(serial()),
    algorithm(),
    subject,
    seq(time(now - 3600_000), time(now + 24 * 3600_000)),
    subject,
    spki,
    explicit(3, seq(
      ext(OID.basicConstraints, true, seq()),
      ext(OID.subjectAltName, false, seq(implicitPrimitive(2, Buffer.from(name, 'ascii')))),
      ext(OID.acmeIdentifier, true, octets(digest)),
    )),
  );
  const der = seq(tbs, algorithm(), bitString(crypto.sign('sha256', tbs, privateKey)));
  const certPem = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  return { certPem, keyPem, context: tls.createSecureContext({ cert: certPem, key: keyPem, minVersion: 'TLSv1.2' }) };
}
