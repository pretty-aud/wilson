-- =============================================================================
-- 0124_moth_corrections.sql — M.O.T.H. Session 3 (MO3): Session 2's five database corrections, before any tag work.
-- (docs/OUTSTANDING.md MO2-09, MO2-10, MO2-11, MO2-12 and MO2-18; docs/sessions/briefs/po-moth3-tags.md.)
--
-- WHAT THIS CHANGES
-- -----------------
--   §1  MO2-09. _moth_target_eligible, restated from 0122's body: a phase or a task set aside by its bid version
--       (0090) is not a target. Every R.A.B.B.I.T. reader and Moth's three reads already leave it out; now no
--       place, link or tag can name one either. A trashed row is never also set aside (0090), so the trash flag
--       the definers pass changes nothing here. moth_can_write_target asks this gate first, so it follows.
--   §2  MO2-11. fn_moth_views_pin, restated from 0123's body: a view's revision is its own count, 1 when it is
--       made and one more at each change of its config. A person reading their own view's revision learns
--       nothing of anyone else's views, where one sequence for every company told how busy the platform was.
--       That sequence is dropped: nothing else names it.
--   §3  MO2-10. moth_put_positions, restated from 0123's body: a target named twice is one place, the last naming
--       it, as before; now that fold comes first, and only then is a focus counted and the old focus cleared.
--   §4  MO2-18. moth_history_project and moth_history_projection_ok, restated from 0119's bodies: the projection
--       of a project, phase, asset, task or file in the trash says in_trash: true. A live row's projection is as it
--       was. So the prior side of a purge says the row was in the trash, and looking back does not bring it back
--       for the time it spent there. Rows recorded before this file carry no such key.
--   §0  MO2-12. The pre-flight pins rabbit_private.moth_view_access by md5, and the places' two unique keys and
--       the settings CHECK by their definitions, not their names, so what a draft left behind is refused here.
--
-- No table, CHECK, policy or trigger changes, and no row is written. One transaction, re-runnable, no enum.
-- 0123 refuses after this file (its pre-flight finds this file's pin and places' writer); 0119 and 0122 refuse
-- already (a later migration is recorded; the gate is not 0121's). Suites: 124 (MO2-09), 125 (MO2-11),
-- 126 (MO2-10, MO2-12), 57 (MO2-12, the CHECK) and 121 (MO2-18).
-- =============================================================================

SET LOCAL lock_timeout = '15s';

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
DECLARE
  v_md5 TEXT;
  v_fn  RECORD;
BEGIN
  IF to_regprocedure('public.moth_put_positions(uuid,jsonb)') IS NULL OR to_regclass('public.moth_views') IS NULL THEN
    RAISE EXCEPTION '0124 refused: 0123 must be applied first';
  END IF;
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0124 refused: % does not bypass row security', current_user;
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name IN ('phases', 'tasks') AND column_name = 'set_aside_at') <> 2 THEN
    RAISE EXCEPTION '0124 refused: phases and tasks must each carry set_aside_at (0090)';
  END IF;
  -- The bodies this restates: the one each was built on, or this file's own on a second run.
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('public._moth_target_eligible(text,uuid,boolean)', 'e24e619b128dec8074f7a08d25f00ed1', '18dba068d0f1925989c30dcb8a4a3e90'),
      ('public.fn_moth_views_pin()', '0349739ead25a724e85e6153e587a9ab', '104141dcd800b0dac4cc1242708d0564'),
      ('public.moth_put_positions(uuid,jsonb)', 'f59d16206c43c1a57a07de799bb22246', '6c1b30fc636394581ba8398885113411'),
      ('public.moth_history_project(text,jsonb)', '1a83673153a843fac7be2ee7442d3515', '74316c0e37e3e54363454b5f179494e0'),
      ('public.moth_history_projection_ok(jsonb)', '3e238bc0c8f66e375462a2829f77e1dd', 'd9ae6159d8cd5dc4c81bc50e2f4cf11e')
    ) AS t(sig, was, now_is)
  LOOP
    SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc WHERE oid = v_fn.sig::regprocedure;
    IF v_md5 IS DISTINCT FROM v_fn.was AND v_md5 IS DISTINCT FROM v_fn.now_is THEN
      RAISE EXCEPTION '0124 refused: % is not the body this file was built on (md5 %)', v_fn.sig, v_md5;
    END IF;
  END LOOP;
  -- MO2-12. What the places' writer stands on, by what it is. Its access, asked first, is 0123's own body,
  -- run as its definer with the path rabbit_private's functions pin (suite 115 #14).
  SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('rabbit_private.moth_view_access(uuid)');
  IF v_md5 IS DISTINCT FROM '72f49b136935ac7ddc2741880bdfc639'
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('rabbit_private.moth_view_access(uuid)')
                       AND prosecdef AND proconfig = ARRAY['search_path=public']) THEN
    RAISE EXCEPTION '0124 refused: rabbit_private.moth_view_access is not 0123''s (md5 %)', v_md5;
  END IF;
  -- The two keys it folds and upserts against, by their definitions.
  IF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = to_regclass('public.moth_layout_positions_target_key')
                    AND i.indisunique AND i.indisvalid
                    AND pg_get_indexdef(i.indexrelid) = 'CREATE UNIQUE INDEX moth_layout_positions_target_key ON public.moth_layout_positions USING btree (view_id, target_type, target_id, target_tag, owner_id) NULLS NOT DISTINCT')
     OR NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = to_regclass('public.moth_layout_positions_focus_key')
                       AND i.indisunique AND i.indisvalid
                       AND pg_get_indexdef(i.indexrelid) = 'CREATE UNIQUE INDEX moth_layout_positions_focus_key ON public.moth_layout_positions USING btree (view_id, owner_id) NULLS NOT DISTINCT WHERE is_focus') THEN
    RAISE EXCEPTION '0124 refused: the places'' two unique keys are not 0123''s';
  END IF;
  -- The settings' bound, by its definition.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.conrelid = 'public.user_settings'::regclass AND c.conname = 'user_settings_moth_prefs_chk'
                    AND c.contype = 'c' AND c.convalidated
                    AND pg_get_constraintdef(c.oid) = 'CHECK (((jsonb_typeof(moth_prefs) = ''object''::text) AND (octet_length((moth_prefs)::text) <= 32768)))') THEN
    RAISE EXCEPTION '0124 refused: user_settings_moth_prefs_chk is not 0123''s';
  END IF;
  -- The views' pin fires as 0123 made it, and nothing but the pin names the sequence §2 drops.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.moth_views'::regclass AND tgname = 'trg_moth_views_a_pin'
                    AND tgfoid = 'public.fn_moth_views_pin()'::regprocedure AND tgenabled = 'O') THEN
    RAISE EXCEPTION '0124 refused: trg_moth_views_a_pin is not 0123''s';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE prosrc LIKE '%moth_views_revision_seq%' AND oid <> 'public.fn_moth_views_pin()'::regprocedure)
     OR EXISTS (SELECT 1 FROM pg_depend d WHERE d.refobjid = to_regclass('public.moth_views_revision_seq') AND d.deptype <> 'i') THEN
    RAISE EXCEPTION '0124 refused: something besides the views'' pin uses moth_views_revision_seq';
  END IF;
