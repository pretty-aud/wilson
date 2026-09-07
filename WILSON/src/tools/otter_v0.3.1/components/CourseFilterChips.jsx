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

/**
 * @param {object}   props
 * @param {string}   props.value      active chip key
 * @param {function} props.onChange   (key) => void
 * @param {string}   props.role       app role, for the admin-only chip
 * @param {object}   props.counts     key -> number, rendered when > 0
 */
export default function CourseFilterChips({ value, onChange, role, counts = {} }) {
  const chips = filtersFor(role)

  return (
    <div
      className="flex flex-wrap gap-1 px-2 py-1.5 border-b-2 border-stone-600 shrink-0"
      role="group"
      aria-label="Filter courses"
    >
      {chips.map(chip => {
        const active = value === chip.key
        const count = counts[chip.key]
        return (
          <button
            key={chip.key}
            type="button"
            onClick={() => onChange(chip.key)}
            title={chip.hint}
            aria-pressed={active}
            className={`px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase tracking-wide border transition-colors ${
              active
                ? 'bg-orange-600 text-white border-orange-700'
                : 'bg-stone-900 text-stone-400 border-stone-700 hover:border-stone-500 hover:text-stone-300'
            }`}
          >
            {chip.label}
            {count > 0 && (
              <span className={active ? 'ml-1 text-orange-100' : 'ml-1 text-stone-600'}>{count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
