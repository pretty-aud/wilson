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
-- SEGMENT — the FOUR base rabbit_files_* storage policies (select, insert,
-- update, delete_own — 0042:122/135/164/192) test
-- `NOT public.rabbit_money_segment((storage.foldername(name))[3])`, which is
-- INVOICES *or* FINANCE in ANY case, and never consult files.is_financial. An
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
-- handbook (§12.9) instead.
--
-- Idempotent: both backfills are guarded by `NOT is_financial`, the report is
-- a read, and the post-conditions are assertions. Safe to re-run.
-- Touches no policy, no grant, no column definition and no default.
--
-- ── THREE THINGS REVIEW ROUND 1 ADDED TO THIS HEADER ─────────────────────────
-- 1. TWO DIFFERENT "THIRD SEGMENT" EXTRACTORS APPEAR BELOW, deliberately.
--    0050's CHECK uses `split_part(storage_path, '/', 3)` (rendered as <seg 3>
--    above); 3b uses `public.rabbit_money_key(storage_path)`, which is
--    `foldername[1] = 'projects' AND rabbit_money_segment(foldername[3])`.
--    They diverge at depth three — split_part keeps the filename, foldername
--    drops it — and 0050:251-263 spends twelve lines warning that confusing
--    them is easy. rabbit_money_key is the right one for 3b because 3b asks
--    what the STORAGE POLICIES do, and they use foldername. Both divergences
--    are in the safe direction (v_blob_outside can only over-count).
-- 2. THE RECEIPT PREDICATE IS UN-INDEXABLE AND IS EVALUATED SIX TIMES.
--    `f.id = ANY (e.file_ids)` cannot be a join key and there is no GIN index
--    on expenses.file_ids (0037:305-306 creates only expenses_project_idx), so
--    each evaluation is O(files x expenses). Free at today's zero rows; this
--    file exists for the environments that come later, which is exactly when
--    it bites. Left as-is rather than fixed: a GIN index is DDL this file
--    promises not to do, and a temp table would change its shape. If a real
--    environment ever carries many receipts, materialise the id set first.
-- 3. THIS FILE OPENS NO TRANSACTION OF ITS OWN, and no migration in this repo
--    does. Under the Supabase CLI (and therefore CI) each file is applied
--    transactionally, so a failed post-condition rolls the backfill back.
--    Under a plain psql apply it would NOT: statements 1 and 2 would already
--    be committed and the post-conditions would be a report, not a guard.
--    Apply this file through the CLI.
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
-- C2 stated that limit and chose not to backfill on every change. This is one
-- known, one-time correction of a misclassification, so the events are
-- corrected with it. The statement below is BYTE-IDENTICAL to 0074's own first
-- backfill (0074:147-152), re-run now that the flags above are right.
--
-- ⚠️ REVIEW ROUND 1 corrected two overstatements here. (a) The statement is
-- NOT scoped to the receipts statement 1 just flipped: it re-runs GLOBALLY
-- over every currently-financial file, invoices included, exactly as 0074 did.
-- 0074 already ran it, so the residue is only rows flipped between 0074 and
-- 0076 — and the over-reach is in the safe direction (more events hidden from
-- non-money readers, never fewer). (b) It said these receipts are outside the
-- money namespace "BY DEFINITION"; that is a fact about the UI, not the
-- schema. `expenses.file_ids` is a plain uuid[] with no FK and no trigger and
-- it sits in supabaseAdapter's write allowlist, so a client CAN point an
-- expense at a file already under INVOICES/. The code handles that correctly
-- (3b filters on NOT rabbit_money_key); only the word was too strong.
--
-- Deliberately NOT the second 0074 statement (classification by path): 0074's
-- capture trigger already classifies every NEW event by path at capture time,
-- so a path-based pass here would flag nothing and imply it had checked.

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
  -- ── 🚨 3z. THE TRIPWIRE THAT HAS TO COME FIRST (review round 1) ───────────
  -- public.files and public.expenses are both ENABLE **and FORCE** row
  -- security (0004:344-345, 0037:483-484), and FORCE subjects the table OWNER
  -- to its own policies. In a migration session there is no JWT, so
  -- current_workspace_id() is NULL and files_update / expenses_select match
  -- NOTHING. A role without BYPASSRLS would therefore update zero rows, read
  -- zero in every count below, pass 3b and 3c vacuously, and print
  -- "0076 OK: receipts are money" over a database full of ungated receipts.
  --
  -- Nothing else in this file can tell those two worlds apart: every
  -- post-condition is evaluated through the same policies the write went
  -- through, and on a zero-receipt environment both worlds answer 0. 3h below
  -- even ASSERTS the forcing that creates the hazard. So the escape is
  -- asserted rather than assumed.
  --
  -- Measured on wilson-dev 2026-09-09: current_user = postgres, rolsuper =
  -- false, rolbypassrls = TRUE. The C4 apply was therefore sound; this guard
  -- is insurance for the environments that come later, not a retraction.
  -- file_events is deliberately ENABLE-but-not-FORCE (0027:109-111, the 0012
  -- idiom), so statement 2 was never at risk either way.
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION '0076 refused: applying role % is subject to FORCE RLS on public.files, so the backfill and every count in this file would silently see nothing. Apply as a role with BYPASSRLS.', current_user;
  END IF;

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

  -- 3c. POST-CONDITION 2 — and so is their history. NOT 3b's scoping (review
  --     round 1): this is scoped as STATEMENT 2 is — every financial file,
  --     not only the receipts, and no storage_provider filter. It is 0074's
  --     own post-condition 7 (0074:705-712) restated.
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
  --     Review round 1: asserted by its DEFINITION, not its name. A later
  --     session that DROPs and re-ADDs the constraint with the money arm
  --     removed — precisely the "make the backfill simpler" edit this comment
  --     anticipates — would keep the name and pass a name-only test. Suite 79
  --     (79:52-54) already settled on this standard.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.files'::regclass AND contype = 'c'
       AND conname = 'files_money_provider_chk'
       AND pg_get_constraintdef(oid) LIKE '%storage_provider%'
       AND pg_get_constraintdef(oid) LIKE '%rabbit_money_segment%'
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

  --     🚨 Review round 1: FOUR POLICIES CARRY **FIVE** MONEY CLAUSES, because
  --     files_update holds the arm in USING *and* WITH CHECK (0038:91-104 —
  --     "USING guards the OLD row, WITH CHECK the NEW one, and BOTH carry the
  --     financial clause"). The previous test concatenated qual and with_check
  --     before the LIKE, so it counted POLICIES, not clauses: a files_update
  --     that kept one arm and dropped the other still matched, under a message
  --     that says "lost its money arm". Counted separately now, as suite 79
  --     (79:268-279) already does. Measured on dev: qual 3, with_check 2.
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'files'
         AND qual LIKE '%can_access_project_money%') <> 3
     OR (SELECT count(*) FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'files'
            AND with_check LIKE '%can_access_project_money%') <> 2 THEN
    RAISE EXCEPTION '0076 post-condition failed: a files policy lost a money arm (expected 3 USING + 2 WITH CHECK across the four policies)';
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
  --     🚨 Review round 1 replaced the instrument. This read
  --     information_schema.column_privileges, which structurally CANNOT
  --     express DELETE, TRUNCATE or TRIGGER — measured on dev, that view holds
  --     only INSERT/REFERENCES/SELECT/UPDATE across the whole public schema,
  --     while role_table_grants on files holds all seven. So
  --     `GRANT TRUNCATE ON public.files TO anon` — which BYPASSES RLS
  --     outright — passed 3g, 3h and 3i together, under a comment claiming
  --     anon holds "nothing". The house already litigated this twice
  --     (77:73-78, "naming four had let a TRUNCATE grant ... pass as
  --     nothing"; 79:281-311 rewrote its probe 16 off this same view); 0076
  --     inherited the old idiom from 0075:222-229, which was never brought
  --     forward. has_table_privilege sees all seven.
  IF EXISTS (
    SELECT 1
      FROM unnest(ARRAY['files', 'file_events'])                                      AS t(tbl)
     CROSS JOIN unnest(ARRAY['anon', 'public'])                                       AS g(grantee)
     CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE',
                             'TRUNCATE','REFERENCES','TRIGGER'])                      AS p(priv)
     WHERE has_table_privilege(g.grantee, format('public.%I', t.tbl), p.priv)
  ) THEN
    RAISE EXCEPTION '0076 post-condition failed: anon or PUBLIC holds a table privilege on files or file_events';
  END IF;

  RAISE NOTICE '0076 OK: receipts are money — rows and their history flagged, four money policies intact, both column definitions unmoved.';
END $$;
