// =============================================================================
// renderer.js — M.O.T.H.'s Canvas2D renderer (MO2a, the brief's item 3).
//
//   * Draws on demand only. invalidate() asks for ONE animation frame when
//     none is pending; frames continue only while a fly-to or a position
//     tween is running (both bounded in time), and a streamed layout asks for
//     one frame per batch of ticks. Settled and idle, it requests nothing at
//     all (the brief: "no work at all when nothing moves"; PLAN_MOTH: "no
//     continuous settled layout or hidden render loop").
//   * Each frame executes a draw list from frame.js (culling, clustering,
//     level of detail): each line its own stroke, dots in one path per
//     colour, a pre-rendered halo sprite under dots, clusters and labels over
//     the bright core (glow.js shadowAlpha), in full and light mode alike.
//   * Feedback: setSelection / setHover redraw on the next frame, and
//     hitTest reads the frame on screen (its own dot ids), so a press is
//     answered within a frame (the target is 100 ms).
//   * The lighter mode comes from governor.js. Each frame drawn while the
//     camera moves (pan, zoom, pinch, fly-to, tween) feeds it the larger of
//     its script work and how late the frame came (request to callback, and
//     frame to frame when the motion is continuous), so a slow raster or
//     compositor counts, not only script; the script work goes with it for
//     the exit test. Frames that only show a settling layout are not fed.
//   * A dot that has never been given a place (new, and no ancestor with
//     one) is drawn at the centre of the world but never saved as a place.
//
// Injected for tests: requestFrame, cancelFrame, now, createCanvas.
// =============================================================================

import { panBy as panCamera, zoomAt as zoomCamera, flyTo as flyPath, camera as makeCamera, boundedMs } from './camera.js'
import { computeFrame, LOD, FRAME_DEFAULTS } from './frame.js'
import { shadowAlpha } from './glow.js'
import { defaultRadius, positionsToData, EDGE_CODE, CONTAINER_KINDS } from './model.js'
import { TYPE, FONT_SANS, SIGNAL } from '../../../ui/tokens.js'

const KIND_CODE = Object.freeze({
  project: 0, folder: 1, file: 2, tag: 3,
  phase: 4, asset: 5, task: 6, scene: 7, shot: 8, level: 9, experience: 10,
})
const CONTAINER = new Set(CONTAINER_KINDS)

