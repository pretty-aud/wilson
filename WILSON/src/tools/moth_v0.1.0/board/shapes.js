// shapes.js — MO4 boards: the nineteen shapes as path data, where a shape's words sit, and the style each kind of
// element draws with. Pure: no Konva, no DOM, so every builder is tested on its own and the canvas only paints.
//
// Every path is drawn in the element's own box, (0, 0) to (w, h), the box the server keeps (x, y, w, h, rotation
// about the top-left corner); the canvas places and turns it. Numbers are rounded to two places so a path stays
// short. A style is read through resolveStyle (the server's keys and ranges, a default for each kind) and written
// through sanitizeStyle, which keeps only what the server accepts for that kind (0130 board_style_ok refuses the
// rest with "That style is not one a board knows.").

export const KINDS = ['shape', 'connector', 'frame', 'pen', 'text', 'sticky', 'media', 'embed']

export const SHAPES = [
  'rectangle', 'rounded_rectangle', 'circle', 'oval', 'triangle', 'diamond', 'star', 'hexagon', 'arrow',
  'double_arrow', 'speech_bubble', 'process', 'decision', 'document', 'database', 'terminator', 'input_output',
  'predefined_process', 'connector_circle',
]

/** The words a person reads for each shape (the picker, the style panel). */
export const SHAPE_LABELS = {
  rectangle: 'Rectangle',
  rounded_rectangle: 'Rounded rectangle',
  circle: 'Circle',
  oval: 'Oval',
  triangle: 'Triangle',
  diamond: 'Diamond',
  star: 'Star',
  hexagon: 'Hexagon',
  arrow: 'Arrow',
  double_arrow: 'Double arrow',
  speech_bubble: 'Speech bubble',
  process: 'Process',
  decision: 'Decision',
  document: 'Document',
  database: 'Database',
  terminator: 'Start or end',
  input_output: 'Input or output',
  predefined_process: 'Predefined process',
  connector_circle: 'Connector circle',
}

/** The stop-sign tile's words: a file that has gone or that this person may not read. Never its name. */
export const MISSING_WORDS = 'This file is missing — it may have been moved or deleted'

export const DASHES = ['solid', 'dashed', 'dotted']
export const ALIGNS = ['left', 'center', 'right']
export const ROUTES = ['straight', 'curved', 'elbow']
export const HEADS = ['none', 'arrow', 'open_arrow', 'dot', 'diamond']

const COLOUR_KEYS = ['fill', 'stroke', 'colour', 'text_colour']
const CORNER_KINDS = new Set(['shape', 'frame', 'sticky', 'media', 'embed'])
const FILL_KINDS = new Set(['shape', 'frame', 'sticky'])
const LINE_KINDS = new Set(['pen', 'connector'])
const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/

/** What a new element of each kind is drawn with when its style says nothing. */
export const DEFAULT_STYLE = {
  shape: { fill: '#FFFFFF', stroke: '#2B3440', width: 2, text_colour: '#1F2933', font_size: 16, align: 'center' },
  connector: { stroke: '#2B3440', width: 2, route: 'straight', start_head: 'none', end_head: 'arrow', text_colour: '#1F2933', font_size: 14, align: 'center' },
  frame: { fill: '#FFFFFF', stroke: '#C9D1DB', width: 1, text_colour: '#4A5563', font_size: 14, align: 'left' },
  pen: { stroke: '#2B3440', width: 3 },
  text: { text_colour: '#1F2933', font_size: 20, align: 'left' },
  sticky: { fill: '#FFE58A', text_colour: '#2A2410', font_size: 16, align: 'left', corner: 4 },
  media: { corner: 4 },
  embed: { corner: 6 },
}

/** The style written on a new element, so every viewer draws it the same whatever their defaults. */
export const NEW_STYLE = {
  shape: { fill: '#FFFFFF', stroke: '#2B3440', width: 2 },
  connector: { stroke: '#2B3440', width: 2, end_head: 'arrow' },
  frame: { fill: '#FFFFFF', stroke: '#C9D1DB', width: 1 },
  pen: { stroke: '#2B3440', width: 3 },
  text: { font_size: 20 },
  sticky: { fill: '#FFE58A' },
  media: {},
  embed: {},
}

