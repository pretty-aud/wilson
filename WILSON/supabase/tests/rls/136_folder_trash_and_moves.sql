-- =============================================================================
-- 136_folder_trash_and_moves.sql — M.O.T.H. Session 4 (MO4): a folder's trash, and moving a folder (0131).
--
-- A. Structure: the columns, the three triggers, the functions' grants.
-- B. Putting a folder in the trash: a board's folder goes with everything below it in one batch; a project's own
--    folders stay; a money or Legal file below, or a file on the office server, keeps the whole folder out; a
--    reviewer, another company and an admin in another person's space are refused alike.
-- C. In the trash: the folder is no target of Moth's gate, its board and files are out of every read, the folder is
--    the trash's entry (a board marked) and the files that went with it are not entries of their own.
-- D. Guards: a client never writes the trash columns, never brings back a file that went with its folder, never
--    puts a file or a folder into a folder in the trash.
-- E. Bringing back: a batch comes back whole and nothing else; a folder whose own folder is in the trash waits.
-- F. Moving: within a project, with every path below, never into itself, the trash, money or Legal; a name made
--    unique; a plan changes nothing; another project is the move between projects'; a reviewer moves nothing.
-- G. The purge: a folder 30 days in the trash goes with its board and elements, once no file row is left below it.
-- =============================================================================

BEGIN;
SELECT plan(63);

SELECT * FROM tests.rls_setup();

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
SELECT u.id, u.email, crypt('testpw', gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
       'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()
  FROM (VALUES
    ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'user_c@test.local'),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, 'user_e@test.local'),
    ('99999999-9999-9999-9999-999999999999'::uuid, 'user_r@test.local')) u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user', 'user_e', 'User E', true),
  ('11111111-1111-1111-1111-111111111111', '99999999-9999-9999-9999-999999999999', 'user', 'user_r', 'User R', true)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET is_active = EXCLUDED.is_active, app_role = EXCLUDED.app_role;

