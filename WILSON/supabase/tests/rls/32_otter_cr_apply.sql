-- =============================================================================
-- 32_otter_cr_apply.sql — Session 13: change-request approval that APPLIES
-- (migration 0025, locked #22).
--
-- Pins the full state machine (every legal transition and the illegal ones),
-- the required decline note, the consented review window (opens on submit,
-- stays open through changes_requested, CLOSES on settle), additive apply
-- (update + insert by slug, NEVER delete), the pre-apply archive (exists,
-- owned by the approver, personal, holds the old content), and that
-- 'approved' is unreachable except through otter_cr_apply().
--
-- Fixture cast:
--   user_a (admin, live row)     reviewer for T1; owns T1
--   user_c (member)              proposer; owns forks F1 and F2
--   user_d (member)              owns T2 (a standard course a NON-admin owns),
--                                plus P1, an unrelated personal course that
--                                must stay invisible throughout
-- =============================================================================

BEGIN;

SELECT plan(67);

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

-- user_e is a MANAGER: 0026 gives that tier a read-only view of the queue.
INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','user','user_c','User C',true),
  ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','user','user_d','User D',true),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','manager','user_e','User E',true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- T1: the company standard (owner: admin). F1: user_c's fork of it.
-- P1: user_d's unrelated personal course. T2: a standard OWNED BY A NON-ADMIN
-- (user_d) — company_standard is admin-SET, but ownership stays with the
-- creator. F2: user_c's fork of T2.
INSERT INTO public.otter_courses (id, workspace_id, owner_id, slug, name, visibility, source_course_id)
VALUES
  ('0c000013-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','official-blender','Official Blender','company_standard',NULL),
  ('0c000013-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc','official-blender-fork','My Blender Fork','personal',
   '0c000013-0000-0000-0000-000000000001'),
  ('0c000013-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111',
   'dddddddd-dddd-dddd-dddd-dddddddddddd','private-notes-course','Private Notes','personal',NULL),
  ('0c000013-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111',
   'dddddddd-dddd-dddd-dddd-dddddddddddd','official-houdini','Official Houdini','company_standard',NULL),
  ('0c000013-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc','official-houdini-fork','My Houdini Fork','personal',
   '0c000013-0000-0000-0000-000000000004');

-- T1 has 'intro' (stale) and 'legacy'. F1 has 'intro' (rewritten),
-- 'brand-new' (added), PLUS two SOFT-DELETED rows: its own copy of 'legacy'
-- (the proposer genuinely deleted it from their fork — additive apply must
-- neither delete the target's copy nor apply the trashed rewrite) and
-- 'trashed-idea' (a subject they abandoned — it must not be applied at all).
-- F2 has one subject; T2 has none.
INSERT INTO public.otter_subjects (id, workspace_id, course_id, owner_id, slug, title, sections, deleted_at, deleted_by)
VALUES
  ('0d000013-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   '0c000013-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'intro','Intro OLD','[{"title":"old content"}]'::jsonb,NULL,NULL),
  ('0d000013-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
   '0c000013-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'legacy','Legacy stays','[]'::jsonb,NULL,NULL),
  ('0d000013-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111',
   '0c000013-0000-0000-0000-000000000002','cccccccc-cccc-cccc-cccc-cccccccccccc',
   'intro','Intro NEW','[{"title":"new content"}]'::jsonb,NULL,NULL),
  ('0d000013-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111',
   '0c000013-0000-0000-0000-000000000002','cccccccc-cccc-cccc-cccc-cccccccccccc',
   'brand-new','Brand new subject','[]'::jsonb,NULL,NULL),
  ('0d000013-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111',
   '0c000013-0000-0000-0000-000000000002','cccccccc-cccc-cccc-cccc-cccccccccccc',
   'legacy','Legacy (fork rewrite, then trashed)','[]'::jsonb,now(),'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('0d000013-0000-0000-0000-000000000007','11111111-1111-1111-1111-111111111111',
   '0c000013-0000-0000-0000-000000000002','cccccccc-cccc-cccc-cccc-cccccccccccc',
   'trashed-idea','Abandoned idea','[]'::jsonb,now(),'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('0d000013-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111',
   '0c000013-0000-0000-0000-000000000005','cccccccc-cccc-cccc-cccc-cccccccccccc',
   'houdini-basics','Houdini basics','[]'::jsonb,NULL,NULL);

-- ── structure ───────────────────────────────────────────────────────────────

SELECT ok(
  EXISTS (SELECT 1 FROM pg_constraint
           WHERE conrelid = 'public.otter_change_requests'::regclass
             AND conname = 'otter_cr_status_chk'
             AND pg_get_constraintdef(oid) LIKE '%changes_requested%'),
  'the status CHECK includes changes_requested');

SELECT is(
  (SELECT count(*)::int FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'otter_change_requests'
      AND column_name IN ('applied_at','applied_by','archive_course_id','revision','acknowledged_at')),
  5, 'the five 0025 bookkeeping columns exist');

SELECT ok(to_regprocedure('public.otter_cr_apply(uuid)') IS NOT NULL,
  'otter_cr_apply(uuid) exists');

SELECT ok(to_regprocedure('public.otter_has_open_review_access(uuid)') IS NOT NULL,
  'otter_has_open_review_access(uuid) exists');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname='public' AND tablename='otter_change_requests' AND cmd='DELETE'),
  0, 'change requests still have no DELETE policy — review history is retained');

-- ── before submit: the fork is private, even from admins ────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT is((SELECT count(*)::int FROM public.otter_courses
            WHERE id = '0c000013-0000-0000-0000-000000000002'),
          0, 'BEFORE submit an admin cannot read the proposer''s personal fork');

SELECT is((SELECT count(*)::int FROM public.otter_courses
            WHERE id = '0c000013-0000-0000-0000-000000000003'),
          0, 'an unrelated personal course is invisible to the admin');

-- ── submit: the window opens, and only with the proposer's consent ──────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

SELECT lives_ok(
  $$INSERT INTO public.otter_change_requests
      (id, workspace_id, target_course_id, source_course_id, proposed_by, summary)
    VALUES ('0a000013-0000-0000-0000-000000000001',
            '11111111-1111-1111-1111-111111111111',
            '0c000013-0000-0000-0000-000000000001',
            '0c000013-0000-0000-0000-000000000002',
            'cccccccc-cccc-cccc-cccc-cccccccccccc',
            'Rewrote the intro for 5.0 and added a snapping-tools subject.')$$,
  'the proposer can submit a change request from their own fork');

-- Naming a COLLEAGUE's course as the source would expose it to reviewers
-- without the colleague's consent. Refused at INSERT.
SELECT throws_ok(
  $$INSERT INTO public.otter_change_requests
      (workspace_id, target_course_id, source_course_id, proposed_by, summary)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '0c000013-0000-0000-0000-000000000001',
            '0c000013-0000-0000-0000-000000000003',
            'cccccccc-cccc-cccc-cccc-cccccccccccc',
            'trying to expose someone else''s course')$$,
  'new row violates row-level security policy for table "otter_change_requests"',
  'a request whose source is someone else''s course is refused');

