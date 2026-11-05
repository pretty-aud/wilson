-- =============================================================================
-- 61_workspace_storage_s3.sql — Session 37: the S3-compatible provider
-- (0051), first of the BYO family through S36's registry.
--
-- REFERENCED BY DESCRIPTION, NOT BY ORDINAL (suite 60's own rule — its
-- header's ordinals were off by one within a session).
--
-- What this pins:
--
--   1. THE VOCABULARY WIDENED, ADDITIVELY. 's3' inserts now pass the
--      provider CHECK — with a well-formed config — while 'gdrive' still
--      refuses with the SAME constraint name and message it always did, and
--      S34's NAS refusals re-run untouched. If any of those loosened, the
--      widening narrowed something (Audrey: "dont remove other options").
--
--   2. THE REQUIRED-DIRECTION ARM (workspace_storage_s3_config_chk) — the
--      arm 0050's header demanded. "Looks configured, resolves nowhere" is
--      the failure the registry exists to prevent, and a provider='s3' row
--      with no config, a missing required key, an unknown key, a wrong
--      type, an http endpoint or a non-canonical prefix is exactly that.
--      The prefix rules are 0048's root_canon discipline applied to a key
--      prefix (§3.2's trailing-separator breakage applies verbatim).
--
--   3. THE RETAINED STATE, ONE PROVIDER OVER: central + s3 + config is
--      LEGAL and inert, exactly as central + network + path is (0048's
--      retyping rule; S36's first draft deleted it with a biconditional and
--      suite 59 caught it — this probe stops the s3-shaped version).
--
--   4. MONEY NEVER LEAVES SUPABASE, NOW WITH A REAL THIRD PROVIDER. Suite
--      60 proved files_money_provider_chk with 'google_drive' rows because
--      's3' did not exist in the enum; these probes are the same shapes
--      against the provider a customer can actually SELECT — the first
--      session where the temptation is real (the brief's §5).
--
--   5. CERTIFIED-DISPOSAL PARITY (the enqueue trigger, widened BY TEXT
--      comparison — the new enum value cannot be referenced in 0051's own
--      transaction). A purged s3 row enqueues with provider='s3' and the
--      marker bucket 'byo-s3'; a supabase row enqueues exactly as it did
--      before 0051. Probed END-TO-END: real INSERT, real DELETE, read the
--      queue.
--
-- 🚨 CONSTRAINT NAMES DECIDE THE MESSAGE (measured, S36): with several
-- CHECKs violated Postgres reports the alphabetically first. Every refusal
-- probe here violates exactly ONE constraint — except the non-object-config
-- probe, which deliberately violates two and asserts the ALPHABETICAL
-- winner (workspace_storage_provider_config_chk, p < s), because that
-- ordering is itself load-bearing for every suite's throws_ok.
--
-- Runs entirely as postgres: CHECKs, enum and triggers are not RLS. The
-- storage_gc_queue reads are scoped to the fixture workspace (the unscoped-
-- count decay rule).
-- =============================================================================

BEGIN;

SELECT plan(83);

SELECT * FROM tests.rls_setup();

-- Cleanup helper, suite 60's shape and reasoning (breaker hygiene: a
-- neutered constraint must strand a PK collision, not a mystery).
CREATE OR REPLACE FUNCTION pg_temp.ws_reset() RETURNS void LANGUAGE sql AS $$
  DELETE FROM public.workspace_storage
   WHERE workspace_id IN ('11111111-1111-1111-1111-111111111111',
                          '22222222-2222-2222-2222-222222222222');
$$;

-- ── 1. Structure ─────────────────────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'storage_provider' AND e.enumlabel = 's3'),
  1, 'the files enum carries s3 — a row can name where an S3 body lives');

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
    WHERE conrelid='public.workspace_storage'::regclass AND contype='c'
      AND conname = 'workspace_storage_s3_config_chk'),
  1, 'the required-direction arm exists');

