-- =============================================================================
-- 78_file_events_money.sql — Track C, bundle C2: money on the activity stream,
-- and the three new ways an upload reservation closes (migration 0074).
--
-- What this pins, in order of how badly it would hurt to get wrong:
--
--   * 🚨 THE HEADLINE (probes 15-16): a plain project member reads NOTHING of
--     an invoice's history — not its upload, move, trash, restore or download —
--     with a PRESENCE CONTROL one probe earlier (14: the same member reads a
--     plain file's events), so an empty result cannot pass by accident.
--
--   * 🚨 CERTIFICATES STAY VISIBLE (probes 21-22, Audrey's ruling 22): the same
--     member reads the invoice's purged certificate and STILL nothing else.
--
--   * THE ONE DEFINITION (probes 5-9): the row flag OR a money-segment key. A
--     file flagged is_financial=false but filed under FINANCE/ is invoice
--     history too (probe 9), because 0042's storage gate is by PATH.
--
--   * BOTH MONEY READERS (17-19): a project MANAGER with no admin claim sees
--     every invoice event through can_access_project_money's second arm; a
--     workspace admin through the first.
--
--   * abandon_upload_reservation (25-33): closes the caller's OWN open row as
--     'abandoned' with one certificate carrying the client's reason; refuses
--     nobody loudly — another person's row, a second call, a never-reserved
--     money path all return false and write nothing; a "failure" reported after
--     the object landed closes 'completed' and certifies nothing.
--
--   * release_stale_upload_reservations (34-39): the caller's own open rows
--     close WITHOUT a certificate, except the keys in p_keep; nobody else's
--     rows move.
--
--   * sweep_open_uploads (40-49): every open row of ONE tenant, expired or not,
--     closes — 'completed' when its object landed, 'abandoned' with a
--     teardown certificate otherwise — and the abandoned paths come back for
--     platform_audit; another tenant's open row is untouched; NULL is refused;
--     the hourly sweep (0073) still leaves an unexpired row alone; authenticated
--     cannot call it.
--
-- Postgres-side reads are ALWAYS scoped to the fixture ids — dev carries real
-- rows and an unscoped count decays the day the feature is used.
--
-- login_as sets NO app_role claim (0005): money-privileged probes build their
-- JWT by hand (the S13 discipline). De-auth before every mid-file login_as
-- with claims-reset + RESET ROLE.
--
-- PROVEN BY BREAKERS AGAINST 0074 BEFORE IT WAS APPLIED (2026-09-07), each in a
-- rolled-back shim transaction against wilson-dev: see the commit that ships
-- this file for the table of which probe each one failed.
--
-- ⚠️ Nothing here deletes from storage.objects (protect_delete forbids it);
-- every object this suite inserts stays for the rolled-back transaction, and
-- the reservation sizes (100 kB) are chosen so the free tier never refuses.
-- =============================================================================

BEGIN;

SELECT plan(60);

SELECT * FROM tests.rls_setup();

-- user_c: a plain ws_a member who can READ project A (a project member) and
-- has no money access. user_d: a ws_a 'user' who MANAGES project A — the
-- can_access_project_money second arm, with no admin claim anywhere.
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now()),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user_d@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111',
   'dddddddd-dddd-dddd-dddd-dddddddddddd', 'user', 'user_d', 'User D', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role)
VALUES
  ('aaaa1111-0000-0000-0000-000000000001',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1111-0000-0000-0000-000000000001',
   'dddddddd-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111', 'manager')
ON CONFLICT (project_id, user_id) DO NOTHING;

-- ══ 1. The shape ════════════════════════════════════════════════════════════

SELECT has_column('public'::name, 'file_events'::name, 'is_financial'::name,
  'file_events.is_financial exists');                                        -- 1

SELECT is(
  (SELECT is_nullable || '/' || column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'file_events'
      AND column_name = 'is_financial'),
  'NO/false', 'is_financial is NOT NULL DEFAULT false');                     -- 2

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'file_events'),
  1, '0027''s invariant survives 0074: exactly one policy on file_events');   -- 3

