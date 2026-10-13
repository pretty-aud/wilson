// =============================================================================
// contrast.js — WCAG 2.x relative luminance and contrast, in one place.
//
// Three test files used to carry their own copy of this arithmetic
// (authContrast, lightSurface, and now tokens). One copy means one bug fixed
// once; the three-digit `#fff` expansion below was such a bug — without it
// every ratio silently became NaN and failed in a way that looked like a
// contrast problem rather than a parsing one (authContrast.test.js records
// the incident). The functions are pure and dependency-free so a test can
// import them without mounting anything.
//
// `over()` composites an alpha colour onto an opaque backdrop, because the
// rules, wells, tints and selections in the token set are alphas: their real
// contrast is against the blend, never against the raw channel values.
// =============================================================================

/** '#abc' or '#aabbcc' → [r, g, b] as 0..255 integers. Throws on anything else. */
export function hexToRgb(hex) {
  let n = String(hex).trim().replace('#', '')
  if (n.length === 3) n = n.split('').map((c) => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(n)) throw new Error(`unparseable colour: ${hex}`)
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16))
}

/** [r, g, b] (0..255) → '#rrggbb'. */
export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')
}

/** 'rgba(r, g, b, a)' or 'rgb(r, g, b)' → { r, g, b, a }. Throws on anything else. */
export function parseRgba(str) {
  const m = String(str).match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/)
  if (!m) throw new Error(`not an rgba string: ${str}`)
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) }
}

/** WCAG relative luminance of an opaque hex colour. */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex)
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two opaque hex colours, ≥ 1. */
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)]
  const [hi, lo] = x > y ? [x, y] : [y, x]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Composite an alpha colour over an opaque hex backdrop and return the
 * flattened hex. Accepts an rgba string or an opaque hex (returned as is).
 */
export function over(color, backdropHex) {
  if (/^#/.test(String(color).trim())) return rgbToHex(hexToRgb(color))
  const { r, g, b, a } = parseRgba(color)
  const bd = hexToRgb(backdropHex)
  return rgbToHex([r, g, b].map((c, i) => a * c + (1 - a) * bd[i]))
}

/** The ink at `percent` of itself over a ground, flattened — how the ladder is derived. */
export function screen(inkHex, percent, groundHex) {
  const [r, g, b] = hexToRgb(inkHex)
  return over(`rgba(${r}, ${g}, ${b}, ${percent / 100})`, groundHex)
}
