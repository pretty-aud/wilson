-- =============================================================================
-- 0111_moth_read_path.sql — M.O.T.H. Session 1 (MO1), Moth's read path and the
-- one money and Legal classifier (docs/design/MOTH_DESIGN.md §1.4 "0111", §1.6,
-- and §2.2 MR-1 to MR-5, SEC-9, SEC-10, PSA-14).
--
-- WHAT IS NEW
-- -----------
-- RLS cannot tell Moth from the Files page: an admin keeps RLS's reach over
-- money, Legal and everyone's personal spaces for Files. So Moth reads only
-- through three SECURITY INVOKER functions, which can only narrow what RLS
-- already lets the caller read, and each filters by one gate.
--
--   * Money and Legal are hidden from every role, admins included, by the
--     classifiers (never by the access gates, which admit an admin).
--   * Another person's personal space is hidden from every role, admins
--     included. An admin reaches it from Files only (0110, WIL-4114).
--   * A hidden row and a missing row answer the same: false, or no rows.
--   * Nothing counts anything: no column here tells a caller how many rows it
--     did not get.
--
-- WHAT THIS FILE DOES
-- -------------------
--   §1  expenses_file_ids_gin: the receipt arm's lookup.
--   §2  moth_folder_path_locked(text), and fn_folders_lock_guard with
--       trg_folders_lock_guard: a client write never changes a folder's money
--       or Legal standing, never detaches a folder's first path segment from its
--       parent's, and never deletes a money or Legal folder or a project's root,
--       so the standing the walk below reads can be trusted.
--   §3  moth_folder_chain_locked and moth_file_row_locked: the one classifier
--       (0119's history capture calls the second, so history's redaction and
--       Moth's live gate cannot drift).
--   §4  _moth_target_eligible, moth_can_read_target, moth_can_write_target.
--   §5  moth_islands, moth_project_folders, moth_project_files.
--   §6  COMMENTs; §7 post-conditions.
--
-- One transaction, no enum. Re-runnable (the drift count runs each time). After
-- 0110: it reads personal_owner_id. Suite 113_moth_read_path.sql.
-- =============================================================================

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
DECLARE
  v_drift BIGINT;
BEGIN
  IF to_regprocedure('public.ensure_personal_space()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'projects'
                       AND column_name = 'personal_owner_id') THEN
    RAISE EXCEPTION '0111 refused: 0110 must be applied first (the read path''s personal arm reads personal_owner_id)';
  END IF;
  IF to_regprocedure('public.file_row_is_money(boolean,text)') IS NULL
     OR to_regprocedure('public.rabbit_money_segment(text)') IS NULL
     OR to_regprocedure('public.passes_project_privacy(uuid)') IS NULL
     OR to_regprocedure('public.can_write_project(uuid)') IS NULL
     OR to_regprocedure('public.project_role_for(uuid)') IS NULL
     OR to_regprocedure('public.project_is_staffed(uuid)') IS NULL
     OR to_regprocedure('public.has_active_membership(uuid)') IS NULL
     OR to_regprocedure('public.current_workspace_id()') IS NULL
     OR to_regclass('public.expenses') IS NULL
     OR to_regclass('public.folders') IS NULL THEN
    RAISE EXCEPTION '0111 refused: a classifier, a gate, expenses or folders is missing';
  END IF;
  -- The definers below read rows RLS refuses to clients (0069's lesson).
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0111 refused: % does not bypass row security, so the read path''s definers would read nothing', current_user;
  END IF;
  -- Existing drift: a folder whose first path segment differs from its
  -- parent's would make the guard below refuse an honest write and the walk
  -- read the wrong standing. Stop rather than guess which side is right. The
  -- lock holds until this file commits, so the count stays true for the guard.
  LOCK TABLE public.folders IN SHARE ROW EXCLUSIVE MODE;
  SELECT count(*) INTO v_drift
    FROM public.folders f
    JOIN public.folders par ON par.id = f.parent_id
   WHERE par.kind <> 'root'
     AND split_part(f.path, '/', 1) IS DISTINCT FROM split_part(par.path, '/', 1);
  IF v_drift > 0 THEN
    RAISE EXCEPTION '0111 refused: % folder(s) have a first path segment that differs from their parent''s; repair them first', v_drift;
  END IF;
END $$;

-- §1 The receipt arm's lookup -----------------------------------------------------
CREATE INDEX IF NOT EXISTS expenses_file_ids_gin ON public.expenses USING gin (file_ids);

-- §2 A folder's standing ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.moth_folder_path_locked(p_path text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT public.rabbit_money_segment(split_part(COALESCE(p_path, ''), '/', 1));
$$;
REVOKE EXECUTE ON FUNCTION public.moth_folder_path_locked(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_folder_path_locked(text) TO authenticated, service_role;

-- INVOKER on purpose. A BEFORE trigger runs ahead of RLS, so a definer would
-- answer "wrong first segment" about a parent the caller cannot see: an oracle
-- over a hidden folder's path. As the caller, a hidden parent reads as no row,
-- and the same-project guard, RLS and the foreign key answer as they would for
-- a random uuid.
CREATE OR REPLACE FUNCTION public.fn_folders_lock_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_new_parent_kind TEXT;
  v_new_parent_path TEXT;
  v_old_parent_kind TEXT;
  v_was_locked      BOOLEAN;
  v_is_locked       BOOLEAN;
  v_bound           BOOLEAN := COALESCE(current_setting('role', true), '') IN ('authenticated', 'anon');
BEGIN
  -- A delete would undo the walk for every file filed there (their folder_id goes
  -- NULL). A project's root is refused with them: its delete cascades to them. A
  -- cascade itself has been judged where it began, or is a project's own delete.
  IF TG_OP = 'DELETE' THEN
    IF v_bound AND pg_trigger_depth() = 1 THEN
      SELECT par.kind INTO v_old_parent_kind
        FROM public.folders par WHERE par.id = OLD.parent_id;
      IF OLD.kind = 'root'
         OR public.moth_folder_path_locked(OLD.path)
         OR (COALESCE(v_old_parent_kind = 'root', false) AND public.rabbit_money_segment(OLD.slug)) THEN
        RAISE EXCEPTION 'A money or Legal folder, or a project''s top folder, cannot be deleted.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  -- Client callers only: migrations, cron and service_role pass (I-2).
  IF NOT v_bound THEN
    RETURN NEW;
  END IF;

  SELECT par.kind, par.path INTO v_new_parent_kind, v_new_parent_path
    FROM public.folders par WHERE par.id = NEW.parent_id;

  IF TG_OP = 'UPDATE' THEN
    SELECT par.kind INTO v_old_parent_kind
      FROM public.folders par WHERE par.id = OLD.parent_id;
    -- The same two arms the walk reads: a money first path segment, or a
    -- money slug on a top-level folder (a renamed category whose slug still
    -- says so). A slug deeper down is a working folder's name: it stays free.
    v_was_locked := public.moth_folder_path_locked(OLD.path)
      OR (COALESCE(v_old_parent_kind = 'root', false) AND public.rabbit_money_segment(OLD.slug));
    v_is_locked := public.moth_folder_path_locked(NEW.path)
      OR (COALESCE(v_new_parent_kind = 'root', false) AND public.rabbit_money_segment(NEW.slug));
    IF v_was_locked IS DISTINCT FROM v_is_locked THEN
      RAISE EXCEPTION 'A folder''s standing as a money or Legal folder cannot be changed.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- A top-level folder has the root for its parent, whose path is empty. Only
  -- a write that moves the row is judged, so a slug or label edit on a child
  -- of a folder part-way through a rename still lands.
  IF (TG_OP = 'INSERT'
      OR NEW.path IS DISTINCT FROM OLD.path
      OR NEW.parent_id IS DISTINCT FROM OLD.parent_id)
     AND v_new_parent_kind IS NOT NULL
     AND v_new_parent_kind <> 'root'
     AND split_part(NEW.path, '/', 1) IS DISTINCT FROM split_part(v_new_parent_path, '/', 1) THEN
    RAISE EXCEPTION 'A folder stays under its parent''s top-level folder.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_folders_lock_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER trg_folders_lock_guard
  BEFORE INSERT OR DELETE OR UPDATE OF path, slug, parent_id ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.fn_folders_lock_guard();

-- §3 The one classifier -------------------------------------------------------------
-- Up the chain from a folder. A chain the walk cannot finish (deeper than 64,
-- or a loop) answers locked: a walk that ran out proves nothing. This and the
-- two below run once per row of a list, so they are plpgsql, which keeps its
-- plans: a SQL-language function here is parsed and planned afresh on each call
-- (measured: a page of 500 files took 3.4 s that way on dev).
CREATE OR REPLACE FUNCTION public.moth_folder_chain_locked(p_workspace uuid, p_folder uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_folder IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    WITH RECURSIVE up (id, parent_id, kind, slug, path, depth) AS (
      SELECT fo.id, fo.parent_id, fo.kind, fo.slug, fo.path, 1
        FROM public.folders fo
       WHERE fo.id = p_folder AND fo.workspace_id = p_workspace
      UNION ALL
      SELECT par.id, par.parent_id, par.kind, par.slug, par.path, up.depth + 1
        FROM up
        JOIN public.folders par ON par.id = up.parent_id
       WHERE up.depth < 64
    )
    SELECT 1 FROM up n
     WHERE n.kind <> 'root'
       AND (public.rabbit_money_segment(split_part(n.path, '/', 1))
            OR n.depth = 64
            OR (public.rabbit_money_segment(n.slug)
                AND EXISTS (SELECT 1 FROM up r WHERE r.id = n.parent_id AND r.kind = 'root')))
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_folder_chain_locked(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- A row image: every arm reads its arguments and never the live files row, so
-- history's capture (0119) classifies OLD and NEW alike, a deleted row's included
-- (an AFTER DELETE trigger can no longer read the row; review round 1). The receipt
-- arm is scoped to the row's own project: an expense in project B that names
-- project A's file does not hide it from A (SEC-3).
CREATE OR REPLACE FUNCTION public.moth_file_row_locked(
  p_workspace uuid, p_project uuid, p_file uuid, p_flag boolean, p_path text, p_tags text[], p_folder uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.file_row_is_money(p_flag, p_path)
      OR COALESCE('legal' = ANY (p_tags), false)
      OR public.moth_folder_chain_locked(p_workspace, p_folder)
      OR EXISTS (
           SELECT 1
             FROM public.expenses e
            WHERE e.workspace_id = p_workspace
              AND e.project_id = p_project
              AND e.file_ids @> ARRAY[p_file]
         );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_file_row_locked(uuid, uuid, uuid, boolean, text, text[], uuid) FROM PUBLIC, anon, authenticated;

-- §4 The gates ------------------------------------------------------------------------
-- Kind only picks the table; the decision comes from the row found. Definers
-- call this directly (0118's trash index passes p_allow_trashed true); clients
-- reach it through moth_can_read_target. A trashed PROJECT stays closed whatever
-- p_allow_trashed says: its files are not offered back one by one.
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
       AND (p.personal_owner_id IS NULL OR p.personal_owner_id = auth.uid())
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public._moth_target_eligible(text, uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.moth_can_read_target(p_kind text, p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public._moth_target_eligible(p_kind, p_id, false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_can_read_target(text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_can_read_target(text, uuid) TO authenticated;

-- No second write rule: with 0110's personal arm, can_write_project already
-- means owner-only on a personal row and the usual rule elsewhere.
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
    WHEN 'project' THEN p_id
    WHEN 'folder'  THEN (SELECT fo.project_id FROM public.folders fo WHERE fo.id = p_id)
    WHEN 'file'    THEN (SELECT f.project_id FROM public.files f WHERE f.id = p_id)
  END;
  RETURN COALESCE(public.can_write_project(v_project), false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_can_write_target(text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_can_write_target(text, uuid) TO authenticated;

-- §5 The three reads ------------------------------------------------------------------
-- INVOKER: RLS runs as the caller and its quals run first (they are security
-- barriers), so these can only narrow. The seat inputs come from the server, so
-- a client never supplies its own role. No is_financial, no created_by, no
-- count. Enums come back as text: the provider vocabulary widens in 0112 and
-- nothing here should care.
CREATE OR REPLACE FUNCTION public.moth_islands()
RETURNS TABLE (
  id uuid, title text, is_personal boolean, is_mine boolean, is_private boolean,
  my_project_role text, is_staffed boolean, can_write boolean, updated_at timestamptz)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT p.id,
         p.title,
         p.personal_owner_id IS NOT NULL,
         COALESCE(p.personal_owner_id = auth.uid(), false),
         p.is_private,
         public.project_role_for(p.id),
         public.project_is_staffed(p.id),
         COALESCE(public.can_write_project(p.id), false),
         p.updated_at
    FROM public.projects p
   WHERE public.moth_can_read_target('project', p.id)
   ORDER BY COALESCE(p.personal_owner_id = auth.uid(), false) DESC, p.title, p.id;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_islands() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_islands() TO authenticated;

CREATE OR REPLACE FUNCTION public.moth_project_folders(p_project uuid)
RETURNS TABLE (
  id uuid, parent_id uuid, kind text, entity_type text, slug text, label text,
  path text, sort_order integer, updated_at timestamptz)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT fo.id,
         CASE WHEN EXISTS (SELECT 1 FROM public.folders par
                            WHERE par.id = fo.parent_id AND par.project_id = fo.project_id)
              THEN fo.parent_id END,
         fo.kind,
         fo.entity_type,
         fo.slug,
         fo.label,
         fo.path,
         fo.sort_order,
         fo.updated_at
    FROM public.folders fo
   WHERE fo.project_id = p_project
     AND public.moth_can_read_target('folder', fo.id)
   ORDER BY fo.path, fo.id;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_project_folders(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_project_folders(uuid) TO authenticated;

-- A keyset on id, clamped to 1..1000. folder_id comes back only when it names a
-- folder of this very project, in the positive form (SEC-9): a `<>` test would
-- pass an id whose row the caller cannot see, and hand a hidden folder's id out.
CREATE OR REPLACE FUNCTION public.moth_project_files(p_project uuid, p_after uuid DEFAULT NULL, p_limit integer DEFAULT 500)
RETURNS TABLE (
  id uuid, project_id uuid, folder_id uuid, name text, mime_type text, size_bytes bigint,
  kind text, document_kind text, description text, tags text[], storage_provider text,
  storage_path text, thumbnail_url text, duration_sec numeric, source_modified_at timestamptz,
  uploaded_at timestamptz, updated_at timestamptz)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT f.id,
         f.project_id,
         CASE WHEN EXISTS (SELECT 1 FROM public.folders fo
                            WHERE fo.id = f.folder_id AND fo.project_id = f.project_id)
              THEN f.folder_id END,
         f.name,
         f.mime_type,
         f.size_bytes,
         f.kind::text,
         f.document_kind::text,
         f.description,
         f.tags,
         f.storage_provider::text,
         f.storage_path,
         f.thumbnail_url,
         f.duration_sec,
         f.source_modified_at,
         f.uploaded_at,
         f.updated_at
    FROM (
      -- The candidates in id order, and the gate only after them. The fence
      -- (OFFSET 0) keeps the planner from running the gate over every row of the
      -- project before its sort, which made a page of 500 cost a whole project:
      -- measured on dev, 3.7 s for 3,000 files.
      SELECT c.*
        FROM public.files c
       WHERE c.project_id = p_project
         AND (p_after IS NULL OR c.id > p_after)
       ORDER BY c.id
      OFFSET 0
    ) f
   WHERE public.moth_can_read_target('file', f.id)
   ORDER BY f.id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000);
$$;
REVOKE EXECUTE ON FUNCTION public.moth_project_files(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_project_files(uuid, uuid, integer) TO authenticated;

-- §6 COMMENTs ---------------------------------------------------------------------------
COMMENT ON FUNCTION public.moth_folder_path_locked(text) IS
  'True when a folder path''s first segment is a money or Legal one. Pure.';
COMMENT ON FUNCTION public.fn_folders_lock_guard() IS
  'A client write never changes a folder''s money or Legal standing, never detaches its first path segment from its parent''s, and never deletes a money or Legal folder or a project''s root. INVOKER: a parent the caller cannot see reads as no row. Unbound sessions and cascades pass.';
COMMENT ON FUNCTION public.moth_folder_chain_locked(uuid, uuid) IS
  'True when any folder up the chain has a money first path segment, a top-level one has a money slug, or the chain cannot be walked to its end within 64 steps. Revoked from clients.';
COMMENT ON FUNCTION public.moth_file_row_locked(uuid, uuid, uuid, boolean, text, text[], uuid) IS
  'The one classifier for a file row image: the money flag or key, the legal tag, the folder chain, or an expense of the file''s own project naming it. Revoked from clients; 0119''s capture and _moth_target_eligible both call it.';
COMMENT ON FUNCTION public._moth_target_eligible(text, uuid, boolean) IS
  'Whether the caller may see this project, folder or file in Moth. Any other kind, a NULL id, or no signed-in active member: false. Missing and hidden answer alike. The personal arm has no admin leg. Revoked from clients.';
COMMENT ON FUNCTION public.moth_can_read_target(text, uuid) IS
  'Moth''s read gate for a client: _moth_target_eligible with no trashed rows.';
COMMENT ON FUNCTION public.moth_can_write_target(text, uuid) IS
  'Moth''s write gate: the read gate and can_write_project on the row''s project.';
COMMENT ON FUNCTION public.moth_islands() IS
  'The projects the caller may see in Moth, with the seat facts the client''s gates need. Never another person''s personal space, admins included. No counts.';
COMMENT ON FUNCTION public.moth_project_folders(uuid) IS
  'A project''s folders the caller may see in Moth. A hidden or missing project gives no rows, never an error.';
COMMENT ON FUNCTION public.moth_project_files(uuid, uuid, integer) IS
  'A page of a project''s files the caller may see in Moth, keyed on id. A hidden or missing project gives no rows, never an error. No money, no Legal, no totals.';

-- §7 Post-conditions --------------------------------------------------------------------
DO $$
DECLARE
  v_body   TEXT;
  v_fn     RECORD;
BEGIN
  -- The classifier's arms, on comment-stripped bodies.
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_body
    FROM pg_proc WHERE oid = 'public.moth_folder_chain_locked(uuid,uuid)'::regprocedure;
  IF position('rabbit_money_segment(split_part(n.path' IN v_body) = 0
     OR position('rabbit_money_segment(n.slug)' IN v_body) = 0
     OR position('n.depth = 64' IN v_body) = 0 THEN
    RAISE EXCEPTION '0111 post-condition: moth_folder_chain_locked lost an arm';
  END IF;
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_body
    FROM pg_proc WHERE oid = 'public.moth_file_row_locked(uuid,uuid,uuid,boolean,text,text[],uuid)'::regprocedure;
  IF position('file_row_is_money' IN v_body) = 0
     OR position('''legal''' IN v_body) = 0
     OR position('moth_folder_chain_locked' IN v_body) = 0
     OR position('e.project_id = p_project' IN v_body) = 0
     OR position('public.files' IN v_body) > 0 THEN
    RAISE EXCEPTION '0111 post-condition: moth_file_row_locked lost an arm, or reads the live row';
  END IF;

  -- The gate: both classifiers, privacy, and a personal arm with no admin leg.
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_body
    FROM pg_proc WHERE oid = 'public._moth_target_eligible(text,uuid,boolean)'::regprocedure;
  IF position('moth_file_row_locked' IN v_body) = 0
     OR position('moth_folder_chain_locked' IN v_body) = 0
     OR position('passes_project_privacy' IN v_body) = 0
     OR position('p.personal_owner_id = auth.uid()' IN v_body) = 0
     OR position('current_app_role' IN v_body) > 0
     OR position('can_access_project_money' IN v_body) > 0 THEN
    RAISE EXCEPTION '0111 post-condition: _moth_target_eligible is not the design''s (a classifier, privacy or the personal arm is missing, or an access gate crept in)';
  END IF;
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_body
    FROM pg_proc WHERE oid = 'public.moth_can_write_target(text,uuid)'::regprocedure;
  IF position('can_write_project' IN v_body) = 0 OR position('_moth_target_eligible' IN v_body) = 0 THEN
    RAISE EXCEPTION '0111 post-condition: moth_can_write_target must be the read gate and can_write_project';
  END IF;

  -- The folder_id positive form, not a `<>`.
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_body
    FROM pg_proc WHERE oid = 'public.moth_project_files(uuid,uuid,integer)'::regprocedure;
  IF position('fo.id = f.folder_id AND fo.project_id = f.project_id' IN v_body) = 0
     OR position('moth_can_read_target(''file''' IN v_body) = 0
     OR position('LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000)' IN v_body) = 0
     OR position('OFFSET 0' IN v_body) = 0 THEN
    RAISE EXCEPTION '0111 post-condition: moth_project_files lost its gate, its clamp, its fence or the positive folder form';
  END IF;
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_body
    FROM pg_proc WHERE oid = 'public.moth_project_folders(uuid)'::regprocedure;
  IF position('moth_can_read_target(''folder''' IN v_body) = 0 THEN
    RAISE EXCEPTION '0111 post-condition: moth_project_folders lost its gate';
  END IF;
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v_body
    FROM pg_proc WHERE oid = 'public.moth_islands()'::regprocedure;
  IF position('moth_can_read_target(''project''' IN v_body) = 0 THEN
    RAISE EXCEPTION '0111 post-condition: moth_islands lost its gate';
  END IF;

  -- The three reads: INVOKER, and these exact columns (no is_financial, no
  -- created_by, no count).
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('public.moth_islands()',
       'TABLE(id uuid, title text, is_personal boolean, is_mine boolean, is_private boolean, my_project_role text, is_staffed boolean, can_write boolean, updated_at timestamp with time zone)'),
      ('public.moth_project_folders(uuid)',
       'TABLE(id uuid, parent_id uuid, kind text, entity_type text, slug text, label text, path text, sort_order integer, updated_at timestamp with time zone)'),
      ('public.moth_project_files(uuid,uuid,integer)',
       'TABLE(id uuid, project_id uuid, folder_id uuid, name text, mime_type text, size_bytes bigint, kind text, document_kind text, description text, tags text[], storage_provider text, storage_path text, thumbnail_url text, duration_sec numeric, source_modified_at timestamp with time zone, uploaded_at timestamp with time zone, updated_at timestamp with time zone)')
    ) AS t(sig, res)
  LOOP
    IF (SELECT prosecdef FROM pg_proc WHERE oid = v_fn.sig::regprocedure) THEN
      RAISE EXCEPTION '0111 post-condition: % must be SECURITY INVOKER', v_fn.sig;
    END IF;
    IF pg_get_function_result(v_fn.sig::regprocedure) IS DISTINCT FROM v_fn.res THEN
      RAISE EXCEPTION '0111 post-condition: % returns %, not the pinned columns', v_fn.sig, pg_get_function_result(v_fn.sig::regprocedure);
    END IF;
    IF has_function_privilege('anon', v_fn.sig::regprocedure, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_fn.sig::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '0111 post-condition: % must be executable by authenticated only', v_fn.sig;
    END IF;
  END LOOP;

  -- The definers: search_path pinned; the inner three closed to clients.
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('public.moth_folder_chain_locked(uuid,uuid)', false),
      ('public.moth_file_row_locked(uuid,uuid,uuid,boolean,text,text[],uuid)', false),
      ('public._moth_target_eligible(text,uuid,boolean)', false),
      ('public.moth_can_read_target(text,uuid)', true),
      ('public.moth_can_write_target(text,uuid)', true)
    ) AS t(sig, open_to_clients)
  LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn.sig::regprocedure)
       OR NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proconfig) c
                       WHERE p.oid = v_fn.sig::regprocedure AND c LIKE 'search_path=%') THEN
      RAISE EXCEPTION '0111 post-condition: % must be a definer with a pinned search_path', v_fn.sig;
    END IF;
    IF has_function_privilege('anon', v_fn.sig::regprocedure, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn.sig::regprocedure, 'EXECUTE') IS DISTINCT FROM v_fn.open_to_clients THEN
      RAISE EXCEPTION '0111 post-condition: % has the wrong grants', v_fn.sig;
    END IF;
  END LOOP;

  -- The guard is not a definer, and it is on folders for the three columns.
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_folders_lock_guard()'::regprocedure) THEN
    RAISE EXCEPTION '0111 post-condition: fn_folders_lock_guard must be INVOKER (a definer is an oracle over a hidden parent''s path)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.folders'::regclass
                    AND tgname = 'trg_folders_lock_guard'
                    AND tgenabled = 'O'
                    AND pg_get_triggerdef(oid) LIKE '%BEFORE INSERT OR DELETE OR UPDATE OF path, slug, parent_id ON public.folders%') THEN
    RAISE EXCEPTION '0111 post-condition: trg_folders_lock_guard is missing or changed';
  END IF;
  IF to_regclass('public.expenses_file_ids_gin') IS NULL THEN
    RAISE EXCEPTION '0111 post-condition: expenses_file_ids_gin is missing';
  END IF;

  RAISE NOTICE '0111 OK: the read path, the classifier and the folder guard are in place';
END $$;
