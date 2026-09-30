// =============================================================================
// companionHotkey — the window-level Enter key that opens and closes the pet
// companion (App.jsx), as ONE installable listener.
//
// Enter is the companion's only when nothing else has spoken for it: not
// while a text control has focus (the rule App always had), and — merge
// review round 2, A-R2-04 — not while a kit overlay is up. The Phase 7 status
// warning (DependencyStatusGuard) registers on the kit's modal stack and puts
// focus on its "Go back" button when it opens; App's listener cancelled the
// keydown, Chromium activates a focused <button> on the keypress that a
// cancelled keydown suppresses, and so Enter toggled the pet, the warning
// stayed up, and only Space worked its buttons. Before round 1 focus stayed
// on the raising <select>, which the text-control rule already skipped, so
// the collision only appeared once the warning took focus properly.
//
// `overlayOpen()` is the kit's own signal — every Dialog, every Menu, and
// anything that pushes onto the stack, the warning included — and a
// `[role="dialog"]` ancestor covers a dialog that is not on it. Outside an
// overlay the key is still the pet's even when a page button has focus: that
// is the overhaul parent's behaviour, left exactly as it was and recorded in
// docs/OUTSTANDING.md; this file changes nothing there.
//
// Installed by App in an effect, and by companionHotkey.test.jsx over a real
// warning and a real kit Dialog — so the handler under test is the handler
// that ships, not a copy of it.
// =============================================================================

import { overlayOpen } from '../ui/overlay'

const TEXT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** True when this keydown is the companion's to take. */
export function enterTogglesCompanion(e, { petData, showOverlay }, doc = document) {
  if (e.key !== 'Enter' || e.defaultPrevented) return false
  if (!petData || showOverlay) return false
  if (overlayOpen()) return false
  const active = doc.activeElement
  if (!active) return true
  if (TEXT_TAGS.has(active.tagName) || active.isContentEditable) return false
  if (typeof active.closest === 'function' && active.closest('[role="dialog"]')) return false
  return true
}

/**
 * Installs the listener on `win` and returns the uninstaller — the shape a
 * React effect wants back. `toggle` is called with nothing.
 */
export function installCompanionEnterHotkey({ petData, showOverlay, toggle }, win = window) {
  const handleKeyDown = (e) => {
    if (!enterTogglesCompanion(e, { petData, showOverlay }, win.document)) return
    e.preventDefault()
    toggle()
  }
  win.addEventListener('keydown', handleKeyDown)
  return () => win.removeEventListener('keydown', handleKeyDown)
}
