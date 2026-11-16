-- =============================================================================
-- 0013_project_members.sql  (Session 6)
--
-- Project-level roles — the separate matrix roleMatrix.js reserves.
--
--   1. public.project_members: (project_id, user_id) → project_role
--      ('manager' | 'reviewer' | 'member'), composite-FK'd to
--      workspace_members so removing someone from the workspace removes
--      their project seats too.
--   2. Helpers: project_role_for(), project_is_staffed(),
--      can_write_project(), can_comment_project(),
--      can_manage_project_roster(), fn_comment_project_id().
--   3. Gating rule (mirrored client-side in projectRoleMatrix.js — keep in
--      lockstep):
--        app admin/manager        → full write access everywhere
--        UNSTAFFED project        → open to every active member (this is
--                                   every pre-Session-6 project, so nothing
--                                   changes until a roster row exists)
--        staffed: manager/member  → write entities
--        staffed: reviewer        → read + comment only
--        roster management        → app admin/manager or project manager
--   4. Entity write policies on the project-scoped tables gain the
--      can_write_project() condition. rate_cards / rate_card_entries are
--      workspace-level and stay unchanged (entries change in 0015).
--   5. Matrix-parity tightening on projects: INSERT admin+manager
--      ('project.create'), DELETE admin only ('project.delete').
--   6. tasks.assignee_id / tasks.reviewer_id UUID columns — canonical auth
--      user ids (FK-less per the 0007 convention). The legacy JSON fields
--      of the same name used these slots only in local mode until now.
--
-- project_members is NOT edit-history captured (0012's entity_type CHECK
-- locks the 13 RABBIT tables; roster changes are auth-layer, like
-- workspace_members). Documented in db/README.md.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ── 1. table ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.project_members (
  project_id   UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_role TEXT NOT NULL DEFAULT 'member'
    CHECK (project_role IN ('manager', 'reviewer', 'member')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID,
  PRIMARY KEY (project_id, user_id),
  -- Named so pgTAP can assert the exact FK-violation message. Guarantees a
  -- seat can only be given to a real workspace member of the project's
  -- workspace, and cascades the seat away when the membership goes.
  CONSTRAINT project_members_member_fkey
    FOREIGN KEY (workspace_id, user_id)
    REFERENCES public.workspace_members(workspace_id, user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS project_members_ws_user_idx
  ON public.project_members (workspace_id, user_id);
CREATE INDEX IF NOT EXISTS project_members_user_idx
  ON public.project_members (user_id);

-- workspace_id derives from the project — clients never send it. Always
-- re-derived (INSERT and UPDATE) so a seat row can never disagree with its
-- project's workspace, even if a client sends a forged value.
CREATE OR REPLACE FUNCTION public.fn_populate_workspace_for_project_member()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    SELECT workspace_id INTO NEW.workspace_id
      FROM public.projects WHERE id = NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_members_populate_workspace ON public.project_members;
CREATE TRIGGER trg_project_members_populate_workspace
  BEFORE INSERT OR UPDATE ON public.project_members
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_for_project_member();

-- Same audit stamping the 13 RABBIT tables get (fn_audit_touch from 0001
-- writes created_by/updated_by/created_at/updated_at, all present above).
DROP TRIGGER IF EXISTS trg_project_members_audit ON public.project_members;
CREATE TRIGGER trg_project_members_audit
  BEFORE INSERT OR UPDATE ON public.project_members
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_touch();

-- ── 2. helpers ───────────────────────────────────────────────────────────────
-- All SECURITY DEFINER so they can read project_members from inside policies
-- (including project_members' own) without RLS recursion — same rationale as
-- has_active_membership in 0008.

CREATE OR REPLACE FUNCTION public.project_role_for(p_project UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT pm.project_role
    FROM public.project_members pm
   WHERE pm.project_id = p_project
     AND pm.user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.project_is_staffed(p_project UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members pm WHERE pm.project_id = p_project
  );
$$;

CREATE OR REPLACE FUNCTION public.can_write_project(p_project UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.current_app_role() IN ('admin', 'manager')
      OR NOT public.project_is_staffed(p_project)
      OR public.project_role_for(p_project) IN ('manager', 'member');
$$;

CREATE OR REPLACE FUNCTION public.can_comment_project(p_project UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.current_app_role() IN ('admin', 'manager')
      OR NOT public.project_is_staffed(p_project)
      OR public.project_role_for(p_project) IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_project_roster(p_project UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.current_app_role() IN ('admin', 'manager')
      OR public.project_role_for(p_project) = 'manager';
$$;

-- Resolve a comment's polymorphic (entity_type, entity_id) to its project.
-- NULL for 'project'-less walks that dead-end (workspace population then
-- also fails, so the row is unreachable anyway).
CREATE OR REPLACE FUNCTION public.fn_comment_project_id(p_entity_type TEXT, p_entity_id UUID)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE p_entity_type
    WHEN 'project' THEN p_entity_id
    WHEN 'phase'   THEN (SELECT project_id FROM public.phases WHERE id = p_entity_id)
    WHEN 'asset'   THEN (SELECT project_id FROM public.assets WHERE id = p_entity_id)
    WHEN 'task'    THEN (SELECT project_id FROM public.tasks  WHERE id = p_entity_id)
    ELSE NULL
  END;
$$;

-- ── 3. RLS on project_members ────────────────────────────────────────────────

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_members_select ON public.project_members;
DROP POLICY IF EXISTS project_members_insert ON public.project_members;
DROP POLICY IF EXISTS project_members_update ON public.project_members;
DROP POLICY IF EXISTS project_members_delete ON public.project_members;

-- Rosters are workspace-visible (who's on a project is not a secret).
CREATE POLICY project_members_select ON public.project_members
  FOR SELECT USING (workspace_id = public.current_workspace_id());

CREATE POLICY project_members_insert ON public.project_members
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_manage_project_roster(project_id)
  );

-- WITH CHECK repeats the roster gate on the NEW row: without it a project
-- manager could repoint a seat's project_id and grant seats on projects
-- they don't manage.
CREATE POLICY project_members_update ON public.project_members
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_manage_project_roster(project_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_manage_project_roster(project_id)
  );

CREATE POLICY project_members_delete ON public.project_members
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_manage_project_roster(project_id)
  );

-- ── 4. entity write policies gain project gating ─────────────────────────────
-- SELECT policies are untouched here (visibility work happens in 0014).
-- Every policy keeps its 0004 workspace + membership conditions verbatim and
-- appends the project gate.

-- projects — matrix parity: INSERT admin+manager, UPDATE project-gated,
-- DELETE (hard) admin only.
DROP POLICY IF EXISTS projects_insert ON public.projects;
CREATE POLICY projects_insert ON public.projects
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.current_app_role() IN ('admin', 'manager')
  );

DROP POLICY IF EXISTS projects_update ON public.projects;
CREATE POLICY projects_update ON public.projects
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
  );

DROP POLICY IF EXISTS projects_delete ON public.projects;
CREATE POLICY projects_delete ON public.projects
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.current_app_role() = 'admin'
  );

-- assets
DROP POLICY IF EXISTS assets_insert ON public.assets;
CREATE POLICY assets_insert ON public.assets
  FOR INSERT WITH CHECK (
    -- workspace_id is populated by the BEFORE INSERT trigger if null; by the
    -- time WITH CHECK runs, NEW.workspace_id reflects the parent project.
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  );

DROP POLICY IF EXISTS assets_update ON public.assets;
CREATE POLICY assets_update ON public.assets
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  ) WITH CHECK (
    -- gate the NEW row too, or rows could be moved INTO a gated project
    workspace_id = public.current_workspace_id()
    AND public.can_write_project(project_id)
  );

DROP POLICY IF EXISTS assets_delete ON public.assets;
CREATE POLICY assets_delete ON public.assets
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  );

-- tasks
DROP POLICY IF EXISTS tasks_insert ON public.tasks;
CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  );

DROP POLICY IF EXISTS tasks_update ON public.tasks;
CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.can_write_project(project_id)
  );

