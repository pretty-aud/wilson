-- =============================================================================
-- 28_otter_progress.sql — Session 10: per-user study state (migration 0022).
--
-- The single most important property here: progress is keyed to (course, user).
-- On disk it lived in the course directory because O.T.T.E.R. was single-user,
-- so two people studying one shared course would have overwritten each other.
-- These probes pin the per-user isolation, the absence of an admin bypass, and
-- the requirement that you can only track progress on a course you can read.
-- =============================================================================

BEGIN;

SELECT plan(13);

SELECT * FROM tests.rls_setup();

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
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- a company-standard course (readable by all) and user_c's personal course
INSERT INTO public.otter_courses (id, workspace_id, owner_id, slug, name, visibility)
VALUES
  ('0c000003-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','shared-standard','Shared Standard','company_standard'),
  ('0c000003-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc','c-private','C Private','personal');

-- ── structure ───────────────────────────────────────────────────────────────
SELECT has_table('public', 'otter_progress', 'otter_progress table exists');

SELECT ok(
  (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.otter_progress'::regclass),
  'otter_progress has FORCE ROW LEVEL SECURITY');

-- The whole point of the re-key: one row per (course, user), not per course.
SELECT ok(
  EXISTS (SELECT 1 FROM pg_indexes
           WHERE schemaname='public' AND indexname='otter_progress_course_user_uidx'),
  'progress is unique per (course, user), not per course');

-- ── user_c studies the shared standard course ───────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

SELECT lives_ok(
  $$INSERT INTO public.otter_progress (workspace_id, course_id, user_id, completed_lessons)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '0c000003-0000-0000-0000-000000000001',
            'cccccccc-cccc-cccc-cccc-cccccccccccc',
            '{"intro": ["lesson_1_1"]}'::jsonb)$$,
  'a member can record progress on a course they can read');

SELECT throws_ok(
  $$INSERT INTO public.otter_progress (workspace_id, course_id, user_id)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '0c000003-0000-0000-0000-000000000001',
            'dddddddd-dddd-dddd-dddd-dddddddddddd')$$,
  'new row violates row-level security policy for table "otter_progress"',
  'a member cannot record progress on behalf of someone else');

-- ── user_d studies the SAME course — the two records must not collide ───────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd',
                      '11111111-1111-1111-1111-111111111111');

SELECT lives_ok(
  $$INSERT INTO public.otter_progress (workspace_id, course_id, user_id, completed_lessons)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '0c000003-0000-0000-0000-000000000001',
            'dddddddd-dddd-dddd-dddd-dddddddddddd',
            '{"intro": ["lesson_1_2"]}'::jsonb)$$,
  'a second member can study the same shared course independently');

SELECT is((SELECT count(*)::int FROM public.otter_progress),
          1, 'each member sees only their own progress row');

SELECT is((SELECT completed_lessons->>'intro' FROM public.otter_progress),
          '["lesson_1_2"]',
          'one member''s progress does not overwrite the other''s');

SELECT throws_ok(
  $$INSERT INTO public.otter_progress (workspace_id, course_id, user_id)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '0c000003-0000-0000-0000-000000000002',
            'dddddddd-dddd-dddd-dddd-dddddddddddd')$$,
  'new row violates row-level security policy for table "otter_progress"',
  'progress cannot be started on a course the member cannot read');

-- Re-pointing your row at someone else is refused; the pin trigger also
-- restores course_id so a row cannot be walked onto another course.
UPDATE public.otter_progress SET course_id='0c000003-0000-0000-0000-000000000002';

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is((SELECT count(*)::int FROM public.otter_progress
            WHERE course_id='0c000003-0000-0000-0000-000000000001'),
          2, 'progress rows stay pinned to their original course');

-- ── admins get no bypass on study data ──────────────────────────────────────
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT is((SELECT count(*)::int FROM public.otter_progress),
          0, 'a workspace ADMIN cannot read another member''s study record');

-- ── cascade + isolation ─────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

DELETE FROM public.otter_courses WHERE id='0c000003-0000-0000-0000-000000000001';

SELECT is((SELECT count(*)::int FROM public.otter_progress),
          0, 'hard-deleting a course cascades away its progress rows');

SELECT tests.login_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                      '22222222-2222-2222-2222-222222222222');

SELECT is((SELECT count(*)::int FROM public.otter_progress),
          0, 'another workspace sees no progress rows');

SELECT * FROM finish();
ROLLBACK;
