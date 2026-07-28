-- =============================================================================
-- 24_admin_grants.sql — Session 9: per-user rate-card grants, last-admin
-- protection, deactivated-member read alignment, auto-staffing, workspace
-- admin writes (migration 0020) + the grant-aware directory (0021).
--
-- Personas:
--   user_a aaaa… admin  ws_a (fixture)
--   user_c cccc… user   ws_a (this file)
--   user_d dddd… manager ws_a (this file)
--   user_g a7a7… INACTIVE ws_a (this file — claims will lie and say admin)
--   user_e eeee… second admin ws_a (inserted mid-file for last-admin release)
--
-- Conventions: throws_ok MESSAGE form only; de-auth pair before every
-- persona switch; role-gated probes build request.jwt.claims manually
-- (tests.login_as sets NO app_role claim — current_app_role() → NULL, which
-- is exactly what the pure-grant probes need).
-- =============================================================================

BEGIN;

SELECT plan(32);

SELECT * FROM tests.rls_setup();

-- ── extra fixtures (runner: RLS bypassed) ────────────────────────────────
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
   '00000000-0000-0000-0000-000000000000', now(), now()),
  ('a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7',
   'user_g@test.local', crypt('testpw', gen_salt('bf')), now(),
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
   'dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager', 'user_d', 'User D', true),
  ('11111111-1111-1111-1111-111111111111',
   'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7', 'user', 'user_g', 'User G (inactive)', false)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- Rate card + one entry in ws_a.
INSERT INTO public.rate_cards (id, workspace_id, name)
VALUES ('caaa1111-0000-0000-0000-000000000024',
        '11111111-1111-1111-1111-111111111111', 'Internal (24)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.rate_card_entries (id, rate_card_id, role_label, role_slug)
VALUES ('eaaa1111-0000-0000-0000-000000000024',
        'caaa1111-0000-0000-0000-000000000024', 'Compositor', 'compositor')
ON CONFLICT (id) DO NOTHING;

-- ── structure ────────────────────────────────────────────────────────────
SELECT has_function('public', 'has_rate_card_grant', ARRAY['text'],
  'has_rate_card_grant(text) exists');

SELECT has_column('public', 'workspace_members', 'grant_rate_card_view',
  'grant_rate_card_view column exists');

SELECT has_column('public', 'workspace_members', 'grant_rate_card_edit',
  'grant_rate_card_edit column exists');

SELECT has_trigger('public', 'workspace_members', 'trg_ws_members_last_admin_guard',
  'last-admin guard trigger exists');

SELECT has_trigger('public', 'projects', 'trg_projects_auto_staff',
  'auto-staff trigger exists');

-- ── probe 6: plain user without grant sees no rate entries ───────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '11111111-1111-1111-1111-111111111111'
);

SELECT is(
  (SELECT count(*)::int FROM public.rate_card_entries),
  0, 'user without grant reads no rate entries (role claim absent, grant false)');

-- ── probe 7: view grant opens reads ──────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
UPDATE public.workspace_members
   SET grant_rate_card_view = true
 WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
   AND workspace_id = '11111111-1111-1111-1111-111111111111';

SELECT tests.login_as(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '11111111-1111-1111-1111-111111111111'
);

SELECT is(
  (SELECT count(*)::int FROM public.rate_card_entries),
  1, 'view grant makes rate entries readable');

-- ── probe 8: view grant does NOT open writes ─────────────────────────────
SELECT throws_ok(
  $$INSERT INTO public.rate_card_entries (rate_card_id, role_label, role_slug)
    VALUES ('caaa1111-0000-0000-0000-000000000024', 'Animator', 'animator')$$,
  'new row violates row-level security policy for table "rate_card_entries"',
  'view grant alone cannot write rate entries');

-- ── probes 9-10: edit grant opens writes ─────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
UPDATE public.workspace_members
   SET grant_rate_card_edit = true
 WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
   AND workspace_id = '11111111-1111-1111-1111-111111111111';

SELECT tests.login_as(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '11111111-1111-1111-1111-111111111111'
);

WITH ins AS (
  INSERT INTO public.rate_card_entries (rate_card_id, role_label, role_slug)
  VALUES ('caaa1111-0000-0000-0000-000000000024', 'Animator', 'animator')
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM ins), 1,
          'edit grant can insert rate entries');

WITH upd AS (
  UPDATE public.rate_card_entries
     SET role_label = 'Senior Compositor'
   WHERE id = 'eaaa1111-0000-0000-0000-000000000024'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1,
          'edit grant can update rate entries');

-- ── probe 11: grants are not self-service ────────────────────────────────
SELECT throws_ok(
  $$UPDATE public.workspace_members
       SET grant_rate_card_view = false
     WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
       AND workspace_id = '11111111-1111-1111-1111-111111111111'$$,
  'self-grant change not allowed',
  'holder cannot flip their own grant flags');

-- ── probes 12-13: managers cannot touch grants (title still fine) ────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
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
       SET grant_rate_card_edit = false
     WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
       AND workspace_id = '11111111-1111-1111-1111-111111111111'$$,
  'managers may only edit title and department',
  'manager cannot flip grant flags');

WITH upd AS (
  UPDATE public.workspace_members
     SET title = 'Lead Compositor'
   WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
     AND workspace_id = '11111111-1111-1111-1111-111111111111'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1,
          'manager can still edit title');

-- ── probes 14-18: deactivated member w/ stale admin claims is read+write dark
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',  'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7',
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
  (SELECT count(*)::int FROM public.rate_card_entries),
  0, 'deactivated admin-claims token reads no rate entries (S9 alignment)');

