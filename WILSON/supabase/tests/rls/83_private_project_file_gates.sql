-- =============================================================================
-- 83_private_project_file_gates.sql — migration 0083: the private-project arm
-- (0072) restated for Track C's two SECURITY DEFINER bodies that bypassed it
-- (reserve_upload_bytes, log_file_downloaded) and the parent hop added to
-- the two `files` WRITE policies that had none (files_insert, files_update)
-- — the merge of Track C over the UI overhaul, review round 1, C-R1-01.
--
-- What this pins (suite 82's shape, for Track C's gates):
--   * Structure: each of the two bodies calls passes_project_privacy exactly
--     once, comments stripped; files_insert and files_update WITH CHECK both
--     hop to the parent project; `files` still has exactly its four policies
--     (suite 79's pin, re-asserted because this migration retypes two of
--     them); the client can still call both RPCs and no client can call the
--     helper.
--   * A private project can be RESERVED AGAINST by its creator and by an
--     admin, and by NOBODY else — even though can_write_project says yes to
--     every one of them: the project is unstaffed, so can_write_project is
--     TRUE for the plain member, and the second manager is a manager. Before
--     0083 the two refusals were allowed calls that wrote a reservation row —
--     and a certificate into the private project's file_events, had the
--     upload then been abandoned.
--   * A private project's file can be READ-LOGGED (log_file_downloaded) by
--     its creator and an admin, and by nobody else. Before 0083 the second
--     manager's call wrote a 'downloaded' event and answered true, an
--     existence oracle for the file id.
--   * A private project's `files` are the creator's and an admin's to WRITE:
--     a second manager with the id can neither INSERT into it (return=minimal:
--     no SELECT policy sees the row) nor rewrite what is already there with an
--     UPDATE that reads no column — the two WITH CHECKs' new hop. A FILTERED
--     move INTO it is refused as well, but by files_select's hop on the NEW
--     row, before and after 0083 (probe 18's note; round 2, C-R2-01).
--   * THE CONTROLS: the same callers, on the PUBLIC project, reserve, log a
--     read, insert and keep their row. Without those the refusals could be any
--     refusal at all; with them they are the privacy arm and nothing else.
--   * THE 0059 LESSON, for a retype: the money arm (0038) and the is_financial
--     flag (0074) survived in log_file_downloaded, and the bounded exemption
--     (0078) survived in reserve_upload_bytes — checked in the function that
--     actually runs, not in the file that was written.
--
-- Postgres-side reads are ALWAYS scoped to the fixture rows — dev carries
-- real projects (S33, 439f702).
-- =============================================================================

BEGIN;

SELECT plan(31);

SELECT * FROM tests.rls_setup();

-- user_c: plain 'user'-role ACTIVE member of workspace A (suite 80's shape).
-- user_d: 'manager' of workspace A — the private project's creator.
-- user_e: a SECOND 'manager' of workspace A, who is not the creator — the
--         case can_write_project admits and projects_select refuses.
-- No project_members rows anywhere: every project here is UNSTAFFED, so
-- can_write_project is true for user_c as well (0013).
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user_d@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user_e@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','user','user_c','User C',true),
  ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','manager','user_d','User D',true),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','manager','user_e','User E',true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;


-- ── 1-5: structure ────────────────────────────────────────────────────────
-- Comments stripped before counting (0077 §3c): a `-- passes_project_privacy`
-- line must not satisfy this, and a second live mention must not either.

SELECT is(
  (SELECT (length(b) - length(replace(b, 'passes_project_privacy(', ''))) / length('passes_project_privacy(')
     FROM (SELECT regexp_replace(regexp_replace(
                    pg_get_functiondef('public.reserve_upload_bytes(text, bigint)'::regprocedure),
                    '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g') AS b) s),
  1, 'reserve_upload_bytes calls passes_project_privacy exactly once, comments stripped');

SELECT is(
  (SELECT (length(b) - length(replace(b, 'passes_project_privacy(', ''))) / length('passes_project_privacy(')
     FROM (SELECT regexp_replace(regexp_replace(
                    pg_get_functiondef('public.log_file_downloaded(uuid)'::regprocedure),
                    '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g') AS b) s),
  1, 'log_file_downloaded calls passes_project_privacy exactly once, comments stripped');

-- 0083 §3: the two WRITE policies hop to the parent in their WITH CHECK.
-- pg_policies deparses the expression, so the hop shows as the table's name;
-- probes 16-20 below are the behaviour this structure is for (20 is the one
-- that can only pass with files_update's hop; 18 cannot — see its note).
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'files'
      AND policyname IN ('files_insert', 'files_update')
      AND with_check LIKE '%projects%'),
  2, 'files_insert and files_update WITH CHECK both hop to the parent project');

-- Suite 79 probe 20's pin, re-asserted here because 0083 DROPs and recreates
-- two of the four: a retype that left three, or added a fifth permissive one
-- (which would OR in), is the S15 mistake.
SELECT is(
  (SELECT array_agg(policyname::TEXT ORDER BY policyname) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'files'),
  ARRAY['files_delete','files_insert','files_select','files_update']::TEXT[],
  'public.files still has exactly its four policies after 0083 retyped two');

-- The client calls both RPCs over PostgREST (supabaseProvider.reserveUpload,
-- supabaseAdapter.downloadFile), so authenticated must keep EXECUTE on each;
-- the helper stays closed (the migration-0011 privilege trap: a client that
-- could call it could probe whether an id is a private project it cannot see).
SELECT ok(
  has_function_privilege('authenticated', 'public.reserve_upload_bytes(text, bigint)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.log_file_downloaded(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.reserve_upload_bytes(text, bigint)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.log_file_downloaded(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.passes_project_privacy(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.passes_project_privacy(uuid)', 'EXECUTE'),
  'authenticated still executes both RPCs; anon executes neither; no client role executes passes_project_privacy');


-- ── 6: the admin seeds THE CONTROLS on the PUBLIC project ──────────────────
-- A plain file (every caller below can read it) and an invoice (only money
-- readers can — the 0059-lesson probes at the end lean on it). Claims in the
-- JWT's own shape (suite 59): current_app_role() reads app_metadata.app_role
-- from the claims, not from workspace_members. 🚨 workspace_id is SENT, not
-- left to the populate trigger — see probe 16's note.

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok($$
  INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path, size_bytes, is_financial)
  VALUES
    ('83830000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111',
     'aaaa1111-0000-0000-0000-000000000001', 'public-brief.pdf', 'supabase',
     'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a83/1-public-brief.pdf', 2048, false),
    ('83830000-0000-0000-0000-0000000000b2', '11111111-1111-1111-1111-111111111111',
     'aaaa1111-0000-0000-0000-000000000001', 'public-invoice.pdf', 'supabase',
     'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/1-public-invoice.pdf', 1024, true)
$$, 'CONTROL SETUP: the admin files a plain file and an invoice on the PUBLIC project');


-- ── 7-11: the manager makes a private project and works inside it ──────────
-- The OWNER controls: every gate 0083 arms must still say yes to the person
-- the arm exists for.

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok($$
  INSERT INTO public.projects (id, workspace_id, title, is_private)
  VALUES ('aaaa1111-0000-0000-0000-000000000083',
          '11111111-1111-1111-1111-111111111111', 'Private P', true)
$$, 'a manager can insert a private project (created_by stamped by fn_audit_touch)');

SELECT ok(
  (SELECT public.reserve_upload_bytes(
     'projects/aaaa1111-0000-0000-0000-000000000083/ASSETS/a1/1-own.mov', 4000))
  IS NOT NULL,
  'OWNER CONTROL: the creator reserves against their private project and gets an id');

SELECT lives_ok($$
  INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path, size_bytes, is_financial)
  VALUES ('83830000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
          'aaaa1111-0000-0000-0000-000000000083', 'private-plate.png', 'supabase',
          'projects/aaaa1111-0000-0000-0000-000000000083/ASSETS/a1/1-private-plate.png', 4096, false)
$$, 'OWNER CONTROL: the creator files a row on their private project — files_insert''s new hop admits them');

-- PRESENCE CONTROL (suite 71 probe 11's reasoning): the refusals below are
-- refusals of a row that exists, not of nothing.
SELECT is(
  (SELECT count(*)::int FROM public.files
    WHERE id = '83830000-0000-0000-0000-0000000000a1'),
  1, 'PRESENCE CONTROL: the private file is visible to its creator');

SELECT ok(
  public.log_file_downloaded('83830000-0000-0000-0000-0000000000a1'),
  'OWNER CONTROL: the creator logs a read of their private file');


-- ── 12-20: a manager who is NOT the creator — the escalation 0083 closes ───
-- can_write_project is true for every manager, so before 0083 this caller
-- could reserve against a private project they cannot SELECT (12), log a read
-- of its file (14), and write into it through the plain policies (16:
-- supabase-js's .insert() without .select() sends Prefer: return=minimal, so
-- no SELECT policy ever looked at the row; 20: an UPDATE that reads no
-- column, the one UPDATE shape no SELECT policy touches). 🚨 18 is NOT one
-- of those — a filtered move was refused before 0083 too; see its note.

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

-- The code is the first refusal's own (42501), on purpose (0083's header):
-- the caller is not told that a project they cannot see exists.
SELECT throws_ok(
  $$SELECT public.reserve_upload_bytes(
      'projects/aaaa1111-0000-0000-0000-000000000083/ASSETS/a1/2-intruder.mov', 4000)$$,
  '42501', NULL,
  '🚨 THE HEADLINE: another manager cannot reserve against a private project they cannot see (reserve_upload_bytes''s new arm)');

-- THE CONTROL, same caller, the PUBLIC project: workspace, membership and the
-- write gate all say yes, so the refusal above is the privacy arm and not one
-- of them.
SELECT ok(
  (SELECT public.reserve_upload_bytes(
     'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a83/3-control.mov', 4000))
  IS NOT NULL,
  'CONTROL: the same manager reserves against the PUBLIC project and gets an id');

-- The message is 0047's one refusal, on purpose: existence does not leak.
SELECT throws_ok(
  $$SELECT public.log_file_downloaded('83830000-0000-0000-0000-0000000000a1')$$,
  'log_file_downloaded: file not found or not readable',
  'another manager cannot log a read of a private project''s file (log_file_downloaded''s new arm)');

SELECT ok(
  public.log_file_downloaded('83830000-0000-0000-0000-0000000000b1'),
  'CONTROL: the same manager logs a read of the PUBLIC project''s file');

-- 🚨 workspace_id is SENT, not left to the populate trigger: that trigger
-- runs as the caller and reads projects under RLS, so on a private project it
-- would fill nothing and the row would fail the WORKSPACE arm — a refusal for
-- the wrong reason, which is what an attacker's client never hands us. With
-- the column supplied, the only arm that can refuse is the new hop.
SELECT throws_ok($$
  INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path, size_bytes, is_financial)
  VALUES ('83830000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111',
          'aaaa1111-0000-0000-0000-000000000083', 'intruder.png', 'supabase',
          'projects/aaaa1111-0000-0000-0000-000000000083/ASSETS/a1/2-intruder.png', 10, false)
$$, '42501', NULL,
  'another manager cannot file a row INTO a private project (files_insert''s new hop)');

