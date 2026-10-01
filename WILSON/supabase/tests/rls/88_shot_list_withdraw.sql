-- =========================================================================
-- 88_shot_list_withdraw.sql — migration 0086 (post-overhaul S3a, after its
-- hand-off; Audrey's answers of 2026-09-30). Written as suite 87 for 0085 and
-- renumbered before any apply (the plan had given 0085 / 87 to S4a).
--
-- What it PINS:
--  1. The maker is the maker: a signed-in INSERT into shot_lists / edits is
--     stamped created_by = the caller whatever it sent, on the upsert path
--     too; no UPDATE changes it; an insert with no signed-in user keeps what
--     it sent, NULL or not. The pin function is no client's (1-6, 30-31,
--     35-36). The rename probes read the title back, so a silently filtered
--     UPDATE cannot pass them.
--  2. The MAKER path: a member and a reviewer withdraw an UNTOUCHED list or
--     edit they made and restore it, and the row is live again (7-14, 20-21,
--     37-40, 45-46). A restore only un-hides: the maker restores a withdrawn
--     list a live edit landed on, and a withdrawn edit a live edit now
--     continues (22-25). It restores only what is not Saved — what every
--     withdraw left — so a manager demoted to member cannot restore a Saved
--     list or edit they archived as manager, but can an unsaved one (53-55).
--     A maker's restore of a LIVE row, Saved or not, is a no-op (50-52).
--  3. Every refusal the path keeps: someone else's row, for withdraw and
--     restore (15-16, 44 — 44's edit is also Saved: the maker check answers
--     first); a Saved list or edit (17, 42); a list with a live edit, the
--     maker's own (18) or someone else's (19) — the maker's own becomes
--     withdrawable once that edit is withdrawn first (20-21, Ctrl+Z's order);
--     an edit a live edit continues, the maker's own (41) or someone else's
--     (43); the ACTIVE list (26-27, D4 for everyone); what a manager archived,
--     a list (28-29, and 49: Saved too — the seat sentence answers first) and
--     an edit (47-48); a list with no maker (32); a private project the maker
--     cannot see (56: the read gate comes first); a maker who lost their seat,
--     for withdraw and restore (57-59).
--  4. The manager path is unchanged: a project manager still archives a
--     touched list (33-34) and a touched edit (47).
--
-- Users (84's shape): user_c reviewer, user_d member, user_e project MANAGER
-- (app_role 'user'), all seated on project_a, so the project is STAFFED and
-- the seat rules apply.
-- =========================================================================
BEGIN;

SELECT plan(59);

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
-- this must FAIL then (the control run without 0086), not abort the suite.
SELECT ok(
  CASE WHEN to_regprocedure('public.fn_shot_list_pin_maker()') IS NULL THEN false
       ELSE NOT has_function_privilege('authenticated', 'public.fn_shot_list_pin_maker()', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.fn_shot_list_pin_maker()', 'EXECUTE')
  END,
  'the pin function exists and no client role can call it');


-- ── 4-6: the maker is the maker (as user_d, member; then user_c) ─────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- The client SENDS user_e as the maker.
INSERT INTO public.shot_lists (id, project_id, title, version, created_by)
VALUES ('88880000-0000-0000-0000-0000000000a1', 'aaaa1111-0000-0000-0000-000000000001',
        'Maker test', 1, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');

SELECT is(
  (SELECT created_by FROM public.shot_lists WHERE id = '88880000-0000-0000-0000-0000000000a1'),
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  'a signed-in insert is stamped with its caller as the maker, whatever it sent');

UPDATE public.shot_lists SET created_by = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', title = 'Maker test renamed'
 WHERE id = '88880000-0000-0000-0000-0000000000a1';

SELECT is(
  (SELECT created_by::text || ' | ' || title FROM public.shot_lists WHERE id = '88880000-0000-0000-0000-0000000000a1'),
  'dddddddd-dddd-dddd-dddd-dddddddddddd | Maker test renamed',
  'an UPDATE that reached the row (the title changed) did not change its maker');

-- The PostgREST upsert, by another writer (the reviewer), naming themselves.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

INSERT INTO public.shot_lists (id, project_id, title, version, created_by)
VALUES ('88880000-0000-0000-0000-0000000000a1', 'aaaa1111-0000-0000-0000-000000000001',
        'Maker test upserted', 1, 'cccccccc-cccc-cccc-cccc-cccccccccccc')
ON CONFLICT (id) DO UPDATE SET created_by = EXCLUDED.created_by, title = EXCLUDED.title;

SELECT is(
  (SELECT created_by::text || ' | ' || title FROM public.shot_lists WHERE id = '88880000-0000-0000-0000-0000000000a1'),
  'dddddddd-dddd-dddd-dddd-dddddddddddd | Maker test upserted',
  'an upsert''s conflict branch that set created_by = EXCLUDED changed the title but not the maker');


-- ── 7-10: the maker withdraws an untouched list, then restores it (as d) ─

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.archive_shot_list('88880000-0000-0000-0000-0000000000a1')$$,
  'a member withdraws an untouched list they made (0086)');

SELECT ok(
  (SELECT archived_at IS NOT NULL AND archived_by = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid
     FROM public.shot_lists WHERE id = '88880000-0000-0000-0000-0000000000a1'),
  'it is set aside by its maker (archived_by = the maker: "withdrawn")');

SELECT lives_ok(
  $$SELECT public.archive_shot_list('88880000-0000-0000-0000-0000000000a1', false)$$,
  'the maker restores what they withdrew');

SELECT ok(
  (SELECT archived_at IS NULL AND archived_by IS NULL
     FROM public.shot_lists WHERE id = '88880000-0000-0000-0000-0000000000a1'),
  'the list is live again');


-- ── 11-14: a REVIEWER withdraws and restores a list they made (D8) ───────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

INSERT INTO public.shot_lists (id, project_id, title, version)
VALUES ('88880000-0000-0000-0000-0000000000a2', 'aaaa1111-0000-0000-0000-000000000001', 'Reviewer list', 1),
       ('88880000-0000-0000-0000-0000000000a3', 'aaaa1111-0000-0000-0000-000000000001', 'Reviewer live list', 1);

SELECT lives_ok(
  $$SELECT public.archive_shot_list('88880000-0000-0000-0000-0000000000a2')$$,
  'a reviewer withdraws an untouched list they made');

SELECT lives_ok(
  $$SELECT public.archive_shot_list('88880000-0000-0000-0000-0000000000a2', false)$$,
  'and restores it');

SELECT ok(
  (SELECT archived_at IS NULL FROM public.shot_lists WHERE id = '88880000-0000-0000-0000-0000000000a2'),
  'the reviewer''s list is live again');

SELECT lives_ok(
  $$SELECT public.archive_shot_list('88880000-0000-0000-0000-0000000000a2')$$,
  'SETUP: and sets it aside again (for 16)');


-- ── 15-16: nobody withdraws or restores someone else's list (as d) ───────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.archive_shot_list('88880000-0000-0000-0000-0000000000a3')$$,
  '42501', 'only a project manager or a workspace admin can archive or restore a shot list',
  'a member cannot withdraw an untouched list someone else made');

SELECT throws_ok(
  $$SELECT public.archive_shot_list('88880000-0000-0000-0000-0000000000a2', false)$$,
  '42501', 'only a project manager or a workspace admin can archive or restore a shot list',
  'nor restore a list someone else withdrew');


-- ── 17-25: a TOUCHED list stays the manager's (as d) ─────────────────────

INSERT INTO public.shot_lists (id, project_id, title, version)
VALUES ('88880000-0000-0000-0000-0000000000a4', 'aaaa1111-0000-0000-0000-000000000001', 'Saved list', 1),
       ('88880000-0000-0000-0000-0000000000a5', 'aaaa1111-0000-0000-0000-000000000001', 'List with an edit', 1),
       ('88880000-0000-0000-0000-0000000000b2', 'aaaa1111-0000-0000-0000-000000000001', 'List with their edit', 1);
-- "Save" (D5) writes the snapshot.
UPDATE public.shot_lists SET snapshot = '{"kind":"shot_list"}'::jsonb
 WHERE id = '88880000-0000-0000-0000-0000000000a4';
INSERT INTO public.edits (id, project_id, shot_list_id, title, version)
VALUES ('88880000-0000-0000-0000-0000000000e5', 'aaaa1111-0000-0000-0000-000000000001',
        '88880000-0000-0000-0000-0000000000a5', 'Cut', 1);

-- The reviewer puts THEIR edit on d's list b2.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
INSERT INTO public.edits (id, project_id, shot_list_id, title, version)
VALUES ('88880000-0000-0000-0000-0000000000f2', 'aaaa1111-0000-0000-0000-000000000001',
        '88880000-0000-0000-0000-0000000000b2', 'Their cut', 1);

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.archive_shot_list('88880000-0000-0000-0000-0000000000a4')$$,
  '42501', 'only an untouched shot list you made can be withdrawn — a project manager or a workspace admin can archive it',
  'a Saved list cannot be withdrawn by its maker');

SELECT throws_ok(
  $$SELECT public.archive_shot_list('88880000-0000-0000-0000-0000000000a5')$$,
  '42501', 'only an untouched shot list you made can be withdrawn — a project manager or a workspace admin can archive it',
  'a list with the maker''s own live edit on it cannot be withdrawn');

SELECT throws_ok(
  $$SELECT public.archive_shot_list('88880000-0000-0000-0000-0000000000b2')$$,
  '42501', 'only an untouched shot list you made can be withdrawn — a project manager or a workspace admin can archive it',
  'nor a list with SOMEONE ELSE''s live edit on it');

SELECT lives_ok(
  $$SELECT public.archive_edit('88880000-0000-0000-0000-0000000000e5')$$,
  'its maker withdraws the untouched edit first');

SELECT lives_ok(
  $$SELECT public.archive_shot_list('88880000-0000-0000-0000-0000000000a5')$$,
  'then the list has no live edit and its maker can withdraw it (Ctrl+Z''s order: New edit, then New list)');

-- While a5 is set aside, the reviewer continues its chain with a live edit
-- (0084 lets a writer add an edit to an archived list; the app does not).
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
INSERT INTO public.edits (id, project_id, shot_list_id, title, version, parent_edit_id)
VALUES ('88880000-0000-0000-0000-0000000000e9', 'aaaa1111-0000-0000-0000-000000000001',
        '88880000-0000-0000-0000-0000000000a5', 'Cut', 2, '88880000-0000-0000-0000-0000000000e5');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.archive_shot_list('88880000-0000-0000-0000-0000000000a5', false)$$,
  'the maker restores what they withdrew even after a live edit landed on it (a restore only un-hides)');

