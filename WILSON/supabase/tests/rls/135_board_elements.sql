-- =============================================================================
-- 135_board_elements.sql — M.O.T.H. Session 4 (MO4): a board's elements (0130).
--
-- A. Structure: forced row security, one read policy asking the board's folder gate and the element's file gate, a
--    client reads and never writes, the three keys, a file's delete leaves the element.
-- B. Saving: last writer wins each element and counts its version; an undo names the version it expects and is
--    skipped, not refused, when someone changed it since; another board's element is never reached; only the
--    styles, drawings and words a board knows; a reviewer, another company and someone with no write saves nothing;
--    at most 500 a save.
-- C. Files on a board: a sticky and a dropped file sit in the board's own folder; an embed is any file its writer may
--    read through Moth's gate, never a money or Legal file, never a private project's file the writer cannot read;
--    an element's file never changes.
-- D. Reading: the board's read gives every element, a file the reader may not read (or one gone) as a stop-sign tile
--    with no id and no name; the table's own read leaves such an element out; no read for someone who cannot see
--    the board.
-- E. Removing: a placement goes, its file stays; a stale undo is skipped; a connector's removed end leaves it free;
--    each change counts the board's revision.
-- F. Elements follow their board to another project.
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
    ('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, 'user_d@test.local'),
    ('99999999-9999-9999-9999-999999999999'::uuid, 'user_r@test.local')) u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'user', 'user_d', 'User D', true),
  ('11111111-1111-1111-1111-111111111111', '99999999-9999-9999-9999-999999999999', 'user', 'user_r', 'User R', true)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET is_active = EXCLUDED.is_active, app_role = EXCLUDED.app_role;

