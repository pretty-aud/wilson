-- =============================================================================
-- 0097_no_main_item.sql — VW1m (post-overhaul, the custom views' first build
-- session, 2026-10-16): a task's items are its items. No item of a kind
-- counts for more than another, and deleting an asset never deletes a task.
--
-- Audrey (2026-10-16, docs/design/CUSTOM_VIEWS_QUESTIONS.md batch 12): "lets
-- not have main asset be a thing. thats not needed and i dont like." Batch
-- 13, deleting an asset that tasks are linked to: "The tasks stay
-- (Recommended)". Batch 14, a task whose asset is in the trash: "Hidden,
-- back on restore (Recommended)" (the client hides the item; the database
-- keeps the task visible and its item rows in place).
--
-- WHAT THIS CHANGES (docs/sessions/handoffs/po-vw1m-2026-10-16.md, item 2)
--   §1 tasks.asset_id's foreign key becomes ON DELETE SET NULL (it was
--      CASCADE since 0000, kept by 0034: "a task scoped to a deliverable dies
--      with it"). Found BY CATALOGUE: Postgres named it in 0000 and no file
--      names it. The purge (purge_soft_deleted, 0067) then takes an asset off
--      its tasks and leaves them, a set-aside task included (0090's promise
--      that a set-aside task is never purged).
--   §2 tasks_select hops to the task's OWN project for every task. 0034's
--      asset arm is gone: a task stays visible while its asset is in the
--      trash, and privacy and the trashed-project rule come through
--      projects_select (0014's live arm, 0072's privacy arm). That also
--      closes a hole: a task naming another project's asset (0000's key was
--      plain) was judged by THAT project's privacy.
--   §3 fn_tasks_sync_items (0096 §7b) is ADD-ONLY. An older app (FX2's, on
--      staging and the beta) writes one asset, scene or shot through the
--      task's single column; its write now ADDS that item at the end of its
--      kind, a cleared column removes only the item it named, and nothing is
--      ever moved or replaced.
--   §4 fn_task_items_sync_task (0096 §7a) is restated as the writer of the
--      older apps' COPY: tasks.asset_id / scene_id / shot_id hold the first
--      item of their kind in the stored order (position, created_at, id),
--      for apps older than 0097 only. This app reads a task's items.
--   §5 fn_tasks_seed_items (0096 §7c) is kept as it is: a new task's single
--      columns still become its items (templates, older apps).
--   §6 the comments on the columns, the table and the three functions are
--      re-said: nothing in the catalogue calls an item "main" any more.
--   §7 post-conditions, scanned from the catalogue.
--
-- NOT HERE, ON PURPOSE
--   * 0096 is never edited (staging carries it since 2026-10-12, and the
--     beta's FX2 app writes through its triggers): every change to a function
--     it made is a CREATE OR REPLACE here, the same trigger names kept.
--   * fn_realtime_broadcast is NOT restated (0096 §9's body stands, so 0096's
--     re-run guard and post-conditions still hold; §7 checks it is untouched).
--   * No history of a task's items (her answer to Q-N8 is pending; the
--     interim records nothing new).
--   * tasks_insert / tasks_update still lack the private-project hop
--     (docs/OUTSTANDING.md since 0082; a privacy fix with its own review).
--     The add-only insert in §3 runs as the caller under task_items_insert,
--     which hops to the project, so an older app cannot reach a private
--     project's items through the column either.
--   * The columns stay. Dropping them would break every older app's save.
--
-- ORDERING: needs 0034 (tasks_select's shape §0 recognises), 0084 (tasks
--   scene_id / shot_id) and 0096 (task_items and its three sync triggers).
--   Refuses to run otherwise.
-- Number: 0097 / suite 100 (supabase/tests/rls/100_no_main_item.sql), the
--   first three-digit suite (rls.yml's coverage guard and replay list and
--   scripts/tap-all.mjs were taught three digits with it, each shown failing
--   on its old form first).
-- Idempotent: the FK is changed only while its delete action is not SET
--   NULL; the policy is DROP-then-CREATE; the functions are CREATE OR
--   REPLACE. Safe to re-run, but never AFTER a later migration (§0 refuses),
--   and never under a tasks_select that a later migration restated (§0
--   refuses: re-running would take its change back). 0034 calls itself "safe
--   to re-run": re-running it after this file would put the asset arm back,
--   so never re-run 0034.
-- =============================================================================


