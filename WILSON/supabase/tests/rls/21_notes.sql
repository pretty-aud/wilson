-- pgTAP: notes — owner-only privacy (Session 8, migration 0017)
--
-- Guards the Notes privacy model: rows are visible and writable ONLY by
-- their owner inside their workspace. Deliberately NO app-role bypass —
-- a workspace admin cannot read another member's notes. Also pins the
-- optimistic-concurrency contract (version-guarded saves match zero rows
-- when stale) and the WITH CHECK pins that stop owner/workspace re-pointing.
--
-- Personas: user_a (ws_a admin, from tests.rls_setup), user_d (ws_a, seeded
-- here — same id as 17/19), user_b (ws_b admin).
-- 0125 (MO3): notes have a tier (personal, shared, company_standard), a trash
-- and a version the server counts; the personal arm is 0017's exactly. Its
-- probes follow the 0017 ones, with user_c (a member) and user_n (has left).
-- De-auth pair before every persona switch: tests schema is runner-only.

BEGIN;
SELECT plan(62);

SELECT * FROM tests.rls_setup();

-- Seed user_d in ws_a (same deterministic ids as 17_edit_history/19_soft_delete).
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddddddd',
   'user_d@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'manager', 'user_d', 'User D', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- ── probes 1-6: owner CRUD + spoof pins (as user_a) ─────────────────────────
SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

SELECT lives_ok(
  $$INSERT INTO public.notes (id, title, subject, note_date)
    VALUES ('da000000-0000-0000-0000-000000000001',
            'Note A', 'Ideas', '2026-07-28')$$,
  'owner can create a note (workspace_id/owner_id fill from defaults)'
);

SELECT is(
  (SELECT count(*)::int FROM public.notes
    WHERE id = 'da000000-0000-0000-0000-000000000001'),
  1, 'owner sees their own note'
);

SELECT lives_ok(
  $$UPDATE public.notes SET title = 'Note A (edited)'
     WHERE id = 'da000000-0000-0000-0000-000000000001'$$,
  'owner can edit their own note'
);

SELECT throws_ok(
  $$INSERT INTO public.notes (id, title, owner_id)
    VALUES ('da000000-0000-0000-0000-00000000bad1', 'Spoof',
            'dddddddd-dddd-dddd-dddd-dddddddddddd')$$,
  'new row violates row-level security policy for table "notes"',
  'cannot create a note owned by someone else'
);

SELECT throws_ok(
  $$UPDATE public.notes
       SET owner_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
     WHERE id = 'da000000-0000-0000-0000-000000000001'$$,
  'A note''s company and owner never change.',
  'cannot re-point a note at another owner (0125: the guard refuses it in words)'
);

-- Optimistic-concurrency contract: a stale-version save matches zero rows —
-- the client-side signal to merge the remote Yjs snapshot and retry.
-- (Data-modifying CTEs must sit at the TOP level of the statement.)
WITH u AS (
  UPDATE public.notes
     SET ydoc_state = 'c3RhbGU=', version = 8
   WHERE id = 'da000000-0000-0000-0000-000000000001'
     AND version = 7
  RETURNING 1)
SELECT is(count(*)::int, 0,
  'stale-version save matches zero rows (conflict signal)')
  FROM u;

-- probe 7: the correctly-versioned save lands.
WITH u AS (
  UPDATE public.notes
     SET ydoc_state = 'Zment', version = 1
   WHERE id = 'da000000-0000-0000-0000-000000000001'
     AND version = 0
  RETURNING version)
