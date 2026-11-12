-- =========================================================================
-- 0044_task_templates.sql — Session 28.
--
-- Task templates in cloud: the oldest open item on OUTSTANDING.md, deferred
-- by S25 and S26 (both ran out of room) and by S27 (Audrey's explicit choice
-- to finish the file layer first).
--
-- Idempotent: safe to re-run.
-- ORDERING: depends on 0004 (touch_updated_at), 0008 (current_app_role),
--           0013 (project_role_for), 0020 (has_active_membership as it now
--           stands). Nothing depends on this one yet.
--
--
-- 🚨 WHAT WAS MEASURED BEFORE ANY OF THIS WAS WRITTEN (2026-08-04)
-- -----------------------------------------------------------------
-- The feature has never produced a row on ANY backend. Not "it is broken in
-- cloud" — %APPDATA%\wilson\rabbit-data\task-templates\ and its WILSON\ twin
-- both EXIST and are both EMPTY, so zero templates exist on Local Server
-- either, where the feature has worked the whole time.
--
-- That is the S27 lesson applied before the fact rather than after it: a
-- feature with no caller has no symptom, and a table with no writer is not
-- evidence of anything. Creating this table will make every test pass and
-- change nothing on screen. The session is not finished until a template has
-- been created and applied through the UI.
--
--
-- 🚨 WHY `tasks` IS JSONB AND NOT A CHILD TABLE — decided here, deliberately,
--    because the next session will otherwise assume the opposite
-- ---------------------------------------------------------------------------
-- Both are defensible. A child table is the more faithful SCHEMA; JSONB is
-- the more faithful PORT. Three MEASURED facts decided it:
--
--   1. The UI's ONLY write path for template tasks is whole-array
--      replacement. TemplateEditor.saveTasks (TaskTemplateManager.jsx:261)
--      calls onUpdate({ tasks: newTasks }) for every edit there is — adding a
--      task, renaming one, changing a role, setting days, toggling a
--      dependency, deleting. There is no per-task write anywhere. A child
--      table would need diff/upsert/delete reconciliation that does not exist
--      in this codebase and would have to be invented for a feature with zero
--      rows.
--
--   2. `depends_on` is an array of SIBLING template-task ids, scoped entirely
--      inside one template. In a child table that is either a uuid[] with no
--      referential integrity (i.e. exactly what JSONB gives, with extra
--      ceremony) or a second join table — two new tables instead of one.
--
--   3. Duplicating a template remaps every id across the whole array at once
--      (handleDuplicate, :64-83). One JSONB value; a transaction otherwise.
--
-- And Local Server stores one JSON document per template
-- (electron/main.cjs:2610-2656), so JSONB keeps the two backends returning
-- the same shape without a translation layer on one side.
--
-- THE COST, stated honestly rather than glossed: template tasks are not
-- joinable or queryable in SQL, and a task's role_slug has no FK to anything.
-- Nothing needs either today — the bid reads role_slug as a plain string and
-- the role list is a hardcoded client array (TaskTemplateManager.jsx:25). If
-- a future feature needs to ask "which templates use the rigger role", that
-- is the session that promotes this to a child table.
--
--
-- 🚨 WHO MAY WRITE — Audrey, 2026-08-04, asked directly because it is NOT
--    derivable from the code
-- ---------------------------------------------------------------------------
-- The local server has no roles at all, so its wide-open routes say nothing
-- about intent, and there is no house default to fall back on: she has
-- already given DIFFERENT answers for money (project manager OR workspace
-- admin) and for the control panel (managers and reviewers, not members).
--
-- Her answer: **workspace admins and managers globally; a project manager
-- additionally for templates pinned to their own project.**
--
--   read   any active member of the workspace
--   write  current_app_role() IN ('admin','manager')
--          OR project_role_for(<the template's project_id>) = 'manager'
--
-- The reading rule is not a judgement call: the New Asset dialog's dropdown
-- is used by anyone who can create an asset, which is can_write_project —
-- members included. A template nobody can read is a template nobody can use.
--
-- An earlier draft of the S28 brief asserted a different answer as a finding
-- ("a template is not project content"), and it was wrong precisely because
-- templates CAN be pinned to one project, which makes those ones project
-- content. That paragraph was removed from the brief; this comment records
-- what replaced it.
-- =========================================================================


-- ── 1. The write predicate ───────────────────────────────────────────────
--
-- 🚨 COALESCE IS LOAD-BEARING, NOT TIDINESS — the 0042 lesson, applied to a
-- different NULL. Both inputs can be NULL:
--
--   * current_app_role() is NULL when the JWT carries no app_role, which is
--     the exact state the still-open `canWrite` investigation turns on.
--     NULL IN ('admin','manager') is NULL, not FALSE.
--   * project_role_for(NULL) is NULL for every GLOBAL template, and
--     NULL = 'manager' is NULL.
--
-- Bare, the expression would be `NULL OR NULL` = NULL for an ordinary member
-- writing a global template. A NULL policy expression FAILS, so the refusal
-- would still be correct today — by accident, through three-valued logic,
-- one edit away from inverting. Making both legs strictly boolean means the
-- next reader can reason about this with two values instead of three.
--
-- has_active_membership() is checked here as well as in the policies because
-- current_app_role() reads the JWT and a JWT outlives the membership it
-- describes. A deactivated admin still carries app_role='admin' until their
-- token is refreshed.

CREATE OR REPLACE FUNCTION public.can_write_task_template(p_project UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_active_membership(public.current_workspace_id())
     AND (
           COALESCE(public.current_app_role() IN ('admin', 'manager'), FALSE)
        OR COALESCE(public.project_role_for(p_project) = 'manager', FALSE)
         );
$$;

COMMENT ON FUNCTION public.can_write_task_template(UUID) IS
  'The task-template write gate (Audrey, 2026-08-04). TRUE for a workspace admin or manager on any template in their workspace, and for a project manager on a template pinned to that project. Takes the template''s project_id, which is NULL for a global template — project_role_for(NULL) is NULL, so only the admin/manager leg can admit a global one. Deliberately NOT can_write_project (that would let any member reshape a shared template) and deliberately NOT can_access_project_money (a template holds no rates; it holds bid DAYS, which are priced later against the rate card).';

-- Functions carry a bare =X/postgres aclitem, so naming only anon is a silent
-- no-op that reports success (the S22 grantee lesson, 0033:190-191).
REVOKE EXECUTE ON FUNCTION public.can_write_task_template(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_write_task_template(UUID) TO authenticated, service_role;


-- ── 2. A project-pinned template cannot point at another workspace ───────
--
-- Enforced by a COMPOSITE FK rather than a trigger or a policy clause, so it
-- is a database guarantee rather than something four policies have to
-- remember. It needs a unique constraint on the referenced pair; `id` is
-- already the primary key, so (id, workspace_id) is trivially unique and this
-- costs one small index on a table with three digits of rows.
--
-- The default MATCH SIMPLE is what makes it right for THIS table: when any
-- column of the key is NULL the constraint is not enforced at all, so a
-- GLOBAL template (project_id NULL) is unaffected while a pinned one is fully
-- checked. Getting that for free is why this is an FK and not a CHECK.

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_id_workspace_key;
ALTER TABLE public.projects
  ADD  CONSTRAINT projects_id_workspace_key UNIQUE (id, workspace_id);


-- ── 3. task_templates ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.task_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- NULL = global to the workspace. Set = pinned to one project, which is
  -- what TemplateScope (TaskTemplateManager.jsx:572) toggles. ON DELETE
  -- CASCADE: a template pinned to a deleted project has no meaning, and
  -- unlike a file it carries nothing a user would want back.
  project_id    UUID REFERENCES public.projects(id) ON DELETE CASCADE,

  name          TEXT NOT NULL DEFAULT 'Untitled Template',
  description   TEXT NOT NULL DEFAULT '',

  -- [{ id, name, role_slug, bid_days, sort_order, depends_on: [id] }]
  -- See the header for why this is not a child table.
  tasks         JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID,

  -- The UI always sends an array; nothing else may. A scalar or object here
  -- would make `(template.tasks || []).length` render NaN and topoSort throw
  -- inside the create-asset path, which has a finally but no catch.
  CONSTRAINT task_templates_tasks_is_array_chk CHECK (
    jsonb_typeof(tasks) = 'array'
  ),

  CONSTRAINT task_templates_project_workspace_fk
    FOREIGN KEY (project_id, workspace_id)
    REFERENCES public.projects (id, workspace_id)
);

-- Deliberately NO non-empty CHECK on `name`. TemplateName (:613) commits
-- whatever the field holds, so clearing it sends ''. A constraint would turn
-- an ordinary edit into a thrown error that the optimistic update then
-- reverts — a failure Local Server does not have. The UI already renders
-- `template.name || 'Untitled'` everywhere it displays one.

CREATE INDEX IF NOT EXISTS task_templates_workspace_idx
  ON public.task_templates (workspace_id);
CREATE INDEX IF NOT EXISTS task_templates_project_idx
  ON public.task_templates (project_id) WHERE project_id IS NOT NULL;

COMMENT ON TABLE public.task_templates IS
  'Reusable sets of tasks applied to an asset. Workspace-level, with an optional project pin (project_id NULL = global). Ported from Local Server''s one-JSON-file-per-template store (electron/main.cjs:2610-2656).';
COMMENT ON COLUMN public.task_templates.project_id IS
  'NULL = available to every project in the workspace. Set = pinned to that one project, and its manager may then edit it (can_write_task_template). The composite FK to (projects.id, projects.workspace_id) makes pinning to another workspace''s project impossible rather than merely unlikely.';
COMMENT ON COLUMN public.task_templates.tasks IS
  'JSONB array of { id, name, role_slug, bid_days, sort_order, depends_on: [id] }. `depends_on` holds sibling ids from THIS array and nothing else. Not a child table — see 0044''s header for the three measured reasons.';


-- ── 4. updated_at ────────────────────────────────────────────────────────
-- 0004's trigger is LANGUAGE plpgsql and NOT SECURITY DEFINER, which is the
-- precondition for FORCE ROW LEVEL SECURITY below.

DROP TRIGGER IF EXISTS trg_task_templates_touch ON public.task_templates;
CREATE TRIGGER trg_task_templates_touch
  BEFORE UPDATE ON public.task_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ── 5. RLS ───────────────────────────────────────────────────────────────
--
-- Four separate policies, never FOR ALL: a broad FOR ALL arm ORs with every
-- narrow arm beside it and silently wins (0029; it cost S15 a CRITICAL).
--
-- SELECT is workspace-scoped only, matching rate_cards — the analogue the
-- local server's own comment names. This is also what CLOSES the tenancy leak
-- in the local route without porting its predicate: `GET /projects/:id/
-- task-templates` filters on project_id ALONE and would return another
-- workspace's global templates. Harmless on a single-tenant local server; in
-- cloud the adapter runs the same `project_id IS NULL OR project_id = x`
-- filter and RLS supplies the workspace scope it omits. Port the intent, not
-- the predicate. Suite 54 probe 8 proves it rather than assuming it.
--
-- 🚨 UPDATE's WITH CHECK IS IDENTICAL TO ITS USING, ON PURPOSE — and the
-- reason is NOT the one it looks like. MEASURED by deliberate breakers
-- against wilson-dev, 2026-08-04:
--
--   * Omitting WITH CHECK entirely is SAFE. Postgres reuses the USING
--     expression as the new-row check when no WITH CHECK is given, so the
--     escape below is still refused. (Breaker B: 24/24 still passed. The
--     first draft of this comment claimed the opposite and was wrong.)
--   * A WITH CHECK that is merely WEAKER than USING is the actual hole, and
--     it is the natural thing to write — folders_update, budget_lines_update
--     and every other UPDATE policy in this schema drop a clause from their
--     WITH CHECK arm, so copying the house shape here is what opens it.
--     Dropping just can_write_task_template lets a project manager re-point
--     their own pinned template at project_id NULL and end up owning a
--     workspace-wide template they could never have created. (Breaker A:
--     probe 15 failed, alone.)
--
-- So the invariant worth stating is "WITH CHECK must not be weaker than
-- USING on this table", not "remember to write a WITH CHECK". Probe 15
-- asserts the behaviour, which holds under both spellings.

ALTER TABLE public.task_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_templates FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_templates_select ON public.task_templates;
CREATE POLICY task_templates_select ON public.task_templates
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  );

DROP POLICY IF EXISTS task_templates_insert ON public.task_templates;
CREATE POLICY task_templates_insert ON public.task_templates
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.can_write_task_template(project_id)
  );