-- =============================================================================
-- 0. PRE-FLIGHT
-- =============================================================================
DO $$
BEGIN
  IF to_regclass('public.task_items') IS NULL THEN
    RAISE EXCEPTION '0097 pre-flight failed: public.task_items is missing — apply 0096 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'shot_id') THEN
    RAISE EXCEPTION '0097 pre-flight failed: tasks.scene_id / shot_id are missing — apply 0084 first';
  END IF;
  IF to_regprocedure('public.fn_task_items_sync_task()') IS NULL
     OR to_regprocedure('public.fn_tasks_sync_items()') IS NULL
     OR to_regprocedure('public.fn_tasks_seed_items()') IS NULL THEN
    RAISE EXCEPTION '0097 pre-flight failed: one of 0096''s sync functions (fn_task_items_sync_task, fn_tasks_sync_items, fn_tasks_seed_items) is missing — apply 0096 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.task_items'::regclass
                    AND tgname = 'trg_task_items_sync_task' AND NOT tgisinternal
                    AND tgfoid = 'public.fn_task_items_sync_task()'::regprocedure)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.tasks'::regclass
                    AND tgname = 'trg_tasks_sync_items' AND NOT tgisinternal
                    AND tgfoid = 'public.fn_tasks_sync_items()'::regprocedure)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.tasks'::regclass
                    AND tgname = 'trg_tasks_seed_items' AND NOT tgisinternal
                    AND tgfoid = 'public.fn_tasks_seed_items()'::regprocedure) THEN
    RAISE EXCEPTION '0097 pre-flight failed: one of 0096''s sync triggers (trg_task_items_sync_task, trg_tasks_sync_items, trg_tasks_seed_items) is not attached to its function — apply 0096 first';
  END IF;
END $$;


-- A re-run must not take back a later migration's change, and §2 must not
-- replace a tasks_select some later migration wrote. tasks_select is compared
-- by its text with `public.` and runs of white space taken out (pg_policies
-- deparses through the search_path, and a deparse wraps lines), against
-- 0034's shape (the first run) and §2's own (a re-run). §7 holds §2's text to
-- the same constant, so an edit of §2 must carry its new text here.
DO $$
DECLARE
  v_qual   TEXT;
  v_later  BOOLEAN := false;
  v_rerun  BOOLEAN;
  c_0034   CONSTANT TEXT := '((deleted_at IS NULL) AND (workspace_id = current_workspace_id()) AND ((EXISTS ( SELECT 1 FROM assets a WHERE (a.id = tasks.asset_id))) OR ((asset_id IS NULL) AND (EXISTS ( SELECT 1 FROM projects p WHERE (p.id = tasks.project_id))))))';
  c_0097   CONSTANT TEXT := '((deleted_at IS NULL) AND (workspace_id = current_workspace_id()) AND (EXISTS ( SELECT 1 FROM projects p WHERE (p.id = tasks.project_id))))';
