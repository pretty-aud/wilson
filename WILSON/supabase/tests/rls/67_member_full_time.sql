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

-- 🚨 The first version of this assertion was INVALID SQL and failed the whole
-- pgTAP job on every run from 2026-08-11 (cfe2cbd) to 2026-08-12. It read:
--
--     FROM information_schema.routines r
--     JOIN LATERAL unnest(string_to_array(pg_get_function_result(p.oid), ',')) ...
--     JOIN pg_proc p ON p.proname = r.routine_name ...
--
-- LATERAL may only reference tables that appear EARLIER in the FROM list, and
-- `p` was joined after it — `42P01: missing FROM-clause entry for table "p"`.
-- Postgres raises that at parse time, so the error aborts the transaction and
-- takes the whole file down with it: assertions 7-14 below never ran once.
--
-- It could never have passed on any database. It shipped because pgTAP needs
-- Docker to run locally, this machine has none, and "1440 tests green" in that
-- commit was VITEST — a different suite that never touches these files. A
-- pgTAP test is only verified by CI or by a local Supabase, never by vitest.
--
-- information_schema.routines contributed nothing here but the scope hazard,
-- so the fix drops it and starts from pg_proc.
SELECT is(
  (SELECT count(*)::int
     FROM pg_proc p
     JOIN LATERAL unnest(string_to_array(pg_get_function_result(p.oid), ',')) AS col(def) ON true
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = 'workspace_directory'
      AND col.def ILIKE '%is_full_time%'),
  1,
  'workspace_directory() RETURNS TABLE names is_full_time'
);

-- ── 3. the guard ────────────────────────────────────────────────────────────
-- Fixtures: one workspace, an admin, a manager and a plain member.
SELECT * FROM tests.rls_setup();

INSERT INTO public.workspaces (id, name, slug)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'FT Test Co', 'ft-test')
ON CONFLICT (id) DO NOTHING;

-- 🚨 THIRD BUG (2026-08-12). This insert originally named only (id, email).
-- Hosted Postgres tolerates that — `id` is the sole NOT NULL column with no
-- default there, MEASURED on wilson-dev — but CI runs a LOCAL Supabase whose
-- auth image carries its own constraints, and every other file in this suite
-- writes the full eleven-column shape: tests.rls_setup() itself, and
-- 14_ws_members_self.sql (same table, green since Session 3). 67 was the only
-- outlier. Conform to the proven pattern rather than the minimum that happens
-- to satisfy one server.
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'ft-admin@example.test',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'ft-mgr@example.test',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now()),
  ('33333333-3333-3333-3333-333333333333', 'ft-user@example.test',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now())
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

-- 🚨 SECOND BUG, found 2026-08-12 behind the first one. This file originally
-- called `tests.authenticate_as(user, workspace, role)` here and twice below.
-- **That function has never existed.** The tests schema contains exactly three
-- helpers — `tests.login_as(uuid, uuid)`, `tests.logout()`, `tests.rls_setup()`
-- — and no other file in the 67-file suite calls `authenticate_as`. It was
-- invented, so every call was `42883: function does not exist`.
--
-- And `tests.login_as` is NOT the substitute: it sets app_metadata with
-- workspace_id ONLY, no app_role. Both policies these assertions depend on
-- gate on `current_app_role()` —
--   ws_members_manager_write  USING current_app_role() = 'manager'
--   ws_members_admin_write    USING current_app_role() = 'admin'
-- — so login_as would silently fail the manager and admin arms while the
-- member arm passed, which is a worse failure than a missing function.
--
-- So this uses the explicit claim block, which is what 14_ws_members_self.sql
-- (same table, same guard, passing since Session 3) has always done.
SELECT set_config('request.jwt.claims',
  jsonb_build_object(
    'sub',  '33333333-3333-3333-3333-333333333333',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'workspace_id', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      'app_role',     'user'))::text,
  true);
SELECT set_config('role', 'authenticated', true);

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
SELECT set_config('request.jwt.claims',
  jsonb_build_object(
    'sub',  '22222222-2222-2222-2222-222222222222',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'workspace_id', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      'app_role',     'manager'))::text,
  true);
SELECT set_config('role', 'authenticated', true);

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
SELECT set_config('request.jwt.claims',
  jsonb_build_object(
    'sub',  '11111111-1111-1111-1111-111111111111',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'workspace_id', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      'app_role',     'admin'))::text,
  true);
SELECT set_config('role', 'authenticated', true);

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
