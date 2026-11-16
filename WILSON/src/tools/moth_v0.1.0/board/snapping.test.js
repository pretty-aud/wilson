// snapping.test.js — MO4 boards: boxes, snapping and guides, stacking as the fewest z changes, the camera, and pen
// strokes held to the server's 20,000 numbers.
import { describe, it, expect } from 'vitest'
import {
  boundsOf, cornersOf, unionBounds, intersects, contains, grow, boxFrom, snapBox, snapPoint, pickCandidates,
  marqueeHits, byStack, nextZ, bottomZ, restack, clampScale, screenToBoard, boardToScreen, zoomAt, pinchCamera,
  fitCamera, viewRect, thinPoints, strokeRecord, normRotation, CAMERA_LIMITS,
} from './snapping.js'

describe('boxes', () => {
  it('an element\'s bounds, turned about its top-left corner', () => {
    expect(boundsOf({ x: 10, y: 20, w: 100, h: 50 })).toEqual({ x: 10, y: 20, w: 100, h: 50 })
    const b = boundsOf({ x: 0, y: 0, w: 100, h: 50, rotation: 90 })
    expect(b.x).toBeCloseTo(-50, 5)
    expect(b.y).toBeCloseTo(0, 5)
    expect(b.w).toBeCloseTo(50, 5)
    expect(b.h).toBeCloseTo(100, 5)
    expect(cornersOf({ x: 1, y: 2, w: 3, h: 4 })).toHaveLength(4)
  })
  it('unions, overlaps and containment', () => {
    expect(unionBounds([{ x: 0, y: 0, w: 10, h: 10 }, null, { x: 20, y: -5, w: 5, h: 5 }])).toEqual({ x: 0, y: -5, w: 25, h: 15 })
    expect(unionBounds([])).toBeNull()
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 10, w: 1, h: 1 })).toBe(true)
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 11, y: 0, w: 1, h: 1 })).toBe(false)
    expect(contains({ x: 0, y: 0, w: 10, h: 10 }, { x: 2, y: 2, w: 8, h: 8 })).toBe(true)
    expect(contains({ x: 0, y: 0, w: 10, h: 10 }, { x: 2, y: 2, w: 9, h: 8 })).toBe(false)
    expect(grow({ x: 0, y: 0, w: 10, h: 10 }, 5)).toEqual({ x: -5, y: -5, w: 20, h: 20 })
    expect(boxFrom({ x: 10, y: 0 }, { x: 0, y: 10 })).toEqual({ x: 0, y: 0, w: 10, h: 10 })
  })
})

describe('snapping', () => {
  const other = { x: 100, y: 100, w: 100, h: 50 }
  it('pulls a near edge onto another element\'s edge and draws the guide across both', () => {
    const s = snapBox({ x: 103, y: 300, w: 40, h: 40 }, [other], 6)
    expect(s.dx).toBe(-3)
    expect(s.dy).toBe(0)
    expect(s.guides).toEqual([{ axis: 'x', at: 100, from: 100, to: 340 }])
  })
  it('centres snap to centres, on both axes at once', () => {
    const s = snapBox({ x: 128, y: 103, w: 40, h: 40 }, [other], 6)
    // centre x 148 -> 150; centre y 123 -> 125
    expect(s.dx).toBe(2)
    expect(s.dy).toBe(2)
    expect(s.guides.map((g) => g.axis).sort()).toEqual(['x', 'y'])
  })
  it('nothing beyond the threshold moves, and no guide is drawn', () => {
    const s = snapBox({ x: 300, y: 300, w: 10, h: 10 }, [other], 6)
    expect(s).toEqual({ dx: 0, dy: 0, guides: [] })
  })
  it('takes the nearest of several', () => {
    const s = snapBox({ x: 205, y: 500, w: 10, h: 10 }, [other, { x: 207, y: 0, w: 0, h: 5 }], 10)
    expect(s.dx).toBe(2) // 205 -> 207, nearer than 205 -> 200
  })
  it('a point snaps the same way (a resize handle)', () => {
    expect(snapPoint({ x: 198, y: 152 }, [other], 5)).toMatchObject({ x: 200, y: 150 })
  })
  it('candidates: not the moving ones, near the view, nearest first, at most max', () => {
    const entries = [
      { id: 'a', box: { x: 0, y: 0, w: 10, h: 10 } },
      { id: 'b', box: { x: 50, y: 50, w: 10, h: 10 } },
      { id: 'far', box: { x: 100000, y: 0, w: 10, h: 10 } },
      { id: 'c', box: { x: 400, y: 400, w: 10, h: 10 } },
    ]
    const view = { x: 0, y: 0, w: 200, h: 200 }
    const got = pickCandidates(entries, ['a'], view, 1)
    expect(got).toEqual([entries[1].box])
    expect(pickCandidates(entries, new Set(), view).map((b) => b.x)).toEqual([50, 0]) // nearest the view's centre first; c is past its margin
    expect(pickCandidates(entries, new Set(), null).length).toBe(4)
  })
  it('a dragged rectangle takes what lies wholly inside it', () => {
    const entries = [{ id: 'in', box: { x: 10, y: 10, w: 5, h: 5 } }, { id: 'half', box: { x: 90, y: 90, w: 20, h: 20 } }]
    expect(marqueeHits(entries, { x: 0, y: 0, w: 100, h: 100 })).toEqual(['in'])
    expect(marqueeHits(entries, { x: 0, y: 0, w: 0.5, h: 0.5 })).toEqual([])
  })
})

