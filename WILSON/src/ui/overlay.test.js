import { describe, it, expect, beforeEach } from 'vitest'
import { overlayOpen, pushModal, popModal, isTopModal, modalDepth, menuOpened, menuClosed, _resetOverlaysForTests } from './overlay'

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
