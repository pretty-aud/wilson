// ============================================================
// RABBIT — BudgetPopover: lane B5's one floating editor (R3-32)
// ============================================================
//
// The Budget had five hand-rolled popovers (an ActualPopover and a
// MarginContPopover each in CrewTeamTab and TalentTab, and the Expenses tab's
// ExpenseMarginContPopover), each with the same three lines of clamping maths
// over a HARD-CODED 280 x 280 or 280 x 320 box, its own document listener, a
// 2px orange border and its own shadow. This is the one they become.
//
// The kit has no Popover (A2-KR-1 did not land; recorded again as B5-KR-1),
// so this is built on the kit's FLOAT tokens, the kit Menu's surface: the
// raised paper, `--radius-float`, the float shadow and one hairline.
//
//   · It is portalled into <body>, so no ancestor's transform, scroll or
//     stacking can move it or clip it (W9's trap, and the one the Crew and
//     Talent tables' horizontal scrollers would set).
//   · It is placed from its OWN measured box, after mount and before paint:
//     under the anchor if it fits, else above it, else as low as the window
//     allows; its left edge on the anchor's, pulled in from the right edge.
//     A popover whose content grows is placed by the height it has, not by a
//     number written beside it.
//   · It closes the way the hand-rolled ones did — a mousedown anywhere
//     outside it (on the document, bubbling), or its Close button — and on
//     Escape. None of the five closed on Escape: that is Q17's ruled
//     behaviour for a floating surface (the kit Menu's), added here. The key
//     is taken in the capture phase and marked handled, as the Menu marks
//     it, so a Dialog under the popover stands down on the same key.
//
// `anchor` is the rect the callers already store ({ x, y, h }: the cell's
// left, top and height); `width` is the caller's, in px (the five were 280).
// ============================================================

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { IconButton } from '../../../../ui'
import '../rabbitBudget.css'

/** The gap between the anchor and the popover, and the least distance kept
    from the window's edges: the hand-rolled copies' 4 and 12. */
const GAP = 4
const EDGE = 12

/** Where a box of `w` x `h` goes beside `anchor` in a `vw` x `vh` window:
    below the anchor when it fits there, else above it, else as low as the
    window allows; its left edge on the anchor's, pulled in from the right
    edge. Whole pixels. */
export function placePopover(anchor, w, h, vw, vh) {
  const x = Math.max(EDGE, Math.min(anchor.x, vw - w - EDGE))
  const below = anchor.y + anchor.h + GAP
  const above = anchor.y - h - GAP
  let y = Math.max(EDGE, vh - h - EDGE)
  if (below + h <= vh - EDGE) y = below
  else if (above >= EDGE) y = above
  return { x: Math.round(x), y: Math.round(y) }
}

export default function BudgetPopover({ anchor, title, onClose, children, width = 280 }) {
  const ref = useRef(null)
  const [place, setPlace] = useState(() => placePopover(anchor, width, 0, window.innerWidth, window.innerHeight))

  useEffect(() => {
    function onDown(e) { if (ref.current && !ref.current.contains(e.target)) onClose() }
    function onKey(e) {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  // Measured after every commit, before paint: the box a render produced is
  // the box that is placed. A placement that has not moved sets nothing, so
  // this settles in one pass.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const next = placePopover(anchor, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight)
    if (next.x !== place.x || next.y !== place.y) setPlace(next)
  })

  return createPortal(
    <div ref={ref} className="rb-pop-panel" role="dialog" aria-label={title} style={{ '--rb-pop-w': width, '--rb-pop-x': place.x, '--rb-pop-y': place.y }}>
      <div className="rb-pop-head">
        <span className="rb-pop-title">{title}</span>
        <IconButton size="sm" Icon={X} title="Close" onClick={onClose} />
      </div>
      <div className="rb-pop-body">{children}</div>
    </div>,
    document.body,
  )
}
