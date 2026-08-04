-- =========================================================================
-- 0042_money_segments_and_manifest_rewrite.sql — Session 27.
--
-- Two things, and they are one migration because they are one predicate:
--
--   1. THE PROJECT MANIFEST COULD ONLY EVER BE WRITTEN ONCE.
--   2. Project-scoped team member rates get a money-gated path of their own.
--
-- Idempotent: safe to re-run.
--
-- 🚨 ORDERING: 0027 -> 0038 -> 0039 -> 0042. REPLAYING ANY EARLIER ONE
-- REGRESSES THIS. 0027 owns the three base `rabbit-files` storage policies,
-- 0038 added the money-gated trio, 0039 made both compare case-insensitively,
-- and this replaces all of it with ONE predicate. Replay forwards only.
--
--
-- 1. THE MANIFEST WRITE-ONCE DEFECT — MEASURED, not inferred
-- ----------------------------------------------------------
-- S26 shipped `PROJECT.json`, a generated mirror of the project's settings,
-- written by supabaseAdapter.writeProjectManifest with { upsert: true } and
-- re-written (debounced) on EVERY settings change. Supabase Storage
-- implements upsert-over-an-existing-object as an UPDATE on storage.objects.
--
-- There has never been an UPDATE policy on this bucket. 0027 created SELECT,
-- INSERT and DELETE; 0038 and 0039 rewrote those three and added three more
-- for invoices — also SELECT/INSERT/DELETE. The only UPDATE policy on
-- storage.objects in the whole schema is user_avatars_update_own, which pins
-- bucket_id = 'user-avatars'.
--
-- So: the first write of a project's manifest succeeds (INSERT) and every
-- subsequent write is refused (UPDATE, no permissive policy => deny). The
-- adapter throws, RabbitProvider.writeManifestSoon catches it and logs
-- "the manifest is a mirror and is rewritten on the next change" — which on
-- Supabase is never true. The file freezes at its first version, silently.
--
-- Proven before this migration was written, in a rolled-back transaction as
-- a real authenticated project manager: INSERT succeeds, UPDATE affects ZERO
-- rows, and the SAME UPDATE against user-avatars succeeds — so the probe can
-- see a presence, not merely fail to see an absence (standing rule 2).
-- Local Server was never affected; fs.writeFileSync has no such notion.
--
--
-- 2. RATES NEED A GATED PATH — Audrey's call, taken 2026-08-04
-- ------------------------------------------------------------
-- Audrey, 2026-08-03, asked for "unique margin, unique contingency, unique
-- team member rates" to live in the project folder. S26 delivered the first
-- two and deliberately not the third:
--
--   project_rate_overrides_select :: can_access_project_money(project_id)
--                                    -- MANAGER ONLY
--   rabbit_files_select           :: any authenticated member, any object
--                                    under projects/<id>/ whose THIRD path
--                                    segment is not INVOICES
--
-- `projects/<id>/PROJECT.json` has no third segment, so putting rates in it
-- would hand every project member the figures RLS had just denied them —
-- the S24 invoice defect in a new file. Rates therefore get their own
-- segment, `projects/<id>/FINANCE/RATES.json`, gated exactly like invoices.
--
--
-- WHY ONE PREDICATE INSTEAD OF A SECOND PARALLEL TRIO
-- ---------------------------------------------------
-- 🚨 This is the whole design, and it is a direct response to how 0038 failed.
--
-- 0038 shipped the segment lowercase while six policies compared it
-- literally, so the gate INVERTED: invoices became invisible to the managers
-- allowed to see them and visible to everyone else. 0039 fixed it by adding
-- upper() in six places. The defect was possible because the reserved segment
-- was written out six times and had to agree six times.
--
-- Adding FINANCE the same way would make it EIGHT places (and the base three
-- must exclude BOTH segments — permissive policies OR together, so a base
-- policy that forgets FINANCE serves the rates file to every project member
-- no matter how correct the gated policy is).
--
-- So the segment list moves into ONE immutable function. The base policies
-- say `NOT rabbit_money_segment(...)`, the gated ones say
-- `rabbit_money_segment(...)`, and a third reserved segment is a one-line
-- change that cannot desynchronise. The invoice policies are renamed
-- rabbit_files_money_* because they are no longer only about invoices;
-- nothing asserts the old names (pgTAP 33 asserts the three BASE names,
-- which are unchanged) and there are ZERO objects in the bucket on dev,
-- staging and prod — measured 2026-08-04 — so no live object changes gate.
--
-- 🚨 NULL-SAFETY IS LOAD-BEARING. storage.foldername('projects/x/PROJECT.json')
-- is {projects,x} — there IS no third element, so the argument is NULL.
-- `upper(NULL) IN (...)` is NULL, and `NOT NULL` is NULL, which fails a
-- policy. The old code used `IS DISTINCT FROM`, which is null-safe by
-- construction; a naive IN-list is not. coalesce(..., false) restores that,
-- and pgTAP 53 probes the NULL case specifically, because getting this wrong
-- makes the manifest itself unreadable and unwritable by everyone.
-- =========================================================================

