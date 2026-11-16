-- =============================================================================
-- 140_boards_in_any_folder.sql — M.O.T.H. polish (MO5): boards in a thing's own folder, kept when the thing goes,
-- and renaming a folder (0138).
--
-- A. Structure: the rescue's trigger (before a thing's own folder is deleted), a definer no client may call; the
--    rename's grants; board_create and moth_move_folders as 0138 left them.
-- B. Making a board: inside an asset's, a scene's and a shot's own folder (a shot's below its scene's, and an older
--    one under SHOTS), inside a person's folder below a scene's, and inside a board's own folder; a board named
--    Invoices inside a thing's folder; money, a money name at the top and a reviewer still refused.
-- C. Moving a board into a scene's own folder.
-- D. Renaming: a person's own folder (a board's), cleaned; only the label changes, and the board reads its new title;
--    the same name changes nothing; WILSON's own folders (the top, a category, a thing's own) keep their names; an
--    empty or long name, a reviewer, another company and a folder in the trash are refused.
-- E. A scene deleted by a client: its folder, its shots' folders and a person's folder in it go; every board below
--    them goes to the project's top under a free name, a board inside a board with it, with its elements, versions,
--    files and channel untouched; nothing is left set.
-- F. A board in the trash inside a scene: still in the trash, at the project's top, and listed to bring back.
-- G. An asset's purge, with no one signed in: its boards kept, a money name made safe at the top.
-- H. A project deleted takes its boards, with no error.
-- =============================================================================

BEGIN;
SELECT plan(52);

SELECT * FROM tests.rls_setup();

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
SELECT u.id, u.email, crypt('testpw', gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
       'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()
  FROM (VALUES
    ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'user_c@test.local'),
    ('99999999-9999-9999-9999-999999999999'::uuid, 'user_r@test.local')) u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111', '99999999-9999-9999-9999-999999999999', 'user', 'user_r', 'User R', true)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET is_active = EXCLUDED.is_active, app_role = EXCLUDED.app_role;

