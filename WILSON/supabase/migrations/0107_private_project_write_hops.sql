-- =============================================================================
-- 0107_private_project_write_hops.sql — M.O.T.H. Session 1 (MO1), the privacy
-- repairs, part A (docs/design/MOTH_DESIGN.md §1.4 "0107" and §2.6 R2 to R6).
--
-- WHAT IS WRONG TODAY (MEASURED on wilson-dev, 2026-11-02, and in the code)
-- -------------------------------------------------------------------------
-- 0072 made a project private: projects_select hides it from everyone but its
-- creator and the workspace admins, and every child table's SELECT policy hops
-- to projects, so a private project's rows vanish with it. The WRITE side was
-- never given the hop. The write policies of tasks, assets, folders, scenes,
-- shots, levels, experiences, comments and project_members check workspace,
-- membership and can_write_project (or can_comment_project /
-- can_manage_project_roster), and can_write_project is true for every admin
-- and manager and for every member of an unstaffed project, with no privacy
-- arm (0013). So a second manager who has a private project's id can INSERT a
-- task or an asset into it over PostgREST, or move a row INTO it through
-- UPDATE's WITH CHECK (OUTSTANDING A-R2-03). A filter-less, column-free UPDATE
-- or DELETE reads no column, so only USING judges it, and files_update,
-- files_delete, milestones_update and milestones_delete carry no hop on USING
-- (C-R2-01's remaining bullet). project_members_select and
-- task_templates_select hand a private project's roster and pinned templates
-- to every member on READ. projects_update has no privacy arm, and nothing
-- guards projects.created_by, on which private visibility hangs:
-- fn_audit_touch (0001) stamps it only when it is NULL on INSERT. A member seat
-- can mint a manager seat by setting producer_id (0020's
-- fn_projects_auto_staff). And 22 single-column foreign keys between
-- project-scoped tables (tasks.asset_id, files.folder_id, folders.parent_id,
-- budget_actuals.line_id, ...) check no project, so a writer who knows another
-- project's ids can attach rows to its structure. Scan S2 below, run on the
-- schema before this file, fails 48 clauses; this file fixes 46 and pins the
-- two it leaves (edit_history_select, which 0108 repairs; the own-row arm of
-- upload_reservations_select).
--
-- WHAT THIS FILE DOES
-- -------------------
--   §1  projects.topic_epoch (0109's per-project topic; a narrowing bumps it).
--   §2  fn_projects_owner_guard: for client callers created_by and topic_epoch
--       are pinned, is_private is changed only by the creator or an admin, a
--       producer is chosen only by someone who manages the team; for every
--       caller, a narrowing bumps topic_epoch.
--   §3  projects_update: the deployed body, with the privacy arm on USING.
--   §4  The hop `EXISTS (SELECT 1 FROM public.projects p WHERE p.id =
--       <t>.project_id)`, evaluated under the caller's projects_select, on
--       every client write clause of the tables above, on
--       project_members_select and on task_templates_select (task_templates:
--       project_id IS NULL OR the hop); comments hop through
--       fn_comment_project_id. task_deps_update and phase_deps_update gain the
--       WITH CHECK their INSERT has (both endpoints).
--   §5  fn_same_project_refs_guard: for client callers, a new or changed
--       secondary link must name a row of the same project (23503 otherwise,
--       one sentence for "another project" and "gone", so it is no oracle).
--   §6  Post-conditions: scans S1, S2, S3 and S5 over the catalogue, and the
--       guards' shape.
--
-- Every restated policy is the body deployed on wilson-dev (pg_policies, read
-- 2026-11-02) with the hop added; nothing else in it changes. One transaction,
-- no enum. Re-run this file after any replay of 0013, 0020, 0040, 0041, 0044,
-- 0061, 0082 or 0092. Suite: supabase/tests/rls/110_private_project_write_hops.sql.
-- =============================================================================

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'is_private') THEN
    RAISE EXCEPTION '0107 refused: projects.is_private is missing (0072 is not applied)';
  END IF;
  IF to_regprocedure('public.passes_project_privacy(uuid)') IS NULL THEN
    RAISE EXCEPTION '0107 refused: passes_project_privacy is missing (0082 is not applied)';
  END IF;
  IF to_regprocedure('public.can_access_project_legal(uuid)') IS NULL THEN
    RAISE EXCEPTION '0107 refused: can_access_project_legal is missing (0092 is not applied)';
  END IF;
END $$;

-- §1 projects.topic_epoch -------------------------------------------------------
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS topic_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_topic_epoch_chk;
ALTER TABLE public.projects ADD CONSTRAINT projects_topic_epoch_chk CHECK (topic_epoch >= 0);
COMMENT ON COLUMN public.projects.topic_epoch IS
  '0107: bumped by fn_projects_owner_guard whenever the project''s audience narrows (made private, or its creator changed while private). 0109 names the per-project topic by it, so a subscriber who joined before a narrowing stops hearing the project. Clients never write it (the guard pins it).';

-- §2 The projects owner guard -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_projects_owner_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- A client caller: PostgREST's role, unchanged inside a client-called
  -- definer RPC (soft_delete_row, ensure_personal_space). The migration runner
  -- and service_role are not bound.
  v_bound BOOLEAN := COALESCE(current_setting('role', true), '') IN ('authenticated', 'anon');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_bound THEN
      NEW.created_by := auth.uid();
      NEW.topic_epoch := 0;
    END IF;
    RETURN NEW;
  END IF;

  IF v_bound THEN
    NEW.created_by := OLD.created_by;
    NEW.topic_epoch := OLD.topic_epoch;
    IF NEW.is_private IS DISTINCT FROM OLD.is_private
       AND NOT (OLD.created_by = auth.uid() OR public.current_app_role() = 'admin') THEN
      RAISE EXCEPTION 'Only the person who made this project, or an admin, can change who can see it.'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.producer_id IS DISTINCT FROM OLD.producer_id AND NEW.producer_id IS NOT NULL
       AND NOT COALESCE(public.can_manage_project_roster(OLD.id), false) THEN
      RAISE EXCEPTION 'Only someone who manages this project''s team can choose its producer.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Every caller: a narrowing of the audience moves the project to a new topic.
  IF (OLD.is_private IS NOT TRUE AND NEW.is_private IS TRUE)
     OR (NEW.is_private IS TRUE AND NEW.created_by IS DISTINCT FROM OLD.created_by) THEN
    NEW.topic_epoch := OLD.topic_epoch + 1;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_projects_owner_guard() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.fn_projects_owner_guard() IS
  '0107: pins created_by and topic_epoch for client callers, lets only the creator or an admin change is_private, refuses a producer chosen by someone who cannot manage the team, and bumps topic_epoch on every narrowing (any caller). Private visibility hangs on created_by, which fn_audit_touch stamps only when NULL. The personal-space migration restates this function rather than adding a second guard.';

DROP TRIGGER IF EXISTS trg_projects_owner_guard ON public.projects;
CREATE TRIGGER trg_projects_owner_guard
  BEFORE INSERT OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.fn_projects_owner_guard();

-- §3 projects_update: the privacy arm on USING ------------------------------------
DROP POLICY IF EXISTS projects_update ON public.projects;
CREATE POLICY projects_update ON public.projects FOR UPDATE
  USING (workspace_id = public.current_workspace_id()
         AND public.has_active_membership(workspace_id)
         AND public.can_write_project(id)
         AND (NOT is_private OR created_by = auth.uid() OR public.current_app_role() = 'admin'))
  WITH CHECK (workspace_id = public.current_workspace_id());

-- §4 The project hop on every client write clause --------------------------------
-- The seven tables whose write policies have one shape (0013, 0040, 0041).
DO $$
DECLARE
  t TEXT;
  v_hop TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['tasks', 'assets', 'folders', 'scenes', 'shots', 'levels', 'experiences'] LOOP
    v_hop := format('EXISTS (SELECT 1 FROM public.projects p WHERE p.id = %I.project_id)', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK ('
      'workspace_id = public.current_workspace_id() AND public.has_active_membership(workspace_id) '
      'AND public.can_write_project(project_id) AND %s)', t || '_insert', t, v_hop);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE USING ('
      'workspace_id = public.current_workspace_id() AND public.has_active_membership(workspace_id) '
      'AND public.can_write_project(project_id) AND %s) WITH CHECK ('
      'workspace_id = public.current_workspace_id() AND public.can_write_project(project_id) AND %s)',
      t || '_update', t, v_hop, v_hop);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE USING ('
      'workspace_id = public.current_workspace_id() AND public.has_active_membership(workspace_id) '
      'AND public.can_write_project(project_id) AND %s)', t || '_delete', t, v_hop);
  END LOOP;
END $$;

-- comments: the hop through fn_comment_project_id (0013).
DROP POLICY IF EXISTS comments_insert ON public.comments;
CREATE POLICY comments_insert ON public.comments FOR INSERT
  WITH CHECK (workspace_id = public.current_workspace_id()
              AND public.has_active_membership(workspace_id)
              AND public.can_comment_project(public.fn_comment_project_id(entity_type, entity_id))
              AND EXISTS (SELECT 1 FROM public.projects p
                          WHERE p.id = public.fn_comment_project_id(comments.entity_type, comments.entity_id)));
DROP POLICY IF EXISTS comments_update ON public.comments;
CREATE POLICY comments_update ON public.comments FOR UPDATE
  USING (workspace_id = public.current_workspace_id()
         AND public.has_active_membership(workspace_id)
         AND public.can_comment_project(public.fn_comment_project_id(entity_type, entity_id))
         AND EXISTS (SELECT 1 FROM public.projects p
                     WHERE p.id = public.fn_comment_project_id(comments.entity_type, comments.entity_id)))
  WITH CHECK (workspace_id = public.current_workspace_id()
              AND public.can_comment_project(public.fn_comment_project_id(entity_type, entity_id))
              AND EXISTS (SELECT 1 FROM public.projects p
                          WHERE p.id = public.fn_comment_project_id(comments.entity_type, comments.entity_id)));
DROP POLICY IF EXISTS comments_delete ON public.comments;
CREATE POLICY comments_delete ON public.comments FOR DELETE
  USING (workspace_id = public.current_workspace_id()
         AND public.has_active_membership(workspace_id)
         AND public.can_comment_project(public.fn_comment_project_id(entity_type, entity_id))
         AND EXISTS (SELECT 1 FROM public.projects p
                     WHERE p.id = public.fn_comment_project_id(comments.entity_type, comments.entity_id)));

-- project_members: the hop on the three writes and on the read (0013, 0020).
DROP POLICY IF EXISTS project_members_select ON public.project_members;
CREATE POLICY project_members_select ON public.project_members FOR SELECT
  USING (workspace_id = public.current_workspace_id()
         AND public.has_active_membership(workspace_id)
         AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_members.project_id));
DROP POLICY IF EXISTS project_members_insert ON public.project_members;
CREATE POLICY project_members_insert ON public.project_members FOR INSERT
  WITH CHECK (workspace_id = public.current_workspace_id()
              AND public.has_active_membership(workspace_id)
              AND public.can_manage_project_roster(project_id)
              AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_members.project_id));
