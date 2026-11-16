-- =============================================================================
-- 70_otter_course_nominations.sql — Phase 5: course nominations (migration 0064).
--
-- Pins the whole of "anyone may submit a course to become the company standard;
-- admins AND managers decide":
--   * who may nominate (their own course, not already standard, one live at a time)
--   * the CONSENT WINDOW — submitting opens the course to approvers and only to
--     approvers, and closes again when the nomination settles
--   * who may decide, and that a bare status flip to 'approved' is refused
--   * promotion, incumbent demotion, and the same-name-different-slug refusal
--   * that CHANGE REQUESTS ARE UNCHANGED — a manager still cannot decide one
--
-- 🚨 tests.login_as() sets NO app_role, so every admin/manager probe builds its
-- claims by hand. A probe that forgets silently tests a plain member — which,
-- for a feature whose entire subject is manager authority, would make this file
-- lie in the most useful-looking way possible.
-- =============================================================================

BEGIN;

SELECT plan(48);

SELECT * FROM tests.rls_setup();

-- ── fixtures (runner: RLS bypassed) ─────────────────────────────────────────
-- user_c: plain member, owns everything nominated here
-- user_d: plain member, the "someone else"
-- user_m: MANAGER — the role this migration grants decide rights to
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
  ('ebebebeb-ebeb-ebeb-ebeb-ebebebebebeb', 'user_m@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','user','user_c','User C',true),
  ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','user','user_d','User D',true),
  ('11111111-1111-1111-1111-111111111111','ebebebeb-ebeb-ebeb-ebeb-ebebebebebeb','manager','user_m','User M',true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.otter_courses (id, workspace_id, owner_id, slug, name, visibility)
VALUES
  -- the course user_c nominates; no incumbent holds this slug
  ('0c000001-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc','private-topic','Private Topic','personal'),
  -- user_d's own personal course — user_c must not be able to nominate it
  ('0c000001-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
   'dddddddd-dddd-dddd-dddd-dddddddddddd','someone-elses','Someone Elses','personal'),
  -- the INCUMBENT standard, owned by the admin
  ('0c000001-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','blender-basics','Blender Basics','company_standard'),
  -- user_c's rival on the SAME slug — approving it must demote the incumbent
  ('0c000001-0000-0000-0000-000000000011','11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc','blender-basics','Blender Basics','personal'),
  -- same NAME, DIFFERENT slug — the case the unique index cannot catch
  ('0c000001-0000-0000-0000-000000000012','11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc','blender-advanced','Blender Basics','personal'),
  -- deliberately un-nominated, so the pre-filled-review-note probe below fails
  -- on the RLS policy alone and not on the one-live-nomination index
  ('0c000001-0000-0000-0000-000000000013','11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc','spare-topic','Spare Topic','personal');

-- Nominations for the apply probes, seeded as the runner.
INSERT INTO public.otter_course_nominations
  (id, workspace_id, course_id, proposed_by, summary)
VALUES
  ('0e000001-0000-0000-0000-000000000011','11111111-1111-1111-1111-111111111111',
   '0c000001-0000-0000-0000-000000000011','cccccccc-cccc-cccc-cccc-cccccccccccc',
   'Mine is more current than the standard.'),
  ('0e000001-0000-0000-0000-000000000012','11111111-1111-1111-1111-111111111111',
   '0c000001-0000-0000-0000-000000000012','cccccccc-cccc-cccc-cccc-cccccccccccc',
   'Same topic, different identifier.');

-- 0069 (A4): a course owned by the MANAGER, so the self-approval path has a
-- subject. A distinct slug (no incumbent to demote) and a distinct NAME, or the
-- same-name-different-slug refusal would fire before the audit line is reached.
INSERT INTO public.otter_courses (id, workspace_id, owner_id, slug, name, visibility)
VALUES
  ('0c000001-0000-0000-0000-000000000021','11111111-1111-1111-1111-111111111111',
   'ebebebeb-ebeb-ebeb-ebeb-ebebebebebeb','manager-topic','Manager Topic','personal')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.otter_course_nominations
  (id, workspace_id, course_id, proposed_by, summary)
VALUES
  ('0e000001-0000-0000-0000-000000000021','11111111-1111-1111-1111-111111111111',
   '0c000001-0000-0000-0000-000000000021','ebebebeb-ebeb-ebeb-ebeb-ebebebebebeb',
   'I wrote this one and I am also the person who decides.')
ON CONFLICT (id) DO NOTHING;

-- ── structure ───────────────────────────────────────────────────────────────
SELECT has_table('public', 'otter_course_nominations',
                 'otter_course_nominations table exists');

SELECT ok(
  (SELECT relforcerowsecurity FROM pg_class
    WHERE oid = 'public.otter_course_nominations'::regclass),
  'otter_course_nominations has FORCE ROW LEVEL SECURITY');

SELECT has_function('public', 'otter_nomination_apply',
                    'otter_nomination_apply() exists');

SELECT has_function('public', 'otter_has_open_nomination_access',
                    'otter_has_open_nomination_access() exists');

-- ── the proposer: anyone may nominate their OWN course ──────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

-- 🚨 THE CLIENT'S ACTUAL INSERT SHAPE — only course_id and summary. Every other
-- column is the server's to decide. The fixture rows above supply workspace_id
-- and proposed_by explicitly, which is exactly how a suite can stay green over a
-- table whose DEFAULTs are missing while every real write dies on NOT NULL. Do
-- not "tidy" this into the fixture form.
INSERT INTO public.otter_course_nominations (id, course_id, summary)
VALUES
  ('0e000001-0000-0000-0000-000000000001',
   '0c000001-0000-0000-0000-000000000001',
   'This is the version the whole team already uses.');

SELECT is((SELECT count(*)::int FROM public.otter_course_nominations
            WHERE id='0e000001-0000-0000-0000-000000000001'),
          1, 'a PLAIN MEMBER can nominate a course they own');

SELECT is((SELECT proposed_by FROM public.otter_course_nominations
            WHERE id='0e000001-0000-0000-0000-000000000001'),
          'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
          'proposed_by defaults to the caller — a proposer cannot file as someone else');

SELECT is((SELECT workspace_id FROM public.otter_course_nominations
            WHERE id='0e000001-0000-0000-0000-000000000001'),
          '11111111-1111-1111-1111-111111111111'::uuid,
          'workspace_id defaults to the caller''s workspace');

SELECT throws_ok($$
  INSERT INTO public.otter_course_nominations
    (workspace_id, course_id, proposed_by, summary)
  VALUES ('11111111-1111-1111-1111-111111111111',
          '0c000001-0000-0000-0000-000000000002',
          'cccccccc-cccc-cccc-cccc-cccccccccccc', 'not mine to offer');
$$, '42501', NULL,
  'a member cannot nominate someone else''s course (consent is not transferable)');

SELECT throws_ok($$
  INSERT INTO public.otter_course_nominations
    (workspace_id, course_id, proposed_by, summary)
  VALUES ('11111111-1111-1111-1111-111111111111',
          '0c000001-0000-0000-0000-000000000003',
          'cccccccc-cccc-cccc-cccc-cccccccccccc', 'already the standard');
$$, '42501', NULL,
  'a course that is already the company standard cannot be nominated');

SELECT throws_ok($$
  INSERT INTO public.otter_course_nominations
    (workspace_id, course_id, proposed_by, summary)
  VALUES ('11111111-1111-1111-1111-111111111111',
          '0c000001-0000-0000-0000-000000000001',
          'cccccccc-cccc-cccc-cccc-cccccccccccc', 'again');
$$, '23505', NULL,
  'only one live nomination per course');

SELECT throws_ok($$
  INSERT INTO public.otter_course_nominations
    (workspace_id, course_id, proposed_by, summary, review_note)
  VALUES ('11111111-1111-1111-1111-111111111111',
          '0c000001-0000-0000-0000-000000000013',
          'cccccccc-cccc-cccc-cccc-cccccccccccc', 'x', 'Approved by Ops');
$$, '42501', NULL,
  'a proposer cannot pre-fill the review note (no forged endorsement)');

-- ── the consent window ──────────────────────────────────────────────────────
-- user_d is a plain member: submitting must not open the course to them.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd',
                      '11111111-1111-1111-1111-111111111111');

