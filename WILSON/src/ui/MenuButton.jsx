// =============================================================================
// MenuButton — a button that opens the kit Menu under it (post-overhaul S3b
// as views/scenes/MenuButton.jsx; promoted to the kit by post-overhaul VW1d,
// 2026-10-25, the kit request VW1-KR-3 of docs/design/CUSTOM_VIEWS_DESIGN.md
// §8, as VW1d's step 0 review corrected it, finding 9).
//
// Its callers: the shot lists' "More" (the bar's, a table row's, a card's, a
// picker row's), the custom views' *…* per view, the Tasks toolbar's one
// *New* (her Q-A1), and a group's *…* (*Remove grouping*, her Q-D5).
//
// The kit Menu is a context menu at (x, y); this anchors it under the button
// — the icon form under its RIGHT edge, the labelled form (`label`, a kit
// Button with its variant and icon, for *New*) under its LEFT — and PORTALS
// it: inside a row's HoverActions it would fade out with the slot's opacity
// the moment the pointer left the row (and the slot stays shown while the
// menu is open: index.css, `.ui-hover-actions:has([aria-expanded="true"])`).
// The click that opens it goes no further: a row or card that opens on a
// click must not. Nothing to offer, no button.
//
// ── The keyboard (VW1-KR-3) ─────────────────────────────────────────────────
// The kit Menu has no roles and no arrow keys of its own (its note: "F2 adds
// the keyboard model and the roles together"), so this gives its menu the
// model, WITHOUT the roles (roles would promise a suppressed Tab): focus on
// the first item at the open; ↑ / ↓ (wrapping) and Home / End between the
// items; Enter or Space chooses (a button's own); Escape closes (the Menu
// marks it handled, so a Dialog or a Popover under it stays) and gives focus
// back to the button; Tab past the last item closes it and moves on to the
// control after the button, Shift+Tab before the first closes it and goes
// back to the button. Every key in the menu stops at the menu: a list that
// moves between its rows with the arrows (the views list's grid) never sees
// them. `tabIndex`, `aria-label`, `onKeyDown` and `onFocus` reach the button
// (the views list's roving Tab stop), and its ref is forwarded.
//
// ── Kept from S3b's two review rounds ───────────────────────────────────────
//  · R1-03 — a portal is still a React child: a click on an item bubbled
//    through the React tree to the card around the button and opened its
//    popup as well. The portal's own wrapper stops the click there.
//  · R1-09 — opening puts focus on the first item, an item's choice or Escape
//    puts it back on the button (or leaves it on whatever the item opened).
//    Inside a kit Dialog the menu is portalled into the DIALOG, so its focus
//    trap holds the items too — in <body> they were outside it. And the
//    button closes its own menu.
//  · R2-02 — in Chromium a trusted event runs a microtask checkpoint after
//    each listener, and React 19 flushes the Menu's close (made in its
//    document-capture mousedown) right there — so a WINDOW-capture listener,
//    live only while the menu is open, sees the press first: a press on the
//    button arms the swallow before anything closes. The same listener says a
//    press closed the menu, so focus is left where the person pressed. It
//    goes back only after Escape, and never scrolls.
// =============================================================================

import { forwardRef, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, MoreHorizontal } from 'lucide-react'
import { IconButton } from './IconButton'
import { Button } from './Button'
import { Menu } from './Menu'
import { focusableWithin } from './overlay'

const ITEM = '.ui-menu-item:not(:disabled)'

