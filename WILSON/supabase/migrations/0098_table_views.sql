-- =============================================================================
-- 0098_table_views.sql — VW1c (post-overhaul, custom table views, the build
-- part 2, 2026-10-17): the views' and the groupings' data. No screen reads
-- them yet (VW1d builds the Tasks table's Views dropdown, its cards and the
-- bar; VW1e the other tables).
--
-- Audrey (docs/design/CUSTOM_VIEWS_QUESTIONS.md, every answer verbatim):
--   Q1  "Everyone on the project" — every view is shared with the project's
--       team; there are no personal views.
--   Q2  "Anyone who can edit" — admins and managers, the project's managers
--       and members, anyone while a project has nobody on it
--       (can_write_project); reviewers use views, never save them.
--   Q4  "The view you last used (Recommended)" — per person, per project, per
--       table: user_settings.table_view_last.
--   Q5c "Made order, draggable (Recommended)" — position, reorder_table_views.
--   Q-D2 "Saved for the project" — a grouping made with Create grouping is
--       the project's, shown in every view grouped by that kind.
--   Q3d "It follows (Recommended)" — a teammate's save reaches an open table
--       at once: both tables join the realtime broadcast.
--   Q20 "Only All (Recommended)" — nothing is seeded; All is never stored.
--
-- WHAT THIS ADDS (docs/design/CUSTOM_VIEWS_DESIGN.md §5, corrected by VW1c's
-- step 0 review, §11 round 4)
--   §1 fn_is_sorted_uuid_set — the immutable helper a grouping's CHECK uses.
--   §2 public.table_views — a named, saved way of showing one of six tables
--      in one project: its config (filters, sorts, grouping, fields, layout)
--      as one JSON object, its place in the dropdown, and a REVISION from one
--      sequence for every view, taken on insert and on every change of
--      config (never on a rename or a reorder), so a change for now saves
--      only over the view it started from.
--   §3 public.item_groupings — a grouping made with Create grouping: one set
--      of items of one kind (sorted, distinct, 1 to 100 ids), unique per
--      project, table and kind. It holds no rows; rows join it by having
--      exactly its items.
--   §4 the triggers, named so the BEFORE ones fire in name order audit → cap
--      → pin → populate_workspace → validate: fn_audit_touch; the caps (200
--      views, 500 groupings per project and table, under a transaction lock);
--      the pin (a signed-in insert's four stamps are the server's own, an
--      update keeps created_by and created_at; a view's revision; a
--      grouping's ids sorted and made distinct); the workspace stamp; a
--      grouping's ids checked as the caller (each a row of its kind in the
--      grouping's project that the caller can see: the trash and a private
--      project hide what they hide).
--   §5 the sweep — fn_item_groupings_forget, AFTER DELETE on assets, scenes,
--      shots, levels and experiences, SECURITY DEFINER: a project member who
--      deletes a scene holds no UPDATE on item_groupings, and an array has no
--      foreign key whose cascade would run as the owner. A deleted row's id
--      leaves every grouping of its kind in its project; a grouping left
--      empty, or left naming the set of another grouping, is deleted (the
--      unique key would otherwise refuse the delete, or roll back the nightly
--      purge whole). An asset in the trash is not deleted: its groupings keep
--      it and the client hides them while it is there (her Q-N4).
--   §6 RLS, forced; four policies on each table, every arm restated in full
--      (0062): the workspace, the membership, the project hop under the
--      caller's own RLS (the private-project arm, and a return=minimal insert
--      is judged by its own policy), and can_write_project for every write.
--      UPDATE's WITH CHECK is its USING.
--   §7 grants by column: table_views INSERT (id, project_id, table_key, name,
--      position, config), UPDATE (name, position, config); item_groupings
--      INSERT (id, project_id, table_key, kind, entity_ids), no UPDATE. So a
--      client creates with insert and saves with update: an upsert is
--      refused. The revision sequence: USAGE to authenticated, stated.
--   §8 reorder_table_views — 0096 §6's rule, SECURITY INVOKER.
--   §9 user_settings.table_view_last and set_table_view_last — the last used
--      view: one statement that merges one key with the server's clock and
--      keeps a person's 300 newest tables.
--   §10 fn_realtime_broadcast restated WHOLE with the two tables in its
--      project_id arm (eighteen tables).
--   §11 post-conditions, scanned from the catalogue.
--   §12 comments.
--
-- NOT HERE, ON PURPOSE
--   * No edit history of views or groupings (their undo is the client's toast).
--   * Nothing seeded (Q20) and nothing backfilled: the browsers' old views are
--     removed by the screens that replace them (Q17, VW1d and VW1e).
--   * The column keys and the config's shape are the client's (design §5.1):
--     the database holds an object of at most 32 KB, and a reader that never
--     throws turns it into a table's state.
--
-- ORDERING: needs 0040 (scenes, shots, levels, experiences), 0044
--   (projects_id_workspace_key), 0046 (user_settings), 0072 (the privacy arm
--   projects_select carries), 0096 (task_items; fn_realtime_broadcast's
--   sixteen tables, restated here whole) and 0097 (no main item). Refuses to
--   run otherwise.
-- Number: 0098 / suite 101 (supabase/tests/rls/101_table_views.sql); 0094 /
--   97 stay reserved; 0097 / 100 are VW1m's; 0099 / 102 were DG1's and stay
--   unused. CI's coverage guard: table_views in RLS_TABLES with suite 101,
--   item_groupings mapped to it in COVERED_BY (93_bins' shape).
-- Idempotent: CREATE … IF NOT EXISTS, guarded constraints, DROP-then-CREATE
--   for policies and triggers, CREATE OR REPLACE for functions. Safe to
--   re-run — but never AFTER a later migration (§0 refuses: a re-run would
--   take back that migration's change to the broadcast or to these policies).
--   Re-running 0096 or 0097 after this file is refused by their own guards
--   (a later migration recorded) and would take the two tables out of the
--   broadcast: never re-run them.
-- =============================================================================


-- =============================================================================
-- 0. PRE-FLIGHT
-- =============================================================================
DO $$
BEGIN
  IF to_regclass('public.scenes') IS NULL OR to_regclass('public.shots') IS NULL
     OR to_regclass('public.levels') IS NULL OR to_regclass('public.experiences') IS NULL THEN
    RAISE EXCEPTION '0098 pre-flight failed: scenes / shots / levels / experiences missing — apply 0040 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.projects'::regclass AND conname = 'projects_id_workspace_key') THEN
    RAISE EXCEPTION '0098 pre-flight failed: projects_id_workspace_key (0044) is missing';
  END IF;
  IF to_regclass('public.user_settings') IS NULL THEN
    RAISE EXCEPTION '0098 pre-flight failed: public.user_settings is missing — apply 0046 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'is_private') THEN
    RAISE EXCEPTION '0098 pre-flight failed: projects.is_private is missing — apply 0072 first';
  END IF;
  IF to_regclass('public.task_items') IS NULL THEN
    RAISE EXCEPTION '0098 pre-flight failed: public.task_items is missing — apply 0096 first';
  END IF;
  -- 0097 §1: tasks.asset_id deletes as SET NULL (found by catalogue, as 0097
  -- found it: Postgres named the key in 0000 and no file names it).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                   JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attname = 'asset_id'
                  WHERE c.conrelid = 'public.tasks'::regclass AND c.contype = 'f'
                    AND c.confrelid = 'public.assets'::regclass
                    AND c.conkey = ARRAY[a.attnum]::int2[]
                    AND c.confdeltype = 'n') THEN
    RAISE EXCEPTION '0098 pre-flight failed: tasks.asset_id does not delete as SET NULL — apply 0097 first';
  END IF;
  IF to_regprocedure('public.current_workspace_id()') IS NULL
     OR to_regprocedure('public.has_active_membership(uuid)') IS NULL
     OR to_regprocedure('public.can_write_project(uuid)') IS NULL
     OR to_regprocedure('public.fn_audit_touch()') IS NULL
     OR to_regprocedure('public.fn_populate_workspace_from_project()') IS NULL
     OR to_regprocedure('public.file_row_is_money(boolean, text)') IS NULL
     OR to_regprocedure('public.fn_comment_project_id(text, uuid)') IS NULL THEN
    RAISE EXCEPTION '0098 pre-flight failed: a helper this file calls is missing (current_workspace_id, has_active_membership, can_write_project, fn_audit_touch, fn_populate_workspace_from_project, file_row_is_money, fn_comment_project_id)';
  END IF;
END $$;


-- A re-run must not take back a later migration's change. §10 restates
-- fn_realtime_broadcast whole and §6 drops then creates the two tables'
-- policies, so the body §10 replaces must be 0096's (the first run: 0097 did
-- not restate it) or this file's own (a re-run) — compared by an md5 of the
-- body with carriage returns taken out (a file applied from a Windows copy
-- keeps them), §11g holding this file's constant to §10's body — and a
-- re-run (table_views already there) must not follow a later migration in
-- the history.
DO $$
DECLARE
  v_body  TEXT;
  v_later BOOLEAN := false;
