-- =============================================================================
-- 0058_inflight_metering_had_no_caller.sql — Session 42, from its own pre-deploy
-- adversarial review.
--
-- 🚨 THIS FILE REMOVES TWO THINGS 0057 ADDED HOURS EARLIER, BECAUSE THEY WERE
-- BUILT ON A PREMISE THAT IS FALSE.
--
-- 0057 §4 taught public.workspace_petal_bytes to count
-- storage.s3_multipart_uploads.in_progress_size, on the stated ground that a
-- resumable upload accumulates there and produces no storage.objects row until
-- it completes — so N concurrent uploads would each pass a quota check blind to
-- the other N-1. 0057 §6/§6b then added the 'upload_abandoned' event term and
-- public.purge_abandoned_uploads() to give those fragments a lifecycle
-- (TPN-CONT-017).
--
-- ── WHAT IS ACTUALLY TRUE (measured against storage-api v1.68.1) ────────────
--
-- WILSON's resumable uploads NEVER WRITE THAT TABLE.
--
--   * WILSON posts to /storage/v1/upload/resumable (the TUS protocol) —
--     src/tools/rabbit_v0.1.0/storage/resumableUpload.js, and it is the only
--     resumable call site in the repo.
--   * storage-api builds that route's DataStore as
--     `new S3Store({ ..., cache: new AlsMemoryKV() })`, and
--     src/storage/protocols/tus/s3-store.ts is a five-line subclass of
--     @tus/s3-store that only strips a logger middleware. Upload state is held
--     in S3 `.info` objects plus an in-process cache. There is no Postgres
--     write on that path at all.
--   * storage.s3_multipart_uploads is written ONLY by the S3-COMPATIBLE
--     PROTOCOL handler (/storage/v1/s3/...), via createMultipartUpload. WILSON
--     never calls it: uploadNotices.js and supabaseProvider.js both state S3
--     multipart is not implemented, and no S3 credentials against rabbit-files
--     are ever minted.
--
-- So the UNION arm summed a table that is permanently empty, the sweep could
-- never find a fragment, and 'upload_abandoned' was a CHECK value with no
-- writer. MEASURED on wilson-dev at close-out: storage.s3_multipart_uploads
-- holds 0 rows, and the 04:39 cron ran once (2026-08-10T04:39Z, succeeded) and
-- swept nothing.
--
-- ── WHY REMOVE RATHER THAN LEAVE IT INERT ──────────────────────────────────
--
-- 1. 🚨 IT IS THE PATTERN THIS REPO PAYS MOST FOR. Nine features have shipped
--    here with no caller; 0057 made it ten and eleven, in the session whose own
--    brief quotes the rule. An inert arm is not neutral — it is a claim. 0057's
--    header says it closes a concurrency hole, pgTAP suite 66 asserted the
--    closure, and both were true only of fixtures the suite inserted itself.
--    Leaving working-looking code that closes nothing is worse than the gap.
--
-- 2. 🚨 IT PUT CI AT RISK OF NOT APPLYING THE MIGRATION AT ALL.
--    workspace_petal_bytes is LANGUAGE sql, so Postgres parse-analyzes its body
--    at CREATE time (check_function_bodies is on). `FROM
--    storage.s3_multipart_uploads` must therefore RESOLVE when the migration
--    runs — and .github/workflows/rls.yml starts the CI stack with
--    `supabase start --exclude realtime,storage-api,...`. That table is created
--    by storage-api's own migration runner, not by anything in
--    supabase/migrations/. Every check S42 ran (six breakers, tap-all, the
--    post-conditions) ran against HOSTED wilson-dev, where storage-api is
--    present. "Proven on dev" was not evidence about the environment that gates
--    the branch. After this file, no migration references that table.
--
-- 3. The disposal it promised is not WILSON's to make. TUS partials live in
--    Supabase's own S3 bucket with a 24h expiry
--    (`expirationPeriodInMilliseconds: tusUrlExpiryMs`), reaped by @tus/s3-store.
--    SQL cannot see them, cannot count them and cannot certify them.
--
-- ── WHAT THIS FILE DELIBERATELY DOES NOT TOUCH ─────────────────────────────
--
-- 0057's other four changes were measured, proven and are correct. They stay,
-- and post-condition 5 asserts each one survives this migration:
--   * rabbit-files file_size_limit = 53687091200 (50 GiB)
--   * storage_free_tier_bytes() = 5368709120 (5 GiB)
--   * the quota predicate weighs the incoming body (used + incoming <= quota)
--   * rabbit_object_incoming_bytes reads size OR contentLength, which is what
--     keeps the weighing alive at tus upload-creation time
--
-- ⚠️ THE CONCURRENCY HOLE IS THEREFORE OPEN, AND IS RECORDED AS OPEN in
-- docs/OUTSTANDING.md rather than papered over. Two 30 GiB uploads started
-- together against a 50 GiB quota both pass their creation check, because
-- neither is visible to the other until it completes. That was true before 0057
-- as well; 0057 did not fix it, it only appeared to.
-- =============================================================================

