-- =========================================================================
-- 92_schedule_set_aside.sql — post-overhaul S5b, migration 0090.
--
-- Audrey's ruling (a) of 2026-10-05: each bid version shows exactly its own
-- schedule; rows the open version does not hold are SET ASIDE — never lost,
-- never in a trash, never purged — and come back, the same rows, when a
-- version that holds them is opened. And S5-01: the budget's settings change
-- only past the money gate (D8).
--
-- What it PINS:
--  1. Structure (1-11): the three columns, the three guard triggers on one
--     SECURITY DEFINER function no client may call, the writer as SECURITY
--     INVOKER out of anon's reach, the budget-settings guard likewise.
--  2. A project MANAGER sets a task, a phase and a key date aside in one call
--     (12-13); the rows stay READABLE (14: the clients split them out — the
--     open brings them back from there); asking again keeps the first stamp
--     (15); another project's row and a trashed row are untouched (16-17);
--     the key-date trash index does not list a set-aside key date (18).
--  3. A project MEMBER still reads them (19) but cannot set aside or bring
--     back — the RPC (20), a direct UPDATE either way (21-22), an INSERT
--     carrying the stamp (24) — while editing the same row's title (23,
--     CONTROL), re-sending it unchanged (25) and inserting without the stamp
--     (26, CONTROL) all pass; trashing a set-aside row CLEARS its stamp and a
--     restore brings it back LIVE (27-29).
--  4. A workspace manager with a member seat, and a reviewer, are refused
--     (30-32).
--  5. A workspace ADMIN brings the rows back (33): the SAME ids, with their
--     comments, link, dependency edge, file and logged days on them (34-39 —
--     constraint 1).
--  6. The trash is not the store (40-42, constraint 2): purge_soft_deleted
--     with every trashed row expired leaves a set-aside task and key date and
--     takes the trashed CONTROL row.
--  7. S5-01 (43-55): a member is refused each budget setting and the lock,
--     re-sends the row unchanged and saves another column (CONTROL); a
--     workspace manager with a member seat is refused; a reviewer changes
--     nothing (projects_update); a project manager and an admin may; as
--     postgres with no claims a direct change is refused (CONTROL) while the
--     lock FK's own SET NULL passes when the locked version is deleted.
-- =========================================================================
BEGIN;

SELECT plan(55);

