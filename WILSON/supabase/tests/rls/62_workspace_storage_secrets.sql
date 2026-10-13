-- =============================================================================
-- 62_workspace_storage_secrets.sql — Session 37: the bucket secret's table
-- and the presign authorisation predicates (0051).
--
-- What this pins:
--
--   1. THE SECRET IS SERVICE-ROLE ONLY, THE 0028 SHAPE EXACTLY: RLS enabled
--      AND forced, ZERO policies, client privileges revoked. Suite 34
--      (workspace_ai_keys) is this suite's older twin. A policy appearing on
--      this table IS a client read path for tenant bucket credentials —
--      0051's own post-condition refuses it at migration time; this refuses
--      it forever after.
--
--   2. THE PRESIGN PREDICATES answer as the CALLER. can_presign_project_write
--      / _read are SECURITY INVOKER and are what the storage-presign Edge
--      Function calls over PostgREST with the caller's JWT — so these probes
--      run under set_config'd claims, exactly the arms files_insert /
--      files_select carry (0038): workspace match, live membership,
--      can_write_project with its admin / unstaffed / project-role arms, and
--      COALESCE(false) for a project the caller cannot even see. The brief's
--      required probes — refused for a non-member, refused for a project the
--      caller cannot write — are here.
--
--   3. THE FK CASCADE: a workspace's secret dies with the workspace, on a
--      throwaway workspace so no fixture is harmed.
--
-- 🚨 The predicates must stay SECURITY INVOKER. Flipping one to DEFINER
-- would evaluate projects-visibility as postgres and silently widen the
-- boundary — probed structurally below, because no behavioural probe can
-- see the difference until it is exploited.
-- =============================================================================

BEGIN;

SELECT plan(24);

SELECT * FROM tests.rls_setup();

-- ── 1. The table is service-role only (the 0028 shape) ──────────────────────

SELECT has_table('public', 'workspace_storage_secrets', 'the secrets table exists');

SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
    WHERE oid = 'public.workspace_storage_secrets'::regclass),
  'RLS is enabled AND forced');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname='public' AND tablename='workspace_storage_secrets'),
  0, 'ZERO policies — there is deliberately no client path to a bucket secret');

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.workspace_storage_secrets', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.workspace_storage_secrets', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.workspace_storage_secrets', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.workspace_storage_secrets', 'DELETE'),
  'authenticated holds no privilege on the secrets table');

SELECT ok(
  NOT has_table_privilege('anon', 'public.workspace_storage_secrets', 'SELECT'),
  'anon cannot read it either');

-- The ciphertext bounds are the 0028 sanity cap, and the hint can never be
-- long enough to BE the secret.
SELECT throws_ok(
  $$INSERT INTO public.workspace_storage_secrets (workspace_id, secret_ciphertext, key_hint)
    VALUES ('11111111-1111-1111-1111-111111111111', 'short', '9f2c')$$,
  'new row for relation "workspace_storage_secrets" violates check constraint "workspace_storage_secrets_secret_ciphertext_check"',
  'a too-short ciphertext is refused — that is not an envelope');

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage_secrets (workspace_id, secret_ciphertext, key_hint)
    VALUES ('11111111-1111-1111-1111-111111111111', repeat('x', 32), repeat('h', 13))$$,
  'new row for relation "workspace_storage_secrets" violates check constraint "workspace_storage_secrets_key_hint_check"',
  'a 13-character hint is refused — a hint that long is leakage, not a hint');

-- ── 2. The FK cascade, on a throwaway workspace ─────────────────────────────

INSERT INTO public.workspaces (id, name, slug)
VALUES ('33333333-3333-3333-3333-333333333333', 'Throwaway', 'ws-throwaway')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_storage_secrets (workspace_id, secret_ciphertext, key_hint)
VALUES ('33333333-3333-3333-3333-333333333333', repeat('c', 32), '9f2c');

SELECT is(
  (SELECT count(*)::int FROM public.workspace_storage_secrets
    WHERE workspace_id = '33333333-3333-3333-3333-333333333333'),
  1, 'a secret can be stored (as service_role/postgres only)');

DELETE FROM public.workspaces WHERE id = '33333333-3333-3333-3333-333333333333';

SELECT is(
  (SELECT count(*)::int FROM public.workspace_storage_secrets
    WHERE workspace_id = '33333333-3333-3333-3333-333333333333'),
  0, 'and it dies with its workspace — no orphaned tenant credential');

-- ── 3. The presign predicates: structure ────────────────────────────────────

