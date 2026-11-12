// =============================================================================
// navigation.test.js — pan, zoom and pinch on the world (MO2a, the brief's
// item 3; navigation.js bindNavigation and camera.js wheelFactor). Pins: the
// element's touch-action is 'none' while bound and comes back on unbind; one
// pointer drags by its own step; a second pointer pinches; a press the page
// claims (shouldStart false) never pans; a non-primary mouse button never
// pans; the wheel is taken from the page and zooms at the cursor's local
// position; a trackpad pinch (ctrl+wheel) zooms ten times faster; pointerup
// and pointercancel end the drag; unbind removes every handler. Each rule has
// a PLANTED control: the same check run against a broken binder must fail.
// No DOM: a fake element and a fake renderer over the real camera.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { bindNavigation } from './navigation.js'
import { camera, panBy, zoomAt, wheelFactor, screenToWorld, worldToScreen } from './camera.js'

const VP = { width: 800, height: 600 }
const RECT = { left: 10, top: 20 }

/** An element that keeps its handlers, its touch-action and its pointer captures. */
function fakeElement(touchAction = 'pan-y') {
  const handlers = new Map() // type -> Set of handlers
  const el = {
    style: { touchAction },
    captured: [],
    options: {},
    addEventListener(type, fn, opts) {
      if (!handlers.has(type)) handlers.set(type, new Set())
      handlers.get(type).add(fn)
      el.options[type] = opts
    },
    removeEventListener(type, fn) { handlers.get(type)?.delete(fn) },
    getBoundingClientRect: () => ({ left: RECT.left, top: RECT.top, width: VP.width, height: VP.height }),
    setPointerCapture(id) { el.captured.push(id) },
    fire(type, e) { for (const fn of [...(handlers.get(type) ?? [])]) fn(e); return e },
    listeners: () => [...handlers.values()].reduce((n, s) => n + s.size, 0),
  }
  return el
}

/** A renderer that records its calls and moves a real camera. */
function fakeRenderer() {
  let cam = camera(0, 0, 1)
  const calls = []
  return {
    calls,
    panBy(dx, dy) { calls.push(['panBy', dx, dy]); cam = panBy(cam, dx, dy) },
    zoomAt(f, sx, sy) { calls.push(['zoomAt', f, sx, sy]); cam = zoomAt(cam, VP, f, sx, sy) },
    setCamera(c) { calls.push(['setCamera', c]); cam = camera(c.x, c.y, c.k) },
    camera: () => cam,
    viewport: () => VP,
  }
}

/** A pointer event at LOCAL (x, y); the client position adds the element's offset. */
const pt = (id, x, y, o = {}) => ({ pointerId: id, clientX: x + RECT.left, clientY: y + RECT.top, button: 0, pointerType: 'touch', ...o })
const wheelEv = (o = {}) => ({ deltaY: -100, deltaMode: 0, ctrlKey: false, clientX: 110, clientY: 70, preventDefault() {}, ...o })
const pans = (r) => r.calls.filter((c) => c[0] === 'panBy').map((c) => [c[1], c[2]])

function rig(binder = bindNavigation, opts) {
  const el = fakeElement()
  const r = fakeRenderer()
  return { el, r, unbind: binder(el, r, opts) }
}

// ---- Planted faults ---------------------------------------------------------