CREATE FUNCTION public.t136_as(p_user uuid, p_role text, p_ws uuid DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_role))::text, true);
END;
$f$;
CREATE FUNCTION public.t136_a() RETURNS void LANGUAGE sql AS $f$ SELECT public.t136_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin') $f$;
CREATE FUNCTION public.t136_b() RETURNS void LANGUAGE sql AS $f$ SELECT public.t136_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222') $f$;
CREATE FUNCTION public.t136_c() RETURNS void LANGUAGE sql AS $f$ SELECT public.t136_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user') $f$;
CREATE FUNCTION public.t136_e() RETURNS void LANGUAGE sql AS $f$ SELECT public.t136_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user') $f$;
CREATE FUNCTION public.t136_r() RETURNS void LANGUAGE sql AS $f$ SELECT public.t136_as('99999999-9999-9999-9999-999999999999', 'user') $f$;
CREATE FUNCTION public.t136_err(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  s text;
BEGIN
  EXECUTE p_sql;
  RETURN 'no refusal';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS s = RETURNED_SQLSTATE;
  RETURN s;
END;
$f$;
CREATE FUNCTION public.t136_words(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'no refusal';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$f$;
-- A folder's row as the database sees it.
CREATE FUNCTION public.t136_f(p_id uuid) RETURNS public.folders LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT * FROM public.folders WHERE id = p_id
$f$;
CREATE FUNCTION public.t136_file(p_id uuid) RETURNS public.files LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT * FROM public.files WHERE id = p_id
$f$;
GRANT EXECUTE ON FUNCTION public.t136_f(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.t136_file(uuid) TO authenticated;

-- P: top, ASSETS (a category), INVOICES, and custom folders: mood (a board) with refs below it, plan (a board), keep,
-- cash (a receipt in it), nas (an office-server file in it). P2 another project. S user_e's personal space.
SELECT public.t136_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1360-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Salt Hours', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1360-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Second', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1360-0000-0000-0000-0000000000e0', '11111111-1111-1111-1111-111111111111', 'Personal space', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1360-0000-0000-0000-00000000000a', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1360-0000-0000-0000-00000000000a', '99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1360-0000-0000-0000-00000000000b', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT DO NOTHING;
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('13600000-0000-0000-0000-0000000000a0', 'aaaa1360-0000-0000-0000-00000000000a', NULL, 'root', 'salt-hours', ''),
  ('13600000-0000-0000-0000-0000000000a1', 'aaaa1360-0000-0000-0000-00000000000a', '13600000-0000-0000-0000-0000000000a0', 'category', 'ASSETS', 'ASSETS'),
  ('13600000-0000-0000-0000-0000000000a2', 'aaaa1360-0000-0000-0000-00000000000a', '13600000-0000-0000-0000-0000000000a0', 'category', 'INVOICES', 'INVOICES'),
  ('13600000-0000-0000-0000-0000000000a3', 'aaaa1360-0000-0000-0000-00000000000a', '13600000-0000-0000-0000-0000000000a0', 'custom', 'mood', 'mood'),
  ('13600000-0000-0000-0000-0000000000a4', 'aaaa1360-0000-0000-0000-00000000000a', '13600000-0000-0000-0000-0000000000a3', 'custom', 'refs', 'mood/refs'),
  ('13600000-0000-0000-0000-0000000000a5', 'aaaa1360-0000-0000-0000-00000000000a', '13600000-0000-0000-0000-0000000000a0', 'custom', 'plan', 'plan'),
  ('13600000-0000-0000-0000-0000000000a6', 'aaaa1360-0000-0000-0000-00000000000a', '13600000-0000-0000-0000-0000000000a0', 'custom', 'keep', 'keep'),
  ('13600000-0000-0000-0000-0000000000a7', 'aaaa1360-0000-0000-0000-00000000000a', '13600000-0000-0000-0000-0000000000a0', 'custom', 'cash', 'cash'),
  ('13600000-0000-0000-0000-0000000000a8', 'aaaa1360-0000-0000-0000-00000000000a', '13600000-0000-0000-0000-0000000000a0', 'custom', 'nas', 'nas'),
  ('13600000-0000-0000-0000-0000000000a9', 'aaaa1360-0000-0000-0000-00000000000a', '13600000-0000-0000-0000-0000000000a6', 'custom', 'plan', 'keep/plan'),
  ('13600000-0000-0000-0000-0000000000aa', 'aaaa1360-0000-0000-0000-00000000000a', '13600000-0000-0000-0000-0000000000a0', 'custom', 'two-a', 'two-a'),
  ('13600000-0000-0000-0000-0000000000ab', 'aaaa1360-0000-0000-0000-00000000000a', '13600000-0000-0000-0000-0000000000a0', 'custom', 'two-b', 'two-b'),
  ('13600000-0000-0000-0000-0000000000ad', 'aaaa1360-0000-0000-0000-00000000000a', '13600000-0000-0000-0000-0000000000a6', 'custom', 'legal', 'keep/legal'),
  ('13600000-0000-0000-0000-0000000000b0', 'aaaa1360-0000-0000-0000-00000000000b', NULL, 'root', 'second', ''),
  ('13600000-0000-0000-0000-0000000000e0', 'aaaa1360-0000-0000-0000-0000000000e0', NULL, 'root', 'ps-e', ''),
  ('13600000-0000-0000-0000-0000000000e1', 'aaaa1360-0000-0000-0000-0000000000e0', '13600000-0000-0000-0000-0000000000e0', 'custom', 'pitch', 'pitch');
-- A thing's own folder: the asset Mira's, below ASSETS.
INSERT INTO public.assets (id, project_id, name) VALUES ('13600000-0000-0000-0000-0000000000c1', 'aaaa1360-0000-0000-0000-00000000000a', 'Mira');
INSERT INTO public.folders (id, project_id, parent_id, kind, entity_type, asset_id, slug, path) VALUES
  ('13600000-0000-0000-0000-0000000000ac', 'aaaa1360-0000-0000-0000-00000000000a', '13600000-0000-0000-0000-0000000000a1', 'entity', 'asset',
   '13600000-0000-0000-0000-0000000000c1', 'mira', 'ASSETS/mira');
INSERT INTO public.boards (id, folder_id) VALUES
  ('13600000-0000-0000-0000-0000000000f1', '13600000-0000-0000-0000-0000000000a3'),
  ('13600000-0000-0000-0000-0000000000f2', '13600000-0000-0000-0000-0000000000a5'),
  ('13600000-0000-0000-0000-0000000000f3', '13600000-0000-0000-0000-0000000000e1');
INSERT INTO public.files (id, project_id, folder_id, name, mime_type, storage_provider, storage_path, tags, is_financial) VALUES
  ('13600000-0000-0000-0000-000000000081', 'aaaa1360-0000-0000-0000-00000000000a', '13600000-0000-0000-0000-0000000000a3', 'sticky.md', 'text/markdown', 'supabase', 'projects/aaaa1360-0000-0000-0000-00000000000a/files/13600000-0000-0000-0000-000000000081/sticky.md', '{}', false),
  ('13600000-0000-0000-0000-000000000082', 'aaaa1360-0000-0000-0000-00000000000a', '13600000-0000-0000-0000-0000000000a4', 'ref.png', 'image/png', 'supabase', 'projects/aaaa1360-0000-0000-0000-00000000000a/files/13600000-0000-0000-0000-000000000082/ref.png', '{}', false),
  ('13600000-0000-0000-0000-000000000083', 'aaaa1360-0000-0000-0000-00000000000a', '13600000-0000-0000-0000-0000000000a3', 'old.png', 'image/png', 'supabase', 'projects/aaaa1360-0000-0000-0000-00000000000a/files/13600000-0000-0000-0000-000000000083/old.png', '{}', false),
  ('13600000-0000-0000-0000-000000000084', 'aaaa1360-0000-0000-0000-00000000000a', '13600000-0000-0000-0000-0000000000a7', 'receipt.pdf', 'application/pdf', 'supabase', 'projects/aaaa1360-0000-0000-0000-00000000000a/files/13600000-0000-0000-0000-000000000084/receipt.pdf', '{}', true),
  ('13600000-0000-0000-0000-000000000085', 'aaaa1360-0000-0000-0000-00000000000a', '13600000-0000-0000-0000-0000000000a8', 'cut.mov', 'video/mp4', 'network_share', 'nas:Salt/cut.mov', '{}', false),
  ('13600000-0000-0000-0000-000000000087', 'aaaa1360-0000-0000-0000-00000000000a', '13600000-0000-0000-0000-0000000000a6', 'keep.txt', 'text/plain', 'supabase', 'projects/aaaa1360-0000-0000-0000-00000000000a/files/13600000-0000-0000-0000-000000000087/keep.txt', '{}', false);
INSERT INTO public.board_elements (board_id, kind, shape) VALUES ('13600000-0000-0000-0000-0000000000f1', 'shape', 'circle');
-- old.png was put in the trash on its own, before anything else.
UPDATE public.files SET deleted_at = now() - interval '1 day' WHERE id = '13600000-0000-0000-0000-000000000083';
SELECT set_config('request.jwt.claims', '{}', true);

-- ── A. Structure ────────────────────────────────────────────────────────────
SELECT is((SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public'
            AND ((table_name = 'folders' AND column_name IN ('deleted_at', 'deleted_by', 'trash_batch'))
                 OR (table_name = 'files' AND column_name = 'trash_batch'))), 4, 'the four trash columns');
SELECT is((SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger
            WHERE NOT tgisinternal AND tgname IN ('trg_folders_trash_guard', 'trg_files_folder_trash_guard', 'trg_folders_soft_delete')),
  'trg_files_folder_trash_guard,trg_folders_soft_delete,trg_folders_trash_guard', 'the three triggers');
SELECT ok(has_function_privilege('authenticated', 'public.moth_trash_folders(uuid[])', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.moth_restore_folders(uuid[])', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.moth_trashed_folders(integer,timestamptz)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.moth_move_folders(uuid[],uuid,boolean)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'rabbit_private.folder_subtree(uuid)', 'EXECUTE'),
  'signed-in people call the four; nobody calls the subtree helper');

-- ── B. Putting a folder in the trash ────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t136_c();
SELECT is(public.t136_words($$SELECT public.moth_trash_folders(ARRAY['13600000-0000-0000-0000-0000000000a1']::uuid[])$$),
  'This folder is part of the project''s own layout and stays.', 'a project''s own category stays');
SELECT is((public.moth_trash_folders(ARRAY['13600000-0000-0000-0000-0000000000a7']::uuid[]) - 'batches')::text,
  '{"files": 0, "folders": 1}', 'a folder holding a receipt goes as any other, and says nothing of it');
SELECT ok((public.t136_file('13600000-0000-0000-0000-000000000084')).deleted_at IS NULL
          AND (public.t136_file('13600000-0000-0000-0000-000000000084')).folder_id IS NULL,
  'the receipt stays, at the project''s top, for those who may see it');
SELECT is(public.t136_words($$SELECT public.moth_trash_folders(ARRAY['13600000-0000-0000-0000-0000000000a8']::uuid[])$$),
  'A folder holding files on the office server cannot go to the trash yet.', 'nor one holding a file on the office server');
SELECT is(public.t136_err($$SELECT public.moth_trash_folders(ARRAY['13600000-0000-0000-0000-0000000000a2']::uuid[])$$),
  '42501', 'a money folder is no folder Moth reaches');
SELECT public.t136_r();
SELECT is(public.t136_err($$SELECT public.moth_trash_folders(ARRAY['13600000-0000-0000-0000-0000000000a3']::uuid[])$$),
  '42501', 'a reviewer puts nothing in the trash');
SELECT public.t136_b();
SELECT is(public.t136_err($$SELECT public.moth_trash_folders(ARRAY['13600000-0000-0000-0000-0000000000a3']::uuid[])$$),
  '42501', 'nor another company');
SELECT public.t136_a();
SELECT is(public.t136_err($$SELECT public.moth_trash_folders(ARRAY['13600000-0000-0000-0000-0000000000e1']::uuid[])$$),
  '42501', 'nor an admin in another person''s space');
SELECT public.t136_e();
SELECT is((public.moth_trash_folders(ARRAY['13600000-0000-0000-0000-0000000000e1']::uuid[]) ->> 'folders'), '1',
  'its owner puts a board of their space in the trash');
SELECT is((SELECT e ->> 'is_board' FROM jsonb_array_elements(public.moth_trashed_folders()) e
            WHERE e ->> 'id' = '13600000-0000-0000-0000-0000000000e1'), 'true', 'and finds it in their trash');
SELECT public.t136_c();
SELECT is((public.moth_trash_folders(ARRAY['13600000-0000-0000-0000-0000000000a3']::uuid[]) - 'batches')::text,
  '{"files": 2, "folders": 2}', 'a member puts the mood board in the trash: two folders and two live files');
SELECT ok((public.t136_f('13600000-0000-0000-0000-0000000000a3')).trash_batch IS NOT NULL
          AND (public.t136_f('13600000-0000-0000-0000-0000000000a3')).trash_batch = (public.t136_f('13600000-0000-0000-0000-0000000000a4')).trash_batch,
  'all in one batch');
SELECT is((SELECT count(*)::int FROM public.folders WHERE id IN ('13600000-0000-0000-0000-0000000000a3', '13600000-0000-0000-0000-0000000000a4')),
  0, 'a folder in the trash is out of the table''s reads');
SELECT is((public.moth_trash_folders(ARRAY['13600000-0000-0000-0000-0000000000aa', '13600000-0000-0000-0000-0000000000ab']::uuid[]) ->> 'batches'),
  '2', 'two folders at once are two batches');
SELECT is((public.moth_restore_folders(ARRAY['13600000-0000-0000-0000-0000000000aa']::uuid[]) ->> 'folders'), '1',
  'and one comes back without the other');
SELECT ok((public.t136_file('13600000-0000-0000-0000-000000000083')).trash_batch IS NULL,
  'a file in the trash already keeps its own');
SELECT is((public.t136_f('13600000-0000-0000-0000-0000000000a3')).deleted_by, 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
  'and the folder says who');

-- ── C. In the trash ─────────────────────────────────────────────────────────
SELECT ok(NOT public.moth_can_read_target('folder', '13600000-0000-0000-0000-0000000000a3')
          AND NOT public.moth_can_read_target('folder', '13600000-0000-0000-0000-0000000000a4'),
  'the folder and the one below it are no target of Moth''s gate');
SELECT is((SELECT count(*)::int FROM public.boards WHERE id = '13600000-0000-0000-0000-0000000000f1'), 0, 'its board is out of reads');
SELECT is(public.t136_err($$SELECT public.board_read('13600000-0000-0000-0000-0000000000f1')$$), '42501', 'and its board''s read refuses');
SELECT is((SELECT count(*)::int FROM public.files WHERE id IN ('13600000-0000-0000-0000-000000000081', '13600000-0000-0000-0000-000000000082')),
  0, 'its files are out of the files'' reads');
SELECT is((SELECT (e ->> 'is_board') || ':' || (e ->> 'files') || ':' || (e ->> 'name') FROM jsonb_array_elements(public.moth_trashed_folders()) e
            WHERE e ->> 'id' = '13600000-0000-0000-0000-0000000000a3'),
  'true:2:mood', 'the trash lists the folder, a board, with its two files');
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(public.moth_trashed_folders()) e
            WHERE e ->> 'id' = '13600000-0000-0000-0000-0000000000a4'), 0, 'and not the folder that went with it');
SELECT is((SELECT string_agg(name, ',' ORDER BY name) FROM public.moth_trash_index()
            WHERE id IN ('13600000-0000-0000-0000-000000000081', '13600000-0000-0000-0000-000000000082', '13600000-0000-0000-0000-000000000083')),
  'old.png', 'the files that went with it are no entries of their own; the one that went alone still is');
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(public.moth_trashed_folders()) e
            WHERE e ->> 'id' = '13600000-0000-0000-0000-0000000000e1'), 0, 'another person''s space is never listed');