-- A member of ANOTHER workspace cannot file a request against this
-- workspace's standard course (otter_course_visibility is workspace-blind;
-- the live-parent EXISTS in the INSERT policy is what refuses it).
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                      '22222222-2222-2222-2222-222222222222');

SELECT throws_ok(
  $$INSERT INTO public.otter_change_requests
      (workspace_id, target_course_id, proposed_by, summary)
    VALUES ('22222222-2222-2222-2222-222222222222',
            '0c000013-0000-0000-0000-000000000001',
            'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            'cross-workspace request against another company''s standard')$$,
  'new row violates row-level security policy for table "otter_change_requests"',
  'a member of another workspace cannot target this workspace''s standard');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT is((SELECT count(*)::int FROM public.otter_courses
            WHERE id = '0c000013-0000-0000-0000-000000000002'),
          1, 'AFTER submit the admin can read the fork — the review window is open');

SELECT is((SELECT count(*)::int FROM public.otter_subjects
            WHERE course_id = '0c000013-0000-0000-0000-000000000002'),
          2, 'the fork''s subjects come along through the live-parent EXISTS');

SELECT is((SELECT count(*)::int FROM public.otter_courses
            WHERE id = '0c000013-0000-0000-0000-000000000003'),
          0, 'the window is scoped: the unrelated personal course stays invisible');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd',
                      '11111111-1111-1111-1111-111111111111');

