-- =============================================================================
-- 0020_admin_grants_and_alignment.sql — Session 9 (Admin Terminal server core)
--
-- Four concerns, all Admin-Terminal-shaped:
--
--   1. Per-user rate-card grants (locked §10-A, REINSTATED per the brief):
--      workspace_members.grant_rate_card_view / grant_rate_card_edit let an
--      admin extend rate-card access beyond the role matrix. Enforced by the
--      rewritten rce_* policies via has_rate_card_grant(), which reads the
--      LIVE row (not the JWT) so a revoke takes effect immediately.
--
--   2. Deactivated-member read alignment (closes §6 gap #15): SELECT policies
--      gain has_active_membership() so table reads now match the workspace
--      channel's stricter gate (0018). Gating the spine parents — projects,
--      rate_cards — propagates to every leaf table whose policy EXISTS-joins
--      them under caller RLS (phases/assets/tasks/files/comments/
--      asset_versions/task_dependencies/task_links/ingestion_*).
--      project_members and the workspace arm of ws_members_select are
--      direct-workspace reads and get their own gate. The self arm of
--      ws_members_select stays open so a deactivated member can still see
--      their own row.
--
--   3. Last-admin protection: a workspace can never lose its last ACTIVE
--      admin — demote, deactivate, or delete all raise. No admin/service
--      bypass (the Edge Functions rely on this as defense in depth).
--      Operator tooling (Session 10) can opt out per-transaction via
--        SET LOCAL wilson.bypass_last_admin_guard = 'on'.
--
--   4. Roster polish (locked §10-B): projects gain producer_id / director_id
--      (cloud parity with the local-mode fields the RABBIT views already
--      render), and an auto-staff trigger seats the project creator and the
--      producer as project managers on create / producer change.
--
-- Plus a small workspaces write path for the terminal's Company section:
-- admins may update their workspace row, but slug/id/created_at/deleted_at
-- are guarded (slug feeds resolve-login; trash stays RPC-only).
--
-- pgTAP: 24_admin_grants.sql. 20_realtime.sql probe 20 flips (parity pin:
-- channel and table reads now BOTH deny inactive members); 23 probe 12's
-- message is updated to record that the S9 alignment landed.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ── 1. Per-user rate-card grant columns ──────────────────────────────────────

ALTER TABLE public.workspace_members
  ADD COLUMN IF NOT EXISTS grant_rate_card_view BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.workspace_members
  ADD COLUMN IF NOT EXISTS grant_rate_card_edit BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.workspace_members.grant_rate_card_view IS
  'Admin-granted rate-card visibility beyond the role matrix (Session 9). Read by has_rate_card_grant().';
COMMENT ON COLUMN public.workspace_members.grant_rate_card_edit IS
  'Admin-granted rate-card write access beyond the role matrix (Session 9). Implies view. Read by has_rate_card_grant().';

-- ── 2. Guard trigger: grants are admin-only edits ────────────────────────────
-- Full recreate of the 0010 function with two additions:
--   * self-updates may not touch the grant columns ('self-grant change not
--     allowed') — without this, ws_members_self_update would let any member
--     grant themselves rate-card access;
--   * the manager blocklist gains both grant columns (managers stay limited
--     to title + department).
-- The admin/service_role bypasses at the top are unchanged (admin grant
-- edits ride ws_members_admin_write).

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
    -- Rate-card grants are admin-conferred; holders cannot mint their own.
    IF NEW.grant_rate_card_view IS DISTINCT FROM OLD.grant_rate_card_view
       OR NEW.grant_rate_card_edit IS DISTINCT FROM OLD.grant_rate_card_edit THEN
      RAISE EXCEPTION 'self-grant change not allowed';
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
       OR NEW.created_at   IS DISTINCT FROM OLD.created_at
       OR NEW.grant_rate_card_view IS DISTINCT FROM OLD.grant_rate_card_view
       OR NEW.grant_rate_card_edit IS DISTINCT FROM OLD.grant_rate_card_edit THEN
      RAISE EXCEPTION 'managers may only edit title and department';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 3. has_rate_card_grant() — live-row grant check ──────────────────────────
-- SECURITY DEFINER for the same reason as has_active_membership (0008): it is
-- called from rate_card_entries policies and must read workspace_members
-- without recursing into its policies. Live-row semantics mean a revoked
-- grant (or a deactivation) cuts access immediately — no token TTL window.

CREATE OR REPLACE FUNCTION public.has_rate_card_grant(p_kind TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.user_id = auth.uid()
       AND wm.workspace_id = public.current_workspace_id()
       AND wm.is_active
       AND CASE p_kind
             WHEN 'view' THEN (wm.grant_rate_card_view OR wm.grant_rate_card_edit)
             WHEN 'edit' THEN wm.grant_rate_card_edit
             ELSE false
           END
  );
$$;

-- 0011's default privileges auto-grant EXECUTE to anon — re-lock (the
-- authenticated grant is required: policies evaluate as the querying role).
REVOKE EXECUTE ON FUNCTION public.has_rate_card_grant(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.has_rate_card_grant(TEXT) TO authenticated, service_role;

-- ── 4. rate_card_entries policies: role OR grant, always active ──────────────
-- Changes vs 0015:
--   * every policy (including SELECT) now requires has_active_membership —
--     closes the deactivated-admin-reads-wages-until-token-refresh gap;
--   * read arm:  admin/manager role OR view grant;
--   * write arm: admin role OR edit grant.

DROP POLICY IF EXISTS rce_select ON public.rate_card_entries;
CREATE POLICY rce_select ON public.rate_card_entries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.rate_cards rc
       WHERE rc.id = rate_card_entries.rate_card_id
         AND rc.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(rc.workspace_id)
    )
    AND (
      public.current_app_role() IN ('admin', 'manager')
      OR public.has_rate_card_grant('view')
    )
  );

