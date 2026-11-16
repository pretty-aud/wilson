-- =============================================================================
-- 0122_moth_graph_reads.sql — M.O.T.H. Session 2 (MO2): what the graph reads besides files and folders.
-- (docs/design/MOTH_DESIGN.md §1.13 and §2.5 SEC-01, SEC-04; docs/sessions/PLAN_MOTH.md §5 Session 2.)
--
-- WHAT THIS ADDS
-- --------------
--   §1  _moth_target_eligible and moth_can_write_target learn seven kinds more: phase, asset, task, scene,
--       shot, level and experience. Each is its project's: it is a row of this company, it is not in the
--       trash (phases, assets and tasks have one), and its project passes the gate a file's does, the
--       personal arm included, with no admin leg. A kind still unknown answers false, as before.
--   §2  moth_project_items(p): a project's phases, assets, tasks, scenes, shots, levels and experiences, as
--       dots, in one answer: kind, id, name, the item it lives in (a phase's parent phase, a shot's scene) and when
--       it last changed, and whether the answer was cut at its bound. Its gate is the project's, asked once: §1 makes
--       that every item's whole gate. A task or a phase set aside by its bid version (0090) is left out, as every
--       R.A.B.B.I.T. reader leaves it out.
--   §3  moth_project_links(p): the relationships between a project's items and folders that WILSON already stores,
--       as lines, in one answer. A task to what it is about (task_items; its asset, scene, shot and phase), an
--       asset to its phase and to the scenes, shots, levels and experiences it is in, and an asset's or a scene's
--       own folder to its item. A folder end passes moth_can_read_target('folder'), and an item end is a live row of
--       this same project, so an id an asset's array still holds after its row went gives no line.
--   §4  moth_project_file_facts(p, after, limit): for each file Moth shows, a page at a time keyed on its id as
--       moth_project_files is, who last changed it (for Settings' "colour by who last changed it") and the items it
--       is filed against, each only when it names a live item of this project. Ids only: the page names people from
--       the members it already reads.
--
-- Nothing here writes, and nothing is captured into moth_history (§2.5: Session 2 captures nothing).
-- No table changes. Suite 124_moth_graph_reads.sql.
-- =============================================================================

SET LOCAL lock_timeout = '15s';

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
DECLARE
  v_md5 TEXT;
  v_fn  RECORD;
  v_n   INT;
BEGIN
  IF to_regprocedure('public.moth_leaver_files(uuid)') IS NULL THEN
    RAISE EXCEPTION '0122 refused: 0121 must be applied first';
  END IF;
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0122 refused: % does not bypass row security', current_user;
  END IF;
  -- The columns each kind is read by. A rename would make a gate answer false for every row, silently.
  SELECT count(*) INTO v_n
    FROM (VALUES
      ('phases', 'project_id'), ('phases', 'deleted_at'), ('phases', 'parent_phase_id'), ('phases', 'name'), ('phases', 'set_aside_at'),
      ('assets', 'project_id'), ('assets', 'workspace_id'), ('assets', 'deleted_at'), ('assets', 'phase_id'),
      ('assets', 'scene_ids'), ('assets', 'shot_ids'), ('assets', 'level_ids'), ('assets', 'experience_ids'),
      ('tasks', 'project_id'), ('tasks', 'workspace_id'), ('tasks', 'deleted_at'), ('tasks', 'title'), ('tasks', 'set_aside_at'),
      ('tasks', 'asset_id'), ('tasks', 'scene_id'), ('tasks', 'shot_id'), ('tasks', 'phase_id'),
      ('scenes', 'workspace_id'), ('shots', 'workspace_id'), ('shots', 'scene_id'),
      ('levels', 'workspace_id'), ('experiences', 'workspace_id'),
      ('task_items', 'task_id'), ('task_items', 'entity_type'), ('task_items', 'entity_id'), ('task_items', 'project_id'),
      ('files', 'phase_id'), ('files', 'asset_id'), ('files', 'task_id'), ('files', 'scene_id'), ('files', 'shot_id'),
      ('files', 'level_id'), ('files', 'experience_id'), ('files', 'updated_by'), ('files', 'created_by'),
      ('folders', 'entity_type'), ('folders', 'asset_id'), ('folders', 'scene_id'), ('folders', 'shot_id'),
      ('folders', 'level_id'), ('folders', 'experience_id')
    ) AS t(tbl, col)
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c
                      WHERE c.table_schema = 'public' AND c.table_name = t.tbl AND c.column_name = t.col);
  IF v_n > 0 THEN
    RAISE EXCEPTION '0122 refused: % column(s) it reads are missing', v_n;
  END IF;
  -- The bodies this restates, or this file's own on a second run.
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('public._moth_target_eligible(text,uuid,boolean)', 'f879ef0b2c71a21731ca355fe1a022c2', 'e24e619b128dec8074f7a08d25f00ed1'),
      ('public.moth_can_write_target(text,uuid)', 'f48c7ad84e94772bfb7bddd0a974cfdc', 'f75ffd2db06f93a4e8d0cbef867a1e4f')
    ) AS t(sig, was, now_is)
  LOOP
    SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc WHERE oid = v_fn.sig::regprocedure;
    IF v_md5 IS DISTINCT FROM v_fn.was AND v_md5 IS DISTINCT FROM v_fn.now_is THEN
      RAISE EXCEPTION '0122 refused: % is not the body this file was built on (md5 %)', v_fn.sig, v_md5;
    END IF;
  END LOOP;
