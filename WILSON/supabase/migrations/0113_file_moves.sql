-- =============================================================================
-- 0113_file_moves.sql — M.O.T.H. Session 1 (MO1), the move journal and the
-- same-project keys (docs/design/MOTH_DESIGN.md §1.4 "0113", §1.5, and §2.3 MV-5,
-- MV-7, SEC-MV-11).
--
-- WHAT IS NEW
-- -----------
-- A file's move between projects will have one contract (0118): the server plans
-- it, writes this journal, and only then changes the row, under a marker bound to
-- the journal row. This file lays what that needs, and changes nothing anyone sees.
--
--   §1  folders UNIQUE (id, project_id), then two composite foreign keys, so the
--       database itself refuses a folder parented across projects or a file filed
--       in another project's folder, for every writer. 0107's guard already judges
--       a client; these bind definers and service_role too. A folder's delete still
--       cascades to its children and still only clears a file's folder_id.
--   §2  public.file_moves: one row per move. ENABLE and FORCE RLS, no policies, no
--       client grants: nobody reads it, so the private ids it records leak nothing.
--   §3  fn_checked_move_admits: true only for the journal row the marker names,
--       written in this very transaction, by this very person, holding an item
--       that matches all five values. An unrelated or future definer fails closed.
--       Nothing calls it yet: fn_files_body_guard (0114) will.
--   §4  fn_moth_body_provider_for: where a company's new bodies go.
--   §5  purge_file_moves and its cron job.
--   §6  COMMENTs; §7 post-conditions.
--
-- One transaction, no enum. Re-runnable. The cross-project counts stop it rather
-- than guess which side is right. ON DELETE SET NULL (column list) needs
-- PostgreSQL 15. Suite 114_file_moves.sql; 05_files and 52_folders extended.
-- =============================================================================

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
DECLARE
  v_parents BIGINT;
  v_files   BIGINT;
BEGIN
  IF to_regprocedure('public.moth_can_read_target(text,uuid)') IS NULL THEN
    RAISE EXCEPTION '0113 refused: 0111 must be applied first';
  END IF;
  IF to_regprocedure('public.fn_audit_touch()') IS NULL THEN
    RAISE EXCEPTION '0113 refused: fn_audit_touch is missing';
  END IF;
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION '0113 refused: ON DELETE SET NULL (folder_id) needs PostgreSQL 15 or later; this is %', current_setting('server_version');
  END IF;
  -- The definers below read and write a table with FORCE RLS (0069's lesson).
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0113 refused: % does not bypass row security', current_user;
  END IF;

  -- Taken before the counts, so nothing lands between them and the keys.
  LOCK TABLE public.folders, public.files IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*) INTO v_parents
    FROM public.folders f
    JOIN public.folders par ON par.id = f.parent_id
   WHERE par.project_id IS DISTINCT FROM f.project_id;
  SELECT count(*) INTO v_files
    FROM public.files f
    JOIN public.folders fo ON fo.id = f.folder_id
   WHERE fo.project_id IS DISTINCT FROM f.project_id;
  IF v_parents > 0 OR v_files > 0 THEN
    RAISE EXCEPTION '0113 refused: % folder(s) have a parent in another project and % file(s) are filed in another project''s folder; repair them first', v_parents, v_files;
  END IF;
END $$;

-- §1 The keys ----------------------------------------------------------------------
ALTER TABLE public.folders DROP CONSTRAINT IF EXISTS folders_id_project_key;
ALTER TABLE public.folders ADD CONSTRAINT folders_id_project_key UNIQUE (id, project_id);

-- The single-column keys are found by catalogue, not by name: 0041 and 0043 let
-- Postgres name them, and a name is not a promise.
DO $$
DECLARE
  v_con RECORD;
