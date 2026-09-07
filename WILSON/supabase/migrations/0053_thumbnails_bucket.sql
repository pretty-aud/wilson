-- =============================================================================
-- 0053 — Session 39: the rabbit-thumbnails bucket, and the derived object's
-- lifecycle.
--
-- NETWORK_STORAGE_DESIGN.md §5d.1. Audrey, 2026-08-05:
--   "all thumbnails need to be accessible on web and desktop"
--   "lets store thumbnails within the supabase storage ... and lets set a file
--    size limit for thumbnails. thats a very common thing."
--
-- Thumbnails are generated on the uploading machine and stored beside their
-- source under an IDENTICAL key plus '.jpg'. Identical is load-bearing: the
-- money gate is the THIRD path segment (public.rabbit_money_segment, 0042), so
-- holding the layout constant is what lets this bucket carry the same eight
-- policies rather than a second, subtly different set.
--
--   rabbit-files/      projects/{project_id}/{entity}/{entity_id}/{ts}-{name}.ext
--   rabbit-thumbnails/ projects/{project_id}/{entity}/{entity_id}/{ts}-{name}.ext.jpg
--
-- ── 🚨 WHY THIS MIGRATION WRITES EIGHT POLICIES AND NOT FOUR ────────────────
-- Both this session's brief and design §5d.1 say rabbit-files has "FOUR
-- policies (0027:283-340): three base + rabbit_files_invoices_select", and say
-- to port those. Measured 2026-08-08, that is wrong in three ways at once:
--
--   * there are EIGHT, not four (supabaseProvider.js:19 already says so);
--   * they live in 0042, not 0027 — 0038 and 0039 rewrote them and 0042
--     rewrote them again;
--   * rabbit_files_invoices_select DOES NOT EXIST. 0042:212-214 dropped the
--     three rabbit_files_invoices_* policies explicitly and replaced them with
--     four rabbit_files_money_* ones keyed on rabbit_money_segment().
--
-- Porting the brief literally would have produced a bucket with no UPDATE arm,
-- one policy named after something that no longer exists, and ALL FOUR money
-- policies missing — i.e. invoice thumbnails readable by every project member.
-- That is TPN-CLOUD-008's "partial policy port" arriving through the
-- instructions written to prevent it. The eight below are transcribed from
-- 0042:121-271 with bucket_id changed and nothing else.
--
-- ── 🚨 THE POLICY PREFIX IS LOAD-BEARING ────────────────────────────────────
-- These are named rabbit_thumbnails_*, NOT rabbit_files_thumb_*. 0042's own
-- post-conditions (0042:284-300) and pgTAP suite 53 (53:213-219) both count
-- policies matching 'rabbit_files%' and require EXACTLY 8. A thumbnail policy
-- under that prefix would make both read 12 and fail — and the fix would look
-- like "relax the assertion", which is how a money predicate gets dropped.
-- =============================================================================

-- ── 1. The bucket ───────────────────────────────────────────────────────────
-- PRIVATE. The instinct with thumbnails is "they are small and harmless, make
-- the bucket public so they load fast" — that is TPN-CLOUD-004 (user-avatars:
-- public, unconditional SELECT, enumerable with the anon key) repeated for
-- FRAMES OF PRE-RELEASE CONTENT, which is materially worse than the original.
-- (TPN-CLOUD-004 is severity HIGH, not CRITICAL as three docs claim; the
-- technical finding is accurate and still open — only the label was inflated.)
--
-- 256 KB: a 256px JPEG at q80 measures 10–30 KB, so this is generous while
-- still refusing anything that is obviously not a thumbnail. allowed_mime_types
-- is narrower than rabbit-files on purpose — the generator emits image/jpeg and
-- nothing else, so Storage itself can refuse a mislabelled body. Both limits
-- are enforced by Storage, not by client code that a devtools caller skips.
--
-- ON CONFLICT DO UPDATE re-asserts the settings on re-run (the 0009/0027
-- pattern). Here that shape is self-healing rather than hazardous: EXCLUDED
-- carries public=false, so a replay can only ever restore privacy.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'rabbit-thumbnails',
  'rabbit-thumbnails',
  false,
  262144,                    -- 256 KB
  ARRAY['image/jpeg']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── 2. The eight policies ───────────────────────────────────────────────────