-- ── The one definition of a money-gated path segment ─────────────────────

CREATE OR REPLACE FUNCTION public.rabbit_money_segment(seg text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  -- coalesce, NOT a bare IN: a path with no third segment yields NULL, and a
  -- NULL here propagates through `NOT (...)` and fails the base policies —
  -- which would lock every project member out of PROJECT.json. See the header.
  SELECT coalesce(upper(seg) IN ('INVOICES', 'FINANCE'), false);
$$;

COMMENT ON FUNCTION public.rabbit_money_segment(text) IS
  'True when a rabbit-files third path segment is money-gated (INVOICES = invoice documents, FINANCE = project-scoped rate overrides). The SINGLE source of truth for the reserved-segment list: the three base storage policies negate it and the four money policies assert it, so the two can never disagree. Case-insensitive and NULL-safe — a path with no third segment (e.g. projects/<id>/PROJECT.json) is NOT money-gated.';

-- Not SECURITY DEFINER and it reads nothing, but the grantee still gets
-- checked rather than assumed (S22: seven functions were granted to PUBLIC,
-- so a REVOKE naming only anon was a silent no-op).
REVOKE ALL ON FUNCTION public.rabbit_money_segment(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rabbit_money_segment(text) TO authenticated, service_role;

-- ── The three base policies: every non-money object ──────────────────────
-- DROP + CREATE, never a narrower policy added alongside: permissive policies
-- OR together, so leaving the old one in place would change nothing at all.

DROP POLICY IF EXISTS rabbit_files_select ON storage.objects;
CREATE POLICY rabbit_files_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND NOT public.rabbit_money_segment((storage.foldername(name))[3])
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
    AND NOT public.rabbit_money_segment((storage.foldername(name))[3])
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = public.fn_try_uuid((storage.foldername(name))[2])
    )
    AND public.has_active_membership(public.current_workspace_id())
    AND public.can_write_project(public.fn_try_uuid((storage.foldername(name))[2]))
  );

-- THE FIX. Both arms are required and they pin the SAME side of the gate:
--
--   USING      — which existing objects may be updated (non-money only)
--   WITH CHECK — what the row may become           (non-money only)
--
-- With only USING, a project member could rename an ordinary object INTO
-- FINANCE/ or INVOICES/, or onto another project's prefix. With both, an
-- object cannot cross the boundary in either direction, because the
-- money-gated update policy below pins its own side identically.
--
-- No owner_id check, unlike rabbit_files_delete_own: the manifest is rewritten
-- by whoever changed a setting, which is routinely not whoever created it.
-- Ownership is the right test for "undo my own upload" and the wrong one for
-- "regenerate the project's description of itself".
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
       WHERE p.id = public.fn_try_uuid((storage.foldername(name))[2])
    )
    AND public.has_active_membership(public.current_workspace_id())
    AND public.can_write_project(public.fn_try_uuid((storage.foldername(name))[2]))
  )
  WITH CHECK (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND NOT public.rabbit_money_segment((storage.foldername(name))[3])
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
    AND NOT public.rabbit_money_segment((storage.foldername(name))[3])
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = public.fn_try_uuid((storage.foldername(name))[2])
    )
    AND public.has_active_membership(public.current_workspace_id())
    AND public.can_write_project(public.fn_try_uuid((storage.foldername(name))[2]))
    AND created_at > (now() - interval '1 hour')
  );

-- ── The money-gated four: INVOICES and FINANCE, identically ──────────────
-- Renamed from rabbit_files_invoices_* — the old names are dropped explicitly
-- so a re-run cannot leave both sets live, which would OR the old
-- invoices-only predicate back in beside the new one.

DROP POLICY IF EXISTS rabbit_files_invoices_select ON storage.objects;
DROP POLICY IF EXISTS rabbit_files_invoices_insert ON storage.objects;
DROP POLICY IF EXISTS rabbit_files_invoices_delete ON storage.objects;

DROP POLICY IF EXISTS rabbit_files_money_select ON storage.objects;
CREATE POLICY rabbit_files_money_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND public.rabbit_money_segment((storage.foldername(name))[3])
    AND public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
  );

DROP POLICY IF EXISTS rabbit_files_money_insert ON storage.objects;
CREATE POLICY rabbit_files_money_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND public.rabbit_money_segment((storage.foldername(name))[3])
    AND public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
  );