const finite = (n, d = 0) => (Number.isFinite(Number(n)) ? Number(n) : d)
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
function fmt(n) {
  const v = Math.round(n * 100) / 100
  return Object.is(v, -0) ? '0' : String(v)
}
const pt = (x, y) => `${fmt(x)} ${fmt(y)}`

function rect(w, h) {
  return `M0 0 H${fmt(w)} V${fmt(h)} H0 Z`
}

function poly(points) {
  return `M${points.map(([x, y]) => pt(x, y)).join(' L')} Z`
}

/** A rectangle with round corners, radius held to half the shorter side. */
export function roundedRectPath(w, h, r, x0 = 0, y0 = 0) {
  const rr = clamp(finite(r), 0, Math.min(w, h) / 2)
  if (rr <= 0.01) return `M${pt(x0, y0)} H${fmt(x0 + w)} V${fmt(y0 + h)} H${fmt(x0)} Z`
  const a = `A${fmt(rr)} ${fmt(rr)} 0 0 1 `
  return [
    `M${pt(x0 + rr, y0)}`,
    `H${fmt(x0 + w - rr)}`, `${a}${pt(x0 + w, y0 + rr)}`,
    `V${fmt(y0 + h - rr)}`, `${a}${pt(x0 + w - rr, y0 + h)}`,
    `H${fmt(x0 + rr)}`, `${a}${pt(x0, y0 + h - rr)}`,
    `V${fmt(y0 + rr)}`, `${a}${pt(x0 + rr, y0)}`, 'Z',
  ].join(' ')
}

/** An ellipse as two half arcs (Konva's Path reads SVG arcs). */
export function ellipsePath(cx, cy, rx, ry) {
  const a = `A${fmt(rx)} ${fmt(ry)} 0 1 0 `
  return `M${pt(cx - rx, cy)} ${a}${pt(cx + rx, cy)} ${a}${pt(cx - rx, cy)} Z`
}

/** A regular stop sign (eight sides) about a centre, flat side up. */
export function octagonPath(cx, cy, r) {
  const pts = []
  for (let i = 0; i < 8; i += 1) {
    const a = (Math.PI / 8) + (i * Math.PI) / 4
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return poly(pts)
}

function starPoints(w, h, spikes = 5, inner = 0.45) {
  // A five-point star at its natural proportions reaches 1 up and cos(36°) down; stretched so it fills the box.
  const pts = []
  let top = Infinity
  let bottom = -Infinity
  let left = Infinity
  let right = -Infinity
  const raw = []
  for (let i = 0; i < spikes * 2; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / spikes
    const r = i % 2 === 0 ? 1 : inner
    const x = r * Math.cos(a)
    const y = r * Math.sin(a)
    raw.push([x, y])
    top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x)
  }
  for (const [x, y] of raw) pts.push([((x - left) / (right - left)) * w, ((y - top) / (bottom - top)) * h])
  return pts
}

/**
 * The path for one of the nineteen shapes in a w by h box. Unknown shapes draw as a rectangle (the server refuses
 * them anyway: 0130's board_elements_shape_chk). A box under half a unit either way draws as its rectangle, so no
 * arc is ever asked for with a zero radius.
 */
