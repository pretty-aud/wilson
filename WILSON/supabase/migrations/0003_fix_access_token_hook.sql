-- =============================================================================
-- 0003_fix_access_token_hook.sql
-- Hotfix: rename the local user_id variable in custom_access_token_hook to
-- avoid column/variable ambiguity in WHERE clauses. Postgres was resolving
-- `WHERE user_id = custom_access_token_hook.user_id` ambiguously and
-- raising a runtime error during JWT issuance, which manifested as a
-- HTTP 500 on signInWithPassword when the hook was enabled.
--
-- Shape of the patched function is IDENTICAL (same inputs, same claims
-- structure on the JWT); only the internal variable name changed.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims        JSONB;
  uid           UUID;   -- renamed from user_id to avoid column ambiguity
  active_ws     UUID;
  ws_ids        UUID[];
  active_role   TEXT;
  is_operator   BOOLEAN;
BEGIN
  claims := event->'claims';
  uid := (event->>'user_id')::UUID;

  -- Collect all active workspace memberships.
  SELECT COALESCE(ARRAY_AGG(wm.workspace_id ORDER BY wm.created_at), ARRAY[]::UUID[])
    INTO ws_ids
    FROM public.workspace_members wm
   WHERE wm.user_id = uid
     AND wm.is_active;

  -- Active workspace: prefer existing app_metadata value if still valid,
  -- otherwise oldest membership, otherwise null.
  active_ws := NULLIF(claims->'app_metadata'->>'workspace_id', '')::UUID;
  IF active_ws IS NULL OR NOT (active_ws = ANY(ws_ids)) THEN
    active_ws := (SELECT ws_ids[1]);
  END IF;

  -- Role for the active workspace.
  SELECT wm.app_role
    INTO active_role
    FROM public.workspace_members wm
   WHERE wm.user_id = uid
     AND wm.workspace_id = active_ws
     AND wm.is_active;

  -- Platform operator flag.
  SELECT EXISTS (
    SELECT 1 FROM public.platform_operators po
     WHERE po.user_id = uid
  ) INTO is_operator;

  -- Patch app_metadata.
  claims := jsonb_set(
    claims,
    '{app_metadata}',
    COALESCE(claims->'app_metadata', '{}'::JSONB)
      || jsonb_build_object(
           'workspace_id',          active_ws,
           'workspace_ids',         to_jsonb(ws_ids),
           'app_role',              COALESCE(active_role, 'user'),
           'is_platform_operator',  COALESCE(is_operator, false)
         ),
    true
  );

  RETURN jsonb_set(event, '{claims}', claims, true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB) FROM authenticated, anon, public;
