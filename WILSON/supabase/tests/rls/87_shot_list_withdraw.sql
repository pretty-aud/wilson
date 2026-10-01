-- =========================================================================
-- 87_shot_list_withdraw.sql — migration 0085 (post-overhaul S3a, after its
-- hand-off; Audrey's answers of 2026-09-30).
--
-- What it PINS:
--  1. The maker is the maker: a signed-in INSERT into shot_lists / edits is
--     stamped created_by = the caller whatever it sent; no UPDATE changes it;
--     an insert with no signed-in user keeps what it sent (the backfill's
--     NULL). The pin function is no client's to call (1-5, 21, 25-26).
--  2. The MAKER path of archive_shot_list / archive_edit: a member — and a
--     reviewer, who may write lists under D8 — withdraws an UNTOUCHED row they
--     made and restores it (6-10, 15-16, 27-29).
--  3. Every refusal the path keeps, each against a row that would otherwise
--     pass: someone else's row (11-12, 32), a Saved list or edit (13, 31), a
--     list with a live edit (14) — which becomes withdrawable once that edit
--     is withdrawn (15-16) — an edit a live edit continues (30), the ACTIVE
--     list (17-18, D4 for everyone), what a manager archived (19-20), a list
--     with no maker (21-22), a private project the maker cannot see (34: the
--     read gate comes first), a maker who lost their seat (35).
--  4. The manager path is unchanged: a project manager still archives a
--     touched list (23-24) and a touched edit (33).
--
-- Users (84's shape): user_c reviewer, user_d member, user_e project MANAGER
-- (app_role 'user'), all seated on project_a, so the project is STAFFED and
-- the seat rules apply.
-- =========================================================================
BEGIN;

SELECT plan(35);

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

INSERT INTO public.project_members
  (project_id, user_id, workspace_id, project_role)
VALUES
  ('aaaa1111-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1111-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1111-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   '11111111-1111-1111-1111-111111111111', 'manager')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;


-- ── 1-3: structure (§1) ──────────────────────────────────────────────────

SELECT has_trigger('public', 'shot_lists', 'trg_shot_lists_pin_maker',
  'shot_lists pins its maker (§1)');
SELECT has_trigger('public', 'edits', 'trg_edits_pin_maker',
  'edits pins its maker (§1)');
-- CASE, not AND: has_function_privilege RAISES on a missing function, and
-- this must FAIL then (the control run without 0085), not abort the suite.
SELECT ok(
  CASE WHEN to_regprocedure('public.fn_shot_list_pin_maker()') IS NULL THEN false
       ELSE NOT has_function_privilege('authenticated', 'public.fn_shot_list_pin_maker()', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.fn_shot_list_pin_maker()', 'EXECUTE')
  END,
  'the pin function exists and no client role can call it');


-- ── 4-5: the maker is the maker (as user_d, member) ──────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- The client SENDS user_e as the maker.
INSERT INTO public.shot_lists (id, project_id, title, version, created_by)
VALUES ('87870000-0000-0000-0000-0000000000a1', 'aaaa1111-0000-0000-0000-000000000001',
        'Maker test', 1, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');

SELECT is(
  (SELECT created_by FROM public.shot_lists WHERE id = '87870000-0000-0000-0000-0000000000a1'),
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  'a signed-in insert is stamped with its caller as the maker, whatever it sent');

UPDATE public.shot_lists SET created_by = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
 WHERE id = '87870000-0000-0000-0000-0000000000a1';

SELECT is(
  (SELECT created_by FROM public.shot_lists WHERE id = '87870000-0000-0000-0000-0000000000a1'),
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  'no UPDATE changes a list''s maker');


-- ── 6-9: the maker withdraws an untouched list, then restores it ─────────

SELECT lives_ok(
  $$SELECT public.archive_shot_list('87870000-0000-0000-0000-0000000000a1')$$,
  'a member withdraws an untouched list they made (0085)');

SELECT ok(
  (SELECT archived_at IS NOT NULL AND archived_by = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid
     FROM public.shot_lists WHERE id = '87870000-0000-0000-0000-0000000000a1'),
  'it is set aside by its maker (archived_by = the maker: "withdrawn")');

SELECT lives_ok(
  $$SELECT public.archive_shot_list('87870000-0000-0000-0000-0000000000a1', false)$$,
  'the maker restores what they withdrew');

SELECT ok(
  (SELECT archived_at IS NULL AND archived_by IS NULL
     FROM public.shot_lists WHERE id = '87870000-0000-0000-0000-0000000000a1'),
  'the list is live again');


-- ── 10: a REVIEWER withdraws a list they made (D8 lets reviewers write lists)

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

INSERT INTO public.shot_lists (id, project_id, title, version)
VALUES ('87870000-0000-0000-0000-0000000000a2', 'aaaa1111-0000-0000-0000-000000000001', 'Reviewer list', 1),
       ('87870000-0000-0000-0000-0000000000a3', 'aaaa1111-0000-0000-0000-000000000001', 'Reviewer live list', 1);

SELECT lives_ok(
  $$SELECT public.archive_shot_list('87870000-0000-0000-0000-0000000000a2')$$,
  'a reviewer withdraws an untouched list they made');


-- ── 11-12: nobody withdraws or restores someone else's list (as user_d) ──

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.archive_shot_list('87870000-0000-0000-0000-0000000000a3')$$,
  '42501', 'only a project manager or a workspace admin can archive or restore a shot list',
  'a member cannot withdraw a list someone else made (untouched or not)');

SELECT throws_ok(
  $$SELECT public.archive_shot_list('87870000-0000-0000-0000-0000000000a2', false)$$,
  '42501', 'only a project manager or a workspace admin can archive or restore a shot list',
  'nor restore a list someone else withdrew');


-- ── 13-16: a TOUCHED list stays the manager's (as user_d) ─────────────────

INSERT INTO public.shot_lists (id, project_id, title, version)
VALUES ('87870000-0000-0000-0000-0000000000a4', 'aaaa1111-0000-0000-0000-000000000001', 'Saved list', 1),
       ('87870000-0000-0000-0000-0000000000a5', 'aaaa1111-0000-0000-0000-000000000001', 'List with an edit', 1);
-- "Save" (D5) writes the snapshot.
UPDATE public.shot_lists SET snapshot = '{"kind":"shot_list"}'::jsonb
 WHERE id = '87870000-0000-0000-0000-0000000000a4';
INSERT INTO public.edits (id, project_id, shot_list_id, title, version)
VALUES ('87870000-0000-0000-0000-0000000000e5', 'aaaa1111-0000-0000-0000-000000000001',
        '87870000-0000-0000-0000-0000000000a5', 'Cut', 1);

SELECT throws_ok(
  $$SELECT public.archive_shot_list('87870000-0000-0000-0000-0000000000a4')$$,
  '42501', 'only an untouched shot list you made can be withdrawn — a project manager or a workspace admin can archive it',
  'a Saved list cannot be withdrawn by its maker');

SELECT throws_ok(
  $$SELECT public.archive_shot_list('87870000-0000-0000-0000-0000000000a5')$$,
  '42501', 'only an untouched shot list you made can be withdrawn — a project manager or a workspace admin can archive it',
  'a list with a live edit on it cannot be withdrawn by its maker');

SELECT lives_ok(
  $$SELECT public.archive_edit('87870000-0000-0000-0000-0000000000e5')$$,
  'its maker withdraws the untouched edit first');

SELECT lives_ok(
  $$SELECT public.archive_shot_list('87870000-0000-0000-0000-0000000000a5')$$,
  'then the list has no live edit and its maker can withdraw it (the undo order of "New list", then "New edit")');


-- ── 17-18: the ACTIVE list is nobody's to archive (D4) ───────────────────

INSERT INTO public.shot_lists (id, project_id, title, version)
VALUES ('87870000-0000-0000-0000-0000000000a6', 'aaaa1111-0000-0000-0000-000000000001', 'Active candidate', 1),
       ('87870000-0000-0000-0000-0000000000a7', 'aaaa1111-0000-0000-0000-000000000001', 'Manager will archive', 1),
       ('87870000-0000-0000-0000-0000000000a9', 'aaaa1111-0000-0000-0000-000000000001', 'Seat test', 1),
       ('87870000-0000-0000-0000-0000000000b0', 'aaaa1111-0000-0000-0000-000000000001', 'Edits list', 1);

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.set_active_shot_list('aaaa1111-0000-0000-0000-000000000001', '87870000-0000-0000-0000-0000000000a6')$$,
  'the project manager makes the member''s untouched list active');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.archive_shot_list('87870000-0000-0000-0000-0000000000a6')$$,
  'P0001', 'the active shot list cannot be archived — make another list active first',
  'its maker cannot withdraw the ACTIVE list (D4 holds on the maker path too)');


-- ── 19-20: what a manager archived is the manager's to restore ───────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.archive_shot_list('87870000-0000-0000-0000-0000000000a7')$$,
  'the project manager archives the member''s list');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.archive_shot_list('87870000-0000-0000-0000-0000000000a7', false)$$,
  '42501', 'only a project manager or a workspace admin can archive or restore a shot list',
  'its maker cannot restore what a manager archived');


