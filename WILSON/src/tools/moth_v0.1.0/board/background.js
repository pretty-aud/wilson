// background.js: MO4 (Session 4), a board's background, the pattern drawn under everything on it. Pure JS: no
// React, no Konva. BoardCanvas paints it on a layer of its own under the elements; the toolbar offers the choice.
//
// The background belongs to the board (0136): everyone who opens it sees the same one. A server that does not know
// backgrounds yet sends none, and the board is drawn on the dotted grid with no choice offered.
//
// The grid sits in board coordinates: a line, or a row of dots, passes through board x = 0 and y = 0, so it moves
// with the camera exactly as the elements do. Zoomed out, the step doubles until its marks are at least 12 px apart
// on screen, and the count of marks one paint draws is bounded whatever the zoom and the size of the window. Lines
// are 1 px wide on whole pixels (crisp); dots are small filled squares at the crossings.

export const BACKGROUNDS = Object.freeze(['dots', 'blank', 'lines'])
export const DEFAULT_BACKGROUND = 'dots'
export const BACKGROUND_LABELS = Object.freeze({ dots: 'Dotted grid', blank: 'Blank', lines: 'Lined grid' })

/** The board's step between marks, in board units, at 100 percent. */
export const GRID_STEP = 24
/** The closest two marks are ever drawn on screen, in px. */
export const MIN_GAP_PX = 12
/** At most this many lines across, and as many down, in one paint. */
export const MAX_LINES = 512
/** At most this many dots in one paint. */
export const MAX_DOTS = 20000

// Quiet greys on the board's page colour (#F7F8FA). tokens.js has no light neutral for this: its greys are the dark
// shell's inks, so the board keeps its own, as it keeps its selection and guide colours.
export const DOT_COLOUR = '#C3C9D2'
export const LINE_COLOUR = '#E3E7ED'

/** A background the board knows; anything else (absent, unknown) is the dotted grid. */
export function backgroundOf(value) {
  return BACKGROUNDS.includes(value) ? value : DEFAULT_BACKGROUND
}

/** The step, in board units, at a zoom: GRID_STEP doubled until it is at least MIN_GAP_PX apart on screen. */
export function gridStep(scale) {
  const s = Number(scale)
  let step = GRID_STEP
  if (!Number.isFinite(s) || s <= 0) return step
  for (let i = 0; i < 64 && step * s < MIN_GAP_PX; i += 1) step *= 2
  return step
}

const count = (from, to, step) => Math.max(0, Math.floor(to / step) - Math.ceil(from / step) + 1)

/**
 * Where the grid's marks fall on screen, for the camera ({ x, y, scale }: board x shows at x + bx * scale) and the
 * view ({ w, h } in px). Answers { step, xs, ys }: the step used (doubled again while the marks would be more than
 * MAX_LINES a side, or, with { dots: true }, more than MAX_DOTS in all) and the screen columns and rows, whole pixels.
 */
export function gridLines(cam, view, step = gridStep(cam?.scale), { dots = false } = {}) {
  const scale = Number(cam?.scale)
  const cx = Number(cam?.x)
  const cy = Number(cam?.y)
  const w = Number(view?.w)
  const h = Number(view?.h)
  let s = Number(step)
  if (![scale, cx, cy, w, h, s].every(Number.isFinite) || scale <= 0 || s <= 0 || w <= 0 || h <= 0) {
    return { step: Number.isFinite(s) && s > 0 ? s : GRID_STEP, xs: [], ys: [] }
  }
  // The board's edges of the view.
  const left = -cx / scale
  const right = (w - cx) / scale
  const top = -cy / scale
  const bottom = (h - cy) / scale
  for (let i = 0; i < 64; i += 1) {
    const nx = count(left, right, s)
    const ny = count(top, bottom, s)
    if (nx <= MAX_LINES && ny <= MAX_LINES && (!dots || nx * ny <= MAX_DOTS)) break
    s *= 2
  }
  const xs = []
  const ys = []
  for (let k = Math.ceil(left / s), end = Math.floor(right / s); k <= end; k += 1) xs.push(Math.round(cx + k * s * scale))
  for (let k = Math.ceil(top / s), end = Math.floor(bottom / s); k <= end; k += 1) ys.push(Math.round(cy + k * s * scale))
  return { step: s, xs, ys }
}

/** A dot's side in px: two, three when the view is zoomed well in. */
export const dotSize = (scale) => (Number(scale) >= 2 ? 3 : 2)

/**
 * Paint the background on a 2D context whose units are screen px (the caller sets the transform). Nothing for
 * blank. Answers how many marks it drew (lines, or dots).
 */
export function paintBackground(ctx, { kind, cam, view } = {}) {
  const k = backgroundOf(kind)
  if (k === 'blank' || !ctx) return 0
  const { xs, ys } = gridLines(cam, view, gridStep(cam?.scale), { dots: k === 'dots' })
  if (!xs.length && !ys.length) return 0
  ctx.beginPath()
  if (k === 'lines') {
    // A 1 px line on a whole pixel is drawn through the pixel's middle.
    for (const x of xs) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, view.h) }
    for (const y of ys) { ctx.moveTo(0, y + 0.5); ctx.lineTo(view.w, y + 0.5) }
    ctx.lineWidth = 1
    ctx.strokeStyle = LINE_COLOUR
    ctx.stroke()
    return xs.length + ys.length
  }
  const size = dotSize(cam.scale)
  const half = Math.floor(size / 2)
  for (const x of xs) for (const y of ys) ctx.rect(x - half, y - half, size, size)
  ctx.fillStyle = DOT_COLOUR
  ctx.fill()
  return xs.length * ys.length
}