describe('stacking', () => {
  const els = [
    { id: 'a', z: 0 }, { id: 'b', z: 1 }, { id: 'c', z: 2 }, { id: 'd', z: 3 },
  ]
  const order = (list, patches) => {
    const z = new Map(list.map((e) => [e.id, e.z]))
    for (const p of patches) z.set(p.id, p.z)
    return list.map((e) => ({ ...e, z: z.get(e.id) })).sort(byStack).map((e) => e.id)
  }
  it('draws in z, then id', () => {
    expect([{ id: 'b', z: 1 }, { id: 'a', z: 1 }, { id: 'c', z: 0 }].sort(byStack).map((e) => e.id)).toEqual(['c', 'a', 'b'])
    expect(nextZ(els)).toBe(4)
    expect(bottomZ(els)).toBe(-1)
    expect(nextZ([])).toBe(0)
  })
  it('to the front or the back is one change', () => {
    const front = restack(els, ['a'], 'front')
    expect(front).toEqual([{ id: 'a', z: 4 }])
    expect(order(els, front)).toEqual(['b', 'c', 'd', 'a'])
    const back = restack(els, ['d'], 'back')
    expect(back).toEqual([{ id: 'd', z: -1 }])
    expect(order(els, back)).toEqual(['d', 'a', 'b', 'c'])
  })
  it('forward and backward one place', () => {
    const spaced = [{ id: 'a', z: 0 }, { id: 'b', z: 10 }, { id: 'c', z: 20 }, { id: 'd', z: 30 }]
    const f = restack(spaced, ['b'], 'forward')
    expect(order(spaced, f)).toEqual(['a', 'c', 'b', 'd'])
    expect(f).toHaveLength(1)
    const bk = restack(spaced, ['c'], 'backward')
    expect(order(spaced, bk)).toEqual(['a', 'c', 'b', 'd'])
    expect(bk).toHaveLength(1)
  })
  it('several chosen move together, keeping their own order', () => {
    const f = restack(els, ['a', 'b'], 'forward')
    expect(order(els, f)).toEqual(['c', 'a', 'b', 'd'])
    const fr = restack(els, ['b', 'a'], 'front')
    expect(order(els, fr)).toEqual(['c', 'd', 'a', 'b'])
  })
  it('no room between whole numbers: numbered afresh, only what changes answered', () => {
    const tight = [{ id: 'a', z: 0 }, { id: 'b', z: 0 }, { id: 'c', z: 0 }]
    const f = restack(tight, ['a'], 'forward')
    expect(order(tight, f)).toEqual(['b', 'a', 'c'])
    expect(f.every((p) => Number.isInteger(p.z))).toBe(true)
  })
  it('nothing to do answers nothing', () => {
    expect(restack(els, ['d'], 'front')).toEqual([])
    expect(restack(els, ['a'], 'back')).toEqual([])
    expect(restack(els, ['zz'], 'front')).toEqual([])
    expect(restack(els, ['a'], 'sideways')).toEqual([])
    expect(restack(els, ['a', 'b', 'c', 'd'], 'forward')).toEqual([])
  })
})