SELECT is(count(*)::int, 1,
  'correctly-versioned save matches exactly one row')
  FROM u;

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- probe 8: audit trigger stamped the owner.
SELECT is(
  (SELECT created_by FROM public.notes
    WHERE id = 'da000000-0000-0000-0000-000000000001'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'fn_audit_touch stamped created_by with the owner'
);

-- ── probes 9-12: same-workspace member sees nothing (as user_d) ─────────────
SELECT tests.login_as(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  '11111111-1111-1111-1111-111111111111'
);

SELECT is(
  (SELECT count(*)::int FROM public.notes
    WHERE id = 'da000000-0000-0000-0000-000000000001'),
  0, 'same-workspace member cannot see another member''s note'
);

WITH u AS (
  UPDATE public.notes SET title = 'hijack'
   WHERE id = 'da000000-0000-0000-0000-000000000001'
  RETURNING 1)
SELECT is(count(*)::int, 0,
  'same-workspace member cannot update another member''s note')
  FROM u;

SELECT throws_ok(
  $$DELETE FROM public.notes WHERE id = 'da000000-0000-0000-0000-000000000001'$$,
  '42501', NULL,
  'same-workspace member cannot delete another member''s note (0125: no client deletes one)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- probe 12: NO admin bypass — inline claims give user_d app_role=admin; the
-- owner-only policies never consult the role, so the note stays invisible.
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',  'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'workspace_id', '11111111-1111-1111-1111-111111111111',
      'app_role',     'admin'
    )
  )::text,
  true
);
SELECT set_config('role', 'authenticated', true);

SELECT is(
  (SELECT count(*)::int FROM public.notes
    WHERE id = 'da000000-0000-0000-0000-000000000001'),
  0, 'workspace admin has NO bypass into another member''s notes'
);

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- ── probes 13-14: cross-workspace isolation (as user_b) ─────────────────────
SELECT tests.login_as(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '22222222-2222-2222-2222-222222222222'
);

SELECT is(
  (SELECT count(*)::int FROM public.notes),
  0, 'cross-workspace user sees no ws_a notes'
);

SELECT throws_ok(
  $$INSERT INTO public.notes (id, title, workspace_id)
    VALUES ('da000000-0000-0000-0000-00000000bad2', 'Cross',
            '11111111-1111-1111-1111-111111111111')$$,
  'new row violates row-level security policy for table "notes"',
  'cannot create a note in a foreign workspace'
);

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- probe 15: the note physically survived every non-owner attempt (runner).
SELECT is(
  (SELECT count(*)::int FROM public.notes
    WHERE id = 'da000000-0000-0000-0000-000000000001'),
  1, 'note row physically intact after all denied attempts'
);

-- ── probes 16-17: owner hard delete ─────────────────────────────────────────
SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

SELECT throws_ok(
  $$DELETE FROM public.notes
     WHERE id = 'da000000-0000-0000-0000-000000000001'$$,
  '42501', NULL,
  'the owner''s hard delete is refused (0125: deleting is the trash)'
);

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.notes
    WHERE id = 'da000000-0000-0000-0000-000000000001'),
  1, 'the row is still there: only the purge hard-deletes a note (0125)'
);