BEGIN
  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_body
    FROM pg_proc p WHERE p.oid = 'public.fn_realtime_broadcast()'::regprocedure;
  IF v_body IS DISTINCT FROM '2e8cc917144b17b674af3ca03fa76055'        -- 0096's body
     AND v_body IS DISTINCT FROM 'e5abdcf2b8abce914416acb148144971' THEN -- this file's (§10)
    RAISE EXCEPTION '0098 pre-flight failed: fn_realtime_broadcast is neither 0096''s body nor this file''s (md5 %) — a later migration restated it, and restating it here would take that change back', v_body;
  END IF;
  IF to_regclass('public.table_views') IS NOT NULL
     AND to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version > $1)'
      INTO v_later USING '0098';
    IF v_later THEN
      RAISE EXCEPTION '0098 pre-flight failed: a migration after 0098 is recorded — re-running 0098 would take back its changes to the broadcast or to the views'' and groupings'' policies';
    END IF;
  END IF;
END $$;


-- =============================================================================
-- 1. fn_is_sorted_uuid_set — a grouping's set, as its CHECK reads it
-- =============================================================================
-- True when the array is one-dimensional, holds no NULL, and is in ascending
-- order with no id twice (the stored form of a set, so equal sets are equal
-- arrays and the unique key compares sets); false, never NULL, for anything
-- else, the empty array included (array_ndims of '{}' is NULL). IMMUTABLE:
-- it reads only its argument.

CREATE OR REPLACE FUNCTION public.fn_is_sorted_uuid_set(p_ids UUID[])
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT p_ids IS NOT NULL
     AND COALESCE(array_ndims(p_ids), 0) = 1
     AND array_position(p_ids, NULL) IS NULL
     AND p_ids = ARRAY(SELECT DISTINCT x FROM unnest(p_ids) AS x ORDER BY x);
$$;

REVOKE ALL ON FUNCTION public.fn_is_sorted_uuid_set(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_is_sorted_uuid_set(UUID[]) TO authenticated, service_role;


-- =============================================================================
-- 2. table_views
-- =============================================================================
-- One sequence for every view's revision: a view deleted and made again with
-- its id (an undo) takes a number no view ever had, so a change for now made
-- from the old row can never save over the new one.

CREATE SEQUENCE IF NOT EXISTS public.table_views_revision_seq AS BIGINT;

CREATE TABLE IF NOT EXISTS public.table_views (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL,
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  table_key     TEXT NOT NULL,
  name          TEXT NOT NULL,
  position      INTEGER NOT NULL DEFAULT 0,
  revision      BIGINT NOT NULL DEFAULT 0,
  revised_by    UUID,
  config        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID,

  CONSTRAINT table_views_table_key_chk
    CHECK (table_key IN ('tasks', 'assets', 'scenes', 'shots', 'levels', 'experiences')),
  CONSTRAINT table_views_name_chk
    CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 80 AND name !~ '[[:cntrl:]]'),
  CONSTRAINT table_views_position_chk CHECK (position >= 0),
  CONSTRAINT table_views_config_chk
    CHECK (jsonb_typeof(config) = 'object' AND octet_length(config::text) <= 32768),
  CONSTRAINT table_views_project_fk
    FOREIGN KEY (project_id, workspace_id) REFERENCES public.projects (id, workspace_id) ON DELETE CASCADE
);

-- A project's views of one table, in the dropdown's order (Q5c).
CREATE INDEX IF NOT EXISTS table_views_project_table_idx
  ON public.table_views (project_id, table_key, position, created_at, id);


-- =============================================================================
-- 3. item_groupings
-- =============================================================================
-- The pairs design §4.11 allows: the Tasks table by any kind; Assets by the
-- scenes, shots, levels and experiences an asset is in; Levels and
-- Experiences by the assets that name them. At most 100 ids: a set is far
-- smaller in practice, and the unique key's index entry must stay well under
-- a btree page's third (100 uuids is about 1.6 KB).

