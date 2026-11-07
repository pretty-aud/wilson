/** @vitest-environment jsdom */
// mothWorld.test.js — MO2: the world controller over the engine, on a recording fake canvas, a manual frame queue
// and a layout worker that never answers (so every dot stays where the test put it). A click picks; a press off any
// dot clears; a drag into empty space only moves the picture and keeps the place; a drop onto a container that can
// take it goes back until the page's change lands; Escape puts it back and says nothing; half a second at rest asks
// for a preview and a press ends it; a double click opens a container; hidden, the world stops.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMothWorld, DRAG_SLOP_PX, BLOOM_REST_MS, PICK_ZOOM } from './mothWorld.js'
import { buildGraph } from '../engine/model.js'

const METHODS = ['setTransform', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'arc', 'stroke', 'fill', 'fillText', 'strokeText', 'drawImage', 'fillRect', 'save', 'restore', 'closePath', 'rect', 'clip', 'setLineDash']
function fakeCtx() {
  const ctx = { measureText: (s) => ({ width: String(s).length * 6 }) }
  for (const m of METHODS) ctx[m] = () => {}
  ctx.createRadialGradient = () => ({ addColorStop() {} })
  ctx.createLinearGradient = () => ({ addColorStop() {} })
  return ctx
}
function fakeCanvas() {
  const handlers = {}
  let w = 0
  let h = 0
  const c = {
    style: {},
    getContext: () => fakeCtx(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    addEventListener: (t, fn) => { (handlers[t] ||= []).push(fn) },
    removeEventListener: (t, fn) => { handlers[t] = (handlers[t] || []).filter((f) => f !== fn) },
    setPointerCapture() {},
    releasePointerCapture() {},
    hasPointerCapture: () => false,
    fire(type, e = {}) { for (const fn of [...(handlers[type] || [])]) fn({ preventDefault() {}, stopPropagation() {}, pointerId: 1, pointerType: 'mouse', button: 0, ...e }) },
    count: () => Object.values(handlers).reduce((n, l) => n + l.length, 0),
  }
  Object.defineProperty(c, 'width', { get: () => w, set: (v) => { w = v } })
  Object.defineProperty(c, 'height', { get: () => h, set: (v) => { h = v } })
  return c
}

// One project, one folder, two files; places chosen so each dot is alone on screen at the starting zoom.
const CAT = {
  islands: [{ id: 'p1', title: 'Salt Hours' }],
  folders: { p1: [{ id: 'd1', parent_id: null, kind: 'custom', slug: 'shots', label: 'Shots' }] },
  files: { p1: [{ id: 'f1', project_id: 'p1', folder_id: 'd1', name: 'a.mov', tags: [] }, { id: 'f2', project_id: 'p1', folder_id: null, name: 'b.mov', tags: [] }] },
}
const GRAPH = buildGraph(CAT, { expanded: 'all', nodeKinds: ['project', 'folder', 'file'], edgeKinds: ['lives_in'] })
const SAVED = {
  'project:p1': { x: 0, y: 0 }, 'folder:d1': { x: 150, y: 0 }, 'file:f1': { x: -150, y: 0 }, 'file:f2': { x: 0, y: 150 },
}

let env
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeCtx())
  const frames = []
  const timers = new Map()
  let next = 1
  let t = 0
  const canvas = fakeCanvas()
  const world = createMothWorld({
    canvas,
    createWorker: () => ({ postMessage() {}, terminate() {}, onmessage: null, onerror: null }),
    requestFrame: (fn) => { frames.push(fn); return frames.length },
    cancelFrame: () => {},
    now: () => t,
    setTimer: (fn, ms) => { timers.set(next, { fn, due: t + ms }); return next++ },
    clearTimer: (hd) => timers.delete(hd),
    reducedMotion: true,
  })
  const flush = () => { for (let k = 0; k < 20 && frames.length; k++) { t += 16; frames.splice(0).forEach((fn) => fn(t)) } }
  const advance = (ms) => { t += ms; for (const [hd, tm] of [...timers]) if (tm.due <= t) { timers.delete(hd); tm.fn() } }
  const events = { pick: [], open: [], bloom: [], drop: [], arranged: [], drag: [] }
  for (const k of Object.keys(events)) world.on(k, (...a) => events[k].push(a))
  world.resize(800, 600, 1)
  world.setGraph(GRAPH, { saved: SAVED })
  flush()
  const at = (id) => world.renderer.screenOf(id)
  env = { world, canvas, flush, advance, events, at, frames }
})
afterEach(() => { env.world.destroy(); vi.restoreAllMocks() })

const press = (id, extra = {}) => { const s = env.at(id); env.canvas.fire('pointerdown', { clientX: s.x, clientY: s.y, ...extra }); return s }

