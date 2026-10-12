// =============================================================================
// Viewings: what is written down (G6, D7; design §6). Only reads through the
// OUTSIDE door; the inside door writes nothing.
//
// One row per viewing: one person, one clip, one gateway, the outside door.
// It starts at the first byte served and ends after 60 s without a request,
// or at five minutes of activity, after which a new row starts (a long play
// writes a row every five minutes; a scrub writes one). Counts and two
// offsets, never a list of ranges (F10): bytes served, the clip's size, the
// fraction of the clip covered (read in full at 0.9), the number of range
// requests, the first and the last offset, every distinct source address (at
// most four), shared_url, via, the user agent's family, the stream's first
// jti. A line goes to the journal at the start and at the end (journal.mjs).
// =============================================================================

import crypto from 'node:crypto';

export const IDLE_MS = 60_000;
export const MAX_ROW_MS = 5 * 60_000;
const MAX_INTERVALS = 512;
const MAX_SOURCES = 4;

/** A bounded set of covered byte intervals [start, end) — merged, never more than MAX_INTERVALS. */
export class Coverage {
  constructor() { this.iv = []; }
  add(start, endExclusive) {
    if (!(endExclusive > start)) return;
    const out = [];
    let [s, e] = [start, endExclusive];
    let placed = false;
    for (const [a, b] of this.iv) {
      if (b < s) out.push([a, b]);
      else if (a > e) { if (!placed) { out.push([s, e]); placed = true; } out.push([a, b]); }
      else { s = Math.min(s, a); e = Math.max(e, b); }
    }
    if (!placed) out.push([s, e]);
    while (out.length > MAX_INTERVALS) {
      // Merge the two neighbours with the smallest gap: an over-estimate, bounded.
      let best = 0;
      for (let i = 1; i < out.length - 1; i++) if (out[i + 1][0] - out[i][1] < out[best + 1][0] - out[best][1]) best = i;
      out.splice(best, 2, [out[best][0], out[best + 1][1]]);
    }
    this.iv = out;
  }
  get bytes() { return this.iv.reduce((n, [a, b]) => n + (b - a), 0); }
}

export class Viewings {
  /**
   * @param {{ journal: { start(row), end(row) }, now?: () => number, onEnded?: (row) => void, idleMs?: number, maxRowMs?: number }} o
   */
  constructor({ journal, now = Date.now, onEnded = () => {}, idleMs = IDLE_MS, maxRowMs = MAX_ROW_MS }) {
    this.journal = journal;
    this.now = now;
    this.onEnded = onEnded;
    this.idleMs = idleMs;
    this.maxRowMs = maxRowMs;
    this.open = new Map(); // `${sub}:${clip}` → viewing
  }

  #iso(t) { return new Date(t).toISOString(); }

  /**
   * The first byte of a response is about to be served for (sub, clip) on the
   * outside door: the viewing it belongs to, started if need be.
   */
  begin({ sub, clip, jti, clipBytes, source, via, userAgent, shared }) {
    const key = `${sub}:${clip}`;
    const t = this.now();
    let v = this.open.get(key);
    if (v && (t - v.lastAt >= this.idleMs || t - v.startedAt >= this.maxRowMs)) {
      this.#end(v);
      v = null;
    }
    if (!v) {
      v = {
        key, viewing_id: crypto.randomUUID(), clip, sub, ticket_jti: jti, startedAt: t, lastAt: t,
        clip_bytes: clipBytes, bytes: 0, range_count: 0, first_offset: null, last_offset: null,
        coverage: new Coverage(), sources: [], shared: false, via, user_agent: userAgent,
      };
      this.open.set(key, v);
      this.journal.start({
        viewing_id: v.viewing_id, clip, sub, started_at: this.#iso(t), clip_bytes: clipBytes,
        source_address: source, via, user_agent: userAgent, ticket_jti: jti,
      });
    }
    v.lastAt = t;
    v.range_count += 1;
    if (!v.sources.includes(source) && v.sources.length < MAX_SOURCES) v.sources.push(source);
    if (v.sources.length > 1 || shared) v.shared = true;
    return v;
  }

  /** Bytes actually handed to the socket for one response, from `start`. */
  served(v, { start, bytes }) {
    if (!(bytes > 0)) return;
    const t = this.now();
    v.lastAt = t;
    v.bytes += bytes;
    if (v.first_offset === null) v.first_offset = start;
    v.last_offset = start + bytes - 1;
    v.coverage.add(start, start + bytes);
  }

  rowOf(v, { incomplete = false, endedAt = this.now() } = {}) {
    const fraction = v.clip_bytes > 0 ? Math.min(1, v.coverage.bytes / v.clip_bytes) : 0;
    return {
      viewing_id: v.viewing_id,
      clip: v.clip,
      sub: v.sub,
      started_at: this.#iso(v.startedAt),
      ended_at: incomplete ? null : this.#iso(endedAt),
      bytes: v.bytes,
      clip_bytes: v.clip_bytes,
      fraction: Math.round(fraction * 1000) / 1000,
      read_in_full: fraction >= 0.9,
      range_count: v.range_count,
      first_offset: v.first_offset,
      last_offset: v.last_offset,
      source_address: v.sources[0] ?? null,
      source_addresses: [...v.sources],
      shared_url: v.shared,
      via: v.via,
      user_agent: v.user_agent,
      ticket_jti: v.ticket_jti,
      incomplete,
    };
  }

  #end(v) {
    this.open.delete(v.key);
    const row = this.rowOf(v, { endedAt: Math.max(v.lastAt, v.startedAt) });
    this.journal.end(row);
    this.onEnded(row);
    return row;
  }

  /** Ends every viewing idle for 60 s or older than five minutes. Called every few seconds. */
  tick() {
    const t = this.now();
    const ended = [];
    for (const v of [...this.open.values()]) if (t - v.lastAt >= this.idleMs || t - v.startedAt >= this.maxRowMs) ended.push(this.#end(v));
    return ended;
  }

  /** The outside door closed or the gateway is stopping: every open viewing ends now. */
  endAll() {
    return [...this.open.values()].map((v) => this.#end(v));
  }
}