SELECT lives_ok($$
  INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path, size_bytes, is_financial)
  VALUES ('83830000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111',
          'aaaa1111-0000-0000-0000-000000000001', 'second-manager-public.png', 'supabase',
          'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a83/4-second-manager.png', 10, false)
$$, 'CONTROL: the same INSERT into the PUBLIC project lives — workspace, membership and write gate all say yes');

-- 🚨 DEFENCE IN DEPTH, NOT ISOLATION (round 2, C-R2-01). This UPDATE has a
-- WHERE, so it reads a column, so Postgres requires SELECT on files and
-- applies files_select's USING — which has hopped to projects since 0038 —
-- to the NEW row as a WITH CHECK (rowsecurity.c: the SELECT policies join
-- the WITH CHECK list whenever SELECT is required). The private parent fails
-- that check with or without 0083's hop, so this probe throws 42501 either
-- way (suite 79's probe-15 note found the same thing). It stays as the
-- documented behaviour of a filtered move; probe 20 is the one that can only
-- pass with 0083.
SELECT throws_ok($$
  UPDATE public.files
     SET project_id = 'aaaa1111-0000-0000-0000-000000000083'
   WHERE id = '83830000-0000-0000-0000-0000000000e2'
$$, '42501', NULL,
  'a filtered move of a file INTO it is refused too — by files_select''s hop on the NEW row, which any UPDATE that reads a column already meets (defence in depth, not 0083''s doing)');

-- PRESENCE CONTROL for the refused move: the row is where it was, on the
-- public project, and the refusal was of a row this caller can see.
SELECT is(
  (SELECT count(*)::int FROM public.files
    WHERE id = '83830000-0000-0000-0000-0000000000e2'
      AND project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  1, 'PRESENCE CONTROL: the file stays on the public project after the refused move');


-- 🚨 THE FAILING CONTROL FOR files_update's HOP (round 2, C-R2-01). The one
-- UPDATE shape no SELECT policy ever sees reads NO column: no WHERE, no
-- RETURNING, a constant on the right — Postgres requires SELECT only when a
-- column is read. Then only files_update's USING admits the OLD rows
-- (workspace + membership + can_write_project + money: every one of them
-- yes for a second manager, privacy unasked — can_write_project is DEFINER
-- and says yes to any manager claim) and only files_update's WITH CHECK
-- judges the NEW ones. Before 0083 that WITH CHECK had no hop, so this
-- statement rewrote the private file a1 along with every other row the
-- USING admits; after 0083 a1's new row fails the hop and the whole
-- statement aborts. Filter-less on purpose, and the session allows it:
-- suites 17, 25, 28 and 29 already send filter-less writes in CI. Probe 24
-- reads back that the abort undid all of it. (On the hosted API this is the
-- statement pg-safeupdate refuses for the API role — unmeasured on this
-- project's envs; the hop is the gate that does not depend on it.)
SELECT throws_ok(
  $$UPDATE public.files SET description = 'x'$$,
  '42501', NULL,
  '🚨 an UPDATE that reads no column cannot rewrite a private project''s file (files_update''s WITH CHECK hop — the one shape files_select never sees)');


-- ── 21-24: nothing was written by the refused calls (read as postgres) ─────
-- A refusal that had already written its row or its event would be the same
-- hole with a different exit code; these are scoped to the fixture ids.

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.upload_reservations
    WHERE storage_path = 'projects/aaaa1111-0000-0000-0000-000000000083/ASSETS/a1/2-intruder.mov'),
  0, 'the refused reserve wrote no reservation row');

SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = '83830000-0000-0000-0000-0000000000a1'
      AND event = 'downloaded'
      AND actor_user_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  0, 'the refused read logged no downloaded event for the private file');

