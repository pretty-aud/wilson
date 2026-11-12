// @vitest-environment jsdom
// BoardCanvas.test.jsx — MO4 boards: the canvas mounted with Konva's own build under jsdom. jsdom has no 2D
// context, so each canvas is handed a stand-in that answers every call and measures text by its length; Konva's
// nodes, events and Transformer are the real ones. The store, the room (live) and sticky turns are stand-ins that
// keep to the design's interfaces.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import Konva from 'konva'
import BoardCanvas, {
  READ_ONLY_WORDS, TURN_ENDED_WORDS, targetSizes, elementIdOf, writingWords, NO_FILES_WORDS, DROP_WORDS, addingWords, mediaBox,
  dragHasFiles,
} from './BoardCanvas.jsx'
import { MISSING_WORDS, shapePath } from './shapes.js'

const METHODS = ['arc', 'arcTo', 'beginPath', 'bezierCurveTo', 'clearRect', 'clip', 'closePath', 'drawImage', 'ellipse', 'fill',
  'fillRect', 'fillText', 'lineTo', 'moveTo', 'putImageData', 'quadraticCurveTo', 'rect', 'restore', 'rotate', 'save', 'scale',
  'setLineDash', 'setTransform', 'stroke', 'strokeRect', 'strokeText', 'transform', 'translate', 'resetTransform', 'roundRect']
function standInContext(canvas) {
  const ctx = { canvas, fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, font: '10px sans-serif', globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter', textBaseline: 'alphabetic', textAlign: 'left', filter: 'none' }
  for (const m of METHODS) ctx[m] = () => {}
  ctx.measureText = (t) => ({ width: String(t ?? '').length * 7, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2, fontBoundingBoxAscent: 9, fontBoundingBoxDescent: 3 })
  ctx.getImageData = (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, Math.floor(w) * Math.floor(h)) * 4) })
  ctx.createImageData = (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4) })
  ctx.getLineDash = () => []
  ctx.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
  ctx.createLinearGradient = () => ({ addColorStop() {} })
  ctx.createRadialGradient = () => ({ addColorStop() {} })
  ctx.createPattern = () => ({})
  ctx.isPointInPath = () => false
  ctx.isPointInStroke = () => false
  return ctx
}
let realGetContext
beforeAll(() => {
  realGetContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function getContext() {
    if (!this.__standIn) this.__standIn = standInContext(this)
    return this.__standIn
  }
})
afterAll(() => { HTMLCanvasElement.prototype.getContext = realGetContext })
afterEach(() => { cleanup(); vi.useRealTimers() })

// ---- stand-ins ----------------------------------------------------------------------------------------------------
function fakeStore(initial = [], { canWrite = true } = {}) {
  const els = new Map(initial.map((e) => [e.id, { version: 1, rotation: 0, z: 0, style: {}, body: null, points: null, ...e }]))
  const subs = new Set()
  let n = 0
  const notify = (evt) => { for (const fn of [...subs]) fn(evt) }
  const store = {
    getBoard: () => ({ id: 'b1', folder_id: 'f1', project_id: 'p1', title: 'Plans', can_write: canWrite }),
    getElements: () => els,
    subscribe: vi.fn((fn) => { subs.add(fn); return () => subs.delete(fn) }),
    add: vi.fn((el) => { n += 1; const id = `new-${n}`; els.set(id, { version: 0, rotation: 0, z: 0, style: {}, ...el, id }); notify(); return id }),
    update: vi.fn((id, patch) => { const el = els.get(id); if (el) { els.set(id, { ...el, ...patch, version: (el.version || 0) + 1 }); notify() } }),
    remove: vi.fn((ids) => { for (const id of ids) els.delete(id); notify() }),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: () => false,
    canRedo: () => false,
    applyRemote: vi.fn((msg) => { for (const e of msg.elements) els.set(e.id, e); notify() }),
    flush: vi.fn(async () => {}),
    dispose: vi.fn(),
    // test-only
    say: (words) => notify({ type: 'notice', words }),
    put: (el) => { els.set(el.id, el); notify() },
    rename: (from, to) => { const el = els.get(from); els.delete(from); els.set(to, { ...el, id: to }); notify({ type: 'renamed', from, to }) },
  }
  return store
}
function fakeLive() {
  const subs = new Set()
  let cursors = new Map()
  return {
    sendPointer: vi.fn(),
    sendDrag: vi.fn(),
    cursors: () => cursors,
    people: () => [{ id: 'u2', label: 'Mara Okonkwo', colour: '#AA3377' }],
    subscribe: vi.fn((fn) => { subs.add(fn); return () => subs.delete(fn) }),
    stats: () => ({ sent: 0, received: 0 }),
    leave: vi.fn(),
    setCursors(next) { cursors = next; for (const fn of subs) fn() },
  }
}
function fakeTurns({ granted = true, holderLabel = null, save = { ok: true }, events = false } = {}) {
  let glow = new Map()
  const subs = new Set()
  const turns = {
    begin: vi.fn(async () => ({ granted, holderLabel })),
    save: vi.fn(async () => save),
    end: vi.fn(),
    glow: () => glow,
    applyMessage: vi.fn(),
    refresh: vi.fn(async () => {}),
    dispose: vi.fn(),
    setGlow(next) { glow = next },
    tell(evt) { for (const fn of subs) fn(evt) },
  }
  if (events) turns.subscribe = vi.fn((fn) => { subs.add(fn); return () => subs.delete(fn) })
  return turns
}
function fakeEscape() {
  const stack = []
  return {
    stack,
    push: vi.fn((fn) => { stack.push(fn); return () => { const i = stack.indexOf(fn); if (i >= 0) stack.splice(i, 1) } }),
    press() { for (let i = stack.length - 1; i >= 0; i -= 1) if (stack[i]()) return true; return false },
  }
}

const RECT = { id: 'a', kind: 'shape', shape: 'rectangle', x: 0, y: 0, w: 100, h: 50, z: 1, body: 'Hello' }
const OTHER = { id: 'b', kind: 'shape', shape: 'circle', x: 300, y: 0, w: 80, h: 80, z: 2 }

const stageNow = () => Konva.stages[Konva.stages.length - 1]
const groupOf = (id) => stageNow().findOne((n) => n.attrs.elementId === id)
const named = (name) => stageNow().find((n) => n.name() === name)
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)) })

function pointerEvent(type, init = {}) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 0, ...init })
  Object.defineProperty(e, 'pointerId', { value: init.pointerId ?? 1 })
  Object.defineProperty(e, 'pointerType', { value: init.pointerType ?? 'mouse' })
  return e
}
// A press on a node (Konva's own event, bubbling to the stage), then moves and a release on the window.
function press(node, at, extra = {}) {
  act(() => { node.fire('pointerdown', { evt: { button: 0, pointerId: 1, pointerType: 'mouse', clientX: at.x, clientY: at.y, ...extra } }, true) })
}
function moveTo(at, extra = {}) { act(() => { window.dispatchEvent(pointerEvent('pointermove', { clientX: at.x, clientY: at.y, ...extra })) }) }
function release(at, extra = {}) { act(() => { window.dispatchEvent(pointerEvent('pointerup', { clientX: at.x, clientY: at.y, ...extra })) }) }

async function mount(props = {}) {
  const store = props.store ?? fakeStore([RECT, OTHER])
  const out = render(<BoardCanvas store={store} canWrite inputMode="mouse" {...props} />)
  await settle()
  return { ...out, store, stage: stageNow() }
}

const toScreen = (b) => { const s = stageNow(); return { x: s.x() + b.x * s.scaleX(), y: s.y() + b.y * s.scaleY() } }
const region = () => screen.getByRole('region', { name: 'Board' })
const host = () => document.querySelector('[data-moth-board-stage]')

