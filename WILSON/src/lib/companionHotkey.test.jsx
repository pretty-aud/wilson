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
import { installCompanionShiftHotkey, shiftIsTaken, typesText, TAP_MS } from './companionHotkey'
import { Drawer } from '../ui/Drawer'
import { pushModal, popModal } from '../ui/overlay'
import { blankJsComments } from '../../scripts/ui-audit.mjs'

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
  'Shift held through a pointer press': () => { shiftDown(); on('pointerdown'); on('pointerup'); shiftUp() },
  // Review round 1 (B-R1-04): Shift pressed and released while a mouse button
  // is held — mid-drag, or mid text-selection.
  'Shift pressed mid-drag (a mouse button held)': () => { on('mousedown', window.MouseEvent); on('pointerdown'); shiftDown(); shiftUp(); on('mouseup', window.MouseEvent); on('pointerup') },
  // …and let go after the drag ends: only the rule at Shift's keydown sees it.
  'Shift pressed mid-drag, released after the drag ends': () => { on('mousedown', window.MouseEvent); on('pointerdown'); shiftDown(); on('mouseup', window.MouseEvent); on('pointerup'); shiftUp() },
  // …held too long to be a tap (a Shift rested on while reading).
  'Shift held past the tap time': () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try { shiftDown(); vi.setSystemTime(Date.now() + TAP_MS + 100); shiftUp() } finally { vi.useRealTimers() }
  },
  // …both Shift keys together.
  'Left and Right Shift together': () => {
    key('keydown', 'Shift', { code: 'ShiftLeft', shiftKey: true }); key('keydown', 'Shift', { code: 'ShiftRight', shiftKey: true })
    key('keyup', 'Shift', { code: 'ShiftRight', shiftKey: true }); key('keyup', 'Shift', { code: 'ShiftLeft' })
  },
  // A component that stops a keydown's propagation (a dialog's Tab trap)
  // must not hide it: the keydown is read in the CAPTURE phase (G-R1-06).
  'Shift+Tab where a trap stops the Tab keydown': () => {
    const trap = document.createElement('div')
    const inside = document.createElement('button')
    trap.appendChild(inside)
    document.body.appendChild(trap)
    trap.addEventListener('keydown', (e) => { if (e.key === 'Tab') e.stopPropagation() })
    inside.focus()
    try { shiftDown(); key('keydown', 'Tab', { shiftKey: true }); key('keyup', 'Tab', { shiftKey: true }); shiftUp() } finally { inside.blur(); trap.remove() }
  },
  // A Shift keyup another handler has claimed stays that handler's (G-R1-06).
  'a Shift keyup another handler claimed': () => {
    const claim = (e) => { if (e.key === 'Shift') e.preventDefault() }
    document.body.addEventListener('keyup', claim)
    try { shiftDown(); shiftUp() } finally { document.body.removeEventListener('keyup', claim) }
  },
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

  it('a tap with a page button focused toggles', () => {
    const toggle = vi.fn()
    install(toggle)
    render(<button type="button">Validate</button>)
    screen.getByRole('button', { name: 'Validate' }).focus()
    tap()
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('a tap with a checkbox, a radio, a range, a button input or a select focused toggles — they take no typing (B-R1-05, B-R2-06)', () => {
    const toggle = vi.fn()
    install(toggle)
    render(<>
      <input type="checkbox" aria-label="Full-time" />
      <input type="radio" aria-label="Tier" />
      <input type="range" aria-label="Zoom" />
      <input type="button" aria-label="Go" value="Go" />
      <select aria-label="Layout"><option>Title slide</option></select>
    </>)
    let n = 0
    for (const label of ['Full-time', 'Tier', 'Zoom', 'Go', 'Layout']) {
      screen.getByLabelText(label).focus()
      tap()
      n += 1
      expect(toggle, label).toHaveBeenCalledTimes(n)
    }
    // …while every text-entry type keeps Shift.
    for (const type of [undefined, 'text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date']) {
      const el = document.createElement('input')
      if (type) el.setAttribute('type', type)
      expect(typesText(el), type || '(no type)').toBe(true)
    }
    for (const type of ['checkbox', 'radio', 'range', 'button', 'submit', 'file', 'color']) {
      const el = document.createElement('input')
      el.setAttribute('type', type)
      expect(typesText(el), type).toBe(false)
    }
    expect(typesText(document.createElement('select'))).toBe(false)
  })

  it('Windows sends no keyup for the first-released of two Shifts: the last Shift up still clears the count, so the next tap works (B-R2-05)', () => {
    const toggle = vi.fn()
    install(toggle)
    key('keydown', 'Shift', { code: 'ShiftLeft', shiftKey: true })
    key('keydown', 'Shift', { code: 'ShiftRight', shiftKey: true })
    // ShiftLeft released: no event. ShiftRight released: the only keyup, and no Shift is down.
    key('keyup', 'Shift', { code: 'ShiftRight', shiftKey: false })
    expect(toggle).not.toHaveBeenCalled()
    tap()
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('a backdrop with no box on screen (a drawer left open on a hidden page) does not stop the tap (G-R2-05)', () => {
    const toggle = vi.fn()
    install(toggle)
    const hidden = document.createElement('div')
    hidden.className = 'ui-drawer-backdrop'
    document.body.appendChild(hidden)
    try {
      expect(hidden.getClientRects().length).toBe(0)
      tap()
      expect(toggle).toHaveBeenCalledTimes(1)
    } finally { hidden.remove() }
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

  it('Audrey: "the shift key works normally when in a text box selected and typing" — no toggle in an input, a textarea or a contenteditable', () => {
    const toggle = vi.fn()
    install(toggle)
    render(<>
      <input aria-label="Notes" />
      <textarea aria-label="Body" />
      <div aria-label="Editor" contentEditable suppressContentEditableWarning tabIndex={0}>x</div>
    </>)
    for (const label of ['Notes', 'Body', 'Editor']) {
      const el = screen.getByLabelText(label)
      el.focus()
      // jsdom does not implement isContentEditable at all; the browser does.
      // Stand it in for the one element that is editable.
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

  it('not while a drawer with a backdrop is open (the tools\' settings drawers); a docked drawer without one does not stop it', () => {
    const toggle = vi.fn()
    install(toggle)
    const { unmount } = render(<Drawer open backdrop onClose={noop} label="Settings" title="Settings"><p>Body</p></Drawer>)
    const backdrop = document.querySelector('.ui-drawer-backdrop')
    expect(backdrop, 'the kit Drawer drew no backdrop').not.toBeNull()
    // jsdom lays nothing out, so no element has client rects; the browser's
    // backdrop does. (A drawer left open on a HIDDEN page has none there
    // either, which is why the check asks for them.)
    backdrop.getClientRects = () => [{ width: 1, height: 1 }]
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur()
    tap()
    expect(toggle).not.toHaveBeenCalled()
    unmount()
    render(<Drawer open onClose={noop} label="History" title="History"><p>Body</p></Drawer>)
    expect(document.querySelector('.ui-drawer-backdrop')).toBeNull()
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur()
    tap()
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('an overlay that closes ON the Shift keydown (the idle "Still there?" alert closes on any key) does not let that tap open the pet (B-R1-03)', () => {
    const toggle = vi.fn()
    install(toggle)
    pushModal('idle-warning')
    // Registered after the hotkey, so it runs after the hotkey's own keydown
    // read — the worst order for the check at keyup alone.
    const closeOnKey = () => popModal('idle-warning')
    window.addEventListener('keydown', closeOnKey, true)
    try {
      tap()
      expect(overlayOpen()).toBe(false)
      expect(toggle).not.toHaveBeenCalled()
      tap()
      expect(toggle).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('keydown', closeOnKey, true)
    }
  })

  it('CONTROL — why App installs the hotkey FIRST: a closer added before it wins the race and the tap opens the pet (B-R2-02)', () => {
    // The session's activity listener closes "Still there?" on any key. If it
    // runs before the hotkey's keydown, the hotkey sees no overlay and arms.
    // App therefore installs the hotkey once, in a layout effect, before any
    // session listener exists (pinned in "what ships" below).
    const toggle = vi.fn()
    pushModal('idle-warning')
    const closeOnKey = () => popModal('idle-warning')
    window.addEventListener('keydown', closeOnKey, true)
    try {
      install(toggle)
      tap()
      expect(toggle).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('keydown', closeOnKey, true)
    }
  })

  it('reads the pet and the sign-in overlay at the moment of the tap, through getState (App installs once)', () => {
    const toggle = vi.fn()
    let state = { petData: null, showOverlay: false }
    uninstall?.()
    uninstall = installCompanionShiftHotkey({ getState: () => state, toggle })
    tap()
    expect(toggle).not.toHaveBeenCalled()
    state = { petData: PET, showOverlay: false }
    tap()
    expect(toggle).toHaveBeenCalledTimes(1)
    state = { petData: PET, showOverlay: true }
    tap()
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('not with focus inside an alert dialog or anything aria-modal', () => {
    const toggle = vi.fn()
    install(toggle)
    render(<>
      <div role="alertdialog" aria-label="Still there?"><button type="button">Stay signed in</button></div>
      <div aria-modal="true" aria-label="Close WILSON?"><button type="button">Cancel</button></div>
    </>)
    for (const name of ['Stay signed in', 'Cancel']) {
      screen.getByRole('button', { name }).focus()
      tap()
      expect(toggle, name).not.toHaveBeenCalled()
    }
  })

  it('the predicate alone: the page is free; a field, a kit overlay or a dialog takes Shift', () => {
    expect(shiftIsTaken()).toBe(false)
    render(<><input aria-label="Title" /><div role="dialog" aria-label="D"><button type="button">OK</button></div></>)
    screen.getByLabelText('Title').focus()
    expect(shiftIsTaken()).toBe(true)
    screen.getByRole('button', { name: 'OK' }).focus()
    expect(shiftIsTaken()).toBe(true)
  })

  it('the uninstaller removes every listener it added, with the same phase', () => {
    const toggle = vi.fn()
    const added = vi.spyOn(window, 'addEventListener')
    const removed = vi.spyOn(window, 'removeEventListener')
    try {
      install(toggle)
      uninstall(); uninstall = null
      const phase = (o) => (typeof o === 'object' ? !!o?.capture : !!o)
      const sig = (calls) => calls.map(([type, fn, opts]) => [type, fn, phase(opts)])
      expect(added.mock.calls.length).toBeGreaterThanOrEqual(6)
      expect(sig(removed.mock.calls)).toEqual(sig(added.mock.calls))
    } finally {
      added.mockRestore(); removed.mockRestore()
    }
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
  // Comments blanked first, so a commented-out install cannot pass
  // (review round 1, G-R1-05). D.O.G.'s own Enter key is held by
  // src/tools/deck-outline-generator_v0.514/enterGenerates.test.js.
  const app = blankJsComments(readFileSync(resolve(here, '../App.jsx'), 'utf8'))
  it('App installs THIS handler ONCE, in a layout effect, reading its state through a ref; and no code in App reads an Enter key at all', () => {
    expect(app).toMatch(/import \{ installCompanionShiftHotkey \} from '\.\/lib\/companionHotkey'/)
    expect(app).toMatch(/const companionKeyState = useRef\(\{ petData, showOverlay \}\);\s*useLayoutEffect\(\(\) => \{ companionKeyState\.current = \{ petData, showOverlay \}; \}\);\s*useLayoutEffect\(\(\) => installCompanionShiftHotkey\(\{\s*getState: \(\) => companionKeyState\.current,\s*toggle: \(\) => setCompanionOpen\(prev => !prev\),\s*\}\), \[\]\);/)
    // …and it is the only install: never again on a pet change.
    expect(app.match(/installCompanionShiftHotkey\(/g)).toHaveLength(1)
    expect(app).not.toMatch(/installCompanionEnterHotkey/)
    // The pet's old branch in any spelling: App's code names no Enter key,
    // by name or by number (round 2, G-R2-07).
    expect(app).not.toMatch(/['"`](?:Numpad)?Enter['"`]/)
    expect(app).not.toMatch(/\b(?:keyCode|which|charCode)\s*===?\s*13\b/)
  })
  it('CONTROL: an install inside a comment is blank to the reader, and an Enter branch in any spelling is seen', () => {
    const planted = blankJsComments('/* useLayoutEffect(() => installCompanionShiftHotkey({ getState: () => companionKeyState.current, toggle: () => setCompanionOpen(prev => !prev), }), []); */')
    expect(planted).not.toMatch(/installCompanionShiftHotkey/)
    for (const q of ["if (e.key === 'Enter') setCompanionOpen(o => !o)", 'if (e.key === "Enter") toggle()', 'switch (e.key) { case `Enter`: toggle() }', "if (e.code === 'NumpadEnter') toggle()"]) {
      expect(blankJsComments(q), q).toMatch(/['"`](?:Numpad)?Enter['"`]/)
    }
    for (const q of ['if (e.keyCode === 13) toggle()', 'if (e.which == 13) toggle()']) expect(q).toMatch(/\b(?:keyCode|which|charCode)\s*===?\s*13\b/)
  })
})
