// =============================================================================
// companionHotkey — the key that opens and closes the pet companion (App.jsx),
// as ONE installable listener.
//
// Post-overhaul S2a, Audrey's C12 (2026-09-29): a BARE SHIFT TAP. It was
// Enter, taken at `window` whenever no text control had focus — so Enter on a
// focused button toggled the pet and never pressed the button (OUTSTANDING
// P1-01: every kit Dialog, drawer and picker; only Space worked). Enter is not
// this listener's at all any more: it presses whatever has focus.
//
// A TAP is Shift down and Shift up with nothing in between. Anything else in
// between cancels it: another key (Shift+Tab, Shift+letter, Ctrl+Shift+Z), a
// pointer press (Shift-click extends a selection in Bins), a wheel turn
// (Shift-wheel scrolls the Timeline sideways), or the window losing focus. A
// Shift pressed with Ctrl, Alt or Meta already down never arms (Alt+Shift
// switches the keyboard layout on Windows), and neither does one mid-IME
// composition. A held Shift's auto-repeat keeps whatever state the tap is in,
// so a hold through a scroll does not re-arm.
//
// NOT WHILE TYPING — Audrey: "the shift key works normally when in a text box
// selected and typing". A text control (input, textarea, select) or a
// contenteditable with focus keeps Shift entirely. NOT OVER A DIALOG — the
// rule merge review round 2 (A-R2-04) gave the Enter key, kept for this one:
// while a kit overlay is up (`overlayOpen()`: every Dialog, Menu and anything
// on the modal stack) or focus is inside a `[role="dialog"]`, the pet does not
// open behind or over it.
//
// Listening: every keydown, pointer press and wheel turn is read in the
// CAPTURE phase, so a component that stops propagation (the companion's own
// chat input stops Enter; a dialog's trap stops Tab) cannot leave a stale tap
// armed. The toggle itself happens on the Shift keyup, in the bubble phase, so
// a handler that claims that keyup (none does today) keeps it.
//
// Installed by App in an effect, and by companionHotkey.test.jsx on its own
// window over real kit surfaces — the handler under test is the handler that
// ships, not a copy of it.
// =============================================================================

import { overlayOpen } from '../ui/overlay'

const TEXT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** True when focus is somewhere a Shift belongs to: typing, or a dialog. */
export function shiftIsTaken(doc = document) {
  if (overlayOpen()) return true
  const active = doc.activeElement
  if (!active) return false
  if (TEXT_TAGS.has(active.tagName) || active.isContentEditable) return true
  if (typeof active.closest === 'function' && active.closest('[role="dialog"]')) return true
  return false
}

const withOtherModifier = (e) => e.ctrlKey || e.altKey || e.metaKey

/**
 * Installs the listeners on `win` and returns the uninstaller — the shape a
 * React effect wants back. `toggle` is called with nothing.
 */
export function installCompanionShiftHotkey({ petData, showOverlay, toggle }, win = window) {
  let armed = false
  const disarm = () => { armed = false }
  const onKeyDown = (e) => {
    if (e.key !== 'Shift') { armed = false; return }
    if (e.repeat) return
    armed = !e.isComposing && !withOtherModifier(e)
  }
  const onKeyUp = (e) => {
    if (e.key !== 'Shift') return
    const tapped = armed
    armed = false
    if (!tapped || e.defaultPrevented || withOtherModifier(e)) return
    if (!petData || showOverlay) return
    if (shiftIsTaken(win.document)) return
    toggle()
  }
  const capture = { capture: true }
  const passiveCapture = { capture: true, passive: true }
  win.addEventListener('keydown', onKeyDown, capture)
  win.addEventListener('keyup', onKeyUp)
  win.addEventListener('pointerdown', disarm, capture)
  win.addEventListener('mousedown', disarm, capture)
  win.addEventListener('wheel', disarm, passiveCapture)
  win.addEventListener('blur', disarm)
  return () => {
    win.removeEventListener('keydown', onKeyDown, capture)
    win.removeEventListener('keyup', onKeyUp)
    win.removeEventListener('pointerdown', disarm, capture)
    win.removeEventListener('mousedown', disarm, capture)
    win.removeEventListener('wheel', disarm, passiveCapture)
    win.removeEventListener('blur', disarm)
  }
}
