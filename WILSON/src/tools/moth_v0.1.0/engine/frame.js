// =============================================================================
// frame.js — what one frame draws (MO2a, the brief's item 3).
//
// Pure: the scene, the camera and the viewport in; a draw list out. The
// renderer only executes the list, so culling, clustering and level of
// detail are tested here without a canvas.
//
//   * Culling: a dot off screen (beyond a margin) is not drawn; a line is
//     drawn only when its box meets the screen.
//   * Level of detail by zoom: FAR (k < clusterBelowK) groups dots into
//     clusters on a grid anchored to the world, with one line per pair of
//     clusters and no labels; MID draws every dot and line and labels only
//     the containers; NEAR labels the dots on screen. Labels are capped.
//   * Light mode (the lighter fallback, brief §12a.6): no labels at MID,
//     lines capped, no halos.
//
// The grid's cell size changes only at powers of two of the zoom, so panning
// never reshuffles the clusters and zooming reshuffles them only at a step.
// =============================================================================

import { visibleWorldRect } from './camera.js'

export const LOD = Object.freeze({ FAR: 'far', MID: 'mid', NEAR: 'near' })

export const FRAME_DEFAULTS = Object.freeze({
  clusterBelowK: 0.35,
  labelAllAboveK: 1,
  cellPx: 48,
  marginPx: 24,
  maxLabels: 200,
  lightMaxEdges: 1500,
  minDotPx: 1.5,
  maxDotPx: 36,
  charPx: 6.6, // average advance of the 12 px label face, for label spacing
})

/**
 * scene = { n, xy: Float32Array(2n), r: Float32Array(n) (world radius),
 *           container: Uint8Array(n), dim: Uint8Array(n), label: string[n],
 *           priority: Float32Array(n) (label order, higher first),
 *           m, ends: Uint32Array(2m) (node indices), kind: Uint8Array(m) }
 * opts = FRAME_DEFAULTS overrides plus { light, selected: index or -1 }.
 *
 * Returns { lod, dots: { count, index, x, y, r }, edges: { count, x1, y1, x2,
 * y2, kind, dim }, clusters: { count, x, y, r, size }, clusterEdges: { count,
 * x1, y1, x2, y2, weight }, labels: [{ index, x, y, r }], culled }.
 */
