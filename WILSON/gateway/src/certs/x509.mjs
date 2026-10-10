// =============================================================================
// The gateway's own certificates (design §3, D3; review round 1, F6; review
// round 2, R1, R21, D26).
//
//   root   ECDSA P-256, ten years, basicConstraints CA with path length 0
//          (critical), keyUsage keyCertSign + cRLSign (critical), and NAME
//          CONSTRAINTS (critical): permitted DNS names = the hostname and
//          <hostname>.local; permitted IP ranges = the /24 around each inside
//          IPv4 address and the /64 around each unique-local IPv6 address,
//          never the interface's own mask when that is wider. Everything
//          outside the permitted set is forbidden by the extension's own rule.
//          Both name types are ALWAYS constrained: with no address the IP
//          permitted set is the single unspecified address (nothing a leaf can
//          use), with no valid hostname the DNS set is `invalid` (RFC 6761),
//          so a type is never left unconstrained by being absent.
//   leaf   ECDSA P-256, 397 days, SAN = the hostname, the .local name and every
//          inside address; serverAuth; signed by the root.
//
// The root's subject names the host, not the company: the root is made before
// enrolment (its PEM goes in the enrolment call), so the company's name is not
// known yet (dated line in the design's review history, 2026-10-10).
// Key identifiers are the leftmost 160 bits of SHA-256 (RFC 7093 method 1):
// no SHA-1 anywhere (TPN bans it).
// =============================================================================

import crypto from 'node:crypto';
import { seq, set, int, oid, nul, bool, octets, bitString, utf8, ia5, time, explicit, implicitPrimitive, implicitConstructed } from './der.mjs';
import { parseIp, surroundingNet, formatCidr, formatIp } from '../rules/ip.mjs';

const OID = {
  ecdsaWithSHA256: '1.2.840.10045.4.3.2',
  commonName: '2.5.4.3',
  organization: '2.5.4.10',
  basicConstraints: '2.5.29.19',
  keyUsage: '2.5.29.15',
  extKeyUsage: '2.5.29.37',
  serverAuth: '1.3.6.1.5.5.7.3.1',
  subjectAltName: '2.5.29.17',
  nameConstraints: '2.5.29.30',
  subjectKeyIdentifier: '2.5.29.14',
  authorityKeyIdentifier: '2.5.29.35',
};

export const ROOT_YEARS = 10;
export const LEAF_DAYS = 397;
const DAY = 86_400_000;
const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** The DNS names a host may claim: its hostname and .local, lower-cased; none when the hostname is not a DNS label. */
export function hostNames(hostname) {
  const h = String(hostname || '').trim().toLowerCase().replace(/\.local$/, '');
  return DNS_LABEL_RE.test(h) ? [h, `${h}.local`] : [];
}

const algorithm = () => seq(oid(OID.ecdsaWithSHA256));
const name = (cn) => seq(set(seq(oid(OID.organization), utf8('WILSON file gateway'))), set(seq(oid(OID.commonName), utf8(cn))));
const extension = (id, critical, value) => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));
const keyId = (spkiDer) => {
  // The BIT STRING's contents of the SPKI is the public key; for P-256 SPKI DER
  // that is the last 65 bytes (04 || X || Y).
  return crypto.createHash('sha256').update(spkiDer.subarray(spkiDer.length - 65)).digest().subarray(0, 20);
};
function serial() {
  const b = crypto.randomBytes(16);
  b[0] = (b[0] & 0x3f) | 0x40; // positive, non-zero, 16 bytes
  return b;
}
const ipBytes = (ip) => Buffer.from(ip.bytes);
const maskBytes = (family, prefix) => {
  const len = family === 4 ? 4 : 16;
  const out = Buffer.alloc(len);
  for (let i = 0; i < len; i++) out[i] = Math.max(0, Math.min(8, prefix - i * 8)) === 0 ? 0 : (0xff << (8 - Math.min(8, prefix - i * 8))) & 0xff;
  return out;
};

/** The permitted sets for a host and its inside addresses (D26: /24 and /64). */
export function permittedFor({ hostname, insideAddresses }) {
  const dns = hostNames(hostname);
  const nets = [];
  const seen = new Set();
  for (const a of insideAddresses || []) {
    const ip = parseIp(String(a));
    if (!ip) continue;
    const n = surroundingNet(ip);
    const k = formatCidr(n);
    if (!seen.has(k)) { seen.add(k); nets.push(n); }
  }
  return { dns, nets, netsText: nets.map(formatCidr) };
}

function nameConstraintsValue({ dns, nets }) {
  const subtrees = [];
  for (const d of dns.length ? dns : ['invalid']) subtrees.push(seq(implicitPrimitive(2, Buffer.from(d, 'ascii'))));
  if (nets.length) for (const n of nets) subtrees.push(seq(implicitPrimitive(7, Buffer.concat([Buffer.from(n.bytes), maskBytes(n.family, n.prefix)]))));
  else subtrees.push(seq(implicitPrimitive(7, Buffer.alloc(8)))); // 0.0.0.0/32: nothing usable
  return seq(implicitConstructed(0, Buffer.concat(subtrees)));
}

