-- =============================================================================
-- 0078_quota_exemption_bounded_by_size.sql — Track C: the storage-quota
-- exemption is bounded by object size, so a receipt can no longer be
-- unrefusable at any size.
--
-- Audrey's ruling that lands here (asked and answered 2026-09-09, recorded in
-- the C4 review hand-off §3.10 and §4.3): bound the exemption by size rather
-- than cap the picker.
--
-- 🚨 THIS IS A NEW MIGRATION IN 0055's FAMILY, NOT AN EDIT TO 0055. 0055 is
-- applied on dev, staging and prod; its text is the recorded history row on
-- each. Migration number 0078 taken with Audrey's explicit permission
-- (2026-09-09) — the ledger in FIX_PLAN_2026-09-04.md had assigned 0078 onward
-- to Track D, which has no brief and has not started; Track D now begins at
-- 0079. That file's ledger is updated in the same commit as this one.
--
-- ── THE DEFECT ───────────────────────────────────────────────────────────────
-- Found by bundle C4's review round 1, which named it and did NOT fix it
-- because the remedy is a pricing decision. C4 made an expense receipt land
-- under an `INVOICES/` path segment so it would be money-gated. That is
-- correct and it is what C4 was for. But the money segment is also what
-- `public.rabbit_quota_exempt_path` (0055) keys on, and that function
-- short-circuits the RESTRICTIVE policy `petal_storage_quota_insert`. So
-- after C4:
--
--   * a receipt can NEVER be refused by the Petal storage quota, at any size;
--   * `public.workspace_petal_committed_bytes` has NO matching exemption, so
--     the receipt's bytes still consume the allowance that refuses ordinary
--     media.
--
-- Both halves matter. The second is why this is not merely a generous
-- allowance: the bytes are counted against the company and then cannot be
-- declined, so the company's own media uploads start failing because of a file
-- the quota was never allowed to refuse.
--
-- 🚨 NOT A SECURITY HOLE — 0037 gates `public.expenses` on
-- can_access_project_money(), and 0042's money policies gate the object, so
-- only a workspace admin or project manager can put a file there at all. It is
-- a BILLING hole. The distinction is why this is its own migration on its own
-- schedule rather than a hotfix inside C4.
--
-- ── HOW BIG THE HOLE ACTUALLY IS, MEASURED ───────────────────────────────────
-- Measured on wilson-dev 2026-09-09, not argued:
--   * `storage.buckets.file_size_limit` for `rabbit-files` is 53687091200 —
--     50 GiB. That is the per-object ceiling a money path could reach today.
--   * `BudgetView`'s receipt picker is `<input type="file" multiple>` with no
--     `accept` and no size cap, so nothing on the client narrows it either.
--   * pgTAP suite 77 probe 10 asserts, as a statement of the intended design,
--     that a **5 GB invoice is not refused**. That probe is corrected by this
--     migration's companion commit; it was true and is now wrong on purpose.
--
-- ── 🚨 TRAP 1: THE EXEMPTION HAS TWO ENFORCEMENT SITES, NOT ONE ──────────────
-- The C4 hand-off named one (the policy). There are two, and fixing only the
-- policy would be worse than fixing neither:
--
--   1. `petal_storage_quota_insert` (0055) — the RESTRICTIVE INSERT policy on
--      storage.objects, arm 2: `rabbit_quota_exempt_path(name)`.
--   2. `public.reserve_upload_bytes` (0073, C1) — returns NULL early for an
--      exempt path, so no reservation row is written and nothing is weighed.
--
-- Site 2 is what the CLIENT calls, from `supabaseProvider.js` (`reserveUpload`
-- at the top of the put), BEFORE any bytes move. Bounding only site 1 would
-- let a 5 GB receipt reserve nothing, upload for ten minutes and then be
-- refused at commit — which is the exact failure mode bundle C1 was built to
-- remove ("the second is refused at start, not after ten minutes", the C1 test
-- plan). Both sites are bounded here, by ONE predicate, in this one file.
--
-- ── 🚨 TRAP 2: AN UNKNOWN SIZE MUST KEEP THE EXEMPTION, NOT LOSE IT ──────────
-- This is the polarity that decides whether this migration is safe, and it is
-- the opposite of the intuitive one.
--
-- 0055's own header gives THREE reasons for the exemption, and only the first
-- is about size:
--   * money paths are tiny;
--   * `FINANCE/RATES.json` is a MIRROR that RabbitProvider rewrites whenever
--     rates change, so blocking it surfaces as a silent settings-save failure
--     in an unrelated subsystem;
--   * `projects/<id>/PROJECT.json` is WILSON's own bookkeeping, rewritten on
--     every project change; blocking it corrupts the folder view rather than
--     saving any bytes.
--
-- Reasons two and three are NOT about size and must survive intact. So the
-- rule here is: **exempt unless we positively know the object is too big.**
-- `COALESCE(p_bytes, 0)` is what implements it — an unknown size coalesces to
-- zero, which is under any bound, so the exemption is retained. A bare
-- comparison would yield NULL, and under a RESTRICTIVE policy A NULL DENIES:
-- every manifest write and every rates-mirror write with absent metadata would
-- start failing, with a symptom indistinguishable from the quota working. That
-- is 0055's NULL-safety lesson and 0057's `contentLength` lesson arriving
-- together through a third door.
--
-- Failing open on an unknown size is safe HERE, and this is the part that has
-- to be argued rather than asserted. Authorisation happens TWICE (0057):
--   * `canUpload` → `db.testPermission()` — a trial insert, rolled back. Its
--     metadata is `{mimetype, contentLength}` and contentLength comes from the
--     client's tus metadata, so a client CAN suppress or forge it here.
--   * `completeUpload` → `db.upsertObject()` — the row for real. Its metadata
--     is authored by storage-api, measured shape
--     `{eTag, size, mimetype, cacheControl, lastModified, contentLength,
--     httpStatusCode}` with `size` a JSON number (0055's own measurement on
--     staging). The client does not write it.
-- So a forged first phase buys nothing: the authoritative INSERT carries a
-- true `size` and is weighed. The worst case is that bytes move before the
-- refusal — the pre-C1 behaviour for that one forged upload, not a bypass.
--
-- ── 🚨 TRAP 3: `rabbit_quota_exempt_path` IS NOT CHANGED, AND THAT IS THE ────
-- ── POINT ────────────────────────────────────────────────────────────────────
-- The tempting shape is to add a bytes parameter to `rabbit_quota_exempt_path`
-- and be done. It is refused here for two reasons:
--   * That function is the PATH classifier and 0055 built it to delegate to
--     `rabbit_money_segment` so that adding a third reserved segment stays a
--     one-line change in ONE place. Size is a different axis; folding it in
--     makes the classifier answer two questions and makes neither auditable.
--   * pgTAP suite 65 pins it directly at probes 13–17 (NULL is false; the
--     manifest, INVOICES/ and FINANCE/ are true; `dailies.mov` and a depth-4
--     asset key are false) and suite 65 probe 24 pins its EXECUTE grant. Those
--     probes are about paths and stay exactly as they are, green, untouched.
-- So the classifier is kept and DELEGATED TO, and the size axis is a second,
-- separately auditable predicate composed over it.
--
-- ── WHAT THE BOUND IS, AND WHY THIS NUMBER ───────────────────────────────────
-- 26214400 bytes — 25 MiB — in ONE function,
-- `public.rabbit_quota_exempt_max_bytes()`, mirroring how
-- `public.storage_free_tier_bytes()` (0055) is the one definition of the free
-- tier rather than a literal repeated at each site.
--
-- Chosen against the real populations, all of which stay comfortably exempt:
--   * `PROJECT.json` measured 2,959 bytes on staging (0055's own measurement).
--     25 MiB is ~8,900x that.
--   * `FINANCE/RATES.json` is a rates mirror — kilobytes.
--   * An invoice PDF is single-digit MB; a phone photograph of a receipt is
--     2–12 MB; a multi-page scanned receipt bundle lands under 25 MiB.
-- And against what it refuses: the 50 GiB per-object ceiling drops by a factor
-- of 2048 for exempt paths. A "receipt" that is a feature-length video is now
-- weighed like the video it is.
--
-- ⚠️ WHAT THIS DOES NOT DO, STATED RATHER THAN LEFT TO BE DISCOVERED:
--   * An oversized money file is NOT rejected outright. It loses the
--     EXEMPTION and becomes subject to the ordinary quota — so it still
--     uploads whenever the company has room. "Bounded" is not "capped"; that
--     is precisely the difference Audrey chose.
--   * A money file UNDER the bound still consumes the allowance without being
--     refusable, because `workspace_petal_committed_bytes` keeps counting it
--     and gains no exemption here. That asymmetry is deliberate and is now
--     small and bounded (25 MiB per object) instead of unbounded. Making the
--     METER exempt small money files would raise every company's effective
--     quota, which is a pricing change nobody asked for.
--   * The INSERT-only limit of 0055/0057 is unchanged: an upsert that reuses
--     an existing key becomes an UPDATE and this policy does not apply to it.
--     `supabaseAdapter.uploadFile` mints a unique key per upload, which is
--     what keeps that theoretical. Not widened here.
--
-- ── WHY THERE IS NO row_security_active() GUARD IN THIS FILE ─────────────────
-- 0076 needed one because its evidence was ROW COUNTS from a backfill over
-- FORCE-RLS tables, and a non-bypassing role would have counted zero and
-- reported success. This migration writes no rows and counts none. Its
-- evidence is DDL and the behaviour of IMMUTABLE functions, both of which are
-- role-independent, and every post-condition below is a direct evaluation
-- rather than a count. Said explicitly so the omission reads as a decision.
--
-- =============================================================================
-- STATEMENTS
-- =============================================================================

-- ── 1. The bound, as the one definition ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rabbit_quota_exempt_max_bytes()
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT 26214400::bigint;   -- 25 MiB
$$;

REVOKE ALL ON FUNCTION public.rabbit_quota_exempt_max_bytes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rabbit_quota_exempt_max_bytes()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.rabbit_quota_exempt_max_bytes() IS
  'Track C 2026-09-09: the largest object that a quota-exempt path may be and '
  'still skip the Petal storage quota. 25 MiB. Audrey''s ruling: bound the '
  'exemption by size rather than cap the picker. Raising or lowering the bound '
  'is a change to THIS function and nothing else.';

-- ── 2. The bounded exemption, over a KNOWN byte count ───────────────────────
-- The composition point. `rabbit_quota_exempt_path` answers "is this a path
-- the quota must never refuse?"; this answers "and is it small enough for that
-- promise to be honest?".
--
-- 🚨 COALESCE(p_bytes, 0), NOT a bare comparison. See TRAP 2 in the header:
-- an unknown size KEEPS the exemption. Both operands of the AND are non-NULL
-- by construction (rabbit_quota_exempt_path COALESCEs its own result), so this
-- function never returns NULL — which is what makes it safe to place in a
-- RESTRICTIVE policy.

CREATE OR REPLACE FUNCTION public.rabbit_quota_exempt_bytes(obj_name TEXT, p_bytes BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT public.rabbit_quota_exempt_path(obj_name)
     AND COALESCE(p_bytes, 0) <= public.rabbit_quota_exempt_max_bytes();
$$;

REVOKE ALL ON FUNCTION public.rabbit_quota_exempt_bytes(TEXT, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rabbit_quota_exempt_bytes(TEXT, BIGINT)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.rabbit_quota_exempt_bytes(TEXT, BIGINT) IS
  'Track C 2026-09-09: TRUE when a path is quota-exempt (delegated to '
  'rabbit_quota_exempt_path, 0055) AND the object is within '
  'rabbit_quota_exempt_max_bytes(). An unknown size COALESCEs to 0 and so '
  'KEEPS the exemption: the manifest and the FINANCE rates mirror must never '
  'be blocked by absent metadata, and the authoritative commit-time INSERT '
  'carries a size authored by storage-api.';

-- ── 3. The same predicate over storage-api's own metadata ───────────────────
-- The policy has `metadata jsonb`, not a byte count. `rabbit_object_incoming_bytes`
-- (0057) is the ONE reader of that shape: it takes `size` when present and
-- falls back to `contentLength`, which is what the tus permission phase
-- carries, and returns NULL when neither is a plain integer.

CREATE OR REPLACE FUNCTION public.rabbit_quota_exempt_object(obj_name TEXT, md JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT public.rabbit_quota_exempt_bytes(obj_name, public.rabbit_object_incoming_bytes(md));
$$;

REVOKE ALL ON FUNCTION public.rabbit_quota_exempt_object(TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rabbit_quota_exempt_object(TEXT, JSONB)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.rabbit_quota_exempt_object(TEXT, JSONB) IS
  'Track C 2026-09-09: the storage.objects form of rabbit_quota_exempt_bytes — '
  'the size is read from storage-api''s metadata through '
  'rabbit_object_incoming_bytes (0057), so the bound is applied at BOTH the '
  'tus permission phase (contentLength) and at commit (size).';

-- ── 4. 🚨 The RESTRICTIVE policy, restated in full ──────────────────────────
-- DROP + CREATE with every arm written out, per the 0059 lesson: a policy
-- edited by recreating only the arm that changed is a policy whose other arms
-- were never re-read.
--
-- 🚨 ARM 1 STILL COMES FIRST AND STILL PASSES FOR EVERYTHING THIS POLICY IS
-- NOT ABOUT. A RESTRICTIVE policy is evaluated for EVERY INSERT into
-- storage.objects, and three buckets share that table. Without
-- `bucket_id <> 'rabbit-files'` written to PASS, the first avatar upload in an
-- over-quota workspace starts failing with an RLS error naming the wrong
-- bucket. Suite 65 probe 29 and suite 66 probes 21–22 exist for this arm.
--
-- 🚨 THE NAME IS UNCHANGED AND MUST STAY UNCHANGED. 0053's post-condition 7
-- and pgTAP suite 63 probe 7 both count `policyname LIKE 'rabbit_files%'` with
-- no further filter and assert exactly 8. Renaming this policy into that
-- family makes both read 9 and fail, in files this migration is not editing.
-- Post-condition 8 below re-asserts that count.

DROP POLICY IF EXISTS petal_storage_quota_insert ON storage.objects;
CREATE POLICY petal_storage_quota_insert ON storage.objects
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    bucket_id <> 'rabbit-files'
    OR public.rabbit_quota_exempt_object(name, metadata)
    OR public.rabbit_petal_storage_ok(
         public.fn_try_uuid((storage.foldername(name))[2]),
         public.rabbit_object_incoming_bytes(metadata),
         name)
  );

COMMENT ON POLICY petal_storage_quota_insert ON storage.objects IS
  'Session 41 / Track C 2026-09-09: the Petal-cloud quota and suspension gate. '
  'RESTRICTIVE because rabbit-files INSERT already has two permissive arms and '
  'permissive policies OR together — a ninth permissive policy would be '
  'satisfied by either and enforce nothing (the 0038 inversion). This ANDs '
  'over all of them. The exemption arm is bounded by object size (0078): a '
  'money path over rabbit_quota_exempt_max_bytes() is weighed like ordinary '
  'media rather than admitted unconditionally.';

-- ── 5. The reservation site ─────────────────────────────────────────────────
-- 🚨 THE SECOND ENFORCEMENT SITE (TRAP 1). Reproduced from the live definition
-- on dev with exactly ONE line changed — the exemption test — so that a money
-- path over the bound is reserved and weighed instead of returning NULL.
--
-- `p_bytes` is guaranteed NOT NULL and > 0 by the 22023 guard above the
-- exemption test, so at THIS site the size is always known and TRAP 2's
-- unknown-size case cannot arise. The COALESCE inside
-- rabbit_quota_exempt_bytes is therefore belt to this function's braces.
--
-- Falling through the exemption puts an oversized money file on the ordinary
-- path: can_write_project, the per-workspace advisory lock, the plan lookup,
-- the suspension arm and then `rabbit_petal_storage_ok` — so it is refused
-- with the same PT402 sentence, naming the file and the headroom, that the
-- client already renders (`reserveUpload` throws the server's own message and
-- the upload never starts). No client change is needed for the refusal path.

CREATE OR REPLACE FUNCTION public.reserve_upload_bytes(p_path TEXT, p_bytes BIGINT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_project  UUID;
  v_ws       UUID;
  v_status   TEXT;
  v_quota    BIGINT;
  v_used     BIGINT;
  v_id       BIGINT;
  v_leaf     TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'reserve_upload_bytes: not signed in'
      USING ERRCODE = '42501';
  END IF;

  IF p_bytes IS NULL OR p_bytes <= 0 THEN
    RAISE EXCEPTION 'reserve_upload_bytes: bytes must be a positive count'
      USING ERRCODE = '22023';
  END IF;

  IF p_path IS NULL
     OR (storage.foldername(p_path))[1] IS DISTINCT FROM 'projects'
     OR char_length(p_path) > 1024 THEN
    RAISE EXCEPTION 'reserve_upload_bytes: not a project object path'
      USING ERRCODE = '22023';
  END IF;

  v_project := public.fn_try_uuid((storage.foldername(p_path))[2]);
  SELECT p.workspace_id INTO v_ws FROM public.projects p WHERE p.id = v_project;

  -- The caller must be a member of the workspace their claim names, and the
  -- project must be in it. Same shape as rabbit_files_insert (0042). 🚨 0047's
  -- RPC lesson: a NULL from a predicate DENIES in a policy and PASSES in an
  -- `IF NOT`, so every predicate here is COALESCEd to false.
  IF v_ws IS NULL
     OR v_ws IS DISTINCT FROM public.current_workspace_id()
     OR NOT COALESCE(public.has_active_membership(v_ws), false) THEN
    RAISE EXCEPTION 'reserve_upload_bytes: you cannot write to this project'
      USING ERRCODE = '42501';
  END IF;

  -- Money paths and the manifest are exempt from the quota (0055) UP TO
  -- rabbit_quota_exempt_max_bytes() (0078), so they are reservation-exempt on
  -- the same bound: nothing to weigh, nothing to write. Over the bound this
  -- falls through and is weighed like ordinary media. The object itself is
  -- still gated by rabbit_files_money_insert at commit either way.
  IF public.rabbit_quota_exempt_bytes(p_path, p_bytes) THEN
    RETURN NULL;
  END IF;

  IF NOT COALESCE(public.can_write_project(v_project), false) THEN
    RAISE EXCEPTION 'reserve_upload_bytes: you cannot write to this project'
      USING ERRCODE = '42501';
  END IF;

  -- Serialise reservations per workspace: two reserves racing through the
  -- check below would otherwise both pass, which is the hole one layer up.
  PERFORM pg_advisory_xact_lock(hashtext('upload_reservations:' || v_ws::text));

  SELECT COALESCE(pl.status, 'active'),
         COALESCE(pl.quota_bytes, public.storage_free_tier_bytes())
    INTO v_status, v_quota
    FROM public.workspace_storage_plans pl
   WHERE pl.workspace_id = v_ws;
  IF v_status IS NULL THEN
    v_status := 'active';
    v_quota  := public.storage_free_tier_bytes();
  END IF;

  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'Petal cloud storage for this company is suspended — contact Petal.'
      USING ERRCODE = 'PT402';
  END IF;

  -- THE ONE PREDICATE. The policy will re-evaluate exactly this at creation and
  -- at completion; a reservation that lapses cannot admit an over-quota object.
  IF NOT public.rabbit_petal_storage_ok(v_project, p_bytes, p_path) THEN
    v_used := public.workspace_petal_committed_bytes(v_ws)
            + public.workspace_upload_reserved_bytes(v_ws, p_path);
    v_leaf := regexp_replace(p_path, '^.*/', '');
    -- 🚨 NEVER TELL THEM TO DELETE FILES: a cloud delete is soft and the object
    -- holds quota for 30 days (uploadNotices.js says the same, for the same
    -- reason). Two facts, two sentences, as classifyUpload does.
    IF v_used >= v_quota THEN
      RAISE EXCEPTION 'This company has used all % of its Petal cloud storage (uploads in progress count). Contact Petal to raise the plan — deleting files does not free space straight away, because deleted files stay recoverable for 30 days.',
        pg_size_pretty(v_quota)
        USING ERRCODE = 'PT402';
    ELSE
      RAISE EXCEPTION 'Not enough Petal cloud storage for "%": it needs %, but only % of this company''s % is left once uploads already in progress are counted. Add a smaller file, or contact Petal to raise the plan — deleting files does not free space straight away, because deleted files stay recoverable for 30 days.',
        v_leaf, pg_size_pretty(p_bytes), pg_size_pretty(v_quota - v_used), pg_size_pretty(v_quota)
        USING ERRCODE = 'PT402';
    END IF;
  END IF;

  INSERT INTO public.upload_reservations
    (workspace_id, project_id, storage_path, bytes, created_by)
  VALUES
    (v_ws, v_project, p_path, p_bytes, v_uid)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.reserve_upload_bytes(TEXT, BIGINT) IS
  'Session C1 (0073) / Track C 2026-09-09 (0078): reserve quota for an upload '
  'before the bytes move. Quota-exempt paths return NULL and write no row — '
  'but only up to rabbit_quota_exempt_max_bytes(); over that bound a money '
  'path is weighed like ordinary media, so the refusal happens at start '
  'rather than after the transfer.';

-- =============================================================================
-- POST-CONDITIONS
-- =============================================================================
-- Every assertion below is a direct evaluation of the thing it claims. Where
-- an assertion is about a policy or a function BODY it reads the catalogue's
-- own rendering (pg_get_expr / prosrc), never the object's name — C4's review
-- round 2 found a post-condition asserting a constraint's NAME while the
-- behaviour it cared about lived in the definition.

DO $$
DECLARE
  v_check   TEXT;
  v_src     TEXT;
  v_n       INT;
BEGIN
  -- 1. The bound exists, is positive, and is the value this file documents.
  IF public.rabbit_quota_exempt_max_bytes() IS DISTINCT FROM 26214400::bigint THEN
    RAISE EXCEPTION '0078 post-condition 1 failed: rabbit_quota_exempt_max_bytes() is %, expected 26214400',
      public.rabbit_quota_exempt_max_bytes();
  END IF;

  -- 2. 🚨 THE TRUTH TABLE OF THE BOUNDED PREDICATE. This is the migration's
  --    whole behaviour, asserted case by case rather than described.
  --    2a. A small money file is STILL exempt — the promise 0055 made.
  IF NOT public.rabbit_quota_exempt_bytes(
       'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/l1/1-inv.pdf', 4000) THEN
    RAISE EXCEPTION '0078 post-condition 2a failed: a small invoice is not exempt';
  END IF;

  --    2b. AN OVERSIZED MONEY FILE IS NOT. This is the defect, closed.
  IF public.rabbit_quota_exempt_bytes(
       'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/l1/1-inv.pdf',
       public.rabbit_quota_exempt_max_bytes() + 1) THEN
    RAISE EXCEPTION '0078 post-condition 2b failed: an oversized invoice is still exempt — the hole is open';
  END IF;

  --    2c. Exactly at the bound is exempt: the bound is a ceiling, not a wall.
  IF NOT public.rabbit_quota_exempt_bytes(
       'projects/aaaa1111-0000-0000-0000-000000000001/FINANCE/RATES.json',
       public.rabbit_quota_exempt_max_bytes()) THEN
    RAISE EXCEPTION '0078 post-condition 2c failed: an object exactly at the bound lost the exemption';
  END IF;

  --    2d. 🚨 AN UNKNOWN SIZE KEEPS THE EXEMPTION (TRAP 2). Without this the
  --        rates mirror and the manifest fail whenever metadata is absent.
  IF NOT public.rabbit_quota_exempt_bytes(
       'projects/aaaa1111-0000-0000-0000-000000000001/PROJECT.json', NULL) THEN
    RAISE EXCEPTION '0078 post-condition 2d failed: an unknown size LOST the exemption — a NULL denies under the restrictive policy';
  END IF;

  --    2e. The size axis cannot GRANT an exemption a path never had. A tiny
  --        media file is still not exempt; the AND is an AND.
  IF public.rabbit_quota_exempt_bytes(
       'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/1-plate.png', 1) THEN
    RAISE EXCEPTION '0078 post-condition 2e failed: a small ORDINARY media file became exempt';
  END IF;

  --    2f. And neither does the depth-3 media key 0055's header warns about.
  IF public.rabbit_quota_exempt_bytes(
       'projects/aaaa1111-0000-0000-0000-000000000001/dailies.mov', 1) THEN
    RAISE EXCEPTION '0078 post-condition 2f failed: a depth-3 media key became exempt';
  END IF;

  --    2g. NULL-safety of the whole predicate: never NULL, in either axis.
  IF public.rabbit_quota_exempt_bytes(NULL, 1) IS DISTINCT FROM false
     OR public.rabbit_quota_exempt_bytes(NULL, NULL) IS DISTINCT FROM false THEN
    RAISE EXCEPTION '0078 post-condition 2g failed: a NULL path did not yield false';
  END IF;

  -- 3. The jsonb form reads BOTH metadata shapes — commit-time `size` and the
  --    tus permission phase's `contentLength` (0057). A form that read only
  --    `size` would be NULL at the permission phase and, under the RESTRICTIVE
  --    policy, would DENY every resumable money upload.
  IF public.rabbit_quota_exempt_object(
       'projects/x/INVOICES/l1/1-inv.pdf',
       jsonb_build_object('size', public.rabbit_quota_exempt_max_bytes() + 1)) THEN
    RAISE EXCEPTION '0078 post-condition 3a failed: an oversized `size` is still exempt';
  END IF;
  IF public.rabbit_quota_exempt_object(
       'projects/x/INVOICES/l1/1-inv.pdf',
       jsonb_build_object('contentLength', public.rabbit_quota_exempt_max_bytes() + 1)) THEN
    RAISE EXCEPTION '0078 post-condition 3b failed: an oversized `contentLength` is still exempt — the tus permission phase is unbounded';
  END IF;
  IF NOT public.rabbit_quota_exempt_object('projects/x/INVOICES/l1/1-inv.pdf', '{}'::jsonb)
     OR NOT public.rabbit_quota_exempt_object('projects/x/INVOICES/l1/1-inv.pdf', NULL) THEN
    RAISE EXCEPTION '0078 post-condition 3c failed: absent metadata lost the exemption';
  END IF;
  IF NOT public.rabbit_quota_exempt_object(
       'projects/x/INVOICES/l1/1-inv.pdf', jsonb_build_object('size', 4000)) THEN
    RAISE EXCEPTION '0078 post-condition 3d failed: a small invoice lost the exemption';
  END IF;

  -- 4. 🚨 THE PATH CLASSIFIER IS UNCHANGED (TRAP 3). Everything above
  --    delegates to it; if this migration had quietly altered it, suites 65
  --    and 66 would be pinning a different function than the one they name.
  IF public.rabbit_quota_exempt_path(NULL) IS DISTINCT FROM false
     OR NOT public.rabbit_quota_exempt_path('projects/x/INVOICES/l1/1-a.pdf')
     OR NOT public.rabbit_quota_exempt_path('projects/x/FINANCE/RATES.json')
     OR NOT public.rabbit_quota_exempt_path('projects/x/PROJECT.json')
     OR public.rabbit_quota_exempt_path('projects/x/dailies.mov') THEN
    RAISE EXCEPTION '0078 post-condition 4 failed: rabbit_quota_exempt_path no longer behaves as 0055 defined it';
  END IF;

  -- 5. The policy exists, is RESTRICTIVE and is FOR INSERT. Permissive would
  --    turn the exemption into a GRANT (0055's breaker B1, suite 65 probe 30).
  SELECT pg_get_expr(pol.polwithcheck, pol.polrelid)
    INTO v_check
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'storage' AND c.relname = 'objects'
     AND pol.polname = 'petal_storage_quota_insert'
     AND pol.polpermissive = false
     AND pol.polcmd = 'a';
  IF v_check IS NULL THEN
    RAISE EXCEPTION '0078 post-condition 5 failed: petal_storage_quota_insert is missing, permissive, or not FOR INSERT';
  END IF;

  -- 6. 🚨 THE POLICY'S DEFINITION, not its name, carries the bound. Asserted
  --    in BOTH directions: the bounded predicate is present AND the unbounded
  --    one is gone. Presence alone would pass if someone left both arms in,
  --    which ORs the hole straight back open.
  IF v_check NOT LIKE '%rabbit_quota_exempt_object%' THEN
    RAISE EXCEPTION '0078 post-condition 6a failed: the policy does not use the bounded exemption. Definition: %', v_check;
  END IF;
  IF v_check LIKE '%rabbit_quota_exempt_path%' THEN
    RAISE EXCEPTION '0078 post-condition 6b failed: the policy still carries the UNBOUNDED exemption arm, which ORs the hole back open. Definition: %', v_check;
  END IF;

  -- 7. The self-limiting arm survives. Three buckets share storage.objects and
  --    a RESTRICTIVE policy is evaluated for every INSERT into it.
  IF v_check NOT LIKE '%rabbit-files%' THEN
    RAISE EXCEPTION '0078 post-condition 7 failed: the bucket self-limiting arm is gone — avatars and thumbnails will start failing. Definition: %', v_check;
  END IF;

  -- 8. The neighbour count 0053's post-condition 7 and suite 63 probe 7 assert.
  SELECT count(*)::int INTO v_n
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname LIKE 'rabbit_files%';
  IF v_n <> 8 THEN
    RAISE EXCEPTION '0078 post-condition 8 failed: % policies named rabbit_files%%, expected 8', v_n;
  END IF;

  -- 9. 🚨 THE SECOND ENFORCEMENT SITE (TRAP 1), asserted the same way and in
  --    both directions. Reading prosrc is what distinguishes "the function was
  --    replaced" from "the function still exists".
  SELECT p.prosrc INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'reserve_upload_bytes';
  IF v_src IS NULL THEN
    RAISE EXCEPTION '0078 post-condition 9 failed: reserve_upload_bytes is missing';
  END IF;
  IF v_src NOT LIKE '%rabbit_quota_exempt_bytes(p_path, p_bytes)%' THEN
    RAISE EXCEPTION '0078 post-condition 9a failed: reserve_upload_bytes does not use the bounded exemption — a 5 GB receipt still reserves nothing';
  END IF;
  IF v_src LIKE '%rabbit_quota_exempt_path(p_path)%' THEN
    RAISE EXCEPTION '0078 post-condition 9b failed: reserve_upload_bytes still carries the UNBOUNDED early return';
  END IF;

  -- 10. Grants. A policy expression runs as the INVOKER, so `authenticated`
  --     must be able to execute every function the policy names or every
  --     upload fails with a permission error instead of a quota one. And anon
  --     must not — REVOKE ... FROM PUBLIC is what makes that true, since anon
  --     inherits PUBLIC rather than holding its own grant.
  IF NOT has_function_privilege('authenticated', 'public.rabbit_quota_exempt_max_bytes()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rabbit_quota_exempt_bytes(text,bigint)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rabbit_quota_exempt_object(text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '0078 post-condition 10a failed: authenticated cannot execute one of the new functions — every upload would fail';
  END IF;
  IF has_function_privilege('anon', 'public.rabbit_quota_exempt_bytes(text,bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rabbit_quota_exempt_object(text,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rabbit_quota_exempt_max_bytes()', 'EXECUTE') THEN
    RAISE EXCEPTION '0078 post-condition 10b failed: anon can execute a quota function';
  END IF;

  -- 11. Volatility. A policy expression is evaluated per row; all three must be
  --     IMMUTABLE and PARALLEL SAFE like the 0055/0057 neighbours they sit
  --     beside, or the planner loses options on every storage write.
  SELECT count(*)::int INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('rabbit_quota_exempt_max_bytes', 'rabbit_quota_exempt_bytes',
                       'rabbit_quota_exempt_object')
     AND p.provolatile = 'i' AND p.proparallel = 's';
  IF v_n <> 3 THEN
    RAISE EXCEPTION '0078 post-condition 11 failed: % of 3 new functions are IMMUTABLE PARALLEL SAFE', v_n;
  END IF;

  RAISE NOTICE '0078 OK — the quota exemption is bounded at % bytes at BOTH sites (the RESTRICTIVE policy and reserve_upload_bytes); rabbit_quota_exempt_path is unchanged; 8 rabbit_files policies intact.',
    public.rabbit_quota_exempt_max_bytes();
END$$;
