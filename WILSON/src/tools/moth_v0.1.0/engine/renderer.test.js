// =============================================================================
// renderer.test.js — the Canvas2D renderer (MO2a, the brief's item 3;
// renderer.js). Pins, on fixture graphs (generateCatalogue -> buildGraph)
// drawn into a recording fake canvas with a manual frame queue and an
// injected clock: no frame once settled; a fly-to and a tween request frames
// until their duration and then stop; junk durations and zooms (NaN,
// Infinity, '300') never leave a frame pending or a non-finite camera;
// invalidate coalesces; hitTest reads the frame on screen; selection redraws
// within one frame; the governor is fed lateness, not only script work;
// light mode keeps label shadows and halos over a sun; clusters on the core
// get a halo at FAR; a same-size resize is silent and a new size draws at
// once; positionsSnapshot never saves a guess; reduced motion jumps; destroy
// cancels the pending frame; the default palette is the kit's. Each rule has
// a sibling CONTROL running the same check on a planted fault, which must fail.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { createRenderer, DEFAULT_PALETTE } from './renderer.js'
import { buildGraph, positionsToData } from './model.js'
import { generateCatalogue } from './fixtures.js'
import { glowParams } from './glow.js'
import { MAX_FLY_MS } from './camera.js'
import { createFrameGovernor } from './governor.js'
import { TYPE, FONT_SANS, SIGNAL } from '../../../ui/tokens.js'

const CAT = generateCatalogue({ seed: 3, projects: 1, foldersPerProject: 4, filesPerProject: 16 })
const PID = CAT.islands[0].id
const G1 = buildGraph(CAT, { expanded: 'all' })
const SUN = glowParams({ size: 5000 })
const TARGET = { x: 300, y: -100, k: 2 }
const near = (a, b) => Math.abs(a - b) < 1e-6
const finiteCam = (c) => [c.x, c.y, c.k].every(Number.isFinite)
const camAt = (c, t) => c.x === t.x && c.y === t.y && c.k === t.k

/** World places on a 10-wide grid around the origin, 30 apart (integers, so snapshots are exact). */
const grid = (g, dx = 0) => Object.fromEntries(g.nodes.map((n, i) => [n.id, { x: -135 + (i % 10) * 30 + dx, y: -30 + Math.floor(i / 10) * 30 }]))
/** All dots in one world cell near the origin (or `dx` away): one cluster at FAR. */
const huddle = (g, dx = 0) => Object.fromEntries(g.nodes.map((n, i) => [n.id, { x: 10 + (i % 6) * 8 + dx, y: 10 + Math.floor(i / 6) * 8 }]))
const sameSnap = (snap, places) => Object.entries(places).every(([id, p]) => snap[id] && snap[id].x === p.x && snap[id].y === p.y)

const METHODS = ['setTransform', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'arc', 'stroke', 'fill', 'fillText', 'strokeText', 'drawImage', 'fillRect']
/** A 2D context that records every call with the styles in force at the time. */
function fakeCtx() {
  const ctx = { calls: [] }
  const rec = (m, a) => ctx.calls.push({ m, a, fillStyle: ctx.fillStyle, strokeStyle: ctx.strokeStyle, font: ctx.font })
  for (const m of METHODS) ctx[m] = (...a) => rec(m, a)
  ctx.createRadialGradient = (...a) => { rec('createRadialGradient', a); return { addColorStop() {} } }
  return ctx
}
/** A canvas whose width/height setters count (assigning either clears a real canvas). */
function fakeCanvas(ctx = fakeCtx()) {
  let w = 0
  let h = 0
  const c = { sets: 0, ctx, getContext: () => ctx }
  Object.defineProperty(c, 'width', { get: () => w, set: (v) => { w = v; c.sets++ } })
  Object.defineProperty(c, 'height', { get: () => h, set: (v) => { h = v; c.sets++ } })
  return c
}
/** A manual animation-frame queue on an injected clock. */
function frameQueue(clock) {
  const q = new Map()
  let next = 1
  return {
    total: 0,
    requestFrame(fn) { this.total++; q.set(next, fn); return next++ },
    cancelFrame: (h) => q.delete(h),
    size: () => q.size,
    pump(step = 16) { clock.t += step; const batch = [...q.values()]; q.clear(); for (const fn of batch) fn(clock.t) },
  }
}
/** Pump until no frame is pending: the number of pumps, or Infinity if still pending after `max`. */
function pumpUntilIdle(q, max = 300) {
  let n = 0
  while (q.size() && n < max) { q.pump(); n++ }
  return q.size() ? Infinity : n
}

