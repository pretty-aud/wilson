-- =============================================================================
-- 0138_boards_in_any_folder.sql — M.O.T.H. polish (MO5), her item 3: a board in almost any folder.
-- (docs/sessions/briefs/po-mo5-moth-polish.md, item 3; 0130 §5 board_create; 0131 §4 moth_move_folders.)
--
-- Her words: "boards can be left in almost any folder type (assets, projects, etc.)". A board could already be made at
-- a project's top, in its ASSETS, SCENES and other category folders, and in a person's own folders; it was refused
-- inside a thing's own folder (an asset's, a scene's, a shot's, a level's, an experience's, and anything below one),
-- because deleting the thing deletes its folder by key (0041), and the folder's cascade took the board's row and every
-- element with it (0130 boards_folder_fk). The board's files were kept (0113 sets their folder_id null), its canvas
-- was not.
--
-- WHAT THIS CHANGES
-- -----------------
--   §1  board_create (0130's body) and moth_move_folders (0131's body), restated without the refusal of a thing's own
--       folder. Nothing else in either changes: Moth's write gate on the parent, the money and Legal names at the top,
--       500 boards a project, unique slugs, the company's folder lock, the office-server refusal.
--   §2  The rescue: before a thing's own folder is deleted (whatever deletes it: a scene or a shot deleted in
--       R.A.B.B.I.T., an asset's purge 30 days after it went to the trash), every board folder at or below it that is
--       not inside another board (a board's folder holding another moves with it), in the trash or not, moves to the
--       top of its project, everything below it with it, under a name made unique there and never a money or Legal
--       name. Its elements, its versions, its channel (audience_gen) and its files are untouched: a move rewrites
--       folder paths only, as moth_move_folders does. A project or a company going takes its boards with it, as
--       before: the rescue steps aside when the project's or the company's own row is already gone.
--   §3  moth_rename_folder(folder, name): her items 7 (a board's title, edited in the board window) and 8 (Rename on
--       a right-click). A person's own folders only (a board's folder is one); the project's top, its category
--       folders and a thing's own folder keep their names. Moth's write gate, the name cleaned as board_create cleans
--       it, the label alone changed (slug and path stay), and a board's new title sent on the board's channel.
--
-- One transaction, re-runnable, no enum, no new table. Re-run after any replay of 0130 or 0131 (each brings its own
-- refusal back). Suite 140_boards_in_any_folder.sql; 134 and 136 assert the new answer where they asserted the refusal.
-- =============================================================================

SET LOCAL lock_timeout = '5s';

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
BEGIN
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0138 refused: % does not bypass row security', current_user;
  END IF;
  -- 0136 is applied (the boards' background): this file follows Session 4.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'boards' AND column_name = 'background') THEN
    RAISE EXCEPTION '0138 refused: 0136 must be applied first';
  END IF;
  -- The two bodies §1 restates, as 0130 and 0131 left them, or as this file leaves them on a second run.
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.board_create(uuid,uuid,text)'::regprocedure)
       NOT IN ('9b46a273eec1dc3dbf010919a25ef3f8', '8898169887a32b2ea63e0bbb71e04a33') THEN
    RAISE EXCEPTION '0138 refused: board_create is neither 0130''s nor this file''s';
  END IF;
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.moth_move_folders(uuid[],uuid,boolean)'::regprocedure)
       NOT IN ('c1f0944dd999058ca6166d3e26620f3a', '41209fac54f1e1c2df25089acc5a7899') THEN
    RAISE EXCEPTION '0138 refused: moth_move_folders is neither 0131''s nor this file''s';
  END IF;
  IF to_regprocedure('public.fn_folders_board_guard()') IS NULL
     OR to_regprocedure('public.rabbit_money_segment(text)') IS NULL
     OR to_regprocedure('public.board_topic(uuid,boolean,integer)') IS NULL
     OR to_regprocedure('rabbit_private.board_realtime_ready()') IS NULL THEN
    RAISE EXCEPTION '0138 refused: 0130''s folder guard, the money names or 0132''s board channel is missing';
  END IF;
  -- A function of this name is this file's own (a second run) or none.
  -- (No ::regprocedure cast here: SQL does not short-circuit one, and an absent function would fail the cast.)
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.moth_rename_folder(uuid,text)')
              AND p.prosrc NOT LIKE '%WILSON made this folder, so its name stays.%') THEN
    RAISE EXCEPTION '0138 refused: a moth_rename_folder exists that this file did not make';
  END IF;
