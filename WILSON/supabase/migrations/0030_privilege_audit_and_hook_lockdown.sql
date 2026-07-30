-- =============================================================================
-- 0030_privilege_audit_and_hook_lockdown.sql — Session 17 (release hardening)
--
-- Two release-gating security fixes, both at the database layer.
--
--   1. §6 #42 / TPN-LOG-005 (open CRITICAL) — privilege changes on
--      public.workspace_members are written straight from the browser under
--      the FOR ALL `ws_members_admin_write` policy and NOTHING records them:
--      0012's edit_history entity CHECK deliberately excludes the table, the
--      only triggers on it are guards, and no app_events line is written on
--      that path. "Who granted this person admin, and when" is unanswerable.
--      This is the audit trail for the product's OWN security boundary.
--      Fixed with a SECURITY DEFINER capture trigger on the 0027
--      `fn_file_events_capture` shape.
--
--   2. §6 #44 — public.custom_access_token_hook(jsonb) is executable by
--      `authenticated` AND `anon`. 0001 (:194-195) and 0003 (:77-78) both
--      REVOKE it, but 0011:23's blanket
--      `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public` re-grants it and
--      0011's re-lock pass (:33-43) covers only two other functions. The hook
--      takes its target user id from the caller-supplied `event` argument
--      (0003:29), not auth.uid(), so ANY caller can compute ANY user's full
--      claim set — workspace memberships, app_role, is_platform_operator.
--      Verified live against wilson-dev before this migration: callable as
--      `anon`, i.e. reachable with nothing but the public anon key.
--
-- Idempotent: safe to re-run. Additive — dropping the trigger and re-running
-- 0011 restores the previous behaviour exactly.
--
-- Ordering rule: a MANUAL re-run of 0011 re-widens the hook and must be
-- followed by re-running THIS migration. (Same class as the 0002 → 0029 rule.)
--
-- pgTAP: 38_ws_member_audit.sql
-- =============================================================================


-- ── 1. #44 — re-lock the access-token hook ───────────────────────────────────
--
-- `supabase_auth_admin` is the ONLY legitimate caller: GoTrue invokes the hook
-- at token issuance. Nothing else — no policy, no RPC, no client — references
-- it. Verified in a rolled-back transaction on wilson-dev that this revoke
-- blocks `anon` (42501) while leaving every table read and the auth admin's
-- own grant untouched.

REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB)
  TO supabase_auth_admin;

