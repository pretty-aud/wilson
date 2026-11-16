// =============================================================================
// Streams (design §5 step 7; review round 2, R3; §10 row 13). A stream is one
// <video>'s life on one door, named by the jti of the ticket in its URL. Its
// AUTHORITY is that ticket's claims until a renewal re-anchors it to a fresh
// ticket's claims; the URL never changes, so every later Range request of the
// same element is checked against the stream's authority, not the URL's
// (expired) ticket.
//
// A renewal binds, or it is 401 (R3's five bindings):
//   1  the fresh ticket's clip is the URL's id (and the stream's clip);
//   2  its sub is the stream's original viewer;
//   3  its gw is this gateway (checkTicketScope);
//   4  on the outside door its rv is true;
//   5  the jti names a LIVE stream of that viewer for that clip on this door.
// A stream lives at most four hours in all (AS-3.8's re-authentication bound),
// then the player opens it afresh. Every distinct source address a stream is
// read from is recorded (at most four kept); more than one marks it shared.
// =============================================================================

import { SKEW_S } from '../wire/ticket.mjs';

export const MAX_SOURCES = 4;

export class Streams {
  constructor({ now = Date.now, maxAgeMs = 4 * 60 * 60 * 1000 } = {}) {
    this.now = now;
    this.maxAgeMs = maxAgeMs;
    this.map = new Map();
  }

  #key(door, jti) { return `${door}:${jti}`; }

  /** Alive: within four hours of its start and within its authority's life (30 s of skew). */
  isLive(s) {
    const t = this.now();
    return t - s.startedAt < this.maxAgeMs && Math.floor(t / 1000) - SKEW_S < s.authority.exp;
  }

  get(door, jti) {
    const k = this.#key(door, jti);
    const s = this.map.get(k);
    if (!s) return null;
    if (!this.isLive(s)) { this.map.delete(k); return null; }
    return s;
  }

  /** The stream named by a URL ticket, made on its first use. */
  open(door, claims) {
    const existing = this.get(door, claims.jti);
    if (existing) return existing;
    const s = { door, jti: claims.jti, clip: claims.clip, sub: claims.sub, startedAt: this.now(), authority: claims, sources: [], sourceCount: 0, shared: false, renewals: 0 };
    this.map.set(this.#key(door, claims.jti), s);
    return s;
  }

  /** Records a source address; answers whether the stream is now read from more than one. */
  addSource(s, address) {
    const a = String(address || '');
    if (!s.sources.includes(a)) {
      s.sourceCount += 1;
      if (s.sources.length < MAX_SOURCES) s.sources.push(a);
      if (s.sourceCount > 1) s.shared = true;
    }
    return s.shared;
  }

  /**
   * The five bindings; on success the stream's authority is the fresh claims.
   * `fresh` has already passed the signature and checkTicketScope.
   * @returns {{ ok: true, stream } | { ok: false, reason: string }}
   */
  renew({ door, jti, urlClip, fresh }) {
    const s = this.get(door, jti);
    if (!s) return { ok: false, reason: 'no_live_stream' };
    if (fresh.clip !== urlClip || s.clip !== urlClip) return { ok: false, reason: 'clip' };
    if (fresh.sub !== s.sub) return { ok: false, reason: 'viewer' };
    if (door === 'outside' && fresh.rv !== true) return { ok: false, reason: 'rv' };
    s.authority = fresh;
    s.renewals += 1;
    return { ok: true, stream: s };
  }

  /** Every stream of a door ends (the outside door closed). */
  dropDoor(door) {
    for (const [k, s] of this.map) if (s.door === door) this.map.delete(k);
  }

  sweep() {
    for (const [k, s] of this.map) if (!this.isLive(s)) this.map.delete(k);
  }

  get size() { return this.map.size; }
}