/** The defaults the page overrides from its Settings; type and the selection come from the kit. */
export const DEFAULT_PALETTE = Object.freeze({
  // By KIND_CODE: the hierarchy in whites, a tag in the light's own warmth, and each kind of item a pale tint
  // of its own, so the world stays airy and a dot's kind still reads at a glance.
  dot: Object.freeze(['#ffffff', '#f4f1ea', '#d9d6cf', '#ffd28a',
    '#c9d6ff', '#ffc9e0', '#c8f0d8', '#ffe3b8', '#ffd9a8', '#d8c8ff', '#bfeff0']),
  edge: Object.freeze(['rgba(255,255,255,0.22)', 'rgba(255,210,138,0.20)', 'rgba(170,200,255,0.26)']), // by EDGE_CODE
  cluster: 'rgba(244,241,234,0.75)',
  clusterText: '#000000',
  clusterEdge: 'rgba(255,255,255,0.14)',
  selection: SIGNAL,
  hover: 'rgba(255,255,255,0.8)',
  link: 'rgba(255,255,255,0.55)', // a dot that would take a link: a soft glow around it
  move: 'rgba(255,255,255,0.9)', // a container that would take a move: it opens wider
  label: '#ffffff',
  labelShadow: '0,0,0',
  font: `${TYPE.caption}px ${FONT_SANS}`,
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

/** The soft dark disc drawn under a dot, cluster or label over the light. */
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
  const budgetMs = 20 // a frame request within this of the last frame is continuous motion
  const charPx = frameOptions.charPx ?? FRAME_DEFAULTS.charPx // a label's width, as frame.js spaces them
  let viewport = { width: canvas.width || 1, height: canvas.height || 1 }
  let dpr = 1
  let cam = makeCamera()
  let scene = emptyScene()
  let glow = null
  let calm = !!reducedMotion
  let selected = -1 // the first selected dot, the one whose label is always drawn
  let hovered = -1
  let selectedIds = [] // every selected dot, the first included
  let hoveredId = null
  let colourOf = null // Settings' "colour by": node -> css colour, or null for its kind's
  let lastGraph = null
  let target = null // { id, mode: 'link' | 'move' } while a drag is over a dot that would take it
  let pending = null
  let requestedAt = null
  let destroyed = false
  let fly = null // { path, start }
  let tween = null // { from, to, start, ms }
  let last = null // the last drawn frame's draw list, with its ids
  let paused = false // hidden: nothing asks a frame until shown again
  let lastFrameEnd = null
  let lastFrameAt = null
  let frames = 0
  let requests = 0
  let moved = false // the camera moved since the last frame (pan, zoom, pinch)

  function emptyScene() {
    return {
      n: 0, ids: [], index: new Map(), xy: new Float32Array(0), r: new Float32Array(0), placed: new Uint8Array(0),
      kindCode: new Uint8Array(0), container: new Uint8Array(0), collapsed: new Uint8Array(0), dim: new Uint8Array(0),
      label: [], count: new Uint32Array(0), priority: new Float32Array(0),
      colour: new Uint16Array(0), colours: [],
      m: 0, ends: new Uint32Array(0), kind: new Uint8Array(0),
    }
  }

  function invalidate() {
    if (pending != null || destroyed || paused) return
    requests++
    requestedAt = now()
    pending = requestFrame(onAnimationFrame)
  }

  const animating = () => fly != null || tween != null

  function onAnimationFrame() {
    pending = null
    if (destroyed) return
    const t0 = now()
    const asked = requestedAt
    renderNow(t0)
    const t1 = now()
    const work = t1 - t0
    // How late this frame came: from the request, and from the previous
    // frame when the request followed it closely (continuous motion; a pause
    // in a drag starts afresh).
    const late = asked != null ? t0 - asked : 0
    const continuous = asked != null && lastFrameEnd != null && asked - lastFrameEnd <= budgetMs
    const gap = continuous && lastFrameAt != null ? t0 - lastFrameAt : 0
    const sample = Math.max(work, late, gap)
    const light = governor ? governor.mode() === 'light' : false
    if (governor && (moved || animating())) governor.record(sample, work) // camera motion only
    moved = false
    if (onFrame) onFrame({ workMs: work, intervalMs: continuous ? gap : null, sampleMs: sample, lod: last.lod, dots: last.dots.count, edges: last.edges.count + last.clusterEdges.count, clusters: last.clusters.count, light })
    lastFrameAt = t0
    lastFrameEnd = t1
    if (animating()) invalidate()
  }

  /** Advance any fly-to or tween to time t and draw. */
  function renderNow(t) {
    if (fly) {
      const el = t - fly.start
      cam = fly.path.at(el)
      if (fly.path.done(el)) fly = null
    }
    if (tween) {
      const u = Math.min(1, (t - tween.start) / tween.ms)
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2
      for (let i = 0; i < scene.xy.length; i++) scene.xy[i] = tween.from[i] + (tween.to[i] - tween.from[i]) * e
      if (u >= 1) tween = null
    }
    const light = governor ? governor.mode() === 'light' : false
    last = computeFrame(scene, cam, viewport, { ...frameOptions, light, selected, prevCell: last?.cell ?? null })
    last.ids = scene.ids
    draw(last)
    frames++
  }

  function strokeLine(x1, y1, x2, y2) {
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }

  function haloAt(x, y, r, alpha) {
    const s = r * 2.4 + 4
    ctx.globalAlpha = alpha
    ctx.drawImage(halo, x - s, y - s, 2 * s, 2 * s)
  }

  function draw(list) {
    const p = palette
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, viewport.width, viewport.height)
    ctx.lineWidth = 1

    // Lines: grouped by (kind, mist) so the style changes rarely, but each one
    // its own stroke. Above scale 1 a 1 px line is no longer a hairline, and the
    // browser rasters a stroke of many segments in software (measured at 4K and
    // 150%: 64 to 81 ms a frame for 2,000 lines, 16.7 ms stroked one by one).
    const E = list.edges
    for (let kind = 0; kind < 3; kind++) {
      for (let dim = 0; dim < 2; dim++) {
        let any = false
        for (let e = 0; e < E.count; e++) {
          if (E.kind[e] !== kind || E.dim[e] !== dim) continue
          if (!any) {
            ctx.globalAlpha = dim ? p.dimAlpha : 1
            ctx.strokeStyle = p.edge[kind]
            any = true
          }
          strokeLine(E.x1[e], E.y1[e], E.x2[e], E.y2[e])
        }
      }
    }
    const C = list.clusterEdges
    for (let dim = 0; dim < 2; dim++) {
      let any = false
      for (let e = 0; e < C.count; e++) {
        if (C.dim[e] !== dim) continue
        if (!any) {
          ctx.globalAlpha = dim ? p.dimAlpha : 1
          ctx.strokeStyle = p.clusterEdge
          any = true
        }
        strokeLine(C.x1[e], C.y1[e], C.x2[e], C.y2[e])
      }
    }

    // Halos under whatever sits over the bright core (dots and clusters).
    const D = list.dots
    const K = list.clusters
    if (glow) {
      for (let d = 0; d < D.count; d++) {
        const a = shadowAlpha(D.x[d], D.y[d], glow, viewport)
        if (a >= 0.01) haloAt(D.x[d], D.y[d], D.r[d], a * (scene.dim[D.index[d]] ? p.dimAlpha : 1))
      }
      for (let c = 0; c < K.count; c++) {
        const a = shadowAlpha(K.x[c], K.y[c], glow, viewport)
        if (a >= 0.01) haloAt(K.x[c], K.y[c], K.r[c], a * (K.dim[c] ? p.dimAlpha : 1))
      }
    }

    // Dots: one path per (colour, mist) pair. A dot's colour is its kind's, or what Settings' colour by gives.
    for (let ci = 0; ci < scene.colours.length; ci++) {
      for (let dim = 0; dim < 2; dim++) {
        let any = false
        for (let d = 0; d < D.count; d++) {
          const i = D.index[d]
          if (scene.colour[i] !== ci || scene.dim[i] !== dim) continue
          if (!any) { ctx.beginPath(); any = true }
          ctx.moveTo(D.x[d] + D.r[d], D.y[d])
          ctx.arc(D.x[d], D.y[d], D.r[d], 0, 2 * Math.PI)
        }
        if (any) {
          ctx.globalAlpha = dim ? p.dimAlpha : 1
          ctx.fillStyle = scene.colours[ci]
          ctx.fill()
        }
      }
    }

    // Clusters (FAR), mist kept, with their size inside when it reads.
    if (K.count) {
      for (let dim = 0; dim < 2; dim++) {
        let any = false
        for (let c = 0; c < K.count; c++) {
          if (K.dim[c] !== dim) continue
          if (!any) { ctx.beginPath(); any = true }
          ctx.moveTo(K.x[c] + K.r[c], K.y[c])
          ctx.arc(K.x[c], K.y[c], K.r[c], 0, 2 * Math.PI)
        }
        if (any) {
          ctx.globalAlpha = dim ? p.dimAlpha : 1
          ctx.fillStyle = p.cluster
          ctx.fill()
        }
      }
      ctx.font = p.font
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = p.clusterText
      for (let c = 0; c < K.count; c++) {
        if (K.r[c] < 10) continue
        ctx.globalAlpha = K.dim[c] ? p.dimAlpha : 1
        ctx.fillText(String(K.size[c]), K.x[c], K.y[c])
      }
    }

    // Selection and hover rings, and the dot a drag would land on: a glow for a link, a wider ring for a move.
    const ring = (i, style, grow = 3, width = 2) => {
      const d = D.index.indexOf(i)
      if (d < 0) return
      ctx.globalAlpha = 1
      ctx.strokeStyle = style
      ctx.lineWidth = width
      ctx.beginPath()
      ctx.arc(D.x[d], D.y[d], D.r[d] + grow, 0, 2 * Math.PI)
      ctx.stroke()
      ctx.lineWidth = 1
    }
    if (hovered >= 0) ring(hovered, p.hover)
    for (const id of selectedIds) {
      const i = scene.index.get(id)
      if (i !== undefined) ring(i, p.selection)
    }
    if (target) {
      const i = scene.index.get(target.id)
      const d = i === undefined ? -1 : D.index.indexOf(i)
      if (d >= 0) {
        if (target.mode === 'move') {
          ring(i, p.move, Math.max(6, D.r[d] * 0.6), 2)
        } else {
          for (const [grow, a] of [[10, 0.18], [6, 0.32], [3, 0.5]]) {
            ctx.globalAlpha = a
            ctx.fillStyle = p.link
            ctx.beginPath()
            ctx.arc(D.x[d], D.y[d], D.r[d] + grow, 0, 2 * Math.PI)
            ctx.fill()
          }
          ctx.globalAlpha = 1
        }
      }
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
        // Judged where the text comes nearest the bright core, not at its first
        // letter: white text running into the core from outside needs the shadow
        // too. Still a smooth function of position, so it never snaps on.
        const nearest = Math.min(x + text.length * charPx, Math.max(x, viewport.width / 2))
        const a = glow ? shadowAlpha(nearest, y, glow, viewport) : 0
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
      xy: new Float32Array(2 * n), r: new Float32Array(n), placed: new Uint8Array(n),
      kindCode: new Uint8Array(n), container: new Uint8Array(n), collapsed: new Uint8Array(n), dim: new Uint8Array(n),
      label: new Array(n), count: new Uint32Array(n), priority: new Float32Array(n),
      m: 0, ends: null, kind: null,
      colour: new Uint16Array(n), colours: [],
    }
    paint(s, graph)
    graph.nodes.forEach((node, i) => {
      s.index.set(node.id, i)
      s.r[i] = radiusOf(node)
      s.kindCode[i] = KIND_CODE[node.kind] ?? KIND_CODE.file
      s.container[i] = CONTAINER.has(node.kind) ? 1 : 0
      s.collapsed[i] = node.collapsed ? 1 : 0
      s.dim[i] = node.dim ? 1 : 0
      s.label[i] = node.label || ''
      s.count[i] = node.count || 0
      s.priority[i] = (s.container[i] ? 1000 : 0) + (node.count || 0) - (node.depth || 0)
    })
    // Keep every known dot where it was. A new dot starts at its nearest
    // ancestor that has a place (however many new levels opened at once);
    // with none, it sits at the centre and is not marked placed.
    const parentOf = new Map(graph.nodes.map((nd) => [nd.id, nd.parent ?? null]))
    const where = (id, guard = 0) => {
      const j = prev.index.get(id)
      if (j !== undefined && prev.placed[j]) return j
      const p = parentOf.get(id)
      return p == null || guard > 64 ? undefined : where(p, guard + 1)
    }
    graph.nodes.forEach((node, i) => {
      const j = where(node.id)
      if (j === undefined) return
      s.xy[2 * i] = prev.xy[2 * j]
      s.xy[2 * i + 1] = prev.xy[2 * j + 1]
      s.placed[i] = prev.ids[j] === node.id ? 1 : 0 // a borrowed place is a start, not a saved place
    })
    const ends = []
    const kinds = []
    for (const e of graph.edges) {
      const a = s.index.get(e.source)
      const b = s.index.get(e.target)
      if (a === undefined || b === undefined) continue
      ends.push(a, b)
      kinds.push(EDGE_CODE[e.kind] ?? EDGE_CODE.related_to)
    }
    s.m = kinds.length
    s.ends = Uint32Array.from(ends)
    s.kind = Uint8Array.from(kinds)
    return s
  }

  /** Each dot's colour: its kind's, unless colour by gives one (a CSS colour string). */
  function paint(s, graph) {
    const colours = []
    const at = new Map()
    graph.nodes.forEach((node, i) => {
      let c = colourOf ? colourOf(node) : null
      if (typeof c !== 'string' || !c) c = palette.dot[KIND_CODE[node.kind] ?? KIND_CODE.file] ?? palette.dot[KIND_CODE.file]
      let k = at.get(c)
      if (k === undefined) { k = colours.length; colours.push(c); at.set(c, k) }
      s.colour[i] = k
    })
    s.colours = colours
  }

  /** Float32Array in scene order (a worker message), or { id: { x, y } }. Returns { xy, placed }. */
  function positionsArray(input) {
    if (input instanceof Float32Array || input instanceof Float64Array) {
      if (input.length !== 2 * scene.n) return null
      return { xy: Float32Array.from(input), placed: new Uint8Array(scene.n).fill(1) }
    }
    if (input && typeof input === 'object') {
      const xy = Float32Array.from(scene.xy)
      const placed = Uint8Array.from(scene.placed)
      for (const [id, p] of Object.entries(input)) {
        const i = scene.index.get(id)
        if (i === undefined || !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
        xy[2 * i] = p.x
        xy[2 * i + 1] = p.y
        placed[i] = 1
      }
      return { xy, placed }
    }
    return null
  }

  return {
    invalidate,
    setScene(graph) {
      lastGraph = graph
      // A new scene starts its clusters' cell afresh: a grown cell is kept only within one scene (R1-3).
      if (last) last.cell = null
      scene = buildScene(graph)
      tween = null
      selected = selectedIds.length && scene.index.has(selectedIds[0]) ? scene.index.get(selectedIds[0]) : -1
      hovered = hoveredId != null && scene.index.has(hoveredId) ? scene.index.get(hoveredId) : -1
      invalidate()
    },
    /** Float32Array in scene order (a worker tick) or { id: { x, y } }. A tween is bounded (2 s). */
    setPositions(input, { tweenMs = 0 } = {}) {
      const next = positionsArray(input)
      if (!next) return false
      const ms = boundedMs(tweenMs)
      scene.placed = next.placed
      if (ms > 0 && !calm) tween = { from: Float32Array.from(scene.xy), to: next.xy, start: now(), ms }
      else { tween = null; scene.xy = next.xy }
      invalidate()
      return true
    },
    /** A new size is drawn at once (a ResizeObserver runs after this frame's callbacks). */
    resize(width, height, ratio = 1) {
      const w = Math.max(1, Number.isFinite(width) ? width : 1)
      const h = Math.max(1, Number.isFinite(height) ? height : 1)
      const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
      const bw = Math.round(w * r)
      const bh = Math.round(h * r)
      const same = viewport.width === w && viewport.height === h && dpr === r && canvas.width === bw && canvas.height === bh
      if (same && last) return false // nothing changed: nothing to clear or draw
      viewport = { width: w, height: h }
      dpr = r
      canvas.width = bw
      canvas.height = bh
      if (pending != null) { cancelFrame(pending); pending = null }
      if (!destroyed) renderNow(now())
      if (animating()) invalidate()
      return true
    },
    camera: () => cam,
    viewport: () => viewport,
    setCamera(next) { fly = null; moved = true; cam = makeCamera(next?.x, next?.y, next?.k); invalidate() },
    panBy(dx, dy) { fly = null; moved = true; cam = panCamera(cam, dx, dy); invalidate() },
    zoomAt(factor, sx, sy) { fly = null; moved = true; cam = zoomCamera(cam, viewport, factor, sx, sy); invalidate() },
    /** target: { x, y, k } or { id, k }. Reduced motion jumps; a fly lasts at most 2 s. */
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
    /** What is under a screen point in the frame on screen. `exclude`: a dot id to look past (the one dragged). */
    hitTest(sx, sy, slopPx = 4, exclude = null) {
      if (!last) return null
      let best = null
      let bestD = Infinity
      const D = last.dots
      for (let d = 0; d < D.count; d++) {
        const id = last.ids[D.index[d]]
        if (id === exclude) continue
        const dist = Math.hypot(D.x[d] - sx, D.y[d] - sy)
        if (dist <= D.r[d] + slopPx && dist < bestD) { bestD = dist; best = { type: 'dot', id, dist, r: D.r[d] } }
      }
      if (best) return best
      const K = last.clusters
      for (let c = 0; c < K.count; c++) {
        const dist = Math.hypot(K.x[c] - sx, K.y[c] - sy)
        if (dist <= K.r[c] + slopPx && dist < bestD) { bestD = dist; best = { type: 'cluster', size: K.size[c], x: K.x[c], y: K.y[c] } }
      }
      return best
    },
    /** One id, several (an array, the first is the one whose label always shows), or none. */
    setSelection(ids) {
      const list = ids == null ? [] : Array.isArray(ids) ? ids.filter((x) => x != null) : [ids]
      const same = list.length === selectedIds.length && list.every((x, k) => x === selectedIds[k])
      selectedIds = list
      const i = list.length ? scene.index.get(list[0]) : undefined
      const next = i === undefined ? -1 : i
      if (next !== selected || !same) { selected = next; invalidate() }
    },
    /** The dot a drag would land on, and how: { id, mode: 'link' | 'move' }, or null. */
    setTarget(next) {
      const t2 = next && next.id != null && (next.mode === 'link' || next.mode === 'move') ? { id: next.id, mode: next.mode } : null
      if ((t2 && target && t2.id === target.id && t2.mode === target.mode) || (!t2 && !target)) return
      target = t2
      invalidate()
    },
    /** Settings' colour by: node -> CSS colour (or null for its kind's). Repaints the scene as it is. */
    setColours(fn) {
      colourOf = typeof fn === 'function' ? fn : null
      if (lastGraph) paint(scene, lastGraph)
      invalidate()
    },
    /** Where a dot is now, in screen pixels, and its drawn radius; null if it is not in the scene. */
    screenOf(id) {
      const i = scene.index.get(id)
      if (i === undefined) return null
      const k = cam.k
      return {
        x: (scene.xy[2 * i] - cam.x) * k + viewport.width / 2,
        y: (scene.xy[2 * i + 1] - cam.y) * k + viewport.height / 2,
        r: scene.r[i] * k,
      }
    },
    /** Where a dot is now in the world (its tween's end while one runs), or null. */
    worldOf(id) {
      const i = scene.index.get(id)
      if (i === undefined) return null
      const xy = tween ? tween.to : scene.xy
      return { x: xy[2 * i], y: xy[2 * i + 1], placed: scene.placed[i] === 1 }
    },
    setHover(id) {
      hoveredId = id ?? null
      const i = id != null ? scene.index.get(id) : undefined
      const next = i === undefined ? -1 : i
      if (next !== hovered) { hovered = next; invalidate() }
    },
    /** glowParams() output; only the shadows read it here (the glow has its own canvas). */
    setGlow(next) { glow = next || null; invalidate() },
    /** Hidden, no frame is asked for, whatever changes; shown again, it draws once. */
    setPaused(v) { paused = !!v; if (!paused) invalidate() },
    setReducedMotion(v) {
      calm = !!v
      if (calm && fly) { cam = fly.path.at(fly.path.duration); fly = null }
      if (calm && tween) { scene.xy = tween.to; tween = null }
      invalidate()
    },
    /** Places as data for saving (model.js positionsToData); a dot never placed is left out. */
    positionsSnapshot(pinned = () => false) {
      const placed = scene.placed
      return positionsToData(scene.ids, scene.xy, { pinned, placed: (i) => placed[i] === 1 })
    },
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
}