CREATE FUNCTION public.t135_as(p_user uuid, p_role text, p_ws uuid DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_role))::text, true);
END;
$f$;
CREATE FUNCTION public.t135_a() RETURNS void LANGUAGE sql AS $f$ SELECT public.t135_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin') $f$;
CREATE FUNCTION public.t135_b() RETURNS void LANGUAGE sql AS $f$ SELECT public.t135_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222') $f$;
CREATE FUNCTION public.t135_c() RETURNS void LANGUAGE sql AS $f$ SELECT public.t135_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user') $f$;
CREATE FUNCTION public.t135_d() RETURNS void LANGUAGE sql AS $f$ SELECT public.t135_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user') $f$;
CREATE FUNCTION public.t135_r() RETURNS void LANGUAGE sql AS $f$ SELECT public.t135_as('99999999-9999-9999-9999-999999999999', 'user') $f$;
CREATE FUNCTION public.t135_err(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
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
CREATE FUNCTION public.t135_words(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'no refusal';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$f$;
-- One element of a board's read, by its id, as the caller sees it.
CREATE FUNCTION public.t135_el(p_board uuid, p_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $f$
  SELECT e FROM jsonb_array_elements(public.board_read(p_board) -> 'elements') e WHERE e ->> 'id' = p_id::text
$f$;

-- P and P2 shared; X user_c's private project. Boards BP, BQ (both P) and BX (X); files in and out of BP's folder.
SELECT public.t135_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1350-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Salt Hours', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1350-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Second', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL);
SELECT public.t135_c();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1350-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Private', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true, NULL);
SELECT public.t135_a();
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1350-0000-0000-0000-00000000000a', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1350-0000-0000-0000-00000000000a', 'dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1350-0000-0000-0000-00000000000a', '99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'reviewer')
ON CONFLICT DO NOTHING;
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('13500000-0000-0000-0000-0000000000a0', 'aaaa1350-0000-0000-0000-00000000000a', NULL, 'root', 'salt-hours', ''),
  ('13500000-0000-0000-0000-0000000000a1', 'aaaa1350-0000-0000-0000-00000000000a', '13500000-0000-0000-0000-0000000000a0', 'custom', 'mood', 'mood'),
  ('13500000-0000-0000-0000-0000000000a2', 'aaaa1350-0000-0000-0000-00000000000a', '13500000-0000-0000-0000-0000000000a0', 'custom', 'plan', 'plan'),
  ('13500000-0000-0000-0000-0000000000b0', 'aaaa1350-0000-0000-0000-00000000000b', NULL, 'root', 'second', ''),
  ('13500000-0000-0000-0000-0000000000c0', 'aaaa1350-0000-0000-0000-00000000000c', NULL, 'root', 'private', ''),
  ('13500000-0000-0000-0000-0000000000c1', 'aaaa1350-0000-0000-0000-00000000000c', '13500000-0000-0000-0000-0000000000c0', 'custom', 'secret', 'secret');
INSERT INTO public.boards (id, folder_id) VALUES
  ('13500000-0000-0000-0000-0000000000f1', '13500000-0000-0000-0000-0000000000a1'),
  ('13500000-0000-0000-0000-0000000000f2', '13500000-0000-0000-0000-0000000000a2'),
  ('13500000-0000-0000-0000-0000000000f3', '13500000-0000-0000-0000-0000000000c1');
INSERT INTO public.files (id, project_id, folder_id, name, mime_type, storage_provider, storage_path, tags, is_financial) VALUES
  ('13500000-0000-0000-0000-000000000081', 'aaaa1350-0000-0000-0000-00000000000a', '13500000-0000-0000-0000-0000000000a1', 'note.md', 'text/markdown', 'supabase', 'projects/aaaa1350-0000-0000-0000-00000000000a/files/13500000-0000-0000-0000-000000000081/note.md', '{}', false),
  ('13500000-0000-0000-0000-000000000082', 'aaaa1350-0000-0000-0000-00000000000a', '13500000-0000-0000-0000-0000000000a1', 'pic.png', 'image/png', 'supabase', 'projects/aaaa1350-0000-0000-0000-00000000000a/files/13500000-0000-0000-0000-000000000082/pic.png', '{}', false),
  ('13500000-0000-0000-0000-000000000083', 'aaaa1350-0000-0000-0000-00000000000a', NULL, 'elsewhere.png', 'image/png', 'supabase', 'projects/aaaa1350-0000-0000-0000-00000000000a/files/13500000-0000-0000-0000-000000000083/elsewhere.png', '{}', false),
  ('13500000-0000-0000-0000-000000000084', 'aaaa1350-0000-0000-0000-00000000000a', NULL, 'fee.pdf', 'application/pdf', 'supabase', 'projects/aaaa1350-0000-0000-0000-00000000000a/files/13500000-0000-0000-0000-000000000084/fee.pdf', '{}', true),
  ('13500000-0000-0000-0000-000000000085', 'aaaa1350-0000-0000-0000-00000000000a', NULL, 'nda.pdf', 'application/pdf', 'supabase', 'projects/aaaa1350-0000-0000-0000-00000000000a/legal/a/nda.pdf', '{legal}', false),
  ('13500000-0000-0000-0000-000000000086', 'aaaa1350-0000-0000-0000-00000000000a', NULL, 'other.png', 'image/png', 'supabase', 'projects/aaaa1350-0000-0000-0000-00000000000a/files/13500000-0000-0000-0000-000000000086/other.png', '{}', false);
SELECT public.t135_c();
INSERT INTO public.files (id, project_id, folder_id, name, mime_type, storage_provider, storage_path, tags, is_financial) VALUES
  ('13500000-0000-0000-0000-0000000000c8', 'aaaa1350-0000-0000-0000-00000000000c', NULL, 'secret.png', 'image/png', 'supabase', 'projects/aaaa1350-0000-0000-0000-00000000000c/files/13500000-0000-0000-0000-0000000000c8/secret.png', '{}', false);
SELECT set_config('request.jwt.claims', '{}', true);

-- ── A. Structure ────────────────────────────────────────────────────────────
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.board_elements'::regclass),
  'board_elements: row security forced');
SELECT is((SELECT string_agg(policyname || ':' || cmd, ',' ORDER BY policyname) FROM pg_policies WHERE tablename = 'board_elements'),
  'board_elements_select:SELECT', 'one policy, a read');
SELECT ok((SELECT qual FROM pg_policies WHERE tablename = 'board_elements') ~ 'moth_can_read_target\(''folder'''
          AND (SELECT qual FROM pg_policies WHERE tablename = 'board_elements') ~ 'moth_can_read_target\(''file''',
  'which asks the board''s folder gate and the element''s file gate');
SELECT is((SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'board_elements' AND grantee = 'authenticated'),
  'SELECT', 'a client reads elements and never writes them');
SELECT is((SELECT string_agg(conname || ':' || confdeltype::text, ',' ORDER BY conname) FROM pg_constraint
            WHERE conrelid = 'public.board_elements'::regclass AND contype = 'f' AND confrelid <> 'public.workspaces'::regclass),
  'board_elements_board_fk:c,board_elements_file_id_fkey:n,board_elements_from_fk:n,board_elements_to_fk:n',
  'its board, its file (set null) and a connector''s two ends (set null) by key');

-- ── B. Saving ───────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t135_c();
SELECT is((public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(jsonb_build_object(
            'id', '13500000-0000-0000-0000-000000000e01', 'kind', 'shape', 'shape', 'rectangle', 'x', 10, 'y', 20, 'w', 100, 'h', 50,
            'style', jsonb_build_object('fill', '#ffcc00', 'stroke', '#222222', 'dash', 'dashed', 'width', 2), 'body', 'Hello')))
           -> 'saved' -> 0 ->> 'version'), '1', 'a member places a shape: version 1');
