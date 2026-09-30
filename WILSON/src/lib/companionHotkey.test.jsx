/** @vitest-environment jsdom */
// =============================================================================
// The pet companion's key — post-overhaul S2a, Audrey's C12 (2026-09-29): a
// BARE SHIFT TAP toggles it, never while typing in a field and never over a
// dialog, and Enter presses whatever has focus (OUTSTANDING P1-01 closed).
//
// The handler mounted here is the one App installs (lib/companionHotkey.js),
// on this test's own window. jsdom synthesises neither the keypress nor the
// click that Enter produces on a focused button, so `pressEnter` does what the
// browser does: if no listener cancelled the keydown, the focused button
// activates.
//
// Every scenario that must NOT toggle is a named function, and the planted-
// fault controls at the foot run the SAME scenarios against a naive handler
// (a toggle on every Shift keyup) and against the old Enter handler, so each
// one is shown to catch the fault it is there for.
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Menu } from '../ui/Menu'
import { _resetOverlaysForTests, overlayOpen } from '../ui/overlay'
import { DependencyStatusWarningModal } from '../tools/rabbit_v0.1.0/components/DependencyStatusGuard'
import { installCompanionShiftHotkey, shiftIsTaken } from './companionHotkey'

const here = dirname(fileURLToPath(import.meta.url))
const PET = { name: 'Pip', stage: 'hatched' }
const WARNING = {
  kind: 'task',
  toStatus: 'approved',
  total: 1,
  offenders: [{ item: { id: 't2', title: 'Comp' }, unfinished: [{ id: 't1', title: 'Animation', status: 'in_progress' }] }],
}
const noop = () => {}

let uninstall = null
afterEach(() => {
  uninstall?.(); uninstall = null
  cleanup(); _resetOverlaysForTests()
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur()
})

/** App's handler (or a planted one), installed as App installs it. */
function install(toggle, { petData = PET, showOverlay = false, installer = installCompanionShiftHotkey } = {}) {
  uninstall?.()
  uninstall = installer({ petData, showOverlay, toggle })
}

// ── Input, the browser's way ─────────────────────────────────────────────────
const target = () => (document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body)
function key(type, k, init = {}) {
  const ev = new window.KeyboardEvent(type, { key: k, bubbles: true, cancelable: true, ...init })
  target().dispatchEvent(ev)
  return ev
}
const shiftDown = (init = {}) => key('keydown', 'Shift', { shiftKey: true, ...init })
const shiftUp = (init = {}) => key('keyup', 'Shift', { shiftKey: false, ...init })
const tap = () => { shiftDown(); shiftUp() }
const on = (type, Ctor = window.Event, init = {}) => target().dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, ...init }))
/** One Enter: the listeners see the keydown; if none cancelled it and a
    <button> has focus, the button activates. */
function pressEnter() {
  const t = target()
  const ev = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  t.dispatchEvent(ev)
  if (!ev.defaultPrevented && t.tagName === 'BUTTON') t.click()
  return ev
}

