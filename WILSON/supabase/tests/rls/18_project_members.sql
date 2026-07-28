-- pgTAP: project_members roster RLS + project-role gating
-- (Session 6, migration 0013)
--
-- Guards the project-level role matrix: roster visibility and who may
-- manage seats, the composite FK back to workspace_members, the
-- can_write_project() truth table across staffing states, end-to-end
-- entity enforcement on a staffed project, and the projects INSERT/DELETE
-- matrix-parity tightening. All staffing happens on a scratch project
-- seeded here — project_a stays unstaffed, as every other suite assumes.

BEGIN;
SELECT plan(25);

SELECT * FROM tests.rls_setup();

-- Seed a plain 'user' (user_c) and a 'manager' (user_d) in ws_a — same
-- fixture block as 17_edit_history.sql — plus two more plain users
-- (user_e, user_f) to hold project seats: app admin/manager bypass the
-- project gate, so staffed-state probes need app_role-'user' personas.
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
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   'user_e@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now()),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff',
   'user_f@test.local', crypt('testpw', gen_salt('bf')), now(),
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
   'manager', 'user_d', 'User D', true),
  ('11111111-1111-1111-1111-111111111111',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   'user', 'user_e', 'User E', true),
  ('11111111-1111-1111-1111-111111111111',
   'ffffffff-ffff-ffff-ffff-ffffffffffff',
   'user', 'user_f', 'User F', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- Scratch project + asset + task in ws_a (as the test runner — RLS
-- bypassed) for the staffed-state probes.
INSERT INTO public.projects (id, workspace_id, title, created_by)
VALUES ('aaaa1111-0000-0000-0000-000000000501',
        '11111111-1111-1111-1111-111111111111',
        'Staffing Scratch', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

INSERT INTO public.assets (id, project_id, name)
VALUES ('aaaa1111-0000-0000-0000-00000000a501',
        'aaaa1111-0000-0000-0000-000000000501', 'Scratch Asset');

INSERT INTO public.tasks (id, asset_id, project_id, title)
VALUES ('aaaa1111-0000-0000-0000-00000000c501',
        'aaaa1111-0000-0000-0000-00000000a501',
        'aaaa1111-0000-0000-0000-000000000501', 'Scratch Task');

-- An asset under (unstaffed) project_a for the cross-project move probe.
INSERT INTO public.assets (id, project_id, name)
VALUES ('aaaa1111-0000-0000-0000-00000000a5a1',
        'aaaa1111-0000-0000-0000-000000000001', 'Movable Asset');

-- ── probes 1-2: unstaffed state — open writes, closed roster ─────────────
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

SELECT is(
  public.can_write_project('aaaa1111-0000-0000-0000-000000000501'),
  true,
  'unstaffed project is writable by any active member'
);

SELECT throws_ok(
  $$INSERT INTO public.project_members (project_id, user_id, project_role)
    VALUES ('aaaa1111-0000-0000-0000-000000000501',
            'cccccccc-cccc-cccc-cccc-cccccccccccc', 'member')$$,
  'new row violates row-level security policy for table "project_members"',
  'plain member cannot create the first seat'
);

-- ── probes 3-5: who may staff — app admin, app manager, project manager ──
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

-- workspace_id deliberately omitted — the BEFORE INSERT trigger derives it.
INSERT INTO public.project_members (project_id, user_id, project_role)
VALUES ('aaaa1111-0000-0000-0000-000000000501',
        'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'manager');

SELECT is(
  (SELECT project_role FROM public.project_members
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000000501'
      AND user_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  'manager',
  'app admin can seat a project manager'
);

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

INSERT INTO public.project_members (project_id, user_id, project_role)
VALUES ('aaaa1111-0000-0000-0000-000000000501',
        'ffffffff-ffff-ffff-ffff-ffffffffffff', 'reviewer');

SELECT is(
  (SELECT project_role FROM public.project_members
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000000501'
      AND user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  'reviewer',
  'app manager can seat members'
);

-- user_e is app_role 'user' but holds the project 'manager' seat.
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'workspace_id', '11111111-1111-1111-1111-111111111111',
      'app_role',     'user'
    )
  )::text,
  true
);
SELECT set_config('role', 'authenticated', true);

INSERT INTO public.project_members (project_id, user_id, project_role)
VALUES ('aaaa1111-0000-0000-0000-000000000501',
        'cccccccc-cccc-cccc-cccc-cccccccccccc', 'member');

SELECT is(
  (SELECT project_role FROM public.project_members
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000000501'
      AND user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'member',
  'project manager can seat others despite app_role user'
);

-- ── probes 6-8: roster denials + composite FK ────────────────────────────
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',  'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'workspace_id', '11111111-1111-1111-1111-111111111111',
      'app_role',     'user'
    )
  )::text,
  true
);
SELECT set_config('role', 'authenticated', true);

