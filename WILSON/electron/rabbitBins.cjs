// ============================================================
// RABBIT — the bin system, local-server routes (demo 2026-09-11)
// ============================================================
//
// docs/BINS_DESIGN.md is the argument for everything in here. The short form:
// a bin is a container inside the project (a tree of `bundle.bins`); a bin
// file (`bundle.binFiles`) is a REFERENCE to a file the user keeps wherever it
// is — absolute `source_path`, never copied, renamed or moved (Audrey,
// 2026-09-10: "reference in place"). Frame sequences are one row per folder.
// Known roots (`bundle.binRoots`) are every folder the user picked or dropped
// from; they authorise relink scans and let a re-plugged drive relink itself.
//
// Mounted from main.cjs with one line inside startLocalServer:
//   require('./rabbitBins.cjs').mountRabbitBins(expressApp, { …helpers })
// The helpers are INJECTED rather than copied because they are closures over
// the server's state (readRabbitBundle migrates and reconciles on every read;
// generateVideoThumbOnce dedupes concurrent ffmpeg runs). Nothing here reads
// `userData` or the files config directly — the data-root layer belongs to the
// local-storage session.
//
// 🚨 SAME-ORIGIN ONLY. The loopback server answers any local origin (cors()),
// and every route below either takes a PATH from the body or returns the
// bytes at one. A drive-by page on another local origin cannot forge
// `Sec-Fetch-Site: same-origin` or its `Origin`, so that is the gate — the
// S14/S17 rule ("a body-picked path would let a drive-by request point a
// project at the user's Documents") applied to references. Non-browser
// clients (the unit tests, curl) carry neither header and are the machine's
// own processes, which already have the files.
//
// 🚨 `fetch` resolves for every status here. Every error is a JSON body with
// `error` and, where a caller branches on it, a `code`.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ffmpeg = require('./ffmpeg.cjs');
const { resolveContainedFilePath } = require('./pathContainment.cjs');

