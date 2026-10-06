-- pgTAP: 0053 — the rabbit-thumbnails bucket, its eight policies, and the
-- derived object's disposal.
--
-- WHAT THIS SUITE EXISTS TO CATCH, in order of how badly it would hurt:
--
--   * 🚨 AN INVOICE'S THUMBNAIL IS A LEGIBLE PICTURE OF THE INVOICE. The money
--     gate is the THIRD path segment (public.rabbit_money_segment, 0042), and
--     it gates the row and the source blob. If the derived image lands on the
--     base policies instead, every project member can read a smaller copy of
--     the document RLS is withholding. Probe 13 is the one that matters;
--     probe 10 is its control, proving a money-cleared manager CAN read the
--     same object — otherwise 13 would pass just as well if nobody could
--     (standing rule 2, suite 53's own reasoning).
--
--   * A PARTIAL POLICY PORT. This session's brief and design §5d.1 both say
--     rabbit-files has "FOUR policies: three base + rabbit_files_invoices_select"
--     and say to port those. Measured: there are EIGHT, they live in 0042 (not
--     0027), and rabbit_files_invoices_select was DROPPED by 0042:212-214.
--     Following the brief would have shipped this bucket with no UPDATE arm and
--     no money policies at all. Probes 4-6 assert the shape the brief would
--     have got wrong, in the catalog, so the count cannot silently drift.
--
--   * A PUBLIC BUCKET. TPN-CLOUD-004 is exactly this defect on user-avatars
--     and is still open. Repeating it for frames of pre-release content would
--     be materially worse. Probe 1.
--
--   * A DERIVED OBJECT OUTLIVING ITS SOURCE — TPN-CONT-011. Probes 16-20 drive
--     the enqueue trigger END-TO-END: real INSERT, real DELETE, read the queue.
--
-- 🚨 PROBE 19 IS THE ONE THAT WOULD NOT EXIST IF THE TRIGGER HAD BEEN LEFT
-- ALONE. 0051's WHEN clause fired only for storage_provider IN ('supabase','s3').
-- A local_server or google_drive row has no Supabase body but CAN carry a
-- Petal-hosted thumbnail; under the old clause that thumbnail was never
-- enqueued and would have survived its source forever. 0053 widens the WHEN and
-- guards the body INSERT separately, so both halves stay right.
--
-- Runs as postgres for the catalog and trigger probes (neither is RLS); role is
-- switched only for the policy probes. storage_gc_queue reads are scoped to the
-- fixture workspace — the unscoped-count decay rule.

BEGIN;

SELECT plan(20);

SELECT * FROM tests.rls_setup();

-- A plain team member on project A — the person the money gate exists for.
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local',
        crypt('testpw', gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        'authenticated', 'authenticated',
        '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES ('11111111-1111-1111-1111-111111111111',
        'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role)
VALUES ('aaaa1111-0000-0000-0000-000000000001',
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;


-- ═══════════════════════════════════════════════════════════════════════
-- The bucket itself — the settings a client cannot bypass
-- ═══════════════════════════════════════════════════════════════════════

-- 1: 🚨 PRIVATE. The instinct is "thumbnails are small, make it public so they
-- load fast"; that is TPN-CLOUD-004 repeated for pre-release content.
SELECT is(
  (SELECT public FROM storage.buckets WHERE id = 'rabbit-thumbnails'),
  false,
  'the rabbit-thumbnails bucket exists and is PRIVATE');

-- 2: the cap that forced the second bucket. A NULL limit accepts a multi-GB
-- "thumbnail", which is the entire reason rabbit-files could not hold these.
SELECT is(
  (SELECT file_size_limit FROM storage.buckets WHERE id = 'rabbit-thumbnails'),
  262144::bigint,
  'the thumbnail bucket caps objects at 256 KB, enforced by Storage');

-- 3: narrower than rabbit-files on purpose — the generator emits JPEG only, so
-- Storage itself can refuse a mislabelled body.
SELECT is(
  (SELECT array_to_string(allowed_mime_types, ',')
     FROM storage.buckets WHERE id = 'rabbit-thumbnails'),
  'image/jpeg',
  'the thumbnail bucket accepts image/jpeg and nothing else');


-- ═══════════════════════════════════════════════════════════════════════
-- The eight policies — the shape the brief got wrong
-- ═══════════════════════════════════════════════════════════════════════

-- 4: EIGHT, and every one routes through the single money predicate. Seven
-- means an arm was dropped; a policy that omits the predicate is one that
-- cannot tell an invoice from a dailies frame.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname LIKE 'rabbit_thumbnails%'
      AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%rabbit_money_segment%'),
  8,
  'all 8 rabbit-thumbnails policies share the one money-segment predicate');

-- 5: the money four carry the money gate ITSELF. A predicate that selects the
-- right objects and forgets to check the caller matches everything and stops
-- nobody (0042's post-condition 4, and the half the brief omitted entirely).
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname LIKE 'rabbit_thumbnails_money_%'
      AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%can_access_project_money%'),
  4,
  'the 4 money-gated thumbnail policies carry can_access_project_money');

-- 6: both UPDATE arms exist WITH a WITH CHECK. With only USING, an ordinary
-- thumbnail can be renamed INTO the gated segment. Probe 15 exercises it.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname IN ('rabbit_thumbnails_update', 'rabbit_thumbnails_money_update')
      AND cmd = 'UPDATE' AND with_check IS NOT NULL),
  2,
  'both thumbnail UPDATE policies pin their WITH CHECK side too');

