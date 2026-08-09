-- =============================================================================
-- 65_workspace_storage_plans.sql — Session 41: Petal cloud as a paid,
-- operator-managed product (migration 0055)
--
-- What this pins, in order of how badly it would hurt to get wrong:
--
--   * 🚨 A QUOTA THAT ENFORCES NOTHING. rabbit-files INSERT already carries TWO
--     permissive arms and permissive policies OR together, so a quota added as a
--     ninth permissive policy is satisfied by either existing arm — the
--     migration goes green, the console shows a limit, and the free tier stays
--     unmetered. That is the 0038 inversion, which this project has already
--     shipped once. Probes 10 and 25 are the tripwire: one asserts the policy is
--     actually RESTRICTIVE, the other drives a real refused INSERT.
--
--   * 🚨 A QUOTA THAT LOCKS OUT EVERY WORKSPACE, INCLUDING ITS FIRST UPLOAD.
--     NULL-safety INVERTS under a restrictive policy: a NULL denies instead of
--     leaking. SUM() over zero rows is NULL and `NULL < quota` is NULL, so a
--     dropped outer COALESCE refuses the first file anyone ever uploads — and
--     the symptom is indistinguishable from the quota working. Probe 18 is the
--     one that notices, and it runs BEFORE any object exists precisely so it can.
--
--   * 🚨 A QUOTA THAT BLOCKS THE OTHER TWO BUCKETS. A RESTRICTIVE policy is
--     evaluated for EVERY INSERT into storage.objects, not just this bucket, and
--     three buckets share that table. Probe 29 uploads an AVATAR while the
--     workspace is over quota; it fails the moment the predicate stops passing
--     for everything it is not about.
--
--   * 🚨 A QUOTA THAT REPLACES THE MONEY GATE INSTEAD OF COMPOSING WITH IT.
--     Probes 27 and 30 are a PAIR and neither means much alone: a money-cleared
--     caller must still write INVOICES while over quota (the exemption works),
--     AND a plain member must still be refused the same segment (0042 still
--     binds underneath). One without the other passes for the wrong reason.
--
--   * 🚨 THE INVERSE OF 0048. workspace_storage lets a workspace ADMIN insert,
--     update and delete their own row from the browser. This table must let that
--     same caller do NONE of those — otherwise a customer sets their own quota
--     and flips their own status to active. The discriminating caller is a
--     workspace ADMIN who is not an operator (probes 32-34); probe 35 is its
--     control, because "nobody can do anything" is not the requirement.
--
--   * A QUOTA WALKED AROUND VIA THE MANIFEST EXEMPTION. The elegant form of the
--     exemption is "depth 3, no third segment" — and rabbit_files_insert admits
--     ANY key shaped projects/<id>/<anything>, so that form would let
--     projects/<id>/dailies.mov through, 50 MB at a time. Probe 16.
--
-- Postgres-side reads are ALWAYS scoped to the fixture workspaces — dev carries
-- real rows and an unscoped count decays the day the feature is used.
--
-- PROVEN BY EIGHT BREAKERS BEFORE COMMIT (2026-08-09), each run TWICE — once
-- with 0055's post-conditions in place and once with them stripped, because a
-- post-condition that fires can hide a suite that would not have noticed, and a
-- replay against an already-applied database skips post-conditions entirely.
--
--   B1  drop AS RESTRICTIVE .............. post-cond CAUGHT · suite 10,25,30,31
--   B2  drop the outer COALESCE .......... post-cond CAUGHT · suite 18-25
--   B3  drop `bucket_id <> 'rabbit-files'`  post-cond passed · suite 28,29
--   B4  exempt by depth alone ............ post-cond CAUGHT · suite 13,16
--   B5  drop the status arm .............. post-cond passed · suite 31
--   B6  drop the money exemption ......... post-cond CAUGHT · suite 15,27
--   B7  GRANT INSERT to authenticated .... post-cond passed · suite 32
--   B8  CONTROL, a comment-only edit ..... 38/38, as it must be
--
-- 🚨 B1 FAILED A PROBE THIS SUITE'S AUTHOR DID NOT PREDICT, AND THAT PROBE IS
-- THE MOST IMPORTANT RESULT IN THE SET. The prediction was 10, 25 and 31 — the
-- quota simply not binding. What actually happened is worse: without
-- AS RESTRICTIVE the policy becomes a NINTH PERMISSIVE arm, permissive arms OR
-- together, and its own money EXEMPTION (`rabbit_quota_exempt_path` is true for
-- INVOICES/ and FINANCE/) then GRANTS a write that 0042 was refusing. Probe 30 —
-- a plain member writing into the money segment — went green-to-red.
-- So the wrong keyword here does not merely fail to meter storage; it re-opens
-- the invoice hole 0038 shipped and 0039 closed. Recorded because the argument
-- in 0055's header ("a permissive policy would enforce nothing") was TOO KIND.
--
-- 🚨 B3, B5 and B7 were caught by the SUITE ALONE — 0055's post-conditions
-- passed them. B1, B2, B4 and B6 were caught by BOTH. Neither layer subsumes
-- the other, which is the whole reason both exist.
--
-- ⚠️ THE REFUSAL ON THE PLAN TABLE IS A PRIVILEGE ERROR, NOT AN RLS ERROR, and
-- the suite asserts what actually fires. 0055 revokes INSERT/UPDATE/DELETE from
-- `authenticated`, so Postgres refuses before any policy is consulted. The RLS
-- layer underneath is pinned structurally instead (probes 3-4: exactly one
-- policy, zero write policies), because the absence of a write policy is what
-- keeps the Edge Function the only mutation path.
-- =============================================================================

