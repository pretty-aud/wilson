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
// 🚨 VISIBILITY IS NEVER CHECKED BY LAYOUT. The obvious filter —
// `offsetParent` or `getClientRects().length` — reports "hidden" for EVERY
// element under jsdom, which has no layout engine, so a trap written that way
// traps nothing in every test that covers it and the tests still pass.
//
// So the filter is semantic first — `hidden`, `aria-hidden`, `inert`,
// `disabled` and a negative tabindex, each of which is in the DOM and true in
// both environments — and then, ONLY where the environment implements it,
// `checkVisibility` for the two CSS states that untab an element without
// showing up as an attribute (`display: none`, `visibility: hidden`). That is
// a feature test rather than a browser test: under the runner it is
// `undefined` and the semantic filter stands alone.

export const FOCUSABLE = [
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
 * Everything inside `node` that can take focus, in DOM order: the controls
 * FOCUSABLE matches, and the scrollers the browser makes Tab stops of their
 * own (below).
 *
 * Document order is the tab order here: a positive `tabindex` would reorder
 * it and nothing in this app uses one (grepped 2026-09-11), so the extra
 * sort would be a rule with no case behind it. (The one sort below merges the
 * two lists, which are each in document order already.)
 */
export function focusableWithin(node) {
  if (!node) return []
  const controls = [...node.querySelectorAll(FOCUSABLE)].filter(tabbable)
  const scrollers = keyboardScrollers(node, controls)
  if (scrollers.length === 0) return controls
  return [...controls, ...scrollers].sort((a, b) => (a.compareDocumentPosition(b) & FOLLOWING ? -1 : 1))
}

/** `Node.DOCUMENT_POSITION_FOLLOWING`: `b` comes after `a`. */
const FOLLOWING = 4

/** The one filter: what the browser skips, decided without layout (above). */
function tabbable(el) {
  // 🚨 `:disabled`, not `el.disabled`. The PROPERTY is only true on the
  // element that carries the attribute; a control inside
  // `<fieldset disabled>` reports `disabled === false` while the browser
  // skips it and `:disabled` matches it. Measured in Chromium.
  if (el.matches(':disabled')) return false
  const ti = el.getAttribute('tabindex')
  if (ti != null && Number(ti) < 0) return false
  // `closest` matches the element itself as well as its ancestors, so this
  // one line covers both — `hidden` on a wrapper is how a collapsed section
  // is spelled and its controls are not reachable either. The first cut
  // tested the element separately first, which could never decide anything
  // this did not already decide.
  // `inert` is the third spelling and it is the one a modal is most likely
  // to meet: it takes a whole subtree out of the tab order, out of hit
  // testing and out of the a11y tree at once.
  if (el.closest('[hidden],[aria-hidden="true"],[inert]')) return false
  // 🚨 CSS visibility, where the environment allows it. `display: none` and
  // `visibility: hidden` take an element out of the tab order and neither
  // is visible in the DOM — a Tailwind `hidden` class is the common case in
  // this app — so a filter built only on attributes puts things in the list
  // the browser will skip, and the trap leaks wherever the two disagree.
  // `checkVisibility` is a feature test, not a browser test: jsdom does not
  // implement it (it has no layout at all), so there it is `undefined` and
  // the semantic filter above stands alone — which is the only thing that
  // works under a test runner, and is why this is not `offsetParent`.
  // 🚨 `visibilityProperty: true`, `opacityProperty` left FALSE. Both are
  // deliberate: `visibility: hidden` takes an element out of the tab order
  // and must be skipped, while `opacity: 0` does NOT — and `opacity: 0` is
  // exactly how `HoverActions` hides a row's controls, because `display:
  // none` and `visibility: hidden` would take them out of the tab order,
  // which is the keyboard dead end Q17(b) exists to fix. Turning
  // `opacityProperty` on here would re-create it inside every dialog.
  if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ visibilityProperty: true })) return false
  return true
}

// ── Keyboard-focusable scrollers (B4c review round two) ─────────────────────
//
// Chromium 130 — Electron 33's — makes a scroll container a Tab stop of its
// own when nothing inside it can take one, so the arrow keys can scroll it.
// No selector names it (no tabindex, no role): the browser decides it from
// layout. Missing from the list, such a list had index -1 in Dialog's trap,
// which wrapped forward Tab to the first control: ✕ → list → ✕ for ever, the
// footer reachable only by Shift+Tab (measured on RelinkDialog's missing and
// "Will relink" lists, the status warning's pending tasks and New asset's
// template preview — each a plain list of rows that scrolls).
//
// The browser's rule, measured in Electron 33 with real Tab presses: an
// element whose computed overflow on an axis is `auto` or `scroll`, that
// overflows on that axis (its scroll size past its client size), with no
// keyboard-focusable descendant, and not at a negative tabindex. A control
// inside takes the stop instead, and so does an inner scroller that
// qualifies; a descendant at tabindex -1 does NOT (it can take focus, not
// the Tab key). `hidden` and `clip` never qualify, nor a box that fits.
//
// 🚨 THE ONE LAYOUT READ, and it only ever ADDS. The note above stands for
// the filter: jsdom has no layout, every scroll size there is 0, so no
// element overflows and this adds nothing under the test runner — the
// controls list is exactly what it was (the tests stub a list's sizes and
// style to reach this). Read in the cheap order: two integer comparisons
// per element, `getComputedStyle` only for the few that overflow.
function keyboardScrollers(node, controls) {
  const view = node.ownerDocument?.defaultView
  if (!view) return []
  const found = []
  const all = node.querySelectorAll('*')
  // Deepest first, so an inner scroller that qualifies is known before its
  // ancestors are asked whether anything inside them takes the Tab key.
  for (let k = all.length - 1; k >= 0; k--) {
    const el = all[k]
    if (!scrollsOverflow(el, view)) continue
    // A control, or anything with a tabindex (-1 included), is the list's
    // to decide above.
    if (el.matches(FOCUSABLE) || !tabbable(el)) continue
    if (controls.some((c) => el.contains(c)) || found.some((s) => el.contains(s))) continue
    found.push(el)
  }
  return found.reverse()
}

/** Overflows on an axis whose computed overflow is `auto` or `scroll`. */
function scrollsOverflow(el, view) {
  const y = el.scrollHeight > el.clientHeight
  const x = el.scrollWidth > el.clientWidth
  if (!x && !y) return false
  const style = view.getComputedStyle(el)
  const scrolls = (v) => v === 'auto' || v === 'scroll'
  return (y && scrolls(style.overflowY)) || (x && scrolls(style.overflowX))
}
