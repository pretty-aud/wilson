// =============================================================================
// Shared authenticated Supabase client for the renderer.
// Used by LoginScreen, supabaseAdapter, and any future cloud hook.
//
// persistSession: false  -> we manage persistence ourselves via
//                           sessionStorage.js (safeStorage in Electron,
//                           localStorage on the web — Session 12 settled the
//                           web strategy: a static host has no server to set
//                           an httpOnly cookie, so the web build persists the
//                           way every Supabase SPA does, in localStorage).
// autoRefreshToken: true -> the SDK handles refresh rotation for us. The
//                           TOKEN_REFRESHED hook below re-saves the rotated
//                           refresh token; without it a long-lived tab's
//                           stored session goes stale and the next boot
//                           silently lands on the login screen.
// =============================================================================

import { createClient } from '@supabase/supabase-js'
import { saveSession, loadSession, clearSession } from './sessionStorage'
import { insideSessionCap, sessionIdOf } from './sessionTimeouts'
import { heldSession, setHeldSession } from './heldSession'
import {
  connectionWatchdog, createAnonGuard, restoreSavedSession, rehydrateSession, classifyAuthFailure,
  ANON_GUARD_MESSAGE, HELD_GUARD_MESSAGE,
} from '../connectionWatchdog'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anon) {
  // Surface loudly at boot — missing env = nothing works.
  console.error('[wilson] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing. Check .env.development.')
}

// storageKey (Session 15): with persistSession:false the SDK writes nothing,
// so this is NOT where session isolation comes from — sessionStorage.js is.
// What it does separate is everything else auth-js namespaces off the key:
// the navigator lock (`lock:<storageKey>`), the PKCE code-verifier slot and
// the JWKS cache. /wilson and /wilsonadmin are the same origin, so without
// it the two bundles would contend on one lock and both log auth-js's
// "Multiple GoTrueClient instances detected" warning.
/* global __WILSON_SURFACE__ */
const surface = typeof __WILSON_SURFACE__ === 'string' ? __WILSON_SURFACE__ : 'app'

// B2 part 2 (Track B): the ONE fetch supabase-js uses. `global.fetch` reaches
// GoTrue (token refresh, sign-in, MFA), PostgREST and Storage alike — measured
// in supabase-js 2.101.1: SupabaseClient passes `settings.global.fetch` to
// both `fetchWithAuth` and `_initSupabaseAuthClient`. The watchdog wraps it so
// a request that silently never settles while the browser still says it is
// online is ABORTED at its budget and the strip says "Connection lost —
// reconnecting…" (S1, night 2 of PLAN_TO_1_0, docs/design/RECONNECT_DESIGN.md;
// before S1 the request was only counted and the strip said reload, the one
// remedy there was). It watches bounded calls only (auth, PostgREST, storage
// downloads); uploads, the resumable path and every Edge Function call are
// outside it by construction. Bound to globalThis: an unbound `fetch` throws
// "Illegal invocation".
//
// S1's guard sits OUTSIDE the wrapper. Once the hung refresh's own caller
// gets the result of its loop — no session — supabase-js sends that caller's
// request with the ANON key (measured: a 401 on `workspaces`; on a table anon
// may read, an empty 200 that looks like data). While a person is signed in
// (the last auth event carried a session), a PostgREST or storage request
// carrying the anon bearer is refused with a rejected fetch and one sentence,
// which postgrest-js turns into the caller's error result: the caller's own
// error path, never an empty success. Outside the wrapper, so a refused
// request is never tracked. Every PostgREST and storage call the app makes
// while signed in carries the session's token; the anon calls (resolve-login,
// the Edge Functions) are raw fetches outside this client.
const baseFetch = typeof fetch === 'function' ? (input, init) => fetch(input, init) : undefined
let signedIn = false
let endedLocally = false

