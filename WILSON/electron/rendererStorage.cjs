// =============================================================================
// electron/rendererStorage.cjs — D1 (night 4, 2026-10-28; docs/design/
// RECONNECT_DESIGN.md §12): the renderer's localStorage, kept across a
// relaunch.
//
// ── WHY ─────────────────────────────────────────────────────────────────────
//
// The window loads http://127.0.0.1:<port> and the port is listen(0)'s, new at
// every launch, so every launch is a new origin and Chromium hands it an empty
// localStorage. MEASURED 2026-10-28 (a development build, a scratch userData):
// ports 60589 then 60598, and the timeline's settings, a saved view, an edit's
// crash copy and the update prompt's skip were all gone at the second launch.
// The origin stays per launch ON PURPOSE — the local server's gate and every
// TPN finding on the loopback bind reason from it (electron/localToken.cjs) —
// so what is kept instead is the renderer's keys, in a file in userData.
//
// ── HOW ─────────────────────────────────────────────────────────────────────
//
// The preload (electron/preload.cjs; inline there, because a sandboxed preload
// loads only Electron's own modules) asks for the kept pairs at every load,
// synchronously. At an origin's FIRST accepted load it makes that origin's
// localStorage exactly those pairs before the page's first script; at every
// load they are the baseline it compares the page's storage with. It sends
// what changed once a second, when the window is hidden and at pagehide
// (synchronously there). main.cjs wires the channels, answers only a sender
// `acceptsSender` accepts, writes once more at quit, and clears every other
// origin's localStorage once the server has bound.
//
// ── A FILE THAT CANNOT BE READ IS NEVER WRITTEN OVER ────────────────────────
//
// Windows' antivirus or indexer can hold the file for a moment. A read that
// still fails after the retries makes the launch UNREADABLE: no seed (the page
// keeps the window's own storage, as before D1) and no write, so a locked file
// is never replaced by an empty map plus the first change (build review, F1).
// Only a missing file is empty; an unparseable one gives way to the other copy.
//
// ── NEVER KEPT, WHATEVER IT IS SENT ─────────────────────────────────────────
//
//   * the session keys. On the desktop the session is session.enc
//     (safeStorage) and never touches localStorage — unless the preload's
//     bridge failed, and then this file must not carry the tokens in plain
//     text (design review, F1);
//   * the idle clocks. start() overwrites them at every launch (a launch is
//     activity), and their five-second heartbeat would rewrite the whole file
//     while she works (F8);
//   * tus-js-client's resume fingerprints, removed only on success; the upload
//     module never resumes across attempts (F9).
//
// 🚨 No writer may keep an address on the loopback server. It would outlive
// its port, and the launch cookie (scoped by host, not port) would ride a
// request to whatever listens there next. None does: media addresses are built
// at render from a key (localMediaUrl), and src/lib/rendererStorage.test.js
// pins that no module building one writes localStorage. A filter here was
// tried and removed (build review, F2): it deleted ordinary text (a prompt
// naming a local model server) and missed the forms that matter.
//
// The file holds what Chromium's own `Local Storage` folder holds beside it in
// userData, with the same protection; never a session key, never the token.
// =============================================================================

const fs = require('fs');
const path = require('path');

const FILE_NAME = 'renderer-storage.json';
// The dev build (package `name: wilson`) and the installed one (product
// `WILSON`) share one userData folder on Windows, which ignores case: one file
// each, so a dev project's caches never seed the installed app (F12).
const DEV_FILE_NAME = 'renderer-storage.dev.json';
/** Above what Chromium lets one origin hold (10 MiB of UTF-16, 5,242,880 characters). */
const MAX_KEPT_CHARS = 6_000_000;
/** Reads, writes and renames retried this many times when Windows holds the file. */
const ATTEMPTS = 3;
const LOCK_CODES = ['EPERM', 'EBUSY', 'EACCES'];

const NEVER_KEPT_KEYS = new Set([
  'wilson.dev.session',
  'wilson.operator.session',
  'wilson.dev.session.activity',
  'wilson.operator.session.activity',
]);
const NEVER_KEPT_PREFIXES = ['sb-', 'tus::'];

/** Is this pair one the file may keep? Strings only, and none of the three kinds above. */
function isKeptPair(key, value) {
  if (typeof key !== 'string' || typeof value !== 'string') return false;
  if (NEVER_KEPT_KEYS.has(key)) return false;
  return !NEVER_KEPT_PREFIXES.some((p) => key.startsWith(p));
}

function rendererStorageFile(userDataDir, isPackaged) {
  return path.join(userDataDir, isPackaged ? FILE_NAME : DEV_FILE_NAME);
}

function pauseSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Run `fn`, again after a short pause while Windows holds the file. */
function withRetry(fn, pause) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return fn();
    } catch (err) {
      if (attempt >= ATTEMPTS || !LOCK_CODES.includes(err?.code)) throw err;
      pause(20 * attempt);
    }
  }
}

/** A Map (so `__proto__` and `hasOwnProperty` are ordinary keys), or null when the text is not a JSON object. */
function parseKept(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const kept = new Map();
  for (const [k, v] of Object.entries(parsed)) if (isKeptPair(k, v)) kept.set(k, v);
  return kept;
}

/**
 * `{ kept, unreadable }`. A missing file is empty. The newer of the file and
 * its `.tmp` is read first (a `.tmp` newer than the file is a write whose
 * rename Windows refused); an unparseable one gives way to the other (a
 * `.tmp` cut short by a crash). One that exists but cannot be read past the
 * retries makes the whole read unreadable: never fall back to an older copy
 * then, and never write over it.
 */