-- ── 0125 (MO3): workspace notes ─────────────────────────────────────────────
-- Personas added for it: user_c a plain member who owns the notes below; user_n a member who has left. user_a is a
-- live admin of ws_a, user_d a workspace manager, user_b ws_b's admin.
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
SELECT u.id, u.email, crypt('testpw', gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
       'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()
  FROM (VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'user_c@test.local'),
               ('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, 'user_n@test.local')) u(id, email)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true),
       ('11111111-1111-1111-1111-111111111111', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'user', 'user_n', 'User N', true)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET is_active = EXCLUDED.is_active, app_role = EXCLUDED.app_role;

SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
INSERT INTO public.notes (id, title) VALUES
  ('da000000-0000-0000-0000-0000000000c1', 'C private'),
  ('da000000-0000-0000-0000-0000000000c2', 'C shared'),
  ('da000000-0000-0000-0000-0000000000c3', 'C to purge'),
  ('da000000-0000-0000-0000-0000000000c4', 'C kept in the trash');
SELECT is((SELECT string_agg(DISTINCT tier, ',') FROM public.notes WHERE id::text LIKE 'da000000-0000-0000-0000-0000000000c%'),
  'personal', 'a new note is personal');
SELECT throws_ok($$INSERT INTO public.notes (id, title, tier) VALUES ('da000000-0000-0000-0000-0000000000c9', 'Standard', 'company_standard')$$,
  '42501', NULL, 'a member makes no note the company standard');
SELECT lives_ok($$UPDATE public.notes SET tier = 'shared' WHERE id IN ('da000000-0000-0000-0000-0000000000c2', 'da000000-0000-0000-0000-0000000000c3', 'da000000-0000-0000-0000-0000000000c4')$$,
  'the owner shares a note');
-- The server counts the body's versions: a forged number is not taken, and a change of anything else keeps it.
UPDATE public.notes SET ydoc_state = 'Zm9yZ2Vk', version = 100 WHERE id = 'da000000-0000-0000-0000-0000000000c2' AND version = 0;
SELECT is((SELECT version FROM public.notes WHERE id = 'da000000-0000-0000-0000-0000000000c2'), 1::bigint,
  'a save of the body takes the next version, whatever number it sends');
UPDATE public.notes SET title = 'C shared, renamed' WHERE id = 'da000000-0000-0000-0000-0000000000c2';
SELECT is((SELECT version FROM public.notes WHERE id = 'da000000-0000-0000-0000-0000000000c2'), 1::bigint,
  'and a change of its title keeps it');
SELECT throws_ok($$UPDATE public.notes SET tier = 'company_standard' WHERE id = 'da000000-0000-0000-0000-0000000000c2'$$,
  '42501', NULL, 'its owner, a member, does not make it the company standard');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- A manager reads a shared note, and changes no one else's.
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT string_agg(title, ',' ORDER BY title) FROM public.notes WHERE id::text LIKE 'da000000-0000-0000-0000-0000000000c%'),
  'C kept in the trash,C shared, renamed,C to purge', 'a manager reads the shared notes, and not the personal one');
WITH u AS (UPDATE public.notes SET title = 'by D' WHERE id = 'da000000-0000-0000-0000-0000000000c2' RETURNING 1)
SELECT is(count(*)::int, 0, 'and changes none of them') FROM u;
SELECT throws_ok($$SELECT public.note_trash('da000000-0000-0000-0000-0000000000c2')$$,
  '42501', 'That note is not one you can put in the trash.', 'nor puts one in the trash');
SELECT ok(public.moth_can_read_target('note', 'da000000-0000-0000-0000-0000000000c2')
          AND NOT public.moth_can_read_target('note', 'da000000-0000-0000-0000-0000000000c1')
          AND NOT public.moth_can_write_target('note', 'da000000-0000-0000-0000-0000000000c2'),
  'Moth''s gate: a manager sees the shared note, not the personal one, and may change neither');
SELECT is((SELECT string_agg(title || ':' || tier || ':' || is_mine::text, ',' ORDER BY title) FROM public.moth_notes()
            WHERE id::text LIKE 'da000000-0000-0000-0000-0000000000c%'),
  'C kept in the trash:shared:false,C shared, renamed:shared:false,C to purge:shared:false', 'moth_notes gives the manager the shared notes, as someone else''s');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- A live admin: no way into a personal note, the run of a shared one.
SELECT tests.login_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.notes WHERE id = 'da000000-0000-0000-0000-0000000000c1'), 0,
  'an admin reads no one else''s personal note');
SELECT ok(NOT public.moth_can_read_target('note', 'da000000-0000-0000-0000-0000000000c1'), '… nor does Moth''s gate give one (no admin leg)');
SELECT throws_ok($$SELECT public.note_trash('da000000-0000-0000-0000-0000000000c1')$$,
  '42501', 'That note is not one you can put in the trash.', '… nor puts it in the trash: the words of a note that is not there');
