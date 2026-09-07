-- pgTAP: workspace_members self-SELECT / self-UPDATE (Session 3, migration 0009)
--
-- Guards the policies added for invited non-admin users completing
-- NewUserWelcome. Also verifies the escalation trigger rejects self-role
-- and self-username changes.

BEGIN;
SELECT plan(8);

SELECT * FROM tests.rls_setup();

-- Seed a non-admin 'user' in ws_a so we can test non-admin self-update.
-- rls_setup seeds user_a as admin of ws_a; we add user_c as a plain 'user'.
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc',
        'user_c@test.local', crypt('testpw', gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        'authenticated', 'authenticated',
        '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'user', 'user_c', 'User C', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- Log in as the non-admin user. Claim app_role='user' matches the seeded row.
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
SELECT set_config('role', 'authenticated', true);

-- ── probe 1: non-admin can SELECT own membership row ─────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.workspace_members
    WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  1,
  'non-admin can SELECT their own workspace_members row'
);

-- ── probe 2: non-admin can UPDATE own profile fields (NewUserWelcome path) ──
WITH upd AS (
  UPDATE public.workspace_members
     SET display_name = 'Updated C',
         pronouns     = 'they/them',
         title        = 'Animator',
         onboarded_at = now()
   WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
     AND workspace_id = '11111111-1111-1111-1111-111111111111'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1,
          'non-admin can UPDATE own profile fields');

-- ── probe 3: self-role escalation blocked by trigger ─────────────────────
SELECT throws_ok(
  $$UPDATE public.workspace_members
       SET app_role = 'admin'
     WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'$$,
  'self-role change not allowed',
  'trigger rejects self app_role escalation'
);

-- ── probe 4: self-username change blocked by trigger ─────────────────────
SELECT throws_ok(
  $$UPDATE public.workspace_members
       SET username = 'hijacker'
     WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'$$,
  'self-username change not allowed',
  'trigger rejects self-username change'
);

-- ── probe 5: non-admin cannot UPDATE another user's row ──────────────────
WITH upd AS (
  UPDATE public.workspace_members
     SET display_name = 'hacked'
   WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     AND workspace_id = '11111111-1111-1111-1111-111111111111'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0,
          'non-admin cannot UPDATE another user''s profile');

-- ── probe 6: switch to admin — admin CAN update anyone in their ws ──────
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

WITH upd AS (
  UPDATE public.workspace_members
     SET title = 'Senior Animator'
   WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
     AND workspace_id = '11111111-1111-1111-1111-111111111111'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1,
          'admin can UPDATE other members in their workspace');

-- ── probe 7: admin of ws_a cannot update member of ws_b ─────────────────
WITH upd AS (
  UPDATE public.workspace_members
     SET display_name = 'cross-tenant hack'
   WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
     AND workspace_id = '22222222-2222-2222-2222-222222222222'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0,
          'admin cannot UPDATE members in other workspaces');


-- ── 0033: the migration-0011 privilege trap, for workspace_members ──
-- 0011's blanket GRANT plus its ALTER DEFAULT PRIVILEGES left anon holding
-- every table privilege on workspace_members; 0033 revoked it. Assert the revoke rather
-- than assume it — a policy-only check passes while a privilege hole is wide
-- open, which is exactly how 26 tables stayed open until S21 tripped over one.
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.workspace_members', 'SELECT') OR
    has_table_privilege('anon', 'public.workspace_members', 'INSERT') OR
    has_table_privilege('anon', 'public.workspace_members', 'UPDATE') OR
    has_table_privilege('anon', 'public.workspace_members', 'DELETE')
  ),
  'anon holds no table privilege on workspace_members'
);

SELECT * FROM finish();
ROLLBACK;
