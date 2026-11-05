-- =============================================================================
-- 0115_storage_follows_file.sql — M.O.T.H. Session 1 (MO1): who may reach a stored
-- copy now follows the file that names it, not the project its key happens to say
-- (docs/design/MOTH_DESIGN.md §1.4 "0115", §2.1 SB-6, SB-7, SB-14, SB-15).
--
-- WHAT IS NEW
-- -----------
--   §1  A picture named only by files.thumbnail_url is claimed too, with its index:
--       a legacy picture, or a re-file stopped between its two phases. 0114's review
--       round left the choice here; taken, because otherwise a trashed or hidden file's
--       picture stays readable by key. Only under the row's own project: until 0114 a
--       client could write any text in that column, so a name under another project
--       claims nothing. And one picture has one namer: the pre-flight refuses a picture
--       two rows name, and file_key_admissible refuses a new key whose picture another
--       row's thumbnail_url names, because a caller who could see only one of the two
--       would be answered for both.
--   §2  The eight base storage policies, restated whole: wherever a key is claimed, the
--       project that answers is the one the file row names, read as the caller, so a
--       trashed file, a hidden project or a money row the caller may not see answers
--       nothing. An unclaimed key (a manifest, a bin's poster, a fresh upload) keeps the
--       rule it had. An uploader's own clean-up cannot remove a claimed body.
--   §3  can_presign_object: the same answer for a company's own bucket. Nothing calls it
--       until the new storage-presign is deployed.
--   §4  workspace_petal_committed_bytes: a copy moved out of a project still counts
--       after that project is purged.
--   §5  COMMENTs; §6 post-conditions, which also hold the money, bin-poster and quota
--       policies to the text they had.
--
-- WHAT THIS CHANGES FOR A RUNNING BUILD
-- -------------------------------------
-- Nothing a build asks for today, unless it asks for a trashed file's copy, or for a
-- money-flagged file's copy under an ordinary key without money access: those stop
-- being served, on purpose. A trashed copy under a money or Legal key stays open to its
-- cleared audience, who can restore it anyway: those policies do not read the row (SB-7).
-- A put-back onto a key a row trashed meanwhile names is refused too, so the copy stays
-- at its new key: this build's re-file and receipt move say so; an old build says "could
-- not be moved back". Nothing else moves: no file row names another project's key until
-- 0118, so every other claimed key answers as it did.
--
-- A storage list costs more. Supabase's search runs the policies before its name filter,
-- so one list reads every object in the bucket, whichever company's: measured on dev,
-- about 0.15 ms an object before this file and 1.2 ms after. A signed URL looks up one
-- object and costs about a millisecond more.
--
-- THE ORDER ON EACH ENVIRONMENT
-- -----------------------------
-- After 0114. The Edge Functions (storage-presign, read-urls, gc, teardown) deploy after
-- this file. One transaction. Re-runnable. Suites 115, 61, 63, 66.
-- =============================================================================

-- §0 Pre-flight -----------------------------------------------------------------
-- A long reader of storage.objects (a list, the nightly dump) would hold this file, and
-- every storage read queued behind it. It fails instead, and can be run again.
SET LOCAL lock_timeout = '15s';

DO $$
DECLARE
  r     RECORD;
  v_md5 TEXT;
  v_n   BIGINT;
BEGIN
  IF to_regprocedure('rabbit_private.storage_object_claimed(text,text)') IS NULL
     OR to_regprocedure('rabbit_private.storage_object_current_project(text,text)') IS NULL THEN
    RAISE EXCEPTION '0115 refused: 0114 must be applied first';
  END IF;
  -- The definers below read tables with row security on (0069's lesson).
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0115 refused: % does not bypass row security', current_user;
  END IF;

  -- Everything restated below is what the file it was lifted from left, or this file's.
  -- Another migration may have moved it: a restatement would drop what it does not name.
  FOR r IN
    SELECT * FROM (VALUES
      ('rabbit_private.storage_object_claimed(text,text)', 'c9ec112c76dc7ee9a5d68af5f778f22d', '56312e6777efce1cc8dfe8e4f3bb2f38'),
      ('rabbit_private.storage_object_current_project(text,text)', '4fab75f34d497a1b763b164cc741c770', 'f7d3ce6f636f8ce7f6dabd0ed87ff944'),
      ('rabbit_private.file_key_admissible(text,text,uuid,uuid,uuid,boolean)', '5b404b21879e1b25df7b7c18080ac747', 'c2307ece6296a6fd6643606b4801b74e'),
      ('public.workspace_petal_committed_bytes(uuid)', '4e9da5709bc29c10ad52e5d73be22cfe', '96b8fb43380056a2e9925fc28a09c458')
    ) AS t(sig, was, now)
  LOOP
    SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc WHERE oid = r.sig::regprocedure;
    IF v_md5 IS DISTINCT FROM r.was AND v_md5 IS DISTINCT FROM r.now THEN
      RAISE EXCEPTION '0115 refused: % is neither the body it was lifted from nor this file''s (md5 %)', r.sig, v_md5;
    END IF;
  END LOOP;
  FOR r IN
    SELECT * FROM (VALUES
      ('rabbit_files_select', '2a52e43496b36c49325a24a8fbbbfe6b', '174719f588a291c2ded9890a834e8654'),
      ('rabbit_files_insert', '9705a4c700172846c71e63d8b2413752', 'db7b7621fa4767a5a506bc9ee01d1090'),
      ('rabbit_files_update', 'b2b1ae67b58d69d9d79a56453582c3be', 'f40c56bf57af14a3659a822dee27d90c'),
      ('rabbit_files_delete_own', '6109d3ed4fb3a119b7556efb14ae2488', '400253809ebd23bc4e948704a2efe563'),
      ('rabbit_thumbnails_select', '5d71382720c04af1f2f7c1bc63cffde3', 'deeb4bb3e3a0251a81d71e8d645ce2ba'),
      ('rabbit_thumbnails_insert', '62771573376d44a6ef8751acd598fca6', '5af07183277f1dadb2a4f4e857bc02c8'),
      ('rabbit_thumbnails_update', '35f960fe24f72940b8f3410cb1c179a8', 'd28a3ac61e9df26d9cda496ec833d538'),
      ('rabbit_thumbnails_delete_own', '894a7034a498ddbc3001ddafb6bd2782', '185b5d62f90554869e6f0a28b055d7f0')
    ) AS t(policy, was, now)
  LOOP
    SELECT md5(COALESCE(qual, '') || '|' || COALESCE(with_check, '')) INTO v_md5
      FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = r.policy;
    IF v_md5 IS DISTINCT FROM r.was AND v_md5 IS DISTINCT FROM r.now THEN
      RAISE EXCEPTION '0115 refused: policy % is neither the text it was lifted from nor this file''s (md5 %)', r.policy, v_md5;
    END IF;
  END LOOP;

  -- Taken before the counts, so nothing lands between them and the guard below. The
  -- DROP POLICYs then take ACCESS EXCLUSIVE on storage.objects. A one-statement write to
  -- files holds ROW EXCLUSIVE before its trigger reads storage.objects, so this order
  -- cannot deadlock with it. rekey_file_body can: it reads storage.objects before it
  -- writes files. One side then gets 40P01 and rolls back whole. Run it again.
  LOCK TABLE public.files IN SHARE ROW EXCLUSIVE MODE;

  -- An index cannot hold a very long value, and its own error counts nothing (0114's lesson).
  SELECT count(*) INTO v_n FROM public.files
   WHERE thumbnail_url IS NOT NULL AND storage_provider::text IN ('supabase', 'local_server')
     AND octet_length(thumbnail_url) > 2000;
  IF v_n > 0 THEN
    RAISE EXCEPTION '0115 refused: % file row(s) have a picture name too long to index', v_n;
  END IF;

  -- A non-zero count stops here: someone decides each row. Nothing repairs itself. A
  -- caller who could see only one of the two rows would be answered for the picture.
  SELECT count(*) INTO v_n FROM (
    SELECT thumbnail_url FROM public.files
     WHERE btrim(COALESCE(thumbnail_url, '')) <> '' AND storage_provider::text IN ('supabase', 'local_server')
       AND lower(split_part(thumbnail_url, '/', 2)) = project_id::text
     GROUP BY thumbnail_url HAVING count(*) > 1) x;
  IF v_n > 0 THEN
    RAISE EXCEPTION '0115 refused: % picture(s) are named by the thumbnail_url of more than one row', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.files a
    JOIN public.files b ON b.thumbnail_url = a.storage_path || '.jpg' AND b.id <> a.id
   WHERE a.storage_provider::text IN ('supabase', 'local_server')
     AND b.storage_provider::text IN ('supabase', 'local_server')
     AND lower(split_part(b.thumbnail_url, '/', 2)) = b.project_id::text;
  IF v_n > 0 THEN
    RAISE EXCEPTION '0115 refused: % picture(s) are one row''s by its key and another''s by its thumbnail_url', v_n;
  END IF;

  -- Counted, not refused (db query drops a NOTICE; the rehearsal measures them).
  SELECT count(*) INTO v_n FROM public.files
   WHERE btrim(COALESCE(thumbnail_url, '')) <> '' AND thumbnail_url <> storage_path || '.jpg'
     AND storage_provider::text IN ('supabase', 'local_server')
     AND lower(split_part(thumbnail_url, '/', 2)) = project_id::text;
  RAISE NOTICE '0115: % picture(s) named only by thumbnail_url, claimed from here on', v_n;
  SELECT count(*) INTO v_n FROM public.files
   WHERE btrim(COALESCE(thumbnail_url, '')) <> '' AND thumbnail_url <> storage_path || '.jpg'
     AND storage_provider::text IN ('supabase', 'local_server')
     AND lower(split_part(thumbnail_url, '/', 2)) <> project_id::text;
  RAISE NOTICE '0115: % picture name(s) under another project, a client wrote them before 0114: look at each, they claim nothing', v_n;
  SELECT count(*) INTO v_n FROM public.files
   WHERE btrim(COALESCE(thumbnail_url, '')) <> '' AND thumbnail_url <> storage_path || '.jpg'
     AND storage_provider::text NOT IN ('supabase', 'local_server');
  RAISE NOTICE '0115: % row(s) on another provider whose picture is not their key''s: it stays on the prefix rule', v_n;
END $$;

-- §1 A picture named only by thumbnail_url -------------------------------------------
CREATE INDEX IF NOT EXISTS files_thumbnail_url_idx
  ON public.files (thumbnail_url)
  WHERE thumbnail_url IS NOT NULL AND storage_provider IN ('supabase', 'local_server');

-- SB-4, from 0114 with one arm: a row claims the picture its thumbnail_url names, as well
-- as the one its storage_path implies, when that name is under the row's own project.
-- Across every company, because a stored copy can outlive its project.
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
    IF EXISTS (SELECT 1 FROM public.files f
                WHERE f.thumbnail_url = p_name AND f.storage_provider IN ('supabase', 'local_server')
                  AND lower(split_part(f.thumbnail_url, '/', 2)) = f.project_id::text) THEN
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

-- SB-5, from 0114 with the same arm. INVOKER on purpose: files_select decides as the
-- caller, so a trashed file, a hidden project or a money row the caller may not see
-- answers NULL. plpgsql because a storage policy calls it once per object (the trap of
-- 0111's read path).
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
    SELECT count(*), (array_agg(f.project_id))[1] INTO v_n, v_project
      FROM public.files f
     WHERE (f.storage_path = CASE WHEN right(p_name, 4) = '.jpg' THEN left(p_name, -4) END
            OR (f.thumbnail_url = p_name AND lower(split_part(f.thumbnail_url, '/', 2)) = f.project_id::text))
       AND f.storage_provider IN ('supabase', 'local_server');
  ELSIF p_bucket = 'byo-s3' THEN
    SELECT count(*), (array_agg(f.project_id))[1] INTO v_n, v_project
      FROM public.files f
     WHERE f.storage_provider = 's3'
       AND f.storage_path IN (p_name, CASE WHEN right(p_name, 4) = '.jpg' THEN left(p_name, -4) END)
       AND (f.storage_path = p_name OR f.thumbnail_url = p_name);
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
  -- 0115: nor is its picture another row's by name (a legacy picture, or a re-file stopped
  -- between its phases). The caller might see only the new row, and be answered for both.
  IF p_provider IN ('supabase', 'local_server')
     AND EXISTS (SELECT 1 FROM public.files f
                  WHERE f.thumbnail_url = p_path || '.jpg'
                    AND f.storage_provider IN ('supabase', 'local_server')
                    AND lower(split_part(f.thumbnail_url, '/', 2)) = f.project_id::text
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

-- §2 The eight base storage policies -------------------------------------------------
-- 0042's four and 0053's four, every predicate word for word; each project argument is
-- now the CASE. DROP + CREATE, never a narrower policy added alongside: permissive
-- policies OR together, so leaving the old one in place would change nothing at all.
-- The money policies and the bin-poster policies are not touched (§6 pins their text):
-- a money key's second segment is its project for ever, and a poster's key is row-less.
-- So a trashed or queued copy under a money or Legal key stays open to its cleared
-- audience, who can restore it anyway.

DROP POLICY IF EXISTS rabbit_files_select ON storage.objects;
CREATE POLICY rabbit_files_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND NOT public.rabbit_money_segment((storage.foldername(name))[3])
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = CASE WHEN rabbit_private.storage_object_claimed(objects.bucket_id, objects.name)
                         THEN rabbit_private.storage_object_current_project(objects.bucket_id, objects.name)
                         ELSE public.fn_try_uuid((storage.foldername(objects.name))[2]) END
    )
  );

DROP POLICY IF EXISTS rabbit_files_insert ON storage.objects;
CREATE POLICY rabbit_files_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND NOT public.rabbit_money_segment((storage.foldername(name))[3])
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = CASE WHEN rabbit_private.storage_object_claimed(objects.bucket_id, objects.name)
                         THEN rabbit_private.storage_object_current_project(objects.bucket_id, objects.name)
                         ELSE public.fn_try_uuid((storage.foldername(objects.name))[2]) END
    )
    AND public.has_active_membership(public.current_workspace_id())
    AND public.can_write_project(CASE WHEN rabbit_private.storage_object_claimed(bucket_id, name)
                                      THEN rabbit_private.storage_object_current_project(bucket_id, name)
                                      ELSE public.fn_try_uuid((storage.foldername(name))[2]) END)
  );

