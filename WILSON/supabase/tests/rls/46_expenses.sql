-- =========================================================================
-- 46_expenses.sql — Session 24, migration 0037.
--
-- What it PINS:
--  1. Structure: exists, RLS enabled AND forced, four policies, no FOR ALL,
--     workspace stamped (probes 1-5).
--  2. ONE row carries BOTH the bid figure and the actual figure —
--     estimated_cost and actual_cost are two columns on one row, not two
--     sets of rows. This is how useExpenses.js:103-104 already models it, and
--     it is what lets a phase total add "(rate x days) + expenses" for the
--     bid and the actual from the same place (probes 6-7).
--  3. purchase_date is a real DATE. The UI's default for it is the empty
--     STRING (useExpenses.js:105), which Postgres will not take — so the
--     adapter has to convert '' to NULL. Pinned here because that conversion
--     is easy to drop and the failure is a whole-request 400 (probe 8).
--  4. The money gate applies (probe 9), and anon reaches nothing (10).
-- =========================================================================
BEGIN;

SELECT plan(10);

SELECT * FROM tests.rls_setup();

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

SELECT has_table('public'::name, 'expenses'::name, 'expenses table exists');

SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.expenses'::regclass),
  'expenses has RLS enabled and forced');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'expenses' AND cmd = 'ALL'),
  0, 'expenses has no FOR ALL policy');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'expenses'),
  4, 'expenses has exactly four policies');

SELECT has_trigger('public', 'expenses',
  'trg_expenses_populate_workspace',
  'expenses stamps workspace_id on insert');


-- ── as the workspace admin ───────────────────────────────────────────────

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

INSERT INTO public.expenses (id, project_id, title, estimated_cost, actual_cost, purchase_date)
VALUES ('44440000-0000-0000-0000-00000000ee01',
        'aaaa1111-0000-0000-0000-000000000001',
        'Camera hire', 1200, 1350, '2026-08-01');


-- ── 6-7: bid and actual on ONE row ───────────────────────────────────────

SELECT is(
  (SELECT estimated_cost FROM public.expenses
    WHERE id = '44440000-0000-0000-0000-00000000ee01'),
  1200::numeric,
  'estimated_cost holds the BID figure');

SELECT is(
  (SELECT actual_cost FROM public.expenses
    WHERE id = '44440000-0000-0000-0000-00000000ee01'),
  1350::numeric,
  'actual_cost holds what it really cost — same row, two columns, so variance is a subtraction');


-- ── 8: purchase_date really is a DATE ────────────────────────────────────
-- The adapter must convert the UI's '' default to NULL. If this ever starts
-- passing as text, that conversion has been silently removed.

SELECT is(
  (SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'expenses'
      AND column_name = 'purchase_date'),
  'date',
  'purchase_date is a DATE — the adapter must send NULL, never the UI''s empty string');


-- ── 9: the money gate ────────────────────────────────────────────────────

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
  (SELECT count(*)::int FROM public.expenses),
  0, 'a project reviewer sees no expenses — spend is financial data too');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;


-- ── 10: the migration-0011 privilege trap, for expenses ──────────────────
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.expenses', 'SELECT') OR
    has_table_privilege('anon', 'public.expenses', 'INSERT') OR
    has_table_privilege('anon', 'public.expenses', 'UPDATE') OR
    has_table_privilege('anon', 'public.expenses', 'DELETE')
  ),
  'anon holds no table privilege on expenses'
);

SELECT * FROM finish();
ROLLBACK;
