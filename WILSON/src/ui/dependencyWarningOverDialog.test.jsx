/** @vitest-environment jsdom */
// =============================================================================
// A-R1-02's measured case, reproduced — "with the popup underneath, 24 Tabs
// visited only Notes, Close and the status select, and never Go back or
// Continue anyway".
//
// The Phase 7 status warning (Track A's DependencyStatusGuard) is raised from
// TaskDetailPopup and the asset popup, which the overhaul made kit Dialogs
// with a Tab trap owned by the TOP of overlay.js's modal stack. Merged without
// a registration on that stack, the warning left the popup on top: Tab stayed
// inside the popup, behind the warning's backdrop, and a keyboard user could
// press Escape (cancel) but never reach "Continue anyway" — the warning that
// is "not a block" was one. The fix registers the warning on the stack, takes
// focus to "Go back", keeps Tab inside the card and gives focus back on close.
// This file walks it over a real kit Dialog, with the controls that make the
// walk mean something.
//
// ── Why this simulates the Tab key ──────────────────────────────────────────
// jsdom has no tab navigation (dialogTrap.test.jsx's reasoning, verbatim): a
// Tab keydown moves focus nowhere, so a test that only dispatches it PASSES
// WITH NO TRAP AT ALL. `press()` below does what a browser does: dispatch the
// keydown; if a handler called preventDefault, focus stays where the handler
// put it; otherwise move focus to the next focusable element in DOCUMENT
// order — the trap's own selector list, applied to the whole document (the
// warning's portal lands in <body>), so the walk can leave a dialog exactly
// where a browser would.
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { Dialog } from './Dialog'
import { Button } from './Button'
import { FOCUSABLE, _resetOverlaysForTests, modalDepth } from './overlay'
import { DependencyStatusWarningModal } from '../tools/rabbit_v0.1.0/components/DependencyStatusGuard'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8')

afterEach(() => { cleanup(); _resetOverlaysForTests() })

// The trap's own selector list, imported (dialogTrap.test.jsx: a hand-copied
// subset models a narrower browser than the thing under test).
const docOrder = () => [...document.querySelectorAll(FOCUSABLE)].filter((el) => {
  if (el.matches(':disabled')) return false
  const ti = el.getAttribute('tabindex')
  if (ti != null && Number(ti) < 0) return false
  if (el.closest('[hidden],[aria-hidden="true"],[inert]')) return false
  return true
})

/** One press: the handlers see the keydown; if none took the key, the
    browser's default moves focus one stop along the document order. */
function press({ shiftKey = false } = {}) {
  const from = document.activeElement
  const ev = new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
  ;(from && from !== document.body ? from : document.body).dispatchEvent(ev)
  if (ev.defaultPrevented) return            // a trap moved focus itself
  const order = docOrder()
  const i = order.indexOf(document.activeElement)
  const n = order.length
  ;(shiftKey ? order[i <= 0 ? n - 1 : i - 1] : order[i === -1 || i === n - 1 ? 0 : i + 1])?.focus()
}

const name = (el) => (el?.getAttribute('aria-label') || el?.textContent || '').trim()
const walk = (n, opts) => {
  const seen = []
  for (let i = 0; i < n; i++) { press(opts); seen.push(name(document.activeElement)) }
  return seen
}

/** One offender over one unfinished predecessor — the single-item warning. */
const WARNING = {
  kind: 'task',
  toStatus: 'approved',
  total: 1,
  offenders: [{ item: { id: 't2', title: 'Comp' }, unfinished: [{ id: 't1', title: 'Animation', status: 'in_progress' }] }],
}

/** TaskDetailPopup, reduced to what the case needs: the guard's modal as a
    sibling of the kit Dialog (the popup's own shape — `{guard.modal}` then
    `<Dialog>`), the Dialog holding a notes field, the status select that
    raises the warning and a footer button; a page control behind both. */
function Popup({ warning, onCancel, onContinue, onClose }) {
  return (
    <div>
      <div id="page"><button type="button">Open task</button></div>
      <DependencyStatusWarningModal warning={warning} onCancel={onCancel} onContinue={onContinue} />
      <Dialog title="Comp" onClose={onClose} footer={<Button variant="primary">Save</Button>}>
        <textarea aria-label="Notes" defaultValue="" />
        <select aria-label="Status" defaultValue="in_progress">
          <option value="in_progress">In progress</option>
          <option value="approved">Approved</option>
        </select>
      </Dialog>
    </div>
  )
}

const statusSelect = () => screen.getByLabelText('Status')
const card = () => screen.getByRole('dialog', { name: 'Unfinished dependencies' })
const noop = () => {}