CREATE TABLE IF NOT EXISTS public.item_groupings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL,
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  table_key     TEXT NOT NULL,
  kind          TEXT NOT NULL,
  entity_ids    UUID[] NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID,

  CONSTRAINT item_groupings_pair_chk CHECK (
       (table_key = 'tasks' AND kind IN ('asset', 'scene', 'shot', 'level', 'experience'))
    OR (table_key = 'assets' AND kind IN ('scene', 'shot', 'level', 'experience'))
    OR (table_key IN ('levels', 'experiences') AND kind = 'asset')),
  CONSTRAINT item_groupings_ids_chk CHECK (
       cardinality(entity_ids) BETWEEN 1 AND 100
   AND public.fn_is_sorted_uuid_set(entity_ids)),
  CONSTRAINT item_groupings_set_key UNIQUE (project_id, table_key, kind, entity_ids),
  CONSTRAINT item_groupings_project_fk
    FOREIGN KEY (project_id, workspace_id) REFERENCES public.projects (id, workspace_id) ON DELETE CASCADE
);

-- The sweep (§5) finds a deleted row's groupings by containment.
CREATE INDEX IF NOT EXISTS item_groupings_entity_ids_gin
  ON public.item_groupings USING gin (entity_ids);


-- =============================================================================
-- 4. Triggers — audit → cap → pin → populate_workspace → validate (by name)
-- =============================================================================
-- Every function here but the sweep is SECURITY INVOKER (plpgsql, the
-- precondition for FORCE RLS): it reads only what the caller may read.

-- 4a. The caps. A transaction lock on (project, table key) first, so two
--     inserts at once cannot both pass at the last place; then a count of
--     the rows the caller can see (a writer sees the whole project's).
CREATE OR REPLACE FUNCTION public.fn_table_views_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_n INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('table_views:' || NEW.project_id::text || ':' || NEW.table_key, 0));
  SELECT count(*) INTO v_n FROM public.table_views
   WHERE project_id = NEW.project_id AND table_key = NEW.table_key;
  IF v_n >= 200 THEN
    RAISE EXCEPTION 'A project''s % table holds at most 200 saved views.', initcap(NEW.table_key)
      USING ERRCODE = '54000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_item_groupings_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_n INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('item_groupings:' || NEW.project_id::text || ':' || NEW.table_key, 0));
  SELECT count(*) INTO v_n FROM public.item_groupings
   WHERE project_id = NEW.project_id AND table_key = NEW.table_key;
  IF v_n >= 500 THEN
    RAISE EXCEPTION 'A project''s % table holds at most 500 groupings.', initcap(NEW.table_key)
      USING ERRCODE = '54000';
  END IF;
  RETURN NEW;
END;
$$;

-- 4b. The pins (VW1's trap 7: fn_audit_touch fills only what the client
--     leaves empty, on insert too; the column grants already keep a client
--     from sending these, and the pin keeps any signed-in writer from them).
--     A view's revision: a new one on insert and on every change of config;
--     a rename or a reorder keeps both the revision and who made it.
CREATE OR REPLACE FUNCTION public.fn_table_views_pin()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_me UUID := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_me IS NOT NULL THEN
      NEW.created_by := v_me;
      NEW.updated_by := v_me;
      NEW.created_at := now();
      NEW.updated_at := now();
    END IF;
    NEW.revision   := nextval('public.table_views_revision_seq');
    NEW.revised_by := v_me;
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    IF NEW.config IS DISTINCT FROM OLD.config THEN
      NEW.revision   := nextval('public.table_views_revision_seq');
      NEW.revised_by := v_me;
    ELSE
      NEW.revision   := OLD.revision;
      NEW.revised_by := OLD.revised_by;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- A grouping's ids sorted and made distinct on insert (the CHECK then reads
-- the stored form); an array that is not one-dimensional or holds a NULL is
-- left for the CHECK to refuse, never silently reshaped.
CREATE OR REPLACE FUNCTION public.fn_item_groupings_pin()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_me UUID := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_me IS NOT NULL THEN
      NEW.created_by := v_me;
      NEW.updated_by := v_me;
      NEW.created_at := now();
      NEW.updated_at := now();
    END IF;
    IF NEW.entity_ids IS NOT NULL AND array_ndims(NEW.entity_ids) = 1
       AND array_position(NEW.entity_ids, NULL) IS NULL THEN
      NEW.entity_ids := ARRAY(SELECT DISTINCT x FROM unnest(NEW.entity_ids) AS x ORDER BY x);
    END IF;
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;

-- 4c. A grouping's ids, checked as the caller: each must be a row of its
--     kind in the grouping's project that the caller can see (assets_select
--     hides an asset in the trash; projects_select a private project). Runs
--     last (the pin has made the ids distinct). A malformed array or an
--     unknown pair is left to the CHECKs.
CREATE OR REPLACE FUNCTION public.fn_item_groupings_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_found INT;
BEGIN
  IF NEW.entity_ids IS NULL OR NOT public.fn_is_sorted_uuid_set(NEW.entity_ids)
     OR NEW.kind NOT IN ('asset', 'scene', 'shot', 'level', 'experience') THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO v_found FROM (
    SELECT a.id FROM public.assets a
     WHERE NEW.kind = 'asset' AND a.project_id = NEW.project_id AND a.id = ANY (NEW.entity_ids)
    UNION ALL
    SELECT s.id FROM public.scenes s
     WHERE NEW.kind = 'scene' AND s.project_id = NEW.project_id AND s.id = ANY (NEW.entity_ids)
    UNION ALL
    SELECT h.id FROM public.shots h
     WHERE NEW.kind = 'shot' AND h.project_id = NEW.project_id AND h.id = ANY (NEW.entity_ids)
    UNION ALL
    SELECT l.id FROM public.levels l
     WHERE NEW.kind = 'level' AND l.project_id = NEW.project_id AND l.id = ANY (NEW.entity_ids)
    UNION ALL
    SELECT x.id FROM public.experiences x
     WHERE NEW.kind = 'experience' AND x.project_id = NEW.project_id AND x.id = ANY (NEW.entity_ids)
  ) AS found;
  IF v_found <> cardinality(NEW.entity_ids) THEN
    RAISE EXCEPTION 'A grouping can name only this project''s own %s: % of the % named are not in it (or are in the trash).',
      NEW.kind, cardinality(NEW.entity_ids) - v_found, cardinality(NEW.entity_ids)
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_table_views_cap()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_item_groupings_cap()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_table_views_pin()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_item_groupings_pin()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_item_groupings_validate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_table_views_audit ON public.table_views;
CREATE TRIGGER trg_table_views_audit
  BEFORE INSERT OR UPDATE ON public.table_views
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_touch();
DROP TRIGGER IF EXISTS trg_table_views_cap ON public.table_views;
CREATE TRIGGER trg_table_views_cap
  BEFORE INSERT ON public.table_views
  FOR EACH ROW EXECUTE FUNCTION public.fn_table_views_cap();
DROP TRIGGER IF EXISTS trg_table_views_pin ON public.table_views;
CREATE TRIGGER trg_table_views_pin
  BEFORE INSERT OR UPDATE ON public.table_views
  FOR EACH ROW EXECUTE FUNCTION public.fn_table_views_pin();
