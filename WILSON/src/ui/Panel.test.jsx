/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { allRules, decls, splitTop } from '../../scripts/ui-css-rules.mjs'
import { Panel } from './Panel'

afterEach(cleanup)

describe('Panel', () => {
  it('renders an aside with a body, and no header when untitled', () => {
    const { container } = render(<Panel>tree</Panel>)
    const el = container.querySelector('aside.ui-panel')
    expect(el).not.toBeNull()
    expect(container.querySelector('.ui-panel-head')).toBeNull()
    expect(container.querySelector('.ui-panel-body').textContent).toBe('tree')
  })

  it('renders the Label-step header and its actions', () => {
    render(<Panel title="Folders" actions={<button type="button">New</button>}>x</Panel>)
    expect(screen.getByText('Folders').className).toBe('ui-panel-title')
    expect(screen.getByRole('button', { name: 'New' })).not.toBeNull()
  })

  it('takes one of the three width tokens, as data', () => {
    const { container, rerender } = render(<Panel>x</Panel>)
    expect(container.querySelector('.ui-panel').dataset.width).toBe('md')
    for (const w of ['sm', 'md', 'lg']) {
      rerender(<Panel width={w}>x</Panel>)
      expect(container.querySelector('.ui-panel').dataset.width).toBe(w)
    }
  })

  // An off-scale width used to render `data-width="220px"`, which matches no
  // rule — so the panel got NO width at all, and in a production build
  // nothing said so. It falls back onto the scale and complains in dev.
  it('falls back to the scale for an off-scale width, and says so in dev', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = render(<Panel width="220px">x</Panel>)
    expect(container.querySelector('.ui-panel').dataset.width).toBe('md')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('puts its hairline on the docked edge and writes no inline style', () => {
    const { container } = render(<Panel side="right" surface="light">x</Panel>)
    const el = container.querySelector('.ui-panel')
    expect(el.dataset.side).toBe('right')
    expect(el.dataset.surface).toBe('light')
    expect(el.getAttribute('style')).toBeNull()
  })
})

// =============================================================================
// SB1 (2026-11-01) — a left-docked Panel resizes by its edge. Audrey: "this
// divider line from the courses sidebar and the overall otter window should be
// expanding by grabbing and putting the line to the desired width of the
// courses sidebar. lets do the same with the sidebar in the dog tool". The
// design round's numbers (scratch; the SB1 hand-off): an 8px strip, the arrows
// ±8 and ±40, a 3px slop, the width remembered only while it differs from the
// token. O.T.T.E.R.'s props below: sm 200, 180 to 480, the row keeps 720.
// jsdom lays nothing out, so a row's width is stubbed where it matters.
// =============================================================================
const KEY = 'sb1.panel.test.width'
const COURSES = { width: 'sm', title: 'Courses', resizable: true, storageKey: KEY, minWidth: 180, maxWidth: 480, minBeside: 720 }

/** The Panel in a row `rowWidth` wide (0: a row with no layout). */
function inRow(ui, rowWidth = 0) {
  let w = rowWidth
  const row = document.createElement('div')
  Object.defineProperty(row, 'clientWidth', { configurable: true, get: () => w })
  document.body.appendChild(row)
  const view = render(ui, { container: row })
  const aside = row.querySelector('aside.ui-panel')
  const handle = () => row.querySelector('[role="separator"]')
  return {
    ...view,
    row,
    aside,
    handle,
    size: () => aside.style.getPropertyValue('--ui-panel-size'),
    now: () => Number(handle().getAttribute('aria-valuenow')),
    max: () => Number(handle().getAttribute('aria-valuemax')),
    setRow: (px) => { w = px },
  }
}
const press = (el, x, init = {}) => fireEvent.pointerDown(el, { pointerId: 1, button: 0, isPrimary: true, clientX: x, ...init })
const move = (el, x) => fireEvent.pointerMove(el, { pointerId: 1, clientX: x })
const lift = (el, x) => fireEvent.pointerUp(el, { pointerId: 1, clientX: x })
const key = (el, k, init = {}) => fireEvent.keyDown(el, { key: k, ...init })
const resizing = () => document.documentElement.hasAttribute('data-ui-resizing')

/** A ResizeObserver jsdom lacks, fired by hand. */
function stubResizeObserver() {
  const live = new Set()
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb) { this.cb = cb }
    observe() { live.add(this) }
    disconnect() { live.delete(this) }
  })
  return { fire: () => act(() => { for (const ro of live) ro.cb([]) }), live: () => live.size }
}

