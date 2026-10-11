-- =============================================================================
-- 98_gateway_next_root_viewing_fraction.sql — migration 0095 (GW3, 2026-10-11:
-- the two halves of the file gateway reconciled): a new or next root
-- certificate reported at sync, and a viewing's fraction.
--
-- What this pins (the GW3 brief, item 0, points 3 and 4):
--   * The next root's five columns, their CHECK (the fingerprint computed by
--     the database from the PEM, never the gateway's claim; different from
--     the confirmed root's), and their grants: an admin reads the fingerprint
--     and the times, never the PEM; nothing is writable by a client; the view
--     a browser reads carries none of it.
--   * gateway_sync_apply: the confirmed root reported again changes nothing;
--     a next root lands with its fingerprint, once (a repeat writes no second
--     trail row); a key or a fragment is ignored; a replacement root the
--     gateway already signs with lands as the next root too, in use, until
--     the admin confirms it; a CONFIRMED next root reported in use is
--     promoted into the root's place with the confirmation it carried.
--   * gateway_confirm_root: the next root's fingerprint, from the enrolling
--     admin only (D25, asked again), with the same refusals; a wrong one is
--     refused with a sentence; the old root stays confirmed.
--   * gateway_root_certificate keeps serving the old root until the promotion;
--     gateway_next_root_certificate serves the new one only once confirmed.
--   * gateway_events_apply: the gateway's `fraction` is taken when present
--     (clamped to 0–1), else bytes / clip_bytes; read_in_full is computed
--     from it (≥ 0.9) and NEVER taken from the payload; a fraction that is no
--     number refuses the row; `fraction_from` says which rule applied.
--
-- Postgres-side reads are ALWAYS scoped to fixture ids — dev carries real
-- rows (S33). 96_gateways.sql proves 0093's shapes; this suite proves what
-- 0095 changed and that the replaced functions still answer as 96 expects.
-- =============================================================================

BEGIN;

SELECT plan(48);

SELECT * FROM tests.rls_setup();

-- ── Extra fixtures ─────────────────────────────────────────────────────────
--   user_a  admin of A (rls_setup) — the ENROLLING admin
--   g98     a second LIVE admin of A (not the enrolling one)
--   m98     a plain member of A
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('98980000-0000-0000-0000-0000000000a1', 'user_g98@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('98980000-0000-0000-0000-0000000000a2', 'user_m98@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', '98980000-0000-0000-0000-0000000000a1', 'admin', 'user_g98', 'User G98', true),
  ('11111111-1111-1111-1111-111111111111', '98980000-0000-0000-0000-0000000000a2', 'user',  'user_m98', 'User M98', true)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET app_role = EXCLUDED.app_role, is_active = EXCLUDED.is_active;

-- The catalogue the fraction probes read: one location, one bin, one clip
-- of 1,000 bytes in A's public project (rls_setup's).
INSERT INTO public.bin_locations (id, workspace_id, name, unc_path) VALUES
  ('98980000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'Footage 98', '\\studio-nas98\footage');
INSERT INTO public.bins (id, project_id, workspace_id, name, kind) VALUES
  ('98980000-0000-0000-0000-0000000000d1', 'aaaa1111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Day 98', 'footage');
INSERT INTO public.bin_files (id, project_id, workspace_id, bin_id, location_id, relative_path, display_name, original_name, extension, mime_type, media_type, size_bytes) VALUES
  ('98980000-0000-0000-0000-0000000000f1', 'aaaa1111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '98980000-0000-0000-0000-0000000000d1', '98980000-0000-0000-0000-0000000000c1', 'A001/A001_C098.mov', 'A001_C098', 'A001_C098.mov', 'mov', 'video/quicktime', 'video', 1000);

-- Three "certificates": the DER is a byte 0x30 and ninety of one value, which
-- gateway_pem_fingerprint accepts (96's shape); A is the enrolment's root, B
-- the next one, C a replacement already in use.
SELECT set_config('wg98.pem_a', '-----BEGIN CERTIFICATE-----' || chr(10)
  || encode(decode('30' || repeat('5a', 90), 'hex'), 'base64') || chr(10) || '-----END CERTIFICATE-----', true);
SELECT set_config('wg98.pem_b', '-----BEGIN CERTIFICATE-----' || chr(10)
  || encode(decode('30' || repeat('5b', 90), 'hex'), 'base64') || chr(10) || '-----END CERTIFICATE-----', true);
SELECT set_config('wg98.pem_c', '-----BEGIN CERTIFICATE-----' || chr(10)
  || encode(decode('30' || repeat('5c', 90), 'hex'), 'base64') || chr(10) || '-----END CERTIFICATE-----', true);
SELECT set_config('wg98.fp_a', encode(sha256(decode('30' || repeat('5a', 90), 'hex')), 'hex'), true);
SELECT set_config('wg98.fp_b', encode(sha256(decode('30' || repeat('5b', 90), 'hex')), 'hex'), true);
SELECT set_config('wg98.fp_c', encode(sha256(decode('30' || repeat('5c', 90), 'hex')), 'hex'), true);

-- A pending token of user_a's, made by postgres directly (24 hours left).
INSERT INTO public.gateway_enrolment_tokens (workspace_id, token_hash, created_by, created_at, expires_at)
VALUES ('11111111-1111-1111-1111-111111111111',
        encode(sha256(convert_to('wgt_ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEF', 'UTF8')), 'hex'),
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now(), now() + interval '24 hours');


-- ── 1-6: structure ─────────────────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'gateways'
      AND column_name IN ('next_root_cert_pem', 'next_root_fingerprint', 'next_root_seen_at', 'next_root_confirmed_at', 'next_root_confirmed_by')),
  5, 'gateways has the next root''s five columns (0095 A1)');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gateways_next_root_chk'
           AND pg_get_constraintdef(oid) LIKE '%gateway_pem_fingerprint(next_root_cert_pem)%'
           AND pg_get_constraintdef(oid) LIKE '%IS DISTINCT FROM root_fingerprint%'),
  'gateways_next_root_chk ties the fingerprint to the PEM the database fingerprints, and keeps it distinct from the root''s');