DROP POLICY IF EXISTS tasks_delete ON public.tasks;
CREATE POLICY tasks_delete ON public.tasks
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  );

-- files
DROP POLICY IF EXISTS files_insert ON public.files;
CREATE POLICY files_insert ON public.files
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  );

DROP POLICY IF EXISTS files_update ON public.files;
CREATE POLICY files_update ON public.files
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.can_write_project(project_id)
  );

DROP POLICY IF EXISTS files_delete ON public.files;
CREATE POLICY files_delete ON public.files
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  );

-- comments — reviewers can comment too, hence the comment gate, not the
-- write gate. Author-vs-anyone refinement remains deferred (0004 note).
DROP POLICY IF EXISTS comments_insert ON public.comments;
CREATE POLICY comments_insert ON public.comments
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_comment_project(public.fn_comment_project_id(entity_type, entity_id))
  );

DROP POLICY IF EXISTS comments_update ON public.comments;
CREATE POLICY comments_update ON public.comments
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_comment_project(public.fn_comment_project_id(entity_type, entity_id))
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.can_comment_project(public.fn_comment_project_id(entity_type, entity_id))
  );

DROP POLICY IF EXISTS comments_delete ON public.comments;
CREATE POLICY comments_delete ON public.comments
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_comment_project(public.fn_comment_project_id(entity_type, entity_id))
  );

