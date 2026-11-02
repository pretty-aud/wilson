// =============================================================================
// renderer.js — M.O.T.H.'s Canvas2D renderer (MO2a, the brief's item 3).
//
//   * Draws on demand only. invalidate() asks for ONE animation frame when
//     none is pending; frames continue only while a fly-to or a position
//     tween is running, and a streamed layout asks for one frame per batch of
//     ticks. Settled and idle, it requests nothing at all (the brief: "no work
//     at all when nothing moves"; PLAN_MOTH: "no continuous settled layout or
//     hidden render loop").
//   * Each frame executes a draw list from frame.js (culling, clustering,
//     level of detail): lines in one path per style, dots in one path per
//     colour, a pre-rendered halo sprite under dots and labels over the
//     bright core (glow.js shadowAlpha), labels capped.
//   * Feedback: setSelection / setHover redraw on the next frame, and
//     hitTest reads the last drawn frame, so a press is answered within a
//     frame (the target is 100 ms).
//   * The lighter mode comes from governor.js, fed with frames drawn back to
//     back while something moves.
//
// Injected for tests: requestFrame, cancelFrame, now, createCanvas.
// =============================================================================

import { panBy as panCamera, zoomAt as zoomCamera, flyTo as flyPath, camera as makeCamera } from './camera.js'
import { computeFrame, LOD } from './frame.js'
import { shadowAlpha } from './glow.js'
import { defaultRadius, positionsToData } from './layout.js'

export const KIND_CODE = Object.freeze({ project: 0, folder: 1, file: 2, tag: 3 })
const EDGE_KIND_CODE = Object.freeze({ lives_in: 0, tagged_with: 1, related_to: 2 })

export const DEFAULT_PALETTE = Object.freeze({
  dot: Object.freeze(['#ffffff', '#f4f1ea', '#d9d6cf', '#ffd28a']), // by KIND_CODE
  edge: Object.freeze(['rgba(255,255,255,0.22)', 'rgba(255,210,138,0.20)', 'rgba(170,200,255,0.26)']), // by edge code
  cluster: 'rgba(244,241,234,0.75)',
  clusterText: '#000000',
  clusterEdge: 'rgba(255,255,255,0.14)',
  selection: '#ff8a1f',
  hover: 'rgba(255,255,255,0.8)',
  label: '#ffffff',
  labelShadow: '0,0,0',
  font: '12px "Inter", system-ui, sans-serif',
  dimAlpha: 0.15,
})

const HALO_PX = 64

