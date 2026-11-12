-- =============================================================================
-- 0008_fix_rls_recursion.sql
--
-- The workspace_members admin-write policy from 0002 has an EXISTS subquery
-- against workspace_members to check the caller's app_role:
--
--   EXISTS (
--     SELECT 1 FROM public.workspace_members m2
--      WHERE m2.user_id = auth.uid()
--        AND m2.workspace_id = public.workspace_members.workspace_id
--        AND m2.app_role = 'admin'
--        AND m2.is_active
--   )
--
-- That inner SELECT is itself subject to RLS on workspace_members, which
-- includes THIS policy — triggering infinite recursion the moment any
-- function or policy queries workspace_members (which 0004's
-- has_active_membership does on every RABBIT table insert/update/delete).
--
-- Fix: evaluate app_role from the JWT's app_metadata claim instead. The
-- custom_access_token_hook (0001/0003) bakes the active workspace's
-- app_role into every token at issuance, so this is authoritative without
-- touching workspace_members.
--
-- Also marks has_active_membership as SECURITY DEFINER so its internal
-- SELECT on workspace_members runs with the function owner's privileges,
-- bypassing RLS. Defense-in-depth in case a future policy introduces a
-- different recursive path.
-- =============================================================================

-- ── Helper: read app_role from the JWT ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::JSONB
      #>> '{app_metadata,app_role}',
    ''
  );
$$;

COMMENT ON FUNCTION public.current_app_role IS
  'Returns app_role from the caller''s JWT app_metadata (set by custom_access_token_hook). Avoids querying workspace_members, which would recurse under RLS.';

-- ── Redefine has_active_membership as SECURITY DEFINER ──────────────────────
CREATE OR REPLACE FUNCTION public.has_active_membership(ws UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.user_id = auth.uid()
       AND wm.workspace_id = ws
       AND wm.is_active
  );
$$;

-- SECURITY DEFINER makes the function ignore RLS on its internal query,
-- so callers can safely invoke it from any policy without recursion.

-- ── Redefine ws_members_admin_write to use the JWT instead of self-query ────
DROP POLICY IF EXISTS ws_members_admin_write ON public.workspace_members;

CREATE POLICY ws_members_admin_write ON public.workspace_members
  FOR ALL
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_app_role() = 'admin'
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_app_role() = 'admin'
  );