DROP POLICY IF EXISTS rce_insert ON public.rate_card_entries;
CREATE POLICY rce_insert ON public.rate_card_entries
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.rate_cards rc
       WHERE rc.id = rate_card_id
         AND rc.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(rc.workspace_id)
    )
    AND (
      public.current_app_role() = 'admin'
      OR public.has_rate_card_grant('edit')
    )
  );

DROP POLICY IF EXISTS rce_update ON public.rate_card_entries;
CREATE POLICY rce_update ON public.rate_card_entries
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.rate_cards rc
       WHERE rc.id = rate_card_entries.rate_card_id
         AND rc.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(rc.workspace_id)
    )
    AND (
      public.current_app_role() = 'admin'
      OR public.has_rate_card_grant('edit')
    )
  );

DROP POLICY IF EXISTS rce_delete ON public.rate_card_entries;
CREATE POLICY rce_delete ON public.rate_card_entries
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.rate_cards rc
       WHERE rc.id = rate_card_entries.rate_card_id
         AND rc.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(rc.workspace_id)
    )
    AND (
      public.current_app_role() = 'admin'
      OR public.has_rate_card_grant('edit')
    )
  );

-- ── 5. Deactivated-member read alignment ─────────────────────────────────────
-- NOTE (0014 lesson): SELECT policies apply to BOTH sides of an UPDATE. All
-- of these gates check the CALLER's own membership, so an active member's
-- writes are unaffected; a deactivated member was already write-blocked by
-- has_active_membership on every write policy.

DROP POLICY IF EXISTS projects_select ON public.projects;
CREATE POLICY projects_select ON public.projects
  FOR SELECT USING (
    deleted_at IS NULL
    AND workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  );

DROP POLICY IF EXISTS rate_cards_select ON public.rate_cards;
CREATE POLICY rate_cards_select ON public.rate_cards
  FOR SELECT USING (
    deleted_at IS NULL
    AND workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  );

DROP POLICY IF EXISTS project_members_select ON public.project_members;
CREATE POLICY project_members_select ON public.project_members
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  );

