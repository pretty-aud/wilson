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

SELECT plan(39);

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

SELECT * FROM finish();

ROLLBACK;
