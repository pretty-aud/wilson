-- =========================================================================
-- 50_levels.sql — Session 25, migration 0040.
--
-- Structure for levels. The access rules are proved once in 48_scenes.sql;
-- all four entity tables carry the identical policy shape and gate
-- (can_write_project — these are ordinary project content, not money).
--
-- CI's coverage guard globs supabase/tests/rls/*_<table>.sql, so each table
-- needs its own file even where the assertions are structural. One combined
-- suite cannot satisfy it (the S20 lesson, rls.yml:49-84), and the hardcoded
-- failure-replay list at rls.yml:116 needs extending too — S17's own comment
-- records suites 33-38 failing INVISIBLY for exactly that reason.
-- =========================================================================
BEGIN;

SELECT plan(9);

SELECT * FROM tests.rls_setup();


-- ── 1-4: the standing structural block ───────────────────────────────────

SELECT has_table('public'::name, 'levels'::name, 'levels table exists');

SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.levels'::regclass),
  'levels has RLS enabled and forced');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'levels' AND cmd = 'ALL'),
  0, 'levels has no FOR ALL policy');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'levels'),
  4, 'levels has exactly four policies (select/insert/update/delete)');


-- ── 5: workspace stamping ────────────────────────────────────────────────

SELECT has_trigger('public', 'levels',
  'trg_levels_populate_workspace',
  'levels stamps workspace_id on insert');


-- ── 6-7: a level survives a create with only what the dialog sends ───────
--
-- CreateLevelPopup (LevelsView.jsx:1009) sends { name, status, description,
-- files } and the provider adds { id, project_id, sort_order }. `files` has
-- no column and is dropped by the adapter's allowlist — but every OTHER key
-- must land, so the create is exercised here with exactly that payload minus
-- files. If a column is ever renamed out from under the dialog this fails.

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.levels (id, project_id, sort_order, name, status, description)
    VALUES ('77770000-0000-0000-0000-0000000000f1',
            'aaaa1111-0000-0000-0000-000000000001', 0,
            'Level 1', 'not_started', '')$$,
  'the create dialog''s exact payload inserts');

SELECT is(
  (SELECT workspace_id FROM public.levels
    WHERE id = '77770000-0000-0000-0000-0000000000f1'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'workspace_id is stamped from the project, with no client involvement');


-- ── 8: the status vocabulary matches the UI's nine ───────────────────────
-- LevelsView.jsx:33 and ScenesView.jsx:40-43 are the same nine strings. A
-- CHECK that falls behind the dropdown turns a new option into a write that
-- fails, so this pins that they agree.

SELECT throws_ok(
  $$INSERT INTO public.levels (project_id, name, status)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'bad', 'wat')$$,
  'new row for relation "levels" violates check constraint "levels_status_chk"',
  'an unknown status is refused');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;


-- ── 9: the migration-0011 privilege trap, for levels ─────────────────────
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.levels', 'SELECT') OR
    has_table_privilege('anon', 'public.levels', 'INSERT') OR
    has_table_privilege('anon', 'public.levels', 'UPDATE') OR
    has_table_privilege('anon', 'public.levels', 'DELETE')
  ),
  'anon holds no table privilege on levels'
);

SELECT * FROM finish();
ROLLBACK;
