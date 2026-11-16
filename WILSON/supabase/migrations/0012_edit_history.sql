-- =============================================================================
-- 0012_edit_history.sql
-- Session 5 — RABBIT edit history (no revert). Three DB-level pieces:
--
--   1. public.edit_history — append-only who/what/when for every mutation of
--      the 13 RABBIT tables. Populated exclusively by trigger; clients can
--      only read it (admin/manager, own workspace). Revert-to-state is
--      deliberately OUT — it arrives with Realtime in Session 7.
--
--   2. fn_edit_history_capture() — one generic AFTER INSERT/UPDATE/DELETE
--      trigger function attached to all 13 tables. AFTER (not BEFORE) so it
--      sees NEW as finally written, i.e. after fn_audit_touch and the
--      workspace-population triggers have stamped their columns. Capture
--      failures NEVER abort the user's write (WARNING + continue): this is
--      user-facing history, not the TPN security audit log (Session 9/10).
--
--   3. purge_edit_history() — the 90-day retention sweep (locked decision).
--      service_role-only. Scheduled via pg_cron where the extension exists
--      (hosted envs); the CI local stack has no pg_cron, so scheduling is
--      wrapped in a guard that can never fail the migration and pgTAP calls
--      the function directly.
--
-- RLS is ENABLE but NOT FORCE — a deliberate deviation from the 0004
-- convention. The capture function is SECURITY DEFINER and runs as the table
-- owner (postgres); FORCE would subject those inserts to policies and there
-- is intentionally no INSERT policy. Client roles stay locked out anyway:
-- no write policies match them, and the write grants that 0011's default
-- privileges would hand out are revoked below. Grants are not the security
-- boundary — but for an append-only audit table, belt and braces.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ── 1. table + indexes ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.edit_history (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- entity_type is the RABBIT table name. The CHECK documents the locked
  -- "RABBIT-only" scope: workspace_members et al. are Session 9 territory.
  entity_type   TEXT NOT NULL CHECK (entity_type IN (
                  'projects','phases','assets','tasks','files',
                  'comments','rate_cards','rate_card_entries',
                  'asset_versions','task_dependencies','task_links',
                  'ingestion_runs','ingestion_chunks')),
  entity_id     UUID NOT NULL,
  -- No FK on actor (matches the created_by/updated_by convention since 0007):
  -- NULL for service_role/migration writes, and rows must survive the actor's
  -- auth.users row disappearing.
  actor_user_id UUID,
  -- Display name captured at write time so history stays readable after a
  -- member leaves the workspace (the directory RPC can't resolve them then).
  actor_label   TEXT,
  action        TEXT NOT NULL CHECK (action IN ('create','update','delete')),
  -- create → {"new": {...}} · delete → {"old": {...}} · update → per-field
  -- {"col": {"old": ..., "new": ...}} with noise columns excluded.
  diff          JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Drawer query: newest-first history for one entity.
CREATE INDEX IF NOT EXISTS idx_edit_history_entity
  ON public.edit_history (workspace_id, entity_type, entity_id, created_at DESC);

-- Retention sweep scan.
CREATE INDEX IF NOT EXISTS idx_edit_history_created_at
  ON public.edit_history (created_at);

-- ── 2. RLS + grants ──────────────────────────────────────────────────────────

ALTER TABLE public.edit_history ENABLE ROW LEVEL SECURITY;
-- NOT forced — see header. Do not add FORCE without giving the capture path
-- an INSERT policy first.

DROP POLICY IF EXISTS edit_history_select ON public.edit_history;
CREATE POLICY edit_history_select ON public.edit_history
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.current_app_role() IN ('admin', 'manager')
    AND public.has_active_membership(workspace_id)
  );
-- No INSERT/UPDATE/DELETE policies: with RLS enabled and no matching policy,
-- every client write is denied regardless of grants.

-- 0011's ALTER DEFAULT PRIVILEGES granted ALL on this table the moment it was
-- created. Claw back everything but SELECT from the client roles.
REVOKE ALL ON public.edit_history FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.edit_history FROM authenticated;
GRANT SELECT ON public.edit_history TO authenticated;

-- The identity sequence got default-granted too; clients never insert.
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM anon, authenticated',
                 pg_get_serial_sequence('public.edit_history', 'id'));
