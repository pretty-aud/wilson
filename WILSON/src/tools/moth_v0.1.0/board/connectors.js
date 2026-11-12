// connectors.js — MO4 boards: where a connector's ends sit and the path between them. Pure geometry, no Konva.
//
// A connector is kept as the server keeps it: x, y, w, h its box, `points` its ends and bends relative to (x, y)
// ([startX, startY, ...bends, endX, endY], at most 128 numbers), and an end that is tied to an element names it by
// id and anchor (auto, top, right, bottom, left, center). An end tied to an element follows it: the stored point is
// only where that end was last drawn, used when the element has gone (the server sets the id null on a delete).
// "auto" picks the side of the element that faces the other end. Elements turn about their top-left corner.

export const ANCHORS = ['auto', 'top', 'right', 'bottom', 'left', 'center']

const SIDE_AT = { top: [0.5, 0], right: [1, 0.5], bottom: [0.5, 1], left: [0, 0.5], center: [0.5, 0.5] }
const NORMAL = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0], center: [0, 0] }
const num = (n, d = 0) => (Number.isFinite(Number(n)) ? Number(n) : d)
const round2 = (n) => {
  const v = Math.round(n * 100) / 100
  return Object.is(v, -0) ? 0 : v
}

function turn(x, y, deg) {
  if (!deg) return { x, y }
  const a = (deg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  return { x: x * c - y * s, y: x * s + y * c }
}

/** A point in an element's own box to the board. */
export function toBoard(g, lx, ly) {
  const r = turn(lx, ly, num(g.rotation))
  return { x: num(g.x) + r.x, y: num(g.y) + r.y }
}

/** A board point into an element's own box. */
export function toLocal(g, bx, by) {
  return turn(bx - num(g.x), by - num(g.y), -num(g.rotation))
}

/** The element's centre on the board. */
export function centreOf(g) {
  return toBoard(g, num(g.w) / 2, num(g.h) / 2)
}

// The box anchors sit on: a circle's own square (its outline touches that square's sides), else the whole box.
function anchorBox(g) {
  const w = num(g.w)
  const h = num(g.h)
  if (g.kind === 'shape' && (g.shape === 'circle' || g.shape === 'connector_circle')) {
    const d = Math.min(w, h)
    return { x: (w - d) / 2, y: (h - d) / 2, w: d, h: d }
  }
  return { x: 0, y: 0, w, h }
}

/** The side of an element that faces a board point. */
export function autoSide(g, towards) {
  const b = anchorBox(g)
  const l = toLocal(g, num(towards?.x), num(towards?.y))
  const dx = (l.x - (b.x + b.w / 2)) / Math.max(b.w / 2, 1)
  const dy = (l.y - (b.y + b.h / 2)) / Math.max(b.h / 2, 1)
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'bottom' : 'top'
}

/** Where an anchor of an element is on the board, and which way its side faces (a unit vector, zero at the centre). */
export function anchorPoint(g, anchor, towards) {
  const side = !anchor || anchor === 'auto' || !SIDE_AT[anchor] ? autoSide(g, towards ?? centreOf(g)) : anchor
  const b = anchorBox(g)
  const [fx, fy] = SIDE_AT[side]
  const p = toBoard(g, b.x + b.w * fx, b.y + b.h * fy)
  const n = turn(NORMAL[side][0], NORMAL[side][1], num(g.rotation))
  return { x: p.x, y: p.y, side, nx: n.x, ny: n.y }
}

/** The anchor nearest a board point within `threshold`, else 'auto' (a drop anywhere else on the element). */
export function pickAnchor(g, point, threshold) {
  let best = 'auto'
  let bestD = Math.max(0, num(threshold))
  for (const side of ['top', 'right', 'bottom', 'left', 'center']) {
    const a = anchorPoint(g, side)
    const d = Math.hypot(a.x - num(point?.x), a.y - num(point?.y))
    if (d <= bestD) { best = side; bestD = d }
  }
  return best
}

/** Is a board point inside an element's (turned) box? */
export function containsPoint(g, point, slack = 0) {
  const l = toLocal(g, num(point?.x), num(point?.y))
  return l.x >= -slack && l.y >= -slack && l.x <= num(g.w) + slack && l.y <= num(g.h) + slack
}

/**
 * A connector's two ends as drawn now: an end tied to an element sits on that element's anchor (`lookup(id)` gives
 * the element as drawn, or nothing); a free end, or one whose element has gone, sits at its stored point.
 */
export function connectorEnds(conn, lookup = () => null) {
  const pts = Array.isArray(conn?.points) ? conn.points.map((v) => num(v)) : []
  const ox = num(conn?.x)
  const oy = num(conn?.y)
  const n = pts.length - (pts.length % 2)
  const freeStart = n >= 2 ? { x: ox + pts[0], y: oy + pts[1] } : { x: ox, y: oy }
  const freeEnd = n >= 4 ? { x: ox + pts[n - 2], y: oy + pts[n - 1] } : { x: ox + num(conn?.w), y: oy + num(conn?.h) }
  const bends = []
  for (let i = 2; i + 1 < n - 2; i += 2) bends.push({ x: ox + pts[i], y: oy + pts[i + 1] })
  const tied = (id) => {
    if (!id) return null
    const el = lookup(id)
    return el && el.kind !== 'connector' ? el : null
  }
  const fromEl = tied(conn?.from_id)
  const toEl = tied(conn?.to_id)
  const startRef = bends[0] ?? (toEl ? centreOf(toEl) : freeEnd)
  const endRef = bends[bends.length - 1] ?? (fromEl ? centreOf(fromEl) : freeStart)
  const start = fromEl ? anchorPoint(fromEl, conn.from_anchor, startRef) : { ...freeStart, side: null, nx: 0, ny: 0 }
  const end = toEl ? anchorPoint(toEl, conn.to_anchor, endRef) : { ...freeEnd, side: null, nx: 0, ny: 0 }
  return { start, end, bends, fromEl, toEl }
}

// A free end's direction: towards the other end along the longer axis (what an elbow leaves along).
function freeNormal(from, to) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (Math.abs(dx) >= Math.abs(dy)) return { nx: dx >= 0 ? 1 : -1, ny: 0 }
  return { nx: 0, ny: dy >= 0 ? 1 : -1 }
}