DROP POLICY IF EXISTS project_members_update ON public.project_members;
CREATE POLICY project_members_update ON public.project_members FOR UPDATE
  USING (workspace_id = public.current_workspace_id()
         AND public.has_active_membership(workspace_id)
         AND public.can_manage_project_roster(project_id)
         AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_members.project_id))
  WITH CHECK (workspace_id = public.current_workspace_id()
              AND public.has_active_membership(workspace_id)
              AND public.can_manage_project_roster(project_id)
              AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_members.project_id));
DROP POLICY IF EXISTS project_members_delete ON public.project_members;
CREATE POLICY project_members_delete ON public.project_members FOR DELETE
  USING (workspace_id = public.current_workspace_id()
         AND public.has_active_membership(workspace_id)
         AND public.can_manage_project_roster(project_id)
         AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_members.project_id));

-- task_templates: a workspace template (project_id NULL) or one pinned to a
-- project the caller can see (0044).
DROP POLICY IF EXISTS task_templates_select ON public.task_templates;
CREATE POLICY task_templates_select ON public.task_templates FOR SELECT
  USING (workspace_id = public.current_workspace_id()
         AND public.has_active_membership(workspace_id)
         AND (project_id IS NULL
              OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_templates.project_id)));
DROP POLICY IF EXISTS task_templates_insert ON public.task_templates;
CREATE POLICY task_templates_insert ON public.task_templates FOR INSERT
  WITH CHECK (workspace_id = public.current_workspace_id()
              AND public.can_write_task_template(project_id)
              AND (project_id IS NULL
                   OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_templates.project_id)));