-- Restated, not replaced: the money arm AND both of 0027's arms are in the one
-- definition (the 0059 lesson — a DROP + CREATE that forgets an arm is green).
SELECT ok(
  (SELECT qual LIKE '%is_financial%' AND qual LIKE '%purged%'
      AND qual LIKE '%can_access_project_money%'
      AND qual LIKE '%can_read_project_topic%'
      AND qual LIKE '%current_app_role%'
      AND qual LIKE '%has_active_membership%'
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'file_events'
      AND policyname = 'file_events_select'),
  'file_events_select carries the money arm and both 0027 arms');            -- 4

-- ══ 2. The one definition, never NULL ═══════════════════════════════════════

SELECT ok(
  public.rabbit_money_key('projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/1-a.pdf')
  AND public.rabbit_money_key('projects/aaaa1111-0000-0000-0000-000000000001/finance/RATES.json')
  AND NOT public.rabbit_money_key('projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/1-a.mov')
  AND NOT public.rabbit_money_key('INVOICES/1-a.pdf')
  AND public.rabbit_money_key(NULL) IS FALSE
  AND public.rabbit_money_key('') IS FALSE,
  'rabbit_money_key: a row-shaped key under INVOICES/ or FINANCE/ (any case) is money; anything else is false, never NULL');
                                                                            -- 5

SELECT ok(
  public.file_event_is_financial(true, NULL, NULL)
  AND public.file_event_is_financial(false, 'projects/x/INVOICES/1-a.pdf', NULL)
  AND public.file_event_is_financial(false, NULL, 'projects/x/FINANCE/1-a.pdf')
  AND public.file_event_is_financial(false, 'projects/x/ASSETS/1-a.mov', 'projects/x/ASSETS/2-a.mov') IS FALSE
  AND public.file_event_is_financial(NULL, NULL, NULL) IS FALSE,
  'file_event_is_financial: the row flag OR either path under a money segment; NULL inputs are false');
                                                                            -- 6

-- ══ 3. Capture, as a workspace admin (money access to CREATE the invoice) ═══

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SET LOCAL ROLE authenticated;

INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, size_bytes, is_financial)
VALUES
  ('aaaa1111-0000-0000-0000-000000007801', 'aaaa1111-0000-0000-0000-000000000001',
   'brief.pdf', 'supabase',
   'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/1-brief.pdf', 2048, false),
  ('aaaa1111-0000-0000-0000-000000007802', 'aaaa1111-0000-0000-0000-000000000001',
   'invoice.pdf', 'supabase',
   'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/1-invoice.pdf', 1024, true),
  -- Flagged false on the row, filed under FINANCE/: the PATH arm of the one
  -- definition, and the shape 0042's storage gate protects by key alone.
  ('aaaa1111-0000-0000-0000-000000007803', 'aaaa1111-0000-0000-0000-000000000001',
   'rates-note.pdf', 'supabase',
   'projects/aaaa1111-0000-0000-0000-000000000001/FINANCE/1-rates-note.pdf', 512, false);

