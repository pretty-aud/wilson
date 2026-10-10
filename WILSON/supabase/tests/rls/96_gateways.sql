-- =============================================================================
-- 96_gateways.sql — migration 0093 (the file gateway's cloud side, GW1,
-- 2026-10-10): the six gateway tables, the switch's two triggers, the
-- remote-viewing row in file_events, the read gate, the view a browser reads,
-- and the RPCs behind the Settings card and the five Edge Functions.
--
-- One suite covers the six tables: `gateways` is in RLS_TABLES with this
-- file, and rls.yml maps gateway_secrets, gateway_enrolment_tokens,
-- gateway_signing_keys, gateway_ticket_mints and workspace_audit here in
-- COVERED_BY (the guard demands NN_<table>.sql for every RLS_TABLES entry;
-- 93_bins' shape).
--
-- What this pins, by the brief's list (docs/sessions/briefs/po-gw1-gateway-cloud.md):
--   * A MEMBER cannot read gateway_secrets, gateway_signing_keys,
--     gateway_enrolment_tokens, gateway_ticket_mints or the gateways table —
--     and neither can an admin read the three service-role tables.
--   * gateways_visible answers a member of the workspace and not another
--     workspace's; hides a gateway until its fingerprint is confirmed; hides
--     the outside address while the switch is off, and shows it only when the
--     switch is on AND the door is reported open AND reach_ok (AND a sync
--     within 60 s) — each leg knocked out in turn with a control beside it.
--   * gateway_clips_for_tickets in 0083's shape: a seated reviewer's clip is
--     answered; a private project's clip is not, for the second manager and
--     the plain member, and is for the creator and the admin — with the
--     public clip as the control beside every caller.
--   * The live-admin trigger refuses the switch's flip from a token that says
--     admin over a demoted row, a platform operator is refused too, an
--     inactive admin changes nothing, and a live admin lands; the audit
--     trigger writes remote_viewing.on / .off with the actor.
--   * file_events_select: every arm of 0092 re-proved caller by caller, and
--     viewed_remote hidden from a member, a manager, a reviewer and a DEMOTED
--     admin whose claim still opens every older arm, shown to a live admin.
--   * external_id refuses a duplicate; the shape CHECKs refuse a forged prefix.
--   * workspace_audit is readable by live admins only, written by no client.
--   * The token: wgt_ + 32 base32, its SHA-256 stored, five pending at most,
--     cancelled by an admin only; spent ONCE by gateway_enrol_apply.
--   * gateway_events_apply derives every attribution and refuses or flags as
--     §6 says; gateway_sync_apply confirms only this company's catalogue,
--     withdraws the address on a new source and runs one check at a time.
--   * Forget, its minute of undo, and the sweep that makes it final.
--
-- Postgres-side reads are ALWAYS scoped to fixture ids — dev carries real
-- rows (S33).
-- =============================================================================

BEGIN;

SELECT plan(139);

SELECT * FROM tests.rls_setup();

-- ── Extra fixtures ─────────────────────────────────────────────────────────
--   user_a  admin of A (rls_setup) — makes the token: the ENROLLING admin
--   user_b  admin of B (rls_setup) — the other company
--   user_c  'user' of A, seated REVIEWER on project A
--   user_d  'user' of A, no seat — the plain member
--   user_e  'manager' of A, no seat — the SECOND manager (0083's case)
--   user_f  'manager' of A — creates the private project
--   user_g  a second LIVE admin of A (not the enrolling one)
--   user_h  row 'user' of A, token says admin — the DEMOTED admin
--   user_i  row 'admin' of A but INACTIVE, token says admin
--   user_j  a platform operator, no membership in A
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user_d@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user_e@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'user_f@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('96960000-0000-0000-0000-0000000000a7', 'user_g96@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('96960000-0000-0000-0000-0000000000a8', 'user_h96@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('96960000-0000-0000-0000-0000000000a9', 'user_i96@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('96960000-0000-0000-0000-0000000000aa', 'user_j96@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user',    'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'user',    'user_d', 'User D', true),
  ('11111111-1111-1111-1111-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'manager', 'user_e', 'User E', true),
  ('11111111-1111-1111-1111-111111111111', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'manager', 'user_f', 'User F', true),
  ('11111111-1111-1111-1111-111111111111', '96960000-0000-0000-0000-0000000000a7', 'admin',   'user_g', 'User G', true),
  ('11111111-1111-1111-1111-111111111111', '96960000-0000-0000-0000-0000000000a8', 'user',    'user_h', 'User H', true),
  ('11111111-1111-1111-1111-111111111111', '96960000-0000-0000-0000-0000000000a9', 'admin',   'user_i', 'User I', false)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET app_role = EXCLUDED.app_role, is_active = EXCLUDED.is_active;

INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role)
VALUES ('aaaa1111-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        '11111111-1111-1111-1111-111111111111', 'reviewer')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;

INSERT INTO public.platform_operators (user_id) VALUES ('96960000-0000-0000-0000-0000000000aa')
ON CONFLICT DO NOTHING;


-- ── 1-12: structure ────────────────────────────────────────────────────────

SELECT has_table('public'::name, 'gateways'::name, 'gateways exists (0093 §5)');

SELECT is(
  (SELECT count(*)::int FROM pg_class
    WHERE oid IN ('public.gateways'::regclass, 'public.gateway_secrets'::regclass,
                  'public.gateway_enrolment_tokens'::regclass, 'public.gateway_signing_keys'::regclass,
                  'public.gateway_ticket_mints'::regclass, 'public.workspace_audit'::regclass)
      AND relrowsecurity AND relforcerowsecurity),
  6, 'all six gateway tables have RLS enabled AND forced');

SELECT is(
  (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'gateways'),
  ARRAY['gateways_select', 'gateways_update'], 'gateways has exactly select and update (no client INSERT or DELETE)');
SELECT is(
  (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'gateway_enrolment_tokens'),
  ARRAY['gateway_enrolment_tokens_delete', 'gateway_enrolment_tokens_select'], 'the tokens have exactly select and delete');
SELECT is(
  (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workspace_audit'),
  ARRAY['workspace_audit_select'], 'workspace_audit has exactly one policy, SELECT');
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public'
      AND tablename IN ('gateway_secrets', 'gateway_signing_keys', 'gateway_ticket_mints')),
  0, 'the secrets, the signing keys and the mints have no policy at all (service role only)');

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.gateway_secrets', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.gateway_signing_keys', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.gateway_ticket_mints', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.gateways', 'root_cert_pem', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.gateways', 'reach_nonce', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.gateway_enrolment_tokens', 'token_hash', 'SELECT'),
  'no client grant reaches a secret, a key, a mint, the root certificate, the nonce or a token''s hash');

SELECT ok(
  has_column_privilege('authenticated', 'public.gateways', 'name', 'UPDATE')
  AND has_column_privilege('authenticated', 'public.gateways', 'outside_address', 'UPDATE')
  AND has_column_privilege('authenticated', 'public.gateways', 'office_ranges', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.gateways', 'revoked_at', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.gateways', 'root_confirmed_at', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.gateways', 'reach_ok', 'UPDATE'),
  'a client may change a gateway''s name, outside address and office ranges, and nothing else');

SELECT ok(
  (SELECT COALESCE(reloptions, '{}') @> ARRAY['security_barrier=true']
          AND NOT COALESCE(reloptions, '{}') @> ARRAY['security_invoker=true']
     FROM pg_class WHERE oid = 'public.gateways_visible'::regclass),
  'gateways_visible is a DEFINER view with security_barrier (F4)');

SELECT is(
  (SELECT count(*)::int FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'gateways_visible'
      AND column_name IN ('office_ranges', 'root_cert_pem', 'reach_nonce', 'last_sync_source', 'health', 'hostname')),
  0, 'gateways_visible carries no office range, root, nonce, public address, health or host name (R19)');

SELECT ok(
  NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.gateway_clips_for_tickets(uuid[])'::regprocedure)
  AND NOT has_function_privilege('anon', 'public.gateway_clips_for_tickets(uuid[])', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.gateway_clips_for_tickets(uuid[])', 'EXECUTE'),
  'gateway_clips_for_tickets is SECURITY INVOKER (the S33 rule), the authenticated role''s, not anon''s');

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.gateway_enrol_apply(text,text,jsonb,inet)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.gateway_sync_apply(uuid,jsonb,inet,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.gateway_events_apply(uuid,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.gateway_sweep()', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.gateway_events_apply(uuid,jsonb)', 'EXECUTE'),
  'the functions'' RPCs are the service role''s alone');


-- ── 13: the catalogue the probes read ──────────────────────────────────────
-- user_f makes the PRIVATE project (so created_by is stamped by the trigger,
-- suite 83's shape); postgres seeds the locations, bins and clips, scoped to
-- fixture ids.

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok($$
  INSERT INTO public.projects (id, workspace_id, title, is_private)
  VALUES ('96960000-0000-0000-0000-0000000000b0', '11111111-1111-1111-1111-111111111111', 'Private 96', true)
$$, 'a manager makes a private project (the creator, 0072)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

INSERT INTO public.bin_locations (id, workspace_id, name, unc_path) VALUES
  ('96960000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'Footage 96', '\\studio-nas96\footage'),
  ('96960000-0000-0000-0000-0000000000c2', '22222222-2222-2222-2222-222222222222', 'B footage 96', '\\b-nas96\footage');
INSERT INTO public.bins (id, project_id, workspace_id, name, kind) VALUES
  ('96960000-0000-0000-0000-0000000000d1', 'aaaa1111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Day 1', 'footage'),
  ('96960000-0000-0000-0000-0000000000d2', '96960000-0000-0000-0000-0000000000b0', '11111111-1111-1111-1111-111111111111', 'Secret', 'footage'),
  ('96960000-0000-0000-0000-0000000000d3', 'bbbb2222-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'B day', 'footage');
INSERT INTO public.bin_files (id, project_id, workspace_id, bin_id, location_id, relative_path, display_name, original_name, extension, mime_type, media_type) VALUES
  ('96960000-0000-0000-0000-0000000000f1', 'aaaa1111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '96960000-0000-0000-0000-0000000000d1', '96960000-0000-0000-0000-0000000000c1', 'A001/A001_C001.mov', 'A001_C001', 'A001_C001.mov', 'mov', 'video/quicktime', 'video'),
  ('96960000-0000-0000-0000-0000000000f2', '96960000-0000-0000-0000-0000000000b0', '11111111-1111-1111-1111-111111111111',
   '96960000-0000-0000-0000-0000000000d2', '96960000-0000-0000-0000-0000000000c1', 'P001/secret.mov', 'secret', 'secret.mov', 'mov', 'video/quicktime', 'video'),
  ('96960000-0000-0000-0000-0000000000f3', 'bbbb2222-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   '96960000-0000-0000-0000-0000000000d3', '96960000-0000-0000-0000-0000000000c2', 'B001/b.mov', 'b', 'b.mov', 'mov', 'video/quicktime', 'video');


-- ── 14-24: the token (§2 step 1) ───────────────────────────────────────────

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT set_config('wg96.token', t.token, true) FROM public.gateway_make_enrolment_token() AS t;

SELECT ok(current_setting('wg96.token') ~ '^wgt_[A-Z2-7]{32}$',
  'a live admin makes a token: wgt_ + 32 characters of base32 (the wire)');

SELECT is(
  (SELECT count(*)::int FROM public.gateway_enrolment_tokens
    WHERE created_by = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND used_at IS NULL),
  1, 'the admin sees the pending token in the list');

SELECT throws_ok($$SELECT token_hash FROM public.gateway_enrolment_tokens$$, '42501', NULL,
  'not even an admin reads a token''s hash (the column grant leaves it out)');

-- Four more (five pending), then the sixth is refused.
SELECT count(*) FROM public.gateway_make_enrolment_token();
SELECT count(*) FROM public.gateway_make_enrolment_token();
SELECT count(*) FROM public.gateway_make_enrolment_token();
SELECT set_config('wg96.cancel', t.id::text, true) FROM public.gateway_make_enrolment_token() AS t;

SELECT throws_ok($$SELECT * FROM public.gateway_make_enrolment_token()$$, '54000', NULL,
  'a sixth pending token is refused: five at most');

WITH del AS (DELETE FROM public.gateway_enrolment_tokens WHERE id = current_setting('wg96.cancel')::uuid RETURNING 1)
SELECT is((SELECT count(*)::int FROM del), 1, 'the admin cancels a pending token');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT token_hash FROM public.gateway_enrolment_tokens
    WHERE created_by = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      AND token_hash = encode(sha256(convert_to(current_setting('wg96.token'), 'UTF8')), 'hex')),
  encode(sha256(convert_to(current_setting('wg96.token'), 'UTF8')), 'hex'),
  'the stored form is SHA-256 (hex) of the whole token''s UTF-8 bytes; the token itself is nowhere');

SELECT is(
  (SELECT array_agg(action ORDER BY id) FROM public.workspace_audit
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
      AND action IN ('gateway.token_made', 'gateway.token_cancelled')
      AND actor_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ARRAY['gateway.token_made', 'gateway.token_made', 'gateway.token_made', 'gateway.token_made',
        'gateway.token_made', 'gateway.token_cancelled'],
  'five tokens made and one cancelled are written down with the admin');

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok($$SELECT * FROM public.gateway_make_enrolment_token()$$, '42501', NULL,
  'a member cannot make a token');
SELECT is((SELECT count(*)::int FROM public.gateway_enrolment_tokens), 0,
  'a member reads no token (gateway_enrolment_tokens_select is a live admin''s)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '96960000-0000-0000-0000-0000000000a8', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok($$SELECT * FROM public.gateway_make_enrolment_token()$$, '42501', NULL,
  '🚨 a DEMOTED admin whose token still says admin cannot make a token (the live row, F21)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '96960000-0000-0000-0000-0000000000a9', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok($$SELECT * FROM public.gateway_make_enrolment_token()$$, '42501', NULL,
  'an INACTIVE admin cannot make a token');


-- ── 25-33: enrolment (§2 step 3), as the service role ──────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
-- An expired token, made by postgres directly (created two days ago).
INSERT INTO public.gateway_enrolment_tokens (workspace_id, token_hash, created_by, created_at, expires_at)
VALUES ('11111111-1111-1111-1111-111111111111', encode(sha256(convert_to('wgt_EXPIREDEXPIREDEXPIREDEXPIRED96', 'UTF8')), 'hex'),
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '2 days', now() - interval '1 day');

SELECT set_config('wg96.pem', '-----BEGIN CERTIFICATE-----' || chr(10)
  || encode(decode('30' || repeat('5a', 90), 'hex'), 'base64') || chr(10) || '-----END CERTIFICATE-----', true);
SELECT set_config('wg96.fp', encode(sha256(decode('30' || repeat('5a', 90), 'hex')), 'hex'), true);
SELECT set_config('wg96.body', jsonb_build_object(
  'name', 'Studio NAS', 'platform', 'container', 'version', '1.0.0', 'hostname', 'studio-nas',
  'inside_addresses', jsonb_build_array(jsonb_build_object('host', '192.168.1.10', 'port', 8443),
                                        jsonb_build_object('host', 'studio-nas.local', 'port', 8443)),
  'root_cert_pem', current_setting('wg96.pem'))::text, true);
SELECT set_config('wg96.cred', encode(sha256(convert_to('wgc_suite96-credential', 'UTF8')), 'hex'), true);

SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;

SELECT set_config('wg96.enrol', public.gateway_enrol_apply(
  encode(sha256(convert_to(current_setting('wg96.token'), 'UTF8')), 'hex'),
  current_setting('wg96.cred'), current_setting('wg96.body')::jsonb, '198.51.100.7'::inet)::text, true);
SELECT set_config('wg96.gw', current_setting('wg96.enrol')::jsonb ->> 'gateway_id', true);

SELECT is((current_setting('wg96.enrol')::jsonb ->> 'ok'), 'true',
  'the service role enrols a gateway with the token');
SELECT is(
  (public.gateway_enrol_apply(encode(sha256(convert_to(current_setting('wg96.token'), 'UTF8')), 'hex'),
     encode(sha256(convert_to('wgc_second', 'UTF8')), 'hex'), current_setting('wg96.body')::jsonb, NULL) ->> 'reason'),
  'token', '🚨 the same token enrols nothing the second time (spent in one UPDATE … RETURNING, F14)');
SELECT is(
  (public.gateway_enrol_apply(encode(sha256(convert_to('wgt_EXPIREDEXPIREDEXPIREDEXPIRED96', 'UTF8')), 'hex'),
     encode(sha256(convert_to('wgc_third', 'UTF8')), 'hex'), current_setting('wg96.body')::jsonb, NULL) ->> 'reason'),
  'token', 'an expired token enrols nothing');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT root_fingerprint FROM public.gateways WHERE id = current_setting('wg96.gw')::uuid),
  current_setting('wg96.fp'),
  'the fingerprint is the database''s own SHA-256 of the PEM''s DER (never the gateway''s word)');
SELECT is(
  (SELECT created_by FROM public.gateways WHERE id = current_setting('wg96.gw')::uuid),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'the gateway remembers the admin who made its token');
SELECT is(
  (SELECT credential_hash FROM public.gateway_secrets WHERE gateway_id = current_setting('wg96.gw')::uuid),
  current_setting('wg96.cred'), 'only the credential''s hash is stored');
SELECT is(
  (SELECT gateway_id FROM public.gateway_enrolment_tokens
    WHERE token_hash = encode(sha256(convert_to(current_setting('wg96.token'), 'UTF8')), 'hex') AND used_at IS NOT NULL),
  current_setting('wg96.gw')::uuid, 'the spent token names the gateway it enrolled');
SELECT is(
  (SELECT actor_user_id FROM public.workspace_audit WHERE gateway_id = current_setting('wg96.gw')::uuid AND action = 'gateway.enrolled'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'gateway.enrolled is written with the enrolling admin');

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok($$SELECT public.gateway_enrol_apply('aa', 'bb', '{}'::jsonb, NULL)$$, '42501', NULL,
  'an admin cannot call the enrolment RPC (the service role''s alone)');

-- Ten live gateways per company at most: nine more enrol (ten in all), the
-- eleventh is refused and its token is NOT spent (the cap raises, so the
-- spend rolls back with it).
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
INSERT INTO public.gateway_enrolment_tokens (workspace_id, token_hash, created_by)
SELECT '11111111-1111-1111-1111-111111111111', encode(sha256(convert_to('wgt_CAP96_' || i, 'UTF8')), 'hex'),
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  FROM generate_series(1, 10) AS i;
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;
SELECT is(
  (SELECT count(*)::int FROM generate_series(1, 9) AS i
    WHERE (public.gateway_enrol_apply(encode(sha256(convert_to('wgt_CAP96_' || i, 'UTF8')), 'hex'),
             encode(sha256(convert_to('wgc_cap96_' || i, 'UTF8')), 'hex'),
             current_setting('wg96.body')::jsonb, NULL) ->> 'ok')::boolean),
  9, 'nine more gateways enrol: ten live in the company');
SELECT throws_ok(
  format('SELECT public.gateway_enrol_apply(%L, %L, %L::jsonb, NULL)',
         encode(sha256(convert_to('wgt_CAP96_10', 'UTF8')), 'hex'),
         encode(sha256(convert_to('wgc_cap96_10', 'UTF8')), 'hex'), current_setting('wg96.body')),
  '54000', NULL, 'an eleventh is refused (ten live gateways at most)');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT ok(
  (SELECT used_at IS NULL AND gateway_id IS NULL FROM public.gateway_enrolment_tokens
    WHERE token_hash = encode(sha256(convert_to('wgt_CAP96_10', 'UTF8')), 'hex')),
  'and the refused enrolment did not spend its token');
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;


-- ── 34-42: what a member, an admin and a demoted admin may read ────────────

SELECT throws_ok($$SELECT count(*) FROM public.gateway_secrets$$, '42501', NULL,
  'an ADMIN cannot read gateway_secrets');
SELECT throws_ok($$SELECT count(*) FROM public.gateway_signing_keys$$, '42501', NULL,
  'an ADMIN cannot read gateway_signing_keys');
SELECT throws_ok($$SELECT count(*) FROM public.gateway_ticket_mints$$, '42501', NULL,
  'an ADMIN cannot read gateway_ticket_mints');
SELECT throws_ok($$SELECT root_cert_pem FROM public.gateways$$, '42501', NULL,
  'an admin cannot read the root certificate by a column (gateway_root_certificate serves it)');
SELECT is((SELECT count(*)::int FROM public.gateways WHERE id = current_setting('wg96.gw')::uuid), 1,
  'CONTROL: a live admin reads the gateways table');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok($$SELECT count(*) FROM public.gateway_secrets$$, '42501', NULL,
  'a MEMBER cannot read gateway_secrets');
SELECT throws_ok($$SELECT count(*) FROM public.gateway_signing_keys$$, '42501', NULL,
  'a MEMBER cannot read gateway_signing_keys');
SELECT throws_ok($$SELECT count(*) FROM public.gateway_ticket_mints$$, '42501', NULL,
  'a MEMBER cannot read gateway_ticket_mints');
SELECT is((SELECT count(*)::int FROM public.gateways), 0,
  '🚨 a MEMBER reads nothing of the gateways TABLE (F4: they read gateways_visible)');


-- ── 43-56: the view before and after the fingerprint (D25) ─────────────────

SELECT is((SELECT count(*)::int FROM public.gateways_visible WHERE id = current_setting('wg96.gw')::uuid), 0,
  '🚨 an unconfirmed gateway is not offered to a member''s browser');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '96960000-0000-0000-0000-0000000000a8', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*)::int FROM public.gateways), 0,
  'a DEMOTED admin reads nothing of the gateways table (the live row, not the claim)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '96960000-0000-0000-0000-0000000000a7', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  format('SELECT public.gateway_confirm_root(%L::uuid, %L)', current_setting('wg96.gw'), current_setting('wg96.fp')),
  '42501', NULL,
  '🚨 another live admin cannot confirm the fingerprint: only the one who made the token saw it printed (R10)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(format('SELECT public.gateway_root_certificate(%L::uuid)', current_setting('wg96.gw')), '55000', NULL,
  '🚨 the certificate is not offered before the fingerprint is confirmed (D25 in the database)');
SELECT throws_ok(
  format('SELECT public.gateway_confirm_root(%L::uuid, %L)', current_setting('wg96.gw'), repeat('ab', 32)),
  '22023', NULL, 'a fingerprint that does not match is refused with a sentence');
SELECT ok(
  public.gateway_confirm_root(current_setting('wg96.gw')::uuid,
    upper(regexp_replace(current_setting('wg96.fp'), '(..)(?!$)', '\1:', 'g'))) IS NOT NULL,
  'the enrolling admin confirms it as printed — upper case, colons between the pairs');
SELECT is(public.gateway_root_certificate(current_setting('wg96.gw')::uuid), current_setting('wg96.pem'),
  'after confirmation the root certificate is served for download');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT ok(
  (SELECT root_confirmed_by = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid AND root_confirmed_at IS NOT NULL
     FROM public.gateways WHERE id = current_setting('wg96.gw')::uuid)
  AND EXISTS (SELECT 1 FROM public.workspace_audit WHERE gateway_id = current_setting('wg96.gw')::uuid
                AND action = 'gateway.root_confirmed' AND actor_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'the confirmation is recorded on the row and in the audit');

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*)::int FROM public.gateways_visible WHERE id = current_setting('wg96.gw')::uuid), 1,
  'once confirmed, a MEMBER''s browser sees the gateway in gateways_visible');
SELECT is((SELECT inside_addresses FROM public.gateways_visible WHERE id = current_setting('wg96.gw')::uuid),
  '[{"host": "192.168.1.10", "port": 8443}, {"host": "studio-nas.local", "port": 8443}]'::jsonb,
  'with its inside addresses to probe');
SELECT ok((SELECT outside_address IS NULL FROM public.gateways_visible WHERE id = current_setting('wg96.gw')::uuid),
  'and no outside address (none set yet)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.gateways_visible WHERE id = current_setting('wg96.gw')::uuid), 1,
  'a seated REVIEWER sees it too (B6: every member)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '22222222-2222-2222-2222-222222222222', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.gateways_visible WHERE id = current_setting('wg96.gw')::uuid), 0,
  '🚨 ANOTHER company''s admin does not see it');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '96960000-0000-0000-0000-0000000000a9', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.gateways_visible WHERE id = current_setting('wg96.gw')::uuid), 0,
  'an INACTIVE member does not see it (the view''s own membership filter)');


-- ── 57-66: the admin's three columns, and nothing else ─────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

WITH upd AS (UPDATE public.gateways SET outside_address = '{"host": "gateway.example.com", "port": 8444}'::jsonb
              WHERE id = current_setting('wg96.gw')::uuid RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 1, 'the admin sets the outside address');
SELECT throws_ok(
  format($f$UPDATE public.gateways SET outside_address = '{"host": "192.168.1.10", "port": 8444}'::jsonb WHERE id = %L::uuid$f$,
         current_setting('wg96.gw')),
  '23514', NULL, 'a private address is not an outside address (the CHECK)');
SELECT throws_ok(
  format('UPDATE public.gateways SET revoked_at = now() WHERE id = %L::uuid', current_setting('wg96.gw')),
  '42501', NULL, 'an admin cannot set revoked_at by an UPDATE (Forget is the RPC)');
SELECT throws_ok(
  format('UPDATE public.gateways SET reach_ok = true WHERE id = %L::uuid', current_setting('wg96.gw')),
  '42501', NULL, '🚨 an admin cannot mark the reach confirmed by hand (F16: only a check publishes an address)');
WITH upd AS (UPDATE public.gateways SET name = '  Studio NAS 2  ' WHERE id = current_setting('wg96.gw')::uuid RETURNING name)
SELECT is((SELECT name FROM upd), 'Studio NAS 2', 'the admin renames it; the name is stored trimmed');
WITH upd AS (UPDATE public.gateways SET office_ranges = '["10.8.0.0/16"]'::jsonb WHERE id = current_setting('wg96.gw')::uuid RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 1, 'the admin declares a private office range (D21)');
SELECT throws_ok(
  format($f$UPDATE public.gateways SET office_ranges = '["8.8.8.0/24"]'::jsonb WHERE id = %L::uuid$f$, current_setting('wg96.gw')),
  '23514', NULL, 'a public office range is refused (D21)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT ok(
  (SELECT reach_ok IS NULL AND reach_checked_at IS NULL AND reach_detail = 'address_changed' FROM public.gateways WHERE id = current_setting('wg96.gw')::uuid),
  'a new outside address clears reach_ok and the last check''s time: nothing is published before a check of THIS address (F16), and the next sync begins one');
SELECT is(
  (SELECT array_agg(action ORDER BY id) FROM public.workspace_audit
    WHERE gateway_id = current_setting('wg96.gw')::uuid
      AND action IN ('gateway.outside_address_changed', 'gateway.renamed', 'gateway.office_ranges_changed')),
  ARRAY['gateway.outside_address_changed', 'gateway.renamed', 'gateway.office_ranges_changed'],
  'each of the three changes is written down (§10 row 23 for the address)');

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
WITH upd AS (UPDATE public.gateways SET name = 'mine now' WHERE id = current_setting('wg96.gw')::uuid RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 0, 'a member''s rename changes nothing');


-- ── 67-74: publishing the outside address (§9 point 6) ─────────────────────
-- Postgres stands in for a passed reach check and a fresh sync; each leg of
-- the mask is then knocked out in turn, with the control restored between.

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
UPDATE public.gateways SET outside_open = true, reach_ok = true, last_seen_at = now()
 WHERE id = current_setting('wg96.gw')::uuid;

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT ok((SELECT outside_address IS NULL FROM public.gateways_visible WHERE id = current_setting('wg96.gw')::uuid),
  '🚨 SWITCH OFF: the outside address is hidden from a member though the door is open and the check passed');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
WITH upd AS (UPDATE public.workspaces SET remote_viewing_enabled = true
              WHERE id = '11111111-1111-1111-1111-111111111111' RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 1, 'a LIVE admin turns the switch on');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT outside_address FROM public.gateways_visible WHERE id = current_setting('wg96.gw')::uuid),
  '{"host": "gateway.example.com", "port": 8444}'::jsonb,
  'SWITCH ON + door open + reach_ok + a fresh sync: the member''s browser is told the outside address');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
