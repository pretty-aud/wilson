-- =========================================================================
-- 0038_financial_files.sql — Session 24 (follow-up).
--
-- Invoice attachments must work on the WEB, and must stay manager-only.
--
-- Idempotent: safe to re-run.
--
-- 🚨 ORDERING: 0027 -> 0038, AND RE-RUNNING 0027 SILENTLY RE-OPENS INVOICES.
-- 0027 owns the three `rabbit-files` storage policies. This migration
-- rewrites all three to EXCLUDE the invoices prefix and adds three
-- money-gated policies beside them. Re-running 0027 would DROP and recreate
-- its three WITHOUT the exclusion — and its own post-condition counts only
-- its own three policy names, so it would report success while every invoice
-- became readable by any project member again. Same trap shape as
-- 0011 -> 0033. If 0027 is ever replayed, replay 0038 after it.
--
-- WHY
-- ---
-- Audrey: "can the attach invoice button not able to work in the web app? it
-- needs to work."
--
-- MEASURED: it could not. `CrewTeamTab.jsx:74-96` and `TalentTab.jsx:86-108`
-- called `window.rabbitDesktop.pickFiles` and POSTed to
-- `http://localhost:19854/.../invoice-folder`, then copied the file into a
-- folder on the local disk. Neither the bridge nor the local server exists on
-- the staging-backed beta, so the button did nothing there.
--
-- The fix is to route invoices through the adapter's existing
-- `uploadFile()` -> `rabbit-files` bucket + `public.files` row, which already
-- works on both Supabase and Local Server. But doing ONLY that would have
-- quietly broken the rule set earlier in this session:
--
-- 🚨 MEASURED, and the reason this migration exists at all:
--   * `files_select` (0014:244) admits ANY workspace member who can see the
--     project — it never consults `can_write_project`, let alone money.
--   * `rabbit_files_select` on storage.objects (0027:301) is the same shape:
--     any authenticated caller, any object under a project they can see.
-- So an invoice PDF uploaded the obvious way would have been readable — the
-- actual document, not just the number — by exactly the reviewers and team
-- members whose access to the AMOUNT 0037 had just closed. Hiding the value
-- while serving the invoice that states it is not a policy, it is a leak.
--
-- Hence: a `files.is_financial` flag, a dedicated `invoices` path segment,
-- and `can_access_project_money()` on both layers. The blob and the row are
-- gated independently, because either one alone is a way in.
-- =========================================================================

-- ── 1. The flag ──────────────────────────────────────────────────────────

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS is_financial BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.files.is_financial IS
  'Marks a file as financial (an invoice or receipt). Financial rows are readable and writable ONLY by can_access_project_money(project_id) — see the four files_* policies. The blob is gated separately by the rabbit_files_invoices_* storage policies keyed on the "invoices" path segment; both gates are required, because either alone leaves a way in.';

CREATE INDEX IF NOT EXISTS files_project_financial_idx
  ON public.files (project_id) WHERE is_financial;

-- ── 2. public.files policies ─────────────────────────────────────────────
--
-- DROP + CREATE, never an added policy: permissive policies OR together, so
-- a narrow arm placed beside the existing broad one would change nothing at
-- all. That mistake cost S15 a CRITICAL.
--
-- Each policy below preserves its previous predicate verbatim and adds the
-- one financial clause. `NOT is_financial OR can_access_project_money(...)`
-- leaves every ordinary file behaving exactly as before.

DROP POLICY IF EXISTS files_select ON public.files;
CREATE POLICY files_select ON public.files
  FOR SELECT USING (
    deleted_at IS NULL
    AND workspace_id = public.current_workspace_id()
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = files.project_id)
    AND (NOT is_financial OR public.can_access_project_money(project_id))
  );

DROP POLICY IF EXISTS files_insert ON public.files;
CREATE POLICY files_insert ON public.files
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
    AND (NOT is_financial OR public.can_access_project_money(project_id))
  );

-- USING guards the OLD row, WITH CHECK the NEW one, and BOTH carry the
-- financial clause. That is what stops a team member clearing is_financial
-- on someone else's invoice and then reading it: the UPDATE cannot see the
-- row in the first place.
DROP POLICY IF EXISTS files_update ON public.files;
CREATE POLICY files_update ON public.files
  FOR UPDATE
  USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
    AND (NOT is_financial OR public.can_access_project_money(project_id))
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.can_write_project(project_id)
    AND (NOT is_financial OR public.can_access_project_money(project_id))
  );

DROP POLICY IF EXISTS files_delete ON public.files;
CREATE POLICY files_delete ON public.files
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
    AND (NOT is_financial OR public.can_access_project_money(project_id))
  );