// ── S2 (night 3, 2026-10-27): the session held at an offline launch ─────────
//
// docs/design/RECONNECT_DESIGN.md §11. A saved sign-in inside the 4-hour cap
// whose launch reached nothing opens the shell offline — on the APP surface
// only (App's checkSessionValid passes `holdOffline`; the operator console
// restores as before). auth-js's `_setSession` saved nothing in that case, so
// the SDK holds no session and this module holds the saved one instead:
//   * the guard is LATCHED from the hold (`signedIn`), so every PostgREST and
//     storage request supabase-js sends with the anon bearer is refused before
//     the network, with HELD_GUARD_MESSAGE — never the anon key on the wire;
//   * usePermissions reads the held token's claims (heldSession.js, the one
//     value and its listeners), with no network read;
//   * the watchdog marks the auth family lost (the strip from the first paint)
//     and pings it; the first answered ping re-hydrates (`setSession(held)`),
//     the SDK emits SIGNED_IN or TOKEN_REFRESHED, and the hold ends: the
//     confirmation. A refusal on the way back ends the session (App listens:
//     onHeldSessionRefused) after clearing the stored session if it still
//     holds the refused refresh token.
const refusedListeners = new Set()
let rehydration = null      // the re-hydration in flight, one at a time
let signOutEpoch = 0        // bumped by endSessionLocally: a re-hydration begun before it is dropped
let endedSid = null         // the session id a sign-out ended while it was held
// The held session's own auth work — the launch's restore and the
// re-hydration — sends its GET /user or refresh through this controller, and a
// sign-out aborts it (build review round 1, F4): a late answer must never save
// the ended session into the SDK over a newer sign-in. It stays aborted, and
// joined, until that work settles, so the SDK's retry loop cannot send again.
let heldWork = null

function ownHeldWork() {
  heldWork = typeof AbortController === 'function' ? new AbortController() : null
  return heldWork
}

function releaseHeldWork(ctl) {
  if (ctl && heldWork === ctl) heldWork = null
}

/** Joins the held work's GET /auth/v1/user and refresh to its controller; a sign-in's own requests are never joined. */
const joinHeldWork = (f) => (input, init) => {
  if (heldWork && !init?.signal) {
    const where = typeof input === 'string' ? input : (input?.url ?? String(input ?? ''))
    const method = String(init?.method ?? 'GET').toUpperCase()
    const owned = (method === 'GET' && /\/auth\/v1\/user(\?|$)/.test(where))
      || (method === 'POST' && where.includes('/auth/v1/token') && where.includes('grant_type=refresh_token'))
    if (owned) return f(input, { ...init, signal: heldWork.signal })
  }
  return f(input, init)
}

/** Called when the cloud refused the held session on the way back: App ends the session. */
export function onHeldSessionRefused(listener) {
  refusedListeners.add(listener)
  return () => { refusedListeners.delete(listener) }
}

/** The SDK holds the session now: the hold ends, and the launch's loss with it if nothing real is out. */
function confirmHeld() {
  if (!heldSession()) return
  setHeldSession(null)
  connectionWatchdog.launchEnded()
}

/** Clear the stored session only if it still holds this refresh token (another tab may have saved a newer one). */
async function clearIfStillHolds(refreshToken) {
  try {
    const current = await loadSession()
    if (current?.refresh_token && current.refresh_token === refreshToken) await clearSession()
  } catch { /* the store is best effort; the sign-in screen follows either way */ }
}

async function refuseHeld(session) {
  if (heldSession() !== session) return
  await clearIfStillHolds(session.refresh_token)
  if (heldSession() !== session) return
  // App is told while the hold still names the person (build review round 1,
  // F3): its sign-out reads whose pet cache to clear from the identity the
  // held claims gave it, which ending the hold first would already have
  // emptied. Its sign-out ends the hold (endSessionLocally); in case nobody
  // listens, it is ended here after.
  for (const l of refusedListeners) { try { l(session) } catch { /* same rule */ } }
  if (heldSession() === session) {
    setHeldSession(null)
    connectionWatchdog.launchEnded()
  }
}

function hold(session, late, work) {
  signedIn = true
  endedLocally = false
  endedSid = null
  setHeldSession(session)
  connectionWatchdog.launchedOffline({ origin: url ?? '', apikey: anon ?? null })
  // The SDK's restore may still be running (the launch ceiling decided): its
  // answer, whenever it comes, is the confirmation or the refusal; meanwhile no
  // ping is sent and no answer clears the strip (build review round 1, F2:
  // an answer can hold no session — a 429, a portal's page).
  if (late) {
    const settled = Promise.resolve(late).then((r) => {
      if (heldSession() !== session) { connectionWatchdog.launchEnded(); return }
      if (!r?.error && r?.data?.session) confirmHeld()
      else if (classifyAuthFailure(r?.error) === 'refused-ends') return refuseHeld(session)
      // anything else: still held, the strip still up, the pings resume
    }, () => { /* a thrown restore changes nothing: the next answered ping asks again */ })
      .finally(() => releaseHeldWork(work))
    connectionWatchdog.quietWhile('auth', settled)
  } else {
    releaseHeldWork(work)
  }
}

