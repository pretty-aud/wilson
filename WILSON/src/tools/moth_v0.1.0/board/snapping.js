// snapping.js — MO4 boards: the plane's geometry the canvas works with. Pure, no Konva, no DOM.
//
//   * boxes: an element's bounds on the board (turned about its top-left corner, as the server keeps it);
//   * snapping: a moving box's edges and centre to other elements' edges and centres, with the guides to draw;
//   * stacking: forward, backward, to the front, to the back, as the fewest z changes (z is a whole number and
//     the board draws in z then id order, as board_read pages);
//   * the camera: zoom about a point, a two-finger pinch, fitting a board on screen;
//   * a pen stroke thinned to the server's 20,000 numbers.

const num = (n, d = 0) => (Number.isFinite(Number(n)) ? Number(n) : d)
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

export const CAMERA_LIMITS = { min: 0.05, max: 8 }

/** The four corners of an element's box on the board. */
export function cornersOf(el) {
  const x = num(el?.x)
  const y = num(el?.y)
  const w = num(el?.w)
  const h = num(el?.h)
  const a = (num(el?.rotation) * Math.PI) / 180
  if (!a) return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
  const c = Math.cos(a)
  const s = Math.sin(a)
  const at = (lx, ly) => ({ x: x + lx * c - ly * s, y: y + lx * s + ly * c })
  return [at(0, 0), at(w, 0), at(w, h), at(0, h)]
}

/** An element's bounds on the board (the box that holds it, turned or not). */
export function boundsOf(el) {
  const cs = cornersOf(el)
  const xs = cs.map((p) => p.x)
  const ys = cs.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** The bounds that hold every box given (null for none). */
export function unionBounds(boxes) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const b of boxes) {
    if (!b) continue
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h)
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}

export function intersects(a, b) {
  return !!a && !!b && a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
}

export function contains(outer, inner) {
  return !!outer && !!inner && inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
}

/** A box grown by m on every side. */
export function grow(b, m) {
  return { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m }
}

/** A rectangle from two corners in any order. */
export function boxFrom(a, b) {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}

const linesX = (b) => [b.x, b.x + b.w / 2, b.x + b.w]
const linesY = (b) => [b.y, b.y + b.h / 2, b.y + b.h]

function nearest(moving, candidates, linesOf, threshold) {
  let best = null
  for (const c of candidates) {
    for (const at of linesOf(c)) {
      for (const m of moving) {
        const d = at - m
        if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d
      }
    }
  }
  return best
}

/**
 * Snap a moving box to other boxes: its left, centre and right to theirs, its top, middle and bottom to theirs,
 * whichever is nearest within `threshold` (board units) on each axis. Answers the shift and the guides to draw:
 * { dx, dy, guides: [{ axis: 'x', at, from, to } | { axis: 'y', at, from, to }] } — a vertical guide for an x match
 * (from and to are its ends along y), a horizontal one for a y match.
 */
export function snapBox(box, candidates, threshold) {
  const t = Math.max(0, num(threshold))
  const bx = nearest(linesX(box), candidates, linesX, t)
  const by = nearest(linesY(box), candidates, linesY, t)
  const dx = bx ?? 0
  const dy = by ?? 0
  const moved = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h }
  return { dx, dy, guides: guidesFor(moved, candidates, { x: bx !== null, y: by !== null }) }
}

function guidesFor(moved, candidates, axes) {
  const v = new Map()
  const hz = new Map()
  const key = (n) => Math.round(n * 100) / 100
  for (const c of candidates) {
    if (axes.x) {
      for (const at of linesX(c)) {
        if (!linesX(moved).some((m) => Math.abs(m - at) < 0.5)) continue
        const k = key(at)
        const from = Math.min(moved.y, c.y)
        const to = Math.max(moved.y + moved.h, c.y + c.h)
        const g = v.get(k)
        v.set(k, g ? { ...g, from: Math.min(g.from, from), to: Math.max(g.to, to) } : { axis: 'x', at: k, from, to })
      }
    }
    if (axes.y) {
      for (const at of linesY(c)) {
        if (!linesY(moved).some((m) => Math.abs(m - at) < 0.5)) continue
        const k = key(at)
        const from = Math.min(moved.x, c.x)
        const to = Math.max(moved.x + moved.w, c.x + c.w)
        const g = hz.get(k)
        hz.set(k, g ? { ...g, from: Math.min(g.from, from), to: Math.max(g.to, to) } : { axis: 'y', at: k, from, to })
      }
    }
  }
  return [...v.values(), ...hz.values()]
}

