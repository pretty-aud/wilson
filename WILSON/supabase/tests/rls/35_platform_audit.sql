-- =============================================================================
-- 35_platform_audit.sql — Session 15: the platform-operator tier
-- (migration 0028).
--
-- Two things are pinned here.
--
-- (1) The operator tier is LIVE-ROW. `is_platform_operator` has existed as a
--     JWT claim since 0001 and until S15 exactly one client file read it and
--     no policy trusted it. public.is_platform_operator() asks the
--     public.platform_operators TABLE instead, so revoking an operator bites
--     on the next statement rather than the next token refresh. The probes
--     below assert the helper tracks the table, and that the cross-tenant
--     reader is unreachable from any client role.
--
-- (2) A teardown certificate OUTLIVES the tenant it certifies. This is
--     gap #34's other half: app_events and file_events both carry
--     `workspace_id ... ON DELETE CASCADE`, so hard-deleting a workspace
--     destroys the evidence of its own destruction. platform_audit carries
--     no FK and snapshots slug/name as text. The contrast probe deletes one
--     workspace and asserts the file_events row is gone while the
--     platform_audit row survives, still naming the company.
--
-- login_as sets NO app_role claim (0005) — none of these arms needs one:
-- the operator arm reads the table, not the JWT, which is the whole point.
-- De-auth before every mid-file login_as with claims-reset + RESET ROLE
-- (the tests schema is runner-only; tests.logout() is not callable while
-- role = authenticated).
-- =============================================================================
BEGIN;

SELECT plan(24);

SELECT * FROM tests.rls_setup();

-- A third workspace, disposable: the teardown probe hard-deletes it, and
-- deleting ws_a/ws_b would cascade the shared fixtures out from under the
-- rest of the file.
INSERT INTO public.workspaces (id, name, slug)
VALUES ('33333333-3333-3333-3333-333333333333', 'Doomed Studio', 'ws-doomed')
ON CONFLICT (id) DO NOTHING;

-- 1-3: the objects exist.
SELECT has_table('public'::name, 'platform_audit'::name,
  'platform_audit table exists');
SELECT has_function('public', 'is_platform_operator',
  'is_platform_operator() exists');
SELECT has_function('public', 'operator_workspace_summary',
  'operator_workspace_summary() exists');

-- 4: platform_audit must NOT reference workspaces. If a well-meaning later
-- migration adds `REFERENCES workspaces(id) ON DELETE CASCADE` for tidiness,
-- every destruction certificate silently becomes self-erasing.
SELECT is(
  (SELECT count(*)::int FROM pg_constraint
    WHERE conrelid = 'public.platform_audit'::regclass
      AND contype = 'f' AND confrelid = 'public.workspaces'::regclass),
  0, 'platform_audit has no FK to workspaces (certificates outlive the tenant)'
);

-- 5-6: RLS on + forced, exactly one policy (the operator SELECT arm).
SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.platform_audit'::regclass),
  'platform_audit has RLS enabled and forced'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'platform_audit'),
  1, 'platform_audit has exactly one policy (operator read)'
);

-- 7-8: append-only — no write policy, and the write privileges are revoked
-- too. An operator session must not be able to edit away a certificate.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'platform_audit'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE')),
  0, 'platform_audit has no client write policy'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.platform_audit', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.platform_audit', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.platform_audit', 'INSERT'),
  'authenticated holds no write privilege on platform_audit'
);

-- 9-10: the cross-tenant reader is service_role only. This is the function
-- that returns every company's numbers in one call; a client-executable
-- SECURITY DEFINER version of it would be a tenancy break with no policy
-- anywhere to catch it.
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.operator_workspace_summary()', 'EXECUTE'),
  'authenticated cannot execute operator_workspace_summary()'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.operator_workspace_summary()', 'EXECUTE'),
  'anon cannot execute operator_workspace_summary()'
);

-- Seed audit rows as the runner (postgres has BYPASSRLS), one of them for the
-- doomed workspace.
INSERT INTO public.platform_audit
  (actor_user_id, actor_label, action, workspace_id, workspace_slug, workspace_name, message)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'operator_a', 'workspace.created',
   '11111111-1111-1111-1111-111111111111', 'ws-a', 'Workspace A',
   'Created workspace Workspace A'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'operator_a', 'workspace.teardown',
   '33333333-3333-3333-3333-333333333333', 'ws-doomed', 'Doomed Studio',
   'Tore down workspace Doomed Studio');

-- A file_events row for the doomed workspace: the CASCADE control for the
-- survival probe.
INSERT INTO public.file_events
  (workspace_id, project_id, file_id, event, file_name)
VALUES
  ('33333333-3333-3333-3333-333333333333',
   'aaaa1111-0000-0000-0000-000000003501',
   'aaaa1111-0000-0000-0000-000000003502',
   'purged', 'doomed.png');

-- ── As a NON-operator workspace admin ───────────────────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

-- 11: the helper is false for someone with no platform_operators row, even
-- though they are an admin of their own workspace.
SELECT ok(
  NOT public.is_platform_operator(),
  'is_platform_operator() is false for a plain workspace admin'
);

-- 12: and the read policy therefore hides every row.
SELECT is(
  (SELECT count(*)::int FROM public.platform_audit),
  0, 'a non-operator sees no platform_audit rows'
);