DROP POLICY IF EXISTS task_templates_update ON public.task_templates;
CREATE POLICY task_templates_update ON public.task_templates
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.can_write_task_template(project_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.can_write_task_template(project_id)
  );

DROP POLICY IF EXISTS task_templates_delete ON public.task_templates;
CREATE POLICY task_templates_delete ON public.task_templates
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.can_write_task_template(project_id)
  );


-- ── 6. assets.task_template_id ───────────────────────────────────────────
--
-- 🚨 THIS IS THE `files_dir` TEST, AND IT COMES OUT THE OTHER WAY. S23 left
-- task_template_id out of ASSET_COLUMNS on the stated grounds that "a column
-- for a feature with no cloud implementation is schema debt", and 0041 left
-- files_dir out for the same reason. Both were right at the time. The rule
-- was never "never add it" — it was "it arrives WITH the feature", and this
-- is that arrival: the writers become reachable in this same commit.
--
-- Both writers were re-verified by grep this session, not copied from a
-- document: ProjectAssetsView.jsx:1390 (create-with-template, spread into the
-- asset create) and :1742 (ctx.updateAsset after apply-to-existing). Neither
-- can fire until listProjectTaskTemplates returns something, which is what
-- section 3 above makes possible.
--
-- ON DELETE SET NULL, not CASCADE: deleting a template must not delete the
-- assets built from it. The tasks it generated are already independent rows —
-- this column only records which template was used.

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS task_template_id UUID
    REFERENCES public.task_templates(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.assets.task_template_id IS
  'Which task template was applied to this asset, for display only — the tasks it created are ordinary independent rows. ON DELETE SET NULL so deleting a template never touches the work made from it.';


-- ── 7. Privileges ────────────────────────────────────────────────────────
--
-- 0033 disarmed 0011's ALTER DEFAULT PRIVILEGES, so a table created after it
-- is not born exposed — but a policy-only check passes happily while a
-- privilege hole is wide open (S21 found 25 such tables), so the revoke is
-- asserted rather than assumed. PUBLIC is named as well as anon because an
-- object can carry a bare =X/postgres aclitem and naming only anon would be a
-- silent no-op reporting success (the S22 grantee lesson).

REVOKE ALL ON public.task_templates FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_templates TO authenticated;
GRANT ALL ON public.task_templates TO service_role;
