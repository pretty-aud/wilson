-- =============================================================================
-- 0096_task_items.sql — FX2 (post-overhaul, R.A.B.B.I.T.'s small fixes,
-- 2026-10-11): a task relates to MANY items — assets, scenes, shots, levels
-- and experiences.
--
-- Audrey (2026-10-11): "a task should allow for multiple assets assigned.
-- scenes and shots, levels, experiences also. a task may be related to
-- multiple items."
--
-- WHAT THIS ADDS
--   public.task_items — one row per (task, item): entity_type ('asset',
--   'scene', 'shot', 'level', 'experience') + entity_id, and a position that
--   orders a task's items WITHIN their kind. The first item of a kind (by
--   position, then created_at, then id) is the task's MAIN item of that kind.
--
-- 🚨 THE NAME. `public.task_links` ALREADY EXISTS — 0000's free-form URL links
--   on a task, with RLS (0004/0013), history (0012), the realtime broadcast
--   and five suites. The brief's name collided with it, so this table is
--   `task_items` (the client's `taskItems`), and the URL links are untouched.
--
-- THE SINGLE COLUMNS STAY AND KEEP WORKING (the brief's rule). tasks.asset_id
--   (0000), tasks.scene_id and tasks.shot_id (0084) are each kept equal to the
--   task's MAIN item of that kind, in BOTH directions:
--     * a write to task_items (the new client) recomputes the task's single
--       column of the item's kind — §7, fn_task_items_sync_task;
--     * a write of a single column (an older client, the Timeline's editor,
--       a template, the agent, a bid version's open) changes the items —
--       §7, fn_tasks_sync_items:
--         - set to an item the task already has: that item moves FIRST and
--           nothing is removed (what opening an older bid version needs);
--         - set to a new id: it REPLACES the main item, at its position;
--         - cleared: the main item is removed and the next one is main.
--     * a new task's single columns become its first items — §7,
--       fn_tasks_seed_items.
--   Levels and experiences have NO single column on the cloud (0034 and 0084
--   kept them local-only; the client's allowlist drops them): their only home
--   on the cloud is this table, and the client derives the task's level and
--   experience from it.
--
-- SAME PROJECT, BY CONSTRUCTION (0084 §1's composite shape). The client
--   writes entity_type + entity_id; five GENERATED columns (asset_id …
--   experience_id) each hold entity_id for their kind and NULL otherwise, and
--   each carries a foreign key on (id, project_id) to its table, ON DELETE
--   CASCADE: an item can only name a row of its task's own project, and
--   deleting the row takes the item off every task. The task FK is
--   (task_id, project_id) → tasks (id, project_id), CASCADE. MATCH SIMPLE: a
--   NULL generated column is not checked, so each row is checked against
--   exactly its own kind's table.
--
-- RLS as tasks are gated today (can_write_project for writes, not the money
--   gate), PLUS the hops 0084 learned (0082 §3b / 0083): every policy hops to
--   the PROJECT and to the TASK under the caller's own RLS, so a private
--   project's items are invisible and unwritable to a seat that cannot see it
--   (tasks_insert / tasks_update lack that hop — a PRE-EXISTING gap recorded
--   in docs/OUTSTANDING.md since 0082; this table does not inherit it), and a
--   trashed task's items are hidden and frozen with it.
--
-- ORDERING: needs 0040 (levels, experiences), 0072 (projects.is_private and
--   the privacy arm the hops carry), 0084 (tasks.scene_id / shot_id, the
--   scenes / shots composite keys) and 0091 (fn_realtime_broadcast's fifteen
--   tables, restated here whole with a sixteenth). Refuses to run otherwise.
-- Number: 0096 / suite 99 (0094 / 97 stay reserved; 0095 / 98 are GW3's).
-- pgTAP: supabase/tests/rls/99_task_items.sql.
-- Idempotent: CREATE … IF NOT EXISTS, guarded constraints, DROP-then-CREATE
--   for policies and triggers, CREATE OR REPLACE for functions, the backfill
--   ON CONFLICT DO NOTHING. Safe to re-run.
-- =============================================================================


-- =============================================================================
-- 0. PRE-FLIGHT
-- =============================================================================
DO $$
BEGIN
  IF to_regclass('public.levels') IS NULL OR to_regclass('public.experiences') IS NULL
     OR to_regclass('public.scenes') IS NULL OR to_regclass('public.shots') IS NULL THEN
    RAISE EXCEPTION '0096 pre-flight failed: scenes / shots / levels / experiences missing — apply 0040 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'is_private') THEN
    RAISE EXCEPTION '0096 pre-flight failed: projects.is_private is missing — apply 0072 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'shot_id')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conrelid = 'public.scenes'::regclass AND conname = 'scenes_id_project_key')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conrelid = 'public.shots'::regclass AND conname = 'shots_id_project_key') THEN
    RAISE EXCEPTION '0096 pre-flight failed: tasks.scene_id / shot_id or the scenes / shots composite keys are missing — apply 0084 first';
  END IF;
  IF to_regprocedure('public.file_row_is_money(boolean, text)') IS NULL
     OR position('''shot_takes''' IN pg_get_functiondef('public.fn_realtime_broadcast()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '0096 pre-flight failed: fn_realtime_broadcast is not 0091''s (no shot_takes arm) — apply 0091 first; this file restates that body';
  END IF;
  IF to_regclass('public.task_links') IS NULL THEN
    RAISE EXCEPTION '0096 pre-flight failed: public.task_links (0000, the URL links) is missing — this file names it in the realtime body and must not be the first to';
  END IF;
END $$;


-- =============================================================================
-- 1. COMPOSITE KEYS ON THE PARENTS (0084 §1's shape)
-- =============================================================================
-- (id, project_id) on tasks, assets, levels and experiences, so an item's FK
-- can be on the PAIR: a plain FK proves the row exists somewhere; the pair
-- proves it exists IN THIS PROJECT. `id` is each table's primary key, so the
-- pair is trivially unique and costs one small index. Guarded by
-- pg_constraint, never DROP-then-ADD (the FKs below depend on these).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.tasks'::regclass AND conname = 'tasks_id_project_key') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_id_project_key UNIQUE (id, project_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.assets'::regclass AND conname = 'assets_id_project_key') THEN
    ALTER TABLE public.assets ADD CONSTRAINT assets_id_project_key UNIQUE (id, project_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.levels'::regclass AND conname = 'levels_id_project_key') THEN
    ALTER TABLE public.levels ADD CONSTRAINT levels_id_project_key UNIQUE (id, project_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.experiences'::regclass AND conname = 'experiences_id_project_key') THEN
    ALTER TABLE public.experiences ADD CONSTRAINT experiences_id_project_key UNIQUE (id, project_id);
  END IF;
END $$;


-- =============================================================================
-- 2. task_items
-- =============================================================================
-- The five generated columns are what the foreign keys hang on. They cannot
-- be written (Postgres refuses a non-DEFAULT value), so a client can never
-- point an item's FK somewhere its entity_id does not say. ON UPDATE of a
-- parent's key is NO ACTION (a generated column refuses ON UPDATE CASCADE):
-- moving a task, an asset, a scene, a shot, a level or an experience to
-- another project while it has items is refused — nothing in the product
-- moves one.

CREATE TABLE IF NOT EXISTS public.task_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       UUID NOT NULL,
  project_id    UUID NOT NULL REFERENCES public.projects(id)   ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type   TEXT NOT NULL,
  entity_id     UUID NOT NULL,
  position      INTEGER NOT NULL DEFAULT 0,

  asset_id      UUID GENERATED ALWAYS AS (CASE WHEN entity_type = 'asset'      THEN entity_id END) STORED,
  scene_id      UUID GENERATED ALWAYS AS (CASE WHEN entity_type = 'scene'      THEN entity_id END) STORED,
  shot_id       UUID GENERATED ALWAYS AS (CASE WHEN entity_type = 'shot'       THEN entity_id END) STORED,
  level_id      UUID GENERATED ALWAYS AS (CASE WHEN entity_type = 'level'      THEN entity_id END) STORED,
  experience_id UUID GENERATED ALWAYS AS (CASE WHEN entity_type = 'experience' THEN entity_id END) STORED,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID,

  CONSTRAINT task_items_entity_type_chk
    CHECK (entity_type IN ('asset', 'scene', 'shot', 'level', 'experience')),
  CONSTRAINT task_items_position_nonneg_chk CHECK (position >= 0),
  CONSTRAINT task_items_task_entity_key UNIQUE (task_id, entity_type, entity_id),
  CONSTRAINT task_items_task_fk
    FOREIGN KEY (task_id, project_id) REFERENCES public.tasks (id, project_id) ON DELETE CASCADE,
  CONSTRAINT task_items_asset_fk
    FOREIGN KEY (asset_id, project_id) REFERENCES public.assets (id, project_id) ON DELETE CASCADE,
  CONSTRAINT task_items_scene_fk
    FOREIGN KEY (scene_id, project_id) REFERENCES public.scenes (id, project_id) ON DELETE CASCADE,
  CONSTRAINT task_items_shot_fk
    FOREIGN KEY (shot_id, project_id) REFERENCES public.shots (id, project_id) ON DELETE CASCADE,
  CONSTRAINT task_items_level_fk
    FOREIGN KEY (level_id, project_id) REFERENCES public.levels (id, project_id) ON DELETE CASCADE,
  CONSTRAINT task_items_experience_fk
    FOREIGN KEY (experience_id, project_id) REFERENCES public.experiences (id, project_id) ON DELETE CASCADE,
  CONSTRAINT task_items_project_workspace_fk
    FOREIGN KEY (project_id, workspace_id) REFERENCES public.projects (id, workspace_id)
);

-- A task's items in their order (the main-item lookups and the load), and one
-- partial index per kind so an entity's delete cascade finds its items fast.
CREATE INDEX IF NOT EXISTS task_items_task_kind_position_idx
  ON public.task_items (task_id, entity_type, position, created_at, id);
CREATE INDEX IF NOT EXISTS task_items_project_idx ON public.task_items (project_id);
CREATE INDEX IF NOT EXISTS task_items_asset_idx      ON public.task_items (asset_id)      WHERE asset_id      IS NOT NULL;
CREATE INDEX IF NOT EXISTS task_items_scene_idx      ON public.task_items (scene_id)      WHERE scene_id      IS NOT NULL;
CREATE INDEX IF NOT EXISTS task_items_shot_idx       ON public.task_items (shot_id)       WHERE shot_id       IS NOT NULL;
CREATE INDEX IF NOT EXISTS task_items_level_idx      ON public.task_items (level_id)      WHERE level_id      IS NOT NULL;
CREATE INDEX IF NOT EXISTS task_items_experience_idx ON public.task_items (experience_id) WHERE experience_id IS NOT NULL;

COMMENT ON TABLE public.task_items IS
  '0096 (FX2, 2026-10-11): the items a task is about — assets, scenes, shots, levels, experiences — one row per (task, item), ordered within each kind by position (then created_at, id). The first of a kind is the task''s MAIN item of that kind, and tasks.asset_id / scene_id / shot_id are kept equal to it in both directions (fn_task_items_sync_task, fn_tasks_sync_items, fn_tasks_seed_items). Levels and experiences live only here on the cloud. Every FK is on (id, project_id), CASCADE: an item names only its task''s project''s rows, and a deleted row leaves every task. NOT task_links (0000), which holds a task''s URL links.';
COMMENT ON COLUMN public.task_items.position IS
  '0096: the order WITHIN the item''s kind on its task (0 first). A tie is broken by created_at, then id. reorder_task_items renumbers a kind densely.';


-- =============================================================================
-- 3. Stamping and audit (0084 §7's pair)
-- =============================================================================
-- workspace_id is NOT NULL and no client sends it: 0004's stamping trigger,
-- plpgsql and NOT SECURITY DEFINER (the precondition for FORCE RLS).

DROP TRIGGER IF EXISTS trg_task_items_populate_workspace ON public.task_items;
CREATE TRIGGER trg_task_items_populate_workspace
  BEFORE INSERT ON public.task_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_from_project();

DROP TRIGGER IF EXISTS trg_task_items_audit ON public.task_items;
CREATE TRIGGER trg_task_items_audit
  BEFORE INSERT OR UPDATE ON public.task_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_touch();


-- =============================================================================
-- 4. RLS
-- =============================================================================
-- Separate policies per command, never FOR ALL (0029). Every policy hops to
-- the project AND to the task under the caller's RLS:
--   * projects_select carries the workspace, live, membership and privacy
--     arms (0072), so a private project's items are a name, not access;
--   * tasks_select carries deleted_at IS NULL and its asset's / project's
--     visibility, so a trashed task's items are hidden and cannot be written.
-- 🚨 The WRITE policies hop too (0082 §3b / 0083): supabase-js's .insert()
-- without .select() sends Prefer: return=minimal, so no SELECT policy is
-- consulted; a write is judged by its own policy alone.
-- UPDATE's WITH CHECK is IDENTICAL to its USING (0044).

ALTER TABLE public.task_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_items FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_items_select ON public.task_items;
CREATE POLICY task_items_select ON public.task_items
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_items.project_id)
    AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_items.task_id)
  );

DROP POLICY IF EXISTS task_items_insert ON public.task_items;
CREATE POLICY task_items_insert ON public.task_items
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_items.project_id)
    AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_items.task_id)
  );

DROP POLICY IF EXISTS task_items_update ON public.task_items;
CREATE POLICY task_items_update ON public.task_items
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_items.project_id)
    AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_items.task_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_items.project_id)
    AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_items.task_id)
  );

