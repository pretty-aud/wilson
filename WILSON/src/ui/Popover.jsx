// =============================================================================
// Popover — a non-modal floating card (post-overhaul VW1b, 2026-10-17: the
// kit request VW1-KR-1 of docs/design/CUSTOM_VIEWS_DESIGN.md §8, with its
// first caller, the Tasks table's item picker).
//
// `role="dialog"` with a label, NOT `aria-modal`: the page behind stays live
// (Jakob: a Notion relation cell's picker). Paper-raised, the 6px float
// radius, the one float shadow, opacity-only motion (`ui-fade-in`, stopped
// under reduced motion).
//
// ── The PORTALLED form (this file's only form today) ────────────────────────
// Rendered into <body> at `position: fixed`, placed from the anchor's box when
// it opens, because the anchor sits inside a scroller that clips anything in
// place (the Tasks table's `.ui-table-scroll`). Under the anchor's left edge;
// ABOVE it when less than 240px is free below and more is free above; never
// taller than the room on its side less 12px, scrolling inside past that.
// VW1b review round 1 (R1-6): `minLeft`, a viewport x the card's left edge
// does not go under — a trigger partly covered (the Tasks table's sticky
// Title over a cell scrolled under it) names where the cover ends.
// ── The IN-PLACE form (`inPlace`; post-overhaul VW1d, 2026-10-25) ───────────
// Its first caller is the custom views' dropdown (CUSTOM_VIEWS_DESIGN.md
// §4.2, §8 KR-1, as VW1d's step 0 review corrected them). No portal: it is
// rendered where its caller puts it, right after the trigger, and sits
// `position: absolute` under the trigger's left edge inside the caller's
// `position: relative` wrapper (index.css, `[data-place="inline"]`), as wide
// as `width` says at every render (a card may widen it, keeping its left
// edge) but never past the window's right edge less 12px (VW1d code review
// round 1, R1-11: at Electron's 1024px floor a 560px card ran off it), as
// tall as the room below the trigger less 12px (both measured at its open),
// scrolling inside past that. The Tab order is the document's own:
// it follows its trigger, so Tab moves through it and on to the next
// control, and focus LEAVING it — for anything but a kit Menu, Dialog or
// Popover — closes it (`onClose('tab')`: Tab past its last control,
// Shift+Tab back onto the trigger). It moves with its trigger, so a scroll
// or a resize does not close it. Escape and outside presses as the portalled
// form; `onClose(why)` lets the caller decide what Escape does (a field
// open inside it, a card that goes back) — closing is the caller's state.
//
// ── VW1d step 0 review, finding 2 (both forms) ──────────────────────────────
// The portalled form's Tab rule now holds only for a key whose target is
// INSIDE the card, and only while no layer opened after it is open: a kit
// Menu portalled from a MenuButton in the card, or a Dialog rendered under
// it, sends its keydown up the React tree to the card's handler, which read
// a Tab inside them as "from the last control" (index -1) and closed itself.
//
// ── Layers (overlay.js) ─────────────────────────────────────────────────────
// Popovers keep a stack; only the TOP one answers Escape and outside presses.
// A layer opened after it — a kit Dialog (the picker's "Remove the last
// item" question) or a kit Menu — takes the key and the press: the Popover
// stands down while modalDepth() or menuDepth() is above what it was at its
// open. Escape is heard in the CAPTURE phase and marked handled, so a Dialog
// UNDER the Popover (its bubble-phase listener checks `defaultPrevented`)
// stays open; a Menu opened inside it closes first because it is newer.
// z-index 70, the Dialog's: equal layers stack by document order, so a
// Dialog opened after the Popover covers it and a Popover opened from a
// Dialog sits over it.
//
// A press outside closes it (not one on the anchor, whose own click toggles
// it; not one inside a Menu, a Dialog or another Popover). A scroll of
// anything that holds the anchor (or of the page) closes it, as does a
// resize: its place was measured from the anchor's box once.
//
// ── Focus ───────────────────────────────────────────────────────────────────
// In on open: `initialFocus` (a ref), else the first control, else the card.
// Back on close to `returnFocus()` (a function, so a caller whose anchor was
// re-rendered can name the one on screen now), else the anchor — only when
// focus was still inside the card (a press elsewhere keeps its own focus).
// The portal keeps the Tab order itself: Tab from the card's last control
// closes it and moves on to the control AFTER the anchor; Shift+Tab from its
// first closes it and returns to the anchor.
// =============================================================================

