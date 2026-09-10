// =============================================================================
// localDemoRoot.cjs — the local demo folder (demo sprint, 2026-09-10).
//
// Audrey, 2026-09-08: "for demo-ing i need the ability to use the system and
// not need a server or a cloud solution. I want to be able to setup a local
// folder on my local storage just to demo the system."
//
// ONE user-chosen folder holds the whole demo:
//
//   <folder>/
//     wilson-demo.json          manifest: format, created, app version, last opened
//     projects/<slug>/          each project's files (the existing folder_slug layout)
//     .wilson/rabbit-data/      bundles, thumbnail cache, rate cards, team, templates
//                               (files-config.json stays PER MACHINE, in userData —
//                               review round 2, M4: a copied folder must not carry
//                               another machine's files root)
//
// main.cjs keeps its helper NAMES AND SIGNATURES — getRabbitDataDir(),
// getThumbCacheDir(), resolveConfiguredRootDir() — and consults this module
// for WHERE they resolve: under the active folder when one is open, exactly
// as before (Electron userData) when none is. Nothing is migrated silently.
//
// The ACTIVE folder is remembered per machine in userData/local-demo.json
// together with a short recent list, so Audrey can switch between demo
// folders. A remembered folder that is missing on launch (drive unplugged)
// is reported as `missing`, never silently replaced by userData.
//
// Pure by construction: no Electron import, fs/path injectable, so the
// adopt / initialise / ask rules and the root resolution are unit-tested
// from vitest (src/lib/localDemoRoot.test.js) the way pathContainment.cjs is.
//
// 🚨 SECURITY BOUNDARY, same family as pathContainment.cjs. `open()` shape-
// checks every candidate with checkFolderRootShape (absolute drive or UNC
// path, never a drive/share root, never a device-namespace path) and main.cjs
// only lets a folder through that the USER picked in the OS dialog this
// session or that this file already remembers — a renderer-supplied string
// alone is never enough (the S14 rule). The failure direction stays closed.
// =============================================================================

'use strict';

const nodeFs = require('fs');
const nodePath = require('path');
const { isPathInside, makeContainment } = require('./pathContainment.cjs');

const MANIFEST_NAME = 'wilson-demo.json';
const MANIFEST_KIND = 'wilson-local-demo';
const MANIFEST_FORMAT = 1;
const DATA_SUBDIRS = ['.wilson', 'rabbit-data'];
const PROJECTS_SUBDIR = 'projects';
const POINTER_NAME = 'local-demo.json';
const RECENT_LIMIT = 8;

// OS litter that does not make a folder "not empty".
const IGNORED_ENTRIES = new Set([
  'desktop.ini', 'thumbs.db', '.ds_store', '$recycle.bin',
  'system volume information', '.spotlight-v100', '.trashes',
]);

// Case-folded key for comparing folders: NTFS/APFS are case-insensitive, the
// same reason pathContainment compares lowercased.
function keyOf(pathImpl, p) {
  return pathImpl.resolve(String(p || '')).replace(/[\\/]+$/, '').toLowerCase();
}

// Shape-check a candidate demo folder. A sibling of pathContainment's
// checkFolderRootShape, which is Windows-only by design (a NAS root is a UNC
// or drive path); a demo folder can also live on a Mac laptop, so a posix
// absolute path is accepted on posix. Refused either way: a relative path
// (resolve would silently rebase it onto process.cwd()), a device-namespace
// path, and a bare drive, share or filesystem root. Returns the canonical
// form (resolved, no trailing separator) or a sentence for the person.
function checkDemoFolderShape(candidate, pathImpl = nodePath) {
  const raw = typeof candidate === 'string' ? candidate.trim() : '';
  if (!raw) return { ok: false, error: 'the demo folder must be a folder path' };
  if (/^[\\/]{2}[?.]([\\/]|$)/.test(raw)) {
    return { ok: false, error: 'device-namespace paths cannot be a demo folder' };
  }
  // (review round 1, N13) three or more leading separators are neither a UNC
  // path nor a device path; resolve() would silently rebase them onto the
  // process drive — the exact case the relative-path refusal exists for.
  if (/^[\\/]{3,}/.test(raw)) {
    return { ok: false, error: 'the demo folder must be an absolute \\\\server\\share\\folder or drive path' };
  }
  const windows = pathImpl.sep === '\\';
  const isUnc = /^[\\/]{2}/.test(raw);
  const isDrive = /^[A-Za-z]:[\\/]/.test(raw);
  const isPosixAbs = !windows && raw.startsWith('/');
  if (!isUnc && !isDrive && !isPosixAbs) {
    return { ok: false, error: 'the demo folder must be an absolute path' };
  }
  const resolved = pathImpl.resolve(raw).replace(/[\\/]+$/, '');
  if (!resolved || /^[A-Za-z]:$/.test(resolved)) {
    return { ok: false, error: 'a drive root cannot be the demo folder — make a folder inside it' };
  }
  if (isUnc) {
    const comps = resolved.replace(/^[\\/]+/, '').split(/[\\/]+/).filter(Boolean);
    if (comps.length < 3) {
      return { ok: false, error: 'a bare \\\\server\\share cannot be the demo folder — make a folder inside it' };
    }
  }
  return { ok: true, resolved };
}

