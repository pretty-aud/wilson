// =============================================================================
// overlay.js — the modal stack and the open-menu count, shared by Dialog and
// Menu (promoted from binUi.jsx, where Bins' adversarial reviews shaped it).
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
