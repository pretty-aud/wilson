-- =============================================================================
-- 82_private_project_definers.sql — migration 0082: the private-project arm
-- (0072) restated for the two SECURITY DEFINER bodies that bypassed it
-- (merge review round 1, A-R1-01) and added to the two milestone WRITE
-- policies that had no parent hop (merge review round 2, A-R2-03).
--
-- What this pins:
--   * Structure: passes_project_privacy exists, is SECURITY DEFINER, and no
--     client role may execute it; milestones_trash_index and fn_trash_authz
--     each call it exactly once, comments stripped; milestones_insert and
--     milestones_update WITH CHECK both hop to the parent project.
--   * A private project's trash is the creator's and an admin's to READ
--     (milestones_trash_index) and to RESTORE / TRASH (fn_trash_authz, so
--     restore_soft_deleted and soft_delete_row) — and NOBODY else's, even
--     though can_write_project says yes to every one of them: the project is
--     unstaffed, so can_write_project is TRUE for the plain member, and the
--     second manager is a manager. Before 0082 the two MILESTONE refusals in
--     each section were allowed calls; the PROJECTS one was refused by 0014's
--     admin-only trigger, but only AFTER fn_trash_authz had admitted it (a
--     different message from a later guard) — 0082 refuses it at the gate.
--   * A private project's key dates are the creator's and an admin's to
--     WRITE: a second manager with the id can neither INSERT into it nor move
--     a key date INTO it (the two WITH CHECKs' new hop), with the same INSERT
--     on the public project as the control.
--   * THE CONTROL: the same plain member, on the PUBLIC project, reads its
--     trash and restores from it. Without that the refusals could be any
--     refusal at all; with it they are the privacy arm and nothing else.
--   * The projects row itself round-trips for the ADMIN alone: 0014's trigger
--     refuses every non-admin trash or restore of a project, creator
--     included, and the creator's refusal comes with the TRIGGER's message —
--     which proves fn_trash_authz's arm had admitted them (round 2, A-R2-01:
--     round 1 had the creator do the round trip and it can never pass).
--   * 0014's machinery still round-trips after 0082 retyped fn_trash_authz
--     (suite 71 probe 22's shape: the 0059 lesson).
--
-- Postgres-side reads are ALWAYS scoped to the fixture rows — dev carries
-- real projects (S33, 439f702).
-- =============================================================================

BEGIN;

SELECT plan(31);

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


-- ── 1-5: structure ────────────────────────────────────────────────────────
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

-- 0082 §3b: the two WRITE policies hop to the parent in their WITH CHECK.
-- pg_policies deparses the expression, so the hop shows as the table's name;
-- probes 20-23 below are the behaviour this structure is for.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'milestones'
      AND policyname IN ('milestones_insert', 'milestones_update')
      AND with_check LIKE '%projects%'),
  2, 'milestones_insert and milestones_update WITH CHECK both hop to the parent project');


-- ── 6: the admin seeds THE CONTROL — a trashed key date on the PUBLIC project
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


-- ── 7-11: the manager makes a private project and trashes a key date on it ─

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


-- ── 12-16: a plain member — can_write_project TRUE (unstaffed), and refused ─
-- The two milestone refusals here were ALLOWED calls before 0082: the id is
-- all the caller needs, and 0018's workspace channel hands it out. The
-- projects one (14) was refused before 0082 as well — by 0014's admin-only
-- trigger, AFTER fn_trash_authz had admitted the call; since 0082 it is the
-- gate that refuses, with the gate's message.

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
  'a plain member cannot trash a private project they cannot see — refused at the gate, not by 0014''s trigger');

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


-- ── 17-23: a manager who is NOT the creator — the escalation 0082 closes ────
-- can_write_project is true for every manager, so before 0082 this caller
-- could restore into a private project they cannot SELECT (17-18), and could
-- write into it through the plain policies (20-23: A-R2-03 — supabase-js's
-- .insert() without .select() sends Prefer: return=minimal, so no SELECT
-- policy ever looked at the row). The project trash (19) was the trigger's
-- refusal before, and is the gate's now.

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

-- 🚨 workspace_id is SENT, not left to the populate trigger: that trigger
-- runs as the caller and reads projects under RLS, so on a private project it
-- would fill nothing and the row would fail the WORKSPACE arm — a refusal for
-- the wrong reason, which is what an attacker's client never hands us. With
-- the column supplied, the only arm that can refuse is the new hop.
SELECT throws_ok($$
  INSERT INTO public.milestones (id, workspace_id, project_id, title, date)
  VALUES ('82820000-0000-0000-0000-0000000000e1',
          '11111111-1111-1111-1111-111111111111',
          'aaaa1111-0000-0000-0000-000000000082', 'Intruder', '2026-12-21')
$$, '42501', NULL,
  'another manager cannot place a key date INTO a private project (milestones_insert''s new hop)');