-- Transcribed from 0042:121-271. Every predicate is identical except
-- bucket_id; the money split is the same NOT/ASSERT pair over the same single
-- predicate, so an object and its thumbnail can never end up on opposite sides
-- of the gate.
--
-- DROP + CREATE, never a narrower policy added alongside: permissive policies
-- OR together, so leaving an old one in place would change nothing at all.
-- (0042's own note, and 0038's inversion is why it is written down.)

-- ── 2a. The four base policies: every non-money thumbnail ───────────────────

DROP POLICY IF EXISTS rabbit_thumbnails_select ON storage.objects;
CREATE POLICY rabbit_thumbnails_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'rabbit-thumbnails'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND NOT public.rabbit_money_segment((storage.foldername(name))[3])
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = public.fn_try_uuid((storage.foldername(name))[2])
    )
  );

DROP POLICY IF EXISTS rabbit_thumbnails_insert ON storage.objects;
CREATE POLICY rabbit_thumbnails_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'rabbit-thumbnails'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND NOT public.rabbit_money_segment((storage.foldername(name))[3])
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = public.fn_try_uuid((storage.foldername(name))[2])
    )
    AND public.has_active_membership(public.current_workspace_id())
    AND public.can_write_project(public.fn_try_uuid((storage.foldername(name))[2]))
  );

-- Both arms required, pinning the SAME side of the gate — 0042's fix, kept.
-- With only USING, a member could rename an ordinary thumbnail INTO FINANCE/
-- or INVOICES/, or onto another project's prefix.
--
-- A thumbnail additionally NEEDS this arm in a way its source does not:
-- rabbit-files objects are uploaded upsert:false and are immutable, but a
-- re-uploaded or regenerated thumbnail overwrites in place at a key derived
-- from its source's key. Without UPDATE the second write would be refused and
-- the stale image would stand.
DROP POLICY IF EXISTS rabbit_thumbnails_update ON storage.objects;
CREATE POLICY rabbit_thumbnails_update ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'rabbit-thumbnails'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND NOT public.rabbit_money_segment((storage.foldername(name))[3])
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = public.fn_try_uuid((storage.foldername(name))[2])
    )
    AND public.has_active_membership(public.current_workspace_id())
    AND public.can_write_project(public.fn_try_uuid((storage.foldername(name))[2]))
  )
  WITH CHECK (
    bucket_id = 'rabbit-thumbnails'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND NOT public.rabbit_money_segment((storage.foldername(name))[3])
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = public.fn_try_uuid((storage.foldername(name))[2])
    )
    AND public.has_active_membership(public.current_workspace_id())
    AND public.can_write_project(public.fn_try_uuid((storage.foldername(name))[2]))
  );

-- The one-hour own-object window, exactly as rabbit_files_delete_own. It
-- exists for one flow: an upload whose files-row insert was then refused,
-- cleaning up after itself. All other disposal goes through storage-gc as
-- service_role, which is what makes the certificate trustworthy.
DROP POLICY IF EXISTS rabbit_thumbnails_delete_own ON storage.objects;
CREATE POLICY rabbit_thumbnails_delete_own ON storage.objects
  FOR DELETE USING (
    bucket_id = 'rabbit-thumbnails'
    AND owner_id = (auth.uid())::text
    AND (storage.foldername(name))[1] = 'projects'
    AND NOT public.rabbit_money_segment((storage.foldername(name))[3])
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = public.fn_try_uuid((storage.foldername(name))[2])
    )
    AND public.has_active_membership(public.current_workspace_id())
    AND public.can_write_project(public.fn_try_uuid((storage.foldername(name))[2]))
    AND created_at > (now() - interval '1 hour')
  );

-- ── 2b. The money-gated four: INVOICES and FINANCE, identically ─────────────
-- 🚨 THIS HALF IS THE ONE THE BRIEF WOULD HAVE OMITTED. An invoice's thumbnail
-- is a legible picture of the invoice. Gating the row and the source blob while
-- leaving the derived image on the base policies would defeat the money gate
-- with a smaller copy of the same document, in the place nobody audits.

DROP POLICY IF EXISTS rabbit_thumbnails_money_select ON storage.objects;
CREATE POLICY rabbit_thumbnails_money_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'rabbit-thumbnails'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND public.rabbit_money_segment((storage.foldername(name))[3])
    AND public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
  );

