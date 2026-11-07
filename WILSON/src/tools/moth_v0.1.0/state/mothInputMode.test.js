// mothInputMode.test.js — MO2: pen and touch switch to the touch layout; only a real mouse switches back.
import { describe, it, expect, vi } from 'vitest'
import { createInputMode, SYNTHETIC_MS, MOUSE_MOVE_PX, prefersReducedMotion } from './mothInputMode.js'

const ev = (pointerType, type = 'pointermove', x = 0, y = 0) => ({ pointerType, type, clientX: x, clientY: y })

function make() {
  let t = 1000
  const onChange = vi.fn()
  const m = createInputMode({ now: () => t, onChange })
  return { m, onChange, at: (ms) => { t = ms } }
}

describe('createInputMode', () => {
  it('starts on the mouse; a finger or a pen switches to touch at once', () => {
    const { m, onChange } = make()
    expect(m.mode()).toBe('mouse')
    m.handle(ev('touch', 'pointerdown'))
    expect(m.mode()).toBe('touch')
    expect(onChange).toHaveBeenCalledWith('touch')
    const pen = make()
    pen.m.handle(ev('pen', 'pointerdown'))
    expect(pen.m.mode()).toBe('touch')
  })
  it('the browser\'s own mouse events soon after a touch do not count', () => {
    const { m, at } = make()
    m.handle(ev('touch', 'pointerdown'))
    at(1000 + SYNTHETIC_MS - 1)
    m.handle(ev('mouse', 'pointerdown', 50, 50))
    m.handle(ev('mouse', 'pointermove', 500, 500))
    expect(m.mode()).toBe('touch')
  })
  it('a stray mouse move of a few pixels does not switch back; a real movement does', () => {
    const { m, at, onChange } = make()
    m.handle(ev('touch', 'pointerdown'))
    at(5000)
    m.handle(ev('mouse', 'pointermove', 100, 100)) // the first sighting only sets where the mouse is
    m.handle(ev('mouse', 'pointermove', 100 + MOUSE_MOVE_PX - 1, 100))
    expect(m.mode()).toBe('touch')
    m.handle(ev('mouse', 'pointermove', 100 + MOUSE_MOVE_PX, 100))
    expect(m.mode()).toBe('mouse')
    expect(onChange).toHaveBeenLastCalledWith('mouse')
  })
  it('a real click is a real mouse', () => {
    const { m, at } = make()
    m.handle(ev('touch', 'pointerdown'))
    at(5000)
    m.handle(ev('mouse', 'pointerdown', 3, 3))
    expect(m.mode()).toBe('mouse')
  })
  it('says a change once, and ignores what is not a pointer', () => {
    const { m, onChange } = make()
    m.handle(ev('touch', 'pointerdown'))
    m.handle(ev('touch', 'pointermove'))
    m.handle({})
    m.handle(null)
    expect(onChange).toHaveBeenCalledTimes(1)
  })
  it('listens on one target, capture and passive, and lets go', () => {
    const { m } = make()
    const t = { addEventListener: vi.fn(), removeEventListener: vi.fn() }
    m.attach(t)
    m.attach(t)
    expect(t.addEventListener).toHaveBeenCalledTimes(2)
    expect(t.addEventListener.mock.calls.map((c) => c[0]).sort()).toEqual(['pointerdown', 'pointermove'])
    for (const c of t.addEventListener.mock.calls) expect(c[2]).toEqual({ capture: true, passive: true })
    m.detach()
    m.detach()
    expect(t.removeEventListener).toHaveBeenCalledTimes(2)
  })
})

describe('prefersReducedMotion', () => {
  it('is false where there is no window to ask', () => {
    expect(prefersReducedMotion()).toBe(false)
  })
})
