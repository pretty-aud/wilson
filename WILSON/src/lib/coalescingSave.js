// =============================================================================
// coalescingSave.js — Phase 3, 2026-08-12.
//
// The pet's save queue, extracted from App.jsx so it can be TESTED.
//
// 🚨 IT IS HERE BECAUSE THE SAME TWENTY LINES PRODUCED TWO DEFECTS IN ONE
// SESSION, both of which reported a SUCCESS for a write that had not happened —
// the exact failure shape S30 spent a session removing from the pet:
//
//   1. The queued path returned a bare `true`. Pressing "Reset History" and then
//      "New Pet" (they sit side by side in the same Danger Zone) put the egg on
//      the queue and immediately told Audrey it was saved.
//   2. The first fix for that settled waiters AFTER the recursive flush, so a
//      caller that queued DURING the flush was resolved with the PREVIOUS
//      write's result, before its own write had run.
//
// Both were invisible to a source-scanning test, because the question they turn
// on — *which* waiter receives *which* result — is not visible in the text.
// Hence a real module with real tests.
//
// SEMANTICS (unchanged from S30/S31, which tuned them deliberately):
//   * One write at a time.
//   * While a write is in flight, only the NEWEST queued value is kept. Older
//     ones are superseded — the pet is a whole-object overwrite, so an
//     intermediate state has no value. (The original guard DROPPED the update
//     instead, which made the pet age backwards; do not go back to that.)
//   * Every caller's promise settles with the result of the write that
//     ACTUALLY persisted its data, or `false`.
//
// 🚨 IT MUST NEVER LEAVE A CALLER HANGING. handleNewPet awaits this, and a
// promise that never settles would strand its pending flag and disable the
// Create Egg button for the rest of the session. `perform` is therefore never
// allowed to reject through: it is wrapped.
// =============================================================================

/**
 * @param perform  async (data) => boolean — does the write, returns whether it
 *                 landed. Must not need to be re-entrant.
 * @returns        async (data) => boolean
 */
export function createCoalescingSave(perform) {
  let running = false
  let pending = null
  let waiters = []

  async function run(data) {
    if (running) {
      // Newest wins; everyone queued so far settles on whatever finally lands.
      pending = data
      return new Promise((resolve) => { waiters.push(resolve) })
    }

    running = true
    let ok = false
    try {
      ok = await perform(data)
    } catch {
      // `perform` owns its own error reporting. Swallowing here is what
      // guarantees this function always settles.
      ok = false
    } finally {
      running = false
      const next = pending
      pending = null

      // 🚨 SNAPSHOT THE WAITERS BEFORE RECURSING. Callers that queue DURING the
      // flush below must belong to the NEXT batch, not this one — resolving
      // them here would hand them a result for a write that never carried
      // their data. This single line is defect (2) in the header.
      const settling = waiters
      waiters = []

      if (next) {
        run(next).then(
          (result) => { for (const resolve of settling) resolve(result) },
          () => { for (const resolve of settling) resolve(false) },
        )
      } else {
        for (const resolve of settling) resolve(ok)
      }
    }
    return ok
  }

  return run
}
