/** @vitest-environment jsdom */
// =============================================================================
// D1b's measured case, reproduced — "six Shift+Tabs and Enter switches the
// storage backend under the dialog".
//
// D1b filed this as a kit request against Foundation (its §7, 2026-09-11):
//
//   "`Dialog` should make everything outside itself `inert` while mounted (a
//    portal to `document.body` plus `inert` on its siblings, or a focus trap),
//    and move focus into itself on open. The concrete cost of not doing it,
//    measured: with a Settings confirm open, six Shift+Tabs reach the storage-
//    backend switch and Enter switches the backend under the dialog."
//
// F3 then landed a Tab trap and focus return for C2's KR-5, which is the
// second of the two options D1b named. F4's job was to find out whether that
// actually closes D1b's case or only looks like it — an R1 fix in this repo
// has been an inert guard before — so this file reproduces the case rather
// than restating the trap.
//
// ── Why this simulates the Tab key ──────────────────────────────────────────
// jsdom has no tab navigation at all: dispatching a Tab keydown moves focus
// nowhere, so `fireEvent.keyDown(el, { key: 'Tab' })` six times and then
// asserting focus is still inside the dialog PASSES WITH NO TRAP AT ALL. It
// is the shape of test that cost C3b a screenshot round — green while the
// thing it names is broken.
//
// So `shiftTab()` below does what a browser does, in this order:
//   1. dispatch the keydown and let the real handler see it;
//   2. if the handler called preventDefault, focus stays where the handler
//      put it — that is the trap firing;
//   3. otherwise move focus to the previous focusable element in DOCUMENT
//      order, which is the default action the handler declined to cancel.
// The control below proves the simulator moves focus by walking the same six
// presses with no dialog mounted and landing on the switch.
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { Dialog } from './Dialog'
import { FOCUSABLE, focusableWithin } from './overlay'
import { Switch } from './Switch'
import { Button } from './Button'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8')

afterEach(cleanup)

// 🚨 THE TRAP'S OWN SELECTOR LIST, imported, applied to the whole document so
// the walk can leave the dialog exactly where a browser would. A hand-copied
// subset models a NARROWER browser than the thing under test: the first cut
// here dropped six selectors (`area[href]`, `iframe`, `object`, `embed`,
// `audio`/`video[controls]`, `[contenteditable="true"]`), so a dialog whose
// only focusable child was one of those would have been walked by a simulator
// that could not reach it — the trap would have looked tighter than it is.
const docOrder = () => [...document.querySelectorAll(FOCUSABLE)].filter((el) => {
  if (el.matches(':disabled')) return false
  const ti = el.getAttribute('tabindex')
  if (ti != null && Number(ti) < 0) return false
  if (el.closest('[hidden],[aria-hidden="true"],[inert]')) return false
  return true
})

function shiftTab() {
  const from = document.activeElement
  const ev = new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
  ;(from && from !== document.body ? from : document.body).dispatchEvent(ev)
  if (ev.defaultPrevented) return            // the trap moved focus itself
  const order = docOrder()
  const i = order.indexOf(document.activeElement)
  const next = i <= 0 ? order[order.length - 1] : order[i - 1]
  next?.focus()
}

/**
 * Settings, reduced to the part D1b measured: a tab panel of controls with the
 * storage-backend Switch among them, and a confirm over it. `onBackendChange`
 * is the thing that must never fire while the dialog is up.
 */
function SettingsWithConfirm({ open, onBackendChange }) {
  return (
    <div>
      <div id="page">
        <button type="button">Profile</button>
        <button type="button">Appearance</button>
        <button type="button">Storage</button>
        <input aria-label="Workspace name" defaultValue="Petal" />
        <button type="button">Browse…</button>
        <Switch checked={false} onChange={onBackendChange} label="Use local server" />
        <button type="button">Sign out</button>
      </div>
      {open && (
        <Dialog title="Switch storage backend?" onClose={() => {}}>
          <p>Files already uploaded stay where they are.</p>
          <Button>Cancel</Button>
          <Button variant="primary">Switch</Button>
        </Dialog>
      )}
    </div>
  )
}

const backendSwitch = () => screen.getByRole('switch', { name: 'Use local server' })