SELECT is((SELECT count(*)::int FROM public.otter_courses
            WHERE id = '0c000013-0000-0000-0000-000000000002'),
          0, 'a plain member who is not a reviewer of the target sees no window');

-- ── decline: a conversation, not an ending ──────────────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT throws_ok(
  $$UPDATE public.otter_change_requests SET status='changes_requested'
     WHERE id='0a000013-0000-0000-0000-000000000001'$$,
  'declining requires a note to the proposer — say what should change',
  'a decline without a note is refused');

WITH upd AS (
  UPDATE public.otter_change_requests
     SET status='changes_requested', review_note='Please split section 3 in two first.'
   WHERE id='0a000013-0000-0000-0000-000000000001' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1, 'an admin can decline with a note');

SELECT is((SELECT reviewed_by FROM public.otter_change_requests
            WHERE id='0a000013-0000-0000-0000-000000000001'),
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
          'the decliner is stamped from auth.uid()');

SELECT is((SELECT count(*)::int FROM public.otter_courses
            WHERE id = '0c000013-0000-0000-0000-000000000002'),
          1, 'the window stays open through changes_requested — the conversation continues');

SELECT throws_ok(
  $$UPDATE public.otter_change_requests SET status='open'
     WHERE id='0a000013-0000-0000-0000-000000000001'$$,
  'only the proposer may revise and resubmit',
  'an admin cannot resubmit on the proposer''s behalf');

-- ── resubmit ────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

SELECT throws_ok(
  $$UPDATE public.otter_change_requests SET review_note='Looks great — approved!'
     WHERE id='0a000013-0000-0000-0000-000000000001'$$,
  'new row violates row-level security policy for table "otter_change_requests"',
  'the proposer cannot touch the admin''s note while changes are requested');

-- The flow chart has no changes_requested → withdrawn edge: the proposer's
-- exits from a decline are accept or resubmit, nothing else.
SELECT throws_ok(
  $$UPDATE public.otter_change_requests SET status='withdrawn'
     WHERE id='0a000013-0000-0000-0000-000000000001'$$,
  'a change request cannot move from changes_requested to withdrawn',
  'withdraw does not exist from changes_requested');

WITH upd AS (
  UPDATE public.otter_change_requests
     SET status='open', summary='Round 2: split section 3 as asked, kept the new snapping subject.'
   WHERE id='0a000013-0000-0000-0000-000000000001' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1, 'the proposer can revise and resubmit');

SELECT is((SELECT revision FROM public.otter_change_requests
            WHERE id='0a000013-0000-0000-0000-000000000001'),
          2, 'resubmitting bumps the revision');

SELECT ok((SELECT reviewed_by IS NULL AND reviewed_at IS NULL
             FROM public.otter_change_requests
            WHERE id='0a000013-0000-0000-0000-000000000001'),
          'resubmitting clears the reviewer stamps — nobody has decided this revision');

SELECT is((SELECT review_note FROM public.otter_change_requests
            WHERE id='0a000013-0000-0000-0000-000000000001'),
          'Please split section 3 in two first.',
          'the admin''s note survives the resubmit — it is the conversation');

-- ── the proposer accepts a second decline ───────────────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

WITH upd AS (
  UPDATE public.otter_change_requests
     SET status='changes_requested', review_note='Still too long — one subject per tool, please.'
   WHERE id='0a000013-0000-0000-0000-000000000001' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1, 'a resubmitted request can be declined again');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

WITH upd AS (
  UPDATE public.otter_change_requests SET status='rejected'
   WHERE id='0a000013-0000-0000-0000-000000000001' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1, 'the proposer can accept the decision');

SELECT ok((SELECT acknowledged_at IS NOT NULL FROM public.otter_change_requests
            WHERE id='0a000013-0000-0000-0000-000000000001'),
          'accepting the decision stamps acknowledged_at');

SELECT is((SELECT reviewed_by FROM public.otter_change_requests
            WHERE id='0a000013-0000-0000-0000-000000000001'),
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
          'the DECLINER stays the reviewer of record — acknowledging is not a review');

SELECT throws_ok(
  $$UPDATE public.otter_change_requests SET status='open'
     WHERE id='0a000013-0000-0000-0000-000000000001'$$,
  'change request already rejected — reopen is not permitted',
  'rejected is terminal');

