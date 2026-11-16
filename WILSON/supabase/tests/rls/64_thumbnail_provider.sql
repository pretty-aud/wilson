-- pgTAP: 0054 — a thumbnail lives where its source lives, and dies with it.
--
-- Audrey, 2026-08-08, deciding against what S39 shipped:
--   "the image should be kept in the company storage. if the thumbnail lived in
--    the petal cloud it would break tpn inherently"
--
-- S39 enqueued EVERY thumbnail as bucket 'rabbit-thumbnails' / provider
-- 'supabase' — its COMMENT said "always provider supabase". 0054 makes the
-- derived object follow its body, and this suite drives that END-TO-END: real
-- INSERT, real DELETE, read the queue. Suite 61 §8 proves the BODY arm the same
-- way; this is its sibling for the derived half.
--
-- WHAT THIS SUITE EXISTS TO CATCH, in order of how badly it would hurt:
--
--   * 🚨 A RESTORABLE PREVIEW DELETED AND CERTIFIED DISPOSED. storage-gc picks
--     its restorability column from the queue row. S39 inferred "this is a
--     thumbnail" from the BUCKET, which stops working the moment an s3
--     thumbnail is correctly enqueued under the same 'byo-s3' marker as its
--     body: the drain would then check files.storage_path for a key that only
--     ever appears in files.thumbnail_url, get "nothing references this", and
--     delete a still-restorable preview while stamping it 'deleted'. 0054 adds
--     `kind` so the object says what it is. Probes 3-4 and 8 are the tripwire.
--
--   * 🚨 A CUSTOMER'S FRAME LEFT ON PETAL. Probe 7 is the compliance assertion:
--     an s3 body's preview must be enqueued for the CUSTOMER's bucket. Probe 6
--     is its control — a supabase body's preview must still go to
--     rabbit-thumbnails, or probe 7 would pass just as well if the thumbnail
--     arm had simply stopped working (standing rule 2).
--
--   * 🚨 A THUMBNAIL THAT IS NEVER DISPOSED OF AT ALL. The plausible mirror of
--     the body arm — write OLD.storage_provider into the provider column for
--     the thumbnail too — enqueues a local_server row's Petal-hosted preview as
--     provider 'local_server', which storage_gc_queue_provider_chk refuses.
--     The trigger's EXCEPTION handler swallows that into a WARNING, so the
--     purge "succeeds" and disposes of nothing. Probe 9 drives exactly that row.
--     0053 widened the WHEN clause for this case, so it is reachable by
--     construction rather than hypothetical.
--
--   * A MONEY-GATED PREVIEW FOLLOWING THE WORKSPACE INSTEAD OF THE PIN. Probe
--     10: an invoice's body never leaves Supabase (0050's
--     files_money_provider_chk), so its preview must not either.
--
-- Runs entirely as postgres: the CHECK, the column and the trigger are not RLS.
-- storage_gc_queue reads are scoped to the fixture workspace (the unscoped-count
-- decay rule) and to the exact object_path, because one purged row now enqueues
-- TWO queue rows and an unscoped count would conflate them.

BEGIN;

SELECT plan(13);

SELECT * FROM tests.rls_setup();

-- ── 1. Structure: the column that replaced the bucket-name inference ────────

