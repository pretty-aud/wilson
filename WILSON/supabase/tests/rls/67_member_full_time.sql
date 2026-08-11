-- =============================================================================
-- 67_member_full_time.sql  (Session 43, migration 0059)
--
-- workspace_members.is_full_time routes a person to one of two rate cards:
-- internal (salary-derived) or general (industry-standard day rates). Three
-- things have to hold, and the third is the one with teeth:
--
--   1. the column exists with the right type and default
--   2. workspace_directory() RETURNS it — the RPC has an explicit column list,
--      so a column it does not name is invisible to every client
--   3. a member cannot set their OWN flag, and a manager cannot set anyone's —
--      it decides which cost model someone is billed under
-- =============================================================================

BEGIN;
SELECT plan(14);

-- ── 1. the column ───────────────────────────────────────────────────────────
SELECT has_column('public', 'workspace_members', 'is_full_time',
  'workspace_members.is_full_time exists');
SELECT col_type_is('public', 'workspace_members', 'is_full_time', 'boolean',
  'is_full_time is boolean');
SELECT col_not_null('public', 'workspace_members', 'is_full_time',
  'is_full_time is NOT NULL — a three-state flag would make "unset" mean two things');
SELECT col_default_is('public', 'workspace_members', 'is_full_time', 'false',
  'is_full_time defaults FALSE — existing rows predate the distinction, and '
  'defaulting true would pull every freelancer onto the salary card');

-- ── 2. the RPC actually returns it ──────────────────────────────────────────
-- The failure this catches is silent: the table is correct, the UI is correct,
-- and the value never arrives because the RETURNS TABLE list was not updated.
SELECT has_function('public', 'workspace_directory', ARRAY[]::TEXT[],
  'workspace_directory() exists');

SELECT is(
  (SELECT count(*)::int
     FROM information_schema.routines r
     JOIN LATERAL unnest(string_to_array(pg_get_function_result(p.oid), ',')) AS col(def) ON true
     JOIN pg_proc p ON p.proname = r.routine_name AND p.pronamespace = 'public'::regnamespace
    WHERE r.routine_schema = 'public'
      AND r.routine_name = 'workspace_directory'
      AND col.def ILIKE '%is_full_time%'),
  1,
  'workspace_directory() RETURNS TABLE names is_full_time'
);

-- ── 3. the guard ────────────────────────────────────────────────────────────
-- Fixtures: one workspace, an admin, a manager and a plain member.
SELECT tests.rls_setup();

INSERT INTO public.workspaces (id, name, slug)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'FT Test Co', 'ft-test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'ft-admin@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'ft-mgr@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'ft-user@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members (workspace_id, user_id, username, app_role, is_active)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'ft_admin', 'admin',   true),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222', 'ft_mgr',   'manager', true),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333', 'ft_user',  'user',    true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- Everyone starts false, per the default.
SELECT is(
  (SELECT bool_or(is_full_time) FROM public.workspace_members
    WHERE workspace_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  false,
  'seeded members all start not-full-time'
);

-- 3a. A MEMBER may not flip their own flag.
SELECT tests.authenticate_as('33333333-3333-3333-3333-333333333333',
  'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user');

SELECT throws_ok(
  $$UPDATE public.workspace_members SET is_full_time = true
     WHERE user_id = '33333333-3333-3333-3333-333333333333'$$,
  'self full-time change not allowed',
  'a member cannot make THEMSELVES full-time'
);

-- Control: the same member CAN still edit a profile field, so the test above
-- is proving the guard and not merely a blanket write refusal.
SELECT lives_ok(
  $$UPDATE public.workspace_members SET title = 'Compositor'
     WHERE user_id = '33333333-3333-3333-3333-333333333333'$$,
  'CONTROL: the same member can still edit their own title'
);

-- 3b. A MANAGER may not flip anyone else's.
SELECT tests.authenticate_as('22222222-2222-2222-2222-222222222222',
  'cccccccc-cccc-cccc-cccc-cccccccccccc', 'manager');

SELECT throws_ok(
  $$UPDATE public.workspace_members SET is_full_time = true
     WHERE user_id = '33333333-3333-3333-3333-333333333333'$$,
  'managers may only edit title and department',
  'a manager cannot set another member full-time'
);

SELECT lives_ok(
  $$UPDATE public.workspace_members SET department = 'Post'
     WHERE user_id = '33333333-3333-3333-3333-333333333333'$$,
  'CONTROL: a manager can still edit department'
);

-- 3c. An ADMIN can — this is the tier that owns employment facts.
SELECT tests.authenticate_as('11111111-1111-1111-1111-111111111111',
  'cccccccc-cccc-cccc-cccc-cccccccccccc', 'admin');

SELECT lives_ok(
  $$UPDATE public.workspace_members SET is_full_time = true
     WHERE user_id = '33333333-3333-3333-3333-333333333333'$$,
  'an admin CAN set a member full-time'
);

SELECT is(
  (SELECT is_full_time FROM public.workspace_members
    WHERE user_id = '33333333-3333-3333-3333-333333333333'),
  true,
  'the admin write actually landed — a refused UPDATE matches zero rows and raises nothing'
);

-- And an admin can take it away again (off-boarding to freelance).
SELECT lives_ok(
  $$UPDATE public.workspace_members SET is_full_time = false
     WHERE user_id = '33333333-3333-3333-3333-333333333333'$$,
  'an admin can also clear the flag'
);

SELECT * FROM finish();
ROLLBACK;
