-- =============================================================================
-- 0099_asset_level_links.sql — VW1e (post-overhaul, custom table views, the
-- build part 4, 2026-10-25): the cloud keeps the levels and experiences an
-- asset is in, as it keeps its scenes and shots since 0084.
--
-- Audrey (docs/design/CUSTOM_VIEWS_QUESTIONS.md, every answer verbatim):
--   Q-M3 "Tasks, Assets, Levels, Exp." — combination groups and Create
--       grouping on four tables: Assets grouped by the scenes, shots, levels
--       and experiences an asset is in; Levels and Experiences grouped by the
--       assets that name them.
--   A9  the same on the cloud or a NAS — the desktop and the dev fixtures
--       already keep an asset's level_ids and experience_ids; the cloud
--       adapter has left them out since 0084 ("level_ids / experience_ids
--       stay OUT"), so on the cloud a level's Assets count read 0 and the
--       Levels table could not be grouped by asset (design §4.7, §4.11).
--
-- Measured on wilson-dev before this file (2026-10-25, by query):
-- public.assets carries scene_ids and shot_ids (uuid[] NOT NULL DEFAULT
-- '{}'), no level_ids and no experience_ids; its four policies (select,
-- insert, update, delete) and FORCE ROW LEVEL SECURITY; authenticated holds
-- SELECT, INSERT, UPDATE and DELETE on the whole table, so a new column is
-- under the same grants and the same policies, with nothing to restate.
--
-- WHAT THIS ADDS
--   §1 public.assets.level_ids and public.assets.experience_ids, uuid[] NOT
--      NULL DEFAULT '{}' — 0084 §6c's shape for scene_ids and shot_ids, the
--      client's existing local shape (the asset window's Levels and
--      Experiences pickers send whole arrays). 🚨 THE SAME INTEGRITY
--      TRADE-OFF: an array element cannot be a foreign key, so deleting a
--      level leaves its id in every asset that named it. The client resolves
--      ids against the loaded levels and experiences and ignores unknown
--      ones, so an orphan is invisible, not wrong. No trigger (an array
--      rewrite on every level delete would touch every asset of the
--      project). The orphan sweep, safe at any hour (idempotent, one
--      statement per array), is 0084's with the table and column changed:
--        UPDATE public.assets a SET level_ids = ARRAY(
--          SELECT x FROM unnest(a.level_ids) x
--           WHERE EXISTS (SELECT 1 FROM public.levels l WHERE l.id = x AND l.project_id = a.project_id))
--         WHERE EXISTS (SELECT 1 FROM unnest(a.level_ids) x
--           WHERE NOT EXISTS (SELECT 1 FROM public.levels l WHERE l.id = x AND l.project_id = a.project_id));
--        (and the same for experience_ids against public.experiences)
--      NOT NULL DEFAULT '{}' is a metadata-only change on PG11+ (no rewrite).
--   §2 post-conditions, scanned from the catalogue.
--   §3 comments.
--
-- NOT HERE, ON PURPOSE
--   * No policy, grant or broadcast change: the assets policies and the
--     table-wide grants already cover a new column, and fn_realtime_broadcast
--     sends the whole row on assets' own project_id arm (0098 §10), so a
--     teammate's change of an asset's levels reaches an open table as its
--     scenes do.
--   * Nothing backfilled: no cloud asset has ever carried these links. The
--     move to the cloud (src/cloud/migrate/runMigration.js) carries no levels
--     or experiences, so it sends an asset WITHOUT them (assetRowForCloud),
--     never ids that would name rows the cloud does not have.
--   * The groupings of levels and experiences by asset are 0098's
--     (item_groupings' pair check already allows levels and experiences by
--     asset); this file adds only what rows join them by.
--
-- ORDERING: needs 0084 (assets.scene_ids, the shape this follows) and 0098
--   (the views and groupings this serves). Refuses to run otherwise.
-- Number: 0099 / suite 102 (supabase/tests/rls/102_asset_level_links.sql),
--   DG1's reservation, unused by DG1 and VW1d, confirmed for VW1e by the
--   controller (2026-10-25). No table is new, so the coverage guard's
--   RLS_TABLES does not change: assets keeps 03_assets.sql.
-- Idempotent: ADD COLUMN IF NOT EXISTS and COMMENT. A re-run, before or after
--   a later migration, changes nothing (neither statement can take back
--   another file's change), so no re-run guard is needed.
-- =============================================================================


-- =============================================================================
-- 0. PRE-FLIGHT
-- =============================================================================
DO $$
BEGIN
  IF to_regclass('public.assets') IS NULL
     OR to_regclass('public.levels') IS NULL OR to_regclass('public.experiences') IS NULL THEN
    RAISE EXCEPTION '0099 pre-flight failed: assets / levels / experiences missing — apply 0040 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'assets' AND column_name = 'scene_ids') THEN
    RAISE EXCEPTION '0099 pre-flight failed: assets.scene_ids is missing — apply 0084 first';
  END IF;
  IF to_regclass('public.table_views') IS NULL OR to_regclass('public.item_groupings') IS NULL THEN
    RAISE EXCEPTION '0099 pre-flight failed: table_views / item_groupings missing — apply 0098 first';
  END IF;
END $$;


-- =============================================================================
-- 1. assets.level_ids / experience_ids
-- =============================================================================

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS level_ids      UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS experience_ids UUID[] NOT NULL DEFAULT '{}';


-- =============================================================================
-- 2. POST-CONDITIONS — scan the catalogue, do not assume (S22)
-- =============================================================================
DO $$
DECLARE
  c TEXT;
  v_type TEXT;
  v_null TEXT;
  v_default TEXT;
  v_n INT;
BEGIN
  FOREACH c IN ARRAY ARRAY['level_ids', 'experience_ids'] LOOP
    SELECT data_type || ':' || udt_name, is_nullable, column_default
      INTO v_type, v_null, v_default
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'assets' AND column_name = c;
    IF v_type IS NULL THEN
      RAISE EXCEPTION '0099 post-condition failed: assets.% is missing', c;
    END IF;
    IF v_type <> 'ARRAY:_uuid' THEN
      RAISE EXCEPTION '0099 post-condition failed: assets.% is %, expected uuid[]', c, v_type;
    END IF;
    IF v_null <> 'NO' THEN
      RAISE EXCEPTION '0099 post-condition failed: assets.% must be NOT NULL (default {})', c;
    END IF;
    IF v_default IS DISTINCT FROM '''{}''::uuid[]' THEN
      RAISE EXCEPTION '0099 post-condition failed: assets.% defaults to %, expected ''{}''::uuid[]', c, v_default;
    END IF;
    IF NOT has_column_privilege('authenticated', 'public.assets', c, 'SELECT')
       OR NOT has_column_privilege('authenticated', 'public.assets', c, 'INSERT')
       OR NOT has_column_privilege('authenticated', 'public.assets', c, 'UPDATE') THEN
      RAISE EXCEPTION '0099 post-condition failed: authenticated cannot read and write assets.% (the table-wide grants it relies on are gone)', c;
    END IF;
    IF has_column_privilege('anon', 'public.assets', c, 'SELECT') THEN
      RAISE EXCEPTION '0099 post-condition failed: anon can read assets.%', c;
    END IF;
  END LOOP;
  -- The policies the columns sit under, unchanged (four, forced).
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'assets';
  IF v_n <> 4 THEN
    RAISE EXCEPTION '0099 post-condition failed: public.assets has % policies, expected 4', v_n;
  END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.assets'::regclass) THEN
    RAISE EXCEPTION '0099 post-condition failed: public.assets lacks ENABLE+FORCE row level security';
  END IF;
END $$;


-- =============================================================================
-- 3. COMMENTS
-- =============================================================================
COMMENT ON COLUMN public.assets.level_ids IS
  '0099 (VW1e): levels this asset is in. An array, so NOT an FK: a deleted level''s id may linger (the client ignores unknown ids); 0099''s header carries a safe orphan sweep.';
COMMENT ON COLUMN public.assets.experience_ids IS
  '0099 (VW1e): experiences this asset is in. Array, not an FK — see level_ids.';