BEGIN
  SELECT regexp_replace(regexp_replace(qual, 'public\.', '', 'g'), '\s+', ' ', 'g') INTO v_qual
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'tasks' AND policyname = 'tasks_select' AND cmd = 'SELECT';
  IF v_qual IS NULL THEN
    RAISE EXCEPTION '0097 pre-flight failed: tasks has no tasks_select policy (0034''s) — apply 0034 first';
  END IF;
  IF v_qual IS DISTINCT FROM c_0034 AND v_qual IS DISTINCT FROM c_0097 THEN
    RAISE EXCEPTION '0097 pre-flight failed: tasks_select is neither 0034''s nor this file''s (%) — a later migration restated it, and restating it here would take that change back', v_qual;
  END IF;

  -- A re-run: §2's policy is in place, or §1's key already sets NULL.
  v_rerun := v_qual = c_0097
          OR EXISTS (SELECT 1 FROM pg_constraint c
                       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attname = 'asset_id'
                      WHERE c.conrelid = 'public.tasks'::regclass AND c.contype = 'f'
                        AND c.confrelid = 'public.assets'::regclass
                        AND c.conkey = ARRAY[a.attnum]::int2[]
                        AND c.confdeltype = 'n');
  IF v_rerun AND to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version > $1)'
      INTO v_later USING '0097';
    IF v_later THEN
      RAISE EXCEPTION '0097 pre-flight failed: a migration after 0097 is recorded — re-running 0097 would take back its changes to tasks_select or to the sync functions';
    END IF;
  END IF;
END $$;


-- =============================================================================
-- 1. tasks.asset_id — ON DELETE SET NULL (her ruling: the tasks stay)
-- =============================================================================
-- 0000 declared the key inline (`asset_id UUID REFERENCES assets(id) ON
-- DELETE CASCADE`), so Postgres named it and no migration does: it is found
-- by what it is (on tasks, a foreign key, to assets, on asset_id alone).
-- Dropped and added again in ONE ALTER under the same name, so a fresh
-- database and a long-lived one carry the same name. Plain, as 0000's was:
-- making it same-project would refuse the pre-0096 links to another
-- project's asset that 0096's backfill counted and left (suite 99's T6).
-- When it already sets NULL (a re-run), nothing is touched.
--
-- With SET NULL, deleting an asset (the purge, or any hard delete) runs
-- `UPDATE tasks SET asset_id = NULL` on its tasks as the tables' owner; that
-- UPDATE goes through §3, which takes the asset's item off (when the item's
-- own cascade has not already) and gives the column the next asset in the
-- stored order. task_items_asset_fk (0096 §2, CASCADE) is untouched: an
-- asset's delete still takes its item off every task.

DO $$
DECLARE
  v_name TEXT;
  v_del  "char";
  v_n    INT;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attname = 'asset_id'
   WHERE c.conrelid = 'public.tasks'::regclass AND c.contype = 'f'
     AND c.confrelid = 'public.assets'::regclass
     AND c.conkey = ARRAY[a.attnum]::int2[];
  IF v_n > 1 THEN
    RAISE EXCEPTION '0097 §1 failed: tasks carries % foreign keys from asset_id to assets, expected one', v_n;
  END IF;

  SELECT c.conname, c.confdeltype INTO v_name, v_del
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attname = 'asset_id'
   WHERE c.conrelid = 'public.tasks'::regclass AND c.contype = 'f'
     AND c.confrelid = 'public.assets'::regclass
     AND c.conkey = ARRAY[a.attnum]::int2[];

  IF v_name IS NULL THEN
    -- No key at all (never seen on a real database): add the one 0000 would
    -- have, under the name Postgres gives it.
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_asset_id_fkey FOREIGN KEY (asset_id)
      REFERENCES public.assets (id) ON DELETE SET NULL;
  ELSIF v_del <> 'n' THEN
    EXECUTE format(
      'ALTER TABLE public.tasks DROP CONSTRAINT %1$I, '
      'ADD CONSTRAINT %1$I FOREIGN KEY (asset_id) REFERENCES public.assets (id) ON DELETE SET NULL',
      v_name);
  END IF;
END $$;


