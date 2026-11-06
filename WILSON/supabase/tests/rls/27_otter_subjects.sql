-- =============================================================================
-- 27_otter_subjects.sql — Session 10: O.T.T.E.R. subjects (migration 0022).
--
-- Subjects carry no visibility of their own: they INHERIT it from the parent
-- course through a live-parent EXISTS (the 0014 pattern). These probes pin
-- that inheritance in both directions, the write gate, identity pinning, and
-- the fact that subject_order is now genuinely persisted rather than
-- recomputed on every read (as renumberSubjects() did on disk).
-- =============================================================================

BEGIN;

SELECT plan(19);

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

-- personal course + shared course, both owned by user_c
INSERT INTO public.otter_courses (id, workspace_id, owner_id, slug, name, visibility)
VALUES
  ('0c000002-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc','private-course','Private Course','personal'),
  ('0c000002-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc','shared-course','Shared Course','shared');

INSERT INTO public.otter_subjects
  (id, workspace_id, course_id, owner_id, slug, title, subject_order)
VALUES
  ('05000002-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   '0c000002-0000-0000-0000-000000000001','cccccccc-cccc-cccc-cccc-cccccccccccc',
   'secret-lesson','Secret Lesson', 7),
  ('05000002-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
   '0c000002-0000-0000-0000-000000000002','cccccccc-cccc-cccc-cccc-cccccccccccc',
   'open-lesson','Open Lesson', 3);

-- ── structure ───────────────────────────────────────────────────────────────
SELECT has_table('public', 'otter_subjects', 'otter_subjects table exists');

SELECT ok(
  (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.otter_subjects'::regclass),
  'otter_subjects has FORCE ROW LEVEL SECURITY');

-- subject_order is a real persisted column, not a derived one: on disk it was
-- rewritten on every list read by a regex curriculum heuristic.
SELECT is((SELECT subject_order FROM public.otter_subjects
            WHERE id='05000002-0000-0000-0000-000000000001'),
          7, 'subject_order persists exactly as written');

-- ── owner ───────────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

SELECT is((SELECT count(*)::int FROM public.otter_subjects),
          2, 'the owner reads subjects of both their courses');

-- ── another plain member: inheritance in action ─────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd',
                      '11111111-1111-1111-1111-111111111111');

SELECT is((SELECT count(*)::int FROM public.otter_subjects
            WHERE id='05000002-0000-0000-0000-000000000001'),
          0, 'a personal course''s subjects are hidden from other members');

SELECT is((SELECT count(*)::int FROM public.otter_subjects
            WHERE id='05000002-0000-0000-0000-000000000002'),
          1, 'a shared course''s subjects are readable by other members');

SELECT throws_ok(
  $$INSERT INTO public.otter_subjects
      (workspace_id, course_id, owner_id, slug, title)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '0c000002-0000-0000-0000-000000000002',
            'dddddddd-dddd-dddd-dddd-dddddddddddd','sneak','Sneak')$$,
  'new row violates row-level security policy for table "otter_subjects"',
  'a member without an edit grant cannot add subjects to a shared course');

-- ── granted editor ──────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

INSERT INTO public.otter_course_editors (workspace_id, course_id, user_id, granted_by)
VALUES ('11111111-1111-1111-1111-111111111111','0c000002-0000-0000-0000-000000000002',
        'dddddddd-dddd-dddd-dddd-dddddddddddd','cccccccc-cccc-cccc-cccc-cccccccccccc');

SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd',
                      '11111111-1111-1111-1111-111111111111');

SELECT lives_ok(
  $$INSERT INTO public.otter_subjects
      (workspace_id, course_id, owner_id, slug, title, subject_order)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '0c000002-0000-0000-0000-000000000002',
            'dddddddd-dddd-dddd-dddd-dddddddddddd','added-lesson','Added Lesson', 4)$$,
  'a granted editor can add subjects to the shared course');

WITH upd AS (
  UPDATE public.otter_subjects SET title='retitled'
   WHERE id='05000002-0000-0000-0000-000000000002' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1,
          'a granted editor can update an existing subject');

-- Smuggling a subject out of a shared course into somewhere else must fail:
-- the pin trigger restores course_id.
UPDATE public.otter_subjects SET course_id='0c000002-0000-0000-0000-000000000001'
 WHERE id='05000002-0000-0000-0000-000000000002';

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is((SELECT course_id FROM public.otter_subjects
            WHERE id='05000002-0000-0000-0000-000000000002'),
          '0c000002-0000-0000-0000-000000000002'::uuid,
          'a subject cannot be moved between courses (identity pin)');

-- ── trashing ────────────────────────────────────────────────────────────────
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

SELECT throws_ok(
  $$UPDATE public.otter_subjects SET deleted_at = now()
     WHERE id='05000002-0000-0000-0000-000000000002'$$,
  'new row violates row-level security policy for table "otter_subjects"',
  'a plain UPDATE cannot trash a subject');

SELECT is(public.otter_soft_delete_row('otter_subjects','05000002-0000-0000-0000-000000000002'),
          true, 'otter_soft_delete_row trashes a subject');

SELECT is((SELECT count(*)::int FROM public.otter_subjects
            WHERE id='05000002-0000-0000-0000-000000000002'),
          0, 'a trashed subject is hidden');

SELECT is(public.otter_restore_row('otter_subjects','05000002-0000-0000-0000-000000000002'),
          true, 'otter_restore_row brings a trashed subject back');

-- Trashing the PARENT hides the whole subtree with no propagation writes.
SELECT ok(public.otter_soft_delete_row('otter_courses','0c000002-0000-0000-0000-000000000002'),
          'the parent course can be trashed');

SELECT is((SELECT count(*)::int FROM public.otter_subjects
            WHERE course_id='0c000002-0000-0000-0000-000000000002'),
          0, 'trashing a course transitively hides its subjects');

SELECT ok(public.otter_restore_row('otter_courses','0c000002-0000-0000-0000-000000000002'),
          'restoring the course brings the subtree back with it');

-- ── deactivated member ──────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7',
                      '11111111-1111-1111-1111-111111111111');

SELECT is((SELECT count(*)::int FROM public.otter_subjects),
          0, 'a deactivated member reads no subjects');


-- ── 0033: the migration-0011 privilege trap, for otter_subjects ──
-- 0011's blanket GRANT plus its ALTER DEFAULT PRIVILEGES left anon holding
-- every table privilege on otter_subjects; 0033 revoked it. Assert the revoke rather
-- than assume it — a policy-only check passes while a privilege hole is wide
-- open, which is exactly how 26 tables stayed open until S21 tripped over one.
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.otter_subjects', 'SELECT') OR
    has_table_privilege('anon', 'public.otter_subjects', 'INSERT') OR
    has_table_privilege('anon', 'public.otter_subjects', 'UPDATE') OR
    has_table_privilege('anon', 'public.otter_subjects', 'DELETE')
  ),
  'anon holds no table privilege on otter_subjects'
);

SELECT * FROM finish();
ROLLBACK;