-- Self arm stays open (own row remains visible after deactivation); the
-- workspace arm now requires an active membership. has_active_membership is
-- SECURITY DEFINER, so this cannot recurse (the 0008 lesson).
DROP POLICY IF EXISTS ws_members_select ON public.workspace_members;
CREATE POLICY ws_members_select ON public.workspace_members
  FOR SELECT USING (
    user_id = auth.uid()
    OR (
      workspace_id = public.current_workspace_id()
      AND public.has_active_membership(workspace_id)
    )
  );

-- Same alignment for the admin ROSTER-WRITE path: 0008's policy trusted the
-- JWT claim alone, so a deactivated admin could keep editing the roster for
-- up to the token TTL (the manager path was already live-row-checked by the
-- 0010 guard; the admin path had no live check anywhere).
DROP POLICY IF EXISTS ws_members_admin_write ON public.workspace_members;
CREATE POLICY ws_members_admin_write ON public.workspace_members
  FOR ALL
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_app_role() = 'admin'
    AND public.has_active_membership(workspace_id)
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_app_role() = 'admin'
    AND public.has_active_membership(workspace_id)
  );

-- ── 6. Last-admin protection ─────────────────────────────────────────────────
-- BEFORE UPDATE OR DELETE, SECURITY DEFINER (count must see the whole roster
-- regardless of caller), NO admin/service bypass — this is the backstop the
-- admin-set-active Edge Function leans on. Cascaded deletes from a workspace
-- hard-delete are exempt (the workspace row is already gone by the time the
-- child triggers fire). Operator tooling may opt out per-transaction:
--   SET LOCAL wilson.bypass_last_admin_guard = 'on'.

CREATE OR REPLACE FUNCTION public.fn_ws_members_last_admin_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_losing BOOLEAN := false;
  v_others INTEGER;
BEGIN
  IF current_setting('wilson.bypass_last_admin_guard', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Only guard rows that are currently an ACTIVE admin seat.
  IF OLD.app_role <> 'admin' OR NOT OLD.is_active THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_losing := true;
  ELSE
    v_losing := (NEW.app_role IS DISTINCT FROM 'admin')
             OR (NOT NEW.is_active)
             OR (NEW.workspace_id IS DISTINCT FROM OLD.workspace_id);
  END IF;

  IF NOT v_losing THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Workspace hard-delete cascade: the parent row is deleted before the
  -- member rows cascade, so a missing workspace means teardown — let it go.
  IF NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = OLD.workspace_id) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- FOR UPDATE serializes concurrent demotions: two admins demoting each
  -- other block on each other's row, and the loser re-reads a committed
  -- is_active=false / non-admin row and raises. Without the lock both
  -- counts could pass and the workspace ends up admin-less.
  SELECT count(*) INTO v_others
    FROM (
      SELECT 1
        FROM public.workspace_members wm
       WHERE wm.workspace_id = OLD.workspace_id
         AND wm.user_id <> OLD.user_id
         AND wm.app_role = 'admin'
         AND wm.is_active
         FOR UPDATE
    ) locked;

  IF v_others = 0 THEN
    RAISE EXCEPTION 'cannot demote or deactivate the last active admin';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_ws_members_last_admin_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ws_members_last_admin_guard ON public.workspace_members;
CREATE TRIGGER trg_ws_members_last_admin_guard
  BEFORE UPDATE OR DELETE ON public.workspace_members
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_ws_members_last_admin_guard();

-- ── 7. Producer / director columns + auto-staffing ───────────────────────────
-- Cloud parity for the local-mode fields ProjectSummaryView / IntakeWizardView
-- already render. Plain UUIDs, no FK — matches tasks.assignee_id (0013);
-- values are workspace_members.user_id in cloud mode.

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS producer_id UUID;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS director_id UUID;
CREATE INDEX IF NOT EXISTS projects_producer_idx ON public.projects (producer_id);
CREATE INDEX IF NOT EXISTS projects_director_idx ON public.projects (director_id);

-- Auto-staff (locked §10-B): the creator and the producer are seated as
-- project managers on INSERT; a later producer change seats the new producer
-- too (existing seats are never removed or demoted — ON CONFLICT DO NOTHING).
-- SECURITY DEFINER: the seat insert must not depend on the caller's
-- project_members write policy. Non-members are skipped silently (the seat
-- FK requires a live workspace membership). workspace_id is omitted so
-- 0013's derive trigger stays the single source of truth.