/** Pointer capture, which jsdom lacks, as spies (the drag must take it). */
function stubPointerCapture() {
  const proto = HTMLElement.prototype
  const had = ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture'].filter((m) => m in proto)
  const captured = new Set()
  const set = vi.fn((id) => { captured.add(id) })
  const has = vi.fn((id) => captured.has(id))
  const release = vi.fn((id) => { captured.delete(id) })
  Object.assign(proto, { setPointerCapture: set, hasPointerCapture: has, releasePointerCapture: release })
  return { set, has, release, restore: () => { for (const m of ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture']) if (!had.includes(m)) delete proto[m] } }
}

describe('Panel — resizable (SB1)', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.documentElement.removeAttribute('data-ui-resizing')
  })

  it('absent, the Panel is exactly what it was: no separator, no style, no id, no data-resizable', () => {
    const { container } = render(<Panel width="sm" title="Courses">x</Panel>)
    const aside = container.querySelector('aside')
    expect(container.querySelector('[role="separator"]')).toBeNull()
    expect(aside.getAttribute('style')).toBeNull()
    expect(aside.hasAttribute('id')).toBe(false)
    expect(aside.hasAttribute('data-resizable')).toBe(false)
    expect(screen.getByText('Courses').hasAttribute('id')).toBe(false)
  })

  it('draws one focusable vertical separator, the aside\'s last child, named by the title and controlling the aside', () => {
    const p = inRow(<Panel {...COURSES}><p>list</p></Panel>)
    const h = screen.getByRole('separator', { name: 'Courses' })
    expect(h).toBe(p.handle())
    expect(p.aside.lastElementChild).toBe(h)
    expect(h.tabIndex).toBe(0)
    expect(h.getAttribute('aria-orientation')).toBe('vertical')
    expect(h.getAttribute('aria-controls')).toBe(p.aside.id)
    expect(p.aside.id).not.toBe('')
    expect(p.aside.dataset.resizable).toBe('true')
    expect([h.getAttribute('aria-valuemin'), h.getAttribute('aria-valuemax'), h.getAttribute('aria-valuenow')]).toEqual(['180', '480', '200'])
    expect(h.getAttribute('aria-valuetext')).toBe('200 pixels')
    expect(p.size()).toBe('200px')
  })

  it('without a title it is named by the panel\'s own aria-labelledby (D.O.G.\'s bar)', () => {
    render(<><span id="sb1-bar-label">Deck outline</span><Panel width="md" aria-labelledby="sb1-bar-label" resizable storageKey={KEY} minWidth={160} maxWidth={480}>x</Panel></>)
    expect(screen.getByRole('separator', { name: 'Deck outline' }).getAttribute('aria-valuenow')).toBe('240')
  })

  it('a right-docked panel draws no handle and says so in dev', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = render(<Panel side="right" resizable storageKey={KEY} minWidth={200} maxWidth={400}>x</Panel>)
    expect(container.querySelector('[role="separator"]')).toBeNull()
    expect(container.querySelector('aside').getAttribute('style')).toBeNull()
    expect(spy).toHaveBeenCalled()
  })

  it('a drag moves the width with the pointer and renders no tool; the key is written once, at the release', () => {
    let renders = 0
    function Tool() { renders++; return <Panel {...COURSES}><p>course list</p></Panel> }
    const p = inRow(<Tool />)
    const before = renders
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    press(p.handle(), 200)
    expect(resizing()).toBe(true)
    expect(p.handle().getAttribute('data-dragging')).toBe('true')
    move(p.handle(), 230)
    expect(p.size()).toBe('230px')
    move(p.handle(), 320)
    expect([p.size(), p.now(), p.handle().getAttribute('aria-valuetext')]).toEqual(['320px', 320, '320 pixels'])
    expect(localStorage.getItem(KEY)).toBe(null)
    lift(p.handle(), 320)
    expect(localStorage.getItem(KEY)).toBe('320')
    expect(setItem.mock.calls.filter(([k]) => k === KEY)).toHaveLength(1)
    expect([p.size(), p.now()]).toEqual(['320px', 320])
    expect(resizing()).toBe(false)
    expect(p.handle().hasAttribute('data-dragging')).toBe(false)
    expect(renders).toBe(before)
  })

  it('a press that travels under 3px is a click: nothing moves, nothing is written', () => {
    localStorage.setItem(KEY, '320')
    const p = inRow(<Panel {...COURSES}>x</Panel>)
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    const removes = vi.spyOn(Storage.prototype, 'removeItem')
    press(p.handle(), 320); move(p.handle(), 322); move(p.handle(), 318); lift(p.handle(), 318)
    expect([p.size(), p.now(), localStorage.getItem(KEY)]).toEqual(['320px', 320, '320'])
    expect([writes.mock.calls.length, removes.mock.calls.length]).toEqual([0, 0])
  })

  it('the mouse press keeps focus where it was and starts no selection (its default is prevented)', () => {
    const p = inRow(<><button type="button">elsewhere</button><Panel {...COURSES}>x</Panel></>)
    const other = screen.getByRole('button', { name: 'elsewhere' })
    other.focus()
    expect(fireEvent.mouseDown(p.handle())).toBe(false)
    expect(document.activeElement).toBe(other)
  })

  it('a pointer far past either limit leaves the width at the limit', () => {
    const p = inRow(<Panel {...COURSES}>x</Panel>)
    press(p.handle(), 200); move(p.handle(), 5000); lift(p.handle(), 5000)
    expect([p.now(), localStorage.getItem(KEY)]).toEqual([480, '480'])
    press(p.handle(), 480); move(p.handle(), -5000); lift(p.handle(), -5000)
    expect([p.now(), localStorage.getItem(KEY)]).toEqual([180, '180'])
  })

  it('Escape mid-drag puts the width back and writes nothing — and a field holding focus never sees the key', () => {
    const fieldKeys = vi.fn()
    const p = inRow(<><input aria-label="note" onKeyDown={fieldKeys} /><Panel {...COURSES}>x</Panel></>)
    const field = screen.getByRole('textbox', { name: 'note' })
    field.focus()
    press(p.handle(), 200); move(p.handle(), 300)
    expect(p.size()).toBe('300px')
    key(field, 'Escape')
    expect(fieldKeys).not.toHaveBeenCalled()
    expect([p.size(), p.now(), resizing()]).toEqual(['200px', 200, false])
    lift(p.handle(), 300)
    expect([p.size(), localStorage.getItem(KEY)]).toEqual(['200px', null])
    // With no drag, Escape is the field's again.
    key(field, 'Escape')
    expect(fieldKeys).toHaveBeenCalledTimes(1)
  })

  it('a cancelled pointer puts the width back and writes nothing; a capture taken away keeps what is shown', () => {
    const p = inRow(<Panel {...COURSES}>x</Panel>)
    press(p.handle(), 200); move(p.handle(), 300)
    fireEvent.pointerCancel(p.handle(), { pointerId: 1 })
    expect([p.size(), localStorage.getItem(KEY), resizing()]).toEqual(['200px', null, false])
    press(p.handle(), 200); move(p.handle(), 260)
    fireEvent.lostPointerCapture(p.handle(), { pointerId: 1 })
    expect([p.size(), localStorage.getItem(KEY), resizing()]).toEqual(['260px', '260', false])
  })

  it('another pointer, or a button other than the first, starts nothing', () => {
    const p = inRow(<Panel {...COURSES}>x</Panel>)
    press(p.handle(), 200, { button: 2 })
    expect(resizing()).toBe(false)
    press(p.handle(), 200, { isPrimary: false })
    expect(resizing()).toBe(false)
    press(p.handle(), 200)
    fireEvent.pointerMove(p.handle(), { pointerId: 2, clientX: 400 })
    expect(p.size()).toBe('200px')
    lift(p.handle(), 200)
  })

  it('an unmount mid-drag (Ctrl/Cmd+\\ collapses O.T.T.E.R.\'s) hands the page back its cursor and its Escape', () => {
    const fieldKeys = vi.fn()
    const p = inRow(<Panel {...COURSES}>x</Panel>)
    press(p.handle(), 200); move(p.handle(), 300)
    expect(resizing()).toBe(true)
    p.unmount()
    expect(resizing()).toBe(false)
    const field = document.createElement('input')
    field.addEventListener('keydown', fieldKeys)
    document.body.appendChild(field)
    key(field, 'Escape')
    expect(fieldKeys).toHaveBeenCalledTimes(1)
    field.remove()
  })

  it('keys: the arrows ±8, with Shift ±40, Home and End the limits, each press written and clamped', () => {
    const p = inRow(<Panel {...COURSES}>x</Panel>)
    const h = p.handle()
    const seq = []
    for (const [k, init] of [['ArrowRight'], ['ArrowRight', { shiftKey: true }], ['ArrowLeft'], ['End'], ['ArrowRight'], ['Home'], ['ArrowLeft'], ['ArrowLeft', { shiftKey: true }]]) {
      expect(key(h, k, init), k).toBe(false)
      seq.push([p.now(), localStorage.getItem(KEY)])
    }
    expect(seq).toEqual([[208, '208'], [248, '248'], [240, '240'], [480, '480'], [480, '480'], [180, '180'], [180, '180'], [180, '180']])
    expect(p.size()).toBe('180px')
  })

  it('Enter, Space, Tab, the up and down arrows and a modified arrow change nothing and are not prevented', () => {
    const p = inRow(<Panel {...COURSES}>x</Panel>)
    for (const [k, init] of [['Enter'], [' '], ['Tab'], ['ArrowUp'], ['ArrowDown'], ['ArrowLeft', { altKey: true }], ['ArrowRight', { ctrlKey: true }], ['ArrowRight', { metaKey: true }]]) {
      expect(key(p.handle(), k, init), k).toBe(true)
    }
    expect([p.now(), localStorage.getItem(KEY)]).toEqual([200, null])
  })

  it('a key landing on the token removes the key rather than writing it', () => {
    localStorage.setItem(KEY, '192')
    const p = inRow(<Panel {...COURSES}>x</Panel>)
    key(p.handle(), 'ArrowRight')
    expect([p.now(), localStorage.getItem(KEY)]).toEqual([200, null])
  })

  it('a double-click returns the token\'s width and removes the key (it does not write "200")', () => {
    localStorage.setItem(KEY, '320')
    const p = inRow(<Panel {...COURSES}>x</Panel>)
    expect(p.now()).toBe(320)
    fireEvent.doubleClick(p.handle())
    expect([p.size(), p.now(), localStorage.getItem(KEY)]).toEqual(['200px', 200, null])
  })

  it('remembered: a stored width is the first render\'s; not a number is the token; out of range is clamped into it', () => {
    const cases = [['320', 320], ['abc', 200], ['', 200], [' ', 200], ['9999', 480], ['40', 180], ['262.6', 263]]
    for (const [stored, shown] of cases) {
      localStorage.setItem(KEY, stored)
      const p = inRow(<Panel {...COURSES}>x</Panel>)
      expect([stored, p.now(), p.size()]).toEqual([stored, shown, `${shown}px`])
      p.unmount()
    }
  })

  it('the row keeps what it needs: at 1024 O.T.T.E.R.\'s widest is 304, a stored 480 shows 304 and is kept, and returns at 1280', () => {
    const ro = stubResizeObserver()
    localStorage.setItem(KEY, '480')
    const p = inRow(<Panel {...COURSES}>x</Panel>, 1024)
    expect([p.max(), p.now(), p.size(), localStorage.getItem(KEY)]).toEqual([304, 304, '304px', '480'])
    p.setRow(1280); ro.fire()
    expect([p.max(), p.now(), p.size()]).toEqual([480, 480, '480px'])
    p.setRow(1100); ro.fire()
    expect([p.max(), p.now()]).toEqual([380, 380])
  })

  it('never under the token: an untouched panel in a row of 800 is 200, and so is its widest; a row of 0 trims nothing', () => {
    const p = inRow(<Panel {...COURSES}>x</Panel>, 800)
    expect([p.max(), p.now()]).toEqual([200, 200])
    p.unmount()
    localStorage.setItem(KEY, '480')
    const q = inRow(<Panel {...COURSES}>x</Panel>, 0)
    expect([q.max(), q.now()]).toEqual([480, 480])
  })

  it('Escape after the window narrowed mid-drag puts back the width drawn now, not the one at the press', () => {
    const ro = stubResizeObserver()
    localStorage.setItem(KEY, '480')
    const p = inRow(<Panel {...COURSES}>x</Panel>, 1280)
    press(p.handle(), 480); move(p.handle(), 400)
    expect(p.size()).toBe('400px')
    p.setRow(1024); ro.fire()
    key(document.body, 'Escape')
    expect([p.size(), p.now(), localStorage.getItem(KEY)]).toEqual(['304px', 304, '480'])
  })

  it('a drag and End stop at the row\'s widest', () => {
    const p = inRow(<Panel {...COURSES}>x</Panel>, 1024)
    press(p.handle(), 200); move(p.handle(), 900); lift(p.handle(), 900)
    expect([p.now(), localStorage.getItem(KEY)]).toEqual([304, '304'])
    key(p.handle(), 'Home'); key(p.handle(), 'End')
    expect(p.now()).toBe(304)
  })

  it('when storage throws, a width chosen still comes back to a Panel mounted again (a collapsed sidebar reopened)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    const own = { ...COURSES, storageKey: 'sb1.panel.test.throws' }
    const p = inRow(<Panel {...own}>x</Panel>)
    press(p.handle(), 200); move(p.handle(), 300); lift(p.handle(), 300)
    p.unmount()
    const q = inRow(<Panel {...own}>x</Panel>)
    expect(q.now()).toBe(300)
    fireEvent.doubleClick(q.handle())
    q.unmount()
    expect(inRow(<Panel {...own}>x</Panel>).now()).toBe(200)
  })

  it('a width token outside minWidth / maxWidth says so in dev', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    inRow(<Panel width="sm" resizable storageKey={KEY} minWidth={240} maxWidth={480}>x</Panel>)
    expect(spy).toHaveBeenCalled()
  })

  // ── Review round 1 (Opus): what the tests above could not see ────────────
  it('the press takes the pointer (so a fast flick still drags) and every end hands it back', () => {
    const cap = stubPointerCapture()
    try {
      const p = inRow(<Panel {...COURSES}>x</Panel>)
      press(p.handle(), 200)
      expect(cap.set).toHaveBeenCalledWith(1)
      move(p.handle(), 260)
      key(document.body, 'Escape')
      expect(cap.release).toHaveBeenCalledWith(1)
      press(p.handle(), 200); move(p.handle(), 260); lift(p.handle(), 260)
      expect(cap.release).toHaveBeenCalledTimes(2)
      expect(cap.set).toHaveBeenCalledTimes(2)
    } finally { cap.restore() }
  })

  it('another pointer\'s release or lost capture ends nothing; a second press mid-drag starts nothing', () => {
    const p = inRow(<Panel {...COURSES}>x</Panel>)
    const adds = vi.spyOn(window, 'addEventListener')
    press(p.handle(), 200); move(p.handle(), 260)
    fireEvent.pointerUp(p.handle(), { pointerId: 2, clientX: 400 })
    fireEvent.lostPointerCapture(p.handle(), { pointerId: 2 })
    press(p.handle(), 400, { pointerId: 2 })
    expect([resizing(), localStorage.getItem(KEY)]).toEqual([true, null])
    expect(adds.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1)
    move(p.handle(), 280); lift(p.handle(), 280)
    expect([p.now(), localStorage.getItem(KEY), resizing()]).toEqual([280, '280', false])
  })

  it('a travel of exactly 3px is a drag; a finger needs 8 (a tap wanders), then follows exactly', () => {
    const p = inRow(<Panel {...COURSES}>x</Panel>)
    press(p.handle(), 200); move(p.handle(), 203)
    expect(p.size()).toBe('203px')
    lift(p.handle(), 203)
    press(p.handle(), 203, { pointerType: 'touch' }); move(p.handle(), 210)
    expect(p.size()).toBe('203px')
    move(p.handle(), 211)
    expect(p.size()).toBe('211px')
    lift(p.handle(), 211)
    expect(localStorage.getItem(KEY)).toBe('211')
  })

  it('a fractional pointer draws and keeps whole pixels', () => {
    const p = inRow(<Panel {...COURSES}>x</Panel>)
    press(p.handle(), 200); move(p.handle(), 230.4); lift(p.handle(), 230.4)
    expect([p.size(), p.now(), localStorage.getItem(KEY)]).toEqual(['230px', 230, '230'])
  })

  it('at a width trimmed to the row, a drag and the arrows start from what is shown, not from what is kept', () => {
    localStorage.setItem(KEY, '480')
    const p = inRow(<Panel {...COURSES}>x</Panel>, 1024)
    press(p.handle(), 304); move(p.handle(), 284); lift(p.handle(), 284)
    expect([p.now(), localStorage.getItem(KEY)]).toEqual([284, '284'])
    localStorage.setItem(KEY, '480')
    p.unmount()
    const q = inRow(<Panel {...COURSES}>x</Panel>, 1024)
    key(q.handle(), 'ArrowLeft')
    expect([q.now(), localStorage.getItem(KEY)]).toEqual([296, '296'])
  })

  it('at a width trimmed to the row, a press that cannot widen it keeps the width kept, so it returns when the window grows', () => {
    const ro = stubResizeObserver()
    localStorage.setItem(KEY, '480')
    const p = inRow(<Panel {...COURSES}>x</Panel>, 1024)
    expect(key(p.handle(), 'ArrowRight')).toBe(false)
    key(p.handle(), 'End')
    press(p.handle(), 304); move(p.handle(), 344); lift(p.handle(), 344)
    expect([p.now(), localStorage.getItem(KEY)]).toEqual([304, '480'])
    p.setRow(1440); ro.fire()
    expect(p.now()).toBe(480)
  })

  it('a window narrowed mid-drag holds the drag to the new widest, and that is what is kept', () => {
    const ro = stubResizeObserver()
    const p = inRow(<Panel {...COURSES}>x</Panel>, 1280)
    press(p.handle(), 200); move(p.handle(), 400)
    expect(p.size()).toBe('400px')
    p.setRow(1024); ro.fire()
    move(p.handle(), 440)
    expect([p.size(), p.now()]).toEqual(['304px', 304])
    lift(p.handle(), 440)
    expect(localStorage.getItem(KEY)).toBe('304')
  })

  it('the row\'s observer goes with the panel', () => {
    const ro = stubResizeObserver()
    const p = inRow(<Panel {...COURSES}>x</Panel>, 1280)
    expect(ro.live()).toBe(1)
    p.unmount()
    expect(ro.live()).toBe(0)
  })

  it('when storage refuses a write but holds an older width, the newer width kept in memory wins', () => {
    const own = { ...COURSES, storageKey: 'sb1.panel.test.stale' }
    localStorage.setItem(own.storageKey, '250')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    const p = inRow(<Panel {...own}>x</Panel>)
    press(p.handle(), 250); move(p.handle(), 300); lift(p.handle(), 300)
    p.unmount()
    expect(inRow(<Panel {...own}>x</Panel>).now()).toBe(300)
  })

  // ── Review round 2 (Opus) ─────────────────────────────────────────────────
  it('a window narrowed mid-drag holds the drag at once, with no move after it, and the release keeps that', () => {
    const ro = stubResizeObserver()
    const p = inRow(<Panel {...COURSES}>x</Panel>, 1280)
    press(p.handle(), 200); move(p.handle(), 400)
    p.setRow(1024); ro.fire()
    expect([p.size(), p.now(), p.max()]).toEqual(['304px', 304, 304])
    lift(p.handle(), 400)
    expect([p.size(), localStorage.getItem(KEY)]).toEqual(['304px', '304'])
  })

  it('a window that grows mid-drag leaves the drag where it is: React\'s wider width never lands over it', () => {
    const ro = stubResizeObserver()
    localStorage.setItem(KEY, '480')
    const p = inRow(<Panel {...COURSES}>x</Panel>, 1024)
    press(p.handle(), 304); move(p.handle(), 204)
    expect(p.size()).toBe('204px')
    p.setRow(1440); ro.fire()
    expect([p.size(), p.now()]).toEqual(['204px', 204])
    lift(p.handle(), 204)
    expect([p.size(), localStorage.getItem(KEY)]).toEqual(['204px', '204'])
  })

  it('a press that has not moved follows the width drawn when the window changes, starts from it, and a release writes nothing', () => {
    const ro = stubResizeObserver()
    localStorage.setItem(KEY, '480')
    const p = inRow(<Panel {...COURSES}>x</Panel>, 1024)
    press(p.handle(), 304)
    p.setRow(1440); ro.fire()
    expect(p.size()).toBe('480px')
    lift(p.handle(), 304)
    expect([p.size(), localStorage.getItem(KEY)]).toEqual(['480px', '480'])
    p.setRow(1024); ro.fire()
    press(p.handle(), 304)
    p.setRow(1440); ro.fire()
    move(p.handle(), 284)
    expect(p.size()).toBe('460px')
    lift(p.handle(), 284)
    expect(localStorage.getItem(KEY)).toBe('460')
  })

  it('one write storage refused does not shadow the next it accepts', () => {
    const own = { ...COURSES, storageKey: 'sb1.panel.test.once' }
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('quota') })
    const p = inRow(<Panel {...own}>x</Panel>)
    press(p.handle(), 200); move(p.handle(), 300); lift(p.handle(), 300)
    press(p.handle(), 300); move(p.handle(), 320); lift(p.handle(), 320)
    expect(localStorage.getItem(own.storageKey)).toBe('320')
    p.unmount()
    expect(inRow(<Panel {...own}>x</Panel>).now()).toBe(320)
  })

  it('with neither a title nor aria-labelledby, the separator takes the panel\'s aria-label', () => {
    render(<Panel width="md" aria-label="Pages" resizable storageKey={KEY} minWidth={160} maxWidth={480}>x</Panel>)
    expect(screen.getByRole('separator', { name: 'Pages' })).toBeTruthy()
  })
})