SELECT ok(
  NOT has_column_privilege('authenticated', 'public.gateways', 'next_root_cert_pem', 'SELECT')
  AND has_column_privilege('authenticated', 'public.gateways', 'next_root_fingerprint', 'SELECT')
  AND has_column_privilege('authenticated', 'public.gateways', 'next_root_confirmed_at', 'SELECT')
  AND has_column_privilege('authenticated', 'public.gateways', 'next_root_seen_at', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.gateways', 'next_root_fingerprint', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.gateways', 'next_root_confirmed_at', 'UPDATE'),
  '🚨 a client reads the next root''s fingerprint and times, never its PEM, and writes none of them');

SELECT ok(
  to_regprocedure('public.gateway_next_root_certificate(uuid)') IS NOT NULL
  AND has_function_privilege('authenticated', 'public.gateway_next_root_certificate(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.gateway_next_root_certificate(uuid)', 'EXECUTE'),
  'gateway_next_root_certificate exists, the authenticated role''s and not anon''s');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_audit_action_chk'
           AND pg_get_constraintdef(oid) LIKE '%gateway.next_root_received%'
           AND pg_get_constraintdef(oid) LIKE '%gateway.next_root_confirmed%'
           AND pg_get_constraintdef(oid) LIKE '%gateway.root_replaced%'
           AND pg_get_constraintdef(oid) LIKE '%gateway.keys_rotated%'),
  'the trail''s vocabulary has the three new words beside 0093''s');

SELECT is(
  (SELECT count(*)::int FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'gateways_visible' AND column_name LIKE 'next_root%'),
  0, 'gateways_visible (the view a browser reads) carries nothing of the next root');


-- ── 7-9: enrolment and the root's confirmation, as 96 does them ────────────

SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;

SELECT set_config('wg98.enrol', public.gateway_enrol_apply(
  encode(sha256(convert_to('wgt_ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEF', 'UTF8')), 'hex'),
  encode(sha256(convert_to('wgc_suite98-credential', 'UTF8')), 'hex'),
  jsonb_build_object('name', 'Studio NAS 98', 'platform', 'container', 'version', '1.0.0', 'hostname', 'studio-nas98',
    'inside_addresses', jsonb_build_array(jsonb_build_object('host', '192.168.98.10', 'port', 8443)),
    'root_cert_pem', current_setting('wg98.pem_a')),
  '198.51.100.98'::inet,
  encode(sha256(convert_to('wilson-reach-key:wgc_suite98-credential', 'UTF8')), 'hex'))::text, true);
SELECT set_config('wg98.gw', current_setting('wg98.enrol')::jsonb ->> 'gateway_id', true);

