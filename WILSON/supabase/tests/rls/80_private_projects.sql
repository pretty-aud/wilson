-- =============================================================================
-- 80_private_projects.sql — Demo 2026-09-11: private projects (migration 0072).
--
-- What this pins:
--   * The column: projects.is_private, NOT NULL, default false — an existing
--     project is not private.
--   * The policy: projects_select reads is_private.
--   * Visibility: a manager's private project is visible to the manager and
--     to the workspace admin, and INVISIBLE to a plain member of the same
--     workspace — who still sees the workspace's ordinary projects.
--   * The child hop: a files row on the private project (storage_provider
--     'local_server', the desktop's own disk) is visible to the owner and
--     invisible to the member, with NO change to files_select.
--   * The member cannot update what they cannot see (0014: SELECT applies to
--     both sides of an UPDATE).
--   * MO1 (2026-11-04, migration 0110): the personal space. One per person per
--     company (a second call returns it; a row seeded first is the one
--     returned); private, its owner its creator, one seat (the owner's, as
--     manager); read by its owner and the company's admins only; written by its
--     owner only, admins included (a task, the four helpers, presigning); never
--     handed over, shared, binned, refoldered or given a producer; no client
--     INSERT names an owner; a deactivated owner cannot make one, and the admin
--     still reads it.
--
-- Postgres-side reads are ALWAYS scoped to the fixture rows — dev carries
-- real projects (S33, 439f702).
-- =============================================================================

BEGIN;

SELECT plan(47);

SELECT * FROM tests.rls_setup();

-- user_c: plain 'user'-role ACTIVE member of workspace A (suite 59's shape).
-- user_d: 'manager' of workspace A — may insert projects (projects_insert).
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
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','user','user_c','User C',true),
  ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','manager','user_d','User D',true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- ── structure ───────────────────────────────────────────────────────────────

SELECT has_column('public', 'projects', 'is_private', 'projects.is_private exists');
SELECT col_not_null('public', 'projects', 'is_private', 'projects.is_private is NOT NULL');
SELECT col_default_is('public', 'projects', 'is_private', 'false', 'projects.is_private defaults to false');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'projects'
             AND policyname = 'projects_select' AND position('is_private' IN qual) > 0),
  'projects_select reads is_private');

-- ── the manager makes a private project ─────────────────────────────────────
-- Claims in the JWT's own shape (suite 59): current_app_role() reads
-- app_metadata.app_role from the claims, not from workspace_members, and
-- tests.login_as does not set it — a manager without it is refused by
-- projects_insert. set_config rather than tests.login_as for every switch,
-- because once the role is `authenticated` the tests schema is off limits.
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','dddddddd-dddd-dddd-dddd-dddddddddddd','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','manager')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT lives_ok($$
  INSERT INTO public.projects (id, workspace_id, title, is_private)
  VALUES ('aaaa1111-0000-0000-0000-000000000072',
          '11111111-1111-1111-1111-111111111111', 'Private P', true)
$$, 'a manager can insert a private project');

SELECT is(
  (SELECT count(*) FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000072'),
  1::bigint, 'the owner sees their private project');

SELECT lives_ok($$
  INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial)
  VALUES ('aaaa1111-0000-0000-0000-0000000072f1',
          'aaaa1111-0000-0000-0000-000000000072', 'clip.mov', 'local_server',
          'projects/aaaa1111-0000-0000-0000-000000000072/assets/a1/10-clip.mov', false)
$$, 'the owner files a local_server media row on the private project');

SELECT is(
  (SELECT count(*) FROM public.files WHERE project_id = 'aaaa1111-0000-0000-0000-000000000072'),
  1::bigint, 'the owner sees the private project''s file row');

-- ── the plain member sees none of it, and everything else ───────────────────
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','cccccccc-cccc-cccc-cccc-cccccccccccc','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','user')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT is(
  (SELECT count(*) FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000072'),
  0::bigint, 'a plain member does not see the private project');

