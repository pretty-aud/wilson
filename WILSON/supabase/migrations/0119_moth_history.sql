-- =============================================================================
-- 0119_moth_history.sql — M.O.T.H. Session 1 (MO1), the record of what changed
-- (docs/design/MOTH_DESIGN.md §1.4 "0119", §1.6, §2.5 H1 to H11).
--
-- WHAT IS NEW
-- -----------
-- A 90-day record of every structural change to eleven tables, metadata only, read back so
-- that the past can be rebuilt from today's live rows. No baseline copy: a mark says when
-- recording began, and every change holds both its before and its after.
--
--   §1  moth_history, enabled and not forced, no policies, no client grant: only definers
--       write it and only definers read it.
--   §2  What may be stored: moth_history_projection_ok, moth_history_project.
--   §3  fn_moth_history_capture and its 22 triggers. A failed capture never fails the
--       person's write: it leaves a mark saying the record restarts here.
--   §4  The marks that say when recording began.
--   §5  moth_history_read and moth_history_window, one refusal for every cause.
--   §6  purge_moth_history, and its job at 04:45.
--   §7  COMMENTs; §8 post-conditions.
--
-- 🚨 Money and Legal: when a side is locked, capture writes nothing and redacts every earlier
-- row of that entity. That is the one change ever made to a row here but the purge.
--
-- CREATE TRIGGER takes SHARE ROW EXCLUSIVE on eleven hot tables, so every write to them waits
-- while this runs. It waits itself behind any open writer, and later writes queue behind that
-- wait: the 15 s below refuses rather than let them pile up. A refusal is safe; run it again.
-- Off-hours on staging and production. Suite 121_moth_history.sql.
-- =============================================================================

SET LOCAL lock_timeout = '15s';

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
DECLARE
  v_md5 TEXT;
  v_fn  RECORD;
BEGIN
  -- Inside this block: the CLI that builds a fresh stack runs a file's statements one by one, and
  -- a bare LOCK TABLE there refuses ("can only be used in transaction blocks").
  LOCK TABLE public.projects IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.files IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.folders IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.phases IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.assets IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.tasks IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.scenes IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.shots IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.levels IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.experiences IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.task_items IN SHARE ROW EXCLUSIVE MODE;

  -- A later migration may have restated what this file creates, and running this again would
  -- quietly undo it (0098's guard).
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
     AND EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version > '0119') THEN
    RAISE EXCEPTION '0119 refused: a later migration is recorded, and this would undo what it restated';
  END IF;
  IF to_regprocedure('public.fn_moth_history_capture()') IS NOT NULL THEN
    SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc WHERE oid = 'public.fn_moth_history_capture()'::regprocedure;
    IF v_md5 IS DISTINCT FROM '5b3806806f9250f63a8391f3a6558178' THEN
      RAISE EXCEPTION '0119 refused: fn_moth_history_capture is not this file''s (md5 %)', v_md5;
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'personal_owner_id')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.projects'::regclass AND conname = 'projects_personal_shape_chk')
     OR to_regprocedure('public.fn_projects_owner_guard()') IS NULL THEN
    RAISE EXCEPTION '0119 refused: 0110''s personal space must be applied first';
  END IF;
  IF to_regprocedure('public._moth_target_eligible(text,uuid,boolean)') IS NULL
     OR to_regprocedure('public.moth_can_read_target(text,uuid)') IS NULL
     OR to_regprocedure('public.moth_file_row_locked(uuid,uuid,uuid,boolean,text,text[],uuid)') IS NULL
     OR to_regprocedure('public.moth_folder_path_locked(text)') IS NULL
     OR to_regprocedure('public.moth_folder_chain_locked(uuid,uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.folders'::regclass AND tgname = 'trg_folders_lock_guard') THEN
    RAISE EXCEPTION '0119 refused: 0111''s read path and the folder lock guard must be applied first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.files'::regclass AND conname = 'files_folder_same_project_fk')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.folders'::regclass AND conname = 'folders_parent_same_project_fk') THEN
    RAISE EXCEPTION '0119 refused: 0113''s composite keys must be applied first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'files' AND column_name = 'share_missing_since') THEN
    RAISE EXCEPTION '0119 refused: files.share_missing_since is missing; 0117 must be applied first';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'public.file_events'::regclass AND conname = 'file_events_event_check') NOT LIKE '%moved_out%refiled%' THEN
    RAISE EXCEPTION '0119 refused: file_events lacks 0116''s vocabulary';
  END IF;
  IF to_regprocedure('public.moth_move_items(uuid[],uuid,uuid,boolean,jsonb)') IS NULL THEN
    RAISE EXCEPTION '0119 refused: 0118''s moves must be applied first';
  END IF;
  IF to_regprocedure('public.file_row_is_money(boolean,text)') IS NULL
     OR to_regprocedure('public.rabbit_money_segment(text)') IS NULL
     OR to_regprocedure('public.has_active_membership(uuid)') IS NULL
     OR to_regprocedure('public.current_workspace_id()') IS NULL THEN
    RAISE EXCEPTION '0119 refused: the money classifier or the membership guard is missing';
  END IF;
  -- The definers below read tables with row security forced (0069's lesson).
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0119 refused: % does not bypass row security', current_user;
  END IF;

  -- History and Moth's live gate must not drift: both ask these (the design's risks, H5).
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('public.moth_file_row_locked(uuid,uuid,uuid,boolean,text,text[],uuid)', '4d9e1e0a6fed7a545d2429b6c1351711'),
      ('public.moth_folder_path_locked(text)', '7238efa894891148f86bd1df907dac7f'),
      ('public.moth_folder_chain_locked(uuid,uuid)', '811ca340322f7ea6eda3db8e7a7a7c9b'),
      ('public._moth_target_eligible(text,uuid,boolean)', '06ce9d801842872e467b9dcc119cb063')
    ) AS t(sig, was)
  LOOP
    SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc WHERE oid = v_fn.sig::regprocedure;
    IF v_md5 IS DISTINCT FROM v_fn.was THEN
      RAISE EXCEPTION '0119 refused: % is not the body this file was built on (md5 %)', v_fn.sig, v_md5;
    END IF;
  END LOOP;
END $$;

