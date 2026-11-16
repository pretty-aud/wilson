// background.test.js: MO4, a board's background. The step doubles as the view zooms out, the grid sits in board
// coordinates under the camera, the marks one paint draws are bounded, and the painter draws dots, lines or nothing.
import { describe, it, expect } from 'vitest'
import {
  BACKGROUNDS, BACKGROUND_LABELS, DEFAULT_BACKGROUND, DOT_COLOUR, GRID_STEP, LINE_COLOUR, MAX_DOTS, MAX_LINES, MIN_GAP_PX,
  backgroundOf, gridLines, gridStep, paintBackground,
} from './background.js'
import { boardToScreen } from './snapping.js'

// A 2D context that writes down what it is asked to draw.
function fakeContext() {
  const calls = []
  const ctx = { calls, lineWidth: null, strokeStyle: null, fillStyle: null }
  for (const m of ['beginPath', 'moveTo', 'lineTo', 'rect', 'stroke', 'fill', 'fillRect', 'arc']) {
    ctx[m] = (...args) => { calls.push([m, ...args]) }
  }
  ctx.count = (m) => calls.filter((c) => c[0] === m).length
  return ctx
}

describe('the three backgrounds', () => {
  it('dotted grid, blank and lined grid; anything else is the dotted grid', () => {
    expect(BACKGROUNDS).toEqual(['dots', 'blank', 'lines'])
    expect(DEFAULT_BACKGROUND).toBe('dots')
    expect(BACKGROUND_LABELS).toEqual({ dots: 'Dotted grid', blank: 'Blank', lines: 'Lined grid' })
    expect(backgroundOf('lines')).toBe('lines')
    expect(backgroundOf('blank')).toBe('blank')
    expect(backgroundOf(undefined)).toBe('dots')
    expect(backgroundOf('stripes')).toBe('dots')
    expect(backgroundOf(null)).toBe('dots')
  })
})

describe('the step', () => {
  it('is 24 board units down to half size, and doubles each time its marks would be closer than 12 px', () => {
    expect(GRID_STEP).toBe(24)
    expect(MIN_GAP_PX).toBe(12)
    expect(gridStep(4)).toBe(24)
    expect(gridStep(1)).toBe(24)
    expect(gridStep(0.5)).toBe(24) // 12 px exactly
    expect(gridStep(0.49)).toBe(48)
    expect(gridStep(0.25)).toBe(48) // 12 px exactly
    expect(gridStep(0.24)).toBe(96)
    expect(gridStep(0.1)).toBe(192)
    for (const s of [0.013, 0.07, 0.3, 0.77, 1.9]) {
      const step = gridStep(s)
      expect(step * s).toBeGreaterThanOrEqual(MIN_GAP_PX)
      // Never doubled once too often.
      if (step > GRID_STEP) expect((step / 2) * s).toBeLessThan(MIN_GAP_PX)
    }
    expect(gridStep(0)).toBe(24)
    expect(gridStep(Number.NaN)).toBe(24)
  })
})