END $$;

-- §1 board_create and moth_move_folders -------------------------------------------

-- A new board: a custom folder under the parent (the project's top folder when none is named) and its board row.
-- 0138: a thing's own folder (and anything below one) may hold a board; §2 keeps it when the thing goes.
CREATE OR REPLACE FUNCTION public.board_create(p_project uuid, p_parent uuid DEFAULT NULL, p_title text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws     UUID := public.current_workspace_id();
  v_parent public.folders%ROWTYPE;
  v_title  TEXT := btrim(regexp_replace(COALESCE(p_title, ''), '[[:cntrl:]]', ' ', 'g'));
  v_base   TEXT;
  v_slug   TEXT;
  v_path   TEXT;
  v_n      INTEGER := 1;
  v_folder UUID;
  v_board  UUID;
BEGIN
  IF v_title = '' THEN
    v_title := 'Board';
  END IF;
  IF char_length(v_title) > 120 THEN
    RAISE EXCEPTION 'A board''s name is at most 120 characters.' USING ERRCODE = '22023';
  END IF;
  IF p_parent IS NULL THEN
    SELECT * INTO v_parent FROM public.folders fo
     WHERE fo.project_id = p_project AND fo.kind = 'root' AND fo.workspace_id = v_ws;
  ELSE
    SELECT * INTO v_parent FROM public.folders fo
     WHERE fo.id = p_parent AND fo.project_id = p_project AND fo.workspace_id = v_ws;
  END IF;
  -- The parent must be one the caller may write to through Moth's gate (no money or Legal tree, no private project
  -- not theirs, another person's space never). One refusal for all, missing included.
  IF v_parent.id IS NULL OR NOT COALESCE(public.moth_can_write_target('folder', v_parent.id), false) THEN
    RAISE EXCEPTION 'folder not found or not writable' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('moth-boards:' || p_project::text, 0));
  IF (SELECT count(*) FROM public.boards b WHERE b.project_id = p_project) >= 500 THEN
    RAISE EXCEPTION 'A project holds at most 500 boards.' USING ERRCODE = '54000';
  END IF;

  v_base := left(btrim(regexp_replace(lower(v_title), '[^a-z0-9]+', '-', 'g'), '-'), 60);
  IF v_base = '' THEN
    v_base := 'board';
  END IF;
  -- A top-level money or Legal name is refused before any folder is looked up, so the answer never depends on one
  -- that is hidden.
  IF v_parent.kind = 'root' AND public.rabbit_money_segment(v_base) THEN
    RAISE EXCEPTION 'That name is kept for the project''s own folders.' USING ERRCODE = '22023';
  END IF;
  LOOP
    v_slug := CASE WHEN v_n = 1 THEN v_base ELSE v_base || '-' || v_n::text END;
    v_path := CASE WHEN v_parent.path = '' THEN v_slug ELSE v_parent.path || '/' || v_slug END;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.folders fo WHERE fo.project_id = p_project AND fo.path = v_path);
    v_n := v_n + 1;
    IF v_n > 200 THEN
      RAISE EXCEPTION 'Too many folders of that name here.' USING ERRCODE = '23505';
    END IF;
  END LOOP;

  INSERT INTO public.folders (project_id, workspace_id, parent_id, kind, slug, label, path, created_by, updated_by)
  VALUES (p_project, v_ws, v_parent.id, 'custom', v_slug, v_title, v_path, auth.uid(), auth.uid())
  RETURNING id INTO v_folder;
  IF public.moth_folder_chain_locked(v_ws, v_folder) THEN
    RAISE EXCEPTION 'folder not found or not writable' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.boards (folder_id, project_id, workspace_id) VALUES (v_folder, p_project, v_ws)
  RETURNING id INTO v_board;
  RETURN jsonb_build_object('board_id', v_board, 'folder_id', v_folder, 'project_id', p_project,
                            'title', v_title, 'path', v_path);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.board_create(uuid, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.board_create(uuid, uuid, text) TO authenticated;

-- Move folders, with everything below them, under another folder of the same project.
-- 0138: a board may go into a thing's own folder (and below one).
CREATE OR REPLACE FUNCTION public.moth_move_folders(p_ids uuid[], p_dest_parent uuid, p_plan_only boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_ws    UUID := public.current_workspace_id();
  v_ids   UUID[] := ARRAY(SELECT DISTINCT x FROM unnest(p_ids) x WHERE x IS NOT NULL ORDER BY 1);
  v_dest  public.folders%ROWTYPE;
  v_src   public.folders%ROWTYPE;
  v_id    UUID;
  v_sub   UUID[];
  v_slug  TEXT;
  v_root  TEXT;
  v_n     INTEGER;
  v_plan  JSONB := '[]'::jsonb;
  r       RECORD;
BEGIN
  IF auth.uid() IS NULL OR v_ws IS NULL OR NOT COALESCE(public.has_active_membership(v_ws), false) THEN
    RAISE EXCEPTION 'folder not found or not writable' USING ERRCODE = '42501';
  END IF;
  IF cardinality(v_ids) = 0 OR cardinality(v_ids) > 50 THEN
    RAISE EXCEPTION 'One to 50 folders a time.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('moth-folders:' || v_ws::text, 0));
  SELECT * INTO v_dest FROM public.folders fo WHERE fo.id = p_dest_parent AND fo.workspace_id = v_ws FOR UPDATE;
  IF NOT FOUND OR NOT COALESCE(public.moth_can_write_target('folder', p_dest_parent), false) THEN
    RAISE EXCEPTION 'folder not found or not writable' USING ERRCODE = '42501';
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT * INTO v_src FROM public.folders fo WHERE fo.id = v_id AND fo.workspace_id = v_ws FOR UPDATE;
    IF NOT FOUND OR NOT COALESCE(public.moth_can_write_target('folder', v_id), false) THEN
      RAISE EXCEPTION 'folder not found or not writable' USING ERRCODE = '42501';
    END IF;
    IF v_src.kind <> 'custom' THEN
      RAISE EXCEPTION 'This folder is part of the project''s own layout and stays.' USING ERRCODE = '22023';
    END IF;
    IF v_src.project_id IS DISTINCT FROM v_dest.project_id THEN
      RAISE EXCEPTION 'cross_project' USING ERRCODE = 'P0001',
        DETAIL = 'A board or folder stays in its project for now: move its files with Move to.';
    END IF;
    v_sub := rabbit_private.folder_subtree(v_id);
    IF p_dest_parent = ANY (v_sub) THEN
      RAISE EXCEPTION 'A folder cannot go inside itself.' USING ERRCODE = '22023';
    END IF;
    IF cardinality(v_sub) > 2000 THEN
      RAISE EXCEPTION 'A folder with more than 2,000 folders below it cannot move in one step.' USING ERRCODE = '54000';
    END IF;
    IF EXISTS (SELECT 1 FROM public.folders fo WHERE fo.id = ANY (v_sub) AND fo.kind <> 'custom') THEN
      RAISE EXCEPTION 'This folder holds part of the project''s own layout and stays.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.files f WHERE f.folder_id = ANY (v_sub) AND f.deleted_at IS NULL
                AND f.storage_provider::text = 'network_share'
                AND NOT public.file_row_is_money(f.is_financial, f.storage_path)
                AND NOT public.moth_file_row_locked(v_ws, f.project_id, f.id, f.is_financial, f.storage_path, f.tags, f.folder_id)) THEN
      RAISE EXCEPTION 'A folder holding files on the office server cannot move yet.' USING ERRCODE = '22023';
    END IF;
    IF v_dest.kind = 'root' AND public.rabbit_money_segment(v_src.slug) THEN
      RAISE EXCEPTION 'That name is kept for the project''s own folders.' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM public.folders fo WHERE fo.id = ANY (v_sub) ORDER BY fo.id FOR UPDATE;
    IF rabbit_private.folder_subtree(v_id) IS DISTINCT FROM v_sub THEN
      RAISE EXCEPTION 'This folder changed while it was being moved: try again.' USING ERRCODE = '40001';
    END IF;
    IF v_src.parent_id = p_dest_parent THEN
      v_plan := v_plan || jsonb_build_object('id', v_id, 'from', v_src.path, 'to', v_src.path, 'folders', cardinality(v_sub));
      CONTINUE;
    END IF;
    v_slug := v_src.slug;
    v_n := 1;
    LOOP
      v_root := CASE WHEN v_dest.path = '' THEN v_slug ELSE v_dest.path || '/' || v_slug END;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.folders fo WHERE fo.project_id = v_dest.project_id AND fo.path = v_root);
      v_n := v_n + 1;
      v_slug := left(v_src.slug, 60) || '-' || v_n::text;
      IF v_n > 200 THEN
        RAISE EXCEPTION 'Too many folders of that name there.' USING ERRCODE = '23505';
      END IF;
    END LOOP;
    v_plan := v_plan || jsonb_build_object('id', v_id, 'from', v_src.path, 'to', v_root, 'folders', cardinality(v_sub));
    CONTINUE WHEN COALESCE(p_plan_only, false);

    PERFORM set_config('wilson.folder_op', 'move', true);
    -- Parent first, so each row's guard reads its parent's new path.
    FOR r IN SELECT fo.id, fo.path FROM public.folders fo WHERE fo.id = ANY (v_sub)
              ORDER BY array_position(v_sub, fo.id) LOOP
      UPDATE public.folders fo
         SET parent_id = CASE WHEN fo.id = v_id THEN p_dest_parent ELSE fo.parent_id END,
             slug = CASE WHEN fo.id = v_id THEN v_slug ELSE fo.slug END,
             path = v_root || substr(r.path, char_length(v_src.path) + 1),
             updated_by = auth.uid()
       WHERE fo.id = r.id;
    END LOOP;
    PERFORM set_config('wilson.folder_op', '', true);
  END LOOP;
  RETURN jsonb_build_object('moved', v_plan, 'plan_only', COALESCE(p_plan_only, false));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_move_folders(uuid[], uuid, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_move_folders(uuid[], uuid, boolean) TO authenticated;

-- §2 The rescue --------------------------------------------------------------------
-- Before a thing's own folder goes, its boards go to the top of the project. A row trigger on the folder itself, so
-- whatever deletes it (the thing's key, a scene taking its shots, a purge) is covered by one rule, and it runs before
-- the folder's own cascade reaches the folders below it, which then no longer hold the boards. Its name sorts after
-- trg_folders_board_guard, which a client's own delete of a folder holding a board still meets first and is refused
-- by; the cascades the guard lets through (pg_trigger_depth() > 1) are the ones this keeps the boards from.
CREATE OR REPLACE FUNCTION public.fn_folders_board_rescue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_root  public.folders%ROWTYPE;
  v_src   public.folders%ROWTYPE;
  v_top   UUID;
  v_sub   UUID[];
  v_base  TEXT;
  v_slug  TEXT;
  v_path  TEXT;
  v_n     INTEGER;
  r       RECORD;
BEGIN
  -- A project or a company going takes everything in it, boards too, in the one statement that is deleting this
  -- row: nothing of it may be moved now.
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id)
     OR NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = OLD.workspace_id) THEN
    RETURN OLD;
  END IF;
  -- The company's folder lock (as moth_move_folders and the trash take it) and the project's board lock, taken BEFORE
  -- the board is looked for: a board made (board_create) or moved (moth_move_folders) below this folder at the same
  -- moment is either waited for and then seen and moved, or comes after and finds its folder gone. Looked for first,
  -- a board committed just after the look was lost to the cascade (MO5 review round 1). Both are transaction locks,
  -- taken again at no cost by the next thing's folder in the same statement.
  PERFORM pg_advisory_xact_lock(hashtextextended('moth-folders:' || OLD.workspace_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('moth-boards:' || OLD.project_id::text, 0));
  -- No board at or below this folder: nothing to do (the common answer).
  IF NOT EXISTS (
       WITH RECURSIVE down (id, depth) AS (
         SELECT OLD.id, 1
         UNION ALL
         SELECT c.id, down.depth + 1 FROM down JOIN public.folders c ON c.parent_id = down.id WHERE down.depth < 64
       )
       SELECT 1 FROM down JOIN public.boards b ON b.folder_id = down.id) THEN
    RETURN OLD;
  END IF;
  SELECT * INTO v_root FROM public.folders fo
   WHERE fo.project_id = OLD.project_id AND fo.kind = 'root' AND fo.parent_id IS NULL
   ORDER BY fo.id LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_root.id = OLD.id THEN
    RETURN OLD;
  END IF;

  -- Each board's folder below this one that no other board's folder (below this one) holds, nearest first.
  FOR v_top IN
    WITH RECURSIVE down (id, depth, in_board) AS (
      SELECT c.id, 1, false FROM public.folders c WHERE c.parent_id = OLD.id
      UNION ALL
      SELECT c.id, down.depth + 1,
             down.in_board OR EXISTS (SELECT 1 FROM public.boards b WHERE b.folder_id = down.id)
        FROM down JOIN public.folders c ON c.parent_id = down.id WHERE down.depth < 64
    )
    SELECT d.id FROM down d JOIN public.boards b ON b.folder_id = d.id
     WHERE NOT d.in_board
     ORDER BY d.depth, d.id
  LOOP
    SELECT * INTO v_src FROM public.folders fo WHERE fo.id = v_top FOR UPDATE;
    -- Never a money or Legal name at the top: that would make the board a money folder (0111's guard refuses the
    -- change, and the whole delete with it).
    v_base := left(v_src.slug, 60);
    IF v_base IS NULL OR v_base = '' THEN
      v_base := 'board';
    END IF;
    IF public.rabbit_money_segment(v_base) THEN
      v_base := left('board-' || v_base, 60);
    END IF;
    v_slug := v_base;
    v_n := 1;
    LOOP
      v_path := CASE WHEN v_root.path = '' THEN v_slug ELSE v_root.path || '/' || v_slug END;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.folders fo WHERE fo.project_id = OLD.project_id AND fo.path = v_path)
                AND NOT public.rabbit_money_segment(v_slug);
      v_n := v_n + 1;
      v_slug := CASE WHEN v_n <= 200 THEN v_base || '-' || v_n::text
                     ELSE left(v_base, 50) || '-' || substr(md5(v_top::text || v_n::text), 1, 8) END;
      IF v_n > 260 THEN
        RAISE EXCEPTION 'A board in this folder could not be given a free name at the top of its project.' USING ERRCODE = '23505';
      END IF;
    END LOOP;
    -- Everything below the board's folder, itself first, parent before child (each row's guard reads its parent's
    -- new path). Not capped: a move that stopped part way would leave paths half rewritten.
    v_sub := ARRAY(
      WITH RECURSIVE down (id, depth) AS (
        SELECT v_top, 1
        UNION ALL
        SELECT c.id, down.depth + 1 FROM down JOIN public.folders c ON c.parent_id = down.id WHERE down.depth < 64
      )
      SELECT id FROM down ORDER BY depth, id);
    FOR r IN SELECT fo.id, fo.path FROM public.folders fo WHERE fo.id = ANY (v_sub)
              ORDER BY array_position(v_sub, fo.id) LOOP
      UPDATE public.folders fo
         SET parent_id = CASE WHEN fo.id = v_top THEN v_root.id ELSE fo.parent_id END,
             slug = CASE WHEN fo.id = v_top THEN v_slug ELSE fo.slug END,
             path = v_path || substr(r.path, char_length(v_src.path) + 1)
       WHERE fo.id = r.id;
    END LOOP;
  END LOOP;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_folders_board_rescue() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_folders_board_rescue ON public.folders;
