// ============================================================
// projectMoney.test.js — Session 24
// ============================================================
//
// canSeeProjectMoney is the client mirror of can_access_project_money(uuid)
// (migration 0037). The database is the authority — a reviewer reads zero
// rows whatever React does — but this function decides whether the Budget tab
// is offered at all, and it is easy to "fix" into the wrong shape by making
// it consistent with canOnProject().
//
// The case that made this worth a test: on wilson-staging, `derek` holds
// app_role 'manager' at the WORKSPACE and project_role 'member' on Legend
// Road. Audrey was asked directly and said he must NOT see money. Every other
// permission in the app would let him through.

import { describe, it, expect } from 'vitest'
import { canSeeProjectMoney, canOnProject } from './projectRoleMatrix'

describe('canSeeProjectMoney — who may see budgets, rates and actuals', () => {
  it('lets a workspace admin see money', () => {
    expect(canSeeProjectMoney({ appRole: 'admin', projectRole: null })).toBe(true)
  })

  it('lets a project manager see money even with app_role user', () => {
    expect(canSeeProjectMoney({ appRole: 'user', projectRole: 'manager' })).toBe(true)
  })

  // 🚨 The one that is wrong in every other permission in the app.
  it('does NOT let a workspace manager who is only a project member see money', () => {
    expect(canSeeProjectMoney({ appRole: 'manager', projectRole: 'member' })).toBe(false)
  })

  it('does not let a workspace manager with no project seat see money', () => {
    expect(canSeeProjectMoney({ appRole: 'manager', projectRole: null })).toBe(false)
  })

  it('does not let a reviewer see money', () => {
    expect(canSeeProjectMoney({ appRole: 'user', projectRole: 'reviewer' })).toBe(false)
  })

  it('does not let a plain team member see money', () => {
    expect(canSeeProjectMoney({ appRole: 'user', projectRole: 'member' })).toBe(false)
  })

  // Fails CLOSED while permissions are still loading. The direction matters:
  // the Budget tab APPEARS a beat late for a project manager rather than
  // being shown to a reviewer and snatched back — the "control silently
  // vanishes" pattern that cost S23 hours.
  it('fails closed on empty or missing context', () => {
    expect(canSeeProjectMoney({})).toBe(false)
    expect(canSeeProjectMoney(null)).toBe(false)
    expect(canSeeProjectMoney(undefined)).toBe(false)
    expect(canSeeProjectMoney({ appRole: null, projectRole: null })).toBe(false)
  })

  it('has no unstaffed-project opening, unlike every write permission', () => {
    // canOnProject lets ANYONE write on an unstaffed project (isStaffed
    // false). If money ever inherited that, an unstaffed project would expose
    // its whole budget to the workspace. There is no isStaffed input here at
    // all, which is the point.
    expect(canOnProject({ appRole: 'user', projectRole: null, isStaffed: false }, 'project.entity.write')).toBe(true)
    expect(canSeeProjectMoney({ appRole: 'user', projectRole: null })).toBe(false)
  })

  it('diverges from canOnProject exactly where it should', () => {
    const derek = { appRole: 'manager', projectRole: 'member', isStaffed: true }
    // Derek can do every ordinary project thing...
    expect(canOnProject(derek, 'project.entity.write')).toBe(true)
    expect(canOnProject(derek, 'project.roster.manage')).toBe(true)
    // ...and still cannot see a number.
    expect(canSeeProjectMoney(derek)).toBe(false)
  })
})