-- Both arms required, pinning the same side of the gate: 0042's fix, kept.
DROP POLICY IF EXISTS rabbit_files_update ON storage.objects;
CREATE POLICY rabbit_files_update ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND NOT public.rabbit_money_segment((storage.foldername(name))[3])
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = CASE WHEN rabbit_private.storage_object_claimed(objects.bucket_id, objects.name)
                         THEN rabbit_private.storage_object_current_project(objects.bucket_id, objects.name)
                         ELSE public.fn_try_uuid((storage.foldername(objects.name))[2]) END
    )
    AND public.has_active_membership(public.current_workspace_id())
    AND public.can_write_project(CASE WHEN rabbit_private.storage_object_claimed(bucket_id, name)
                                      THEN rabbit_private.storage_object_current_project(bucket_id, name)
                                      ELSE public.fn_try_uuid((storage.foldername(name))[2]) END)
  )
  WITH CHECK (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND NOT public.rabbit_money_segment((storage.foldername(name))[3])
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = CASE WHEN rabbit_private.storage_object_claimed(objects.bucket_id, objects.name)
                         THEN rabbit_private.storage_object_current_project(objects.bucket_id, objects.name)
                         ELSE public.fn_try_uuid((storage.foldername(objects.name))[2]) END
    )
    AND public.has_active_membership(public.current_workspace_id())
    AND public.can_write_project(CASE WHEN rabbit_private.storage_object_claimed(bucket_id, name)
                                      THEN rabbit_private.storage_object_current_project(bucket_id, name)
                                      ELSE public.fn_try_uuid((storage.foldername(name))[2]) END)
  );