-- The widening LANDED (the wrapped-ADD replay no-op is the failure mode).
SELECT ok(
  (SELECT pg_get_constraintdef(oid) LIKE '%''s3''%' FROM pg_constraint
    WHERE conrelid='public.workspace_storage'::regclass AND contype='c'
      AND conname='workspace_storage_provider_chk'),
  'the provider CHECK was actually widened, not no-opped by a wrapped re-ADD');

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
    WHERE conrelid='public.workspace_storage'::regclass AND contype='c'
      AND conname IN ('workspace_storage_mode_chk',
                      'workspace_storage_kind_chk',
                      'workspace_storage_root_pair_chk',
                      'workspace_storage_root_canon_chk',
                      'workspace_storage_kind_shape_chk')),
  5, 'S34''s five path CHECKs survive 0051 intact — additive, again');

-- ── 2. A well-formed s3 workspace saves, and lands verbatim ─────────────────

SELECT lives_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"endpoint":"https://s3.us-west-004.backblazeb2.com","region":"us-west-004","bucket":"studio-media","prefix":"wilson","accessKeyId":"0041234abcd","forcePathStyle":false}'::jsonb)$$,
  'a full six-key config is accepted');

SELECT is(
  (SELECT provider_config->>'bucket' FROM public.workspace_storage
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'),
  'studio-media', 'and it landed verbatim');

SELECT pg_temp.ws_reset();

SELECT lives_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"region":"us-east-1","bucket":"b","accessKeyId":"AKIA1"}'::jsonb)$$,
  'the three required keys alone are enough — endpoint defaults to AWS');

SELECT pg_temp.ws_reset();

-- ── 3. The retained state, one provider over ────────────────────────────────

SELECT lives_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('22222222-2222-2222-2222-222222222222', 'central', 's3',
            '{"region":"auto","bucket":"b","accessKeyId":"AKIA1"}'::jsonb)$$,
  'central + s3 + config is the RETAINED state — the retyping rule, s3-shaped');

DELETE FROM public.workspace_storage
 WHERE workspace_id = '22222222-2222-2222-2222-222222222222';

-- ── 4. The required-direction arm refuses "looks configured, resolves nowhere"

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3')$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_s3_config_chk"',
  's3 with no config at all is refused');

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"region":"r","accessKeyId":"A"}'::jsonb)$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_s3_config_chk"',
  'a missing bucket is refused');

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"bucket":"b","accessKeyId":"A"}'::jsonb)$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_s3_config_chk"',
  'a missing region is refused — SigV4 needs one everywhere');

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"region":"r","bucket":"b"}'::jsonb)$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_s3_config_chk"',
  'a missing accessKeyId is refused');

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"region":"r","bucket":"b","accessKeyId":"A","buckett":"typo"}'::jsonb)$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_s3_config_chk"',
  'an unknown key is refused at write time, not discovered during an incident');

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"region":"r","bucket":"b","accessKeyId":"A","forcePathStyle":"yes"}'::jsonb)$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_s3_config_chk"',
  'forcePathStyle must be a real boolean, not a string');

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"region":"r","bucket":"b","accessKeyId":"A","endpoint":"http://minio.local"}'::jsonb)$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_s3_config_chk"',
  'an http endpoint is refused — media does not cross the wire in the clear');

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"region":"r","bucket":"b","accessKeyId":"A","endpoint":"https://s3.example.com/"}'::jsonb)$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_s3_config_chk"',
  'an endpoint with a trailing slash is refused (canonical form)');

-- 0052, from S37's own review: HOST ONLY. s3HostAndPath() builds the URL path
-- itself, so a mount point in the endpoint would be silently dropped and every
-- presigned URL signed against a canonical URI the gateway never sees — a
-- "configured" row that resolves nowhere, surfacing as a 404 that blames the
-- bucket. The reverse-proxied-MinIO shape is the one a real admin types.
SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"region":"r","bucket":"b","accessKeyId":"A","endpoint":"https://storage.example.com/minio"}'::jsonb)$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_s3_config_chk"',
  'an endpoint carrying a path is refused — the signer would drop it silently');

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"region":"r","bucket":"b","accessKeyId":"A","endpoint":"https://s3.example.com?x=1"}'::jsonb)$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_s3_config_chk"',
  'an endpoint carrying a query is refused too');

