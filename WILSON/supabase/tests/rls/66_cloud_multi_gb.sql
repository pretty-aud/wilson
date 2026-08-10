-- =============================================================================
-- 66_cloud_multi_gb.sql — Session 42: cloud mode can hold the customer's media
-- (migrations 0057 AND 0058 — read both; 0058 removed two things 0057 added)
--
-- What this pins, in order of how badly it would hurt to get wrong:
--
--   * 🚨 A QUOTA THAT REFUSES EVERY RESUMABLE UPLOAD. storage-api checks
--     permission TWICE: once at upload creation through a rolled-back trial
--     insert, once for real at completion. The trial carries `contentLength`;
--     the committed row carries `size`. A predicate that reads only `size` is
--     therefore NULL at creation — and under a RESTRICTIVE policy A NULL DENIES
--     — so every multi-GB upload in the product would fail with a symptom
--     indistinguishable from the quota working correctly. Probe 15 is the
--     tripwire, and it is the single most important assertion in this file.
--
--   * 🚨 A QUOTA THAT DENIES WHEN IT SIMPLY DOES NOT KNOW. The weighing must
--     fall back to 0055's `used < quota` when no byte count is present, never
--     refuse. Probe 16 is the one that notices; without it, any change to how
--     storage-api populates metadata silently bricks uploads.
--
--   * A CAP RAISED IN THE ROW AND NOWHERE ELSE. Probe 1 asserts the bucket
--     figure this migration wrote. ⚠️ IT CANNOT ASSERT THE CEILING THAT ACTUALLY
--     BINDS: Supabase caps every bucket at a PROJECT-LEVEL global limit that
--     lives in the dashboard, not in the database. Nothing in SQL can observe
--     it. That is stated here rather than left for someone to assume this suite
--     covers it — the only proof is a real large file through the real client.
--
--   * 🚨 THE CONCURRENCY HOLE IS OPEN, AND PROBE 13 SAYS SO IN EXECUTABLE FORM.
--     An earlier draft of this file claimed the opposite. 0057 taught
--     workspace_petal_bytes to count storage.s3_multipart_uploads.in_progress_size
--     and three probes here asserted that N concurrent uploads could no longer
--     each pass a check blind to the others. That was FALSE: WILSON uploads over
--     TUS, whose state storage-api keeps in S3 `.info` objects via @tus/s3-store,
--     and the table is written only by the S3-compatible protocol handler WILSON
--     never calls. The three probes passed solely on rows this suite inserted
--     itself — a green test over a path the product does not have, in the suite
--     written to catch exactly that. 0058 removed the arm; probe 13 now asserts
--     the meter does NOT move, so re-adding it fails here first.
--
--   * 🚨 AND THE LIFECYCLE TERM WENT WITH IT. 0057 added 'upload_abandoned' and
--     purge_abandoned_uploads() for TPN-CONT-017, five probes drove the sweep,
--     and the fragments it was written to dispose of are not in Postgres either.
--     A term with no writer and a writer with nothing to find are the same
--     defect twice. Probes 25-28 now assert both are gone; probe 29 is the CI
--     guard that no public function names that table at all, because
--     workspace_petal_bytes is LANGUAGE sql (parse-analyzed at CREATE) and CI
--     starts its stack with `--exclude storage-api`.
--
-- Postgres-side reads are ALWAYS scoped to the fixture workspaces — dev carries
-- real rows and an unscoped count decays the day the feature is used.
--
-- PROVEN BY SIX BREAKERS AGAINST 0057 BEFORE COMMIT (2026-08-09), each run in a
-- rolled-back transaction against wilson-dev. Two columns, because they are two
-- different claims and only one of them was measured for every row:
--
--                                                   0057 post-cond │ THIS suite
--   B1  policy calls the 1-arg shim (no weighing) ....... CAUGHT   │ predicted 14,15
--   B2  size reader ignores contentLength ............... CAUGHT   │ MEASURED 6, 15
--   B3  drop AS RESTRICTIVE ............................. CAUGHT   │ predicted 21,22
--   B4  drop the 1-arg shim ............................. CAUGHT   │ (0056 replay)
--   B5  cap left at 52428800 ............................ CAUGHT   │ predicted 1
--   B6  meter drops the in-flight UNION arm ............. CAUGHT   │ RETIRED — 0058
--   B7  CONTROL, a comment-only change .................. n/a      │ MEASURED 35/35
--
-- ⚠️ THE PROBE NUMBERS ABOVE WERE MEASURED AGAINST THE 35-PROBE VERSION OF THIS
-- FILE and are restated for the 30-probe version 0058 left behind. B6 is retired
-- rather than renumbered: the arm it broke no longer exists, and probe 13 now
-- asserts the opposite property. The B7 control ran at 35/35 on the old shape;
-- the current shape runs 30/30.
--
-- 🚨 "predicted" MEANS EXACTLY THAT — NOT MEASURED. The first draft of this
-- header asserted a probe mapping for all six as though it had been observed,
-- when what had actually been run was breaker-vs-POST-CONDITION. B2 and B6 were
-- then driven through the suite itself and both mappings turned out to be
-- incomplete: B2 also failed probe 6, B6 also failed the cross-workspace probe.
-- Left honest rather than tidied, because a suite header that overstates its own
-- evidence is the same defect this file exists to catch one level up.
--
-- ⚠️ B2's RESULT IS THE ONE TO READ. The contentLength probe failed with "[no
-- exception raised]" — the over-quota upload was WAVED THROUGH, not refused.
-- That is the live shape of the defect: not an error anyone would see, just a
-- quota that silently stops applying to the one path it was written for.
--
-- ⚠️ B4's FIRST FORM PASSED, AND THAT WAS THE BREAKER BEING WRONG, NOT THE
-- ASSERTION. Renaming the shim's CREATE OR REPLACE proves nothing, because 0055
-- had already created that signature and a renamed CREATE leaves the original
-- standing. Dropping it for real fires post-condition 4. Recorded because a
-- breaker that passes is normally evidence the assertion is decorative, and
-- here it was evidence the breaker was.
--
-- ⚠️ AND A HARNESS TRAP, MEASURED TWICE WHILE DOING THIS. A dollar sign inside a
-- dollar-quoted function body — including inside a `--` comment within it —
-- makes the tap shim mis-scan the rest of the FILE, and the syntax error
-- surfaces hundreds of lines later at an unrelated statement. Keep breaker
-- bodies dollar-free.
-- =============================================================================

