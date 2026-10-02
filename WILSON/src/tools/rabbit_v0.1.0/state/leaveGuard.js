// ============================================================
// RABBIT — the leave guard (post-overhaul S3c, step 7; D12)
// ============================================================
//
// Audrey: "IF the user hasnt saved the changes, before the user changes tabs
// or tools, ask the user with a window if they want to save or cancel their
// changes." D12: every exit asks while an edit is unsaved — the R.A.B.B.I.T.
// tab strip, a tool or page switch, a project switch, a jump out of Scenes,
// closing the window — and AUTOMATIC switches (scenes turned off, the project
// cleared, a background refresh) never ask: the draft survives them.
//
// One question for every exit: `confirmLeave(reason)` resolves true to go
// on, false to stay. The exits ask it; the work that could be lost answers
// it. A GUARD is registered by what holds unsaved work:
//   the provider's unsaved edit (RabbitProvider: Save edit / Discard changes /
//     Keep editing, the kit Dialog LeaveEditDialog draws)
//   a Scenes popup's typed description, notes or task form (D21's own
//     "Discard your changes?" — S3b-05, S3b-08)
// Each says which exits it is about (`applies(reason)`), whether it holds
// anything now (`dirty()`), and how to ask (`ask(reason)` → Promise<boolean>).
// The nearest asks first (a popup, `order` 1, before the edit, 2): the first
// "stay" ends the question. While one question is open a second exit is
// refused, never queued — a click that came while a question was up was not
// an answer to it.
//
// Reasons: 'tab' (leaving the Scenes tab), 'page' (leaving R.A.B.B.I.T. for
// another tool or page), 'project' (switching project), 'edit' (the Scenes
// tab's edit selector or picker taking the draft off screen), 'popup' (a jump
// opening another row's popup over a changed one), 'close' (the window).
//
// The window's close cannot wait on a kit Dialog — its question is App's own
// (C1) — so a guard that can also be answered from there gives
// `describe()`, `save()` and `discard()`, and App folds them into that one
// dialog (`unsavedForClose`): one question, never two in a row.
// ============================================================

export const LEAVE_REASONS = Object.freeze(['tab', 'page', 'project', 'edit', 'popup', 'close'])

const guards = new Set()
// A guard whose question is open now → how to settle it without an answer.
const settle = new Map()
let asking = false
// Review round 2 (R2-01): who follows the unsaved work while a question about
// it is up (App's close question, which captures the guards when it opens).
const listeners = new Set()

/** Follow changes to the unsaved work (guards added or removed, a guard's work changed); returns the unsubscribe. */
export function subscribeLeaveGuards(fn) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** A guard's work changed (the provider calls it when its drafts do). */
export function leaveGuardsChanged() {
  for (const fn of [...listeners]) fn()
}

/** Register a guard; returns its removal. */
export function addLeaveGuard(guard) {
  guards.add(guard)
  leaveGuardsChanged()
  return () => {
    guards.delete(guard)
    // Review round 1 (R1-10): a guard taken away while its question is open
    // (its popup closed under it — the row deleted elsewhere, the tab hidden
    // by itself) can never be answered. Its question counts as "stay", and
    // the one-question lock is let go: otherwise every later exit was refused
    // in silence.
    settle.get(guard)?.(false)
    leaveGuardsChanged()
  }
}

function dirtyFor(reason) {
  return [...guards]
    .filter(g => g.applies(reason) && g.dirty())
    .sort((a, b) => (a.order ?? 9) - (b.order ?? 9))
}

/** Whether leaving this way would lose unsaved work now. */
export function hasUnsavedWork(reason) {
  return dirtyFor(reason).length > 0
}

/** Ask, before an exit: true to go on, false to stay. */
export async function confirmLeave(reason) {
  const ask = dirtyFor(reason)
  if (!ask.length) return true
  if (asking) return false
  asking = true
  try {
    for (const g of ask) {
      // Still there, and still holding anything? The answer to an earlier
      // guard may have dealt with it, or taken it away.
      if (!guards.has(g) || !g.dirty()) continue
      const answer = await new Promise((resolve) => {
        settle.set(g, resolve)
        Promise.resolve(g.ask(reason)).then(resolve, () => resolve(false))
      })
      settle.delete(g)
      if (!answer) return false
    }
    return true
  } finally {
    asking = false
  }
}

/**
 * The R.A.B.B.I.T. tab strip and its jumps (Rabbit.jsx): leaving the Scenes
 * tab is the exit — the edit and a popup's typed text live there. Arriving
 * in Scenes, or moving between other tabs, leaves nothing.
 */
export function leaveTab(from, to) {
  return from === 'scenes' && to !== 'scenes' ? confirmLeave('tab') : Promise.resolve(true)
}

/** The unsaved work the window's own close question can answer for: { describe, save, discard }. */
export function unsavedForClose() {
  return dirtyFor('close').filter(g => typeof g.save === 'function' && typeof g.discard === 'function')
}

/** Tests only: the registry empty again. */
export function _resetLeaveGuardsForTests() {
  guards.clear()
  settle.clear()
  listeners.clear()
  asking = false
}