SELECT public.t136_a();
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(public.moth_trashed_folders()) e
            WHERE e ->> 'id' = '13600000-0000-0000-0000-0000000000e1'), 0, 'not even to an admin');

-- ── D. Guards ───────────────────────────────────────────────────────────────
SELECT public.t136_c();
SELECT is(public.t136_words($$UPDATE public.folders SET deleted_at = now() WHERE id = '13600000-0000-0000-0000-0000000000a6'$$),
  'A folder goes to the trash through Moth.', 'a client writes no folder''s trash stamp');
SELECT is(public.t136_words($$INSERT INTO public.folders (project_id, parent_id, kind, slug, path, deleted_at)
                               VALUES ('aaaa1360-0000-0000-0000-00000000000a', '13600000-0000-0000-0000-0000000000a0', 'custom', 'x', 'x', now())$$),
  'A folder goes to the trash through Moth.', 'nor makes a folder already in it');
SELECT is(public.t136_words($$SELECT public.restore_soft_deleted('files', '13600000-0000-0000-0000-000000000081')$$),
  'This file went to the trash with its folder: bring back the folder to bring it back.',
  'a file that went with its folder does not come back alone');
SELECT is(public.t136_words($$UPDATE public.files SET trash_batch = gen_random_uuid() WHERE id = '13600000-0000-0000-0000-000000000087'$$),
  'A file goes to the trash with its folder through Moth.', 'a client writes no file''s batch');