/** The same element seen through a fault: `over` replaces some of its members. */
const through = (el, over) => Object.assign(Object.create(el), over)
/** The real binder with the touch-action line never reached. */
const withoutTouchLine = (el, r, o) => bindNavigation(through(el, { style: undefined }), r, o)
/** The real binder, but unbind writes '' instead of the value it found. */
const forgetsTouchAction = (el, r, o) => { const u = bindNavigation(el, r, o); return () => { u(); el.style.touchAction = '' } }
/** The real binder, deaf to the page's claim on a press. */
const ignoresShouldStart = (el, r) => bindNavigation(el, r)
/** The real binder that never listens for pointercancel. */
const noCancel = (el, r, o) => bindNavigation(through(el, { addEventListener: (t, f, x) => { if (t !== 'pointercancel') el.addEventListener(t, f, x) } }), r, o)
/** The real binder whose unbind leaves the wheel handler behind. */
const leaksWheel = (el, r, o) => bindNavigation(through(el, { removeEventListener: (t, f) => { if (t !== 'wheel') el.removeEventListener(t, f) } }), r, o)
/** A drag measured from the press point: the previous position is never updated. */
function fromPressPoint(el, r) {
  const start = new Map()
  const down = (e) => start.set(e.pointerId, { x: e.clientX, y: e.clientY })
  const move = (e) => { const s = start.get(e.pointerId); if (s) r.panBy(e.clientX - s.x, e.clientY - s.y) }
  el.addEventListener('pointerdown', down)
  el.addEventListener('pointermove', move)
  return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move) }
}
/** A first draft: every pointer drags, any button, no preventDefault, page coordinates, ctrl ignored. */
function naiveBind(el, r) {
  const last = new Map()
  const on = {
    pointerdown: (e) => last.set(e.pointerId, { x: e.clientX, y: e.clientY }),
    pointermove: (e) => {
      const p = last.get(e.pointerId)
      if (!p) return
      r.panBy(e.clientX - p.x, e.clientY - p.y)
      last.set(e.pointerId, { x: e.clientX, y: e.clientY })
    },
    pointerup: (e) => last.delete(e.pointerId),
    wheel: (e) => r.zoomAt(wheelFactor(e.deltaY), e.clientX, e.clientY),
  }
  for (const [t, f] of Object.entries(on)) el.addEventListener(t, f)
  return () => { for (const [t, f] of Object.entries(on)) el.removeEventListener(t, f) }
}

// ---- The checks, shared by each rule and its control -------------------------

/** touch-action is 'none' while bound and the value found comes back on unbind. */
function holdsTouchAction(binder) {
  const el = fakeElement('pan-y')
  const unbind = binder(el, fakeRenderer())
  const during = el.style.touchAction
  unbind()
  return during === 'none' && el.style.touchAction === 'pan-y'
}

/** Press, then two moves: the pans the renderer received. */
function dragPans(binder) {
  const { el, r } = rig(binder)
  el.fire('pointerdown', pt(1, 100, 100))
  el.fire('pointermove', pt(1, 130, 80))
  el.fire('pointermove', pt(1, 135, 80))
  return pans(r)
}
const DRAG = [[30, -20], [5, 0]]

/** Two fingers 100 px apart; the second spreads them to 200, then closes them to 50. */
function pinchGesture(binder) {
  const { el, r } = rig(binder)
  el.fire('pointerdown', pt(1, 100, 300))
  el.fire('pointerdown', pt(2, 200, 300))
  el.fire('pointermove', pt(2, 300, 300))
  el.fire('pointermove', pt(2, 150, 300))
  return { cams: r.calls.filter((c) => c[0] === 'setCamera').map((c) => c[1]), pans: pans(r).length }
}
const followsSpread = ({ cams, pans: n }) => n === 0 && cams.length === 2 && cams[0].k === 2 && cams[1].k === 0.5

/** A press, a drag: how many pans. */
function pressPans(binder, opts, down = {}) {
  const { el, r } = rig(binder, opts)
  el.fire('pointerdown', pt(1, 100, 100, down))
  el.fire('pointermove', pt(1, 160, 140, down))
  return pans(r).length
}
const claim = { shouldStart: () => false }
const rightButton = { pointerType: 'mouse', button: 2 }

/** One wheel notch at client (110, 70), local (100, 50): taken from the page, zoomed at the local point. */
function wheelZoomsAtCursor(binder) {
  const { el, r } = rig(binder)
  let prevented = 0
  el.fire('wheel', wheelEv({ preventDefault: () => prevented++ }))
  const z = r.calls.find((c) => c[0] === 'zoomAt')
  return prevented === 1 && el.options.wheel?.passive === false &&
    z?.[1] === wheelFactor(-100) && z[2] === 100 && z[3] === 50
}