function harness(opts = {}, clock = { t: 1000 }) {
  const canvas = fakeCanvas()
  const q = frameQueue(clock)
  let info = null
  const r = createRenderer({
    canvas, requestFrame: (fn) => q.requestFrame(fn), cancelFrame: q.cancelFrame, now: () => clock.t,
    createCanvas: (w, h) => ({ width: w, height: h, getContext: () => fakeCtx() }), onFrame: (f) => { info = f }, ...opts,
  })
  return { r, q, clock, canvas, calls: canvas.ctx.calls, info: () => info }
}
/** setScene + setPositions + resize + the light, drained to rest. */
function settled(opts, places = grid(G1), clock) {
  const h = harness(opts, clock)
  h.r.setScene(G1)
  h.r.setPositions(places)
  h.r.resize(800, 600)
  h.r.setGlow(SUN)
  pumpUntilIdle(h.q)
  return h
}

describe('renderer: no frame once settled', () => {
  /** Idle within `max` pumps, then 60 more ticks of the clock request and draw nothing. */
  const staysSettled = (q, calls, max = 10) => {
    if (pumpUntilIdle(q, max) > max) return false
    const before = [q.total, calls.length]
    for (let i = 0; i < 60; i++) q.pump()
    return q.size() === 0 && q.total === before[0] && calls.length === before[1]
  }

  it('after setScene, setPositions and resize it drains and stays empty: no requests, no calls', () => {
    const h = harness()
    h.r.setScene(G1)
    h.r.setPositions(grid(G1))
    h.r.resize(800, 600)
    h.r.setGlow(SUN)
    expect(staysSettled(h.q, h.calls)).toBe(true)
    expect(h.r.stats()).toMatchObject({ requests: h.q.total, animating: false })
    expect(h.r.frameRequested()).toBe(false)
  })

  it('CONTROL: an unbounded stand-in (a classic render loop) never settles', () => {
    const q = frameQueue({ t: 0 })
    const calls = []
    const loop = () => { calls.push({ m: 'clearRect' }); q.requestFrame(loop) }
    q.requestFrame(loop)
    expect(staysSettled(q, calls)).toBe(false)
  })

  /** Frames keep coming until `ms` has elapsed, then stop within one frame. */
  const runsFor = (q, clock, ms) => {
    const t0 = clock.t
    if (pumpUntilIdle(q, 500) === Infinity) return false
    const el = clock.t - t0
    return el >= ms && el < ms + 16
  }

  it('a fly-to requests frames until its duration then stops; a tween stops at its end', () => {
    const h = settled()
    h.r.flyTo(TARGET, { ms: 650 })
    expect(runsFor(h.q, h.clock, 650)).toBe(true)
    expect(camAt(h.r.camera(), TARGET)).toBe(true)
    const moved = grid(G1, 40)
    h.r.setPositions(moved, { tweenMs: 300 })
    expect(runsFor(h.q, h.clock, 300)).toBe(true)
    expect(sameSnap(h.r.positionsSnapshot(), moved)).toBe(true)
    expect(h.r.stats().animating).toBe(false)
  })

  it('CONTROL: a one-frame stand-in stops too early and an unbounded one never stops', () => {
    const clock = { t: 0 }
    const q = frameQueue(clock)
    q.requestFrame(() => {})
    expect(runsFor(q, clock, 650)).toBe(false)
    const loop = () => q.requestFrame(loop)
    q.requestFrame(loop)
    expect(runsFor(q, clock, 650)).toBe(false)
  })

  /** Nothing pending after `max` pumps and the camera finite. A junk duration is a jump (one frame);
   *  any fly ends within MAX_FLY_MS (2 s, 125 frames of 16 ms). */
  const LONGEST = Math.ceil(MAX_FLY_MS / 16) + 1
  const bounded = (q, cam, max) => pumpUntilIdle(q, max) <= max && finiteCam(cam())

  it('NaN, Infinity and "300" durations and NaN zooms leave no frame pending and a finite camera', () => {
    const h = settled()
    const cam = () => h.r.camera()
    for (const ms of [NaN, Infinity, -Infinity, '300', null]) { // undefined is the 650 ms default, not junk
      h.r.flyTo(TARGET, { ms })
      expect(bounded(h.q, cam, 1)).toBe(true)
      h.r.setPositions(grid(G1, 10), { tweenMs: ms })
      expect(bounded(h.q, cam, 1)).toBe(true)
    }
    h.r.flyTo({ x: 5, y: 5, k: NaN }, { ms: 1e9 })
    expect(bounded(h.q, cam, LONGEST)).toBe(true)
    h.r.flyTo({ id: G1.nodes[3].id, k: NaN }, { ms: NaN })
    expect(bounded(h.q, cam, 1)).toBe(true)
    h.r.setCamera({ x: NaN, y: 1, k: NaN })
    expect(bounded(h.q, cam, 1)).toBe(true)
    h.r.zoomAt(NaN, 400, 300)
    h.r.zoomAt(Infinity, NaN, 300)
    expect(bounded(h.q, cam, 1)).toBe(true)
  })

  it('CONTROL: a naive fly-to that trusts its duration and zoom loops for ever on NaN', () => {
    const clock = { t: 0 }
    const q = frameQueue(clock)
    let c = { x: 0, y: 0, k: 1 }
    const fly = (to, ms) => {
      const from = c
      const start = clock.t
      const frame = () => {
        const u = (clock.t - start) / ms
        c = { x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u, k: from.k + (to.k - from.k) * u }
        if (!(u >= 1)) q.requestFrame(frame)
      }
      q.requestFrame(frame)
    }
    fly(TARGET, NaN)
    expect(bounded(q, () => c, LONGEST)).toBe(false)
  })

  /** Fifty asks between frames make one request. */
  const coalesces = (q, ask) => {
    const before = q.total
    for (let i = 0; i < 50; i++) ask(i)
    return q.total - before === 1 && q.size() === 1
  }

  it('invalidate coalesces: many calls, one request, one frame', () => {
    const h = settled()
    const frames = h.r.stats().frames
    expect(coalesces(h.q, (i) => (i % 2 ? h.r.invalidate() : h.r.panBy(1, 0)))).toBe(true)
    h.q.pump()
    expect([h.r.stats().frames - frames, h.q.size()]).toEqual([1, 0])
  })

  it('CONTROL: an invalidate that requests every time does not coalesce', () => {
    const q = frameQueue({ t: 0 })
    expect(coalesces(q, () => q.requestFrame(() => {}))).toBe(false)
  })
})

