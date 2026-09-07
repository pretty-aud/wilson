-- =============================================================================
-- 33_file_lifecycle.sql — Session 14: file lifecycle & data stewardship
-- (migration 0027).
--
-- Pins: the file_events capture trigger (uploaded on INSERT, moved on
-- storage_path change, trashed/restored on the soft-delete transitions,
-- purged with a full snapshot on hard DELETE), the S33 'downloaded' read
-- event (0047: the log_file_downloaded DEFINER RPC — vocabulary, EXECUTE
-- fencing, actor stamp, cross-workspace refusal, append-only intact),
-- actor stamping (auth.uid()
-- for client writes, NULL for the purge sweep), the SELECT policy (project
-- readers + the workspace-admin arm that keeps deletion certificates
-- readable after the project itself is purged), append-only enforcement
-- (client INSERT/UPDATE/DELETE all denied), the service-role-only
-- storage_gc_queue (invisible to authenticated; enqueued by the
-- supabase-provider hard-delete), and the rabbit-files bucket (private;
-- a member can upload under their own project's path, a cross-workspace
-- path and a garbage project segment both fail CLOSED, and the uploader
-- can delete their own object — the failed-insert cleanup path).
--
-- login_as sets NO app_role claim (0005) — admin-arm probes build their
-- JWT by hand, per the S13 discipline. De-auth before every mid-file
-- login_as with claims-reset + RESET ROLE (the tests schema is runner-only;
-- tests.logout() is not callable while role = authenticated).
-- =============================================================================
BEGIN;

SELECT plan(44);

SELECT * FROM tests.rls_setup();

-- A plain member in ws_a (no admin claims ever built for them) for the
-- admin-arm negative probe.
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- 1-2: the 0027 tables exist.
SELECT has_table('public'::name, 'file_events'::name, 'file_events table exists');
SELECT has_table('public'::name, 'storage_gc_queue'::name, 'storage_gc_queue table exists');

-- ── Capture trigger, as a plain ws_a member ─────────────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, size_bytes)
VALUES ('aaaa1111-0000-0000-0000-000000003301',
        'aaaa1111-0000-0000-0000-000000000001',
        'lifecycle.png', 'supabase',
        'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/1-lifecycle.png',
        2048);

-- 3: INSERT emitted 'uploaded'.
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000003301' AND event = 'uploaded'),
  1, 'files INSERT emits an uploaded event'
);

-- 4: actor stamped from auth.uid().
SELECT is(
  (SELECT actor_user_id FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000003301' AND event = 'uploaded'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'uploaded event carries the acting user'
);

UPDATE public.files
   SET storage_path = 'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/2-lifecycle.png'
 WHERE id = 'aaaa1111-0000-0000-0000-000000003301';

-- 5: storage_path change emitted 'moved' with both paths.
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000003301' AND event = 'moved'
      AND old_path LIKE '%1-lifecycle.png' AND new_path LIKE '%2-lifecycle.png'),
  1, 'storage_path change emits a moved event with old and new paths'
);

SELECT public.soft_delete_row('files', 'aaaa1111-0000-0000-0000-000000003301');

-- 6: trash transition emitted 'trashed'.
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000003301' AND event = 'trashed'),
  1, 'soft delete emits a trashed event'
);

SELECT public.restore_soft_deleted('files', 'aaaa1111-0000-0000-0000-000000003301');

-- 7: restore emitted 'restored'.
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000003301' AND event = 'restored'),
  1, 'restore emits a restored event'
);

-- 8: a plain project reader can read the stream.
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000003301'),
  4, 'a ws_a member reads the full stream for a readable project'
);

-- 9-11: append-only — client writes are denied at the privilege layer.
SELECT throws_ok(
  $$ INSERT INTO public.file_events (workspace_id, project_id, file_id, event)
     VALUES ('11111111-1111-1111-1111-111111111111',
             'aaaa1111-0000-0000-0000-000000000001',
             'aaaa1111-0000-0000-0000-000000003301', 'uploaded') $$,
  'permission denied for table file_events',
  'clients cannot INSERT file_events'
);
SELECT throws_ok(
  $$ UPDATE public.file_events SET actor_label = 'forged' $$,
  'permission denied for table file_events',
  'clients cannot UPDATE file_events'
);
SELECT throws_ok(
  $$ DELETE FROM public.file_events $$,
  'permission denied for table file_events',
  'clients cannot DELETE file_events'
);

-- 12: the GC queue is invisible to authenticated.
SELECT throws_ok(
  $$ SELECT count(*) FROM public.storage_gc_queue $$,
  'permission denied for table storage_gc_queue',
  'authenticated cannot read storage_gc_queue'
);

