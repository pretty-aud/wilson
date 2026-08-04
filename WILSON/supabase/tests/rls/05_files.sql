-- pgTAP: files RLS (direct workspace_id)
--
-- Probes 6-9 were added by Session 24 / migration 0038, which made invoice
-- attachments work on the web. Uploading an invoice through the ordinary file
-- path would have made the PDF readable by every project member — hiding the
-- amount while serving the document that states it is not a policy, it is a
-- leak. `files.is_financial` plus the money gate closes it, and these probes
-- are what stop it being reopened by a well-meaning simplification.
BEGIN;
SELECT plan(9);

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


-- ═══════════════════════════════════════════════════════════════════════
-- 0038 — financial files are manager-only
-- ═══════════════════════════════════════════════════════════════════════

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

-- A plain team member on project A, and an invoice belonging to that project.
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local',
        crypt('testpw', gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        'authenticated', 'authenticated',
        '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES ('11111111-1111-1111-1111-111111111111',
        'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role)
VALUES ('aaaa1111-0000-0000-0000-000000000001',
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;

INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial)
VALUES ('aaaa1111-0000-0000-0000-00000000ff77',
        'aaaa1111-0000-0000-0000-000000000001',
        'invoice-001.pdf', 'supabase',
        'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/x/1-invoice-001.pdf',
        true);

-- 6: ordinary files are unaffected — the flag defaults to false.
SELECT is(
  (SELECT is_financial FROM public.files
    WHERE id = 'aaaa1111-0000-0000-0000-00000000ff01'),
  false,
  'files.is_financial defaults to false, so ordinary files behave exactly as before');

-- 7: a project MEMBER cannot see the invoice at all.
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.files
    WHERE id = 'aaaa1111-0000-0000-0000-00000000ff77'),
  0,
  'a project member cannot see a financial file — the invoice document, not just the amount');

-- 8: and cannot un-flag it to get at it. An RLS-refused UPDATE raises nothing
-- and affects zero rows, so assert the row is unchanged rather than trusting
-- the absence of an error (the silent-zero-rows hazard).
UPDATE public.files SET is_financial = false
 WHERE id = 'aaaa1111-0000-0000-0000-00000000ff77';

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

SELECT is(
  (SELECT is_financial FROM public.files
    WHERE id = 'aaaa1111-0000-0000-0000-00000000ff77'),
  true,
  'a project member cannot clear is_financial to reach the invoice');

-- 9: a workspace admin — money-cleared — reads it normally.
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.files
    WHERE id = 'aaaa1111-0000-0000-0000-00000000ff77'),
  1,
  'a workspace admin can read the invoice');

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;


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
