-- pgTAP: soft delete + undo + retention purge (Session 6, migration 0014)
--
-- Guards the trash semantics: a one-row soft delete hides the whole
-- subtree via the live-parent SELECT policies (no propagation writes),
-- and BOTH trash directions happen only through the SECURITY DEFINER
-- RPCs (soft_delete_row / restore_soft_deleted): SELECT policies apply
-- to both sides of an UPDATE that reads the table, so a plain client
-- UPDATE can neither set deleted_at (new row turns invisible → RLS
-- violation) nor clear it (old row is already invisible → 0-row no-op).
-- fn_soft_delete_stamp stamps/clears deleted_by, the projects transition
-- is admin-only, and purge_soft_deleted() hard-deletes expired rows
-- (service-side only).

BEGIN;
SELECT plan(30);

SELECT * FROM tests.rls_setup();

-- Seed a 'manager' (user_d) in ws_a — same ids as 17_edit_history.sql;
-- only the manager persona is needed here (the projects-guard probe).
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

-- One row of every soft-delete flavor under project_a (as the test
-- runner — RLS bypassed), plus a scratch project + child for the purge.
INSERT INTO public.assets (id, project_id, name)
VALUES ('aaaa1111-0000-0000-0000-00000000aa01',
        'aaaa1111-0000-0000-0000-000000000001', 'Asset A');

INSERT INTO public.tasks (id, asset_id, project_id, title)
VALUES ('aaaa1111-0000-0000-0000-00000000cc01',
        'aaaa1111-0000-0000-0000-00000000aa01',
        'aaaa1111-0000-0000-0000-000000000001', 'Task A');

INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
VALUES ('aaaa1111-0000-0000-0000-00000000ff01',
        'aaaa1111-0000-0000-0000-000000000001',
        'a.txt', 'supabase', 'projects/a/a.txt');

INSERT INTO public.comments (id, entity_type, entity_id, body)
VALUES ('aaaa1111-0000-0000-0000-0000000c0001', 'asset',
        'aaaa1111-0000-0000-0000-00000000aa01', 'note on Asset A');

INSERT INTO public.phases (id, project_id, name)
VALUES ('aaaa1111-0000-0000-0000-000000000a01',
        'aaaa1111-0000-0000-0000-000000000001', 'Phase A');

INSERT INTO public.rate_cards (id, workspace_id, name)
VALUES ('aaaa1111-0000-0000-0000-000000000e01',
        '11111111-1111-1111-1111-111111111111', 'RC A');

INSERT INTO public.projects (id, workspace_id, title, created_by)
VALUES ('aaaa1111-0000-0000-0000-000000000701',
        '11111111-1111-1111-1111-111111111111',
        'Purge Scratch', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

INSERT INTO public.assets (id, project_id, name)
VALUES ('aaaa1111-0000-0000-0000-00000000a701',
        'aaaa1111-0000-0000-0000-000000000701', 'Purge Asset');

-- ── probes 1-6: asset soft delete — RPC-only, hidden, transitive, stamped ─
SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

-- A raw UPDATE cannot soft-delete: the NEW row (deleted_at set) fails
-- the SELECT policies applied to the update's read side.
SELECT throws_ok(
  $$UPDATE public.assets SET deleted_at = now()
     WHERE id = 'aaaa1111-0000-0000-0000-00000000aa01'$$,
  'new row violates row-level security policy for table "assets"',
  'plain UPDATE cannot soft-delete — new row would be invisible'
);

SELECT ok(
  public.soft_delete_row('assets', 'aaaa1111-0000-0000-0000-00000000aa01'),
  'the soft-delete RPC sets deleted_at'
);

SELECT is(
  (SELECT count(*)::int FROM public.assets
    WHERE id = 'aaaa1111-0000-0000-0000-00000000aa01'),
  0, 'soft-deleted asset disappears from SELECT'
);

SELECT is(
  (SELECT count(*)::int FROM public.tasks
    WHERE id = 'aaaa1111-0000-0000-0000-00000000cc01'),
  0, 'tasks under a soft-deleted asset are hidden transitively'
);

-- Physical checks run as the test runner.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.assets
    WHERE id = 'aaaa1111-0000-0000-0000-00000000aa01'),
  1, 'the soft-deleted row is still physically present'
);

SELECT is(
  (SELECT deleted_by FROM public.assets
    WHERE id = 'aaaa1111-0000-0000-0000-00000000aa01'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'deleted_by is stamped to the acting user'
);

-- ── probes 7-10: restore — RPC-only, one-row un-hide, stamp cleared ──────
SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

-- A plain UPDATE cannot even target the hidden row (SELECT policies
-- apply to its WHERE clause) — it must no-op, not restore.
UPDATE public.assets SET deleted_at = NULL
 WHERE id = 'aaaa1111-0000-0000-0000-00000000aa01';

SELECT is(
  (SELECT count(*)::int FROM public.tasks
    WHERE id = 'aaaa1111-0000-0000-0000-00000000cc01'),
  0, 'plain UPDATE restore is a silent no-op — row stays hidden'
);

SELECT ok(
  public.restore_soft_deleted('assets', 'aaaa1111-0000-0000-0000-00000000aa01'),
  'the restore RPC clears deleted_at'
);

SELECT is(
  (SELECT count(*)::int FROM public.tasks
    WHERE id = 'aaaa1111-0000-0000-0000-00000000cc01'),
  1, 'restore surfaces the subtree again'
);

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT deleted_by FROM public.assets
    WHERE id = 'aaaa1111-0000-0000-0000-00000000aa01'),
  NULL::uuid,
  'deleted_by clears on restore'
);