export function computeFrame(scene, cam, viewport, options = {}) {
  const o = { ...FRAME_DEFAULTS, ...options }
  const { n, xy, r, m, ends } = scene
  const rect = visibleWorldRect(cam, viewport, o.marginPx)
  const hw = viewport.width / 2
  const hh = viewport.height / 2
  const k = cam.k
  const lod = k < o.clusterBelowK ? LOD.FAR : k >= o.labelAllAboveK ? LOD.NEAR : LOD.MID
  const toSX = (wx) => (wx - cam.x) * k + hw
  const toSY = (wy) => (wy - cam.y) * k + hh
  const dotPx = (i) => Math.min(o.maxDotPx, Math.max(o.minDotPx, r[i] * k))

  // Which dots are on screen (a dot counts when any of it is).
  const visible = new Uint8Array(n)
  let culled = 0
  for (let i = 0; i < n; i++) {
    const x = xy[2 * i]
    const y = xy[2 * i + 1]
    const pad = dotPx(i) / k
    if (x + pad < rect.minX || x - pad > rect.maxX || y + pad < rect.minY || y - pad > rect.maxY) { culled++; continue }
    visible[i] = 1
  }

  const out = {
    lod,
    culled,
    dots: { count: 0, index: [], x: [], y: [], r: [] },
    edges: { count: 0, x1: [], y1: [], x2: [], y2: [], kind: [], dim: [] },
    clusters: { count: 0, x: [], y: [], r: [], size: [] },
    clusterEdges: { count: 0, x1: [], y1: [], x2: [], y2: [], weight: [] },
    labels: [],
  }

  if (lod === LOD.FAR) {
    // Clusters on a world-anchored grid; the cell size steps with the zoom.
    const step = Math.pow(2, Math.floor(Math.log2(k)))
    const cellWorld = o.cellPx / step
    const cellOf = new Int32Array(n).fill(-1)
    const cells = new Map() // key -> cell index
    const cx = []
    const cy = []
    const cnt = []
    const members = []
    for (let i = 0; i < n; i++) {
      if (!visible[i]) continue
      const key = cellKey(Math.floor(xy[2 * i] / cellWorld), Math.floor(xy[2 * i + 1] / cellWorld))
      let c = cells.get(key)
      if (c === undefined) {
        c = cx.length
        cells.set(key, c)
        cx.push(0); cy.push(0); cnt.push(0); members.push(i)
      }
      cellOf[i] = c
      cx[c] += xy[2 * i]
      cy[c] += xy[2 * i + 1]
      cnt[c] += 1
    }
    for (let c = 0; c < cx.length; c++) {
      if (cnt[c] === 1) {
        const i = members[c]
        pushDot(out, i, toSX(xy[2 * i]), toSY(xy[2 * i + 1]), dotPx(i))
      } else {
        out.clusters.x.push(toSX(cx[c] / cnt[c]))
        out.clusters.y.push(toSY(cy[c] / cnt[c]))
        out.clusters.r.push(Math.min(o.maxDotPx, 3 + 2.2 * Math.sqrt(cnt[c])))
        out.clusters.size.push(cnt[c])
        out.clusters.count++
      }
    }
    // One line per pair of cells, summed.
    const pairs = new Map()
    for (let e = 0; e < m; e++) {
      const a = cellOf[ends[2 * e]]
      const b = cellOf[ends[2 * e + 1]]
      if (a < 0 || b < 0 || a === b) continue
      const key = a < b ? a * cx.length + b : b * cx.length + a
      pairs.set(key, (pairs.get(key) || 0) + 1)
    }
    for (const [key, w] of pairs) {
      const a = Math.floor(key / cx.length)
      const b = key % cx.length
      out.clusterEdges.x1.push(toSX(cx[a] / cnt[a]))
      out.clusterEdges.y1.push(toSY(cy[a] / cnt[a]))
      out.clusterEdges.x2.push(toSX(cx[b] / cnt[b]))
      out.clusterEdges.y2.push(toSY(cy[b] / cnt[b]))
      out.clusterEdges.weight.push(w)
      out.clusterEdges.count++
    }
    return out
  }

  for (let i = 0; i < n; i++) {
    if (visible[i]) pushDot(out, i, toSX(xy[2 * i]), toSY(xy[2 * i + 1]), dotPx(i))
  }

  const cap = o.light ? o.lightMaxEdges : Infinity
  for (let e = 0; e < m && out.edges.count < cap; e++) {
    const a = ends[2 * e]
    const b = ends[2 * e + 1]
    const ax = xy[2 * a]
    const ay = xy[2 * a + 1]
    const bx = xy[2 * b]
    const by = xy[2 * b + 1]
    if (Math.max(ax, bx) < rect.minX || Math.min(ax, bx) > rect.maxX || Math.max(ay, by) < rect.minY || Math.min(ay, by) > rect.maxY) continue
    out.edges.x1.push(toSX(ax)); out.edges.y1.push(toSY(ay))
    out.edges.x2.push(toSX(bx)); out.edges.y2.push(toSY(by))
    out.edges.kind.push(scene.kind ? scene.kind[e] : 0)
    out.edges.dim.push(scene.dim && (scene.dim[a] || scene.dim[b]) ? 1 : 0)
    out.edges.count++
  }

  // Labels: the selection first, then by priority; containers only at MID,
  // none at MID in light mode.
  if (!(lod === LOD.MID && o.light)) {
    const want = []
    for (let d = 0; d < out.dots.count; d++) {
      const i = out.dots.index[d]
      if (!scene.label || !scene.label[i]) continue
      if (lod === LOD.MID && !(scene.container && scene.container[i]) && i !== o.selected) continue
      want.push(d)
    }
    const pr = scene.priority
    want.sort((p, q) => {
      const i = out.dots.index[p]
      const j = out.dots.index[q]
      if (i === o.selected) return -1
      if (j === o.selected) return 1
      return (pr ? pr[j] - pr[i] : 0) || i - j
    })
    // A label whose box would overlap one already placed is skipped, so the
    // higher-priority one reads cleanly instead of both colliding.
    const placed = new Map() // grid cell -> [boxes]
    const cell = 64
    const overlaps = (b) => {
      for (let gx = Math.floor(b.x0 / cell); gx <= Math.floor(b.x1 / cell); gx++) {
        for (let gy = Math.floor(b.y0 / cell); gy <= Math.floor(b.y1 / cell); gy++) {
          for (const q of placed.get(cellKey(gx, gy)) || []) {
            if (b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0) return true
          }
        }
      }
      return false
    }
    for (let w = 0; w < want.length && out.labels.length < o.maxLabels; w++) {
      const d = want[w]
      const i = out.dots.index[d]
      const x0 = out.dots.x[d] + out.dots.r[d] + 4
      const box = { x0, x1: x0 + labelWidth(scene, i, o), y0: out.dots.y[d] - 8, y1: out.dots.y[d] + 8 }
      if (i !== o.selected && overlaps(box)) continue
      for (let gx = Math.floor(box.x0 / cell); gx <= Math.floor(box.x1 / cell); gx++) {
        for (let gy = Math.floor(box.y0 / cell); gy <= Math.floor(box.y1 / cell); gy++) {
          const key = cellKey(gx, gy)
          if (!placed.has(key)) placed.set(key, [])
          placed.get(key).push(box)
        }
      }
      out.labels.push({ index: i, x: out.dots.x[d], y: out.dots.y[d], r: out.dots.r[d] })
    }
  }
  return out
}

/** A label's width without measuring text: characters times an average advance. */
function labelWidth(scene, i, o) {
  const chars = Math.min(32, scene.label[i].length) + (scene.collapsed && scene.collapsed[i] && scene.count && scene.count[i] ? 3 + String(scene.count[i]).length : 0)
  return chars * o.charPx
}

/** An exact numeric key for a grid cell (|g| < 2^20 on each axis; clamped). */
const G = 1 << 20
function cellKey(gx, gy) {
  const x = Math.max(-G + 1, Math.min(G - 1, gx)) + G
  const y = Math.max(-G + 1, Math.min(G - 1, gy)) + G
  return x * 2 * G + y
}

function pushDot(out, i, x, y, r) {
  out.dots.index.push(i)
  out.dots.x.push(x)
  out.dots.y.push(y)
  out.dots.r.push(r)
  out.dots.count++
}
