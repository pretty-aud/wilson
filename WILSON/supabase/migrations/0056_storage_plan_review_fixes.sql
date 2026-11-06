-- =============================================================================
-- 0056_storage_plan_review_fixes.sql — Session 41, from its own pre-push review
--
-- 🚨 WHY THIS IS A SECOND MIGRATION AND NOT AN EDIT TO 0055. 0055 was already
-- applied and verified by query on dev, staging AND prod before the adversarial
-- review ran. Editing an applied migration changes nothing on any environment
-- while making the file lie about what is deployed — the drift class this repo
-- keeps paying for. Two findings needed SQL; they get their own number.
--
-- Both were confirmed by an adversarial verifier that was instructed to refute
-- them and could not.
--
-- ── 1. A CROSS-TENANT READ NOBODY NEEDED ────────────────────────────────────
--
-- 0055 granted EXECUTE on public.workspace_petal_bytes(UUID) to `authenticated`.
-- That function takes an ARBITRARY workspace id and, by design, does no
-- membership check at all — the restrictive policy needs it unfiltered, and
-- SECURITY DEFINER is what stops the total depending on who is asking. Handed
-- to `authenticated`, it becomes a PostgREST RPC that returns any company's
-- storage total to any signed-in user in the product.
--
-- 🚨 NO CALLER EVER NEEDED THAT GRANT, which is what makes this a clean revoke
-- rather than a trade-off. The policy expression names only
-- rabbit_quota_exempt_path and rabbit_petal_storage_ok; every other caller
-- (rabbit_petal_storage_ok, workspace_storage_usage,
-- operator_storage_plan_summary) is itself SECURITY DEFINER owned by postgres,
-- and inside a DEFINER function the OWNER's privilege is what counts, not the
-- caller's. The client's own reading comes from workspace_storage_usage(),
-- which takes no argument and self-gates on current_workspace_id() plus a live
-- membership row.
--
-- 🚨 THE REVOKE MUST NAME `authenticated` EXPLICITLY. Dropping the GRANT from
-- 0055 would have been a silent no-op: 0011's ALTER DEFAULT PRIVILEGES grants
-- EXECUTE on new functions to anon and authenticated, so the privilege exists
-- whether or not 0055 asks for it. That is the S22 grantee lesson — a REVOKE
-- naming the wrong grantee reports success and changes nothing.
--
-- ── 2. A RETURN COLUMN NAMED FOR THE WRONG SUSPENSION ───────────────────────
--
-- operator_storage_plan_summary() returned `suspended BOOLEAN` meaning
-- `w.deleted_at IS NOT NULL` — the COMPANY's teardown suspension — while the
-- adjacent `status` column carries 'suspended' meaning the PLAN's billing hold.
-- Two different suspensions, one word, side by side in one row. The console's
-- own StorageCell already carries a comment warning not to confuse them, and
-- the RPC handed the next reader a column literally named for the other one.
-- Renamed to `company_deleted`, which cannot be misread.
--
-- ⚠️ A RETURN-TYPE CHANGE NEEDS DROP + CREATE. `CREATE OR REPLACE FUNCTION`
-- refuses to change a function's OUT columns, so a replace-only edit would have
-- failed loudly here — but the same shape silently succeeds when only a column's
-- TYPE is compatible, so do not rely on the error. Safe to drop: the sole
-- consumer is the operator-storage-plans Edge Function, and it reads by name.
-- =============================================================================

-- ── 1. Close the unfiltered aggregate to client roles ───────────────────────

