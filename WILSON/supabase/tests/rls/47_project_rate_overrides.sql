-- =========================================================================
-- 47_project_rate_overrides.sql — Session 24, migration 0037.
--
-- Audrey, twice, for both real people and bid roles:
--   "when a manager makes a change on the rate card in a project that is
--    going to be project specific meaning the managers change should not
--    change the internal rate card. some projects will have different rates
--    for people."
--
-- rate_cards / rate_card_entries are WORKSPACE-level. Without this table, a
-- manager negotiating one project's rate would rewrite that rate for every
-- other project in the company — silently, with no way to reconstruct what
-- the other projects' numbers used to be.
--
-- What it PINS:
--  1. Structure: exists, RLS enabled AND forced, four policies, no FOR ALL,
--     workspace stamped (probes 1-5).
--  2. A row overrides EXACTLY ONE of a role or a person. Neither is
--     meaningless; both is ambiguous, and an ambiguous rate row would price
--     the same project differently depending on row order (probes 6-7).
--  3. One override per role per project, one per person per project — the
--     partial uniques that stop a second row shadowing the first
--     non-deterministically (probes 8-9).
--  4. 🚨 THE POINT OF THE WHOLE TABLE: writing a project override leaves the
--     workspace rate card untouched (probe 10).
--  5. The money gate applies (probe 11), and anon reaches nothing (12).
-- =========================================================================
BEGIN;

SELECT plan(12);

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

SELECT has_table('public'::name, 'project_rate_overrides'::name,
  'project_rate_overrides table exists');

SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.project_rate_overrides'::regclass),
  'project_rate_overrides has RLS enabled and forced');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'project_rate_overrides' AND cmd = 'ALL'),
  0, 'project_rate_overrides has no FOR ALL policy');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'project_rate_overrides'),
  4, 'project_rate_overrides has exactly four policies');

SELECT has_trigger('public', 'project_rate_overrides',
  'trg_project_rate_overrides_populate_workspace',
  'project_rate_overrides stamps workspace_id on insert');


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

-- The company rate card, and one role on it at the company rate.
INSERT INTO public.rate_cards (id, workspace_id, name, type, is_default)
VALUES ('55550000-0000-0000-0000-00000000cc01',
        '11111111-1111-1111-1111-111111111111', 'Company Card', 'general', true);

INSERT INTO public.rate_card_entries (id, rate_card_id, role_label, role_slug, day_rate)
VALUES ('55550000-0000-0000-0000-00000000cc02',
        '55550000-0000-0000-0000-00000000cc01', 'Animator', 'animator', 800);


-- ── 6-7: exactly one target ──────────────────────────────────────────────

SELECT throws_ok(
  $$INSERT INTO public.project_rate_overrides (project_id, day_rate)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 1000)$$,
  'new row for relation "project_rate_overrides" violates check constraint "project_rate_overrides_target_chk"',
  'an override with neither a role nor a person is refused');

SELECT throws_ok(
  $$INSERT INTO public.project_rate_overrides
      (project_id, role_slug, member_id, day_rate)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'animator',
            'cccccccc-cccc-cccc-cccc-cccccccccccc', 1000)$$,
  'new row for relation "project_rate_overrides" violates check constraint "project_rate_overrides_target_chk"',
  'an override keyed by BOTH a role and a person is refused — the lookup would be ambiguous');


-- ── 8-9: one override per target per project ─────────────────────────────

INSERT INTO public.project_rate_overrides (project_id, role_slug, day_rate)
VALUES ('aaaa1111-0000-0000-0000-000000000001', 'animator', 1000);

SELECT throws_ok(
  $$INSERT INTO public.project_rate_overrides (project_id, role_slug, day_rate)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'animator', 1200)$$,
  'duplicate key value violates unique constraint "project_rate_overrides_role_uniq"',
  'a second override for the same role on the same project is refused');

INSERT INTO public.project_rate_overrides (project_id, member_id, wage)
VALUES ('aaaa1111-0000-0000-0000-000000000001',
        'cccccccc-cccc-cccc-cccc-cccccccccccc', 650);

SELECT throws_ok(
  $$INSERT INTO public.project_rate_overrides (project_id, member_id, wage)
    VALUES ('aaaa1111-0000-0000-0000-000000000001',
            'cccccccc-cccc-cccc-cccc-cccccccccccc', 700)$$,
  'duplicate key value violates unique constraint "project_rate_overrides_member_uniq"',
  'a second override for the same person on the same project is refused');


-- ── 10: 🚨 the point of the whole table ──────────────────────────────────
-- Two override rows have now been written against project A — one for the
-- `animator` role at 1000, one for a person at 650. The company rate card
-- must be exactly as it was.

SELECT is(
  (SELECT day_rate FROM public.rate_card_entries
    WHERE id = '55550000-0000-0000-0000-00000000cc02'),
  800::numeric,
  'writing project rate overrides leaves the company rate card untouched — one project''s negotiated rate cannot rewrite every other project');


-- ── 11: the money gate ───────────────────────────────────────────────────

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
  (SELECT count(*)::int FROM public.project_rate_overrides),
  0, 'a project reviewer sees no rate overrides — rates are financial data');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;


-- ── 12: the migration-0011 privilege trap, for project_rate_overrides ────
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.project_rate_overrides', 'SELECT') OR
    has_table_privilege('anon', 'public.project_rate_overrides', 'INSERT') OR
    has_table_privilege('anon', 'public.project_rate_overrides', 'UPDATE') OR
    has_table_privilege('anon', 'public.project_rate_overrides', 'DELETE')
  ),
  'anon holds no table privilege on project_rate_overrides'
);

SELECT * FROM finish();
ROLLBACK;
