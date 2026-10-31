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

import { RotateCcw, Trash2, BookOpen, AlertCircle } from 'lucide-react'
import { daysUntilPurge } from './otterSharing.js'
import { VisibilityBadge } from './CourseBadges.jsx'
import { Button, IconButton, SectionTitle, EmptyState, Banner, Loading, Spinner } from '../../../ui'

// A4: both halves onto the kit and the tokens (review O27's sibling: this
// panel was stone-800 cards with a hard shadow, orange titles and Restore
// on an orange-600 fill; the sidebar list stone text and an orange hover).
// The trash keeps its dashed edge — a deleted thing is not a live card.

function Countdown({ purgesAt }) {
  const days = daysUntilPurge(purgesAt)
  if (days == null) return null
  const urgent = days <= 7
  return (
    <span
      className="otter-trash-countdown"
      data-urgent={urgent}
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
      <div className="otter-trash-side-loading"><Loading label="Loading…" /></div>
    )
  }
  // An error means we do not KNOW the trash is empty. Saying "Nothing deleted"
  // here would be the exact lie this feature exists to prevent.
  const banner = error ? (
    <Banner tone="danger" className="otter-trash-side-error">
      <span className="otter-trash-side-error-text">{error}</span>
      {onDismissError && (
        <Button variant="ghost" size="sm" onClick={onDismissError} className="otter-trash-dismiss">Dismiss</Button>
      )}
    </Banner>
  ) : null

  if (rows.length === 0) {
    return (
      <div>
        {banner}
        {!error && (
          <EmptyState compact icon={Trash2} title="Nothing deleted" body="Deleted courses stay here for 30 days." className="otter-trash-side-empty" />
        )}
      </div>
    )
  }
  return (
    <div>
      {banner}
      {rows.map(r => (
        <div key={`${r.kind}:${r.id}`} className="otter-trash-row">
          <div className="otter-trash-row-text">
            <p className="otter-trash-row-name" title={r.name}>{r.name}</p>
            <div className="otter-trash-row-meta">
              {r.kind === 'subject' && <span>subject</span>}
              <Countdown purgesAt={r.purges_at} />
            </div>
          </div>
          <IconButton
            size="sm"
            icon={busyId === r.id ? Spinner : RotateCcw}
            onClick={() => onRestore(r)}
            disabled={!!busyId}
            title="Restore"
          />
        </div>
      ))}
    </div>
  )
}

/** The fuller cards for the Library pane, reusing its existing grid shape. */
export default function TrashPanel({ rows, loading, busyId, error, onRestore, onDismissError }) {
  return (
    <div className="otter-view">
      <div className="otter-view-page" data-width="data">
        <SectionTitle
          rule={false}
          className="otter-view-title"
          description="Deleted courses and subjects stay here for 30 days, then they are gone for good."
        >
          Recently deleted
        </SectionTitle>

        {error && (
          <Banner
            tone="danger"
            icon={AlertCircle}
            className="otter-trash-error"
            action={<Button variant="ghost" size="sm" onClick={onDismissError} className="otter-notice-action">Dismiss</Button>}
          >
            {error}
          </Banner>
        )}

        {loading ? (
          <div className="otter-trash-loading"><Loading label="Loading…" /></div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Trash2}
            title="Nothing deleted"
            body="When you delete a course it waits here for 30 days, so you can always change your mind."
          />
        ) : (
          <div className="otter-card-grid">
            {rows.map(r => (
              <div key={`${r.kind}:${r.id}`} className="otter-trash-card">
                <div className="otter-trash-card-head">
                  <h3 className="otter-trash-card-title">{r.name}</h3>
                  <Countdown purgesAt={r.purges_at} />
                </div>

                <div className="otter-course-card-badges">
                  {r.kind === 'subject' ? (
                    <span className="otter-trash-card-kind">
                      <BookOpen aria-hidden="true" /> subject in {r.course_name}
                    </span>
                  ) : (
                    <>
                      <VisibilityBadge visibility={r.visibility} showPersonal />
                      <span className="otter-course-card-meta">
                        {r.subject_count} subject{r.subject_count === 1 ? '' : 's'}
                      </span>
                    </>
                  )}
                </div>

                <p className="otter-trash-card-owner">
                  {r.is_own ? 'Yours' : `Owned by ${r.owner_label ?? 'someone else'}`}
                  {r.deleted_by_label ? ` · deleted by ${r.deleted_by_label}` : ''}
                  {r.deleted_at ? ` · ${new Date(r.deleted_at).toLocaleDateString()}` : ''}
                </p>

                <div className="otter-trash-card-spacer" />
                <Button
                  variant="primary"
                  size="sm"
                  icon={RotateCcw}
                  onClick={() => onRestore(r)}
                  disabled={!!busyId && busyId !== r.id}
                  loading={busyId === r.id}
                  className="otter-trash-restore"
                >
                  Restore
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