-- An upload whose row was refused cleans up after itself. A direct clean-up cannot
-- remove a body a record names (SFB-06). This is no limit on a project's writer, who can
-- still rename or overwrite it through the UPDATE arm, as they always could.
DROP POLICY IF EXISTS rabbit_files_delete_own ON storage.objects;
CREATE POLICY rabbit_files_delete_own ON storage.objects
  FOR DELETE USING (
    bucket_id = 'rabbit-files'
    AND owner_id = (auth.uid())::text
    AND (storage.foldername(name))[1] = 'projects'
    AND NOT public.rabbit_money_segment((storage.foldername(name))[3])
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = CASE WHEN rabbit_private.storage_object_claimed(objects.bucket_id, objects.name)
                         THEN rabbit_private.storage_object_current_project(objects.bucket_id, objects.name)
                         ELSE public.fn_try_uuid((storage.foldername(objects.name))[2]) END
    )
    AND public.has_active_membership(public.current_workspace_id())
    AND public.can_write_project(CASE WHEN rabbit_private.storage_object_claimed(bucket_id, name)
                                      THEN rabbit_private.storage_object_current_project(bucket_id, name)
                                      ELSE public.fn_try_uuid((storage.foldername(name))[2]) END)
    AND created_at > (now() - interval '1 hour')
    AND NOT rabbit_private.storage_object_claimed(bucket_id, name)
  );