DROP POLICY IF EXISTS task_items_delete ON public.task_items;
CREATE POLICY task_items_delete ON public.task_items
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = task_items.project_id)
    AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_items.task_id)
  );


-- =============================================================================
-- 5. Privileges
-- =============================================================================
-- Stated, PUBLIC included (S21, S22). A client UPDATEs `position` and nothing
-- else (a COLUMN grant): to point an item at something else it deletes and
-- inserts, which the policies judge whole. The sync triggers below run as the
-- caller and keep to the same rule (they delete and insert; they renumber).

REVOKE ALL ON public.task_items FROM PUBLIC, anon;
REVOKE ALL ON public.task_items FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.task_items TO authenticated;
GRANT UPDATE (position) ON public.task_items TO authenticated;
GRANT ALL ON public.task_items TO service_role;


-- =============================================================================
-- 6. reorder_task_items — one kind of one task, in one statement
-- =============================================================================
-- SECURITY INVOKER: it grants nothing the table's own policies do not (rows
-- the caller may not see are not read, rows they may not write are not
-- written). The named ids go first, in the order given; every other item of
-- that kind follows in its current order (a collaborator's new item, which a
-- stale view did not name, lands after rather than colliding). Positions come
-- out dense, 0..n-1. An id of another task or another kind is ignored. Returns
-- the rows it moved.

