// connectors.test.js — MO4 boards: a connector's ends follow their elements by id and anchor; the three routes;
// each end's head; the label's place; the stored form the server keeps (0130: w, h never negative, 128 numbers).
import { describe, it, expect } from 'vitest'
import {
  ANCHORS, anchorPoint, autoSide, centreOf, connectorEnds, connectorRecord, connectorsTouching, containsPoint,
  endAngles, headInset, headShape, labelPoint, pickAnchor, routeBounds, routePoints, toBoard, toLocal, trimForHeads,
} from './connectors.js'

const box = (over = {}) => ({ id: 'a', kind: 'shape', shape: 'rectangle', x: 100, y: 100, w: 200, h: 100, rotation: 0, ...over })
const close = (p, q) => { expect(p.x).toBeCloseTo(q.x, 5); expect(p.y).toBeCloseTo(q.y, 5) }

describe('anchors', () => {
  it('are the server\'s six', () => {
    expect(ANCHORS).toEqual(['auto', 'top', 'right', 'bottom', 'left', 'center'])
  })
  it('sit on the middle of each side and face outward', () => {
    const a = box()
    close(anchorPoint(a, 'top'), { x: 200, y: 100 })
    close(anchorPoint(a, 'right'), { x: 300, y: 150 })
    close(anchorPoint(a, 'bottom'), { x: 200, y: 200 })
    close(anchorPoint(a, 'left'), { x: 100, y: 150 })
    close(anchorPoint(a, 'center'), { x: 200, y: 150 })
    expect(anchorPoint(a, 'right')).toMatchObject({ side: 'right', nx: 1, ny: 0 })
    expect(anchorPoint(a, 'top').ny).toBe(-1)
  })
  it('turn with the element (about its top-left corner)', () => {
    const a = box({ x: 0, y: 0, w: 100, h: 50, rotation: 90 })
    // Turned a quarter: its right side now faces down.
    const r = anchorPoint(a, 'right')
    close(r, { x: 0 - 25, y: 100 })
    expect(r.nx).toBeCloseTo(0, 5)
    expect(r.ny).toBeCloseTo(1, 5)
    close(toLocal(a, ...Object.values(toBoard(a, 30, 20))), { x: 30, y: 20 })
  })
  it('a circle\'s anchors are on its round outline, not its box', () => {
    const c = box({ shape: 'circle', x: 0, y: 0, w: 200, h: 100 })
    close(anchorPoint(c, 'left'), { x: 50, y: 50 })
    close(anchorPoint(c, 'right'), { x: 150, y: 50 })
  })
  it('"auto" takes the side that faces the other end', () => {
    const a = box()
    expect(autoSide(a, { x: 1000, y: 160 })).toBe('right')
    expect(autoSide(a, { x: -500, y: 140 })).toBe('left')
    expect(autoSide(a, { x: 210, y: -900 })).toBe('top')
    expect(autoSide(a, { x: 190, y: 900 })).toBe('bottom')
    expect(anchorPoint(a, 'auto', { x: 1000, y: 150 }).side).toBe('right')
    expect(anchorPoint(a, 'nonsense', { x: 200, y: -1000 }).side).toBe('top')
  })
  it('a drop near an anchor takes it; anywhere else on the element is auto', () => {
    const a = box()
    expect(pickAnchor(a, { x: 302, y: 149 }, 10)).toBe('right')
    expect(pickAnchor(a, { x: 201, y: 151 }, 10)).toBe('center')
    expect(pickAnchor(a, { x: 140, y: 120 }, 10)).toBe('auto')
  })
  it('inside an element, turned or not', () => {
    const a = box()
    expect(containsPoint(a, { x: 150, y: 150 })).toBe(true)
    expect(containsPoint(a, { x: 99, y: 150 })).toBe(false)
    expect(containsPoint(a, { x: 99, y: 150 }, 2)).toBe(true)
    const t = box({ x: 0, y: 0, w: 100, h: 20, rotation: 90 })
    expect(containsPoint(t, { x: -10, y: 50 })).toBe(true)
    expect(containsPoint(t, { x: 50, y: 10 })).toBe(false)
    close(centreOf(t), { x: -10, y: 50 })
  })
})