SELECT * FROM tests.rls_setup();

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('92920000-0000-0000-0000-0000000000a1', 'pm92@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now()),
  ('92920000-0000-0000-0000-0000000000a2', 'mem92@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now()),
  ('92920000-0000-0000-0000-0000000000a3', 'rev92@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now()),
  ('92920000-0000-0000-0000-0000000000a4', 'wsm92@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', '92920000-0000-0000-0000-0000000000a1', 'user',    'pm92',  'PM 92',  true),
  ('11111111-1111-1111-1111-111111111111', '92920000-0000-0000-0000-0000000000a2', 'user',    'mem92', 'Mem 92', true),
  ('11111111-1111-1111-1111-111111111111', '92920000-0000-0000-0000-0000000000a3', 'user',    'rev92', 'Rev 92', true),
  ('11111111-1111-1111-1111-111111111111', '92920000-0000-0000-0000-0000000000a4', 'manager', 'wsm92', 'WSM 92', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role)
VALUES
  ('aaaa1111-0000-0000-0000-000000000001', '92920000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'manager'),
  ('aaaa1111-0000-0000-0000-000000000001', '92920000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1111-0000-0000-0000-000000000001', '92920000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1111-0000-0000-0000-000000000001', '92920000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;

-- Project A's schedule: two phases, five tasks, three key dates; one task in
-- project B. T2 (in P2) carries everything a task can carry.
INSERT INTO public.phases (id, project_id, name, sort_order) VALUES
  ('92920000-0000-0000-0000-0000000000f1', 'aaaa1111-0000-0000-0000-000000000001', 'Pre',      1),
  ('92920000-0000-0000-0000-0000000000f2', 'aaaa1111-0000-0000-0000-000000000001', 'High ROM', 2);

INSERT INTO public.tasks (id, project_id, phase_id, title, logged_days, bid_days) VALUES
  ('92920000-0000-0000-0000-0000000000c1', 'aaaa1111-0000-0000-0000-000000000001', '92920000-0000-0000-0000-0000000000f1', 'Boards',          0,   3),
  ('92920000-0000-0000-0000-0000000000c2', 'aaaa1111-0000-0000-0000-000000000001', '92920000-0000-0000-0000-0000000000f2', 'Lighting pass 2', 1.5, 4),
  ('92920000-0000-0000-0000-0000000000c3', 'aaaa1111-0000-0000-0000-000000000001', '92920000-0000-0000-0000-0000000000f2', 'Extra comp',      0,   2),
  ('92920000-0000-0000-0000-0000000000c4', 'aaaa1111-0000-0000-0000-000000000001', NULL,                                    'Trash me later',  0,   1),
  ('92920000-0000-0000-0000-0000000000c5', 'aaaa1111-0000-0000-0000-000000000001', NULL,                                    'Purge me',        0,   1),
  ('92920000-0000-0000-0000-0000000000cb', 'bbbb2222-0000-0000-0000-000000000001', NULL,                                    'B task',          0,   1);

INSERT INTO public.milestones (id, project_id, phase_id, title, date) VALUES
  ('92920000-0000-0000-0000-0000000000d1', 'aaaa1111-0000-0000-0000-000000000001', '92920000-0000-0000-0000-0000000000f2', 'High ROM review', '2026-11-02'),
  ('92920000-0000-0000-0000-0000000000d2', 'aaaa1111-0000-0000-0000-000000000001', NULL,                                    'Delivery',        '2026-12-01'),
  ('92920000-0000-0000-0000-0000000000d3', 'aaaa1111-0000-0000-0000-000000000001', NULL,                                    'Trashed date',    '2026-12-05');

INSERT INTO public.comments (id, entity_type, entity_id, body) VALUES
  ('92920000-0000-0000-0000-0000000000e1', 'task',  '92920000-0000-0000-0000-0000000000c2', 'Keep the warm key'),
  ('92920000-0000-0000-0000-0000000000e2', 'phase', '92920000-0000-0000-0000-0000000000f2', 'Only for the high bid');

INSERT INTO public.task_links (task_id, url, label)
VALUES ('92920000-0000-0000-0000-0000000000c2', 'https://example.test/ref', 'Reference');

INSERT INTO public.task_dependencies (predecessor_id, successor_id)
VALUES ('92920000-0000-0000-0000-0000000000c1', '92920000-0000-0000-0000-0000000000c2');

INSERT INTO public.files (id, project_id, task_id, name, storage_provider, storage_path)
VALUES ('92920000-0000-0000-0000-0000000000a9', 'aaaa1111-0000-0000-0000-000000000001',
        '92920000-0000-0000-0000-0000000000c2', 'grade.png', 'supabase', 'projects/a/grade.png');

INSERT INTO public.budget_versions (id, project_id, name, is_active, snapshot)
VALUES ('92920000-0000-0000-0000-0000000000b1', 'aaaa1111-0000-0000-0000-000000000001', 'Mid ROM', true, '{}'::jsonb);

-- A trashed key date (the CONTROL for the trash index) and a trashed task
-- (the CONTROL for the purge). Stamped directly as postgres: soft_delete_row
-- authorises against the caller's claims, and there are none yet.
UPDATE public.milestones SET deleted_at = now() WHERE id = '92920000-0000-0000-0000-0000000000d3';
UPDATE public.tasks      SET deleted_at = now() WHERE id = '92920000-0000-0000-0000-0000000000c5';


-- ── 1-11: structure ─────────────────────────────────────────────────────

SELECT has_column('public', 'tasks', 'set_aside_at', 'tasks.set_aside_at exists (0090 §1)');
SELECT has_column('public', 'phases', 'set_aside_at', 'phases.set_aside_at exists');
SELECT has_column('public', 'milestones', 'set_aside_at', 'milestones.set_aside_at exists');

SELECT is(
  (SELECT count(*)::int FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('tasks', 'phases', 'milestones')
      AND column_name = 'set_aside_at' AND data_type = 'timestamp with time zone'),
  3,
  'all three stamps are timestamptz');

SELECT is(
  (SELECT array_agg(tgname::text ORDER BY tgname) FROM pg_trigger
    WHERE tgname IN ('trg_tasks_set_aside_guard', 'trg_phases_set_aside_guard', 'trg_milestones_set_aside_guard')
      AND NOT tgisinternal
      AND tgfoid = 'public.fn_schedule_set_aside_guard()'::regprocedure),
  ARRAY['trg_milestones_set_aside_guard', 'trg_phases_set_aside_guard', 'trg_tasks_set_aside_guard']::text[],
  'each table carries the set-aside guard, all three on the one function');

SELECT ok(
  (SELECT p.prosecdef AND (r.rolsuper OR r.rolbypassrls)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_roles r ON r.oid = p.proowner
    WHERE n.nspname = 'public' AND p.proname = 'fn_schedule_set_aside_guard'),
  'the set-aside guard is SECURITY DEFINER under a role that sees past RLS');

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.fn_schedule_set_aside_guard()', 'EXECUTE'),
  'the set-aside guard is not callable by a signed-in client');

SELECT ok(
  (SELECT NOT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'set_aside_schedule_rows'),
  'set_aside_schedule_rows is SECURITY INVOKER: the tables'' own UPDATE policies apply');

SELECT ok(
  NOT has_function_privilege('anon', 'public.set_aside_schedule_rows(uuid, boolean, uuid[], uuid[], uuid[])', 'EXECUTE'),
  'anon cannot execute set_aside_schedule_rows');

SELECT has_trigger('public', 'projects', 'trg_projects_budget_settings_guard',
  'projects carries the budget-settings guard (S5-01)');

SELECT ok(
  (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_projects_budget_settings_guard')
  AND NOT has_function_privilege('authenticated', 'public.fn_projects_budget_settings_guard()', 'EXECUTE'),
  'the budget-settings guard is SECURITY DEFINER and not callable by a signed-in client');


-- ── as the project MANAGER (past the money gate) ─────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '92920000-0000-0000-0000-0000000000a1', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  public.set_aside_schedule_rows('aaaa1111-0000-0000-0000-000000000001', true,
    ARRAY['92920000-0000-0000-0000-0000000000c2', '92920000-0000-0000-0000-0000000000c3', '92920000-0000-0000-0000-0000000000c4']::uuid[],
    ARRAY['92920000-0000-0000-0000-0000000000f2']::uuid[],
    ARRAY['92920000-0000-0000-0000-0000000000d1']::uuid[]) - 'set_aside_at',
  '{"tasks": 3, "phases": 1, "milestones": 1}'::jsonb,
  'a manager sets three tasks, a phase and a key date aside in ONE call');

SELECT is(
  (SELECT count(*)::int FROM public.tasks WHERE id IN ('92920000-0000-0000-0000-0000000000c2', '92920000-0000-0000-0000-0000000000c3') AND set_aside_at IS NOT NULL)
  + (SELECT count(*)::int FROM public.phases WHERE id = '92920000-0000-0000-0000-0000000000f2' AND set_aside_at IS NOT NULL)
  + (SELECT count(*)::int FROM public.milestones WHERE id = '92920000-0000-0000-0000-0000000000d1' AND set_aside_at IS NOT NULL),
  4,
  'the rows carry the stamp');

SELECT is(
  (SELECT count(*)::int FROM public.tasks WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001' AND set_aside_at IS NOT NULL),
  3,
  'set-aside rows stay READABLE: no SELECT policy hides them (the clients split them out; the open brings them back from there)');

SELECT is(
  public.set_aside_schedule_rows('aaaa1111-0000-0000-0000-000000000001', true,
    ARRAY['92920000-0000-0000-0000-0000000000c2']::uuid[], '{}'::uuid[], '{}'::uuid[]) ->> 'tasks',
  '0',
  'asking again touches nothing: a row already set aside keeps its first stamp');

SELECT is(
  public.set_aside_schedule_rows('aaaa1111-0000-0000-0000-000000000001', true,
    ARRAY['92920000-0000-0000-0000-0000000000cb']::uuid[], '{}'::uuid[], '{}'::uuid[]) ->> 'tasks',
  '0',
  'a task of ANOTHER project named in the call is untouched');

SELECT is(
  public.set_aside_schedule_rows('aaaa1111-0000-0000-0000-000000000001', true,
    '{}'::uuid[], '{}'::uuid[], ARRAY['92920000-0000-0000-0000-0000000000d3']::uuid[]) ->> 'milestones',
  '0',
  'a TRASHED key date is never set aside');

SELECT is(
  (SELECT array_agg(id ORDER BY id) FROM public.milestones_trash_index('aaaa1111-0000-0000-0000-000000000001')),
  ARRAY['92920000-0000-0000-0000-0000000000d3']::uuid[],
  '"Recently deleted" key dates lists the trashed one only — never the set-aside key date (constraint 2)');


-- ── as a project MEMBER (not past the money gate) ────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '92920000-0000-0000-0000-0000000000a2', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.tasks WHERE id = '92920000-0000-0000-0000-0000000000c2' AND set_aside_at IS NOT NULL),
  1,
  'a member reads the set-aside task too (every client splits it out of the live schedule)');

SELECT throws_ok(
  $$SELECT public.set_aside_schedule_rows('aaaa1111-0000-0000-0000-000000000001', false,
      ARRAY['92920000-0000-0000-0000-0000000000c2']::uuid[], '{}'::uuid[], '{}'::uuid[])$$,
  '42501', NULL,
  'a member cannot bring a row back through the RPC');

SELECT throws_ok(
  $$UPDATE public.tasks SET set_aside_at = NULL WHERE id = '92920000-0000-0000-0000-0000000000c2'$$,
  '42501',
  'a row is set aside or brought back only by someone who can see this project''s budget (a project manager or a workspace admin): the bid versions decide it',
  'a member cannot bring a set-aside task back with a direct UPDATE — the guard refuses');

SELECT throws_ok(
  $$UPDATE public.tasks SET set_aside_at = now() WHERE id = '92920000-0000-0000-0000-0000000000c1'$$,
  '42501', NULL,
  'a member cannot set a live task aside either');

SELECT lives_ok(
  $$UPDATE public.tasks SET title = 'Lighting pass 2 (warm)' WHERE id = '92920000-0000-0000-0000-0000000000c2'$$,
  'CONTROL: the same member edits the same row''s title — the refusals above are the guard, not tasks_update');

SELECT throws_ok(
  $$INSERT INTO public.tasks (id, project_id, title, set_aside_at)
    VALUES ('92920000-0000-0000-0000-0000000000c9', 'aaaa1111-0000-0000-0000-000000000001', 'Born aside', now())$$,
  '42501', NULL,
  'a member cannot insert a row already set aside');

SELECT lives_ok(
  $$UPDATE public.tasks SET set_aside_at = set_aside_at, title = title WHERE id = '92920000-0000-0000-0000-0000000000c2'$$,
  'a whole-row re-send with the stamp unchanged passes (the 0049 rule)');

SELECT lives_ok(
  $$INSERT INTO public.tasks (id, project_id, title)
    VALUES ('92920000-0000-0000-0000-0000000000c8', 'aaaa1111-0000-0000-0000-000000000001', 'Member task')$$,
  'CONTROL: the member inserts an ordinary task');

-- Trashing a set-aside row clears its stamp, for anyone the trash admits.
SELECT ok(
  public.soft_delete_row('tasks', '92920000-0000-0000-0000-0000000000c4'),
  'a member may trash a set-aside task (the trash admits members)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT (deleted_at IS NOT NULL) AND (set_aside_at IS NULL) FROM public.tasks WHERE id = '92920000-0000-0000-0000-0000000000c4'),
  true,
  'trashing CLEARED the stamp: a trashed row is never also set aside');

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '92920000-0000-0000-0000-0000000000a2', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT public.restore_soft_deleted('tasks', '92920000-0000-0000-0000-0000000000c4');

SELECT is(
  (SELECT (deleted_at IS NULL) AND (set_aside_at IS NULL) FROM public.tasks WHERE id = '92920000-0000-0000-0000-0000000000c4'),
  true,
  'taken out of the trash, the row comes back LIVE');


-- ── as a workspace MANAGER holding only a member seat ────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '92920000-0000-0000-0000-0000000000a4', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.set_aside_schedule_rows('aaaa1111-0000-0000-0000-000000000001', false,
      ARRAY['92920000-0000-0000-0000-0000000000c2']::uuid[], '{}'::uuid[], '{}'::uuid[])$$,
  '42501', NULL,
  'a workspace manager with only a member seat is refused (0037: not past the money gate)');


-- ── as a project REVIEWER ────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '92920000-0000-0000-0000-0000000000a3', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.set_aside_schedule_rows('aaaa1111-0000-0000-0000-000000000001', false,
      ARRAY['92920000-0000-0000-0000-0000000000c2']::uuid[], '{}'::uuid[], '{}'::uuid[])$$,
  '42501', NULL,
  'a reviewer is refused');

UPDATE public.tasks SET set_aside_at = NULL WHERE id = '92920000-0000-0000-0000-0000000000c3';

SELECT is(
  (SELECT count(*)::int FROM public.tasks WHERE id = '92920000-0000-0000-0000-0000000000c3' AND set_aside_at IS NOT NULL),
  1,
  'a reviewer''s direct UPDATE changes nothing (tasks_update refuses it before the guard)');


-- ── as the workspace ADMIN: bring them back — the SAME rows, whole ───────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  public.set_aside_schedule_rows('aaaa1111-0000-0000-0000-000000000001', false,
    ARRAY['92920000-0000-0000-0000-0000000000c2']::uuid[],
    ARRAY['92920000-0000-0000-0000-0000000000f2']::uuid[],
    ARRAY['92920000-0000-0000-0000-0000000000d1']::uuid[]) - 'set_aside_at',
  '{"tasks": 1, "phases": 1, "milestones": 1}'::jsonb,
  'an admin brings the task, the phase and the key date back in one call');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT set_aside_at IS NULL AND deleted_at IS NULL AND title = 'Lighting pass 2 (warm)' AND logged_days = 1.5 AND phase_id = '92920000-0000-0000-0000-0000000000f2'
     FROM public.tasks WHERE id = '92920000-0000-0000-0000-0000000000c2'),
  true,
  'the SAME task is back: its id, its edit made while aside, its logged days and its phase');

