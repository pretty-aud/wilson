// =============================================================================
// authSnapshot — who is signed in, held ONCE for every reader (F5 item 7, the
// review's shared B3 and B4).
//
// Before: usePermissions held its own copy per instance, with its own
// getSession() and its own onAuthStateChange subscription at each of its 38
// call sites, and every TOKEN_REFRESHED redrew each one although its claims had
// not moved. Now there is one module-level store, read with
// useSyncExternalStore as heldSession.js is. Its first subscriber attaches ONE
// auth listener and ONE priming read (and follows the hold); when the last one
// leaves, a microtask later, it detaches and resets: StrictMode's unmount and
// mount in one commit keep it, and a test that resets its mocks between tests
// gets a fresh attach.
//
// The snapshot: { session, token, claims, userId, workspaceId, workspaceIds,
// role, isPlatformOperator, offline, ready }, by the rule usePermissions has
// kept since S2 (RECONNECT_DESIGN.md §11.5): the SDK's session if it has one,
// else the session held at an offline launch; `offline` while the claims come
// from the held one; `ready` once the priming read has settled, or at once
// while a session is held. SIGNED_OUT empties the SDK's side at once (a held
// session, until its hold ends, still answers). An auth event is newer than
// the priming read, so a priming read answered after one is not applied: it
// may carry the previous person's session.
//
// getPermissionsSnapshot() is the snapshot's permission fields only, as one
// object whose identity changes only when one of them does, so a
// TOKEN_REFRESHED with the same claims (a new token, a new expiry) redraws no
// reader of usePermissions.
//
// The active workspace is the ACCESS TOKEN's claim (SYSTEMS_HANDBOOK §4.3:
// every RLS policy starts from it), never the user object's app_metadata.
// After a deactivated membership the access-token hook re-derives the claim
// while the user object keeps what issue-session last wrote, so a read from
// the user object joins one company's channel while RLS answers for another,
// and an app_events row or a model override written for it is refused.
// workspaceFromSession() is that rule for a session read anywhere else (a
// getSession() result, an auth event's session).
//
// ⚠ The listener returns synchronously and awaits nothing: auth-js runs every
// subscriber inside its lock and awaits it (RabbitProvider.jsx's Session 17
// note; authStateCallbacks.test.js). It sets this module's state and tells the
// readers, and React draws them later.
//
// Imports: `supabase` alone from supabaseClient (about 95 test files mock that
// module with nothing else, some without onAuthStateChange or getSession, so
// every use of it is guarded); heldSession.js; and the one JWT decoder,
// sessionTimeouts.js's readJwtClaims.
// =============================================================================

import { useSyncExternalStore } from 'react'
import { supabase } from './supabaseClient'
import { heldSession, subscribeHeldSession } from './heldSession'
import { readJwtClaims } from './sessionTimeouts'

/**
 * The workspace a session is for: its access token's claim when the token
 * decodes (null when the claim is absent), else the user object's, only when
 * there is no token to read (a test's session).
 */
export function workspaceFromSession(session) {
  if (!session) return null
  const claims = readJwtClaims(session.access_token)
  if (claims) return claims.app_metadata?.workspace_id ?? null
  return session.user?.app_metadata?.workspace_id ?? null
}

function snapshotOf(sdk, held, primed) {
  const session = sdk ?? held ?? null
  const token = session?.access_token ?? null
  const claims = readJwtClaims(token)
  const md = claims?.app_metadata ?? {}
  const offline = !sdk && !!held
  return {
    session,
    token,
    claims,
    userId:             claims?.sub ?? null,
    workspaceId:        md.workspace_id ?? null,
    workspaceIds:       Array.isArray(md.workspace_ids) ? md.workspace_ids : [],
    role:               md.app_role ?? null,
    isPlatformOperator: !!md.is_platform_operator,
    offline,
    ready:              primed || offline,
  }
}

const sameIds = (a, b) => a === b || (a.length === b.length && a.every((id, i) => id === b[i]))

function samePermissions(p, s) {
  return p.ready === s.ready && p.userId === s.userId && p.role === s.role
    && p.workspaceId === s.workspaceId && p.isPlatformOperator === s.isPlatformOperator
    && p.offline === s.offline && sameIds(p.workspaceIds, s.workspaceIds)
}

const permissionsOf = (s) => ({
  ready: s.ready,
  userId: s.userId,
  role: s.role,
  workspaceId: s.workspaceId,
  workspaceIds: s.workspaceIds,
  isPlatformOperator: s.isPlatformOperator,
  offline: s.offline,
})