const STICKY_FILE = { id: 'f9', name: 'note.md', mime_type: 'text/markdown', folder_id: 'f1', project_id: 'p1' }
const STICKY = { id: 's', kind: 'sticky', x: 0, y: 200, w: 200, h: 200, z: 4, file: STICKY_FILE, missing: false }
const stickyAdapter = (text = 'Buy milk') => ({ readStickyText: vi.fn(async () => text), fileUrl: vi.fn(async () => null) })

describe('BoardCanvas — drawing every kind', () => {
  it('draws each element as a group of its own, with the shape\'s own path and words', async () => {
    await mount()
    const a = groupOf('a')
    expect(a).toBeTruthy()
    expect(groupOf('b')).toBeTruthy()
    expect(a.findOne('Path').data()).toBe(shapePath('rectangle', 100, 50, {}))
    expect(a.findOne('Text').text()).toBe('Hello')
    // Drawn in z order, as the server pages.
    expect(stageNow().getLayers()[0].getChildren().map((g) => g.attrs.elementId)).toEqual(['a', 'b'])
  })

  it('frames with names, pen strokes, text, files, a missing file\'s stop sign', async () => {
    const adapter = { fileUrl: vi.fn(async () => null), readStickyText: vi.fn(async () => '') }
    const store = fakeStore([
      { id: 'fr', kind: 'frame', x: -400, y: -400, w: 300, h: 200, z: 0, body: 'Ideas' },
      { id: 'pen1', kind: 'pen', x: 0, y: 0, w: 10, h: 10, z: 1, points: [0, 0, 5, 8, 10, 10] },
      { id: 't', kind: 'text', x: 0, y: 100, w: 200, h: 30, z: 2, body: 'Plain words' },
      { id: 'pic', kind: 'media', x: 200, y: 0, w: 160, h: 120, z: 3, file: { id: 'f2', name: 'still.png', mime_type: 'image/png' }, missing: false },
      { id: 'doc', kind: 'embed', x: 400, y: 0, w: 160, h: 120, z: 4, file: { id: 'f3', name: 'script.pdf', mime_type: 'application/pdf' }, missing: false },
      { id: 'gone', kind: 'media', x: 600, y: 0, w: 160, h: 120, z: 5, file: null, missing: true },
    ])
    await mount({ store, adapter })
    await settle()
    expect(named('frame-title')[0].text()).toBe('Ideas')
    expect(groupOf('pen1').findOne('Line').points()).toEqual([0, 0, 5, 8, 10, 10])
    expect(groupOf('t').findOne('Text').text()).toBe('Plain words')
    // A picture asks for its file's address (no stream for a still); with none to be had it is a tile with its name.
    expect(adapter.fileUrl).toHaveBeenCalledWith(expect.objectContaining({ id: 'f2' }), { stream: false })
    expect(groupOf('pic').findOne('.file-words').text()).toBe('still.png\nPicture')
    expect(groupOf('doc').findOne('.file-words').text()).toBe('script.pdf\nFile')
    // The stop-sign tile: the words, and no name of anything.
    const gone = groupOf('gone')
    expect(gone.findOne('.missing-words').text()).toBe(MISSING_WORDS)
    expect(gone.find('Text').map((t) => t.text())).toEqual([MISSING_WORDS])
  })

  it('a sticky shows its markdown file\'s words as text', async () => {
    const adapter = stickyAdapter('# Shopping\nBuy milk')
    await mount({ store: fakeStore([STICKY]), adapter })
    await settle()
    expect(adapter.readStickyText).toHaveBeenCalledWith(STICKY_FILE)
    expect(groupOf('s').findOne('.sticky-words').text()).toBe('# Shopping\nBuy milk')
  })

  it('a connector\'s ends follow their elements by id and anchor', async () => {
    const store = fakeStore([RECT, OTHER, { id: 'c', kind: 'connector', x: 0, y: 0, w: 1, h: 1, z: 3, points: [0, 0, 1, 1], from_id: 'a', from_anchor: 'right', to_id: 'b', to_anchor: 'left', style: { end_head: 'none' } }])
    await mount({ store })
    const line = () => groupOf('c').findOne('.connector-line')
    expect(line().points()).toEqual([100, 25, 300, 40])
    act(() => store.update('a', { x: -50, y: 10 }))
    await settle()
    expect(line().points()).toEqual([50, 35, 300, 40])
    // The element goes: its end stays where it was last stored.
    act(() => store.remove(['b']))
    await settle()
    expect(line().points().slice(-2)).toEqual([1, 1])
  })
})

