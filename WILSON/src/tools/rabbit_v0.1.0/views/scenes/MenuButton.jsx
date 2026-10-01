// ============================================================
// RABBIT — a named button that opens the kit Menu under it
// (post-overhaul S3b)
// ============================================================
//
// The shot lists' one "More" pattern: the bar's, a table row's and a picker
// row's. The kit Menu is a context menu at (x, y); this anchors it under the
// button's right edge and PORTALS it into <body> — inside a row's
// HoverActions it would fade out with the slot's opacity the moment the
// pointer left the row, and over a kit Dialog it must sit on the Menu's own
// layer (80, over the Dialog's 70), which a portal keeps whatever the
// parent clips. The Menu closes itself on Escape (marking it handled, so a
// Dialog under it stays), on a press outside and after an item. The click
// that opens it goes no further: a row that opens on a click must not.
// Nothing to offer, no button.
// ============================================================

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'
import { IconButton, Menu } from '../../../../ui'

export default function MenuButton({ title, items, minWidth = 200, Icon = MoreHorizontal }) {
  const [at, setAt] = useState(null)
  if (!items || items.length === 0) return null
  return (
    <>
      <IconButton
        size="sm"
        Icon={Icon}
        title={title}
        aria-expanded={!!at}
        onClick={e => {
          e.stopPropagation()
          const r = e.currentTarget.getBoundingClientRect()
          setAt({ x: r.right - minWidth, y: r.bottom + 4 })
        }}
        onDoubleClick={e => e.stopPropagation()}
      />
      {at && createPortal(
        <Menu x={at.x} y={at.y} minWidth={minWidth} items={items} onClose={() => setAt(null)} />,
        document.body,
      )}
    </>
  )
}