SELECT is((current_setting('wg98.enrol')::jsonb ->> 'ok'), 'true', 'the service role enrols the gateway with root A');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT ok(public.gateway_confirm_root(current_setting('wg98.gw')::uuid, current_setting('wg98.fp_a')) IS NOT NULL,
  'the enrolling admin confirms root A''s fingerprint (D25, as before)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('wg98.root_confirmed', (SELECT root_confirmed_at::text FROM public.gateways WHERE id = current_setting('wg98.gw')::uuid), true);
SELECT ok(
  (SELECT root_fingerprint = current_setting('wg98.fp_a') AND root_confirmed_at IS NOT NULL
          AND next_root_cert_pem IS NULL AND next_root_fingerprint IS NULL AND next_root_seen_at IS NULL
          AND next_root_confirmed_at IS NULL AND next_root_confirmed_by IS NULL
     FROM public.gateways WHERE id = current_setting('wg98.gw')::uuid),
  'root A confirmed; the next root''s five columns empty');


-- ── 10-15: a next root arrives at sync (0095 A3) ───────────────────────────

SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;

-- After a start the gateway sends the root it signs with: the confirmed one.
SELECT public.gateway_sync_apply(current_setting('wg98.gw')::uuid,
  jsonb_build_object('version', '1.0.0', 'root_cert_pem', current_setting('wg98.pem_a')),
  '198.51.100.98'::inet, '[]'::jsonb);
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT ok(
  (SELECT next_root_fingerprint IS NULL AND root_fingerprint = current_setting('wg98.fp_a')
     FROM public.gateways WHERE id = current_setting('wg98.gw')::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.workspace_audit WHERE gateway_id = current_setting('wg98.gw')::uuid AND action = 'gateway.next_root_received'),
  'the confirmed root, reported again after a start, changes nothing (CONTROL)');

-- A year before root A's end the gateway makes root B and sends it beside A.
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;
SELECT public.gateway_sync_apply(current_setting('wg98.gw')::uuid,
  jsonb_build_object('version', '1.0.0', 'root_cert_pem', current_setting('wg98.pem_a'), 'next_root_cert_pem', current_setting('wg98.pem_b')),
  '198.51.100.98'::inet, '[]'::jsonb);
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT ok(
  (SELECT next_root_cert_pem = current_setting('wg98.pem_b') AND next_root_fingerprint = current_setting('wg98.fp_b')
          AND next_root_seen_at IS NOT NULL AND next_root_confirmed_at IS NULL AND next_root_confirmed_by IS NULL
          AND root_fingerprint = current_setting('wg98.fp_a') AND root_confirmed_at = current_setting('wg98.root_confirmed')::timestamptz
     FROM public.gateways WHERE id = current_setting('wg98.gw')::uuid),
  '🚨 the next root lands with the fingerprint the DATABASE computed, unconfirmed; root A and its confirmation untouched');
SELECT ok(
  EXISTS (SELECT 1 FROM public.workspace_audit WHERE gateway_id = current_setting('wg98.gw')::uuid
           AND action = 'gateway.next_root_received' AND actor_user_id IS NULL
           AND details ->> 'fingerprint' = current_setting('wg98.fp_b') AND (details ->> 'in_use')::boolean = false),
  'the trail says a next root arrived, by its fingerprint, not yet in use, with no actor (the gateway''s doing)');

SELECT set_config('wg98.seen', (SELECT next_root_seen_at::text FROM public.gateways WHERE id = current_setting('wg98.gw')::uuid), true);
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;
SELECT public.gateway_sync_apply(current_setting('wg98.gw')::uuid,
  jsonb_build_object('version', '1.0.0', 'next_root_cert_pem', current_setting('wg98.pem_b')),
  '198.51.100.98'::inet, '[]'::jsonb);
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT ok(
  (SELECT count(*) FROM public.workspace_audit WHERE gateway_id = current_setting('wg98.gw')::uuid AND action = 'gateway.next_root_received') = 1
  AND (SELECT next_root_seen_at::text = current_setting('wg98.seen') FROM public.gateways WHERE id = current_setting('wg98.gw')::uuid),
  'the same next root at the next sync writes no second trail row and keeps its first-seen time');

SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;
SELECT public.gateway_sync_apply(current_setting('wg98.gw')::uuid,
  jsonb_build_object('version', '1.0.0', 'root_cert_pem', current_setting('wg98.pem_a'), 'next_root_cert_pem', 'not a certificate at all'),
  '198.51.100.98'::inet, '[]'::jsonb);
SELECT public.gateway_sync_apply(current_setting('wg98.gw')::uuid,
  jsonb_build_object('version', '1.0.0', 'next_root_cert_pem',
    '-----BEGIN PRIVATE KEY-----' || chr(10) || encode(decode('30' || repeat('5d', 90), 'hex'), 'base64') || chr(10) || '-----END PRIVATE KEY-----'),
  '198.51.100.98'::inet, '[]'::jsonb);
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT ok(
  (SELECT next_root_fingerprint = current_setting('wg98.fp_b') AND root_fingerprint = current_setting('wg98.fp_a')
     FROM public.gateways WHERE id = current_setting('wg98.gw')::uuid),
  'a fragment that is no certificate is ignored: root B stays the next root');
SELECT is(
  (SELECT count(*)::int FROM public.workspace_audit WHERE gateway_id = current_setting('wg98.gw')::uuid AND action = 'gateway.next_root_received'),
  1, '🚨 a PRIVATE KEY block sent as a root is ignored too (gateway_pem_fingerprint refuses it), and nothing is written down');


-- ── 16-19: what an admin reads, and who may confirm ────────────────────────

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is((SELECT next_root_fingerprint FROM public.gateways WHERE id = current_setting('wg98.gw')::uuid),
  current_setting('wg98.fp_b'), 'the admin reads the next root''s fingerprint, to confirm it against the gateway''s own screen');
SELECT throws_ok(
  format('SELECT next_root_cert_pem FROM public.gateways WHERE id = %L::uuid', current_setting('wg98.gw')),
  '42501', NULL, '🚨 not even the admin reads the next root''s PEM from the table (the column grant leaves it out)');
SELECT throws_ok(format('SELECT public.gateway_next_root_certificate(%L::uuid)', current_setting('wg98.gw')), '55000', NULL,
  '🚨 the new certificate is not offered before its fingerprint is confirmed (D25 in the database, again)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '98980000-0000-0000-0000-0000000000a1', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  format('SELECT public.gateway_confirm_root(%L::uuid, %L)', current_setting('wg98.gw'), current_setting('wg98.fp_b')),
  '42501', NULL, 'another live admin cannot confirm the next root either: only the one who made the token (R10)');


-- ── 20-24: confirming the next root (0095 A4) and the two downloads (A5) ───

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  format('SELECT public.gateway_confirm_root(%L::uuid, %L)', current_setting('wg98.gw'), repeat('ab', 32)),
  '22023', NULL, 'a fingerprint that is neither root''s is refused with the mismatch sentence');