END $$;

-- ── 3. capture trigger ───────────────────────────────────────────────────────
-- One generic function for all 13 tables. SECURITY DEFINER so the INSERT into
-- edit_history (and the parent-join workspace lookups below) run as the table
-- owner rather than the calling client role.
--
-- workspace_id resolution, in order:
--   a. the row's own workspace_id column (projects, rate_cards, assets,
--      tasks, files, comments);
--   b. parent join for the seven child tables (same joins as their 0004
--      parent-join RLS policies);
--   c. current_workspace_id() — covers cascade deletes, where the parent row
--      is already gone by the time the child's AFTER DELETE trigger fires;
--   d. still NULL (e.g. service_role cascade with no JWT): skip the history
--      row rather than fail or mis-file it. Documented gap: service_role
--      writes to the seven child tables go unlogged only when the parent
--      row is already gone AND no JWT claim is present — with a live parent,
--      step (b) resolves the workspace and the write IS captured.
CREATE OR REPLACE FUNCTION public.fn_edit_history_capture()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     JSONB;
  v_ws      UUID;
  v_actor   UUID;
  v_label   TEXT;
  v_action  TEXT;
  v_diff    JSONB;
  -- Stamped by fn_audit_touch / the touch triggers on every write; excluding
  -- them keeps touch-only UPDATEs out of the history entirely.
  c_noise   CONSTANT TEXT[] :=
    ARRAY['updated_at', 'updated_by', 'last_updated_at', 'last_updated_by'];
BEGIN
  -- NEW is NULL in DELETE row triggers; OLD is NULL in INSERT row triggers.
  IF TG_OP = 'DELETE' THEN
    v_row := to_jsonb(OLD);
  ELSE
    v_row := to_jsonb(NEW);
  END IF;

  -- (a) row's own column
  IF v_row ? 'workspace_id' THEN
    v_ws := (v_row ->> 'workspace_id')::uuid;
  END IF;

  -- (b) parent join
  IF v_ws IS NULL THEN
    CASE TG_TABLE_NAME
      WHEN 'phases' THEN
        SELECT p.workspace_id INTO v_ws FROM public.projects p
         WHERE p.id = (v_row ->> 'project_id')::uuid;
      WHEN 'ingestion_runs' THEN
        SELECT p.workspace_id INTO v_ws FROM public.projects p
         WHERE p.id = (v_row ->> 'project_id')::uuid;
      WHEN 'asset_versions' THEN
        SELECT a.workspace_id INTO v_ws FROM public.assets a
         WHERE a.id = (v_row ->> 'asset_id')::uuid;
      WHEN 'task_dependencies' THEN
        SELECT t.workspace_id INTO v_ws FROM public.tasks t
         WHERE t.id = (v_row ->> 'predecessor_id')::uuid;
      WHEN 'task_links' THEN
        SELECT t.workspace_id INTO v_ws FROM public.tasks t
         WHERE t.id = (v_row ->> 'task_id')::uuid;
      WHEN 'rate_card_entries' THEN
        SELECT rc.workspace_id INTO v_ws FROM public.rate_cards rc
         WHERE rc.id = (v_row ->> 'rate_card_id')::uuid;
      WHEN 'ingestion_chunks' THEN
        SELECT p.workspace_id INTO v_ws
          FROM public.ingestion_runs ir
          JOIN public.projects p ON p.id = ir.project_id
         WHERE ir.id = (v_row ->> 'run_id')::uuid;
      ELSE
        v_ws := NULL;
    END CASE;
  END IF;

  -- (c) caller's claim
  IF v_ws IS NULL THEN
    v_ws := public.current_workspace_id();
  END IF;

  -- (d) unresolvable — skip, never block the write
  IF v_ws IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'create';
    v_diff   := jsonb_build_object('new', jsonb_strip_nulls(to_jsonb(NEW)));
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
    v_diff   := jsonb_build_object('old', jsonb_strip_nulls(to_jsonb(OLD)));
  ELSE
    v_action := 'update';
    SELECT jsonb_object_agg(
             o.key, jsonb_build_object('old', o.value, 'new', n.value))
      INTO v_diff
      FROM jsonb_each(to_jsonb(OLD)) o
      JOIN jsonb_each(to_jsonb(NEW)) n ON n.key = o.key
     WHERE o.value IS DISTINCT FROM n.value
       AND NOT (o.key = ANY (c_noise));
    -- Touch-only update: nothing a human changed, nothing to show.
    IF v_diff IS NULL OR v_diff = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
  END IF;

  v_actor := auth.uid();
  IF v_actor IS NOT NULL THEN
    SELECT COALESCE(wm.display_name, wm.username) INTO v_label
      FROM public.workspace_members wm
     WHERE wm.workspace_id = v_ws
       AND wm.user_id = v_actor;
  END IF;

  INSERT INTO public.edit_history
    (workspace_id, entity_type, entity_id, actor_user_id, actor_label,
     action, diff)
  VALUES
    (v_ws, TG_TABLE_NAME, (v_row ->> 'id')::uuid, v_actor, v_label,
     v_action, v_diff);

  RETURN NULL;  -- AFTER trigger: return value is ignored
