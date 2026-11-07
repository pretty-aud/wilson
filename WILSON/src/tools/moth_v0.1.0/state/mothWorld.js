// mothWorld.js — MO2: the world Moth draws, as one controller over the engine (PLAN_MOTH §5 Session 2, items 3-5
// and 9-10; the brief §1.1, §2, §4.1, §4.2). The page hands it a graph and a few settings; it owns the canvas,
// the light behind it, the layout worker, the camera and the pointer, and tells the page what a person did.
//
// The engine's rules it keeps (engine hand-off §7 and its OTHER list, part A):
//   * setScene and the layout's run in one turn, so a stale tick cannot land on the wrong dots (R1-11).
//   * Its own map of places, fed by every tick and every drag, so closing and opening a folder, a tween in
//     flight or a scene change never loses where a dot was (R1-4, R1-8), and a fly-to goes where a dot is going
//     (R1-7). A radial layout's places are computed; a dot moved by hand there keeps its place on top (R1-25).
//   * The light's size is the page's to give (the whole authorised scope, read whole), never the view's.
//   * Hidden, the light stops (setActive(false)) and no frame is asked for.
//   * A pick from the list flies close enough that a clustered dot shows (R1-6).
//
// Gestures (the brief §4.2): press on a dot and move past a few pixels to drag it. Over another dot, close by, it
// would link (the target glows, the word "link" by the cursor); onto a container that can take it, it would move
// (the target opens wider, "move into"). Escape cancels and the dot goes back. Released in empty space, only the
// picture changes. Rest the mouse half a second on a dot and the page is asked to bloom a preview; a press or a
// move away ends it at once. A press off any dot pans; two fingers pinch.
import { createRenderer } from '../engine/renderer.js'
import { createLayoutClient } from '../engine/layoutClient.js'
import { bindNavigation } from '../engine/navigation.js'
import { mountGlow, glowParams } from '../engine/glow.js'
import { createFrameGovernor } from '../engine/governor.js'
import { toLayoutInput, defaultRadius } from '../engine/model.js'
import { screenToWorld } from '../engine/camera.js'

export const DRAG_SLOP_PX = 5
export const LINK_REACH_PX = 28
export const BLOOM_REST_MS = 500
/** A pick from the list flies at least this close, past the zoom where dots cluster (frame.js clusterBelowK). */
export const PICK_ZOOM = 0.9

const CONTAINERS = new Set(['project', 'folder', 'phase', 'scene'])