-- ── Cross-workspace isolation ───────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '22222222-2222-2222-2222-222222222222'
);

-- 13: ws_b sees nothing of ws_a's stream.
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000003301'),
  0, 'a ws_b member sees no ws_a file events'
);

-- ── The 'downloaded' read event (S33, migration 0047) ───────────────────────
-- TPN-CONT-008 / TPN-LOG-002 / AS-2.9: reads are logged via the
-- log_file_downloaded DEFINER RPC; the table itself stays append-only.

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- 14: the RPC exists.
SELECT is(
  to_regprocedure('public.log_file_downloaded(uuid)') IS NOT NULL,
  true, 'log_file_downloaded exists'
);

-- 15-16: EXECUTE — authenticated yes; anon no (the grantee lesson, 0033:
-- functions are born with a PUBLIC aclitem, so this pins the revoke).
SELECT is(
  has_function_privilege('authenticated', 'public.log_file_downloaded(uuid)', 'EXECUTE'),
  true, 'authenticated can execute log_file_downloaded'
);
SELECT is(
  has_function_privilege('anon', 'public.log_file_downloaded(uuid)', 'EXECUTE'),
  false, 'anon cannot execute log_file_downloaded'
);

-- 17-18: exactly ONE event-vocabulary constraint, and it admits
-- 'downloaded'. Two constraints is the failure shape where 0047's
-- discovery-drop missed one and the survivor still refuses the new event.
SELECT is(
  (SELECT count(*)::int FROM pg_constraint
    WHERE conrelid = 'public.file_events'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%uploaded%'),
  1, 'exactly one event vocabulary constraint on file_events'
);
SELECT is(
  (SELECT count(*)::int FROM pg_constraint
    WHERE conrelid = 'public.file_events'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%downloaded%'),
  1, 'the event vocabulary admits downloaded'
);

-- A fresh file for the read probes — 3301 is purged further down, and a
-- purged file must refuse the logger rather than feed it.
SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, size_bytes)
VALUES ('aaaa1111-0000-0000-0000-000000003302',
        'aaaa1111-0000-0000-0000-000000000001',
        'downloaded.png', 'supabase',
        'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/1-downloaded.png',
        4096);

-- 19: a member logs a download of a readable file.
SELECT is(
  public.log_file_downloaded('aaaa1111-0000-0000-0000-000000003302'),
  true, 'a member logs a download of a readable file'
);

-- 20: the row landed — event, path-at-read-time snapshot in old_path.
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000003302' AND event = 'downloaded'
      AND old_path LIKE '%1-downloaded.png'),
  1, 'the downloaded event carries the path snapshot'
);

-- 21: actor stamped from auth.uid().
SELECT is(
  (SELECT actor_user_id FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000003302' AND event = 'downloaded'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'the downloaded event carries the acting user'
);

-- 22: append-only holds for the new value too — the RPC is the ONLY way in.
SELECT throws_ok(
  $$ INSERT INTO public.file_events (workspace_id, project_id, file_id, event)
     VALUES ('11111111-1111-1111-1111-111111111111',
             'aaaa1111-0000-0000-0000-000000000001',
             'aaaa1111-0000-0000-0000-000000003302', 'downloaded') $$,
  'permission denied for table file_events',
  'clients cannot INSERT downloaded events directly'
);

-- 23: a cross-workspace caller is refused — and cannot learn whether the
-- file exists (one message for every refusal shape).
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '22222222-2222-2222-2222-222222222222'
);
SELECT throws_ok(
  $$ SELECT public.log_file_downloaded('aaaa1111-0000-0000-0000-000000003302') $$,
  'log_file_downloaded: file not found or not readable',
  'a ws_b member cannot log a download of a ws_a file'
);

-- 24: the workspace CLAIM is checked independently of membership. This
-- caller shape exists because of a breaker (S33): with the workspace check
-- deleted from the RPC, every other probe stays green — probe 23's caller
-- is refused by the membership check alone. Only a member of BOTH
-- workspaces signed into the other one can tell the two checks apart.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('22222222-2222-2222-2222-222222222222',
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c_b', 'User C in B', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;
SELECT tests.login_as(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '22222222-2222-2222-2222-222222222222'
);
SELECT throws_ok(
  $$ SELECT public.log_file_downloaded('aaaa1111-0000-0000-0000-000000003302') $$,
  'log_file_downloaded: file not found or not readable',
  'a dual-workspace member signed into the other workspace is refused'
);

-- 25: the refused calls wrote nothing — the stream holds exactly the
-- uploaded + downloaded pair.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000003302'),
  2, 'the refused cross-workspace call logged nothing'
);

