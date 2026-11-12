-- =============================================================================
-- 0018_workspace_channel.sql  (Session 8)
--
-- Workspace-level realtime channel — closes Session 7's known gap: the
-- projects INDEX only updated live for the OPEN project's topic, and the new
-- Dashboard (cross-project "my tasks") had no live signal at all.
--
--   1. public.can_read_workspace_topic(uuid): join-time authorization for
--      'rabbit:workspace:{workspace_id}' topics. Workspace membership ≡
--      visibility — verified against the actual policies: projects_select /
--      tasks_select / workspace_members reads are all workspace-scoped with
--      NO project-staffing gate, so a member authorized on this channel can
--      already SELECT every row the channel will carry. The 0016 invariant
--      ("channel access can never drift from table visibility") holds — with
--      ONE deliberate divergence, pinned by pgTAP 23: the gate includes
--      has_active_membership, so a DEACTIVATED member is denied this channel
--      even though table reads still allow them until Session 9 closes that
--      gap. Stricter-than-SELECT is the safe direction for a live feed.
--   2. public.fn_workspace_realtime_broadcast(): SECURITY DEFINER AFTER
--      trigger — same resilience contract as 0016's fn_realtime_broadcast
--      (catalog probe for db-only CI stacks, catch-all WARNING so a
--      broadcast failure never aborts the write, EXECUTE revoked from all
--      client roles). Attached to:
--        * projects           — index liveness (create/rename/trash/restore)
--        * workspace_members  — roster/profile/avatar liveness
--        * tasks              — Dashboard liveness; SKIPS rows with no
--          assignee_id AND no reviewer_id on either side (nobody's dashboard
--          shows unassigned tasks, and this keeps channel volume down)
--        * assets             — the TRANSITIVE-HIDE path (review finding):
--          trashing/restoring an asset hides/reveals its tasks via the
--          tasks_select live-parent EXISTS without touching any tasks row,
--          so the Dashboard would otherwise never hear about it. UPDATEs
--          broadcast only when deleted_at / name / phase_id changed —
--          sort_order churn (reorders) stays off the channel.
--        * project_members    — role/staffing liveness for the Dashboard's
--          write gating (myProjectRole / projectIsStaffed maps).
--      projects/tasks/assets/project_members rows therefore broadcast to
--      BOTH their project topic (0016) and the workspace topic —
--      intentional; the client-side stale guard / debounced refetch absorbs
--      the double delivery.
--   3. realtime.messages policies for the workspace topic prefix — SELECT
--      for broadcast+presence, INSERT for presence only (clients never send
--      data broadcasts; the trigger is the only writer). Guarded for stacks
--      without the realtime schema.
--
-- The notes/note_subjects tables (0017) are deliberately NOT wired to any
-- broadcast: their content is owner-private, while every subscriber of this
-- channel is merely a workspace member.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ── 1. Join-time authorization ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.can_read_workspace_topic(p_ws UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = public
AS $$
  -- The caller may hear the workspace channel iff it is THEIR workspace and
  -- their membership is active. current_workspace_id() reads the JWT, and
  -- has_active_membership (0008, SECURITY DEFINER) checks is_active — the
  -- same pair every write policy uses, so channel access tracks membership
  -- exactly.
  SELECT p_ws IS NOT NULL
     AND p_ws = public.current_workspace_id()
     AND public.has_active_membership(p_ws);
$$;

-- Policy evaluation runs as the subscriber (authenticated) — it needs
-- EXECUTE, same as can_read_project_topic (0016).
REVOKE EXECUTE ON FUNCTION public.can_read_workspace_topic(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_read_workspace_topic(UUID) TO authenticated;

COMMENT ON FUNCTION public.can_read_workspace_topic IS
  'Session 8: join-time authorization for rabbit:workspace:{id} channels. Membership ≡ visibility — every table this channel broadcasts is workspace-scoped for SELECT with no staffing gate.';

-- ── 2. Broadcast trigger ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_workspace_realtime_broadcast()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row JSONB;
  v_ws  UUID;
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

  -- Dashboard relevance filter: task events with no assignee/reviewer on
  -- either side appear on nobody's dashboard — skip them. (The per-project
  -- topic still carries them for the open project.)
  IF TG_TABLE_NAME = 'tasks'
     AND (to_jsonb(NEW) ->> 'assignee_id') IS NULL
     AND (to_jsonb(NEW) ->> 'reviewer_id') IS NULL
     AND (to_jsonb(OLD) ->> 'assignee_id') IS NULL
     AND (to_jsonb(OLD) ->> 'reviewer_id') IS NULL THEN
    RETURN NULL;
  END IF;

  -- Asset churn filter: only trash/restore (transitive task hide/reveal)
  -- and label changes (name / phase_id feed Dashboard columns + grouping)
  -- matter workspace-wide. Reorders (sort_order) and the rest stay on the
  -- per-project topic only.
  IF TG_TABLE_NAME = 'assets' AND TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) ->> 'deleted_at') IS NOT DISTINCT FROM (to_jsonb(OLD) ->> 'deleted_at')
     AND (to_jsonb(NEW) ->> 'name')       IS NOT DISTINCT FROM (to_jsonb(OLD) ->> 'name')
     AND (to_jsonb(NEW) ->> 'phase_id')   IS NOT DISTINCT FROM (to_jsonb(OLD) ->> 'phase_id') THEN
    RETURN NULL;
  END IF;

  -- All three wired tables carry workspace_id directly.
  v_ws := (v_row ->> 'workspace_id')::uuid;
  IF v_ws IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM realtime.broadcast_changes(
    'rabbit:workspace:' || v_ws::text,  -- topic
    TG_OP,                              -- event name
    TG_OP,                              -- operation
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    NEW,
    OLD
  );

  RETURN NULL;  -- AFTER trigger: return value is ignored