CREATE OR REPLACE FUNCTION public.fn_projects_auto_staff()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID;
BEGIN
  -- Runner/service inserts (pgTAP fixtures, migrations, scripts) carry no
  -- auth context and must NOT staff: 0013's unstaffed-open contract keeps
  -- fixture/imported projects writable by every active member until someone
  -- deliberately staffs them. Real client creates always have auth.uid(),
  -- so §10-B auto-staffing applies exactly where the decision aimed.
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;
  FOREACH v_user IN ARRAY
    CASE WHEN TG_OP = 'INSERT'
         THEN ARRAY[NEW.created_by, NEW.producer_id]
         ELSE ARRAY[NEW.producer_id]
    END
  LOOP
    CONTINUE WHEN v_user IS NULL;
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM public.workspace_members wm
       WHERE wm.workspace_id = NEW.workspace_id
         AND wm.user_id = v_user
         AND wm.is_active
    );
    INSERT INTO public.project_members (project_id, user_id, project_role, created_by)
    VALUES (NEW.id, v_user, 'manager', NEW.created_by)
    ON CONFLICT (project_id, user_id) DO NOTHING;
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Staffing is a convenience; it must never abort the project write.
  RAISE WARNING 'auto-staff failed for project % (%): %', NEW.id, TG_OP, SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_projects_auto_staff() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_projects_auto_staff ON public.projects;
CREATE TRIGGER trg_projects_auto_staff
  AFTER INSERT OR UPDATE OF producer_id ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_projects_auto_staff();

-- ── 8. Workspaces: admin write path for the Company section ──────────────────

DROP POLICY IF EXISTS workspaces_admin_update ON public.workspaces;
CREATE POLICY workspaces_admin_update ON public.workspaces
  FOR UPDATE USING (
    id = public.current_workspace_id()
    AND public.current_app_role() = 'admin'
    AND public.has_active_membership(id)
  )
  WITH CHECK (
    id = public.current_workspace_id()
    AND public.current_app_role() = 'admin'
    AND public.has_active_membership(id)
  );

-- slug feeds resolve-login and invite emails; trash stays RPC-only.
CREATE OR REPLACE FUNCTION public.fn_workspaces_client_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'workspace slug is immutable';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'workspace column is not client-editable';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_workspaces_client_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_workspaces_client_guard ON public.workspaces;
CREATE TRIGGER trg_workspaces_client_guard
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_workspaces_client_guard();

-- ── 9. Post-conditions ───────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'workspace_members'
       AND column_name = 'grant_rate_card_edit'
  ) THEN
    RAISE EXCEPTION '0020 post-condition failed: grant columns missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_ws_members_last_admin_guard'
  ) THEN
    RAISE EXCEPTION '0020 post-condition failed: last-admin guard trigger missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_projects_auto_staff'
  ) THEN
    RAISE EXCEPTION '0020 post-condition failed: auto-staff trigger missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'rate_card_entries'
       AND policyname = 'rce_select'
  ) THEN
    RAISE EXCEPTION '0020 post-condition failed: rce_select missing';
  END IF;
END $$;

COMMENT ON FUNCTION public.has_rate_card_grant(TEXT) IS
  'Session 9: live-row per-user rate-card grant check (view = view OR edit; edit = edit). SECURITY DEFINER so rce_* policies can call it without recursing into workspace_members policies.';
COMMENT ON FUNCTION public.fn_ws_members_last_admin_guard() IS
  'Session 9: a workspace can never lose its last active admin (demote/deactivate/delete). Bypass for operator tooling: SET LOCAL wilson.bypass_last_admin_guard = ''on''.';
COMMENT ON FUNCTION public.fn_projects_auto_staff() IS
  'Session 9 (locked §10-B): seats project creator + producer as project managers on create/producer change. Best-effort — never aborts the project write.';