function dedupe(points) {
  const out = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue
    out.push(p)
  }
  // Drop a middle point on a straight run (three in a row on one line).
  for (let i = out.length - 2; i >= 1; i -= 1) {
    const a = out[i - 1]
    const b = out[i]
    const c = out[i + 1]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) < 0.01) out.splice(i, 1)
  }
  return out
}

const flat = (points) => points.flatMap((p) => [round2(p.x), round2(p.y)])

/**
 * The line between two ends: { points (flat, board units), bezier, tension }. Straight runs through its bends;
 * curved is one cubic leaving each side along its face (through the bends, smoothed, when it has some); elbow is
 * square turns, leaving each side by a short stub.
 */
export function routePoints(start, end, route = 'straight', bends = []) {
  const s = { x: num(start?.x), y: num(start?.y) }
  const e = { x: num(end?.x), y: num(end?.y) }
  if (route === 'curved') {
    if (bends.length) return { points: flat([s, ...bends, e]), bezier: false, tension: 0.5 }
    const dist = Math.hypot(e.x - s.x, e.y - s.y)
    const reach = Math.max(24, dist * 0.4)
    const ns = start?.side && start.side !== 'center' ? { nx: start.nx, ny: start.ny } : freeNormal(s, e)
    const ne = end?.side && end.side !== 'center' ? { nx: end.nx, ny: end.ny } : freeNormal(e, s)
    const c1 = { x: s.x + ns.nx * reach, y: s.y + ns.ny * reach }
    const c2 = { x: e.x + ne.nx * reach, y: e.y + ne.ny * reach }
    return { points: flat([s, c1, c2, e]), bezier: true, tension: 0 }
  }
  if (route === 'elbow') {
    const stub = 24
    const ns = start?.side && start.side !== 'center' ? { nx: start.nx, ny: start.ny } : freeNormal(s, e)
    const ne = end?.side && end.side !== 'center' ? { nx: end.nx, ny: end.ny } : freeNormal(e, s)
    // A turned element's face is held to the nearer axis: an elbow only turns square.
    const axis = (n) => (Math.abs(n.nx) >= Math.abs(n.ny) ? 'h' : 'v')
    const sa = axis(ns)
    const ea = axis(ne)
    const s1 = sa === 'h' ? { x: s.x + Math.sign(ns.nx || 1) * stub, y: s.y } : { x: s.x, y: s.y + Math.sign(ns.ny || 1) * stub }
    const e1 = ea === 'h' ? { x: e.x + Math.sign(ne.nx || 1) * stub, y: e.y } : { x: e.x, y: e.y + Math.sign(ne.ny || 1) * stub }
    let middle
    if (sa === 'h' && ea === 'h') {
      const mx = (s1.x + e1.x) / 2
      middle = [{ x: mx, y: s1.y }, { x: mx, y: e1.y }]
    } else if (sa === 'v' && ea === 'v') {
      const my = (s1.y + e1.y) / 2
      middle = [{ x: s1.x, y: my }, { x: e1.x, y: my }]
    } else if (sa === 'h') {
      middle = [{ x: e1.x, y: s1.y }]
    } else {
      middle = [{ x: s1.x, y: e1.y }]
    }
    return { points: flat(dedupe([s, s1, ...middle, e1, e])), bezier: false, tension: 0 }
  }
  return { points: flat([s, ...bends, e]), bezier: false, tension: 0 }
}