SELECT is(
  (SELECT count(*)::int FROM public.comments WHERE entity_id IN ('92920000-0000-0000-0000-0000000000c2', '92920000-0000-0000-0000-0000000000f2') AND deleted_at IS NULL),
  2,
  'the task''s and the phase''s comments are still on them (constraint 1)');

SELECT is(
  (SELECT count(*)::int FROM public.task_links WHERE task_id = '92920000-0000-0000-0000-0000000000c2'),
  1,
  'the task''s link is still on it');

SELECT is(
  (SELECT count(*)::int FROM public.task_dependencies
    WHERE predecessor_id = '92920000-0000-0000-0000-0000000000c1' AND successor_id = '92920000-0000-0000-0000-0000000000c2'),
  1,
  'its dependency edge is still there');

SELECT is(
  (SELECT task_id FROM public.files WHERE id = '92920000-0000-0000-0000-0000000000a9'),
  '92920000-0000-0000-0000-0000000000c2'::uuid,
  'its file still points at it');

SELECT is(
  (SELECT set_aside_at IS NULL AND phase_id = '92920000-0000-0000-0000-0000000000f2' FROM public.milestones WHERE id = '92920000-0000-0000-0000-0000000000d1'),
  true,
  'the key date is back, still on its phase');


-- ── the trash is not the store (constraint 2) ────────────────────────────
-- As postgres: every trashed row expired (the 33/71 idiom, a negative
-- interval). Extra comp (c3) and a key date are set aside as the manager
-- first.

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '92920000-0000-0000-0000-0000000000a1', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT public.set_aside_schedule_rows('aaaa1111-0000-0000-0000-000000000001', true,
  '{}'::uuid[], '{}'::uuid[], ARRAY['92920000-0000-0000-0000-0000000000d2']::uuid[]);
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT public.purge_soft_deleted(INTERVAL '-1 second');

