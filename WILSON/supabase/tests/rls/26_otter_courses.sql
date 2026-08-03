-- =============================================================================
-- 26_otter_courses.sql — Session 10: O.T.T.E.R. courses (migration 0022).
--
-- Pins the three visibility tiers, the deliberate ABSENCE of an admin content
-- bypass on personal courses, the metadata-only admin index, editor grants,
-- identity pinning, the trash round-trip and forking.
--
-- Every assertion here was first verified live against wilson-dev (Postgres 17)
-- before being written down.
-- =============================================================================

BEGIN;

SELECT plan(34);

SELECT * FROM tests.rls_setup();

-- ── fixtures (runner: RLS bypassed) ─────────────────────────────────────────
-- user_c: plain member, owns the personal + shared courses
-- user_d: plain member, the "someone else" / later a granted editor
-- user_g: INACTIVE member — must be locked out of reads as well as writes
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

INSERT INTO public.otter_courses (id, workspace_id, owner_id, slug, name, visibility)
VALUES
  ('0c000001-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc','private-topic','Private Topic','personal'),
  ('0c000001-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc','shared-topic','Shared Topic','shared'),
  ('0c000001-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','blender-basics','Blender Basics','company_standard');

INSERT INTO public.otter_subjects (id, workspace_id, course_id, owner_id, slug, title, subject_order)
VALUES
  ('05000001-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
   '0c000001-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','intro','Intro',1);

-- ── structure ───────────────────────────────────────────────────────────────
SELECT has_table('public', 'otter_courses', 'otter_courses table exists');

SELECT ok(
  (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.otter_courses'::regclass),
  'otter_courses has FORCE ROW LEVEL SECURITY');

SELECT has_function('public', 'otter_course_index', 'otter_course_index() exists');

-- ── owner (plain member) ────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

SELECT is((SELECT count(*)::int FROM public.otter_courses
            WHERE id='0c000001-0000-0000-0000-000000000001'),
          1, 'owner reads their own personal course');

SELECT is((SELECT count(*)::int FROM public.otter_courses),
          3, 'owner sees own personal + shared + company standard');

-- ── another plain member ────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd',
                      '11111111-1111-1111-1111-111111111111');

SELECT is((SELECT count(*)::int FROM public.otter_courses
            WHERE id='0c000001-0000-0000-0000-000000000001'),
          0, 'another member cannot read a personal course');

SELECT is((SELECT count(*)::int FROM public.otter_courses),
          2, 'another member sees only shared + company standard');

WITH upd AS (
  UPDATE public.otter_courses SET name='hijacked'
   WHERE id='0c000001-0000-0000-0000-000000000002' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0,
          'a member without an edit grant cannot update a shared course');

SELECT is((SELECT count(*)::int FROM public.otter_course_index()),
          2, 'a plain member''s index shows no colleague personal courses');

-- ── ADMIN: sees existence, never content (claims built by hand — ────────────
--    tests.login_as sets no app_role) ────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT is((SELECT count(*)::int FROM public.otter_courses
            WHERE id='0c000001-0000-0000-0000-000000000001'),
          0, 'a workspace ADMIN cannot read personal course content (no bypass)');

SELECT is((SELECT count(*)::int FROM public.otter_course_index()),
          3, 'a workspace admin sees that every course exists');

SELECT is((SELECT can_read_content FROM public.otter_course_index()
            WHERE id='0c000001-0000-0000-0000-000000000001'),
          false, 'the index flags a personal course as content-unreadable');

-- The index must never grow a content column — that is the whole contract.
-- Checked against the function's declared RETURNS TABLE signature (it is a
-- function, so it has no information_schema.columns entry to inspect).
SELECT ok(
  (SELECT pg_get_function_result(p.oid)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='otter_course_index')
  !~ '(sections|hotkeys|functions|nodes|corrections|section_outlines)',
  'otter_course_index returns no content columns');

-- ── editor grants ───────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

