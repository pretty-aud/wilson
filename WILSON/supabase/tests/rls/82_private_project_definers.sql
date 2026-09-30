-- =============================================================================
-- 82_private_project_definers.sql — migration 0082: the private-project arm
-- (0072) restated for the two SECURITY DEFINER bodies that bypassed it
-- (merge review round 1, A-R1-01).
--
-- What this pins:
--   * Structure: passes_project_privacy exists, is SECURITY DEFINER, and no
--     client role may execute it; milestones_trash_index and fn_trash_authz
--     each call it exactly once, comments stripped.
--   * A private project's trash is the creator's and an admin's to READ
--     (milestones_trash_index) and to RESTORE / TRASH (fn_trash_authz, so
--     restore_soft_deleted and soft_delete_row) — and NOBODY else's, even
--     though can_write_project says yes to every one of them: the project is
--     unstaffed, so can_write_project is TRUE for the plain member, and the
--     second manager is a manager. Before 0082 every refusal below was an
--     allowed call.
--   * THE CONTROL: the same plain member, on the PUBLIC project, reads its
--     trash and restores from it. Without that the refusals could be any
--     refusal at all; with it they are the privacy arm and nothing else.
--   * The creator can still trash and restore their own private project
--     whole (the case the arm must not break — 0082's header).
--   * 0014's machinery still round-trips after 0082 retyped fn_trash_authz
--     (suite 71 probe 22's shape: the 0059 lesson).
--
-- Postgres-side reads are ALWAYS scoped to the fixture rows — dev carries
-- real projects (S33, 439f702).
-- =============================================================================

BEGIN;

SELECT plan(25);

SELECT * FROM tests.rls_setup();

-- user_c: plain 'user'-role ACTIVE member of workspace A (suite 80's shape).
-- user_d: 'manager' of workspace A — the private project's creator.
-- user_e: a SECOND 'manager' of workspace A, who is not the creator — the
--         case can_write_project admits and projects_select refuses.
-- No project_members rows anywhere: every project here is UNSTAFFED, so
-- can_write_project is true for user_c as well (0013).
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
  ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','manager','user_d','User D',true),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','manager','user_e','User E',true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;


-- ── 1-4: structure ────────────────────────────────────────────────────────
-- Expressed over pg_proc rather than has_function(): the hosted shim's
-- overloads take text[] where pgTAP's take name[], and a probe that resolves
-- differently on the two runners is not a probe.

SELECT ok(
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'passes_project_privacy' AND p.prosecdef),
  'passes_project_privacy exists and is SECURITY DEFINER');

-- Comments stripped before counting (0077 §3c): a `-- passes_project_privacy`
-- line must not satisfy this, and a second live mention must not either.
SELECT is(
  (SELECT (length(b) - length(replace(b, 'passes_project_privacy(', ''))) / length('passes_project_privacy(')
     FROM (SELECT regexp_replace(regexp_replace(
                    pg_get_functiondef('public.milestones_trash_index(uuid)'::regprocedure),
                    '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g') AS b) s),
  1, 'milestones_trash_index calls passes_project_privacy exactly once, comments stripped');

SELECT is(
  (SELECT (length(b) - length(replace(b, 'passes_project_privacy(', ''))) / length('passes_project_privacy(')
     FROM (SELECT regexp_replace(regexp_replace(
                    pg_get_functiondef('public.fn_trash_authz(text, uuid)'::regprocedure),
                    '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g') AS b) s),
  1, 'fn_trash_authz calls passes_project_privacy exactly once, comments stripped');

-- The migration-0011 privilege trap, for the helper: a client that could call
-- it directly could probe whether an id is a private project it cannot see.
SELECT ok(
  NOT (
    has_function_privilege('anon', 'public.passes_project_privacy(uuid)', 'EXECUTE') OR
    has_function_privilege('authenticated', 'public.passes_project_privacy(uuid)', 'EXECUTE') OR
    has_function_privilege('authenticated', 'public.fn_trash_authz(text, uuid)', 'EXECUTE')
  ),
  'no client role executes passes_project_privacy or fn_trash_authz directly');


-- ── 5: the admin seeds THE CONTROL — a trashed key date on the PUBLIC project
-- Claims in the JWT's own shape (suite 59): current_app_role() reads
-- app_metadata.app_role from the claims, not from workspace_members.

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

INSERT INTO public.milestones (id, project_id, title, date)
VALUES ('82820000-0000-0000-0000-0000000000b1',
        'aaaa1111-0000-0000-0000-000000000001', 'Public control', '2026-10-10');

SELECT ok(
  public.soft_delete_row('milestones', '82820000-0000-0000-0000-0000000000b1'),
  'CONTROL SETUP: the admin trashes a key date on the PUBLIC project');


-- ── 6-10: the manager makes a private project and trashes a key date on it ─

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok($$
  INSERT INTO public.projects (id, workspace_id, title, is_private)
  VALUES ('aaaa1111-0000-0000-0000-000000000082',
          '11111111-1111-1111-1111-111111111111', 'Private P', true)
$$, 'a manager can insert a private project (created_by stamped by fn_audit_touch)');

SELECT lives_ok($$
  INSERT INTO public.milestones (id, project_id, title, date)
  VALUES ('82820000-0000-0000-0000-0000000000a1',
          'aaaa1111-0000-0000-0000-000000000082', 'Private wrap', '2026-12-20')
$$, 'the creator places a key date on their private project');

-- PRESENCE CONTROL (suite 71 probe 11's reasoning): the refusals below are
-- refusals of a row that exists, not of nothing.
SELECT is(
  (SELECT count(*)::int FROM public.milestones
    WHERE id = '82820000-0000-0000-0000-0000000000a1'),
  1, 'PRESENCE CONTROL: the private key date is visible to its creator while live');

SELECT ok(
  public.soft_delete_row('milestones', '82820000-0000-0000-0000-0000000000a1'),
  'the creator trashes it');

SELECT is(
  (SELECT count(*)::int FROM public.milestones_trash_index(
     'aaaa1111-0000-0000-0000-000000000082')
    WHERE id = '82820000-0000-0000-0000-0000000000a1'),
  1, 'the creator reads their private project''s trash and sees the row');


-- ── 11-15: a plain member — can_write_project TRUE (unstaffed), and refused ─
-- Every one of the three refusals here was an ALLOWED call before 0082: the
-- id is all the caller needs, and 0018's workspace channel hands it out.

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- The message is the workspace refusal's, on purpose (0082's header): the
-- caller is not told that a project they cannot see exists.
SELECT throws_ok(
  $$SELECT * FROM public.milestones_trash_index('aaaa1111-0000-0000-0000-000000000082')$$,
  'not allowed to read this project''s trash',
  'a plain member cannot list a private project''s trash (the read gate''s new arm)');

SELECT throws_ok(
  $$SELECT public.restore_soft_deleted('milestones', '82820000-0000-0000-0000-0000000000a1')$$,
  'not allowed to soft-delete or restore this row',
  'a plain member cannot restore INTO a private project (fn_trash_authz''s new arm)');

SELECT throws_ok(
  $$SELECT public.soft_delete_row('projects', 'aaaa1111-0000-0000-0000-000000000082')$$,
  'not allowed to soft-delete or restore this row',
  'a plain member cannot trash a private project they cannot see');

-- THE CONTROL, same caller, the PUBLIC project: the write gate alone admits
-- them (unstaffed → can_write_project), so the refusals above are the privacy
-- arm and not the workspace, membership or write gate.
SELECT is(
  (SELECT count(*)::int FROM public.milestones_trash_index(
     'aaaa1111-0000-0000-0000-000000000001')
    WHERE id = '82820000-0000-0000-0000-0000000000b1'),
  1, 'CONTROL: the same member reads the PUBLIC project''s trash and sees the admin''s row');

SELECT ok(
  public.restore_soft_deleted('milestones', '82820000-0000-0000-0000-0000000000b1'),
  'CONTROL: and restores from it — the write gate says yes to this member');


-- ── 16-18: a manager who is NOT the creator — the escalation 0082 closes ────
-- can_write_project is true for every manager, so before 0082 this caller
-- could restore into, and trash, a private project they cannot SELECT.

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT * FROM public.milestones_trash_index('aaaa1111-0000-0000-0000-000000000082')$$,
  'not allowed to read this project''s trash',
  'another manager cannot list a private project''s trash');

SELECT throws_ok(
  $$SELECT public.restore_soft_deleted('milestones', '82820000-0000-0000-0000-0000000000a1')$$,
  'not allowed to soft-delete or restore this row',
  'another manager cannot restore into a private project');

SELECT throws_ok(
  $$SELECT public.soft_delete_row('projects', 'aaaa1111-0000-0000-0000-000000000082')$$,
  'not allowed to soft-delete or restore this row',
  'another manager cannot trash a private project whole');


-- ── 19-20: the admin keeps the escape hatch, in both directions ────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.milestones_trash_index(
     'aaaa1111-0000-0000-0000-000000000082')
    WHERE id = '82820000-0000-0000-0000-0000000000a1'),
  1, 'the workspace admin reads the private project''s trash');

-- 🚨 THE RESTORE AND THE READ OF ITS EFFECT ARE SEPARATE STATEMENTS (suite 71
-- probe 16): a scalar subquery in the same statement reads the snapshot taken
-- before that statement's own write.
SELECT public.restore_soft_deleted('milestones', '82820000-0000-0000-0000-0000000000a1');

SELECT is(
  (SELECT count(*)::int FROM public.milestones
    WHERE id = '82820000-0000-0000-0000-0000000000a1'),
  1, 'the workspace admin restores into the private project, and the key date is back');


-- ── 21-24: the creator can still trash and restore their private project ───
-- The case the arm must not break (0082's header): the privacy arm asks
-- whether the project is the caller's to see, not whether it is live.

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT ok(
  public.soft_delete_row('projects', 'aaaa1111-0000-0000-0000-000000000082'),
  'the creator trashes their own private project');

SELECT is(
  (SELECT count(*)::int FROM public.projects
    WHERE id = 'aaaa1111-0000-0000-0000-000000000082'),
  0, 'a trashed private project leaves its creator''s list (projects_select filters deleted_at)');

SELECT ok(
  public.restore_soft_deleted('projects', 'aaaa1111-0000-0000-0000-000000000082'),
  'the creator restores their own trashed private project — the arm does not require the project to be live');

SELECT is(
  (SELECT count(*)::int FROM public.projects
    WHERE id = 'aaaa1111-0000-0000-0000-000000000082'),
  1, 'and it is back in their list');


-- ── 25: 0014's ORIGINAL tables still round-trip after 0082 retyped the gate ─
-- 🚨 0059 dropped a guard's clauses with a CREATE OR REPLACE and it cost a
-- live privilege escalation. 0082 replaces fn_trash_authz to add one arm;
-- this is the cross-check that the eight names and both write gates survived
-- in the function that actually runs, not just in the file that was written
-- (suite 71 probe 22's shape).

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

INSERT INTO public.assets (id, project_id, name)
VALUES ('82820000-0000-0000-0000-0000000000d1',
        'aaaa1111-0000-0000-0000-000000000001', 'Still soft-deletable');

-- Separate statements, for the reason probe 20 records.
SELECT public.soft_delete_row('assets', '82820000-0000-0000-0000-0000000000d1');

SELECT ok(
  public.restore_soft_deleted('assets', '82820000-0000-0000-0000-0000000000d1'),
  'assets still round-trip through the trash after 0082 replaced fn_trash_authz');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
