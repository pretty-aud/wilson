-- =============================================================================
-- 77_upload_reservations.sql — Track C, bundle C1: the quota can see an upload
-- before it lands (migration 0073). Read 0058's header first: it is the record
-- of the previous attempt at this hole, which was green and closed nothing.
--
-- What this pins, in order of how badly it would hurt to get wrong:
--
--   * 🚨 THE HEADLINE (probe 20): a reservation that would cross the ceiling is
--     refused at START — with an ACCEPTING control just under the line (probe
--     19, exactly on the ceiling, because the predicate is `<=`).
--
--   * 🚨 NO DOUBLE COUNT (probes 24-25): the upload whose reservation it is
--     lands (its own reservation is not weighed against it — at creation the
--     tus trial insert, at completion the real one), and the instant it lands
--     the meter reads object + OTHER reservations, never object + its own. A
--     client that never calls release cannot make the meter lie.
--
--   * 🚨 THE POLICY SEES THE RESERVATION (probe 27): with 4M committed and 6M
--     reserved, one more byte is refused by petal_storage_quota_insert BY NAME.
--     Before 0073 that insert succeeded — 4M < 10M — and this probe is the
--     executable form of the hole being shut.
--
--   * 🚨 NULL-SAFETY, THE TWIN (probes 6-7): SUM() over zero rows is NULL and a
--     NULL DENIES under a RESTRICTIVE policy. 66/10 pins the committed arm's
--     COALESCE; these pin the reservation arm's, before anything exists.
--
--   * THE SWEEP (probes 33-42, TPN-CONT-017): an expired unreleased reservation
--     whose object never landed is certified 'upload_abandoned' in file_events
--     and closed; one whose object DID land is closed 'completed' with no
--     certificate; another workspace's rows are untouched by the scoped run and
--     swept by the unscoped (cron) one; a second sweep finds nothing.
--
--   * THE s3_multipart METER STILL DOES NOT MOVE (probe 48): keep 66/13 true
--     here too, so re-adding 0057's arm fails in two suites.
--
-- Postgres-side reads are ALWAYS scoped to the fixture workspaces — dev carries
-- real rows and an unscoped count decays the day the feature is used.
--
-- PROVEN BY BREAKERS AGAINST 0073 BEFORE IT WAS APPLIED (2026-09-06), each in a
-- rolled-back shim transaction against wilson-dev: see the commit that ships
-- this file for the table of which probe each one failed.
--
-- ⚠️ Nothing here deletes from storage.objects: the protect_delete trigger
-- forbids it (66's note), so every object this suite inserts stays for the
-- length of the rolled-back transaction and the arithmetic below accounts for
-- each one.
-- =============================================================================

BEGIN;

SELECT plan(53);

SELECT * FROM tests.rls_setup();

-- ══ 1. The shape ════════════════════════════════════════════════════════════

SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.upload_reservations'::regclass),
  'upload_reservations has RLS enabled AND forced');                         -- 1

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'upload_reservations'),
  1, 'exactly one policy');                                                  -- 2

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'upload_reservations'
      AND cmd <> 'SELECT'),
  0, 'zero write policies and no FOR ALL — writes go through the RPCs');     -- 3