-- A settled request is a record: the proposer's own RLS arm can still target
-- the row (NEW.status 'rejected' is in their list so accept-the-decision
-- works), but the trigger freezes the words.
UPDATE public.otter_change_requests
   SET summary='Actually it was just typo fixes, nothing controversial'
 WHERE id='0a000013-0000-0000-0000-000000000001';

SELECT is((SELECT summary FROM public.otter_change_requests
            WHERE id='0a000013-0000-0000-0000-000000000001'),
          'Round 2: split section 3 as asked, kept the new snapping subject.',
          'the summary of a settled request is frozen — the record cannot be rewritten');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT is((SELECT count(*)::int FROM public.otter_courses
            WHERE id = '0c000013-0000-0000-0000-000000000002'),
          0, 'the window CLOSES when the request settles');

-- ── who may decide what (a fresh request for the apply phase) ───────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

INSERT INTO public.otter_change_requests
  (id, workspace_id, target_course_id, source_course_id, proposed_by, summary)
VALUES ('0a000013-0000-0000-0000-000000000002',
        '11111111-1111-1111-1111-111111111111',
        '0c000013-0000-0000-0000-000000000001',
        '0c000013-0000-0000-0000-000000000002',
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        'Third time: intro rewrite plus the snapping subject.');

SELECT throws_ok(
  $$UPDATE public.otter_change_requests SET status='rejected'
     WHERE id='0a000013-0000-0000-0000-000000000002'$$,
  'only an admin or the standard course''s owner may decide a change request',
  'the proposer cannot reject their own open request');

SELECT throws_ok(
  $$UPDATE public.otter_change_requests SET status='approved'
     WHERE id='0a000013-0000-0000-0000-000000000002'$$,
  'approving applies the change — call otter_cr_apply() instead of setting the status',
  'the proposer cannot approve their own request');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT throws_ok(
  $$UPDATE public.otter_change_requests SET status='approved'
     WHERE id='0a000013-0000-0000-0000-000000000002'$$,
  'approving applies the change — call otter_cr_apply() instead of setting the status',
  'even an admin cannot flip a request to approved without applying it');

SELECT throws_ok(
  $$UPDATE public.otter_change_requests SET status='withdrawn'
     WHERE id='0a000013-0000-0000-0000-000000000002'$$,
  'only the proposer may withdraw a change request',
  'an admin cannot withdraw someone''s request');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd',
                      '11111111-1111-1111-1111-111111111111');

-- A refused UPDATE matches 0 rows and raises nothing — pin the refusal shape
-- the adapters have to guard against (the 204 trap).
WITH upd AS (
  UPDATE public.otter_change_requests SET status='rejected'
   WHERE id='0a000013-0000-0000-0000-000000000002' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0,
          'an unrelated member''s decision touches no rows at all');

SELECT throws_ok(
  $$SELECT public.otter_cr_apply('0a000013-0000-0000-0000-000000000002')$$,
  'only an admin or the standard course''s owner may approve',
  'an unrelated member cannot apply');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

SELECT throws_ok(
  $$SELECT public.otter_cr_apply('0a000013-0000-0000-0000-000000000002')$$,
  'only an admin or the standard course''s owner may approve',
  'the proposer cannot apply their own request');

-- ── a MANAGER views the queue, and only views it (0026) ─────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','manager')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT is((SELECT count(*)::int FROM public.otter_change_requests),
          2, 'a manager can view the workspace''s whole queue');

WITH upd AS (
  UPDATE public.otter_change_requests
     SET status='changes_requested', review_note='manager trying to decide'
   WHERE id='0a000013-0000-0000-0000-000000000002' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0,
          'a manager''s decision touches no rows — the queue is view-only for them');

SELECT is((SELECT count(*)::int FROM public.otter_courses
            WHERE id = '0c000013-0000-0000-0000-000000000002'),
          0, 'a manager gets NO review window — the proposer consented to reviewers, not the tier');

SELECT throws_ok(
  $$SELECT public.otter_cr_apply('0a000013-0000-0000-0000-000000000002')$$,
  'only an admin or the standard course''s owner may approve',
  'a manager cannot apply');

-- ── the apply ───────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT ok(
  (SELECT public.otter_cr_apply('0a000013-0000-0000-0000-000000000002') IS NOT NULL),
  'the admin can approve-and-apply, and gets the archive id back');