-- 7: 🚨 THE NEIGHBOUR CHECK. 0042's post-conditions and suite 53:213-219 both
-- count 'rabbit_files%' policies and require exactly 8. Naming these
-- rabbit_files_thumb_* would make that read 12 and fail three files away, and
-- the tempting fix would be to relax the assertion — which is how a money
-- predicate gets dropped. Asserted here so the cause is named at the cause.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname LIKE 'rabbit_files%'),
  8,
  'the rabbit-files policy count is untouched at 8 — the new prefix does not collide');


-- ═══════════════════════════════════════════════════════════════════════
-- As a money-cleared manager: writes, and the control for probe 13
-- ═══════════════════════════════════════════════════════════════════════

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- 8: an ordinary thumbnail, at the source key + '.jpg'. The accept control —
-- without it, a suite where nothing can be written proves nothing.
SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-thumbnails',
            'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/1-dailies.mov.jpg',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"image/jpeg"}'::jsonb)$$,
  'a project writer can write an ordinary thumbnail');

-- 9: and a money-gated one. Third segment INVOICES → the money policies.
SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-thumbnails',
            'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/l1/1-invoice.pdf.jpg',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"image/jpeg"}'::jsonb)$$,
  'a money-cleared manager can write an invoice thumbnail');

-- 10: 🚨 THE CONTROL FOR PROBE 13, and it has to run here while still cleared.
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'rabbit-thumbnails'
      AND name = 'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/l1/1-invoice.pdf.jpg'),
  1,
  'CONTROL: a money-cleared manager CAN read the invoice thumbnail');

-- 11: the UPDATE arm. A thumbnail is regenerated in place at a key derived
-- from its source's key, unlike its source, which is immutable (upsert:false).
-- An RLS-refused UPDATE raises NOTHING and affects zero rows — count them,
-- never trust silence (suite 53's probe 6, the S26 manifest defect).
WITH upd AS (
  UPDATE storage.objects
     SET metadata = '{"mimetype":"image/jpeg","regenerated":true}'::jsonb
   WHERE bucket_id = 'rabbit-thumbnails'
     AND name = 'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/1-dailies.mov.jpg'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1,
  'a thumbnail can be REGENERATED in place — the UPDATE arm the brief omitted');

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;


-- ═══════════════════════════════════════════════════════════════════════
-- As a plain project member: the gate
-- ═══════════════════════════════════════════════════════════════════════

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 12: the control in the other direction. Ordinary thumbnails MUST stay
-- readable by the team, or the feature does nothing for anyone — and probe 13
-- would pass because the bucket was simply unreadable.
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'rabbit-thumbnails'
      AND name = 'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/1-dailies.mov.jpg'),
  1,
  'CONTROL: a project member CAN read an ordinary thumbnail');

-- 13: 🚨 THE ONE THAT MATTERS. The invoice is manager-only in the database and
-- manager-only in rabbit-files; a readable picture of it defeats both.
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'rabbit-thumbnails'
      AND name = 'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/l1/1-invoice.pdf.jpg'),
  0,
  'a project member CANNOT read the invoice THUMBNAIL — the money gate holds on the derived object');

-- 14: nor plant one of their own in the gated segment, which would be a
-- readable object at a manager-only path.
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-thumbnails',
            'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/l1/mine.jpg',
            'cccccccc-cccc-cccc-cccc-cccccccccccc',
            '{"mimetype":"image/jpeg"}'::jsonb)$$,
  'new row violates row-level security policy for table "objects"',
  'a project member cannot write a thumbnail into the money-gated segment');