/** The re-hydration (§11.5): on the first answered auth ping while a session is held. */
function rehydrate() {
  if (!heldSession() || rehydration) return rehydration
  const session = heldSession()
  const epoch = signOutEpoch
  const work = ownHeldWork()
  rehydration = (async () => {
    const r = await rehydrateSession({ auth: supabase.auth, held: session })
    if (epoch !== signOutEpoch) {
      // A sign-out landed while it was out (its request was aborted with it):
      // the person's word stands. Should the SDK hold the session anyway, it
      // is signed out locally; and the launch's loss is lowered now that the
      // request has settled (build review round 1, F5).
      if (r.outcome === 'online') Promise.resolve(supabase.auth.signOut({ scope: 'local' })).catch(() => { /* best effort */ })
      connectionWatchdog.launchEnded()
      return
    }
    if (r.outcome === 'online') confirmHeld()
    else if (r.outcome === 'refused') await refuseHeld(session)
    // 'unreached' (a 404, a 429 or a page that is not GoTrue's included): still
    // held; the family stays lost (quietWhile kept the answer from clearing
    // it), so the next answered ping asks again.
  })().catch(() => { /* reached nothing: still held; the next answered ping asks again */ })
    .finally(() => { rehydration = null; releaseHeldWork(work) })
  connectionWatchdog.quietWhile('auth', rehydration)
  return rehydration
}

/**
 * S1 (review round 2, F1): the person ended the session HERE while the cloud
 * could not be reached. App.jsx's signOutLocal and the operator console's
 * handleSignOut clear the stored session first and then call
 * `supabase.auth.signOut`, which queues behind a hung refresh. Before S1 that
 * queue never drained and the strip's Reload threw the page away, so nothing
 * survived. Now the queue drains and the SDK's signOut runs on the still-dead
 * network: its POST /logout is aborted, the SDK keeps the session (a
 * retryable error removes nothing), its ticker goes on refreshing it, and the
 * TOKEN_REFRESHED that lands when the network returns would have RE-SAVED the
 * session the person had just ended — the next launch would restore it. So
 * while this latch is set the hook below saves nothing, the guard treats the
 * person as signed out, and the auth family's retry finishes the sign-out
 * instead of asking for the session. SIGNED_OUT (the sign-out landing) and
 * SIGNED_IN (a new sign-in) clear it.
 */
export function endSessionLocally() {
  endedLocally = true
  signedIn = false
  // S2: and a session held at an offline launch ends with it, so the guard,
  // usePermissions and the pet follow the sign-out at once; the launch's loss
  // is lowered (nothing is left to ask). A re-hydration still out is dropped.
  signOutEpoch += 1
  // The held session's own auth work (a restore or a re-hydration still out)
  // is aborted: its answer must not save the ended session into the SDK.
  if (heldWork) { try { heldWork.abort() } catch { /* an unusual controller */ } }
  const ending = heldSession()
  if (ending) {
    endedSid = sessionIdOf(ending)
    setHeldSession(null)
    connectionWatchdog.launchEnded()
  }
}

const guard = createAnonGuard({
  anonKey: anon ?? '',
  isSignedIn: () => signedIn,
  message: () => (heldSession() ? HELD_GUARD_MESSAGE : ANON_GUARD_MESSAGE),
  onRefused: (path) => console.warn(heldSession()
    ? `[wilson] ${path}: the session is held offline; the request was not sent`
    : `[wilson] ${path}: signed in, but the session check failed; the request was not sent`),
})

export const supabase = createClient(url ?? '', anon ?? '', {
  auth: {
    persistSession: false,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: surface === 'admin' ? 'sb-wilson-operator' : 'sb-wilson-app',
  },
  global: baseFetch ? { fetch: joinHeldWork(guard(connectionWatchdog.wrapFetch(baseFetch))) } : {},
})

