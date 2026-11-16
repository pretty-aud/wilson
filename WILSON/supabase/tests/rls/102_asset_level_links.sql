-- =============================================================================
-- 102_asset_level_links.sql — migration 0099 (VW1e, 2026-10-25): an asset's
-- levels and experiences on the cloud, public.assets.level_ids and
-- experience_ids (uuid[] NOT NULL DEFAULT '{}', 0084 §6c's shape).
--
-- No table is new: assets keeps its own suite (03_assets.sql) in the CI
-- coverage guard, and this file is not in RLS_TABLES.
--
-- What this pins (each probe names the 0099 section it holds to):
--   * Structure (§1, §2): both columns, uuid[], NOT NULL, defaulting to the
--     empty array; under the table-wide grants (authenticated reads and
--     writes them, anon nothing); the assets policies unchanged (four,
--     forced).
--   * Writing (Q2's seats, through the assets policies the columns sit
--     under): a project member and an admin set an asset's levels and
--     experiences; a reviewer's update changes nothing; another workspace's
--     admin neither reads nor writes them. NULL is refused; an asset made
--     without them holds the empty array.
--   * The integrity trade-off, as 0084 made it for scene_ids: an id is not a
--     foreign key, so a deleted level's id stays in the array (the client
--     ignores it), and the delete itself is never refused by it.
--
-- Postgres-side reads are ALWAYS scoped to fixture ids — dev carries real
-- projects (S33, 439f702).
-- =============================================================================

BEGIN;

SELECT plan(23);

SELECT * FROM tests.rls_setup();

-- ── Extra fixtures ─────────────────────────────────────────────────────────
--   user_c  app_role 'user', project_a REVIEWER -> reads, no writes
--   user_d  app_role 'user', project_a MEMBER   -> writes
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user_d@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','user','user_c','User C',true),
  ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','user','user_d','User D',true)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET app_role = EXCLUDED.app_role, is_active = EXCLUDED.is_active;

INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role)
VALUES
  ('aaaa1111-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1111-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;

-- project_a's asset a1 and a2, its levels e1 and e2, its experience f1.
INSERT INTO public.assets (id, project_id, name) VALUES
  ('10200000-0000-0000-0000-0000000000a1', 'aaaa1111-0000-0000-0000-000000000001', 'A1'),
  ('10200000-0000-0000-0000-0000000000a2', 'aaaa1111-0000-0000-0000-000000000001', 'A2');
INSERT INTO public.levels (id, project_id, name) VALUES
  ('10200000-0000-0000-0000-0000000000e1', 'aaaa1111-0000-0000-0000-000000000001', 'L1'),
  ('10200000-0000-0000-0000-0000000000e2', 'aaaa1111-0000-0000-0000-000000000001', 'L2');
INSERT INTO public.experiences (id, project_id, name) VALUES
  ('10200000-0000-0000-0000-0000000000f1', 'aaaa1111-0000-0000-0000-000000000001', 'X1');


-- ═════════════════════════════════════════════════════════════════════════
-- Structure (§1, §2)
-- ═════════════════════════════════════════════════════════════════════════

-- 1
SELECT has_column('public', 'assets', 'level_ids', 'assets.level_ids exists (0099 §1)');
-- 2
SELECT has_column('public', 'assets', 'experience_ids', 'assets.experience_ids exists (0099 §1)');
-- 3
SELECT col_type_is('public', 'assets', 'level_ids', 'uuid[]', 'assets.level_ids is uuid[], as scene_ids is');
-- 4
SELECT col_type_is('public', 'assets', 'experience_ids', 'uuid[]', 'assets.experience_ids is uuid[]');
-- 5
SELECT col_not_null('public', 'assets', 'level_ids', 'assets.level_ids is NOT NULL');
-- 6
SELECT col_not_null('public', 'assets', 'experience_ids', 'assets.experience_ids is NOT NULL');
-- 7
SELECT is(
  (SELECT level_ids::text || ' ' || experience_ids::text FROM public.assets
    WHERE id = '10200000-0000-0000-0000-0000000000a1'),
  '{} {}', 'an asset made without them holds the empty arrays (DEFAULT ''{}'')');
-- 8
SELECT ok(
  has_column_privilege('authenticated', 'public.assets', 'level_ids', 'UPDATE')
  AND has_column_privilege('authenticated', 'public.assets', 'experience_ids', 'INSERT')
  AND NOT has_column_privilege('anon', 'public.assets', 'level_ids', 'SELECT'),
  'authenticated reads and writes the new columns under the table-wide grants; anon holds nothing');
-- 9
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'assets'),
  4, 'the assets policies the columns sit under are unchanged: four');
-- 10
SELECT throws_ok(
  $$UPDATE public.assets SET level_ids = NULL WHERE id = '10200000-0000-0000-0000-0000000000a1'$$,
  '23502', NULL, 'a NULL level list is refused (NOT NULL)');


