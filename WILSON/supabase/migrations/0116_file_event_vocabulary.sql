-- =============================================================================
-- 0116_file_event_vocabulary.sql — M.O.T.H. Session 1 (MO1): one vocabulary for what
-- happens to a file, one capture, and a file's log from a project's private time stays
-- with the people who could see it then (docs/design/MOTH_DESIGN.md §1.2 item c, §1.4
-- "0116", §2.3 MV-8, MV-9, §2.4 NS-D11, §2.1 SB-19).
--
-- WHAT IS NEW
-- -----------
--   §1  file_events_event_check, in one widening: 0093's nine, and catalogued, moved_out,
--       moved_in, refiled. Thirteen terms. Nothing writes the four new ones until 0117
--       and 0118.
--   §2  file_events.captured_private, her ruling of 2026-11-05, asked in the session that
--       built this file: "A private project keeps a log of what happened to its files
--       (added, renamed, moved, deleted, and who did it). If the project is later opened
--       to the whole company, should the newly admitted people see the log entries from
--       its private time?", answered "Keep them hidden (Recommended)". The rule
--       edit_history has since 0108. A BEFORE INSERT trigger sets it for every writer, the
--       way is_financial's already does, and the rows already written are walked back
--       through edit_history by a revoked function, file_events_restamp.
--   §3  fn_file_events_capture, restated once from 0074: a project change writes moved_out
--       under the old project and moved_in under the new one, with no paths, so neither
--       side learns the other's locator; a folder change within a project writes refiled;
--       'moved' is a locator change within one project; an insert under the catalogue's
--       marker writes catalogued; a purge certificate of an office-server row says where
--       the real file went.
--   §4  fn_realtime_broadcast, restated from 0109 with one early return: a catalogue
--       check does not put each row it writes on the project's channel. It says so once.
--   §5  file_events_select, restated from 0093 with the private-time arm.
--   §6  COMMENTs; §7 post-conditions.
--
-- WHAT THIS CHANGES FOR A RUNNING BUILD
-- -------------------------------------
-- Nothing until 0117 and 0118 write the new terms. Then a build without their labels shows
-- the term itself in a file's activity. A project made public no longer shows its private
-- time's file activity to people who could not see it then: this is her ruling.
--
-- A CHECK, not an enum, so one transaction. Re-runnable. Suites 33, 78, 20, 95, 99, 100,
-- 101, 104 and 112.
-- =============================================================================

-- ALTER TABLE, the trigger and the policy need ACCESS EXCLUSIVE on file_events: refuse
-- rather than queue every writer behind a long reader. A refusal here is safe; run it again.
SET LOCAL lock_timeout = '15s';

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
DECLARE
  v_md5 TEXT;