-- Review round 1: information_schema.role_table_grants OMITS grants made to
-- PUBLIC (the docs say so — table_privileges is the view that shows them), so
-- `grantee IN ('anon', 'PUBLIC')` could never see a PUBLIC grant. anon INHERITS
-- PUBLIC, so asking what anon can do covers both, for every privilege.
SELECT ok(
  NOT has_table_privilege('anon', 'public.upload_reservations', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.upload_reservations', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.upload_reservations', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.upload_reservations', 'DELETE'),
  'anon — and so PUBLIC, which anon inherits — holds nothing on upload_reservations');
                                                                            -- 4

SELECT is(
  (SELECT count(*)::int FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'upload_reservations'
      AND grantee = 'authenticated' AND privilege_type <> 'SELECT'),
  0, 'authenticated holds SELECT and nothing else');                         -- 5

-- ══ 2. 🚨 NULL-safety, before anything exists ═══════════════════════════════

SELECT is(public.workspace_upload_reserved_bytes('11111111-1111-1111-1111-111111111111', NULL),
  0::bigint,
  '🚨 reserved bytes for a workspace with no reservations is 0, never NULL — a NULL denies every first upload');
                                                                            -- 6

SELECT is(public.workspace_petal_bytes('11111111-1111-1111-1111-111111111111'),
  0::bigint, 'the meter is 0 for an empty workspace, never NULL');           -- 7

-- ══ 3. Reserve, on the free tier ════════════════════════════════════════════

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT ok(
  (SELECT public.reserve_upload_bytes(
     'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/1-r1.mov', 4000000))
  IS NOT NULL,
  'PRESENCE CONTROL: a reservation under the free tier is accepted and returns an id — every refusal below is real');
                                                                            -- 8

-- What the company sees: its own usage figure includes reserved space.
SELECT is(
  (SELECT used_bytes FROM public.workspace_storage_usage()),
  4000000::bigint,
  'workspace_storage_usage() reports reserved space as used — the Admin Terminal sees it');
                                                                            -- 9

-- Quota-exempt paths are reservation-exempt: nothing to weigh, nothing written.
SELECT is(
  (SELECT public.reserve_upload_bytes(
     'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/inv1/1-invoice.pdf', 5000000000)),
  NULL::bigint,
  'a money path is quota-exempt (0055) and so reservation-exempt — NULL, and a 5 GB invoice is not refused');
                                                                            -- 10

SELECT is(
  (SELECT public.reserve_upload_bytes(
     'projects/aaaa1111-0000-0000-0000-000000000001/PROJECT.json', 3000)),
  NULL::bigint, 'the project manifest is exempt too');                       -- 11

-- Authority: the caller's claim must name the project's workspace.
SELECT throws_ok(
  $$SELECT public.reserve_upload_bytes(
      'projects/bbbb2222-0000-0000-0000-000000000001/ASSETS/b1/1-x.mov', 1000)$$,
  '42501'::char(5), NULL,
  'a member of workspace A cannot reserve against workspace B''s quota');    -- 12

SELECT throws_ok(
  $$SELECT public.reserve_upload_bytes(
      'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/0-zero.mov', 0)$$,
  '22023'::char(5), NULL,
  'zero bytes is a malformed request, not a free reservation');              -- 13

SELECT throws_ok(
  $$SELECT public.reserve_upload_bytes('avatars/aaaa/face.jpg', 1000)$$,
  '22023'::char(5), NULL,
  'a non-project path cannot be reserved');                                  -- 14

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

SELECT is(public.workspace_petal_bytes('11111111-1111-1111-1111-111111111111'),
  4000000::bigint, 'the reservation is metered while nothing is committed');  -- 15

SELECT is(public.workspace_upload_reserved_bytes(
    '11111111-1111-1111-1111-111111111111',
    'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/1-r1.mov'),
  0::bigint,
  'the exclusion arm: a key''s OWN reservation is not counted against that key');
                                                                            -- 16

SELECT is(
  (SELECT count(*)::int FROM public.upload_reservations
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
      AND (storage_path LIKE '%INVOICES%' OR storage_path LIKE '%PROJECT.json')),
  0, 'the exempt calls wrote no rows');                                      -- 17

SELECT is(public.workspace_petal_bytes('22222222-2222-2222-2222-222222222222'),
  0::bigint, 'the refused cross-tenant call wrote nothing to workspace B');  -- 18

-- ══ 4. 🚨 The ceiling ═══════════════════════════════════════════════════════
-- Quota 10,000,000; 4,000,000 reserved; headroom 6,000,000.

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

SELECT ok(
  (SELECT public.reserve_upload_bytes(
     'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/2-r2.mov', 6000000))
  IS NOT NULL,
  'ACCEPTING CONTROL just under the line: a reservation landing exactly ON the ceiling is accepted — the predicate is <=');
                                                                            -- 19

SELECT throws_ok(
  $$SELECT public.reserve_upload_bytes(
      'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/3-r3.mov', 1)$$,
  'PT402'::char(5), NULL,
  '🚨 THE HEADLINE: a reservation that would cross the ceiling is refused at START, before any byte moves');
                                                                            -- 20

SELECT throws_ok(
  $$SELECT public.reserve_upload_bytes(
      'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/1-r1.mov', 1)$$,
  '23505'::char(5), NULL,
  'one ACTIVE reservation per key — a second for the same path is refused');  -- 21

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

SELECT is(public.workspace_petal_bytes('11111111-1111-1111-1111-111111111111'),
  10000000::bigint, 'two reservations, nothing committed: the meter is full'); -- 22

-- ══ 5. 🚨 No double count at completion ═════════════════════════════════════

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- The object r1 reserved for. Committed 0 + OTHER reservations 6M + incoming
-- 4M = 10M <= 10M. Written with a 2-arg policy (no key) this is refused —
-- 6M + 4M(own reservation) + 4M(incoming) = 14M — and every resumable upload
-- in the product would be refused at its own completion.
SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/1-r1.mov',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"video/quicktime","size":4000000}'::jsonb)$$,
  '🚨 the upload whose reservation it is LANDS — its own reservation is not weighed against it');
                                                                            -- 23

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

