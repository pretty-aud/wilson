// =============================================================================
// The path rules (design §5 step 6, §10 row 8). COPIED from the desktop
// (electron/rabbitBins.cjs: isSafeRelativePath, rootPathModule,
// resolveCloudFilePath), never imported: the gateway shares no code with the
// desktop's server (storage design §3.5). paths.test.mjs carries the
// desktop's own cases for these, copied too, so the two stay in parity.
//
// A clip's path is the cloud's relative_path, re-validated here against the
// cloud's own CHECK (0091's bin_files_relative_path_shape_chk): forward
// slashes, no leading or trailing slash, no empty, '.' or '..' segment, no
// backslash, no colon, no segment ending in a dot or a space (Windows strips
// both: ".. " is ".."), at most 1024 characters. Then it is joined under the
// location's root and must stay under it; then the realpath of both is taken
// and the containment checked again, so a symlink or junction inside the
// share cannot point outside it.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

const TRAILING_DOT_OR_SPACE_RE = /[. ]$/;

/** 0091's relative_path shape (the desktop's isSafeRelativePath, copied). */
export function isSafeRelativePath(p) {
  if (typeof p !== 'string' || !p || p.length > 1024) return false;
  if (/(^\/|\/$|\/\/|\\|:)/.test(p)) return false;
  // GW2: NUL is refused too; node:fs refuses it anyway, but the rule should say so itself.
  if (p.includes('\0')) return false;
  return !p.split('/').some((seg) => seg === '.' || seg === '..' || TRAILING_DOT_OR_SPACE_RE.test(seg));
}

// The ROOT's shape chooses the path rules, not the computer's (the desktop's
// comment, kept): a network address (\\server\share) or a drive letter is
// joined and compared the Windows way on every platform, backslashes and
// case-folded; a POSIX root (/locations/nas/footage) the POSIX way.
const WINDOWS_ROOT_RE = /^(?:[A-Za-z]:[\\/]|\\\\)/;
export function rootPathModule(root) {
  return WINDOWS_ROOT_RE.test(String(root || '')) ? path.win32 : path.posix;
}

/** True when `candidate` is strictly below `root` by the root's own rules. */
export function isStrictlyUnder(root, candidate) {
  if (typeof root !== 'string' || typeof candidate !== 'string' || !root || !candidate) return false;
  const mod = rootPathModule(root);
  if (rootPathModule(candidate) !== mod) return false;
  const fold = (p) => (mod === path.win32 ? p.toLowerCase() : p);
  // Both keys lose their trailing separators: path.win32.resolve keeps one on
  // a bare share (\\server\share\), which made the root count as inside itself.
  const rootKey = fold(mod.resolve(root)).replace(/[\\/]+$/, '');
  const key = fold(mod.resolve(candidate)).replace(/[\\/]+$/, '');
  return key !== rootKey && key.startsWith(rootKey + mod.sep);
}

/**
 * The location's root joined with the relative path, or null when the path is
 * not the database's shape or the result would leave the root (the desktop's
 * resolveCloudFilePath, given the root directly).
 */
export function joinUnderRoot(root, relativePath) {
  if (typeof root !== 'string' || !root || !isSafeRelativePath(relativePath)) return null;
  const mod = rootPathModule(root);
  const joined = mod.join(root, ...relativePath.split('/'));
  return isStrictlyUnder(root, joined) ? joined : null;
}

/**
 * The realpath of `candidate`, when it and the realpath of `root` still
 * contain one another; null when either does not exist or a link points out.
 */
export async function realContained(root, candidate, { realpath = fs.promises.realpath } = {}) {
  let realRoot;
  let realCandidate;
  try {
    realRoot = await realpath(root);
    realCandidate = await realpath(candidate);
  } catch {
    return null;
  }
  return isStrictlyUnder(realRoot, realCandidate) ? realCandidate : null;
}