SELECT throws_ok(
  $$INSERT INTO public.project_members (project_id, user_id, project_role)
    VALUES ('aaaa1111-0000-0000-0000-000000000501',
            'dddddddd-dddd-dddd-dddd-dddddddddddd', 'member')$$,
  'new row violates row-level security policy for table "project_members"',
  'reviewer cannot manage the roster'
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
SELECT set_config('role', 'authenticated', true);

SELECT throws_ok(
  $$INSERT INTO public.project_members (project_id, user_id, project_role)
    VALUES ('aaaa1111-0000-0000-0000-000000000501',
            'dddddddd-dddd-dddd-dddd-dddddddddddd', 'member')$$,
  'new row violates row-level security policy for table "project_members"',
  'member cannot manage the roster'
);

-- user_b is a member of ws_b only — RLS passes for the admin, but the
-- composite FK to workspace_members rejects the seat.
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
  $$INSERT INTO public.project_members (project_id, user_id, project_role)
    VALUES ('aaaa1111-0000-0000-0000-000000000501',
            'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'member')$$,
  'insert or update on table "project_members" violates foreign key constraint "project_members_member_fkey"',
  'seat requires an actual workspace membership (composite FK)'
);

-- ── probes 9-10: roster visibility ───────────────────────────────────────
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'workspace_id', '22222222-2222-2222-2222-222222222222',
      'app_role',     'admin'
    )
  )::text,
  true
);
SELECT set_config('role', 'authenticated', true);

SELECT is(
  (SELECT count(*)::int FROM public.project_members),
  0,
  'roster rows never leak across workspaces'
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
SELECT set_config('role', 'authenticated', true);

SELECT is(
  (SELECT count(*)::int FROM public.project_members
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000000501'),
  3,
  'any workspace member can read the roster'
);

-- ── probes 11-13: can_write_project() truth table when staffed ───────────
-- (still user_c — the seated 'member')
SELECT is(
  public.can_write_project('aaaa1111-0000-0000-0000-000000000501'),
  true,
  'staffed: seated member can write'
);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',  'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'workspace_id', '11111111-1111-1111-1111-111111111111',
      'app_role',     'user'
    )
  )::text,
  true
);
SELECT set_config('role', 'authenticated', true);

SELECT is(
  public.can_write_project('aaaa1111-0000-0000-0000-000000000501'),
  false,
  'staffed: reviewer cannot write'
);

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

SELECT is(
  public.can_write_project('aaaa1111-0000-0000-0000-000000000501'),
  true,
  'staffed: app manager bypasses the roster'
);

-- ── probes 14-16: entity enforcement for the reviewer ────────────────────
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',  'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'workspace_id', '11111111-1111-1111-1111-111111111111',
      'app_role',     'user'
    )
  )::text,
  true
);
SELECT set_config('role', 'authenticated', true);

WITH upd AS (
  UPDATE public.tasks SET title = 'reviewer edit'
   WHERE id = 'aaaa1111-0000-0000-0000-00000000c501'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0,
          'reviewer UPDATE on tasks matches 0 rows');

SELECT throws_ok(
  $$INSERT INTO public.assets (id, project_id, name)
    VALUES ('aaaa1111-0000-0000-0000-00000000a502',
            'aaaa1111-0000-0000-0000-000000000501', 'Reviewer Asset')$$,
  'new row violates row-level security policy for table "assets"',
  'reviewer cannot INSERT assets'
);

INSERT INTO public.comments (id, entity_type, entity_id, body)
VALUES ('aaaa1111-0000-0000-0000-0000000c0501', 'project',
        'aaaa1111-0000-0000-0000-000000000501', 'review note');