BEGIN;

SELECT plan(30);

SELECT * FROM tests.rls_setup();

-- ══ 1. The statics this migration moved ═════════════════════════════════════

SELECT is(
  (SELECT file_size_limit FROM storage.buckets WHERE id = 'rabbit-files'),
  53687091200::bigint,
  'rabbit-files caps at 50 GiB — ⚠️ the DASHBOARD global limit also binds and SQL cannot see it');
                                                                            -- 1

-- The two buckets that must NOT have moved with it. A thumbnail is a 256px
-- JPEG and an avatar is a photograph of a person; neither has any business
-- growing because project media did.
SELECT is(
  (SELECT file_size_limit FROM storage.buckets WHERE id = 'rabbit-thumbnails'),
  262144::bigint, 'rabbit-thumbnails is still 256 KiB');                     -- 2

SELECT is(
  (SELECT file_size_limit FROM storage.buckets WHERE id = 'user-avatars'),
  2097152::bigint, 'user-avatars is still 2 MiB');                           -- 3

SELECT is(public.storage_free_tier_bytes(), 5368709120::bigint,
  'the rowless free tier is 5 GiB — a 1 GiB trial cannot hold one clip at a 50 GiB cap');
                                                                            -- 4

-- ══ 2. The size reader — every arm, because a NULL here DENIES ══════════════

