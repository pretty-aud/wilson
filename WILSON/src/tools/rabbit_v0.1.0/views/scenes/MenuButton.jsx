// ============================================================
// RABBIT — a named button that opens the kit Menu under it
// (post-overhaul S3b)
// ============================================================
//
// The shot lists' one "More" pattern: the bar's, a table row's, a card's and
// a picker row's. The kit Menu is a context menu at (x, y); this anchors it
// under the button's right edge and PORTALS it — inside a row's HoverActions
// it would fade out with the slot's opacity the moment the pointer left the
// row. The Menu closes itself on Escape (marking it handled, so a Dialog
// under it stays), on a press outside and after an item. The click that
// opens it goes no further: a row or card that opens on a click must not.
// Nothing to offer, no button.
//
// Review round 1:
//  · R1-03 — a portal is still a React child: a click on an item bubbled
//    through the React tree to the card around the button and opened its
//    popup as well. The portal's own wrapper stops the click there.
//  · R1-09 — the kit Menu has no keyboard model (P1-05), so this gives it
//    the least that makes it usable: opening puts focus on the first item,
//    an item's choice or Escape puts it back on the button (or leaves it on
//    whatever the item opened), and Tab walks the items. Inside a kit Dialog
//    (the picker's rows) the menu is portalled into the DIALOG, so its focus
//    trap holds the items too — in <body> they were outside it. And the
//    button closes its own menu: the Menu's outside press closed it on the
//    mousedown and the click re-opened it (UsersSection's armSwallow).
//
// Review round 2 (R2-02): in Chromium that fix did not hold. A trusted
// event runs a microtask checkpoint after each listener, and React 19
// flushes the Menu's close (made in its document-capture mousedown) right
// there — so by the time the button's own onMouseDown ran, the menu was
// already closed in state and the swallow was never armed; the click opened
// it again. jsdom and act() run the old order, so the old test passed.
// Now a WINDOW-capture listener, live only while the menu is open, sees the
// press first: a press on the button arms the swallow before anything
// closes. The same listener says a press closed the menu, so focus is left
// where the person pressed — it went back to the button (scrolling a ⋯
// scrolled out of view back into it) before the browser could move it. It
// goes back only after Escape, and never scrolls.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'
import { IconButton, Menu } from '../../../../ui'

export default function MenuButton({ title, items, minWidth = 200, Icon = MoreHorizontal }) {
  const [at, setAt] = useState(null)   // { x, y, host }
  const buttonRef = useRef(null)
  const wrapRef = useRef(null)
  const swallowNextRef = useRef(false)
  const pressedRef = useRef(false)

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
    wrapRef.current?.querySelector('.ui-menu-item:not(:disabled)')?.focus()
    return () => {
      window.removeEventListener('mousedown', onPress, true)
      if (pressedRef.current) return
      const active = document.activeElement
      if (!active || active === document.body) buttonRef.current?.focus({ preventScroll: true })
    }
  }, [at])

  if (!items || items.length === 0) return null
  // An item's choice hands focus to the button first, while it is still in
  // the page, so a dialog the item opens remembers the button — not the item
  // about to go — as what to give focus back to. Without scrolling: the
  // table may have scrolled the button out of view while the menu was open.
  const live = items.map(it => (it && it.onClick && !it.disabled
    ? { ...it, onClick: () => { buttonRef.current?.focus({ preventScroll: true }); it.onClick() } }
    : it))
  return (
    <>
      <IconButton
        ref={buttonRef}
        size="sm"
        Icon={Icon}
        title={title}
        aria-expanded={!!at}
        onClick={e => {
          e.stopPropagation()
          if (swallowNextRef.current) { swallowNextRef.current = false; return }
          if (at) { setAt(null); return }
          const r = e.currentTarget.getBoundingClientRect()
          setAt({ x: r.right - minWidth, y: r.bottom + 4, host: e.currentTarget.closest('.ui-dialog') || document.body })
        }}
        onDoubleClick={e => e.stopPropagation()}
      />
      {at && createPortal(
        <div ref={wrapRef} onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
          <Menu x={at.x} y={at.y} minWidth={minWidth} items={live} onClose={() => setAt(null)} />
        </div>,
        at.host,
      )}
    </>
  )
}
