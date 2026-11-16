// electron/rootReachable.cjs — MO1 (MOTH NS-X17): whether a root answers, asked once and never on the
// main thread's clock. Lifted from rabbitBins.cjs's mountCloudBins, which keeps its location mapping; the
// office-server routes ask the same instance, so a server that went off for one is off for the other.
//
// Found on a real network path (BC2): Windows can hold a filesystem call on a share whose server does
// not answer for a long time — measured 5 s for a name that does not resolve and 42 s for an address
// nothing answers — and these routes run in the desktop's MAIN process, where a synchronous call freezes
// the whole window. So a root is asked asynchronously, given rootWaitMs to answer, and the answer is kept
// rootTtlMs; one question per root is in flight at a time (a thread waiting on a dead server is not asked
// again until it returns). A root that answers after the limit counts from then on.
//
// Review round 1: a root known to be off is asked again less often, and at most rootMaxAsking questions
// are out at once. A question past the cap waits for a free slot, inside the same rootWaitMs.
//
// Where the question is asked (measured in the desktop app itself, after round 1): NOT on libuv's pool.
// Electron's main process has four pool threads, they serve the app's own files, posters and streams,
// and they cannot be widened from main.cjs (UV_THREADPOOL_SIZE set there read 16 and changed nothing:
// with six such questions out, a local file read waited the full 8 s). Each question is a synchronous
// stat in its own short-lived worker thread instead (about 16 ms, measured): a held question holds that
// thread, never the pool (the same read: 2 ms).
'use strict';

const { Worker } = require('node:worker_threads');

// The root is passed as data (workerData), never as code.
const ROOT_WORKER_CODE = "const { workerData, parentPort } = require('node:worker_threads'); const fs = require('node:fs'); let ok = false; try { ok = fs.statSync(workerData).isDirectory(); } catch { ok = false; } parentPort.postMessage(ok);";
function askRootInWorker(root) {
  return new Promise((resolve) => {
    let w;
    try { w = new Worker(ROOT_WORKER_CODE, { eval: true, workerData: String(root) }); } catch { resolve(false); return; }
    w.once('message', (ok) => resolve(ok === true));
    w.once('error', () => resolve(false));
    w.once('exit', () => resolve(false)); // no message: not reachable
    w.unref();
  });
}

function makeRootQuestions({ askRoot, rootWaitMs, rootTtlMs, rootOffTtlMs, rootMaxAsking } = {}) {
  const ROOT_WAIT_MS = Number(rootWaitMs) > 0 ? Number(rootWaitMs) : 2000;
  const ROOT_TTL_MS = Number(rootTtlMs) > 0 ? Number(rootTtlMs) : 15000;
  const ROOT_OFF_TTL_MS = Number(rootOffTtlMs) > 0 ? Number(rootOffTtlMs) : 60000;
  // Sixteen: a held question costs a parked worker thread, not a pool slot (measured: with a cap of
  // four, six servers that do not answer kept a live share's question waiting past the limit).
  const ROOT_MAX_ASKING = Number(rootMaxAsking) > 0 ? Number(rootMaxAsking) : 16;
  const ask = typeof askRoot === 'function' ? askRoot : askRootInWorker;
  let askingNow = 0;
  const slotWaiters = [];
  const takeSlot = () => (askingNow < ROOT_MAX_ASKING ? (askingNow++, Promise.resolve()) : new Promise((r) => slotWaiters.push(r)));
  const freeSlot = () => { const next = slotWaiters.shift(); if (next) next(); else askingNow--; };
  const rootAnswers = new Map();
  function rootReachable(root) {
    if (typeof root !== 'string' || !root) return Promise.resolve(false);
    const k = root.toLowerCase();
    const c = rootAnswers.get(k) || { ok: false, at: 0, asking: null, waiting: null };
    if (c.waiting) return c.waiting;
    // An off answer from ONE slow clip (`brief`) is kept as long as an on
    // answer, not the full off time (review round 2).
    if (c.asking || Date.now() - c.at < (c.ok || c.brief ? ROOT_TTL_MS : ROOT_OFF_TTL_MS)) return Promise.resolve(c.ok);
    const asking = takeSlot().then(() => Promise.resolve().then(() => ask(root)).then((ok) => ok === true, () => false).finally(freeSlot));
    asking.then((ok) => { rootAnswers.set(k, { ...(rootAnswers.get(k) || {}), ok, at: Date.now(), asking: null, brief: false }); });
    // Known to be off and due again: "not reachable" at once, asked again
    // behind it — a location that stays off costs nothing after the first
    // time, one that comes back counts from the next question. (A root that
    // WAS reachable is waited for, so a server that just went down is not
    // read clip by clip.)
    if (c.at > 0 && !c.ok) { rootAnswers.set(k, { ...c, asking }); return Promise.resolve(false); }
    let timer = null;
    const waiting = Promise.race([asking, new Promise((r) => { timer = setTimeout(() => r(null), ROOT_WAIT_MS); })]).then((v) => {
      clearTimeout(timer);
      const cur = rootAnswers.get(k) || {};
      if (v === null) { rootAnswers.set(k, { ...cur, ok: false, at: Date.now(), waiting: null, brief: false }); return false; }
      rootAnswers.set(k, { ...cur, waiting: null });
      return v;
    });
    rootAnswers.set(k, { ...c, asking, waiting });
    return waiting;
  }
  // The root is known to be off right now, without asking it.
  const knownOff = (root) => {
    const c = rootAnswers.get(String(root).toLowerCase());
    return Boolean(c && c.at > 0 && !c.ok);
  };
  // A call under this root ran out of time: off at once, for as long as an on answer is kept.
  const markOff = (root) => {
    const k = String(root).toLowerCase();
    rootAnswers.set(k, { ...(rootAnswers.get(k) || {}), ok: false, at: Date.now(), brief: true });
  };
  return { rootReachable, knownOff, markOff, ROOT_WAIT_MS };
}

module.exports = { makeRootQuestions, askRootInWorker };