DROP POLICY IF EXISTS rabbit_thumbnails_select ON storage.objects;
CREATE POLICY rabbit_thumbnails_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'rabbit-thumbnails'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND NOT public.rabbit_money_segment((storage.foldername(name))[3])
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = CASE WHEN rabbit_private.storage_object_claimed(objects.bucket_id, objects.name)
                         THEN rabbit_private.storage_object_current_project(objects.bucket_id, objects.name)
                         ELSE public.fn_try_uuid((storage.foldername(objects.name))[2]) END
    )
  );

DROP POLICY IF EXISTS rabbit_thumbnails_insert ON storage.objects;
CREATE POLICY rabbit_thumbnails_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'rabbit-thumbnails'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND NOT public.rabbit_money_segment((storage.foldername(name))[3])
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = CASE WHEN rabbit_private.storage_object_claimed(objects.bucket_id, objects.name)
                         THEN rabbit_private.storage_object_current_project(objects.bucket_id, objects.name)
                         ELSE public.fn_try_uuid((storage.foldername(objects.name))[2]) END
    )
    AND public.has_active_membership(public.current_workspace_id())
    AND public.can_write_project(CASE WHEN rabbit_private.storage_object_claimed(bucket_id, name)
                                      THEN rabbit_private.storage_object_current_project(bucket_id, name)
                                      ELSE public.fn_try_uuid((storage.foldername(name))[2]) END)
  );

