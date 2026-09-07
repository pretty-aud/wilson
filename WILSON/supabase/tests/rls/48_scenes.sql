-- =========================================================================
-- 48_scenes.sql — Session 25, migration 0040.
--
-- The behavioural suite for the four entity tables. Suites 49-51 pin the
-- structure of shots, levels and experiences; the access rules are proved
-- here once, against scenes, because all four share one gate
-- (can_write_project) and one policy shape.
--
-- What it PINS:
--  1. The table exists with RLS enabled AND forced, four policies, no FOR ALL
--     arm (probes 1-4).
--  2. workspace_id is stamped by trigger, because no client sends it (5-6).
--  3. THE ACCESS RULES. These are NOT money: a project MEMBER can create and
--     edit a scene, unlike budget_lines. A reviewer cannot write but CAN
--     read. An admin of a different workspace sees nothing (7-13).
--  4. The three projects columns the tabs gate on exist and default FALSE, so
--     applying 0040 does not switch three tabs on across every existing
--     project at once (14-16).
--  5. project_code exists and `code` does NOT — the column the plan documents
--     asked for would have been written by nothing (17-18).
--  6. anon reaches nothing (19).
-- =========================================================================
BEGIN;

SELECT plan(19);

SELECT * FROM tests.rls_setup();

-- ── Extra fixtures ───────────────────────────────────────────────────────
-- rls_setup gives two workspace ADMINS. What matters here is the ORDINARY
-- roles, because scenes are ordinary project content: a member must be able
-- to create one, and a reviewer must be able to read but not write.
--
--   user_c  app_role 'user', project_a reviewer -> read yes, write no
--   user_d  app_role 'user', project_a member   -> read yes, write YES

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now()),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user_d@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111',
   'dddddddd-dddd-dddd-dddd-dddddddddddd', 'user', 'user_d', 'User D', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.project_members
  (project_id, user_id, workspace_id, project_role)
VALUES
  ('aaaa1111-0000-0000-0000-000000000001',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1111-0000-0000-0000-000000000001',
   'dddddddd-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;


-- ── 1-4: the standing structural block ───────────────────────────────────

SELECT has_table('public'::name, 'scenes'::name, 'scenes table exists');

SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.scenes'::regclass),
  'scenes has RLS enabled and forced');

-- A broad FOR ALL arm ORs with every narrow arm beside it and silently wins.
-- 0029 exists specifically to undo one; this stops another appearing.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'scenes' AND cmd = 'ALL'),
  0, 'scenes has no FOR ALL policy');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'scenes'),
  4, 'scenes has exactly four policies (select/insert/update/delete)');


-- ── 5-6: workspace stamping ──────────────────────────────────────────────
-- RabbitProvider.jsx:1309-1314 sends only id, project_id and sort_order.

SELECT has_trigger('public', 'scenes',
  'trg_scenes_populate_workspace',
  'scenes stamps workspace_id on insert');

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

INSERT INTO public.scenes (id, project_id, name, scene_number)
VALUES ('55550000-0000-0000-0000-0000000000c1',
        'aaaa1111-0000-0000-0000-000000000001', 'WLSN_SC001', 1);

SELECT is(
  (SELECT workspace_id FROM public.scenes
    WHERE id = '55550000-0000-0000-0000-0000000000c1'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'workspace_id is stamped from the project, with no client involvement');


-- ── 7-8: a project MEMBER can read AND write ─────────────────────────────
--
-- This is the assertion that distinguishes these tables from the money ones.
-- Scenes deliberately use can_write_project, NOT can_access_project_money —
-- using the money gate here would have locked the whole feature to managers
-- and nobody would have noticed until a team member tried to add a scene.

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.scenes
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  1, 'a project member reads scenes');

SELECT lives_ok(
  $$INSERT INTO public.scenes (project_id, name, scene_number)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'WLSN_SC002', 2)$$,
  'a project member can create a scene — scenes are not money');