SELECT ok(
  public.gateway_confirm_root(current_setting('wg98.gw')::uuid,
    upper(regexp_replace(current_setting('wg98.fp_b'), '(..)(?!$)', '\1:', 'g'))) IS NOT NULL,
  'the enrolling admin confirms root B as printed — upper case, colons between the pairs');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('wg98.next_confirmed', (SELECT next_root_confirmed_at::text FROM public.gateways WHERE id = current_setting('wg98.gw')::uuid), true);
SELECT ok(
  (SELECT next_root_confirmed_at IS NOT NULL AND next_root_confirmed_by = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
          AND root_confirmed_at = current_setting('wg98.root_confirmed')::timestamptz AND root_fingerprint = current_setting('wg98.fp_a')
     FROM public.gateways WHERE id = current_setting('wg98.gw')::uuid),
  'the next root is confirmed, by the admin; root A and its confirmation stay as they were');
SELECT ok(
  EXISTS (SELECT 1 FROM public.workspace_audit WHERE gateway_id = current_setting('wg98.gw')::uuid
           AND action = 'gateway.next_root_confirmed' AND actor_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
           AND details ->> 'fingerprint' = current_setting('wg98.fp_b')),
  'the trail says who confirmed the new certificate''s fingerprint');

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT ok(
  public.gateway_root_certificate(current_setting('wg98.gw')::uuid) = current_setting('wg98.pem_a')
  AND public.gateway_next_root_certificate(current_setting('wg98.gw')::uuid) = current_setting('wg98.pem_b'),
  '🚨 Download certificate still serves root A; Download the new certificate serves root B: whichever is confirmed, beside each other');


-- ── 25-26: a confirmed next root is never replaced from a sync (GW3 review
--    round 1, finding 9) ──────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('wg98.pem_d', '-----BEGIN CERTIFICATE-----' || chr(10)
  || encode(decode('30' || repeat('5e', 90), 'hex'), 'base64') || chr(10) || '-----END CERTIFICATE-----', true);