SELECT is(
  (SELECT is_financial FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000007801' AND event = 'uploaded'),
  false, 'a plain file''s uploaded event is not financial');                 -- 7

SELECT is(
  (SELECT is_financial FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000007802' AND event = 'uploaded'),
  true, '🚨 an invoice''s uploaded event snapshots is_financial from the row'); -- 8

SELECT is(
  (SELECT is_financial FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000007803' AND event = 'uploaded'),
  true, 'a row flagged false but filed under FINANCE/ is financial by its key');
                                                                            -- 9

UPDATE public.files
   SET storage_path = 'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/2-invoice.pdf'
 WHERE id = 'aaaa1111-0000-0000-0000-000000007802';

SELECT is(
  (SELECT is_financial FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000007802' AND event = 'moved'),
  true, 'the invoice''s moved event is financial');                          -- 10

SELECT public.soft_delete_row('files', 'aaaa1111-0000-0000-0000-000000007802');
SELECT public.restore_soft_deleted('files', 'aaaa1111-0000-0000-0000-000000007802');

SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000007802'
      AND event IN ('trashed', 'restored') AND is_financial),
  2, 'the invoice''s trashed and restored events are financial');            -- 11

SELECT public.log_file_downloaded('aaaa1111-0000-0000-0000-000000007802');
SELECT public.log_file_downloaded('aaaa1111-0000-0000-0000-000000007801');

SELECT is(
  (SELECT is_financial FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000007802' AND event = 'downloaded'),
  true, '🚨 log_file_downloaded flags an invoice read — the one row a reader could otherwise still see');
                                                                            -- 12

SELECT is(
  (SELECT is_financial FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000007801' AND event = 'downloaded'),
  false, 'a plain file''s downloaded event is not financial (control)');     -- 13

-- ══ 4. Reads ═══════════════════════════════════════════════════════════════

-- A plain project member.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '11111111-1111-1111-1111-111111111111'
);

SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000007801'),
  2, 'PRESENCE CONTROL: a plain member reads a plain file''s upload and download events');
                                                                            -- 14

SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000007802'),
  0, '🚨 a plain member reads NOTHING of the invoice — not upload, move, trash, restore or download');
                                                                            -- 15

SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000007803'),
  0, 'a plain member reads nothing of a file classified financial by its key alone');
                                                                            -- 16

-- The project MANAGER — no admin claim; can_access_project_money's second arm.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  '11111111-1111-1111-1111-111111111111'
);

SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000007802'),
  5, 'the project manager reads all five invoice events');                   -- 17

SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000007803'),
  1, 'the project manager reads the key-classified file''s event');          -- 18

-- The workspace admin — the first arm.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000007802'),
  5, 'a workspace admin reads all five invoice events');                     -- 19

-- ══ 5. The certificate stays visible ════════════════════════════════════════

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
DELETE FROM public.files WHERE id = 'aaaa1111-0000-0000-0000-000000007802';

SELECT is(
  (SELECT is_financial FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000007802' AND event = 'purged'),
  true, 'the purged certificate is classified — the flag survived the row''s deletion');
                                                                            -- 20

SELECT tests.login_as(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '11111111-1111-1111-1111-111111111111'
);

SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000007802' AND event = 'purged'),
  1, '🚨 a plain member reads the invoice''s deletion certificate (ruling 22: deletion records stay visible)');
                                                                            -- 21

SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000007802' AND event <> 'purged'),
  0, '…and still nothing else of it');                                       -- 22