describe('BoardCanvas — select, move, snap', () => {
  it('a press selects; a drag moves, snapping to another element\'s edge, saved once when it settles', async () => {
    const live = fakeLive()
    const { store } = await mount({ live })
    const a = groupOf('a')
    const start = toScreen({ x: 50, y: 25 })
    press(a.findOne('Path'), start)
    expect(stageNow().findOne('Transformer').nodes()).toEqual([a])
    moveTo({ x: start.x + 100, y: start.y })
    moveTo({ x: start.x + 197, y: start.y + 2 })
    // While it moves: drawn where the hand is (snapped), told to the room, not saved.
    expect(a.x()).toBe(200)
    expect(a.y()).toBe(0)
    expect(named('guide').length).toBeGreaterThan(0)
    expect(live.sendDrag).toHaveBeenLastCalledWith('a', 200, 0)
    expect(store.update).not.toHaveBeenCalled()
    release({ x: start.x + 197, y: start.y + 2 })
    expect(store.update).toHaveBeenCalledTimes(1)
    expect(store.update).toHaveBeenCalledWith('a', { x: 200, y: 0 }, { settled: true })
    expect(named('guide')).toHaveLength(0)
  })

  it('Alt holds snapping off', async () => {
    const { store } = await mount()
    const start = toScreen({ x: 50, y: 25 })
    press(groupOf('a').findOne('Path'), start)
    moveTo({ x: start.x + 197, y: start.y + 2 }, { altKey: true })
    release({ x: start.x + 197, y: start.y + 2 })
    expect(store.update).toHaveBeenCalledWith('a', { x: 197, y: 2 }, { settled: true })
  })

  it('what changes under a drag is drawn when it lets go', async () => {
    const { store } = await mount()
    const start = toScreen({ x: 50, y: 25 })
    press(groupOf('a').findOne('Path'), start)
    moveTo({ x: start.x + 40, y: start.y + 40 })
    act(() => store.put({ ...store.getElements().get('a'), style: { fill: '#F28B82' }, version: 9 }))
    await settle()
    expect(groupOf('a').x()).toBe(40) // the hand still has it
    release({ x: start.x + 40, y: start.y + 40 })
    await settle()
    expect(groupOf('a').findOne('Path').fill()).toBe('#F28B82')
  })

  it('a dragged rectangle on empty board selects what lies inside it', async () => {
    await mount()
    const from = toScreen({ x: -20, y: -20 })
    const to = toScreen({ x: 150, y: 100 })
    press(stageNow(), from)
    moveTo(to)
    expect(stageNow().getLayers()[1].find('Rect').some((r) => r.visible() && r.width() === 170 && r.height() === 120)).toBe(true)
    release(to)
    await settle()
    expect(stageNow().findOne('Transformer').nodes().map((n) => n.attrs.elementId)).toEqual(['a'])
  })

  it('a frame carries what lies inside it', async () => {
    const store = fakeStore([
      { id: 'fr', kind: 'frame', x: 0, y: 0, w: 400, h: 300, z: 0, body: 'Ideas' },
      { id: 'in', kind: 'shape', shape: 'rectangle', x: 20, y: 20, w: 50, h: 50, z: 1 },
      { id: 'out', kind: 'shape', shape: 'rectangle', x: 1000, y: 20, w: 50, h: 50, z: 2 },
    ])
    await mount({ store })
    expect(stageNow().scaleX()).toBeLessThan(1) // fitted to show all three
    press(groupOf('fr').findOne('Rect'), toScreen({ x: 200, y: 200 }))
    moveTo(toScreen({ x: 233, y: 241 }), { altKey: true })
    release(toScreen({ x: 233, y: 241 }), { altKey: true })
    expect(store.update).toHaveBeenCalledWith('fr', { x: 33, y: 41 }, { settled: true })
    expect(store.update).toHaveBeenCalledWith('in', { x: 53, y: 61 }, { settled: true })
    expect(store.update).not.toHaveBeenCalledWith('out', expect.anything(), expect.anything())
  })

  it('resize through the transformer saves the new size, never a scale', async () => {
    const { store } = await mount()
    press(groupOf('a').findOne('Path'), toScreen({ x: 50, y: 25 }))
    release(toScreen({ x: 50, y: 25 }))
    const tr = stageNow().findOne('Transformer')
    const a = groupOf('a')
    act(() => { tr.fire('transformstart'); a.scaleX(2); a.rotation(30); tr.fire('transform'); tr.fire('transformend') })
    expect(store.update).toHaveBeenCalledWith('a', { x: 0, y: 0, w: 200, h: 50, rotation: 30 }, { settled: true })
    expect(groupOf('a').scaleX()).toBe(1)
  })

  it('keys: Delete removes, arrows nudge, ctrl+z undoes, letters pick tools', async () => {
    const { store } = await mount()
    press(groupOf('a').findOne('Path'), toScreen({ x: 50, y: 25 }))
    release(toScreen({ x: 50, y: 25 }))
    fireEvent.keyDown(region(), { key: 'ArrowRight' })
    expect(store.update).toHaveBeenCalledWith('a', { x: 1, y: 0 }, { settled: true })
    fireEvent.keyDown(region(), { key: 'ArrowDown', shiftKey: true })
    expect(store.update).toHaveBeenLastCalledWith('a', { x: 1, y: 10 }, { settled: true })
    fireEvent.keyDown(region(), { key: 'z', ctrlKey: true })
    expect(store.undo).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(region(), { key: 'z', ctrlKey: true, shiftKey: true })
    expect(store.redo).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(region(), { key: 'Delete' })
    expect(store.remove).toHaveBeenCalledWith(['a'])
    fireEvent.keyDown(region(), { key: 'p' })
    expect(screen.getByTitle('Pen (P)').getAttribute('aria-pressed')).toBe('true')
    // A key pressed on a button is the button's (Space presses it), not the board's.
    fireEvent.keyDown(screen.getByTitle('Select (V)'), { key: 't' })
    expect(screen.getByTitle('Pen (P)').getAttribute('aria-pressed')).toBe('true')
  })

  it('deleting an element keeps a connector\'s end where it was drawn', async () => {
    const store = fakeStore([RECT, OTHER, { id: 'c', kind: 'connector', x: 0, y: 0, w: 1, h: 1, z: 3, points: [0, 0, 1, 1], from_id: 'a', from_anchor: 'right', to_id: 'b', to_anchor: 'left', style: { end_head: 'none' } }])
    await mount({ store })
    press(groupOf('a').findOne('Path'), toScreen({ x: 50, y: 25 }))
    release(toScreen({ x: 50, y: 25 }))
    fireEvent.keyDown(region(), { key: 'Delete' })
    expect(store.update).toHaveBeenCalledWith('c', expect.objectContaining({ from_id: null, from_anchor: null, x: 100, y: 25 }), { settled: true })
    expect(store.remove).toHaveBeenCalledWith(['a'])
  })
})

