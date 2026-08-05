// =============================================================================
// projectRoleMatrix.test.js — the Vitest suite the projectRoleMatrix header
// promised.
//
// The EXPECTED table below is the human-readable contract for every
// appRole × projectRole × staffed combination, per action. If you change the
// matrix, change this table in the same commit — a mismatch in either
// direction fails the suite, including combinations forgotten here (see the
// completeness test).
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  canOnProject, canSeeProjectMoney, canWriteTaskTemplate,
  PROJECT_ROLES, PROJECT_ACTIONS,
} from './projectRoleMatrix'

// One row per (appRole, projectRole, staffed) combination. projectRole null
// means no seat on the project. Seats on an unstaffed project are incoherent
// (a seat IS staffing, so the DB can't produce them) but the matrix must
// still answer exactly like the 0013 SQL helper expressions would.
// Columns map 1:1 onto ACTION_COLUMNS below.
// Session 25 adds the `settings` column — the Project Control Panel.
//
// 🚨 Read the `user`/staffed block below carefully: it is the ONLY action
// where a REVIEWER is allowed and a MEMBER is not. `entity` is the exact
// inverse on those two seats. Audrey, 2026-08-04: "managers and reviewers
// should be able to see and press the button and open the control panel …
// basic team members do not need access to the panel at all."
const EXPECTED = [
  //  appRole    projectRole  staffed  comment entity roster settings
  // ── app admin: bypasses everything ──
  ['admin',   'manager',  true,   true,  true,  true,  true],
  ['admin',   'reviewer', true,   true,  true,  true,  true],
  ['admin',   'member',   true,   true,  true,  true,  true],
  ['admin',   null,       true,   true,  true,  true,  true],
  ['admin',   'manager',  false,  true,  true,  true,  true],
  ['admin',   'reviewer', false,  true,  true,  true,  true],
  ['admin',   'member',   false,  true,  true,  true,  true],
  ['admin',   null,       false,  true,  true,  true,  true],
  // ── app manager: bypasses everything ──
  ['manager', 'manager',  true,   true,  true,  true,  true],
  ['manager', 'reviewer', true,   true,  true,  true,  true],
  ['manager', 'member',   true,   true,  true,  true,  true],
  ['manager', null,       true,   true,  true,  true,  true],
  ['manager', 'manager',  false,  true,  true,  true,  true],
  ['manager', 'reviewer', false,  true,  true,  true,  true],
  ['manager', 'member',   false,  true,  true,  true,  true],
  ['manager', null,       false,  true,  true,  true,  true],
  // ── app user, staffed: the seat decides ──
  // Note reviewer/member on `settings` vs `entity`: they are opposites, and
  // that is deliberate, not a transcription slip.
  ['user',    'manager',  true,   true,  true,  true,  true],
  ['user',    'reviewer', true,   true,  false, false, true],
  ['user',    'member',   true,   true,  true,  false, false],
  ['user',    null,       true,   false, false, false, false],
  // ── app user, unstaffed: entity + comment + settings open, roster closed ──
  // settings opens here because a project is unstaffed the instant it is
  // created, and ProjectSummaryView:124 opens this panel immediately after
  // createProject. Closing it would lock the creator out of the project they
  // just made.
  ['user',    'manager',  false,  true,  true,  true,  true],
  ['user',    'reviewer', false,  true,  true,  false, true],
  ['user',    'member',   false,  true,  true,  false, true],
  ['user',    null,       false,  true,  true,  false, true],
]

const ACTION_COLUMNS = [
  'project.comment.write', 'project.entity.write',
  'project.roster.manage', 'project.settings.open',
]

describe('projectRoleMatrix contract', () => {
  it('EXPECTED covers every appRole × projectRole × staffed combination exactly once', () => {
    const combos = EXPECTED.map(([appRole, projectRole, staffed]) => `${appRole}|${projectRole}|${staffed}`)
    expect(new Set(combos).size).toBe(combos.length)
    // 3 app roles × (3 project roles + no seat) × staffed/unstaffed
    expect(combos.length).toBe(3 * 4 * 2)
  })

  it('ACTION_COLUMNS matches PROJECT_ACTIONS (a new action needs new table columns)', () => {
    expect(ACTION_COLUMNS).toEqual([...PROJECT_ACTIONS])
  })

  it('PROJECT_ACTIONS is alphabetised (the file asks for it; the tooling now enforces it)', () => {
    expect([...PROJECT_ACTIONS]).toEqual([...PROJECT_ACTIONS].sort())
    expect(Object.isFrozen(PROJECT_ACTIONS)).toBe(true)
  })

  it('PROJECT_ROLES is the frozen manager/reviewer/member triple', () => {
    expect([...PROJECT_ROLES]).toEqual(['manager', 'reviewer', 'member'])
    expect(Object.isFrozen(PROJECT_ROLES)).toBe(true)
  })

  // The full matrix, both directions: allowed combinations return true,
  // every other combination returns false.
  for (const [appRole, projectRole, isStaffed, ...grants] of EXPECTED) {
    ACTION_COLUMNS.forEach((action, i) => {
      const allowed = grants[i]
      it(`canOnProject({ ${appRole}, seat=${projectRole}, staffed=${isStaffed} }, '${action}') === ${allowed}`, () => {
        expect(canOnProject({ appRole, projectRole, isStaffed }, action)).toBe(allowed)
      })
    })
  }
})

