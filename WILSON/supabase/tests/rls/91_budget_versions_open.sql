-- =========================================================================
-- 91_budget_versions_open.sql — post-overhaul S5, migration 0089.
--
-- Bid versions as living documents: the project's OPEN version pointer, and
-- the SELECTED bid chosen in one statement. The money gate (0037) is the
-- authority throughout; this suite proves the new pointer and the version
-- snapshot's money fields stay behind it.
--
-- What it PINS:
--  1. Structure (1-9): the column, the same-project composite FK with
--     ON DELETE SET NULL, the composite key it needs, the guard trigger and
--     its function out of reach, the RPC as SECURITY INVOKER and out of
--     anon's reach, and projects_update as the ONE policy that admits an
--     UPDATE of projects — the policy that admits the pointer write.
--  2. A project MANAGER (past the money gate) opens a version (10-11); the
--     pointer cannot name another project's version (12); the selected bid
--     moves in one statement, clearing every other — two left selected by
--     the old loop included — and NULL clears all (13-17); the manager reads
--     the snapshot's totals (18, the control for 20-21 and 29).
--  3. A project MEMBER passes projects_update but not the money gate: reads
--     zero versions and no snapshot money (19-21); the pointer itself is a
--     bare id that dereferences to nothing (22); moving or clearing it is
--     refused by the guard (23-24) while another column saves (25, CONTROL)
--     and a whole-row re-send with the pointer unchanged passes (26); the RPC
--     refuses (27).
--  4. A workspace MANAGER holding only a member seat (0037's "derek") is
--     refused the same (28).
--  5. A project REVIEWER: zero versions (29); projects_update itself refuses
--     the write, so nothing changes (30-31).
--  6. A workspace ADMIN may move it (32). Deleting the open version clears
--     the pointer and leaves the project (33-34).
-- =========================================================================
BEGIN;

SELECT plan(34);

SELECT * FROM tests.rls_setup();

-- Four people in workspace A beside its admin (user_a): a project manager, a
-- project member, a project reviewer, and a workspace manager who holds only
-- a member seat on the project.
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('91910000-0000-0000-0000-0000000000a1', 'pm91@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now()),
  ('91910000-0000-0000-0000-0000000000a2', 'mem91@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now()),
  ('91910000-0000-0000-0000-0000000000a3', 'rev91@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now()),
  ('91910000-0000-0000-0000-0000000000a4', 'wsm91@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', '91910000-0000-0000-0000-0000000000a1', 'user',    'pm91',  'PM 91',  true),
  ('11111111-1111-1111-1111-111111111111', '91910000-0000-0000-0000-0000000000a2', 'user',    'mem91', 'Mem 91', true),
  ('11111111-1111-1111-1111-111111111111', '91910000-0000-0000-0000-0000000000a3', 'user',    'rev91', 'Rev 91', true),
  ('11111111-1111-1111-1111-111111111111', '91910000-0000-0000-0000-0000000000a4', 'manager', 'wsm91', 'WSM 91', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role)
VALUES
  ('aaaa1111-0000-0000-0000-000000000001', '91910000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'manager'),
  ('aaaa1111-0000-0000-0000-000000000001', '91910000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1111-0000-0000-0000-000000000001', '91910000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1111-0000-0000-0000-000000000001', '91910000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;

-- Three versions in project A (two left SELECTED, as the old client loop
-- could leave them) and one in project B. The snapshot carries the S5 shape's
-- money fields.
INSERT INTO public.budget_versions (id, project_id, name, is_active, snapshot)
VALUES
  ('91910000-0000-0000-0000-0000000000b1', 'aaaa1111-0000-0000-0000-000000000001', 'v1',      true,
   '{"kind":"bid","totals":{"overall":1234,"beforeAgency":1100},"totalBidDays":10}'::jsonb),
  ('91910000-0000-0000-0000-0000000000b2', 'aaaa1111-0000-0000-0000-000000000001', 'Mid ROM', true,
   '{"kind":"bid","totals":{"overall":2000,"beforeAgency":1800},"totalBidDays":16}'::jsonb),
  ('91910000-0000-0000-0000-0000000000b3', 'aaaa1111-0000-0000-0000-000000000001', 'v3',      false, '{}'::jsonb),
  ('91910000-0000-0000-0000-0000000000bb', 'bbbb2222-0000-0000-0000-000000000001', 'B bid',   false, '{}'::jsonb);


-- ── 1-9: structure ───────────────────────────────────────────────────────

SELECT has_column('public', 'projects', 'open_budget_version_id',
  'projects.open_budget_version_id exists (0089 §2)');

SELECT col_type_is('public', 'projects', 'open_budget_version_id', 'uuid',
  'projects.open_budget_version_id is a uuid');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_constraint
           WHERE conrelid = 'public.projects'::regclass
             AND conname = 'projects_open_budget_version_fk'
             AND contype = 'f' AND confdeltype = 'n'
             AND confrelid = 'public.budget_versions'::regclass
             AND array_length(conkey, 1) = 2),
  'the pointer is a TWO-column FK to budget_versions (id, project_id), ON DELETE SET NULL');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_constraint
           WHERE conrelid = 'public.budget_versions'::regclass
             AND conname = 'budget_versions_id_project_key' AND contype = 'u'),
  'budget_versions has the (id, project_id) key the same-project FK needs');

SELECT has_trigger('public', 'projects', 'trg_projects_open_budget_version_guard',
  'projects carries the open-version guard');

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.fn_projects_open_budget_version_guard()', 'EXECUTE'),
  'the guard function is not callable by a signed-in client');

SELECT ok(
  (SELECT NOT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'select_budget_version'),
  'select_budget_version is SECURITY INVOKER: budget_versions'' own policies apply to its UPDATE');

SELECT ok(
  NOT has_function_privilege('anon', 'public.select_budget_version(uuid, uuid)', 'EXECUTE'),
  'anon cannot execute select_budget_version');

SELECT is(
  (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'projects' AND cmd IN ('UPDATE', 'ALL')),
  ARRAY['projects_update']::text[],
  'projects_update (0013) is the one policy that admits an UPDATE of projects — the pointer write included');


-- ── as the project MANAGER (past the money gate) ─────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '91910000-0000-0000-0000-0000000000a1', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$UPDATE public.projects SET open_budget_version_id = '91910000-0000-0000-0000-0000000000b1'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'a project manager opens a bid version (projects_update admits, the guard passes)');

