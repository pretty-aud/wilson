// =============================================================================
// The doors' shared context: the limiters, the streams, the viewings, the
// source address of a request, the relay watch. Built once by the runtime
// (runtime.mjs) and by the tests' harness from the same function, so the
// tests exercise the wiring the gateway runs.
// =============================================================================

import { FixedWindow, Concurrency, Pools } from '../rules/limits.mjs';
import { outsideSource } from '../rules/peers.mjs';
import { userAgentFamily } from '../rules/useragent.mjs';
import { normalizeIp } from '../rules/ip.mjs';
import { Streams } from './streams.mjs';
import { Viewings } from './viewings.mjs';
import { defaultFs } from './clips.mjs';

const DAY = 86_400_000;
export const RELAY_VIEWERS = 6;

/**
 * The relay signal (§4, §10 row 22): many different viewers' tickets arriving
 * on the inside door from ONE LAN address in a day. Bounded: at most 1,000
 * addresses and 64 viewers per address are remembered.
 */
export class RelayWatch {
  constructor({ now = Date.now, threshold = RELAY_VIEWERS } = {}) {
    this.now = now;
    this.threshold = threshold;
    this.day = Math.floor(now() / DAY);
    this.byPeer = new Map();
  }
  see(peer, sub) {
    const d = Math.floor(this.now() / DAY);
    if (d !== this.day) { this.day = d; this.byPeer.clear(); }
    const a = normalizeIp(peer) || String(peer);
    let set = this.byPeer.get(a);
    if (!set) { if (this.byPeer.size >= 1000) return; set = new Set(); this.byPeer.set(a, set); }
    if (set.size < 64) set.add(sub);
  }
  /** The address with the most distinct viewers today, when it reaches the threshold. */
  worst() {
    let best = null;
    for (const [address, set] of this.byPeer) if (set.size >= this.threshold && (!best || set.size > best.viewers)) best = { address, viewers: set.size };
    return best;
  }
}

/**
 * @param d {{ ids, keyFor, syncForUnknownKid, location, catalogue, journal, now, log, limits,
 *             origins, host, health, healthLine, fingerprint, reachNonce, version, declaredProxy,
 *             locationSlow, onViewingEnded, fs? }}
 */
export function makeDoorContext(d) {
  const now = d.now || Date.now;
  const L = d.limits;
  const streams = new Streams({ now, maxAgeMs: L.streamMaxMs });
  const viewings = new Viewings({ journal: d.journal, now, onEnded: d.onViewingEnded || (() => {}) });
  const relay = new RelayWatch({ now });
  return {
    ...d,
    now,
    limits: L,
    fs: d.fs || defaultFs,
    streams,
    viewings,
    relay,
    perPersonRequests: new FixedWindow({ limit: L.perPersonRequestsPerMinute, windowMs: 60_000, now }),
    perPersonStreams: new Concurrency({ limit: L.perPersonStreams }),
    outsideBytes: new FixedWindow({ limit: L.outsideBytesPerHourPerPerson, windowMs: 3_600_000, now }),
    pools: new Pools({ connections: L.connections, streams: L.streams, insideReserve: L.insideReserve }),
    sourceOf(req, door) {
      if (door === 'inside') return { address: normalizeIp(req.socket.remoteAddress) || String(req.socket.remoteAddress), via: 'inside' };
      return outsideSource({ peer: req.socket.remoteAddress, headers: req.headers, declaredProxy: d.declaredProxy ? d.declaredProxy() : null });
    },
    relayWatch(peer, sub) { relay.see(peer, sub); },
    userAgent(req) { return userAgentFamily(req.headers['user-agent']); },
    locationSlow: d.locationSlow || (() => {}),
  };
}
