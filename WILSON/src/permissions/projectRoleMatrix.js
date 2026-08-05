// =============================================================================
// projectRoleMatrix — single source of truth for PROJECT-level role
// capabilities. This is the separate matrix roleMatrix.js reserves for
// project-scoped roles (Manager / Reviewer / Member on a specific project).
//
// Kept in lockstep with the DB helpers in
// supabase/migrations/0013_project_members.sql — can_write_project(),
// can_comment_project() and can_manage_project_roster(), built on
// project_role_for() / project_is_staffed(). Any change here must ship with
// the matching SQL change (and vice versa); the table COMMENT on
// project_members points back at this file.
//
// Roles (project-level, project_members.project_role):
//   'manager'  — runs the project; edits everything and manages the roster
//   'reviewer' — reads + comments only
//   'member'   — edits project content
//
// Gating model (same order the DB evaluates it):
//   app admin/manager  → true for every action (workspace-wide bypass)
//   UNSTAFFED project  → entity + comment writes open to every active
//                        member. Every pre-Session-6 project is unstaffed,
//                        so local/legacy flows are unaffected until a
//                        roster row exists.
//   staffed            → per-seat, see canOnProject() below
//   roster management  → app admin/manager or project manager ONLY — no
//                        unstaffed opening; the first seat is placed by an
//                        app admin/manager.
//
// Consumers call canOnProject(ctx, action) with
//   ctx = { appRole, projectRole, isStaffed }
// (appRole from usePermissions().role; projectRole/isStaffed from the
// RABBIT provider's project bundle). Like roleMatrix.can(), these checks
// are presentation-only — RLS is the real gate.
//
// Adding a new action: add a key to PROJECT_ACTIONS below (keep it
// alphabetised), handle it in canOnProject(), and mirror it in the
// EXPECTED table in projectRoleMatrix.test.js — the suite fails on any
// mismatch, including forgotten table columns.
// =============================================================================

export const PROJECT_ROLES = Object.freeze(['manager', 'reviewer', 'member'])

// Every project-scoped action recognised by the permission system.
// Unrecognised actions passed to canOnProject() warn at development time
// (dev-build) and return false in production. Keep this list alphabetised.
export const PROJECT_ACTIONS = Object.freeze([
  'project.comment.write',
  'project.entity.write',
  'project.roster.manage',
  'project.settings.open',
])

/**
 * Session 24 — MONEY. Deliberately NOT part of PROJECT_ACTIONS / canOnProject.
 *
 * Three ways this differs from every other project permission, each of which
 * would be wrong if it went through canOnProject():
 *
 *  1. **A workspace `manager` does NOT qualify.** canOnProject bypasses every
 *     gate for `appRole` admin OR manager (`:95`). Audrey's rule is admin OR
 *     *project* manager — on staging `derek` is a workspace manager holding
 *     only a project `member` seat, and he must not see money.
 *  2. **There is no unstaffed-project opening.** canOnProject returns true for
 *     everyone when `isStaffed` is false. Money fails CLOSED.
 *  3. **It fails CLOSED while permissions are still loading**, where
 *     canOnProject deliberately fails open (`ready === false` returns true).
 *
 * On (3) — the direction is the whole point. `appRole` is decoded from the JWT
 * with no network call, so a workspace admin resolves instantly and never sees
 * a flicker. A project manager's seat arrives with the project roster a beat
 * later, so their Budget tab APPEARS shortly after load. The opposite choice
 * would show the tab to a reviewer and then snatch it away, which is the exact
 * "control silently vanishes with no explanation" pattern that cost S23 hours.
 * A tab that arrives late is a small annoyance; one that vanishes is a bug
 * report.
 *
 * This is the client mirror of `can_access_project_money(uuid)` (0037). The
 * DATABASE is the authority — a reviewer reads zero rows from every money
 * table whatever React does. This function exists so they are not shown an
 * empty page they cannot be told the reason for.
 *
 * @param {{ appRole: 'admin'|'manager'|'user'|null|undefined,
 *           projectRole: 'manager'|'reviewer'|'member'|null|undefined }} ctx
 * @returns {boolean}
 */
export function canSeeProjectMoney(ctx) {
  const { appRole, projectRole } = ctx || {}
  if (appRole === 'admin') return true
  return projectRole === 'manager'
}

