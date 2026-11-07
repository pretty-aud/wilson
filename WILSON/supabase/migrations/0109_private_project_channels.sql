-- =============================================================================
-- 0109_private_project_channels.sql — M.O.T.H. Session 1 (MO1), the privacy
-- repairs, part C (docs/design/MOTH_DESIGN.md §1.4 "0109" and §2.6 R9 and
-- R10).
--
-- WHAT IS WRONG TODAY (read on wilson-dev with pg_get_functiondef, 2026-11-02:
-- the three bodies restated here are 0018's, 0098's (md5 e5abdcf2…) and
-- 0101's, word for word)
-- -------------------------------------------------------------------------
-- (1) The workspace channel carries private rows. fn_workspace_realtime_
--     broadcast (0018) puts every projects, tasks, assets and project_members
--     write on rabbit:workspace:{ws}, and that topic's join gate
--     (can_read_workspace_topic) is membership only: a private project's
--     creation, its title, its assigned tasks, its asset names and its seats
--     reach every member of the workspace.
-- (2) A move between projects hands one side's row to the other side's
--     audience. fn_realtime_broadcast (0098) routes a write by NEW's project
--     only, with OLD in the payload: a task moved out of private P into
--     public Q reaches Q's topic carrying its P-era row. On the workspace
--     topic, a move into a private project sends the private side.
-- (3) A subscriber who joined before a narrowing keeps hearing the project:
--     the project topic's name never changes, and Realtime judges the join,
--     not each message.
--
-- WHAT THIS FILE DOES
-- -------------------
--   §1  project_topic(uuid) (DEFINER, revoked from clients): the project's
--       topic, 'rabbit:project:{id}' at epoch 0 and 'rabbit:project:{id}:{n}'
--       after its n-th narrowing (0107's topic_epoch), NULL when the project
--       is gone. project_topic_matches(text) (INVOKER, authenticated): true
--       when the topic names a project the caller can see under RLS, at that
--       project's current epoch (R10).
--   §2  0016's two realtime.messages policies, restated inside a guarded DO
--       with AND project_topic_matches(realtime.topic()): a stale epoch's
--       topic can no longer be joined.
--   §3  fn_workspace_realtime_broadcast: 0018's body restated (R9). Each side
--       of the write is judged first, fail-closed: a workspace_members side
--       always goes out, a projects side only when it is not private, a
--       tasks, assets or project_members side only when its project exists
--       and is not private. A projects UPDATE whose two sides differ sends
--       one payload-free AUDIENCE and nothing else. A change with one side
--       visible goes INSERT-shaped (NEW only) or DELETE-shaped (OLD only).
--       The assignee filter and the asset churn filter then test only the
--       sides that are sent.
--   §4  fn_realtime_broadcast: 0098's body restated (R10). Every arm is kept,
--       the files money test first and comments through fn_comment_project_id;
--       a dependency routes only when both endpoints share a project. Each
--       side's project is resolved: a change of project sends a DELETE-shaped
--       event (OLD) to the old project's topic and an INSERT-shaped one (NEW)
--       to the new one's. Topics come from project_topic(); the projects arm
--       reads its own row's topic_epoch, and a narrowing sends a payload-free
--       AUDIENCE to the old topic and the UPDATE to the new one.
--   §5  fn_budget_versions_broadcast: 0101's body with its topic from
--       project_topic() (a project already gone: nothing is sent).
--   §6  COMMENTs restated, EXECUTE revoked again; §7 post-conditions.
--
-- 🚨 0098 is NOT re-runnable after this file: its pre-flight accepts only
-- 0096's and its own fn_realtime_broadcast, so it refuses (put 0096's body back
-- first, then 0098, then THIS file). Re-run THIS file after any replay of 0016,
-- 0018, 0098 or 0101.
-- Channel behaviour cannot be proved on a db-only stack (no realtime schema):
-- suite 112 is environment-tolerant, like suite 23, and the bite is the
-- rolled-back rehearsal on wilson-dev (the hand-off records its planted
-- controls). The client (the epoch in the project channel's name, AUDIENCE on
-- both channels) ships in the same commit and tolerates a server without
-- this file. One transaction, no enum. Suite:
-- supabase/tests/rls/112_private_project_channels.sql.
-- =============================================================================

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
DECLARE
  v_md5 TEXT;
BEGIN
  IF to_regprocedure('public.edit_history_restamp()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'topic_epoch') THEN
    RAISE EXCEPTION '0109 refused: 0107 (projects.topic_epoch) or 0108 (edit_history_restamp) is not applied';
  END IF;
  IF to_regprocedure('public.fn_workspace_realtime_broadcast()') IS NULL
     OR to_regprocedure('public.fn_budget_versions_broadcast()') IS NULL
     OR to_regprocedure('public.fn_task_items_ws_broadcast()') IS NULL
     OR to_regprocedure('public.can_read_project_topic(uuid)') IS NULL
     OR to_regprocedure('public.can_read_workspace_topic(uuid)') IS NULL
     OR to_regprocedure('public.fn_comment_project_id(text, uuid)') IS NULL
     OR to_regprocedure('public.file_row_is_money(boolean, text)') IS NULL
     OR to_regprocedure('public.fn_try_uuid(text)') IS NULL THEN
    RAISE EXCEPTION '0109 refused: a function it restates or calls is missing (0016, 0018, 0088, 0101)';
  END IF;
  -- fn_realtime_broadcast is 0098's body (no later file restated it) or this
  -- file's own (a re-run) — compared by an md5 of the source, CRs removed.
  SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5
    FROM pg_proc WHERE oid = 'public.fn_realtime_broadcast()'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'e5abdcf2b8abce914416acb148144971'   -- 0098's body
     AND v_md5 IS DISTINCT FROM 'cb26163e64f063de4da39c4eb316de4b' THEN                -- this file's (§4)
    RAISE EXCEPTION '0109 pre-flight failed: fn_realtime_broadcast is neither 0098''s body nor this file''s (md5 %) — a later migration restated it, and restating it here would take that change back', v_md5;
  END IF;
END $$;

-- §1 The project topic and its join test (R10) -------------------------------------
CREATE OR REPLACE FUNCTION public.project_topic(p_project uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'rabbit:project:' || p.id::text
         || CASE WHEN p.topic_epoch > 0 THEN ':' || p.topic_epoch::text ELSE '' END
    FROM public.projects p
   WHERE p.id = p_project;
$$;

REVOKE ALL ON FUNCTION public.project_topic(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_topic(uuid) TO service_role;

-- SECURITY INVOKER: the EXISTS runs under the caller's own projects_select, as
-- can_read_project_topic does, so "can join the topic" stays "can read the
-- project", and the epoch must be the project's current one.
CREATE OR REPLACE FUNCTION public.project_topic_matches(p_topic text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(
           split_part(p_topic, ':', 1) = 'rabbit'
       AND split_part(p_topic, ':', 2) = 'project'
       AND split_part(p_topic, ':', 5) = ''
       AND EXISTS (
             SELECT 1 FROM public.projects p
              WHERE p.id = public.fn_try_uuid(split_part(p_topic, ':', 3))
                AND split_part(p_topic, ':', 4)
                    = CASE WHEN p.topic_epoch > 0 THEN p.topic_epoch::text ELSE '' END),
         false);
$$;

REVOKE ALL ON FUNCTION public.project_topic_matches(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_topic_matches(text) TO authenticated;

-- §2 The project topic's realtime.messages policies (0016, restated) ---------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'realtime' AND tablename = 'messages'
  ) THEN
    RAISE NOTICE '0109: realtime.messages absent — the project-topic policies are not restated (expected in db-only CI stack)';
    RETURN;
  END IF;

  -- Receive: data broadcasts from the DB triggers + presence sync, on a topic
  -- whose epoch is the project's current one.
  EXECUTE 'DROP POLICY IF EXISTS rabbit_project_topic_read ON realtime.messages';
  EXECUTE $pol$
    CREATE POLICY rabbit_project_topic_read ON realtime.messages
      FOR SELECT TO authenticated
      USING (
        realtime.messages.extension IN ('broadcast', 'presence')
        AND realtime.topic() LIKE 'rabbit:project:%'
        AND public.can_read_project_topic(
              public.fn_try_uuid(split_part(realtime.topic(), ':', 3)))
        AND public.project_topic_matches(realtime.topic())
      )
  $pol$;

  -- Send: presence only ("who's viewing"). Data broadcasts are written by
  -- the SECURITY DEFINER triggers, never by clients — so no broadcast INSERT.
  EXECUTE 'DROP POLICY IF EXISTS rabbit_project_topic_presence_write ON realtime.messages';
  EXECUTE $pol$
    CREATE POLICY rabbit_project_topic_presence_write ON realtime.messages
      FOR INSERT TO authenticated
      WITH CHECK (
        realtime.messages.extension = 'presence'
        AND realtime.topic() LIKE 'rabbit:project:%'
        AND public.can_read_project_topic(
              public.fn_try_uuid(split_part(realtime.topic(), ':', 3)))
        AND public.project_topic_matches(realtime.topic())
      )
  $pol$;
END $$;

-- §3 The workspace channel: only what every member may see (R9) ------------------
CREATE OR REPLACE FUNCTION public.fn_workspace_realtime_broadcast()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row   JSONB;
  v_ws    UUID;
  v_new   JSONB;
  v_old   JSONB;
  v_sn    BOOLEAN;  -- NEW may reach every member of the workspace
  v_so    BOOLEAN;  -- OLD may reach every member of the workspace
  v_shape TEXT;     -- the event sent: TG_OP, or 'INSERT' (NEW only) / 'DELETE' (OLD only)
  v_tn    BOOLEAN;  -- NEW is in the event
  v_to    BOOLEAN;  -- OLD is in the event
BEGIN
  -- Environments without the realtime schema (db-only CI stack) skip
  -- silently. Cheap catalog probe; the EXCEPTION guard below is the backstop.
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

  -- All five wired tables carry workspace_id directly.
  v_ws := (v_row ->> 'workspace_id')::uuid;
  IF v_ws IS NULL THEN
    RETURN NULL;
  END IF;

  -- 0109: the side flags, before any filter, and fail-closed. Every member
  -- of the workspace hears this topic, so a side goes out only when every
  -- member may see it: a workspace_members row always; a projects row when
  -- it is not private; a tasks, assets or project_members row when its
  -- project exists and is not private (read now, after the write).
  IF TG_TABLE_NAME = 'workspace_members' THEN
    v_sn := v_new IS NOT NULL;
    v_so := v_old IS NOT NULL;
  ELSIF TG_TABLE_NAME = 'projects' THEN
    v_sn := v_new IS NOT NULL AND NOT COALESCE((v_new ->> 'is_private')::boolean, true);
    v_so := v_old IS NOT NULL AND NOT COALESCE((v_old ->> 'is_private')::boolean, true);
  ELSIF TG_TABLE_NAME IN ('tasks', 'assets', 'project_members') THEN
    v_sn := v_new IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.projects p
               WHERE p.id = (v_new ->> 'project_id')::uuid AND NOT p.is_private);
    v_so := v_old IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.projects p
               WHERE p.id = (v_old ->> 'project_id')::uuid AND NOT p.is_private);
  ELSE
    RETURN NULL;
  END IF;

  -- A projects UPDATE that changes who may see the project tells every
  -- member that something changed, and nothing else: no id, no title. Each
  -- client learns the truth from its own read, through RLS.
  IF TG_TABLE_NAME = 'projects' AND TG_OP = 'UPDATE' AND v_sn IS DISTINCT FROM v_so THEN
    PERFORM realtime.send(
      jsonb_build_object('table', 'projects', 'schema', 'public', 'operation', 'AUDIENCE',
                         'record', NULL, 'old_record', NULL),
      'AUDIENCE',
      'rabbit:workspace:' || v_ws::text,
      true
    );
    RETURN NULL;
  END IF;

  -- The shape: the write itself when every side it has may go out; a change
  -- with one side visible is downgraded to that side alone; none: nothing.
  v_shape := CASE
               WHEN (v_sn OR v_new IS NULL) AND (v_so OR v_old IS NULL) THEN TG_OP
               WHEN v_sn THEN 'INSERT'
               WHEN v_so THEN 'DELETE'
             END;
  IF v_shape IS NULL THEN
    RETURN NULL;
  END IF;
  v_tn := v_shape IN ('INSERT', 'UPDATE');
  v_to := v_shape IN ('UPDATE', 'DELETE');

  -- Dashboard relevance filter: task events with no assignee/reviewer on
  -- any side that is SENT appear on nobody's dashboard — skip them. (The
  -- per-project topic still carries them for the open project.)
  IF TG_TABLE_NAME = 'tasks'
     AND NOT (v_tn AND ((v_new ->> 'assignee_id') IS NOT NULL OR (v_new ->> 'reviewer_id') IS NOT NULL))
     AND NOT (v_to AND ((v_old ->> 'assignee_id') IS NOT NULL OR (v_old ->> 'reviewer_id') IS NOT NULL)) THEN
    RETURN NULL;
  END IF;

  -- Asset churn filter: only trash/restore (transitive task hide/reveal)
  -- and label changes (name / phase_id feed Dashboard columns + grouping)
  -- matter workspace-wide. Reorders (sort_order) and the rest stay on the
  -- per-project topic only. Only a both-sides UPDATE is churn: a one-sided
  -- change is an asset arriving or leaving.
  IF TG_TABLE_NAME = 'assets' AND v_shape = 'UPDATE'
     AND (v_new ->> 'deleted_at') IS NOT DISTINCT FROM (v_old ->> 'deleted_at')
     AND (v_new ->> 'name')       IS NOT DISTINCT FROM (v_old ->> 'name')
     AND (v_new ->> 'phase_id')   IS NOT DISTINCT FROM (v_old ->> 'phase_id') THEN
    RETURN NULL;
  END IF;

  IF v_shape = TG_OP THEN
    PERFORM realtime.broadcast_changes(
      'rabbit:workspace:' || v_ws::text,  -- topic
      TG_OP,                              -- event name
      TG_OP,                              -- operation
      TG_TABLE_NAME,
      TG_TABLE_SCHEMA,
      NEW,
      OLD
    );
  ELSE
    -- Downgraded: broadcast_changes' payload shape, the visible side only.
    PERFORM realtime.send(
      jsonb_build_object('old_record', CASE WHEN v_to THEN v_old END,
                         'record', CASE WHEN v_tn THEN v_new END,
                         'operation', v_shape, 'table', TG_TABLE_NAME, 'schema', TG_TABLE_SCHEMA),
      v_shape,
      'rabbit:workspace:' || v_ws::text,
      true
    );
  END IF;

  RETURN NULL;  -- AFTER trigger: return value is ignored
EXCEPTION WHEN OTHERS THEN
  -- Live sync must never break the write. A missed event degrades to the
  -- reconnect refetch path on the client.
  RAISE WARNING 'workspace realtime broadcast failed for %.% (%): %',
    TG_TABLE_NAME, v_row ->> 'id', TG_OP, SQLERRM;
  RETURN NULL;
END;
$$;

-- §4 The project topic: each side to its own project, at its epoch (R10) -----------
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

-- §5 The bid version's thin event, on the project's current topic (0101) ----------
CREATE OR REPLACE FUNCTION public.fn_budget_versions_broadcast()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new     JSONB;
  v_old     JSONB;
  v_project UUID;
  v_topic   TEXT;
BEGIN
  -- A stack without realtime.send (CI's) skips. The EXCEPTION guard below is
  -- the backstop.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'realtime' AND p.proname = 'send'
  ) THEN
    RETURN NULL;
  END IF;

  -- The version's id and project, and nothing else: never its snapshot, its
  -- name, its summary or its stamps (a bid version is money; see the header).
  IF TG_OP <> 'DELETE' THEN
    v_new := jsonb_build_object('id', NEW.id, 'project_id', NEW.project_id);
    v_project := NEW.project_id;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    v_old := jsonb_build_object('id', OLD.id, 'project_id', OLD.project_id);
    v_project := COALESCE(v_project, OLD.project_id);
  END IF;
  IF v_project IS NULL THEN
    RETURN NULL;
  END IF;
  -- 0109: the project's topic at its current epoch; a project already gone
  -- has none.
  v_topic := public.project_topic(v_project);
  IF v_topic IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM realtime.send(
    jsonb_build_object('table', TG_TABLE_NAME, 'schema', TG_TABLE_SCHEMA,
                       'operation', TG_OP, 'record', v_new, 'old_record', v_old),
    TG_OP,                                   -- the event the client listens for
    v_topic,                                 -- topic (0109: project_topic)
    true                                     -- private: 0016's join gate decides
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Live sync must never break the write. A missed event degrades to the
  -- next load (or the next pointer change's versions-refetch).
  RAISE WARNING 'bid version broadcast failed (%): %', TG_OP, SQLERRM;
  RETURN NULL;
END;
$$;

-- §6 Grants and COMMENTs ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.fn_workspace_realtime_broadcast() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_realtime_broadcast() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_budget_versions_broadcast() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.project_topic(uuid) IS
  '0109 (MO1): the project''s realtime topic: rabbit:project:{id} at topic_epoch 0, rabbit:project:{id}:{n} after its n-th narrowing (0107 bumps the epoch); NULL when the project is gone. SECURITY DEFINER, revoked from clients: the broadcast triggers'' router.';
COMMENT ON FUNCTION public.project_topic_matches(text) IS
  '0109 (MO1): join-time test for rabbit:project:{id}[:{n}] channels: a project the caller can see under RLS (projects_select) has that id, and the topic carries its CURRENT epoch (none at 0, digits after). A listener who joined before a narrowing cannot join the old topic again, and the triggers no longer write to it. SECURITY INVOKER, granted to authenticated.';
COMMENT ON FUNCTION public.fn_workspace_realtime_broadcast() IS
  'Session 8; 0109 (MO1): AFTER trigger publishing projects / workspace_members / tasks / assets / project_members changes to the rabbit:workspace:{id} topic. A side goes out only when every member may see it (a projects row not private; a child row whose project is not private; workspace_members always): a one-sided change goes INSERT- or DELETE-shaped with that side alone, a projects visibility flip sends one payload-free AUDIENCE, and the assignee and churn filters test only the sides sent. Never aborts the write; skips db-only stacks.';
COMMENT ON FUNCTION public.can_read_workspace_topic(uuid) IS
  'Session 8; 0109 (MO1): join-time authorization for rabbit:workspace:{id} channels: an active member of the workspace. Membership is NOT visibility since 0072 (private projects): fn_workspace_realtime_broadcast sends only rows every member may see, and an AUDIENCE event when a project''s visibility flips.';
COMMENT ON FUNCTION public.fn_realtime_broadcast() IS
  'Session 7 (0016); 0109 (MO1): publishes every write on the project-scoped RABBIT tables to the project''s private topic, project_topic(id) (rabbit:project:{id}, :{epoch} after a narrowing). Full old/new rows — soft deletes and restores deliver, unlike postgres_changes under the 0014 SELECT policies. A change of project sends OLD as a DELETE to the old project''s topic and NEW as an INSERT to the new one''s; a dependency across projects goes to neither; a narrowing sends a payload-free AUDIENCE to the old topic. Never aborts the write. EIGHTEEN tables as of 0098: projects, phases, assets, tasks, files (0088: money rows excluded), comments, task_dependencies, phase_dependencies (0061), task_links, asset_versions, project_members, milestones (0077), bins, bin_files, shot_takes (0091), task_items (0096), table_views, item_groupings (0098).';
COMMENT ON FUNCTION public.fn_budget_versions_broadcast() IS
  '0101 (R1, S5-02); 0109 (MO1): AFTER trigger on budget_versions. Sends the project''s topic (project_topic) a thin event in broadcast_changes'' shape — table, schema, operation, and record / old_record cut to {id, project_id} — never the row: a bid version is money (0037''s can_access_project_money) and the project channel is every reader''s. A window past the money gate reads the versions again. Never aborts the write; skips a stack without realtime.send.';

-- §7 Post-conditions ------------------------------------------------------------------
DO $$
DECLARE
  v_b   TEXT;
  v_t   TEXT;
  v_n   INTEGER;
BEGIN
  -- 1. The workspace broadcast, comments stripped and whitespace collapsed:
  --    the privacy test, AUDIENCE from literals only, the side flags before
  --    the assignee filter.
  SELECT btrim(regexp_replace(regexp_replace(regexp_replace(prosrc, '/\*.*?\*/', '', 'g'),
                                             '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_b FROM pg_proc WHERE oid = 'public.fn_workspace_realtime_broadcast()'::regprocedure;
  IF strpos(v_b, 'is_private') = 0 OR strpos(v_b, '''rabbit:workspace:''') = 0
     OR strpos(v_b, 'jsonb_build_object(''table'', ''projects'', ''schema'', ''public'', ''operation'', ''AUDIENCE'', ''record'', NULL, ''old_record'', NULL), ''AUDIENCE''') = 0 THEN
    RAISE EXCEPTION '0109 post-condition 1 failed: the workspace broadcast lacks its privacy test, its topic or its literal AUDIENCE payload';
  END IF;
  IF strpos(v_b, 'v_sn :=') = 0 OR strpos(v_b, 'v_sn :=') > strpos(v_b, 'assignee_id') THEN
    RAISE EXCEPTION '0109 post-condition 1 failed: the workspace broadcast must judge its sides before the assignee filter';
  END IF;
  IF strpos(v_b, 'EXCEPTION WHEN OTHERS') = 0 THEN
    RAISE EXCEPTION '0109 post-condition 1 failed: the workspace broadcast lost its EXCEPTION guard';
  END IF;

  -- 2. fn_realtime_broadcast: this file's body (the pre-flight's md5), the
  --    topic router, the per-side comparison, every 0098 table and the files
  --    money test on both sides.
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc
       WHERE oid = 'public.fn_realtime_broadcast()'::regprocedure) IS DISTINCT FROM 'cb26163e64f063de4da39c4eb316de4b' THEN
    RAISE EXCEPTION '0109 post-condition 2 failed: §4''s body is not the one §0 names (update §0''s md5)';
  END IF;
  SELECT btrim(regexp_replace(regexp_replace(regexp_replace(prosrc, '/\*.*?\*/', '', 'g'),
                                             '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_b FROM pg_proc WHERE oid = 'public.fn_realtime_broadcast()'::regprocedure;
  IF strpos(v_b, 'public.project_topic(') = 0 OR strpos(v_b, 'realtime.send(') = 0
     OR strpos(v_b, 'v_pn IS NOT DISTINCT FROM v_po') = 0
     OR strpos(v_b, 'public.file_row_is_money((to_jsonb(NEW) ->> ''is_financial'')::boolean') = 0
     OR strpos(v_b, 'public.file_row_is_money((to_jsonb(OLD) ->> ''is_financial'')::boolean') = 0 THEN
    RAISE EXCEPTION '0109 post-condition 2 failed: fn_realtime_broadcast lacks the topic router, the side comparison or the files money test';
  END IF;
  FOREACH v_t IN ARRAY ARRAY['projects', 'phases', 'assets', 'tasks', 'files', 'comments', 'task_dependencies',
                             'phase_dependencies', 'task_links', 'asset_versions', 'project_members', 'milestones',
                             'bins', 'bin_files', 'shot_takes', 'task_items', 'table_views', 'item_groupings'] LOOP
    IF strpos(v_b, '''' || v_t || '''') = 0 THEN
      RAISE EXCEPTION '0109 post-condition 2 failed: fn_realtime_broadcast lost 0098''s arm for %', v_t;
    END IF;
  END LOOP;

  -- 3. The bid version sender: the project's topic, never a whole row.
  SELECT btrim(regexp_replace(regexp_replace(regexp_replace(prosrc, '/\*.*?\*/', '', 'g'),
                                             '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_b FROM pg_proc WHERE oid = 'public.fn_budget_versions_broadcast()'::regprocedure;
  IF strpos(v_b, 'public.project_topic(v_project)') = 0 OR strpos(v_b, 'broadcast_changes') > 0
     OR strpos(v_b, 'to_jsonb(NEW)') > 0 THEN
    RAISE EXCEPTION '0109 post-condition 3 failed: fn_budget_versions_broadcast must route by project_topic and never send a whole row';
  END IF;

  -- 4. Both project-topic policies test the epoch (where realtime.messages exists).
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM pg_policies
     WHERE schemaname = 'realtime' AND tablename = 'messages'
       AND policyname IN ('rabbit_project_topic_read', 'rabbit_project_topic_presence_write')
       AND COALESCE(qual, with_check) LIKE '%project_topic_matches(realtime.topic())%';
    IF v_n <> 2 THEN
      RAISE EXCEPTION '0109 post-condition 4 failed: % of the two project-topic policies name project_topic_matches', v_n;
    END IF;
  END IF;

  -- 5. The five workspace triggers, unchanged; the items' own still reads privacy.
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE NOT tgisinternal AND tgenabled <> 'D'
     AND tgfoid = 'public.fn_workspace_realtime_broadcast()'::regprocedure
     AND (tgname, tgrelid) IN (('trg_projects_ws_realtime', 'public.projects'::regclass),
                               ('trg_workspace_members_ws_realtime', 'public.workspace_members'::regclass),
                               ('trg_tasks_ws_realtime', 'public.tasks'::regclass),
                               ('trg_assets_ws_realtime', 'public.assets'::regclass),
                               ('trg_project_members_ws_realtime', 'public.project_members'::regclass));
  IF v_n <> 5 THEN
    RAISE EXCEPTION '0109 post-condition 5 failed: % of the five workspace broadcast triggers are in place', v_n;
  END IF;
  IF strpos((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_task_items_ws_broadcast()'::regprocedure), 'is_private') = 0 THEN
    RAISE EXCEPTION '0109 post-condition 5 failed: fn_task_items_ws_broadcast no longer reads the project''s privacy';
  END IF;

  -- 6. No client runs a definer; the join test is the caller's.
  IF has_function_privilege('anon', 'public.project_topic(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.project_topic(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_workspace_realtime_broadcast()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_workspace_realtime_broadcast()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_realtime_broadcast()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_realtime_broadcast()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_budget_versions_broadcast()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_budget_versions_broadcast()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.project_topic_matches(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.project_topic_matches(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '0109 post-condition 6 failed: a client may run a broadcast definer or project_topic, or authenticated cannot run project_topic_matches';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.project_topic(uuid)'::regprocedure
                  AND prosecdef AND provolatile = 's' AND proconfig @> ARRAY['search_path=public'])
     OR EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.project_topic_matches(text)'::regprocedure AND prosecdef) THEN
    RAISE EXCEPTION '0109 post-condition 6 failed: project_topic must be STABLE SECURITY DEFINER with search_path pinned, project_topic_matches SECURITY INVOKER';
  END IF;

  -- 7. The money rule (0101): no trigger on budget_versions publishes whole rows.
  IF EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
     WHERE tg.tgrelid = 'public.budget_versions'::regclass AND NOT tg.tgisinternal
       AND p.proname IN ('fn_realtime_broadcast', 'fn_workspace_realtime_broadcast')
  ) THEN
    RAISE EXCEPTION '0109 post-condition 7 failed: budget_versions has a whole-row broadcast trigger — a bid version is money';
  END IF;
END $$;

DO $$ BEGIN
  RAISE NOTICE '0109 OK: the workspace channel carries only what every member may see (AUDIENCE on a visibility flip); a move between projects sends each side to its own project''s topic; topics carry the project''s epoch and the join gate tests it';
END $$;