DROP TRIGGER IF EXISTS trg_table_views_populate_workspace ON public.table_views;
CREATE TRIGGER trg_table_views_populate_workspace
  BEFORE INSERT ON public.table_views
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_from_project();

DROP TRIGGER IF EXISTS trg_item_groupings_audit ON public.item_groupings;
CREATE TRIGGER trg_item_groupings_audit
  BEFORE INSERT OR UPDATE ON public.item_groupings
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_touch();
DROP TRIGGER IF EXISTS trg_item_groupings_cap ON public.item_groupings;
CREATE TRIGGER trg_item_groupings_cap
  BEFORE INSERT ON public.item_groupings
  FOR EACH ROW EXECUTE FUNCTION public.fn_item_groupings_cap();
DROP TRIGGER IF EXISTS trg_item_groupings_pin ON public.item_groupings;
CREATE TRIGGER trg_item_groupings_pin
  BEFORE INSERT OR UPDATE ON public.item_groupings
  FOR EACH ROW EXECUTE FUNCTION public.fn_item_groupings_pin();
DROP TRIGGER IF EXISTS trg_item_groupings_populate_workspace ON public.item_groupings;
CREATE TRIGGER trg_item_groupings_populate_workspace
  BEFORE INSERT ON public.item_groupings
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_from_project();
DROP TRIGGER IF EXISTS trg_item_groupings_validate ON public.item_groupings;
CREATE TRIGGER trg_item_groupings_validate
  BEFORE INSERT ON public.item_groupings
  FOR EACH ROW EXECUTE FUNCTION public.fn_item_groupings_validate();


-- =============================================================================
-- 5. The sweep — an item deleted for good leaves its groupings
-- =============================================================================
-- SECURITY DEFINER, its search_path pinned, EXECUTE revoked from every client
-- (0086's shape): it runs inside a delete the caller was allowed to make, and
-- touches only the groupings of the deleted row's own kind and project. A
-- grouping left empty, or left naming the set of another grouping of the same
-- table and kind, is deleted (two distinct sets that both held the id can
-- never shrink to one set, so only a grouping that did not hold it can
-- collide). While the project itself is being deleted it does nothing: the
-- project's key takes its groupings.

CREATE OR REPLACE FUNCTION public.fn_item_groupings_forget()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind TEXT := TG_ARGV[0];
  g      RECORD;
  v_rest UUID[];
BEGIN
  IF v_kind IS NULL OR v_kind NOT IN ('asset', 'scene', 'shot', 'level', 'experience') THEN
    RAISE EXCEPTION 'fn_item_groupings_forget: % is not a kind of item', v_kind;
  END IF;
  IF OLD.project_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id) THEN
    RETURN NULL;
  END IF;
  FOR g IN
    SELECT ig.id, ig.table_key, ig.entity_ids
      FROM public.item_groupings ig
     WHERE ig.project_id = OLD.project_id
       AND ig.kind = v_kind
       AND ig.entity_ids @> ARRAY[OLD.id]
     ORDER BY ig.id
       FOR UPDATE
  LOOP
    v_rest := array_remove(g.entity_ids, OLD.id);
    IF cardinality(v_rest) = 0
       OR EXISTS (SELECT 1 FROM public.item_groupings o
                   WHERE o.project_id = OLD.project_id
                     AND o.table_key = g.table_key
                     AND o.kind = v_kind
                     AND o.entity_ids = v_rest
                     AND o.id <> g.id) THEN
      DELETE FROM public.item_groupings WHERE id = g.id;
    ELSE
      UPDATE public.item_groupings SET entity_ids = v_rest WHERE id = g.id;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_item_groupings_forget() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_assets_item_groupings_forget ON public.assets;
CREATE TRIGGER trg_assets_item_groupings_forget
  AFTER DELETE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.fn_item_groupings_forget('asset');
DROP TRIGGER IF EXISTS trg_scenes_item_groupings_forget ON public.scenes;
CREATE TRIGGER trg_scenes_item_groupings_forget
  AFTER DELETE ON public.scenes
  FOR EACH ROW EXECUTE FUNCTION public.fn_item_groupings_forget('scene');
DROP TRIGGER IF EXISTS trg_shots_item_groupings_forget ON public.shots;
CREATE TRIGGER trg_shots_item_groupings_forget
  AFTER DELETE ON public.shots
  FOR EACH ROW EXECUTE FUNCTION public.fn_item_groupings_forget('shot');
DROP TRIGGER IF EXISTS trg_levels_item_groupings_forget ON public.levels;
CREATE TRIGGER trg_levels_item_groupings_forget
  AFTER DELETE ON public.levels
  FOR EACH ROW EXECUTE FUNCTION public.fn_item_groupings_forget('level');
DROP TRIGGER IF EXISTS trg_experiences_item_groupings_forget ON public.experiences;
CREATE TRIGGER trg_experiences_item_groupings_forget
  AFTER DELETE ON public.experiences
  FOR EACH ROW EXECUTE FUNCTION public.fn_item_groupings_forget('experience');


-- =============================================================================
-- 6. RLS
-- =============================================================================
-- Separate policies per command, never FOR ALL (0029). Every policy names
-- every arm (0062: a rewritten policy that drops an arm is a privilege
-- escalation):
--   * the workspace: workspace_id = current_workspace_id();
--   * the membership: has_active_membership(workspace_id);
--   * the project, under the caller's RLS: projects_select carries the
--     live, membership and privacy arms (0014, 0072), so a private project's
--     views are a name, not access, and a trashed project's are hidden;
--   * every write: can_write_project(project_id) (Q2: reviewers read views,
--     never save them).
-- 🚨 The write policies hop too (0082 §3b / 0083): supabase-js's .insert()
-- without .select() sends Prefer: return=minimal, so no SELECT policy is
-- consulted; a write is judged by its own policy alone.
-- UPDATE's WITH CHECK is IDENTICAL to its USING (0044).

ALTER TABLE public.table_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_views FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS table_views_select ON public.table_views;
CREATE POLICY table_views_select ON public.table_views
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = table_views.project_id)
  );

DROP POLICY IF EXISTS table_views_insert ON public.table_views;
CREATE POLICY table_views_insert ON public.table_views
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = table_views.project_id)
  );

DROP POLICY IF EXISTS table_views_update ON public.table_views;
CREATE POLICY table_views_update ON public.table_views
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = table_views.project_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = table_views.project_id)
  );

DROP POLICY IF EXISTS table_views_delete ON public.table_views;
CREATE POLICY table_views_delete ON public.table_views
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = table_views.project_id)
  );

