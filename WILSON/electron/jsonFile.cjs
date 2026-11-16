// =============================================================================
// electron/jsonFile.cjs — F3 (wave 1 of docs/sessions/PLAN_WEEK_2026-11-04.md;
// OUTSTANDING REV-06, REV-07; docs/reviews/code-review-2026-10-31/
// desktop-build.md C1, A6, C2): the main process's JSON files — one reader,
// one writer, and the project bundles kept in memory.
//
// ── ONE WRITER ──────────────────────────────────────────────────────────────
//
// `writeJSON` in main.cjs wrote in place (`writeFileSync` straight over the
// file, no retry), so a crash mid-write left a torn project.json; `readJSON`
// swallows the parse error, so the project read back as nothing and dropped
// out of the list. Lifted from rendererStorage.cjs's writeKept: the text goes
// whole to `<file>.tmp`, which is renamed over the file; both steps are retried
// while Windows holds a file (an indexer or antivirus: EPERM, EBUSY, EACCES).
// A crash of the app leaves the previous file whole. A `.tmp` left by a rename
// refused past the retries holds the newer text; the next write replaces it,
// and nothing reads it. No fsync unless asked (`durable`): after a power cut
// the rename can reach the disk before the text, leaving neither version (a
// file of zeros), as the in-place write could leave a torn one before.
// Replacing a file needs every other program that holds it open to allow a
// delete, and the new file takes the folder's attributes, not the old file's
// (build review round 1, finding 6).
//
// ── THE BUNDLES KEPT ────────────────────────────────────────────────────────
//
// Every R.A.B.B.I.T. request read, parsed and reconciled the whole bundle from
// disk, synchronously, on the process that drives the window (a thumbnail GET
// parsed 379 KB to serve one picture). `createKeptFiles` keeps the text last
// read or written, keyed by the file's path and valid while a stat of it gives
// the same volume, file id, size and modification time: main is the only
// writer (the single-instance lock), and a hand edit, a copy over the file or a
// restore changes at least one of them. Every read is a fresh parse of the
// kept text — callers mutate what they read, and some refuse after mutating
// without writing — so a caller gets exactly what a disk read gives, never a
// shared object. The texts are bounded (counted at two bytes a character, as
// V8 may hold them).
//
// ── MIRRORS WRITTEN ONLY WHEN THEY CHANGE ───────────────────────────────────
//
// `createChangeOnlyWriter` writes a file only when its text differs from what
// this process last wrote there, or the file is no longer in its folder.
//
// Pure: no Electron import, `fs` injectable, so src/lib/jsonFile.test.js runs
// it for real (main.cjs requires Electron at load and cannot be).
// =============================================================================

'use strict';

const nodeFs = require('fs');
const nodePath = require('path');
const crypto = require('crypto');

const LOCK_CODES = ['EPERM', 'EBUSY', 'EACCES'];
/** Tries while Windows holds a file: about 0.2 s in all, then the error is the caller's. */
const WRITE_ATTEMPTS = 5;
/** The kept texts, in all. */
const KEPT_BYTES = 64 * 1024 * 1024;

function pauseSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Run `fn`, again after a short pause while Windows holds the file. */
function withRetry(fn, pause, attempts) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return fn();
    } catch (err) {
      if (attempt >= attempts || !LOCK_CODES.includes(err?.code)) throw err;
      pause(20 * attempt);
    }
  }
}

/** The file's value, or `fallback` when it is missing, unreadable or not JSON. */
function readJson(file, fallback = null, fsImpl = nodeFs) {
  try { return JSON.parse(fsImpl.readFileSync(file, 'utf-8')); } catch { return fallback; }
}

/**
 * `text` written whole to `<file>.tmp`, then renamed over `file`; returns the
 * text. `durable` syncs the temporary file to the disk before the rename (the
 * archive, whose live copies are removed next).
 */
function writeTextAtomic(file, text, { fs: fsImpl = nodeFs, pause = pauseSync, attempts = WRITE_ATTEMPTS, durable = false } = {}) {
  const tmp = `${file}.tmp`;
  withRetry(() => {
    if (!durable) {
      fsImpl.writeFileSync(tmp, text);
      return;
    }
    const fd = fsImpl.openSync(tmp, 'w');
    try {
      fsImpl.writeFileSync(fd, text); // loops until the whole text is written (build review round 1, finding 5)
      fsImpl.fsyncSync(fd);
    } finally {
      fsImpl.closeSync(fd);
    }
  }, pause, attempts);
  withRetry(() => fsImpl.renameSync(tmp, file), pause, attempts);
  return text;
}

/** `data` as two-space JSON (the format on disk is unchanged), atomically; returns the text written. */
function writeJsonAtomic(file, data, opts) {
  return writeTextAtomic(file, JSON.stringify(data, null, 2), opts);
}