describe("D1b's case: a Settings confirm and the storage backend behind it", () => {
  it('CONTROL — with no dialog, six Shift+Tabs really do reach the switch', () => {
    // Without this the whole file could be asserting that nothing happens in
    // a DOM where nothing was ever going to happen. It also pins the "six"
    // in D1b's report to this geometry rather than to a remembered number.
    const onBackendChange = vi.fn()
    render(<SettingsWithConfirm open={false} onBackendChange={onBackendChange} />)
    screen.getByRole('button', { name: 'Sign out' }).focus()

    let reached = false
    for (let i = 0; i < 6; i++) {
      shiftTab()
      if (document.activeElement === backendSwitch()) reached = true
    }
    expect(reached, 'the simulator never moved focus to the switch').toBe(true)

    // …and Enter on it switches the backend, which is the damage.
    fireEvent.click(backendSwitch())
    expect(onBackendChange).toHaveBeenCalledWith(true)
  })

  it('with the dialog open, six Shift+Tabs never leave it', () => {
    const onBackendChange = vi.fn()
    const { container } = render(<SettingsWithConfirm open onBackendChange={onBackendChange} />)
    const surface = container.querySelector('.ui-dialog')
    expect(surface, 'no dialog surface').not.toBeNull()

    // F3's other half: focus moves INTO the dialog on open, so the walk starts
    // where a real user's would.
    expect(surface.contains(document.activeElement)).toBe(true)

    for (let i = 0; i < 6; i++) {
      shiftTab()
      expect(surface.contains(document.activeElement), `escaped on press ${i + 1}`).toBe(true)
      expect(document.activeElement).not.toBe(backendSwitch())
    }
    expect(onBackendChange).not.toHaveBeenCalled()
  })

  it('forward Tab does not leak either — the trap has two ends', () => {
    const onBackendChange = vi.fn()
    const { container } = render(<SettingsWithConfirm open onBackendChange={onBackendChange} />)
    const surface = container.querySelector('.ui-dialog')
    for (let i = 0; i < 8; i++) {
      const from = document.activeElement
      const ev = new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      ;(from && from !== document.body ? from : document.body).dispatchEvent(ev)
      if (!ev.defaultPrevented) {
        const order = docOrder()
        const at = order.indexOf(document.activeElement)
        order[at === -1 || at === order.length - 1 ? 0 : at + 1]?.focus()
      }
      expect(surface.contains(document.activeElement), `escaped forward on press ${i + 1}`).toBe(true)
    }
  })

  it('gives focus back to the control that opened it', () => {
    // The other half of D1b's ask. Without it the keyboard user is returned to
    // <body> and has to walk the page from the top to get back.
    const onBackendChange = vi.fn()
    const { rerender } = render(<SettingsWithConfirm open={false} onBackendChange={onBackendChange} />)
    const opener = screen.getByRole('button', { name: 'Storage' })
    opener.focus()
    rerender(<SettingsWithConfirm open onBackendChange={onBackendChange} />)
    expect(document.activeElement).not.toBe(opener)
    rerender(<SettingsWithConfirm open={false} onBackendChange={onBackendChange} />)
    expect(document.activeElement).toBe(opener)
  })

  it('CONTROL — the trap is what does it, not the DOM happening to be empty', () => {
    // If `.ui-dialog` held nothing focusable the assertions above would pass
    // for the wrong reason, and the page behind really does hold seven
    // controls for focus to escape onto.
    const { container } = render(<SettingsWithConfirm open onBackendChange={() => {}} />)
    const inside = [...container.querySelectorAll('.ui-dialog ' + FOCUSABLE)]
    expect(inside.length).toBeGreaterThan(1)
    const behind = [...container.querySelectorAll('#page ' + FOCUSABLE)]
    expect(behind.length).toBeGreaterThanOrEqual(7)
    // And the walk is a real walk: with the trap's handler removed from the
    // equation — a plain Shift+Tab from a node the dialog does not contain —
    // focus moves. This is the default action the trap cancels.
    behind[0].focus()
    const before = document.activeElement
    const order = docOrder()
    const i = order.indexOf(before)
    order[i <= 0 ? order.length - 1 : i - 1].focus()
    expect(document.activeElement).not.toBe(before)
  })

  // D1b asked for everything outside the dialog to be UNREACHABLE, which is
  // three routes, not one. The Tab key is the one it measured and the one the
  // trap closes; these are the other two, closed already and asserted here so
  // "unreachable" is not left as a claim about Tab alone.
  it('closes the pointer route: the backdrop covers the viewport', () => {
    const rule = css.slice(css.indexOf('.ui-dialog-backdrop {'), css.indexOf('}', css.indexOf('.ui-dialog-backdrop {')))
    expect(rule).toContain('position: fixed')
    expect(rule).toContain('inset: 0')
    render(<SettingsWithConfirm open onBackendChange={() => {}} />)
    // …and the dialog is inside it, so nothing behind is on top of it.
    const backdrop = document.querySelector('.ui-dialog-backdrop')
    expect(backdrop.contains(document.querySelector('.ui-dialog'))).toBe(true)
  })

  it('closes the assistive-technology route: role=dialog with aria-modal', () => {
    render(<SettingsWithConfirm open onBackendChange={() => {}} />)
    const d = screen.getByRole('dialog')
    expect(d.getAttribute('aria-modal')).toBe('true')
    // Which is why `inert` on the siblings — D1b's other suggested fix — is
    // not needed: `aria-modal` is what tells AT the rest of the page is out,
    // and the trap is what holds the Tab key. `inert` would need a portal to
    // <body>, and Q17 ruled the Dialog to Escape, the stack and the busy lock.
    expect(d.closest('.ui-dialog-backdrop')).not.toBeNull()
  })
})