CREATE OR REPLACE FUNCTION public.reorder_task_items(p_task UUID, p_entity_type TEXT, p_ids UUID[])
RETURNS SETOF public.task_items
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_entity_type IS NULL OR p_entity_type NOT IN ('asset', 'scene', 'shot', 'level', 'experience') THEN
    RAISE EXCEPTION 'reorder_task_items: % is not a kind of item (asset, scene, shot, level, experience)', p_entity_type
      USING ERRCODE = '22023';
  END IF;
  IF p_ids IS NULL THEN
    RETURN;
  END IF;
  IF cardinality(p_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_ids) AS x) THEN
    RAISE EXCEPTION 'reorder_task_items: an item is named twice' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH named AS (
    SELECT o.id, o.ord FROM unnest(p_ids) WITH ORDINALITY AS o(id, ord)
  ), ranked AS (
    SELECT ti.id,
           (row_number() OVER (ORDER BY (n.ord IS NULL), n.ord, ti.position, ti.created_at, ti.id) - 1)::int AS np
      FROM public.task_items ti
      LEFT JOIN named n ON n.id = ti.id
     WHERE ti.task_id = p_task AND ti.entity_type = p_entity_type
  )
  UPDATE public.task_items ti
     SET position = r.np
    FROM ranked r
   WHERE ti.id = r.id AND ti.position IS DISTINCT FROM r.np
  RETURNING ti.*;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reorder_task_items(UUID, TEXT, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_task_items(UUID, TEXT, UUID[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.reorder_task_items(UUID, TEXT, UUID[]) IS
  '0096 (FX2): one kind of one task''s items reordered in one statement — the named ids first in the order given, the rest after in their current order, positions dense from 0. SECURITY INVOKER: task_items'' policies decide what it reads and writes.';


-- =============================================================================
-- 7. KEEPING THE SINGLE COLUMNS IN STEP — both directions
-- =============================================================================
-- Three trigger functions, all SECURITY INVOKER (the caller's RLS governs
-- every row they touch; a cascade from a foreign key runs as the tables'
-- owner, which bypasses RLS, so an entity's delete always re-points its
-- tasks). They recurse into each other, so one transaction-local setting,
-- `wilson.task_items_sync`, marks "the other direction is already writing":
-- while it is 'on', fn_task_items_sync_task does not touch tasks and
-- fn_tasks_sync_items does not touch task_items. Each function restores the
-- previous value when it is done, so nesting is safe, and a failed statement
-- rolls the setting back with everything else. A client cannot set it
-- (PostgREST runs no SET from a request), and if one could, the worst it buys
-- is a task whose single column disagrees with its items until the next
-- write — never a privilege.
--
-- "Main item of kind k" everywhere below:
--   SELECT entity_id FROM task_items WHERE task_id = … AND entity_type = k
--    ORDER BY position, created_at, id LIMIT 1
-- Only asset, scene and shot have single columns; a level's or an
-- experience's item never touches tasks.

-- ── 7a. task_items → tasks ─────────────────────────────────────────────────
-- After any insert, update or delete of an asset, scene or shot item, the
-- task's single column of THAT kind (only that kind: a column this table
-- holds no item for — a link made before 0096 to another project's asset,
-- which the composite key refuses — is never cleared by an unrelated write)
-- is set to the task's main item of that kind, when it differs. An UPDATE
-- recomputes the old row's task too (a column grant keeps clients to
-- `position`, but service_role may move a row).
--
-- 🚨 A DELETE whose entity row is GONE is left alone. That is a foreign-key
-- cascade from the entity's own delete, and the task's column has its own
-- rule for it, which must win whatever order Postgres fires the two in:
--   * an asset: tasks.asset_id is ON DELETE CASCADE (0034: "a task scoped to
--     a deliverable dies with it") — re-pointing the column to the next
--     asset first would let the task escape its main asset's delete;
--   * a scene or a shot: tasks.scene_id / shot_id are ON DELETE SET NULL,
--     and that UPDATE goes through 7b, which hands "main" to the next item.

CREATE OR REPLACE FUNCTION public.fn_task_items_sync_task()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_prev  TEXT := current_setting('wilson.task_items_sync', true);
  v_task  UUID;
  v_kind  TEXT;
  v_main  UUID;
BEGIN
  IF v_prev = 'on' THEN
    RETURN NULL;
  END IF;
  -- PG14+: the unassigned side of OLD / NEW reads as NULL in a row trigger.
  FOR v_task, v_kind IN
    SELECT DISTINCT s.task_id, s.kind
      FROM (VALUES (OLD.task_id, OLD.entity_type, OLD.entity_id, TG_OP = 'DELETE'),
                   (NEW.task_id, NEW.entity_type, NEW.entity_id, false)) AS s(task_id, kind, eid, gone_check)
     WHERE s.task_id IS NOT NULL
       AND s.kind IN ('asset', 'scene', 'shot')
       AND NOT (s.gone_check AND (
             (s.kind = 'asset' AND NOT EXISTS (SELECT 1 FROM public.assets x WHERE x.id = s.eid))
          OR (s.kind = 'scene' AND NOT EXISTS (SELECT 1 FROM public.scenes x WHERE x.id = s.eid))
          OR (s.kind = 'shot'  AND NOT EXISTS (SELECT 1 FROM public.shots  x WHERE x.id = s.eid))))
  LOOP
    SELECT ti.entity_id INTO v_main
      FROM public.task_items ti
     WHERE ti.task_id = v_task AND ti.entity_type = v_kind
     ORDER BY ti.position, ti.created_at, ti.id
     LIMIT 1;
    IF NOT FOUND THEN
      v_main := NULL;
    END IF;
    PERFORM set_config('wilson.task_items_sync', 'on', true);
    IF v_kind = 'asset' THEN
      UPDATE public.tasks SET asset_id = v_main WHERE id = v_task AND asset_id IS DISTINCT FROM v_main;
    ELSIF v_kind = 'scene' THEN
      UPDATE public.tasks SET scene_id = v_main WHERE id = v_task AND scene_id IS DISTINCT FROM v_main;
    ELSE
      UPDATE public.tasks SET shot_id = v_main WHERE id = v_task AND shot_id IS DISTINCT FROM v_main;
    END IF;
    PERFORM set_config('wilson.task_items_sync', coalesce(v_prev, ''), true);
  END LOOP;
  RETURN NULL;
END;
$$;

-- ── 7b. tasks → task_items, on a write of a single column ──────────────────
-- BEFORE UPDATE OF asset_id, scene_id, shot_id. For each kind whose column
-- the UPDATE changes (OLD → NEW):
--   * NEW is the main item already      → nothing (in step);
--   * NEW IS NULL                       → the item for OLD is removed (the
--                                         value the writer cleared — after a
--                                         scene's cascade it is already gone,
--                                         and the next item stays);
--   * NEW is another item of the task   → it moves first: the kind renumbered
--                                         0..n-1 with it at 0, nothing removed
--                                         (what opening an older bid version
--                                         needs);
--   * NEW is not an item of the task    → it replaces the item for OLD, first
--                                         (a delete and an insert — the column
--                                         grant is position only).
-- Then NEW carries the main item as it stands (a cleared column takes the
-- next item, when there is one). The insert carries the task's project, so
-- the item's composite key refuses another project's row — which makes
-- asset_id same-project for the first time (0000's FK was plain).

CREATE OR REPLACE FUNCTION public.fn_tasks_sync_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_prev   TEXT := current_setting('wilson.task_items_sync', true);
  v_kind   TEXT;
  v_old    UUID;
  v_new    UUID;
  v_main   UUID;
  v_after  UUID;
BEGIN
  IF v_prev = 'on' THEN
    RETURN NEW;
  END IF;
  FOREACH v_kind IN ARRAY ARRAY['asset', 'scene', 'shot'] LOOP
    IF v_kind = 'asset' THEN
      v_old := OLD.asset_id; v_new := NEW.asset_id;
    ELSIF v_kind = 'scene' THEN
      v_old := OLD.scene_id; v_new := NEW.scene_id;
    ELSE
      v_old := OLD.shot_id;  v_new := NEW.shot_id;
    END IF;
    CONTINUE WHEN v_new IS NOT DISTINCT FROM v_old;

    SELECT ti.entity_id INTO v_main
      FROM public.task_items ti
     WHERE ti.task_id = NEW.id AND ti.entity_type = v_kind
     ORDER BY ti.position, ti.created_at, ti.id
     LIMIT 1;
    IF NOT FOUND THEN
      v_main := NULL;
    END IF;
    CONTINUE WHEN v_new IS NOT NULL AND v_main IS NOT DISTINCT FROM v_new;

    PERFORM set_config('wilson.task_items_sync', 'on', true);
    IF v_new IS NULL THEN
      DELETE FROM public.task_items
       WHERE task_id = NEW.id AND entity_type = v_kind AND entity_id = v_old;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.task_items
                      WHERE task_id = NEW.id AND entity_type = v_kind AND entity_id = v_new) THEN
        IF v_old IS NOT NULL THEN
          DELETE FROM public.task_items
           WHERE task_id = NEW.id AND entity_type = v_kind AND entity_id = v_old;
        END IF;
        INSERT INTO public.task_items (task_id, project_id, entity_type, entity_id, position)
        VALUES (NEW.id, NEW.project_id, v_kind, v_new, 0);
      END IF;
      -- It first; the rest in their order; dense from 0.
      UPDATE public.task_items ti
         SET position = r.np
        FROM (SELECT x.id,
                     (row_number() OVER (ORDER BY (x.entity_id <> v_new), x.position, x.created_at, x.id) - 1)::int AS np
                FROM public.task_items x
               WHERE x.task_id = NEW.id AND x.entity_type = v_kind) r
       WHERE ti.id = r.id AND ti.position IS DISTINCT FROM r.np;
    END IF;
    PERFORM set_config('wilson.task_items_sync', coalesce(v_prev, ''), true);

    -- NEW carries the main item as it now stands.
    SELECT ti.entity_id INTO v_after
      FROM public.task_items ti
     WHERE ti.task_id = NEW.id AND ti.entity_type = v_kind
     ORDER BY ti.position, ti.created_at, ti.id
     LIMIT 1;
    IF NOT FOUND THEN
      v_after := NULL;
    END IF;
    IF v_kind = 'asset' THEN
      NEW.asset_id := v_after;
    ELSIF v_kind = 'scene' THEN
      NEW.scene_id := v_after;
    ELSE
      NEW.shot_id := v_after;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

-- ── 7c. tasks → task_items, on a new task ──────────────────────────────────
-- AFTER INSERT (the item's FK needs the task row): each single column set on
-- the new task becomes its kind's first item. An upsert that lands on an
-- existing row is an UPDATE and goes through 7b instead.

CREATE OR REPLACE FUNCTION public.fn_tasks_seed_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_prev TEXT := current_setting('wilson.task_items_sync', true);
BEGIN
  IF v_prev = 'on' OR (NEW.asset_id IS NULL AND NEW.scene_id IS NULL AND NEW.shot_id IS NULL) THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('wilson.task_items_sync', 'on', true);
  INSERT INTO public.task_items (task_id, project_id, entity_type, entity_id, position)
  SELECT NEW.id, NEW.project_id, k.kind, k.eid, 0
    FROM (VALUES ('asset', NEW.asset_id), ('scene', NEW.scene_id), ('shot', NEW.shot_id)) AS k(kind, eid)
   WHERE k.eid IS NOT NULL
  ON CONFLICT (task_id, entity_type, entity_id) DO NOTHING;
  PERFORM set_config('wilson.task_items_sync', coalesce(v_prev, ''), true);
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_task_items_sync_task() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_tasks_sync_items()     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_tasks_seed_items()     FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_task_items_sync_task ON public.task_items;
CREATE TRIGGER trg_task_items_sync_task
  AFTER INSERT OR UPDATE OR DELETE ON public.task_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_task_items_sync_task();

DROP TRIGGER IF EXISTS trg_tasks_sync_items ON public.tasks;
CREATE TRIGGER trg_tasks_sync_items
  BEFORE UPDATE OF asset_id, scene_id, shot_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.fn_tasks_sync_items();

DROP TRIGGER IF EXISTS trg_tasks_seed_items ON public.tasks;
CREATE TRIGGER trg_tasks_seed_items
  AFTER INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.fn_tasks_seed_items();

COMMENT ON FUNCTION public.fn_task_items_sync_task() IS
  '0096 (FX2): after an asset, scene or shot item changes, the task''s single column of that kind is set to its main item (first by position, created_at, id). SECURITY INVOKER; skipped while wilson.task_items_sync = on (the other direction is writing).';
COMMENT ON FUNCTION public.fn_tasks_sync_items() IS
  '0096 (FX2): a write of tasks.asset_id / scene_id / shot_id changes the items — an existing item moves first, a new id replaces the main item, a cleared column removes it — and NEW carries the main item after. SECURITY INVOKER; skipped while wilson.task_items_sync = on.';
COMMENT ON FUNCTION public.fn_tasks_seed_items() IS
  '0096 (FX2): a new task''s single columns become its first items. SECURITY INVOKER; skipped while wilson.task_items_sync = on.';


-- =============================================================================
-- 8. BACKFILL — every existing link, as position 0 of its kind
-- =============================================================================
-- Every task, trashed and set aside included (a restore or a bring-back finds
-- its items). An asset link to another project's asset (0000's FK was plain)
-- cannot be an item — the composite key refuses it — so it is skipped and
-- counted; its single column is left as it is, and 7a never clears a column
-- of a kind the task has no item for. Run with the sync marked on: the
-- columns already say what the items will.

DO $$
DECLARE
  v_prev  TEXT := current_setting('wilson.task_items_sync', true);
  v_a INT; v_s INT; v_h INT; v_x INT;
BEGIN
  PERFORM set_config('wilson.task_items_sync', 'on', true);

  INSERT INTO public.task_items (task_id, project_id, entity_type, entity_id, position, created_by)
  SELECT t.id, t.project_id, 'asset', t.asset_id, 0, t.created_by
    FROM public.tasks t
   WHERE t.asset_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = t.asset_id AND a.project_id = t.project_id)
  ON CONFLICT (task_id, entity_type, entity_id) DO NOTHING;
  GET DIAGNOSTICS v_a = ROW_COUNT;

  INSERT INTO public.task_items (task_id, project_id, entity_type, entity_id, position, created_by)
  SELECT t.id, t.project_id, 'scene', t.scene_id, 0, t.created_by
    FROM public.tasks t
   WHERE t.scene_id IS NOT NULL
  ON CONFLICT (task_id, entity_type, entity_id) DO NOTHING;
  GET DIAGNOSTICS v_s = ROW_COUNT;

  INSERT INTO public.task_items (task_id, project_id, entity_type, entity_id, position, created_by)
  SELECT t.id, t.project_id, 'shot', t.shot_id, 0, t.created_by
    FROM public.tasks t
   WHERE t.shot_id IS NOT NULL
  ON CONFLICT (task_id, entity_type, entity_id) DO NOTHING;
  GET DIAGNOSTICS v_h = ROW_COUNT;

  SELECT count(*) INTO v_x
    FROM public.tasks t
   WHERE t.asset_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.assets a WHERE a.id = t.asset_id AND a.project_id = t.project_id);

  PERFORM set_config('wilson.task_items_sync', coalesce(v_prev, ''), true);
  RAISE NOTICE '0096 backfill: % asset, % scene, % shot item(s) made; % asset link(s) to another project''s asset skipped (left on tasks.asset_id)', v_a, v_s, v_h, v_x;
