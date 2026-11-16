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
//
// MO5 (her item 6): with "Move what is joined along" on (setCarry), a drag carries what is joined to the dot it moves
// (carriedBy below): it all moves by the same step, the dot under the pointer cannot land on any of it, Escape puts it
// all back, and a drop in empty space keeps it all where it was let go.
//
// MO5 (her item 5): with glide on (setGlide; never while motion is reduced), a dot flung into empty space carries on a
// little and slows to a stop, with what it carries, before its place is kept. A press anywhere, a new graph, hiding
// the map or asking for less motion stops it where it is, and that place is kept.
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
/**
 * MO5 (her item 5): how a let-go dot glides. Its speed over the last moments of the drag, read in screen pixels a
 * millisecond, must be at least GLIDE.minSpeed (a flick, not a careful place); it then slows by e every tauMs, travels
 * at most maxTravelPx however hard it was flung, and stops below stopSpeed or after maxMs. A drag held still for
 * stillMs before letting go does not glide.
 */
export const GLIDE = Object.freeze({ tauMs: 140, minSpeed: 0.25, maxTravelPx: 180, stopSpeed: 0.02, maxMs: 700, sampleMs: 90, stillMs: 60 })

const CONTAINERS = new Set(['project', 'folder', 'phase', 'scene'])
const HUBS = new Set(['tag', 'mtag'])

/**
 * MO5 (her item 6): what a drag carries along — everything drawn inside the dot (a folder's, a project's, a phase's or
 * a scene's contents, however deep), and each dot a drawn line joins to it one step out. Never what it lives in (its
 * own folders stay where they are), and never a tag's hub when anything but a tag is dragged: a hub joins many dots,
 * so it stays where they are. A dragged tag carries what it tags. Ids, in no promised order; the dot itself is not one.
 */
