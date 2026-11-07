// mothAppearance.js — MO2: Settings' appearance (the brief §3.1): the light's colour, what sizes a dot, what colours
// it, and the lighter mode. Kept per person and company in moth_prefs (0123), read back as untrusted.
import { DEFAULT_GLOW_COLOR } from '../engine/glow.js'
import { OVERRIDES } from '../engine/governor.js'
import { defaultRadius } from '../engine/model.js'

export const DEFAULT_APPEARANCE = Object.freeze({ glow: DEFAULT_GLOW_COLOR, size_by: 'contents', colour_by: 'kind', light: 'auto' })
/** The light's colours on offer: the default warmth, and a few calmer ones. Any other is a custom colour. */
export const GLOW_SWATCHES = Object.freeze([
  ['#ffb347', 'Warm'], ['#ffd8a8', 'Candle'], ['#9fd3ff', 'Moonlight'], ['#b8f2d0', 'Mint'], ['#d7c4ff', 'Lilac'], ['#ffffff', 'White'],
])
export const SIZE_BY = Object.freeze([['contents', 'What is inside'], ['recency', 'How recently it changed']])
export const COLOUR_BY = Object.freeze([['kind', 'What it is'], ['file_type', 'Type of file'], ['tag', 'Tag'], ['editor', 'Who last changed it']])
export const LIGHTER = Object.freeze([['auto', 'When this computer needs it'], ['full', 'Never'], ['light', 'Always']])

/** Settings as Moth reads them: each value only in its own words, else the default. */
export function normalizeAppearance(raw) {
  const a = raw && typeof raw === 'object' ? raw : {}
  return {
    glow: typeof a.glow === 'string' && /^#[0-9a-f]{6}$/.test(a.glow) ? a.glow : DEFAULT_APPEARANCE.glow,
    size_by: SIZE_BY.some(([k]) => k === a.size_by) ? a.size_by : DEFAULT_APPEARANCE.size_by,
    colour_by: COLOUR_BY.some(([k]) => k === a.colour_by) ? a.colour_by : DEFAULT_APPEARANCE.colour_by,
    light: OVERRIDES.includes(a.light) ? a.light : DEFAULT_APPEARANCE.light,
  }
}

// Pale tints that read on the dark world and never on orange: colour by never uses the kit's signal colour, which
// is the selection's.
const TINTS = Object.freeze(['#ffd28a', '#9fd3ff', '#b8f2d0', '#ffb3c7', '#d7c4ff', '#fff1a8', '#a8f0ec', '#ffc8a8', '#c9e7a8', '#e0c8b0'])
const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return h >>> 0 }

/** A file's family, for colour by type: from its kind and mime type, never its name. */
export function fileFamily(node) {
  const mime = String(node?.mime ?? '')
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (/pdf|word|document|text|markdown|sheet|presentation/.test(mime)) return 'document'
  if (/model|gltf|fbx|obj|usd/.test(mime) || node?.fileKind === 'model') return 'model'
  return 'other'
}
const FAMILY_TINT = Object.freeze({ image: TINTS[1], video: TINTS[3], audio: TINTS[5], document: TINTS[2], model: TINTS[4], other: null })

/**
 * Settings' colour by, as the renderer's colour function (node -> CSS colour, or null for its kind's own).
 * 'editor' asks `editorOf(node)` for who last changed a file (an id), coloured by a stable hash of it.
 */
export function colourFor(colourBy, { editorOf = () => null } = {}) {
  if (colourBy === 'file_type') return (n) => (n.kind === 'file' ? FAMILY_TINT[fileFamily(n)] : null)
  if (colourBy === 'tag') return (n) => (n.kind === 'file' && n.tags?.length ? TINTS[hash(n.tags[0]) % TINTS.length] : null)
  if (colourBy === 'editor') return (n) => { if (n.kind !== 'file') return null; const who = editorOf(n); return who ? TINTS[hash(who) % TINTS.length] : null }
  return null
}

/** Settings' size by: what is inside (the engine's own), or how recently it changed (newer is larger). */
export function radiusFor(sizeBy, { now = () => Date.now() } = {}) {
  if (sizeBy !== 'recency') return defaultRadius
  const t = now()
  return (n) => {
    const at = n.updatedAt ? Date.parse(n.updatedAt) : NaN
    const days = Number.isFinite(at) ? Math.max(0, (t - at) / 86400000) : 365
    const fresh = Math.max(0, 1 - Math.log1p(days) / Math.log1p(365))
    const base = n.kind === 'file' ? 3 : n.kind === 'tag' ? 5 : 4.5
    return base + 6 * fresh
  }
}