SELECT is(public.workspace_petal_bytes('11111111-1111-1111-1111-111111111111'),
  10000000::bigint,
  '🚨 NO DOUBLE COUNT: object 4M + the other reservation 6M = 10M, not 14M — the reservation stopped counting the instant its object landed, before any release');
                                                                            -- 24

SELECT is(public.workspace_upload_reserved_bytes('11111111-1111-1111-1111-111111111111', NULL),
  6000000::bigint, 'only the still-in-flight reservation is reserved');       -- 25

-- ...and the row the RPC wrote carries the 24 h default the brief names (the
-- only place the DEFAULT is read: every sweep fixture below sets expires_at by
-- hand, so a changed interval would otherwise leave every probe green).
SELECT ok(
  (SELECT released_at IS NULL AND expires_at - created_at = INTERVAL '24 hours'
     FROM public.upload_reservations
    WHERE storage_path = 'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/1-r1.mov'),
  'the landed upload''s row is still OPEN, and it expires 24 h after it was written — the exclusion is by the object''s presence, not by a release');
                                                                            -- 26

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- Before 0073 this succeeded: 4M committed < 10M. Now the policy sees the 6M
-- reservation and refuses one more byte — BY NAME, not a generic RLS string.
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/4-over.mov',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"video/quicktime","size":1}'::jsonb)$$,
  'new row violates row-level security policy "petal_storage_quota_insert" for table "objects"',
  '🚨 THE RESTRICTIVE POLICY SEES THE RESERVATION: 4M committed + 6M reserved, one more byte is refused');
                                                                            -- 27

SELECT is(
  (SELECT public.release_upload_reservation(
     'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/1-r1.mov')),
  true, 'the client releases its own reservation on completion');           -- 28

SELECT is(
  (SELECT public.release_upload_reservation(
     'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/1-r1.mov')),
  false, 'release is idempotent — a second call finds nothing to close');    -- 29

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

-- Another workspace's member cannot release it.
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','22222222-2222-2222-2222-222222222222','app_role','admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT public.release_upload_reservation(
     'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/2-r2.mov')),
  false, 'a member of workspace B cannot release workspace A''s reservation'); -- 30

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT public.release_upload_reservation(
     'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/2-r2.mov')),
  true, 'the abandoning client releases on abort — the space is free again');  -- 31

-- Control: with the reservation released, a 6M object fits (4M + 6M = 10M).
SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/5-fits.mov',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"video/quicktime","size":6000000}'::jsonb)$$,
  'ACCEPTING CONTROL: once the reservation is released, an object that fits the freed space lands');
                                                                            -- 32

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

-- ══ 6. The sweep (TPN-CONT-017) ═════════════════════════════════════════════
-- Three expired, unreleased reservations written directly (the RPC cannot
-- write an expired one): one whose object never landed, one whose object DID
-- land (5-fits.mov above), and one in the other workspace.