ALTER TABLE public.item_groupings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_groupings FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS item_groupings_select ON public.item_groupings;
CREATE POLICY item_groupings_select ON public.item_groupings
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = item_groupings.project_id)
  );

DROP POLICY IF EXISTS item_groupings_insert ON public.item_groupings;
CREATE POLICY item_groupings_insert ON public.item_groupings
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = item_groupings.project_id)
  );

-- No client UPDATE grant (§7): this policy is what the definer sweep would
-- meet if it ever ran as a client, and keeps the table's four verbs stated.
DROP POLICY IF EXISTS item_groupings_update ON public.item_groupings;
CREATE POLICY item_groupings_update ON public.item_groupings
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = item_groupings.project_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = item_groupings.project_id)
  );

DROP POLICY IF EXISTS item_groupings_delete ON public.item_groupings;
CREATE POLICY item_groupings_delete ON public.item_groupings
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = item_groupings.project_id)
  );


-- =============================================================================
-- 7. Privileges
-- =============================================================================
-- Stated, PUBLIC included (S21, S22). By column: a client creates a view with
-- insert and saves one with update, so an upsert (INSERT … ON CONFLICT DO
-- UPDATE of id, project_id, table_key) is refused; the stamps, the revision
-- and the workspace are the triggers'. A grouping has no UPDATE: it is made
-- and removed whole. REVOKE ALL on a table revokes its column grants too, so
-- a re-run starts clean.

REVOKE ALL ON public.table_views FROM PUBLIC, anon;
REVOKE ALL ON public.table_views FROM authenticated;
GRANT SELECT, DELETE ON public.table_views TO authenticated;
GRANT INSERT (id, project_id, table_key, name, position, config) ON public.table_views TO authenticated;
GRANT UPDATE (name, position, config) ON public.table_views TO authenticated;
GRANT ALL ON public.table_views TO service_role;

REVOKE ALL ON public.item_groupings FROM PUBLIC, anon;
REVOKE ALL ON public.item_groupings FROM authenticated;
GRANT SELECT, DELETE ON public.item_groupings TO authenticated;
GRANT INSERT (id, project_id, table_key, kind, entity_ids) ON public.item_groupings TO authenticated;
GRANT ALL ON public.item_groupings TO service_role;

-- The pin's nextval runs as the caller: USAGE, and nothing else (no setval,
-- no reading the sequence), stated rather than left to the schema's default
-- privileges (VW1c step 0, finding 11).
REVOKE ALL ON SEQUENCE public.table_views_revision_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SEQUENCE public.table_views_revision_seq TO authenticated, service_role;


-- =============================================================================
-- 8. reorder_table_views — one project's views of one table, in one statement
-- =============================================================================
-- 0096 §6's rule. SECURITY INVOKER: the table's policies decide what it reads
-- and writes (a reviewer moves nothing). The named views go first, in the
-- order given; every other view of that project and table follows in its
-- current order (a teammate's new view, which a stale list did not name,
-- lands after instead of colliding). Positions come out dense, 0..n-1; a tie
-- reads by created_at, then id. An id of another project or table is
-- ignored. Returns the rows it moved; a reorder never makes a new revision.

