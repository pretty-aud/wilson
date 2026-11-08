-- =============================================================================
-- 0125_workspace_notes.sql — M.O.T.H. Session 3 (MO3): notes a company can share, as Moth's workspace notes.
-- (docs/sessions/PLAN_MOTH.md §4 "Notes" and §5 Session 3; the brief §6.3; docs/design/MOTH_DESIGN.md §4.)
--
-- Workspace notes ARE the notes the Dashboard keeps (0017), not a second table: they already belong to a company
-- and to no project (PLAN_MOTH §8, measured). What they lacked was a way to share them, a trash and a place in
-- Moth's graph. One editor, one save path and one decoder (D.O.G.'s, noteText.js) stay as they are.
--
-- WHAT THIS CHANGES
-- -----------------
--   §1  notes.tier, O.T.T.E.R.'s three (0022): 'personal' (every note made before this file, and the default) is
--       its owner's alone, as 0017 made it: no admin reads it. 'shared' is every active member's to read, and its
--       owner's and the company's live admins' to change. 'company_standard' is a shared note the admins have made
--       the company's own; only a live admin sets or clears it. notes.deleted_at and deleted_by: the trash.
--   §2  fn_notes_guard: who and what a note is never changes (company, owner, maker); a version counts each change
--       of the body by one, whoever saves, so two people's saves cannot skip or forge one (save-and-merge stays
--       0017's: UPDATE ... WHERE version = the one opened, then merge and retry); the tier moves only as §1 says;
--       the trash's stamp moves only through §4's two functions, and a note in the trash is not changed.
--   §3  The four policies, restated from 0017's: a personal note exactly as before (the owner, no admin leg); a
--       shared or company note to every active member, and while in the trash only to its owner and live admins.
--       A client deletes no note any more: deleting is §4's trash, and the purge is the only hard delete.
--   §4  note_trash(note) and note_restore(note): the owner, or a live admin for a note that is not personal; one
--       refusal for every other case, missing included. purge_trashed_notes(retention) after 30 days, nightly at
--       04:57 ('wilson-purge-notes').
--   §5  Moth's gate learns a note (_moth_target_eligible from 0124's body, moth_can_write_target from 0122's): a
--       note of this company, not in the trash unless a definer asks for one, its owner's alone while personal
--       (no admin leg); changed by its owner, or by a live admin once it is not personal.
--   §6  moth_notes(): the notes Moth may draw for the caller, their titles and tiers, never a body.
--
-- Notes stay off every realtime topic and out of the company takeout (handbook §14), and out of edit_history
-- (0012's list). One transaction, re-runnable, no enum. Suite 21_notes.sql (extended); the gates' new kind in
-- 113_moth_read_path.sql and 124_moth_graph_reads.sql.
-- =============================================================================

SET LOCAL lock_timeout = '15s';

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
DECLARE
  v_md5 TEXT;
  v_fn  RECORD;
BEGIN
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public._moth_target_eligible(text,uuid,boolean)'::regprocedure)
       NOT IN ('18dba068d0f1925989c30dcb8a4a3e90', '6e73a0aec4791103d0b78e13c0f74a71') THEN
    RAISE EXCEPTION '0125 refused: 0124 must be applied first';
  END IF;
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0125 refused: % does not bypass row security', current_user;
  END IF;
  -- notes as 0017 made it: its columns, its forced row security and its four policies by name (§3 restates them).
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notes'
         AND column_name IN ('id', 'workspace_id', 'owner_id', 'title', 'ydoc_state', 'body_preview', 'version', 'created_by')) <> 8
     OR NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.notes'::regclass)
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notes') <> 4 THEN
    RAISE EXCEPTION '0125 refused: notes is not 0017''s';
  END IF;
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('public.moth_can_write_target(text,uuid)', 'f75ffd2db06f93a4e8d0cbef867a1e4f', 'af3ae61813da7bf7e4ba3506112046f9')
    ) AS t(sig, was, now_is)
  LOOP
    SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc WHERE oid = v_fn.sig::regprocedure;
    IF v_md5 IS DISTINCT FROM v_fn.was AND v_md5 IS DISTINCT FROM v_fn.now_is THEN
      RAISE EXCEPTION '0125 refused: % is not the body this file was built on (md5 %)', v_fn.sig, v_md5;
    END IF;
  END LOOP;
  -- A function of this file's name already here must be this file's own.
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('public.fn_notes_guard()', '2ef693b84fbca54e624c3554a87d8a83'),
      ('public.note_trash(uuid)', '73f57160d7fdf1390184bf6e6b6d24e6'),
      ('public.note_restore(uuid)', 'b292f9324d728bfe3e388de1cef98cc2'),
      ('public.purge_trashed_notes(interval)', 'e2d4cd20644d9db81ce32c9ff0998ff5'),
      ('public.moth_notes()', '5b7948799f9988d0f80dc7fd70694424')
    ) AS t(sig, now_is)
  LOOP
    IF to_regprocedure(v_fn.sig) IS NOT NULL
       AND (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure(v_fn.sig)) IS DISTINCT FROM v_fn.now_is THEN
      RAISE EXCEPTION '0125 refused: % is here and is not this file''s', v_fn.sig;
    END IF;
  END LOOP;
  -- 04:57 is free for the purge.
  IF to_regclass('cron.job') IS NOT NULL
     AND EXISTS (SELECT 1 FROM cron.job WHERE schedule = '57 4 * * *' AND jobname <> 'wilson-purge-notes') THEN
    RAISE EXCEPTION '0125 refused: 04:57 is taken by another job';
  END IF;
