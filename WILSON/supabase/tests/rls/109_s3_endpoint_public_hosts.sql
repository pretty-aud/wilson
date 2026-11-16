-- =============================================================================
-- 109_s3_endpoint_public_hosts.sql — migration 0106 (P8, night 5,
-- 2026-10-28): the S3 endpoint's public-host arm (TPN-NET-016) and the
-- re-seal's audit verb (TPN-ENC-015).
--
-- What this pins (each probe names the 0106 section it holds to):
--   * s3_endpoint_host_ok by example (§1): a public name, a public literal, a
--     port, and no endpoint (AWS) pass; a private, loopback, link-local,
--     CGNAT, multicast or documentation literal, a unique-local or loopback
--     IPv6 literal, localhost, a local suffix, a bare label, a Supabase host,
--     credentials in the authority and an unbracketed IPv6 are refused.
--   * THE ROW'S SAVE (§1c), as the CHECK refuses it whoever writes: a
--     workspace_storage s3 row naming a private literal, a local name, a
--     unique-local literal or a WILSON host is 23514; a public endpoint and
--     the AWS default still save (controls); 0052's host-only arm survived the
--     restatement (a path is still refused).
--   * THE AUDIT VERB (§2): secret.resealed is admitted; a verb nobody
--     declared is still refused (control); 0066's own verb still admitted.
--
-- The failing controls, before 0106: the function did not exist (42883) and
-- every private endpoint saved; secret.resealed was 23514.
-- =============================================================================

BEGIN;

SELECT plan(26);

SELECT * FROM tests.rls_setup();

-- ── 1-5: structure (§1, §1c, §2) ───────────────────────────────────────────

SELECT has_function('public', 's3_endpoint_host_ok', ARRAY['text'], 's3_endpoint_host_ok exists (§1)');
SELECT ok(
  (SELECT pg_get_constraintdef(oid) LIKE '%s3_endpoint_host_ok%' FROM pg_constraint
    WHERE conrelid = 'public.workspace_storage'::regclass AND conname = 'workspace_storage_s3_config_chk'),
  'workspace_storage_s3_config_chk carries the public-host arm (§1c)');
SELECT ok(
  (SELECT pg_get_constraintdef(oid) LIKE '%[/?#]%' AND pg_get_constraintdef(oid) LIKE '%forcePathStyle%' FROM pg_constraint
    WHERE conrelid = 'public.workspace_storage'::regclass AND conname = 'workspace_storage_s3_config_chk'),
  'and 0052''s host-only arm and 0051''s shape survived the restatement (the 0059 guard)');
SELECT ok(
  (SELECT pg_get_constraintdef(oid) LIKE '%secret.resealed%' AND pg_get_constraintdef(oid) LIKE '%workspace.invite_sent%' FROM pg_constraint
    WHERE conrelid = 'public.platform_audit'::regclass AND conname = 'platform_audit_action_check'),
  'platform_audit_action_check admits secret.resealed and still 0066''s verb (§2)');
SELECT ok(
  has_function_privilege('authenticated', 'public.s3_endpoint_host_ok(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.s3_endpoint_host_ok(text)', 'EXECUTE'),
  'the predicate is executable by authenticated (the CHECK runs as the writer) and not by anon');


-- ── 6-15: the predicate, by example (§1) ───────────────────────────────────

SELECT ok(public.s3_endpoint_host_ok('https://s3.us-west-004.backblazeb2.com'), 'a public name passes');
SELECT ok(public.s3_endpoint_host_ok('https://minio.example.com:9000') AND public.s3_endpoint_host_ok('https://93.184.216.34:9000'),
  'a port rides along, on a name and on a public literal');
SELECT ok(public.s3_endpoint_host_ok(NULL), 'no endpoint is AWS''s own host: public');
SELECT ok(NOT public.s3_endpoint_host_ok('https://10.0.0.5') AND NOT public.s3_endpoint_host_ok('https://192.168.1.2:9000')
  AND NOT public.s3_endpoint_host_ok('https://172.16.0.9'),
  '🚨 a private literal (RFC 1918) is refused');
SELECT ok(NOT public.s3_endpoint_host_ok('https://127.0.0.1:9000') AND NOT public.s3_endpoint_host_ok('https://169.254.169.254')
  AND NOT public.s3_endpoint_host_ok('https://100.64.0.1') AND NOT public.s3_endpoint_host_ok('https://224.0.0.1')
  AND NOT public.s3_endpoint_host_ok('https://192.0.2.1') AND NOT public.s3_endpoint_host_ok('https://0.0.0.0'),
  '🚨 loopback, link-local, CGNAT, multicast, documentation and unspecified literals are refused');
