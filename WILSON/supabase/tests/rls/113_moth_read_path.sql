-- =============================================================================
-- 113_moth_read_path.sql — migration 0111, Moth's read path and the one money
-- and Legal classifier (M.O.T.H. Session 1; docs/design/MOTH_DESIGN.md §1.4
-- "0111", §1.11 and §2.2 MR-1 to MR-5, CL-2).
--
-- What this pins:
--   * Moth reads are narrower than RLS. An admin, who reads money, Legal and
--     everyone's personal spaces through RLS (each control below proves it),
--     gets false from the gate and no rows from the three reads.
--   * The classifier: the money flag and key, the legal tag, the folder chain
--     (a money first path segment, a top-level money slug, a chain that cannot
--     be walked), and an expense of the file's OWN project.
--   * A working folder called Legal deep under SCENES stays visible. An expense
--     in another project does not hide a file.
--   * Missing and hidden answer alike. A foreign folder_id comes back NULL.
--   * The folder guard: a client never changes a folder's money or Legal
--     standing, detaches its first path segment, or deletes a money or Legal
--     folder or a project's root; a parent the caller cannot see answers like a
--     random uuid; an unbound session and a cascade pass.
--
-- 🚨 The MATRIX lines below are read by src/permissions/projectRoleMatrix.test.js:
--   -- MATRIX <action> | appRole | projectRole | staffed | personal | owner | expected
-- Each line's probe follows it directly, so the SQL helpers and the client's
-- canOnProject are held to one table (CL-2). Change a rule and both go red.
--
-- Fixture ids are hex: projects aaaa1111-…-00000000113x and …114x, folders
-- 11300000-…-0000000000xx, files 11300000-…-0000000001xx. user_a is the
-- admin (rls_setup); user_b the admin of the other workspace; user_c a plain
-- user with a member seat on project S; user_d an app manager with no seat;
-- user_e a plain user with a reviewer seat on S; user_f a plain user with a
-- manager seat on S; a ninth user is an inactive member.
-- =============================================================================

BEGIN;

SELECT plan(290);

SELECT * FROM tests.rls_setup();

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user_d@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user_e@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'user_f@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('99999999-9999-9999-9999-999999999999', 'user_n@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active) VALUES
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager', 'user_d', 'User D', true),
  ('11111111-1111-1111-1111-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user', 'user_e', 'User E', true),
  ('11111111-1111-1111-1111-111111111111', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'user', 'user_f', 'User F', true),
  ('11111111-1111-1111-1111-111111111111', '99999999-9999-9999-9999-999999999999', 'user', 'user_n', 'User N', false)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- As the runner: no auth context, so nothing is auto-staffed and the guards pass.