SELECT lives_ok($$
  INSERT INTO public.milestones (id, workspace_id, project_id, title, date)
  VALUES ('82820000-0000-0000-0000-0000000000e2',
          '11111111-1111-1111-1111-111111111111',
          'aaaa1111-0000-0000-0000-000000000001', 'Second manager, public', '2026-12-22')
$$, 'CONTROL: the same INSERT into the PUBLIC project lives — workspace, membership and write gate all say yes');

SELECT throws_ok($$
  UPDATE public.milestones
     SET project_id = 'aaaa1111-0000-0000-0000-000000000082'
   WHERE id = '82820000-0000-0000-0000-0000000000e2'
$$, '42501', NULL,
  'nor move an existing key date INTO it (milestones_update''s WITH CHECK gained the hop)');

-- PRESENCE CONTROL for the refused move: the row is where it was, on the
-- public project, and the refusal was of a row this caller can see.
SELECT is(
  (SELECT count(*)::int FROM public.milestones
    WHERE id = '82820000-0000-0000-0000-0000000000e2'
      AND project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  1, 'PRESENCE CONTROL: the key date stays on the public project after the refused move');


-- ── 24-25: the admin keeps the escape hatch, in both directions ────────────

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


-- ── 26: the creator is refused the project round trip — by the TRIGGER ──────
-- 0014's fn_soft_delete_stamp refuses every non-admin trash or restore of a
-- projects row, creator included (suite 19 probe 21 pins it for a manager).
-- The message is the point: fn_trash_authz runs FIRST, and had its privacy
-- arm refused the creator the message would be the gate's ('not allowed to
-- soft-delete or restore this row', probes 14 and 19). The trigger's message
-- therefore proves the arm admits the project's creator — the case 0082's
-- header says the arm must not break — before 0014 has its own say.

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

SELECT throws_ok(
  $$SELECT public.soft_delete_row('projects', 'aaaa1111-0000-0000-0000-000000000082')$$,
  'only workspace admins can delete or restore projects',
  'CONTROL: the creator passes the privacy arm and is refused by 0014''s admin-only trigger, in the trigger''s words');


-- ── 27-30: the ADMIN trashes and restores the private project whole ────────
-- The arm asks whether the project is the caller's to see, not whether it is
-- live: an admin's restore of a TRASHED private project passes it (probe 29),
-- so the escape hatch works in both directions on the projects row as well.

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

SELECT ok(
  public.soft_delete_row('projects', 'aaaa1111-0000-0000-0000-000000000082'),
  'the workspace admin trashes the private project whole');

SELECT is(
  (SELECT count(*)::int FROM public.projects
    WHERE id = 'aaaa1111-0000-0000-0000-000000000082'),
  0, 'a trashed private project leaves the admin''s list (projects_select filters deleted_at)');

-- Separate statements, for the reason probe 25 records.
SELECT ok(
  public.restore_soft_deleted('projects', 'aaaa1111-0000-0000-0000-000000000082'),
  'the workspace admin restores the trashed private project — the arm does not require the project to be live');

SELECT is(
  (SELECT count(*)::int FROM public.projects
    WHERE id = 'aaaa1111-0000-0000-0000-000000000082'),
  1, 'and it is back in the list');


-- ── 31: 0014's ORIGINAL tables still round-trip after 0082 retyped the gate ─
-- 🚨 0059 dropped a guard's clauses with a CREATE OR REPLACE and it cost a
-- live privilege escalation. 0082 replaces fn_trash_authz to add one arm;
-- this is the cross-check that the eight names and both write gates survived
-- in the function that actually runs, not just in the file that was written
-- (suite 71 probe 22's shape).

INSERT INTO public.assets (id, project_id, name)
VALUES ('82820000-0000-0000-0000-0000000000d1',
        'aaaa1111-0000-0000-0000-000000000001', 'Still soft-deletable');

-- Separate statements, for the reason probe 25 records.
SELECT public.soft_delete_row('assets', '82820000-0000-0000-0000-0000000000d1');

SELECT ok(
  public.restore_soft_deleted('assets', '82820000-0000-0000-0000-0000000000d1'),
  'assets still round-trip through the trash after 0082 replaced fn_trash_authz');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