/** The direction (radians) each end points out along: from the line into the tip. */
export function endAngles(route) {
  const p = route?.points ?? []
  const n = p.length
  if (n < 4) return { start: 0, end: 0 }
  const ang = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax)
  // The first other point that is not the tip itself (a stub or a control point can sit on it).
  let i = 2
  while (i + 1 < n && Math.abs(p[i] - p[0]) < 0.01 && Math.abs(p[i + 1] - p[1]) < 0.01) i += 2
  let j = n - 4
  while (j >= 0 && Math.abs(p[j] - p[n - 2]) < 0.01 && Math.abs(p[j + 1] - p[n - 1]) < 0.01) j -= 2
  const start = i + 1 < n ? ang(p[i], p[i + 1], p[0], p[1]) : ang(p[n - 2], p[n - 1], p[0], p[1])
  const end = j >= 0 ? ang(p[j], p[j + 1], p[n - 2], p[n - 1]) : ang(p[0], p[1], p[n - 2], p[n - 1])
  return { start, end }
}

/** How big a head is for a line of that width. */
export function headSize(width) {
  return Math.max(10, num(width, 2) * 4)
}

/** How far the line stops short of its tip so it does not poke through a filled head. */
export function headInset(kind, width) {
  const size = headSize(width)
  if (kind === 'arrow') return size * 0.8
  if (kind === 'diamond') return size * 1.1
  if (kind === 'dot') return Math.max(4, num(width, 2) * 2)
  return 0
}

/**
 * A head at a tip pointing along `angle`: { data (SVG path, board units), filled } or null for none. An arrow and a
 * diamond and a dot are filled with the line's colour; an open arrow is two strokes.
 */
export function headShape(kind, tip, angle, width) {
  if (!kind || kind === 'none') return null
  const size = headSize(width)
  const tx = num(tip?.x)
  const ty = num(tip?.y)
  const ux = Math.cos(angle)
  const uy = Math.sin(angle)
  const px = -uy
  const py = ux
  const at = (back, side) => `${round2(tx - ux * back + px * side)} ${round2(ty - uy * back + py * side)}`
  const tipS = `${round2(tx)} ${round2(ty)}`
  if (kind === 'arrow') return { data: `M${tipS} L${at(size, size * 0.5)} L${at(size, -size * 0.5)} Z`, filled: true }
  if (kind === 'open_arrow') return { data: `M${at(size, size * 0.5)} L${tipS} L${at(size, -size * 0.5)}`, filled: false }
  if (kind === 'diamond') {
    return { data: `M${tipS} L${at(size * 0.6, size * 0.35)} L${at(size * 1.2, 0)} L${at(size * 0.6, -size * 0.35)} Z`, filled: true }
  }
  if (kind === 'dot') {
    const r = Math.max(4, num(width, 2) * 2)
    const cx = tx
    const cy = ty
    return { data: `M${round2(cx - r)} ${round2(cy)} A${round2(r)} ${round2(r)} 0 1 0 ${round2(cx + r)} ${round2(cy)} A${round2(r)} ${round2(r)} 0 1 0 ${round2(cx - r)} ${round2(cy)} Z`, filled: true }
  }
  return null
}