describe('canOnProject() edge cases', () => {
  it('returns false for unknown actions (warn-and-deny, never throw)', () => {
    expect(canOnProject({ appRole: 'admin' }, 'not.a.real.action')).toBe(false)
  })
  it('returns false for missing action', () => {
    expect(canOnProject({ appRole: 'admin' }, undefined)).toBe(false)
    expect(canOnProject({ appRole: 'admin' }, '')).toBe(false)
  })
  it('null/missing ctx behaves like an unseated app user on an unstaffed project', () => {
    expect(canOnProject(null, 'project.entity.write')).toBe(true)
    expect(canOnProject(undefined, 'project.comment.write')).toBe(true)
    expect(canOnProject({}, 'project.roster.manage')).toBe(false)
  })
  it('explicit null fields on a staffed project mean no seat, no access', () => {
    const ctx = { appRole: null, projectRole: null, isStaffed: true }
    expect(canOnProject(ctx, 'project.comment.write')).toBe(false)
    expect(canOnProject(ctx, 'project.entity.write')).toBe(false)
    expect(canOnProject(ctx, 'project.roster.manage')).toBe(false)
  })
  it('unknown app roles and unknown seats get no bypass', () => {
    expect(canOnProject({ appRole: 'platform_operator', projectRole: null, isStaffed: true }, 'project.entity.write')).toBe(false)
    expect(canOnProject({ appRole: 'user', projectRole: 'MANAGER', isStaffed: true }, 'project.entity.write')).toBe(false)
  })

  // ── Session 23: ready === false means "not yet known", never "denied" ──
  // usePermissions leaves `role` null until its getSession() settles, and
  // consumers ignored the `ready` flag — so a session read in flight looked
  // identical to a real denial and the create controls vanished. If the read
  // never settles (the auth-js global lock defect) they vanish forever, for a
  // fully authorised admin. These pin the fix; the previous test above is the
  // deliberate contrast — same ctx, ready omitted, still denied.
  describe('ready flag', () => {
    const pending = { appRole: null, projectRole: null, isStaffed: true, ready: false }

    it('a pending session is not a denial, for every action', () => {
      expect(canOnProject(pending, 'project.entity.write')).toBe(true)
      expect(canOnProject(pending, 'project.comment.write')).toBe(true)
      expect(canOnProject(pending, 'project.roster.manage')).toBe(true)
      expect(canOnProject(pending, 'project.settings.open')).toBe(true)
    })

    it('still rejects an unknown action while pending — ready is not a master key', () => {
      expect(canOnProject(pending, 'project.nonsense')).toBe(false)
      expect(canOnProject(pending, undefined)).toBe(false)
    })

    it('ready:true is exactly the old behaviour', () => {
      const ctx = { appRole: null, projectRole: null, isStaffed: true, ready: true }
      expect(canOnProject(ctx, 'project.entity.write')).toBe(false)
      expect(canOnProject({ ...ctx, projectRole: 'member' }, 'project.entity.write')).toBe(true)
    })

    it('defaults to ready when the field is absent, so old callers are unaffected', () => {
      const ctx = { appRole: null, projectRole: null, isStaffed: true }
      expect(canOnProject(ctx, 'project.entity.write')).toBe(false)
    })

    it('once resolved, a real denial still denies — pending must not be sticky', () => {
      expect(canOnProject({ ...pending, ready: true }, 'project.entity.write')).toBe(false)
    })

    // ── Session 25: the panel gate is nobody else's gate ──
    // Written as its own block because the whole risk with this action is
    // that a later reader "tidies" it into one of the existing gates. Each
    // assertion below fails if that happens.
    it('a project MEMBER is the one seat the panel excludes and entity.write admits', () => {
      const member = { appRole: 'user', projectRole: 'member', isStaffed: true }
      expect(canOnProject(member, 'project.entity.write')).toBe(true)
      expect(canOnProject(member, 'project.settings.open')).toBe(false)
    })

    it('a project REVIEWER is the inverse — panel yes, entity.write no', () => {
      const reviewer = { appRole: 'user', projectRole: 'reviewer', isStaffed: true }
      expect(canOnProject(reviewer, 'project.entity.write')).toBe(false)
      expect(canOnProject(reviewer, 'project.settings.open')).toBe(true)
    })

    it('the creator of a brand-new (unstaffed) project can still configure it', () => {
      // ProjectSummaryView:124 opens the panel right after createProject, and
      // a new project has no project_members rows yet.
      expect(canOnProject(
        { appRole: 'user', projectRole: null, isStaffed: false }, 'project.settings.open',
      )).toBe(true)
    })

    it("audrey's real staging shape is permitted either way, ready or not", () => {
      // workspace admin AND project manager on a staffed project (measured
      // 2026-08-03). Two independent routes to true — which is why the gate
      // was NOT the cause of her vanished button.
      const audrey = { appRole: 'admin', projectRole: 'manager', isStaffed: true }
      expect(canOnProject({ ...audrey, ready: true }, 'project.entity.write')).toBe(true)
      expect(canOnProject({ ...audrey, ready: false }, 'project.entity.write')).toBe(true)
    })
  })
})