SELECT is(public.t136_words($$SELECT public.restore_soft_deleted('files', '13600000-0000-0000-0000-000000000083')$$),
  'That folder is in the trash.', 'a file that went alone does not come back into a folder now in the trash');
SELECT is(public.t136_words($$INSERT INTO public.folders (project_id, parent_id, kind, slug, path)
                               VALUES ('aaaa1360-0000-0000-0000-00000000000a', '13600000-0000-0000-0000-0000000000a3', 'custom', 'y', 'mood/y')$$),
  'That folder is in the trash.', 'nor a folder made inside it');

-- ── E. Bringing back ────────────────────────────────────────────────────────
-- keep/plan goes alone first, then keep with it: keep/plan waits for keep.
SELECT is((public.moth_trash_folders(ARRAY['13600000-0000-0000-0000-0000000000a9']::uuid[]) ->> 'batches'), '1', 'keep/plan goes alone');
SELECT is(public.t136_words($$DELETE FROM public.folders WHERE id = '13600000-0000-0000-0000-0000000000a6'$$),
  'Something in this folder is in the trash: bring it back or wait for it to go first.',
  'a client never deletes a folder with something of a trash batch below it');
SELECT is((public.moth_trash_folders(ARRAY['13600000-0000-0000-0000-0000000000a6']::uuid[]) ->> 'batches'), '1', 'then keep');
SELECT is(public.t136_words($$SELECT public.moth_restore_folders(ARRAY['13600000-0000-0000-0000-0000000000a9']::uuid[])$$),
  'The folder this one was in is in the trash too: bring that back first.', 'keep/plan waits for keep');