SELECT set_config('wg98.fp_d', encode(sha256(decode('30' || repeat('5e', 90), 'hex')), 'hex'), true);
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;
-- Between B's confirmation and its use the gateway (a bug, or a stolen
-- credential) reports a third root, twice.
SELECT public.gateway_sync_apply(current_setting('wg98.gw')::uuid,
  jsonb_build_object('version', '1.0.0', 'next_root_cert_pem', current_setting('wg98.pem_d')),
  '198.51.100.98'::inet, '[]'::jsonb);
SELECT public.gateway_sync_apply(current_setting('wg98.gw')::uuid,
  jsonb_build_object('version', '1.0.0', 'next_root_cert_pem', current_setting('wg98.pem_d')),
  '198.51.100.98'::inet, '[]'::jsonb);
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT ok(
  (SELECT next_root_fingerprint = current_setting('wg98.fp_b')
          AND next_root_confirmed_at = current_setting('wg98.next_confirmed')::timestamptz
          AND next_root_confirmed_by = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
     FROM public.gateways WHERE id = current_setting('wg98.gw')::uuid),
  '🚨 a confirmed next root is never replaced from a sync: a third root reported keeps B and its confirmation');
SELECT is(
  (SELECT count(*)::int FROM public.workspace_audit WHERE gateway_id = current_setting('wg98.gw')::uuid
     AND action = 'gateway.next_root_received' AND details ->> 'fingerprint' = current_setting('wg98.fp_d')
     AND (details ->> 'kept_confirmed')::boolean = true),
  1, 'the third root is written down once, as kept out of the slot, however often it is reported');


-- ── 27-32: the promotion, and a replacement root in use ────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;
-- A month before root A's end the gateway switches its leaf to root B and
-- reports B as the root it signs with.
SELECT public.gateway_sync_apply(current_setting('wg98.gw')::uuid,
  jsonb_build_object('version', '1.0.0', 'root_cert_pem', current_setting('wg98.pem_b')),
  '198.51.100.98'::inet, '[]'::jsonb);
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT ok(
  (SELECT root_cert_pem = current_setting('wg98.pem_b') AND root_fingerprint = current_setting('wg98.fp_b')
          AND root_confirmed_at = current_setting('wg98.next_confirmed')::timestamptz
          AND root_confirmed_by = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
          AND next_root_cert_pem IS NULL AND next_root_fingerprint IS NULL AND next_root_seen_at IS NULL
          AND next_root_confirmed_at IS NULL AND next_root_confirmed_by IS NULL
     FROM public.gateways WHERE id = current_setting('wg98.gw')::uuid),
  '🚨 a confirmed next root reported in use is promoted: root B with the confirmation it carried, the next-root slot emptied');
SELECT ok(
  EXISTS (SELECT 1 FROM public.workspace_audit WHERE gateway_id = current_setting('wg98.gw')::uuid
           AND action = 'gateway.root_replaced' AND details ->> 'fingerprint' = current_setting('wg98.fp_b')
           AND details ->> 'previous' = current_setting('wg98.fp_a')),
  'the trail says the root was replaced, naming both fingerprints');

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(public.gateway_root_certificate(current_setting('wg98.gw')::uuid), current_setting('wg98.pem_b'),
  'Download certificate now serves root B');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '98980000-0000-0000-0000-0000000000a2', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT root_fingerprint FROM public.gateways_visible WHERE id = current_setting('wg98.gw')::uuid),
  current_setting('wg98.fp_b'), 'a member''s browser reads the promoted root''s fingerprint from the view');

-- An inside address left root B's /24s: the gateway made root C and signs
-- with it at once, before any admin has seen its fingerprint.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;
SELECT public.gateway_sync_apply(current_setting('wg98.gw')::uuid,
  jsonb_build_object('version', '1.0.0', 'root_cert_pem', current_setting('wg98.pem_c')),
  '198.51.100.98'::inet, '[]'::jsonb);
SELECT public.gateway_sync_apply(current_setting('wg98.gw')::uuid,
  jsonb_build_object('version', '1.0.0', 'root_cert_pem', current_setting('wg98.pem_c')),
  '198.51.100.98'::inet, '[]'::jsonb);
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT ok(
  (SELECT root_fingerprint = current_setting('wg98.fp_b') AND next_root_fingerprint = current_setting('wg98.fp_c')
          AND next_root_confirmed_at IS NULL
     FROM public.gateways WHERE id = current_setting('wg98.gw')::uuid),
  '🚨 a replacement root the gateway already signs with lands as the next root, UNCONFIRMED: root B stays the offered one until the admin confirms C');