DROP POLICY IF EXISTS task_templates_update ON public.task_templates;
CREATE POLICY task_templates_update ON public.task_templates FOR UPDATE
  USING (workspace_id = public.current_workspace_id()
         AND public.can_write_task_template(project_id)
         AND (project_id IS NULL
              OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_templates.project_id)))
  WITH CHECK (workspace_id = public.current_workspace_id()
              AND public.can_write_task_template(project_id)
              AND (project_id IS NULL
                   OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_templates.project_id)));
DROP POLICY IF EXISTS task_templates_delete ON public.task_templates;
CREATE POLICY task_templates_delete ON public.task_templates FOR DELETE
  USING (workspace_id = public.current_workspace_id()
         AND public.can_write_task_template(project_id)
         AND (project_id IS NULL
              OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_templates.project_id)));

-- files: the hop joins USING on update and delete (0092's bodies; WITH CHECK
-- and the money arm unchanged).
DROP POLICY IF EXISTS files_update ON public.files;
CREATE POLICY files_update ON public.files FOR UPDATE
  USING (workspace_id = public.current_workspace_id()
         AND public.has_active_membership(workspace_id)
         AND public.can_write_project(project_id)
         AND (NOT public.file_row_is_money(is_financial, storage_path)
              OR public.can_access_project_money(project_id)
              OR (public.file_row_is_legal(is_financial, storage_path) AND public.can_access_project_legal(project_id)))
         AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = files.project_id))
  WITH CHECK (workspace_id = public.current_workspace_id()
              AND public.can_write_project(project_id)
              AND (NOT public.file_row_is_money(is_financial, storage_path)
                   OR public.can_access_project_money(project_id)
                   OR (public.file_row_is_legal(is_financial, storage_path) AND public.can_access_project_legal(project_id)))
              AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = files.project_id));
