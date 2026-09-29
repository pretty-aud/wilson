// =============================================================================
// milestoneOrder.js — the one definition of "what order are key dates in".
//
// Extracted from localServerAdapter.js by Track A when key dates gained live
// sync (Audrey's ruling of 2026-09-07, migration 0077), because a THIRD place
// then needed the same order and this repo has a standing lesson about that:
// dependencyStatusSurfaces.test.js exists partly to assert that "done" is
// defined in exactly one place, after A2 session 1 found it defined in two.
//
// The places, and why they must agree. 🚨 THE FIRST VERSION OF THIS HEADER
// LISTED THREE AND THERE ARE FIVE — R1 found the two it had missed, and they
// are the two that run on the DESKTOP, where nothing else ever sorts:
//
//   1. supabaseAdapter.loadProject / listMilestones — PostgREST
//      `.order('date').order('id')`.
//   2. localServerAdapter.loadProject / listMilestones — this comparator,
//      because the desktop bundle arrives in insertion order.
//   3. state/realtimeMerge.js — a milestone arriving over the broadcast
//      channel from another window is spliced into the collection HERE, and
//      it has to land where a reload would have put it.
//   4. RabbitProvider.addMilestone and the undo of a delete — both rebuild the
//      collection as `[...filtered, row]`, i.e. an APPEND.
//   5. RabbitProvider.updateMilestone — a `.map`, which keeps position, and a
//      date change is exactly a change of position.
//
// (4) and (5) were masked in cloud, because the writer receives its own
// broadcast echo and (3) re-sorted a moment later — an accidental dependency
// on live sync. On Local Server there is no broadcast at all, so they were
// simply wrong until the next reload.
//
// If (3) disagreed with (1) and (2), a collaborator's new key date would sit
// at the bottom of the Tasks tab's milestone block until the next load and
// then jump — a difference that only ever shows up on someone else's screen,
// which is the worst shape of bug this project keeps finding.
//
// ⚠️ A SIXTH READER IS KNOWINGLY LEFT OUT: googleDriveAdapter.loadProject
// passes `bundle.milestones` through in export order and does not sort at all
// (R1). That adapter is read-only and its milestone writers are `readOnly()`
// stubs, so the same project opened on Drive renders its key dates in a
// different order from every other backend. Pre-existing, out of this
// change's remit, and recorded here rather than left for someone to rediscover.
//
// The `.order('id')` tie-break is NOT decoration: `ORDER BY date` alone leaves
// two key dates on the same day in an arbitrary heap order, while a JS sort is
// stable, so the two backends could return the same project in different
// orders — which is the thing ordering it at all was meant to prevent (R2 of
// A2 session 2). Nulls sort LAST here to match Postgres's default for
// ascending order.
// =============================================================================

/** Parse a milestone `date` to a sort key, or null when it has none. */
export function milestoneDateKey(value) {
  if (!value) return null
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : null
}

/** Order key dates the way both adapters load them: date, then id. */
export function byMilestoneDate(a, b) {
  const x = milestoneDateKey(a?.date)
  const y = milestoneDateKey(b?.date)
  if (x === null && y === null) return String(a?.id ?? '').localeCompare(String(b?.id ?? ''))
  if (x === null) return 1
  if (y === null) return -1
  if (x !== y) return x < y ? -1 : 1
  return String(a?.id ?? '').localeCompare(String(b?.id ?? ''))
}
