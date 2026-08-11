-- =============================================================================
-- 0059_member_full_time.sql  (Session 43)
--
-- workspace_members.is_full_time — is this person salaried staff, or hired?
--
-- Audrey, 2026-08-11: "for the team members we need to add an additional
-- property. it needs to be a boolean type. it should be a check box to note if
-- a team member is a fulltime company team member. the internal fulltime
-- members are the only ones that should populate the internal rate card. for
-- context, for some projects a company may hire freelancers, for them the
-- external rate card uses industry standard rates. the internal rate card is
-- based on the salaries of the internal team members."
--
-- So the two rate cards are two different KINDS of number, and this flag is
-- what routes a person to the right one:
--   general  — industry-standard day rates, for anyone hired in
--   internal  — wage + burden + overhead, derived from a salary
--
-- THREE THINGS MOVE TOGETHER HERE, and shipping any one alone is a defect:
--
--   1. the column
--   2. `workspace_directory()`, which has an EXPLICIT `RETURNS TABLE (...)`
--      list. The roster reads through that RPC, so a column the function does
--      not name is INVISIBLE to every client no matter how correct the table
--      is. Changing a RETURNS TABLE requires DROP + CREATE — `CREATE OR
--      REPLACE` raises 42P13 ("cannot change return type of existing
--      function").
--   3. the self-edit guard. `fn_ws_members_prevent_self_role_change` is a
--      DENYLIST: anything it does not name is editable. Left alone, a member
--      could set their OWN is_full_time and move themselves onto the salary
--      rate card, and a manager could do it to anyone. This is an employment
--      fact, so it is ADMIN-ONLY — the same tier that already owns app_role.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ── 1. the column ────────────────────────────────────────────────────────────
-- DEFAULT false, not true: every existing row predates the distinction, and
-- defaulting to "salaried" would silently pull every freelancer onto the
-- internal card — the exact confusion this flag exists to remove. Admins opt
-- people IN.
ALTER TABLE public.workspace_members
  ADD COLUMN IF NOT EXISTS is_full_time BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.workspace_members.is_full_time IS
  'Session 43: true = salaried company staff, who populate the INTERNAL rate card (wage/burden/overhead from a salary). false = hired in for a project, priced from the GENERAL card at industry-standard day rates. Admin-only: enforced by fn_ws_members_prevent_self_role_change, because a member who could set this would choose which cost model they are billed under. Exposed to clients through workspace_directory().';

-- ── 2. the self-edit guard ───────────────────────────────────────────────────
-- Reproduces 0010's function verbatim and adds is_full_time to BOTH denylists.
-- Admin and service_role still bypass at the top, unchanged.
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
    -- Session 43: employment status is not self-service. Without this a
    -- member could move themselves onto the salary-derived rate card.
    IF NEW.is_full_time IS DISTINCT FROM OLD.is_full_time THEN
      RAISE EXCEPTION 'self full-time change not allowed';
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
       OR NEW.is_full_time IS DISTINCT FROM OLD.is_full_time
       OR NEW.created_at   IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'managers may only edit title and department';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- The trigger already points at this name; recreate so a fresh database that
-- applies this migration alone is still wired.
DROP TRIGGER IF EXISTS trg_ws_members_self_guard ON public.workspace_members;
CREATE TRIGGER trg_ws_members_self_guard
  BEFORE UPDATE ON public.workspace_members
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_ws_members_prevent_self_role_change();

-- ── 3. workspace_directory() ────────────────────────────────────────────────
-- 🚨 DROP first. The return type gains a column, and CREATE OR REPLACE cannot
-- change a function's return type (42P13). Both statements run in this
-- migration's transaction, so no client ever observes the function missing.
DROP FUNCTION IF EXISTS public.workspace_directory();

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
  is_full_time BOOLEAN,
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
         wm.is_full_time,
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

-- 0033 swept anon privileges; keep this function's grants as they were.
REVOKE ALL ON FUNCTION public.workspace_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_directory() TO authenticated;

COMMENT ON FUNCTION public.workspace_directory IS
  'Roster read for the signed-in workspace. SECURITY DEFINER for the auth.users email join; email is nulled for non-admin/manager callers viewing someone else. Session 43 added is_full_time — the RETURNS TABLE list is explicit, so any new workspace_members column must be added HERE too or it is invisible to every client.';
