-- pgTAP: task_dependencies RLS (parent-join via tasks, both sides)
BEGIN;
SELECT plan(4);

SELECT * FROM tests.rls_setup();

INSERT INTO public.assets (id, project_id, name) VALUES
  ('aaaa1111-0000-0000-0000-00000000aa01', 'aaaa1111-0000-0000-0000-000000000001', 'Asset A'),
  ('bbbb2222-0000-0000-0000-00000000bb01', 'bbbb2222-0000-0000-0000-000000000001', 'Asset B');

INSERT INTO public.tasks (id, asset_id, project_id, title) VALUES
  ('aaaa1111-0000-0000-0000-00000000c101', 'aaaa1111-0000-0000-0000-00000000aa01',
   'aaaa1111-0000-0000-0000-000000000001', 'T1 A'),
  ('aaaa1111-0000-0000-0000-00000000c102', 'aaaa1111-0000-0000-0000-00000000aa01',
   'aaaa1111-0000-0000-0000-000000000001', 'T2 A'),
  ('bbbb2222-0000-0000-0000-00000000c201', 'bbbb2222-0000-0000-0000-00000000bb01',
   'bbbb2222-0000-0000-0000-000000000001', 'T1 B'),
  ('bbbb2222-0000-0000-0000-00000000c202', 'bbbb2222-0000-0000-0000-00000000bb01',
   'bbbb2222-0000-0000-0000-000000000001', 'T2 B');

INSERT INTO public.task_dependencies (id, predecessor_id, successor_id, type) VALUES
  ('aaaa1111-0000-0000-0000-00000000d101',
   'aaaa1111-0000-0000-0000-00000000c101', 'aaaa1111-0000-0000-0000-00000000c102', 'FS'),
  ('bbbb2222-0000-0000-0000-00000000d201',
   'bbbb2222-0000-0000-0000-00000000c201', 'bbbb2222-0000-0000-0000-00000000c202', 'FS');

SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

SELECT is(
  (SELECT count(*)::int FROM public.task_dependencies WHERE id = 'aaaa1111-0000-0000-0000-00000000d101'),
  1, 'user_a can SELECT own-workspace task_dependency'
);

SELECT is(
  (SELECT count(*)::int FROM public.task_dependencies WHERE id = 'bbbb2222-0000-0000-0000-00000000d201'),
  0, 'user_a cannot SELECT workspace-B task_dependency'
);

WITH upd AS (
  UPDATE public.task_dependencies SET lag_days = 99
   WHERE id = 'bbbb2222-0000-0000-0000-00000000d201'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0, 'user_a cannot UPDATE workspace-B task_dependency');

INSERT INTO public.task_dependencies (id, predecessor_id, successor_id, type)
VALUES ('aaaa1111-0000-0000-0000-00000000d199',
        'aaaa1111-0000-0000-0000-00000000c102',
        'aaaa1111-0000-0000-0000-00000000c101', 'SS');

SELECT is(
  (SELECT created_by FROM public.task_dependencies WHERE id = 'aaaa1111-0000-0000-0000-00000000d199'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'task_dependencies audit trigger populates created_by'
);

SELECT * FROM finish();
ROLLBACK;
