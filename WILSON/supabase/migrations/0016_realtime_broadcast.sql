-- =============================================================================
-- 0016_realtime_broadcast.sql
-- Session 7 — Realtime live sync via broadcast-from-database.
--
-- WHY BROADCAST AND NOT postgres_changes (the Session 1 scaffolding's shape):
-- Realtime's postgres_changes authorizes each event by evaluating the
-- SUBSCRIBER's SELECT policy against the NEW row of every UPDATE. Under the
-- 0014 soft-delete policies, setting deleted_at makes the NEW row invisible,
-- so the one event other clients need most — "this row was just trashed" —
-- is withheld from every collaborator. Restores would flow but deletes never
-- would. This is the Session 6 load-bearing lesson (SELECT policies apply to
-- both sides of an UPDATE) resurfacing on the realtime path. DELETE events
-- under postgres_changes are also PK-only. broadcast_changes sidesteps all
-- of it: a DB trigger publishes full old/new rows to a topic, and channel
-- authorization happens ONCE at join via RLS on realtime.messages instead of
-- per-event per-subscriber.
--
-- Three pieces:
--   1. public.fn_realtime_broadcast() — one generic AFTER I/U/D trigger on
--      the 10 project-scoped tables. Resolves the row's project, then calls
--      realtime.broadcast_changes('rabbit:project:' || project_id, ...).
--      Same resilience contract as fn_edit_history_capture (0012): a
--      broadcast failure NEVER aborts the user's write (WARNING + continue),
--      and environments without the realtime schema (db-only CI stacks) are
--      skipped via a catalog existence check.
--   2. public.can_read_project_topic() + public.fn_try_uuid() — the join-time
--      authorization for the private channel. SECURITY INVOKER on purpose:
--      the check is simply "can the caller SELECT this project row", so the
--      projects_select policy (workspace match + deleted_at IS NULL, FORCE
--      RLS) is the single source of truth and the channel gate can never
--      drift from table visibility. Consequences, both accepted:
--        * a soft-deleted project's topic denies (re)joins while trashed —
--          a subscriber who stays joined still hears the restore, but one
--          whose token refreshed during the trashed window misses it and
--          catches up on the next open/refetch;
--        * the S9 deferred "deactivated member with a live token" gap
--          applies here exactly as it does to table reads — realtime is
--          deliberately no stricter and no looser than SELECT.
--   3. RLS policies on realtime.messages — SELECT for broadcast+presence
--      (receive), INSERT for presence only (clients announce who's viewing;
--      they never send data broadcasts — the DB trigger is the only writer).
--      Guarded: skipped where the realtime schema doesn't exist.
--
-- No publication or REPLICA IDENTITY changes: broadcast_changes reads
-- trigger NEW/OLD, not the WAL.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ── 1a. topic authorization helpers ──────────────────────────────────────────

-- Safe uuid parse for policy input derived from the topic string. Anything
-- unparseable (a hand-crafted topic) becomes NULL, which the authz helper
-- rejects — never a cast error that would bubble out of the policy.
CREATE OR REPLACE FUNCTION public.fn_try_uuid(p TEXT)
RETURNS UUID
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  RETURN p::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_read_project_topic(p_project UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = public
AS $$
  -- SECURITY INVOKER: the EXISTS runs under the caller's own RLS, so
  -- projects_select (workspace match + live row, FORCE) IS the check.
  -- "Can hear the channel" ≡ "can read the project" — see header.
  SELECT p_project IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.projects p WHERE p.id = p_project
     );
$$;

-- Policy evaluation runs as the subscriber (authenticated) — it needs
-- EXECUTE, unlike the 0013 helpers that only run inside entity policies.
REVOKE EXECUTE ON FUNCTION public.fn_try_uuid(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_try_uuid(TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.can_read_project_topic(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_read_project_topic(UUID) TO authenticated;

-- ── 1b. broadcast trigger ─────────────────────────────────────────────────────
-- SECURITY DEFINER for two reasons: the parent joins below must resolve even
-- when the writing role can't see the parent (e.g. cascade paths), and the
-- realtime.messages insert inside broadcast_changes must not depend on the
-- client role's grants.
CREATE OR REPLACE FUNCTION public.fn_realtime_broadcast()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     JSONB;
  v_project UUID;
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

  CASE TG_TABLE_NAME
    WHEN 'projects' THEN
      v_project := (v_row ->> 'id')::uuid;
    WHEN 'phases', 'assets', 'tasks', 'files', 'project_members' THEN
      v_project := (v_row ->> 'project_id')::uuid;
    WHEN 'comments' THEN
      v_project := public.fn_comment_project_id(
        v_row ->> 'entity_type', (v_row ->> 'entity_id')::uuid);
    WHEN 'task_dependencies' THEN
      SELECT t.project_id INTO v_project FROM public.tasks t
       WHERE t.id = (v_row ->> 'predecessor_id')::uuid;
    WHEN 'task_links' THEN
      SELECT t.project_id INTO v_project FROM public.tasks t
       WHERE t.id = (v_row ->> 'task_id')::uuid;
    WHEN 'asset_versions' THEN
      SELECT a.project_id INTO v_project FROM public.assets a
       WHERE a.id = (v_row ->> 'asset_id')::uuid;
    ELSE
      v_project := NULL;
  END CASE;

  -- Unroutable (cascade delete with the parent already gone, dead-end
  -- comment walk): skip. The subtree's own parent event already told
  -- clients everything they need.
  IF v_project IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM realtime.broadcast_changes(
    'rabbit:project:' || v_project::text,  -- topic
    TG_OP,                                 -- event name
    TG_OP,                                 -- operation
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    NEW,
    OLD
  );

  RETURN NULL;  -- AFTER trigger: return value is ignored
EXCEPTION WHEN OTHERS THEN
  -- Live sync must never break the write. A missed event degrades to the
  -- reconnect refetch path on the client.
  RAISE WARNING 'realtime broadcast failed for %.% (%): %',
    TG_TABLE_NAME, v_row ->> 'id', TG_OP, SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_realtime_broadcast() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects','phases','assets','tasks','files',
                           'comments','task_dependencies','task_links',
                           'asset_versions','project_members']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_realtime ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_realtime
         AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.fn_realtime_broadcast()',
      t, t);
  END LOOP;
END $$;

-- ── 2. realtime.messages policies (private channel authorization) ────────────
-- realtime.messages ships with RLS enabled and no policies — private
-- channels deny everyone until policies exist. Guarded for db-only stacks.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'realtime' AND tablename = 'messages'
  ) THEN
    RAISE NOTICE 'realtime.messages absent — channel policies not created (expected in db-only CI stack)';
    RETURN;
  END IF;

  -- Receive: data broadcasts from the DB trigger + presence sync.
  EXECUTE 'DROP POLICY IF EXISTS rabbit_project_topic_read ON realtime.messages';
  EXECUTE $pol$
    CREATE POLICY rabbit_project_topic_read ON realtime.messages
      FOR SELECT TO authenticated
      USING (
        realtime.messages.extension IN ('broadcast', 'presence')
        AND realtime.topic() LIKE 'rabbit:project:%'
        AND public.can_read_project_topic(
              public.fn_try_uuid(split_part(realtime.topic(), ':', 3)))
      )
  $pol$;

  -- Send: presence only ("who's viewing"). Data broadcasts are written by
  -- the SECURITY DEFINER trigger, never by clients — so no broadcast INSERT.
  EXECUTE 'DROP POLICY IF EXISTS rabbit_project_topic_presence_write ON realtime.messages';
  EXECUTE $pol$
    CREATE POLICY rabbit_project_topic_presence_write ON realtime.messages
      FOR INSERT TO authenticated
      WITH CHECK (
        realtime.messages.extension = 'presence'
        AND realtime.topic() LIKE 'rabbit:project:%'
        AND public.can_read_project_topic(
              public.fn_try_uuid(split_part(realtime.topic(), ':', 3)))
      )
  $pol$;
END $$;

COMMENT ON FUNCTION public.fn_realtime_broadcast() IS
  'Session 7: publishes every write on the 10 project-scoped RABBIT tables to the private topic rabbit:project:{project_id} via realtime.broadcast_changes. Full old/new rows — soft deletes and restores deliver, unlike postgres_changes under the 0014 SELECT policies. Never aborts the write.';
COMMENT ON FUNCTION public.can_read_project_topic(UUID) IS
  'Session 7: join-time authorization for rabbit:project:{id} channels. SECURITY INVOKER — the caller''s projects_select policy is the whole check, so channel access always equals table visibility.';
