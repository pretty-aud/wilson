-- =============================================================================
-- 0005_test_helpers.sql
-- Session 2 — pgTAP fixtures for the RLS test suite.
--
-- Creates a `tests` schema with helper functions used by every file in
-- supabase/tests/rls/. Idempotent.
--
-- Harmless in production: the schema sits unused; no policies reference it.
-- The functions are SECURITY INVOKER so they never escalate privilege.
--
-- Cross-session note: SESSION 3 may reuse tests.rls_setup() to seed email/
-- invite fixtures; keep the contract stable (return type + semantics).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS tests;

-- Rows returned by tests.rls_setup() — two workspaces, two members, one project
-- each (more rows seeded per-test as needed). All IDs are deterministic for
-- readable test failures.
CREATE OR REPLACE FUNCTION tests.rls_setup()
RETURNS TABLE (
  ws_a_id       UUID,
  ws_b_id       UUID,
  user_a_id     UUID,
  user_b_id     UUID,
  project_a_id  UUID,
  project_b_id  UUID
)
LANGUAGE plpgsql AS $$
DECLARE
  _ws_a       UUID := '11111111-1111-1111-1111-111111111111';
  _ws_b       UUID := '22222222-2222-2222-2222-222222222222';
  _user_a     UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  _user_b     UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  _project_a  UUID := 'aaaa1111-0000-0000-0000-000000000001';
  _project_b  UUID := 'bbbb2222-0000-0000-0000-000000000001';
BEGIN
  -- auth.users: one row per workspace member. In the CI local DB these inserts
  -- succeed; in prod this function should never be called (guard in CI only).
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, aud, role,
                          instance_id, created_at, updated_at)
  VALUES
    (_user_a, 'user_a@test.local', crypt('testpw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     'authenticated', 'authenticated',
     '00000000-0000-0000-0000-000000000000', now(), now()),
    (_user_b, 'user_b@test.local', crypt('testpw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     'authenticated', 'authenticated',
     '00000000-0000-0000-0000-000000000000', now(), now())
  ON CONFLICT (id) DO NOTHING;

  -- workspaces
  INSERT INTO public.workspaces (id, name, slug)
  VALUES
    (_ws_a, 'Workspace A', 'ws-a'),
    (_ws_b, 'Workspace B', 'ws-b')
  ON CONFLICT (id) DO NOTHING;

  -- memberships: user_a ∈ ws_a as admin, user_b ∈ ws_b as admin
  INSERT INTO public.workspace_members
    (workspace_id, user_id, app_role, username, display_name, is_active)
  VALUES
    (_ws_a, _user_a, 'admin', 'user_a', 'User A', true),
    (_ws_b, _user_b, 'admin', 'user_b', 'User B', true)
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  -- one project per workspace, so parent-join tests have something to lean on
  INSERT INTO public.projects (id, workspace_id, title, created_by)
  VALUES
    (_project_a, _ws_a, 'Project A', _user_a),
    (_project_b, _ws_b, 'Project B', _user_b)
  ON CONFLICT (id) DO NOTHING;

  RETURN QUERY SELECT _ws_a, _ws_b, _user_a, _user_b, _project_a, _project_b;
END;
$$;

-- Set the JWT claims that the Postgres session sees, as if logged in as user.
-- Supabase reads app_metadata.workspace_id via current_workspace_id().
CREATE OR REPLACE FUNCTION tests.login_as(user_uuid UUID, workspace_uuid UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', user_uuid::text,
      'role', 'authenticated',
      'app_metadata', jsonb_build_object('workspace_id', workspace_uuid::text)
    )::text,
    true
  );
  PERFORM set_config('role', 'authenticated', true);
END;
$$;

CREATE OR REPLACE FUNCTION tests.logout()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('role', 'postgres', true);
END;
$$;

COMMENT ON SCHEMA tests IS
  'pgTAP fixtures for the RLS test suite. Safe in prod; not referenced by any policy.';
