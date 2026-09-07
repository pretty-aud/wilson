-- pgTAP: edit_history capture, RLS, append-only posture + retention
-- (Session 5, migration 0012)
--
-- Guards the four properties the session's exit criteria name: every RABBIT
-- mutation writes a history row with actor + diff; rows are workspace-scoped
-- and invisible below manager; the table is append-only for clients; the
-- 90-day sweep works.

BEGIN;
SELECT plan(19);

SELECT * FROM tests.rls_setup();

-- Seed a plain 'user' (user_c) and a 'manager' (user_d) in ws_a — same
-- fixture block as 16_member_directory.sql.
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

-- Assets in both workspaces (as the test runner: actor NULL, but the ws_b
-- row gives the cross-workspace probes something that could leak).
INSERT INTO public.assets (id, project_id, name) VALUES
  ('aaaa1111-0000-0000-0000-00000000aa01', 'aaaa1111-0000-0000-0000-000000000001', 'Asset A'),
  ('bbbb2222-0000-0000-0000-00000000bb01', 'bbbb2222-0000-0000-0000-000000000001', 'Asset B');

-- ── probes 1-3: INSERT is captured with actor + label ────────────────────
-- user_c is a plain 'user': below-manager members WRITE history, they just
-- can't read it (probe 12).
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

INSERT INTO public.tasks (id, asset_id, project_id, title)
VALUES ('aaaa1111-0000-0000-0000-00000000cc01',
        'aaaa1111-0000-0000-0000-00000000aa01',
        'aaaa1111-0000-0000-0000-000000000001', 'Comp shot 010');

-- Assertions run as the test runner: the SELECT policy is manager+, probed
-- separately below.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.edit_history
    WHERE entity_type = 'tasks'
      AND entity_id = 'aaaa1111-0000-0000-0000-00000000cc01'
      AND action = 'create'),
  1,
  'task INSERT writes exactly one create history row'
);

SELECT is(
  (SELECT actor_user_id FROM public.edit_history
    WHERE entity_type = 'tasks'
      AND entity_id = 'aaaa1111-0000-0000-0000-00000000cc01'
      AND action = 'create'),
  'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
  'history row records the acting user'
);

SELECT is(
  (SELECT actor_label FROM public.edit_history
    WHERE entity_type = 'tasks'
      AND entity_id = 'aaaa1111-0000-0000-0000-00000000cc01'
      AND action = 'create'),
  'User C',
  'actor display name is captured at write time'
);

-- ── probes 4-6: UPDATE diff shape ────────────────────────────────────────
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

UPDATE public.tasks
   SET title = 'Comp shot 011'
 WHERE id = 'aaaa1111-0000-0000-0000-00000000cc01';

-- No-op write: only the audit-touch columns move, so no history row.
UPDATE public.tasks
   SET title = title
 WHERE id = 'aaaa1111-0000-0000-0000-00000000cc01';

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT diff -> 'title' ->> 'new' FROM public.edit_history
    WHERE entity_type = 'tasks'
      AND entity_id = 'aaaa1111-0000-0000-0000-00000000cc01'
      AND action = 'update'),
  'Comp shot 011',
  'update diff records old -> new per changed field'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.edit_history
     WHERE entity_type = 'tasks'
       AND entity_id = 'aaaa1111-0000-0000-0000-00000000cc01'
       AND action = 'update'
       AND (diff ? 'updated_at' OR diff ? 'updated_by'
            OR diff ? 'last_updated_at' OR diff ? 'last_updated_by')),
  'noise columns (updated_at/by, last_updated_at/by) never appear in diffs'
);

SELECT is(
  (SELECT count(*)::int FROM public.edit_history
    WHERE entity_type = 'tasks'
      AND entity_id = 'aaaa1111-0000-0000-0000-00000000cc01'
      AND action = 'update'),
  1,
  'touch-only update writes no history row'
);

-- ── probe 7: parent-join tables resolve workspace_id ─────────────────────
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

