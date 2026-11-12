// =============================================================================
// frame.js — what one frame draws (MO2a, the brief's item 3).
//
// Pure: the scene, the camera and the viewport in; a draw list out. The
// renderer only executes the list, so culling, clustering and level of
// detail are tested here without a canvas.
//
//   * Culling: a dot off screen (beyond a margin) is not drawn; a line is
//     drawn only when its box meets the screen.
//   * Clustering (FAR) when zoomed out (k < clusterBelowK) OR when the dots
//     or lines in view exceed the budget (PLAN_MOTH §5 Session 2: 1,000 dots
//     and 2,000 lines; 300 and 600 in light mode). Dots are grouped on a grid
//     anchored to the world; the cell grows in powers of two until the frame
//     is within the dot budget. A cell's size and centre come from ALL its
//     dots, not only those on screen, and whole cells are culled, so panning
//     never reshuffles a cluster. One line per pair of cells, summed, kept
//     when its box meets the screen. A cluster is mist when all its dots are.
//   * Level of detail otherwise: MID draws every dot and line and labels only
//     the containers; NEAR labels everything on screen. Labels are capped and
//     de-cluttered; a dot just off the left edge whose label reaches into
//     view still gets its label.
//   * Light mode (the lighter fallback, brief §12a.6): the smaller budget and
//     no labels at MID. The readability shadows stay (renderer.js).
// =============================================================================

import { visibleWorldRect } from './camera.js'

export const LOD = Object.freeze({ FAR: 'far', MID: 'mid', NEAR: 'near' })

export const FRAME_DEFAULTS = Object.freeze({
  clusterBelowK: 0.35,
  labelAllAboveK: 1,
  cellPx: 48,
  marginPx: 24,
  maxLabels: 200,
  maxDots: 1000, // the plan's budget before clustering
  maxLines: 2000,
  lightMaxDots: 300, // the low-power budget
  lightMaxLines: 600,
  minDotPx: 1.5,
  maxDotPx: 36,
  charPx: 6.6, // average advance of the 12 px caption face, for label spacing
})

/** An exact numeric key for a grid cell (|g| < 2^20 on each axis; clamped). */
const G = 1 << 20
function cellKey(gx, gy) {
  const x = Math.max(-G + 1, Math.min(G - 1, gx)) + G
  const y = Math.max(-G + 1, Math.min(G - 1, gy)) + G
  return x * 2 * G + y
}

/**
 * scene = { n, xy: Float32Array(2n), r: Float32Array(n) (world radius),
 *           container, collapsed, dim: Uint8Array(n), label: string[n],
 *           count: Uint32Array(n), priority: Float32Array(n) (label order),
 *           m, ends: Uint32Array(2m) (node indices), kind: Uint8Array(m) }
 * opts = FRAME_DEFAULTS overrides plus { light, selected: index or -1 }.
 *
 * Returns { lod, clustered: 'zoom' | 'budget' | null, culled,
 *   dots: { count, index, x, y, r },
 *   edges: { count, x1, y1, x2, y2, kind, dim },
 *   clusters: { count, x, y, r, size, dim },
 *   clusterEdges: { count, x1, y1, x2, y2, weight, dim },
 *   labels: [{ index, x, y, r }] }   (screen pixels)
 */