DROP POLICY IF EXISTS files_delete ON public.files;
CREATE POLICY files_delete ON public.files FOR DELETE
  USING (workspace_id = public.current_workspace_id()
         AND public.has_active_membership(workspace_id)
         AND public.can_write_project(project_id)
         AND (NOT public.file_row_is_money(is_financial, storage_path)
              OR public.can_access_project_money(project_id)
              OR (public.file_row_is_legal(is_financial, storage_path) AND public.can_access_project_legal(project_id)))
         AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = files.project_id));

-- milestones: the hop joins USING on update and delete (0082 §3b gave the
-- two WITH CHECKs theirs).
DROP POLICY IF EXISTS milestones_update ON public.milestones;
CREATE POLICY milestones_update ON public.milestones FOR UPDATE
  USING (workspace_id = public.current_workspace_id()
         AND public.has_active_membership(workspace_id)
         AND public.can_write_project(project_id)
         AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = milestones.project_id))
  WITH CHECK (workspace_id = public.current_workspace_id()
              AND public.can_write_project(project_id)
              AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = milestones.project_id));
DROP POLICY IF EXISTS milestones_delete ON public.milestones;
CREATE POLICY milestones_delete ON public.milestones FOR DELETE
  USING (workspace_id = public.current_workspace_id()
         AND public.has_active_membership(workspace_id)
         AND public.can_write_project(project_id)
         AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = milestones.project_id));

-- The dependency tables: UPDATE gains the WITH CHECK its INSERT has, so an
-- update cannot re-point either endpoint at a task or phase the caller could
-- not link on insert (0013, 0061).
DROP POLICY IF EXISTS task_deps_update ON public.task_dependencies;
CREATE POLICY task_deps_update ON public.task_dependencies FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.tasks pre
                 WHERE pre.id = task_dependencies.predecessor_id
                   AND pre.workspace_id = public.current_workspace_id()
                   AND public.has_active_membership(pre.workspace_id)
                   AND public.can_write_project(pre.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tasks pre
                      WHERE pre.id = task_dependencies.predecessor_id
                        AND pre.workspace_id = public.current_workspace_id()
                        AND public.has_active_membership(pre.workspace_id)
                        AND public.can_write_project(pre.project_id))
              AND EXISTS (SELECT 1 FROM public.tasks suc
                          WHERE suc.id = task_dependencies.successor_id
                            AND suc.workspace_id = public.current_workspace_id()));