import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { pushPopover, isTopPopover, modalDepth, menuDepth, focusableWithin } from './overlay'

// Between the anchor and the card; the card's distance from the window's
// edges; the room below under which it opens above (the design's 240px).
const GAP = 4
const EDGE = 12
const ROOM_BELOW = 240
// The in-place form's least width, however near the window's edge its
// trigger sits (VW1d code review round 2, R2-10: at the edge its room was 0,
// a card no one could read with the keyboard inside it).
const MIN_INLINE_WIDTH = 240

/** Where the card goes, from the anchor's box at its open. */
function placePopover(rect, width, vw, vh, minLeft = null) {
  const w = Math.max(0, Math.min(width, vw - 2 * EDGE))
  const from = Number.isFinite(minLeft) ? Math.max(rect.left, minLeft) : rect.left
  const left = Math.max(EDGE, Math.min(from, vw - w - EDGE))
  const below = vh - rect.bottom - GAP
  const above = rect.top - GAP
  if (below < ROOM_BELOW && above > below) {
    return { side: 'above', left, width: w, bottom: vh - rect.top + GAP, maxHeight: Math.max(0, above - EDGE) }
  }
  return { side: 'below', left, width: w, top: rect.bottom + GAP, maxHeight: Math.max(0, below - EDGE) }
}

// The control the Tab key reaches after `el`, skipping what `skip` holds.
function focusableAfter(el, skip) {
  if (!el || !el.ownerDocument) return null
  const all = focusableWithin(el.ownerDocument.body).filter((x) => !(skip && skip.contains(x)))
  const i = all.indexOf(el)
  if (i >= 0) return all[i + 1] || null
  return all.find((x) => el.compareDocumentPosition(x) & 4) || null
}

// A layer that is not the card's own, which focus may move into without
// closing an in-place card: a kit Menu, a Dialog (or its backdrop), another
// Popover.
const OTHER_LAYER = '.ui-menu, .ui-dialog, .ui-dialog-backdrop, .ui-popover'