CREATE OR REPLACE FUNCTION public.reorder_table_views(p_project UUID, p_table_key TEXT, p_ids UUID[])
RETURNS SETOF public.table_views
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_table_key IS NULL OR p_table_key NOT IN ('tasks', 'assets', 'scenes', 'shots', 'levels', 'experiences') THEN
    RAISE EXCEPTION 'reorder_table_views: % is not a table with views (tasks, assets, scenes, shots, levels, experiences)', p_table_key
      USING ERRCODE = '22023';
  END IF;
  IF p_ids IS NULL THEN
    RETURN;
  END IF;
  IF array_position(p_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'reorder_table_views: a view id is empty' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_ids) AS x) THEN
    RAISE EXCEPTION 'reorder_table_views: a view is named twice' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH named AS (
    SELECT o.id, o.ord FROM unnest(p_ids) WITH ORDINALITY AS o(id, ord)
  ), ranked AS (
    SELECT v.id,
           (row_number() OVER (ORDER BY (n.ord IS NULL), n.ord, v.position, v.created_at, v.id) - 1)::int AS np
      FROM public.table_views v
      LEFT JOIN named n ON n.id = v.id
     WHERE v.project_id = p_project AND v.table_key = p_table_key
  )
  UPDATE public.table_views v
     SET position = r.np
    FROM ranked r
   WHERE v.id = r.id AND v.position IS DISTINCT FROM r.np
  RETURNING v.*;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reorder_table_views(UUID, TEXT, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_table_views(UUID, TEXT, UUID[]) TO authenticated, service_role;


-- =============================================================================
-- 9. The last used view (Q4) — user_settings.table_view_last
-- =============================================================================
-- { "<project id>:<table key>": { "view": "<view id>" | "all", "at": <the
-- server's clock, epoch milliseconds> } }, about 135 bytes an entry. The row
-- is the person's own (0046: own row on every verb, no admin read) and its
-- grants are table-wide, so the column is not fenced: the client writes it
-- only through set_table_view_last, and the CHECK bounds what any write can
-- leave there. fetchCloudSettings / saveCloudSettings select and upsert only
-- their own two columns and never touch it.

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS table_view_last JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.user_settings'::regclass
                    AND conname = 'user_settings_table_view_last_chk') THEN
    ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_table_view_last_chk
      CHECK (jsonb_typeof(table_view_last) = 'object' AND octet_length(table_view_last::text) <= 65536);
  END IF;
END $$;

-- One statement: the first-ever write inserts the person's row (user_id is
-- auth.uid() by default, under user_settings_insert); every later one merges
-- the one key into the stored map and keeps the 300 newest by `at` (an entry
-- whose `at` is not a number sorts last, so it goes first). Two writes at
-- once each land whole: the row's lock orders them. Returns the map.
CREATE OR REPLACE FUNCTION public.set_table_view_last(p_key TEXT, p_view TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_map JSONB;
BEGIN
  IF p_key IS NULL
     OR p_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(tasks|assets|scenes|shots|levels|experiences)$' THEN
    RAISE EXCEPTION 'set_table_view_last: % is not a project id and a table (tasks, assets, scenes, shots, levels, experiences)', p_key
      USING ERRCODE = '22023';
  END IF;
  IF p_view IS NULL
     OR (p_view <> 'all' AND p_view !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'set_table_view_last: % is not a view id or "all"', p_view
      USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.user_settings AS us (table_view_last)
  VALUES (jsonb_build_object(p_key, jsonb_build_object(
            'view', p_view,
            'at', floor(extract(epoch FROM now()) * 1000))))
  ON CONFLICT (user_id) DO UPDATE
    SET table_view_last = (
      SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
        FROM (SELECT j.key, j.value
                FROM jsonb_each(CASE WHEN jsonb_typeof(us.table_view_last) = 'object'
                                     THEN us.table_view_last ELSE '{}'::jsonb END
                                || EXCLUDED.table_view_last) AS j
               ORDER BY CASE WHEN jsonb_typeof(j.value -> 'at') = 'number'
                             THEN (j.value ->> 'at')::numeric END DESC NULLS LAST,
                        j.key
               LIMIT 300) AS e)
  RETURNING us.table_view_last INTO v_map;
  RETURN v_map;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_table_view_last(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_table_view_last(TEXT, TEXT) TO authenticated, service_role;


-- =============================================================================
-- 10. REALTIME — table_views and item_groupings join the project_id arm
-- =============================================================================
-- 0096's body of fn_realtime_broadcast (0097 left it unchanged and said so),
-- reproduced WHOLE — Postgres has no "add an arm" — with the two tables
-- joining the plain project_id arm: each has its own project_id. Every other
-- arm is untouched, word for word (suites 20, 23, 94 and 95 read them); §11g
-- asserts each of the EIGHTEEN names appears exactly once (the 0077 §3d
-- invariant: CASE takes the first match) and the files money arm is 0088's.

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
    -- 0098: table_views and item_groupings join it (VW1c, her Q3d: a
    -- teammate's saved view or created grouping reaches an open table).
    WHEN 'phases', 'assets', 'tasks', 'project_members', 'milestones',
         'bins', 'bin_files', 'shot_takes', 'task_items',
         'table_views', 'item_groupings' THEN
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

DROP TRIGGER IF EXISTS trg_table_views_realtime ON public.table_views;
CREATE TRIGGER trg_table_views_realtime
  AFTER INSERT OR UPDATE OR DELETE ON public.table_views
  FOR EACH ROW EXECUTE FUNCTION public.fn_realtime_broadcast();

DROP TRIGGER IF EXISTS trg_item_groupings_realtime ON public.item_groupings;
CREATE TRIGGER trg_item_groupings_realtime
  AFTER INSERT OR UPDATE OR DELETE ON public.item_groupings
  FOR EACH ROW EXECUTE FUNCTION public.fn_realtime_broadcast();


-- =============================================================================
-- 11. POST-CONDITIONS — scan the catalogue, do not assume (S22)
-- =============================================================================

DO $$
DECLARE
  t        TEXT;
  r        TEXT;
  v_n      INT;
  v_body   TEXT;
  v_hits   INT;
  v_def    TEXT;
BEGIN
  -- 11a. both tables: RLS enabled + forced, exactly four policies, none FOR
  --      ALL, none restrictive.
  FOREACH r IN ARRAY ARRAY['table_views', 'item_groupings'] LOOP
    IF to_regclass('public.' || r) IS NULL THEN
      RAISE EXCEPTION '0098 post-condition failed: public.% is missing', r;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = ('public.' || r)::regclass
                      AND relrowsecurity AND relforcerowsecurity) THEN
      RAISE EXCEPTION '0098 post-condition failed: % lacks ENABLE+FORCE row level security', r;
    END IF;
    SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = r;
    IF v_n <> 4 THEN
      RAISE EXCEPTION '0098 post-condition failed: % has % policies, expected 4 (select, insert, update, delete)', r, v_n;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = r
                  AND (cmd = 'ALL' OR permissive <> 'PERMISSIVE')) THEN
      RAISE EXCEPTION '0098 post-condition failed: % has a FOR ALL or a restrictive policy', r;
    END IF;

    -- 11b. every policy names the workspace, the membership and the project
    --      hop; every write policy can_write_project; UPDATE's check is its
    --      USING, arm for arm.
    FOR t IN SELECT cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = r LOOP
      SELECT COALESCE(qual, '') || ' ' || COALESCE(with_check, '') INTO v_def
        FROM pg_policies WHERE schemaname = 'public' AND tablename = r AND cmd = t;
      IF position('current_workspace_id()' IN v_def) = 0
         OR position('has_active_membership(workspace_id)' IN v_def) = 0
         OR v_def !~ ('FROM projects p\s+WHERE \(p\.id = ' || r || '\.project_id\)') THEN
        RAISE EXCEPTION '0098 post-condition failed: the % policy on % lacks the workspace, the membership or the project hop: %', t, r, v_def;
      END IF;
      IF t <> 'SELECT' AND position('can_write_project(project_id)' IN v_def) = 0 THEN
        RAISE EXCEPTION '0098 post-condition failed: the % policy on % lacks can_write_project', t, r;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = r
                  AND cmd = 'UPDATE' AND (qual IS NULL OR with_check IS NULL OR qual <> with_check)) THEN
      RAISE EXCEPTION '0098 post-condition failed: %_update''s WITH CHECK is not its USING', r;
    END IF;

    -- 11c. privileges: anon / PUBLIC nothing; authenticated SELECT and
    --      DELETE whole, never a table-wide INSERT, UPDATE, TRUNCATE,
    --      REFERENCES or TRIGGER.
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema = 'public' AND table_name = r AND grantee IN ('anon', 'PUBLIC'))
       OR EXISTS (SELECT 1 FROM information_schema.column_privileges
                   WHERE table_schema = 'public' AND table_name = r AND grantee IN ('anon', 'PUBLIC')) THEN
      RAISE EXCEPTION '0098 post-condition failed: anon or PUBLIC holds a privilege on %', r;
    END IF;
    IF NOT (has_table_privilege('authenticated', 'public.' || r, 'SELECT')
            AND has_table_privilege('authenticated', 'public.' || r, 'DELETE')) THEN
      RAISE EXCEPTION '0098 post-condition failed: authenticated lacks SELECT or DELETE on %', r;
    END IF;
    IF has_table_privilege('authenticated', 'public.' || r, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || r, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || r, 'TRUNCATE')
       OR has_table_privilege('authenticated', 'public.' || r, 'REFERENCES')
       OR has_table_privilege('authenticated', 'public.' || r, 'TRIGGER') THEN
      RAISE EXCEPTION '0098 post-condition failed: authenticated holds a table-wide INSERT, UPDATE, TRUNCATE, REFERENCES or TRIGGER on %', r;
    END IF;
  END LOOP;

  --      The column grants, exactly.
  FOREACH t IN ARRAY ARRAY['id', 'project_id', 'table_key', 'name', 'position', 'config'] LOOP
    IF NOT has_column_privilege('authenticated', 'public.table_views', t, 'INSERT') THEN
      RAISE EXCEPTION '0098 post-condition failed: authenticated may not INSERT table_views.%', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['workspace_id', 'revision', 'revised_by', 'created_at', 'created_by', 'updated_at', 'updated_by'] LOOP
    IF has_column_privilege('authenticated', 'public.table_views', t, 'INSERT')
       OR has_column_privilege('authenticated', 'public.table_views', t, 'UPDATE') THEN
      RAISE EXCEPTION '0098 post-condition failed: authenticated may write table_views.%', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['name', 'position', 'config'] LOOP
    IF NOT has_column_privilege('authenticated', 'public.table_views', t, 'UPDATE') THEN
      RAISE EXCEPTION '0098 post-condition failed: authenticated may not UPDATE table_views.%', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['id', 'project_id', 'table_key'] LOOP
    IF has_column_privilege('authenticated', 'public.table_views', t, 'UPDATE') THEN
      RAISE EXCEPTION '0098 post-condition failed: authenticated may UPDATE table_views.% (an upsert would pass)', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['id', 'project_id', 'table_key', 'kind', 'entity_ids'] LOOP
    IF NOT has_column_privilege('authenticated', 'public.item_groupings', t, 'INSERT') THEN
      RAISE EXCEPTION '0098 post-condition failed: authenticated may not INSERT item_groupings.%', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['id', 'project_id', 'workspace_id', 'table_key', 'kind', 'entity_ids',
                           'created_at', 'created_by', 'updated_at', 'updated_by'] LOOP
    IF has_column_privilege('authenticated', 'public.item_groupings', t, 'UPDATE') THEN
      RAISE EXCEPTION '0098 post-condition failed: authenticated may UPDATE item_groupings.%', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['workspace_id', 'created_at', 'created_by', 'updated_at', 'updated_by'] LOOP
    IF has_column_privilege('authenticated', 'public.item_groupings', t, 'INSERT') THEN
      RAISE EXCEPTION '0098 post-condition failed: authenticated may INSERT item_groupings.%', t;
    END IF;
  END LOOP;
  --      The revision sequence: USAGE for the pin's nextval, nothing else.
  IF NOT has_sequence_privilege('authenticated', 'public.table_views_revision_seq', 'USAGE')
     OR has_sequence_privilege('authenticated', 'public.table_views_revision_seq', 'UPDATE')
     OR has_sequence_privilege('authenticated', 'public.table_views_revision_seq', 'SELECT')
     OR has_sequence_privilege('anon', 'public.table_views_revision_seq', 'USAGE') THEN
    RAISE EXCEPTION '0098 post-condition failed: table_views_revision_seq is not USAGE-only for authenticated (and nothing for anon)';
  END IF;

  -- 11d. the keys and CHECKs.
  FOREACH r IN ARRAY ARRAY['table_views', 'item_groupings'] LOOP
    SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
     WHERE conrelid = ('public.' || r)::regclass AND conname = r || '_project_fk';
    IF v_def IS NULL
       OR v_def NOT LIKE 'FOREIGN KEY (project_id, workspace_id) REFERENCES projects(id, workspace_id) ON DELETE CASCADE%' THEN
      RAISE EXCEPTION '0098 post-condition failed: %_project_fk is not the same-workspace project key ON DELETE CASCADE: %', r, v_def;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['table_views_table_key_chk', 'table_views_name_chk', 'table_views_position_chk',
                           'table_views_config_chk'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.table_views'::regclass
                      AND conname = t AND contype = 'c') THEN
      RAISE EXCEPTION '0098 post-condition failed: the CHECK % is missing on table_views', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['item_groupings_pair_chk', 'item_groupings_ids_chk'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.item_groupings'::regclass
                      AND conname = t AND contype = 'c') THEN
      RAISE EXCEPTION '0098 post-condition failed: the CHECK % is missing on item_groupings', t;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.item_groupings'::regclass
                    AND conname = 'item_groupings_set_key' AND contype = 'u'
                    AND pg_get_constraintdef(oid) = 'UNIQUE (project_id, table_key, kind, entity_ids)') THEN
    RAISE EXCEPTION '0098 post-condition failed: the unique (project_id, table_key, kind, entity_ids) is missing';
  END IF;

  -- 11e. the triggers.
  FOREACH t IN ARRAY ARRAY['trg_table_views_audit', 'trg_table_views_cap', 'trg_table_views_pin',
                           'trg_table_views_populate_workspace', 'trg_table_views_realtime'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.table_views'::regclass
                      AND tgname = t AND NOT tgisinternal) THEN
      RAISE EXCEPTION '0098 post-condition failed: % is not attached to table_views', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['trg_item_groupings_audit', 'trg_item_groupings_cap', 'trg_item_groupings_pin',
                           'trg_item_groupings_populate_workspace', 'trg_item_groupings_validate',
                           'trg_item_groupings_realtime'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.item_groupings'::regclass
                      AND tgname = t AND NOT tgisinternal) THEN
      RAISE EXCEPTION '0098 post-condition failed: % is not attached to item_groupings', t;
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['assets', 'scenes', 'shots', 'levels', 'experiences'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = ('public.' || r)::regclass
                      AND tgname = 'trg_' || r || '_item_groupings_forget' AND NOT tgisinternal
                      AND tgfoid = 'public.fn_item_groupings_forget()'::regprocedure) THEN
      RAISE EXCEPTION '0098 post-condition failed: trg_%_item_groupings_forget is not attached to %', r, r;
    END IF;
  END LOOP;

  -- 11f. the functions: every one SECURITY INVOKER but the sweep (and the
  --      broadcast, below); the trigger functions no client's; the reorder
  --      and the last-used write authenticated-only.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.prosecdef
                AND p.proname IN ('fn_is_sorted_uuid_set', 'fn_table_views_cap', 'fn_item_groupings_cap',
                                  'fn_table_views_pin', 'fn_item_groupings_pin', 'fn_item_groupings_validate',
                                  'reorder_table_views', 'set_table_view_last')) THEN
    RAISE EXCEPTION '0098 post-condition failed: a 0098 function that must run as the caller is SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_item_groupings_forget()'::regprocedure
                    AND prosecdef AND 'search_path=public' = ANY (proconfig)) THEN
    RAISE EXCEPTION '0098 post-condition failed: fn_item_groupings_forget is not SECURITY DEFINER with its search_path pinned';
  END IF;
  FOREACH t IN ARRAY ARRAY['public.fn_table_views_cap()', 'public.fn_item_groupings_cap()',
                           'public.fn_table_views_pin()', 'public.fn_item_groupings_pin()',
                           'public.fn_item_groupings_validate()', 'public.fn_item_groupings_forget()'] LOOP
    IF has_function_privilege('authenticated', t, 'EXECUTE') OR has_function_privilege('anon', t, 'EXECUTE') THEN
      RAISE EXCEPTION '0098 post-condition failed: % is executable by a client role', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['public.reorder_table_views(uuid, text, uuid[])',
                           'public.set_table_view_last(text, text)'] LOOP
    IF NOT has_function_privilege('authenticated', t, 'EXECUTE')
       OR has_function_privilege('anon', t, 'EXECUTE') THEN
      RAISE EXCEPTION '0098 post-condition failed: % is not authenticated-only', t;
    END IF;
  END LOOP;

  -- 11g. the realtime body: every one of the eighteen names exactly once
  --      (comments stripped first — 0077 §3c), every trigger attached, and
  --      0088's money arm for files kept.
  v_body := pg_get_functiondef('public.fn_realtime_broadcast()'::regprocedure);
  v_body := regexp_replace(v_body, '/\*.*?\*/', '', 'gs');
  v_body := regexp_replace(v_body, '--[^' || chr(10) || ']*', '', 'g');
  FOREACH t IN ARRAY ARRAY['projects', 'phases', 'assets', 'tasks', 'files',
                           'comments', 'task_dependencies', 'phase_dependencies',
                           'task_links', 'asset_versions', 'project_members',
                           'milestones', 'bins', 'bin_files', 'shot_takes',
                           'task_items', 'table_views', 'item_groupings'] LOOP
    v_hits := (length(v_body) - length(replace(v_body, '''' || t || '''', ''))) / length('''' || t || '''');
    IF v_hits <> 1 THEN
      RAISE EXCEPTION '0098 post-condition failed: fn_realtime_broadcast names % % times (expected exactly 1)', t, v_hits;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = ('public.' || quote_ident(t))::regclass
                      AND tgname = 'trg_' || t || '_realtime') THEN
      RAISE EXCEPTION '0098 post-condition failed: trg_%_realtime is not attached', t;
    END IF;
  END LOOP;
  IF v_body NOT LIKE '%file_row_is_money((to_jsonb(NEW)%' OR v_body NOT LIKE '%file_row_is_money((to_jsonb(OLD)%' THEN
    RAISE EXCEPTION '0098 post-condition failed: fn_realtime_broadcast lost 0088''s money arm for files (both NEW and OLD)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'fn_realtime_broadcast' AND p.prosecdef) THEN
    RAISE EXCEPTION '0098 post-condition failed: fn_realtime_broadcast is no longer SECURITY DEFINER';
  END IF;
  -- §0's re-run guard names §10's body by its md5: an edit of §10 must carry
  -- the new md5 to §0, or a re-run of this very file would refuse.
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc
       WHERE oid = 'public.fn_realtime_broadcast()'::regprocedure) IS DISTINCT FROM 'e5abdcf2b8abce914416acb148144971' THEN
    RAISE EXCEPTION '0098 post-condition failed: §10''s body is not the one §0 names (update §0''s md5)';
  END IF;

  -- 11h. the last used view: the column, its CHECK, and user_settings' four
  --      own-row policies untouched.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'user_settings'
                    AND column_name = 'table_view_last' AND data_type = 'jsonb' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION '0098 post-condition failed: user_settings.table_view_last is not a NOT NULL jsonb column';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.user_settings'::regclass
                    AND conname = 'user_settings_table_view_last_chk' AND contype = 'c') THEN
    RAISE EXCEPTION '0098 post-condition failed: user_settings_table_view_last_chk is missing';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_settings';
  IF v_n <> 4 THEN
    RAISE EXCEPTION '0098 post-condition failed: user_settings has % policies, expected its four own-row ones (0046)', v_n;
  END IF;
