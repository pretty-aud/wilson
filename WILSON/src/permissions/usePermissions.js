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
//     can: (action: string) => boolean, // curried can() from roleMatrix
//   }
//
// Components that just need a boolean for one action should reach for
// <PermissionGate requires="..."> instead — this hook is for when you need
// multiple checks or the numerical role to drive other logic.
// =============================================================================

import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../cloud/auth/supabaseClient'
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
  const [state, setState] = useState(EMPTY)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    // Dev fixtures (2026-09-11, dev builds only): the reviewer is the dataset's
    // admin. No session is read and no auth listener is attached.
    const fx = import.meta.env.DEV ? devFixtures() : null
    if (fx?.permissions) {
      setState({ ...EMPTY, ...fx.permissions })
      setReady(true)
      return undefined
    }

    // Prime from the current session synchronously if possible.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setState(snapshot(data?.session ?? null))
      setReady(true)
    }).catch(() => {
      if (cancelled) return
      setReady(true)
    })

    // Subscribe to all auth events — SIGNED_IN / TOKEN_REFRESHED carry a
    // new session (and possibly new claims after a workspace switch);
    // SIGNED_OUT resets to empty.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if (event === 'SIGNED_OUT') {
        setState(EMPTY)
        return
      }
      // INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED all fire
      // with a session we want to observe. PASSWORD_RECOVERY is ignored
      // here — ResetPasswordWizard drives that UI.
      setState(snapshot(session))
    })

    return () => {
      cancelled = true
      sub?.subscription?.unsubscribe()
    }
  }, [])

  const can = useCallback((action) => canDo(state.role, action), [state.role])

  // Memoize the returned object so consumers using it as a useEffect dep
  // don't re-run needlessly.
  return useMemo(() => ({
    ready,
    ...state,
    can,
  }), [ready, state, can])
}
