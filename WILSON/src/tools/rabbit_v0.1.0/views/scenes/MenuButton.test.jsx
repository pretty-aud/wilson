/** @vitest-environment jsdom */
// =============================================================================
// MenuButton under the browser's event order — post-overhaul S3b, review
// round 2 (R2-02).
//
// In Chromium a trusted event runs a MICROTASK CHECKPOINT after each listener
// returns, and React 19 flushes an update made outside its own handlers —
// here the kit Menu's document-capture mousedown, which closes the menu — in
// that microtask: render, commit and the effects. jsdom runs every listener
// of a dispatch in one stack, and Testing Library's fireEvent wraps it in
// act(), which defers React's flush to the end: the old order, in which round
// 1's fix (the swallow armed in the button's own onMouseDown) passed while
// the ⋯ still re-opened its menu in the app.
//
// browserOrder() wraps every document-level CAPTURE mousedown / keydown
// listener so React's pending work is flushed as it returns (flushSync) —
// what the checkpoint does — and the events are dispatched natively, outside
// act(). Each test also runs in jsdom's own order as a CONTROL.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { flushSync } from 'react-dom'
import MenuButton from './MenuButton'
import { _resetOverlaysForTests } from '../../../../ui/overlay'

let restore = null
function browserOrder() {
  const add = document.addEventListener
  const remove = document.removeEventListener
  const wrapped = new Map()
  document.addEventListener = function (type, fn, opts) {
    const capture = opts === true || !!opts?.capture
    if (capture && (type === 'mousedown' || type === 'keydown') && typeof fn === 'function') {
      const w = function (e) { fn.call(this, e); flushSync(() => {}) }
      wrapped.set(fn, w)
      return add.call(this, type, w, opts)
    }
    return add.call(this, type, fn, opts)
  }
  document.removeEventListener = function (type, fn, opts) {
    return remove.call(this, type, wrapped.get(fn) || fn, opts)
  }
  restore = () => { document.addEventListener = add; document.removeEventListener = remove }
}

const tick = () => new Promise((r) => setTimeout(r, 0))
const fire = (el, type, init = {}) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, ...init }))
/** A person's press: mousedown, then — a later task — mouseup and click. */
async function press(el) {
  fire(el, 'mousedown')
  await tick()
  fire(el, 'mouseup')
  fire(el, 'click')
  await tick()
}
const menu = () => document.querySelector('.ui-menu')

afterEach(() => {
  restore?.()
  restore = null
  cleanup()
  _resetOverlaysForTests()
  vi.restoreAllMocks()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

function mount() {
  const items = [{ label: 'Move up', onClick: vi.fn() }, { label: 'Remove from this list', onClick: vi.fn() }]
  const out = render(
    <div>
      <input aria-label="elsewhere" />
      <MenuButton title="Shot list actions for Cliff path" items={items} />
    </div>,
  )
  // Native events from here: outside act(), as the browser dispatches them.
  globalThis.IS_REACT_ACT_ENVIRONMENT = false
  return { button: out.getByTitle('Shot list actions for Cliff path'), field: out.getByLabelText('elsewhere'), items }
}

describe.each([
  ['the browser\'s order', true],
  ['jsdom\'s order (CONTROL)', false],
])('MenuButton in %s', (_, browser) => {
  it('a press on the ⋯ opens its menu, and a second press closes it', async () => {
    if (browser) browserOrder()
    const { button } = mount()
    await press(button)
    expect(menu()).not.toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('true')
    await press(button)
    expect(menu()).toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    // …and the next press opens it again: nothing is left armed.
    await press(button)
    expect(menu()).not.toBeNull()
  })

  it('a press slid off the ⋯ swallows nothing: the next click on it still opens', async () => {
    if (browser) browserOrder()
    const { button, field } = mount()
    await press(button)
    // Pressed on the ⋯, released on the field: the menu closes, no click on the ⋯.
    fire(button, 'mousedown')
    await tick()
    fire(field, 'mouseup')
    await tick()
    expect(menu()).toBeNull()
    await press(button)
    expect(menu()).not.toBeNull()
  })

  it('a press elsewhere closes the menu and leaves focus to the press — the ⋯ is not focused (nor scrolled to)', async () => {
    if (browser) browserOrder()
    const { button, field } = mount()
    await press(button)
    expect(document.activeElement.textContent).toBe('Move up')
    const focused = []
    const own = HTMLElement.prototype.focus
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (opts) { focused.push(this === button ? 'the ⋯' : this.tagName); return own.call(this, opts) })
    fire(field, 'mousedown')
    await tick()
    expect(menu()).toBeNull()
    expect(focused).toEqual([])
  })

  it('Escape closes the menu and gives focus back to the ⋯, without scrolling', async () => {
    if (browser) browserOrder()
    const { button } = mount()
    await press(button)
    const calls = []
    const own = HTMLElement.prototype.focus
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (opts) { calls.push([this === button ? 'the ⋯' : this.tagName, opts]); return own.call(this, opts) })
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await tick()
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(button)
    expect(calls).toEqual([['the ⋯', { preventScroll: true }]])
  })

  it('a press inside the menu (not on an item) is not a press that closed it: Escape after it still gives focus back', async () => {
    if (browser) browserOrder()
    const { button } = mount()
    await press(button)
    fire(menu(), 'mousedown')
    await tick()
    expect(menu()).not.toBeNull()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await tick()
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('an item hands focus to the ⋯ before it runs (a dialog it opens returns there), without scrolling', async () => {
    if (browser) browserOrder()
    const { button, items } = mount()
    await press(button)
    const calls = []
    const own = HTMLElement.prototype.focus
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (opts) { calls.push([this === button ? 'the ⋯' : this.tagName, opts]); return own.call(this, opts) })
    const item = [...document.querySelectorAll('.ui-menu .ui-menu-item')].find((b) => b.textContent === 'Remove from this list')
    await press(item)
    expect(items[1].onClick).toHaveBeenCalledTimes(1)
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(button)
    expect(calls[0]).toEqual(['the ⋯', { preventScroll: true }])
  })
})
