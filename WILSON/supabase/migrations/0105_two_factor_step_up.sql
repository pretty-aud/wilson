-- =============================================================================
-- 0105_two_factor_step_up.sql — P8, night 5 of docs/sessions/PLAN_TO_1_0.md
-- (2026-10-28): Phase 8 of TPN_AUDIT/REMEDIATION_PLAN.md, TPN-AUTH-013.
--
-- The outside switch (0093 §4), the gateway's admin calls (0093 §13: the
-- eight RPCs behind fn_gateway_require_admin, the gateways_update and
-- gateway_enrolment_tokens_delete policies) and the bucket settings (0048's
-- three workspace_storage write policies) checked a LIVE admin row and
-- nothing about the session's assurance level, where storage-secret and
-- storage-gc in the same areas take adminGuard's two-factor step-up. An
-- enrolled admin's stolen one-factor session could open the outside door or
-- point the company's bucket at a host the thief holds. Her ruling of
-- 2026-10-28 (walkthrough 85 Q2, "(a) Count and fix them"): fixed before the
-- release.
--
-- THE SQL ARM — public.two_factor_satisfied(): true when the session's token
-- carries aal = 'aal2' (the authenticator was used at this sign-in), or when
-- the caller has NO verified TOTP factor (nothing to step up to: the same
-- rule as adminGuard, which demands aal2 only of an enrolled admin; the
-- stronger gate, refusing the un-enrolled, is WILSON_REQUIRE_ADMIN_MFA's and
-- off by default). SECURITY DEFINER to read auth.mfa_factors; it answers
-- only about the caller; a caller without a sign-in is false. It never
-- swallows an error: a read of auth.mfa_factors that fails fails the write,
-- closed, as adminGuard answers 503 and never waves the request through.
--
-- APPLIED TO: fn_workspaces_remote_viewing_live_admin (restated whole, 0093
-- §4: the live-admin RAISE and its sentence stay, as suite 96 pins them; a
-- second RAISE, its own sentence); fn_gateway_require_admin (restated whole,
-- 0093 §13: the same shape, so every RPC that begins with it — 0093's own
-- post-condition — takes the step-up without being restated); the two
-- gateway policies and 0048's three, restated with the conjunct in the DROP +
-- CREATE shape their files use. Nothing else changes: the service role, a
-- migration and the dashboard are no client and were never asked (the
-- switch trigger's own exemption); a member's reads are untouched.
--
-- WHAT A PERSON NOTICES: an admin who has enrolled two-factor is already
-- aal2 when the app's sign-in completes (the authenticator step), so nothing
-- changes for them; a session of theirs below aal2 (a token minted without
-- the step) is refused with a sentence that names the authenticator. An
-- admin without a factor sees no change.
--
-- HOW IT IS APPLIED (the house way, never `supabase db push`): this file's
-- statements by `supabase db query --linked --file` from an LF copy, then,
-- in a second call, the history row (INSERT INTO
-- supabase_migrations.schema_migrations (version, name, statements) SELECT
-- '0105', 'two_factor_step_up', ARRAY[<this whole file>] WHERE NOT EXISTS (…
-- version = '0105')); md5(statements[1]) is the LF file's md5.
--
-- ORDERING — depends on: 0048 (the storage policies), 0093 (the switch, the
-- RPC guard, the two policies), and auth.mfa_factors (GoTrue's schema, on
-- every Supabase database; the local CI stack included). Numbers: 0105 /
-- suite 108 (0102 and suite 105 stay reserved). Idempotent: OR REPLACE and
-- DROP + CREATE throughout.
--
-- ROLLBACK (a reviewed reverse file): restate fn_workspaces_remote_viewing_live_admin
-- and fn_gateway_require_admin from 0093, gateways_update and
-- gateway_enrolment_tokens_delete from 0093, the three workspace_storage
-- policies from 0048; drop two_factor_satisfied. gateway-reach's previous
-- copy redeployed.
-- =============================================================================


-- =============================================================================
-- 0. PRE-FLIGHT
-- =============================================================================
DO $$
BEGIN
  IF to_regprocedure('public.fn_workspaces_remote_viewing_live_admin()') IS NULL
     OR to_regprocedure('public.fn_gateway_require_admin()') IS NULL
     OR to_regprocedure('public.is_live_workspace_admin(uuid)') IS NULL THEN
    RAISE EXCEPTION '0105 pre-flight failed: 0093''s switch trigger, RPC guard or live-admin test is missing — apply 0093 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'gateways' AND policyname = 'gateways_update')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'gateway_enrolment_tokens' AND policyname = 'gateway_enrolment_tokens_delete') THEN
    RAISE EXCEPTION '0105 pre-flight failed: 0093''s gateways_update or gateway_enrolment_tokens_delete is missing';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workspace_storage'
       AND policyname IN ('workspace_storage_insert', 'workspace_storage_update', 'workspace_storage_delete')) <> 3 THEN
    RAISE EXCEPTION '0105 pre-flight failed: 0048''s three workspace_storage write policies are not all there';
  END IF;
  IF to_regclass('auth.mfa_factors') IS NULL THEN
    RAISE EXCEPTION '0105 pre-flight failed: auth.mfa_factors is missing (GoTrue''s schema)';
  END IF;