-- A regenerated picture overwrites in place at a key derived from its body's, so a writer
-- of the file's current project needs this arm even when the key names another project.
DROP POLICY IF EXISTS rabbit_thumbnails_update ON storage.objects;
CREATE POLICY rabbit_thumbnails_update ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'rabbit-thumbnails'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND NOT public.rabbit_money_segment((storage.foldername(name))[3])
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = CASE WHEN rabbit_private.storage_object_claimed(objects.bucket_id, objects.name)
                         THEN rabbit_private.storage_object_current_project(objects.bucket_id, objects.name)
                         ELSE public.fn_try_uuid((storage.foldername(objects.name))[2]) END
    )
    AND public.has_active_membership(public.current_workspace_id())
    AND public.can_write_project(CASE WHEN rabbit_private.storage_object_claimed(bucket_id, name)
                                      THEN rabbit_private.storage_object_current_project(bucket_id, name)
                                      ELSE public.fn_try_uuid((storage.foldername(name))[2]) END)
  )
  WITH CHECK (
    bucket_id = 'rabbit-thumbnails'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND NOT public.rabbit_money_segment((storage.foldername(name))[3])
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = CASE WHEN rabbit_private.storage_object_claimed(objects.bucket_id, objects.name)
                         THEN rabbit_private.storage_object_current_project(objects.bucket_id, objects.name)
                         ELSE public.fn_try_uuid((storage.foldername(objects.name))[2]) END
    )
    AND public.has_active_membership(public.current_workspace_id())
    AND public.can_write_project(CASE WHEN rabbit_private.storage_object_claimed(bucket_id, name)
                                      THEN rabbit_private.storage_object_current_project(bucket_id, name)
                                      ELSE public.fn_try_uuid((storage.foldername(name))[2]) END)
  );

-- The one-hour own-object window, without the body's NOT claimed: moveReceipt removes a
-- picture it could not move, whose row still names it.
DROP POLICY IF EXISTS rabbit_thumbnails_delete_own ON storage.objects;
CREATE POLICY rabbit_thumbnails_delete_own ON storage.objects
  FOR DELETE USING (
    bucket_id = 'rabbit-thumbnails'
    AND owner_id = (auth.uid())::text
    AND (storage.foldername(name))[1] = 'projects'
    AND NOT public.rabbit_money_segment((storage.foldername(name))[3])
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = CASE WHEN rabbit_private.storage_object_claimed(objects.bucket_id, objects.name)
                         THEN rabbit_private.storage_object_current_project(objects.bucket_id, objects.name)
                         ELSE public.fn_try_uuid((storage.foldername(objects.name))[2]) END
    )
    AND public.has_active_membership(public.current_workspace_id())
    AND public.can_write_project(CASE WHEN rabbit_private.storage_object_claimed(bucket_id, name)
                                      THEN rabbit_private.storage_object_current_project(bucket_id, name)
                                      ELSE public.fn_try_uuid((storage.foldername(name))[2]) END)
    AND created_at > (now() - interval '1 hour')
  );

