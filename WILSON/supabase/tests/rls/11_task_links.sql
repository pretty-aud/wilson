-- pgTAP: task_links RLS (parent-join via tasks)
BEGIN;
SELECT plan(5);

SELECT * FROM tests.rls_setup();

INSERT INTO public.assets (id, project_id, name) VALUES
  ('aaaa1111-0000-0000-0000-00000000aa01', 'aaaa1111-0000-0000-0000-000000000001', 'Asset A'),
  ('bbbb2222-0000-0000-0000-00000000bb01', 'bbbb2222-0000-0000-0000-000000000001', 'Asset B');

INSERT INTO public.tasks (id, asset_id, project_id, title) VALUES
  ('aaaa1111-0000-0000-0000-00000000c101', 'aaaa1111-0000-0000-0000-00000000aa01',
   'aaaa1111-0000-0000-0000-000000000001', 'T1 A'),
  ('bbbb2222-0000-0000-0000-00000000c201', 'bbbb2222-0000-0000-0000-00000000bb01',
   'bbbb2222-0000-0000-0000-000000000001', 'T1 B');

INSERT INTO public.task_links (id, task_id, url) VALUES
  ('aaaa1111-0000-0000-0000-00000000ab01', 'aaaa1111-0000-0000-0000-00000000c101', 'https://a.example'),
  ('bbbb2222-0000-0000-0000-00000000ab02', 'bbbb2222-0000-0000-0000-00000000c201', 'https://b.example');

SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

SELECT is(
  (SELECT count(*)::int FROM public.task_links WHERE id = 'aaaa1111-0000-0000-0000-00000000ab01'),
  1, 'user_a can SELECT own-workspace task_link'
);

SELECT is(
  (SELECT count(*)::int FROM public.task_links WHERE id = 'bbbb2222-0000-0000-0000-00000000ab02'),
  0, 'user_a cannot SELECT workspace-B task_link'
);

WITH upd AS (
  UPDATE public.task_links SET url = 'https://hijack.example'
   WHERE id = 'bbbb2222-0000-0000-0000-00000000ab02'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0, 'user_a cannot UPDATE workspace-B task_link');

INSERT INTO public.task_links (id, task_id, url)
VALUES ('aaaa1111-0000-0000-0000-00000000ab99',
        'aaaa1111-0000-0000-0000-00000000c101', 'https://audit.example');

SELECT is(
  (SELECT created_by FROM public.task_links WHERE id = 'aaaa1111-0000-0000-0000-00000000ab99'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'task_links audit trigger populates created_by'
);


-- ── 0033: the migration-0011 privilege trap, for task_links ──
-- 0011's blanket GRANT plus its ALTER DEFAULT PRIVILEGES left anon holding
-- every table privilege on task_links; 0033 revoked it. Assert the revoke rather
-- than assume it — a policy-only check passes while a privilege hole is wide
-- open, which is exactly how 26 tables stayed open until S21 tripped over one.
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.task_links', 'SELECT') OR
    has_table_privilege('anon', 'public.task_links', 'INSERT') OR
    has_table_privilege('anon', 'public.task_links', 'UPDATE') OR
    has_table_privilege('anon', 'public.task_links', 'DELETE')
  ),
  'anon holds no table privilege on task_links'
);

SELECT * FROM finish();
ROLLBACK;
