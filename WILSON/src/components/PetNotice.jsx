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
// takes its whole state as a prop. It says nothing when there is nothing to
// say.
//
// ⚠️ NOT A COPY OF UndoToast. That one belongs to R.A.B.B.I.T., reads
// useRabbit() for its state, and carries an action button and a countdown bar
// because it is a forgiveness window. This one has no action: the refresh has
// already happened by the time it appears.
//
// Merged over the UI overhaul (2026-09-29; merge review round 1, 2026-09-30):
// the notice is published on the kit's ONE toast stack (Toast.jsx,
// `useToast()`, mounted by App inside its <ToastProvider>), which anchors 24px
// above the current page's bottom bar from PAGE_BARS and stacks with whatever
// else is showing. The merge had first re-expressed it as a standalone kit
// <Toast> in a hand-positioned wrapper at a flat 88px — which sat inside the
// stack's own place on the light pages (bar 80 + 24 = 104px, so the two
// overlapped) and floated over Home's 268px bar (A-R1-06). This component now
// renders NOTHING of its own: it pushes the notice when App announces one and
// withdraws it when App clears it. The tone is the kit's (info for the
// refresh, danger for a failed load); UndoToast is R.A.B.B.I.T.'s own row and
// is untouched.
// =============================================================================

import { useEffect } from 'react'
import { useToast } from '../ui'

// Long enough to read twice. The refresh notice explains something that
// happened without the user asking, so it is not a flash.
const AUTO_DISMISS_MS = 10000

export default function PetNotice({ notice, onDismiss }) {
  const toast = useToast()
  const kind = notice?.kind
  const message = notice?.message

  // 🚨 KEYED ON THE NOTICE OBJECT, which is App's STATE: its identity moves
  // exactly when App announces (announcePetNotice is handed a fresh literal at
  // each call site — userStateWiring.test.js pins both) and never on a
  // re-render. Keyed on the message alone, the SECOND announcement of the same
  // text — the stale-copy refresh (0068) says the same sentence every time —
  // would push nothing: the kit's stack has already let the first toast go
  // and the effect would not run again. (`onDismiss` is in the timer's list,
  // so App passes a STABLE callback — R1 of A3 measured a fresh arrow
  // restarting this timer on every App render.)
  //
  // Sticky on the kit's side (duration 0): the ten-second dismissal is the
  // timer below, which also clears App's state, so the two cannot disagree.
  // An ERROR has no timer at all: "Your pet could not be loaded" is a
  // standing condition, not an event, and a person who looks up after it has
  // faded has no way to find out what happened. The kit's X withdraws either.
  useEffect(() => {
    if (!message) return undefined
    const id = toast.push({ tone: kind === 'error' ? 'danger' : 'info', body: message, duration: 0 })
    return () => toast.dismiss(id)
  }, [notice, kind, message, toast])

  useEffect(() => {
    if (!message || kind === 'error') return undefined
    const id = setTimeout(() => onDismiss?.(), AUTO_DISMISS_MS)
    return () => clearTimeout(id)
  }, [notice, message, kind, onDismiss])

  return null
}