describe('renderer: feedback reads the frame on screen', () => {
  // A new file filed at the project root, id 'file:0': it sorts first and shifts every index by one.
  const cat2 = structuredClone(CAT)
  cat2.files[PID].push({ id: '0', project_id: PID, folder_id: null, name: 'new-first', tags: [] })
  const G2 = buildGraph(cat2, { expanded: 'all' })
  const D = G1.nodes.findIndex((n) => n.kind === 'file')
  const P = grid(G1)[G1.nodes[D].id]
  const [SX, SY] = [P.x + 400, P.y + 300]
  const hits = (hitTest, id) => hitTest(SX, SY)?.id === id

  it('after setScene with an id that sorts first, before the next frame, hitTest returns the id drawn there', () => {
    expect(G2.nodes[0].id).toBe('file:0')
    const h = settled()
    expect(hits(h.r.hitTest, G1.nodes[D].id)).toBe(true)
    h.r.setScene(G2)
    expect(h.r.frameRequested()).toBe(true)
    expect(hits(h.r.hitTest, G1.nodes[D].id)).toBe(true)
    h.q.pump()
    expect(hits(h.r.hitTest, G1.nodes[D].id)).toBe(true)
  })

  it("CONTROL: reading the frame's index through the NEW scene's ids returns the wrong dot", () => {
    const h = settled()
    h.r.setScene(G2)
    const broken = (sx, sy) => ({ id: G2.nodes[G1.nodes.findIndex((n) => n.id === h.r.hitTest(sx, sy).id)].id })
    expect(hits(broken, G1.nodes[D].id)).toBe(false)
  })

  /** One frame after `select(id)` a SIGNAL ring is stroked round the dot, and nothing is left pending. */
  const ringAt = (calls) => calls.some((c, i) => c.m === 'arc' && near(c.a[0], SX) && near(c.a[1], SY) && calls[i + 1]?.m === 'stroke' && calls[i + 1].strokeStyle === SIGNAL)
  const selectsInOneFrame = (h, select) => {
    const mark = h.calls.length
    select(G1.nodes[D].id)
    if (h.q.size() !== 1) return false
    h.q.pump()
    return h.q.size() === 0 && ringAt(h.calls.slice(mark))
  }

  it('selection redraws within one frame, ringed in the kit SIGNAL', () => {
    const h = settled()
    expect(selectsInOneFrame(h, h.r.setSelection)).toBe(true)
  })

  it('CONTROL: a setSelection that never asks for a frame fails the same check', () => {
    const h = settled()
    expect(selectsInOneFrame(h, () => {})).toBe(false)
  })
})