/** Snap one point (a resize handle) to other boxes' lines; { x, y, guides } as snapBox's. */
export function snapPoint(point, candidates, threshold) {
  const s = snapBox({ x: num(point?.x), y: num(point?.y), w: 0, h: 0 }, candidates, threshold)
  return { x: num(point?.x) + s.dx, y: num(point?.y) + s.dy, guides: s.guides }
}

/**
 * The boxes worth snapping to: those near the view (grown by half its size), not the moving ones, nearest the
 * view's centre first, at most `max` — a board of thousands snaps against what is on screen.
 */
export function pickCandidates(entries, excludeIds, view, max = 300) {
  const skip = excludeIds instanceof Set ? excludeIds : new Set(excludeIds)
  const near = view ? grow(view, Math.max(view.w, view.h) / 2) : null
  const cx = view ? view.x + view.w / 2 : 0
  const cy = view ? view.y + view.h / 2 : 0
  const out = []
  for (const { id, box } of entries) {
    if (skip.has(id) || !box) continue
    if (near && !intersects(near, box)) continue
    out.push({ box, d: Math.hypot(box.x + box.w / 2 - cx, box.y + box.h / 2 - cy) })
  }
  out.sort((a, b) => a.d - b.d)
  return out.slice(0, max).map((o) => o.box)
}

/** The ids whose boxes lie wholly inside a dragged selection rectangle. */
export function marqueeHits(entries, rect) {
  const out = []
  if (!rect || (rect.w < 1 && rect.h < 1)) return out
  for (const { id, box } of entries) if (box && contains(rect, box)) out.push(id)
  return out
}

// ---- stacking ---------------------------------------------------------------------------------------------------

/** The board's drawing order: z, then id (the server pages in that order). */
export function byStack(a, b) {
  const dz = num(a.z) - num(b.z)
  if (dz) return dz
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function nextZ(elements) {
  let top = -Infinity
  for (const el of elements) top = Math.max(top, num(el.z))
  return Number.isFinite(top) ? top + 1 : 0
}

export function bottomZ(elements) {
  let low = Infinity
  for (const el of elements) low = Math.min(low, num(el.z))
  return Number.isFinite(low) ? low - 1 : 0
}

/**
 * Move the chosen elements in the drawing order: 'forward' and 'backward' one place past their neighbour,
 * 'front' and 'back' to the end. Answers the fewest z changes: [{ id, z }]. Each run of chosen elements takes
 * whole numbers between its new neighbours when there is room; when there is none, the board is numbered afresh
 * from its lowest z (only the elements whose z changes are answered).
 */
export function restack(elements, ids, dir) {
  const list = [...elements].sort(byStack)
  const chosen = new Set(ids)
  const isChosen = (e) => chosen.has(e.id)
  if (!list.some(isChosen)) return []
  let order = list.slice()
  if (dir === 'front') order = [...order.filter((e) => !isChosen(e)), ...order.filter(isChosen)]
  else if (dir === 'back') order = [...order.filter(isChosen), ...order.filter((e) => !isChosen(e))]
  else if (dir === 'forward') {
    for (let i = order.length - 2; i >= 0; i -= 1) {
      if (isChosen(order[i]) && !isChosen(order[i + 1])) [order[i], order[i + 1]] = [order[i + 1], order[i]]
    }
  } else if (dir === 'backward') {
    for (let i = 1; i < order.length; i += 1) {
      if (isChosen(order[i]) && !isChosen(order[i - 1])) [order[i - 1], order[i]] = [order[i], order[i - 1]]
    }
  } else return []
  if (order.every((e, i) => e === list[i])) return []

  const z = new Map(order.map((e) => [e.id, num(e.z)]))
  let roomy = true
  let i = 0
  while (i < order.length) {
    if (!isChosen(order[i])) { i += 1; continue }
    let j = i
    while (j < order.length && isChosen(order[j])) j += 1
    const k = j - i
    const lo = i > 0 ? z.get(order[i - 1].id) : null
    const hi = j < order.length ? z.get(order[j].id) : null
    let base
    if (lo === null && hi === null) base = null
    else if (lo === null) base = hi - k
    else if (hi === null || hi - lo - 1 >= k) base = lo + 1
    else { roomy = false; break }
    if (base !== null) for (let q = 0; q < k; q += 1) z.set(order[i + q].id, base + q)
    i = j
  }
  if (!roomy) {
    const start = Math.min(...list.map((e) => num(e.z)))
    order.forEach((e, n) => z.set(e.id, start + n))
  }
  const out = []
  for (const e of list) if (z.get(e.id) !== num(e.z)) out.push({ id: e.id, z: z.get(e.id) })
  return out
}

// ---- the camera -------------------------------------------------------------------------------------------------
// A camera is { x, y, scale }: a board point b is on screen at (x + b.x * scale, y + b.y * scale).

export function clampScale(s, limits = CAMERA_LIMITS) {
  return clamp(num(s, 1), limits.min, limits.max)
}

export function screenToBoard(cam, sx, sy) {
  return { x: (sx - cam.x) / cam.scale, y: (sy - cam.y) / cam.scale }
}

export function boardToScreen(cam, bx, by) {
  return { x: cam.x + bx * cam.scale, y: cam.y + by * cam.scale }
}

/** Zoom by a factor keeping the board point under a screen point where it is. */
export function zoomAt(cam, sx, sy, factor, limits = CAMERA_LIMITS) {
  const scale = clampScale(cam.scale * num(factor, 1), limits)
  const b = screenToBoard(cam, sx, sy)
  return { x: sx - b.x * scale, y: sy - b.y * scale, scale }
}

/**
 * Two fingers: the board point under the fingers' first midpoint follows their midpoint now, and the scale follows
 * the change in their spread.
 */
export function pinchCamera(start, a0, b0, a1, b1, limits = CAMERA_LIMITS) {
  const d0 = Math.max(1, Math.hypot(b0.x - a0.x, b0.y - a0.y))
  const d1 = Math.max(1, Math.hypot(b1.x - a1.x, b1.y - a1.y))
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 }
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 }
  const scale = clampScale(start.scale * (d1 / d0), limits)
  const b = screenToBoard(start, m0.x, m0.y)
  return { x: m1.x - b.x * scale, y: m1.y - b.y * scale, scale }
}