/**
 * Session 28 — TASK TEMPLATES. Like canSeeProjectMoney, deliberately NOT a
 * PROJECT_ACTIONS entry: a template is workspace-level with an optional
 * project pin, so canOnProject's (appRole, projectRole, isStaffed) shape does
 * not describe it. Two ways it differs:
 *
 *  1. **There is no unstaffed opening.** canOnProject returns true for
 *     everyone when isStaffed is false. A GLOBAL template has no project at
 *     all, so "is the project staffed" is not even a question that can be
 *     asked about it.
 *  2. **A workspace `manager` DOES qualify** — unlike money, where Audrey
 *     excluded them. Templates are workspace configuration; wages are not.
 *
 * Audrey, 2026-08-04, asked directly because the local server has no roles and
 * its open routes say nothing about intent: "admins and managers globally,
 * project managers for their own pinned templates."
 *
 * This is the client mirror of `can_write_task_template(uuid)` (0044). The
 * DATABASE is the authority. This exists so a member is TOLD why they cannot
 * edit, instead of watching a row appear and vanish — TaskTemplateManager
 * never rendered its hook's `error`, so an RLS refusal reached the screen as
 * nothing at all.
 *
 * ⚠️ KNOWN, DELIBERATE MISMATCH, and it fails CLOSED. `projectRole` must be
 * the caller's seat on THIS template's project, and the only per-project role
 * the app has in hand is `ctx.myProjectRole` for the project currently open.
 * So a project manager looking at a template pinned to a DIFFERENT project
 * sees it read-only here, while the database would let them edit it. Building
 * the alternative needs a roster query per project from a Settings screen that
 * has no project context; the honest cheap behaviour is to hide the control
 * and let them edit it with that project open. Recorded rather than glossed.
 *
 * @param {{ appRole: 'admin'|'manager'|'user'|null|undefined,
 *           projectRole: 'manager'|'reviewer'|'member'|null|undefined }} ctx
 * @returns {boolean}
 */
export function canWriteTaskTemplate(ctx) {
  const { appRole, projectRole } = ctx || {}
  if (appRole === 'admin' || appRole === 'manager') return true
  return projectRole === 'manager'
}

/**
 * Session 29 — the sentence shown to a user who is DENIED a project action.
 *
 * Returns null when the action is allowed (there is nothing to explain), and
 * a short sentence naming the ACTUAL RULE when it is not.
 *
 * 🚨 It lives here, beside canOnProject, on purpose. Audrey's decision
 * (2026-08-04) is that a denied control stays visible, greyed, and says why —
 * "keep button gray and explain why". That makes the explanation part of the
 * permission contract rather than UI copy: a reason that drifts from the rule
 * is worse than no reason, because it teaches the user something false. The
 * suite pairs the two 1:1 — a reason must be non-null exactly when
 * canOnProject is false, for every combination in the EXPECTED table.
 *
 * The text names the seat that WOULD work, not "permission denied". The whole
 * point of showing it is that the user learns what to ask for.
 *
 * Note it inherits canOnProject's fail-OPEN behaviour while permissions load
 * (`ready === false` → allowed → null reason). That is load-bearing: a control
 * must never be greyed merely because the session has not settled, or "loading"
 * becomes indistinguishable from "denied" — the S23 bug in a new costume.
 *
 * @param {{ appRole, projectRole, isStaffed, ready }} ctx — as canOnProject
 * @param {string} action
 * @returns {string|null}
 */
export function projectActionDeniedReason(ctx, action) {
  if (canOnProject(ctx, action)) return null

  const { projectRole } = ctx || {}
  const seated = projectRole != null

  switch (action) {
    // Denied only when staffed AND (reviewer | no seat).
    case 'project.entity.write':
      return seated
        ? 'Reviewers can read and comment, but not change anything. Ask a project manager for a member or manager seat.'
        : 'You have no seat on this project. Only its managers and members can add or change items — ask a project manager to add you.'

    // Denied only when staffed AND no seat (any seat may comment).
    case 'project.comment.write':
      return 'You have no seat on this project, so you cannot comment. Ask a project manager to add you.'

    // Denied for every seat except manager, and there is no unstaffed opening.
    case 'project.roster.manage':
      return 'Only a project manager can change who works on this project.'

    // Denied only when staffed AND (member | no seat) — the one action where
    // a reviewer outranks a member.
    case 'project.settings.open':
      return seated
        ? 'The project control panel is open to project managers and reviewers. Your seat here is member.'
        : 'You have no seat on this project. Only its managers and reviewers can open the control panel.'

    default:
      // Unknown action — canOnProject already warned in dev and returned false.
      return 'You do not have permission to do that on this project.'
  }
}