BEGIN
  IF to_regprocedure('public.edit_history_value_at(text,uuid,text,timestamptz,bigint)') IS NULL THEN
    RAISE EXCEPTION '0116 refused: 0108''s edit_history_value_at is missing';
  END IF;
  IF to_regprocedure('rabbit_private.storage_object_claimed(text,text)') IS NULL THEN
    RAISE EXCEPTION '0116 refused: 0114 must be applied first';
  END IF;
  -- The definers below read and write tables with row security on (0069's lesson).
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0116 refused: % does not bypass row security', current_user;
  END IF;

  -- What is restated below is what it was lifted from, or this file's.
  SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc WHERE oid = 'public.fn_file_events_capture()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '17fe6af1bb8f710e747ab47b62647354' AND v_md5 IS DISTINCT FROM '01f0368e1db63b4e8844174059b9cb78' THEN
    RAISE EXCEPTION '0116 refused: fn_file_events_capture is neither 0074''s body nor this file''s (md5 %)', v_md5;
  END IF;
  SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc WHERE oid = 'public.fn_realtime_broadcast()'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'cb26163e64f063de4da39c4eb316de4b' AND v_md5 IS DISTINCT FROM '34686e6bbb9ba89ecf012e003856e6da' THEN
    RAISE EXCEPTION '0116 refused: fn_realtime_broadcast is neither 0109''s body nor this file''s (md5 %)', v_md5;
  END IF;
  SELECT md5(qual) INTO v_md5 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'file_events' AND policyname = 'file_events_select';
  IF v_md5 IS DISTINCT FROM 'b6d7cee18e0afd903f9b83f34c8bb5b3' AND v_md5 IS DISTINCT FROM '8a954e2d7e646eacf21ed2303c8617e8' THEN
    RAISE EXCEPTION '0116 refused: file_events_select is neither 0093''s text nor this file''s (md5 %)', v_md5;
  END IF;
END $$;

-- §1 The vocabulary, one widening ------------------------------------------------
-- 0073's discovery-based drop: any CHECK on file_events whose definition mentions
-- 'uploaded'. A name-only drop that misses leaves two vocabularies, and the narrower wins.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.file_events'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%uploaded%'
  LOOP
    EXECUTE format('ALTER TABLE public.file_events DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.file_events
  ADD CONSTRAINT file_events_event_check CHECK (event IN
    ('uploaded', 'downloaded', 'moved', 'relinked', 'trashed', 'restored',
     'purged',
     'upload_abandoned',
     'viewed_remote',
     -- 0116: written by the capture below, under the catalogue's marker (0117).
     'catalogued',
     -- 0116: a project change, one row each side, no paths (0118).
     'moved_out', 'moved_in',
     -- 0116: a folder change within one project (0118).
     'refiled'));

-- §2 A file's log from a project's private time --------------------------------------
-- DEFAULT true, so anything that writes past the trigger fails closed (edit_history's
-- lesson, 0108's review round 1).
ALTER TABLE public.file_events
  ADD COLUMN IF NOT EXISTS captured_private boolean NOT NULL DEFAULT true;

-- Every row, whoever writes it: the capture, the downloads, the sweep, the gateway. Not the
-- writer's to say, so it overwrites. A project already gone has no audience but the admins.
CREATE OR REPLACE FUNCTION public.fn_file_events_private_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.captured_private := COALESCE((SELECT p.is_private FROM public.projects p WHERE p.id = NEW.project_id), true);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_file_events_private_snapshot() FROM PUBLIC, anon, authenticated;

-- The rows already written, as a revoked function so suite 78 can prove the walk (0108's
-- edit_history_restamp): what the project was at that moment, walked back through its
-- history; a project whose visibility never changed is its live value, no walk; a project
-- already gone, or a walk with no answer, is closed. Run again it changes nothing.
CREATE OR REPLACE FUNCTION public.file_events_restamp()
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed bigint;
BEGIN
  UPDATE public.file_events fe
     SET captured_private = x.priv
    FROM (SELECT e.id,
                 CASE
                   WHEN NOT EXISTS (SELECT 1 FROM public.edit_history f
                                     WHERE f.entity_type = 'projects' AND f.entity_id = e.project_id
                                       AND f.action = 'update' AND f.diff ? 'is_private')
                     THEN COALESCE((SELECT p.is_private FROM public.projects p WHERE p.id = e.project_id), true)
                   ELSE COALESCE(public.edit_history_value_at('projects', e.project_id, 'is_private', e.created_at)::boolean, true)
                 END AS priv
            FROM public.file_events e) x
   WHERE fe.id = x.id
     AND fe.captured_private IS DISTINCT FROM x.priv;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END;
$$;
REVOKE ALL ON FUNCTION public.file_events_restamp() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.file_events_restamp() TO service_role;

SELECT public.file_events_restamp();

DROP TRIGGER IF EXISTS trg_file_events_private ON public.file_events;
CREATE TRIGGER trg_file_events_private
  BEFORE INSERT ON public.file_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_file_events_private_snapshot();

-- §3 The one capture --------------------------------------------------------------------
-- 0074's body, and every line of it is here. A row kept with the office server (0117) is
-- named with ::text: this file's transaction cannot be sure of the label's use.
CREATE OR REPLACE FUNCTION public.fn_file_events_capture()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_label TEXT;
  v_row   public.files;
BEGIN
  v_row := COALESCE(NEW, OLD);
  v_actor := auth.uid();
  IF v_actor IS NOT NULL THEN
    SELECT COALESCE(wm.display_name, wm.username) INTO v_label
      FROM public.workspace_members wm
     WHERE wm.workspace_id = v_row.workspace_id
       AND wm.user_id = v_actor;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.file_events
      (workspace_id, project_id, file_id, file_name, storage_provider,
       event, new_path, size_bytes, actor_user_id, actor_label, is_financial)
    VALUES
      (NEW.workspace_id, NEW.project_id, NEW.id, NEW.name, NEW.storage_provider::text,
       -- 0116: what a catalogue check found is not something anyone uploaded.
       CASE WHEN COALESCE(current_setting('wilson.network_share_writer', true), '') = 'check:' || NEW.project_id::text
            THEN 'catalogued' ELSE 'uploaded' END,
       NEW.storage_path, NEW.size_bytes, v_actor, v_label,
       public.file_event_is_financial(NEW.is_financial, NEW.storage_path, NULL));

  ELSIF TG_OP = 'UPDATE' THEN
    -- Trash transitions and path changes are independent facts; an UPDATE
    -- carrying both emits both events.
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      INSERT INTO public.file_events
        (workspace_id, project_id, file_id, file_name, storage_provider,
         event, old_path, size_bytes, actor_user_id, actor_label, is_financial)
      VALUES
        (NEW.workspace_id, NEW.project_id, NEW.id, NEW.name, NEW.storage_provider::text,
         'trashed', NEW.storage_path, NEW.size_bytes, v_actor, v_label,
         public.file_event_is_financial(NEW.is_financial, NEW.storage_path, NULL));
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      INSERT INTO public.file_events
        (workspace_id, project_id, file_id, file_name, storage_provider,
         event, new_path, size_bytes, actor_user_id, actor_label, is_financial)
      VALUES
        (NEW.workspace_id, NEW.project_id, NEW.id, NEW.name, NEW.storage_provider::text,
         'restored', NEW.storage_path, NEW.size_bytes, v_actor, v_label,
         public.file_event_is_financial(NEW.is_financial, NEW.storage_path, NULL));
    END IF;

    IF OLD.project_id IS DISTINCT FROM NEW.project_id THEN
      -- 0116: one row each side, under that side's project, with no paths and no id of
      -- the other side: a path would tell one project's readers the other's locator.
      -- Either side under a money segment, or either side's flag, classifies both rows:
      -- the row itself carries no path for the money trigger to read.
      INSERT INTO public.file_events
        (workspace_id, project_id, file_id, file_name, storage_provider,
         event, size_bytes, actor_user_id, actor_label, is_financial)
      VALUES
        (OLD.workspace_id, OLD.project_id, OLD.id, OLD.name, OLD.storage_provider::text,
         'moved_out', OLD.size_bytes, v_actor, v_label,
         public.file_event_is_financial(OLD.is_financial OR NEW.is_financial, OLD.storage_path, NEW.storage_path)),
        (NEW.workspace_id, NEW.project_id, NEW.id, NEW.name, NEW.storage_provider::text,
         'moved_in', NEW.size_bytes, v_actor, v_label,
         public.file_event_is_financial(OLD.is_financial OR NEW.is_financial, OLD.storage_path, NEW.storage_path));
    ELSE
      IF OLD.storage_path IS DISTINCT FROM NEW.storage_path THEN
        INSERT INTO public.file_events
          (workspace_id, project_id, file_id, file_name, storage_provider,
           event, old_path, new_path, size_bytes, actor_user_id, actor_label, is_financial)
        VALUES
          (NEW.workspace_id, NEW.project_id, NEW.id, NEW.name, NEW.storage_provider::text,
           'moved', OLD.storage_path, NEW.storage_path, NEW.size_bytes, v_actor, v_label,
           -- Either side of a move under a money segment classifies the event:
           -- an invoice moved OUT of INVOICES/ is still an invoice's history.
           public.file_event_is_financial(NEW.is_financial, OLD.storage_path, NEW.storage_path));
      END IF;
      -- 0116: the folder is a fact of its own, as the path is.
      IF OLD.folder_id IS DISTINCT FROM NEW.folder_id THEN
        INSERT INTO public.file_events
          (workspace_id, project_id, file_id, file_name, storage_provider,
           event, size_bytes, actor_user_id, actor_label, details, is_financial)
        VALUES
          (NEW.workspace_id, NEW.project_id, NEW.id, NEW.name, NEW.storage_provider::text,
           'refiled', NEW.size_bytes, v_actor, v_label,
           jsonb_build_object('from_folder_id', OLD.folder_id, 'to_folder_id', NEW.folder_id),
           public.file_event_is_financial(NEW.is_financial, NEW.storage_path, NULL));
      END IF;
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    -- The deletion certificate (TPN-CONT-002): what was purged, from where,
    -- how big, by whom (NULL actor = the nightly purge / a cascade).
    INSERT INTO public.file_events
      (workspace_id, project_id, file_id, file_name, storage_provider,
       event, old_path, size_bytes, actor_user_id, actor_label, details, is_financial)
    VALUES
      (OLD.workspace_id, OLD.project_id, OLD.id, OLD.name, OLD.storage_provider::text,
       'purged', OLD.storage_path, OLD.size_bytes, v_actor, v_label,
       -- left(): mime_type is unconstrained client-writable TEXT — an
       -- oversized value would trip the details CHECK inside this trigger,
       -- get swallowed by the handler below, and silently void the
       -- certificate (adversarial review, S14). Truncation keeps the
       -- certificate write infallible for client-reachable inputs.
       jsonb_build_object('mime_type', left(OLD.mime_type, 256), 'kind', OLD.kind::text,
                          'was_trashed', OLD.deleted_at IS NOT NULL)
       -- 0116: an office-server row's real file is not this system's to remove: the
       -- certificate says where it went.
       || CASE WHEN OLD.storage_provider::text = 'network_share'
               THEN jsonb_build_object('body', CASE WHEN OLD.share_bin_path IS NOT NULL
                                                    THEN 'company server bin'
                                                    ELSE 'left on the company server' END)
               ELSE '{}'::jsonb END,
       -- Flagged even though every reader may see a certificate: the flag is a
       -- fact about the file, the visibility rule is the policy's.
       public.file_event_is_financial(OLD.is_financial, OLD.storage_path, NULL));
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- An audit failure must never abort the write it audits (0012 idiom).
  -- This also swallows the expected FK failure during workspace CASCADE
  -- teardown, where the parent workspaces row is already gone.
  RAISE WARNING 'file_events capture failed for % on files: %', TG_OP, SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_file_events_capture() FROM PUBLIC, anon, authenticated;

-- §4 The broadcast, from 0109 with one early return ---------------------------------------
CREATE OR REPLACE FUNCTION public.fn_realtime_broadcast()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     JSONB;
  v_project UUID;
  v_new     JSONB;
  v_old     JSONB;
  v_pn      UUID;   -- 0109: NEW's project
  v_po      UUID;   -- 0109: OLD's project
  v_tn      TEXT;   -- 0109: NEW's topic
  v_to      TEXT;   -- 0109: OLD's topic
  v_self    BOOLEAN := false;  -- 0109: the row is the project itself
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
  v_new := to_jsonb(NEW);
  v_old := to_jsonb(OLD);

  -- 0109: each arm resolves both sides, v_project from v_row (NEW, else OLD)
  -- as before and v_po from OLD, so every table is still named once.
  CASE TG_TABLE_NAME
    WHEN 'projects' THEN
      v_project := (v_row ->> 'id')::uuid;
      v_po := (v_old ->> 'id')::uuid;
      v_self := true;
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
      v_po := (v_old ->> 'project_id')::uuid;
    -- 0088: files has its own arm. A money row — the flag or a locked folder,
    -- on either side of the write — is never put on the project channel.
    WHEN 'files' THEN
      IF public.file_row_is_money((to_jsonb(NEW) ->> 'is_financial')::boolean,
                                  to_jsonb(NEW) ->> 'storage_path')
         OR public.file_row_is_money((to_jsonb(OLD) ->> 'is_financial')::boolean,
                                     to_jsonb(OLD) ->> 'storage_path') THEN
        RETURN NULL;
      END IF;
      -- 0116: a catalogue check writes many rows and says so once (0117): none of them
      -- goes on the channel. An ordinary file's marker is never this.
      IF COALESCE(current_setting('wilson.network_share_writer', true), '') = 'check:' || (v_row ->> 'project_id') THEN
        RETURN NULL;
      END IF;
      v_project := (v_row ->> 'project_id')::uuid;
      v_po := (v_old ->> 'project_id')::uuid;
    WHEN 'comments' THEN
      v_project := public.fn_comment_project_id(
        v_row ->> 'entity_type', (v_row ->> 'entity_id')::uuid);
      v_po := public.fn_comment_project_id(
        v_old ->> 'entity_type', (v_old ->> 'entity_id')::uuid);
    -- 0109: a dependency routes only when both endpoints share a project; one
    -- that joins two projects belongs to neither topic.
    WHEN 'task_dependencies' THEN
      SELECT t.project_id INTO v_project FROM public.tasks t
       WHERE t.id = (v_row ->> 'predecessor_id')::uuid
         AND EXISTS (SELECT 1 FROM public.tasks s
                      WHERE s.id = (v_row ->> 'successor_id')::uuid
                        AND s.project_id = t.project_id);
      SELECT t.project_id INTO v_po FROM public.tasks t
       WHERE t.id = (v_old ->> 'predecessor_id')::uuid
         AND EXISTS (SELECT 1 FROM public.tasks s
                      WHERE s.id = (v_old ->> 'successor_id')::uuid
                        AND s.project_id = t.project_id);
    -- 0061: the phase sibling. Resolves through phases, not tasks.
    WHEN 'phase_dependencies' THEN
      SELECT ph.project_id INTO v_project FROM public.phases ph
       WHERE ph.id = (v_row ->> 'predecessor_id')::uuid
         AND EXISTS (SELECT 1 FROM public.phases s
                      WHERE s.id = (v_row ->> 'successor_id')::uuid
                        AND s.project_id = ph.project_id);
      SELECT ph.project_id INTO v_po FROM public.phases ph
       WHERE ph.id = (v_old ->> 'predecessor_id')::uuid
         AND EXISTS (SELECT 1 FROM public.phases s
                      WHERE s.id = (v_old ->> 'successor_id')::uuid
                        AND s.project_id = ph.project_id);
    WHEN 'task_links' THEN
      SELECT t.project_id INTO v_project FROM public.tasks t
       WHERE t.id = (v_row ->> 'task_id')::uuid;
      SELECT t.project_id INTO v_po FROM public.tasks t
       WHERE t.id = (v_old ->> 'task_id')::uuid;
    WHEN 'asset_versions' THEN
      SELECT a.project_id INTO v_project FROM public.assets a
       WHERE a.id = (v_row ->> 'asset_id')::uuid;
      SELECT a.project_id INTO v_po FROM public.assets a
       WHERE a.id = (v_old ->> 'asset_id')::uuid;
    ELSE
      v_project := NULL;
  END CASE;

  -- 0109: each side's own project. v_project is NEW's (OLD's on a DELETE);
  -- v_po is OLD's, and an INSERT has none.
  v_pn := CASE WHEN TG_OP <> 'DELETE' THEN v_project END;
  IF TG_OP = 'INSERT' THEN
    v_po := NULL;
  END IF;

  -- Unroutable (cascade delete with the parent already gone, dead-end comment
  -- walk, a dependency across projects): skip. The subtree's own parent event
  -- already told clients everything they need.
  IF v_pn IS NULL AND v_po IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_self THEN
    -- The row's own topic_epoch (0107), not a lookup: on a DELETE the row is
    -- gone, and on an UPDATE OLD's epoch names the topic its listeners joined.
    v_tn := CASE WHEN v_new IS NOT NULL THEN 'rabbit:project:' || (v_new ->> 'id')
              || CASE WHEN COALESCE((v_new ->> 'topic_epoch')::int, 0) > 0
                      THEN ':' || (v_new ->> 'topic_epoch') ELSE '' END END;
    v_to := CASE WHEN v_old IS NOT NULL THEN 'rabbit:project:' || (v_old ->> 'id')
              || CASE WHEN COALESCE((v_old ->> 'topic_epoch')::int, 0) > 0
                      THEN ':' || (v_old ->> 'topic_epoch') ELSE '' END END;
    IF TG_OP = 'UPDATE' AND v_tn IS DISTINCT FROM v_to AND v_pn IS NOT DISTINCT FROM v_po THEN
      -- A narrowing: the old topic's listeners hear only that the audience
      -- changed; the write itself goes to the new topic's.
      PERFORM realtime.send(
        jsonb_build_object('table', TG_TABLE_NAME, 'schema', TG_TABLE_SCHEMA, 'operation', 'AUDIENCE',
                           'record', NULL, 'old_record', NULL),
        'AUDIENCE', v_to, true);
      PERFORM realtime.broadcast_changes(v_tn, TG_OP, TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD);
      RETURN NULL;
    END IF;
  ELSE
    v_tn := CASE WHEN v_pn IS NOT NULL THEN public.project_topic(v_pn) END;
    v_to := CASE WHEN v_po IS NOT NULL THEN public.project_topic(v_po) END;
  END IF;

  -- One project: the write as it is, to that project's topic (a project
  -- already gone has none: skip).
  IF TG_OP <> 'UPDATE' OR v_pn IS NOT DISTINCT FROM v_po THEN
    IF COALESCE(v_tn, v_to) IS NULL THEN
      RETURN NULL;
    END IF;
    PERFORM realtime.broadcast_changes(
      COALESCE(v_tn, v_to),
      TG_OP, TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD
    );
    RETURN NULL;
  END IF;

  -- The project changed: each side goes to its own project's topic only, in
  -- broadcast_changes' payload shape — OLD as a DELETE to the old topic, NEW
  -- as an INSERT to the new one.
  IF v_to IS NOT NULL THEN
    PERFORM realtime.send(
      jsonb_build_object('old_record', v_old, 'record', NULL, 'operation', 'DELETE',
                         'table', TG_TABLE_NAME, 'schema', TG_TABLE_SCHEMA),
      'DELETE', v_to, true);
  END IF;
  IF v_tn IS NOT NULL THEN
    PERFORM realtime.send(
      jsonb_build_object('old_record', NULL, 'record', v_new, 'operation', 'INSERT',
                         'table', TG_TABLE_NAME, 'schema', TG_TABLE_SCHEMA),
      'INSERT', v_tn, true);
  END IF;

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

-- §5 file_events_select, 0093's text and one conjunct ----------------------------------------
-- The 0062 lesson: a rewritten policy drops whatever arm it does not restate, so §7 compares
-- the whole text.
DROP POLICY IF EXISTS file_events_select ON public.file_events;
CREATE POLICY file_events_select ON public.file_events
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (
      -- Anyone who can read the project can read its files' history.
      public.can_read_project_topic(project_id)
      -- Admin arm: proof-of-deletion must stay readable after the project
      -- is purged (can_read_project_topic is false once the row is gone).
      OR public.current_app_role() = 'admin'
    )
    -- Track C / 0074 — the money arm. 0092 (Legal 1): a financial row — its
    -- purged certificate included — is for a workspace admin, the project's
    -- managers (can_access_project_money), or, for a Legal file's, the Legal
    -- audience (can_access_project_legal). No other reader, no event.
    AND (
      NOT is_financial
      OR public.current_app_role() = 'admin'
      OR COALESCE(public.can_access_project_money(project_id), false)
      OR (public.file_event_is_legal(old_path, new_path)
          AND COALESCE(public.can_access_project_legal(project_id), false))
    )
    -- 0093 (G6, D6) — a viewing from outside the office is a LIVE admin's.
    AND (event <> 'viewed_remote' OR public.is_live_workspace_admin(workspace_id))
    -- 0116, her ruling: a row written while the project was private stays with the people
    -- who could see it then, its creator and the admins, once the project is made public.
    AND (NOT captured_private
         OR public.current_app_role() = 'admin'
         OR EXISTS (SELECT 1 FROM public.projects p
                     WHERE p.id = file_events.project_id AND p.created_by = auth.uid()))
  );

-- §6 COMMENTs ----------------------------------------------------------------------------
COMMENT ON COLUMN public.file_events.captured_private IS
  '0116, her ruling of 2026-11-05 (Keep them hidden): whether the row''s project was private when it was written. Such a row is read only by the project''s creator and the workspace admins, even after the project is made public (file_events_select). Set by trg_file_events_private for every writer, whatever the writer says. DEFAULT true: anything past the trigger fails closed.';
COMMENT ON FUNCTION public.fn_file_events_private_snapshot() IS
  '0116: BEFORE INSERT on file_events. captured_private is the project''s is_private now, or true when the project is gone. It overwrites: it is not the writer''s to say.';
COMMENT ON FUNCTION public.file_events_restamp() IS
  '0116: (re)derives file_events.captured_private for every row from the project''s history (edit_history_value_at), or its live value when its visibility never changed, or true when the project is gone. Returns the rows changed; a second run changes none. Revoked from clients.';
COMMENT ON POLICY file_events_select ON public.file_events IS
  'Track C / 0074 restating 0027, then 0088, 0092, 0093 and 0116: project readers and workspace admins read the stream; a financial row (is_financial — an invoice, receipt or Legal file), its purged certificate INCLUDED, is read only by a workspace admin, the project''s managers (can_access_project_money) or — for a Legal file''s (file_event_is_legal) — the Legal audience (can_access_project_legal); a viewed_remote row (a viewing through the file gateway''s outside door, 0093) only by a LIVE workspace admin (is_live_workspace_admin); a row written while the project was private (captured_private) only by a workspace admin or the project''s creator. Every arm is in this one definition — re-run 0116 after any replay of 0027, 0074, 0088, 0092 or 0093.';

-- §7 Post-conditions ------------------------------------------------------------------------
DO $$
DECLARE
  r      RECORD;
  v_n    INT;
  v_md5  TEXT;
  v_def  TEXT;
  t      TEXT;
BEGIN
  -- Thirteen terms, each once, and one vocabulary.
  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conrelid = 'public.file_events'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%uploaded%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '0116 post-condition: % vocabulary constraints on file_events, expected exactly 1', v_n;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conname = 'file_events_event_check' AND conrelid = 'public.file_events'::regclass;
  IF (SELECT count(*) FROM regexp_matches(COALESCE(v_def, ''), '''([a-z_]+)''::text', 'g')) <> 13 THEN
    RAISE EXCEPTION '0116 post-condition: the vocabulary does not hold 13 terms: %', v_def;
  END IF;
  FOREACH t IN ARRAY ARRAY['uploaded', 'downloaded', 'moved', 'relinked', 'trashed', 'restored', 'purged',
                           'upload_abandoned', 'viewed_remote', 'catalogued', 'moved_out', 'moved_in', 'refiled'] LOOP
    IF (SELECT count(*) FROM regexp_matches(COALESCE(v_def, ''), '''' || t || '''::text', 'g')) <> 1 THEN
      RAISE EXCEPTION '0116 post-condition: the term % is not there once: %', t, v_def;
    END IF;
  END LOOP;

  -- The restated bodies and the policy are this file's.
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.fn_file_events_capture()'::regprocedure)
       IS DISTINCT FROM '01f0368e1db63b4e8844174059b9cb78' THEN
    RAISE EXCEPTION '0116 post-condition: fn_file_events_capture is not this file''s body';
  END IF;
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.fn_realtime_broadcast()'::regprocedure)
       IS DISTINCT FROM '34686e6bbb9ba89ecf012e003856e6da' THEN
    RAISE EXCEPTION '0116 post-condition: fn_realtime_broadcast is not this file''s body';
  END IF;
  SELECT md5(qual) INTO v_md5 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'file_events' AND policyname = 'file_events_select';
  IF v_md5 IS DISTINCT FROM '8a954e2d7e646eacf21ed2303c8617e8' THEN
    RAISE EXCEPTION '0116 post-condition: file_events_select is not this file''s text (md5 %)', v_md5;
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'file_events') <> 1
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'file_events' AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION '0116 post-condition: file_events must keep exactly one policy, SELECT only';
  END IF;

  -- The column fails closed; the trigger is on, before insert, for every row.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'file_events' AND column_name = 'captured_private'
                    AND data_type = 'boolean' AND is_nullable = 'NO' AND column_default = 'true') THEN
    RAISE EXCEPTION '0116 post-condition: file_events.captured_private is missing or mis-shaped (boolean NOT NULL DEFAULT true)';
  END IF;
  IF (SELECT string_agg(tgname, ', ' ORDER BY tgname) FROM pg_trigger
       WHERE tgrelid = 'public.file_events'::regclass AND NOT tgisinternal)
     IS DISTINCT FROM 'trg_file_events_money, trg_file_events_private' THEN
    RAISE EXCEPTION '0116 post-condition: the triggers on file_events are not the two expected';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.file_events'::regclass AND tgname = 'trg_file_events_private'
                    AND tgenabled = 'O'
                    AND pg_get_triggerdef(oid) LIKE '%BEFORE INSERT ON public.file_events%FOR EACH ROW%') THEN
    RAISE EXCEPTION '0116 post-condition: trg_file_events_private is missing, disabled or not BEFORE INSERT FOR EACH ROW';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_file_events_private_snapshot()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_file_events_private_snapshot()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_file_events_capture()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_file_events_capture()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.file_events_restamp()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.file_events_restamp()', 'EXECUTE') THEN
    RAISE EXCEPTION '0116 post-condition: a client may call a trigger function or the restamp';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_file_events_private_snapshot()'::regprocedure)
     OR NOT (SELECT r2.rolbypassrls FROM pg_proc p JOIN pg_roles r2 ON r2.oid = p.proowner WHERE p.oid = 'public.fn_file_events_private_snapshot()'::regprocedure) THEN
    RAISE EXCEPTION '0116 post-condition: fn_file_events_private_snapshot must be a definer whose owner bypasses row security';
  END IF;

  -- The rows already written were walked: a second walk changes none. No writer can land
  -- between the two: this transaction holds ACCESS EXCLUSIVE on file_events since §1.
  v_n := public.file_events_restamp();
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0116 post-condition: the restamp changed % rows on a second run: the rows already written were not walked', v_n;
  END IF;

  RAISE NOTICE '0116 OK: 13 terms, one capture, the broadcast''s early return, a file''s log from a private time stays private';
END $$;