UPDATE public.gateways SET outside_open = false WHERE id = current_setting('wg96.gw')::uuid;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT ok((SELECT outside_address IS NULL FROM public.gateways_visible WHERE id = current_setting('wg96.gw')::uuid),
  'the door reported closed: hidden');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
UPDATE public.gateways SET outside_open = true, reach_ok = false WHERE id = current_setting('wg96.gw')::uuid;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT ok((SELECT outside_address IS NULL FROM public.gateways_visible WHERE id = current_setting('wg96.gw')::uuid),
  'the last check did not find this gateway there: hidden (F16)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
UPDATE public.gateways SET reach_ok = true, last_seen_at = now() - interval '2 minutes' WHERE id = current_setting('wg96.gw')::uuid;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT ok((SELECT outside_address IS NULL FROM public.gateways_visible WHERE id = current_setting('wg96.gw')::uuid),
  'no sync for two minutes: hidden (D15, no cloud no outside)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
UPDATE public.gateways SET last_seen_at = now() WHERE id = current_setting('wg96.gw')::uuid;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT ok((SELECT outside_address IS NOT NULL FROM public.gateways_visible WHERE id = current_setting('wg96.gw')::uuid),
  'CONTROL: all four legs restored, the address is shown again');


-- ── 75-84: the read gate, in 0083's shape (switch ON) ──────────────────────
-- ARRAY[public clip, private clip, other company's clip] for every caller;
-- the public clip is the control beside each refusal.

SELECT is(
  ARRAY(SELECT bin_file_id FROM public.gateway_clips_for_tickets(ARRAY[
          '96960000-0000-0000-0000-0000000000f1', '96960000-0000-0000-0000-0000000000f2',
          '96960000-0000-0000-0000-0000000000f3']::uuid[]) ORDER BY bin_file_id),
  ARRAY['96960000-0000-0000-0000-0000000000f1']::uuid[],
  '🚨 the PLAIN MEMBER gets the public clip and not the private project''s');
SELECT ok(
  (SELECT remote_viewing AND unc_path = '\\studio-nas96\footage' AND relative_path = 'A001/A001_C001.mov'
          AND mime_type = 'video/quicktime' AND file_name = 'A001_C001' AND NOT is_sequence
     FROM public.gateway_clips_for_tickets(ARRAY['96960000-0000-0000-0000-0000000000f1']::uuid[])),
  'the row carries the location, the path, the type, the name and the switch (rv) the mint stamps');
SELECT throws_ok(
  format('SELECT count(*) FROM public.gateway_clips_for_tickets(%L::uuid[])',
         (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 101))::text),
  '22023', NULL, 'more than 100 clips at once is refused');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(
  ARRAY(SELECT bin_file_id FROM public.gateway_clips_for_tickets(ARRAY[
          '96960000-0000-0000-0000-0000000000f1', '96960000-0000-0000-0000-0000000000f2',
          '96960000-0000-0000-0000-0000000000f3']::uuid[]) ORDER BY bin_file_id),
  ARRAY['96960000-0000-0000-0000-0000000000f1']::uuid[],
  'a seated REVIEWER gets the clip of their project (B6) and not the private one');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(
  ARRAY(SELECT bin_file_id FROM public.gateway_clips_for_tickets(ARRAY[
          '96960000-0000-0000-0000-0000000000f1', '96960000-0000-0000-0000-0000000000f2',
          '96960000-0000-0000-0000-0000000000f3']::uuid[]) ORDER BY bin_file_id),
  ARRAY['96960000-0000-0000-0000-0000000000f1']::uuid[],
  '🚨 the SECOND MANAGER gets the public clip and not the private project''s (0083''s case)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(
  ARRAY(SELECT bin_file_id FROM public.gateway_clips_for_tickets(ARRAY[
          '96960000-0000-0000-0000-0000000000f1', '96960000-0000-0000-0000-0000000000f2',
          '96960000-0000-0000-0000-0000000000f3']::uuid[]) ORDER BY bin_file_id),
  ARRAY['96960000-0000-0000-0000-0000000000f1', '96960000-0000-0000-0000-0000000000f2']::uuid[],
  'the CREATOR gets both of their company''s clips');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(
  ARRAY(SELECT bin_file_id FROM public.gateway_clips_for_tickets(ARRAY[
          '96960000-0000-0000-0000-0000000000f1', '96960000-0000-0000-0000-0000000000f2',
          '96960000-0000-0000-0000-0000000000f3']::uuid[]) ORDER BY bin_file_id),
  ARRAY['96960000-0000-0000-0000-0000000000f1', '96960000-0000-0000-0000-0000000000f2']::uuid[],
  'the ADMIN gets both, and never the other company''s');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '22222222-2222-2222-2222-222222222222', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(
  ARRAY(SELECT bin_file_id FROM public.gateway_clips_for_tickets(ARRAY[
          '96960000-0000-0000-0000-0000000000f1', '96960000-0000-0000-0000-0000000000f2',
          '96960000-0000-0000-0000-0000000000f3']::uuid[]) ORDER BY bin_file_id),
  ARRAY['96960000-0000-0000-0000-0000000000f3']::uuid[],
  'the OTHER company''s admin gets their own clip and none of A''s');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '96960000-0000-0000-0000-0000000000a9', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(
  ARRAY(SELECT bin_file_id FROM public.gateway_clips_for_tickets(ARRAY[
          '96960000-0000-0000-0000-0000000000f1', '96960000-0000-0000-0000-0000000000f2']::uuid[]) ORDER BY bin_file_id),
  ARRAY[]::uuid[],
  'an INACTIVE admin gets nothing (the location''s membership filter and the projects hop)');


-- ── 85-94: the switch's triggers (D23) ─────────────────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '96960000-0000-0000-0000-0000000000a8', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$UPDATE public.workspaces SET remote_viewing_enabled = false WHERE id = '11111111-1111-1111-1111-111111111111'$$,
  '42501', 'Only a workspace admin can change whether files may be viewed from outside the office network.',
  '🚨 a DEMOTED admin whose token says admin passes workspaces_admin_update and is refused by the live-admin trigger');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '96960000-0000-0000-0000-0000000000a9', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
WITH upd AS (UPDATE public.workspaces SET remote_viewing_enabled = false
              WHERE id = '11111111-1111-1111-1111-111111111111' RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 0, 'an INACTIVE admin''s flip changes nothing');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '96960000-0000-0000-0000-0000000000aa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$UPDATE public.workspaces SET remote_viewing_enabled = false WHERE id = '11111111-1111-1111-1111-111111111111'$$,
  '42501', NULL,
  '🚨 a PLATFORM OPERATOR passes workspaces_operator_update and is refused too (R9: no operator exemption)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
WITH upd AS (UPDATE public.workspaces SET remote_viewing_enabled = false
              WHERE id = '11111111-1111-1111-1111-111111111111' RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 0, 'a member''s flip changes nothing');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT is((SELECT remote_viewing_enabled FROM public.workspaces WHERE id = '11111111-1111-1111-1111-111111111111'), true,
  'the switch is still on after the four refused attempts');

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
WITH upd AS (UPDATE public.workspaces SET remote_viewing_enabled = false
              WHERE id = '11111111-1111-1111-1111-111111111111' RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 1, 'the LIVE admin turns it off');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT remote_viewing FROM public.gateway_clips_for_tickets(ARRAY['96960000-0000-0000-0000-0000000000f1']::uuid[])),
  false, 'with the switch off the read gate answers rv false (the outside door refuses such a ticket)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT is(
  (SELECT array_agg(action || ':' || COALESCE(actor_label, '-') || ':' || COALESCE(actor_user_id::text, '-') ORDER BY id) FROM public.workspace_audit
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND action LIKE 'remote_viewing.%'
      AND created_at >= (SELECT min(created_at) FROM public.workspace_audit WHERE gateway_id = current_setting('wg96.gw')::uuid)),
  ARRAY['remote_viewing.on:User A:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'remote_viewing.off:User A:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
  'the audit trigger wrote remote_viewing.on then .off, each with the admin who flipped it');

