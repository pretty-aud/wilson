// =============================================================================
// CourseFilterChips — Session 11
//
// The "made just for you vs made to share" filters. A compact chip strip at the
// top of Sidebar 1, ABOVE the existing course list — not a filter page, not a
// new view (Audrey, 2026-07-29: keep the current layout).
//
// SUBJECTS INHERIT THIS, they do not get their own strip. A subject has no
// visibility of its own — otter_subjects_select derives it from the parent
// course through a live-parent EXISTS — so a tier filter on subjects would
// either match everything or nothing. Filtering the course list already scopes
// the subjects nested under it, which is the behaviour the request was after.
//
// UX LAWS APPLIED
//   Hick's Law          Six chips (seven for admins), one row, no submenus.
//   Serial Position     "All" first, then the two a user reaches for daily;
//                       "Recently deleted" last, where a rarely-used and mildly
//                       destructive-adjacent option belongs.
//   Law of Similarity   Every chip is the same shape; only the ACTIVE one is
//                       filled, so state is readable at a glance.
//   Fitts's Law         Chips wrap rather than scroll horizontally — a 200px
//                       column would otherwise hide half of them behind a drag.
//   Doherty Threshold   Filtering is client-side over a list already in memory;
//                       the only chip that fetches is "Recently deleted".
// =============================================================================

import { filtersFor } from './otterSharing.js'
import { Chip } from '../../../ui'

/**
 * @param {object}   props
 * @param {string}   props.value      active chip key
 * @param {function} props.onChange   (key) => void
 * @param {string}   props.role       app role, for the admin-only chip
 * @param {object}   props.counts     key -> number, rendered when > 0
 */
export default function CourseFilterChips({ value, onChange, role, counts = {} }) {
  const chips = filtersFor(role)
  // A3 (2026-09-24): the kit's Chip — the Label step, a hairline, and ONE
  // active treatment (the signal as a 16% tint with a 1px signal edge). It
  // was a white label on an orange-600 fill at 3.58:1, which the orange rule
  // (C6) does not allow under 19px bold. Every chip stays visible (C1; review
  // O19's overflow is a new control and is not taken), and they still wrap.
  return (
    <div className="otter-filter-chips" role="group" aria-label="Filter courses">
      {chips.map(chip => {
        const count = counts[chip.key]
        return (
          <Chip
            key={chip.key}
            active={value === chip.key}
            onClick={() => onChange(chip.key)}
            title={chip.hint}
            count={count > 0 ? count : null}
          >
            {chip.label}
          </Chip>
        )
      })}
    </div>
  )
}