describe('BoardCanvas — the tools', () => {
  it('a shape placed with a click, at its own size, then back to Select', async () => {
    const { store } = await mount()
    fireEvent.click(screen.getByTitle('Shape (S)'))
    const at = toScreen({ x: 500, y: 300 })
    press(stageNow(), at)
    release(at)
    expect(store.add).toHaveBeenCalledWith(expect.objectContaining({ kind: 'shape', shape: 'rectangle', x: 410, y: 245, w: 180, h: 110, z: 3, style: { fill: '#FFFFFF', stroke: '#2B3440', width: 2 } }))
    await settle()
    expect(screen.getByTitle('Select (V)').getAttribute('aria-pressed')).toBe('true')
    expect(groupOf('new-1')).toBeTruthy()
  })

  it('a shape from the picker, drawn to the size dragged', async () => {
    const { store } = await mount()
    fireEvent.click(screen.getByTitle('Choose a shape'))
    fireEvent.click(screen.getByTitle('Star'))
    const from = toScreen({ x: 500, y: 300 })
    const to = toScreen({ x: 620, y: 400 })
    press(stageNow(), from)
    moveTo(to)
    expect(named('draw-preview')).toHaveLength(1)
    release(to)
    expect(store.add).toHaveBeenCalledWith(expect.objectContaining({ kind: 'shape', shape: 'star', x: 500, y: 300, w: 120, h: 100 }))
  })

  it('a frame goes beneath everything', async () => {
    const { store } = await mount()
    fireEvent.click(screen.getByTitle('Frame (F)'))
    const at = toScreen({ x: 0, y: 500 })
    press(stageNow(), at)
    release(at)
    expect(store.add).toHaveBeenCalledWith(expect.objectContaining({ kind: 'frame', z: 0, body: 'Frame', w: 480, h: 320 }))
  })

  it('the pen draws a stroke kept relative to its box', async () => {
    const { store } = await mount()
    fireEvent.click(screen.getByTitle('Pen (P)'))
    press(stageNow(), toScreen({ x: 0, y: 200 }))
    moveTo(toScreen({ x: 10, y: 210 }))
    moveTo(toScreen({ x: 30, y: 205 }))
    expect(named('pen-preview')).toHaveLength(1)
    release(toScreen({ x: 30, y: 205 }))
    expect(store.add).toHaveBeenCalledWith(expect.objectContaining({ kind: 'pen', x: 0, y: 200, w: 30, h: 10, points: [0, 0, 10, 10, 30, 5], style: { stroke: '#2B3440', width: 3 } }))
    // The pen stays in hand.
    expect(screen.getByTitle('Pen (P)').getAttribute('aria-pressed')).toBe('true')
  })

  it('a connector from one element to another, tied to both', async () => {
    const { store } = await mount()
    fireEvent.click(screen.getByTitle('Connector (L)'))
    press(groupOf('a').findOne('Path'), toScreen({ x: 20, y: 10 }))
    moveTo(toScreen({ x: 200, y: 30 }))
    expect(named('connect-preview')).toHaveLength(1)
    release(toScreen({ x: 325, y: 30 }))
    expect(store.add).toHaveBeenCalledWith(expect.objectContaining({ kind: 'connector', from_id: 'a', from_anchor: 'auto', to_id: 'b', to_anchor: 'auto' }))
    await settle()
    const line = groupOf('new-1').findOne('.connector-line')
    expect(line.points().slice(0, 2)).toEqual([100, 25])
    // Its ends can be dragged: off the circle, the end comes free where it is dropped.
    expect(named('connector-handle')).toHaveLength(2)
    const toHandle = named('connector-handle').find((h) => h.attrs.boardHandle === 'to')
    press(toHandle, toScreen({ x: 300, y: 40 }))
    moveTo(toScreen({ x: 200, y: 400 }))
    release(toScreen({ x: 200, y: 400 }))
    expect(store.update).toHaveBeenLastCalledWith('new-1', expect.objectContaining({ to_id: null, to_anchor: null, from_id: 'a' }), { settled: true })
  })

  it('a text box opens its editor at once; empty, it goes', async () => {
    const { store } = await mount()
    fireEvent.click(screen.getByTitle('Text (T)'))
    press(stageNow(), toScreen({ x: 0, y: 300 }))
    release(toScreen({ x: 0, y: 300 }))
    const box = await screen.findByLabelText('Text')
    fireEvent.change(box, { target: { value: 'Notes' } })
    fireEvent.blur(box)
    await settle()
    expect(store.update).toHaveBeenCalledWith('new-1', expect.objectContaining({ body: 'Notes' }), { settled: true })
    fireEvent.click(screen.getByTitle('Text (T)'))
    press(stageNow(), toScreen({ x: 0, y: 500 }))
    release(toScreen({ x: 0, y: 500 }))
    fireEvent.blur(await screen.findByLabelText('Text'))
    await settle()
    expect(store.remove).toHaveBeenCalledWith(['new-2'])
  })

  // A browser sends a press's mousedown after its pointerdown, and gives the focus to the canvas on it. Seen in a
  // running browser: that took the focus from the words box the pointerdown had just opened, and the box closed.
  it('a press on the stage moves no focus by itself: the words box that press opened keeps it', async () => {
    await mount()
    const stageCanvas = document.querySelector('[data-moth-board-stage] canvas')
    const mouseDown = () => {
      const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      act(() => { stageCanvas.dispatchEvent(e) })
      return e
    }
    // No words box open: the canvas takes the focus, as it did when the browser gave it.
    expect(mouseDown().defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(region())
    // A new text: its box opens on the pointerdown with the focus in it, and the mousedown that follows leaves it there.
    fireEvent.click(screen.getByTitle('Text (T)'))
    press(stageNow(), toScreen({ x: 0, y: 300 }))
    const box = await screen.findByLabelText('Text')
    expect(document.activeElement).toBe(box)
    expect(mouseDown().defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(box)
    expect(screen.getByLabelText('Text')).toBe(box)
  })

  it('a sticky is made through the adapter and opens for writing', async () => {
    const turns = fakeTurns()
    const made = { id: 'st1', kind: 'sticky', x: 400, y: 200, w: 200, h: 200, z: 3, file: STICKY_FILE, missing: false, version: 1, style: {} }
    const adapter = { ...stickyAdapter(''), createSticky: vi.fn(async () => ({ element: made })) }
    const { store } = await mount({ adapter, turns })
    fireEvent.click(screen.getByTitle('Sticky note (N)'))
    press(stageNow(), toScreen({ x: 500, y: 300 }))
    release(toScreen({ x: 500, y: 300 }))
    await settle()
    expect(adapter.createSticky).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1' }), '', expect.objectContaining({ x: 400, y: 200, w: 200, h: 200 }))
    expect(store.applyRemote).toHaveBeenCalledWith({ board: 'b1', op: 'put', elements: [made] })
    expect(turns.begin).toHaveBeenCalledWith('st1')
    expect(await screen.findByLabelText('Words on the sticky')).toBeTruthy()
  })

  it('a store that adopts takes the new sticky as its own (drawn and undoable)', async () => {
    const made = { id: 'st2', kind: 'sticky', x: 0, y: 0, w: 200, h: 200, z: 3, file: STICKY_FILE, missing: false, version: 1, style: {} }
    const store = fakeStore([RECT, OTHER])
    store.adopt = vi.fn((el) => store.put(el))
    const adapter = { ...stickyAdapter(''), createSticky: vi.fn(async () => made) }
    await mount({ store, adapter, turns: fakeTurns() })
    fireEvent.click(screen.getByTitle('Sticky note (N)'))
    press(stageNow(), toScreen({ x: 100, y: 100 }))
    await settle()
    expect(store.adopt).toHaveBeenCalledWith(made)
    expect(store.applyRemote).not.toHaveBeenCalled()
    expect(groupOf('st2')).toBeTruthy()
  })

  it('a refusal to make a sticky is said in the server\'s words', async () => {
    const adapter = { createSticky: vi.fn(async () => { throw new Error('Boards need this project in the cloud.') }) }
    await mount({ adapter })
    fireEvent.click(screen.getByTitle('Sticky note (N)'))
    press(stageNow(), toScreen({ x: 500, y: 300 }))
    await settle()
    expect(screen.getByRole('status').textContent).toBe('Boards need this project in the cloud.')
  })
})

describe('BoardCanvas — words', () => {
  it('a double press opens a shape\'s words; leaving saves them', async () => {
    const { store } = await mount()
    const at = toScreen({ x: 50, y: 25 })
    press(groupOf('a').findOne('Path'), at)
    release(at)
    press(groupOf('a').findOne('Path'), at)
    const box = await screen.findByLabelText('Words in the shape')
    expect(box.value).toBe('Hello')
    // The canvas does not draw the words under the editor.
    expect(groupOf('a').findOne('Text')).toBeFalsy()
    fireEvent.change(box, { target: { value: 'Hello there' } })
    fireEvent.blur(box)
    await settle()
    expect(store.update).toHaveBeenCalledWith('a', { body: 'Hello there' }, { settled: true })
    expect(screen.queryByLabelText('Words in the shape')).toBeNull()
  })

  it('a sticky: the turn is claimed, the words saved through it, then handed back', async () => {
    const turns = fakeTurns()
    const escape = fakeEscape()
    const adapter = stickyAdapter('Buy milk')
    await mount({ store: fakeStore([STICKY]), adapter, turns, escape })
    await settle()
    const at = toScreen({ x: 100, y: 300 })
    press(groupOf('s').findOne('Rect'), at)
    release(at)
    press(groupOf('s').findOne('Rect'), at)
    await settle()
    expect(turns.begin).toHaveBeenCalledWith('s')
    const box = await screen.findByLabelText('Words on the sticky')
    expect(box.value).toBe('Buy milk')
    fireEvent.change(box, { target: { value: 'Buy bread' } })
    // Escape goes to the editor first (the panel's stack).
    await act(async () => { expect(escape.press()).toBe(true) })
    await settle()
    expect(turns.save).toHaveBeenCalledWith(expect.objectContaining({ id: 's' }), 'Buy bread')
    expect(turns.end).toHaveBeenCalledWith('s')
    expect(screen.queryByLabelText('Words on the sticky')).toBeNull()
    expect(groupOf('s').findOne('.sticky-words').text()).toBe('Buy bread')
  })

  it('someone else\'s turn: no editor, their name said', async () => {
    const turns = fakeTurns({ granted: false, holderLabel: 'Mara Okonkwo' })
    await mount({ store: fakeStore([STICKY]), adapter: stickyAdapter(), turns })
    const at = toScreen({ x: 100, y: 300 })
    press(groupOf('s').findOne('Rect'), at)
    release(at)
    press(groupOf('s').findOne('Rect'), at)
    await settle()
    expect(screen.queryByLabelText('Words on the sticky')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Mara Okonkwo is writing on this sticky.')
  })

  it('a turn that ended keeps the words in the editor and says so', async () => {
    const words = 'Your turn on this note ended. Copy your words, then try again.'
    const turns = fakeTurns({ save: { ok: false, reason: 'turn_ended', words } })
    const escape = fakeEscape()
    await mount({ store: fakeStore([STICKY]), adapter: stickyAdapter('Buy milk'), turns, escape })
    await settle()
    const at = toScreen({ x: 100, y: 300 })
    press(groupOf('s').findOne('Rect'), at)
    release(at)
    press(groupOf('s').findOne('Rect'), at)
    const box = await screen.findByLabelText('Words on the sticky')
    fireEvent.change(box, { target: { value: 'Buy bread and eggs' } })
    await act(async () => { escape.press() })
    await settle()
    const kept = screen.getByLabelText('Words on the sticky')
    expect(kept.value).toBe('Buy bread and eggs')
    expect(kept.readOnly).toBe(true)
    expect(screen.getByText(words)).toBeTruthy()
    fireEvent.blur(kept)
    await settle()
    expect(screen.getByLabelText('Words on the sticky')).toBeTruthy() // leaving does not lose them
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await settle()
    expect(screen.queryByLabelText('Words on the sticky')).toBeNull()
    expect(turns.end).toHaveBeenCalledWith('s')
  })

  it('someone saved a sticky\'s words: they are read again (when stickyTurn says so)', async () => {
    const turns = fakeTurns({ events: true })
    const adapter = stickyAdapter('Buy milk')
    await mount({ store: fakeStore([STICKY]), adapter, turns })
    await settle()
    expect(groupOf('s').findOne('.sticky-words').text()).toBe('Buy milk')
    adapter.readStickyText.mockResolvedValue('Buy bread')
    act(() => turns.tell({ type: 'body', elementId: 's', mine: false }))
    await settle()
    expect(adapter.readStickyText).toHaveBeenCalledTimes(2)
    expect(groupOf('s').findOne('.sticky-words').text()).toBe('Buy bread')
    // This window's own save is not read back.
    act(() => turns.tell({ type: 'body', elementId: 's', mine: true }))
    await settle()
    expect(adapter.readStickyText).toHaveBeenCalledTimes(2)
  })

  it('this window\'s turn ended while writing: the words stay and it says so', async () => {
    const turns = fakeTurns({ events: true })
    await mount({ store: fakeStore([STICKY]), adapter: stickyAdapter('Buy milk'), turns })
    await settle()
    const at = toScreen({ x: 100, y: 300 })
    press(groupOf('s').findOne('Rect'), at)
    release(at)
    press(groupOf('s').findOne('Rect'), at)
    const box = await screen.findByLabelText('Words on the sticky')
    fireEvent.change(box, { target: { value: 'Buy milk and tea' } })
    act(() => turns.tell({ type: 'ended', elementId: 's', words: 'Your turn on this note ended.' }))
    expect(screen.getByText('Your turn on this note ended.')).toBeTruthy()
    expect(screen.getByLabelText('Words on the sticky').value).toBe('Buy milk and tea')
    expect(screen.getByLabelText('Words on the sticky').readOnly).toBe(true)
    expect(turns.save).not.toHaveBeenCalled()
  })

  it('on someone else\'s turn the sticky glows with their name; mine does not', async () => {
    const turns = fakeTurns()
    const live = fakeLive()
    await mount({ store: fakeStore([STICKY]), adapter: stickyAdapter(), turns, live })
    turns.setGlow(new Map([['s', { holderLabel: 'Mara Okonkwo', endsAt: Date.now() + 20000, mine: false }]]))
    act(() => live.setCursors(new Map()))
    await settle()
    expect(named('sticky-glow')).toHaveLength(1)
    expect(named('sticky-glow')[0].stroke()).toBe('#AA3377')
    expect(named('sticky-holder')[0].text()).toBe('Mara Okonkwo is writing')
    turns.setGlow(new Map([['s', { holderLabel: 'Me', endsAt: Date.now() + 20000, mine: true }]]))
    act(() => live.setCursors(new Map()))
    await settle()
    expect(named('sticky-glow')).toHaveLength(0)
    // A turn past its end glows no more, even before anyone says so.
    turns.setGlow(new Map([['s', { holderLabel: 'Mara Okonkwo', endsAt: Date.now() - 1, mine: false }]]))
    act(() => live.setCursors(new Map()))
    await settle()
    expect(named('sticky-glow')).toHaveLength(0)
  })
})

describe('BoardCanvas — the style panel and stacking', () => {
  it('shows the selection\'s style; a swatch writes only what the server accepts', async () => {
    const { store } = await mount()
    press(groupOf('a').findOne('Path'), toScreen({ x: 50, y: 25 }))
    release(toScreen({ x: 50, y: 25 }))
    const panel = await screen.findByRole('complementary', { name: 'Style' })
    const fill = panel.querySelector('[data-style-group="Fill"]')
    fireEvent.click(fill.querySelector('[aria-label="Red"]'))
    expect(store.update).toHaveBeenCalledWith('a', { style: { fill: '#F28B82' } }, { settled: true })
    fireEvent.click(screen.getByTitle('Bring to front'))
    expect(store.update).toHaveBeenLastCalledWith('a', { z: 3 }, { settled: true })
    fireEvent.click(screen.getByTitle('Delete'))
    expect(store.remove).toHaveBeenCalledWith(['a'])
  })
})

describe('BoardCanvas — read only', () => {
  it('offers no writing tools, says so, and changes nothing', async () => {
    const store = fakeStore([RECT, OTHER], { canWrite: false })
    const turns = fakeTurns()
    await mount({ store, canWrite: false, turns })
    expect(screen.getByText(READ_ONLY_WORDS)).toBeTruthy()
    expect(screen.queryByTitle('Shape (S)')).toBeNull()
    expect(screen.queryByTitle('Undo')).toBeNull()
    expect(screen.getByTitle('Select (V)')).toBeTruthy()
    expect(screen.getByTitle('Move around (H)')).toBeTruthy()
    const at = toScreen({ x: 50, y: 25 })
    press(groupOf('a').findOne('Path'), at)
    moveTo({ x: at.x + 50, y: at.y })
    release({ x: at.x + 50, y: at.y })
    press(groupOf('a').findOne('Path'), at)
    fireEvent.keyDown(region(), { key: 'Delete' })
    fireEvent.keyDown(region(), { key: 's' })
    await settle()
    expect(store.update).not.toHaveBeenCalled()
    expect(store.remove).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Words in the shape')).toBeNull()
    expect(screen.queryByRole('complementary', { name: 'Style' })).toBeNull()
    expect(stageNow().findOne('Transformer').resizeEnabled()).toBe(false)
  })
})

describe('BoardCanvas — Escape, notices, the room', () => {
  it('takes Escape only while it has something to let go of', async () => {
    const escape = fakeEscape()
    await mount({ escape })
    expect(escape.stack).toHaveLength(0)
    press(groupOf('a').findOne('Path'), toScreen({ x: 50, y: 25 }))
    release(toScreen({ x: 50, y: 25 }))
    await settle()
    expect(escape.stack).toHaveLength(1)
    await act(async () => { expect(escape.press()).toBe(true) })
    expect(stageNow().findOne('Transformer').nodes()).toHaveLength(0)
    await settle()
    expect(escape.stack).toHaveLength(0)
    expect(escape.press()).toBe(false) // the panel's own: back to the graph
    fireEvent.click(screen.getByTitle('Pen (P)'))
    await settle()
    await act(async () => { expect(escape.press()).toBe(true) })
    expect(screen.getByTitle('Select (V)').getAttribute('aria-pressed')).toBe('true')
  })

  it('the shape picker takes Escape before the canvas', async () => {
    const escape = fakeEscape()
    await mount({ escape })
    fireEvent.click(screen.getByTitle('Shape (S)'))
    fireEvent.click(screen.getByTitle('Choose a shape'))
    await settle()
    await act(async () => { escape.press() })
    expect(screen.queryByRole('group', { name: 'Shapes' })).toBeNull()
    expect(screen.getByTitle('Shape (S)').getAttribute('aria-pressed')).toBe('true')
  })

  it('an id the server changed: the selection follows it', async () => {
    const { store } = await mount()
    press(groupOf('a').findOne('Path'), toScreen({ x: 50, y: 25 }))
    release(toScreen({ x: 50, y: 25 }))
    act(() => store.rename('a', 'a2'))
    await settle()
    expect(groupOf('a')).toBeFalsy()
    expect(stageNow().findOne('Transformer').nodes()).toEqual([groupOf('a2')])
    fireEvent.keyDown(region(), { key: 'Delete' })
    expect(store.remove).toHaveBeenCalledWith(['a2'])
  })

  it('a store notice is said', async () => {
    const { store } = await mount()
    act(() => store.say('That was changed by someone else, so it was not undone.'))
    expect(screen.getByRole('status').textContent).toBe('That was changed by someone else, so it was not undone.')
  })

  it('sends the pointer only while it moves; draws others\' cursors with their names', async () => {
    const live = fakeLive()
    await mount({ live })
    expect(live.sendPointer).not.toHaveBeenCalled()
    act(() => { host().dispatchEvent(pointerEvent('pointermove', { clientX: toScreen({ x: 10, y: 20 }).x, clientY: toScreen({ x: 10, y: 20 }).y })) })
    expect(live.sendPointer).toHaveBeenCalledTimes(1)
    expect(live.sendPointer).toHaveBeenCalledWith(10, 20)
    await settle()
    expect(live.sendPointer).toHaveBeenCalledTimes(1)
    act(() => live.setCursors(new Map([['u2', { x: 40, y: 50, label: 'Mara Okonkwo', colour: '#AA3377' }]])))
    await settle()
    const c = named('cursor')
    expect(c).toHaveLength(1)
    expect(c[0].x()).toBe(40)
    expect(c[0].findOne('Text').text()).toBe('Mara Okonkwo')
    act(() => live.setCursors(new Map()))
    await settle()
    expect(named('cursor')).toHaveLength(0)
  })
})

describe('BoardCanvas — the view', () => {
  it('ctrl and the wheel zoom about the pointer; the wheel alone pans', async () => {
    await mount()
    const s = stageNow()
    const x0 = s.x()
    fireEvent.wheel(host(), { deltaY: 100, deltaX: 0 })
    expect(s.y()).toBeLessThan(300)
    expect(s.x()).toBe(x0)
    fireEvent.wheel(host(), { deltaY: -200, ctrlKey: true, clientX: 400, clientY: 300 })
    expect(s.scaleX()).toBeGreaterThan(1)
    expect(document.querySelector('[data-zoom]').textContent).toBe(`${Math.round(s.scaleX() * 100)}%`)
  })

  it('zoom buttons and fit', async () => {
    await mount()
    fireEvent.click(screen.getByTitle('Zoom in'))
    expect(stageNow().scaleX()).toBeCloseTo(1.25, 5)
    fireEvent.click(screen.getByTitle('Zoom out'))
    expect(stageNow().scaleX()).toBeCloseTo(1, 5)
    fireEvent.click(screen.getByTitle('Show the whole board'))
    expect(stageNow().scaleX()).toBe(1)
  })

  it('two fingers pinch to zoom; a finger on empty board pans', async () => {
    await mount()
    const s = stageNow()
    const down = (id, x, y) => act(() => { host().dispatchEvent(pointerEvent('pointerdown', { pointerId: id, pointerType: 'touch', clientX: x, clientY: y })) })
    const move = (id, x, y) => act(() => { host().dispatchEvent(pointerEvent('pointermove', { pointerId: id, pointerType: 'touch', clientX: x, clientY: y })) })
    down(1, 100, 100)
    down(2, 200, 100)
    move(2, 300, 100)
    expect(s.scaleX()).toBeCloseTo(2, 5)
    act(() => { host().dispatchEvent(pointerEvent('pointerup', { pointerId: 2, pointerType: 'touch' })) })
    act(() => { host().dispatchEvent(pointerEvent('pointerup', { pointerId: 1, pointerType: 'touch' })) })
    const x0 = s.x()
    press(s, { x: 500, y: 500 }, { pointerType: 'touch', pointerId: 7 })
    moveTo({ x: 540, y: 500 }, { pointerId: 7, pointerType: 'touch' })
    release({ x: 540, y: 500 }, { pointerId: 7, pointerType: 'touch' })
    expect(s.x()).toBeCloseTo(x0 + 40, 5)
  })

  it('a finger or a pen makes the handles larger', async () => {
    const store = fakeStore([RECT, OTHER])
    const out = render(<BoardCanvas store={store} canWrite inputMode="mouse" />)
    await settle()
    press(groupOf('a').findOne('Path'), toScreen({ x: 50, y: 25 }))
    release(toScreen({ x: 50, y: 25 }))
    expect(stageNow().findOne('Transformer').anchorSize()).toBe(targetSizes('mouse').anchor)
    out.rerender(<BoardCanvas store={store} canWrite inputMode="touch" />)
    await settle()
    expect(stageNow().findOne('Transformer').anchorSize()).toBe(targetSizes('touch').anchor)
    expect(document.querySelector('[data-moth-board-canvas]').getAttribute('data-input')).toBe('touch')
  })

  it('unmounting lets go of the stage and the store', async () => {
    const { store, unmount } = await mount()
    const before = Konva.stages.length
    unmount()
    expect(Konva.stages.length).toBe(before - 1)
    act(() => store.say('gone'))
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('BoardCanvas — pictures, dropped files and embeds', () => {
  // A drag from the desktop as the window hands one on: where it is, and what it carries.
  function dragEvent(type, { files = [], types = ['Files'], at = { x: 0, y: 0 }, relatedTarget = null } = {}) {
    const e = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(e, 'clientX', { value: at.x })
    Object.defineProperty(e, 'clientY', { value: at.y })
    Object.defineProperty(e, 'relatedTarget', { value: relatedTarget })
    Object.defineProperty(e, 'dataTransfer', { value: { types, files, dropEffect: 'none' } })
    return e
  }
  const fire = (e) => { act(() => { region().dispatchEvent(e) }) ; return e }
  const BOARD = expect.objectContaining({ id: 'b1', folder_id: 'f1', project_id: 'p1' })
  const placedAs = (kind) => vi.fn(async (board, file, placement) => ({
    id: `${kind}-${typeof file === 'string' ? file : file.name}`, kind, ...placement, style: {}, missing: false, version: 1,
    file: typeof file === 'string' ? { id: file, name: 'Script.pdf', mime_type: 'application/pdf' } : { id: `f-${file.name}`, name: file.name, mime_type: file.type },
  }))
  const selectedIds = () => stageNow().findOne('Transformer').nodes().map((n) => n.attrs.elementId)
  const notice = () => document.querySelector('[data-moth-board-notice]')?.textContent ?? null
  const viewCentre = () => { const s = stageNow(); return { x: (400 - s.x()) / s.scaleX(), y: (300 - s.y()) / s.scaleY() } }
  const pdf = new File(['%PDF'], 'Brief.pdf', { type: 'application/pdf' })
  const png = new File(['png'], 'Still.png', { type: 'image/png' })

  // jsdom loads no pictures: a stand-in that reads a chosen picture's own size (or fails to, when there is none).
  let pictureSize = { w: 960, h: 540 }
  let realCreate
  let realRevoke
  beforeEach(() => {
    pictureSize = { w: 960, h: 540 }
    realCreate = URL.createObjectURL
    realRevoke = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:picture')
    URL.revokeObjectURL = vi.fn()
    vi.stubGlobal('Image', class {
      set src(v) {
        this.current = v
        queueMicrotask(() => {
          if (!pictureSize) { this.onerror?.(); return }
          this.naturalWidth = pictureSize.w
          this.naturalHeight = pictureSize.h
          this.onload?.()
        })
      }
      get src() { return this.current }
    })
  })
  afterEach(() => {
    URL.createObjectURL = realCreate
    URL.revokeObjectURL = realRevoke
    vi.unstubAllGlobals()
  })

  it('a picture\'s and a video\'s address come from boardFileUrl, never from fileUrl', async () => {
    const adapter = { boardFileUrl: vi.fn(async () => null), fileUrl: vi.fn(async () => 'https://wrong.test/x') }
    const store = fakeStore([
      { id: 'pic', kind: 'media', x: 0, y: 0, w: 160, h: 120, z: 1, file: { id: 'f2', name: 'still.png', mime_type: 'image/png' }, missing: false },
      { id: 'vid', kind: 'media', x: 200, y: 0, w: 160, h: 120, z: 2, file: { id: 'f3', name: 'take.mp4', mime_type: 'video/mp4' }, missing: false },
      { id: 'emb', kind: 'embed', x: 400, y: 0, w: 160, h: 120, z: 3, file: { id: 'f4', name: 'look.jpg', mime_type: 'image/jpeg' }, missing: false },
    ])
    await mount({ store, adapter })
    await settle()
    expect(adapter.boardFileUrl).toHaveBeenCalledWith(expect.objectContaining({ id: 'f2' }), { stream: false })
    expect(adapter.boardFileUrl).toHaveBeenCalledWith(expect.objectContaining({ id: 'f3' }), { stream: true })
    expect(adapter.boardFileUrl).toHaveBeenCalledWith(expect.objectContaining({ id: 'f4' }), { stream: false })
    expect(adapter.fileUrl).not.toHaveBeenCalled()
    // No address to be had: the tile with the file's name.
    expect(groupOf('pic').findOne('.file-words').text()).toBe('still.png\nPicture')
  })

  it('a refused address leaves the file\'s tile, not a broken picture', async () => {
    const adapter = { boardFileUrl: vi.fn(async () => { throw Object.assign(new Error('This file is missing — it may have been moved or deleted.'), { code: '42501' }) }) }
    await mount({ store: fakeStore([{ id: 'pic', kind: 'media', x: 0, y: 0, w: 160, h: 120, z: 1, file: { id: 'f2', name: 'still.png', mime_type: 'image/png' }, missing: false }]), adapter })
    await settle()
    expect(groupOf('pic').findOne('.file-tile')).toBeTruthy()
    expect(groupOf('pic').findOne('Image')).toBeFalsy()
  })

  it('files dropped on the board are each uploaded and placed where they were let go, a little apart, then selected', async () => {
    const adapter = { createMedia: placedAs('media') }
    const { store } = await mount({ adapter })
    const at = toScreen({ x: 500, y: 300 })
    const e = fire(dragEvent('drop', { files: [pdf, png], at }))
    expect(e.defaultPrevented).toBe(true)
    expect(notice()).toBe(addingWords(2))
    await settle()
    expect(adapter.createMedia).toHaveBeenCalledTimes(2)
    const [first, second] = adapter.createMedia.mock.calls
    // A file that is not a picture is a tile; a picture keeps its own shape, fitted (960 by 540 is 480 by 270).
    expect(first).toEqual([BOARD, pdf, { x: 380, y: 210, w: 240, h: 180, rotation: 0, z: expect.any(Number) }])
    expect(second).toEqual([BOARD, png, { x: 500 - 240 + 24, y: 300 - 135 + 24, w: 480, h: 270, rotation: 0, z: expect.any(Number) }])
    expect(second[2].z).toBeGreaterThan(first[2].z)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:picture')
    // Saved by the adapter already: the store hears them as the room would, and they are drawn and selected.
    expect(store.applyRemote).toHaveBeenCalledTimes(2)
    expect(groupOf('media-Brief.pdf')).toBeTruthy()
    expect(groupOf('media-Still.png')).toBeTruthy()
    expect(selectedIds()).toEqual(['media-Brief.pdf', 'media-Still.png'])
    expect(store.add).not.toHaveBeenCalled()
    expect(notice()).toBeNull()
  })

  it('a store that adopts takes a dropped file as its own (undoable)', async () => {
    const store = fakeStore([RECT])
    store.adopt = vi.fn((el) => store.put(el))
    const adapter = { createMedia: placedAs('media') }
    await mount({ store, adapter })
    fire(dragEvent('drop', { files: [pdf], at: toScreen({ x: 0, y: 0 }) }))
    await settle()
    expect(store.adopt).toHaveBeenCalledWith(expect.objectContaining({ id: 'media-Brief.pdf', kind: 'media' }))
    expect(store.applyRemote).not.toHaveBeenCalled()
  })

  it('one upload refused says why in its words; the rest still go', async () => {
    const createMedia = vi.fn(async (board, file, placement) => {
      if (file === pdf) throw new Error('This file is larger than the company\'s storage allows.')
      return placedAs('media')(board, file, placement)
    })
    await mount({ adapter: { createMedia } })
    fire(dragEvent('drop', { files: [pdf, png], at: toScreen({ x: 0, y: 0 }) }))
    await settle()
    expect(createMedia).toHaveBeenCalledTimes(2)
    expect(groupOf('media-Still.png')).toBeTruthy()
    expect(notice()).toBe('This file is larger than the company\'s storage allows.')
  })

  it('a drag carrying files is taken, and the board says where to let go; words or a link are not taken', async () => {
    await mount({ adapter: { createMedia: placedAs('media') } })
    const over = fire(dragEvent('dragover', { files: [pdf] }))
    expect(over.defaultPrevented).toBe(true)
    expect(over.dataTransfer.dropEffect).toBe('copy')
    expect(document.querySelector('[data-moth-board-drop]').textContent).toBe(DROP_WORDS)
    fire(dragEvent('dragleave', { files: [pdf] }))
    expect(document.querySelector('[data-moth-board-drop]')).toBeNull()
    const words = fire(dragEvent('dragover', { types: ['text/plain'] }))
    expect(words.defaultPrevented).toBe(false)
    const dropWords = fire(dragEvent('drop', { types: ['text/plain'] }))
    expect(dropWords.defaultPrevented).toBe(false)
    expect(document.querySelector('[data-moth-board-drop]')).toBeNull()
  })

  it('a board this person may only read takes a dropped file (so it never opens in place of the app) and says so', async () => {
    const adapter = { createMedia: placedAs('media'), embedFile: placedAs('embed') }
    await mount({ adapter, canWrite: false, store: fakeStore([RECT], { canWrite: false }) })
    const over = fire(dragEvent('dragover', { files: [pdf] }))
    expect(over.defaultPrevented).toBe(true)
    expect(over.dataTransfer.dropEffect).toBe('none')
    expect(document.querySelector('[data-moth-board-drop]')).toBeNull()
    fire(dragEvent('drop', { files: [pdf], at: toScreen({ x: 0, y: 0 }) }))
    await settle()
    expect(adapter.createMedia).not.toHaveBeenCalled()
    expect(notice()).toBe(READ_ONLY_WORDS)
    expect(screen.queryByTitle('Picture or file (I)')).toBeNull()
    expect(screen.queryByTitle('Embed a file (E)')).toBeNull()
    expect(document.querySelector('[data-moth-board-file-input]')).toBeNull()
    fireEvent.keyDown(region(), { key: 'e' })
    expect(screen.queryByRole('dialog', { name: 'Embed a file' })).toBeNull()
  })

  it('an adapter that cannot keep files on a board says so in plain words', async () => {
    await mount({ adapter: { readStickyText: vi.fn(async () => '') } })
    fire(dragEvent('drop', { files: [pdf], at: toScreen({ x: 0, y: 0 }) }))
    await settle()
    expect(notice()).toBe(NO_FILES_WORDS)
  })

  it('"Picture or file" opens the file chooser (the tool or I); what is chosen goes to the middle of the view', async () => {
    const opened = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    try {
      const adapter = { createMedia: placedAs('media') }
      await mount({ adapter })
      fireEvent.click(screen.getByTitle('Picture or file (I)'))
      expect(opened).toHaveBeenCalledTimes(1)
      fireEvent.keyDown(region(), { key: 'i' })
      expect(opened).toHaveBeenCalledTimes(2)
      const input = document.querySelector('[data-moth-board-file-input]')
      expect(input.multiple).toBe(true)
      const c = viewCentre()
      // A picture whose size cannot be read is placed at the size a file has.
      pictureSize = null
      fireEvent.change(input, { target: { files: [png] } })
      await settle()
      expect(adapter.createMedia).toHaveBeenCalledWith(BOARD, png, expect.objectContaining({ x: c.x - 120, y: c.y - 90, w: 240, h: 180 }))
      expect(selectedIds()).toEqual(['media-Still.png'])
    } finally {
      opened.mockRestore()
    }
  })

  it('"Embed a file" lists the project\'s files and places the chosen one as a reference in the middle of the view', async () => {
    const files = [
      { id: 'f-doc', name: 'Script.pdf', mime_type: 'application/pdf', folder_id: 'scripts' },
      { id: 'f-own', name: 'Dropped here.png', mime_type: 'image/png', folder_id: 'f1' },
      { id: 'f-lost', name: 'Lost.mov', mime_type: 'video/quicktime', folder_id: 'scripts', share_missing_since: '2026-11-01T00:00:00Z' },
    ]
    const adapter = { listMothFiles: vi.fn(async () => files), listMothFolders: vi.fn(async () => []), embedFile: placedAs('embed'), createMedia: vi.fn() }
    const { store } = await mount({ adapter })
    fireEvent.click(screen.getByTitle('Embed a file (E)'))
    expect(screen.getByRole('dialog', { name: 'Embed a file' })).toBeTruthy()
    expect(screen.getByTitle('Embed a file (E)').getAttribute('aria-expanded')).toBe('true')
    await waitFor(() => expect(document.querySelector('[data-embed-file="f-doc"]')).toBeTruthy())
    expect(adapter.listMothFiles).toHaveBeenCalledWith('p1', null, 500)
    // The board's own folder and a file the office server could not find are not offered.
    expect([...document.querySelectorAll('[data-embed-file]')].map((b) => b.getAttribute('data-embed-file'))).toEqual(['f-doc'])
    const c = viewCentre()
    fireEvent.click(document.querySelector('[data-embed-file="f-doc"]'))
    await settle()
    expect(adapter.embedFile).toHaveBeenCalledWith(BOARD, 'f-doc', { x: c.x - 120, y: c.y - 90, w: 240, h: 180, rotation: 0, z: expect.any(Number) })
    expect(adapter.createMedia).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Embed a file' })).toBeNull()
    expect(store.applyRemote).toHaveBeenCalledWith(expect.objectContaining({ op: 'put', elements: [expect.objectContaining({ id: 'embed-f-doc', kind: 'embed' })] }))
    expect(selectedIds()).toEqual(['embed-f-doc'])
  })

  it('the embed list takes Escape first, before the selection; E opens and closes it', async () => {
    const escape = fakeEscape()
    const adapter = { listMothFiles: vi.fn(async () => []), embedFile: placedAs('embed') }
    await mount({ adapter, escape })
    // Something selected, so the canvas has its own Escape to answer too.
    press(groupOf('a').findOne('Path'), toScreen({ x: 10, y: 10 }))
    release(toScreen({ x: 10, y: 10 }))
    expect(selectedIds()).toEqual(['a'])
    fireEvent.keyDown(region(), { key: 'e' })
    expect(screen.getByRole('dialog', { name: 'Embed a file' })).toBeTruthy()
    act(() => { expect(escape.press()).toBe(true) })
    expect(screen.queryByRole('dialog', { name: 'Embed a file' })).toBeNull()
    expect(selectedIds()).toEqual(['a'])
    act(() => { expect(escape.press()).toBe(true) })
    expect(selectedIds()).toEqual([])
    fireEvent.keyDown(region(), { key: 'e' })
    fireEvent.keyDown(region(), { key: 'e' })
    expect(screen.queryByRole('dialog', { name: 'Embed a file' })).toBeNull()
  })

  it('a refused embed is said in the server\'s words', async () => {
    const adapter = {
      listMothFiles: vi.fn(async () => [{ id: 'f-doc', name: 'Script.pdf', folder_id: 'scripts' }]),
      embedFile: vi.fn(async () => { throw Object.assign(new Error('file not found'), { code: '42501' }) }),
    }
    await mount({ adapter })
    fireEvent.click(screen.getByTitle('Embed a file (E)'))
    await waitFor(() => expect(document.querySelector('[data-embed-file="f-doc"]')).toBeTruthy())
    fireEvent.click(document.querySelector('[data-embed-file="f-doc"]'))
    await settle()
    expect(notice()).toBe('file not found')
  })

  it('a placed file is drawn at its own shape, fitted; a video wide; anything else a tile', () => {
    expect(mediaBox('picture', { w: 960, h: 540 })).toEqual({ w: 480, h: 270 })
    expect(mediaBox('picture', { w: 300, h: 1200 })).toEqual({ w: 90, h: 360 })
    expect(mediaBox('picture', { w: 100, h: 50 })).toEqual({ w: 100, h: 50 })
    expect(mediaBox('picture', { w: 4000, h: 10 })).toEqual({ w: 480, h: 40 })
    expect(mediaBox('picture', null)).toEqual({ w: 240, h: 180 })
    expect(mediaBox('video')).toEqual({ w: 320, h: 180 })
    expect(mediaBox('file')).toEqual({ w: 240, h: 180 })
    expect(dragHasFiles({ dataTransfer: { types: ['text/plain', 'Files'] } })).toBe(true)
    expect(dragHasFiles({ dataTransfer: { types: { length: 1, 0: 'Files' } } })).toBe(true)
    expect(dragHasFiles({ dataTransfer: { types: ['text/uri-list'] } })).toBe(false)
    expect(dragHasFiles({})).toBe(false)
    expect(addingWords(1)).toBe('Adding the file to the board…')
    expect(NO_FILES_WORDS).not.toMatch(/[_{}]/)
  })
})

describe('the helpers', () => {
  it('targets grow under a finger or a pen', () => {
    expect(targetSizes('touch').anchor).toBeGreaterThan(targetSizes('mouse').anchor)
    expect(targetSizes('touch').hit).toBeGreaterThan(targetSizes('mouse').hit)
  })
  it('a node tells what it belongs to', () => {
    const g = new Konva.Group({ elementId: 'x' })
    const r = new Konva.Rect()
    g.add(r)
    expect(elementIdOf(r)).toEqual({ id: 'x' })
    expect(elementIdOf(new Konva.Circle({ boardHandle: 'to', connId: 'c' }))).toEqual({ handle: 'to', connId: 'c' })
    expect(elementIdOf(null)).toEqual({})
    expect(writingWords('Mara Okonkwo')).toBe('Mara Okonkwo is writing on this sticky.')
    expect(writingWords(null)).toBe('Someone is writing on this sticky.')
  })
  it('keeps its words plain', () => {
    expect(READ_ONLY_WORDS).not.toMatch(/[_{}]/)
    expect(TURN_ENDED_WORDS).toMatch(/still here/)
    expect(MISSING_WORDS).toMatch(/missing/)
  })
})