-- ── 21-22: a list with no maker (the D11 backfill's) is nobody's to withdraw

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

INSERT INTO public.shot_lists (id, project_id, title, version)
VALUES ('87870000-0000-0000-0000-0000000000a8', 'aaaa1111-0000-0000-0000-000000000001', 'Maker-less', 1);

SELECT is(
  (SELECT created_by FROM public.shot_lists WHERE id = '87870000-0000-0000-0000-0000000000a8'),
  NULL::uuid,
  'an insert with no signed-in user keeps the maker it sent (the backfill''s NULL)');

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.archive_shot_list('87870000-0000-0000-0000-0000000000a8')$$,
  '42501', 'only a project manager or a workspace admin can archive or restore a shot list',
  'nobody withdraws a list without a maker');


-- ── 23-24: the manager path is unchanged (as user_e) ─────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.archive_shot_list('87870000-0000-0000-0000-0000000000a4')$$,
  'the project manager still archives a TOUCHED (Saved) list');

SELECT ok(
  (SELECT archived_by = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid
     FROM public.shot_lists WHERE id = '87870000-0000-0000-0000-0000000000a4'),
  'archived by the manager, not "withdrawn" (archived_by is not its maker)');


-- ── 25-32: edits (as user_d) ─────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- The client SENDS user_e as the edit's maker.
INSERT INTO public.edits (id, project_id, shot_list_id, title, version, created_by)
VALUES ('87870000-0000-0000-0000-0000000000e1', 'aaaa1111-0000-0000-0000-000000000001',
        '87870000-0000-0000-0000-0000000000b0', 'Cut', 1, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');

SELECT is(
  (SELECT created_by FROM public.edits WHERE id = '87870000-0000-0000-0000-0000000000e1'),
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  'a signed-in edit insert is stamped with its caller as the maker, whatever it sent');

UPDATE public.edits SET created_by = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
 WHERE id = '87870000-0000-0000-0000-0000000000e1';

SELECT is(
  (SELECT created_by FROM public.edits WHERE id = '87870000-0000-0000-0000-0000000000e1'),
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  'no UPDATE changes an edit''s maker');

SELECT lives_ok(
  $$SELECT public.archive_edit('87870000-0000-0000-0000-0000000000e1')$$,
  'a member withdraws an untouched edit they made');

SELECT ok(
  (SELECT archived_by = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid
     FROM public.edits WHERE id = '87870000-0000-0000-0000-0000000000e1'),
  'set aside by its maker');

SELECT lives_ok(
  $$SELECT public.archive_edit('87870000-0000-0000-0000-0000000000e1', false)$$,
  'and restores it');

-- e2 continues e1 (the chain, D6) and is then Saved.
INSERT INTO public.edits (id, project_id, shot_list_id, title, version, parent_edit_id)
VALUES ('87870000-0000-0000-0000-0000000000e2', 'aaaa1111-0000-0000-0000-000000000001',
        '87870000-0000-0000-0000-0000000000b0', 'Cut', 2, '87870000-0000-0000-0000-0000000000e1');

SELECT throws_ok(
  $$SELECT public.archive_edit('87870000-0000-0000-0000-0000000000e1')$$,
  '42501', 'only an untouched edit you made can be withdrawn — a project manager or a workspace admin can archive it',
  'an edit a live edit continues cannot be withdrawn by its maker');

UPDATE public.edits SET snapshot = '{"kind":"edit"}'::jsonb
 WHERE id = '87870000-0000-0000-0000-0000000000e2';

SELECT throws_ok(
  $$SELECT public.archive_edit('87870000-0000-0000-0000-0000000000e2')$$,
  '42501', 'only an untouched edit you made can be withdrawn — a project manager or a workspace admin can archive it',
  'a Saved edit cannot be withdrawn by its maker');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.archive_edit('87870000-0000-0000-0000-0000000000e2')$$,
  '42501', 'only a project manager or a workspace admin can archive or restore an edit',
  'nobody but its maker reaches the maker path for an edit');