function defaultCreateCanvas(w, h) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** The soft dark disc drawn under a dot or label over the light. */
function makeHalo(createCanvas) {
  const c = createCanvas(HALO_PX, HALO_PX)
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(HALO_PX / 2, HALO_PX / 2, 0, HALO_PX / 2, HALO_PX / 2, HALO_PX / 2)
  grad.addColorStop(0, 'rgba(0,0,0,0.9)')
  grad.addColorStop(0.5, 'rgba(0,0,0,0.45)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, HALO_PX, HALO_PX)
  return c
}

const truncate = (s, n = 32) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function createRenderer({
  canvas,
  requestFrame = (fn) => requestAnimationFrame(fn),
  cancelFrame = (h) => cancelAnimationFrame(h),
  now = () => performance.now(),
  createCanvas = defaultCreateCanvas,
  palette = DEFAULT_PALETTE,
  frameOptions = {},
  governor = null,
  radiusOf = defaultRadius,
  reducedMotion = false,
  onFrame = null,
} = {}) {
  const ctx = canvas.getContext('2d')
  const halo = makeHalo(createCanvas)
  let viewport = { width: canvas.width || 1, height: canvas.height || 1 }
  let dpr = 1
  let cam = makeCamera()
  let scene = emptyScene()
  let glow = null
  let calm = !!reducedMotion
  let selected = -1
  let hovered = -1
  let selectedId = null
  let hoveredId = null
  let pending = null
  let destroyed = false
  let fly = null // { path, start }
  let tween = null // { from, to, start, ms }
  let last = null // the last drawn frame's draw list
  let lastFrameAt = null
  let wasAnimating = false
  let frames = 0
  let requests = 0

  function emptyScene() {
    return {
      n: 0, ids: [], index: new Map(), xy: new Float32Array(0), r: new Float32Array(0),
      kindCode: new Uint8Array(0), container: new Uint8Array(0), collapsed: new Uint8Array(0), dim: new Uint8Array(0),
      label: [], count: new Uint32Array(0), priority: new Float32Array(0),
      m: 0, ends: new Uint32Array(0), kind: new Uint8Array(0),
    }
  }

  function invalidate() {
    if (pending != null || destroyed) return
    requests++
    pending = requestFrame(onAnimationFrame)
  }

  const animating = () => fly != null || tween != null

  function onAnimationFrame() {
    pending = null
    if (destroyed) return
    const t0 = now()
    if (fly) {
      const el = t0 - fly.start
      cam = fly.path.at(el)
      if (fly.path.done(el)) fly = null
    }
    if (tween) {
      const u = Math.min(1, (t0 - tween.start) / tween.ms)
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2
      for (let i = 0; i < scene.xy.length; i++) scene.xy[i] = tween.from[i] + (tween.to[i] - tween.from[i]) * e
      if (u >= 1) tween = null
    }
    const light = governor ? governor.mode() === 'light' : false
    last = computeFrame(scene, cam, viewport, { ...frameOptions, light, selected })
    draw(last, light)
    const t1 = now()
    const work = t1 - t0
    const interval = wasAnimating && lastFrameAt != null ? t0 - lastFrameAt : null
    if (governor) governor.record(interval != null ? Math.max(work, interval) : work)
    if (onFrame) onFrame({ workMs: work, intervalMs: interval, lod: last.lod, dots: last.dots.count, edges: last.edges.count + last.clusterEdges.count, clusters: last.clusters.count, light })
    frames++
    lastFrameAt = t0
    wasAnimating = animating()
    if (wasAnimating) invalidate()
  }

  function draw(list, light) {
    const p = palette
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, viewport.width, viewport.height)
    ctx.lineWidth = 1

    // Lines: one path per (kind, mist) pair.
    const E = list.edges
    for (let kind = 0; kind < 3; kind++) {
      for (let dim = 0; dim < 2; dim++) {
        let any = false
        for (let e = 0; e < E.count; e++) {
          if (E.kind[e] !== kind || E.dim[e] !== dim) continue
          if (!any) { ctx.beginPath(); any = true }
          ctx.moveTo(E.x1[e], E.y1[e])
          ctx.lineTo(E.x2[e], E.y2[e])
        }
        if (any) {
          ctx.globalAlpha = dim ? p.dimAlpha : 1
          ctx.strokeStyle = p.edge[kind]
          ctx.stroke()
        }
      }
    }
    const C = list.clusterEdges
    if (C.count) {
      ctx.globalAlpha = 1
      ctx.strokeStyle = p.clusterEdge
      ctx.beginPath()
      for (let e = 0; e < C.count; e++) { ctx.moveTo(C.x1[e], C.y1[e]); ctx.lineTo(C.x2[e], C.y2[e]) }
      ctx.stroke()
    }

    // Halos under the dots that sit over the bright core.
    const D = list.dots
    if (!light && glow) {
      for (let d = 0; d < D.count; d++) {
        const a = shadowAlpha(D.x[d], D.y[d], glow, viewport)
        if (a < 0.01) continue
        const s = D.r[d] * 2.4 + 4
        ctx.globalAlpha = a * (scene.dim[D.index[d]] ? p.dimAlpha : 1)
        ctx.drawImage(halo, D.x[d] - s, D.y[d] - s, 2 * s, 2 * s)
      }
    }

    // Dots: one path per (kind, mist) pair.
    for (let kc = 0; kc < 4; kc++) {
      for (let dim = 0; dim < 2; dim++) {
        let any = false
        for (let d = 0; d < D.count; d++) {
          const i = D.index[d]
          if (scene.kindCode[i] !== kc || scene.dim[i] !== dim) continue
          if (!any) { ctx.beginPath(); any = true }
          ctx.moveTo(D.x[d] + D.r[d], D.y[d])
          ctx.arc(D.x[d], D.y[d], D.r[d], 0, 2 * Math.PI)
        }
        if (any) {
          ctx.globalAlpha = dim ? p.dimAlpha : 1
          ctx.fillStyle = p.dot[kc]
          ctx.fill()
        }
      }
    }

    // Clusters (FAR).
    const K = list.clusters
    if (K.count) {
      ctx.globalAlpha = 1
      ctx.fillStyle = p.cluster
      ctx.beginPath()
      for (let c = 0; c < K.count; c++) { ctx.moveTo(K.x[c] + K.r[c], K.y[c]); ctx.arc(K.x[c], K.y[c], K.r[c], 0, 2 * Math.PI) }
      ctx.fill()
      // How many dots a cluster holds, inside it when it is big enough to read.
      ctx.font = p.font
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = p.clusterText
      for (let c = 0; c < K.count; c++) if (K.r[c] >= 10) ctx.fillText(String(K.size[c]), K.x[c], K.y[c])
    }

    // Selection and hover rings.
    for (const [i, style] of [[hovered, p.hover], [selected, p.selection]]) {
      if (i < 0) continue
      const d = D.index.indexOf(i)
      if (d < 0) continue
      ctx.globalAlpha = 1
      ctx.strokeStyle = style
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(D.x[d], D.y[d], D.r[d] + 3, 0, 2 * Math.PI)
      ctx.stroke()
      ctx.lineWidth = 1
    }

    // Labels, with the soft shadow over the core.
    if (list.labels.length) {
      ctx.font = p.font
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      ctx.lineJoin = 'round'
      for (const L of list.labels) {
        const i = L.index
        let text = truncate(scene.label[i])
        if (scene.collapsed[i] && scene.count[i] > 0) text = `${text} · ${scene.count[i]}`
        const x = L.x + L.r + 4
        const y = L.y
        const fade = scene.dim[i] ? p.dimAlpha : 1
        const a = light || !glow ? 0 : shadowAlpha(x, y, glow, viewport)
        if (a >= 0.01) {
          ctx.globalAlpha = fade
          ctx.strokeStyle = `rgba(${p.labelShadow},${Math.round(a * 1000) / 1000})`
          ctx.lineWidth = 3
          ctx.strokeText(text, x, y)
          ctx.lineWidth = 1
        }
        ctx.globalAlpha = fade
        ctx.fillStyle = p.label
        ctx.fillText(text, x, y)
      }
    }
    ctx.globalAlpha = 1
  }

  function buildScene(graph) {
    const prev = scene
    const n = graph.nodes.length
    const s = {
      n, ids: graph.nodes.map((x) => x.id), index: new Map(),
      xy: new Float32Array(2 * n), r: new Float32Array(n),
      kindCode: new Uint8Array(n), container: new Uint8Array(n), collapsed: new Uint8Array(n), dim: new Uint8Array(n),
      label: new Array(n), count: new Uint32Array(n), priority: new Float32Array(n),
      m: 0, ends: null, kind: null,
    }
    graph.nodes.forEach((node, i) => {
      s.index.set(node.id, i)
      s.r[i] = radiusOf(node)
      s.kindCode[i] = KIND_CODE[node.kind] ?? 2
      s.container[i] = node.kind === 'project' || node.kind === 'folder' ? 1 : 0
      s.collapsed[i] = node.collapsed ? 1 : 0
      s.dim[i] = node.dim ? 1 : 0
      s.label[i] = node.label || ''
      s.count[i] = node.count || 0
      s.priority[i] = (s.container[i] ? 1000 : 0) + (node.count || 0) - (node.depth || 0)
    })
    // Keep every known dot where it was; a new dot starts at its parent.
    graph.nodes.forEach((node, i) => {
      const j = prev.index.get(node.id)
      if (j !== undefined) { s.xy[2 * i] = prev.xy[2 * j]; s.xy[2 * i + 1] = prev.xy[2 * j + 1]; return }
      const pj = node.parent != null ? prev.index.get(node.parent) : undefined
      if (pj !== undefined) { s.xy[2 * i] = prev.xy[2 * pj]; s.xy[2 * i + 1] = prev.xy[2 * pj + 1] }
    })
    const ends = []
    const kinds = []
    for (const e of graph.edges) {
      const a = s.index.get(e.source)
      const b = s.index.get(e.target)
      if (a === undefined || b === undefined) continue
      ends.push(a, b)
      kinds.push(EDGE_KIND_CODE[e.kind] ?? 2)
    }
    s.m = kinds.length
    s.ends = Uint32Array.from(ends)
    s.kind = Uint8Array.from(kinds)
    return s
  }

  function positionsArray(input) {
    if (input instanceof Float32Array || input instanceof Float64Array) {
      if (input.length !== 2 * scene.n) return null
      return Float32Array.from(input)
    }
    if (input && typeof input === 'object') {
      const out = Float32Array.from(scene.xy)
      for (const [id, p] of Object.entries(input)) {
        const i = scene.index.get(id)
        if (i === undefined || !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
        out[2 * i] = p.x
        out[2 * i + 1] = p.y
      }
      return out
    }
    return null
  }

  const api = {
    invalidate,
    setScene(graph) {
      scene = buildScene(graph)
      tween = null
      selected = selectedId != null && scene.index.has(selectedId) ? scene.index.get(selectedId) : -1
      hovered = hoveredId != null && scene.index.has(hoveredId) ? scene.index.get(hoveredId) : -1
      invalidate()
    },
    /** Float32Array in scene order (a worker tick) or { id: { x, y } }. */
    setPositions(input, { tweenMs = 0 } = {}) {
      const next = positionsArray(input)
      if (!next) return false
      if (tweenMs > 0 && !calm) tween = { from: Float32Array.from(scene.xy), to: next, start: now(), ms: tweenMs }
      else { tween = null; scene.xy = next }
      invalidate()
      return true
    },
    resize(width, height, ratio = 1) {
      viewport = { width: Math.max(1, width), height: Math.max(1, height) }
      dpr = ratio > 0 ? ratio : 1
      canvas.width = Math.round(viewport.width * dpr)
      canvas.height = Math.round(viewport.height * dpr)
      invalidate()
    },
    camera: () => cam,
    viewport: () => viewport,
    setCamera(next) { fly = null; cam = makeCamera(next.x, next.y, next.k); invalidate() },
    panBy(dx, dy) { fly = null; cam = panCamera(cam, dx, dy); invalidate() },
    zoomAt(factor, sx, sy) { fly = null; cam = zoomCamera(cam, viewport, factor, sx, sy); invalidate() },
    /** target: { x, y, k } or { id, k }. Reduced motion jumps. */
    flyTo(target, { ms = 650 } = {}) {
      let to = target
      if (target && target.id != null) {
        const i = scene.index.get(target.id)
        if (i === undefined) return false
        to = { x: scene.xy[2 * i], y: scene.xy[2 * i + 1], k: target.k ?? Math.max(cam.k, 1.2) }
      }
      if (!to || !Number.isFinite(to.x) || !Number.isFinite(to.y)) return false
      const path = flyPath(cam, to, viewport, calm ? 0 : ms)
      if (path.duration === 0) { fly = null; cam = path.at(0) } else fly = { path, start: now() }
      invalidate()
      return true
    },
    /** What is under a screen point in the last drawn frame. */
    hitTest(sx, sy, slopPx = 4) {
      if (!last) return null
      let best = null
      let bestD = Infinity
      const D = last.dots
      for (let d = 0; d < D.count; d++) {
        const dist = Math.hypot(D.x[d] - sx, D.y[d] - sy)
        if (dist <= D.r[d] + slopPx && dist < bestD) { bestD = dist; best = { type: 'dot', id: scene.ids[D.index[d]] } }
      }
      if (best) return best
      const K = last.clusters
      for (let c = 0; c < K.count; c++) {
        const dist = Math.hypot(K.x[c] - sx, K.y[c] - sy)
        if (dist <= K.r[c] + slopPx && dist < bestD) { bestD = dist; best = { type: 'cluster', size: K.size[c], x: K.x[c], y: K.y[c] } }
      }
      return best
    },
    setSelection(id) { selectedId = id ?? null; const i = id != null ? scene.index.get(id) : undefined; const next = i === undefined ? -1 : i; if (next !== selected) { selected = next; invalidate() } },
    setHover(id) { hoveredId = id ?? null; const i = id != null ? scene.index.get(id) : undefined; const next = i === undefined ? -1 : i; if (next !== hovered) { hovered = next; invalidate() } },
    /** glowParams() output; only the shadows read it here (the glow has its own canvas). */
    setGlow(next) { glow = next || null; invalidate() },
    setReducedMotion(v) {
      calm = !!v
      if (calm && fly) { cam = fly.path.at(fly.path.duration); fly = null }
      if (calm && tween) { scene.xy = tween.to; tween = null }
      invalidate()
    },
    positionsSnapshot(pinned) { return positionsToData(scene.ids, scene.xy, pinned) },
    lod: () => (last ? last.lod : LOD.MID),
    frameRequested: () => pending != null,
    stats: () => ({ frames, requests, animating: animating() }),
    destroy() {
      destroyed = true
      if (pending != null) cancelFrame(pending)
      pending = null
      fly = tween = null
    },
  }
  return api
}
