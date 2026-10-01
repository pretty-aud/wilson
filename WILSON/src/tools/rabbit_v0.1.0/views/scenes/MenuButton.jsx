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

  // Focus into the menu as it opens; back to the button when it closes, if
  // focus went with the menu (an item was chosen, or Escape) — never away
  // from a control the person clicked outside it, nor from a dialog an item
  // opened (that dialog takes focus in its own effect, after this).
  useEffect(() => {
    if (!at) return undefined
    wrapRef.current?.querySelector('.ui-menu-item:not(:disabled)')?.focus()
    return () => {
      const active = document.activeElement
      if (!active || active === document.body) buttonRef.current?.focus()
    }
  }, [at])

  if (!items || items.length === 0) return null
  // An item's choice hands focus to the button first, while it is still in
  // the page, so a dialog the item opens remembers the button — not the item
  // about to go — as what to give focus back to.
  const live = items.map(it => (it && it.onClick && !it.disabled
    ? { ...it, onClick: () => { buttonRef.current?.focus(); it.onClick() } }
    : it))
  return (
    <>
      <IconButton
        ref={buttonRef}
        size="sm"
        Icon={Icon}
        title={title}
        aria-expanded={!!at}
        onMouseDown={() => {
          // The Menu's outside press closes it on this mousedown; the click
          // that follows must not open it again. Cleared by the next click
          // anywhere, so a press slid off the button suppresses nothing.
          if (!at) return
          swallowNextRef.current = true
          document.addEventListener('click', () => { swallowNextRef.current = false }, { once: true })
        }}
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