BEGIN
  FOR v_con IN
    SELECT c.conrelid::regclass AS tbl, c.conname
      FROM pg_constraint c
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.folders'::regclass
       AND ((c.conrelid = 'public.folders'::regclass
             AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.folders'::regclass AND attname = 'parent_id')])
         OR (c.conrelid = 'public.files'::regclass
             AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.files'::regclass AND attname = 'folder_id')]))
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', v_con.tbl, v_con.conname);
  END LOOP;
END $$;

ALTER TABLE public.folders DROP CONSTRAINT IF EXISTS folders_parent_same_project_fk;
ALTER TABLE public.folders ADD CONSTRAINT folders_parent_same_project_fk
  FOREIGN KEY (parent_id, project_id) REFERENCES public.folders (id, project_id)
  ON DELETE CASCADE NOT VALID;
ALTER TABLE public.folders VALIDATE CONSTRAINT folders_parent_same_project_fk;

-- The column list keeps project_id: a folder's delete clears only folder_id.
ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_folder_same_project_fk;
ALTER TABLE public.files ADD CONSTRAINT files_folder_same_project_fk
  FOREIGN KEY (folder_id, project_id) REFERENCES public.folders (id, project_id)
  ON DELETE SET NULL (folder_id) NOT VALID;
ALTER TABLE public.files VALIDATE CONSTRAINT files_folder_same_project_fk;

-- §2 The journal ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.file_moves (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL DEFAULT auth.uid(),
  txid          bigint NOT NULL DEFAULT txid_current(),
  -- Per file: id, how, from and to project, from and to folder, the seven
  -- from-links, was_core_definer, and from and to provider, path and thumbnail.
  items         jsonb NOT NULL,
  undo_of       uuid REFERENCES public.file_moves(id) ON DELETE SET NULL,
  undone_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid,
  CONSTRAINT file_moves_items_shape_chk CHECK (
    CASE WHEN jsonb_typeof(items) = 'array'
         THEN jsonb_array_length(items) BETWEEN 1 AND 500
         ELSE false
    END
  )
);

CREATE INDEX IF NOT EXISTS file_moves_workspace_created_idx ON public.file_moves (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS file_moves_undo_of_idx ON public.file_moves (undo_of) WHERE undo_of IS NOT NULL;

CREATE OR REPLACE TRIGGER trg_file_moves_audit
  BEFORE INSERT OR UPDATE ON public.file_moves
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_touch();

ALTER TABLE public.file_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_moves FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.file_moves FROM PUBLIC, anon, authenticated;
GRANT  ALL ON public.file_moves TO service_role;

-- §3 The one admission ----------------------------------------------------------------
-- `@>` on a jsonb array of objects: an item matching all five values, whatever
-- else it holds. A NULL folder is matched as JSON null, so it cannot stand for
-- "any folder". A marker that is empty or absent reads as no row.
CREATE OR REPLACE FUNCTION public.fn_checked_move_admits(
  p_file uuid, p_project uuid, p_folder uuid, p_provider text, p_path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
      FROM public.file_moves m
     WHERE m.id = NULLIF(current_setting('wilson.file_move', true), '')::uuid
       AND m.txid = txid_current()
       AND m.actor_user_id = auth.uid()
       AND m.items @> jsonb_build_array(jsonb_build_object(
             'id', p_file,
             'to_project', p_project,
             'to_folder', p_folder,
             'to_provider', p_provider,
             'to_path', p_path))
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_checked_move_admits(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;

-- §4 Where a company's new bodies go -----------------------------------------------------
-- The server's copy of storage/index.js fileProviderFor, except on an office server:
-- a copy-up there targets the share, not local_server. Text, because no guard
-- written before 0117 uses the enum value (0112).
CREATE OR REPLACE FUNCTION public.fn_moth_body_provider_for(p_workspace uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider TEXT;
BEGIN
  SELECT ws.provider INTO v_provider
    FROM public.workspace_storage ws
   WHERE ws.workspace_id = p_workspace;
  RETURN CASE v_provider
    WHEN 'network' THEN 'network_share'
    WHEN 's3' THEN 's3'
    ELSE 'supabase'
  END;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_moth_body_provider_for(uuid) FROM PUBLIC, anon, authenticated;

-- §5 The purge -----------------------------------------------------------------------------
-- An undo is offered within a session, so 30 days is generous. Refuses anything
-- under a day, so a slip of the hand cannot empty the journal mid-move.
CREATE OR REPLACE FUNCTION public.purge_file_moves(p_retention interval DEFAULT interval '30 days')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INT;
BEGIN
  IF p_retention IS NULL OR p_retention < interval '1 day' THEN
    RAISE EXCEPTION 'purge_file_moves: the retention must be at least a day';
  END IF;
  DELETE FROM public.file_moves WHERE created_at < now() - p_retention;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.purge_file_moves(interval) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_file_moves(interval) TO service_role;

-- cron.schedule() upserts by job name, so a re-run is idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule(
      'wilson-purge-file-moves',
      '41 4 * * *',
      $job$ SELECT public.purge_file_moves(); $job$
    );
  ELSE
    RAISE NOTICE 'pg_cron unavailable — the file_moves purge is not scheduled (expected in CI local stack)';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'could not schedule the file_moves purge via pg_cron: %', SQLERRM;
END $$;

-- §6 COMMENTs -----------------------------------------------------------------------------
COMMENT ON TABLE public.file_moves IS
  'The journal of file moves between and within projects, one row per operation, written before the rows change. FORCE RLS and no policies: nobody reads it, so the private ids it records leak nothing.';
COMMENT ON COLUMN public.file_moves.txid IS
  'The transaction that wrote it. fn_checked_move_admits admits a row change only in this same transaction.';
COMMENT ON COLUMN public.file_moves.items IS
  'One object per file: id, how, from and to project, from and to folder, the seven from-links, was_core_definer, and from and to provider, path and thumbnail. 1 to 500.';
COMMENT ON FUNCTION public.fn_checked_move_admits(uuid, uuid, uuid, text, text) IS
  'True only when wilson.file_move names a journal row written in this transaction by this person with an item matching all five values. The one way a definer is admitted to change a file''s project, folder or locator. Revoked from clients.';
COMMENT ON FUNCTION public.fn_moth_body_provider_for(uuid) IS
  'The provider a company''s new bodies go to, as text: supabase, s3 or network_share. The server''s copy of storage/index.js fileProviderFor, except that on an office server a copy-up targets the share. Revoked from clients.';
COMMENT ON FUNCTION public.purge_file_moves(interval) IS
  'Deletes journal rows older than the retention (30 days; refuses under one day). Cron wilson-purge-file-moves, 04:41 UTC. Service role only.';

-- §7 Post-conditions -----------------------------------------------------------------------
DO $$
DECLARE
  v_con pg_constraint%ROWTYPE;
  v_n   INT;
BEGIN
  -- Exactly one key on parent_id: composite, cascading.
  SELECT count(*) INTO v_n
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
   WHERE c.conrelid = 'public.folders'::regclass AND c.contype = 'f' AND a.attname = 'parent_id';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '0113 post-condition: % foreign keys on folders.parent_id, not 1', v_n;
  END IF;
  SELECT * INTO v_con FROM pg_constraint
   WHERE conrelid = 'public.folders'::regclass AND conname = 'folders_parent_same_project_fk';
  IF v_con.confdeltype <> 'c' OR cardinality(v_con.conkey) <> 2 OR NOT v_con.convalidated THEN
    RAISE EXCEPTION '0113 post-condition: folders_parent_same_project_fk is not composite, cascading and validated';
  END IF;

  -- Exactly one key on files.folder_id: composite, clearing only folder_id. And
  -- 0043's post-conditions 2 and 3 still hold for all five of its columns.
  SELECT count(*) INTO v_n
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
   WHERE c.conrelid = 'public.files'::regclass AND c.contype = 'f' AND a.attname = 'folder_id';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '0113 post-condition: % foreign keys on files.folder_id, not 1', v_n;
  END IF;
  SELECT * INTO v_con FROM pg_constraint
   WHERE conrelid = 'public.files'::regclass AND conname = 'files_folder_same_project_fk';
  IF v_con.confdeltype <> 'n' OR cardinality(v_con.conkey) <> 2 OR NOT v_con.convalidated
     OR v_con.confdelsetcols IS DISTINCT FROM ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.files'::regclass AND attname = 'folder_id')] THEN
    RAISE EXCEPTION '0113 post-condition: files_folder_same_project_fk is not composite, validated and SET NULL (folder_id)';
  END IF;
  SELECT count(*) INTO v_n
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
   WHERE c.conrelid = 'public.files'::regclass AND c.contype = 'f' AND c.confdeltype = 'n'
     AND a.attname IN ('scene_id', 'shot_id', 'level_id', 'experience_id', 'folder_id');
  IF v_n <> 5 THEN
    RAISE EXCEPTION '0113 post-condition: % of 0043''s five keys are SET NULL', v_n;
  END IF;

  -- The journal is closed to clients.
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.file_moves'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.file_moves'::regclass) THEN
    RAISE EXCEPTION '0113 post-condition: file_moves must have RLS forced and no policies';
  END IF;
  IF has_table_privilege('authenticated', 'public.file_moves', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('anon', 'public.file_moves', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION '0113 post-condition: a client role holds a privilege on file_moves';
  END IF;

  -- The admission's four conditions, on the comment-stripped body.
  IF NOT EXISTS (
    SELECT 1 FROM (
      SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') AS body
        FROM pg_proc WHERE oid = 'public.fn_checked_move_admits(uuid,uuid,uuid,text,text)'::regprocedure
    ) x
    WHERE position('current_setting(''wilson.file_move''' IN body) > 0
      AND position('m.txid = txid_current()' IN body) > 0
      AND position('m.actor_user_id = auth.uid()' IN body) > 0
      AND position('m.items @>' IN body) > 0
  ) THEN
    RAISE EXCEPTION '0113 post-condition: fn_checked_move_admits lost a condition';
  END IF;

  -- The three definers: no client may call them.
  IF has_function_privilege('authenticated', 'public.fn_checked_move_admits(uuid,uuid,uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_checked_move_admits(uuid,uuid,uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_moth_body_provider_for(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_moth_body_provider_for(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.purge_file_moves(interval)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.purge_file_moves(interval)', 'EXECUTE') THEN
    RAISE EXCEPTION '0113 post-condition: a client role may call a definer it must not';
  END IF;

  RAISE NOTICE '0113 OK: the same-project keys, the journal and its admission are in place';
END $$;
