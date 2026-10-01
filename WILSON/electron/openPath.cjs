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
// Then the target must exist and be a regular FILE. Opening it ("the default
// app") is refused for programs and scripts, because for those the default
// app IS running them (.js runs under Windows Script Host); revealing them
// in Explorer is fine.
//
// Pure apart from the injected `fs` / `locateRow` / `mediaRoot`, so
// openPath.test.js drives it on a real temp folder with its own controls.
// =============================================================================

const path = require('node:path');

const OPEN_REFUSED_EXT = new Set([
  '.exe', '.com', '.bat', '.cmd', '.msi', '.msp', '.scr', '.pif', '.cpl', '.ps1', '.psm1',
  '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.hta', '.lnk', '.url', '.reg', '.jar',
  '.application', '.appref-ms', '.gadget', '.scf', '.sh', '.app',
]);

const NOT_HERE = 'This file is not on this computer.';

/**
 * Resolve the row the renderer named to a file on this disk.
 * @returns {{ ok: true, diskPath: string } | { ok: false, error: string }}
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
  return { ok: true, diskPath };
}

/** The sentence that refuses to OPEN this path, or null when it may open. */
function refuseToOpen(diskPath) {
  return OPEN_REFUSED_EXT.has(path.extname(String(diskPath || '')).toLowerCase())
    ? 'WILSON does not open programs or scripts. Use Show in folder to see it.'
    : null;
}

module.exports = { OPEN_REFUSED_EXT, resolveOpenTarget, refuseToOpen };
