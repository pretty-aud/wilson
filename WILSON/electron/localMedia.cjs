// =============================================================================
// localMedia.cjs — cloud rows, local bodies (demo 2026-09-11).
//
// Audrey, 2026-09-11, verbatim: "all databases need to live in the supabase
// storage at all times. the only thing local storage should be related to is
// just the media files and asset of the project. the system should still
// track and record all databases in supabase."
//
// In Supabase mode a PRIVATE project's file rows are cloud rows like any
// other (public.files, storage_provider = 'local_server'); their BODIES are
// written here, under ONE root on this computer — the open demo folder's
// media\ when there is one, app data otherwise (main.cjs getLocalMediaRoot)
// — by the renderer's local_server storage provider
// (src/tools/rabbit_v0.1.0/storage/localServerProvider.js). Five verbs on
// the wire, one per registry function (storage/index.js):
//
//   GET    /api/rabbit/local-media          -> { root }        describe()
//   PUT    /api/rabbit/local-media/<key>    -> { key, size }   put()   (409 if present)
//   GET    /api/rabbit/local-media/<key>    -> the bytes       get() / getUrl()
//                                              Range-capable; ?download=<name> attaches
//   HEAD   /api/rabbit/local-media/<key>    -> 200 / 404       exists()
//   DELETE /api/rabbit/local-media/<key>    -> 204 / 404       del()
//
// 🚨 THE KEY IS THE ROW'S storage_path, AND ANOTHER MEMBER CAN WRITE ONE.
// A files row is inserted by any project member through PostgREST, so a key
// that reaches these routes is untrusted input, never our own output.
// checkMediaKey admits only the shape uploadFile writes —
// projects/<id>/<entity>/<entity id>/<leaf>, plain segments, nothing that
// is a dot-segment, a separator, a drive letter or a Windows device name —
// and every disk path is then resolved through resolveContainedFilePath and
// checked again by REAL path, so a junction inside the root cannot lead out
// of it. Refusals in depth (the S34 rule): nothing outside the root is ever
// read, written or unlinked, whatever a row says.
//
// 🚨 LOOPBACK ONLY, UNAUTHENTICATED — the Local Server stance since S12: the
// in-app Express server binds 127.0.0.1 and serves whoever can reach it on
// this machine. That is the same trust a file on this disk already has.
//
// Mounted from main.cjs with ONE line, after the /api/rabbit missing-folder
// guard (a missing demo folder refuses these too) and BEFORE the SPA
// catch-all. Pure: every host dependency is injected, and localMedia.test.js
// drives it on a temp root through a real express app.
// =============================================================================
'use strict';

const fs = require('fs');
const path = require('path');

const ROUTE_BASE = '/api/rabbit/local-media';
const KEY_MAX = 1024;
const SEGMENT_MAX = 255;
const MIN_SEGMENTS = 3;
const MAX_SEGMENTS = 12;
// The characters uploadFile's own key can contain: it slugs the leaf with
// [^a-zA-Z0-9._-] -> '_' and the other segments are 'projects', UUIDs and
// lowercase entity names. Anything else is not a key we wrote.
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const DEVICE_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
  ogg: 'audio/ogg', flac: 'audio/flac',
};

/** The shape of a key we would have written, and nothing else. Pure. */
function checkMediaKey(key) {
  if (typeof key !== 'string' || key.length === 0) return { ok: false, error: 'no media key' };
  if (key.length > KEY_MAX) return { ok: false, error: 'media key too long' };
  if (/[\0\\]/.test(key)) return { ok: false, error: 'media key has a forbidden character' };
  const segments = key.split('/');
  if (segments.length < MIN_SEGMENTS || segments.length > MAX_SEGMENTS) {
    return { ok: false, error: 'media key has the wrong shape' };
  }
  if (segments[0] !== 'projects') return { ok: false, error: 'media key must start with projects/' };
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..') return { ok: false, error: 'media key has an empty or dot segment' };
    if (seg.length > SEGMENT_MAX) return { ok: false, error: 'media key segment too long' };
    if (!SEGMENT_RE.test(seg)) return { ok: false, error: 'media key has a forbidden character' };
    if (/[. ]$/.test(seg)) return { ok: false, error: 'media key segment ends in a dot' };
    if (DEVICE_RE.test(seg)) return { ok: false, error: 'media key names a device' };
  }
  return { ok: true, segments };
}