SELECT is((public.moth_restore_folders(ARRAY['13600000-0000-0000-0000-0000000000a6']::uuid[]) ->> 'folders'), '2',
  'keep comes back with keep/legal, its batch, and keep/plan still in the trash');
SELECT is((public.moth_restore_folders(ARRAY['13600000-0000-0000-0000-0000000000a9']::uuid[]) ->> 'folders'), '1', 'then keep/plan');
SELECT is((public.moth_restore_folders(ARRAY['13600000-0000-0000-0000-0000000000a4']::uuid[]))::text,
  '{"files": 2, "folders": 2}', 'asking for the folder below brings the mood board''s whole batch back');
SELECT ok((public.t136_file('13600000-0000-0000-0000-000000000083')).deleted_at IS NOT NULL, 'but not the file that went alone');
SELECT is((SELECT count(*)::int FROM public.boards WHERE id = '13600000-0000-0000-0000-0000000000f1'), 1, 'the board is back');
SELECT public.t136_r();
SELECT is(public.t136_err($$SELECT public.moth_restore_folders(ARRAY['13600000-0000-0000-0000-0000000000e1']::uuid[])$$),
  '42501', 'nobody brings back another person''s');

-- ── F. Moving ───────────────────────────────────────────────────────────────
SELECT public.t136_c();
SELECT is((public.moth_move_folders(ARRAY['13600000-0000-0000-0000-0000000000a3']::uuid[], '13600000-0000-0000-0000-0000000000a6', true) -> 'moved' -> 0 ->> 'to'),
  'keep/mood', 'a plan says where the board would go');