export function shapePath(shape, width, height, { corner } = {}) {
  const w = Math.max(0, finite(width))
  const h = Math.max(0, finite(height))
  if (w < 0.5 || h < 0.5) return rect(w, h)
  const c = corner == null ? null : Math.max(0, finite(corner))
  switch (shape) {
    case 'rectangle':
    case 'process':
      return c ? roundedRectPath(w, h, c) : rect(w, h)
    case 'rounded_rectangle':
      return roundedRectPath(w, h, c ?? Math.min(w, h) * 0.18)
    case 'circle':
    case 'connector_circle': {
      const d = Math.min(w, h)
      return ellipsePath(w / 2, h / 2, d / 2, d / 2)
    }
    case 'oval':
      return ellipsePath(w / 2, h / 2, w / 2, h / 2)
    case 'triangle':
      return poly([[w / 2, 0], [w, h], [0, h]])
    case 'diamond':
    case 'decision':
      return poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]])
    case 'star':
      return poly(starPoints(w, h))
    case 'hexagon':
      return poly([[w * 0.25, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [w * 0.25, h], [0, h / 2]])
    case 'arrow': {
      const head = Math.min(w * 0.5, h)
      const t = h * 0.25
      return poly([[0, h / 2 - t], [w - head, h / 2 - t], [w - head, 0], [w, h / 2], [w - head, h], [w - head, h / 2 + t], [0, h / 2 + t]])
    }
    case 'double_arrow': {
      const head = Math.min(w * 0.35, h)
      const t = h * 0.25
      return poly([
        [0, h / 2], [head, 0], [head, h / 2 - t], [w - head, h / 2 - t], [w - head, 0], [w, h / 2],
        [w - head, h], [w - head, h / 2 + t], [head, h / 2 + t], [head, h],
      ])
    }
    case 'speech_bubble': {
      const bh = h * 0.78
      const r = Math.min(w, bh) * 0.15
      const a = `A${fmt(r)} ${fmt(r)} 0 0 1 `
      return [
        `M${pt(r, 0)}`, `H${fmt(w - r)}`, `${a}${pt(w, r)}`, `V${fmt(bh - r)}`, `${a}${pt(w - r, bh)}`,
        `H${fmt(w * 0.38)}`, `L${pt(w * 0.15, h)}`, `L${pt(w * 0.22, bh)}`,
        `H${fmt(r)}`, `${a}${pt(0, bh - r)}`, `V${fmt(r)}`, `${a}${pt(r, 0)}`, 'Z',
      ].join(' ')
    }
    case 'document': {
      // The wavy foot: up from the right, down to the very bottom on the left (each quadratic peaks halfway).
      const wave = h * 0.08
      const e = h - wave
      return `M0 0 H${fmt(w)} V${fmt(e)} Q${pt(w * 0.75, h - 3 * wave)} ${pt(w * 0.5, e)} Q${pt(w * 0.25, h + wave)} ${pt(0, e)} Z`
    }
    case 'database': {
      const rx = w / 2
      const ry = Math.min(h * 0.12, w / 2)
      const a = (sweep) => `A${fmt(rx)} ${fmt(ry)} 0 0 ${sweep} `
      return `M${pt(0, ry)} ${a(1)}${pt(w, ry)} V${fmt(h - ry)} ${a(1)}${pt(0, h - ry)} Z M${pt(0, ry)} ${a(0)}${pt(w, ry)}`
    }
    case 'terminator':
      return roundedRectPath(w, h, Math.min(w, h) / 2)
    case 'input_output': {
      const s = Math.min(w * 0.2, h * 0.6)
      return poly([[s, 0], [w, 0], [w - s, h], [0, h]])
    }
    case 'predefined_process': {
      const inset = Math.min(w * 0.1, 16)
      return `${rect(w, h)} M${pt(inset, 0)} V${fmt(h)} M${pt(w - inset, 0)} V${fmt(h)}`
    }
    default:
      return rect(w, h)
  }
}