SELECT ok(
  (SELECT count(*) FROM public.workspace_audit WHERE gateway_id = current_setting('wg98.gw')::uuid
     AND action = 'gateway.next_root_received' AND details ->> 'fingerprint' = current_setting('wg98.fp_c')
     AND (details ->> 'in_use')::boolean = true) = 1
  AND (SELECT count(*) FROM public.workspace_audit WHERE gateway_id = current_setting('wg98.gw')::uuid AND action = 'gateway.root_replaced') = 1,
  'the trail says root C arrived and is in use, once; nothing was promoted');


-- ── 33-34: the CHECK holds the columns together ─────────────────────────────

SELECT throws_ok(
  format('UPDATE public.gateways SET next_root_fingerprint = %L WHERE id = %L::uuid', repeat('ab', 32), current_setting('wg98.gw')),
  '23514', NULL, 'a next-root fingerprint that is not the PEM''s is refused by the CHECK (never the gateway''s claim)');
SELECT throws_ok(
  format('UPDATE public.gateways SET next_root_confirmed_at = now() WHERE id = %L::uuid', current_setting('wg98.gw')),
  '23514', NULL, 'a confirmation without who confirmed is refused by the CHECK');


-- ── 35-46: a viewing''s fraction (0095 B) ────────────────────────────────────

SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;

-- user_a was minted a ticket for the clip five minutes ago.
INSERT INTO public.gateway_ticket_mints (jti, workspace_id, gateway_id, user_id, bin_file_id, project_id, file_name, minted_at)
VALUES ('98989898989898989898989898989898'::uuid, '11111111-1111-1111-1111-111111111111', current_setting('wg98.gw')::uuid,
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '98980000-0000-0000-0000-0000000000f1',
        'aaaa1111-0000-0000-0000-000000000001', 'A001_C098', now() - interval '5 minutes');

SELECT set_config('wg98.events', public.gateway_events_apply(current_setting('wg98.gw')::uuid, jsonb_build_array(
  -- 1: the gateway's fraction, a payload that claims read in full regardless
  jsonb_build_object('viewing_id', '98980000-0000-0000-0000-000000000201', 'clip', '98980000-0000-0000-0000-0000000000f1',
    'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ticket_jti', '98989898989898989898989898989898',
    'started_at', now() - interval '3 minutes', 'ended_at', now() - interval '1 minute',
    'bytes', 950, 'clip_bytes', 1000, 'fraction', 0.42, 'read_in_full', true),
  -- 2: a small read that covers nearly everything (served once, little scrubbed)
  jsonb_build_object('viewing_id', '98980000-0000-0000-0000-000000000202', 'clip', '98980000-0000-0000-0000-0000000000f1',
    'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ticket_jti', '98989898989898989898989898989898',
    'started_at', now() - interval '3 minutes', 'ended_at', now() - interval '1 minute',
    'bytes', 100, 'clip_bytes', 1000, 'fraction', 0.95, 'read_in_full', false),
  -- 3 and 4: fractions out of range are clamped
  jsonb_build_object('viewing_id', '98980000-0000-0000-0000-000000000203', 'clip', '98980000-0000-0000-0000-0000000000f1',
    'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ticket_jti', '98989898989898989898989898989898',
    'started_at', now() - interval '3 minutes', 'ended_at', now() - interval '1 minute',
    'bytes', 10, 'clip_bytes', 1000, 'fraction', 7),
  jsonb_build_object('viewing_id', '98980000-0000-0000-0000-000000000204', 'clip', '98980000-0000-0000-0000-0000000000f1',
    'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ticket_jti', '98989898989898989898989898989898',
    'started_at', now() - interval '3 minutes', 'ended_at', now() - interval '1 minute',
    'bytes', 10, 'clip_bytes', 1000, 'fraction', -3),
  -- 5: no fraction sent: 0093's rule, bytes over the clip's size
  jsonb_build_object('viewing_id', '98980000-0000-0000-0000-000000000205', 'clip', '98980000-0000-0000-0000-0000000000f1',
    'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ticket_jti', '98989898989898989898989898989898',
    'started_at', now() - interval '3 minutes', 'ended_at', now() - interval '1 minute',
    'bytes', 950, 'clip_bytes', 1000, 'read_in_full', false),
  -- 6: neither a fraction nor the clip's size
  jsonb_build_object('viewing_id', '98980000-0000-0000-0000-000000000206', 'clip', '98980000-0000-0000-0000-0000000000f1',
    'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ticket_jti', '98989898989898989898989898989898',
    'started_at', now() - interval '3 minutes', 'ended_at', now() - interval '1 minute',
    'bytes', 950, 'read_in_full', true),
  -- 7: a fraction that is no number refuses the row, not the batch
  jsonb_build_object('viewing_id', '98980000-0000-0000-0000-000000000207', 'clip', '98980000-0000-0000-0000-0000000000f1',
    'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ticket_jti', '98989898989898989898989898989898',
    'started_at', now() - interval '3 minutes', 'ended_at', now() - interval '1 minute',
    'bytes', 950, 'clip_bytes', 1000, 'fraction', 'lots'),
  -- 8: a JSON null fraction is no fraction
  jsonb_build_object('viewing_id', '98980000-0000-0000-0000-000000000208', 'clip', '98980000-0000-0000-0000-0000000000f1',
    'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ticket_jti', '98989898989898989898989898989898',
    'started_at', now() - interval '3 minutes', 'ended_at', now() - interval '1 minute',
    'bytes', 400, 'clip_bytes', 1000, 'fraction', NULL),
  -- 9 and 10: the line itself — more than half is not "in full"; exactly 0.9 is
  jsonb_build_object('viewing_id', '98980000-0000-0000-0000-000000000209', 'clip', '98980000-0000-0000-0000-0000000000f1',
    'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ticket_jti', '98989898989898989898989898989898',
    'started_at', now() - interval '3 minutes', 'ended_at', now() - interval '1 minute',
    'bytes', 600, 'clip_bytes', 1000, 'fraction', 0.6, 'read_in_full', true),
  jsonb_build_object('viewing_id', '98980000-0000-0000-0000-000000000210', 'clip', '98980000-0000-0000-0000-0000000000f1',
    'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ticket_jti', '98989898989898989898989898989898',
    'started_at', now() - interval '3 minutes', 'ended_at', now() - interval '1 minute',
    'bytes', 900, 'clip_bytes', 1000, 'fraction', 0.9, 'read_in_full', false),
  -- 11 and 12: a fraction sent as a string is no fraction (round 1, note 10:
  -- "NaN" cast to a number that clamps to 1, "read in full"); refused
  jsonb_build_object('viewing_id', '98980000-0000-0000-0000-000000000211', 'clip', '98980000-0000-0000-0000-0000000000f1',
    'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ticket_jti', '98989898989898989898989898989898',
    'started_at', now() - interval '3 minutes', 'ended_at', now() - interval '1 minute',
    'bytes', 10, 'clip_bytes', 1000, 'fraction', 'NaN'),
  jsonb_build_object('viewing_id', '98980000-0000-0000-0000-000000000212', 'clip', '98980000-0000-0000-0000-0000000000f1',
    'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ticket_jti', '98989898989898989898989898989898',
    'started_at', now() - interval '3 minutes', 'ended_at', now() - interval '1 minute',
    'bytes', 500, 'clip_bytes', 1000, 'fraction', '0.5')
))::text, true);

