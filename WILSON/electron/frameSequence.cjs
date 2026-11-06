// electron/frameSequence.cjs — MO1 (MOTH NS-X07): is this list of file names one numbered frame sequence?
// Lifted from rabbitBins.cjs's detectSequence, the rules and their reasons with it, so the office-server
// walk answers as Bins does. It reads no disk and closes over nothing: the walk sends its source to a
// worker thread (networkShareWalk.cjs).
'use strict';

const SEQUENCE_EXTS = ['.exr', '.dpx', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.tga'];

function classifySequence(names, exts) {
  const frameRe = /^(.*?)([._-]?)(\d{1,8})(\.[A-Za-z0-9]{1,5})$/;
  const frameExts = new Set(exts);
  const extOf = (name) => {
    const dot = name.lastIndexOf('.');
    return dot < 0 ? '' : name.slice(dot).toLowerCase();
  };
  if (names.length < 2) return null;
  // A few sidecars beside the frames (Thumbs.db, a render log, an .md5) do
  // not stop the folder being a sequence (adversarial review): files whose
  // extension is not a frame type are set aside and reported — up to three,
  // or 5% of a big folder, never more than ten (review round 2: the floor was
  // two, which refused the three sidecars this very comment names). Anything
  // more, or a second frame series, and it is a folder.
  const files = names.filter((name) => frameExts.has(extOf(name)));
  const sidecars = names.length - files.length;
  if (files.length < 2) return null;
  if (sidecars > Math.max(3, Math.floor(names.length * 0.05)) || sidecars > 10) return null;
  let prefix = null; let sep = ''; let ext = null; let width = null;
  const frames = [];
  let padWidth = null; // the width of the zero-padded frames, if any
  let unpaddedMin = Infinity; // the shortest unpadded number seen
  for (const name of files) {
    const m = frameRe.exec(name);
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
    if (padded) {
      if (padWidth === null) padWidth = m[3].length;
      else if (padWidth !== m[3].length) return null;
    } else unpaddedMin = Math.min(unpaddedMin, m[3].length);
    frames.push({ name, n: Number(m[3]) });
  }
  if (padWidth !== null && unpaddedMin < padWidth) return null;
  frames.sort((a, b) => a.n - b.n);
  return { prefix, sep, ext, width, frames, sidecars };
}

module.exports = { classifySequence, SEQUENCE_EXTS };