const listeners = new Set()
let link = null           // the attachment while anyone subscribes: { off: [unsubscribes] }
let detachQueued = false
let sdkSession = null     // the SDK's session as the last event, or the priming read, left it
let primed = false        // the priming read has settled
let heard = false         // an auth event has arrived since the attach
let usedHeld = heldSession()
let snapshot = snapshotOf(null, usedHeld, false)
let permissions = permissionsOf(snapshot)

/** Recompute from the current state; false when nothing in the snapshot moved. */
function recompute() {
  const held = heldSession()
  usedHeld = held
  const next = snapshotOf(sdkSession, held, primed)
  if (next.session === snapshot.session && next.ready === snapshot.ready && next.offline === snapshot.offline) return false
  snapshot = next
  if (!samePermissions(permissions, next)) permissions = permissionsOf(next)
  return true
}

function update() {
  if (!recompute()) return
  for (const listener of [...listeners]) {
    try { listener() } catch { /* a reader's failure is not the store's */ }
  }
}

// A read while nobody subscribes still sees the hold (the first reader's first
// draw comes before its subscription). It tells nobody; while anyone
// subscribes, a change of the hold is told by subscribeHeldSession.
function follow() {
  if (!link && heldSession() !== usedHeld) recompute()
}

function attach() {
  const mine = { off: [] }
  link = mine
  sdkSession = null
  primed = false
  heard = false
  mine.off.push(subscribeHeldSession(() => { if (link === mine) update() }))
  // The hold as it is now: React compares its first draw with this once it
  // has subscribed, so a change of the hold in between is not missed.
  recompute()
  let auth = null
  try { auth = supabase?.auth ?? null } catch { auth = null }

  // The ONE priming read.
  let read
  try {
    read = typeof auth?.getSession === 'function' ? auth.getSession() : undefined
  } catch (err) {
    read = Promise.reject(err)
  }
  Promise.resolve(read).then(
    (r) => {
      if (link !== mine) return
      if (!heard) sdkSession = r?.data?.session ?? null
      primed = true
      update()
    },
    () => {
      if (link !== mine) return
      primed = true
      update()
    },
  )

  // The ONE auth listener. Synchronous, awaits nothing (header). Every event
  // but SIGNED_OUT carries the session to observe (INITIAL_SESSION, SIGNED_IN,
  // TOKEN_REFRESHED, USER_UPDATED, MFA_CHALLENGE_VERIFIED, PASSWORD_RECOVERY).
  try {
    const r = typeof auth?.onAuthStateChange === 'function'
      ? auth.onAuthStateChange((event, session) => {
        if (link !== mine) return
        heard = true
        sdkSession = event === 'SIGNED_OUT' ? null : (session ?? null)
        update()
      })
      : null
    const sub = r?.data?.subscription
    if (sub) mine.off.push(() => sub.unsubscribe?.())
  } catch { /* a client without auth events: the priming read and the hold still answer */ }
}

function detach() {
  const mine = link
  link = null
  for (const off of mine?.off ?? []) {
    try { off() } catch { /* best effort */ }
  }
  sdkSession = null
  primed = false
  heard = false
  recompute()
}

/** Called on every change of the snapshot. Returns the unsubscribe. */
export function subscribeAuthSnapshot(listener) {
  listeners.add(listener)
  if (!link) attach()
  let subscribed = true
  return () => {
    if (!subscribed) return
    subscribed = false
    listeners.delete(listener)
    if (listeners.size > 0 || detachQueued) return
    detachQueued = true
    // A microtask, not a timer: a test's fake timers cannot hold it.
    Promise.resolve().then(() => {
      detachQueued = false
      if (listeners.size === 0 && link) detach()
    })
  }
}

/** The whole snapshot (a new object whenever the session, `ready` or `offline` changes). */
export function getAuthSnapshot() {
  follow()
  return snapshot
}

/** The permission fields alone: { ready, userId, role, workspaceId, workspaceIds, isPlatformOperator, offline }. */
export function getPermissionsSnapshot() {
  follow()
  return permissions
}

/** React: the whole snapshot. usePermissions is the reader for the permission fields. */
export function useAuthSnapshot() {
  return useSyncExternalStore(subscribeAuthSnapshot, getAuthSnapshot, getAuthSnapshot)
}