SELECT is(
  (SELECT count(*)::int FROM public.projects),
  0, 'deactivated member reads no projects (S9 alignment)');

SELECT is(
  (SELECT count(*)::int FROM public.project_members),
  0, 'deactivated member reads no project roster (S9 alignment)');

SELECT is(
  (SELECT count(*)::int FROM public.workspace_members),
  1, 'deactivated member sees only their own membership row');

WITH upd AS (
  UPDATE public.workspace_members
     SET title = 'Hijacked'
   WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
     AND workspace_id = '11111111-1111-1111-1111-111111111111'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0,
          'deactivated admin-claims token cannot edit the roster (S9 alignment)');

-- ── probe 19: active member still reads projects ─────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '11111111-1111-1111-1111-111111111111'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.projects),
  'active member still reads projects after the alignment');

-- ── probes 20-22: last-admin protection ──────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
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

SELECT throws_ok(
  $$UPDATE public.workspace_members
       SET app_role = 'user'
     WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       AND workspace_id = '11111111-1111-1111-1111-111111111111'$$,
  'cannot demote or deactivate the last active admin',
  'last admin cannot be demoted');

SELECT throws_ok(
  $$UPDATE public.workspace_members
       SET is_active = false
     WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       AND workspace_id = '11111111-1111-1111-1111-111111111111'$$,
  'cannot demote or deactivate the last active admin',
  'last admin cannot be deactivated');

SELECT throws_ok(
  $$DELETE FROM public.workspace_members
     WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       AND workspace_id = '11111111-1111-1111-1111-111111111111'$$,
  'cannot demote or deactivate the last active admin',
  'last admin cannot be deleted');

-- ── probe 23: a second admin releases the guard ──────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   'user_e@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'admin', 'user_e', 'User E', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

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

WITH upd AS (
  UPDATE public.workspace_members
     SET app_role = 'user'
   WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     AND workspace_id = '11111111-1111-1111-1111-111111111111'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1,
          'demotion is allowed once a second active admin exists');

-- restore user_a's admin seat for the workspace probes below
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
UPDATE public.workspace_members
   SET app_role = 'admin'
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   AND workspace_id = '11111111-1111-1111-1111-111111111111';

-- ── probes 24-27: auto-staffing ──────────────────────────────────────────
-- The trigger deliberately skips auth-less (runner/service) inserts, so
-- these probes run as user_c — the path real clients take.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '11111111-1111-1111-1111-111111111111'
);

INSERT INTO public.projects (id, workspace_id, title, created_by, producer_id)
VALUES ('aaaa1111-0000-0000-0000-000000002401',
        '11111111-1111-1111-1111-111111111111',
        'Auto-staffed (24)',
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        'dddddddd-dddd-dddd-dddd-dddddddddddd');

SELECT is(
  (SELECT count(*)::int FROM public.project_members
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000002401'),
  2, 'creator + producer are auto-seated on project insert');

SELECT is(
  (SELECT count(*)::int FROM public.project_members
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000002401'
      AND project_role = 'manager'),
  2, 'auto-staffed seats are project managers');

UPDATE public.projects
   SET producer_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
 WHERE id = 'aaaa1111-0000-0000-0000-000000002401';

SELECT is(
  (SELECT count(*)::int FROM public.project_members
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000002401'),
  3, 'producer change seats the new producer (existing seats kept)');

INSERT INTO public.projects (id, workspace_id, title, created_by, producer_id)
VALUES ('aaaa1111-0000-0000-0000-000000002402',
        '11111111-1111-1111-1111-111111111111',
        'Ghost producer (24)',
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        '99999999-9999-9999-9999-999999999999');

SELECT is(
  (SELECT count(*)::int FROM public.project_members
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000002402'),
  1, 'non-member producer is skipped silently (creator still seated)');

-- ── probes 28-30: workspace admin writes ─────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
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

WITH upd AS (
  UPDATE public.workspaces
     SET name = 'Workspace A (renamed)'
   WHERE id = '11111111-1111-1111-1111-111111111111'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1,
          'admin can rename their workspace');

SELECT throws_ok(
  $$UPDATE public.workspaces
       SET slug = 'ws-a-renamed'
     WHERE id = '11111111-1111-1111-1111-111111111111'$$,
  'workspace slug is immutable',
  'workspace slug cannot be changed from the client');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '11111111-1111-1111-1111-111111111111'
);

WITH upd AS (
  UPDATE public.workspaces
     SET name = 'Hijacked Workspace'
   WHERE id = '11111111-1111-1111-1111-111111111111'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0,
          'non-admin cannot rename the workspace');

-- ── probe 31: directory exposes grant columns ────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
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

SELECT ok(
  (SELECT d.grant_rate_card_edit
     FROM public.workspace_directory() d
    WHERE d.user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'workspace_directory returns the grant columns');

-- ── probe 32: operator bypass GUC (kept LAST — the GUC persists to txn end)
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
-- Remove the second admin (allowed: user_a remains), then bypass-demote the
-- genuinely-last admin to prove the operator escape hatch works.
DELETE FROM public.workspace_members
 WHERE user_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
   AND workspace_id = '11111111-1111-1111-1111-111111111111';

SELECT set_config('wilson.bypass_last_admin_guard', 'on', true);

WITH upd AS (
  UPDATE public.workspace_members
     SET app_role = 'user'
   WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     AND workspace_id = '11111111-1111-1111-1111-111111111111'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1,
          'wilson.bypass_last_admin_guard=on lets operator tooling through');

SELECT * FROM finish();
ROLLBACK;