INSERT INTO public.upload_reservations
  (workspace_id, project_id, storage_path, bytes, created_by, created_at, expires_at)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000001',
   'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/6-abandoned.mov', 7000000,
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - INTERVAL '25 hours', now() - INTERVAL '1 hour'),
  ('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000001',
   'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/5-fits.mov', 6000000,
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - INTERVAL '25 hours', now() - INTERVAL '1 hour'),
  ('22222222-2222-2222-2222-222222222222', 'bbbb2222-0000-0000-0000-000000000001',
   'projects/bbbb2222-0000-0000-0000-000000000001/ASSETS/b1/7-b-abandoned.mov', 1000,
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', now() - INTERVAL '25 hours', now() - INTERVAL '1 hour');

SELECT is(public.workspace_petal_bytes('11111111-1111-1111-1111-111111111111'),
  10000000::bigint,
  'an EXPIRED reservation no longer counts, swept or not — 4M + 6M committed, nothing else');
                                                                            -- 33

SELECT ok(
  (SELECT abandoned = 1 AND completed = 1
     FROM public.sweep_abandoned_uploads('11111111-1111-1111-1111-111111111111')),
  'the workspace-scoped sweep certifies ONE abandoned and closes ONE completed');
                                                                            -- 34

SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
      AND event = 'upload_abandoned'
      AND project_id = 'aaaa1111-0000-0000-0000-000000000001'
      AND new_path = 'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/6-abandoned.mov'
      AND size_bytes = 7000000),
  1, 'one upload_abandoned certificate, naming the project, the path and the bytes');
                                                                            -- 35

SELECT ok(
  (SELECT details ? 'reservation_id' AND details ? 'started_by' AND actor_user_id IS NULL
     FROM public.file_events
    WHERE new_path = 'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/6-abandoned.mov'
      AND event = 'upload_abandoned'),
  'the certificate carries the reservation id and who started the upload; the actor is the system');
                                                                            -- 36

SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE event = 'upload_abandoned'
      AND new_path = 'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/5-fits.mov'),
  0, '🚨 a reservation whose object LANDED is not certified abandoned — the upload completed');
                                                                            -- 37

SELECT ok(
  (SELECT outcome = 'abandoned' AND swept_at IS NOT NULL AND released_at IS NOT NULL
     FROM public.upload_reservations
    WHERE storage_path = 'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/6-abandoned.mov'),
  'the abandoned row is closed and marked swept');                           -- 38

SELECT ok(
  (SELECT outcome = 'completed' AND swept_at IS NOT NULL AND released_at IS NOT NULL
     FROM public.upload_reservations
    WHERE storage_path = 'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/5-fits.mov'),
  'the completed-but-unreleased row is closed as completed');                -- 39

SELECT is(
  (SELECT count(*)::int FROM public.upload_reservations
    WHERE workspace_id = '22222222-2222-2222-2222-222222222222' AND released_at IS NULL),
  1, 'the workspace-scoped sweep leaves another workspace''s rows alone');   -- 40

SELECT ok(
  (SELECT abandoned = 1 AND completed = 0 FROM public.sweep_abandoned_uploads(NULL)),
  'the unscoped (cron) sweep certifies the other workspace''s abandoned upload');
                                                                            -- 41

SELECT ok(
  (SELECT abandoned = 0 AND completed = 0 FROM public.sweep_abandoned_uploads(NULL)),
  'a second sweep finds nothing — certificates are written once');           -- 42

-- ══ 7. The vocabulary, both directions; the withdrawn sweep stays withdrawn ═

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
    WHERE conrelid = 'public.file_events'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%uploaded%'),
  1, 'exactly ONE vocabulary constraint on file_events');                    -- 43