export function computeFrame(scene, cam, viewport, options = {}) {
  const o = { ...FRAME_DEFAULTS, ...options }
  const { n, xy, r, m, ends } = scene
  const rect = visibleWorldRect(cam, viewport, o.marginPx)
  const hw = viewport.width / 2
  const hh = viewport.height / 2
  const k = cam.k
  const toSX = (wx) => (wx - cam.x) * k + hw
  const toSY = (wy) => (wy - cam.y) * k + hh
  const dotPx = (i) => Math.min(o.maxDotPx, Math.max(o.minDotPx, r[i] * k))
  const boxMeets = (ax, ay, bx, by) => !(Math.max(ax, bx) < rect.minX || Math.min(ax, bx) > rect.maxX || Math.max(ay, by) < rect.minY || Math.min(ay, by) > rect.maxY)

  // Which dots are on screen (a dot counts when any of it is).
  const visible = new Uint8Array(n)
  let shown = 0
  for (let i = 0; i < n; i++) {
    const x = xy[2 * i]
    const y = xy[2 * i + 1]
    const pad = dotPx(i) / k
    if (x + pad < rect.minX || x - pad > rect.maxX || y + pad < rect.minY || y - pad > rect.maxY) continue
    visible[i] = 1
    shown++
  }
  let linesInView = 0
  for (let e = 0; e < m; e++) {
    const a = ends[2 * e]
    const b = ends[2 * e + 1]
    if (boxMeets(xy[2 * a], xy[2 * a + 1], xy[2 * b], xy[2 * b + 1])) linesInView++
  }
  const maxDots = o.light ? o.lightMaxDots : o.maxDots
  const maxLines = o.light ? o.lightMaxLines : o.maxLines
  const clustered = k < o.clusterBelowK ? 'zoom' : shown > maxDots || linesInView > maxLines ? 'budget' : null
  const lod = clustered ? LOD.FAR : k >= o.labelAllAboveK ? LOD.NEAR : LOD.MID

  const out = {
    lod,
    clustered,
    culled: n - shown,
    dots: { count: 0, index: [], x: [], y: [], r: [] },
    edges: { count: 0, x1: [], y1: [], x2: [], y2: [], kind: [], dim: [] },
    clusters: { count: 0, x: [], y: [], r: [], size: [], dim: [] },
    clusterEdges: { count: 0, x1: [], y1: [], x2: [], y2: [], weight: [], dim: [] },
    labels: [],
  }

  if (clustered) {
    clusterInto(out, scene, o, k, rect, maxDots, visible, toSX, toSY, dotPx, boxMeets)
    return out
  }

  for (let i = 0; i < n; i++) {
    if (!visible[i]) continue
    out.dots.index.push(i)
    out.dots.x.push(toSX(xy[2 * i]))
    out.dots.y.push(toSY(xy[2 * i + 1]))
    out.dots.r.push(dotPx(i))
    out.dots.count++
  }
  for (let e = 0; e < m; e++) {
    const a = ends[2 * e]
    const b = ends[2 * e + 1]
    const ax = xy[2 * a]
    const ay = xy[2 * a + 1]
    const bx = xy[2 * b]
    const by = xy[2 * b + 1]
    if (!boxMeets(ax, ay, bx, by)) continue
    out.edges.x1.push(toSX(ax)); out.edges.y1.push(toSY(ay))
    out.edges.x2.push(toSX(bx)); out.edges.y2.push(toSY(by))
    out.edges.kind.push(scene.kind ? scene.kind[e] : 0)
    out.edges.dim.push(scene.dim && (scene.dim[a] || scene.dim[b]) ? 1 : 0)
    out.edges.count++
  }
  if (!(lod === LOD.MID && o.light)) placeLabels(out, scene, o, lod, viewport, visible, toSX, toSY, dotPx)
  return out
}

function clusterInto(out, scene, o, k, rect, maxDots, visible, toSX, toSY, dotPx, boxMeets) {
  const { n, xy, m, ends } = scene
  // The cell: a power-of-two step of the zoom, doubled until every cell that
  // will be drawn (any cell whose square meets the view, including border
  // cells whose dots are all just off screen) fits the dot budget.
  const base = o.cellPx / Math.pow(2, Math.floor(Math.log2(k)))
  // At the same zoom step a cell that had to grow stays grown (R1-3): near the threshold a pixel of panning
  // would otherwise flip every cluster between two sizes. Zooming to another step starts again from its base.
  let cellWorld = o.prevCell && o.prevCell.base === base && o.prevCell.world > base ? o.prevCell.world : base
  for (let grow = 0; grow < 12; grow++) {
    const seen = new Set()
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(xy[2 * i] / cellWorld)
      const cy = Math.floor(xy[2 * i + 1] / cellWorld)
      if (boxMeets(cx * cellWorld, cy * cellWorld, (cx + 1) * cellWorld, (cy + 1) * cellWorld)) seen.add(cellKey(cx, cy))
    }
    if (seen.size <= maxDots) break
    cellWorld *= 2
  }
  out.cell = { base, world: cellWorld }
  // Every dot into its cell: sizes and centres from all members.
  const cellOf = new Int32Array(n)
  const index = new Map()
  const gx = []
  const gy = []
  const sx = []
  const sy = []
  const cnt = []
  const dimCnt = []
  const first = []
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(xy[2 * i] / cellWorld)
    const cy = Math.floor(xy[2 * i + 1] / cellWorld)
    const key = cellKey(cx, cy)
    let c = index.get(key)
    if (c === undefined) {
      c = cnt.length
      index.set(key, c)
      gx.push(cx); gy.push(cy); sx.push(0); sy.push(0); cnt.push(0); dimCnt.push(0); first.push(i)
    }
    cellOf[i] = c
    sx[c] += xy[2 * i]
    sy[c] += xy[2 * i + 1]
    cnt[c]++
    if (scene.dim && scene.dim[i]) dimCnt[c]++
  }
  const cells = cnt.length
  const cxw = new Float64Array(cells)
  const cyw = new Float64Array(cells)
  const cdim = new Uint8Array(cells)
  for (let c = 0; c < cells; c++) {
    cxw[c] = sx[c] / cnt[c]
    cyw[c] = sy[c] / cnt[c]
    cdim[c] = dimCnt[c] === cnt[c] ? 1 : 0
    // Whole cells are culled by the cell's square.
    const x0 = gx[c] * cellWorld
    const y0 = gy[c] * cellWorld
    if (!boxMeets(x0, y0, x0 + cellWorld, y0 + cellWorld)) continue
    if (cnt[c] === 1) {
      const i = first[c]
      out.dots.index.push(i)
      out.dots.x.push(toSX(xy[2 * i]))
      out.dots.y.push(toSY(xy[2 * i + 1]))
      out.dots.r.push(dotPx(i))
      out.dots.count++
    } else {
      out.clusters.x.push(toSX(cxw[c]))
      out.clusters.y.push(toSY(cyw[c]))
      out.clusters.r.push(Math.min(o.maxDotPx, 3 + 2.2 * Math.sqrt(cnt[c])))
      out.clusters.size.push(cnt[c])
      out.clusters.dim.push(cdim[c])
      out.clusters.count++
    }
  }
  // One line per pair of cells, summed; kept when its box meets the screen.
  const pairs = new Map()
  for (let e = 0; e < m; e++) {
    const a = cellOf[ends[2 * e]]
    const b = cellOf[ends[2 * e + 1]]
    if (a === b) continue
    const key = a < b ? a * cells + b : b * cells + a
    pairs.set(key, (pairs.get(key) || 0) + 1)
  }
  for (const [key, w] of pairs) {
    const a = Math.floor(key / cells)
    const b = key % cells
    if (!boxMeets(cxw[a], cyw[a], cxw[b], cyw[b])) continue
    out.clusterEdges.x1.push(toSX(cxw[a]))
    out.clusterEdges.y1.push(toSY(cyw[a]))
    out.clusterEdges.x2.push(toSX(cxw[b]))
    out.clusterEdges.y2.push(toSY(cyw[b]))
    out.clusterEdges.weight.push(w)
    out.clusterEdges.dim.push(cdim[a] || cdim[b] ? 1 : 0)
    out.clusterEdges.count++
  }
}

