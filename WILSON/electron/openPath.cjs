// =============================================================================
// openPath.cjs — what rabbit:open-path may touch (post-overhaul S4a, Audrey's
// E9: "Open in default app" is new; "Show in folder" exists).
//
// The renderer names a ROW, never a path:
//   { source: 'files' | 'managed', projectId, fileId }  — a Local Server
//       project's file or managed file. The path comes from the bundle,
//       through main's own contained resolvers (`locateRow`, the download
//       and stream routes' code).
//   { source: 'media', mediaKey }  — a private project's body (0072) under
//       the local media root: checkMediaKey (the shape uploadFile writes),
//       then lexical containment, then REAL-path containment — the
//       local-media routes' own three checks.
// Then the target must exist and be a regular FILE. Revealing it in Explorer
// is always fine. OPENING it ("the default app") is a launch, so it is DENY
// BY DEFAULT (review round 1, R1-SEC-01): only the documents, pictures,
// video, audio and 3D files below open. A list of refusals was a list of the
// launch vectors someone had thought of — `.settingcontent-ms`, `.diagcab`,
// `.chm`, `.msc`, `.library-ms` and `.jnlp` all ran through it. Programs and
// scripts keep their own sentence (OPEN_REFUSED_EXT only chooses the words).
// The extension judged is the REAL target's: a link named `brief.pdf` that
// leads to `calc.exe` is a program, and it is the real target that opens.
//
// Pure apart from the injected `fs` / `locateRow` / `mediaRoot`, so
// openPath.test.js drives it on a real temp folder with its own controls.
// =============================================================================

const path = require('node:path');

/** What "Open in default app" may hand to the operating system. */
const OPEN_ALLOWED_EXT = new Set([
  // documents, scripts for the screen, sheets, decks, edit lists, subtitles
  '.pdf', '.txt', '.md', '.markdown', '.rtf', '.doc', '.docx', '.odt', '.pages',
  '.xls', '.xlsx', '.ods', '.numbers', '.csv', '.tsv', '.ppt', '.pptx', '.odp', '.key',
  '.fdx', '.fountain', '.json', '.xml', '.edl', '.ale', '.fcpxml', '.otio', '.srt', '.vtt',
  // pictures, camera raw and the image formats of a pipeline
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.heic', '.heif', '.avif',
  '.psd', '.psb', '.ai', '.exr', '.dpx', '.tga', '.hdr', '.cr2', '.cr3', '.nef', '.arw', '.dng',
  '.raf', '.orf', '.rw2',
  // video
  '.mp4', '.m4v', '.mov', '.avi', '.mkv', '.webm', '.mxf', '.wmv', '.mpg', '.mpeg', '.m2ts',
  '.mts', '.3gp', '.r3d', '.braw', '.ari',
  // audio
  '.wav', '.bwf', '.mp3', '.aif', '.aiff', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wma',
  // 3D interchange (no scene scripts)
  '.fbx', '.obj', '.gltf', '.glb', '.usd', '.usda', '.usdc', '.usdz', '.abc', '.stl', '.ply', '.dae', '.3ds',
]);

/** Programs and scripts: refused like everything off the list, in their own words. */
const OPEN_REFUSED_EXT = new Set([
  '.exe', '.com', '.bat', '.cmd', '.msi', '.msp', '.scr', '.pif', '.cpl', '.ps1', '.psm1',
  '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.wsc', '.sct', '.hta', '.lnk', '.url', '.reg', '.jar',
  '.jnlp', '.application', '.appref-ms', '.gadget', '.scf', '.sh', '.app', '.msc', '.chm',
  '.settingcontent-ms', '.diagcab', '.library-ms', '.website', '.py', '.pyw',
]);

const PROGRAMS = 'WILSON does not open programs or scripts. Use Show in folder to see it.';
const OFF_THE_LIST = 'WILSON opens documents, pictures, video, audio and 3D files in their own app. Use Show in folder for this one.';
const NOT_HERE = 'This file is not on this computer.';