INSERT INTO public.projects (id, workspace_id, title, is_private, created_by) VALUES
  ('aaaa1111-0000-0000-0000-000000001131', '11111111-1111-1111-1111-111111111111', 'Shared S', false, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('aaaa1111-0000-0000-0000-000000001132', '11111111-1111-1111-1111-111111111111', 'Shared T', false, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('aaaa1111-0000-0000-0000-000000001133', '11111111-1111-1111-1111-111111111111', 'Hidden H', true, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  ('aaaa1111-0000-0000-0000-000000001134', '11111111-1111-1111-1111-111111111111', 'Binned', false, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('aaaa1111-0000-0000-0000-000000001141', '11111111-1111-1111-1111-111111111111', 'Matrix manager seats', false, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('aaaa1111-0000-0000-0000-000000001142', '11111111-1111-1111-1111-111111111111', 'Matrix member seats', false, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('aaaa1111-0000-0000-0000-000000001143', '11111111-1111-1111-1111-111111111111', 'Matrix reviewer seats', false, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('aaaa1111-0000-0000-0000-000000001144', '11111111-1111-1111-1111-111111111111', 'Matrix no seat', false, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('aaaa1111-0000-0000-0000-000000001145', '11111111-1111-1111-1111-111111111111', 'Matrix unstaffed', false, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO public.projects (id, workspace_id, title, is_private, personal_owner_id, created_by) VALUES
  ('aaaa1111-0000-0000-0000-000000001135', '11111111-1111-1111-1111-111111111111', 'Personal space', true, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('aaaa1111-0000-0000-0000-000000001136', '11111111-1111-1111-1111-111111111111', 'Personal space', true, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('aaaa1111-0000-0000-0000-000000001137', '11111111-1111-1111-1111-111111111111', 'Personal space', true, 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  ('aaaa1111-0000-0000-0000-000000001138', '11111111-1111-1111-1111-111111111111', 'Personal space', true, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');

INSERT INTO public.project_members (project_id, user_id, project_role) VALUES
  ('aaaa1111-0000-0000-0000-000000001135', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'manager'),
  ('aaaa1111-0000-0000-0000-000000001136', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'manager'),
  ('aaaa1111-0000-0000-0000-000000001137', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager'),
  ('aaaa1111-0000-0000-0000-000000001138', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'manager'),
  ('aaaa1111-0000-0000-0000-000000001131', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'member'),
  ('aaaa1111-0000-0000-0000-000000001131', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'reviewer'),
  ('aaaa1111-0000-0000-0000-000000001131', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'manager'),
  ('aaaa1111-0000-0000-0000-000000001131', '99999999-9999-9999-9999-999999999999', 'member'),
  ('aaaa1111-0000-0000-0000-000000001144', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'manager'),
  ('aaaa1111-0000-0000-0000-000000001141', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'manager'),
  ('aaaa1111-0000-0000-0000-000000001142', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'member'),
  ('aaaa1111-0000-0000-0000-000000001143', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'reviewer'),
  ('aaaa1111-0000-0000-0000-000000001141', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager'),
  ('aaaa1111-0000-0000-0000-000000001142', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'member'),
  ('aaaa1111-0000-0000-0000-000000001143', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'reviewer'),
  ('aaaa1111-0000-0000-0000-000000001141', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'manager'),
  ('aaaa1111-0000-0000-0000-000000001142', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'member'),
  ('aaaa1111-0000-0000-0000-000000001143', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'reviewer');

INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('11300000-0000-0000-0000-0000000000f0', 'aaaa1111-0000-0000-0000-000000001131', NULL, 'root', 'shared-s', ''),
  ('11300000-0000-0000-0000-0000000000f1', 'aaaa1111-0000-0000-0000-000000001131', '11300000-0000-0000-0000-0000000000f0', 'category', 'SCENES', 'SCENES'),
  ('11300000-0000-0000-0000-0000000000f2', 'aaaa1111-0000-0000-0000-000000001131', '11300000-0000-0000-0000-0000000000f1', 'custom', 'one', 'SCENES/one'),
  ('11300000-0000-0000-0000-0000000000f3', 'aaaa1111-0000-0000-0000-000000001131', '11300000-0000-0000-0000-0000000000f2', 'custom', 'Legal', 'SCENES/one/Legal'),
  ('11300000-0000-0000-0000-0000000000f4', 'aaaa1111-0000-0000-0000-000000001131', '11300000-0000-0000-0000-0000000000f0', 'category', 'INVOICES', 'INVOICES'),
  ('11300000-0000-0000-0000-0000000000f5', 'aaaa1111-0000-0000-0000-000000001131', '11300000-0000-0000-0000-0000000000f4', 'custom', 'x', 'INVOICES/x'),
  ('11300000-0000-0000-0000-0000000000f6', 'aaaa1111-0000-0000-0000-000000001131', '11300000-0000-0000-0000-0000000000f0', 'category', 'INVOICES', 'Receipts-old'),
  ('11300000-0000-0000-0000-0000000000f7', 'aaaa1111-0000-0000-0000-000000001131', '11300000-0000-0000-0000-0000000000f6', 'custom', 'y', 'Receipts-old/y'),
  ('11300000-0000-0000-0000-0000000000f8', 'aaaa1111-0000-0000-0000-000000001131', '11300000-0000-0000-0000-0000000000f0', 'custom', 'finance', 'finance'),
  ('11300000-0000-0000-0000-0000000000f9', 'aaaa1111-0000-0000-0000-000000001131', '11300000-0000-0000-0000-0000000000f0', 'custom', 'LEGAL', 'LEGAL'),
  ('11300000-0000-0000-0000-0000000000fa', 'aaaa1111-0000-0000-0000-000000001131', '11300000-0000-0000-0000-0000000000f0', 'custom', 'Disposable', 'Disposable'),
  ('11300000-0000-0000-0000-0000000000b0', 'aaaa1111-0000-0000-0000-000000001132', NULL, 'root', 'Legal', ''),
  ('11300000-0000-0000-0000-0000000000b1', 'aaaa1111-0000-0000-0000-000000001132', '11300000-0000-0000-0000-0000000000b0', 'custom', 'Stuff', 'Stuff'),
  ('11300000-0000-0000-0000-0000000000b2', 'aaaa1111-0000-0000-0000-000000001132', '11300000-0000-0000-0000-0000000000b0', 'custom', 'Loop', 'Loop'),
  ('11300000-0000-0000-0000-0000000000b3', 'aaaa1111-0000-0000-0000-000000001132', '11300000-0000-0000-0000-0000000000b2', 'custom', 'b', 'Loop/b'),
  ('11300000-0000-0000-0000-0000000000c0', 'aaaa1111-0000-0000-0000-000000001133', NULL, 'root', 'hidden-h', ''),
  ('11300000-0000-0000-0000-0000000000c1', 'aaaa1111-0000-0000-0000-000000001133', '11300000-0000-0000-0000-0000000000c0', 'custom', 'Private', 'Private'),
  ('11300000-0000-0000-0000-0000000000d0', 'aaaa1111-0000-0000-0000-000000001138', NULL, 'root', 'ps-e', ''),
  ('11300000-0000-0000-0000-0000000000d1', 'aaaa1111-0000-0000-0000-000000001138', '11300000-0000-0000-0000-0000000000d0', 'custom', 'Docs', 'Docs'),
  ('11300000-0000-0000-0000-0000000000e0', 'aaaa1111-0000-0000-0000-000000001136', NULL, 'root', 'ps-c', ''),
  ('11300000-0000-0000-0000-0000000000e1', 'aaaa1111-0000-0000-0000-000000001136', '11300000-0000-0000-0000-0000000000e0', 'custom', 'Notes', 'Notes');
UPDATE public.folders SET parent_id = '11300000-0000-0000-0000-0000000000b3' WHERE id = '11300000-0000-0000-0000-0000000000b2'; -- b2 and b3 now point at each other

-- Two rows below name a folder of another project, which 0113's key refuses. The
-- key goes for this transaction only: it pins the read's positive form, which stands
-- in case a row ever reaches that state some other way.
ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_folder_same_project_fk;
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, folder_id, is_financial, tags, deleted_at) VALUES
  ('11300000-0000-0000-0000-0000000001a1', 'aaaa1111-0000-0000-0000-000000001131', 'ok.txt', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000001131/files/11300000-0000-0000-0000-0000000001a1/ok.txt', '11300000-0000-0000-0000-0000000000f2'::uuid, false, '{}'::text[], NULL),
  ('11300000-0000-0000-0000-0000000001a2', 'aaaa1111-0000-0000-0000-000000001131', 'flag.pdf', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000001131/files/11300000-0000-0000-0000-0000000001a2/flag.pdf', NULL, true, '{}'::text[], NULL),
  ('11300000-0000-0000-0000-0000000001a3', 'aaaa1111-0000-0000-0000-000000001131', 'inv.pdf', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000001131/INVOICES/aaaa1111-0000-0000-0000-000000001131/11300000-0000-0000-0000-0000000001a3-inv.pdf', NULL, false, '{}'::text[], NULL),
  ('11300000-0000-0000-0000-0000000001a4', 'aaaa1111-0000-0000-0000-000000001131', 'fin.pdf', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000001131/FINANCE/aaaa1111-0000-0000-0000-000000001131/11300000-0000-0000-0000-0000000001a4-fin.pdf', NULL, false, '{}'::text[], NULL),
  ('11300000-0000-0000-0000-0000000001a5', 'aaaa1111-0000-0000-0000-000000001131', 'leg.pdf', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000001131/LEGAL/aaaa1111-0000-0000-0000-000000001131/11300000-0000-0000-0000-0000000001a5-leg.pdf', NULL, false, ARRAY['legal']::text[], NULL),
  ('11300000-0000-0000-0000-0000000001a6', 'aaaa1111-0000-0000-0000-000000001131', 'receipt.pdf', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000001131/files/11300000-0000-0000-0000-0000000001a6/receipt.pdf', NULL, false, '{}'::text[], NULL),
  ('11300000-0000-0000-0000-0000000001a7', 'aaaa1111-0000-0000-0000-000000001131', 'other-expense.pdf', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000001131/files/11300000-0000-0000-0000-0000000001a7/other-expense.pdf', NULL, false, '{}'::text[], NULL),
  ('11300000-0000-0000-0000-0000000001a8', 'aaaa1111-0000-0000-0000-000000001131', 'under-inv-x.txt', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000001131/files/11300000-0000-0000-0000-0000000001a8/under-inv-x.txt', '11300000-0000-0000-0000-0000000000f5'::uuid, false, '{}'::text[], NULL),
  ('11300000-0000-0000-0000-0000000001a9', 'aaaa1111-0000-0000-0000-000000001131', 'under-inv.txt', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000001131/files/11300000-0000-0000-0000-0000000001a9/under-inv.txt', '11300000-0000-0000-0000-0000000000f4'::uuid, false, '{}'::text[], NULL),
  ('11300000-0000-0000-0000-0000000001aa', 'aaaa1111-0000-0000-0000-000000001131', 'under-renamed.txt', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000001131/files/11300000-0000-0000-0000-0000000001aa/under-renamed.txt', '11300000-0000-0000-0000-0000000000f7'::uuid, false, '{}'::text[], NULL),
  ('11300000-0000-0000-0000-0000000001ab', 'aaaa1111-0000-0000-0000-000000001131', 'under-finance.txt', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000001131/files/11300000-0000-0000-0000-0000000001ab/under-finance.txt', '11300000-0000-0000-0000-0000000000f8'::uuid, false, '{}'::text[], NULL),
  ('11300000-0000-0000-0000-0000000001ac', 'aaaa1111-0000-0000-0000-000000001131', 'under-legal.txt', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000001131/files/11300000-0000-0000-0000-0000000001ac/under-legal.txt', '11300000-0000-0000-0000-0000000000f9'::uuid, false, '{}'::text[], NULL),
  ('11300000-0000-0000-0000-0000000001ad', 'aaaa1111-0000-0000-0000-000000001131', 'under-deep-legal.txt', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000001131/files/11300000-0000-0000-0000-0000000001ad/under-deep-legal.txt', '11300000-0000-0000-0000-0000000000f3'::uuid, false, '{}'::text[], NULL),
  ('11300000-0000-0000-0000-0000000001ae', 'aaaa1111-0000-0000-0000-000000001131', 'binned.txt', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000001131/files/11300000-0000-0000-0000-0000000001ae/binned.txt', NULL, false, '{}'::text[], now()),
  ('11300000-0000-0000-0000-0000000001af', 'aaaa1111-0000-0000-0000-000000001131', 'foreign-folder.txt', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000001131/files/11300000-0000-0000-0000-0000000001af/foreign-folder.txt', '11300000-0000-0000-0000-0000000000b1'::uuid, false, '{}'::text[], NULL),
  ('11300000-0000-0000-0000-0000000001b0', 'aaaa1111-0000-0000-0000-000000001131', 'folder-in-a-space.txt', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000001131/files/11300000-0000-0000-0000-0000000001b0/folder-in-a-space.txt', '11300000-0000-0000-0000-0000000000d1'::uuid, false, '{}'::text[], NULL),
  ('11300000-0000-0000-0000-0000000001b1', 'aaaa1111-0000-0000-0000-000000001132', 'in-t.txt', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000001132/files/11300000-0000-0000-0000-0000000001b1/in-t.txt', NULL, false, '{}'::text[], NULL),
  ('11300000-0000-0000-0000-0000000001b2', 'aaaa1111-0000-0000-0000-000000001132', 'under-loop.txt', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000001132/files/11300000-0000-0000-0000-0000000001b2/under-loop.txt', '11300000-0000-0000-0000-0000000000b3'::uuid, false, '{}'::text[], NULL),
  ('11300000-0000-0000-0000-0000000001c1', 'aaaa1111-0000-0000-0000-000000001133', 'in-hidden.txt', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000001133/files/11300000-0000-0000-0000-0000000001c1/in-hidden.txt', '11300000-0000-0000-0000-0000000000c1'::uuid, false, '{}'::text[], NULL),
  ('11300000-0000-0000-0000-0000000001d1', 'aaaa1111-0000-0000-0000-000000001138', 'in-e-space.txt', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000001138/files/11300000-0000-0000-0000-0000000001d1/in-e-space.txt', '11300000-0000-0000-0000-0000000000d1'::uuid, false, '{}'::text[], NULL),
  ('11300000-0000-0000-0000-0000000001e1', 'aaaa1111-0000-0000-0000-000000001136', 'in-c-space.txt', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000001136/files/11300000-0000-0000-0000-0000000001e1/in-c-space.txt', '11300000-0000-0000-0000-0000000000e1'::uuid, false, '{}'::text[], NULL),
  ('11300000-0000-0000-0000-0000000001f1', 'aaaa1111-0000-0000-0000-000000001134', 'in-binned-project.txt', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000001134/files/11300000-0000-0000-0000-0000000001f1/in-binned-project.txt', NULL, false, '{}'::text[], NULL),
  ('11300000-0000-0000-0000-0000000001f2', 'aaaa1111-0000-0000-0000-000000001134', 'trashed-in-binned-project.txt', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000001134/files/11300000-0000-0000-0000-0000000001f2/trashed-in-binned-project.txt', NULL, false, '{}'::text[], now()),
  ('11300000-0000-0000-0000-0000000001f3', 'bbbb2222-0000-0000-0000-000000000001', 'other-company.txt', 'supabase', 'projects/bbbb2222-0000-0000-0000-000000000001/files/11300000-0000-0000-0000-0000000001f3/other-company.txt', NULL, false, '{}'::text[], NULL);

INSERT INTO public.expenses (id, workspace_id, project_id, title, file_ids) VALUES
  ('11300000-0000-0000-0000-000000000201', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000001131', 'names its own project''s file, and one already gone', ARRAY['11300000-0000-0000-0000-0000000001a6', '11300000-dead-dead-dead-000000000001']::uuid[]),
  ('11300000-0000-0000-0000-000000000202', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000001132', 'names another project''s file', ARRAY['11300000-0000-0000-0000-0000000001a7']::uuid[]);

UPDATE public.projects SET deleted_at = now() WHERE id = 'aaaa1111-0000-0000-0000-000000001134';

-- ── The objects: who may call what, and what the reads return ──────────────
SELECT ok(NOT has_function_privilege('authenticated', 'public._moth_target_eligible(text,uuid,boolean)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public._moth_target_eligible(text,uuid,boolean)', 'EXECUTE'),
  '_moth_target_eligible is closed to clients');
SELECT ok(NOT has_function_privilege('authenticated', 'public.moth_file_row_locked(uuid,uuid,uuid,boolean,text,text[],uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.moth_file_row_locked(uuid,uuid,uuid,boolean,text,text[],uuid)', 'EXECUTE'),
  'moth_file_row_locked is closed to clients');
SELECT ok(NOT has_function_privilege('authenticated', 'public.moth_folder_chain_locked(uuid,uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.moth_folder_chain_locked(uuid,uuid)', 'EXECUTE'),
  'moth_folder_chain_locked is closed to clients');
SELECT ok(NOT has_function_privilege('authenticated', 'public.fn_folders_lock_guard()', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.fn_folders_lock_guard()', 'EXECUTE'),
  'fn_folders_lock_guard is closed to clients');
SELECT ok(has_function_privilege('authenticated', 'public.moth_can_read_target(text,uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.moth_can_read_target(text,uuid)', 'EXECUTE'),
  'moth_can_read_target is for signed-in callers only');
SELECT ok(has_function_privilege('authenticated', 'public.moth_can_write_target(text,uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.moth_can_write_target(text,uuid)', 'EXECUTE'),
  'moth_can_write_target is for signed-in callers only');
SELECT ok(has_function_privilege('authenticated', 'public.moth_islands()', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.moth_islands()', 'EXECUTE'),
  'moth_islands is for signed-in callers only');
SELECT ok(has_function_privilege('authenticated', 'public.moth_project_folders(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.moth_project_folders(uuid)', 'EXECUTE'),
  'moth_project_folders is for signed-in callers only');
SELECT ok(has_function_privilege('authenticated', 'public.moth_project_files(uuid,uuid,integer)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.moth_project_files(uuid,uuid,integer)', 'EXECUTE'),
  'moth_project_files is for signed-in callers only');
SELECT is((SELECT bool_or(prosecdef) FROM pg_proc
             WHERE oid IN ('public.moth_islands()'::regprocedure,
                           'public.moth_project_folders(uuid)'::regprocedure,
                           'public.moth_project_files(uuid,uuid,integer)'::regprocedure,
                           'public.fn_folders_lock_guard()'::regprocedure)),
  false, 'the three reads and the folder guard run as the caller');
SELECT is((SELECT count(*)::int FROM pg_proc
             WHERE oid IN ('public.moth_islands()'::regprocedure,
                           'public.moth_project_folders(uuid)'::regprocedure,
                           'public.moth_project_files(uuid,uuid,integer)'::regprocedure)
               AND pg_get_function_result(oid) ~* '(is_financial|created_by|deleted_by|count|total)'),
  0, 'no read returns the money flag, a creator, or a count');
SELECT ok(EXISTS (SELECT 1 FROM pg_indexes
                   WHERE schemaname = 'public' AND tablename = 'expenses'
                     AND indexname = 'expenses_file_ids_gin' AND indexdef ILIKE '%USING gin (file_ids)%'),
  'the receipt arm has its index');

-- ── The classifier on row images (as the runner, which owns the definers) ──
SELECT is(public.moth_folder_path_locked('INVOICES/x'), true, 'a money first segment is locked');
SELECT is(public.moth_folder_path_locked('invoices'), true, 'the first segment is case-folded');
SELECT is(public.moth_folder_path_locked('SCENES/Legal'), false, 'a deeper segment does not lock');
SELECT is(public.moth_folder_path_locked(NULL), false, 'NULL is not locked, and not NULL');
SELECT is(public.moth_file_row_locked('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000001131', '11300000-dead-dead-dead-000000000000', false, 'projects/x/files/y/z.txt', ARRAY[]::text[], NULL), false, 'a plain row image is not locked');
SELECT is(public.moth_file_row_locked('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000001131', '11300000-dead-dead-dead-000000000000', false, 'projects/x/files/y/z.txt', NULL, NULL), false, 'NULL tags answer false, never NULL');
SELECT is(public.moth_file_row_locked('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000001131', '11300000-dead-dead-dead-000000000000', true, 'projects/x/files/y/z.txt', ARRAY[]::text[], NULL), true, 'the money flag locks');
SELECT is(public.moth_file_row_locked('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000001131', '11300000-dead-dead-dead-000000000000', false, 'projects/x/FINANCE/y/z.txt', ARRAY[]::text[], NULL), true, 'a money key locks');
SELECT is(public.moth_file_row_locked('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000001131', '11300000-dead-dead-dead-000000000000', false, 'projects/x/files/y/z.txt', ARRAY['legal']::text[], NULL), true, 'the legal tag locks');
SELECT is(public.moth_file_row_locked('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000001131', '11300000-dead-dead-dead-000000000000', false, 'projects/x/files/y/z.txt', ARRAY[]::text[], '11300000-0000-0000-0000-0000000000f5'), true, 'a folder under a money top level locks');
SELECT is(public.moth_file_row_locked('22222222-2222-2222-2222-222222222222', 'bbbb2222-0000-0000-0000-000000000001', '11300000-dead-dead-dead-000000000000', false, 'projects/x/files/y/z.txt', ARRAY[]::text[], '11300000-0000-0000-0000-0000000000f5'), false, 'a folder of another company is not walked');
SELECT is(public.moth_file_row_locked('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000001131', '11300000-0000-0000-0000-0000000001a6', false, 'projects/x/files/y/z.txt', ARRAY[]::text[], NULL), true, 'a file its own project''s expense names is locked');
SELECT is(public.moth_file_row_locked('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000001131', '11300000-0000-0000-0000-0000000001a7', false, 'projects/x/files/y/z.txt', ARRAY[]::text[], NULL), false, 'a file only another project''s expense names is not');
-- The row image alone decides: 0119's AFTER DELETE capture has no live row to read.
SELECT is(public.moth_file_row_locked('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000001131', '11300000-dead-dead-dead-000000000001', false, 'projects/x/files/y/z.txt', ARRAY[]::text[], NULL), true, 'a receipt whose row is already gone is still locked');

-- ── user_c: a plain user with a member seat on S and a personal space ─────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(public.moth_can_read_target('project', 'aaaa1111-0000-0000-0000-000000001136'), true, 'the owner reads their own space');
SELECT is(public.moth_can_read_target('folder', '11300000-0000-0000-0000-0000000000e1'), true, 'the owner reads a folder of their own space');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001e1'), true, 'the owner reads a file of their own space');
SELECT is(public.moth_can_write_target('project', 'aaaa1111-0000-0000-0000-000000001136'), true, 'the owner writes their own space');
SELECT is(public.moth_can_write_target('file', '11300000-0000-0000-0000-0000000001e1'), true, 'the owner writes a file of their own space');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a1'), true, 'a member reads an ordinary shared file');
SELECT is(public.moth_can_write_target('file', '11300000-0000-0000-0000-0000000001a1'), true, 'a member writes an ordinary shared file');
SELECT is(public.moth_can_read_target('folder', '11300000-0000-0000-0000-0000000000f2'), true, 'a member reads an ordinary shared folder');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a7'), true, 'an expense in another project does not hide a file');
SELECT is(public.moth_can_read_target('folder', '11300000-0000-0000-0000-0000000000f3'), true, 'a working folder called Legal deep under SCENES is visible');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001ad'), true, 'a file in it is visible');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a2'), false, 'hidden from a member: the money flag');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a3'), false, 'hidden from a member: an INVOICES key');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a4'), false, 'hidden from a member: a FINANCE key');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a5'), false, 'hidden from a member: a LEGAL key');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a6'), false, 'hidden from a member: an unflagged receipt its own projects expense names');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a8'), false, 'hidden from a member: a file under INVOICES/x');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a9'), false, 'hidden from a member: a file under INVOICES');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001aa'), false, 'hidden from a member: a file under a renamed category whose slug says INVOICES');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001ab'), false, 'hidden from a member: a file under a lower-case finance folder');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001ac'), false, 'hidden from a member: a file under LEGAL');
SELECT is(public.moth_can_read_target('folder', '11300000-0000-0000-0000-0000000000f4'), false, 'hidden from a member: INVOICES');
SELECT is(public.moth_can_read_target('folder', '11300000-0000-0000-0000-0000000000f5'), false, 'hidden from a member: INVOICES/x');
SELECT is(public.moth_can_read_target('folder', '11300000-0000-0000-0000-0000000000f6'), false, 'hidden from a member: a renamed category whose slug says INVOICES');
SELECT is(public.moth_can_read_target('folder', '11300000-0000-0000-0000-0000000000f7'), false, 'hidden from a member: a folder under it');
SELECT is(public.moth_can_read_target('folder', '11300000-0000-0000-0000-0000000000f8'), false, 'hidden from a member: a lower-case finance folder');
SELECT is(public.moth_can_read_target('folder', '11300000-0000-0000-0000-0000000000f9'), false, 'hidden from a member: LEGAL');
SELECT is(public.moth_can_write_target('file', '11300000-0000-0000-0000-0000000001a3'), false, 'no write gate on money, even for someone who writes the project');
SELECT is(public.moth_can_write_target('folder', '11300000-0000-0000-0000-0000000000f4'), false, 'no write gate on a money folder');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001ae'), false, 'a binned file is hidden');
SELECT is(public.moth_can_read_target('project', 'aaaa1111-0000-0000-0000-000000001134'), false, 'a binned project is hidden');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001f1'), false, 'a live file of a binned project is hidden');
SELECT is(public.moth_can_read_target('project', 'aaaa1111-0000-0000-0000-000000001138'), false, 'another persons space is hidden');
SELECT is(public.moth_can_read_target('folder', '11300000-0000-0000-0000-0000000000d1'), false, 'a folder of another persons space is hidden');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001d1'), false, 'a file of another persons space is hidden');
SELECT is(public.moth_can_read_target('project', 'aaaa1111-0000-0000-0000-000000001133'), false, 'someone elses private project is hidden');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001c1'), false, 'a file of it is hidden');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001f3'), false, 'another companys file is hidden');
SELECT is(public.moth_can_read_target('project', 'bbbb2222-0000-0000-0000-000000000001'), false, 'another companys project is hidden');
SELECT is(public.moth_can_read_target('folder', '11300000-0000-0000-0000-0000000000b3'), false, 'a folder on a looping chain fails closed');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001b2'), false, 'a file under it fails closed');
SELECT is(public.moth_can_read_target('project', '11300000-0000-0000-0000-0000000001a1'), false, 'a file''s id forged as a project is false');
SELECT is(public.moth_can_read_target('file', 'aaaa1111-0000-0000-0000-000000001131'), false, 'a project''s id forged as a file is false');
SELECT is(public.moth_can_read_target('folder', '11300000-0000-0000-0000-0000000001a1'), false, 'a file''s id forged as a folder is false');
SELECT is(public.moth_can_read_target('note', '11300000-0000-0000-0000-0000000001a1'), false, 'an unknown kind is false');
SELECT is(public.moth_can_read_target(NULL, '11300000-0000-0000-0000-0000000001a1'), false, 'a NULL kind is false');
SELECT is(public.moth_can_read_target('file', NULL), false, 'a NULL id is false');
SELECT is(public.moth_can_read_target('file', '11300000-dead-dead-dead-000000000000'), false, 'a missing file is false');
SELECT is(public.moth_can_write_target('file', '11300000-dead-dead-dead-000000000000'), false, 'a missing file has no write gate');

SELECT is((SELECT array_agg(id ORDER BY id) FROM public.moth_project_files('aaaa1111-0000-0000-0000-000000001131')), ARRAY['11300000-0000-0000-0000-0000000001a1', '11300000-0000-0000-0000-0000000001a7', '11300000-0000-0000-0000-0000000001ad', '11300000-0000-0000-0000-0000000001af', '11300000-0000-0000-0000-0000000001b0']::uuid[],
  'a member lists exactly the files that are not money or Legal');
SELECT is((SELECT folder_id FROM public.moth_project_files('aaaa1111-0000-0000-0000-000000001131') WHERE id = '11300000-0000-0000-0000-0000000001a1'), '11300000-0000-0000-0000-0000000000f2'::uuid, 'a folder of the same project comes back');
SELECT is((SELECT folder_id FROM public.moth_project_files('aaaa1111-0000-0000-0000-000000001131') WHERE id = '11300000-0000-0000-0000-0000000001af'), NULL::uuid, 'a folder id from another project comes back NULL');
SELECT is((SELECT folder_id FROM public.moth_project_files('aaaa1111-0000-0000-0000-000000001131') WHERE id = '11300000-0000-0000-0000-0000000001b0'), NULL::uuid, 'a folder id from someone''s personal space comes back NULL');
SELECT is((SELECT array_agg(id ORDER BY id) FROM public.moth_project_folders('aaaa1111-0000-0000-0000-000000001131')), ARRAY['11300000-0000-0000-0000-0000000000f0', '11300000-0000-0000-0000-0000000000f1', '11300000-0000-0000-0000-0000000000f2', '11300000-0000-0000-0000-0000000000f3', '11300000-0000-0000-0000-0000000000fa']::uuid[],
  'a member lists exactly the folders that are not money or Legal');
SELECT is((SELECT parent_id FROM public.moth_project_folders('aaaa1111-0000-0000-0000-000000001131') WHERE id = '11300000-0000-0000-0000-0000000000f2'), '11300000-0000-0000-0000-0000000000f1'::uuid, 'a folder''s parent comes back');
SELECT is((SELECT parent_id FROM public.moth_project_folders('aaaa1111-0000-0000-0000-000000001131') WHERE id = '11300000-0000-0000-0000-0000000000f0'), NULL::uuid, 'the root has no parent');
SELECT is((SELECT array_agg(id ORDER BY id) FROM public.moth_project_folders('aaaa1111-0000-0000-0000-000000001132')), ARRAY['11300000-0000-0000-0000-0000000000b0', '11300000-0000-0000-0000-0000000000b1']::uuid[],
  'a looping chain is left out of the list');
SELECT is((SELECT count(*)::int FROM public.moth_project_files('aaaa1111-0000-0000-0000-000000001133')) + (SELECT count(*)::int FROM public.moth_project_folders('aaaa1111-0000-0000-0000-000000001133')), 0, 'no rows and no error for someone elses private project');
SELECT is((SELECT count(*)::int FROM public.moth_project_files('aaaa1111-0000-0000-0000-000000001138')) + (SELECT count(*)::int FROM public.moth_project_folders('aaaa1111-0000-0000-0000-000000001138')), 0, 'no rows and no error for another persons space');
SELECT is((SELECT count(*)::int FROM public.moth_project_files('aaaa1111-0000-0000-0000-000000001134')) + (SELECT count(*)::int FROM public.moth_project_folders('aaaa1111-0000-0000-0000-000000001134')), 0, 'no rows and no error for a binned project');
SELECT is((SELECT count(*)::int FROM public.moth_project_files('bbbb2222-0000-0000-0000-000000000001')) + (SELECT count(*)::int FROM public.moth_project_folders('bbbb2222-0000-0000-0000-000000000001')), 0, 'no rows and no error for another companys project');
SELECT is((SELECT count(*)::int FROM public.moth_project_files('11300000-dead-dead-dead-000000000000')) + (SELECT count(*)::int FROM public.moth_project_folders('11300000-dead-dead-dead-000000000000')), 0, 'no rows and no error for a missing project');

SELECT is((SELECT array_agg(id) FROM public.moth_project_files('aaaa1111-0000-0000-0000-000000001131', NULL, 1)), ARRAY['11300000-0000-0000-0000-0000000001a1']::uuid[], 'a page of one is the lowest id');
SELECT is((SELECT array_agg(id ORDER BY id) FROM public.moth_project_files('aaaa1111-0000-0000-0000-000000001131', '11300000-0000-0000-0000-0000000001a7')), ARRAY['11300000-0000-0000-0000-0000000001ad', '11300000-0000-0000-0000-0000000001af', '11300000-0000-0000-0000-0000000001b0']::uuid[], 'the keyset starts after the id it is given');
SELECT is((SELECT count(*)::int FROM public.moth_project_files('aaaa1111-0000-0000-0000-000000001131', NULL, 0)), 1, 'a limit of 0 clamps to 1');
SELECT is((SELECT count(*)::int FROM public.moth_project_files('aaaa1111-0000-0000-0000-000000001131', NULL, -5)), 1, 'a negative limit clamps to 1');
SELECT is((SELECT count(*)::int FROM public.moth_project_files('aaaa1111-0000-0000-0000-000000001131', NULL, NULL)), 5, 'a NULL limit takes the default');

SELECT is((SELECT array_agg(id ORDER BY id) FROM public.moth_islands() WHERE id IN ('aaaa1111-0000-0000-0000-000000001131', 'aaaa1111-0000-0000-0000-000000001132', 'aaaa1111-0000-0000-0000-000000001133', 'aaaa1111-0000-0000-0000-000000001134', 'aaaa1111-0000-0000-0000-000000001135', 'aaaa1111-0000-0000-0000-000000001136', 'aaaa1111-0000-0000-0000-000000001137', 'aaaa1111-0000-0000-0000-000000001138')),
  ARRAY['aaaa1111-0000-0000-0000-000000001131', 'aaaa1111-0000-0000-0000-000000001132', 'aaaa1111-0000-0000-0000-000000001136']::uuid[], 'a member''s islands: the shared projects and their own space');
SELECT is((SELECT row(is_personal, is_mine, is_private, my_project_role, is_staffed, can_write)::text FROM public.moth_islands() WHERE id = 'aaaa1111-0000-0000-0000-000000001136'),
  '(t,t,t,manager,t,t)', 'their own space: personal, theirs, private, one manager seat, writable');
SELECT is((SELECT row(is_personal, is_mine, is_private, my_project_role, is_staffed, can_write)::text FROM public.moth_islands() WHERE id = 'aaaa1111-0000-0000-0000-000000001131'),
  '(f,f,f,member,t,t)', 'a shared project: is_mine is false, never NULL, and the seat comes from the server');
SELECT is((SELECT id FROM public.moth_islands() LIMIT 1), 'aaaa1111-0000-0000-0000-000000001136'::uuid, 'the caller''s own space comes first');

-- ── user_e: a reviewer on S, and the creator of the private project H ──────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a1'), true, 'a reviewer reads an ordinary shared file');
SELECT is(public.moth_can_write_target('file', '11300000-0000-0000-0000-0000000001a1'), false, 'a reviewer does not write it');
SELECT is(public.moth_can_read_target('project', 'aaaa1111-0000-0000-0000-000000001133'), true, 'a private projects creator reads it');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001c1'), true, 'and a file of it');
SELECT is(public.moth_can_read_target('project', 'aaaa1111-0000-0000-0000-000000001136'), false, 'another persons space stays hidden');

-- ── user_f: a manager seat on S, which opens money through RLS ─────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*)::int FROM public.files WHERE id IN ('11300000-0000-0000-0000-0000000001a2', '11300000-0000-0000-0000-0000000001a3', '11300000-0000-0000-0000-0000000001a5')), 3, 'CONTROL: RLS lets a manager seat read money and Legal');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a2'), false, 'hidden from a manager seat: the money flag');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a3'), false, 'hidden from a manager seat: an INVOICES key');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a4'), false, 'hidden from a manager seat: a FINANCE key');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a5'), false, 'hidden from a manager seat: a LEGAL key');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a6'), false, 'hidden from a manager seat: a receipt');
SELECT is((SELECT array_agg(id ORDER BY id) FROM public.moth_project_files('aaaa1111-0000-0000-0000-000000001131')), ARRAY['11300000-0000-0000-0000-0000000001a1', '11300000-0000-0000-0000-0000000001a7', '11300000-0000-0000-0000-0000000001ad', '11300000-0000-0000-0000-0000000001af', '11300000-0000-0000-0000-0000000001b0']::uuid[],
  'a manager seat lists the same files as a member');

-- ── user_d: a workspace manager with no seat ───────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a1'), true, 'a manager reads an ordinary shared file');
SELECT is(public.moth_can_write_target('file', '11300000-0000-0000-0000-0000000001a1'), true, 'and writes it');
SELECT is(public.moth_can_read_target('project', 'aaaa1111-0000-0000-0000-000000001133'), false, 'a private project stays hidden from a manager');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a3'), false, 'money stays hidden from a manager');
SELECT is((SELECT count(*)::int FROM public.moth_islands() WHERE id = 'aaaa1111-0000-0000-0000-000000001133' OR (is_personal AND NOT is_mine)), 0, 'a manager''s islands hold no private project of another and no other person''s space');

-- ── user_a: the admin. RLS reads everything here; Moth does not ────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*)::int FROM public.files WHERE id IN ('11300000-0000-0000-0000-0000000001a2', '11300000-0000-0000-0000-0000000001a3', '11300000-0000-0000-0000-0000000001a5', '11300000-0000-0000-0000-0000000001d1')), 4, 'CONTROL: RLS lets an admin read money, Legal and another person''s space');
SELECT is((SELECT count(*)::int FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000001138'), 1, 'CONTROL: RLS lets an admin read another person''s space row');
SELECT is(public.moth_can_read_target('project', 'aaaa1111-0000-0000-0000-000000001138'), false, 'an admin is false on another persons space');
SELECT is(public.moth_can_read_target('folder', '11300000-0000-0000-0000-0000000000d1'), false, 'an admin is false on a folder of it');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001d1'), false, 'an admin is false on a file of it');
SELECT is(public.moth_can_write_target('project', 'aaaa1111-0000-0000-0000-000000001138'), false, 'an admin has no write gate on it');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a2'), false, 'hidden from an admin: the money flag');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a3'), false, 'hidden from an admin: an INVOICES key');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a4'), false, 'hidden from an admin: a FINANCE key');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a5'), false, 'hidden from an admin: a LEGAL key');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a6'), false, 'hidden from an admin: a receipt');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a8'), false, 'hidden from an admin: a file under INVOICES/x');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001aa'), false, 'hidden from an admin: a file under a renamed category');
SELECT is(public.moth_can_read_target('project', 'aaaa1111-0000-0000-0000-000000001133'), true, 'an admin reads a private project');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001c1'), true, 'and a file of it');
SELECT is(public.moth_can_read_target('project', 'aaaa1111-0000-0000-0000-000000001135'), true, 'an admin reads their own space');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a1'), true, 'an admin reads an ordinary shared file');
SELECT is((SELECT count(*)::int FROM public.moth_islands() WHERE is_personal AND NOT is_mine), 0, 'an admin''s islands never hold another person''s space');
SELECT is((SELECT count(*)::int FROM public.moth_islands() WHERE id = 'aaaa1111-0000-0000-0000-000000001133'), 1, 'an admin''s islands hold others'' private projects');
SELECT is((SELECT count(*)::int FROM public.moth_project_files('aaaa1111-0000-0000-0000-000000001138')) + (SELECT count(*)::int FROM public.moth_project_folders('aaaa1111-0000-0000-0000-000000001138')), 0, 'no rows from another person''s space for an admin');
SELECT is((SELECT array_agg(id ORDER BY id) FROM public.moth_project_files('aaaa1111-0000-0000-0000-000000001131')), ARRAY['11300000-0000-0000-0000-0000000001a1', '11300000-0000-0000-0000-0000000001a7', '11300000-0000-0000-0000-0000000001ad', '11300000-0000-0000-0000-0000000001af', '11300000-0000-0000-0000-0000000001b0']::uuid[],
  'an admin lists the same files as a member');

-- ── user_b: the other company's admin ──────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '22222222-2222-2222-2222-222222222222', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(public.moth_can_read_target('project', 'aaaa1111-0000-0000-0000-000000001131'), false, 'another companys admin is false on the project');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a1'), false, 'and on its file');
SELECT is((SELECT count(*)::int FROM public.moth_project_files('aaaa1111-0000-0000-0000-000000001131')), 0, 'and gets no rows');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001f3'), true, 'their own companys file reads');

-- ── an inactive member, whose token still says they belong ─────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '99999999-9999-9999-9999-999999999999', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(public.moth_can_read_target('project', 'aaaa1111-0000-0000-0000-000000001131'), false, 'an inactive member is false on a project');
SELECT is(public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a1'), false, 'and on a file');
SELECT is((SELECT count(*)::int FROM public.moth_islands()), 0, 'and has no islands');

-- Signed in to nothing: a token with no subject.
SELECT set_config('request.jwt.claims', '{}', true);
SELECT is(public.moth_can_read_target('project', 'aaaa1111-0000-0000-0000-000000001131'), false, 'no subject is false');

RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT public.moth_can_read_target('file', '11300000-0000-0000-0000-0000000001a1') $$, '42501', NULL, 'anon may not call the gate');
SELECT throws_ok($$ SELECT * FROM public.moth_islands() $$, '42501', NULL, 'anon may not list islands');
RESET ROLE;

-- ── The closed helpers, as a client ────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok($$ SELECT public._moth_target_eligible('file', '11300000-0000-0000-0000-0000000001ae', true) $$, '42501', NULL, 'a client may not ask for trashed rows');
SELECT throws_ok($$ SELECT public.moth_file_row_locked('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000001131', '11300000-0000-0000-0000-0000000001a1', false, NULL, NULL, NULL) $$, '42501', NULL, 'a client may not call the classifier');
SELECT throws_ok($$ SELECT public.moth_folder_chain_locked('11111111-1111-1111-1111-111111111111', '11300000-0000-0000-0000-0000000000f2') $$, '42501', NULL, 'a client may not walk a folder chain');

-- As the runner with user_c's claims: what a definer's call of the gate answers.
RESET ROLE;
SELECT is(public._moth_target_eligible('file', '11300000-0000-0000-0000-0000000001ae', true), true, 'p_allow_trashed opens a binned file');
SELECT is(public._moth_target_eligible('file', '11300000-0000-0000-0000-0000000001ae', false), false, 'and only p_allow_trashed');
SELECT is(public._moth_target_eligible('file', '11300000-0000-0000-0000-0000000001f2', true), false, 'a trashed file of a binned project stays closed');
SELECT is(public._moth_target_eligible('file', '11300000-0000-0000-0000-0000000001a2', true), false, 'money stays closed with p_allow_trashed');
SELECT is(public._moth_target_eligible('file', '11300000-0000-0000-0000-0000000001d1', true), false, 'another person''s space stays closed with p_allow_trashed');

-- ── The folder guard, as a manager who writes project S ────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok($$ UPDATE public.folders SET path = 'FILES', slug = 'FILES' WHERE id = '11300000-0000-0000-0000-0000000000f4' $$, '42501', NULL, 'renaming INVOICES to FILES is refused');
SELECT throws_ok($$ UPDATE public.folders SET slug = 'Old' WHERE id = '11300000-0000-0000-0000-0000000000f6' $$, '42501', NULL, 'a top-level folders money slug cannot be changed away');
SELECT throws_ok($$ UPDATE public.folders SET path = 'FINANCE', slug = 'FINANCE' WHERE id = '11300000-0000-0000-0000-0000000000fa' $$, '42501', NULL, 'nor can a folder be made a money folder');
SELECT throws_ok($$ UPDATE public.folders SET parent_id = '11300000-0000-0000-0000-0000000000f4', path = 'INVOICES/one' WHERE id = '11300000-0000-0000-0000-0000000000f2' $$, '42501', NULL, 'a working folder cannot be moved under INVOICES');
SELECT throws_ok($$ UPDATE public.folders SET parent_id = '11300000-0000-0000-0000-0000000000f1', path = 'SCENES/x' WHERE id = '11300000-0000-0000-0000-0000000000f5' $$, '42501', NULL, 'nor a folder out from under it');
SELECT throws_ok($$ UPDATE public.folders SET path = 'ASSETS/one' WHERE id = '11300000-0000-0000-0000-0000000000f2' $$, '42501', NULL, 'a folder cannot leave its parents top level');
SELECT throws_ok($$ INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES ('11300000-0000-0000-0000-000000000090', 'aaaa1111-0000-0000-0000-000000001131', '11300000-0000-0000-0000-0000000000f1', 'custom', 'z', 'OTHER/z') $$, '42501', NULL, 'nor be created outside it');
SELECT lives_ok($$ UPDATE public.folders SET slug = 'Legal2', path = 'SCENES/one/Legal2' WHERE id = '11300000-0000-0000-0000-0000000000f3' $$, 'renaming a working folder lands (a deep slug called Legal is free)');
SELECT lives_ok($$ UPDATE public.folders SET parent_id = '11300000-0000-0000-0000-0000000000f1', path = 'SCENES/Legal2' WHERE id = '11300000-0000-0000-0000-0000000000f3' $$, 're-parenting within the top level lands, as the shot re-file does');
SELECT lives_ok($$ UPDATE public.folders SET label = 'One' WHERE id = '11300000-0000-0000-0000-0000000000f2' $$, 'a label edit lands (the trigger is not even asked)');
SELECT lives_ok($$ UPDATE public.folders SET slug = 'uno' WHERE id = '11300000-0000-0000-0000-0000000000f2' $$, 'a slug-only edit of a working folder lands');
SELECT lives_ok($$ INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES ('11300000-0000-0000-0000-000000000091', 'aaaa1111-0000-0000-0000-000000001131', '11300000-0000-0000-0000-0000000000f1', 'custom', 'two', 'SCENES/two') $$, 'a new folder under SCENES lands');
SELECT lives_ok($$ INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES ('11300000-0000-0000-0000-000000000092', 'aaaa1111-0000-0000-0000-000000001131', '11300000-0000-0000-0000-0000000000f0', 'custom', 'Brand', 'Brand') $$, 'a new top-level folder lands');
SELECT throws_ok($$ DELETE FROM public.folders WHERE id = '11300000-0000-0000-0000-0000000000f4' $$, '42501', NULL, 'INVOICES cannot be deleted by a client: its files would surface');
SELECT throws_ok($$ DELETE FROM public.folders WHERE id = '11300000-0000-0000-0000-0000000000f5' $$, '42501', NULL, 'nor a folder under it');
SELECT throws_ok($$ DELETE FROM public.folders WHERE id = '11300000-0000-0000-0000-0000000000f6' $$, '42501', NULL, 'nor a renamed category whose slug says INVOICES');
SELECT throws_ok($$ DELETE FROM public.folders WHERE id = '11300000-0000-0000-0000-0000000000f0' $$, '42501', NULL, 'nor the projects root, which would take them with it');
SELECT lives_ok($$ DELETE FROM public.folders WHERE id = '11300000-0000-0000-0000-000000000092' $$, 'a working folder can be deleted');
SELECT is((SELECT count(*)::int FROM public.folders WHERE id = '11300000-0000-0000-0000-000000000092'), 0, 'and it is gone (the guard returns the row, so the delete is not skipped)');

-- A folder stays in its project and keeps its id, and the answer is the same
-- whatever it holds: left to the foreign keys, which answer past RLS, the write
-- would say whether a file the caller cannot see is filed there.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('11300000-0000-0000-0000-000000000096', 'aaaa1111-0000-0000-0000-000000001131', '11300000-0000-0000-0000-0000000000f0', 'custom', 'EmptyHere', 'EmptyHere'),
  ('11300000-0000-0000-0000-000000000097', 'aaaa1111-0000-0000-0000-000000001131', '11300000-0000-0000-0000-0000000000f0', 'custom', 'HoldsHidden', 'HoldsHidden');
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, folder_id, deleted_at) VALUES
  ('11300000-0000-0000-0000-0000000001f9', 'aaaa1111-0000-0000-0000-000000001131', 'binned-here.txt', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000001131/files/11300000-0000-0000-0000-0000000001f9/binned-here.txt', '11300000-0000-0000-0000-000000000097', now());
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok($$ UPDATE public.folders SET project_id = 'aaaa1111-0000-0000-0000-000000001132' WHERE id = '11300000-0000-0000-0000-000000000096' $$, '42501', 'A folder stays in its project and keeps its id.', 'an empty folder cannot change project');
SELECT throws_ok($$ UPDATE public.folders SET project_id = 'aaaa1111-0000-0000-0000-000000001132', parent_id = '11300000-0000-0000-0000-0000000000b0', path = 'probe', slug = 'probe' WHERE id = '11300000-0000-0000-0000-000000000097' $$, '42501', 'A folder stays in its project and keeps its id.', 'and the answer is the same with a hidden file filed there and every reference pointed at the new project');
SELECT throws_ok($$ UPDATE public.folders SET id = '11300000-0000-0000-0000-000000000098' WHERE id = '11300000-0000-0000-0000-000000000096' $$, '42501', 'A folder stays in its project and keeps its id.', 'an empty folder cannot change its id');
SELECT throws_ok($$ UPDATE public.folders SET id = '11300000-0000-0000-0000-000000000098' WHERE id = '11300000-0000-0000-0000-000000000097' $$, '42501', 'A folder stays in its project and keeps its id.', 'and the answer is the same with a hidden file filed there');
SELECT lives_ok($$ UPDATE public.folders SET id = '11300000-0000-0000-0000-000000000097', project_id = 'aaaa1111-0000-0000-0000-000000001131', label = 'Holds' WHERE id = '11300000-0000-0000-0000-000000000097' $$, 'resending a folder''s own id and project passes');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
DELETE FROM public.files WHERE id = '11300000-0000-0000-0000-0000000001f9';
DELETE FROM public.folders WHERE id IN ('11300000-0000-0000-0000-000000000096', '11300000-0000-0000-0000-000000000097');

-- ── A parent the caller cannot see answers like a random uuid (no oracle) ─
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok($$ INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES ('11300000-0000-0000-0000-000000000093', 'aaaa1111-0000-0000-0000-000000001131', '11300000-0000-0000-0000-0000000000d1', 'custom', 'x', 'WRONG/x') $$, '23503', 'That item belongs to another project or no longer exists.', 'a hidden parent with the wrong first segment');
SELECT throws_ok($$ INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES ('11300000-0000-0000-0000-000000000093', 'aaaa1111-0000-0000-0000-000000001131', '11300000-0000-0000-0000-0000000000d1', 'custom', 'x', 'Docs/x') $$, '23503', 'That item belongs to another project or no longer exists.', 'a hidden parent with the right one answers the same');
SELECT throws_ok($$ INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES ('11300000-0000-0000-0000-000000000093', 'aaaa1111-0000-0000-0000-000000001131', '11300000-dead-dead-dead-000000000000', 'custom', 'x', 'WRONG/x') $$, '23503', 'That item belongs to another project or no longer exists.', 'and so does a random uuid');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- An unbound session passes: migrations, cron and service_role are not clients.
SELECT lives_ok($$ UPDATE public.folders SET path = 'FINANCE', slug = 'FINANCE' WHERE id = '11300000-0000-0000-0000-0000000000fa' $$, 'CONTROL: the runner may change a standing');
SELECT lives_ok($$ DELETE FROM public.folders WHERE id = '11300000-0000-0000-0000-0000000000fa' $$, 'CONTROL: the runner may delete a money folder');
SELECT is((SELECT count(*)::int FROM public.folders WHERE id = '11300000-0000-0000-0000-0000000000fa'), 0, 'and it is gone');

INSERT INTO public.projects (id, workspace_id, title, created_by) VALUES ('aaaa1111-0000-0000-0000-000000001139', '11111111-1111-1111-1111-111111111111', 'To be deleted', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('11300000-0000-0000-0000-000000000094', 'aaaa1111-0000-0000-0000-000000001139', NULL, 'root', 'to-be-deleted', ''),
  ('11300000-0000-0000-0000-000000000095', 'aaaa1111-0000-0000-0000-000000001139', '11300000-0000-0000-0000-000000000094', 'category', 'INVOICES', 'INVOICES');
-- A project's own delete still takes its folders: a cascade has been judged where it began.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok($$ DELETE FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000001139' $$, 'an admin may delete a project that has a money folder');
SELECT is((SELECT count(*)::int FROM public.folders WHERE id IN ('11300000-0000-0000-0000-000000000094', '11300000-0000-0000-0000-000000000095')), 0, 'and its folders go with it');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- ── The MATRIX: the SQL helpers, row by row, against one table (CL-2) ──────
-- Read by src/permissions/projectRoleMatrix.test.js; keep the format. A helper's
-- NULL (a staffed project and no seat) is a refusal in a policy, so it reads false.

-- appRole admin
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- MATRIX project.entity.write | admin | manager | true | false | false | true
SELECT is(COALESCE(public.can_write_project('aaaa1111-0000-0000-0000-000000001141'), false), true, 'MATRIX project.entity.write | admin | manager | true | false | false | true');
SELECT is(public.moth_can_write_target('project', 'aaaa1111-0000-0000-0000-000000001141'), true, 'MATRIX moth_can_write_target project.entity.write | admin | manager | true | false | false | true');
-- MATRIX project.entity.write | admin | member | true | false | false | true
SELECT is(COALESCE(public.can_write_project('aaaa1111-0000-0000-0000-000000001142'), false), true, 'MATRIX project.entity.write | admin | member | true | false | false | true');
SELECT is(public.moth_can_write_target('project', 'aaaa1111-0000-0000-0000-000000001142'), true, 'MATRIX moth_can_write_target project.entity.write | admin | member | true | false | false | true');
-- MATRIX project.entity.write | admin | reviewer | true | false | false | true
SELECT is(COALESCE(public.can_write_project('aaaa1111-0000-0000-0000-000000001143'), false), true, 'MATRIX project.entity.write | admin | reviewer | true | false | false | true');
SELECT is(public.moth_can_write_target('project', 'aaaa1111-0000-0000-0000-000000001143'), true, 'MATRIX moth_can_write_target project.entity.write | admin | reviewer | true | false | false | true');
-- MATRIX project.entity.write | admin | none | true | false | false | true
SELECT is(COALESCE(public.can_write_project('aaaa1111-0000-0000-0000-000000001144'), false), true, 'MATRIX project.entity.write | admin | none | true | false | false | true');
SELECT is(public.moth_can_write_target('project', 'aaaa1111-0000-0000-0000-000000001144'), true, 'MATRIX moth_can_write_target project.entity.write | admin | none | true | false | false | true');
-- MATRIX project.entity.write | admin | none | false | false | false | true
SELECT is(COALESCE(public.can_write_project('aaaa1111-0000-0000-0000-000000001145'), false), true, 'MATRIX project.entity.write | admin | none | false | false | false | true');
SELECT is(public.moth_can_write_target('project', 'aaaa1111-0000-0000-0000-000000001145'), true, 'MATRIX moth_can_write_target project.entity.write | admin | none | false | false | false | true');
-- MATRIX project.entity.write | admin | manager | true | true | true | true
SELECT is(COALESCE(public.can_write_project('aaaa1111-0000-0000-0000-000000001135'), false), true, 'MATRIX project.entity.write | admin | manager | true | true | true | true');
SELECT is(public.moth_can_write_target('project', 'aaaa1111-0000-0000-0000-000000001135'), true, 'MATRIX moth_can_write_target project.entity.write | admin | manager | true | true | true | true');
-- MATRIX project.entity.write | admin | none | true | true | false | false
SELECT is(COALESCE(public.can_write_project('aaaa1111-0000-0000-0000-000000001138'), false), false, 'MATRIX project.entity.write | admin | none | true | true | false | false');
SELECT is(public.moth_can_write_target('project', 'aaaa1111-0000-0000-0000-000000001138'), false, 'MATRIX moth_can_write_target project.entity.write | admin | none | true | true | false | false');
-- MATRIX project.comment.write | admin | manager | true | false | false | true
SELECT is(COALESCE(public.can_comment_project('aaaa1111-0000-0000-0000-000000001141'), false), true, 'MATRIX project.comment.write | admin | manager | true | false | false | true');
-- MATRIX project.comment.write | admin | member | true | false | false | true
SELECT is(COALESCE(public.can_comment_project('aaaa1111-0000-0000-0000-000000001142'), false), true, 'MATRIX project.comment.write | admin | member | true | false | false | true');
-- MATRIX project.comment.write | admin | reviewer | true | false | false | true
SELECT is(COALESCE(public.can_comment_project('aaaa1111-0000-0000-0000-000000001143'), false), true, 'MATRIX project.comment.write | admin | reviewer | true | false | false | true');
-- MATRIX project.comment.write | admin | none | true | false | false | true
SELECT is(COALESCE(public.can_comment_project('aaaa1111-0000-0000-0000-000000001144'), false), true, 'MATRIX project.comment.write | admin | none | true | false | false | true');
-- MATRIX project.comment.write | admin | none | false | false | false | true
SELECT is(COALESCE(public.can_comment_project('aaaa1111-0000-0000-0000-000000001145'), false), true, 'MATRIX project.comment.write | admin | none | false | false | false | true');
-- MATRIX project.comment.write | admin | manager | true | true | true | true
SELECT is(COALESCE(public.can_comment_project('aaaa1111-0000-0000-0000-000000001135'), false), true, 'MATRIX project.comment.write | admin | manager | true | true | true | true');
-- MATRIX project.comment.write | admin | none | true | true | false | false
SELECT is(COALESCE(public.can_comment_project('aaaa1111-0000-0000-0000-000000001138'), false), false, 'MATRIX project.comment.write | admin | none | true | true | false | false');
-- MATRIX project.roster.manage | admin | manager | true | false | false | true
SELECT is(COALESCE(public.can_manage_project_roster('aaaa1111-0000-0000-0000-000000001141'), false), true, 'MATRIX project.roster.manage | admin | manager | true | false | false | true');
-- MATRIX project.roster.manage | admin | member | true | false | false | true
SELECT is(COALESCE(public.can_manage_project_roster('aaaa1111-0000-0000-0000-000000001142'), false), true, 'MATRIX project.roster.manage | admin | member | true | false | false | true');
-- MATRIX project.roster.manage | admin | reviewer | true | false | false | true
SELECT is(COALESCE(public.can_manage_project_roster('aaaa1111-0000-0000-0000-000000001143'), false), true, 'MATRIX project.roster.manage | admin | reviewer | true | false | false | true');
-- MATRIX project.roster.manage | admin | none | true | false | false | true
SELECT is(COALESCE(public.can_manage_project_roster('aaaa1111-0000-0000-0000-000000001144'), false), true, 'MATRIX project.roster.manage | admin | none | true | false | false | true');
-- MATRIX project.roster.manage | admin | none | false | false | false | true
SELECT is(COALESCE(public.can_manage_project_roster('aaaa1111-0000-0000-0000-000000001145'), false), true, 'MATRIX project.roster.manage | admin | none | false | false | false | true');
-- MATRIX project.roster.manage | admin | manager | true | true | true | false
SELECT is(COALESCE(public.can_manage_project_roster('aaaa1111-0000-0000-0000-000000001135'), false), false, 'MATRIX project.roster.manage | admin | manager | true | true | true | false');
-- MATRIX project.roster.manage | admin | none | true | true | false | false
SELECT is(COALESCE(public.can_manage_project_roster('aaaa1111-0000-0000-0000-000000001138'), false), false, 'MATRIX project.roster.manage | admin | none | true | true | false | false');
-- MATRIX project.shotlist.write | admin | manager | true | false | false | true
SELECT is(COALESCE(public.can_edit_shot_lists('aaaa1111-0000-0000-0000-000000001141'), false), true, 'MATRIX project.shotlist.write | admin | manager | true | false | false | true');
-- MATRIX project.shotlist.write | admin | member | true | false | false | true
SELECT is(COALESCE(public.can_edit_shot_lists('aaaa1111-0000-0000-0000-000000001142'), false), true, 'MATRIX project.shotlist.write | admin | member | true | false | false | true');
-- MATRIX project.shotlist.write | admin | reviewer | true | false | false | true
SELECT is(COALESCE(public.can_edit_shot_lists('aaaa1111-0000-0000-0000-000000001143'), false), true, 'MATRIX project.shotlist.write | admin | reviewer | true | false | false | true');
-- MATRIX project.shotlist.write | admin | none | true | false | false | true
SELECT is(COALESCE(public.can_edit_shot_lists('aaaa1111-0000-0000-0000-000000001144'), false), true, 'MATRIX project.shotlist.write | admin | none | true | false | false | true');
-- MATRIX project.shotlist.write | admin | none | false | false | false | true
SELECT is(COALESCE(public.can_edit_shot_lists('aaaa1111-0000-0000-0000-000000001145'), false), true, 'MATRIX project.shotlist.write | admin | none | false | false | false | true');
-- MATRIX project.shotlist.write | admin | manager | true | true | true | true
SELECT is(COALESCE(public.can_edit_shot_lists('aaaa1111-0000-0000-0000-000000001135'), false), true, 'MATRIX project.shotlist.write | admin | manager | true | true | true | true');
-- MATRIX project.shotlist.write | admin | none | true | true | false | false
SELECT is(COALESCE(public.can_edit_shot_lists('aaaa1111-0000-0000-0000-000000001138'), false), false, 'MATRIX project.shotlist.write | admin | none | true | true | false | false');

-- appRole manager
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

-- MATRIX project.entity.write | manager | manager | true | false | false | true
SELECT is(COALESCE(public.can_write_project('aaaa1111-0000-0000-0000-000000001141'), false), true, 'MATRIX project.entity.write | manager | manager | true | false | false | true');
SELECT is(public.moth_can_write_target('project', 'aaaa1111-0000-0000-0000-000000001141'), true, 'MATRIX moth_can_write_target project.entity.write | manager | manager | true | false | false | true');
-- MATRIX project.entity.write | manager | member | true | false | false | true
SELECT is(COALESCE(public.can_write_project('aaaa1111-0000-0000-0000-000000001142'), false), true, 'MATRIX project.entity.write | manager | member | true | false | false | true');
SELECT is(public.moth_can_write_target('project', 'aaaa1111-0000-0000-0000-000000001142'), true, 'MATRIX moth_can_write_target project.entity.write | manager | member | true | false | false | true');
-- MATRIX project.entity.write | manager | reviewer | true | false | false | true
SELECT is(COALESCE(public.can_write_project('aaaa1111-0000-0000-0000-000000001143'), false), true, 'MATRIX project.entity.write | manager | reviewer | true | false | false | true');
SELECT is(public.moth_can_write_target('project', 'aaaa1111-0000-0000-0000-000000001143'), true, 'MATRIX moth_can_write_target project.entity.write | manager | reviewer | true | false | false | true');
-- MATRIX project.entity.write | manager | none | true | false | false | true
SELECT is(COALESCE(public.can_write_project('aaaa1111-0000-0000-0000-000000001144'), false), true, 'MATRIX project.entity.write | manager | none | true | false | false | true');
SELECT is(public.moth_can_write_target('project', 'aaaa1111-0000-0000-0000-000000001144'), true, 'MATRIX moth_can_write_target project.entity.write | manager | none | true | false | false | true');
-- MATRIX project.entity.write | manager | none | false | false | false | true
SELECT is(COALESCE(public.can_write_project('aaaa1111-0000-0000-0000-000000001145'), false), true, 'MATRIX project.entity.write | manager | none | false | false | false | true');
SELECT is(public.moth_can_write_target('project', 'aaaa1111-0000-0000-0000-000000001145'), true, 'MATRIX moth_can_write_target project.entity.write | manager | none | false | false | false | true');
-- MATRIX project.entity.write | manager | manager | true | true | true | true
SELECT is(COALESCE(public.can_write_project('aaaa1111-0000-0000-0000-000000001137'), false), true, 'MATRIX project.entity.write | manager | manager | true | true | true | true');
SELECT is(public.moth_can_write_target('project', 'aaaa1111-0000-0000-0000-000000001137'), true, 'MATRIX moth_can_write_target project.entity.write | manager | manager | true | true | true | true');
-- MATRIX project.entity.write | manager | none | true | true | false | false
SELECT is(COALESCE(public.can_write_project('aaaa1111-0000-0000-0000-000000001138'), false), false, 'MATRIX project.entity.write | manager | none | true | true | false | false');
SELECT is(public.moth_can_write_target('project', 'aaaa1111-0000-0000-0000-000000001138'), false, 'MATRIX moth_can_write_target project.entity.write | manager | none | true | true | false | false');
-- MATRIX project.comment.write | manager | manager | true | false | false | true
SELECT is(COALESCE(public.can_comment_project('aaaa1111-0000-0000-0000-000000001141'), false), true, 'MATRIX project.comment.write | manager | manager | true | false | false | true');
-- MATRIX project.comment.write | manager | member | true | false | false | true
SELECT is(COALESCE(public.can_comment_project('aaaa1111-0000-0000-0000-000000001142'), false), true, 'MATRIX project.comment.write | manager | member | true | false | false | true');
-- MATRIX project.comment.write | manager | reviewer | true | false | false | true
SELECT is(COALESCE(public.can_comment_project('aaaa1111-0000-0000-0000-000000001143'), false), true, 'MATRIX project.comment.write | manager | reviewer | true | false | false | true');
-- MATRIX project.comment.write | manager | none | true | false | false | true
SELECT is(COALESCE(public.can_comment_project('aaaa1111-0000-0000-0000-000000001144'), false), true, 'MATRIX project.comment.write | manager | none | true | false | false | true');
-- MATRIX project.comment.write | manager | none | false | false | false | true
SELECT is(COALESCE(public.can_comment_project('aaaa1111-0000-0000-0000-000000001145'), false), true, 'MATRIX project.comment.write | manager | none | false | false | false | true');
-- MATRIX project.comment.write | manager | manager | true | true | true | true
SELECT is(COALESCE(public.can_comment_project('aaaa1111-0000-0000-0000-000000001137'), false), true, 'MATRIX project.comment.write | manager | manager | true | true | true | true');
-- MATRIX project.comment.write | manager | none | true | true | false | false
SELECT is(COALESCE(public.can_comment_project('aaaa1111-0000-0000-0000-000000001138'), false), false, 'MATRIX project.comment.write | manager | none | true | true | false | false');
-- MATRIX project.roster.manage | manager | manager | true | false | false | true
SELECT is(COALESCE(public.can_manage_project_roster('aaaa1111-0000-0000-0000-000000001141'), false), true, 'MATRIX project.roster.manage | manager | manager | true | false | false | true');
-- MATRIX project.roster.manage | manager | member | true | false | false | true
SELECT is(COALESCE(public.can_manage_project_roster('aaaa1111-0000-0000-0000-000000001142'), false), true, 'MATRIX project.roster.manage | manager | member | true | false | false | true');
-- MATRIX project.roster.manage | manager | reviewer | true | false | false | true
SELECT is(COALESCE(public.can_manage_project_roster('aaaa1111-0000-0000-0000-000000001143'), false), true, 'MATRIX project.roster.manage | manager | reviewer | true | false | false | true');
-- MATRIX project.roster.manage | manager | none | true | false | false | true
SELECT is(COALESCE(public.can_manage_project_roster('aaaa1111-0000-0000-0000-000000001144'), false), true, 'MATRIX project.roster.manage | manager | none | true | false | false | true');
-- MATRIX project.roster.manage | manager | none | false | false | false | true
SELECT is(COALESCE(public.can_manage_project_roster('aaaa1111-0000-0000-0000-000000001145'), false), true, 'MATRIX project.roster.manage | manager | none | false | false | false | true');
-- MATRIX project.roster.manage | manager | manager | true | true | true | false
SELECT is(COALESCE(public.can_manage_project_roster('aaaa1111-0000-0000-0000-000000001137'), false), false, 'MATRIX project.roster.manage | manager | manager | true | true | true | false');
-- MATRIX project.roster.manage | manager | none | true | true | false | false
SELECT is(COALESCE(public.can_manage_project_roster('aaaa1111-0000-0000-0000-000000001138'), false), false, 'MATRIX project.roster.manage | manager | none | true | true | false | false');
-- MATRIX project.shotlist.write | manager | manager | true | false | false | true
SELECT is(COALESCE(public.can_edit_shot_lists('aaaa1111-0000-0000-0000-000000001141'), false), true, 'MATRIX project.shotlist.write | manager | manager | true | false | false | true');
-- MATRIX project.shotlist.write | manager | member | true | false | false | true
SELECT is(COALESCE(public.can_edit_shot_lists('aaaa1111-0000-0000-0000-000000001142'), false), true, 'MATRIX project.shotlist.write | manager | member | true | false | false | true');
-- MATRIX project.shotlist.write | manager | reviewer | true | false | false | true
SELECT is(COALESCE(public.can_edit_shot_lists('aaaa1111-0000-0000-0000-000000001143'), false), true, 'MATRIX project.shotlist.write | manager | reviewer | true | false | false | true');
-- MATRIX project.shotlist.write | manager | none | true | false | false | true
SELECT is(COALESCE(public.can_edit_shot_lists('aaaa1111-0000-0000-0000-000000001144'), false), true, 'MATRIX project.shotlist.write | manager | none | true | false | false | true');
-- MATRIX project.shotlist.write | manager | none | false | false | false | true
SELECT is(COALESCE(public.can_edit_shot_lists('aaaa1111-0000-0000-0000-000000001145'), false), true, 'MATRIX project.shotlist.write | manager | none | false | false | false | true');
-- MATRIX project.shotlist.write | manager | manager | true | true | true | true
SELECT is(COALESCE(public.can_edit_shot_lists('aaaa1111-0000-0000-0000-000000001137'), false), true, 'MATRIX project.shotlist.write | manager | manager | true | true | true | true');
-- MATRIX project.shotlist.write | manager | none | true | true | false | false
SELECT is(COALESCE(public.can_edit_shot_lists('aaaa1111-0000-0000-0000-000000001138'), false), false, 'MATRIX project.shotlist.write | manager | none | true | true | false | false');

-- appRole user
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- MATRIX project.entity.write | user | manager | true | false | false | true
SELECT is(COALESCE(public.can_write_project('aaaa1111-0000-0000-0000-000000001141'), false), true, 'MATRIX project.entity.write | user | manager | true | false | false | true');
SELECT is(public.moth_can_write_target('project', 'aaaa1111-0000-0000-0000-000000001141'), true, 'MATRIX moth_can_write_target project.entity.write | user | manager | true | false | false | true');
-- MATRIX project.entity.write | user | member | true | false | false | true
SELECT is(COALESCE(public.can_write_project('aaaa1111-0000-0000-0000-000000001142'), false), true, 'MATRIX project.entity.write | user | member | true | false | false | true');
SELECT is(public.moth_can_write_target('project', 'aaaa1111-0000-0000-0000-000000001142'), true, 'MATRIX moth_can_write_target project.entity.write | user | member | true | false | false | true');
-- MATRIX project.entity.write | user | reviewer | true | false | false | false
SELECT is(COALESCE(public.can_write_project('aaaa1111-0000-0000-0000-000000001143'), false), false, 'MATRIX project.entity.write | user | reviewer | true | false | false | false');
SELECT is(public.moth_can_write_target('project', 'aaaa1111-0000-0000-0000-000000001143'), false, 'MATRIX moth_can_write_target project.entity.write | user | reviewer | true | false | false | false');
-- MATRIX project.entity.write | user | none | true | false | false | false
SELECT is(COALESCE(public.can_write_project('aaaa1111-0000-0000-0000-000000001144'), false), false, 'MATRIX project.entity.write | user | none | true | false | false | false');
SELECT is(public.moth_can_write_target('project', 'aaaa1111-0000-0000-0000-000000001144'), false, 'MATRIX moth_can_write_target project.entity.write | user | none | true | false | false | false');
-- MATRIX project.entity.write | user | none | false | false | false | true
SELECT is(COALESCE(public.can_write_project('aaaa1111-0000-0000-0000-000000001145'), false), true, 'MATRIX project.entity.write | user | none | false | false | false | true');
SELECT is(public.moth_can_write_target('project', 'aaaa1111-0000-0000-0000-000000001145'), true, 'MATRIX moth_can_write_target project.entity.write | user | none | false | false | false | true');
-- MATRIX project.entity.write | user | manager | true | true | true | true
SELECT is(COALESCE(public.can_write_project('aaaa1111-0000-0000-0000-000000001136'), false), true, 'MATRIX project.entity.write | user | manager | true | true | true | true');
SELECT is(public.moth_can_write_target('project', 'aaaa1111-0000-0000-0000-000000001136'), true, 'MATRIX moth_can_write_target project.entity.write | user | manager | true | true | true | true');
-- MATRIX project.entity.write | user | none | true | true | false | false
SELECT is(COALESCE(public.can_write_project('aaaa1111-0000-0000-0000-000000001138'), false), false, 'MATRIX project.entity.write | user | none | true | true | false | false');
SELECT is(public.moth_can_write_target('project', 'aaaa1111-0000-0000-0000-000000001138'), false, 'MATRIX moth_can_write_target project.entity.write | user | none | true | true | false | false');
-- MATRIX project.comment.write | user | manager | true | false | false | true
SELECT is(COALESCE(public.can_comment_project('aaaa1111-0000-0000-0000-000000001141'), false), true, 'MATRIX project.comment.write | user | manager | true | false | false | true');
-- MATRIX project.comment.write | user | member | true | false | false | true
SELECT is(COALESCE(public.can_comment_project('aaaa1111-0000-0000-0000-000000001142'), false), true, 'MATRIX project.comment.write | user | member | true | false | false | true');
-- MATRIX project.comment.write | user | reviewer | true | false | false | true
SELECT is(COALESCE(public.can_comment_project('aaaa1111-0000-0000-0000-000000001143'), false), true, 'MATRIX project.comment.write | user | reviewer | true | false | false | true');
-- MATRIX project.comment.write | user | none | true | false | false | false
SELECT is(COALESCE(public.can_comment_project('aaaa1111-0000-0000-0000-000000001144'), false), false, 'MATRIX project.comment.write | user | none | true | false | false | false');
-- MATRIX project.comment.write | user | none | false | false | false | true
SELECT is(COALESCE(public.can_comment_project('aaaa1111-0000-0000-0000-000000001145'), false), true, 'MATRIX project.comment.write | user | none | false | false | false | true');
-- MATRIX project.comment.write | user | manager | true | true | true | true
SELECT is(COALESCE(public.can_comment_project('aaaa1111-0000-0000-0000-000000001136'), false), true, 'MATRIX project.comment.write | user | manager | true | true | true | true');
-- MATRIX project.comment.write | user | none | true | true | false | false
SELECT is(COALESCE(public.can_comment_project('aaaa1111-0000-0000-0000-000000001138'), false), false, 'MATRIX project.comment.write | user | none | true | true | false | false');
-- MATRIX project.roster.manage | user | manager | true | false | false | true
SELECT is(COALESCE(public.can_manage_project_roster('aaaa1111-0000-0000-0000-000000001141'), false), true, 'MATRIX project.roster.manage | user | manager | true | false | false | true');
-- MATRIX project.roster.manage | user | member | true | false | false | false
SELECT is(COALESCE(public.can_manage_project_roster('aaaa1111-0000-0000-0000-000000001142'), false), false, 'MATRIX project.roster.manage | user | member | true | false | false | false');
-- MATRIX project.roster.manage | user | reviewer | true | false | false | false
SELECT is(COALESCE(public.can_manage_project_roster('aaaa1111-0000-0000-0000-000000001143'), false), false, 'MATRIX project.roster.manage | user | reviewer | true | false | false | false');
-- MATRIX project.roster.manage | user | none | true | false | false | false
SELECT is(COALESCE(public.can_manage_project_roster('aaaa1111-0000-0000-0000-000000001144'), false), false, 'MATRIX project.roster.manage | user | none | true | false | false | false');
-- MATRIX project.roster.manage | user | none | false | false | false | false
SELECT is(COALESCE(public.can_manage_project_roster('aaaa1111-0000-0000-0000-000000001145'), false), false, 'MATRIX project.roster.manage | user | none | false | false | false | false');
-- MATRIX project.roster.manage | user | manager | true | true | true | false
SELECT is(COALESCE(public.can_manage_project_roster('aaaa1111-0000-0000-0000-000000001136'), false), false, 'MATRIX project.roster.manage | user | manager | true | true | true | false');
-- MATRIX project.roster.manage | user | none | true | true | false | false
SELECT is(COALESCE(public.can_manage_project_roster('aaaa1111-0000-0000-0000-000000001138'), false), false, 'MATRIX project.roster.manage | user | none | true | true | false | false');
-- MATRIX project.shotlist.write | user | manager | true | false | false | true
SELECT is(COALESCE(public.can_edit_shot_lists('aaaa1111-0000-0000-0000-000000001141'), false), true, 'MATRIX project.shotlist.write | user | manager | true | false | false | true');
-- MATRIX project.shotlist.write | user | member | true | false | false | true
SELECT is(COALESCE(public.can_edit_shot_lists('aaaa1111-0000-0000-0000-000000001142'), false), true, 'MATRIX project.shotlist.write | user | member | true | false | false | true');
-- MATRIX project.shotlist.write | user | reviewer | true | false | false | true
SELECT is(COALESCE(public.can_edit_shot_lists('aaaa1111-0000-0000-0000-000000001143'), false), true, 'MATRIX project.shotlist.write | user | reviewer | true | false | false | true');
-- MATRIX project.shotlist.write | user | none | true | false | false | false
SELECT is(COALESCE(public.can_edit_shot_lists('aaaa1111-0000-0000-0000-000000001144'), false), false, 'MATRIX project.shotlist.write | user | none | true | false | false | false');
-- MATRIX project.shotlist.write | user | none | false | false | false | true
SELECT is(COALESCE(public.can_edit_shot_lists('aaaa1111-0000-0000-0000-000000001145'), false), true, 'MATRIX project.shotlist.write | user | none | false | false | false | true');
-- MATRIX project.shotlist.write | user | manager | true | true | true | true
SELECT is(COALESCE(public.can_edit_shot_lists('aaaa1111-0000-0000-0000-000000001136'), false), true, 'MATRIX project.shotlist.write | user | manager | true | true | true | true');
-- MATRIX project.shotlist.write | user | none | true | true | false | false
SELECT is(COALESCE(public.can_edit_shot_lists('aaaa1111-0000-0000-0000-000000001138'), false), false, 'MATRIX project.shotlist.write | user | none | true | true | false | false');

SELECT * FROM finish();
ROLLBACK;