SELECT is((SELECT count(*)::int FROM public.otter_courses
            WHERE id='0c000001-0000-0000-0000-000000000001'),
          0, 'a nomination does NOT open the course to ordinary members');

SELECT is((SELECT count(*)::int FROM public.otter_course_nominations),
          0, 'an ordinary member cannot read the nomination queue');

-- the MANAGER (claims by hand — tests.login_as sets no app_role)
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','ebebebeb-ebeb-ebeb-ebeb-ebebebebebeb','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','manager')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT is((SELECT count(*)::int FROM public.otter_courses
            WHERE id='0c000001-0000-0000-0000-000000000001'),
          1, 'a MANAGER may read a nominated personal course (consented window)');

SELECT ok((SELECT can_read_content FROM public.otter_course_index()
            WHERE id='0c000001-0000-0000-0000-000000000001'),
          'the index reports the nominated course as readable to a manager');

SELECT ok(NOT (SELECT can_write FROM public.otter_course_index()
                WHERE id='0c000001-0000-0000-0000-000000000001'),
          'the window is READ-only — a manager cannot write a nominated course');

SELECT is((SELECT count(*)::int FROM public.otter_course_nominations
            WHERE id='0e000001-0000-0000-0000-000000000001'),
          1, 'a manager can read the nomination queue');

