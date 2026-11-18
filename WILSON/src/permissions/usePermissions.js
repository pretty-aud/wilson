// =============================================================================
// usePermissions — React hook that reads the caller's app-level role from
// the current Supabase session JWT and re-renders when it changes.
//
// The JWT shape (frozen in Session 1) is:
//   auth.jwt() = {
//     sub: <user_id>,
//     email: <user email>,
//     app_metadata: {
//       workspace_id: <uuid>,
//       workspace_ids: [<uuid>, ...],
//       app_role: 'admin'|'manager'|'user',
//       is_platform_operator: boolean
//     }
//   }
//
// F5 item 7 (2026-11-16; the review's shared B3): every reader reads ONE
// store, cloud/auth/authSnapshot.js, with useSyncExternalStore. Before, each of
// the 38 call sites held its own copy, with its own getSession() and its own
// onAuthStateChange subscription. The store attaches one listener and one
// priming read for all of them, and the hook reads its permission fields
// alone (getPermissionsSnapshot), one object whose identity changes only when
// one of them does: a TOKEN_REFRESHED with the same claims redraws no reader,
// and SIGNED_IN / TOKEN_REFRESHED that carry new claims (a workspace switch)
// still redraw every one, with no reload.
//
// Returned shape:
//   {
//     ready: boolean,                   // true once the first session read has settled
//     role: 'admin'|'manager'|'user'|null,
//     workspaceId: string|null,
//     workspaceIds: string[],
//     isPlatformOperator: boolean,
//     userId: string|null,
//     offline: boolean,                 // S2: the claims come from a session held at an offline launch
//     can: (action: string) => boolean, // curried can() from roleMatrix, one per role
//   }
// The same object for every reader until a field changes, so a consumer using
// it as a useEffect dep does not re-run needlessly.
//
// S2 (night 3, 2026-10-27; docs/design/RECONNECT_DESIGN.md §11.5): at an
// offline launch inside the 4-hour cap the SDK holds no session (auth-js's
// _setSession saved nothing) and the client module holds the saved one. The
// claims are then the HELD token's, read with no network read, so a company
// member stays one offline (and the pet keeps its owner, and a member does not
// get a solo user's control of this computer's storage folder). The rule is
// "the SDK's session if it has one, else the held one", recomputed on every
// auth event and every change of the hold — an INITIAL_SESSION with no session
// arriving after the hold cannot empty it. `offline` is true while the claims
// come from the held session; it turns false at the confirmation, and the
// screens and the once-per-sign-in reads key on that. `ready` is also true as
// soon as a session is held. The store keeps that rule (authSnapshot.js).
//
// Components that just need a boolean for one action should reach for
// <PermissionGate requires="..."> instead — this hook is for when you need
// multiple checks or the numerical role to drive other logic.
// =============================================================================

import { useSyncExternalStore } from 'react'
import { subscribeAuthSnapshot, getPermissionsSnapshot } from '../cloud/auth/authSnapshot'
import { can as canDo } from './roleMatrix'
import { devFixtures } from '../dev/devFixtures'

const EMPTY = {
  userId: null,
  role: null,
  workspaceId: null,
  workspaceIds: [],
  isPlatformOperator: false,
}

// `can` is one function per role, so an effect keyed on it re-runs only when
// the role changes.
const canByRole = new Map()
function canFor(role) {
  let fn = canByRole.get(role)
  if (!fn) {
    fn = (action) => canDo(role, action)
    canByRole.set(role, fn)
  }
  return fn
}

// The hook's answer for one permissions snapshot: the same object for as long
// as the snapshot is the same.
let answeredFor = null
let answer = null
function answerFor(p) {
  if (p !== answeredFor) {
    answeredFor = p
    answer = {
      ready: p.ready,
      userId: p.userId,
      role: p.role,
      workspaceId: p.workspaceId,
      workspaceIds: p.workspaceIds,
      isPlatformOperator: p.isPlatformOperator,
      offline: p.offline,
      can: canFor(p.role),
    }
  }
  return answer
}

// Dev fixtures (2026-09-11, dev builds only): the reviewer is the dataset's
// admin. No session is read and no auth listener is attached (the hook does
// not subscribe to the store).
let fixtureFor = null
let fixtureAnswer = null
function fixtureAnswerFor(permissions) {
  if (permissions !== fixtureFor) {
    fixtureFor = permissions
    const state = { ...EMPTY, ...permissions }
    fixtureAnswer = { ready: true, ...state, offline: false, can: canFor(state.role) }
  }
  return fixtureAnswer
}

const noSubscription = () => () => {}

export function usePermissions() {
  const fx = import.meta.env.DEV ? devFixtures() : null
  const fixture = fx?.permissions ? fixtureAnswerFor(fx.permissions) : null
  const p = useSyncExternalStore(
    fixture ? noSubscription : subscribeAuthSnapshot,
    getPermissionsSnapshot,
    getPermissionsSnapshot,
  )
  return fixture ?? answerFor(p)
}
