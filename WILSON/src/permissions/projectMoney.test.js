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
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { canSeeProjectMoney, canOnProject, canSeeMoneyHere } from './projectRoleMatrix'

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

// Post-overhaul S5c, step 7 — Audrey's F4 (2026-10-05): "open it. im just
// using this for testing. its only me on this pc". The desktop's signed-out
// Local Server has no roles; there the money gate is open. Everywhere else
// it is canSeeProjectMoney, unchanged — the cloud's reviewer and member, and
// Derek, still see no money.
describe('canSeeMoneyHere — the screen\'s money gate (S5c step 7, F4)', () => {
  it('the Local Server: open, with no roles at all — the signed-out desktop', () => {
    expect(canSeeMoneyHere({ adapterMode: 'local_server' })).toBe(true)
    expect(canSeeMoneyHere({ adapterMode: 'local_server', appRole: null, projectRole: null })).toBe(true)
  })
  it('the cloud: exactly canSeeProjectMoney — a reviewer, a member and Derek still see none; a manager and an admin do', () => {
    const cloud = (appRole, projectRole) => canSeeMoneyHere({ adapterMode: 'supabase', appRole, projectRole })
    expect(cloud('user', 'reviewer')).toBe(false)
    expect(cloud('user', 'member')).toBe(false)
    expect(cloud('manager', 'member')).toBe(false)
    expect(cloud(null, null)).toBe(false)
    expect(cloud('user', 'manager')).toBe(true)
    expect(cloud('admin', null)).toBe(true)
    for (const appRole of ['admin', 'manager', 'user', null]) {
      for (const projectRole of ['manager', 'member', 'reviewer', null]) {
        expect(cloud(appRole, projectRole), `${appRole}/${projectRole}`).toBe(canSeeProjectMoney({ appRole, projectRole }))
        // The dev fixtures and Drive keep their roles too.
        expect(canSeeMoneyHere({ adapterMode: 'google_drive', appRole, projectRole })).toBe(canSeeProjectMoney({ appRole, projectRole }))
      }
    }
  })
  it('no backend named fails closed, as canSeeProjectMoney does', () => {
    expect(canSeeMoneyHere({})).toBe(false)
    expect(canSeeMoneyHere()).toBe(false)
  })

  // The Budget tab and the Control Panel's budget variables read it, by the
  // provider's backend kind — and the tab hides on its answer.
  const here = dirname(fileURLToPath(import.meta.url))
  const read = (rel) => readFileSync(join(here, rel), 'utf8').replace(/\r\n/g, '\n')
  const READ_HERE = /const canSeeMoney = canSeeMoneyHere\(\{\s*adapterMode: ctx\?\.adapterMode,\s*appRole: perms\?\.role,\s*projectRole: ctx\?\.myProjectRole,\s*\}\)/
  it('Rabbit.jsx hides the Budget tab on it, and ProjectSummaryView.jsx shows the budget variables on it', () => {
    const shell = read('../tools/rabbit_v0.1.0/Rabbit.jsx')
    expect(shell).toMatch(READ_HERE)
    expect(shell).toMatch(/if \(!canSeeMoney\) hidden\.add\('budget'\)/)
    expect(read('../tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx')).toMatch(READ_HERE)
  })
  it('CONTROL: the old gate (no backend) does not read as it', () => {
    const old = 'const canSeeMoney = canSeeProjectMoney({\n    appRole: perms?.role,\n    projectRole: ctx?.myProjectRole,\n  })'
    expect(old).not.toMatch(READ_HERE)
  })
})