DROP POLICY IF EXISTS phase_deps_update ON public.phase_dependencies;
CREATE POLICY phase_deps_update ON public.phase_dependencies FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.phases pre JOIN public.projects pp ON pp.id = pre.project_id
                 WHERE pre.id = phase_dependencies.predecessor_id
                   AND pp.workspace_id = public.current_workspace_id()
                   AND public.has_active_membership(pp.workspace_id)
                   AND public.can_write_project(pp.id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.phases pre JOIN public.projects pp ON pp.id = pre.project_id
                      WHERE pre.id = phase_dependencies.predecessor_id
                        AND pp.workspace_id = public.current_workspace_id()
                        AND public.has_active_membership(pp.workspace_id)
                        AND public.can_write_project(pp.id))
              AND EXISTS (SELECT 1 FROM public.phases suc JOIN public.projects sp ON sp.id = suc.project_id
                          WHERE suc.id = phase_dependencies.successor_id
                            AND sp.workspace_id = public.current_workspace_id()));

-- §5 Same-project references --------------------------------------------------------
-- The map is every single-column foreign key between two project-scoped tables
-- (pg_constraint on wilson-dev, 2026-11-02: 22 of them; a composite key that
-- carries project_id needs nothing), plus the uuid[] links on assets (0084,
-- 0099; no FK) and both endpoints of the two dependency tables.
-- assets.task_template_id may also name a workspace template (project_id NULL).
CREATE OR REPLACE FUNCTION public.fn_same_project_refs_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new    JSONB := to_jsonb(NEW);
  v_old    JSONB := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
  v_moved  BOOLEAN;
  v_map    JSONB;
  v_arrays JSONB;
  v_col    TEXT;
  v_tbl    TEXT;
  v_val    TEXT;
  v_ok     BOOLEAN;