-- §2 first, because the table's CHECK calls it --------------------------------------------------
-- What may be stored. Never NULL: a CHECK treats NULL as a pass. plpgsql, because this runs in a
-- CHECK on every captured row and a SQL function with a SET is planned afresh each time (0111's trap).
CREATE OR REPLACE FUNCTION public.moth_history_projection_ok(p jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN CASE
    WHEN p IS NULL OR jsonb_typeof(p) <> 'object' THEN false
    WHEN octet_length(p::text) > 4096 THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM jsonb_each(p) e
       WHERE NOT e.key = ANY (ARRAY['name', 'title', 'slug', 'kind', 'type', 'type_label', 'status', 'document_kind', 'mime_type',
                                    'size_bytes', 'categories', 'is_core_definer', 'missing', 'number', 'parent_id', 'parent_phase_id',
                                    'folder_id', 'phase_id', 'asset_id', 'task_id', 'scene_id', 'shot_id', 'level_id', 'experience_id',
                                    'scene_ids', 'shot_ids', 'level_ids', 'experience_ids', 'item_type', 'item_id', 'position',
                                    'sort_order', 'truncated'])
          OR jsonb_typeof(e.value) = 'object'
          OR (jsonb_typeof(e.value) = 'string' AND length(e.value #>> '{}') > 300)
          OR CASE WHEN jsonb_typeof(e.value) = 'array'
                  THEN jsonb_array_length(e.value) > 200
                       OR EXISTS (SELECT 1 FROM jsonb_array_elements(e.value) x WHERE jsonb_typeof(x) IN ('object', 'array'))
                  ELSE false END
    )
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.moth_history_projection_ok(jsonb) FROM PUBLIC, anon, authenticated;

-- A row's metadata, by a map per table. Bounds its own output, so the CHECK refuses only what this
-- cannot emit: text to 300 characters, arrays to 200. Then, while it would pass the 4,096 octets the
-- CHECK allows (four arrays of ids do; so does text that takes six octets a character), it cuts
-- harder, down to a row that says only that it was cut. truncated says so.
CREATE OR REPLACE FUNCTION public.moth_history_project(p_table text, p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  r     jsonb;
  v_out jsonb := '{}'::jsonb;
  e     record;
  v     jsonb;
  n     integer;
  v_cut boolean := false;
BEGIN
  IF p_row IS NULL THEN
    RETURN NULL;
  END IF;
  r := CASE p_table
    WHEN 'projects' THEN jsonb_build_object('title', p_row -> 'title', 'status', p_row -> 'status', 'type', p_row -> 'project_type')
    WHEN 'phases' THEN jsonb_build_object('name', p_row -> 'name', 'status', p_row -> 'status', 'parent_phase_id', p_row -> 'parent_phase_id', 'sort_order', p_row -> 'sort_order')
    WHEN 'assets' THEN jsonb_build_object('name', p_row -> 'name', 'type', p_row -> 'type', 'type_label', p_row -> 'type_label', 'status', p_row -> 'status',
                                          'phase_id', p_row -> 'phase_id', 'sort_order', p_row -> 'sort_order', 'scene_ids', p_row -> 'scene_ids',
                                          'shot_ids', p_row -> 'shot_ids', 'level_ids', p_row -> 'level_ids', 'experience_ids', p_row -> 'experience_ids')
    WHEN 'tasks' THEN jsonb_build_object('title', p_row -> 'title', 'status', p_row -> 'status', 'phase_id', p_row -> 'phase_id', 'asset_id', p_row -> 'asset_id',
                                         'scene_id', p_row -> 'scene_id', 'shot_id', p_row -> 'shot_id')
    WHEN 'files' THEN jsonb_build_object('name', p_row -> 'name', 'kind', p_row -> 'kind', 'mime_type', p_row -> 'mime_type', 'size_bytes', p_row -> 'size_bytes',
                                         'document_kind', p_row -> 'document_kind', 'categories', p_row -> 'tags', 'is_core_definer', p_row -> 'is_core_definer',
                                         'folder_id', p_row -> 'folder_id', 'phase_id', p_row -> 'phase_id', 'asset_id', p_row -> 'asset_id', 'task_id', p_row -> 'task_id',
                                         'scene_id', p_row -> 'scene_id', 'shot_id', p_row -> 'shot_id', 'level_id', p_row -> 'level_id', 'experience_id', p_row -> 'experience_id',
                                         'missing', to_jsonb(jsonb_typeof(p_row -> 'share_missing_since') = 'string'))
    WHEN 'folders' THEN jsonb_build_object('name', COALESCE(NULLIF(p_row -> 'label', 'null'::jsonb), p_row -> 'slug'), 'slug', p_row -> 'slug', 'kind', p_row -> 'kind',
                                           'item_type', p_row -> 'entity_type', 'parent_id', p_row -> 'parent_id', 'sort_order', p_row -> 'sort_order',
                                           'asset_id', p_row -> 'asset_id', 'scene_id', p_row -> 'scene_id', 'shot_id', p_row -> 'shot_id',
                                           'level_id', p_row -> 'level_id', 'experience_id', p_row -> 'experience_id')
    WHEN 'scenes' THEN jsonb_build_object('name', p_row -> 'name', 'number', p_row -> 'scene_number', 'status', p_row -> 'status', 'sort_order', p_row -> 'sort_order')
    WHEN 'shots' THEN jsonb_build_object('name', p_row -> 'name', 'number', p_row -> 'shot_number', 'scene_id', p_row -> 'scene_id', 'status', p_row -> 'status', 'sort_order', p_row -> 'sort_order')
    WHEN 'levels' THEN jsonb_build_object('name', p_row -> 'name', 'status', p_row -> 'status', 'sort_order', p_row -> 'sort_order')
    WHEN 'experiences' THEN jsonb_build_object('name', p_row -> 'name', 'status', p_row -> 'status', 'sort_order', p_row -> 'sort_order')
    WHEN 'task_items' THEN jsonb_build_object('task_id', p_row -> 'task_id', 'item_type', p_row -> 'entity_type', 'item_id', p_row -> 'entity_id', 'position', p_row -> 'position')
  END;
  IF r IS NULL THEN
    RAISE EXCEPTION 'moth_history_project: no map for %', p_table;
  END IF;
  FOR e IN SELECT x.key, x.value FROM jsonb_each(jsonb_strip_nulls(r)) x LOOP
    v := e.value;
    IF jsonb_typeof(v) = 'string' AND length(v #>> '{}') > 300 THEN
      v := to_jsonb(left(v #>> '{}', 300));
      v_cut := true;
    ELSIF jsonb_typeof(v) = 'array' AND jsonb_array_length(v) > 200 THEN
      v := (SELECT jsonb_agg(a.x ORDER BY a.o) FROM jsonb_array_elements(v) WITH ORDINALITY a(x, o) WHERE a.o <= 200);
      v_cut := true;
    END IF;
    v_out := v_out || jsonb_build_object(e.key, v);
  END LOOP;
  -- Each pass cuts harder, and the last leaves nothing that can be too long.
  FOREACH n IN ARRAY ARRAY[20, 5, 0] LOOP
    EXIT WHEN octet_length(v_out::text) <= 4000;
    v_cut := true;
    FOR e IN SELECT x.key, x.value FROM jsonb_each(v_out) x LOOP
      IF jsonb_typeof(e.value) = 'array' AND jsonb_array_length(e.value) > n THEN
        v_out := CASE WHEN n = 0 THEN v_out - e.key ELSE v_out || jsonb_build_object(e.key,
          (SELECT jsonb_agg(a.x ORDER BY a.o) FROM jsonb_array_elements(e.value) WITH ORDINALITY a(x, o) WHERE a.o <= n)) END;
      ELSIF jsonb_typeof(e.value) = 'string' AND n < 20 AND length(e.value #>> '{}') > GREATEST(n * 8, 8) THEN
        v_out := v_out || jsonb_build_object(e.key, left(e.value #>> '{}', GREATEST(n * 8, 8)));
      END IF;
    END LOOP;
  END LOOP;
  IF v_cut THEN
    v_out := v_out || '{"truncated": true}'::jsonb;
  END IF;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.moth_history_project(text, jsonb) FROM PUBLIC, anon, authenticated;

-- §1 The table ---------------------------------------------------------------------------------
-- Enabled and not forced, as edit_history and file_events are (0012): the only writers are definers,
-- and all the audience logic stays in one reader, with no helper in a policy to ask.
CREATE TABLE IF NOT EXISTS public.moth_history (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  row_key          uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type      text NOT NULL,
  entity_id        uuid NOT NULL,
  action           text NOT NULL,
  mark_kind        text,
  observed_at      timestamptz NOT NULL DEFAULT now(),
  actor_user_id    uuid,
  prior_project_id uuid,
  prior_class      text,
  prior_owner_id   uuid,
  prior            jsonb,
  state_project_id uuid,
  state_class      text,
  state_owner_id   uuid,
  state            jsonb,
  locked           boolean NOT NULL DEFAULT false,
  -- Named in sort order, so a fixture breaks exactly one.
  CONSTRAINT moth_history_a_action_chk
    CHECK (action IN ('create', 'update', 'move', 'trash', 'restore', 'delete', 'mark_recording')),
  CONSTRAINT moth_history_b_entity_chk
    CHECK ((action = 'mark_recording' AND entity_type ~ '^[a-z_]{1,63}$')
           OR entity_type IN ('projects', 'phases', 'assets', 'tasks', 'files', 'folders', 'scenes', 'shots', 'levels', 'experiences', 'task_items')),
  CONSTRAINT moth_history_c_class_chk
    CHECK ((prior_class IS NULL OR prior_class IN ('shared', 'private', 'personal'))
           AND (state_class IS NULL OR state_class IN ('shared', 'private', 'personal'))
           AND (prior_class IS DISTINCT FROM 'personal' OR prior_owner_id IS NOT NULL)
           AND (state_class IS DISTINCT FROM 'personal' OR state_owner_id IS NOT NULL)
           AND (prior_class IS DISTINCT FROM 'shared' OR prior_owner_id IS NULL)
           AND (state_class IS DISTINCT FROM 'shared' OR state_owner_id IS NULL)),
  CONSTRAINT moth_history_d_shape_chk
    CHECK ((action <> 'create' OR (prior IS NULL AND prior_project_id IS NULL AND prior_class IS NULL))
           AND (action <> 'delete' OR (state IS NULL AND state_project_id IS NULL AND state_class IS NULL))
           AND (action <> 'mark_recording'
                OR (prior IS NULL AND state IS NULL AND mark_kind IS NOT NULL AND mark_kind IN ('baseline', 'suspended', 'capture_failed')
                    AND NOT locked AND actor_user_id IS NULL))
           AND (mark_kind IS NULL OR mark_kind NOT IN ('baseline', 'suspended') OR (prior_project_id IS NULL AND state_project_id IS NULL))
           AND (action = 'mark_recording' OR mark_kind IS NULL)),
  CONSTRAINT moth_history_e_locked_chk
    CHECK (NOT locked OR (prior IS NULL AND state IS NULL)),
  CONSTRAINT moth_history_f_projection_chk
    CHECK ((prior IS NULL OR public.moth_history_projection_ok(prior)) AND (state IS NULL OR public.moth_history_projection_ok(state)))
);
CREATE UNIQUE INDEX IF NOT EXISTS moth_history_row_key_idx ON public.moth_history (row_key);
CREATE INDEX IF NOT EXISTS moth_history_ws_time_idx ON public.moth_history (workspace_id, observed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS moth_history_state_project_idx ON public.moth_history (workspace_id, state_project_id, observed_at DESC, id DESC) WHERE state_project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_history_prior_project_idx ON public.moth_history (workspace_id, prior_project_id, observed_at DESC, id DESC) WHERE prior_project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_history_entity_idx ON public.moth_history (workspace_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS moth_history_entity_locked_idx ON public.moth_history (workspace_id, entity_type, entity_id) WHERE locked;
CREATE INDEX IF NOT EXISTS moth_history_observed_idx ON public.moth_history (observed_at);
-- The window asks for a dozen marks among everything else.
CREATE INDEX IF NOT EXISTS moth_history_marks_idx ON public.moth_history (workspace_id, entity_type, observed_at DESC) WHERE action = 'mark_recording';

ALTER TABLE public.moth_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.moth_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.moth_history_id_seq FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.moth_history TO service_role;
GRANT ALL ON SEQUENCE public.moth_history_id_seq TO service_role;

-- §3 Capture ------------------------------------------------------------------------------------
-- Who a side of a change was for, as it was then. A projects row carries its own answer, and has to:
-- after a delete there is no row to ask, and on an update the row reads only as it is now.
CREATE OR REPLACE FUNCTION public._moth_history_audience(
  p_table text, p_image jsonb, p_project uuid, OUT o_class text, OUT o_owner uuid)
RETURNS record
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_personal uuid;
  v_private  boolean;
  v_creator  uuid;
BEGIN
  IF p_image IS NULL OR p_project IS NULL THEN
    RETURN;
  END IF;
  BEGIN
    IF p_table = 'projects' THEN
      v_personal := (p_image ->> 'personal_owner_id')::uuid;
      v_private := (p_image ->> 'is_private')::boolean;
      v_creator := (p_image ->> 'created_by')::uuid;
    ELSE
      SELECT p.personal_owner_id, p.is_private, p.created_by INTO v_personal, v_private, v_creator
        FROM public.projects p WHERE p.id = p_project;
      IF NOT FOUND THEN
        RETURN;
      END IF;
    END IF;
    IF v_personal IS NOT NULL THEN
      o_class := 'personal';
      o_owner := v_personal;
    ELSIF COALESCE(v_private, false) THEN
      o_class := 'private';
      o_owner := v_creator;
    ELSE
      o_class := 'shared';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    o_class := NULL;
    o_owner := NULL;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public._moth_history_audience(text, jsonb, uuid) FROM PUBLIC, anon, authenticated;

-- A folder side is locked the way moth_folder_chain_locked says, from the row's image, because a
-- deleted row can no longer be walked from: its own path, its own money slug under a root, or any
-- folder above it. Asking the path alone recorded the children of a renamed money category, and
-- once deleted they read as nothing's.
CREATE OR REPLACE FUNCTION public._moth_history_folder_locked(p_ws uuid, p_image jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_parent uuid := (p_image ->> 'parent_id')::uuid;
BEGIN
  IF p_image IS NULL OR p_image ->> 'kind' = 'root' THEN
    RETURN false;
  END IF;
  IF COALESCE(public.moth_folder_path_locked(p_image ->> 'path'), false) THEN
    RETURN true;
  END IF;
  IF COALESCE(public.rabbit_money_segment(p_image ->> 'slug'), false)
     AND EXISTS (SELECT 1 FROM public.folders r WHERE r.id = v_parent AND r.kind = 'root') THEN
    RETURN true;
  END IF;
  RETURN COALESCE(public.moth_folder_chain_locked(p_ws, v_parent), false);
END;
$$;
REVOKE ALL ON FUNCTION public._moth_history_folder_locked(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- A failed capture never fails the person's write. It leaves a mark, scoped to the sides of the row
-- that failed, saying the record for this type and project is reliable only from here (H4).
CREATE OR REPLACE FUNCTION public.fn_moth_history_capture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_t      text := TG_TABLE_NAME;
  v_old    jsonb;
  v_new    jsonb;
  v_ws     uuid;
  v_id     uuid;
  v_pp     uuid;
  v_sp     uuid;
  v_pc     text;
  v_sc     text;
  v_po     uuid;
  v_so     uuid;
  v_prior  jsonb;
  v_state  jsonb;
  v_action text;
  v_locked boolean := false;
  v_keys   text[];
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old := to_jsonb(OLD);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new := to_jsonb(NEW);
  END IF;
  v_id := (COALESCE(v_new, v_old) ->> 'id')::uuid;
  IF v_t = 'projects' THEN
    v_pp := (v_old ->> 'id')::uuid;
    v_sp := (v_new ->> 'id')::uuid;
  ELSE
    v_pp := (v_old ->> 'project_id')::uuid;
    v_sp := (v_new ->> 'project_id')::uuid;
  END IF;

  -- A child of a project that has gone: nobody can ever read a row about it, because a side needs
  -- its project to pass the gate, so writing one is only cost (a purge of 50,000 files). And it would
  -- need a company from the caller's claims, which may name another or not parse at all.
  IF TG_OP = 'DELETE' AND v_t <> 'projects' AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = v_pp) THEN
    RETURN NULL;
  END IF;
  -- Phases have no workspace of their own. Never the caller's: a row belongs to its project's company.
  v_ws := (COALESCE(v_new, v_old) ->> 'workspace_id')::uuid;
  IF v_ws IS NULL THEN
    SELECT p.workspace_id INTO v_ws FROM public.projects p WHERE p.id = COALESCE(v_sp, v_pp);
  END IF;
  -- A company being deleted: its rows go with it, and nothing is left to record against.
  IF v_ws IS NULL OR NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = v_ws) THEN
    RETURN NULL;
  END IF;

  SELECT a.o_class, a.o_owner INTO v_pc, v_po FROM public._moth_history_audience(v_t, v_old, v_pp) a;
  SELECT a.o_class, a.o_owner INTO v_sc, v_so FROM public._moth_history_audience(v_t, v_new, v_sp) a;

  BEGIN
    -- Money and Legal stay out of Moth for every role, even after a trash or a purge. A locked side
    -- writes nothing, and every earlier row of the entity goes blank. Money-ness only grows.
    IF v_t = 'files' THEN
      IF v_old IS NOT NULL THEN
        v_locked := v_locked OR COALESCE(public.moth_file_row_locked(v_ws, v_pp, v_id, (v_old ->> 'is_financial')::boolean, v_old ->> 'storage_path',
          CASE WHEN jsonb_typeof(v_old -> 'tags') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(v_old -> 'tags')) END,
          (v_old ->> 'folder_id')::uuid), false);
      END IF;
      IF v_new IS NOT NULL THEN
        v_locked := v_locked OR COALESCE(public.moth_file_row_locked(v_ws, v_sp, v_id, (v_new ->> 'is_financial')::boolean, v_new ->> 'storage_path',
          CASE WHEN jsonb_typeof(v_new -> 'tags') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(v_new -> 'tags')) END,
          (v_new ->> 'folder_id')::uuid), false);
      END IF;
    ELSIF v_t = 'folders' THEN
      v_locked := public._moth_history_folder_locked(v_ws, v_old) OR public._moth_history_folder_locked(v_ws, v_new);
    END IF;
    IF v_locked THEN
      UPDATE public.moth_history h
         SET prior = NULL, state = NULL, locked = true
       WHERE h.workspace_id = v_ws AND h.entity_type = v_t AND h.entity_id = v_id AND NOT h.locked
         AND h.action <> 'mark_recording';
      RETURN NULL;
    END IF;

    v_prior := public.moth_history_project(v_t, v_old);
    v_state := public.moth_history_project(v_t, v_new);

    v_keys := CASE v_t
      WHEN 'files' THEN ARRAY['project_id', 'folder_id']
      WHEN 'folders' THEN ARRAY['project_id', 'parent_id']
      WHEN 'phases' THEN ARRAY['parent_phase_id']
      WHEN 'assets' THEN ARRAY['phase_id']
      WHEN 'tasks' THEN ARRAY['phase_id', 'asset_id']
      WHEN 'shots' THEN ARRAY['scene_id']
      ELSE '{}'::text[]
    END;
    v_action := CASE
      WHEN TG_OP = 'INSERT' THEN 'create'
      WHEN TG_OP = 'DELETE' THEN 'delete'
      WHEN v_old ->> 'deleted_at' IS NULL AND v_new ->> 'deleted_at' IS NOT NULL THEN 'trash'
      WHEN v_old ->> 'deleted_at' IS NOT NULL AND v_new ->> 'deleted_at' IS NULL THEN 'restore'
      WHEN EXISTS (SELECT 1 FROM unnest(v_keys) k WHERE v_old -> k IS DISTINCT FROM v_new -> k) THEN 'move'
      ELSE 'update'
    END;

    -- The WHEN lists hold what classification needs as well as what is stored, so an update can
    -- come here with nothing to say. Only an update: a trash, a restore and a move always speak.
    IF v_action = 'update'
       AND v_prior IS NOT DISTINCT FROM v_state
       AND v_pp IS NOT DISTINCT FROM v_sp
       AND v_pc IS NOT DISTINCT FROM v_sc
       AND v_po IS NOT DISTINCT FROM v_so THEN
      RETURN NULL;
    END IF;

    INSERT INTO public.moth_history
      (workspace_id, entity_type, entity_id, action, actor_user_id,
       prior_project_id, prior_class, prior_owner_id, prior,
       state_project_id, state_class, state_owner_id, state)
    VALUES
      (v_ws, v_t, v_id, v_action, auth.uid(),
       v_pp, v_pc, v_po, v_prior,
       v_sp, v_sc, v_so, v_state);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'moth_history capture failed on % %: %', v_t, v_id, SQLERRM;
    BEGIN
      INSERT INTO public.moth_history
        (workspace_id, entity_type, entity_id, action, mark_kind,
         prior_project_id, prior_class, prior_owner_id,
         state_project_id, state_class, state_owner_id)
      VALUES
        (v_ws, v_t, v_ws, 'mark_recording', 'capture_failed',
         v_pp, v_pc, v_po,
         v_sp, v_sc, v_so);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'moth_history could not mark the restart: %', SQLERRM;
    END;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_moth_history_capture() FROM PUBLIC, anon, authenticated;

-- Two triggers per table. is_financial, storage_path, tags and path are in these lists for classification only.
CREATE OR REPLACE TRIGGER trg_projects_moth_history
  AFTER INSERT OR DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_projects_moth_history_upd
  AFTER UPDATE ON public.projects
  FOR EACH ROW
  WHEN (ROW(OLD.title, OLD.status, OLD.project_type, OLD.is_private, OLD.personal_owner_id, OLD.deleted_at) IS DISTINCT FROM ROW(NEW.title, NEW.status, NEW.project_type, NEW.is_private, NEW.personal_owner_id, NEW.deleted_at))
  EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_phases_moth_history
  AFTER INSERT OR DELETE ON public.phases
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_phases_moth_history_upd
  AFTER UPDATE ON public.phases
  FOR EACH ROW
  WHEN (ROW(OLD.name, OLD.status, OLD.parent_phase_id, OLD.sort_order, OLD.deleted_at) IS DISTINCT FROM ROW(NEW.name, NEW.status, NEW.parent_phase_id, NEW.sort_order, NEW.deleted_at))
  EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_assets_moth_history
  AFTER INSERT OR DELETE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_assets_moth_history_upd
  AFTER UPDATE ON public.assets
  FOR EACH ROW
  WHEN (ROW(OLD.name, OLD.type, OLD.type_label, OLD.status, OLD.phase_id, OLD.sort_order, OLD.scene_ids, OLD.shot_ids, OLD.level_ids, OLD.experience_ids, OLD.deleted_at) IS DISTINCT FROM ROW(NEW.name, NEW.type, NEW.type_label, NEW.status, NEW.phase_id, NEW.sort_order, NEW.scene_ids, NEW.shot_ids, NEW.level_ids, NEW.experience_ids, NEW.deleted_at))
  EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_tasks_moth_history
  AFTER INSERT OR DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_tasks_moth_history_upd
  AFTER UPDATE ON public.tasks
  FOR EACH ROW
  WHEN (ROW(OLD.title, OLD.status, OLD.phase_id, OLD.asset_id, OLD.scene_id, OLD.shot_id, OLD.project_id, OLD.deleted_at) IS DISTINCT FROM ROW(NEW.title, NEW.status, NEW.phase_id, NEW.asset_id, NEW.scene_id, NEW.shot_id, NEW.project_id, NEW.deleted_at))
  EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_files_moth_history
  AFTER INSERT OR DELETE ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_files_moth_history_upd
  AFTER UPDATE ON public.files
  FOR EACH ROW
  WHEN (ROW(OLD.name, OLD.project_id, OLD.folder_id, OLD.kind, OLD.mime_type, OLD.size_bytes, OLD.document_kind, OLD.tags, OLD.is_core_definer, OLD.phase_id, OLD.asset_id, OLD.task_id, OLD.scene_id, OLD.shot_id, OLD.level_id, OLD.experience_id, OLD.deleted_at, OLD.is_financial, OLD.storage_path, OLD.share_missing_since) IS DISTINCT FROM ROW(NEW.name, NEW.project_id, NEW.folder_id, NEW.kind, NEW.mime_type, NEW.size_bytes, NEW.document_kind, NEW.tags, NEW.is_core_definer, NEW.phase_id, NEW.asset_id, NEW.task_id, NEW.scene_id, NEW.shot_id, NEW.level_id, NEW.experience_id, NEW.deleted_at, NEW.is_financial, NEW.storage_path, NEW.share_missing_since))
  EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_folders_moth_history
  AFTER INSERT OR DELETE ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_folders_moth_history_upd
  AFTER UPDATE ON public.folders
  FOR EACH ROW
  WHEN (ROW(OLD.project_id, OLD.parent_id, OLD.slug, OLD.label, OLD.kind, OLD.entity_type, OLD.sort_order, OLD.path, OLD.asset_id, OLD.scene_id, OLD.shot_id, OLD.level_id, OLD.experience_id) IS DISTINCT FROM ROW(NEW.project_id, NEW.parent_id, NEW.slug, NEW.label, NEW.kind, NEW.entity_type, NEW.sort_order, NEW.path, NEW.asset_id, NEW.scene_id, NEW.shot_id, NEW.level_id, NEW.experience_id))
  EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_scenes_moth_history
  AFTER INSERT OR DELETE ON public.scenes
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_scenes_moth_history_upd
  AFTER UPDATE ON public.scenes
  FOR EACH ROW
  WHEN (ROW(OLD.name, OLD.scene_number, OLD.status, OLD.sort_order) IS DISTINCT FROM ROW(NEW.name, NEW.scene_number, NEW.status, NEW.sort_order))
  EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_shots_moth_history
  AFTER INSERT OR DELETE ON public.shots
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_shots_moth_history_upd
  AFTER UPDATE ON public.shots
  FOR EACH ROW
  WHEN (ROW(OLD.name, OLD.shot_number, OLD.scene_id, OLD.status, OLD.sort_order) IS DISTINCT FROM ROW(NEW.name, NEW.shot_number, NEW.scene_id, NEW.status, NEW.sort_order))
  EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_levels_moth_history
  AFTER INSERT OR DELETE ON public.levels
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_levels_moth_history_upd
  AFTER UPDATE ON public.levels
  FOR EACH ROW
  WHEN (ROW(OLD.name, OLD.status, OLD.sort_order) IS DISTINCT FROM ROW(NEW.name, NEW.status, NEW.sort_order))
  EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_experiences_moth_history
  AFTER INSERT OR DELETE ON public.experiences
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_experiences_moth_history_upd
  AFTER UPDATE ON public.experiences
  FOR EACH ROW
  WHEN (ROW(OLD.name, OLD.status, OLD.sort_order) IS DISTINCT FROM ROW(NEW.name, NEW.status, NEW.sort_order))
  EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_task_items_moth_history
  AFTER INSERT OR DELETE ON public.task_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_history_capture();
CREATE OR REPLACE TRIGGER trg_task_items_moth_history_upd
  AFTER UPDATE ON public.task_items
  FOR EACH ROW
  WHEN (ROW(OLD.task_id, OLD.entity_type, OLD.entity_id, OLD."position") IS DISTINCT FROM ROW(NEW.task_id, NEW.entity_type, NEW.entity_id, NEW."position"))
  EXECUTE FUNCTION public.fn_moth_history_capture();
-- §4 When recording began ------------------------------------------------------------------------
-- One mark per company and type. A company made later starts at its created_at, which the window asks.
INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, mark_kind)
SELECT w.id, t.t, w.id, 'mark_recording', 'baseline'
  FROM public.workspaces w
  CROSS JOIN unnest(ARRAY['projects', 'phases', 'assets', 'tasks', 'files', 'folders', 'scenes', 'shots', 'levels', 'experiences', 'task_items']) AS t(t)
 WHERE NOT EXISTS (SELECT 1 FROM public.moth_history m
                    WHERE m.workspace_id = w.id AND m.entity_type = t.t AND m.action = 'mark_recording' AND m.mark_kind = 'baseline');

-- §5 Reading ------------------------------------------------------------------------------------
-- An entity is hidden whole when any of its rows is locked, or when its live row exists and fails
-- Moth's gate now. A trashed file keeps its history, so the trash view and the scrub agree; a trashed
-- project hides its. A row that has gone is left to the side tests.
CREATE OR REPLACE FUNCTION public._moth_history_entity_visible(p_ws uuid, p_type text, p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_project uuid;
  v_found   boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM public.moth_history h
              WHERE h.workspace_id = p_ws AND h.entity_type = p_type AND h.entity_id = p_id AND h.locked) THEN
    RETURN false;
  END IF;
  IF p_type = 'projects' THEN
    IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_id) THEN
      RETURN true;
    END IF;
    RETURN COALESCE(public._moth_target_eligible('project', p_id, false), false);
  ELSIF p_type = 'files' THEN
    IF NOT EXISTS (SELECT 1 FROM public.files f WHERE f.id = p_id) THEN
      RETURN true;
    END IF;
    RETURN COALESCE(public._moth_target_eligible('file', p_id, true), false);
  ELSIF p_type = 'folders' THEN
    IF NOT EXISTS (SELECT 1 FROM public.folders fo WHERE fo.id = p_id) THEN
      RETURN true;
    END IF;
    RETURN COALESCE(public._moth_target_eligible('folder', p_id, true), false);
  END IF;
  EXECUTE format('SELECT x.project_id, true FROM public.%I x WHERE x.id = $1', p_type) INTO v_project, v_found USING p_id;
  IF NOT COALESCE(v_found, false) THEN
    RETURN true;
  END IF;
  RETURN COALESCE(public._moth_target_eligible('project', v_project, false), false);
END;
$$;
REVOKE ALL ON FUNCTION public._moth_history_entity_visible(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- Newest first. A side shows only to someone in its audience as it was then who also passes Moth's
-- gate now. No id from the table's own sequence, no count, and one refusal for every cause. A batch
-- at a time, stopping when it has enough: gating all 90 days first would put one office-server walk
-- past the 8 s for every read in the company, however few rows were asked for.
CREATE OR REPLACE FUNCTION public.moth_history_read(
  p_scope_project uuid DEFAULT NULL,
  p_since         timestamptz DEFAULT NULL,
  p_after         uuid DEFAULT NULL,
  p_limit         integer DEFAULT 1000)
RETURNS TABLE (
  row_key uuid, entity_type text, entity_id uuid, action text, observed_at timestamptz, actor_user_id uuid,
  prior_project_id uuid, prior jsonb, state_project_id uuid, state jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
#variable_conflict use_column
DECLARE
  v_uid      uuid := auth.uid();
  v_ws       uuid := public.current_workspace_id();
  v_admin    boolean := public.current_app_role() = 'admin';
  v_limit    integer := LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 5000);
  v_since    timestamptz := GREATEST(COALESCE(p_since, '-infinity'::timestamptz), now() - interval '90 days');
  v_after_at timestamptz;
  v_after_id bigint;
  v_batch    CONSTANT integer := 2000;
  v_ids      bigint[];
  v_got      integer;
BEGIN
  IF v_uid IS NULL OR v_ws IS NULL OR NOT COALESCE(public.has_active_membership(v_ws), false) THEN
    RAISE EXCEPTION 'that history is not available' USING ERRCODE = '42501';
  END IF;
  IF p_scope_project IS NOT NULL AND NOT COALESCE(public._moth_target_eligible('project', p_scope_project, false), false) THEN
    RAISE EXCEPTION 'that history is not available' USING ERRCODE = '42501';
  END IF;
  IF p_after IS NOT NULL THEN
    SELECT h.observed_at, h.id INTO v_after_at, v_after_id FROM public.moth_history h WHERE h.workspace_id = v_ws AND h.row_key = p_after;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'that history is not available' USING ERRCODE = '42501';
    END IF;
  END IF;

  LOOP
  v_ids := ARRAY(
    SELECT h.id
      FROM public.moth_history h
     WHERE h.workspace_id = v_ws
       AND h.action <> 'mark_recording'
       AND NOT h.locked
       AND h.observed_at >= v_since
       AND (v_after_id IS NULL OR (h.observed_at, h.id) < (v_after_at, v_after_id))
       AND (p_scope_project IS NULL OR h.prior_project_id = p_scope_project OR h.state_project_id = p_scope_project)
     ORDER BY h.observed_at DESC, h.id DESC
     LIMIT v_batch);
  EXIT WHEN cardinality(v_ids) = 0;

  RETURN QUERY
  WITH cand AS MATERIALIZED (
    SELECT h.* FROM public.moth_history h WHERE h.id = ANY (v_ids)
  ), proj AS MATERIALIZED (
    SELECT x.p, COALESCE(public._moth_target_eligible('project', x.p, false), false) AS ok
      FROM (SELECT c.prior_project_id AS p FROM cand c WHERE c.prior_project_id IS NOT NULL
            UNION
            SELECT c.state_project_id FROM cand c WHERE c.state_project_id IS NOT NULL) x
  ), ent AS MATERIALIZED (
    SELECT e.entity_type AS et, e.entity_id AS eid, public._moth_history_entity_visible(v_ws, e.entity_type, e.entity_id) AS ok
      FROM (SELECT DISTINCT c.entity_type, c.entity_id FROM cand c) e
  ), sided AS (
    SELECT c.*,
           (COALESCE(pp.ok, false) AND CASE c.prior_class
              WHEN 'shared' THEN true
              WHEN 'private' THEN c.prior_owner_id = v_uid OR v_admin
              WHEN 'personal' THEN c.prior_owner_id = v_uid
              ELSE false END) IS TRUE AS prior_ok,
           (COALESCE(sp.ok, false) AND CASE c.state_class
              WHEN 'shared' THEN true
              WHEN 'private' THEN c.state_owner_id = v_uid OR v_admin
              WHEN 'personal' THEN c.state_owner_id = v_uid
              ELSE false END) IS TRUE AS state_ok
      FROM cand c
      JOIN ent e ON e.et = c.entity_type AND e.eid = c.entity_id AND e.ok
      LEFT JOIN proj pp ON pp.p = c.prior_project_id
      LEFT JOIN proj sp ON sp.p = c.state_project_id
  )
  SELECT s.row_key, s.entity_type, s.entity_id,
         CASE
           WHEN s.prior_ok AND s.state_ok THEN CASE s.action
             WHEN 'update' THEN 'changed' WHEN 'move' THEN 'moved' WHEN 'trash' THEN 'trashed' WHEN 'restore' THEN 'restored' END
           WHEN s.state_ok THEN 'added'
           ELSE 'removed'
         END,
         s.observed_at, s.actor_user_id,
         CASE WHEN s.prior_ok THEN s.prior_project_id END,
         CASE WHEN s.prior_ok THEN s.prior END,
         CASE WHEN s.state_ok THEN s.state_project_id END,
         CASE WHEN s.state_ok THEN s.state END
    FROM sided s
   WHERE s.prior_ok OR s.state_ok
   ORDER BY s.observed_at DESC, s.id DESC
   LIMIT v_limit;
  GET DIAGNOSTICS v_got = ROW_COUNT;
  v_limit := v_limit - v_got;
  EXIT WHEN v_limit <= 0 OR cardinality(v_ids) < v_batch;
  v_after_id := v_ids[v_batch];
  SELECT h.observed_at INTO v_after_at FROM public.moth_history h WHERE h.id = v_after_id;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.moth_history_read(uuid, timestamptz, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moth_history_read(uuid, timestamptz, uuid, integer) TO authenticated, service_role;

-- How far back the record can be trusted: per type, and per type and project where a restart shows.
-- A restart in a place the caller cannot see stays out of it.
CREATE OR REPLACE FUNCTION public.moth_history_window(p_scope_project uuid DEFAULT NULL)
RETURNS TABLE (entity_type text, project_id uuid, recording_since timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
#variable_conflict use_column
DECLARE
  v_uid     uuid := auth.uid();
  v_ws      uuid := public.current_workspace_id();
  v_admin   boolean := public.current_app_role() = 'admin';
  v_created timestamptz;
BEGIN
  IF v_uid IS NULL OR v_ws IS NULL OR NOT COALESCE(public.has_active_membership(v_ws), false) THEN
    RAISE EXCEPTION 'that history is not available' USING ERRCODE = '42501';
  END IF;
  IF p_scope_project IS NOT NULL AND NOT COALESCE(public._moth_target_eligible('project', p_scope_project, false), false) THEN
    RAISE EXCEPTION 'that history is not available' USING ERRCODE = '42501';
  END IF;
  SELECT w.created_at INTO v_created FROM public.workspaces w WHERE w.id = v_ws;

  RETURN QUERY
  WITH types AS (
    SELECT t.t FROM unnest(ARRAY['projects', 'phases', 'assets', 'tasks', 'files', 'folders', 'scenes', 'shots', 'levels', 'experiences', 'task_items']) AS t(t)
    UNION
    SELECT h.entity_type FROM public.moth_history h WHERE h.workspace_id = v_ws AND h.action = 'mark_recording' AND h.mark_kind = 'baseline'
  ), base AS (
    SELECT ty.t,
           GREATEST((SELECT max(h.observed_at) FROM public.moth_history h
                      WHERE h.workspace_id = v_ws AND h.entity_type = ty.t AND h.action = 'mark_recording' AND h.mark_kind IN ('baseline', 'suspended')),
                    v_created, now() - interval '90 days') AS since
      FROM types ty
  ), restarts AS (
    SELECT h.entity_type AS t, s.project, max(h.observed_at) AS at
      FROM public.moth_history h,
           LATERAL (VALUES (h.prior_project_id, h.prior_class, h.prior_owner_id),
                           (h.state_project_id, h.state_class, h.state_owner_id)) AS s(project, class, owner)
     WHERE h.workspace_id = v_ws
       AND h.action = 'mark_recording'
       AND h.mark_kind = 'capture_failed'
       AND s.project IS NOT NULL
       AND (p_scope_project IS NULL OR s.project = p_scope_project)
       AND (CASE s.class
              WHEN 'shared' THEN true
              WHEN 'private' THEN s.owner = v_uid OR v_admin
              WHEN 'personal' THEN s.owner = v_uid
              ELSE false END) IS TRUE
       AND COALESCE(public._moth_target_eligible('project', s.project, false), false)
     GROUP BY 1, 2
  )
  SELECT b.t, NULL::uuid, b.since FROM base b
  UNION ALL
  SELECT r.t, r.project, r.at FROM restarts r JOIN base b ON b.t = r.t WHERE r.at > b.since
  ORDER BY 1, 2 NULLS FIRST;
END;
$$;
REVOKE ALL ON FUNCTION public.moth_history_window(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moth_history_window(uuid) TO authenticated, service_role;

-- §6 The purge -----------------------------------------------------------------------------------
-- A plain DELETE, marks included: after 90 days now() - 90 days takes over from a purged mark.
CREATE OR REPLACE FUNCTION public.purge_moth_history(p_retention interval DEFAULT interval '90 days')
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_n bigint;
BEGIN
  IF p_retention IS NULL OR p_retention < interval '1 day' THEN
    RAISE EXCEPTION 'purge_moth_history: a retention under one day is refused';
  END IF;
  DELETE FROM public.moth_history h WHERE h.observed_at < now() - p_retention;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_moth_history(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_moth_history(interval) TO service_role;

-- cron.schedule() upserts by job name, so a re-run is idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule(
      'wilson-purge-moth-history',
      '45 4 * * *',
      $job$ SELECT public.purge_moth_history(); $job$
    );
  ELSE
    RAISE NOTICE 'pg_cron unavailable — the moth_history purge is not scheduled (expected in CI local stack)';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'could not schedule the moth_history purge via pg_cron: %', SQLERRM;
END $$;

-- §7 COMMENTs -------------------------------------------------------------------------------------
COMMENT ON TABLE public.moth_history IS
  'What changed, for Moth to rebuild the past from: metadata only, 90 days. Written by capture, redacted on lock, read through two definers that ask two audiences, then and now. On no realtime topic and in no takeout.';
COMMENT ON FUNCTION public.fn_moth_history_capture() IS
  'Writes one moth_history row per structural change on eleven tables, whoever made it. A locked side writes nothing and redacts the entity. A failure leaves a restart mark and never fails the write.';
COMMENT ON FUNCTION public.moth_history_project(text, jsonb) IS
  'A row''s metadata by a map per table. Never a locator, a description, a money column or a person''s id. Bounds its own output. Closed to clients.';
COMMENT ON FUNCTION public.moth_history_projection_ok(jsonb) IS
  'The table''s CHECK: an object of at most 4,096 octets, allowlisted keys, bounded scalars and arrays. Never NULL. Closed to clients.';
COMMENT ON FUNCTION public._moth_history_folder_locked(uuid, jsonb) IS
  'Whether a folder side is locked, from its image: its path, its money slug under a root, or a folder above it. Closed to clients.';
COMMENT ON FUNCTION public._moth_history_audience(text, jsonb, uuid) IS
  'Who a side of a change is for: shared, private with its creator, or personal with its owner. Closed to clients.';
COMMENT ON FUNCTION public._moth_history_entity_visible(uuid, text, uuid) IS
  'An entity is hidden whole if any of its rows is locked, or if its live row fails Moth''s gate now. Closed to clients.';
COMMENT ON FUNCTION public.moth_history_read(uuid, timestamptz, uuid, integer) IS
  'What changed, newest first, up to 5,000 rows and 90 days. Pages by row_key. A half-visible row reads as added or removed. One refusal: that history is not available.';
COMMENT ON FUNCTION public.moth_history_window(uuid) IS
  'From when the record can be trusted: per type, and per type and project where a restart the caller may see is later.';
COMMENT ON FUNCTION public.purge_moth_history(interval) IS
  'Deletes what is older than the retention, marks included. Refuses under a day. service_role only.';

-- §8 Post-conditions ------------------------------------------------------------------------------
DO $$
DECLARE
  v_body TEXT;
  v_fn   RECORD;
  v_word TEXT;
  v_set  TEXT[];
BEGIN
  IF NOT (SELECT relrowsecurity AND NOT relforcerowsecurity FROM pg_class WHERE oid = 'public.moth_history'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'moth_history') THEN
    RAISE EXCEPTION '0119 post-condition: moth_history must have row security on, not forced, and no policy';
  END IF;
  IF has_table_privilege('anon', 'public.moth_history', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.moth_history', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_sequence_privilege('anon', 'public.moth_history_id_seq', 'USAGE,SELECT,UPDATE')
     OR has_sequence_privilege('authenticated', 'public.moth_history_id_seq', 'USAGE,SELECT,UPDATE') THEN
    RAISE EXCEPTION '0119 post-condition: a client holds a privilege on moth_history or its sequence';
  END IF;

  -- Both triggers on the eleven, and only them, each with its pinned text. A column missing from a
  -- WHEN list silently corrupts every rebuild before it.
  v_set := ARRAY(SELECT DISTINCT c.relname::text FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                  WHERE NOT t.tgisinternal AND t.tgfoid = 'public.fn_moth_history_capture()'::regprocedure ORDER BY 1);
  IF v_set IS DISTINCT FROM ARRAY['assets', 'experiences', 'files', 'folders', 'levels', 'phases', 'projects', 'scenes', 'shots', 'task_items', 'tasks']::text[]
     OR (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgfoid = 'public.fn_moth_history_capture()'::regprocedure) <> 22 THEN
    RAISE EXCEPTION '0119 post-condition: the capture triggers are not on exactly the eleven tables, two each: %', v_set;
  END IF;
  FOR v_fn IN SELECT * FROM (VALUES
      ('projects', 'CREATE TRIGGER trg_projects_moth_history_upd AFTER UPDATE ON projects FOR EACH ROW WHEN (((((((old.title IS DISTINCT FROM new.title) OR (old.status IS DISTINCT FROM new.status)) OR (old.project_type IS DISTINCT FROM new.project_type)) OR (old.is_private IS DISTINCT FROM new.is_private)) OR (old.personal_owner_id IS DISTINCT FROM new.personal_owner_id)) OR (old.deleted_at IS DISTINCT FROM new.deleted_at))) EXECUTE FUNCTION fn_moth_history_capture()'),
      ('phases', 'CREATE TRIGGER trg_phases_moth_history_upd AFTER UPDATE ON phases FOR EACH ROW WHEN ((((((old.name IS DISTINCT FROM new.name) OR (old.status IS DISTINCT FROM new.status)) OR (old.parent_phase_id IS DISTINCT FROM new.parent_phase_id)) OR (old.sort_order IS DISTINCT FROM new.sort_order)) OR (old.deleted_at IS DISTINCT FROM new.deleted_at))) EXECUTE FUNCTION fn_moth_history_capture()'),
      ('assets', 'CREATE TRIGGER trg_assets_moth_history_upd AFTER UPDATE ON assets FOR EACH ROW WHEN ((((((((((((old.name IS DISTINCT FROM new.name) OR (old.type IS DISTINCT FROM new.type)) OR (old.type_label IS DISTINCT FROM new.type_label)) OR (old.status IS DISTINCT FROM new.status)) OR (old.phase_id IS DISTINCT FROM new.phase_id)) OR (old.sort_order IS DISTINCT FROM new.sort_order)) OR (old.scene_ids IS DISTINCT FROM new.scene_ids)) OR (old.shot_ids IS DISTINCT FROM new.shot_ids)) OR (old.level_ids IS DISTINCT FROM new.level_ids)) OR (old.experience_ids IS DISTINCT FROM new.experience_ids)) OR (old.deleted_at IS DISTINCT FROM new.deleted_at))) EXECUTE FUNCTION fn_moth_history_capture()'),
      ('tasks', 'CREATE TRIGGER trg_tasks_moth_history_upd AFTER UPDATE ON tasks FOR EACH ROW WHEN (((((((((old.title IS DISTINCT FROM new.title) OR (old.status IS DISTINCT FROM new.status)) OR (old.phase_id IS DISTINCT FROM new.phase_id)) OR (old.asset_id IS DISTINCT FROM new.asset_id)) OR (old.scene_id IS DISTINCT FROM new.scene_id)) OR (old.shot_id IS DISTINCT FROM new.shot_id)) OR (old.project_id IS DISTINCT FROM new.project_id)) OR (old.deleted_at IS DISTINCT FROM new.deleted_at))) EXECUTE FUNCTION fn_moth_history_capture()'),
      ('files', 'CREATE TRIGGER trg_files_moth_history_upd AFTER UPDATE ON files FOR EACH ROW WHEN (((((((((((((((((((((old.name IS DISTINCT FROM new.name) OR (old.project_id IS DISTINCT FROM new.project_id)) OR (old.folder_id IS DISTINCT FROM new.folder_id)) OR (old.kind IS DISTINCT FROM new.kind)) OR (old.mime_type IS DISTINCT FROM new.mime_type)) OR (old.size_bytes IS DISTINCT FROM new.size_bytes)) OR (old.document_kind IS DISTINCT FROM new.document_kind)) OR (old.tags IS DISTINCT FROM new.tags)) OR (old.is_core_definer IS DISTINCT FROM new.is_core_definer)) OR (old.phase_id IS DISTINCT FROM new.phase_id)) OR (old.asset_id IS DISTINCT FROM new.asset_id)) OR (old.task_id IS DISTINCT FROM new.task_id)) OR (old.scene_id IS DISTINCT FROM new.scene_id)) OR (old.shot_id IS DISTINCT FROM new.shot_id)) OR (old.level_id IS DISTINCT FROM new.level_id)) OR (old.experience_id IS DISTINCT FROM new.experience_id)) OR (old.deleted_at IS DISTINCT FROM new.deleted_at)) OR (old.is_financial IS DISTINCT FROM new.is_financial)) OR (old.storage_path IS DISTINCT FROM new.storage_path)) OR (old.share_missing_since IS DISTINCT FROM new.share_missing_since))) EXECUTE FUNCTION fn_moth_history_capture()'),
      ('folders', 'CREATE TRIGGER trg_folders_moth_history_upd AFTER UPDATE ON folders FOR EACH ROW WHEN ((((((((((((((old.project_id IS DISTINCT FROM new.project_id) OR (old.parent_id IS DISTINCT FROM new.parent_id)) OR (old.slug IS DISTINCT FROM new.slug)) OR (old.label IS DISTINCT FROM new.label)) OR (old.kind IS DISTINCT FROM new.kind)) OR (old.entity_type IS DISTINCT FROM new.entity_type)) OR (old.sort_order IS DISTINCT FROM new.sort_order)) OR (old.path IS DISTINCT FROM new.path)) OR (old.asset_id IS DISTINCT FROM new.asset_id)) OR (old.scene_id IS DISTINCT FROM new.scene_id)) OR (old.shot_id IS DISTINCT FROM new.shot_id)) OR (old.level_id IS DISTINCT FROM new.level_id)) OR (old.experience_id IS DISTINCT FROM new.experience_id))) EXECUTE FUNCTION fn_moth_history_capture()'),
      ('scenes', 'CREATE TRIGGER trg_scenes_moth_history_upd AFTER UPDATE ON scenes FOR EACH ROW WHEN (((((old.name IS DISTINCT FROM new.name) OR (old.scene_number IS DISTINCT FROM new.scene_number)) OR (old.status IS DISTINCT FROM new.status)) OR (old.sort_order IS DISTINCT FROM new.sort_order))) EXECUTE FUNCTION fn_moth_history_capture()'),
      ('shots', 'CREATE TRIGGER trg_shots_moth_history_upd AFTER UPDATE ON shots FOR EACH ROW WHEN ((((((old.name IS DISTINCT FROM new.name) OR (old.shot_number IS DISTINCT FROM new.shot_number)) OR (old.scene_id IS DISTINCT FROM new.scene_id)) OR (old.status IS DISTINCT FROM new.status)) OR (old.sort_order IS DISTINCT FROM new.sort_order))) EXECUTE FUNCTION fn_moth_history_capture()'),
      ('levels', 'CREATE TRIGGER trg_levels_moth_history_upd AFTER UPDATE ON levels FOR EACH ROW WHEN ((((old.name IS DISTINCT FROM new.name) OR (old.status IS DISTINCT FROM new.status)) OR (old.sort_order IS DISTINCT FROM new.sort_order))) EXECUTE FUNCTION fn_moth_history_capture()'),
      ('experiences', 'CREATE TRIGGER trg_experiences_moth_history_upd AFTER UPDATE ON experiences FOR EACH ROW WHEN ((((old.name IS DISTINCT FROM new.name) OR (old.status IS DISTINCT FROM new.status)) OR (old.sort_order IS DISTINCT FROM new.sort_order))) EXECUTE FUNCTION fn_moth_history_capture()'),
      ('task_items', 'CREATE TRIGGER trg_task_items_moth_history_upd AFTER UPDATE ON task_items FOR EACH ROW WHEN (((((old.task_id IS DISTINCT FROM new.task_id) OR (old.entity_type IS DISTINCT FROM new.entity_type)) OR (old.entity_id IS DISTINCT FROM new.entity_id)) OR (old."position" IS DISTINCT FROM new."position"))) EXECUTE FUNCTION fn_moth_history_capture()')
  ) AS t(tbl, def) LOOP
    SELECT replace(pg_get_triggerdef(t.oid), 'public.', '') INTO v_body FROM pg_trigger t
     WHERE t.tgrelid = ('public.' || v_fn.tbl)::regclass AND t.tgname = 'trg_' || v_fn.tbl || '_moth_history_upd';
    IF v_body IS DISTINCT FROM v_fn.def THEN
      RAISE EXCEPTION '0119 post-condition: % reads %', v_fn.tbl, v_body;
    END IF;
    SELECT replace(pg_get_triggerdef(t.oid), 'public.', '') INTO v_body FROM pg_trigger t
     WHERE t.tgrelid = ('public.' || v_fn.tbl)::regclass AND t.tgname = 'trg_' || v_fn.tbl || '_moth_history';
    IF v_body IS DISTINCT FROM format('CREATE TRIGGER trg_%s_moth_history AFTER INSERT OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION fn_moth_history_capture()', v_fn.tbl, v_fn.tbl) THEN
      RAISE EXCEPTION '0119 post-condition: % reads %', v_fn.tbl, v_body;
    END IF;
  END LOOP;

  IF public.moth_history_projection_ok('{"storage_path":"x"}'::jsonb) OR NOT public.moth_history_projection_ok('{"name":"x"}'::jsonb) THEN
    RAISE EXCEPTION '0119 post-condition: moth_history_projection_ok is not the allowlist';
  END IF;
  -- Comments stripped: a comment naming a word is not the word.
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_body FROM pg_proc WHERE oid = 'public.fn_moth_history_capture()'::regprocedure;
  FOREACH v_word IN ARRAY ARRAY['moth_history_project(', 'moth_file_row_locked(', '_moth_history_folder_locked(', 'SET prior = NULL',
                                'public.workspaces w WHERE w.id = v_ws', 'capture_failed', 'h.action <> ''mark_recording'''] LOOP
    IF position(v_word IN v_body) = 0 THEN
      RAISE EXCEPTION '0119 post-condition: fn_moth_history_capture lost %', v_word;
    END IF;
  END LOOP;
  -- It reads no marker: capture ignores who is writing (H10).
  IF position('current_setting' IN v_body) > 0 OR position('wilson.' IN v_body) > 0
     OR position('current_workspace_id' IN v_body) > 0 THEN
    RAISE EXCEPTION '0119 post-condition: fn_moth_history_capture must ignore every marker and the caller''s claims';
  END IF;
  IF pg_get_function_result('public.moth_history_read(uuid,timestamp with time zone,uuid,integer)'::regprocedure) ~* 'bigint'
     OR pg_get_function_result('public.moth_history_window(uuid)'::regprocedure) ~* 'bigint' THEN
    RAISE EXCEPTION '0119 post-condition: a reader hands out the table''s own sequence';
  END IF;

  -- Every definer a client may call, and the rest closed.
  FOR v_fn IN SELECT * FROM (VALUES
      ('public.moth_history_read(uuid,timestamp with time zone,uuid,integer)', true),
      ('public.moth_history_window(uuid)', true),
      ('public.fn_moth_history_capture()', false),
      ('public._moth_history_audience(text,jsonb,uuid)', false),
      ('public._moth_history_folder_locked(uuid,jsonb)', false),
      ('public._moth_history_entity_visible(uuid,text,uuid)', false),
      ('public.purge_moth_history(interval)', false)
    ) AS t(sig, open)
  LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn.sig::regprocedure)
       OR NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proconfig) c WHERE p.oid = v_fn.sig::regprocedure AND c LIKE 'search_path=%')
       OR has_function_privilege('anon', v_fn.sig::regprocedure, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn.sig::regprocedure, 'EXECUTE') IS DISTINCT FROM v_fn.open THEN
      RAISE EXCEPTION '0119 post-condition: % has the wrong grants or search_path', v_fn.sig;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'public.moth_history_project(text,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.moth_history_projection_ok(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '0119 post-condition: a client may call the projector';
  END IF;

  -- Nested: one expression is parsed whole, so cron.job would be read with no pg_cron to hold it.
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wilson-purge-moth-history') THEN
      RAISE EXCEPTION '0119 post-condition: the purge job is not scheduled';
    END IF;
  END IF;

  RAISE NOTICE '0119 OK: moth_history is recording';
END $$;
