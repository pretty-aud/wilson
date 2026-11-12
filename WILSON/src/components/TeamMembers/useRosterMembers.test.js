// =============================================================================
// useRosterMembers.test.js — Track B, bundle B1 (Audrey's answer 17: "show an
// error when the roster fails to load").
//
// The defect this pins: the hook used to return `{ members, mode, loading }`
// and DROP the source hook's error, so a broken workspace_directory() RPC and
// a genuinely empty workspace were the same `[]` at every call site
// (OUTSTANDING, "cannot tell a broken roster from an empty one", S23).
//
// How it renders without a DOM: vitest.config.js pins `environment: 'node'`
// and there is no testing-library in the tree, so the hook is driven through
// react-dom/server. renderToString runs useState/useMemo (all this hook uses)
// and skips effects — which is exactly right here, because the three source
// hooks are mocked to return fixed state and have no effects to run. The
// result is serialised into the markup and read back.
//
// 🚨 The assertions on `error` are the point. If someone "simplifies" the
// hook back to three fields, `error` comes back undefined and this goes red.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

// Mutable state the mocked hooks read on every render.
const state = {
  adapterMode: 'supabase',
  workspace: { members: [], loading: false, error: null },
  team: { members: [], loading: false, error: null },
}

vi.mock('../../tools/rabbit_v0.1.0/state/RabbitProvider', () => ({
  useRabbit: () => ({ adapterMode: state.adapterMode }),
}))
vi.mock('./useWorkspaceMembers', () => ({
  useWorkspaceMembers: () => state.workspace,
}))
vi.mock('./useTeamMembers', () => ({
  useTeamMembers: () => state.team,
}))

import { useRosterMembers } from './useRosterMembers'

// Render the hook once and hand back what it returned.
function renderHook() {
  let captured = null
  function Probe() {
    captured = useRosterMembers()
    return createElement('pre', null, JSON.stringify(captured))
  }
  const html = renderToString(createElement(Probe))
  expect(html).toContain('<pre>')
  return captured
}

const RPC_ERROR = 'permission denied for function workspace_directory'

beforeEach(() => {
  state.adapterMode = 'supabase'
  state.workspace = { members: [], loading: false, error: null }
  state.team = { members: [], loading: false, error: null }
})

describe('useRosterMembers — the roster error is passed through, not swallowed', () => {
  it('returns the four fields, with error null on a healthy cloud roster', () => {
    state.workspace = {
      members: [{ user_id: 'u1', username: 'ada', display_name: 'Ada', is_active: true }],
      loading: false,
      error: null,
    }
    const out = renderHook()
    expect(Object.keys(out).sort()).toEqual(['error', 'loading', 'members', 'mode'])
    expect(out.mode).toBe('supabase')
    expect(out.error).toBeNull()
    expect(out.members).toHaveLength(1)
    expect(out.members[0]).toMatchObject({ id: 'u1', name: 'Ada', is_active: true })
  })

  it('surfaces the cloud roster error instead of returning a silent empty list', () => {
    state.workspace = { members: [], loading: false, error: RPC_ERROR }
    const out = renderHook()
    // An empty `members` beside a non-null `error` is a FAILURE. Before B1
    // the second half of that sentence did not exist.
    expect(out.members).toEqual([])
    expect(out.error).toBe(RPC_ERROR)
  })

  it('surfaces the local-registry error in local_server mode', () => {
    state.adapterMode = 'local_server'
    state.team = { members: [], loading: false, error: 'ECONNREFUSED 127.0.0.1' }
    const out = renderHook()
    expect(out.mode).toBe('local_server')
    expect(out.error).toBe('ECONNREFUSED 127.0.0.1')
  })

  it('only reports the ACTIVE backend\'s error — a stale error from the other hook does not leak', () => {
    // Cloud mode, but the (inactive) local hook still holds an old error.
    state.adapterMode = 'supabase'
    state.team = { members: [], loading: false, error: 'stale local error' }
    state.workspace = { members: [], loading: false, error: null }
    expect(renderHook().error).toBeNull()

    // And the reverse.
    state.adapterMode = 'local_server'
    state.team = { members: [], loading: false, error: null }
    state.workspace = { members: [], loading: false, error: 'stale cloud error' }
    expect(renderHook().error).toBeNull()
  })

  it('google_drive has no roster and no error', () => {
    state.adapterMode = 'google_drive'
    state.workspace = { members: [], loading: false, error: 'would be wrong to show' }
    const out = renderHook()
    expect(out.members).toEqual([])
    expect(out.loading).toBe(false)
    expect(out.error).toBeNull()
  })

  it('defaults to local_server when there is no RABBIT context at all', () => {
    state.adapterMode = undefined
    state.team = { members: [{ id: 't1', name: 'Tom' }], loading: false, error: null }
    const out = renderHook()
    expect(out.mode).toBe('local_server')
    expect(out.members[0]).toMatchObject({ id: 't1', name: 'Tom', is_active: true })
    expect(out.error).toBeNull()
  })
})