export const MenuButton = forwardRef(function MenuButton({
  title,
  items,
  minWidth = 200,
  Icon = MoreHorizontal,
  label = null,
  variant = 'secondary',
  ButtonIcon = null,
  tabIndex,
  onKeyDown,
  onFocus,
  className = '',
  'aria-label': ariaLabel,
}, outerRef) {
  const [at, setAt] = useState(null)   // { x, y, host }
  const buttonRef = useRef(null)
  const wrapRef = useRef(null)
  const swallowNextRef = useRef(false)
  const pressedRef = useRef(false)
  const setButton = (el) => {
    buttonRef.current = el
    if (typeof outerRef === 'function') outerRef(el)
    else if (outerRef) outerRef.current = el
  }

  // A press on the button while its menu is open: its click must not open
  // the menu the press closed. Cleared by a release off the button (a press
  // slid off is a click cancelled) and by the next click anywhere, so no
  // other gesture is ever swallowed.
  const armSwallow = () => {
    swallowNextRef.current = true
    const clear = () => { swallowNextRef.current = false }
    document.addEventListener('mouseup', (e) => { if (!buttonRef.current?.contains(e.target)) clear() }, { capture: true, once: true })
    document.addEventListener('click', clear, { once: true })
  }

  // Focus into the menu as it opens. While it is open a press anywhere
  // outside it is seen FIRST (window, capture — before the Menu's own
  // document listener closes it). When it closes, focus goes back to the
  // button only if no press closed it and focus went with the menu (Escape;
  // an item hands focus to the button itself, below) — never from where a
  // press is about to put it, nor from a dialog an item opened (that dialog
  // takes focus in its own effect, after this) — and without scrolling.
  useEffect(() => {
    if (!at) return undefined
    pressedRef.current = false
    const onPress = (e) => {
      if (wrapRef.current?.contains(e.target)) return
      pressedRef.current = true
      if (buttonRef.current?.contains(e.target)) armSwallow()
    }
    window.addEventListener('mousedown', onPress, true)
    wrapRef.current?.querySelector(ITEM)?.focus()
    return () => {
      window.removeEventListener('mousedown', onPress, true)
      if (pressedRef.current) return
      const active = document.activeElement
      if (!active || active === document.body) buttonRef.current?.focus({ preventScroll: true })
    }
  }, [at])

  if (!items || items.length === 0) return null

  // The keyboard model (VW1-KR-3): every key stops at the menu.
  function onMenuKey(e) {
    e.stopPropagation()
    const list = [...(wrapRef.current?.querySelectorAll(ITEM) || [])]
    if (list.length === 0) return
    const i = list.indexOf(document.activeElement)
    const go = (n) => { e.preventDefault(); list[(n + list.length) % list.length]?.focus() }
    if (e.key === 'ArrowDown') go(i < 0 ? 0 : i + 1)
    else if (e.key === 'ArrowUp') go(i < 0 ? list.length - 1 : i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(list.length - 1)
    else if (e.key === 'Tab' && (e.shiftKey ? i <= 0 : i === list.length - 1)) {
      e.preventDefault()
      const button = buttonRef.current
      let to = button
      if (!e.shiftKey && button) {
        const all = focusableWithin(button.ownerDocument.body).filter((x) => !wrapRef.current?.contains(x))
        to = all[all.indexOf(button) + 1] || button
      }
      setAt(null)
      to?.focus({ preventScroll: true })
    }
  }

  // An item's choice hands focus to the button first, while it is still in
  // the page, so a dialog the item opens remembers the button — not the item
  // about to go — as what to give focus back to. Without scrolling: the
  // table may have scrolled the button out of view while the menu was open.
  const live = items.map(it => (it && it.onClick && !it.disabled
    ? { ...it, onClick: () => { buttonRef.current?.focus({ preventScroll: true }); it.onClick() } }
    : it))
  const toggle = (e) => {
    e.stopPropagation()
    if (swallowNextRef.current) { swallowNextRef.current = false; return }
    if (at) { setAt(null); return }
    const r = e.currentTarget.getBoundingClientRect()
    setAt({ x: label != null ? r.left : r.right - minWidth, y: r.bottom + 4, host: e.currentTarget.closest('.ui-dialog') || document.body })
  }
  const shared = {
    ref: setButton,
    'aria-expanded': !!at,
    // Without menu roles, the honest hint (VW1d code review round 1, R1-15).
    'aria-haspopup': 'true',
    'aria-label': ariaLabel,
    tabIndex,
    onKeyDown,
    onFocus,
    onClick: toggle,
    onDoubleClick: e => e.stopPropagation(),
  }
  return (
    <>
      {label != null ? (
        <Button size="sm" variant={variant} Icon={ButtonIcon} title={title} className={className} {...shared}>
          {label}
          <ChevronDown aria-hidden="true" />
        </Button>
      ) : (
        <IconButton size="sm" Icon={Icon} title={title} className={className} {...shared} />
      )}
      {at && createPortal(
        <div ref={wrapRef} onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onKeyDown={onMenuKey}>
          <Menu x={at.x} y={at.y} minWidth={minWidth} items={live} onClose={() => setAt(null)} />
        </div>,
        at.host,
      )}
    </>
  )
})

export default MenuButton