-- ── 3. storage.objects — the blob ────────────────────────────────────────
--
-- Object paths are `projects/{projectId}/{entity}/{entityId}/{ts}-{name}`, so
-- `(storage.foldername(name))[3]` is the entity. Invoices use the reserved
-- entity `invoices`.
--
-- `[3] IS DISTINCT FROM 'invoices'` rather than `<>`: a shorter path yields
-- NULL there, and `NULL <> 'invoices'` is NULL, which would fail the policy
-- and break ordinary project-scoped uploads. IS DISTINCT FROM returns true,
-- so non-invoice objects keep their existing behaviour exactly.

DROP POLICY IF EXISTS rabbit_files_select ON storage.objects;
CREATE POLICY rabbit_files_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND (storage.foldername(name))[3] IS DISTINCT FROM 'invoices'
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
    AND (storage.foldername(name))[3] IS DISTINCT FROM 'invoices'
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
    AND (storage.foldername(name))[3] IS DISTINCT FROM 'invoices'
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = public.fn_try_uuid((storage.foldername(name))[2])
    )
    AND public.has_active_membership(public.current_workspace_id())
    AND public.can_write_project(public.fn_try_uuid((storage.foldername(name))[2]))
    AND created_at > (now() - interval '1 hour')
  );

-- The money-gated trio. Same shape, opposite prefix test, and
-- can_access_project_money instead of can_write_project.

DROP POLICY IF EXISTS rabbit_files_invoices_select ON storage.objects;
CREATE POLICY rabbit_files_invoices_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND (storage.foldername(name))[3] = 'invoices'
    AND public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
  );

DROP POLICY IF EXISTS rabbit_files_invoices_insert ON storage.objects;
CREATE POLICY rabbit_files_invoices_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND (storage.foldername(name))[3] = 'invoices'
    AND public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
  );

-- No one-hour window here, unlike rabbit_files_delete_own. That window exists
-- so an ordinary uploader can undo a mistake without being able to delete the
-- project's history; a money-cleared manager removing a wrong invoice is a
-- normal correction and should not be time-limited.
DROP POLICY IF EXISTS rabbit_files_invoices_delete ON storage.objects;
CREATE POLICY rabbit_files_invoices_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND (storage.foldername(name))[3] = 'invoices'
    AND public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
  );

-- ── 4. Post-conditions ───────────────────────────────────────────────────

DO $$
DECLARE
  n INT;
  q TEXT;
BEGIN
  -- 4a. the flag landed
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'files'
       AND column_name = 'is_financial'
  ) THEN
    RAISE EXCEPTION '0038 post-condition failed: files.is_financial missing';
  END IF;

  -- 4b. all four files policies mention the money gate. Scan the live
  -- expressions rather than trusting that the statements above ran — a
  -- policy that silently kept its old body is the failure that matters.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'files'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%can_access_project_money%';
  IF n <> 4 THEN
    RAISE EXCEPTION '0038 post-condition failed: % of 4 files policies carry the money gate', n;
  END IF;

  -- 4c. files still has exactly four policies and no FOR ALL arm
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'files';
  IF n <> 4 THEN
    RAISE EXCEPTION '0038 post-condition failed: files has % policies, expected 4', n;
  END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'files' AND cmd = 'ALL';
  IF n <> 0 THEN
    RAISE EXCEPTION '0038 post-condition failed: files has a FOR ALL policy';
  END IF;

  -- 4d. the three base storage policies now exclude the invoices prefix.
  -- This is the assertion that catches a 0027 replay.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN ('rabbit_files_select', 'rabbit_files_insert', 'rabbit_files_delete_own')
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%invoices%';
  IF n <> 3 THEN
    RAISE EXCEPTION '0038 post-condition failed: % of 3 base rabbit-files storage policies exclude the invoices prefix (re-running 0027 undoes this)', n;
  END IF;

  -- 4e. the three money-gated storage policies exist and all carry the gate
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN ('rabbit_files_invoices_select', 'rabbit_files_invoices_insert', 'rabbit_files_invoices_delete')
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%can_access_project_money%';
  IF n <> 3 THEN
    RAISE EXCEPTION '0038 post-condition failed: % of 3 invoice storage policies carry the money gate', n;
  END IF;

  -- 4f. the standing anon probe, for files
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'files' AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION '0038 post-condition failed: anon holds privileges on files';
  END IF;

  RAISE NOTICE '0038 OK: files.is_financial, 4 money-aware files policies, 3 base storage policies excluding invoices, 3 money-gated invoice policies.';
END $$;
