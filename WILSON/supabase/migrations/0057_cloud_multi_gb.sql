-- =============================================================================
-- 0057_cloud_multi_gb.sql — Session 42
-- Petal cloud can hold the customer's actual media.
--
-- Audrey, 2026-08-05 (design §3.6 Path 2):
--   "i need to be able to store media so 50MB is not acceptable. im going to
--    have multiple GB files at times."
-- and, when told cloud was the small-file tier:
--   "what if the company selected a cloud storage solution? they cant save
--    large files thats not acceptable."
--
-- Four decisions, all Audrey's, taken 2026-08-09 at the head of this session:
--   1. The org is on Supabase **Pro**, so the ceiling can move at all.
--   2. Per-file cap: 50 GiB (53687091200).
--   3. The quota now WEIGHS THE INCOMING BODY (`used + incoming <= quota`).
--   4. The rowless free tier rises 1 GiB -> 5 GiB, so a trial can still hold
--      real footage next to a 50 GiB per-file cap.
--
-- =============================================================================
-- 🚨 THIS MIGRATION CANNOT RAISE THE CEILING ON ITS OWN. READ THIS FIRST.
-- =============================================================================
--
-- `storage.buckets.file_size_limit` is capped by a PROJECT-LEVEL global limit
-- that lives in the Supabase dashboard (Project Settings -> Storage -> upload
-- file size limit), NOT in the database and NOT in any migration. Supabase's own
-- troubleshooting note: "The global limit takes precedence." So the UPDATE below
-- applies cleanly, every post-condition passes, `storage.buckets` reports
-- 53687091200 — and storage-api still refuses anything over the global figure.
--
-- 🚨 THAT IS A GREEN MIGRATION OVER A DEAD PATH, which is this repo's costliest
-- pattern (nine features have shipped with no caller). The global limit must be
-- raised BY HAND on dev, staging AND prod. It is deliberately NOT automated
-- here: the only CLI route is `supabase config push`, which is the command that
-- silently reset wilson-dev's auth configuration in S19 and is under a standing
-- ban in MASTER_PLAN.md.
--
-- Post-condition 1 records the value this file WROTE. It cannot observe the
-- global limit, and nothing in SQL can. The only proof that multi-GB works is a
-- real large file through the real client — close-out ritual item 5.
--
-- =============================================================================
-- 🚨 REPLAY ORDERING — 0027 IS NOW A LOADED GUN
-- =============================================================================
--
-- 0027 sets the bucket with `INSERT ... ON CONFLICT (id) DO UPDATE SET public,
-- file_size_limit` and VALUES (..., 52428800). Re-running 0027 against a
-- migrated database therefore RESETS the cap to 50 MB, silently, with a green
-- result. A re-run of 0027 MUST be followed by a re-run of 0057.
-- (Same class as 0002->0029, 0011->0030, 0028->0031->0055; handbook §replay.)
--
-- 0027 is NOT edited, deliberately: it is applied on all three environments, so
-- editing it would change nothing anywhere while making the file lie about what
-- is deployed — the exact reasoning 0056's header gives for existing at all.
--
-- =============================================================================
-- 🚨 WHAT THE RESUMABLE (TUS) PATH ACTUALLY DOES — MEASURED, NOT ASSUMED
-- =============================================================================
--
-- Read out of storage-api v1.68.1 (the version `supabase/.temp/storage-version`
-- reports for these projects), because the brief's landmine #1 asks exactly this
-- and guessing it wrong ships an unmetered multi-gigabyte free tier.
--
--   * Authorisation happens TWICE. `onIncomingRequest` calls
--     `uploader.canUpload(...)`, which runs `db.testPermission()` — the intended
--     row insert inside a transaction that is rolled back, so ordinary RLS
--     decides it. `onUploadFinish` then calls `uploader.completeUpload(...)`,
--     which writes the row for real.
--
--   * 🚨 `completeUpload` calls `db.upsertObject(...)` REGARDLESS of the
--     `isUpsert` flag. So `upsert:false` is NOT what keeps this policy binding.
--     What keeps it binding is that supabaseAdapter.uploadFile mints a UNIQUE
--     key per upload (`projects/<id>/<entity>/<entityId>/<Date.now()>-<name>`):
--     with no conflicting row the upsert takes its INSERT branch, and a
--     RESTRICTIVE INSERT policy applies. The day anything reuses a key, that
--     write becomes an UPDATE and this quota stops existing for it, silently.
--     Post-condition 7 and pgTAP suite 66 pin the uniqueness assumption; the
--     UPDATE arm is stated as a limit rather than papered over, because
--     `rabbit_files_update` is the policy that governs it and widening this one
--     to UPDATE would meter every rename and re-tag as if it were new bytes.
--
--   * 🚨 THE PERMISSION TEST CARRIES `contentLength`, NOT `size`. The tus
--     lifecycle passes `metadata: { mimetype: contentType, contentLength }` into
--     canUpload, while the COMMITTED object metadata that 0055's meter reads
--     carries `size` (measured on staging: {eTag, size, mimetype, cacheControl,
--     lastModified, contentLength, httpStatusCode}). A weighing predicate that
--     read only `metadata->>'size'` would therefore be NULL at upload creation —
--     and under a RESTRICTIVE policy A NULL DENIES — so EVERY resumable upload
--     would be refused, with a symptom indistinguishable from the quota working
--     correctly. That is 0055's own NULL-safety lesson arriving a second time
--     through a different door.
--
--     public.rabbit_object_incoming_bytes() reads size OR contentLength, so the
--     weighing fires at BOTH phases. The bonus is not cosmetic: an over-quota
--     50 GiB upload is now refused BEFORE the bytes move, instead of after an
--     hours-long transfer.
--
-- =============================================================================
-- 🚨 IN-FLIGHT BYTES ARE REAL BYTES, AND 0055's METER COULD NOT SEE THEM
-- =============================================================================
--
-- A resumable upload accumulates in `storage.s3_multipart_uploads`
-- (`in_progress_size BIGINT NOT NULL`, plus `bucket_id`, `key`, `created_at`)
-- and produces NO `storage.objects` row until it completes. 0055's meter reads
-- `storage.objects` only, so ten 40 GiB uploads in flight meter as ZERO.
--
-- At a 50 MB per-object cap that was unreachable. At 50 GiB it is the ordinary
-- case, and it defeats the quota by CONCURRENCY rather than by size: every
-- in-flight upload's creation check sees a total that excludes all the others.
--
-- So the meter now counts them. Three consequences, all wanted:
--   * the quota binds against bytes Petal is genuinely holding;
--   * TPN-CONT-017's partial objects become countable, which is the thing that
--     made them uncertifiable;
--   * an abandoned upload keeps consuming quota until it is swept — which is
--     precisely why the sweep in section 6 is part of THIS migration and not a
--     later one. A lifecycle term retrofitted after the feature ships working is
--     a term nobody writes.
--
-- =============================================================================
-- MEASURED FACTS THIS FILE DEPENDS ON (wilson-dev, 2026-08-09)
-- =============================================================================
--   * rabbit-files file_size_limit = 52428800; storage_free_tier_bytes() =
--     1073741824; rabbit_petal_storage_ok exists ONLY as (uuid).
--   * storage.objects has exactly ONE restrictive policy, this session's
--     predecessor petal_storage_quota_insert; rabbit_files% = 8 and
--     rabbit_thumbnails% = 8 (0053/suite 63 assert both bare).
--   * file_events_event_check is 0047's SEVEN-value list including 'downloaded'
--     — NOT 0027's six. The brief cites 0027:85-86; that constraint is gone.
--   * storage.s3_multipart_uploads: RLS enabled, FORCE off, ZERO policies, owner
--     supabase_storage_admin, service_role holds DELETE.
--   * pg_cron is installed with five wilson-purge-* jobs at 04:43-04:59 UTC.
--   * postgres has rolbypassrls, so every SECURITY DEFINER function here reads
--     storage.* and public.projects unfiltered.
-- =============================================================================