-- A session with no sign-in (the service role, a migration) is exempt —
-- and still written down, with no actor.
UPDATE public.workspaces SET remote_viewing_enabled = true WHERE id = '11111111-1111-1111-1111-111111111111';
SELECT ok(
  (SELECT action = 'remote_viewing.on' AND actor_user_id IS NULL FROM public.workspace_audit
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111' ORDER BY id DESC LIMIT 1),
  'a flip with no sign-in lands and is written down with no actor');
UPDATE public.workspaces SET remote_viewing_enabled = false WHERE id = '11111111-1111-1111-1111-111111111111';
SELECT ok(
  (SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.workspaces'::regclass AND NOT tgisinternal
      AND (tgtype & 2) = 2 AND (tgtype & 16) = 16 ORDER BY tgname DESC LIMIT 1) = 'trg_workspaces_remote_viewing_live_admin',
  'the live-admin trigger is the LAST BEFORE UPDATE trigger on workspaces: it judges the final row');


-- ── 95-105: file_events_select, every arm re-proved ────────────────────────
-- Six rows in A (a plain upload, an invoice, a Legal file, a private
-- project's upload, a remote viewing) and one in B; each caller's view of
-- exactly these ids.

INSERT INTO public.file_events (workspace_id, project_id, file_id, file_name, event, new_path, size_bytes, subject, external_id, details) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000001', '96960000-0000-0000-0000-0000000000e1',
   'plain.mov', 'uploaded', 'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/1-plain.mov', 10, 'file', NULL, '{}'),
  ('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000001', '96960000-0000-0000-0000-0000000000e2',
   'inv.pdf', 'uploaded', 'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/1-inv.pdf', 10, 'file', NULL, '{}'),
  ('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000001', '96960000-0000-0000-0000-0000000000e3',
   'nda.pdf', 'uploaded', 'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/1-nda.pdf', 10, 'file', NULL, '{}'),
  ('11111111-1111-1111-1111-111111111111', '96960000-0000-0000-0000-0000000000b0', '96960000-0000-0000-0000-0000000000e4',
   'secret.mov', 'uploaded', 'projects/96960000-0000-0000-0000-0000000000b0/ASSETS/a1/1-secret.mov', 10, 'file', NULL, '{}'),
  ('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000001', '96960000-0000-0000-0000-0000000000e5',
   'A001_C001', 'viewed_remote', NULL, 10, 'bin_file',
   current_setting('wg96.gw') || ':96960000-0000-0000-0000-000000000105',
   jsonb_build_object('gateway_id', current_setting('wg96.gw'))),
  ('22222222-2222-2222-2222-222222222222', 'bbbb2222-0000-0000-0000-000000000001', '96960000-0000-0000-0000-0000000000e9',
   'b.mov', 'uploaded', 'projects/bbbb2222-0000-0000-0000-000000000001/ASSETS/b1/1-b.mov', 10, 'file', NULL, '{}');

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(
  ARRAY(SELECT file_id FROM public.file_events WHERE file_id::text LIKE '96960000-0000-0000-0000-0000000000e_' ORDER BY file_id),
  ARRAY['96960000-0000-0000-0000-0000000000e1']::uuid[],
  '🚨 a MEMBER: the plain upload only — no invoice, no Legal file, no private project, NO REMOTE VIEWING');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(
  ARRAY(SELECT file_id FROM public.file_events WHERE file_id::text LIKE '96960000-0000-0000-0000-0000000000e_' ORDER BY file_id),
  ARRAY['96960000-0000-0000-0000-0000000000e1']::uuid[],
  'a seated REVIEWER: the plain upload only');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(
  ARRAY(SELECT file_id FROM public.file_events WHERE file_id::text LIKE '96960000-0000-0000-0000-0000000000e_' ORDER BY file_id),
  ARRAY['96960000-0000-0000-0000-0000000000e1', '96960000-0000-0000-0000-0000000000e3']::uuid[],
  '🚨 a workspace MANAGER without a seat: the upload and the Legal file (0092''s arm) — no invoice (D8), no private project, NO REMOTE VIEWING');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(
  ARRAY(SELECT file_id FROM public.file_events WHERE file_id::text LIKE '96960000-0000-0000-0000-0000000000e_' ORDER BY file_id),
  ARRAY['96960000-0000-0000-0000-0000000000e1', '96960000-0000-0000-0000-0000000000e3', '96960000-0000-0000-0000-0000000000e4']::uuid[],
  'the private project''s CREATOR: its upload too (the project arm) — still no invoice and no remote viewing');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(
  ARRAY(SELECT file_id FROM public.file_events WHERE file_id::text LIKE '96960000-0000-0000-0000-0000000000e_' ORDER BY file_id),
  ARRAY['96960000-0000-0000-0000-0000000000e1', '96960000-0000-0000-0000-0000000000e2', '96960000-0000-0000-0000-0000000000e3',
        '96960000-0000-0000-0000-0000000000e4', '96960000-0000-0000-0000-0000000000e5']::uuid[],
  'a LIVE ADMIN: all five of A''s, the remote viewing included (D6)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '96960000-0000-0000-0000-0000000000a7', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.file_events WHERE file_id = '96960000-0000-0000-0000-0000000000e5'), 1,
  'a second live admin reads the remote viewing too');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '96960000-0000-0000-0000-0000000000a8', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(
  ARRAY(SELECT file_id FROM public.file_events WHERE file_id::text LIKE '96960000-0000-0000-0000-0000000000e_' ORDER BY file_id),
  ARRAY['96960000-0000-0000-0000-0000000000e1', '96960000-0000-0000-0000-0000000000e2', '96960000-0000-0000-0000-0000000000e3',
        '96960000-0000-0000-0000-0000000000e4']::uuid[],
  '🚨 a DEMOTED admin: the claim still opens every older arm (0074''s, by design) but NOT the remote viewing (F21: the live row)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '96960000-0000-0000-0000-0000000000a9', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(
  ARRAY(SELECT file_id FROM public.file_events WHERE file_id::text LIKE '96960000-0000-0000-0000-0000000000e_' ORDER BY file_id),
  ARRAY[]::uuid[],
  'an INACTIVE admin: nothing (the membership arm)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '22222222-2222-2222-2222-222222222222', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(
  ARRAY(SELECT file_id FROM public.file_events WHERE file_id::text LIKE '96960000-0000-0000-0000-0000000000e_' ORDER BY file_id),
  ARRAY['96960000-0000-0000-0000-0000000000e9']::uuid[],
  'the OTHER company''s admin: their own row only (the workspace arm)');

-- The shape CHECKs and the unique key, as postgres (no client writes file_events).
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT throws_ok(
  format($f$INSERT INTO public.file_events (workspace_id, project_id, file_id, event, subject, external_id, details)
            VALUES ('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000001', gen_random_uuid(),
                    'viewed_remote', 'bin_file', %L, %L::jsonb)$f$,
         current_setting('wg96.gw') || ':96960000-0000-0000-0000-000000000105',
         jsonb_build_object('gateway_id', current_setting('wg96.gw'))::text),
  '23505', NULL, '🚨 external_id refuses a duplicate: a retried batch writes nothing twice (F9)');
SELECT throws_ok(
  format($f$INSERT INTO public.file_events (workspace_id, project_id, file_id, event, subject, external_id, details)
            VALUES ('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000001', gen_random_uuid(),
                    'viewed_remote', 'bin_file', %L, %L::jsonb)$f$,
         '96960000-0000-0000-0000-00000000dead:96960000-0000-0000-0000-000000000106',
         jsonb_build_object('gateway_id', current_setting('wg96.gw'))::text),
  '23514', NULL, 'an external_id whose prefix is not the row''s own gateway is refused (no pre-claiming, F9)');
SELECT throws_ok(
  $$INSERT INTO public.file_events (workspace_id, project_id, file_id, event, subject, details)
    VALUES ('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000001', gen_random_uuid(),
            'viewed_remote', 'bin_file', '{}')$$,
  '23514', NULL, 'a remote viewing without an external_id is refused');
SELECT throws_ok(
  $$INSERT INTO public.file_events (workspace_id, project_id, file_id, event, subject, details)
    VALUES ('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000001', gen_random_uuid(),
            'uploaded', 'bin_file', '{}')$$,
  '23514', NULL, 'an ordinary event cannot claim to be about a bin file');


-- ── 110-114: workspace_audit — live admins only, written by no client ──────

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.workspace_audit), 0, 'a MEMBER reads none of the company''s audit');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '96960000-0000-0000-0000-0000000000a8', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.workspace_audit), 0, 'a DEMOTED admin reads none of it');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '22222222-2222-2222-2222-222222222222', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.workspace_audit WHERE workspace_id = '11111111-1111-1111-1111-111111111111'), 0,
  'another company''s admin reads none of A''s');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT ok((SELECT count(*) FROM public.workspace_audit WHERE gateway_id = current_setting('wg96.gw')::uuid) >= 5,
  'CONTROL: a live admin reads the gateway''s audit');