export function Popover({
  anchor,
  label,
  onClose,
  width = 280,
  minLeft = null,
  initialFocus = null,
  returnFocus = null,
  inPlace = false,
  className = '',
  children,
  ...rest
}) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const returnRef = useRef(returnFocus)
  returnRef.current = returnFocus
  // The layers open at the card's open (the effect sets it): one opened
  // after it takes the keys (finding 2).
  const layersAtRef = useRef({ modals: 0, menus: 0 })
  // True while the card hands focus back to its trigger (its own cleanup).
  const restoringRef = useRef(false)
  const newerLayerNow = () => modalDepth() > layersAtRef.current.modals || menuDepth() > layersAtRef.current.menus
  // The anchor on screen now: the caller's, when it names one.
  const anchorRef = useRef(anchor)
  const currentAnchor = () => {
    const named = typeof returnRef.current === 'function' ? returnRef.current() : null
    return (named && named.isConnected) ? named : anchorRef.current
  }
  // Measured once, at the open (a scroll or a resize closes the portalled
  // form; the in-place form moves with its trigger and keeps its height).
  const [place] = useState(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1400
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900
    const rect = anchor?.getBoundingClientRect?.() || { left: 0, top: 0, bottom: 0 }
    if (inPlace) return { side: 'below', maxHeight: Math.max(0, vh - rect.bottom - GAP - EDGE), maxWidth: Math.max(0, vw - rect.left - EDGE) }
    return placePopover(rect, width, vw, vh, minLeft)
  })

  // A layout effect: its cleanup runs while the card is still in the
  // document, so "was focus inside it?" can still be asked.
  useLayoutEffect(() => {
    const id = {}
    const unregister = pushPopover(id)
    const modalsAt = modalDepth()
    const menusAt = menuDepth()
    layersAtRef.current = { modals: modalsAt, menus: menusAt }
    const node = ref.current
    const newerLayer = () => modalDepth() > modalsAt || menuDepth() > menusAt
    const close = (why) => closeRef.current?.(why)

    // ── Focus in ──
    if (node && !node.contains(document.activeElement)) {
      const target = initialFocus?.current || focusableWithin(node)[0] || node
      target.focus?.()
    }

    const key = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (!isTopPopover(id) || newerLayer()) return
      e.preventDefault()
      close('escape')
    }
    const down = (e) => {
      if (!isTopPopover(id) || newerLayer()) return
      const t = e.target
      if (!(t instanceof Node)) return
      if (node && node.contains(t)) return
      const a = currentAnchor()
      if (a && a.contains(t)) return
      if (t instanceof Element && t.closest('.ui-menu, .ui-dialog-backdrop, .ui-popover')) return
      close('outside')
    }
    const scrolled = (e) => {
      const t = e.target
      if (node && t instanceof Node && node.contains(t)) return
      const a = currentAnchor()
      if (t === document || t === document.documentElement || t === document.body
        || (t instanceof Node && a && t.contains(a))) close('scroll')
    }
    const resized = () => close('resize')
    document.addEventListener('keydown', key, true)
    document.addEventListener('mousedown', down, true)
    // The in-place form moves with its trigger: no scroll or resize rule.
    if (!inPlace) window.addEventListener('resize', resized)
    // The scroll rule from the NEXT frame (step 0 review, finding 8): a
    // scroll its own opening caused (a focus that brought the trigger into
    // view, a wheel's last tick) must not close it at once.
    const nextFrame = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (f) => setTimeout(f, 16)
    const cancelFrame = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout
    let hearing = false
    const frame = inPlace ? null : nextFrame(() => { hearing = true; document.addEventListener('scroll', scrolled, true) })
    return () => {
      if (frame != null) cancelFrame(frame)
      document.removeEventListener('keydown', key, true)
      document.removeEventListener('mousedown', down, true)
      if (hearing) document.removeEventListener('scroll', scrolled, true)
      if (!inPlace) window.removeEventListener('resize', resized)
      unregister()
      // ── Focus back ── only when it was still in the card (or nowhere).
      // The in-place form's blur rule must not read its own hand-back as
      // focus leaving it: in React's StrictMode (`npm run dev`) this cleanup
      // runs once at mount and the card stays, and the blur closed it (VW1d,
      // measured on 5298).
      const active = document.activeElement
      if (!active || active === document.body || (node && node.contains(active))) {
        const back = currentAnchor()
        restoringRef.current = true
        try {
          if (back && back.isConnected) back.focus?.()
        } finally {
          restoringRef.current = false
        }
      }
    }
    // Registered once per mount, as Dialog is: a re-render must not move it
    // up the stack.
  }, [])

  // The Tab order a portal would otherwise lose (the card is at the end of
  // <body>, far from its anchor). The in-place form keeps the document's.
  // Only a key inside the card, with no newer layer open (finding 2): a
  // portalled Menu's or a Dialog's keydown bubbles here through React.
  function onKeyDown(e) {
    rest.onKeyDown?.(e)
    if (inPlace || e.defaultPrevented || e.key !== 'Tab') return
    const node = ref.current
    if (!node || !(e.target instanceof Node) || !node.contains(e.target) || newerLayerNow()) return
    const items = focusableWithin(node)
    const i = items.indexOf(document.activeElement)
    if (e.shiftKey ? i <= 0 : (i === -1 || i === items.length - 1)) {
      const a = currentAnchor()
      const to = e.shiftKey ? a : focusableAfter(a, node)
      e.preventDefault()
      to?.focus?.()
      closeRef.current?.('tab')
    }
  }

  // The in-place form closes when focus leaves it for anything but another
  // kit layer (Tab past its last control, Shift+Tab back onto the trigger).
  // A blur with nowhere to go (a press on the page) is the outside press's.
  function onBlur(e) {
    rest.onBlur?.(e)
    if (!inPlace || restoringRef.current) return
    const to = e.relatedTarget
    const node = ref.current
    if (!(to instanceof Element) || !node || node.contains(to)) return
    if (to.closest(OTHER_LAYER)) return
    closeRef.current?.('tab')
  }

  if (inPlace) {
    return (
      <div
        {...rest}
        ref={ref}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        className={`ui-popover ${className}`.trim()}
        data-place="inline"
        data-side="below"
        data-surface="dark"
        style={{ width: Math.min(width, Math.max(MIN_INLINE_WIDTH, place.maxWidth)), maxHeight: place.maxHeight }}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      >
        {children}
      </div>
    )
  }

  const style = {
    left: place.left,
    width: place.width,
    maxHeight: place.maxHeight,
    ...(place.side === 'above' ? { bottom: place.bottom } : { top: place.top }),
  }
  return createPortal(
    <div
      {...rest}
      ref={ref}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={`ui-popover ${className}`.trim()}
      data-side={place.side}
      data-surface="dark"
      style={style}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>,
    document.body,
  )
}

export default Popover
