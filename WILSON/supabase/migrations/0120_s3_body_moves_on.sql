-- =============================================================================
-- 0120_s3_body_moves_on.sql — M.O.T.H. Session 1 (MO1), the last database change of the session.
-- (docs/design/MOTH_DESIGN.md section 1.4's entry for 0120; its notes for 0118 and 0121 say what it owes.)
--
-- WHAT IT TURNS ON
-- ----------------
--   A file in a company's own bucket may move between projects, and a file may move into that bucket.
--   Until now rabbit_private.s3_body_moves_on() answered false and both were refused (s3_moves_off).
--
-- WHAT IT OWED BEFORE IT COULD
-- ----------------------------
--   §1  The look. file_key_admissible looks for an object only in Petal's storage, so a key in a company's
--       own bucket would be taken on the caller's word, and the only body queued for deletion. A database
--       cannot reach a bucket: storage-presign's server does (its `look` op, a signed HEAD through
--       _shared/s3Reach.ts), and tells this file through s3_body_look_record, which only service_role may
--       call. So rabbit_private.s3_body_looks says: Petal's server saw an object at this key, in this bucket,
--       on this day. A look never spent is a copy nobody moved, and no scan ever walks a company's bucket
--       (SYSTEMS_HANDBOOK 12.4): a nightly job queues it for the drain, whose row check keeps what a row names.
--   §2  files_body_follow takes a key in a company's own bucket only on such a look, and spends it.
--   §3  fn_moth_apply_moves compares the plan's to_provider at the commit. A company whose storage changed
--       between the plan and the commit holds its copy in the wrong place, whatever the key says. And a copy
--       offered for a file already at its destination is refused, so the client takes it back.
--   §4  s3_body_moves_on() answers true, and is stable now, not immutable. An immutable function folds to a
--       constant in a connection's cached plans, so turning it off again would not reach a live connection.
--
-- ORDER, AND WHY BOTH ARE GOOD
-- ----------------------------
--   0120 has the lower number and came later in time. On wilson-dev, and wherever 0121 is already applied,
--   this file runs after 0121; on CI's fresh stack it runs before it. It holds either way because 0121
--   restates eleven functions and none of them is one of the three this file restates, nor does this file
--   touch any of those eleven (0121's own pre-flight names them): files_body_follow is 0114's text and
--   fn_moth_apply_moves 0118's, on every database, 0121 or not, so the pins below read the same. Nothing here
--   undoes 0121, and 0121's pre-flight has nothing here to refuse.
--
-- BEFORE IT, ON EACH ENVIRONMENT (docs/PRODUCTION_RUNBOOK.md, this file's row)
-- ----------------------------------------------------------------------------
--   storage-presign and storage-read-urls both verified deployed, by the functions list and a source
--   comparison. A database cannot ask that, so no pre-flight here can. On an older storage-presign a look
--   answers bad_request, nothing is recorded, and a move into the bucket is refused here: safe, and it says
--   why. On an older storage-read-urls a moved file's picture and preview are refused: the reason for the rule.
--
-- One table in a private schema, no policy, no client grant; its foreign key takes SHARE ROW EXCLUSIVE on
-- public.workspaces for a moment. One nightly job. Suite 123_s3_body_moves_on.sql.
-- =============================================================================

SET LOCAL lock_timeout = '15s';

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
DECLARE
  v_md5 TEXT;
  v_fn  RECORD;
BEGIN
  IF to_regprocedure('public.moth_history_read(uuid,timestamp with time zone,uuid,integer)') IS NULL THEN
    RAISE EXCEPTION '0120 refused: 0119 must be applied first';
  END IF;
  IF to_regnamespace('rabbit_private') IS NULL
     OR to_regprocedure('rabbit_private.file_key_shape_ok(text)') IS NULL
     OR to_regprocedure('rabbit_private.storage_object_claimed(text,text)') IS NULL
     OR to_regprocedure('public.can_presign_object(text,text)') IS NULL THEN
    RAISE EXCEPTION '0120 refused: the helpers of 0114 and 0115 are missing';
  END IF;
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0120 refused: % does not bypass row security', current_user;
  END IF;
  -- The bodies this restates, or this file's own on a second run. 0121 restates none of them.
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('rabbit_private.s3_body_moves_on()', '7d69bbf21ad55293e15c24da50eaaa11', 'ad10d2d261acf04c0fdea047663ee33d'),
      ('rabbit_private.files_body_follow(uuid,uuid,jsonb)', '7fbcada9dbca2acb598c44931fa4824e', 'f158bac580bbd4d2841ae7fc5141d121'),
      ('public.fn_moth_apply_moves(jsonb,uuid,boolean)', '9ac229b02757bd23beac8ef17a36d18b', '9255a74c810834f59b349701b8cdf38f')
    ) AS t(sig, was, now_is)
  LOOP
    SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc WHERE oid = v_fn.sig::regprocedure;
    IF v_md5 IS DISTINCT FROM v_fn.was AND v_md5 IS DISTINCT FROM v_fn.now_is THEN
      RAISE EXCEPTION '0120 refused: % is not the body this file was built on (md5 %)', v_fn.sig, v_md5;
    END IF;
  END LOOP;
END $$;

-- §1 The look --------------------------------------------------------------------
-- Petal's server saw an object at this key, in the bucket bucket_mark names. Nothing here is read by a client,
-- and the key holds a file's name, so the table is closed to every client role and lives outside what
-- PostgREST serves. It goes with its company. Its rows are few: one for each copy between its look and its
-- commit, and the nightly sweep takes what was never spent.
CREATE TABLE IF NOT EXISTS rabbit_private.s3_body_looks (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  object_path  TEXT NOT NULL,
  bucket_mark  TEXT NOT NULL,
  seen_by      UUID NOT NULL,
  seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, object_path)
);
ALTER TABLE rabbit_private.s3_body_looks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE rabbit_private.s3_body_looks FROM PUBLIC, anon, authenticated, service_role;

