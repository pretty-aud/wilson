-- =============================================================================
-- 0029_operator_write_lockdown.sql — Session 15 (adversarial review fixes)
--
-- Two defects found AFTER 0028 landed, both by the pre-commit review and one
-- of them independently by the TPN re-audit (TPN-CLOUD-003). Neither is
-- caused by 0028 — both are older — but 0028 is what made the first one
-- matter, so it is fixed in the same session.
--
--   1. A PLATFORM OPERATOR COULD DESTROY ANY TENANT WITH ONE PostgREST CALL,
--      bypassing every safeguard Session 15 built.
--
--      `workspaces_write_operator` (0002) is `FOR ALL`, and in Postgres that
--      covers DELETE. 0011 grants ALL on every public table to `authenticated`
--      and nothing ever revoked it for `workspaces`. 0020's client guard is
--      BEFORE **UPDATE** only. So an operator's ordinary /wilson browser
--      session — aal1, no TOTP step-up — could run
--
--          supabase.from('workspaces').delete().eq('id', <any tenant>)
--
--      and the CASCADE would take that tenant's projects, files, app_events
--      and file_events with it. Everything the operator console exists to
--      enforce is skipped: operatorGuard's hard MFA, the typed-slug confirm,
--      the blob sweep, and the platform_audit certificate. Nothing would
--      record that a company had been destroyed, or by whom. Because
--      `storage-gc` is workspace-scoped and that workspace is now gone, the
--      orphaned blobs would also be undrainable — gap #34 reopened by the
--      back door.
--
--      The fix is the same shape 0028 already applies three times to its own
--      tables and did not apply here: revoke the write privileges, and
--      replace the FOR ALL policy with the verbs the console actually needs.
--      Reads stay wide (the console lists every workspace); writes go through
--      service_role Edge Functions, which bypass RLS anyway, so nothing the
--      product does is lost.
--
--   2. CLOUD PROJECT CREATION WAS BROKEN FOR EVERY REAL TENANT.
--
--      `RabbitProvider.createProject` stamps `workspace_id: DEFAULT_WORKSPACE_ID`
--      ('00000000-…-0001', a pre-multi-tenant seed constant) on every draft,
--      and `supabaseAdapter.createProject`'s sanitize list did not strip it.
--      `projects_insert` requires `workspace_id = current_workspace_id()`, so
--      the insert was refused 42501 for every workspace except the seed one.
--      Verified against wilson-dev: the seed value is REFUSED and the
--      caller's real workspace SUCCEEDS, same session, same statement.
--
--      The client fix (drop the column in the adapter) is the real one. This
--      trigger is the belt-and-braces half: `projects.workspace_id` is NOT
--      NULL with no default (0004 dropped it deliberately), so an adapter
--      that simply omits the column would 23502 instead. Every SIBLING table
--      already has exactly this trigger — assets, tasks, files and comments
--      get `fn_populate_workspace_from_project` in 0004:155-175. `projects`
--      was the one table that had nowhere to inherit from and so was skipped.
--      Deriving it from `current_workspace_id()` is not a "default" in the
--      sense 0004 rejected: the WITH CHECK still proves membership, so a
--      caller cannot land a row in a workspace they do not belong to.
--
-- Idempotent: safe to re-run.
-- ORDERING RULE: a manual re-run of 0002 recreates `workspaces_write_operator`
-- at its FOR ALL definition and re-opens defect 1. If you ever re-run 0002 by
-- hand, re-run THIS file after it. (The migration runner's by-version ordering
-- makes every normal path safe.)
-- pgTAP: 37_workspace_write_lockdown.sql (new).
-- =============================================================================

-- ── 1. Lock down client writes to public.workspaces ──────────────────────────

-- Replace the FOR ALL operator policy with read + update only. Permissive
-- policies OR together, so the old one must be DROPPED — adding narrower
-- policies alongside it would change nothing at all.
DROP POLICY IF EXISTS workspaces_write_operator ON public.workspaces;

DROP POLICY IF EXISTS workspaces_operator_read ON public.workspaces;
CREATE POLICY workspaces_operator_read ON public.workspaces
  FOR SELECT
  USING (public.is_platform_operator());

-- UPDATE stays reachable: the company Admin Terminal's rename rides
-- `workspaces_admin_update` (0020) and an operator may legitimately rename a
-- company from the console's optimistic path. `fn_workspaces_client_guard`
-- (0020) still pins slug/id/created_at/deleted_at against client edits, so
-- suspend/restore remains service_role-only.
DROP POLICY IF EXISTS workspaces_operator_update ON public.workspaces;
CREATE POLICY workspaces_operator_update ON public.workspaces
  FOR UPDATE
  USING (public.is_platform_operator())
  WITH CHECK (public.is_platform_operator());

