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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  canOnProject, canSeeProjectMoney, canWriteTaskTemplate,
  projectActionDeniedReason,
  PROJECT_ROLES, PROJECT_ACTIONS,
} from './projectRoleMatrix'

// For the useProjectAccess block at the end (S3a): the hook's two sources are
// mocked to fixed, mutable state, the useRosterMembers.test.js way — no DOM,
// react-dom/server runs useMemo and nothing else. projectRoleMatrix.js imports
// neither module, so these mocks cannot touch the matrix tests above.
const hookState = {
  rabbit: { adapterMode: 'supabase', myProjectRole: null, projectIsStaffed: false },
  perms: { role: null, ready: true },
}
vi.mock('../tools/rabbit_v0.1.0/state/RabbitProvider', () => ({
  useRabbit: () => hookState.rabbit,
}))
vi.mock('./usePermissions', () => ({
  usePermissions: () => hookState.perms,
}))
import { useProjectAccess } from '../tools/rabbit_v0.1.0/state/useProjectAccess'

// One row per (appRole, projectRole, staffed) combination. projectRole null
// means no seat on the project. Seats on an unstaffed project are incoherent
// (a seat IS staffing, so the DB can't produce them) but the matrix must
// still answer exactly like the 0013 SQL helper expressions would.
// Columns map 1:1 onto ACTION_COLUMNS below.
// Session 25 adds the `settings` column — the Project Control Panel.
//
// 🚨 Read the `user`/staffed block below carefully: `settings` is the action
// where a REVIEWER is allowed and a MEMBER is not. `entity` is the exact
// inverse on those two seats. Audrey, 2026-08-04: "managers and reviewers
// should be able to see and press the button and open the control panel …
// basic team members do not need access to the panel at all."
//
// Post-overhaul S3a (0084, Audrey's D8, 2026-09-29) adds two columns:
//   `activate` — project.shotlist.activate: set the active list, archive a
//                list or an edit. Workspace ADMIN or PROJECT MANAGER only. 🚨
//                The app-MANAGER block is the one place in this table where
//                a workspace manager is denied: every row there whose seat
//                is not 'manager' reads FALSE. And there is no unstaffed
//                opening (the last row).
//   `write`    — project.shotlist.write: can_edit_shot_lists(). `entity`
//                plus the REVIEWER seat — the only thing a reviewer writes.
//                Unstaffed opens it, like `entity`.
const EXPECTED = [
  //  appRole    projectRole  staffed  comment entity roster settings activate write
  // ── app admin: bypasses everything ──
  ['admin',   'manager',  true,   true,  true,  true,  true,  true,  true],
  ['admin',   'reviewer', true,   true,  true,  true,  true,  true,  true],
  ['admin',   'member',   true,   true,  true,  true,  true,  true,  true],
  ['admin',   null,       true,   true,  true,  true,  true,  true,  true],
  ['admin',   'manager',  false,  true,  true,  true,  true,  true,  true],
  ['admin',   'reviewer', false,  true,  true,  true,  true,  true,  true],
  ['admin',   'member',   false,  true,  true,  true,  true,  true,  true],
  ['admin',   null,       false,  true,  true,  true,  true,  true,  true],
  // ── app manager: bypasses everything EXCEPT activate, which needs the
  //    project manager seat (D8; 0084's RPCs have no app-manager leg) ──
  ['manager', 'manager',  true,   true,  true,  true,  true,  true,  true],
  ['manager', 'reviewer', true,   true,  true,  true,  true,  false, true],
  ['manager', 'member',   true,   true,  true,  true,  true,  false, true],
  ['manager', null,       true,   true,  true,  true,  true,  false, true],
  ['manager', 'manager',  false,  true,  true,  true,  true,  true,  true],
  ['manager', 'reviewer', false,  true,  true,  true,  true,  false, true],
  ['manager', 'member',   false,  true,  true,  true,  true,  false, true],
  ['manager', null,       false,  true,  true,  true,  true,  false, true],
  // ── app user, staffed: the seat decides ──
  // Note reviewer/member on `settings` vs `entity`: they are opposites, and
  // that is deliberate, not a transcription slip. And reviewer on `write` vs
  // `entity`: a reviewer builds lists but cannot change a scene (D3/D8).
  ['user',    'manager',  true,   true,  true,  true,  true,  true,  true],
  ['user',    'reviewer', true,   true,  false, false, true,  false, true],
  ['user',    'member',   true,   true,  true,  false, false, false, true],
  ['user',    null,       true,   false, false, false, false, false, false],
  // ── app user, unstaffed: entity + comment + settings + write open, roster
  //    and activate closed ──
  // settings opens here because a project is unstaffed the instant it is
  // created, and ProjectSummaryView:124 opens this panel immediately after
  // createProject. Closing it would lock the creator out of the project they
  // just made. activate does NOT open: the 0084 RPCs check the seat with no
  // project_is_staffed() leg, so the control would promise a 42501.
  ['user',    'manager',  false,  true,  true,  true,  true,  true,  true],
  ['user',    'reviewer', false,  true,  true,  false, true,  false, true],
  ['user',    'member',   false,  true,  true,  false, true,  false, true],
  ['user',    null,       false,  true,  true,  false, true,  false, true],
]