// Keep the persisted copy current across refresh rotation (Session 12 web
// follow-up from Session 2's persistSession:false note). Sign-out clearing
// stays with the explicit logout flow — clearing here too would race it.
// S1: the same events tell the guard above whether a person is signed in, and
// a sign-in or the sign-out landing clears the latch; while it is set a
// refreshed token is NOT written back (the person ended the session here).
// S2: while a session is held a SIGNED_OUT (the SDK's, inside a refused
// restore) leaves the latch on — the hold's end turns it off — and an event
// that carries a session ends the hold (the confirmation). A SIGNED_IN of the
// session a sign-out ended while it was held (a re-hydration's, landing late)
// is not a sign-in: the latch stays, and the SDK's copy is signed out locally.
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session && endedSid && sessionIdOf(session) === endedSid) {
    Promise.resolve(supabase.auth.signOut({ scope: 'local' })).catch(() => { /* best effort */ })
    return
  }
  if (event === 'SIGNED_OUT') { signedIn = !!heldSession(); endedLocally = false; endedSid = null }
  else if (event === 'SIGNED_IN') { signedIn = true; endedLocally = false; endedSid = null; if (session) confirmHeld() }
  else if (session && !endedLocally) { signedIn = true; confirmHeld() }
  if (event === 'TOKEN_REFRESHED' && session && !endedLocally) {
    Promise.resolve(saveSession(session)).catch(() => { /* best-effort */ })
  }
})

// S1: the app's one retry, asked for REAL. An auth or rest ping that answers
// proves the gateway, not the database behind it (round 2, F2), so the
// watchdog does not clear on it; it tells this module, which makes one real
// request of the family, and THAT answer clears the strip. For auth: the
// session (if the SDK is free and the token stale this starts the refresh
// now rather than at the ticker's next tick; if its queue is still held it
// queues behind the attempt in flight, which the answered ping has just
// aborted, so the SDK's retry is next on the wire) — or, while the person
// has ended the session here, the sign-out the dead network swallowed. For
// rest: a HEAD of one row of `workspaces`, the smallest read there is. The
// SDK's own loop does the refresh retrying (measured, the probe's phase E);
// nothing here re-issues a refresh.
connectionWatchdog.onPingAnswered((family) => {
  if (family === 'auth') {
    // S2: while a session is held, the real question is the session itself.
    if (heldSession() && !endedLocally) { rehydrate(); return }
    const ask = endedLocally ? supabase.auth.signOut({ scope: 'local' }) : supabase.auth.getSession()
    Promise.resolve(ask).catch(() => { /* the strip says what is true */ })
  } else if (family === 'rest') {
    Promise.resolve(supabase.from('workspaces').select('id', { head: true }).limit(1)).catch(() => { /* same */ })
  }
})

// Hydrate the client from a previously-saved session. Called at boot from
// App.jsx once sessionStorage.loadSession() resolves, and by the operator
// console's boot.
//
// S2: `holdOffline` (App's start-up check only) adds the offline launch, for a
// saved sign-in inside the 4-hour cap (sessionTimeouts.insideSessionCap: the
// earlier of the cap's record and the token's own sign-in time): GoTrue's
// health is asked first, within 5 s, and only an answer lets the SDK restore,
// with S1's budgets, the whole decided within 10 s (restoreSavedSession).
// Reached nothing: the saved session is HELD and returned, so the shell opens
// offline. Refused for good: the stored session is cleared if it still holds
// the refused refresh token (a refused sign-in is not a saved one). Without
// the option, or outside the cap, the restore is exactly what it was.
export async function hydrateSupabase(session, { holdOffline = false } = {}) {
  if (!session?.access_token || !session?.refresh_token) return null
  if (!holdOffline || !insideSessionCap(session)) {
    const { data, error } = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    })
    if (error) {
      console.warn('[wilson] setSession failed:', error.message)
      return null
    }
    return data.session
  }
  const work = ownHeldWork()
  const r = await restoreSavedSession({
    auth: supabase.auth,
    saved: session,
    probe: () => connectionWatchdog.launchProbe({ origin: url ?? '', apikey: anon ?? null }),
  })
  if (r.outcome === 'held') {
    console.info(`[wilson] offline launch: the saved sign-in is held (${r.reason}); the shell opens offline`)
    hold(session, r.late, work)
    return session
  }
  releaseHeldWork(work)
  if (r.outcome === 'online') return r.session
  if (r.outcome === 'refused') await clearIfStillHolds(session.refresh_token)
  if (r.error) console.warn('[wilson] setSession failed:', r.error.message)
  return null
}