-- ═════════════════════════════════════════════════════════════════════════
-- Writing, through the assets policies
-- ═════════════════════════════════════════════════════════════════════════

-- A project MEMBER sets an asset's levels and experiences.
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 11
WITH u AS (
  UPDATE public.assets
     SET level_ids = ARRAY['10200000-0000-0000-0000-0000000000e1', '10200000-0000-0000-0000-0000000000e2']::uuid[],
         experience_ids = ARRAY['10200000-0000-0000-0000-0000000000f1']::uuid[]
   WHERE id = '10200000-0000-0000-0000-0000000000a1'
   RETURNING 1)
SELECT is((SELECT count(*)::int FROM u),
  1, 'a project member sets an asset''s levels and experiences');
-- 12
SELECT is(
  (SELECT cardinality(level_ids) || '/' || cardinality(experience_ids) FROM public.assets
    WHERE id = '10200000-0000-0000-0000-0000000000a1'),
  '2/1', 'the member reads back the two levels and the one experience');
-- 13
SELECT lives_ok(
  $$INSERT INTO public.assets (id, project_id, name, level_ids)
    VALUES ('10200000-0000-0000-0000-0000000000a3', 'aaaa1111-0000-0000-0000-000000000001', 'A3',
            ARRAY['10200000-0000-0000-0000-0000000000e2']::uuid[])$$,
  'a project member makes an asset already in a level');

-- A REVIEWER reads them and changes nothing.
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 14
SELECT is(
  (SELECT cardinality(level_ids)::int FROM public.assets WHERE id = '10200000-0000-0000-0000-0000000000a1'),
  2, 'a reviewer reads an asset''s levels');
-- 15
WITH u AS (
  UPDATE public.assets SET level_ids = '{}'
   WHERE id = '10200000-0000-0000-0000-0000000000a1'
   RETURNING 1)
SELECT is((SELECT count(*)::int FROM u),
  0,'a reviewer''s update of an asset''s levels changes nothing (assets_update: can_write_project)');

-- Another workspace's ADMIN neither reads nor writes them.
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '22222222-2222-2222-2222-222222222222', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- 16
SELECT is(
  (SELECT count(*)::int FROM public.assets WHERE id::text LIKE '10200000-%'),
  0, 'another workspace''s admin reads no asset of workspace A, its levels with it');
-- 17
WITH u AS (
  UPDATE public.assets SET experience_ids = '{}'
   WHERE id = '10200000-0000-0000-0000-0000000000a1'
   RETURNING 1)
SELECT is((SELECT count(*)::int FROM u),
  0,'another workspace''s admin cannot change an asset''s experiences');

-- The workspace's ADMIN (no seat; the app role writes) does.
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- 18
WITH u AS (
  UPDATE public.assets SET level_ids = ARRAY['10200000-0000-0000-0000-0000000000e1']::uuid[]
   WHERE id = '10200000-0000-0000-0000-0000000000a2'
   RETURNING 1)
SELECT is((SELECT count(*)::int FROM u),
  1,'the workspace''s admin sets an asset''s levels');


-- ═════════════════════════════════════════════════════════════════════════
-- The integrity trade-off (0084 §6c's, for levels)
-- ═════════════════════════════════════════════════════════════════════════

-- 19
SELECT lives_ok(
  $$DELETE FROM public.levels WHERE id = '10200000-0000-0000-0000-0000000000e2'$$,
  'deleting a level that assets name is never refused by their arrays (no foreign key)');

-- Read as the owner from here: the probes below are about the data.
RESET ROLE;

-- 20 (code review round 1, R1-2): the delete TOOK the row, so 21 and 22
-- are about a real delete, not one the levels policy filtered to nothing.
SELECT is(
  (SELECT count(*)::int FROM public.levels WHERE id = '10200000-0000-0000-0000-0000000000e2'),
  0, 'the level is gone: the admin''s delete took its row');
-- 21
SELECT is(
  (SELECT '10200000-0000-0000-0000-0000000000e2'::uuid = ANY (level_ids) FROM public.assets
    WHERE id = '10200000-0000-0000-0000-0000000000a1'),
  true, 'the deleted level''s id stays in the asset''s array (the client ignores unknown ids)');
-- 22
SELECT is(
  (SELECT cardinality(level_ids)::int FROM public.assets WHERE id = '10200000-0000-0000-0000-0000000000a3'),
  1, 'an asset whose only level was deleted keeps the id too: 0099''s sweep is a statement to run, not a trigger');

-- 23
SELECT is(
  (SELECT count(*)::int FROM public.assets
    WHERE id::text LIKE '10200000-%' AND (level_ids IS NULL OR experience_ids IS NULL)),
  0, 'no fixture asset ever holds a NULL list');

SELECT * FROM finish();
ROLLBACK;