describe('renderer: the governor and the light', () => {
  /** 150 frames of a continuous drag whose callbacks come 66 ms after the request. */
  const dragLate = (gov) => {
    const clock = { t: 1000 }
    const h = settled({ governor: gov(clock) }, grid(G1), clock)
    for (let i = 0; i < 150; i++) { h.r.panBy(1, 0); h.q.pump(66) }
    return h.r
  }

  it('the governor is fed lateness: frames 66 ms late during a pan reach light', () => {
    let g
    dragLate((clock) => (g = createFrameGovernor({ now: () => clock.t })))
    expect(g.mode()).toBe('light')
  })

  it('CONTROL: a renderer that feeds the governor its script work only stays full', () => {
    let g
    dragLate((clock) => {
      g = createFrameGovernor({ now: () => clock.t })
      return { record: (sample, work) => g.record(work, work), mode: () => g.mode() }
    })
    expect(g.mode()).toBe('full')
  })

  const shadowsDrawn = (calls) => calls.some((c) => c.m === 'strokeText') && calls.some((c) => c.m === 'drawImage')

  it('light mode keeps the label shadows (strokeText) and the halos (drawImage) over a sun at the centre', () => {
    const h = settled({ governor: createFrameGovernor({ override: 'light' }) })
    h.r.setGlow(glowParams({ size: 5000, light: true }))
    const mark = h.calls.length
    h.q.pump()
    expect(h.info()).toMatchObject({ light: true, lod: 'near' })
    expect(shadowsDrawn(h.calls.slice(mark))).toBe(true)
  })

  it('CONTROL: a light-mode frame that drops the shadows (no glow handed in) fails the same check', () => {
    const h = settled({ governor: createFrameGovernor({ override: 'light' }) })
    h.r.setGlow(null)
    const mark = h.calls.length
    h.q.pump()
    expect(h.info().light).toBe(true)
    expect(shadowsDrawn(h.calls.slice(mark))).toBe(false)
  })

  /** Every cluster (its size written at its centre) has a halo drawn centred on it. */
  const clustersHaloed = (calls) => {
    const centres = calls.filter((c) => c.m === 'fillText' && /^\d+$/.test(c.a[0])).map((c) => [c.a[1], c.a[2]])
    const halos = calls.filter((c) => c.m === 'drawImage').map((c) => [c.a[1] + c.a[3] / 2, c.a[2] + c.a[4] / 2])
    return centres.length > 0 && centres.every(([x, y]) => halos.some(([hx, hy]) => near(hx, x) && near(hy, y)))
  }
  const farFrame = (dx) => {
    const h = settled({}, huddle(G1, dx))
    h.r.setCamera({ x: 0, y: 0, k: 0.2 })
    const mark = h.calls.length
    h.q.pump()
    expect(h.info()).toMatchObject({ lod: 'far', dots: 0, clusters: 1 })
    return h.calls.slice(mark)
  }

  it('a cluster on the bright core gets a halo at FAR', () => {
    expect(clustersHaloed(farFrame(0))).toBe(true)
  })

  it('CONTROL: the same cluster moved off the core (screen edge) gets none, so the check is not blind', () => {
    expect(clustersHaloed(farFrame(1800))).toBe(false)
  })
})