function readKept(file, fsImpl = fs, pause = pauseSync) {
  const found = [];
  for (const f of [file, `${file}.tmp`]) {
    try {
      found.push({ f, mtime: withRetry(() => fsImpl.statSync(f), pause).mtimeMs });
    } catch (err) {
      if (err?.code !== 'ENOENT') return { kept: new Map(), unreadable: true };
    }
  }
  found.sort((a, b) => b.mtime - a.mtime);
  for (const { f } of found) {
    let text;
    try {
      text = withRetry(() => fsImpl.readFileSync(f, 'utf8'), pause);
    } catch (err) {
      if (err?.code === 'ENOENT') continue;        // gone between the stat and the read
      return { kept: new Map(), unreadable: true };
    }
    const kept = parseKept(text);
    if (kept) return { kept, unreadable: false };
  }
  return { kept: new Map(), unreadable: false };
}

/**
 * Whole, synchronous, to a temporary file renamed over the kept one, so a
 * crash mid-write leaves the previous file. Both steps are retried while
 * Windows holds a file; the map in memory stays the truth either way.
 */
function writeKept(file, kept, fsImpl = fs, pause = pauseSync) {
  const tmp = `${file}.tmp`;
  const text = JSON.stringify(Object.fromEntries(kept));
  withRetry(() => fsImpl.writeFileSync(tmp, text), pause);
  withRetry(() => fsImpl.renameSync(tmp, file), pause);
}

function sameMap(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/**
 * @param {object} opts
 * @param {string} opts.file             rendererStorageFile(userData, app.isPackaged)
 * @param {object} [opts.fsImpl]         test seam
 * @param {number} [opts.maxChars]       the bound on the kept keys and values
 * @param {(line: string) => void} [opts.log]
 * @param {(ms: number) => void} [opts.pause]   test seam for the retries
 */
function createRendererStorage({ file, fsImpl = fs, maxChars = MAX_KEPT_CHARS, log = () => {}, pause = pauseSync }) {
  let state = null;          // { kept, unreadable }, read once per launch
  let seededOrigin = null;
  let dirty = false;         // the map in memory has not reached the disk

  const load = () => {
    if (!state) {
      state = readKept(file, fsImpl, pause);
      if (state.unreadable) log('[wilson] the renderer\'s kept storage could not be read; this launch keeps the window\'s own storage and writes nothing');
    }
    return state;
  };
  const write = () => {
    try {
      writeKept(file, state.kept, fsImpl, pause);
      dirty = false;
      return true;
    } catch (err) {
      dirty = true;
      log(`[wilson] the renderer's storage was not written (${err?.code || err?.message || err}); the next change and the quit try again`);
      return false;
    }
  };

  return {
    /**
     * At every accepted load of `origin`: the kept pairs, and whether this is
     * that origin's first load (the only one whose storage the preload
     * replaces): per origin, so a second window's new server starts clean too
     * (build review, F5). Null when the file could not be read.
     */
    seed(origin) {
      if (load().unreadable) return null;
      const first = origin !== seededOrigin;
      seededOrigin = origin;
      return { first, pairs: [...state.kept] };
    },

    /**
     * One change set from the preload, `{ set: [[key, value], ...], removed:
     * [key, ...] }`. Refused whole when it is not that shape, when the kept
     * total would pass the bound, or when the file could not be read. A pair
     * the file may not keep removes that key instead of keeping it.
     */
    apply(changes) {
      if (load().unreadable) return { ok: false, reason: 'unreadable' };
      const set = Array.isArray(changes?.set) ? changes.set : null;
      const removed = Array.isArray(changes?.removed) ? changes.removed : null;
      if (!set || !removed) return { ok: false, reason: 'shape' };
      for (const pair of set) {
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') {
          return { ok: false, reason: 'shape' };
        }
      }
      if (removed.some((k) => typeof k !== 'string')) return { ok: false, reason: 'shape' };
      const next = new Map(state.kept);
      for (const k of removed) next.delete(k);
      for (const [k, v] of set) {
        if (isKeptPair(k, v)) next.set(k, v);
        else next.delete(k);
      }
      let size = 0;
      for (const [k, v] of next) size += k.length + v.length;
      if (size > maxChars) return { ok: false, reason: 'too_large' };
      if (sameMap(state.kept, next) && !dirty) return { ok: true, written: false };
      state.kept = next;
      return write() ? { ok: true, written: true } : { ok: true, written: false, reason: 'write_failed' };
    },

    /** At quit: write once more when the map in memory never reached the disk. */
    flush() {
      if (!state || state.unreadable || !dirty) return false;
      return write();
    },

    keys: () => [...load().kept.keys()],
  };
}

/**
 * Only the main window's own top frame, at this launch's origin (design
 * review, F2). A dropped file or any other navigation can load a foreign page
 * in that frame, with the preload; a child window reports its opener's
 * origin. Anything that throws is refused.
 */
function acceptsSender(event, { webContents, origin }) {
  try {
    const frame = event?.senderFrame;
    return Boolean(frame && webContents && origin)
      && event.sender === webContents
      && frame === webContents.mainFrame
      && frame.origin === origin;
  } catch {
    return false;
  }
}

module.exports = {
  FILE_NAME,
  DEV_FILE_NAME,
  MAX_KEPT_CHARS,
  isKeptPair,
  rendererStorageFile,
  readKept,
  createRendererStorage,
  acceptsSender,
};