SELECT throws_ok(
  $$INSERT INTO public.workspace_audit (workspace_id, action) VALUES ('11111111-1111-1111-1111-111111111111', 'remote_viewing.off')$$,
  '42501', NULL, 'not even an admin can write an audit row');


-- ── 115-124: gateway_events_apply — every attribution derived (F3, R4) ─────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;

-- user_d was minted a ticket for the public clip.
INSERT INTO public.gateway_ticket_mints (jti, workspace_id, gateway_id, user_id, bin_file_id, project_id, file_name)
VALUES ('0123456789abcdef0123456789abcdef'::uuid, '11111111-1111-1111-1111-111111111111', current_setting('wg96.gw')::uuid,
        'dddddddd-dddd-dddd-dddd-dddddddddddd', '96960000-0000-0000-0000-0000000000f1',
        'aaaa1111-0000-0000-0000-000000000001', 'A001_C001');

SELECT set_config('wg96.events', public.gateway_events_apply(current_setting('wg96.gw')::uuid, jsonb_build_array(
  -- 1: a good viewing, minted; a payload that tries to name its own gateway and company is ignored
  jsonb_build_object('viewing_id', '96960000-0000-0000-0000-000000000201', 'clip', '96960000-0000-0000-0000-0000000000f1',
    'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ticket_jti', '0123456789abcdef0123456789abcdef',
    'started_at', now() - interval '3 minutes', 'ended_at', now() - interval '1 minute', 'bytes', 950,
    'clip_bytes', 1000, 'range_count', 12, 'first_offset', 0, 'last_offset', 999,
    'source_address', '203.0.113.50', 'source_addresses', jsonb_build_array('203.0.113.50', '198.51.100.9', 'nonsense'),
    'via', repeat('v', 300), 'user_agent', 'Chrome 142 on Windows', 'incomplete', false,
    'gateway_id', '96960000-0000-0000-0000-00000000dead', 'workspace_id', '22222222-2222-2222-2222-222222222222',
    'actor_label', 'Someone Else', 'file_name', 'forged.mov', 'project_id', 'bbbb2222-0000-0000-0000-000000000001'),
  -- 2: another company's clip
  jsonb_build_object('viewing_id', '96960000-0000-0000-0000-000000000202', 'clip', '96960000-0000-0000-0000-0000000000f3',
    'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ticket_jti', 'ffffffffffffffffffffffffffffff01',
    'started_at', now() - interval '3 minutes', 'ended_at', now(), 'bytes', 1),
  -- 3: a viewer who is not of this company
  jsonb_build_object('viewing_id', '96960000-0000-0000-0000-000000000203', 'clip', '96960000-0000-0000-0000-0000000000f1',
    'sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'ticket_jti', 'ffffffffffffffffffffffffffffff02',
    'started_at', now() - interval '3 minutes', 'ended_at', now(), 'bytes', 1),
  -- 4: user_d's real jti pinned on user_c
  jsonb_build_object('viewing_id', '96960000-0000-0000-0000-000000000204', 'clip', '96960000-0000-0000-0000-0000000000f1',
    'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'ticket_jti', '0123456789abcdef0123456789abcdef',
    'started_at', now() - interval '3 minutes', 'ended_at', now(), 'bytes', 1),
  -- 5: a pair never minted (user_c, the public clip), a made-up jti
  jsonb_build_object('viewing_id', '96960000-0000-0000-0000-000000000205', 'clip', '96960000-0000-0000-0000-0000000000f1',
    'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'ticket_jti', 'ffffffffffffffffffffffffffffff03',
    'started_at', now() - interval '3 minutes', 'ended_at', now(), 'bytes', 1),
  -- 6: a pair that WAS minted, but this jti is not in the log: written, flagged
  jsonb_build_object('viewing_id', '96960000-0000-0000-0000-000000000206', 'clip', '96960000-0000-0000-0000-0000000000f1',
    'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ticket_jti', 'ffffffffffffffffffffffffffffff04',
    'started_at', now() - interval '3 minutes', 'ended_at', NULL, 'incomplete', true, 'bytes', 5),
  -- 7: before the gateway was enrolled
  jsonb_build_object('viewing_id', '96960000-0000-0000-0000-000000000207', 'clip', '96960000-0000-0000-0000-0000000000f1',
    'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ticket_jti', '0123456789abcdef0123456789abcdef',
    'started_at', now() - interval '2 days', 'ended_at', now() - interval '2 days', 'bytes', 1),
  -- 8: the first one again (a retried batch)
  jsonb_build_object('viewing_id', '96960000-0000-0000-0000-000000000201', 'clip', '96960000-0000-0000-0000-0000000000f1',
    'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ticket_jti', '0123456789abcdef0123456789abcdef',
    'started_at', now() - interval '3 minutes', 'ended_at', now() - interval '1 minute', 'bytes', 950),
  -- 9: malformed
  jsonb_build_object('viewing_id', 'not-a-uuid', 'clip', '96960000-0000-0000-0000-0000000000f1'),
  -- 10: a bad boolean must refuse the row, not the batch
  jsonb_build_object('viewing_id', '96960000-0000-0000-0000-000000000210', 'clip', '96960000-0000-0000-0000-0000000000f1',
    'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ticket_jti', '0123456789abcdef0123456789abcdef',
    'started_at', now() - interval '3 minutes', 'ended_at', now(), 'bytes', 1, 'shared_url', 'maybe')
))::text, true);