END $$;


-- =============================================================================
-- 12. COMMENTS
-- =============================================================================

COMMENT ON TABLE public.table_views IS
  '0098 (VW1c, 2026-10-17): a named, saved way of showing one table (tasks, assets, scenes, shots, levels, experiences) in one project, shared with its team (Q1); saved by anyone can_write_project admits (Q2). config is the client''s JSON object (at most 32 KB; design §5.1); position the dropdown''s order (Q5c); revision a number from table_views_revision_seq taken on insert and on every change of config (never on a rename or a reorder), so a change for now saves only over the view it started from. The built-in All view is never stored.';
COMMENT ON COLUMN public.table_views.revision IS
  '0098: from table_views_revision_seq (one sequence for every view: a view made again with its id never repeats a number) on insert and on every change of config; revised_by is who made it.';
COMMENT ON TABLE public.item_groupings IS
  '0098 (VW1c, 2026-10-17): a grouping made with Create grouping (Q-D2: saved for the project) — one set of items of one kind (sorted, distinct, 1 to 100 ids, each a row of the project when made), unique per (project, table_key, kind). It holds no rows: rows join it by having exactly its items. An item deleted for good leaves it (fn_item_groupings_forget); an item in the trash stays named and the client hides the grouping while it is there (Q-N4).';
