-- =============================================================================
-- 0004_rls_rabbit.sql
-- Session 2 — Full RLS sweep of every RABBIT table.
--
-- Strategy (locked with the user in Session 2 kickoff):
--   * Drop the hardcoded DEFAULT '00000000-…-001' workspace_id on projects +
--     rate_cards. Multi-tenant deployments MUST pass workspace_id explicitly.
--   * Hybrid denormalization: hot-path tables carry workspace_id directly,
--     backfilled + kept in sync via BEFORE INSERT triggers. Everything else
--     is protected by a parent-join policy.
--       direct:      projects, assets, tasks, files, comments, rate_cards
--       parent-join: phases, asset_versions, task_dependencies, task_links,
--                    rate_card_entries, ingestion_runs, ingestion_chunks
--   * Every table ENABLE + FORCE RLS. No exceptions. service_role bypasses.
--   * Every mutable table attaches public.fn_audit_touch (defined in 0001)
--     so created_by/updated_by/updated_at populate automatically.
--   * Writes require BOTH workspace match AND an active membership row.
--     SELECTs only require workspace match (listing a shared resource is not
--     a privileged action; modifying it is).
--
-- Idempotent: DROP POLICY IF EXISTS before every CREATE POLICY, IF NOT EXISTS
-- on columns/indexes. Safe to re-run against a partially-migrated project.
-- =============================================================================

-- =============================================================================
-- 1. DROP SINGLE-TENANT DEFAULTS
-- =============================================================================

DO $$
BEGIN
  -- projects.workspace_id
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='projects' AND column_name='workspace_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.projects ALTER COLUMN workspace_id DROP DEFAULT';
    EXECUTE 'ALTER TABLE public.projects ALTER COLUMN workspace_id SET NOT NULL';
  END IF;

  -- rate_cards.workspace_id
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='rate_cards' AND column_name='workspace_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.rate_cards ALTER COLUMN workspace_id DROP DEFAULT';
    EXECUTE 'ALTER TABLE public.rate_cards ALTER COLUMN workspace_id SET NOT NULL';
  END IF;
END $$;

-- =============================================================================
-- 2. HOT-PATH DENORMALIZATION: add workspace_id to assets, tasks, files, comments
-- =============================================================================

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

-- Backfill from parent project where possible. projects.workspace_id is the
-- source of truth; for comments we walk entity_type → entity table.

UPDATE public.assets a
   SET workspace_id = p.workspace_id
  FROM public.projects p
 WHERE p.id = a.project_id AND a.workspace_id IS NULL;

UPDATE public.tasks t
   SET workspace_id = p.workspace_id
  FROM public.projects p
 WHERE p.id = t.project_id AND t.workspace_id IS NULL;

UPDATE public.files f
   SET workspace_id = p.workspace_id
  FROM public.projects p
 WHERE p.id = f.project_id AND f.workspace_id IS NULL;

-- Comments: resolve by entity_type.
UPDATE public.comments c
   SET workspace_id = p.workspace_id
  FROM public.projects p
 WHERE c.entity_type = 'project' AND c.entity_id = p.id AND c.workspace_id IS NULL;

UPDATE public.comments c
   SET workspace_id = p.workspace_id
  FROM public.phases ph
  JOIN public.projects p ON p.id = ph.project_id
 WHERE c.entity_type = 'phase' AND c.entity_id = ph.id AND c.workspace_id IS NULL;

UPDATE public.comments c
   SET workspace_id = a.workspace_id
  FROM public.assets a
 WHERE c.entity_type = 'asset' AND c.entity_id = a.id AND c.workspace_id IS NULL;

UPDATE public.comments c
   SET workspace_id = t.workspace_id
  FROM public.tasks t
 WHERE c.entity_type = 'task' AND c.entity_id = t.id AND c.workspace_id IS NULL;