SELECT ok(
  (SELECT archived_at IS NULL FROM public.shot_lists WHERE id = '88880000-0000-0000-0000-0000000000a5'),
  'the list is live again');

SELECT lives_ok(
  $$SELECT public.archive_edit('88880000-0000-0000-0000-0000000000e5', false)$$,
  'the maker restores a withdrawn EDIT that a live edit now continues');

SELECT ok(
  (SELECT archived_at IS NULL FROM public.edits WHERE id = '88880000-0000-0000-0000-0000000000e5'),
  'the edit is live again');


-- ── 26-27: the ACTIVE list is nobody's to archive (D4) ───────────────────

INSERT INTO public.shot_lists (id, project_id, title, version)
VALUES ('88880000-0000-0000-0000-0000000000a6', 'aaaa1111-0000-0000-0000-000000000001', 'Active candidate', 1),
       ('88880000-0000-0000-0000-0000000000a7', 'aaaa1111-0000-0000-0000-000000000001', 'Manager will archive', 1),
       ('88880000-0000-0000-0000-0000000000a9', 'aaaa1111-0000-0000-0000-000000000001', 'Seat test', 1),
       ('88880000-0000-0000-0000-000000000a12', 'aaaa1111-0000-0000-0000-000000000001', 'Seat restore test', 1),
       ('88880000-0000-0000-0000-0000000000b0', 'aaaa1111-0000-0000-0000-000000000001', 'Edits list', 1),
       ('88880000-0000-0000-0000-0000000000b1', 'aaaa1111-0000-0000-0000-000000000001', 'Shared chain list', 1);

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.set_active_shot_list('aaaa1111-0000-0000-0000-000000000001', '88880000-0000-0000-0000-0000000000a6')$$,
  'the project manager makes the member''s untouched list active');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.archive_shot_list('88880000-0000-0000-0000-0000000000a6')$$,
  'P0001', 'the active shot list cannot be archived — make another list active first',
  'its maker cannot withdraw the ACTIVE list (D4 holds on the maker path too)');