BEGIN;

SELECT plan(40);

SELECT * FROM tests.rls_setup();

-- user_c: a plain 'user'-role member of workspace A, ACTIVE. Needed for the
-- composition pair — a caller who is inside the workspace but outside the money
-- gate, so probe 30's refusal is attributable to 0042 and nothing else.
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','user','user_c','User C',true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- ══ 1. Structure ════════════════════════════════════════════════════════════

SELECT has_table('public', 'workspace_storage_plans',
  'workspace_storage_plans table exists');                                  -- 1

SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.workspace_storage_plans'::regclass),
  'workspace_storage_plans has RLS enabled AND forced');                    -- 2

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname='public' AND tablename='workspace_storage_plans'),
  1, 'exactly one policy — members read, nobody writes');                   -- 3

-- 🚨 The operator-ownership mechanism, asserted directly. 0031's precedent is
-- that the ABSENCE of a write policy is what makes the Edge Function the only
-- mutation path; if one ever appears, a workspace admin can set their own quota.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname='public' AND tablename='workspace_storage_plans'
      AND cmd <> 'SELECT'),
  0, 'no client write policy — writes must go through service_role only');  -- 4

-- 0029: a FOR ALL arm ORs with every narrow arm beside it and silently wins.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname='public' AND tablename='workspace_storage_plans' AND cmd='ALL'),
  0, 'no FOR ALL policy arm');                                              -- 5

-- PUBLIC as well as anon — the S22 grantee lesson.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema='public' AND table_name='workspace_storage_plans'
       AND grantee IN ('anon', 'PUBLIC')),
  'neither anon nor PUBLIC holds any privilege on workspace_storage_plans');-- 6

-- 🚨 0031's rule, pinned so a later session cannot "tidy up" by adding the
-- trigger every other workspace table has. fn_audit_touch sets
-- updated_by := auth.uid() UNCONDITIONALLY on UPDATE, and auth.uid() is NULL
-- under service_role — so the trigger would blank the actor on every operator
-- edit while the row saved cleanly.
SELECT is(
  (SELECT count(*)::int FROM pg_trigger
    WHERE tgrelid = 'public.workspace_storage_plans'::regclass
      AND NOT tgisinternal),
  0, 'no stamping trigger — fn_audit_touch would blank updated_by under service_role');
                                                                            -- 7

-- Each fixture violates exactly ONE constraint: Postgres reports a violation by
-- the ALPHABETICALLY FIRST constraint name (quota < status) and throws_ok
-- matches SQLERRM exactly, so the status probe carries a VALID quota.
SELECT throws_ok(
  $$INSERT INTO public.workspace_storage_plans (workspace_id, quota_bytes)
    VALUES ('11111111-1111-1111-1111-111111111111', 0)$$,
  'new row for relation "workspace_storage_plans" violates check constraint "workspace_storage_plans_quota_chk"',
  'a zero quota is refused — "no storage" is a status, not a fat-fingered ceiling');
                                                                            -- 8

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage_plans (workspace_id, status, quota_bytes)
    VALUES ('11111111-1111-1111-1111-111111111111', 'trial', 1073741824)$$,
  'new row for relation "workspace_storage_plans" violates check constraint "workspace_storage_plans_status_chk"',
  'a third status is refused — the gate has two branches and no default for a third');
                                                                            -- 9

