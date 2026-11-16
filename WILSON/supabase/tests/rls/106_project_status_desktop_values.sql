-- =============================================================================
-- 106_project_status_desktop_values.sql — migration 0103 (M2, night 4,
-- 2026-10-28): the desktop's Draft, Wrapped and Inactive in the cloud's
-- public.project_status, Audrey's ruling of 2026-10-28 ("Add the three to the
-- cloud (Recommended)").
--
-- No table is new: projects keeps its own suite (01_projects.sql) in the CI
-- coverage guard, and this file is not in RLS_TABLES.
--
-- What this pins:
--   * The type: its eight labels in 0103's order, and the column's default
--     still active.
--   * Writing, through projects_update (can_write_project, 0013): a project
--     MEMBER saves each of the eight values, read back as saved; a REVIEWER's
--     save changes nothing; another workspace's admin changes nothing; the
--     workspace's admin makes a project Draft (the intake wizard's status).
--   * A value the type lacks is refused with its full sentence (22P02).
--
-- 🚨 Runs AFTER 0103 commits: a label added by ALTER TYPE … ADD VALUE cannot
-- be used in the transaction that adds it (55P04), so this suite cannot share a
-- rolled-back transaction with 0103 (tap-hosted.py's migration-then-suite
-- form). CI applies every migration first, then the suites.
--
-- Postgres-side reads are ALWAYS scoped to fixture ids — dev carries real
-- projects (S33, 439f702).
-- =============================================================================

BEGIN;

SELECT plan(16);

SELECT * FROM tests.rls_setup();

-- ── Extra fixtures ─────────────────────────────────────────────────────────
--   user_c  app_role 'user', project_a REVIEWER -> reads, no writes
--   user_d  app_role 'user', project_a MEMBER   -> writes
-- Seating them STAFFS project_a, so its writes need a seat (0013).
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


-- ═════════════════════════════════════════════════════════════════════════
-- The type
-- ═════════════════════════════════════════════════════════════════════════

-- 1
SELECT is(
  (SELECT string_agg(enumlabel::text, ',' ORDER BY enumsortorder) FROM pg_enum
    WHERE enumtypid = 'public.project_status'::regtype),
  'draft,active,on_hold,inactive,wrapped,completed,archived,cancelled',
  'project_status holds the desktop''s three in the lifecycle''s order (0103)');
-- 2
SELECT is(
  (SELECT column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'status'),
  '''active''::project_status',
  'projects.status still defaults to active (0103 changes no default)');


-- ═════════════════════════════════════════════════════════════════════════
-- A project MEMBER saves each of the eight
-- ═════════════════════════════════════════════════════════════════════════

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 3
WITH u AS (UPDATE public.projects SET status = 'draft' WHERE id = 'aaaa1111-0000-0000-0000-000000000001' RETURNING status::text AS s)
SELECT is((SELECT s FROM u), 'draft', 'a project member saves Draft (the settings'' first status)');
-- 4
WITH u AS (UPDATE public.projects SET status = 'active' WHERE id = 'aaaa1111-0000-0000-0000-000000000001' RETURNING status::text AS s)
SELECT is((SELECT s FROM u), 'active', 'a project member saves Active');
-- 5
WITH u AS (UPDATE public.projects SET status = 'on_hold' WHERE id = 'aaaa1111-0000-0000-0000-000000000001' RETURNING status::text AS s)
SELECT is((SELECT s FROM u), 'on_hold', 'a project member saves On hold');
-- 6
WITH u AS (UPDATE public.projects SET status = 'inactive' WHERE id = 'aaaa1111-0000-0000-0000-000000000001' RETURNING status::text AS s)
SELECT is((SELECT s FROM u), 'inactive', 'a project member saves Inactive (the Projects page''s second status)');
-- 7
WITH u AS (UPDATE public.projects SET status = 'wrapped' WHERE id = 'aaaa1111-0000-0000-0000-000000000001' RETURNING status::text AS s)
SELECT is((SELECT s FROM u), 'wrapped', 'a project member saves Wrapped');
-- 8
WITH u AS (UPDATE public.projects SET status = 'completed' WHERE id = 'aaaa1111-0000-0000-0000-000000000001' RETURNING status::text AS s)
SELECT is((SELECT s FROM u), 'completed', 'a project member saves Completed');
-- 9
WITH u AS (UPDATE public.projects SET status = 'archived' WHERE id = 'aaaa1111-0000-0000-0000-000000000001' RETURNING status::text AS s)
SELECT is((SELECT s FROM u), 'archived', 'a project member saves Archived');
-- 10
WITH u AS (UPDATE public.projects SET status = 'cancelled' WHERE id = 'aaaa1111-0000-0000-0000-000000000001' RETURNING status::text AS s)
SELECT is((SELECT s FROM u), 'cancelled', 'a project member saves Cancelled');
-- 11
SELECT throws_ok(
  $$UPDATE public.projects SET status = 'paused' WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  '22P02', 'invalid input value for enum project_status: "paused"',
  'a status the type lacks is refused, with its full sentence');


-- ═════════════════════════════════════════════════════════════════════════
-- Seats that cannot write
-- ═════════════════════════════════════════════════════════════════════════

-- A REVIEWER on the project.
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 12
WITH u AS (UPDATE public.projects SET status = 'wrapped' WHERE id = 'aaaa1111-0000-0000-0000-000000000001' RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 0,
  'a reviewer''s save of Wrapped changes nothing (projects_update: can_write_project)');

-- Another workspace's ADMIN.
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '22222222-2222-2222-2222-222222222222', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- 13
WITH u AS (UPDATE public.projects SET status = 'draft' WHERE id = 'aaaa1111-0000-0000-0000-000000000001' RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 0,
  'another workspace''s admin cannot set a status on workspace A''s project');

-- Read as the owner: the two refused saves left the member's last value.
RESET ROLE;

-- 14
SELECT is(
  (SELECT status::text FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000001'),
  'cancelled', 'neither refused save changed the status: it is the member''s last, Cancelled');


-- ═════════════════════════════════════════════════════════════════════════
-- A new project, Draft and by default
-- ═════════════════════════════════════════════════════════════════════════

-- The workspace's ADMIN.
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- 15
SELECT lives_ok(
  $$INSERT INTO public.projects (id, workspace_id, title, status)
    VALUES ('10600000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Draft project', 'draft')$$,
  'the workspace''s admin makes a project Draft, as the intake wizard does');

RESET ROLE;

-- 16
SELECT is(
  (SELECT string_agg(status::text, ',' ORDER BY title) FROM public.projects
    WHERE id IN ('10600000-0000-0000-0000-000000000001', 'bbbb2222-0000-0000-0000-000000000001')),
  'draft,active', 'the Draft project reads back Draft; a project made with no status is active');

SELECT * FROM finish();
ROLLBACK;