SELECT is(
  current_setting('wg96.events')::jsonb -> 'accepted',
  '["96960000-0000-0000-0000-000000000201", "96960000-0000-0000-0000-000000000206", "96960000-0000-0000-0000-000000000201"]'::jsonb,
  'accepted: the minted viewing, the flagged one, and the retry of the first (acknowledged, not rewritten)');
SELECT is(
  (SELECT jsonb_agg(x ->> 'reason' ORDER BY ord) FROM jsonb_array_elements(current_setting('wg96.events')::jsonb -> 'rejected') WITH ORDINALITY AS t(x, ord)),
  '["unknown_clip", "unknown_viewer", "mint_mismatch", "never_minted", "time", "malformed", "malformed"]'::jsonb,
  '🚨 refused, each for its reason: another company''s clip, a stranger, a jti pinned on someone else, a pair never minted, a time before the gateway, two malformed rows');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT ok(
  (SELECT external_id = current_setting('wg96.gw') || ':96960000-0000-0000-0000-000000000201'
          AND workspace_id = '11111111-1111-1111-1111-111111111111'
          AND project_id = 'aaaa1111-0000-0000-0000-000000000001'
          AND actor_user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' AND actor_label = 'User D'
          AND file_name = 'A001_C001' AND subject = 'bin_file' AND size_bytes = 950
          AND details ->> 'gateway_id' = current_setting('wg96.gw')
     FROM public.file_events WHERE external_id LIKE '%:96960000-0000-0000-0000-000000000201'),
  '🚨 the row''s company, project, name, viewer label and gateway are the cloud''s own — the payload''s gateway_id, workspace_id, project_id, file_name and actor_label were ignored (F3)');