// ── Session 28: task templates ──────────────────────────────────────────────
//
// Audrey, 2026-08-04, asked directly because it is not derivable from the code
// (Local Server has no roles at all): "admins and managers globally, project
// managers for their own pinned templates."
//
// This is the client mirror of can_write_task_template(uuid) (0044). The
// EXPECTED table above deliberately does NOT cover it — like canSeeProjectMoney
// it is not a PROJECT_ACTIONS entry, because a template is workspace-level with
// an optional project pin and has no "is the project staffed" question to ask.
describe('canWriteTaskTemplate', () => {
  it('is not a project action — a template is workspace-level', () => {
    // If someone later "tidies" this into canOnProject, this fails first.
    expect(PROJECT_ACTIONS).not.toContain('project.template.write')
  })

  it('a workspace admin writes anything', () => {
    expect(canWriteTaskTemplate({ appRole: 'admin', projectRole: null })).toBe(true)
    expect(canWriteTaskTemplate({ appRole: 'admin', projectRole: 'member' })).toBe(true)
  })

  // 🚨 THE ONE PLACE THIS DIFFERS FROM THE MONEY RULE, and it is the whole
  // reason the two functions cannot be merged. Audrey excluded workspace
  // managers from money; she included them here. Templates are workspace
  // configuration, wages are not.
  it('a workspace MANAGER writes templates but still cannot see money', () => {
    const wsManager = { appRole: 'manager', projectRole: 'member' }
    expect(canWriteTaskTemplate(wsManager)).toBe(true)
    expect(canSeeProjectMoney(wsManager)).toBe(false)
  })

  it('a project manager writes a template pinned to THEIR project', () => {
    expect(canWriteTaskTemplate({ appRole: 'user', projectRole: 'manager' })).toBe(true)
  })

  it('a project member and a reviewer write nothing', () => {
    expect(canWriteTaskTemplate({ appRole: 'user', projectRole: 'member' })).toBe(false)
    expect(canWriteTaskTemplate({ appRole: 'user', projectRole: 'reviewer' })).toBe(false)
  })

  it('fails CLOSED on a null/absent context, unlike canOnProject', () => {
    // canOnProject returns TRUE while permissions load, deliberately. This has
    // no `ready` opening: the caller passes null projectRole for a GLOBAL
    // template as a matter of course, so "unknown" and "global" are the same
    // input here and cannot be told apart. Failing open would show every
    // member the write controls on every global template.
    expect(canWriteTaskTemplate(null)).toBe(false)
    expect(canWriteTaskTemplate({})).toBe(false)
    expect(canWriteTaskTemplate({ appRole: null, projectRole: null })).toBe(false)
  })

  it('a GLOBAL template admits nobody below workspace manager', () => {
    // projectRole is null for a global template by construction, so the
    // project-manager leg cannot fire. Mirrors project_role_for(NULL) IS NULL
    // in 0044, which is why that predicate needs its COALESCE.
    for (const seat of [...PROJECT_ROLES, null]) {
      expect(canWriteTaskTemplate({ appRole: 'user', projectRole: null, seat })).toBe(false)
    }
  })
})