export function createMothWorld({
  canvas,
  glowCanvas = null,
  createWorker,
  requestFrame,
  cancelFrame,
  now,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
  reducedMotion = false,
  onFrame = null,
} = {}) {
  const governor = createFrameGovernor()
  let radiusFn = defaultRadius // Settings' size by
  const listeners = { pick: null, open: null, hover: null, bloom: null, drop: null, arranged: null, drag: null, settled: null, frame: onFrame }
  const renderer = createRenderer({
    canvas,
    governor,
    reducedMotion,
    radiusOf: (n) => radiusFn(n),
    ...(requestFrame ? { requestFrame } : {}),
    ...(cancelFrame ? { cancelFrame } : {}),
    ...(now ? { now } : {}),
    onFrame: (f) => {
      if (f.light !== lightSeen) { lightSeen = f.light; paintGlow() }
      listeners.frame?.(f)
    },
  })
  const glow = glowCanvas ? mountGlow(glowCanvas) : null
  let lightSeen = false
  let appearance = { glowColor: undefined, glowSize: 0 }
  let calm = !!reducedMotion
  let active = true
  let viewport = { width: 1, height: 1, dpr: 1 }
  let graph = { nodes: [], edges: [] }
  let byId = new Map()
  let input = { nodes: [], links: [] }
  let layoutKind = 'force'
  const places = new Map() // id -> { x, y } (the world's own memory of where each dot was)
  const handPlaced = new Map() // id -> { x, y }: dropped by hand, kept on top of a radial layout
  const pinned = new Set()
  let rules = { canMove: () => ({ allowed: false }), canLink: () => ({ allowed: false }), canDrag: () => true }

  const client = createLayoutClient({
    ...(createWorker ? { createWorker } : {}),
    onTick: (m) => { remember(m.xy); renderer.setPositions(m.xy) },
    onSettled: (m) => {
      remember(m.xy)
      renderer.setPositions(m.xy)
      if (layoutKind === 'radial' && handPlaced.size) renderer.setPositions(Object.fromEntries(handPlaced))
      listeners.settled?.()
    },
    // A refused pin (radial, or a dot the job no longer holds) leaves the job as it was; anything else ended it.
    onError: (m) => { if (m?.code !== 'refused') listeners.settled?.() },
  })

  function remember(xy) {
    if (!(xy instanceof Float32Array) || xy.length !== 2 * input.nodes.length) return
    input.nodes.forEach((n, i) => { places.set(n.id, { x: xy[2 * i], y: xy[2 * i + 1] }) })
  }

  function paintGlow() {
    const params = glowParams({ size: appearance.glowSize || 0, color: appearance.glowColor, reducedMotion: calm, light: lightSeen })
    renderer.setGlow(params)
    glow?.update(params, { width: viewport.width, height: viewport.height }, viewport.dpr)
  }

  // ── The graph, laid out ──────────────────────────────────────────────────────────────────────────────────
  /**
   * A new graph (model.js buildGraph). `saved`: { id: { x, y, pinned } } from the view's saved places, which win
   * over what the world remembers. `layout`: 'force' or 'radial'. The scene and the layout's run share this turn.
   */
  function setGraph(next, { layout = 'force', saved = null } = {}) {
    graph = next || { nodes: [], edges: [] }
    byId = new Map(graph.nodes.map((n) => [n.id, n]))
    layoutKind = layout === 'radial' ? 'radial' : 'force'
    if (saved) {
      handPlaced.clear()
      pinned.clear()
      for (const [id, p] of Object.entries(saved)) {
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
        places.set(id, { x: p.x, y: p.y })
        if (p.pinned) { pinned.add(id); handPlaced.set(id, { x: p.x, y: p.y }) }
      }
    }
    input = toLayoutInput(graph, (n) => radiusFn(n))
    const known = {}
    for (const n of input.nodes) {
      const p = places.get(n.id)
      if (p) known[n.id] = { x: p.x, y: p.y, ...(pinned.has(n.id) ? { pinned: true } : {}) }
    }
    renderer.setScene(graph)
    if (Object.keys(known).length) renderer.setPositions(known)
    if (input.nodes.length) client.run({ layout: layoutKind, nodes: input.nodes, links: input.links, positions: known })
    else client.stop()
  }

  /** Lay the view out afresh: everything but what was pinned by hand may move. */
  function relayout() {
    for (const n of input.nodes) if (!pinned.has(n.id)) places.delete(n.id)
    handPlaced.forEach((_p, id) => { if (!pinned.has(id)) handPlaced.delete(id) })
    setGraph(graph, { layout: layoutKind })
  }

  /** Where each dot is now, as data for saving: { id: { x, y, pinned } } for the dots on show. */
  function positions() {
    const out = {}
    for (const n of graph.nodes) {
      const p = handPlaced.get(n.id) || places.get(n.id)
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) out[n.id] = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, pinned: pinned.has(n.id) }
    }
    return out
  }

  // ── The pointer ──────────────────────────────────────────────────────────────────────────────────────────
  let press = null // { id, pointerId, x0, y0, sx, sy, start, dragging, mode, target }
  let bloomTimer = null
  let bloomId = null
  const local = (e) => {
    const r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0 }
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const stopBloom = () => {
    if (bloomTimer != null) { clearTimer(bloomTimer); bloomTimer = null }
    if (bloomId != null) { bloomId = null; listeners.bloom?.(null) }
  }

  function targetFor(s) {
    if (!press) return null
    const from = byId.get(press.id)
    const hit = renderer.hitTest(s.x, s.y, LINK_REACH_PX, press.id)
    if (!hit || hit.type !== 'dot') return null
    const to = byId.get(hit.id)
    if (!from || !to) return null
    const onto = hit.dist <= Math.max(hit.r, 6)
    if (onto && CONTAINERS.has(to.kind)) {
      const verdict = rules.canMove(from, to) || { allowed: false }
      return { id: to.id, mode: 'move', allowed: !!verdict.allowed, reason: verdict.reason || null }
    }
    const verdict = rules.canLink(from, to) || { allowed: false }
    return { id: to.id, mode: 'link', allowed: !!verdict.allowed, reason: verdict.reason || null }
  }

  function endDrag(cancelled) {
    if (!press) return
    const p = press
    press = null
    renderer.setTarget(null)
    listeners.drag?.(null)
    if (!p.dragging) return
    // Back where it was: through the layout itself, so its next tick agrees, then free again unless it was pinned.
    const putBack = () => {
      if (layoutKind === 'force') {
        client.pin(p.id, p.start.x, p.start.y)
        if (!p.wasPinned) client.unpin(p.id)
      }
      renderer.setPositions({ [p.id]: p.start })
      places.set(p.id, p.start)
      if (!p.wasPinned) pinned.delete(p.id)
    }
    if (cancelled) { putBack(); return } // Escape: and nothing else said
    if (p.target && p.target.allowed) {
      // The data change is the page's; until it lands the dot goes back.
      putBack()
      listeners.drop?.({ dragId: p.id, targetId: p.target.id, mode: p.target.mode })
      return
    }
    const at = places.get(p.id) || p.start
    pinned.add(p.id)
    handPlaced.set(p.id, { x: at.x, y: at.y })
    listeners.arranged?.({ id: p.id, x: at.x, y: at.y })
  }

  const onPointerDown = (e) => {
    stopBloom()
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return
    const s = local(e)
    const hit = renderer.hitTest(s.x, s.y, e.pointerType === 'mouse' ? 4 : 10)
    if (!hit || hit.type !== 'dot') {
      press = null
      if (!hit) listeners.pick?.(null, { additive: !!(e.shiftKey || e.ctrlKey || e.metaKey) })
      return
    }
    const w = places.get(hit.id) || renderer.worldOf(hit.id) || { x: 0, y: 0 }
    press = {
      id: hit.id, pointerId: e.pointerId, sx: s.x, sy: s.y, start: { x: w.x, y: w.y },
      dragging: false, target: null, additive: !!(e.shiftKey || e.ctrlKey || e.metaKey), wasPinned: pinned.has(hit.id),
      allowed: rules.canDrag(byId.get(hit.id)) !== false,
    }
    canvas.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    const s = local(e)
    if (press && e.pointerId === press.pointerId) {
      if (!press.dragging) {
        if (Math.hypot(s.x - press.sx, s.y - press.sy) < DRAG_SLOP_PX || !press.allowed) return
        press.dragging = true
        stopBloom()
      }
      const w = screenToWorld(renderer.camera(), renderer.viewport(), s.x, s.y)
      places.set(press.id, w)
      if (layoutKind === 'force') client.pin(press.id, w.x, w.y)
      renderer.setPositions({ [press.id]: w })
      const t = targetFor(s)
      press.target = t
      renderer.setTarget(t && t.allowed ? { id: t.id, mode: t.mode } : null)
      listeners.drag?.({ id: press.id, x: s.x, y: s.y, target: t })
      return
    }
    if (e.pointerType && e.pointerType !== 'mouse') return
    // Hover, the mouse only: a ring at once, a bloom after half a second at rest.
    const hit = renderer.hitTest(s.x, s.y, 4)
    const id = hit && hit.type === 'dot' ? hit.id : null
    renderer.setHover(id)
    listeners.hover?.(id)
    if (id !== bloomId) {
      stopBloom()
      if (id) {
        bloomTimer = setTimer(() => {
          bloomTimer = null
          bloomId = id
          const at = renderer.screenOf(id)
          listeners.bloom?.(at ? { id, x: at.x, y: at.y, r: at.r } : null)
        }, BLOOM_REST_MS)
      }
    }
  }
  const onPointerUp = (e) => {
    if (!press || e.pointerId !== press.pointerId) return
    if (!press.dragging) {
      const p = press
      press = null
      listeners.pick?.(p.id, { additive: p.additive })
      return
    }
    endDrag(false)
  }
  const onPointerCancel = () => endDrag(true)
  const onPointerLeave = () => { renderer.setHover(null); listeners.hover?.(null); stopBloom() }
  const onDoubleClick = (e) => {
    const s = local(e)
    const hit = renderer.hitTest(s.x, s.y, 4)
    if (hit && hit.type === 'dot' && CONTAINERS.has(byId.get(hit.id)?.kind)) listeners.open?.(hit.id)
  }
  const onKeyDown = (e) => { if (e.key === 'Escape' && press?.dragging) { e.preventDefault(); e.stopPropagation(); endDrag(true) } }

  canvas.addEventListener?.('pointerdown', onPointerDown)
  canvas.addEventListener?.('pointermove', onPointerMove)
  canvas.addEventListener?.('pointerup', onPointerUp)
  canvas.addEventListener?.('pointercancel', onPointerCancel)
  canvas.addEventListener?.('pointerleave', onPointerLeave)
  canvas.addEventListener?.('dblclick', onDoubleClick)
  const keyTarget = typeof window !== 'undefined' ? window : null
  keyTarget?.addEventListener('keydown', onKeyDown, true)
  // A press on a dot is the world's; anywhere else pans and pinches.
  const unbind = bindNavigation(canvas, renderer, {
    shouldStart: (e) => {
      if (press) return false
      const s = local(e)
      const hit = renderer.hitTest(s.x, s.y, e.pointerType === 'mouse' ? 4 : 10)
      return !hit || hit.type !== 'dot'
    },
  })

  return {
    renderer,
    governor,
    setGraph,
    relayout,
    positions,
    /** Appearance from Settings: the light's colour and size, a dot's colour (colour by), the light override. */
    setAppearance({ glowColor, glowSize, colourOf, light, radiusOf } = {}) {
      if (typeof radiusOf === 'function' && radiusOf !== radiusFn) { radiusFn = radiusOf; if (graph.nodes.length) setGraph(graph, { layout: layoutKind }) }
      if (glowColor !== undefined) appearance.glowColor = glowColor || undefined
      if (glowSize !== undefined) appearance.glowSize = Number.isFinite(glowSize) ? glowSize : 0
      if (colourOf !== undefined) renderer.setColours(colourOf)
      if (light !== undefined) governor.setOverride(['auto', 'full', 'light'].includes(light) ? light : 'auto')
      paintGlow()
    },
    setReducedMotion(v) { calm = !!v; renderer.setReducedMotion(calm); paintGlow() },
    /** What a drag may do: canDrag(node), canMove(dragNode, targetNode), canLink(dragNode, targetNode) → { allowed, reason }. */
    setRules(next) { rules = { ...rules, ...next } },
    /** Hidden, the world asks no frame and the light's animations stop; shown, it draws once. */
    setActive(v) {
      active = !!v
      glow?.setActive(active)
      if (!active) { stopBloom(); endDrag(true) } else renderer.invalidate()
    },
    resize(width, height, dpr = 1) {
      viewport = { width, height, dpr }
      renderer.resize(width, height, dpr)
      paintGlow()
    },
    setSelection(ids) { renderer.setSelection(ids) },
    /** Fly to a dot, at least close enough that it is drawn on its own. */
    flyTo(id) {
      const p = places.get(id) || renderer.worldOf(id)
      if (!p) return false
      const k = Math.max(renderer.camera().k, PICK_ZOOM)
      return renderer.flyTo({ x: p.x, y: p.y, k })
    },
    on(event, fn) { if (event in listeners) listeners[event] = fn },
    isActive: () => active,
    destroy() {
      endDrag(true)
      stopBloom()
      unbind()
      canvas.removeEventListener?.('pointerdown', onPointerDown)
      canvas.removeEventListener?.('pointermove', onPointerMove)
      canvas.removeEventListener?.('pointerup', onPointerUp)
      canvas.removeEventListener?.('pointercancel', onPointerCancel)
      canvas.removeEventListener?.('pointerleave', onPointerLeave)
      canvas.removeEventListener?.('dblclick', onDoubleClick)
      keyTarget?.removeEventListener('keydown', onKeyDown, true)
      client.dispose()
      glow?.destroy()
      renderer.destroy()
    },
  }
}