// ── The handle's sheet (src/index.css, the Panel block) ─────────────────────
// jsdom resolves no stylesheet, so the strip's place, its size, its stacking,
// its band and its reduced-motion entry are pinned on the source, read rule by
// rule through scripts/ui-css-rules.mjs (nested at-rules included). What a
// source scan cannot hold (that the band shows after 200ms, that the strip
// sits over the line) was measured in Chromium (the SB1 hand-off).
const KIT = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8').replace(/\r\n/g, '\n')

function handleSheetProblems(css) {
  const rules = allRules(css)
  const out = []
  const at = (r, wrapper) => r.parents.some((p) => p.startsWith(wrapper))
  const plain = (r) => !r.parents.some((p) => p.startsWith('@media'))
  const declsOf = (sel, keep = () => true) => Object.fromEntries(rules.filter((r) => splitTop(r.sel).map((s) => s.trim()).includes(sel) && keep(r)).flatMap((r) => decls(r.body)))
  const want = (label, got, exp) => { for (const [k, v] of Object.entries(exp)) if (got[k] !== v) out.push(`${label} ${k}: ${got[k] ?? 'unset'}, not ${v}`) }

  want('the strip', declsOf('.ui-panel-handle', plain), { position: 'absolute', top: '0', bottom: '0', right: '-6px', width: '8px', 'z-index': '4', cursor: 'col-resize', 'touch-action': 'none', 'user-select': 'none' })
  want('a coarse pointer\'s strip', declsOf('.ui-panel-handle', (r) => at(r, '@media (pointer: coarse)')), { right: '-20px', width: '24px' })
  want('the band', declsOf('.ui-panel-handle::before', plain), { content: "''", position: 'absolute', top: '0', bottom: '0', left: '2px', width: '2px', 'background-color': 'transparent' })
  want('the band\'s fade', declsOf('.ui-panel-handle::before', (r) => at(r, '@media (hover: hover)')), { transition: 'background-color var(--duration-state) ease-out' })
  // Forced colours paint the opaque band as the system's canvas over the line
  // it lights (review round 1, measured): there it is not drawn, under no
  // other condition (round 2: nested in the hover block, a touch screen in
  // High Contrast drew it again).
  want('forced colours\' band', declsOf('.ui-panel-handle::before', (r) => at(r, '@media (forced-colors: active)')), { display: 'none' })
  for (const r of rules.filter((x) => /ui-panel-handle/.test(x.sel) && x.parents.some((p) => p.startsWith('@media (forced-colors')))) {
    const media = r.parents.filter((p) => p.startsWith('@media'))
    if (media.length !== 1) out.push(`the forced-colours rule sits inside ${media.join(' and ')}`)
  }
  want('a coarse pointer\'s band', declsOf('.ui-panel-handle::before', (r) => at(r, '@media (pointer: coarse)')), { left: '4px' })
  // Weightless in :where(), so a tool's own two-class rule on its Panel outranks it.
  want('the panel', declsOf('.ui-panel:where([data-resizable="true"])'), { position: 'relative' })
  for (const w of ['sm', 'md', 'lg']) want(`the ${w} width`, declsOf(`.ui-panel[data-width="${w}"]`), { width: `var(--ui-panel-size, var(--panel-${w}))` })
  want('the body', declsOf('.ui-panel-body'), { '--ui-panel-size': 'initial' })

  // The hover band, only where a pointer hovers, after 200ms.
  const hover = rules.filter((r) => /\.ui-panel-handle:hover/.test(r.sel))
  if (!hover.length) out.push('no hover band')
  for (const r of hover) if (!at(r, '@media (hover: hover)')) out.push(`a hover rule outside @media (hover: hover): ${r.sel}`)
  want('the hover band', declsOf('.ui-panel-handle:hover::before', (r) => at(r, '@media (hover: hover)')), { 'background-color': 'var(--color-signal)', 'transition-delay': 'var(--duration-response)' })
  want('the drag and focus band', declsOf('.ui-panel-handle[data-dragging="true"]::before'), { 'background-color': 'var(--color-signal)', transition: 'none' })
  want('the focus band', declsOf('.ui-panel-handle:focus-visible::before'), { 'background-color': 'var(--color-signal)' })
  want('the focus outline', declsOf('.ui-panel-handle:focus-visible'), { 'outline-color': 'transparent', 'outline-offset': '-2px' })

  // Every rule naming the handle: no outline removed, colours from the band's
  // two tokens only, nothing transitioning a width.
  for (const r of rules.filter((x) => /ui-panel-handle/.test(x.sel))) {
    for (const [p, v] of decls(r.body)) {
      // In forced colours the system's ring is the only focus mark (review round 2).
      if ((p === 'outline' && /none|0/.test(v)) || (p === 'outline-style' && /none|hidden/.test(v)) || (p === 'outline-width' && /^0/.test(v))) out.push(`${r.sel} removes the outline`)
      if (/color$/.test(p) && p !== 'outline-color' && !['transparent', 'var(--color-signal)', 'var(--color-ink-light)'].includes(v)) out.push(`${r.sel} ${p}: ${v}`)
    }
  }
  for (const r of rules.filter((x) => /\.ui-panel(?![-\w])/.test(x.sel))) {
    for (const [p, v] of decls(r.body)) {
      if (p === 'z-index' && !/ui-panel-handle/.test(r.sel)) out.push(`${r.sel} takes a z-index (it would trap the strip)`)
      if (/^transition/.test(p) && /width|all/.test(v)) out.push(`${r.sel} transitions its width`)
    }
  }
  // A drag holds the cursor everywhere, over an inline one too, and selects nothing.
  const page = rules.find((r) => splitTop(r.sel).map((s) => s.trim()).includes('html[data-ui-resizing] *'))
  if (!page) out.push('no page-wide drag rule')
  else {
    if (!/cursor:\s*col-resize\s*!important/.test(page.body)) out.push('the drag cursor is not col-resize !important')
    if (!/user-select:\s*none/.test(page.body)) out.push('a drag can select text')
  }
  // Reduced motion: the band's fade joins the kit's list.
  const reduced = rules.filter((r) => at(r, '@media (prefers-reduced-motion: reduce)') && splitTop(r.sel).map((s) => s.trim()).includes('.ui-panel-handle::before'))
  if (!reduced.some((r) => decls(r.body).some(([p, v]) => p === 'transition-duration' && v === '0.01ms'))) out.push('the band\'s fade is not in the reduced-motion list')
  return out
}