CREATE FUNCTION public.t140_as(p_user uuid, p_role text, p_ws uuid DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_role))::text, true);
END;
$f$;
CREATE FUNCTION public.t140_a() RETURNS void LANGUAGE sql AS $f$ SELECT public.t140_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin') $f$;
CREATE FUNCTION public.t140_b() RETURNS void LANGUAGE sql AS $f$ SELECT public.t140_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222') $f$;
CREATE FUNCTION public.t140_c() RETURNS void LANGUAGE sql AS $f$ SELECT public.t140_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user') $f$;
CREATE FUNCTION public.t140_r() RETURNS void LANGUAGE sql AS $f$ SELECT public.t140_as('99999999-9999-9999-9999-999999999999', 'user') $f$;
CREATE FUNCTION public.t140_err(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
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
CREATE FUNCTION public.t140_words(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'no refusal';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$f$;
-- A folder's row as the database sees it, by id or by its path in project P; a board by its folder's path.
CREATE FUNCTION public.t140_f(p_id uuid) RETURNS public.folders LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT * FROM public.folders WHERE id = p_id
$f$;
CREATE FUNCTION public.t140_at(p_path text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT id FROM public.folders WHERE project_id = 'aaaa1400-0000-0000-0000-00000000000a' AND path = p_path
$f$;
CREATE FUNCTION public.t140_board(p_folder uuid) RETURNS public.boards LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT * FROM public.boards WHERE folder_id = p_folder
$f$;
GRANT EXECUTE ON FUNCTION public.t140_f(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.t140_at(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.t140_board(uuid) TO authenticated;

-- P: top, ASSETS, SCENES, SHOTS, INVOICES; the asset Mira's own folder; the scene Dawn's own folder with a person's
-- folder refs in it, its shot One's own folder below it and its older shot Two's under SHOTS; the scene Dusk's own
-- folder. Q: another project, with an asset's folder holding a board, to be deleted whole.
SELECT public.t140_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1400-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Salt Hours', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1400-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Gone soon', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL);
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1400-0000-0000-0000-00000000000a', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1400-0000-0000-0000-00000000000a', '99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'reviewer')
ON CONFLICT DO NOTHING;
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('14000000-0000-0000-0000-0000000000a0', 'aaaa1400-0000-0000-0000-00000000000a', NULL, 'root', 'salt-hours', ''),
  ('14000000-0000-0000-0000-0000000000a1', 'aaaa1400-0000-0000-0000-00000000000a', '14000000-0000-0000-0000-0000000000a0', 'category', 'ASSETS', 'ASSETS'),
  ('14000000-0000-0000-0000-0000000000a2', 'aaaa1400-0000-0000-0000-00000000000a', '14000000-0000-0000-0000-0000000000a0', 'category', 'SCENES', 'SCENES'),
  ('14000000-0000-0000-0000-0000000000a3', 'aaaa1400-0000-0000-0000-00000000000a', '14000000-0000-0000-0000-0000000000a0', 'category', 'SHOTS', 'SHOTS'),
  ('14000000-0000-0000-0000-0000000000a4', 'aaaa1400-0000-0000-0000-00000000000a', '14000000-0000-0000-0000-0000000000a0', 'category', 'INVOICES', 'INVOICES'),
  ('14000000-0000-0000-0000-0000000000b0', 'aaaa1400-0000-0000-0000-00000000000b', NULL, 'root', 'gone-soon', ''),
  ('14000000-0000-0000-0000-0000000000b1', 'aaaa1400-0000-0000-0000-00000000000b', '14000000-0000-0000-0000-0000000000b0', 'category', 'ASSETS', 'ASSETS');
INSERT INTO public.assets (id, project_id, name) VALUES
  ('14000000-0000-0000-0000-0000000000c1', 'aaaa1400-0000-0000-0000-00000000000a', 'Mira'),
  ('14000000-0000-0000-0000-0000000000c2', 'aaaa1400-0000-0000-0000-00000000000b', 'Rook');
INSERT INTO public.scenes (id, project_id, workspace_id, name) VALUES
  ('14000000-0000-0000-0000-0000000000d1', 'aaaa1400-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Dawn'),
  ('14000000-0000-0000-0000-0000000000e1', 'aaaa1400-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Dusk');
INSERT INTO public.shots (id, project_id, workspace_id, scene_id, name) VALUES
  ('14000000-0000-0000-0000-0000000000d4', 'aaaa1400-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '14000000-0000-0000-0000-0000000000d1', 'One'),
  ('14000000-0000-0000-0000-0000000000d6', 'aaaa1400-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '14000000-0000-0000-0000-0000000000d1', 'Two');
INSERT INTO public.folders (id, project_id, parent_id, kind, entity_type, asset_id, scene_id, shot_id, slug, path) VALUES
  ('14000000-0000-0000-0000-0000000000a5', 'aaaa1400-0000-0000-0000-00000000000a', '14000000-0000-0000-0000-0000000000a1', 'entity', 'asset',
   '14000000-0000-0000-0000-0000000000c1', NULL, NULL, 'mira', 'ASSETS/mira'),
  ('14000000-0000-0000-0000-0000000000d2', 'aaaa1400-0000-0000-0000-00000000000a', '14000000-0000-0000-0000-0000000000a2', 'entity', 'scene',
   NULL, '14000000-0000-0000-0000-0000000000d1', NULL, 'dawn', 'SCENES/dawn'),
  ('14000000-0000-0000-0000-0000000000d5', 'aaaa1400-0000-0000-0000-00000000000a', '14000000-0000-0000-0000-0000000000d2', 'entity', 'shot',
   NULL, NULL, '14000000-0000-0000-0000-0000000000d4', 'one', 'SCENES/dawn/one'),
  ('14000000-0000-0000-0000-0000000000d7', 'aaaa1400-0000-0000-0000-00000000000a', '14000000-0000-0000-0000-0000000000a3', 'entity', 'shot',
   NULL, NULL, '14000000-0000-0000-0000-0000000000d6', 'two', 'SHOTS/two'),
  ('14000000-0000-0000-0000-0000000000e2', 'aaaa1400-0000-0000-0000-00000000000a', '14000000-0000-0000-0000-0000000000a2', 'entity', 'scene',
   NULL, '14000000-0000-0000-0000-0000000000e1', NULL, 'dusk', 'SCENES/dusk'),
  ('14000000-0000-0000-0000-0000000000b2', 'aaaa1400-0000-0000-0000-00000000000b', '14000000-0000-0000-0000-0000000000b1', 'entity', 'asset',
   '14000000-0000-0000-0000-0000000000c2', NULL, NULL, 'rook', 'ASSETS/rook');
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('14000000-0000-0000-0000-0000000000d3', 'aaaa1400-0000-0000-0000-00000000000a', '14000000-0000-0000-0000-0000000000d2', 'custom', 'refs', 'SCENES/dawn/refs'),
  ('14000000-0000-0000-0000-0000000000b3', 'aaaa1400-0000-0000-0000-00000000000b', '14000000-0000-0000-0000-0000000000b2', 'custom', 'plan', 'ASSETS/rook/plan');
INSERT INTO public.boards (id, folder_id) VALUES ('14000000-0000-0000-0000-0000000000f9', '14000000-0000-0000-0000-0000000000b3');
SELECT set_config('request.jwt.claims', '{}', true);

-- ── A. Structure ────────────────────────────────────────────────────────────
SELECT ok((SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
            WHERE t.tgrelid = 'public.folders'::regclass AND t.tgname = 'trg_folders_board_rescue')
          LIKE 'CREATE TRIGGER trg_folders_board_rescue BEFORE DELETE ON public.folders FOR EACH ROW WHEN ((old.kind = ''entity''::text)) EXECUTE FUNCTION fn_folders_board_rescue()',
  'a thing''s own folder is rescued from before it is deleted');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_folders_board_rescue()'::regprocedure)
          AND NOT has_function_privilege('authenticated', 'public.fn_folders_board_rescue()', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.fn_folders_board_rescue()', 'EXECUTE'),
  'the rescue is a definer no client may call');
SELECT ok(has_function_privilege('authenticated', 'public.moth_rename_folder(uuid,text)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.moth_rename_folder(uuid,text)', 'EXECUTE'),
  'renaming is a signed-in person''s alone');
SELECT is((SELECT string_agg(md5(replace(prosrc, chr(13), '')), ' ' ORDER BY proname) FROM pg_proc
            WHERE oid IN ('public.board_create(uuid,uuid,text)'::regprocedure, 'public.moth_move_folders(uuid[],uuid,boolean)'::regprocedure)),
  '8898169887a32b2ea63e0bbb71e04a33 41209fac54f1e1c2df25089acc5a7899', 'board_create and moth_move_folders are 0138''s');

-- ── B. Making a board ───────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t140_c();
SELECT is((public.board_create('aaaa1400-0000-0000-0000-00000000000a', '14000000-0000-0000-0000-0000000000a5', 'Looks') ->> 'path'),
  'ASSETS/mira/looks', 'a member makes a board inside an asset''s own folder');
SELECT is((public.board_create('aaaa1400-0000-0000-0000-00000000000a', '14000000-0000-0000-0000-0000000000d2', 'Looks') ->> 'path'),
  'SCENES/dawn/looks', 'and inside a scene''s');
SELECT is((public.board_create('aaaa1400-0000-0000-0000-00000000000a', '14000000-0000-0000-0000-0000000000d5', 'Plan') ->> 'path'),
  'SCENES/dawn/one/plan', 'and inside a shot''s, below its scene''s');
SELECT is((public.board_create('aaaa1400-0000-0000-0000-00000000000a', '14000000-0000-0000-0000-0000000000d7', 'Plan') ->> 'path'),
  'SHOTS/two/plan', 'and inside an older shot''s, under SHOTS');
SELECT is((public.board_create('aaaa1400-0000-0000-0000-00000000000a', '14000000-0000-0000-0000-0000000000d3', 'Boards') ->> 'path'),
  'SCENES/dawn/refs/boards', 'and inside a person''s own folder inside a scene''s');
SELECT is((public.board_create('aaaa1400-0000-0000-0000-00000000000a', public.t140_at('SCENES/dawn/looks'), 'Inner') ->> 'path'),
  'SCENES/dawn/looks/inner', 'and inside a board''s own folder');
SELECT is((public.board_create('aaaa1400-0000-0000-0000-00000000000a', '14000000-0000-0000-0000-0000000000a5', 'Invoices') ->> 'path'),
  'ASSETS/mira/invoices', 'a board named Invoices inside a thing''s folder is a board, not a money folder');
SELECT is(public.t140_err($$SELECT public.board_create('aaaa1400-0000-0000-0000-00000000000a', '14000000-0000-0000-0000-0000000000a4', 'Receipts')$$),
  '42501', 'never under a money folder');
SELECT is(public.t140_err($$SELECT public.board_create('aaaa1400-0000-0000-0000-00000000000a', NULL, 'Invoices')$$),
  '22023', 'nor a money name at the top');
SELECT public.t140_r();
SELECT is(public.t140_err($$SELECT public.board_create('aaaa1400-0000-0000-0000-00000000000a', '14000000-0000-0000-0000-0000000000a5', 'Look')$$),
  '42501', 'a reviewer makes none, in a thing''s folder or anywhere');

-- ── C. Moving a board into a thing's own folder ─────────────────────────────
SELECT public.t140_c();
SELECT is((public.board_create('aaaa1400-0000-0000-0000-00000000000a', NULL, 'Mood') ->> 'path'), 'mood', 'a board at the top');
SELECT is((public.moth_move_folders(ARRAY[public.t140_at('mood')], '14000000-0000-0000-0000-0000000000e2') -> 'moved' -> 0 ->> 'to'),
  'SCENES/dusk/mood', 'moves into a scene''s own folder');

-- ── D. Renaming ─────────────────────────────────────────────────────────────
SELECT is((public.moth_rename_folder(public.t140_at('SCENES/dawn/looks'), E'  Story\tboard ') ->> 'label'), 'Story board',
  'a board''s folder is renamed, the name cleaned as a board''s is');
SELECT is((SELECT slug || ' ' || path || ' ' || label FROM public.t140_f(public.t140_at('SCENES/dawn/looks'))),
  'looks SCENES/dawn/looks Story board', 'only its label changes: its slug and its path, and every file''s place, stay');
SELECT is((public.board_read((public.t140_board(public.t140_at('SCENES/dawn/looks'))).id) -> 'board' ->> 'title'), 'Story board',
  'the board reads its new title');
SELECT is((public.moth_rename_folder(public.t140_at('SCENES/dawn/looks'), 'Story board') ->> 'changed'), 'false',
  'the same name again changes nothing');
SELECT is(public.t140_words($$SELECT public.moth_rename_folder('14000000-0000-0000-0000-0000000000a1', 'Things')$$),
  'WILSON made this folder, so its name stays.', 'a category folder keeps its name');
SELECT is(public.t140_words($$SELECT public.moth_rename_folder('14000000-0000-0000-0000-0000000000a5', 'Mirabel')$$),
  'WILSON made this folder, so its name stays.', 'so does a thing''s own folder, named after the thing');
SELECT is(public.t140_err($$SELECT public.moth_rename_folder('14000000-0000-0000-0000-0000000000a0', 'Top')$$),
  '22023', 'and the project''s top');
SELECT is(public.t140_words($$SELECT public.moth_rename_folder('14000000-0000-0000-0000-0000000000d3', E' \t ')$$),
  'A name cannot be empty.', 'an empty name is refused');
SELECT is(public.t140_err($$SELECT public.moth_rename_folder('14000000-0000-0000-0000-0000000000d3', repeat('n', 121))$$),
  '22023', 'and one past 120 characters');
SELECT public.t140_r();
SELECT is(public.t140_err($$SELECT public.moth_rename_folder('14000000-0000-0000-0000-0000000000d3', 'Mine')$$),
  '42501', 'a reviewer renames nothing');
SELECT public.t140_b();
SELECT is(public.t140_err($$SELECT public.moth_rename_folder('14000000-0000-0000-0000-0000000000d3', 'Mine')$$),
  '42501', 'nor does another company');
SELECT public.t140_c();
SELECT is((public.moth_trash_folders(ARRAY[public.t140_at('SCENES/dusk/mood')]) ->> 'batches'), '1', 'a board inside Dusk goes to the trash');
SELECT is(public.t140_err($$SELECT public.moth_rename_folder(public.t140_at('SCENES/dusk/mood'), 'Back')$$),
  '42501', 'a folder in the trash is not renamed');
SELECT is((SELECT label FROM public.t140_f('14000000-0000-0000-0000-0000000000d3')), NULL, 'and none of the refusals changed a name');

-- A shape on Story board and a file in its folder, as a client would have placed them.
RESET ROLE;
SELECT public.t140_c();
INSERT INTO public.board_elements (board_id, kind, shape) VALUES ((public.t140_board(public.t140_at('SCENES/dawn/looks'))).id, 'shape', 'circle');
INSERT INTO public.files (id, project_id, folder_id, name, mime_type, storage_provider, storage_path, tags, is_financial) VALUES
  ('14000000-0000-0000-0000-000000000081', 'aaaa1400-0000-0000-0000-00000000000a', public.t140_at('SCENES/dawn/looks'), 'sticky.md', 'text/markdown', 'supabase',
   'projects/aaaa1400-0000-0000-0000-00000000000a/files/14000000-0000-0000-0000-000000000081/sticky.md', '{}', false);
CREATE TEMP TABLE t140_before ON COMMIT DROP AS
  SELECT b.id, b.folder_id, b.audience_gen, b.revision FROM public.boards b WHERE b.project_id = 'aaaa1400-0000-0000-0000-00000000000a';
GRANT SELECT ON t140_before TO authenticated;

-- ── E. A scene deleted by a client ──────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t140_c();
SELECT is(public.t140_err($$DELETE FROM public.scenes WHERE id = '14000000-0000-0000-0000-0000000000d1'$$), 'no refusal',
  'a member deletes the scene Dawn, with its shots');
SELECT is(COALESCE(current_setting('wilson.folder_op', true), ''), '', 'nothing is left set');
SELECT is((SELECT count(*)::int FROM public.boards WHERE project_id = 'aaaa1400-0000-0000-0000-00000000000a'), 7,
  'the member reads every board but the one in the trash, which is out of every read');
-- What the database holds, read whole (the board in the trash included).
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.folders WHERE id IN ('14000000-0000-0000-0000-0000000000d2', '14000000-0000-0000-0000-0000000000d3',
                                                                 '14000000-0000-0000-0000-0000000000d5', '14000000-0000-0000-0000-0000000000d7')),
  0, 'its own folder, its shots'' folders and the person''s folder in it are gone');
SELECT is((SELECT f.parent_id::text || ' ' || f.path FROM public.folders f WHERE f.project_id = 'aaaa1400-0000-0000-0000-00000000000a' AND f.label = 'Story board'),
  '14000000-0000-0000-0000-0000000000a0 looks', 'Story board is at the project''s top');
SELECT is((SELECT path FROM public.folders WHERE label = 'Inner' AND project_id = 'aaaa1400-0000-0000-0000-00000000000a'),
  'looks/inner', 'the board inside it went with it');
SELECT is((SELECT string_agg(f.path, ' ' ORDER BY f.path) FROM public.folders f
            WHERE f.project_id = 'aaaa1400-0000-0000-0000-00000000000a' AND f.label IN ('Plan', 'Boards')),
  'boards plan plan-2', 'the shots'' boards and the board in the person''s folder too, each under a free name');
SELECT ok((SELECT bool_and(f.parent_id = '14000000-0000-0000-0000-0000000000a0') FROM public.folders f
            WHERE f.project_id = 'aaaa1400-0000-0000-0000-00000000000a' AND f.label IN ('Plan', 'Boards', 'Story board')),
  'each directly under the top');
SELECT is((SELECT count(*)::int || ' ' || min(e.version) FROM public.board_elements e
            WHERE e.board_id = (SELECT b.id FROM public.boards b JOIN public.folders f ON f.id = b.folder_id WHERE f.label = 'Story board')),
  '1 1', 'its shape is there, at the version it had');
SELECT is((SELECT folder_id FROM public.files WHERE id = '14000000-0000-0000-0000-000000000081'),
  (SELECT f.id FROM public.folders f WHERE f.project_id = 'aaaa1400-0000-0000-0000-00000000000a' AND f.label = 'Story board'),
  'its file is still in its folder');
SELECT is((SELECT count(*)::int FROM t140_before b JOIN public.boards n ON n.id = b.id
            WHERE n.folder_id = b.folder_id AND n.audience_gen = b.audience_gen AND n.revision = b.revision),
  8, 'all eight boards are the boards they were: each folder, channel and revision unchanged');

-- ── F. A board in the trash inside a scene ──────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t140_c();
SELECT is(public.t140_err($$DELETE FROM public.scenes WHERE id = '14000000-0000-0000-0000-0000000000e1'$$), 'no refusal',
  'the scene Dusk, with a board of it in the trash, is deleted');
SELECT ok(EXISTS (SELECT 1 FROM jsonb_array_elements(public.moth_trashed_folders()) t(v)
                   WHERE (t.v ->> 'id')::uuid = public.t140_at('mood') AND (t.v ->> 'is_board')::boolean),
  'the trash still lists its board to bring back');
RESET ROLE;
SELECT ok((public.t140_f(public.t140_at('mood'))).deleted_at IS NOT NULL
          AND (public.t140_f(public.t140_at('mood'))).parent_id = '14000000-0000-0000-0000-0000000000a0'
          AND NOT EXISTS (SELECT 1 FROM public.folders WHERE id = '14000000-0000-0000-0000-0000000000e2'),
  'which is at the project''s top, still in the trash, and the scene''s folder is gone');

-- ── G. An asset's purge, with no one signed in ──────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
-- Put in the trash (the stamp writes its own time), then aged past the 30 days.
UPDATE public.assets SET deleted_at = now() WHERE id = '14000000-0000-0000-0000-0000000000c1';
UPDATE public.assets SET deleted_at = now() - interval '31 days' WHERE id = '14000000-0000-0000-0000-0000000000c1';
-- (A statement does not see what a function it calls changed: the purge runs alone, and is read in the next.)
SELECT ok(public.purge_soft_deleted() >= 1, 'the purge runs, with no one signed in');
SELECT is((SELECT count(*)::int FROM public.assets WHERE id = '14000000-0000-0000-0000-0000000000c1')
          + (SELECT count(*)::int FROM public.folders WHERE id = '14000000-0000-0000-0000-0000000000a5'),
  0, 'it took the asset Mira and its own folder');
SELECT is((SELECT string_agg(f.path, ' ' ORDER BY f.path) FROM public.folders f
            WHERE f.project_id = 'aaaa1400-0000-0000-0000-00000000000a' AND f.label IN ('Looks', 'Invoices')),
  'board-invoices looks-2', 'its boards are at the top: a money name made safe, a name taken made free');
SELECT is((SELECT count(*)::int FROM public.boards b JOIN public.folders f ON f.id = b.folder_id
            WHERE f.project_id = 'aaaa1400-0000-0000-0000-00000000000a' AND f.label IN ('Looks', 'Invoices')),
  2, 'both boards are kept');
SET LOCAL ROLE authenticated;
SELECT public.t140_c();
SELECT is((SELECT count(*)::int FROM public.boards b WHERE b.project_id = 'aaaa1400-0000-0000-0000-00000000000a'), 7,
  'and the member still reads the same seven, the one named Invoices among them');
SELECT ok(public.moth_can_read_target('folder', public.t140_at('board-invoices')),
  'Moth''s gate shows the board named Invoices: it is no money folder');

-- ── H. A project deleted takes its boards ───────────────────────────────────
RESET ROLE;
SELECT is(public.t140_err($$DELETE FROM public.projects WHERE id = 'aaaa1400-0000-0000-0000-00000000000b'$$), 'no refusal',
  'a project with a board in an asset''s folder is deleted, with no error');
SELECT is((SELECT count(*)::int FROM public.boards WHERE id = '14000000-0000-0000-0000-0000000000f9')
          + (SELECT count(*)::int FROM public.folders WHERE project_id = 'aaaa1400-0000-0000-0000-00000000000b'),
  0, 'its board and folders went with it');

SELECT * FROM finish();
ROLLBACK;
