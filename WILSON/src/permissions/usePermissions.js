// =============================================================================
// usePermissions — React hook that reads the caller's app-level role from
// the current Supabase session JWT and re-renders on auth-state changes.
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
// The hook subscribes to supabase.auth.onAuthStateChange so TOKEN_REFRESHED
// and SIGNED_IN events propagate new role values WITHOUT a reload. This is
// the same pattern RabbitProvider uses (see comment in Session 2 handoff).
//
// Returned shape:
//   {
//     ready: boolean,                   // true once we've resolved the first session
//     role: 'admin'|'manager'|'user'|null,
//     workspaceId: string|null,
//     workspaceIds: string[],
//     isPlatformOperator: boolean,
//     userId: string|null,
//     offline: boolean,                 // S2: the claims come from a session held at an offline launch
//     can: (action: string) => boolean, // curried can() from roleMatrix
//   }
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
// soon as a session is held.
//
// Components that just need a boolean for one action should reach for
// <PermissionGate requires="..."> instead — this hook is for when you need
// multiple checks or the numerical role to drive other logic.
// =============================================================================

import { useEffect, useMemo, useState, useCallback, useSyncExternalStore } from 'react'
import { supabase } from '../cloud/auth/supabaseClient'
import { heldSession, subscribeHeldSession } from '../cloud/auth/heldSession'
import { can as canDo } from './roleMatrix'
import { devFixtures } from '../dev/devFixtures'

// Extract the app_metadata block from a Supabase session's JWT. We decode
// the access_token payload directly rather than calling getUser() because
// (a) getUser hits the network, (b) app_metadata is already in the JWT and
// always authoritative.
function readClaims(session) {
  if (!session?.access_token) return null
  const parts = session.access_token.split('.')
  if (parts.length !== 3) return null
  try {
    // Base64url decode. atob() needs padding and +/ instead of -_.
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
    const json = atob(b64 + pad)
    return JSON.parse(json)
  } catch {
    return null
  }
}

function snapshot(session) {
  const claims = readClaims(session)
  const md = claims?.app_metadata ?? {}
  return {
    userId:              claims?.sub ?? null,
    role:                md.app_role ?? null,
    workspaceId:         md.workspace_id ?? null,
    workspaceIds:        Array.isArray(md.workspace_ids) ? md.workspace_ids : [],
    isPlatformOperator:  !!md.is_platform_operator,
  }
}

const EMPTY = {
  userId: null,
  role: null,
  workspaceId: null,
  workspaceIds: [],
  isPlatformOperator: false,
}

export function usePermissions() {
  // The SDK's own session as the last read or event left it (null: none).
  const [sdkSession, setSdkSession] = useState(null)
  const [fixtureState, setFixtureState] = useState(null)
  const [ready, setReady] = useState(false)
  // S2: the session the client module holds at an offline launch, or null.
  const held = useSyncExternalStore(subscribeHeldSession, heldSession, heldSession)

  useEffect(() => {
    let cancelled = false

    // Dev fixtures (2026-09-11, dev builds only): the reviewer is the dataset's
    // admin. No session is read and no auth listener is attached.
    const fx = import.meta.env.DEV ? devFixtures() : null
    if (fx?.permissions) {
      setFixtureState({ ...EMPTY, ...fx.permissions })
      setReady(true)
      return undefined
    }

    // Prime from the current session synchronously if possible.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSdkSession(data?.session ?? null)
      setReady(true)
    }).catch(() => {
      if (cancelled) return
      setReady(true)
    })

    // Subscribe to all auth events — SIGNED_IN / TOKEN_REFRESHED carry a
    // new session (and possibly new claims after a workspace switch);
    // SIGNED_OUT resets to empty (or to the held session, while one is held).
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if (event === 'SIGNED_OUT') {
        setSdkSession(null)
        return
      }
      // INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED all fire
      // with a session we want to observe. PASSWORD_RECOVERY is ignored
      // here — ResetPasswordWizard drives that UI.
      setSdkSession(session ?? null)
    })

    return () => {
      cancelled = true
      sub?.subscription?.unsubscribe()
    }
  }, [])

  // The SDK's session if it has one, else the held one (S2).
  const state = useMemo(
    () => fixtureState ?? snapshot(sdkSession ?? held ?? null),
    [fixtureState, sdkSession, held],
  )
  const offline = !fixtureState && !sdkSession && !!held
  const isReady = ready || offline

  const can = useCallback((action) => canDo(state.role, action), [state.role])

  // Memoize the returned object so consumers using it as a useEffect dep
  // don't re-run needlessly.
  return useMemo(() => ({
    ready: isReady,
    ...state,
    offline,
    can,
  }), [isReady, state, offline, can])
}