-- phases
DROP POLICY IF EXISTS phases_insert ON public.phases;
CREATE POLICY phases_insert ON public.phases
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = project_id
         AND p.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(p.workspace_id)
    )
    AND public.can_write_project(project_id)
  );

DROP POLICY IF EXISTS phases_update ON public.phases;
CREATE POLICY phases_update ON public.phases
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = phases.project_id
         AND p.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(p.workspace_id)
    )
    AND public.can_write_project(phases.project_id)
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = project_id
         AND p.workspace_id = public.current_workspace_id()
    )
    AND public.can_write_project(project_id)
  );

DROP POLICY IF EXISTS phases_delete ON public.phases;
CREATE POLICY phases_delete ON public.phases
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = phases.project_id
         AND p.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(p.workspace_id)
    )
    AND public.can_write_project(phases.project_id)
  );

-- asset_versions (project via assets)
DROP POLICY IF EXISTS asset_versions_insert ON public.asset_versions;
CREATE POLICY asset_versions_insert ON public.asset_versions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.assets a
       WHERE a.id = asset_id
         AND a.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(a.workspace_id)
         AND public.can_write_project(a.project_id)
    )
  );

DROP POLICY IF EXISTS asset_versions_update ON public.asset_versions;
CREATE POLICY asset_versions_update ON public.asset_versions
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.assets a
       WHERE a.id = asset_versions.asset_id
         AND a.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(a.workspace_id)
         AND public.can_write_project(a.project_id)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.assets a
       WHERE a.id = asset_id
         AND a.workspace_id = public.current_workspace_id()
         AND public.can_write_project(a.project_id)
    )
  );

DROP POLICY IF EXISTS asset_versions_delete ON public.asset_versions;
CREATE POLICY asset_versions_delete ON public.asset_versions
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.assets a
       WHERE a.id = asset_versions.asset_id
         AND a.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(a.workspace_id)
         AND public.can_write_project(a.project_id)
    )
  );

-- task_dependencies (project via predecessor task, matching 0004's shape)
DROP POLICY IF EXISTS task_deps_insert ON public.task_dependencies;
CREATE POLICY task_deps_insert ON public.task_dependencies
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tasks pre
       WHERE pre.id = predecessor_id
         AND pre.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(pre.workspace_id)
         AND public.can_write_project(pre.project_id)
    )
    AND EXISTS (
      SELECT 1 FROM public.tasks suc
       WHERE suc.id = successor_id
         AND suc.workspace_id = public.current_workspace_id()
    )
  );

DROP POLICY IF EXISTS task_deps_update ON public.task_dependencies;
CREATE POLICY task_deps_update ON public.task_dependencies
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.tasks pre
       WHERE pre.id = task_dependencies.predecessor_id
         AND pre.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(pre.workspace_id)
         AND public.can_write_project(pre.project_id)
    )
  );

DROP POLICY IF EXISTS task_deps_delete ON public.task_dependencies;
CREATE POLICY task_deps_delete ON public.task_dependencies
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.tasks pre
       WHERE pre.id = task_dependencies.predecessor_id
         AND pre.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(pre.workspace_id)
         AND public.can_write_project(pre.project_id)
    )
  );

-- task_links (project via task)
DROP POLICY IF EXISTS task_links_insert ON public.task_links;
CREATE POLICY task_links_insert ON public.task_links
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tasks t
       WHERE t.id = task_id
         AND t.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(t.workspace_id)
         AND public.can_write_project(t.project_id)
    )
  );