SELECT is(public.rabbit_object_incoming_bytes('{"size":123}'::jsonb), 123::bigint,
  'reads metadata->>size — the key on a COMMITTED object');                 -- 5

-- 🚨 THE KEY THE TUS PERMISSION TEST ACTUALLY CARRIES. storage-api's tus
-- lifecycle passes {mimetype, contentLength} into canUpload; `size` is absent
-- until completion.
SELECT is(public.rabbit_object_incoming_bytes('{"contentLength":456}'::jsonb), 456::bigint,
  'reads metadata->>contentLength — the key present at tus upload CREATION');
                                                                            -- 6

SELECT is(public.rabbit_object_incoming_bytes('{"size":1,"contentLength":2}'::jsonb), 1::bigint,
  'size wins when both are present');                                       -- 7

-- Never raises: an exception inside a policy expression fails the INSERT with a
-- cast error nobody can read, rather than failing open or closed.
SELECT is(public.rabbit_object_incoming_bytes('{"size":"abc"}'::jsonb), NULL::bigint,
  'a non-numeric size is NULL, not an exception inside the policy');         -- 8

SELECT is(public.rabbit_object_incoming_bytes(NULL::jsonb), NULL::bigint,
  'NULL metadata is NULL, not an error');                                    -- 9

-- ══ 3. The meter, before anything exists ════════════════════════════════════

-- Runs before any object exists, which is the only moment it can catch a
-- dropped outer COALESCE. NULL here denies every first upload in every new
-- workspace and looks exactly like a working quota.
SELECT is(public.workspace_petal_bytes('11111111-1111-1111-1111-111111111111'),
  0::bigint,
  'a workspace with no objects and no uploads meters 0, never NULL');        -- 10

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/1-plate.png',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"image/png","size":5000000}'::jsonb)$$,
  'PRESENCE CONTROL: the free tier allows an upload — every refusal below is real');
                                                                            -- 11

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

SELECT is(public.workspace_petal_bytes('11111111-1111-1111-1111-111111111111'),
  5000000::bigint, 'the committed object is metered');                       -- 12

-- ══ 4. 🚨 BYTES IN FLIGHT ARE REAL BYTES ════════════════════════════════════
-- A resumable upload has no storage.objects row until it completes. 0055's
-- meter therefore read zero for it.

-- 🚨 AND THEY ARE NOT COUNTED, WHICH IS THE OPPOSITE OF WHAT 0057 SHIPPED.
--
-- 0057 §4 added a UNION arm summing storage.s3_multipart_uploads.in_progress_size
-- and this suite asserted, in three probes, that it closed the concurrency hole.
-- Migration 0058 removed that arm, because the premise was false: WILSON uploads
-- over TUS (/storage/v1/upload/resumable), whose state storage-api keeps in S3
-- `.info` objects via @tus/s3-store with an in-process cache — it writes NOTHING
-- to Postgres. That table is populated only by the S3-COMPATIBLE PROTOCOL
-- handler (/storage/v1/s3/...), which WILSON never calls.
--
-- So the three probes that stood here passed ONLY because this suite inserted
-- the rows itself. They asserted coverage of a path the product does not have —
-- the exact "green test over a dead path" this repo pays most for, written into
-- the suite meant to catch it.
--
-- This single probe replaces them and states the truth in executable form: a
-- multipart row does NOT move the meter. If someone re-adds the arm, this fails
-- and they have to confront the reasoning above rather than rediscover it.
--
-- ⚠️ THE CONCURRENCY HOLE IS THEREFORE OPEN — two 30 GiB uploads started
-- together against a 50 GiB quota both pass their creation check. It was open
-- before 0057 too; 0057 only appeared to close it. Recorded in OUTSTANDING.md.

