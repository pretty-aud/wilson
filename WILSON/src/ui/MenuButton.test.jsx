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
import { _resetOverlaysForTests } from './overlay'

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

// ── VW1d (2026-10-25), the kit request VW1-KR-3 (design §8, step 0 finding 9) ──
// The keyboard model the kit Menu lacks, given by MenuButton without roles;
// the labelled form; tabIndex, aria-label and onKeyDown reaching the button.
describe('MenuButton in the kit — the keyboard model and the labelled form (VW1-KR-3)', () => {
  const key = (el, k, init = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }))
  function mountRow(extra = {}) {
    const items = [{ label: 'Edit', onClick: vi.fn() }, { label: 'Rename', onClick: vi.fn() }, { label: 'Off', onClick: vi.fn(), disabled: true }, { label: 'Delete', onClick: vi.fn() }]
    const rowKey = vi.fn()
    const out = render(
      <div onKeyDown={rowKey}>
        <button type="button">before</button>
        <MenuButton title="More for Shoot week" items={items} {...extra} />
        <button type="button">after</button>
      </div>,
    )
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
    return { button: out.getByTitle('More for Shoot week'), rowKey, items, out }
  }
  const labels = () => [...document.querySelectorAll('.ui-menu .ui-menu-item')].map((b) => b.textContent)
  const focusedLabel = () => document.activeElement?.textContent

  it('↓ and ↑ move between the enabled items, wrapping; Home and End go to the ends; the disabled item is skipped', async () => {
    const { button } = mountRow()
    await press(button)
    expect(labels()).toEqual(['Edit', 'Rename', 'Off', 'Delete'])
    expect(focusedLabel()).toBe('Edit')
    key(document.activeElement, 'ArrowDown'); expect(focusedLabel()).toBe('Rename')
    key(document.activeElement, 'ArrowDown'); expect(focusedLabel()).toBe('Delete')
    key(document.activeElement, 'ArrowDown'); expect(focusedLabel()).toBe('Edit')
    key(document.activeElement, 'ArrowUp'); expect(focusedLabel()).toBe('Delete')
    key(document.activeElement, 'Home'); expect(focusedLabel()).toBe('Edit')
    key(document.activeElement, 'End'); expect(focusedLabel()).toBe('Delete')
  })

  it('every key in the menu stops at it: the row around the button never hears the arrows; CONTROL: a key on the button itself reaches the row', async () => {
    const { button, rowKey } = mountRow()
    await press(button)
    key(document.activeElement, 'ArrowDown')
    key(document.activeElement, 'ArrowUp')
    expect(rowKey).not.toHaveBeenCalled()
    await press(button)
    button.focus()
    key(button, 'ArrowDown')
    expect(rowKey).toHaveBeenCalledTimes(1)
  })

  it('Tab past the last item closes it and moves on to the control after the button; Shift+Tab before the first goes back to the button', async () => {
    const { button, out } = mountRow()
    await press(button)
    key(document.activeElement, 'End')
    key(document.activeElement, 'Tab')
    await tick()
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(out.getByText('after'))
    await press(button)
    key(document.activeElement, 'Tab', { shiftKey: true })
    await tick()
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('CONTROL: Tab between two items stays in the menu', async () => {
    const { button } = mountRow()
    await press(button)
    const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.activeElement.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)
    expect(menu()).not.toBeNull()
  })

  it('tabIndex, aria-label and onKeyDown reach the button; its ref is forwarded', () => {
    const ref = { current: null }
    const onKeyDown = vi.fn()
    render(<MenuButton ref={ref} title="More" aria-label="More for Shoot week, 2 of 4" tabIndex={-1} onKeyDown={onKeyDown} items={[{ label: 'Edit', onClick: () => {} }]} />)
    const b = document.querySelector('.ui-iconbtn')
    expect(ref.current).toBe(b)
    expect(b.getAttribute('tabindex')).toBe('-1')
    expect(b.getAttribute('aria-label')).toBe('More for Shoot week, 2 of 4')
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))
    expect(onKeyDown).toHaveBeenCalledTimes(1)
  })

  it('the labelled form is a kit Button with its label and variant, its menu under its LEFT edge; the icon form under its RIGHT', async () => {
    render(<MenuButton label="New" variant="primary" title={undefined} items={[{ label: 'Task', onClick: () => {} }]} minWidth={180} />)
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
    const b = document.querySelector('.ui-btn')
    expect(b.dataset.variant).toBe('primary')
    expect(b.textContent).toBe('New')
    b.getBoundingClientRect = () => ({ left: 300, right: 380, top: 10, bottom: 38, width: 80, height: 28 })
    await press(b)
    expect(menu().style.left).toBe('300px')
    cleanup(); _resetOverlaysForTests()
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    render(<MenuButton title="More" items={[{ label: 'Edit', onClick: () => {} }]} minWidth={180} />)
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
    const i = document.querySelector('.ui-iconbtn')
    i.getBoundingClientRect = () => ({ left: 500, right: 528, top: 10, bottom: 38, width: 28, height: 28 })
    await press(i)
    expect(menu().style.left).toBe(`${528 - 180}px`)
  })
})