SELECT is(
  (SELECT column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name='storage_gc_queue'
      AND column_name='kind'),
  '''body''::text',
  'the queue''s kind column defaults to body — every pre-0054 row reads correctly');

SELECT is(
  (SELECT is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name='storage_gc_queue'
      AND column_name='kind'),
  'NO', 'kind is NOT NULL — a null would fall to the body branch silently');

-- The CHECK admits both values and nothing else. A column with no constraint
-- accepts 'thumbnial', which the drain then treats as a body forever.
SELECT ok(
  (SELECT pg_get_constraintdef(oid) LIKE '%body%'
      AND pg_get_constraintdef(oid) LIKE '%thumbnail%'
     FROM pg_constraint
    WHERE conrelid='public.storage_gc_queue'::regclass AND contype='c'
      AND conname='storage_gc_queue_kind_chk'),
  'storage_gc_queue_kind_chk admits exactly body and thumbnail');

SELECT throws_ok(
  $$INSERT INTO public.storage_gc_queue
      (bucket_id, object_path, workspace_id, reason, provider, kind)
    VALUES ('rabbit-thumbnails', 'projects/x/a/1/z.png.jpg',
            '11111111-1111-1111-1111-111111111111', 'file-purged', 'supabase', 'preview')$$,
  -- Three-arg form, the house shape. The four-arg overload cannot resolve when
  -- every argument arrives as `unknown`. And this row violates exactly ONE
  -- CHECK, so the alphabetical-winner rule does not bite: reason, status and
  -- provider are all valid above.
  'new row for relation "storage_gc_queue" violates check constraint "storage_gc_queue_kind_chk"',
  'a third kind is refused — the drain has exactly two branches and no default for a third');

-- ── 2. The enqueue, end-to-end, per provider ────────────────────────────────
-- Real INSERT, real DELETE, read the queue. A catalog-only assertion would pass
-- against a trigger that never fires.

-- 2a. A SUPABASE body: both objects enqueue, each tagged, both on Petal.
INSERT INTO public.files
  (id, project_id, name, storage_provider, storage_path, thumbnail_url, is_financial)
VALUES ('aaaa1111-0000-0000-0000-0000000064c1',
        'aaaa1111-0000-0000-0000-000000000001', 'plate.png', 'supabase',
        'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/10-plate.png',
        'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/10-plate.png.jpg',
        false);
DELETE FROM public.files WHERE id = 'aaaa1111-0000-0000-0000-0000000064c1';

SELECT is(
  (SELECT provider || '|' || bucket_id || '|' || kind FROM public.storage_gc_queue
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
      AND object_path = 'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/10-plate.png'),
  'supabase|rabbit-files|body',
  'a purged supabase BODY enqueues to rabbit-files, tagged body');

SELECT is(
  (SELECT provider || '|' || bucket_id || '|' || kind FROM public.storage_gc_queue
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
      AND object_path = 'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/10-plate.png.jpg'),
  'supabase|rabbit-thumbnails|thumbnail',
  'its PREVIEW enqueues to rabbit-thumbnails, tagged thumbnail — the Petal case is unchanged');

-- 2b. 🚨 AN S3 body: the preview goes to the CUSTOMER'S bucket. This is the
--     assertion the whole session exists for. Before 0054 this row's preview
--     was enqueued as 'rabbit-thumbnails'/'supabase' — a frame of the
--     customer's content on Petal, and a drain that would look for it in the
--     wrong place.
INSERT INTO public.files
  (id, project_id, name, storage_provider, storage_path, thumbnail_url, is_financial)
VALUES ('aaaa1111-0000-0000-0000-0000000064c2',
        'aaaa1111-0000-0000-0000-000000000001', 'still.png', 's3',
        'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/11-still.png',
        'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/11-still.png.jpg',
        false);
DELETE FROM public.files WHERE id = 'aaaa1111-0000-0000-0000-0000000064c2';

SELECT is(
  (SELECT provider || '|' || bucket_id || '|' || kind FROM public.storage_gc_queue
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
      AND object_path = 'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/11-still.png.jpg'),
  's3|byo-s3|thumbnail',
  'an s3 body''s PREVIEW is enqueued for the customer''s own bucket, tagged thumbnail');

-- 🚨 AND IT IS DISTINGUISHABLE FROM ITS BODY. Both rows now carry bucket_id
-- 'byo-s3' and provider 's3'; only `kind` tells them apart. This is the probe
-- that fails if someone "simplifies" storage-gc back to a bucket test — the
-- body and the preview would become indistinguishable and the preview's
-- restorability would be checked against the wrong column.
SELECT is(
  (SELECT string_agg(kind, ',' ORDER BY kind) FROM public.storage_gc_queue
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
      AND file_id = 'aaaa1111-0000-0000-0000-0000000064c2'),
  'body,thumbnail',
  'the s3 body and its preview share a bucket and a provider — only kind separates them');

-- 2c. 🚨 A local_server row carrying a Petal-hosted preview. 0053 widened the
--     trigger for exactly this: no disposable Supabase body, but a thumbnail
--     that must still be disposed of. If the thumbnail arm mirrored the body
--     arm's provider expression, this INSERT would violate
--     storage_gc_queue_provider_chk, the trigger's EXCEPTION handler would
--     swallow it into a WARNING, and NOTHING would be enqueued.
INSERT INTO public.files
  (id, project_id, name, storage_provider, storage_path, thumbnail_url, is_financial)
VALUES ('aaaa1111-0000-0000-0000-0000000064c3',
        'aaaa1111-0000-0000-0000-000000000001', 'local.png', 'local_server',
        'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/12-local.png',
        'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/12-local.png.jpg',
        false);
DELETE FROM public.files WHERE id = 'aaaa1111-0000-0000-0000-0000000064c3';

SELECT is(
  (SELECT provider || '|' || bucket_id || '|' || kind FROM public.storage_gc_queue
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
      AND object_path = 'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/12-local.png.jpg'),
  'supabase|rabbit-thumbnails|thumbnail',
  'a local_server row''s Petal-hosted preview still enqueues — the arm did not inherit the body''s provider');

-- ...and its body still enqueues NOTHING, because there is no Supabase blob to
-- dispose of. The two decisions stay independent (0053's split, kept).
SELECT is(
  (SELECT count(*)::int FROM public.storage_gc_queue
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
      AND object_path = 'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/12-local.png'),
  0,
  'a local_server BODY enqueues nothing — certifying a blob that was never there is worse than silence');

-- 2d. 🚨 THE MONEY PIN. An invoice's body never leaves Supabase (0050's
--     files_money_provider_chk refuses the row outright), so its preview must
--     stay in rabbit-thumbnails whatever the workspace chose. Money-gated files
--     are this rule APPLIED, not an exception to it.
INSERT INTO public.files
  (id, project_id, name, storage_provider, storage_path, thumbnail_url, is_financial)
VALUES ('aaaa1111-0000-0000-0000-0000000064c4',
        'aaaa1111-0000-0000-0000-000000000001', 'invoice.pdf', 'supabase',
        'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/l1/13-invoice.pdf',
        'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/l1/13-invoice.pdf.jpg',
        true);
DELETE FROM public.files WHERE id = 'aaaa1111-0000-0000-0000-0000000064c4';

SELECT is(
  (SELECT provider || '|' || bucket_id || '|' || kind FROM public.storage_gc_queue
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
      AND object_path = 'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/l1/13-invoice.pdf.jpg'),
  'supabase|rabbit-thumbnails|thumbnail',
  'an invoice''s preview stays on Petal — the money pin decides the body, and the preview follows it');

-- ── 3. The key layout the money gate depends on ─────────────────────────────
-- 🚨 The preview's key is its source's key plus '.jpg' precisely so the THIRD
-- segment — public.rabbit_money_segment, 0042 — is IDENTICAL for both.
--
-- ⚠️ COMPARED AGAINST THE SOURCE'S OWN QUEUE ROW, JOINED ON file_id — NOT
-- against the same path with '.jpg' stripped. The obvious form,
--     rabbit_money_segment(split_part(p,'/',3))
--       = rabbit_money_segment(split_part(replace(p,'.jpg',''),'/',3))
-- compares a value with ITSELF: '.jpg' only ever occurs in the LAST segment, so
-- removing it cannot change the third one, and a `thumbs/` level would shift
-- both operands equally. It passes against every possible input, including the
-- rewrite it claims to catch. Joining to the body row is what makes this
-- discriminate. (Caught in this session's own review of its own suite.)
SELECT is(
  (SELECT count(*)::int
     FROM public.storage_gc_queue t
     JOIN public.storage_gc_queue b
       ON b.file_id = t.file_id AND b.kind = 'body'
    WHERE t.workspace_id = '11111111-1111-1111-1111-111111111111'
      AND t.kind = 'thumbnail'
      AND split_part(t.object_path, '/', 3)
          IS DISTINCT FROM split_part(b.object_path, '/', 3)),
  0,
  'every enqueued preview shares its source''s THIRD path segment — the money gate reads it');

-- 🚨 ITS CONTROL. The probe above is a count-of-violations, which passes just as
-- well against a join that matches NOTHING — the exact vacuity this suite just
-- removed from its own predecessor. Standing rule 2: prove the population is
-- non-empty, or the assertion is decoration.
SELECT is(
  (SELECT count(*)::int
     FROM public.storage_gc_queue t
     JOIN public.storage_gc_queue b
       ON b.file_id = t.file_id AND b.kind = 'body'
    WHERE t.workspace_id = '11111111-1111-1111-1111-111111111111'
      AND t.kind = 'thumbnail'),
  -- THREE pairs, not two: the supabase plate (2a), the s3 still (2b) and the
  -- supabase INVOICE (2d). The local_server row (2c) is deliberately absent —
  -- its body enqueues nothing, so there is no row to join to. Getting this
  -- number wrong is how the control itself becomes decoration.
  3,
  'and it was measured over all THREE body/preview pairs this suite enqueued (supabase, s3, invoice)');

SELECT * FROM finish();
ROLLBACK;
