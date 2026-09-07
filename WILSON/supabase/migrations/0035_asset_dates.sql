-- =============================================================================
-- 0035_asset_dates.sql  (Session 23)
--
-- assets.start_date / assets.due_date — two columns the client has been
-- writing, reading, sorting and inline-editing since before the cloud adapter
-- existed, and which were never added to the cloud schema.
--
-- This is 0034's sibling: same defect class (client/schema drift), different
-- table. Kept as its own migration because 0034 is about whether a task needs
-- an asset, and this is about what an asset stores — squashing them would make
-- both harder to read and to revert.
--
-- -----------------------------------------------------------------------------
-- THE DEFECT, MEASURED (2026-08-03)
-- -----------------------------------------------------------------------------
--
-- ProjectAssetsView.jsx:1371-1372 sends `start_date` and `due_date` on every
-- New Asset create. Neither is a column of public.assets, so PostgREST rejects
-- the whole request with PGRST204 before any SQL runs.
--
-- Two things make this total rather than occasional:
--
--   * The keys are sent even when the fields are BLANK. `draft.start_date ||
--     null` still emits the key, and PostgREST's schema-cache check is on the
--     KEY, not the value. So there is no input that makes the dialog succeed —
--     which rules out "she filled it in wrong".
--   * handleConfirm (:1360) has try/finally with NO catch, and addAsset does
--     not wrap the write optimistically. So the rejection is swallowed
--     entirely: the button flashes "Creating…", returns to "Confirm & Create",
--     the dialog stays open with the data still in it, and nothing appears.
--     Audrey's exact words were "nothing populated".
--
-- -----------------------------------------------------------------------------
-- WHY COLUMNS, AND NOT JUST DROPPING THE TWO KEYS
-- -----------------------------------------------------------------------------
--
-- Dropping them from the payload would fix the PGRST204 in one line, and it
-- would be wrong: these are not stray fields, they are a feature. The same two
-- values are a table column (:811-812), a sort field (:100-101), an inline
-- editor (:1059, :1069) and a Timeline asset-edit field
-- (TimelineView.jsx:3732-3733). Silently discarding what the user typed into
-- four different surfaces trades a loud failure for quiet data loss, which is
-- strictly worse — the failure at least told her something was wrong.
--
-- `task_template_id`, the third phantom key on that payload, is NOT added
-- here and belongs in the adapter's column allowlist instead. Task templates
-- do not exist in cloud at all: `listProjectTaskTemplates` has zero
-- occurrences in supabaseAdapter.js (it is localServerAdapter-only), so
-- useTaskTemplates returns [] and the dropdown is permanently empty. A column
-- for a feature with no cloud implementation would be schema debt.
--
-- Nullable, no default, no backfill: an asset with no dates is the normal
-- case, and every existing row is correct as NULL. Metadata-only, no rewrite,
-- safe on populated staging/prod.
--
-- Idempotent: safe to re-run.
-- =============================================================================

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS due_date   DATE;


-- ── post-conditions ──────────────────────────────────────────────────────────
-- ADD COLUMN creates no new object, so it cannot trip 0011's ALTER DEFAULT
-- PRIVILEGES trap — but S21 proved that reasoning correctly about that trap is
-- not the same as checking, so check. S22's sweep must still hold on assets.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='assets'
                    AND column_name='start_date' AND data_type='date') THEN
    RAISE EXCEPTION '0035 post-condition failed: assets.start_date missing or wrong type';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='assets'
                    AND column_name='due_date' AND data_type='date') THEN
    RAISE EXCEPTION '0035 post-condition failed: assets.due_date missing or wrong type';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
              WHERE table_schema='public' AND table_name='assets' AND grantee='anon') THEN
    RAISE EXCEPTION '0035 post-condition failed: anon regained privileges on assets';
  END IF;

  IF NOT (has_table_privilege('authenticated','public.assets','SELECT')
      AND has_table_privilege('authenticated','public.assets','INSERT')
      AND has_table_privilege('authenticated','public.assets','UPDATE')) THEN
    RAISE EXCEPTION '0035 post-condition failed: authenticated lost DML on assets';
  END IF;
END $$;

COMMENT ON COLUMN public.assets.start_date IS
  'Session 23: planned start for the deliverable. Written by the New Asset dialog (ProjectAssetsView.jsx:1371), the inline editor (:1059) and the Timeline asset editor; sorted on at :100. Sent by the client since before the cloud adapter existed — its absence made every cloud asset creation fail with PGRST204, silently.';

COMMENT ON COLUMN public.assets.due_date IS
  'Session 23: planned delivery date. See start_date — same history, same fix.';