describe("A-R1-02's case: the Phase 7 warning raised over a kit Dialog", () => {
  it('CONTROL — the warning alone: Tab reaches Continue anyway, so the walk is a real walk', () => {
    render(
      <>
        <div id="page"><button type="button">Open task</button></div>
        <DependencyStatusWarningModal warning={WARNING} onCancel={noop} onContinue={noop} />
      </>,
    )
    expect(walk(6)).toContain('Continue anyway')
  })

  it('CONTROL — the Dialog alone holds Tab inside itself: that trap is what stood between the keyboard and the warning', () => {
    render(<Popup warning={null} onCancel={noop} onContinue={noop} onClose={noop} />)
    const surface = document.querySelector('.ui-dialog')
    expect(surface.contains(document.activeElement)).toBe(true)
    const seen = walk(6)
    expect(seen).toContain('Save')
    expect(seen).not.toContain('Open task')
  })

  it('over the Dialog: focus lands on Go back, and Tab reaches Continue anyway without ever leaving the warning', () => {
    const onCancel = vi.fn(), onContinue = vi.fn(), onClose = vi.fn()
    const { rerender } = render(<Popup warning={null} onCancel={onCancel} onContinue={onContinue} onClose={onClose} />)
    // The status select raises the warning, so it has focus when the warning
    // mounts — as it does in the popup.
    statusSelect().focus()
    rerender(<Popup warning={WARNING} onCancel={onCancel} onContinue={onContinue} onClose={onClose} />)
    const surface = card()
    expect(name(document.activeElement)).toBe('Go back')
    // Both are on the stack; the warning is on top, so the Dialog stands down.
    expect(modalDepth()).toBe(2)

    const seen = []
    for (let i = 0; i < 8; i++) {
      press()
      seen.push(name(document.activeElement))
      expect(surface.contains(document.activeElement), `left the warning on press ${i + 1}`).toBe(true)
    }
    expect(seen).toContain('Continue anyway')
    expect(seen).toContain('Close without saving')
    expect(seen).not.toContain('Notes')
    expect(seen).not.toContain('Status')
    expect(seen).not.toContain('Save')
    // …and the trap has two ends.
    for (let i = 0; i < 8; i++) {
      press({ shiftKey: true })
      expect(surface.contains(document.activeElement), `left the warning on Shift+Tab ${i + 1}`).toBe(true)
    }
    expect(onContinue).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('Escape cancels the warning and leaves the popup open — the ruling, with the Dialog standing down', () => {
    const onCancel = vi.fn(), onContinue = vi.fn(), onClose = vi.fn()
    const { rerender } = render(<Popup warning={null} onCancel={onCancel} onContinue={onContinue} onClose={onClose} />)
    statusSelect().focus()
    rerender(<Popup warning={WARNING} onCancel={onCancel} onContinue={onContinue} onClose={onClose} />)
    const ev = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.activeElement.dispatchEvent(ev)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(onContinue).not.toHaveBeenCalled()
  })

  it('gives focus back to the control that raised it, and the popup is top again', () => {
    const { rerender } = render(<Popup warning={null} onCancel={noop} onContinue={noop} onClose={noop} />)
    statusSelect().focus()
    rerender(<Popup warning={WARNING} onCancel={noop} onContinue={noop} onClose={noop} />)
    expect(document.activeElement).not.toBe(statusSelect())
    rerender(<Popup warning={null} onCancel={noop} onContinue={noop} onClose={noop} />)
    expect(document.activeElement).toBe(statusSelect())
    expect(modalDepth()).toBe(1)
    // …and the Dialog's trap is back in charge: Tab stays inside it.
    const surface = document.querySelector('.ui-dialog')
    for (let i = 0; i < 4; i++) { press(); expect(surface.contains(document.activeElement)).toBe(true) }
  })

  it("paints over the popup at the kit's own layer: later in <body>, no z override", () => {
    render(<Popup warning={WARNING} onCancel={noop} onContinue={noop} onClose={noop} />)
    const backdrop = card().closest('.ui-dialog-backdrop')
    expect(backdrop.parentNode).toBe(document.body)
    const popup = document.querySelector('.ui-dialog:not(.rb-warn-card)').closest('.ui-dialog-backdrop')
    // The kit paints one dialog over another by DOM order at the one layer;
    // the warning's portal comes after everything the page drew.
    expect(popup.compareDocumentPosition(backdrop) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(backdrop.style.zIndex).toBe('')
    const rule = css.slice(css.indexOf('.ui-dialog-backdrop {'), css.indexOf('}', css.indexOf('.ui-dialog-backdrop {')))
    expect(rule).toMatch(/z-index:\s*70/)
  })
})