-- §3 The signer's question for a company's own bucket ----------------------------------
-- SB-14. INVOKER: storage-presign calls it with the caller's own token, so every answer
-- is the caller's. A claimed key is never signed for writing or removing: nobody can PUT
-- over or DELETE a copy a record names. In a company's own bucket a record names a key
-- and that key's own .jpg (SB-4). An unclaimed key keeps 0051's rule.
CREATE OR REPLACE FUNCTION public.can_presign_object(p_path text, p_op text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(
    CASE
      WHEN NOT COALESCE(p_op IN ('get', 'head', 'put', 'del'), false) THEN false
      WHEN rabbit_private.storage_object_claimed('byo-s3', p_path) THEN
        p_op IN ('get', 'head')
        AND public.has_active_membership(public.current_workspace_id())
        AND rabbit_private.storage_object_current_project('byo-s3', p_path) IS NOT NULL
      WHEN p_op IN ('get', 'head') THEN public.can_presign_project_read(public.fn_try_uuid(split_part(p_path, '/', 2)))
      ELSE public.can_presign_project_write(public.fn_try_uuid(split_part(p_path, '/', 2)))
    END,
    false);
$$;
REVOKE EXECUTE ON FUNCTION public.can_presign_object(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_presign_object(text, text) TO authenticated, service_role;

-- §4 The meter -------------------------------------------------------------------------
-- SB-15. 0073's body whole, plus the copies its join loses: it finds a project by the
-- key's second segment, so purging a project would free the quota of copies moved out
-- of it. Each is counted once: the arm takes only keys whose second segment names no
-- project, and a picture two rows name is one object. No reader of this function may be a
-- client: it takes any workspace's id.
CREATE OR REPLACE FUNCTION public.workspace_petal_committed_bytes(ws UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(c.bytes), 0)::bigint
    FROM (
      SELECT COALESCE(public.rabbit_object_incoming_bytes(o.metadata), 0) AS bytes
        FROM storage.objects o
        JOIN public.projects p
          ON p.id = public.fn_try_uuid((storage.foldername(o.name))[2])
       WHERE o.bucket_id IN ('rabbit-files', 'rabbit-thumbnails')
         AND (storage.foldername(o.name))[1] = 'projects'
         AND p.workspace_id = ws
      UNION ALL
      SELECT COALESCE(public.rabbit_object_incoming_bytes(o.metadata), 0)
        FROM (
          SELECT 'rabbit-files'::text AS bucket, f.storage_path AS key
            FROM public.files f
           WHERE f.workspace_id = ws
             AND f.storage_provider = 'supabase'
             AND lower(split_part(f.storage_path, '/', 2)) <> f.project_id::text
          UNION
          SELECT 'rabbit-thumbnails'::text, f.thumbnail_url
            FROM public.files f
           WHERE f.workspace_id = ws
             AND f.storage_provider = 'supabase'
             AND lower(split_part(f.storage_path, '/', 2)) <> f.project_id::text
        ) m
        JOIN storage.objects o ON o.bucket_id = m.bucket AND o.name = m.key
       WHERE NOT EXISTS (SELECT 1 FROM public.projects p
                          WHERE p.id = public.fn_try_uuid((storage.foldername(o.name))[2]))
    ) c;
$$;
REVOKE ALL ON FUNCTION public.workspace_petal_committed_bytes(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_petal_committed_bytes(UUID) TO service_role;

-- §5 COMMENTs ----------------------------------------------------------------------------
COMMENT ON FUNCTION rabbit_private.storage_object_claimed(text, text) IS
  'True when any record names this stored copy, whichever company it belongs to: a files row in any trash state (for a picture, by the key its body implies, or by a thumbnail_url under the row''s own project), an undrained purge-queue row naming a file, or the purge certificate of a moved copy. False for row-less shapes. A definer, with row security off.';
COMMENT ON FUNCTION rabbit_private.file_key_admissible(text, text, uuid, uuid, uuid, boolean) IS
  'May this caller''s new row claim this key? The caller''s rights first, then money and Legal, then shape, other rows (by key, and for a picture by thumbnail_url), purge claims, the object, and the folder. Never NULL. Called by fn_files_body_guard, rekey_file_body and files_body_follow.';
COMMENT ON FUNCTION rabbit_private.storage_object_current_project(text, text) IS
  'The project that answers for this stored copy, read as the caller, so files_select decides. NULL unless exactly one visible row names it. Must stay INVOKER.';
COMMENT ON FUNCTION public.can_presign_object(text, text) IS
  'storage-presign''s question, asked with the caller''s own token. A key a record names (storage_object_claimed): get and head need an active member who can see the file that names it; put and del are refused. Any other key: 0051''s can_presign_project_read or can_presign_project_write on its second segment. Never NULL.';
COMMENT ON FUNCTION public.workspace_petal_committed_bytes(UUID) IS
  'Track C / 0073, restated by 0115: bytes this workspace holds as COMMITTED objects in rabbit-files + rabbit-thumbnails. Every object under one of its projects, plus the copies its files name whose key''s second segment names no project any more: a copy moved out of a project still counts after that project is purged. service_role only (0056).';

-- §6 Post-conditions ------------------------------------------------------------------------
DO $$
DECLARE
  r      RECORD;
  v_n    INT;
  v_md5  TEXT;
  v_body TEXT;
  t      TEXT;
BEGIN
  -- The restated bodies are this file's.
  FOR r IN
    SELECT * FROM (VALUES
      ('rabbit_private.storage_object_claimed(text,text)', '56312e6777efce1cc8dfe8e4f3bb2f38'),
      ('rabbit_private.storage_object_current_project(text,text)', 'f7d3ce6f636f8ce7f6dabd0ed87ff944'),
      ('rabbit_private.file_key_admissible(text,text,uuid,uuid,uuid,boolean)', 'c2307ece6296a6fd6643606b4801b74e'),
      ('public.workspace_petal_committed_bytes(uuid)', '96b8fb43380056a2e9925fc28a09c458')
    ) AS t(sig, now)
  LOOP
    SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc WHERE oid = r.sig::regprocedure;
    IF v_md5 IS DISTINCT FROM r.now THEN
      RAISE EXCEPTION '0115 post-condition: % is not this file''s body (md5 %)', r.sig, v_md5;
    END IF;
  END LOOP;

  -- What runs as whom. The definers have row security off and an owner who bypasses it.
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'rabbit_private.storage_object_claimed(text,text)'::regprocedure)
     OR (SELECT prosecdef FROM pg_proc WHERE oid = 'rabbit_private.storage_object_current_project(text,text)'::regprocedure)
     OR (SELECT prosecdef FROM pg_proc WHERE oid = 'public.can_presign_object(text,text)'::regprocedure)
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.workspace_petal_committed_bytes(uuid)'::regprocedure) THEN
    RAISE EXCEPTION '0115 post-condition: a helper runs as the wrong role';
  END IF;
  IF NOT ('row_security=off' = ANY (COALESCE((SELECT proconfig FROM pg_proc WHERE oid = 'rabbit_private.storage_object_claimed(text,text)'::regprocedure), ARRAY[]::text[]))) THEN
    RAISE EXCEPTION '0115 post-condition: storage_object_claimed does not set row_security off';
  END IF;
  IF NOT (SELECT r2.rolbypassrls FROM pg_proc p JOIN pg_roles r2 ON r2.oid = p.proowner WHERE p.oid = 'public.workspace_petal_committed_bytes(uuid)'::regprocedure) THEN
    RAISE EXCEPTION '0115 post-condition: the meter''s owner does not bypass row security';
  END IF;

  -- Who may call what.
  IF has_function_privilege('anon', 'rabbit_private.storage_object_claimed(text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'rabbit_private.storage_object_current_project(text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.can_presign_object(text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.workspace_petal_committed_bytes(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.workspace_petal_committed_bytes(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'rabbit_private.storage_object_claimed(text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'rabbit_private.storage_object_current_project(text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.can_presign_object(text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.can_presign_object(text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.workspace_petal_committed_bytes(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0115 post-condition: a helper has the wrong grants';
  END IF;

  -- 0114's schema holds what it held: nothing new reaches a client by this file.
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'rabbit_private'::regnamespace) <> 8 THEN
    RAISE EXCEPTION '0115 post-condition: rabbit_private does not hold its 8 functions';
  END IF;
  IF has_function_privilege('anon', 'rabbit_private.file_key_admissible(text,text,uuid,uuid,uuid,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'rabbit_private.file_key_admissible(text,text,uuid,uuid,uuid,boolean)', 'EXECUTE')
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'rabbit_private.file_key_admissible(text,text,uuid,uuid,uuid,boolean)'::regprocedure) THEN
    RAISE EXCEPTION '0115 post-condition: file_key_admissible has the wrong grants or runs as the wrong role';
  END IF;

  -- The index.
  IF to_regclass('public.files_thumbnail_url_idx') IS NULL THEN
    RAISE EXCEPTION '0115 post-condition: files_thumbnail_url_idx is missing';
  END IF;

  -- Eight policies per bucket, every one naming the money segment.
  FOREACH t IN ARRAY ARRAY['rabbit\_files%', 'rabbit\_thumbnails%'] LOOP
    SELECT count(*)::int INTO v_n FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE t;
    IF v_n <> 8 THEN
      RAISE EXCEPTION '0115 post-condition: % storage policies named %, expected 8', v_n, t;
    END IF;
    SELECT count(*)::int INTO v_n FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE t
       AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%rabbit_money_segment((storage.foldername(name))[3])%';
    IF v_n <> 8 THEN
      RAISE EXCEPTION '0115 post-condition: only % of the 8 % policies read rabbit_money_segment', v_n, t;
    END IF;
  END LOOP;

  -- The eight base ones are this file's, whole. No clause survives from the prefix rule
  -- except in the CASE's ELSE: the md5 is over the whole text, both clauses.
  FOR r IN
    SELECT * FROM (VALUES
      ('rabbit_files_select', '174719f588a291c2ded9890a834e8654'),
      ('rabbit_files_insert', 'db7b7621fa4767a5a506bc9ee01d1090'),
      ('rabbit_files_update', 'f40c56bf57af14a3659a822dee27d90c'),
      ('rabbit_files_delete_own', '400253809ebd23bc4e948704a2efe563'),
      ('rabbit_thumbnails_select', 'deeb4bb3e3a0251a81d71e8d645ce2ba'),
      ('rabbit_thumbnails_insert', '5af07183277f1dadb2a4f4e857bc02c8'),
      ('rabbit_thumbnails_update', 'd28a3ac61e9df26d9cda496ec833d538'),
      ('rabbit_thumbnails_delete_own', '185b5d62f90554869e6f0a28b055d7f0')
    ) AS t(policy, now)
  LOOP
    SELECT md5(COALESCE(qual, '') || '|' || COALESCE(with_check, '')) INTO v_md5
      FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = r.policy;
    IF v_md5 IS DISTINCT FROM r.now THEN
      RAISE EXCEPTION '0115 post-condition: policy % is not this file''s text (md5 %)', r.policy, v_md5;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'storage' AND tablename = 'objects'
         AND policyname IN ('rabbit_files_update', 'rabbit_thumbnails_update')
         AND qual IS NOT NULL AND with_check IS NOT NULL) <> 2 THEN
    RAISE EXCEPTION '0115 post-condition: an UPDATE policy lost an arm';
  END IF;

  -- Not touched: the eight money policies (0092), the bin-poster policies (0091), the
  -- quota (0078).
  FOR r IN
    SELECT * FROM (VALUES
      ('rabbit_files_money_select', 'f11d87becc48841dafc2303baeb84f3a'),
      ('rabbit_files_money_insert', '72b98b2cf371ee0df286fef30d8d5686'),
      ('rabbit_files_money_update', 'c41f98d184eb460e37cd4af118b9752a'),
      ('rabbit_files_money_delete', '2c70d5bc96bb3d74c43ce6a0e34bb24b'),
      ('rabbit_thumbnails_money_select', '78366b8dd04a4de12794c2f46da6f8cc'),
      ('rabbit_thumbnails_money_insert', 'df7cff8a1541b983d8bd331cda474f82'),
      ('rabbit_thumbnails_money_update', 'a63468e65f7f5539ff6ca25160721fe7'),
      ('rabbit_thumbnails_money_delete', 'd6cc2a54f9452f07f46f5844c532ef18'),
      ('petal_bin_posters_insert', 'be9f43c1c87bde7804826b8a0ec27da5'),
      ('petal_bin_posters_update', '4d66609119c6606e283b02890bfde3f9'),
      ('petal_bin_posters_delete_own', 'df3b7e08dae664725c1eea676eae952e'),
      ('petal_bin_posters_remote_viewing_insert', '5c2903256ac409cfbddbda71e66231b2'),
      ('petal_bin_posters_remote_viewing_update', '96a5f9c25a053395687e01b84953a0fc'),
      ('petal_storage_quota_insert', 'b08a99323953283cd0545520859d6367')
    ) AS t(policy, was)
  LOOP
    SELECT md5(COALESCE(qual, '') || '|' || COALESCE(with_check, '')) INTO v_md5
      FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = r.policy;
    IF v_md5 IS DISTINCT FROM r.was THEN
      RAISE EXCEPTION '0115 post-condition: policy % is not the text it had (md5 %)', r.policy, v_md5;
    END IF;
  END LOOP;

  -- The meter still reads 0073's arm and the new one.
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_body
    FROM pg_proc WHERE oid = 'public.workspace_petal_committed_bytes(uuid)'::regprocedure;
  IF position('p.workspace_id = ws' IN v_body) = 0
     OR position('f.workspace_id = ws' IN v_body) = 0
     OR position('NOT EXISTS' IN v_body) = 0 THEN
    RAISE EXCEPTION '0115 post-condition: the meter lost an arm';
  END IF;

  RAISE NOTICE '0115 OK: the eight base policies follow the file, the money, poster and quota policies are as they were';
END $$;