/** A trackpad pinch of 40 small steps zooms at least 2x; 40 plain wheel steps stay under 1.3x. */
const pinchIsFast = (wf) => wf(-3, 0, true) ** 40 >= 2 && wf(-3, 0, false) ** 40 < 1.3
function kAfter40(binder, ctrlKey) {
  const { el, r } = rig(binder)
  for (let i = 0; i < 40; i++) el.fire('wheel', wheelEv({ deltaY: -3, ctrlKey }))
  return r.camera().k
}
const pinchGestureIsFast = (binder) => kAfter40(binder, true) >= 2 && kAfter40(binder, false) < 1.3

/** Drag, end it with `end`, move again: pans after the end. */
function pansAfterEnd(binder, end) {
  const { el, r } = rig(binder)
  el.fire('pointerdown', pt(1, 100, 100))
  el.fire('pointermove', pt(1, 120, 100))
  el.fire(end, pt(1, 120, 100))
  el.fire('pointermove', pt(1, 200, 100))
  return pans(r).length - 1
}

/** Bind, press, unbind, then fire everything: listeners left and renderer calls caused. */
function afterUnbind(binder) {
  const { el, r, unbind } = rig(binder)
  el.fire('pointerdown', pt(1, 100, 100))
  unbind()
  el.fire('pointermove', pt(1, 150, 100))
  el.fire('wheel', wheelEv())
  return { listeners: el.listeners(), calls: r.calls.length }
}

