-- =============================================================================
-- 0014_soft_delete.sql  (Session 6)
--
-- Soft-delete + undo for the 7 user-facing RABBIT tables:
--   projects, phases, assets, tasks, files, comments, rate_cards
--
-- The 6 leaf/link tables (asset_versions, task_dependencies, task_links,
-- rate_card_entries, ingestion_runs, ingestion_chunks) stay hard-delete:
-- their UNIQUE constraints — (asset_id, version_no), (predecessor_id,
-- successor_id) — would collide with recreated rows, and per-row trash for
-- link rows is noise. In-session undo for them is the provider's inverse-op
-- history stack.
--
--   1. fn_soft_delete_stamp: BEFORE UPDATE trigger on the 7 tables. Stamps
--      deleted_by := auth.uid() on the null→set transition, clears it on
--      restore, and gates the projects transition to app admins
--      ('project.delete' matrix parity).
--   1b. soft_delete_row() + restore_soft_deleted() SECURITY DEFINER RPCs —
--      the ONLY client paths in and out of the trash. Postgres applies
--      SELECT policies to BOTH sides of an UPDATE that reads the table:
--      the old row must be visible (so a hidden row can't be targeted for
--      restore — the UPDATE silently matches 0 rows) and the NEW row must
--      remain visible (so setting deleted_at fails with an RLS violation,
--      verified live on wilson-dev). Both RPCs re-check workspace +
--      membership + the project gate via fn_trash_authz(), then update as
--      definer; the stamp trigger (and its projects admin guard) still
--      fires inside them.
--   2. SELECT policies: own-row `deleted_at IS NULL` plus a live-parent
--      EXISTS. The EXISTS subqueries run under the caller's RLS, so hiding
--      a parent transitively hides the whole subtree with NO propagation
--      writes — soft delete touches exactly one row, restore clears exactly
--      one row and the subtree reappears. (phases already inherited this
--      from projects_select; this migration makes every spine consistent.)
--      Leaf-table policies need no text change: their parent EXISTS picks
--      up the parents' new filters automatically.
--   3. Partial indexes matching the new `deleted_at IS NULL` predicates.
--   4. purge_soft_deleted(): 30-day retention hard-delete sweep
--      (service_role only), nightly via pg_cron where available.
--
-- Known gap (documented in db/README.md): storage blobs for soft-deleted
-- `files` rows are no longer removed at delete time (the row must stay
-- restorable) and the purge cannot reach the storage API — blob GC is
-- deferred to the hardening sessions.
--
-- Edit history: the deleted_at/deleted_by transition is captured by 0012's
-- trigger as an ordinary 'update' diff — the drawer labels it Deleted /
-- Restored client-side (editHistoryFormat.js).
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ── 1. stamp + guard trigger ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_soft_delete_stamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    -- soft delete
    IF TG_TABLE_NAME = 'projects'
       AND auth.uid() IS NOT NULL
       AND COALESCE(public.current_app_role(), '') <> 'admin' THEN
      RAISE EXCEPTION 'only workspace admins can delete or restore projects';
    END IF;
    NEW.deleted_by := COALESCE(NEW.deleted_by, auth.uid());
  ELSIF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN
    -- restore
    IF TG_TABLE_NAME = 'projects'
       AND auth.uid() IS NOT NULL
       AND COALESCE(public.current_app_role(), '') <> 'admin' THEN
      RAISE EXCEPTION 'only workspace admins can delete or restore projects';
    END IF;
    NEW.deleted_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_soft_delete_stamp() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects','phases','assets','tasks','files',
                           'comments','rate_cards']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_soft_delete ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_soft_delete
         BEFORE UPDATE ON public.%I
         FOR EACH ROW
         WHEN (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
         EXECUTE FUNCTION public.fn_soft_delete_stamp()',
      t, t);
  END LOOP;
END $$;

-- ── 1b. trash RPCs — the only client paths in and out of soft-deleted ────────
-- SELECT policies apply to BOTH sides of an UPDATE that reads the table:
--   * restore: the hidden old row can't be targeted — the UPDATE silently
--     matches 0 rows;
--   * soft delete: the NEW row (deleted_at set) is no longer visible —
--     the UPDATE fails with 'new row violates row-level security policy'
--     (observed live on wilson-dev, Postgres 17).
-- Both directions therefore go through SECURITY DEFINER functions that
-- enforce the same authorization the write policies would (workspace
-- match + active membership + project gate; comments use the comment
-- gate so reviewers keep comment parity). fn_soft_delete_stamp still
-- fires inside them — auth.uid()/current_app_role() read the JWT GUC
-- regardless of definer — so the projects admin-only guard holds and
-- deleted_by stamps/clears.