SELECT is(
  (SELECT count(*)::int FROM public.comments
    WHERE id = 'aaaa1111-0000-0000-0000-0000000c0501'),
  1,
  'reviewer CAN comment on the staffed project'
);

-- ── probes 17-18: non-member on a staffed project ────────────────────────
-- Unseat user_c as the test runner so they become a staffed-project
-- non-member (fixture mutation, same pattern as 16_member_directory.sql).
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
DELETE FROM public.project_members
 WHERE project_id = 'aaaa1111-0000-0000-0000-000000000501'
   AND user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

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

-- can_write_project() yields NULL for a no-seat caller (NULL IN (...));
-- policies treat that as deny — coalesce for the assertion.
SELECT is(
  COALESCE(public.can_write_project('aaaa1111-0000-0000-0000-000000000501'), false),
  false,
  'staffed: unseated member cannot write'
);

SELECT throws_ok(
  $$INSERT INTO public.assets (id, project_id, name)
    VALUES ('aaaa1111-0000-0000-0000-00000000a503',
            'aaaa1111-0000-0000-0000-000000000501', 'Non-member Asset')$$,
  'new row violates row-level security policy for table "assets"',
  'non-member cannot INSERT assets'
);

-- ── probe 19: app admin still writes staffed entities ────────────────────
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
  UPDATE public.tasks SET title = 'admin edit'
   WHERE id = 'aaaa1111-0000-0000-0000-00000000c501'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1,
          'app admin still writes staffed-project entities');

-- ── probes 20-23: projects matrix parity (INSERT admin+manager, DELETE admin) ─
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

SELECT throws_ok(
  $$INSERT INTO public.projects (id, workspace_id, title)
    VALUES ('aaaa1111-0000-0000-0000-000000000601',
            '11111111-1111-1111-1111-111111111111', 'User Project')$$,
  'new row violates row-level security policy for table "projects"',
  'app user cannot INSERT projects'
);

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

INSERT INTO public.projects (id, workspace_id, title)
VALUES ('aaaa1111-0000-0000-0000-000000000601',
        '11111111-1111-1111-1111-111111111111', 'Manager Project');

SELECT is(
  (SELECT count(*)::int FROM public.projects
    WHERE id = 'aaaa1111-0000-0000-0000-000000000601'),
  1,
  'app manager can INSERT projects'
);

WITH del AS (
  DELETE FROM public.projects
   WHERE id = 'aaaa1111-0000-0000-0000-000000000601'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM del), 0,
          'non-admin hard-DELETE matches 0 rows');

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

WITH del AS (
  DELETE FROM public.projects
   WHERE id = 'aaaa1111-0000-0000-0000-000000000601'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM del), 1,
          'admin can hard-DELETE a project');

-- ── probe 24: a seat cannot be repointed to an unmanaged project ─────────
-- project_members_update's WITH CHECK re-runs the roster gate on the NEW
-- row; without it, user_e (project manager of the scratch project only)
-- could grant seats on any project in the workspace.
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'workspace_id', '11111111-1111-1111-1111-111111111111',
      'app_role',     'user'
    )
  )::text,
  true
);
SELECT set_config('role', 'authenticated', true);

SELECT throws_ok(
  $$UPDATE public.project_members
       SET project_id = 'aaaa1111-0000-0000-0000-000000000001'
     WHERE project_id = 'aaaa1111-0000-0000-0000-000000000501'
       AND user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'$$,
  'new row violates row-level security policy for table "project_members"',
  'project manager cannot repoint a seat to an unmanaged project'
);

-- ── probe 25: entities cannot be moved INTO a gated project ──────────────
-- assets_update's WITH CHECK re-runs can_write_project on the NEW row's
-- project; user_c can write unstaffed project_a but holds no seat on the
-- staffed scratch project.
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

SELECT throws_ok(
  $$UPDATE public.assets
       SET project_id = 'aaaa1111-0000-0000-0000-000000000501'
     WHERE id = 'aaaa1111-0000-0000-0000-00000000a5a1'$$,
  'new row violates row-level security policy for table "assets"',
  'member cannot move an asset into a project they cannot write'
);

SELECT * FROM finish();
ROLLBACK;
