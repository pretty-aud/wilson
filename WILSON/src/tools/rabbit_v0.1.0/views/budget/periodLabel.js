// =============================================================================
// periodLabel.js — the Crew/team and Talent tables' period headers ("Wk3
// 10/19", "P2 10/19", "#4"), counted from the project's start date
// (post-overhaul S5c; docs/OUTSTANDING.md P1-32a, the Budget's half).
//
// Both tabs wrote `new Date(projectStart)`: a stored DATE read as UTC
// midnight, so west of Greenwich every header named the day BEFORE (dates.js's
// header says why). And they stepped by 86,400,000 ms, which across a
// daylight-saving change lands an hour off midnight — in the autumn, on the
// evening before, so a header two weeks after the clocks go back named the
// wrong day again. The start is read through dates.js, local, and the periods
// are stepped on the calendar. The header keeps its month/day exactly as it
// was printed ("12/01").
// =============================================================================

import { parseIsoDate, showDate } from '../../dates'

/**
 * The header of period `index` (0-based) in `mode` ('weekly', 'fortnightly' —
 * the default — or 'count'), from `projectStart` (a stored date; none counts
 * from `today`).
 */
export function periodLabel(index, mode, projectStart, today = new Date()) {
  if (mode === 'count') return `#${index + 1}`
  const d = parseIsoDate(projectStart) || parseIsoDate(today)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + (mode === 'weekly' ? index * 7 : index * 14))
  const day = showDate(d, { locale: 'en-US', month: '2-digit', day: '2-digit' })
  return mode === 'weekly' ? `Wk${index + 1} ${day}` : `P${index + 1} ${day}`
}
