// shapes.test.js — MO4 boards: the nineteen shapes' paths, where their words sit, and the style each kind draws
// and writes with (0130's board_style_ok is the authority on what may be written).
import { describe, it, expect } from 'vitest'
import {
  SHAPES, SHAPE_LABELS, KINDS, MISSING_WORDS, DEFAULT_STYLE, NEW_STYLE, shapePath, textBoxFor, keepsRatio, defaultSize,
  resolveStyle, sanitizeStyle, dashFor, fileTileKind, styleKeysFor, octagonPath, roundedRectPath, ellipsePath,
} from './shapes.js'

// The endpoints a path visits (control points left out), and every number it holds.
function walk(d) {
  const tokens = d.match(/[MLHVQCAZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) || []
  const pts = []
  let cmd = null
  let cur = { x: 0, y: 0 }
  let start = { x: 0, y: 0 }
  let i = 0
  const next = () => Number(tokens[i++])
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i])) cmd = tokens[i++].toUpperCase()
    if (cmd === 'Z') { cur = start; continue }
    if (cmd === 'M') { cur = { x: next(), y: next() }; start = cur; cmd = 'L' } else if (cmd === 'L') cur = { x: next(), y: next() }
    else if (cmd === 'H') cur = { x: next(), y: cur.y }
    else if (cmd === 'V') cur = { x: cur.x, y: next() }
    else if (cmd === 'Q') { next(); next(); cur = { x: next(), y: next() } } else if (cmd === 'C') { next(); next(); next(); next(); cur = { x: next(), y: next() } } else if (cmd === 'A') { next(); next(); next(); next(); next(); cur = { x: next(), y: next() } } else break
    pts.push(cur)
  }
  return { pts, numbers: tokens.filter((t) => !/^[a-z]$/i.test(t)).map(Number) }
}

describe('the nineteen shapes', () => {
  it('are the server\'s list, each with words a person reads', () => {
    expect(SHAPES).toEqual([
      'rectangle', 'rounded_rectangle', 'circle', 'oval', 'triangle', 'diamond', 'star', 'hexagon', 'arrow',
      'double_arrow', 'speech_bubble', 'process', 'decision', 'document', 'database', 'terminator', 'input_output',
      'predefined_process', 'connector_circle',
    ])
    expect(new Set(SHAPES).size).toBe(19)
    for (const s of SHAPES) {
      expect(SHAPE_LABELS[s]).toMatch(/^[A-Z][a-z ]+$/)
      expect(SHAPE_LABELS[s]).not.toMatch(/_/)
    }
    expect(KINDS).toEqual(['shape', 'connector', 'frame', 'pen', 'text', 'sticky', 'media', 'embed'])
  })

  for (const shape of SHAPES) {
    it(`${shape}: a closed path of finite numbers that stays in its box`, () => {
      for (const [w, h] of [[200, 100], [80, 160], [37.5, 12.25]]) {
        const d = shapePath(shape, w, h)
        expect(d.startsWith('M')).toBe(true)
        const { pts, numbers } = walk(d)
        expect(numbers.every(Number.isFinite)).toBe(true)
        expect(pts.length).toBeGreaterThan(2)
        for (const p of pts) {
          expect(p.x).toBeGreaterThanOrEqual(-0.01)
          expect(p.y).toBeGreaterThanOrEqual(-0.01)
          expect(p.x).toBeLessThanOrEqual(w + 0.01)
          expect(p.y).toBeLessThanOrEqual(h + 0.01)
        }
        // It reaches the box's sides: nothing is drawn shrunken in a corner.
        expect(Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x))).toBeGreaterThan(Math.min(w, h) * 0.9)
      }
    })
  }

  it('a box under half a unit either way is its rectangle, never an arc with no radius', () => {
    for (const shape of SHAPES) {
      for (const [w, h] of [[0, 0], [0, 50], [50, 0.2], [-5, 'x']]) {
        const d = shapePath(shape, w, h)
        expect(d).not.toMatch(/A/)
        expect(walk(d).numbers.every(Number.isFinite)).toBe(true)
      }
    }
  })

  it('an unknown shape draws as a rectangle', () => {
    expect(shapePath('cloud', 10, 20)).toBe(shapePath('rectangle', 10, 20))
  })

  it('a circle stays round in a wide box; an oval fills it', () => {
    const circle = shapePath('circle', 200, 100)
    expect(circle).toMatch(/A50 50 /)
    expect(shapePath('connector_circle', 200, 100)).toBe(circle)
    expect(shapePath('oval', 200, 100)).toMatch(/A100 50 /)
    expect(keepsRatio('circle')).toBe(true)
    expect(keepsRatio('connector_circle')).toBe(true)
    expect(keepsRatio('oval')).toBe(false)
  })

  it('the star fills its box from edge to edge', () => {
    const { pts } = walk(shapePath('star', 100, 80))
    expect(Math.min(...pts.map((p) => p.y))).toBeCloseTo(0, 1)
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(80, 1)
    expect(Math.min(...pts.map((p) => p.x))).toBeCloseTo(0, 1)
    expect(Math.max(...pts.map((p) => p.x))).toBeCloseTo(100, 1)
    expect(pts.length).toBe(10) // five tips and five inner corners
  })

  it('round corners: a rectangle takes the style\'s corner; a rounded rectangle has one of its own; held to half the side', () => {
    expect(shapePath('rectangle', 100, 50)).not.toMatch(/A/)
    expect(shapePath('rectangle', 100, 50, { corner: 10 })).toMatch(/A10 10/)
    expect(shapePath('rounded_rectangle', 100, 50)).toMatch(/A9 9/)
    expect(roundedRectPath(100, 50, 400)).toMatch(/A25 25/)
    expect(shapePath('terminator', 100, 40)).toMatch(/A20 20/)
  })

  it('the database has its lid line and the predefined process its two inner sides', () => {
    expect(shapePath('database', 100, 100).match(/M/g)).toHaveLength(2)
    expect(shapePath('predefined_process', 100, 50).match(/M/g)).toHaveLength(3)
  })

  it('the stop sign has eight sides; an ellipse is two half arcs', () => {
    const { pts } = walk(octagonPath(50, 50, 20))
    expect(pts).toHaveLength(8)
    for (const p of pts) expect(Math.hypot(p.x - 50, p.y - 50)).toBeCloseTo(20, 1)
    expect(ellipsePath(10, 10, 5, 3).match(/A/g)).toHaveLength(2)
  })
})