describe('connectorEnds', () => {
  const a = box({ id: 'a', x: 0, y: 0, w: 100, h: 100 })
  const b = box({ id: 'b', x: 400, y: 0, w: 100, h: 100 })
  const els = new Map([[a.id, a], [b.id, b]])
  const lookup = (id) => els.get(id) ?? null

  it('tied ends follow their elements (auto faces the other element)', () => {
    const c = { id: 'c', kind: 'connector', x: 0, y: 0, w: 0, h: 0, points: [0, 0, 1, 1], from_id: 'a', from_anchor: 'auto', to_id: 'b', to_anchor: 'auto' }
    const ends = connectorEnds(c, lookup)
    close(ends.start, { x: 100, y: 50 })
    close(ends.end, { x: 400, y: 50 })
    // b moves below: the ends turn to face each other.
    els.set('b', { ...b, x: 0, y: 400 })
    const after = connectorEnds(c, lookup)
    close(after.start, { x: 50, y: 100 })
    close(after.end, { x: 50, y: 400 })
    els.set('b', b)
  })
  it('a named anchor is kept whatever the other end does', () => {
    const c = { kind: 'connector', x: 0, y: 0, points: [0, 0, 1, 1], from_id: 'a', from_anchor: 'top', to_id: 'b', to_anchor: 'bottom' }
    const ends = connectorEnds(c, lookup)
    close(ends.start, { x: 50, y: 0 })
    close(ends.end, { x: 450, y: 100 })
  })
  it('a free end, or one whose element has gone, sits at its stored point (relative to the box)', () => {
    const c = { kind: 'connector', x: 10, y: 20, w: 90, h: 30, points: [0, 0, 40, 10, 90, 30], from_id: 'gone', to_id: null }
    const ends = connectorEnds(c, lookup)
    close(ends.start, { x: 10, y: 20 })
    close(ends.end, { x: 100, y: 50 })
    expect(ends.bends).toEqual([{ x: 50, y: 30 }])
  })
  it('no points: the box\'s corners', () => {
    const ends = connectorEnds({ kind: 'connector', x: 5, y: 6, w: 10, h: 20 })
    close(ends.start, { x: 5, y: 6 })
    close(ends.end, { x: 15, y: 26 })
  })
  it('an end on another connector is free (a connector ties to elements)', () => {
    els.set('k', { id: 'k', kind: 'connector', x: 0, y: 0, w: 0, h: 0 })
    const ends = connectorEnds({ kind: 'connector', x: 0, y: 0, points: [7, 8, 9, 10], from_id: 'k' }, lookup)
    close(ends.start, { x: 7, y: 8 })
    els.delete('k')
  })
  it('auto faces the first bend when there are bends', () => {
    const c = { kind: 'connector', x: 0, y: 0, points: [0, 0, 50, 300, 1, 1], from_id: 'a', to_id: 'b' }
    expect(connectorEnds(c, lookup).start.side).toBe('bottom')
  })
})

