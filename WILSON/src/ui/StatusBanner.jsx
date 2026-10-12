// =============================================================================
// StatusBanner — an item's status as a band across a popup, directly under its
// title (FX3, kit request FX3-KR-2; Audrey, 2026-10-11: "right below the title
// of the item you had a color banner/bar that was the color of the status ...
// lets add the back in").
//
// It IS StatusBadge, drawn at the band's width: the same dot, the same word
// and the Label step, from the one STATUS map, so a popup's banner and its
// row's status chip can never disagree. The band drops the badge's tint (her
// second word, the same day: "remove the green bar the text is in ... leave
// just the color dot and the color line below the title") and adds only its
// geometry (`.ui-status-banner`: full width, 28px, the gutter) and one hairline
// of the tone across its foot — no 2px edge, no colour of its own.
// It follows the status it is given: re-rendered with another status (a change
// in the popup, an undo) it recolours with the row.
//
// Placed by Dialog's `band` slot, between the title row and the body, so it
// spans the popup and never scrolls with the fields.
// =============================================================================

import { StatusBadge } from './StatusBadge'

export function StatusBanner({ className = '', ...rest }) {
  return <StatusBadge {...rest} className={`ui-status-banner ${className}`.trim()} />
}

export default StatusBanner