-- ══ 6. Grants on the three RPCs ═════════════════════════════════════════════

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT ok(
  NOT has_function_privilege('anon', 'public.abandon_upload_reservation(text, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.release_stale_upload_reservations(text[])', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.sweep_open_uploads(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.rabbit_money_key(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.file_event_is_financial(boolean, text, text)', 'EXECUTE'),
  'anon — and so PUBLIC, which anon inherits — can execute none of the three RPCs nor the two helpers');
                                                                            -- 23

SELECT ok(
  has_function_privilege('authenticated', 'public.abandon_upload_reservation(text, text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.release_stale_upload_reservations(text[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.sweep_open_uploads(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.sweep_open_uploads(uuid)', 'EXECUTE'),
  'authenticated holds the two client RPCs and not the teardown sweep; service_role holds the sweep');
                                                                            -- 24

-- ══ 7. abandon_upload_reservation ═══════════════════════════════════════════

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT ok(
  public.reserve_upload_bytes(
    'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/1-k1.mov', 100000) IS NOT NULL,
  'PRESENCE CONTROL: a reservation is accepted — every closure below acts on a real row');
                                                                            -- 25

SELECT is(
  public.abandon_upload_reservation(
    'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/1-k1.mov',
    'tus: 502 Bad Gateway after 3 retries'),
  true, '🚨 the client''s failure path closes its own open reservation');    -- 26

SELECT is(
  public.abandon_upload_reservation(
    'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/1-k1.mov', 'again'),
  false, 'a second abandon of the same key finds nothing open and returns false');
                                                                            -- 27

-- ⚠️ "A MONEY PATH IS NEVER RESERVED" STOPPED BEING TRUE AT 0078, which bounds
-- the quota exemption by object size: a money path OVER
-- rabbit_quota_exempt_max_bytes() is weighed, reserves, and can therefore be
-- abandoned. This probe still holds because 1-never-reserved.pdf was never
-- reserved by this suite, but the reason is the key, not the segment. The
-- over-bound case is suite 77 probes 66 and 67. 🚨 `0074`'s own comment beside
-- `abandon_upload_reservation` ("Always false in practice — a money path is
-- never reserved") is the same falsified invariant in an APPLIED migration; it
-- is behaviourally harmless (file_event_is_financial computes the flag from
-- rabbit_money_key, so an abandoned money upload's certificate is still
-- money-gated) and is corrected in handbook §12.10 rather than by editing 0074.
SELECT is(
  public.abandon_upload_reservation(
    'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/1-never-reserved.pdf', 'x'),
  false, 'a money path UNDER the quota-exemption bound was never reserved (0073, bounded by 0078), so there is nothing to abandon');
                                                                            -- 28

-- Two more rows for the probes that follow.
SELECT public.reserve_upload_bytes(
  'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/2-k2.mov', 100000);
SELECT public.reserve_upload_bytes(
  'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/3-k3.mov', 100000);

-- Another person cannot abandon user_a's row.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '11111111-1111-1111-1111-111111111111'
);
SELECT is(
  public.abandon_upload_reservation(
    'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/2-k2.mov', 'not mine'),
  false, 'another member cannot abandon someone else''s reservation');       -- 29

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT ok(
  (SELECT outcome = 'abandoned' AND released_at IS NOT NULL AND swept_at IS NULL
     FROM public.upload_reservations
    WHERE storage_path = 'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/1-k1.mov'),
  'the abandoned row closed as ''abandoned'' by the client, not by a sweep (swept_at stays NULL)');
                                                                            -- 30

SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
      AND event = 'upload_abandoned'
      AND new_path = 'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/1-k1.mov'
      AND size_bytes = 100000
      AND details->>'reported_by' = 'client'
      AND details->>'reason' = 'tus: 502 Bad Gateway after 3 retries'
      AND actor_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      AND NOT is_financial),
  1, '🚨 exactly one certificate: the path, the bytes, the client''s reason, the person, not financial');
                                                                            -- 31

SELECT ok(
  (SELECT released_at IS NULL FROM public.upload_reservations
    WHERE storage_path = 'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/2-k2.mov')
  AND NOT EXISTS (SELECT 1 FROM public.file_events
    WHERE event = 'upload_abandoned'
      AND new_path = 'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/2-k2.mov'),
  'the refused abandon left the other person''s row open and wrote no certificate');
                                                                            -- 32

-- k3 lands, then its owner reports a "failure": the row closes completed and
-- nothing is certified — the bytes are there.
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES ('rabbit-files',
        'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/3-k3.mov',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{"size": 100000}'::jsonb);

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT public.abandon_upload_reservation(
  'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/3-k3.mov', 'late failure');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT ok(
  (SELECT outcome = 'completed' FROM public.upload_reservations
    WHERE storage_path = 'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/3-k3.mov')
  AND NOT EXISTS (SELECT 1 FROM public.file_events
    WHERE event = 'upload_abandoned'
      AND new_path = 'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/3-k3.mov'),
  'a failure reported after the object landed closes ''completed'' and certifies nothing');
                                                                            -- 33

-- ══ 8. release_stale_upload_reservations ═══════════════════════════════════

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- user_a's open rows: k2 only. k4 is "still uploading in this tab".
SELECT public.reserve_upload_bytes(
  'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/4-k4.mov', 100000);

SELECT is(
  public.release_stale_upload_reservations(
    ARRAY['projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/4-k4.mov']),
  1, '🚨 opening Files releases the caller''s stale rows and keeps the one still uploading');
                                                                            -- 34

SELECT is(
  public.release_stale_upload_reservations('{}'),
  1, 'with nothing to keep, the last open row goes too');                    -- 35

SELECT is(
  public.release_stale_upload_reservations('{}'),
  0, 'a second pass finds nothing');                                          -- 36

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT ok(
  (SELECT outcome = 'released' AND swept_at IS NULL FROM public.upload_reservations
    WHERE storage_path = 'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/2-k2.mov')
  AND (SELECT outcome = 'released' FROM public.upload_reservations
    WHERE storage_path = 'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/4-k4.mov')
  AND NOT EXISTS (SELECT 1 FROM public.file_events
    WHERE event = 'upload_abandoned'
      AND new_path IN ('projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/2-k2.mov',
                       'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/4-k4.mov')),
  'stale rows close ''released'' with NO certificate (ruling 2: those rows lose theirs)');
                                                                            -- 37

-- user_c's row is not user_a's to release.
SELECT tests.login_as(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '11111111-1111-1111-1111-111111111111'
);
SELECT public.reserve_upload_bytes(
  'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/5-k5.mov', 100000);
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  public.release_stale_upload_reservations('{}'),
  0, 'another person''s open row is not the caller''s to release');           -- 38

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT ok(
  (SELECT released_at IS NULL FROM public.upload_reservations
    WHERE storage_path = 'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/5-k5.mov'),
  'user_c''s row is still open');                                            -- 39

-- ══ 9. sweep_open_uploads — the teardown sweep ═════════════════════════════

-- ws_b has an open, UNEXPIRED reservation of its own (the scope control).
SELECT tests.login_as(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '22222222-2222-2222-2222-222222222222'
);
SELECT public.reserve_upload_bytes(
  'projects/bbbb2222-0000-0000-0000-000000000001/ASSETS/c2/1-kb1.mov', 100000);
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- ws_a: k5 (open, no object) and k6 (open, object landed).
SELECT tests.login_as(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '11111111-1111-1111-1111-111111111111'
);
SELECT public.reserve_upload_bytes(
  'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/6-k6.mov', 100000);
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES ('rabbit-files',
        'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/6-k6.mov',
        'cccccccc-cccc-cccc-cccc-cccccccccccc', '{"size": 100000}'::jsonb);

-- Run it ONCE and read the answer from a temp table — a second call would
-- find nothing and report 0/0.
CREATE TEMP TABLE sweep78 AS
  SELECT * FROM public.sweep_open_uploads('11111111-1111-1111-1111-111111111111');

SELECT is((SELECT abandoned FROM sweep78), 1,
  '🚨 the teardown sweep abandons the open, unexpired reservation whose object never landed');
                                                                            -- 40
SELECT is((SELECT completed FROM sweep78), 1,
  '…and closes the one whose object landed as completed');                   -- 41
SELECT is((SELECT abandoned_paths FROM sweep78),
  ARRAY['projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/5-k5.mov'],
  'it returns exactly the abandoned paths, for the platform_audit certificate');
                                                                            -- 42

SELECT ok(
  (SELECT outcome = 'abandoned' AND swept_at IS NOT NULL AND released_at IS NOT NULL
     FROM public.upload_reservations
    WHERE storage_path = 'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/5-k5.mov')
  AND (SELECT outcome = 'completed' AND swept_at IS NOT NULL
     FROM public.upload_reservations
    WHERE storage_path = 'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/6-k6.mov'),
  'both rows closed by the sweep: abandoned and completed, swept_at set on each');
                                                                            -- 43

SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE event = 'upload_abandoned'
      AND new_path = 'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/5-k5.mov'
      AND details->>'closed_by' = 'teardown'
      AND details ? 'reservation_id' AND details ? 'started_by'
      AND actor_user_id IS NULL AND actor_label = 'system'),
  1, 'one teardown certificate for the abandoned path: a system write naming who started it');
                                                                            -- 44

SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE event = 'upload_abandoned'
      AND new_path = 'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c2/6-k6.mov'),
  0, 'the landed one is not certified abandoned');                           -- 45

SELECT ok(
  (SELECT released_at IS NULL FROM public.upload_reservations
    WHERE storage_path = 'projects/bbbb2222-0000-0000-0000-000000000001/ASSETS/c2/1-kb1.mov'),
  '🚨 the other tenant''s open reservation is untouched (scope)');           -- 46

SELECT throws_ok(
  $$ SELECT * FROM public.sweep_open_uploads(NULL) $$,
  '22023', NULL,
  'a NULL workspace is refused — this never runs platform-wide');            -- 47

-- The hourly sweep (0073) still takes EXPIRED rows only: ws_b's fresh row is
-- not its business. The two sweeps differ in exactly this predicate.
SELECT ok(
  (SELECT abandoned = 0 AND completed = 0
     FROM public.sweep_abandoned_uploads('22222222-2222-2222-2222-222222222222'))
  AND (SELECT released_at IS NULL FROM public.upload_reservations
    WHERE storage_path = 'projects/bbbb2222-0000-0000-0000-000000000001/ASSETS/c2/1-kb1.mov'),
  'the hourly sweep leaves an unexpired open row alone (control: the two sweeps differ by expiry)');
                                                                            -- 48

SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);
SELECT throws_ok(
  $$ SELECT * FROM public.sweep_open_uploads('11111111-1111-1111-1111-111111111111') $$,
  'permission denied for function sweep_open_uploads',
  'authenticated cannot run the teardown sweep');                            -- 49

-- ══ 6. C4 / migration 0076: an expense receipt is money ═════════════════════
--
-- 🚨 WHY THESE PROBES RE-RUN THE MIGRATION'S OWN STATEMENTS. 0076 is a one-time
-- DML backfill. Every fixture below is inserted AFTER it has been applied, so
-- nothing here can observe the backfill by simply looking — a probe that
-- asserted "the receipt is financial" would be reading a row this file wrote
-- that way, and would pass with 0076 deleted. The two UPDATEs are therefore
-- replayed inside this rolled-back transaction against a fixture that
-- reproduces the PRE-migration state, which is the only honest instrument for
-- a backfill.
--
-- 🚨 AND HERE IS WHAT THIS INSTRUMENT DOES **NOT** DO, corrected by review
-- round 1, which found the previous sentence ("the statements are copied from
-- 0076; if they drift, probe 51 goes red") to be false. NOTHING COMPARES THESE
-- TWO TEXTS. Not CI, not a test, not a script — `0076` appears only in the
-- migration, this file and the docs. Probe 51 exercises only the copy below,
-- so an edit to 0076 ALONE leaves this suite green, twice over: CI applies
-- 0076 and runs this suite in the same job, but the CI database is empty, so
-- 0076's DO block is vacuous there and the suite proves only its own copy.
-- The copies are kept byte-identical BY HAND. If you edit either statement in
-- 0076, edit it here in the same commit, or this suite silently stops being
-- evidence about the migration.

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- Three receipts-to-be and one control, all in the pre-0076 state
-- (is_financial = false, body outside the money namespace — which is what
-- every receipt uploaded before C4 looks like).
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, size_bytes, is_financial)
VALUES
  -- A Supabase-hosted receipt: the row 0076 must flip.
  ('aaaa1111-0000-0000-0000-000000007611', 'aaaa1111-0000-0000-0000-000000000001',
   'receipt-cab.pdf', 'supabase',
   'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/1-receipt-cab.pdf',
   700, false),
  -- A receipt whose BODY is on a customer's bucket. files_money_provider_chk
  -- REFUSES a financial row here, so 0076 must leave it alone rather than
  -- abort — TRAP 1.
  ('aaaa1111-0000-0000-0000-000000007612', 'aaaa1111-0000-0000-0000-000000000001',
   'receipt-byo.pdf', 's3',
   'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/1-receipt-byo.pdf',
   700, false),
  -- BLAST-RADIUS CONTROL: an ordinary project file no expense points at. If
  -- the backfill's predicate is ever widened, this is what notices.
  ('aaaa1111-0000-0000-0000-000000007613', 'aaaa1111-0000-0000-0000-000000000001',
   'moodboard.png', 'supabase',
   'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/1-moodboard.png',
   700, false);

INSERT INTO public.expenses (id, project_id, workspace_id, title, actual_cost, file_ids)
VALUES ('aaaa1111-0000-0000-0000-0000000076e1',
        'aaaa1111-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111',
        'Cab to the shoot', 42.00,
        ARRAY['aaaa1111-0000-0000-0000-000000007611',
              'aaaa1111-0000-0000-0000-000000007612']::uuid[]);

