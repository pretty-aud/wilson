// electron/shareContain.cjs — MO1 (MOTH NS-X06, NS-D13): where a locator really is on the office server,
// without holding the main thread or the pool. One realpath of the root per reachability window; the
// candidate's realpath and lstat through two slots, each raced against the root's wait. A call that runs
// out of time marks the root off, so the next file on it is not asked. It never walks ancestors.
//
// A file is the one its locator names or it is refused: where the real path differs from the written
// one, a link or junction is on the way, inside the drive or out of it, and a walk would not have
// listed it (NS-D7).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { makeContainment } = require('./pathContainment.cjs');

const STAT_MAX = 2;
const REAL_ROOT_TTL_MS = 15000;

function makeShareContain({ reach, fsp = fs.promises, pathImpl = path, statMax = STAT_MAX } = {}) {
  if (!reach || typeof reach.rootReachable !== 'function') throw new Error('makeShareContain: reach is required');
  const { resolveContainedFilePath } = makeContainment(pathImpl);
  const waitMs = reach.ROOT_WAIT_MS;
  const comparable = (p) => pathImpl.resolve(p).normalize('NFC').toLowerCase();

  let statNow = 0;
  const statWaiters = [];
  const takeStat = () => (statNow < statMax ? (statNow++, Promise.resolve()) : new Promise((r) => statWaiters.push(r)));
  const freeStat = () => { const next = statWaiters.shift(); if (next) next(); else statNow--; };

  // The slot is held as long as the thread is, past the race. One that ran out of time while it was
  // still waiting says so without marking a healthy root off.
  function bounded(root, call) {
    let timer = null; let started = false; let abandoned = false;
    const run = takeStat().then(() => {
      if (abandoned || reach.knownOff(root)) { freeStat(); return { off: true }; }
      started = true;
      const asked = call().then((value) => ({ value }), (err) => ({ err }));
      asked.finally(freeStat);
      return asked;
    });
    return Promise.race([run, new Promise((r) => { timer = setTimeout(() => r(null), waitMs); })]).then((v) => {
      clearTimeout(timer);
      if (v !== null) return v;
      if (started) reach.markOff(root); else abandoned = true;
      return { off: true };
    });
  }

  const realRoots = new Map();
  async function realRootOf(root) {
    const k = String(root).toLowerCase();
    const known = realRoots.get(k);
    if (known && Date.now() - known.at < REAL_ROOT_TTL_MS) return known.real;
    const asked = await bounded(root, () => fsp.realpath(root));
    if (asked.off || asked.err) return null;
    realRoots.set(k, { real: asked.value, at: Date.now() });
    return asked.value;
  }

  // { ok: true, abs, stat } or { ok: false, code }: not_contained, unreachable, not_there, a_link, failed.
  const shareContain = async function shareContain(root, relative) {
    const abs = resolveContainedFilePath(root, relative);
    if (!abs) return { ok: false, code: 'not_contained' };
    const realRoot = await realRootOf(root);
    if (!realRoot) return { ok: false, code: 'unreachable' };
    const stat = await bounded(root, () => fsp.lstat(abs));
    if (stat.off) return { ok: false, code: 'unreachable' };
    if (stat.err) return { ok: false, code: stat.err.code === 'ENOENT' || stat.err.code === 'ENOTDIR' ? 'not_there' : 'failed' };
    const real = await bounded(root, () => fsp.realpath(abs));
    if (real.off) return { ok: false, code: 'unreachable' };
    if (real.err) return { ok: false, code: 'failed' };
    const wanted = pathImpl.join(realRoot, ...String(relative).split('/'));
    if (comparable(real.value) !== comparable(wanted)) return { ok: false, code: 'a_link' };
    return { ok: true, abs, stat: stat.value };
  };
  // A route's own call on the server takes one of the same slots, so a dead server can hold only these
  // threads of the pool, and the app's own reads still have theirs. No time limit: a rename's outcome is
  // worth waiting for.
  shareContain.withSlot = (call) => takeStat().then(call).finally(freeStat);
  return shareContain;
}

module.exports = { makeShareContain };