END $$;


-- =============================================================================
-- 1. two_factor_satisfied — the claims' aal, or no factor to step up to
-- =============================================================================
CREATE OR REPLACE FUNCTION public.two_factor_satisfied()
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_aal TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;
  v_aal := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal';
  IF v_aal = 'aal2' THEN
    RETURN true;
  END IF;
  -- No verified authenticator: nothing to step up to (adminGuard's rule).
  -- A failed read raises, and the write it guards fails with it: closed.
  RETURN NOT EXISTS (
    SELECT 1 FROM auth.mfa_factors f
     WHERE f.user_id = v_uid
       AND f.factor_type = 'totp'
       AND f.status = 'verified'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.two_factor_satisfied() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.two_factor_satisfied() TO authenticated, service_role;

COMMENT ON FUNCTION public.two_factor_satisfied() IS
  '0105 (TPN-AUTH-013): true when the caller''s token carries aal = aal2, or when the caller has no verified TOTP factor in auth.mfa_factors (adminGuard''s step-up rule: an enrolled admin must have signed in with their code; an un-enrolled one is not stepped up). False with no sign-in. SECURITY DEFINER to read the factors; answers only about the caller; a failed read raises, never passes. Read by the switch''s trigger, fn_gateway_require_admin, gateways_update, gateway_enrolment_tokens_delete and the three workspace_storage write policies.';


-- =============================================================================
-- 2. The switch's trigger — restated whole (0093 §4): the second RAISE
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_workspaces_remote_viewing_live_admin()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF (auth.uid() IS NOT NULL OR COALESCE(current_setting('role', true), '') IN ('authenticated', 'anon'))
     AND NOT public.is_live_workspace_admin(NEW.id) THEN
    RAISE EXCEPTION 'Only a workspace admin can change whether files may be viewed from outside the office network.'
      USING ERRCODE = '42501';
  END IF;
  -- 0105 (TPN-AUTH-013): the live admin, signed in with their authenticator.
  IF (auth.uid() IS NOT NULL OR COALESCE(current_setting('role', true), '') IN ('authenticated', 'anon'))
     AND NOT public.two_factor_satisfied() THEN
    RAISE EXCEPTION 'Sign in with your authenticator code to change whether files may be viewed from outside the office network.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_workspaces_remote_viewing_live_admin() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fn_workspaces_remote_viewing_live_admin() IS
  '0093 (D23, review round 1 F21), restated by 0105 (TPN-AUTH-013): BEFORE UPDATE on workspaces when remote_viewing_enabled changes — a client (a sign-in, or a client role) needs a LIVE admin row of the workspace, whatever its token says, AND a session that satisfies the two-factor step-up (two_factor_satisfied: aal2, or no factor to step up to); a demoted admin, a platform operator and an enrolled admin below aal2 are refused with 42501 and one sentence each. Only a session with no sign-in and no client role (the service role, a migration) is exempt.';


-- =============================================================================
-- 3. fn_gateway_require_admin — restated whole (0093 §13): the second RAISE
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_gateway_require_admin()
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ws UUID := public.current_workspace_id();
BEGIN
  IF auth.uid() IS NULL OR v_ws IS NULL
     OR NOT public.has_active_membership(v_ws)
     OR NOT public.is_live_workspace_admin(v_ws) THEN
    RAISE EXCEPTION 'Only a workspace admin can manage the file gateway.' USING ERRCODE = '42501';
  END IF;
  -- 0105 (TPN-AUTH-013): the live admin, signed in with their authenticator.
  IF NOT public.two_factor_satisfied() THEN
    RAISE EXCEPTION 'Sign in with your authenticator code to manage the file gateway.' USING ERRCODE = '42501';
  END IF;
  RETURN v_ws;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_gateway_require_admin() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fn_gateway_require_admin() IS
  '0093, restated by 0105 (TPN-AUTH-013): the admin RPCs'' first line — the caller''s workspace when they are a LIVE admin of it whose session satisfies the two-factor step-up (two_factor_satisfied), else 42501 with one sentence (the admin''s, or the authenticator''s). Called only from inside 0093''s SECURITY DEFINER RPCs.';


-- =============================================================================
-- 4. The two gateway policies — restated (0093 §5, §7) with the conjunct
-- =============================================================================
DROP POLICY IF EXISTS gateways_update ON public.gateways;
CREATE POLICY gateways_update ON public.gateways
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.is_live_workspace_admin(workspace_id)
    AND public.two_factor_satisfied()
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.is_live_workspace_admin(workspace_id)
    AND public.two_factor_satisfied()
  );

COMMENT ON POLICY gateways_update ON public.gateways IS
  '0093 (F4), restated by 0105 (TPN-AUTH-013): a LIVE admin of the workspace, signed in with their authenticator (two_factor_satisfied), changes a gateway''s name, outside address and office ranges (the column grant; fn_gateways_client_guard refuses the rest).';

DROP POLICY IF EXISTS gateway_enrolment_tokens_delete ON public.gateway_enrolment_tokens;
CREATE POLICY gateway_enrolment_tokens_delete ON public.gateway_enrolment_tokens
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.is_live_workspace_admin(workspace_id)
    AND used_at IS NULL
    AND public.two_factor_satisfied()
  );

