// =============================================================================
// The limits (design §5 "Rate limits", D12; review round 1, F11). Pure, with
// an injected clock. Per gateway, in its config, with these defaults:
//
//   per person (the ticket's sub)   8 concurrent streams, 600 requests a minute
//   outside, per person             30 GB an hour (a 50 Mb/s clip played
//                                   continuously is 22 GB an hour)
//   outside, per peer address       60 new connections a minute, 20 TLS
//                                   handshakes a second
//   inside, per peer address        120 new connections a minute, 40 TLS
//                                   handshakes a second
//   in all                          400 open connections and 200 open streams,
//                                   a quarter of each reserved for the inside
//                                   door (the outside door may hold at most
//                                   three quarters), so the outside door
//                                   cannot starve the office
//   timeouts                        header 10 s, handshake 10 s, 60 s without
//                                   a read closes a stream, 4 h per stream
//   bodies                          at most 8 KB (only renew has one)
//
// Over a limit: 429 with Retry-After where HTTP can still answer; a
// connection over its limits is closed on the `connection` event, before TLS.
// =============================================================================

export const DEFAULT_LIMITS = Object.freeze({
  perPersonStreams: 8,
  perPersonRequestsPerMinute: 600,
  outsideBytesPerHourPerPerson: 30e9,
  // connectionsPerPeer caps the connections ONE peer address may hold OPEN at
  // once, not the rate it opens them (GW5, finding 1): the per-minute and
  // per-second caps above bound the RATE, but a peer that opens at its rate and
  // keeps each connection alive (a cheap request every idle window) accumulates
  // without bound up to the global pool, so one outside address could fill the
  // whole outside pool and one LAN host the whole global pool — starving every
  // other viewer and the office, which §10 row 10 and F11 say cannot happen.
  // The reserve below protects the inside door from the outside door; it does
  // nothing for one inside host against other inside hosts. This cap does. It
  // must SUBDIVIDE a door's share, never equal it (GW5 review round 1, finding
  // A): the outside door's hard max is connections × (1 − insideReserve) = 300,
  // so 100 is a third of it; the inside door's GUARANTEED share is the reserve,
  // connections × insideReserve = 100, so the cap is 32, under a third of it —
  // one inside host cannot eat the whole reserve while the outside door is full
  // (round 1 found 100 == the reserve, so one host still starved the office).
  // resolveLimits caps the value at a third of the resolved share for EVERY
  // config (so a smaller `connections` cannot re-open the starvation, and a
  // config value can never silently disable the cap — review round 2, A/D). A
  // NAT'd remote office is one outside key (R2-5's tension), so the outside cap
  // is generous: 100 is ~16 viewers.
  outside: Object.freeze({ newConnectionsPerMinutePerPeer: 60, handshakesPerSecondPerPeer: 20, connectionsPerPeer: 100 }),
  inside: Object.freeze({ newConnectionsPerMinutePerPeer: 120, handshakesPerSecondPerPeer: 40, connectionsPerPeer: 32 }),
  connections: 400,
  streams: 200,
  insideReserve: 0.25,
  headerTimeoutMs: 10_000,
  handshakeTimeoutMs: 10_000,
  idleMs: 60_000,
  bodyBytes: 8 * 1024,
  streamMaxMs: 4 * 60 * 60 * 1000,
  // Review round 1, finding 2: the caps on connections and handshakes did not
  // bound the requests ONE kept-alive connection may send, and every forged
  // ticket costs a signature check on the one thread. A connection whose
  // tickets fail this many times is closed after the last answer, so more
  // tries cost a new connection, which the per-peer caps count; and a
  // connection serves at most this many requests. (Review round 2, R2-5: a
  // per-PEER budget answered 429 to everyone behind one address, a remote
  // office's NAT, for a minute; per connection, nobody else pays.)
  authFailuresPerConnection: 10,
  requestsPerConnection: 1000,
});

const POSITIVE_INT_KEYS = ['perPersonStreams', 'perPersonRequestsPerMinute', 'outsideBytesPerHourPerPerson', 'connections', 'streams', 'headerTimeoutMs', 'handshakeTimeoutMs', 'idleMs', 'bodyBytes', 'streamMaxMs', 'authFailuresPerConnection', 'requestsPerConnection'];