DROP POLICY IF EXISTS task_links_update ON public.task_links;
CREATE POLICY task_links_update ON public.task_links
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
       WHERE t.id = task_links.task_id
         AND t.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(t.workspace_id)
         AND public.can_write_project(t.project_id)
    )
  );

DROP POLICY IF EXISTS task_links_delete ON public.task_links;
CREATE POLICY task_links_delete ON public.task_links
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
       WHERE t.id = task_links.task_id
         AND t.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(t.workspace_id)
         AND public.can_write_project(t.project_id)
    )
  );

-- ingestion_runs (direct project_id)
DROP POLICY IF EXISTS ingestion_runs_insert ON public.ingestion_runs;
CREATE POLICY ingestion_runs_insert ON public.ingestion_runs
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = project_id
         AND p.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(p.workspace_id)
    )
    AND public.can_write_project(project_id)
  );

DROP POLICY IF EXISTS ingestion_runs_update ON public.ingestion_runs;
CREATE POLICY ingestion_runs_update ON public.ingestion_runs
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = ingestion_runs.project_id
         AND p.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(p.workspace_id)
    )
    AND public.can_write_project(ingestion_runs.project_id)
  );

DROP POLICY IF EXISTS ingestion_runs_delete ON public.ingestion_runs;
CREATE POLICY ingestion_runs_delete ON public.ingestion_runs
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = ingestion_runs.project_id
         AND p.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(p.workspace_id)
    )
    AND public.can_write_project(ingestion_runs.project_id)
  );

-- ingestion_chunks (project via run)
DROP POLICY IF EXISTS ingestion_chunks_insert ON public.ingestion_chunks;
CREATE POLICY ingestion_chunks_insert ON public.ingestion_chunks
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.ingestion_runs r
        JOIN public.projects       p ON p.id = r.project_id
       WHERE r.id = run_id
         AND p.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(p.workspace_id)
         AND public.can_write_project(r.project_id)
    )
  );

DROP POLICY IF EXISTS ingestion_chunks_update ON public.ingestion_chunks;
CREATE POLICY ingestion_chunks_update ON public.ingestion_chunks
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
        FROM public.ingestion_runs r
        JOIN public.projects       p ON p.id = r.project_id
       WHERE r.id = ingestion_chunks.run_id
         AND p.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(p.workspace_id)
         AND public.can_write_project(r.project_id)
    )
  );

DROP POLICY IF EXISTS ingestion_chunks_delete ON public.ingestion_chunks;
CREATE POLICY ingestion_chunks_delete ON public.ingestion_chunks
  FOR DELETE USING (
    EXISTS (
      SELECT 1
        FROM public.ingestion_runs r
        JOIN public.projects       p ON p.id = r.project_id
       WHERE r.id = ingestion_chunks.run_id
         AND p.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(p.workspace_id)
         AND public.can_write_project(r.project_id)
    )
  );

-- ── 5. task assignment columns (canonical auth user ids) ─────────────────────

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS assignee_id UUID;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS reviewer_id UUID;
-- FK-less per the 0007 convention (works offline; attribution best-effort).
-- assigned_user_id (0000, reserved) stays untouched for standalone RABBIT.

CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON public.tasks (assignee_id);
CREATE INDEX IF NOT EXISTS tasks_reviewer_idx ON public.tasks (reviewer_id);

-- ── 6. post-conditions ───────────────────────────────────────────────────────

DO $$
DECLARE
  has_rls BOOLEAN;
  is_forced BOOLEAN;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity
    INTO has_rls, is_forced
    FROM pg_class
   WHERE oid = 'public.project_members'::regclass;

  IF NOT has_rls OR NOT is_forced THEN
    RAISE EXCEPTION 'RLS post-condition failed for project_members: rowsecurity=%, force=%',
      has_rls, is_forced;
  END IF;
END $$;

COMMENT ON TABLE public.project_members IS
  'Project-level roles (Session 6): manager | reviewer | member per project. Gating helpers can_write_project()/can_comment_project()/can_manage_project_roster() mirror src/permissions/projectRoleMatrix.js — keep in lockstep. Unstaffed projects stay open to all active workspace members.';
COMMENT ON FUNCTION public.can_write_project IS
  'App admin/manager, OR project unstaffed, OR project_role manager/member. Used by every project-scoped entity write policy.';
