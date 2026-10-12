// =============================================================================
// A minimal DER encoder: exactly what an X.509 v3 certificate with these
// extensions needs (x509.mjs), nothing more. Node can PARSE certificates
// (crypto.X509Certificate) but not make them, and the gateway takes no
// dependency: so the TBSCertificate is written here and signed with
// crypto.sign, and every certificate made is read back by Node's own parser
// and by OpenSSL's verifier in the tests.
// =============================================================================

function lengthBytes(n) {
  if (n < 0x80) return Buffer.from([n]);
  const out = [];
  let v = n;
  while (v > 0) { out.unshift(v & 0xff); v = Math.floor(v / 256); }
  return Buffer.from([0x80 | out.length, ...out]);
}

export function tlv(tag, content) {
  const c = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return Buffer.concat([Buffer.from([tag]), lengthBytes(c.length), c]);
}

export const seq = (...items) => tlv(0x30, Buffer.concat(items));
export const set = (...items) => tlv(0x31, Buffer.concat(items));
export const nul = () => Buffer.from([0x05, 0x00]);
export const bool = (b) => tlv(0x01, Buffer.from([b ? 0xff : 0x00]));
export const octets = (b) => tlv(0x04, b);
export const bitString = (b, unused = 0) => tlv(0x03, Buffer.concat([Buffer.from([unused]), b]));
export const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
export const ia5 = (s) => {
  if (!/^[\x00-\x7f]*$/.test(s)) throw new Error('der: IA5String must be ASCII');
  return tlv(0x16, Buffer.from(s, 'ascii'));
};
/** [n] EXPLICIT */
export const explicit = (n, inner) => tlv(0xa0 | n, inner);
/** [n] IMPLICIT over primitive content */
export const implicitPrimitive = (n, content) => tlv(0x80 | n, content);
/** [n] IMPLICIT over constructed content (e.g. a SEQUENCE's contents) */
export const implicitConstructed = (n, content) => tlv(0xa0 | n, content);

/** A non-negative INTEGER from a Buffer of big-endian magnitude or a small number. */
export function int(v) {
  let b = typeof v === 'number' ? Buffer.from(v.toString(16).padStart(2, '0').replace(/^(.(..)*)$/, '0$1'), 'hex') : Buffer.from(v);
  let i = 0;
  while (i < b.length - 1 && b[i] === 0 && (b[i + 1] & 0x80) === 0) i++;
  b = b.subarray(i);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}

export function oid(dotted) {
  const parts = dotted.split('.').map(Number);
  const out = [40 * parts[0] + parts[1]];
  for (const p of parts.slice(2)) {
    const bytes = [p & 0x7f];
    let v = Math.floor(p / 128);
    while (v > 0) { bytes.unshift(0x80 | (v & 0x7f)); v = Math.floor(v / 128); }
    out.push(...bytes);
  }
  return tlv(0x06, Buffer.from(out));
}

const two = (n) => String(n).padStart(2, '0');
/** UTCTime through 2049, GeneralizedTime from 2050 (RFC 5280 §4.1.2.5). */
export function time(date) {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const body = `${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}Z`;
  return y < 2050 ? tlv(0x17, Buffer.from(String(y).slice(2) + body, 'ascii')) : tlv(0x18, Buffer.from(String(y) + body, 'ascii'));
}
