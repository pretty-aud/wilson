-- =============================================================================
-- 0101_versions_and_items_realtime.sql — R1, night 2 of
-- docs/sessions/PLAN_TO_1_0.md (2026-10-27).
--
-- Two broadcasts that were missing, each a small trigger of its own:
--
--   1. S5-02 · bid versions were not broadcast. budget_versions (0037) never
--      joined the project channel, so a version saved, made or deleted in one
--      window reached another only when that window reloaded the project (the
--      project row's pointers did arrive: S5b's versions-refetch). A bid
--      version is MONEY: its rows are read past can_access_project_money only
--      (0037), and rabbit:project:{id} is joined by every reader of the
--      project (can_read_project_topic, 0016). So its rows never ride that
--      channel, which is why budget_versions does NOT join
--      fn_realtime_broadcast's arms (they publish whole rows).
--      fn_budget_versions_broadcast sends a thin event instead, in the shape
--      realtime.broadcast_changes sends (table, schema, operation, record,
--      old_record), each record cut to the version's id and project. A window
--      past the money gate reads the versions again through RLS (the client's
--      versions-refetch); any other reader learns only that the project's
--      versions changed, as the project row's version pointers already tell it.
--   2. The Dashboard showed a task's assets as of its last load. A task's
--      items (0096) broadcast on the project channel only; the Dashboard hears
--      the workspace channel (0018), where the FIRST item showed (the older
--      apps' copy on tasks changes the task row) and a second never did.
--      fn_task_items_ws_broadcast puts an item's write on rabbit:workspace:{ws}
--      when its task is assigned (an assignee or a reviewer: 0018's tasks
--      filter, since nobody's Dashboard shows the rest) and its project is NOT
--      private. The workspace channel is joined by every active member, and a
--      private project (0072) is hidden from members who are not on it: the
--      🚨 entry in docs/OUTSTANDING.md ("The workspace realtime channel
--      broadcasts a PRIVATE project's rows to every member") is not widened.
--      A private project's items reach its own members' Dashboards at their
--      next load, as before. The rows are 0096's whole rows (ids and a
--      position, no names), as broadcast_changes sends every row there.
--
-- Neither generic body is restated: fn_realtime_broadcast stays 0098's (md5
-- e5abdcf2…, held by 101_table_views probe 18 and 100_no_main_item probe 7)
-- and fn_workspace_realtime_broadcast 0018's, so the suites holding their
-- trigger sets (72, 99, 101, 23) are unchanged. Suite 104 holds this file.
--
-- Same resilience contract as 0016 and 0018: SECURITY DEFINER with the
-- search_path pinned (the task and project reads below must resolve whoever
-- writes), a catalog probe that skips a stack without the realtime functions
-- (rls.yml starts CI's stack without realtime), and a catch-all WARNING so a
-- broadcast failure never aborts the write. EXECUTE revoked from every
-- client role.
--
-- ORDERING: depends on 0016 (can_read_project_topic and the project topic's
-- policies), 0018 (can_read_workspace_topic and the workspace topic's
-- policies), 0037 (budget_versions), 0072 (projects.is_private), 0096
-- (task_items). Nothing depends on it yet. Idempotent: safe to re-run.
-- =============================================================================

-- =============================================================================
-- 0. PRE-FLIGHT
-- =============================================================================
DO $$
BEGIN
  IF to_regclass('public.budget_versions') IS NULL THEN
    RAISE EXCEPTION '0101 pre-flight failed: public.budget_versions is missing — apply 0037 first';
  END IF;
  IF to_regclass('public.task_items') IS NULL THEN
    RAISE EXCEPTION '0101 pre-flight failed: public.task_items is missing — apply 0096 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'is_private') THEN
    RAISE EXCEPTION '0101 pre-flight failed: projects.is_private is missing — apply 0072 first';
  END IF;
  IF to_regprocedure('public.can_read_project_topic(uuid)') IS NULL
     OR to_regprocedure('public.can_read_workspace_topic(uuid)') IS NULL THEN
    RAISE EXCEPTION '0101 pre-flight failed: the topic gates are missing — apply 0016 and 0018 first';
  END IF;
END $$;


-- =============================================================================
-- 1. budget_versions → the project channel, a thin event (S5-02)
-- =============================================================================
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

  PERFORM realtime.send(
    jsonb_build_object('table', TG_TABLE_NAME, 'schema', TG_TABLE_SCHEMA,
                       'operation', TG_OP, 'record', v_new, 'old_record', v_old),
    TG_OP,                                   -- the event the client listens for
    'rabbit:project:' || v_project::text,    -- topic
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

REVOKE EXECUTE ON FUNCTION public.fn_budget_versions_broadcast() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_budget_versions_realtime ON public.budget_versions;
CREATE TRIGGER trg_budget_versions_realtime
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_versions
  FOR EACH ROW EXECUTE FUNCTION public.fn_budget_versions_broadcast();

COMMENT ON FUNCTION public.fn_budget_versions_broadcast() IS
  '0101 (R1, S5-02): AFTER trigger on budget_versions. Sends rabbit:project:{project_id} a thin event in broadcast_changes'' shape — table, schema, operation, and record / old_record cut to {id, project_id} — never the row: a bid version is money (0037''s can_access_project_money) and the project channel is every reader''s. A window past the money gate reads the versions again. Never aborts the write; skips a stack without realtime.send.';


-- =============================================================================
-- 2. task_items → the workspace channel, for the Dashboard
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_task_items_ws_broadcast()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     JSONB;
  v_ws      UUID;
  v_task    UUID;
  v_project UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'realtime' AND p.proname = 'broadcast_changes'
  ) THEN
    RETURN NULL;
  END IF;

  -- PG14+: the unassigned side of NEW/OLD reads as NULL in row triggers.
  v_row     := COALESCE(to_jsonb(NEW), to_jsonb(OLD));
  v_ws      := (v_row ->> 'workspace_id')::uuid;
  v_task    := (v_row ->> 'task_id')::uuid;
  v_project := (v_row ->> 'project_id')::uuid;
  IF v_ws IS NULL OR v_task IS NULL OR v_project IS NULL THEN
    RETURN NULL;
  END IF;

  -- Nobody's Dashboard shows a task with neither an assignee nor a reviewer
  -- (0018's tasks filter). An item going with its task's own delete finds no
  -- task here: the task's event says so.
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks t
     WHERE t.id = v_task
       AND (t.assignee_id IS NOT NULL OR t.reviewer_id IS NOT NULL)
  ) THEN
    RETURN NULL;
  END IF;

  -- Never a private project's (0072): the workspace channel is every active
  -- member's, and a private project hides from members who are not on it.
  -- A project gone (a cascade) is skipped the same way.
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = v_project AND NOT p.is_private
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM realtime.broadcast_changes(
    'rabbit:workspace:' || v_ws::text,   -- topic
    TG_OP,                               -- event name
    TG_OP,                               -- operation
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    NEW,
    OLD
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'task item workspace broadcast failed for % (%): %',
    v_row ->> 'id', TG_OP, SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_task_items_ws_broadcast() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_task_items_ws_realtime ON public.task_items;
CREATE TRIGGER trg_task_items_ws_realtime
  AFTER INSERT OR UPDATE OR DELETE ON public.task_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_task_items_ws_broadcast();

COMMENT ON FUNCTION public.fn_task_items_ws_broadcast() IS
  '0101 (R1): AFTER trigger on task_items. Puts an item''s write on rabbit:workspace:{workspace_id} (realtime.broadcast_changes, the whole 0096 row: ids and a position) when its task has an assignee or a reviewer and its project is not private (0072): the Dashboard''s My tasks hears a task''s second item at once. Never aborts the write; skips a stack without realtime.';


-- =============================================================================
-- 3. POST-CONDITIONS — read the catalogue back
-- =============================================================================
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('public.budget_versions'::regclass, 'trg_budget_versions_realtime', 'fn_budget_versions_broadcast'),
      ('public.task_items'::regclass,      'trg_task_items_ws_realtime',   'fn_task_items_ws_broadcast')
    ) AS v(rel, trg, fn)
  LOOP
    -- tgtype: 1 ROW, 2 BEFORE, 4 INSERT, 8 DELETE, 16 UPDATE.
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
       WHERE tg.tgrelid = t.rel AND tg.tgname = t.trg AND p.proname = t.fn
         AND tg.tgenabled <> 'D'
         AND (tg.tgtype & 1) = 1 AND (tg.tgtype & 2) = 0
         AND (tg.tgtype & 4) = 4 AND (tg.tgtype & 8) = 8 AND (tg.tgtype & 16) = 16
    ) THEN
      RAISE EXCEPTION '0101 post-condition failed: % is not an enabled AFTER INSERT OR UPDATE OR DELETE row trigger on % running %', t.trg, t.rel, t.fn;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = t.fn AND p.prosecdef
         AND 'search_path=public' = ANY (p.proconfig)
    ) THEN
      RAISE EXCEPTION '0101 post-condition failed: % is not SECURITY DEFINER with search_path=public', t.fn;
    END IF;
    IF has_function_privilege('anon', format('public.%I()', t.fn), 'EXECUTE')
       OR has_function_privilege('authenticated', format('public.%I()', t.fn), 'EXECUTE') THEN
      RAISE EXCEPTION '0101 post-condition failed: a client role may execute %', t.fn;
    END IF;
  END LOOP;

  -- 🚨 The money rule: no trigger on budget_versions runs a function that
  -- publishes whole rows.
  IF EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
     WHERE tg.tgrelid = 'public.budget_versions'::regclass AND NOT tg.tgisinternal
       AND p.proname IN ('fn_realtime_broadcast', 'fn_workspace_realtime_broadcast')
  ) THEN
    RAISE EXCEPTION '0101 post-condition failed: budget_versions has a whole-row broadcast trigger — a bid version is money';
  END IF;
END $$;

DO $$ BEGIN
  RAISE NOTICE '0101 OK: budget_versions sends a thin event on its project''s channel; task_items of an assigned task in a public project reach the workspace channel; fn_realtime_broadcast and fn_workspace_realtime_broadcast untouched';
END $$;