// ── What must never toggle the pet, one function each ────────────────────────
const NOT_A_TAP = {
  'Shift+Tab (focus moves back)': () => { shiftDown(); key('keydown', 'Tab', { shiftKey: true }); key('keyup', 'Tab', { shiftKey: true }); shiftUp() },
  'Shift+letter (a capital)': () => { shiftDown(); key('keydown', 'A', { shiftKey: true }); key('keyup', 'A', { shiftKey: true }); shiftUp() },
  'Shift held through a click (a range select in Bins)': () => {
    shiftDown(); on('mousedown', window.MouseEvent, { shiftKey: true }); on('mouseup', window.MouseEvent, { shiftKey: true }); on('click', window.MouseEvent, { shiftKey: true }); shiftUp()
  },
  'Shift held through a pointer press': () => { shiftDown(); on('pointerdown'); shiftUp() },
  'Shift held through a wheel turn (the Timeline scrolls sideways)': () => { shiftDown(); on('wheel', window.WheelEvent, { deltaY: 120, shiftKey: true }); shiftUp() },
  'Ctrl+Shift+Z (redo)': () => {
    key('keydown', 'Control', { ctrlKey: true }); key('keydown', 'Shift', { ctrlKey: true, shiftKey: true })
    key('keydown', 'Z', { ctrlKey: true, shiftKey: true }); key('keyup', 'Z', { ctrlKey: true, shiftKey: true })
    key('keyup', 'Shift', { ctrlKey: true }); key('keyup', 'Control')
  },
  'Alt+Shift (the Windows keyboard-layout switch)': () => { key('keydown', 'Alt', { altKey: true }); key('keydown', 'Shift', { altKey: true, shiftKey: true }); key('keyup', 'Shift', { altKey: true }); key('keyup', 'Alt') },
  // Released Alt first: at Shift's keyup no modifier is down any more, so
  // only the rule at Shift's KEYDOWN (another modifier already held) stops it.
  'Alt+Shift with Alt released first': () => { key('keydown', 'Alt', { altKey: true }); key('keydown', 'Shift', { altKey: true, shiftKey: true }); key('keyup', 'Alt', { shiftKey: true }); key('keyup', 'Shift') },
  'Shift while Ctrl is still down at release': () => { shiftDown(); key('keyup', 'Shift', { ctrlKey: true }) },
  'Shift, then the window loses focus': () => { shiftDown(); window.dispatchEvent(new window.Event('blur')); shiftUp() },
  'a held Shift auto-repeating after a wheel turn': () => { shiftDown(); on('wheel', window.WheelEvent); shiftDown({ repeat: true }); shiftDown({ repeat: true }); shiftUp() },
  'Shift during an IME composition': () => { shiftDown({ isComposing: true }); shiftUp() },
}