-- ── probes 11-17: project soft delete hides the whole subtree ────────────
-- The projects transition is admin-gated by fn_soft_delete_stamp, so use
-- inline admin claims (17_edit_history.sql pattern).
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
  public.soft_delete_row('projects', 'aaaa1111-0000-0000-0000-000000000001'),
  'admin soft-deletes the project via the RPC'
);

SELECT is(
  (SELECT count(*)::int FROM public.projects
    WHERE id = 'aaaa1111-0000-0000-0000-000000000001'),
  0, 'soft-deleted project leaves SELECT'
);

SELECT is(
  (SELECT count(*)::int FROM public.assets
    WHERE id = 'aaaa1111-0000-0000-0000-00000000aa01'),
  0, 'project soft delete hides assets transitively'
);

SELECT is(
  (SELECT count(*)::int FROM public.tasks
    WHERE id = 'aaaa1111-0000-0000-0000-00000000cc01'),
  0, '... and their tasks'
);

SELECT is(
  (SELECT count(*)::int FROM public.files
    WHERE id = 'aaaa1111-0000-0000-0000-00000000ff01'),
  0, '... and files'
);

SELECT is(
  (SELECT count(*)::int FROM public.comments
    WHERE id = 'aaaa1111-0000-0000-0000-0000000c0001'),
  0, '... and comments'
);

SELECT is(
  (SELECT count(*)::int FROM public.phases
    WHERE id = 'aaaa1111-0000-0000-0000-000000000a01'),
  0, '... and phases'
);

-- ── probes 18-20: project restore (RPC) surfaces the subtree ─────────────
-- Still under the inline admin claims from the previous section.
SELECT ok(
  public.restore_soft_deleted('projects', 'aaaa1111-0000-0000-0000-000000000001'),
  'admin restores the project via the RPC'
);

SELECT is(
  (SELECT count(*)::int FROM public.tasks
    WHERE id = 'aaaa1111-0000-0000-0000-00000000cc01'),
  1, 'project restore surfaces the whole subtree'
);

SELECT is(
  (SELECT count(*)::int FROM public.comments
    WHERE id = 'aaaa1111-0000-0000-0000-0000000c0001'),
  1, 'comments reappear too'
);

-- ── probe 21: projects guard — manager cannot soft-delete ────────────────
-- Raw UPDATE on purpose: the stamp trigger fires (and raises) BEFORE the
-- new-row visibility check, so the guard message is what surfaces.
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
  $$UPDATE public.projects SET deleted_at = now()
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'only workspace admins can delete or restore projects',
  'app manager cannot soft-delete a project'
);

-- ── probes 22-25: comments + rate cards soft-delete via RPC ──────────────
SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

SELECT ok(
  public.soft_delete_row('comments', 'aaaa1111-0000-0000-0000-0000000c0001'),
  'comment soft-deletes via the RPC'
);

SELECT is(
  (SELECT count(*)::int FROM public.comments
    WHERE id = 'aaaa1111-0000-0000-0000-0000000c0001'),
  0, 'soft-deleted comment is hidden'
);

SELECT ok(
  public.soft_delete_row('rate_cards', 'aaaa1111-0000-0000-0000-000000000e01'),
  'rate card soft-deletes via the RPC'
);

SELECT is(
  (SELECT count(*)::int FROM public.rate_cards
    WHERE id = 'aaaa1111-0000-0000-0000-000000000e01'),
  0, 'soft-deleted rate card is hidden'
);

-- ── probe 26: cross-workspace restore is refused ─────────────────────────
SELECT tests.login_as(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '22222222-2222-2222-2222-222222222222'
);

SELECT throws_ok(
  $$SELECT public.restore_soft_deleted('comments', 'aaaa1111-0000-0000-0000-0000000c0001')$$,
  'not allowed to soft-delete or restore this row',
  'a member of another workspace cannot restore the comment'
);

-- ── probes 27-29: retention purge hard-deletes expired subtrees ──────────
-- Backdate the scratch project past the 30-day window as the runner
-- (auth.uid() is NULL, so the admin guard does not fire).
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

UPDATE public.projects
   SET deleted_at = now() - INTERVAL '40 days'
 WHERE id = 'aaaa1111-0000-0000-0000-000000000701';

SELECT ok(
  public.purge_soft_deleted() >= 1,
  'purge reports expired rows removed'
);

SELECT is(
  (SELECT count(*)::int FROM public.projects
    WHERE id = 'aaaa1111-0000-0000-0000-000000000701'),
  0, 'expired project is physically gone'
);

SELECT is(
  (SELECT count(*)::int FROM public.assets
    WHERE id = 'aaaa1111-0000-0000-0000-00000000a701'),
  0, 'purge cascades to never-soft-deleted children'
);

-- ── probe 30: purge is locked away from clients ──────────────────────────
SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

SELECT throws_ok(
  $$SELECT public.purge_soft_deleted()$$,
  'permission denied for function purge_soft_deleted',
  'clients cannot run the purge sweep'
);

SELECT * FROM finish();
ROLLBACK;