SELECT is((public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(jsonb_build_object(
            'id', '13500000-0000-0000-0000-000000000e01', 'x', 30)))
           -> 'saved' -> 0 ->> 'version'), '2', 'moving it saves over whatever is there: version 2');
SELECT is((public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(jsonb_build_object(
            'id', '13500000-0000-0000-0000-000000000e01', 'x', 10, 'expect', 1)))
           -> 'conflicts' -> 0 ->> 'version'), '2', 'an undo that expects version 1 is skipped and says the version there now');
SELECT is((SELECT x FROM public.board_elements WHERE id = '13500000-0000-0000-0000-000000000e01'), 30::double precision,
  'and changes nothing');
SELECT is((public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(jsonb_build_object(
            'id', '13500000-0000-0000-0000-000000000e01', 'x', 10, 'expect', 2)))
           -> 'saved' -> 0 ->> 'version'), '3', 'an undo over the version it expects is saved');
SELECT is((SELECT body || ':' || (style ->> 'dash') FROM public.board_elements WHERE id = '13500000-0000-0000-0000-000000000e01'),
  'Hello:dashed', 'what a save does not send stays as it was');
SELECT lives_ok($$SELECT public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(
    jsonb_build_object('id', '13500000-0000-0000-0000-000000000e02', 'kind', 'shape', 'shape', 'diamond', 'x', 300, 'y', 20, 'w', 80, 'h', 80),
    jsonb_build_object('id', '13500000-0000-0000-0000-000000000e03', 'kind', 'connector', 'from_id', '13500000-0000-0000-0000-000000000e01',
                       'from_anchor', 'right', 'to_id', '13500000-0000-0000-0000-000000000e02', 'to_anchor', 'left',
                       'style', jsonb_build_object('route', 'elbow', 'start_head', 'none', 'end_head', 'open_arrow', 'dash', 'dotted', 'width', 3),
                       'body', 'next'),
    jsonb_build_object('id', '13500000-0000-0000-0000-000000000e04', 'kind', 'pen', 'points', jsonb_build_array(0, 0, 5, 5, 9, 2)),
    jsonb_build_object('id', '13500000-0000-0000-0000-000000000e05', 'kind', 'frame', 'x', 0, 'y', 0, 'w', 900, 'h', 600, 'body', 'Act one'),
    jsonb_build_object('id', '13500000-0000-0000-0000-000000000e06', 'kind', 'text', 'x', 5, 'y', 5, 'body', 'Notes',
                       'style', jsonb_build_object('font_size', 24, 'align', 'center'))))$$,
  'a diamond, a connector between two shapes, a pen stroke, a named frame and a text box, in one save');