SELECT is((public.t136_f('13600000-0000-0000-0000-0000000000a3')).path, 'mood', 'and moves nothing');
SELECT is((public.moth_move_folders(ARRAY['13600000-0000-0000-0000-0000000000a3']::uuid[], '13600000-0000-0000-0000-0000000000a1') -> 'moved' -> 0 ->> 'to'),
  'ASSETS/mood', 'the board moves into ASSETS');
SELECT is((public.t136_f('13600000-0000-0000-0000-0000000000a4')).path, 'ASSETS/mood/refs', 'and the folder below it follows');
SELECT is((SELECT count(*)::int FROM public.boards WHERE id = '13600000-0000-0000-0000-0000000000f1'), 1, 'the board still reads');
SELECT is((public.moth_move_folders(ARRAY['13600000-0000-0000-0000-0000000000a5']::uuid[], '13600000-0000-0000-0000-0000000000a6') -> 'moved' -> 0 ->> 'to'),
  'keep/plan-2', 'a name already there is made unique');
SELECT is(public.t136_words($$SELECT public.moth_move_folders(ARRAY['13600000-0000-0000-0000-0000000000a3']::uuid[], '13600000-0000-0000-0000-0000000000a4')$$),
  'A folder cannot go inside itself.', 'never into itself');
SELECT is(public.t136_err($$SELECT public.moth_move_folders(ARRAY['13600000-0000-0000-0000-0000000000a3']::uuid[], '13600000-0000-0000-0000-0000000000a2')$$),
  '42501', 'never into a money folder');