-- 15: and cannot smuggle an ordinary thumbnail across the boundary by renaming
-- it. This is the WITH CHECK arm; with only USING it would succeed.
--
-- 🚨 THIS PROBE MUST BE throws_ok, NOT A ROW COUNT, and the difference is the
-- kind that hides a hole. RLS treats the two arms differently: a USING failure
-- silently yields zero rows, but a WITH CHECK failure RAISES. Written as a row
-- count this probe passes against a bucket with NO POLICIES AT ALL — which is
-- exactly the state it is supposed to catch. Measured the hard way: as a count
-- it passed before 0053 existed, then aborted the whole transaction after.
-- (Its own fixture, member-owned, so probe 12's object is left alone.)
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES ('rabbit-thumbnails',
        'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/63-mine.png.jpg',
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        '{"mimetype":"image/jpeg"}'::jsonb);

SELECT throws_ok(
  $$UPDATE storage.objects
       SET name = 'projects/aaaa1111-0000-0000-0000-000000000001/FINANCE/l1/sneaked.jpg'
     WHERE name = 'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/63-mine.png.jpg'$$,
  'new row violates row-level security policy for table "objects"',
  'a member cannot RENAME an ordinary thumbnail into the money-gated segment (WITH CHECK arm)');

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;


-- ═══════════════════════════════════════════════════════════════════════
-- Disposal: the derived object dies with its source (TPN-CONT-011)
-- Driven end-to-end — real INSERT, real DELETE, read the queue (suite 61).
-- ═══════════════════════════════════════════════════════════════════════

-- A supabase-backed file WITH a thumbnail.
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path,
                          thumbnail_url, is_financial)
VALUES ('aaaa1111-0000-0000-0000-0000000063a1',
        'aaaa1111-0000-0000-0000-000000000001', 'plate.png', 'supabase',
        'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/63a1-plate.png',
        'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/63a1-plate.png.jpg',
        false);
DELETE FROM public.files WHERE id = 'aaaa1111-0000-0000-0000-0000000063a1';

-- 16: the body still enqueues exactly as it did before 0053.
SELECT is(
  (SELECT provider || '|' || bucket_id FROM public.storage_gc_queue
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
      AND object_path = 'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/63a1-plate.png'),
  'supabase|rabbit-files',
  'the source body still enqueues for certified disposal — 0053 did not disturb it');

-- 17: 🚨 and so does the thumbnail, into its own bucket. Without this the
-- derived image survives its source, orphaned and uncertificated —
-- TPN-CONT-011 verbatim, which is the finding this bucket had to avoid.
SELECT is(
  (SELECT provider || '|' || bucket_id FROM public.storage_gc_queue
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
      AND object_path = 'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/63a1-plate.png.jpg'),
  'supabase|rabbit-thumbnails',
  'the derived thumbnail is enqueued too, on the SAME purge, into its own bucket');

-- A supabase-backed file with NO thumbnail: exactly one row, not a phantom
-- second one for an object that never existed.
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial)
VALUES ('aaaa1111-0000-0000-0000-0000000063a2',
        'aaaa1111-0000-0000-0000-000000000001', 'notes.txt', 'supabase',
        'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/63a2-notes.txt', false);
DELETE FROM public.files WHERE id = 'aaaa1111-0000-0000-0000-0000000063a2';

-- 18: a NULL thumbnail_url enqueues nothing extra. A certificate for an object
-- that was never written is a lie in the disposal ledger.
SELECT is(
  (SELECT count(*)::int FROM public.storage_gc_queue
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
      AND file_id = 'aaaa1111-0000-0000-0000-0000000063a2'),
  1,
  'a file with no thumbnail enqueues ONE row — no certificate for an object that never existed');

-- 🚨 A local_server file WITH a thumbnail. Under 0051's WHEN clause the trigger
-- would not have fired AT ALL for this row.
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path,
                          thumbnail_url, is_financial)
VALUES ('aaaa1111-0000-0000-0000-0000000063a3',
        'aaaa1111-0000-0000-0000-000000000001', 'local.png', 'local_server',
        'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/63a3-local.png',
        'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/63a3-local.png.jpg',
        false);
DELETE FROM public.files WHERE id = 'aaaa1111-0000-0000-0000-0000000063a3';

-- 19: 🚨 THE WIDENED WHEN. Exactly one queue row, and it is the THUMBNAIL —
-- no body row, because a local_server body is not this system's to dispose of
-- and certifying it would be a false statement.
SELECT is(
  (SELECT count(*)::int || '|' || coalesce(max(bucket_id), 'none')
     FROM public.storage_gc_queue
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
      AND file_id = 'aaaa1111-0000-0000-0000-0000000063a3'),
  '1|rabbit-thumbnails',
  'a non-Supabase file''s thumbnail is still disposed of — and its body is NOT falsely certified');

-- S37 parity: an s3 row must be untouched by this migration.
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial)
VALUES ('aaaa1111-0000-0000-0000-0000000063a4',
        'aaaa1111-0000-0000-0000-000000000001', 'dailies.mov', 's3',
        'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/63a4-dailies.mov', false);
DELETE FROM public.files WHERE id = 'aaaa1111-0000-0000-0000-0000000063a4';

-- 20: 0051's signed-DELETE arm survives a migration that rewrote its function.
SELECT is(
  (SELECT provider || '|' || bucket_id FROM public.storage_gc_queue
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
      AND object_path = 'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/63a4-dailies.mov'),
  's3|byo-s3',
  'S37 regression: an s3 body still enqueues to the byo-s3 drain after 0053 rewrote the function');

SELECT finish();
ROLLBACK;