export function carriedBy(graph, id) {
  const nodes = graph?.nodes || []
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const me = byId.get(id)
  if (!me) return []
  const kids = new Map()
  for (const n of nodes) {
    if (n.parent == null) continue
    if (!kids.has(n.parent)) kids.set(n.parent, [])
    kids.get(n.parent).push(n.id)
  }
  const out = new Set()
  const stack = [...(kids.get(id) || [])]
  while (stack.length) {
    const k = stack.pop()
    if (k === id || out.has(k)) continue
    out.add(k)
    for (const c of kids.get(k) || []) stack.push(c)
  }
  const above = new Set()
  for (let p = me.parent; p != null && !above.has(p); p = byId.get(p)?.parent ?? null) above.add(p)
  for (const e of graph?.edges || []) {
    const other = e.source === id ? e.target : e.target === id ? e.source : null
    if (other == null || other === id || above.has(other) || !byId.has(other)) continue
    if (HUBS.has(byId.get(other).kind) && !HUBS.has(me.kind)) continue
    out.add(other)
  }
  return [...out]
}

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
  const listeners = { pick: null, open: null, hover: null, bloom: null, drop: null, arranged: null, drag: null, settled: null, frame: onFrame, menu: null }
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
  let inputIndex = new Map() // dot id -> its index in the layout's input
  let press = null // { id, pointerId, sx, sy, start, at, dragging, target, additive, wasPinned, allowed, carried, skip }
  let emptyPress = null // a press off any dot: a click there clears the selection, a pan does not
  let carry = false // MO5: a drag carries what is joined to the dot (carriedBy)
  let glideOn = false // MO5: a flung dot glides a little before its place is kept
  let glide = null // the glide under way: { p (the press it ends), base, vx, vy, k, t0, frame }
  const down = new Set() // pointers down on the canvas now
  const clock = now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
  const askFrame = requestFrame || ((fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(() => fn(clock()), 16)))
  const dropFrame = cancelFrame || ((h) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(h) : clearTimeout(h)))
  // MO5 round 1: what a carried drop left, held where it was let go until a layout still running settles; then the
  // layout starts again from the places on show (restartFromShown), so nothing it was forming is frozen half-made.
  const settleHold = new Map()
  // A dot being dragged is where the pointer is, whatever a layout tick computed before the pointer got there; so is
  // what it carries, by the same step; so is a dot gliding after it was let go; so is what a carried drop left.
  const holdDragged = (xy) => {
    if (!(xy instanceof Float32Array)) return
    const put = (id, p) => {
      const i = inputIndex.get(id)
      if (i != null && 2 * i + 1 < xy.length) { xy[2 * i] = p.x; xy[2 * i + 1] = p.y }
    }
    settleHold.forEach((p, id) => put(id, p))
    const m = press?.dragging ? press : glide?.p
    if (!m || !m.at) return
    put(m.id, m.at)
    for (const c of m.carried) if (c.at) put(c.id, c.at)
  }

  const client = createLayoutClient({
    ...(createWorker ? { createWorker } : {}),
    onTick: (m) => { holdDragged(m.xy); remember(m.xy); renderer.setPositions(m.xy) },
    onSettled: (m) => {
      holdDragged(m.xy)
      remember(m.xy)
      renderer.setPositions(m.xy)
      if (layoutKind === 'radial' && handPlaced.size) renderer.setPositions(Object.fromEntries(handPlaced))
      // A carried drop waited for this: the layout starts again from what is on show, and that run's settle is told.
      if (settleHold.size && layoutKind === 'force') { restartFromShown(); return }
      listeners.settled?.()
    },
    // A refused pin (radial, or a dot the job no longer holds) leaves the job as it was; anything else ended it.
    onError: (m) => { if (m?.code !== 'refused') { settleHold.clear(); listeners.settled?.({ failed: true }) } },
  })

  // The free layout starts again from the places on show, every dot given its place: nothing moves, nothing ticks.
  function restartFromShown() {
    settleHold.clear()
    if (layoutKind !== 'force' || !input.nodes.length) return
    const known = {}
    for (const n of input.nodes) {
      const q = handPlaced.get(n.id) || places.get(n.id)
      if (q) known[n.id] = { x: q.x, y: q.y, ...(pinned.has(n.id) ? { pinned: true } : {}) }
    }
    client.run({ layout: 'force', nodes: input.nodes, links: input.links, positions: known })
  }

  // The world's memory of places is the force layout's: a radial layout's places are computed from the tree each
  // time, so they never overwrite it (MO2 review round 1). Each place is updated where it is, not made anew, so a
  // tick of 20,000 dots allocates nothing once every dot has a place.
  function remember(xy) {
    if (layoutKind === 'radial') return
    if (!(xy instanceof Float32Array) || xy.length !== 2 * input.nodes.length) return
    for (let i = 0; i < input.nodes.length; i++) {
      const id = input.nodes[i].id
      const p = places.get(id)
      if (p) { p.x = xy[2 * i]; p.y = xy[2 * i + 1] } else places.set(id, { x: xy[2 * i], y: xy[2 * i + 1] })
    }
  }
  // Where a dot is now: placed by hand, else the radial layout's place on screen, else the world's memory.
  const whereIs = (id) => handPlaced.get(id) || (layoutKind === 'radial' ? renderer.worldOf(id) : places.get(id)) || renderer.worldOf(id)

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
    endGlide()
    settleHold.clear()
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
    inputIndex = new Map(input.nodes.map((n, i) => [n.id, i]))
    const known = {}
    for (const n of input.nodes) {
      const p = layoutKind === 'radial' ? handPlaced.get(n.id) : places.get(n.id)
      if (p) known[n.id] = { x: p.x, y: p.y, ...(pinned.has(n.id) ? { pinned: true } : {}) }
    }
    renderer.setScene(graph)
    if (Object.keys(known).length) renderer.setPositions(known)
    if (input.nodes.length) client.run({ layout: layoutKind, nodes: input.nodes, links: input.links, positions: known })
    else client.stop()
  }

  /** Lay the view out afresh: everything but what was pinned by hand may move. */
  function relayout() {
    endGlide()
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
    const hit = renderer.hitTest(s.x, s.y, LINK_REACH_PX, press.skip ?? press.id)
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
    // A drag that carried things never told the layout (MO5 round 1: a pin let the layout pull what the dot lives in
    // along), so the layout already agrees and only the picture goes back.
    const putBack = () => {
      if (layoutKind === 'force' && !p.carried.length) {
        client.pin(p.id, p.start.x, p.start.y)
        if (!p.wasPinned) client.unpin(p.id)
      }
      const batch = { [p.id]: p.start }
      for (const c of p.carried) {
        batch[c.id] = c.start
        if (layoutKind === 'force') places.set(c.id, c.start)
      }
      renderer.setPositions(batch)
      if (layoutKind === 'force') places.set(p.id, p.start)
      if (!p.wasPinned) pinned.delete(p.id)
    }
    if (cancelled) { putBack(); return } // Escape: and nothing else said
    if (p.target && p.target.allowed) {
      // The data change is the page's; until it lands the dot goes back.
      putBack()
      listeners.drop?.({ dragId: p.id, targetId: p.target.id, mode: p.target.mode })
      return
    }
    const at = p.at || places.get(p.id) || p.start
    p.at = { x: at.x, y: at.y }
    // Flung, it glides a little first (MO5, her item 5); its place is kept when it stops.
    const v = glideOn && !calm ? flung(p) : null
    if (v) { startGlide(p, v); return }
    keepWhereLetGo(p)
  }

  // Its speed over the last moments of the drag, in world units a millisecond, or null when it was placed, not flung.
  function flung(p) {
    const trail = p.trail
    if (!trail || trail.length < 2) return null
    const last = trail[trail.length - 1]
    if (clock() - last.t > GLIDE.stillMs) return null
    const first = trail.find((s) => last.t - s.t <= GLIDE.sampleMs)
    const dt = first ? last.t - first.t : 0
    if (!(dt > 0)) return null
    let vx = (last.x - first.x) / dt
    let vy = (last.y - first.y) / dt
    const k = renderer.camera().k || 1
    const speed = Math.hypot(vx, vy) * k
    if (!(speed >= GLIDE.minSpeed)) return null
    const cap = GLIDE.maxTravelPx / GLIDE.tauMs
    if (speed > cap) { vx *= cap / speed; vy *= cap / speed }
    return { vx, vy, k }
  }

  function startGlide(p, v) {
    for (const c of p.carried) { const q = c.at || c.start; c.base = { x: q.x, y: q.y } }
    glide = { p, base: { x: p.at.x, y: p.at.y }, vx: v.vx, vy: v.vy, k: v.k, t0: clock(), frame: null }
    glide.frame = askFrame(stepGlide)
  }
  // Where it is a time e after it was let go: base + v * tau * (1 - exp(-e / tau)), so it slows the same whatever
  // the frame rate, and stops on its own.
  function stepGlide() {
    const g = glide
    if (!g) return
    g.frame = null
    const e = Math.max(0, clock() - g.t0)
    const decay = Math.exp(-e / GLIDE.tauMs)
    const reach = GLIDE.tauMs * (1 - decay)
    const ox = g.vx * reach
    const oy = g.vy * reach
    const p = g.p
    p.at = { x: g.base.x + ox, y: g.base.y + oy }
    const batch = { [p.id]: p.at }
    for (const c of p.carried) {
      c.at = { x: c.base.x + ox, y: c.base.y + oy }
      batch[c.id] = c.at
      if (layoutKind === 'force') places.set(c.id, { x: c.at.x, y: c.at.y })
    }
    if (layoutKind === 'force') {
      places.set(p.id, { x: p.at.x, y: p.at.y })
      if (!p.carried.length) client.pin(p.id, p.at.x, p.at.y)
    }
    renderer.setPositions(batch)
    if (e >= GLIDE.maxMs || Math.hypot(g.vx, g.vy) * decay * g.k < GLIDE.stopSpeed) {
      glide = null
      keepWhereLetGo(p)
      return
    }
    g.frame = askFrame(stepGlide)
  }
  /** Stop a glide where it is; its place is kept (unless `quiet`, when the world is going). */
  function endGlide({ quiet = false } = {}) {
    const g = glide
    if (!g) return
    glide = null
    if (g.frame != null) dropFrame(g.frame)
    if (!quiet) keepWhereLetGo(g.p)
  }

  // A dot let go in empty space (after its glide, if it had one) is kept where it is, pinned by hand.
  function keepWhereLetGo(p) {
    const at = p.at
    pinned.add(p.id)
    handPlaced.set(p.id, { x: at.x, y: at.y })
    // What it carried stays where it was let go. A radial layout computes every place, so there each is kept by hand
    // like the dot itself; in a free layout each keeps its own pin (or none), and the layout starts again from the
    // places on show, so nothing moves on the drop: at once when it is at rest, or, while it is still running (still
    // forming after a folder opened, say), when it settles, the dropped dots held where they are until then.
    const carried = []
    for (const c of p.carried) {
      const q = c.at || c.start
      const xy = { x: q.x, y: q.y }
      if (layoutKind === 'radial') { pinned.add(c.id); handPlaced.set(c.id, xy) } else {
        places.set(c.id, { x: q.x, y: q.y })
        if (handPlaced.has(c.id)) handPlaced.set(c.id, xy)
      }
      carried.push({ id: c.id, x: q.x, y: q.y, pinned: pinned.has(c.id) })
    }
    if (carried.length && layoutKind === 'force' && input.nodes.length) {
      settleHold.set(p.id, { x: at.x, y: at.y })
      for (const c of carried) settleHold.set(c.id, { x: c.x, y: c.y })
      if (!client.busy()) restartFromShown()
    }
    listeners.arranged?.({ id: p.id, x: at.x, y: at.y, ...(carried.length ? { carried } : {}) })
  }

  const onPointerDown = (e) => {
    stopBloom()
    endGlide() // a press anywhere stops a glide where it is
    // A second finger or pointer while a dot is dragged changes nothing; one while a dot is only pressed ends that
    // press. Either way it is no click on empty space (MO2 review round 1).
    down.add(e.pointerId)
    if (emptyPress && e.pointerId !== emptyPress.pointerId) emptyPress.moved = true
    if (press && e.pointerId !== press.pointerId) {
      if (press.dragging) return
      press = null
      return
    }
    // A second finger during a pan or a pinch is the gesture's, never a press on a dot (MO2 review round 2).
    if (down.size > 1) return
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return
    const s = local(e)
    const hit = renderer.hitTest(s.x, s.y, e.pointerType === 'mouse' ? 4 : 10)
    if (!hit || hit.type !== 'dot') {
      press = null
      // A press off any dot clears the selection only if it is a click: a pan keeps it.
      emptyPress = hit ? null : { pointerId: e.pointerId, x: s.x, y: s.y, moved: false, additive: !!(e.shiftKey || e.ctrlKey || e.metaKey) }
      return
    }
    const w = whereIs(hit.id) || { x: 0, y: 0 }
    press = {
      id: hit.id, pointerId: e.pointerId, sx: s.x, sy: s.y, start: { x: w.x, y: w.y },
      dragging: false, target: null, additive: !!(e.shiftKey || e.ctrlKey || e.metaKey), wasPinned: pinned.has(hit.id),
      allowed: rules.canDrag(byId.get(hit.id)) !== false, carried: [], skip: null, trail: [],
    }
    canvas.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    const s = local(e)
    if (emptyPress && e.pointerId === emptyPress.pointerId && Math.hypot(s.x - emptyPress.x, s.y - emptyPress.y) >= DRAG_SLOP_PX) emptyPress.moved = true
    if (press && e.pointerId === press.pointerId) {
      if (!press.dragging) {
        if (Math.hypot(s.x - press.sx, s.y - press.sy) < DRAG_SLOP_PX || !press.allowed) return
        press.dragging = true
        stopBloom()
        // What the drag carries is read once, as it starts, from where each dot is then (one not yet placed stays).
        if (carry) {
          for (const cid of carriedBy(graph, press.id)) {
            const q = whereIs(cid)
            if (q && q.placed !== false && Number.isFinite(q.x) && Number.isFinite(q.y)) press.carried.push({ id: cid, start: { x: q.x, y: q.y }, at: null })
          }
          if (press.carried.length) press.skip = new Set([press.id, ...press.carried.map((c) => c.id)])
        }
      }
      const w = screenToWorld(renderer.camera(), renderer.viewport(), s.x, s.y)
      press.at = w
      press.trail.push({ t: clock(), x: w.x, y: w.y })
      if (press.trail.length > 12) press.trail.shift()
      if (layoutKind === 'force') places.set(press.id, { x: w.x, y: w.y })
      // A drag that carries things moves only the picture until it lets go (MO5 round 1): a pin would let the layout
      // pull what the dot lives in, and its neighbours, along with it.
      if (layoutKind === 'force' && !press.carried.length) client.pin(press.id, w.x, w.y)
      const batch = { [press.id]: w }
      const dx = w.x - press.start.x
      const dy = w.y - press.start.y
      for (const c of press.carried) {
        c.at = { x: c.start.x + dx, y: c.start.y + dy }
        batch[c.id] = c.at
        if (layoutKind === 'force') places.set(c.id, { x: c.at.x, y: c.at.y })
      }
      renderer.setPositions(batch)
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
    down.delete(e.pointerId)
    if (emptyPress && e.pointerId === emptyPress.pointerId) {
      const ep = emptyPress
      emptyPress = null
      if (!ep.moved) listeners.pick?.(null, { additive: ep.additive })
      return
    }
    if (!press || e.pointerId !== press.pointerId) return
    if (!press.dragging) {
      const p = press
      press = null
      listeners.pick?.(p.id, { additive: p.additive })
      return
    }
    endDrag(false)
  }
  // A cancelled pointer ends only its own press (a stray touch does not end a mouse drag).
  const onPointerCancel = (e) => {
    down.delete(e?.pointerId)
    if (emptyPress && e?.pointerId === emptyPress.pointerId) emptyPress = null
    if (press && (e?.pointerId == null || e.pointerId === press.pointerId)) endDrag(true)
  }
  const onPointerLeave = () => { renderer.setHover(null); listeners.hover?.(null); stopBloom() }
  const onDoubleClick = (e) => {
    const s = local(e)
    const hit = renderer.hitTest(s.x, s.y, 4)
    if (hit && hit.type === 'dot' && CONTAINERS.has(byId.get(hit.id)?.kind)) listeners.open?.(hit.id)
  }
  const onKeyDown = (e) => { if (e.key === 'Escape' && press?.dragging) { e.preventDefault(); e.stopPropagation(); endDrag(true) } }
  // MO5 (her item 8): a right-click (or a long press's context menu) on a dot asks the page for that dot's menu, at the
  // pointer, in the window's own coordinates. Off any dot, and during a drag, nothing is asked and nothing is stopped.
  const onContextMenu = (e) => {
    if (press?.dragging) { e.preventDefault(); return }
    const s = local(e)
    const hit = renderer.hitTest(s.x, s.y, e.pointerType && e.pointerType !== 'mouse' ? 10 : 4)
    if (!hit || hit.type !== 'dot' || !listeners.menu) return
    e.preventDefault()
    stopBloom()
    // A long press that opened the menu is no click when it lifts (round 1: a board's dot opened its menu, then the
    // board over it).
    if (press && !press.dragging) press = null
    listeners.menu({ id: hit.id, x: e.clientX, y: e.clientY })
  }

  canvas.addEventListener?.('contextmenu', onContextMenu)
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
    setReducedMotion(v) { calm = !!v; if (calm) endGlide(); renderer.setReducedMotion(calm); paintGlow() },
    /** What a drag may do: canDrag(node), canMove(dragNode, targetNode), canLink(dragNode, targetNode) → { allowed, reason }. */
    setRules(next) { rules = { ...rules, ...next } },
    /** MO5: whether a drag carries what is joined to the dot (carriedBy). A drag already under way keeps what it had. */
    setCarry(on) { carry = !!on },
    /** MO5: whether a flung dot glides a little before its place is kept (never while motion is reduced). */
    setGlide(on) { glideOn = !!on },
    /** Hidden, the world asks no frame and the light's animations stop; shown, it draws once. */
    setActive(v) {
      active = !!v
      glow?.setActive(active)
      renderer.setPaused(!active)
      if (!active) { stopBloom(); endDrag(true); endGlide(); emptyPress = null; down.clear() }
    },
    resize(width, height, dpr = 1) {
      viewport = { width, height, dpr }
      renderer.resize(width, height, dpr)
      paintGlow()
    },
    setSelection(ids) { renderer.setSelection(ids) },
    /** Fly to a dot, at least close enough that it is drawn on its own. */
    flyTo(id) {
      if (!byId.has(id)) return false
      const p = whereIs(id)
      if (!p) return false
      const k = Math.max(renderer.camera().k, PICK_ZOOM)
      return renderer.flyTo({ x: p.x, y: p.y, k })
    },
    on(event, fn) { if (event in listeners) listeners[event] = fn },
    isActive: () => active,
    destroy() {
      endDrag(true)
      endGlide({ quiet: true })
      stopBloom()
      unbind()
      canvas.removeEventListener?.('contextmenu', onContextMenu)
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