-- ── 1. The bucket cap: 50 MiB -> 50 GiB ─────────────────────────────────────
-- An UPDATE, not 0027's INSERT ... ON CONFLICT. The bucket exists on all three
-- environments, so the insert arm is dead code here, and an UPDATE that matches
-- no row is visible to post-condition 1 rather than silently creating a bucket
-- with no policies attached.

UPDATE storage.buckets
   SET file_size_limit = 53687091200      -- 50 GiB
 WHERE id = 'rabbit-files';

-- rabbit-thumbnails stays at 262144 and user-avatars at 2097152, deliberately.
-- A thumbnail is a 256px JPEG; an avatar is a photograph of a person. Neither
-- has any business growing because project media did.

-- ── 2. The free tier: 1 GiB -> 5 GiB ────────────────────────────────────────
-- Audrey, 2026-08-09. At a 50 GiB per-file cap a 1 GiB allowance cannot hold ONE
-- ordinary clip, so the free tier would have stopped being a funnel and started
-- being a broken first day — the thing §4a3 decision 1 exists to prevent.
-- ~20 free companies still fit inside Pro's included 100 GB.
--
-- Still the ONE definition: the client never hard-codes it, it reads the
-- resolved figure back from workspace_storage_usage().

CREATE OR REPLACE FUNCTION public.storage_free_tier_bytes()
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT 5368709120::bigint;   -- 5 GiB
$$;

