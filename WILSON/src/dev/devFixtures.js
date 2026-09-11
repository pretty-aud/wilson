// =============================================================================
// devFixtures.js — the "Dev fixtures mode" switch (Audrey, 2026-09-11 late):
//
//   "for reviewing instead of seeing empty tables. lets add a dev mode/debug
//    menu and add a fake project with a fake team, fake assets fake everything
//    just to show what it looks like. make it easy to turn off. like a bypass
//    for the database data, databases with data just to test"
//
// This file is the ONLY thing the production seams import. It carries no data:
// the dataset and the in-memory backends live under src/dev/fixtures/ and are
// reached through ONE dynamic import in main.jsx, on a line that begins with
// `import.meta.env.DEV &&`. `vite build` replaces `import.meta.env.DEV` with
// `false`, so that import — and with it every fixture module — is dead code
// the bundler drops; `src/dev/devFixtures.test.js` pins the shape and greps
// nothing of it survives in dist/.
//
// 🚨 EVERY function here returns its "off" answer before touching anything
// when `import.meta.env.DEV` is false. Keep that first line; the test reads it.
//
// The switch has two halves:
//   VITE_DEV_FIXTURES=1 in .env.local  — configures it (dev builds only)
//   localStorage 'wilson.dev-fixtures' — 'off' turns it off for this browser
//                                        profile without editing a file; the
//                                        DEV · fixtures badge writes it.
// Both are needed for the fixtures to be ACTIVE. Turning it off reloads the
// app so every seam re-decides at boot; nothing is toggled mid-flight.
// =============================================================================

const STORAGE_KEY = 'wilson.dev-fixtures'

/** True when a dev build was started with VITE_DEV_FIXTURES=1. */
export function devFixturesConfigured() {
  if (!import.meta.env.DEV) return false
  return import.meta.env.DEV && import.meta.env.VITE_DEV_FIXTURES === '1'
}

/** Configured AND not switched off for this browser profile. */
export function devFixturesActive() {
  if (!import.meta.env.DEV) return false
  if (!devFixturesConfigured()) return false
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

/** The badge's toggle. Persists per browser profile; callers reload after. */
export function setDevFixturesActive(on) {
  if (!import.meta.env.DEV) return
  try {
    if (on) globalThis.localStorage?.removeItem(STORAGE_KEY)
    else globalThis.localStorage?.setItem(STORAGE_KEY, 'off')
  } catch { /* storage disabled — the env flag alone then decides */ }
}

// ── The registry ─────────────────────────────────────────────────────────────
//
// src/dev/fixtures/install.js fills this with the in-memory backends:
//   {
//     rabbitAdapter: () => RabbitAdapter     the R.A.B.B.I.T. contract, mode 'fixtures'
//     otter:         { handle(route, body) } the otterFetch route handler
//     permissions:   { userId, role, workspaceId, workspaceIds, isPlatformOperator }
//     workspace:     { listMembers(), getMember(id), updateMember(id, patch) }
//     profile:       { email, ... }          what ProfileSection shows
//     bins:          true                    the Bins tab may open on the dataset
//     label:         'Salt Hours'            for the badge's tooltip
//   }
// Nothing is installed in a production build: install.js is never imported.

let installed = null

export function installDevFixtures(api) {
  if (!import.meta.env.DEV) return
  installed = api
}

/** The installed backends, or null when fixtures are off or not yet loaded. */
export function devFixtures() {
  if (!import.meta.env.DEV) return null
  return devFixturesActive() ? installed : null
}

// ── Refusals ─────────────────────────────────────────────────────────────────
//
// A write the fixtures cannot honour (an upload — there are no bytes; an OS
// file picker — there is no desktop) is refused LOUDLY: the badge listens for
// this event and pushes a toast, and the Error is thrown to the caller so its
// optimistic state rolls back the same way a real backend failure would.
// Nothing is dropped silently; that is the brief's rule.

const refusalListeners = new Set()

export function devWriteRefused(what) {
  if (!import.meta.env.DEV) return new Error(`Dev fixtures: ${what} is not available on fixture data.`)
  const message = `Dev fixtures: ${what} is not available on fixture data.`
  for (const listener of refusalListeners) {
    try { listener(message) } catch { /* a listener's failure is not the caller's */ }
  }
  const err = new Error(message)
  err.code = 'dev_fixtures_refused'
  err.status = 501
  return err
}

/** Subscribe the badge (or a test) to refusals. Returns the unsubscribe. */
export function onDevWriteRefused(handler) {
  if (!import.meta.env.DEV) return () => {}
  refusalListeners.add(handler)
  return () => refusalListeners.delete(handler)
}

export const DEV_FIXTURES_STORAGE_KEY = STORAGE_KEY