describe('textBoxFor', () => {
  it('sits inside the box for every shape, with room to write', () => {
    for (const shape of SHAPES) {
      const b = textBoxFor(shape, 200, 120)
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.x + b.w).toBeLessThanOrEqual(200.01)
      expect(b.y + b.h).toBeLessThanOrEqual(120.01)
      expect(b.w).toBeGreaterThan(40)
      expect(b.h).toBeGreaterThan(20)
    }
  })
  it('never answers a negative size', () => {
    for (const shape of SHAPES) {
      const b = textBoxFor(shape, 2, 1)
      expect(b.w).toBeGreaterThanOrEqual(0)
      expect(b.h).toBeGreaterThanOrEqual(0)
    }
  })
  it('a triangle writes in its wider lower part, a database below its lid', () => {
    expect(textBoxFor('triangle', 100, 100).y).toBeGreaterThan(30)
    expect(textBoxFor('database', 100, 100).y).toBeGreaterThan(20)
  })
})

describe('sizes', () => {
  it('places each kind at a size of its own', () => {
    expect(defaultSize('shape', 'circle')).toEqual({ w: 120, h: 120 })
    expect(defaultSize('shape', 'rectangle')).toEqual({ w: 180, h: 110 })
    expect(defaultSize('frame')).toEqual({ w: 480, h: 320 })
    expect(defaultSize('sticky')).toEqual({ w: 200, h: 200 })
    expect(defaultSize('text').w).toBeGreaterThan(defaultSize('text').h)
  })
})

