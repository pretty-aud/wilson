// =============================================================================
// The sync loop (design §2, D15; Appendix C): every 10 s (the enrolment's
// sync_interval_s), AND at once when a clip needs confirming (the catalogue
// check's one round trip) or a ticket names an unknown kid (one extra sync).
// Calls never overlap: a request made while one is in flight rides the next,
// which starts as soon as the first returns. On-demand calls beyond the
// heartbeat are held to 25 a minute (the cloud allows 30), and at most 100
// clips are confirmed per call.
//
// The loop knows only "call, then hand the answer over": what the answer
// means (the switch, the keys, the locations…) is the runtime's.
// =============================================================================

import { FixedWindow } from '../rules/limits.mjs';
import { MAX_CONFIRM } from './catalogue.mjs';

export class SyncLoop {
  /**
   * @param {{ call: (body) => Promise<object>, report: () => object, onResult: (result, sent) => void,
   *           intervalMs: () => number, now?: () => number, onDemandPerMinute?: number }} o
   */
  constructor({ call, report, onResult, intervalMs, now = Date.now, onDemandPerMinute = 25 }) {
    this.call = call;
    this.report = report;
    this.onResult = onResult;
    this.intervalMs = intervalMs;
    this.now = now;
    this.onDemand = new FixedWindow({ limit: onDemandPerMinute, windowMs: 60_000, now });
    this.pendingConfirms = []; // { item, resolve }
    this.waiters = [];
    this.running = null;
    this.again = false;
    this.timer = null;
    this.stopped = true;
    this.lastOkAt = null;
    this.lastAttemptAt = null;
  }

  start() {
    this.stopped = false;
    this.#schedule(0);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    for (const p of this.pendingConfirms.splice(0)) p.resolve({ reached: false });
    for (const w of this.waiters.splice(0)) w();
  }

  #schedule(ms) {
    clearTimeout(this.timer);
    if (this.stopped) return;
    this.timer = setTimeout(() => this.#run(false), ms);
    this.timer.unref?.();
  }

  /** Sync now (an unknown kid, check_reach_now); resolves when a sync has completed after this call. */
  requestNow() {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      this.#kick();
    });
  }

  /** Confirm clips with the cloud now; resolves { reached, confirmed: string[] }. */
  confirm(items) {
    return new Promise((resolve) => {
      this.pendingConfirms.push({ items, resolve });
      this.#kick();
    });
  }

  #kick() {
    if (this.stopped) { this.stop(); return; }
    if (this.running) { this.again = true; return; }
    if (!this.onDemand.hit('on-demand').ok) {
      this.#schedule(this.onDemand.retryAfterS('on-demand') * 1000);
      return;
    }
    this.#run(true);
  }

  async #run() {
    if (this.running || this.stopped) return;
    clearTimeout(this.timer);
    // Take at most MAX_CONFIRM clips; the rest go on the next call.
    const taken = [];
    let count = 0;
    while (this.pendingConfirms.length && count + this.pendingConfirms[0].items.length <= MAX_CONFIRM) {
      const p = this.pendingConfirms.shift();
      taken.push(p);
      count += p.items.length;
    }
    if (taken.length === 0 && this.pendingConfirms.length) { const p = this.pendingConfirms.shift(); taken.push({ ...p, items: p.items.slice(0, MAX_CONFIRM) }); }
    const waiters = this.waiters.splice(0);
    const confirm = taken.flatMap((p) => p.items);
    const body = { ...this.report(), confirm };
    this.lastAttemptAt = this.now();
    this.running = (async () => {
      let result;
      try { result = await this.call(body); } catch (e) { result = { ok: false, status: 0, unreachable: true, error: String(e?.message || e) }; }
      if (result.ok) this.lastOkAt = this.now();
      try { this.onResult(result, body); } catch { /* the runtime's own errors are its own */ }
      const confirmed = new Set(result.ok && Array.isArray(result.data?.confirmed) ? result.data.confirmed : []);
      for (const p of taken) p.resolve({ reached: !!result.ok, confirmed: p.items.map((i) => i.clip).filter((c) => confirmed.has(c)) });
      for (const w of waiters) w();
    })();
    await this.running;
    this.running = null;
    if (this.stopped) return;
    if (this.again || this.pendingConfirms.length || this.waiters.length) {
      this.again = false;
      this.#kick();
    } else {
      this.#schedule(this.intervalMs());
    }
  }
}
