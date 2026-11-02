// =============================================================================
// glow.js — the light at the centre of M.O.T.H.'s world (MO2a, the brief's
// item 4; MOTH_PLANNING_BRIEF.md §1.1, Audrey 2026-11-01).
//
//   * A soft gradient centred on the VIEWPORT, behind every dot and line.
//   * Its size and brightness follow the size of the WHOLE project, never the
//     folder in view: the only input is a number, catalogueSize() of the
//     catalogue (model.js), which no navigation changes. One or two items: a
//     faint first flicker. A large project: a sun, a bright white core with
//     slowly shifting colours around it.
//   * Its colour is a parameter (her Settings choice, MO2).
//   * Text and dots over the bright core get a soft shadow whose strength is
//     a smooth function of where they are, so it fades in, never snaps on.
//   * Calm mode (reduced motion): the colour shift holds still.
//   * Light mode (the lighter fallback): fewer stops, no drift, no flicker.
//
// No work when nothing moves: the glow is painted once per change of its
// inputs onto its own canvas, and the drift and the flicker are Web
// Animations on that element (hue-rotate and opacity), which the browser
// runs without a script frame. White stays white under hue-rotate, so the
// core stays white while the colours around it drift.
// =============================================================================

/** At this many things the light is a full sun; it grows on a log scale. */
export const GLOW_FULL_AT = 5000
export const DEFAULT_GLOW_COLOR = '#ffb347'
const MAX_SHADOW = 0.55

const clamp01 = (v) => Math.min(1, Math.max(0, v))
export const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** '#rgb' or '#rrggbb' to [r, g, b]; anything else falls back to the default. */
export function parseColor(hex) {
  const s = typeof hex === 'string' ? hex.trim() : ''
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s)
  const m6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s)
  if (m6) return [parseInt(m6[1], 16), parseInt(m6[2], 16), parseInt(m6[3], 16)]
  if (m3) return [parseInt(m3[1] + m3[1], 16), parseInt(m3[2] + m3[2], 16), parseInt(m3[3] + m3[3], 16)]
  return s === DEFAULT_GLOW_COLOR ? [255, 179, 71] : parseColor(DEFAULT_GLOW_COLOR)
}