-- PRESENCE CONTROL for probe 22: the creator's own read (probe 11) IS there,
-- so a zero above is a refusal, not an event stream that writes nothing.
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = '83830000-0000-0000-0000-0000000000a1'
      AND event = 'downloaded'
      AND actor_user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  1, 'PRESENCE CONTROL: the creator''s read of the same file was logged');

-- PRESENCE CONTROL for probe 20: the refused column-free UPDATE aborted as a
-- WHOLE. The private file's description is untouched — and so is the public
-- file's, which the same statement reached through files_update's USING: a
-- per-row refusal that left the rows before it rewritten would be the same
-- hole with a different exit code. Two rows, both still NULL; a missing row
-- would count 1 or 0, a rewritten one 1.
SELECT is(
  (SELECT count(*)::int FROM public.files
    WHERE id IN ('83830000-0000-0000-0000-0000000000a1',
                 '83830000-0000-0000-0000-0000000000b1')
      AND description IS NULL),
  2, 'PRESENCE CONTROL: the refused column-free UPDATE rewrote neither the private file nor the public one');


-- ── 25-26: a plain member — can_write_project TRUE (unstaffed), and refused ─
-- The reserve here was an ALLOWED call before 0083: the id is all the caller
-- needs, and 0018's workspace channel hands it out.

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.reserve_upload_bytes(
      'projects/aaaa1111-0000-0000-0000-000000000083/ASSETS/a1/4-member.mov', 4000)$$,
  '42501', NULL,
  'a plain member of the unstaffed workspace cannot reserve against a private project');