// The design's bounds, which config.json may lower but never raise past.
const CEILING = { headerTimeoutMs: 10_000, handshakeTimeoutMs: 10_000, idleMs: 60_000, bodyBytes: 8 * 1024, streamMaxMs: 4 * 60 * 60 * 1000, authFailuresPerConnection: 100, requestsPerConnection: 10_000 };
// And, for config.json (`floors: true`), the floors under them (review round
// 2, R2-2: `"connections": 1` there would have shut the gateway's own doors);
// the tests call without them to exercise a limit in a few requests. A
// renewal's body must hold a 4096-character ticket.
const FLOOR = { perPersonStreams: 1, perPersonRequestsPerMinute: 60, outsideBytesPerHourPerPerson: 1e9, connections: 16, streams: 8, headerTimeoutMs: 1_000, handshakeTimeoutMs: 1_000, idleMs: 1_000, bodyBytes: 6 * 1024, streamMaxMs: 60_000, authFailuresPerConnection: 1, requestsPerConnection: 10 };
const DOOR_FLOOR = { newConnectionsPerMinutePerPeer: 4, handshakesPerSecondPerPeer: 1, connectionsPerPeer: 8 };

/**
 * The config's `limits` over the defaults. A value that is not a positive
 * integer is ignored (and reported); the timeouts, the body cap and the
 * stream life may be lowered but never raised past the design's bounds,
 * because they are security bounds, not capacity.
 */
export function resolveLimits(overrides = {}, { floors = false } = {}) {
  const out = JSON.parse(JSON.stringify(DEFAULT_LIMITS));
  const ignored = [];
  const o = overrides && typeof overrides === 'object' ? overrides : {};
  for (const k of POSITIVE_INT_KEYS) {
    if (!(k in o)) continue;
    const v = o[k];
    if (!Number.isSafeInteger(v) || v <= 0) { ignored.push(k); continue; }
    if (floors && v < FLOOR[k]) { ignored.push(`${k} (at least ${FLOOR[k]})`); continue; }
    out[k] = k in CEILING ? Math.min(v, CEILING[k]) : v;
  }
  // insideReserve is resolved before the door loop so a door's hard pool share
  // (which clamps connectionsPerPeer below) is computed from the final value.
  if (o.insideReserve !== undefined) {
    if (typeof o.insideReserve === 'number' && o.insideReserve >= 0.1 && o.insideReserve <= 0.9) out.insideReserve = o.insideReserve;
    else ignored.push('insideReserve');
  }
  for (const door of ['inside', 'outside']) {
    for (const k of ['newConnectionsPerMinutePerPeer', 'handshakesPerSecondPerPeer', 'connectionsPerPeer']) {
      const v = o?.[door]?.[k];
      if (v === undefined) continue;
      if (!Number.isSafeInteger(v) || v <= 0) { ignored.push(`${door}.${k}`); continue; }
      if (floors && v < DOOR_FLOOR[k]) { ignored.push(`${door}.${k} (at least ${DOOR_FLOOR[k]})`); continue; }
      out[door][k] = v;
    }
  }
  // connectionsPerPeer must SUBDIVIDE a door's guaranteed share for EVERY config,
  // not only the defaults (GW5 review round 2, findings A and D): round 1 fixed
  // the default (inside 32 < the reserve 100) but hardcoded it, so a smaller
  // `connections` (or a lower insideReserve) made the cap equal or exceed the
  // reserve again, re-opening the finding-A starvation; and round 1's clamp
  // clamped only to the whole door share, which is "no cap". Each door's cap is
  // now capped at a third of its guaranteed share — the inside door's is the
  // reserve (connections × insideReserve), the outside door's is its hard max
  // (connections × (1 − insideReserve)) — floored at DOOR_FLOOR. The default
  // (32 inside, 100 outside) is below these at the default pool, so it is kept
  // there and auto-tightens for a smaller pool; an explicit config value above
  // the ceiling is clamped and reported.
  const share = { inside: Math.floor(out.connections * out.insideReserve), outside: Math.floor(out.connections * (1 - out.insideReserve)) };
  for (const door of ['inside', 'outside']) {
    const ceiling = Math.max(DOOR_FLOOR.connectionsPerPeer, Math.floor(share[door] / 3));
    if (out[door].connectionsPerPeer > ceiling) {
      if (o?.[door]?.connectionsPerPeer !== undefined) ignored.push(`${door}.connectionsPerPeer (at most ${ceiling}, a third of the ${door === 'inside' ? 'inside reserve' : 'outside share'})`);
      out[door].connectionsPerPeer = ceiling;
    }
  }
  return { limits: out, ignored };
}