-- The overblock control: host:port must still be accepted, or the arm above
-- would be refusing every self-hosted MinIO rather than only the proxied ones.
SELECT lives_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"region":"r","bucket":"b","accessKeyId":"A","endpoint":"https://minio.example.com:9000"}'::jsonb)$$,
  'a host:port endpoint is still accepted — the arm bounds the path, not the port');

SELECT pg_temp.ws_reset();

-- The prefix: 0048's root_canon discipline, applied to a key prefix.

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"region":"r","bucket":"b","accessKeyId":"A","prefix":"/wilson"}'::jsonb)$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_s3_config_chk"',
  'a leading-slash prefix is refused');

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"region":"r","bucket":"b","accessKeyId":"A","prefix":"wilson/"}'::jsonb)$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_s3_config_chk"',
  'a trailing-slash prefix is refused — §3.2''s breakage, key-shaped');

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"region":"r","bucket":"b","accessKeyId":"A","prefix":"a//b"}'::jsonb)$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_s3_config_chk"',
  'a doubled slash in the prefix is refused');

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"region":"r","bucket":"b","accessKeyId":"A","prefix":"a\\b"}'::jsonb)$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_s3_config_chk"',
  'a backslash in the prefix is refused — keys are slash-delimited');

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"region":"r","bucket":"b","accessKeyId":"A","prefix":"a/../b"}'::jsonb)$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_s3_config_chk"',
  'a dot segment in the prefix is refused');

SELECT lives_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"region":"r","bucket":"b","accessKeyId":"A","prefix":"studio/media"}'::jsonb)$$,
  'a nested canonical prefix is accepted — the rule is form, not depth');

SELECT pg_temp.ws_reset();

-- The deliberate two-constraint probe: a non-object config violates BOTH the
-- 0050 shape rule and the s3 arm; the alphabetical winner is what callers
-- see, and this pins that ordering (p < s).
SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '["not","an","object"]'::jsonb)$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_provider_config_chk"',
  'a non-object config reports the ALPHABETICALLY first constraint (measured rule)');

SELECT pg_temp.ws_reset();

-- ── 5. The converse arm holds for the new provider ──────────────────────────

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config, root_path, root_kind)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3',
            '{"region":"r","bucket":"b","accessKeyId":"A"}'::jsonb,
            '\\nas\projects\wilson', 'unc')$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_root_provider_path_chk"',
  'an s3 workspace cannot carry a filesystem root — the converse arm, s3-shaped');

SELECT pg_temp.ws_reset();

-- ── 6. Nothing already supported narrowed ───────────────────────────────────

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 'gdrive')$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_provider_chk"',
  'gdrive is still refused until S38 ships the adapter that can resolve it');

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, root_path, root_kind)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 'network', '\\nas\projects\wilson\', 'unc')$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_root_canon_chk"',
  'network: a trailing separator is still refused after the widening');

SELECT lives_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, root_path, root_kind)
    VALUES ('22222222-2222-2222-2222-222222222222', 'byos', 'network', '\\nas\projects\wilson', 'unc')$$,
  'network: the canonical NAS row is still accepted — the widening is additive');

DELETE FROM public.workspace_storage
 WHERE workspace_id = '22222222-2222-2222-2222-222222222222';

-- s3 takes no config exemption the OTHER way either: network still refuses a
-- config (0050's shape rule is untouched by the new arm).
SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 'network', '{"bucket":"b"}'::jsonb)$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_provider_config_chk"',
  'network still takes no provider_config — its location is root_path');

SELECT pg_temp.ws_reset();

-- ── 7. Money never leaves Supabase — now against the real provider ──────────

SELECT throws_ok(
  $$INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial)
    VALUES ('aaaa1111-0000-0000-0000-0000000061a1',
            'aaaa1111-0000-0000-0000-000000000001', 'scan.pdf', 's3',
            'projects/aaaa1111-0000-0000-0000-000000000001/asset/a1/1-scan.pdf', true)$$,
  'new row for relation "files" violates check constraint "files_money_provider_chk"',
  'is_financial pins a file to Supabase even when the body would go to s3 (row axis)');

SELECT throws_ok(
  $$INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial)
    VALUES ('aaaa1111-0000-0000-0000-0000000061a2',
            'aaaa1111-0000-0000-0000-000000000001', 'invoice.pdf', 's3',
            'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/x/1-invoice.pdf', false)$$,
  'new row for relation "files" violates check constraint "files_money_provider_chk"',
  'an INVOICES path cannot land on s3 even with is_financial false (path axis)');