-- ⚠️ THE FIXTURE IS GUARDED, AND THAT IS ABOUT CI, NOT TIDINESS.
-- storage.s3_multipart_uploads is created by storage-api's own migrator, and
-- .github/workflows/rls.yml starts the stack with `--exclude storage-api`.
-- storage.objects demonstrably survives that (suite 65 writes to it and passes),
-- but nothing proves this table does — and an unguarded INSERT against a missing
-- relation would abort the suite and take the whole pgTAP job with it.
--
-- If the table is absent the probe still holds, trivially: a meter that cannot
-- see a row it has no table for has not moved. Said plainly rather than left for
-- someone to discover the probe is weaker in CI than on dev.
DO $$
BEGIN
  IF to_regclass('storage.s3_multipart_uploads') IS NOT NULL THEN
    INSERT INTO storage.s3_multipart_uploads
      (id, in_progress_size, upload_signature, bucket_id, key, version, owner_id, created_at)
    VALUES ('upl-inflight-a', 40000000, 'sig', 'rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/7-master.mov',
            '1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now());
  END IF;
END $$;

SELECT is(public.workspace_petal_bytes('11111111-1111-1111-1111-111111111111'),
  5000000::bigint,
  '🚨 an in-flight multipart row does NOT move the meter — WILSON''s TUS path never writes that table, so counting it metered a permanently empty set');
                                                                            -- 13

DO $$
BEGIN
  IF to_regclass('storage.s3_multipart_uploads') IS NOT NULL THEN
    DELETE FROM storage.s3_multipart_uploads WHERE id LIKE 'upl-inflight-%';
  END IF;
END $$;

-- ══ 5. 🚨 THE WEIGHING ══════════════════════════════════════════════════════
-- used = 5,000,000. A quota of 10,000,000 leaves 5,000,000 of headroom.

INSERT INTO public.workspace_storage_plans (workspace_id, status, quota_bytes)
VALUES ('11111111-1111-1111-1111-111111111111', 'active', 10000000)
ON CONFLICT (workspace_id) DO UPDATE
  SET status = EXCLUDED.status, quota_bytes = EXCLUDED.quota_bytes;

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- 🚨 THE HEADLINE. Under 0055 this SUCCEEDED — `used < quota` was true at
-- 5,000,000 < 10,000,000 and the incoming object was never weighed. It is the
-- assertion that would go green again the moment the policy reverts to the
-- 1-arg shim.
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/2-big.mov',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"video/quicktime","size":6000000}'::jsonb)$$,
  -- 🚨 THE POLICY BY NAME, not a generic RLS string. Suite 65 learned this the
  -- hard way: a generic message passes even when some OTHER policy did the
  -- refusing, which turns the probe's claim into an argument instead of an
  -- assertion.
  'new row violates row-level security policy "petal_storage_quota_insert" for table "objects"',
  '🚨 a file that would CROSS the ceiling is refused — 0055 allowed this exact insert');
                                                                            -- 14

-- 🚨 ORDER IS LOAD-BEARING IN THIS SECTION, AND THE FIRST DRAFT GOT IT WRONG.
-- Probe 17 has to run while there is still HEADROOM (used < quota). Written
-- after the ceiling was filled, it passed for the wrong reason: with the
-- workspace already full, a reader that ignored contentLength would fall back
-- to `used < quota`, find 10,000,000 < 10,000,000 false, and refuse anyway —
-- green, and blind to the defect it exists to catch.
--
-- ⚠️ Nothing here deletes from storage.objects, deliberately. storage.objects
-- and storage.buckets carry a `protect_delete` trigger ("Direct deletion from
-- storage tables is not allowed. Use the Storage API instead."), so the tidy
-- form of this section — insert, assert, delete, reset — cannot run at all.
-- MEASURED on wilson-dev: the trigger is on those two tables only, which is
-- also why purge_abandoned_uploads() may delete multipart rows.

-- 🚨 THE MOST IMPORTANT ASSERTION IN THIS FILE. This is the row shape
-- storage-api's tus permission test inserts at upload CREATION: contentLength,
-- no size. If rabbit_object_incoming_bytes stops reading contentLength this
-- becomes NULL, the CASE takes the unknown branch, `used < quota` is TRUE, and
-- the upload is WAVED THROUGH — 0057's weighing silently stops applying to the
-- exact path it was written for. (And if the fallback were removed instead,
-- NULL would DENY and every resumable upload in the product would fail.)
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/5-tus.mov',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"video/quicktime","contentLength":6000000}'::jsonb)$$,
  -- 🚨 THE POLICY BY NAME, not a generic RLS string. Suite 65 learned this the
  -- hard way: a generic message passes even when some OTHER policy did the
  -- refusing, which turns the probe's claim into an argument instead of an
  -- assertion.
  'new row violates row-level security policy "petal_storage_quota_insert" for table "objects"',
  '🚨 a tus CREATION-shaped row (contentLength, no size) is weighed — reading only `size` breaks every resumable upload');
                                                                            -- 15