function layoutFor(root, pathImpl = nodePath) {
  return {
    root,
    manifestPath: pathImpl.join(root, MANIFEST_NAME),
    dataDir: pathImpl.join(root, ...DATA_SUBDIRS),
    projectsDir: pathImpl.join(root, PROJECTS_SUBDIR),
  };
}

// (review round 2, H3) May a bundle's stored folder_root be RESOLVED? Pure;
// the caller passes the root's REAL path (a junction planted at
// <folder>/projects/<slug> must not count). Anywhere when no demo folder is
// open — today's per-machine rule — and strictly inside the open folder,
// outside its .wilson data dir, otherwise. A copied folder is a bundle
// somebody else wrote: round one's L9 kept an outside root that still
// existed, which let C:\Users\Public become a project folder. The record
// itself is never rewritten; it is simply not followed.
function storedRootAllowed(demoRoot, realRoot, pathImpl = nodePath) {
  if (!demoRoot) return true;
  if (!realRoot) return false;
  const { isPathInside: inside } = makeContainment(pathImpl);
  if (keyOf(pathImpl, realRoot) === keyOf(pathImpl, demoRoot)) return false;
  return inside(demoRoot, realRoot) && !inside(pathImpl.join(demoRoot, DATA_SUBDIRS[0]), realRoot);
}

function newManifest({ appVersion, now }) {
  return {
    format: MANIFEST_FORMAT,
    kind: MANIFEST_KIND,
    created_at: now,
    created_with: appVersion || null,
    last_opened_at: now,
    last_opened_with: appVersion || null,
  };
}

// ── The adopt / initialise / ask rule (pure) ─────────────────────────────────
//
//   manifestState: null (no manifest file) | object (parsed) | 'corrupt'
//   entries:       the names inside the folder
//
//   'wilson'  — a WILSON demo folder: adopt it, never reinitialise.
//   'newer'   — written by a newer WILSON than this one: refuse with a sentence.
//   'empty'   — nothing but OS litter: initialise it.
//   'foreign' — somebody's files, no manifest: ASK before writing anything.
//   'corrupt' — a manifest that cannot be read: ASK (using it rewrites the
//               manifest and keeps every file).
function classifyFolder(entries, manifestState) {
  if (manifestState === 'corrupt') {
    return { kind: 'corrupt', entries: [], count: 0 };
  }
  if (manifestState && typeof manifestState === 'object') {
    const format = manifestState.format;
    if (Number.isInteger(format) && format > MANIFEST_FORMAT) {
      return { kind: 'newer', entries: [], count: 0, format };
    }
    if (Number.isInteger(format)) return { kind: 'wilson', entries: [], count: 0, format };
    return { kind: 'corrupt', entries: [], count: 0 };
  }
  const visible = (entries || [])
    .map(String)
    .filter(n => !IGNORED_ENTRIES.has(n.toLowerCase()));
  if (visible.length === 0) return { kind: 'empty', entries: [], count: 0 };
  return { kind: 'foreign', entries: visible.slice(0, 12), count: visible.length };
}

// ── The per-machine pointer file (pure helpers) ──────────────────────────────
function normalizePointer(raw, pathImpl = nodePath) {
  const out = { activeFolder: null, recent: [] };
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.activeFolder === 'string' && raw.activeFolder.trim()) {
    out.activeFolder = raw.activeFolder.trim();
  }
  const seen = new Set();
  for (const item of Array.isArray(raw.recent) ? raw.recent : []) {
    const p = typeof item === 'string' ? item : item?.path;
    if (typeof p !== 'string' || !p.trim()) continue;
    const k = keyOf(pathImpl, p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.recent.push({
      path: p.trim(),
      lastOpened: typeof item?.lastOpened === 'string' ? item.lastOpened : null,
    });
    if (out.recent.length >= RECENT_LIMIT) break;
  }
  return out;
}