-- 26: a TRASHED file still logs — the blob outlives the row's visibility,
-- and a read of trashed content is exactly what an auditor wants recorded.
-- (0047 implements this by omission — no file-level deleted_at check — so
-- only this probe pins that it stays; adversarial review, S33.)
SELECT public.soft_delete_row('files', 'aaaa1111-0000-0000-0000-000000003302');
SELECT is(
  public.log_file_downloaded('aaaa1111-0000-0000-0000-000000003302'),
  true, 'a trashed file still logs a download'
);

-- 27: a purged (or never-existing) file refuses — nothing to snapshot,
-- nothing to read.
SELECT throws_ok(
  $$ SELECT public.log_file_downloaded('00000000-0000-0000-0000-000000000099') $$,
  'log_file_downloaded: file not found or not readable',
  'an unknown or purged file id refuses'
);

-- 28-29: the 0038 money arm. The fixture itself needs money access to
-- CREATE (files_insert gates is_financial), so it is inserted under a
-- hand-built admin JWT (login_as sets no app_role claim).
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'workspace_id', '11111111-1111-1111-1111-111111111111',
      'app_role', 'admin'
    )
  )::text, true
);
SELECT set_config('role', 'authenticated', true);
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, size_bytes, is_financial)
VALUES ('aaaa1111-0000-0000-0000-000000003303',
        'aaaa1111-0000-0000-0000-000000000001',
        'invoice.pdf', 'supabase',
        'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/1-invoice.pdf',
        1024, true);

-- 28: a money-privileged caller logs a financial file.
SELECT is(
  public.log_file_downloaded('aaaa1111-0000-0000-0000-000000003303'),
  true, 'a money-privileged caller logs a financial file download'
);

-- 29: a plain member is refused — files_select hides the row from them,
-- so the logger must neither confirm the invoice exists nor mint its
-- metadata into a stream every project reader can see (adversarial
-- review, S33: the first draft replicated projects_select only, and this
-- caller got true). The caller must be user_c: user_a is a workspace
-- ADMIN in workspace_members, and the money gate rightly reads the live
-- row — a plain-JWT login_as does not shed table-side privilege (this
-- probe's first draft used user_a and measured exactly that).
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '11111111-1111-1111-1111-111111111111'
);
SELECT throws_ok(
  $$ SELECT public.log_file_downloaded('aaaa1111-0000-0000-0000-000000003303') $$,
  'log_file_downloaded: file not found or not readable',
  'a member without money access cannot log a financial file download'
);

-- 30: MEMBERSHIP is checked independently of the workspace claim. This
-- caller shape exists because of a breaker (S33): deleting
-- has_active_membership from the RPC left every probe green — all other
-- refusal shapes are caught by the claim check first. Only a matching
-- claim over a DEACTIVATED membership (the revoked member with a stale
-- JWT) tells them apart.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
UPDATE public.workspace_members SET is_active = false
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
   AND user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
SELECT tests.login_as(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '11111111-1111-1111-1111-111111111111'
);
SELECT throws_ok(
  $$ SELECT public.log_file_downloaded('aaaa1111-0000-0000-0000-000000003302') $$,
  'log_file_downloaded: file not found or not readable',
  'a deactivated membership is refused even with a matching claim'
);
-- Reactivate: the later "plain member loses the stream" probe must keep
-- meaning what it says — an ACTIVE member refused by the project arm.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
UPDATE public.workspace_members SET is_active = true
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
   AND user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

-- ── Purge → certificate + GC enqueue ────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);
SELECT public.soft_delete_row('files', 'aaaa1111-0000-0000-0000-000000003301');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- 31: the nightly sweep. Retention is NEGATIVE because now() is frozen for
-- the whole test transaction — deleted_at = now() is never < now() - 0.
SELECT ok(
  public.purge_soft_deleted(INTERVAL '-1 second') >= 1,
  'purge_soft_deleted removes the expired file row'
);

-- 32: the deletion certificate exists, with the final path snapshot.
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000003301' AND event = 'purged'
      AND old_path LIKE '%2-lifecycle.png' AND file_name = 'lifecycle.png'),
  1, 'hard delete emits a purged certificate with the path snapshot'
);