INSERT INTO public.otter_course_editors (workspace_id, course_id, user_id, granted_by)
VALUES ('11111111-1111-1111-1111-111111111111','0c000001-0000-0000-0000-000000000002',
        'dddddddd-dddd-dddd-dddd-dddddddddddd','cccccccc-cccc-cccc-cccc-cccccccccccc');

SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd',
                      '11111111-1111-1111-1111-111111111111');

WITH upd AS (
  UPDATE public.otter_courses SET name='edited by grantee'
   WHERE id='0c000001-0000-0000-0000-000000000002' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1,
          'a granted editor can update the shared course');

-- Ownership transfer is not a feature: the pin trigger restores owner_id.
UPDATE public.otter_courses SET owner_id='dddddddd-dddd-dddd-dddd-dddddddddddd'
 WHERE id='0c000001-0000-0000-0000-000000000002';

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is((SELECT owner_id FROM public.otter_courses
            WHERE id='0c000001-0000-0000-0000-000000000002'),
          'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
          'a granted editor cannot steal ownership (identity pin)');

-- ── REGRESSION (adversarial review, S10): an admin must not be able to ──────
--    launder themselves past the no-bypass rule by self-issuing an editor
--    grant on somebody's PERSONAL course. otter_course_index() hands admins
--    every course id, so the grant insert is the only thing standing between
--    them and the lesson bodies.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT throws_ok(
  $$INSERT INTO public.otter_course_editors (workspace_id, course_id, user_id)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '0c000001-0000-0000-0000-000000000001',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'new row violates row-level security policy for table "otter_course_editors"',
  'an admin cannot self-grant edit access on a personal course');

SELECT is((SELECT count(*)::int FROM public.otter_courses
            WHERE id='0c000001-0000-0000-0000-000000000001'),
          0, 'personal content stays closed to admins after the grant attempt');

-- ── REGRESSION: write access is not permission to DISCLOSE ──────────────────
--    A granted editor must not be able to publish the owner's personal course.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

INSERT INTO public.otter_course_editors (workspace_id, course_id, user_id, granted_by)
VALUES ('11111111-1111-1111-1111-111111111111','0c000001-0000-0000-0000-000000000001',
        'dddddddd-dddd-dddd-dddd-dddddddddddd','cccccccc-cccc-cccc-cccc-cccccccccccc');

SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd',
                      '11111111-1111-1111-1111-111111111111');

UPDATE public.otter_courses SET visibility='shared'
 WHERE id='0c000001-0000-0000-0000-000000000001';

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is((SELECT visibility FROM public.otter_courses
            WHERE id='0c000001-0000-0000-0000-000000000001'),
          'personal',
          'a granted editor cannot publish the owner''s personal course');

-- ── REGRESSION: trashing a course is not an editor's to do ──────────────────
--    A trashed course vanishes from its owner's view AND from the index, so
--    they cannot find it to restore, and the 30-day purge destroys it.
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd',
                      '11111111-1111-1111-1111-111111111111');

SELECT throws_ok(
  $$SELECT public.otter_soft_delete_row('otter_courses','0c000001-0000-0000-0000-000000000001')$$,
  'not allowed to trash or restore this otter row',
  'a granted editor cannot trash the owner''s course');

-- The grant was only needed for the two probes above; drop it so the rest of
-- the file sees the original fixture state.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

DELETE FROM public.otter_course_editors
 WHERE course_id='0c000001-0000-0000-0000-000000000001';

-- ── tier promotion is admin-only ────────────────────────────────────────────
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

SELECT throws_ok(
  $$INSERT INTO public.otter_courses (workspace_id, owner_id, slug, name, visibility)
    VALUES ('11111111-1111-1111-1111-111111111111',
            'cccccccc-cccc-cccc-cccc-cccccccccccc',
            'sneaky-standard','Sneaky','company_standard')$$,
  'new row violates row-level security policy for table "otter_courses"',
  'a non-admin cannot publish a company-standard course');