SELECT public.t135_d();
SELECT lives_ok($$SELECT public.board_put_elements('13500000-0000-0000-0000-0000000000f2', jsonb_build_array(jsonb_build_object(
            'id', '13500000-0000-0000-0000-000000000e21', 'kind', 'shape', 'shape', 'star')))$$,
  'another member places a star on the other board');
SELECT public.t135_c();
SELECT is((public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(jsonb_build_object(
            'id', '13500000-0000-0000-0000-000000000e21', 'kind', 'shape', 'shape', 'oval', 'x', 1))) -> 'saved' -> 0 ->> 'asked'),
  '13500000-0000-0000-0000-000000000e21', 'an id another board holds is never reached: the element is made under a new id');
SELECT is((SELECT shape || ':' || x FROM public.board_elements WHERE id = '13500000-0000-0000-0000-000000000e21'), 'star:0',
  'and the other board''s element is as it was');
SELECT is(public.t135_err($$SELECT public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(jsonb_build_object(
            'kind', 'connector', 'from_id', '13500000-0000-0000-0000-000000000e01', 'to_id', '13500000-0000-0000-0000-000000000e21')))$$),
  '23503', 'a connector never ends on another board''s element');
SELECT is(public.t135_err($$SELECT public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(jsonb_build_object(
            'id', '13500000-0000-0000-0000-000000000e07', 'kind', 'connector', 'from_id', '13500000-0000-0000-0000-000000000e07')))$$),
  '23514', 'nor on itself');
SELECT is(public.t135_err($$SELECT public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(jsonb_build_object(
            'kind', 'shape', 'shape', 'rectangle', 'style', jsonb_build_object('glow', '#ffffff'))))$$),
  '22023', 'a style key a board does not know is refused');
SELECT is(public.t135_err($$SELECT public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(jsonb_build_object(
            'kind', 'shape', 'shape', 'rectangle', 'style', jsonb_build_object('dash', 'wavy'))))$$),
  '22023', 'and a dash it does not know');
SELECT is(public.t135_err($$SELECT public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(jsonb_build_object(
            'kind', 'shape', 'shape', 'rectangle', 'style', jsonb_build_object('end_head', 'arrow'))))$$),
  '22023', 'an arrowhead belongs to a connector only');
SELECT is(public.t135_err($$SELECT public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(jsonb_build_object(
            'kind', 'pen', 'points', jsonb_build_array(1, 2, 3))))$$),
  '22023', 'a pen stroke is points in pairs');
SELECT is(public.t135_err($$SELECT public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(jsonb_build_object(
            'kind', 'shape', 'shape', 'blob')))$$),
  '23514', 'a shape a board does not draw is refused');
SELECT is(public.t135_err($$SELECT public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(jsonb_build_object(
            'kind', 'shape', 'shape', 'rectangle', 'file_id', '13500000-0000-0000-0000-000000000083')))$$),
  '23514', 'a shape holds no file');
SELECT is(public.t135_err($$SELECT public.board_put_elements('13500000-0000-0000-0000-0000000000f1',
            (SELECT jsonb_agg(jsonb_build_object('kind', 'shape', 'shape', 'circle')) FROM generate_series(1, 501)))$$),
  '54000', 'at most 500 a save');
