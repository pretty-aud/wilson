-- =============================================================================
-- 108_two_factor_step_up.sql — migration 0105 (P8, night 5, 2026-10-28):
-- the two-factor step-up in SQL (TPN-AUTH-013).
--
-- What this pins (each probe names the 0105 section it holds to):
--   * Structure (§1–§5): two_factor_satisfied is a SECURITY DEFINER over
--     auth.mfa_factors, executable by authenticated and not anon; the
--     switch's trigger and fn_gateway_require_admin carry the step-up AND
--     0093's live-admin guard; the five policies carry the conjunct.
--   * THE HELPER by claims (§1): an enrolled admin at aal1 is false, at aal2
--     true, with no aal claim false; an un-enrolled admin at aal1 is true; no
--     sign-in is false.
--   * THE SWITCH (§2): the enrolled admin at aal1 is refused with the
--     authenticator's sentence; at aal2 the flip lands (CONTROL); the other
--     company's un-enrolled admin flips at aal1 (CONTROL: no step-up without
--     a factor).
--   * THE RPCs (§3): gateway_make_enrolment_token at aal1 is 42501 with the
--     authenticator's sentence; at aal2 a token (CONTROL); the un-enrolled
--     admin at aal1 a token (CONTROL).
--   * THE POLICIES (§4, §5), one probe per arm with a caller that passes the
--     others (suite 58's rule): a gateway rename and a token cancel at aal1
--     touch nothing, at aal2 one row each; workspace_storage INSERT, UPDATE
--     and DELETE at aal1 are refused, at aal2 land; a USER claim at aal2 is
--     still refused (the role arm stands beside the new one).
--
-- Fixtures: user_a (rls_setup's admin of A) is given a VERIFIED TOTP factor
-- in auth.mfa_factors by postgres, with a secret that is no real secret;
-- user_b (admin of B) has none. A gateway of A is enrolled as suite 96 does
-- it, and two pending tokens of A are made by postgres. Claims are built by
-- hand with `aal` (tests.login_as sets none).
--
-- The failing controls, before 0105: every aal1 refusal below landed (the
-- switch flipped, the token was made, the rows changed) — the function did
-- not exist (42883) and the policies read the live row alone.
--
-- Postgres-side reads are ALWAYS scoped to fixture ids — dev carries real
-- projects.
-- =============================================================================

BEGIN;

SELECT plan(29);

SELECT * FROM tests.rls_setup();

-- user_c: a plain 'user' of A, for the role-arm control.
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET app_role = EXCLUDED.app_role, is_active = EXCLUDED.is_active;

-- user_a has enrolled an authenticator (a verified TOTP factor); user_b has not.
INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
VALUES ('10800000-0000-0000-0000-0000000000fa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'suite 108', 'totp', 'verified', now(), now(), 'not-a-real-secret-suite-108');

-- A gateway of A, enrolled as suite 96 does it, and two pending tokens.
INSERT INTO public.gateway_enrolment_tokens (workspace_id, token_hash, created_by)
VALUES ('11111111-1111-1111-1111-111111111111', encode(sha256(convert_to('wgt_SUITE108TOKENSUITE108TOKEN0108', 'UTF8')), 'hex'),
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT set_config('wg108.pem', '-----BEGIN CERTIFICATE-----' || chr(10)
  || encode(decode('30' || repeat('5c', 90), 'hex'), 'base64') || chr(10) || '-----END CERTIFICATE-----', true);
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;
SELECT set_config('wg108.gw', public.gateway_enrol_apply(
  encode(sha256(convert_to('wgt_SUITE108TOKENSUITE108TOKEN0108', 'UTF8')), 'hex'),
  encode(sha256(convert_to('wgc_suite108-credential', 'UTF8')), 'hex'),
  jsonb_build_object('name', 'Studio NAS 108', 'platform', 'windows', 'version', '1.0.0', 'hostname', 'studio-pc108',
    'inside_addresses', jsonb_build_array(jsonb_build_object('host', '192.168.108.10', 'port', 8443)),
    'root_cert_pem', current_setting('wg108.pem')),
  '198.51.100.18'::inet,
  encode(sha256(convert_to('wilson-reach-key:wgc_suite108-credential', 'UTF8')), 'hex')) ->> 'gateway_id', true);
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
INSERT INTO public.gateway_enrolment_tokens (id, workspace_id, token_hash, created_by) VALUES
  ('10800000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111', encode(sha256(convert_to('wgt_SUITE108PENDING1', 'UTF8')), 'hex'), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('10800000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111', encode(sha256(convert_to('wgt_SUITE108PENDING2', 'UTF8')), 'hex'), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');


-- ── 1-5: structure (§1–§5) ─────────────────────────────────────────────────

SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'public.two_factor_satisfied()'::regprocedure)
  AND has_function_privilege('authenticated', 'public.two_factor_satisfied()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.two_factor_satisfied()', 'EXECUTE')
  AND position('auth.mfa_factors' IN pg_get_functiondef('public.two_factor_satisfied()'::regprocedure)) > 0,
  'two_factor_satisfied is a SECURITY DEFINER over auth.mfa_factors, for authenticated and not anon (§1)');
SELECT ok(
  position('two_factor_satisfied' IN pg_get_functiondef('public.fn_workspaces_remote_viewing_live_admin()'::regprocedure)) > 0
  AND position('is_live_workspace_admin' IN pg_get_functiondef('public.fn_workspaces_remote_viewing_live_admin()'::regprocedure)) > 0,
  'the switch''s trigger carries the step-up and still 0093''s live-admin guard (§2)');
SELECT ok(
  position('two_factor_satisfied' IN pg_get_functiondef('public.fn_gateway_require_admin()'::regprocedure)) > 0
  AND position('is_live_workspace_admin' IN pg_get_functiondef('public.fn_gateway_require_admin()'::regprocedure)) > 0,
  'fn_gateway_require_admin carries the step-up and still 0093''s live-admin guard (§3)');
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public'
      AND ((tablename = 'gateways' AND policyname = 'gateways_update')
        OR (tablename = 'gateway_enrolment_tokens' AND policyname = 'gateway_enrolment_tokens_delete')
        OR (tablename = 'workspace_storage' AND policyname IN ('workspace_storage_insert', 'workspace_storage_update', 'workspace_storage_delete')))
      AND COALESCE(qual, '') || COALESCE(with_check, '') LIKE '%two_factor_satisfied%'),
  5, 'the five write policies carry the conjunct (§4, §5)');
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workspace_storage'), 4,
  'workspace_storage still has exactly its four policies (0048''s shape, restated)');


-- ── 6-10: the helper, by claims (§1) ───────────────────────────────────────

SELECT ok(NOT public.two_factor_satisfied(), 'no sign-in: false (§1)');

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated', 'aal', 'aal1',
  'app_metadata', jsonb_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT ok(NOT public.two_factor_satisfied(), '🚨 an enrolled admin at aal1 is not satisfied (§1)');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated', 'aal', 'aal2',
  'app_metadata', jsonb_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT ok(public.two_factor_satisfied(), 'the same admin at aal2 is satisfied (§1)');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', jsonb_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT ok(NOT public.two_factor_satisfied(), '🚨 an enrolled admin whose token carries no aal at all is not satisfied: closed, never open (§1)');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'role', 'authenticated', 'aal', 'aal1',
  'app_metadata', jsonb_build_object('workspace_id', '22222222-2222-2222-2222-222222222222', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT ok(public.two_factor_satisfied(), 'an admin with no factor at aal1 is satisfied: nothing to step up to (adminGuard''s rule, §1)');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;


-- ── 11-13: the switch (§2) ─────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated', 'aal', 'aal1',
  'app_metadata', jsonb_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$UPDATE public.workspaces SET remote_viewing_enabled = true WHERE id = '11111111-1111-1111-1111-111111111111'$$,
  '42501', 'Sign in with your authenticator code to change whether files may be viewed from outside the office network.',
  '🚨 an enrolled LIVE admin below aal2 cannot flip the switch (§2)');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated', 'aal', 'aal2',
  'app_metadata', jsonb_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
WITH upd AS (UPDATE public.workspaces SET remote_viewing_enabled = true
              WHERE id = '11111111-1111-1111-1111-111111111111' RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 1, 'CONTROL: at aal2 the same admin flips it (§2)');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'role', 'authenticated', 'aal', 'aal1',
  'app_metadata', jsonb_build_object('workspace_id', '22222222-2222-2222-2222-222222222222', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
WITH upd AS (UPDATE public.workspaces SET remote_viewing_enabled = true
              WHERE id = '22222222-2222-2222-2222-222222222222' RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 1, 'CONTROL: an admin with no factor flips it at aal1 (no step-up without a factor, §2)');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;


-- ── 14-16: the gateway's admin calls (§3) ──────────────────────────────────

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated', 'aal', 'aal1',
  'app_metadata', jsonb_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT * FROM public.gateway_make_enrolment_token()$$,
  '42501', 'Sign in with your authenticator code to manage the file gateway.',
  '🚨 an enrolled admin below aal2 cannot make an enrolment token (fn_gateway_require_admin, §3)');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated', 'aal', 'aal2',
  'app_metadata', jsonb_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT ok((SELECT t.token LIKE 'wgt_%' FROM public.gateway_make_enrolment_token() AS t),
  'CONTROL: at aal2 the token is made (§3)');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'role', 'authenticated', 'aal', 'aal1',
  'app_metadata', jsonb_build_object('workspace_id', '22222222-2222-2222-2222-222222222222', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT ok((SELECT t.token LIKE 'wgt_%' FROM public.gateway_make_enrolment_token() AS t),
  'CONTROL: an admin with no factor makes one at aal1 (§3)');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;


-- ── 17-20: the two gateway policies (§4) ───────────────────────────────────

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated', 'aal', 'aal1',
  'app_metadata', jsonb_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
WITH upd AS (UPDATE public.gateways SET name = 'Renamed below aal2' WHERE id = current_setting('wg108.gw')::uuid RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 0, '🚨 a gateway rename below aal2 changes nothing (gateways_update, §4)');
WITH del AS (DELETE FROM public.gateway_enrolment_tokens WHERE id = '10800000-0000-0000-0000-0000000000e1' RETURNING 1)
SELECT is((SELECT count(*)::int FROM del), 0, '🚨 a token cancel below aal2 cancels nothing (gateway_enrolment_tokens_delete, §4)');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated', 'aal', 'aal2',
  'app_metadata', jsonb_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
WITH upd AS (UPDATE public.gateways SET name = 'Renamed at aal2' WHERE id = current_setting('wg108.gw')::uuid RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 1, 'CONTROL: at aal2 the rename lands (§4)');
WITH del AS (DELETE FROM public.gateway_enrolment_tokens WHERE id = '10800000-0000-0000-0000-0000000000e1' RETURNING 1)
SELECT is((SELECT count(*)::int FROM del), 1, 'CONTROL: at aal2 the cancel lands (§4)');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;


-- ── 21-29: workspace_storage, one probe per arm (§5; suite 58's rule) ──────

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated', 'aal', 'aal1',
  'app_metadata', jsonb_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, root_path, root_kind)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 'network', '\\nas\projects\wilson', 'unc')$$,
  'new row violates row-level security policy for table "workspace_storage"',
  '🚨 an enrolled admin below aal2 cannot set the storage root (the step-up arm; the other three pass, §5)');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated', 'aal', 'aal2',
  'app_metadata', jsonb_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, root_path, root_kind)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 'network', '\\nas\projects\wilson', 'unc')$$,
  'CONTROL: at aal2 the same admin sets the root (§5)');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated', 'aal', 'aal1',
  'app_metadata', jsonb_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