-- Which bucket a company's new bodies go to, as a mark: an admin who repoints it has a different bucket, and
-- a look at the old one says nothing about the new. NULL for a company not on its own bucket now.
CREATE OR REPLACE FUNCTION rabbit_private.s3_bucket_mark(p_workspace uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT md5(concat_ws('|', ws.provider_config ->> 'endpoint', ws.provider_config ->> 'bucket', ws.provider_config ->> 'prefix'))
    FROM public.workspace_storage ws
   WHERE ws.workspace_id = p_workspace AND ws.mode = 'byos' AND ws.provider = 's3';
$$;
REVOKE ALL ON FUNCTION rabbit_private.s3_bucket_mark(uuid) FROM PUBLIC, anon, authenticated;

-- The only writer. The Edge Function has already asked can_presign_object as the caller, for the rights to
-- write this key, and made the look; this asks again only what the shape and the company can say.
CREATE OR REPLACE FUNCTION public.s3_body_look_record(p_workspace uuid, p_path text, p_user uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_mark TEXT := rabbit_private.s3_bucket_mark(p_workspace);
BEGIN
  IF v_mark IS NULL OR p_user IS NULL OR NOT COALESCE(rabbit_private.file_key_shape_ok(p_path), false)
     OR NOT EXISTS (SELECT 1 FROM public.projects p
                     WHERE p.id = public.fn_try_uuid(split_part(p_path, '/', 2))
                       AND p.workspace_id = p_workspace
                       AND p.deleted_at IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.workspace_members wm
                     WHERE wm.workspace_id = p_workspace AND wm.user_id = p_user AND wm.is_active) THEN
    RETURN false;
  END IF;
  INSERT INTO rabbit_private.s3_body_looks (workspace_id, object_path, bucket_mark, seen_by, seen_at)
  VALUES (p_workspace, p_path, v_mark, p_user, now())
  ON CONFLICT (workspace_id, object_path) DO UPDATE
    SET bucket_mark = EXCLUDED.bucket_mark, seen_by = EXCLUDED.seen_by, seen_at = EXCLUDED.seen_at;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.s3_body_look_record(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.s3_body_look_record(uuid, text, uuid) TO service_role;

-- A look a day old is past spending, so its copy will never be named: queue it and its picture for the drain,
-- unless a row names the key after all, and let the name go. A PUT that never reached its look has no record,
-- and stays with the company's own lifecycle rules, as a stranded upload always has (SYSTEMS_HANDBOOK 12.7a).
CREATE OR REPLACE FUNCTION rabbit_private.s3_body_looks_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  WITH gone AS (
    DELETE FROM rabbit_private.s3_body_looks l
     WHERE l.seen_at <= now() - interval '1 day'
    RETURNING l.workspace_id, l.object_path
  ), said AS (
    SELECT count(*)::int AS n FROM gone
  ), queued AS (
    INSERT INTO public.storage_gc_queue (bucket_id, object_path, workspace_id, file_id, reason, provider, kind)
    SELECT 'byo-s3', k.path, g.workspace_id, NULL, 'orphan-scan', 's3', k.kind
      FROM gone g
     CROSS JOIN LATERAL (VALUES (g.object_path, 'body'), (g.object_path || '.jpg', 'thumbnail')) AS k(path, kind)
     WHERE NOT EXISTS (SELECT 1 FROM public.files f
                        WHERE f.storage_provider = 's3' AND k.path IN (f.storage_path, f.thumbnail_url))
    RETURNING 1
  )
  SELECT said.n INTO v_n FROM said LEFT JOIN (SELECT count(*) FROM queued) q ON true;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION rabbit_private.s3_body_looks_sweep() FROM PUBLIC, anon, authenticated;

-- cron.schedule() upserts by job name, so a re-run is idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule(
      'wilson-sweep-s3-looks',
      '53 4 * * *',
      $job$ SELECT rabbit_private.s3_body_looks_sweep(); $job$
    );
  ELSE
    RAISE NOTICE 'pg_cron unavailable — the sweep of unspent looks is not scheduled (expected in CI local stack)';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'could not schedule the sweep of unspent looks via pg_cron: %', SQLERRM;
END $$;

-- §2 A key in a company's own bucket, only on a look --------------------------------
CREATE OR REPLACE FUNCTION rabbit_private.files_body_follow(p_file uuid, p_dest_project uuid, p_rehome jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_f           public.files%ROWTYPE;
  v_provider    TEXT;
  v_needs       BOOLEAN;
  v_item        JSONB;
  v_to_provider TEXT;
  v_to_path     TEXT;
  v_to_thumb    TEXT;
  v_company     TEXT;
  v_retire      JSONB := '[]'::jsonb;
BEGIN
  SELECT * INTO v_f FROM public.files f WHERE f.id = p_file;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'body_missing' USING DETAIL = 'That file is not there any more.';
  END IF;
  v_provider := v_f.storage_provider::text;

  IF v_provider IN ('google_drive', 'network_share') THEN
    RAISE EXCEPTION 'body_elsewhere' USING DETAIL = 'This file is kept outside WILSON''s storage, so it cannot move this way.';
  END IF;
  IF v_provider = 's3' AND NOT rabbit_private.s3_body_moves_on() THEN
    RAISE EXCEPTION 's3_moves_off' USING DETAIL = 'Files in your company''s own bucket cannot move between projects yet.';
  END IF;
  IF v_provider = 'supabase'
     AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'rabbit-files' AND o.name = v_f.storage_path) THEN
    RAISE EXCEPTION 'body_missing' USING DETAIL = 'This file''s stored copy is missing, so it cannot move.';
  END IF;
  IF NOT rabbit_private.file_key_shape_ok(v_f.storage_path) THEN
    RAISE EXCEPTION 'body_shape' USING DETAIL = 'This file is stored in a way that cannot move between projects.';
  END IF;

  -- A body on one computer, or a key naming a private project or a personal space
  -- other than the destination, is copied: no hidden id reaches the destination.
  v_needs := v_provider = 'local_server'
    OR EXISTS (SELECT 1 FROM public.projects p
                WHERE p.id = public.fn_try_uuid(split_part(v_f.storage_path, '/', 2))
                  AND p.id <> p_dest_project
                  AND p.is_private);
  SELECT e INTO v_item
    FROM jsonb_array_elements(COALESCE(p_rehome, '[]'::jsonb)) e
   WHERE e->>'file_id' = p_file::text
   LIMIT 1;

  IF v_needs AND v_item IS NULL THEN
    RAISE EXCEPTION 'needs_copy' USING DETAIL = 'This file has to be copied to the new project first.';
  END IF;
  IF NOT v_needs AND v_item IS NOT NULL THEN
    RAISE EXCEPTION 'copy_not_needed' USING DETAIL = 'This file does not need a new copy to move.';
  END IF;

  IF v_item IS NULL THEN
    -- By association: the key stays. A blank picture names nothing: it is cleared, and
    -- nothing is retired. A legacy picture elsewhere is detached.
    IF btrim(v_f.thumbnail_url) = '' THEN
      RETURN jsonb_build_object('set', jsonb_build_object('thumbnail_url', NULL), 'retire', '[]'::jsonb);
    END IF;
    IF v_f.thumbnail_url IS NOT NULL AND v_f.thumbnail_url <> v_f.storage_path || '.jpg' THEN
      RETURN jsonb_build_object(
        'set', jsonb_build_object('thumbnail_url', NULL),
        'retire', jsonb_build_array(jsonb_build_object(
          'bucket', CASE WHEN v_provider = 's3' THEN 'byo-s3' ELSE 'rabbit-thumbnails' END,
          'path', v_f.thumbnail_url,
          'provider', CASE WHEN v_provider = 's3' THEN 's3' ELSE 'supabase' END,
          'kind', 'thumbnail')));
    END IF;
    RETURN jsonb_build_object('set', '{}'::jsonb, 'retire', '[]'::jsonb);
  END IF;

  v_to_provider := v_item->>'to_provider';
  v_to_path := v_item->>'to_path';
  v_to_thumb := v_item->>'to_thumb';
  v_company := public.fn_moth_body_provider_for(v_f.workspace_id);
  IF v_company = 'network_share' THEN
    RAISE EXCEPTION 'copy_refused' USING DETAIL = 'A file moves onto your office server from the desktop app.';
  END IF;
  IF v_to_provider IS DISTINCT FROM v_company
     OR NOT COALESCE(rabbit_private.file_key_admissible(v_to_provider, v_to_path, p_dest_project, p_file, NULL, false), false)
     OR split_part(v_to_path, '/', 3) IS DISTINCT FROM 'files'
     OR NOT (v_to_thumb IS NULL OR v_to_thumb = v_to_path || '.jpg') THEN
    RAISE EXCEPTION 'copy_refused' USING DETAIL = 'The new copy is not one this project can use.';
  END IF;
  -- 0120: a key in a company's own bucket is taken only on a look. file_key_admissible sees only Petal's
  -- storage, and the lines below queue what may be the only body. storage-presign's server made the look,
  -- and it is spent here, so the row that names the key has paid for it once.
  IF v_to_provider = 's3' THEN
    DELETE FROM rabbit_private.s3_body_looks l
     WHERE l.workspace_id = v_f.workspace_id
       AND l.object_path = v_to_path
       AND l.bucket_mark = rabbit_private.s3_bucket_mark(v_f.workspace_id)
       AND l.seen_at > now() - interval '1 day';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'copy_not_seen' USING DETAIL = 'The new copy could not be found in your company''s bucket, so nothing moved.';
    END IF;
  END IF;

  -- The old copy and picture are queued; a local original is removed by its desktop.
  IF v_provider IN ('supabase', 's3') THEN
    v_retire := v_retire || jsonb_build_object(
      'bucket', CASE WHEN v_provider = 's3' THEN 'byo-s3' ELSE 'rabbit-files' END,
      'path', v_f.storage_path, 'provider', v_provider, 'kind', 'body');
  END IF;
  IF v_f.thumbnail_url IS NOT NULL AND btrim(v_f.thumbnail_url) <> '' THEN
    v_retire := v_retire || jsonb_build_object(
      'bucket', CASE WHEN v_provider = 's3' THEN 'byo-s3' ELSE 'rabbit-thumbnails' END,
      'path', v_f.thumbnail_url,
      'provider', CASE WHEN v_provider = 's3' THEN 's3' ELSE 'supabase' END,
      'kind', 'thumbnail');
  END IF;
  RETURN jsonb_build_object(
    'set', jsonb_build_object('storage_provider', v_to_provider, 'storage_path', v_to_path, 'thumbnail_url', v_to_thumb),
    'retire', v_retire);
END;
$$;
REVOKE EXECUTE ON FUNCTION rabbit_private.files_body_follow(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- §3 The plan's provider, compared at the commit -----------------------------------
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
  v_lost       integer := 0;
  v_pictures   integer := 0;
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
        -- 0120: someone else moved it here first. Its copy has no move to go with, and a refusal is what
        -- tells the client to take it back; a company's bucket has no scan to find it later.
        IF v_body IS NOT NULL THEN
          RAISE EXCEPTION 'moth_move:plan_changed' USING ERRCODE = 'P0001';
        END IF;
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
          PERFORM public._moth_share_folders_asked(v_ws, ARRAY[f.project_id, v_to_project]);
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
            -- files_body_follow's switch asks only where the body is now. Turned off again, nothing new
            -- goes into a company's own bucket; on, files_body_follow takes a key there only on a look.
            IF v_company = 's3' AND NOT rabbit_private.s3_body_moves_on() THEN
              RAISE EXCEPTION 'moth_move:s3_moves_off' USING ERRCODE = 'P0001',
                DETAIL = 'Files cannot move into your company''s own bucket yet.';
            END IF;
            -- 0120: the plan said where the copy was to go, and the client made it there. A company whose
            -- storage changed since holds that copy in the wrong place, whatever the key says.
            IF v_body IS NOT NULL AND v_body ->> 'to_provider' IS DISTINCT FROM v_company THEN
              RAISE EXCEPTION 'moth_move:plan_changed' USING ERRCODE = 'P0001';
            END IF;

            IF v_company = 'network_share' THEN
              IF v_how <> 'copy_up' THEN
                RAISE EXCEPTION 'moth_move:copy_refused' USING ERRCODE = 'P0001',
                  DETAIL = 'A file moves onto your office server from the desktop app.';
              END IF;
              PERFORM public._moth_share_folders_asked(v_ws, ARRAY[v_to_project]);
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
                IF v_tail IS NULL OR v_tail !~ '^[0-9]{10,16}-' THEN
                  RAISE EXCEPTION 'moth_move:copy_refused' USING ERRCODE = 'P0001',
                    DETAIL = 'The new copy is not one this project can use.';
                END IF;
                -- Renamed while the copy was being made: plan again, rather than read as a bad key.
                IF regexp_replace(v_tail, '^[0-9]{10,16}-', '') <> public._moth_key_leaf(f.name) THEN
                  RAISE EXCEPTION 'moth_move:plan_changed' USING ERRCODE = 'P0001';
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
        -- What an undo could not bring back, so the person is told rather than left to find out.
        IF q ? 'back' AND f.project_id <> v_to_project THEN
          v_lost := v_lost + (SELECT count(*)::int FROM jsonb_each_text(q -> 'back' -> 'links') e
                               WHERE e.value IS NOT NULL AND v_to_links ->> e.key IS NULL);
          IF btrim(COALESCE(q -> 'back' ->> 'thumb', '')) <> '' AND btrim(COALESCE(v_to_thumb, '')) = '' THEN
            v_pictures := v_pictures + 1;
          END IF;
        END IF;
      END IF;
    END LOOP;
    PERFORM set_config('wilson.network_share_asked', '', true);

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

    RETURN jsonb_build_object('move_id', v_move, 'moved', jsonb_array_length(v_journal), 'links_cleared', v_cleared, 'ops', v_ops)
      || CASE WHEN p_undo_of IS NOT NULL
              THEN jsonb_build_object('links_not_restored', v_lost, 'pictures_not_restored', v_pictures)
              ELSE '{}'::jsonb END;
  EXCEPTION
  WHEN foreign_key_violation THEN
    -- A link or a folder deleted between the read and the write: no constraint's name goes out.
    RAISE EXCEPTION 'moth_move:changed_since' USING ERRCODE = 'P0001';
  WHEN raise_exception THEN
    -- One vocabulary for the client: the body contract's codes and the office server's.
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
    IF v_msg IN ('body_missing', 'body_shape', 's3_moves_off', 'body_elsewhere', 'needs_copy', 'copy_not_needed', 'copy_refused', 'copy_not_seen') THEN
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

-- §4 The switch --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rabbit_private.s3_body_moves_on()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT true;
$$;
REVOKE EXECUTE ON FUNCTION rabbit_private.s3_body_moves_on() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION rabbit_private.s3_body_moves_on() TO authenticated, service_role;

COMMENT ON TABLE rabbit_private.s3_body_looks IS
  'Petal''s server saw an object at this key in the company''s own bucket (storage-presign, op look). files_body_follow spends a look to take a key there. 0120.';
COMMENT ON FUNCTION public.s3_body_look_record(uuid, text, uuid) IS
  'Records a look, for service_role alone: storage-presign calls it after its own signed HEAD answers 200. False for a key no project of this company could hold, or a person not an active member of it. 0120.';
COMMENT ON FUNCTION rabbit_private.s3_body_moves_on() IS
  'True since 0120, which is applied on an environment only after its storage-presign and storage-read-urls are verified deployed. Back to false stops new moves into a company''s own bucket, and of files in one; a file already moved stays readable. Stable, so that reaches a live connection.';

-- §5 Post-conditions -------------------------------------------------------------
DO $$
DECLARE
  v_fn  RECORD;
  v_md5 TEXT;
BEGIN
  IF rabbit_private.s3_body_moves_on() IS NOT TRUE THEN
    RAISE EXCEPTION '0120 post-condition: s3_body_moves_on must answer true';
  END IF;
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('rabbit_private.s3_body_moves_on()', 'ad10d2d261acf04c0fdea047663ee33d'),
      ('rabbit_private.files_body_follow(uuid,uuid,jsonb)', 'f158bac580bbd4d2841ae7fc5141d121'),
      ('public.fn_moth_apply_moves(jsonb,uuid,boolean)', '9255a74c810834f59b349701b8cdf38f'),
      ('public.s3_body_look_record(uuid,text,uuid)', '97882da3735db6ad63a9fe4889b6c875'),
      ('rabbit_private.s3_bucket_mark(uuid)', '2a94f478addfcd8b22994d05e4a0610e'),
      ('rabbit_private.s3_body_looks_sweep()', 'becd72a140ff9dbb6dc0c917c9df3abd')
    ) AS t(sig, now_is)
  LOOP
    SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc WHERE oid = v_fn.sig::regprocedure;
    IF v_md5 IS DISTINCT FROM v_fn.now_is THEN
      RAISE EXCEPTION '0120 post-condition: % is not this file''s body (md5 %)', v_fn.sig, v_md5;
    END IF;
  END LOOP;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'rabbit_private.s3_body_moves_on()'::regprocedure) <> 's' THEN
    RAISE EXCEPTION '0120 post-condition: s3_body_moves_on must be stable, or turning it off would not reach a live connection';
  END IF;
  -- Nested: one expression is parsed whole, so cron.job would be read with no pg_cron to hold it.
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wilson-sweep-s3-looks') THEN
      RAISE EXCEPTION '0120 post-condition: the sweep of unspent looks is not scheduled';
    END IF;
  END IF;
  IF has_function_privilege('authenticated', 'rabbit_private.s3_bucket_mark(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'rabbit_private.s3_bucket_mark(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'rabbit_private.s3_body_looks_sweep()', 'EXECUTE')
     OR has_function_privilege('anon', 'rabbit_private.s3_body_looks_sweep()', 'EXECUTE') THEN
    RAISE EXCEPTION '0120 post-condition: a private helper is open to a client';
  END IF;
  IF has_function_privilege('anon', 'public.s3_body_look_record(uuid,text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.s3_body_look_record(uuid,text,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.s3_body_look_record(uuid,text,uuid)', 'EXECUTE')
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.s3_body_look_record(uuid,text,uuid)'::regprocedure) THEN
    RAISE EXCEPTION '0120 post-condition: s3_body_look_record has the wrong grants or runs as the wrong role';
  END IF;
  IF has_function_privilege('authenticated', 'rabbit_private.files_body_follow(uuid,uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_moth_apply_moves(jsonb,uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'rabbit_private.s3_body_moves_on()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'rabbit_private.s3_body_moves_on()', 'EXECUTE') THEN
    RAISE EXCEPTION '0120 post-condition: a restated function has the wrong grants';
  END IF;
  IF has_table_privilege('anon', 'rabbit_private.s3_body_looks', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'rabbit_private.s3_body_looks', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('service_role', 'rabbit_private.s3_body_looks', 'SELECT,INSERT,UPDATE,DELETE')
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'rabbit_private.s3_body_looks'::regclass) THEN
    RAISE EXCEPTION '0120 post-condition: s3_body_looks is open to a client';
  END IF;
END $$;