END $$;


-- =============================================================================
-- 9. REALTIME — task_items joins the project_id arm (sixteen tables)
-- =============================================================================
-- 0091's body of fn_realtime_broadcast (0092 left it unchanged and said so),
-- reproduced WHOLE — Postgres has no "add an arm" — with task_items joining
-- the plain project_id arm: it has its own project_id. Every other arm is
-- untouched; §10 asserts each of the SIXTEEN names appears exactly once (the
-- 0077 §3d invariant: CASE takes the first match) and the files money arm is
-- 0088's. Attached AFTER the backfill, so the backfill broadcasts nothing.

CREATE OR REPLACE FUNCTION public.fn_realtime_broadcast()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     JSONB;
  v_project UUID;
BEGIN
  -- Environments without the realtime schema (db-only CI stack) skip
  -- silently. Probes for the FUNCTION, not just the schema — a stack carrying
  -- the schema without broadcast_changes would pass a schema-only check and
  -- then raise a WARNING on every single write.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'realtime' AND p.proname = 'broadcast_changes'
  ) THEN
    RETURN NULL;
  END IF;

  -- PG14+: the unassigned side of NEW/OLD reads as NULL in row triggers.
  v_row := COALESCE(to_jsonb(NEW), to_jsonb(OLD));

  CASE TG_TABLE_NAME
    WHEN 'projects' THEN
      v_project := (v_row ->> 'id')::uuid;
    -- 0077: milestones joins this arm. It has its own project_id (0067).
    -- 0091: bins, bin_files and shot_takes join it too (B7: a flag or a take
    -- appears for everyone without reloading).
    -- 0096: task_items joins it (FX2: an item added to a task appears for
    -- everyone without reloading).
    WHEN 'phases', 'assets', 'tasks', 'project_members', 'milestones',
         'bins', 'bin_files', 'shot_takes', 'task_items' THEN
      v_project := (v_row ->> 'project_id')::uuid;
    -- 0088: files has its own arm. A money row — the flag or a locked folder,
    -- on either side of the write — is never put on the project channel.
    WHEN 'files' THEN
      IF public.file_row_is_money((to_jsonb(NEW) ->> 'is_financial')::boolean,
                                  to_jsonb(NEW) ->> 'storage_path')
         OR public.file_row_is_money((to_jsonb(OLD) ->> 'is_financial')::boolean,
                                     to_jsonb(OLD) ->> 'storage_path') THEN
        RETURN NULL;
      END IF;
      v_project := (v_row ->> 'project_id')::uuid;
    WHEN 'comments' THEN
      v_project := public.fn_comment_project_id(
        v_row ->> 'entity_type', (v_row ->> 'entity_id')::uuid);
    WHEN 'task_dependencies' THEN
      SELECT t.project_id INTO v_project FROM public.tasks t
       WHERE t.id = (v_row ->> 'predecessor_id')::uuid;
    -- 0061: the phase sibling. Resolves through phases, not tasks.
    WHEN 'phase_dependencies' THEN
      SELECT ph.project_id INTO v_project FROM public.phases ph
       WHERE ph.id = (v_row ->> 'predecessor_id')::uuid;
    WHEN 'task_links' THEN
      SELECT t.project_id INTO v_project FROM public.tasks t
       WHERE t.id = (v_row ->> 'task_id')::uuid;
    WHEN 'asset_versions' THEN
      SELECT a.project_id INTO v_project FROM public.assets a
       WHERE a.id = (v_row ->> 'asset_id')::uuid;
    ELSE
      v_project := NULL;
  END CASE;

  -- Unroutable (cascade delete with the parent already gone, dead-end comment
  -- walk): skip. The subtree's own parent event already told clients
  -- everything they need.
  IF v_project IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM realtime.broadcast_changes(
    'rabbit:project:' || v_project::text,
    TG_OP, TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD
  );

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Same resilience contract as fn_edit_history_capture (0012): a broadcast
  -- failure NEVER aborts the user's write. A missed event degrades to the
  -- reconnect refetch path on the client. (And a money test that raises
  -- broadcasts nothing: the arm above fails closed.)
  RAISE WARNING 'realtime broadcast failed for %.% (%): %',
    TG_TABLE_NAME, v_row ->> 'id', TG_OP, SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_realtime_broadcast() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_task_items_realtime ON public.task_items;