/** One key per file: the resolved path, case-folded where the file system ignores case. */
function keyOf(file) {
  const resolved = nodePath.resolve(String(file));
  return process.platform === 'win32' || process.platform === 'darwin' ? resolved.toLowerCase() : resolved;
}

/**
 * The bundles kept in memory.
 *
 *   stamp(file)               the file's identity now (volume, file id, size,
 *                             modification time), or null when it is not a file
 *   read(file)                a fresh parse of the kept text while the stamp is
 *                             unchanged; null when nothing is kept or the file
 *                             changed (the entry is then dropped)
 *   keep(file, text, stamp?)  the text now on disk (or a function making it),
 *                             with the stamp taken before it was read, or a
 *                             stat now; never throws
 *   forget(file)
 */
function createKeptFiles({ fs: fsImpl = nodeFs, maxBytes = KEPT_BYTES } = {}) {
  const entries = new Map(); // key → { stamp, text, bytes }, oldest use first
  let bytes = 0;

  const stamp = (file) => {
    try {
      const s = fsImpl.statSync(file, { bigint: true });
      return s && s.isFile() ? `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}` : null;
    } catch {
      return null;
    }
  };
  const drop = (key) => {
    const e = entries.get(key);
    if (!e) return;
    bytes -= e.bytes;
    entries.delete(key);
  };

  return {
    stamp,

    read(file) {
      const key = keyOf(file);
      const e = entries.get(key);
      if (!e) return null;
      const now = stamp(file);
      if (now === null || now !== e.stamp) {
        drop(key);
        return null;
      }
      entries.delete(key); // the most recently used goes last
      entries.set(key, e);
      try {
        return JSON.parse(e.text);
      } catch {
        drop(key);
        return null;
      }
    },

    keep(file, text, given) {
      const key = keyOf(file);
      drop(key);
      const s = given === undefined ? stamp(file) : given;
      if (!s) return false;
      // One old bundle with base64 decks must not evict every other: a file
      // over a quarter of the budget (about 8 MB on disk) is never kept, and
      // `text` may be a function, called only when the file fits, so such a
      // bundle pays no stringify per load for nothing (build review round 2,
      // finding 2).
      const onDisk = Number(String(s).split(':')[2]);
      if (Number.isFinite(onDisk) && onDisk * 2 > maxBytes / 4) return false;
      const made = typeof text === 'function' ? text() : text;
      if (typeof made !== 'string') return false;
      const size = made.length * 2;
      if (size > maxBytes / 4) return false;
      entries.set(key, { stamp: s, text: made, bytes: size });
      bytes += size;
      for (const old of entries.keys()) {
        if (bytes <= maxBytes) break;
        if (old !== key) drop(old);
      }
      return true;
    },

    forget(file) {
      drop(keyOf(file));
    },

    /** For tests: how many texts, and their bytes as counted. */
    usage: () => ({ files: entries.size, bytes }),
  };
}

/**
 * A writer per folder pass: `writerFor(dir)` lists the folder once and
 * returns `(file, data) => wrote`, which writes `data` as JSON only when its
 * text differs from what this writer last wrote to `file`, or `file` is not in
 * the folder (removed by hand, a reset, a new project at the same path). A
 * write that throws records nothing, so the next pass writes again; so each
 * is tried once, not held up by the retries (a mirror is derived, and a
 * folder she can only read must not cost every write 0.2 s: build review
 * round 1, finding 1), and one that fails is logged and passed over, so a
 * held file does not keep the others of the pass from being written (round 2,
 * finding 3). The line names the file's own name (`tasks.json`) and the
 * error's code, never its folder.
 */
function createChangeOnlyWriter({ fs: fsImpl = nodeFs, write = writeTextAtomic, log = () => {} } = {}) {
  const last = new Map(); // key → sha1 of the text this writer put there
  return {
    writerFor(dir) {
      let present;
      try {
        present = new Set(fsImpl.readdirSync(dir).map((n) => String(n).toLowerCase()));
      } catch {
        present = new Set();
      }
      return (file, data) => {
        const text = JSON.stringify(data, null, 2);
        const digest = crypto.createHash('sha1').update(text).digest('hex');
        const key = keyOf(file);
        const name = nodePath.basename(String(file));
        if (last.get(key) === digest && present.has(name.toLowerCase())) return false;
        try {
          write(file, text, { fs: fsImpl, attempts: 1 });
        } catch (err) {
          log(`[wilson] a project's ${name} mirror was not written (${err?.code || 'error'}); the next save writes it`);
          return false;
        }
        last.set(key, digest);
        return true;
      };
    },
  };
}

module.exports = {
  LOCK_CODES,
  WRITE_ATTEMPTS,
  KEPT_BYTES,
  withRetry,
  readJson,
  writeTextAtomic,
  writeJsonAtomic,
  createKeptFiles,
  createChangeOnlyWriter,
};