SELECT is(
  current_setting('wg98.events')::jsonb -> 'accepted',
  '["98980000-0000-0000-0000-000000000201", "98980000-0000-0000-0000-000000000202", "98980000-0000-0000-0000-000000000203",
    "98980000-0000-0000-0000-000000000204", "98980000-0000-0000-0000-000000000205", "98980000-0000-0000-0000-000000000206",
    "98980000-0000-0000-0000-000000000208", "98980000-0000-0000-0000-000000000209", "98980000-0000-0000-0000-000000000210"]'::jsonb,
  'nine viewings accepted, with and without a fraction');
SELECT is(
  current_setting('wg98.events')::jsonb -> 'rejected',
  '[{"viewing_id": "98980000-0000-0000-0000-000000000207", "reason": "malformed"},
    {"viewing_id": "98980000-0000-0000-0000-000000000211", "reason": "malformed"},
    {"viewing_id": "98980000-0000-0000-0000-000000000212", "reason": "malformed"}]'::jsonb,
  'a fraction that is no JSON number ("lots", "NaN", even "0.5") refuses its row alone');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

CREATE TEMP VIEW wg98_frac AS
  SELECT split_part(external_id, ':', 2) AS vid,
         jsonb_build_object('fraction', details -> 'fraction', 'read_in_full', details -> 'read_in_full', 'from', details -> 'fraction_from') AS f
    FROM public.file_events
   WHERE event = 'viewed_remote' AND external_id LIKE current_setting('wg98.gw') || ':%';

SELECT is((SELECT f FROM wg98_frac WHERE vid = '98980000-0000-0000-0000-000000000201'),
  '{"fraction": 0.42, "read_in_full": false, "from": "coverage"}'::jsonb,
  '🚨 the gateway''s fraction is taken (coverage), and read_in_full is computed from it: the payload''s "true" is never taken');