-- ── 1. The meter: committed objects only ────────────────────────────────────
-- Back to 0055's population, keeping 0057's safer byte reader (which cannot
-- raise on malformed metadata, unlike the raw `(metadata->>'size')::bigint`
-- cast it replaced).

CREATE OR REPLACE FUNCTION public.workspace_petal_bytes(ws UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- 🚨 THE OUTER COALESCE SURVIVES FROM 0055 AND IS LOAD-BEARING. SUM() over
  -- zero rows is NULL, `NULL < quota` is NULL, and NULL DENIES under a
  -- RESTRICTIVE policy — so without it no workspace could upload its FIRST FILE
  -- EVER, and the symptom is indistinguishable from the quota working.
  SELECT COALESCE(SUM(COALESCE(public.rabbit_object_incoming_bytes(o.metadata), 0)), 0)::bigint
    FROM storage.objects o
    JOIN public.projects p
      ON p.id = public.fn_try_uuid((storage.foldername(o.name))[2])
   WHERE o.bucket_id IN ('rabbit-files', 'rabbit-thumbnails')
     AND (storage.foldername(o.name))[1] = 'projects'
     AND p.workspace_id = ws;
$$;

-- 0056 closed this to client roles and that must hold: it takes an arbitrary
-- workspace id and does no membership check, so `authenticated` would make it an
-- RPC returning any company's total. Restated because CREATE OR REPLACE
-- re-touches the function and 0011's ALTER DEFAULT PRIVILEGES is still armed.
REVOKE ALL ON FUNCTION public.workspace_petal_bytes(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_petal_bytes(UUID) TO service_role;

COMMENT ON FUNCTION public.workspace_petal_bytes(UUID) IS
  'Session 42 (0058): bytes this workspace holds in Petal storage — COMMITTED '
  'objects in rabbit-files + rabbit-thumbnails only. 0057 also counted '
  'storage.s3_multipart_uploads.in_progress_size; that arm was removed because '
  'WILSON uploads over TUS, whose state lives in S3 .info objects, and that '
  'table is written only by the S3-compatible protocol handler WILSON never '
  'calls — so the arm summed a permanently empty set while claiming to close a '
  'concurrency hole. The hole is real and is recorded in OUTSTANDING.md. '
  '🚨 NOT EXECUTABLE BY A CLIENT ROLE (0056).';

-- ── 2. The sweep and its schedule ───────────────────────────────────────────
-- Unschedule BEFORE dropping: cron.job holds the call as text, so a dropped
-- function would leave a nightly job failing into cron.job_run_details where
-- nobody reads it.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wilson-purge-abandoned-uploads') THEN
    PERFORM cron.unschedule('wilson-purge-abandoned-uploads');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'could not unschedule wilson-purge-abandoned-uploads: %', SQLERRM;
END $$;

DROP FUNCTION IF EXISTS public.purge_abandoned_uploads(INTERVAL);

-- ── 3. The event vocabulary, back to 0047's seven ───────────────────────────
-- 🚨 SAFE ONLY BECAUSE THE SET IS EMPTY, AND THAT WAS MEASURED RATHER THAN
-- ASSUMED: public.file_events holds ZERO rows with event = 'upload_abandoned'
-- on wilson-dev (2026-08-10), and staging and prod never received 0057, so the
-- value cannot exist there either. A single such row would make the ADD below
-- fail — which is the correct behaviour, not something to force past.
--
-- Discovery-based drop, the 0047 pattern: drop ANY check constraint on
-- file_events whose definition mentions 'uploaded', not merely the one named
-- file_events_event_check. A name-only drop that misses leaves two vocabulary
-- constraints and the older one still governs.

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.file_events'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%uploaded%'
  LOOP
    EXECUTE format('ALTER TABLE public.file_events DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.file_events
  ADD CONSTRAINT file_events_event_check CHECK (event IN
    ('uploaded', 'downloaded', 'moved', 'relinked', 'trashed', 'restored',
     'purged'));

-- ── 4. Post-conditions ──────────────────────────────────────────────────────

DO $$
DECLARE
  n      INT;
  v_lim  BIGINT;
  v_free BIGINT;
BEGIN
  -- 1. 🚨 NOTHING IN public STILL REFERENCES storage.s3_multipart_uploads.
  --    This is the assertion that protects CI: a LANGUAGE sql body naming a
  --    table that does not exist in the gating stack fails at CREATE time and
  --    takes every pgTAP suite down with it.
  --    ⚠️ prokind = 'f' IS REQUIRED, NOT TIDINESS. pg_get_functiondef() RAISES
  --    `42809: "array_agg" is an aggregate function` for aggregates, and public
  --    holds some — so an unfiltered scan aborts the migration instead of
  --    checking it. Caught by dry-running this file before applying it.
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.prokind = 'f'
     AND pg_get_functiondef(p.oid) LIKE '%s3_multipart_uploads%';
  IF n <> 0 THEN
    RAISE EXCEPTION '0058 post-condition failed: % public function(s) still reference storage.s3_multipart_uploads — CI starts without storage-api and a LANGUAGE sql body would fail to create', n;
  END IF;

  -- 2. The sweep and its schedule are gone, together.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
              WHERE ns.nspname = 'public' AND p.proname = 'purge_abandoned_uploads') THEN
    RAISE EXCEPTION '0058 post-condition failed: purge_abandoned_uploads still exists';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT count(*) INTO n FROM cron.job WHERE jobname = 'wilson-purge-abandoned-uploads';
    IF n <> 0 THEN
      RAISE EXCEPTION '0058 post-condition failed: the nightly sweep is still scheduled and its function is gone — it would fail every night into a table nobody reads';
    END IF;
  END IF;

  -- 3. Exactly ONE vocabulary constraint, and it no longer carries the term.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.file_events'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%uploaded%';
  IF n <> 1 THEN
    RAISE EXCEPTION '0058 post-condition failed: % vocabulary constraints on file_events, expected exactly 1', n;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'file_events_event_check'
       AND pg_get_constraintdef(oid) LIKE '%upload_abandoned%'
  ) THEN
    RAISE EXCEPTION '0058 post-condition failed: upload_abandoned is still in the event vocabulary';
  END IF;

  -- ...and the narrowing did not lose 0047's or 0027's values.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'file_events_event_check'
       AND pg_get_constraintdef(oid) LIKE '%downloaded%'
       AND pg_get_constraintdef(oid) LIKE '%purged%'
       AND pg_get_constraintdef(oid) LIKE '%relinked%'
  ) THEN
    RAISE EXCEPTION '0058 post-condition failed: the narrowing dropped an existing event value';
  END IF;

  -- 4. The meter still works and still returns 0 (not NULL) for an empty
  --    workspace — the probe that catches a dropped outer COALESCE, whose only
  --    symptom is that nobody can ever upload their first file.
  IF public.workspace_petal_bytes('00000000-0000-0000-0000-0000000000ff')
     IS DISTINCT FROM 0::bigint THEN
    RAISE EXCEPTION '0058 post-condition failed: workspace_petal_bytes is not 0 for an empty workspace';
  END IF;

  -- 5. 🚨 0057's GOOD HALF MUST SURVIVE THIS FILE. A revert that overshoots is
  --    the S44 lesson — the defect in the fix — and here it would silently
  --    restore the 50 MB cap or the unweighed predicate.
  SELECT file_size_limit INTO v_lim FROM storage.buckets WHERE id = 'rabbit-files';
  IF v_lim IS DISTINCT FROM 53687091200::bigint THEN
    RAISE EXCEPTION '0058 post-condition failed: rabbit-files cap is %, expected 53687091200 — this migration must not undo 0057', v_lim;
  END IF;

  SELECT public.storage_free_tier_bytes() INTO v_free;
  IF v_free IS DISTINCT FROM 5368709120::bigint THEN
    RAISE EXCEPTION '0058 post-condition failed: free tier is %, expected 5368709120', v_free;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname = 'petal_storage_quota_insert'
       AND permissive = 'RESTRICTIVE' AND cmd = 'INSERT'
       AND with_check LIKE '%rabbit_object_incoming_bytes%'
  ) THEN
    RAISE EXCEPTION '0058 post-condition failed: the quota policy is missing, no longer RESTRICTIVE, or no longer weighs the incoming body';
  END IF;

  -- ...and the reader that keeps the weighing alive at tus upload-CREATION time,
  -- when only contentLength is present. Reading solely `size` there yields NULL,
  -- and a NULL DENIES under a restrictive policy.
  IF public.rabbit_object_incoming_bytes('{"contentLength":456}'::jsonb) IS DISTINCT FROM 456::bigint THEN
    RAISE EXCEPTION '0058 post-condition failed: rabbit_object_incoming_bytes no longer reads contentLength';
  END IF;

  -- 6. The policy predicates stay callable by `authenticated`; the unfiltered
  --    aggregate stays shut (0056, re-touched by section 1 above).
  IF NOT has_function_privilege('authenticated', 'public.rabbit_petal_storage_ok(uuid,bigint)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rabbit_object_incoming_bytes(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '0058 post-condition failed: a policy predicate is not executable by authenticated — every upload would be refused';
  END IF;

  IF has_function_privilege('authenticated', 'public.workspace_petal_bytes(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.workspace_petal_bytes(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0058 post-condition failed: workspace_petal_bytes is executable by a client role again — 0056 closed this';
  END IF;

  RAISE NOTICE '0058 post-conditions passed';
END $$;