SELECT is(public.t135_err($$INSERT INTO public.board_elements (board_id, kind, shape) VALUES ('13500000-0000-0000-0000-0000000000f1', 'shape', 'circle')$$),
  '42501', 'a client writes no element row of its own');
SELECT is(public.t135_err($$UPDATE public.board_elements SET x = 0$$), '42501', 'nor changes one');
SELECT public.t135_r();
SELECT is(public.t135_err($$SELECT public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(jsonb_build_object(
            'kind', 'shape', 'shape', 'circle')))$$),
  '42501', 'a reviewer saves nothing');
SELECT public.t135_b();
SELECT is(public.t135_err($$SELECT public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(jsonb_build_object(
            'kind', 'shape', 'shape', 'circle')))$$),
  '42501', 'nor another company');
SELECT public.t135_d();
SELECT is(public.t135_err($$SELECT public.board_put_elements('13500000-0000-0000-0000-0000000000f3', jsonb_build_array(jsonb_build_object(
            'kind', 'shape', 'shape', 'circle')))$$),
  '42501', 'nor someone who cannot see a private project''s board');

-- ── C. Files on a board ─────────────────────────────────────────────────────
SELECT public.t135_c();
SELECT lives_ok($$SELECT public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(
    jsonb_build_object('id', '13500000-0000-0000-0000-000000000e11', 'kind', 'sticky', 'file_id', '13500000-0000-0000-0000-000000000081',
                       'x', 50, 'y', 400, 'w', 160, 'h', 160, 'style', jsonb_build_object('colour', '#fff3a0')),
    jsonb_build_object('id', '13500000-0000-0000-0000-000000000e12', 'kind', 'media', 'file_id', '13500000-0000-0000-0000-000000000082'),
    jsonb_build_object('id', '13500000-0000-0000-0000-000000000e13', 'kind', 'embed', 'file_id', '13500000-0000-0000-0000-000000000083'),
    jsonb_build_object('id', '13500000-0000-0000-0000-000000000e14', 'kind', 'embed', 'file_id', '13500000-0000-0000-0000-000000000086')))$$,
  'a sticky and a picture in the board''s folder, and two embeds from elsewhere');
SELECT is(public.t135_err($$SELECT public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(jsonb_build_object(
            'kind', 'sticky', 'file_id', '13500000-0000-0000-0000-000000000081')))$$),
  '23505', 'one sticky a file, so one file has one turn');
SELECT is(public.t135_words($$SELECT public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(jsonb_build_object(
            'kind', 'sticky', 'file_id', '13500000-0000-0000-0000-000000000083')))$$),
  'A sticky or a dropped file lives in the board''s own folder.', 'a sticky''s file sits in the board''s folder');
SELECT is(public.t135_err($$SELECT public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(jsonb_build_object(
            'kind', 'sticky', 'body', 'words here', 'file_id', '13500000-0000-0000-0000-000000000081')))$$),
  '22023', 'a sticky''s words are its file''s, never the element''s');
SELECT is(public.t135_err($$SELECT public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(jsonb_build_object(
            'kind', 'embed')))$$),
  '22023', 'an embed needs its file');
SELECT is(public.t135_words($$SELECT public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(jsonb_build_object(
            'kind', 'embed', 'file_id', '13500000-0000-0000-0000-000000000084')))$$),
  'file not found', 'an invoice is never embedded, in the words a missing file gets');
SELECT is(public.t135_words($$SELECT public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(jsonb_build_object(
            'kind', 'embed', 'file_id', '13500000-0000-0000-0000-000000000085')))$$),
  'file not found', 'nor a Legal file');
SELECT public.t135_a();
SELECT is(public.t135_words($$SELECT public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(jsonb_build_object(
            'kind', 'embed', 'file_id', '13500000-0000-0000-0000-000000000084')))$$),
  'file not found', 'not even by an admin');