/** The route with each end pulled back by its head's inset (along the direction it arrives). */
export function trimForHeads(route, startHead, endHead, width) {
  const p = [...(route?.points ?? [])]
  const n = p.length
  if (n < 4) return { ...route, points: p }
  const a = endAngles(route)
  const si = headInset(startHead, width)
  const ei = headInset(endHead, width)
  const len = Math.hypot(p[n - 2] - p[0], p[n - 1] - p[1])
  // A line shorter than its two heads keeps its full length (the heads overlap; nothing is turned inside out).
  if (si + ei >= len) return { ...route, points: p }
  if (si) { p[0] = round2(p[0] - Math.cos(a.start) * si); p[1] = round2(p[1] - Math.sin(a.start) * si) }
  if (ei) { p[n - 2] = round2(p[n - 2] - Math.cos(a.end) * ei); p[n - 1] = round2(p[n - 1] - Math.sin(a.end) * ei) }
  return { ...route, points: p }
}

function cubicAt(p, t) {
  const u = 1 - t
  const x = u * u * u * p[0] + 3 * u * u * t * p[2] + 3 * u * t * t * p[4] + t * t * t * p[6]
  const y = u * u * u * p[1] + 3 * u * u * t * p[3] + 3 * u * t * t * p[5] + t * t * t * p[7]
  return { x, y }
}

/** Where a connector's label sits: halfway along the line. */
export function labelPoint(route) {
  const p = route?.points ?? []
  if (route?.bezier && p.length === 8) return cubicAt(p, 0.5)
  if (p.length < 4) return { x: num(p[0]), y: num(p[1]) }
  let total = 0
  for (let i = 2; i < p.length; i += 2) total += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1])
  let half = total / 2
  for (let i = 2; i < p.length; i += 2) {
    const seg = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1])
    if (seg >= half && seg > 0) {
      const t = half / seg
      return { x: p[i - 2] + (p[i] - p[i - 2]) * t, y: p[i - 1] + (p[i + 1] - p[i - 1]) * t }
    }
    half -= seg
  }
  return { x: p[p.length - 2], y: p[p.length - 1] }
}

/** The bounds of a drawn route (board units). */
export function routeBounds(route) {
  const p = route?.points ?? []
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let i = 0; i + 1 < p.length; i += 2) {
    x0 = Math.min(x0, p[i]); y0 = Math.min(y0, p[i + 1]); x1 = Math.max(x1, p[i]); y1 = Math.max(y1, p[i + 1])
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * The stored form of a connector between two board points (and its bends): its box and its points relative to
 * the box's corner, as the server keeps them (w and h are never negative; at most 128 numbers).
 */
export function connectorRecord(start, end, bends = []) {
  const all = [start, ...bends.slice(0, 62), end].map((p) => ({ x: num(p?.x), y: num(p?.y) }))
  const x = Math.min(...all.map((p) => p.x))
  const y = Math.min(...all.map((p) => p.y))
  const x1 = Math.max(...all.map((p) => p.x))
  const y1 = Math.max(...all.map((p) => p.y))
  return {
    x: round2(x),
    y: round2(y),
    w: round2(x1 - x),
    h: round2(y1 - y),
    points: all.flatMap((p) => [round2(p.x - x), round2(p.y - y)]),
  }
}

/** The connectors (ids) with an end on any of these element ids. */
export function connectorsTouching(elements, ids) {
  const set = ids instanceof Set ? ids : new Set(ids)
  const out = new Set()
  for (const el of elements) {
    if (el?.kind !== 'connector') continue
    if ((el.from_id && set.has(el.from_id)) || (el.to_id && set.has(el.to_id))) out.add(el.id)
  }
  return out
}