-- ══ 2. The policy is RESTRICTIVE, and its neighbours are untouched ══════════

-- 🚨 Dropping `AS RESTRICTIVE` leaves a syntactically valid policy that ORs with
-- the two permissive INSERT arms and enforces nothing at all.
SELECT is(
  (SELECT permissive || '|' || cmd FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='petal_storage_quota_insert'),
  'RESTRICTIVE|INSERT',
  'petal_storage_quota_insert is RESTRICTIVE — permissive would OR and enforce nothing');
                                                                            -- 10

-- 0053's post-condition 7 and suite 63 probe 7 both count these prefixes BARE
-- and require 8. Asserting them here means a rename into either namespace fails
-- in the suite that owns the new policy, not in two files nobody is editing.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname LIKE 'rabbit_files%'),
  8, 'the eight rabbit_files policies are untouched — the new one is not in their namespace');
                                                                            -- 11

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname LIKE 'rabbit_thumbnails%'),
  8, 'the eight rabbit_thumbnails policies are untouched');                  -- 12

-- ══ 3. The exempt-path classifier ═══════════════════════════════════════════
-- NULL-safety in the direction that matters HERE: under a restrictive policy a
-- NULL DENIES, so a bare OR would refuse uploads rather than leak them — the
-- 0042 lesson with the sign flipped.

SELECT ok(
  public.rabbit_quota_exempt_path(NULL) IS FALSE,
  'rabbit_quota_exempt_path(NULL) is false, not NULL');                      -- 13

SELECT ok(
  public.rabbit_quota_exempt_path('projects/aaaa1111-0000-0000-0000-000000000001/PROJECT.json'),
  'the project manifest is exempt — WILSON rewrites it on every project change');
                                                                            -- 14

SELECT ok(
  public.rabbit_quota_exempt_path('projects/x/INVOICES/l1/1-inv.pdf')
  AND public.rabbit_quota_exempt_path('projects/x/FINANCE/RATES.json'),
  'money-gated paths are exempt — the rates mirror is rewritten on every rates change, and invoices are how Petal gets paid');
                                                                            -- 15

-- 🚨 THE HOLE THE ELEGANT FORM WOULD OPEN. `(foldername)[3] IS NULL` alone reads
-- better and is wrong: rabbit_files_insert admits any key shaped
-- projects/<id>/<anything>, so a depth-only exemption is an unmetered upload
-- path, 50 MB at a time.
SELECT ok(
  NOT public.rabbit_quota_exempt_path('projects/aaaa1111-0000-0000-0000-000000000001/dailies.mov'),
  'a depth-3 MEDIA key is NOT exempt — the exemption tests the filename, not just the depth');
                                                                            -- 16

SELECT ok(
  NOT public.rabbit_quota_exempt_path('projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/1-plate.png'),
  'an ordinary asset path is not exempt');                                   -- 17

-- ══ 4. Usage arithmetic, starting from empty ════════════════════════════════

-- 🚨 THE FIRST-UPLOAD PROBE. This runs before any object exists, which is the
-- only moment it can catch a dropped outer COALESCE. NULL here would deny every
-- first upload in every new workspace and look exactly like a working quota.
SELECT is(
  public.workspace_petal_bytes('11111111-1111-1111-1111-111111111111'),
  0::bigint,
  'a workspace with no objects meters 0, never NULL — a NULL refuses its first upload forever');
                                                                            -- 18

-- ══ 5. The free tier allows an upload (and is the presence control) ═════════

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- Metadata carries `size` as a JSON NUMBER — the shape storage-api actually
-- writes, MEASURED on wilson-staging 2026-08-09:
--   {eTag, size, mimetype, cacheControl, lastModified, contentLength, httpStatusCode}
SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/1-plate.png',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"image/png","size":5000000}'::jsonb)$$,
  'PRESENCE CONTROL: with no plan row the free tier allows an upload — every refusal below is a real refusal');
                                                                            -- 19