SELECT is(
  (SELECT open_budget_version_id FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000001'),
  '91910000-0000-0000-0000-0000000000b1'::uuid,
  'the open version is v1');

SELECT throws_ok(
  $$UPDATE public.projects SET open_budget_version_id = '91910000-0000-0000-0000-0000000000bb'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  '23503', NULL,
  'the pointer cannot name ANOTHER project''s version — the (open_budget_version_id, id) FK');

SELECT is(
  public.select_budget_version('aaaa1111-0000-0000-0000-000000000001', '91910000-0000-0000-0000-0000000000b3'),
  '91910000-0000-0000-0000-0000000000b3'::uuid,
  'select_budget_version returns the selected bid');

SELECT is(
  (SELECT array_agg(name ORDER BY name) FROM public.budget_versions
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001' AND is_active),
  ARRAY['v3']::text[],
  'ONE statement leaves exactly one selected bid — both versions the old loop left selected are cleared');

SELECT throws_ok(
  $$SELECT public.select_budget_version('aaaa1111-0000-0000-0000-000000000001', '91910000-0000-0000-0000-0000000000bb')$$,
  'P0002', 'bid version not found in this project',
  'another project''s version cannot be selected here');

-- The call and its check are two statements: a volatile function's write is
-- not reliably seen by a subquery of the statement that called it.
SELECT is(
  public.select_budget_version('aaaa1111-0000-0000-0000-000000000001', NULL),
  NULL::uuid,
  'select_budget_version(project, NULL) returns NULL');

SELECT is(
  (SELECT count(*)::int FROM public.budget_versions
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001' AND is_active),
  0,
  'NULL clears the selection — nothing is promoted (F13)');

SELECT is(
  (SELECT (snapshot -> 'totals' ->> 'overall')::int FROM public.budget_versions
    WHERE id = '91910000-0000-0000-0000-0000000000b1'),
  1234,
  'CONTROL: the manager reads the snapshot''s overall total');


-- ── as a project MEMBER (passes projects_update, not the money gate) ─────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '91910000-0000-0000-0000-0000000000a2', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.budget_versions WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  0,
  'a member reads zero bid versions (0037''s gate, unchanged)');

SELECT is(
  (SELECT count(*)::int FROM public.budget_versions WHERE snapshot ? 'totals'),
  0,
  'a member reads no snapshot totals from any version');

SELECT is(
  (SELECT (snapshot -> 'totals' ->> 'overall') FROM public.budget_versions
    WHERE id = '91910000-0000-0000-0000-0000000000b1'),
  NULL,
  'the open version''s overall total is not readable by a member');

SELECT is(
  (SELECT count(*)::int FROM public.budget_versions
    WHERE id = (SELECT open_budget_version_id FROM public.projects
                 WHERE id = 'aaaa1111-0000-0000-0000-000000000001')),
  0,
  'the pointer a member can read on the project is a bare id: following it reaches no row');

SELECT throws_ok(
  $$UPDATE public.projects SET open_budget_version_id = '91910000-0000-0000-0000-0000000000b2'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  '42501',
  'the open bid version is changed only by someone who can see this project''s budget (a project manager or a workspace admin)',
  'a member cannot open another version — the guard refuses');

SELECT throws_ok(
  $$UPDATE public.projects SET open_budget_version_id = NULL
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  '42501', NULL,
  'a member cannot close the open version either');

SELECT lives_ok(
  $$UPDATE public.projects SET description = 'member wrote this'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'CONTROL: the same member saves another column — the refusals above are the guard, not projects_update');

SELECT lives_ok(
  $$UPDATE public.projects SET open_budget_version_id = open_budget_version_id, title = title
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'a whole-row re-send with the pointer unchanged passes (the 0049 rule)');

SELECT throws_ok(
  $$SELECT public.select_budget_version('aaaa1111-0000-0000-0000-000000000001', '91910000-0000-0000-0000-0000000000b2')$$,
  '42501', NULL,
  'a member cannot choose the selected bid');


-- ── as a workspace MANAGER holding only a member seat ────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '91910000-0000-0000-0000-0000000000a4', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$UPDATE public.projects SET open_budget_version_id = '91910000-0000-0000-0000-0000000000b2'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  '42501', NULL,
  'a workspace manager with only a member seat is refused (0037: not past the money gate)');


-- ── as a project REVIEWER ────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '91910000-0000-0000-0000-0000000000a3', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.budget_versions WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  0,
  'a reviewer still reads zero bid versions');

