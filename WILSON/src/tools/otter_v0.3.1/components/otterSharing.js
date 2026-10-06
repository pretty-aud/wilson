// =============================================================================
// otterSharing.js — Session 11
//
// Pure vocabulary + predicates for O.T.T.E.R.'s three visibility tiers. Kept
// free of React so the filter rules — the part with real edge cases — can be
// unit-tested without rendering a 4,600-line component.
//
// EVERY consumer reads these fields off the row the SERVER returned
// (otter_course_index via course.list, or the RETURNING row of an update).
// Never off what the client sent: fn_otter_pin_course_identity SILENTLY REVERTS
// a visibility change it does not allow, so an optimistic update would show a
// course as shared that is still personal. That is the single most important
// rule in this file.
// =============================================================================

/** Tier -> what the user actually needs to know about it, in their words. */
export const VISIBILITY_META = {
  personal: {
    key: 'personal',
    label: 'Just for me',
    short: 'Personal',
    blurb: 'Only you can open this. Not even an admin can read it.',
  },
  shared: {
    key: 'shared',
    label: 'Share with the company',
    short: 'Shared',
    blurb: 'Everyone at the company can read it. You choose who can edit.',
  },
  company_standard: {
    key: 'company_standard',
    label: 'Company standard',
    short: 'Standard',
    blurb: 'The official version of this topic. Offered instead of generating a new course.',
  },
}

export const VISIBILITY_ORDER = ['personal', 'shared', 'company_standard']

export function visibilityMeta(visibility) {
  return VISIBILITY_META[visibility] ?? VISIBILITY_META.personal
}

// ── Filter chips ─────────────────────────────────────────────────────────────
// Hick's/Miller's Law: five chips at most, and the admin-only one is the fifth.
// Serial Position Effect puts the two the user reaches for constantly — their
// own work, and what was shared with them — first and second.
export const COURSE_FILTERS = [
  { key: 'all',      label: 'All',              hint: 'Everything you can open' },
  { key: 'mine',     label: 'Made for me',      hint: 'Courses you own' },
  { key: 'to_me',    label: 'Shared with me',   hint: "Colleagues' shared courses" },
  { key: 'by_me',    label: 'Shared by me',     hint: 'Your courses others can see' },
  { key: 'standard', label: 'Company standard', hint: 'The official versions' },
  { key: 'trash',    label: 'Recently deleted', hint: 'Restorable for 30 days' },
]

/** Admins additionally get a chip for the metadata-only rows they cannot open. */
export const ADMIN_ONLY_FILTER = {
  key: 'unopenable',
  label: 'Others’ personal',
  hint: 'You can see these exist, not what is in them',
}

/**
 * Does a course row belong under the given chip?
 *
 * `is_own` / `can_read_content` come straight from otter_course_index(). In
 * LOCAL (signed-out Electron) mode the Express server sends neither, so both
 * are undefined — hence the explicit `=== false` / `!== false` comparisons
 * throughout. A missing flag must mean "yours and readable", which is exactly
 * what single-user local mode is.
 */
export function courseMatchesFilter(course, filter) {
  if (!course) return false
  const isOwn = course.is_own !== false
  const vis = course.visibility ?? 'personal'

  switch (filter) {
    case 'all':
      // "Everything you can open" — deliberately NOT everything that exists.
      // An admin's index includes metadata-only rows for colleagues' personal
      // courses; listing those by default would fill the sidebar with entries
      // that do nothing when clicked. They get their own chip instead.
      return course.can_read_content !== false
    case 'mine':
      return isOwn
    case 'to_me':
      // Someone else's, and actually openable. An admin's metadata-only view of
      // a colleague's PERSONAL course is not "shared with me" — nothing was
      // shared, and the row cannot be opened.
      return !isOwn && course.can_read_content !== false
    case 'by_me':
      return isOwn && vis !== 'personal'
    case 'standard':
      return vis === 'company_standard'
    case 'unopenable':
      return course.can_read_content === false
    case 'trash':
      // Trash is served by otter_trash_index(), not by this list at all.
      return false
    default:
      return true
  }
}

/** Chips a given caller should see. Empty chips are still shown — a filter that
 *  vanishes when it has no results is a filter the user cannot trust. */
export function filtersFor(role) {
  return role === 'admin' ? [...COURSE_FILTERS, ADMIN_ONLY_FILTER] : COURSE_FILTERS
}

// ── Capability helpers ───────────────────────────────────────────────────────

/**
 * May the caller edit this course's CONTENT (generate, add subjects, validate)?
 *
 * Local mode sends no can_write, so undefined must read as true — otherwise
 * signing out of the cloud would disable every button in a single-user install.
 */
export function canWriteCourse(course) {
  return !course || course.can_write !== false
}

/** May the caller open the content at all, or is this a metadata-only row? */
export function canReadCourse(course) {
  return !course || course.can_read_content !== false
}

/**
 * Which tiers may this caller SET on this course?
 *
 * Mirrors fn_otter_pin_course_identity, which is the thing that actually
 * decides — offering an option the trigger will silently revert is worse than
 * not offering it, because the UI would show the change as having worked.
 *
 *   * only the owner (or an admin) may change visibility at all;
 *   * entering OR LEAVING company_standard is admin-only.
 */
export function selectableVisibilities(course, role) {
  const isAdmin = role === 'admin'
  const isOwn = course?.is_own !== false
  if (!isOwn && !isAdmin) return []
  if (course?.visibility === 'company_standard' && !isAdmin) return []
  return isAdmin ? VISIBILITY_ORDER : ['personal', 'shared']
}

/**
 * May the caller manage editor grants on this course?
 *
 * 0022's otter_course_editors_insert deliberately refuses an ADMIN granting on
 * a PERSONAL course: otherwise index -> self-grant -> read would defeat the
 * no-admin-content-bypass rule in two steps. That restriction was a critical
 * review finding in Session 10 and must not be "fixed" here.
 */
export function canManageEditors(course, role) {
  if (!course) return false
  if (course.is_own !== false) return true
  return role === 'admin' && course.visibility !== 'personal'
}

/**
 * The fork offer: is there a company-standard course for the name the user is
 * typing? Otter.jsx has always matched courses by lowercased name, so this uses
 * the same key — a fork of a different topic would be worse than no offer.
 */
export function findStandardByName(courseList, name) {
  const wanted = (name ?? '').trim().toLowerCase()
  if (!wanted) return null
  return (courseList ?? []).find(
    c => c.visibility === 'company_standard' && (c.name ?? '').toLowerCase() === wanted,
  ) ?? null
}

/** Whole days until a trashed row is swept, floored at 0. */
export function daysUntilPurge(purgesAt, now = Date.now()) {
  if (!purgesAt) return null
  const ms = new Date(purgesAt).getTime() - now
  if (Number.isNaN(ms)) return null
  return Math.max(0, Math.ceil(ms / 86400000))
}
