-- pgTAP: workspace_directory() RPC + manager title/department writes
-- (Session 4, migration 0010)
--
-- Guards the member-directory function's tenancy + email scoping, and the
-- manager UPDATE path: managers may change other members' title/department
-- and nothing else.

BEGIN;
SELECT plan(12);

SELECT * FROM tests.rls_setup();

-- Seed a plain 'user' (user_c) and a 'manager' (user_d) in ws_a.
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   'user_c@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now()),
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
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'user', 'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111',
   'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'manager', 'user_d', 'User D', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- ── probes 1-3: directory as admin (user_a of ws_a) ──────────────────────
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
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
  (SELECT count(*)::int FROM public.workspace_directory()),
  3,
  'directory returns every ws_a member for an admin (and nothing else)'
);

SELECT is(
  (SELECT d.email FROM public.workspace_directory() d
    WHERE d.user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'user_c@test.local',
  'admin sees other members'' emails'
);

SELECT is(
  (SELECT count(*)::int FROM public.workspace_directory() d
    WHERE d.workspace_id <> '11111111-1111-1111-1111-111111111111'),
  0,
  'directory never leaks rows from other workspaces'
);

-- ── probes 4-5: directory as plain user (user_c) ─────────────────────────
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',  'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'workspace_id', '11111111-1111-1111-1111-111111111111',
      'app_role',     'user'
    )
  )::text,
  true
);

SELECT is(
  (SELECT d.email FROM public.workspace_directory() d
    WHERE d.user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  NULL::text,
  'plain user does NOT see teammates'' emails'
);

SELECT is(
  (SELECT d.email FROM public.workspace_directory() d
    WHERE d.user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'user_c@test.local',
  'plain user still sees their own email'
);

-- ── probe 6: non-member of the claimed workspace is rejected ─────────────
-- user_b is an admin of ws_b only; claim ws_a in the JWT anyway.
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'workspace_id', '11111111-1111-1111-1111-111111111111',
      'app_role',     'admin'
    )
  )::text,
  true
);

SELECT throws_ok(
  $$SELECT * FROM public.workspace_directory()$$,
  'not_a_workspace_member',
  'caller must actually be a member of the JWT''s active workspace'
);

-- ── probes 7-9: manager write scope (user_d) ─────────────────────────────
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',  'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'workspace_id', '11111111-1111-1111-1111-111111111111',
      'app_role',     'manager'
    )
  )::text,
  true
);

WITH upd AS (
  UPDATE public.workspace_members
     SET title = 'Compositor', department = 'Post'
   WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
     AND workspace_id = '11111111-1111-1111-1111-111111111111'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1,
          'manager can UPDATE another member''s title + department');

SELECT throws_ok(
  $$UPDATE public.workspace_members
       SET display_name = 'renamed by manager'
     WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'$$,
  'managers may only edit title and department',
  'manager cannot change another member''s display_name'
);

SELECT throws_ok(
  $$UPDATE public.workspace_members
       SET app_role = 'admin'
     WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'$$,
  'managers may only edit title and department',
  'manager cannot change another member''s app_role'
);

-- ── probe 10: plain user still cannot update others ──────────────────────
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',  'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'workspace_id', '11111111-1111-1111-1111-111111111111',
      'app_role',     'user'
    )
  )::text,
  true
);

WITH upd AS (
  UPDATE public.workspace_members
     SET title = 'sneaky'
   WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
     AND workspace_id = '11111111-1111-1111-1111-111111111111'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0,
          'plain user cannot UPDATE another member''s row (manager policy does not leak)');

-- ── probe 11: stale role CLAIM does not leak emails ──────────────────────
-- user_c's membership row says 'user', but the JWT still claims 'manager'
-- (the demoted-manager window). workspace_directory() must derive the role
-- from the row and keep teammates' emails NULL.
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',  'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'workspace_id', '11111111-1111-1111-1111-111111111111',
      'app_role',     'manager'
    )
  )::text,
  true
);

SELECT is(
  (SELECT d.email FROM public.workspace_directory() d
    WHERE d.user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  NULL::text,
  'stale manager claim does not leak emails — role comes from the membership row'
);

-- ── probe 12: deactivated manager cannot self-reactivate ─────────────────
-- Deactivate user_d as the test runner. Clear the JWT claims first so the
-- guard trigger sees an anonymous superuser (no self/admin/manager branch),
-- not probe 11's lingering manager claim.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
UPDATE public.workspace_members
   SET is_active = false
 WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
   AND workspace_id = '11111111-1111-1111-1111-111111111111';

-- user_d's token still claims 'manager'; the manager-write policy passes on
-- the claim, but the guard trigger must block the self-reactivation.
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',  'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'workspace_id', '11111111-1111-1111-1111-111111111111',
      'app_role',     'manager'
    )
  )::text,
  true
);
SELECT set_config('role', 'authenticated', true);

SELECT throws_ok(
  $$UPDATE public.workspace_members
       SET is_active = true
     WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'$$,
  'self-reactivation not allowed',
  'deactivated manager cannot reactivate their own row'
);

SELECT * FROM finish();
ROLLBACK;