-- ── deciding ────────────────────────────────────────────────────────────────
SELECT throws_ok($$
  UPDATE public.otter_course_nominations
     SET status='approved'
   WHERE id='0e000001-0000-0000-0000-000000000001';
$$, 'P0001',
  'approving promotes the course — call otter_nomination_apply() instead of setting the status',
  'a bare status flip to approved is refused (approving IS promoting)');

SELECT throws_ok($$
  UPDATE public.otter_course_nominations
     SET status='changes_requested'
   WHERE id='0e000001-0000-0000-0000-000000000001';
$$, 'P0001',
  'declining requires a note to the proposer — say what should change',
  'declining without a note is refused');

UPDATE public.otter_course_nominations
   SET status='changes_requested', review_note='Add a section on modifiers.'
 WHERE id='0e000001-0000-0000-0000-000000000001';

SELECT is((SELECT status FROM public.otter_course_nominations
            WHERE id='0e000001-0000-0000-0000-000000000001'),
          'changes_requested', 'a MANAGER can decline with a note');

SELECT is((SELECT reviewed_by FROM public.otter_course_nominations
            WHERE id='0e000001-0000-0000-0000-000000000001'),
          'ebebebeb-ebeb-ebeb-ebeb-ebebebebebeb'::uuid,
          'the reviewer is stamped server-side, not by the client');

-- an ordinary member must not be able to decide
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd',
                      '11111111-1111-1111-1111-111111111111');

WITH upd AS (
  UPDATE public.otter_course_nominations
     SET status='rejected'
   WHERE id='0e000001-0000-0000-0000-000000000011' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0,
          'an ordinary member''s decision touches no rows');

-- the proposer revises and resubmits
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

UPDATE public.otter_course_nominations
   SET status='open'
 WHERE id='0e000001-0000-0000-0000-000000000001';

SELECT is((SELECT revision FROM public.otter_course_nominations
            WHERE id='0e000001-0000-0000-0000-000000000001'),
          2, 'revise and resubmit opens a new round');

SELECT is((SELECT reviewed_by FROM public.otter_course_nominations
            WHERE id='0e000001-0000-0000-0000-000000000001'),
          NULL::uuid, 'the new round carries no decision from the last one');

-- ── applying ────────────────────────────────────────────────────────────────
SELECT throws_ok($$
  SELECT public.otter_nomination_apply('0e000001-0000-0000-0000-000000000011');
$$, 'P0001', 'only an admin or a manager may approve a nomination',
  'an ordinary member cannot approve a nomination');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','ebebebeb-ebeb-ebeb-ebeb-ebebebebebeb','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','manager')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT lives_ok($$
  SELECT public.otter_nomination_apply('0e000001-0000-0000-0000-000000000011');
