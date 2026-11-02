// =============================================================================
// camera.js — the viewport onto M.O.T.H.'s world (MO2a, the brief's item 3).
//
// Pure. A camera is { x, y, k }: the world point at the viewport's centre and
// the zoom. The world moves; the HUD does not (brief §3), so everything here
// is about the world layer only.
// =============================================================================

export const ZOOM_MIN = 0.05
export const ZOOM_MAX = 8
/** A fly-to never lasts longer than this, whatever it is asked. */
export const MAX_FLY_MS = 2000

// Nothing that is not a finite number ever enters a camera: a NaN zoom would
// poison every later move, and a NaN or endless duration would keep frames
// coming for ever.
const clampK = (k, fallback = 1) => (Number.isFinite(k) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k)) : fallback)
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback)

/** A bounded duration: finite, 0..MAX_FLY_MS; anything else is 0 (a jump). */
export const boundedMs = (ms) => (Number.isFinite(ms) ? Math.min(MAX_FLY_MS, Math.max(0, ms)) : 0)

export const camera = (x = 0, y = 0, k = 1) => ({ x: num(x, 0), y: num(y, 0), k: clampK(k) })

/** viewport = { width, height } in CSS pixels. */
export function worldToScreen(cam, viewport, wx, wy) {
  return { x: (wx - cam.x) * cam.k + viewport.width / 2, y: (wy - cam.y) * cam.k + viewport.height / 2 }
}

export function screenToWorld(cam, viewport, sx, sy) {
  return { x: (sx - viewport.width / 2) / cam.k + cam.x, y: (sy - viewport.height / 2) / cam.k + cam.y }
}

/** The world rectangle on screen, grown by `margin` screen pixels each side. */
export function visibleWorldRect(cam, viewport, margin = 0) {
  const hw = (viewport.width / 2 + margin) / cam.k
  const hh = (viewport.height / 2 + margin) / cam.k
  return { minX: cam.x - hw, minY: cam.y - hh, maxX: cam.x + hw, maxY: cam.y + hh }
}

/** Pan by a screen-pixel delta (a drag moves the world with the pointer). */
export function panBy(cam, dx, dy) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return cam
  return { x: cam.x - dx / cam.k, y: cam.y - dy / cam.k, k: cam.k }
}

/** Zoom by `factor` keeping the world point under (sx, sy) fixed on screen. */
export function zoomAt(cam, viewport, factor, sx, sy) {
  if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(sx) || !Number.isFinite(sy)) return cam
  const k = clampK(cam.k * factor, cam.k)
  if (k === cam.k) return cam
  const before = screenToWorld(cam, viewport, sx, sy)
  // After the zoom the same world point must sit at (sx, sy).
  return { x: before.x - (sx - viewport.width / 2) / k, y: before.y - (sy - viewport.height / 2) / k, k }
}

/**
 * A wheel step as a zoom factor. A trackpad pinch arrives as a wheel event
 * with ctrlKey set and small deltas, so it gets ten times the coefficient
 * (as d3-zoom does), or a pinch would crawl.
 */
export function wheelFactor(deltaY, deltaMode = 0, ctrlKey = false) {
  if (!Number.isFinite(deltaY)) return 1
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
  return Math.exp(-Math.max(-600, Math.min(600, px)) * (ctrlKey ? 0.02 : 0.002))
}

/**
 * Two-finger pinch: the camera that keeps the world under the two fingers'
 * first midpoint under their current midpoint, scaled by their spread.
 */
export function pinch(cam, viewport, a0, b0, a1, b1) {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y) || 1
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 }
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 }
  const zoomed = zoomAt(cam, viewport, d1 / d0, m0.x, m0.y)
  return panBy(zoomed, m1.x - m0.x, m1.y - m0.y)
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/**
 * A fly-to path from one camera to another over `ms`. A long hop pulls the
 * zoom out midway so the person keeps their bearings. `ms` 0 (reduced
 * motion) is a jump. Returns { duration, at(elapsedMs) -> camera, done(elapsedMs) }.
 */
export function flyTo(from, to, viewport, ms = 650) {
  const target = { x: num(to.x, from.x), y: num(to.y, from.y), k: clampK(to.k ?? from.k, from.k) }
  const duration = boundedMs(ms)
  // How far the hop is, in screens at the smaller of the two zooms.
  const span = Math.hypot(target.x - from.x, target.y - from.y) * Math.min(from.k, target.k)
  const screens = span / Math.max(1, Math.min(viewport.width, viewport.height))
  const dip = screens > 1.5 ? Math.min(0.6, 0.18 * Math.log2(screens)) : 0
  return {
    duration,
    done: (t) => t >= duration,
    at(t) {
      if (duration === 0 || t >= duration) return target
      const u = ease(Math.max(0, t) / duration)
      const lk = Math.log(from.k) + (Math.log(target.k) - Math.log(from.k)) * u
      const k = clampK(Math.exp(lk) * (1 - dip * Math.sin(Math.PI * u)))
      return { x: from.x + (target.x - from.x) * u, y: from.y + (target.y - from.y) * u, k }
    },
  }
}
