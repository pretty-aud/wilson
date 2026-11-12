// frames.test.js: MO4 boards: what a frame holds, worked out from positions, and how a frame and its things stack.
import { describe, it, expect } from 'vitest'
import { frameHolds, heldBy, frameTaking, frameBoxAround, raisePlan } from './frames.js'

const frame = (id, x, y, w, h, z = 0) => ({ id, kind: 'frame', x, y, w, h, z, rotation: 0 })
const box = (id, x, y, w, h, z = 1, kind = 'shape') => ({ id, kind, x, y, w, h, z, rotation: 0 })

describe('frameHolds', () => {
  const f = frame('f', 0, 0, 200, 100)
  it('a thing whose middle is inside, even half over the edge', () => {
    expect(frameHolds(f, box('a', 10, 10, 20, 20))).toBe(true)
    expect(frameHolds(f, box('b', 180, 40, 30, 20))).toBe(true) // middle at 195
    expect(frameHolds(f, box('c', 190, 40, 30, 20))).toBe(false) // middle at 205
  })
  it('a thing larger than the frame is not held, though its middle is inside', () => {
    expect(frameHolds(f, box('a', -50, 10, 300, 20))).toBe(false)
    expect(frameHolds(f, box('b', 10, -50, 20, 200))).toBe(false)
  })
  it('a frame in a frame as any thing: by its middle, no larger', () => {
    expect(frameHolds(f, frame('g', 10, 10, 50, 50))).toBe(true)
    expect(frameHolds(f, frame('g', 160, 10, 50, 50))).toBe(true) // its middle is inside, its edge is not
    expect(frameHolds(f, frame('g', 190, 10, 50, 50))).toBe(false) // its middle is outside
    expect(frameHolds(f, frame('g', -10, 10, 220, 50))).toBe(false) // wider than the frame
  })
  it('two frames that would hold each other: only the lower in the drawing order holds the higher', () => {
    const p = frame('p', 0, 0, 100, 100, 1)
    const q = frame('q', 10, 10, 100, 100, 2)
    expect(frameHolds(p, q)).toBe(true)
    expect(frameHolds(q, p)).toBe(false)
    // the same z: the later id is drawn on top
    expect(frameHolds(frame('a', 0, 0, 100, 100), frame('b', 0, 0, 100, 100))).toBe(true)
    expect(frameHolds(frame('b', 0, 0, 100, 100), frame('a', 0, 0, 100, 100))).toBe(false)
  })
  it('a free line as any thing; never a line tied at an end, never itself, never by a thing that is not a frame', () => {
    expect(frameHolds(f, box('k', 10, 10, 20, 20, 1, 'connector'))).toBe(true)
    expect(frameHolds(f, { ...box('k', -50, 10, 300, 20, 1, 'connector') })).toBe(false) // wider than the frame
    expect(frameHolds(f, { ...box('k', 10, 10, 20, 20, 1, 'connector'), from_id: 'a' })).toBe(false)
    expect(frameHolds(f, { ...box('k', 10, 10, 20, 20, 1, 'connector'), to_id: 'b' })).toBe(false)
    expect(frameHolds(f, f)).toBe(false)
    expect(frameHolds(box('s', 0, 0, 200, 100), box('a', 10, 10, 20, 20))).toBe(false)
  })
  it('a turned thing is judged by its bounds', () => {
    // 120 by 10: held lying flat; turned 90 degrees about its corner its bounds are 120 tall, taller than the frame.
    expect(frameHolds(f, box('t', 50, 50, 120, 10))).toBe(true)
    expect(frameHolds(f, { ...box('t', 50, 20, 120, 10), rotation: 90 })).toBe(false)
  })
})

