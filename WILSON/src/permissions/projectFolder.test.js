// =============================================================================
// projectFolder.test.js — Session 35: who may set projects.folder_root.
//
// Client mirror of fn_project_folder_root_guard's seat (migration 0049):
// in CLOUD mode (a workspaceId is present), current_app_role() IN
// ('admin','manager'), no project-seat opening. In LOCAL / solo mode (no
// workspaceId) the seat does not apply — there are no roles and the local
// Express route enforces containment alone, so gating on the null role would
// grey a control nothing below refuses (S35 review, HIGH regression). Keyed
// on workspaceId exactly as S34's canEditMachineRoot gate is.
//
// Fail-OPEN while permissions resolve (the S23 rule — the enforcement layers
// refuse on their own, so a moment of visibility beats an admin losing the
// control to a hung getSession()). The reason pairs 1:1 with the rule (S29).
// =============================================================================

import { describe, it, expect } from 'vitest'
import { canSetProjectFolder, projectFolderDeniedReason } from './projectRoleMatrix.js'

const WS = '11111111-1111-1111-1111-111111111111'

// [appRole, projectRole, workspaceId, ready, expected] — projectRole is listed
// to prove it plays NO part; workspaceId splits cloud from local.
const EXPECTED = [
  // ── cloud (workspaceId present): the seat gates ──
  ['admin',   null,       WS,   true,  true],
  ['admin',   'reviewer', WS,   true,  true],
  ['manager', null,       WS,   true,  true],
  ['manager', 'member',   WS,   true,  true],
  ['user',    null,       WS,   true,  false],
  ['user',    'manager',  WS,   true,  false], // the project seat does not qualify
  ['user',    'member',   WS,   true,  false],
  ['user',    'reviewer', WS,   true,  false],
  [null,      null,       WS,   true,  false],
  // ── local / solo (no workspaceId): the seat does not apply, all allowed ──
  [null,      null,       null, true,  true],
  ['user',    null,       null, true,  true],
  [null,      'manager',  null, true,  true],
  [undefined, undefined,  undefined, true, true],
]

describe('canSetProjectFolder — cloud seat, local passthrough', () => {
  for (const [appRole, projectRole, workspaceId, ready, expected] of EXPECTED) {
    it(`appRole=${appRole} ws=${workspaceId ? 'set' : 'none'} → ${expected}`, () => {
      expect(canSetProjectFolder({ appRole, projectRole, workspaceId, ready })).toBe(expected)
    })
  }

  it('fails OPEN while permissions resolve (ready === false), cloud or local', () => {
    expect(canSetProjectFolder({ appRole: null, workspaceId: WS, ready: false })).toBe(true)
    expect(canSetProjectFolder({ appRole: 'user', workspaceId: WS, ready: false })).toBe(true)
  })

  it('a cloud user with no seat is the ONLY denied shape', () => {
    // The regression the review caught: a signed-out/local desktop (no ws)
    // must NOT be denied.
    expect(canSetProjectFolder({ appRole: null, workspaceId: null, ready: true })).toBe(true)
    expect(canSetProjectFolder({ appRole: 'user', workspaceId: WS, ready: true })).toBe(false)
  })

  it('missing ctx behaves like local passthrough (no workspaceId)', () => {
    expect(canSetProjectFolder(undefined)).toBe(true)
    expect(canSetProjectFolder({})).toBe(true)
  })
})

describe('projectFolderDeniedReason — non-null exactly when denied', () => {
  for (const [appRole, projectRole, workspaceId, ready, expected] of EXPECTED) {
    it(`appRole=${appRole} ws=${workspaceId ? 'set' : 'none'} → ${expected ? 'null' : 'a sentence'}`, () => {
      const reason = projectFolderDeniedReason({ appRole, projectRole, workspaceId, ready })
      if (expected) expect(reason).toBeNull()
      else expect(typeof reason).toBe('string')
    })
  }

  it('no reason while permissions resolve — grey must never mean loading', () => {
    expect(projectFolderDeniedReason({ appRole: null, workspaceId: WS, ready: false })).toBeNull()
  })

  it('no reason in local mode — the control is live there', () => {
    expect(projectFolderDeniedReason({ appRole: null, workspaceId: null, ready: true })).toBeNull()
  })

  it('the sentence names the seat that would work, not "permission denied"', () => {
    const reason = projectFolderDeniedReason({ appRole: 'user', workspaceId: WS, ready: true })
    expect(reason).toMatch(/workspace admin or manager/)
  })
})
