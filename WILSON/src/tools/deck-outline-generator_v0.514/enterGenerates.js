// =============================================================================
// enterGenerates — whether an Enter keydown is D.O.G.'s "Enter generates" key
// (the document-level shortcut that starts a generation when the outline is
// empty), as one pure decision DeckOutlineGenerator.jsx calls and
// enterGenerates.test.js drives with real elements.
//
// Post-overhaul S2a, Audrey's C12: Enter presses whatever has focus. So the
// shortcut is D.O.G.'s only
//   - on D.O.G.'s own page (every page stays mounted: without this, Enter on
//     R.A.B.B.I.T. or O.T.T.E.R. started a D.O.G. generation behind the page —
//     S2a review round 1, B-R1-08, measured),
//   - when no other handler has taken the key (Bins' own Enter renames, and
//     cancels the key),
//   - when no modifier is held, focus is not in a text field, and focus is
//     not on a control Enter activates by itself (a button, a link, a tab, a
//     menu item) — the Help and Settings buttons in the "Deck outline" bar
//     among them.
// A focused checkbox or switch is the exception, kept as it was: Enter has
// no job on one (Space toggles it), and after clicking one of D.O.G.'s option
// toggles or Full deck, Enter generating is what Audrey relies on (review
// round 1, B-R1-01). D.O.G.'s toggles are <button role="checkbox">, so the
// role decides, not the tag.
// =============================================================================

/** The controls Enter activates by itself. */
export const ENTER_PRESSES = 'button, a[href], [role="button"], [role="menuitem"], [role="tab"], summary'
/** …of which these are toggles, which Enter does not operate. */
export const ENTER_TOGGLES = '[role="checkbox"], [role="switch"]'

const TEXT_TAGS = new Set(['input', 'textarea', 'select'])

/** True when this keydown is D.O.G.'s "Enter generates" key to take. */
export function enterIsDogs(e, { onDogPage }) {
  if (e.key !== 'Enter') return false
  if (!onDogPage || e.defaultPrevented) return false
  if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return false
  const t = e.target
  if (!t || typeof t.closest !== 'function') return true
  if (TEXT_TAGS.has(t.tagName.toLowerCase()) || t.isContentEditable) return false
  const control = t.closest(ENTER_PRESSES)
  return !control || control.matches(ENTER_TOGGLES)
}
