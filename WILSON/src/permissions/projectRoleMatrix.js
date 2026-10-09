// =============================================================================
// projectRoleMatrix — single source of truth for PROJECT-level role
// capabilities. This is the separate matrix roleMatrix.js reserves for
// project-scoped roles (Manager / Reviewer / Member on a specific project).
//
// Kept in lockstep with the DB helpers in
// supabase/migrations/0013_project_members.sql — can_write_project(),
// can_comment_project() and can_manage_project_roster(), built on
// project_role_for() / project_is_staffed() — and, since post-overhaul S3a,
// with supabase/migrations/0084_shot_lists_and_edits.sql:
//   project.shotlist.write    ↔ can_edit_shot_lists() (the shot_lists,
//                               shot_list_items and edits write policies)
//   project.shotlist.activate ↔ the seat check inside set_active_shot_list(),
//                               archive_shot_list() and archive_edit():
//                               current_app_role() = 'admin'
//                               OR project_role_for() = 'manager'
//   0086 (2026-09-30) adds a MAKER path to archive_shot_list() and
//   archive_edit(): the row's maker, while project.shotlist.write still
//   holds for them, may withdraw it (archive it) while it is untouched, and
//   restore what they withdrew while it is not Saved. That is a rule about ONE ROW, so it is
//   deliberately NOT an action here: shotListModel's
//   shotListWithdrawRefusal / editWithdrawRefusal / withdrawnRestoreRefusal
//   mirror its row tests with the database's sentences, the provider's
//   canWithdrawShotList / canWithdrawEdit answer them, and the seat stays
//   project.shotlist.write (S3b asks both).
// Any change here must ship with the matching SQL change (and vice versa);
// the table COMMENT on project_members and the function COMMENT on
// can_edit_shot_lists point back at this file.
//
// Roles (project-level, project_members.project_role):
//   'manager'  — runs the project; edits everything and manages the roster
//   'reviewer' — reads + comments; since 0084 also writes shot lists and
//                edits (D8) — the only thing a reviewer writes
//   'member'   — edits project content
//
// Gating model (same order the DB evaluates it):
//   app admin/manager  → true for every action (workspace-wide bypass) —
//                        EXCEPT project.shotlist.activate, where an app
//                        MANAGER does not qualify (D8; see canOnProject)
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
//   ctx = { appRole, projectRole, isStaffed, ready, noRoles }
// (appRole/ready from usePermissions(); projectRole/isStaffed from the
// RABBIT provider's project bundle; noRoles true on the Local Server, which
// has no roles at all). useProjectAccess() assembles it in one place. Like
// roleMatrix.can(), these checks are presentation-only — RLS is the real
// gate.
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
  'project.bins.write',
  'project.comment.write',
  'project.entity.write',
  'project.roster.manage',
  'project.settings.open',
  'project.shotlist.activate',
  'project.shotlist.write',
])

/**
 * Session 24 — MONEY. Deliberately NOT part of PROJECT_ACTIONS / canOnProject.
 *
 * Three ways this differs from every other project permission, each of which
 * would be wrong if it went through canOnProject():
 *
 *  1. **A workspace `manager` does NOT qualify.** canOnProject bypasses every
 *     gate for `appRole` admin OR manager (all but project.shotlist.activate,
 *     which shares this seat rule but fails OPEN). Audrey's rule is admin OR
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
 * Post-overhaul S5c, step 7 — whether THIS SCREEN shows money: the Budget
 * tab (Rabbit.jsx) and the Control Panel's budget variables
 * (ProjectSummaryView.jsx), one predicate for the two.
 *
 * Audrey, F4 (2026-10-05): "open it. im just using this for testing. its only
 * me on this pc". The desktop's signed-out Local Server has no roles at all —
 * no session, no seats — so canSeeProjectMoney, which fails closed with no
 * roles, hid the Budget from the only person who uses that machine. There
 * every gate is open (the Files tab's `noRoles` already reads it so: Add as
 * Legal shows there since S4b). Everywhere else — the cloud, the dev fixtures
 * — the role gate is exactly canSeeProjectMoney. The DATABASE's gates are
 * untouched: the Local Server has none, the cloud keeps 0037's.
 * `adapterMode` is the provider's backend kind (`ctx.adapterMode`).
 */
export function canSeeMoneyHere({ adapterMode, appRole, projectRole } = {}) {
  if (adapterMode === 'local_server') return true
  return canSeeProjectMoney({ appRole, projectRole })
}