SELECT ok(
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conname = 'file_events_event_check')
    LIKE '%upload_abandoned%',
  '''upload_abandoned'' is in the vocabulary again — and this time it has a writer');
                                                                            -- 44

-- Review round 1: ALL seven prior terms, not a sample of three.
SELECT ok(
  (SELECT bool_and(pg_get_constraintdef(c.oid) LIKE '%''' || t.term || '''%')
     FROM pg_constraint c
     CROSS JOIN unnest(ARRAY['uploaded', 'downloaded', 'moved', 'relinked',
                             'trashed', 'restored', 'purged']) AS t(term)
    WHERE c.conname = 'file_events_event_check'),
  'the widening kept every one of 0027''s and 0047''s seven terms');         -- 45

SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'purge_abandoned_uploads'),
  0, '0057''s withdrawn sweep stays withdrawn — the writer is sweep_abandoned_uploads');
                                                                            -- 46

-- 🚨 The CI guard (66/29): nothing in public names storage.s3_multipart_uploads.
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND pg_get_functiondef(p.oid) LIKE '%s3_multipart_uploads%'),
  0, 'no public function references storage.s3_multipart_uploads — CI runs without storage-api');
                                                                            -- 47

-- ...and a multipart row still does not move the meter (guarded exactly as
-- 66/13 is: the table is storage-api's and CI starts without it).
DO $$
BEGIN
  IF to_regclass('storage.s3_multipart_uploads') IS NOT NULL THEN
    INSERT INTO storage.s3_multipart_uploads
      (id, in_progress_size, upload_signature, bucket_id, key, version, owner_id, created_at)
    VALUES ('upl-inflight-77', 40000000, 'sig', 'rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/8-master.mov',
            '1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now());
  END IF;
END $$;

SELECT is(public.workspace_petal_bytes('11111111-1111-1111-1111-111111111111'),
  10000000::bigint,
  'an in-flight multipart row still does NOT move the meter — the reservation is the in-flight record, not that table');
                                                                            -- 48

DO $$
BEGIN
  IF to_regclass('storage.s3_multipart_uploads') IS NOT NULL THEN
    DELETE FROM storage.s3_multipart_uploads WHERE id = 'upl-inflight-77';
  END IF;
END $$;

-- ══ 8. Privileges and the read policy ═══════════════════════════════════════

SELECT ok(
  has_function_privilege('authenticated', 'public.reserve_upload_bytes(text,bigint)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.release_upload_reservation(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.reserve_upload_bytes(text,bigint)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.release_upload_reservation(text)', 'EXECUTE'),
  'reserve and release: authenticated may call them, anon may not');        -- 49

-- Review round 1: "service_role only" is two claims — the client roles cannot,
-- AND service_role still can (storage-gc's sweep and workspace_storage_usage()
-- die quietly if a stray REVOKE ever takes the second half away).
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.sweep_abandoned_uploads(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.workspace_upload_reserved_bytes(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.workspace_petal_committed_bytes(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.workspace_petal_bytes(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.sweep_abandoned_uploads(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.sweep_abandoned_uploads(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.workspace_upload_reserved_bytes(uuid,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.workspace_petal_committed_bytes(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.workspace_petal_bytes(uuid)', 'EXECUTE'),
  'the sweep and the unfiltered aggregates are service_role only — and service_role CAN still call them');
                                                                            -- 50

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- r1, r2 (released) and the two directly-written A rows carry created_by = A.
SELECT is(
  (SELECT count(*)::int FROM public.upload_reservations),
  4, 'a member reads their OWN reservations in their own workspace, and nothing else');
                                                                            -- 51

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

-- ⚠️ A VALID claims document, not the empty string: the planner pre-evaluates
-- the policy's current_setting(...)::jsonb while estimating selectivity, so an
-- empty string raises 22P02 BEFORE the privilege check ever runs and the probe
-- would fail for the wrong reason (the "8 already raising" tables in the S22
-- anon sweep are this exact shape).
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$SELECT count(*) FROM public.upload_reservations$$,
  '42501'::char(5), NULL,
  'anon holds no privilege on the table at all');                            -- 52

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- The 2-arg shim still answers (delegating with an unknown path). Used 10M of
-- 10M, so ten more bytes do not fit.
SELECT is(
  public.rabbit_petal_storage_ok('aaaa1111-0000-0000-0000-000000000001', 10::bigint),
  false, 'the 2-arg gate still exists and still answers — 0057''s post-condition names it');
                                                                            -- 53

SELECT * FROM finish();
ROLLBACK;
