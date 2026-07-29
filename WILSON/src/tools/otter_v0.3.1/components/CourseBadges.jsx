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

import { Users, ShieldCheck, Lock, EyeOff, PenLine } from 'lucide-react'
import { visibilityMeta } from './otterSharing.js'

const STYLES = {
  personal:         { bg: 'rgba(120,113,108,0.25)', fg: '#a8a29e', bd: 'rgba(120,113,108,0.5)', Icon: Lock },
  shared:           { bg: 'rgba(56,189,248,0.15)',  fg: '#7dd3fc', bd: 'rgba(56,189,248,0.35)', Icon: Users },
  company_standard: { bg: 'rgba(234,88,12,0.18)',   fg: '#fdba74', bd: 'rgba(234,88,12,0.45)',  Icon: ShieldCheck },
}

/**
 * @param {object}  props
 * @param {string}  props.visibility
 * @param {boolean} [props.showPersonal] force the personal badge (dialogs want
 *        it for completeness; lists deliberately do not — see Von Restorff).
 * @param {boolean} [props.compact] icon only, for the 200px sidebar.
 */
export function VisibilityBadge({ visibility, showPersonal = false, compact = false }) {
  const vis = visibility ?? 'personal'
  if (vis === 'personal' && !showPersonal) return null
  const meta = visibilityMeta(vis)
  const s = STYLES[vis] ?? STYLES.personal
  const { Icon } = s

  if (compact) {
    return (
      <span title={meta.short} aria-label={meta.short} className="shrink-0 inline-flex">
        <Icon className="w-3 h-3" style={{ color: s.fg }} />
      </span>
    )
  }

  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wide shrink-0"
      style={{ background: s.bg, color: s.fg, border: `1px solid ${s.bd}` }}
      title={meta.blurb}
    >
      <Icon className="w-2.5 h-2.5" />
      {meta.short}
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