DROP POLICY IF EXISTS rabbit_thumbnails_money_insert ON storage.objects;
CREATE POLICY rabbit_thumbnails_money_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'rabbit-thumbnails'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND public.rabbit_money_segment((storage.foldername(name))[3])
    AND public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
  );

DROP POLICY IF EXISTS rabbit_thumbnails_money_update ON storage.objects;
CREATE POLICY rabbit_thumbnails_money_update ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'rabbit-thumbnails'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND public.rabbit_money_segment((storage.foldername(name))[3])
    AND public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
  )
  WITH CHECK (
    bucket_id = 'rabbit-thumbnails'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND public.rabbit_money_segment((storage.foldername(name))[3])
    AND public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
  );

-- No one-hour window, matching rabbit_files_money_delete: that window makes
-- "undo my own upload" safe without granting a general delete, and a
-- money-cleared manager removing an invoice thumbnail is a deliberate act.
DROP POLICY IF EXISTS rabbit_thumbnails_money_delete ON storage.objects;
CREATE POLICY rabbit_thumbnails_money_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'rabbit-thumbnails'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND public.rabbit_money_segment((storage.foldername(name))[3])
    AND public.can_access_project_money(public.fn_try_uuid((storage.foldername(name))[2]))
  );

-- ── 3. The derived object dies with its source ──────────────────────────────
-- TPN-CONT-011 is derived content surviving the purge of the file it came
-- from, orphaned and uncertificated. A thumbnail is derived content. It goes
-- on the SAME deletion path and gets the SAME certificate — not a later sweep,
-- because a later sweep is exactly what TPN-CONT-011 describes.
--
-- Two changes to 0051's version, and the first is the subtle one:
--
--   * the body INSERT is now guarded by the provider test that USED to live
--     only in the trigger's WHEN clause, and the WHEN clause is widened to
--     admit any row carrying a thumbnail. A local_server or google_drive row
--     has no Supabase body, so enqueuing 'rabbit-files' for it would certify
--     the disposal of an object that was never there; but such a row CAN carry
--     a Petal-hosted thumbnail, and that thumbnail must still be disposed of.
--     Splitting the two decisions is what lets both be right.
--   * thumbnails are always provider 'supabase'. A workspace on its own bucket
--     (S37) keeps its MEDIA there; the derived 10–30 KB preview stays on Petal
--     so a thumbnail grid needs no presign round-trip per tile and works
--     identically on every provider. Deliberate, and stated in §12.7b.
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
    INSERT INTO public.storage_gc_queue (bucket_id, object_path, workspace_id, file_id, reason, provider)
    VALUES (
      CASE WHEN OLD.storage_provider::text = 's3' THEN 'byo-s3' ELSE 'rabbit-files' END,
      OLD.storage_path, OLD.workspace_id, OLD.id, 'file-purged',
      OLD.storage_provider::text
    );
  END IF;

  -- The derived thumbnail, wherever the body lived.
  IF OLD.thumbnail_url IS NOT NULL AND btrim(OLD.thumbnail_url) <> '' THEN
    INSERT INTO public.storage_gc_queue (bucket_id, object_path, workspace_id, file_id, reason, provider)
    VALUES (
      'rabbit-thumbnails', OLD.thumbnail_url, OLD.workspace_id, OLD.id, 'file-purged', 'supabase'
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
  'Session 39: enqueues up to TWO objects per purged files row — the body (supabase/s3 only, 0051) and the derived thumbnail (rabbit-thumbnails, always provider supabase). The two decisions are independent because a row can have a thumbnail without having a disposable Supabase body. TPN-CONT-011: derived content must not outlive its source.';

-- ── 4. Post-conditions ──────────────────────────────────────────────────────
-- Scan the CATALOG rather than the list this migration wrote (0042's rule,
-- from S22: checking your own list is what misses the object you forgot).
DO $post$
DECLARE
  n   INT;
  bad TEXT;
BEGIN
  -- 1. The bucket exists and is PRIVATE. This is the assertion TPN-CLOUD-004
  --    would have failed, so it is checked rather than assumed (0027:405).
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'rabbit-thumbnails' AND public = false
  ) THEN
    RAISE EXCEPTION '0053 post-condition failed: rabbit-thumbnails bucket missing or PUBLIC';
  END IF;

  -- 2. The size cap actually landed. A bucket with a NULL limit accepts a
  --    multi-GB "thumbnail", which is the whole reason for a second bucket.
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
     WHERE id = 'rabbit-thumbnails' AND file_size_limit = 262144
  ) THEN
    RAISE EXCEPTION '0053 post-condition failed: rabbit-thumbnails file_size_limit is not 256 KB';
  END IF;

  -- 3. EIGHT policies, and every one routes through the single money
  --    predicate. This is the partial-port tripwire: seven means an arm was
  --    dropped, and a policy that omits rabbit_money_segment is one that
  --    cannot tell an invoice from a dailies frame.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname LIKE 'rabbit_thumbnails%'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%rabbit_money_segment%';
  IF n <> 8 THEN
    RAISE EXCEPTION '0053 post-condition failed: % of 8 rabbit-thumbnails policies use rabbit_money_segment', n;
  END IF;

  -- 4. The four money policies carry the money gate itself. A predicate that
  --    selects the right objects and forgets to check the caller is a gate
  --    that matches everything and stops nobody. (0042 post-condition 4.)
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname LIKE 'rabbit_thumbnails_money_%'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%can_access_project_money%';
  IF n <> 4 THEN
    RAISE EXCEPTION '0053 post-condition failed: % of 4 thumbnail money policies carry can_access_project_money', n;
  END IF;

  -- 5. Both UPDATE arms exist WITH a WITH CHECK. USING alone lets an object
  --    be renamed across the money boundary. (0042 post-condition 3.)
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN ('rabbit_thumbnails_update', 'rabbit_thumbnails_money_update')
     AND cmd = 'UPDATE'
     AND with_check IS NOT NULL;
  IF n <> 2 THEN
    RAISE EXCEPTION '0053 post-condition failed: % of 2 thumbnail UPDATE policies have a WITH CHECK arm', n;
  END IF;

  -- 6. No thumbnail policy hard-codes a segment name — it must ask the
  --    function, or the two drift. (0042 post-condition 1.)
  SELECT string_agg(policyname, ', ') INTO bad
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname LIKE 'rabbit_thumbnails%'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%INVOICES%';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '0053 post-condition failed: thumbnail policies hard-code a segment name: %', bad;
  END IF;

  -- 7. 🚨 THE NEIGHBOUR CHECK. 0042's post-conditions and suite 53 both count
  --    'rabbit_files%' policies and require exactly 8. If this migration's
  --    policies had been named rabbit_files_thumb_*, that count would now read
  --    12. Asserting it here means the collision is caught by the migration
  --    that would cause it, not by a suite failure three files away.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname LIKE 'rabbit_files%';
  IF n <> 8 THEN
    RAISE EXCEPTION '0053 post-condition failed: rabbit_files%% policy count is %, expected 8 — a thumbnail policy has taken the wrong prefix', n;
  END IF;

  -- 8. The trigger still fires, and now fires on the widened condition.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_files_gc_enqueue'
       AND tgrelid = 'public.files'::regclass
  ) THEN
    RAISE EXCEPTION '0053 post-condition failed: trg_files_gc_enqueue missing';
  END IF;

  IF pg_get_triggerdef(
       (SELECT oid FROM pg_trigger
         WHERE tgname = 'trg_files_gc_enqueue'
           AND tgrelid = 'public.files'::regclass)
     ) NOT LIKE '%thumbnail_url%' THEN
    RAISE EXCEPTION '0053 post-condition failed: trigger WHEN clause does not mention thumbnail_url — a thumbnail on a non-Supabase row would never be disposed of';
  END IF;

  -- 9. S37's s3 disposal is untouched. This migration rewrote the function
  --    that 0051 last owned, so the arm it added is re-asserted here rather
  --    than trusted — a silently dropped branch would leak a customer's
  --    bucket object with a certificate saying otherwise.
  IF pg_get_functiondef('public.fn_files_gc_enqueue()'::regprocedure) NOT LIKE '%byo-s3%' THEN
    RAISE EXCEPTION '0053 post-condition failed: the s3 (byo-s3) enqueue arm from 0051 was lost';
  END IF;
END
$post$;
