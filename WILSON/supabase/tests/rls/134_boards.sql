-- =============================================================================
-- 134_boards.sql — M.O.T.H. Session 4 (MO4): boards (0130).
--
-- A. Structure: forced row security, one read policy through Moth's folder gate, a client reads and never writes,
--    the folder guard's trigger.
-- B. Making a board: a custom folder and its board in one step, under a folder the maker may change through Moth's
--    gate; a reviewer, a money or Legal tree, a private project not theirs, another person's space (an admin
--    included), another company and someone who has left: refused alike; names made unique, empty and long names.
-- C. Seeing a board: those Moth shows its folder to; an admin sees a private project's but never a personal space's.
-- D. A board stays with its folder: a client neither deletes nor moves a board's folder (nor deletes an ancestor of
--    one); renaming it is fine; a board's own keys never change; its project follows its folder's.
-- E. At most 500 boards a project.
-- F. A board's background (0136): a new board is on the dotted grid at version 0; a writer who is not the board's
--    maker changes it through board_set_background, which board_read then shows, stamped with who, at version 1;
--    the same value again changes nothing, keeps the version and leaves the row where it lies; the next change is
--    version 2; a value outside the three, or none, is refused; a reader who may not write, another company and
--    someone who has left are refused alike; anon may not ask; no client holds a column grant beyond SELECT on
--    either board table, a client never writes the column by hand, and the check holds even for the owner;
--    revision and audience_gen do not move; the version never goes down, even for the owner.
-- =============================================================================

BEGIN;
SELECT plan(64);