SELECT is((SELECT f FROM wg98_frac WHERE vid = '98980000-0000-0000-0000-000000000202'),
  '{"fraction": 0.95, "read_in_full": true, "from": "coverage"}'::jsonb,
  'a coverage of 0.95 is read in full, whatever the bytes count says');
SELECT is((SELECT f FROM wg98_frac WHERE vid = '98980000-0000-0000-0000-000000000203'),
  '{"fraction": 1, "read_in_full": true, "from": "coverage"}'::jsonb,
  'a fraction above one is clamped to one');
SELECT is((SELECT f FROM wg98_frac WHERE vid = '98980000-0000-0000-0000-000000000204'),
  '{"fraction": 0, "read_in_full": false, "from": "coverage"}'::jsonb,
  'a fraction below zero is clamped to zero');
SELECT is((SELECT f FROM wg98_frac WHERE vid = '98980000-0000-0000-0000-000000000205'),
  '{"fraction": 0.95, "read_in_full": true, "from": "bytes"}'::jsonb,
  'with no fraction sent, bytes over the clip''s size decide, as 0093 did');
SELECT is((SELECT f FROM wg98_frac WHERE vid = '98980000-0000-0000-0000-000000000206'),
  '{"fraction": null, "read_in_full": false, "from": null}'::jsonb,
  'with neither a fraction nor the clip''s size there is no fraction and the viewing is not read in full, whatever the payload claimed');
SELECT is((SELECT f FROM wg98_frac WHERE vid = '98980000-0000-0000-0000-000000000208'),
  '{"fraction": 0.4, "read_in_full": false, "from": "bytes"}'::jsonb,
  'a JSON null fraction is no fraction: the bytes decide');
SELECT is((SELECT f FROM wg98_frac WHERE vid = '98980000-0000-0000-0000-000000000209'),
  '{"fraction": 0.6, "read_in_full": false, "from": "coverage"}'::jsonb,
  'more than half of the clip is not "read in full" (the line is 0.9, whatever the payload claimed)');
SELECT is((SELECT f FROM wg98_frac WHERE vid = '98980000-0000-0000-0000-000000000210'),
  '{"fraction": 0.9, "read_in_full": true, "from": "coverage"}'::jsonb,
  'exactly 0.9 is read in full (the line is inclusive)');
SELECT ok(
  (SELECT bool_and((f ->> 'read_in_full')::boolean = CASE WHEN jsonb_typeof(f -> 'fraction') = 'number' THEN (f ->> 'fraction')::numeric >= 0.9 ELSE false END)
     FROM wg98_frac),
  '🚨 on every row read_in_full is exactly "fraction ≥ 0.9", computed by the database');


-- ── 47-48: the replaced sync function still answers as 96 expects ───────────

SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;
SELECT set_config('wg98.sync', public.gateway_sync_apply(current_setting('wg98.gw')::uuid,
  jsonb_build_object('version', '1.0.1', 'hostname', 'studio-nas98',
    'reach', jsonb_build_object('98980000-0000-0000-0000-0000000000c1', 'reachable'),
    'health', jsonb_build_object('doors', jsonb_build_object('inside', 'open', 'outside', 'closed_switch_off'), 'update', 'up_to_date')),
  '198.51.100.98'::inet,
  jsonb_build_array(
    jsonb_build_object('clip', '98980000-0000-0000-0000-0000000000f1', 'loc', '98980000-0000-0000-0000-0000000000c1', 'path', 'A001/A001_C098.mov'),
    jsonb_build_object('clip', '98980000-0000-0000-0000-0000000000f1', 'loc', '98980000-0000-0000-0000-0000000000c1', 'path', 'A001/other.mov'))
)::text, true);
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT ok(
  current_setting('wg98.sync')::jsonb ?& ARRAY['revoked', 'gateway_id', 'workspace_id', 'name', 'remote_viewing', 'outside_address', 'office_ranges',
                                                'signing_keys', 'bin_locations', 'confirmed', 'check_update_now', 'check_reach_now', 'reach_nonce', 'background_check'],
  'the sync answer keeps every key 0093''s function answered (gateway-sync reads them by name)');
SELECT is(current_setting('wg98.sync')::jsonb -> 'confirmed', '["98980000-0000-0000-0000-0000000000f1"]'::jsonb,
  'the catalogue check still confirms this company''s clip at its own path and not at another (D22)');

SELECT * FROM finish();
ROLLBACK;