-- ── 28-29: what a manager archived is the manager's to restore ───────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.archive_shot_list('88880000-0000-0000-0000-0000000000a7')$$,
  'the project manager archives the member''s list');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.archive_shot_list('88880000-0000-0000-0000-0000000000a7', false)$$,
  '42501', 'only a project manager or a workspace admin can archive or restore a shot list',
  'its maker cannot restore what a manager archived');


-- ── 30-32: with no signed-in user the maker is what was sent ─────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

INSERT INTO public.shot_lists (id, project_id, title, version)
VALUES ('88880000-0000-0000-0000-0000000000a8', 'aaaa1111-0000-0000-0000-000000000001', 'Maker-less', 1);
INSERT INTO public.shot_lists (id, project_id, title, version, created_by)
VALUES ('88880000-0000-0000-0000-000000000a11', 'aaaa1111-0000-0000-0000-000000000001', 'Imported', 1,
        'dddddddd-dddd-dddd-dddd-dddddddddddd');

SELECT is(
  (SELECT created_by FROM public.shot_lists WHERE id = '88880000-0000-0000-0000-0000000000a8'),
  NULL::uuid,
  'an insert with no signed-in user keeps the NULL maker it sent (the backfill''s)');

SELECT is(
  (SELECT created_by FROM public.shot_lists WHERE id = '88880000-0000-0000-0000-000000000a11'),
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  'and keeps a maker it named (an import''s), where a signed-in insert would not');

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.archive_shot_list('88880000-0000-0000-0000-0000000000a8')$$,
  '42501', 'only a project manager or a workspace admin can archive or restore a shot list',
  'nobody withdraws a list without a maker');