-- The rates mirror is regenerated exactly like the manifest, so it needs the
-- same UPDATE arm — and for the same measured reason. Invoices gain one too;
-- they are uploaded with upsert:false so nothing exercises it today, but a
-- gate that differs between two segments sharing one predicate is the
-- inconsistency this migration exists to remove.
DROP POLICY IF EXISTS rabbit_files_money_update ON storage.objects;
CREATE POLICY rabbit_files_money_update ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND public.rabbit_money_segment((storage.foldername(name))[3])
    AND public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
  )
  WITH CHECK (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND public.rabbit_money_segment((storage.foldername(name))[3])
    AND public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
  );

-- No one-hour window here, unlike rabbit_files_delete_own. That window exists
-- to make "undo my own upload" safe without granting a general delete; a
-- money-cleared manager removing an invoice or a stale rates mirror is a
-- deliberate act, not an undo. (Carried verbatim from 0038's reasoning.)
DROP POLICY IF EXISTS rabbit_files_money_delete ON storage.objects;
CREATE POLICY rabbit_files_money_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'rabbit-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND public.rabbit_money_segment((storage.foldername(name))[3])
    AND public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
  );

-- ── Post-conditions ──────────────────────────────────────────────────────
-- Scan EVERY policy on the table rather than the list this migration wrote
-- (S22: checking your own list is what misses the object you forgot).

DO $$
DECLARE
  n INT;
  bad TEXT;
BEGIN
  -- 1. Nothing on this bucket still hard-codes a segment name. If any policy
  --    does, it is by definition out of step with the function.
  SELECT string_agg(policyname, ', ') INTO bad
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname LIKE 'rabbit_files%'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%INVOICES%';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '0042 post-condition failed: policies still hard-code a segment name: %', bad;
  END IF;

  -- 2. Every rabbit-files policy routes through the one predicate.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname LIKE 'rabbit_files%'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%rabbit_money_segment%';
  IF n <> 8 THEN
    RAISE EXCEPTION '0042 post-condition failed: % of 8 rabbit-files policies use rabbit_money_segment', n;
  END IF;

  -- 3. The UPDATE arm exists on both sides — the actual manifest fix.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN ('rabbit_files_update', 'rabbit_files_money_update')
     AND cmd = 'UPDATE'
     AND with_check IS NOT NULL;
  IF n <> 2 THEN
    RAISE EXCEPTION '0042 post-condition failed: % of 2 UPDATE policies exist with a WITH CHECK arm', n;
  END IF;

  -- 4. The four money policies still carry the money gate itself. A predicate
  --    that selects the right objects and forgets to check the caller is a
  --    gate that matches everything and stops nobody.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname LIKE 'rabbit_files_money_%'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%can_access_project_money%';
  IF n <> 4 THEN
    RAISE EXCEPTION '0042 post-condition failed: % of 4 money policies carry can_access_project_money', n;
  END IF;

  -- 5. The old names are gone, not merely superseded — two live sets would OR.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname LIKE 'rabbit_files_invoices%';
  IF n <> 0 THEN
    RAISE EXCEPTION '0042 post-condition failed: % old rabbit_files_invoices_* policies survive', n;
  END IF;

  -- 6. The row-level gate from 0038 is untouched.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'files'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%can_access_project_money%';
  IF n <> 4 THEN
    RAISE EXCEPTION '0042 post-condition failed: % of 4 files policies carry the money gate', n;
  END IF;

  -- 7. NULL-safety, asserted rather than reasoned about: PROJECT.json has no
  --    third segment and MUST remain non-money, or the base policies deny it.
  IF public.rabbit_money_segment(NULL) IS DISTINCT FROM false THEN
    RAISE EXCEPTION '0042 post-condition failed: rabbit_money_segment(NULL) is not false — PROJECT.json would be unreachable';
  END IF;
  IF public.rabbit_money_segment('invoices') IS DISTINCT FROM true
     OR public.rabbit_money_segment('FINANCE') IS DISTINCT FROM true
     OR public.rabbit_money_segment('ASSETS')  IS DISTINCT FROM false THEN
    RAISE EXCEPTION '0042 post-condition failed: rabbit_money_segment does not classify segments correctly';
  END IF;

  -- 8. The new function is not reachable pre-auth. Checks the GRANTEE, not
  --    the grant: 0011 handed things to PUBLIC, so naming only anon is a
  --    silent no-op (S22).
  IF has_function_privilege('anon', 'public.rabbit_money_segment(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '0042 post-condition failed: anon can execute rabbit_money_segment';
  END IF;

  RAISE NOTICE '0042 OK: 8 rabbit-files policies on one predicate, UPDATE arms present on both sides, money gate intact, PROJECT.json remains non-money.';
END $$;