describe('navigation', () => {
  it("binding sets touch-action 'none' and unbind restores the value it found", () => {
    expect(holdsTouchAction(bindNavigation)).toBe(true)
  })

  it('CONTROL: a binder without the touch-action line, or one that forgets the old value, fails that check', () => {
    expect(holdsTouchAction(withoutTouchLine)).toBe(false)
    expect(holdsTouchAction(forgetsTouchAction)).toBe(false)
  })

  it('one pointer drags the world by its own step, and the pointer is captured', () => {
    expect(dragPans(bindNavigation)).toEqual(DRAG)
    const { el, r } = rig()
    el.fire('pointerdown', pt(4, 100, 100))
    el.fire('pointermove', pt(4, 130, 80))
    expect(r.camera()).toEqual({ x: -30, y: 20, k: 1 }) // the world moved with the pointer
    expect(el.captured).toEqual([4])
    const throwing = rig()
    throwing.el.setPointerCapture = () => { throw new Error('InvalidStateError') }
    throwing.el.fire('pointerdown', pt(1, 0, 0))
    throwing.el.fire('pointermove', pt(1, 5, 5))
    expect(pans(throwing.r)).toEqual([[5, 5]]) // a refused capture does not stop the drag
  })

  it('CONTROL: a drag measured from the press point fails that check', () => {
    expect(dragPans(fromPressPoint)).not.toEqual(DRAG)
  })

  it('a second pointer pinches: setCamera with a zoom that follows the spread, no pan', () => {
    const g = pinchGesture(bindNavigation)
    expect(followsSpread(g)).toBe(true)
    // The world under the first midpoint (150, 300) sits under the new one (200, 300).
    const w = screenToWorld(camera(), VP, 150, 300)
    const s = worldToScreen(g.cams[0], VP, w.x, w.y)
    expect(s.x).toBeCloseTo(200, 9)
    expect(s.y).toBeCloseTo(300, 9)
  })

  it('CONTROL: a binder where every pointer drags fails that check', () => {
    expect(followsSpread(pinchGesture(naiveBind))).toBe(false)
  })

  it('a press the page claims (shouldStart false) never pans and is never captured', () => {
    const asked = []
    expect(pressPans(bindNavigation, { shouldStart: (e) => { asked.push(e.pointerId); return false } })).toBe(0)
    expect(asked).toEqual([1])
    const { el } = rig(bindNavigation, claim)
    el.fire('pointerdown', pt(1, 100, 100))
    expect(el.captured).toEqual([])
    expect(pressPans(bindNavigation, { shouldStart: () => true })).toBe(1)
  })

  it('CONTROL: a binder that ignores shouldStart fails that check', () => {
    expect(pressPans(ignoresShouldStart, claim)).not.toBe(0)
  })

  it('a non-primary mouse button does not pan; the primary button does', () => {
    expect(pressPans(bindNavigation, undefined, rightButton)).toBe(0)
    expect(pressPans(bindNavigation, undefined, { pointerType: 'mouse', button: 1 })).toBe(0)
    expect(pressPans(bindNavigation, undefined, { pointerType: 'mouse', button: 0 })).toBe(1)
  })

  it('CONTROL: a binder blind to the button fails that check', () => {
    expect(pressPans(naiveBind, undefined, rightButton)).not.toBe(0)
  })

  it("the wheel is taken from the page (preventDefault, passive: false) and zooms at the cursor's local position", () => {
    expect(wheelZoomsAtCursor(bindNavigation)).toBe(true)
  })

  it('CONTROL: a wheel handler that zooms at page coordinates without preventDefault fails that check', () => {
    expect(wheelZoomsAtCursor(naiveBind)).toBe(false)
  })

  it('ctrl+wheel (a trackpad pinch) zooms ten times faster per delta than a plain wheel', () => {
    expect(pinchIsFast(wheelFactor)).toBe(true)
    expect(Math.log(wheelFactor(-3, 0, true)) / Math.log(wheelFactor(-3))).toBeCloseTo(10, 9)
    expect(pinchGestureIsFast(bindNavigation)).toBe(true) // and the binder passes ctrlKey through
  })

  it('CONTROL: a factor that ignores ctrl, or boosts every wheel, and a binder that drops ctrlKey, fail those checks', () => {
    expect(pinchIsFast((dy, m) => wheelFactor(dy, m))).toBe(false)
    expect(pinchIsFast((dy, m) => wheelFactor(dy, m, true))).toBe(false)
    expect(pinchGestureIsFast(naiveBind)).toBe(false)
  })

  it('pointerup and pointercancel end the drag; the next press starts fresh; lifting one pinch finger leaves a drag', () => {
    expect(pansAfterEnd(bindNavigation, 'pointerup')).toBe(0)
    expect(pansAfterEnd(bindNavigation, 'pointercancel')).toBe(0)
    const { el, r } = rig()
    el.fire('pointerdown', pt(1, 100, 100))
    el.fire('pointerup', pt(1, 100, 100))
    el.fire('pointerdown', pt(1, 300, 100))
    el.fire('pointermove', pt(1, 310, 100))
    expect(pans(r)).toEqual([[10, 0]]) // not a jump from the last press
    const two = rig()
    two.el.fire('pointerdown', pt(1, 100, 100))
    two.el.fire('pointerdown', pt(2, 200, 100))
    two.el.fire('pointercancel', pt(2, 200, 100))
    two.el.fire('pointermove', pt(1, 90, 104))
    expect(pans(two.r)).toEqual([[-10, 4]])
  })

  it('CONTROL: a binder that never listens for pointercancel fails that check', () => {
    expect(pansAfterEnd(noCancel, 'pointercancel')).not.toBe(0)
  })

  it('unbind removes every handler, mid-drag included, with or without the wheel', () => {
    const { el, unbind } = rig()
    expect(el.listeners()).toBe(5)
    unbind()
    expect(el.listeners()).toBe(0)
    expect(afterUnbind(bindNavigation)).toEqual({ listeners: 0, calls: 0 })
    const noWheel = rig(bindNavigation, { wheel: false })
    expect(noWheel.el.listeners()).toBe(4)
    noWheel.unbind()
    expect(noWheel.el.listeners()).toBe(0)
  })

  it('CONTROL: a binder whose unbind leaves the wheel handler behind fails that check', () => {
    expect(afterUnbind(leaksWheel)).not.toEqual({ listeners: 0, calls: 0 })
  })
})