-- =============================================================================
-- 2. tasks_select — the task's own project, for every task
-- =============================================================================
-- DROP then CREATE, never a second permissive policy beside it (permissive
-- policies OR together: the old one would stay in force; S15's CRITICAL).
-- Every arm restated (the 0062 lesson; suite 100 proves each under a login):
--   * deleted_at IS NULL — a trashed task stays hidden;
--   * workspace_id = current_workspace_id() — another workspace sees nothing;
--   * the project hop, under the caller's RLS — projects_select carries the
--     live-project arm (0014: a trashed project hides its tasks) and the
--     privacy arm (0072: a private project's tasks are hidden from a seat
--     that cannot see it), as 0034's asset-less arm already did.
-- What leaves: 0034's asset arm. A task with an asset was judged through
-- assets_select, so a trashed asset hid every task naming it, and a task
-- naming ANOTHER project's asset was judged by that project. Neither stands
-- (her ruling; the client hides an asset in the trash from its tasks, Q-N4).

DROP POLICY IF EXISTS tasks_select ON public.tasks;
CREATE POLICY tasks_select ON public.tasks
  FOR SELECT USING (
    deleted_at IS NULL
    AND workspace_id = public.current_workspace_id()
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = tasks.project_id)
  );


-- =============================================================================
-- 3. fn_tasks_sync_items — an older app's single-column write ADDS (0096 §7b)
-- =============================================================================
-- Same trigger (trg_tasks_sync_items, BEFORE UPDATE OF asset_id, scene_id,
-- shot_id), same setting (`wilson.task_items_sync`: while it is 'on' the
-- other direction is writing and this does nothing), same SECURITY INVOKER.
-- For each kind whose column the UPDATE changes (OLD → NEW):
--   * NEW IS NULL                     → the item for OLD is removed, and only
--                                       that one (after an entity's cascade
--                                       it is already gone);
--   * NEW is an item the task has     → nothing: no item moves (what opening
--                                       an older bid version sends);
--   * NEW is not an item of the task  → it is ADDED at the end of its kind
--                                       (the kind's last position + 1,
--                                       capped at INTEGER's largest), and the
--                                       item for OLD stays.
-- Nothing ever moves and nothing is replaced. Then NEW carries the first item
-- of the kind in the stored order (position, created_at, id): the older apps'
-- copy. So an older app that writes asset B over a task holding A reads A
-- back, and the task holds A and B. The insert carries the task's project, so
-- task_items' composite key still refuses another project's asset (suite
-- 99's #48, #49); it runs as the caller, under task_items_insert.

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
  v_first  UUID;
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

    PERFORM set_config('wilson.task_items_sync', 'on', true);
    IF v_new IS NULL THEN
      DELETE FROM public.task_items
       WHERE task_id = NEW.id AND entity_type = v_kind AND entity_id = v_old;
    ELSIF NOT EXISTS (SELECT 1 FROM public.task_items
                       WHERE task_id = NEW.id AND entity_type = v_kind AND entity_id = v_new) THEN
      -- At the end of its kind; an aggregate always returns one row, so a
      -- kind with no item yet starts at 0.
      INSERT INTO public.task_items (task_id, project_id, entity_type, entity_id, position)
      SELECT NEW.id, NEW.project_id, v_kind, v_new,
             LEAST(COALESCE(max(x.position)::bigint + 1, 0), 2147483647)::int
        FROM public.task_items x
       WHERE x.task_id = NEW.id AND x.entity_type = v_kind;
    END IF;
    PERFORM set_config('wilson.task_items_sync', coalesce(v_prev, ''), true);

    -- NEW carries the older apps' copy: the first item in the stored order.
    SELECT ti.entity_id INTO v_first
      FROM public.task_items ti
     WHERE ti.task_id = NEW.id AND ti.entity_type = v_kind
     ORDER BY ti.position, ti.created_at, ti.id
     LIMIT 1;
    IF NOT FOUND THEN
      v_first := NULL;
    END IF;
    IF v_kind = 'asset' THEN
      NEW.asset_id := v_first;
    ELSIF v_kind = 'scene' THEN
      NEW.scene_id := v_first;
    ELSE
      NEW.shot_id := v_first;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_tasks_sync_items() FROM PUBLIC, anon, authenticated;


-- =============================================================================
-- 4. fn_task_items_sync_task — the writer of the older apps' copy (0096 §7a)
-- =============================================================================
-- 0096's logic, restated with its words: after an insert, update or delete
-- of an asset, scene or shot item, the task's single column of THAT kind is
-- set to the first item of that kind in the stored order, when it differs.
-- The column is a copy for apps older than 0097; this app never reads it.
-- Only that kind: a column this table holds no item for (a link made before
-- 0096 to another project's asset) is never cleared by an unrelated write.
--
-- The row lock is kept (0096 review round 1, R1-5): two writers of one task's
-- items each read the first item from their own snapshot, so without it the
-- later commit could leave the copy naming an item the task no longer has.
--
-- 🚨 The gone arm is kept: a DELETE whose entity row is GONE is left alone.
-- That is a foreign-key cascade from the entity's own delete, and the task's
-- column has its own rule for it: ON DELETE SET NULL for every kind since
-- §1 (scenes and shots since 0084). That UPDATE goes through §3, which takes
-- the item off (if this cascade has not yet) and gives the column the next
-- item in the stored order, whichever order Postgres fires the two in. One
-- writer per delete, so the task's column is written once.

CREATE OR REPLACE FUNCTION public.fn_task_items_sync_task()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_prev   TEXT := current_setting('wilson.task_items_sync', true);
  v_task   UUID;
  v_kind   TEXT;
  v_first  UUID;
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
    -- The task row first (R1-5): FOR NO KEY UPDATE makes a second writer of
    -- this task's items wait for the first to commit, and READ COMMITTED
    -- gives the SELECT below a fresh snapshot. NO KEY: the items' foreign key
    -- takes KEY SHARE on the task, which this does not block. (A row the
    -- caller cannot update is not locked, and its UPDATE below changes
    -- nothing.)
    PERFORM 1 FROM public.tasks WHERE id = v_task FOR NO KEY UPDATE;
    SELECT ti.entity_id INTO v_first
      FROM public.task_items ti
     WHERE ti.task_id = v_task AND ti.entity_type = v_kind
     ORDER BY ti.position, ti.created_at, ti.id
     LIMIT 1;
    IF NOT FOUND THEN
      v_first := NULL;
    END IF;
    PERFORM set_config('wilson.task_items_sync', 'on', true);
    IF v_kind = 'asset' THEN
      UPDATE public.tasks SET asset_id = v_first WHERE id = v_task AND asset_id IS DISTINCT FROM v_first;
    ELSIF v_kind = 'scene' THEN
      UPDATE public.tasks SET scene_id = v_first WHERE id = v_task AND scene_id IS DISTINCT FROM v_first;
    ELSE
      UPDATE public.tasks SET shot_id = v_first WHERE id = v_task AND shot_id IS DISTINCT FROM v_first;
    END IF;
    PERFORM set_config('wilson.task_items_sync', coalesce(v_prev, ''), true);
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_task_items_sync_task() FROM PUBLIC, anon, authenticated;


-- =============================================================================
-- 5. fn_tasks_seed_items — kept as 0096 §7c wrote it
-- =============================================================================
-- AFTER INSERT on tasks: each single column set on a new task becomes an item
-- of its kind (a template applied to an asset, an older app's new task, the
-- move to the cloud from an older build). Its body says nothing about a main
-- item, so it is not restated; §6 re-says its comment.


-- =============================================================================
-- 6. COMMENTS — re-said; nothing in the catalogue calls an item "main"
-- =============================================================================

COMMENT ON COLUMN public.tasks.asset_id IS
  '0097 (VW1m, 2026-10-16): a COPY for apps older than 0097 — the first asset item of this task in the stored order (task_items.position, created_at, id), kept by fn_task_items_sync_task; an older app''s write of it ADDS that asset (fn_tasks_sync_items) and never removes one. This app reads a task''s items, never this column. NULLABLE since 0034 ("not all tasks need assets"). ON DELETE SET NULL since 0097: deleting an asset never deletes a task (Audrey, 2026-10-16: "The tasks stay").';
COMMENT ON COLUMN public.tasks.scene_id IS
  '0097 (VW1m, 2026-10-16): a COPY for apps older than 0097 — the first scene item of this task in the stored order, kept by fn_task_items_sync_task; an older app''s write of it ADDS that scene and never removes one. This app reads a task''s items. Same-project composite FK, SET NULL when the scene is deleted (0084).';
COMMENT ON COLUMN public.tasks.shot_id IS
  '0097 (VW1m, 2026-10-16): a COPY for apps older than 0097 — the first shot item of this task in the stored order, kept by fn_task_items_sync_task; an older app''s write of it ADDS that shot and never removes one. This app reads a task''s items. Same-project composite FK, SET NULL when the shot is deleted (0084).';

COMMENT ON TABLE public.task_items IS
  '0096 (FX2, 2026-10-11) / 0097 (VW1m, 2026-10-16): the items a task is about — assets, scenes, shots, levels, experiences — one row per (task, item). A task''s items are its items: none counts for more than another (Audrey''s ruling, 2026-10-16). tasks.asset_id / scene_id / shot_id are a copy of the first of each kind in the stored order, for apps older than 0097 (fn_task_items_sync_task, fn_tasks_sync_items, fn_tasks_seed_items). Levels and experiences live only here on the cloud. Every FK is on (id, project_id), CASCADE: an item names only its task''s project''s rows, and a deleted row leaves every task (the task stays). NOT task_links (0000), which holds a task''s URL links.';
COMMENT ON COLUMN public.task_items.position IS
  '0097 (VW1m): the order the items of a kind were added to the task (an older app''s write adds at the end; an older app''s reorder_task_items may renumber a kind). It decides nothing on screen except the Date added sort; the older apps'' copy on tasks reads the first. A tie is broken by created_at, then id.';

COMMENT ON FUNCTION public.fn_task_items_sync_task() IS
  '0096 (FX2) / 0097 (VW1m): after an asset, scene or shot item changes, the task''s single column of that kind is set to the first item of that kind in the stored order (position, created_at, id) — a copy for apps older than 0097. Locks the task row first. A delete cascaded from the entity''s own delete is left to the task''s ON DELETE SET NULL. SECURITY INVOKER; skipped while wilson.task_items_sync = on.';
COMMENT ON FUNCTION public.fn_tasks_sync_items() IS
  '0097 (VW1m, 2026-10-16): an older app''s write of tasks.asset_id / scene_id / shot_id ADDS — a new id becomes an item at the end of its kind, an id the task has changes nothing, a cleared column removes only the item it named; nothing ever moves — and NEW carries the first item in the stored order (the older apps'' copy). SECURITY INVOKER; skipped while wilson.task_items_sync = on.';
COMMENT ON FUNCTION public.fn_tasks_seed_items() IS
  '0096 (FX2) / 0097 (VW1m): a new task''s single columns become its items (a template, an older app''s new task). SECURITY INVOKER; skipped while wilson.task_items_sync = on.';


-- =============================================================================
-- 7. POST-CONDITIONS — scan the catalogue, do not assume (S22)
-- =============================================================================

DO $$
DECLARE
  t        TEXT;
  v_n      INT;
  v_qual   TEXT;
  v_src    TEXT;
  c_0097   CONSTANT TEXT := '((deleted_at IS NULL) AND (workspace_id = current_workspace_id()) AND (EXISTS ( SELECT 1 FROM projects p WHERE (p.id = tasks.project_id))))';
BEGIN
  -- 7a. the asset key: exactly one, ON DELETE SET NULL, to assets (id).
  SELECT count(*) INTO v_n
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attname = 'asset_id'
   WHERE c.conrelid = 'public.tasks'::regclass AND c.contype = 'f'
     AND c.confrelid = 'public.assets'::regclass
     AND c.conkey = ARRAY[a.attnum]::int2[]
     AND c.confdeltype = 'n'
     AND pg_get_constraintdef(c.oid) LIKE 'FOREIGN KEY (asset_id) REFERENCES %assets(id) ON DELETE SET NULL';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '0097 post-condition failed: tasks.asset_id has % ON DELETE SET NULL key(s) to assets, expected 1', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint c
              WHERE c.conrelid = 'public.tasks'::regclass AND c.contype = 'f'
                AND c.confrelid = 'public.assets'::regclass AND c.confdeltype <> 'n') THEN
    RAISE EXCEPTION '0097 post-condition failed: a key from tasks to assets still deletes or refuses with its asset';
  END IF;

  -- 7b. tasks_select: every arm named (0062), the project hop, no asset hop.
  SELECT regexp_replace(regexp_replace(qual, 'public\.', '', 'g'), '\s+', ' ', 'g') INTO v_qual
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'tasks' AND policyname = 'tasks_select'
     AND cmd = 'SELECT' AND permissive = 'PERMISSIVE' AND roles::text = '{public}';
  IF v_qual IS DISTINCT FROM c_0097 THEN
    RAISE EXCEPTION '0097 post-condition failed: tasks_select is not §2''s (have %) — §0 names §2''s text, keep the two the same', v_qual;
  END IF;
  IF position('deleted_at IS NULL' IN v_qual) = 0
     OR position('current_workspace_id()' IN v_qual) = 0
     OR position('FROM projects p WHERE (p.id = tasks.project_id)' IN v_qual) = 0
     OR v_qual ~ 'assets' OR v_qual ~ 'asset_id' THEN
    RAISE EXCEPTION '0097 post-condition failed: tasks_select lost an arm or still hops through assets: %', v_qual;
  END IF;

  -- 7c. exactly the four expected policies on tasks, one per command, none
  --     FOR ALL, none restrictive.
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tasks';
  IF v_n <> 4 THEN
    RAISE EXCEPTION '0097 post-condition failed: tasks has % policies, expected 4 (tasks_select, tasks_insert, tasks_update, tasks_delete)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'tasks' AND permissive = 'PERMISSIVE'
     AND (policyname, cmd) IN (('tasks_select', 'SELECT'), ('tasks_insert', 'INSERT'),
                               ('tasks_update', 'UPDATE'), ('tasks_delete', 'DELETE'));
  IF v_n <> 4 THEN
    RAISE EXCEPTION '0097 post-condition failed: tasks'' policies are not tasks_select / _insert / _update / _delete, one per command, permissive';
  END IF;

  -- 7d. fn_tasks_sync_items has no replace arm and moves nothing: with its
  --     comments taken out, its one DELETE is the cleared column's (under
  --     `IF v_new IS NULL`), it holds no UPDATE at all (0096's moved the
  --     named item first by renumbering), and it adds at the kind's end.
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.fn_tasks_sync_items()'::regprocedure;
  v_src := regexp_replace(v_src, '--[^' || chr(10) || ']*', '', 'g');
  v_src := lower(regexp_replace(v_src, '\s+', ' ', 'g'));
  IF (length(v_src) - length(replace(v_src, 'delete from', ''))) / length('delete from') <> 1
     OR position('if v_new is null then delete from public.task_items where task_id = new.id and entity_type = v_kind and entity_id = v_old;' IN v_src) = 0 THEN
    RAISE EXCEPTION '0097 post-condition failed: fn_tasks_sync_items deletes an item other than the one a cleared column named (0096''s replace arm is back)';
  END IF;
  IF v_src ~ '\mupdate\M' THEN
    RAISE EXCEPTION '0097 post-condition failed: fn_tasks_sync_items updates a row (an item moves): an older app''s write must only add or remove';
  END IF;
  IF position('max(x.position)' IN v_src) = 0
     OR position('order by ti.position, ti.created_at, ti.id' IN v_src) = 0 THEN
    RAISE EXCEPTION '0097 post-condition failed: fn_tasks_sync_items no longer adds at the end of the kind, or NEW no longer carries the first item in the stored order';
  END IF;

  -- 7e. fn_task_items_sync_task keeps the row lock and the stored order.
  SELECT lower(prosrc) INTO v_src FROM pg_proc WHERE oid = 'public.fn_task_items_sync_task()'::regprocedure;
  IF position('for no key update' IN v_src) = 0
     OR position('order by ti.position, ti.created_at, ti.id' IN v_src) = 0 THEN
    RAISE EXCEPTION '0097 post-condition failed: fn_task_items_sync_task lost the task row lock (R1-5) or the stored order';
  END IF;

  -- 7f. the three triggers attached to their functions; every function
  --     SECURITY INVOKER; the trigger functions no client's.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.task_items'::regclass
                    AND tgname = 'trg_task_items_sync_task' AND NOT tgisinternal AND tgenabled <> 'D'
                    AND tgfoid = 'public.fn_task_items_sync_task()'::regprocedure)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.tasks'::regclass
                    AND tgname = 'trg_tasks_sync_items' AND NOT tgisinternal AND tgenabled <> 'D'
                    AND tgfoid = 'public.fn_tasks_sync_items()'::regprocedure)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.tasks'::regclass
                    AND tgname = 'trg_tasks_seed_items' AND NOT tgisinternal AND tgenabled <> 'D'
                    AND tgfoid = 'public.fn_tasks_seed_items()'::regprocedure) THEN
    RAISE EXCEPTION '0097 post-condition failed: a sync trigger is missing, disabled or calls another function';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.prosecdef
                AND p.proname IN ('reorder_task_items', 'fn_task_items_sync_task',
                                  'fn_tasks_sync_items', 'fn_tasks_seed_items')) THEN
    RAISE EXCEPTION '0097 post-condition failed: a sync function or reorder_task_items is SECURITY DEFINER';
  END IF;
  FOREACH t IN ARRAY ARRAY['public.fn_task_items_sync_task()', 'public.fn_tasks_sync_items()',
                           'public.fn_tasks_seed_items()'] LOOP
    IF has_function_privilege('authenticated', t, 'EXECUTE') OR has_function_privilege('anon', t, 'EXECUTE') THEN
      RAISE EXCEPTION '0097 post-condition failed: % is executable by a client role', t;
    END IF;
  END LOOP;

  -- 7g. fn_realtime_broadcast is untouched: 0096 §9's body (md5 with
  --     carriage returns taken out, as 0096 §0 computes it).
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc
       WHERE oid = 'public.fn_realtime_broadcast()'::regprocedure) IS DISTINCT FROM '2e8cc917144b17b674af3ca03fa76055' THEN
    RAISE EXCEPTION '0097 post-condition failed: fn_realtime_broadcast is not 0096''s body — 0097 does not restate it';
  END IF;

  -- 7h. the data: every same-project single link has its item, and every
  --     task's column of a kind it has items for IS the first in the stored
  --     order (the copy is a copy).
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
    RAISE EXCEPTION '0097 post-condition failed: % task(s) carry a same-project single link with no item', v_n;
  END IF;
  SELECT count(*) INTO v_n
    FROM public.tasks t
    JOIN LATERAL (
      SELECT k.kind,
             (SELECT i.entity_id FROM public.task_items i
               WHERE i.task_id = t.id AND i.entity_type = k.kind
               ORDER BY i.position, i.created_at, i.id LIMIT 1) AS first_item,
             CASE k.kind WHEN 'asset' THEN t.asset_id WHEN 'scene' THEN t.scene_id ELSE t.shot_id END AS col
        FROM (VALUES ('asset'), ('scene'), ('shot')) AS k(kind)
    ) m ON true
   WHERE m.first_item IS NOT NULL AND m.col IS DISTINCT FROM m.first_item;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0097 post-condition failed: % (task, kind) pair(s) whose single column is not the first item in the stored order', v_n;
  END IF;

  RAISE NOTICE '0097 OK: tasks.asset_id ON DELETE SET NULL; tasks_select hops to the task''s own project only (four policies); fn_tasks_sync_items add-only; the single columns a copy of the first item in the stored order; fn_realtime_broadcast untouched';
END $$;