EXCEPTION WHEN OTHERS THEN
  -- History must never break the tool. Purge/retention keeps the table
  -- bounded, and a missed row is preferable to a failed save.
  RAISE WARNING 'edit_history capture failed for %.% (%): %',
    TG_TABLE_NAME, v_row ->> 'id', TG_OP, SQLERRM;
  RETURN NULL;
END;
$$;

-- Trigger functions can't be invoked directly, but 0011's default privileges
-- still hand out EXECUTE — revoke per the 0011 pattern.
REVOKE EXECUTE ON FUNCTION public.fn_edit_history_capture() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects','phases','assets','tasks','files',
                           'comments','rate_cards','rate_card_entries',
                           'asset_versions','task_dependencies','task_links',
                           'ingestion_runs','ingestion_chunks']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_edit_history ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_edit_history
         AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.fn_edit_history_capture()',
      t, t);
  END LOOP;
END $$;

-- ── 4. retention sweep (90 days — locked decision) ───────────────────────────

CREATE OR REPLACE FUNCTION public.purge_edit_history(
  p_retention INTERVAL DEFAULT INTERVAL '90 days'
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted BIGINT;
BEGIN
  DELETE FROM public.edit_history
   WHERE created_at < now() - p_retention;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_edit_history(INTERVAL)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_edit_history(INTERVAL) TO service_role;

-- Schedule nightly where pg_cron exists (hosted envs). The CI local stack
-- ships without pg_cron, and a scheduling hiccup must never fail the
-- migration — hence available-check + exception guard. cron.schedule()
-- upserts by job name, so re-running stays idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule(
      'wilson-purge-edit-history',
      '43 4 * * *',
      $job$ SELECT public.purge_edit_history(); $job$
    );
  ELSE
    RAISE NOTICE 'pg_cron unavailable — edit_history purge not scheduled (expected in CI local stack)';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'could not schedule edit_history purge via pg_cron: %', SQLERRM;
END $$;

COMMENT ON TABLE public.edit_history IS
  'Append-only RABBIT edit history (Session 5). Written only by fn_edit_history_capture triggers; read by admin/manager within their workspace; purged after 90 days by purge_edit_history().';