END $$;

-- §1 The tier and the trash ------------------------------------------------------------
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'personal';
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS deleted_by UUID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.notes'::regclass AND conname = 'notes_tier_chk') THEN
    ALTER TABLE public.notes ADD CONSTRAINT notes_tier_chk CHECK (tier IN ('personal', 'shared', 'company_standard'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.notes'::regclass AND conname = 'notes_trash_chk') THEN
    ALTER TABLE public.notes ADD CONSTRAINT notes_trash_chk CHECK ((deleted_at IS NULL) = (deleted_by IS NULL));
  END IF;
END $$;
-- The shared notes, newest first, and the trash's purge.
CREATE INDEX IF NOT EXISTS notes_shared_idx ON public.notes (workspace_id, updated_at DESC) WHERE tier <> 'personal' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS notes_trash_idx ON public.notes (deleted_at) WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN public.notes.tier IS
  '0125 (MO3): personal (the owner''s alone, no admin bypass, 0017), shared (every active member reads; the owner and live admins change it) or company_standard (as shared; only a live admin sets or clears it). Moves only as fn_notes_guard allows.';
COMMENT ON COLUMN public.notes.deleted_at IS
  '0125 (MO3): in the trash since; set and cleared only by note_trash and note_restore; purged after 30 days by purge_trashed_notes.';

-- §2 The guard --------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_notes_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_me UUID := auth.uid();
BEGIN
  IF COALESCE(current_setting('role', true), '') = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- A note starts out of the trash, at version 0, made by whoever makes it.
    NEW.deleted_at := NULL;
    NEW.deleted_by := NULL;
    NEW.version    := 0;
    IF v_me IS NOT NULL THEN
      NEW.created_by := v_me;
    END IF;
    IF NEW.tier = 'company_standard' AND NOT public.is_live_workspace_admin(NEW.workspace_id) THEN
      RAISE EXCEPTION 'Only a workspace admin makes a note the company standard.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- Whose and which company's a note is never changes, and a try is refused in words, never undone in silence (an
  -- admin may change a shared note, and must not give it to someone else).
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'A note''s company and owner never change.' USING ERRCODE = '42501';
  END IF;
  NEW.created_at   := OLD.created_at;
  NEW.created_by   := OLD.created_by;

  IF COALESCE(current_setting('wilson.note_trash', true), '') = OLD.id::text THEN
    -- note_trash and note_restore: the trash's stamp moves, and nothing else.
    NEW.title        := OLD.title;
    NEW.subject      := OLD.subject;
    NEW.note_date    := OLD.note_date;
    NEW.ydoc_state   := OLD.ydoc_state;
    NEW.body_preview := OLD.body_preview;
    NEW.version      := OLD.version;
    NEW.tier         := OLD.tier;
    RETURN NEW;
  END IF;
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by THEN
    RAISE EXCEPTION 'A note goes to the trash and comes back from it through the trash.' USING ERRCODE = '42501';
  END IF;
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'A note in the trash is brought back before it is changed.' USING ERRCODE = '42501';
  END IF;

  -- One version more for each change of the body, whoever saves it; a change of anything else keeps it.
  NEW.version := CASE WHEN NEW.ydoc_state IS DISTINCT FROM OLD.ydoc_state THEN OLD.version + 1 ELSE OLD.version END;

  IF NEW.tier IS DISTINCT FROM OLD.tier THEN
    IF 'company_standard' IN (NEW.tier, OLD.tier) THEN
      IF NOT public.is_live_workspace_admin(OLD.workspace_id) THEN
        RAISE EXCEPTION 'Only a workspace admin makes a note the company standard, or takes it back.' USING ERRCODE = '42501';
      END IF;
    ELSIF OLD.owner_id IS DISTINCT FROM v_me THEN
      RAISE EXCEPTION 'Only its owner shares a note, or makes it private again.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_notes_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notes_guard ON public.notes;
CREATE TRIGGER trg_notes_guard BEFORE INSERT OR UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.fn_notes_guard();

-- §3 The policies, restated from 0017's -------------------------------------------------------
DROP POLICY IF EXISTS notes_select ON public.notes;
DROP POLICY IF EXISTS notes_insert ON public.notes;
DROP POLICY IF EXISTS notes_update ON public.notes;
DROP POLICY IF EXISTS notes_delete ON public.notes;

-- A personal note is its owner's alone, as 0017 made it (no admin leg, and the owner reads it even after leaving).
-- A shared or company note is every active member's to read, and in the trash only its owner's and live admins'.
CREATE POLICY notes_select ON public.notes
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND (owner_id = auth.uid()
         OR (tier <> 'personal'
             AND public.has_active_membership(workspace_id)
             AND (deleted_at IS NULL OR public.is_live_workspace_admin(workspace_id))))
  );

CREATE POLICY notes_insert ON public.notes
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND owner_id = auth.uid()
  );

