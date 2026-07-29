-- =============================================================================
-- 29_otter_course_editors.sql — Session 10: per-user edit grants (0022).
--
-- "Owners can add others to have edit access" (Audrey, 2026-07-28). These
-- probes pin who may grant, who may see grants, that a grantee cannot recruit
-- further editors, and that a grant dies with the membership it was issued
-- against (the composite FK to workspace_members, 0013 project_members shape).
-- =============================================================================

BEGIN;

SELECT plan(16);

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
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user_e@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','user','user_c','User C',true),
  ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','user','user_d','User D',true),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','user','user_e','User E',true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.otter_courses (id, workspace_id, owner_id, slug, name, visibility)
VALUES
  ('0c000004-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc','team-course','Team Course','shared');

-- ── structure ───────────────────────────────────────────────────────────────
SELECT has_table('public', 'otter_course_editors', 'otter_course_editors table exists');

SELECT ok(
  (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.otter_course_editors'::regclass),
  'otter_course_editors has FORCE ROW LEVEL SECURITY');

-- ── the owner grants ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

SELECT lives_ok(
  $$INSERT INTO public.otter_course_editors (workspace_id, course_id, user_id, granted_by)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '0c000004-0000-0000-0000-000000000001',
            'dddddddd-dddd-dddd-dddd-dddddddddddd',
            'cccccccc-cccc-cccc-cccc-cccccccccccc')$$,
  'the course owner can grant edit access');

SELECT is((SELECT count(*)::int FROM public.otter_course_editors
            WHERE course_id='0c000004-0000-0000-0000-000000000001'),
          1, 'the owner sees the grants on their own course');

-- A grant has no mutable fields: there is deliberately no UPDATE policy.
WITH upd AS (
  UPDATE public.otter_course_editors
     SET granted_by='dddddddd-dddd-dddd-dddd-dddddddddddd' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0,
          'grants cannot be updated (no UPDATE policy — regrant instead)');

-- ── a granted editor cannot recruit further editors ─────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd',
                      '11111111-1111-1111-1111-111111111111');

SELECT is((SELECT count(*)::int FROM public.otter_course_editors),
          1, 'a grantee can see their own grant');

SELECT throws_ok(
  $$INSERT INTO public.otter_course_editors (workspace_id, course_id, user_id, granted_by)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '0c000004-0000-0000-0000-000000000001',
            'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
            'dddddddd-dddd-dddd-dddd-dddddddddddd')$$,
  'new row violates row-level security policy for table "otter_course_editors"',
  'a granted editor cannot grant edit access to anyone else');

-- ── an unrelated member sees nothing ────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
                      '11111111-1111-1111-1111-111111111111');

SELECT is((SELECT count(*)::int FROM public.otter_course_editors),
          0, 'an unrelated member sees no grants');

SELECT throws_ok(
  $$INSERT INTO public.otter_course_editors (workspace_id, course_id, user_id)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '0c000004-0000-0000-0000-000000000001',
            'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')$$,
  'new row violates row-level security policy for table "otter_course_editors"',
  'a member cannot grant themselves edit access');

-- ── an admin can grant on someone else's course ─────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT lives_ok(
  $$INSERT INTO public.otter_course_editors (workspace_id, course_id, user_id, granted_by)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '0c000004-0000-0000-0000-000000000001',
            'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'a workspace admin can grant edit access on any course');

SELECT is((SELECT count(*)::int FROM public.otter_course_editors),
          2, 'an admin sees all grants in the workspace');

-- ── a grantee can remove themselves ─────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
                      '11111111-1111-1111-1111-111111111111');

WITH del AS (
  DELETE FROM public.otter_course_editors
   WHERE user_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM del), 1,
          'a grantee can hand back their own edit access');

-- ── the grant dies with the membership (composite FK) ───────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

DELETE FROM public.workspace_members
 WHERE workspace_id='11111111-1111-1111-1111-111111111111'
   AND user_id='dddddddd-dddd-dddd-dddd-dddddddddddd';

SELECT is((SELECT count(*)::int FROM public.otter_course_editors),
          0, 'removing a membership cascades away that member''s edit grants');

-- ── cross-workspace isolation ───────────────────────────────────────────────
SELECT tests.login_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                      '22222222-2222-2222-2222-222222222222');

SELECT is((SELECT count(*)::int FROM public.otter_course_editors),
          0, 'another workspace sees no grants');

-- ── workspace_id has NO DEFAULT — the client MUST send it (Session 11) ──────
-- This table is the one exception to the pattern every other O.T.T.E.R. table
-- follows. otter_courses, otter_subjects, otter_progress and
-- otter_change_requests all declare
--   workspace_id UUID NOT NULL DEFAULT public.current_workspace_id()
-- so a client can simply omit the column and let the database stamp tenancy
-- from the JWT. Here the column exists for the composite FK to
-- workspace_members and 0022 never gave it a default, while
-- fn_otter_editor_grant_workspace is a VALIDATOR rather than a defaulter — it
-- compares NEW.workspace_id to the course's and raises when they differ, and a
-- NULL always differs.
--
-- Session 11's adapter shipped an insert that omitted the column, so EVERY
-- "give someone edit access" failed with a tenancy error that read like a
-- cross-tenant bug. Fourteen passing probes did not catch it because every
-- fixture in this file supplies workspace_id by hand — which is exactly why
-- these two probes assert the schema fact directly.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name='otter_course_editors'
      AND column_name='workspace_id'),
  NULL,
  'otter_course_editors.workspace_id has no default, so every client insert must supply it');

SELECT throws_ok(
  $$INSERT INTO public.otter_course_editors (course_id, user_id)
    VALUES ('0c000001-0000-0000-0000-000000000002',
            'dddddddd-dddd-dddd-dddd-dddddddddddd')$$,
  'editor grant workspace does not match the course workspace',
  'omitting workspace_id is refused by the grant-workspace trigger, not defaulted');

SELECT * FROM finish();
ROLLBACK;