SELECT ok(
  (SELECT public.reserve_upload_bytes(
     'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/a83/5-member.mov', 4000))
  IS NOT NULL,
  'CONTROL: the same member reserves against the PUBLIC project — the write gate alone admits them (unstaffed → can_write_project)');


-- ── 27-29: the admin keeps the escape hatch, and the retype kept 0074's flag ─

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT ok(
  (SELECT public.reserve_upload_bytes(
     'projects/aaaa1111-0000-0000-0000-000000000083/ASSETS/a1/6-admin.mov', 4000))
  IS NOT NULL,
  'the workspace admin reserves against the private project');

SELECT ok(
  public.log_file_downloaded('83830000-0000-0000-0000-0000000000a1'),
  'the workspace admin logs a read of the private file');

-- 🚨 THE READ AND THE CHECK OF ITS EFFECT ARE SEPARATE STATEMENTS (suite 71
-- probe 16): a scalar subquery in the same statement reads the snapshot taken
-- before that statement's own write.
SELECT public.log_file_downloaded('83830000-0000-0000-0000-0000000000b2');

SELECT is(
  (SELECT is_financial FROM public.file_events
    WHERE file_id = '83830000-0000-0000-0000-0000000000b2'
      AND event = 'downloaded'
      AND actor_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  true, '0059 LESSON: the retyped log_file_downloaded still flags an invoice read is_financial (0074)');


-- ── 30-31: the retype kept 0038's money arm and 0078's bounded exemption ───
-- 🚨 0059 dropped a guard's clauses with a CREATE OR REPLACE and it cost a
-- live privilege escalation. 0083 replaces two bodies to add one arm each;
-- this is the cross-check, in the functions that actually run, that the arms
-- they already had are still there.

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- A plain member can see the public project (probe 26 proved it) and is
-- refused the invoice all the same: the money arm, with its COALESCE (0074's
-- probe 29 lesson — for a claim-less non-manager the gate is NULL, and an
-- `IF NOT NULL` fails open).
SELECT throws_ok(
  $$SELECT public.log_file_downloaded('83830000-0000-0000-0000-0000000000b2')$$,
  'log_file_downloaded: file not found or not readable',
  '0059 LESSON: the retyped log_file_downloaded still refuses a non-money reader the invoice (0038''s arm)');

-- Suite 77 probe 10's shape: a small money path on a project the caller CAN
-- see is reservation-exempt and writes no row — NULL, not a refusal and not
-- an id. Had the retype lost the bounded exemption this would return an id.
-- Asked by the ADMIN since 0088 (S4b): a key under a locked folder now needs
-- the money gate in reserve_upload_bytes's first refusal, so this member is
-- refused before the exemption is reached (suite 90 probes 47 and 87-88).
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT public.reserve_upload_bytes(
     'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/inv83/1-small-invoice.pdf', 4000)),
  NULL::bigint,
  '0059 LESSON: the retyped reserve_upload_bytes still exempts a small money path (0078''s bound)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