// ── Media tables ──────────────────────────────────────────────────────────────
// The renderer carries the same tables in src/tools/rabbit_v0.1.0/bins/binMedia.js
// and binMedia.test.js asserts the two agree (the S40 pattern for
// VIDEO_EXTENSIONS: ESM in one process, CJS in another, agreement by test).
const VIDEO_EXTS = new Set([
  '.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.wmv', '.flv', '.mpg',
  '.mpeg', '.m2v', '.mts', '.m2ts',
  '.mxf', '.r3d', '.ari', '.arri', '.braw', '.dnx', '.dnxhd', '.dnxhr',
]);
const STILL_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.tiff', '.tif', '.bmp', '.avif', '.heic', '.heif',
]);
const AUDIO_EXTS = new Set(['.wav', '.bwf', '.aif', '.aiff', '.mp3', '.flac', '.m4a', '.ogg', '.aac', '.wma']);
const GRAPHIC_EXTS = new Set(['.psd', '.psb', '.ai', '.svg', '.eps', '.indd', '.afdesign', '.sketch', '.fig']);
const VFX_EXTS = new Set(['.exr', '.dpx', '.tga', '.hdr', '.cin']);
const DOC_EXTS = new Set(['.pdf', '.txt', '.md', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.rtf', '.pages', '.numbers']);
// A folder whose files all share a prefix and a frame number is ONE item.
const SEQUENCE_EXTS = new Set(['.exr', '.dpx', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.tga']);
// Chromium decodes these natively — the only ones the stream route can PLAY
// (as opposed to serve); the renderer decides the notice, this decides nothing.
const BROWSER_VIDEO_EXTS = new Set(['.mp4', '.m4v', '.webm']);

const MEDIA_TYPES = ['video', 'still', 'sequence', 'audio', 'graphic', 'vfx', 'document', 'other'];
const REVIEW_FLAGS = ['unflagged', 'select', 'reject'];
const COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'];
const BIN_KINDS = ['footage', 'audio', 'stills', 'graphics', 'vfx', 'selects', 'other'];

const MIME_BY_EXT = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.wmv': 'video/x-ms-wmv',
  '.mpg': 'video/mpeg', '.mpeg': 'video/mpeg', '.mts': 'video/mp2t', '.m2ts': 'video/mp2t',
  '.mxf': 'application/mxf',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.tiff': 'image/tiff', '.tif': 'image/tiff', '.bmp': 'image/bmp',
  '.avif': 'image/avif', '.heic': 'image/heic', '.heif': 'image/heif', '.svg': 'image/svg+xml',
  '.psd': 'image/vnd.adobe.photoshop', '.exr': 'image/x-exr', '.dpx': 'image/x-dpx',
  '.wav': 'audio/wav', '.bwf': 'audio/wav', '.aif': 'audio/aiff', '.aiff': 'audio/aiff',
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.aac': 'audio/aac', '.pdf': 'application/pdf', '.txt': 'text/plain', '.csv': 'text/csv',
};

function extOf(name) {
  const e = path.extname(String(name || '')).toLowerCase();
  return /^\.[a-z0-9]{1,12}$/.test(e) ? e : '';
}
function guessMediaType(ext) {
  const e = String(ext || '').toLowerCase();
  if (VIDEO_EXTS.has(e)) return 'video';
  if (STILL_EXTS.has(e)) return 'still';
  if (AUDIO_EXTS.has(e)) return 'audio';
  if (VFX_EXTS.has(e)) return 'vfx';
  if (GRAPHIC_EXTS.has(e)) return 'graphic';
  if (DOC_EXTS.has(e)) return 'document';
  return 'other';
}
function guessMime(ext) { return MIME_BY_EXT[String(ext || '').toLowerCase()] || null; }

// Normalised key for "is this the same file": resolved, lower-cased on
// Windows where the filesystem is case-insensitive. Instances of one file share
// it, which is how relink and offline state reach every instance at once.
function pathKey(p) {
  const r = path.resolve(String(p || ''));
  return process.platform === 'win32' ? r.toLowerCase() : r;
}
function thumbKeyFor(sourcePath) {
  return 'bin-' + crypto.createHash('sha1').update(pathKey(sourcePath)).digest('hex') + '.jpg';
}

// ── Filename suggestions ──────────────────────────────────────────────────────
//
// docs/BINS_DESIGN.md §3: the NLEs read an ALE, they do not parse names — so
// this is a SUGGESTION the add dialog shows and applies only when accepted.
// Shapes it knows, from the research:
//   12A_3_T4_A         → slate 12A, shot 3, take 4, camera A
//   SC12A_SH03_TK04    → scene 12A, shot 3, take 4
//   24A-3, 24A_T3      → slate 24A, take 3
//   Scene12_Shot3_Take4
//   A001C003_240612…   → camera A, roll A001 (ARRI / RED / Canon clip names)
//   …_PU / _SER / _MOS → take modifier
//   20260612 / 2026-06-12 → shoot day
const CAMERA_CLIP_RE = /^([A-Ha-h])(\d{3})[_-]?[Cc](\d{3,4})/;
const DATE_RE = /(?:^|[_\-\s.])((?:19|20)\d{2})[-_]?(\d{2})[-_]?(\d{2})(?=$|[_\-\s.])/;

function parseNameSuggestions(fileName) {
  const base = String(fileName || '').replace(/\.[A-Za-z0-9]{1,12}$/, '');
  const out = { slate: null, scene_hint: null, shot_hint: null, take_number: null, take_modifier: null, camera: null, roll: null, shoot_day: null };
  if (!base) return out;
  const cam = CAMERA_CLIP_RE.exec(base);
  if (cam) {
    out.camera = cam[1].toUpperCase();
    out.roll = `${cam[1].toUpperCase()}${cam[2]}`;
    // ARRI / RED clip names carry the day as YYMMDD right after the clip
    // number (A001C003_240612_R1AB). Six bare digits are only read as a date
    // INSIDE a camera clip name, where the position makes them unambiguous.
    const ymd = /^[A-Ha-h]\d{3}[_-]?[Cc]\d{3,4}[_-](\d{2})(\d{2})(\d{2})(?=[_-]|$)/.exec(base);
    if (ymd) {
      const m = Number(ymd[2]); const d = Number(ymd[3]);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) out.shoot_day = `20${ymd[1]}-${ymd[2]}-${ymd[3]}`;
    }
  }
  const date = DATE_RE.exec(base);
  if (date) {
    const m = Number(date[2]); const d = Number(date[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) out.shoot_day = `${date[1]}-${date[2]}-${date[3]}`;
  }
  const tokens = base.split(/[_\-\s.]+/).filter(Boolean);
  let sceneIdx = -1;
  let explicitTake = false;
  tokens.forEach((raw, i) => {
    const t = raw.toLowerCase();
    let m;
    if ((m = /^(?:sc|scene)(\d{1,4}[a-z]{0,2})$/.exec(t)) && out.scene_hint == null) { out.scene_hint = m[1].toUpperCase(); sceneIdx = i; return; }
    if ((m = /^(?:sh|shot)(\d{1,4})$/.exec(t)) && out.shot_hint == null) { out.shot_hint = String(Number(m[1])); return; }
    if ((m = /^(?:t|tk|take)(\d{1,3})$/.exec(t)) && out.take_number == null) { out.take_number = Number(m[1]); explicitTake = true; return; }
    if (/^(pu|ser|mos)$/.test(t) && out.take_modifier == null) { out.take_modifier = t.toUpperCase(); return; }
    if (/^[a-h]$/.test(t) && i > 0 && out.camera == null) { out.camera = t.toUpperCase(); return; }
    if (/^[a-h]\d{3}$/.test(t) && out.roll == null && !cam) { out.roll = t.toUpperCase(); return; }
    // A bare scene+setup token: digits with up to two trailing letters, e.g.
    // 12A. Only the FIRST such token, and never one that is the camera roll.
    if ((m = /^(\d{1,4})([a-z]{1,2})$/.exec(t)) && out.scene_hint == null && !cam) { out.scene_hint = (m[1] + m[2]).toUpperCase(); sceneIdx = i; return; }
    if (/^\d{1,4}$/.test(t) && out.scene_hint == null && i === 0 && !cam && !date) { out.scene_hint = t; sceneIdx = i; return; }
  });
  // A bare number right after the scene token: the shot when an explicit take
  // follows (12A_3_T4), otherwise the take (24A-3).
  if (sceneIdx >= 0 && sceneIdx + 1 < tokens.length) {
    const next = tokens[sceneIdx + 1];
    if (/^\d{1,3}$/.test(next)) {
      if (explicitTake && out.shot_hint == null) out.shot_hint = String(Number(next));
      else if (!explicitTake && out.take_number == null) out.take_number = Number(next);
    }
  }
  if (out.scene_hint) out.slate = out.scene_hint;
  return out;
}

// ── Frame sequences ───────────────────────────────────────────────────────────
const FRAME_RE = /^(.*?)([._-]?)(\d{2,8})(\.[A-Za-z0-9]{1,5})$/;

/**
 * If `dir` holds a numbered frame sequence, describe it; else null. A
 * sequence is at least two files, all sharing one prefix and one extension
 * from SEQUENCE_EXTS, with nothing else but dotfiles in the folder.
 */
function detectSequence(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  const files = entries.filter(e => e.isFile() && !e.name.startsWith('.'));
  if (files.length < 2) return null;
  if (entries.some(e => e.isDirectory() && !e.name.startsWith('.'))) return null;
  let prefix = null; let sep = ''; let ext = null; let width = null;
  const frames = [];
  for (const f of files) {
    const m = FRAME_RE.exec(f.name);
    if (!m) return null;
    const e = m[4].toLowerCase();
    if (!SEQUENCE_EXTS.has(e)) return null;
    if (prefix === null) { prefix = m[1]; sep = m[2]; ext = e; width = m[3].length; }
    else if (m[1] !== prefix || e !== ext) return null;
    frames.push({ name: f.name, n: Number(m[3]) });
  }
  frames.sort((a, b) => a.n - b.n);
  let sizeBytes = 0;
  let mtime = 0;
  for (const f of frames) {
    try { const st = fs.statSync(path.join(dir, f.name)); sizeBytes += st.size; if (st.mtimeMs > mtime) mtime = st.mtimeMs; } catch { /* counted anyway */ }
  }
  const first = frames[0].n; const last = frames[frames.length - 1].n;
  return {
    pattern: `${prefix}${sep}${'#'.repeat(width)}${ext}`,
    ext,
    frame_count: frames.length,
    first_frame: first,
    last_frame: last,
    missing_frames: Math.max(0, (last - first + 1) - frames.length),
    middle_frame_path: path.join(dir, frames[Math.floor(frames.length / 2)].name),
    size_bytes: sizeBytes,
    mtime: mtime ? new Date(mtime).toISOString() : null,
  };
}

// Bounded walk shared by prepare (a dropped or picked folder) and relink-scan.
function walkFolder(root, { maxEntries = 20000, maxDepth = 12, onFile, onDir } = {}) {
  let count = 0; let truncated = false;
  const visited = new Set();
  try { visited.add(fs.realpathSync(root).toLowerCase()); } catch { /* still walk */ }
  const walk = (dir, rel, depth) => {
    if (depth > maxDepth || count >= maxEntries) { truncated = true; return; }
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      if (count >= maxEntries) { truncated = true; return; }
      const abs = path.join(dir, entry.name);
      const rp = rel ? `${rel}/${entry.name}` : entry.name;
      let isDir = entry.isDirectory(); let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try { const st = fs.statSync(abs); isDir = st.isDirectory(); isFile = st.isFile(); } catch { continue; }
      }
      if (isDir) {
        let real; try { real = fs.realpathSync(abs).toLowerCase(); } catch { continue; }
        if (visited.has(real)) continue;
        visited.add(real);
        count++;
        const descend = onDir ? onDir(abs, rp) !== false : true;
        if (descend) walk(abs, rp, depth + 1);
      } else if (isFile) {
        count++;
        onFile(abs, rp, entry.name);
      }
    }
  };
  walk(root, '', 0);
  return { truncated };
}

// ── The mount ────────────────────────────────────────────────────────────────

function mountRabbitBins(expressApp, deps) {
  const {
    readRabbitBundle, writeRabbitBundle, rabbitTouch, rabbitUpsertInto, rabbitRemoveFrom, rabbitNotFound,
    getThumbCacheDir, generateVideoThumbOnce, safeMediaContentType,
    userAuthorizedDirs, dialog, getMainWindow, shell,
  } = deps;
  for (const k of ['readRabbitBundle', 'writeRabbitBundle', 'rabbitTouch', 'rabbitUpsertInto', 'rabbitRemoveFrom', 'rabbitNotFound', 'getThumbCacheDir', 'generateVideoThumbOnce', 'safeMediaContentType']) {
    if (typeof deps[k] !== 'function') throw new Error(`mountRabbitBins: missing helper ${k}`);
  }
  const authorized = userAuthorizedDirs || new Set();
  const P = '/api/rabbit/projects/:projectId';
  const now = () => new Date().toISOString();

  // ── the gate ──
  function isSameOrigin(req) {
    const site = req.headers['sec-fetch-site'];
    if (site) return site === 'same-origin';
    const origin = req.headers.origin;
    if (!origin) return true; // no browser sent this
    const host = req.headers.host;
    return host ? (origin === `http://${host}` || origin === `https://${host}`) : false;
  }
  function gate(req, res, next) {
    if (!isSameOrigin(req)) return res.status(403).json({ error: 'bins routes answer WILSON only', code: 'cross_origin' });
    next();
  }
  expressApp.use(`${P}/bins`, gate);
  expressApp.use(`${P}/bin-files`, gate);

  function ensure(bundle) {
    if (!bundle.bins) bundle.bins = [];
    if (!bundle.binFiles) bundle.binFiles = [];
    if (!bundle.binRoots) bundle.binRoots = [];
    return bundle;
  }
  function load(req, res) {
    const bundle = readRabbitBundle(req.params.projectId);
    if (!bundle) { rabbitNotFound(res); return null; }
    return ensure(bundle);
  }
  function exists(p) { try { return !!p && fs.existsSync(p); } catch { return false; } }
  function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
  function isFile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }
  function isAbs(p) { return typeof p === 'string' && p.length > 0 && path.isAbsolute(p); }
  function withOnline(row) {
    const p = row.source_path;
    const online = row.is_sequence ? isDir(p) : isFile(p);
    return { ...row, online };
  }
  function rememberRoot(bundle, projectId, dir, label) {
    if (!dir) return;
    const key = pathKey(dir);
    authorized.add(key);
    // A root already covered by a recorded ancestor is not recorded again.
    const covered = bundle.binRoots.some(r => {
      const rk = pathKey(r.path);
      return rk === key || (key.startsWith(rk + path.sep));
    });
    if (covered) {
      const hit = bundle.binRoots.find(r => pathKey(r.path) === key);
      if (hit) hit.last_seen_at = now();
      return;
    }
    bundle.binRoots.push({ id: crypto.randomUUID(), project_id: projectId, path: path.resolve(dir), label: label || path.basename(dir), added_at: now(), last_seen_at: now() });
  }
  function isAuthorizedDir(bundle, p) {
    if (!isAbs(p)) return false;
    const key = pathKey(p);
    if (authorized.has(key)) return true;
    for (const a of authorized) if (key.startsWith(a + path.sep)) return true;
    return bundle.binRoots.some(r => { const rk = pathKey(r.path); return key === rk || key.startsWith(rk + path.sep); });
  }
  function binDescendants(bundle, binId) {
    const out = new Set([binId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const b of bundle.bins) {
        if (b.parent_bin_id && out.has(b.parent_bin_id) && !out.has(b.id)) { out.add(b.id); grew = true; }
      }
    }
    return out;
  }
  function wouldCycle(bundle, binId, parentId) {
    if (!parentId) return false;
    if (parentId === binId) return true;
    return binDescendants(bundle, binId).has(parentId);
  }
  function nextSortOrder(rows) {
    return rows.reduce((m, r) => Math.max(m, Number(r.sort_order) || 0), -1) + 1;
  }

  // ── Bins ──────────────────────────────────────────────────────────────────
  expressApp.get(`${P}/bins`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    res.json({
      bins: bundle.bins,
      binFiles: bundle.binFiles.map(withOnline),
      binRoots: bundle.binRoots,
      ffmpeg: ffmpeg.hasFfmpeg(),
    });
  });

  expressApp.post(`${P}/bins`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const body = req.body || {};
    const name = String(body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    if (body.parent_bin_id && !bundle.bins.some(b => b.id === body.parent_bin_id)) {
      return res.status(400).json({ error: 'parent bin not found' });
    }
    if (body.id && wouldCycle(bundle, body.id, body.parent_bin_id)) {
      return res.status(400).json({ error: 'a bin cannot be inside itself' });
    }
    const siblings = bundle.bins.filter(b => (b.parent_bin_id || null) === (body.parent_bin_id || null));
    const row = rabbitTouch({
      id: body.id, project_id: req.params.projectId, workspace_id: null,
      name, description: String(body.description || ''),
      kind: BIN_KINDS.includes(body.kind) ? body.kind : 'other',
      color: COLORS.includes(body.color) ? body.color : null,
      parent_bin_id: body.parent_bin_id || null,
      sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : nextSortOrder(siblings),
      created_by: null, updated_by: null,
    });
    const result = rabbitUpsertInto(bundle.bins, row);
    writeRabbitBundle(req.params.projectId, bundle);
    res.json(result);
  });

  expressApp.patch(`${P}/bins/:id`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const idx = bundle.bins.findIndex(b => b.id === req.params.id);
    if (idx < 0) return rabbitNotFound(res, 'bin');
    const { id: _id, project_id: _p, created_at: _c, ...patch } = req.body || {};
    if ('name' in patch) {
      patch.name = String(patch.name || '').trim();
      if (!patch.name) return res.status(400).json({ error: 'name required' });
    }
    if ('kind' in patch && !BIN_KINDS.includes(patch.kind)) patch.kind = 'other';
    if ('color' in patch && patch.color != null && !COLORS.includes(patch.color)) return res.status(400).json({ error: 'unknown color' });
    if ('parent_bin_id' in patch) {
      patch.parent_bin_id = patch.parent_bin_id || null;
      if (patch.parent_bin_id && !bundle.bins.some(b => b.id === patch.parent_bin_id)) return res.status(400).json({ error: 'parent bin not found' });
      if (wouldCycle(bundle, req.params.id, patch.parent_bin_id)) return res.status(400).json({ error: 'a bin cannot be inside itself' });
    }
    bundle.bins[idx] = { ...bundle.bins[idx], ...patch, id: req.params.id, updated_at: now() };
    writeRabbitBundle(req.params.projectId, bundle);
    res.json(bundle.bins[idx]);
  });

  // DELETE ?mode=move&target=<binId> moves the files of the bin AND its
  // descendants to `target`; ?mode=remove removes them. The response carries
  // everything removed so the renderer can push an undo entry that restores
  // it through POST bins + POST bin-files/restore.
  expressApp.delete(`${P}/bins/:id`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const bin = bundle.bins.find(b => b.id === req.params.id);
    if (!bin) return rabbitNotFound(res, 'bin');
    const ids = binDescendants(bundle, bin.id);
    const mode = req.query.mode === 'move' ? 'move' : 'remove';
    const target = req.query.target ? String(req.query.target) : null;
    if (mode === 'move') {
      if (!target || ids.has(target) || !bundle.bins.some(b => b.id === target)) {
        return res.status(400).json({ error: 'target bin must exist and be outside the deleted bin' });
      }
    }
    const removedBins = bundle.bins.filter(b => ids.has(b.id));
    const affected = bundle.binFiles.filter(f => ids.has(f.bin_id));
    const movedFiles = []; const removedFiles = [];
    if (mode === 'move') {
      let order = nextSortOrder(bundle.binFiles.filter(f => f.bin_id === target));
      for (const f of affected) { movedFiles.push({ id: f.id, from: f.bin_id, sort_order: f.sort_order }); f.bin_id = target; f.sort_order = order++; f.updated_at = now(); }
    } else {
      for (const f of affected) removedFiles.push(f);
      bundle.binFiles = bundle.binFiles.filter(f => !ids.has(f.bin_id));
    }
    bundle.bins = bundle.bins.filter(b => !ids.has(b.id));
    writeRabbitBundle(req.params.projectId, bundle);
    res.json({ ok: true, removedBins, movedFiles, removedFiles });
  });

  expressApp.post(`${P}/bins/reorder`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const order = Array.isArray(req.body?.order) ? req.body.order : null;
    if (!order) return res.status(400).json({ error: 'order required' });
    for (const o of order) {
      const b = bundle.bins.find(x => x.id === o.id);
      if (!b) return res.status(400).json({ error: `bin ${o.id} not found` });
      const parent = o.parent_bin_id || null;
      if (parent && !bundle.bins.some(x => x.id === parent)) return res.status(400).json({ error: 'parent bin not found' });
    }
    // Apply parents first, then check every moved bin for a cycle.
    const before = bundle.bins.map(b => ({ ...b }));
    for (const o of order) {
      const b = bundle.bins.find(x => x.id === o.id);
      b.parent_bin_id = o.parent_bin_id || null;
      b.sort_order = Number(o.sort_order) || 0;
      b.updated_at = now();
    }
    for (const o of order) {
      const b = bundle.bins.find(x => x.id === o.id);
      if (b.parent_bin_id && binDescendants(bundle, b.id).has(b.parent_bin_id)) {
        bundle.bins = before;
        return res.status(400).json({ error: 'a bin cannot be inside itself' });
      }
    }
    writeRabbitBundle(req.params.projectId, bundle);
    res.json({ ok: true, bins: bundle.bins });
  });

  // ── Picking (the dialogs open HERE, in the main process) ──────────────────
  expressApp.post(`${P}/bins/pick-files`, async (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const win = getMainWindow ? getMainWindow() : null;
    if (!dialog || !win) return res.status(503).json({ error: 'no window to open a dialog from', code: 'no_window' });
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      title: 'Add files to the bin',
    });
    if (result.canceled) return res.json({ paths: [], canceled: true });
    for (const p of result.filePaths) authorized.add(pathKey(path.dirname(p)));
    res.json({ paths: result.filePaths, canceled: false });
  });

  expressApp.post(`${P}/bins/pick-folder`, async (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const win = getMainWindow ? getMainWindow() : null;
    if (!dialog || !win) return res.status(503).json({ error: 'no window to open a dialog from', code: 'no_window' });
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: String(req.body?.title || 'Add a folder to the bin'),
    });
    if (result.canceled || !result.filePaths.length) return res.json({ path: null, canceled: true });
    authorized.add(pathKey(result.filePaths[0]));
    res.json({ path: result.filePaths[0], canceled: false });
  });

  // ── Prepare: paths → a plan the add dialog shows ──────────────────────────
  function describeFile(bundle, abs, name, subBin) {
    let st; try { st = fs.statSync(abs); } catch { return { kind: 'file', source_path: abs, original_name: name, status: 'missing' }; }
    const ext = extOf(name);
    const key = pathKey(abs);
    const samePath = bundle.binFiles.find(f => pathKey(f.source_path) === key);
    const sameNameSize = !samePath && bundle.binFiles.find(f => !f.is_sequence && String(f.original_name).toLowerCase() === name.toLowerCase() && Number(f.size_bytes) === st.size);
    const dup = samePath || sameNameSize;
    return {
      kind: 'file', status: 'ok',
      source_path: abs, original_name: name, extension: ext, mime_type: guessMime(ext),
      size_bytes: st.size, mtime: st.mtime.toISOString(),
      media_type: guessMediaType(ext),
      display_name: name.replace(/\.[A-Za-z0-9]{1,12}$/, ''),
      suggestions: parseNameSuggestions(name),
      duplicate: dup ? {
        reason: samePath ? 'same_path' : 'same_name_size',
        existing_id: dup.id, existing_bin_id: dup.bin_id,
        existing_bin_name: (bundle.bins.find(b => b.id === dup.bin_id) || {}).name || null,
      } : null,
      sub_bin: subBin || null,
    };
  }
  function describeSequence(bundle, dir, seq, subBin) {
    const name = path.basename(dir);
    const key = pathKey(dir);
    const samePath = bundle.binFiles.find(f => pathKey(f.source_path) === key);
    return {
      kind: 'sequence', status: 'ok',
      source_path: dir, original_name: name, extension: seq.ext, mime_type: guessMime(seq.ext),
      size_bytes: seq.size_bytes, mtime: seq.mtime,
      media_type: 'sequence',
      display_name: name,
      sequence: { pattern: seq.pattern, frame_count: seq.frame_count, first_frame: seq.first_frame, last_frame: seq.last_frame, missing_frames: seq.missing_frames },
      suggestions: parseNameSuggestions(name),
      duplicate: samePath ? { reason: 'same_path', existing_id: samePath.id, existing_bin_id: samePath.bin_id, existing_bin_name: (bundle.bins.find(b => b.id === samePath.bin_id) || {}).name || null } : null,
      sub_bin: subBin || null,
    };
  }

  expressApp.post(`${P}/bins/prepare`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const paths = Array.isArray(req.body?.paths) ? req.body.paths.filter(isAbs) : [];
    if (!paths.length) return res.status(400).json({ error: 'paths required (absolute)' });
    const items = []; const folders = []; let truncated = false;
    const seen = new Set();
    const push = (item) => { const k = pathKey(item.source_path); if (seen.has(k)) return; seen.add(k); items.push(item); };
    for (const p of paths) {
      if (isFile(p)) { push(describeFile(bundle, p, path.basename(p), null)); continue; }
      if (!isDir(p)) { push({ kind: 'file', source_path: p, original_name: path.basename(p), status: 'missing' }); continue; }
      const seq = detectSequence(p);
      if (seq) { push(describeSequence(bundle, p, seq, null)); continue; }
      folders.push({ path: p, name: path.basename(p) });
      const r = walkFolder(p, {
        maxEntries: 5000, maxDepth: 8,
        onDir: (abs, rel) => {
          const s = detectSequence(abs);
          if (s) { push(describeSequence(bundle, abs, s, path.dirname(rel) === '.' ? null : path.dirname(rel).split(path.sep).join('/'))); return false; }
          return true;
        },
        onFile: (abs, rel, name) => {
          const sub = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : null;
          push(describeFile(bundle, abs, name, sub));
        },
      });
      if (r.truncated) truncated = true;
    }
    res.json({ items, folders, truncated });
  });

  // ── Add: confirmed items → rows (and sub-bins) ────────────────────────────
  const FIELDS = ['display_name', 'media_type', 'tags', 'scene_id', 'shot_id', 'slate', 'take_number', 'take_modifier', 'camera', 'roll', 'shoot_day', 'description', 'notes', 'review_flag', 'circled', 'color'];

  function cleanPatch(patch) {
    const out = {};
    for (const k of FIELDS) if (k in patch) out[k] = patch[k];
    if ('display_name' in out) out.display_name = String(out.display_name || '').trim();
    if ('media_type' in out && !MEDIA_TYPES.includes(out.media_type)) out.media_type = 'other';
    if ('tags' in out) out.tags = Array.isArray(out.tags) ? out.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 50) : [];
    if ('review_flag' in out && !REVIEW_FLAGS.includes(out.review_flag)) out.review_flag = 'unflagged';
    if ('circled' in out) out.circled = !!out.circled;
    if ('color' in out && out.color != null && !COLORS.includes(out.color)) out.color = null;
    if ('take_number' in out) { const n = Number(out.take_number); out.take_number = Number.isFinite(n) && n > 0 ? Math.floor(n) : null; }
    for (const k of ['slate', 'take_modifier', 'camera', 'roll', 'description', 'notes']) if (k in out) out[k] = out[k] == null ? null : String(out[k]);
    if ('shoot_day' in out) out.shoot_day = out.shoot_day && /^\d{4}-\d{2}-\d{2}$/.test(String(out.shoot_day)) ? String(out.shoot_day) : null;
    if ('scene_id' in out) out.scene_id = out.scene_id || null;
    if ('shot_id' in out) out.shot_id = out.shot_id || null;
    return out;
  }
  function ensureSubBin(bundle, projectId, parentId, relPath, created) {
    let parent = parentId;
    for (const seg of relPath.split('/').filter(Boolean)) {
      let bin = bundle.bins.find(b => (b.parent_bin_id || null) === (parent || null) && b.name.toLowerCase() === seg.toLowerCase());
      if (!bin) {
        bin = rabbitTouch({ id: undefined, project_id: projectId, workspace_id: null, name: seg, description: '', kind: 'footage', color: null, parent_bin_id: parent || null, sort_order: nextSortOrder(bundle.bins.filter(b => (b.parent_bin_id || null) === (parent || null))), created_by: null, updated_by: null });
        bundle.bins.push(bin); created.push(bin);
      }
      parent = bin.id;
    }
    return parent;
  }

  expressApp.post(`${P}/bins/:binId/files`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const bin = bundle.bins.find(b => b.id === req.params.binId);
    if (!bin) return rabbitNotFound(res, 'bin');
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: 'items required' });
    const createSubBins = req.body?.createSubBins !== false;
    const created = []; const createdBins = []; const results = [];
    const counters = new Map();
    const orderFor = (binId) => {
      if (!counters.has(binId)) counters.set(binId, nextSortOrder(bundle.binFiles.filter(f => f.bin_id === binId)));
      const n = counters.get(binId); counters.set(binId, n + 1); return n;
    };
    for (const it of items) {
      const src = it?.source_path;
      if (!isAbs(src)) { results.push({ source_path: src, status: 'invalid' }); continue; }
      const isSeq = it.kind === 'sequence';
      let st; try { st = fs.statSync(src); } catch { results.push({ source_path: src, status: 'missing' }); continue; }
      if (isSeq ? !st.isDirectory() : !st.isFile()) { results.push({ source_path: src, status: 'missing' }); continue; }
      let seq = null;
      if (isSeq) { seq = detectSequence(src); if (!seq) { results.push({ source_path: src, status: 'not_a_sequence' }); continue; } }
      const name = path.basename(src);
      const ext = isSeq ? seq.ext : extOf(name);
      const targetBin = (createSubBins && it.sub_bin) ? ensureSubBin(bundle, req.params.projectId, bin.id, String(it.sub_bin), createdBins) : bin.id;
      const fields = cleanPatch(it);
      const row = rabbitTouch({
        id: undefined, project_id: req.params.projectId, bin_id: targetBin,
        display_name: fields.display_name || (isSeq ? name : name.replace(/\.[A-Za-z0-9]{1,12}$/, '')),
        original_name: name, extension: ext, mime_type: guessMime(ext),
        source_path: path.resolve(src), is_sequence: isSeq,
        sequence_pattern: isSeq ? seq.pattern : null,
        frame_count: isSeq ? seq.frame_count : null,
        size_bytes: isSeq ? seq.size_bytes : st.size,
        mtime: isSeq ? seq.mtime : st.mtime.toISOString(),
        media_type: fields.media_type || (isSeq ? 'sequence' : guessMediaType(ext)),
        tags: fields.tags || [],
        scene_id: fields.scene_id || null, shot_id: fields.shot_id || null,
        slate: fields.slate || null, take_number: fields.take_number ?? null, take_modifier: fields.take_modifier || null,
        camera: fields.camera || null, roll: fields.roll || null, shoot_day: fields.shoot_day || null,
        description: fields.description || '', notes: fields.notes || '',
        review_flag: fields.review_flag || 'unflagged', circled: !!fields.circled, color: fields.color || null,
        duration_sec: null, width: null, height: null, fps: null, codec: null, timecode_start: null,
        probe_status: 'pending',
        sort_order: orderFor(targetBin),
        added_by: null, added_at: now(),
      });
      bundle.binFiles.push(row);
      created.push(row);
      results.push({ source_path: src, status: 'added', id: row.id, bin_id: targetBin });
      rememberRoot(bundle, req.params.projectId, isSeq ? path.dirname(src) : path.dirname(src));
    }
    writeRabbitBundle(req.params.projectId, bundle);
    res.json({ created: created.map(withOnline), bins: createdBins, results });
  });

  // ── Bin-file edits ────────────────────────────────────────────────────────
  expressApp.patch(`${P}/bin-files/:id`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const idx = bundle.binFiles.findIndex(f => f.id === req.params.id);
    if (idx < 0) return rabbitNotFound(res, 'bin-file');
    const body = req.body || {};
    const patch = cleanPatch(body);
    // The renderer fallback (no ffmpeg) may report what a <video> decoded.
    for (const k of ['duration_sec', 'width', 'height', 'fps']) {
      if (k in body) { const n = Number(body[k]); patch[k] = Number.isFinite(n) && n > 0 ? n : null; }
    }
    if ('probe_status' in body && ['pending', 'done', 'failed', 'unavailable'].includes(body.probe_status)) patch.probe_status = body.probe_status;
    if ('bin_id' in body) {
      if (!bundle.bins.some(b => b.id === body.bin_id)) return res.status(400).json({ error: 'bin not found' });
      patch.bin_id = body.bin_id;
    }
    if ('sort_order' in body) patch.sort_order = Number(body.sort_order) || 0;
    bundle.binFiles[idx] = { ...bundle.binFiles[idx], ...patch, id: req.params.id, updated_at: now() };
    writeRabbitBundle(req.params.projectId, bundle);
    res.json(withOnline(bundle.binFiles[idx]));
  });

  function idsOf(body) { return Array.isArray(body?.ids) ? body.ids.map(String) : []; }

  expressApp.post(`${P}/bin-files/bulk`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const ids = new Set(idsOf(req.body));
    if (!ids.size) return res.status(400).json({ error: 'ids required' });
    const patch = cleanPatch(req.body?.patch || {});
    const updated = [];
    for (let i = 0; i < bundle.binFiles.length; i++) {
      if (!ids.has(bundle.binFiles[i].id)) continue;
      bundle.binFiles[i] = { ...bundle.binFiles[i], ...patch, updated_at: now() };
      updated.push(withOnline(bundle.binFiles[i]));
    }
    writeRabbitBundle(req.params.projectId, bundle);
    res.json({ updated });
  });

  expressApp.post(`${P}/bin-files/move`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const ids = idsOf(req.body); const binId = req.body?.binId;
    if (!ids.length) return res.status(400).json({ error: 'ids required' });
    if (!bundle.bins.some(b => b.id === binId)) return res.status(400).json({ error: 'bin not found' });
    let order = nextSortOrder(bundle.binFiles.filter(f => f.bin_id === binId));
    const moved = [];
    for (const id of ids) {
      const f = bundle.binFiles.find(x => x.id === id);
      if (!f) continue;
      moved.push({ id: f.id, from: f.bin_id, sort_order: f.sort_order });
      f.bin_id = binId; f.sort_order = order++; f.updated_at = now();
    }
    writeRabbitBundle(req.params.projectId, bundle);
    res.json({ moved, binFiles: bundle.binFiles.filter(f => ids.includes(f.id)).map(withOnline) });
  });

  // An INSTANCE: a new row, same source, its own name / flag / colour / notes.
  expressApp.post(`${P}/bin-files/copy`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const ids = idsOf(req.body); const binId = req.body?.binId;
    if (!ids.length) return res.status(400).json({ error: 'ids required' });
    if (!bundle.bins.some(b => b.id === binId)) return res.status(400).json({ error: 'bin not found' });
    let order = nextSortOrder(bundle.binFiles.filter(f => f.bin_id === binId));
    const created = [];
    for (const id of ids) {
      const f = bundle.binFiles.find(x => x.id === id);
      if (!f) continue;
      const row = { ...f, id: crypto.randomUUID(), bin_id: binId, sort_order: order++, added_at: now(), created_at: now(), updated_at: now() };
      bundle.binFiles.push(row); created.push(withOnline(row));
    }
    writeRabbitBundle(req.params.projectId, bundle);
    res.json({ created });
  });

  // Removes the REFERENCE only; the file on disk is the user's. Returns the
  // rows so the renderer can restore them (undo) verbatim.
  expressApp.post(`${P}/bin-files/remove`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const ids = new Set(idsOf(req.body));
    if (!ids.size) return res.status(400).json({ error: 'ids required' });
    const removed = bundle.binFiles.filter(f => ids.has(f.id));
    bundle.binFiles = bundle.binFiles.filter(f => !ids.has(f.id));
    writeRabbitBundle(req.params.projectId, bundle);
    res.json({ removed });
  });

  expressApp.post(`${P}/bin-files/restore`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'rows required' });
    const restored = [];
    for (const r of rows) {
      if (!r || typeof r !== 'object' || !r.id || !isAbs(r.source_path)) continue;
      if (!bundle.bins.some(b => b.id === r.bin_id)) continue;
      const { online: _o, ...clean } = r;
      const row = { ...clean, project_id: req.params.projectId, updated_at: now() };
      rabbitUpsertInto(bundle.binFiles, row);
      restored.push(withOnline(row));
    }
    writeRabbitBundle(req.params.projectId, bundle);
    res.json({ restored });
  });

  expressApp.post(`${P}/bin-files/reorder`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const ids = idsOf(req.body);
    if (!ids.length) return res.status(400).json({ error: 'ids required' });
    ids.forEach((id, i) => { const f = bundle.binFiles.find(x => x.id === id); if (f) { f.sort_order = i; f.updated_at = now(); } });
    writeRabbitBundle(req.params.projectId, bundle);
    res.json({ ok: true });
  });

  // ── Probe: the technical columns ──────────────────────────────────────────
  async function probeRow(bundle, row) {
    const patch = {};
    const fps = Number(bundle.project?.fps) > 0 ? Number(bundle.project.fps) : 24;
    let target = row.source_path;
    if (row.is_sequence) {
      const seq = detectSequence(row.source_path);
      if (!seq) return { probe_status: 'failed' };
      patch.frame_count = seq.frame_count; patch.sequence_pattern = seq.pattern; patch.size_bytes = seq.size_bytes;
      patch.fps = fps; patch.duration_sec = seq.frame_count / fps;
      target = seq.middle_frame_path;
    }
    const mt = row.media_type;
    if (mt === 'still' || (row.is_sequence && ['.png', '.jpg', '.jpeg', '.tif', '.tiff'].includes(row.extension))) {
      try {
        const sharp = require('sharp');
        const meta = await sharp(target).metadata();
        if (meta.width) patch.width = meta.width;
        if (meta.height) patch.height = meta.height;
        if (meta.format) patch.codec = String(meta.format);
        if (patch.width) return { ...patch, probe_status: 'done' };
      } catch { /* fall through to ffmpeg */ }
    }
    if (['document', 'other', 'graphic'].includes(mt) && !ffmpeg.hasFfmpeg()) return { ...patch, probe_status: 'unavailable' };
    const r = await ffmpeg.probeMediaInfo(target);
    if (!r.ok) return { ...patch, probe_status: r.reason === 'ffmpeg_missing' ? 'unavailable' : 'failed' };
    const i = r.info;
    if (!row.is_sequence) {
      if (i.duration_sec) patch.duration_sec = i.duration_sec;
      if (i.fps) patch.fps = i.fps;
    }
    if (i.width) patch.width = i.width;
    if (i.height) patch.height = i.height;
    if (i.codec) patch.codec = row.media_type === 'audio' && i.audio_codec ? i.audio_codec : i.codec;
    else if (i.audio_codec) patch.codec = i.audio_codec;
    if (i.timecode_start) patch.timecode_start = i.timecode_start;
    if (i.sample_rate) patch.sample_rate = i.sample_rate;
    if (i.channels) patch.channels = i.channels;
    return { ...patch, probe_status: 'done' };
  }

  expressApp.post(`${P}/bin-files/:id/probe`, async (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const idx = bundle.binFiles.findIndex(f => f.id === req.params.id);
    if (idx < 0) return rabbitNotFound(res, 'bin-file');
    const row = bundle.binFiles[idx];
    if (!(row.is_sequence ? isDir(row.source_path) : isFile(row.source_path))) {
      return res.status(410).json({ error: 'file missing on disk', code: 'offline' });
    }
    let patch;
    try { patch = await probeRow(bundle, row); } catch (e) { patch = { probe_status: 'failed' }; console.warn('bin probe failed:', e?.message || e); }
    // Re-read: the probe awaited, and another request may have written since.
    const fresh = readRabbitBundle(req.params.projectId);
    if (!fresh) return rabbitNotFound(res);
    ensure(fresh);
    const j = fresh.binFiles.findIndex(f => f.id === req.params.id);
    if (j < 0) return rabbitNotFound(res, 'bin-file');
    fresh.binFiles[j] = { ...fresh.binFiles[j], ...patch, updated_at: now() };
    writeRabbitBundle(req.params.projectId, fresh, { touch: false });
    res.json(withOnline(fresh.binFiles[j]));
  });

  // ── Posters ───────────────────────────────────────────────────────────────
  expressApp.get(`${P}/bin-files/:id/thumbnail`, async (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const row = bundle.binFiles.find(f => f.id === req.params.id);
    if (!row) return rabbitNotFound(res, 'bin-file');
    const thumbPath = resolveContainedFilePath(getThumbCacheDir(), thumbKeyFor(row.source_path));
    if (!thumbPath) return res.status(400).json({ error: 'invalid thumbnail path' });
    if (exists(thumbPath)) { res.setHeader('Content-Type', 'image/jpeg'); return res.sendFile(thumbPath); }
    if (!(row.is_sequence ? isDir(row.source_path) : isFile(row.source_path))) {
      return res.status(410).json({ error: 'file missing on disk', code: 'offline' });
    }
    const mt = row.media_type;
    if (mt === 'audio' || mt === 'document' || mt === 'other') {
      return res.status(415).json({ error: 'no poster for this type', code: 'unsupported_type' });
    }
    let source = row.source_path;
    if (row.is_sequence) { const seq = detectSequence(row.source_path); if (!seq) return res.status(422).json({ error: 'not a sequence any more', code: 'no_frame' }); source = seq.middle_frame_path; }
    const stillLike = STILL_EXTS.has(row.extension) && !row.is_sequence;
    if (stillLike || (row.is_sequence && ['.png', '.jpg', '.jpeg', '.tif', '.tiff'].includes(row.extension))) {
      try {
        const sharp = require('sharp');
        await sharp(source).resize(256, 256, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(thumbPath);
        res.setHeader('Content-Type', 'image/jpeg');
        return res.sendFile(thumbPath);
      } catch (err) {
        if (!ffmpeg.hasFfmpeg()) return res.status(422).json({ error: 'could not read the image', code: 'undecodable' });
      }
    }
    if (!ffmpeg.hasFfmpeg()) {
      return res.status(415).json({ error: 'no video decoder installed on this machine', code: 'ffmpeg_missing' });
    }
    try {
      const out = await generateVideoThumbOnce(source, thumbPath);
      if (!out.ok) return res.status(422).json({ error: 'could not decode a frame', code: out.reason || 'no_frame' });
      res.setHeader('Content-Type', 'image/jpeg');
      return res.sendFile(thumbPath);
    } catch (err) {
      console.error('bin thumbnail failed:', err?.message || err);
      return res.status(500).json({ error: 'thumbnail generation failed' });
    }
  });

  // The renderer decoded a frame itself (no ffmpeg): same narrowing as the
  // managed-files route — row must exist, JPEG magic number, size cap, path
  // contained under the cache dir.
  expressApp.post(`${P}/bin-files/:id/thumbnail`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const row = bundle.binFiles.find(f => f.id === req.params.id);
    if (!row) return rabbitNotFound(res, 'bin-file');
    const { base64 } = req.body || {};
    if (!base64) return res.status(400).json({ error: 'base64 required' });
    let buf; try { buf = Buffer.from(base64, 'base64'); } catch { buf = null; }
    if (!buf || buf.length === 0) return res.status(400).json({ error: 'unreadable body' });
    if (buf.length > 262144) return res.status(413).json({ error: 'thumbnail too large' });
    if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) return res.status(415).json({ error: 'not a JPEG' });
    const thumbPath = resolveContainedFilePath(getThumbCacheDir(), thumbKeyFor(row.source_path));
    if (!thumbPath) return res.status(400).json({ error: 'invalid thumbnail path' });
    try { fs.writeFileSync(thumbPath, buf); } catch (err) { return res.status(500).json({ error: 'thumbnail write failed' }); }
    res.json({ ok: true });
  });

  // ── Bytes: Range-capable, allowlisted Content-Type, never a folder ─────────
  expressApp.get(`${P}/bin-files/:id/stream`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const row = bundle.binFiles.find(f => f.id === req.params.id);
    if (!row) return rabbitNotFound(res, 'bin-file');
    let abs = row.source_path;
    if (row.is_sequence) {
      // A sequence streams its middle frame — the preview panel shows one
      // frame and the count; frame-by-frame playback is not in scope.
      const seq = detectSequence(row.source_path);
      if (!seq) return res.status(410).json({ error: 'sequence missing on disk', code: 'offline' });
      abs = seq.middle_frame_path;
    }
    if (!isFile(abs)) return res.status(410).json({ error: 'file missing on disk', code: 'offline' });
    res.setHeader('Content-Type', safeMediaContentType(row.is_sequence ? guessMime(extOf(abs)) : (row.mime_type || guessMime(row.extension))));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(path.resolve(abs), { acceptRanges: true, dotfiles: 'allow', cacheControl: false }, (err) => {
      if (!err) return;
      if (err.code === 'ECONNABORTED' || err.code === 'EPIPE' || res.headersSent) return;
      res.status(err.status || 500).json({ error: 'could not read the file' });
    });
  });

  // ── Open in the default app / reveal in Explorer ─────────────────────────
  // The path comes from the ROW, never from the body; a client can only ask
  // for a file it can already list.
  expressApp.post(`${P}/bin-files/:id/open`, async (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const row = bundle.binFiles.find(f => f.id === req.params.id);
    if (!row) return rabbitNotFound(res, 'bin-file');
    if (!shell) return res.status(503).json({ error: 'no shell in this process', code: 'no_shell' });
    const reveal = req.body?.reveal === true;
    let target = row.source_path;
    if (row.is_sequence && !reveal) { const seq = detectSequence(row.source_path); if (seq) target = seq.middle_frame_path; }
    if (!(row.is_sequence && reveal ? isDir(target) : isFile(target) || isDir(target))) {
      return res.status(410).json({ error: 'file missing on disk', code: 'offline' });
    }
    try {
      if (reveal) { shell.showItemInFolder(target); return res.json({ ok: true }); }
      const err = await shell.openPath(target);
      if (err) return res.status(422).json({ error: String(err), code: 'open_failed' });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e?.message || 'open failed' });
    }
  });

  // ── Relink ────────────────────────────────────────────────────────────────
  function offlineRows(bundle) {
    return bundle.binFiles.filter(f => !(f.is_sequence ? isDir(f.source_path) : isFile(f.source_path)))
      .map(f => ({ id: f.id, name: f.original_name, storage_path: f.source_path, size_bytes: f.is_sequence ? null : (f.size_bytes ?? null), is_sequence: !!f.is_sequence }));
  }

  expressApp.post(`${P}/bins/relink-scan`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const folderPath = req.body?.folderPath ? String(req.body.folderPath) : null;
    const offline = offlineRows(bundle);
    if (!folderPath) return res.json({ offline, candidates: null, truncated: false });
    if (!isAuthorizedDir(bundle, folderPath)) return res.status(403).json({ error: 'folder must be chosen with the folder picker or be a known root', code: 'unauthorized_folder' });
    if (!isDir(folderPath)) return res.status(400).json({ error: 'folderPath is not a directory', code: 'not_a_directory' });
    const candidates = [];
    const { truncated } = walkFolder(folderPath, {
      onDir: (abs, rel) => {
        const seq = detectSequence(abs);
        if (seq) { candidates.push({ relPath: rel, name: path.basename(abs), size: null, abs, is_sequence: true }); return false; }
        return true;
      },
      onFile: (abs, rel, name) => {
        let size = null; try { size = fs.statSync(abs).size; } catch { /* unreadable */ }
        candidates.push({ relPath: rel, name, size, abs, is_sequence: false });
      },
    });
    res.json({ offline, candidates, truncated, folderPath });
  });

  expressApp.post(`${P}/bins/relink-apply`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const mappings = Array.isArray(req.body?.mappings) ? req.body.mappings : [];
    if (!mappings.length) return res.status(400).json({ error: 'mappings required' });
    const updated = []; const failed = [];
    for (const m of mappings) {
      const row = bundle.binFiles.find(f => f.id === m?.id);
      const newPath = m?.newPath;
      if (!row || !isAbs(newPath)) { failed.push({ id: m?.id, reason: 'invalid' }); continue; }
      if (!isAuthorizedDir(bundle, path.dirname(newPath)) && !isAuthorizedDir(bundle, newPath)) { failed.push({ id: m.id, reason: 'unauthorized' }); continue; }
      const ok = row.is_sequence ? isDir(newPath) : isFile(newPath);
      if (!ok) { failed.push({ id: m.id, reason: 'missing' }); continue; }
      const oldKey = pathKey(row.source_path);
      for (const f of bundle.binFiles) {
        if (pathKey(f.source_path) !== oldKey) continue;
        f.source_path = path.resolve(newPath);
        f.updated_at = now();
        if (!f.is_sequence) { try { const st = fs.statSync(newPath); f.size_bytes = st.size; f.mtime = st.mtime.toISOString(); } catch { /* keep */ } }
        updated.push(withOnline(f));
      }
      rememberRoot(bundle, req.params.projectId, row.is_sequence ? path.dirname(newPath) : path.dirname(newPath));
    }
    writeRabbitBundle(req.params.projectId, bundle);
    res.json({ updated, failed });
  });

  expressApp.post(`${P}/bins/roots`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const p = req.body?.path;
    if (!isAbs(p) || !isDir(p)) return res.status(400).json({ error: 'path must be an existing folder' });
    rememberRoot(bundle, req.params.projectId, p, req.body?.label);
    writeRabbitBundle(req.params.projectId, bundle, { touch: false });
    res.json({ binRoots: bundle.binRoots });
  });

  expressApp.delete(`${P}/bins/roots/:id`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const before = bundle.binRoots.length;
    bundle.binRoots = bundle.binRoots.filter(r => r.id !== req.params.id);
    if (bundle.binRoots.length === before) return rabbitNotFound(res, 'root');
    writeRabbitBundle(req.params.projectId, bundle, { touch: false });
    res.json({ binRoots: bundle.binRoots });
  });
}

module.exports = {
  mountRabbitBins,
  // Pure helpers, exported for the tests and for parity with the renderer copy.
  guessMediaType, guessMime, extOf, parseNameSuggestions, detectSequence, walkFolder, pathKey, thumbKeyFor,
  VIDEO_EXTS, STILL_EXTS, AUDIO_EXTS, GRAPHIC_EXTS, VFX_EXTS, DOC_EXTS, SEQUENCE_EXTS, BROWSER_VIDEO_EXTS,
  MEDIA_TYPES, REVIEW_FLAGS, COLORS, BIN_KINDS,
};
