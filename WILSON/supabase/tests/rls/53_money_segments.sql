-- pgTAP: 0042 — the money-gated path segments, and the manifest UPDATE arm.
--
-- Two defects are pinned here, and they fail in opposite directions:
--
--   * THE MANIFEST COULD ONLY BE WRITTEN ONCE. There was no UPDATE policy on
--     the rabbit-files bucket at all, so the second write of PROJECT.json —
--     and every write after it — was refused. Probe 6 is the regression test:
--     it fails if the UPDATE policy is ever dropped again.
--
--   * A RATES FILE MUST NOT BE READABLE BY THE TEAM. project_rate_overrides
--     is manager-only, so a mirror of it under a path any project member can
--     read would hand back exactly what RLS denies. Probe 9 is the one that
--     matters; probe 8 is its control, proving a manager CAN read the same
--     object — otherwise 9 would pass just as well if nobody could.
--
-- Every probe here was verified by BREAKING it, not by watching it pass:
-- dropping the UPDATE policy fails 6 (have 0, want 1); gating INVOICES but
-- forgetting FINANCE fails 9 (have 1, want 0); dropping the coalesce fails 1,
-- 5 and 11 together.
--
-- 🚨 Probe 1 is not a formality. storage.foldername('projects/x/PROJECT.json')
-- has no third element, so the predicate is called with NULL. A bare
-- `upper(seg) IN (...)` returns NULL there, `NOT NULL` is NULL, and a NULL
-- policy expression FAILS — which would make the manifest unreadable and
-- unwritable by everyone, including the person who just saved a setting.
-- That is the whole reason for the coalesce.
BEGIN;
SELECT plan(15);

SELECT * FROM tests.rls_setup();

-- A plain team member on project A — the person the rates gate exists for.
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
-- The predicate itself — one definition, so it can be tested once
-- ═══════════════════════════════════════════════════════════════════════

-- 1: the NULL case. See the header — this one guards PROJECT.json's existence.
SELECT is(public.rabbit_money_segment(NULL), false,
  'a path with no third segment is NOT money-gated — PROJECT.json stays reachable');

-- 2: case-insensitive, so 0038's lowercase-vs-uppercase inversion cannot return.
SELECT is(public.rabbit_money_segment('invoices'), true,
  'the invoice segment is gated in lower case (0038 shipped it lowercase)');

-- 3: the new segment.
SELECT is(public.rabbit_money_segment('FINANCE'), true,
  'the FINANCE segment is gated');

-- 4: an ordinary category is not gated — the gate must be narrow, not greedy.
SELECT is(public.rabbit_money_segment('ASSETS'), false,
  'an ordinary folder category is not money-gated');


-- ═══════════════════════════════════════════════════════════════════════
-- The manifest: written once, then rewritten — the S26 defect
-- ═══════════════════════════════════════════════════════════════════════

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- 5: the first write. This always worked.
SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/PROJECT.json',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"application/json"}'::jsonb)$$,
  'the first manifest write succeeds');

-- 6: 🚨 THE FIX. Before 0042 this affected ZERO rows — an RLS-refused UPDATE
-- raises nothing, so the adapter's upsert failed and the mirror froze at its
-- first version for the life of the project. Count rows; never trust silence.
WITH upd AS (
  UPDATE storage.objects
     SET metadata = '{"mimetype":"application/json","rewritten":true}'::jsonb
   WHERE name = 'projects/aaaa1111-0000-0000-0000-000000000001/PROJECT.json'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1,
  '0042: the manifest can be REWRITTEN — it was write-once before this');


-- ═══════════════════════════════════════════════════════════════════════
-- The rates mirror: manager writes it, manager reads it, member cannot
-- ═══════════════════════════════════════════════════════════════════════

-- 7: a money-cleared manager can write the rates file.
SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/FINANCE/RATES.json',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"application/json"}'::jsonb)$$,
  'a money-cleared manager can write the project rates mirror');

-- 8: the control for probe 9, and it has to run here while still admin. If the
-- manager could not read it either, probe 9 would pass for the wrong reason —
-- "nobody can read it" is not the requirement (standing rule 2).
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE name = 'projects/aaaa1111-0000-0000-0000-000000000001/FINANCE/RATES.json'),
  1,
  'CONTROL: a money-cleared manager CAN read the rates mirror');

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

-- Now as the plain project member.
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 9: 🚨 THE ONE THAT MATTERS. The rates are manager-only in the database, so
-- the mirror of them must be manager-only in storage.
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE name = 'projects/aaaa1111-0000-0000-0000-000000000001/FINANCE/RATES.json'),
  0,
  'a project member CANNOT read the rates mirror — the figures RLS denies them');

-- 10: nor write one, which would let them plant a readable copy.
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/FINANCE/mine.json',
            'cccccccc-cccc-cccc-cccc-cccccccccccc',
            '{"mimetype":"application/json"}'::jsonb)$$,
  'new row violates row-level security policy for table "objects"',
  'a project member cannot write into the money-gated segment');

-- 11: but the manifest itself stays readable by the team. The whole point of
-- excluding rates from PROJECT.json was to keep PROJECT.json shareable.
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE name = 'projects/aaaa1111-0000-0000-0000-000000000001/PROJECT.json'),
  1,
  'a project member CAN still read PROJECT.json — it carries no rates');

-- 12: and cannot smuggle an ordinary object into the gated segment by
-- renaming it. This is the WITH CHECK arm; with only USING it would succeed.
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES ('rabbit-files',
        'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/note.txt',
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        '{"mimetype":"text/plain"}'::jsonb);

SELECT throws_ok(
  $$UPDATE storage.objects
       SET name = 'projects/aaaa1111-0000-0000-0000-000000000001/FINANCE/note.txt'
     WHERE name = 'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/note.txt'$$,
  'new row violates row-level security policy for table "objects"',
  'an object cannot be renamed INTO the money-gated segment (WITH CHECK arm)');

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;


-- ═══════════════════════════════════════════════════════════════════════
-- Catalogue: scan every object, not the list the migration wrote (S22)
-- ═══════════════════════════════════════════════════════════════════════

-- 13: the 0011 privilege trap, for the new function. Checks the GRANTEE —
-- 0011 granted to PUBLIC, so a REVOKE naming only anon is a silent no-op.
SELECT ok(
  NOT has_function_privilege('anon', 'public.rabbit_money_segment(text)', 'EXECUTE'),
  'anon cannot execute rabbit_money_segment');

-- 14: the old invoices-only policies are GONE, not merely superseded. Two live
-- sets would OR together and the narrower predicate would stop gating anything.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname LIKE 'rabbit_files_invoices%'),
  0,
  'the superseded rabbit_files_invoices_* policies no longer exist');

-- 15: every rabbit-files policy routes through the ONE predicate, so the
-- reserved-segment list cannot desynchronise the way it did in 0038.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname LIKE 'rabbit_files%'
      AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%rabbit_money_segment%'),
  8,
  'all 8 rabbit-files policies share one money-segment predicate');

SELECT * FROM finish();
ROLLBACK;