DO $$
BEGIN
  IF has_function_privilege('authenticated',
       'public.custom_access_token_hook(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.custom_access_token_hook(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION
      '0030 post-condition: custom_access_token_hook is still client-executable';
  END IF;
  IF NOT has_function_privilege('supabase_auth_admin',
       'public.custom_access_token_hook(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION
      '0030 post-condition: supabase_auth_admin lost EXECUTE on the hook — sign-in would break';
  END IF;
END $$;


-- ── 2. #42 — capture privilege changes on workspace_members ──────────────────
--
-- Watches the four fields that ARE the security boundary: app_role,
-- is_active, grant_rate_card_view, grant_rate_card_edit.
--
-- Deliberately NOT every UPDATE: a member editing their own avatar, pronouns
-- or title must not write an audit line. An audit stream that logs everything
-- is one nobody reads, and `app_events` is already the Admin Terminal's user-
-- facing log. Only privilege-relevant transitions land here.
--
-- SECURITY DEFINER is load-bearing twice over: `app_events` is FORCE RLS and
-- its INSERT policy explicitly refuses `event_type = 'admin'` (0021:98-108,
-- so a member cannot mint fake audit lines). The function owner (`postgres`)
-- holds BYPASSRLS, so the trigger writes the reserved stream that no client
-- can forge.

CREATE OR REPLACE FUNCTION public.fn_ws_members_audit_capture()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     public.workspace_members;
  v_actor   UUID;
  v_code    TEXT;
  v_msg     TEXT;
  v_ctx     JSONB;
  v_changed BOOLEAN;
BEGIN
  v_row   := COALESCE(NEW, OLD);
  v_actor := auth.uid();

  IF TG_OP = 'INSERT' THEN
    v_code := 'WIL-4106';
    v_msg  := 'Membership created';
    v_ctx  := jsonb_build_object(
      'target_user_id', NEW.user_id,
      'target_username', left(COALESCE(NEW.username, ''), 128),
      'app_role',       NEW.app_role,
      'is_active',      NEW.is_active,
      'grant_rate_card_view', NEW.grant_rate_card_view,
      'grant_rate_card_edit', NEW.grant_rate_card_edit
    );

  ELSIF TG_OP = 'DELETE' THEN
    v_code := 'WIL-4107';
    v_msg  := 'Membership removed';
    v_ctx  := jsonb_build_object(
      'target_user_id', OLD.user_id,
      'target_username', left(COALESCE(OLD.username, ''), 128),
      'app_role',       OLD.app_role,
      'is_active',      OLD.is_active
    );

  ELSE
    -- UPDATE: only the four privilege-bearing fields are auditable.
    v_changed :=
         OLD.app_role             IS DISTINCT FROM NEW.app_role
      OR OLD.is_active            IS DISTINCT FROM NEW.is_active
      OR OLD.grant_rate_card_view IS DISTINCT FROM NEW.grant_rate_card_view
      OR OLD.grant_rate_card_edit IS DISTINCT FROM NEW.grant_rate_card_edit;

    IF NOT v_changed THEN
      RETURN NULL;   -- profile-only edit: not an audit event
    END IF;

    v_code := 'WIL-4105';
    v_msg  := 'Member privileges changed';
    v_ctx  := jsonb_build_object(
      'target_user_id',  NEW.user_id,
      'target_username', left(COALESCE(NEW.username, ''), 128),
      'app_role',        jsonb_build_object('from', OLD.app_role, 'to', NEW.app_role),
      'is_active',       jsonb_build_object('from', OLD.is_active, 'to', NEW.is_active),
      'grant_rate_card_view',
        jsonb_build_object('from', OLD.grant_rate_card_view, 'to', NEW.grant_rate_card_view),
      'grant_rate_card_edit',
        jsonb_build_object('from', OLD.grant_rate_card_edit, 'to', NEW.grant_rate_card_edit)
    );
  END IF;

  -- `source` lets an operator correlate this backstop row with the
  -- logAdminEvent line an Edge Function writes for the same action. A
  -- service_role write has no auth.uid(), so the actor lands NULL here and
  -- the Edge Function's own row carries the real actor.
  v_ctx := v_ctx || jsonb_build_object(
    'source', 'trigger',
    'db_role', COALESCE(current_setting('role', true), 'unknown')
  );

  INSERT INTO public.app_events
    (workspace_id, actor_user_id, event_type, code, severity, message, context)
  VALUES
    (v_row.workspace_id, v_actor, 'admin', v_code, 'info', v_msg, v_ctx);

  RETURN NULL;

EXCEPTION WHEN OTHERS THEN
  -- An audit failure must never abort the write it audits (the 0012/0027
  -- idiom). This also swallows the expected FK failure during a workspace
  -- CASCADE teardown, where the parent workspaces row is already gone.
  RAISE WARNING 'workspace_members audit capture failed for % : %', TG_OP, SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_ws_members_audit_capture()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ws_members_audit ON public.workspace_members;
CREATE TRIGGER trg_ws_members_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.fn_ws_members_audit_capture();

COMMENT ON FUNCTION public.fn_ws_members_audit_capture() IS
  'TPN-LOG-005 / MASTER_PLAN §6 #42. Append-only capture of privilege changes '
  'on workspace_members into the server-reserved app_events ''admin'' stream. '
  'Fires only when app_role, is_active or a rate-card grant actually changes.';


-- ── 3. Post-conditions ───────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_ws_members_audit'
       AND tgrelid = 'public.workspace_members'::regclass
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '0030 post-condition: trg_ws_members_audit is missing';
  END IF;

  -- The reserved stream must stay unforgeable: if a client-writable INSERT
  -- policy ever admits event_type 'admin', this trigger stops being evidence.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'app_events'
       AND cmd = 'INSERT'
       AND COALESCE(with_check, '') NOT LIKE '%admin%'
  ) THEN
    RAISE EXCEPTION
      '0030 post-condition: app_events INSERT policy no longer reserves the admin stream';
  END IF;
END $$;