describe('routes', () => {
  const s = { x: 0, y: 0, side: 'right', nx: 1, ny: 0 }
  const e = { x: 200, y: 100, side: 'left', nx: -1, ny: 0 }
  it('straight runs through its bends', () => {
    expect(routePoints(s, e, 'straight')).toEqual({ points: [0, 0, 200, 100], bezier: false, tension: 0 })
    expect(routePoints(s, e, 'straight', [{ x: 50, y: 80 }]).points).toEqual([0, 0, 50, 80, 200, 100])
  })
  it('curved is one cubic leaving each side along its face', () => {
    const r = routePoints(s, e, 'curved')
    expect(r.bezier).toBe(true)
    expect(r.points).toHaveLength(8)
    expect(r.points[3]).toBe(0) // the first control point leaves level, to the right
    expect(r.points[2]).toBeGreaterThan(0)
    expect(r.points[4]).toBeLessThan(200) // the second arrives from the left
    expect(r.points[5]).toBe(100)
    expect(routePoints(s, e, 'curved', [{ x: 10, y: 10 }])).toMatchObject({ bezier: false, tension: 0.5 })
  })
  it('elbow turns only square', () => {
    for (const [a, b] of [[s, e], [{ x: 0, y: 0, side: 'bottom', nx: 0, ny: 1 }, e], [{ x: 0, y: 0 }, { x: 300, y: -40 }], [s, { x: 50, y: 300, side: 'top', nx: 0, ny: -1 }]]) {
      const p = routePoints(a, b, 'elbow').points
      expect(p.slice(0, 2)).toEqual([a.x, a.y])
      expect(p.slice(-2)).toEqual([b.x, b.y])
      for (let i = 2; i < p.length; i += 2) {
        const flatX = Math.abs(p[i] - p[i - 2]) < 0.01
        const flatY = Math.abs(p[i + 1] - p[i - 1]) < 0.01
        expect(flatX || flatY).toBe(true)
      }
    }
  })
  it('each end points out along the line; heads sit at the tips', () => {
    const r = routePoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 'straight')
    const a = endAngles(r)
    expect(a.end).toBeCloseTo(0, 5)
    expect(Math.abs(a.start)).toBeCloseTo(Math.PI, 5)
    expect(headShape('none', { x: 0, y: 0 }, 0, 2)).toBeNull()
    expect(headShape(undefined, { x: 0, y: 0 }, 0, 2)).toBeNull()
    for (const kind of ['arrow', 'open_arrow', 'dot', 'diamond']) {
      const h = headShape(kind, { x: 100, y: 0 }, a.end, 2)
      expect(h.data).toMatch(/^M/)
      expect((h.data.match(/-?\d*\.?\d+/g) || []).map(Number).every(Number.isFinite)).toBe(true)
      expect(h.filled).toBe(kind !== 'open_arrow')
    }
    expect(headShape('arrow', { x: 100, y: 0 }, 0, 2).data.startsWith('M100 0')).toBe(true)
  })
  it('a filled head pulls the line back so it does not poke through; a short line keeps its length', () => {
    const r = routePoints({ x: 0, y: 0 }, { x: 100, y: 0 })
    const t = trimForHeads(r, 'none', 'arrow', 2)
    expect(t.points[2]).toBeCloseTo(100 - headInset('arrow', 2), 5)
    expect(t.points[0]).toBe(0)
    expect(trimForHeads(r, 'dot', 'none', 2).points[0]).toBeCloseTo(headInset('dot', 2), 5)
    expect(trimForHeads(routePoints({ x: 0, y: 0 }, { x: 5, y: 0 }), 'arrow', 'arrow', 2).points).toEqual([0, 0, 5, 0])
    expect(headInset('open_arrow', 2)).toBe(0)
  })
  it('the label sits halfway along', () => {
    const p = labelPoint(routePoints({ x: 0, y: 0 }, { x: 100, y: 100 }, 'straight', [{ x: 100, y: 0 }]))
    close(p, { x: 100, y: 0 })
    const q = labelPoint(routePoints({ x: 0, y: 0, side: 'right', nx: 1, ny: 0 }, { x: 100, y: 0, side: 'left', nx: -1, ny: 0 }, 'curved'))
    close(q, { x: 50, y: 0 })
    expect(routeBounds(routePoints({ x: 10, y: 50 }, { x: -20, y: 5 }))).toEqual({ x: -20, y: 5, w: 30, h: 45 })
  })
})

describe('the stored form', () => {
  it('a box that is never negative and points relative to its corner', () => {
    const r = connectorRecord({ x: 300, y: 50 }, { x: 100, y: 250 })
    expect(r).toEqual({ x: 100, y: 50, w: 200, h: 200, points: [200, 0, 0, 200] })
    const back = connectorEnds({ kind: 'connector', ...r })
    close(back.start, { x: 300, y: 50 })
    close(back.end, { x: 100, y: 250 })
  })
  it('never more than the server\'s 128 numbers', () => {
    const bends = Array.from({ length: 200 }, (_, i) => ({ x: i, y: i }))
    const r = connectorRecord({ x: 0, y: 0 }, { x: 1, y: 1 }, bends)
    expect(r.points.length).toBeLessThanOrEqual(128)
    expect(r.points.length % 2).toBe(0)
  })
  it('which connectors touch a set of elements', () => {
    const els = [
      { id: 'c1', kind: 'connector', from_id: 'a', to_id: 'b' },
      { id: 'c2', kind: 'connector', from_id: 'x', to_id: null },
      { id: 'c3', kind: 'connector', from_id: null, to_id: 'b' },
      { id: 'a', kind: 'shape' },
    ]
    expect([...connectorsTouching(els, ['b'])].sort()).toEqual(['c1', 'c3'])
    expect([...connectorsTouching(els, new Set(['q']))]).toEqual([])
  })
})
