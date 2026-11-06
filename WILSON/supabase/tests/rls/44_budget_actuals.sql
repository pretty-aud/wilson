-- =========================================================================
-- 44_budget_actuals.sql — Session 24, migration 0037.
--
-- budget_actuals is the line x pay-period GRID. One row IS one cell.
--
-- What it PINS:
--  1. Structure: exists, RLS enabled AND forced, four policies, no FOR ALL,
--     workspace stamped by trigger (probes 1-5).
--  2. One cell per line per period — the UNIQUE that turns a double-write
--     into a loud error instead of two disagreeing values for one pay
--     period (probes 6-7).
--  3. `source` is constrained to manual | timecard | expense, which is how
--     the future timecard system will be told apart from an invoice typed in
--     by hand. That system does not exist yet; this column is the seam left
--     for it (probe 8).
--  4. Deleting a line takes its cells with it, rather than orphaning money
--     rows that no longer roll up anywhere (probe 9).
--  5. The money gate applies here too (probe 10).
--  6. anon reaches nothing (probe 11).
-- =========================================================================
BEGIN;

SELECT plan(11);

SELECT * FROM tests.rls_setup();

-- One ordinary user holding a reviewer seat — the gate's whole point.
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local',
        crypt('testpw', gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        'authenticated', 'authenticated',
        '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES ('11111111-1111-1111-1111-111111111111',
        'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role)
VALUES ('aaaa1111-0000-0000-0000-000000000001',
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        '11111111-1111-1111-1111-111111111111', 'reviewer')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;


-- ── 1-5: structure ───────────────────────────────────────────────────────

SELECT has_table('public'::name, 'budget_actuals'::name,
  'budget_actuals table exists');

SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.budget_actuals'::regclass),
  'budget_actuals has RLS enabled and forced');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'budget_actuals' AND cmd = 'ALL'),
  0, 'budget_actuals has no FOR ALL policy');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'budget_actuals'),
  4, 'budget_actuals has exactly four policies');

SELECT has_trigger('public', 'budget_actuals',
  'trg_budget_actuals_populate_workspace',
  'budget_actuals stamps workspace_id on insert');


-- ── Seed a line to hang cells off, as the workspace admin ────────────────

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
VALUES ('11110000-0000-0000-0000-00000000ac01',
        'aaaa1111-0000-0000-0000-000000000001', 'crew', 'Compositor', 800, 5);

INSERT INTO public.budget_actuals (id, project_id, line_id, column_index, value, invoice_number)
VALUES ('22220000-0000-0000-0000-00000000ac01',
        'aaaa1111-0000-0000-0000-000000000001',
        '11110000-0000-0000-0000-00000000ac01', 0, 4000, 'INV-001');


-- ── 6-7: one cell per line per period ────────────────────────────────────

SELECT is(
  (SELECT workspace_id FROM public.budget_actuals
    WHERE id = '22220000-0000-0000-0000-00000000ac01'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'the actuals cell inherits workspace_id from its project');

SELECT throws_ok(
  $$INSERT INTO public.budget_actuals (project_id, line_id, column_index, value)
    VALUES ('aaaa1111-0000-0000-0000-000000000001',
            '11110000-0000-0000-0000-00000000ac01', 0, 7777)$$,
  'duplicate key value violates unique constraint "budget_actuals_line_column_uniq"',
  'a second cell for the same line and pay period is refused, not silently duplicated');


-- ── 8: the seam for the timecard system ──────────────────────────────────

SELECT throws_ok(
  $$INSERT INTO public.budget_actuals (project_id, line_id, column_index, value, source)
    VALUES ('aaaa1111-0000-0000-0000-000000000001',
            '11110000-0000-0000-0000-00000000ac01', 1, 10, 'guesswork')$$,
  'new row for relation "budget_actuals" violates check constraint "budget_actuals_source_check"',
  'source is constrained to manual | timecard | expense');


-- ── 9: cells die with their line ─────────────────────────────────────────

DELETE FROM public.budget_lines WHERE id = '11110000-0000-0000-0000-00000000ac01';

SELECT is(
  (SELECT count(*)::int FROM public.budget_actuals
    WHERE line_id = '11110000-0000-0000-0000-00000000ac01'),
  0, 'deleting a budget line cascades to its actuals cells');


-- ── 10: the money gate ───────────────────────────────────────────────────

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

SELECT throws_ok(
  $$INSERT INTO public.budget_actuals (project_id, line_id, column_index, value)
    VALUES ('aaaa1111-0000-0000-0000-000000000001',
            '11110000-0000-0000-0000-00000000ac99', 0, 1)$$,
  'new row violates row-level security policy for table "budget_actuals"',
  'a project reviewer cannot write an actuals cell');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;


-- ── 11: the migration-0011 privilege trap, for budget_actuals ────────────
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.budget_actuals', 'SELECT') OR
    has_table_privilege('anon', 'public.budget_actuals', 'INSERT') OR
    has_table_privilege('anon', 'public.budget_actuals', 'UPDATE') OR
    has_table_privilege('anon', 'public.budget_actuals', 'DELETE')
  ),
  'anon holds no table privilege on budget_actuals'
);

SELECT * FROM finish();
ROLLBACK;
