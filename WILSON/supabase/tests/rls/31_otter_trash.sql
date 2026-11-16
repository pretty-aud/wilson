-- =============================================================================
-- 31_otter_trash.sql — Session 11: otter_trash_index() (migration 0024).
--
-- Pins the read side of the O.T.T.E.R. trash that 0022 left unreachable, and in
-- particular the two things that make it safe:
--
--   * it lists EXACTLY what fn_otter_trash_authz would let the caller restore —
--     no more (a dead control) and no less (an unrecoverable course);
--   * it is metadata-only, so an admin who may restore someone's personal
--     course still may not read a word of it.
--
-- Every assertion here was verified live against wilson-dev (Postgres 17)
-- before being written down.
-- =============================================================================

BEGIN;

SELECT plan(21);

SELECT * FROM tests.rls_setup();

-- ── fixtures (runner: RLS bypassed) ─────────────────────────────────────────
-- user_a  : workspace admin (from rls_setup)
-- user_c  : plain member, owns every course below
-- user_d  : plain member — no relationship at first, later a granted EDITOR
-- user_g  : INACTIVE member
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
  ('a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7', 'user_g@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','user','user_c','User C',true),
  ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','user','user_d','User D',true),
  ('11111111-1111-1111-1111-111111111111','a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7','user','user_g','User G',false)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- T1 personal + TRASHED (deleted by the admin, to exercise deleted_by_label)
-- T2 shared   + LIVE     (parent of the trashed subject S1)
-- T3 shared   + TRASHED
INSERT INTO public.otter_courses
  (id, workspace_id, owner_id, slug, name, visibility, deleted_at, deleted_by)
VALUES
  ('0c000031-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc','trashed-personal','Trashed Personal','personal',
   TIMESTAMPTZ '2026-07-01 00:00:00+00','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('0c000031-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc','live-shared','Live Shared','shared', NULL, NULL),
  ('0c000031-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc','trashed-shared','Trashed Shared','shared',
   TIMESTAMPTZ '2026-07-02 00:00:00+00','cccccccc-cccc-cccc-cccc-cccccccccccc');

-- S1 TRASHED under the LIVE course   -> listed
-- S2 TRASHED under the TRASHED course -> NOT listed (restore would be a no-op)
-- S3 LIVE    under the LIVE course    -> NOT listed
-- S4 LIVE    under the TRASHED course -> not listed, but counted in subject_count
INSERT INTO public.otter_subjects
  (id, workspace_id, course_id, owner_id, slug, title, subject_order, deleted_at, deleted_by)
VALUES
  ('05000031-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   '0c000031-0000-0000-0000-000000000002','cccccccc-cccc-cccc-cccc-cccccccccccc',
   'trashed-sub','Trashed Sub',1,
   TIMESTAMPTZ '2026-07-03 00:00:00+00','cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('05000031-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
   '0c000031-0000-0000-0000-000000000001','cccccccc-cccc-cccc-cccc-cccccccccccc',
   'orphan-sub','Orphan Sub',1,
   TIMESTAMPTZ '2026-07-03 00:00:00+00','cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('05000031-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111',
   '0c000031-0000-0000-0000-000000000002','cccccccc-cccc-cccc-cccc-cccccccccccc',
   'live-sub','Live Sub',2, NULL, NULL),
  ('05000031-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111',
   '0c000031-0000-0000-0000-000000000001','cccccccc-cccc-cccc-cccc-cccccccccccc',
   'survivor-sub','Survivor Sub',1, NULL, NULL);

-- ── structure ───────────────────────────────────────────────────────────────
SELECT has_function('public', 'otter_trash_index', 'otter_trash_index() exists');

-- ── OWNER ───────────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

SELECT is((SELECT count(*)::int FROM public.otter_trash_index()),
          3, 'owner sees exactly their two trashed courses and one trashed subject');

SELECT is((SELECT count(*)::int FROM public.otter_trash_index() WHERE kind='course'),
          2, 'both trashed courses are listed, personal included');

SELECT is((SELECT count(*)::int FROM public.otter_trash_index() WHERE kind='subject'),
          1, 'only the trashed subject under a LIVE course is listed');

-- The narrowing vs fn_otter_trash_authz: restoring this one would be authorized
-- but immediately re-hidden by otter_subjects_select's live-parent EXISTS.
SELECT is((SELECT count(*)::int FROM public.otter_trash_index()
            WHERE id='05000031-0000-0000-0000-000000000002'),
          0, 'a subject under a TRASHED course is not offered for restore');

SELECT is((SELECT purges_at FROM public.otter_trash_index()
            WHERE id='0c000031-0000-0000-0000-000000000003'),
          TIMESTAMPTZ '2026-08-01 00:00:00+00',
          'purges_at is deleted_at + the 30-day retention window');

-- Survivor Sub is live and comes back with the course; Orphan Sub is separately
-- trashed and must not be promised.
SELECT is((SELECT subject_count FROM public.otter_trash_index()
            WHERE id='0c000031-0000-0000-0000-000000000001'),
          1, 'subject_count counts only the subjects that return with the course');

SELECT is((SELECT deleted_by_label FROM public.otter_trash_index()
            WHERE id='0c000031-0000-0000-0000-000000000001'),
          'User A', 'deleted_by resolves to a roster label');

SELECT is((SELECT bool_and(is_own) FROM public.otter_trash_index()),
          true, 'is_own is set for the owner''s own rows');

-- ── another plain member, BEFORE any grant ──────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd',
                      '11111111-1111-1111-1111-111111111111');