REVOKE ALL ON FUNCTION public.workspace_petal_bytes(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_petal_bytes(UUID) TO service_role;

COMMENT ON FUNCTION public.workspace_petal_bytes(UUID) IS
  'Session 41: bytes this workspace holds in Petal storage (rabbit-files + '
  'rabbit-thumbnails), from storage.objects.metadata->>''size'' — authored by '
  'storage-api, unlike files.size_bytes which comes from the browser''s File '
  'object and is client-writable. '
  '🚨 NOT EXECUTABLE BY A CLIENT ROLE (0056). It takes an arbitrary workspace '
  'id and performs NO membership check — deliberately, because the restrictive '
  'policy needs it unfiltered and an invoker-rights aggregate would return a '
  'different total depending on who asked. Granting it to `authenticated` made '
  'it an RPC returning any company''s total to any signed-in user. Clients read '
  'workspace_storage_usage(), which self-gates; the policy reaches this through '
  'rabbit_petal_storage_ok, which is SECURITY DEFINER and so uses the owner''s '
  'privilege, not the caller''s.';

-- ── 2. Rename the colliding column ──────────────────────────────────────────

DROP FUNCTION IF EXISTS public.operator_storage_plan_summary();

CREATE FUNCTION public.operator_storage_plan_summary()
RETURNS TABLE (
  workspace_id    UUID,
  name            TEXT,
  slug            TEXT,
  company_deleted BOOLEAN,
  status          TEXT,
  quota_bytes     BIGINT,
  used_bytes      BIGINT,
  has_plan        BOOLEAN,
  updated_at      TIMESTAMPTZ,
  updated_by      UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.id,
         w.name,
         w.slug,
         -- The COMPANY's teardown suspension. `status` below is the PLAN's
         -- billing hold. Naming this one `suspended` beside that one was the
         -- whole finding.
         (w.deleted_at IS NOT NULL),
         COALESCE(pl.status, 'active'),
         COALESCE(pl.quota_bytes, public.storage_free_tier_bytes()),
         public.workspace_petal_bytes(w.id),
         (pl.workspace_id IS NOT NULL),
         pl.updated_at,
         pl.updated_by
    FROM public.workspaces w
    LEFT JOIN public.workspace_storage_plans pl ON pl.workspace_id = w.id
   ORDER BY w.name;
$$;

REVOKE EXECUTE ON FUNCTION public.operator_storage_plan_summary()
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.operator_storage_plan_summary() TO service_role;

COMMENT ON FUNCTION public.operator_storage_plan_summary() IS
  'Session 41: one row per company for the operator console''s storage panel. '
  'service_role only, on the operator_workspace_summary() precedent (0028) — an '
  'operator has no workspace claim, so a direct PostgREST read of the plan table '
  'returns an empty set rather than an error. `company_deleted` is the teardown '
  'state; `status` is the billing hold. Deleted companies are returned and '
  'flagged, never filtered: their bytes are on Petal''s bill until teardown runs.';

-- ── 3. Post-conditions ──────────────────────────────────────────────────────

DO $$
BEGIN
  -- 🚨 The coverage that 0055's post-condition 8 had in ONE direction only. It
  -- asserted the operator summary was not client-callable and said nothing
  -- about the raw aggregate underneath it — the standing "read every stated
  -- limit in both directions" rule, missed inside the file that states it.
  IF has_function_privilege('authenticated', 'public.workspace_petal_bytes(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.workspace_petal_bytes(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.operator_storage_plan_summary()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.operator_storage_plan_summary()', 'EXECUTE') THEN
    RAISE EXCEPTION '0056 post-condition failed: an unfiltered storage reader is executable by a client role';
  END IF;

  -- ...and the CONVERSE, because revoking one function too many refuses every
  -- upload instead of leaking anything, and would look like the quota working.
  -- The RESTRICTIVE policy evaluates both of these as the invoking role.
  IF NOT has_function_privilege('authenticated', 'public.rabbit_petal_storage_ok(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rabbit_quota_exempt_path(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.workspace_storage_usage()', 'EXECUTE') THEN
    RAISE EXCEPTION '0056 post-condition failed: the policy predicates are no longer executable by authenticated — every upload would be refused';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.parameters
     WHERE specific_schema = 'public'
       AND parameter_name = 'company_deleted'
       AND specific_name LIKE 'operator_storage_plan_summary%'
  ) THEN
    RAISE EXCEPTION '0056 post-condition failed: operator_storage_plan_summary still returns the ambiguous `suspended` column';
  END IF;

  RAISE NOTICE '0056 post-conditions passed';
END $$;
