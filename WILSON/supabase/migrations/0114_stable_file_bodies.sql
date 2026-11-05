-- =============================================================================
-- 0114_stable_file_bodies.sql — M.O.T.H. Session 1 (MO1): a file's stored copy
-- stays at the key it was made under, and clients can no longer change where a
-- file is kept or filed (docs/design/MOTH_DESIGN.md §1.2 "files column guards",
-- §1.4 "0114", §1.5, §2.1 SB-2 to SB-5, SB-8 to SB-13, SB-18).
--
-- WHAT IS NEW
-- -----------
--   §1  Schema rabbit_private: helpers the API never exposes.
--   §2  files.share_missing_since and share_bin_path, written only by the office-
--       server writers (0117). The six indexes the helpers need, two of them unique.
--   §3  The helpers. storage_object_claimed: does any record, anywhere, still name
--       this stored copy? storage_object_current_project: which project answers for
--       it, read as the caller. file_key_admissible: may this caller's new row claim
--       this key? files_body_follow and files_body_retire: the checked move's hook
--       (nothing calls them until 0118). s3_body_moves_on: false until 0120.
--   §4  fn_files_body_guard, the one guard on a file's project, folder and locator.
--       A client never changes them, which also closes the last route around the
--       folder chain 0111 walks: until now a plain patch could clear folder_id.
--       A file also keeps its id, as a folder and a project do.
--   §5  rekey_file_body: the one client path that changes a stored key after insert
--       (the shot re-file and the migration's receipt move).
--   §6  fn_projects_owner_guard restated from 0110: an id tied to another company
--       cannot be created here.
--   §7  fn_same_project_refs_guard restated from 0107 without the wilson.checked_move
--       skip: §1.2 settles that no such setting exists anywhere.
--   §8  COMMENTs; §9 post-conditions.
--
-- WHAT THIS BREAKS FOR AN OLD BUILD, ON PURPOSE
-- ---------------------------------------------
-- rewriteFileRow and runMigration.moveReceipt patched the row directly. On an old build
-- a re-file puts its object back and says so. A receipt move has no put-back there: it
-- says its sentence, and the copy stays at its invoices key with no row naming it, where
-- storage-gc's orphan scan can delete it after 24 hours. So the adapter changes ship in
-- the same release as this file, and no desktop-to-cloud migration runs on an old build
-- against it.
--
-- One transaction, no enum use: providers compare as text or by the labels 0051
-- made, and the network_share label exists only as text here (0112). Re-runnable.
-- Suite 115_stable_file_bodies.sql. 0115 restates the storage policies on §3.
-- =============================================================================

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
DECLARE
  v_n   BIGINT;
  v_md5 TEXT;
BEGIN
  IF to_regprocedure('public.fn_checked_move_admits(uuid,uuid,uuid,text,text)') IS NULL
     OR to_regprocedure('public.moth_folder_chain_locked(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '0114 refused: 0111 and 0113 must be applied first';
  END IF;
  IF NOT EXISTS (SELECT 1
                   FROM pg_enum e
                   JOIN pg_type t ON t.oid = e.enumtypid
                   JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'public' AND t.typname = 'storage_provider' AND e.enumlabel = 'network_share') THEN
    RAISE EXCEPTION '0114 refused: 0112 must be applied and committed first';
  END IF;
  -- The definers below read tables with row security on (0069's lesson).
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0114 refused: % does not bypass row security', current_user;
  END IF;

  -- Two bodies are restated below. Another migration may have moved them.
  SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc WHERE oid = 'public.fn_projects_owner_guard()'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'b6b800f4448eb9723f4afab2e6d97ec0' AND v_md5 IS DISTINCT FROM 'ba4ac337fa62d309793dfd99af6f99c8' THEN
    RAISE EXCEPTION '0114 refused: fn_projects_owner_guard is neither 0110''s body nor this file''s (md5 %)', v_md5;
  END IF;
  SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc WHERE oid = 'public.fn_same_project_refs_guard()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '0b9168eacf60b901d4622c155b698657' AND v_md5 IS DISTINCT FROM '82b6e03f94ea926fabb3e4a90c215eb4' THEN
    RAISE EXCEPTION '0114 refused: fn_same_project_refs_guard is neither 0107''s body nor this file''s (md5 %)', v_md5;
  END IF;

  -- Taken before the counts, so nothing lands between them and the unique indexes.
  LOCK TABLE public.files IN SHARE ROW EXCLUSIVE MODE;

  -- A non-zero count stops here: someone decides each row. Nothing repairs itself.
  SELECT count(*) INTO v_n FROM (
    SELECT storage_path FROM public.files
     WHERE storage_provider::text IN ('supabase', 's3', 'local_server')
     GROUP BY storage_path HAVING count(*) > 1) x;
  IF v_n > 0 THEN
    RAISE EXCEPTION '0114 refused: % stored key(s) are named by more than one file row', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM (
    SELECT regexp_replace(storage_path, '(\.jpg)+$', '') FROM public.files
     WHERE storage_provider::text = 's3'
     GROUP BY 1 HAVING count(*) > 1) x;
  IF v_n > 0 THEN
    RAISE EXCEPTION '0114 refused: % s3 key(s) collide once .jpg is set aside', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.files
   WHERE storage_provider::text IN ('supabase', 's3', 'local_server')
     AND lower(split_part(storage_path, '/', 2)) <> project_id::text;
  IF v_n > 0 THEN
    RAISE EXCEPTION '0114 refused: % file row(s) have a key whose second segment is not their project', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.files f
    JOIN public.projects p ON p.id = public.fn_try_uuid(split_part(f.storage_path, '/', 2))
   WHERE f.storage_provider::text IN ('supabase', 's3', 'local_server')
     AND p.workspace_id <> f.workspace_id;
  IF v_n > 0 THEN
    RAISE EXCEPTION '0114 refused: % file row(s) have a key under another company''s project', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.files
   WHERE storage_provider::text NOT IN ('supabase', 's3', 'local_server')
     AND storage_path LIKE 'projects/%';
  IF v_n > 0 THEN
    RAISE EXCEPTION '0114 refused: % file row(s) on another provider have a key under projects/', v_n;
  END IF;
  -- A client could write this provider between 0112's commit and this guard
  -- (the review round of 0112 and 0113). Past here it could not be repaired by one.
  SELECT count(*) INTO v_n FROM public.files WHERE storage_provider::text = 'network_share';
  IF v_n > 0 THEN
    RAISE EXCEPTION '0114 refused: % file row(s) already say network_share, which nothing has written yet', v_n;
  END IF;

  -- Counted, not refused (db query drops a NOTICE; the rehearsal measures them).
  SELECT count(*) INTO v_n FROM public.files
   WHERE thumbnail_url IS NOT NULL AND thumbnail_url <> storage_path || '.jpg';
  RAISE NOTICE '0114: % legacy picture(s)', v_n;
  SELECT count(*) INTO v_n FROM public.files
   WHERE storage_provider::text IN ('supabase', 's3')
     AND NOT (lower(split_part(storage_path, '/', 3)) IN ('scenes', 'shots', 'levels', 'experiences', 'assets', 'tasks',
                                                          'phases', 'project', 'files', 'invoices', 'legal'));
  RAISE NOTICE '0114: % key(s) whose third segment is outside the allowlist or reserved', v_n;
END $$;

-- §1 The schema ---------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS rabbit_private;
REVOKE ALL ON SCHEMA rabbit_private FROM PUBLIC;
GRANT USAGE ON SCHEMA rabbit_private TO authenticated, service_role;

-- §2 Columns and indexes ---------------------------------------------------------------
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS share_missing_since timestamptz;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS share_bin_path text;

-- A stored key has at most one row, in every trash state. network_share has its own
-- index and namespace (0117).
CREATE UNIQUE INDEX IF NOT EXISTS files_storage_path_key_uidx
  ON public.files (storage_path text_pattern_ops)
  WHERE storage_provider IN ('supabase', 's3', 'local_server');
-- In a company's own bucket a body and its picture share names: K and K.jpg.
CREATE UNIQUE INDEX IF NOT EXISTS files_s3_namespace_uidx
  ON public.files ((regexp_replace(storage_path, '(\.jpg)+$', '')))
  WHERE storage_provider = 's3';
CREATE INDEX IF NOT EXISTS files_moved_body_ws_idx
  ON public.files (workspace_id)
  WHERE storage_provider = 'supabase' AND lower(split_part(storage_path, '/', 2)) <> project_id::text;
CREATE INDEX IF NOT EXISTS storage_gc_queue_claim_idx
  ON public.storage_gc_queue (bucket_id, object_path)
  WHERE file_id IS NOT NULL AND status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS file_events_purged_path_idx
  ON public.file_events (old_path)
  WHERE event = 'purged';
CREATE INDEX IF NOT EXISTS file_events_project_any_idx
  ON public.file_events (project_id);

-- §3 The helpers ------------------------------------------------------------------------
-- The shape every client key has: projects/<project>/<segment>/…/<leaf>.
CREATE OR REPLACE FUNCTION rabbit_private.file_key_shape_ok(p_path text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_segs text[] := string_to_array(COALESCE(p_path, ''), '/');
  v_seg  text;
BEGIN
  IF length(COALESCE(p_path, '')) > 1024
     OR COALESCE(array_length(v_segs, 1), 0) < 5
     OR v_segs[1] <> 'projects'
     OR lower(v_segs[3]) NOT IN ('scenes', 'shots', 'levels', 'experiences', 'assets', 'tasks',
                                 'phases', 'project', 'files', 'invoices', 'legal') THEN
    RETURN false;
  END IF;
  FOREACH v_seg IN ARRAY v_segs LOOP
    IF v_seg !~ '^[A-Za-z0-9._-]+$' OR v_seg IN ('.', '..') THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION rabbit_private.file_key_shape_ok(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION rabbit_private.file_key_shape_ok(text) TO authenticated, service_role;

-- SB-4. Across every company, because a stored copy can outlive its project.
CREATE OR REPLACE FUNCTION rabbit_private.storage_object_claimed(p_bucket text, p_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_bare TEXT;
BEGIN
  -- Row-less shapes: a bin poster, a connection check, a manifest, a rate card.
  IF p_name IS NULL
     OR lower(split_part(p_name, '/', 3)) IN ('bin_files', 'connection-check')
     OR p_name ~ '^projects/[^/]+/PROJECT\.json$'
     OR p_name ~ '^projects/[^/]+/FINANCE/RATES\.json$' THEN
    RETURN false;
  END IF;

  -- 1. A files row in any trash state that names it.
  IF p_bucket = 'rabbit-files' THEN
    IF EXISTS (SELECT 1 FROM public.files f
                WHERE f.storage_path = p_name AND f.storage_provider IN ('supabase', 'local_server')) THEN
      RETURN true;
    END IF;
  ELSIF p_bucket = 'rabbit-thumbnails' THEN
    IF right(p_name, 4) = '.jpg'
       AND EXISTS (SELECT 1 FROM public.files f
                    WHERE f.storage_path = left(p_name, -4) AND f.storage_provider IN ('supabase', 'local_server')) THEN
      RETURN true;
    END IF;
  ELSIF p_bucket = 'byo-s3' THEN
    v_bare := regexp_replace(p_name, '(\.jpg)+$', '');
    IF EXISTS (SELECT 1 FROM public.files f
                WHERE f.storage_provider = 's3'
                  AND regexp_replace(f.storage_path, '(\.jpg)+$', '') = v_bare) THEN
      RETURN true;
    END IF;
  END IF;

  -- 2. A purge-queue row that names a file and has not been drained.
  IF EXISTS (SELECT 1 FROM public.storage_gc_queue q
              WHERE q.bucket_id = p_bucket AND q.object_path = p_name
                AND q.file_id IS NOT NULL AND q.status IN ('pending', 'failed')) THEN
    RETURN true;
  END IF;

  -- 3. The purge certificate of a moved copy: its key names another project.
  RETURN EXISTS (
    SELECT 1 FROM public.file_events e
     WHERE e.event = 'purged'
       AND (e.old_path = p_name
            OR (right(p_name, 4) = '.jpg' AND p_bucket IN ('rabbit-thumbnails', 'byo-s3') AND e.old_path = left(p_name, -4))
            OR (p_bucket = 'byo-s3' AND e.old_path = p_name || '.jpg'))
       AND CASE WHEN p_bucket = 'byo-s3' THEN e.storage_provider = 's3'
                ELSE e.storage_provider IN ('supabase', 'local_server') END
       AND e.project_id IS DISTINCT FROM public.fn_try_uuid(split_part(e.old_path, '/', 2))
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION rabbit_private.storage_object_claimed(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION rabbit_private.storage_object_claimed(text, text) TO authenticated, service_role;

-- SB-5. INVOKER on purpose: files_select decides as the caller, so a trashed file, a
-- hidden project or a money row the caller may not see answers NULL. plpgsql because
-- a storage policy calls it once per object (the trap of 0111's read path).
CREATE OR REPLACE FUNCTION rabbit_private.storage_object_current_project(p_bucket text, p_name text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_n       BIGINT := 0;
  v_project UUID;
BEGIN
  IF p_bucket = 'rabbit-files' THEN
    SELECT count(*), (array_agg(f.project_id))[1] INTO v_n, v_project
      FROM public.files f
     WHERE f.storage_path = p_name AND f.storage_provider IN ('supabase', 'local_server');
  ELSIF p_bucket = 'rabbit-thumbnails' THEN
    IF right(p_name, 4) = '.jpg' THEN
      SELECT count(*), (array_agg(f.project_id))[1] INTO v_n, v_project
        FROM public.files f
       WHERE f.storage_path = left(p_name, -4) AND f.storage_provider IN ('supabase', 'local_server');
    END IF;
  ELSIF p_bucket = 'byo-s3' THEN
    SELECT count(*), (array_agg(f.project_id))[1] INTO v_n, v_project
      FROM public.files f
     WHERE f.storage_provider = 's3'
       AND (f.storage_path = p_name OR (f.storage_path || '.jpg' = p_name AND f.thumbnail_url = p_name));
  END IF;
  RETURN CASE WHEN v_n = 1 THEN v_project END;
END;
$$;
REVOKE EXECUTE ON FUNCTION rabbit_private.storage_object_current_project(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION rabbit_private.storage_object_current_project(text, text) TO authenticated, service_role;

-- SB-9. A new row can vouch only for a never-claimed object under its own project,
-- which that project's readers could already read. Money is judged before any
-- existence probe, so its refusal says nothing about what exists (SEC-7). The same
-- id is excluded because a BEFORE trigger fires ahead of ON CONFLICT: the migration's
-- insertOrSkip reruns must reach their 23505.
CREATE OR REPLACE FUNCTION rabbit_private.file_key_admissible(
  p_provider text, p_path text, p_project uuid, p_file uuid, p_folder uuid, p_financial boolean)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_ws    UUID := public.current_workspace_id();
  v_third TEXT := split_part(COALESCE(p_path, ''), '/', 3);
BEGIN
  IF p_provider IS NULL OR p_path IS NULL OR p_project IS NULL OR v_ws IS NULL THEN
    RETURN false;
  END IF;
  -- 1. The caller's rights on the project.
  IF NOT EXISTS (SELECT 1 FROM public.projects p
                  WHERE p.id = p_project AND p.workspace_id = v_ws AND p.deleted_at IS NULL)
     OR NOT COALESCE(public.has_active_membership(v_ws), false)
     OR NOT COALESCE(public.passes_project_privacy(p_project), false)
     OR NOT COALESCE(public.can_write_project(p_project), false) THEN
    RETURN false;
  END IF;
  -- 2. Money and Legal.
  IF public.rabbit_legal_segment(v_third) THEN
    IF NOT COALESCE(public.can_access_project_legal(p_project), false) THEN
      RETURN false;
    END IF;
  ELSIF COALESCE(p_financial, false) OR public.rabbit_money_segment(v_third) THEN
    IF NOT COALESCE(public.can_access_project_money(p_project), false) THEN
      RETURN false;
    END IF;
  END IF;
  -- 3. The shape, under this project.
  IF NOT rabbit_private.file_key_shape_ok(p_path)
     OR lower(split_part(p_path, '/', 2)) <> p_project::text THEN
    RETURN false;
  END IF;
  -- 4. No other row names it, in any trash state.
  IF EXISTS (SELECT 1 FROM public.files f
              WHERE f.storage_path = p_path
                AND f.storage_provider IN ('supabase', 's3', 'local_server')
                AND f.id IS DISTINCT FROM p_file) THEN
    RETURN false;
  END IF;
  IF p_provider = 's3'
     AND EXISTS (SELECT 1 FROM public.files f
                  WHERE f.storage_provider = 's3'
                    AND regexp_replace(f.storage_path, '(\.jpg)+$', '') = regexp_replace(p_path, '(\.jpg)+$', '')
                    AND f.id IS DISTINCT FROM p_file) THEN
    RETURN false;
  END IF;
  -- 5. Neither it nor its picture is waiting to be purged, or certified as purged.
  IF EXISTS (SELECT 1 FROM public.storage_gc_queue q
              WHERE q.bucket_id IN ('rabbit-files', 'rabbit-thumbnails', 'byo-s3')
                AND q.object_path IN (p_path, p_path || '.jpg')
                AND q.file_id IS NOT NULL AND q.status IN ('pending', 'failed'))
     OR EXISTS (SELECT 1 FROM public.file_events e
                 WHERE e.event = 'purged'
                   AND e.old_path IN (p_path, p_path || '.jpg')
                   AND e.project_id IS DISTINCT FROM public.fn_try_uuid(split_part(e.old_path, '/', 2))) THEN
    RETURN false;
  END IF;
  -- 6. For Supabase, the object is there.
  IF p_provider = 'supabase'
     AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'rabbit-files' AND o.name = p_path) THEN
    RETURN false;
  END IF;
  -- 7. The folder is this project's, and an ordinary file is not filed in a money one.
  IF p_folder IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.folders fo WHERE fo.id = p_folder AND fo.project_id = p_project) THEN
      RETURN false;
    END IF;
    IF public.moth_folder_chain_locked(v_ws, p_folder)
       AND NOT public.file_row_is_money(p_financial, p_path) THEN
      RETURN false;
    END IF;
  END IF;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION rabbit_private.file_key_admissible(text, text, uuid, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION rabbit_private.file_key_admissible(text, text, uuid, uuid, uuid, boolean) TO authenticated, service_role;

-- SB-13. Restated as true by 0120, only after the new storage-presign is verified
-- deployed on that environment: the deployed one authorises by key prefix.
CREATE OR REPLACE FUNCTION rabbit_private.s3_body_moves_on()
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT false;
$$;
REVOKE EXECUTE ON FUNCTION rabbit_private.s3_body_moves_on() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION rabbit_private.s3_body_moves_on() TO authenticated, service_role;

-- SB-18. Closed to clients: fn_projects_owner_guard is a definer and calls it as its
-- owner, so nothing but that guard needs it.
CREATE OR REPLACE FUNCTION rabbit_private.project_id_tied_elsewhere(p_id uuid, p_ws uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.file_events e
                  WHERE e.project_id = p_id AND e.workspace_id IS DISTINCT FROM p_ws)
      OR EXISTS (SELECT 1 FROM public.files f
                  WHERE f.storage_path LIKE 'projects/' || p_id::text || '/%'
                    AND f.storage_provider IN ('supabase', 's3', 'local_server')
                    AND f.workspace_id IS DISTINCT FROM p_ws);
END;
$$;
REVOKE EXECUTE ON FUNCTION rabbit_private.project_id_tied_elsewhere(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- SB-11, SB-12. What the checked move must do with a file's stored copy. Called only
-- by fn_moth_apply_moves (0118), after its own exclusion and write checks and before
-- its one UPDATE, which folds in 'set'. A refusal says its code in the message and
-- the plain sentence in the detail.
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
    -- By association: the key stays. A legacy picture elsewhere is detached.
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

-- SFB-08: the queue row's reason, file and kind, and the bucket and provider as 0054.
CREATE OR REPLACE FUNCTION rabbit_private.files_body_retire(p_file uuid, p_retire jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  INSERT INTO public.storage_gc_queue (bucket_id, object_path, workspace_id, file_id, reason, provider, kind)
  SELECT e->>'bucket', e->>'path', f.workspace_id, f.id, 'file-purged', e->>'provider', e->>'kind'
    FROM public.files f
    CROSS JOIN jsonb_array_elements(COALESCE(p_retire, '[]'::jsonb)) e
   WHERE f.id = p_file;
END;
$$;
REVOKE EXECUTE ON FUNCTION rabbit_private.files_body_retire(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- §4 The one guard on a file's project, folder and locator ------------------------------
-- Not a definer: current_user is the role that ran the write (0093's idiom). A bound
-- definer is a function a client called: its current_user is its owner, while the role
-- setting still says who is asking (0049). This fires ahead of trg_files_populate_workspace,
-- so on an insert it reads current_workspace_id(), through the helper, and not the row's.
CREATE OR REPLACE FUNCTION public.fn_files_body_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_client BOOLEAN := current_user IN ('authenticated', 'anon');
  v_share  BOOLEAN := false;
  v_writer TEXT;
  v_moved  BOOLEAN;
BEGIN
  -- Arm 5. Migrations, cron, service_role Edge Functions and a test's set-up pass.
  IF NOT v_client AND COALESCE(current_setting('role', true), '') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- A file keeps its id, as a folder and a project do: its events, the move journal and
  -- the queue name it.
  IF TG_OP = 'UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'A file keeps its id.' USING ERRCODE = '42501';
  END IF;

  -- Arm 4. A personal space's files live in the company's storage. A space the caller
  -- cannot see reads as no row here, and RLS answers.
  IF NEW.storage_provider::text IN ('local_server', 'google_drive')
     AND (TG_OP = 'INSERT'
          OR NEW.storage_provider IS DISTINCT FROM OLD.storage_provider
          OR NEW.project_id IS DISTINCT FROM OLD.project_id)
     AND EXISTS (SELECT 1 FROM public.projects p
                  WHERE p.id = NEW.project_id AND p.personal_owner_id IS NOT NULL) THEN
    RAISE EXCEPTION 'A personal space keeps its files in the company''s storage, not on one computer.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_writer := COALESCE(current_setting('wilson.network_share_writer', true), '');
    v_share := 'network_share' IN (OLD.storage_provider::text, NEW.storage_provider::text)
      AND v_writer IN ('op:' || NEW.id::text, 'check:' || NEW.project_id::text);
    -- Arm 3. An office-server row is the catalogue's: its own writers keep it true
    -- to the real file. The generic trash calls are refused here for such a row.
    IF OLD.storage_provider::text = 'network_share' AND NOT v_share
       AND (NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
            OR NEW.source_modified_at IS DISTINCT FROM OLD.source_modified_at
            OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
            OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
            OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by
            OR NEW.share_missing_since IS DISTINCT FROM OLD.share_missing_since
            OR NEW.share_bin_path IS DISTINCT FROM OLD.share_bin_path) THEN
      RAISE EXCEPTION 'A file on your office server changes only through the desktop app.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Arm 1. A client never changes these; resending the same values passes.
  IF v_client THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.storage_provider::text NOT IN ('supabase', 's3', 'local_server')
         OR NEW.share_missing_since IS NOT NULL
         OR NEW.share_bin_path IS NOT NULL
         OR NOT (NEW.thumbnail_url IS NULL OR NEW.thumbnail_url = NEW.storage_path || '.jpg')
         OR NOT COALESCE(rabbit_private.file_key_admissible(
              NEW.storage_provider::text, NEW.storage_path, NEW.project_id, NEW.id, NEW.folder_id, NEW.is_financial), false) THEN
        RAISE EXCEPTION 'This file''s stored copy is not one this project can claim.'
          USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
       OR NEW.folder_id IS DISTINCT FROM OLD.folder_id
       OR NEW.storage_provider IS DISTINCT FROM OLD.storage_provider
       OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
       OR NEW.thumbnail_url IS DISTINCT FROM OLD.thumbnail_url
       OR NEW.is_financial IS DISTINCT FROM OLD.is_financial
       OR NEW.share_missing_since IS DISTINCT FROM OLD.share_missing_since
       OR NEW.share_bin_path IS DISTINCT FROM OLD.share_bin_path THEN
      RAISE EXCEPTION 'A file''s project, folder and storage change only through Move to.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- Arm 2. A bound definer: only the named writers, each bound to this row, so an
  -- unknown or future definer fails closed. folder_id to NULL is the foreign key's
  -- own SET NULL, which runs as the table's owner.
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'A file stays in its company.' USING ERRCODE = '42501';
  END IF;
  v_moved := NEW.project_id IS DISTINCT FROM OLD.project_id
    OR (NEW.folder_id IS DISTINCT FROM OLD.folder_id AND NEW.folder_id IS NOT NULL);
  IF NOT v_moved
     AND NEW.storage_provider IS NOT DISTINCT FROM OLD.storage_provider
     AND NEW.storage_path IS NOT DISTINCT FROM OLD.storage_path
     AND NEW.thumbnail_url IS NOT DISTINCT FROM OLD.thumbnail_url
     AND NEW.is_financial IS NOT DISTINCT FROM OLD.is_financial
     AND NEW.share_missing_since IS NOT DISTINCT FROM OLD.share_missing_since
     AND NEW.share_bin_path IS NOT DISTINCT FROM OLD.share_bin_path THEN
    RETURN NEW;
  END IF;
  IF public.fn_checked_move_admits(NEW.id, NEW.project_id, NEW.folder_id, NEW.storage_provider::text, NEW.storage_path) THEN
    RETURN NEW;
  END IF;
  IF NOT v_moved
     AND NEW.storage_provider IS NOT DISTINCT FROM OLD.storage_provider
     AND COALESCE(current_setting('wilson.body_rekey', true), '') = 'file:' || NEW.id::text THEN
    RETURN NEW;
  END IF;
  IF v_share AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A file''s project, folder and storage change only through Move to.'
    USING ERRCODE = '42501';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_files_body_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER trg_files_body_guard
  BEFORE INSERT OR UPDATE ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.fn_files_body_guard();

-- §5 The one path that changes a stored key after insert ---------------------------------
-- SB-10. Every failure of authority answers alike. A compare-and-set miss answers false,
-- so the caller re-reads. A moved row never re-keys: every moved key keeps its creation
-- prefix, which the meter, teardown and the twin rules rely on. The picture may stay as
-- it is, because the shot re-file moves a body first and its picture next.
CREATE OR REPLACE FUNCTION public.rekey_file_body(
  p_file uuid, p_from_path text, p_to_path text, p_from_thumb text, p_to_thumb text, p_financial boolean DEFAULT false)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_f         public.files%ROWTYPE;
  v_ws        UUID := public.current_workspace_id();
  v_from      TEXT;
  v_to        TEXT;
  v_financial BOOLEAN;
BEGIN
  SELECT * INTO v_f FROM public.files f WHERE f.id = p_file FOR UPDATE;
  IF NOT FOUND
     OR v_ws IS NULL
     OR v_f.workspace_id IS DISTINCT FROM v_ws
     OR v_f.deleted_at IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM public.projects p
                     WHERE p.id = v_f.project_id AND p.workspace_id = v_ws AND p.deleted_at IS NULL)
     OR NOT COALESCE(public.has_active_membership(v_ws), false)
     OR NOT COALESCE(public.passes_project_privacy(v_f.project_id), false)
     OR NOT COALESCE(public.can_write_project(v_f.project_id), false)
     OR lower(split_part(v_f.storage_path, '/', 2)) <> v_f.project_id::text
     OR (public.rabbit_legal_segment(split_part(v_f.storage_path, '/', 3))
         AND NOT COALESCE(public.can_access_project_legal(v_f.project_id), false))
     OR (NOT public.rabbit_legal_segment(split_part(v_f.storage_path, '/', 3))
         AND public.file_row_is_money(v_f.is_financial, v_f.storage_path)
         AND NOT COALESCE(public.can_access_project_money(v_f.project_id), false)) THEN
    RAISE EXCEPTION 'file not found or not writable' USING ERRCODE = '42501';
  END IF;

  IF v_f.storage_path IS DISTINCT FROM p_from_path OR v_f.thumbnail_url IS DISTINCT FROM p_from_thumb THEN
    RETURN false;
  END IF;

  v_financial := COALESCE(v_f.is_financial, false) OR COALESCE(p_financial, false);
  v_from := split_part(v_f.storage_path, '/', 3);
  v_to := split_part(COALESCE(p_to_path, ''), '/', 3);
  IF p_to_path IS DISTINCT FROM v_f.storage_path THEN
    IF v_f.storage_provider::text = 's3'
       OR split_part(COALESCE(p_to_path, ''), '/', 1) <> split_part(v_f.storage_path, '/', 1)
       OR split_part(COALESCE(p_to_path, ''), '/', 2) <> split_part(v_f.storage_path, '/', 2)
       OR public.rabbit_legal_segment(v_from) IS DISTINCT FROM public.rabbit_legal_segment(v_to)
       OR (public.rabbit_money_segment(v_from) AND NOT public.rabbit_money_segment(v_to))
       OR (public.rabbit_money_segment(v_to) AND NOT public.rabbit_legal_segment(v_to)
           AND NOT public.rabbit_money_segment(v_from) AND NOT COALESCE(p_financial, false))
       OR NOT COALESCE(rabbit_private.file_key_admissible(
            v_f.storage_provider::text, p_to_path, v_f.project_id, p_file, v_f.folder_id, v_financial), false) THEN
      RAISE EXCEPTION 'file not found or not writable' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- Money only grows, into an invoices key, and only for someone with money access.
  IF COALESCE(p_financial, false) AND NOT COALESCE(v_f.is_financial, false)
     AND (lower(v_to) <> 'invoices' OR NOT COALESCE(public.can_access_project_money(v_f.project_id), false)) THEN
    RAISE EXCEPTION 'file not found or not writable' USING ERRCODE = '42501';
  END IF;
  IF NOT (p_to_thumb IS NOT DISTINCT FROM v_f.thumbnail_url
          OR p_to_thumb IS NULL
          OR p_to_thumb = p_to_path || '.jpg') THEN
    RAISE EXCEPTION 'file not found or not writable' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('wilson.body_rekey', 'file:' || p_file::text, true);
  UPDATE public.files
     SET storage_path = p_to_path, thumbnail_url = p_to_thumb, is_financial = v_financial
   WHERE id = p_file;
  PERFORM set_config('wilson.body_rekey', '', true);
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rekey_file_body(uuid, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rekey_file_body(uuid, text, text, text, text, boolean) TO authenticated, service_role;

-- §6 The projects guard, restated from 0110 with one arm: an id tied to another company --
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
      -- 0114: an id another company's keys or file events name (SB-18). Judged for the
      -- same callers as the arm above, so nobody else learns that the id exists.
      IF v_ws = public.current_workspace_id()
         AND public.has_active_membership(v_ws)
         AND public.current_app_role() IN ('admin', 'manager')
         AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = NEW.id)
         AND rabbit_private.project_id_tied_elsewhere(NEW.id, v_ws) THEN
        RAISE EXCEPTION 'This project cannot be brought in under that id. Make a new project.'
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

-- §7 The same-project guard, restated from 0107 without the skip ---------------------------
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
  -- Client callers only. There is no skip: a checked move clears or validates its
  -- links, so it passes on its own (§1.2; 0114 removed 0107's setting).
  IF COALESCE(current_setting('role', true), '') NOT IN ('authenticated', 'anon') THEN
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
REVOKE EXECUTE ON FUNCTION public.fn_same_project_refs_guard() FROM PUBLIC, anon, authenticated;

-- §8 COMMENTs ----------------------------------------------------------------------------
COMMENT ON SCHEMA rabbit_private IS
  'Helpers for file bodies. Never listed in the API''s exposed schemas: a storage policy or a guard calls them, an RPC cannot.';
COMMENT ON COLUMN public.files.share_missing_since IS
  'Office server only: when the catalogue last found this file missing. Written only by the office-server writers (0117).';
COMMENT ON COLUMN public.files.share_bin_path IS
  'Office server only: where the real file went in the server''s bin folder. Written only by the office-server writers (0117).';
COMMENT ON FUNCTION rabbit_private.file_key_shape_ok(text) IS
  'The shape of a client key: projects/<project>/<allowed segment>/…/<leaf>, at least five safe segments, at most 1024 characters.';
COMMENT ON FUNCTION rabbit_private.storage_object_claimed(text, text) IS
  'True when any record names this stored copy, whichever company it belongs to: a files row in any trash state, an undrained purge-queue row naming a file, or the purge certificate of a moved copy. False for row-less shapes. A definer, with row security off.';
COMMENT ON FUNCTION rabbit_private.storage_object_current_project(text, text) IS
  'The project that answers for this stored copy, read as the caller, so files_select decides. NULL unless exactly one visible row names it. Must stay INVOKER.';
COMMENT ON FUNCTION rabbit_private.file_key_admissible(text, text, uuid, uuid, uuid, boolean) IS
  'May this caller''s new row claim this key? The caller''s rights first, then money and Legal, then shape, other rows, purge claims, the object, and the folder. Never NULL. Called by fn_files_body_guard, rekey_file_body and files_body_follow.';
COMMENT ON FUNCTION rabbit_private.s3_body_moves_on() IS
  'False until 0120 restates it, per environment, after the new storage-presign is verified deployed there.';
COMMENT ON FUNCTION rabbit_private.project_id_tied_elsewhere(uuid, uuid) IS
  'True when another company''s file events or keys name this project id. Called only by fn_projects_owner_guard.';
COMMENT ON FUNCTION rabbit_private.files_body_follow(uuid, uuid, jsonb) IS
  'What the checked move must do with a file''s stored copy: {set, retire}, or a refusal whose message is its code. Called only by fn_moth_apply_moves (0118). Closed to every client role.';
COMMENT ON FUNCTION rabbit_private.files_body_retire(uuid, jsonb) IS
  'Queues the copies the checked move retired, as purge-queue rows naming the file. Called only by fn_moth_apply_moves (0118). Closed to every client role.';
COMMENT ON FUNCTION public.fn_files_body_guard() IS
  'The one guard on a file''s project, folder and locator. A client never changes them, and nobody reached through the API changes a file''s id. A bound definer changes them only under fn_checked_move_admits, wilson.body_rekey or wilson.network_share_writer, each bound to the row. Unbound sessions pass. Not a definer: current_user is who ran the write. Fires before trg_files_legal_fixed and trg_files_populate_workspace and reads neither''s effect.';
COMMENT ON FUNCTION public.rekey_file_body(uuid, text, text, text, text, boolean) IS
  'The one client path that changes a stored key after insert: same project prefix, provider unchanged, no key change on s3, never a moved row; money only false to true. False on a compare-and-set miss; one refusal for every failure of authority.';
COMMENT ON FUNCTION public.fn_same_project_refs_guard() IS
  'For client callers, every new or changed secondary link (single-column foreign keys between project-scoped tables, the uuid[] links on assets, and both ends of the dependency tables) must point inside the row''s own project. There is no skip: a checked move clears or validates its links and passes on its own (0114 removed 0107''s setting).';

-- §9 Post-conditions ------------------------------------------------------------------------
DO $$
DECLARE
  r      RECORD;
  v_n    INT;
  v_body TEXT;
BEGIN
  IF has_schema_privilege('anon', 'rabbit_private', 'USAGE') OR has_schema_privilege('public', 'rabbit_private', 'USAGE') THEN
    RAISE EXCEPTION '0114 post-condition: rabbit_private must not be open to anon or PUBLIC';
  END IF;

  -- Every function in the schema: search_path pinned, nothing for anon; every definer
  -- with row security off and an owner who bypasses it (a role subject to RLS must get
  -- an error, not an empty read).
  v_n := 0;
  FOR r IN
    SELECT p.oid, p.oid::regprocedure::text AS sig, p.prosecdef, p.proconfig, p.proowner
      FROM pg_proc p
     WHERE p.pronamespace = 'rabbit_private'::regnamespace
  LOOP
    v_n := v_n + 1;
    IF NOT ('search_path=public' = ANY (COALESCE(r.proconfig, ARRAY[]::text[]))) THEN
      RAISE EXCEPTION '0114 post-condition: % has no pinned search_path', r.sig;
    END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION '0114 post-condition: anon may call %', r.sig;
    END IF;
    IF r.prosecdef THEN
      IF NOT ('row_security=off' = ANY (COALESCE(r.proconfig, ARRAY[]::text[]))) THEN
        RAISE EXCEPTION '0114 post-condition: definer % does not set row_security off', r.sig;
      END IF;
      IF NOT (SELECT rolbypassrls FROM pg_roles WHERE oid = r.proowner) THEN
        RAISE EXCEPTION '0114 post-condition: the owner of definer % does not bypass row security', r.sig;
      END IF;
    END IF;
  END LOOP;
  IF v_n <> 8 THEN
    RAISE EXCEPTION '0114 post-condition: rabbit_private holds % functions, not 8', v_n;
  END IF;

  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'rabbit_private.storage_object_current_project(text,text)'::regprocedure) THEN
    RAISE EXCEPTION '0114 post-condition: storage_object_current_project must be INVOKER: files_select decides as the caller';
  END IF;
  IF has_function_privilege('authenticated', 'rabbit_private.files_body_follow(uuid,uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'rabbit_private.files_body_retire(uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'rabbit_private.project_id_tied_elsewhere(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0114 post-condition: a client may call a helper it must not';
  END IF;
  IF has_function_privilege('anon', 'public.rekey_file_body(uuid,text,text,text,text,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rekey_file_body(uuid,text,text,text,text,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION '0114 post-condition: rekey_file_body has the wrong grants';
  END IF;
  IF rabbit_private.s3_body_moves_on() IS NOT FALSE THEN
    RAISE EXCEPTION '0114 post-condition: s3_body_moves_on must answer false';
  END IF;

  -- The guard: attached, not a definer, naming every column and marker.
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_files_body_guard()'::regprocedure) THEN
    RAISE EXCEPTION '0114 post-condition: fn_files_body_guard must not be a definer: current_user is who ran the write';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.files'::regclass
                    AND tgname = 'trg_files_body_guard'
                    AND tgenabled = 'O'
                    AND pg_get_triggerdef(oid) LIKE '%BEFORE INSERT OR UPDATE ON public.files%') THEN
    RAISE EXCEPTION '0114 post-condition: trg_files_body_guard is missing or changed';
  END IF;
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_body
    FROM pg_proc WHERE oid = 'public.fn_files_body_guard()'::regprocedure;
  IF position('NEW.project_id IS DISTINCT FROM OLD.project_id' IN v_body) = 0
     OR position('NEW.workspace_id IS DISTINCT FROM OLD.workspace_id' IN v_body) = 0
     OR position('NEW.folder_id IS DISTINCT FROM OLD.folder_id' IN v_body) = 0
     OR position('NEW.storage_provider IS DISTINCT FROM OLD.storage_provider' IN v_body) = 0
     OR position('NEW.storage_path IS DISTINCT FROM OLD.storage_path' IN v_body) = 0
     OR position('NEW.thumbnail_url IS DISTINCT FROM OLD.thumbnail_url' IN v_body) = 0
     OR position('NEW.is_financial IS DISTINCT FROM OLD.is_financial' IN v_body) = 0
     OR position('NEW.share_missing_since IS DISTINCT FROM OLD.share_missing_since' IN v_body) = 0
     OR position('NEW.share_bin_path IS DISTINCT FROM OLD.share_bin_path' IN v_body) = 0
     OR position('public.fn_checked_move_admits(' IN v_body) = 0
     OR position('wilson.body_rekey' IN v_body) = 0
     OR position('wilson.network_share_writer' IN v_body) = 0 THEN
    RAISE EXCEPTION '0114 post-condition: fn_files_body_guard lost a column or a marker';
  END IF;

  -- The two restated bodies, and the setting 0107 read is gone from every function.
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.fn_projects_owner_guard()'::regprocedure)
       IS DISTINCT FROM 'ba4ac337fa62d309793dfd99af6f99c8' THEN
    RAISE EXCEPTION '0114 post-condition: fn_projects_owner_guard is not this file''s body';
  END IF;
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.fn_same_project_refs_guard()'::regprocedure)
       IS DISTINCT FROM '82b6e03f94ea926fabb3e4a90c215eb4' THEN
    RAISE EXCEPTION '0114 post-condition: fn_same_project_refs_guard is not this file''s body';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.pronamespace IN ('public'::regnamespace, 'rabbit_private'::regnamespace)
                AND p.prosrc LIKE '%wilson.checked_' || 'move%') THEN
    RAISE EXCEPTION '0114 post-condition: a function still reads the setting 0107 skipped on';
  END IF;

  -- The indexes.
  IF to_regclass('public.files_storage_path_key_uidx') IS NULL
     OR to_regclass('public.files_s3_namespace_uidx') IS NULL
     OR to_regclass('public.files_moved_body_ws_idx') IS NULL
     OR to_regclass('public.storage_gc_queue_claim_idx') IS NULL
     OR to_regclass('public.file_events_purged_path_idx') IS NULL
     OR to_regclass('public.file_events_project_any_idx') IS NULL THEN
    RAISE EXCEPTION '0114 post-condition: an index is missing';
  END IF;

  RAISE NOTICE '0114 OK: the helpers, the body guard, the re-key path and the two restated guards are in place';
END $$;