describe('renderer: resize', () => {
  /** A resize that sets no canvas size, clears nothing and requests nothing. */
  const quiet = (h, resize) => {
    const [sets, mark, req] = [h.canvas.sets, h.calls.length, h.q.total]
    resize(800, 600)
    return h.canvas.sets === sets && !h.calls.slice(mark).some((c) => c.m === 'clearRect') && h.q.total === req
  }
  /** A resize to a new size draws dots and labels before any frame, leaving none pending. */
  const drawsAtOnce = (h, resize) => {
    const mark = h.calls.length
    resize(1000, 700)
    const fresh = h.calls.slice(mark)
    return fresh.some((c) => c.m === 'arc') && fresh.some((c) => c.m === 'fillText') && h.q.size() === 0
  }
  const naiveResize = (h) => (w, ht) => { h.canvas.width = w; h.canvas.height = ht; h.r.invalidate() }

  it('to the same size after a frame clears nothing and requests nothing', () => {
    const h = settled()
    expect(quiet(h, h.r.resize)).toBe(true)
    expect(h.r.resize(800, 600)).toBe(false)
  })

  it('CONTROL: a resize that always reassigns the canvas size is not quiet', () => {
    const h = settled()
    expect(quiet(h, naiveResize(h))).toBe(false)
  })

  it('to a new size draws synchronously (before any queue pump)', () => {
    const h = settled()
    h.r.invalidate() // a pending frame is cancelled, not left to draw twice
    expect(drawsAtOnce(h, h.r.resize)).toBe(true)
    expect(h.r.viewport()).toEqual({ width: 1000, height: 700 })
  })

  it('CONTROL: a resize that only invalidates draws nothing until the next frame', () => {
    const h = settled()
    expect(drawsAtOnce(h, naiveResize(h))).toBe(false)
  })
})