SELECT is(
  (SELECT count(*)::int FROM public.files
    WHERE id IN ('aaaa1111-0000-0000-0000-000000007611',
                 'aaaa1111-0000-0000-0000-000000007612')
      AND is_financial),
  0, 'PRE-STATE CONTROL: both receipts start ungated, so a later "gated" cannot pass by accident');
                                                                            -- 50

-- 0076 statement 1, verbatim — byte-identical to 0076's statement 1. Review round 1
-- found this copy had been reflowed (the EXISTS collapsed onto one line) while
-- the comment still claimed "verbatim"; it is re-expanded here so the word is
-- true. Statement 2 below was, and remains, byte-identical.
UPDATE public.files f
   SET is_financial = true
 WHERE NOT f.is_financial
   AND f.storage_provider = 'supabase'
   AND EXISTS (
         SELECT 1 FROM public.expenses e
          WHERE f.id = ANY (e.file_ids)
       );

SELECT is(
  (SELECT is_financial FROM public.files
    WHERE id = 'aaaa1111-0000-0000-0000-000000007611'),
  true, '🚨 0076 flips a Supabase-hosted receipt to financial — the bundle''s whole point');
                                                                            -- 51

SELECT is(
  (SELECT is_financial FROM public.files
    WHERE id = 'aaaa1111-0000-0000-0000-000000007612'),
  false, 'TRAP 1: a receipt whose body is on a customer bucket is left alone, not flipped');
                                                                            -- 52

-- ...and probe 52 is a GUARD, not a coincidence. Without the storage_provider
-- scoping the same UPDATE would hit this row and take the whole migration down
-- with a CHECK violation. This is the probe that says so.
SELECT throws_ok(
  $$ UPDATE public.files SET is_financial = true
      WHERE id = 'aaaa1111-0000-0000-0000-000000007612' $$,
  '23514',
  NULL,
  '🚨 files_money_provider_chk REFUSES a financial row outside Supabase — which is why 0076 scopes its backfill instead of aborting');
                                                                            -- 53

SELECT is(
  (SELECT is_financial FROM public.files
    WHERE id = 'aaaa1111-0000-0000-0000-000000007613'),
  false, 'BLAST RADIUS: a project file no expense references is untouched');  -- 54

-- TRAP 2, pinned as a fact rather than left in a comment: the row is gated and
-- the BLOB is not. The receipt's body is still under its container segment, so
-- the FOUR base storage policies still serve it to anyone holding the path.
-- 0076 cannot move bytes; these probes are the standing record of what it did
-- not close, next to the thing it did.
--
-- 🚨 PROBE 55 IS A SHAPE ASSERTION AND PROBE 60 IS THE ACCESS ONE. Read them
-- as a pair, and do not mistake the first for the second.
--
-- Review round 1 claimed here that it had "replaced a tautology". **It had
-- not** — review round 2 diffed probe 55 against b90ee99 and found the
-- assertion BYTE-IDENTICAL, with only its message reworded. That claim was
-- wrong and is withdrawn. What round 1 actually did was ADD an access probe
-- beside it, which is the useful half.
--
-- So, honestly: probe 55's second conjunct is a property of the STRING THIS
-- FILE ITSELF INSERTED above. It pins the fixture's SHAPE — that a backfilled
-- receipt's path is outside the money namespace — and nothing more. It cannot
-- go red if someone closes the blob gate. **Probe 60 is the one that touches
-- storage**, with probe 59 as its control.
-- TWO objects: the backfilled receipt's body, still under its `project`
-- container segment, and a money-namespace object beside it. The second is the
-- CONTROL — without it, "the member can read the receipt's blob" cannot be
-- told apart from "storage RLS is not applying to this session at all", which
-- is the failure mode every absence/presence pair in this suite exists to rule
-- out (review round 2).
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES ('rabbit-files',
        'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/1-receipt-cab.pdf',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '{"size": 700}'::jsonb),
       ('rabbit-files',
        'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/aaaa1111-0000-0000-0000-000000000001/1-invoice-control.pdf',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '{"size": 700}'::jsonb);