/**
 * Returns true if the caller may perform the given project-scoped action.
 * Returns false for unknown actions. Missing/null ctx fields are safe and
 * behave like an unseated app user on an unstaffed project.
 *
 * @param {{ appRole: 'admin'|'manager'|'user'|null|undefined,
 *           projectRole: 'manager'|'reviewer'|'member'|null|undefined,
 *           isStaffed: boolean|null|undefined }} ctx
 * @param {string} action
 * @returns {boolean}
 */
export function canOnProject(ctx, action) {
  if (!PROJECT_ACTIONS.includes(action)) {
    if (import.meta.env?.DEV && action) {
      console.warn(`[permissions] unknown project action "${action}". Add it to PROJECT_ACTIONS in projectRoleMatrix.js.`)
    }
    return false
  }
  const { appRole, projectRole, isStaffed, ready = true } = ctx || {}

  // Session 23: "still loading" must never masquerade as "denied".
  //
  // usePermissions exposes a `ready` flag for exactly this, and roughly a
  // dozen consumers — including both R.A.B.B.I.T. views — ignored it. Until
  // its getSession() settles, `appRole` is null, so every branch below fails
  // closed and a control gated on the result DISAPPEARS. That is the wrong
  // failure: it is indistinguishable from a real denial, it gives the user no
  // way to tell which it is, and if the session read never settles at all —
  // the known auth-js lock defect, where an abandoned getSession() holds the
  // global per-storageKey lock — the control is gone permanently for someone
  // who is fully authorised.
  //
  // So an unknown answer resolves to "not yet denied" rather than "denied".
  // This is not a security decision: the database is the authority, and the
  // same rule is enforced there by can_write_project() / project_role_for()
  // inside the RLS policies (0013). The worst case here is that someone sees
  // a control for a moment and gets a real, visible error if they use it —
  // strictly better than an admin silently losing the primary action.
  //
  // Callers that do NOT pass `ready` are unaffected: it defaults to true.
  if (ready === false) return true

  // current_app_role() IN ('admin', 'manager') — bypasses every gate.
  if (appRole === 'admin' || appRole === 'manager') return true
  switch (action) {
    // can_write_project(): unstaffed is open; staffed needs manager/member.
    case 'project.entity.write':
      return !isStaffed || projectRole === 'manager' || projectRole === 'member'
    // can_comment_project(): unstaffed is open; staffed needs any seat —
    // reviewers comment too, which is the point of the separate gate.
    case 'project.comment.write':
      return !isStaffed || projectRole != null
    // can_manage_project_roster(): project manager only. Deliberately NO
    // unstaffed opening — initial staffing is app admin/manager only.
    case 'project.roster.manage':
      return projectRole === 'manager'

    // Session 25 — the Project Control Panel (ProjectSummaryView's settings
    // screen: naming, fps, the scenes/levels/experiences toggles, the engine
    // fields, the project folder, and the Budget block).
    //
    // Audrey, 2026-08-04: "managers and reviewers should be able to see and
    // press the button and open the control panel, the budget block is
    // managers only. basic team members do not need access to the panel at
    // all."
    //
    // 🚨 This is the ONLY action where a reviewer outranks a member, so it
    // cannot borrow any existing gate. `project.entity.write` is the exact
    // inverse on those two seats (a member writes, a reviewer does not), and
    // `canSeeProjectMoney` admits neither. Reusing either would have been
    // wrong in a way that looks right in review.
    //
    // The unstaffed opening is load-bearing rather than copied: a brand-new
    // project has no project_members rows, and ProjectSummaryView:124 opens
    // this very panel immediately after createProject so the user can set the
    // title and type. Without it, creating a project would lock you out of
    // configuring the thing you just made.
    //
    // The BUDGET BLOCK INSIDE the panel keeps its own stricter gate
    // (canSeeProjectMoney), so admitting reviewers here does not admit them to
    // money. That separation is the whole design: an open shell, a closed safe.
    case 'project.settings.open':
      return !isStaffed || projectRole === 'manager' || projectRole === 'reviewer'
    default:
      return false
  }
}