SELECT is((SELECT status FROM public.otter_change_requests
            WHERE id='0a000013-0000-0000-0000-000000000002'),
          'approved', 'the request is approved');

SELECT ok((SELECT applied_by = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
              AND applied_at IS NOT NULL
              AND archive_course_id IS NOT NULL
             FROM public.otter_change_requests
            WHERE id='0a000013-0000-0000-0000-000000000002'),
          'the apply stamps who, when, and which archive');

SELECT is((SELECT title FROM public.otter_subjects
            WHERE course_id='0c000013-0000-0000-0000-000000000001'
              AND slug='intro' AND deleted_at IS NULL),
          'Intro NEW', 'a changed subject is UPDATED in the standard, matched by slug');

-- Update means UPDATE: the standard's row keeps its identity (id), it is not
-- deleted and re-inserted — progress keys and references survive.
SELECT is((SELECT id FROM public.otter_subjects
            WHERE course_id='0c000013-0000-0000-0000-000000000001'
              AND slug='intro' AND deleted_at IS NULL),
          '0d000013-0000-0000-0000-000000000001'::uuid,
          'the updated subject kept its row id — update in place, not delete-and-reinsert');

SELECT is((SELECT count(*)::int FROM public.otter_subjects
            WHERE course_id='0c000013-0000-0000-0000-000000000001'
              AND deleted_at IS NULL),
          3, 'the standard now holds intro + legacy + brand-new');

SELECT ok(
  EXISTS (SELECT 1 FROM public.otter_subjects
           WHERE course_id='0c000013-0000-0000-0000-000000000001'
             AND slug='legacy' AND deleted_at IS NULL),
  'ADDITIVE: a subject the proposer deleted from their fork SURVIVES in the standard');

-- The apply loop reads only LIVE source subjects: the fork's soft-deleted
-- 'legacy' rewrite must not overwrite the standard's copy…
SELECT is((SELECT title FROM public.otter_subjects
            WHERE course_id='0c000013-0000-0000-0000-000000000001'
              AND slug='legacy' AND deleted_at IS NULL),
          'Legacy stays',
          'a soft-deleted source subject is not applied over the standard''s live copy');

-- …and a subject that exists ONLY as a trashed row in the fork is not
-- resurrected into the standard.
SELECT is((SELECT count(*)::int FROM public.otter_subjects
            WHERE course_id='0c000013-0000-0000-0000-000000000001'
              AND slug='trashed-idea'),
          0, 'a trashed-only source subject is not applied at all');

SELECT ok(
  (SELECT c.owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
      AND c.visibility = 'personal'
      AND c.name = 'Official Blender (before change #1)'
     FROM public.otter_courses c
    WHERE c.id = (SELECT archive_course_id FROM public.otter_change_requests
                   WHERE id='0a000013-0000-0000-0000-000000000002')),
  'the archive is a personal course owned by the approver, named for the change');

SELECT is((SELECT count(*)::int FROM public.otter_subjects s
            WHERE s.course_id = (SELECT archive_course_id FROM public.otter_change_requests
                                  WHERE id='0a000013-0000-0000-0000-000000000002')
              AND s.deleted_at IS NULL),
          2, 'the archive holds the PRE-apply subject set (no brand-new)');

SELECT is((SELECT s.title FROM public.otter_subjects s
            WHERE s.course_id = (SELECT archive_course_id FROM public.otter_change_requests
                                  WHERE id='0a000013-0000-0000-0000-000000000002')
              AND s.slug='intro'),
          'Intro OLD', 'the archive holds the PRE-apply content');

SELECT is((SELECT count(*)::int FROM public.otter_courses
            WHERE id = '0c000013-0000-0000-0000-000000000002'),
          0, 'the window closes on approval too — the fork is private again');

SELECT throws_ok(
  $$SELECT public.otter_cr_apply('0a000013-0000-0000-0000-000000000002')$$,
  'change request is approved — only an open request can be approved and applied',
  'apply is refused on a settled request');

SELECT throws_ok(
  $$UPDATE public.otter_change_requests SET status='rejected'
     WHERE id='0a000013-0000-0000-0000-000000000002'$$,
  'change request already approved — reopen is not permitted',
  'approved is terminal');