SELECT throws_ok($$SELECT public.note_trash('da000000-0000-0000-0000-00000000dead')$$,
  '42501', 'That note is not one you can put in the trash.', 'which are these');
WITH u AS (UPDATE public.notes SET title = 'C shared, by A' WHERE id = 'da000000-0000-0000-0000-0000000000c2' RETURNING 1)
SELECT is(count(*)::int, 1, 'an admin changes a shared note') FROM u;
SELECT ok(public.moth_can_write_target('note', 'da000000-0000-0000-0000-0000000000c2'), '… as Moth''s write gate says');
SELECT throws_ok($$UPDATE public.notes SET owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' WHERE id = 'da000000-0000-0000-0000-0000000000c2'$$,
  '42501', 'A note''s company and owner never change.', 'but never gives it to someone else');
SELECT throws_ok($$UPDATE public.notes SET tier = 'personal' WHERE id = 'da000000-0000-0000-0000-0000000000c2'$$,
  '42501', NULL, 'nor makes it personal: that is its owner''s call');
SELECT lives_ok($$UPDATE public.notes SET tier = 'company_standard' WHERE id = 'da000000-0000-0000-0000-0000000000c2'$$,
  'an admin makes a shared note the company standard');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT throws_ok($$UPDATE public.notes SET tier = 'shared' WHERE id = 'da000000-0000-0000-0000-0000000000c2'$$,
  '42501', NULL, 'its owner, a member, does not take the company standard back');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111');
SELECT lives_ok($$UPDATE public.notes SET tier = 'shared' WHERE id = 'da000000-0000-0000-0000-0000000000c2'$$,
  'an admin does');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- Someone who has left, and another company, read none of it.
UPDATE public.workspace_members SET is_active = false
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
SELECT tests.login_as('ffffffff-ffff-ffff-ffff-ffffffffffff', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.notes WHERE id::text LIKE 'da000000-0000-0000-0000-0000000000c%'), 0,
  'someone who has left reads no shared note');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222');
SELECT ok((SELECT count(*) FROM public.notes WHERE id::text LIKE 'da000000-0000-0000-0000-0000000000c%') = 0
          AND NOT public.moth_can_read_target('note', 'da000000-0000-0000-0000-0000000000c2'),
  'another company''s admin reads none, and Moth''s gate gives none');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- The trash: the owner's, or a live admin's for a note that is not personal.
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT is(public.note_trash('da000000-0000-0000-0000-0000000000c2'), true, 'the owner puts a note in the trash');
SELECT is(public.note_trash('da000000-0000-0000-0000-0000000000c2'), false, '… once');
SELECT throws_ok($$UPDATE public.notes SET title = 'while in the trash' WHERE id = 'da000000-0000-0000-0000-0000000000c2'$$,
  '42501', 'A note in the trash is brought back before it is changed.', 'a note in the trash is not changed');
SELECT throws_ok($$UPDATE public.notes SET deleted_at = NULL, deleted_by = NULL WHERE id = 'da000000-0000-0000-0000-0000000000c2'$$,
  '42501', 'A note goes to the trash and comes back from it through the trash.', 'nor taken out of it by hand');
SELECT ok(NOT public.moth_can_read_target('note', 'da000000-0000-0000-0000-0000000000c2'), 'Moth''s gate gives no note in the trash');
SELECT throws_ok($$DELETE FROM public.notes WHERE id = 'da000000-0000-0000-0000-0000000000c1'$$,
  '42501', NULL, 'no client deletes a note, not even its owner: deleting is the trash');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.notes WHERE id = 'da000000-0000-0000-0000-0000000000c2'), 0,
  'a shared note in the trash is gone from a member''s list');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.notes WHERE id = 'da000000-0000-0000-0000-0000000000c2'), 1,
  '… and a live admin still sees it, to bring it back');
