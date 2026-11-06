-- =========================================================================
-- 45_budget_versions.sql — Session 24, migration 0037.
--
-- Named bid snapshots, and the FINAL state.
--
-- What it PINS:
--  1. Structure: exists, RLS enabled AND forced, four policies, no FOR ALL,
--     workspace stamped (probes 1-5).
--  2. `snapshot` is JSONB and defaults to an object, so a version always has
--     somewhere to record the percentages AS APPLIED. That is what stops a
--     later edit to a project default rewriting a closed project's history
--     (probes 6-7).
--  3. type is constrained to bid | actual | final — the three states are a
--     vocabulary, not free text (probe 8).
--  4. projects.budget_active_version_id really points here, and clearing a
--     version does not delete the project (probe 9).
--  5. The money gate applies (probe 10), and anon reaches nothing (11).
--  6. 0084 (S3a, 2026-09-30): a version records the shot list it was built
--     against — shot_list_id, same-project composite FK, SET NULL when the
--     list goes — and gains a nullable summary (question F8) (12-16).
-- =========================================================================
BEGIN;

SELECT plan(16);

SELECT * FROM tests.rls_setup();

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local',
        crypt('testpw', gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        'authenticated', 'authenticated',
        '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES ('11111111-1111-1111-1111-111111111111',
        'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role)
VALUES ('aaaa1111-0000-0000-0000-000000000001',
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;


-- ── 1-5: structure ───────────────────────────────────────────────────────

SELECT has_table('public'::name, 'budget_versions'::name,
  'budget_versions table exists');

SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.budget_versions'::regclass),
  'budget_versions has RLS enabled and forced');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'budget_versions' AND cmd = 'ALL'),
  0, 'budget_versions has no FOR ALL policy');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'budget_versions'),
  4, 'budget_versions has exactly four policies');

SELECT has_trigger('public', 'budget_versions',
  'trg_budget_versions_populate_workspace',
  'budget_versions stamps workspace_id on insert');


-- ── as the workspace admin ───────────────────────────────────────────────

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

INSERT INTO public.budget_versions (id, project_id, name)
VALUES ('33330000-0000-0000-0000-00000000bb01',
        'aaaa1111-0000-0000-0000-000000000001', 'Bid v1');


-- ── 6-7: the snapshot ────────────────────────────────────────────────────

SELECT is(
  (SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'budget_versions'
      AND column_name = 'snapshot'),
  'jsonb',
  'budget_versions.snapshot is jsonb — it holds the tasks, rates and percentages as applied');

SELECT is(
  (SELECT snapshot FROM public.budget_versions
    WHERE id = '33330000-0000-0000-0000-00000000bb01'),
  '{}'::jsonb,
  'a new version starts with an empty snapshot object rather than NULL');


-- ── 8: the three states are a vocabulary ─────────────────────────────────

SELECT throws_ok(
  $$INSERT INTO public.budget_versions (project_id, name, type)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'Bad', 'provisional')$$,
  'new row for relation "budget_versions" violates check constraint "budget_versions_type_check"',
  'budget_versions.type is constrained to bid | actual | final');


-- ── 9: the project locks to a version ────────────────────────────────────

UPDATE public.projects
   SET budget_active = true,
       budget_active_version_id = '33330000-0000-0000-0000-00000000bb01',
       budget_finalized = true
 WHERE id = 'aaaa1111-0000-0000-0000-000000000001';

-- ON DELETE SET NULL: losing a version must not take the project with it.
DELETE FROM public.budget_versions WHERE id = '33330000-0000-0000-0000-00000000bb01';

SELECT is(
  (SELECT budget_active_version_id FROM public.projects
    WHERE id = 'aaaa1111-0000-0000-0000-000000000001'),
  NULL::uuid,
  'deleting the locked version clears the pointer and leaves the project standing');


-- ── 10: the money gate ───────────────────────────────────────────────────

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

SELECT throws_ok(
  $$INSERT INTO public.budget_versions (project_id, name)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'reviewer bid')$$,
  'new row violates row-level security policy for table "budget_versions"',
  'a project member cannot create a bid version');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;


-- ── 11: the migration-0011 privilege trap, for budget_versions ───────────
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.budget_versions', 'SELECT') OR
    has_table_privilege('anon', 'public.budget_versions', 'INSERT') OR
    has_table_privilege('anon', 'public.budget_versions', 'UPDATE') OR
    has_table_privilege('anon', 'public.budget_versions', 'DELETE')
  ),
  'anon holds no table privilege on budget_versions'
);


-- ── 12-16: 0084 — the version's shot list, and its summary ───────────────
-- As postgres (probe 10's block ended with RESET ROLE): these pin the columns
-- and the FK, not who may write them — both columns sit under the money gate
-- like the rest of the row (0037), which probe 10 already proves.

SELECT has_column('public', 'budget_versions', 'shot_list_id',
  'budget_versions.shot_list_id exists (0084 §6d)');

SELECT has_column('public', 'budget_versions', 'summary',
  'budget_versions.summary exists (0084 §6d, question F8)');

INSERT INTO public.shot_lists (id, project_id, title, version)
VALUES ('45450000-0000-0000-0000-0000000000a1', 'aaaa1111-0000-0000-0000-000000000001', 'A list', 1),
       ('45450000-0000-0000-0000-0000000000b1', 'bbbb2222-0000-0000-0000-000000000001', 'B list', 1);

SELECT throws_ok(
  $$INSERT INTO public.budget_versions (project_id, name, shot_list_id)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'Bid against B''s list',
            '45450000-0000-0000-0000-0000000000b1')$$,
  '23503', 'insert or update on table "budget_versions" violates foreign key constraint "budget_versions_shot_list_fk"',
  'a version cannot name ANOTHER project''s shot list — the (shot_list_id, project_id) FK (0084 §6d)');

-- CONTROL: its own project's list is accepted, so the refusal above is the
-- pairing and not the column.
SELECT lives_ok(
  $$INSERT INTO public.budget_versions (id, project_id, name, shot_list_id)
    VALUES ('33330000-0000-0000-0000-00000000bb03', 'aaaa1111-0000-0000-0000-000000000001',
            'Bid v3', '45450000-0000-0000-0000-0000000000a1')$$,
  'CONTROL: a version naming its own project''s list lives');

-- ON DELETE SET NULL (shot_list_id): losing the list must not take the bid
-- with it (probe 9's reasoning, for the new pointer).
DELETE FROM public.shot_lists WHERE id = '45450000-0000-0000-0000-0000000000a1';

SELECT ok(
  EXISTS (SELECT 1 FROM public.budget_versions
           WHERE id = '33330000-0000-0000-0000-00000000bb03' AND shot_list_id IS NULL),
  'deleting the list keeps the version and clears its shot_list_id');

SELECT * FROM finish();
ROLLBACK;