function mimeForLeaf(leaf) {
  const ext = String(leaf || '').split('.').pop().toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

/** attachment; filename="<ascii>"; filename*=UTF-8''<utf8> — both forms, so
 *  the browser's own download manager gets the real name whatever it reads. */
function contentDisposition(name) {
  const clean = String(name || 'download').replace(/[\r\n"\\/]/g, '_').slice(0, 200) || 'download';
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

function lowerNoTrail(p) {
  let s = String(p).toLowerCase();
  if (s.endsWith(path.sep)) s = s.slice(0, -1);
  return s;
}

/** Real-path containment: the nearest EXISTING ancestor of `candidate`
 *  resolves (through any junction) to somewhere inside the real root. */
function insideByRealPath(root, candidate) {
  let rootReal;
  try { rootReal = fs.realpathSync.native(root); } catch { return false; }
  let probe = candidate;
  for (let i = 0; i < 64; i++) {
    if (fs.existsSync(probe)) break;
    const parent = path.dirname(probe);
    if (parent === probe) return false;
    probe = parent;
  }
  let probeReal;
  try { probeReal = fs.realpathSync.native(probe); } catch { return false; }
  const a = lowerNoTrail(probeReal);
  const b = lowerNoTrail(rootReal);
  return a === b || a.startsWith(b + path.sep);
}

function paramKey(req) {
  const raw = req.params && req.params.key;
  if (Array.isArray(raw)) return raw.join('/');
  return typeof raw === 'string' ? raw : '';
}

/**
 * Mount the five routes. `getRoot()` returns the absolute media root for
 * THIS request (created if missing) or throws a sentence when there is none
 * — the demo folder that vanished, say. `resolveContainedFilePath` is
 * pathContainment's; `safeMediaContentType` is main.cjs's media whitelist.
 */
function mountLocalMedia(expressApp, {
  getRoot,
  resolveContainedFilePath,
  safeMediaContentType = (m) => m,
  log = () => {},
} = {}) {
  if (typeof getRoot !== 'function') throw new Error('mountLocalMedia: getRoot is required');
  if (typeof resolveContainedFilePath !== 'function') throw new Error('mountLocalMedia: resolveContainedFilePath is required');

  function rootOr503(res) {
    try {
      const root = getRoot();
      if (!root) throw new Error('no local media root');
      return root;
    } catch (err) {
      res.status(503).json({ error: err && err.message ? err.message : 'the local media root is not available' });
      return null;
    }
  }

  // Everything below the root question: the key's shape, the lexical
  // containment, the real-path containment. Any failure is a 404 — a route
  // that explains WHICH check refused a crafted key is a map for the next one.
  function locate(req, res) {
    const root = rootOr503(res);
    if (!root) return null;
    const key = paramKey(req);
    const check = checkMediaKey(key);
    if (!check.ok) { res.status(404).json({ error: 'media not found' }); return null; }
    const diskPath = resolveContainedFilePath(root, check.segments.join(path.sep));
    if (!diskPath || lowerNoTrail(diskPath) === lowerNoTrail(path.resolve(root))) {
      res.status(404).json({ error: 'media not found' }); return null;
    }
    if (!insideByRealPath(root, diskPath)) { res.status(404).json({ error: 'media not found' }); return null; }
    return { root, key, diskPath, leaf: check.segments[check.segments.length - 1] };
  }

  expressApp.get(ROUTE_BASE, (req, res) => {
    const root = rootOr503(res);
    if (!root) return;
    res.json({ root, exists: fs.existsSync(root) });
  });

  expressApp.put(`${ROUTE_BASE}/*key`, (req, res) => {
    const at = locate(req, res);
    if (!at) return;
    if (fs.existsSync(at.diskPath)) return res.status(409).json({ error: 'a body already exists at this key' });
    let tmp = null;
    const fail = (status, message) => {
      if (tmp) { try { fs.unlinkSync(tmp); } catch { /* already gone */ } }
      if (!res.headersSent) res.status(status).json({ error: message });
    };
    try {
      fs.mkdirSync(path.dirname(at.diskPath), { recursive: true });
      // The directory that now exists must still be inside the real root — a
      // junction planted between the check and the write is the only way
      // this differs from locate()'s answer, and it is the case that matters.
      if (!insideByRealPath(at.root, path.dirname(at.diskPath))) return fail(404, 'media not found');
      tmp = `${at.diskPath}.part-${process.pid}-${Date.now()}`;
      const out = fs.createWriteStream(tmp, { flags: 'wx' });
      let done = false;
      out.on('error', (err) => { if (!done) { done = true; fail(500, `media write failed: ${err.message}`); } });
      req.on('aborted', () => { if (!done) { done = true; out.destroy(); fail(499, 'upload aborted'); } });
      out.on('finish', () => {
        if (done) return;
        done = true;
        try {
          fs.renameSync(tmp, at.diskPath);
          const size = fs.statSync(at.diskPath).size;
          tmp = null;
          log(`[local-media] wrote ${at.key} (${size} bytes)`);
          res.json({ key: at.key, size });
        } catch (err) {
          fail(500, `media write failed: ${err.message}`);
        }
      });
      req.pipe(out);
    } catch (err) {
      fail(500, `media write failed: ${err.message}`);
    }
  });

  expressApp.head(`${ROUTE_BASE}/*key`, (req, res) => {
    const at = locate(req, res);
    if (!at) return;
    let stat;
    try { stat = fs.statSync(at.diskPath); } catch { return res.status(404).end(); }
    if (!stat.isFile()) return res.status(404).end();
    res.setHeader('Content-Type', safeMediaContentType(mimeForLeaf(at.leaf)));
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Accept-Ranges', 'bytes');
    res.status(200).end();
  });

  expressApp.get(`${ROUTE_BASE}/*key`, (req, res) => {
    const at = locate(req, res);
    if (!at) return;
    let stat;
    try { stat = fs.statSync(at.diskPath); } catch { return res.status(404).json({ error: 'media not found' }); }
    if (!stat.isFile()) return res.status(404).json({ error: 'media not found' });
    const headers = {
      'Content-Type': safeMediaContentType(mimeForLeaf(at.leaf)),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=0',
    };
    const download = typeof req.query.download === 'string' ? req.query.download : '';
    if (download) headers['Content-Disposition'] = contentDisposition(download);
    // sendFile (the `send` module) handles Range, HEAD and conditional GET;
    // headers set here land before it picks a type, so ours wins.
    res.sendFile(at.diskPath, { headers, dotfiles: 'deny', acceptRanges: true, cacheControl: false, lastModified: true }, (err) => {
      if (!err) return;
      if (res.headersSent || res.writableEnded) return;
      res.status(err.status || 500).json({ error: 'media read failed' });
    });
  });

  expressApp.delete(`${ROUTE_BASE}/*key`, (req, res) => {
    const at = locate(req, res);
    if (!at) return;
    try {
      const stat = fs.statSync(at.diskPath);
      if (!stat.isFile()) return res.status(404).json({ error: 'media not found' });
      fs.unlinkSync(at.diskPath);
      log(`[local-media] removed ${at.key}`);
      return res.status(204).end();
    } catch (err) {
      if (err && err.code === 'ENOENT') return res.status(404).json({ error: 'media not found' });
      return res.status(500).json({ error: `media delete failed: ${err.message}` });
    }
  });
}

module.exports = { mountLocalMedia, checkMediaKey, mimeForLeaf, contentDisposition, ROUTE_BASE };
