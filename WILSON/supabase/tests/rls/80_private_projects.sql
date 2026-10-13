-- =============================================================================
-- 80_private_projects.sql — Demo 2026-09-11: private projects (migration 0072).
--
-- What this pins:
--   * The column: projects.is_private, NOT NULL, default false — an existing
--     project is not private.
--   * The policy: projects_select reads is_private.
--   * Visibility: a manager's private project is visible to the manager and
--     to the workspace admin, and INVISIBLE to a plain member of the same
--     workspace — who still sees the workspace's ordinary projects.
--   * The child hop: a files row on the private project (storage_provider
--     'local_server', the desktop's own disk) is visible to the owner and
--     invisible to the member, with NO change to files_select.
--   * The member cannot update what they cannot see (0014: SELECT applies to
--     both sides of an UPDATE).
--
-- Postgres-side reads are ALWAYS scoped to the fixture rows — dev carries
-- real projects (S33, 439f702).
-- =============================================================================

BEGIN;

SELECT plan(15);

SELECT * FROM tests.rls_setup();

-- user_c: plain 'user'-role ACTIVE member of workspace A (suite 59's shape).
-- user_d: 'manager' of workspace A — may insert projects (projects_insert).
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
  ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','manager','user_d','User D',true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- ── structure ───────────────────────────────────────────────────────────────

SELECT has_column('public', 'projects', 'is_private', 'projects.is_private exists');
SELECT col_not_null('public', 'projects', 'is_private', 'projects.is_private is NOT NULL');
SELECT col_default_is('public', 'projects', 'is_private', 'false', 'projects.is_private defaults to false');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'projects'
             AND policyname = 'projects_select' AND position('is_private' IN qual) > 0),
  'projects_select reads is_private');

-- ── the manager makes a private project ─────────────────────────────────────
-- Claims in the JWT's own shape (suite 59): current_app_role() reads
-- app_metadata.app_role from the claims, not from workspace_members, and
-- tests.login_as does not set it — a manager without it is refused by
-- projects_insert. set_config rather than tests.login_as for every switch,
-- because once the role is `authenticated` the tests schema is off limits.
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','dddddddd-dddd-dddd-dddd-dddddddddddd','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','manager')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT lives_ok($$
  INSERT INTO public.projects (id, workspace_id, title, is_private)
  VALUES ('aaaa1111-0000-0000-0000-000000000072',
          '11111111-1111-1111-1111-111111111111', 'Private P', true)
$$, 'a manager can insert a private project');

SELECT is(
  (SELECT count(*) FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000072'),
  1::bigint, 'the owner sees their private project');

SELECT lives_ok($$
  INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial)
  VALUES ('aaaa1111-0000-0000-0000-0000000072f1',
          'aaaa1111-0000-0000-0000-000000000072', 'clip.mov', 'local_server',
          'projects/aaaa1111-0000-0000-0000-000000000072/assets/a1/10-clip.mov', false)
$$, 'the owner files a local_server media row on the private project');

SELECT is(
  (SELECT count(*) FROM public.files WHERE project_id = 'aaaa1111-0000-0000-0000-000000000072'),
  1::bigint, 'the owner sees the private project''s file row');

-- ── the plain member sees none of it, and everything else ───────────────────
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','cccccccc-cccc-cccc-cccc-cccccccccccc','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','user')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT is(
  (SELECT count(*) FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000072'),
  0::bigint, 'a plain member does not see the private project');

SELECT is(
  (SELECT count(*) FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000001'),
  1::bigint, 'the plain member still sees the workspace''s ordinary project');

SELECT is(
  (SELECT count(*) FROM public.files WHERE project_id = 'aaaa1111-0000-0000-0000-000000000072'),
  0::bigint, 'the private project''s file row is hidden by the live-parent hop, with no files_select change');

-- A data-modifying CTE may only sit at the top level of a statement, so the
-- update runs on its own (0 rows, no error) and the admin reads the title
-- back below.
UPDATE public.projects SET title = 'renamed by a member'
 WHERE id = 'aaaa1111-0000-0000-0000-000000000072';

-- ── the admin keeps the escape hatch ────────────────────────────────────────
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT is(
  (SELECT count(*) FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000072'),
  1::bigint, 'the workspace admin sees the private project');

SELECT is(
  (SELECT is_private FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000001'),
  false, 'an ordinary project is not private (the default)');

SELECT is(
  (SELECT created_by FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000072'),
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  'the owner is the inserting caller, stamped by fn_audit_touch — no client can name another');

SELECT is(
  (SELECT title FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000072'),
  'Private P', 'the plain member could not update what they cannot see (0014: SELECT applies to both sides of an UPDATE)');

SELECT * FROM finish();
ROLLBACK;
