-- =============================================================================
-- 0010_member_directory.sql
-- Session 4 — Team Members page becomes the single source of truth for
-- workspace membership. Three DB-level pieces:
--
--   1. workspace_members.department. The Team Members UI and the profile
--      editor group people by department; until now department only existed
--      on the RABBIT team_members JSON entity. Profile fields stay on
--      workspace_members (same reasoning as 0006).
--
--   2. Manager write access, narrowly scoped. Admins/Managers can edit other
--      members' title + department from the Team Members page. Admins already
--      have full write (0008). Managers get an UPDATE policy here, and the
--      0009 guard trigger is extended so a manager touching another member's
--      row may ONLY change title/department — every other column raises.
--
--   3. workspace_directory() RPC. The UI needs member emails, which live only
--      in auth.users (0006 deliberately kept them off workspace_members).
--      auth.users is not readable by authenticated clients, so a
--      SECURITY DEFINER function joins it in, scoped to the caller's active
--      workspace. Email is only returned to admin/manager callers (and for
--      the caller's own row) — the User view treats teammates' emails as
--      sensitive.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ── 1. department column ─────────────────────────────────────────────────────

ALTER TABLE public.workspace_members
  ADD COLUMN IF NOT EXISTS department TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'workspace_members_department_len'
       AND conrelid = 'public.workspace_members'::regclass
  ) THEN
    ALTER TABLE public.workspace_members
      ADD CONSTRAINT workspace_members_department_len
      CHECK (department IS NULL OR char_length(department) <= 80);
  END IF;
END $$;

-- ── 2. manager write policy + extended guard trigger ─────────────────────────

DROP POLICY IF EXISTS ws_members_manager_write ON public.workspace_members;
CREATE POLICY ws_members_manager_write ON public.workspace_members
  FOR UPDATE
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_app_role() = 'manager'
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_app_role() = 'manager'
  );

-- Extends 0009's guard. Branch order matters: admin and service_role bypass
-- first, then self-update rules (a manager editing their OWN row follows the
-- self rules, same as any member), then the manager-on-others allowlist.
CREATE OR REPLACE FUNCTION public.fn_ws_members_prevent_self_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Skip the guard when the caller is an admin of the target workspace; the
  -- admin-write policy already ran its own checks.
  IF public.current_app_role() = 'admin'
     AND NEW.workspace_id = public.current_workspace_id() THEN
    RETURN NEW;
  END IF;
  -- Skip when the caller is service_role (Edge Functions, migrations).
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id = auth.uid() THEN
    IF NEW.app_role IS DISTINCT FROM OLD.app_role THEN
      RAISE EXCEPTION 'self-role change not allowed';
    END IF;
    IF NEW.username IS DISTINCT FROM OLD.username THEN
      RAISE EXCEPTION 'self-username change not allowed';
    END IF;
    IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
      RAISE EXCEPTION 'workspace move not allowed on self-update';
    END IF;
    -- Self-DEactivation is legitimate off-boarding; self-REactivation would
    -- let a deactivated manager/admin claim-holder undo it via the
    -- role-write policies (which check the JWT claim, not the row).
    IF NEW.is_active AND NOT OLD.is_active THEN
      RAISE EXCEPTION 'self-reactivation not allowed';
    END IF;
  ELSIF public.current_app_role() = 'manager' THEN
    -- Manager editing someone else's row: title + department only, and only
    -- while the manager's own membership row is still active (the claim can
    -- outlive a deactivation by up to the token TTL).
    IF NOT EXISTS (
      SELECT 1 FROM public.workspace_members me
       WHERE me.workspace_id = NEW.workspace_id
         AND me.user_id = auth.uid()
         AND me.is_active
    ) THEN
      RAISE EXCEPTION 'inactive members may not edit the roster';
    END IF;
    IF NEW.app_role      IS DISTINCT FROM OLD.app_role
       OR NEW.username     IS DISTINCT FROM OLD.username
       OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
       OR NEW.user_id      IS DISTINCT FROM OLD.user_id
       OR NEW.display_name IS DISTINCT FROM OLD.display_name
       OR NEW.pronouns     IS DISTINCT FROM OLD.pronouns
       OR NEW.avatar_url   IS DISTINCT FROM OLD.avatar_url
       OR NEW.onboarded_at IS DISTINCT FROM OLD.onboarded_at
       OR NEW.is_active    IS DISTINCT FROM OLD.is_active
       OR NEW.created_at   IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'managers may only edit title and department';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger from 0009 already points at this function name; recreate anyway so
-- a fresh database applying 0010 alone still gets wired (idempotent).
DROP TRIGGER IF EXISTS trg_ws_members_self_guard ON public.workspace_members;
CREATE TRIGGER trg_ws_members_self_guard
  BEFORE UPDATE ON public.workspace_members
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_ws_members_prevent_self_role_change();

-- ── 3. workspace_directory() RPC ─────────────────────────────────────────────
-- SECURITY DEFINER so the auth.users join works (authenticated clients cannot
-- read auth.users directly). The function re-checks membership itself — it
-- must not lean on RLS because SECURITY DEFINER bypasses it.
CREATE OR REPLACE FUNCTION public.workspace_directory()
RETURNS TABLE (
  workspace_id UUID,
  user_id      UUID,
  app_role     TEXT,
  username     TEXT,
  display_name TEXT,
  pronouns     TEXT,
  title        TEXT,
  department   TEXT,
  avatar_url   TEXT,
  is_active    BOOLEAN,
  onboarded_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ,
  email        TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws   UUID := public.current_workspace_id();
  v_uid  UUID := auth.uid();
  -- Caller's role comes from their LIVE membership row, NOT the JWT claim:
  -- a demoted manager's in-flight token keeps app_role='manager' until it
  -- refreshes (~1h). RLS policies must use the claim (0008 recursion), but
  -- this function is SECURITY DEFINER and already probes the caller's row,
  -- so the row-derived role is free and takes effect immediately.
  v_role TEXT;
BEGIN
  IF v_ws IS NOT NULL AND v_uid IS NOT NULL THEN
    SELECT wm.app_role INTO v_role
      FROM public.workspace_members wm
     WHERE wm.workspace_id = v_ws
       AND wm.user_id = v_uid
       AND wm.is_active;
  END IF;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'not_a_workspace_member';
  END IF;

  RETURN QUERY
  SELECT wm.workspace_id,
         wm.user_id,
         wm.app_role,
         wm.username,
         wm.display_name,
         wm.pronouns,
         wm.title,
         wm.department,
         wm.avatar_url,
         wm.is_active,
         wm.onboarded_at,
         wm.created_at,
         CASE
           WHEN v_role IN ('admin', 'manager') OR wm.user_id = v_uid
             THEN au.email::text
           ELSE NULL
         END AS email
    FROM public.workspace_members wm
    LEFT JOIN auth.users au ON au.id = wm.user_id
   WHERE wm.workspace_id = v_ws
   ORDER BY lower(coalesce(wm.display_name, wm.username));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.workspace_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_directory() TO authenticated, service_role;

COMMENT ON FUNCTION public.workspace_directory IS
  'Member directory for the caller''s active workspace (Team Members page). Joins auth.users for email; email is returned only to admin/manager callers and for the caller''s own row.';