-- ── 33-34: the manager path is unchanged (as e) ──────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.archive_shot_list('88880000-0000-0000-0000-0000000000a4')$$,
  'the project manager still archives a TOUCHED (Saved) list');

SELECT ok(
  (SELECT archived_by = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid
     FROM public.shot_lists WHERE id = '88880000-0000-0000-0000-0000000000a4'),
  'archived by the manager, not "withdrawn" (archived_by is not its maker)');


-- ── 35-47: edits ─────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- The client SENDS user_e as the edit's maker.
INSERT INTO public.edits (id, project_id, shot_list_id, title, version, created_by)
VALUES ('88880000-0000-0000-0000-0000000000e1', 'aaaa1111-0000-0000-0000-000000000001',
        '88880000-0000-0000-0000-0000000000b0', 'Cut', 1, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');

SELECT is(
  (SELECT created_by FROM public.edits WHERE id = '88880000-0000-0000-0000-0000000000e1'),
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  'a signed-in edit insert is stamped with its caller as the maker, whatever it sent');

UPDATE public.edits SET created_by = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', title = 'Cut renamed'
 WHERE id = '88880000-0000-0000-0000-0000000000e1';

SELECT is(
  (SELECT created_by::text || ' | ' || title FROM public.edits WHERE id = '88880000-0000-0000-0000-0000000000e1'),
  'dddddddd-dddd-dddd-dddd-dddddddddddd | Cut renamed',
  'an edit UPDATE that reached the row did not change its maker');

SELECT lives_ok(
  $$SELECT public.archive_edit('88880000-0000-0000-0000-0000000000e1')$$,
  'a member withdraws an untouched edit they made');

SELECT ok(
  (SELECT archived_by = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid
     FROM public.edits WHERE id = '88880000-0000-0000-0000-0000000000e1'),
  'set aside by its maker');

SELECT lives_ok(
  $$SELECT public.archive_edit('88880000-0000-0000-0000-0000000000e1', false)$$,
  'and restores it');

SELECT ok(
  (SELECT archived_at IS NULL FROM public.edits WHERE id = '88880000-0000-0000-0000-0000000000e1'),
  'the edit is live again');

-- e2 continues e1 (the chain, D6); e6 starts a second list's chain.
INSERT INTO public.edits (id, project_id, shot_list_id, title, version, parent_edit_id)
VALUES ('88880000-0000-0000-0000-0000000000e2', 'aaaa1111-0000-0000-0000-000000000001',
        '88880000-0000-0000-0000-0000000000b0', 'Cut renamed', 2, '88880000-0000-0000-0000-0000000000e1'),
       ('88880000-0000-0000-0000-0000000000e6', 'aaaa1111-0000-0000-0000-000000000001',
        '88880000-0000-0000-0000-0000000000b1', 'Shared', 1, NULL);

SELECT throws_ok(
  $$SELECT public.archive_edit('88880000-0000-0000-0000-0000000000e1')$$,
  '42501', 'only an untouched edit you made can be withdrawn — a project manager or a workspace admin can archive it',
  'an edit the maker''s own live edit continues cannot be withdrawn');

UPDATE public.edits SET snapshot = '{"kind":"edit"}'::jsonb
 WHERE id = '88880000-0000-0000-0000-0000000000e2';

SELECT throws_ok(
  $$SELECT public.archive_edit('88880000-0000-0000-0000-0000000000e2')$$,
  '42501', 'only an untouched edit you made can be withdrawn — a project manager or a workspace admin can archive it',
  'a Saved edit cannot be withdrawn by its maker');

-- The reviewer continues d's e6, and makes an edit of their own on their list.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
INSERT INTO public.edits (id, project_id, shot_list_id, title, version, parent_edit_id)
VALUES ('88880000-0000-0000-0000-0000000000e7', 'aaaa1111-0000-0000-0000-000000000001',
        '88880000-0000-0000-0000-0000000000b1', 'Shared', 2, '88880000-0000-0000-0000-0000000000e6'),
       ('88880000-0000-0000-0000-0000000000e8', 'aaaa1111-0000-0000-0000-000000000001',
        '88880000-0000-0000-0000-0000000000a3', 'Reviewer cut', 1, NULL);

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.archive_edit('88880000-0000-0000-0000-0000000000e6')$$,
  '42501', 'only an untouched edit you made can be withdrawn — a project manager or a workspace admin can archive it',
  'nor an edit SOMEONE ELSE''s live edit continues');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- e2 is the member's (and Saved): the seat check answers first.