SELECT ok(
  (SELECT (details ->> 'unverified_mint')::boolean = false AND (details ->> 'read_in_full')::boolean
          AND (details ->> 'fraction')::numeric = 0.95 AND char_length(details ->> 'via') = 64
          AND details -> 'source_addresses' = '["198.51.100.9", "203.0.113.50"]'::jsonb
          AND (details ->> 'shared_url')::boolean
     FROM public.file_events WHERE external_id LIKE '%:96960000-0000-0000-0000-000000000201'),
  'the viewing''s facts: verified mint, the fraction and read in full, the strings truncated, two real addresses (shared_url), the junk one dropped');
SELECT ok(
  (SELECT (details ->> 'unverified_mint')::boolean AND (details ->> 'incomplete')::boolean AND details ->> 'ended_at' IS NULL
     FROM public.file_events WHERE external_id LIKE '%:96960000-0000-0000-0000-000000000206'),
  'a viewing whose own mint is missing is written, flagged unverified_mint (R4), and its unknown end is said');
SELECT is((SELECT count(*)::int FROM public.file_events WHERE external_id LIKE '%:96960000-0000-0000-0000-000000000201'), 1,
  'the retried viewing is one row, not two');

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  format('SELECT public.gateway_events_apply(%L::uuid, ''[]''::jsonb)', current_setting('wg96.gw')),
  '42501', NULL, 'an admin cannot call the events RPC (the service role''s alone)');


