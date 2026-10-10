// =============================================================================
// Who is asking: the door decides, then the TCP peer (design §4, §6, §10 rows
// 7, 22, 25). Pure; the doors feed it the socket's remoteAddress.
//
//   INSIDE door  a peer is admitted when it is private (RFC 1918), unique-
//                local (fc00::/7), link-local, or inside an admin-declared
//                office range (D21), AND it is not loopback, not one of this
//                host's own addresses, and not on a subnet of one of this
//                host's container or VM bridges. Everything else is closed on
//                the `connection` event, before TLS (§4), and counted.
//   OUTSIDE door every request is outside, whatever its address. The source
//                address written down is the peer's, except that when the
//                peer IS the declared proxy, the address it forwards
//                (CF-Connecting-IP, else X-Forwarded-For's last hop) is taken
//                and `via` names the proxy.
//
// The co-located-bridge arm is GW2's (2026-10-10), beyond the design's text:
// with the container on the host's network (D24), a SIBLING container on the
// NAS's Docker bridge, or a VM on the PC's Hyper-V switch, reaches the
// office door from 172.17.0.x / 172.2x.x.x, which is private and not one of
// the gateway's own addresses, so a raw TCP relay there would have been
// admitted as an office browser (§10 row 22's hole, on the same box).
// =============================================================================

import { parseIp, classifyIp, sameIp, cidrContains, parseCidr, formatCidr, normalizeIp } from './ip.mjs';

/** Headers a proxy, tunnel or relay adds; any of them on the inside door is 403 (§4). */
export const PROXY_HEADERS = Object.freeze([
  'x-forwarded-for', 'forwarded', 'x-real-ip', 'via', 'cf-connecting-ip',
  'true-client-ip', 'x-client-ip', 'x-cluster-client-ip', 'fastly-client-ip',
  'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'x-forwarded-server',
  'x-original-forwarded-for', 'forwarded-for', 'x-forwarded', 'x-proxyuser-ip', 'client-ip',
]);

/** True when any proxy header is present, even empty (Node lower-cases names). */
export function hasProxyHeader(headers) {
  if (!headers) return false;
  return PROXY_HEADERS.some((h) => Object.prototype.hasOwnProperty.call(headers, h));
}

/**
 * The inside door's rule, before TLS.
 * @returns {{ admit: true, cls: string } | { admit: false, reason: 'unparseable'|'loopback'|'own_address'|'co_located'|'public', cls: string|null }}
 */
export function classifyInsidePeer(peer, { ownAddresses = [], coLocatedNets = [], officeRanges = [] } = {}) {
  const ip = parseIp(peer);
  if (!ip) return { admit: false, reason: 'unparseable', cls: null };
  const cls = classifyIp(ip);
  if (cls === 'loopback' || cls === 'unspecified') return { admit: false, reason: 'loopback', cls };
  if (ownAddresses.some((a) => sameIp(a, ip))) return { admit: false, reason: 'own_address', cls };
  if (coLocatedNets.some((n) => cidrContains(n, ip))) return { admit: false, reason: 'co_located', cls };
  if (cls === 'private' || cls === 'ula' || cls === 'link_local') return { admit: true, cls };
  if (officeRanges.some((r) => cidrContains(r, ip))) return { admit: true, cls: 'office_range' };
  return { admit: false, reason: 'public', cls };
}

export const MAX_OFFICE_RANGES = 8;

/**
 * The admin's declared office ranges (D21): at most eight, each private
 * (RFC 1918, or unique-local for IPv6) and no wider than a /16 (IPv6: a /48).
 * Applied ones are echoed back at sync; refused ones carry their reason.
 */
export function validateOfficeRanges(list) {
  const applied = [];
  const refused = [];
  const input = Array.isArray(list) ? list : [];
  for (const raw of input) {
    if (applied.length >= MAX_OFFICE_RANGES) { refused.push({ range: String(raw).slice(0, 64), reason: 'more_than_eight' }); continue; }
    const c = parseCidr(typeof raw === 'string' ? raw.trim() : '');
    if (!c) { refused.push({ range: String(raw).slice(0, 64), reason: 'not_a_range' }); continue; }
    const cls = classifyIp({ family: c.family, bytes: c.bytes });
    if (c.family === 4 && (cls !== 'private' || c.prefix < 16)) { refused.push({ range: formatCidr(c), reason: cls !== 'private' ? 'not_private' : 'wider_than_16' }); continue; }
    if (c.family === 6 && (cls !== 'ula' || c.prefix < 48)) { refused.push({ range: formatCidr(c), reason: cls !== 'ula' ? 'not_private' : 'wider_than_48' }); continue; }
    applied.push(formatCidr(c));
  }
  return { applied, refused };
}

const firstValue = (v) => (Array.isArray(v) ? v[0] : v);

/** X-Forwarded-For's last hop (the address the proxy itself saw), or null. */
export function lastForwardedHop(xff) {
  const v = Array.isArray(xff) ? xff.join(',') : xff;
  if (typeof v !== 'string' || !v.trim()) return null;
  const hops = v.split(',').map((s) => s.trim()).filter(Boolean);
  return hops.length ? normalizeIp(hops[hops.length - 1]) : null;
}

/**
 * The source address an outside viewing records, and `via`.
 * declaredProxy: { addresses: [ip…], name } | null — the tunnel daemon or the
 * NAS's reverse proxy (behind_local_proxy: loopback, name 'local_proxy').
 */
export function outsideSource({ peer, headers = {}, declaredProxy = null }) {
  const peerText = normalizeIp(peer) || String(peer || '').slice(0, 64);
  const isProxy = !!declaredProxy && (declaredProxy.addresses || []).some((a) => sameIp(a, peer));
  if (!isProxy) return { address: peerText, via: 'direct' };
  const cf = firstValue(headers['cf-connecting-ip']);
  const fromCf = typeof cf === 'string' ? normalizeIp(cf) : null;
  const forwarded = fromCf || lastForwardedHop(headers['x-forwarded-for']);
  const name = String(declaredProxy.name || 'proxy').slice(0, 48);
  return forwarded ? { address: forwarded, via: name } : { address: peerText, via: `${name} (no forwarded address)` };
}
