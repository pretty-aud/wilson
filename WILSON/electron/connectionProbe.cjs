// =============================================================================
// connectionProbe.cjs — the desktop's answer to "is everything connected?"
// Post-overhaul FX11, 2026-10-16.
//
// Audrey: "to confirm this green dot should clarify that the system is
// connected to the storage solution not just the databases". R.A.B.B.I.T.'s
// connection dot (src/tools/rabbit_v0.1.0/state/connectionStatus.js) asks this
// route on the desktop:
//
//   GET /api/rabbit/connection
//     -> { data:  { ok, why? },          the Local Server's own data folder
//          files: { ok, why?, kind } }   where project files are kept
//
// `kind` names the files root resolveConfiguredRootDir() answers (main.cjs):
//   demo       the open demo folder's projects\
//   workspace  the company's root (workspace_storage.root_path, a NAS or a
//              server share), pushed at sign-in over rabbit:set-workspace-root
//   machine    this computer's own files folder (files-config defaultRootDir)
//   app        none of those: project files fall back to app data
// The path itself is not sent: the dot names the place, not the folder.
//
// ── What "answers" means, and why it is bounded ─────────────────────────────
// Each root is asked with ONE asynchronous stat (fs.promises — the libuv pool,
// never the main thread; a synchronous stat of a dead SMB share would freeze
// the whole app for the SMB time-out, SYSTEMS_HANDBOOK §17). ok is "it is
// there and it is a folder". A stat still pending after `timeoutMs` answers
// `timeout` — and is NOT started again while it is pending: the next request
// waits on the same stat (single flight), so a dead share holds one pool
// thread, never one per minute. Nothing is created, written or listed.
//
// Behind the /api/rabbit missing-folder guard (a missing demo folder is a 503
// before this runs) and the B3 per-launch token, like every /api route.
// Pure: every host dependency is injected; connectionRoute.test.js drives it
// through a real express app on temp folders.
// =============================================================================
'use strict';

const fs = require('fs');

const ROUTE = '/api/rabbit/connection';
const DEFAULT_TIMEOUT_MS = 3000;

function mountConnectionProbe(expressApp, {
  getDataDir,
  getFilesRoot,
  stat = (p) => fs.promises.stat(p),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  // One pending stat per path (single flight, above).
  const pending = new Map();

  function statOnce(p) {
    let run = pending.get(p);
    if (!run) {
      run = Promise.resolve()
        .then(() => stat(p))
        .then(
          (st) => (st && typeof st.isDirectory === 'function' && st.isDirectory() ? { ok: true } : { ok: false, why: 'missing' }),
          (err) => ({ ok: false, why: err && (err.code === 'ENOENT' || err.code === 'ENOTDIR') ? 'missing' : 'unreachable' }),
        )
        .finally(() => { pending.delete(p); });
      pending.set(p, run);
    }
    return run;
  }

  function ask(p) {
    if (!p) return Promise.resolve({ ok: false, why: 'missing' });
    let timer = null;
    const ceiling = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, why: 'timeout' }), timeoutMs);
    });
    return Promise.race([statOnce(p), ceiling]).finally(() => clearTimeout(timer));
  }

  expressApp.get(ROUTE, async (req, res) => {
    let dataDir;
    let files;
    try {
      dataDir = getDataDir();
      files = getFilesRoot() || {};
    } catch (err) {
      return res.status(503).json({ error: (err && err.message) || 'the local data folder is not available' });
    }
    const [data, filesAnswer] = await Promise.all([ask(dataDir), ask(files.root)]);
    res.set('cache-control', 'no-store');
    res.json({ data, files: { ...filesAnswer, kind: files.kind || 'app' } });
  });
}

module.exports = { mountConnectionProbe, ROUTE, DEFAULT_TIMEOUT_MS };
