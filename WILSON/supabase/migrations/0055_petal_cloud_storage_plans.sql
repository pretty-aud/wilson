-- =============================================================================
-- 0055_petal_cloud_storage_plans.sql — Session 41
-- Petal cloud becomes a PAID, OPERATOR-MANAGED product.
--
-- Audrey, 2026-08-07 (design §4a3, verbatim):
--   "if the storage selection is petal cloud and it does store media on petal
--    cloud, please make sure to set it up management of that in the operator
--    terminal ... the operator terminal should have control to partition server
--    space for that company and approve access ... it needs to be controlled and
--    managed by the operator terminal for when their are multiple companies
--    using the tool"
--
-- What existed before this file: nothing. Uploads have gone to the shared
-- `rabbit-files` bucket since S14 with a 50 MB per-file cap and NO metering, NO
-- quota, NO approval and NO payment linkage, and every workspace defaults to it.
-- Harmless with one tenant; wrong the day company #2 signs in.
--
-- 🚨 ORDERING RULE: this file extends the `action` CHECK on public.platform_audit
-- that 0028 creates and 0031 already widened once. A manual re-run of EITHER
-- 0028 or 0031 restores an action list without the four `storage_plan.*` values,
-- and `operator-storage-plans` then fails every audit write with a check
-- violation — which `logPlatformEvent` reports on the error channel rather than
-- throwing, so the operator's action still returns 200 and no certificate
-- exists. A re-run of 0028 or 0031 MUST be followed by a re-run of 0055.
-- (Same class as 0002->0029, 0011->0030 and 0028->0031; handbook §replay.)
--
-- 🚨 THE WIDENING IS AN EXPLICIT DROP + ADD, not a wrapped ADD. Every
-- ADD CONSTRAINT in this repo is wrapped in `EXCEPTION WHEN duplicate_object`
-- for idempotency, and S36 measured the consequence: against a database where
-- the constraint already exists, a wrapped ADD is a SILENT NO-OP. 0031 used the
-- correct form; so does this.
--
-- =============================================================================
-- FIVE DECISIONS, and why each is the way it is
-- =============================================================================
--
-- 1. A NEW TABLE, not a column on workspace_storage.
--    workspace_storage_update / _insert / _delete (0048) are TABLE-WIDE and
--    column-blind, and privileges are a bare
--    `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated` with no column
--    list. 0050 proved the drift direction: it added `provider` and
--    `provider_config` and created no policies, so those columns became
--    admin-writable the moment they existed. A quota parked there would be
--    SELF-SERVICE — the customer's own admin could raise their own limit and
--    flip their own status to active. 0048's header names this exact class as
--    the reason it refused to reuse workspaces.storage_mode ("live-wire dead").
--    Suite 60 already refuses the shortcut in so many words: a `petal` row may
--    carry no provider_config at all, "quotas are S41's own table".
--
-- 2. THE OPERATOR TABLE HAS ZERO WRITE POLICIES — that absence IS the
--    enforcement (the 0031 precedent). Writes ride requirePlatformOperator +
--    service_role in an Edge Function, which bypasses RLS entirely, so no
--    operator write policy is needed and adding one would widen the surface
--    without adding capability. is_platform_operator() appears ONLY in SELECT
--    policies anywhere in this schema and this file does not change that.
--
-- 3. NO fn_audit_touch TRIGGER. Its UPDATE arm does
--    `NEW.updated_by := auth.uid()` UNCONDITIONALLY (the INSERT arm is
--    COALESCE-guarded; the UPDATE arm is not). Under service_role auth.uid() is
--    NULL, so the trigger would blank the actor on every operator edit while the
--    row saved cleanly — an invisible failure. 0031 attaches no stamping trigger
--    to any of its four tables for exactly this reason; the writer stamps
--    instead. (0030:149-155 documents the underlying fact.)
--
-- 4. NO `notes` COLUMN, and that is a deliberate departure from the brief.
--    The brief asked for operator notes on this row AND for workspace members to
--    SELECT it. Those two cannot both hold: a table-level SELECT policy is
--    COLUMN-BLIND, so "chasing payment, two months late" would be readable by
--    every member of the company it is about. The note belongs where the audit
--    trail already lives and is already operator-only — `platform_audit.context`
--    (0028's single SELECT policy gates it on is_platform_operator()). So the
--    plan row holds only facts the company is entitled to see, and the member
--    SELECT policy is safe as written.
--
-- 5. THE BYTE SOURCE IS storage.objects.metadata->>'size', NOT files.size_bytes.
--    🚨 MEASURED on wilson-staging 2026-08-09, which is what settled it:
--    `rabbit-files` holds ONE object (the 2,959-byte PROJECT.json manifest of
--    project 9926a8f7) while `public.files` holds ZERO ROWS. A files-derived
--    total reads 0 while real bytes sit in the bucket — the orphan case, in the
--    wild, on the environment the beta runs against. Two further reasons:
--      * files.size_bytes is written as `file?.size ?? null` from the BROWSER's
--        File object and is a member of FILE_COLUMNS, so it is client-writable
--        and nullable. A quota summing it is a suggestion, not a gate.
--      * storage.objects.metadata is authored by storage-api, not the client.
--        Measured shape on staging: {eTag, size, mimetype, cacheControl,
--        lastModified, contentLength, httpStatusCode}, with `size` a JSON
--        NUMBER. Nothing in this repo had ever read it — this is the first.
--
-- =============================================================================
-- WHAT IS METERED vs WHAT IS GATED, and why they differ
-- =============================================================================
--
--   METERED: `rabbit-files` + `rabbit-thumbnails` under `projects/<id>/...`.
--            Both are Petal's bytes. Since 0054 an s3 workspace's previews live
--            in the CUSTOMER's bucket and so are not in rabbit-thumbnails at
--            all — the workspace join is what excludes them, not a provider
--            test, so nothing here infers WHAT from WHERE (the 0054 lesson).
--   NOT METERED: `user-avatars`. Per-person, 2 MB ceiling, an identity feature
--            rather than a media one; refusing a company's dailies because its
--            people uploaded photographs would be indefensible.
--   GATED:   `rabbit-files` INSERT only. Thumbnails are DERIVED and capped at
--            256 KB by the bucket, and a workspace that cannot upload a body
--            generates no new previews anyway — so gating them adds nothing and
--            would strand a preview half-written.
--
-- =============================================================================
-- THE RESTRICTIVE POLICY — the first one in this schema
-- =============================================================================
--
-- 🚨 Verified by query on dev, staging AND prod (2026-08-09): pg_policies holds
-- ZERO rows with permissive = 'RESTRICTIVE'. This is the first.
--
-- It MUST be restrictive. `rabbit-files` INSERT already has TWO permissive arms
-- (rabbit_files_insert and rabbit_files_money_insert) and permissive policies OR
-- together — a quota added as a ninth permissive policy would be satisfied by
-- either existing arm and enforce NOTHING. That is the 0038 inversion this
-- project has already shipped once. A restrictive policy ANDs over the OR of all
-- permissive ones, which is the composition wanted.
--
-- 🚨 AND "ENFORCE NOTHING" UNDERSTATES IT — MEASURED, by running that exact
-- defect as breaker B1 (suite 65's header carries the run). Dropped to
-- permissive, this policy does not merely fail to meter: its own money
-- EXEMPTION becomes a GRANT. rabbit_quota_exempt_path is true for INVOICES/ and
-- FINANCE/, so as a permissive arm it ORs in and admits a write that
-- rabbit_files_money_insert was refusing — suite 65 probe 30, a plain member
-- writing into the money segment, goes green-to-red. One missing keyword here
-- re-opens the invoice hole 0038 shipped and 0039 closed, in the file that adds
-- a quota. Post-condition 4 below is what stops that reaching an environment.
--
-- 🚨 A RESTRICTIVE POLICY APPLIES TO EVERY ROW OF storage.objects FOR THAT
-- COMMAND, NOT JUST THIS BUCKET. Three buckets share that table and twenty
-- permissive policies span them. The predicate is therefore written to PASS for
-- everything it is not about (`bucket_id <> 'rabbit-files' OR ...`) rather than
-- merely to describe the rabbit-files case — otherwise the very first avatar
-- upload and every thumbnail write start failing with an RLS error naming the
-- wrong bucket.
--
-- 🚨 NULL-SAFETY INVERTS UNDER A RESTRICTIVE POLICY, and this is the trap that
-- would look exactly like the feature working. In a permissive policy a NULL
-- opens a hole; in a restrictive one a NULL DENIES. Both halves are pinned by
-- post-conditions below:
--   * SUM() over zero rows is NULL. `NULL < quota` is NULL, so without the outer
--     COALESCE a brand-new workspace could not upload its FIRST FILE EVER, and
--     the symptom would be indistinguishable from a correctly-enforced quota.
--     This is the S33/0047 lesson with the sign flipped.
--   * rabbit_money_segment(NULL) is false by construction (0042 post-condition
--     7 pins it), and rabbit_quota_exempt_path coalesces its own result.
--
-- =============================================================================
-- WHAT IS EXEMPT FROM THE GATE, and why each exemption is narrow
-- =============================================================================
--
--   * MONEY-GATED PATHS (INVOICES/, FINANCE/ — public.rabbit_money_segment,
--     0042's ONE definition). Three reasons, and the third is the decisive one:
--     they are tiny; `FINANCE/RATES.json` is a MIRROR that RabbitProvider
--     rewrites whenever rates change, so blocking it turns a quota condition
--     into a silent settings-save failure in an unrelated subsystem; and
--     invoices are the paperwork by which a company pays Petal — locking them
--     out of billing for exceeding a MEDIA quota punishes the wrong thing.
--   * THE PROJECT MANIFEST, and only it. `projects/<id>/PROJECT.json` is
--     WILSON's own bookkeeping and is rewritten on every project change.
--     🚨 The exemption is NOT "depth 3", though that is the tempting form and
--     reads more elegantly. `rabbit_files_insert` admits ANY key shaped
--     `projects/<id>/<anything>` — segment [3] is NULL there, so
--     NOT rabbit_money_segment(NULL) is true — which means a depth-3 exemption
--     would let `projects/<id>/dailies.mov` bypass the quota entirely, 50 MB at
--     a time. The exemption tests the FILENAME as well as the depth.
--
-- =============================================================================
-- MEASURED FACTS THIS FILE DEPENDS ON (dev, 2026-08-09)
-- =============================================================================
--   * `postgres` has rolbypassrls = true, and every SECURITY DEFINER function
--     here is owned by it — so they read public.projects (FORCE RLS) and
--     storage.objects (owner supabase_storage_admin) unfiltered. Without that
--     an invoker-rights aggregate would return a DIFFERENT total depending on
--     WHO asked: a plain member cannot see money-segment objects, so their
--     computed usage would be lower than a manager's for the same workspace and
--     the gate would depend on who happened to be uploading.
--   * `service_role` has rolbypassrls = true, so the restrictive policy does NOT
--     apply to storage-gc, teardown or any Edge Function admin path.
--   * storage.foldername is IMMUTABLE (provolatile 'i'), so the exempt-path
--     helper can be IMMUTABLE too and inline into the policy.
--   * storage.foldername('projects/abc/PROJECT.json') = {projects,abc}, so [3]
--     IS NULL; storage.foldername('projects/abc/ASSETS/a1/9-x.png') =
--     {projects,abc,ASSETS,a1}, so [3] = 'ASSETS'.
--   * The workspace is NOT in any rabbit-files object key. It is reached only
--     through projects.workspace_id, which is the sole mapping that exists.
--   * platform_audit.action carries the IDENTICAL 15-value CHECK on dev,
--     staging AND prod, and the only action values present anywhere are three on
--     staging (ai_key.set, workspace.restored, workspace.suspended), all inside
--     that list — so the DROP + ADD revalidates the whole corpus cleanly on
--     every environment. (This also settles a question the docs contradicted
--     three ways: 0031 IS applied to prod.)
-- =============================================================================

-- ── 1. The plan table ───────────────────────────────────────────────────────
-- Absence of a row = the free tier. Every workspace that exists today has zero
-- rows, so the rowless case is the DEFAULT PATH, not an edge case.

CREATE TABLE IF NOT EXISTS public.workspace_storage_plans (
  workspace_id  UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  status        TEXT   NOT NULL DEFAULT 'active',
  quota_bytes   BIGINT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID
);

-- CHECK names sort notes < quota < status within this table. Postgres reports a
-- violation by the ALPHABETICALLY FIRST constraint name (measured on dev,
-- 2026-08-07) and throws_ok matches SQLERRM exactly, so suite 65's fixtures each
-- violate exactly one of these.
DO $$
BEGIN
  ALTER TABLE public.workspace_storage_plans
    ADD CONSTRAINT workspace_storage_plans_quota_chk
    -- > 0, never >= 0: a fat-fingered zero would lock a PAYING customer out
    -- while looking like a deliberate setting. "No storage" is `status`, not a
    -- zero quota. The ceiling is 100 TiB — high enough never to bind a real
    -- customer, low enough to catch a pasted byte count from the wrong field.
    CHECK (quota_bytes > 0 AND quota_bytes <= 109951162777600);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.workspace_storage_plans
    ADD CONSTRAINT workspace_storage_plans_status_chk
    CHECK (status IN ('active', 'suspended'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE public.workspace_storage_plans IS
  'Session 41: the operator-curated Petal-cloud storage plan for one company. '
  'Absence of a row is the free tier (public.storage_free_tier_bytes). Written '
  'ONLY by service_role through the operator-storage-plans Edge Function — the '
  'table has no write policy, which is what makes that unbypassable. Operator '
  'notes go to platform_audit.context, never here: this row is readable by the '
  'company''s own members.';

COMMENT ON COLUMN public.workspace_storage_plans.status IS
  'active | suspended. Suspended refuses new uploads outright, whatever the '
  'quota says. Billing is MANUAL in v1 (Audrey, 2026-08-07): the operator flips '
  'this as payments start and stop.';

COMMENT ON COLUMN public.workspace_storage_plans.quota_bytes IS
  'Petal-cloud ceiling in bytes for rabbit-files + rabbit-thumbnails. NOT a '
  'physical partition — Supabase Storage has none; "partition server space" is '
  'a metered quota (design §4a3).';

-- ── 2. RLS: one read policy, and deliberately NO write policy ───────────────
-- FORCE is safe: no SECURITY DEFINER trigger writes this table, so there is no
-- owner-path write to break (the 0028:154-156 test).

ALTER TABLE public.workspace_storage_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_storage_plans FORCE ROW LEVEL SECURITY;

-- 🚨 THE EXACT INVERSE OF 0048. workspace_storage lets a workspace ADMIN INSERT,
-- UPDATE and DELETE their own row from the browser under the anon key. This
-- table lets that same caller do NONE of those three — only SELECT. Suite 65's
-- discriminating caller is a workspace ADMIN who is not an operator, because an
-- ordinary member would be refused by a policy that was merely admin-gated and
-- the probe would pass for the wrong reason.
DROP POLICY IF EXISTS workspace_storage_plans_select ON public.workspace_storage_plans;
CREATE POLICY workspace_storage_plans_select ON public.workspace_storage_plans
  FOR SELECT
  USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  );

-- One policy per verb, never FOR ALL (0029: a broad FOR ALL arm ORs with every
-- narrow arm beside it and silently wins). Here there is exactly one verb.

-- PUBLIC as well as anon — the S22 grantee lesson: a REVOKE naming the wrong
-- grantee is a silent no-op that reports success.
REVOKE ALL ON public.workspace_storage_plans FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.workspace_storage_plans FROM authenticated;
GRANT  SELECT ON public.workspace_storage_plans TO authenticated;
GRANT  ALL    ON public.workspace_storage_plans TO service_role;

-- ── 3. The free tier, as ONE definition ─────────────────────────────────────
-- 1 GiB. Audrey, 2026-08-07: "no plan = a small free allowance, then a plan is
-- required" — a zero allowance makes the first-day experience feel broken; a
-- free tier is a funnel, not a cost.
--
-- SQL is the authority and the client never hard-codes it: the UI reads the
-- EFFECTIVE quota back from workspace_storage_usage(), which has already
-- resolved the free tier. Two definitions of a number like this drift silently.

CREATE OR REPLACE FUNCTION public.storage_free_tier_bytes()
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT 1073741824::bigint;   -- 1 GiB
$$;

REVOKE ALL ON FUNCTION public.storage_free_tier_bytes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_free_tier_bytes() TO authenticated, service_role;

COMMENT ON FUNCTION public.storage_free_tier_bytes() IS
  'Session 41: the Petal-cloud allowance for a workspace with no plan row. The '
  'ONE definition — the client reads the resolved quota from '
  'workspace_storage_usage() rather than carrying its own copy.';

-- ── 4. What a quota does NOT count against you ──────────────────────────────
-- Sits beside public.rabbit_money_segment (0042) as the second path classifier,
-- and DELEGATES to it rather than restating the segment list — adding a third
-- reserved segment must stay a one-line change to that one function.

CREATE OR REPLACE FUNCTION public.rabbit_quota_exempt_path(obj_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(
    -- Money-gated bodies: INVOICES/ and FINANCE/. Blocking FINANCE/RATES.json
    -- would break a mirror that is rewritten on every rates change, and blocking
    -- INVOICES/ would stop a company billing the customer who owes Petal money.
    public.rabbit_money_segment((storage.foldername(obj_name))[3])
    -- The project manifest, and ONLY it. Depth alone is not enough: a depth-3
    -- key is otherwise a legal media path, so `AND obj_name LIKE '%/PROJECT.json'`
    -- is what stops `projects/<id>/dailies.mov` walking through the exemption.
    OR ((storage.foldername(obj_name))[3] IS NULL
        AND obj_name LIKE '%/PROJECT.json'),
    false);
$$;

REVOKE ALL ON FUNCTION public.rabbit_quota_exempt_path(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rabbit_quota_exempt_path(TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.rabbit_quota_exempt_path(TEXT) IS
  'Session 41: TRUE for objects a storage quota must never refuse — money-gated '
  'paths (delegated to rabbit_money_segment) and the project manifest. '
  'NULL-safe by construction: under a RESTRICTIVE policy a NULL DENIES, so a '
  'bare OR here would refuse uploads rather than leak them.';

-- ── 5. Usage: the bytes Petal is actually holding for one workspace ─────────
-- SECURITY DEFINER is not optional here. Policy expressions and ordinary
-- functions run SECURITY INVOKER, and under invoker rights this aggregate would
-- see only the objects the caller's own permissive policies admit — so a plain
-- member (who cannot see money-segment objects) would compute a SMALLER total
-- than a manager for the same workspace, and the quota would bind differently
-- depending on who was uploading.

CREATE OR REPLACE FUNCTION public.workspace_petal_bytes(ws UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- 🚨 TWO COALESCEs, both load-bearing, neither cosmetic:
  --   inner — an object whose metadata carries no size contributes 0 rather
  --           than turning the whole SUM into NULL.
  --   outer — SUM() over ZERO rows is NULL, and `NULL < quota` is NULL, which
  --           DENIES under a restrictive policy. Without it the first upload
  --           into a brand-new workspace is refused, and it looks exactly like
  --           the quota working correctly.
  SELECT COALESCE(SUM(COALESCE((o.metadata ->> 'size')::bigint, 0)), 0)::bigint
    FROM storage.objects o
    JOIN public.projects p
      ON p.id = public.fn_try_uuid((storage.foldername(o.name))[2])
   WHERE o.bucket_id IN ('rabbit-files', 'rabbit-thumbnails')
     AND (storage.foldername(o.name))[1] = 'projects'
     AND p.workspace_id = ws;
$$;

REVOKE ALL ON FUNCTION public.workspace_petal_bytes(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_petal_bytes(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.workspace_petal_bytes(UUID) IS
  'Session 41: bytes this workspace holds in Petal storage (rabbit-files + '
  'rabbit-thumbnails), from storage.objects.metadata->>''size'' — authored by '
  'storage-api, unlike files.size_bytes which comes from the browser''s File '
  'object and is client-writable. MEASURED on staging 2026-08-09: rabbit-files '
  'held an object while public.files held zero rows, so a files-derived total '
  'reads 0 while real bytes sit in the bucket. An s3 workspace''s previews are '
  'excluded because they are in the CUSTOMER''s bucket and so never join here — '
  'no provider test is needed, and inferring one would repeat 0054''s mistake.';

-- ── 6. The gate predicate ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rabbit_petal_storage_ok(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Fails CLOSED on an unresolvable project: the outer COALESCE turns "no such
  -- project" into false. That costs nothing, because a key whose [2] segment is
  -- not a live project is already refused by the permissive policies' EXISTS.
  SELECT COALESCE((
    SELECT COALESCE(pl.status, 'active') = 'active'
       AND public.workspace_petal_bytes(p.workspace_id)
           < COALESCE(pl.quota_bytes, public.storage_free_tier_bytes())
      FROM public.projects p
      LEFT JOIN public.workspace_storage_plans pl
        ON pl.workspace_id = p.workspace_id
     WHERE p.id = p_project_id
  ), false);
$$;

REVOKE ALL ON FUNCTION public.rabbit_petal_storage_ok(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rabbit_petal_storage_ok(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.rabbit_petal_storage_ok(UUID) IS
  'Session 41: may this project''s workspace put another object in Petal '
  'storage? A LEFT JOIN, so the rowless free tier is the default path rather '
  'than an edge case. Strictly `<`: at exactly the ceiling the next upload is '
  'refused. Overshoot is bounded by the bucket''s own 50 MB per-object cap.';

-- ── 7. 🚨 THE RESTRICTIVE POLICY — the first in this schema ─────────────────

DROP POLICY IF EXISTS petal_storage_quota_insert ON storage.objects;
CREATE POLICY petal_storage_quota_insert ON storage.objects
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    -- Self-limiting FIRST. A restrictive policy is evaluated for every INSERT
    -- into storage.objects, so everything this policy is not about must pass
    -- here: user-avatars, rabbit-thumbnails, and any bucket added later.
    bucket_id <> 'rabbit-files'
    OR public.rabbit_quota_exempt_path(name)
    OR public.rabbit_petal_storage_ok(public.fn_try_uuid((storage.foldername(name))[2]))
  );

-- 🚨 THE NAME IS NOT `rabbit_files_*`, AND THAT IS LOAD-BEARING RATHER THAN
-- STYLE. 0053's post-condition 7 and pgTAP suite 63 probe 7 both count
-- `policyname LIKE 'rabbit_files%'` with NO further filter and assert exactly 8.
-- A ninth policy under that prefix makes both read 9 and fail — in files this
-- session is not editing. The tempting fix would be to relax those assertions,
-- which is precisely how 0053's own header says a money predicate gets dropped.
-- Post-condition 6 below re-asserts both neighbour counts so this stays true.

COMMENT ON POLICY petal_storage_quota_insert ON storage.objects IS
  'Session 41: the Petal-cloud quota and suspension gate. RESTRICTIVE because '
  'rabbit-files INSERT already has two permissive arms and permissive policies '
  'OR together — a ninth permissive policy would be satisfied by either and '
  'enforce nothing (the 0038 inversion). This ANDs over all of them.';

-- ── 8. What the company sees ────────────────────────────────────────────────
-- Takes NO argument and self-gates on the caller's own claim plus a live
-- membership row, so it cannot be pointed at another company. A non-member gets
-- zero rows rather than a zeroed reading.

CREATE OR REPLACE FUNCTION public.workspace_storage_usage()
RETURNS TABLE (
  used_bytes  BIGINT,
  quota_bytes BIGINT,
  status      TEXT,
  has_plan    BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.workspace_petal_bytes(w.id),
         COALESCE(pl.quota_bytes, public.storage_free_tier_bytes()),
         COALESCE(pl.status, 'active'),
         (pl.workspace_id IS NOT NULL)
    FROM public.workspaces w
    LEFT JOIN public.workspace_storage_plans pl ON pl.workspace_id = w.id
   WHERE w.id = public.current_workspace_id()
     AND public.has_active_membership(w.id);
$$;

REVOKE ALL ON FUNCTION public.workspace_storage_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_storage_usage() TO authenticated, service_role;

COMMENT ON FUNCTION public.workspace_storage_usage() IS
  'Session 41: the company''s own view of its Petal-cloud plan — used, '
  'effective quota, status, and whether a plan row exists. has_plan is what '
  'lets the Admin Terminal say "free tier" rather than inventing a plan; the '
  'free-tier number itself is resolved here so the client never carries a copy.';

-- ── 9. What the operator sees ───────────────────────────────────────────────
-- The operator_workspace_summary() precedent (0028): a service_role-only
-- summary, because an operator is NOT a member of any workspace and holds no
-- workspace_id claim. Reading workspace_storage_plans through PostgREST as an
-- operator returns an EMPTY SET rather than an error — the panel would render
-- "no plan" for every company on the platform and look like working code.

CREATE OR REPLACE FUNCTION public.operator_storage_plan_summary()
RETURNS TABLE (
  workspace_id UUID,
  name         TEXT,
  slug         TEXT,
  suspended    BOOLEAN,
  status       TEXT,
  quota_bytes  BIGINT,
  used_bytes   BIGINT,
  has_plan     BOOLEAN,
  updated_at   TIMESTAMPTZ,
  updated_by   UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.id,
         w.name,
         w.slug,
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

-- Deleted companies are RETURNED, flagged, not filtered: their bytes are still
-- on Petal's bill until teardown runs, and a summary that hid them would make
-- storage look free exactly when it is not.
REVOKE EXECUTE ON FUNCTION public.operator_storage_plan_summary()
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.operator_storage_plan_summary() TO service_role;

COMMENT ON FUNCTION public.operator_storage_plan_summary() IS
  'Session 41: one row per company for the operator console''s storage panel. '
  'service_role only, on the operator_workspace_summary() precedent (0028) — an '
  'operator has no workspace claim, so a direct PostgREST read of the plan table '
  'returns an empty set rather than an error.';

-- ── 10. platform_audit: four new actions ────────────────────────────────────
-- 🚨 EXPLICIT DROP + ADD. See the header: a wrapped ADD is a silent no-op
-- against every already-migrated environment, and all three carry this
-- constraint already.

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
    'storage_plan.restored'));

-- ── 11. Post-conditions ─────────────────────────────────────────────────────
-- 🚨 This block is the only check in the change that runs against dev, staging
-- AND prod. The pgTAP suite proves the same properties, but pgTAP runs in CI
-- against one stack — so a privilege or policy mistake that only exists in an
-- applied environment would never reach it.

DO $$
DECLARE
  n         INT;
  v_ok      BOOLEAN;
  v_bytes   BIGINT;
BEGIN
  -- 1. RLS on and forced.
  SELECT relrowsecurity AND relforcerowsecurity INTO v_ok
    FROM pg_class WHERE oid = 'public.workspace_storage_plans'::regclass;
  IF NOT v_ok THEN
    RAISE EXCEPTION '0055 post-condition failed: workspace_storage_plans lacks ENABLE+FORCE RLS';
  END IF;

  -- 2. Exactly one policy, and it is a SELECT. The absence of a write policy IS
  --    the operator-ownership mechanism (the 0031 precedent) — if one ever
  --    appears, a workspace admin can set their own quota.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'workspace_storage_plans';
  IF n <> 1 THEN
    RAISE EXCEPTION '0055 post-condition failed: workspace_storage_plans must have exactly 1 policy, found %', n;
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'workspace_storage_plans'
     AND cmd <> 'SELECT';
  IF n <> 0 THEN
    RAISE EXCEPTION '0055 post-condition failed: % write policies on workspace_storage_plans; writes must go through service_role only', n;
  END IF;

  -- 3. Nothing held by anon or PUBLIC (the S22 grantee lesson).
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'workspace_storage_plans'
       AND grantee IN ('anon', 'PUBLIC')
  ) THEN
    RAISE EXCEPTION '0055 post-condition failed: anon or PUBLIC holds a privilege on workspace_storage_plans';
  END IF;

  -- 4. 🚨 The restrictive policy exists AND IS ACTUALLY RESTRICTIVE. Dropping
  --    `AS RESTRICTIVE` leaves a syntactically valid policy that ORs with the
  --    two permissive INSERT arms and enforces NOTHING — a green migration and
  --    an unmetered free tier.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'petal_storage_quota_insert'
     AND permissive = 'RESTRICTIVE' AND cmd = 'INSERT';
  IF n <> 1 THEN
    RAISE EXCEPTION '0055 post-condition failed: petal_storage_quota_insert is missing or not RESTRICTIVE';
  END IF;

  -- 5. 🚨 NULL-SAFETY, ASSERTED RATHER THAN REASONED ABOUT — both directions,
  --    because under a restrictive policy a NULL denies and the symptom is
  --    indistinguishable from the quota working.
  IF public.rabbit_quota_exempt_path(NULL) IS DISTINCT FROM false THEN
    RAISE EXCEPTION '0055 post-condition failed: rabbit_quota_exempt_path(NULL) is not false';
  END IF;
  IF public.rabbit_quota_exempt_path('projects/x/PROJECT.json') IS DISTINCT FROM true
     OR public.rabbit_quota_exempt_path('projects/x/INVOICES/l1/1-a.pdf') IS DISTINCT FROM true
     OR public.rabbit_quota_exempt_path('projects/x/FINANCE/RATES.json') IS DISTINCT FROM true THEN
    RAISE EXCEPTION '0055 post-condition failed: an exempt path is not exempt — the manifest or a money path would be refused over quota';
  END IF;
  -- ...and the hole the depth-only form would have opened stays shut.
  IF public.rabbit_quota_exempt_path('projects/x/dailies.mov') IS DISTINCT FROM false
     OR public.rabbit_quota_exempt_path('projects/x/ASSETS/a1/1-plate.png') IS DISTINCT FROM false THEN
    RAISE EXCEPTION '0055 post-condition failed: a media path is exempt — the quota can be walked around';
  END IF;

  -- ...and a workspace with no objects meters ZERO, not NULL. This is the probe
  -- that catches a dropped outer COALESCE, whose symptom is that no workspace
  -- can ever upload its first file.
  SELECT public.workspace_petal_bytes('00000000-0000-0000-0000-0000000000ff') INTO v_bytes;
  IF v_bytes IS DISTINCT FROM 0::bigint THEN
    RAISE EXCEPTION '0055 post-condition failed: workspace_petal_bytes is % for a workspace with no objects, expected 0 — a NULL here refuses every first upload', v_bytes;
  END IF;

  -- 6. 🚨 THE NEIGHBOUR COUNTS. 0053 and suite 63 count `rabbit_files%` and
  --    `rabbit_thumbnails%` bare and require 8 each. Asserting them HERE is what
  --    makes a later rename of this policy fail in the file that caused it,
  --    rather than in two files nobody is editing.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname LIKE 'rabbit_files%';
  IF n <> 8 THEN
    RAISE EXCEPTION '0055 post-condition failed: % rabbit_files%% policies, expected 8 — 0053 and suite 63 both assert this count bare', n;
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname LIKE 'rabbit_thumbnails%';
  IF n <> 8 THEN
    RAISE EXCEPTION '0055 post-condition failed: % rabbit_thumbnails%% policies, expected 8', n;
  END IF;

  -- 7. The action CHECK actually widened. 0031's own post-condition greps for
  --    'model.approved' and would keep passing while every storage_plan.* write
  --    failed, so this file must grep for its own values.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'platform_audit_action_check'
       AND pg_get_constraintdef(oid) LIKE '%storage_plan.set%'
       AND pg_get_constraintdef(oid) LIKE '%storage_plan.restored%'
  ) THEN
    RAISE EXCEPTION '0055 post-condition failed: platform_audit still rejects the storage_plan.* actions';
  END IF;

  -- ...and the widening did not LOSE anything. A DROP + ADD that retyped the
  -- list could silently drop a value, and the first thing to notice would be a
  -- teardown certificate that failed to write.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'platform_audit_action_check'
       AND pg_get_constraintdef(oid) LIKE '%workspace.teardown%'
       AND pg_get_constraintdef(oid) LIKE '%model.approved%'
       AND pg_get_constraintdef(oid) LIKE '%operator.revoked%'
  ) THEN
    RAISE EXCEPTION '0055 post-condition failed: the widening dropped an existing action value';
  END IF;

  -- 8. The operator summary is service_role-only. An authenticated grant here
  --    would hand every signed-in user the byte totals of every company.
  IF has_function_privilege('authenticated', 'public.operator_storage_plan_summary()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.operator_storage_plan_summary()', 'EXECUTE') THEN
    RAISE EXCEPTION '0055 post-condition failed: operator_storage_plan_summary is executable by a client role';
  END IF;

  RAISE NOTICE '0055 post-conditions passed';
END $$;
