-- =============================================================================
-- 0066_platform_audit_invite_sent.sql — Session 43b.
--
-- ONE new `platform_audit.action` value: 'workspace.invite_sent'.
--
-- WHY THIS NEEDS A MIGRATION AT ALL. S43b lets the operator email a setup link
-- to a company they just created, instead of reading a show-once password down
-- the phone. Reusing 'workspace.created' for the send would make the operator
-- console unable to tell "company created" from "setup link emailed" — which is
-- exactly the question an operator asks when a new company says they never got
-- it. So the send gets its own verb.
--
-- 🚨 EXPLICIT DROP + ADD, AND THE FULL LIST RESTATED. Lifted verbatim from
--    0055's own reasoning: a wrapped ADD is a silent no-op against every
--    already-migrated environment, and all three carry this constraint already.
--    The list below is 0055's nineteen values PLUS the new one — twenty.
--
-- 🚨 DROPPING A VALUE HERE IS THE 0059 SHAPE. 0059 did a CREATE OR REPLACE that
--    silently deleted 0020's grant-flag guards and became a live privilege
--    escalation, red in CI for two days before anyone read it as real rather
--    than as a flaky suite. A restatement that loses a verb does not error — it
--    makes every future write of that verb fail on supabase-js's `error`
--    channel, which logPlatformEvent only console.errors, so the operator's
--    action still returns 200 and no certificate exists. Count the list.
--
-- 🚨 THIS IS A FOUR-PLACE VOCABULARY. The other three:
--      * supabase/functions/_shared/operatorGuard.ts → PlatformAuditFields
--      * src/admin/AuditSection.jsx                  → const ACTIONS
--      * supabase/functions/operator-workspaces/index.ts → the call site
--    src/admin/platformAuditActions.test.js parses the first two and this file
--    and fails on drift in EITHER direction. The call site is guarded by
--    nothing.
--
-- ⚠️ 0055's own comment at its post-condition block calls this an "IDENTICAL
--    15-value CHECK". It was 19 before this file and is 20 after. The comment
--    was true when written and nobody updated it; do not trust it, count.
--
-- No table, no policy, no function. platform_audit's RLS is untouched: one
-- SELECT policy for operators, no INSERT/UPDATE/DELETE policy at all, writes
-- only ever from service_role. Its pgTAP suite is 35_platform_audit.sql, which
-- this session extends rather than replacing — platform_audit is already in
-- rls.yml's RLS_TABLES and needs no new suite number.
--
-- Idempotent: DROP IF EXISTS + ADD. Safe to re-run.
-- =============================================================================

ALTER TABLE public.platform_audit DROP CONSTRAINT IF EXISTS platform_audit_action_check;
ALTER TABLE public.platform_audit ADD CONSTRAINT platform_audit_action_check
  CHECK (action IN (
    'workspace.created',
    'workspace.renamed',
    'workspace.suspended',
    'workspace.restored',
    'workspace.teardown',
    'blob.purged',
    'ai_key.set',
    'ai_key.cleared',
    'operator.granted',
    'operator.revoked',
    -- Session 20
    'model.approved',
    'model.retired',
    'model.restored',
    'model.default_set',
    'model.default_cleared',
    -- Session 41
    'storage_plan.set',
    'storage_plan.cleared',
    'storage_plan.suspended',
    'storage_plan.restored',
    -- Session 43b
    'workspace.invite_sent'));

-- ── Post-conditions ──────────────────────────────────────────────────────────
-- 🚨 The only check in this change that runs against dev, staging and prod
-- rather than against a fixture. It asserts the NEW verb is admitted and that
-- an OLD one survived the restatement — the second half is the 0059 guard, and
-- it is the reason this block tests a value this file did not add.
DO $$
DECLARE
  v_ok BOOLEAN;
BEGIN
  -- The new verb is admitted.
  BEGIN
    INSERT INTO public.platform_audit (action, message)
    VALUES ('workspace.invite_sent', '0066 post-condition probe');
    v_ok := true;
  EXCEPTION WHEN check_violation THEN
    v_ok := false;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION '0066: workspace.invite_sent was NOT admitted by the CHECK';
  END IF;

  -- An old verb still is. If a restatement dropped it, this catches it here
  -- rather than six months later on a silent error channel.
  BEGIN
    INSERT INTO public.platform_audit (action, message)
    VALUES ('workspace.teardown', '0066 post-condition probe');
    v_ok := true;
  EXCEPTION WHEN check_violation THEN
    v_ok := false;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION '0066: the restatement DROPPED workspace.teardown';
  END IF;

  -- A nonsense verb is still refused — the failing control. Without it the two
  -- probes above would pass just as happily against a CHECK that was dropped
  -- and never re-added.
  BEGIN
    INSERT INTO public.platform_audit (action, message)
    VALUES ('workspace.not_a_real_action', '0066 post-condition probe');
    v_ok := true;
  EXCEPTION WHEN check_violation THEN
    v_ok := false;
  END;
  IF v_ok THEN
    RAISE EXCEPTION '0066: the CHECK admits arbitrary actions — it is not enforcing';
  END IF;

  -- Leave nothing behind. These probes are diagnostics, not history.
  DELETE FROM public.platform_audit WHERE message = '0066 post-condition probe';

  RAISE NOTICE '0066 OK: invite_sent admitted, teardown survived, junk refused';
END $$;
