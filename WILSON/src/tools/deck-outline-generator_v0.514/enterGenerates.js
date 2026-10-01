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
//     S2a review round 1, B-R1-08, measured);
//   - with no modifier held and focus not in a text field;
//   - when no window is up over the page — a kit Dialog or Menu, a drawer
//     (the settings drawer's own switch and fields are its, not the page's),
//     anything role=dialog/alertdialog or aria-modal (review round 2,
//     B-R2-03: Enter on the drawer's "Editable" switch generated behind it);
//   - and focus is not on a control Enter presses by itself (a button, a
//     link, a tab, a menu item) — the Help and Settings buttons in the
//     "Deck outline" bar among them.
// The exception is kept from before S2a, and only for D.O.G.'s own option
// toggles (`.dog-check`) and its Full deck switch: Enter generates there, as
// Audrey relies on after clicking one (review round 1, B-R1-01). They are
// <button>s, so Enter would otherwise click them and flip the option back.
//
// It does NOT ask whether another listener took the key first (round 1 did,
// and review round 2, B-R2-01, measured the cost: Bins' document listener,
// mounted on the hidden R.A.B.B.I.T. page, takes every Enter once a file is
// selected, so D.O.G.'s shortcut died for the session). The page check above
// is what keeps Bins' own Enter from starting a D.O.G. generation.
// =============================================================================

import { overlayOpen } from '../../ui/overlay'

/** The controls Enter activates by itself. */
export const ENTER_PRESSES = 'button, a[href], [role="button"], [role="menuitem"], [role="tab"], summary'
/** …of which these keep "Enter generates": D.O.G.'s own option toggles and
    its Full deck switch (the kit Switch, labelled "Full deck"). */
export const GENERATE_TOGGLES = 'button.dog-check[role="checkbox"], .dog-full-deck button[role="switch"]'
/** Where focus belongs to a window over the page, not to the page. */
const OVER_THE_PAGE = '.ui-drawer, [role="dialog"], [role="alertdialog"], [aria-modal="true"]'

const TEXT_TAGS = new Set(['input', 'textarea', 'select'])
const shown = (el) => el.getClientRects().length > 0

/** True when this keydown is D.O.G.'s "Enter generates" key to take. */
export function enterIsDogs(e, { onDogPage }, doc = (typeof document !== 'undefined' ? document : null)) {
  if (e.key !== 'Enter' || !onDogPage) return false
  if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return false
  if (overlayOpen()) return false
  if (doc && [...doc.querySelectorAll('.ui-drawer-backdrop')].some(shown)) return false
  const t = e.target
  if (!t || typeof t.closest !== 'function') return true
  if (TEXT_TAGS.has(t.tagName.toLowerCase()) || t.isContentEditable) return false
  if (t.closest(OVER_THE_PAGE)) return false
  const control = t.closest(ENTER_PRESSES)
  return !control || control.matches(GENERATE_TOGGLES)
}
