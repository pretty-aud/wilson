// =============================================================================
// Strict base64 for the wire (the brief's "The wire, fixed").
//
// Node's decoders are lenient: Buffer.from(s, 'base64url') skips characters it
// does not know and ignores stray low bits, so two different strings can
// decode to the same bytes. Everything the gateway accepts from the wire is
// decoded here and re-encoded, and a string that does not round-trip exactly
// is refused: one value, one spelling.
// =============================================================================

const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const B64STD_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** base64url without padding (Node's 'base64url' never pads). */
export function b64urlEncode(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

/** The bytes of a canonical, unpadded base64url string; null for anything else. */
export function b64urlDecodeStrict(s) {
  if (typeof s !== 'string' || s.length === 0 || !B64URL_RE.test(s)) return null;
  if (s.length % 4 === 1) return null; // no byte count encodes to this length
  const bytes = Buffer.from(s, 'base64url');
  return bytes.toString('base64url') === s ? bytes : null;
}

/** The bytes of a canonical, padded standard base64 string; null for anything else. */
export function b64StdDecodeStrict(s) {
  if (typeof s !== 'string' || s.length === 0 || s.length % 4 !== 0 || !B64STD_RE.test(s)) return null;
  const bytes = Buffer.from(s, 'base64');
  return bytes.toString('base64') === s ? bytes : null;
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, upper case, no padding (the enrolment token's alphabet). */
export function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of Buffer.from(bytes)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}
