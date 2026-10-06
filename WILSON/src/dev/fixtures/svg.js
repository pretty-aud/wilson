// =============================================================================
// svg.js — generated placeholder pictures for the fixture dataset.
//
// Thumbnails, posters, avatars and the project cover are SVG data URIs built
// here at load time: no binaries in the repo, nothing fetched, and every
// picture is recognisably a placeholder (a label over a flat tint). The tints
// are DATA — the pixels of a fake thumbnail — not UI colour, so the plan's
// "no hex outside @theme" rule (which governs chrome) does not reach them;
// the same distinction Bins draws for its colour labels (binMedia.COLOR_HEX).
// =============================================================================

const TINTS = {
  slate:  ['#3b4252', '#d8dee9'],
  moss:   ['#3f4f3a', '#dbe7c9'],
  rust:   ['#6b3a2a', '#f3d3c2'],
  sea:    ['#2b4c5c', '#cfe6ee'],
  plum:   ['#4a3550', '#e7d6ee'],
  sand:   ['#6d5a3a', '#f1e6cf'],
  ink:    ['#26221f', '#d6d3d1'],
  ember:  ['#7a3f1a', '#f6dcc4'],
}

export const TINT_NAMES = Object.keys(TINTS)

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function toDataUri(svg) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

/**
 * A 16:9 (by default) placeholder: a tinted field, a faint frame, a label.
 * @param {{ label: string, sub?: string, tint?: string, w?: number, h?: number }} o
 */
export function placeholder({ label, sub = '', tint = 'slate', w = 320, h = 180 }) {
  const [bg, fg] = TINTS[tint] || TINTS.slate
  const fs = Math.round(h / 9)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="${bg}"/>` +
    `<rect x="6" y="6" width="${w - 12}" height="${h - 12}" fill="none" stroke="${fg}" stroke-opacity="0.35" stroke-width="2"/>` +
    `<line x1="6" y1="6" x2="${w - 6}" y2="${h - 6}" stroke="${fg}" stroke-opacity="0.12" stroke-width="2"/>` +
    `<text x="${w / 2}" y="${h / 2 - (sub ? fs * 0.2 : -fs * 0.35)}" text-anchor="middle" font-family="Geist, Segoe UI, sans-serif" font-size="${fs}" font-weight="600" fill="${fg}">${esc(label)}</text>` +
    (sub ? `<text x="${w / 2}" y="${h / 2 + fs * 0.9}" text-anchor="middle" font-family="Geist Mono, Consolas, monospace" font-size="${Math.round(fs * 0.6)}" fill="${fg}" fill-opacity="0.8">${esc(sub)}</text>` : '') +
    `</svg>`
  return toDataUri(svg)
}

/** A square avatar: initials on a tint. */
export function avatar({ initials, tint = 'slate', size = 128 }) {
  const [bg, fg] = TINTS[tint] || TINTS.slate
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="${size / 2}" fill="${bg}"/>` +
    `<text x="50%" y="50%" dy="0.36em" text-anchor="middle" font-family="Geist, Segoe UI, sans-serif" font-size="${Math.round(size * 0.42)}" font-weight="600" fill="${fg}">${esc(initials)}</text>` +
    `</svg>`
  return toDataUri(svg)
}

/** Tint by index, so a list of things cycles through the palette. */
export function tintFor(i) {
  return TINT_NAMES[Math.abs(i) % TINT_NAMES.length]
}
