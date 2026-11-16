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

// MO5: what this person keeps on this computer, per person and company: the folder cards' size, whether a dot let go
// glides on, and whether a dragged dot carries what is joined to it. The server's own settings (set_moth_prefs, 0123)
// take only the four above, so these stay here. Read back as untrusted; a browser that keeps nothing keeps the
// defaults for the visit.
export const CARD_LIMITS = Object.freeze({ minW: 200, minH: 140, maxW: 640, maxH: 900 })
export const DEFAULT_LOCAL = Object.freeze({ card_w: 280, card_h: 320, glide: true, carry: false })
const LOCAL_KEY = 'wilson.moth.local.v1'
const LOCAL_SCOPES = 10
const storageOf = () => { try { return typeof window !== 'undefined' ? window.localStorage ?? null : null } catch { return null } }
const whole = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d)

/** One person's own, each value only in its own shape, else the default. */
export function normalizeLocal(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  return {
    card_w: whole(r.card_w, CARD_LIMITS.minW, CARD_LIMITS.maxW, DEFAULT_LOCAL.card_w),
    card_h: whole(r.card_h, CARD_LIMITS.minH, CARD_LIMITS.maxH, DEFAULT_LOCAL.card_h),
    glide: typeof r.glide === 'boolean' ? r.glide : DEFAULT_LOCAL.glide,
    carry: typeof r.carry === 'boolean' ? r.carry : DEFAULT_LOCAL.carry,
  }
}

/** This person's own (scope: `${userId}|${companyId}`). */
export function readLocalPrefs(scope, storage = storageOf()) {
  let all = null
  try { all = JSON.parse(storage?.getItem(LOCAL_KEY) ?? 'null') } catch { all = null }
  return normalizeLocal(all && typeof all === 'object' ? all[scope] : null)
}

/** Kept for the next visit, the newest ten people-and-companies; what cannot be kept is kept for this visit only. */
export function writeLocalPrefs(scope, patch, storage = storageOf()) {
  const next = normalizeLocal({ ...readLocalPrefs(scope, storage), ...patch })
  try {
    let all = JSON.parse(storage?.getItem(LOCAL_KEY) ?? 'null')
    if (!all || typeof all !== 'object' || Array.isArray(all)) all = {}
    all[scope] = { ...next, at: Date.now() }
    const kept = Object.entries(all).sort((a, b) => (Number(b[1]?.at) || 0) - (Number(a[1]?.at) || 0)).slice(0, LOCAL_SCOPES)
    storage?.setItem(LOCAL_KEY, JSON.stringify(Object.fromEntries(kept)))
  } catch { /* a browser that keeps nothing */ }
  return next
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
