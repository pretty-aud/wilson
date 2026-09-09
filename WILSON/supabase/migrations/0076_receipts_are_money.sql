-- =============================================================================
-- 0076_receipts_are_money.sql — Track C, bundle C4: an expense receipt is
-- money, and every receipt uploaded before this migration was not treated as
-- such.
--
-- Audrey's ruling that lands here (FIX_PLAN_2026-09-04.md, Track C table, row
-- C4, added 2026-09-07): "New expense receipts carry the money flag like
-- invoices (one key in BudgetView's upload), and migration 0076 marks every
-- existing receipt financial."
--
-- ── THE DEFECT ───────────────────────────────────────────────────────────────
-- `BudgetView`'s receipt upload passed `adapter.uploadFile(projectId,
-- { type: 'expense' }, file)`. `scope.type` is read by NOTHING — not
-- supabaseAdapter, not localServerAdapter, not the Express server (verified by
-- symbol across the tree, not assumed from the brief). So the scope was
-- effectively EMPTY: no money flag, no entity link. The receipt landed as an
-- ordinary project-level file and every project member could read it.
--
-- The asymmetry is the point. `public.expenses` is one of the five tables
-- 0037 gates on can_access_project_money() — only a workspace admin or a
-- project manager can read an expense at all, and only they can create one.
-- So the AMOUNT was manager-only while the RECEIPT STATING THE AMOUNT was not.
-- 0038's own column comment already calls files.is_financial "an invoice or
-- receipt": the intent was there from the beginning and only the receipt half
-- was ever wired.
--
-- The client half is one key (`financial: true`), and it is genuinely one key
-- because uploadFile spends it three times in one function — the reserved
-- INVOICES path segment (the blob gate), files.is_financial (the row gate),
-- and the Supabase pin (0050). This file is the other half: the receipts that
-- are already here.
--
-- ── WHAT A RECEIPT IS, PRECISELY ─────────────────────────────────────────────
-- A `files` row whose id appears in some `expenses.file_ids`. That array is
-- the ONLY file_ids column in the entire schema (checked, not assumed), so
-- the predicate is complete rather than representative.
--
-- ── 🚨 TRAP 1: THIS MIGRATION CAN ABORT, AND THE BRIEF DOES NOT SAY SO ───────
-- files_money_provider_chk (0050) is
--     storage_provider = 'supabase'
--     OR NOT (COALESCE(is_financial,false) OR rabbit_money_segment(<seg 3>))
-- so setting is_financial on a row whose body lives in a CUSTOMER'S bucket
-- VIOLATES THE CHECK and takes the whole migration down with it. A receipt on
-- a BYO S3 or network workspace is exactly that row. The backfill is therefore
-- scoped to storage_provider = 'supabase', and the rows it cannot touch are
-- COUNTED AND REPORTED rather than silently skipped — they need their body
-- moved into Supabase first, which is not a thing SQL can do.
--
-- ── 🚨 TRAP 2: THIS CLOSES THE ROW GATE AND NOT THE BLOB GATE ────────────────
-- 0038 gates the row on files.is_financial and the blob on the THIRD PATH
-- SEGMENT — the three base rabbit_files_* storage policies test
-- `[3] IS DISTINCT FROM 'invoices'` and never consult files.is_financial. An
-- existing receipt's object sits under its container segment (assets/, tasks/,
-- project/), so flipping the row flag does NOT move it to the money side of
-- that test. What the flip DOES achieve is real and worth having: the row —
-- name, size, description, and crucially the storage_path itself — becomes
-- manager-only, so the path can no longer be DISCOVERED through the app. But
-- anyone who already holds that path keeps object-level read access.
--
-- Moving the bytes is not a migration's job: storage.objects.name is the S3
-- key, so renaming the row without moving the object breaks the download. A
-- one-time client-side mover (C3's runAttachmentMigration is the shape) is the
-- only correct instrument, and it is out of scope for a Half bundle. So the
-- gap is COUNTED AND NAMED at apply time instead of left invisible — the same
-- reasoning as C2's byo_* certificate counts.
--
-- MEASURED BEFORE THIS FILE WAS WRITTEN (2026-09-08, by query, with
-- inet_server_addr() + a workspace count as the discriminator):
--     dev     …9d59…  4 workspaces  0 expenses  0 files  0 receipts
--     staging …9d47…  1 workspace   0 expenses  0 files  0 receipts
-- Both statements below are no-ops today. They exist for the environments
-- that come later, and every count this file reports will be 0 on both.
--
-- ── WHY NO VIEW ──────────────────────────────────────────────────────────────
-- A durable `receipts_outside_money_namespace` view was considered and
-- REJECTED: it would add a second readable surface over the money table, which
-- is the exact class of defect this bundle exists to fix, and a view over
-- `files` without security_invoker bypasses RLS entirely. The counts are
-- raised at apply time and the standing diagnostic query lives in the
-- handbook (§12.4) instead.
--
-- Idempotent: both backfills are guarded by `NOT is_financial`, the report is
-- a read, and the post-conditions are assertions. Safe to re-run.
-- Touches no policy, no grant, no column definition and no default.
-- pgTAP: 78_file_events_money.sql, extended (probes 50-58). Track C's suite
-- reservation 77-79 is spent, so this bundle EXTENDS its own suite rather than
-- taking a number belonging to another track (FIX_PLAN rules, item 2).
-- =============================================================================

-- ── 1. The receipts themselves ──────────────────────────────────────────────
-- `storage_provider = 'supabase'` is TRAP 1, not an optimisation: without it
-- one BYO-hosted receipt aborts the migration. `NOT f.is_financial` makes the
-- statement idempotent and keeps it from rewriting rows that are already right.

UPDATE public.files f
   SET is_financial = true
 WHERE NOT f.is_financial
   AND f.storage_provider = 'supabase'
   AND EXISTS (
         SELECT 1 FROM public.expenses e
          WHERE f.id = ANY (e.file_ids)
       );

-- ── 2. Their history ────────────────────────────────────────────────────────
-- Audrey's ruling for this bundle (2026-09-08): the activity stream is gated
-- too. 0074 snapshots is_financial onto file_events AT CAPTURE TIME so the flag
-- survives the row's deletion — which means a receipt that becomes financial
-- LATER (i.e. every receipt this file just flipped) still has unflagged
-- upload/move/trash events, and a plain member could read the receipt's whole
-- history through file_events_select even though the files row is now hidden.
--
-- C2 stated that limit and chose not to backfill on every change. This is not
-- every change: it is one known, one-time correction of a misclassification,
-- so the events are corrected with it. The statement is 0074's own first
-- backfill, verbatim in shape, re-run now that the flags above are right.
--
-- Deliberately NOT the second 0074 statement (classification by path): these
-- receipts are outside the money namespace BY DEFINITION — that is TRAP 2 —
-- so a path-based pass would flag nothing and imply it had checked.

UPDATE public.file_events fe
   SET is_financial = true
  FROM public.files f
 WHERE f.id = fe.file_id
   AND f.is_financial
   AND NOT fe.is_financial;

-- ── 3. The report, and the post-conditions ──────────────────────────────────

DO $$
DECLARE
  v_receipts        INT;
  v_flagged         INT;
  v_blob_outside    INT;
  v_byo_blocked     INT;
  v_unflagged       INT;
  v_policies        INT;
BEGIN
  -- 3a. THE REPORT. Counts of STATE, not of rows just written, so a re-run
  --     reports the same numbers rather than a second delta of zero.

  SELECT count(*) INTO v_receipts
    FROM public.files f
   WHERE EXISTS (SELECT 1 FROM public.expenses e WHERE f.id = ANY (e.file_ids));

  SELECT count(*) INTO v_flagged
    FROM public.files f
   WHERE f.is_financial
     AND EXISTS (SELECT 1 FROM public.expenses e WHERE f.id = ANY (e.file_ids));

  -- TRAP 2 made legible: flagged, so the ROW is gated, but the body is not
  -- under a money segment, so the BLOB is still served by the base storage
  -- policies to anyone who already knows the path.
  SELECT count(*) INTO v_blob_outside
    FROM public.files f
   WHERE f.is_financial
     AND f.storage_provider = 'supabase'
     AND NOT public.rabbit_money_key(f.storage_path)
     AND EXISTS (SELECT 1 FROM public.expenses e WHERE f.id = ANY (e.file_ids));

  -- TRAP 1 made legible: could not be flagged at all, because
  -- files_money_provider_chk refuses a financial row outside Supabase. These
  -- are the ones that need a body move before they can be gated at all.
  SELECT count(*) INTO v_byo_blocked
    FROM public.files f
   WHERE NOT f.is_financial
     AND f.storage_provider <> 'supabase'
     AND EXISTS (SELECT 1 FROM public.expenses e WHERE f.id = ANY (e.file_ids));

  RAISE NOTICE '0076: % receipt row(s); % now financial; % still ungated because the body is on a customer bucket (needs a body move first); % gated at the row but whose blob is still outside the money path segment.',
    v_receipts, v_flagged, v_byo_blocked, v_blob_outside;

  -- 3b. POST-CONDITION 1 — the thing this file exists to do. Every receipt
  --     whose body IS in Supabase is now financial. Scoped to supabase rows
  --     because the others are refused by the CHECK, are counted above, and
  --     are named in the hand-off; asserting over them would fail forever.
  SELECT count(*) INTO v_unflagged
    FROM public.files f
   WHERE NOT f.is_financial
     AND f.storage_provider = 'supabase'
     AND EXISTS (SELECT 1 FROM public.expenses e WHERE f.id = ANY (e.file_ids));

  IF v_unflagged > 0 THEN
    RAISE EXCEPTION '0076 post-condition failed: % Supabase-hosted receipt row(s) are still not is_financial', v_unflagged;
  END IF;

  -- 3c. POST-CONDITION 2 — and so is their history. Same scoping.
  IF EXISTS (
    SELECT 1
      FROM public.file_events fe
      JOIN public.files f ON f.id = fe.file_id
     WHERE f.is_financial
       AND NOT fe.is_financial
  ) THEN
    RAISE EXCEPTION '0076 post-condition failed: a financial file still has unflagged file_events rows';
  END IF;

  -- 3d. TRIPWIRE — the CHECK that made TRAP 1 real is still there. If a later
  --     session drops it to "make the backfill simpler", the money body could
  --     leave Supabase and this file's scoping would silently become wrong.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.files'::regclass AND contype = 'c'
       AND conname = 'files_money_provider_chk'
  ) THEN
    RAISE EXCEPTION '0076 post-condition failed: files_money_provider_chk is gone — a money body could now leave Supabase';
  END IF;

  -- 3e. TRIPWIRE — is_financial is untouched as a COLUMN. This file writes
  --     values, never the definition. A default flipped to true here would
  --     make every future file money.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'files'
       AND column_name = 'is_financial'
       AND is_nullable = 'NO' AND column_default = 'false'
  ) THEN
    RAISE EXCEPTION '0076 post-condition failed: files.is_financial is no longer NOT NULL DEFAULT false';
  END IF;

  -- 3f. TRIPWIRE — the C3 polarity, restated. This bundle says "money" and
  --     nothing else; is_core_definer must not have moved with it.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'files'
       AND column_name = 'is_core_definer'
       AND is_nullable = 'NO' AND column_default = 'false'
  ) THEN
    RAISE EXCEPTION '0076 post-condition failed: files.is_core_definer is no longer NOT NULL DEFAULT false';
  END IF;

  -- 3g. TRIPWIRE — still exactly the four money-aware files policies of 0038.
  --     A backfill has no business changing the gate it is filling, and a
  --     fifth permissive policy would OR its way past all four.
  SELECT count(*) INTO v_policies
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'files';

  IF v_policies <> 4 THEN
    RAISE EXCEPTION '0076 post-condition failed: expected 4 policies on public.files, found %', v_policies;
  END IF;

  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'files'
         AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%can_access_project_money%') <> 4 THEN
    RAISE EXCEPTION '0076 post-condition failed: a files policy lost its money arm';
  END IF;

  -- 3h. TRIPWIRE — RLS still enabled AND forced. The flag is only a gate
  --     because RLS reads it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.files'::regclass AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION '0076 post-condition failed: RLS is no longer enabled and forced on public.files';
  END IF;

  -- 3i. Nothing was granted. anon and PUBLIC hold nothing on either table.
  IF EXISTS (
    SELECT 1 FROM information_schema.column_privileges
     WHERE table_schema = 'public' AND table_name IN ('files', 'file_events')
       AND grantee IN ('anon', 'PUBLIC')
  ) THEN
    RAISE EXCEPTION '0076 post-condition failed: anon or PUBLIC holds a column privilege on files or file_events';
  END IF;

  RAISE NOTICE '0076 OK: receipts are money — rows and their history flagged, four money policies intact, both column definitions unmoved.';
END $$;