SELECT throws_ok(
  $$SELECT public.archive_edit('88880000-0000-0000-0000-0000000000e2')$$,
  '42501', 'only a project manager or a workspace admin can archive or restore an edit',
  'the reviewer cannot archive the member''s edit (the maker check comes before "untouched")');

SELECT lives_ok(
  $$SELECT public.archive_edit('88880000-0000-0000-0000-0000000000e8')$$,
  'a reviewer withdraws an untouched edit they made');

SELECT lives_ok(
  $$SELECT public.archive_edit('88880000-0000-0000-0000-0000000000e8', false)$$,
  'and restores it');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.archive_edit('88880000-0000-0000-0000-0000000000e2')$$,
  'the project manager still archives a TOUCHED (Saved) edit');


-- ── 48-52: what a manager archived; a LIVE row's restore (reviews R2, R3) ─

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.archive_edit('88880000-0000-0000-0000-0000000000e2', false)$$,
  '42501', 'only a project manager or a workspace admin can archive or restore an edit',
  'the maker cannot restore an edit a manager archived');

-- a4 is the member's Saved list the manager archived (33): the seat sentence
-- answers before "Saved" does, as for edits (review R3).
SELECT throws_ok(
  $$SELECT public.archive_shot_list('88880000-0000-0000-0000-0000000000a4', false)$$,
  '42501', 'only a project manager or a workspace admin can archive or restore a shot list',
  'nor a Saved list a manager archived (the seat sentence, not the Saved one)');

-- A maker's restore of a LIVE row is the no-op it always was, Saved or not.
INSERT INTO public.shot_lists (id, project_id, title, version)
VALUES ('88880000-0000-0000-0000-000000000a15', 'aaaa1111-0000-0000-0000-000000000001', 'Live saved', 1);
UPDATE public.shot_lists SET snapshot = '{"kind":"shot_list"}'::jsonb
 WHERE id = '88880000-0000-0000-0000-000000000a15';
INSERT INTO public.edits (id, project_id, shot_list_id, title, version, snapshot)
VALUES ('88880000-0000-0000-0000-000000000e12', 'aaaa1111-0000-0000-0000-000000000001',
        '88880000-0000-0000-0000-000000000a15', 'Live cut', 1, '{"kind":"edit"}'::jsonb);

SELECT lives_ok(
  $$SELECT public.archive_shot_list('88880000-0000-0000-0000-000000000a15', false)$$,
  'the maker''s restore of a LIVE Saved list is a no-op, not a refusal');

SELECT ok(
  (SELECT archived_at IS NULL AND snapshot = '{"kind":"shot_list"}'::jsonb
     FROM public.shot_lists WHERE id = '88880000-0000-0000-0000-000000000a15'),
  'and changes nothing');

SELECT lives_ok(
  $$SELECT public.archive_edit('88880000-0000-0000-0000-000000000e12', false)$$,
  'the same for a LIVE Saved edit');


