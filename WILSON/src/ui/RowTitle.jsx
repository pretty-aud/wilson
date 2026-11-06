// =============================================================================
// RowTitle — a table row's name, and its buttons right after the words
// (post-overhaul FX8, kit request FX8-KR-1).
//
// Audrey, 2026-10-12: "lets move them all closer to the title of the items in
// the tables ... some have them in different places like assets and tasks have
// it all the way to the right of the title but the scenes has it all the way
// at right end of the row. lets make this more uniform."
//
// One arrangement for every table whose rows open an item's window: the
// words, then — the kit's 4px after the words' own box — the row's buttons in
// the kit's HoverActions, in one order: Open (the page icon) first, the
// row's own extras, Delete last. The CALLER passes them in that order; this
// lays them out. The words take what they need, up to the cell, and cut with
// their own ellipsis; the buttons never shrink, so a long name is cut before
// a button moves. The slot is HoverActions: shown while the row is hovered
// and while focus is inside it, its space always held (opacity only), so the
// row never reflows under the pointer and every button stays in the Tab order
// right after the words. While the words are a field (an inline rename), the
// field takes the cell's width and the buttons wait at its end.
//
// The words' element is the lane's (a button that opens a rename, a span, a
// field): it fills the words box, so a lane that pads its words 6px — every
// one does — gets 10px from the last letter to the first button.
// =============================================================================

import { HoverActions } from './HoverActions'

export function RowTitle({ children, actions = null, className = '', ...rest }) {
  return (
    <span className={`ui-row-title ${className}`.trim()} {...rest}>
      <span className="ui-row-title-words">{children}</span>
      {actions ? <HoverActions className="ui-row-title-acts">{actions}</HoverActions> : null}
    </span>
  )
}

export default RowTitle
