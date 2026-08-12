-- =============================================================================
-- 0060_restore_directory_grant_columns.sql
--
-- 0059 DROPped and re-CREATEd public.workspace_directory() to add
-- is_full_time, and in rebuilding the explicit RETURNS TABLE list it did not
-- carry over two columns that had been there since 0021:
--
--     grant_rate_card_view  BOOLEAN
--     grant_rate_card_edit  BOOLEAN
--
-- MEASURED on wilson-dev, 2026-08-12:
--   workspace_members         has grant_rate_card_view, grant_rate_card_edit
--   workspace_directory()     RETURNS TABLE (… 14 cols …) — neither present
--
-- 0059's own header warned about exactly this: "a column the function does not
-- name is INVISIBLE to every client no matter how correct the table is." The
-- warning was written, and then the rebuild dropped two columns anyway. When a
-- migration re-creates a function with an explicit column list, the risk is not
-- only the column you are ADDING — it is every column already there.
--
-- HOW IT WAS FOUND, because the route matters more than the bug:
-- pgTAP suite 24_admin_grants.sql has asserted this contract since Session 9:
--
--     SELECT ok((SELECT d.grant_rate_card_edit FROM public.workspace_directory() d …),
--               'workspace_directory returns the grant columns');
--
-- It failed the moment 0059 landed — `column d.grant_rate_card_edit does not
-- exist` — and kept failing on every run for two days. The suite did its job
-- perfectly. What hid it was the CI step meant to explain failures: it emitted
-- an annotation for EVERY replayed file including passing ones, and GitHub caps
-- annotations at 10 per step, so the whole budget was spent reporting that
-- files 01-10 were fine. Fixed separately in .github/workflows/rls.yml.
--
-- IMPACT — narrower than it first looks, and worth stating precisely:
--   * Rate-card permission ENFORCEMENT is unaffected. useRateCardAccess.js
--     reads the columns straight off the table
--     (`.from('workspace_members').select('grant_rate_card_view, …')`),
--     not through this RPC. Nobody gained or lost access.
--   * Anything reading the grants from the DIRECTORY sees undefined, which
--     coerces to false — e.g. UsersSection.jsx's `!!member.grant_rate_card_view`
--     toggles in the Admin Terminal read OFF for everyone, whatever the table
--     says. A display/state lie, not a privilege escalation.
--
-- Restores both columns and keeps is_full_time. Column ORDER follows 0021 —
-- the two grants last, after email — so the shape matches what every client
-- built against before 0059.
--
-- 🚨 DROP + CREATE, not CREATE OR REPLACE: changing a RETURNS TABLE list
-- raises 42P13 otherwise. Both statements run in this migration's single
-- transaction, so no client observes the function missing.
--
-- Idempotent: safe to re-run.
-- pgTAP: 24_admin_grants.sql (the assertion that caught it), 16_member_directory.sql,
--        67_member_full_time.sql.
-- =============================================================================

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
  is_full_time BOOLEAN,
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
  v_ws   UUID := public.current_workspace_id();
  v_uid  UUID := auth.uid();
  -- Caller's role comes from their LIVE membership row, NOT the JWT claim:
  -- a demoted manager's in-flight token keeps app_role='manager' until it
  -- refreshes (~1h). RLS policies must use the claim (0008 recursion), but
  -- this function is SECURITY DEFINER and already probes the caller's row,
  -- so the row-derived role is free and takes effect immediately.
  v_role TEXT;
BEGIN
  IF v_ws IS NOT NULL AND v_uid IS NOT NULL THEN
    SELECT wm.app_role INTO v_role
      FROM public.workspace_members wm
     WHERE wm.workspace_id = v_ws
       AND wm.user_id = v_uid
       AND wm.is_active;
  END IF;
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
         wm.is_full_time,
         wm.onboarded_at,
         wm.created_at,
         CASE
           WHEN v_role IN ('admin', 'manager') OR wm.user_id = v_uid
             THEN au.email::text
           ELSE NULL
         END AS email,
         wm.grant_rate_card_view,
         wm.grant_rate_card_edit
    FROM public.workspace_members wm
    LEFT JOIN auth.users au ON au.id = wm.user_id
   WHERE wm.workspace_id = v_ws
   ORDER BY lower(coalesce(wm.display_name, wm.username));
END;
$$;

-- 0033 swept anon privileges; keep this function's grants as they were.
REVOKE ALL ON FUNCTION public.workspace_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_directory() TO authenticated;

COMMENT ON FUNCTION public.workspace_directory IS
  'Roster read for the signed-in workspace. SECURITY DEFINER for the auth.users email join; email is nulled for non-admin/manager callers viewing someone else. 🚨 The RETURNS TABLE list is EXPLICIT, so a column it does not name is invisible to every client. 0059 rebuilt this list to add is_full_time and silently lost grant_rate_card_view/edit; 0060 restored them. When you re-create this function, carry EVERY existing column across — the risk is not the one you are adding.';

-- ── post-condition ───────────────────────────────────────────────────────────
-- Assert the shape rather than trusting that the DDL above ran: a migration
-- can be green and change nothing, and this is the second time this exact
-- function has shipped with a missing column.
DO $$
DECLARE
  n INT;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p
    JOIN LATERAL unnest(string_to_array(pg_get_function_result(p.oid), ',')) AS col(def) ON true
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'workspace_directory'
     AND (col.def ILIKE '%grant_rate_card_view%'
       OR col.def ILIKE '%grant_rate_card_edit%'
       OR col.def ILIKE '%is_full_time%');
  IF n <> 3 THEN
    RAISE EXCEPTION
      '0060 post-condition failed: workspace_directory() names % of the 3 required columns (is_full_time, grant_rate_card_view, grant_rate_card_edit)', n;
  END IF;
END $$;