function placeLabels(out, scene, o, lod, viewport, visible, toSX, toSY, dotPx) {
  const { n, xy } = scene
  const eligible = (i) => !!(scene.label && scene.label[i]) && (lod !== LOD.MID || (scene.container && scene.container[i]) || i === o.selected)
  const want = [] // { i, x, y, r }
  for (let d = 0; d < out.dots.count; d++) {
    const i = out.dots.index[d]
    if (eligible(i)) want.push({ i, x: out.dots.x[d], y: out.dots.y[d], r: out.dots.r[d] })
  }
  // A dot just off the left edge whose label reaches into view.
  for (let i = 0; i < n; i++) {
    if (visible[i] || !eligible(i)) continue
    const x = toSX(xy[2 * i])
    const y = toSY(xy[2 * i + 1])
    const rr = dotPx(i)
    const x0 = x + rr + 4
    if (x0 >= 0 || x0 + labelWidth(scene, i, o) <= 0 || y < -8 || y > viewport.height + 8) continue
    want.push({ i, x, y, r: rr })
  }
  const pr = scene.priority
  want.sort((p, q) => {
    if (p.i === o.selected) return -1
    if (q.i === o.selected) return 1
    return (pr ? pr[q.i] - pr[p.i] : 0) || p.i - q.i
  })
  // A label whose box would overlap one already placed is skipped, so the
  // higher-priority one reads cleanly instead of both colliding.
  const placed = new Map()
  const cell = 64
  const each = (b, fn) => {
    for (let gx = Math.floor(b.x0 / cell); gx <= Math.floor(b.x1 / cell); gx++) {
      for (let gy = Math.floor(b.y0 / cell); gy <= Math.floor(b.y1 / cell); gy++) if (fn(cellKey(gx, gy))) return true
    }
    return false
  }
  for (const w of want) {
    if (out.labels.length >= o.maxLabels) break
    const x0 = w.x + w.r + 4
    const box = { x0, x1: x0 + labelWidth(scene, w.i, o), y0: w.y - 8, y1: w.y + 8 }
    const hit = each(box, (key) => (placed.get(key) || []).some((q) => box.x0 < q.x1 && box.x1 > q.x0 && box.y0 < q.y1 && box.y1 > q.y0))
    if (w.i !== o.selected && hit) continue
    each(box, (key) => { if (!placed.has(key)) placed.set(key, []); placed.get(key).push(box); return false })
    out.labels.push({ index: w.i, x: w.x, y: w.y, r: w.r })
  }
}

/** A label's width without measuring text: characters times an average advance. */
function labelWidth(scene, i, o) {
  const extra = scene.collapsed && scene.collapsed[i] && scene.count && scene.count[i] ? 3 + String(scene.count[i]).length : 0
  return (Math.min(32, scene.label[i].length) + extra) * o.charPx
}