SELECT ok(NOT public.s3_endpoint_host_ok('https://[fd00::1]:9000') AND NOT public.s3_endpoint_host_ok('https://[::1]')
  AND NOT public.s3_endpoint_host_ok('https://[fe80::1]') AND NOT public.s3_endpoint_host_ok('https://fd00::1'),
  '🚨 a unique-local, loopback or link-local IPv6 literal is refused, bracketed or not');
SELECT ok(NOT public.s3_endpoint_host_ok('https://localhost:9000') AND NOT public.s3_endpoint_host_ok('https://nas.local')
  AND NOT public.s3_endpoint_host_ok('https://minio.internal') AND NOT public.s3_endpoint_host_ok('https://storage.lan')
  AND NOT public.s3_endpoint_host_ok('https://files.home.arpa') AND NOT public.s3_endpoint_host_ok('https://s3.corp'),
  '🚨 localhost and the local suffixes are refused');
SELECT ok(NOT public.s3_endpoint_host_ok('https://minio') AND NOT public.s3_endpoint_host_ok('https://x.supabase.co')
  AND NOT public.s3_endpoint_host_ok('https://u:p@s3.example.com'),
  '🚨 a bare label, a WILSON host and credentials in the authority are refused');
SELECT ok(NOT public.s3_endpoint_host_ok('http://s3.example.com') AND NOT public.s3_endpoint_host_ok('https://s3.example.com/minio')
  AND NOT public.s3_endpoint_host_ok('https://010.0.0.1'),
  'http, a path and a non-canonical literal are refused (0052''s rules, and 0093''s one spelling)');
SELECT ok(public.s3_endpoint_host_ok('https://S3.Example.COM'), 'a name is read lower-cased');


-- ── 16-23: the row's save (§1c): the CHECK, whoever writes ─────────────────
-- As postgres, as suite 61 probes the shape: a refusal here is the
-- constraint's, not a policy's.

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"region":"r","bucket":"b","accessKeyId":"A","endpoint":"https://10.0.0.5"}'::jsonb)$$,
  '23514', NULL, '🚨 an endpoint at a private address cannot be saved');
SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"region":"r","bucket":"b","accessKeyId":"A","endpoint":"https://169.254.169.254"}'::jsonb)$$,
  '23514', NULL, '🚨 nor one at the link-local metadata address');
SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"region":"r","bucket":"b","accessKeyId":"A","endpoint":"https://nas.local:9000"}'::jsonb)$$,
  '23514', NULL, '🚨 nor one named inside the office');
SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"region":"r","bucket":"b","accessKeyId":"A","endpoint":"https://[fd00::1]:9000"}'::jsonb)$$,
  '23514', NULL, '🚨 nor a unique-local IPv6 one');
SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"region":"r","bucket":"b","accessKeyId":"A","endpoint":"https://eqjzmnvkrakroyqxfsvw.supabase.co"}'::jsonb)$$,
  '23514', NULL, '🚨 nor a WILSON host');
SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"region":"r","bucket":"b","accessKeyId":"A","endpoint":"https://storage.example.com/minio"}'::jsonb)$$,
  '23514', NULL, 'CONTROL: 0052''s host-only arm still refuses a path');
SELECT lives_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"endpoint":"https://s3.us-west-004.backblazeb2.com","region":"us-west-004","bucket":"studio-media","accessKeyId":"0041234abcd"}'::jsonb)$$,
  'CONTROL: a public endpoint saves');
DELETE FROM public.workspace_storage WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
SELECT lives_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"region":"us-east-1","bucket":"b","accessKeyId":"AKIA1"}'::jsonb)$$,
  'CONTROL: the AWS default (no endpoint) saves');
DELETE FROM public.workspace_storage WHERE workspace_id = '11111111-1111-1111-1111-111111111111';


-- ── 24-26: the audit verb (§2) ─────────────────────────────────────────────

SELECT lives_ok(
  $$INSERT INTO public.platform_audit (action, message, context)
    VALUES ('secret.resealed', 'suite 109 probe', '{"secret": "storage", "rows": 0, "resealed": 0, "already": 0, "failed": 0, "to_version": 2}'::jsonb)$$,
  'secret.resealed is admitted (§2)');
SELECT throws_ok(
  $$INSERT INTO public.platform_audit (action, message) VALUES ('secret.unsealed', 'suite 109 probe')$$,
  '23514', NULL, 'CONTROL: a verb nobody declared is still refused');
SELECT lives_ok(
  $$INSERT INTO public.platform_audit (action, message) VALUES ('workspace.invite_sent', 'suite 109 probe')$$,
  'CONTROL: 0066''s verb still admitted');

SELECT * FROM finish();
ROLLBACK;
