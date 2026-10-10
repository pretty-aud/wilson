// =============================================================================
// Reach per location (design §2's table): at every sync, one time-limited
// `stat` of each location's root, 2 s, in a short-lived WORKER THREAD (BC2's
// hand-off §3: Windows held a filesystem call on a dead share for 5 s and
// 42 s, and a held call must hold a parked thread, never one of libuv's pool
// threads that the clips are read on). One question per root in flight; at
// most sixteen parked at once; the root is passed as data, never as code.
//
//   reachable      the root is a folder
//   not_mounted    container: /locations/<host>/<share> is not there
//   not_connected  Windows: no share login is held for that server (run
//                  share-login), so the gateway has not contacted it at all:
//                  a server is contacted only once an administrator gave its
//                  login, or listed it in connect_without_login (review round
//                  1, finding 2: the cloud's list is written by any project
//                  editor, and a contact authenticates as this computer)
//   not_reachable  anything else: refused with a login, missing, slow
// =============================================================================

import { Worker } from 'node:worker_threads';
import { locationRoot, parseUncPath } from '../rules/mountRule.mjs';

const ROOT_WORKER_CODE = "const { workerData, parentPort } = require('node:worker_threads'); const fs = require('node:fs'); let r; try { r = fs.statSync(workerData).isDirectory() ? 'dir' : 'notdir'; } catch (e) { r = 'E:' + ((e && e.code) || 'UNKNOWN'); } parentPort.postMessage(r);";

/** 'dir' | 'notdir' | 'E:<code>' | 'timeout' */
export function askRootInWorker(root, timeoutMs = 2_000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    let w;
    try { w = new Worker(ROOT_WORKER_CODE, { eval: true, workerData: String(root) }); } catch { resolve('E:WORKER'); return; }
    const timer = setTimeout(() => done('timeout'), timeoutMs);
    w.once('message', (r) => done(String(r)));
    w.once('error', () => done('E:WORKER'));
    w.once('exit', () => done('E:EXIT'));
    w.unref();
  });
}

export class ReachChecker {
  /**
   * @param {{ platform: 'windows'|'container', ask?: (root: string) => Promise<string>, maxAsking?: number, hasShareLogin?: (host: string) => boolean, mayContact?: (unc: string) => boolean, now?: () => number }} o
   */
  constructor({ platform, ask = askRootInWorker, maxAsking = 16, hasShareLogin = () => false, mayContact = () => true, now = Date.now, rootFor = null }) {
    this.mayContact = mayContact;
    this.rootFor = rootFor || ((unc) => locationRoot(unc, platform));
    this.platform = platform;
    this.ask = ask;
    this.maxAsking = maxAsking;
    this.hasShareLogin = hasShareLogin;
    this.now = now;
    this.inFlight = new Map(); // root → promise
    this.asking = 0;
    this.since = new Map(); // id → time it went down
  }

  #askOnce(root) {
    if (this.inFlight.has(root)) return this.inFlight.get(root);
    if (this.asking >= this.maxAsking) return Promise.resolve('busy');
    this.asking += 1;
    const p = Promise.resolve().then(() => this.ask(root)).catch(() => 'E:ASK').finally(() => { this.asking -= 1; this.inFlight.delete(root); });
    this.inFlight.set(root, p);
    return p;
  }

  classify(answer, unc) {
    if (answer === 'dir') return 'reachable';
    if (this.platform === 'container') return answer === 'E:ENOENT' ? 'not_mounted' : 'not_reachable';
    const host = parseUncPath(unc)?.host?.toLowerCase();
    if (answer.startsWith('E:') && host && !this.hasShareLogin(host)) return 'not_connected';
    return 'not_reachable';
  }

  /**
   * @param {Array<{ id: string, unc: string }>} locations
   * @returns {Promise<Map<string, { state: string, root: string|null, since: number|null }>>}
   */
  async check(locations) {
    const out = new Map();
    await Promise.all(locations.map(async (l) => {
      const root = this.rootFor(l.unc);
      let state;
      if (!root) state = this.platform === 'container' ? 'not_mounted' : 'not_reachable';
      else if (!this.mayContact(l.unc)) state = 'not_connected';
      else state = this.classify(await this.#askOnce(root), l.unc);
      if (state === 'reachable') this.since.delete(l.id);
      else if (!this.since.has(l.id)) this.since.set(l.id, this.now());
      out.set(l.id, { state, root, since: this.since.get(l.id) ?? null });
    }));
    return out;
  }
}