/**
 * Post-overhaul S4d — LEGAL. Who sees a Legal file: the money audience, AND
 * a workspace-level manager without a seat on the project.
 *
 * Audrey, 2026-10-08, asked who else should see Legal files besides
 * workspace admins and the project's managers: "Also workspace managers,
 * without taking a seat." And 2026-10-02: "inherently workspace manager may
 * need to access a folder to review things." Money does NOT widen (D8: only
 * project admins reach the budget): a workspace manager still reaches
 * invoices, budgets and rates only by taking the project's manager seat, so
 * this is a function of its own beside canSeeProjectMoney, never a change to
 * it — projectLegal.test.js pins that every money site still asks the money
 * gate and no Legal site asks it.
 *
 * Like money, deliberately NOT a PROJECT_ACTIONS entry: no unstaffed-project
 * opening (Legal fails CLOSED), no `ready` opening (a Legal control arrives a
 * beat late for a project manager rather than being shown to a member and
 * snatched back — the S23 pattern). It differs from money in exactly one row
 * of the (appRole × projectRole) table: `appRole === 'manager'` with any seat
 * or none. The Local Server has no roles at all; its callers open the gate
 * themselves (`noRoles`), as they do for money.
 *
 * This is the client mirror of `can_access_project_legal(uuid)` (0092):
 * can_access_project_money OR current_app_role() = 'manager', with 0037's
 * workspace hop and 0072's privacy arm — neither of which the client has in
 * hand, so a workspace manager looking at another workspace's project, or at
 * a private project they did not create, is told yes here and refused by the
 * database (RLS is the gate; this exists so the Add as Legal control and the
 * LEGAL folder's words are right for the people the database admits).
 *
 * @param {{ appRole: 'admin'|'manager'|'user'|null|undefined,
 *           projectRole: 'manager'|'reviewer'|'member'|null|undefined }} ctx
 * @returns {boolean}
 */
export function canSeeProjectLegal(ctx) {
  const { appRole, projectRole } = ctx || {}
  if (canSeeProjectMoney({ appRole, projectRole })) return true
  return appRole === 'manager'
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
 * Session 35 — WHO MAY SET A PROJECT'S STORAGE FOLDER (projects.folder_root).
 *
 * Audrey, 2026-08-05 (NETWORK_STORAGE_DESIGN.md §5a2): "admins can set
 * server/drive. managers can set folders within set drive. this stops anyone
 * from breaking it." The DRIVE half is S34's admin-only workspace_storage;
 * this is the FOLDER half: current_app_role() IN ('admin','manager') — the
 * 0012/0013 seat, enforced by fn_project_folder_root_guard (0049).
 *
 * Like canSeeProjectMoney, deliberately NOT a PROJECT_ACTIONS entry — the
 * shape is different from canOnProject in three ways:
 *
 *  1. 🚨 **It applies ONLY in cloud mode**, keyed on `workspaceId` exactly as
 *     S34's `canEditMachineRoot` gate is. The seat is a cloud/RLS concept: a
 *     `local_server` or signed-out solo desktop has no roles (`appRole` null),
 *     and the local Express route enforces containment WITHOUT any seat check.
 *     Gating on the (null) role there would grey a control that works and that
 *     nothing below refuses — the S35 review caught this as a HIGH regression.
 *     No `workspaceId` → allowed; the route is the only gate in local mode.
 *  2. **The project seat plays no part.** A project MANAGER with app role
 *     'user' does NOT qualify — where the project's folder sits inside the
 *     company drive is workspace storage layout, not project content, and the
 *     0049 guard reads only the app-role claim. (Deliberate, per the S35
 *     brief; if beta shows project managers need it, the guard and this
 *     mirror change together.)
 *  3. **There is no unstaffed opening.** An unstaffed project is exactly the
 *     case where nobody with a seat exists to notice a bad folder.
 *
 * It DOES follow canOnProject's `ready === false → true` fail-open (unlike
 * money): the control must not read as denied while the session resolves —
 * the S23 rule — and failing open is safe because every enforcement layer
 * below (the Express refusal, the 0049 guard) refuses on its own.
 *
 * @param {{ appRole: 'admin'|'manager'|'user'|null|undefined,
 *           workspaceId: string|null|undefined,
 *           ready: boolean|undefined }} ctx
 * @returns {boolean}
 */
export function canSetProjectFolder(ctx) {
  const { appRole, workspaceId, ready = true } = ctx || {}
  if (ready === false) return true
  if (!workspaceId) return true // local / solo — no roles; the route contains
  return appRole === 'admin' || appRole === 'manager'
}

/**
 * The sentence for a denied folder control — null when allowed, per the S29
 * rule that the reason lives beside the rule it explains (a reason that
 * drifts from the rule teaches the user something false).
 */
