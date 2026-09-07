-- pgTAP: files RLS (direct workspace_id)
--
-- Probes 6-9 were added by Session 24 / migration 0038, which made invoice
-- attachments work on the web. Uploading an invoice through the ordinary file
-- path would have made the PDF readable by every project member — hiding the
-- amount while serving the document that states it is not a policy, it is a
-- leak. `files.is_financial` plus the money gate closes it, and these probes
-- are what stop it being reopened by a well-meaning simplification.
--
-- Probes 10-12 were added by Session 27 / migration 0043, which gave `files`
-- the four entity links FileManager has always filtered on and the folder_id
-- that ties a file to the 0041 tree. They are FUNCTIONAL rather than
-- catalogue checks on purpose: the migration's own post-condition already
-- asserts the FKs are SET NULL, and re-asserting that here would only prove
-- the migration ran. What these prove is the BEHAVIOUR that choice buys —
-- that deleting a scene or a folder does not take the file row with it.
-- CASCADE and SET NULL differ by one word in the DDL and by "the blob is
-- still there but nothing knows where" in production.
BEGIN;
SELECT plan(12);

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


-- ═══════════════════════════════════════════════════════════════════════
-- 0043 — the entity and folder links
-- ═══════════════════════════════════════════════════════════════════════

-- Fixtures: one scene, one asset, one root folder, all on project A.
INSERT INTO public.assets (id, project_id, name)
VALUES ('aaaa1111-0000-0000-0000-0000000000a1',
        'aaaa1111-0000-0000-0000-000000000001', 'Hero')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.scenes (id, project_id, name)
VALUES ('aaaa1111-0000-0000-0000-0000000000c1',
        'aaaa1111-0000-0000-0000-000000000001', 'Sc001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.folders (id, project_id, workspace_id, parent_id, kind, slug, path)
VALUES ('aaaa1111-0000-0000-0000-0000000000d1',
        'aaaa1111-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111',
        NULL, 'root', 'project-a', '')
ON CONFLICT (id) DO NOTHING;

-- 10: the two axes are independent. phase_id/asset_id/task_id have always been
-- settable together, so an exclusivity constraint on the new columns would
-- refuse rows the existing upload path already writes. A file filed under
-- ASSETS/Hero while being ABOUT a scene is the ordinary case, not an edge one.
SELECT lives_ok(
  $$INSERT INTO public.files
      (id, project_id, name, storage_provider, storage_path,
       folder_id, scene_id, asset_id)
    VALUES ('aaaa1111-0000-0000-0000-00000000fe01',
            'aaaa1111-0000-0000-0000-000000000001',
            'ref.png', 'supabase', 'projects/a/scenes/c1/1-ref.png',
            'aaaa1111-0000-0000-0000-0000000000d1',
            'aaaa1111-0000-0000-0000-0000000000c1',
            'aaaa1111-0000-0000-0000-0000000000a1')$$,
  '0043: a file may carry folder_id, scene_id and asset_id at once');

-- 11: deleting the SCENE must not delete the file. A CASCADE here would
-- destroy the only record of where the blob lives, leaving an object in the
-- bucket that nothing references and only the GC orphan scan can ever find.
DELETE FROM public.scenes WHERE id = 'aaaa1111-0000-0000-0000-0000000000c1';

SELECT is(
  (SELECT count(*)::int FROM public.files
    WHERE id = 'aaaa1111-0000-0000-0000-00000000fe01' AND scene_id IS NULL),
  1,
  '0043: deleting a scene clears files.scene_id and KEEPS the file row');

-- 12: and the same for the folder. This is also Audrey's requirement seen from
-- the other side — "toggling a category off must never delete the folders"
-- would mean little if removing a folder deleted the files that were in it.
DELETE FROM public.folders WHERE id = 'aaaa1111-0000-0000-0000-0000000000d1';

SELECT is(
  (SELECT count(*)::int FROM public.files
    WHERE id = 'aaaa1111-0000-0000-0000-00000000fe01' AND folder_id IS NULL),
  1,
  '0043: deleting a folder clears files.folder_id and KEEPS the file row');

SELECT * FROM finish();
ROLLBACK;