COMMENT ON POLICY gateway_enrolment_tokens_delete ON public.gateway_enrolment_tokens IS
  '0093, restated by 0105 (TPN-AUTH-013): a live admin signed in with their authenticator cancels a PENDING token (Cancel in Settings); a used token stays as the record of which gateway it enrolled.';


-- =============================================================================
-- 5. 0048's three workspace_storage write policies — restated with the conjunct
-- =============================================================================
-- The exact 0048 shape (claim-bound workspace + claim-bound role + LIVE
-- membership row; suite 58 pins each arm with a caller that passes the other
-- two) plus the step-up; suite 108 pins the new arm the same way.
DROP POLICY IF EXISTS workspace_storage_insert ON public.workspace_storage;
CREATE POLICY workspace_storage_insert ON public.workspace_storage
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_app_role() = 'admin'
    AND public.has_active_membership(workspace_id)
    AND public.two_factor_satisfied()
  );

DROP POLICY IF EXISTS workspace_storage_update ON public.workspace_storage;
CREATE POLICY workspace_storage_update ON public.workspace_storage
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.current_app_role() = 'admin'
    AND public.has_active_membership(workspace_id)
    AND public.two_factor_satisfied()
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_app_role() = 'admin'
    AND public.has_active_membership(workspace_id)
    AND public.two_factor_satisfied()
  );

DROP POLICY IF EXISTS workspace_storage_delete ON public.workspace_storage;
CREATE POLICY workspace_storage_delete ON public.workspace_storage
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.current_app_role() = 'admin'
    AND public.has_active_membership(workspace_id)
    AND public.two_factor_satisfied()
  );

COMMENT ON POLICY workspace_storage_insert ON public.workspace_storage IS
  '0048, restated by 0105 (TPN-AUTH-013): an admin by claim with a live membership, signed in with their authenticator (two_factor_satisfied), sets the storage root, mode, provider and bucket configuration; storage-presign then signs every member''s next upload for whatever the row names.';
COMMENT ON POLICY workspace_storage_update ON public.workspace_storage IS
  '0048, restated by 0105 (TPN-AUTH-013): the same four arms for a change.';
COMMENT ON POLICY workspace_storage_delete ON public.workspace_storage IS
  '0048, restated by 0105 (TPN-AUTH-013): the same four arms for a removal.';


