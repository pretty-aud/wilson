// =============================================================================
// PetNotice — Track A, bundle A3 (2026-09-07).
//
// 🚨 WHY A SECOND SURFACE EXISTS AT ALL.
//
// The pet already had a failure banner. It lives inside PetCompanion's CHAT
// POPUP, which is closed on every page change, and PetCompanion itself is
// rendered from App.jsx as `{petData && <PetCompanionWithAgent …>}`. So the
// banner is invisible in exactly the two situations that most need saying:
//
//   1. A FAILED PET LOAD. docs/OUTSTANDING.md, "A failed pet LOAD has nowhere
//      to show itself": S30 made the failure representable and S31 set
//      `petSaveError`, but when the load fails `petData` stays null, the
//      companion is never mounted, and the only renderer of the error is
//      unmounted BY the error. Representable and invisible.
//
//   2. THE STALE-COPY REFRESH. Migration 0068 refuses a write from a window
//      holding an older copy of the pet than the account has; Audrey's ruling 4
//      is that the stale window gets a refresh notice. That notice has to
//      survive the pet being replaced underneath it, and must not depend on the
//      pet having hatched.
//
// So this is mounted at the very bottom of App's tree, beside <UndoToast/>, and
// takes its whole state as a prop. It renders nothing when there is nothing to
// say.
//
// ⚠️ NOT A COPY OF UndoToast. That one belongs to R.A.B.B.I.T., reads
// useRabbit() for its state, and carries an action button and a countdown bar
// because it is a forgiveness window. This one has no action: the refresh has
// already happened by the time it appears.
//
// Merged over the UI overhaul (2026-09-29): the surface is the kit's Toast —
// one anchor, one ink, the tone as its left edge and glyph (info for the
// refresh, danger for a failed load) — where it used to borrow UndoToast's
// hand-drawn box. Placement: bottom-centre, ABOVE UndoToast's row rather than
// on top of it — a RABBIT delete can be undone while a pet notice is on
// screen, and two stacked toasts that overlap is how a person misses the one
// with a button. The layer is the kit Toast's (index.css `.ui-toast-stack`,
// 90), over the kit Dialog's backdrop (70), for the same reason UndoToast's
// is: a notice that lands while a popup is open must be readable over it.
// =============================================================================

import { useEffect } from 'react'
import { Toast } from '../ui'

// Long enough to read twice. The refresh notice explains something that
// happened without the user asking, so it is not a flash.
const AUTO_DISMISS_MS = 10000

export default function PetNotice({ notice, onDismiss }) {
  const kind = notice?.kind
  const message = notice?.message

  // 🚨 KEYED ON THE MESSAGE, NOT ON `notice`. App builds a fresh object each
  // time it sets one, so depending on the object would restart the timer on
  // every unrelated re-render of App — which for a 10-second dismissal means a
  // notice that never goes away on a busy screen. (`onDismiss` is in the list
  // too, so App passes a STABLE callback — R1 of A3 measured a fresh arrow
  // restarting this timer on every App render.)
  //
  // An ERROR is not auto-dismissed. "Your pet could not be loaded" is a
  // standing condition, not an event, and a person who looks up after it has
  // faded has no way to find out what happened.
  useEffect(() => {
    if (!message || kind === 'error') return undefined
    const id = setTimeout(() => onDismiss?.(), AUTO_DISMISS_MS)
    return () => clearTimeout(id)
  }, [message, kind, onDismiss])

  if (!message) return null

  const isError = kind === 'error'

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-90"
      // Clear of UndoToast's `bottom-6` row.
      style={{ bottom: 88, minWidth: 320, maxWidth: 480 }}
    >
      <Toast tone={isError ? 'danger' : 'info'} body={message} onDismiss={() => onDismiss?.()} />
    </div>
  )
}
