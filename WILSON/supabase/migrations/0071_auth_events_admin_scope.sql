-- =============================================================================
-- 0071_auth_events_admin_scope.sql — Track B, bundle B2 part 2: narrow the
-- workspace-admin read arm of auth_events_select to what 0070 said it was.
--
-- 0070's arm:
--     workspace_id = current_workspace_id()
--     OR is_member_of_current_workspace(user_id)
-- The second clause was written for HOOK rows — GoTrue's sign_in / mfa_verify
-- rows carry no workspace_id, so "is this person a member of my company" is
-- the only way an admin can be shown them — but it applies to EVERY row. A
-- person who belongs to two companies therefore had their CLIENT rows for
-- company B (sign-in, sign-out, timeouts — with B's address, user agent and
-- surface) readable by the admins of company A. Found while building the
-- Sign-ins view, which had to filter those rows out on screen; the view
-- keeps that filter as belt and braces, this is the braces.
--
-- Now: the membership clause is confined to rows WITHOUT a workspace_id.
--     workspace_id = current_workspace_id()
--     OR (workspace_id IS NULL AND is_member_of_current_workspace(user_id))
-- The documented residual stands unchanged: a two-company person's hook rows
-- (no company, no address) are visible to the admins of both companies,
-- because GoTrue does not know which company a password check was for.
--
-- Operators and the person themself are untouched. Suite 74 pins the new
-- clause with a row tagged with the other company. Idempotent.
-- =============================================================================

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
        OR (workspace_id IS NULL AND public.is_member_of_current_workspace(user_id))
      )
    )
  );

COMMENT ON POLICY auth_events_select ON public.auth_events IS
  '0070/0071: operators read everything; a person reads their own rows; a workspace admin reads rows tagged with their company plus the hook rows (no company) of its members. 0071 confined the membership clause to rows without a workspace_id so another company''s client rows are never in scope.';

-- ── post-condition ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_qual TEXT;
BEGIN
  SELECT qual INTO v_qual
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'auth_events' AND policyname = 'auth_events_select';
  IF v_qual IS NULL THEN
    RAISE EXCEPTION '0071 post-condition: auth_events_select is missing';
  END IF;
  IF v_qual NOT LIKE '%workspace_id IS NULL%' THEN
    RAISE EXCEPTION '0071 post-condition: auth_events_select does not confine the membership clause to hook rows';
  END IF;
  IF has_table_privilege('anon', 'public.auth_events', 'SELECT') THEN
    RAISE EXCEPTION '0071 post-condition: anon can read auth_events';
  END IF;
END $$;
