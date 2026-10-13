// =============================================================================
// Addresses: parse, classify, contain. Pure, no I/O.
//
// Every address the gateway reasons about (a TCP peer, an interface, an
// office range, a forwarded header) goes through parseIp, which accepts only
// what node:net calls an IP (no leading zeros, so no octal ambiguity), drops
// an IPv6 zone id, and folds an IPv4-mapped IPv6 address (::ffff:a.b.c.d, how
// a dual-stack socket reports an IPv4 peer) to the IPv4 address it is.
// =============================================================================

import net from 'node:net';

/** @returns {{ family: 4|6, bytes: Uint8Array } | null} */
export function parseIp(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const pct = s.indexOf('%');
  if (pct >= 0) s = s.slice(0, pct);
  const fam = net.isIP(s);
  if (fam === 4) return { family: 4, bytes: Uint8Array.from(s.split('.').map(Number)) };
  if (fam !== 6) return null;
  const bytes = parseV6(s);
  if (!bytes) return null;
  const mapped = bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  return mapped ? { family: 4, bytes: bytes.slice(12) } : { family: 6, bytes };
}

function parseV6(s) {
  let head = s;
  let tail4 = null;
  const lastColon = s.lastIndexOf(':');
  const lastPart = s.slice(lastColon + 1);
  if (lastPart.includes('.')) {
    tail4 = lastPart.split('.').map(Number);
    head = s.slice(0, lastColon + 1) + '0:0';
  }
  let groups;
  const dbl = head.indexOf('::');
  if (dbl >= 0) {
    const left = head.slice(0, dbl);
    const right = head.slice(dbl + 2);
    const L = left ? left.split(':') : [];
    const R = right ? right.split(':') : [];
    const fill = 8 - L.length - R.length;
    if (fill < 0) return null;
    groups = [...L, ...Array(fill).fill('0'), ...R];
  } else {
    groups = head.split(':');
  }
  if (groups.length !== 8) return null;
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const v = parseInt(groups[i], 16);
    if (!Number.isInteger(v) || v < 0 || v > 0xffff) return null;
    bytes[2 * i] = v >> 8;
    bytes[2 * i + 1] = v & 0xff;
  }
  if (tail4) bytes.set(tail4, 12);
  return bytes;
}

/** Canonical text: dotted IPv4; lower-case, zero-compressed IPv6. */
export function formatIp(ip) {
  if (!ip) return '';
  if (ip.family === 4) return Array.from(ip.bytes).join('.');
  const groups = [];
  for (let i = 0; i < 8; i++) groups.push((ip.bytes[2 * i] << 8) | ip.bytes[2 * i + 1]);
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) { i++; continue; }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen && j - i >= 2) { bestStart = i; bestLen = j - i; }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestStart < 0) return hex.join(':');
  const left = hex.slice(0, bestStart).join(':');
  const right = hex.slice(bestStart + bestLen).join(':');
  return `${left}::${right}`;
}

/** Normalised text of an address string, or null when it is not one. */
export function normalizeIp(s) {
  const ip = parseIp(s);
  return ip ? formatIp(ip) : null;
}

export function sameIp(a, b) {
  const x = typeof a === 'string' ? parseIp(a) : a;
  const y = typeof b === 'string' ? parseIp(b) : b;
  if (!x || !y || x.family !== y.family) return false;
  return x.bytes.every((v, i) => v === y.bytes[i]);
}

/** `a.b.c.d/n` or `x::/n` → { family, bytes (masked), prefix } | null. */
export function parseCidr(s) {
  if (typeof s !== 'string') return null;
  const slash = s.indexOf('/');
  if (slash < 0) return null;
  const ip = parseIp(s.slice(0, slash));
  const p = s.slice(slash + 1);
  if (!ip || !/^\d{1,3}$/.test(p)) return null;
  const prefix = Number(p);
  const max = ip.family === 4 ? 32 : 128;
  // An IPv4-mapped prefix was folded to IPv4 above; its prefix must be too.
  if (prefix > max) return null;
  return { family: ip.family, bytes: maskBytes(ip.bytes, prefix), prefix };
}

function maskBytes(bytes, prefix) {
  const out = Uint8Array.from(bytes);
  for (let i = 0; i < out.length; i++) {
    const bits = Math.max(0, Math.min(8, prefix - i * 8));
    out[i] &= bits === 0 ? 0 : (0xff << (8 - bits)) & 0xff;
  }
  return out;
}

export function cidrContains(cidr, ipIn) {
  const c = typeof cidr === 'string' ? parseCidr(cidr) : cidr;
  const ip = typeof ipIn === 'string' ? parseIp(ipIn) : ipIn;
  if (!c || !ip || c.family !== ip.family) return false;
  const masked = maskBytes(ip.bytes, c.prefix);
  return masked.every((v, i) => v === c.bytes[i]);
}

export function formatCidr(c) {
  return `${formatIp({ family: c.family, bytes: c.bytes })}/${c.prefix}`;
}

const V4 = {
  unspecified: ['0.0.0.0/8'],
  loopback: ['127.0.0.0/8'],
  private: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
  link_local: ['169.254.0.0/16'],
  cgnat: ['100.64.0.0/10'],
  multicast: ['224.0.0.0/4'],
  reserved: ['240.0.0.0/4', '192.0.0.0/24', '192.0.2.0/24', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24'],
};
const V6 = {
  unspecified: ['::/128'],
  loopback: ['::1/128'],
  ula: ['fc00::/7'],
  link_local: ['fe80::/10'],
  multicast: ['ff00::/8'],
  global: ['2000::/3'],
};
const compile = (table) => Object.entries(table).map(([cls, list]) => [cls, list.map(parseCidr)]);
const V4C = compile(V4);
const V6C = compile(V6);

/**
 * 'loopback' | 'private' | 'ula' | 'link_local' | 'cgnat' | 'multicast' |
 * 'unspecified' | 'reserved' | 'global' | null (not an address).
 * IPv4 outside every listed range is 'global'; IPv6 outside 2000::/3 and the
 * listed special ranges is 'reserved'.
 */
export function classifyIp(input) {
  const ip = typeof input === 'string' ? parseIp(input) : input;
  if (!ip) return null;
  const table = ip.family === 4 ? V4C : V6C;
  for (const [cls, cidrs] of table) if (cidrs.some((c) => cidrContains(c, ip))) return cls;
  return ip.family === 4 ? 'global' : 'reserved';
}

/** RFC 1918 or unique-local: an address an office network uses. */
export function isPrivateOrUla(input) {
  const cls = classifyIp(input);
  return cls === 'private' || cls === 'ula';
}

/** The /24 around an IPv4 address or the /64 around an IPv6 one (design §3, D26). */
/**
 * The key a per-peer limit counts by on the OUTSIDE door: an IPv4 address, or
 * an IPv6 address's /64 (one site's or one customer's prefix). Rotating
 * through the addresses of one /64 must not buy a fresh budget each time
 * (review round 2, R2-4). The office door counts by the full address: a LAN's
 * own /64 is every office computer.
 */
export function outsidePeerKey(address) {
  const ip = parseIp(String(address ?? ''));
  if (!ip) return String(address);
  return ip.family === 4 ? formatIp(ip) : formatCidr(surroundingNet(ip));
}

export function surroundingNet(input) {
  const ip = typeof input === 'string' ? parseIp(input) : input;
  if (!ip) return null;
  const prefix = ip.family === 4 ? 24 : 64;
  return { family: ip.family, bytes: maskBytes(ip.bytes, prefix), prefix };
}
