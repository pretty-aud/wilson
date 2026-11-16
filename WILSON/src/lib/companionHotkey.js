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
// A TAP is ONE Shift key pressed and released, quickly (under TAP_MS), with
// nothing in between. Anything else cancels it: another key (Shift+Tab, a
// capital, Ctrl+Shift+Z), the other Shift key, a pointer or mouse press
// (Shift-click extends a selection in Bins), a wheel turn (Shift-wheel scrolls
// the Timeline sideways), the window losing focus, or holding it past TAP_MS.
// It never arms while a pointer button is held (Shift pressed mid-drag), with
// Ctrl, Alt or Meta already down (Alt+Shift switches the keyboard layout on
// Windows), mid-IME composition, or on an auto-repeat.
//
// NOT WHILE TYPING — Audrey: "the shift key works normally when in a text box
// selected and typing". A text-entry control (a text-like <input>, a
// <textarea>, a <select>) or a contenteditable with focus keeps Shift; a
// checkbox, radio, range, file or button input does not type, so it does not.
// NOT OVER A DIALOG — the rule merge review round 2 (A-R2-04) gave the Enter
// key, kept and widened: not while a kit overlay is up (`overlayOpen()`: every
// Dialog, Menu and anything on the modal stack), a drawer with a backdrop is
// open, or focus is inside a dialog, an alert dialog or anything aria-modal.
// Both ends of the tap are checked: an overlay that closes ON the keydown (the
// idle "Still there?" alert closes on any key) does not let the same tap open
// the pet behind it (S2a review round 1, B-R1-03).
//
// Listening: keydowns, presses, releases and wheels are read in the CAPTURE
// phase, so a component that stops propagation (the companion's own chat
// input stops Enter; a dialog's trap stops Tab) cannot leave a stale tap
// armed. The toggle happens on the Shift keyup in the bubble phase, so a
// handler that claims that keyup (none does today) keeps it.
//
// Installed by App in an effect, and by companionHotkey.test.jsx on its own
// window over real kit surfaces — the handler under test is the handler that
// ships, not a copy of it.
// =============================================================================

import { overlayOpen } from '../ui/overlay'

/** A tap is released within this many milliseconds of its press. */
export const TAP_MS = 500

// The input types a person types text into; an <input> with no type is text.
const TEXT_INPUT_TYPES = new Set([
  'text', 'search', 'email', 'url', 'tel', 'password', 'number',
  'date', 'time', 'datetime-local', 'month', 'week',
])

/** True when this element takes typing, so Shift belongs to it. A <select>
    does not (review round 2, B-R2-06: after a layout was picked with the
    mouse, focus stayed on D.O.G.'s select and the next tap did nothing). */
export function typesText(el) {
  if (!el) return false
  if (el.isContentEditable) return true
  if (el.tagName === 'TEXTAREA') return true
  if (el.tagName === 'INPUT') return TEXT_INPUT_TYPES.has((el.getAttribute('type') || 'text').toLowerCase())
  return false
}

const shown = (el) => !!el && el.getClientRects().length > 0

/** True when focus is somewhere a Shift belongs to: typing, or a dialog. */
export function shiftIsTaken(doc = document) {
  if (overlayOpen()) return true
  // A drawer with a backdrop is modal in all but name (the tools' settings
  // drawers): the pet does not open over it either.
  if ([...doc.querySelectorAll('.ui-drawer-backdrop')].some(shown)) return true
  const active = doc.activeElement
  if (!active) return false
  if (typesText(active)) return true
  if (typeof active.closest === 'function' && active.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')) return true
  return false
}

const withOtherModifier = (e) => e.ctrlKey || e.altKey || e.metaKey

/**
 * Installs the listeners on `win` and returns the uninstaller — the shape a
 * React effect wants back. `toggle` is called with nothing. The page's state
 * comes from `getState()` ({ petData, showOverlay }) at the moment of a tap,
 * so App installs this ONCE, first (review round 2): a re-install on every
 * pet change reset a half-made tap, and put this keydown listener behind the
 * session's activity listener, which closes "Still there?" on that same
 * keydown before this one could see it was open (B-R2-02, B-R2-04). Plain
 * `petData` / `showOverlay` values still work, for the tests.
 */
export function installCompanionShiftHotkey({ petData, showOverlay, getState, toggle }, win = window) {
  const state = getState || (() => ({ petData, showOverlay }))
  let armed = false
  let armedAt = 0
  let shiftsHeld = 0          // how many Shift keys are down (Left and Right)
  let pointerHeld = false     // a mouse button or a touch is down
  const disarm = () => { armed = false }
  const settle = (e) => {
    // Nothing is held when an event says so: heals a keyup or pointerup that
    // happened out of sight of this window.
    if (e && e.shiftKey === false) shiftsHeld = 0
  }
  const onKeyDown = (e) => {
    if (e.key !== 'Shift') { armed = false; settle(e); return }
    if (e.repeat) return
    shiftsHeld += 1
    armed = shiftsHeld === 1 && !pointerHeld && !e.isComposing && !withOtherModifier(e) && !shiftIsTaken(win.document)
    armedAt = Date.now()
  }
  const onKeyUp = (e) => {
    if (e.key !== 'Shift') return
    // Arming already refused a second Shift and a held pointer, and a press
    // or a second Shift disarms; what is left to ask here is time, a claim
    // on the keyup, a modifier down now, and the page (below).
    const tapped = armed && Date.now() - armedAt <= TAP_MS
    armed = false
    shiftsHeld = Math.max(0, shiftsHeld - 1)
    // The last Shift up says no Shift is down: Windows sends no keyup for the
    // first-released of two Shifts, which would leave the count stuck at one
    // and every later tap dead (B-R2-05).
    if (!e.shiftKey) shiftsHeld = 0
    if (!tapped || e.defaultPrevented || withOtherModifier(e)) return
    const { petData: pet, showOverlay: overlay } = state() || {}
    if (!pet || overlay) return
    if (shiftIsTaken(win.document)) return
    toggle()
  }
  const onPress = (e) => { armed = false; pointerHeld = true; settle(e) }
  const onRelease = () => { pointerHeld = false }
  const onWheel = (e) => { armed = false; settle(e) }
  const onBlur = () => { armed = false; shiftsHeld = 0; pointerHeld = false }
  const capture = { capture: true }
  const passiveCapture = { capture: true, passive: true }
  const listeners = [
    ['keydown', onKeyDown, capture],
    ['keyup', onKeyUp, false],
    ['pointerdown', onPress, capture],
    ['mousedown', onPress, capture],
    ['pointerup', onRelease, capture],
    ['mouseup', onRelease, capture],
    ['pointercancel', onRelease, capture],
    ['dragend', onRelease, capture],
    ['wheel', onWheel, passiveCapture],
    ['blur', onBlur, false],
  ]
  for (const [type, fn, opts] of listeners) win.addEventListener(type, fn, opts)
  return () => {
    for (const [type, fn, opts] of listeners) win.removeEventListener(type, fn, opts)
    disarm()
  }
}