COMMENT ON FUNCTION public.storage_free_tier_bytes() IS
  'Session 42: the Petal-cloud allowance for a workspace with no plan row — '
  'raised 1 GiB -> 5 GiB because a 50 GiB per-file cap makes a 1 GiB trial '
  'unable to hold a single clip. The ONE definition; the client reads the '
  'resolved quota from workspace_storage_usage() rather than carrying a copy.';

-- ── 3. How many bytes is the object being written? ──────────────────────────
-- 🚨 NEVER RAISES, and that is the whole point. This is called from inside a
-- RESTRICTIVE policy expression: an exception here does not fail open or closed,
-- it fails the INSERT with a cast error nobody can read. A non-numeric value
-- yields NULL, which section 5 treats as "unknown" and answers with 0055's
-- original unweighed test.
--
-- Reads `size` OR `contentLength` because storage-api populates DIFFERENT KEYS
-- at the two moments this policy runs — see the header. One definition, so the
-- meter in section 4 and the gate in section 5 can never disagree about how a
-- byte count is read out of that jsonb.

CREATE OR REPLACE FUNCTION public.rabbit_object_incoming_bytes(md JSONB)
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE WHEN v ~ '^[0-9]+$' THEN v::bigint ELSE NULL END
    FROM (SELECT NULLIF(COALESCE(md ->> 'size', md ->> 'contentLength'), '') AS v) t;
$$;