-- 33: the sweep is a system write — no actor.
SELECT is(
  (SELECT actor_user_id FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000003301' AND event = 'purged'),
  NULL::uuid, 'purge certificate carries no actor (system write)'
);

-- 34: the supabase blob was enqueued for GC.
SELECT is(
  (SELECT count(*)::int FROM public.storage_gc_queue
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000003301'
      AND bucket_id = 'rabbit-files' AND reason = 'file-purged' AND status = 'pending'),
  1, 'purging a supabase-provider file enqueues its blob for GC'
);

-- ── Admin arm: certificates outlive the project ─────────────────────────────

-- Trashing a PROJECT requires the admin claim (fn_soft_delete_stamp gate);
-- login_as sets none, so build the JWT by hand. user_a IS a ws_a admin.
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'workspace_id', '11111111-1111-1111-1111-111111111111',
      'app_role', 'admin'
    )
  )::text, true
);
SELECT set_config('role', 'authenticated', true);
SELECT public.soft_delete_row('projects', 'aaaa1111-0000-0000-0000-000000000001');

-- 35: a TRASHED project refuses the download logger — the live-project
-- check, isolated: this caller is a workspace admin (passes the money
-- gate on the financial fixture), so the refusal can only be the
-- project's deleted_at.
SELECT throws_ok(
  $$ SELECT public.log_file_downloaded('aaaa1111-0000-0000-0000-000000003303') $$,
  'log_file_downloaded: file not found or not readable',
  'a trashed project refuses the download logger'
);

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- 36: sweep the project too.
SELECT ok(
  public.purge_soft_deleted(INTERVAL '-1 second') >= 1,
  'purge_soft_deleted removes the expired project row'
);

-- 37: a plain member (no admin claim) loses the stream once the project is
-- gone — can_read_project_topic is false and the admin arm refuses 'user'.
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'workspace_id', '11111111-1111-1111-1111-111111111111',
      'app_role', 'user'
    )
  )::text, true
);
SELECT set_config('role', 'authenticated', true);
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000003301'),
  0, 'a plain member cannot read events for a purged project'
);

-- 38: a workspace admin still reads the deletion certificates.
SELECT set_config('role', 'postgres', true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'workspace_id', '11111111-1111-1111-1111-111111111111',
      'app_role', 'admin'
    )
  )::text, true
);
SELECT set_config('role', 'authenticated', true);
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000003301' AND event = 'purged'),
  1, 'a workspace admin still reads certificates for a purged project'
);

-- ── Bucket + storage policies ───────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- 39: bucket exists and is private.
SELECT is(
  (SELECT public FROM storage.buckets WHERE id = 'rabbit-files'),
  false, 'rabbit-files bucket exists and is private'
);

-- 40: the three policies exist.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname IN ('rabbit_files_select', 'rabbit_files_insert', 'rabbit_files_delete_own')),
  3, 'the three rabbit-files storage policies exist'
);

-- 41: a member CAN upload under their own project's path (the policy admits
-- the legitimate case — otherwise every cloud upload would 403).
SELECT tests.login_as(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '22222222-2222-2222-2222-222222222222'
);
WITH ins AS (
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('rabbit-files',
          'projects/bbbb2222-0000-0000-0000-000000000001/project/bbbb2222-0000-0000-0000-000000000001/1-own.bin',
          'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM ins), 1,
  'a ws_b member can upload under their own project path');

-- 42: a cross-workspace project path fails CLOSED.
SELECT throws_ok(
  $$ INSERT INTO storage.objects (bucket_id, name, owner_id)
     VALUES ('rabbit-files',
             'projects/aaaa1111-0000-0000-0000-000000000001/project/x/1-cross.bin',
             'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') $$,
  'new row violates row-level security policy for table "objects"',
  'a ws_b member cannot upload under a ws_a project path'
);

-- 43: a garbage project segment fails CLOSED (fn_try_uuid → NULL → EXISTS
-- false — can_write_project(NULL) alone would fail OPEN; this pins the guard).
SELECT throws_ok(
  $$ INSERT INTO storage.objects (bucket_id, name, owner_id)
     VALUES ('rabbit-files',
             'projects/not-a-uuid/project/x/1-garbage.bin',
             'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') $$,
  'new row violates row-level security policy for table "objects"',
  'a malformed project segment is refused'
);

-- 44: the uploader-cleanup DELETE policy pins owner_id AND the review
-- hardening: the freshness bound + write-side guards, so an ex-member or
-- any past uploader can never destroy live blobs (adversarial review).
-- Functional delete cannot be probed by SQL — storage.protect_delete()
-- blocks direct deletes ("Use the Storage API instead"); the adapter's
-- failed-insert cleanup goes through the API, where this policy governs.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'rabbit_files_delete_own'
      AND cmd = 'DELETE'
      AND qual LIKE '%owner_id%'
      AND qual LIKE '%created_at%'
      AND qual LIKE '%can_write_project%'
      AND qual LIKE '%has_active_membership%'),
  1, 'delete-own policy pins owner_id, the 1-hour window and the write guards'
);

SELECT * FROM finish();
ROLLBACK;
