// =============================================================================
// The catalogue check (design §5 step 6; review round 1, F2; review round 2,
// R11; D22). The gateway serves nothing the cloud does not confirm: the first
// time a clip is asked for, and again every ten minutes, it asks gateway-sync
// with `confirm: [{ clip, loc, path }]`, ON DEMAND (one round trip before the
// first byte, not the 10 s heartbeat), and the cloud answers from the
// database: the bin_files row exists, is this gateway's workspace's, and sits
// at that location and path. So the gateway's own boundary is "a catalogued
// clip of this company at the path the cloud holds", not "a file under a
// location root", which is what limits a forged ticket (a stolen signing key)
// to catalogued clips (§10 row 21).
//
// While the cloud is unreachable, a clip confirmed within the last 24 hours
// keeps playing INSIDE (the inside door must not die with the cloud); the
// outside door gets no grace (it closes after 60 s without the cloud anyway);
// a never-confirmed clip answers 404 with the sentence below on the inside
// door and with no body outside.
//
// Requests arriving together are confirmed together: at most 100 per call
// (Appendix C), one call per batch.
// =============================================================================

export const CONFIRM_TTL_MS = 10 * 60_000;
export const INSIDE_GRACE_MS = 24 * 60 * 60_000;
export const MAX_CONFIRM = 100;
export const NEVER_CONFIRMED_SENTENCE = 'WILSON’s cloud is unreachable, so this clip cannot be confirmed yet';

export class Catalogue {
  /**
   * @param {{ now?: () => number, confirm: (items: Array<{clip,loc,path}>) => Promise<{ reached: boolean, confirmed?: Iterable<string> }> }} o
   */
  constructor({ now = Date.now, confirm }) {
    this.now = now;
    this.confirm = confirm;
    this.cache = new Map(); // `${clip}|${loc}|${path}` → confirmedAt
    this.queue = [];
    this.scheduled = false;
  }

  #key({ clip, loc, path }) { return `${clip}|${loc}|${path}`; }

  /** Forget every confirmation (a 401 on sync: this gateway is not trusted any more). */
  clear() { this.cache.clear(); }

  /**
   * @returns {Promise<{ ok: true, via: 'cache'|'cloud'|'grace' } | { ok: false, reason: 'not_confirmed'|'cloud_unreachable' }>}
   */
  async check({ clip, loc, path, door }) {
    const k = this.#key({ clip, loc, path });
    const at = this.cache.get(k);
    const t = this.now();
    if (at !== undefined && t - at < CONFIRM_TTL_MS) return { ok: true, via: 'cache' };
    const answer = await new Promise((resolve) => {
      this.queue.push({ item: { clip, loc, path }, resolve });
      if (!this.scheduled) { this.scheduled = true; setImmediate(() => this.#flush()); }
    });
    if (answer.reached) {
      if (answer.confirmed) { this.cache.set(k, this.now()); return { ok: true, via: 'cloud' }; }
      this.cache.delete(k); // removed from the catalogue, or moved
      return { ok: false, reason: 'not_confirmed' };
    }
    if (door === 'inside' && at !== undefined && t - at < INSIDE_GRACE_MS) return { ok: true, via: 'grace' };
    return { ok: false, reason: 'cloud_unreachable' };
  }

  async #flush() {
    this.scheduled = false;
    while (this.queue.length) {
      const batch = this.queue.splice(0, MAX_CONFIRM);
      // One clip once per call: the answer names clips, not paths.
      const byClip = new Map();
      for (const q of batch) byClip.set(q.item.clip, q.item);
      let result;
      try {
        result = await this.confirm([...byClip.values()]);
      } catch {
        result = { reached: false };
      }
      const confirmed = new Set(result?.reached ? (result.confirmed || []) : []);
      for (const q of batch) {
        const sameItem = byClip.get(q.item.clip);
        const ok = confirmed.has(q.item.clip) && sameItem.loc === q.item.loc && sameItem.path === q.item.path;
        q.resolve({ reached: !!result?.reached, confirmed: ok });
      }
    }
  }
}
