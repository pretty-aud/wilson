// =============================================================================
// roleMatrix.test.js — the Vitest suite the roleMatrix header promised.
//
// The EXPECTED table below is the human-readable contract for every
// role × action pair. If you change the matrix, change this table in the
// same commit — a mismatch in either direction fails the suite, including
// actions added to ACTIONS but forgotten here (see the completeness test).
// =============================================================================

import { describe, it, expect } from 'vitest'
import { can, atLeast, ROLES, ACTIONS } from './roleMatrix'

// action -> roles allowed. Every action in ACTIONS must appear exactly once.
const EXPECTED = {
  'member.invite':               ['admin'],
  'member.profile.edit_others':  ['admin', 'manager'],
  'member.remove':               ['admin'],
  'member.role.change':          ['admin'],
  'project.create':              ['admin', 'manager'],
  'project.delete':              ['admin'],
  'rabbit.history.view':         ['admin', 'manager'],
  'rate_card.edit':              ['admin'],
  'rate_card.view':              ['admin', 'manager'],
  'workspace.settings.read':     ['admin', 'manager', 'user'],
  'workspace.settings.write':    ['admin'],
}

describe('roleMatrix contract', () => {
  it('EXPECTED covers every action in ACTIONS (and nothing else)', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...ACTIONS].sort())
  })

  it('ACTIONS is alphabetised (the file asks for it; the tooling now enforces it)', () => {
    expect([...ACTIONS]).toEqual([...ACTIONS].sort())
  })

  it('ROLES is the frozen admin/manager/user triple', () => {
    expect([...ROLES]).toEqual(['admin', 'manager', 'user'])
    expect(Object.isFrozen(ROLES)).toBe(true)
    expect(Object.isFrozen(ACTIONS)).toBe(true)
  })

  // The full matrix, both directions: allowed pairs return true, every
  // other pair returns false.
  for (const action of Object.keys(EXPECTED)) {
    for (const role of ['admin', 'manager', 'user']) {
      const allowed = EXPECTED[action].includes(role)
      it(`can('${role}', '${action}') === ${allowed}`, () => {
        expect(can(role, action)).toBe(allowed)
      })
    }
  }
})

describe('can() edge cases', () => {
  it('returns false for unknown actions (warn-and-deny, never throw)', () => {
    expect(can('admin', 'not.a.real.action')).toBe(false)
  })
  it('returns false for unknown roles', () => {
    expect(can('platform_operator', 'member.invite')).toBe(false)
    expect(can('superuser', 'workspace.settings.read')).toBe(false)
  })
  it('returns false for null/undefined role', () => {
    expect(can(null, 'member.invite')).toBe(false)
    expect(can(undefined, 'workspace.settings.read')).toBe(false)
  })
  it('returns false for missing action', () => {
    expect(can('admin', undefined)).toBe(false)
    expect(can('admin', '')).toBe(false)
  })
})

describe('atLeast()', () => {
  it('orders admin > manager > user', () => {
    expect(atLeast('admin', 'user')).toBe(true)
    expect(atLeast('admin', 'manager')).toBe(true)
    expect(atLeast('admin', 'admin')).toBe(true)
    expect(atLeast('manager', 'user')).toBe(true)
    expect(atLeast('manager', 'manager')).toBe(true)
    expect(atLeast('manager', 'admin')).toBe(false)
    expect(atLeast('user', 'user')).toBe(true)
    expect(atLeast('user', 'manager')).toBe(false)
    expect(atLeast('user', 'admin')).toBe(false)
  })
  it('unknown roles and levels never pass', () => {
    expect(atLeast(null, 'user')).toBe(false)
    expect(atLeast('admin', 'made_up_level')).toBe(false)
  })
})