-- Enforce NOT NULL now that backfill is complete.
ALTER TABLE public.assets   ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.tasks    ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.files    ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.comments ALTER COLUMN workspace_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assets_workspace_id   ON public.assets   (workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_id    ON public.tasks    (workspace_id);
CREATE INDEX IF NOT EXISTS idx_files_workspace_id    ON public.files    (workspace_id);
CREATE INDEX IF NOT EXISTS idx_comments_workspace_id ON public.comments (workspace_id);

-- =============================================================================
-- 3. WORKSPACE POPULATION TRIGGERS
-- =============================================================================

-- Populate from a parent project_id column. Used by assets, tasks, files.
CREATE OR REPLACE FUNCTION public.fn_populate_workspace_from_project()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id IS NULL AND NEW.project_id IS NOT NULL THEN
    SELECT workspace_id INTO NEW.workspace_id
      FROM public.projects WHERE id = NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Populate comments.workspace_id from the polymorphic (entity_type, entity_id).
CREATE OR REPLACE FUNCTION public.fn_populate_workspace_for_comment()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id IS NOT NULL THEN RETURN NEW; END IF;
  CASE NEW.entity_type
    WHEN 'project' THEN
      SELECT workspace_id INTO NEW.workspace_id FROM public.projects WHERE id = NEW.entity_id;
    WHEN 'phase' THEN
      SELECT p.workspace_id INTO NEW.workspace_id
        FROM public.phases ph JOIN public.projects p ON p.id = ph.project_id
       WHERE ph.id = NEW.entity_id;
    WHEN 'asset' THEN
      SELECT workspace_id INTO NEW.workspace_id FROM public.assets WHERE id = NEW.entity_id;
    WHEN 'task' THEN
      SELECT workspace_id INTO NEW.workspace_id FROM public.tasks  WHERE id = NEW.entity_id;
    ELSE
      NULL;
  END CASE;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assets_populate_workspace   ON public.assets;
CREATE TRIGGER trg_assets_populate_workspace
  BEFORE INSERT ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_from_project();

DROP TRIGGER IF EXISTS trg_tasks_populate_workspace    ON public.tasks;
CREATE TRIGGER trg_tasks_populate_workspace
  BEFORE INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_from_project();

DROP TRIGGER IF EXISTS trg_files_populate_workspace    ON public.files;
CREATE TRIGGER trg_files_populate_workspace
  BEFORE INSERT ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_from_project();

DROP TRIGGER IF EXISTS trg_comments_populate_workspace ON public.comments;
CREATE TRIGGER trg_comments_populate_workspace
  BEFORE INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_for_comment();

-- =============================================================================
-- 4. AUDIT TRIGGERS — attach fn_audit_touch (from 0001) to every mutable table
-- =============================================================================

-- 4a. Ensure every audited table has the columns fn_audit_touch writes to.
-- The base schema (0000) only gives `projects` all four columns; the rest
-- (phases, assets, tasks, etc.) have some or none, which would make the
-- trigger throw "record has no field" at runtime. Adding them idempotently
-- here so the trigger always has a column to set.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects','phases','assets','tasks','files',
                           'comments','rate_cards','rate_card_entries',
                           'asset_versions','task_dependencies','task_links',
                           'ingestion_runs','ingestion_chunks']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS created_by UUID', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_by UUID', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()', t);
  END LOOP;
END $$;

-- 4b. Attach the audit trigger.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects','phases','assets','tasks','files',
                           'comments','rate_cards','rate_card_entries',
                           'asset_versions','task_dependencies','task_links',
                           'ingestion_runs','ingestion_chunks']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_audit ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_audit
         BEFORE INSERT OR UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.fn_audit_touch()',
      t, t);
  END LOOP;
END $$;

-- =============================================================================
-- 5. SHARED HELPER — active-membership check used by every write policy
-- =============================================================================

CREATE OR REPLACE FUNCTION public.has_active_membership(ws UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.user_id = auth.uid()
       AND wm.workspace_id = ws
       AND wm.is_active
  );
$$;

COMMENT ON FUNCTION public.has_active_membership IS
  'Returns true if auth.uid() has an active workspace_members row for the given workspace.';

-- =============================================================================
-- 6. POLICIES — direct-workspace_id tables
-- =============================================================================

-- ── projects ────────────────────────────────────────────────────────────────
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS projects_select             ON public.projects;
DROP POLICY IF EXISTS projects_select_by_workspace ON public.projects; -- 0002 legacy
DROP POLICY IF EXISTS projects_insert             ON public.projects;
DROP POLICY IF EXISTS projects_update             ON public.projects;
DROP POLICY IF EXISTS projects_delete             ON public.projects;

CREATE POLICY projects_select ON public.projects
  FOR SELECT USING (
    deleted_at IS NULL
    AND workspace_id = public.current_workspace_id()
  );

CREATE POLICY projects_insert ON public.projects
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  );

CREATE POLICY projects_update ON public.projects
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
  );

CREATE POLICY projects_delete ON public.projects
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  );

