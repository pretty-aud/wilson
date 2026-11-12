-- =============================================================================
-- 0011_role_grants.sql
-- Session 4 hotfix — explicit privileges for the API roles.
--
-- Hosted Supabase ships ALTER DEFAULT PRIVILEGES so tables created by
-- `postgres` are automatically granted to anon/authenticated/service_role.
-- Newer local-stack images (July 2026 CLI, used by CI) do NOT — so every
-- direct table access as `authenticated` failed with `permission denied`,
-- killing all 16 pgTAP files while the hosted envs kept working.
--
-- Grants are NOT the security boundary — RLS is. These just let the API
-- roles reach the tables so the policies can do their job, identically in
-- every environment. Blanket-granting EXECUTE would silently undo the
-- 0009/0010 function lockdowns, so those revokes are re-asserted below.
--
-- Idempotent: safe to re-run (grants/revokes are no-ops when already set).
-- =============================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

-- Future objects created by postgres (later migrations) get the same.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- ── Re-assert function lockdowns the blanket EXECUTE grant just widened ──

-- 0009: provisioning is service_role-only (Edge Function path).
REVOKE EXECUTE ON FUNCTION public.provision_workspace_and_admin(TEXT, TEXT, UUID, TEXT, TEXT)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.provision_workspace_and_admin(TEXT, TEXT, UUID, TEXT, TEXT)
  TO service_role;

-- 0010: the member directory is for signed-in members only.
REVOKE EXECUTE ON FUNCTION public.workspace_directory() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.workspace_directory() TO authenticated, service_role;