describe('the handle\'s sheet (src/index.css)', () => {
  it('holds every number the design round chose', () => {
    expect(handleSheetProblems(KIT)).toEqual([])
  })

  it('CONTROL: a strip with a width of its own, a narrow or low strip, a panel with a z-index, and a width that transitions are each caught', () => {
    expect(handleSheetProblems(KIT.replace('right: -6px;\n    width: 8px;', 'right: -6px;\n    width: 6px;'))).toContain('the strip width: 6px, not 8px')
    expect(handleSheetProblems(KIT.replace('z-index: 4;', 'z-index: 0;'))).toContain('the strip z-index: 0, not 4')
    expect(handleSheetProblems(`${KIT}\n.ui-panel[data-resizable="true"] { z-index: 1; }`)).toContain('.ui-panel[data-resizable="true"] takes a z-index (it would trap the strip)')
    expect(handleSheetProblems(`${KIT}\n.ui-panel { transition: width 120ms ease-out; }`)).toContain('.ui-panel transitions its width')
    expect(handleSheetProblems(KIT.replace('--ui-panel-size: initial;', ''))).toContain('the body --ui-panel-size: unset, not initial')
    expect(handleSheetProblems(KIT.replace('width: var(--ui-panel-size, var(--panel-md));', 'width: var(--panel-md);'))).toContain('the md width width: var(--panel-md), not var(--ui-panel-size, var(--panel-md))')
  })

  it('CONTROL: a hover band outside @media (hover: hover), without its delay, a removed outline and an ink of its own are each caught', () => {
    expect(handleSheetProblems(`${KIT}\n.ui-panel-handle:hover::before { background-color: var(--color-signal); }`)).toContain('a hover rule outside @media (hover: hover): .ui-panel-handle:hover::before')
    expect(handleSheetProblems(KIT.replace('transition-delay: var(--duration-response);', ''))).toContain('the hover band transition-delay: unset, not var(--duration-response)')
    expect(handleSheetProblems(`${KIT}\n.ui-panel-handle:focus-visible { outline: none; }`)).toContain('.ui-panel-handle:focus-visible removes the outline')
    expect(handleSheetProblems(`${KIT}\n.ui-panel-handle[data-dragging="true"]::before { background-color: #ea580c; }`)).toEqual(expect.arrayContaining(['.ui-panel-handle[data-dragging="true"]::before background-color: #ea580c']))
  })

  it('CONTROL: the focus outline taken away by its style or its width, and the forced-colours rule nested in the hover block, are each caught', () => {
    expect(handleSheetProblems(`${KIT}\n.ui-panel-handle:focus-visible { outline-style: none; }`)).toEqual(['.ui-panel-handle:focus-visible removes the outline'])
    expect(handleSheetProblems(`${KIT}\n.ui-panel-handle:focus-visible { outline-width: 0; }`)).toEqual(['.ui-panel-handle:focus-visible removes the outline'])
    const nested = KIT.replace('  @media (forced-colors: active) {\n    .ui-panel-handle::before { display: none; }\n  }\n', '')
      .replace('    .ui-panel[data-surface="light"] .ui-panel-handle:hover::before { background-color: var(--color-ink-light); }\n', '    .ui-panel[data-surface="light"] .ui-panel-handle:hover::before { background-color: var(--color-ink-light); }\n    @media (forced-colors: active) { .ui-panel-handle::before { display: none; } }\n')
    expect(nested).not.toBe(KIT)
    expect(handleSheetProblems(nested)).toEqual(['the forced-colours rule sits inside @media (hover: hover) and @media (forced-colors: active)'])
  })

  it('CONTROL: a band with no height, no fade, or drawn in forced colours is each caught', () => {
    expect(handleSheetProblems(KIT.replace('    top: 0;\n    bottom: 0;\n    left: 2px;', '    left: 2px;'))).toEqual(['the band top: unset, not 0', 'the band bottom: unset, not 0'])
    expect(handleSheetProblems(KIT.replace('    .ui-panel-handle::before { transition: background-color var(--duration-state) ease-out; }\n', ''))).toEqual(['the band\'s fade transition: unset, not background-color var(--duration-state) ease-out'])
    expect(handleSheetProblems(KIT.replace('    .ui-panel-handle::before { display: none; }\n', ''))).toEqual(['forced colours\' band display: unset, not none'])
  })

  it('CONTROL: the band missing from the reduced-motion list, and a drag cursor without !important, are each caught', () => {
    expect(handleSheetProblems(KIT.replace(/,\s*\.ui-panel-handle::before \{\s*transition-duration: 0\.01ms;/, ' {\n    transition-duration: 0.01ms;'))).toContain('the band\'s fade is not in the reduced-motion list')
    expect(handleSheetProblems(KIT.replace('cursor: col-resize !important;', 'cursor: col-resize;'))).toContain('the drag cursor is not col-resize !important')
  })
})
