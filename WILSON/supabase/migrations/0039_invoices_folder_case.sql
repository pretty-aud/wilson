-- =========================================================================
-- 0039_invoices_folder_case.sql — Session 24 (follow-up).
--
-- Invoices live in a folder called INVOICES.
--
-- Idempotent: safe to re-run.
--
-- 🚨 ORDERING: 0027 -> 0038 -> 0039, and REPLAYING 0027 OR 0038 REGRESSES THIS.
-- 0027 owns the three base `rabbit-files` storage policies; 0038 rewrote them
-- to exclude the invoice prefix; this rewrites all six to compare
-- case-insensitively. Replaying an earlier one recreates its policies without
-- the later change and reports success while doing it. Replay forwards.
--
-- WHY
-- ---
-- Audrey: "invoices should go into the project folder. it should be in a
-- nested folder in the project called INVOICES."
--
-- 0038 shipped the path segment lowercase (`projects/<id>/invoices/...`) and
-- the six storage policies compare it literally. Renaming the segment to
-- `INVOICES` in the adapter WITHOUT this migration would be the worst
-- possible outcome and would look like it worked:
--
--   * `rabbit_files_invoices_select` requires [3] = 'invoices' — an uppercase
--     object would not match, so no manager could read it back; and
--   * the three base policies exclude [3] = 'invoices', so an uppercase object
--     would fall through to them and be readable by ANY project member.
--
-- That is precisely inverted: the invoice becomes invisible to the people
-- allowed to see it and visible to everyone else. A silent, total reversal of
-- the gate, from a one-word rename. Hence: compare on upper(), so both the
-- old lowercase objects and the new uppercase ones are gated identically and
-- neither can ever fall through.
--
-- Case-insensitive rather than a rename of existing objects, because storage
-- objects cannot be renamed in place from SQL, and any invoice already
-- uploaded must not lose its protection while a migration catches up.
-- =========================================================================

-- ── The three base policies: exclude the invoice prefix, any case ────────

DROP POLICY IF EXISTS rabbit_files_select ON storage.objects;
CREATE POLICY rabbit_files_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND upper((storage.foldername(name))[3]) IS DISTINCT FROM 'INVOICES'
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = public.fn_try_uuid((storage.foldername(name))[2])
    )
  );

DROP POLICY IF EXISTS rabbit_files_insert ON storage.objects;
CREATE POLICY rabbit_files_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND upper((storage.foldername(name))[3]) IS DISTINCT FROM 'INVOICES'
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = public.fn_try_uuid((storage.foldername(name))[2])
    )
    AND public.has_active_membership(public.current_workspace_id())
    AND public.can_write_project(public.fn_try_uuid((storage.foldername(name))[2]))
  );

DROP POLICY IF EXISTS rabbit_files_delete_own ON storage.objects;
CREATE POLICY rabbit_files_delete_own ON storage.objects
  FOR DELETE USING (
    bucket_id = 'rabbit-files'
    AND owner_id = (auth.uid())::text
    AND (storage.foldername(name))[1] = 'projects'
    AND upper((storage.foldername(name))[3]) IS DISTINCT FROM 'INVOICES'
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = public.fn_try_uuid((storage.foldername(name))[2])
    )
    AND public.has_active_membership(public.current_workspace_id())
    AND public.can_write_project(public.fn_try_uuid((storage.foldername(name))[2]))
    AND created_at > (now() - interval '1 hour')
  );

-- ── The money-gated trio: serve the invoice prefix, any case ─────────────

DROP POLICY IF EXISTS rabbit_files_invoices_select ON storage.objects;
CREATE POLICY rabbit_files_invoices_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND upper((storage.foldername(name))[3]) = 'INVOICES'
    AND public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
  );

DROP POLICY IF EXISTS rabbit_files_invoices_insert ON storage.objects;
CREATE POLICY rabbit_files_invoices_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND upper((storage.foldername(name))[3]) = 'INVOICES'
    AND public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
  );

DROP POLICY IF EXISTS rabbit_files_invoices_delete ON storage.objects;
CREATE POLICY rabbit_files_invoices_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND upper((storage.foldername(name))[3]) = 'INVOICES'
    AND public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
  );

-- ── Post-conditions ──────────────────────────────────────────────────────

DO $$
DECLARE n INT;
BEGIN
  -- All six policies compare case-insensitively. If any one is left matching
  -- literally, an object in the other case falls into the wrong policy — and
  -- for the three base ones that means readable by everybody.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname LIKE 'rabbit_files%'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%upper%'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%INVOICES%';
  IF n <> 6 THEN
    RAISE EXCEPTION '0039 post-condition failed: % of 6 rabbit-files policies compare the invoice segment case-insensitively', n;
  END IF;

  -- The three money-gated ones still carry the gate.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN ('rabbit_files_invoices_select', 'rabbit_files_invoices_insert', 'rabbit_files_invoices_delete')
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%can_access_project_money%';
  IF n <> 3 THEN
    RAISE EXCEPTION '0039 post-condition failed: % of 3 invoice storage policies carry the money gate', n;
  END IF;

  -- And the row-level flag from 0038 is untouched.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'files'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%can_access_project_money%';
  IF n <> 4 THEN
    RAISE EXCEPTION '0039 post-condition failed: % of 4 files policies carry the money gate', n;
  END IF;

  RAISE NOTICE '0039 OK: all 6 rabbit-files storage policies match INVOICES case-insensitively; files row gate intact.';
END $$;
