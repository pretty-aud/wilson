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
// project at the user's Documents") applied to references. A request with
// NEITHER header is refused too (a pre-Fetch-Metadata browser, a cross-origin
// <img>); the unit tests send the header the renderer sends. What the gate is
// NOT (review round 2): a wall against another local PROCESS — one can set
// the header itself, and could read the files directly anyway. The second
// wall is per path: a route only streams, probes, restores or relinks a path
// a row already holds or one under a folder the user picked (isAuthorizedDir).
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
// Keyed by path AND modification time (adversarial review): a file re-exported
// to the same path changes mtime and gets a fresh poster; instances of one
// file share the key, and a relink (new path, new mtime) invalidates it.
function thumbKeyFor(sourcePath, mtime = '') {
  return 'bin-' + crypto.createHash('sha1').update(pathKey(sourcePath) + '|' + String(mtime || '')).digest('hex') + '.jpg';
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
  // confidence is 'high' only when an explicit marker was read (a T/TK/take
  // or SH/shot token, a camera clip name, a date); a bare "12A" or "2026" is
  // 'low' and the add dialog leaves it unticked (adversarial review: ordinary
  // names like render_2160p_h264 used to arrive pre-ticked with a slate).
  const out = { slate: null, scene_hint: null, shot_hint: null, take_number: null, take_modifier: null, camera: null, roll: null, shoot_day: null, confidence: 'low' };
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
  let explicit = !!cam || !!date;
  // A bare scene/setup or roll token is only read when something else in the
  // name says this is a slate: an explicit take/shot/scene marker, a camera
  // clip name, or a numeric token right after it (12A_3, 24A-3).
  const hasMarker = tokens.some(t => /^(?:sc|scene)\d|^(?:sh|shot)\d|^(?:t|tk|take)\d{1,3}$|^(pu|ser|mos)$/i.test(t));
  tokens.forEach((raw, i) => {
    const t = raw.toLowerCase();
    let m;
    if ((m = /^(?:sc|scene)(\d{1,4}[a-z]{0,2})$/.exec(t)) && out.scene_hint == null) { out.scene_hint = m[1].toUpperCase(); sceneIdx = i; explicit = true; return; }
    if ((m = /^(?:sh|shot)(\d{1,4})$/.exec(t)) && out.shot_hint == null) { out.shot_hint = String(Number(m[1])); explicit = true; return; }
    if ((m = /^(?:t|tk|take)(\d{1,3})$/.exec(t)) && out.take_number == null) { out.take_number = Number(m[1]); explicitTake = true; explicit = true; return; }
    if (/^(pu|ser|mos)$/.test(t) && out.take_modifier == null) { out.take_modifier = t.toUpperCase(); explicit = true; return; }
    if (/^[a-h]$/.test(t) && i > 0 && out.camera == null && (hasMarker || sceneIdx >= 0)) { out.camera = t.toUpperCase(); return; }
    if (/^[a-h]\d{3}$/.test(t) && out.roll == null && !cam && hasMarker) { out.roll = t.toUpperCase(); return; }
    // A bare scene+setup token (12A) or a bare leading number (24): only when
    // a marker exists elsewhere or a numeric token follows it (12A_3, 24A-3).
    const next = tokens[i + 1];
    const corroborated = hasMarker || (next != null && /^\d{1,3}$/.test(next));
    if ((m = /^(\d{1,4})([a-z]{1,2})$/.exec(t)) && out.scene_hint == null && !cam && corroborated) { out.scene_hint = (m[1] + m[2]).toUpperCase(); sceneIdx = i; return; }
    if (/^\d{1,4}$/.test(t) && out.scene_hint == null && i === 0 && !cam && !date && corroborated) { out.scene_hint = t; sceneIdx = i; return; }
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
  if (explicit || (out.slate && (out.take_number != null || out.shot_hint != null))) out.confidence = 'high';
  return out;
}

// ── Frame sequences ───────────────────────────────────────────────────────────
const FRAME_RE = /^(.*?)([._-]?)(\d{1,8})(\.[A-Za-z0-9]{1,5})$/;

/**
 * If `dir` holds a numbered frame sequence, describe it; else null. A
 * sequence is at least two files, all sharing one prefix and one extension
 * from SEQUENCE_EXTS, with nothing else but dotfiles in the folder.
 */
function detectSequence(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  const all = entries.filter(e => e.isFile() && !e.name.startsWith('.'));
  if (all.length < 2) return null;
  if (entries.some(e => e.isDirectory() && !e.name.startsWith('.'))) return null;
  // A few sidecars beside the frames (Thumbs.db, a render log, an .md5) do
  // not stop the folder being a sequence (adversarial review): files whose
  // extension is not a frame type are set aside and reported — up to three,
  // or 5% of a big folder, never more than ten (review round 2: the floor was
  // two, which refused the three sidecars this very comment names). Anything
  // more, or a second frame series, and it is a folder.
  const files = all.filter(e => SEQUENCE_EXTS.has(extOf(e.name)));
  const sidecars = all.length - files.length;
  if (files.length < 2) return null;
  if (sidecars > Math.max(3, Math.floor(all.length * 0.05)) || sidecars > 10) return null;
  let prefix = null; let sep = ''; let ext = null; let width = null;
  const frames = [];
  let padWidth = null; // the width of the zero-padded frames, if any
  let unpaddedMin = Infinity; // the shortest unpadded number seen
  for (const f of files) {
    const m = FRAME_RE.exec(f.name);
    if (!m) return null;
    const e = m[4].toLowerCase();
    if (prefix === null) { prefix = m[1]; sep = m[2]; ext = e; width = m[3].length; }
    // One series: same prefix, separator and extension (review round 2:
    // `img1.png` beside `img_0002.png` was accepted and reported as
    // `img#.png`, a pattern matching neither file).
    else if (m[1] !== prefix || e !== ext || m[2] !== sep) return null;
    // And one padding rule: every zero-padded frame has the same width, and
    // an unpadded number is never shorter than that width (a series may
    // outgrow its padding — …0998, 0999, 1000 — but `img1` beside `img0002`
    // is two series). Directory order is not frame order, so this is checked
    // once every frame has been seen.
    const padded = String(Number(m[3])) !== m[3];
    if (padded) { if (padWidth === null) padWidth = m[3].length; else if (padWidth !== m[3].length) return null; }
    else unpaddedMin = Math.min(unpaddedMin, m[3].length);
    frames.push({ name: f.name, n: Number(m[3]) });
  }
  if (padWidth !== null && unpaddedMin < padWidth) return null;
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
    sidecars,
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
  // 🚨 FAIL CLOSED (adversarial review, HIGH). The first draft allowed a
  // request that carried neither header; pre-Fetch-Metadata browsers send
  // neither on a cross-origin <img>, so that was a hole in the one thing the
  // gate is for — keeping BROWSER PAGES on other local origins out. The
  // renderer always carries `Sec-Fetch-Site: same-origin`; that is the one
  // caller these routes serve. Tests send that header explicitly. (A local
  // process can send it too; see the header comment — the per-path
  // authorisation below is the wall for that.)
  function isSameOrigin(req) {
    const site = req.headers['sec-fetch-site'];
    if (site) return site === 'same-origin';
    const origin = req.headers.origin;
    if (!origin) return false;
    const host = req.headers.host;
    return host ? (origin === `http://${host}` || origin === `https://${host}`) : false;
  }
  function gate(req, res, next) {
    if (!isSameOrigin(req)) return res.status(403).json({ error: 'bins routes answer WILSON only', code: 'cross_origin' });
    next();
  }
  expressApp.use(`${P}/bins`, gate);
  expressApp.use(`${P}/bin-files`, gate);
  expressApp.use(`${P}/shot-takes`, gate);

  function ensure(bundle) {
    if (!bundle.bins) bundle.bins = [];
    if (!bundle.binFiles) bundle.binFiles = [];
    if (!bundle.binRoots) bundle.binRoots = [];
    if (!bundle.shotTakes) bundle.shotTakes = [];
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
  // 🚨 Bin roots live in the BUNDLE only (adversarial review, HIGH). The first
  // draft also added them to `userAuthorizedDirs`, the process-global set the
  // managed-files relink and folder-root code treat as "folders the user
  // picked through the OS dialog" — so a request body could have authorised a
  // whole drive for a different subsystem. isAuthorizedDir below reads the
  // bundle's roots itself; the Set is only ever filled by the pick routes.
  function rememberRoot(bundle, projectId, dir, label) {
    if (!dir) return;
    const key = pathKey(dir);
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
    // A root that covers recorded ones replaces them (review round 2: a day
    // folder walked depth-first recorded every leaf before its parent, so
    // one import left 31 roots, each walked by the auto-relink).
    bundle.binRoots = bundle.binRoots.filter(r => !pathKey(r.path).startsWith(key + path.sep));
    bundle.binRoots.push({ id: crypto.randomUUID(), project_id: projectId, path: path.resolve(dir), label: label || path.basename(dir), added_at: now(), last_seen_at: now() });
  }
  // Folders the user picked or dropped from, as the add route records them:
  // a picked FOLDER is the root, a picked file's folder is. The pick routes
  // and main.cjs both fill `authorized` lower-cased (review round 2: main.cjs
  // lower-cases unconditionally while pathKey lower-cases on Windows only —
  // one convention, so a pick made through main.cjs's dialog authorises a
  // relink on every platform).
  const authKey = (p) => pathKey(p).toLowerCase();
  function isAuthorizedDir(bundle, p) {
    if (!isAbs(p)) return false;
    const key = pathKey(p);
    const lk = authKey(p);
    if (authorized.has(lk)) return true;
    for (const a of authorized) if (lk.startsWith(a + path.sep)) return true;
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
      shotTakes: presentTakes(liveTakes(bundle)),
      orphanTakes: orphanTakes(bundle),
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
    writeRabbitBundle(req.params.projectId, bundle, { touch: false });
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
      for (const f of affected) { const ns = order++; movedFiles.push({ id: f.id, from: f.bin_id, sort_order: f.sort_order, new_sort_order: ns }); f.bin_id = target; f.sort_order = ns; f.updated_at = now(); }
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
    writeRabbitBundle(req.params.projectId, bundle, { touch: false });
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
    for (const p of result.filePaths) authorized.add(authKey(path.dirname(p)));
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
    authorized.add(authKey(result.filePaths[0]));
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
      sequence: { pattern: seq.pattern, frame_count: seq.frame_count, first_frame: seq.first_frame, last_frame: seq.last_frame, missing_frames: seq.missing_frames, sidecars: seq.sidecars || 0 },
      suggestions: parseNameSuggestions(name),
      duplicate: samePath ? { reason: 'same_path', existing_id: samePath.id, existing_bin_id: samePath.bin_id, existing_bin_name: (bundle.bins.find(b => b.id === samePath.bin_id) || {}).name || null } : null,
      sub_bin: subBin || null,
    };
  }

  // `folderAsBin` (default true): a dropped or picked FOLDER becomes a nested
  // bin named after itself, with its own subfolders nested inside it —
  // "Add folder Day01 to Footage" gives Footage / Day01 / stills. The view
  // passes false when it has just created a bin named after that folder.
  expressApp.post(`${P}/bins/prepare`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const paths = Array.isArray(req.body?.paths) ? req.body.paths.filter(isAbs) : [];
    if (!paths.length) return res.status(400).json({ error: 'paths required (absolute)' });
    const folderAsBin = req.body?.folderAsBin !== false;
    const items = []; const folders = []; let truncated = false;
    const seen = new Set();
    const push = (item) => { const k = pathKey(item.source_path); if (seen.has(k)) return; seen.add(k); items.push(item); };
    const joinSub = (prefix, rel) => [prefix, rel].filter(Boolean).join('/') || null;
    for (const p of paths) {
      if (isFile(p)) { push(describeFile(bundle, p, path.basename(p), null)); continue; }
      if (!isDir(p)) { push({ kind: 'file', source_path: p, original_name: path.basename(p), status: 'missing' }); continue; }
      const seq = detectSequence(p);
      if (seq) { push(describeSequence(bundle, p, seq, null)); continue; }
      const prefix = folderAsBin ? path.basename(p) : null;
      folders.push({ path: p, name: path.basename(p), sub_bin: prefix });
      const r = walkFolder(p, {
        maxEntries: 5000, maxDepth: 8,
        onDir: (abs, rel) => {
          const s = detectSequence(abs);
          if (s) {
            const parentRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : null;
            push(describeSequence(bundle, abs, s, joinSub(prefix, parentRel)));
            return false;
          }
          return true;
        },
        onFile: (abs, rel, name) => {
          const sub = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : null;
          push(describeFile(bundle, abs, name, joinSub(prefix, sub)));
        },
      });
      if (r.truncated) truncated = true;
    }
    // The folders this batch came from — a picked folder itself, a picked
    // file's folder — for the add route to record as the known roots
    // (review round 2: recording each added file's own folder left one
    // root per subfolder, all walked by the auto-relink).
    const roots = [...new Set(paths.filter(p => isFile(p) || isDir(p)).map(p => path.resolve(isDir(p) ? p : path.dirname(p))))];
    res.json({ items, folders, truncated, roots });
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
    }
    // Known roots: the folders the batch was picked or dropped from (`roots`,
    // as `prepare` reported them) — but only one that actually holds an added
    // item counts, so a body path alone records nothing (the S14 rule). An
    // item no listed root covers falls back to its own folder (a sequence
    // folder's parent: the sequence folder IS the item).
    const bodyRoots = Array.isArray(req.body?.roots) ? req.body.roots.filter(p => isAbs(p) && isDir(p)).map(p => path.resolve(p)) : [];
    const rootFor = (src) => bodyRoots.find(r => { const rk = pathKey(r); const sk = pathKey(src); return sk === rk || sk.startsWith(rk + path.sep); });
    for (const row of created) rememberRoot(bundle, req.params.projectId, rootFor(row.source_path) || path.dirname(row.source_path));
    writeRabbitBundle(req.params.projectId, bundle);
    res.json({ created: created.map(withOnline), bins: createdBins, results });
  });

  // ── Bin-file edits ────────────────────────────────────────────────────────
  // Metadata writes below use `touch: false` (adversarial review, MEDIUM):
  // a flag, a colour or a reorder must not stamp project.updated_at (the
  // projects list sorts by it) or rewrite the five folder-mirror files, which
  // do not contain bins anyway. Adding files and creating or deleting bins are
  // structural and keep the default.
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
    writeRabbitBundle(req.params.projectId, bundle, { touch: false });
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
    writeRabbitBundle(req.params.projectId, bundle, { touch: false });
    res.json({ updated });
  });

  expressApp.post(`${P}/bin-files/move`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const ids = idsOf(req.body); const binId = req.body?.binId;
    if (!ids.length) return res.status(400).json({ error: 'ids required' });
    if (!bundle.bins.some(b => b.id === binId)) return res.status(400).json({ error: 'bin not found' });
    let order = nextSortOrder(bundle.binFiles.filter(f => f.bin_id === binId));
    // Optional per-id sort orders (an undo putting rows back where they were).
    const wanted = req.body?.sortOrders && typeof req.body.sortOrders === 'object' ? req.body.sortOrders : null;
    const moved = [];
    for (const id of ids) {
      const f = bundle.binFiles.find(x => x.id === id);
      if (!f) continue;
      moved.push({ id: f.id, from: f.bin_id, sort_order: f.sort_order });
      f.bin_id = binId;
      f.sort_order = wanted && Number.isFinite(Number(wanted[id])) ? Number(wanted[id]) : order++;
      f.updated_at = now();
    }
    writeRabbitBundle(req.params.projectId, bundle, { touch: false });
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
    writeRabbitBundle(req.params.projectId, bundle, { touch: false });
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
    writeRabbitBundle(req.params.projectId, bundle, { touch: false });
    res.json({ removed });
  });

  // The undo of a removal. Every row that could not be put back is REPORTED
  // (review round 2: a row whose bin was deleted meanwhile was dropped with a
  // 200 and nothing said so), and a row's path must sit under a known root or
  // a folder the user picked — the rows came from this server, but a same-
  // origin body is not proof of that (the S14 rule): `unauthorized`.
  // Answers { restored, skipped: [{ id, reason: invalid | bin_gone | unauthorized }] }
  // and carries the live takes of the shots the restored files belong to, so
  // the renderer's chips agree with the server the moment the file is back.
  expressApp.post(`${P}/bin-files/restore`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'rows required' });
    const restored = []; const skipped = [];
    for (const r of rows) {
      if (!r || typeof r !== 'object' || !r.id || !isAbs(r.source_path)) { skipped.push({ id: r?.id ?? null, reason: 'invalid' }); continue; }
      if (!bundle.bins.some(b => b.id === r.bin_id)) { skipped.push({ id: r.id, reason: 'bin_gone' }); continue; }
      if (!isAuthorizedDir(bundle, path.dirname(r.source_path)) && !isAuthorizedDir(bundle, r.source_path)) { skipped.push({ id: r.id, reason: 'unauthorized' }); continue; }
      const { online: _o, ...clean } = r;
      const row = { ...clean, project_id: req.params.projectId, updated_at: now() };
      rabbitUpsertInto(bundle.binFiles, row);
      restored.push(withOnline(row));
    }
    if (restored.length) writeRabbitBundle(req.params.projectId, bundle, { touch: false });
    const fileIds = new Set(restored.map(r => r.id));
    const shotIds = [...new Set(bundle.shotTakes.filter(t => fileIds.has(t.bin_file_id)).map(t => t.shot_id))];
    res.json({ restored, skipped, ...takeResponse(bundle, shotIds) });
  });

  // ── Probe: the technical columns ──────────────────────────────────────────
  async function probeRow(bundle, row) {
    const patch = {};
    const fps = Number(bundle.project?.fps) > 0 ? Number(bundle.project.fps) : 24;
    let target = row.source_path;
    // A file re-exported to the same path has a new size and mtime; a probe
    // (add, "Read columns again") is where the row learns that (review round
    // 2: nothing refreshed `mtime`, so the poster key never changed either).
    if (!row.is_sequence) {
      try { const st = fs.statSync(row.source_path); patch.size_bytes = st.size; patch.mtime = st.mtime.toISOString(); } catch { /* offline: the route refused already */ }
    }
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
  // The cache key is the path plus the mtime ON DISK, read now (review round
  // 2: the row's stored mtime is written at add and relink only, so a file
  // re-exported to the same path kept its old poster for ever). Sequences
  // key on their folder's mtime, which changes when a frame is added or
  // replaced. Offline rows fall back to the stored value so a cached poster
  // still serves while the drive is out.
  function posterMtime(row) {
    try { return fs.statSync(row.source_path).mtime.toISOString(); } catch { return row.mtime || ''; }
  }
  // A poster is written to `<key>.part` and renamed into place, and one
  // generation per key runs at a time (review round 2: two tiles asking for
  // the same still raced on one write, and a torn file would then have been
  // served for ever because the GET serves on existence alone).
  const posterInFlight = new Map();
  function writePosterAtomically(thumbPath, buf) {
    const part = thumbPath + '.part';
    fs.writeFileSync(part, buf);
    fs.renameSync(part, thumbPath);
  }
  function posterOnce(thumbPath, make) {
    if (posterInFlight.has(thumbPath)) return posterInFlight.get(thumbPath);
    const p = Promise.resolve().then(make).finally(() => posterInFlight.delete(thumbPath));
    posterInFlight.set(thumbPath, p);
    return p;
  }

  expressApp.get(`${P}/bin-files/:id/thumbnail`, async (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const row = bundle.binFiles.find(f => f.id === req.params.id);
    if (!row) return rabbitNotFound(res, 'bin-file');
    const thumbPath = resolveContainedFilePath(getThumbCacheDir(), thumbKeyFor(row.source_path, posterMtime(row)));
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
        // Through a buffer and Node's fs, not libvips's own writer: libvips
        // cannot open a path past MAX_PATH on Windows (measured, review round
        // 2: a 268-character cache path answered "unable to open for write"
        // while the same source read fine), Node's fs can.
        await posterOnce(thumbPath, async () => {
          if (exists(thumbPath)) return;
          const buf = await sharp(source).resize(256, 256, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
          writePosterAtomically(thumbPath, buf);
        });
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
    const thumbPath = resolveContainedFilePath(getThumbCacheDir(), thumbKeyFor(row.source_path, posterMtime(row)));
    if (!thumbPath) return res.status(400).json({ error: 'invalid thumbnail path' });
    try { writePosterAtomically(thumbPath, buf); } catch (err) { return res.status(500).json({ error: 'thumbnail write failed' }); }
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
    // Same caps as prepare (adversarial review, HIGH): this walk runs on the
    // main thread of the only server the app has, and the view scans every
    // known root on open — an uncapped walk of a big drive froze everything.
    const { truncated } = walkFolder(folderPath, {
      maxEntries: 5000, maxDepth: 8,
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
      rememberRoot(bundle, req.params.projectId, path.dirname(newPath));
    }
    writeRabbitBundle(req.params.projectId, bundle, { touch: false });
    res.json({ updated, failed });
  });

  // Roots are recorded by the pick and add routes only — there is no route
  // that takes one from a body (review round 2 removed it: nothing called
  // it, and a body-supplied folder is not consent). Forgetting one is the
  // relink dialog's "forget this folder".
  expressApp.delete(`${P}/bins/roots/:id`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const before = bundle.binRoots.length;
    bundle.binRoots = bundle.binRoots.filter(r => r.id !== req.params.id);
    if (bundle.binRoots.length === before) return rabbitNotFound(res, 'root');
    writeRabbitBundle(req.params.projectId, bundle, { touch: false });
    res.json({ binRoots: bundle.binRoots });
  });

  // ── Shot takes (milestone 2) ──────────────────────────────────────────────
  //
  // Audrey (DEMO_BINS_BRIEF §5): "a single shot can have multiple takes, the
  // shot item in the scenes table should be able to show which take/files are
  // being used in the shot … some editors will also build a shot from multiple
  // takes to make a reworked version of a shot, please make sure multiple
  // files from a bin can be assigned to a single shot."
  //
  // A shot take (`bundle.shotTakes`, BINS_DESIGN §4.4) links one shot to one
  // bin file, many-to-many both ways (§6 Q6: one take may serve several
  // shots), ordered by `position`, with a `role`: `primary` — the take the
  // shot is cut from, exactly one per shot that has any; `part` — one piece of
  // a shot rebuilt from several takes; `alt` — a spare. `notes` is the
  // editor's reason. Invariants, re-established by normalizeShotTakes after
  // every write: unique on (shot_id, bin_file_id); positions 0..n-1 in list
  // order; a shot with any take has exactly one primary.
  //
  // Orphans are FILTERED on read, never pruned. A shot deleted through the
  // generic shots route (main.cjs, not this file) or a bin file removed above
  // leaves its rows on disk, so an undo that restores the shot or the file
  // brings its takes back with it. `liveTakes` is what every response carries.
  //
  // 🚨 The invariants are re-established on READ as well as on write
  // (adversarial review, HIGH). The bin-file routes above change what is
  // live without touching this array — removing the primary's file left a
  // shot with no primary, and restoring it after another take had been
  // promoted left it with two — so every response passes the live rows
  // through `presentTakes`, which renumbers 0..n-1 and keeps exactly one
  // primary WITHOUT writing: the rows on disk stay verbatim, which is what
  // makes undoing a removal exact. The one thing a write does to orphans is
  // demote an orphan primary once a live take is promoted in its place, so
  // that the restored file comes back as an alt beside the take the editor
  // chose meanwhile, not as a second primary.
  //
  // `replace` is the undo primitive: the provider snapshots the rows of the
  // shots a mutation touches and hands them back verbatim to undo, so undo is
  // exact whatever the mutation did to siblings (a promoted primary, shifted
  // positions), instead of every mutation needing a hand-written inverse.
  function liveTakes(bundle) {
    const shots = new Set((bundle.shots || []).map(s => s.id));
    const files = new Set(bundle.binFiles.map(f => f.id));
    return bundle.shotTakes.filter(t => shots.has(t.shot_id) && files.has(t.bin_file_id));
  }
  // The rows a read does NOT present: their shot or file is gone. They ride
  // beside `shotTakes` as `orphanTakes`, verbatim, so the renderer's state
  // keeps them (review round 2, HIGH: every take response and every list
  // load replaced the state's rows with live ones only, so an orphan the
  // undo of a file removal needed was gone from state within one edit or one
  // tab switch, and the restored file came back with no takes on screen).
  // The renderer's selectors join through live files and shots and ignore
  // them until their file or shot is back.
  function orphanTakes(bundle, shotIds = null) {
    const live = new Set(liveTakes(bundle).map(t => t.id));
    const set = shotIds ? new Set(shotIds) : null;
    return bundle.shotTakes.filter(t => !live.has(t.id) && (!set || set.has(t.shot_id)));
  }
  function takesOf(bundle, shotIds) {
    const set = new Set(shotIds);
    return liveTakes(bundle).filter(t => set.has(t.shot_id)).sort(byPosition);
  }
  // `preferId`: the row that should be primary when several claim it (a take
  // just promoted); otherwise the first claimant in list order, else the first
  // take. A demoted claimant becomes `alt`, never `part`: parts are a thing
  // the editor states, not something normalisation invents.
  //
  // While the stored primary's FILE is out (an orphan flagged primary) and no
  // live row claims the role, nothing is materialised: the reads present the
  // first live take as primary on their own, the stored roles stay as they
  // are, and the original primary is primary again the moment its drive is
  // back (review round 2, HIGH: any write to the shot meanwhile — assigning a
  // spare, say — promoted a live take on disk and demoted the orphan for
  // good, and no undo covered it). The orphan is demoted only once a live
  // take is EXPLICITLY made primary: the editor's choice then wins.
  function normalizeShotTakes(bundle, shotId, preferId = null) {
    const rows = takesOf(bundle, [shotId]);
    if (!rows.length) return;
    const orphanPrimary = bundle.shotTakes.some(t => t.shot_id === shotId && t.role === 'primary' && !rows.includes(t));
    let primary = preferId ? rows.find(r => r.id === preferId && r.role === 'primary') : null;
    if (!primary) primary = rows.find(r => r.role === 'primary') || (orphanPrimary ? null : rows[0]);
    rows.forEach((r, i) => {
      const role = primary
        ? (r.id === primary.id ? 'primary' : (r.role === 'primary' || !TAKE_ROLES.includes(r.role) ? 'alt' : r.role))
        : (TAKE_ROLES.includes(r.role) && r.role !== 'primary' ? r.role : 'alt');
      if (r.position !== i || r.role !== role) { r.position = i; r.role = role; r.updated_at = now(); }
    });
    if (!primary) return;
    // An orphan (its file removed) that still says primary would come back as
    // a second primary when the file is restored; the live take chosen
    // meanwhile wins. Orphans keep their positions: a restored take lands in
    // the slot it had (ties by creation time), not at the end.
    const live = new Set(rows.map(r => r.id));
    for (const t of bundle.shotTakes) {
      if (t.shot_id === shotId && !live.has(t.id) && t.role === 'primary') { t.role = 'alt'; t.updated_at = now(); }
    }
  }
  function takeResponse(bundle, shotIds, extra = {}) {
    const affected = [...new Set(shotIds)];
    return { ...extra, affectedShotIds: affected, shotTakes: presentTakes(takesOf(bundle, affected)), orphanTakes: orphanTakes(bundle, affected) };
  }

  expressApp.get(`${P}/shot-takes`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    res.json({ shotTakes: presentTakes(liveTakes(bundle)), orphanTakes: orphanTakes(bundle) });
  });

  // Assign: several files to one shot, one file to several shots, or any
  // mix. The whole batch is validated before anything is written; a pair
  // already assigned is reported as skipped, never duplicated. The first take
  // a shot gets is its primary; later ones are `alt` unless a role is given;
  // asking for `primary` demotes the current one.
  expressApp.post(`${P}/shot-takes`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const list = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
    if (!list.length) return res.status(400).json({ error: 'assignments required' });
    for (const a of list) {
      if (!a || !(bundle.shots || []).some(s => s.id === a.shot_id)) return res.status(400).json({ error: `shot ${a?.shot_id} not found`, code: 'shot_not_found' });
      if (!bundle.binFiles.some(f => f.id === a.bin_file_id)) return res.status(400).json({ error: `bin file ${a?.bin_file_id} not found`, code: 'file_not_found' });
    }
    const created = []; const skipped = []; const affected = [];
    for (const a of list) {
      const existing = liveTakes(bundle).find(t => t.shot_id === a.shot_id && t.bin_file_id === a.bin_file_id);
      if (existing) { skipped.push({ shot_id: a.shot_id, bin_file_id: a.bin_file_id, reason: 'already_assigned', id: existing.id }); affected.push(a.shot_id); continue; }
      const siblings = takesOf(bundle, [a.shot_id]);
      // A shot with any live take already HAS a primary as far as every read
      // is concerned (the first flagged, else the first) — even while the
      // stored primary's file is out (review round 2, HIGH: reading the raw
      // roles said "no primary" then, and the new spare took the role).
      const hasPrimary = siblings.length > 0;
      let role = TAKE_ROLES.includes(a.role) ? a.role : null;
      if (!hasPrimary) role = 'primary';
      else if (!role) role = 'alt';
      if (role === 'primary' && hasPrimary) for (const t of siblings) if (t.role === 'primary') { t.role = 'alt'; t.updated_at = now(); }
      const row = rabbitTouch({
        id: undefined, project_id: req.params.projectId, shot_id: a.shot_id, bin_file_id: a.bin_file_id,
        role, position: siblings.length, notes: a.notes == null ? '' : String(a.notes),
      });
      bundle.shotTakes.push(row);
      created.push(row); affected.push(a.shot_id);
      normalizeShotTakes(bundle, a.shot_id, row.id);
    }
    if (created.length) writeRabbitBundle(req.params.projectId, bundle, { touch: false });
    res.json(takeResponse(bundle, affected, { created, skipped }));
  });

  // role / notes / position. Promoting a take to primary SWAPS roles with the
  // current primary (a part stays a part, a spare stays a spare); demoting the
  // primary hands the role to the next take in order; the only take of a shot
  // stays primary whatever is asked. position moves the take within its shot.
  expressApp.patch(`${P}/shot-takes/:id`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const take = liveTakes(bundle).find(t => t.id === req.params.id);
    if (!take) return rabbitNotFound(res, 'shot-take');
    const body = req.body || {};
    if ('role' in body && !TAKE_ROLES.includes(body.role)) return res.status(400).json({ error: 'role must be primary, part or alt', code: 'bad_role' });
    if ('position' in body && !Number.isFinite(Number(body.position))) return res.status(400).json({ error: 'position must be a number' });
    if ('notes' in body) take.notes = body.notes == null ? '' : String(body.notes);
    if ('role' in body && body.role !== take.role) {
      const siblings = takesOf(bundle, [take.shot_id]);
      if (body.role === 'primary') {
        const old = siblings.find(t => t.role === 'primary' && t.id !== take.id);
        if (old) { old.role = take.role; old.updated_at = now(); }
        take.role = 'primary';
      } else if (take.role === 'primary') {
        const next = siblings.find(t => t.id !== take.id);
        if (next) { next.role = 'primary'; next.updated_at = now(); take.role = body.role; }
      } else take.role = body.role;
    }
    if ('position' in body) {
      const others = takesOf(bundle, [take.shot_id]).filter(t => t.id !== take.id);
      const idx = Math.max(0, Math.min(others.length, Math.floor(Number(body.position))));
      others.splice(idx, 0, take);
      others.forEach((t, i) => { t.position = i; });
    }
    take.updated_at = now();
    normalizeShotTakes(bundle, take.shot_id, take.id);
    writeRabbitBundle(req.params.projectId, bundle, { touch: false });
    res.json(takeResponse(bundle, [take.shot_id], { take }));
  });

  // Unassign. Removing a shot's primary promotes the next take in order.
  expressApp.post(`${P}/shot-takes/remove`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const ids = new Set(idsOf(req.body));
    if (!ids.size) return res.status(400).json({ error: 'ids required' });
    // Live rows only, like every other route: an orphan waits on disk for the
    // undo that brings its shot or file back (review round 2: this was the one
    // route reading the raw array, and it hard-deleted an orphan).
    const removed = liveTakes(bundle).filter(t => ids.has(t.id));
    if (!removed.length) return rabbitNotFound(res, 'shot-take');
    const gone = new Set(removed.map(t => t.id));
    bundle.shotTakes = bundle.shotTakes.filter(t => !gone.has(t.id));
    const affected = [...new Set(removed.map(t => t.shot_id))];
    for (const s of affected) normalizeShotTakes(bundle, s);
    writeRabbitBundle(req.params.projectId, bundle, { touch: false });
    res.json(takeResponse(bundle, affected, { removed }));
  });

  // The listed ids take the given order; takes of the shot not listed follow
  // in the order they had. Roles are untouched.
  expressApp.post(`${P}/shot-takes/reorder`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const shotId = req.body?.shot_id; const ids = idsOf(req.body);
    if (!shotId || !ids.length) return res.status(400).json({ error: 'shot_id and ids required' });
    if (!(bundle.shots || []).some(s => s.id === shotId)) return res.status(400).json({ error: 'shot not found', code: 'shot_not_found' });
    const rows = takesOf(bundle, [shotId]);
    const pos = new Map(ids.map((id, i) => [id, i]));
    const listed = rows.filter(r => pos.has(r.id)).sort((a, b) => pos.get(a.id) - pos.get(b.id));
    // Ids that belong to another shot (or to nothing) are a caller's mistake,
    // not an order (review round 2: they answered 200 and rewrote the shot).
    if (!listed.length) return res.status(400).json({ error: 'none of the ids is a take of that shot', code: 'bad_ids' });
    const rest = rows.filter(r => !pos.has(r.id));
    let changed = false;
    [...listed, ...rest].forEach((r, i) => { if (r.position !== i) { r.position = i; r.updated_at = now(); changed = true; } });
    normalizeShotTakes(bundle, shotId);
    if (changed) writeRabbitBundle(req.params.projectId, bundle, { touch: false });
    res.json(takeResponse(bundle, [shotId]));
  });

  // The undo primitive: for the given shots, every current row (live or
  // orphaned) is dropped and `rows` are put in their place verbatim — ids
  // kept, so a redo finds the same rows. Rows for other shots, for files that
  // no longer exist, or duplicating a pair are ignored; an id already in use
  // by another shot's row gets a fresh one.
  expressApp.post(`${P}/shot-takes/replace`, (req, res) => {
    const bundle = load(req, res); if (!bundle) return;
    const shotIds = Array.isArray(req.body?.shotIds) ? req.body.shotIds.map(String) : [];
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!shotIds.length) return res.status(400).json({ error: 'shotIds required' });
    const shotSet = new Set(shotIds);
    for (const id of shotSet) if (!(bundle.shots || []).some(s => s.id === id)) return res.status(400).json({ error: `shot ${id} not found`, code: 'shot_not_found' });
    // Only the LIVE rows of the named shots are replaced. An orphan — its
    // file removed since — stays on disk (adversarial review, HIGH: the first
    // draft dropped it, so "remove a file, undo any take edit, undo the
    // removal" lost the assignment for good).
    const fileIds = new Set(bundle.binFiles.map(f => f.id));
    const remaining = bundle.shotTakes.filter(t => !shotSet.has(t.shot_id) || !fileIds.has(t.bin_file_id));
    const usedIds = new Set(remaining.map(t => t.id));
    const seen = new Set(); const clean = [];
    for (const r of rows) {
      if (!r || typeof r !== 'object' || !shotSet.has(r.shot_id)) continue;
      if (!bundle.binFiles.some(f => f.id === r.bin_file_id)) continue;
      const key = `${r.shot_id}|${r.bin_file_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const id = r.id && !usedIds.has(r.id) ? String(r.id) : undefined;
      const row = rabbitTouch({
        ...r, id, project_id: req.params.projectId, shot_id: r.shot_id, bin_file_id: r.bin_file_id,
        role: TAKE_ROLES.includes(r.role) ? r.role : 'alt', position: Number(r.position) || 0, notes: r.notes == null ? '' : String(r.notes),
      });
      usedIds.add(row.id);
      clean.push(row);
    }
    bundle.shotTakes = remaining.concat(clean);
    for (const s of shotSet) normalizeShotTakes(bundle, s);
    writeRabbitBundle(req.params.projectId, bundle, { touch: false });
    res.json(takeResponse(bundle, shotIds));
  });
}

const TAKE_ROLES = ['primary', 'part', 'alt'];
const byPosition = (a, b) => (Number(a.position) || 0) - (Number(b.position) || 0) || String(a.created_at || '').localeCompare(String(b.created_at || ''));

/**
 * The live rows of any number of shots as a response should show them: per
 * shot, in (position, created_at) order, renumbered 0..n-1, with exactly one
 * primary — the first row flagged primary, else the first row; other
 * claimants read as alt. PURE: returns copies, never touches the rows or
 * the bundle. The renderer's takesByShot applies the same rule to its own
 * state (bins/shotTakeSelectors.js), so the two agree while a removal is
 * still optimistic.
 */
function presentTakes(rows) {
  const byShot = new Map();
  for (const t of rows || []) {
    if (!byShot.has(t.shot_id)) byShot.set(t.shot_id, []);
    byShot.get(t.shot_id).push(t);
  }
  const out = [];
  for (const list of byShot.values()) {
    list.sort(byPosition);
    const primary = list.find(r => r.role === 'primary') || list[0];
    list.forEach((r, i) => {
      const role = r.id === primary.id ? 'primary' : (r.role === 'primary' || !TAKE_ROLES.includes(r.role) ? 'alt' : r.role);
      out.push(r.position === i && r.role === role ? r : { ...r, position: i, role });
    });
  }
  return out;
}

module.exports = {
  mountRabbitBins,
  // Pure helpers, exported for the tests and for parity with the renderer copy.
  guessMediaType, guessMime, extOf, parseNameSuggestions, detectSequence, walkFolder, pathKey, thumbKeyFor, presentTakes,
  VIDEO_EXTS, STILL_EXTS, AUDIO_EXTS, GRAPHIC_EXTS, VFX_EXTS, DOC_EXTS, SEQUENCE_EXTS, BROWSER_VIDEO_EXTS,
  MEDIA_TYPES, REVIEW_FLAGS, COLORS, BIN_KINDS, TAKE_ROLES,
};