-- 13-14: writes refused. INSERT is refused at the privilege layer; the
-- absence of a policy would refuse it anyway, and both are asserted because
-- either one alone can be undone by a later migration.
SELECT throws_ok(
  $$ INSERT INTO public.platform_audit (action, message)
     VALUES ('workspace.teardown', 'forged') $$,
  'permission denied for table platform_audit',
  'a non-operator cannot forge a platform_audit row'
);
SELECT throws_ok(
  $$ UPDATE public.platform_audit SET message = 'rewritten' $$,
  'permission denied for table platform_audit',
  'a non-operator cannot rewrite a platform_audit row'
);

-- 15: and cannot reach the cross-tenant reader.
SELECT throws_ok(
  $$ SELECT * FROM public.operator_workspace_summary() $$,
  'permission denied for function operator_workspace_summary',
  'a non-operator cannot call operator_workspace_summary()'
);

-- ── Same user, now a platform operator ──────────────────────────────────────

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

INSERT INTO public.platform_operators (user_id)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
ON CONFLICT (user_id) DO NOTHING;

SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

-- 16: the helper flips WITHOUT a new token. The claim in this session's JWT
-- was never updated — that is the point of reading the live row.
SELECT ok(
  public.is_platform_operator(),
  'is_platform_operator() is true once the platform_operators row exists'
);

-- 17: the operator now reads the stream, including rows for workspaces they
-- are not a member of (ws-doomed).
SELECT is(
  (SELECT count(*)::int FROM public.platform_audit),
  2, 'an operator reads platform_audit across every workspace'
);

-- 18: an operator still cannot write it — the console writes through
-- service_role Edge Functions so every line is server-stamped, exactly like
-- the 0021 'admin' stream reservation.
SELECT throws_ok(
  $$ INSERT INTO public.platform_audit (action, message)
     VALUES ('workspace.teardown', 'operator-forged') $$,
  'permission denied for table platform_audit',
  'even an operator cannot write platform_audit directly'
);

-- 19: operators can see each other (0002 gave platform_operators a
-- self-SELECT arm only, so a console roster needed the new policy).
SELECT is(
  (SELECT count(*)::int FROM public.platform_operators),
  1, 'an operator can list the operator roster'
);

-- ── Teardown survival: the gap #34 pin ──────────────────────────────────────

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

DELETE FROM public.workspaces WHERE id = '33333333-3333-3333-3333-333333333333';

-- 20: the CASCADE control — file_events went with the tenant.
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE workspace_id = '33333333-3333-3333-3333-333333333333'),
  0, 'file_events cascades away when its workspace is torn down'
);

-- 21: the certificate survived, and still names the company. Without the
-- slug/name snapshot this row would be a bare UUID pointing at nothing.
SELECT is(
  (SELECT workspace_name FROM public.platform_audit
    WHERE workspace_id = '33333333-3333-3333-3333-333333333333'
      AND action = 'workspace.teardown'),
  'Doomed Studio',
  'the teardown certificate survives the workspace and still names it'
);


-- ── 0033: the migration-0011 privilege trap, for auth_attempt_log ──
-- 0011's blanket GRANT plus its ALTER DEFAULT PRIVILEGES left anon holding
-- every table privilege on auth_attempt_log; 0033 revoked it. Assert the revoke rather
-- than assume it — a policy-only check passes while a privilege hole is wide
-- open, which is exactly how 26 tables stayed open until S21 tripped over one.
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.auth_attempt_log', 'SELECT') OR
    has_table_privilege('anon', 'public.auth_attempt_log', 'INSERT') OR
    has_table_privilege('anon', 'public.auth_attempt_log', 'UPDATE') OR
    has_table_privilege('anon', 'public.auth_attempt_log', 'DELETE')
  ),
  'anon holds no table privilege on auth_attempt_log'
);

-- ── 0033: the migration-0011 privilege trap, for platform_operators ──
-- 0011's blanket GRANT plus its ALTER DEFAULT PRIVILEGES left anon holding
-- every table privilege on platform_operators; 0033 revoked it. Assert the revoke rather
-- than assume it — a policy-only check passes while a privilege hole is wide
-- open, which is exactly how 26 tables stayed open until S21 tripped over one.
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.platform_operators', 'SELECT') OR
    has_table_privilege('anon', 'public.platform_operators', 'INSERT') OR
    has_table_privilege('anon', 'public.platform_operators', 'UPDATE') OR
    has_table_privilege('anon', 'public.platform_operators', 'DELETE')
  ),
  'anon holds no table privilege on platform_operators'
);

-- ── 0033: no SECURITY DEFINER function in public is executable by anon ──
-- Schema-wide rather than specific to this suite's tables; it lives here
-- because this is already where the anon function-privilege guards are (see
-- the operator_workspace_summary probe above).
--
-- A SECURITY DEFINER function runs as its OWNER and bypasses RLS by
-- construction, and PostgREST exposes every public function at
-- /rest/v1/rpc/<name> — so anon EXECUTE on one is a pre-auth RLS bypass, not
-- a latent grant. 0011:23 granted EXECUTE on ALL functions to anon; 0033
-- revoked the seven that were still reachable (project_is_staffed and
-- fn_comment_project_id being real data oracles, the other five caller
-- predicates).
--
-- This is a count rather than a named list on purpose: it fails for a
-- function nobody has thought of yet, including one re-opened by a
-- CREATE OR REPLACE that resets the ACL.
SELECT is(
  (SELECT count(*)::int
     FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prokind = 'f'
      AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'EXECUTE')),
  0,
  '0033: no SECURITY DEFINER function in public is executable by anon'
);

SELECT * FROM finish();
ROLLBACK;
