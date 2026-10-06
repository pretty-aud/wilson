-- =============================================================================
-- 0070_auth_events.sql — Track B, bundle B2: authentication events, written
-- server-side (TPN-LOG-006 / TPN-LOG-007; fix plan answer 23, "log sign-ins").
--
-- MEASURED BEFORE BUILDING (2026-09-06, wilson-dev, role postgres, SELECT on
-- the table allowed): auth.audit_log_entries holds 0 rows next to 1,101
-- auth.sessions and 1,108 refresh tokens; auth.mfa_challenges holds 0 rows
-- next to 1 enrolled factor. Hosted GoTrue does not write its audit stream
-- into the database on this platform (it goes to the platform's log pipeline,
-- outside SQL and outside RLS). The brief's first plan — a READER over
-- auth.audit_log_entries "if the stream is there" — has nothing to read, so
-- this migration builds the WRITER, and the gaps are the whole list:
--
--   sign-in success / failure ....... hook_password_verification_attempt
--                                     GoTrue calls it after EVERY password
--                                     check with {user_id, valid}; the client
--                                     cannot suppress or forge it.
--   MFA success / failure ........... hook_mfa_verification_attempt
--                                     {factor_id, factor_type, user_id, valid}.
--   sign-out, idle timeout, cap ..... the CLIENT inserts through RLS, and a
--   (and its own sign-in row)         trigger stamps every identifying column
--                                     from the caller's own session — the row
--                                     says who the JWT says, never who the
--                                     body says.
--   operator sign-in ................ the same two hooks (operators are
--                                     GoTrue users); operators read every row.
--
-- Addresses. GoTrue hands NEITHER hook the client address, and at password-hook
-- time the session does not exist yet, so hook rows carry no address. Client
-- rows get ip_address and user_agent from auth.sessions through the stamp
-- trigger (measured: 1,108 of 1,108 sessions carry both) — that is why the
-- client writes its own `sign_in` row right after a successful sign-in: it is
-- the row with the address and the company; the hook's `sign_in` row is the
-- one nobody can suppress. Unknown-USERNAME attempts never reach GoTrue (the
-- client signs in with a fake email) and are already in auth_attempt_log
-- (0028), which resolve-login writes.
--
-- 🚨 THE HOOKS NEVER FAIL A SIGN-IN. Every branch returns {"decision":
-- "continue"}; the insert is wrapped so a bad payload, a lost grant or a
-- broken table costs one log row and a WARNING in the Postgres log, never a
-- login. They are logging hooks, not lockout hooks.
--
-- Grants (the #44 / 0030 lesson): 0011's default privileges hand EXECUTE on
-- every new function to anon and authenticated, and ALL on every new table and
-- sequence to anon. Every object below is re-locked, with post-conditions at
-- the end; suite 74 pins them, and suite 35's sweep (no SECURITY DEFINER
-- function in public executable by anon) covers the hooks too.
--
-- Enabling the hooks is a DASHBOARD step per hosted project (Authentication →
-- Hooks → "Password verification attempt" and "MFA verification attempt",
-- Postgres function, schema public): OWED_AUDREY.md §14. Until then the
-- functions exist and are inert; client rows still flow.
--
-- Idempotent: safe to replay.
-- =============================================================================

-- ── 1. The table ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.auth_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- auth.users(id). Deliberately NOT a foreign key: a deleted account must not
  -- take its sign-in history with it.
  user_id       UUID,
  -- The company the session belongs to. Hook rows have none (GoTrue does not
  -- know it); client rows get it from the JWT. SET NULL on teardown keeps the
  -- row and drops the pointer.
  workspace_id  UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  session_id    UUID,
  kind          TEXT NOT NULL CHECK (kind IN
                  ('sign_in', 'mfa_verify', 'sign_out', 'idle_timeout', 'session_cap')),
  outcome       TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  source        TEXT NOT NULL CHECK (source IN ('gotrue_hook', 'client')),
  factor_type   TEXT CHECK (factor_type IS NULL OR char_length(factor_type) <= 32),
  ip_address    INET,
  user_agent    TEXT CHECK (user_agent IS NULL OR char_length(user_agent) <= 512),
  context       JSONB NOT NULL DEFAULT '{}'::jsonb
                  CHECK (char_length(context::text) <= 2000),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.auth_events IS
  'Track B B2 (0070): sign-in, MFA, sign-out, idle-timeout and session-cap events. Hook rows (source gotrue_hook) are written by GoTrue through the two verification hooks; client rows are stamped from the caller''s own session by trg_auth_events_stamp. Append-only for clients; purge_auth_events() is the only delete.';

