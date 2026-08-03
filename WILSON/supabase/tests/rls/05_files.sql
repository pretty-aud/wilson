-- pgTAP: files RLS (direct workspace_id)
BEGIN;
SELECT plan(5);

SELECT * FROM tests.rls_setup();

INSERT INTO public.files (id, project_id, name, storage_provider, storage_path) VALUES
  ('aaaa1111-0000-0000-0000-00000000ff01',
   'aaaa1111-0000-0000-0000-000000000001', 'a.txt', 'supabase', 'projects/a/a.txt'),
  ('bbbb2222-0000-0000-0000-00000000ff02',
   'bbbb2222-0000-0000-0000-000000000001', 'b.txt', 'supabase', 'projects/b/b.txt');

SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id = 'aaaa1111-0000-0000-0000-00000000ff01'),
  1, 'user_a can SELECT own-workspace file'
);

SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id = 'bbbb2222-0000-0000-0000-00000000ff02'),
  0, 'user_a cannot SELECT workspace-B file'
);

WITH upd AS (
  UPDATE public.files SET name = 'hijack' WHERE id = 'bbbb2222-0000-0000-0000-00000000ff02'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0, 'user_a cannot UPDATE workspace-B file');

INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
VALUES ('aaaa1111-0000-0000-0000-00000000ff99',
        'aaaa1111-0000-0000-0000-000000000001',
        'audit.txt', 'supabase', 'projects/a/audit.txt');

SELECT is(
  (SELECT created_by FROM public.files WHERE id = 'aaaa1111-0000-0000-0000-00000000ff99'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'files audit trigger populates created_by'
);


-- ── 0033: the migration-0011 privilege trap, for files ──
-- 0011's blanket GRANT plus its ALTER DEFAULT PRIVILEGES left anon holding
-- every table privilege on files; 0033 revoked it. Assert the revoke rather
-- than assume it — a policy-only check passes while a privilege hole is wide
-- open, which is exactly how 26 tables stayed open until S21 tripped over one.
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.files', 'SELECT') OR
    has_table_privilege('anon', 'public.files', 'INSERT') OR
    has_table_privilege('anon', 'public.files', 'UPDATE') OR
    has_table_privilege('anon', 'public.files', 'DELETE')
  ),
  'anon holds no table privilege on files'
);

SELECT * FROM finish();
ROLLBACK;
