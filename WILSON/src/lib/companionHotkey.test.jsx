/** @vitest-environment jsdom */
// =============================================================================
// A-R2-04 (the Track A merge, review round 2): App's window-level Enter
// handler took the key from the status warning's focused "Go back" button.
//
// Round 1 moved the warning's initial focus onto "Go back" (A-R1-02). App's
// listener cancelled every Enter that was not on a text control while a pet
// existed, and Chromium activates a focused <button> on the keypress that a
// cancelled keydown suppresses — so Enter toggled the pet companion, the
// warning stayed up, and only Space worked its buttons. The fix stands the
// handler down while a kit overlay is up (`overlayOpen()`, which the warning
// registers with) and inside any `[role="dialog"]`.
//
// The handler mounted here is the one App installs (lib/companionHotkey.js),
// over a real warning and a real kit Dialog. jsdom synthesises neither the
// keypress nor the click Enter produces on a focused button, so `pressEnter`
// does what the browser does: if no listener cancelled the keydown, the
// focused button activates.
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { _resetOverlaysForTests, overlayOpen } from '../ui/overlay'
import { DependencyStatusWarningModal } from '../tools/rabbit_v0.1.0/components/DependencyStatusGuard'
import { installCompanionEnterHotkey, enterTogglesCompanion } from './companionHotkey'

const PET = { name: 'Pip', stage: 'hatched' }
const WARNING = {
  kind: 'task',
  toStatus: 'approved',
  total: 1,
  offenders: [{ item: { id: 't2', title: 'Comp' }, unfinished: [{ id: 't1', title: 'Animation', status: 'in_progress' }] }],
}
const noop = () => {}
const name = (el) => (el?.getAttribute('aria-label') || el?.textContent || '').trim()

let uninstall = null
afterEach(() => { uninstall?.(); uninstall = null; cleanup(); _resetOverlaysForTests() })

/** App's handler, installed as App installs it. */
function install(toggle, { petData = PET, showOverlay = false } = {}) {
  uninstall?.()
  uninstall = installCompanionEnterHotkey({ petData, showOverlay, toggle })
}

/** One press, the browser's way: the listeners see the keydown; if none
    cancelled it and a <button> has focus, the button activates. */
function pressEnter() {
  const active = document.activeElement
  const target = active && active !== document.body ? active : document.body
  const ev = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  target.dispatchEvent(ev)
  if (!ev.defaultPrevented && target.tagName === 'BUTTON') target.click()
  return ev
}

describe('the companion Enter hotkey', () => {
  it('CONTROL — a pet and nothing focused: the key is the companion’s, taken and toggled', () => {
    const toggle = vi.fn()
    install(toggle)
    const ev = pressEnter()
    expect(ev.defaultPrevented).toBe(true)
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('CONTROL — no pet, or the sign-in overlay: not the companion’s', () => {
    const toggle = vi.fn()
    install(toggle, { petData: null })
    expect(pressEnter().defaultPrevented).toBe(false)
    install(toggle, { showOverlay: true })
    expect(pressEnter().defaultPrevented).toBe(false)
    expect(toggle).not.toHaveBeenCalled()
  })

  it('a text control has focus: not the companion’s (the rule App always had)', () => {
    const toggle = vi.fn()
    install(toggle)
    render(<><input aria-label="Notes" /><select aria-label="Status"><option>a</option></select><textarea aria-label="Body" /></>)
    for (const label of ['Notes', 'Status', 'Body']) {
      screen.getByLabelText(label).focus()
      expect(pressEnter().defaultPrevented, label).toBe(false)
    }
    expect(toggle).not.toHaveBeenCalled()
  })

  it('A-R2-04 — the status warning: Enter on its focused "Go back" presses the button; the pet stays put', () => {
    const toggle = vi.fn()
    const onCancel = vi.fn()
    install(toggle)
    render(<DependencyStatusWarningModal warning={WARNING} onCancel={onCancel} onContinue={noop} />)
    // Round 1's focus: the safe control, which is exactly where Enter lands.
    expect(name(document.activeElement)).toBe('Go back')
    // The signal the handler now reads: the warning is on the kit's stack.
    expect(overlayOpen()).toBe(true)
    const ev = pressEnter()
    expect(ev.defaultPrevented).toBe(false)
    expect(toggle).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('a kit Dialog’s initial focus: the same — Enter is the focused control’s', () => {
    const toggle = vi.fn()
    const onOk = vi.fn()
    install(toggle)
    render(<Dialog title="Rename" onClose={noop} footer={<Button variant="primary" onClick={onOk}>Save</Button>}><p>Body</p></Dialog>)
    const surface = document.querySelector('.ui-dialog')
    expect(surface.contains(document.activeElement)).toBe(true)
    // Focus is on whatever the Dialog chose; move it to the footer button
    // and press, as a keyboard user would.
    screen.getByRole('button', { name: 'Save' }).focus()
    const ev = pressEnter()
    expect(ev.defaultPrevented).toBe(false)
    expect(onOk).toHaveBeenCalledTimes(1)
    expect(toggle).not.toHaveBeenCalled()
  })

  it('a dialog that is NOT on the kit’s stack still keeps the key, by its role', () => {
    const toggle = vi.fn()
    install(toggle)
    render(<div role="dialog" aria-label="Close WILSON?"><button type="button">Cancel</button></div>)
    expect(overlayOpen()).toBe(false)
    screen.getByRole('button', { name: 'Cancel' }).focus()
    expect(pressEnter().defaultPrevented).toBe(false)
    expect(toggle).not.toHaveBeenCalled()
  })

  it('once the warning has closed, the key is the companion’s again', () => {
    const toggle = vi.fn()
    install(toggle)
    const { rerender } = render(<DependencyStatusWarningModal warning={WARNING} onCancel={noop} onContinue={noop} />)
    expect(pressEnter().defaultPrevented).toBe(false)
    rerender(<DependencyStatusWarningModal warning={null} onCancel={noop} onContinue={noop} />)
    expect(overlayOpen()).toBe(false)
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur()
    expect(pressEnter().defaultPrevented).toBe(true)
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('the uninstaller removes the listener', () => {
    const toggle = vi.fn()
    install(toggle)
    uninstall(); uninstall = null
    expect(pressEnter().defaultPrevented).toBe(false)
    expect(toggle).not.toHaveBeenCalled()
  })

  it('the predicate alone: an already-handled keydown, or another key, is never taken', () => {
    const taken = new window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    taken.preventDefault()
    expect(enterTogglesCompanion(taken, { petData: PET, showOverlay: false })).toBe(false)
    const space = new window.KeyboardEvent('keydown', { key: ' ', cancelable: true })
    expect(enterTogglesCompanion(space, { petData: PET, showOverlay: false })).toBe(false)
    const enter = new window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    expect(enterTogglesCompanion(enter, { petData: PET, showOverlay: false })).toBe(true)
  })

  it('App installs THIS handler — the inline copy is gone, so this file tests what ships', () => {
    const app = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../App.jsx'), 'utf8')
    expect(app).toMatch(/import \{ installCompanionEnterHotkey \} from '\.\/lib\/companionHotkey'/)
    expect(app).toMatch(/useEffect\(\(\) => installCompanionEnterHotkey\(\{\s*petData,\s*showOverlay,\s*toggle: \(\) => setCompanionOpen\(prev => !prev\),\s*\}\), \[petData, showOverlay\]\)/)
    expect(app).not.toMatch(/e\.key === 'Enter' && !e\.defaultPrevented && !isEditing/)
  })
})