SELECT public.t135_d();
SELECT is(public.t135_words($$SELECT public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(jsonb_build_object(
            'kind', 'embed', 'file_id', '13500000-0000-0000-0000-0000000000c8')))$$),
  'file not found', 'nor a private project''s file the writer cannot read');
SELECT public.t135_c();
SELECT lives_ok($$SELECT public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(jsonb_build_object(
            'id', '13500000-0000-0000-0000-000000000e13', 'file_id', '13500000-0000-0000-0000-000000000086', 'x', 600)))$$,
  'a save that names another file moves the embed');
SELECT is((SELECT file_id FROM public.board_elements WHERE id = '13500000-0000-0000-0000-000000000e13'),
  '13500000-0000-0000-0000-000000000083'::uuid, 'but never changes its file');

-- ── D. Reading ──────────────────────────────────────────────────────────────
SELECT is(jsonb_array_length(public.board_read('13500000-0000-0000-0000-0000000000f1') -> 'elements'), 11,
  'the board''s read gives its eleven elements');
SELECT is(jsonb_typeof(public.board_read('13500000-0000-0000-0000-0000000000f1') -> 'next'), 'null', 'in one page');
SELECT is(jsonb_array_length(public.board_read('13500000-0000-0000-0000-0000000000f1',
            jsonb_build_object('z', 0, 'id', 'ffffffff-ffff-ffff-ffff-ffffffffffff')) -> 'elements'), 0,
  'and a page after the last is empty');
SELECT is(jsonb_array_length(public.board_read_elements('13500000-0000-0000-0000-0000000000f1',
            ARRAY['13500000-0000-0000-0000-000000000e01', '13500000-0000-0000-0000-000000000e05', '13500000-0000-0000-0000-000000000e21']::uuid[])), 2,
  'chosen elements read back, never another board''s');
SELECT is((public.board_read('13500000-0000-0000-0000-0000000000f1') -> 'board' ->> 'can_write'), 'true', 'and says its reader may change it');
SELECT public.t135_r();
SELECT is((public.board_read('13500000-0000-0000-0000-0000000000f1') -> 'board' ->> 'can_write')
          || ':' || jsonb_array_length(public.board_read('13500000-0000-0000-0000-0000000000f1') -> 'elements'),
  'false:11', 'a reviewer reads all of it and may not change it');
SELECT public.t135_b();
SELECT is(public.t135_err($$SELECT public.board_read('13500000-0000-0000-0000-0000000000f1')$$), '42501', 'another company reads nothing');
-- The embedded file goes to the trash: for everyone it is a stop-sign tile, with no id and no name.
RESET ROLE;
UPDATE public.files SET deleted_at = now() WHERE id = '13500000-0000-0000-0000-000000000083';
SET LOCAL ROLE authenticated;
SELECT public.t135_c();
SELECT is((public.t135_el('13500000-0000-0000-0000-0000000000f1', '13500000-0000-0000-0000-000000000e13') ->> 'missing')
          || ':' || jsonb_typeof(public.t135_el('13500000-0000-0000-0000-0000000000f1', '13500000-0000-0000-0000-000000000e13') -> 'file'),
  'true:null', 'a file in the trash leaves a stop-sign tile with no id or name');
SELECT is((SELECT count(*)::int FROM public.board_elements WHERE board_id = '13500000-0000-0000-0000-0000000000f1'), 10,
  'and the table''s own read leaves that element out');
SELECT is((public.t135_el('13500000-0000-0000-0000-0000000000f1', '13500000-0000-0000-0000-000000000e14') -> 'file' ->> 'name'),
  'other.png', 'a file the reader may read is named');
-- The other embedded file is deleted for good: the element stays, its file cleared.
RESET ROLE;
DELETE FROM public.files WHERE id = '13500000-0000-0000-0000-000000000086';
SET LOCAL ROLE authenticated;
SELECT is((public.t135_el('13500000-0000-0000-0000-0000000000f1', '13500000-0000-0000-0000-000000000e14') ->> 'missing'),
  'true', 'a file deleted for good leaves its tile too');
