-- =============================================================================
-- 0131_folder_trash_and_moves.sql — M.O.T.H. Session 4 (MO4): a folder's trash, and moving a folder.
-- (docs/design/MOTH_DESIGN.md §2.3 MV-18 and §1.13; the brief §12a.5 and §12a.8; PLAN_MOTH §5 Session 4.)
--
-- A board is a folder (0130), so a board's trash is its folder's, and a board moves as its folder does. Until now a
-- folder had no trash (a client's DELETE removed it, and its files dropped to the project's top folder) and nothing
-- moved one but a client rewriting each path itself. Board folders are the first folders this changes for.
--
-- WHAT THIS CHANGES
-- -----------------
--   §1  folders.deleted_at, deleted_by, trash_batch; files.trash_batch. A folder goes to the trash with everything
--       below it that is not in the trash already: one batch id on each folder and file it takes, so a restore
--       brings back that batch and nothing else (a file put in the trash on its own before keeps its own). The
--       stamp trigger (0014) says who, on folders as on files. A folder trash index.
--   §2  Guards. fn_folders_trash_guard: a client never writes a folder's trash columns itself (only §4's functions,
--       under wilson.folder_op = 'trash'), never makes or moves a folder under one in the trash (the parent read
--       FOR SHARE, so a trash running at the same moment is waited for), and never deletes a folder with anything
--       of a trash batch below it (that would strand the batch's files). folders_select (0041's) leaves a folder in
--       the trash out, as every other trashed row is left out of its table's reads.
--       fn_files_folder_trash_guard: a client never writes a file's batch, never brings back a file that went with
--       its folder (its folder comes back first, and brings it), and never puts a live file into a folder in the
--       trash (an upload, a move, a restore of a file whose folder went after it).
--   §3  Moth's gate (_moth_target_eligible, restated from 0126's body): a folder in the trash is no target unless a
--       definer asks for one, as a file in the trash already is. Everything below it went with it, so asking the
--       folder itself is enough; §2 keeps it so.
--   §4  moth_trash_folders(ids): custom folders only (a project's own top, category and entity folders stay), each
--       one the caller may change through Moth's gate, at most 50 a call and 2,000 folders and 10,000 files below
--       each; refused whole if one cannot go (a money or Legal file below, a file on the office server, a project
--       folder below). moth_restore_folders(ids): a batch back, once the folder above it is live. moth_trashed_folders():
--       what the caller may bring back, a board marked, nothing of another person's space. moth_move_folders(ids,
--       parent, plan_only): within a project (a board or folder stays in its project; its files move with Move to),
--       never into itself or below itself, never
--       into the trash or a money or Legal folder, a name made unique, every path below rewritten parent first; under
--       the company's folder lock, as the trash is.
--   §5  moth_trash_index (restated from 0118's body) leaves out a file that went with its folder: the folder is the
--       entry. purge_soft_deleted (restated from 0121's body) removes a folder 30 days after it went to the trash,
--       once no file row is left anywhere below it, after the files (its board and elements go with it).
--
-- Nothing here changes R.A.B.B.I.T.'s own folders or who may read a file. One transaction, re-runnable, no enum. Suite
-- 136_folder_trash_and_moves.sql; 52_folders, 113_moth_read_path and 120 (Moth's trash) affected.
-- =============================================================================

SET LOCAL lock_timeout = '5s';

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
BEGIN
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0131 refused: % does not bypass row security', current_user;
  END IF;
  IF to_regclass('public.boards') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.boards') AND conname = 'boards_folder_key') THEN
    RAISE EXCEPTION '0131 refused: 0130 must be applied first';
  END IF;
  -- The bodies §3 and §5 restate, as 0126, 0118 and 0121 left them, or as this file leaves them on a second run.
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public._moth_target_eligible(text,uuid,boolean)'::regprocedure)
       NOT IN ('d698cc503481bb497557ff247b3aab72', 'dfa3baaaf60ae20901b49fa75a65fef8') THEN
    RAISE EXCEPTION '0131 refused: Moth''s gate is neither 0126''s nor this file''s';
  END IF;
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.moth_trash_index(integer,timestamptz)'::regprocedure)
       NOT IN ('5ed8abc3a87dc9ea4b5147efa71c619d', '40f9f709382f5107ffefed9040e0a53e') THEN
    RAISE EXCEPTION '0131 refused: moth_trash_index is neither 0118''s nor this file''s';
  END IF;
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.purge_soft_deleted(interval)'::regprocedure)
       NOT IN ('4f659fad4e1fd978f0cd220c6a628eb4', '32c0b15dd8b7ba53996084765aa59564') THEN
    RAISE EXCEPTION '0131 refused: purge_soft_deleted is neither 0121''s nor this file''s';
  END IF;
  IF to_regprocedure('public.fn_soft_delete_stamp()') IS NULL THEN
    RAISE EXCEPTION '0131 refused: fn_soft_delete_stamp (0014) is missing';
  END IF;
END $$;

-- §1 Columns --------------------------------------------------------------------
ALTER TABLE public.folders ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ;
ALTER TABLE public.folders ADD COLUMN IF NOT EXISTS deleted_by  UUID;
ALTER TABLE public.folders ADD COLUMN IF NOT EXISTS trash_batch UUID;
ALTER TABLE public.files   ADD COLUMN IF NOT EXISTS trash_batch UUID;
CREATE INDEX IF NOT EXISTS folders_trash_idx ON public.folders (workspace_id, deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS folders_trash_batch_idx ON public.folders (trash_batch) WHERE trash_batch IS NOT NULL;
CREATE INDEX IF NOT EXISTS files_trash_batch_idx ON public.files (trash_batch) WHERE trash_batch IS NOT NULL;

DROP TRIGGER IF EXISTS trg_folders_soft_delete ON public.folders;
CREATE TRIGGER trg_folders_soft_delete
  BEFORE UPDATE OF deleted_at ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.fn_soft_delete_stamp();

COMMENT ON COLUMN public.folders.trash_batch IS
  '0131: the trash batch this folder went with (moth_trash_folders); a restore brings back one batch. Server-written only.';
COMMENT ON COLUMN public.files.trash_batch IS
  '0131: set when the file went to the trash with its folder (moth_trash_folders); it comes back with that folder. Server-written only.';

-- The folders below a folder, itself first, at most 64 deep and 2,001 in all (the caller refuses past 2,000).
CREATE OR REPLACE FUNCTION rabbit_private.folder_subtree(p_folder uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(d.id ORDER BY d.depth, d.id), '{}'::uuid[]) FROM (
    WITH RECURSIVE down (id, depth) AS (
      SELECT fo.id, 1 FROM public.folders fo WHERE fo.id = p_folder
      UNION ALL
      SELECT c.id, down.depth + 1 FROM down JOIN public.folders c ON c.parent_id = down.id WHERE down.depth < 64
    )
    SELECT id, depth FROM down LIMIT 2001) d;
$$;
REVOKE EXECUTE ON FUNCTION rabbit_private.folder_subtree(uuid) FROM PUBLIC, anon, authenticated;

-- §2 Guards ---------------------------------------------------------------------
-- Restated from 0041's: a folder in the trash is out of the table's reads (and so out of a client's UPDATE and
-- DELETE, which see only what they read). Moth's own functions read it as definers.
DROP POLICY IF EXISTS folders_select ON public.folders;
CREATE POLICY folders_select ON public.folders
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = folders.project_id)
  );

CREATE OR REPLACE FUNCTION public.fn_folders_trash_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bound  BOOLEAN := COALESCE(current_setting('role', true), '') IN ('authenticated', 'anon');
  v_op     TEXT := COALESCE(current_setting('wilson.folder_op', true), '');
  v_parent TIMESTAMPTZ;
BEGIN
  IF NOT v_bound THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    -- A client's own delete (a cascade from a project's purge passes) never takes a folder with a trash batch's
    -- folder or file below it: the batch's files would be left with no folder to come back with.
    IF pg_trigger_depth() = 1 AND EXISTS (
         SELECT 1 FROM public.folders fo WHERE fo.id = ANY (rabbit_private.folder_subtree(OLD.id)) AND fo.trash_batch IS NOT NULL
         UNION ALL
         SELECT 1 FROM public.files f WHERE f.folder_id = ANY (rabbit_private.folder_subtree(OLD.id)) AND f.trash_batch IS NOT NULL) THEN
      RAISE EXCEPTION 'Something in this folder is in the trash: bring it back or wait for it to go first.' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NOT NULL OR NEW.deleted_by IS NOT NULL OR NEW.trash_batch IS NOT NULL THEN
      RAISE EXCEPTION 'A folder goes to the trash through Moth.' USING ERRCODE = '42501';
    END IF;
  ELSIF v_op <> 'trash'
        AND (NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by
             OR NEW.trash_batch IS DISTINCT FROM OLD.trash_batch) THEN
    RAISE EXCEPTION 'A folder goes to the trash through Moth.' USING ERRCODE = '42501';
  END IF;
  -- The restore's own rows (wilson.folder_op = 'trash') are not asked: a batch comes back whole, in whatever order
  -- its rows are visited, and moth_restore_folders asks the batch's top folder's parent itself.
  IF v_op <> 'trash' AND NEW.parent_id IS NOT NULL AND NEW.deleted_at IS NULL
     AND (TG_OP = 'INSERT' OR NEW.parent_id IS DISTINCT FROM OLD.parent_id OR OLD.deleted_at IS NOT NULL) THEN
    -- FOR SHARE: a trash taking this parent at the same moment is waited for, and then read as it committed.
    SELECT par.deleted_at INTO v_parent FROM public.folders par WHERE par.id = NEW.parent_id FOR SHARE;
    IF v_parent IS NOT NULL THEN
      RAISE EXCEPTION 'That folder is in the trash.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_folders_trash_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_folders_trash_guard ON public.folders;
CREATE TRIGGER trg_folders_trash_guard
  BEFORE INSERT OR DELETE OR UPDATE OF deleted_at, deleted_by, trash_batch, parent_id ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.fn_folders_trash_guard();

CREATE OR REPLACE FUNCTION public.fn_files_folder_trash_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bound  BOOLEAN := COALESCE(current_setting('role', true), '') IN ('authenticated', 'anon');
  v_op     TEXT := COALESCE(current_setting('wilson.folder_op', true), '');
  v_folder TIMESTAMPTZ;
BEGIN
  IF NOT v_bound THEN
    RETURN NEW;
  END IF;
  IF v_op <> 'trash' THEN
    IF (TG_OP = 'INSERT' AND NEW.trash_batch IS NOT NULL)
       OR (TG_OP = 'UPDATE' AND NEW.trash_batch IS DISTINCT FROM OLD.trash_batch) THEN
      RAISE EXCEPTION 'A file goes to the trash with its folder through Moth.' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.trash_batch IS NOT NULL AND OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      RAISE EXCEPTION 'This file went to the trash with its folder: bring back the folder to bring it back.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  IF v_op <> 'trash' AND NEW.deleted_at IS NULL AND NEW.folder_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.folder_id IS DISTINCT FROM OLD.folder_id OR OLD.deleted_at IS NOT NULL) THEN
    SELECT fo.deleted_at INTO v_folder FROM public.folders fo WHERE fo.id = NEW.folder_id FOR SHARE;
    IF v_folder IS NOT NULL THEN
      RAISE EXCEPTION 'That folder is in the trash.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_files_folder_trash_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_files_folder_trash_guard ON public.files;
CREATE TRIGGER trg_files_folder_trash_guard
  BEFORE INSERT OR UPDATE OF folder_id, deleted_at, trash_batch ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.fn_files_folder_trash_guard();

-- §3 Moth's gate ----------------------------------------------------------------
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
  v_tier     TEXT;
  v_owner    UUID;
BEGIN
  IF p_id IS NULL OR auth.uid() IS NULL OR v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RETURN false;
  END IF;

  IF p_kind = 'project' THEN
    v_project := p_id;
  ELSIF p_kind = 'folder' THEN
    -- 0131: a folder in the trash is no target unless a definer asks for one, as a file in the trash already is.
    -- Everything below it went with it, and fn_folders_trash_guard keeps it so, so the folder's own stamp says.
    SELECT fo.project_id, fo.deleted_at INTO v_project, v_deleted
      FROM public.folders fo
     WHERE fo.id = p_id AND fo.workspace_id = v_ws;
    IF v_project IS NULL
       OR (v_deleted IS NOT NULL AND NOT COALESCE(p_allow_trashed, false))
       OR public.moth_folder_chain_locked(v_ws, p_id) THEN
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
  ELSIF p_kind = 'note' THEN
    -- 0125: a workspace note is the company's, not a project's. Its owner's alone while personal (no admin leg),
    -- every active member's once shared, and none in the trash unless a definer asks for one.
    SELECT n.tier, n.owner_id, n.deleted_at INTO v_tier, v_owner, v_deleted
      FROM public.notes n
     WHERE n.id = p_id AND n.workspace_id = v_ws;
    RETURN v_tier IS NOT NULL
       AND (v_deleted IS NULL OR COALESCE(p_allow_trashed, false))
       AND (v_tier <> 'personal' OR v_owner = auth.uid());
  ELSIF p_kind = 'mtag' THEN
    -- 0126: a typed tag is the company's or one person's, and a personal one its owner's alone (no admin leg). A tag
    -- folded into another stands for it no longer.
    SELECT t.tier, t.owner_id INTO v_tier, v_owner
      FROM public.moth_tags t
     WHERE t.id = p_id AND t.workspace_id = v_ws AND t.canonical_id IS NULL;
    RETURN v_tier IS NOT NULL AND (v_tier = 'company' OR v_owner = auth.uid());
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

-- §4 The trash and moves --------------------------------------------------------

-- One refusal for a folder the caller may not reach, missing included, so no answer says a hidden one exists.
CREATE OR REPLACE FUNCTION public.moth_trash_folders(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_ws    UUID := public.current_workspace_id();
  v_ids   UUID[] := ARRAY(SELECT x FROM (SELECT DISTINCT x FROM unnest(p_ids) x WHERE x IS NOT NULL) d(x)
                            LEFT JOIN public.folders fo ON fo.id = d.x
                           ORDER BY COALESCE(char_length(fo.path) - char_length(replace(fo.path, '/', '')), 0), d.x);
  v_id    UUID;
  v_f     public.folders%ROWTYPE;
  v_sub   UUID[];
  v_all   UUID[] := '{}';
  v_batch UUID;
  v_roots JSONB := '[]'::jsonb;
  v_n     INTEGER;
  v_cnt   INTEGER;
  v_files INTEGER := 0;
  v_dirs  INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR v_ws IS NULL OR NOT COALESCE(public.has_active_membership(v_ws), false) THEN
    RAISE EXCEPTION 'folder not found or not writable' USING ERRCODE = '42501';
  END IF;
  IF cardinality(v_ids) = 0 OR cardinality(v_ids) > 50 THEN
    RAISE EXCEPTION 'One to 50 folders a time.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('moth-folders:' || v_ws::text, 0));
  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT * INTO v_f FROM public.folders fo WHERE fo.id = v_id AND fo.workspace_id = v_ws FOR UPDATE;
    IF NOT FOUND OR NOT COALESCE(public.moth_can_write_target('folder', v_id), false) THEN
      RAISE EXCEPTION 'folder not found or not writable' USING ERRCODE = '42501';
    END IF;
    IF v_id = ANY (v_all) THEN
      CONTINUE;
    END IF;
    v_sub := rabbit_private.folder_subtree(v_id);
    IF cardinality(v_sub) > 2000 THEN
      RAISE EXCEPTION 'A folder with more than 2,000 folders below it cannot go to the trash in one step.' USING ERRCODE = '54000';
    END IF;
    IF EXISTS (SELECT 1 FROM public.folders fo WHERE fo.id = ANY (v_sub) AND fo.kind <> 'custom') THEN
      RAISE EXCEPTION 'This folder is part of the project''s own layout and stays.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.files f WHERE f.folder_id = ANY (v_sub) AND f.deleted_at IS NULL
                AND f.storage_provider::text = 'network_share'
                AND NOT public.file_row_is_money(f.is_financial, f.storage_path)
                AND NOT public.moth_file_row_locked(v_ws, f.project_id, f.id, f.is_financial, f.storage_path, f.tags, f.folder_id)) THEN
      RAISE EXCEPTION 'A folder holding files on the office server cannot go to the trash yet.' USING ERRCODE = '22023';
    END IF;
    v_all := v_all || v_sub;
    v_roots := v_roots || jsonb_build_object('root', v_id, 'sub', to_jsonb(v_sub));
  END LOOP;
  -- The files below, locked before anything is judged, so what is judged is what goes.
  PERFORM 1 FROM public.files f WHERE f.folder_id = ANY (v_all) AND f.deleted_at IS NULL ORDER BY f.id FOR UPDATE;
  IF (SELECT count(*) FROM public.files f WHERE f.folder_id = ANY (v_all) AND f.deleted_at IS NULL) > 10000 THEN
    RAISE EXCEPTION 'More than 10,000 files would go at once.' USING ERRCODE = '54000';
  END IF;

  -- A money or Legal file below (one Moth never shows) does not go and does not stop the trash: it moves to the
  -- project's top folder, where those who may see it still do, and nothing here says it was there.
  UPDATE public.files f SET folder_id = NULL
   WHERE f.folder_id = ANY (v_all) AND f.deleted_at IS NULL
     AND (public.file_row_is_money(f.is_financial, f.storage_path)
          OR public.moth_file_row_locked(v_ws, f.project_id, f.id, f.is_financial, f.storage_path, f.tags, f.folder_id));
  PERFORM set_config('wilson.folder_op', 'trash', true);
  -- One batch a top folder asked for, so each comes back on its own and each entry counts only its own.
  FOR v_n IN 0 .. jsonb_array_length(v_roots) - 1 LOOP
    v_batch := gen_random_uuid();
    UPDATE public.folders fo SET deleted_at = now(), deleted_by = auth.uid(), trash_batch = v_batch
     WHERE fo.id = ANY (ARRAY(SELECT (x #>> '{}')::uuid FROM jsonb_array_elements(v_roots -> v_n -> 'sub') x))
       AND fo.deleted_at IS NULL;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_dirs := v_dirs + v_cnt;
    -- A folder made below one of these between the subtree's read and its stamp goes too, to a fixed point.
    LOOP
      UPDATE public.folders fo SET deleted_at = now(), deleted_by = auth.uid(), trash_batch = v_batch
       WHERE fo.deleted_at IS NULL
         AND fo.parent_id IN (SELECT par.id FROM public.folders par WHERE par.trash_batch = v_batch);
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      EXIT WHEN v_cnt = 0;
      v_dirs := v_dirs + v_cnt;
      v_all := v_all || ARRAY(SELECT fo.id FROM public.folders fo WHERE fo.trash_batch = v_batch);
    END LOOP;
  END LOOP;
  UPDATE public.files f SET deleted_at = now(),
         trash_batch = (SELECT fo.trash_batch FROM public.folders fo WHERE fo.id = f.folder_id)
   WHERE f.folder_id = ANY (v_all) AND f.deleted_at IS NULL;
  GET DIAGNOSTICS v_files = ROW_COUNT;
  -- A board in the trash closes to everyone on it (0132's channels are named with this count).
  UPDATE public.boards b SET audience_gen = b.audience_gen + 1 WHERE b.folder_id = ANY (v_all);
  PERFORM set_config('wilson.folder_op', '', true);
  RETURN jsonb_build_object('batches', jsonb_array_length(v_roots), 'folders', v_dirs, 'files', v_files);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_trash_folders(uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_trash_folders(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.moth_restore_folders(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_ws     UUID := public.current_workspace_id();
  v_ids    UUID[] := ARRAY(SELECT DISTINCT x FROM unnest(p_ids) x WHERE x IS NOT NULL ORDER BY 1);
  v_id     UUID;
  v_f      public.folders%ROWTYPE;
  v_parent TIMESTAMPTZ;
  v_dirs   INTEGER := 0;
  v_files  INTEGER := 0;
  v_n      INTEGER;
  v_back   UUID[] := '{}';
BEGIN
  IF auth.uid() IS NULL OR v_ws IS NULL OR NOT COALESCE(public.has_active_membership(v_ws), false) THEN
    RAISE EXCEPTION 'folder not found or not writable' USING ERRCODE = '42501';
  END IF;
  IF cardinality(v_ids) = 0 OR cardinality(v_ids) > 50 THEN
    RAISE EXCEPTION 'One to 50 folders a time.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('moth-folders:' || v_ws::text, 0));
  FOREACH v_id IN ARRAY v_ids LOOP
    CONTINUE WHEN v_id = ANY (v_back);
    SELECT * INTO v_f FROM public.folders fo WHERE fo.id = v_id AND fo.workspace_id = v_ws FOR UPDATE;
    IF NOT FOUND OR v_f.deleted_at IS NULL OR v_f.trash_batch IS NULL
       OR v_f.deleted_at < now() - interval '30 days'
       OR NOT COALESCE(public._moth_target_eligible('folder', v_id, true), false)
       OR NOT COALESCE(public.moth_can_write_target('project', v_f.project_id), false) THEN
      RAISE EXCEPTION 'folder not found or not writable' USING ERRCODE = '42501';
    END IF;
    SELECT par.deleted_at INTO v_parent FROM public.folders par WHERE par.id = v_f.parent_id;
    IF v_parent IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.folders par
                                             WHERE par.id = v_f.parent_id AND par.trash_batch = v_f.trash_batch) THEN
      RAISE EXCEPTION 'The folder this one was in is in the trash too: bring that back first.' USING ERRCODE = '22023';
    END IF;
    PERFORM set_config('wilson.folder_op', 'trash', true);
    v_back := v_back || ARRAY(SELECT fo.id FROM public.folders fo WHERE fo.trash_batch = v_f.trash_batch);
    UPDATE public.folders fo SET deleted_at = NULL, deleted_by = NULL, trash_batch = NULL
     WHERE fo.trash_batch = v_f.trash_batch;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_dirs := v_dirs + v_n;
    UPDATE public.files f SET deleted_at = NULL, trash_batch = NULL
     WHERE f.trash_batch = v_f.trash_batch;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_files := v_files + v_n;
    PERFORM set_config('wilson.folder_op', '', true);
  END LOOP;
  RETURN jsonb_build_object('folders', v_dirs, 'files', v_files);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_restore_folders(uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_restore_folders(uuid[]) TO authenticated;

-- What the caller may bring back: each batch by the folder it was put in the trash from.
CREATE OR REPLACE FUNCTION public.moth_trashed_folders(p_limit integer DEFAULT 200, p_before timestamptz DEFAULT NULL,
                                                      p_before_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_ws    UUID := public.current_workspace_id();
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
  v_out   JSONB := '[]'::jsonb;
  r       RECORD;
BEGIN
  IF auth.uid() IS NULL OR v_ws IS NULL OR NOT COALESCE(public.has_active_membership(v_ws), false) THEN
    RAISE EXCEPTION 'moth_trash:not_a_workspace_member' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN
    SELECT fo.id, fo.project_id, p.title, fo.label, fo.slug, fo.deleted_at, fo.trash_batch,
           COALESCE(wm.display_name, wm.username) AS who
      FROM public.folders fo
      JOIN public.projects p ON p.id = fo.project_id
      LEFT JOIN public.workspace_members wm ON wm.workspace_id = fo.workspace_id AND wm.user_id = fo.deleted_by
     WHERE fo.workspace_id = v_ws
       AND fo.trash_batch IS NOT NULL
       AND fo.deleted_at > now() - interval '30 days'
       AND (p_before IS NULL
            OR (fo.deleted_at, fo.id) < (p_before, COALESCE(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
       AND p.deleted_at IS NULL
       AND (p.personal_owner_id IS NULL OR p.personal_owner_id = auth.uid())
       AND NOT EXISTS (SELECT 1 FROM public.folders par WHERE par.id = fo.parent_id AND par.trash_batch = fo.trash_batch)
     ORDER BY fo.deleted_at DESC, fo.id DESC
  LOOP
    EXIT WHEN jsonb_array_length(v_out) >= v_limit;
    CONTINUE WHEN NOT COALESCE(public._moth_target_eligible('folder', r.id, true), false);
    v_out := v_out || jsonb_build_object(
      'id', r.id, 'project_id', r.project_id, 'project_title', r.title, 'name', COALESCE(r.label, r.slug),
      'is_board', EXISTS (SELECT 1 FROM public.boards b WHERE b.folder_id = r.id),
      'files', (SELECT count(*) FROM public.files f WHERE f.trash_batch = r.trash_batch),
      'deleted_at', r.deleted_at, 'deleted_by_label', r.who, 'purges_at', r.deleted_at + interval '30 days',
      'can_restore', COALESCE(public.moth_can_write_target('project', r.project_id), false));
  END LOOP;
  RETURN v_out;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_trashed_folders(integer, timestamptz, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_trashed_folders(integer, timestamptz, uuid) TO authenticated;

-- Move folders, with everything below them, under another folder of the same project.
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
    IF EXISTS (SELECT 1 FROM public.boards b WHERE b.folder_id = ANY (v_sub))
       AND rabbit_private.folder_chain_has_entity(p_dest_parent) THEN
      RAISE EXCEPTION 'A board stays in the project''s own folders, not inside a shot''s, a scene''s or an asset''s.'
        USING ERRCODE = '22023';
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

-- §5 Moth's trash index and the purge ---------------------------------------------
CREATE OR REPLACE FUNCTION public.moth_trash_index(p_limit integer DEFAULT 200, p_before timestamptz DEFAULT NULL)
RETURNS TABLE (
  id uuid, project_id uuid, project_title text, folder_id uuid, name text, mime_type text, size_bytes bigint,
  kind public.file_kind, deleted_at timestamptz, deleted_by_label text, purges_at timestamptz,
  can_restore boolean, needs_desktop boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
#variable_conflict use_column
DECLARE
  v_ws    uuid := public.current_workspace_id();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
  v_n     integer := 0;
  v_last  timestamptz;
  r       record;
BEGIN
  IF auth.uid() IS NULL OR v_ws IS NULL OR NOT COALESCE(public.has_active_membership(v_ws), false) THEN
    RAISE EXCEPTION 'moth_trash:not_a_workspace_member' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN
    SELECT f.id, f.project_id, p.title, f.folder_id, f.name, f.mime_type, f.size_bytes, f.kind,
           f.deleted_at, COALESCE(wm.display_name, wm.username) AS label, f.storage_provider::text AS provider
      FROM public.files f
      JOIN public.projects p ON p.id = f.project_id
      LEFT JOIN public.workspace_members wm ON wm.workspace_id = f.workspace_id AND wm.user_id = f.deleted_by
     WHERE f.workspace_id = v_ws
       AND f.deleted_at IS NOT NULL
       -- 0131: a file that went with its folder is listed as that folder (moth_trashed_folders), and comes back with it.
       AND f.trash_batch IS NULL
       AND f.deleted_at > now() - interval '30 days'
       AND (p_before IS NULL OR f.deleted_at < p_before)
       -- What the gate below refuses anyway, dropped here because it asks row by row.
       AND p.deleted_at IS NULL
       AND (p.personal_owner_id IS NULL OR p.personal_owner_id = auth.uid())
       AND NOT COALESCE(f.is_financial, false)
     ORDER BY f.deleted_at DESC, f.id DESC
  LOOP
    EXIT WHEN v_n >= v_limit AND r.deleted_at IS DISTINCT FROM v_last;
    CONTINUE WHEN NOT public._moth_target_eligible('file', r.id, true);
    id := r.id;
    project_id := r.project_id;
    project_title := r.title;
    folder_id := r.folder_id;
    name := r.name;
    mime_type := r.mime_type;
    size_bytes := r.size_bytes;
    kind := r.kind;
    deleted_at := r.deleted_at;
    deleted_by_label := r.label;
    purges_at := r.deleted_at + interval '30 days';
    can_restore := public.moth_can_write_target('project', r.project_id);
    needs_desktop := r.provider = 'network_share';
    v_n := v_n + 1;
    v_last := r.deleted_at;
    RETURN NEXT;
  END LOOP;
END;
$$;

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
  -- 0121: an unfinished office-server operation holds a row or a project from the purge, but not for
  -- ever. Its laptop may never come back, and nobody can settle under a binned project: 'until restored'
  -- would keep it, and its folder's claim, with nothing in any list to restore it from. Past the same
  -- retention the operation is closed, and the certificate says what stayed on the server.
  UPDATE public.network_share_ops o
     SET state = 'reverted', settled_at = clock_timestamp()
    FROM public.files f
    LEFT JOIN public.projects p ON p.id = f.project_id
   WHERE f.id = o.file_id
     AND o.state = 'pending'
     AND o.created_at < now() - p_retention
     AND (f.deleted_at < now() - p_retention
          OR p.deleted_at < now() - p_retention
          OR EXISTS (SELECT 1 FROM public.projects q WHERE q.id = o.project_id AND q.deleted_at < now() - p_retention));

  -- Parents first so cascades do the bulk of the work; the remaining loops
  -- catch individually soft-deleted children.
  FOREACH t IN ARRAY ARRAY['projects','assets','tasks','phases','files','folders',
                           'comments','rate_cards','milestones']
  LOOP
    IF t = 'projects' THEN
      DELETE FROM public.projects p
       WHERE p.deleted_at < now() - p_retention
         AND NOT EXISTS (SELECT 1 FROM public.network_share_ops o
                           JOIN public.files f ON f.id = o.file_id
                          WHERE o.state = 'pending' AND (f.project_id = p.id OR o.project_id = p.id));
    ELSIF t = 'files' THEN
      DELETE FROM public.files f
       WHERE f.deleted_at < now() - p_retention
         AND NOT EXISTS (SELECT 1 FROM public.network_share_ops o
                          WHERE o.file_id = f.id AND o.state = 'pending');
    ELSIF t = 'folders' THEN
      -- 0131: a folder 30 days in the trash goes, with what went with it (its board and elements by their keys),
      -- once no file row is left anywhere below it; its files went in the step above, at the same moment. The top
      -- of each batch only: the folders below it go by their parent key.
      DELETE FROM public.folders fo
       WHERE fo.deleted_at < now() - p_retention
         AND NOT EXISTS (SELECT 1 FROM public.folders par
                          WHERE par.id = fo.parent_id AND par.deleted_at < now() - p_retention)
         AND NOT EXISTS (SELECT 1 FROM public.files f
                          WHERE f.folder_id = ANY (rabbit_private.folder_subtree(fo.id)));
    ELSE
      EXECUTE format(
        'DELETE FROM public.%I WHERE deleted_at < now() - $1', t)
        USING p_retention;
    END IF;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_total := v_total + v_count;
  END LOOP;
  RETURN v_total;
END;
$$;

-- §6 Post-conditions --------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public._moth_target_eligible(text,uuid,boolean)'::regprocedure) <> 'dfa3baaaf60ae20901b49fa75a65fef8'
     OR (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.moth_trash_index(integer,timestamptz)'::regprocedure) <> '40f9f709382f5107ffefed9040e0a53e'
     OR (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.purge_soft_deleted(interval)'::regprocedure) <> '32c0b15dd8b7ba53996084765aa59564' THEN
    RAISE EXCEPTION '0131 post-condition: a restated body is not this file''s';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
        ('trg_folders_trash_guard', 'trg_files_folder_trash_guard', 'trg_folders_soft_delete')) <> 3 THEN
    RAISE EXCEPTION '0131 post-condition: the three triggers are not all there';
  END IF;
  IF has_function_privilege('authenticated', 'rabbit_private.folder_subtree(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.moth_trash_folders(uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.moth_move_folders(uuid[],uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION '0131 post-condition: the functions'' grants are not as written';
  END IF;
END $$;