-- ── 33: the manager path for edits is unchanged (as user_e) ──────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.archive_edit('87870000-0000-0000-0000-0000000000e2')$$,
  'the project manager still archives a TOUCHED (Saved) edit');


-- ── 34: the read gate comes BEFORE the maker path ────────────────────────
-- A private project (0072) is seen by its creator and workspace admins only
-- (0082's passes_project_privacy). user_d is SEATED on it as a member, so
-- can_edit_shot_lists says yes — the only arm left to refuse is privacy. The
-- list is d's own and untouched, written by postgres (no signed-in user, so
-- the pin keeps the maker it was sent): the same list on project_a is
-- withdrawable (6).

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

INSERT INTO public.projects (id, workspace_id, title, is_private, created_by)
VALUES ('aaaa1111-0000-0000-0000-000000000087', '11111111-1111-1111-1111-111111111111',
        'Private P87', true, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role)
VALUES ('aaaa1111-0000-0000-0000-000000000087', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;
INSERT INTO public.shot_lists (id, workspace_id, project_id, title, version, created_by)
VALUES ('87870000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111',
        'aaaa1111-0000-0000-0000-000000000087', 'Private draft', 1,
        'dddddddd-dddd-dddd-dddd-dddddddddddd');

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.archive_shot_list('87870000-0000-0000-0000-0000000000c1')$$,
  'P0002', 'shot list not found',
  'a maker cannot withdraw their list on a private project they cannot see (passes_project_privacy first)');


-- ── 35: a maker who lost their seat loses the maker path ─────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

DELETE FROM public.project_members
 WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'
   AND user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.archive_shot_list('87870000-0000-0000-0000-0000000000a9')$$,
  '42501', 'only a project manager or a workspace admin can archive or restore a shot list',
  'a maker who lost their seat on the staffed project cannot withdraw their untouched list');

SELECT * FROM finish();
ROLLBACK;
