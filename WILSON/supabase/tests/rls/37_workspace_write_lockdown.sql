-- =============================================================================
-- 37_workspace_write_lockdown.sql — Session 15 review fixes (migration 0029).
--
-- Pins the thing the pre-commit review found and 0028's own post-conditions
-- did not check: that a PLATFORM OPERATOR cannot destroy a tenant with a
-- direct PostgREST call.
--
-- 0002's `workspaces_write_operator` was `FOR ALL` and 0011 grants ALL on
-- every public table to `authenticated`, so an operator's ordinary aal1
-- browser session could DELETE any workspace — skipping operatorGuard's hard
-- MFA, the typed-slug confirm, the storage sweep and the platform_audit
-- certificate, and stranding the blobs exactly as gap #34 described. The
-- probes below hold both halves of the fix: the policy is narrowed AND the
-- privilege is revoked, because either alone can be undone by a later
-- migration without the other noticing.
--
-- Also pins the projects.workspace_id trigger, which is what makes cloud
-- project creation work for a workspace that is not the seed fixture.
--
-- login_as sets NO app_role claim (0005), so probes that need one build the
-- JWT by hand — the S13 discipline. De-auth before every mid-file login with
-- claims-reset + RESET ROLE (the tests schema is runner-only).
-- =============================================================================
BEGIN;

SELECT plan(14);

SELECT * FROM tests.rls_setup();

-- Make user_a a platform operator: this suite is about what an operator can
-- do WITHOUT going through the Edge Function.
INSERT INTO public.platform_operators (user_id)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
ON CONFLICT (user_id) DO NOTHING;

-- 1-2: the FOR ALL policy is gone and no client INSERT/DELETE arm replaced it.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workspaces'
      AND policyname = 'workspaces_write_operator'),
  0, 'the FOR ALL workspaces_write_operator policy is gone'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workspaces'
      AND cmd IN ('INSERT', 'DELETE')),
  0, 'workspaces has no client INSERT or DELETE policy'
);

-- 3-4: privileges revoked too. A policy pinned only by existence lets CI
-- bless a table that is still writable through a stray GRANT (the S14 lesson).
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.workspaces', 'DELETE'),
  'authenticated has no DELETE privilege on workspaces'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.workspaces', 'INSERT'),
  'authenticated has no INSERT privilege on workspaces'
);

-- 5-6: the operator keeps the reach the console genuinely needs.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workspaces'
      AND policyname IN ('workspaces_operator_read', 'workspaces_operator_update')),
  2, 'the operator read and update policies both exist'
);
SELECT has_function('public', 'fn_workspaces_delete_guard',
  'fn_workspaces_delete_guard() exists');

-- ── As a platform operator, over a normal client session ────────────────────

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

-- 7: an operator still SEES every workspace — including workspace B, which
-- they are not a member of. Losing this would break the console's list view.
SELECT ok(
  (SELECT count(*) FROM public.workspaces
    WHERE id = '22222222-2222-2222-2222-222222222222') = 1,
  'an operator reads a workspace they are not a member of'
);

-- 8: THE PROBE THIS SUITE EXISTS FOR. A direct delete is refused.
SELECT throws_ok(
  $$ DELETE FROM public.workspaces WHERE id = '22222222-2222-2222-2222-222222222222' $$,
  'permission denied for table workspaces',
  'an operator CANNOT delete a tenant directly (teardown must go through the Edge Function)'
);

-- 9: and cannot create one either — provisioning is service_role-only.
SELECT throws_ok(
  $$ INSERT INTO public.workspaces (name, slug) VALUES ('Smuggled', 'smuggled') $$,
  'permission denied for table workspaces',
  'an operator cannot INSERT a workspace directly'
);

-- 10: rename still works — the console's optimistic path depends on it.
SELECT lives_ok(
  $$ UPDATE public.workspaces SET name = 'Renamed By Operator'
      WHERE id = '22222222-2222-2222-2222-222222222222' $$,
  'an operator can still rename a workspace'
);

-- 11: but not suspend one — deleted_at stays service_role-only (0020's guard).
SELECT throws_ok(
  $$ UPDATE public.workspaces SET deleted_at = now()
      WHERE id = '22222222-2222-2222-2222-222222222222' $$,
  'workspace column is not client-editable',
  'an operator cannot suspend a workspace directly'
);

-- ── projects.workspace_id derivation ────────────────────────────────────────
-- 12: the exact insert RabbitProvider.createProject used to send — a project
-- stamped with the pre-multi-tenant seed constant — is still refused. The
-- trigger only fills a NULL; it must not launder a wrong value.
SELECT throws_ok(
  $$ INSERT INTO public.projects (id, workspace_id, title, status)
     VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Seeded', 'active') $$,
  'new row violates row-level security policy for table "projects"',
  'a project carrying a foreign workspace_id is still refused'
);

-- 13: omitting workspace_id now works, and lands in the caller's workspace.
-- Before 0029 this was a 23502 (NOT NULL, no default since 0004).
SELECT lives_ok(
  $$ INSERT INTO public.projects (id, title, status)
     VALUES ('aaaa1111-0000-0000-0000-000000003701', 'Derived', 'active') $$,
  'a project omitting workspace_id is accepted'
);

-- 14: and it landed in the RIGHT workspace.
SELECT is(
  (SELECT workspace_id FROM public.projects
    WHERE id = 'aaaa1111-0000-0000-0000-000000003701'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'the derived workspace_id is the caller''s own'
);

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