CREATE OR REPLACE FUNCTION public.fn_trash_authz(p_table TEXT, p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws      UUID;
  v_project UUID;
  v_allowed BOOLEAN;
BEGIN
  IF p_table NOT IN ('projects','phases','assets','tasks','files',
                     'comments','rate_cards') THEN
    RAISE EXCEPTION 'not a soft-delete table: %', p_table;
  END IF;

  -- Resolve the row's workspace and (where applicable) project for the
  -- authorization check. rate_cards are workspace-level → no project gate.
  EXECUTE format(
    'SELECT %s, %s FROM public.%I WHERE id = $1',
    CASE WHEN p_table = 'phases'
         THEN '(SELECT p.workspace_id FROM public.projects p WHERE p.id = project_id)'
         ELSE 'workspace_id' END,
    CASE p_table
      WHEN 'projects'   THEN 'id'
      WHEN 'rate_cards' THEN 'NULL::uuid'
      WHEN 'comments'   THEN 'public.fn_comment_project_id(entity_type, entity_id)'
      ELSE 'project_id' END,
    p_table)
    INTO v_ws, v_project
    USING p_id;

  v_allowed := CASE
    WHEN p_table = 'comments' THEN public.can_comment_project(v_project)
    WHEN v_project IS NULL    THEN true  -- rate_cards / dead-end walks
    ELSE public.can_write_project(v_project)
  END;

  IF v_ws IS NULL
     OR v_ws IS DISTINCT FROM public.current_workspace_id()
     OR NOT public.has_active_membership(v_ws)
     OR NOT COALESCE(v_allowed, false) THEN
    RAISE EXCEPTION 'not allowed to soft-delete or restore this row';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_trash_authz(TEXT, UUID)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.soft_delete_row(p_table TEXT, p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows BIGINT;
BEGIN
  PERFORM public.fn_trash_authz(p_table, p_id);
  EXECUTE format(
    'UPDATE public.%I SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL',
    p_table)
    USING p_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_soft_deleted(p_table TEXT, p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows BIGINT;
BEGIN
  PERFORM public.fn_trash_authz(p_table, p_id);
  EXECUTE format(
    'UPDATE public.%I SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL',
    p_table)
    USING p_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.soft_delete_row(TEXT, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_row(TEXT, UUID)
  TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.restore_soft_deleted(TEXT, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_soft_deleted(TEXT, UUID)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.soft_delete_row IS
  'Soft-deletes a row (sets deleted_at; trigger stamps deleted_by) after re-checking workspace, membership and project gating. The only client path — a plain UPDATE would fail the SELECT policies on the NEW row (Session 6).';
COMMENT ON FUNCTION public.restore_soft_deleted IS
  'Restores a soft-deleted row (clears deleted_at) after re-checking workspace, membership and project gating. The only client restore path — plain UPDATEs cannot see soft-deleted rows (Session 6).';

-- ── 2. SELECT policies — hide soft-deleted rows and dead subtrees ────────────
-- projects_select already filters deleted_at (0004) and stays as-is.

DROP POLICY IF EXISTS assets_select ON public.assets;
CREATE POLICY assets_select ON public.assets
  FOR SELECT USING (
    deleted_at IS NULL
    AND workspace_id = public.current_workspace_id()
    -- live-parent check: runs under the caller's RLS, so a soft-deleted
    -- project (hidden by projects_select) hides its assets too.
    AND EXISTS (
      SELECT 1 FROM public.projects p WHERE p.id = assets.project_id
    )
  );

DROP POLICY IF EXISTS tasks_select ON public.tasks;
CREATE POLICY tasks_select ON public.tasks
  FOR SELECT USING (
    deleted_at IS NULL
    AND workspace_id = public.current_workspace_id()
    -- asset hop suffices: assets_select itself requires a live project.
    AND EXISTS (
      SELECT 1 FROM public.assets a WHERE a.id = tasks.asset_id
    )
  );

DROP POLICY IF EXISTS files_select ON public.files;
CREATE POLICY files_select ON public.files
  FOR SELECT USING (
    deleted_at IS NULL
    AND workspace_id = public.current_workspace_id()
    AND EXISTS (
      SELECT 1 FROM public.projects p WHERE p.id = files.project_id
    )
    -- phase_id/asset_id/task_id are loose SET NULL attachments — a file
    -- outlives those parents, so no checks on them.
  );

DROP POLICY IF EXISTS comments_select ON public.comments;
CREATE POLICY comments_select ON public.comments
  FOR SELECT USING (
    deleted_at IS NULL
    AND workspace_id = public.current_workspace_id()
    -- live polymorphic parent; also finally hides orphaned comments whose
    -- entity was hard-deleted (entity_id has no FK).
    AND CASE entity_type
      WHEN 'project' THEN EXISTS (SELECT 1 FROM public.projects p WHERE p.id  = comments.entity_id)
      WHEN 'phase'   THEN EXISTS (SELECT 1 FROM public.phases  ph WHERE ph.id = comments.entity_id)
      WHEN 'asset'   THEN EXISTS (SELECT 1 FROM public.assets  a  WHERE a.id  = comments.entity_id)
      WHEN 'task'    THEN EXISTS (SELECT 1 FROM public.tasks   t  WHERE t.id  = comments.entity_id)
      ELSE false
    END
  );

DROP POLICY IF EXISTS phases_select ON public.phases;
CREATE POLICY phases_select ON public.phases
  FOR SELECT USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = phases.project_id
         AND p.workspace_id = public.current_workspace_id()
    )
  );

DROP POLICY IF EXISTS rate_cards_select ON public.rate_cards;
CREATE POLICY rate_cards_select ON public.rate_cards
  FOR SELECT USING (
    deleted_at IS NULL
    AND workspace_id = public.current_workspace_id()
  );

-- ── 3. partial indexes for the live-row predicates ───────────────────────────

CREATE INDEX IF NOT EXISTS projects_live_ws_idx   ON public.projects   (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS assets_live_ws_idx     ON public.assets     (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tasks_live_ws_idx      ON public.tasks      (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS files_live_ws_idx      ON public.files      (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS comments_live_ws_idx   ON public.comments   (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS rate_cards_live_ws_idx ON public.rate_cards (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS phases_live_project_idx ON public.phases    (project_id)   WHERE deleted_at IS NULL;

-- ── 4. retention sweep (30 days) ─────────────────────────────────────────────
-- Hard-deleting an expired parent CASCADEs its whole subtree (including
-- children that were never individually soft-deleted) — that is the point:
-- the trash entry is the parent.

CREATE OR REPLACE FUNCTION public.purge_soft_deleted(
  p_retention INTERVAL DEFAULT INTERVAL '30 days'
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t TEXT;
  v_count BIGINT;
  v_total BIGINT := 0;
BEGIN
  -- Parents first so cascades do the bulk of the work; the remaining loops
  -- catch individually soft-deleted children.
  FOREACH t IN ARRAY ARRAY['projects','assets','tasks','phases','files',
                           'comments','rate_cards']
  LOOP
    EXECUTE format(
      'DELETE FROM public.%I WHERE deleted_at < now() - $1', t)
      USING p_retention;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_total := v_total + v_count;
  END LOOP;
  RETURN v_total;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_soft_deleted(INTERVAL)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_soft_deleted(INTERVAL) TO service_role;

-- Schedule nightly where pg_cron exists (hosted envs); the CI local stack
-- ships without it — same guarded pattern as 0012.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule(
      'wilson-purge-soft-deleted',
      '47 4 * * *',
      $job$ SELECT public.purge_soft_deleted(); $job$
    );
  ELSE
    RAISE NOTICE 'pg_cron unavailable — soft-delete purge not scheduled (expected in CI local stack)';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'could not schedule soft-delete purge via pg_cron: %', SQLERRM;
END $$;

COMMENT ON FUNCTION public.purge_soft_deleted IS
  'Hard-deletes rows soft-deleted more than p_retention ago (default 30 days) across the 7 soft-delete RABBIT tables; cascades take each subtree. service_role only; scheduled nightly as wilson-purge-soft-deleted where pg_cron exists (Session 6).';
