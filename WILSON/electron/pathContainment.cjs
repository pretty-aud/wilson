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

  return { resolveContainedFilePath, isPathInside };
}

const platform = makeContainment(path);

module.exports = {
  makeContainment,
  resolveContainedFilePath: platform.resolveContainedFilePath,
  isPathInside: platform.isPathInside,
};
