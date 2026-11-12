// =============================================================================
// A frame sequence's middle frame (design §5: "a sequence (seq) resolves to
// its middle frame by the desktop's detectSequence rule"). COPIED from
// electron/rabbitBins.cjs's detectSequence, not imported; sequence.test.mjs
// carries the desktop's own cases, copied.
//
// Two differences, both deliberate:
//   * asynchronous (one readdir), so a share that stalls never freezes the
//     gateway's event loop (BC2's hand-off §3: 5 s and 42 s measured);
//   * no stat of every frame: the desktop sums sizes and newest times for its
//     poster cache; the gateway needs only which frame is in the middle, and a
//     ten-thousand-frame folder must not cost ten thousand stats per request.
// The chosen frame is then re-contained by the caller (realpath + the root),
// and must be an allow-listed still (media.mjs), exactly as the folder was.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

// The desktop's SEQUENCE_EXTS and frame pattern, copied.
export const SEQUENCE_EXTS = new Set(['.exr', '.dpx', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.tga']);
const FRAME_RE = /^(.*?)([._-]?)(\d{1,8})(\.[A-Za-z0-9]{1,5})$/;

/** The desktop's extOf, copied: a lower-case extension of at most 12 alphanumerics, or ''. */
export function extOf(name) {
  const e = path.extname(String(name || '')).toLowerCase();
  return /^\.[a-z0-9]{1,12}$/.test(e) ? e : '';
}

/**
 * The pure half: given a folder's entries ({ name, isFile, isDirectory }),
 * describe the sequence or answer null. Same rules as the desktop: at least
 * two frames sharing one prefix, separator, extension and padding rule; no
 * subfolder; a few sidecars (up to three, or 5% of a big folder, never more
 * than ten) set aside.
 */
export function sequenceFromEntries(entries) {
  const all = entries.filter((e) => e.isFile && !e.name.startsWith('.'));
  if (all.length < 2) return null;
  if (entries.some((e) => e.isDirectory && !e.name.startsWith('.'))) return null;
  const files = all.filter((e) => SEQUENCE_EXTS.has(extOf(e.name)));
  const sidecars = all.length - files.length;
  if (files.length < 2) return null;
  if (sidecars > Math.max(3, Math.floor(all.length * 0.05)) || sidecars > 10) return null;
  let prefix = null;
  let sep = '';
  let ext = null;
  let width = null;
  const frames = [];
  let padWidth = null;
  let unpaddedMin = Infinity;
  for (const f of files) {
    const m = FRAME_RE.exec(f.name);
    if (!m) return null;
    const e = m[4].toLowerCase();
    if (prefix === null) { prefix = m[1]; sep = m[2]; ext = e; width = m[3].length; }
    else if (m[1] !== prefix || e !== ext || m[2] !== sep) return null;
    const padded = String(Number(m[3])) !== m[3];
    if (padded) { if (padWidth === null) padWidth = m[3].length; else if (padWidth !== m[3].length) return null; }
    else unpaddedMin = Math.min(unpaddedMin, m[3].length);
    frames.push({ name: f.name, n: Number(m[3]) });
  }
  if (padWidth !== null && unpaddedMin < padWidth) return null;
  frames.sort((a, b) => a.n - b.n);
  const first = frames[0].n;
  const last = frames[frames.length - 1].n;
  return {
    pattern: `${prefix}${sep}${'#'.repeat(width)}${ext}`,
    ext,
    frame_count: frames.length,
    first_frame: first,
    last_frame: last,
    missing_frames: Math.max(0, (last - first + 1) - frames.length),
    sidecars,
    middle_frame_name: frames[Math.floor(frames.length / 2)].name,
  };
}

/** One readdir of `dir`, then the pure rule; the middle frame's full path joined by the dir's own path rules. */
export async function detectSequence(dir, { readdir = fs.promises.readdir, join = path.join } = {}) {
  let dirents;
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const seq = sequenceFromEntries(dirents.map((d) => ({ name: d.name, isFile: d.isFile(), isDirectory: d.isDirectory() })));
  return seq ? { ...seq, middle_frame_path: join(dir, seq.middle_frame_name) } : null;
}