SELECT * FROM tests.rls_setup();

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
SELECT u.id, u.email, crypt('testpw', gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
       'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()
  FROM (VALUES
    ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'user_c@test.local'),
    ('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, 'user_d@test.local'),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, 'user_e@test.local'),
    ('99999999-9999-9999-9999-999999999999'::uuid, 'user_r@test.local'),
    ('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, 'user_n@test.local')) u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'user', 'user_d', 'User D', true),
  ('11111111-1111-1111-1111-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user', 'user_e', 'User E', true),
  ('11111111-1111-1111-1111-111111111111', '99999999-9999-9999-9999-999999999999', 'user', 'user_r', 'User R', true),
  ('11111111-1111-1111-1111-111111111111', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'user', 'user_n', 'User N', true)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET is_active = EXCLUDED.is_active, app_role = EXCLUDED.app_role;

CREATE FUNCTION public.t134_as(p_user uuid, p_role text, p_ws uuid DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_role))::text, true);
END;
$f$;
CREATE FUNCTION public.t134_a() RETURNS void LANGUAGE sql AS $f$ SELECT public.t134_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin') $f$;
CREATE FUNCTION public.t134_b() RETURNS void LANGUAGE sql AS $f$ SELECT public.t134_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222') $f$;
CREATE FUNCTION public.t134_c() RETURNS void LANGUAGE sql AS $f$ SELECT public.t134_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user') $f$;
CREATE FUNCTION public.t134_e() RETURNS void LANGUAGE sql AS $f$ SELECT public.t134_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user') $f$;
CREATE FUNCTION public.t134_r() RETURNS void LANGUAGE sql AS $f$ SELECT public.t134_as('99999999-9999-9999-9999-999999999999', 'user') $f$;
CREATE FUNCTION public.t134_n() RETURNS void LANGUAGE sql AS $f$ SELECT public.t134_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'user') $f$;
CREATE FUNCTION public.t134_err(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
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
CREATE FUNCTION public.t134_words(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'no refusal';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$f$;
-- A board's folder by its path in a project, as the database sees it.
CREATE FUNCTION public.t134_folder(p_project uuid, p_path text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $f$
  SELECT id FROM public.folders WHERE project_id = p_project AND path = p_path
$f$;
GRANT EXECUTE ON FUNCTION public.t134_folder(uuid, text) TO authenticated;

-- P and P2 shared, X user_c's private project, S user_e's personal space; each with its top folder.
SELECT public.t134_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1340-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Salt Hours', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1340-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Second', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL);
SELECT public.t134_c();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1340-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Private', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true, NULL);
SELECT public.t134_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1340-0000-0000-0000-0000000000e0', '11111111-1111-1111-1111-111111111111', 'Personal space', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1340-0000-0000-0000-00000000000a', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1340-0000-0000-0000-00000000000a', '99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1340-0000-0000-0000-00000000000a', 'ffffffff-ffff-ffff-ffff-ffffffffffff', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1340-0000-0000-0000-00000000000b', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT DO NOTHING;
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('13400000-0000-0000-0000-0000000000a0', 'aaaa1340-0000-0000-0000-00000000000a', NULL, 'root', 'salt-hours', ''),
  ('13400000-0000-0000-0000-0000000000a1', 'aaaa1340-0000-0000-0000-00000000000a', '13400000-0000-0000-0000-0000000000a0', 'category', 'INVOICES', 'INVOICES'),
  ('13400000-0000-0000-0000-0000000000a2', 'aaaa1340-0000-0000-0000-00000000000a', '13400000-0000-0000-0000-0000000000a0', 'custom', 'pitch', 'pitch'),
  ('13400000-0000-0000-0000-0000000000a3', 'aaaa1340-0000-0000-0000-00000000000a', '13400000-0000-0000-0000-0000000000a0', 'category', 'ASSETS', 'ASSETS'),
  ('13400000-0000-0000-0000-0000000000a4', 'aaaa1340-0000-0000-0000-00000000000a', '13400000-0000-0000-0000-0000000000a0', 'custom', 'legal', 'legal'),
  ('13400000-0000-0000-0000-0000000000b0', 'aaaa1340-0000-0000-0000-00000000000b', NULL, 'root', 'second', ''),
  ('13400000-0000-0000-0000-0000000000c0', 'aaaa1340-0000-0000-0000-00000000000c', NULL, 'root', 'private', ''),
  ('13400000-0000-0000-0000-0000000000e0', 'aaaa1340-0000-0000-0000-0000000000e0', NULL, 'root', 'ps-e', '');
-- A thing's own folder: the asset Mira's, below ASSETS.
INSERT INTO public.assets (id, project_id, name) VALUES ('13400000-0000-0000-0000-0000000000b1', 'aaaa1340-0000-0000-0000-00000000000a', 'Mira');
INSERT INTO public.folders (id, project_id, parent_id, kind, entity_type, asset_id, slug, path) VALUES
  ('13400000-0000-0000-0000-0000000000a5', 'aaaa1340-0000-0000-0000-00000000000a', '13400000-0000-0000-0000-0000000000a3', 'entity', 'asset',
   '13400000-0000-0000-0000-0000000000b1', 'mira', 'ASSETS/mira');
-- user_n leaves once everything is made.
UPDATE public.workspace_members SET is_active = false
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
SELECT set_config('request.jwt.claims', '{}', true);

-- ── A. Structure ────────────────────────────────────────────────────────────
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.boards'::regclass),
  'boards: row security forced');
SELECT is((SELECT string_agg(policyname || ':' || cmd, ',' ORDER BY policyname) FROM pg_policies WHERE tablename = 'boards'),
  'boards_select:SELECT', 'one policy, a read');
SELECT ok((SELECT qual FROM pg_policies WHERE tablename = 'boards' AND policyname = 'boards_select') ~ 'moth_can_read_target\(''folder''',
  'which asks Moth''s gate of the board''s folder');
SELECT is((SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'boards' AND grantee = 'authenticated'),
  'SELECT', 'a client reads boards and never writes them');
SELECT ok(NOT has_table_privilege('anon', 'public.boards', 'SELECT'), 'nothing for anon');
SELECT is((SELECT string_agg(t.tgname, ',') FROM pg_trigger t
            WHERE t.tgrelid = 'public.folders'::regclass AND t.tgfoid = 'public.fn_folders_board_guard()'::regprocedure),
  'trg_folders_board_guard', 'a folder holding a board is guarded');

-- ── B. Making a board ───────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t134_c();
SELECT is((public.board_create('aaaa1340-0000-0000-0000-00000000000a', NULL, 'Mood') ->> 'path'), 'mood',
  'a member makes a board at the project''s top');
SELECT is((public.board_create('aaaa1340-0000-0000-0000-00000000000a', NULL, 'Mood') ->> 'path'), 'mood-2',
  'a second of the same name is made unique');
SELECT is((public.board_create('aaaa1340-0000-0000-0000-00000000000a', '13400000-0000-0000-0000-0000000000a2', '  ') ->> 'title'), 'Board',
  'an empty name is "Board", under a folder of the project');
SELECT is((SELECT kind FROM public.folders WHERE id = public.t134_folder('aaaa1340-0000-0000-0000-00000000000a', 'pitch/board')),
  'custom', 'a board''s folder is a custom folder');
SELECT is(public.t134_err($$SELECT public.board_create('aaaa1340-0000-0000-0000-00000000000a', NULL, repeat('n', 121))$$),
  '22023', 'a name past 120 characters is refused');
SELECT is(public.t134_err($$SELECT public.board_create('aaaa1340-0000-0000-0000-00000000000a', '13400000-0000-0000-0000-0000000000a1', 'Receipts')$$),
  '42501', 'never under a money folder');
SELECT is(public.t134_err($$SELECT public.board_create('aaaa1340-0000-0000-0000-00000000000a', NULL, 'Invoices')$$),
  '22023', 'nor a board named as a money or Legal folder at the top, refused before any folder is looked up');
SELECT is(public.t134_err($$SELECT public.board_create('aaaa1340-0000-0000-0000-00000000000a', '13400000-0000-0000-0000-0000000000a4', 'Contracts')$$),
  '42501', 'nor under a Legal folder');
SELECT is(public.t134_err($$SELECT public.board_create('aaaa1340-0000-0000-0000-00000000000a', '13400000-0000-0000-0000-0000000000a5', 'Looks')$$),
  '22023', 'nor inside a thing''s own folder, which goes when the thing does');
SELECT is(public.t134_err($$SELECT public.board_create('aaaa1340-0000-0000-0000-00000000000a', '13400000-0000-0000-0000-0000000000b0', 'Other')$$),
  '42501', 'nor under another project''s folder');
SELECT ok((public.board_create('aaaa1340-0000-0000-0000-00000000000c', NULL, 'Secret') ->> 'board_id') IS NOT NULL,
  'its maker makes a board in a private project of their own');
SELECT is(public.t134_err($$INSERT INTO public.boards (folder_id, project_id, workspace_id)
                            VALUES ('13400000-0000-0000-0000-0000000000a2', 'aaaa1340-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111')$$),
  '42501', 'a client makes no board row of its own');
SELECT public.t134_r();
SELECT is(public.t134_err($$SELECT public.board_create('aaaa1340-0000-0000-0000-00000000000a', NULL, 'Look')$$),
  '42501', 'a reviewer makes none');
SELECT public.t134_n();
SELECT is(public.t134_err($$SELECT public.board_create('aaaa1340-0000-0000-0000-00000000000a', NULL, 'Gone')$$),
  '42501', 'nor someone who has left');
SELECT public.t134_b();
SELECT is(public.t134_err($$SELECT public.board_create('aaaa1340-0000-0000-0000-00000000000a', NULL, 'Away')$$),
  '42501', 'nor another company''s admin');
SELECT public.t134_a();
SELECT is(public.t134_err($$SELECT public.board_create('aaaa1340-0000-0000-0000-0000000000e0', NULL, 'Peek')$$),
  '42501', 'nor an admin in another person''s space');
SELECT public.t134_e();
SELECT ok((public.board_create('aaaa1340-0000-0000-0000-0000000000e0', NULL, 'Pitch ideas') ->> 'board_id') IS NOT NULL,
  'its owner makes a board in their own space');
SELECT is(public.t134_err($$SELECT public.board_create('aaaa1340-0000-0000-0000-00000000000c', NULL, 'Peek')$$),
  '42501', 'and none in someone else''s private project');

-- ── C. Seeing a board ───────────────────────────────────────────────────────
SELECT public.t134_c();
SELECT is((SELECT count(*)::int FROM public.boards), 4, 'its maker sees P''s three and X''s');
SELECT public.t134_r();
SELECT is((SELECT count(*)::int FROM public.boards), 3, 'a reviewer sees P''s');
SELECT public.t134_a();
SELECT is((SELECT count(*)::int FROM public.boards), 4, 'an admin sees P''s and the private project''s, never a personal space''s');
SELECT public.t134_e();
SELECT is((SELECT count(*)::int FROM public.boards), 4, 'an active member sees a shared project''s boards, and their own space''s');
SELECT public.t134_b();
SELECT is((SELECT count(*)::int FROM public.boards), 0, 'another company sees none');
SELECT public.t134_n();
SELECT is((SELECT count(*)::int FROM public.boards), 0, 'someone who has left sees none');

-- ── D. A board stays with its folder ────────────────────────────────────────
SELECT public.t134_c();
SELECT is(public.t134_words($$DELETE FROM public.folders WHERE id = public.t134_folder('aaaa1340-0000-0000-0000-00000000000a', 'mood')$$),
  'A board goes to the trash; it is not deleted here.', 'a client deletes no board''s folder');
SELECT is(public.t134_words($$DELETE FROM public.folders WHERE id = '13400000-0000-0000-0000-0000000000a2'$$),
  'A board goes to the trash; it is not deleted here.', 'nor a folder with a board below it');
SELECT is(public.t134_words($$UPDATE public.folders SET parent_id = '13400000-0000-0000-0000-0000000000a3', path = 'ASSETS/mood'
                               WHERE id = public.t134_folder('aaaa1340-0000-0000-0000-00000000000a', 'mood')$$),
  'A board moves through Move to.', 'nor moves a board''s folder by hand');
SELECT is(public.t134_words($$UPDATE public.folders SET parent_id = '13400000-0000-0000-0000-0000000000a3', path = 'ASSETS/pitch'
                               WHERE id = '13400000-0000-0000-0000-0000000000a2'$$),
  'A board moves through Move to.', 'nor moves by hand a folder with a board anywhere below it');
SELECT lives_ok($$UPDATE public.folders SET label = 'Mood, again' WHERE id = public.t134_folder('aaaa1340-0000-0000-0000-00000000000a', 'mood')$$,
  'renaming a board is renaming its folder');
SELECT is(public.t134_err($$UPDATE public.boards SET audience_gen = 9$$), '42501', 'a client changes no board row');
RESET ROLE;
SELECT is(public.t134_words($$UPDATE public.boards SET folder_id = '13400000-0000-0000-0000-0000000000a2'
                               WHERE folder_id = public.t134_folder('aaaa1340-0000-0000-0000-00000000000a', 'mood')$$),
  'A board stays with its folder.', 'a board never changes its folder, even for a definer');
SELECT is(public.t134_words($$UPDATE public.boards SET project_id = 'aaaa1340-0000-0000-0000-00000000000b'
                               WHERE folder_id = public.t134_folder('aaaa1340-0000-0000-0000-00000000000a', 'mood')$$),
  'A board stays with its folder.', 'nor its project by itself');
SELECT is(public.t134_words($$INSERT INTO public.boards (folder_id) VALUES ('13400000-0000-0000-0000-0000000000a3')$$),
  'A board is a folder of its own.', 'a board is never a category''s or the top folder''s');
-- A folder that moves to another project (0131's move does this) takes its board with it.
UPDATE public.folders SET project_id = 'aaaa1340-0000-0000-0000-00000000000b', parent_id = '13400000-0000-0000-0000-0000000000b0'
 WHERE id = public.t134_folder('aaaa1340-0000-0000-0000-00000000000a', 'mood-2');
SELECT is((SELECT project_id FROM public.boards WHERE folder_id = public.t134_folder('aaaa1340-0000-0000-0000-00000000000b', 'mood-2')),
  'aaaa1340-0000-0000-0000-00000000000b'::uuid, 'its project follows its folder''s');

-- ── E. At most 500 boards a project ─────────────────────────────────────────
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path)
SELECT ('13400000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid, 'aaaa1340-0000-0000-0000-00000000000a',
       '13400000-0000-0000-0000-0000000000a0', 'custom', 'b' || n, 'b' || n
  FROM generate_series(1, 497) n;
INSERT INTO public.boards (folder_id) SELECT ('13400000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid FROM generate_series(1, 497) n;
SELECT is((SELECT count(*)::int FROM public.boards WHERE project_id = 'aaaa1340-0000-0000-0000-00000000000a'), 499, 'P holds 499');
SET LOCAL ROLE authenticated;
SELECT public.t134_c();
SELECT ok((public.board_create('aaaa1340-0000-0000-0000-00000000000a', NULL, 'Five hundred') ->> 'board_id') IS NOT NULL, 'the 500th is made');
SELECT is(public.t134_err($$SELECT public.board_create('aaaa1340-0000-0000-0000-00000000000a', NULL, 'One more')$$),
  '54000', 'the 501st is refused');
RESET ROLE;

-- ── F. A board's background (0136) ──────────────────────────────────────────
-- A board by its folder's path in a project, as the database sees it.
CREATE FUNCTION public.t134_board(p_project uuid, p_path text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $f$
  SELECT b.id FROM public.boards b JOIN public.folders fo ON fo.id = b.folder_id
   WHERE fo.project_id = p_project AND fo.path = p_path
$f$;
GRANT EXECUTE ON FUNCTION public.t134_board(uuid, text) TO authenticated;
-- P's board "mood" as it stands before its background changes.
CREATE TEMP TABLE t134_bg_before AS
  SELECT revision, audience_gen FROM public.boards WHERE id = public.t134_board('aaaa1340-0000-0000-0000-00000000000a', 'mood');

SELECT is((SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
             JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
            WHERE a.attrelid = 'public.boards'::regclass AND a.attname = 'background'),
  '''dots''::text', 'boards.background starts on the dotted grid');
SELECT ok(has_function_privilege('authenticated', 'public.board_set_background(uuid,text)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.board_set_background(uuid,text)', 'EXECUTE'),
  'a signed-in person may ask to change a background; anon may not');
SELECT ok(NOT EXISTS (SELECT 1 FROM information_schema.column_privileges
                       WHERE table_schema = 'public' AND table_name IN ('boards', 'board_elements')
                         AND grantee IN ('authenticated', 'anon', 'PUBLIC') AND privilege_type <> 'SELECT'),
  'no client holds a column grant beyond SELECT on either board table');
SET LOCAL ROLE authenticated;
SELECT public.t134_c();
SELECT public.board_create('aaaa1340-0000-0000-0000-00000000000b', NULL, 'Fresh');
SELECT is(public.board_read(public.t134_board('aaaa1340-0000-0000-0000-00000000000b', 'fresh')) -> 'board' ->> 'background',
  'dots', 'a new board reads the dotted grid');
SELECT is(public.board_read(public.t134_board('aaaa1340-0000-0000-0000-00000000000b', 'fresh')) -> 'board'
            ->> 'background_version',
  '0', 'at background version 0');
-- "mood" is user_c's; an admin, who may also write it, changes it, so the stamp can only be the change's own.
SELECT public.t134_a();
SELECT is(public.board_set_background(public.t134_board('aaaa1340-0000-0000-0000-00000000000a', 'mood'), 'lines'),
  jsonb_build_object('board_id', public.t134_board('aaaa1340-0000-0000-0000-00000000000a', 'mood'),
                     'background', 'lines', 'version', 1, 'changed', true),
  'a writer sets the lined grid and is told it changed, at version 1');
SELECT is((public.board_read(public.t134_board('aaaa1340-0000-0000-0000-00000000000a', 'mood')) -> 'board' ->> 'background')
          || ':' || (public.board_read(public.t134_board('aaaa1340-0000-0000-0000-00000000000a', 'mood')) -> 'board'
                       ->> 'background_version'),
  'lines:1', 'and board_read shows it, at version 1');
SELECT is((SELECT updated_by FROM public.boards WHERE id = public.t134_board('aaaa1340-0000-0000-0000-00000000000a', 'mood')),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'the change is stamped with who made it, not the board''s maker');
RESET ROLE;
-- Where the row lies before a call that changes nothing.
CREATE TEMP TABLE t134_bg_row AS
  SELECT ctid::text AS before FROM public.boards WHERE id = public.t134_board('aaaa1340-0000-0000-0000-00000000000a', 'mood');
SET LOCAL ROLE authenticated;
SELECT is(public.board_set_background(public.t134_board('aaaa1340-0000-0000-0000-00000000000a', 'mood'), 'lines'),
  jsonb_build_object('board_id', public.t134_board('aaaa1340-0000-0000-0000-00000000000a', 'mood'),
                     'background', 'lines', 'version', 1, 'changed', false),
  'the same value again changes nothing and keeps version 1');
RESET ROLE;
SELECT is((SELECT ctid::text FROM public.boards WHERE id = public.t134_board('aaaa1340-0000-0000-0000-00000000000a', 'mood')),
  (SELECT before FROM t134_bg_row), 'and does not rewrite the row');
SET LOCAL ROLE authenticated;
SELECT is(public.board_set_background(public.t134_board('aaaa1340-0000-0000-0000-00000000000a', 'mood'), 'dots') ->> 'version',
  '2', 'the next change is version 2');
SELECT throws_ok($$SELECT public.board_set_background(public.t134_board('aaaa1340-0000-0000-0000-00000000000a', 'mood'), 'grid')$$,
  '22023', 'A board''s background is dotted, blank or lined.', 'a value outside the three is refused');
SELECT throws_ok($$SELECT public.board_set_background(public.t134_board('aaaa1340-0000-0000-0000-00000000000a', 'mood'), NULL)$$,
  '22023', 'A board''s background is dotted, blank or lined.', 'and so is none');
SELECT throws_ok($$UPDATE public.boards SET background = 'blank'
                    WHERE id = public.t134_board('aaaa1340-0000-0000-0000-00000000000a', 'mood')$$,
  '42501', NULL, 'a client never writes a background by hand');
SELECT public.t134_r();
SELECT throws_ok($$SELECT public.board_set_background(public.t134_board('aaaa1340-0000-0000-0000-00000000000a', 'mood'), 'blank')$$,
  '42501', 'board not found or not writable', 'a reviewer, who reads the board, may not change it');
SELECT throws_ok($$SELECT public.board_set_background(public.t134_board('aaaa1340-0000-0000-0000-00000000000a', 'mood'), 'grid')$$,
  '42501', 'board not found or not writable', 'and is refused as a non-writer before the value is weighed');
SELECT public.t134_b();
SELECT throws_ok($$SELECT public.board_set_background(public.t134_board('aaaa1340-0000-0000-0000-00000000000a', 'mood'), 'blank')$$,
  '42501', 'board not found or not writable', 'nor another company''s admin');
SELECT public.t134_n();
SELECT throws_ok($$SELECT public.board_set_background(public.t134_board('aaaa1340-0000-0000-0000-00000000000a', 'mood'), 'blank')$$,
  '42501', 'board not found or not writable', 'nor someone who has left');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
SELECT throws_ok($$UPDATE public.boards SET background = 'grid'
                    WHERE id = public.t134_board('aaaa1340-0000-0000-0000-00000000000a', 'mood')$$,
  '23514', NULL, 'boards_background_chk refuses a value outside the three, even for the owner');
SELECT is((SELECT revision || '.' || audience_gen FROM public.boards
            WHERE id = public.t134_board('aaaa1340-0000-0000-0000-00000000000a', 'mood')),
  (SELECT revision || '.' || audience_gen FROM t134_bg_before), 'a background moves neither revision nor audience_gen');
-- The version stands at 2 here. A window keeps the highest it has heard, so it must never go down, whoever writes.
SELECT throws_ok($$UPDATE public.boards SET background_version = background_version - 1
                    WHERE id = public.t134_board('aaaa1340-0000-0000-0000-00000000000a', 'mood')$$,
  '42501', 'A board''s counts only go up.', 'a background''s version never goes down, even for the owner');

SELECT * FROM finish();
ROLLBACK;
