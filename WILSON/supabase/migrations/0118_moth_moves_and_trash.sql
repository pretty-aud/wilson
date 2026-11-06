-- =============================================================================
-- 0118_moth_moves_and_trash.sql — M.O.T.H. Session 1 (MO1), moving a file, undoing
-- the move, and Moth's trash (docs/design/MOTH_DESIGN.md §1.4 "0118", §1.5, §1.6,
-- §2.3 MV-1 to MV-10, and the two refusals SB-11 and SB-12 of §2.1).
--
-- WHAT IS NEW
-- -----------
-- A move has one contract. The server plans it and says how each file goes; the
-- caller makes any fresh copy the plan asks for; the commit judges everything again,
-- writes the journal (0113), and changes each row in one UPDATE under a marker bound
-- to that journal row. Nothing else admits a change of a file's project (0114's guard).
--
--   §1  Helpers, closed to clients: the destination's test, the order of the locks,
--       what a key's last part may say, which links still have somewhere to point,
--       and an office-server file's way back to the exact place it came from.
--   §2  fn_moth_apply_moves, the core: every check before any write. Closed to clients.
--   §3  moth_move_items and moth_undo_move. Redo is the undo of the undo.
--   §4  _network_share_replay_origin gets its real body (0117 left a stub), and
--       network_share_settle, lifted from 0117 whole, locks both projects first.
--   §5  moth_trash_files, moth_restore_files, moth_trash_index.
--   §6  COMMENTs; §7 post-conditions.
--
-- One transaction, no enum, no table, no lock on a table. Re-runnable. Suites
-- 119_moth_moves.sql and 120_moth_trash.sql; pins moved in 115 and 118.
--
-- What it rests on and does not restate: fn_files_body_guard (0114), the capture and the
-- broadcast (0116), the cores and the journal of operations (0117), purge_soft_deleted and
-- fn_projects_owner_guard as 0117 left them. Their bodies are read in the pre-flight, because
-- each of these functions would go wrong quietly if one of them had changed.
-- =============================================================================

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
DECLARE
  v_md5 TEXT;
  v_fn  RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'personal_owner_id') THEN
    RAISE EXCEPTION '0118 refused: projects.personal_owner_id is missing; 0110 must be applied first';
  END IF;
  IF to_regprocedure('public._moth_target_eligible(text,uuid,boolean)') IS NULL
     OR to_regprocedure('public.moth_can_write_target(text,uuid)') IS NULL THEN
    RAISE EXCEPTION '0118 refused: 0111''s read path must be applied first';
  END IF;
  IF to_regprocedure('public.fn_checked_move_admits(uuid,uuid,uuid,text,text)') IS NULL
     OR to_regclass('public.file_moves') IS NULL THEN
    RAISE EXCEPTION '0118 refused: 0113''s journal must be applied first';
  END IF;
  IF to_regprocedure('rabbit_private.file_key_admissible(text,text,uuid,uuid,uuid,boolean)') IS NULL
     OR to_regprocedure('rabbit_private.files_body_follow(uuid,uuid,jsonb)') IS NULL
     OR to_regprocedure('rabbit_private.files_body_retire(uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION '0118 refused: 0114''s body contract must be applied first';
  END IF;
  -- A stored copy must follow its row before a row may move (SEC-MV-01): a function merely
  -- existing is not enough, so this reads the four base policies.
  IF (SELECT count(*) FROM pg_policy
       WHERE polrelid = 'storage.objects'::regclass
         AND polname IN ('rabbit_files_select', 'rabbit_files_insert', 'rabbit_files_update', 'rabbit_files_delete_own')
         AND (pg_get_expr(polqual, polrelid) LIKE '%storage_object_current_project%'
              OR pg_get_expr(polwithcheck, polrelid) LIKE '%storage_object_current_project%')) <> 4 THEN
    RAISE EXCEPTION '0118 refused: the four base rabbit_files policies do not all follow the row; 0115 must be applied first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
                   JOIN pg_type t ON t.oid = e.enumtypid
                   JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'public' AND t.typname = 'storage_provider' AND e.enumlabel = 'network_share') THEN
    RAISE EXCEPTION '0118 refused: storage_provider has no network_share label; 0112 must be applied and committed first';
  END IF;
  IF to_regprocedure('public.network_share_space_folder(uuid)') IS NULL
     OR to_regprocedure('public.network_share_locator_ok(text)') IS NULL
     OR to_regclass('public.network_share_ops') IS NULL THEN
    RAISE EXCEPTION '0118 refused: 0117''s catalogue must be applied first';
  END IF;
  IF position('fn_checked_move_admits' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_files_body_guard()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '0118 refused: fn_files_body_guard does not ask fn_checked_move_admits';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'edit_history'
                    AND policyname = 'edit_history_select' AND qual LIKE '%captured_private%') THEN
    RAISE EXCEPTION '0118 refused: 0108''s edit_history privacy arm is not live, and a move writes history';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'public.file_events'::regclass AND conname = 'file_events_event_check') NOT LIKE '%moved_out%refiled%' THEN
    RAISE EXCEPTION '0118 refused: file_events lacks 0116''s moved_out, moved_in and refiled';
  END IF;
  -- The definers below read and write tables with row security forced (0069's lesson).
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0118 refused: % does not bypass row security', current_user;
  END IF;

  -- What this file rests on is what it was read from. The two it restates may be its own.
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('public.fn_files_body_guard()', '41f85b1e0054ed178b314c09cb316d84', NULL),
      ('public.fn_file_events_capture()', '8d0f8dbbc83b7efbbf5bd3d63f71b453', NULL),
      ('public.fn_realtime_broadcast()', '34686e6bbb9ba89ecf012e003856e6da', NULL),
      ('public._moth_target_eligible(text,uuid,boolean)', '06ce9d801842872e467b9dcc119cb063', NULL),
      ('rabbit_private.files_body_follow(uuid,uuid,jsonb)', '7fbcada9dbca2acb598c44931fa4824e', NULL),
      ('rabbit_private.files_body_retire(uuid,jsonb)', 'eecde66585b4ac924c660e9b8bfe627a', NULL),
      ('public.soft_delete_row(text,uuid)', '09d142cbea2762a6f23201005c0ca8f0', NULL),
      ('public.restore_soft_deleted(text,uuid)', '6d8cb3aa32277e7770f76e7e270e6c46', NULL),
      ('public.fn_trash_authz(text,uuid)', 'ccd7f61f4a860b9382744fd9d52c3166', NULL),
      ('public._network_share_target(uuid,uuid,uuid,text,uuid)', '29b78dcb712422327aacb2eaf7c5bbaa', NULL),
      ('public._network_share_move_core(uuid,uuid,uuid,jsonb,boolean)', 'a445156e8bcb7fecbd973110e6b5d05d', NULL),
      ('public._network_share_adopt_core(uuid,uuid,uuid,jsonb,boolean)', '982c2e07510d0880a439bcf17b7e528f', NULL),
      ('public.network_share_settle(uuid[],text,jsonb)', '56e6fac18cb0135559dd05c180e316db', '83aa3ac83d5693de5bba14edd4f78f1b'),
      ('public._network_share_replay_origin(uuid)', '5d39b9c730c8f04132a938f24e2c70c6', 'cd580dd4741f8177ecba7df790d18cd6')
    ) AS t(sig, was, mine)
  LOOP
    SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc WHERE oid = v_fn.sig::regprocedure;
    IF v_md5 IS DISTINCT FROM v_fn.was AND v_md5 IS DISTINCT FROM v_fn.mine THEN
      RAISE EXCEPTION '0118 refused: % is not the body this file was built on (md5 %)', v_fn.sig, v_md5;
    END IF;
  END LOOP;
END $$;

-- §1 Helpers --------------------------------------------------------------------------------
-- A destination: its project, and a folder that is that project's and not a locked one. Missing
-- and hidden read the same to every caller (SEC-MV-12).
CREATE OR REPLACE FUNCTION public._moth_dest_eligible(p_project uuid, p_folder uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  IF NOT public._moth_target_eligible('project', p_project, false) THEN
    RETURN false;
  END IF;
  IF p_folder IS NULL THEN
    RETURN true;
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.folders fo WHERE fo.id = p_folder AND fo.project_id = p_project)
     AND public._moth_target_eligible('folder', p_folder, false);