/** A camera that shows the bounds whole in a view, never closer than full size. */
export function fitCamera(bounds, view, padding = 48, limits = CAMERA_LIMITS) {
  if (!bounds || !view?.w || !view?.h) return { x: (view?.w ?? 0) / 2, y: (view?.h ?? 0) / 2, scale: 1 }
  const sw = (view.w - 2 * padding) / Math.max(bounds.w, 1)
  const sh = (view.h - 2 * padding) / Math.max(bounds.h, 1)
  const scale = clampScale(Math.min(sw, sh, 1), limits)
  return {
    x: view.w / 2 - (bounds.x + bounds.w / 2) * scale,
    y: view.h / 2 - (bounds.y + bounds.h / 2) * scale,
    scale,
  }
}

/** The part of the board a camera shows in a view. */
export function viewRect(cam, view) {
  const a = screenToBoard(cam, 0, 0)
  return { x: a.x, y: a.y, w: view.w / cam.scale, h: view.h / cam.scale }
}

// ---- pen strokes ------------------------------------------------------------------------------------------------

/**
 * A stroke's flat points held to at most `max` numbers (the server's 20,000): every k-th point kept, the last
 * always, so the stroke keeps its ends and its shape.
 */
export function thinPoints(points, max = 20000) {
  const n = Math.floor(points.length / 2)
  const cap = Math.max(2, Math.floor(max / 2))
  if (n <= cap) return points.slice(0, n * 2)
  const step = (n - 1) / (cap - 1)
  const out = []
  for (let i = 0; i < cap; i += 1) {
    const at = Math.min(n - 1, Math.round(i * step))
    out.push(points[at * 2], points[at * 2 + 1])
  }
  return out
}

/** A stroke drawn in board points as the server keeps it: its box, and its points relative to the box's corner. */
export function strokeRecord(boardPoints) {
  const p = thinPoints(boardPoints)
  if (p.length < 2) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let i = 0; i + 1 < p.length; i += 2) {
    x0 = Math.min(x0, p[i]); y0 = Math.min(y0, p[i + 1]); x1 = Math.max(x1, p[i]); y1 = Math.max(y1, p[i + 1])
  }
  const r = (v) => Math.round(v * 100) / 100
  const rel = []
  for (let i = 0; i + 1 < p.length; i += 2) rel.push(r(p[i] - x0), r(p[i + 1] - y0))
  // A tap is a dot: two points a hair apart, so a round cap draws it.
  if (rel.length === 2) rel.push(0.01, 0.01)
  return { x: r(x0), y: r(y0), w: r(x1 - x0), h: r(y1 - y0), points: rel }
}

/** Rotation held to the server's range, as -180 to 180. */
export function normRotation(deg) {
  let r = num(deg) % 360
  if (r > 180) r -= 360
  if (r <= -180) r += 360
  return Math.round(r * 100) / 100
}
