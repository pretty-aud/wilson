// =============================================================================
// heldSession — S2 (night 3, 2026-10-27; docs/design/RECONNECT_DESIGN.md §11.5).
//
// At an offline launch inside the 4-hour cap the SDK holds no session (auth-js's
// _setSession saved nothing when the auth server could not be reached), and
// the client module (supabaseClient.js) holds the saved one instead. This is
// that one value and its listeners, nothing more: the client module sets it
// (hold, confirmation, refusal, sign-out); usePermissions reads the claims
// from it; R.A.B.B.I.T.'s connection dot probes with its token.
//
// Its own module, importing nothing but React, because its readers must not
// depend on supabaseClient.js: 95 test files mock that module with a factory
// that returns `supabase` alone (some without onAuthStateChange), and vitest
// refuses to read an export a factory did not return. `useHeldOffline` is for
// a screen that needs only "is a sign-in held offline" and no claims (D.O.G.'s
// card 1, R.A.B.B.I.T.'s project menu and Intake gate): the client module ends
// the hold the moment the SDK has a session, so it is usePermissions().offline
// without the SDK subscription.
// =============================================================================

import { useSyncExternalStore } from 'react'

let held = null
const listeners = new Set()

/** The saved session held while the SDK holds none, or null. */
export function heldSession() {
  return held
}

/** Set (or clear, with null) the held session; listeners hear every change. */
export function setHeldSession(next) {
  if (held === next) return
  held = next
  for (const l of listeners) {
    try { l(held) } catch { /* a listener must not break the hold */ }
  }
}

/** Called with the held session (or null) whenever it changes. Returns the unsubscribe. */
export function subscribeHeldSession(listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const isHeld = () => held !== null

/** React: true while a sign-in is held at an offline launch. */
export function useHeldOffline() {
  return useSyncExternalStore(subscribeHeldSession, isHeld, isHeld)
}
