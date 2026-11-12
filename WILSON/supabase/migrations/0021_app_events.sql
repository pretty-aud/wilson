-- =============================================================================
-- 0021_app_events.sql — Session 9 (Logs & diagnostics + directory grants)
--
--   1. app_events — the Admin Terminal's log stream and the error-code
--      system's sink. Client-written (unlike edit_history, which only
--      triggers write), so RLS is ENABLE + FORCE per the 0004 convention:
--        * INSERT: any ACTIVE member, own workspace only; actor_user_id and
--          actor_label are stamped server-side by a BEFORE INSERT trigger so
--          rows can never impersonate;
--        * SELECT: workspace admins only (has_active_membership guarded);
--        * no UPDATE/DELETE policies — append-only; retention is the purge
--          function below (90 days, same locked window as edit_history).
--      Codes follow the WIL-#### registry in src/cloud/errorCodes.js.
--      TPN note: message/context must not carry customer content — the
--      client-side reporter enforces this by only sending registry messages
--      plus technical context (codes, table names, status strings).
--
--   2. purge_app_events() + pg_cron 'wilson-purge-app-events' 04:51 UTC
--      (0012 pattern: guarded so a missing pg_cron can never fail CI).
--
--   3. workspace_directory() learns the Session 9 grant columns — the Admin
--      Terminal renders rate-access chips from the same roster call. The
--      return type changes, so this is a DROP + CREATE (with the 0009/0011
--      REVOKE/GRANT re-asserted).
--
-- pgTAP: 25_app_events.sql (and 24 re-probes the directory shape).
-- Idempotent: safe to re-run.
-- =============================================================================

-- ── 1. app_events ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.app_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- No FK on actor (0007 convention): NULL for system writes, and rows must
  -- survive the actor's auth.users row disappearing.
  actor_user_id UUID,
  -- Captured at write time so the log stays readable after a member leaves.
  actor_label   TEXT,
  event_type    TEXT NOT NULL CHECK (event_type IN
                  ('auth', 'admin', 'error', 'system', 'update', 'storage', 'realtime')),
  code          TEXT CHECK (code IS NULL OR code ~ '^WIL-[0-9]{4}$'),
  severity      TEXT NOT NULL DEFAULT 'info' CHECK (severity IN
                  ('info', 'warning', 'error', 'critical')),
  message       TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  context       JSONB NOT NULL DEFAULT '{}'::jsonb
                  CHECK (char_length(context::text) <= 8000),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_events_ws_time_idx
  ON public.app_events (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS app_events_ws_type_time_idx
  ON public.app_events (workspace_id, event_type, created_at DESC);

ALTER TABLE public.app_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_events FORCE ROW LEVEL SECURITY;

-- Server-side stamp: the actor is always the caller, never client-supplied.
-- SECURITY DEFINER so the label lookup reads workspace_members regardless of
-- the caller's SELECT visibility.
CREATE OR REPLACE FUNCTION public.fn_app_events_stamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    -- Edge Functions may write on behalf of an actor; trust their stamp but
    -- fill the label when they left it out.
    IF NEW.actor_user_id IS NOT NULL AND NEW.actor_label IS NULL THEN
      SELECT COALESCE(wm.display_name, wm.username) INTO NEW.actor_label
        FROM public.workspace_members wm
       WHERE wm.workspace_id = NEW.workspace_id
         AND wm.user_id = NEW.actor_user_id;
    END IF;
    RETURN NEW;
  END IF;
  NEW.actor_user_id := auth.uid();
  SELECT COALESCE(wm.display_name, wm.username) INTO NEW.actor_label
    FROM public.workspace_members wm
   WHERE wm.workspace_id = NEW.workspace_id
     AND wm.user_id = auth.uid();
  NEW.created_at := now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_app_events_stamp() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_app_events_stamp ON public.app_events;
CREATE TRIGGER trg_app_events_stamp
  BEFORE INSERT ON public.app_events
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_app_events_stamp();

DROP POLICY IF EXISTS app_events_insert ON public.app_events;
CREATE POLICY app_events_insert ON public.app_events
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    -- The 'admin' stream + WIL-41xx codes are reserved for server-stamped
    -- Edge Function writes (service_role has BYPASSRLS): without this a
    -- plain member could mint fake "User deactivated" audit lines.
    AND event_type <> 'admin'
    AND (code IS NULL OR code !~ '^WIL-41')
  );

DROP POLICY IF EXISTS app_events_select ON public.app_events;
CREATE POLICY app_events_select ON public.app_events
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.current_app_role() = 'admin'
    AND public.has_active_membership(workspace_id)
  );

