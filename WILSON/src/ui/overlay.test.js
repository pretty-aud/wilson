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
