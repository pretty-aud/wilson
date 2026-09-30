-- pgTAP: projects RLS
BEGIN;
SELECT plan(9);

-- Seed the shared fixture (ws_a, ws_b, user_a, user_b, project_a, project_b).
SELECT * FROM tests.rls_setup();

-- ── 0084 (S3a, 2026-09-30): projects.active_shot_list_id ──────────────────
-- Run as postgres, BEFORE the login below: from tests.login_as on, this
-- suite is `authenticated` and never switches back. The pointer's WHO
-- (manager/admin only) is suite 84's; this pins the column and the FK that
-- keeps it inside its own project.

SELECT has_column('public', 'projects', 'active_shot_list_id',
  'projects.active_shot_list_id exists (0084 §6a)');

-- NULL means "no active list — show every scene and shot" (D10), which is
-- what every project that has no scenes starts as.
SELECT col_is_null('public', 'projects', 'active_shot_list_id',
  'projects.active_shot_list_id is nullable — no active list is a legal state (D10)');

-- One list per project, each owned by postgres here. The GUC is the one
-- set_active_shot_list() arms, so the §7b guard steps aside and the FK is
-- the only thing left to judge the write.
INSERT INTO public.shot_lists (id, project_id, title, version)
VALUES ('01010000-0000-0000-0000-0000000000a1', 'aaaa1111-0000-0000-0000-000000000001', 'Project A list', 1),
       ('01010000-0000-0000-0000-0000000000b1', 'bbbb2222-0000-0000-0000-000000000001', 'Project B list', 1);

SELECT set_config('wilson.shot_list_activate', 'aaaa1111-0000-0000-0000-000000000001', true);

SELECT throws_ok(
  $$UPDATE public.projects SET active_shot_list_id = '01010000-0000-0000-0000-0000000000b1'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  '23503', 'insert or update on table "projects" violates foreign key constraint "projects_active_shot_list_fk"',
  'a list of ANOTHER project cannot be made active — the (active_shot_list_id, id) FK (0084 §6a)');

-- CONTROL: the same armed write, naming the project's OWN list, lives — so
-- the refusal above is the composite FK and not the guard or the GUC.
SELECT lives_ok(
  $$UPDATE public.projects SET active_shot_list_id = '01010000-0000-0000-0000-0000000000a1'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'CONTROL: the project''s own list can be made active through the same armed write');

-- Put the fixture back the way the probes below expect it, then disarm.
UPDATE public.projects SET active_shot_list_id = NULL
 WHERE id = 'aaaa1111-0000-0000-0000-000000000001';
SELECT set_config('wilson.shot_list_activate', '', true);

-- ── probe 1: same-tenant SELECT allowed ────────────────────────────────────
SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

SELECT is(
  (SELECT count(*)::int FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000001'),
  1,
  'user_a can SELECT own project'
);

-- ── probe 2: cross-tenant SELECT denied ────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.projects WHERE id = 'bbbb2222-0000-0000-0000-000000000001'),
  0,
  'user_a cannot SELECT workspace B project'
);

-- ── probe 3: cross-tenant UPDATE denied (affects zero rows) ────────────────
WITH upd AS (
  UPDATE public.projects SET title = 'hijack' WHERE id = 'bbbb2222-0000-0000-0000-000000000001'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0, 'user_a cannot UPDATE workspace B project');

-- ── probe 4: audit column populates on INSERT ──────────────────────────────
-- 0013 tightened projects INSERT to app admin/manager; tests.login_as
-- carries no app_role claim, so the write needs inline admin claims
-- (17_edit_history.sql pattern).
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

INSERT INTO public.projects (id, workspace_id, title)
VALUES ('aaaa1111-0000-0000-0000-000000000099',
        '11111111-1111-1111-1111-111111111111',
        'audit probe');

SELECT is(
  (SELECT created_by FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000099'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'fn_audit_touch populates created_by from auth.uid()'
);


-- ── 0033: the migration-0011 privilege trap, for projects ──
-- 0011's blanket GRANT plus its ALTER DEFAULT PRIVILEGES left anon holding
-- every table privilege on projects; 0033 revoked it. Assert the revoke rather
-- than assume it — a policy-only check passes while a privilege hole is wide
-- open, which is exactly how 26 tables stayed open until S21 tripped over one.
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.projects', 'SELECT') OR
    has_table_privilege('anon', 'public.projects', 'INSERT') OR
    has_table_privilege('anon', 'public.projects', 'UPDATE') OR
    has_table_privilege('anon', 'public.projects', 'DELETE')
  ),
  'anon holds no table privilege on projects'
);

SELECT * FROM finish();
ROLLBACK;