export function projectFolderDeniedReason(ctx) {
  if (canSetProjectFolder(ctx)) return null
  return 'Only a workspace admin or manager can choose where this project’s files live. The company drive itself is set by an admin in the Admin Terminal.'
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
    // The reviewer sentence names what a reviewer CAN write since 0084 (D8:
    // shot lists and edits, project.shotlist.write) — "cannot change
    // anything" became false the day reviewers could build a list, and a
    // reason that drifts from the rule teaches the user something false.
    case 'project.entity.write':
      return seated
        ? 'Reviewers can read, comment and build shot lists and edits, but cannot change scenes, shots, tasks, budgets or the project\'s other items. Ask a project manager for a member or manager seat.'
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

    // 0084 / D8 — denied only when staffed AND no seat (every seat, reviewer
    // included, writes lists and edits). One sentence serves both shapes
    // because an unrecognised seat is the only other way here.
    case 'project.shotlist.write':
      return 'Only this project\'s managers, members and reviewers can change its shot lists and edits.'

    // 0091 / B6 (Bins on the cloud) — the same gate, the same shape.
    case 'project.bins.write':
      return 'Only this project\'s managers, members and reviewers can change its bins, clips and takes.'

    // 0084 / D8 — denied to everyone but a workspace ADMIN or the project
    // MANAGER; a workspace manager is told the same, because the rule names
    // the two seats that work and theirs is not one of them.
    case 'project.shotlist.activate':
      return 'Only a project manager or a workspace admin can make a shot list active or archive one.'

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
 *           isStaffed: boolean|null|undefined,
 *           ready: boolean|undefined,
 *           noRoles: boolean|undefined }} ctx
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
  const { appRole, projectRole, isStaffed, ready = true, noRoles = false } = ctx || {}

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

  // ── Post-overhaul S3a (0084): shot lists and edits ──
  //
  // The Local Server has no roles (D8: "there both are labels"). Its
  // rabbitShotLists routes check no seat, so greying these controls there
  // would refuse something nothing below refuses — the S35 folder-control
  // regression in a new place. Scoped to the two shot-list actions ON
  // PURPOSE: the four older actions already resolve on the Local Server
  // through the unstaffed opening, and roster management is cloud-only, so
  // widening noRoles to them would change behaviour nobody asked to change.
  // 0091 (BC1): project.bins.write joins them — the signed-out desktop's bins
  // routes check no seat either (B12), and the gate is the same function.
  const isShotListAction = action === 'project.shotlist.activate' || action === 'project.shotlist.write'
    || action === 'project.bins.write'
  if (noRoles === true && isShotListAction) return true

  // 🚨 project.shotlist.activate MUST be decided BEFORE the admin/manager
  // short-circuit below. D8 (Audrey, 2026-09-29): set active and archive are
  // for a workspace ADMIN or the PROJECT manager; a workspace-level MANAGER
  // does not qualify. The three 0084 RPCs check exactly
  //   COALESCE(current_app_role() = 'admin' OR project_role_for() = 'manager', false)
  // — no app-manager leg and no unstaffed opening (the can_access_project_money
  // shape, 0037). Placed after the short-circuit, an app manager would be
  // shown a control every RPC refuses with 42501. The suite pins the
  // ('manager', no seat) row so that ordering mistake fails loudly.
  if (action === 'project.shotlist.activate') {
    return appRole === 'admin' || projectRole === 'manager'
  }

  // current_app_role() IN ('admin', 'manager') — bypasses every gate below.
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

    // can_edit_shot_lists() (0084): can_write_project plus the REVIEWER seat.
    // D8: "Managers, members AND reviewers may create and edit shot lists and
    // edits." 🚨 Never reuse this for scenes, shots, tasks or budgets — a
    // reviewer may put an existing shot in a list but may not change the shot
    // itself (its columns are shared by every list, D3); those stay on
    // project.entity.write. The unstaffed opening matches the SQL's
    // NOT project_is_staffed() leg.
    case 'project.shotlist.write':
      return !isStaffed || projectRole === 'manager' || projectRole === 'member' || projectRole === 'reviewer'
    // Bins on the cloud (0091, BC1): Audrey's B6, "reviewers may do everything
    // members may" in bins — add and remove bins and clips, log, flag, assign
    // takes. The database's gate for all four bins tables IS
    // can_edit_shot_lists() (no bins gate was invented), so this mirrors
    // project.shotlist.write exactly. BC3 gates the browser's Bins controls
    // on it; the signed-out Local Server has no roles (noRoles opens it).
    case 'project.bins.write':
      return !isStaffed || projectRole === 'manager' || projectRole === 'member' || projectRole === 'reviewer'
    default:
      return false
  }
}