$$, 'a MANAGER can approve a nomination');

-- 🚨 The pin trigger reverts silently rather than raising, so this is the probe
-- that proves the GUC arm actually works. Without it the migration would look
-- green while every approval quietly did nothing.
SELECT is((SELECT visibility FROM public.otter_courses
            WHERE id='0c000001-0000-0000-0000-000000000011'),
          'company_standard',
          'approval actually PROMOTES the course (the silent-revert trap)');

SELECT is((SELECT visibility FROM public.otter_courses
            WHERE id='0c000001-0000-0000-0000-000000000003'),
          'shared',
          'the incumbent standard is DEMOTED, not deleted');

SELECT is((SELECT superseded_course_id FROM public.otter_course_nominations
            WHERE id='0e000001-0000-0000-0000-000000000011'),
          '0c000001-0000-0000-0000-000000000003'::uuid,
          'the nomination records which standard it displaced');

SELECT is((SELECT applied_by FROM public.otter_course_nominations
            WHERE id='0e000001-0000-0000-0000-000000000011'),
          'ebebebeb-ebeb-ebeb-ebeb-ebebebebebeb'::uuid,
          'the approver is recorded on the settled nomination');

SELECT throws_ok($$
  SELECT public.otter_nomination_apply('0e000001-0000-0000-0000-000000000011');
$$, 'P0001',
  'nomination is approved — only an open nomination can be approved',
  're-approving a settled nomination is refused');

-- the same-name / different-slug case the unique index cannot see
SELECT throws_ok($$
  SELECT public.otter_nomination_apply('0e000001-0000-0000-0000-000000000012');
$$, 'P0001', NULL,
  'a same-named standard under a different slug is REFUSED, not silently duplicated');

-- ── the window closes, and change requests are untouched ────────────────────
SELECT is((SELECT count(*)::int FROM public.otter_courses
            WHERE id='0c000001-0000-0000-0000-000000000012'),
          1, 'a manager still reads the course while its nomination is live');

SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_policies
   WHERE schemaname='public' AND tablename='otter_change_requests'
     AND policyname='otter_cr_update' AND with_check LIKE '%manager%'),
  'CHANGE REQUESTS ARE UNCHANGED — a manager still cannot decide one');

SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_policies
   WHERE schemaname='public' AND tablename='otter_course_nominations'
     AND cmd='DELETE'),
  'decision history is retained — no DELETE policy');

SELECT ok(
  NOT has_table_privilege('anon','public.otter_course_nominations','SELECT')
  AND NOT has_table_privilege('anon','public.otter_course_nominations','INSERT')
  AND NOT has_table_privilege('anon','public.otter_course_nominations','UPDATE')
  AND NOT has_table_privilege('anon','public.otter_course_nominations','DELETE'),
  'anon holds no privilege on otter_course_nominations');

-- ── 0069 / A4: self-approval is ALLOWED and RECORDED (Audrey's decision 36) ──
--
-- 🚨 THE CONTROL COMES FIRST AND IT IS THE POINT. Everything above approved
-- user_c's nomination as user_m — a DIFFERENT person — so no self-approval
-- record may exist yet. Without this, a mutation that writes WIL-4108 on every
-- approval passes every probe below and the audit line means nothing.
--
-- The count is scoped to the code AND the workspace: an unfiltered count over a
-- shared audit table couples this suite to every future writer of app_events
-- (suite 25 learned that when migration 0030 added a membership trigger).
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is((SELECT count(*)::int FROM public.app_events
            WHERE workspace_id='11111111-1111-1111-1111-111111111111'
              AND code='WIL-4108'),
          0,
          'CONTROL: approving SOMEONE ELSE''S nomination writes no self-approval line');

-- Now the manager approves their own.
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','ebebebeb-ebeb-ebeb-ebeb-ebebebebebeb','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','manager')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT lives_ok($$
  SELECT public.otter_nomination_apply('0e000001-0000-0000-0000-000000000021');
$$, 'decision 36: a manager MAY approve their own nomination — it is not refused');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- It really promoted. An audit line for an approval that silently did nothing
-- would be worse than no audit line at all.
SELECT is((SELECT visibility FROM public.otter_courses
            WHERE id='0c000001-0000-0000-0000-000000000021'),
          'company_standard',
          'the self-approved course is actually promoted');