describe('the camera', () => {
  const cam = { x: 100, y: 50, scale: 2 }
  it('board and screen are each other\'s inverse', () => {
    const b = screenToBoard(cam, 300, 250)
    expect(b).toEqual({ x: 100, y: 100 })
    expect(boardToScreen(cam, b.x, b.y)).toEqual({ x: 300, y: 250 })
  })
  it('zooming keeps the point under the pointer where it is, within the limits', () => {
    const z = zoomAt(cam, 300, 250, 1.5)
    expect(z.scale).toBe(3)
    expect(screenToBoard(z, 300, 250)).toEqual({ x: 100, y: 100 })
    expect(zoomAt(cam, 0, 0, 1000).scale).toBe(CAMERA_LIMITS.max)
    expect(zoomAt(cam, 0, 0, 0.0001).scale).toBe(CAMERA_LIMITS.min)
    expect(clampScale('x')).toBe(1)
  })
  it('a pinch follows the fingers: spread twice as far is twice the scale; the midpoint carries the board', () => {
    const start = { x: 0, y: 0, scale: 1 }
    const p = pinchCamera(start, { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 50, y: 100 }, { x: 250, y: 100 })
    expect(p.scale).toBe(2)
    expect(screenToBoard(p, 150, 100)).toEqual({ x: 150, y: 100 })
    const moved = pinchCamera(start, { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 110, y: 130 }, { x: 210, y: 130 })
    expect(moved.scale).toBe(1)
    expect(moved).toMatchObject({ x: 10, y: 30 })
  })
  it('fitting shows the whole board centred, never closer than full size', () => {
    const view = { w: 800, h: 600 }
    const f = fitCamera({ x: 0, y: 0, w: 2000, h: 1000 }, view, 50)
    expect(f.scale).toBeCloseTo(0.35, 5)
    const centre = screenToBoard(f, 400, 300)
    expect(centre.x).toBeCloseTo(1000, 5)
    expect(centre.y).toBeCloseTo(500, 5)
    expect(fitCamera({ x: 0, y: 0, w: 10, h: 10 }, view).scale).toBe(1)
    expect(fitCamera(null, view)).toEqual({ x: 400, y: 300, scale: 1 })
  })
  it('the view\'s rectangle on the board', () => {
    expect(viewRect({ x: -100, y: -100, scale: 2 }, { w: 400, h: 200 })).toEqual({ x: 50, y: 50, w: 200, h: 100 })
  })
})

describe('pen strokes', () => {
  it('held to the server\'s 20,000 numbers, the ends kept', () => {
    const pts = Array.from({ length: 30001 * 2 }, (_, i) => i)
    const t = thinPoints(pts)
    expect(t.length).toBeLessThanOrEqual(20000)
    expect(t.slice(0, 2)).toEqual([0, 1])
    expect(t.slice(-2)).toEqual(pts.slice(-2))
    expect(thinPoints([1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4])
  })
  it('the stored form: its box and its points relative to the box', () => {
    expect(strokeRecord([10, 20, 30, 5, 15, 40])).toEqual({ x: 10, y: 5, w: 20, h: 35, points: [0, 15, 20, 0, 5, 35] })
    expect(strokeRecord([7, 8])).toEqual({ x: 7, y: 8, w: 0, h: 0, points: [0, 0, 0.01, 0.01] })
    expect(strokeRecord([])).toBeNull()
  })
  it('rotation within the server\'s range', () => {
    expect(normRotation(370)).toBe(10)
    expect(normRotation(-190)).toBe(170)
    expect(normRotation(180)).toBe(180)
    expect(normRotation(-180)).toBe(180)
    expect(normRotation(45.123)).toBe(45.12)
  })
})