-- The company's own view, with no plan row: the free tier is resolved HERE so
-- the client never carries its own copy of the number.
SELECT is(
  (SELECT used_bytes || '|' || quota_bytes || '|' || status || '|' || has_plan
     FROM public.workspace_storage_usage()),
  '5000000|1073741824|active|false',
  'workspace_storage_usage reports the free tier: 1 GiB, active, has_plan false');
                                                                            -- 20

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

-- ══ 6. Usage arithmetic, with data ══════════════════════════════════════════

SELECT is(
  public.workspace_petal_bytes('11111111-1111-1111-1111-111111111111'),
  5000000::bigint,
  'usage sums storage.objects.metadata->>''size'' — the server-authored figure, not the client''s files.size_bytes');
                                                                            -- 21

-- The INNER COALESCE. An object whose metadata carries no size must contribute
-- 0, not turn the whole SUM into NULL — which would again refuse every upload.
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES ('rabbit-files',
        'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/2-nosize.png',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '{"mimetype":"image/png"}'::jsonb);

SELECT is(
  public.workspace_petal_bytes('11111111-1111-1111-1111-111111111111'),
  5000000::bigint,
  'an object with no size in its metadata contributes 0 rather than NULLing the whole sum');
                                                                            -- 22

-- Another workspace's bytes are another workspace's bill. The object key carries
-- no workspace at all, so this is entirely the projects.workspace_id join.
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES ('rabbit-files',
        'projects/bbbb2222-0000-0000-0000-000000000001/ASSETS/b1/1-other.png',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        '{"mimetype":"image/png","size":9000000}'::jsonb);

SELECT is(
  public.workspace_petal_bytes('11111111-1111-1111-1111-111111111111')
    || '|' ||
  public.workspace_petal_bytes('22222222-2222-2222-2222-222222222222'),
  '5000000|9000000',
  'each workspace is metered separately — the key has no workspace in it, so this is the projects join');
                                                                            -- 23

-- Avatars are NOT metered: per-person, 2 MB ceiling, an identity feature rather
-- than a media one. Refusing a company's dailies because its people uploaded
-- photographs would be indefensible.
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES ('user-avatars',
        '11111111-1111-1111-1111-111111111111/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/face.jpg',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '{"mimetype":"image/jpeg","size":2000000}'::jsonb);

SELECT is(
  public.workspace_petal_bytes('11111111-1111-1111-1111-111111111111'),
  5000000::bigint,
  'user-avatars are not metered — the total did not move');                  -- 24

-- 🚨 THE POSITIVE HALF, ADDED BY THIS SESSION'S OWN REVIEW. Probe 24 proves a
-- bucket is EXCLUDED; nothing proved rabbit-thumbnails is INCLUDED. Deleting it
-- from workspace_petal_bytes' bucket IN-list left the suite at 38/38 and every
-- post-condition green — a whole bucket silently stops being billed, and the
-- only visible effect is that Petal quietly pays for previews forever.
-- "Read every stated coverage limit in BOTH directions", inside the suite that
-- states it.
-- ⚠️ A DISTINCT KEY. storage.objects is unique on (bucket_id, name) and probe
-- 28 writes `1-plate.png.jpg` as an authenticated caller later in this file —
-- reusing it here would fail that probe on a duplicate key while looking like a
-- quota refusal.
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES ('rabbit-thumbnails',
        'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/9-meter.png.jpg',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '{"mimetype":"image/jpeg","size":7000}'::jsonb);

SELECT is(
  public.workspace_petal_bytes('11111111-1111-1111-1111-111111111111'),
  5007000::bigint,
  'rabbit-thumbnails IS metered — a preview is Petal''s bytes too, and the total moved by exactly its size');
                                                                            -- 25

-- ══ 7. Over quota ═══════════════════════════════════════════════════════════
-- Usage is 5,000,000. A 1,000,000-byte ceiling puts this workspace over.