-- No INSERT or DELETE policy, deliberately. Creation goes through
-- provision_workspace_and_admin() and destruction through the
-- operator-workspaces teardown path — both service_role, both bypassing RLS.
-- Removing the client-reachable verbs costs the product nothing.
REVOKE INSERT, DELETE, TRUNCATE ON public.workspaces FROM anon, authenticated;

-- Belt to the policy's braces. A DELETE that somehow reaches the table (a
-- future GRANT, a policy re-added by a manual 0002 re-run) still stops here,
-- and stops with a message that says where to go instead.
CREATE OR REPLACE FUNCTION public.fn_workspaces_delete_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Refuse CLIENT roles specifically, rather than exempting service_role.
  -- The sibling guards in 0020 exempt service_role and apply their rules to
  -- everything else, which is right for them because they run inside normal
  -- statements. This one must also let the pgTAP runner and any migration or
  -- maintenance script through: those execute as `postgres`, and a suite that
  -- deletes a workspace to prove CASCADE behaviour is legitimate. The threat
  -- is a browser session holding an anon-key JWT, so name that.
  IF current_setting('role', true) IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'workspaces cannot be deleted by a client session — tenant teardown runs through the operator-workspaces Edge Function, which sweeps storage and writes a platform_audit certificate first';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_workspaces_delete_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_workspaces_delete_guard ON public.workspaces;
CREATE TRIGGER trg_workspaces_delete_guard
  BEFORE DELETE ON public.workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_workspaces_delete_guard();

COMMENT ON FUNCTION public.fn_workspaces_delete_guard() IS
  'Session 15 (review fix): tenant destruction must go through operator-workspaces, which requires MFA, a typed confirmation, a storage sweep and a platform_audit certificate. A direct client DELETE would skip all four and strand the blobs (gap #34).';

-- ── 2. projects.workspace_id — derive it, like every sibling table ───────────

CREATE OR REPLACE FUNCTION public.fn_projects_populate_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.workspace_id IS NULL THEN
    NEW.workspace_id := public.current_workspace_id();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_projects_populate_workspace() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_projects_populate_workspace ON public.projects;
CREATE TRIGGER trg_projects_populate_workspace
  BEFORE INSERT ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_projects_populate_workspace();

COMMENT ON FUNCTION public.fn_projects_populate_workspace() IS
  'Session 15 (review fix): fills projects.workspace_id from current_workspace_id() when the client omits it — the same courtesy assets/tasks/files/comments have had since 0004. projects_insert still proves membership, so this cannot place a row in a foreign workspace.';

-- ── 3. Post-conditions ───────────────────────────────────────────────────────

DO $$
DECLARE
  n INT;
BEGIN
  -- The FOR ALL policy must be gone, and no client INSERT/DELETE arm may exist.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'workspaces'
       AND policyname = 'workspaces_write_operator'
  ) THEN
    RAISE EXCEPTION '0029 post-condition failed: workspaces_write_operator (FOR ALL) still exists — an operator could delete a tenant directly';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'workspaces'
       AND cmd IN ('INSERT', 'DELETE')
  ) THEN
    RAISE EXCEPTION '0029 post-condition failed: workspaces must have no client INSERT/DELETE policy';
  END IF;

  -- Privileges revoked as well as policies narrowed.
  IF has_table_privilege('authenticated', 'public.workspaces', 'DELETE')
     OR has_table_privilege('anon', 'public.workspaces', 'DELETE') THEN
    RAISE EXCEPTION '0029 post-condition failed: DELETE on workspaces is still granted to a client role';
  END IF;
  IF has_table_privilege('authenticated', 'public.workspaces', 'INSERT') THEN
    RAISE EXCEPTION '0029 post-condition failed: INSERT on workspaces is still granted to authenticated';
  END IF;

  -- The operator must keep BOTH read and update, or the console breaks.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'workspaces'
     AND policyname IN ('workspaces_operator_read', 'workspaces_operator_update');
  IF n <> 2 THEN
    RAISE EXCEPTION '0029 post-condition failed: expected the operator read+update policies, found %', n;
  END IF;

  -- Triggers present.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_workspaces_delete_guard'
       AND tgrelid = 'public.workspaces'::regclass
  ) THEN
    RAISE EXCEPTION '0029 post-condition failed: trg_workspaces_delete_guard missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_projects_populate_workspace'
       AND tgrelid = 'public.projects'::regclass
  ) THEN
    RAISE EXCEPTION '0029 post-condition failed: trg_projects_populate_workspace missing';
  END IF;
END $$;
