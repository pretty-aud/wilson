// =============================================================================
// pathContainment.cjs — the containment guard behind RABBIT's file fs calls.
//
// 🚨 SECURITY BOUNDARY (S14, TPN-NET-013). resolveContainedFilePath is what
// stands between a client-supplied storage_path / relink mapping and
// fs.unlinkSync — S14 closed an arbitrary-path unlink with it. The failure
// direction must stay CLOSED: when in doubt, return null.
//
// Extracted from electron/main.cjs in S33 so the semantics are unit-testable
// off the Electron main process (vitest only includes src/**, and main.cjs
// cannot be imported outside Electron). main.cjs requires this module; the
// source-scan wiring test pins that the routes still go through it.
//
// The S33 fix this module carries: path.resolve() returns a bare root WITH a
// trailing separator ('C:\', '\\srv\share\' — a two-component UNC path IS a
// root) and every deeper path WITHOUT one. The old comparison appended
// path.sep unconditionally, so a drive or share root as the base produced a
// doubled separator no real path matches — every file operation under such a
// root was refused (measured 2026-08-05; fail-closed, so nothing was exposed).
// Stripping the base's own trailing separator before appending exactly one
// keeps the boundary test intact ('C:\foo' still cannot claim 'C:\foobar')
// while letting a root base contain its own children.
//
// Comparison is case-folded: NTFS/APFS are case-insensitive, so 'c:\a' vs
// 'C:\A' must not defeat the guard.
// =============================================================================

'use strict';

const path = require('path');

// pathImpl is injectable (path.win32 / path.posix) so the vitest suite can
// exercise Windows semantics from the ubuntu CI runner and vice versa.
function makeContainment(pathImpl) {
  // Joins relPath under baseDir and refuses anything that escapes it
  // ('..', absolute paths, a foreign \\server\share). Returns the resolved
  // absolute path, or null.
  function resolveContainedFilePath(baseDir, relPath) {
    const base = pathImpl.resolve(baseDir);
    const resolved = pathImpl.resolve(base, String(relPath || ''));
    const a = resolved.toLowerCase();
    let b = base.toLowerCase();
    if (b.endsWith(pathImpl.sep)) b = b.slice(0, -1); // bare root: 'c:\' → 'c:'
    if (a !== b && !a.startsWith(b + pathImpl.sep)) return null;
    return resolved;
  }

  // "candidate is baseDir itself, or inside it" — the per-root comparison
  // isUserAuthorizedRelinkDir (main.cjs) runs over its authorized roots.
  // Same trailing-separator rule as above, same failure direction.
  function isPathInside(baseDir, candidate) {
    const a = pathImpl.resolve(String(candidate)).toLowerCase();
    let b = pathImpl.resolve(String(baseDir)).toLowerCase();
    if (b.endsWith(pathImpl.sep)) b = b.slice(0, -1);
    return a === b || a.startsWith(b + pathImpl.sep);
  }

  // S35 (TPN-NET-015): shape-check a projects.folder_root candidate before
  // main.cjs decides containment. The same refusals the workspace-root IPC
  // handler makes inline (S34), as a testable function: an absolute UNC or
  // drive path, never a device-namespace path, never a bare drive or share
  // root. Returns { ok: true, resolved } with the canonical form (resolved,
  // trailing separators stripped — '..' segments are RESOLVED here, and the
  // caller's containment check is what they then have to survive), or
  // { ok: false, error } with a sentence for the person.
  //
  // This module cannot import src/lib/storageRoot.js (ESM; src/ is not
  // shipped with the packaged main process), so these refusals are a CJS
  // sibling of classifyRoot's, not a re-derivation of its output — the
  // wiring test pins that both routes and the IPC consult THIS function.
  function checkFolderRootShape(candidate) {
    const raw = typeof candidate === 'string' ? candidate.trim() : '';
    if (!raw) {
      return { ok: false, error: 'the project folder must be a folder path' };
    }
    // \\?\ and \\.\ bypass Win32 path normalisation entirely; nobody types
    // one for a project folder (S34 review shape).
    if (/^[\\/]{2}[?.]([\\/]|$)/.test(raw)) {
      return { ok: false, error: 'device-namespace paths (\\\\?\\, \\\\.\\) cannot be a project folder' };
    }
    const isUnc = /^[\\/]{2}/.test(raw);
    const isDrive = /^[A-Za-z]:[\\/]/.test(raw);
    // A relative or drive-relative value would be silently REBASED onto
    // process.cwd() by resolve below, storing a folder nobody chose.
    if (!isUnc && !isDrive) {
      return { ok: false, error: 'the project folder must be an absolute \\\\server\\share\\folder or drive path' };
    }
    const resolved = pathImpl.resolve(raw).replace(/[\\/]+$/, '');
    if (!resolved || /^[A-Za-z]:$/.test(resolved)) {
      return { ok: false, error: 'a drive root cannot be a project folder — pick a folder inside it' };
    }
    if (isUnc) {
      const comps = resolved.replace(/^[\\/]+/, '').split(/[\\/]+/).filter(Boolean);
      if (comps.length < 3) {
        return { ok: false, error: 'a bare \\\\server\\share cannot be a project folder — pick a folder inside it' };
      }
    }
    return { ok: true, resolved };
  }

  // Demo sprint (2026-09-10, review round 2, H1/H2): the "id → file under
  // this data directory" rule for the per-id JSON documents (rate cards,
  // team members, task templates) and the thumbnail cache — everywhere a
  // client-chosen id used to be joined RAW onto getRabbitDataDir(). Express 5
  // decodes route params, so `..%2F..%2Fx` arrives as `../../x`, and a
  // `.json` or `.jpg` suffix is not a containment check: join strips the
  // `..` before the suffix is ever seen. The id must be ONE plain segment
  // (never empty, `.` or `..`; no separator, colon or NUL) AND the joined
  // path must stay inside the base. Returns the absolute path, or null.
  function dataFilePath(baseDir, id, ext = '') {
    const seg = String(id ?? '');
    if (!seg || seg === '.' || seg === '..' || /[\\/:\0]/.test(seg)) return null;
    return resolveContainedFilePath(baseDir, `${seg}${ext}`);
  }

  return { resolveContainedFilePath, isPathInside, checkFolderRootShape, dataFilePath };
}

const platform = makeContainment(path);

module.exports = {
  makeContainment,
  resolveContainedFilePath: platform.resolveContainedFilePath,
  isPathInside: platform.isPathInside,
  checkFolderRootShape: platform.checkFolderRootShape,
  dataFilePath: platform.dataFilePath,
};