CREATE TRIGGER trg_folders_board_rescue
  BEFORE DELETE ON public.folders
  FOR EACH ROW WHEN (OLD.kind = 'entity')
  EXECUTE FUNCTION public.fn_folders_board_rescue();

COMMENT ON FUNCTION public.fn_folders_board_rescue() IS
  '0138: before a thing''s own folder is deleted, every board folder below it (not inside another board) moves to the top of its project under a free, non-money name. A project or company going takes its boards.';

-- §3 Renaming a folder, a board's among them (her items 7 and 8) --------------------
-- A person's own folders only (kind 'custom', which is what a board's folder is): the project's top, its ASSETS,
-- SCENES and other folders WILSON makes, and a thing's own folder (named after the thing) keep their names. Asked
-- through Moth's write gate, as making a board there is; one refusal for missing and not allowed. The name is cleaned
-- as a board's is, and only the label changes: the folder's slug and path, and so every file's place, stay. A board's
-- folder renamed tells everyone on the board at once, on its own channel; 'at' orders two renames that cross.
CREATE OR REPLACE FUNCTION public.moth_rename_folder(p_folder uuid, p_label text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws    UUID := public.current_workspace_id();
  v_f     public.folders%ROWTYPE;
  v_label TEXT := btrim(regexp_replace(COALESCE(p_label, ''), '[[:cntrl:]]', ' ', 'g'));
  v_board UUID;
  v_at    BIGINT;
BEGIN
  IF auth.uid() IS NULL OR v_ws IS NULL OR NOT COALESCE(public.has_active_membership(v_ws), false) THEN
    RAISE EXCEPTION 'folder not found or not writable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_f FROM public.folders fo
   WHERE fo.id = p_folder AND fo.workspace_id = v_ws AND fo.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND OR NOT COALESCE(public.moth_can_write_target('folder', p_folder), false) THEN
    RAISE EXCEPTION 'folder not found or not writable' USING ERRCODE = '42501';
  END IF;
  IF v_f.kind <> 'custom' THEN
    RAISE EXCEPTION 'WILSON made this folder, so its name stays.' USING ERRCODE = '22023';
  END IF;
  IF v_label = '' THEN
    RAISE EXCEPTION 'A name cannot be empty.' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_label) > 120 THEN
    RAISE EXCEPTION 'A name is at most 120 characters.' USING ERRCODE = '22023';
  END IF;
  SELECT b.id INTO v_board FROM public.boards b WHERE b.folder_id = v_f.id;
  IF v_f.label IS NOT DISTINCT FROM v_label THEN
    RETURN jsonb_build_object('folder_id', v_f.id, 'label', v_label, 'board_id', v_board, 'changed', false);
  END IF;
  UPDATE public.folders fo SET label = v_label, updated_by = auth.uid() WHERE fo.id = v_f.id;
  v_at := floor(extract(epoch FROM clock_timestamp()) * 1000);
  IF v_board IS NOT NULL AND rabbit_private.board_realtime_ready() THEN
    PERFORM realtime.send(jsonb_build_object('board', v_board, 'op', 'title', 'title', v_label, 'at', v_at),
                          'board', public.board_topic(v_board, false), true);
  END IF;
  RETURN jsonb_build_object('folder_id', v_f.id, 'label', v_label, 'board_id', v_board, 'changed', true, 'at', v_at);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_rename_folder(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_rename_folder(uuid, text) TO authenticated;

-- §4 Post-conditions --------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.board_create(uuid,uuid,text)'::regprocedure)
       <> '8898169887a32b2ea63e0bbb71e04a33' THEN
    RAISE EXCEPTION '0138 post-condition: board_create is not this file''s';
  END IF;
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.moth_move_folders(uuid[],uuid,boolean)'::regprocedure)
       <> '41209fac54f1e1c2df25089acc5a7899' THEN
    RAISE EXCEPTION '0138 post-condition: moth_move_folders is not this file''s';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.folders'::regclass AND tgname = 'trg_folders_board_rescue'
                  AND tgfoid = 'public.fn_folders_board_rescue()'::regprocedure) THEN
    RAISE EXCEPTION '0138 post-condition: the rescue''s trigger is missing';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_folders_board_rescue()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_folders_board_rescue()', 'EXECUTE') THEN
    RAISE EXCEPTION '0138 post-condition: a client may call the rescue';
  END IF;
  IF has_function_privilege('anon', 'public.board_create(uuid,uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.board_create(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.moth_move_folders(uuid[],uuid,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.moth_move_folders(uuid[],uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION '0138 post-condition: the grants are not 0130''s and 0131''s';
  END IF;
  IF has_function_privilege('anon', 'public.moth_rename_folder(uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.moth_rename_folder(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '0138 post-condition: renaming is not a signed-in person''s alone';
  END IF;
END $$;