-- ── 125-134: gateway_sync_apply — the catalogue check, the source, the check

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;

SELECT set_config('wg96.sync1', public.gateway_sync_apply(current_setting('wg96.gw')::uuid,
  jsonb_build_object('version', '1.0.1', 'hostname', 'studio-nas',
    'inside_addresses', jsonb_build_array(jsonb_build_object('host', '192.168.1.10', 'port', 8443)),
    'reach', jsonb_build_object('96960000-0000-0000-0000-0000000000c1', 'reachable',
                                '96960000-0000-0000-0000-0000000000c2', 'reachable',
                                'not-a-location', 'reachable'),
    'health', jsonb_build_object('doors', jsonb_build_object('inside', 'open', 'outside', 'closed_switch_off'),
                                 'update', 'up_to_date')),
  '198.51.100.7'::inet,
  jsonb_build_array(
    jsonb_build_object('clip', '96960000-0000-0000-0000-0000000000f1', 'loc', '96960000-0000-0000-0000-0000000000c1', 'path', 'A001/other.mov'),
    jsonb_build_object('clip', '96960000-0000-0000-0000-0000000000f3', 'loc', '96960000-0000-0000-0000-0000000000c2', 'path', 'B001/b.mov'),
    jsonb_build_object('clip', '96960000-0000-0000-0000-0000000000f2', 'loc', '96960000-0000-0000-0000-0000000000c1', 'path', 'P001/secret.mov'))
)::text, true);

SELECT is(current_setting('wg96.sync1')::jsonb -> 'confirmed',
  '["96960000-0000-0000-0000-0000000000f2"]'::jsonb,
  '🚨 the catalogue check confirms a clip of this company at its own path (the private one too: workspace scope, R23) — never a clip at another path, never another company''s clip (D22)');
SELECT is(
  (SELECT jsonb_agg(l ->> 'id') FROM jsonb_array_elements(current_setting('wg96.sync1')::jsonb -> 'bin_locations') AS l
    WHERE l ->> 'id' LIKE '96960000-%'),
  '["96960000-0000-0000-0000-0000000000c1"]'::jsonb,
  'the gateway is told its own company''s locations and not another''s');
SELECT ok(
  (current_setting('wg96.sync1')::jsonb ->> 'remote_viewing') = 'false'
  AND current_setting('wg96.sync1')::jsonb -> 'outside_address' = '{"host": "gateway.example.com", "port": 8444}'::jsonb
  AND current_setting('wg96.sync1')::jsonb -> 'office_ranges' = '["10.8.0.0/16"]'::jsonb
  AND current_setting('wg96.sync1')::jsonb -> 'signing_keys' = '[]'::jsonb,
  'the answer carries the switch, the outside address, the office ranges and the (still empty) keys');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT ok(
  (SELECT reach = '{"96960000-0000-0000-0000-0000000000c1": "reachable"}'::jsonb AND version = '1.0.1' AND NOT outside_open
     FROM public.gateways WHERE id = current_setting('wg96.gw')::uuid),
  'the report is applied: reach for this company''s location only, the version, the door closed');

-- Postgres stands in for a passed check; then the sync arrives from another
-- public address (R6).
UPDATE public.gateways SET reach_ok = true, reach_checked_at = now(), reach_detail = 'reached',
                           reach_nonce_at = now() - interval '1 hour'
 WHERE id = current_setting('wg96.gw')::uuid;
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;
SELECT set_config('wg96.sync2', public.gateway_sync_apply(current_setting('wg96.gw')::uuid,
  '{"version": "1.0.1"}'::jsonb, '198.51.100.8'::inet, '[]'::jsonb)::text, true);

