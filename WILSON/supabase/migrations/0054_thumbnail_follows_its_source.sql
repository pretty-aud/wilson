-- =============================================================================
-- 0054 — Session 44: a thumbnail lives where its source lives, and dies with it.
--
-- Audrey, 2026-08-08, deciding against what S39 shipped:
--   "the image should be kept in the company storage. if the thumbnail lived in
--    the petal cloud it would break tpn inherently"
--
-- S39 wrote EVERY thumbnail to rabbit-thumbnails and enqueued every one for
-- disposal as bucket 'rabbit-thumbnails' / provider 'supabase' — its own COMMENT
-- said "always provider supabase". S44 reverses the destination (the client half
-- is storage/thumbnails.js putThumbnailTo), and this migration teaches disposal
-- to follow it. Missing this half would be worse than the consistent-but-wrong
-- behaviour it replaces: the drain would look for a customer-bucket object in a
-- Supabase bucket, not find it, and stamp it disposed.
--
-- ── 🚨 WHY THIS MIGRATION ADDS A COLUMN INSTEAD OF REUSING bucket_id ─────────
-- storage-gc's restorability guard discriminates like this (index.ts:264, S39):
--
--     const refColumn = row.bucket_id === THUMBNAIL_BUCKET
--       ? 'thumbnail_url' : 'storage_path'
--
-- A thumbnail queue row's object_path is a `thumbnail_url`; a body's is a
-- `storage_path`. They are different columns holding different keys, and asking
-- the wrong one ALWAYS answers "nothing references this" — which is not a
-- refusal to delete but a LICENCE to, followed by a 'deleted' stamp in the
-- disposal ledger. S39 wrote that discriminator and the warning above it.
--
-- The obvious encoding of this session's change — mirror the body arm, use
-- OLD.storage_provider for the thumbnail's bucket too — SILENTLY BREAKS THAT
-- GUARD. An s3 thumbnail correctly enqueued as 'byo-s3' no longer equals
-- THUMBNAIL_BUCKET, so its restorability is checked against storage_path, which
-- no thumbnail key is ever in. Every s3 thumbnail would read as unreferenced
-- and be deleted while its source was correctly preserved, surfacing weeks
-- later as "my restored file lost its thumbnail". The fix that causes the bug
-- it was written to prevent.
--
-- So WHAT THE OBJECT IS stops being inferred from WHERE IT LIVES. `kind` says
-- it outright, and storage-gc reads that instead. bucket_id goes back to
-- meaning only what it says.
--
-- ── ⚠️ WHAT IS DELIBERATELY *NOT* HERE ──────────────────────────────────────
-- No CHECK pinning a thumbnail's provider to its body's. The money pin has a
-- database half (0050's files_money_provider_chk) because it is a security
-- invariant that must never be reversed. "A thumbnail follows its body" is the
-- same rule applied, but its enforcement point is the single call site that
-- reuses one variable for both — there is no second decision for a constraint
-- to referee, and thumbnail_url is not a column a constraint can bind to a
-- bucket anyway. One guard, one vitest pin, one named failure mode.
--
-- Idempotent: safe to re-run.
-- ORDERING: depends on 0053 (the thumbnail enqueue arm + rabbit-thumbnails),
-- 0051 (storage_gc_queue.provider + the s3 body arm + the 'byo-s3' marker),
-- 0027 (storage_gc_queue + the enqueue trigger), 0000 (storage_provider enum).
-- pgTAP: 64_thumbnail_provider.sql (new).
-- =============================================================================

-- ── 1. The queue row says what it is ────────────────────────────────────────
-- DEFAULT 'body' is the correct reading of every row written before now: 0027's
-- and 0051's arms are bodies, and the orphan/avatar scans enqueue bodies too.
-- The one exception is backfilled below.
ALTER TABLE public.storage_gc_queue
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'body';

-- Explicit DROP + ADD, never a wrapped ADD. S36 measured the consequence: a
-- wrapped `ADD CONSTRAINT` against a database that already has one is a SILENT
-- NO-OP, so a widening "applies" while changing nothing. This constraint is new
-- today, but the next session to add a `kind` will reach for this statement.
ALTER TABLE public.storage_gc_queue
  DROP CONSTRAINT IF EXISTS storage_gc_queue_kind_chk;
ALTER TABLE public.storage_gc_queue
  ADD CONSTRAINT storage_gc_queue_kind_chk
  CHECK (kind IN ('body', 'thumbnail'));

-- The one set of pre-existing rows that is NOT a body. Keyed on the bucket
-- because that is exactly what the old discriminator used, so this reproduces
-- the previous behaviour rather than guessing at it. Measured 2026-08-08:
-- storage_gc_queue is EMPTY on all three environments, so this backfills
-- nothing today — it is here for correctness on replay, not for data.
UPDATE public.storage_gc_queue
   SET kind = 'thumbnail'
 WHERE bucket_id = 'rabbit-thumbnails'
   AND kind <> 'thumbnail';

COMMENT ON COLUMN public.storage_gc_queue.kind IS
  'Session 44: whether this row disposes of a file BODY or its derived THUMBNAIL. storage-gc picks the restorability column from this (thumbnail -> files.thumbnail_url, body -> files.storage_path). It exists because a thumbnail is no longer identifiable by its bucket: since S44 an s3 workspace''s thumbnail lives in the customer bucket under the same ''byo-s3'' marker as its body.';

-- ── 2. The enqueue learns the thumbnail's real home ─────────────────────────
-- Two independent decisions, as 0053 established — a row can carry a thumbnail
-- without having a disposable Supabase body. What changes is the second one:
-- the thumbnail's destination is no longer the constant 'rabbit-thumbnails'.
--
-- 🚨 THE THUMBNAIL ARM IS NOT A COPY OF THE BODY ARM, and the difference is
-- load-bearing. The body arm maps 's3' -> 'byo-s3' and EVERYTHING ELSE ->
-- 'rabbit-files', but it only runs for providers in ('supabase','s3'). The
-- thumbnail arm runs for ANY row carrying a thumbnail_url, including a
-- local_server or google_drive row (0053 widened the trigger for exactly that
-- case). Writing `OLD.storage_provider::text` into the provider column would
-- then enqueue a Petal-hosted thumbnail as provider 'local_server', which
-- storage_gc_queue_provider_chk refuses outright (0051: 'supabase','s3') —
-- turning every purge of such a row into a caught exception and a WARNING,
-- i.e. a thumbnail that is never disposed of at all.
--
-- So the mapping is stated as what it is: an s3 body's thumbnail is beside it
-- in the customer's bucket; every other thumbnail this system can write is on
-- Petal. That preserves 0053's case instead of quietly dropping it.
CREATE OR REPLACE FUNCTION public.fn_files_gc_enqueue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The body, for the two providers whose blobs this system can dispose of.
  -- ::text comparisons throughout, matching 0051 — the enum is compared as
  -- text so this function never needs editing when a value is added.
  IF OLD.storage_provider::text IN ('supabase', 's3') THEN
    INSERT INTO public.storage_gc_queue (bucket_id, object_path, workspace_id, file_id, reason, provider, kind)
    VALUES (
      CASE WHEN OLD.storage_provider::text = 's3' THEN 'byo-s3' ELSE 'rabbit-files' END,
      OLD.storage_path, OLD.workspace_id, OLD.id, 'file-purged',
      OLD.storage_provider::text, 'body'
    );
  END IF;

  -- The derived thumbnail, at the store its BODY went to (S44). Only 's3'
  -- diverges: see the header for why this is not OLD.storage_provider.
  IF OLD.thumbnail_url IS NOT NULL AND btrim(OLD.thumbnail_url) <> '' THEN
    INSERT INTO public.storage_gc_queue (bucket_id, object_path, workspace_id, file_id, reason, provider, kind)
    VALUES (
      CASE WHEN OLD.storage_provider::text = 's3' THEN 'byo-s3' ELSE 'rabbit-thumbnails' END,
      OLD.thumbnail_url, OLD.workspace_id, OLD.id, 'file-purged',
      CASE WHEN OLD.storage_provider::text = 's3' THEN 's3' ELSE 'supabase' END,
      'thumbnail'
    );
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- A failed enqueue orphans one blob; the Edge Function's orphan scan is
  -- the backstop for blobs whose PROJECT still resolves to a workspace.
  -- (Supabase bodies only — a customer bucket is never scanned; see §12.4.)
  RAISE WARNING 'storage_gc enqueue failed for file %: %', OLD.id, SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_files_gc_enqueue() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_files_gc_enqueue ON public.files;
CREATE TRIGGER trg_files_gc_enqueue
  AFTER DELETE ON public.files
  FOR EACH ROW
  WHEN (
    OLD.storage_provider::text IN ('supabase', 's3')
    OR OLD.thumbnail_url IS NOT NULL
  )
  EXECUTE FUNCTION public.fn_files_gc_enqueue();

COMMENT ON FUNCTION public.fn_files_gc_enqueue() IS
  'Session 44: enqueues up to TWO objects per purged files row — the body (supabase/s3 only, 0051) and the derived thumbnail, AT THE STORE ITS BODY WENT TO (S44: an s3 body''s thumbnail is beside it in the customer bucket; every other thumbnail is on Petal). Each row is tagged kind=body|thumbnail so storage-gc can pick the restorability column without inferring it from the bucket. TPN-CONT-011: derived content must not outlive its source.';

-- ── 3. Post-conditions ──────────────────────────────────────────────────────
-- Read the DEFINITION BACK from the catalog rather than trusting that the
-- statements above did what they say (0042's rule; S36's silent no-op is why).
DO $post$
DECLARE
  n   INT;
  def TEXT;
BEGIN
  -- 1. The column and its CHECK actually landed, and the CHECK is the WIDE
  --    one. A column with no constraint accepts 'thumbnial' and the drain then
  --    treats it as a body forever.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'storage_gc_queue'
       AND column_name = 'kind' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION '0054 post-condition failed: storage_gc_queue.kind missing or nullable';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conname = 'storage_gc_queue_kind_chk'
     AND conrelid = 'public.storage_gc_queue'::regclass;
  IF def IS NULL THEN
    RAISE EXCEPTION '0054 post-condition failed: storage_gc_queue_kind_chk does not exist';
  END IF;
  IF def NOT LIKE '%body%' OR def NOT LIKE '%thumbnail%' THEN
    RAISE EXCEPTION '0054 post-condition failed: kind CHECK does not admit both values: %', def;
  END IF;

  -- 2. 🚨 THE ARM THAT THIS SESSION EXISTS TO ADD. The thumbnail INSERT must
  --    be able to name the customer bucket. Asserting on the function's own
  --    text because there is no other way to see a branch that has never run:
  --    no s3 workspace exists on any environment (measured 2026-08-08), so a
  --    behavioural probe cannot reach it without fabricating one — which is
  --    exactly what suite 64 does, and this is the cheap tripwire in front.
  def := pg_get_functiondef('public.fn_files_gc_enqueue()'::regprocedure);

  IF def NOT LIKE '%''thumbnail''%' THEN
    RAISE EXCEPTION '0054 post-condition failed: the enqueue never writes kind=thumbnail';
  END IF;

  -- 3. Both arms still tag their kind. A body arm that stopped writing 'body'
  --    would silently rely on the DEFAULT, which is right today and would stop
  --    being right the first time the default changed.
  IF def NOT LIKE '%''body''%' THEN
    RAISE EXCEPTION '0054 post-condition failed: the body arm no longer tags kind=body';
  END IF;

  -- 4. S37's s3 body disposal survives. This migration rewrote the function
  --    0053 last owned, which 0051 owned before that — a silently dropped
  --    branch would leak a customer's bucket object with a certificate saying
  --    otherwise. (0053 post-condition 9, kept.)
  IF def NOT LIKE '%byo-s3%' THEN
    RAISE EXCEPTION '0054 post-condition failed: the s3 (byo-s3) enqueue arm from 0051 was lost';
  END IF;

  -- 5. 🚨 THE THUMBNAIL ARM MUST NOT WRITE OLD.storage_provider INTO provider.
  --    That is the plausible-looking mirror of the body arm, and it enqueues a
  --    local_server row's Petal-hosted thumbnail as provider 'local_server',
  --    which storage_gc_queue_provider_chk refuses — turning the purge into a
  --    caught WARNING and disposing of nothing. Counted rather than pattern-
  --    matched: the body arm legitimately contains that expression once.
  SELECT count(*) INTO n
    FROM regexp_matches(def, 'OLD\.storage_provider::text,', 'g');
  IF n <> 1 THEN
    RAISE EXCEPTION '0054 post-condition failed: OLD.storage_provider::text is written to the provider column % times, expected exactly 1 (the body arm)', n;
  END IF;

  -- 6. The trigger still fires on the widened 0053 condition. A thumbnail on a
  --    row with no disposable body must still reach the queue.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_files_gc_enqueue'
       AND tgrelid = 'public.files'::regclass
  ) THEN
    RAISE EXCEPTION '0054 post-condition failed: trg_files_gc_enqueue missing';
  END IF;

  IF pg_get_triggerdef(
       (SELECT oid FROM pg_trigger
         WHERE tgname = 'trg_files_gc_enqueue'
           AND tgrelid = 'public.files'::regclass)
     ) NOT LIKE '%thumbnail_url%' THEN
    RAISE EXCEPTION '0054 post-condition failed: trigger WHEN clause does not mention thumbnail_url — a thumbnail on a non-Supabase row would never be disposed of';
  END IF;

  -- 7. No queue row is left mislabelled. After the backfill every
  --    rabbit-thumbnails row must read 'thumbnail', or the drain checks the
  --    wrong column for it and deletes a restorable preview.
  SELECT count(*) INTO n FROM public.storage_gc_queue
   WHERE bucket_id = 'rabbit-thumbnails' AND kind <> 'thumbnail';
  IF n <> 0 THEN
    RAISE EXCEPTION '0054 post-condition failed: % rabbit-thumbnails queue row(s) are not tagged kind=thumbnail', n;
  END IF;

  -- 8. The function is still locked down. It is SECURITY DEFINER and a
  --    CREATE OR REPLACE resets nothing about grants, but the REVOKE above is
  --    re-asserted rather than assumed (0011's grantee lesson).
  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'fn_files_gc_enqueue'
       AND (
         has_function_privilege('anon', p.oid, 'EXECUTE')
         OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
       )
  ) THEN
    RAISE EXCEPTION '0054 post-condition failed: fn_files_gc_enqueue is EXECUTable by a client role';
  END IF;
END
$post$;