-- One reader's file is another's stop-sign: user_c embeds a file of their own private project.
SELECT public.t135_c();
SELECT lives_ok($$SELECT public.board_put_elements('13500000-0000-0000-0000-0000000000f1', jsonb_build_array(jsonb_build_object(
            'id', '13500000-0000-0000-0000-000000000e15', 'kind', 'embed', 'file_id', '13500000-0000-0000-0000-0000000000c8')))$$,
  'its maker embeds a private project''s file');
SELECT is((public.t135_el('13500000-0000-0000-0000-0000000000f1', '13500000-0000-0000-0000-000000000e15') -> 'file' ->> 'name'),
  'secret.png', 'and sees it named');
SELECT public.t135_d();
SELECT is((public.t135_el('13500000-0000-0000-0000-0000000000f1', '13500000-0000-0000-0000-000000000e15') ->> 'missing')
          || ':' || jsonb_typeof(public.t135_el('13500000-0000-0000-0000-0000000000f1', '13500000-0000-0000-0000-000000000e15') -> 'file'),
  'true:null', 'another member of the board sees a stop-sign tile, with no id or name');
SELECT is((SELECT count(*)::int FROM public.board_elements WHERE id = '13500000-0000-0000-0000-000000000e15'), 0,
  'and the table''s own read leaves it out for them');
SELECT public.t135_c();

-- ── E. Removing ─────────────────────────────────────────────────────────────
SELECT is((public.board_delete_elements('13500000-0000-0000-0000-0000000000f1', ARRAY['13500000-0000-0000-0000-000000000e11']::uuid[]) -> 'removed' ->> 0),
  '13500000-0000-0000-0000-000000000e11', 'a sticky''s placement is removed');
SELECT is((SELECT count(*)::int FROM public.files WHERE id = '13500000-0000-0000-0000-000000000081'), 1, 'and its file stays where it is');
SELECT is((public.board_delete_elements('13500000-0000-0000-0000-0000000000f1', ARRAY['13500000-0000-0000-0000-000000000e02']::uuid[], ARRAY[5]::bigint[])
           -> 'conflicts' -> 0 ->> 'version'), '1', 'an undo of a create, stale, is skipped');
SELECT lives_ok($$SELECT public.board_delete_elements('13500000-0000-0000-0000-0000000000f1', ARRAY['13500000-0000-0000-0000-000000000e02']::uuid[], ARRAY[1]::bigint[])$$,
  'and, current, removes it');
SELECT is((SELECT COALESCE(from_id::text, 'free') || ':' || COALESCE(to_id::text, 'free') FROM public.board_elements WHERE id = '13500000-0000-0000-0000-000000000e03'),
  '13500000-0000-0000-0000-000000000e01:free', 'a connector whose end was removed keeps its other end, the removed one free');
SELECT is((SELECT version FROM public.board_elements WHERE id = '13500000-0000-0000-0000-000000000e03'), 2::bigint,
  'and counts that as a version, so a stale undo of it is skipped');
SELECT ok((SELECT revision FROM public.boards WHERE id = '13500000-0000-0000-0000-0000000000f1') >= 8, 'each change counts the board''s revision');

-- ── F. Elements follow their board ──────────────────────────────────────────
RESET ROLE;
UPDATE public.folders SET project_id = 'aaaa1350-0000-0000-0000-00000000000b', parent_id = '13500000-0000-0000-0000-0000000000b0'
 WHERE id = '13500000-0000-0000-0000-0000000000a2';
SELECT is((SELECT project_id FROM public.board_elements WHERE id = '13500000-0000-0000-0000-000000000e21'),
  'aaaa1350-0000-0000-0000-00000000000b'::uuid, 'an element''s project follows its board''s folder');

SELECT * FROM finish();
ROLLBACK;