const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${Math.round(clamp01(a) * 1000) / 1000})`
const mix = (c, w, t) => c.map((v, i) => Math.round(v + (w[i] - v) * t))

/**
 * glowParams({ size, color, reducedMotion, light }) ->
 *   { t, intensity, radiusFrac, coreFrac, stops: [{ at, color }],
 *     drift: { degrees, periodMs, playing }, flicker: { low, periodMs, playing } }
 * radiusFrac is a fraction of the viewport's smaller side.
 */
export function glowParams({ size = 0, color = DEFAULT_GLOW_COLOR, reducedMotion = false, light = false } = {}) {
  const n = Math.max(0, Number(size) || 0)
  const t = n === 0 ? 0 : clamp01(Math.log10(n + 1) / Math.log10(GLOW_FULL_AT + 1))
  const intensity = n === 0 ? 0 : 0.1 + 0.9 * Math.pow(t, 1.15)
  const radiusFrac = n === 0 ? 0 : 0.14 + 0.48 * t
  const coreFrac = 0.24 * smoothstep(0.3, 1, t) // the white core appears as the project grows
  const c = parseColor(color)
  const white = [255, 255, 255]
  const stops = light
    ? [{ at: 0, color: rgba(mix(c, white, coreFrac > 0 ? 0.7 : 0.2), intensity * 0.8) }, { at: 1, color: rgba(c, 0) }]
    : [
        { at: 0, color: rgba(mix(c, white, 0.35 + 0.65 * smoothstep(0.3, 1, t)), intensity) },
        { at: Math.max(0.02, coreFrac), color: rgba(mix(c, white, 0.6 * smoothstep(0.3, 1, t)), intensity * 0.92) },
        { at: Math.min(0.9, Math.max(0.05, coreFrac) + 0.3), color: rgba(c, intensity * 0.45) },
        { at: 1, color: rgba(c, 0) },
      ]
  const still = reducedMotion || light || n === 0
  return {
    t, intensity, radiusFrac, coreFrac, stops,
    drift: { degrees: still ? 0 : Math.round(14 + 26 * t), periodMs: 26000, playing: !still },
    // A faint first flicker for a project of one or two things, gone by a dozen.
    flicker: { low: 1 - 0.35 * (1 - smoothstep(2, 12, n)), periodMs: 2400, playing: !still && n <= 12 },
  }
}

/**
 * The soft shadow under a dot or label at screen point (sx, sy): 0 away from
 * the core, up to MAX_SHADOW over it, scaled by how bright the light is.
 * Continuous in position and in size, so it never snaps on.
 */
export function shadowAlpha(sx, sy, glow, viewport) {
  if (!glow || glow.intensity <= 0) return 0
  const R = glow.radiusFrac * Math.min(viewport.width, viewport.height)
  if (R <= 0) return 0
  const d = Math.hypot(sx - viewport.width / 2, sy - viewport.height / 2) / R
  return MAX_SHADOW * smoothstep(0.15, 0.6, glow.intensity) * (1 - smoothstep(0.2, 0.85, d))
}

/** Paint the glow onto a 2D context sized width x height CSS px at dpr. */
export function paintGlow(ctx, glow, viewport, dpr = 1) {
  const w = viewport.width * dpr
  const h = viewport.height * dpr
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, w, h)
  if (!glow || glow.intensity <= 0) return
  const R = glow.radiusFrac * Math.min(w, h)
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, R)
  for (const s of glow.stops) g.addColorStop(s.at, s.color)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

const paintKey = (glow, viewport, dpr) => JSON.stringify([glow.stops, glow.radiusFrac, viewport.width, viewport.height, dpr])

/**
 * Own a glow canvas: paint on change only, and run the drift and the flicker
 * as Web Animations (no script frame). `element` is the glow <canvas>.
 * Returns { update(glow, viewport, dpr) -> boolean painted, paints(), destroy() }.
 */
export function mountGlow(element) {
  const ctx = element.getContext('2d')
  let key = null
  let paints = 0
  let drift = null
  let driftKey = null
  let flicker = null
  let flickerKey = null
  const stop = (a) => { if (a && typeof a.cancel === 'function') a.cancel() }
  return {
    update(glow, viewport, dpr = 1) {
      const w = Math.max(1, Math.round(viewport.width * dpr))
      const h = Math.max(1, Math.round(viewport.height * dpr))
      let painted = false
      const k = paintKey(glow, viewport, dpr)
      if (k !== key) {
        if (element.width !== w) element.width = w
        if (element.height !== h) element.height = h
        paintGlow(ctx, glow, viewport, dpr)
        key = k
        paints++
        painted = true
      }
      const dk = glow.drift.playing ? `${glow.drift.degrees}|${glow.drift.periodMs}` : 'off'
      if (dk !== driftKey) {
        stop(drift)
        drift = null
        if (glow.drift.playing && typeof element.animate === 'function') {
          drift = element.animate(
            [{ filter: 'hue-rotate(0deg)' }, { filter: `hue-rotate(${glow.drift.degrees}deg)` }],
            { duration: glow.drift.periodMs, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' },
          )
        }
        driftKey = dk
      }
      const fk = glow.flicker.playing ? `${glow.flicker.low}|${glow.flicker.periodMs}` : 'off'
      if (fk !== flickerKey) {
        stop(flicker)
        flicker = null
        if (glow.flicker.playing && typeof element.animate === 'function') {
          flicker = element.animate(
            [{ opacity: 1 }, { opacity: glow.flicker.low }],
            { duration: glow.flicker.periodMs, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' },
          )
        }
        flickerKey = fk
      }
      return painted
    },
    paints: () => paints,
    destroy() { stop(drift); stop(flicker); drift = flicker = null },
  }
}