-- ── withdraw: proposer-only, stamp-proof, terminal ──────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

INSERT INTO public.otter_change_requests
  (id, workspace_id, target_course_id, source_course_id, proposed_by, summary)
VALUES ('0a000013-0000-0000-0000-000000000005',
        '11111111-1111-1111-1111-111111111111',
        '0c000013-0000-0000-0000-000000000001',
        NULL,
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        'Second thoughts — never mind this one.');

-- otter_cr_reviewed_chk exempts 'withdrawn', so smuggled reviewer stamps in
-- the withdrawing UPDATE would store a forged review by a named admin in the
-- permanently retained history. The trigger pins them (S13 review finding).
WITH upd AS (
  UPDATE public.otter_change_requests
     SET status='withdrawn',
         reviewed_by='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
         reviewed_at=now()
   WHERE id='0a000013-0000-0000-0000-000000000005' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1,
          'the proposer can withdraw their open request');

SELECT ok((SELECT reviewed_by IS NULL AND reviewed_at IS NULL
             FROM public.otter_change_requests
            WHERE id='0a000013-0000-0000-0000-000000000005'),
          'reviewer stamps smuggled into a withdraw are pinned to NULL — no forged review');

SELECT throws_ok(
  $$UPDATE public.otter_change_requests SET status='open'
     WHERE id='0a000013-0000-0000-0000-000000000005'$$,
  'change request already withdrawn — reopen is not permitted',
  'withdrawn is terminal');

-- ── a NON-admin standard-course owner is a real reviewer ────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

INSERT INTO public.otter_change_requests
  (id, workspace_id, target_course_id, source_course_id, proposed_by, summary)
VALUES ('0a000013-0000-0000-0000-000000000004',
        '11111111-1111-1111-1111-111111111111',
        '0c000013-0000-0000-0000-000000000004',
        '0c000013-0000-0000-0000-000000000005',
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        'Houdini basics, written up from the onboarding sessions.');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd',
                      '11111111-1111-1111-1111-111111111111');

SELECT is((SELECT count(*)::int FROM public.otter_courses
            WHERE id = '0c000013-0000-0000-0000-000000000005'),
          1, 'the standard course''s OWNER gets the review window without being admin');

WITH upd AS (
  UPDATE public.otter_change_requests
     SET status='changes_requested', review_note='Add the shelf-tools chapter first.'
   WHERE id='0a000013-0000-0000-0000-000000000004' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1,
          'the standard course''s owner may decline with a note');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

UPDATE public.otter_change_requests
   SET status='open', summary='Added the shelf-tools chapter as asked.'
 WHERE id='0a000013-0000-0000-0000-000000000004';

-- The admin demotes T2 out of the standard tier: apply must refuse rather
-- than write into what is now a private-tier course.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

UPDATE public.otter_courses SET visibility='shared'
 WHERE id='0c000013-0000-0000-0000-000000000004';

SELECT throws_ok(
  $$SELECT public.otter_cr_apply('0a000013-0000-0000-0000-000000000004')$$,
  'the target is no longer the company standard — approve would edit a private course',
  'apply is refused when the target has left the company-standard tier');

UPDATE public.otter_courses SET visibility='company_standard'
 WHERE id='0c000013-0000-0000-0000-000000000004';

SELECT ok(
  (SELECT public.otter_cr_apply('0a000013-0000-0000-0000-000000000004') IS NOT NULL),
  'apply works again once the target is back in the standard tier');

-- The new subject belongs to the STANDARD's owner (user_d) — not the proposer,
-- not the approver — while created_by records who actually wrote it (user_a).
SELECT ok(
  (SELECT s.owner_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid
      AND s.created_by = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
     FROM public.otter_subjects s
    WHERE s.course_id='0c000013-0000-0000-0000-000000000004'
      AND s.slug='houdini-basics' AND s.deleted_at IS NULL),
  'an applied subject belongs to the standard''s owner, stamped by the approver');

SELECT ok(
  (SELECT c.owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
     FROM public.otter_courses c
    WHERE c.id = (SELECT archive_course_id FROM public.otter_change_requests
                   WHERE id='0a000013-0000-0000-0000-000000000004')),
  'the archive belongs to the APPROVER even when the target is someone else''s');

SELECT * FROM finish();
ROLLBACK;
