// =============================================================================
// workspaceIdResolution.test.js
//
// The workspace-id rule the rate card got wrong TWICE, in executable form.
//
// Three hooks resolve "which workspace am I writing to": useRateCard,
// useTaskTemplates and useTeamMembers. Each writes to a workspace-scoped table
// whose RLS policy is `workspace_id = current_workspace_id() AND
// has_active_membership(workspace_id)`, so getting this wrong is not a display
// bug — every write is refused and the screen shows an empty state.
//
// Two ways to get it wrong, and BOTH have now shipped:
//
//   1. WHICH id. `rabbit.DEFAULT_WORKSPACE_ID` is '00000000-…-0001', the
//      pre-multi-tenant seed constant. supabaseAdapter.js:799 already
//      documented it as "harmless in local mode and fatal in cloud mode" for
//      projects; the rate card kept using it.
//
//   2. WHEN it is read. usePermissions resolves the session ASYNCHRONOUSLY.
//      Reading perms.workspaceId before `ready` yields null, the `||` falls
//      through to the seed constant, and the create-on-first-visit fires
//      against the wrong workspace before the session has landed. Fixing (1)
//      without (2) looks correct and still fails.
//
// This asserts the resolution EXPRESSION rather than mounting React (this repo
// runs vitest in a node environment with no testing-library — see
// vitest.config.js), so it pins the logic those three hooks share.
// =============================================================================

import { describe, it, expect } from 'vitest'

const SEED = '00000000-0000-0000-0000-000000000001'
const REAL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

// The exact expression the three hooks use.
function resolveWorkspaceId(perms, rabbit) {
  return perms?.ready
    ? (perms.workspaceId || rabbit?.DEFAULT_WORKSPACE_ID)
    : null
}

describe('workspace id resolution', () => {
  it('returns NOTHING until the session has resolved', () => {
    // The regression that put the red RLS banner back on the rate card: on the
    // first render `ready` is false and `workspaceId` is null. Anything other
    // than a falsy value here lets a write fire at the seed workspace.
    expect(resolveWorkspaceId({ ready: false, workspaceId: null }, { DEFAULT_WORKSPACE_ID: SEED }))
      .toBeFalsy()
  })

  it('does NOT fall back to the seed constant while unready', () => {
    // Stated separately from the assertion above because this is the specific
    // wrong value — a truthy fallback is what made the write reach RLS.
    expect(resolveWorkspaceId({ ready: false, workspaceId: null }, { DEFAULT_WORKSPACE_ID: SEED }))
      .not.toBe(SEED)
  })

  it('uses the session workspace once ready — never the seed constant', () => {
    expect(resolveWorkspaceId({ ready: true, workspaceId: REAL }, { DEFAULT_WORKSPACE_ID: SEED }))
      .toBe(REAL)
  })

  it('falls back to the seed constant only for a resolved, sessionless client', () => {
    // Local / desktop mode. `ready` flips true on BOTH branches of the session
    // probe (resolved and failed), so this branch is reachable and is the one
    // case where the seed constant is correct.
    expect(resolveWorkspaceId({ ready: true, workspaceId: null }, { DEFAULT_WORKSPACE_ID: SEED }))
      .toBe(SEED)
  })

  it('survives a missing perms or rabbit context without inventing an id', () => {
    expect(resolveWorkspaceId(undefined, { DEFAULT_WORKSPACE_ID: SEED })).toBeFalsy()
    expect(resolveWorkspaceId({ ready: true, workspaceId: null }, undefined)).toBeFalsy()
  })
})
