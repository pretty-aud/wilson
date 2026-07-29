// =============================================================================
// TrashPanel — Session 11 (closes carry-forward gap #20)
//
// "Recently deleted" is a FILTER STATE on the lists O.T.T.E.R. already draws,
// not a new view (Audrey, 2026-07-29). Selecting the chip in Sidebar 1 swaps
// that column's list for compact trash rows and the Library pane for these
// cards; nothing else about the shell moves.
//
// Before migration 0024 this could not exist at all: every SELECT policy on
// otter_courses/otter_subjects begins `deleted_at IS NULL` and
// otter_course_index() filters trashed rows too, so a soft-deleted course was
// unreachable by ANY client query — otter_restore_row worked but had no
// obtainable argument. otter_trash_index() is the read side that makes the
// delete reversible in practice rather than only in principle.
//
// UX LAWS APPLIED
//   Mental Model        A trash can with a countdown. Everyone already has
//                       this model; nothing here needs explaining.
//   Zeigarnik Effect    "Purges in N days" keeps an unfinished decision
//                       visible — a silent 30-day timer is a trap.
//   Goal-Gradient       The countdown tightens as the deadline nears, and
//                       turns red in the last week.
//   Peak-End Rule       Restoring lands you back on the course, not on an
//                       empty list wondering whether it worked.
//   Postel's Law        A restore CAN legitimately fail — the live-slug unique
//                       index is partial — so the collision is explained in
//                       words the user can act on rather than as a 23505.
//   Forgiveness         The whole point: nothing O.T.T.E.R. deletes is gone
//                       for 30 days, and now the user can see that.
// =============================================================================

import { Loader2, RotateCcw, Trash2, BookOpen, AlertCircle } from 'lucide-react'
import { daysUntilPurge } from './otterSharing.js'
import { VisibilityBadge } from './CourseBadges.jsx'

function Countdown({ purgesAt }) {
  const days = daysUntilPurge(purgesAt)
  if (days == null) return null
  const urgent = days <= 7
  return (
    <span
      className={`text-[10px] font-mono ${urgent ? 'text-red-400' : 'text-stone-500'}`}
      title={`Deleted for good on ${new Date(purgesAt).toLocaleDateString()}`}
    >
      {days === 0 ? 'deletes today' : `${days}d left`}
    </span>
  )
}

/**
 * Compact rows for the 200px Sidebar 1 column.
 *
 * It takes `error` for a reason that is easy to miss: this list stays mounted
 * and its Restore buttons stay live after the user navigates to another view,
 * but the fuller TrashPanel below — which is where the error banner lives —
 * only renders inside the library pane. Without a surface here, a restore that
 * fails while the user is reading a lesson would show nothing at all: the
 * spinner would stop, the row would stay, and that is indistinguishable from
 * the button being broken.
 */
export function TrashSidebarList({ rows, loading, busyId, error, onDismissError, onRestore }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-1.5 py-6 text-stone-500 text-[11px]">
        <Loader2 className="w-3 h-3 animate-spin" /> Loading…
      </div>
    )
  }
  // An error means we do not KNOW the trash is empty. Saying "Nothing deleted"
  // here would be the exact lie this feature exists to prevent.
  const banner = error ? (
    <div className="m-2 bg-red-900/30 border border-red-700 rounded-sm p-2">
      <p className="text-red-300 text-[10px] leading-snug">{error}</p>
      {onDismissError && (
        <button
          onClick={onDismissError}
          className="mt-1 text-red-400 hover:text-red-200 text-[10px] font-bold underline"
        >
          Dismiss
        </button>
      )}
    </div>
  ) : null

  if (rows.length === 0) {
    return (
      <div>
        {banner}
        {!error && (
          <div className="flex flex-col items-center justify-center py-8 px-3 text-center">
            <Trash2 className="w-7 h-7 text-stone-600 mb-2" />
            <p className="text-stone-500 text-xs">Nothing deleted</p>
            <p className="text-stone-600 text-[10px] mt-1">Deleted courses stay here for 30 days.</p>
          </div>
        )}
      </div>
    )
  }
  return (
    <div>
      {banner}
      {rows.map(r => (
        <div
          key={`${r.kind}:${r.id}`}
          className="flex items-center gap-1 px-2 py-1.5 border-b border-stone-700/40"
        >
          <div className="min-w-0 flex-1">
            <p className="text-stone-400 text-[11px] truncate" title={r.name}>{r.name}</p>
            <div className="flex items-center gap-1.5">
              {r.kind === 'subject' && <span className="text-stone-600 text-[9px]">subject</span>}
              <Countdown purgesAt={r.purges_at} />
            </div>
          </div>
          <button
            type="button"
            onClick={() => onRestore(r)}
            disabled={!!busyId}
            title="Restore"
            className="p-1 text-stone-500 hover:text-orange-400 transition-colors disabled:opacity-40 shrink-0"
          >
            {busyId === r.id
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <RotateCcw className="w-3 h-3" />}
          </button>
        </div>
      ))}
    </div>
  )
}

/** The fuller cards for the Library pane, reusing its existing grid shape. */
export default function TrashPanel({ rows, loading, busyId, error, onRestore, onDismissError }) {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-orange-400">Recently deleted</h2>
            <p className="text-stone-500 text-sm">
              Deleted courses and subjects stay here for 30 days, then they are gone for good.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-red-900/30 border-2 border-red-700 rounded-sm p-3 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-red-300 text-sm flex-1">{error}</p>
            <button onClick={onDismissError} className="text-red-400 hover:text-red-200 text-xs font-bold">
              Dismiss
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-stone-500">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Trash2 className="w-16 h-16 text-stone-600 mb-4" />
            <h3 className="text-xl font-bold text-orange-400 mb-2">Nothing deleted</h3>
            <p className="text-stone-500 max-w-md">
              When you delete a course it waits here for 30 days, so you can always change your mind.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rows.map(r => (
              <div
                key={`${r.kind}:${r.id}`}
                className="bg-stone-800 border-2 border-dashed border-stone-600 rounded-sm p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)] flex flex-col"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="text-stone-300 font-bold text-base leading-tight line-clamp-2">{r.name}</h3>
                  <Countdown purgesAt={r.purges_at} />
                </div>

                <div className="flex items-center gap-1.5 flex-wrap mb-2">
                  {r.kind === 'subject' ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-stone-500">
                      <BookOpen className="w-2.5 h-2.5" /> subject in {r.course_name}
                    </span>
                  ) : (
                    <>
                      <VisibilityBadge visibility={r.visibility} showPersonal />
                      <span className="text-[10px] text-stone-500">
                        {r.subject_count} subject{r.subject_count === 1 ? '' : 's'}
                      </span>
                    </>
                  )}
                </div>

                <p className="text-stone-600 text-[11px]">
                  {r.is_own ? 'Yours' : `Owned by ${r.owner_label ?? 'someone else'}`}
                  {r.deleted_by_label ? ` · deleted by ${r.deleted_by_label}` : ''}
                  {r.deleted_at ? ` · ${new Date(r.deleted_at).toLocaleDateString()}` : ''}
                </p>

                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => onRestore(r)}
                  disabled={!!busyId}
                  className="mt-3 w-full flex items-center justify-center gap-2 bg-orange-600 text-white py-1.5 rounded-sm border-2 border-orange-700 hover:bg-orange-700 transition-colors text-sm font-bold disabled:opacity-50"
                >
                  {busyId === r.id
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <RotateCcw className="w-4 h-4" />}
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
