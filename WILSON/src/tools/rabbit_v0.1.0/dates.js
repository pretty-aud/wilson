// =============================================================================
// dates.js — R.A.B.B.I.T.'s calendar dates, read as the LOCAL day they name.
// Post-overhaul S1, 2026-09-30 (rulings B3, B4, B5).
//
// Every date R.A.B.B.I.T. stores — a task's, a phase's, an asset's, a
// scene's, a shot's, a key date's, a project's — is a Postgres DATE. PostgREST
// returns it as 'YYYY-MM-DD', the Local Server spreads the same string, and
// the client writes local y-m-d. But the language reads the date-only ISO
// forms ('YYYY-MM-DD', and 'YYYY-MM' and 'YYYY') as UTC midnight, so west of
// Greenwich the local day is the day BEFORE: on Audrey's Eastern machine
// `new Date('2026-12-01').getDate()` is 30. Every bar drew a day early, a bar
// dropped on Dec 3 was stored as Dec 3 and redrawn on Dec 2, and an editor
// opened a day early and saved that day back.
//
// Audrey, 2026-09-29: "i just need it to land where i place it … if im in
// east coast that is fine. because the project will be run from the timezone
// the timeline is made in." So: local dates, no zone arithmetic. A date-only
// string is the local midnight of the day it names; anything else (a
// timestamp, a Date) keeps the language's own reading.
//
// One helper for every surface (B5): the Timeline, the Projects page (P1-20)
// and the Tasks view read through here, and the shot-list and budget
// sessions reuse it.
// =============================================================================

/** The date-only ISO forms: a year, a year and month, or a whole date. */
const ISO_DATE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * A stored date as a Date at LOCAL midnight of the day it names.
 *
 *   '2026-12-01'            → 1 Dec 2026, 00:00 local, wherever the machine is
 *   '2026-12', '2026'       → the 1st of that month / of January, local
 *   a Date                  → a copy of it
 *   anything else parseable → `new Date(s)` (a timestamp is an instant)
 *   '', null, undefined, an impossible day ('2026-02-30'), garbage → null
 *
 * Never an Invalid Date: a caller tests for null, not for NaN. A year below
 * 100 is that year (`new Date(y, …)` would read 26 as 1926).
 */
export function parseIsoDate(s) {
  if (s == null || s === '') return null
  if (s instanceof Date) return Number.isNaN(s.getTime()) ? null : new Date(s.getTime())
  const m = ISO_DATE.exec(String(s))
  if (m) {
    const y = Number(m[1])
    const mo = m[2] === undefined ? 0 : Number(m[2]) - 1
    const d = m[3] === undefined ? 1 : Number(m[3])
    const out = new Date(2000, 0, 1)
    out.setFullYear(y, mo, d)
    out.setHours(0, 0, 0, 0)
    // `setFullYear(2026, 1, 30)` rolls over to 2 March; a DATE column cannot
    // hold 30 February, so a string that names it is not a date.
    if (out.getFullYear() !== y || out.getMonth() !== mo || out.getDate() !== d) return null
    return out
  }
  const out = new Date(s)
  return Number.isNaN(out.getTime()) ? null : out
}

const pad = (n, width = 2) => String(n).padStart(width, '0')

/**
 * The local y-m-d of a date, as a DATE column stores it and a date input
 * shows it (the year in four digits). Takes a Date or anything
 * `parseIsoDate` reads; null when there is no date. The inverse of
 * `parseIsoDate` for every day of the years 0001–9999.
 */
export function toIsoDate(d) {
  const x = d instanceof Date ? d : parseIsoDate(d)
  if (!x || Number.isNaN(x.getTime())) return null
  return `${pad(x.getFullYear(), 4)}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}

/**
 * Whole calendar days from `a` to `b` (negative when `b` is earlier), each a
 * stored date or a Date, counted on the local calendar: the difference of
 * the two local midnights, ROUNDED — it is a whole number of days give or
 * take the hour a daylight-saving change adds or removes, which `Math.ceil`
 * turned into an extra day. null when either is missing.
 */
export function calendarDaysBetween(a, b) {
  const x = parseIsoDate(a)
  const y = parseIsoDate(b)
  if (!x || !y) return null
  x.setHours(0, 0, 0, 0)
  y.setHours(0, 0, 0, 0)
  return Math.round((y - x) / DAY_MS)
}

/**
 * A stored date as a reader sees it: the system's short date by default (the
 * pattern `ProjectTasksView` used, so a key date and the date inputs beside
 * it read alike), or the `Intl` options given. `locale` picks the locale
 * (undefined = the system's). No date: an em dash; a string that is not a
 * date: that string, as it was.
 */
export function showDate(s, { locale, ...options } = {}) {
  const d = parseIsoDate(s)
  if (!d) return s ? String(s) : '—'
  const fmt = Object.keys(options).length ? options : { year: 'numeric', month: '2-digit', day: '2-digit' }
  return d.toLocaleDateString(locale, fmt)
}