/**
 * Resolve the row the renderer named to a file on this disk.
 * `realPath` is where the path really leads (through any link or junction):
 * the file "Open in default app" judges and opens.
 * @returns {{ ok: true, diskPath: string, realPath: string } | { ok: false, error: string }}
 */
function resolveOpenTarget(req, deps) {
  const { fs, locateRow, mediaRoot, checkMediaKey, resolveContainedFilePath, insideByRealPath } = deps;
  const { source, projectId, fileId, mediaKey } = req || {};
  let diskPath = null;
  if (source === 'media') {
    const check = checkMediaKey(String(mediaKey || ''));
    if (!check.ok) return { ok: false, error: 'That file is not one WILSON stored on this computer.' };
    let root = null;
    try { root = mediaRoot(); } catch (err) { return { ok: false, error: (err && err.message) || 'The local media folder is not available.' }; }
    const candidate = root ? resolveContainedFilePath(root, check.segments.join(path.sep)) : null;
    diskPath = candidate && insideByRealPath(root, candidate) ? candidate : null;
  } else if (source === 'files' || source === 'managed') {
    if (typeof locateRow !== 'function') return { ok: false, error: 'The local server is not running.' };
    diskPath = locateRow(String(projectId || ''), String(fileId || ''), source);
  } else {
    return { ok: false, error: 'unknown source' };
  }
  if (!diskPath || !fs.existsSync(diskPath)) return { ok: false, error: NOT_HERE };
  let stat;
  try { stat = fs.statSync(diskPath); } catch { return { ok: false, error: NOT_HERE }; }
  if (!stat.isFile()) return { ok: false, error: 'That is not a file.' };
  let realPath;
  try { realPath = fs.realpathSync(diskPath); } catch { return { ok: false, error: NOT_HERE }; }
  return { ok: true, diskPath, realPath };
}

/** The sentence that refuses to OPEN this path, or null when it may open. */
function refuseToOpen(diskPath) {
  const ext = path.extname(String(diskPath || '')).toLowerCase();
  if (OPEN_REFUSED_EXT.has(ext)) return PROGRAMS;
  return OPEN_ALLOWED_EXT.has(ext) ? null : OFF_THE_LIST;
}

/**
 * The whole rabbit:open-path IPC, with the shell injected (review round 1,
 * R1-TST-02: as three substrings of main.cjs a refusal that was computed and
 * ignored, a reveal that fell through to open, and a wrong row all passed).
 * Reveal shows the named path in its folder and never opens it. Open judges
 * the REAL target (and the name) and opens exactly what it judged.
 */
async function openOrReveal(req, deps) {
  const target = resolveOpenTarget(req, deps);
  if (!target.ok) return target;
  if (req && req.reveal) {
    deps.shell.showItemInFolder(target.diskPath);
    return { ok: true };
  }
  const refusal = refuseToOpen(target.realPath) || refuseToOpen(target.diskPath);
  if (refusal) return { ok: false, error: refusal };
  const err = await deps.shell.openPath(target.realPath);
  return err ? { ok: false, error: err } : { ok: true };
}

/**
 * main's row locator: the path of ONE row of the bundle, through main's own
 * contained resolvers (the download and stream routes' code). A row the user
 * deleted (a soft-deleted managed file) resolves to nothing, as the stream
 * route's does.
 */
function makeRowLocator({ readRabbitBundle, resolveManagedFileDiskPath, resolveContainedFilePath, resolveFileBaseDir }) {
  return (projectId, fileId, source) => {
    const bundle = readRabbitBundle(projectId);
    if (!bundle) return null;
    if (source === 'managed') {
      const mf = (bundle.managedFiles || []).find(f => f.id === fileId && !f.deleted_at);
      return mf ? resolveManagedFileDiskPath(bundle, mf) : null;
    }
    const file = (bundle.files || []).find(f => f.id === fileId);
    if (!file) return null;
    return resolveContainedFilePath(resolveFileBaseDir(bundle, projectId, file), file.storage_path);
  };
}

module.exports = { OPEN_ALLOWED_EXT, OPEN_REFUSED_EXT, resolveOpenTarget, refuseToOpen, openOrReveal, makeRowLocator };