/** A fixed window per key: at most `limit` units per `windowMs`. */
export class FixedWindow {
  constructor({ limit, windowMs, now = Date.now, maxKeys = 50_000 }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.maxKeys = maxKeys;
    this.windows = new Map();
  }
  #window(key) {
    const t = this.now();
    let w = this.windows.get(key);
    if (!w || t >= w.start + this.windowMs) {
      // A flood of new keys (one per address) prunes the spent windows itself
      // instead of waiting for the runtime's sweep (review round 2, R2-N3).
      if (!w && this.windows.size >= this.maxKeys) this.prune();
      w = { start: t, used: 0 };
      this.windows.set(key, w);
    }
    return w;
  }
  /** Spend `cost` units if they fit; refused spends nothing. */
  hit(key, cost = 1) {
    const w = this.#window(key);
    if (w.used + cost > this.limit) return { ok: false, retryAfterS: Math.max(1, Math.ceil((w.start + this.windowMs - this.now()) / 1000)) };
    w.used += cost;
    return { ok: true, retryAfterS: 0 };
  }
  /** Spend `cost` whatever the limit (bytes already sent); answers whether the window is now over. */
  spend(key, cost) {
    const w = this.#window(key);
    w.used += cost;
    return w.used > this.limit;
  }
  remaining(key) {
    const w = this.#window(key);
    return Math.max(0, this.limit - w.used);
  }
  retryAfterS(key) {
    const w = this.#window(key);
    return Math.max(1, Math.ceil((w.start + this.windowMs - this.now()) / 1000));
  }
  prune() {
    const t = this.now();
    for (const [k, w] of this.windows) if (t >= w.start + this.windowMs) this.windows.delete(k);
  }
  get size() { return this.windows.size; }
}

/** Concurrency per key: acquire answers a release function, or null at the limit. */
export class Concurrency {
  constructor({ limit }) {
    this.limit = limit;
    this.counts = new Map();
  }
  acquire(key) {
    const n = this.counts.get(key) || 0;
    if (n >= this.limit) return null;
    this.counts.set(key, n + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const m = (this.counts.get(key) || 1) - 1;
      if (m <= 0) this.counts.delete(key); else this.counts.set(key, m);
    };
  }
  count(key) { return this.counts.get(key) || 0; }
}

/**
 * The global pools with the inside door's reserve: in all at most `total`;
 * the outside door at most total × (1 − reserve).
 */
export class Pools {
  constructor({ connections, streams, insideReserve }) {
    this.max = { connections, streams };
    this.outsideMax = {
      connections: Math.floor(connections * (1 - insideReserve)),
      streams: Math.floor(streams * (1 - insideReserve)),
    };
    this.used = { connections: { inside: 0, outside: 0 }, streams: { inside: 0, outside: 0 } };
  }
  #open(kind, door) {
    const u = this.used[kind];
    if (u.inside + u.outside >= this.max[kind]) return false;
    if (door === 'outside' && u.outside >= this.outsideMax[kind]) return false;
    u[door]++;
    return true;
  }
  #close(kind, door) {
    const u = this.used[kind];
    if (u[door] > 0) u[door]--;
  }
  openConnection(door) { return this.#open('connections', door); }
  closeConnection(door) { this.#close('connections', door); }
  openStream(door) { return this.#open('streams', door); }
  closeStream(door) { this.#close('streams', door); }
  snapshot() { return JSON.parse(JSON.stringify(this.used)); }
}

/**
 * The per-door, per-peer limiters: the rate of new connections a minute and
 * handshakes a second, AND `concurrency`, the connections one peer may hold
 * open at once (GW5, finding 1; released by the door on socket close). A
 * limits object hand-built without `connectionsPerPeer` (some tests) falls
 * back to the default cap rather than leaving a peer uncapped.
 */
export function peerLimiters(limits, now = Date.now) {
  const make = (door) => ({
    connections: new FixedWindow({ limit: limits[door].newConnectionsPerMinutePerPeer, windowMs: 60_000, now }),
    handshakes: new FixedWindow({ limit: limits[door].handshakesPerSecondPerPeer, windowMs: 1_000, now }),
    concurrency: new Concurrency({ limit: limits[door].connectionsPerPeer ?? DEFAULT_LIMITS[door].connectionsPerPeer }),
  });
  return { inside: make('inside'), outside: make('outside') };
}