-- ── 9-11: a project REVIEWER reads but cannot write ──────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.scenes
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  2, 'a project reviewer can READ scenes');

SELECT throws_ok(
  $$INSERT INTO public.scenes (project_id, name, scene_number)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'sneaky', 99)$$,
  'new row violates row-level security policy for table "scenes"',
  'a project reviewer cannot create a scene');

-- The silent-zero-rows hazard: an RLS-refused UPDATE raises nothing and
-- affects no rows, so a client checking only for an error concludes the write
-- landed. Prove the row is untouched rather than trusting the missing error.
UPDATE public.scenes SET name = 'hijacked'
 WHERE id = '55550000-0000-0000-0000-0000000000c1';

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT name FROM public.scenes
    WHERE id = '55550000-0000-0000-0000-0000000000c1'),
  'WLSN_SC001',
  'a reviewer''s UPDATE raises no error and changes nothing (the silent-zero-rows hazard)');


-- ── 12-13: an admin of ANOTHER workspace is denied, read and write ───────

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '22222222-2222-2222-2222-222222222222',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.scenes),
  0, 'an admin of a different workspace cannot read this project''s scenes');

SELECT throws_ok(
  $$INSERT INTO public.scenes (project_id, name, scene_number)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'cross-tenant', 1)$$,
  'new row violates row-level security policy for table "scenes"',
  'an admin of a different workspace cannot create a scene here');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;


-- ── 14-16: the three toggle columns exist and default FALSE ──────────────
--
-- Rabbit.jsx:85-87 hides the Scenes, Levels and Experiences TABS on these,
-- and BudgetView.jsx:54-57 hides four budget sub-tabs on them. The DEFAULT is
-- the load-bearing part: false reproduces today's behaviour exactly, so
-- applying 0040 changes nothing on screen. A DEFAULT true would have switched
-- three tabs on for every existing project in all three environments at once.

SELECT is(
  (SELECT column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects'
      AND column_name = 'scenes_enabled'),
  'false',
  'projects.scenes_enabled defaults FALSE — 0040 reveals no tab by itself');

SELECT is(
  (SELECT column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects'
      AND column_name = 'levels_enabled'),
  'false',
  'projects.levels_enabled defaults FALSE');

SELECT is(
  (SELECT column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects'
      AND column_name = 'experiences_enabled'),
  'false',
  'projects.experiences_enabled defaults FALSE');


-- ── 17-18: project_code exists, and `code` deliberately does not ─────────
--
-- MASTER_PLAN_S19_ONWARD.md:512 and SESSION_25_prompt.md both said to add
-- `code`, citing ClientViewTab.jsx:129. Nothing in the app has ever WRITTEN a
-- bare `code` key on a project — the writer is ProjectSummaryView.jsx:605,
-- `update('project_code', v)`. Adding `code` would have created a column
-- nothing writes and left the client topsheet printing "--" forever.
--
-- Probe 18 is the one that earns its place: it fails if someone later "fixes"
-- the documented gap by adding the column the plan asked for.

SELECT has_column('public'::name, 'projects'::name, 'project_code'::name,
  'projects.project_code exists — the column the app actually writes');

SELECT is(
  (SELECT count(*)::int FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects'
      AND column_name = 'code'),
  0,
  'projects.code does NOT exist — it was a wrong READ in ClientViewTab, never a missing column');


-- ── 19: the migration-0011 privilege trap, for scenes ────────────────────
-- 0011's blanket GRANT plus its ALTER DEFAULT PRIVILEGES left anon holding
-- every privilege on 25 tables until 0033. Assert the revoke rather than
-- assume it — a policy-only check passes while a privilege hole is wide open.
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.scenes', 'SELECT') OR
    has_table_privilege('anon', 'public.scenes', 'INSERT') OR
    has_table_privilege('anon', 'public.scenes', 'UPDATE') OR
    has_table_privilege('anon', 'public.scenes', 'DELETE')
  ),
  'anon holds no table privilege on scenes'
);

SELECT * FROM finish();
ROLLBACK;