function withRecent(pointer, folder, now, pathImpl = nodePath) {
  const k = keyOf(pathImpl, folder);
  const rest = pointer.recent.filter(r => keyOf(pathImpl, r.path) !== k);
  return {
    ...pointer,
    recent: [{ path: folder, lastOpened: now }, ...rest].slice(0, RECENT_LIMIT),
  };
}

function withoutRecent(pointer, folder, pathImpl = nodePath) {
  const k = keyOf(pathImpl, folder);
  return { ...pointer, recent: pointer.recent.filter(r => keyOf(pathImpl, r.path) !== k) };
}

// ── The stateful root ────────────────────────────────────────────────────────
function makeLocalDemoRoot({
  fs = nodeFs,
  path = nodePath,
  userDataDir,
  appVersion = null,
  now = () => new Date().toISOString(),
  log = () => {},
} = {}) {
  if (!userDataDir) throw new Error('makeLocalDemoRoot: userDataDir is required');

  let active = null;   // canonical folder path while a demo folder is open
  let missing = null;  // the remembered folder when it is not on disk
  let pointer = normalizePointer(null, path);

  const pointerPath = () => path.join(userDataDir, POINTER_NAME);

  function readJSON(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
  }
  function writeJSON(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }
  function savePointer() {
    writeJSON(pointerPath(), pointer);
  }

  function readManifestState(root) {
    const file = layoutFor(root, path).manifestPath;
    let exists = false;
    try { exists = fs.existsSync(file) && fs.statSync(file).isFile(); } catch { exists = false; }
    if (!exists) return null;
    const parsed = readJSON(file);
    return parsed && typeof parsed === 'object' ? parsed : 'corrupt';
  }

  function isDirectory(p) {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  }

  // (review round 2, M6) The folder can vanish WHILE open — renamed, deleted,
  // a drive unplugged — and `missing` was only ever computed at launch, so
  // the resolvers recreated a ghost folder at the old path and wrote into
  // it without a word. Every root question now checks the folder is still
  // there and flips to `missing` when it is not; main.cjs's guard then
  // refuses the local API until the person locates, forgets or closes it.
  function checkPresence() {
    if (active && !isDirectory(active)) {
      log(`[local-demo] folder no longer available: ${active}`);
      missing = active;
      active = null;
    }
  }

  // (review round 1, M7) Containment is LEXICAL in pathContainment.cjs; a
  // symlink or junction inside a shared folder would pass it and reach
  // outside. Every folder this module opens, and every subtree reset()
  // deletes, is resolved to its REAL path first, so the comparisons below
  // run on what the filesystem will actually touch.
  function realPathOf(p) {
    const rp = fs.realpathSync && fs.realpathSync.native ? fs.realpathSync.native : fs.realpathSync;
    return rp(p);
  }

  // What is this folder? Never writes.
  function inspect(candidate) {
    const shape = checkDemoFolderShape(candidate, path);
    if (!shape.ok) return { ok: false, error: shape.error };
    let root = shape.resolved;
    if (!isDirectory(root)) {
      return { ok: false, error: 'the folder does not exist or is not a folder', folder: root };
    }
    try { root = realPathOf(root).replace(/[\\/]+$/, '') || root; } catch { /* keep the resolved form */ }
    let entries = [];
    try { entries = fs.readdirSync(root); } catch {
      return { ok: false, error: 'the folder cannot be read', folder: root };
    }
    const manifestState = readManifestState(root);
    const cls = classifyFolder(entries, manifestState);
    return {
      ok: true,
      folder: root,
      ...cls,
      manifest: manifestState && typeof manifestState === 'object' ? manifestState : null,
    };
  }

  function ensureLayout(root) {
    const layout = layoutFor(root, path);
    fs.mkdirSync(layout.dataDir, { recursive: true });
    fs.mkdirSync(layout.projectsDir, { recursive: true });
    return layout;
  }

  function activate(root, status) {
    active = root;
    missing = null;
    pointer = withRecent({ ...pointer, activeFolder: root }, root, now(), path);
    savePointer();
    log(`[local-demo] ${status}: ${root}`);
    return { ok: true, folder: root, status, layout: layoutFor(root, path) };
  }

  // Open a folder: adopt a WILSON folder, initialise an empty one, and ASK
  // (needsConfirm) before touching a folder that holds somebody's files.
  function open(candidate, { allowForeign = false } = {}) {
    const info = inspect(candidate);
    if (!info.ok) return info;
    const root = info.folder;
    const stamp = now();
    if (info.kind === 'newer') {
      return {
        ok: false, folder: root,
        error: `this folder was made by a newer WILSON (format ${info.format}); update the app to open it`,
      };
    }
    if ((info.kind === 'foreign' || info.kind === 'corrupt') && !allowForeign) {
      return {
        ok: false, needsConfirm: true, folder: root, kind: info.kind,
        entries: info.entries, count: info.count,
        error: info.kind === 'corrupt'
          ? 'this folder has a wilson-demo.json that cannot be read'
          : `this folder already holds ${info.count} item${info.count === 1 ? '' : 's'}`,
      };
    }
    try {
      const layout = layoutFor(root, path);
      // (review round 1, H2) PROVENANCE. A folder that already held a
      // `projects` directory when WILSON opened it (the "use it anyway" case)
      // did not get that directory from WILSON, and reset() must never delete
      // it. Recorded in the manifest at initialise time; an adopted folder
      // keeps whatever its own manifest says.
      const hadProjects = isDirectory(layout.projectsDir);
      const hadData = isDirectory(layout.dataDir);
      ensureLayout(root);
      if (info.kind === 'wilson') {
        const manifest = { ...info.manifest, last_opened_at: stamp, last_opened_with: appVersion || null };
        writeJSON(layout.manifestPath, manifest);
        return activate(root, 'adopted');
      }
      writeJSON(layout.manifestPath, {
        ...newManifest({ appVersion, now: stamp }),
        created_layout: { projects: !hadProjects, rabbit_data: !hadData },
      });
      return activate(root, 'initialised');
    } catch (err) {
      return { ok: false, folder: root, error: `the folder cannot be written: ${err.message}` };
    }
  }

  // Launch: re-open the remembered folder, or report it missing. Never
  // falls back to userData silently — `missing` is what the UI shows.
  function load() {
    pointer = normalizePointer(readJSON(pointerPath()), path);
    active = null;
    missing = null;
    if (!pointer.activeFolder) return getState();
    const remembered = pointer.activeFolder;
    const info = inspect(remembered);
    if (info.ok && info.kind === 'wilson') {
      // A folder that IS a demo folder is adopted; a re-write of the manifest
      // is best-effort here (a read-only drive must still open).
      try {
        const layout = ensureLayout(info.folder);
        writeJSON(layout.manifestPath, { ...info.manifest, last_opened_at: now(), last_opened_with: appVersion || null });
      } catch (err) { log(`[local-demo] manifest not updated: ${err.message}`); }
      active = info.folder;
      log(`[local-demo] active: ${active}`);
    } else {
      missing = remembered;
      log(`[local-demo] remembered folder not available: ${remembered}${info.error ? ` (${info.error})` : ''}`);
    }
    return getState();
  }

  function close() {
    active = null;
    missing = null;
    pointer = { ...pointer, activeFolder: null };
    savePointer();
    return getState();
  }

  // Empty the open folder's WILSON content — projects/ and .wilson/rabbit-data
  // — and NOTHING else: files a person keeps beside them (the "foreign" case),
  // anything else under .wilson/, and the manifest all survive. Refuses when
  // no folder is open. Every path removed is checked to sit strictly inside
  // the open folder before rmSync; rmSync unlinks a symlink or junction
  // rather than following it, so a link planted inside projects/ cannot
  // reach outside.
  function reset() {
    checkPresence();
    if (!active) return { ok: false, error: 'no demo folder is open' };
    const layout = layoutFor(active, path);
    // (review round 1, H2) Only a `projects` directory WILSON itself created
    // may be deleted. A manifest without the record (an older WILSON, or a
    // folder adopted with its own `projects`) refuses — the confirm sentence
    // promises "everything WILSON made", and that promise is kept by refusing
    // when WILSON cannot know.
    const manifest = readJSON(layout.manifestPath);
    const created = manifest && typeof manifest === 'object' ? manifest.created_layout : null;
    // (review round 2, M5) …and the same for .wilson/rabbit-data: H2 recorded
    // both and checked one. Either pre-existing refuses the WHOLE reset — the
    // confirm sentence promises "everything WILSON made", nothing else.
    if (!created || created.projects !== true || created.rabbit_data !== true) {
      return {
        ok: false,
        error: `${PROJECTS_SUBDIR}${path.sep} or ${DATA_SUBDIRS.join(path.sep)}${path.sep} existed before WILSON opened this folder (or the folder was made by an older WILSON), so Reset will not delete them. Empty them by hand in Explorer, then reset.`,
      };
    }
    // Two passes — every target is checked BEFORE anything is removed, so a
    // refusal on the second target never leaves the first half-deleted.
    const targets = [layout.projectsDir, layout.dataDir];
    const plan = [];
    for (const t of targets) {
      if (!isPathInside(active, t) || keyOf(path, t) === keyOf(path, active)) {
        return { ok: false, error: 'refusing to delete outside the demo folder' };
      }
      let exists = false;
      try { exists = fs.existsSync(t); } catch { exists = false; }
      if (!exists) continue;
      // (review round 1, M7) the REAL path must sit inside the open folder
      // too — a `.wilson` junction pointing at Documents would otherwise make
      // this delete `Documents/rabbit-data` past a lexical check that cannot
      // fail on a path this function constructed itself.
      let real = t;
      try { real = realPathOf(t); } catch (err) {
        return { ok: false, error: `could not resolve ${t}: ${err.message}` };
      }
      if (!isPathInside(active, real) || keyOf(path, real) === keyOf(path, active)) {
        return { ok: false, error: `refusing to delete ${t}: it points outside the demo folder (${real})` };
      }
      plan.push(t);
    }
    const removed = [];
    for (const t of plan) {
      try {
        fs.rmSync(t, { recursive: true, force: true });
        removed.push(t);
      } catch (err) {
        return { ok: false, error: `could not remove ${t}: ${err.message}`, removed };
      }
    }
    try {
      ensureLayout(active);
      const stamp = now();
      writeJSON(layout.manifestPath, {
        ...manifest,
        created_layout: { projects: true, rabbit_data: true },
        last_reset_at: stamp,
      });
    } catch (err) {
      return { ok: false, error: `the folder could not be re-initialised: ${err.message}`, removed };
    }
    log(`[local-demo] reset: ${active}`);
    return { ok: true, folder: active, removed };
  }

  function forget(candidate) {
    const k = keyOf(path, candidate);
    if (active && keyOf(path, active) === k) return { ok: false, error: 'close the folder before forgetting it' };
    pointer = withoutRecent(pointer, candidate, path);
    if (missing && keyOf(path, missing) === k) {
      missing = null;
      pointer = { ...pointer, activeFolder: null };
    }
    savePointer();
    return { ok: true, ...getState() };
  }

  // Folders this file already knows — main.cjs accepts an IPC `open` only for
  // one of these or for a folder picked in the OS dialog this session.
  function isKnownFolder(candidate) {
    const k = keyOf(path, candidate);
    if (active && keyOf(path, active) === k) return true;
    if (missing && keyOf(path, missing) === k) return true;
    return pointer.recent.some(r => keyOf(path, r.path) === k);
  }

  function getState() {
    checkPresence();
    return {
      active,
      missing,
      recent: pointer.recent.map(r => ({ ...r })),
      manifest: active ? (readJSON(layoutFor(active, path).manifestPath) || null) : null,
      layout: active ? layoutFor(active, path) : null,
    };
  }

  return {
    load, open, inspect, close, forget, reset, getState, isKnownFolder,
    // Every root question re-checks the folder is still on disk (review
    // round 2, M6) before answering.
    rootDir: () => { checkPresence(); return active; },
    // The remembered folder that is not on disk (drive unplugged), or null.
    // main.cjs's local API refuses while this is set (review round 1, M6).
    missingDir: () => { checkPresence(); return missing; },
    dataDir: () => { checkPresence(); return active ? layoutFor(active, path).dataDir : null; },
    projectsDir: () => { checkPresence(); return active ? layoutFor(active, path).projectsDir : null; },
    // "is this path inside the open demo folder" — the containment question
    // main.cjs's folderRootRefusal and relink authorisation ask.
    contains: (p) => { checkPresence(); return !!active && isPathInside(active, p); },
    pointerPath,
  };
}

module.exports = {
  MANIFEST_NAME,
  MANIFEST_FORMAT,
  MANIFEST_KIND,
  POINTER_NAME,
  RECENT_LIMIT,
  DATA_SUBDIRS,
  PROJECTS_SUBDIR,
  layoutFor,
  newManifest,
  checkDemoFolderShape,
  storedRootAllowed,
  classifyFolder,
  normalizePointer,
  withRecent,
  withoutRecent,
  makeLocalDemoRoot,
};