WITH upd AS (UPDATE public.workspace_storage SET root_path = '\\nas\projects\moved'
              WHERE workspace_id = '11111111-1111-1111-1111-111111111111' RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 0, '🚨 below aal2 a repoint of the root changes nothing (§5)');
WITH del AS (DELETE FROM public.workspace_storage WHERE workspace_id = '11111111-1111-1111-1111-111111111111' RETURNING 1)
SELECT is((SELECT count(*)::int FROM del), 0, '🚨 below aal2 a removal removes nothing (§5)');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated', 'aal', 'aal2',
  'app_metadata', jsonb_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
WITH upd AS (UPDATE public.workspace_storage SET root_path = '\\nas\projects\moved'
              WHERE workspace_id = '11111111-1111-1111-1111-111111111111' RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 1, 'CONTROL: at aal2 the repoint lands (§5)');
SELECT is((SELECT root_path FROM public.workspace_storage WHERE workspace_id = '11111111-1111-1111-1111-111111111111'),
  '\\nas\projects\moved', 'and the new root is read back');
WITH del AS (DELETE FROM public.workspace_storage WHERE workspace_id = '11111111-1111-1111-1111-111111111111' RETURNING 1)
SELECT is((SELECT count(*)::int FROM del), 1, 'CONTROL: at aal2 the removal lands (§5)');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- The role arm stands beside the new one: a USER claim at aal2 is still refused.
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated', 'aal', 'aal2',
  'app_metadata', jsonb_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, root_path, root_kind)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 'network', '\\nas\projects\wilson', 'unc')$$,
  'new row violates row-level security policy for table "workspace_storage"',
  'CONTROL: a user claim at aal2 is still refused (0048''s role arm stands, §5)');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- The un-enrolled admin of B writes at aal1 (no step-up without a factor).
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'role', 'authenticated', 'aal', 'aal1',
  'app_metadata', jsonb_build_object('workspace_id', '22222222-2222-2222-2222-222222222222', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, root_path, root_kind)
    VALUES ('22222222-2222-2222-2222-222222222222', 'byos', 'network', '\\nas\projects\b', 'unc')$$,
  'CONTROL: an admin with no factor sets the root at aal1 (§5)');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