SELECT ok(
  NOT (SELECT prosecdef FROM pg_proc
        WHERE oid = 'public.can_presign_project_write(uuid)'::regprocedure),
  'the write predicate is SECURITY INVOKER — it answers as the caller');

SELECT ok(
  NOT (SELECT prosecdef FROM pg_proc
        WHERE oid = 'public.can_presign_project_read(uuid)'::regprocedure),
  'the read predicate is SECURITY INVOKER too');

SELECT ok(
  has_function_privilege('authenticated', 'public.can_presign_project_write(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.can_presign_project_read(uuid)', 'EXECUTE'),
  'authenticated can call both — the Edge Function forwards the caller''s JWT');

SELECT ok(
  NOT has_function_privilege('anon', 'public.can_presign_project_write(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.can_presign_project_read(uuid)', 'EXECUTE'),
  'anon can call neither');

-- ── 4. The predicates: behaviour, as real claim-carrying callers ────────────
-- user_b gains a second membership: plain MEMBER of workspace A. The
-- fixtures make only admins, and the member arms are where the presign
-- brief's probes live.

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'user', 'user_b_in_a', 'User B in A', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- The workspace admin may presign for their project.
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT is(
  public.can_presign_project_write('aaaa1111-0000-0000-0000-000000000001'),
  true, 'a workspace admin may presign writes for their own project');

SELECT is(
  public.can_presign_project_read('aaaa1111-0000-0000-0000-000000000001'),
  true, 'and reads');

-- Refused for a project the caller cannot see: the OTHER workspace's
-- project yields an empty subquery under RLS, and COALESCE makes that a
-- refusal, not a NULL (the S33 lesson — NULL fails OPEN in an IF).
SELECT is(
  public.can_presign_project_write('bbbb2222-0000-0000-0000-000000000001'),
  false, 'refused for another workspace''s project — invisible, therefore false');

SELECT is(
  public.can_presign_project_read('bbbb2222-0000-0000-0000-000000000001'),
  false, 'reads too');

SELECT is(
  public.can_presign_project_write('99999999-9999-9999-9999-999999999999'),
  false, 'refused for a project that does not exist — false, never NULL');

-- A plain member of workspace A, against an UNSTAFFED project: writable —
-- the unstaffed arm is can_write_project's own rule (0013), evaluated here
-- rather than re-implemented.
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','user')
)::text, true);

SELECT is(
  public.can_presign_project_write('aaaa1111-0000-0000-0000-000000000001'),
  true, 'a member may presign writes for an UNSTAFFED project (0013''s arm, evaluated)');

-- Staff the project with someone else, and the same member is refused: the
-- brief's "refused for a project the caller cannot write". The staffing
-- write is fixture surgery, not the behaviour under test — done as postgres
-- (the session user; SET ROLE back is always allowed), then the member's
-- claims are restored.
SELECT set_config('role', 'postgres', true);
INSERT INTO public.project_members (project_id, user_id, project_role)
VALUES ('aaaa1111-0000-0000-0000-000000000001',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'manager');
SELECT set_config('role', 'authenticated', true);

SELECT is(
  public.can_presign_project_write('aaaa1111-0000-0000-0000-000000000001'),
  false, 'once staffed, a non-roster member cannot presign writes');

SELECT is(
  public.can_presign_project_read('aaaa1111-0000-0000-0000-000000000001'),
  true, 'but may still presign reads — read is membership, not roster');

-- Deactivate the membership and even reads refuse: the live row is the
-- authority, exactly as the Edge guards treat it. Fixture surgery as
-- postgres again.
SELECT set_config('role', 'postgres', true);
UPDATE public.workspace_members
   SET is_active = false
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
   AND user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
SELECT set_config('role', 'authenticated', true);

SELECT is(
  public.can_presign_project_read('aaaa1111-0000-0000-0000-000000000001'),
  false, 'a deactivated membership refuses reads — the brief''s non-member probe');

SELECT is(
  public.can_presign_project_write('aaaa1111-0000-0000-0000-000000000001'),
  false, 'and writes');

-- No claims at all — the anonymous shape ('{}', a valid empty claim set;
-- a bare '' would fail the helpers' ::JSONB cast before any predicate ran).
-- Everything is NULL inside the predicate, and everything COALESCEs to a
-- refusal.
SELECT set_config('request.jwt.claims', '{}', true);

SELECT is(
  public.can_presign_project_write('aaaa1111-0000-0000-0000-000000000001'),
  false, 'no claims, no presign — the boundary fails closed');

SELECT * FROM finish();

ROLLBACK;