SELECT is(
  (SELECT count(*) FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000001'),
  1::bigint, 'the plain member still sees the workspace''s ordinary project');

SELECT is(
  (SELECT count(*) FROM public.files WHERE project_id = 'aaaa1111-0000-0000-0000-000000000072'),
  0::bigint, 'the private project''s file row is hidden by the live-parent hop, with no files_select change');

-- A data-modifying CTE may only sit at the top level of a statement, so the
-- update runs on its own (0 rows, no error) and the admin reads the title
-- back below.
UPDATE public.projects SET title = 'renamed by a member'
 WHERE id = 'aaaa1111-0000-0000-0000-000000000072';

-- ── the admin keeps the escape hatch ────────────────────────────────────────
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT is(
  (SELECT count(*) FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000072'),
  1::bigint, 'the workspace admin sees the private project');

SELECT is(
  (SELECT is_private FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000001'),
  false, 'an ordinary project is not private (the default)');

SELECT is(
  (SELECT created_by FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000072'),
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  'the owner is the inserting caller, stamped by fn_audit_touch — no client can name another');

SELECT is(
  (SELECT title FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000072'),
  'Private P', 'the plain member could not update what they cannot see (0014: SELECT applies to both sides of an UPDATE)');

-- ═════════════════════════════════════════════════════════════════════════
-- MO1 (2026-11-04, migration 0110): the personal space. user_c (an app 'user')
-- owns one; user_d is a manager, user_a the admin, user_b another company's
-- member given the admin role in the claims. The space's id travels in a
-- custom setting, which every role may read.
-- ═════════════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

CREATE FUNCTION pg_temp.act_as(p_uid UUID, p_app_role TEXT, p_ws UUID DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_uid, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_app_role))::text, true);
  PERFORM set_config('role', 'authenticated', true);
END;
$$;

SELECT pg_temp.act_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user');
SELECT ok(set_config('test.ps_c', COALESCE(public.ensure_personal_space()::text, ''), true) <> '',
  'an app-role user gets a personal space'); -- 16
SELECT is(public.ensure_personal_space()::text, current_setting('test.ps_c'),
  'a second call returns the same space'); -- 17
SELECT is((SELECT count(*) FROM public.projects WHERE id = current_setting('test.ps_c')::uuid), 1::bigint,
  'the owner sees their personal space'); -- 18
SELECT lives_ok($$
  INSERT INTO public.tasks (id, workspace_id, project_id, title)
  VALUES ('80800000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111',
          current_setting('test.ps_c')::uuid, 'The owner''s task')
$$, 'the owner writes in their space (a task)'); -- 19
SELECT lives_ok($$
  INSERT INTO public.expenses (id, workspace_id, project_id)
  VALUES ('80800000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111', current_setting('test.ps_c')::uuid)
$$, 'the owner writes their space''s money (an expense: their manager seat opens the money gate)'); -- 19b
SELECT ok(public.can_write_project(current_setting('test.ps_c')::uuid)
          AND public.can_comment_project(current_setting('test.ps_c')::uuid)
          AND public.can_edit_shot_lists(current_setting('test.ps_c')::uuid)
          AND NOT public.can_manage_project_roster(current_setting('test.ps_c')::uuid),
  'the owner may write, comment and edit shot lists in their space, and manages no roster'); -- 20
SELECT throws_ok($$
  UPDATE public.projects SET personal_owner_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
   WHERE id = current_setting('test.ps_c')::uuid
$$, '42501', NULL, 'a personal space keeps its owner'); -- 21
SELECT throws_ok($$
  UPDATE public.projects SET is_private = false WHERE id = current_setting('test.ps_c')::uuid
$$, '42501', NULL, 'its owner cannot share it'); -- 22
SELECT throws_ok($$
  SELECT public.soft_delete_row('projects', current_setting('test.ps_c')::uuid)
$$, '42501', NULL, 'its owner cannot put it in the bin (soft_delete_row is a client-called definer: still bound)'); -- 23
SELECT throws_ok($$
  UPDATE public.projects SET folder_slug = 'Somewhere' WHERE id = current_setting('test.ps_c')::uuid
$$, '42501', NULL, 'its folder is pinned'); -- 24
SELECT throws_ok($$
  UPDATE public.projects SET deleted_at = now() WHERE id = current_setting('test.ps_c')::uuid
$$, '42501', NULL, 'its owner cannot bin it by a plain UPDATE either (the owner guard''s arm)'); -- 24b
SELECT throws_ok($$
  UPDATE public.projects SET producer_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
   WHERE id = current_setting('test.ps_c')::uuid
$$, '42501', NULL, 'nobody chooses a producer for a personal space (its roster is nobody''s)'); -- 25
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT ok((SELECT is_private AND created_by = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
                  AND personal_owner_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
                  AND title = 'Personal space' AND folder_slug IS NULL AND folder_root IS NULL
             FROM public.projects WHERE id = current_setting('test.ps_c')::uuid),
  'the space is private, its owner its creator, titled Personal space, with no folder'); -- 26
SELECT is((SELECT string_agg(user_id::text || ':' || project_role, ',') FROM public.project_members
            WHERE project_id = current_setting('test.ps_c')::uuid),
  'cccccccc-cccc-cccc-cccc-cccccccccccc:manager', 'it has one seat, its owner''s, as manager'); -- 27

SELECT pg_temp.act_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager');
SELECT is((SELECT count(*) FROM public.projects WHERE id = current_setting('test.ps_c')::uuid), 0::bigint,
  'a manager reads nothing of someone else''s space'); -- 28
SELECT throws_ok($$
  INSERT INTO public.projects (id, workspace_id, title, is_private, personal_owner_id)
  VALUES ('80800000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111',
          'Made by hand', true, 'dddddddd-dddd-dddd-dddd-dddddddddddd')
$$, '42501', NULL, 'no client INSERT names an owner (projects_insert: personal_owner_id IS NULL)'); -- 29
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- A space seeded first (the service's shape) is the one returned (the early
-- return; the ON CONFLICT branch needs a second session racing it, which a
-- one-transaction suite cannot make: the unique index below is what it
-- relies on).
INSERT INTO public.projects (id, workspace_id, title, is_private, personal_owner_id, created_by)
VALUES ('80800000-0000-0000-0000-0000000000d2', '11111111-1111-1111-1111-111111111111', 'Personal space',
        true, 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
SELECT pg_temp.act_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager');
SELECT is(public.ensure_personal_space(), '80800000-0000-0000-0000-0000000000d2'::uuid,
  'a space that already exists is returned, never a second one'); -- 30
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT throws_ok($$
  INSERT INTO public.projects (id, workspace_id, title, is_private, personal_owner_id, created_by)
  VALUES ('80800000-0000-0000-0000-0000000000d3', '11111111-1111-1111-1111-111111111111', 'A second space',
          true, 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'dddddddd-dddd-dddd-dddd-dddddddddddd')
$$, '23505', NULL, 'one personal space per person per company, even for the service (projects_personal_owner_uniq)'); -- 30b
SELECT is((SELECT count(*)::int FROM public.projects
            WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
              AND personal_owner_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  1, 'after two calls the owner has exactly one space'); -- 30c

SELECT pg_temp.act_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222');
SELECT is((SELECT count(*) FROM public.projects WHERE id = current_setting('test.ps_c')::uuid), 0::bigint,
  'another company''s admin reads nothing of it'); -- 31
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT pg_temp.act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin');
SELECT is((SELECT count(*) FROM public.projects WHERE id = current_setting('test.ps_c')::uuid), 1::bigint,
  'the company''s admin reads it'); -- 32
SELECT throws_ok($$
  INSERT INTO public.tasks (id, workspace_id, project_id, title)
  VALUES ('80800000-0000-0000-0000-0000000000b2', '11111111-1111-1111-1111-111111111111',
          current_setting('test.ps_c')::uuid, 'An admin''s task')
$$, '42501', NULL, 'the admin writes nothing in it (can_write_project''s personal arm)'); -- 33
SELECT ok(NOT public.can_write_project(current_setting('test.ps_c')::uuid)
          AND NOT public.can_comment_project(current_setting('test.ps_c')::uuid)
          AND NOT public.can_edit_shot_lists(current_setting('test.ps_c')::uuid)
          AND NOT public.can_manage_project_roster(current_setting('test.ps_c')::uuid)
          AND NOT COALESCE(public.can_presign_project_write(current_setting('test.ps_c')::uuid), false),
  'for the admin every write helper, and presigning an upload, says no'); -- 34
SELECT throws_ok($$
  INSERT INTO public.expenses (id, workspace_id, project_id)
  VALUES ('80800000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111', current_setting('test.ps_c')::uuid)
$$, '42501', 'Only the owner of a personal space can change it.',
  'the admin writes none of its money either (the money gate admits admins; fn_personal_space_write_guard does not)'); -- 34b
SELECT throws_ok($$
  DELETE FROM public.expenses WHERE id = '80800000-0000-0000-0000-0000000000e1'
$$, '42501', 'Only the owner of a personal space can change it.',
  'nor deletes the owner''s expense'); -- 34c
SELECT throws_ok($$
  INSERT INTO storage.objects (bucket_id, name)
  VALUES ('rabbit-files', 'projects/' || current_setting('test.ps_c') || '/INVOICES/admin.pdf')
$$, '42501', NULL, 'nor stores an invoice in it (the money storage write gate, 0110)'); -- 34d
SELECT throws_ok($$
  SELECT public.soft_delete_row('projects', current_setting('test.ps_c')::uuid)
$$, 'P0001', 'not allowed to soft-delete or restore this row',
  'the admin cannot put someone else''s personal space in the bin (fn_trash_authz, through can_write_project''s personal arm)'); -- 35
UPDATE public.projects SET title = 'Renamed by an admin' WHERE id = current_setting('test.ps_c')::uuid;
DELETE FROM public.projects WHERE id = current_setting('test.ps_c')::uuid;
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is((SELECT title FROM public.projects WHERE id = current_setting('test.ps_c')::uuid), 'Personal space',
  'the admin''s UPDATE and DELETE reached nothing: the space is there, unrenamed'); -- 36
SELECT is((SELECT count(*) FROM public.project_members WHERE project_id = current_setting('test.ps_c')::uuid), 1::bigint,
  'still one seat after the producer attempt'); -- 37
SELECT throws_ok($$
  UPDATE public.projects SET is_private = false WHERE id = current_setting('test.ps_c')::uuid
$$, '23514', NULL, 'even unbound, a personal row cannot be made shared (projects_personal_shape_chk)'); -- 38

UPDATE public.workspace_members SET is_active = false
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
SELECT pg_temp.act_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user');
SELECT throws_ok($$ SELECT public.ensure_personal_space() $$, '42501', NULL,
  'a deactivated member gets no personal space'); -- 39
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin');
SELECT is((SELECT count(*) FROM public.projects WHERE id = current_setting('test.ps_c')::uuid), 1::bigint,
  'the admin still reads a deactivated member''s space'); -- 40
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