SELECT is((SELECT count(*)::int FROM public.otter_trash_index()),
          0, 'an unrelated member sees nothing in the trash');

-- ── the same member, now a GRANTED EDITOR on the live shared course ─────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

INSERT INTO public.otter_course_editors (workspace_id, course_id, user_id, granted_by)
VALUES ('11111111-1111-1111-1111-111111111111',
        '0c000031-0000-0000-0000-000000000002',
        'dddddddd-dddd-dddd-dddd-dddddddddddd',
        'cccccccc-cccc-cccc-cccc-cccccccccccc');

SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd',
                      '11111111-1111-1111-1111-111111111111');

SELECT is((SELECT count(*)::int FROM public.otter_trash_index() WHERE kind='subject'),
          1, 'a granted editor sees trashed subjects of that course');

-- 0022 gives editors no rights over trashing a COURSE, so listing one to them
-- would render a Restore button that always fails.
SELECT is((SELECT count(*)::int FROM public.otter_trash_index() WHERE kind='course'),
          0, 'a granted editor is not offered course restores');

-- ── ADMIN (claims by hand — tests.login_as sets no app_role) ────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT is((SELECT count(*)::int FROM public.otter_trash_index() WHERE kind='course'),
          2, 'an admin sees every trashed course, including a personal one');

-- The point of the whole design: restore rights are not read rights.
SELECT is((SELECT count(*)::int FROM public.otter_courses
            WHERE id='0c000031-0000-0000-0000-000000000001'),
          0, 'an admin listing a trashed personal course still cannot read it');

-- The contract, checked against the declared signature (a function has no
-- information_schema.columns entry). Mirrors the guard on otter_course_index.
SELECT ok(
  (SELECT pg_get_function_result(p.oid)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='otter_trash_index')
  !~ '(sections|section_outlines|hotkeys|functions|nodes|corrections|reference_urls|completed_lessons)',
  'otter_trash_index returns no content columns');

-- ── deactivated member ──────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7',
                      '11111111-1111-1111-1111-111111111111');

SELECT throws_ok(
  'SELECT * FROM public.otter_trash_index()',
  'not_a_workspace_member',
  'a deactivated member cannot enumerate the trash');

-- ── cross-workspace isolation ───────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                      '22222222-2222-2222-2222-222222222222');

SELECT is((SELECT count(*)::int FROM public.otter_trash_index()),
          0, 'another workspace sees none of this trash');

-- ── the round trip this migration exists to enable ──────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

SELECT ok(public.otter_restore_row('otter_courses', '0c000031-0000-0000-0000-000000000003'),
          'a listed course can be restored with the id the index handed back');

SELECT is((SELECT count(*)::int FROM public.otter_course_index()
            WHERE id='0c000031-0000-0000-0000-000000000003'),
          1, 'the restored course is back in the live index');

SELECT ok(public.otter_restore_row('otter_subjects', '05000031-0000-0000-0000-000000000001'),
          'a listed subject can be restored the same way');

-- ── anon ────────────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT ok(
  NOT has_function_privilege('anon', 'public.otter_trash_index()', 'EXECUTE'),
  'anon cannot execute otter_trash_index');

SELECT * FROM finish();
ROLLBACK;