SELECT is(
  (SELECT count(*)::int FROM public.tasks WHERE id = '92920000-0000-0000-0000-0000000000c3' AND set_aside_at IS NOT NULL),
  1,
  'purge_soft_deleted leaves a set-aside task: it is not in the trash, so it is never purged');

SELECT is(
  (SELECT count(*)::int FROM public.milestones WHERE id = '92920000-0000-0000-0000-0000000000d2' AND set_aside_at IS NOT NULL),
  1,
  'purge_soft_deleted leaves a set-aside key date');

SELECT is(
  (SELECT count(*)::int FROM public.tasks WHERE id = '92920000-0000-0000-0000-0000000000c5'),
  0,
  'CONTROL: the same purge took the trashed task');


-- ── S5-01: the budget's settings (D8) ────────────────────────────────────

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '92920000-0000-0000-0000-0000000000a2', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$UPDATE public.projects SET budget_margin_pct = 55 WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  '42501',
  'the budget''s settings (margin, contingency, agency, actuals and the lock) are changed only by someone who can see this project''s budget (a project manager or a workspace admin)',
  'a member cannot change the margin (S5-01, measured: it used to land)');

SELECT throws_ok(
  $$UPDATE public.projects SET budget_contingency_pct = 44, budget_agency_pct = 33, budget_agency_enabled = true WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  '42501', NULL,
  'a member cannot change contingency or the agency fee');