BEGIN
  -- Client callers only; the checked move (a later migration) sets the flag
  -- and validates its own links.
  IF COALESCE(current_setting('role', true), '') NOT IN ('authenticated', 'anon')
     OR COALESCE(current_setting('wilson.checked_move', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  -- 🚨 BEFORE triggers run before RLS. A caller who cannot see the row's
  -- project is refused by RLS anyway, so the guard judges only a row whose
  -- project the caller can see (and, for the money table, whose money they
  -- may read): otherwise a refused caller would get "another project" for a
  -- wrong id and RLS's refusal for a right one, an existence oracle over
  -- hidden ids (found by suite 44 probe 10 in MO1's rehearsal). The same
  -- rule for a dependency, over both endpoints.
  IF TG_TABLE_NAME IN ('task_dependencies', 'phase_dependencies') THEN
    IF TG_OP = 'UPDATE'
       AND (v_new->>'predecessor_id') IS NOT DISTINCT FROM (v_old->>'predecessor_id')
       AND (v_new->>'successor_id') IS NOT DISTINCT FROM (v_old->>'successor_id') THEN
      RETURN NEW;
    END IF;
    EXECUTE format(
      'SELECT count(*) = 2 AND bool_and(EXISTS (SELECT 1 FROM public.projects p '
      'WHERE p.id = x.project_id AND p.workspace_id = public.current_workspace_id() '
      'AND p.deleted_at IS NULL AND public.has_active_membership(p.workspace_id) '
      'AND public.passes_project_privacy(p.id))) FROM public.%I x WHERE x.id IN ($1, $2)',
      CASE TG_TABLE_NAME WHEN 'task_dependencies' THEN 'tasks' ELSE 'phases' END)
      INTO v_ok USING (v_new->>'predecessor_id')::uuid, (v_new->>'successor_id')::uuid;
    IF NOT COALESCE(v_ok, false) THEN
      RETURN NEW;
    END IF;
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM public.%1$I a JOIN public.%1$I b ON b.project_id = a.project_id '
      'WHERE a.id = $1 AND b.id = $2)',
      CASE TG_TABLE_NAME WHEN 'task_dependencies' THEN 'tasks' ELSE 'phases' END)
      INTO v_ok USING (v_new->>'predecessor_id')::uuid, (v_new->>'successor_id')::uuid;
    IF NOT COALESCE(v_ok, false) THEN
      RAISE EXCEPTION 'That item belongs to another project or no longer exists.' USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.projects p
                  WHERE p.id = (v_new->>'project_id')::uuid
                    AND p.workspace_id = public.current_workspace_id()
                    AND p.deleted_at IS NULL
                    AND public.has_active_membership(p.workspace_id)
                    AND public.passes_project_privacy(p.id))
     OR (TG_TABLE_NAME = 'budget_actuals'
         AND NOT COALESCE(public.can_access_project_money((v_new->>'project_id')::uuid), false)) THEN
    RETURN NEW;
  END IF;

  v_moved := TG_OP = 'INSERT' OR (v_new->>'project_id') IS DISTINCT FROM (v_old->>'project_id');
  v_map := CASE TG_TABLE_NAME
    WHEN 'tasks'          THEN '{"asset_id":"assets","phase_id":"phases"}'
    WHEN 'assets'         THEN '{"phase_id":"phases"}'
    WHEN 'phases'         THEN '{"parent_phase_id":"phases"}'
    WHEN 'milestones'     THEN '{"phase_id":"phases"}'
    WHEN 'shots'          THEN '{"scene_id":"scenes"}'
    WHEN 'folders'        THEN '{"parent_id":"folders","asset_id":"assets","scene_id":"scenes","shot_id":"shots","level_id":"levels","experience_id":"experiences"}'
    WHEN 'files'          THEN '{"folder_id":"folders","phase_id":"phases","asset_id":"assets","task_id":"tasks","scene_id":"scenes","shot_id":"shots","level_id":"levels","experience_id":"experiences"}'
    WHEN 'budget_actuals' THEN '{"line_id":"budget_lines"}'
    ELSE '{}'
  END::jsonb;
  v_arrays := CASE TG_TABLE_NAME
    WHEN 'assets' THEN '{"scene_ids":"scenes","shot_ids":"shots","level_ids":"levels","experience_ids":"experiences"}'
    ELSE '{}'
  END::jsonb;

  FOR v_col, v_tbl IN SELECT key, value #>> '{}' FROM jsonb_each(v_map) LOOP
    v_val := v_new->>v_col;
    CONTINUE WHEN v_val IS NULL;
    CONTINUE WHEN NOT v_moved AND v_val IS NOT DISTINCT FROM (v_old->>v_col);
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1 AND project_id = $2)', v_tbl)
      INTO v_ok USING v_val::uuid, (v_new->>'project_id')::uuid;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'That item belongs to another project or no longer exists.' USING ERRCODE = '23503';
    END IF;
  END LOOP;

  IF TG_TABLE_NAME = 'assets' THEN
    v_val := v_new->>'task_template_id';
    IF v_val IS NOT NULL AND (v_moved OR v_val IS DISTINCT FROM (v_old->>'task_template_id')) THEN
      SELECT EXISTS (SELECT 1 FROM public.task_templates tt
                     WHERE tt.id = v_val::uuid
                       AND (tt.project_id IS NULL OR tt.project_id = (v_new->>'project_id')::uuid))
        INTO v_ok;
      IF NOT v_ok THEN
        RAISE EXCEPTION 'That item belongs to another project or no longer exists.' USING ERRCODE = '23503';
      END IF;
    END IF;
  END IF;

  -- uuid[] links: every element added since OLD (all of them when the row
  -- changes project), so an existing orphan in an unmoved row still passes.
  FOR v_col, v_tbl IN SELECT key, value #>> '{}' FROM jsonb_each(v_arrays) LOOP
    FOR v_val IN
      SELECT e FROM jsonb_array_elements_text(COALESCE(v_new->v_col, '[]'::jsonb)) AS e
      WHERE v_moved OR NOT (COALESCE(v_old->v_col, '[]'::jsonb) ? e)
    LOOP
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1 AND project_id = $2)', v_tbl)
        INTO v_ok USING v_val::uuid, (v_new->>'project_id')::uuid;
      IF NOT v_ok THEN
        RAISE EXCEPTION 'That item belongs to another project or no longer exists.' USING ERRCODE = '23503';
      END IF;
    END LOOP;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_same_project_refs_guard() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.fn_same_project_refs_guard() IS
  '0107: for client callers, every new or changed secondary link (single-column foreign keys between project-scoped tables, the uuid[] links on assets, both ends of a dependency) must name a row of the same project; 23503 with one sentence otherwise, the same for "another project" and "gone". It judges only a row whose project the caller can see (for budget_actuals, whose money they may read) and leaves every other refusal to RLS, so it is no existence oracle over hidden ids. Skipped under wilson.checked_move. The map is pinned by 0107''s post-condition S5 and suite 110.';

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['tasks', 'assets', 'phases', 'milestones', 'shots', 'folders', 'files',
                           'budget_actuals', 'task_dependencies', 'phase_dependencies'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || t || '_same_project_refs', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.fn_same_project_refs_guard()',
                   'trg_' || t || '_same_project_refs', t);
  END LOOP;