SELECT ok(
  (SELECT is_financial FROM public.files WHERE id = 'aaaa1111-0000-0000-0000-000000007611')
  AND NOT public.rabbit_money_key(
        (SELECT storage_path FROM public.files WHERE id = 'aaaa1111-0000-0000-0000-000000007611')),
  'TRAP 2, the path shape: a backfilled receipt is gated at the ROW while its body stays outside the money path segment');
                                                                            -- 55

-- The history. 0076 statement 2, verbatim — 0074's own backfill re-run now
-- that the flags are right.
UPDATE public.file_events fe
   SET is_financial = true
  FROM public.files f
 WHERE f.id = fe.file_id
   AND f.is_financial
   AND NOT fe.is_financial;

SELECT ok(
  (SELECT count(*) FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000007611') > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.file_events
     WHERE file_id = 'aaaa1111-0000-0000-0000-000000007611' AND NOT is_financial),
  'the receipt''s existing history is flagged too — a member cannot read the upload event of a file they can no longer see');
                                                                            -- 56

-- Flipping the flag must not MANUFACTURE history. fn_file_events_capture fires
-- on every files UPDATE but only writes on a deleted_at transition or a
-- storage_path change; a backfill that invented a 'moved' event would put a
-- false row in the one record that survives the file's deletion.
-- Review round 1 widened this from "no moved/trashed/restored" to the TOTAL,
-- which is the claim the message actually makes: the row had exactly one event
-- (its `uploaded`, minted by the fixture INSERT) before the flip and must have
-- exactly one after. Naming three event types would have let an extra
-- `uploaded`, or any event added to the vocabulary later, slip past.
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'aaaa1111-0000-0000-0000-000000007611'),
  1, 'the backfill writes no fake history — the receipt still has exactly its one uploaded event');
                                                                            -- 57

-- And the gate actually bites. A plain project member cannot read the
-- backfilled receipt, with the blast-radius control one line away proving the
-- empty result is not an empty table.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '11111111-1111-1111-1111-111111111111'
);

SELECT ok(
  (SELECT count(*)::int FROM public.files
    WHERE id = 'aaaa1111-0000-0000-0000-000000007611') = 0
  AND (SELECT count(*)::int FROM public.files
    WHERE id = 'aaaa1111-0000-0000-0000-000000007613') = 1,
  '🚨 a plain member cannot read the backfilled receipt, and CAN still read the ordinary file beside it (presence control)');
                                                                            -- 58

-- THE CONTROL FIRST. A money-namespace object IS hidden from this member by
-- `rabbit_files_select`'s `NOT rabbit_money_segment(seg 3)` arm. If this ever
-- returns 1, storage RLS is not applying to the session and probe 60 below
-- proves nothing.
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE name = 'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/aaaa1111-0000-0000-0000-000000000001/1-invoice-control.pdf'),
  0, 'CONTROL: storage RLS IS applying — the member cannot read an object under the money segment');
                                                                            -- 59

-- 🚨 TRAP 2, MEASURED RATHER THAN ASSERTED. The row gate just closed for this
-- member — probe 58. The BLOB gate did not: the object still sits under the
-- `project` segment, so `rabbit_files_select` still serves it.
--
-- ⚠️ THIS PROBE IS EXPECTED TO FIND THE OBJECT READABLE. Green here means the
-- documented gap is still open; that is the limitation, not a failure, and it
-- is why a body-mover is still owed. The disposition is IN THE MESSAGE and not
-- only in this comment, because a comment is not printed in a CI log.
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE name = 'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/1-receipt-cab.pdf'),
  1, '🚨 TRAP 2 MEASURED (EXPECTED 1): the member who cannot read the receipt ROW can STILL read its BLOB. If this is 0 the blob gate was CLOSED — that is good news, and handbook §12.9, OUTSTANDING residual 1 and this probe must all be updated together');
                                                                            -- 60

SELECT * FROM finish();
ROLLBACK;