EXCEPTION WHEN OTHERS THEN
  -- Live sync must never break the write. A missed event degrades to the
  -- reconnect refetch path on the client.
  RAISE WARNING 'workspace realtime broadcast failed for %.% (%): %',
    TG_TABLE_NAME, v_row ->> 'id', TG_OP, SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_workspace_realtime_broadcast() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fn_workspace_realtime_broadcast IS
  'Session 8: AFTER trigger publishing projects / workspace_members / assigned-task changes to the rabbit:workspace:{id} topic via realtime.broadcast_changes. Never aborts the write; skips db-only stacks.';

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects', 'workspace_members', 'tasks',
                           'assets', 'project_members']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_ws_realtime ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_ws_realtime
         AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.fn_workspace_realtime_broadcast()',
      t, t);
  END LOOP;
END $$;

-- ── 3. realtime.messages policies (guarded) ─────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'realtime' AND tablename = 'messages'
  ) THEN
    RAISE NOTICE 'realtime.messages absent — workspace channel policies not created (expected in db-only CI stack)';
    RETURN;
  END IF;

  -- Receive: data broadcasts from the DB trigger + presence sync.
  EXECUTE 'DROP POLICY IF EXISTS rabbit_workspace_topic_read ON realtime.messages';
  EXECUTE $pol$
    CREATE POLICY rabbit_workspace_topic_read ON realtime.messages
      FOR SELECT TO authenticated
      USING (
        realtime.messages.extension IN ('broadcast', 'presence')
        AND realtime.topic() LIKE 'rabbit:workspace:%'
        AND public.can_read_workspace_topic(
              public.fn_try_uuid(split_part(realtime.topic(), ':', 3)))
      )
  $pol$;

  -- Send: presence only ("who's online"). Data broadcasts are written by
  -- the SECURITY DEFINER trigger, never by clients — so no broadcast INSERT.
  EXECUTE 'DROP POLICY IF EXISTS rabbit_workspace_topic_presence_write ON realtime.messages';
  EXECUTE $pol$
    CREATE POLICY rabbit_workspace_topic_presence_write ON realtime.messages
      FOR INSERT TO authenticated
      WITH CHECK (
        realtime.messages.extension = 'presence'
        AND realtime.topic() LIKE 'rabbit:workspace:%'
        AND public.can_read_workspace_topic(
              public.fn_try_uuid(split_part(realtime.topic(), ':', 3)))
      )
  $pol$;
END $$;

-- ── 4. Post-condition: the five triggers exist ──────────────────────────────

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects', 'workspace_members', 'tasks',
                           'assets', 'project_members']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = format('trg_%s_ws_realtime', t)
        AND tgrelid = format('public.%s', t)::regclass
    ) THEN
      RAISE EXCEPTION 'workspace realtime post-condition failed: trigger missing on %', t;
    END IF;
  END LOOP;
END $$;
