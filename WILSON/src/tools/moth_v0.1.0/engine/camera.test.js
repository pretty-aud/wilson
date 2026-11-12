// =============================================================================
// camera.test.js — pan, zoom and fly-to (MO2a). Each rule carries a PLANTED
// fault that the same assertion must catch, so a green run cannot mean the
// check was blind.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { camera, worldToScreen, screenToWorld, panBy, zoomAt, pinch, flyTo, visibleWorldRect, wheelFactor, ZOOM_MIN, ZOOM_MAX } from './camera.js'

const VP = { width: 1000, height: 600 }
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

/** The rule: the world point under the cursor stays under the cursor. */
const anchored = (zoom, cam, sx, sy, f) => {
  const before = screenToWorld(cam, VP, sx, sy)
  const after = zoom(cam, VP, f, sx, sy)
  const s = worldToScreen(after, VP, before.x, before.y)
  return close(s.x, sx, 1e-6) && close(s.y, sy, 1e-6)
}

describe('camera', () => {
  it('world and screen are inverse', () => {
    const cam = camera(120, -40, 2.5)
    const w = screenToWorld(cam, VP, 731, 12)
    const s = worldToScreen(cam, VP, w.x, w.y)
    expect(close(s.x, 731) && close(s.y, 12)).toBe(true)
  })

  it('zoom keeps the point under the cursor fixed, at any factor and point', () => {
    for (const [sx, sy, f] of [[0, 0, 1.3], [999, 599, 0.4], [500, 300, 2], [123, 456, 1.07]]) {
      expect(anchored(zoomAt, camera(37, 9, 0.8), sx, sy, f)).toBe(true)
    }
  })

  it('CONTROL: a zoom that scales about the centre is caught', () => {
    const naive = (cam, vp, f) => ({ ...cam, k: cam.k * f })
    expect(anchored(naive, camera(37, 9, 0.8), 123, 456, 1.5)).toBe(false)
  })

  it('zoom is clamped and a clamped zoom does not move the camera', () => {
    const cam = camera(5, 5, ZOOM_MAX)
    expect(zoomAt(cam, VP, 4, 10, 10)).toBe(cam)
    expect(zoomAt(camera(0, 0, ZOOM_MIN), VP, 0.1, 10, 10).k).toBe(ZOOM_MIN)
  })

  it('a drag moves the world with the pointer', () => {
    const cam = camera(0, 0, 2)
    const w = screenToWorld(cam, VP, 300, 200)
    const moved = panBy(cam, 40, -10)
    const s = worldToScreen(moved, VP, w.x, w.y)
    expect(close(s.x, 340) && close(s.y, 190)).toBe(true)
  })

  it('pinch keeps the world under the fingers: spread zooms, a shared move pans', () => {
    const cam = camera(0, 0, 1)
    const a0 = { x: 400, y: 300 }
    const b0 = { x: 600, y: 300 }
    const a1 = { x: 380, y: 310 }
    const b1 = { x: 620, y: 310 } // spread 200 -> 240, midpoint moved down 10
    const wMid = screenToWorld(cam, VP, 500, 300)
    const next = pinch(cam, VP, a0, b0, a1, b1)
    expect(close(next.k, 1.2)).toBe(true)
    const s = worldToScreen(next, VP, wMid.x, wMid.y)
    expect(close(s.x, 500) && close(s.y, 310)).toBe(true)
  })

  it('the visible rectangle grows with the margin and shrinks with the zoom', () => {
    const r = visibleWorldRect(camera(0, 0, 2), VP, 0)
    expect([r.minX, r.maxX, r.minY, r.maxY]).toEqual([-250, 250, -150, 150])
    const m = visibleWorldRect(camera(0, 0, 2), VP, 20)
    expect(m.maxX).toBe(260)
  })

  it('a wheel step zooms in for negative deltas and is bounded for huge ones', () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1)
    expect(wheelFactor(100)).toBeLessThan(1)
    expect(wheelFactor(1e9)).toBe(wheelFactor(600))
    expect(wheelFactor(-3, 1)).toBe(wheelFactor(-48))
  })
})

describe('fly-to', () => {
  const from = camera(0, 0, 1)
  const to = { x: 4000, y: -3000, k: 2 }

  it('starts at the start, ends exactly at the target, and is done at its duration', () => {
    const p = flyTo(from, to, VP, 600)
    expect(p.at(0)).toEqual({ x: 0, y: 0, k: 1 })
    expect(p.at(600)).toEqual({ x: 4000, y: -3000, k: 2 })
    expect(p.done(599)).toBe(false)
    expect(p.done(600)).toBe(true)
  })

  it('a long hop pulls the zoom out midway; a short one does not', () => {
    const long = flyTo(from, to, VP, 600)
    const mid = long.at(300)
    // Without the dip the zoom would be at the log midpoint, sqrt(2).
    expect(mid.k).toBeLessThan(Math.SQRT2 * 0.95)
    const short = flyTo(from, { x: 10, y: 0, k: 1 }, VP, 600)
    expect(close(short.at(300).k, 1)).toBe(true)
  })

  it('reduced motion (0 ms) is a jump', () => {
    const p = flyTo(from, to, VP, 0)
    expect(p.duration).toBe(0)
    expect(p.done(0)).toBe(true)
    expect(p.at(0)).toEqual({ x: 4000, y: -3000, k: 2 })
  })

  it('CONTROL: a path that never reaches its target is caught by the same end check', () => {
    const lazy = { at: (t) => ({ x: to.x * Math.min(1, t / 600) * 0.99, y: to.y, k: 2 }) }
    expect(lazy.at(600)).not.toEqual({ x: 4000, y: -3000, k: 2 })
  })
})
