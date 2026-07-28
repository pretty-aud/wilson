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
-- De-auth pair before every persona switch: tests schema is runner-only.

BEGIN;
SELECT plan(18);

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
  'new row violates row-level security policy for table "notes"',
  'cannot re-point a note at another owner (WITH CHECK pin)'
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

WITH d AS (
  DELETE FROM public.notes
   WHERE id = 'da000000-0000-0000-0000-000000000001'
  RETURNING 1)
SELECT is(count(*)::int, 0,
  'same-workspace member cannot delete another member''s note')
  FROM d;

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

SELECT lives_ok(
  $$DELETE FROM public.notes
     WHERE id = 'da000000-0000-0000-0000-000000000001'$$,
  'owner can hard-delete their note'
);

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.notes
    WHERE id = 'da000000-0000-0000-0000-000000000001'),
  0, 'hard delete physically removed the row (v1: no trash for notes)'
);

-- probe 18: RLS enabled AND forced.
SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.notes'::regclass),
  'notes has RLS enabled and forced'
);

SELECT * FROM finish();
ROLLBACK;