COMMENT ON COLUMN public.user_settings.table_view_last IS
  '0098 (VW1c): the view each person last used on each table of each project (Q4) — { "<project id>:<table key>": { "view": <view id or "all">, "at": <epoch ms, the server''s> } }, the 300 newest. Written by the client only through set_table_view_last; read by its own request.';
COMMENT ON FUNCTION public.reorder_table_views(UUID, TEXT, UUID[]) IS
  '0098 (VW1c): one project''s views of one table reordered in one statement — the named ids first in the order given, the rest after in their current order, positions dense from 0. SECURITY INVOKER: table_views'' policies decide what it reads and writes.';
COMMENT ON FUNCTION public.set_table_view_last(TEXT, TEXT) IS
  '0098 (VW1c): the last used view of one table — one statement that inserts the person''s user_settings row the first time and otherwise merges the one key, stamped with the server''s clock, keeping the 300 newest. SECURITY INVOKER: the person''s own row only.';
COMMENT ON FUNCTION public.fn_item_groupings_forget() IS
  '0098 (VW1c): AFTER DELETE on assets, scenes, shots, levels and experiences — the deleted row''s id leaves every grouping of its kind in its project; a grouping left empty, or naming another''s set, is deleted. SECURITY DEFINER (a member deleting a scene holds no UPDATE on item_groupings), EXECUTE revoked from every client.';
COMMENT ON FUNCTION public.fn_realtime_broadcast() IS
  'Session 7 (0016): publishes every write on the project-scoped RABBIT tables to the private topic rabbit:project:{project_id} via realtime.broadcast_changes. Full old/new rows — soft deletes and restores deliver, unlike postgres_changes under the 0014 SELECT policies. Never aborts the write. EIGHTEEN tables as of 0098: projects, phases, assets, tasks, files (0088: money rows excluded), comments, task_dependencies, phase_dependencies (0061), task_links, asset_versions, project_members, milestones (0077), bins, bin_files, shot_takes (0091), task_items (0096), table_views, item_groupings (0098).';
