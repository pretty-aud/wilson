// =============================================================================
// overlay.js — the modal stack, the open-menu count and the focusable-element
// query, shared by Dialog and Menu (promoted from binUi.jsx, where Bins'
// adversarial reviews shaped it; the focus query added in F3).
//
// Escape closes only the TOPMOST dialog (the take picker over the takes
// dialog used to close both); a dialog registers ONCE per mount so a
// re-render of a lower dialog cannot move it to the top. `overlayOpen()` lets
// document-level key handlers (the Bins keys, the preview's Space) stand
// down while any overlay from the kit is up (Space in the add dialog's list
// used to play the video behind the backdrop).
//
// Module state on purpose: there is one document and one stack. Tests call
// `_resetOverlaysForTests()` between cases.
// =============================================================================

const modalStack = []
let openMenus = 0

/** True while any kit Dialog or Menu is open. */
export function overlayOpen() {
  return modalStack.length > 0 || openMenus > 0
}

/** Register a dialog instance (any unique object). Returns an unregister function. */
export function pushModal(id) {
  modalStack.push(id)
  return () => popModal(id)
}

export function popModal(id) {
  const i = modalStack.indexOf(id)
  if (i >= 0) modalStack.splice(i, 1)
}

/** Only the topmost dialog answers Escape. */
export function isTopModal(id) {
  return modalStack.length > 0 && modalStack[modalStack.length - 1] === id
}

export function modalDepth() {
  return modalStack.length
}

export function menuOpened() {
  openMenus += 1
  return () => menuClosed()
}

export function menuClosed() {
  openMenus = Math.max(0, openMenus - 1)
}

export function _resetOverlaysForTests() {
  modalStack.length = 0
  openMenus = 0
}

// ── Focus, for the surfaces that take it away ───────────────────────────────
//
// Dialog needs three things and they all start here: what inside it can be
// focused, so it can put focus somewhere on open, keep Tab inside while it is
// up, and hand focus back when it closes (C2 KR-5).
//
// 🚨 VISIBILITY IS NOT CHECKED BY LAYOUT. The obvious filter — `offsetParent`
// or `getClientRects().length` — reports "hidden" for EVERY element under
// jsdom, which has no layout engine, so a trap written that way traps nothing
// in every test that covers it and the tests still pass. The filter is the
// semantic one instead: `hidden`, `aria-hidden`, `disabled` and a negative
// tabindex, each of which is in the DOM and true in both environments.

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'iframe',
  'object',
  'embed',
  'summary',
  'audio[controls]',
  'video[controls]',
  '[contenteditable="true"]',
  '[tabindex]',
].join(',')

/**
 * Everything inside `node` that can take focus, in DOM order.
 *
 * Document order is the tab order here: a positive `tabindex` would reorder
 * it and nothing in this app uses one (grepped 2026-09-11), so the extra
 * sort would be a rule with no case behind it.
 */
export function focusableWithin(node) {
  if (!node) return []
  return [...node.querySelectorAll(FOCUSABLE)].filter((el) => {
    if (el.disabled) return false
    if (el.hasAttribute('hidden')) return false
    if (el.getAttribute('aria-hidden') === 'true') return false
    const ti = el.getAttribute('tabindex')
    if (ti != null && Number(ti) < 0) return false
    // An ancestor can hide it too — `hidden` on a wrapper is how a collapsed
    // section is spelled, and its controls are not reachable either.
    return !el.closest('[hidden],[aria-hidden="true"]')
  })
}