-- Append-only: deliberately no UPDATE/DELETE policies.

-- ── 2. Retention ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.purge_app_events(p_keep INTERVAL DEFAULT INTERVAL '90 days')
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted BIGINT;
BEGIN
  DELETE FROM public.app_events
   WHERE created_at < now() - p_keep;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_app_events(INTERVAL) FROM PUBLIC, authenticated, anon;
GRANT  EXECUTE ON FUNCTION public.purge_app_events(INTERVAL) TO service_role;

-- Schedule nightly where pg_cron exists (hosted envs). The CI local stack
-- ships without pg_cron; a scheduling hiccup must never fail the migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule(
      'wilson-purge-app-events',
      '51 4 * * *',
      $job$ SELECT public.purge_app_events(); $job$
    );
  ELSE
    RAISE NOTICE 'pg_cron unavailable — app_events purge not scheduled (expected in CI local stack)';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'could not schedule app_events purge via pg_cron: %', SQLERRM;
END $$;

-- ── 3. workspace_directory() with grant columns ──────────────────────────────
-- Return type changes → DROP + CREATE. Body matches 0010 (row-derived caller
-- role, email visibility admin/manager-or-self) with the two grant columns
-- appended LAST so existing consumers are undisturbed.

DROP FUNCTION IF EXISTS public.workspace_directory();

CREATE FUNCTION public.workspace_directory()
RETURNS TABLE (
  workspace_id UUID,
  user_id      UUID,
  app_role     TEXT,
  username     TEXT,
  display_name TEXT,
  pronouns     TEXT,
  title        TEXT,
  department   TEXT,
  avatar_url   TEXT,
  is_active    BOOLEAN,
  onboarded_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ,
  email        TEXT,
  grant_rate_card_view BOOLEAN,
  grant_rate_card_edit BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_ws   UUID := public.current_workspace_id();
  v_role TEXT;
BEGIN
  -- Membership + role from the LIVE row, not the JWT (SECURITY DEFINER
  -- bypasses RLS, so the function re-checks itself — 0010 convention).
  SELECT wm.app_role INTO v_role
    FROM public.workspace_members wm
   WHERE wm.workspace_id = v_ws
     AND wm.user_id = v_uid
     AND wm.is_active;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'not_a_workspace_member';
  END IF;

  RETURN QUERY
  SELECT wm.workspace_id,
         wm.user_id,
         wm.app_role,
         wm.username,
         wm.display_name,
         wm.pronouns,
         wm.title,
         wm.department,
         wm.avatar_url,
         wm.is_active,
         wm.onboarded_at,
         wm.created_at,
         CASE
           WHEN v_role IN ('admin', 'manager') OR wm.user_id = v_uid
           THEN au.email::TEXT
           ELSE NULL
         END AS email,
         wm.grant_rate_card_view,
         wm.grant_rate_card_edit
    FROM public.workspace_members wm
    LEFT JOIN auth.users au ON au.id = wm.user_id
   WHERE wm.workspace_id = v_ws
   ORDER BY wm.created_at ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.workspace_directory() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.workspace_directory() TO authenticated, service_role;

-- ── 4. Post-conditions ───────────────────────────────────────────────────────

DO $$
DECLARE
  v_forced BOOLEAN;
BEGIN
  SELECT relforcerowsecurity INTO v_forced
    FROM pg_class WHERE oid = 'public.app_events'::regclass;
  IF NOT COALESCE(v_forced, false) THEN
    RAISE EXCEPTION '0021 post-condition failed: app_events RLS not FORCEd';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'app_events'
       AND policyname = 'app_events_select'
  ) THEN
    RAISE EXCEPTION '0021 post-condition failed: app_events_select missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'app_events'
       AND cmd IN ('UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION '0021 post-condition failed: app_events must stay append-only';
  END IF;
  IF to_regprocedure('public.workspace_directory()') IS NULL THEN
    RAISE EXCEPTION '0021 post-condition failed: workspace_directory missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc pr
     WHERE pr.proname = 'workspace_directory'
       AND pg_get_function_result(pr.oid) LIKE '%grant_rate_card_edit%'
  ) THEN
    RAISE EXCEPTION '0021 post-condition failed: workspace_directory lacks grant columns';
  END IF;
END $$;

COMMENT ON TABLE public.app_events IS
  'Append-only app/admin/error event log (Session 9). Written by active members (actor stamped server-side) and Edge Functions; read by workspace admins; purged after 90 days by purge_app_events().';