END;
$$;
REVOKE ALL ON FUNCTION public._moth_dest_eligible(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- The one order of the locks. Advisory first: a walk of the office-server folder holds its project's
-- advisory lock while it takes file rows, so a file row taken first deadlocks against it (0117).
-- Then the rows, each kind in id order. The project rows are shared, so neither end can go to the
-- trash under the move, and the folder rows, so a destination cannot be deleted under it.
CREATE OR REPLACE FUNCTION public._moth_lock_moves(p_projects uuid[], p_folders uuid[], p_files uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  PERFORM public._network_share_lock_projects(p_projects);
  PERFORM 1 FROM public.projects p WHERE p.id = ANY (p_projects) ORDER BY p.id FOR SHARE;
  PERFORM 1 FROM public.folders fo WHERE fo.id = ANY (p_folders) ORDER BY fo.id FOR SHARE;
  PERFORM 1 FROM public.files f WHERE f.id = ANY (p_files) ORDER BY f.id FOR UPDATE;
END;
$$;
REVOKE ALL ON FUNCTION public._moth_lock_moves(uuid[], uuid[], uuid[]) FROM PUBLIC, anon, authenticated;

-- The name part of a key the server mints: a fresh key under the destination carries no origin id
-- and no character a key cannot hold (MV-3). The tail is kept because the extension is at the end.
CREATE OR REPLACE FUNCTION public._moth_key_leaf(p_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text := right(regexp_replace(COALESCE(p_name, ''), '[^A-Za-z0-9._-]', '_', 'g'), 120);
BEGIN
  RETURN CASE WHEN v = '' THEN 'file' ELSE v END;
END;
$$;
REVOKE ALL ON FUNCTION public._moth_key_leaf(text) FROM PUBLIC, anon, authenticated;

-- The seven links as an object. Given what a file was linked to, those whose row is still in this
-- project (MV-6); given nothing, all seven empty, which is what a move between projects does (MV-4).
CREATE OR REPLACE FUNCTION public._moth_links_alive(p_links jsonb, p_project uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_out jsonb := '{}'::jsonb;
  v     record;
  v_id  uuid;
  v_hit boolean;
BEGIN
  FOR v IN SELECT * FROM (VALUES
    ('phase_id', 'phases'), ('asset_id', 'assets'), ('task_id', 'tasks'), ('scene_id', 'scenes'),
    ('shot_id', 'shots'), ('level_id', 'levels'), ('experience_id', 'experiences')) AS t(col, tbl)
  LOOP
    v_id := (p_links ->> v.col)::uuid;
    v_hit := false;
    IF v_id IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I x WHERE x.id = $1 AND x.project_id = $2)', v.tbl)
        INTO v_hit USING v_id, p_project;
    END IF;
    v_out := v_out || jsonb_build_object(v.col, CASE WHEN v_hit THEN v_id END);
  END LOOP;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public._moth_links_alive(jsonb, uuid) FROM PUBLIC, anon, authenticated;

-- An undo sends an office-server file to the exact place it left, which _network_share_move_core
-- cannot: that names a place from the destination folder's path and the leaf, and a walk files a
-- row in a subdirectory with no folder row. Otherwise the same questions, the same journal.
CREATE OR REPLACE FUNCTION public._moth_share_back(
  p_file uuid, p_dest_project uuid, p_to text, p_origin jsonb, p_write boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  r      record;
  v_from text;
  v_src  text;
  v_dst  text;
  v_op   uuid;
BEGIN
  SELECT f.id, f.workspace_id, f.project_id, f.storage_path INTO r FROM public.files f WHERE f.id = p_file;
  IF public._network_share_drive(r.workspace_id) IS NULL THEN
    RAISE EXCEPTION 'network_share: drive_changed';
  END IF;
  v_from := substr(r.storage_path, 5);
  v_src := public.network_share_space_folder(r.project_id);
  v_dst := public.network_share_space_folder(p_dest_project);
  IF v_src IS NULL OR v_dst IS NULL
     OR NOT starts_with(lower(v_from), lower(v_src) || '/')
     OR NOT starts_with(lower(COALESCE(p_to, '')), lower(v_dst) || '/')
     OR NOT public.network_share_locator_ok(p_to) THEN
    RAISE EXCEPTION 'network_share: no_folder';
  END IF;
  PERFORM public._network_share_assert_folder(r.workspace_id, r.project_id, v_src);
  PERFORM public._network_share_assert_folder(r.workspace_id, p_dest_project, v_dst);
  IF EXISTS (SELECT 1 FROM public.files h
              WHERE h.workspace_id = r.workspace_id
                AND h.storage_provider = 'network_share'
                AND h.deleted_at IS NULL
                AND lower(h.storage_path) = 'nas:' || lower(p_to)
                AND h.id <> p_file)
     OR EXISTS (SELECT 1 FROM public.network_share_ops o
                 WHERE o.workspace_id = r.workspace_id AND o.state = 'pending'
                   AND (lower(o.to_locator) = lower(p_to) OR lower(o.from_locator) = lower(p_to))) THEN
    RAISE EXCEPTION 'network_share: occupied';
  END IF;
  IF NOT COALESCE(p_write, false) THEN
    RETURN jsonb_build_object('id', p_file, 'from', v_from, 'to', p_to);
  END IF;
  INSERT INTO public.network_share_ops
    (workspace_id, file_id, project_id, dest_project_id, op, from_locator, to_locator, origin, created_by)
  VALUES
    (r.workspace_id, p_file, r.project_id, p_dest_project, 'move', v_from, p_to, COALESCE(p_origin, '{}'::jsonb), auth.uid())
  RETURNING id INTO v_op;
  RETURN jsonb_build_object('op_id', v_op, 'id', p_file, 'from', v_from, 'to', p_to);
END;
$$;
REVOKE ALL ON FUNCTION public._moth_share_back(uuid, uuid, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;

-- §2 The core -------------------------------------------------------------------------------
-- p_items: [{id, to_project, to_folder, body: {path, thumbnail}, back: {links, core, share_path}}].
-- body is the caller's fresh copy. back marks an undo's replay: what the row goes back to, and no
-- fresh copy can be asked for. Every check runs before any write, and any refusal leaves everything
-- as it was. The plan writes nothing, and the commit asks all of it again.
CREATE OR REPLACE FUNCTION public.fn_moth_apply_moves(p_items jsonb, p_undo_of uuid, p_plan_only boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_ws         uuid := public.current_workspace_id();
  v_plan       boolean := COALESCE(p_plan_only, false);
  v_move       uuid := gen_random_uuid();
  v_ids        uuid[];
  v_dests      uuid[];
  v_folders    uuid[];
  v_projects   uuid[];
  d            record;
  q            jsonb;
  f            public.files%ROWTYPE;
  v_id         uuid;
  v_to_project uuid;
  v_to_folder  uuid;
  v_how        text;
  v_to_prov    text;
  v_to_path    text;
  v_to_thumb   text;
  v_follow     jsonb;
  v_needs      boolean;
  v_company    text;
  v_body       jsonb;
  v_prefix     text;
  v_tail       text;
  v_retire     jsonb;
  v_r          jsonb;
  v_from_links jsonb;
  v_to_links   jsonb;
  v_to_core    boolean;
  v_origin     jsonb;
  v_seen       text[] := '{}';
  v_plan_items jsonb := '[]'::jsonb;
  v_journal    jsonb := '[]'::jsonb;
  v_retires    jsonb := '{}'::jsonb;
  v_ops        jsonb := '[]'::jsonb;
  v_cleared    integer := 0;
  it           jsonb;
  v_msg        text;
  v_detail     text;
BEGIN
  IF auth.uid() IS NULL OR v_ws IS NULL OR NOT COALESCE(public.has_active_membership(v_ws), false) THEN
    RAISE EXCEPTION 'moth_move:not_a_workspace_member' USING ERRCODE = 'P0001';
  END IF;

  v_ids := ARRAY(SELECT (e ->> 'id')::uuid FROM jsonb_array_elements(p_items) e ORDER BY 1);
  v_dests := ARRAY(SELECT DISTINCT (e ->> 'to_project')::uuid FROM jsonb_array_elements(p_items) e);
  v_folders := ARRAY(SELECT DISTINCT (e ->> 'to_folder')::uuid FROM jsonb_array_elements(p_items) e WHERE e ->> 'to_folder' IS NOT NULL);

  -- Where they are going, before anything is said about what is going there.
  FOR d IN SELECT DISTINCT (e ->> 'to_project')::uuid AS project, (e ->> 'to_folder')::uuid AS folder
             FROM jsonb_array_elements(p_items) e LOOP
    IF NOT public._moth_dest_eligible(d.project, d.folder) THEN
      RAISE EXCEPTION 'moth_move:not_found' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- A row of another company reads as no row, and takes no lock.
  IF (SELECT count(*) FROM public.files x WHERE x.id = ANY (v_ids) AND x.workspace_id = v_ws) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'moth_move:not_found' USING ERRCODE = 'P0001';
  END IF;
  v_projects := v_dests || ARRAY(SELECT DISTINCT x.project_id FROM public.files x WHERE x.id = ANY (v_ids));
  PERFORM public._moth_lock_moves(v_projects, v_folders, v_ids);

  -- Asked again under the locks. A row that changed project while this waited holds a lock this
  -- did not take, so it is sent back to plan again rather than moved.
  FOR d IN SELECT DISTINCT (e ->> 'to_project')::uuid AS project, (e ->> 'to_folder')::uuid AS folder
             FROM jsonb_array_elements(p_items) e LOOP
    IF NOT public._moth_dest_eligible(d.project, d.folder) THEN
      RAISE EXCEPTION 'moth_move:not_found' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOREACH v_id IN ARRAY v_ids LOOP
    IF NOT public._moth_target_eligible('file', v_id, false) THEN
      RAISE EXCEPTION 'moth_move:not_found' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.files x WHERE x.id = ANY (v_ids) AND NOT x.project_id = ANY (v_projects)) THEN
    RAISE EXCEPTION 'moth_move:plan_changed' USING ERRCODE = 'P0001';
  END IF;

  -- Only now is anything said about the rights, so a hidden file in a batch reads as hidden.
  FOREACH v_id IN ARRAY v_dests LOOP
    IF NOT public.moth_can_write_target('project', v_id) THEN
      RAISE EXCEPTION 'moth_move:not_allowed_destination' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOREACH v_id IN ARRAY v_ids LOOP
    IF NOT public.moth_can_write_target('file', v_id) THEN
      RAISE EXCEPTION 'moth_move:not_allowed_source' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  BEGIN
    FOR q IN SELECT e FROM jsonb_array_elements(p_items) e ORDER BY (e ->> 'id')::uuid LOOP
      v_id := (q ->> 'id')::uuid;
      v_to_project := (q ->> 'to_project')::uuid;
      v_to_folder := (q ->> 'to_folder')::uuid;
      v_body := CASE WHEN jsonb_typeof(q -> 'body') = 'object' THEN q -> 'body' END;
      SELECT * INTO f FROM public.files x WHERE x.id = v_id;

      -- A file a desktop is still moving is at neither end yet.
      IF EXISTS (SELECT 1 FROM public.network_share_ops o WHERE o.file_id = v_id AND o.state = 'pending') THEN
        RAISE EXCEPTION 'moth_move:pending' USING ERRCODE = 'P0001';
      END IF;

      v_to_prov := f.storage_provider::text;
      v_to_path := f.storage_path;
      v_to_thumb := f.thumbnail_url;
      v_retire := '[]'::jsonb;
      v_r := NULL;
      v_from_links := jsonb_build_object(
        'phase_id', f.phase_id, 'asset_id', f.asset_id, 'task_id', f.task_id, 'scene_id', f.scene_id,
        'shot_id', f.shot_id, 'level_id', f.level_id, 'experience_id', f.experience_id);
      v_to_links := v_from_links;
      v_to_core := f.is_core_definer;

      IF f.project_id = v_to_project THEN
        -- Within one project only the folder changes, whatever holds the body (MV-1, MV-4).
        v_how := CASE WHEN f.folder_id IS NOT DISTINCT FROM v_to_folder THEN 'none' ELSE 'metadata' END;
      ELSE
        IF EXISTS (SELECT 1 FROM public.asset_versions av WHERE av.file_id = v_id) THEN
          RAISE EXCEPTION 'moth_move:is_an_asset_version' USING ERRCODE = 'P0001';
        END IF;
        IF EXISTS (SELECT 1 FROM public.ingestion_chunks c WHERE c.file_id = v_id) THEN
          RAISE EXCEPTION 'moth_move:has_extracted_text' USING ERRCODE = 'P0001';
        END IF;
        v_to_links := public._moth_links_alive(q -> 'back' -> 'links', v_to_project);
        v_to_core := COALESCE((q -> 'back' ->> 'core')::boolean, false);

        v_origin := jsonb_build_object(
          'move_id', v_move, 'from_project', f.project_id, 'from_folder', f.folder_id, 'from_links', v_from_links,
          'was_core_definer', f.is_core_definer, 'from_provider', f.storage_provider::text,
          'from_path', f.storage_path, 'from_thumb', f.thumbnail_url);

        IF f.storage_provider::text = 'network_share' THEN
          v_how := 'share_move';
          IF q -> 'back' ->> 'share_path' IS NOT NULL THEN
            v_r := public._moth_share_back(v_id, v_to_project, q -> 'back' ->> 'share_path', v_origin, NOT v_plan);
          ELSE
            v_r := public._network_share_move_core(v_id, v_to_project, v_to_folder, v_origin, NOT v_plan);
          END IF;
          v_to_path := 'nas:' || (v_r ->> 'to');
          -- The commit names the same place the plan did, or the caller's renamed the wrong thing.
          IF v_body ->> 'path' IS NOT NULL AND v_body ->> 'path' NOT IN (v_to_path, v_r ->> 'to') THEN
            RAISE EXCEPTION 'moth_move:plan_changed' USING ERRCODE = 'P0001';
          END IF;
        ELSE
          -- What the body needs: asked with no copy offered, so its other refusals speak first.
          v_needs := false;
          BEGIN
            v_follow := rabbit_private.files_body_follow(v_id, v_to_project, '[]'::jsonb);
          EXCEPTION WHEN raise_exception THEN
            GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
            IF v_msg <> 'needs_copy' THEN
              RAISE;
            END IF;
            v_needs := true;
          END;

          IF NOT v_needs THEN
            IF v_body IS NOT NULL THEN
              RAISE EXCEPTION 'moth_move:copy_not_needed' USING ERRCODE = 'P0001',
                DETAIL = 'This file does not need a new copy to move.';
            END IF;
            v_how := 'metadata';
            IF v_follow -> 'set' ? 'thumbnail_url' THEN
              v_to_thumb := v_follow -> 'set' ->> 'thumbnail_url';
            END IF;
            v_retire := COALESCE(v_follow -> 'retire', '[]'::jsonb);
          ELSIF q ? 'back' THEN
            -- A re-homed key under a private project cannot go back by association (SB-12).
            RAISE EXCEPTION 'moth_move:needs_copy' USING ERRCODE = 'P0001',
              DETAIL = 'Move it back with Move to.';
          ELSE
            v_how := CASE WHEN f.storage_provider::text = 'local_server' THEN 'copy_up' ELSE 'rehome' END;
            -- A body on one computer goes to a project everyone can reach, or to the caller's own
            -- space, and not into another private project (her answer 1).
            IF v_how = 'copy_up'
               AND EXISTS (SELECT 1 FROM public.projects p
                            WHERE p.id = v_to_project AND p.is_private AND p.personal_owner_id IS NULL) THEN
              RAISE EXCEPTION 'moth_move:only_on_a_computer' USING ERRCODE = 'P0001';
            END IF;
            v_company := public.fn_moth_body_provider_for(v_ws);

            IF v_company = 'network_share' THEN
              IF v_how <> 'copy_up' THEN
                RAISE EXCEPTION 'moth_move:copy_refused' USING ERRCODE = 'P0001',
                  DETAIL = 'A file moves onto your office server from the desktop app.';
              END IF;
              v_r := public._network_share_adopt_core(v_id, v_to_project, v_to_folder, v_origin, NOT v_plan);
              v_to_prov := 'network_share';
              v_to_path := 'nas:' || (v_r ->> 'to');
              v_to_thumb := NULL;
            ELSE
              v_to_prov := v_company;
              v_prefix := 'projects/' || v_to_project::text || '/files/' || v_id::text || '/';
              IF v_plan THEN
                v_to_path := v_prefix || floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint::text || '-' || public._moth_key_leaf(f.name);
                v_to_thumb := CASE WHEN btrim(COALESCE(f.thumbnail_url, '')) <> '' THEN v_to_path || '.jpg' END;
              ELSE
                IF v_body IS NULL THEN
                  IF v_how = 'copy_up' THEN
                    -- Only the computer that holds the body can have made the copy.
                    RAISE EXCEPTION 'moth_move:needs_desktop' USING ERRCODE = 'P0001',
                      DETAIL = 'Move it from the computer it was added on.';
                  END IF;
                  RAISE EXCEPTION 'moth_move:needs_copy' USING ERRCODE = 'P0001',
                    DETAIL = 'This file has to be copied to the new project first.';
                END IF;
                -- The key the plan minted: this project, this file, a time, this file's own name.
                v_tail := CASE WHEN starts_with(COALESCE(v_body ->> 'path', ''), v_prefix)
                               THEN substr(v_body ->> 'path', length(v_prefix) + 1) END;
                IF v_tail IS NULL OR v_tail !~ '^[0-9]{10,16}-'
                   OR regexp_replace(v_tail, '^[0-9]{10,16}-', '') <> public._moth_key_leaf(f.name) THEN
                  RAISE EXCEPTION 'moth_move:copy_refused' USING ERRCODE = 'P0001',
                    DETAIL = 'The new copy is not one this project can use.';
                END IF;
                v_follow := rabbit_private.files_body_follow(v_id, v_to_project, jsonb_build_array(jsonb_build_object(
                  'file_id', v_id, 'to_provider', v_to_prov, 'to_path', v_body ->> 'path', 'to_thumb', v_body ->> 'thumbnail')));
                v_to_prov := v_follow -> 'set' ->> 'storage_provider';
                v_to_path := v_follow -> 'set' ->> 'storage_path';
                v_to_thumb := v_follow -> 'set' ->> 'thumbnail_url';
                v_retire := COALESCE(v_follow -> 'retire', '[]'::jsonb);
              END IF;
            END IF;
          END IF;
        END IF;

        -- Two of a batch cannot take one name on the server, and the plan should say so too.
        IF v_to_prov = 'network_share' THEN
          IF lower(v_to_path) = ANY (v_seen) THEN
            RAISE EXCEPTION 'moth_move:name_taken' USING ERRCODE = 'P0001';
          END IF;
          v_seen := v_seen || lower(v_to_path);
        END IF;
      END IF;

      v_plan_items := v_plan_items || (jsonb_build_object('id', v_id, 'how', v_how)
        || CASE WHEN v_how IN ('rehome', 'copy_up', 'share_move')
                THEN jsonb_build_object('to_provider', v_to_prov, 'to_path', v_to_path, 'to_thumb', v_to_thumb)
                ELSE '{}'::jsonb END
        || CASE WHEN v_r ? 'from' THEN jsonb_build_object('from', v_r ->> 'from') ELSE '{}'::jsonb END);

      IF v_how <> 'none' THEN
        v_journal := v_journal || jsonb_build_object(
          'id', v_id, 'how', v_how,
          'from_project', f.project_id, 'to_project', v_to_project,
          'from_folder', f.folder_id, 'to_folder', v_to_folder,
          'from_links', v_from_links, 'to_links', v_to_links,
          'was_core_definer', f.is_core_definer, 'to_core', v_to_core,
          'from_provider', f.storage_provider::text, 'from_path', f.storage_path, 'from_thumb', f.thumbnail_url,
          'to_provider', v_to_prov, 'to_path', v_to_path, 'to_thumb', v_to_thumb);
        v_retires := v_retires || jsonb_build_object(v_id::text, v_retire);
        v_cleared := v_cleared + (SELECT count(*)::int FROM jsonb_each_text(v_from_links) e
                                   WHERE e.value IS NOT NULL AND v_to_links ->> e.key IS NULL);
        IF v_r ? 'op_id' THEN
          v_ops := v_ops || v_r;
        END IF;
      END IF;
    END LOOP;

    IF v_plan THEN
      RETURN jsonb_build_object('items', v_plan_items);
    END IF;
    IF jsonb_array_length(v_journal) = 0 THEN
      RETURN jsonb_build_object('move_id', NULL, 'moved', 0, 'links_cleared', 0, 'ops', '[]'::jsonb);
    END IF;

    -- The journal, the marker, one UPDATE per file, the old copies queued, the marker cleared.
    INSERT INTO public.file_moves (id, workspace_id, items, undo_of) VALUES (v_move, v_ws, v_journal, p_undo_of);
    PERFORM set_config('wilson.file_move', v_move::text, true);
    FOR it IN SELECT e FROM jsonb_array_elements(v_journal) e LOOP
      UPDATE public.files x
         SET project_id = (it ->> 'to_project')::uuid,
             folder_id = (it ->> 'to_folder')::uuid,
             storage_provider = (it ->> 'to_provider')::public.storage_provider,
             storage_path = it ->> 'to_path',
             thumbnail_url = it ->> 'to_thumb',
             is_core_definer = (it ->> 'to_core')::boolean,
             phase_id = (it -> 'to_links' ->> 'phase_id')::uuid,
             asset_id = (it -> 'to_links' ->> 'asset_id')::uuid,
             task_id = (it -> 'to_links' ->> 'task_id')::uuid,
             scene_id = (it -> 'to_links' ->> 'scene_id')::uuid,
             shot_id = (it -> 'to_links' ->> 'shot_id')::uuid,
             level_id = (it -> 'to_links' ->> 'level_id')::uuid,
             experience_id = (it -> 'to_links' ->> 'experience_id')::uuid
       WHERE x.id = (it ->> 'id')::uuid;
      PERFORM rabbit_private.files_body_retire((it ->> 'id')::uuid, v_retires -> (it ->> 'id'));
    END LOOP;
    PERFORM set_config('wilson.file_move', '', true);

    RETURN jsonb_build_object('move_id', v_move, 'moved', jsonb_array_length(v_journal), 'links_cleared', v_cleared, 'ops', v_ops);
  EXCEPTION WHEN raise_exception THEN
    -- One vocabulary for the client: the body contract's codes and the office server's.
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
    IF v_msg IN ('body_missing', 'body_shape', 's3_moves_off', 'body_elsewhere', 'needs_copy', 'copy_not_needed', 'copy_refused') THEN
      RAISE EXCEPTION 'moth_move:%', v_msg USING ERRCODE = 'P0001', DETAIL = COALESCE(v_detail, '');
    END IF;
    IF v_msg = 'network_share: occupied' THEN
      RAISE EXCEPTION 'moth_move:name_taken' USING ERRCODE = 'P0001';
    END IF;
    IF starts_with(v_msg, 'network_share: ') THEN
      RAISE EXCEPTION 'moth_move:%', substr(v_msg, 16) USING ERRCODE = 'P0001';
    END IF;
    RAISE;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_moth_apply_moves(jsonb, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- §3 The two a client calls ------------------------------------------------------------------
-- p_bodies: [{file_id, path, thumbnail}], a fresh copy for a file the plan said needs one. The
-- server never takes a key on the caller's word: the core asks whether it is the one it minted.
CREATE OR REPLACE FUNCTION public.moth_move_items(
  p_file_ids uuid[],
  p_dest_project uuid,
  p_dest_folder uuid DEFAULT NULL,
  p_plan_only boolean DEFAULT false,
  p_bodies jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_ws  uuid := public.current_workspace_id();
  v_ids uuid[] := ARRAY(SELECT DISTINCT x FROM unnest(p_file_ids) x WHERE x IS NOT NULL ORDER BY 1);
BEGIN
  IF auth.uid() IS NULL OR v_ws IS NULL OR NOT COALESCE(public.has_active_membership(v_ws), false) THEN
    RAISE EXCEPTION 'moth_move:not_a_workspace_member' USING ERRCODE = 'P0001';
  END IF;
  IF cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'moth_move:empty' USING ERRCODE = 'P0001';
  END IF;
  IF cardinality(v_ids) > 500 THEN
    RAISE EXCEPTION 'moth_move:too_many' USING ERRCODE = 'P0001';
  END IF;
  IF p_bodies IS NOT NULL AND jsonb_typeof(p_bodies) <> 'null' THEN
    IF jsonb_typeof(p_bodies) <> 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_bodies) e
                   WHERE jsonb_typeof(e) <> 'object'
                      OR public.fn_try_uuid(e ->> 'file_id') IS NULL
                      OR NOT public.fn_try_uuid(e ->> 'file_id') = ANY (v_ids))
       OR (SELECT count(*) <> count(DISTINCT e ->> 'file_id') FROM jsonb_array_elements(p_bodies) e) THEN
      RAISE EXCEPTION 'moth_move:copy_refused' USING ERRCODE = 'P0001',
        DETAIL = 'The new copy is not one this project can use.';
    END IF;
  END IF;
  RETURN public.fn_moth_apply_moves(
    (SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
              'id', x, 'to_project', p_dest_project, 'to_folder', p_dest_folder,
              'body', (SELECT e FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_bodies) = 'array' THEN p_bodies ELSE '[]'::jsonb END) e
                        WHERE public.fn_try_uuid(e ->> 'file_id') = x))))
       FROM unnest(v_ids) x),
    NULL, COALESCE(p_plan_only, false));
