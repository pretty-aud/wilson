-- pgTAP: tasks RLS (direct workspace_id)
BEGIN;
SELECT plan(5);

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