INSERT INTO public.task_links (id, task_id, url)
VALUES ('aaaa1111-0000-0000-0000-00000000ab01',
        'aaaa1111-0000-0000-0000-00000000cc01', 'https://a.example');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT workspace_id FROM public.edit_history
    WHERE entity_type = 'task_links'
      AND entity_id = 'aaaa1111-0000-0000-0000-00000000ab01'
      AND action = 'create'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'task_links (no workspace_id column) resolves workspace via the parent task'
);

-- ── probes 8-9: DELETE + cascade capture ─────────────────────────────────
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

DELETE FROM public.tasks
 WHERE id = 'aaaa1111-0000-0000-0000-00000000cc01';

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT diff -> 'old' ->> 'title' FROM public.edit_history
    WHERE entity_type = 'tasks'
      AND entity_id = 'aaaa1111-0000-0000-0000-00000000cc01'
      AND action = 'delete'),
  'Comp shot 011',
  'task DELETE writes a delete row with the old snapshot'
);

-- The task_links row went with it via ON DELETE CASCADE. By the time its
-- AFTER DELETE trigger fires the parent task is gone, so the capture
-- function falls back to the caller''s workspace claim.
SELECT is(
  (SELECT workspace_id FROM public.edit_history
    WHERE entity_type = 'task_links'
      AND entity_id = 'aaaa1111-0000-0000-0000-00000000ab01'
      AND action = 'delete'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'cascade-deleted children are captured via the claim fallback'
);

-- ── probes 10-13: read scoping (admin/manager only, own workspace) ───────
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

SELECT ok(
  (SELECT count(*) FROM public.edit_history) > 0,
  'manager sees their workspace''s history'
);

-- Asset B's create row exists (seeded above) but belongs to ws_b.
SELECT is(
  (SELECT count(*)::int FROM public.edit_history
    WHERE workspace_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'history never leaks rows from other workspaces'
);

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
  (SELECT count(*)::int FROM public.edit_history),
  0,
  'below-manager roles cannot read history'
);

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

SELECT ok(
  (SELECT count(*) FROM public.edit_history) > 0,
  'admin sees their workspace''s history'
);

-- ── probes 14-17: append-only for clients, purge locked down ─────────────
-- Still authenticated (admin claims — the strongest client role, so these
-- prove NO client can write, not just plain users).
-- NB: message form, per house convention. A 5-byte second argument would be
-- dispatched as an SQLSTATE and turn the description into an expected errmsg.
SELECT throws_ok(
  $$INSERT INTO public.edit_history
      (workspace_id, entity_type, entity_id, action, diff)
    VALUES ('11111111-1111-1111-1111-111111111111', 'tasks',
            'aaaa1111-0000-0000-0000-00000000cc01', 'create', '{}'::jsonb)$$,
  'permission denied for table edit_history',
  'clients cannot INSERT history rows'
);

SELECT throws_ok(
  $$UPDATE public.edit_history SET actor_label = 'forged'$$,
  'permission denied for table edit_history',
  'clients cannot UPDATE history rows'
);

SELECT throws_ok(
  $$DELETE FROM public.edit_history$$,
  'permission denied for table edit_history',
  'clients cannot DELETE history rows'
);

SELECT throws_ok(
  $$SELECT public.purge_edit_history()$$,
  'permission denied for function purge_edit_history',
  'clients cannot run the retention sweep'
);

-- ── probes 18-19: 90-day retention sweep ─────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- Backdate the oldest row past the retention window.
UPDATE public.edit_history
   SET created_at = now() - INTERVAL '91 days'
 WHERE id = (SELECT min(id) FROM public.edit_history);

SELECT is(
  public.purge_edit_history(),
  1::bigint,
  'purge removes exactly the rows older than 90 days'
);

SELECT ok(
  (SELECT count(*) FROM public.edit_history) > 0,
  'recent rows survive the purge'
);

SELECT * FROM finish();
ROLLBACK;