CREATE INDEX IF NOT EXISTS auth_events_user_time_idx
  ON public.auth_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_events_ws_time_idx
  ON public.auth_events (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_events_time_idx
  ON public.auth_events (created_at DESC);

ALTER TABLE public.auth_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_events FORCE ROW LEVEL SECURITY;

-- 0011 defaults: ALL to anon / authenticated / service_role on the table and
-- its identity sequence. Re-lock. authenticated keeps SELECT + INSERT (the
-- policies decide the rows); no UPDATE / DELETE grant, and no policy for them.
REVOKE ALL ON TABLE public.auth_events FROM PUBLIC, anon;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.auth_events FROM authenticated;
GRANT  SELECT, INSERT ON TABLE public.auth_events TO authenticated;
GRANT  ALL ON TABLE public.auth_events TO service_role;
REVOKE ALL ON SEQUENCE public.auth_events_id_seq FROM PUBLIC, anon;
GRANT  USAGE ON SEQUENCE public.auth_events_id_seq TO authenticated, service_role;

-- ── 2. Membership helper for the read policy ─────────────────────────────────
-- "Is this user a member of the caller's workspace?" — asked by the SELECT
-- policy for hook rows, which carry no workspace_id. SECURITY DEFINER because
-- workspace_members is itself under RLS and a policy subquery runs as the
-- querying role (the 0008 recursion lesson; same shape as
-- has_active_membership). Discloses nothing a member cannot already see
-- through workspace_directory().

CREATE OR REPLACE FUNCTION public.is_member_of_current_workspace(p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.workspace_members wm
     WHERE wm.workspace_id = public.current_workspace_id()
       AND wm.user_id = p_user
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_member_of_current_workspace(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_member_of_current_workspace(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.is_member_of_current_workspace(UUID) IS
  '0070: TRUE when p_user is a member of the caller''s JWT workspace. Read by the auth_events SELECT policy for hook rows, which carry no workspace_id.';

-- ── 3. Policies ──────────────────────────────────────────────────────────────
-- Read: an operator reads everything; a person reads their own rows; a
-- workspace ADMIN reads rows tagged with their workspace and hook rows of
-- anyone who is a member of it. That last clause is the brief's design
-- ("scoped to the caller's workspace members, join on workspace_members
-- .user_id") and its residual: a person who belongs to two companies has
-- their password-hook rows visible to the admins of BOTH, because GoTrue does
-- not know which company a password check was for. Recorded in
-- SYSTEMS_HANDBOOK §17.

DROP POLICY IF EXISTS auth_events_select ON public.auth_events;
CREATE POLICY auth_events_select ON public.auth_events
  FOR SELECT USING (
    public.is_platform_operator()
    OR user_id = auth.uid()
    OR (
      public.current_app_role() = 'admin'
      AND public.has_active_membership(public.current_workspace_id())
      AND (
        workspace_id = public.current_workspace_id()
        OR public.is_member_of_current_workspace(user_id)
      )
    )
  );

-- Write (client rows only): the row is about the caller — the stamp trigger
-- below has already overwritten user_id, workspace_id, session_id,
-- ip_address, user_agent and created_at from the JWT and auth.sessions by the
-- time this check runs (WITH CHECK sees the row AFTER BEFORE triggers), so the
-- body cannot name anyone else. Only client kinds and only successes: a client
-- cannot write a gotrue_hook row or a failure — failures are the hooks' to
-- record.
DROP POLICY IF EXISTS auth_events_insert ON public.auth_events;
CREATE POLICY auth_events_insert ON public.auth_events
  FOR INSERT WITH CHECK (
    source = 'client'
    AND user_id = auth.uid()
    AND kind IN ('sign_in', 'sign_out', 'idle_timeout', 'session_cap')
    AND outcome = 'success'
    AND (workspace_id IS NULL OR public.has_active_membership(workspace_id))
  );
-- No UPDATE or DELETE policy: append-only for every client role.

-- ── 4. Stamp trigger for client rows ─────────────────────────────────────────
-- Runs as postgres (SECURITY DEFINER) so it can read auth.sessions for the
-- address and user agent. Only a PostgREST client role is stamped; the hooks
-- (GoTrue connects as supabase_auth_admin, no SET ROLE) and service_role pass
-- through with the columns they wrote.

CREATE OR REPLACE FUNCTION public.fn_auth_events_stamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claims  JSONB;
  v_session UUID;
BEGIN
  IF COALESCE(current_setting('role', true), '') <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  NEW.source       := 'client';
  NEW.user_id      := auth.uid();
  NEW.workspace_id := public.current_workspace_id();
  NEW.created_at   := now();
  NEW.session_id   := NULL;
  NEW.ip_address   := NULL;
  NEW.user_agent   := NULL;

  BEGIN
    v_claims  := current_setting('request.jwt.claims', true)::jsonb;
    v_session := NULLIF(v_claims ->> 'session_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_session := NULL;
  END;
  NEW.session_id := v_session;

  IF v_session IS NOT NULL THEN
    SELECT s.ip, left(s.user_agent, 512)
      INTO NEW.ip_address, NEW.user_agent
      FROM auth.sessions s
     WHERE s.id = v_session
       AND s.user_id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_auth_events_stamp() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_auth_events_stamp ON public.auth_events;
CREATE TRIGGER trg_auth_events_stamp
  BEFORE INSERT ON public.auth_events
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auth_events_stamp();

-- ── 5. The GoTrue hooks ──────────────────────────────────────────────────────
-- Contract (Supabase Auth Hooks, read 2026-09-06): input {user_id, valid} /
-- {factor_id, factor_type, user_id, valid}; output {"decision": "continue" |
-- "reject"}. Always "continue" here. SECURITY DEFINER so the insert runs as
-- postgres (BYPASSRLS on this platform, measured — the same mechanism 0030's
-- audit trigger relies on); supabase_auth_admin holds no privilege on the
-- table itself. A payload without a user id logs nothing: a row about nobody
-- is noise, and GoTrue only calls these hooks for an existing account.

CREATE OR REPLACE FUNCTION public.hook_password_verification_attempt(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user  UUID;
  v_valid BOOLEAN;
BEGIN
  BEGIN
    v_user  := NULLIF(event ->> 'user_id', '')::uuid;
    v_valid := COALESCE((event ->> 'valid')::boolean, false);
    IF v_user IS NOT NULL THEN
      INSERT INTO public.auth_events (user_id, kind, outcome, source)
      VALUES (v_user, 'sign_in',
              CASE WHEN v_valid THEN 'success' ELSE 'failure' END,
              'gotrue_hook');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'hook_password_verification_attempt could not log: % (sign-in continues)', SQLERRM;
  END;
  RETURN jsonb_build_object('decision', 'continue');
END;
$$;

CREATE OR REPLACE FUNCTION public.hook_mfa_verification_attempt(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user   UUID;
  v_valid  BOOLEAN;
  v_factor TEXT;
BEGIN
  BEGIN
    v_user   := NULLIF(event ->> 'user_id', '')::uuid;
    v_valid  := COALESCE((event ->> 'valid')::boolean, false);
    v_factor := left(NULLIF(event ->> 'factor_type', ''), 32);
    IF v_user IS NOT NULL THEN
      INSERT INTO public.auth_events (user_id, kind, outcome, source, factor_type, context)
      VALUES (v_user, 'mfa_verify',
              CASE WHEN v_valid THEN 'success' ELSE 'failure' END,
              'gotrue_hook', v_factor,
              jsonb_strip_nulls(jsonb_build_object('factor_id', event ->> 'factor_id')));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'hook_mfa_verification_attempt could not log: % (verification continues)', SQLERRM;
  END;
  RETURN jsonb_build_object('decision', 'continue');
END;
$$;

GRANT USAGE ON SCHEMA public TO supabase_auth_admin;

REVOKE EXECUTE ON FUNCTION public.hook_password_verification_attempt(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.hook_password_verification_attempt(JSONB)
  TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.hook_mfa_verification_attempt(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.hook_mfa_verification_attempt(JSONB)
  TO supabase_auth_admin;

COMMENT ON FUNCTION public.hook_password_verification_attempt(JSONB) IS
  '0070: Supabase password-verification hook. Logs a sign_in success/failure row to auth_events and ALWAYS returns {"decision":"continue"}. Enable per project in the dashboard (Authentication → Hooks). Executable by supabase_auth_admin only.';
COMMENT ON FUNCTION public.hook_mfa_verification_attempt(JSONB) IS
  '0070: Supabase MFA-verification hook. Logs an mfa_verify success/failure row to auth_events and ALWAYS returns {"decision":"continue"}. Enable per project in the dashboard (Authentication → Hooks). Executable by supabase_auth_admin only.';

-- ── 6. Retention ─────────────────────────────────────────────────────────────
-- 400 days: a year of sign-in history with margin, the figure TPN asks for on
-- security logs. Nothing calls this yet; the operator console or a cron job
-- can, as service_role.

CREATE OR REPLACE FUNCTION public.purge_auth_events(p_keep INTERVAL DEFAULT INTERVAL '400 days')
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted BIGINT;
BEGIN
  DELETE FROM public.auth_events
   WHERE created_at < now() - p_keep;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_auth_events(INTERVAL) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_auth_events(INTERVAL) TO service_role;

-- ── 7. Post-conditions ───────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'auth_events'
       AND c.relrowsecurity AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION '0070 post-condition: auth_events is not under FORCE ROW LEVEL SECURITY';
  END IF;

  IF has_table_privilege('anon', 'public.auth_events', 'SELECT')
     OR has_table_privilege('anon', 'public.auth_events', 'INSERT')
     OR has_table_privilege('anon', 'public.auth_events', 'UPDATE')
     OR has_table_privilege('anon', 'public.auth_events', 'DELETE') THEN
    RAISE EXCEPTION '0070 post-condition: anon holds a privilege on auth_events';
  END IF;

  IF has_table_privilege('authenticated', 'public.auth_events', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.auth_events', 'DELETE') THEN
    RAISE EXCEPTION '0070 post-condition: authenticated can update or delete auth_events';
  END IF;

  IF has_function_privilege('anon',          'public.hook_password_verification_attempt(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.hook_password_verification_attempt(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.hook_mfa_verification_attempt(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.hook_mfa_verification_attempt(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '0070 post-condition: a client role can execute an auth hook (#44 again)';
  END IF;

  IF NOT has_function_privilege('supabase_auth_admin', 'public.hook_password_verification_attempt(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('supabase_auth_admin', 'public.hook_mfa_verification_attempt(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '0070 post-condition: supabase_auth_admin cannot execute an auth hook — enabling it in the dashboard would break sign-in';
  END IF;

  IF has_function_privilege('anon', 'public.is_member_of_current_workspace(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.purge_auth_events(interval)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.purge_auth_events(interval)', 'EXECUTE') THEN
    RAISE EXCEPTION '0070 post-condition: anon or authenticated reaches a definer helper it must not';
  END IF;
END $$;