-- ── assets ──────────────────────────────────────────────────────────────────
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assets_select ON public.assets;
DROP POLICY IF EXISTS assets_insert ON public.assets;
DROP POLICY IF EXISTS assets_update ON public.assets;
DROP POLICY IF EXISTS assets_delete ON public.assets;

CREATE POLICY assets_select ON public.assets
  FOR SELECT USING (workspace_id = public.current_workspace_id());

CREATE POLICY assets_insert ON public.assets
  FOR INSERT WITH CHECK (
    -- workspace_id is populated by the BEFORE INSERT trigger if null; by the
    -- time WITH CHECK runs, NEW.workspace_id reflects the parent project.
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  );

CREATE POLICY assets_update ON public.assets
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
  );

CREATE POLICY assets_delete ON public.assets
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  );

-- ── tasks ───────────────────────────────────────────────────────────────────
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasks_select ON public.tasks;
DROP POLICY IF EXISTS tasks_insert ON public.tasks;
DROP POLICY IF EXISTS tasks_update ON public.tasks;
DROP POLICY IF EXISTS tasks_delete ON public.tasks;

CREATE POLICY tasks_select ON public.tasks
  FOR SELECT USING (workspace_id = public.current_workspace_id());

CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  );

CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
  );

CREATE POLICY tasks_delete ON public.tasks
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  );

-- ── files ───────────────────────────────────────────────────────────────────
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS files_select ON public.files;
DROP POLICY IF EXISTS files_insert ON public.files;
DROP POLICY IF EXISTS files_update ON public.files;
DROP POLICY IF EXISTS files_delete ON public.files;

CREATE POLICY files_select ON public.files
  FOR SELECT USING (workspace_id = public.current_workspace_id());

CREATE POLICY files_insert ON public.files
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  );

CREATE POLICY files_update ON public.files
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
  );

CREATE POLICY files_delete ON public.files
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  );

-- ── comments ────────────────────────────────────────────────────────────────
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comments_select ON public.comments;
DROP POLICY IF EXISTS comments_insert ON public.comments;
DROP POLICY IF EXISTS comments_update ON public.comments;
DROP POLICY IF EXISTS comments_delete ON public.comments;

CREATE POLICY comments_select ON public.comments
  FOR SELECT USING (workspace_id = public.current_workspace_id());

CREATE POLICY comments_insert ON public.comments
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  );

-- Author-vs-anyone permissions are refined in Session 3 (PermissionGate).
-- For now any active workspace member can update any comment in the workspace.
CREATE POLICY comments_update ON public.comments
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
  );

CREATE POLICY comments_delete ON public.comments
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  );

-- ── rate_cards ──────────────────────────────────────────────────────────────
ALTER TABLE public.rate_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_cards FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rate_cards_select ON public.rate_cards;
DROP POLICY IF EXISTS rate_cards_insert ON public.rate_cards;
DROP POLICY IF EXISTS rate_cards_update ON public.rate_cards;
DROP POLICY IF EXISTS rate_cards_delete ON public.rate_cards;

CREATE POLICY rate_cards_select ON public.rate_cards
  FOR SELECT USING (workspace_id = public.current_workspace_id());

CREATE POLICY rate_cards_insert ON public.rate_cards
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  );

CREATE POLICY rate_cards_update ON public.rate_cards
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
  );

CREATE POLICY rate_cards_delete ON public.rate_cards
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  );

-- =============================================================================
-- 7. POLICIES — parent-join tables
-- =============================================================================

-- ── phases (join via projects) ──────────────────────────────────────────────
ALTER TABLE public.phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phases FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS phases_select ON public.phases;
DROP POLICY IF EXISTS phases_insert ON public.phases;
DROP POLICY IF EXISTS phases_update ON public.phases;
DROP POLICY IF EXISTS phases_delete ON public.phases;

CREATE POLICY phases_select ON public.phases
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = phases.project_id
         AND p.workspace_id = public.current_workspace_id()
    )
  );

CREATE POLICY phases_insert ON public.phases
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = project_id
         AND p.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(p.workspace_id)
    )
  );

CREATE POLICY phases_update ON public.phases
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = phases.project_id
         AND p.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(p.workspace_id)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = project_id
         AND p.workspace_id = public.current_workspace_id()
    )
  );

CREATE POLICY phases_delete ON public.phases
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = phases.project_id
         AND p.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(p.workspace_id)
    )
  );