function sign(tbs, privateKey) {
  const sig = crypto.sign('sha256', tbs, privateKey); // DER ECDSA-Sig-Value
  return seq(tbs, algorithm(), bitString(sig));
}

const pem = (der, label = 'CERTIFICATE') => `-----BEGIN ${label}-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;

export function fingerprintOf(certPem) {
  return new crypto.X509Certificate(certPem).fingerprint256.replace(/:/g, '').toLowerCase();
}
/** The fingerprint as people read it: upper-case pairs with colons. */
export function displayFingerprint(hex) {
  return String(hex).toUpperCase().match(/.{2}/g).join(':');
}

export function makeRoot({ hostname, insideAddresses, now = Date.now() }) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const ski = keyId(spki);
  const permitted = permittedFor({ hostname, insideAddresses });
  const cn = `WILSON Gateway Root (${String(hostname || 'gateway').slice(0, 40)})`;
  const notBefore = now - 60 * 60 * 1000;
  const notAfter = new Date(now);
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + ROOT_YEARS);
  const subject = name(cn);
  const tbs = seq(
    explicit(0, int(2)),
    int(serial()),
    algorithm(),
    subject,
    seq(time(notBefore), time(notAfter)),
    subject,
    spki,
    explicit(3, seq(
      extension(OID.basicConstraints, true, seq(bool(true), int(0))),
      extension(OID.keyUsage, true, bitString(Buffer.from([0x06]), 1)), // keyCertSign | cRLSign
      extension(OID.nameConstraints, true, nameConstraintsValue(permitted)),
      extension(OID.subjectKeyIdentifier, false, octets(ski)),
    )),
  );
  const certPem = pem(sign(tbs, privateKey));
  return {
    certPem,
    keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    fingerprint: fingerprintOf(certPem),
    notAfter: notAfter.getTime(),
    permitted: { dns: permitted.dns, nets: permitted.netsText },
  };
}

export function makeLeaf({ rootCertPem, rootKeyPem, hostname, insideAddresses, now = Date.now(), days = LEAF_DAYS, extraDnsNames = [] }) {
  const root = new crypto.X509Certificate(rootCertPem);
  const rootKey = crypto.createPrivateKey(rootKeyPem);
  const rootSpki = root.publicKey.export({ type: 'spki', format: 'der' });
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const dns = [...hostNames(hostname), ...extraDnsNames];
  const ips = (insideAddresses || []).map((a) => parseIp(String(a))).filter(Boolean);
  const sans = [...dns.map((d) => implicitPrimitive(2, Buffer.from(d, 'ascii'))), ...ips.map((ip) => implicitPrimitive(7, ipBytes(ip)))];
  if (sans.length === 0) throw new Error('certificate: a leaf needs a name or an address');
  const notBefore = now - 60 * 60 * 1000;
  const notAfter = now + days * DAY;
  const subjectCn = dns[0] || (ips[0] ? formatIp(ips[0]) : 'gateway');
  const tbs = seq(
    explicit(0, int(2)),
    int(serial()),
    algorithm(),
    issuerOf(root),
    seq(time(notBefore), time(notAfter)),
    name(subjectCn),
    spki,
    explicit(3, seq(
      extension(OID.basicConstraints, true, seq()),
      extension(OID.keyUsage, true, bitString(Buffer.from([0x80]), 7)), // digitalSignature
      extension(OID.extKeyUsage, false, seq(oid(OID.serverAuth))),
      extension(OID.subjectAltName, false, seq(...sans)),
      extension(OID.subjectKeyIdentifier, false, octets(keyId(spki))),
      extension(OID.authorityKeyIdentifier, false, seq(implicitPrimitive(0, keyId(rootSpki)))),
    )),
  );
  const certPem = pem(sign(tbs, rootKey));
  return {
    certPem,
    keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    notAfter,
    sans: { dns, ips: ips.map(formatIp) },
  };
}

/** The issuer Name of a leaf is the root's subject, byte for byte: read it from the root's DER. */
function issuerOf(rootX509) {
  // TBSCertificate ::= SEQUENCE { [0] version, serial, sigAlg, issuer, validity, subject, … }
  const der = rootX509.raw;
  const read = (buf, at) => {
    const tag = buf[at];
    let len = buf[at + 1];
    let hdr = 2;
    if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[at + 2 + i]; hdr = 2 + n; }
    return { tag, start: at, contentStart: at + hdr, end: at + hdr + len };
  };
  const cert = read(der, 0);
  const tbs = read(der, cert.contentStart);
  let at = tbs.contentStart;
  const items = [];
  while (at < tbs.end && items.length < 6) { const it = read(der, at); items.push(it); at = it.end; }
  const subject = items[5]; // version, serial, sigAlg, issuer, validity, subject
  return Buffer.from(der.subarray(subject.start, subject.end));
}

/** What the gateway needs to know about a certificate it holds or was given. */
export function certInfo(certPem) {
  const x = new crypto.X509Certificate(certPem);
  return {
    subject: x.subject,
    issuer: x.issuer,
    ca: x.ca,
    notBefore: Date.parse(x.validFrom),
    notAfter: Date.parse(x.validTo),
    fingerprint: x.fingerprint256.replace(/:/g, '').toLowerCase(),
    subjectAltName: x.subjectAltName || '',
  };
}