describe('createMothWorld', () => {
  it('draws the saved places it is given', () => {
    const p = env.world.positions()
    expect(p['folder:d1']).toEqual({ x: 150, y: 0, pinned: false })
    expect(Object.keys(p).sort()).toEqual(Object.keys(SAVED).sort())
    expect(env.at('folder:d1').x).toBeGreaterThan(env.at('project:p1').x)
  })

  it('a click picks the dot; a press off any dot clears, shift adds', () => {
    const s = press('file:f1')
    env.canvas.fire('pointerup', { clientX: s.x, clientY: s.y })
    expect(env.events.pick).toEqual([['file:f1', { additive: false }]])
    env.canvas.fire('pointerdown', { clientX: 5, clientY: 5, shiftKey: true })
    expect(env.events.pick).toHaveLength(1)
    env.canvas.fire('pointerup', { clientX: 5, clientY: 5 })
    expect(env.events.pick[1]).toEqual([null, { additive: true }])
  })

  it('a pan over empty space keeps the selection; only a click there clears it (MO2 round 1)', () => {
    env.canvas.fire('pointerdown', { clientX: 5, clientY: 5 })
    env.canvas.fire('pointermove', { clientX: 60, clientY: 40 })
    env.canvas.fire('pointerup', { clientX: 60, clientY: 40 })
    expect(env.events.pick).toEqual([])
  })
  it('a second finger during a drag changes nothing, and the drag ends as it would (MO2 round 1)', () => {
    const s = press('file:f2')
    env.canvas.fire('pointermove', { clientX: s.x + 40, clientY: s.y })
    env.canvas.fire('pointerdown', { clientX: 5, clientY: 5, pointerId: 2, pointerType: 'touch' })
    env.canvas.fire('pointerup', { clientX: 5, clientY: 5, pointerId: 2, pointerType: 'touch' })
    env.canvas.fire('pointermove', { clientX: s.x + 60, clientY: s.y })
    env.canvas.fire('pointerup', { clientX: s.x + 60, clientY: s.y })
    expect(env.events.arranged).toHaveLength(1)
    expect(env.events.pick).toEqual([])
    expect(env.events.drag.at(-1)).toEqual([null])
  })
  it('hidden, no frame is asked for whatever changes; shown again, it draws once (MO2 round 1)', () => {
    env.flush()
    env.world.setActive(false)
    const before = env.frames.length
    env.world.setGraph(GRAPH, { saved: SAVED })
    env.world.setAppearance({ glowColor: '#9fd3ff', glowSize: 10 })
    expect(env.frames.length).toBe(before)
    env.world.setActive(true)
    expect(env.frames.length).toBe(before + 1)
  })
  it('a second finger during a pan never presses a dot (MO2 round 2)', () => {
    env.canvas.fire('pointerdown', { clientX: 5, clientY: 5, pointerId: 1, pointerType: 'touch' })
    const s = env.at('file:f2')
    env.canvas.fire('pointerdown', { clientX: s.x, clientY: s.y, pointerId: 2, pointerType: 'touch' })
    env.canvas.fire('pointermove', { clientX: s.x + 60, clientY: s.y, pointerId: 2, pointerType: 'touch' })
    env.canvas.fire('pointerup', { clientX: s.x + 60, clientY: s.y, pointerId: 2, pointerType: 'touch' })
    expect(env.events.arranged).toEqual([])
    expect(env.events.drag).toEqual([])
  })
  it('a stray cancelled touch does not end a mouse drag (MO2 round 2)', () => {
    const s = press('file:f2')
    env.canvas.fire('pointermove', { clientX: s.x + 40, clientY: s.y })
    env.canvas.fire('pointercancel', { pointerId: 9, pointerType: 'touch' })
    env.canvas.fire('pointerup', { clientX: s.x + 40, clientY: s.y })
    expect(env.events.arranged).toHaveLength(1)
  })
  it('flies only to a dot this view draws (MO2 round 2)', () => {
    expect(env.world.flyTo('file:f1')).toBe(true)
    env.world.setGraph({ nodes: GRAPH.nodes.filter((n) => n.id !== 'file:f1'), edges: [] })
    expect(env.world.flyTo('file:f1')).toBe(false)
  })
  it('a drag into empty space moves only the picture and keeps the place, pinned', () => {
    const s = press('file:f2')
    env.canvas.fire('pointermove', { clientX: s.x + DRAG_SLOP_PX - 1, clientY: s.y })
    expect(env.events.drag).toEqual([])
    env.canvas.fire('pointermove', { clientX: s.x + 40, clientY: s.y + 60 })
    env.canvas.fire('pointerup', { clientX: s.x + 40, clientY: s.y + 60 })
    expect(env.events.pick).toEqual([])
    expect(env.events.drop).toEqual([])
    expect(env.events.arranged).toHaveLength(1)
    const p = env.world.positions()['file:f2']
    expect(p.pinned).toBe(true)
    expect(p.x).not.toBe(0)
  })

  it('a drop onto a folder that can take it asks the page and the dot goes back until the change lands', () => {
    env.world.setRules({ canMove: (from, to) => ({ allowed: from.kind === 'file' && to.kind === 'folder' }) })
    const s = press('file:f2')
    const target = env.at('folder:d1')
    env.canvas.fire('pointermove', { clientX: s.x + 20, clientY: s.y })
    env.canvas.fire('pointermove', { clientX: target.x, clientY: target.y })
    const last = env.events.drag.at(-1)[0]
    expect(last.target).toMatchObject({ id: 'folder:d1', mode: 'move', allowed: true })
    env.canvas.fire('pointerup', { clientX: target.x, clientY: target.y })
    expect(env.events.drop).toEqual([[{ dragId: 'file:f2', targetId: 'folder:d1', mode: 'move' }]])
    expect(env.world.positions()['file:f2']).toEqual({ x: 0, y: 150, pinned: false })
    expect(env.events.arranged).toEqual([])
  })

  it('a refused target is shown as refused and the drop only moves the picture', () => {
    env.world.setRules({ canMove: () => ({ allowed: false, reason: 'Not here.' }) })
    const s = press('file:f2')
    const target = env.at('folder:d1')
    env.canvas.fire('pointermove', { clientX: s.x + 20, clientY: s.y })
    env.canvas.fire('pointermove', { clientX: target.x, clientY: target.y })
    expect(env.events.drag.at(-1)[0].target).toMatchObject({ allowed: false, reason: 'Not here.' })
    env.canvas.fire('pointerup', { clientX: target.x, clientY: target.y })
    expect(env.events.drop).toEqual([])
    expect(env.events.arranged).toHaveLength(1)
  })

  it('Escape puts the dot back and says nothing', () => {
    const s = press('file:f2')
    env.canvas.fire('pointermove', { clientX: s.x + 50, clientY: s.y })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(env.world.positions()['file:f2']).toEqual({ x: 0, y: 150, pinned: false })
    env.canvas.fire('pointerup', { clientX: s.x + 50, clientY: s.y })
    expect(env.events.arranged).toEqual([])
    expect(env.events.drop).toEqual([])
    expect(env.events.pick).toEqual([])
  })

  it('a dot the rules will not drag stays put and a release picks it', () => {
    env.world.setRules({ canDrag: () => false })
    const s = press('file:f2')
    env.canvas.fire('pointermove', { clientX: s.x + 60, clientY: s.y })
    env.canvas.fire('pointerup', { clientX: s.x + 60, clientY: s.y })
    expect(env.events.arranged).toEqual([])
    expect(env.events.pick).toEqual([['file:f2', { additive: false }]])
  })

  it('half a second at rest asks for a preview; a press ends it at once', () => {
    const s = env.at('file:f1')
    env.canvas.fire('pointermove', { clientX: s.x, clientY: s.y })
    env.advance(BLOOM_REST_MS - 1)
    expect(env.events.bloom).toEqual([])
    env.advance(1)
    expect(env.events.bloom).toHaveLength(1)
    expect(env.events.bloom[0][0]).toMatchObject({ id: 'file:f1' })
    env.canvas.fire('pointerdown', { clientX: s.x, clientY: s.y })
    expect(env.events.bloom.at(-1)).toEqual([null])
  })

  it('touch never blooms', () => {
    const s = env.at('file:f1')
    env.canvas.fire('pointermove', { clientX: s.x, clientY: s.y, pointerType: 'touch' })
    env.advance(BLOOM_REST_MS * 2)
    expect(env.events.bloom).toEqual([])
  })

  it('a double click opens a container, not a file', () => {
    const d = env.at('folder:d1')
    env.canvas.fire('dblclick', { clientX: d.x, clientY: d.y })
    const f = env.at('file:f1')
    env.canvas.fire('dblclick', { clientX: f.x, clientY: f.y })
    expect(env.events.open).toEqual([['folder:d1']])
  })

  it('hidden, a drag in flight is put back and a preview ends', () => {
    const s = press('file:f2')
    env.canvas.fire('pointermove', { clientX: s.x + 50, clientY: s.y })
    env.world.setActive(false)
    expect(env.world.isActive()).toBe(false)
    expect(env.world.positions()['file:f2']).toEqual({ x: 0, y: 150, pinned: false })
    env.world.setActive(true)
    expect(env.world.isActive()).toBe(true)
  })

  it('flies to a known dot at least close enough to see it alone, and not to an unknown one', () => {
    expect(env.world.flyTo('nobody')).toBe(false)
    expect(env.world.flyTo('file:f1')).toBe(true)
    env.flush()
    expect(env.world.renderer.camera().k).toBeGreaterThanOrEqual(PICK_ZOOM)
  })

  it('laying out again frees every dot but those pinned by hand', () => {
    const s = press('file:f2')
    env.canvas.fire('pointermove', { clientX: s.x + 50, clientY: s.y })
    env.canvas.fire('pointerup', { clientX: s.x + 50, clientY: s.y })
    env.world.relayout()
    const p = env.world.positions()
    expect(p['file:f2'].pinned).toBe(true)
  })

  it('takes its appearance without throwing on junk', () => {
    expect(() => env.world.setAppearance({ glowColor: '#9fd3ff', glowSize: NaN, light: 'nonsense', colourOf: () => null })).not.toThrow()
    expect(env.world.governor).toBeTruthy()
  })

  it('lets go of every listener when destroyed', () => {
    const { world, canvas } = env
    expect(canvas.count()).toBeGreaterThan(0)
    world.destroy()
    expect(canvas.count()).toBe(0)
    env.world = { destroy() {} }
  })
})