-- ── asset_versions (join via assets.workspace_id) ───────────────────────────
ALTER TABLE public.asset_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_versions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asset_versions_select ON public.asset_versions;
DROP POLICY IF EXISTS asset_versions_insert ON public.asset_versions;
DROP POLICY IF EXISTS asset_versions_update ON public.asset_versions;
DROP POLICY IF EXISTS asset_versions_delete ON public.asset_versions;

CREATE POLICY asset_versions_select ON public.asset_versions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.assets a
       WHERE a.id = asset_versions.asset_id
         AND a.workspace_id = public.current_workspace_id()
    )
  );

CREATE POLICY asset_versions_insert ON public.asset_versions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.assets a
       WHERE a.id = asset_id
         AND a.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(a.workspace_id)
    )
  );

CREATE POLICY asset_versions_update ON public.asset_versions
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.assets a
       WHERE a.id = asset_versions.asset_id
         AND a.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(a.workspace_id)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.assets a
       WHERE a.id = asset_id
         AND a.workspace_id = public.current_workspace_id()
    )
  );

CREATE POLICY asset_versions_delete ON public.asset_versions
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.assets a
       WHERE a.id = asset_versions.asset_id
         AND a.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(a.workspace_id)
    )
  );

-- ── task_dependencies (join via tasks; both predecessor + successor) ────────
ALTER TABLE public.task_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_dependencies FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_deps_select ON public.task_dependencies;
DROP POLICY IF EXISTS task_deps_insert ON public.task_dependencies;
DROP POLICY IF EXISTS task_deps_update ON public.task_dependencies;
DROP POLICY IF EXISTS task_deps_delete ON public.task_dependencies;

CREATE POLICY task_deps_select ON public.task_dependencies
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tasks pre
       WHERE pre.id = task_dependencies.predecessor_id
         AND pre.workspace_id = public.current_workspace_id()
    )
    AND EXISTS (
      SELECT 1 FROM public.tasks suc
       WHERE suc.id = task_dependencies.successor_id
         AND suc.workspace_id = public.current_workspace_id()
    )
  );

CREATE POLICY task_deps_insert ON public.task_dependencies
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tasks pre
       WHERE pre.id = predecessor_id
         AND pre.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(pre.workspace_id)
    )
    AND EXISTS (
      SELECT 1 FROM public.tasks suc
       WHERE suc.id = successor_id
         AND suc.workspace_id = public.current_workspace_id()
    )
  );

CREATE POLICY task_deps_update ON public.task_dependencies
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.tasks pre
       WHERE pre.id = task_dependencies.predecessor_id
         AND pre.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(pre.workspace_id)
    )
  );

CREATE POLICY task_deps_delete ON public.task_dependencies
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.tasks pre
       WHERE pre.id = task_dependencies.predecessor_id
         AND pre.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(pre.workspace_id)
    )
  );

-- ── task_links (join via tasks) ─────────────────────────────────────────────
ALTER TABLE public.task_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_links FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_links_select ON public.task_links;
DROP POLICY IF EXISTS task_links_insert ON public.task_links;
DROP POLICY IF EXISTS task_links_update ON public.task_links;
DROP POLICY IF EXISTS task_links_delete ON public.task_links;

CREATE POLICY task_links_select ON public.task_links
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
       WHERE t.id = task_links.task_id
         AND t.workspace_id = public.current_workspace_id()
    )
  );

CREATE POLICY task_links_insert ON public.task_links
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tasks t
       WHERE t.id = task_id
         AND t.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(t.workspace_id)
    )
  );

CREATE POLICY task_links_update ON public.task_links
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
       WHERE t.id = task_links.task_id
         AND t.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(t.workspace_id)
    )
  );

CREATE POLICY task_links_delete ON public.task_links
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
       WHERE t.id = task_links.task_id
         AND t.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(t.workspace_id)
    )
  );

-- ── rate_card_entries (join via rate_cards.workspace_id) ────────────────────
ALTER TABLE public.rate_card_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_card_entries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rce_select ON public.rate_card_entries;
DROP POLICY IF EXISTS rce_insert ON public.rate_card_entries;
DROP POLICY IF EXISTS rce_update ON public.rate_card_entries;
DROP POLICY IF EXISTS rce_delete ON public.rate_card_entries;

CREATE POLICY rce_select ON public.rate_card_entries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.rate_cards rc
       WHERE rc.id = rate_card_entries.rate_card_id
         AND rc.workspace_id = public.current_workspace_id()
    )
  );