END $$;

-- §1 MO2-09: a phase or a task set aside is not a target ----------------------------------------------------------
-- Restated from 0122's body. Only the phase and task arms change.
CREATE OR REPLACE FUNCTION public._moth_target_eligible(p_kind text, p_id uuid, p_allow_trashed boolean)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws       UUID := public.current_workspace_id();
  v_project  UUID;
  v_deleted  TIMESTAMPTZ;
  v_flag     BOOLEAN;
  v_path     TEXT;
  v_tags     TEXT[];
  v_folder   UUID;
  v_aside    TIMESTAMPTZ;
BEGIN
  IF p_id IS NULL OR auth.uid() IS NULL OR v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RETURN false;
  END IF;

  IF p_kind = 'project' THEN
    v_project := p_id;
  ELSIF p_kind = 'folder' THEN
    SELECT fo.project_id INTO v_project
      FROM public.folders fo
     WHERE fo.id = p_id AND fo.workspace_id = v_ws;
    IF v_project IS NULL OR public.moth_folder_chain_locked(v_ws, p_id) THEN
      RETURN false;
    END IF;
  ELSIF p_kind = 'file' THEN
    SELECT f.project_id, f.deleted_at, f.is_financial, f.storage_path, f.tags, f.folder_id
      INTO v_project, v_deleted, v_flag, v_path, v_tags, v_folder
      FROM public.files f
     WHERE f.id = p_id AND f.workspace_id = v_ws;
    IF v_project IS NULL
       OR (v_deleted IS NOT NULL AND NOT COALESCE(p_allow_trashed, false))
       OR public.moth_file_row_locked(v_ws, v_project, p_id, v_flag, v_path, v_tags, v_folder) THEN
      RETURN false;
    END IF;
  ELSIF p_kind = 'phase' THEN
    -- phases has no workspace_id (0061): the project's own, below, is what says which company it is in.
    -- 0124 (MO2-09): a phase set aside by its bid version (0090) is no target, as every R.A.B.B.I.T. reader
    -- and Moth's own reads leave it out. A trashed row is never also set aside, so the trash flag leaves this be.
    SELECT ph.project_id, ph.deleted_at, ph.set_aside_at INTO v_project, v_deleted, v_aside
      FROM public.phases ph
     WHERE ph.id = p_id;
    IF v_project IS NULL OR v_aside IS NOT NULL OR (v_deleted IS NOT NULL AND NOT COALESCE(p_allow_trashed, false)) THEN
      RETURN false;
    END IF;
  ELSIF p_kind = 'asset' THEN
    SELECT a.project_id, a.deleted_at INTO v_project, v_deleted
      FROM public.assets a
     WHERE a.id = p_id AND a.workspace_id = v_ws;
    IF v_project IS NULL OR (v_deleted IS NOT NULL AND NOT COALESCE(p_allow_trashed, false)) THEN
      RETURN false;
    END IF;
  ELSIF p_kind = 'task' THEN
    -- 0124 (MO2-09): a task set aside by its bid version is no target either.
    SELECT t.project_id, t.deleted_at, t.set_aside_at INTO v_project, v_deleted, v_aside
      FROM public.tasks t
     WHERE t.id = p_id AND t.workspace_id = v_ws;
    IF v_project IS NULL OR v_aside IS NOT NULL OR (v_deleted IS NOT NULL AND NOT COALESCE(p_allow_trashed, false)) THEN
      RETURN false;
    END IF;
  ELSIF p_kind = 'scene' THEN
    SELECT s.project_id INTO v_project FROM public.scenes s WHERE s.id = p_id AND s.workspace_id = v_ws;
    IF v_project IS NULL THEN
      RETURN false;
    END IF;
  ELSIF p_kind = 'shot' THEN
    SELECT sh.project_id INTO v_project FROM public.shots sh WHERE sh.id = p_id AND sh.workspace_id = v_ws;
    IF v_project IS NULL THEN
      RETURN false;
    END IF;
  ELSIF p_kind = 'level' THEN
    SELECT l.project_id INTO v_project FROM public.levels l WHERE l.id = p_id AND l.workspace_id = v_ws;
    IF v_project IS NULL THEN
      RETURN false;
    END IF;
  ELSIF p_kind = 'experience' THEN
    SELECT e.project_id INTO v_project FROM public.experiences e WHERE e.id = p_id AND e.workspace_id = v_ws;
    IF v_project IS NULL THEN
      RETURN false;
    END IF;
  ELSE
    RETURN false;
  END IF;

  -- The personal arm has no admin leg: this is what keeps a personal space out
  -- of every Moth surface for an admin, who reaches it from Files only.
  RETURN EXISTS (
    SELECT 1 FROM public.projects p
     WHERE p.id = v_project
       AND p.workspace_id = v_ws
       AND p.deleted_at IS NULL
       AND public.passes_project_privacy(p.id)
       AND (p.personal_owner_id IS NULL OR p.personal_owner_id = auth.uid()
            -- 0121: her answer. Only inside moth_move_leaver_files, which sets this, and asked of the
            -- person again: no admin reaches a space through Moth's reads.
            OR (COALESCE(current_setting('wilson.moth_leaver_move', true), '') = 'on'
                AND rabbit_private.personal_space_of_a_leaver(p.id)))
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public._moth_target_eligible(text, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- §2 MO2-11: each view counts its own revisions --------------------------------------------------------------------
-- Restated from 0123's body. Only the two revision lines change; the trigger is 0123's and is not touched.
CREATE OR REPLACE FUNCTION public.fn_moth_views_pin()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_me UUID := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_me IS NOT NULL THEN
      NEW.workspace_id := public.current_workspace_id();
      NEW.owner_id     := CASE WHEN NEW.scope_kind = 'aggregate' THEN v_me END;
      NEW.created_by   := v_me;
      NEW.updated_by   := v_me;
      NEW.created_at   := now();
      NEW.updated_at   := now();
    END IF;
    -- 0124 (MO2-11): each view counts its own revisions, so its number says nothing of anyone else's views.
    NEW.revision   := 1;
    NEW.revised_by := v_me;
  ELSE
    NEW.id           := OLD.id;
    NEW.workspace_id := OLD.workspace_id;
    NEW.scope_kind   := OLD.scope_kind;
    NEW.project_id   := OLD.project_id;
    NEW.owner_id     := OLD.owner_id;
    NEW.created_by   := OLD.created_by;
    NEW.created_at   := OLD.created_at;
    NEW.updated_at   := now();
    NEW.updated_by   := COALESCE(v_me, OLD.updated_by);
    IF NEW.config IS DISTINCT FROM OLD.config THEN
      NEW.revision   := OLD.revision + 1;
      NEW.revised_by := v_me;
    ELSE
      NEW.revision   := OLD.revision;
      NEW.revised_by := OLD.revised_by;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_moth_views_pin() FROM PUBLIC, anon, authenticated;
DROP SEQUENCE IF EXISTS public.moth_views_revision_seq;

-- §3 MO2-10: fold the places first, then count the focus -----------------------------------------------------------
-- Restated from 0123's body. The fold is the same (the last naming a target wins); the focus is counted on it.
CREATE OR REPLACE FUNCTION public.moth_put_positions(p_view uuid, p_places jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  a      RECORD;
  v_n    INT;
  v_bad  RECORD;
  v_have INT;
  v_one  JSONB;
BEGIN
  IF p_view IS NULL OR p_places IS NULL OR jsonb_typeof(p_places) <> 'array' OR jsonb_array_length(p_places) > 1000 THEN
    RAISE EXCEPTION 'Places come as a list of at most 1,000.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_places) AS e(v)
     WHERE jsonb_typeof(e.v) <> 'object'
        OR jsonb_typeof(e.v -> 't') IS DISTINCT FROM 'string'
        OR jsonb_typeof(e.v -> 'x') IS DISTINCT FROM 'number'
        OR jsonb_typeof(e.v -> 'y') IS DISTINCT FROM 'number'
        OR (e.v ? 'pinned' AND jsonb_typeof(e.v -> 'pinned') <> 'boolean')
        OR (e.v ? 'open' AND jsonb_typeof(e.v -> 'open') <> 'boolean')
        OR (e.v ? 'focus' AND jsonb_typeof(e.v -> 'focus') <> 'boolean')
        OR (e.v ->> 't' = 'tag' AND (jsonb_typeof(e.v -> 'tag') IS DISTINCT FROM 'string' OR e.v ? 'id'))
        OR (e.v ->> 't' <> 'tag' AND (e.v ? 'tag'
            OR jsonb_typeof(e.v -> 'id') IS DISTINCT FROM 'string'
            OR (e.v ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
  ) THEN
    RAISE EXCEPTION 'A place is not of the right shape.' USING ERRCODE = '22023';
  END IF;
  -- 0124 (MO2-10): a target named twice is one place, the last naming it. Fold first, and only then count a
  -- focus, so one target sent with a focus and then without neither clears the old focus nor counts twice.
  SELECT COALESCE(jsonb_agg(d.v ORDER BY d.n), '[]'::jsonb) INTO v_one
    FROM (
      SELECT DISTINCT ON (e.v ->> 't', (e.v ->> 'id')::uuid, e.v ->> 'tag') e.v, e.n
        FROM jsonb_array_elements(p_places) WITH ORDINALITY AS e(v, n)
       ORDER BY e.v ->> 't', (e.v ->> 'id')::uuid, e.v ->> 'tag', e.n DESC
    ) d;
  IF (SELECT count(*) FROM jsonb_array_elements(v_one) AS e(v) WHERE (e.v ->> 'focus') = 'true') > 1 THEN
    RAISE EXCEPTION 'A view has one focus at most.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO a FROM rabbit_private.moth_view_access(p_view);
  IF NOT a.o_write THEN
    RAISE EXCEPTION 'Only those who may change this project may move its shared places.' USING ERRCODE = '42501';
  END IF;

  -- Each target as Moth shows it to the caller; hidden or not there, the same words.
  SELECT e.v ->> 't' AS t, e.v ->> 'tag' AS tag, e.v ->> 'id' AS id INTO v_bad
    FROM jsonb_array_elements(p_places) AS e(v)
   WHERE CASE WHEN e.v ->> 't' = 'tag' THEN false
              ELSE NOT public.moth_can_read_target(e.v ->> 't', (e.v ->> 'id')::uuid) END
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'insert or update on table "moth_layout_positions" violates foreign key constraint "moth_layout_positions_%_ref_fk"',
      v_bad.t USING ERRCODE = '23503';
  END IF;
  IF a.o_scope = 'project' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_places) AS e(v)
        WHERE e.v ->> 't' <> 'tag'
          AND rabbit_private.moth_target_project(e.v ->> 't', (e.v ->> 'id')::uuid) IS DISTINCT FROM a.o_project) THEN
    RAISE EXCEPTION 'A project''s view keeps the places of that project''s things only.' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('moth_layout_positions:' || p_view::text || ':' || COALESCE(a.o_owner::text, ''), 0));
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_one) AS e(v) WHERE (e.v ->> 'focus') = 'true') THEN
    UPDATE public.moth_layout_positions SET is_focus = false
     WHERE view_id = p_view AND owner_id IS NOT DISTINCT FROM a.o_owner AND is_focus;
  END IF;
  INSERT INTO public.moth_layout_positions AS p
         (view_id, workspace_id, target_type, target_id, target_tag, owner_id, x, y, pinned, is_open, is_focus)
  SELECT p_view, public.current_workspace_id(), d.t, d.id, d.tag, a.o_owner, d.x, d.y, d.pinned, d.is_open, d.is_focus
    FROM (
      SELECT e.v ->> 't' AS t,
             (e.v ->> 'id')::uuid AS id,
             e.v ->> 'tag' AS tag,
             (e.v ->> 'x')::double precision AS x,
             (e.v ->> 'y')::double precision AS y,
             COALESCE((e.v ->> 'pinned')::boolean, false) AS pinned,
             COALESCE((e.v ->> 'open')::boolean, false) AS is_open,
             COALESCE((e.v ->> 'focus')::boolean, false) AS is_focus
        FROM jsonb_array_elements(v_one) AS e(v)
    ) d
  ON CONFLICT (view_id, target_type, target_id, target_tag, owner_id)
  DO UPDATE SET x = EXCLUDED.x, y = EXCLUDED.y, pinned = EXCLUDED.pinned,
                is_open = EXCLUDED.is_open, is_focus = EXCLUDED.is_focus;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  SELECT count(*) INTO v_have FROM public.moth_layout_positions
   WHERE view_id = p_view AND owner_id IS NOT DISTINCT FROM a.o_owner;
  -- Past the bound on raw rows, count only what the caller sees, so a place whose target is hidden now (a file
  -- moved where they cannot follow) never shows itself by a refusal.
  IF v_have > 20000 THEN
    SELECT count(*) INTO v_have FROM public.moth_layout_positions pl
     WHERE pl.view_id = p_view AND pl.owner_id IS NOT DISTINCT FROM a.o_owner
       AND (pl.target_type = 'tag' OR public.moth_can_read_target(pl.target_type, pl.target_id));
    IF v_have > 20000 THEN
      RAISE EXCEPTION 'A view keeps at most 20,000 places.' USING ERRCODE = '54000';
    END IF;
  END IF;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_put_positions(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_put_positions(uuid, jsonb) TO authenticated;

-- §4 MO2-18: a projection says when its row is in the trash --------------------------------------------------------
-- Restated from 0119's bodies. The allowlist first, because the table's CHECK calls it on every captured row.
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
                                    'sort_order', 'truncated', 'in_trash'])
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
  -- 0124 (MO2-18): a row in the trash says so; a live row's projection is as it was (a NULL is stripped). So the
  -- prior side of a purge says the row was in the trash, and looking back does not bring it back for that time.
  r := CASE p_table
    WHEN 'projects' THEN jsonb_build_object('title', p_row -> 'title', 'status', p_row -> 'status', 'type', p_row -> 'project_type',
                                            'in_trash', CASE WHEN jsonb_typeof(p_row -> 'deleted_at') = 'string' THEN 'true'::jsonb END)
    WHEN 'phases' THEN jsonb_build_object('name', p_row -> 'name', 'status', p_row -> 'status', 'parent_phase_id', p_row -> 'parent_phase_id', 'sort_order', p_row -> 'sort_order',
                                          'in_trash', CASE WHEN jsonb_typeof(p_row -> 'deleted_at') = 'string' THEN 'true'::jsonb END)
    WHEN 'assets' THEN jsonb_build_object('name', p_row -> 'name', 'type', p_row -> 'type', 'type_label', p_row -> 'type_label', 'status', p_row -> 'status',
                                          'phase_id', p_row -> 'phase_id', 'sort_order', p_row -> 'sort_order', 'scene_ids', p_row -> 'scene_ids',
                                          'shot_ids', p_row -> 'shot_ids', 'level_ids', p_row -> 'level_ids', 'experience_ids', p_row -> 'experience_ids',
                                          'in_trash', CASE WHEN jsonb_typeof(p_row -> 'deleted_at') = 'string' THEN 'true'::jsonb END)
    WHEN 'tasks' THEN jsonb_build_object('title', p_row -> 'title', 'status', p_row -> 'status', 'phase_id', p_row -> 'phase_id', 'asset_id', p_row -> 'asset_id',
                                         'scene_id', p_row -> 'scene_id', 'shot_id', p_row -> 'shot_id',
                                         'in_trash', CASE WHEN jsonb_typeof(p_row -> 'deleted_at') = 'string' THEN 'true'::jsonb END)
    WHEN 'files' THEN jsonb_build_object('name', p_row -> 'name', 'kind', p_row -> 'kind', 'mime_type', p_row -> 'mime_type', 'size_bytes', p_row -> 'size_bytes',
                                         'document_kind', p_row -> 'document_kind', 'categories', p_row -> 'tags', 'is_core_definer', p_row -> 'is_core_definer',
                                         'folder_id', p_row -> 'folder_id', 'phase_id', p_row -> 'phase_id', 'asset_id', p_row -> 'asset_id', 'task_id', p_row -> 'task_id',
                                         'scene_id', p_row -> 'scene_id', 'shot_id', p_row -> 'shot_id', 'level_id', p_row -> 'level_id', 'experience_id', p_row -> 'experience_id',
                                         'missing', to_jsonb(jsonb_typeof(p_row -> 'share_missing_since') = 'string'),
                                         'in_trash', CASE WHEN jsonb_typeof(p_row -> 'deleted_at') = 'string' THEN 'true'::jsonb END)
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
      ELSIF jsonb_typeof(e.value) = 'string' AND n < 20 AND e.key !~ '_id$' AND length(e.value #>> '{}') > GREATEST(n * 8, 8) THEN
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

-- §5 Post-conditions ---------------------------------------------------------------
DO $$
DECLARE
  v_fn RECORD;
BEGIN
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('public._moth_target_eligible(text,uuid,boolean)', '18dba068d0f1925989c30dcb8a4a3e90', true, 's', '{search_path=public}'),
      ('public.fn_moth_views_pin()', '104141dcd800b0dac4cc1242708d0564', false, 'v', '{search_path=public}'),
      ('public.moth_put_positions(uuid,jsonb)', '6c1b30fc636394581ba8398885113411', true, 'v', '{"search_path=public, pg_temp"}'),
      ('public.moth_history_project(text,jsonb)', '74316c0e37e3e54363454b5f179494e0', false, 'i', '{"search_path=public, pg_temp"}'),
      ('public.moth_history_projection_ok(jsonb)', 'd9ae6159d8cd5dc4c81bc50e2f4cf11e', false, 'i', '{"search_path=public, pg_temp"}')
    ) AS t(sig, now_is, definer, volatility, cfg)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_fn.sig::regprocedure
                      AND md5(replace(prosrc, chr(13), '')) = v_fn.now_is
                      AND prosecdef = v_fn.definer AND provolatile = v_fn.volatility AND proconfig::text = v_fn.cfg) THEN
      RAISE EXCEPTION '0124 post-condition: % is not this file''s, or runs as the wrong role, with the wrong path or volatility', v_fn.sig;
    END IF;
  END LOOP;
  IF (SELECT proparallel FROM pg_proc WHERE oid = 'public.moth_history_projection_ok(jsonb)'::regprocedure) <> 's' THEN
    RAISE EXCEPTION '0124 post-condition: the allowlist is no longer PARALLEL SAFE';
  END IF;

  -- Who may call what: only the places' writer is a client's; the gate stays a definer's own (0111).
  FOR v_fn IN SELECT * FROM (VALUES
      ('public._moth_target_eligible(text,uuid,boolean)', false),
      ('public.fn_moth_views_pin()', false),
      ('public.moth_put_positions(uuid,jsonb)', true),
      ('public.moth_history_project(text,jsonb)', false),
      ('public.moth_history_projection_ok(jsonb)', false)
    ) AS t(sig, open)
  LOOP
    IF has_function_privilege('anon', v_fn.sig::regprocedure, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn.sig::regprocedure, 'EXECUTE') IS DISTINCT FROM v_fn.open THEN
      RAISE EXCEPTION '0124 post-condition: % has the wrong grants', v_fn.sig;
    END IF;
  END LOOP;

  -- §2: the sequence is gone, and the pin still fires.
  IF to_regclass('public.moth_views_revision_seq') IS NOT NULL THEN
    RAISE EXCEPTION '0124 post-condition: moth_views_revision_seq is still here';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.moth_views'::regclass AND tgname = 'trg_moth_views_a_pin'
                    AND tgfoid = 'public.fn_moth_views_pin()'::regprocedure AND tgenabled = 'O') THEN
    RAISE EXCEPTION '0124 post-condition: trg_moth_views_a_pin no longer fires the pin';
  END IF;

  -- §4: what a projection says of the trash, and that the table's CHECK admits it.
  IF NOT public.moth_history_projection_ok('{"name":"x","in_trash":true}'::jsonb)
     OR public.moth_history_projection_ok('{"deleted_at":"2026-01-01"}'::jsonb)
     OR public.moth_history_project('files', '{"name":"x","deleted_at":"2026-01-01T00:00:00+00:00"}'::jsonb) -> 'in_trash' IS DISTINCT FROM 'true'::jsonb
     OR public.moth_history_project('files', '{"name":"x","deleted_at":null}'::jsonb) ? 'in_trash'
     OR public.moth_history_project('scenes', '{"name":"x","deleted_at":"2026-01-01T00:00:00+00:00"}'::jsonb) ? 'in_trash'
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.moth_history'::regclass AND conname = 'moth_history_f_projection_chk') THEN
    RAISE EXCEPTION '0124 post-condition: the projection of a row in the trash is not as this file says';
  END IF;

  RAISE NOTICE '0124 OK';
END $$;