-- projects_update's can_write_project refuses a reviewer: the UPDATE matches
-- no row (no error, nothing written).
UPDATE public.projects SET open_budget_version_id = '91910000-0000-0000-0000-0000000000b2'
 WHERE id = 'aaaa1111-0000-0000-0000-000000000001';

SELECT is(
  (SELECT open_budget_version_id FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000001'),
  '91910000-0000-0000-0000-0000000000b1'::uuid,
  'a reviewer''s attempt changes nothing: projects_update refuses it before the guard is reached');

SELECT is(
  (SELECT count(*)::int FROM public.projects
    WHERE id = 'aaaa1111-0000-0000-0000-000000000001' AND description = 'member wrote this'),
  1,
  'CONTROL: the reviewer reads the project (the refusal above is the write, not the read)');


-- ── as the workspace ADMIN ───────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$UPDATE public.projects SET open_budget_version_id = '91910000-0000-0000-0000-0000000000b2'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'a workspace admin moves the open version (past the money gate)');

-- The FK's SET NULL: deleting the OPEN version closes it.
DELETE FROM public.budget_versions WHERE id = '91910000-0000-0000-0000-0000000000b2';

SELECT is(
  (SELECT open_budget_version_id FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000001'),
  NULL::uuid,
  'deleting the open version clears the pointer (the guard lets the FK''s SET NULL through)');

SELECT is(
  (SELECT count(*)::int FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000001'),
  1,
  'and the project stands');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