END $$;

-- §6 Post-conditions ------------------------------------------------------------------
DO $$
DECLARE
  v_n       INTEGER;
  v_q       TEXT;
  v_list    TEXT;
  v_src     TEXT;
  r         RECORD;
BEGIN
  -- S1: projects has exactly one permissive SELECT policy, projects_select,
  -- carrying 0072's privacy arm, and no restrictive or FOR ALL policy.
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'projects' AND cmd = 'SELECT';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '0107 post-condition S1 failed: projects has % SELECT policies (expected 1)', v_n;
  END IF;
  SELECT qual INTO v_q FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'projects' AND policyname = 'projects_select' AND permissive = 'PERMISSIVE';
  IF v_q IS NULL OR position('is_private' IN v_q) = 0 OR position('created_by = auth.uid()' IN v_q) = 0
     OR position('current_app_role() = ''admin''::text' IN v_q) = 0 OR position('deleted_at IS NULL' IN v_q) = 0 THEN
    RAISE EXCEPTION '0107 post-condition S1 failed: projects_select lost an arm of 0072''s privacy rule';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'projects'
              AND (permissive <> 'PERMISSIVE' OR cmd = 'ALL')) THEN
    RAISE EXCEPTION '0107 post-condition S1 failed: projects carries a restrictive or FOR ALL policy';
  END IF;

  -- S2: every permissive clause on a client-privileged project-scoped table
  -- hops to projects, or through its anchor parent, or calls a gate allowed
  -- for that table only; the two clauses this file leaves are pinned.
  SELECT string_agg(format('%s.%s (%s)', x.tablename, x.policyname, x.clause), ', ' ORDER BY 1)
    INTO v_list
    FROM (
      SELECT p.tablename, p.policyname, cl.clause, cl.txt
        FROM pg_policies p
        JOIN pg_class c ON c.relname = p.tablename AND c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
        CROSS JOIN LATERAL (VALUES ('using', p.qual), ('check', p.with_check)) AS cl(clause, txt)
       WHERE p.schemaname = 'public' AND p.permissive = 'PERMISSIVE' AND cl.txt IS NOT NULL
         AND (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'project_id' AND NOT a.attisdropped)
              OR c.relname IN ('asset_versions', 'task_links', 'task_dependencies', 'phase_dependencies', 'ingestion_chunks', 'comments'))
         AND (has_table_privilege('authenticated', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'INSERT')
              OR has_table_privilege('authenticated', c.oid, 'UPDATE') OR has_table_privilege('authenticated', c.oid, 'DELETE'))
    ) x
   WHERE x.txt !~ '(FROM|JOIN) \(?projects [a-z_]+'
     AND NOT (x.tablename = 'asset_versions' AND x.txt ~ 'FROM assets')
     AND NOT (x.tablename = 'task_links' AND x.txt ~ 'FROM tasks')
     AND NOT (x.tablename = 'ingestion_chunks' AND x.txt ~ 'ingestion_runs')
     AND NOT (x.tablename = 'task_dependencies' AND x.txt ~ 'FROM tasks')
     AND NOT (x.tablename = 'phase_dependencies' AND x.txt ~ 'phases pre')
     AND NOT (x.tablename IN ('budget_versions', 'budget_lines', 'budget_actuals', 'expenses', 'project_rate_overrides')
              AND x.txt ~ 'can_access_project_money\(project_id\)')
     AND NOT (x.tablename IN ('file_events', 'edit_history') AND x.txt ~ 'can_read_project_topic\(project_id\)')
     -- Pinned: 0108 gives edit_history_select its arm; upload_reservations_select
     -- is an own-row arm (created_by = auth.uid()).
     AND NOT (x.tablename = 'edit_history' AND x.policyname = 'edit_history_select')
     AND NOT (x.tablename = 'upload_reservations' AND x.policyname = 'upload_reservations_select'
              AND x.txt ~ 'created_by = auth\.uid\(\)');
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION '0107 post-condition S2 failed: these clauses do not hop to projects: %', v_list;
  END IF;

  -- S3: every INSERT and UPDATE check of a two-anchor table names both anchors.
  FOR r IN SELECT p.tablename, p.policyname, COALESCE(p.with_check, p.qual) AS chk
             FROM pg_policies p
            WHERE p.schemaname = 'public' AND p.tablename IN ('task_dependencies', 'phase_dependencies')
              AND p.cmd IN ('INSERT', 'UPDATE') LOOP
    IF r.chk IS NULL OR position('predecessor_id' IN r.chk) = 0 OR position('successor_id' IN r.chk) = 0 THEN
      RAISE EXCEPTION '0107 post-condition S3 failed: %.% does not check both endpoints', r.tablename, r.policyname;
    END IF;
  END LOOP;

  -- S5: every single-column foreign key between two project-scoped tables
  -- (other than project_id -> projects) is in the guard's map, and its table
  -- carries the guard's trigger.
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.fn_same_project_refs_guard()'::regprocedure;
  SELECT string_agg(format('%s.%s', s.tbl, s.col), ', ' ORDER BY 1)
    INTO v_list
    FROM (
      SELECT c.conrelid::regclass::text AS tbl,
             (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) AS col,
             c.confrelid::regclass::text AS target, c.conrelid
        FROM pg_constraint c
       WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace AND cardinality(c.conkey) = 1
         AND c.confrelid <> 'public.projects'::regclass
         AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attname = 'project_id' AND NOT a.attisdropped)
         AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.confrelid AND a.attname = 'project_id' AND NOT a.attisdropped)
    ) s
   WHERE NOT (position(format('"%s":"%s"', s.col, s.target) IN v_src) > 0
              OR (s.tbl = 'assets' AND s.col = 'task_template_id' AND position('task_template_id' IN v_src) > 0))
      OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = s.conrelid AND NOT tg.tgisinternal
                      AND tg.tgname = 'trg_' || s.tbl || '_same_project_refs');
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION '0107 post-condition S5 failed: these links are not guarded to one project: %', v_list;
  END IF;

  -- The guards' shape: definer, search_path pinned, no client EXECUTE, attached.
  FOR r IN SELECT p.oid, p.proname, p.prosecdef, p.proconfig FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('fn_projects_owner_guard', 'fn_same_project_refs_guard') LOOP
    IF NOT r.prosecdef OR r.proconfig IS NULL OR NOT ('search_path=public' = ANY (r.proconfig)) THEN
      RAISE EXCEPTION '0107 post-condition failed: % must be SECURITY DEFINER with search_path pinned', r.proname;
    END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE') OR has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION '0107 post-condition failed: a client role can EXECUTE %', r.proname;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM pg_trigger WHERE NOT tgisinternal
     AND tgname IN ('trg_projects_owner_guard', 'trg_tasks_same_project_refs', 'trg_assets_same_project_refs',
                    'trg_phases_same_project_refs', 'trg_milestones_same_project_refs', 'trg_shots_same_project_refs',
                    'trg_folders_same_project_refs', 'trg_files_same_project_refs', 'trg_budget_actuals_same_project_refs',
                    'trg_task_dependencies_same_project_refs', 'trg_phase_dependencies_same_project_refs');
  IF v_n <> 11 THEN
    RAISE EXCEPTION '0107 post-condition failed: % of the 11 guard triggers are attached', v_n;
  END IF;
END $$;