describe('heldBy', () => {
  it('follows frames inside frames, a free line too, never a tied line, never the frames asked about', () => {
    const els = [
      frame('outer', 0, 0, 500, 500), frame('inner', 10, 10, 200, 200), box('deep', 20, 20, 10, 10),
      box('mid', 300, 300, 10, 10), box('away', 900, 900, 10, 10),
      { ...box('line', 20, 20, 10, 10, 1, 'connector'), from_id: 'deep' }, box('free', 30, 30, 10, 10, 1, 'connector'),
    ]
    expect(heldBy(els, ['outer'])).toEqual(new Set(['inner', 'deep', 'mid', 'free']))
    expect(heldBy(els, ['inner'])).toEqual(new Set(['deep', 'free']))
    expect(heldBy(new Map(els.map((e) => [e.id, e])), ['outer']).has('line')).toBe(false)
  })
  it('never loops: two frames on the same spot, the lower holds the higher and not the other way', () => {
    const els = [frame('p', 0, 0, 100, 100), frame('q', 0, 0, 100, 100), box('a', 10, 10, 10, 10)]
    expect(heldBy(els, ['p'])).toEqual(new Set(['q', 'a']))
    expect(heldBy(els, ['q'])).toEqual(new Set(['a']))
    expect(heldBy(els, ['p', 'q'])).toEqual(new Set(['a']))
  })
  it('a frame poking over its outer frame\'s edge goes with the outer frame, and with it what it holds', () => {
    // Frame selection near the outer frame's edge: the new frame sticks out by its pad of 24.
    const outer = frame('outer', 0, 0, 400, 400, 0)
    const a = box('a', 10, 10, 50, 50, 2)
    const b = box('b', 100, 10, 50, 50, 3)
    const inner = { ...frame('inner', 0, 0, 0, 0, 1), ...frameBoxAround([a, b]) }
    expect(inner.x).toBeLessThan(0)
    expect(heldBy([outer, inner, a, b], ['outer'])).toEqual(new Set(['inner', 'a', 'b']))
    expect(heldBy([outer, inner, a, b], ['inner'])).toEqual(new Set(['a', 'b']))
  })
  it('three frames deep, each poking over the edge of the one around it', () => {
    const els = [
      frame('f1', 0, 0, 400, 400, 0), frame('f2', 300, 300, 150, 150, 1), frame('f3', 420, 420, 60, 60, 2),
      box('t', 440, 440, 10, 10, 3),
    ]
    expect(heldBy(els, ['f1'])).toEqual(new Set(['f2', 'f3', 't']))
    expect(heldBy(els, ['f2'])).toEqual(new Set(['f3', 't']))
    expect(heldBy(els, ['f3'])).toEqual(new Set(['t']))
  })
  it('a thing that is not a frame holds nothing', () => {
    expect(heldBy([box('s', 0, 0, 500, 500), box('a', 10, 10, 10, 10)], ['s']).size).toBe(0)
  })
})

describe('frameTaking', () => {
  const els = [frame('low', 0, 0, 300, 300, 0), frame('high', 50, 50, 100, 100, 5), box('s', 60, 60, 10, 10, 9)]
  it('the topmost frame that would hold a dragged thing where it is now', () => {
    expect(frameTaking(els, [box('d', 60, 60, 20, 20)])?.id).toBe('high')
    expect(frameTaking(els, [box('d', 240, 240, 20, 20)])?.id).toBe('low')
    expect(frameTaking(els, [box('d', 900, 900, 20, 20)])).toBeNull()
  })
  it('by the thing\'s middle, not by where it is held: one corner inside is not enough, the middle is', () => {
    // 80 wide from x = 295: a corner lies inside "low" (which ends at 300), its middle (335) does not.
    expect(frameTaking(els, [box('d', 295, 100, 80, 20)])).toBeNull()
    // 80 wide from x = 250: it hangs 30 over the edge, and its middle (290) is inside.
    expect(frameTaking(els, [box('d', 250, 100, 80, 20)])?.id).toBe('low')
  })
  it('a thing larger than a frame is not taken by it, and falls to a frame large enough', () => {
    // 150 wide: its middle is inside both, "high" is 100 wide and cannot hold it.
    expect(frameTaking(els, [box('d', 30, 90, 150, 20)])?.id).toBe('low')
  })
  it('any one of several dragged things is enough', () => {
    expect(frameTaking(els, [box('far', 900, 900, 10, 10), box('d', 60, 60, 20, 20)])?.id).toBe('high')
  })
  it('skips the frames being moved, and answers nothing for nothing dragged', () => {
    expect(frameTaking(els, [box('d', 60, 60, 20, 20)], ['high'])?.id).toBe('low')
    expect(frameTaking(els, [box('d', 60, 60, 20, 20)], new Set(['high', 'low']))).toBeNull()
    expect(frameTaking(els, [])).toBeNull()
    expect(frameTaking(els, [null, undefined])).toBeNull()
  })
  it('a dragged frame is taken as any thing: by its middle', () => {
    expect(frameTaking(els, [frame('g', 200, 200, 50, 50)])?.id).toBe('low')
    expect(frameTaking(els, [frame('g', 260, 200, 50, 50)])?.id).toBe('low') // over the edge, its middle inside
    expect(frameTaking(els, [frame('g', 280, 200, 50, 50)])).toBeNull()
  })
  it('the same z: the later id is drawn on top', () => {
    expect(frameTaking([frame('b', 0, 0, 100, 100, 1), frame('a', 0, 0, 100, 100, 1)], [box('d', 5, 5, 10, 10)]).id).toBe('b')
  })
})