END $$;

-- §1 The two gates, with seven kinds more -------------------------------------------
-- Restated from 0121's bodies. Only the kinds are new; a project, a folder and a file answer as before.
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
    SELECT ph.project_id, ph.deleted_at INTO v_project, v_deleted
      FROM public.phases ph
     WHERE ph.id = p_id;
    IF v_project IS NULL OR (v_deleted IS NOT NULL AND NOT COALESCE(p_allow_trashed, false)) THEN
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
    SELECT t.project_id, t.deleted_at INTO v_project, v_deleted
      FROM public.tasks t
     WHERE t.id = p_id AND t.workspace_id = v_ws;
    IF v_project IS NULL OR (v_deleted IS NOT NULL AND NOT COALESCE(p_allow_trashed, false)) THEN
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

CREATE OR REPLACE FUNCTION public.moth_can_write_target(p_kind text, p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project UUID;
BEGIN
  IF NOT public._moth_target_eligible(p_kind, p_id, false) THEN
    RETURN false;
  END IF;
  v_project := CASE p_kind
    WHEN 'project'    THEN p_id
    WHEN 'folder'     THEN (SELECT fo.project_id FROM public.folders fo WHERE fo.id = p_id)
    WHEN 'file'       THEN (SELECT f.project_id FROM public.files f WHERE f.id = p_id)
    WHEN 'phase'      THEN (SELECT ph.project_id FROM public.phases ph WHERE ph.id = p_id)
    WHEN 'asset'      THEN (SELECT a.project_id FROM public.assets a WHERE a.id = p_id)
    WHEN 'task'       THEN (SELECT t.project_id FROM public.tasks t WHERE t.id = p_id)
    WHEN 'scene'      THEN (SELECT s.project_id FROM public.scenes s WHERE s.id = p_id)
    WHEN 'shot'       THEN (SELECT sh.project_id FROM public.shots sh WHERE sh.id = p_id)
    WHEN 'level'      THEN (SELECT l.project_id FROM public.levels l WHERE l.id = p_id)
    WHEN 'experience' THEN (SELECT e.project_id FROM public.experiences e WHERE e.id = p_id)
  END;
  RETURN COALESCE(public.can_write_project(v_project), false)
      OR (COALESCE(current_setting('wilson.moth_leaver_move', true), '') = 'on'
          AND rabbit_private.personal_space_of_a_leaver(v_project));
END;
$$;

-- §2 A project's items, as dots ----------------------------------------------------------
-- The caller's own row security still applies (INVOKER), and Moth's project gate above it: an admin reads no
-- one else's personal space here, as in every Moth read. A name is cut to 300 characters, and a project gives at
-- most 20,000 items, the most the layout takes; past that the answer says it was cut. One object, so PostgREST's
-- row limit never pages it and the scan runs once.
CREATE OR REPLACE FUNCTION public.moth_project_items(p_project uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows jsonb;
  v_n    integer;
BEGIN
  IF NOT public.moth_can_read_target('project', p_project) THEN
    RETURN jsonb_build_object('items', '[]'::jsonb, 'truncated', false);
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', y.kind, 'id', y.id, 'name', y.name, 'parent_kind', y.parent_kind,
                                               'parent_id', y.parent_id, 'updated_at', y.updated_at) ORDER BY y.kind, y.id), '[]'::jsonb),
         count(*)::integer
    INTO v_rows, v_n
    FROM (
      SELECT x.kind, x.id, x.name, x.parent_kind, x.parent_id, x.updated_at
        FROM (
          SELECT 'phase'::text AS kind, ph.id, left(ph.name, 300) AS name,
                 CASE WHEN par.id IS NOT NULL THEN 'phase' END AS parent_kind, par.id AS parent_id, ph.updated_at
            FROM public.phases ph
            LEFT JOIN public.phases par
              ON par.id = ph.parent_phase_id AND par.project_id = ph.project_id
             AND par.deleted_at IS NULL AND par.set_aside_at IS NULL
           WHERE ph.project_id = p_project AND ph.deleted_at IS NULL AND ph.set_aside_at IS NULL
          UNION ALL
          SELECT 'asset', a.id, left(a.name, 300), NULL, NULL, a.updated_at
            FROM public.assets a
           WHERE a.project_id = p_project AND a.deleted_at IS NULL
          UNION ALL
          SELECT 'task', t.id, left(t.title, 300), NULL, NULL, t.updated_at
            FROM public.tasks t
           WHERE t.project_id = p_project AND t.deleted_at IS NULL AND t.set_aside_at IS NULL
          UNION ALL
          SELECT 'scene', s.id, left(s.name, 300), NULL, NULL, s.updated_at
            FROM public.scenes s
           WHERE s.project_id = p_project
          UNION ALL
          SELECT 'shot', sh.id, left(sh.name, 300),
                 CASE WHEN sc.id IS NOT NULL THEN 'scene' END, sc.id, sh.updated_at
            FROM public.shots sh
            LEFT JOIN public.scenes sc ON sc.id = sh.scene_id AND sc.project_id = sh.project_id
           WHERE sh.project_id = p_project
          UNION ALL
          SELECT 'level', l.id, left(l.name, 300), NULL, NULL, l.updated_at
            FROM public.levels l
           WHERE l.project_id = p_project
          UNION ALL
          SELECT 'experience', e.id, left(e.name, 300), NULL, NULL, e.updated_at
            FROM public.experiences e
           WHERE e.project_id = p_project
        ) x
       ORDER BY x.kind, x.id
       LIMIT 20001
    ) y;
  IF v_n > 20000 THEN
    v_rows := (SELECT jsonb_agg(z.v ORDER BY z.n) FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS z(v, n) WHERE z.n <= 20000);
  END IF;
  RETURN jsonb_build_object('items', v_rows, 'truncated', v_n > 20000);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_project_items(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_project_items(uuid) TO authenticated;

-- §3 The relationships between items and folders, as lines ---------------------------------------
-- Both ends are checked. An item end is a live row of this project (an asset's array is ids, not keys, and may
-- still name a row that went; a task or phase set aside by its bid version is not live). A folder end passes
-- Moth's own gate, so an entity folder under a locked folder draws no line. At most 60,000 lines, the most the
-- layout takes; past that the answer says it was cut. A file's own lines come from §4, a page at a time.
CREATE OR REPLACE FUNCTION public.moth_project_links(p_project uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows jsonb;
  v_n    integer;
BEGIN
  IF NOT public.moth_can_read_target('project', p_project) THEN
    RETURN jsonb_build_object('links', '[]'::jsonb, 'truncated', false);
  END IF;
  WITH live AS (
    SELECT 'phase'::text AS kind, ph.id FROM public.phases ph
     WHERE ph.project_id = p_project AND ph.deleted_at IS NULL AND ph.set_aside_at IS NULL
    UNION ALL SELECT 'asset', a.id FROM public.assets a WHERE a.project_id = p_project AND a.deleted_at IS NULL
    UNION ALL SELECT 'task', t.id FROM public.tasks t
     WHERE t.project_id = p_project AND t.deleted_at IS NULL AND t.set_aside_at IS NULL
    UNION ALL SELECT 'scene', s.id FROM public.scenes s WHERE s.project_id = p_project
    UNION ALL SELECT 'shot', sh.id FROM public.shots sh WHERE sh.project_id = p_project
    UNION ALL SELECT 'level', l.id FROM public.levels l WHERE l.project_id = p_project
    UNION ALL SELECT 'experience', e.id FROM public.experiences e WHERE e.project_id = p_project
  ),
  item_links AS (
    -- A task and what it is about.
    SELECT 'task'::text AS sk, ti.task_id AS sid, ti.entity_type::text AS tk, ti.entity_id AS tid, 'task_item'::text AS lk
      FROM public.task_items ti
     WHERE ti.project_id = p_project
    UNION ALL SELECT 'task', t.id, 'asset', t.asset_id, 'task_asset' FROM public.tasks t
     WHERE t.project_id = p_project AND t.asset_id IS NOT NULL
    UNION ALL SELECT 'task', t.id, 'scene', t.scene_id, 'task_scene' FROM public.tasks t
     WHERE t.project_id = p_project AND t.scene_id IS NOT NULL
    UNION ALL SELECT 'task', t.id, 'shot', t.shot_id, 'task_shot' FROM public.tasks t
     WHERE t.project_id = p_project AND t.shot_id IS NOT NULL
    UNION ALL SELECT 'task', t.id, 'phase', t.phase_id, 'task_phase' FROM public.tasks t
     WHERE t.project_id = p_project AND t.phase_id IS NOT NULL
    -- An asset and where it is used.
    UNION ALL SELECT 'asset', a.id, 'phase', a.phase_id, 'asset_phase' FROM public.assets a
     WHERE a.project_id = p_project AND a.phase_id IS NOT NULL
    UNION ALL SELECT 'asset', a.id, 'scene', u.x, 'asset_scene' FROM public.assets a CROSS JOIN LATERAL unnest(a.scene_ids) AS u(x)
     WHERE a.project_id = p_project
    UNION ALL SELECT 'asset', a.id, 'shot', u.x, 'asset_shot' FROM public.assets a CROSS JOIN LATERAL unnest(a.shot_ids) AS u(x)
     WHERE a.project_id = p_project
    UNION ALL SELECT 'asset', a.id, 'level', u.x, 'asset_level' FROM public.assets a CROSS JOIN LATERAL unnest(a.level_ids) AS u(x)
     WHERE a.project_id = p_project
    UNION ALL SELECT 'asset', a.id, 'experience', u.x, 'asset_experience' FROM public.assets a CROSS JOIN LATERAL unnest(a.experience_ids) AS u(x)
     WHERE a.project_id = p_project
  ),
  folder_candidates AS (
    SELECT fo.id, fo.entity_type, fo.asset_id, fo.scene_id, fo.shot_id, fo.level_id, fo.experience_id
      FROM public.folders fo
     WHERE fo.project_id = p_project
       AND fo.kind = 'entity'
       AND fo.entity_type IN ('asset', 'scene', 'shot', 'level', 'experience')
     ORDER BY fo.id
    OFFSET 0
  ),
  folder_links AS (
    SELECT 'folder'::text AS sk, fo.id AS sid, fo.entity_type::text AS tk,
           CASE fo.entity_type
             WHEN 'asset' THEN fo.asset_id WHEN 'scene' THEN fo.scene_id WHEN 'shot' THEN fo.shot_id
             WHEN 'level' THEN fo.level_id WHEN 'experience' THEN fo.experience_id END AS tid,
           'folder_item'::text AS lk
      FROM folder_candidates fo
     WHERE public.moth_can_read_target('folder', fo.id)
  ),
  ends AS (
    -- Both ends live, for an item's line; the far end live, for a folder's (its own end passed the gate).
    SELECT il.sk, il.sid, il.tk, il.tid, il.lk
      FROM item_links il
      JOIN live s ON s.kind = il.sk AND s.id = il.sid
      JOIN live d ON d.kind = il.tk AND d.id = il.tid
    UNION ALL
    SELECT fl.sk, fl.sid, fl.tk, fl.tid, fl.lk
      FROM folder_links fl
      JOIN live d ON d.kind = fl.tk AND d.id = fl.tid
  ),
  -- One line a pair of ends: a task's own asset, scene or shot is also one of its task_items (0096 keeps them in
  -- step), and the pair is one relationship however many columns say so.
  one AS (
    SELECT DISTINCT ON (z.sk, z.sid, z.tk, z.tid) z.sk, z.sid, z.tk, z.tid, z.lk
      FROM ends z
     ORDER BY z.sk, z.sid, z.tk, z.tid, z.lk
     LIMIT 60001
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('source_kind', o.sk, 'source_id', o.sid, 'target_kind', o.tk,
                                               'target_id', o.tid, 'link', o.lk) ORDER BY o.sk, o.sid, o.tk, o.tid), '[]'::jsonb),
         count(*)::integer
    INTO v_rows, v_n
    FROM one o;
  IF v_n > 60000 THEN
    v_rows := (SELECT jsonb_agg(z.v ORDER BY z.n) FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS z(v, n) WHERE z.n <= 60000);
  END IF;
  RETURN jsonb_build_object('links', v_rows, 'truncated', v_n > 60000);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_project_links(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_project_links(uuid) TO authenticated;

-- §4 What each file is filed against, and who last changed it, a page at a time ---------------------------------
-- The same keyset and clamp as moth_project_files (0121), and the gate after the fence, so a page costs a page.
-- The person is the last to change the row, or its uploader where no change was recorded. Each item id comes back
-- only when it names a live item of this very project (the positive form: a file filed against another
-- project's asset, or a set-aside task, names nothing here).
CREATE OR REPLACE FUNCTION public.moth_project_file_facts(p_project uuid, p_after uuid DEFAULT NULL, p_limit integer DEFAULT 1000)
RETURNS TABLE (file_id uuid, editor_id uuid, phase_id uuid, asset_id uuid, task_id uuid, scene_id uuid,
               shot_id uuid, level_id uuid, experience_id uuid)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT f.id,
         COALESCE(f.updated_by, f.created_by),
         CASE WHEN EXISTS (SELECT 1 FROM public.phases x WHERE x.id = f.phase_id AND x.project_id = f.project_id
                            AND x.deleted_at IS NULL AND x.set_aside_at IS NULL) THEN f.phase_id END,
         CASE WHEN EXISTS (SELECT 1 FROM public.assets x WHERE x.id = f.asset_id AND x.project_id = f.project_id
                            AND x.deleted_at IS NULL) THEN f.asset_id END,
         CASE WHEN EXISTS (SELECT 1 FROM public.tasks x WHERE x.id = f.task_id AND x.project_id = f.project_id
                            AND x.deleted_at IS NULL AND x.set_aside_at IS NULL) THEN f.task_id END,
         CASE WHEN EXISTS (SELECT 1 FROM public.scenes x WHERE x.id = f.scene_id AND x.project_id = f.project_id) THEN f.scene_id END,
         CASE WHEN EXISTS (SELECT 1 FROM public.shots x WHERE x.id = f.shot_id AND x.project_id = f.project_id) THEN f.shot_id END,
         CASE WHEN EXISTS (SELECT 1 FROM public.levels x WHERE x.id = f.level_id AND x.project_id = f.project_id) THEN f.level_id END,
         CASE WHEN EXISTS (SELECT 1 FROM public.experiences x WHERE x.id = f.experience_id AND x.project_id = f.project_id) THEN f.experience_id END
    FROM (
      SELECT c.id, c.project_id, c.updated_by, c.created_by, c.phase_id, c.asset_id, c.task_id, c.scene_id,
             c.shot_id, c.level_id, c.experience_id
        FROM public.files c
       WHERE c.project_id = p_project
         AND (p_after IS NULL OR c.id > p_after)
       ORDER BY c.id
      OFFSET 0
    ) f
   WHERE public.moth_can_read_target('file', f.id)
   ORDER BY f.id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 1000);
$$;
REVOKE EXECUTE ON FUNCTION public.moth_project_file_facts(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_project_file_facts(uuid, uuid, integer) TO authenticated;

-- §5 Post-conditions ---------------------------------------------------------------
DO $$
DECLARE
  v_fn RECORD;
BEGIN
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('public._moth_target_eligible(text,uuid,boolean)', 'e24e619b128dec8074f7a08d25f00ed1'),
      ('public.moth_can_write_target(text,uuid)', 'f75ffd2db06f93a4e8d0cbef867a1e4f'),
      ('public.moth_project_items(uuid)', '5ccce4e35c537ae24f9e2d431ff5604b'),
      ('public.moth_project_links(uuid)', 'a8c6916bf7f6d02dc9725ea3f4a89671'),
      ('public.moth_project_file_facts(uuid,uuid,integer)', '5408b2a1f0a42644704c5aec48a63e42')
    ) AS t(sig, now_is)
  LOOP
    IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = v_fn.sig::regprocedure) IS DISTINCT FROM v_fn.now_is THEN
      RAISE EXCEPTION '0122 post-condition: % is not this file''s body', v_fn.sig;
    END IF;
  END LOOP;

  -- Who may call what. The eligibility helper stays a definer's own (0111); the gates and the reads are open.
  FOR v_fn IN SELECT * FROM (VALUES
      ('public._moth_target_eligible(text,uuid,boolean)', false),
      ('public.moth_can_read_target(text,uuid)', true),
      ('public.moth_can_write_target(text,uuid)', true),
      ('public.moth_project_items(uuid)', true),
      ('public.moth_project_links(uuid)', true),
      ('public.moth_project_file_facts(uuid,uuid,integer)', true)
    ) AS t(sig, open)
  LOOP
    IF has_function_privilege('anon', v_fn.sig::regprocedure, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn.sig::regprocedure, 'EXECUTE') IS DISTINCT FROM v_fn.open THEN
      RAISE EXCEPTION '0122 post-condition: % has the wrong grants', v_fn.sig;
    END IF;
  END LOOP;

  -- The three reads run as their caller, and the two gates as their definer.
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid IN ('public.moth_project_items(uuid)'::regprocedure,
                                                 'public.moth_project_links(uuid)'::regprocedure,
                                                 'public.moth_project_file_facts(uuid,uuid,integer)'::regprocedure) AND prosecdef)
     OR EXISTS (SELECT 1 FROM pg_proc WHERE oid IN ('public._moth_target_eligible(text,uuid,boolean)'::regprocedure,
                                                    'public.moth_can_write_target(text,uuid)'::regprocedure) AND NOT prosecdef) THEN
    RAISE EXCEPTION '0122 post-condition: a function runs as the wrong role';
  END IF;

  RAISE NOTICE '0122 OK';
END $$;