describe('resolveStyle', () => {
  it('fills in each kind\'s defaults', () => {
    const s = resolveStyle('shape', {})
    expect(s.fill).toBe(DEFAULT_STYLE.shape.fill)
    expect(s.stroke).toBe(DEFAULT_STYLE.shape.stroke)
    expect(s.width).toBe(2)
    expect(s.align).toBe('center')
    expect(s.opacity).toBe(1)
    expect(s.dashArray).toBeNull()
    const c = resolveStyle('connector', null)
    expect(c.route).toBe('straight')
    expect(c.endHead).toBe('arrow')
    expect(c.startHead).toBe('none')
    expect(resolveStyle('text', {}).fill).toBeNull()
  })
  it('"none" paints nothing; a colour that is not hex is the default', () => {
    expect(resolveStyle('shape', { fill: 'none', stroke: 'none' })).toMatchObject({ fill: null, stroke: null })
    expect(resolveStyle('shape', { fill: 'red' }).fill).toBe(DEFAULT_STYLE.shape.fill)
    expect(resolveStyle('shape', { fill: '#11223344' }).fill).toBe('#11223344')
    expect(resolveStyle('shape', { text_colour: 'none' }).textColour).toBe('rgba(0,0,0,0)')
  })
  it('"colour" is a pen\'s and a connector\'s line, a sticky\'s and a shape\'s fill', () => {
    expect(resolveStyle('pen', { colour: '#FF0000' }).stroke).toBe('#FF0000')
    expect(resolveStyle('connector', { colour: '#00FF00' }).stroke).toBe('#00FF00')
    expect(resolveStyle('sticky', { colour: '#0000FF' }).fill).toBe('#0000FF')
    expect(resolveStyle('shape', { colour: '#0000FF', fill: '#FFFFFF' }).fill).toBe('#FFFFFF')
  })
  it('holds numbers to the server\'s ranges and unknown words to the defaults', () => {
    const s = resolveStyle('shape', { width: 99, opacity: -1, font_size: 1000, align: 'justify', dash: 'wavy', corner: 5000 })
    expect(s).toMatchObject({ width: 40, opacity: 0, fontSize: 400, align: 'center', dash: 'solid', corner: 1000 })
    expect(resolveStyle('connector', { route: 'zigzag', end_head: 'star' })).toMatchObject({ route: 'straight', endHead: 'arrow' })
  })
  it('dashes scale with the width; dotted draws round', () => {
    expect(dashFor('solid', 2)).toBeNull()
    expect(dashFor('dashed', 2)).toEqual([6, 4])
    expect(dashFor('dashed', 10)).toEqual([30, 20])
    expect(dashFor('dotted', 4)[1]).toBe(8)
    expect(resolveStyle('pen', { dash: 'dotted' }).lineCap).toBe('round')
  })
})

describe('sanitizeStyle — only what the server accepts leaves the client', () => {
  it('keeps the known keys of their type and range', () => {
    const style = { fill: '#FFFFFF', stroke: 'none', colour: '#123456', text_colour: '#ABCDEF12', dash: 'dashed', width: 3, opacity: 0.5, font_size: 20, align: 'right', corner: 8 }
    expect(sanitizeStyle('shape', style)).toEqual(style)
  })
  it('drops unknown keys, words in the wrong place, and strings for numbers', () => {
    expect(sanitizeStyle('shape', { fill: 'red', width: '3', label: 'x', route: 'curved', end_head: 'arrow', opacity: Number.NaN })).toEqual({})
    expect(sanitizeStyle('pen', { corner: 4, stroke: '#000000' })).toEqual({ stroke: '#000000' })
    expect(sanitizeStyle('connector', { route: 'elbow', start_head: 'dot', end_head: 'open_arrow', corner: 2 })).toEqual({ route: 'elbow', start_head: 'dot', end_head: 'open_arrow' })
  })
  it('holds numbers in range and drops a null (back to the default)', () => {
    expect(sanitizeStyle('shape', { width: 100, opacity: 2, font_size: 1, corner: -4, fill: null })).toEqual({ width: 40, opacity: 1, font_size: 6, corner: 0 })
    expect(sanitizeStyle('shape', null)).toEqual({})
  })
  it('what each kind writes when it is made is already clean', () => {
    for (const kind of KINDS) expect(sanitizeStyle(kind, NEW_STYLE[kind])).toEqual(NEW_STYLE[kind])
  })
  it('the panel offers only keys the kind may carry', () => {
    for (const kind of KINDS) {
      const keys = styleKeysFor(kind)
      const probe = Object.fromEntries(keys.map((k) => [k, ({ fill: '#FFFFFF', stroke: '#FFFFFF', text_colour: '#FFFFFF', dash: 'solid', width: 1, opacity: 1, font_size: 12, align: 'left', corner: 1, route: 'curved', start_head: 'dot', end_head: 'dot' })[k]]))
      expect(Object.keys(sanitizeStyle(kind, probe)).sort()).toEqual([...keys].sort())
    }
  })
})

describe('files', () => {
  it('a picture, a video or a file, by its type or its name', () => {
    expect(fileTileKind({ mime_type: 'image/png' })).toBe('picture')
    expect(fileTileKind({ name: 'board.JPG' })).toBe('picture')
    expect(fileTileKind({ mime_type: 'video/quicktime' })).toBe('video')
    expect(fileTileKind({ name: 'take.mov' })).toBe('video')
    expect(fileTileKind({ mime_type: 'application/pdf', name: 'script.pdf' })).toBe('file')
    expect(fileTileKind(null)).toBe('file')
  })
  it('the stop-sign tile says what happened in plain words and names nothing', () => {
    expect(MISSING_WORDS).toBe('This file is missing — it may have been moved or deleted')
  })
})