-- =============================================================================
-- 6. POST-CONDITIONS — scan the catalogue, do not assume (S22)
-- =============================================================================
DO $$
DECLARE
  v_def TEXT;
  v_n   INT;
BEGIN
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.two_factor_satisfied()'::regprocedure)
     OR NOT has_function_privilege('authenticated', 'public.two_factor_satisfied()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.two_factor_satisfied()', 'EXECUTE')
     OR position('auth.mfa_factors' IN pg_get_functiondef('public.two_factor_satisfied()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '0105 post-condition failed: two_factor_satisfied is not the definer over auth.mfa_factors that authenticated may call and anon may not';
  END IF;
  v_def := pg_get_functiondef('public.fn_workspaces_remote_viewing_live_admin()'::regprocedure);
  IF position('two_factor_satisfied' IN v_def) = 0 OR position('is_live_workspace_admin' IN v_def) = 0
     OR position('Only a workspace admin can change whether files may be viewed from outside the office network.' IN v_def) = 0 THEN
    RAISE EXCEPTION '0105 post-condition failed: the switch''s trigger lacks the step-up or lost 0093''s live-admin guard';
  END IF;
  v_def := pg_get_functiondef('public.fn_gateway_require_admin()'::regprocedure);
  IF position('two_factor_satisfied' IN v_def) = 0 OR position('is_live_workspace_admin' IN v_def) = 0
     OR position('Only a workspace admin can manage the file gateway.' IN v_def) = 0 THEN
    RAISE EXCEPTION '0105 post-condition failed: fn_gateway_require_admin lacks the step-up or lost 0093''s live-admin guard';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_gateway_require_admin()', 'EXECUTE') THEN
    RAISE EXCEPTION '0105 post-condition failed: fn_gateway_require_admin must not be callable by authenticated';
  END IF;
  -- The eight RPCs still begin with the guard (0093's own rule, re-checked).
  FOR v_def IN SELECT t FROM unnest(ARRAY['public.gateway_make_enrolment_token()', 'public.gateway_confirm_root(uuid,text)',
      'public.gateway_root_certificate(uuid)', 'public.gateway_next_root_certificate(uuid)', 'public.gateway_forget(uuid)',
      'public.gateway_unforget(uuid)', 'public.gateway_request_update_check(uuid)', 'public.gateway_rotate_signing_key()']) AS t LOOP
    IF to_regprocedure(v_def) IS NULL OR position('fn_gateway_require_admin' IN pg_get_functiondef(v_def::regprocedure)) = 0 THEN
      RAISE EXCEPTION '0105 post-condition failed: % does not begin with fn_gateway_require_admin', v_def;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public'
     AND ((tablename = 'gateways' AND policyname = 'gateways_update')
       OR (tablename = 'gateway_enrolment_tokens' AND policyname = 'gateway_enrolment_tokens_delete')
       OR (tablename = 'workspace_storage' AND policyname IN ('workspace_storage_insert', 'workspace_storage_update', 'workspace_storage_delete')))
     AND COALESCE(qual, '') || COALESCE(with_check, '') LIKE '%two_factor_satisfied%'
     AND COALESCE(qual, '') || COALESCE(with_check, '') LIKE '%has_active_membership%';
  IF v_n <> 5 THEN
    RAISE EXCEPTION '0105 post-condition failed: % of the five policies carry the step-up with their live-membership arm', v_n;
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workspace_storage') <> 4
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'gateways') <> 2
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'gateway_enrolment_tokens') <> 2 THEN
    RAISE EXCEPTION '0105 post-condition failed: a table gained or lost a policy in the restatement';
  END IF;
  IF (SELECT with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workspace_storage' AND policyname = 'workspace_storage_update')
     IS DISTINCT FROM (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workspace_storage' AND policyname = 'workspace_storage_update') THEN
    RAISE EXCEPTION '0105 post-condition failed: workspace_storage_update''s WITH CHECK must equal its USING (0044)';
  END IF;
  RAISE NOTICE '0105 OK: two_factor_satisfied; the switch''s trigger and fn_gateway_require_admin restated with the step-up and their 0093 guards; gateways_update, gateway_enrolment_tokens_delete and 0048''s three workspace_storage write policies carry it';
END $$;