-- ── trashing is RPC-only ────────────────────────────────────────────────────
SELECT throws_ok(
  $$UPDATE public.otter_courses SET deleted_at = now()
     WHERE id='0c000001-0000-0000-0000-000000000002'$$,
  'new row violates row-level security policy for table "otter_courses"',
  'a plain UPDATE cannot set deleted_at — trashing goes through the RPC');

SELECT is(public.otter_soft_delete_row('otter_courses','0c000001-0000-0000-0000-000000000002'),
          true, 'otter_soft_delete_row trashes the owner''s course');

SELECT is((SELECT count(*)::int FROM public.otter_courses
            WHERE id='0c000001-0000-0000-0000-000000000002'),
          0, 'a trashed course is hidden from its owner');

-- Regression guard: routing this through otter_can_write_course() (which
-- filters deleted_at IS NULL) made the trash a one-way door.
SELECT is(public.otter_restore_row('otter_courses','0c000001-0000-0000-0000-000000000002'),
          true, 'otter_restore_row brings a trashed course back');

SELECT is((SELECT count(*)::int FROM public.otter_courses
            WHERE id='0c000001-0000-0000-0000-000000000002'),
          1, 'a restored course is visible again');

-- ── forking a company-standard course ───────────────────────────────────────
SELECT ok(public.otter_fork_course('0c000001-0000-0000-0000-000000000003') IS NOT NULL,
          'otter_fork_course returns the new course id');

SELECT is(
  (SELECT visibility || '/' || (source_course_id='0c000001-0000-0000-0000-000000000003')::text
     FROM public.otter_courses
    WHERE owner_id='cccccccc-cccc-cccc-cccc-cccccccccccc' AND slug='blender-basics'),
  'personal/true',
  'a fork is born personal and records its source course');

SELECT is(
  (SELECT count(*)::int FROM public.otter_subjects s
     JOIN public.otter_courses c ON c.id = s.course_id
    WHERE c.owner_id='cccccccc-cccc-cccc-cccc-cccccccccccc' AND c.slug='blender-basics'),
  1, 'forking copies the source course''s subjects');

-- ── deactivated member: reads AND writes are both closed (0020 baseline) ────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7',
                      '11111111-1111-1111-1111-111111111111');

SELECT is((SELECT count(*)::int FROM public.otter_courses),
          0, 'a deactivated member reads no courses at all');

SELECT throws_ok(
  $$INSERT INTO public.otter_courses (workspace_id, owner_id, slug, name)
    VALUES ('11111111-1111-1111-1111-111111111111',
            'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7','ghost','Ghost')$$,
  'new row violates row-level security policy for table "otter_courses"',
  'a deactivated member cannot create a course');

-- ── cross-workspace isolation (locked #17: never a cross-company wiki) ──────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                      '22222222-2222-2222-2222-222222222222');

SELECT is((SELECT count(*)::int FROM public.otter_courses),
          0, 'another workspace sees none of these courses');

-- ── retention ───────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT has_function('public', 'purge_otter_trash', ARRAY['interval'],
  'purge_otter_trash(interval) exists');

UPDATE public.otter_courses
   SET deleted_at = now() - INTERVAL '45 days'
 WHERE id='0c000001-0000-0000-0000-000000000001';

SELECT ok(public.purge_otter_trash() >= 1,
          'purge_otter_trash sweeps rows trashed more than 30 days ago');


-- ── 0033: the migration-0011 privilege trap, for otter_courses ──
-- 0011's blanket GRANT plus its ALTER DEFAULT PRIVILEGES left anon holding
-- every table privilege on otter_courses; 0033 revoked it. Assert the revoke rather
-- than assume it — a policy-only check passes while a privilege hole is wide
-- open, which is exactly how 26 tables stayed open until S21 tripped over one.
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.otter_courses', 'SELECT') OR
    has_table_privilege('anon', 'public.otter_courses', 'INSERT') OR
    has_table_privilege('anon', 'public.otter_courses', 'UPDATE') OR
    has_table_privilege('anon', 'public.otter_courses', 'DELETE')
  ),
  'anon holds no table privilege on otter_courses'
);

SELECT * FROM finish();
ROLLBACK;