CREATE POLICY rce_insert ON public.rate_card_entries
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.rate_cards rc
       WHERE rc.id = rate_card_id
         AND rc.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(rc.workspace_id)
    )
  );

CREATE POLICY rce_update ON public.rate_card_entries
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.rate_cards rc
       WHERE rc.id = rate_card_entries.rate_card_id
         AND rc.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(rc.workspace_id)
    )
  );

CREATE POLICY rce_delete ON public.rate_card_entries
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.rate_cards rc
       WHERE rc.id = rate_card_entries.rate_card_id
         AND rc.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(rc.workspace_id)
    )
  );

-- ── ingestion_runs (join via projects) ──────────────────────────────────────
ALTER TABLE public.ingestion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_runs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ingestion_runs_select ON public.ingestion_runs;
DROP POLICY IF EXISTS ingestion_runs_insert ON public.ingestion_runs;
DROP POLICY IF EXISTS ingestion_runs_update ON public.ingestion_runs;
DROP POLICY IF EXISTS ingestion_runs_delete ON public.ingestion_runs;

CREATE POLICY ingestion_runs_select ON public.ingestion_runs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = ingestion_runs.project_id
         AND p.workspace_id = public.current_workspace_id()
    )
  );

CREATE POLICY ingestion_runs_insert ON public.ingestion_runs
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = project_id
         AND p.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(p.workspace_id)
    )
  );

CREATE POLICY ingestion_runs_update ON public.ingestion_runs
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = ingestion_runs.project_id
         AND p.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(p.workspace_id)
    )
  );

CREATE POLICY ingestion_runs_delete ON public.ingestion_runs
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = ingestion_runs.project_id
         AND p.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(p.workspace_id)
    )
  );

-- ── ingestion_chunks (join via ingestion_runs → projects) ───────────────────
ALTER TABLE public.ingestion_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_chunks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ingestion_chunks_select ON public.ingestion_chunks;
DROP POLICY IF EXISTS ingestion_chunks_insert ON public.ingestion_chunks;
DROP POLICY IF EXISTS ingestion_chunks_update ON public.ingestion_chunks;
DROP POLICY IF EXISTS ingestion_chunks_delete ON public.ingestion_chunks;

CREATE POLICY ingestion_chunks_select ON public.ingestion_chunks
  FOR SELECT USING (
    EXISTS (
      SELECT 1
        FROM public.ingestion_runs r
        JOIN public.projects       p ON p.id = r.project_id
       WHERE r.id = ingestion_chunks.run_id
         AND p.workspace_id = public.current_workspace_id()
    )
  );

CREATE POLICY ingestion_chunks_insert ON public.ingestion_chunks
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.ingestion_runs r
        JOIN public.projects       p ON p.id = r.project_id
       WHERE r.id = run_id
         AND p.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(p.workspace_id)
    )
  );

CREATE POLICY ingestion_chunks_update ON public.ingestion_chunks
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
        FROM public.ingestion_runs r
        JOIN public.projects       p ON p.id = r.project_id
       WHERE r.id = ingestion_chunks.run_id
         AND p.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(p.workspace_id)
    )
  );

CREATE POLICY ingestion_chunks_delete ON public.ingestion_chunks
  FOR DELETE USING (
    EXISTS (
      SELECT 1
        FROM public.ingestion_runs r
        JOIN public.projects       p ON p.id = r.project_id
       WHERE r.id = ingestion_chunks.run_id
         AND p.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(p.workspace_id)
    )
  );

-- =============================================================================
-- 8. POST-CONDITIONS — assert every in-scope table has RLS forced.
-- =============================================================================

DO $$
DECLARE
  t TEXT;
  has_rls BOOLEAN;
  is_forced BOOLEAN;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects','phases','assets','tasks','files',
                           'comments','rate_cards','rate_card_entries',
                           'asset_versions','task_dependencies','task_links',
                           'ingestion_runs','ingestion_chunks']
  LOOP
    SELECT relrowsecurity, relforcerowsecurity
      INTO has_rls, is_forced
      FROM pg_class
     WHERE oid = format('public.%I', t)::regclass;

    IF NOT has_rls OR NOT is_forced THEN
      RAISE EXCEPTION 'RLS post-condition failed for table %: rowsecurity=%, force=%',
        t, has_rls, is_forced;
    END IF;
  END LOOP;
END $$;
