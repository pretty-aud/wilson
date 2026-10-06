-- pgTAP: provision_workspace_and_admin RPC (Session 3, migration 0009)
--
-- Verifies the atomic provisioning path used by the provision-workspace
-- Edge Function after it creates the auth.users row.

BEGIN;
SELECT plan(5);

-- Seed an auth user to act as the admin of the new workspace.
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd',
        'provision@test.local', crypt('testpw', gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        'authenticated', 'authenticated',
        '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Service_role is what the Edge Function uses.
SELECT set_config('role', 'service_role', true);

-- ── probe 1: happy path — workspace + membership created atomically ──────
SELECT lives_ok(
  $$SELECT * FROM public.provision_workspace_and_admin(
      'Test Studio',
      'test-studio',
      'dddddddd-dddd-dddd-dddd-dddddddddddd',
      'test_admin',
      'Test Admin')$$,
  'provision_workspace_and_admin succeeds with valid input'
);

SELECT is(
  (SELECT count(*)::int FROM public.workspaces WHERE slug = 'test-studio'),
  1,
  'workspace row created'
);

SELECT is(
  (SELECT app_role FROM public.workspace_members
    WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
      AND workspace_id = (SELECT id FROM public.workspaces WHERE slug = 'test-studio')),
  'admin',
  'membership row created with admin role'
);

-- ── probe 2: slug collision is rejected ─────────────────────────────────
SELECT throws_ok(
  $$SELECT * FROM public.provision_workspace_and_admin(
      'Another Studio',
      'test-studio',
      'dddddddd-dddd-dddd-dddd-dddddddddddd',
      'another_admin',
      'Another Admin')$$,
  'slug_taken',
  'duplicate slug raises slug_taken'
);

-- ── probe 3: bad slug shape is rejected ─────────────────────────────────
SELECT throws_ok(
  $$SELECT * FROM public.provision_workspace_and_admin(
      'Bad Slug Studio',
      'Bad_Slug!',
      'dddddddd-dddd-dddd-dddd-dddddddddddd',
      'bad_slug_admin',
      'Bad Slug Admin')$$,
  'slug shape invalid',
  'invalid slug shape raises explicit error'
);

SELECT * FROM finish();
ROLLBACK;