SELECT throws_ok(
  $$INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial)
    VALUES ('aaaa1111-0000-0000-0000-0000000061a3',
            'aaaa1111-0000-0000-0000-000000000001', 'RATES.json', 's3',
            'projects/aaaa1111-0000-0000-0000-000000000001/finance/RATES.json', false)$$,
  'new row for relation "files" violates check constraint "files_money_provider_chk"',
  'the segment match is case-folded for s3 rows too — lowercase finance is refused');

SELECT lives_ok(
  $$INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial)
    VALUES ('aaaa1111-0000-0000-0000-0000000061b1',
            'aaaa1111-0000-0000-0000-000000000001', 'dailies.mov', 's3',
            'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/1-dailies.mov', false)$$,
  'an ORDINARY file may live at s3 — the accept control that keeps BYO real');

DELETE FROM public.files WHERE id = 'aaaa1111-0000-0000-0000-0000000061b1';

-- ── 8. Certified-disposal parity: the enqueue trigger, end-to-end ───────────

SELECT is(
  (SELECT column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name='storage_gc_queue'
      AND column_name='provider'),
  '''supabase''::text', 'the queue''s provider column defaults to supabase — pre-0051 rows read correctly');

-- A purged s3 row enqueues with its provider and the marker bucket.
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial)
VALUES ('aaaa1111-0000-0000-0000-0000000061c1',
        'aaaa1111-0000-0000-0000-000000000001', 'dailies.mov', 's3',
        'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/2-dailies.mov', false);
DELETE FROM public.files WHERE id = 'aaaa1111-0000-0000-0000-0000000061c1';

SELECT is(
  (SELECT provider || '|' || bucket_id FROM public.storage_gc_queue
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
      AND object_path = 'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/2-dailies.mov'),
  's3|byo-s3',
  'a purged s3 row is enqueued for certified disposal, marked for the signed-DELETE drain');

-- And the supabase path behaves exactly as it did before 0051.
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial)
VALUES ('aaaa1111-0000-0000-0000-0000000061c2',
        'aaaa1111-0000-0000-0000-000000000001', 'brief.pdf', 'supabase',
        'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/3-brief.pdf', false);
DELETE FROM public.files WHERE id = 'aaaa1111-0000-0000-0000-0000000061c2';

SELECT is(
  (SELECT provider || '|' || bucket_id FROM public.storage_gc_queue
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
      AND object_path = 'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/3-brief.pdf'),
  'supabase|rabbit-files',
  'a purged supabase row enqueues exactly as it did before 0051');

-- A local_server row still enqueues NOTHING — the trigger's widening did not
-- catch a provider whose bodies the queue cannot drain.
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial)
VALUES ('aaaa1111-0000-0000-0000-0000000061c3',
        'aaaa1111-0000-0000-0000-000000000001', 'clip.mov', 'local_server',
        'clip-61.mov', false);
DELETE FROM public.files WHERE id = 'aaaa1111-0000-0000-0000-0000000061c3';

SELECT is(
  (SELECT count(*)::int FROM public.storage_gc_queue
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
      AND object_path = 'clip-61.mov'),
  0, 'a local_server purge still enqueues nothing — its bodies are not the queue''s to drain');

-- ── 0115: can_presign_object, the signer's question ─────────────────────────
-- Fixture ids are hex. Project A (rls_setup) is shared; 61000000-…-01 is private and
-- created by user_c. user_c holds a member seat on A; user_e is a plain user with a
-- reviewer seat on A; user_n is inactive and their token still says they belong.
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user_e@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('99999999-9999-9999-9999-999999999999', 'user_n@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active) VALUES
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user', 'user_e', 'User E', true),
  ('11111111-1111-1111-1111-111111111111', '99999999-9999-9999-9999-999999999999', 'user', 'user_n', 'User N', false)
ON CONFLICT (workspace_id, user_id) DO NOTHING;
INSERT INTO public.projects (id, workspace_id, title, is_private, created_by) VALUES
  ('61000000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Private P', true, 'cccccccc-cccc-cccc-cccc-cccccccccccc');
INSERT INTO public.project_members (project_id, user_id, project_role) VALUES
  ('aaaa1111-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'member'),
  ('aaaa1111-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'reviewer'),
  ('aaaa1111-0000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999999', 'member')
ON CONFLICT DO NOTHING;
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, thumbnail_url, is_financial, deleted_at) VALUES
  ('61000000-0000-0000-0000-00000000f001', 'aaaa1111-0000-0000-0000-000000000001', 'live.bin', 's3', 'projects/aaaa1111-0000-0000-0000-000000000001/files/f001/live.bin', 'projects/aaaa1111-0000-0000-0000-000000000001/files/f001/live.bin.jpg', false, NULL),
  ('61000000-0000-0000-0000-00000000f002', 'aaaa1111-0000-0000-0000-000000000001', 'trashed.bin', 's3', 'projects/aaaa1111-0000-0000-0000-000000000001/files/f002/trashed.bin', 'projects/aaaa1111-0000-0000-0000-000000000001/files/f002/trashed.bin.jpg', false, now()),
  ('61000000-0000-0000-0000-00000000f003', '61000000-aaaa-0000-0000-000000000001', 'moved.bin', 's3', 'projects/aaaa1111-0000-0000-0000-000000000001/files/f003/moved.bin', NULL, false, NULL),
  ('61000000-0000-0000-0000-00000000f004', '61000000-aaaa-0000-0000-000000000001', 'purged-moved.bin', 's3', 'projects/aaaa1111-0000-0000-0000-000000000001/files/f004/purged-moved.bin', NULL, false, NULL),
  ('61000000-0000-0000-0000-00000000f006', 'aaaa1111-0000-0000-0000-000000000001', 'no-picture.bin', 's3', 'projects/aaaa1111-0000-0000-0000-000000000001/files/f006/no-picture.bin', NULL, false, NULL),
  -- A Petal row: a company's own bucket holds nothing of it, so the key is unclaimed there.
  ('61000000-0000-0000-0000-00000000f007', 'aaaa1111-0000-0000-0000-000000000001', 'petal.bin', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000000001/files/f007/petal.bin', NULL, false, NULL);
DELETE FROM public.files WHERE id = '61000000-0000-0000-0000-00000000f004';

CREATE FUNCTION pg_temp.t61_login(p_user uuid, p_ws uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', 'user'))::text, true);
  SET LOCAL ROLE authenticated;
END;
$$;
CREATE FUNCTION pg_temp.t61_logout() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  RESET ROLE;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.t61_login(uuid, uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.t61_logout() TO PUBLIC;

SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = 'public.can_presign_object(text,text)'::regprocedure), false,
  'can_presign_object runs as the caller');
SELECT ok(has_function_privilege('authenticated', 'public.can_presign_object(text,text)', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.can_presign_object(text,text)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.can_presign_object(text,text)', 'EXECUTE'),
  'open to a signed-in caller and the service role, not to anon');

-- ── A plain reader of A, who cannot write it and cannot see P.
SELECT pg_temp.t61_login('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f001/live.bin', 'get'), true, 'a live s3 copy is signed for reading');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f001/live.bin', 'head'), true, 'and for a look');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f001/live.bin.jpg', 'get'), true, 'and the picture its row names');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f006/no-picture.bin.jpg', 'get'), false, 'not a picture its row does not name');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f002/trashed.bin', 'get'), false, 'a trashed copy is not signed');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f002/trashed.bin.jpg', 'head'), false, 'nor its picture');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f003/moved.bin', 'get'), false, 'a copy moved into a hidden project is not signed for a reader of the key''s project');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f004/purged-moved.bin', 'get'), false, 'a purged moved copy is not signed while its queue row waits');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/connection-check/x/check', 'head'), true, 'a connection check keeps the old read answer');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/connection-check/x/check', 'put'), false, 'and the old write answer, which this reader does not pass');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f009/fresh.bin', 'get'), true, 'a fresh key keeps the old read answer');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f009/fresh.bin', 'put'), false, 'and the old write answer');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f009/fresh.bin', 'del'), false, 'for removing too');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f007/petal.bin', 'get'), true, 'a Petal row does not claim a key in a company''s bucket');
SELECT is(public.can_presign_object('projects/61000000-aaaa-0000-0000-000000000001/files/f009/fresh.bin', 'get'), false, 'a fresh key under a hidden project is not signed');
SELECT is(public.can_presign_object('projects/bbbb2222-0000-0000-0000-000000000001/files/f009/fresh.bin', 'get'), false, 'nor under another company''s');
SELECT is(public.can_presign_object('projects/not-a-uuid/files/f009/fresh.bin', 'get'), false, 'a key that names no project is not signed');
SELECT is(public.can_presign_object(NULL, 'get'), false, 'a NULL key is false, never NULL');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f001/live.bin', NULL), false, 'a NULL op is false, never NULL');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f001/live.bin', 'patch'), false, 'an op it does not know is false');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f009/fresh.bin', 'patch'), false, 'on a fresh key too');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f009/fresh.bin', NULL), false, 'and a NULL op on a fresh key');
SELECT pg_temp.t61_logout();

-- ── A writer of A, the creator of P.
SELECT pg_temp.t61_login('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f001/live.bin', 'put'), false, 'nobody overwrites a claimed copy, a writer included');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f001/live.bin', 'del'), false, 'nor removes it');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f001/live.bin.jpg', 'put'), false, 'nor overwrites its picture');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f001/live.bin.jpg', 'del'), false, 'nor removes that');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f002/trashed.bin', 'put'), false, 'a trashed key is not written over');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f004/purged-moved.bin', 'put'), false, 'nor a purged moved key');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f003/moved.bin', 'get'), true, 'a copy moved into P is signed for P''s reader');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f003/moved.bin', 'put'), false, 'and not written over by them either');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/connection-check/x/check', 'put'), true, 'CONTROL: the connection check keeps the old write answer for a writer');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f009/fresh.bin', 'put'), true, 'CONTROL: a fresh key too');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f009/fresh.bin', 'del'), true, 'and for removing');
SELECT is(public.can_presign_object('projects/61000000-aaaa-0000-0000-000000000001/files/f009/fresh.bin', 'get'), true, 'CONTROL: a fresh key under P is signed for its reader');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f009/fresh.bin', NULL), false, 'a NULL op is false for a writer too, whose write answer is true');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f009/fresh.bin', 'patch'), false, 'and so is an op it does not know');
-- SEC-2: in a company's own bucket a body and its picture share names.
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('61000000-0000-0000-0000-00000000f010', 'aaaa1111-0000-0000-0000-000000000001', 'k.jpg', 's3',
                            'projects/aaaa1111-0000-0000-0000-000000000001/files/f001/live.bin.jpg') $$,
  '42501', NULL, 'a new s3 row cannot take the name of another row''s picture');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, thumbnail_url)
                    VALUES ('61000000-0000-0000-0000-00000000f011', 'aaaa1111-0000-0000-0000-000000000001', 'k', 's3',
                            'projects/aaaa1111-0000-0000-0000-000000000001/files/f006/no-picture.bin.jpg.jpg',
                            'projects/aaaa1111-0000-0000-0000-000000000001/files/f006/no-picture.bin.jpg.jpg.jpg') $$,
  '42501', NULL, 'nor a name that is another row''s once .jpg is set aside');
SELECT pg_temp.t61_logout();

-- ── An inactive member, and a purge certificate on its own.
SELECT pg_temp.t61_login('99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f001/live.bin', 'get'), false, 'an inactive member gets nothing signed');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f009/fresh.bin', 'get'), false, 'on a fresh key either');
SELECT pg_temp.t61_logout();
DELETE FROM public.storage_gc_queue WHERE file_id = '61000000-0000-0000-0000-00000000f004';
SELECT pg_temp.t61_login('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f004/purged-moved.bin', 'get'), false, 'the queue row gone, the certificate still refuses to sign a read');
SELECT is(public.can_presign_object('projects/aaaa1111-0000-0000-0000-000000000001/files/f004/purged-moved.bin', 'put'), false, 'and a write');
SELECT pg_temp.t61_logout();

SELECT * FROM finish();

ROLLBACK;