SELECT throws_ok(
  $$UPDATE public.projects SET budget_actual_column_mode = 'weekly', budget_actual_column_count = 7 WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  '42501', NULL,
  'a member cannot change the actuals columns');

SELECT throws_ok(
  $$UPDATE public.projects SET budget_active = true, budget_active_version_id = '92920000-0000-0000-0000-0000000000b1', budget_finalized = true WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  '42501', NULL,
  'a member cannot set the budget active (the lock)');

SELECT lives_ok(
  $$UPDATE public.projects SET budget_margin_pct = budget_margin_pct, budget_active = budget_active,
       budget_active_version_id = budget_active_version_id, title = title
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'a whole-row re-send with the settings unchanged passes (the 0049 rule)');

SELECT lives_ok(
  $$UPDATE public.projects SET description = 'member wrote this' WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'CONTROL: the same member saves another column — the refusals above are the guard, not projects_update');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '92920000-0000-0000-0000-0000000000a4', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$UPDATE public.projects SET budget_margin_pct = 21 WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  '42501', NULL,
  'a workspace manager with only a member seat is refused');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '92920000-0000-0000-0000-0000000000a3', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

UPDATE public.projects SET budget_margin_pct = 77 WHERE id = 'aaaa1111-0000-0000-0000-000000000001';

