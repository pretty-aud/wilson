/** @vitest-environment jsdom */
// =============================================================================
// usePermissions.test.jsx — S2 (night 3, 2026-10-27; docs/design/
// RECONNECT_DESIGN.md §11.5). At an offline launch inside the 4-hour cap the
// SDK holds no session and the client module holds the saved one
// (heldSession.js). The hook's rule is "the SDK's session if it has one, else
// the held one": the held token's claims with no network read, `offline` true
// while they come from the hold, `ready` from the hold itself, and nothing the
// SDK says before its own session exists (INITIAL_SESSION with none, the
// SIGNED_OUT of a refused restore) can empty it. The claims' shape is the one
// usePermissions has read since Session 1.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

const sdk = vi.hoisted(() => ({ listeners: [], getSession: null }))
vi.mock('../cloud/auth/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: (...a) => sdk.getSession(...a),
      onAuthStateChange: (cb) => {
        sdk.listeners.push(cb)
        return { data: { subscription: { unsubscribe: () => { sdk.listeners = sdk.listeners.filter((l) => l !== cb) } } } }
      },
    },
  },
}))

const { usePermissions } = await import('./usePermissions')
const { setHeldSession } = await import('../cloud/auth/heldSession')

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const sessionWith = (sub, workspaceId, role) => ({
  access_token: `${b64({ alg: 'ES256' })}.${b64({ sub, app_metadata: { workspace_id: workspaceId, workspace_ids: [workspaceId], app_role: role } })}.sig`,
  refresh_token: 'r',
})
const fire = (event, session) => { for (const l of sdk.listeners) l(event, session) }

beforeEach(() => {
  sdk.listeners = []
  sdk.getSession = vi.fn(() => new Promise(() => {}))   // the SDK's first read has not answered yet
})
afterEach(() => { cleanup(); act(() => setHeldSession(null)) })

describe('S2 — the claims of a session held at an offline launch', () => {
  it('reads the held token\'s claims with no network read; offline and ready at once', () => {
    act(() => setHeldSession(sessionWith('u-held', 'w1', 'user')))
    const { result } = renderHook(() => usePermissions())
    expect(result.current).toMatchObject({ ready: true, offline: true, userId: 'u-held', workspaceId: 'w1', role: 'user' })
    expect(result.current.can('project.create')).toBe(false)   // a member stays a member
  })

  it('an INITIAL_SESSION with no session, and the SIGNED_OUT of a refused restore, cannot empty it', () => {
    act(() => setHeldSession(sessionWith('u-held', 'w1', 'admin')))
    const { result } = renderHook(() => usePermissions())
    act(() => fire('INITIAL_SESSION', null))
    expect(result.current).toMatchObject({ offline: true, userId: 'u-held', role: 'admin' })
    act(() => fire('SIGNED_OUT', null))
    expect(result.current).toMatchObject({ offline: true, userId: 'u-held' })
  })

  it('the confirmation: the SDK\'s session wins, offline turns false', () => {
    act(() => setHeldSession(sessionWith('u-held', 'w1', 'user')))
    const { result } = renderHook(() => usePermissions())
    act(() => { fire('SIGNED_IN', sessionWith('u-held', 'w1', 'user')); setHeldSession(null) })
    expect(result.current).toMatchObject({ offline: false, userId: 'u-held', workspaceId: 'w1' })
  })

  it('the hold ending with no SDK session (a sign-out while held) empties it', () => {
    act(() => setHeldSession(sessionWith('u-held', 'w1', 'user')))
    const { result } = renderHook(() => usePermissions())
    act(() => setHeldSession(null))
    expect(result.current).toMatchObject({ offline: false, userId: null, workspaceId: null, role: null })
  })

  it('CONTROL: with nothing held the same launch is the signed-out shape, not ready until the SDK answers', () => {
    const { result } = renderHook(() => usePermissions())
    expect(result.current).toMatchObject({ ready: false, offline: false, userId: null, workspaceId: null })
    act(() => fire('INITIAL_SESSION', null))
    expect(result.current.userId).toBeNull()
  })
})