// =============================================================================
// B4c review round two: a scrolling list with nothing in it to focus.
//
// Chromium 130 (Electron 33) makes such a list a Tab stop of its own — a
// "keyboard-focusable scroller" — and the trap did not know it: focus on the
// list was index -1, so forward Tab wrapped to ✕, and ✕ → list → ✕ looped with
// the footer out of reach (measured, RelinkDialog's 14 missing files).
//
// jsdom has no layout, so the scroller is MODELLED, on the one element:
// `scrollHeight` over `clientHeight` and `overflow-y: auto` from
// getComputedStyle (stubbed), and focus on it held by overriding
// `document.activeElement` — jsdom focuses no <div> without a tabindex, and
// the active element is all the trap reads. The browser's Tab order is
// modelled by its measured rule, not by the function under test: every
// control, plus each modelled scroller that holds no control.
// =============================================================================

describe('a list that scrolls and holds no control is a Tab stop, as the browser makes it', () => {
  afterEach(() => { vi.restoreAllMocks(); delete document.activeElement })

  const ROWS = Array.from({ length: 14 }, (_, i) => `A003_C${String(i).padStart(3, '0')}_harbour_take.mov`)
  function ListDialog({ withButton = false }) {
    return (
      <Dialog
        title="Relink missing files"
        onClose={() => {}}
        footer={<><Button>Cancel</Button><Button variant="primary">Choose folder…</Button></>}
      >
        <p>These files are missing.</p>
        <div data-testid="list">
          {ROWS.map((name) => <div key={name}>{name}</div>)}
          {withButton && <button type="button">Show all</button>}
        </div>
      </Dialog>
    )
  }

  /** The list, laid out: `clientHeight` 160 and `scrollHeight` as given, and
      the computed overflow its rule would give. Only the list is stubbed;
      every other element keeps jsdom's own style (read before any stub, so a
      second lay-out does not call the first). */
  const realStyle = window.getComputedStyle.bind(window)
  function layOut(list, { scrollHeight = 332, clientHeight = 160, overflowY = 'auto' } = {}) {
    Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => scrollHeight })
    Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => clientHeight })
    vi.restoreAllMocks()
    return vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => (
      el === list ? { overflowX: 'hidden', overflowY } : realStyle(el, pseudo)))
  }

  /** The browser's stops: every control, and each scroller in `scrollers`
      that holds none (the rule measured in Electron 33), in document order. */
  const browserStops = (scrollers) => {
    const stops = docOrder()
    for (const s of scrollers) if (!stops.some((c) => s.contains(c))) stops.push(s)
    return stops.sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1))
  }
  /** Focus as the browser gives it: a control takes it; a scroller, which
      jsdom will not focus, is parked as the active element. */
  function focusOn(el, scrollers) {
    delete document.activeElement
    if (!scrollers.includes(el)) { el.focus(); return }
    document.activeElement?.blur?.()
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => el })
  }
  /** One press: the trap sees the keydown; if it did not take the key, the
      browser's default moves focus one stop along its own order. */
  function press(scrollers, { shiftKey = false } = {}) {
    const from = document.activeElement
    const ev = new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
    ;(from && from !== document.body ? from : document.body).dispatchEvent(ev)
    if (ev.defaultPrevented) { delete document.activeElement; return }   // the trap moved real focus
    const order = browserStops(scrollers)
    const i = order.indexOf(document.activeElement)
    const n = order.length
    focusOn(shiftKey ? order[i <= 0 ? n - 1 : i - 1] : order[i === -1 || i === n - 1 ? 0 : i + 1], scrollers)
  }
  const name = (el) => (el?.getAttribute('data-testid') || el?.getAttribute('aria-label') || el?.textContent || '').trim()

  it('forward Tab from the list reaches the next control, and Shift+Tab from it reaches ✕ — the loop is gone', () => {
    render(<ListDialog />)
    const list = screen.getByTestId('list')
    layOut(list)
    const surface = screen.getByRole('dialog')
    const close = screen.getByRole('button', { name: 'Close' })
    // The kit lists it where the browser stops on it: after ✕, before the footer.
    expect(focusableWithin(surface).map(name)).toEqual(['Close', 'list', 'Cancel', 'Choose folder…'])
    expect(document.activeElement).toBe(close)
    const stops = []
    for (let i = 0; i < 5; i++) { press([list]); stops.push(name(document.activeElement)) }
    // Before: list, Close, list, Close, list.
    expect(stops).toEqual(['list', 'Cancel', 'Choose folder…', 'Close', 'list'])
    // Shift+Tab from the list goes back to ✕ (before: it jumped to the last
    // footer button, the trap reading -1 as "the first stop").
    press([list], { shiftKey: true })
    expect(document.activeElement).toBe(close)
  })

  it('a list that fits stays out: not listed, and Tab goes from ✕ to the footer', () => {
    render(<ListDialog />)
    const list = screen.getByTestId('list')
    const style = layOut(list, { scrollHeight: 160 })
    expect(focusableWithin(screen.getByRole('dialog')).map(name)).toEqual(['Close', 'Cancel', 'Choose folder…'])
    // Its style is never read: an element that does not overflow is decided
    // by two integer comparisons.
    expect(style.mock.calls.some(([el]) => el === list)).toBe(false)
    press([])
    expect(name(document.activeElement)).toBe('Cancel')
    // …and so does one that overflows where the rule clips (`hidden`).
    layOut(list, { overflowY: 'hidden' })
    expect(focusableWithin(screen.getByRole('dialog'))).not.toContain(list)
  })

  it('a list with a button inside stays out: the button takes the stop', () => {
    render(<ListDialog withButton />)
    const list = screen.getByTestId('list')
    layOut(list)
    expect(focusableWithin(screen.getByRole('dialog')).map(name)).toEqual(['Close', 'Show all', 'Cancel', 'Choose folder…'])
    const stops = []
    for (let i = 0; i < 3; i++) { press([list]); stops.push(name(document.activeElement)) }
    expect(stops).toEqual(['Show all', 'Cancel', 'Choose folder…'])
  })

  it('a row at tabindex -1 does not keep the list out, and a list at tabindex -1 is out (measured in Electron 33)', () => {
    render(<ListDialog />)
    const list = screen.getByTestId('list')
    layOut(list)
    // A row that can take focus but not the Tab key: Chromium still stops on the list.
    list.firstElementChild.setAttribute('tabindex', '-1')
    expect(focusableWithin(screen.getByRole('dialog')).map(name)).toEqual(['Close', 'list', 'Cancel', 'Choose folder…'])
    // The list itself at -1: out, as any element at -1 is.
    list.setAttribute('tabindex', '-1')
    expect(focusableWithin(screen.getByRole('dialog'))).not.toContain(list)
  })
})