SELECT is(public.t136_words($$SELECT public.moth_move_folders(ARRAY['13600000-0000-0000-0000-0000000000a3']::uuid[], '13600000-0000-0000-0000-0000000000b0')$$),
  'cross_project', 'another project is the move between projects''');
SELECT is(public.t136_words($$SELECT public.moth_move_folders(ARRAY['13600000-0000-0000-0000-0000000000a5']::uuid[], '13600000-0000-0000-0000-0000000000ac')$$),
  'A board stays in the project''s own folders, not inside a shot''s, a scene''s or an asset''s.', 'a board never into a thing''s own folder');
SELECT is(public.t136_words($$SELECT public.moth_move_folders(ARRAY['13600000-0000-0000-0000-0000000000a8']::uuid[], '13600000-0000-0000-0000-0000000000a6')$$),
  'A folder holding files on the office server cannot move yet.', 'nor a folder holding office-server files');
SELECT is(public.t136_words($$SELECT public.moth_move_folders(ARRAY['13600000-0000-0000-0000-0000000000ad']::uuid[], '13600000-0000-0000-0000-0000000000a0', true)$$),
  'That name is kept for the project''s own folders.', 'a money or Legal name at the top is refused, even as a plan, before anything is looked up');
SELECT is(public.t136_words($$SELECT public.moth_move_folders(ARRAY['13600000-0000-0000-0000-0000000000a1']::uuid[], '13600000-0000-0000-0000-0000000000a6')$$),
  'This folder is part of the project''s own layout and stays.', 'a project''s own folder does not move');
SELECT public.t136_r();
SELECT is(public.t136_err($$SELECT public.moth_move_folders(ARRAY['13600000-0000-0000-0000-0000000000a3']::uuid[], '13600000-0000-0000-0000-0000000000a6')$$),
  '42501', 'a reviewer moves nothing');

-- ── G. The purge ────────────────────────────────────────────────────────────
SELECT public.t136_c();
SELECT is((public.moth_trash_folders(ARRAY['13600000-0000-0000-0000-0000000000a3']::uuid[]) ->> 'batches'), '1', 'the board goes to the trash again');
RESET ROLE;
UPDATE public.folders SET deleted_at = now() - interval '31 days' WHERE trash_batch IS NOT NULL AND project_id = 'aaaa1360-0000-0000-0000-00000000000a';
UPDATE public.files SET deleted_at = now() - interval '31 days' WHERE trash_batch IS NOT NULL AND project_id = 'aaaa1360-0000-0000-0000-00000000000a';
-- While the file that went alone is younger, it holds its folder back: no file row is ever left without its folder.
SELECT ok(public.purge_soft_deleted() >= 2
          AND (SELECT count(*) FROM public.folders WHERE id = '13600000-0000-0000-0000-0000000000a3') = 1,
  'a file still in its own 30 days keeps the folder it is in');
UPDATE public.files SET deleted_at = now() - interval '31 days' WHERE id = '13600000-0000-0000-0000-000000000083';
SELECT ok(public.purge_soft_deleted() >= 2, 'then the purge takes the rest');
SELECT is((SELECT count(*)::int FROM public.folders WHERE id IN ('13600000-0000-0000-0000-0000000000a3', '13600000-0000-0000-0000-0000000000a4'))
          + (SELECT count(*)::int FROM public.boards WHERE id = '13600000-0000-0000-0000-0000000000f1')
          + (SELECT count(*)::int FROM public.board_elements WHERE board_id = '13600000-0000-0000-0000-0000000000f1'),
  0, 'the two folders, the board and its elements are gone');

SELECT * FROM finish();
ROLLBACK;