describe('renderer: positions, motion, teardown and palette', () => {
  // A new project, folder and file: none of them nor any ancestor ever placed.
  const cat3 = structuredClone(CAT)
  cat3.islands.push({ id: 'zz-new', title: 'New' })
  cat3.folders['zz-new'] = [{ id: 'zz-root', parent_id: null, kind: 'root', path: '' }, { id: 'zz-f', parent_id: 'zz-root', kind: 'category', label: 'F' }]
  cat3.files['zz-new'] = [{ id: 'zz-file', project_id: 'zz-new', folder_id: 'zz-f', name: 'n', tags: [] }]
  const G3 = buildGraph(cat3, { expanded: 'all' })
  const NEW = ['project:zz-new', 'folder:zz-f', 'file:zz-file']
  const honest = (snap) => sameSnap(snap, grid(G1)) && NEW.every((id) => !(id in snap))

  it('positionsSnapshot leaves out dots never placed and includes dots placed via setPositions', () => {
    const h = harness()
    h.r.setScene(G1)
    expect(h.r.positionsSnapshot()).toEqual({})
    h.r.setPositions(grid(G1))
    h.r.setScene(G3)
    expect(NEW.every((id) => G3.nodes.some((n) => n.id === id))).toBe(true)
    expect(honest(h.r.positionsSnapshot())).toBe(true)
  })

  it('CONTROL: a snapshot of every dot as drawn (a never-placed one at the centre) saves a guess', () => {
    const h = harness()
    h.r.setScene(G1)
    h.r.setPositions(grid(G1))
    h.r.setScene(G3)
    const snap = h.r.positionsSnapshot()
    const ids = G3.nodes.map((n) => n.id)
    const xy = new Float32Array(2 * ids.length)
    ids.forEach((id, i) => { if (snap[id]) { xy[2 * i] = snap[id].x; xy[2 * i + 1] = snap[id].y } })
    expect(honest(positionsToData(ids, xy))).toBe(false)
  })

  /** The state is at its target before any frame, and one frame at most follows. */
  const jumps = (h, act, atTarget) => { act(); return atTarget() && pumpUntilIdle(h.q, 10) <= 1 }

  it('reduced motion makes flyTo and tweens jump; turning it on mid-fly lands at once', () => {
    const h = settled({ reducedMotion: true })
    expect(jumps(h, () => h.r.flyTo(TARGET, { ms: 650 }), () => camAt(h.r.camera(), TARGET))).toBe(true)
    const moved = grid(G1, 40)
    expect(jumps(h, () => h.r.setPositions(moved, { tweenMs: 500 }), () => sameSnap(h.r.positionsSnapshot(), moved))).toBe(true)
    const f = settled()
    f.r.flyTo(TARGET, { ms: 650 })
    f.q.pump(); f.q.pump()
    expect(jumps(f, () => f.r.setReducedMotion(true), () => camAt(f.r.camera(), TARGET))).toBe(true)
  })

  it('CONTROL: the same check on a renderer in full motion fails (it flies)', () => {
    const h = settled()
    expect(jumps(h, () => h.r.flyTo(TARGET, { ms: 650 }), () => camAt(h.r.camera(), TARGET))).toBe(false)
  })

  /** With a frame pending, destroy leaves the queue empty, and later asks request nothing. */
  const tearsDown = (h, destroy) => {
    h.r.invalidate()
    if (h.q.size() !== 1) return false
    destroy()
    if (h.q.size() !== 0) return false
    h.r.invalidate(); h.r.panBy(5, 5); h.r.setSelection(G1.nodes[0].id)
    return h.q.size() === 0
  }

  it('destroy cancels the pending frame and nothing asks for one afterwards', () => {
    const h = settled()
    const frames = h.r.stats().frames
    expect(tearsDown(h, h.r.destroy)).toBe(true)
    expect(pumpUntilIdle(h.q)).toBe(0)
    expect(h.r.stats().frames).toBe(frames)
  })

  it('CONTROL: a destroy that forgets cancelFrame leaves the frame queued', () => {
    const h = settled()
    expect(tearsDown(h, () => {})).toBe(false)
  })

  /** The kit's caption face and SIGNAL selection, and every drawn text in that face. */
  const kitPalette = (p, calls) => p.font === `${TYPE.caption}px ${FONT_SANS}` && p.selection === SIGNAL &&
    calls.some((c) => c.m === 'fillText') && calls.filter((c) => c.m === 'fillText').every((c) => c.font === p.font)

  it('DEFAULT_PALETTE uses the kit font (TYPE.caption px + FONT_SANS) and SIGNAL for the selection', () => {
    expect(kitPalette(DEFAULT_PALETTE, settled().calls)).toBe(true)
  })

  it('CONTROL: a hard-coded palette (12px sans-serif, pure red) fails the same check', () => {
    const hard = { ...DEFAULT_PALETTE, font: '12px sans-serif', selection: '#ff0000' }
    expect(kitPalette(hard, settled({ palette: hard }).calls)).toBe(false)
  })
})
