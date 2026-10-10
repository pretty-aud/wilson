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
  outside: Object.freeze({ newConnectionsPerMinutePerPeer: 60, handshakesPerSecondPerPeer: 20 }),
  inside: Object.freeze({ newConnectionsPerMinutePerPeer: 120, handshakesPerSecondPerPeer: 40 }),
  connections: 400,
  streams: 200,
  insideReserve: 0.25,
  headerTimeoutMs: 10_000,
  handshakeTimeoutMs: 10_000,
  idleMs: 60_000,
  bodyBytes: 8 * 1024,
  streamMaxMs: 4 * 60 * 60 * 1000,
});

const POSITIVE_INT_KEYS = ['perPersonStreams', 'perPersonRequestsPerMinute', 'outsideBytesPerHourPerPerson', 'connections', 'streams', 'headerTimeoutMs', 'handshakeTimeoutMs', 'idleMs', 'bodyBytes', 'streamMaxMs'];

/**
 * The config's `limits` over the defaults. A value that is not a positive
 * integer is ignored (and reported); the timeouts, the body cap and the
 * stream life may be lowered but never raised past the design's bounds,
 * because they are security bounds, not capacity.
 */
export function resolveLimits(overrides = {}) {
  const out = JSON.parse(JSON.stringify(DEFAULT_LIMITS));
  const ignored = [];
  const o = overrides && typeof overrides === 'object' ? overrides : {};
  const CEILING = { headerTimeoutMs: 10_000, handshakeTimeoutMs: 10_000, idleMs: 60_000, bodyBytes: 8 * 1024, streamMaxMs: 4 * 60 * 60 * 1000 };
  for (const k of POSITIVE_INT_KEYS) {
    if (!(k in o)) continue;
    const v = o[k];
    if (!Number.isSafeInteger(v) || v <= 0) { ignored.push(k); continue; }
    out[k] = k in CEILING ? Math.min(v, CEILING[k]) : v;
  }
  for (const door of ['inside', 'outside']) {
    for (const k of ['newConnectionsPerMinutePerPeer', 'handshakesPerSecondPerPeer']) {
      const v = o?.[door]?.[k];
      if (v === undefined) continue;
      if (!Number.isSafeInteger(v) || v <= 0) { ignored.push(`${door}.${k}`); continue; }
      out[door][k] = v;
    }
  }
  if (o.insideReserve !== undefined) {
    if (typeof o.insideReserve === 'number' && o.insideReserve >= 0.1 && o.insideReserve <= 0.9) out.insideReserve = o.insideReserve;
    else ignored.push('insideReserve');
  }
  return { limits: out, ignored };
}

/** A fixed window per key: at most `limit` units per `windowMs`. */
export class FixedWindow {
  constructor({ limit, windowMs, now = Date.now }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.windows = new Map();
  }
  #window(key) {
    const t = this.now();
    let w = this.windows.get(key);
    if (!w || t >= w.start + this.windowMs) {
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

/** The per-door, per-peer connection limiters (new connections a minute, handshakes a second). */
export function peerLimiters(limits, now = Date.now) {
  const make = (door) => ({
    connections: new FixedWindow({ limit: limits[door].newConnectionsPerMinutePerPeer, windowMs: 60_000, now }),
    handshakes: new FixedWindow({ limit: limits[door].handshakesPerSecondPerPeer, windowMs: 1_000, now }),
  });
  return { inside: make('inside'), outside: make('outside') };
}