END;
$$;
REVOKE ALL ON FUNCTION public.moth_move_items(uuid[], uuid, uuid, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moth_move_items(uuid[], uuid, uuid, boolean, jsonb) TO authenticated;

-- Back the way the journal says, through the same core with the same checks. Only the person who
-- moved it, and only while each file sits where the move left it. Redo is this on the undo's own id.
CREATE OR REPLACE FUNCTION public.moth_undo_move(p_move_id uuid, p_plan_only boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_ws    uuid := public.current_workspace_id();
  v_row   public.file_moves%ROWTYPE;
  v_ids   uuid[];
  v_projs uuid[];
  v_fold  uuid[];
  it      jsonb;
  f       public.files%ROWTYPE;
  v_out   jsonb;
  v_back  jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_ws IS NULL OR NOT COALESCE(public.has_active_membership(v_ws), false) THEN
    RAISE EXCEPTION 'moth_move:not_a_workspace_member' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_row FROM public.file_moves m
   WHERE m.id = p_move_id AND m.workspace_id = v_ws AND m.actor_user_id = auth.uid()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'moth_move:not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.undone_at IS NOT NULL THEN
    RAISE EXCEPTION 'moth_move:already_undone' USING ERRCODE = 'P0001';
  END IF;

  v_ids := ARRAY(SELECT (e ->> 'id')::uuid FROM jsonb_array_elements(v_row.items) e ORDER BY 1);
  v_projs := ARRAY(SELECT DISTINCT x FROM jsonb_array_elements(v_row.items) e,
                     LATERAL unnest(ARRAY[(e ->> 'from_project')::uuid, (e ->> 'to_project')::uuid]) x);
  v_fold := ARRAY(SELECT DISTINCT (e ->> 'from_folder')::uuid FROM jsonb_array_elements(v_row.items) e WHERE e ->> 'from_folder' IS NOT NULL);
  PERFORM public._moth_lock_moves(v_projs, v_fold, v_ids);

  -- The read gate before any position is compared, so an undo says nothing of a project the
  -- caller has lost (SEC-MV-12). A trashed file is allowed through, to read as changed.
  FOREACH p_move_id IN ARRAY v_projs LOOP
    IF NOT public._moth_target_eligible('project', p_move_id, false) THEN
      RAISE EXCEPTION 'moth_move:not_found' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOREACH p_move_id IN ARRAY v_ids LOOP
    IF NOT public._moth_target_eligible('file', p_move_id, true) THEN
      RAISE EXCEPTION 'moth_move:not_found' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  p_move_id := v_row.id;

  FOR it IN SELECT e FROM jsonb_array_elements(v_row.items) e LOOP
    SELECT * INTO f FROM public.files x WHERE x.id = (it ->> 'id')::uuid;
    IF f.deleted_at IS NOT NULL
       OR f.project_id IS DISTINCT FROM (it ->> 'to_project')::uuid
       OR f.folder_id IS DISTINCT FROM (it ->> 'to_folder')::uuid
       OR f.storage_provider::text IS DISTINCT FROM it ->> 'to_provider'
       OR f.storage_path IS DISTINCT FROM it ->> 'to_path' THEN
      RAISE EXCEPTION 'moth_move:changed_since' USING ERRCODE = 'P0001';
    END IF;
    v_back := v_back || jsonb_build_object(
      'id', it ->> 'id',
      'to_project', it ->> 'from_project',
      -- A folder gone since is no folder, as its own delete would have left the row.
      'to_folder', (SELECT fo.id FROM public.folders fo
                     WHERE fo.id = (it ->> 'from_folder')::uuid AND fo.project_id = (it ->> 'from_project')::uuid),
      'back', jsonb_build_object(
        'links', it -> 'from_links',
        'core', it -> 'was_core_definer',
        -- The exact place it left, when it was on the server then too.
        'share_path', CASE WHEN it ->> 'from_provider' = 'network_share' THEN substr(it ->> 'from_path', 5) END));
  END LOOP;

  v_out := public.fn_moth_apply_moves(v_back, p_move_id, COALESCE(p_plan_only, false));
  IF COALESCE(p_plan_only, false) THEN
    RETURN v_out || jsonb_build_object('move_id', p_move_id);
  END IF;
  UPDATE public.file_moves m SET undone_at = now() WHERE m.id = p_move_id;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.moth_undo_move(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moth_undo_move(uuid, boolean) TO authenticated;

-- §4 A move the desktop could not make ---------------------------------------------------------
-- The row went first, so the file never left. It goes back as the operation's journal says, under
-- a journal row of its own, because no office-server marker ever admits a project change (§1.5).
-- Its own path, not the core's: its operation is still pending while this runs, and asking the
-- rights again would strand a file whose person has lost the project it never really left.
-- Reached only from network_share_settle, which holds the locks and the operation's row.
CREATE OR REPLACE FUNCTION public._network_share_replay_origin(p_op uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  o       public.network_share_ops%ROWTYPE;
  f       public.files%ROWTYPE;
  v_from  jsonb;
  v_links jsonb;
  v_fold  uuid;
  v_move  uuid;
  v_item  jsonb;
BEGIN
  SELECT * INTO o FROM public.network_share_ops x WHERE x.id = p_op;
  PERFORM public._network_share_lock_projects(ARRAY[o.project_id, o.dest_project_id]);
  SELECT * INTO f FROM public.files x WHERE x.id = o.file_id FOR UPDATE;
  -- Nothing can move a row with a pending operation, so this says only that something did.
  IF f.project_id IS DISTINCT FROM o.dest_project_id
     OR f.deleted_at IS NOT NULL
     OR f.storage_provider::text <> 'network_share'
     OR f.storage_path IS DISTINCT FROM 'nas:' || o.to_locator THEN
    RAISE EXCEPTION 'network_share: changed_since';
  END IF;
  v_from := o.origin;
  -- As a delete's way back does: a walk skips a pending operation's names, so only a row that was
  -- there already can hold this one, and the person is told rather than the row forced.
  IF v_from ->> 'from_provider' = 'network_share'
     AND EXISTS (SELECT 1 FROM public.files h
                  WHERE h.workspace_id = f.workspace_id
                    AND h.storage_provider = 'network_share'
                    AND h.deleted_at IS NULL
                    AND lower(h.storage_path) = lower(v_from ->> 'from_path')
                    AND h.id <> f.id) THEN
    RAISE EXCEPTION 'network_share: occupied';
  END IF;
  v_links := public._moth_links_alive(v_from -> 'from_links', o.project_id);
  SELECT fo.id INTO v_fold FROM public.folders fo
   WHERE fo.id = (v_from ->> 'from_folder')::uuid AND fo.project_id = o.project_id;

  v_item := jsonb_build_object(
    'id', f.id, 'how', CASE WHEN o.op = 'adopt' THEN 'copy_up' ELSE 'share_move' END,
    'from_project', f.project_id, 'to_project', o.project_id,
    'from_folder', f.folder_id, 'to_folder', v_fold,
    'from_links', jsonb_build_object('phase_id', f.phase_id, 'asset_id', f.asset_id, 'task_id', f.task_id, 'scene_id', f.scene_id,
                                     'shot_id', f.shot_id, 'level_id', f.level_id, 'experience_id', f.experience_id),
    'to_links', v_links,
    'was_core_definer', f.is_core_definer, 'to_core', COALESCE((v_from ->> 'was_core_definer')::boolean, false),
    'from_provider', f.storage_provider::text, 'from_path', f.storage_path, 'from_thumb', f.thumbnail_url,
    'to_provider', v_from ->> 'from_provider', 'to_path', v_from ->> 'from_path', 'to_thumb', v_from ->> 'from_thumb');

  -- A journal row outlives its 30 days only while something needs it; this one may be gone.
  INSERT INTO public.file_moves (workspace_id, items, undo_of)
  VALUES (f.workspace_id, jsonb_build_array(v_item),
          (SELECT m.id FROM public.file_moves m WHERE m.id = (v_from ->> 'move_id')::uuid))
  RETURNING id INTO v_move;
  PERFORM set_config('wilson.file_move', v_move::text, true);
  UPDATE public.files x
     SET project_id = o.project_id,
         folder_id = v_fold,
         storage_provider = (v_item ->> 'to_provider')::public.storage_provider,
         storage_path = v_item ->> 'to_path',
         thumbnail_url = v_item ->> 'to_thumb',
         is_core_definer = (v_item ->> 'to_core')::boolean,
         phase_id = (v_links ->> 'phase_id')::uuid,
         asset_id = (v_links ->> 'asset_id')::uuid,
         task_id = (v_links ->> 'task_id')::uuid,
         scene_id = (v_links ->> 'scene_id')::uuid,
         shot_id = (v_links ->> 'shot_id')::uuid,
         level_id = (v_links ->> 'level_id')::uuid,
         experience_id = (v_links ->> 'experience_id')::uuid
   WHERE x.id = f.id;
  PERFORM set_config('wilson.file_move', '', true);
END;
$$;
REVOKE ALL ON FUNCTION public._network_share_replay_origin(uuid) FROM PUBLIC, anon, authenticated;

-- Lifted from 0117 whole; the one change is the lock below.
-- The desktop's report. For whoever began the operation while they can still write the row; after
-- 24 hours, for anyone who could check the folder both locators sit in, so a laptop that never
-- comes back does not hold a file for ever (NS-D12). A cross-project operation stays with its
-- creator (the design's residual: if that laptop never returns, service_role settles it).
CREATE OR REPLACE FUNCTION public.network_share_settle(
  p_op_ids  uuid[],
  p_outcome text,
  p_facts   jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_ws    uuid := public.current_workspace_id();
  v_ids   uuid[] := ARRAY(SELECT DISTINCT x FROM unnest(p_op_ids) x WHERE x IS NOT NULL ORDER BY 1);
  r       record;
  v_lf    text;
  v_fact  jsonb;
  v_m     timestamptz;
  v_n     integer := 0;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('done', 'not_moved') OR cardinality(v_ids) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'network_share: bad_request';
  END IF;

  -- Who, before any lock. One sentence for all of it, and an operation already settled reads the
  -- same as one that was never there.
  FOR r IN SELECT o.id, o.created_by, o.created_at, o.from_locator, o.to_locator, f.project_id AS file_project
             FROM public.network_share_ops o
             JOIN public.files f ON f.id = o.file_id
            WHERE o.id = ANY (v_ids) AND o.workspace_id = v_ws AND o.state = 'pending' LOOP
    v_n := v_n + 1;
    IF r.created_by = v_uid AND public._network_share_may_write(r.file_project) THEN
      CONTINUE;
    END IF;
    v_lf := lower(public.network_share_space_folder(r.file_project));
    IF NOT (r.created_at < now() - interval '24 hours'
            AND r.from_locator IS NOT NULL
            AND COALESCE(starts_with(lower(r.from_locator), v_lf || '/'), false)
            AND COALESCE(starts_with(lower(r.to_locator), v_lf || '/'), false)
            AND public._network_share_may_check(r.file_project)) THEN
      RAISE EXCEPTION 'network_share: not allowed' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  IF v_n <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'network_share: not allowed' USING ERRCODE = '42501';
  END IF;

  -- 0118: a way back reaches both ends of a move, so both locks come now, in order, with no row
  -- held. Taken one project at a time they could cross a walk's, which locks the other way.
  PERFORM public._network_share_lock_projects(ARRAY(
    SELECT x FROM public.network_share_ops o JOIN public.files f ON f.id = o.file_id,
           LATERAL unnest(ARRAY[f.project_id, o.project_id, o.dest_project_id]) x
     WHERE o.id = ANY (v_ids)));

  FOR r IN SELECT o.* FROM public.network_share_ops o WHERE o.id = ANY (v_ids) ORDER BY o.id FOR UPDATE LOOP
    IF r.state <> 'pending' THEN
      RAISE EXCEPTION 'network_share: not allowed' USING ERRCODE = '42501';
    END IF;

    IF p_outcome = 'done' THEN
      IF r.op = 'restore' THEN
        PERFORM set_config('wilson.network_share_writer', 'op:' || r.file_id::text, true);
        UPDATE public.files SET share_bin_path = NULL WHERE id = r.file_id;
      ELSIF r.op = 'adopt' THEN
        -- The desktop has verified its copy. What it read off the server goes on the row.
        v_fact := p_facts -> r.id::text;
        -- The size must be good. A time this cannot store (a file dated before 1980, a server's
        -- clock ahead) leaves the row's own: the copy is verified, and refusing would strand it.
        v_m := public._network_share_mtime(v_fact ->> 'm');
        IF COALESCE(v_fact ->> 's', '') !~ '^[0-9]{1,15}$' THEN
          RAISE EXCEPTION 'network_share: bad_facts';
        END IF;
        PERFORM set_config('wilson.network_share_writer', 'op:' || r.file_id::text, true);
        UPDATE public.files
           SET size_bytes = (v_fact ->> 's')::bigint, source_modified_at = COALESCE(v_m, source_modified_at)
         WHERE id = r.file_id;
      END IF;
      UPDATE public.network_share_ops SET state = 'done', settled_at = clock_timestamp() WHERE id = r.id;

    ELSE
      IF r.op = 'trash' THEN
        -- The file never left, so the row comes back as it was. Its name may not have been taken
        -- meanwhile: an apply skips what the journal names.
        IF EXISTS (SELECT 1 FROM public.files h
                    WHERE h.workspace_id = r.workspace_id
                      AND h.storage_provider = 'network_share'
                      AND h.deleted_at IS NULL
                      AND lower(h.storage_path) = 'nas:' || lower(r.from_locator)
                      AND h.id <> r.file_id) THEN
          RAISE EXCEPTION 'network_share: occupied';
        END IF;
        PERFORM set_config('wilson.network_share_writer', 'op:' || r.file_id::text, true);
        UPDATE public.files
           SET deleted_at = NULL, deleted_by = NULL, share_bin_path = NULL
         WHERE id = r.file_id;
      ELSIF r.op = 'restore' THEN
        -- The file is still in the bin, so the row goes back to the trash, with its own dates.
        PERFORM set_config('wilson.network_share_writer', 'op:' || r.file_id::text, true);
        UPDATE public.files
           SET deleted_at = COALESCE((r.origin ->> 'deleted_at')::timestamptz, now()),
               deleted_by = (r.origin ->> 'deleted_by')::uuid
         WHERE id = r.file_id;
      ELSE
        PERFORM public._network_share_replay_origin(r.id);
      END IF;
      UPDATE public.network_share_ops SET state = 'reverted', settled_at = clock_timestamp() WHERE id = r.id;
    END IF;
  END LOOP;

  PERFORM set_config('wilson.network_share_writer', '', true);
  RETURN jsonb_build_object('settled', cardinality(v_ids), 'outcome', p_outcome);
END;
$$;
REVOKE ALL ON FUNCTION public.network_share_settle(uuid[], text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.network_share_settle(uuid[], text, jsonb) TO authenticated;

-- §5 Moth's trash ----------------------------------------------------------------------------
-- 1 to 500 ids, every one judged by the one exclusion before any is touched, so a batch with one
-- invoice in it trashes nothing, for an admin too. Office-server rows go first and together:
-- their RPC takes the advisory locks before its row locks, and no row is held here when it does.
-- Then the rest through soft_delete_row or restore_soft_deleted, with fn_trash_authz unchanged.
-- A row already where it was asked to go adds nothing. Any refusal rolls the whole batch back.
CREATE OR REPLACE FUNCTION public._moth_trash_batch(p_ids uuid[], p_restore boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_ws    uuid := public.current_workspace_id();
  v_ids   uuid[] := ARRAY(SELECT DISTINCT x FROM unnest(p_ids) x WHERE x IS NOT NULL ORDER BY 1);
  v_id    uuid;
  v_share uuid[];
  v_rest  uuid[];
  v_ops   jsonb := '[]'::jsonb;
  v_done  integer := 0;
  v_hit   boolean;
  v_msg   text;
BEGIN
  IF auth.uid() IS NULL OR v_ws IS NULL OR NOT COALESCE(public.has_active_membership(v_ws), false) THEN
    RAISE EXCEPTION 'moth_trash:not_a_workspace_member' USING ERRCODE = 'P0001';
  END IF;
  IF cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'moth_trash:empty' USING ERRCODE = 'P0001';
  END IF;
  IF cardinality(v_ids) > 500 THEN
    RAISE EXCEPTION 'moth_trash:too_many' USING ERRCODE = 'P0001';
  END IF;
  FOREACH v_id IN ARRAY v_ids LOOP
    IF NOT public._moth_target_eligible('file', v_id, true) THEN
      RAISE EXCEPTION 'moth_trash:not_found' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  v_share := ARRAY(SELECT f.id FROM public.files f
                    WHERE f.id = ANY (v_ids) AND f.storage_provider::text = 'network_share'
                      AND (f.deleted_at IS NOT NULL) = COALESCE(p_restore, false)
                    ORDER BY f.id);
  v_rest := ARRAY(SELECT f.id FROM public.files f
                   WHERE f.id = ANY (v_ids) AND f.storage_provider::text <> 'network_share'
                   ORDER BY f.id);
  BEGIN
    IF cardinality(v_share) > 0 THEN
      v_ops := CASE WHEN p_restore THEN public.network_share_restore(v_share) ELSE public.network_share_trash(v_share) END;
      v_done := jsonb_array_length(v_ops);
    END IF;
    FOREACH v_id IN ARRAY v_rest LOOP
      v_hit := CASE WHEN p_restore THEN public.restore_soft_deleted('files', v_id) ELSE public.soft_delete_row('files', v_id) END;
      IF v_hit THEN
        v_done := v_done + 1;
      END IF;
    END LOOP;
  EXCEPTION WHEN raise_exception OR insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg IN ('not allowed to soft-delete or restore this row', 'network_share: not allowed') THEN
      RAISE EXCEPTION 'moth_trash:not_allowed' USING ERRCODE = 'P0001';
    END IF;
    IF starts_with(v_msg, 'network_share: ') THEN
      RAISE EXCEPTION 'moth_trash:%', substr(v_msg, 16) USING ERRCODE = 'P0001';
    END IF;
    RAISE;
  END;
  RETURN jsonb_build_object('done', v_done, 'ops', v_ops);
END;
$$;
REVOKE ALL ON FUNCTION public._moth_trash_batch(uuid[], boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.moth_trash_files(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.has_active_membership(public.current_workspace_id()), false) THEN
    RAISE EXCEPTION 'moth_trash:not_a_workspace_member' USING ERRCODE = 'P0001';
  END IF;
  RETURN public._moth_trash_batch(p_ids, false);
END;
$$;
REVOKE ALL ON FUNCTION public.moth_trash_files(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moth_trash_files(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.moth_restore_files(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.has_active_membership(public.current_workspace_id()), false) THEN
    RAISE EXCEPTION 'moth_trash:not_a_workspace_member' USING ERRCODE = 'P0001';
  END IF;
  RETURN public._moth_trash_batch(p_ids, true);
END;
$$;
REVOKE ALL ON FUNCTION public.moth_restore_files(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moth_restore_files(uuid[]) TO authenticated;

-- What is in the trash, as metadata: a trashed body cannot be read, so no locator goes out, and no
-- count. Newest first. p_before is the last row's deleted_at, and rows trashed together share it,
-- so a page runs on to the end of its batch rather than stranding the rest of it behind the cursor.
CREATE OR REPLACE FUNCTION public.moth_trash_index(p_limit integer DEFAULT 200, p_before timestamptz DEFAULT NULL)
RETURNS TABLE (
  id uuid, project_id uuid, project_title text, folder_id uuid, name text, mime_type text, size_bytes bigint,
  kind public.file_kind, deleted_at timestamptz, deleted_by_label text, purges_at timestamptz,
  can_restore boolean, needs_desktop boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
#variable_conflict use_column
DECLARE
  v_ws    uuid := public.current_workspace_id();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
  v_n     integer := 0;
  v_last  timestamptz;
  r       record;
BEGIN
  IF auth.uid() IS NULL OR v_ws IS NULL OR NOT COALESCE(public.has_active_membership(v_ws), false) THEN
    RAISE EXCEPTION 'moth_trash:not_a_workspace_member' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN
    SELECT f.id, f.project_id, p.title, f.folder_id, f.name, f.mime_type, f.size_bytes, f.kind,
           f.deleted_at, COALESCE(wm.display_name, wm.username) AS label, f.storage_provider::text AS provider
      FROM public.files f
      JOIN public.projects p ON p.id = f.project_id
      LEFT JOIN public.workspace_members wm ON wm.workspace_id = f.workspace_id AND wm.user_id = f.deleted_by
     WHERE f.workspace_id = v_ws
       AND f.deleted_at IS NOT NULL
       AND f.deleted_at > now() - interval '30 days'
       AND (p_before IS NULL OR f.deleted_at < p_before)
     ORDER BY f.deleted_at DESC, f.id DESC
  LOOP
    EXIT WHEN v_n >= v_limit AND r.deleted_at IS DISTINCT FROM v_last;
    CONTINUE WHEN NOT public._moth_target_eligible('file', r.id, true);
    id := r.id;
    project_id := r.project_id;
    project_title := r.title;
    folder_id := r.folder_id;
    name := r.name;
    mime_type := r.mime_type;
    size_bytes := r.size_bytes;
    kind := r.kind;
    deleted_at := r.deleted_at;
    deleted_by_label := r.label;
    purges_at := r.deleted_at + interval '30 days';
    can_restore := public.moth_can_write_target('project', r.project_id);
    needs_desktop := r.provider = 'network_share';
    v_n := v_n + 1;
    v_last := r.deleted_at;
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.moth_trash_index(integer, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moth_trash_index(integer, timestamptz) TO authenticated;

-- §6 COMMENTs --------------------------------------------------------------------------------
COMMENT ON FUNCTION public.fn_moth_apply_moves(jsonb, uuid, boolean) IS
  'The one way a file changes project or folder: every check, then the journal, the marker and one UPDATE per file. Closed to clients; moth_move_items and moth_undo_move call it.';
COMMENT ON FUNCTION public.moth_move_items(uuid[], uuid, uuid, boolean, jsonb) IS
  'Move 1 to 500 files to a project and folder. The plan says how each goes and writes nothing; the commit takes any fresh copies the plan asked for and judges everything again. Errors are moth_move:<code>.';
COMMENT ON FUNCTION public.moth_undo_move(uuid, boolean) IS
  'Undo the caller''s own move while each file sits where it left it. Links come back where their row still exists. Redo is this on the undo''s id. Errors are moth_move:<code>.';
COMMENT ON FUNCTION public._moth_dest_eligible(uuid, uuid) IS
  'A move''s destination: an eligible project, and a folder of that project that is not locked. Closed to clients.';
COMMENT ON FUNCTION public._moth_lock_moves(uuid[], uuid[], uuid[]) IS
  'The one order of a move''s locks: the projects'' advisory locks, then project, folder and file rows, each by id. Closed to clients.';
COMMENT ON FUNCTION public._moth_key_leaf(text) IS
  'The name part of a key the server mints. Closed to clients.';
COMMENT ON FUNCTION public._moth_links_alive(jsonb, uuid) IS
  'A file''s seven links, keeping only those whose row is in this project. Closed to clients.';
COMMENT ON FUNCTION public._moth_share_back(uuid, uuid, text, jsonb, boolean) IS
  'An office-server file''s way back to the exact place it left, journalled as a pending move. Closed to clients.';
COMMENT ON FUNCTION public._network_share_replay_origin(uuid) IS
  'A move or an adopt the desktop could not make: the row goes back as the operation''s journal says, under a move journal row of its own. Called only from network_share_settle.';
COMMENT ON FUNCTION public._moth_trash_batch(uuid[], boolean) IS
  'Trash or restore 1 to 500 files whole or not at all: the one exclusion first, then the existing paths. Closed to clients.';
COMMENT ON FUNCTION public.moth_trash_files(uuid[]) IS
  'Moth''s Delete. Returns {done, ops}; ops are for the desktop, for office-server rows. Errors are moth_trash:<code>.';
COMMENT ON FUNCTION public.moth_restore_files(uuid[]) IS
  'Moth''s Restore. Returns {done, ops}; ops are for the desktop, for office-server rows. Errors are moth_trash:<code>.';
COMMENT ON FUNCTION public.moth_trash_index(integer, timestamptz) IS
  'Moth''s trash view: trashed files the caller may see, deleted within 30 days, newest first, as metadata. No locators, no counts.';

-- §7 Post-conditions --------------------------------------------------------------------------
DO $$
DECLARE
  v_body TEXT;
  v_fn   RECORD;
  v_word TEXT;
BEGIN
  -- Comments stripped: a comment naming a word is not the word.
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_body
    FROM pg_proc WHERE oid = 'public.fn_moth_apply_moves(jsonb,uuid,boolean)'::regprocedure;
  FOREACH v_word IN ARRAY ARRAY['has_active_membership', '_moth_target_eligible', 'moth_can_write_target',
                                '_moth_lock_moves', 'set_config(''wilson.file_move''', 'ingestion_chunks',
                                'asset_versions', 'files_body_follow', 'files_body_retire',
                                '_network_share_move_core', '_network_share_adopt_core'] LOOP
    IF position(v_word IN v_body) = 0 THEN
      RAISE EXCEPTION '0118 post-condition: fn_moth_apply_moves lost %', v_word;
    END IF;
  END LOOP;
  -- The journal comes before the rows.
  IF position('INSERT INTO public.file_moves' IN v_body) = 0
     OR position('INSERT INTO public.file_moves' IN v_body) > position('UPDATE public.files' IN v_body) THEN
    RAISE EXCEPTION '0118 post-condition: fn_moth_apply_moves must write the journal before the rows';
  END IF;

  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_body
    FROM pg_proc WHERE oid = 'public._moth_lock_moves(uuid[],uuid[],uuid[])'::regprocedure;
  IF position('_network_share_lock_projects' IN v_body) = 0
     OR position('_network_share_lock_projects' IN v_body) > position('FOR UPDATE' IN v_body) THEN
    RAISE EXCEPTION '0118 post-condition: the advisory locks must come before any file row lock';
  END IF;

  -- 0117's stub is gone, and the settle locks both ends of a move before any row.
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_body
    FROM pg_proc WHERE oid = 'public._network_share_replay_origin(uuid)'::regprocedure;
  IF position('moves_not_ready' IN v_body) > 0
     OR position('set_config(''wilson.file_move''' IN v_body) = 0
     OR position('INSERT INTO public.file_moves' IN v_body) = 0
     OR position('_network_share_move_core' IN v_body) > 0
     OR position('_network_share_adopt_core' IN v_body) > 0 THEN
    RAISE EXCEPTION '0118 post-condition: _network_share_replay_origin is not its own journalled path';
  END IF;
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_body
    FROM pg_proc WHERE oid = 'public.network_share_settle(uuid[],text,jsonb)'::regprocedure;
  IF position('o.dest_project_id' IN v_body) = 0 THEN
    RAISE EXCEPTION '0118 post-condition: network_share_settle does not lock both ends of a move';
  END IF;

  -- Every definer a client calls opens with the membership guard (SEC-MV-05).
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('public.moth_move_items(uuid[],uuid,uuid,boolean,jsonb)'),
      ('public.moth_undo_move(uuid,boolean)'),
      ('public.moth_trash_files(uuid[])'),
      ('public.moth_restore_files(uuid[])'),
      ('public.moth_trash_index(integer,timestamp with time zone)')
    ) AS t(sig)
  LOOP
    SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_body FROM pg_proc WHERE oid = v_fn.sig::regprocedure;
    IF position('has_active_membership' IN v_body) = 0 THEN
      RAISE EXCEPTION '0118 post-condition: % does not open with the membership guard', v_fn.sig;
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn.sig::regprocedure)
       OR has_function_privilege('anon', v_fn.sig::regprocedure, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_fn.sig::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '0118 post-condition: % must be a definer for authenticated alone', v_fn.sig;
    END IF;
  END LOOP;

  -- The rest are closed to every client.
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('public.fn_moth_apply_moves(jsonb,uuid,boolean)'),
      ('public._moth_dest_eligible(uuid,uuid)'),
      ('public._moth_lock_moves(uuid[],uuid[],uuid[])'),
      ('public._moth_key_leaf(text)'),
      ('public._moth_links_alive(jsonb,uuid)'),
      ('public._moth_share_back(uuid,uuid,text,jsonb,boolean)'),
      ('public._moth_trash_batch(uuid[],boolean)'),
      ('public._network_share_replay_origin(uuid)')
    ) AS t(sig)
  LOOP
    IF has_function_privilege('anon', v_fn.sig::regprocedure, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn.sig::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '0118 post-condition: a client may call %', v_fn.sig;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proconfig) c
                    WHERE p.oid = v_fn.sig::regprocedure AND c LIKE 'search_path=%') THEN
      RAISE EXCEPTION '0118 post-condition: % has no pinned search_path', v_fn.sig;
    END IF;
  END LOOP;

  -- The trash view hands out no locator.
  IF pg_get_function_result('public.moth_trash_index(integer,timestamp with time zone)'::regprocedure)
     ~ '(storage_path|thumbnail_url|storage_provider|share_bin_path)' THEN
    RAISE EXCEPTION '0118 post-condition: moth_trash_index returns a locator column';
  END IF;

  RAISE NOTICE '0118 OK: moves, undo and the Moth trash are in place';
END $$;
