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
import { Switch } from './Switch'
import { Button } from './Button'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8')

afterEach(cleanup)

// The same selector list the trap itself uses, applied to the whole document
// so the walk can leave the dialog exactly where a browser would.
const FOCUSABLE = 'a[href],button,input:not([type="hidden"]),select,textarea,summary,[tabindex]'
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