REVOKE ALL ON FUNCTION public.rabbit_object_incoming_bytes(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rabbit_object_incoming_bytes(JSONB)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.rabbit_object_incoming_bytes(JSONB) IS
  'Session 42: the declared byte count of an object being written, from '
  'metadata->>''size'' or ->>''contentLength'' — storage-api populates the '
  'second at tus upload creation and both at completion, so reading only '
  '''size'' returns NULL at creation and a RESTRICTIVE policy DENIES on NULL. '
  'Returns NULL rather than raising for anything non-numeric; the caller treats '
  'NULL as unknown and falls back to the unweighed test.';

-- ── 4. The meter, now including bytes still in flight ───────────────────────

CREATE OR REPLACE FUNCTION public.workspace_petal_bytes(ws UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- 🚨 THE OUTER COALESCE IS LOAD-BEARING AND SURVIVES FROM 0055. SUM() over
  -- zero rows is NULL, `NULL < quota` is NULL, and NULL DENIES under a
  -- restrictive policy — so without it no workspace could upload its FIRST FILE
  -- EVER, and the symptom is indistinguishable from the quota working.
  SELECT COALESCE((
    SELECT SUM(b) FROM (
      -- Committed objects.
      SELECT COALESCE(public.rabbit_object_incoming_bytes(o.metadata), 0) AS b
        FROM storage.objects o
        JOIN public.projects p
          ON p.id = public.fn_try_uuid((storage.foldername(o.name))[2])
       WHERE o.bucket_id IN ('rabbit-files', 'rabbit-thumbnails')
         AND (storage.foldername(o.name))[1] = 'projects'
         AND p.workspace_id = ws
      UNION ALL
      -- 🚨 SESSION 42: bytes already accepted for a resumable upload that has
      -- not completed. These have NO storage.objects row, so 0055's meter read
      -- zero for them — which at a 50 GiB cap lets N concurrent uploads each
      -- pass a creation check that cannot see the other N-1.
      SELECT COALESCE(m.in_progress_size, 0)
        FROM storage.s3_multipart_uploads m
        JOIN public.projects p
          ON p.id = public.fn_try_uuid((storage.foldername(m.key))[2])
       WHERE m.bucket_id IN ('rabbit-files', 'rabbit-thumbnails')
         AND (storage.foldername(m.key))[1] = 'projects'
         AND p.workspace_id = ws
    ) s
  ), 0)::bigint;
$$;

-- 0056 closed this to client roles and that MUST hold: it takes an arbitrary
-- workspace id and does no membership check, so `authenticated` would make it an
-- RPC returning any company's total. Restated here because CREATE OR REPLACE
-- keeps existing privileges but 0011's ALTER DEFAULT PRIVILEGES is still armed.
REVOKE ALL ON FUNCTION public.workspace_petal_bytes(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_petal_bytes(UUID) TO service_role;

COMMENT ON FUNCTION public.workspace_petal_bytes(UUID) IS
  'Session 42: bytes this workspace holds in Petal storage — committed objects '
  'in rabbit-files + rabbit-thumbnails, PLUS in-flight resumable uploads from '
  'storage.s3_multipart_uploads.in_progress_size, which 0055 could not see and '
  'which at a 50 GiB per-file cap is how concurrency walks through a quota. '
  'An s3 workspace''s previews are in the CUSTOMER''s bucket and never join '
  'here. 🚨 NOT EXECUTABLE BY A CLIENT ROLE (0056) — clients read '
  'workspace_storage_usage(), which self-gates.';

-- ── 5. The gate, now weighing the incoming body ─────────────────────────────
--
-- 🚨 THE 1-ARG SIGNATURE SURVIVES AS A SHIM, AND THAT IS NOT TIDINESS. 0056's
-- post-condition calls
--   has_function_privilege('authenticated','public.rabbit_petal_storage_ok(uuid)','EXECUTE')
-- and has_function_privilege RAISES for a function that does not exist rather
-- than returning false — so dropping the 1-arg form makes any replay of 0056
-- ERROR OUT. There is exactly one real definition (the 2-arg); the 1-arg
-- delegates to it with an unknown size. No DEFAULT on the 2-arg form, so a
-- one-argument call resolves to the shim with no overload ambiguity.

CREATE OR REPLACE FUNCTION public.rabbit_petal_storage_ok(
  p_project_id UUID,
  p_incoming   BIGINT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Fails CLOSED on an unresolvable project (outer COALESCE), which costs
  -- nothing because the permissive policies' EXISTS already refuses such a key.
  SELECT COALESCE((
    SELECT COALESCE(pl.status, 'active') = 'active'
       AND CASE
             -- 🚨 UNKNOWN SIZE MUST NOT DENY. This is 0055's behaviour exactly,
             -- kept as the fallback: if storage-api ever stops putting a byte
             -- count in either key, the gate degrades to the un-weighed test
             -- rather than refusing every upload in the product.
             WHEN p_incoming IS NULL THEN
               public.workspace_petal_bytes(p.workspace_id)
                 <  COALESCE(pl.quota_bytes, public.storage_free_tier_bytes())
             -- Session 42: `<=`, because used + incoming IS the total after this
             -- write and landing exactly on the ceiling is legal.
             ELSE
               public.workspace_petal_bytes(p.workspace_id) + p_incoming
                 <= COALESCE(pl.quota_bytes, public.storage_free_tier_bytes())
           END
      FROM public.projects p
      LEFT JOIN public.workspace_storage_plans pl
        ON pl.workspace_id = p.workspace_id
     WHERE p.id = p_project_id
  ), false);
$$;

REVOKE ALL ON FUNCTION public.rabbit_petal_storage_ok(UUID, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rabbit_petal_storage_ok(UUID, BIGINT)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.rabbit_petal_storage_ok(UUID, BIGINT) IS
  'Session 42: may this project''s workspace accept an object of p_incoming '
  'bytes? `used + incoming <= quota` when the size is known, falling back to '
  '0055''s `used < quota` when it is NULL — never denying for lack of '
  'information, because under a RESTRICTIVE policy a NULL denies and that is '
  'indistinguishable from the quota working.';

-- The compatibility shim. Its callers are 0056's post-condition and pgTAP suite
-- 65; the live policy calls the 2-arg form.
CREATE OR REPLACE FUNCTION public.rabbit_petal_storage_ok(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
-- Kept explicitly: CREATE OR REPLACE rewrites the whole definition including
-- proconfig, so omitting this would silently drop the search_path 0055 set.
SET search_path = public
AS $$
  SELECT public.rabbit_petal_storage_ok(p_project_id, NULL::bigint);
$$;

REVOKE ALL ON FUNCTION public.rabbit_petal_storage_ok(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rabbit_petal_storage_ok(UUID)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.rabbit_petal_storage_ok(UUID) IS
  'Session 42: compatibility shim over rabbit_petal_storage_ok(uuid, bigint) '
  'with an unknown incoming size. Kept because 0056''s post-condition asks '
  'has_function_privilege for THIS exact signature, and that function RAISES '
  'for a signature that does not exist — dropping it would make a replay of '
  '0056 fail. Not SECURITY DEFINER: the function it calls is.';

-- ── 5b. Re-point the restrictive policy at the weighing form ────────────────
-- Same name, same RESTRICTIVE, same self-limiting first arm — so 0055's
-- post-conditions 4 and 6 and suite 63's bare rabbit_files% count of 8 all stay
-- true. Only the third arm changes.

DROP POLICY IF EXISTS petal_storage_quota_insert ON storage.objects;
CREATE POLICY petal_storage_quota_insert ON storage.objects
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    -- Self-limiting FIRST: a restrictive policy is evaluated for EVERY insert
    -- into storage.objects, and three buckets share that table.
    bucket_id <> 'rabbit-files'
    OR public.rabbit_quota_exempt_path(name)
    OR public.rabbit_petal_storage_ok(
         public.fn_try_uuid((storage.foldername(name))[2]),
         public.rabbit_object_incoming_bytes(metadata))
  );

COMMENT ON POLICY petal_storage_quota_insert ON storage.objects IS
  'Session 42: the Petal-cloud quota and suspension gate, now weighing the '
  'incoming body. RESTRICTIVE because rabbit-files INSERT has two permissive '
  'arms and permissive policies OR together — as a ninth permissive policy its '
  'own money exemption would become a GRANT and re-open the 0038 invoice hole '
  '(measured by breaker in S41). Binds to resumable uploads because '
  'completeUpload upserts and uploadFile mints a unique key, so the INSERT arm '
  'is taken; a reused key would take the UPDATE arm and escape this policy.';

-- ── 6. TPN-CONT-017 — a lifecycle term for the abandoned upload ─────────────
--
-- A resumable upload that is abandoned, interrupted or superseded leaves a
-- partial in storage.s3_multipart_uploads. It was never 'uploaded', so 0047's
-- vocabulary cannot describe it, storage_gc_queue is fed from `files`-row
-- deletions a fragment never had, and nothing certifies its disposal. At 50 GiB
-- that fragment is both a content fragment and a recurring bill.
--
-- 🚨 DISCOVERY-BASED DROP, the 0047 pattern: drop ANY check constraint on
-- file_events whose definition mentions 'uploaded', not merely the one named
-- file_events_event_check. A name-only drop that misses leaves TWO vocabulary
-- constraints and the older one still refuses the new term.

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
     'purged',
     -- Session 42.
     'upload_abandoned'));

-- ── 6b. The sweep that gives the term a writer ──────────────────────────────
--
-- 🚨 AN EVENT TERM WITH NO WRITER IS THE REPO'S COSTLIEST PATTERN — nine
-- features have shipped with no caller. The term and the sweep land together or
-- neither lands.
--
-- 48 hours, not 24: Supabase expires a resumable upload URL at 24h, so anything
-- older than 48h is provably unresumable and the row is pure garbage. A shorter
-- retention would destroy an upload a user could still finish.
--
-- ⚠️ STATED LIMIT, AND IT MUST NOT BE OVERCLAIMED. Deleting these rows makes the
-- upload unresumable and stops it consuming the customer's quota. It does NOT
-- abort the underlying S3 multipart upload — that is storage-api's own
-- operation and SQL has no reach into it, so Supabase's lifecycle reaps the
-- parts. The certificate therefore says an abandoned upload was DISCARDED, not
-- that bytes were destroyed. S37's GC counted an HTTP 404 as a successful
-- disposal and stamped certificates on bodies still sitting in a customer's
-- bucket; this is the same temptation one layer down.

CREATE OR REPLACE FUNCTION public.purge_abandoned_uploads(
  p_retention INTERVAL DEFAULT INTERVAL '48 hours'
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r       RECORD;
  v_total BIGINT := 0;
BEGIN
  FOR r IN
    SELECT m.id, m.key, m.bucket_id, m.in_progress_size, m.created_at,
           p.id AS project_id, p.workspace_id
      FROM storage.s3_multipart_uploads m
      JOIN public.projects p
        ON p.id = public.fn_try_uuid((storage.foldername(m.key))[2])
     WHERE m.bucket_id IN ('rabbit-files', 'rabbit-thumbnails')
       AND (storage.foldername(m.key))[1] = 'projects'
       AND m.created_at < now() - p_retention
  LOOP
    -- 🚨 file_id IS A SURROGATE AND SAYS SO. file_events.file_id is NOT NULL and
    -- a fragment never had a `files` row, so a random uuid stands in and the
    -- real identity goes in file_name + details.upload_id. The consequence is
    -- deliberate: the per-FILE audit drawer (keyed on file_id) never shows this,
    -- while the per-PROJECT stream does — which is exactly where a discarded
    -- fragment belongs.
    INSERT INTO public.file_events (
      workspace_id, project_id, file_id, file_name, storage_provider,
      event, old_path, size_bytes, details
    ) VALUES (
      r.workspace_id, r.project_id, gen_random_uuid(),
      regexp_replace(r.key, '^.*/', ''), 'supabase',
      'upload_abandoned', r.key, r.in_progress_size,
      jsonb_build_object(
        'upload_id',  r.id,
        'bucket',     r.bucket_id,
        'created_at', r.created_at,
        'retention',  p_retention::text,
        'note',       'row discarded; S3 parts are reaped by the provider lifecycle')
    );

    DELETE FROM storage.s3_multipart_uploads_parts WHERE upload_id = r.id;
    DELETE FROM storage.s3_multipart_uploads       WHERE id = r.id;
    v_total := v_total + 1;
  END LOOP;
  RETURN v_total;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_abandoned_uploads(INTERVAL)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_abandoned_uploads(INTERVAL) TO service_role;

COMMENT ON FUNCTION public.purge_abandoned_uploads(INTERVAL) IS
  'Session 42 (TPN-CONT-017): discards resumable uploads abandoned longer than '
  'p_retention (default 48h — past Supabase''s 24h upload-URL expiry, so nothing '
  'still resumable is touched), writing one file_events ''upload_abandoned'' row '
  'per fragment first. Stops the fragment consuming the workspace quota. Does '
  'NOT abort the S3 multipart upload — SQL cannot — so the certificate claims '
  'discard, not destruction. service_role only; nightly as '
  'wilson-purge-abandoned-uploads where pg_cron exists.';

-- Same guarded pattern as 0012/0014: the CI local stack ships without pg_cron
-- and a scheduling hiccup must never fail the migration. cron.schedule() upserts
-- by job name, so re-running stays idempotent. 04:39 sits ahead of the existing
-- five (04:43-04:59) so freed quota is visible to the same night's reporting.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule(
      'wilson-purge-abandoned-uploads',
      '39 4 * * *',
      $job$ SELECT public.purge_abandoned_uploads(); $job$
    );
  ELSE
    RAISE NOTICE 'pg_cron unavailable — abandoned-upload sweep not scheduled (expected in CI local stack)';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'could not schedule abandoned-upload sweep via pg_cron: %', SQLERRM;
END $$;

-- ── 7. Post-conditions ──────────────────────────────────────────────────────
-- 🚨 The only check in this change that runs against dev, staging AND prod.
-- pgTAP proves the same properties against ONE stack, so a privilege or policy
-- mistake that exists only in an applied environment never reaches it.

DO $$
DECLARE
  n      INT;
  v_lim  BIGINT;
  v_free BIGINT;
BEGIN
  -- 1. The cap this file wrote. ⚠️ This CANNOT observe the dashboard's global
  --    limit, which is what actually binds — see the header. It proves the row
  --    changed, nothing more, and saying so here is the point.
  SELECT file_size_limit INTO v_lim FROM storage.buckets WHERE id = 'rabbit-files';
  IF v_lim IS DISTINCT FROM 53687091200::bigint THEN
    RAISE EXCEPTION '0057 post-condition failed: rabbit-files file_size_limit is %, expected 53687091200 (a re-run of 0027 resets it to 52428800)', v_lim;
  END IF;

  -- ...and the two buckets that must NOT have moved.
  SELECT count(*) INTO n FROM storage.buckets
   WHERE (id = 'rabbit-thumbnails' AND file_size_limit = 262144)
      OR (id = 'user-avatars'      AND file_size_limit = 2097152);
  IF n <> 2 THEN
    RAISE EXCEPTION '0057 post-condition failed: thumbnail/avatar caps moved with the media cap; only rabbit-files should change';
  END IF;

  -- 2. The free tier actually rose.
  SELECT public.storage_free_tier_bytes() INTO v_free;
  IF v_free IS DISTINCT FROM 5368709120::bigint THEN
    RAISE EXCEPTION '0057 post-condition failed: storage_free_tier_bytes() is %, expected 5368709120', v_free;
  END IF;

  -- 3. 🚨 THE SIZE READER NEVER RAISES AND IS NULL-SAFE IN BOTH DIRECTIONS.
  --    A NULL here denies under the restrictive policy, so each of these is a
  --    refused-upload bug wearing the costume of a working quota.
  IF public.rabbit_object_incoming_bytes(NULL::jsonb) IS NOT NULL
     OR public.rabbit_object_incoming_bytes('{}'::jsonb) IS NOT NULL
     OR public.rabbit_object_incoming_bytes('{"size":"abc"}'::jsonb) IS NOT NULL THEN
    RAISE EXCEPTION '0057 post-condition failed: rabbit_object_incoming_bytes returned non-NULL for an unknown size';
  END IF;
  IF public.rabbit_object_incoming_bytes('{"size":123}'::jsonb) IS DISTINCT FROM 123::bigint THEN
    RAISE EXCEPTION '0057 post-condition failed: rabbit_object_incoming_bytes cannot read metadata->>size';
  END IF;
  -- ...and the key the TUS permission test actually carries. Reading only
  -- `size` is what would refuse every resumable upload.
  IF public.rabbit_object_incoming_bytes('{"contentLength":456}'::jsonb) IS DISTINCT FROM 456::bigint THEN
    RAISE EXCEPTION '0057 post-condition failed: rabbit_object_incoming_bytes cannot read metadata->>contentLength — every resumable upload would be denied at creation';
  END IF;

  -- 4. Both signatures exist, and the shim is one of them (0056 replay).
  SELECT count(*) INTO n FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'rabbit_petal_storage_ok';
  IF n <> 2 THEN
    RAISE EXCEPTION '0057 post-condition failed: % rabbit_petal_storage_ok overloads, expected 2 (the 1-arg shim keeps a replay of 0056 from raising)', n;
  END IF;

  -- 5. The policy predicates stay executable by `authenticated`. Revoking one
  --    too many refuses every upload rather than leaking anything, and would
  --    look exactly like the quota working (0056's converse post-condition).
  IF NOT has_function_privilege('authenticated', 'public.rabbit_petal_storage_ok(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rabbit_petal_storage_ok(uuid,bigint)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rabbit_object_incoming_bytes(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rabbit_quota_exempt_path(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '0057 post-condition failed: a policy predicate is not executable by authenticated — every upload would be refused';
  END IF;

  -- ...and the unfiltered aggregate stays shut (0056 finding 1, restated
  -- because CREATE OR REPLACE in section 4 re-touched that function and 0011's
  -- ALTER DEFAULT PRIVILEGES is still armed).
  IF has_function_privilege('authenticated', 'public.workspace_petal_bytes(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.workspace_petal_bytes(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0057 post-condition failed: workspace_petal_bytes is executable by a client role again — 0056 closed this';
  END IF;

  -- 6. 🚨 STILL RESTRICTIVE. One keyword here re-opens the invoice hole: as a
  --    ninth PERMISSIVE arm this policy's own money exemption ORs in and GRANTS
  --    a write rabbit_files_money_insert was refusing (S41 breaker B1).
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'petal_storage_quota_insert'
     AND permissive = 'RESTRICTIVE' AND cmd = 'INSERT';
  IF n <> 1 THEN
    RAISE EXCEPTION '0057 post-condition failed: petal_storage_quota_insert is missing or no longer RESTRICTIVE';
  END IF;

  -- ...and it actually weighs. A policy left pointing at the 1-arg shim would
  -- pass every other check here and meter nothing new.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname = 'petal_storage_quota_insert'
       AND with_check LIKE '%rabbit_object_incoming_bytes%'
  ) THEN
    RAISE EXCEPTION '0057 post-condition failed: the quota policy does not read the incoming size — it is still 0055s unweighed test';
  END IF;

  -- 7. The neighbour counts 0053 and suite 63 assert bare.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname LIKE 'rabbit_files%';
  IF n <> 8 THEN
    RAISE EXCEPTION '0057 post-condition failed: % rabbit_files%% policies, expected 8', n;
  END IF;

  -- 8. The event vocabulary widened, kept everything, and left exactly ONE
  --    constraint behind (the 0047 discovery-drop lesson).
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.file_events'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%uploaded%';
  IF n <> 1 THEN
    RAISE EXCEPTION '0057 post-condition failed: % vocabulary constraints on file_events, expected exactly 1', n;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'file_events_event_check'
       AND pg_get_constraintdef(oid) LIKE '%upload_abandoned%'
       AND pg_get_constraintdef(oid) LIKE '%downloaded%'
       AND pg_get_constraintdef(oid) LIKE '%purged%'
  ) THEN
    RAISE EXCEPTION '0057 post-condition failed: the event widening lost a value or did not add upload_abandoned';
  END IF;

  -- 9. The sweep exists and is service_role only. An `authenticated` grant here
  --    would let any signed-in user destroy every in-flight upload on the
  --    platform by calling it with INTERVAL '0'.
  IF has_function_privilege('authenticated', 'public.purge_abandoned_uploads(interval)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.purge_abandoned_uploads(interval)', 'EXECUTE') THEN
    RAISE EXCEPTION '0057 post-condition failed: purge_abandoned_uploads is executable by a client role';
  END IF;

  -- 10. A workspace with no objects and no uploads still meters ZERO, not NULL.
  --     The probe that catches a dropped outer COALESCE, whose only symptom is
  --     that nobody can ever upload their first file.
  IF public.workspace_petal_bytes('00000000-0000-0000-0000-0000000000ff')
     IS DISTINCT FROM 0::bigint THEN
    RAISE EXCEPTION '0057 post-condition failed: workspace_petal_bytes is not 0 for an empty workspace — every first upload would be refused';
  END IF;

  -- 11. 🚨 THE METER STILL COUNTS BYTES IN FLIGHT.
  --     Every other check here passes with the multipart arm deleted, because
  --     detecting it behaviourally needs a real in-progress upload and no
  --     post-condition can create one. So this reads the DEPLOYED function
  --     definition — not a source file, not a comment: `in_progress_size`
  --     appears nowhere in this function except the executable UNION arm, which
  --     is what keeps it from matching prose that merely mentions the feature
  --     (the 0038 trap, where a negative assertion matched the comment
  --     explaining why that form was wrong).
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'workspace_petal_bytes'
       AND pg_get_functiondef(p.oid) LIKE '%in_progress_size%'
  ) THEN
    RAISE EXCEPTION '0057 post-condition failed: workspace_petal_bytes no longer counts in-flight resumable uploads — N concurrent uploads can each pass a check that cannot see the others';
  END IF;

  RAISE NOTICE '0057 post-conditions passed';
END $$;
