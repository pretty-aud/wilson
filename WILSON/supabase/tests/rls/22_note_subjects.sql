-- pgTAP: note_subjects — owner-only subject options (Session 8, migration 0017)
--
-- The user-defined options for the Notes subject dropdown follow the same
-- owner-only model as notes, plus a per-owner case-insensitive label
-- uniqueness (note_subjects_owner_label_uidx) that must NOT block two
-- different users from having the same label.
--
-- De-auth pair before every persona switch: tests schema is runner-only.

BEGIN;
SELECT plan(13);

SELECT * FROM tests.rls_setup();

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

-- ── probes 1-5: owner CRUD + uniqueness (as user_a) ─────────────────────────
SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

SELECT lives_ok(
  $$INSERT INTO public.note_subjects (id, label, position)
    VALUES ('d5000000-0000-0000-0000-000000000001', 'Meetings', 0)$$,
  'owner can create a subject option'
);

SELECT is(
  (SELECT count(*)::int FROM public.note_subjects
    WHERE id = 'd5000000-0000-0000-0000-000000000001'),
  1, 'owner sees their own subject option'
);

SELECT throws_ok(
  $$INSERT INTO public.note_subjects (label) VALUES ('MEETINGS')$$,
  'duplicate key value violates unique constraint "note_subjects_owner_label_uidx"',
  'duplicate label (case-insensitive) is rejected per owner'
);

SELECT throws_ok(
  $$INSERT INTO public.note_subjects (label, owner_id)
    VALUES ('Spoofed', 'dddddddd-dddd-dddd-dddd-dddddddddddd')$$,
  'new row violates row-level security policy for table "note_subjects"',
  'cannot create a subject option owned by someone else'
);

SELECT lives_ok(
  $$UPDATE public.note_subjects SET label = 'Meetings & Reviews'
     WHERE id = 'd5000000-0000-0000-0000-000000000001'$$,
  'owner can rename their subject option'
);

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- ── probes 6-8: same-workspace member isolation (as user_d) ─────────────────
SELECT tests.login_as(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  '11111111-1111-1111-1111-111111111111'
);

SELECT is(
  (SELECT count(*)::int FROM public.note_subjects),
  0, 'same-workspace member sees none of another member''s options'
);

-- (Data-modifying CTEs must sit at the TOP level of the statement.)
WITH u AS (
  UPDATE public.note_subjects SET label = 'hijack'
   WHERE id = 'd5000000-0000-0000-0000-000000000001'
  RETURNING 1)
SELECT is(count(*)::int, 0,
  'same-workspace member cannot update another member''s option')
  FROM u;

-- Per-owner uniqueness: the SAME label is fine for a DIFFERENT owner.
SELECT lives_ok(
  $$INSERT INTO public.note_subjects (label) VALUES ('Meetings & Reviews')$$,
  'another user can reuse the same label (uniqueness is per owner)'
);

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- ── probe 9: cross-workspace isolation (as user_b) ──────────────────────────
SELECT tests.login_as(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '22222222-2222-2222-2222-222222222222'
);

SELECT is(
  (SELECT count(*)::int FROM public.note_subjects),
  0, 'cross-workspace user sees no ws_a subject options'
);

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- ── probes 10-11: owner hard delete ─────────────────────────────────────────
SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

SELECT lives_ok(
  $$DELETE FROM public.note_subjects
     WHERE id = 'd5000000-0000-0000-0000-000000000001'$$,
  'owner can delete their subject option'
);

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.note_subjects
    WHERE id = 'd5000000-0000-0000-0000-000000000001'),
  0, 'delete physically removed the row'
);

-- probe 12: RLS enabled AND forced.
SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.note_subjects'::regclass),
  'note_subjects has RLS enabled and forced'
);


-- ── 0033: the migration-0011 privilege trap, for note_subjects ──
-- 0011's blanket GRANT plus its ALTER DEFAULT PRIVILEGES left anon holding
-- every table privilege on note_subjects; 0033 revoked it. Assert the revoke rather
-- than assume it — a policy-only check passes while a privilege hole is wide
-- open, which is exactly how 26 tables stayed open until S21 tripped over one.
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.note_subjects', 'SELECT') OR
    has_table_privilege('anon', 'public.note_subjects', 'INSERT') OR
    has_table_privilege('anon', 'public.note_subjects', 'UPDATE') OR
    has_table_privilege('anon', 'public.note_subjects', 'DELETE')
  ),
  'anon holds no table privilege on note_subjects'
);

SELECT * FROM finish();
ROLLBACK;
