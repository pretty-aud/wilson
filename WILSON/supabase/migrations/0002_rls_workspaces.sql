-- =============================================================================
-- 0002_rls_workspaces.sql
-- Session 1 — RLS bootstrap for the vertical slice. Only the three tables
-- we need to prove the stack are enabled here; Session 2 sweeps every RABBIT
-- table.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- workspaces: a user sees only workspaces they belong to (active membership).
-- -----------------------------------------------------------------------------
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspaces_select ON public.workspaces;
CREATE POLICY workspaces_select ON public.workspaces
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND id IN (
      SELECT workspace_id
        FROM public.workspace_members
       WHERE user_id = auth.uid()
         AND is_active
    )
  );

-- Writes to workspaces are platform-operator-only for v1. Session 10 opens
-- this up via the Platform Operator Console.
DROP POLICY IF EXISTS workspaces_write_operator ON public.workspaces;
CREATE POLICY workspaces_write_operator ON public.workspaces
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.platform_operators po
       WHERE po.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.platform_operators po
       WHERE po.user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- workspace_members: a user sees their own membership rows, plus all rows
-- in workspaces where they are active (needed for "Team Members" in Session 4).
-- -----------------------------------------------------------------------------
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ws_members_select ON public.workspace_members;
CREATE POLICY ws_members_select ON public.workspace_members
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR workspace_id = public.current_workspace_id()
  );

-- Admins in a workspace can manage its membership. Writes refined in Session 3.
DROP POLICY IF EXISTS ws_members_admin_write ON public.workspace_members;
CREATE POLICY ws_members_admin_write ON public.workspace_members
  FOR ALL
  USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (
      SELECT 1 FROM public.workspace_members m2
       WHERE m2.user_id = auth.uid()
         AND m2.workspace_id = public.workspace_members.workspace_id
         AND m2.app_role = 'admin'
         AND m2.is_active
    )
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
  );

-- -----------------------------------------------------------------------------
-- platform_operators: self-visible only (you can tell if *you* are an operator).
-- Full management only by other operators, via service_role, or manually.
-- -----------------------------------------------------------------------------
ALTER TABLE public.platform_operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_operators FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_operators_self ON public.platform_operators;
CREATE POLICY platform_operators_self ON public.platform_operators
  FOR SELECT
  USING (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- auth_attempt_log: readable only by platform operators, writable only by
-- service_role (Edge Function).
-- -----------------------------------------------------------------------------
ALTER TABLE public.auth_attempt_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_log_operator_read ON public.auth_attempt_log;
CREATE POLICY auth_log_operator_read ON public.auth_attempt_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.platform_operators po
       WHERE po.user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- projects: RLS for the vertical slice. Conditional so this migration is safe
-- to run in projects that don't have a `projects` table yet (the RABBIT schema
-- is applied by its own migration sweep in Session 2).
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'projects'
  ) THEN
    -- Ensure workspace_id column exists; Session 2 does the full audit, but the
    -- slice needs it now.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'projects'
         AND column_name = 'workspace_id'
    ) THEN
      EXECUTE 'ALTER TABLE public.projects
                ADD COLUMN workspace_id UUID
                  REFERENCES public.workspaces(id) ON DELETE CASCADE';
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_projects_workspace_id
                ON public.projects (workspace_id)';
    END IF;

    EXECUTE 'ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS projects_select_by_workspace ON public.projects';
    EXECUTE 'CREATE POLICY projects_select_by_workspace
               ON public.projects
               FOR SELECT
               USING (workspace_id = public.current_workspace_id())';
  END IF;
END $$;
