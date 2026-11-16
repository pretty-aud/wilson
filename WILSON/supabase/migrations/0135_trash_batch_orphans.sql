-- =============================================================================
-- 0135_trash_batch_orphans.sql — M.O.T.H. Session 4 (MO4): a file whose trash batch lost its folder.
--
-- 0131 puts a folder in the trash with what is in it as one batch, and a batch's file comes back only with its
-- folder. A thing's own folder hangs off it by key: deleting a scene, shot, asset, level or experience deletes that
-- folder, and every folder inside it, a custom folder in the trash included (the guards let a cascade through). The
-- files' key then sets their folder_id NULL. Such a file kept its deleted_at and its batch: Moth's trash index left
-- it out (a batch's file is listed as its folder), no folder was left to bring it back with, and a restore of the
-- file alone was refused. Nothing listed it and nothing could bring it back, until the purge took it.
--
-- This file restates fn_files_folder_trash_guard from its body in 0131 with one arm added at the top, for every
-- session: when the key sets such a file's folder_id NULL because its folder is gone, the file lets go of its batch.
-- It is then an ordinary file in the trash, listed and brought back on its own, to the project's top. Nothing else
-- changes: a client still never writes a file's batch.
--
-- Re-run after any replay of 0131.
--
-- One transaction, re-runnable, no enum. Suite 136.
-- =============================================================================

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0135 refused: % does not bypass row security', current_user;
  END IF;
  IF to_regprocedure('public.moth_trash_folders(uuid[])') IS NULL THEN
    RAISE EXCEPTION '0135 refused: 0131 must be applied first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = to_regclass('public.files') AND tgname = 'trg_files_folder_trash_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '0135 refused: the files'' trash guard (0131) is not on public.files';
  END IF;
  -- The body this restates, as 0131 left it, or as this file leaves it on a second run.
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.fn_files_folder_trash_guard()'::regprocedure)
       NOT IN ('f9f87948091848ea6ea9c06f6d722b1a', '82ff8938111483a85a9ef5c5dffb1370') THEN
    RAISE EXCEPTION '0135 refused: the files'' trash guard is neither 0131''s nor this file''s';
  END IF;
END $$;

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
  -- 0135: the folder this file went to the trash with was deleted outright (the key's own SET NULL, inside that
  -- delete). The file lets go of its batch and is an ordinary file in the trash, listed and brought back on its
  -- own to the project's top. The key's SET NULL changes folder_id and nothing else, so the arm asks that the
  -- batch and the trash stamp are both as they were.
  IF TG_OP = 'UPDATE' AND OLD.folder_id IS NOT NULL AND NEW.folder_id IS NULL
     AND OLD.trash_batch IS NOT NULL AND NEW.trash_batch IS NOT DISTINCT FROM OLD.trash_batch
     AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at
     AND NOT EXISTS (SELECT 1 FROM public.folders fo WHERE fo.id = OLD.folder_id) THEN
    NEW.trash_batch := NULL;
    RETURN NEW;
  END IF;
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

DO $$
BEGIN
  -- The new arm, by the three lines only it holds.
  IF NOT EXISTS (SELECT 1 FROM pg_proc
                  WHERE oid = 'public.fn_files_folder_trash_guard()'::regprocedure
                    AND prosrc LIKE '%NOT EXISTS (SELECT 1 FROM public.folders fo WHERE fo.id = OLD.folder_id)%'
                    AND prosrc LIKE '%NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at%'
                    AND prosrc LIKE '%NEW.trash_batch := NULL;%') THEN
    RAISE EXCEPTION '0135 post-condition: the files'' trash guard does not hold the arm for a batch whose folder is gone';
  END IF;
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.fn_files_folder_trash_guard()'::regprocedure)
       <> '82ff8938111483a85a9ef5c5dffb1370' THEN
    RAISE EXCEPTION '0135 post-condition: the files'' trash guard is not this file''s';
  END IF;
  -- The trigger, read from the catalogue rather than from its printed text: on public.files, enabled, calling this
  -- function, BEFORE and FOR EACH ROW on INSERT and UPDATE and nothing else (tgtype 1 row + 2 before + 4 insert +
  -- 16 update = 23), and the UPDATE limited to exactly the three columns, in any order.
  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = 'public.files'::regclass AND t.tgname = 'trg_files_folder_trash_guard' AND NOT t.tgisinternal
          AND t.tgenabled = 'O'
          AND t.tgfoid = 'public.fn_files_folder_trash_guard()'::regprocedure
          AND t.tgtype = 23
          AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
                 FROM unnest(t.tgattr::int2[]) k(attnum)
                 JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = k.attnum)
              = ARRAY['deleted_at', 'folder_id', 'trash_batch']) THEN
    RAISE EXCEPTION '0135 post-condition: the files'' trash guard is not on INSERT and UPDATE OF folder_id, deleted_at, trash_batch';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_files_folder_trash_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION '0135 post-condition: a client may call the files'' trash guard';
  END IF;
END $$;