CREATE TRIGGER trg_task_items_realtime
  AFTER INSERT OR UPDATE OR DELETE ON public.task_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_realtime_broadcast();

COMMENT ON FUNCTION public.fn_realtime_broadcast() IS
  'Session 7 (0016): publishes every write on the project-scoped RABBIT tables to the private topic rabbit:project:{project_id} via realtime.broadcast_changes. Full old/new rows — soft deletes and restores deliver, unlike postgres_changes under the 0014 SELECT policies. Never aborts the write. SIXTEEN tables as of 0096: projects, phases, assets, tasks, files (0088: money rows excluded), comments, task_dependencies, phase_dependencies (0061), task_links, asset_versions, project_members, milestones (0077), bins, bin_files, shot_takes (0091), task_items (0096).';


-- =============================================================================
-- 10. POST-CONDITIONS — scan the catalogue, do not assume (S22)
-- =============================================================================

DO $$
DECLARE
  t        TEXT;
  v_n      INT;
  v_body   TEXT;
  v_hits   INT;
  v_def    TEXT;
BEGIN
  -- 10a. the table: RLS enabled + forced, exactly four policies, none FOR ALL.
  IF to_regclass('public.task_items') IS NULL THEN
    RAISE EXCEPTION '0096 post-condition failed: public.task_items is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.task_items'::regclass
                    AND relrowsecurity AND relforcerowsecurity) THEN
    RAISE EXCEPTION '0096 post-condition failed: task_items lacks ENABLE+FORCE row level security';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'task_items';
  IF v_n <> 4 THEN
    RAISE EXCEPTION '0096 post-condition failed: task_items has % policies, expected 4 (select, insert, update, delete)', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'task_items'
                AND (cmd = 'ALL' OR permissive <> 'PERMISSIVE')) THEN
    RAISE EXCEPTION '0096 post-condition failed: task_items has a FOR ALL or a restrictive policy';
  END IF;

  -- 10b. every policy hops to projects AND tasks; every write policy carries
  --      the workspace, the membership and can_write_project; UPDATE's check
  --      is its USING, arm for arm (0062: a rewritten policy that drops an
  --      arm is a privilege escalation, so each arm is named).
  FOR t IN SELECT cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'task_items' LOOP
    SELECT COALESCE(qual, '') || ' ' || COALESCE(with_check, '') INTO v_def
      FROM pg_policies WHERE schemaname = 'public' AND tablename = 'task_items' AND cmd = t;
    IF position('current_workspace_id()' IN v_def) = 0
       OR v_def !~ 'FROM projects p\s+WHERE \(p\.id = task_items\.project_id\)'
       OR v_def !~ 'FROM tasks t\s+WHERE \(t\.id = task_items\.task_id\)' THEN
      RAISE EXCEPTION '0096 post-condition failed: the % policy on task_items lacks the workspace arm or a hop (projects, tasks): %', t, v_def;
    END IF;
    IF t <> 'SELECT' AND (position('has_active_membership(workspace_id)' IN v_def) = 0
                          OR position('can_write_project(project_id)' IN v_def) = 0) THEN
      RAISE EXCEPTION '0096 post-condition failed: the % policy on task_items lacks has_active_membership or can_write_project', t;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'task_items'
                AND cmd = 'UPDATE' AND (qual IS NULL OR with_check IS NULL OR qual <> with_check)) THEN
    RAISE EXCEPTION '0096 post-condition failed: task_items_update''s WITH CHECK is not its USING';
  END IF;

  -- 10c. privileges: anon / PUBLIC nothing; authenticated SELECT, INSERT,
  --      DELETE and UPDATE of position only.
  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
              WHERE table_schema = 'public' AND table_name = 'task_items' AND grantee IN ('anon', 'PUBLIC'))
     OR EXISTS (SELECT 1 FROM information_schema.column_privileges
                 WHERE table_schema = 'public' AND table_name = 'task_items' AND grantee IN ('anon', 'PUBLIC')) THEN
    RAISE EXCEPTION '0096 post-condition failed: anon or PUBLIC holds a privilege on task_items';
  END IF;
  IF NOT (has_table_privilege('authenticated', 'public.task_items', 'SELECT')
          AND has_table_privilege('authenticated', 'public.task_items', 'INSERT')
          AND has_table_privilege('authenticated', 'public.task_items', 'DELETE')) THEN
    RAISE EXCEPTION '0096 post-condition failed: authenticated lacks SELECT, INSERT or DELETE on task_items';
  END IF;
  IF has_table_privilege('authenticated', 'public.task_items', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.task_items', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.task_items', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.task_items', 'TRIGGER') THEN
    RAISE EXCEPTION '0096 post-condition failed: authenticated holds a table-wide UPDATE, TRUNCATE, REFERENCES or TRIGGER on task_items';
  END IF;
  FOREACH t IN ARRAY ARRAY['task_id', 'project_id', 'workspace_id', 'entity_type', 'entity_id',
                           'created_at', 'created_by', 'updated_at', 'updated_by'] LOOP
    IF has_column_privilege('authenticated', 'public.task_items', t, 'UPDATE') THEN
      RAISE EXCEPTION '0096 post-condition failed: authenticated may UPDATE task_items.%', t;
    END IF;
  END LOOP;
  IF NOT has_column_privilege('authenticated', 'public.task_items', 'position', 'UPDATE') THEN
    RAISE EXCEPTION '0096 post-condition failed: authenticated may not UPDATE task_items.position (the reorder)';
  END IF;

  -- 10d. the keys: the six composite FKs, each CASCADE on delete, plus the
  --      workspace pair; the unique (task, kind, entity); the generated five.
  FOREACH t IN ARRAY ARRAY['task', 'asset', 'scene', 'shot', 'level', 'experience'] LOOP
    SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
     WHERE conrelid = 'public.task_items'::regclass AND conname = 'task_items_' || t || '_fk';
    IF v_def IS NULL
       OR v_def NOT LIKE '%, project_id) REFERENCES %(id, project_id) ON DELETE CASCADE%' THEN
      RAISE EXCEPTION '0096 post-condition failed: task_items_%_fk is not a same-project (id, project_id) key with ON DELETE CASCADE: %', t, v_def;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.task_items'::regclass
                    AND conname = 'task_items_project_workspace_fk' AND contype = 'f')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.task_items'::regclass
                    AND conname = 'task_items_task_entity_key' AND contype = 'u'
                    AND pg_get_constraintdef(oid) = 'UNIQUE (task_id, entity_type, entity_id)') THEN
    RAISE EXCEPTION '0096 post-condition failed: the workspace pair key or the unique (task_id, entity_type, entity_id) is missing';
  END IF;
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'task_items'
     AND column_name IN ('asset_id', 'scene_id', 'shot_id', 'level_id', 'experience_id')
     AND is_generated = 'ALWAYS';
  IF v_n <> 5 THEN
    RAISE EXCEPTION '0096 post-condition failed: % of the five typed columns are GENERATED ALWAYS, expected 5', v_n;
  END IF;

  -- 10e. the triggers: stamp, audit, the two directions, the seed, realtime.
  FOREACH t IN ARRAY ARRAY['trg_task_items_populate_workspace', 'trg_task_items_audit',
                           'trg_task_items_sync_task', 'trg_task_items_realtime'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.task_items'::regclass
                      AND tgname = t AND NOT tgisinternal) THEN
      RAISE EXCEPTION '0096 post-condition failed: % is not attached to task_items', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['trg_tasks_sync_items', 'trg_tasks_seed_items'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.tasks'::regclass
                      AND tgname = t AND NOT tgisinternal) THEN
      RAISE EXCEPTION '0096 post-condition failed: % is not attached to tasks', t;
    END IF;
  END LOOP;

  -- 10f. the functions: every one SECURITY INVOKER (they grant nothing);
  --      reorder executable by authenticated and not by anon; the three
  --      trigger functions by no client.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.prosecdef
                AND p.proname IN ('reorder_task_items', 'fn_task_items_sync_task',
                                  'fn_tasks_sync_items', 'fn_tasks_seed_items')) THEN
    RAISE EXCEPTION '0096 post-condition failed: a 0096 function is SECURITY DEFINER';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.reorder_task_items(uuid, text, uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.reorder_task_items(uuid, text, uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION '0096 post-condition failed: reorder_task_items is not authenticated-only';
  END IF;
  FOREACH t IN ARRAY ARRAY['public.fn_task_items_sync_task()', 'public.fn_tasks_sync_items()',
                           'public.fn_tasks_seed_items()'] LOOP
    IF has_function_privilege('authenticated', t, 'EXECUTE') OR has_function_privilege('anon', t, 'EXECUTE') THEN
      RAISE EXCEPTION '0096 post-condition failed: % is executable by a client role', t;
    END IF;
  END LOOP;

  -- 10g. the realtime body: every one of the sixteen names exactly once
  --      (comments stripped first — 0077 §3c), every trigger attached, and
  --      0088's money arm for files kept.
  v_body := pg_get_functiondef('public.fn_realtime_broadcast()'::regprocedure);
  v_body := regexp_replace(v_body, '/\*.*?\*/', '', 'gs');
  v_body := regexp_replace(v_body, '--[^' || chr(10) || ']*', '', 'g');
  FOREACH t IN ARRAY ARRAY['projects', 'phases', 'assets', 'tasks', 'files',
                           'comments', 'task_dependencies', 'phase_dependencies',
                           'task_links', 'asset_versions', 'project_members',
                           'milestones', 'bins', 'bin_files', 'shot_takes',
                           'task_items'] LOOP
    v_hits := (length(v_body) - length(replace(v_body, '''' || t || '''', ''))) / length('''' || t || '''');
    IF v_hits <> 1 THEN
      RAISE EXCEPTION '0096 post-condition failed: fn_realtime_broadcast names % % times (expected exactly 1)', t, v_hits;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = ('public.' || quote_ident(t))::regclass
                      AND tgname = 'trg_' || t || '_realtime') THEN
      RAISE EXCEPTION '0096 post-condition failed: trg_%_realtime is not attached', t;
    END IF;
  END LOOP;
  IF v_body NOT LIKE '%file_row_is_money((to_jsonb(NEW)%' OR v_body NOT LIKE '%file_row_is_money((to_jsonb(OLD)%' THEN
    RAISE EXCEPTION '0096 post-condition failed: fn_realtime_broadcast lost 0088''s money arm for files (both NEW and OLD)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'fn_realtime_broadcast' AND p.prosecdef) THEN
    RAISE EXCEPTION '0096 post-condition failed: fn_realtime_broadcast is no longer SECURITY DEFINER';
  END IF;

  -- 10h. the data: every same-project single column has its item, and every
  --      task's single column of a kind it has items for IS its main item.
  SELECT count(*) INTO v_n
    FROM public.tasks t
   WHERE (t.asset_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = t.asset_id AND a.project_id = t.project_id)
          AND NOT EXISTS (SELECT 1 FROM public.task_items i
                           WHERE i.task_id = t.id AND i.entity_type = 'asset' AND i.entity_id = t.asset_id))
      OR (t.scene_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.task_items i
                           WHERE i.task_id = t.id AND i.entity_type = 'scene' AND i.entity_id = t.scene_id))
      OR (t.shot_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.task_items i
                           WHERE i.task_id = t.id AND i.entity_type = 'shot' AND i.entity_id = t.shot_id));
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0096 post-condition failed: % task(s) carry a same-project single link with no item', v_n;
  END IF;
  SELECT count(*) INTO v_n
    FROM public.tasks t
    JOIN LATERAL (
      SELECT k.kind,
             (SELECT i.entity_id FROM public.task_items i
               WHERE i.task_id = t.id AND i.entity_type = k.kind
               ORDER BY i.position, i.created_at, i.id LIMIT 1) AS main,
             CASE k.kind WHEN 'asset' THEN t.asset_id WHEN 'scene' THEN t.scene_id ELSE t.shot_id END AS col
        FROM (VALUES ('asset'), ('scene'), ('shot')) AS k(kind)
    ) m ON true
   WHERE m.main IS NOT NULL AND m.col IS DISTINCT FROM m.main;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0096 post-condition failed: % (task, kind) pair(s) whose single column is not the main item', v_n;
  END IF;

  RAISE NOTICE '0096 OK: task_items under RLS (four policies, each hopping to projects and tasks), position-only UPDATE, six same-project CASCADE keys; the single columns in step both ways; reorder_task_items invoker; fn_realtime_broadcast names sixteen tables';
END $$;