SELECT is((SELECT count(*)::int FROM public.app_events
            WHERE workspace_id='11111111-1111-1111-1111-111111111111'
              AND code='WIL-4108'),
          1,
          'exactly ONE self-approval line is written');

-- 🚨 EVERY SCALAR COLUMN READ BELOW IS `ORDER BY id LIMIT 1`, DELIBERATELY.
-- A mutation that writes this line on EVERY approval produces two rows, and
-- a bare scalar subquery then raises 21000 — which aborts the whole file, so
-- the harness reports QUERY FAILED with planned 0 / passed 0 and NOTHING is
-- counted as red. Measured: that is exactly what the first run of that
-- breaker did. The duplicate is caught cleanly by the COUNT probe above; the
-- reads that follow must not blow the file up before it can report.
-- The stream matters as much as the code. 'admin' + WIL-41xx is refused to every
-- client by app_events_insert, which is the only reason this row is evidence
-- rather than something a member could have typed.
SELECT is((SELECT event_type FROM public.app_events
            WHERE workspace_id='11111111-1111-1111-1111-111111111111'
              AND code='WIL-4108'
            ORDER BY id LIMIT 1),
          'admin',
          'the self-approval line lands on the reserved admin stream');

SELECT is((SELECT severity FROM public.app_events
            WHERE workspace_id='11111111-1111-1111-1111-111111111111'
              AND code='WIL-4108'
            ORDER BY id LIMIT 1),
          'warning',
          'it is a warning — visible in the Logs filter, not buried in info');

-- 🚨 The actor is stamped by fn_app_events_stamp from auth.uid(), NOT taken
-- from the INSERT. A line naming the wrong person is worse than none.
SELECT is((SELECT actor_user_id FROM public.app_events
            WHERE workspace_id='11111111-1111-1111-1111-111111111111'
              AND code='WIL-4108'
            ORDER BY id LIMIT 1),
          'ebebebeb-ebeb-ebeb-ebeb-ebebebebebeb'::uuid,
          'the line names the approver, server-stamped');

SELECT is((SELECT actor_label FROM public.app_events
            WHERE workspace_id='11111111-1111-1111-1111-111111111111'
              AND code='WIL-4108'
            ORDER BY id LIMIT 1),
          'User M',
          'and carries their display name, so it survives them leaving');

SELECT is((SELECT context->>'nomination_id' FROM public.app_events
            WHERE workspace_id='11111111-1111-1111-1111-111111111111'
              AND code='WIL-4108'
            ORDER BY id LIMIT 1),
          '0e000001-0000-0000-0000-000000000021',
          'the context names WHICH nomination was self-approved');

SELECT is((SELECT context->>'course_id' FROM public.app_events
            WHERE workspace_id='11111111-1111-1111-1111-111111111111'
              AND code='WIL-4108'
            ORDER BY id LIMIT 1),
          '0c000001-0000-0000-0000-000000000021',
          'and which course it promoted');

SELECT is((SELECT context->>'approver_app_role' FROM public.app_events
            WHERE workspace_id='11111111-1111-1111-1111-111111111111'
              AND code='WIL-4108'
            ORDER BY id LIMIT 1),
          'manager',
          'and the role the approver was acting under');

-- 🚨 The forgery probe. The audit line is only worth writing if a member cannot
-- write one themselves — otherwise "they approved their own" proves nothing.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

SELECT throws_ok($$
  INSERT INTO public.app_events (workspace_id, event_type, code, severity, message)
  VALUES ('11111111-1111-1111-1111-111111111111','admin','WIL-4108','warning',
          'I did not approve my own, honest');
$$, '42501', NULL,
  'a plain member cannot FORGE a WIL-4108 line — the admin stream stays reserved');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
