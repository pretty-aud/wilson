-- pgTAP: tasks RLS (direct workspace_id)
BEGIN;
SELECT plan(14);

SELECT * FROM tests.rls_setup();

-- A task needs an asset. Seed one per workspace.
INSERT INTO public.assets (id, project_id, name) VALUES
  ('aaaa1111-0000-0000-0000-00000000aa01', 'aaaa1111-0000-0000-0000-000000000001', 'Asset A'),
  ('bbbb2222-0000-0000-0000-00000000bb01', 'bbbb2222-0000-0000-0000-000000000001', 'Asset B');

INSERT INTO public.tasks (id, asset_id, project_id, title) VALUES
  ('aaaa1111-0000-0000-0000-00000000cc01',
   'aaaa1111-0000-0000-0000-00000000aa01',
   'aaaa1111-0000-0000-0000-000000000001', 'Task A'),
  ('bbbb2222-0000-0000-0000-00000000dd01',
   'bbbb2222-0000-0000-0000-00000000bb01',
   'bbbb2222-0000-0000-0000-000000000001', 'Task B');

-- ── 0084 (S3a, 2026-09-30, D9): tasks.scene_id / shot_id ──────────────────
-- Still postgres here: from tests.login_as below the suite is
-- `authenticated` and never switches back. 0034 left these out on purpose
-- ("scenes are local-only BY DESIGN"); 0040 made scenes cloud tables and D9
-- asked for the link, so 0084 §6b adds it with a same-project composite FK.

SELECT has_column('public', 'tasks', 'scene_id', 'tasks.scene_id exists (0084 §6b)');
SELECT has_column('public', 'tasks', 'shot_id',  'tasks.shot_id exists (0084 §6b)');

SELECT col_type_is('public', 'tasks', 'scene_id', 'uuid', 'tasks.scene_id is uuid');
SELECT col_type_is('public', 'tasks', 'shot_id',  'uuid', 'tasks.shot_id is uuid');

-- Most tasks are for no scene at all; NULL is the ordinary state.
SELECT col_is_null('public', 'tasks', 'scene_id', 'tasks.scene_id is nullable');
SELECT col_is_null('public', 'tasks', 'shot_id',  'tasks.shot_id is nullable');

-- One scene in each project. A plain FK on scene_id would accept project B's
-- scene on project A's task; the (scene_id, project_id) pair does not.
INSERT INTO public.scenes (id, project_id, name, scene_number) VALUES
  ('04040000-0000-0000-0000-0000000000a1', 'aaaa1111-0000-0000-0000-000000000001', 'Scene A', 1),
  ('04040000-0000-0000-0000-0000000000b1', 'bbbb2222-0000-0000-0000-000000000001', 'Scene B', 1);

SELECT throws_ok(
  $$INSERT INTO public.tasks (id, asset_id, project_id, title, scene_id)
    VALUES ('aaaa1111-0000-0000-0000-00000000cc02', 'aaaa1111-0000-0000-0000-00000000aa01',
            'aaaa1111-0000-0000-0000-000000000001', 'Task naming B''s scene',
            '04040000-0000-0000-0000-0000000000b1')$$,
  '23503', 'insert or update on table "tasks" violates foreign key constraint "tasks_scene_fk"',
  'a task cannot name ANOTHER project''s scene — the (scene_id, project_id) FK (0084 §6b)');

-- CONTROL: the same insert naming the task's OWN project's scene lives, so
-- the refusal above is the pairing and not the column.
SELECT lives_ok(
  $$INSERT INTO public.tasks (id, asset_id, project_id, title, scene_id)
    VALUES ('aaaa1111-0000-0000-0000-00000000cc03', 'aaaa1111-0000-0000-0000-00000000aa01',
            'aaaa1111-0000-0000-0000-000000000001', 'Task for scene A',
            '04040000-0000-0000-0000-0000000000a1')$$,
  'CONTROL: a task naming its own project''s scene lives');

-- SET NULL, not CASCADE (0034's rule for phase_id, restated in §6b):
-- deleting a scene never deletes the work planned against it.
DELETE FROM public.scenes WHERE id = '04040000-0000-0000-0000-0000000000a1';

SELECT ok(
  EXISTS (SELECT 1 FROM public.tasks
           WHERE id = 'aaaa1111-0000-0000-0000-00000000cc03' AND scene_id IS NULL),
  'deleting the scene keeps the task and clears its scene_id (ON DELETE SET NULL)');

SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

SELECT is(
  (SELECT count(*)::int FROM public.tasks WHERE id = 'aaaa1111-0000-0000-0000-00000000cc01'),
  1, 'user_a can SELECT own-workspace task'
);

SELECT is(
  (SELECT count(*)::int FROM public.tasks WHERE id = 'bbbb2222-0000-0000-0000-00000000dd01'),
  0, 'user_a cannot SELECT workspace-B task'
);

WITH upd AS (
  UPDATE public.tasks SET title = 'hijack' WHERE id = 'bbbb2222-0000-0000-0000-00000000dd01'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0, 'user_a cannot UPDATE workspace-B task');

INSERT INTO public.tasks (id, asset_id, project_id, title)
VALUES ('aaaa1111-0000-0000-0000-00000000cc99',
        'aaaa1111-0000-0000-0000-00000000aa01',
        'aaaa1111-0000-0000-0000-000000000001', 'audit probe');

SELECT is(
  (SELECT created_by FROM public.tasks WHERE id = 'aaaa1111-0000-0000-0000-00000000cc99'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'tasks audit trigger populates created_by'
);


-- ── 0033: the migration-0011 privilege trap, for tasks ──
-- 0011's blanket GRANT plus its ALTER DEFAULT PRIVILEGES left anon holding
-- every table privilege on tasks; 0033 revoked it. Assert the revoke rather
-- than assume it — a policy-only check passes while a privilege hole is wide
-- open, which is exactly how 26 tables stayed open until S21 tripped over one.
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.tasks', 'SELECT') OR
    has_table_privilege('anon', 'public.tasks', 'INSERT') OR
    has_table_privilege('anon', 'public.tasks', 'UPDATE') OR
    has_table_privilege('anon', 'public.tasks', 'DELETE')
  ),
  'anon holds no table privilege on tasks'
);

SELECT * FROM finish();
ROLLBACK;