describe('frameBoxAround', () => {
  it('the union grown by the pad', () => {
    expect(frameBoxAround([{ x: 0, y: 0, w: 10, h: 10 }, { x: 50, y: 20, w: 10, h: 30 }])).toEqual({ x: -24, y: -24, w: 108, h: 98 })
    expect(frameBoxAround([{ x: 0, y: 0, w: 10, h: 10 }], 5)).toEqual({ x: -5, y: -5, w: 20, h: 20 })
    expect(frameBoxAround([])).toBeNull()
  })
})

describe('raisePlan', () => {
  it('puts the frame above everything else and its things above it, in their own order', () => {
    const els = [frame('f', 0, 0, 100, 100, 0), box('a', 0, 0, 1, 1, 3), box('b', 0, 0, 1, 1, 1), box('o', 0, 0, 1, 1, 4)]
    expect(raisePlan(els, 'f', ['a', 'b'])).toEqual([{ id: 'f', z: 5 }, { id: 'b', z: 6 }, { id: 'a', z: 7 }])
  })
  it('changes only what must change', () => {
    const els = [box('o', 0, 0, 1, 1, 2), frame('f', 0, 0, 100, 100, 5), box('a', 0, 0, 1, 1, 6), box('b', 0, 0, 1, 1, 1)]
    // b, below the frame, comes first in its own order, so a goes above it
    expect(raisePlan(els, 'f', ['a', 'b'])).toEqual([{ id: 'b', z: 6 }, { id: 'a', z: 7 }])
    // only the frame is out of place: only the frame moves
    const low = [box('o', 0, 0, 1, 1, 2), frame('f', 0, 0, 100, 100, 1), box('a', 0, 0, 1, 1, 6), box('b', 0, 0, 1, 1, 9)]
    expect(raisePlan(low, 'f', ['a', 'b'])).toEqual([{ id: 'f', z: 3 }])
    // already in place: nothing
    expect(raisePlan([box('o', 0, 0, 1, 1, 2), frame('f', 0, 0, 9, 9, 3), box('a', 0, 0, 1, 1, 8)], 'f', ['a'])).toEqual([])
  })
  it('the same z: the order by id is kept', () => {
    const els = [frame('f', 0, 0, 9, 9, 4), box('a', 0, 0, 1, 1, 4), box('b', 0, 0, 1, 1, 4)]
    expect(raisePlan(els, 'f', ['a', 'b'])).toEqual([{ id: 'a', z: 5 }, { id: 'b', z: 6 }])
  })
  it('no frame: the things alone go above everything else', () => {
    const els = [frame('f', 0, 0, 9, 9, 4), box('a', 0, 0, 1, 1, 1)]
    expect(raisePlan(els, null, ['a'])).toEqual([{ id: 'a', z: 5 }])
    expect(raisePlan(els, null, [])).toEqual([])
  })
})