-- ── 53-55: a manager who archived their own Saved rows, then lost the seat
-- (review R2): the maker path restores only what is not Saved — what every
-- withdraw left — so a Saved list or edit they archived as manager stays a
-- manager's to restore; an unsaved one they archived is theirs again.

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

INSERT INTO public.shot_lists (id, project_id, title, version)
VALUES ('88880000-0000-0000-0000-000000000a13', 'aaaa1111-0000-0000-0000-000000000001', 'Manager saved', 1),
       ('88880000-0000-0000-0000-000000000a14', 'aaaa1111-0000-0000-0000-000000000001', 'Manager unsaved', 1);
UPDATE public.shot_lists SET snapshot = '{"kind":"shot_list"}'::jsonb
 WHERE id = '88880000-0000-0000-0000-000000000a13';
INSERT INTO public.edits (id, project_id, shot_list_id, title, version)
VALUES ('88880000-0000-0000-0000-000000000e11', 'aaaa1111-0000-0000-0000-000000000001',
        '88880000-0000-0000-0000-000000000a13', 'Manager cut', 1);
UPDATE public.edits SET snapshot = '{"kind":"edit"}'::jsonb
 WHERE id = '88880000-0000-0000-0000-000000000e11';
DO $$ BEGIN
  PERFORM public.archive_edit('88880000-0000-0000-0000-000000000e11');
  PERFORM public.archive_shot_list('88880000-0000-0000-0000-000000000a13');
  PERFORM public.archive_shot_list('88880000-0000-0000-0000-000000000a14');
END $$;

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
UPDATE public.project_members SET project_role = 'member'
 WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'
   AND user_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.archive_shot_list('88880000-0000-0000-0000-000000000a13', false)$$,
  '42501', 'a Saved shot list you archived can be restored only by a project manager or a workspace admin',
  'demoted to member, the maker cannot restore a Saved list they archived as manager');

SELECT throws_ok(
  $$SELECT public.archive_edit('88880000-0000-0000-0000-000000000e11', false)$$,
  '42501', 'a Saved edit you archived can be restored only by a project manager or a workspace admin',
  'nor a Saved edit');

SELECT lives_ok(
  $$SELECT public.archive_shot_list('88880000-0000-0000-0000-000000000a14', false)$$,
  'but restores an unsaved list they archived (the maker path: what a withdraw leaves)');


-- ── 56: the read gate comes BEFORE the maker path ────────────────────────
-- A private project (0072) is seen by its creator and workspace admins only
-- (0082's passes_project_privacy). user_d is SEATED on it as a member, so
-- can_edit_shot_lists says yes — the only arm left to refuse is privacy. The
-- list is d's own and untouched, written by postgres (no signed-in user, so
-- the pin keeps the maker it was sent): the same list on project_a is
-- withdrawable (7).

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

INSERT INTO public.projects (id, workspace_id, title, is_private, created_by)
VALUES ('aaaa1111-0000-0000-0000-000000000088', '11111111-1111-1111-1111-111111111111',
        'Private P88', true, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role)
VALUES ('aaaa1111-0000-0000-0000-000000000088', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;
INSERT INTO public.shot_lists (id, workspace_id, project_id, title, version, created_by)
VALUES ('88880000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111',
        'aaaa1111-0000-0000-0000-000000000088', 'Private draft', 1,
        'dddddddd-dddd-dddd-dddd-dddddddddddd');

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.archive_shot_list('88880000-0000-0000-0000-0000000000c1')$$,
  'P0002', 'shot list not found',
  'a maker cannot withdraw their list on a private project they cannot see (passes_project_privacy first)');


-- ── 57-59: a maker who lost their seat loses the maker path ──────────────

SELECT lives_ok(
  $$SELECT public.archive_shot_list('88880000-0000-0000-0000-000000000a12')$$,
  'SETUP: while seated, the member withdraws a list they made');

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
  $$SELECT public.archive_shot_list('88880000-0000-0000-0000-0000000000a9')$$,
  '42501', 'only a project manager or a workspace admin can archive or restore a shot list',
  'a maker who lost their seat on the staffed project cannot withdraw their untouched list');

SELECT throws_ok(
  $$SELECT public.archive_shot_list('88880000-0000-0000-0000-000000000a12', false)$$,
  '42501', 'only a project manager or a workspace admin can archive or restore a shot list',
  'nor restore the list they withdrew while seated');

SELECT * FROM finish();
ROLLBACK;
