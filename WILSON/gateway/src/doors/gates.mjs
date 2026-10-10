// =============================================================================
// The `connection`-event gates, run before TLS (server.mjs calls them).
//
//   inside   the address rule (peers.mjs: loopback, own addresses, co-located
//            bridges, public peers closed; the office admitted), then the
//            inside door's per-peer limits (120 new connections a minute, 40
//            handshakes a second) and the global pool. Refusals are counted
//            by reason; public ones feed the health line's red line.
//   outside  the outside door's per-peer limits (60 a minute, 20 a second)
//            and its three quarters of the pool. No address rule: every
//            connection on the outside door is outside.
//
// There is no switch, setting or environment variable that admits loopback
// or an own address on the inside door: the address rule is not optional
// (the brief: a release build may carry no flag that admits them).
// =============================================================================

import { classifyInsidePeer } from '../rules/peers.mjs';
import { normalizeIp, outsidePeerKey } from '../rules/ip.mjs';

export function makeCounters() {
  return { loopback: 0, own_address: 0, co_located: 0, public: 0, unparseable: 0, rate: 0, pool: 0, sinceSync: { public: 0 } };
}

/**
 * @param p {{ peers: () => ({ ownAddresses, coLocatedNets, officeRanges }), limiters, pools, counters }}
 */
export function makeInsideGate({ peers, limiters, pools, counters }) {
  return (socket) => {
    const peer = socket.remoteAddress;
    const v = classifyInsidePeer(peer, peers());
    if (!v.admit) {
      counters[v.reason] = (counters[v.reason] || 0) + 1;
      if (v.reason === 'public') counters.sinceSync.public += 1;
      return { admit: false, reason: v.reason };
    }
    const key = normalizeIp(peer) || String(peer);
    if (!limiters.connections.hit(key).ok || !limiters.handshakes.hit(key).ok) { counters.rate += 1; return { admit: false, reason: 'rate' }; }
    if (!pools.openConnection('inside')) { counters.pool += 1; return { admit: false, reason: 'pool' }; }
    return { admit: true, release: () => pools.closeConnection('inside') };
  };
}

export function makeOutsideGate({ limiters, pools, counters }) {
  return (socket) => {
    const key = outsidePeerKey(socket.remoteAddress);
    if (!limiters.connections.hit(key).ok || !limiters.handshakes.hit(key).ok) { counters.rate += 1; return { admit: false, reason: 'rate' }; }
    if (!pools.openConnection('outside')) { counters.pool += 1; return { admit: false, reason: 'pool' }; }
    return { admit: true, release: () => pools.closeConnection('outside') };
  };
}