SELECT is(
  (SELECT budget_margin_pct FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000001'),
  0::numeric,
  'a reviewer''s attempt changes nothing (projects_update refuses it before the guard)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '92920000-0000-0000-0000-0000000000a1', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$UPDATE public.projects SET budget_margin_pct = 12, budget_agency_enabled = true, budget_agency_pct = 15 WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'a project manager changes the margin and the agency fee');

SELECT lives_ok(
  $$UPDATE public.projects SET budget_active = true, budget_active_version_id = '92920000-0000-0000-0000-0000000000b1', budget_finalized = true
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'a project manager sets the budget active');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$UPDATE public.projects SET budget_contingency_pct = 8 WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'a workspace admin changes the contingency');

-- As postgres with NO claims the money arm cannot pass: the CONTROL shows a
-- direct change refused under exactly these settings, so the delete's SET
-- NULL below passes only on the FK arm (the version row is gone).
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT throws_ok(
  $$UPDATE public.projects SET budget_active_version_id = NULL WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  '42501', NULL,
  'CONTROL: as postgres with no claims a direct change of the lock is refused');

DELETE FROM public.budget_versions WHERE id = '92920000-0000-0000-0000-0000000000b1';

SELECT is(
  (SELECT budget_active_version_id IS NULL AND budget_active AND budget_margin_pct = 12
     FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000001'),
  true,
  'deleting the locked version still clears its pointer (the FK''s own SET NULL passes the guard) and changes nothing else');

SELECT * FROM finish();
ROLLBACK;