SELECT is(public.note_restore('da000000-0000-0000-0000-0000000000c2'), true, 'an admin brings a shared note back');
SELECT is(public.note_restore('da000000-0000-0000-0000-0000000000c2'), false, '… once');
SELECT throws_ok($$SELECT public.note_restore('da000000-0000-0000-0000-0000000000c1')$$,
  '42501', 'That note is not one you can bring back.', 'and nobody else''s personal one, in the words of a missing one');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- The purge: after 30 days, nightly, and no one else's to call.
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT public.note_trash('da000000-0000-0000-0000-0000000000c3');
SELECT public.note_trash('da000000-0000-0000-0000-0000000000c4');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
ALTER TABLE public.notes DISABLE TRIGGER trg_notes_guard;
UPDATE public.notes SET deleted_at = now() - interval '40 days' WHERE id = 'da000000-0000-0000-0000-0000000000c3';
UPDATE public.notes SET deleted_at = now() - interval '5 days' WHERE id = 'da000000-0000-0000-0000-0000000000c4';
ALTER TABLE public.notes ENABLE TRIGGER trg_notes_guard;
SELECT ok(public.purge_trashed_notes() >= 1, 'the purge removes what has been in the trash 30 days');
SELECT is((SELECT string_agg(right(id::text, 2), ',' ORDER BY id) FROM public.notes WHERE id IN ('da000000-0000-0000-0000-0000000000c3', 'da000000-0000-0000-0000-0000000000c4')),
  'c4', '… and keeps what has been there five');
SELECT throws_ok($$SELECT public.purge_trashed_notes(interval '1 hour')$$, '22023', NULL, 'it keeps a note a day at least');
SELECT ok(NOT has_function_privilege('authenticated', 'public.purge_trashed_notes(interval)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.note_trash(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.note_trash(uuid)', 'EXECUTE'),
  'a signed-in person may trash and bring back; only the job purges');

-- The shape: three policies, no client DELETE, the guard before every write, on no realtime topic, and moth_notes
-- gives no body.
SELECT is((SELECT string_agg(policyname || ':' || cmd, ',' ORDER BY policyname) FROM pg_policies WHERE tablename = 'notes'),
  'notes_insert:INSERT,notes_select:SELECT,notes_update:UPDATE', 'notes has three policies and none for DELETE');
SELECT ok(NOT has_table_privilege('authenticated', 'public.notes', 'DELETE'), 'and a client holds no DELETE');
SELECT ok(EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.notes'::regclass AND tgname = 'trg_notes_guard'
                    AND tgtype = 23 AND tgenabled = 'O')
          AND NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                           WHERE t.tgrelid = 'public.notes'::regclass AND p.proname LIKE '%broadcast%'),
  'the guard runs before every insert and update, and notes are on no realtime topic');
SELECT ok(position('ydoc' IN pg_get_function_result('public.moth_notes()'::regprocedure)) = 0
          AND position('body' IN pg_get_function_result('public.moth_notes()'::regprocedure)) = 0,
  'moth_notes gives a note''s title and tier, never its body');

-- probe 18: RLS enabled AND forced.
SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.notes'::regclass),
  'notes has RLS enabled and forced'
);


-- ── 0033: the migration-0011 privilege trap, for notes ──
-- 0011's blanket GRANT plus its ALTER DEFAULT PRIVILEGES left anon holding
-- every table privilege on notes; 0033 revoked it. Assert the revoke rather
-- than assume it — a policy-only check passes while a privilege hole is wide
-- open, which is exactly how 26 tables stayed open until S21 tripped over one.
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.notes', 'SELECT') OR
    has_table_privilege('anon', 'public.notes', 'INSERT') OR
    has_table_privilege('anon', 'public.notes', 'UPDATE') OR
    has_table_privilege('anon', 'public.notes', 'DELETE')
  ),
  'anon holds no table privilege on notes'
);

SELECT * FROM finish();
ROLLBACK;
