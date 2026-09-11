/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { overlayOpen, pushModal, popModal, isTopModal, modalDepth, menuOpened, menuClosed, focusableWithin, _resetOverlaysForTests } from './overlay'

describe('overlay: the modal stack and the menu count', () => {
  beforeEach(() => _resetOverlaysForTests())

  it('is closed when nothing is registered', () => {
    expect(overlayOpen()).toBe(false)
    expect(modalDepth()).toBe(0)
  })

  it('only the topmost dialog answers Escape, and unregistering restores the one below', () => {
    const a = {}, b = {}
    const offA = pushModal(a)
    const offB = pushModal(b)
    expect(overlayOpen()).toBe(true)
    expect(isTopModal(b)).toBe(true)
    expect(isTopModal(a)).toBe(false)
    offB()
    expect(isTopModal(a)).toBe(true)
    offA()
    expect(overlayOpen()).toBe(false)
  })

  it('a lower dialog re-registering cannot climb: pop is by identity', () => {
    const a = {}, b = {}
    pushModal(a); pushModal(b)
    popModal(a)
    expect(isTopModal(b)).toBe(true)
    expect(modalDepth()).toBe(1)
    popModal({})            // an unknown id is a no-op
    expect(modalDepth()).toBe(1)
  })

  it('counts menus and never goes negative', () => {
    const off = menuOpened()
    expect(overlayOpen()).toBe(true)
    off()
    menuClosed()
    expect(overlayOpen()).toBe(false)
  })
})

// ── focusableWithin (F3) ────────────────────────────────────────────────────
describe('focusableWithin', () => {
  const mount = (html) => {
    const host = document.createElement('div')
    host.innerHTML = html
    document.body.appendChild(host)
    return host
  }
  afterEach(() => { document.body.innerHTML = '' })

  it('returns the focusable children in DOM order', () => {
    const host = mount(`
      <button id="a">a</button>
      <p>not focusable</p>
      <a id="b" href="#x">b</a>
      <input id="c" />
      <select id="d"></select>
      <textarea id="e"></textarea>
      <div id="f" tabindex="0"></div>
    `)
    expect(focusableWithin(host).map((el) => el.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('skips what cannot take focus: disabled, hidden, aria-hidden, tabindex -1, hidden inputs', () => {
    const host = mount(`
      <button id="keep">keep</button>
      <button id="off" disabled>off</button>
      <button id="gone" hidden>gone</button>
      <button id="silent" aria-hidden="true">silent</button>
      <div id="skip" tabindex="-1"></div>
      <input id="secret" type="hidden" />
      <a id="nohref">no href</a>
    `)
    expect(focusableWithin(host).map((el) => el.id)).toEqual(['keep'])
  })

  it('an ancestor can hide it too — a collapsed section is not tabbable', () => {
    const host = mount(`
      <div hidden><button id="in-hidden">x</button></div>
      <div aria-hidden="true"><button id="in-aria">y</button></div>
      <button id="visible">z</button>
    `)
    expect(focusableWithin(host).map((el) => el.id)).toEqual(['visible'])
  })

  it('🚨 `inert` too — it is the spelling a modal is most likely to meet', () => {
    // `inert` takes a whole subtree out of the tab order, out of hit testing
    // and out of the a11y tree at once, and it is the attribute a caller
    // reaches for to mute a section of a dialog while it saves. A focusable
    // list that keeps those controls makes the trap's `last` an element the
    // browser never reaches, and the wrap stops firing.
    const host = mount(`
      <div inert><button id="muted">x</button><input id="also-muted" /></div>
      <button id="live">y</button>
    `)
    expect(focusableWithin(host).map((el) => el.id)).toEqual(['live'])
    // …and on the element itself, not only an ancestor.
    const own = mount('<button id="a">a</button><button id="b" inert>b</button>')
    expect(focusableWithin(own).map((el) => el.id)).toEqual(['a'])
  })

  it('skips what CSS has hidden, where the environment can tell — and does not need to', () => {
    // `display: none` and `visibility: hidden` take an element out of the tab
    // order, and a Tailwind `hidden` class is the common spelling in this
    // app, so an attribute-only filter puts things in the list the browser
    // will skip and the Dialog trap leaks wherever the two disagree.
    // `checkVisibility` is a FEATURE test: jsdom does not implement it, so
    // this asserts the contract in both directions rather than the result.
    const host = mount('<button id="a">a</button><button id="b">b</button>')
    const b = host.querySelector('#b')
    // 🚨 jsdom does not implement `checkVisibility` — it has no layout — so
    // the branch is driven by STUBBING the API rather than by setting a style
    // that jsdom cannot evaluate. Without this the line is unreachable in
    // every test and the break-it pass says so: reverting it stayed green.
    expect(b.checkVisibility).toBeUndefined()
    const seen = []
    Object.defineProperty(b, 'checkVisibility', {
      value: (opts) => { seen.push(opts); return false },
      configurable: true,
    })
    expect(focusableWithin(host).map((el) => el.id)).toEqual(['a'])

    // 🚨 THE OPTIONS, not just the answer. `visibilityProperty: true` is the
    // half of this that matters — `visibility: hidden` takes an element out
    // of the tab order and the default call would miss it — and
    // `opacityProperty` must stay OFF, because `opacity: 0` is how
    // HoverActions hides row controls WITHOUT untabbing them, which is the
    // dead end Q17(b) exists to fix. A stub that ignores its argument proves
    // only that a stub was called.
    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual({ visibilityProperty: true })
    expect(seen[0].opacityProperty).toBeUndefined()

    // …and an element the environment reports as visible stays in.
    Object.defineProperty(b, 'checkVisibility', { value: () => true, configurable: true })
    expect(focusableWithin(host).map((el) => el.id)).toEqual(['a', 'b'])

    // The control: with no such API at all, the semantic filter stands alone
    // and both are returned, which is what has to happen under the runner.
    delete b.checkVisibility
    expect(focusableWithin(host).map((el) => el.id)).toEqual(['a', 'b'])
  })

  it('🚨 the control: a LAYOUT filter would return nothing here, which is why it is not used', () => {
    // jsdom has no layout engine, so `offsetParent` is null and
    // `getClientRects()` is empty for every element in this file — the
    // obvious visibility filter would make the Dialog trap a no-op in every
    // test that covers it, silently and greenly.
    const host = mount('<button id="a">a</button>')
    const btn = host.querySelector('#a')
    expect(btn.offsetParent).toBe(null)
    expect(btn.getClientRects().length).toBe(0)
    expect(focusableWithin(host)).toEqual([btn])
  })

  it('an empty or absent node is an empty list, never a throw', () => {
    expect(focusableWithin(null)).toEqual([])
    expect(focusableWithin(mount('<p>nothing here</p>'))).toEqual([])
  })
})