-- The owner changes their own; a live admin changes a note that is not personal. WITH CHECK asks the same of the
-- new row, so an admin cannot make someone else's note personal (and so their own).
CREATE POLICY notes_update ON public.notes
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (owner_id = auth.uid() OR (tier <> 'personal' AND public.is_live_workspace_admin(workspace_id)))
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (owner_id = auth.uid() OR (tier <> 'personal' AND public.is_live_workspace_admin(workspace_id)))
  );

-- No DELETE policy, and no DELETE grant: a note goes to the trash (§4), and only the purge removes one.
REVOKE DELETE ON public.notes FROM authenticated;

COMMENT ON TABLE public.notes IS
  'Session 8, 0017: rich-text notes (TipTap + Yjs). ydoc_state is a base64 Yjs snapshot; version counts each change of it (0125: by the server). 0125 (MO3): Moth''s workspace notes, by tier (personal, shared, company_standard), with a 30-day trash. On no realtime topic, in no takeout, not in edit_history.';

-- §4 The trash --------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.note_trash(p_note uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws    UUID := public.current_workspace_id();
  v_owner UUID;
  v_tier  TEXT;
  v_gone  TIMESTAMPTZ;
BEGIN
  SELECT n.owner_id, n.tier, n.deleted_at INTO v_owner, v_tier, v_gone
    FROM public.notes n
   WHERE n.id = p_note AND n.workspace_id = v_ws;
  -- One refusal for every case: not there, another company's, someone else's personal note, or no right to it.
  IF v_owner IS NULL OR auth.uid() IS NULL OR NOT public.has_active_membership(v_ws)
     OR NOT (v_owner = auth.uid() OR (v_tier <> 'personal' AND public.is_live_workspace_admin(v_ws))) THEN
    RAISE EXCEPTION 'That note is not one you can put in the trash.' USING ERRCODE = '42501';
  END IF;
  IF v_gone IS NOT NULL THEN
    RETURN false;
  END IF;
  PERFORM set_config('wilson.note_trash', p_note::text, true);
  UPDATE public.notes SET deleted_at = now(), deleted_by = auth.uid() WHERE id = p_note;
  PERFORM set_config('wilson.note_trash', '', true);
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.note_trash(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.note_trash(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.note_restore(p_note uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws    UUID := public.current_workspace_id();
  v_owner UUID;
  v_tier  TEXT;
  v_gone  TIMESTAMPTZ;
BEGIN
  SELECT n.owner_id, n.tier, n.deleted_at INTO v_owner, v_tier, v_gone
    FROM public.notes n
   WHERE n.id = p_note AND n.workspace_id = v_ws;
  IF v_owner IS NULL OR auth.uid() IS NULL OR NOT public.has_active_membership(v_ws)
     OR NOT (v_owner = auth.uid() OR (v_tier <> 'personal' AND public.is_live_workspace_admin(v_ws))) THEN
    RAISE EXCEPTION 'That note is not one you can bring back.' USING ERRCODE = '42501';
  END IF;
  IF v_gone IS NULL THEN
    RETURN false;
  END IF;
  PERFORM set_config('wilson.note_trash', p_note::text, true);
  UPDATE public.notes SET deleted_at = NULL, deleted_by = NULL WHERE id = p_note;
  PERFORM set_config('wilson.note_trash', '', true);
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.note_restore(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.note_restore(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.purge_trashed_notes(p_retention interval DEFAULT interval '30 days')
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n BIGINT;
BEGIN
  IF p_retention IS NULL OR p_retention < interval '1 day' THEN
    RAISE EXCEPTION 'A note stays in the trash a day at least.' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.notes WHERE deleted_at IS NOT NULL AND deleted_at < now() - p_retention;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.purge_trashed_notes(interval) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_trashed_notes(interval) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('wilson-purge-notes', '57 4 * * *', $cron$SELECT public.purge_trashed_notes();$cron$);
  ELSE
    RAISE NOTICE '0125: pg_cron is not here; wilson-purge-notes is not scheduled';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '0125: could not schedule wilson-purge-notes: %', SQLERRM;
END $$;

-- §5 Moth's gate learns a note -----------------------------------------------------------------
-- Restated from 0124's body (the gate) and 0122's (the write gate). Only the note arms are new.
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
  ELSIF p_kind = 'note' THEN
    -- 0125: a workspace note is the company's, not a project's. Its owner's alone while personal (no admin leg),
    -- every active member's once shared, and none in the trash unless a definer asks for one.
    SELECT n.tier, n.owner_id, n.deleted_at INTO v_tier, v_owner, v_deleted
      FROM public.notes n
     WHERE n.id = p_id AND n.workspace_id = v_ws;
    RETURN v_tier IS NOT NULL
       AND (v_deleted IS NULL OR COALESCE(p_allow_trashed, false))
       AND (v_tier <> 'personal' OR v_owner = auth.uid());
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
  -- 0125: a note is changed by its owner, or by a live admin once it is not personal.
  IF p_kind = 'note' THEN
    RETURN EXISTS (SELECT 1 FROM public.notes n
                    WHERE n.id = p_id
                      AND (n.owner_id = auth.uid()
                           OR (n.tier <> 'personal' AND public.is_live_workspace_admin(n.workspace_id))));
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

-- §6 Moth's notes ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.moth_notes()
RETURNS TABLE (id uuid, title text, tier text, is_mine boolean, updated_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- The caller's own row security first (a personal note is its owner's alone), newest first and bounded, then
  -- Moth's gate on each, after the fence (MO1's trap: a gate inside an ORDER BY ... LIMIT runs over every row).
  RETURN QUERY
  SELECT n.id, left(n.title, 300), n.tier, n.owner_id = auth.uid(), n.updated_at
    FROM (SELECT x.id, x.title, x.tier, x.owner_id, x.updated_at
            FROM public.notes x
           WHERE x.deleted_at IS NULL AND x.workspace_id = public.current_workspace_id()
           ORDER BY x.updated_at DESC, x.id
           LIMIT 5000 OFFSET 0) n
   WHERE public.moth_can_read_target('note', n.id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_notes() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_notes() TO authenticated;

-- §7 Post-conditions ---------------------------------------------------------------
DO $$
DECLARE
  v_fn RECORD;
BEGIN
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('public.fn_notes_guard()', '2ef693b84fbca54e624c3554a87d8a83', false, '{search_path=public}'),
      ('public.note_trash(uuid)', '73f57160d7fdf1390184bf6e6b6d24e6', true, '{search_path=public}'),
      ('public.note_restore(uuid)', 'b292f9324d728bfe3e388de1cef98cc2', true, '{search_path=public}'),
      ('public.purge_trashed_notes(interval)', 'e2d4cd20644d9db81ce32c9ff0998ff5', true, '{search_path=public}'),
      ('public.moth_notes()', '5b7948799f9988d0f80dc7fd70694424', false, '{search_path=public}'),
      ('public._moth_target_eligible(text,uuid,boolean)', '6e73a0aec4791103d0b78e13c0f74a71', true, '{search_path=public}'),
      ('public.moth_can_write_target(text,uuid)', 'af3ae61813da7bf7e4ba3506112046f9', true, '{search_path=public}')
    ) AS t(sig, now_is, definer, cfg)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_fn.sig::regprocedure
                      AND md5(replace(prosrc, chr(13), '')) = v_fn.now_is
                      AND prosecdef = v_fn.definer AND proconfig::text = v_fn.cfg) THEN
      RAISE EXCEPTION '0125 post-condition: % is not this file''s, or runs as the wrong role or path', v_fn.sig;
    END IF;
  END LOOP;

  -- Who may call what.
  FOR v_fn IN SELECT * FROM (VALUES
      ('public.fn_notes_guard()', false),
      ('public.note_trash(uuid)', true),
      ('public.note_restore(uuid)', true),
      ('public.purge_trashed_notes(interval)', false),
      ('public.moth_notes()', true),
      ('public._moth_target_eligible(text,uuid,boolean)', false),
      ('public.moth_can_write_target(text,uuid)', true)
    ) AS t(sig, open)
  LOOP
    IF has_function_privilege('anon', v_fn.sig::regprocedure, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn.sig::regprocedure, 'EXECUTE') IS DISTINCT FROM v_fn.open THEN
      RAISE EXCEPTION '0125 post-condition: % has the wrong grants', v_fn.sig;
    END IF;
  END LOOP;

  -- The table: forced row security, three policies and no DELETE for a client; the guard before every write.
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.notes'::regclass)
     OR (SELECT string_agg(policyname || ':' || cmd, ',' ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notes')
        IS DISTINCT FROM 'notes_insert:INSERT,notes_select:SELECT,notes_update:UPDATE'
     OR has_table_privilege('authenticated', 'public.notes', 'DELETE')
     OR has_table_privilege('anon', 'public.notes', 'SELECT')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.notes'::regclass AND tgname = 'trg_notes_guard'
                       AND tgfoid = 'public.fn_notes_guard()'::regprocedure AND tgenabled = 'O' AND tgtype = 23 AND tgattr = ''::int2vector AND tgqual IS NULL) THEN
    RAISE EXCEPTION '0125 post-condition: notes'' row security, grants or guard are not this file''s';
  END IF;
  -- The personal arm of the read has no admin leg and no membership term (0017's, exactly).
  IF position('owner_id = auth.uid()' IN (SELECT qual FROM pg_policies WHERE tablename = 'notes' AND policyname = 'notes_select')) = 0
     OR position('''personal''' IN (SELECT qual FROM pg_policies WHERE tablename = 'notes' AND policyname = 'notes_select')) = 0 THEN
    RAISE EXCEPTION '0125 post-condition: notes_select is not this file''s';
  END IF;
  -- Off every realtime topic: no broadcast trigger on notes.
  IF EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
              WHERE t.tgrelid = 'public.notes'::regclass AND p.proname LIKE '%broadcast%') THEN
    RAISE EXCEPTION '0125 post-condition: notes is on a realtime topic';
  END IF;
  -- Every note made before this file is personal.
  IF EXISTS (SELECT 1 FROM public.notes WHERE tier IS NULL) THEN
    RAISE EXCEPTION '0125 post-condition: a note has no tier';
  END IF;

  RAISE NOTICE '0125 OK';
END $$;