-- 🚨 AND THE CONVERSE: unknown size must NOT deny. Under a restrictive policy a
-- NULL denies, so a metadata shape carrying no byte count at all has to fall
-- back to 0055's `used < quota` rather than refuse.
-- (Contributes 0 to the meter, so the headroom below is unchanged.)
SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/6-nosize.mov',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"video/quicktime"}'::jsonb)$$,
  'an object with NO byte count is allowed while under quota — never deny for lack of information');
                                                                            -- 16

-- ...and something that FITS is still accepted, so probes 16-17 are not
-- "everything is refused now". used 5,000,000 -> 6,000,000.
SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/3-fits.mov',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"video/quicktime","size":1000000}'::jsonb)$$,
  'a file that fits inside the headroom is still accepted');                 -- 17

-- Headroom is now exactly 4,000,000. Landing ON the ceiling is legal: the
-- predicate is `<=`, because used + incoming IS the total after the write.
-- Written as `<` this passes for every other case and fails only here.
SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/4-exact.mov',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"video/quicktime","size":4000000}'::jsonb)$$,
  'a file that lands exactly ON the ceiling is allowed — the predicate is <=');
                                                                            -- 18

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

-- ══ 6. Composition: over quota, the other rules still hold ══════════════════
-- Squeeze the quota below current usage so everything below is a genuine
-- over-quota state.

UPDATE public.workspace_storage_plans
   SET quota_bytes = 1000
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111';

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/8-over.png',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"image/png","size":10}'::jsonb)$$,
  -- 🚨 THE POLICY BY NAME, not a generic RLS string. Suite 65 learned this the
  -- hard way: a generic message passes even when some OTHER policy did the
  -- refusing, which turns the probe's claim into an argument instead of an
  -- assertion.
  'new row violates row-level security policy "petal_storage_quota_insert" for table "objects"',
  'over quota, an ordinary media object is refused');                        -- 19

-- The project manifest is exempt — WILSON's own bookkeeping, rewritten on every
-- project change. Blocking it turns a quota state into a broken app.
SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/PROJECT.json',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"application/json","size":3000}'::jsonb)$$,
  'the project manifest is exempt while over quota');                        -- 20

-- 🚨 A RESTRICTIVE POLICY IS EVALUATED FOR EVERY INSERT INTO storage.objects,
-- and three buckets share that table. These two fail the moment the predicate
-- stops passing for everything it is not about.
SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('user-avatars',
            '11111111-1111-1111-1111-111111111111/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/face.jpg',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"image/jpeg","size":2000}'::jsonb)$$,
  'an avatar still uploads while the workspace is over its MEDIA quota');    -- 21

SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-thumbnails',
            'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/1-plate.png.jpg',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"image/jpeg","size":9000}'::jsonb)$$,
  'a thumbnail still uploads while over quota — gating derived bytes strands a preview half-written');
                                                                            -- 22

