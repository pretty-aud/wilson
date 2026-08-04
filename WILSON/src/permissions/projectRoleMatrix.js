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
])

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
    default:
      return false
  }
}