SELECT ok(
  current_setting('wg96.sync2')::jsonb -> 'background_check' ->> 'nonce' ~ '^[0-9a-f]{32}$'
  AND (current_setting('wg96.sync2')::jsonb ->> 'check_reach_now')::boolean
  AND current_setting('wg96.sync2')::jsonb ->> 'reach_nonce' = current_setting('wg96.sync2')::jsonb -> 'background_check' ->> 'nonce',
  '🚨 a sync from a new public address begins a check at once, its nonce in the same answer (R6)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT ok(
  (SELECT reach_ok IS NULL AND reach_detail = 'source_changed' AND last_sync_source = '198.51.100.8'::inet
     FROM public.gateways WHERE id = current_setting('wg96.gw')::uuid),
  'and the address is withdrawn on the spot: reach_ok cleared until the check passes again');

SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;
SELECT is(
  public.gateway_reach_begin(current_setting('wg96.gw')::uuid, '11111111-1111-1111-1111-111111111111') ->> 'reason',
  'busy', 'one check at a time: an admin''s check while one runs reads busy (R16)');
SELECT is(
  public.gateway_reach_begin(current_setting('wg96.gw')::uuid, '22222222-2222-2222-2222-222222222222') ->> 'reason',
  'not_found', 'another company''s admin cannot check this gateway');
SELECT ok(
  NOT public.gateway_reach_finish(current_setting('wg96.gw')::uuid, gen_random_uuid(),
        '{"host": "gateway.example.com", "port": 8444}'::jsonb,
        '{"outside": {"ok": true, "is_this_gateway": true, "detail": "reached"}}'::jsonb, NULL)
  AND public.gateway_reach_finish(current_setting('wg96.gw')::uuid,
        (current_setting('wg96.sync2')::jsonb -> 'background_check' ->> 'check_id')::uuid,
        '{"host": "gateway.example.com", "port": 8444}'::jsonb,
        '{"outside": {"ok": true, "is_this_gateway": true, "detail": "reached", "ms": 140}, "inside_answered": false}'::jsonb, NULL),
  'a stale check id records nothing; the running check records its result');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT ok(
  (SELECT reach_ok AND reach_detail = 'reached' AND reach_nonce IS NULL AND reach_check_id IS NULL
     FROM public.gateways WHERE id = current_setting('wg96.gw')::uuid)
  AND EXISTS (SELECT 1 FROM public.workspace_audit WHERE gateway_id = current_setting('wg96.gw')::uuid
                AND action = 'gateway.reach_checked' AND actor_user_id IS NULL AND (details ->> 'automatic')::boolean),
  'reach_ok is set by the check alone, the nonce cleared, and the automatic check written down');


-- ── 135-137: an address changed mid-check is never published by the old check

SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;
SELECT set_config('wg96.begin', public.gateway_reach_begin(current_setting('wg96.gw')::uuid,
  '11111111-1111-1111-1111-111111111111')::text, true);

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
UPDATE public.gateways SET outside_address = '{"host": "other.example.com", "port": 8444}'::jsonb
 WHERE id = current_setting('wg96.gw')::uuid;

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;
SELECT ok(
  (current_setting('wg96.begin')::jsonb ->> 'began')::boolean
  AND NOT public.gateway_reach_finish(current_setting('wg96.gw')::uuid,
        (current_setting('wg96.begin')::jsonb ->> 'check_id')::uuid,
        current_setting('wg96.begin')::jsonb -> 'address',
        '{"outside": {"ok": true, "is_this_gateway": true, "detail": "reached"}}'::jsonb,
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  '🚨 a check begun for the old address cannot publish the new one (the address changed mid-check)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT ok((SELECT reach_ok IS NULL FROM public.gateways WHERE id = current_setting('wg96.gw')::uuid),
  'the new address stays unpublished');

SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;
SELECT set_config('wg96.begin2', public.gateway_reach_begin(current_setting('wg96.gw')::uuid,
  '11111111-1111-1111-1111-111111111111')::text, true);
SELECT ok(
  NOT public.gateway_reach_finish(current_setting('wg96.gw')::uuid,
        (current_setting('wg96.begin2')::jsonb ->> 'check_id')::uuid,
        '{"host": "evil.example.com", "port": 8444}'::jsonb,
        '{"outside": {"ok": true, "is_this_gateway": true, "detail": "reached"}}'::jsonb, NULL)
  AND public.gateway_reach_finish(current_setting('wg96.gw')::uuid,
        (current_setting('wg96.begin2')::jsonb ->> 'check_id')::uuid,
        current_setting('wg96.begin2')::jsonb -> 'address',
        '{"outside": {"ok": false, "is_this_gateway": false, "detail": "timed_out"}, "inside_answered": false}'::jsonb, NULL),
  'a result for an address the row does not hold records nothing, even with the running check''s id; the probed address records its result');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- Check now (§8) rides the next sync, once.
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT public.gateway_request_update_check(current_setting('wg96.gw')::uuid) IS NOT NULL AS asked;
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;
SELECT ok(
  (public.gateway_sync_apply(current_setting('wg96.gw')::uuid, '{}'::jsonb, '198.51.100.8'::inet, '[]'::jsonb) ->> 'check_update_now')::boolean
  AND NOT (public.gateway_sync_apply(current_setting('wg96.gw')::uuid, '{}'::jsonb, '198.51.100.8'::inet, '[]'::jsonb) ->> 'check_update_now')::boolean,
  'Check now reaches the gateway at its next sync, and only that one');


-- ── 138-140: Forget, its minute, and the sweep that makes it final ─────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT public.gateway_forget(current_setting('wg96.gw')::uuid) IS NOT NULL AS forgotten;
SELECT is((SELECT count(*)::int FROM public.gateways_visible WHERE id = current_setting('wg96.gw')::uuid), 0,
  'Forget takes the gateway out of gateways_visible at once (§2: the cloud''s own bound, R18)');
SELECT ok(public.gateway_unforget(current_setting('wg96.gw')::uuid),
  'Undo within the minute is accepted');
SELECT is((SELECT count(*)::int FROM public.gateways_visible WHERE id = current_setting('wg96.gw')::uuid), 1,
  'and the gateway is back in the view');

SELECT public.gateway_forget(current_setting('wg96.gw')::uuid) IS NOT NULL AS forgotten;
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
UPDATE public.gateways SET revoked_at = now() - interval '2 minutes' WHERE id = current_setting('wg96.gw')::uuid;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(format('SELECT public.gateway_unforget(%L::uuid)', current_setting('wg96.gw')), '55000', NULL,
  'after the minute, Forget cannot be undone');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;
INSERT INTO public.gateway_ticket_mints (jti, workspace_id, gateway_id, user_id, bin_file_id, minted_at)
VALUES ('00000000000000000000000000009696'::uuid, '11111111-1111-1111-1111-111111111111', current_setting('wg96.gw')::uuid,
        'dddddddd-dddd-dddd-dddd-dddddddddddd', '96960000-0000-0000-0000-0000000000f1', now() - interval '31 days');
SELECT public.gateway_sweep() IS NOT NULL AS swept;
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.gateway_secrets WHERE gateway_id = current_setting('wg96.gw')::uuid)
  AND EXISTS (SELECT 1 FROM public.workspace_audit WHERE gateway_id = current_setting('wg96.gw')::uuid AND action = 'gateway.revoked')
  AND NOT EXISTS (SELECT 1 FROM public.gateway_ticket_mints WHERE jti = '00000000000000000000000000009696'::uuid)
  AND EXISTS (SELECT 1 FROM public.gateway_ticket_mints WHERE jti = '0123456789abcdef0123456789abcdef'::uuid)
  AND (public.gateway_sync_apply(current_setting('wg96.gw')::uuid, '{}'::jsonb, NULL, '[]'::jsonb) ->> 'revoked')::boolean,
  '🚨 the sweep deletes the forgotten gateway''s credential (gateway.revoked) and the mints past thirty days; its sync reads revoked');

SELECT * FROM finish();
ROLLBACK;
