-- =============================================================================
-- 34_workspace_ai_keys.sql — Session 15: per-company Anthropic keys
-- (migration 0028).
--
-- Pins the one property that matters about this table: NO client role can
-- reach it, at all, ever. A per-tenant Anthropic key is a spending
-- credential; the console shows key_hint and nothing else (locked #8
-- applied to tenant credentials), and only service_role — via ai-proxy and
-- operator-ai-keys — reads the ciphertext.
--
-- Also pins the storage shape the crypto seam depends on (ciphertext +
-- hint + version, never a plaintext column) and the ON DELETE CASCADE that
-- makes a torn-down tenant take its key with it.
--
-- login_as sets NO app_role claim (0005) — that is fine here, because none
-- of these probes has a role arm to satisfy: the table has zero policies.
-- De-auth before every mid-file login_as with claims-reset + RESET ROLE
-- (the tests schema is runner-only; tests.logout() is not callable while
-- role = authenticated).
-- =============================================================================
BEGIN;

SELECT plan(16);

SELECT * FROM tests.rls_setup();

-- 1: the table exists.
SELECT has_table('public'::name, 'workspace_ai_keys'::name,
  'workspace_ai_keys table exists');

-- 2-4: the storage shape. The absence of a plaintext column is a test, not a
-- convention — ai-proxy read `anthropic_key` until S15, and a re-added column
-- of that name would silently reintroduce a plaintext credential at rest.
SELECT has_column('public'::name, 'workspace_ai_keys'::name, 'key_ciphertext'::name,
  'workspace_ai_keys stores ciphertext');
SELECT has_column('public'::name, 'workspace_ai_keys'::name, 'key_hint'::name,
  'workspace_ai_keys stores a display hint');
SELECT is(
  (SELECT count(*)::int FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workspace_ai_keys'
      AND column_name IN ('anthropic_key', 'api_key', 'key', 'secret')),
  0, 'workspace_ai_keys has no plaintext key column'
);

-- 5-6: RLS is on AND forced, and there are zero policies. Zero policies with
-- RLS on is the deny-everything shape (0027 storage_gc_queue); service_role
-- reaches it by BYPASSRLS, nothing else does.
SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.workspace_ai_keys'::regclass),
  'workspace_ai_keys has RLS enabled and forced'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workspace_ai_keys'),
  0, 'workspace_ai_keys has no policies (service_role only)'
);

-- 7-10: table privileges are revoked from both client roles, in both
-- directions. Privileges are the belt; RLS is the braces — the S14 review
-- lesson was that a policy pinned only by existence lets CI bless the wrong
-- thing, so pin the grant too.
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.workspace_ai_keys', 'SELECT'),
  'authenticated has no SELECT privilege on workspace_ai_keys'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.workspace_ai_keys', 'INSERT'),
  'authenticated has no INSERT privilege on workspace_ai_keys'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.workspace_ai_keys', 'SELECT'),
  'anon has no SELECT privilege on workspace_ai_keys'
);
SELECT ok(
  has_table_privilege('service_role', 'public.workspace_ai_keys', 'SELECT'),
  'service_role can read workspace_ai_keys (the ai-proxy path)'
);

-- Seed a key row as the runner (postgres has BYPASSRLS) so the reachability
-- probes have something to fail to find. A row that does not exist would make
-- a broken policy look like a passing test.
INSERT INTO public.workspace_ai_keys
  (workspace_id, key_ciphertext, key_hint)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   'ZmFrZS1jaXBoZXJ0ZXh0LWZvci10ZXN0aW5nLW9ubHk=', '9f2c');

-- ── As a workspace admin of ws_a ────────────────────────────────────────────
-- The strongest form of the claim: even the admin of the very workspace the
-- key belongs to cannot read it.

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

-- 11-13: read, write and delete all refused at the privilege layer.
SELECT throws_ok(
  $$ SELECT key_ciphertext FROM public.workspace_ai_keys $$,
  'permission denied for table workspace_ai_keys',
  'a workspace admin cannot read their own workspace AI key'
);
SELECT throws_ok(
  $$ INSERT INTO public.workspace_ai_keys (workspace_id, key_ciphertext, key_hint)
     VALUES ('11111111-1111-1111-1111-111111111111', 'aaaaaaaaaaaaaaaaaaaa', 'dead') $$,
  'permission denied for table workspace_ai_keys',
  'a workspace admin cannot set an AI key directly'
);
SELECT throws_ok(
  $$ DELETE FROM public.workspace_ai_keys $$,
  'permission denied for table workspace_ai_keys',
  'a workspace admin cannot delete an AI key directly'
);

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

-- 14-15: the CHECK bounds hold. key_ciphertext has a floor as well as a
-- ceiling: an empty string is not a cipher envelope, and letting one land
-- would make resolveAnthropicKey fail soft into the platform key while the
-- console reported a tenant key was configured.
SELECT throws_ok(
  $$ INSERT INTO public.workspace_ai_keys (workspace_id, key_ciphertext, key_hint)
     VALUES ('22222222-2222-2222-2222-222222222222', '', 'x') $$,
  'new row for relation "workspace_ai_keys" violates check constraint "workspace_ai_keys_key_ciphertext_check"',
  'an empty ciphertext is refused'
);
SELECT throws_ok(
  $$ INSERT INTO public.workspace_ai_keys (workspace_id, key_ciphertext, key_hint)
     VALUES ('22222222-2222-2222-2222-222222222222', 'aaaaaaaaaaaaaaaaaaaa', 'far-too-long-a-hint') $$,
  'new row for relation "workspace_ai_keys" violates check constraint "workspace_ai_keys_key_hint_check"',
  'an over-long key hint is refused'
);

-- 16: tearing down a workspace takes its key with it. This is the half of
-- teardown that CASCADE handles correctly — contrast platform_audit (suite
-- 35), where CASCADE is exactly what must NOT happen.
DELETE FROM public.workspaces WHERE id = '11111111-1111-1111-1111-111111111111';
SELECT is(
  (SELECT count(*)::int FROM public.workspace_ai_keys
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'),
  0, 'deleting a workspace cascades away its AI key'
);

SELECT * FROM finish();
ROLLBACK;