describe('where the marks fall', () => {
  it('a line passes through board 0, 0 and every mark is a whole step of the board, wherever the camera is', () => {
    for (const cam of [{ x: 400, y: 300, scale: 1 }, { x: -37.5, y: 911.25, scale: 0.37 }, { x: 13, y: -2, scale: 2.5 }]) {
      const view = { w: 800, h: 600 }
      const step = gridStep(cam.scale)
      const { xs, ys } = gridLines(cam, view, step)
      expect(xs.length).toBeGreaterThan(0)
      expect(ys.length).toBeGreaterThan(0)
      for (const x of xs) {
        expect(Number.isInteger(x)).toBe(true)
        const bx = (x - cam.x) / cam.scale
        // Within the half pixel the rounding takes, a whole number of steps from board 0.
        expect(Math.abs(bx / step - Math.round(bx / step)) * step * cam.scale).toBeLessThanOrEqual(0.5 + 1e-9)
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(view.w)
      }
      for (let i = 1; i < xs.length; i += 1) expect(Math.abs(xs[i] - xs[i - 1] - step * cam.scale)).toBeLessThanOrEqual(1)
    }
    // Board 0, 0 on screen is a crossing.
    const cam = { x: 250, y: 120, scale: 1 }
    const origin = boardToScreen(cam, 0, 0)
    const { xs, ys } = gridLines(cam, { w: 800, h: 600 }, 24)
    expect(xs).toContain(origin.x)
    expect(ys).toContain(origin.y)
  })

  it('follows a pan exactly: moved by a step\'s worth of pixels, the same marks are drawn', () => {
    const view = { w: 640, h: 480 }
    const a = gridLines({ x: 100, y: 50, scale: 1 }, view, 24)
    const b = gridLines({ x: 124, y: 74, scale: 1 }, view, 24)
    expect(b.xs).toEqual(a.xs)
    expect(b.ys).toEqual(a.ys)
    // Moved by 10 px, every mark moves by 10 px (those still on screen).
    const c = gridLines({ x: 110, y: 50, scale: 1 }, view, 24)
    expect(c.xs.filter((x) => x >= 10 && x <= view.w).sort((p, q) => p - q))
      .toEqual(a.xs.map((x) => x + 10).filter((x) => x <= view.w))
  })

  it('follows a zoom about a point: the crossing under the point stays under it', () => {
    const view = { w: 800, h: 600 }
    const before = { x: 400, y: 300, scale: 1 }
    // Zoomed by 2 about the screen point (400, 300), which is board 0, 0.
    const after = { x: 400, y: 300, scale: 2 }
    expect(gridLines(before, view, 24).xs).toContain(400)
    expect(gridLines(after, view, 24).xs).toContain(400)
    expect(gridLines(after, view, 24).xs).toContain(448)
  })

  it('is bounded whatever the zoom and the window', () => {
    const huge = { w: 20000, h: 12000 }
    for (const scale of [0.0001, 0.01, 0.5, 1, 8]) {
      const cam = { x: 3, y: 7, scale }
      const lines = gridLines(cam, huge, gridStep(scale))
      expect(lines.xs.length).toBeLessThanOrEqual(MAX_LINES)
      expect(lines.ys.length).toBeLessThanOrEqual(MAX_LINES)
      const dots = gridLines(cam, huge, gridStep(scale), { dots: true })
      expect(dots.xs.length * dots.ys.length).toBeLessThanOrEqual(MAX_DOTS)
      expect(dots.step).toBeGreaterThanOrEqual(gridStep(scale))
    }
    // An ordinary window keeps the ordinary step.
    expect(gridLines({ x: 0, y: 0, scale: 1 }, { w: 1280, h: 800 }, 24, { dots: true }).step).toBe(24)
  })

  it('a view with no size, or a camera that is not one, has no marks', () => {
    expect(gridLines({ x: 0, y: 0, scale: 1 }, { w: 0, h: 600 }, 24)).toMatchObject({ xs: [], ys: [] })
    expect(gridLines({ x: Number.NaN, y: 0, scale: 1 }, { w: 800, h: 600 }, 24)).toMatchObject({ xs: [], ys: [] })
    expect(gridLines(null, null)).toMatchObject({ xs: [], ys: [] })
  })
})

describe('the painter', () => {
  const cam = { x: 400, y: 300, scale: 1 }
  const view = { w: 800, h: 600 }

  it('the dotted grid: one filled mark at every crossing, in the quiet grey, in one fill', () => {
    const ctx = fakeContext()
    const { xs, ys } = gridLines(cam, view, 24, { dots: true })
    expect(paintBackground(ctx, { kind: 'dots', cam, view })).toBe(xs.length * ys.length)
    expect(ctx.count('rect')).toBe(xs.length * ys.length)
    expect(ctx.count('fill')).toBe(1)
    expect(ctx.count('stroke')).toBe(0)
    expect(ctx.fillStyle).toBe(DOT_COLOUR)
    // A 2 px mark centred on the crossing, on whole pixels.
    expect(ctx.calls).toContainEqual(['rect', 399, 299, 2, 2])
  })

  it('the lined grid: 1 px lines through the middle of whole pixels, across the whole view, in one stroke', () => {
    const ctx = fakeContext()
    const { xs, ys } = gridLines(cam, view, 24)
    expect(paintBackground(ctx, { kind: 'lines', cam, view })).toBe(xs.length + ys.length)
    expect(ctx.count('moveTo')).toBe(xs.length + ys.length)
    expect(ctx.count('stroke')).toBe(1)
    expect(ctx.count('rect')).toBe(0)
    expect(ctx.lineWidth).toBe(1)
    expect(ctx.strokeStyle).toBe(LINE_COLOUR)
    expect(ctx.calls).toContainEqual(['moveTo', 400.5, 0])
    expect(ctx.calls).toContainEqual(['lineTo', 400.5, 600])
    expect(ctx.calls).toContainEqual(['moveTo', 0, 300.5])
    for (const c of ctx.calls.filter((x) => x[0] === 'moveTo')) expect((c[1] + c[2]) % 1).toBe(0.5)
  })

  it('blank draws nothing; an unknown kind is the dotted grid', () => {
    const blank = fakeContext()
    expect(paintBackground(blank, { kind: 'blank', cam, view })).toBe(0)
    expect(blank.calls).toEqual([])
    const unknown = fakeContext()
    expect(paintBackground(unknown, { kind: undefined, cam, view })).toBeGreaterThan(0)
    expect(unknown.count('rect')).toBeGreaterThan(0)
  })

  it('zoomed far out, still bounded and still at least 12 px apart', () => {
    const ctx = fakeContext()
    const far = { x: 10, y: 10, scale: 0.02 }
    const n = paintBackground(ctx, { kind: 'dots', cam: far, view: { w: 3840, h: 2160 } })
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThanOrEqual(MAX_DOTS)
    const xs = [...new Set(ctx.calls.filter((c) => c[0] === 'rect').map((c) => c[1]))].sort((a, b) => a - b)
    for (let i = 1; i < xs.length; i += 1) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(MIN_GAP_PX - 1)
  })
})