INSERT INTO public.workspace_storage_plans (workspace_id, status, quota_bytes, created_by)
VALUES ('11111111-1111-1111-1111-111111111111', 'active', 1000000,
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- 🚨 THE ONE THE SESSION EXISTS FOR. This caller is a workspace ADMIN, so every
-- arm of rabbit_files_insert passes — membership, can_write_project, the lot.
-- The ONLY thing that can refuse this is the restrictive quota policy.
--
-- 🚨 MEASURED 2026-08-09, and it is not what suite 53 asserts: a RESTRICTIVE
-- denial NAMES THE POLICY, where a permissive one does not.
--     permissive:  new row violates row-level security policy for table "objects"
--     restrictive: new row violates row-level security policy
--                  "petal_storage_quota_insert" for table "objects"
-- Written first with suite 53's generic string, which failed here and at probe
-- 31 and nowhere else. That is a better outcome than the string being the same:
-- this probe's claim used to be an ARGUMENT ("nothing else could have refused
-- it") and is now asserted by the message itself.
--
-- ⚠️ What this does NOT establish is what a BROWSER sees. This is the Postgres
-- message; whether storage-api forwards it verbatim is untested, so the client
-- must never parse it — the UI pre-checks the quota through
-- workspace_storage_usage() instead.
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/3-over.png',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"image/png","size":1000}'::jsonb)$$,
  'new row violates row-level security policy "petal_storage_quota_insert" for table "objects"',
  'an over-quota upload is refused SERVER-SIDE, BY THIS POLICY BY NAME — a direct storage call bypasses every client check, so only this counts');
                                                                            -- 25

-- The manifest is WILSON's own bookkeeping and is rewritten on every project
-- change; blocking it would corrupt the folder view rather than save any bytes.
SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/PROJECT.json',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"application/json","size":3000}'::jsonb)$$,
  'the project manifest still writes over quota');                           -- 26

-- 🚨 HALF OF THE COMPOSITION PAIR. FINANCE/RATES.json is a MIRROR that
-- RabbitProvider rewrites whenever rates change, so a quota that blocked it
-- would surface as a silent settings-save failure in an unrelated subsystem.
SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/FINANCE/RATES.json',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"application/json","size":4000}'::jsonb)$$,
  'a money-cleared caller still writes the rates mirror over quota');        -- 27

-- Thumbnails are DERIVED and capped at 256 KB by the bucket, and a workspace
-- that cannot upload a body generates no new previews anyway.
SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-thumbnails',
            'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/1-plate.png.jpg',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"image/jpeg","size":9000}'::jsonb)$$,
  'a thumbnail still writes over quota — the gate is on bodies');            -- 28

-- 🚨 THE SELF-LIMITING ARM. A RESTRICTIVE policy is evaluated for EVERY INSERT
-- into storage.objects. Without `bucket_id <> 'rabbit-files'` written to PASS,
-- this workspace being over its MEDIA quota would start refusing avatar uploads
-- with an RLS error naming the wrong bucket entirely.
SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('user-avatars',
            '11111111-1111-1111-1111-111111111111/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/face2.jpg',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"image/jpeg","size":1000}'::jsonb)$$,
  'an AVATAR still uploads while the workspace is over quota — the restrictive policy passes for buckets it is not about');
                                                                            -- 29

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

-- 🚨 THE OTHER HALF OF THE COMPOSITION PAIR. Probe 27 alone would pass just as
-- well if the quota policy had REPLACED 0042's money gate instead of ANDing over
-- it. user_c is inside the workspace and outside the money gate, so this refusal
-- is attributable to rabbit_files_money_insert and nothing else.
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','cccccccc-cccc-cccc-cccc-cccccccccccc','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/FINANCE/mine.json',
            'cccccccc-cccc-cccc-cccc-cccccccccccc',
            '{"mimetype":"application/json","size":10}'::jsonb)$$,
  'new row violates row-level security policy for table "objects"',
  'a plain member STILL cannot write the money segment — the quota policy composed with 0042 rather than replacing it');
                                                                            -- 30

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

-- ══ 8. Suspended is an independent arm ══════════════════════════════════════
-- A quota so large it cannot possibly bind, so only `status` can refuse.

UPDATE public.workspace_storage_plans
   SET status = 'suspended', quota_bytes = 109951162777600
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
            'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a1/4-susp.png',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"image/png","size":1000}'::jsonb)$$,
  'new row violates row-level security policy "petal_storage_quota_insert" for table "objects"',
  'a SUSPENDED company is refused under a 100 TiB quota — status is its own arm, not a quota of zero');
                                                                            -- 31

