// =============================================================================
// CourseBadges — Session 11
//
// The read-only tier signals that ride along on rows O.T.T.E.R. already draws:
// a badge in the sidebar list, on the library card, and in the dialogs.
//
// UX LAWS APPLIED
//   Law of Similarity   One badge shape everywhere a course appears, so "this
//                       is a tier" is learned once rather than per surface.
//   Von Restorff Effect Only the two tiers that are NOT the default get colour.
//                       Personal is the norm; if every badge shouted, the
//                       company-standard badge would stop meaning anything —
//                       so a personal course carries no badge at all in lists.
//   Selective Attention Badges sit inline at ~10px and never take a row's
//                       full width; the course NAME stays the thing you scan.
// =============================================================================

import { Users, ShieldCheck, Lock, EyeOff, PenLine, Share2, User } from 'lucide-react'
import { visibilityMeta } from './otterSharing.js'

// 🚨 PROVENANCE, NOT JUST TIER (Audrey, 2026-08-12: "make sure to indicate
// visually when a course is company shared, your own and if its shared directly
// by someone else").
//
// The original badge keyed on `visibility` ALONE, so a course YOU shared with
// the company and a course SOMEONE ELSE shared with you rendered the identical
// blue "Shared" chip. Those are the two states a person most needs to tell
// apart in a mixed library, and the UI made them look the same. `is_own` is on
// every row from otter_course_index and was already being read two lines away
// by OwnerBadge — the information was there, the badge just never asked.
//
// This also reverses the old "personal courses carry no badge" rule. That was a
// deliberate Von Restorff call and it was defensible when there were two tiers;
// with three origins it left "yours" as the only unlabelled state, i.e. the one
// you identify by ELIMINATION. "Yours" is therefore drawn, but quietest of the
// four — grey, no colour — so the coloured ones still carry the emphasis.
const STYLES = {
  personal:         { bg: 'rgba(120,113,108,0.25)', fg: '#a8a29e', bd: 'rgba(120,113,108,0.5)',  Icon: Lock },
  own:              { bg: 'rgba(120,113,108,0.20)', fg: '#a8a29e', bd: 'rgba(120,113,108,0.45)', Icon: User },
  shared:           { bg: 'rgba(56,189,248,0.15)',  fg: '#7dd3fc', bd: 'rgba(56,189,248,0.35)',  Icon: Users },
  from_someone:     { bg: 'rgba(167,139,250,0.16)', fg: '#c4b5fd', bd: 'rgba(167,139,250,0.38)', Icon: Share2 },
  company_standard: { bg: 'rgba(234,88,12,0.18)',   fg: '#fdba74', bd: 'rgba(234,88,12,0.45)',   Icon: ShieldCheck },
}

/**
 * Which of the four origins a row is, from the server's own flags.
 *
 * `is_own` is undefined in LOCAL mode (the Express server never sends it), so
 * the `!== false` test is load-bearing exactly as it is in otterSharing.js — a
 * missing flag must read as "mine", which is what a single-user install is.
 */
export function originOf(visibility, course) {
  const vis = visibility ?? course?.visibility ?? 'personal'
  const isOwn = course ? course.is_own !== false : true
  if (vis === 'company_standard') return 'company_standard'
  if (vis === 'shared') return isOwn ? 'shared' : 'from_someone'
  return isOwn ? 'own' : 'personal'
}

/**
 * @param {object}  props
 * @param {object}  [props.course] the row, so provenance (`is_own`,
 *        `owner_label`) can be read. Prefer this over `visibility` alone —
 *        without it a colleague's shared course is indistinguishable from yours.
 * @param {string}  [props.visibility] tier only, for surfaces with no row
 *        (the dialog's own header, the trash list).
 * @param {boolean} [props.showPersonal] force a badge on an untiered course.
 * @param {boolean} [props.compact] icon only, for the 200px sidebar.
 */
export function VisibilityBadge({ course, visibility, showPersonal = false, compact = false }) {
  const origin = originOf(visibility, course)
  // "Yours" is drawn in lists (Audrey's ask) but still suppressed where the tier
  // is genuinely absent and there is no row to be ambiguous about.
  if (origin === 'personal' && !showPersonal) return null
  if (origin === 'own' && !course && !showPersonal) return null

  const s = STYLES[origin]
  const { Icon } = s
  const who = course?.owner_label
  const label =
    origin === 'company_standard' ? 'Standard'
      : origin === 'shared'       ? 'Shared by you'
      : origin === 'from_someone' ? (who ? `From ${who}` : 'Shared with you')
      : origin === 'own'          ? 'Yours'
      : visibilityMeta(visibility ?? 'personal').short
  const hint =
    origin === 'company_standard' ? visibilityMeta('company_standard').blurb
      : origin === 'shared'       ? 'You shared this with the company. Everyone can read it.'
      : origin === 'from_someone' ? `${who ?? 'Someone else'} shared this with the company.`
      : origin === 'own'          ? 'Yours. Only you can open it unless you share it.'
      : visibilityMeta(visibility ?? 'personal').blurb

  if (compact) {
    return (
      <span title={hint} aria-label={label} className="shrink-0 inline-flex">
        <Icon className="w-3 h-3" style={{ color: s.fg }} />
      </span>
    )
  }

  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wide shrink-0 max-w-[160px]"
      style={{ background: s.bg, color: s.fg, border: `1px solid ${s.bd}` }}
      title={hint}
    >
      <Icon className="w-2.5 h-2.5 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  )
}

/**
 * "Made by <name>" — shown only on courses that are NOT the caller's own, where
 * provenance is the thing they actually want (Working Memory: the answer to
 * "whose is this?" belongs on the row, not one click away).
 */
export function OwnerBadge({ course }) {
  if (!course || course.is_own !== false || !course.owner_label) return null
  // The VisibilityBadge already reads "From <name>" for a colleague's SHARED
  // course, so repeating "by <name>" beside it is noise. It still earns its
  // place on a company_standard row, where the badge names the tier and nobody
  // otherwise says whose work it is.
  if (course.visibility === 'shared') return null
  return (
    <span className="text-[10px] text-stone-500 truncate" title={`Made by ${course.owner_label}`}>
      by {course.owner_label}
    </span>
  )
}

/**
 * The honest label for a row an admin can see the existence of but not open.
 * Naming it prevents the far worse reading — "this course is empty".
 */
export function MetadataOnlyBadge({ course }) {
  if (!course || course.can_read_content !== false) return null
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wide shrink-0"
      style={{ background: 'rgba(120,113,108,0.2)', color: '#a8a29e', border: '1px dashed rgba(120,113,108,0.6)' }}
      title="You can see that this course exists. Its contents stay private to its owner."
    >
      <EyeOff className="w-2.5 h-2.5" />
      Private
    </span>
  )
}

/**
 * Read-only marker. Paired with hiding the edit controls rather than replacing
 * them: Paradox of the Active User says nobody reads an explanation for a
 * button that is not there, so the badge answers the question the missing
 * buttons raise.
 */
export function ReadOnlyBadge({ course }) {
  if (!course || course.can_write !== false || course.can_read_content === false) return null
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wide shrink-0"
      style={{ background: 'rgba(120,113,108,0.2)', color: '#a8a29e', border: '1px solid rgba(120,113,108,0.5)' }}
      title="You can study this course. Only its owner, an admin, or someone they have given edit access can change it."
    >
      <PenLine className="w-2.5 h-2.5" />
      Read only
    </span>
  )
}