/** Where a shape's words sit inside its box (the visible inside of each outline), in the box's own units. */
export function textBoxFor(shape, width, height) {
  const w = Math.max(0, finite(width))
  const h = Math.max(0, finite(height))
  const pad = Math.min(8, w * 0.1, h * 0.1)
  const box = (x, y, bw, bh) => ({ x, y, w: Math.max(0, bw), h: Math.max(0, bh) })
  switch (shape) {
    case 'circle':
    case 'connector_circle': {
      const d = Math.min(w, h) * 0.7071
      return box((w - d) / 2, (h - d) / 2, d, d)
    }
    case 'oval':
      return box(w * 0.15, h * 0.15, w * 0.7, h * 0.7)
    case 'triangle':
      return box(w * 0.22, h * 0.42, w * 0.56, h * 0.52)
    case 'diamond':
    case 'decision':
      return box(w * 0.22, h * 0.22, w * 0.56, h * 0.56)
    case 'star':
      return box(w * 0.3, h * 0.36, w * 0.4, h * 0.4)
    case 'hexagon':
      return box(w * 0.2, h * 0.1, w * 0.6, h * 0.8)
    case 'arrow': {
      const head = Math.min(w * 0.5, h)
      return box(pad, h * 0.25, w - head * 0.6 - pad, h * 0.5)
    }
    case 'double_arrow': {
      const head = Math.min(w * 0.35, h)
      return box(head * 0.6, h * 0.25, w - head * 1.2, h * 0.5)
    }
    case 'speech_bubble':
      return box(pad, pad, w - 2 * pad, h * 0.78 - 2 * pad)
    case 'document':
      return box(pad, pad, w - 2 * pad, h * 0.84 - 2 * pad)
    case 'database': {
      const ry = Math.min(h * 0.12, w / 2)
      return box(pad, 2 * ry + pad, w - 2 * pad, h - 3 * ry - 2 * pad)
    }
    case 'input_output': {
      const s = Math.min(w * 0.2, h * 0.6)
      return box(s, pad, w - 2 * s, h - 2 * pad)
    }
    case 'predefined_process': {
      const inset = Math.min(w * 0.1, 16)
      return box(inset + pad, pad, w - 2 * inset - 2 * pad, h - 2 * pad)
    }
    case 'terminator':
      return box(Math.min(w, h) * 0.3, pad, w - Math.min(w, h) * 0.6, h - 2 * pad)
    default:
      return box(pad, pad, w - 2 * pad, h - 2 * pad)
  }
}

/** A circle keeps its roundness when resized (the transformer holds the ratio). */
export function keepsRatio(shape) {
  return shape === 'circle' || shape === 'connector_circle'
}

/** A new element's size when it is placed with a click rather than drawn. */
export function defaultSize(kind, shape) {
  if (kind === 'shape') {
    if (keepsRatio(shape)) return { w: 120, h: 120 }
    if (shape === 'arrow' || shape === 'double_arrow') return { w: 180, h: 80 }
    if (shape === 'star' || shape === 'hexagon' || shape === 'diamond' || shape === 'decision' || shape === 'triangle') return { w: 140, h: 120 }
    return { w: 180, h: 110 }
  }
  if (kind === 'frame') return { w: 480, h: 320 }
  if (kind === 'text') return { w: 240, h: 32 }
  if (kind === 'sticky') return { w: 200, h: 200 }
  return { w: 160, h: 120 }
}

const colourOr = (v, d) => {
  if (v === 'none') return null
  if (typeof v === 'string' && HEX.test(v)) return v
  return d === undefined ? undefined : d
}

/** The dash pattern a line of that width draws with (null for solid). Dotted lines draw with round caps. */
export function dashFor(dash, width) {
  const w = Math.max(1, finite(width, 1))
  if (dash === 'dashed') return [Math.max(4, w * 3), Math.max(3, w * 2)]
  if (dash === 'dotted') return [0.01, Math.max(3, w * 2)]
  return null
}

/**
 * A style as the canvas paints it: the server's keys read with each kind's defaults, values outside the server's
 * ranges held to them. `fill` and `stroke` are null for 'none' (nothing painted). `colour` is the element's own
 * colour: a fill for the kinds with an inside, the line for pens and connectors.
 */