-- ══ 9. 🚨 The inverse of 0048 ═══════════════════════════════════════════════
-- Still signed in as the workspace ADMIN of A — the discriminating caller. An
-- ordinary member would be refused by a merely admin-gated policy and every
-- probe here would pass for the wrong reason.
--
-- The refusal is a PRIVILEGE error, not an RLS one: 0055 revokes the write verbs
-- from `authenticated`, so Postgres refuses before consulting any policy. That
-- is the stronger of the two layers and it is what actually fires.

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage_plans (workspace_id, status, quota_bytes)
    VALUES ('22222222-2222-2222-2222-222222222222', 'active', 99999999999)$$,
  'permission denied for table workspace_storage_plans',
  'a workspace ADMIN cannot create a plan row — 0048 lets them create their storage row, this must not');
                                                                            -- 32

SELECT throws_ok(
  $$UPDATE public.workspace_storage_plans SET quota_bytes = 99999999999
     WHERE workspace_id = '11111111-1111-1111-1111-111111111111'$$,
  'permission denied for table workspace_storage_plans',
  'a workspace ADMIN cannot raise their own quota');                         -- 33

SELECT throws_ok(
  $$DELETE FROM public.workspace_storage_plans
     WHERE workspace_id = '11111111-1111-1111-1111-111111111111'$$,
  'permission denied for table workspace_storage_plans',
  'a workspace ADMIN cannot delete their plan to fall back to the free tier');
                                                                            -- 34

-- CONTROL. Without this, probes 32-34 pass just as well against a table nobody
-- can touch at all — and the company is entitled to see its own plan.
SELECT is(
  (SELECT count(*)::int FROM public.workspace_storage_plans),
  1, 'CONTROL: that same admin CAN read their own plan row');                -- 35

-- ...and the company's own view reflects the operator's decision.
SELECT is(
  (SELECT quota_bytes || '|' || status || '|' || has_plan
     FROM public.workspace_storage_usage()),
  '109951162777600|suspended|true',
  'workspace_storage_usage shows the plan the operator set, so the UI can say why uploads stopped');
                                                                            -- 36

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

-- ══ 10. Cross-workspace ═════════════════════════════════════════════════════
-- user_b is an active ADMIN of workspace B. The only plan row on the table
-- belongs to A, and probe 35 has already proved that row IS visible to someone —
-- so a zero here is a refusal, not an empty table.

SELECT tests.login_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                      '22222222-2222-2222-2222-222222222222');

SELECT is(
  (SELECT count(*)::int FROM public.workspace_storage_plans),
  0, 'another company''s admin sees no plan rows — theirs does not exist and A''s is not theirs');
                                                                            -- 37

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

-- ══ 11. The operator summary is not client-reachable ════════════════════════
-- It returns every company's byte total. An `authenticated` grant would hand
-- that to every signed-in user in the product.

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.operator_storage_plan_summary()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.operator_storage_plan_summary()', 'EXECUTE'),
  'operator_storage_plan_summary is service_role only — it carries every company''s usage');
                                                                            -- 39

-- 🚨 0056, FROM THIS SESSION'S OWN REVIEW. workspace_petal_bytes takes an
-- ARBITRARY workspace id and does no membership check — deliberately, because
-- the restrictive policy needs it unfiltered. 0055 granted it to
-- `authenticated`, which turned it into a PostgREST RPC returning any company's
-- storage total to any signed-in user in the product. No caller ever needed
-- that grant: the policy reaches it through rabbit_petal_storage_ok, which is
-- SECURITY DEFINER and therefore uses the OWNER's privilege.
--
-- ⚠️ The converse is asserted too, in the same probe, because revoking one
-- function too far refuses every upload rather than leaking anything — and that
-- failure would look exactly like the quota working.
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.workspace_petal_bytes(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.workspace_petal_bytes(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.rabbit_petal_storage_ok(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.rabbit_quota_exempt_path(text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.workspace_storage_usage()', 'EXECUTE'),
  'the unfiltered aggregate is service_role only, and the three the policy evaluates as the caller are NOT');
                                                                            -- 40

SELECT * FROM finish();
ROLLBACK;
