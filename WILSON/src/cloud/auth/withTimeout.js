// =============================================================================
// withTimeout — bound an await so a hung network call cannot strand a UI.
//
// Session 17. Every auth screen in WILSON is a small state machine whose busy
// state is cleared by the NEXT step, not by the one that set it. That is fine
// until a step never returns: `mfa.verify()`, `getSession()` or an Edge
// Function call that hangs leaves the button reading "Verifying…" forever,
// with no error, no retry and nothing in the console. Audrey hit exactly this
// twice in a row on first sign-in — once enrolling TOTP, once using it — and
// in both cases the operation had actually SUCCEEDED server-side.
//
// A rejected promise is recoverable: the caller's existing catch clears busy
// and shows a message. A pending one is not. So the rule for auth work is
// that every await gets a ceiling.
//
// Deliberately NOT AbortController: supabase-js does not thread a signal
// through every method, and we do not want to cancel a sign-in that may have
// already taken effect server-side — we want to stop WAITING on it and let
// the user retry. The underlying request is left to settle on its own.
// =============================================================================

/** Thrown when the ceiling is reached. Carries the label for the message. */
export class TimeoutError extends Error {
  constructor(label, ms) {
    super(`${label} timed out after ${ms}ms`)
    this.name = 'TimeoutError'
    this.label = label
    this.ms = ms
  }
}

/**
 * Resolve `promise`, or reject with TimeoutError after `ms`.
 *
 * @param {Promise<T>} promise  the work to bound
 * @param {number}     ms       ceiling in milliseconds
 * @param {string}     label    what timed out, for the error message
 * @returns {Promise<T>}
 * @template T
 */
export function withTimeout(promise, ms, label = 'operation') {
  let timer
  const ceiling = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms)
  })
  // finally() clears the timer on BOTH paths, so a fast resolve does not leave
  // a pending handle that keeps a test runner (or an Electron window) alive.
  return Promise.race([promise, ceiling]).finally(() => clearTimeout(timer))
}

/**
 * The ceiling used by the auth screens. Generous enough that a slow-but-alive
 * connection still completes — GoTrue's MFA verify and the issue-session Edge
 * Function are both normally well under a second — and short enough that a
 * dead one surfaces while the user is still looking at the screen.
 */
export const AUTH_TIMEOUT_MS = 15000
