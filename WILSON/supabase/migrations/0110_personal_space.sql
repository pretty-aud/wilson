-- =============================================================================
-- 0110_personal_space.sql — M.O.T.H. Session 1 (MO1), the personal space
-- (docs/design/MOTH_DESIGN.md §1.4 "0110", §1.2 item e, §1.5, §1.6, and §2.2
-- PS-1 to PS-5 and AU-1).
--
-- WHAT IS NEW
-- -----------
-- Each person gets one personal space per company: an ordinary projects row
-- with personal_owner_id set. Being private (0072), it is read by its owner
-- and the workspace's admins only, through every policy that already hops to
-- projects (0107), and the channels never carry it to anyone else (0109). Its
-- writes are its owner's alone, admins included: an admin reaches it from the
-- Files page, read-only, and each time an admin opens someone else's space the
-- database writes an admin line to the company's log (her answer 4).
--
-- WHAT THIS FILE DOES (the deployed bodies were read on wilson-dev with
-- pg_get_functiondef first: 0107's guard, 0013's four policies' and helpers'
-- latest bodies, 0084's can_edit_shot_lists)
-- -------------------------------------------------------------------------
--   §1  projects.personal_owner_id (uuid, no FK: the space outlives its
--       owner's membership and account, for the admins' Files reach), the
--       CHECK projects_personal_shape_chk (a personal row is private and its
--       creator is its owner) and the partial unique index
--       projects_personal_owner_uniq (one per person per company).
--   §2  fn_projects_owner_guard: 0107's body word for word, plus three arms.
--       (a) The personal space: personal_owner_id never changes for a client
--       (it is set at INSERT, by ensure_personal_space, under RLS's
--       projects_insert refusal for everyone else); on a personal row
--       is_private, deleted_at, folder_slug and folder_root never change,
--       admins included (created_by is already pinned). (b) A project id this
--       company has already had cannot be created again by a client while
--       no row holds it: its history, its file events and its comments still
--       name it (the 0108 review's finding, owed here; 0114 adds the
--       other-company arm), judged only for a caller projects_insert would
--       admit, so it is no oracle. (c) A client never changes a project's id.
--   §3  projects_insert and projects_delete: 0013's bodies plus
--       personal_owner_id IS NULL (a client creates no personal row; nobody
--       hard-deletes one). projects_update: 0107's body plus
--       (personal_owner_id IS NULL OR personal_owner_id = auth.uid()).
--   §4  can_write_project, can_comment_project, can_manage_project_roster
--       (0013) and can_edit_shot_lists (0084): the latest body in ELSE, a
--       personal arm in front (PS-5). On a personal row: write, comment and
--       shot lists are the owner's alone; the roster is nobody's. One change
--       reaches every write policy, fn_trash_authz, can_presign_project_write
--       and the office-server catalogue's apply.
--   §5  fn_project_members_personal_guard: a personal space has one seat,
--       its owner's, as manager (fn_projects_auto_staff seats exactly that).
--       AFTER, so it judges only rows RLS let through. DELETE is not guarded
--       (account deletion's cascade still runs).
--   §5b The writes the four helpers do not reach (review round 1): the five
--       money tables and pinned task templates get one INVOKER guard (a
--       client writes nothing into someone else's personal space); the six
--       money storage write clauses gain can_write_project on the path's
--       project. Left as designed (CL-1): set_active_shot_list,
--       archive_shot_list and archive_edit keep their admin and manager legs.
--   §6  ensure_personal_space() and record_personal_space_opened(uuid), two
--       definers owned by a BYPASSRLS role (the 0069 preflight shape).
--   §7  COMMENTs; §8 post-conditions.
--
-- Re-run THIS file after any replay of 0013, 0084 or 0107 (each puts back a
-- body without the personal arm, silently). Its pre-flight accepts 0107's
-- guard (md5 ab21a087…) or its own, so it refuses after 0114 or 0117 restate
-- the guard (re-run 0107, then 0110, then those). One transaction, no enum.
-- The client ships first and is probe-guarded. Suites: 01_projects,
-- 18_project_members, 25_app_events, 80_private_projects, 84_shot_lists and
-- 110_private_project_write_hops (extended).
-- =============================================================================

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
DECLARE
  v_md5 TEXT;
BEGIN
  IF to_regprocedure('public.project_topic_matches(text)') IS NULL
     OR to_regprocedure('public.edit_history_restamp()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'topic_epoch') THEN
    RAISE EXCEPTION '0110 refused: 0107, 0108 and 0109 must be applied first (the personal space relies on their hops, history audience and channels)';
  END IF;
  IF to_regprocedure('public.can_edit_shot_lists(uuid)') IS NULL
     OR to_regprocedure('public.fn_projects_auto_staff()') IS NULL
     OR to_regclass('public.app_events') IS NULL
     OR to_regclass('public.file_events') IS NULL THEN
    RAISE EXCEPTION '0110 refused: can_edit_shot_lists (0084), fn_projects_auto_staff (0020), app_events (0021) or file_events (0027) is missing';
  END IF;
  -- The guard is 0107's body (no later file restated it) or this file's own.
  SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5
    FROM pg_proc WHERE oid = 'public.fn_projects_owner_guard()'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'ab21a08775892a2e564d5e354466e5ed'   -- 0107's body
     AND v_md5 IS DISTINCT FROM 'b6b800f4448eb9723f4afab2e6d97ec0' THEN             -- this file's (§2)
    RAISE EXCEPTION '0110 pre-flight failed: fn_projects_owner_guard is neither 0107''s body nor this file''s (md5 %) — a later migration restated it, and restating it here would take that change back', v_md5;
  END IF;
  -- The two definers of §6 are owned by the role running this file; they
  -- write rows RLS refuses to clients (a personal projects row, an 'admin'
  -- WIL-41xx app_events line), so that role must bypass RLS (0069's lesson).
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0110 refused: % does not bypass row security, so ensure_personal_space and record_personal_space_opened could not write their rows', current_user;
  END IF;
END $$;

-- §1 The column, its shape and one per person -----------------------------------
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS personal_owner_id uuid;

-- NULL-safe: a CHECK passes on NULL, so `created_by = personal_owner_id`
-- alone would admit a personal row with no creator.
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_personal_shape_chk;
ALTER TABLE public.projects ADD CONSTRAINT projects_personal_shape_chk
  CHECK (personal_owner_id IS NULL
         OR (is_private AND created_by IS NOT DISTINCT FROM personal_owner_id));

CREATE UNIQUE INDEX IF NOT EXISTS projects_personal_owner_uniq
  ON public.projects (workspace_id, personal_owner_id)
  WHERE personal_owner_id IS NOT NULL;

-- §2 The one projects guard, with the personal and id-reuse arms ---------------------
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
  v_ws    UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_bound THEN
      NEW.created_by := auth.uid();
      NEW.topic_epoch := 0;
      -- 0110: an id this company has already had, held by no row now. Its
      -- history, file events and comments still name it, and would open to
      -- whoever created it again (the 0108 review). A live row's id still
      -- answers the primary key's 23505, as before. This guard sorts before
      -- trg_projects_populate_workspace, hence the COALESCE. Judged only for a
      -- caller projects_insert would admit in this company (an active admin
      -- or manager): for anyone else RLS answers, so the refusal tells nobody
      -- else that an id was ever used (review round 1).
      v_ws := COALESCE(NEW.workspace_id, public.current_workspace_id());
      IF v_ws = public.current_workspace_id()
         AND public.has_active_membership(v_ws)
         AND public.current_app_role() IN ('admin', 'manager')
         AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = NEW.id)
         AND (EXISTS (SELECT 1 FROM public.edit_history h
                       WHERE h.entity_type = 'projects' AND h.entity_id = NEW.id AND h.workspace_id = v_ws)
              OR EXISTS (SELECT 1 FROM public.file_events fe
                          WHERE fe.project_id = NEW.id AND fe.workspace_id = v_ws)
              OR EXISTS (SELECT 1 FROM public.comments c
                          WHERE c.entity_type = 'project' AND c.entity_id = NEW.id AND c.workspace_id = v_ws)) THEN
        RAISE EXCEPTION 'That project was deleted for good, and its id cannot be used again. Make a new project.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF v_bound THEN
    -- 0110: a project keeps its id. A changed id would take over a deleted
    -- project's leftovers as surely as an INSERT of it (review round 1); no
    -- client flow changes one (0108's re-key trigger serves the service).
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'A project keeps its id.'
        USING ERRCODE = '42501';
    END IF;
    NEW.created_by := OLD.created_by;
    NEW.topic_epoch := OLD.topic_epoch;
    -- 0110: a personal space keeps its owner, stays private, never goes in
    -- the bin and keeps its folder, for every client, admins included.
    IF NEW.personal_owner_id IS DISTINCT FROM OLD.personal_owner_id THEN
      RAISE EXCEPTION 'A personal space keeps its owner.'
        USING ERRCODE = '42501';
    END IF;
    IF OLD.personal_owner_id IS NOT NULL
       AND (NEW.is_private IS DISTINCT FROM OLD.is_private
            OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
            OR NEW.folder_slug IS DISTINCT FROM OLD.folder_slug
            OR NEW.folder_root IS DISTINCT FROM OLD.folder_root) THEN
      RAISE EXCEPTION 'A personal space cannot be shared, put in the bin or moved to another folder. Its files can.'
        USING ERRCODE = '42501';
    END IF;
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

REVOKE EXECUTE ON FUNCTION public.fn_projects_owner_guard() FROM PUBLIC, anon, authenticated;

-- §3 The projects policies ----------------------------------------------------------
DROP POLICY IF EXISTS projects_insert ON public.projects;
CREATE POLICY projects_insert ON public.projects
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.current_app_role() IN ('admin', 'manager')
    AND personal_owner_id IS NULL
  );

DROP POLICY IF EXISTS projects_update ON public.projects;
CREATE POLICY projects_update ON public.projects FOR UPDATE
  USING (workspace_id = public.current_workspace_id()
         AND public.has_active_membership(workspace_id)
         AND public.can_write_project(id)
         AND (NOT is_private OR created_by = auth.uid() OR public.current_app_role() = 'admin')
         AND (personal_owner_id IS NULL OR personal_owner_id = auth.uid()))
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS projects_delete ON public.projects;
CREATE POLICY projects_delete ON public.projects
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.current_app_role() = 'admin'
    AND personal_owner_id IS NULL
  );

-- §4 The four project helpers: the personal arm first (PS-5) -------------------------
CREATE OR REPLACE FUNCTION public.can_write_project(p_project uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
           WHEN (SELECT p.personal_owner_id FROM public.projects p WHERE p.id = p_project) IS NOT NULL
             THEN COALESCE((SELECT p.personal_owner_id = auth.uid() FROM public.projects p WHERE p.id = p_project), false)
           ELSE public.current_app_role() IN ('admin', 'manager')
             OR NOT public.project_is_staffed(p_project)
             OR public.project_role_for(p_project) IN ('manager', 'member')
         END;
$$;

CREATE OR REPLACE FUNCTION public.can_comment_project(p_project uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
           WHEN (SELECT p.personal_owner_id FROM public.projects p WHERE p.id = p_project) IS NOT NULL
             THEN COALESCE((SELECT p.personal_owner_id = auth.uid() FROM public.projects p WHERE p.id = p_project), false)
           ELSE public.current_app_role() IN ('admin', 'manager')
             OR NOT public.project_is_staffed(p_project)
             OR public.project_role_for(p_project) IS NOT NULL
         END;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_project_roster(p_project uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
           WHEN (SELECT p.personal_owner_id FROM public.projects p WHERE p.id = p_project) IS NOT NULL
             THEN false
           ELSE public.current_app_role() IN ('admin', 'manager')
             OR public.project_role_for(p_project) = 'manager'
         END;
$$;

CREATE OR REPLACE FUNCTION public.can_edit_shot_lists(p_project uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
           WHEN (SELECT p.personal_owner_id FROM public.projects p WHERE p.id = p_project) IS NOT NULL
             THEN COALESCE((SELECT p.personal_owner_id = auth.uid() FROM public.projects p WHERE p.id = p_project), false)
           ELSE COALESCE(public.current_app_role() IN ('admin', 'manager'), FALSE)
             OR NOT public.project_is_staffed(p_project)
             OR COALESCE(public.project_role_for(p_project) IN ('manager', 'member', 'reviewer'), FALSE)
         END;
$$;

-- Grants as 0033 and 0084 left them.
REVOKE EXECUTE ON FUNCTION public.can_write_project(uuid)         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_comment_project(uuid)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_project_roster(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_edit_shot_lists(uuid)       FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_write_project(uuid)         TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.can_comment_project(uuid)       TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.can_manage_project_roster(uuid) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.can_edit_shot_lists(uuid)       TO authenticated, service_role;

-- §5 One seat on a personal space --------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_project_members_personal_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
BEGIN
  SELECT p.personal_owner_id INTO v_owner FROM public.projects p WHERE p.id = NEW.project_id;
  IF v_owner IS NOT NULL
     AND (NEW.user_id IS DISTINCT FROM v_owner OR NEW.project_role IS DISTINCT FROM 'manager') THEN
    RAISE EXCEPTION 'A personal space has one seat, its owner''s.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_project_members_personal_guard() FROM PUBLIC, anon, authenticated;

-- AFTER, so it judges only a row that passed RLS: a seat a caller may not write
-- gets RLS's refusal, never this sentence about a project they cannot see
-- (review round 1). Raising here still aborts the statement.
CREATE OR REPLACE TRIGGER trg_project_members_personal_guard
  AFTER INSERT OR UPDATE ON public.project_members
  FOR EACH ROW EXECUTE FUNCTION public.fn_project_members_personal_guard();

-- §5b The writes the four helpers do not reach ----------------------------------------
-- (review round 1) The money tables' writes are gated by can_access_project_money
-- alone, and pinned task templates by can_write_task_template: both admit an
-- admin to a private row, so to a personal space too. One guard on the six
-- tables refuses a client's write into someone else's personal space. INVOKER:
-- the project is read under the caller's own RLS, so a project they cannot see
-- is left to the policies (no oracle).
CREATE OR REPLACE FUNCTION public.fn_personal_space_write_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_pid   UUID;
BEGIN
  IF COALESCE(current_setting('role', true), '') NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  FOREACH v_pid IN ARRAY ARRAY[(to_jsonb(NEW) ->> 'project_id')::uuid, (to_jsonb(OLD) ->> 'project_id')::uuid] LOOP
    CONTINUE WHEN v_pid IS NULL;
    SELECT p.personal_owner_id INTO v_owner FROM public.projects p WHERE p.id = v_pid;
    IF v_owner IS NOT NULL AND v_owner IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Only the owner of a personal space can change it.'
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_personal_space_write_guard() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_t TEXT;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['budget_versions', 'budget_lines', 'budget_actuals', 'expenses',
                             'project_rate_overrides', 'task_templates'] LOOP
    EXECUTE format('CREATE OR REPLACE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.fn_personal_space_write_guard()',
                   'trg_' || v_t || '_personal_write', v_t);
  END LOOP;
END $$;

-- The money storage writes (0092's eight policies; the four SELECTs untouched):
-- 0092's gate word for word, AND can_write_project on the path's project, which
-- narrows only a personal space (on any other project money or Legal access
-- already implies it).
DROP POLICY IF EXISTS rabbit_files_money_insert ON storage.objects;
CREATE POLICY rabbit_files_money_insert ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'rabbit-files' AND auth.role() = 'authenticated'
              AND (storage.foldername(name))[1] = 'projects'
              AND public.rabbit_money_segment((storage.foldername(name))[3])
              AND (public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
                   OR (public.rabbit_legal_segment((storage.foldername(name))[3])
                       AND public.can_access_project_legal(public.fn_try_uuid((storage.foldername(name))[2]))))
              AND public.can_write_project(public.fn_try_uuid((storage.foldername(name))[2])));
DROP POLICY IF EXISTS rabbit_files_money_update ON storage.objects;
CREATE POLICY rabbit_files_money_update ON storage.objects FOR UPDATE
  USING (bucket_id = 'rabbit-files' AND auth.role() = 'authenticated'
         AND (storage.foldername(name))[1] = 'projects'
         AND public.rabbit_money_segment((storage.foldername(name))[3])
         AND (public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
              OR (public.rabbit_legal_segment((storage.foldername(name))[3])
                  AND public.can_access_project_legal(public.fn_try_uuid((storage.foldername(name))[2]))))
         AND public.can_write_project(public.fn_try_uuid((storage.foldername(name))[2])))
  WITH CHECK (bucket_id = 'rabbit-files' AND auth.role() = 'authenticated'
              AND (storage.foldername(name))[1] = 'projects'
              AND public.rabbit_money_segment((storage.foldername(name))[3])
              AND (public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
                   OR (public.rabbit_legal_segment((storage.foldername(name))[3])
                       AND public.can_access_project_legal(public.fn_try_uuid((storage.foldername(name))[2]))))
              AND public.can_write_project(public.fn_try_uuid((storage.foldername(name))[2])));
DROP POLICY IF EXISTS rabbit_files_money_delete ON storage.objects;
CREATE POLICY rabbit_files_money_delete ON storage.objects FOR DELETE
  USING (bucket_id = 'rabbit-files' AND auth.role() = 'authenticated'
         AND (storage.foldername(name))[1] = 'projects'
         AND public.rabbit_money_segment((storage.foldername(name))[3])
         AND (public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
              OR (public.rabbit_legal_segment((storage.foldername(name))[3])
                  AND public.can_access_project_legal(public.fn_try_uuid((storage.foldername(name))[2]))))
         AND public.can_write_project(public.fn_try_uuid((storage.foldername(name))[2])));
DROP POLICY IF EXISTS rabbit_thumbnails_money_insert ON storage.objects;
CREATE POLICY rabbit_thumbnails_money_insert ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'rabbit-thumbnails' AND auth.role() = 'authenticated'
              AND (storage.foldername(name))[1] = 'projects'
              AND public.rabbit_money_segment((storage.foldername(name))[3])
              AND (public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
                   OR (public.rabbit_legal_segment((storage.foldername(name))[3])
                       AND public.can_access_project_legal(public.fn_try_uuid((storage.foldername(name))[2]))))
              AND public.can_write_project(public.fn_try_uuid((storage.foldername(name))[2])));
DROP POLICY IF EXISTS rabbit_thumbnails_money_update ON storage.objects;
CREATE POLICY rabbit_thumbnails_money_update ON storage.objects FOR UPDATE
  USING (bucket_id = 'rabbit-thumbnails' AND auth.role() = 'authenticated'
         AND (storage.foldername(name))[1] = 'projects'
         AND public.rabbit_money_segment((storage.foldername(name))[3])
         AND (public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
              OR (public.rabbit_legal_segment((storage.foldername(name))[3])
                  AND public.can_access_project_legal(public.fn_try_uuid((storage.foldername(name))[2]))))
         AND public.can_write_project(public.fn_try_uuid((storage.foldername(name))[2])))
  WITH CHECK (bucket_id = 'rabbit-thumbnails' AND auth.role() = 'authenticated'
              AND (storage.foldername(name))[1] = 'projects'
              AND public.rabbit_money_segment((storage.foldername(name))[3])
              AND (public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
                   OR (public.rabbit_legal_segment((storage.foldername(name))[3])
                       AND public.can_access_project_legal(public.fn_try_uuid((storage.foldername(name))[2]))))
              AND public.can_write_project(public.fn_try_uuid((storage.foldername(name))[2])));
DROP POLICY IF EXISTS rabbit_thumbnails_money_delete ON storage.objects;
CREATE POLICY rabbit_thumbnails_money_delete ON storage.objects FOR DELETE
  USING (bucket_id = 'rabbit-thumbnails' AND auth.role() = 'authenticated'
         AND (storage.foldername(name))[1] = 'projects'
         AND public.rabbit_money_segment((storage.foldername(name))[3])
         AND (public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
              OR (public.rabbit_legal_segment((storage.foldername(name))[3])
                  AND public.can_access_project_legal(public.fn_try_uuid((storage.foldername(name))[2]))))
         AND public.can_write_project(public.fn_try_uuid((storage.foldername(name))[2])));

-- §6 Provisioning and the admin's record ------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_personal_space()
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_ws  UUID := public.current_workspace_id();
  v_id  UUID;
BEGIN
  IF v_uid IS NULL OR v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RAISE EXCEPTION 'A personal space needs a signed-in, active member of a company.'
      USING ERRCODE = '42501';
  END IF;
  SELECT p.id INTO v_id FROM public.projects p
   WHERE p.workspace_id = v_ws AND p.personal_owner_id = v_uid;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  -- No folder_slug (§1.2 item e: the office-server folder is computed, never
  -- stored here). The owner guard pins created_by to the caller; the auto
  -- staffing seats the owner as manager, the one seat §5 allows.
  INSERT INTO public.projects (workspace_id, title, is_private, personal_owner_id, created_by)
  VALUES (v_ws, 'Personal space', true, v_uid, v_uid)
  ON CONFLICT (workspace_id, personal_owner_id) WHERE personal_owner_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    -- A racing call made it first: READ COMMITTED sees the winner's row.
    SELECT p.id INTO v_id FROM public.projects p
     WHERE p.workspace_id = v_ws AND p.personal_owner_id = v_uid;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_personal_space() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ensure_personal_space() TO authenticated;

CREATE OR REPLACE FUNCTION public.record_personal_space_opened(p_project uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_ws    UUID := public.current_workspace_id();
  v_owner UUID;
BEGIN
  SELECT p.personal_owner_id INTO v_owner FROM public.projects p
   WHERE p.id = p_project AND p.workspace_id = v_ws AND p.personal_owner_id IS NOT NULL;
  IF v_uid IS NULL OR v_ws IS NULL OR NOT public.has_active_membership(v_ws)
     OR public.current_app_role() IS DISTINCT FROM 'admin'
     OR v_owner IS NULL OR v_owner = v_uid THEN
    RAISE EXCEPTION 'Only an admin opening someone else''s personal space is recorded.'
      USING ERRCODE = '42501';
  END IF;
  -- Ids only (TPN): who opened whose space is the record, never its contents.
  INSERT INTO public.app_events (workspace_id, actor_user_id, event_type, code, severity, message, context)
  VALUES (v_ws, v_uid, 'admin', 'WIL-4114', 'info',
          'An admin opened someone else''s personal space in Files',
          jsonb_build_object('project_id', p_project, 'owner_user_id', v_owner));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_personal_space_opened(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.record_personal_space_opened(uuid) TO authenticated;

-- §7 COMMENTs ------------------------------------------------------------------------
COMMENT ON COLUMN public.projects.personal_owner_id IS
  '0110 (MO1): set on a personal space only, to its owner (no FK: the space outlives the membership and the account, for the admins'' reach). Written by ensure_personal_space at INSERT and never changed (fn_projects_owner_guard). Owner-only in Moth; the owner plus the workspace''s admins, read-only, in Files.';
COMMENT ON FUNCTION public.fn_projects_owner_guard() IS
  '0107; 0110 (MO1): the one projects guard. For client callers: created_by and topic_epoch pinned; is_private changed only by the creator or an admin; producer_id chosen only with can_manage_project_roster; personal_owner_id never changed, and a personal row''s is_private, deleted_at, folder_slug and folder_root never changed, admins included; a project id this company has had, held by no row, not created again. For every caller: a narrowing bumps topic_epoch.';
COMMENT ON FUNCTION public.can_write_project(uuid) IS
  '0013; 0110 (MO1): on a personal space, its owner only; otherwise app admin/manager, OR project unstaffed, OR project_role manager/member. Used by every project-scoped entity write policy, fn_trash_authz and can_presign_project_write. Client mirror: project.entity.write in src/permissions/projectRoleMatrix.js (the LOCKSTEP invariant).';
COMMENT ON FUNCTION public.can_comment_project(uuid) IS
  '0013; 0110 (MO1): on a personal space, its owner only; otherwise app admin/manager, OR project unstaffed, OR any project seat. Client mirror: project.comment.write in src/permissions/projectRoleMatrix.js (the LOCKSTEP invariant).';
COMMENT ON FUNCTION public.can_manage_project_roster(uuid) IS
  '0013; 0110 (MO1): on a personal space, nobody (its one seat is its owner''s, fn_project_members_personal_guard); otherwise app admin/manager, OR project_role manager. Client mirror: project.roster.manage in src/permissions/projectRoleMatrix.js (the LOCKSTEP invariant).';
COMMENT ON FUNCTION public.can_edit_shot_lists(uuid) IS
  '0084 (D8, Audrey 2026-09-29); 0110 (MO1): on a personal space, its owner only. Otherwise who may create and edit shot lists, their membership and edits — workspace admin/manager, anyone on an UNSTAFFED project, or a project manager, member OR REVIEWER. can_write_project (0013) plus the reviewer seat. NEVER reuse it for scenes, shots, tasks, assets or budgets: those columns are shared by every list and keep can_write_project / the money gate. Client mirror: project.shotlist.write in src/permissions/projectRoleMatrix.js (the LOCKSTEP invariant).';
COMMENT ON FUNCTION public.fn_project_members_personal_guard() IS
  '0110 (MO1): a personal space has one seat, its owner''s, as manager (what fn_projects_auto_staff seats at ensure_personal_space). Any other seat, by any caller, is refused (42501): fn_projects_auto_staff swallows the refusal of a producer seat as a WARNING. DELETE is not guarded.';
COMMENT ON FUNCTION public.ensure_personal_space() IS
  '0110 (MO1): the caller''s personal space in this company, made on first call (title ''Personal space'', private, personal_owner_id = created_by = the caller, no folder_slug) and returned on every later one; a racing call re-reads the winner. 42501 without a signed-in active member. SECURITY DEFINER owned by a BYPASSRLS role: projects_insert refuses a personal row to every client.';
COMMENT ON FUNCTION public.record_personal_space_opened(uuid) IS
  '0110 (MO1, her answer 4): an admin opening someone else''s personal space in Files writes app_events (''admin'', WIL-4114, context {project_id, owner_user_id}), which other admins see in Logs. One 42501 for everything else (not an admin, the admin''s own space, not a personal space, another company). app_events_insert refuses ''admin'' and WIL-41xx to clients, so only this definer mints the line.';

-- §8 Post-conditions --------------------------------------------------------------------
DO $$
DECLARE
  v_b TEXT;
  v_t TEXT;
  v_n INTEGER;
BEGIN
  -- 1. The column, the CHECK (both arms, NULL-safe) and the partial unique index.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'personal_owner_id'
                    AND data_type = 'uuid' AND is_nullable = 'YES') THEN
    RAISE EXCEPTION '0110 post-condition 1 failed: projects.personal_owner_id is missing or mis-shaped';
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_b FROM pg_constraint
   WHERE conrelid = 'public.projects'::regclass AND conname = 'projects_personal_shape_chk';
  IF v_b IS NULL OR strpos(v_b, 'personal_owner_id IS NULL') = 0 OR strpos(v_b, 'is_private') = 0
     OR strpos(v_b, 'NOT (created_by IS DISTINCT FROM personal_owner_id)') = 0 THEN
    RAISE EXCEPTION '0110 post-condition 1 failed: projects_personal_shape_chk reads %', v_b;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                  WHERE c.relname = 'projects_personal_owner_uniq' AND i.indrelid = 'public.projects'::regclass
                    AND i.indisunique AND i.indpred IS NOT NULL) THEN
    RAISE EXCEPTION '0110 post-condition 1 failed: projects_personal_owner_uniq is not a unique partial index';
  END IF;

  -- 2. The guard: this file's body (the pre-flight's md5), every 0107 arm and
  --    both 0110 arms; the trigger BEFORE ROW INSERT OR UPDATE; no client runs it.
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc
       WHERE oid = 'public.fn_projects_owner_guard()'::regprocedure) IS DISTINCT FROM 'b6b800f4448eb9723f4afab2e6d97ec0' THEN
    RAISE EXCEPTION '0110 post-condition 2 failed: §2''s body is not the one §0 names (update §0''s md5)';
  END IF;
  SELECT regexp_replace(regexp_replace(prosrc, '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g') INTO v_b
    FROM pg_proc WHERE oid = 'public.fn_projects_owner_guard()'::regprocedure;
  FOREACH v_t IN ARRAY ARRAY['NEW.created_by := OLD.created_by', 'NEW.topic_epoch := OLD.topic_epoch + 1',
                             'can_manage_project_roster(OLD.id)', 'current_setting(''role'', true)',
                             'NEW.personal_owner_id IS DISTINCT FROM OLD.personal_owner_id',
                             'OLD.personal_owner_id IS NOT NULL', 'NEW.deleted_at IS DISTINCT FROM OLD.deleted_at',
                             'NEW.folder_slug IS DISTINCT FROM OLD.folder_slug', 'NEW.folder_root IS DISTINCT FROM OLD.folder_root',
                             'public.edit_history h', 'public.file_events fe', 'public.comments c',
                             'NEW.id IS DISTINCT FROM OLD.id'] LOOP
    IF strpos(v_b, v_t) = 0 THEN
      RAISE EXCEPTION '0110 post-condition 2 failed: the owner guard lost "%"', v_t;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.projects'::regclass AND tgname = 'trg_projects_owner_guard'
                    AND tgfoid = 'public.fn_projects_owner_guard()'::regprocedure AND tgenabled <> 'D'
                    AND (tgtype & 1) = 1 AND (tgtype & 2) = 2 AND (tgtype & 4) = 4 AND (tgtype & 16) = 16) THEN
    RAISE EXCEPTION '0110 post-condition 2 failed: trg_projects_owner_guard is not BEFORE ROW INSERT OR UPDATE';
  END IF;

  -- 3. The policies: every earlier arm and the personal one.
  SELECT with_check INTO v_b FROM pg_policies WHERE schemaname = 'public' AND tablename = 'projects' AND policyname = 'projects_insert';
  IF v_b IS NULL OR strpos(v_b, 'current_workspace_id()') = 0 OR strpos(v_b, 'has_active_membership(workspace_id)') = 0
     OR strpos(v_b, 'manager') = 0 OR strpos(v_b, 'personal_owner_id IS NULL') = 0 THEN
    RAISE EXCEPTION '0110 post-condition 3 failed: projects_insert reads %', v_b;
  END IF;
  SELECT qual INTO v_b FROM pg_policies WHERE schemaname = 'public' AND tablename = 'projects' AND policyname = 'projects_delete';
  IF v_b IS NULL OR strpos(v_b, 'current_workspace_id()') = 0 OR strpos(v_b, 'has_active_membership(workspace_id)') = 0
     OR strpos(v_b, '''admin''') = 0 OR strpos(v_b, 'personal_owner_id IS NULL') = 0 THEN
    RAISE EXCEPTION '0110 post-condition 3 failed: projects_delete reads %', v_b;
  END IF;
  SELECT qual INTO v_b FROM pg_policies WHERE schemaname = 'public' AND tablename = 'projects' AND policyname = 'projects_update';
  IF v_b IS NULL OR strpos(v_b, 'can_write_project(id)') = 0 OR strpos(v_b, 'is_private') = 0
     OR strpos(v_b, 'created_by = auth.uid()') = 0 OR strpos(v_b, 'personal_owner_id = auth.uid()') = 0 THEN
    RAISE EXCEPTION '0110 post-condition 3 failed: projects_update reads %', v_b;
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'projects';
  IF v_n <> 4 THEN
    RAISE EXCEPTION '0110 post-condition 3 failed: projects has % policies, not its four', v_n;
  END IF;

  -- 4. The helpers: the personal arm in front of the latest body; grants.
  FOR v_t IN SELECT unnest(ARRAY['can_write_project', 'can_comment_project', 'can_manage_project_roster', 'can_edit_shot_lists']) LOOP
    SELECT btrim(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_b
      FROM pg_proc WHERE oid = ('public.' || v_t || '(uuid)')::regprocedure AND prosecdef AND provolatile = 's'
                     AND proconfig @> ARRAY['search_path=public'];
    IF v_b IS NULL OR strpos(v_b, 'personal_owner_id FROM public.projects p WHERE p.id = p_project) IS NOT NULL') = 0
       OR (v_t = 'can_manage_project_roster' AND strpos(v_b, 'THEN false ELSE') = 0)
       OR (v_t <> 'can_manage_project_roster' AND strpos(v_b, 'p.personal_owner_id = auth.uid()') = 0)
       OR strpos(v_b, 'project_role_for(p_project)') = 0
       OR NOT has_function_privilege('authenticated', 'public.' || v_t || '(uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.' || v_t || '(uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION '0110 post-condition 4 failed: % lacks its personal arm, its 0013/0084 body, its shape or its grants', v_t;
    END IF;
  END LOOP;

  -- 5. The seat guard.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.project_members'::regclass AND tgname = 'trg_project_members_personal_guard'
                    AND tgfoid = 'public.fn_project_members_personal_guard()'::regprocedure AND tgenabled <> 'D'
                    AND (tgtype & 1) = 1 AND (tgtype & 2) = 0 AND (tgtype & 4) = 4 AND (tgtype & 16) = 16 AND (tgtype & 8) = 0) THEN
    RAISE EXCEPTION '0110 post-condition 5 failed: trg_project_members_personal_guard is not AFTER ROW INSERT OR UPDATE (and not DELETE)';
  END IF;

  -- 5b. The personal write guard on the six tables the helpers do not reach,
  --     INVOKER and no client's; the six money storage write clauses carry the
  --     write gate, the four SELECTs do not.
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE NOT tgisinternal AND tgenabled <> 'D'
     AND tgfoid = 'public.fn_personal_space_write_guard()'::regprocedure
     AND (tgtype & 1) = 1 AND (tgtype & 2) = 2 AND (tgtype & 4) = 4 AND (tgtype & 8) = 8 AND (tgtype & 16) = 16
     AND tgrelid IN ('public.budget_versions'::regclass, 'public.budget_lines'::regclass, 'public.budget_actuals'::regclass,
                     'public.expenses'::regclass, 'public.project_rate_overrides'::regclass, 'public.task_templates'::regclass);
  IF v_n <> 6 OR (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_personal_space_write_guard()'::regprocedure)
     OR has_function_privilege('authenticated', 'public.fn_personal_space_write_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION '0110 post-condition 5b failed: fn_personal_space_write_guard is on % of its six tables, or is a definer, or a client may run it', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM (
    SELECT policyname, unnest(ARRAY[qual, with_check]) AS clause FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname IN ('rabbit_files_money_insert', 'rabbit_files_money_update', 'rabbit_files_money_delete',
                          'rabbit_thumbnails_money_insert', 'rabbit_thumbnails_money_update', 'rabbit_thumbnails_money_delete')) c
   WHERE clause IS NOT NULL
     AND strpos(clause, 'can_write_project(fn_try_uuid((storage.foldername(name))[2]))') > 0
     AND strpos(clause, 'rabbit_money_segment((storage.foldername(name))[3])') > 0
     AND strpos(clause, 'can_access_project_legal(fn_try_uuid((storage.foldername(name))[2]))') > 0;
  IF v_n <> 8 THEN
    RAISE EXCEPTION '0110 post-condition 5b failed: % of the eight money storage write clauses carry the write gate with 0092''s', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
              AND policyname IN ('rabbit_files_money_select', 'rabbit_thumbnails_money_select')
              AND strpos(qual, 'can_write_project') > 0) THEN
    RAISE EXCEPTION '0110 post-condition 5b failed: a money storage SELECT gained the write gate (admins read a personal space''s money read-only)';
  END IF;

  -- 6. The two RPCs: definers owned by a BYPASSRLS role, search_path pinned,
  --    for authenticated and never anon; the guards are no client's.
  FOR v_t IN SELECT unnest(ARRAY['ensure_personal_space()', 'record_personal_space_opened(uuid)']) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
                    WHERE p.oid = ('public.' || v_t)::regprocedure AND p.prosecdef AND r.rolbypassrls
                      AND p.proconfig @> ARRAY['search_path=public'])
       OR NOT has_function_privilege('authenticated', 'public.' || v_t, 'EXECUTE')
       OR has_function_privilege('anon', 'public.' || v_t, 'EXECUTE') THEN
      RAISE EXCEPTION '0110 post-condition 6 failed: % is not a BYPASSRLS-owned definer for authenticated only', v_t;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'public.fn_projects_owner_guard()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_project_members_personal_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION '0110 post-condition 6 failed: a client may run a guard';
  END IF;

  -- 7. app_events_insert still reserves the admin stream and WIL-41 (only the
  --    definer above can write WIL-4114).
  SELECT with_check INTO v_b FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_events' AND policyname = 'app_events_insert';
  IF v_b IS NULL OR strpos(v_b, 'event_type <> ''admin''') = 0 OR strpos(v_b, 'WIL-41') = 0 THEN
    RAISE EXCEPTION '0110 post-condition 7 failed: app_events_insert no longer reserves the admin stream and WIL-41 (reads %)', v_b;
  END IF;
END $$;

DO $$ BEGIN
  RAISE NOTICE '0110 OK: personal spaces (one per person per company, private, owner-only writes, one seat); the owner guard keeps them and refuses a used project id; ensure_personal_space and record_personal_space_opened';
END $$;
