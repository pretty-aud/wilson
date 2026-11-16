-- =========================================================================
-- 43_budget_lines.sql — Session 24, migration 0037.
--
-- This is the behavioural suite for the whole money layer. Suites 44-47 pin
-- the structure of the other four tables; the access rules are proved here
-- once, against budget_lines, because all five share one gate
-- (can_access_project_money) and one policy shape.
--
-- What it PINS:
--  1. The table exists with RLS enabled AND forced, four policies, no FOR ALL
--     arm  (probes 1-4).
--  2. margin_pct and contingency_pct stay NULLABLE — NULL is how a line
--     inherits the project default, so a NOT NULL here would silently pin
--     every line at 0% and reintroduce Audrey's reported bug one layer down
--     (probes 5-6).
--  3. team_member_id carries NO foreign key, deliberately: on cloud it is a
--     workspace_members.user_id, on Local Server a local team_members.id, and
--     one UI serves both adapters (probe 7).
--  4. workspace_id is stamped by trigger, because no client sends it (8-9).
--  5. THE MONEY GATE. A project reviewer and a project member cannot read,
--     insert or update money; a project manager and a workspace admin can;
--     an admin of a DIFFERENT workspace cannot (probes 10-17).
--  6. anon reaches nothing (probe 18).
-- =========================================================================
BEGIN;

SELECT plan(18);

SELECT * FROM tests.rls_setup();

-- ── Extra fixtures ───────────────────────────────────────────────────────
-- rls_setup gives two workspace ADMINS. The money gate's whole point is what
-- happens to everyone who is not one, so this suite needs ordinary users
-- holding real project seats.
--
--   user_c  app_role 'user', project_a reviewer  -> must be denied
--   user_d  app_role 'user', project_a member    -> must be denied
--   user_e  app_role 'user', project_a MANAGER   -> must be allowed

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now()),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user_d@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now()),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user_e@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111',
   'dddddddd-dddd-dddd-dddd-dddddddddddd', 'user', 'user_d', 'User D', true),
  ('11111111-1111-1111-1111-111111111111',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user', 'user_e', 'User E', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.project_members
  (project_id, user_id, workspace_id, project_role)
VALUES
  ('aaaa1111-0000-0000-0000-000000000001',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1111-0000-0000-0000-000000000001',
   'dddddddd-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1111-0000-0000-0000-000000000001',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   '11111111-1111-1111-1111-111111111111', 'manager')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;


-- ── 1-4: the standing structural block ───────────────────────────────────

SELECT has_table('public'::name, 'budget_lines'::name,
  'budget_lines table exists');

SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.budget_lines'::regclass),
  'budget_lines has RLS enabled and forced');

-- A broad FOR ALL arm ORs with every narrow arm beside it and silently wins.
-- 0029 exists specifically to undo one; this stops another appearing.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'budget_lines' AND cmd = 'ALL'),
  0, 'budget_lines has no FOR ALL policy');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'budget_lines'),
  4, 'budget_lines has exactly four policies (select/insert/update/delete)');


-- ── 5-6: the fallback semantics ──────────────────────────────────────────
-- Expressed as is() over information_schema rather than col_not_null(),
-- because the local shim has no col_not_null and the run would abort.

SELECT is(
  (SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'budget_lines'
      AND column_name = 'margin_pct'),
  'YES',
  'budget_lines.margin_pct is NULLABLE — NULL is how a line inherits the project default');

SELECT is(
  (SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'budget_lines'
      AND column_name = 'contingency_pct'),
  'YES',
  'budget_lines.contingency_pct is NULLABLE — same inheritance rule');


-- ── 7: no FK on team_member_id (adapter parity) ──────────────────────────

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
    WHERE conrelid = 'public.budget_lines'::regclass
      AND contype = 'f'
      AND 'team_member_id' = ANY (
            SELECT a.attname FROM unnest(conkey) k
              JOIN pg_attribute a ON a.attrelid = conrelid AND a.attnum = k)),
  0,
  'budget_lines.team_member_id has no FK — it is a cloud user_id or a local team_members.id depending on adapter');


-- ── 8-9: workspace stamping ──────────────────────────────────────────────

SELECT has_trigger('public', 'budget_lines',
  'trg_budget_lines_populate_workspace',
  'budget_lines stamps workspace_id on insert');

-- Insert as the workspace ADMIN (user_a), sending NO workspace_id — exactly
-- what the adapter does.
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

INSERT INTO public.budget_lines (id, project_id, sheet, label, rate, days)
VALUES ('11110000-0000-0000-0000-00000000ab01',
        'aaaa1111-0000-0000-0000-000000000001', 'crew', 'Animator', 900, 10);

SELECT is(
  (SELECT workspace_id FROM public.budget_lines
    WHERE id = '11110000-0000-0000-0000-00000000ab01'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'workspace_id is stamped from the project, with no client involvement');


-- ── 10: a workspace admin reads money ────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM public.budget_lines
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  1, 'a workspace admin can read the project budget');


-- ── 11-12: a project REVIEWER is denied ──────────────────────────────────

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

SELECT is(
  (SELECT count(*)::int FROM public.budget_lines),
  0, 'a project reviewer sees NO budget lines at all');

SELECT throws_ok(
  $$INSERT INTO public.budget_lines (project_id, sheet, label, rate, days)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'crew', 'sneaky', 1, 1)$$,
  'new row violates row-level security policy for table "budget_lines"',
  'a project reviewer cannot insert a budget line');


-- ── 13-14: a project MEMBER is denied, including silently ────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.budget_lines),
  0, 'a project member sees NO budget lines — team members are not money-cleared');

-- The silent-zero-rows hazard: an RLS-refused UPDATE raises nothing and
-- affects zero rows, so a client checking only for an error concludes the
-- write landed. Prove the row is untouched rather than trusting the absence
-- of an exception.
UPDATE public.budget_lines SET rate = 999999
 WHERE id = '11110000-0000-0000-0000-00000000ab01';

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT rate FROM public.budget_lines
    WHERE id = '11110000-0000-0000-0000-00000000ab01'),
  900::numeric,
  'a project member''s UPDATE raises no error and changes nothing (the silent-zero-rows hazard)');


-- ── 15-16: a project MANAGER is allowed, even as app_role user ───────────

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.budget_lines),
  1, 'a project manager reads the budget even with app_role = user');

SELECT lives_ok(
  $$UPDATE public.budget_lines SET rate = 950
     WHERE id = '11110000-0000-0000-0000-00000000ab01'$$,
  'a project manager can update a budget line');


-- ── 17: an admin of ANOTHER workspace is denied ──────────────────────────
--
-- The one that would be missed by reading current_app_role() alone: the
-- claim says 'admin' and says nothing about WHICH workspace. Without the
-- projects/workspace_id test inside the gate, this read would succeed.

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '22222222-2222-2222-2222-222222222222',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.budget_lines),
  0, 'an admin of a different workspace cannot read this project''s budget');


SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- ── 18: the migration-0011 privilege trap, for budget_lines ──────────────
-- 0011's blanket GRANT plus its ALTER DEFAULT PRIVILEGES left anon holding
-- every privilege on 25 tables until 0033. Assert the revoke rather than
-- assume it — a policy-only check passes while a privilege hole is wide open.
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.budget_lines', 'SELECT') OR
    has_table_privilege('anon', 'public.budget_lines', 'INSERT') OR
    has_table_privilege('anon', 'public.budget_lines', 'UPDATE') OR
    has_table_privilege('anon', 'public.budget_lines', 'DELETE')
  ),
  'anon holds no table privilege on budget_lines'
);

SELECT * FROM finish();
ROLLBACK;