const ACTION_COLUMNS = [
  'project.comment.write', 'project.entity.write',
  'project.roster.manage', 'project.settings.open',
  'project.shotlist.activate', 'project.shotlist.write',
]

// The EXPECTED cell for one (appRole, projectRole, staffed) row and action —
// used by the S3a block to assert specific rows by name, not by index.
function expectedCell(appRole, projectRole, staffed, action) {
  const row = EXPECTED.find(([a, p, s]) => a === appRole && p === projectRole && s === staffed)
  if (!row) throw new Error(`no EXPECTED row for ${appRole}|${projectRole}|${staffed}`)
  return row[3 + ACTION_COLUMNS.indexOf(action)]
}

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

// ── Session 29 — the denial sentence ─────────────────────────────────────────
//
// Audrey's decision (2026-08-04) is that a denied control stays visible, greyed,
// and says why. That makes the explanation part of the permission contract, not
// UI copy: a reason that drifts from the rule teaches the user something false,
// which is worse than saying nothing.
//
// So the reason is pinned to the SAME table the matrix is pinned to, in both
// directions — non-null exactly when the action is denied, for every one of the
// 24 combinations. Adding an action to PROJECT_ACTIONS without giving it a
// reason fails here.
describe('projectActionDeniedReason() tracks canOnProject() exactly', () => {
  for (const [appRole, projectRole, isStaffed, ...grants] of EXPECTED) {
    ACTION_COLUMNS.forEach((action, i) => {
      const allowed = grants[i]
      it(`{ ${appRole}, seat=${projectRole}, staffed=${isStaffed} } '${action}' → ${allowed ? 'no reason' : 'a reason'}`, () => {
        const reason = projectActionDeniedReason({ appRole, projectRole, isStaffed }, action)
        if (allowed) {
          expect(reason).toBeNull()
        } else {
          expect(typeof reason).toBe('string')
          expect(reason.length).toBeGreaterThan(20)
        }
      })
    })
  }

  it('inherits the fail-OPEN behaviour while permissions load — grey must never mean "loading"', () => {
    // The whole point of canOnProject returning true when ready === false. If
    // the reason were non-null here, a control would grey out during the
    // session read and read as a denial — the S23 bug wearing the S29 fix.
    for (const action of PROJECT_ACTIONS) {
      const pending = { appRole: null, projectRole: null, isStaffed: true, ready: false }
      expect(projectActionDeniedReason(pending, action), action).toBeNull()
    }
  })

  it('names the rule rather than saying "permission denied"', () => {
    // A reviewer must learn what seat WOULD work — that is why the control is
    // shown at all instead of hidden.
    const reviewer = { appRole: 'user', projectRole: 'reviewer', isStaffed: true }
    const entity = projectActionDeniedReason(reviewer, 'project.entity.write')
    expect(entity).toMatch(/member|manager/i)

    // The two denial shapes for one action are distinguishable: a reviewer is
    // told about their seat, someone with no seat is told they have none.
    const unseated = { appRole: 'user', projectRole: null, isStaffed: true }
    expect(projectActionDeniedReason(unseated, 'project.entity.write'))
      .not.toBe(entity)
    expect(projectActionDeniedReason(unseated, 'project.entity.write'))
      .toMatch(/no seat/i)
  })

  it('a member is told the control panel rule, which is the inverse of the write rule', () => {
    // project.settings.open is the ONLY action where a reviewer outranks a
    // member, so its reason must not be copied from the entity-write one.
    const member = { appRole: 'user', projectRole: 'member', isStaffed: true }
    expect(projectActionDeniedReason(member, 'project.entity.write')).toBeNull()
    expect(projectActionDeniedReason(member, 'project.settings.open')).toMatch(/reviewer/i)
  })

  it('returns a reason for an unknown action rather than throwing or returning null', () => {
    expect(projectActionDeniedReason({ appRole: 'admin' }, 'not.a.real.action'))
      .toEqual(expect.any(String))
  })
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
      expect(canOnProject(pending, 'project.shotlist.activate')).toBe(true)
      expect(canOnProject(pending, 'project.shotlist.write')).toBe(true)
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


// ── Post-overhaul S3a (0084): shot lists and edits ──────────────────────────
//
// Audrey's D8 (2026-09-29): managers, members AND reviewers write lists, their
// membership and edits (can_edit_shot_lists); SET ACTIVE and ARCHIVE are for a
// workspace admin or the PROJECT manager only (the seat check inside
// set_active_shot_list / archive_shot_list / archive_edit). The Local Server
// has no roles, so there both are labels. The EXPECTED table above already
// checks every cell; these name the rows that a plausible edit gets wrong.
const ACTIVATE = 'project.shotlist.activate'
const SL_WRITE = 'project.shotlist.write'
const ACTIVATE_REASON = 'Only a project manager or a workspace admin can make a shot list active or archive one.'
const SL_WRITE_REASON = 'Only this project\'s managers, members and reviewers can change its shot lists and edits.'
const REVIEWER_ENTITY_REASON = 'Reviewers can read, comment and build shot lists and edits, but cannot change scenes, shots, tasks, budgets or the project\'s other items. Ask a project manager for a member or manager seat.'
const OLDER_ACTIONS = PROJECT_ACTIONS.filter(a => a !== ACTIVATE && a !== SL_WRITE)

describe('project.shotlist.* (0084, D8)', () => {
  // 🚨 The row the admin/manager short-circuit gets wrong. If the activate
  // check is moved below `if (appRole === 'admin' || appRole === 'manager')
  // return true` in canOnProject, the canOnProject assertions here go red —
  // and the expectedCell() line stops anyone "fixing" that by flipping the
  // table cell to true. (Verified 2026-09-30 by making exactly that move:
  // 15 tests went red, this one included.)
  it('a workspace MANAGER with no project seat cannot activate or archive', () => {
    expect(expectedCell('manager', null, true, ACTIVATE)).toBe(false)
    expect(expectedCell('manager', null, false, ACTIVATE)).toBe(false)
    const wsManager = { appRole: 'manager', projectRole: null, isStaffed: true }
    expect(canOnProject(wsManager, ACTIVATE)).toBe(false)
    expect(canOnProject({ ...wsManager, isStaffed: false }, ACTIVATE)).toBe(false)
    expect(projectActionDeniedReason(wsManager, ACTIVATE)).toBe(ACTIVATE_REASON)
    // …while the same person still writes lists and keeps every older bypass:
    // the exception is exactly one action wide.
    expect(canOnProject(wsManager, SL_WRITE)).toBe(true)
    for (const a of OLDER_ACTIONS) expect(canOnProject(wsManager, a), a).toBe(true)
  })

  it('a workspace manager holding a member or reviewer seat still cannot activate', () => {
    // derek on staging: workspace manager with a project member seat (the
    // projectMoney.test.js shape). The seat, not the app role, decides.
    for (const seat of ['member', 'reviewer']) {
      expect(canOnProject({ appRole: 'manager', projectRole: seat, isStaffed: true }, ACTIVATE), seat).toBe(false)
    }
  })

  it('the project MANAGER seat activates whatever the app role; a workspace admin activates with no seat', () => {
    for (const appRole of ['admin', 'manager', 'user', null]) {
      expect(canOnProject({ appRole, projectRole: 'manager', isStaffed: true }, ACTIVATE), String(appRole)).toBe(true)
    }
    expect(canOnProject({ appRole: 'admin', projectRole: null, isStaffed: true }, ACTIVATE)).toBe(true)
    expect(canOnProject({ appRole: 'admin', projectRole: null, isStaffed: false }, ACTIVATE)).toBe(true)
  })

  it('once resolved, activate is exactly the money seat rule (0084 copies can_access_project_money)', () => {
    // Same two legs, no app-manager leg, no unstaffed opening. The two differ
    // ONLY while loading (activate fails open) and on the Local Server — both
    // excluded here by construction (ready and noRoles are absent).
    for (const [appRole, projectRole, isStaffed] of EXPECTED) {
      expect(canOnProject({ appRole, projectRole, isStaffed }, ACTIVATE), `${appRole}|${projectRole}|${isStaffed}`)
        .toBe(canSeeProjectMoney({ appRole, projectRole }))
    }
  })

  it('an unstaffed project opens write but NOT activate', () => {
    const creator = { appRole: 'user', projectRole: null, isStaffed: false }
    expect(expectedCell('user', null, false, SL_WRITE)).toBe(true)
    expect(expectedCell('user', null, false, ACTIVATE)).toBe(false)
    expect(canOnProject(creator, SL_WRITE)).toBe(true)
    expect(canOnProject(creator, ACTIVATE)).toBe(false)
  })

  it('a REVIEWER writes lists and edits but still cannot change a scene (D3/D8)', () => {
    // can_edit_shot_lists is can_write_project plus the reviewer seat — and
    // must never be reused for scenes, shots, tasks or budgets.
    const reviewer = { appRole: 'user', projectRole: 'reviewer', isStaffed: true }
    expect(canOnProject(reviewer, SL_WRITE)).toBe(true)
    expect(canOnProject(reviewer, 'project.entity.write')).toBe(false)
    expect(canOnProject(reviewer, ACTIVATE)).toBe(false)
  })

  it('the reviewer\'s entity-write denial tells the truth after D8 (review R1, scope#6)', () => {
    // Before 0084 a reviewer was told they could "not change anything". Since
    // D8 they build shot lists and edits, so that sentence became false —
    // the drift the S29 rule exists to stop. The sentence must name what a
    // reviewer CAN write and what stays closed, and still name the seat that
    // would open the rest.
    const reviewer = { appRole: 'user', projectRole: 'reviewer', isStaffed: true }
    const reason = projectActionDeniedReason(reviewer, 'project.entity.write')
    expect(reason).toBe(REVIEWER_ENTITY_REASON)
    expect(reason).not.toMatch(/not change anything/i)
    expect(reason).toMatch(/shot lists and edits/)
    for (const closed of ['scenes', 'shots', 'tasks', 'budgets']) {
      expect(reason, closed).toMatch(new RegExp(`\\b${closed}\\b`))
    }
    expect(reason).toMatch(/member or manager seat/)
    // …and the two claims it makes are the matrix's own answers.
    expect(canOnProject(reviewer, SL_WRITE)).toBe(true)
    expect(canOnProject(reviewer, 'project.entity.write')).toBe(false)
    // The unseated sentence is untouched: no seat still reads as no seat.
    const unseated = { appRole: 'user', projectRole: null, isStaffed: true }
    expect(projectActionDeniedReason(unseated, 'project.entity.write')).toMatch(/no seat/i)
  })

  it('write is denied only to someone with no (recognised) seat on a staffed project', () => {
    expect(canOnProject({ appRole: 'user', projectRole: null, isStaffed: true }, SL_WRITE)).toBe(false)
    expect(canOnProject({ appRole: null, projectRole: null, isStaffed: true }, SL_WRITE)).toBe(false)
    expect(canOnProject({ appRole: 'user', projectRole: 'MANAGER', isStaffed: true }, SL_WRITE)).toBe(false)
    expect(canOnProject({ appRole: 'platform_operator', projectRole: null, isStaffed: true }, SL_WRITE)).toBe(false)
  })

  describe('noRoles — the Local Server (D8: "there both are labels")', () => {
    // A context with no role at all. isStaffed is tried both ways: false is the
    // real Local Server shape (the roster is cloud-only), true makes sure it
    // is noRoles — not the unstaffed opening — that answers.
    for (const isStaffed of [false, true]) {
      const local = { appRole: null, projectRole: null, isStaffed, ready: true, noRoles: true }

      it(`opens both shot-list actions with no role at all (staffed=${isStaffed})`, () => {
        expect(canOnProject(local, ACTIVATE)).toBe(true)
        expect(canOnProject(local, SL_WRITE)).toBe(true)
        expect(projectActionDeniedReason(local, ACTIVATE)).toBeNull()
        expect(projectActionDeniedReason(local, SL_WRITE)).toBeNull()
      })

      it(`control: the same context WITHOUT noRoles is denied activate (staffed=${isStaffed})`, () => {
        // Proves the previous test is not passing through some other leg.
        const cloud = { ...local, noRoles: false }
        expect(canOnProject(cloud, ACTIVATE)).toBe(false)
        expect(canOnProject(cloud, SL_WRITE)).toBe(!isStaffed)
        const absent = { appRole: null, projectRole: null, isStaffed, ready: true }
        expect(canOnProject(absent, ACTIVATE)).toBe(false)
      })

      it(`is scoped to the shot-list pair — every older action answers as before (staffed=${isStaffed})`, () => {
        for (const a of OLDER_ACTIONS) {
          expect(canOnProject(local, a), a).toBe(canOnProject({ ...local, noRoles: false }, a))
        }
        // The one that matters: roster management stays closed on the Local
        // Server, where there is no roster to manage.
        expect(canOnProject(local, 'project.roster.manage')).toBe(false)
      })
    }

    it('opens activate for a workspace manager with no seat too — nothing on the Local Server checks a seat', () => {
      expect(canOnProject({ appRole: 'manager', projectRole: null, isStaffed: true, noRoles: true }, ACTIVATE)).toBe(true)
    })

    it('is not a master key: an unknown action is still refused', () => {
      expect(canOnProject({ noRoles: true }, 'project.nonsense')).toBe(false)
    })
  })

  it('ready:false opens both (loading is not denied) and gives no reason', () => {
    const pending = { appRole: null, projectRole: null, isStaffed: true, ready: false }
    for (const a of [ACTIVATE, SL_WRITE]) {
      expect(canOnProject(pending, a), a).toBe(true)
      expect(projectActionDeniedReason(pending, a), a).toBeNull()
    }
    // …including for the workspace manager, whom a RESOLVED activate refuses:
    // the ready check sits above the activate check, like every action's.
    expect(canOnProject({ appRole: 'manager', projectRole: null, isStaffed: true, ready: false }, ACTIVATE)).toBe(true)
  })

  it('the denial sentences are the exact S3a texts, non-null exactly when denied', () => {
    for (const [appRole, projectRole, isStaffed] of EXPECTED) {
      const ctx = { appRole, projectRole, isStaffed }
      expect(projectActionDeniedReason(ctx, ACTIVATE))
        .toBe(canOnProject(ctx, ACTIVATE) ? null : ACTIVATE_REASON)
      expect(projectActionDeniedReason(ctx, SL_WRITE))
        .toBe(canOnProject(ctx, SL_WRITE) ? null : SL_WRITE_REASON)
    }
    // And each one names the seats that WOULD work (the S29 rule).
    expect(ACTIVATE_REASON).toMatch(/project manager/)
    expect(ACTIVATE_REASON).toMatch(/workspace admin/)
    expect(SL_WRITE_REASON).toMatch(/reviewers/)
  })
})

// ── useProjectAccess puts noRoles in the gate context (S3a) ─────────────────
//
// The flag is only as good as the one place that sets it. Without it a
// signed-out Local Server user (role null, no roster) would see Set active and
// Archive greyed for a rule nothing on that backend enforces — the S35
// folder-control regression again. Driven through react-dom/server with both
// source hooks mocked (top of file).
describe('useProjectAccess — the gate context', () => {
  function renderAccess() {
    let captured = null
    function Probe() {
      captured = useProjectAccess()
      return createElement('pre', null, JSON.stringify(captured.gateCtx))
    }
    const html = renderToString(createElement(Probe))
    expect(html).toContain('<pre>')
    return captured
  }

  beforeEach(() => {
    hookState.rabbit = { adapterMode: 'supabase', myProjectRole: null, projectIsStaffed: false }
    hookState.perms = { role: null, ready: true }
  })

  it('on the Local Server: noRoles is true, and both shot-list actions are open with no role', () => {
    hookState.rabbit = { adapterMode: 'local_server', myProjectRole: null, projectIsStaffed: false }
    const access = renderAccess()
    expect(access.gateCtx.noRoles).toBe(true)
    expect(access.can(ACTIVATE)).toBe(true)
    expect(access.can(SL_WRITE)).toBe(true)
    expect(access.reasonFor(ACTIVATE)).toBeNull()
    // Nothing else moved: the Local Server still cannot manage a roster.
    expect(access.can('project.roster.manage')).toBe(false)
  })

  it('in the cloud: noRoles is false, so a project member is refused activate with the reason', () => {
    hookState.rabbit = { adapterMode: 'supabase', myProjectRole: 'member', projectIsStaffed: true }
    hookState.perms = { role: 'user', ready: true }
    const access = renderAccess()
    expect(access.gateCtx.noRoles).toBe(false)
    expect(access.can(ACTIVATE)).toBe(false)
    expect(access.reasonFor(ACTIVATE)).toBe(ACTIVATE_REASON)
    expect(access.can(SL_WRITE)).toBe(true)
    expect(access.canWrite).toBe(true)
  })

  it('keeps `ready` in the context (writeGate.test.js requires it) and still fails open while loading', () => {
    hookState.rabbit = { adapterMode: 'supabase', myProjectRole: null, projectIsStaffed: true }
    hookState.perms = { role: null, ready: false }
    const access = renderAccess()
    expect(access.gateCtx.ready).toBe(false)
    expect(access.can(ACTIVATE)).toBe(true)
    expect(access.canWrite).toBe(true)
  })

  it('a missing adapterMode (no provider value yet) is not the Local Server', () => {
    hookState.rabbit = null
    hookState.perms = { role: 'user', ready: true }
    const access = renderAccess()
    expect(access.gateCtx.noRoles).toBe(false)
    expect(access.can(ACTIVATE)).toBe(false)
  })
})