export function resolveStyle(kind, style) {
  const s = style && typeof style === 'object' ? style : {}
  const d = DEFAULT_STYLE[kind] || {}
  const fillIn = s.fill !== undefined ? s.fill : (FILL_KINDS.has(kind) ? s.colour : undefined)
  const strokeIn = s.stroke !== undefined ? s.stroke : (LINE_KINDS.has(kind) ? s.colour : undefined)
  const fill = colourOr(fillIn, colourOr(d.fill, null) ?? null)
  const stroke = colourOr(strokeIn, colourOr(d.stroke, null) ?? null)
  const width = clamp(finite(s.width, d.width ?? 0), 0, 40)
  const dash = DASHES.includes(s.dash) ? s.dash : 'solid'
  return {
    fill: fill === undefined ? null : fill,
    stroke: stroke === undefined ? null : stroke,
    width,
    dash,
    dashArray: dashFor(dash, width),
    lineCap: dash === 'dotted' ? 'round' : 'butt',
    opacity: clamp(finite(s.opacity, 1), 0, 1),
    textColour: colourOr(s.text_colour, d.text_colour ?? '#1F2933') ?? 'rgba(0,0,0,0)',
    // board-type: the size the person chose for an element's words
    fontSize: clamp(finite(s.font_size, d.font_size ?? 16), 6, 400),
    align: ALIGNS.includes(s.align) ? s.align : (d.align ?? 'left'),
    corner: clamp(finite(s.corner, d.corner ?? 0), 0, 1000),
    route: ROUTES.includes(s.route) ? s.route : (d.route ?? 'straight'),
    startHead: HEADS.includes(s.start_head) ? s.start_head : (d.start_head ?? 'none'),
    endHead: HEADS.includes(s.end_head) ? s.end_head : (d.end_head ?? 'none'),
  }
}

/**
 * The style to write: only keys the server accepts for this kind, each of its type and in its range; a null or an
 * undefined value drops the key (back to the default). Nothing the server would refuse leaves the client.
 */
export function sanitizeStyle(kind, style) {
  const out = {}
  if (!style || typeof style !== 'object') return out
  for (const [k, v] of Object.entries(style)) {
    if (v == null) continue
    if (COLOUR_KEYS.includes(k)) {
      if (typeof v === 'string' && (v === 'none' || HEX.test(v))) out[k] = v
    } else if (k === 'dash') {
      if (DASHES.includes(v)) out[k] = v
    } else if (k === 'width') {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = clamp(v, 0, 40)
    } else if (k === 'opacity') {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = clamp(v, 0, 1)
    } else if (k === 'font_size') {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = clamp(v, 6, 400)
    } else if (k === 'align') {
      if (ALIGNS.includes(v)) out[k] = v
    } else if (k === 'route') {
      if (kind === 'connector' && ROUTES.includes(v)) out[k] = v
    } else if (k === 'start_head' || k === 'end_head') {
      if (kind === 'connector' && HEADS.includes(v)) out[k] = v
    } else if (k === 'corner') {
      if (CORNER_KINDS.has(kind) && typeof v === 'number' && Number.isFinite(v)) out[k] = clamp(v, 0, 1000)
    }
  }
  return out
}

/** Which keys the style panel offers for a kind. */
export function styleKeysFor(kind) {
  switch (kind) {
    case 'shape': return ['fill', 'stroke', 'width', 'dash', 'text_colour', 'font_size', 'align', 'opacity', 'corner']
    case 'frame': return ['fill', 'stroke', 'width', 'dash', 'text_colour', 'opacity', 'corner']
    case 'connector': return ['stroke', 'width', 'dash', 'route', 'start_head', 'end_head', 'text_colour', 'font_size', 'opacity']
    case 'pen': return ['stroke', 'width', 'dash', 'opacity']
    case 'text': return ['text_colour', 'font_size', 'align', 'opacity']
    case 'sticky': return ['fill', 'text_colour', 'font_size', 'align', 'opacity', 'corner']
    case 'media':
    case 'embed': return ['opacity', 'corner']
    default: return []
  }
}

/** What a placed file shows as: a picture, a video's first frame, or a file tile. */
export function fileTileKind(file) {
  const mime = String(file?.mime_type ?? '').toLowerCase()
  const name = String(file?.name ?? '').toLowerCase()
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|bmp)$/.test(name)) return 'picture'
  if (mime.startsWith('video/') || /\.(mov|mp4|m4v|webm)$/.test(name)) return 'video'
  return 'file'
}

export const TILE_WORDS = { picture: 'Picture', video: 'Video', file: 'File' }