-- ⚠️ AND THE HOLE THE ELEGANT FORM OF THE EXEMPTION WOULD OPEN. A depth-3 key
-- is otherwise a legal media path, so "no third segment" alone would let
-- dailies.mov walk through the quota entirely.
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/dailies.mov',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"video/quicktime","size":10}'::jsonb)$$,
  -- 🚨 THE POLICY BY NAME, not a generic RLS string. Suite 65 learned this the
  -- hard way: a generic message passes even when some OTHER policy did the
  -- refusing, which turns the probe's claim into an argument instead of an
  -- assertion.
  'new row violates row-level security policy "petal_storage_quota_insert" for table "objects"',
  'a depth-3 media key is NOT exempt — the exemption tests the filename too');
                                                                            -- 23

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

-- A suspended plan refuses even with room to spare.
UPDATE public.workspace_storage_plans
   SET quota_bytes = 100000000000, status = 'suspended'
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111';

SELECT is(public.rabbit_petal_storage_ok(
    'aaaa1111-0000-0000-0000-000000000001', 10::bigint),
  false, 'a suspended plan refuses regardless of headroom');                 -- 24

UPDATE public.workspace_storage_plans
   SET status = 'active'
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111';

-- ══ 7. The event vocabulary, and the sweep that is NOT here ════════════════
--
-- 0057 added 'upload_abandoned' plus purge_abandoned_uploads(); migration 0058
-- removed BOTH, for the reason section 4 records — the fragments they were
-- written to dispose of are not in Postgres, so the sweep could never find one
-- and the term had no writer. Five probes stood here driving that sweep; they
-- passed only on fixtures this file inserted.
--
-- 🚨 THE VOCABULARY IS ASSERTED IN BOTH DIRECTIONS. 0057 widened it and 0058
-- narrowed it back, and a narrowing that overshoots would silently delete a
-- term the product actually writes — the first symptom being a disposal
-- certificate failing months later.

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
    WHERE conrelid = 'public.file_events'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%uploaded%'),
  1, 'exactly ONE vocabulary constraint on file_events');                    -- 25

SELECT ok(
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conname = 'file_events_event_check')
    LIKE '%downloaded%',
  'the 0057->0058 round trip did not drop 0047''s ''downloaded''');          -- 26

-- ...and the term really is gone, so nothing can write a certificate no sweep
-- produces.
SELECT ok(
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conname = 'file_events_event_check')
    NOT LIKE '%upload_abandoned%',
  '''upload_abandoned'' is NOT in the vocabulary — 0058 removed it with its writer');
                                                                            -- 27

-- The sweep is gone with it. A term without a writer and a writer without
-- fragments are the same defect twice.
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'purge_abandoned_uploads'),
  0, 'purge_abandoned_uploads no longer exists');                            -- 28

-- 🚨 AND NOTHING IN public STILL NAMES storage.s3_multipart_uploads. This is
-- the CI guard: workspace_petal_bytes is LANGUAGE sql, so its body is
-- parse-analyzed at CREATE time, and .github/workflows/rls.yml starts the
-- stack with `--exclude storage-api` — the table that arm referenced is created
-- by storage-api's own migrator, not by anything in supabase/migrations/. A
-- reference here would fail the migration in CI and take all 66 suites down at
-- once, while every S42 check passed against hosted dev where it exists.
-- ⚠️ prokind = 'f' is required: pg_get_functiondef() RAISES for aggregates.
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND pg_get_functiondef(p.oid) LIKE '%s3_multipart_uploads%'),
  0, '🚨 no public function references storage.s3_multipart_uploads — CI runs without storage-api');
                                                                            -- 29

-- ══ 8. Privileges ══════════════════════════════════════════════════════════

-- The policy evaluates these as the INVOKING role, so revoking one too many
-- refuses every upload rather than leaking anything — and would look exactly
-- like the quota working. (0056's converse post-condition, extended to 0057's
-- two new functions.)
SELECT ok(
  has_function_privilege('authenticated', 'public.rabbit_petal_storage_ok(uuid,bigint)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.rabbit_object_incoming_bytes(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.workspace_petal_bytes(uuid)', 'EXECUTE'),
  'the policy predicates are callable by authenticated; the unfiltered aggregate is not');
                                                                            -- 30

SELECT * FROM finish();
ROLLBACK;