describe('the pet companion toggles on a bare Shift tap (C12)', () => {
  it('CONTROL — a pet and nothing focused: a tap toggles, and a second tap toggles back', () => {
    const toggle = vi.fn()
    install(toggle)
    tap()
    expect(toggle).toHaveBeenCalledTimes(1)
    tap()
    expect(toggle).toHaveBeenCalledTimes(2)
  })

  it('a tap with a page button focused toggles, and does not press the button', () => {
    const toggle = vi.fn()
    const onClick = vi.fn()
    install(toggle)
    render(<button type="button" onClick={onClick}>Validate</button>)
    screen.getByRole('button', { name: 'Validate' }).focus()
    tap()
    expect(toggle).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('CONTROL — no pet, or the sign-in overlay: a tap does nothing', () => {
    const toggle = vi.fn()
    install(toggle, { petData: null })
    tap()
    install(toggle, { showOverlay: true })
    tap()
    expect(toggle).not.toHaveBeenCalled()
  })

  for (const [name, run] of Object.entries(NOT_A_TAP)) {
    it(`does not toggle: ${name}`, () => {
      const toggle = vi.fn()
      install(toggle)
      run()
      expect(toggle).not.toHaveBeenCalled()
      // …and a clean tap straight after still works: nothing was left armed
      // or stuck.
      tap()
      expect(toggle).toHaveBeenCalledTimes(1)
    })
  }

  it('Audrey: "the shift key works normally when in a text box selected and typing" — no toggle in an input, a textarea, a select or a contenteditable', () => {
    const toggle = vi.fn()
    install(toggle)
    render(<>
      <input aria-label="Notes" />
      <textarea aria-label="Body" />
      <select aria-label="Status"><option>a</option></select>
      <div aria-label="Editor" contentEditable suppressContentEditableWarning tabIndex={0}>x</div>
    </>)
    for (const label of ['Notes', 'Body', 'Status', 'Editor']) {
      const el = screen.getByLabelText(label)
      el.focus()
      // jsdom has no layout, so it never computes isContentEditable; the
      // browser does. Stand it in for the one element that is editable.
      if (label === 'Editor') Object.defineProperty(el, 'isContentEditable', { value: true, configurable: true })
      expect(document.activeElement, label).toBe(el)
      tap()
      expect(toggle, label).not.toHaveBeenCalled()
    }
  })

  it('not over a kit Dialog, nor with focus inside any [role="dialog"]; after it closes, a tap works again', () => {
    const toggle = vi.fn()
    install(toggle)
    const { rerender } = render(<DependencyStatusWarningModal warning={WARNING} onCancel={noop} onContinue={noop} />)
    expect(overlayOpen()).toBe(true)
    tap()
    expect(toggle).not.toHaveBeenCalled()
    rerender(<DependencyStatusWarningModal warning={null} onCancel={noop} onContinue={noop} />)
    expect(overlayOpen()).toBe(false)
    render(<div role="dialog" aria-label="Close WILSON?"><button type="button">Cancel</button></div>)
    screen.getByRole('button', { name: 'Cancel' }).focus()
    tap()
    expect(toggle).not.toHaveBeenCalled()
    document.activeElement.blur()
    tap()
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('not while a kit Menu is open — an overlay that is not a dialog, so only the overlay rule stops it', () => {
    const toggle = vi.fn()
    install(toggle)
    const { unmount } = render(<Menu x={10} y={10} onClose={noop} items={[{ label: 'Undo delete', onClick: noop }]} />)
    expect(overlayOpen()).toBe(true)
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur()
    expect(document.activeElement?.closest?.('[role="dialog"]') ?? null).toBeNull()
    tap()
    expect(toggle).not.toHaveBeenCalled()
    unmount()
    expect(overlayOpen()).toBe(false)
    tap()
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('the predicate alone: the page is free; a field, a kit overlay or a dialog takes Shift', () => {
    expect(shiftIsTaken()).toBe(false)
    render(<><input aria-label="Title" /><div role="dialog" aria-label="D"><button type="button">OK</button></div></>)
    screen.getByLabelText('Title').focus()
    expect(shiftIsTaken()).toBe(true)
    screen.getByRole('button', { name: 'OK' }).focus()
    expect(shiftIsTaken()).toBe(true)
  })

  it('the uninstaller removes every listener', () => {
    const toggle = vi.fn()
    install(toggle)
    uninstall(); uninstall = null
    tap()
    expect(toggle).not.toHaveBeenCalled()
  })
})

describe('Enter presses whatever has focus (C12; P1-01 closed)', () => {
  it('Enter on a focused page button presses the button; the pet stays put', () => {
    const toggle = vi.fn()
    const onClick = vi.fn()
    install(toggle)
    render(<button type="button" onClick={onClick}>D.O.G. settings</button>)
    screen.getByRole('button', { name: 'D.O.G. settings' }).focus()
    const ev = pressEnter()
    expect(ev.defaultPrevented).toBe(false)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(toggle).not.toHaveBeenCalled()
  })

  it('A-R2-04 still holds — the status warning\'s focused "Go back" is pressed by Enter', () => {
    const toggle = vi.fn()
    const onCancel = vi.fn()
    install(toggle)
    render(<DependencyStatusWarningModal warning={WARNING} onCancel={onCancel} onContinue={noop} />)
    expect((document.activeElement?.textContent || '').trim()).toBe('Go back')
    expect(pressEnter().defaultPrevented).toBe(false)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(toggle).not.toHaveBeenCalled()
  })

  it('a kit Dialog\'s footer button is pressed by Enter', () => {
    const toggle = vi.fn()
    const onOk = vi.fn()
    install(toggle)
    render(<Dialog title="Rename" onClose={noop} footer={<Button variant="primary" onClick={onOk}>Save</Button>}><p>Body</p></Dialog>)
    screen.getByRole('button', { name: 'Save' }).focus()
    expect(pressEnter().defaultPrevented).toBe(false)
    expect(onOk).toHaveBeenCalledTimes(1)
    expect(toggle).not.toHaveBeenCalled()
  })

  it('Enter with nothing focused is not taken either — it is simply not the pet\'s key', () => {
    const toggle = vi.fn()
    install(toggle)
    expect(pressEnter().defaultPrevented).toBe(false)
    expect(toggle).not.toHaveBeenCalled()
  })
})

describe('the planted faults each of those tests is there to catch', () => {
  // A naive Shift handler: a toggle on every Shift keyup, nothing else.
  const naive = ({ petData, showOverlay, toggle }, win = window) => {
    const up = (e) => { if (e.key === 'Shift' && petData && !showOverlay) toggle() }
    win.addEventListener('keyup', up)
    return () => win.removeEventListener('keyup', up)
  }
  // The handler this bundle replaced: Enter, taken whenever no field had focus.
  const oldEnter = ({ petData, showOverlay, toggle }, win = window) => {
    const down = (e) => {
      const a = win.document.activeElement
      if (e.key !== 'Enter' || e.defaultPrevented || !petData || showOverlay) return
      if (a && (['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) || a.isContentEditable)) return
      e.preventDefault()
      toggle()
    }
    win.addEventListener('keydown', down)
    return () => win.removeEventListener('keydown', down)
  }

  for (const [name, run] of Object.entries(NOT_A_TAP)) {
    it(`CONTROL: the naive handler DOES toggle on "${name}" — so that test can fail`, () => {
      const toggle = vi.fn()
      install(toggle, { installer: naive })
      run()
      expect(toggle).toHaveBeenCalled()
    })
  }
  it('CONTROL: the naive handler toggles while typing in a field', () => {
    const toggle = vi.fn()
    install(toggle, { installer: naive })
    render(<input aria-label="Notes" />)
    screen.getByLabelText('Notes').focus()
    tap()
    expect(toggle).toHaveBeenCalledTimes(1)
  })
  it('CONTROL: the old Enter handler takes Enter from a focused button — the button is never pressed', () => {
    const toggle = vi.fn()
    const onClick = vi.fn()
    install(toggle, { installer: oldEnter })
    render(<button type="button" onClick={onClick}>D.O.G. settings</button>)
    screen.getByRole('button', { name: 'D.O.G. settings' }).focus()
    expect(pressEnter().defaultPrevented).toBe(true)
    expect(onClick).not.toHaveBeenCalled()
    expect(toggle).toHaveBeenCalledTimes(1)
  })
})

describe('what ships', () => {
  it('App installs THIS handler, and no Enter branch for the pet is left', () => {
    const app = readFileSync(resolve(here, '../App.jsx'), 'utf8')
    expect(app).toMatch(/import \{ installCompanionShiftHotkey \} from '\.\/lib\/companionHotkey'/)
    expect(app).toMatch(/useEffect\(\(\) => installCompanionShiftHotkey\(\{\s*petData,\s*showOverlay,\s*toggle: \(\) => setCompanionOpen\(prev => !prev\),\s*\}\), \[petData, showOverlay\]\)/)
    expect(app).not.toMatch(/installCompanionEnterHotkey/)
    expect(app).not.toMatch(/e\.key === 'Enter' && !e\.defaultPrevented && !isEditing/)
  })

  // D.O.G. keeps a document-level "Enter generates" key for an empty outline.
  // Since S2a it leaves a focused control to Enter, as Bins' keys do.
  const dog = readFileSync(resolve(here, '../tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx'), 'utf8')
  const ENTER_PRESSES = (dog.match(/const ENTER_PRESSES = '([^']+)'/) || [])[1]
  it('D.O.G.\'s "Enter generates" key steps aside for a focused control, before it cancels anything', () => {
    expect(ENTER_PRESSES, 'the selector is not in DeckOutlineGenerator.jsx').toBeTruthy()
    const start = dog.indexOf('// Global Enter key')
    const block = dog.slice(start, dog.indexOf('document.addEventListener', start))
    expect(block).toMatch(/e\.target\.closest\(ENTER_PRESSES\)\) return;/)
    expect(block.indexOf('closest(ENTER_PRESSES)')).toBeLessThan(block.indexOf('e.preventDefault()'))
    // The selector takes every control Enter activates, and nothing else.
    render(<div>
      <button type="button">Help & documentation</button>
      <div role="tab" tabIndex={0}>Library</div>
      <div role="switch" aria-checked="false" tabIndex={0}>Full deck</div>
      <a href="#x">A link</a>
      <p>Plain text</p>
    </div>)
    for (const name of ['Help & documentation']) expect(screen.getByRole('button', { name }).closest(ENTER_PRESSES)).not.toBeNull()
    expect(screen.getByRole('tab').closest(ENTER_PRESSES)).not.toBeNull()
    expect(screen.getByRole('switch').closest(ENTER_PRESSES)).not.toBeNull()
    expect(screen.getByText('A link').closest(ENTER_PRESSES)).not.toBeNull()
    expect(screen.getByText('Plain text').closest(ENTER_PRESSES)).toBeNull()
    expect(document.body.closest(ENTER_PRESSES)).toBeNull()
  })
})
