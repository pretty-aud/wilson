-- =============================================================================
-- 119_moth_moves.sql — M.O.T.H. Session 1 (MO1), the one move operation (0118).
--
-- moth_move_items, moth_undo_move and fn_moth_apply_moves: who may call, what reads as
-- not there, each refusal, what a move does to a row and what it leaves, undo and redo,
-- and an office-server file's two ways back. Table-less: file_moves has suite 114.
--
-- Fixture ids: projects aaaa1190-…, folders 11900000-…-0000000000fx, files 11900000-…-…
-- user_a (rls_setup) is the admin; user_c a plain member; user_d a workspace manager; user_e
-- creates the private project; user_v a reviewer; user_n is not active any more.
-- =============================================================================

BEGIN;

SELECT plan(258);

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
    ('abababab-abab-abab-abab-abababababab'::uuid, 'user_v@test.local'),
    ('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, 'user_n@test.local')) u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager', 'user_d', 'User D', true),
  ('11111111-1111-1111-1111-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user', 'user_e', 'User E', true),
  ('11111111-1111-1111-1111-111111111111', 'abababab-abab-abab-abab-abababababab', 'user', 'user_v', 'User V', true),
  ('11111111-1111-1111-1111-111111111111', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'user', 'user_n', 'User N', false)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

CREATE FUNCTION public.t119_as(p_user uuid, p_role text, p_ws uuid DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_role))::text, true);
END;
$f$;
CREATE FUNCTION public.t119_a() RETURNS void LANGUAGE sql AS $f$ SELECT public.t119_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin') $f$;
CREATE FUNCTION public.t119_c() RETURNS void LANGUAGE sql AS $f$ SELECT public.t119_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user') $f$;
CREATE FUNCTION public.t119_d() RETURNS void LANGUAGE sql AS $f$ SELECT public.t119_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager') $f$;
CREATE FUNCTION public.t119_e() RETURNS void LANGUAGE sql AS $f$ SELECT public.t119_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user') $f$;
CREATE FUNCTION public.t119_v() RETURNS void LANGUAGE sql AS $f$ SELECT public.t119_as('abababab-abab-abab-abab-abababababab', 'user') $f$;

-- A file with its stored copy, as nothing but the runner can write it.
CREATE FUNCTION public.t119_file(p_id uuid, p_project uuid, p_name text, p_folder uuid DEFAULT NULL, p_thumb boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_key text := 'projects/' || p_project || '/files/' || p_id || '/' || p_name;
BEGIN
  INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('rabbit-files', v_key, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, folder_id, thumbnail_url)
  VALUES (p_id, p_project, p_name, 'supabase', v_key, p_folder, CASE WHEN p_thumb THEN v_key || '.jpg' END);
END;
$f$;
CREATE FUNCTION public.t119_local(p_id uuid, p_project uuid, p_name text)
RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
  VALUES (p_id, p_project, p_name, 'local_server', 'projects/' || p_project || '/files/' || p_id || '/' || p_name);
$f$;
CREATE FUNCTION public.t119_share(p_id uuid, p_project uuid, p_loc text)
RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, size_bytes, source_modified_at)
  VALUES (p_id, p_project, regexp_replace(p_loc, '^.*/', ''), 'network_share', 'nas:' || p_loc, 1, '2026-10-01T10:00:00Z');
$f$;
CREATE FUNCTION public.t119_m(p_ids uuid[], p_dest uuid, p_folder uuid DEFAULT NULL, p_plan boolean DEFAULT false, p_bodies jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $f$ SELECT public.moth_move_items(p_ids, p_dest, p_folder, p_plan, p_bodies) $f$;

-- A refusal's DETAIL, which is the sentence a person reads.
CREATE FUNCTION public.t119_detail(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  d text;
BEGIN
  EXECUTE p_sql;
  RETURN 'no refusal';
EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS d = PG_EXCEPTION_DETAIL;
  RETURN d;
END;
$f$;

CREATE TEMP TABLE t119_ret (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON t119_ret TO authenticated;
CREATE FUNCTION public.t119_v(p_key text) RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT v FROM t119_ret WHERE k = p_key $f$;
CREATE FUNCTION public.t119_move_id(p_key text) RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT (v ->> 'move_id')::uuid FROM t119_ret WHERE k = p_key $f$;
CREATE FUNCTION public.t119_op(p_key text) RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT (v -> 'ops' -> 0 ->> 'op_id')::uuid FROM t119_ret WHERE k = p_key $f$;

-- 0049 asks the caller's seat, so the fixtures carry the admin's claims.
SELECT public.t119_a();

INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1190-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Salt Hours', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1190-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Moon Film', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1190-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Quiet Room', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true, NULL),
  ('aaaa1190-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'Reviewed', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1190-0000-0000-0000-00000000000e', '11111111-1111-1111-1111-111111111111', 'Goner', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1190-0000-0000-0000-0000000000c0', '11111111-1111-1111-1111-111111111111', 'Personal space', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true, 'cccccccc-cccc-cccc-cccc-cccccccccccc');

INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1190-0000-0000-0000-00000000000a', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1190-0000-0000-0000-00000000000a', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1190-0000-0000-0000-00000000000a', 'abababab-abab-abab-abab-abababababab', '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1190-0000-0000-0000-00000000000b', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1190-0000-0000-0000-00000000000b', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1190-0000-0000-0000-00000000000b', 'abababab-abab-abab-abab-abababababab', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1190-0000-0000-0000-00000000000d', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1190-0000-0000-0000-00000000000e', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT DO NOTHING;

INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('11900000-0000-0000-0000-0000000000f0', 'aaaa1190-0000-0000-0000-00000000000a', NULL, 'root', 'salt', ''),
  ('11900000-0000-0000-0000-0000000000f1', 'aaaa1190-0000-0000-0000-00000000000a', '11900000-0000-0000-0000-0000000000f0', 'category', 'rushes', 'rushes'),
  ('11900000-0000-0000-0000-0000000000f2', 'aaaa1190-0000-0000-0000-00000000000a', '11900000-0000-0000-0000-0000000000f0', 'category', 'plates', 'plates'),
  ('11900000-0000-0000-0000-0000000000f3', 'aaaa1190-0000-0000-0000-00000000000a', '11900000-0000-0000-0000-0000000000f0', 'category', 'invoices', 'INVOICES'),
  ('11900000-0000-0000-0000-0000000000f4', 'aaaa1190-0000-0000-0000-00000000000a', '11900000-0000-0000-0000-0000000000f0', 'category', 'gone', 'gone'),
  ('11900000-0000-0000-0000-0000000000f8', 'aaaa1190-0000-0000-0000-00000000000b', NULL, 'root', 'moon', ''),
  ('11900000-0000-0000-0000-0000000000f9', 'aaaa1190-0000-0000-0000-00000000000b', '11900000-0000-0000-0000-0000000000f8', 'category', 'in', 'in'),
  ('11900000-0000-0000-0000-0000000000fa', 'aaaa1190-0000-0000-0000-00000000000b', '11900000-0000-0000-0000-0000000000f8', 'category', 'invoices', 'INVOICES');

-- What a file can be linked to.
INSERT INTO public.phases (id, project_id, name) VALUES ('11900000-0000-0000-0000-0000000000a1', 'aaaa1190-0000-0000-0000-00000000000a', 'Phase');
INSERT INTO public.assets (id, project_id, workspace_id, name) VALUES ('11900000-0000-0000-0000-0000000000a2', 'aaaa1190-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Asset');
INSERT INTO public.tasks (id, project_id, workspace_id, title) VALUES ('11900000-0000-0000-0000-0000000000a3', 'aaaa1190-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Task');
INSERT INTO public.scenes (id, project_id, workspace_id) VALUES ('11900000-0000-0000-0000-0000000000a4', 'aaaa1190-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111');
INSERT INTO public.shots (id, project_id, scene_id, name, shot_number) VALUES ('11900000-0000-0000-0000-0000000000a5', 'aaaa1190-0000-0000-0000-00000000000a', '11900000-0000-0000-0000-0000000000a4', 'SH1', 1);
INSERT INTO public.levels (id, project_id, name) VALUES ('11900000-0000-0000-0000-0000000000a6', 'aaaa1190-0000-0000-0000-00000000000a', 'L1');
INSERT INTO public.experiences (id, project_id, name) VALUES ('11900000-0000-0000-0000-0000000000a7', 'aaaa1190-0000-0000-0000-00000000000a', 'X1');

SELECT public.t119_file('11900000-0000-0000-0000-000000000101', 'aaaa1190-0000-0000-0000-00000000000a', 'one.mov');
SELECT public.t119_file('11900000-0000-0000-0000-000000000102', 'aaaa1190-0000-0000-0000-00000000000a', 'two.mov');
SELECT public.t119_file('11900000-0000-0000-0000-000000000103', 'aaaa1190-0000-0000-0000-00000000000a', 'three.mov');
UPDATE public.files SET phase_id = '11900000-0000-0000-0000-0000000000a1', asset_id = '11900000-0000-0000-0000-0000000000a2',
                        task_id = '11900000-0000-0000-0000-0000000000a3', scene_id = '11900000-0000-0000-0000-0000000000a4',
                        shot_id = '11900000-0000-0000-0000-0000000000a5', level_id = '11900000-0000-0000-0000-0000000000a6', experience_id = '11900000-0000-0000-0000-0000000000a7',
                        folder_id = '11900000-0000-0000-0000-0000000000f1', is_core_definer = true
 WHERE id = '11900000-0000-0000-0000-000000000101';

-- Rows Moth never moves.
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial) VALUES
  ('11900000-0000-0000-0000-000000000111', 'aaaa1190-0000-0000-0000-00000000000a', 'inv.pdf', 'supabase', 'projects/aaaa1190-0000-0000-0000-00000000000a/invoices/a/inv.pdf', true);
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, tags) VALUES
  ('11900000-0000-0000-0000-000000000112', 'aaaa1190-0000-0000-0000-00000000000a', 'nda.pdf', 'supabase', 'projects/aaaa1190-0000-0000-0000-00000000000a/legal/a/nda.pdf', '{legal}');
SELECT public.t119_file('11900000-0000-0000-0000-000000000113', 'aaaa1190-0000-0000-0000-00000000000a', 'in-money.pdf', '11900000-0000-0000-0000-0000000000f3');
SELECT public.t119_file('11900000-0000-0000-0000-000000000114', 'aaaa1190-0000-0000-0000-00000000000a', 'receipt.pdf');
INSERT INTO public.expenses (id, workspace_id, project_id, file_ids) VALUES
  ('11900000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111', 'aaaa1190-0000-0000-0000-00000000000a', ARRAY['11900000-0000-0000-0000-000000000114'::uuid]);
SELECT public.t119_file('11900000-0000-0000-0000-000000000115', 'aaaa1190-0000-0000-0000-00000000000a', 'trashed.mov');
UPDATE public.files SET deleted_at = now() WHERE id = '11900000-0000-0000-0000-000000000115';
SELECT public.t119_file('11900000-0000-0000-0000-000000000116', 'aaaa1190-0000-0000-0000-00000000000c', 'hidden.mov');


-- ── A. Who may call ─────────────────────────────────────────────────────────
SELECT is(has_function_privilege('anon', 'public.moth_move_items(uuid[],uuid,uuid,boolean,jsonb)', 'EXECUTE'), false, 'anon cannot move');
SELECT is(has_function_privilege('anon', 'public.moth_undo_move(uuid,boolean)', 'EXECUTE'), false, 'nor undo');
SELECT is(has_function_privilege('authenticated', 'public.moth_move_items(uuid[],uuid,uuid,boolean,jsonb)', 'EXECUTE'), true, 'CONTROL: a signed-in person may ask');
SELECT is(has_function_privilege('anon', 'public.network_share_stale_moves()', 'EXECUTE'), false, 'anon cannot list a stale move');
SELECT is((SELECT array_agg(x) FROM unnest(ARRAY[
    'public.fn_moth_apply_moves(jsonb,uuid,boolean)', 'public._moth_dest_eligible(uuid,uuid)', 'public._moth_lock_moves(uuid[],uuid[],uuid[])',
    'public._moth_key_leaf(text)', 'public._moth_links_alive(jsonb,uuid)', 'public._moth_share_back(uuid,uuid,text,jsonb,boolean)',
    'public._network_share_replay_origin(uuid)']) x
   WHERE has_function_privilege('authenticated', x::regprocedure, 'EXECUTE') OR has_function_privilege('anon', x::regprocedure, 'EXECUTE')), NULL::text[],
  'the core and its helpers are closed to every client');

SET LOCAL ROLE authenticated;
SELECT public.t119_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'user');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000102'::uuid], 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:not_a_workspace_member', 'someone no longer active is refused first');
SELECT throws_ok($$ SELECT public.moth_undo_move('11900000-0000-0000-0000-00000000dead') $$, 'P0001', 'moth_move:not_a_workspace_member', 'and at undo');
SELECT throws_ok($$ SELECT public.network_share_stale_moves() $$, '42501', 'network_share: not allowed', 'nor list a stale move');
SELECT public.t119_c();
SELECT throws_ok($$ SELECT public.t119_m('{}'::uuid[], 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:empty', 'no files');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY[NULL::uuid], 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:empty', 'only a NULL');
SELECT throws_ok($$ SELECT public.t119_m((SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 501)), 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:too_many', 'over 500');
SELECT throws_ok($$ SELECT public.t119_m((SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 500)), 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:not_found', 'and exactly 500 goes on to be judged');


-- ── B. What reads as not there, in one sentence ─────────────────────────────
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-00000000dead'::uuid], 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:not_found', 'a file that does not exist');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000111'::uuid], 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:not_found', 'an invoice reads the same');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000112'::uuid], 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:not_found', 'a Legal file');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000113'::uuid], 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:not_found', 'a file under INVOICES');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000114'::uuid], 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:not_found', 'a file an expense names');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000115'::uuid], 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:not_found', 'a trashed file');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000116'::uuid], 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:not_found', 'a file in a private project');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000102'::uuid], '11900000-0000-0000-0000-00000000dead') $$, 'P0001', 'moth_move:not_found', 'a destination that does not exist');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000102'::uuid], NULL) $$, 'P0001', 'moth_move:not_found', 'no destination');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000102'::uuid], 'aaaa1190-0000-0000-0000-00000000000c') $$, 'P0001', 'moth_move:not_found', 'a private project');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000102'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', '11900000-0000-0000-0000-0000000000f1') $$, 'P0001', 'moth_move:not_found', 'a folder of another project');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000102'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', '11900000-0000-0000-0000-0000000000fa') $$, 'P0001', 'moth_move:not_found', 'a locked folder');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000102'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', '11900000-0000-0000-0000-00000000dead') $$, 'P0001', 'moth_move:not_found', 'a folder that does not exist');
SELECT public.t119_a();
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000102'::uuid], 'aaaa1190-0000-0000-0000-0000000000c0') $$, 'P0001', 'moth_move:not_found', 'an admin into someone''s personal space');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000111'::uuid], 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:not_found', 'and an admin''s invoice');
SELECT public.t119_d();
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000102'::uuid], 'aaaa1190-0000-0000-0000-00000000000c') $$, 'P0001', 'moth_move:not_found', 'a manager into a private project');
SELECT public.t119_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000102'::uuid], 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:not_found', 'another company''s admin');
SELECT public.t119_c();

-- One bad file in a batch stops all of it, and the hidden one speaks before the rights.
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000102'::uuid, '11900000-0000-0000-0000-000000000103'::uuid, '11900000-0000-0000-0000-000000000111'::uuid], 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:not_found', 'two good files and an invoice');
SELECT public.t119_v();
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000102'::uuid, '11900000-0000-0000-0000-000000000116'::uuid], 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:not_found', 'a hidden file is hidden whatever else the caller may not do');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.files WHERE id IN ('11900000-0000-0000-0000-000000000102', '11900000-0000-0000-0000-000000000103') AND project_id = 'aaaa1190-0000-0000-0000-00000000000a'), 2, 'and nothing moved');
SELECT is((SELECT count(*)::int FROM public.file_moves WHERE workspace_id = '11111111-1111-1111-1111-111111111111'), 0, 'and no journal row');
SET LOCAL ROLE authenticated;


-- ── C. The rights ───────────────────────────────────────────────────────────
SELECT public.t119_v();
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000102'::uuid], 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:not_allowed_source', 'a reviewer of the source');
SELECT public.t119_c();
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000102'::uuid], 'aaaa1190-0000-0000-0000-00000000000d') $$, 'P0001', 'moth_move:not_allowed_destination', 'a reviewer of the destination');


-- ── D. Between projects, by association ─────────────────────────────────────
INSERT INTO t119_ret SELECT 'p1', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000101'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', '11900000-0000-0000-0000-0000000000f9', true);
SELECT is(public.t119_v('p1') -> 'items' -> 0 ->> 'how', 'metadata', 'the plan says how it goes');
SELECT is(public.t119_v('p1') -> 'items' -> 0 -> 'to_path', NULL::jsonb, 'and hands out no key it does not need to');
RESET ROLE;
SELECT is((SELECT project_id FROM public.files WHERE id = '11900000-0000-0000-0000-000000000101'), 'aaaa1190-0000-0000-0000-00000000000a'::uuid, 'the plan writes nothing');
SELECT is((SELECT count(*)::int FROM public.file_moves WHERE workspace_id = '11111111-1111-1111-1111-111111111111'), 0, 'not even a journal row');
SET LOCAL ROLE authenticated;

INSERT INTO t119_ret SELECT 'm1', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000101'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', '11900000-0000-0000-0000-0000000000f9');
SELECT is((public.t119_v('m1') ->> 'moved')::int, 1, 'the commit says how many');
SELECT is((public.t119_v('m1') ->> 'links_cleared')::int, 7, 'and how many links went');
SELECT is(public.t119_v('m1') -> 'ops', '[]'::jsonb, 'and leaves the desktop nothing to do');
SELECT is(current_setting('wilson.file_move', true), '', 'the marker is empty after the call');
RESET ROLE;
SELECT is((SELECT row(project_id, folder_id)::text FROM public.files WHERE id = '11900000-0000-0000-0000-000000000101'),
  '(aaaa1190-0000-0000-0000-00000000000b,11900000-0000-0000-0000-0000000000f9)', 'the row is in the new project and folder');
SELECT is((SELECT num_nulls(phase_id, asset_id, task_id, scene_id, shot_id, level_id, experience_id) FROM public.files WHERE id = '11900000-0000-0000-0000-000000000101'), 7, 'all seven links are empty');
SELECT is((SELECT is_core_definer FROM public.files WHERE id = '11900000-0000-0000-0000-000000000101'), false, 'and it no longer steers the destination''s agent');
SELECT is((SELECT storage_path FROM public.files WHERE id = '11900000-0000-0000-0000-000000000101'),
  'projects/aaaa1190-0000-0000-0000-00000000000a/files/11900000-0000-0000-0000-000000000101/one.mov', 'the body stays where it is');
SELECT is((SELECT count(*)::int FROM public.storage_gc_queue WHERE file_id = '11900000-0000-0000-0000-000000000101'), 0, 'and nothing is queued');
SELECT is((SELECT count(*)::int FROM public.file_moves WHERE workspace_id = '11111111-1111-1111-1111-111111111111'), 1, 'one journal row');
SELECT is((SELECT row(actor_user_id, created_by, txid = txid_current(), undo_of IS NULL, undone_at IS NULL)::text FROM public.file_moves WHERE id = public.t119_move_id('m1')),
  '(cccccccc-cccc-cccc-cccc-cccccccccccc,cccccccc-cccc-cccc-cccc-cccccccccccc,t,t,t)', 'naming who, in this transaction');
SELECT is((SELECT array_agg(k ORDER BY k) FROM public.file_moves m, jsonb_array_elements(m.items) e, jsonb_object_keys(e) k WHERE m.id = public.t119_move_id('m1')),
  ARRAY['from_folder', 'from_links', 'from_path', 'from_project', 'from_provider', 'from_thumb', 'how', 'id', 'to_core', 'to_folder', 'to_links', 'to_path', 'to_project', 'to_provider', 'to_thumb', 'was_core_definer'],
  'the journal holds what an undo needs');
SELECT is((SELECT items -> 0 -> 'from_links' ->> 'task_id' FROM public.file_moves WHERE id = public.t119_move_id('m1')), '11900000-0000-0000-0000-0000000000a3', 'each link it had');
SELECT is((SELECT count(*)::int FROM public.file_events WHERE file_id = '11900000-0000-0000-0000-000000000101' AND event = 'moved_out' AND project_id = 'aaaa1190-0000-0000-0000-00000000000a' AND old_path IS NULL AND new_path IS NULL), 1, 'moved_out on the old side, with no paths');
SELECT is((SELECT count(*)::int FROM public.file_events WHERE file_id = '11900000-0000-0000-0000-000000000101' AND event = 'moved_in' AND project_id = 'aaaa1190-0000-0000-0000-00000000000b' AND old_path IS NULL AND new_path IS NULL), 1, 'moved_in on the new');
SELECT is((SELECT count(*)::int FROM public.file_events e WHERE e.file_id = '11900000-0000-0000-0000-000000000101' AND e.project_id = 'aaaa1190-0000-0000-0000-00000000000b' AND row_to_json(e)::text LIKE '%aaaa1190-0000-0000-0000-00000000000a%'), 0, 'and nothing on the new side names the old project');
SELECT is((SELECT count(*)::int FROM public.file_events WHERE file_id = '11900000-0000-0000-0000-000000000101' AND (event = 'moved' OR (event = 'refiled' AND details ->> 'to_folder_id' = '11900000-0000-0000-0000-0000000000f9'))), 0, 'no moved or refiled row with it');
SELECT is((SELECT count(*)::int FROM public.edit_history WHERE entity_type = 'files' AND entity_id = '11900000-0000-0000-0000-000000000101' AND diff ? 'project_id' AND actor_user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'), 1, 'edit history names the caller');
SELECT is((SELECT project_id FROM public.edit_history WHERE entity_type = 'files' AND entity_id = '11900000-0000-0000-0000-000000000101' AND diff ? 'project_id'), NULL::uuid, 'and belongs to neither project, so neither side reads the other''s id');
SET LOCAL ROLE authenticated;


-- ── E. Within one project ───────────────────────────────────────────────────
RESET ROLE;
UPDATE public.files SET task_id = '11900000-0000-0000-0000-0000000000a3' WHERE id = '11900000-0000-0000-0000-000000000103';
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'p3', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000103'::uuid], 'aaaa1190-0000-0000-0000-00000000000a', NULL, true);
SELECT is(public.t119_v('p3') -> 'items' -> 0 ->> 'how', 'none', 'already there, nothing to do');
SELECT is(public.t119_m(ARRAY['11900000-0000-0000-0000-000000000103'::uuid], 'aaaa1190-0000-0000-0000-00000000000a') ->> 'moved', '0', 'a commit with nothing to do moves nothing');
INSERT INTO t119_ret SELECT 'm3', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000103'::uuid], 'aaaa1190-0000-0000-0000-00000000000a', '11900000-0000-0000-0000-0000000000f2');
SELECT is((public.t119_v('m3') ->> 'links_cleared')::int, 0, 'a folder change clears no links');
RESET ROLE;
SELECT is((SELECT row(folder_id, task_id)::text FROM public.files WHERE id = '11900000-0000-0000-0000-000000000103'),
  '(11900000-0000-0000-0000-0000000000f2,11900000-0000-0000-0000-0000000000a3)', 'the folder changes and the link stays');
SELECT is((SELECT details ->> 'to_folder_id' FROM public.file_events WHERE file_id = '11900000-0000-0000-0000-000000000103' AND event = 'refiled'), '11900000-0000-0000-0000-0000000000f2', 'refiled, saying where');
SELECT is((SELECT count(*)::int FROM public.file_moves WHERE workspace_id = '11111111-1111-1111-1111-111111111111'), 2, 'the commit with nothing to do wrote no journal row');
SET LOCAL ROLE authenticated;
-- To no folder at all: the guard lets a NULL through without the journal, and this still writes it.
INSERT INTO t119_ret SELECT 'm3b', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000103'::uuid], 'aaaa1190-0000-0000-0000-00000000000a');
RESET ROLE;
SELECT is((SELECT folder_id FROM public.files WHERE id = '11900000-0000-0000-0000-000000000103'), NULL::uuid, 'to no folder');
SELECT is((SELECT count(*)::int FROM public.file_moves WHERE id = public.t119_move_id('m3b')), 1, 'journalled all the same');
SELECT public.t119_a();
SET LOCAL ROLE authenticated;
SELECT public.t119_c();


-- ── F. What cannot move between projects ────────────────────────────────────
RESET ROLE;
SELECT public.t119_file('11900000-0000-0000-0000-000000000201', 'aaaa1190-0000-0000-0000-00000000000a', 'versioned.mov');
SELECT public.t119_a();
INSERT INTO public.asset_versions (id, asset_id, version_no, file_id) VALUES ('11900000-0000-0000-0000-0000000000b1', '11900000-0000-0000-0000-0000000000a2', 1, '11900000-0000-0000-0000-000000000201');
SELECT public.t119_file('11900000-0000-0000-0000-000000000202', 'aaaa1190-0000-0000-0000-00000000000a', 'read.pdf');
INSERT INTO public.ingestion_runs (id, project_id) VALUES ('11900000-0000-0000-0000-0000000000b2', 'aaaa1190-0000-0000-0000-00000000000a');
INSERT INTO public.ingestion_chunks (id, run_id, chunk_index, file_id) VALUES ('11900000-0000-0000-0000-0000000000b3', '11900000-0000-0000-0000-0000000000b2', 0, '11900000-0000-0000-0000-000000000202');
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path) VALUES
  ('11900000-0000-0000-0000-000000000203', 'aaaa1190-0000-0000-0000-00000000000a', 'gone.mov', 'supabase', 'projects/aaaa1190-0000-0000-0000-00000000000a/files/11900000-0000-0000-0000-000000000203/gone.mov'),
  ('11900000-0000-0000-0000-000000000204', 'aaaa1190-0000-0000-0000-00000000000a', 'odd.mov', 'supabase', 'somewhere/else.mov'),
  ('11900000-0000-0000-0000-000000000205', 'aaaa1190-0000-0000-0000-00000000000a', 's3.mov', 's3', 'projects/aaaa1190-0000-0000-0000-00000000000a/files/11900000-0000-0000-0000-000000000205/s3.mov'),
  ('11900000-0000-0000-0000-000000000206', 'aaaa1190-0000-0000-0000-00000000000a', 'drive.mov', 'google_drive', 'projects/aaaa1190-0000-0000-0000-00000000000a/files/11900000-0000-0000-0000-000000000206/drive.mov');
INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('rabbit-files', 'somewhere/else.mov', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SET LOCAL ROLE authenticated;
SELECT public.t119_c();
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000201'::uuid], 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:is_an_asset_version', 'an asset''s version');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000202'::uuid], 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:has_extracted_text', 'a file with extracted text');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000203'::uuid], 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:body_missing', 'a file with no stored copy');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000204'::uuid], 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:body_shape', 'a key that cannot move');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000205'::uuid], 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:s3_moves_off', 'the company''s own bucket, until 0120');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000206'::uuid], 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:body_elsewhere', 'a file kept elsewhere');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000205'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, true) $$, 'P0001', 'moth_move:s3_moves_off', 'and the plan says so too');
INSERT INTO t119_ret SELECT 'm5', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000205'::uuid], 'aaaa1190-0000-0000-0000-00000000000a', '11900000-0000-0000-0000-0000000000f2');
SELECT is(public.t119_v('m5') ->> 'moved', '1', 'and within its project any of them may change folder');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000102'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, false, jsonb_build_array(jsonb_build_object('file_id', '11900000-0000-0000-0000-000000000102', 'path', 'x'))) $$, 'P0001', 'moth_move:copy_not_needed', 'a copy nobody asked for');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000102'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, false, '{"file_id":"x"}'::jsonb) $$, 'P0001', 'moth_move:copy_refused', 'copies that are not a list');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000102'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, false, jsonb_build_array(jsonb_build_object('file_id', '11900000-0000-0000-0000-000000000103', 'path', 'x'))) $$, 'P0001', 'moth_move:copy_refused', 'a copy for a file not in the batch');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000102'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, false, jsonb_build_array(jsonb_build_object('file_id', '11900000-0000-0000-0000-000000000102', 'path', 'x'), jsonb_build_object('file_id', '11900000-0000-0000-0000-000000000102', 'path', 'y'))) $$, 'P0001', 'moth_move:copy_refused', 'two copies for one file');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000102'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, false, jsonb_build_array(jsonb_build_object('file_id', 'not-a-uuid', 'path', 'x'))) $$, 'P0001', 'moth_move:copy_refused', 'a copy naming no file');


-- ── G. A fresh copy, when the key would name a hidden project ───────────────
RESET ROLE;
SELECT public.t119_file('11900000-0000-0000-0000-000000000301', 'aaaa1190-0000-0000-0000-00000000000c', 'private_name.mov', NULL, true);
UPDATE public.files SET name = 'private name.mov' WHERE id = '11900000-0000-0000-0000-000000000301';
SET LOCAL ROLE authenticated;
SELECT public.t119_e();
INSERT INTO t119_ret SELECT 'p6', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000301'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, true);
SELECT is(public.t119_v('p6') -> 'items' -> 0 ->> 'how', 'rehome', 'a key naming a private project needs a new copy');
SELECT is(public.t119_v('p6') -> 'items' -> 0 ->> 'to_provider', 'supabase', 'in the company''s storage');
SELECT ok(public.t119_v('p6') -> 'items' -> 0 ->> 'to_path' ~ '^projects/aaaa1190-0000-0000-0000-00000000000b/files/11900000-0000-0000-0000-000000000301/[0-9]{13}-private_name\.mov$',
  'the server mints the key, under the destination, with a safe name');
SELECT is(public.t119_v('p6') -> 'items' -> 0 ->> 'to_thumb', (public.t119_v('p6') -> 'items' -> 0 ->> 'to_path') || '.jpg', 'and the picture beside it');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000301'::uuid], 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:needs_copy', 'the commit wants it');
SELECT is(public.t119_detail($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000301'::uuid], 'aaaa1190-0000-0000-0000-00000000000b') $$), 'This file has to be copied to the new project first.', 'and says so in a sentence');
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES
  ('rabbit-files', 'projects/aaaa1190-0000-0000-0000-00000000000b/files/11900000-0000-0000-0000-000000000302/1700000000000-private_name.mov', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  ('rabbit-files', 'projects/aaaa1190-0000-0000-0000-00000000000b/files/11900000-0000-0000-0000-000000000301/1700000000000-other.mov', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  ('rabbit-files', 'projects/aaaa1190-0000-0000-0000-00000000000b/files/11900000-0000-0000-0000-000000000301/soon-private_name.mov', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000301'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, false, jsonb_build_array(jsonb_build_object('file_id', '11900000-0000-0000-0000-000000000301', 'path', 'projects/aaaa1190-0000-0000-0000-00000000000a/files/11900000-0000-0000-0000-000000000301/1700000000000-private_name.mov'))) $$, 'P0001', 'moth_move:copy_refused', 'a key under another project');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000301'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, false, jsonb_build_array(jsonb_build_object('file_id', '11900000-0000-0000-0000-000000000301', 'path', 'projects/aaaa1190-0000-0000-0000-00000000000b/files/11900000-0000-0000-0000-000000000302/1700000000000-private_name.mov'))) $$, 'P0001', 'moth_move:copy_refused', 'a key for another file');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000301'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, false, jsonb_build_array(jsonb_build_object('file_id', '11900000-0000-0000-0000-000000000301', 'path', 'projects/aaaa1190-0000-0000-0000-00000000000b/files/11900000-0000-0000-0000-000000000301/1700000000000-other.mov'))) $$, 'P0001', 'moth_move:plan_changed', 'a key with another name: renamed since the plan, so it is planned again');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000301'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, false, jsonb_build_array(jsonb_build_object('file_id', '11900000-0000-0000-0000-000000000301', 'path', 'projects/aaaa1190-0000-0000-0000-00000000000b/files/11900000-0000-0000-0000-000000000301/soon-private_name.mov'))) $$, 'P0001', 'moth_move:copy_refused', 'a key with no time in it');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000301'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, false, jsonb_build_array(jsonb_build_object('file_id', '11900000-0000-0000-0000-000000000301', 'path', public.t119_v('p6') -> 'items' -> 0 ->> 'to_path'))) $$, 'P0001', 'moth_move:copy_refused', 'the right key with no copy there yet');
SELECT is(public.t119_detail($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000301'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, false, jsonb_build_array(jsonb_build_object('file_id', '11900000-0000-0000-0000-000000000301', 'path', public.t119_v('p6') -> 'items' -> 0 ->> 'to_path'))) $$), 'The new copy is not one this project can use.', 'in a sentence');
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name, owner_id) SELECT 'rabbit-files', public.t119_v('p6') -> 'items' -> 0 ->> 'to_path', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000301'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, false, jsonb_build_array(jsonb_build_object('file_id', '11900000-0000-0000-0000-000000000301', 'path', public.t119_v('p6') -> 'items' -> 0 ->> 'to_path', 'thumbnail', 'elsewhere.jpg'))) $$, 'P0001', 'moth_move:copy_refused', 'a picture that is not the copy''s');
RESET ROLE;
UPDATE public.files SET name = 'renamed since.mov' WHERE id = '11900000-0000-0000-0000-000000000301';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000301'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, false, jsonb_build_array(jsonb_build_object('file_id', '11900000-0000-0000-0000-000000000301', 'path', public.t119_v('p6') -> 'items' -> 0 ->> 'to_path'))) $$, 'P0001', 'moth_move:plan_changed', 'a file renamed while its copy was made is planned again');
RESET ROLE;
UPDATE public.files SET name = 'private name.mov' WHERE id = '11900000-0000-0000-0000-000000000301';
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'm6', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000301'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, false, jsonb_build_array(jsonb_build_object('file_id', '11900000-0000-0000-0000-000000000301', 'path', public.t119_v('p6') -> 'items' -> 0 ->> 'to_path', 'thumbnail', public.t119_v('p6') -> 'items' -> 0 ->> 'to_thumb')));
RESET ROLE;
SELECT is((SELECT row(project_id::text, storage_path = public.t119_v('p6') -> 'items' -> 0 ->> 'to_path', thumbnail_url = public.t119_v('p6') -> 'items' -> 0 ->> 'to_thumb')::text FROM public.files WHERE id = '11900000-0000-0000-0000-000000000301'),
  '(aaaa1190-0000-0000-0000-00000000000b,t,t)', 'the row takes the new key and picture with the project, in one update');
SELECT is((SELECT array_agg(kind || ':' || bucket_id ORDER BY kind) FROM public.storage_gc_queue WHERE file_id = '11900000-0000-0000-0000-000000000301' AND reason = 'file-purged' AND status = 'pending'),
  ARRAY['body:rabbit-files', 'thumbnail:rabbit-thumbnails'], 'and the old copy and picture are queued');
SELECT is((SELECT count(*)::int FROM public.file_events e WHERE e.file_id = '11900000-0000-0000-0000-000000000301' AND e.project_id = 'aaaa1190-0000-0000-0000-00000000000b' AND row_to_json(e)::text LIKE '%aaaa1190-0000-0000-0000-00000000000c%'), 0, 'nothing on the new side names the private project it came from');
SELECT is((SELECT count(*)::int FROM public.file_events e WHERE e.file_id = '11900000-0000-0000-0000-000000000301' AND e.project_id = 'aaaa1190-0000-0000-0000-00000000000b' AND e.event = 'moved_in'), 1, 'CONTROL: and it does hear the file arrive');
SELECT is((SELECT count(*)::int FROM public.edit_history h WHERE h.entity_type = 'files' AND h.entity_id = '11900000-0000-0000-0000-000000000301' AND h.project_id = 'aaaa1190-0000-0000-0000-00000000000b'), 0, 'and no history row of the move is the new project''s to read');


-- ── H. A body on one computer ───────────────────────────────────────────────
SELECT public.t119_local('11900000-0000-0000-0000-000000000401', 'aaaa1190-0000-0000-0000-00000000000a', 'local.mov');
SELECT public.t119_local('11900000-0000-0000-0000-000000000402', 'aaaa1190-0000-0000-0000-00000000000a', 'mine.mov');
SET LOCAL ROLE authenticated;
SELECT public.t119_e();
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000401'::uuid], 'aaaa1190-0000-0000-0000-00000000000c') $$, 'P0001', 'moth_move:only_on_a_computer', 'not into a private project');
SELECT public.t119_c();
INSERT INTO t119_ret SELECT 'p7', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000401'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, true);
SELECT is(public.t119_v('p7') -> 'items' -> 0 ->> 'how', 'copy_up', 'a shared project takes a copy up');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000401'::uuid], 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:needs_desktop', 'only the computer that holds it can make one');
SELECT is(public.t119_detail($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000401'::uuid], 'aaaa1190-0000-0000-0000-00000000000b') $$), 'Move it from the computer it was added on.', 'and says which');
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name, owner_id) SELECT 'rabbit-files', public.t119_v('p7') -> 'items' -> 0 ->> 'to_path', 'cccccccc-cccc-cccc-cccc-cccccccccccc';
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'm7', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000401'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, false, jsonb_build_array(jsonb_build_object('file_id', '11900000-0000-0000-0000-000000000401', 'path', public.t119_v('p7') -> 'items' -> 0 ->> 'to_path')));
RESET ROLE;
SELECT is((SELECT row(storage_provider::text, storage_path = public.t119_v('p7') -> 'items' -> 0 ->> 'to_path', project_id::text)::text FROM public.files WHERE id = '11900000-0000-0000-0000-000000000401'),
  '(supabase,t,aaaa1190-0000-0000-0000-00000000000b)', 'the provider, the key and the project change together');
SELECT is((SELECT count(*)::int FROM public.storage_gc_queue WHERE file_id = '11900000-0000-0000-0000-000000000401'), 0, 'its desktop removes the original, not the queue');
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'p8', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000402'::uuid], 'aaaa1190-0000-0000-0000-0000000000c0', NULL, true);
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name, owner_id) SELECT 'rabbit-files', public.t119_v('p8') -> 'items' -> 0 ->> 'to_path', 'cccccccc-cccc-cccc-cccc-cccccccccccc';
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'm8', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000402'::uuid], 'aaaa1190-0000-0000-0000-0000000000c0', NULL, false, jsonb_build_array(jsonb_build_object('file_id', '11900000-0000-0000-0000-000000000402', 'path', public.t119_v('p8') -> 'items' -> 0 ->> 'to_path')));
SELECT is(public.t119_v('m8') ->> 'moved', '1', 'and so does the caller''s own space');
-- Its key now names a private space, so it cannot go back by association.
SELECT throws_ok($$ SELECT public.moth_undo_move(public.t119_move_id('m8')) $$, 'P0001', 'moth_move:needs_copy', 'the way back would need a fresh copy, so it says move it back with Move to');
SELECT is(public.t119_detail($$ SELECT public.moth_undo_move(public.t119_move_id('m8')) $$), 'Move it back with Move to.', 'in those words');


-- ── I. Undo and redo ────────────────────────────────────────────────────────
SELECT public.t119_e();
SELECT throws_ok($$ SELECT public.moth_undo_move(public.t119_move_id('m1')) $$, 'P0001', 'moth_move:not_found', 'another person''s move reads as not there');
SELECT public.t119_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222');
SELECT throws_ok($$ SELECT public.moth_undo_move(public.t119_move_id('m1')) $$, 'P0001', 'moth_move:not_found', 'and another company''s');
SELECT public.t119_c();
SELECT throws_ok($$ SELECT public.moth_undo_move('11900000-0000-0000-0000-00000000dead') $$, 'P0001', 'moth_move:not_found', 'and one that never was');
INSERT INTO t119_ret SELECT 'u1p', public.moth_undo_move(public.t119_move_id('m1'), true);
SELECT is(public.t119_v('u1p') -> 'items' -> 0 ->> 'how', 'metadata', 'an undo can be planned');
RESET ROLE;
SELECT is((SELECT project_id FROM public.files WHERE id = '11900000-0000-0000-0000-000000000101'), 'aaaa1190-0000-0000-0000-00000000000b'::uuid, 'and the plan moves nothing');
SELECT is((SELECT undone_at FROM public.file_moves WHERE id = public.t119_move_id('m1')), NULL::timestamptz, 'nor marks it undone');
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'u1', public.moth_undo_move(public.t119_move_id('m1'));
RESET ROLE;
SELECT is((SELECT row(project_id, folder_id, phase_id, asset_id, task_id, scene_id, shot_id, level_id, experience_id, is_core_definer)::text FROM public.files WHERE id = '11900000-0000-0000-0000-000000000101'),
  '(aaaa1190-0000-0000-0000-00000000000a,11900000-0000-0000-0000-0000000000f1,11900000-0000-0000-0000-0000000000a1,11900000-0000-0000-0000-0000000000a2,11900000-0000-0000-0000-0000000000a3,11900000-0000-0000-0000-0000000000a4,11900000-0000-0000-0000-0000000000a5,11900000-0000-0000-0000-0000000000a6,11900000-0000-0000-0000-0000000000a7,t)',
  'undo restores the project, the folder, every link and the flag');
SELECT is((public.t119_v('u1') ->> 'links_not_restored')::int, 0, 'and says nothing was left behind');
SELECT is((public.t119_v('u1') ->> 'pictures_not_restored')::int, 0, 'no picture either');
SELECT is(public.t119_v('m1') -> 'links_not_restored', NULL::jsonb, 'which only an undo says');
SELECT ok((SELECT undone_at IS NOT NULL FROM public.file_moves WHERE id = public.t119_move_id('m1')), 'the journal row is marked');
SELECT is((SELECT undo_of FROM public.file_moves WHERE id = public.t119_move_id('u1')), public.t119_move_id('m1'), 'and the new one says what it undoes');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.moth_undo_move(public.t119_move_id('m1')) $$, 'P0001', 'moth_move:already_undone', 'a second undo');
INSERT INTO t119_ret SELECT 'r1', public.moth_undo_move(public.t119_move_id('u1'));
RESET ROLE;
SELECT is((SELECT row(project_id, folder_id, task_id, is_core_definer)::text FROM public.files WHERE id = '11900000-0000-0000-0000-000000000101'),
  '(aaaa1190-0000-0000-0000-00000000000b,11900000-0000-0000-0000-0000000000f9,,f)', 'redo is the undo of the undo');
SET LOCAL ROLE authenticated;
-- Moved again by hand since: the record no longer says where it is.
INSERT INTO t119_ret SELECT 'm1c', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000101'::uuid], 'aaaa1190-0000-0000-0000-00000000000b');
SELECT throws_ok($$ SELECT public.moth_undo_move(public.t119_move_id('r1')) $$, 'P0001', 'moth_move:changed_since', 'after another move, it is not where this one left it');
RESET ROLE;
SELECT public.t119_a();
SET LOCAL ROLE authenticated;
SELECT public.t119_c();
-- Trashed since: the same answer, and nothing moves.
RESET ROLE;
UPDATE public.files SET deleted_at = now() WHERE id = '11900000-0000-0000-0000-000000000101';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.moth_undo_move(public.t119_move_id('m1c')) $$, 'P0001', 'moth_move:changed_since', 'a file trashed since has changed');
RESET ROLE;
UPDATE public.files SET deleted_at = NULL WHERE id = '11900000-0000-0000-0000-000000000101';

-- What has gone from the old project since does not come back, and the rest does.
SELECT public.t119_file('11900000-0000-0000-0000-000000000501', 'aaaa1190-0000-0000-0000-00000000000a', 'links.mov', '11900000-0000-0000-0000-0000000000f4');
UPDATE public.files SET task_id = '11900000-0000-0000-0000-0000000000a3', phase_id = '11900000-0000-0000-0000-0000000000a1' WHERE id = '11900000-0000-0000-0000-000000000501';
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'm9', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000501'::uuid], 'aaaa1190-0000-0000-0000-00000000000b');
RESET ROLE;
SELECT public.t119_a();
DELETE FROM public.tasks WHERE id = '11900000-0000-0000-0000-0000000000a3';
DELETE FROM public.folders WHERE id = '11900000-0000-0000-0000-0000000000f4';
-- A link it made at the destination since.
INSERT INTO public.assets (id, project_id, workspace_id, name) VALUES ('11900000-0000-0000-0000-0000000000a8', 'aaaa1190-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Asset there');
UPDATE public.files SET asset_id = '11900000-0000-0000-0000-0000000000a8' WHERE id = '11900000-0000-0000-0000-000000000501';
SET LOCAL ROLE authenticated;
SELECT public.t119_c();
INSERT INTO t119_ret SELECT 'u9', public.moth_undo_move(public.t119_move_id('m9'));
SELECT is((public.t119_v('u9') ->> 'links_cleared')::int, 1, 'an undo counts the link it clears at the destination');
SELECT is((public.t119_v('u9') ->> 'links_not_restored')::int, 1, 'and says how many of the old ones it could not bring back');
RESET ROLE;
SELECT is((SELECT row(folder_id, task_id, phase_id)::text FROM public.files WHERE id = '11900000-0000-0000-0000-000000000501'),
  '(,,11900000-0000-0000-0000-0000000000a1)', 'a folder and a task deleted since stay gone, and the phase comes back');

-- The caller has lost a project since: no word on where the file is.
SELECT public.t119_file('11900000-0000-0000-0000-000000000502', 'aaaa1190-0000-0000-0000-00000000000e', 'lost.mov');
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'm10', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000502'::uuid], 'aaaa1190-0000-0000-0000-00000000000b');
RESET ROLE;
SELECT public.t119_a();
UPDATE public.projects SET deleted_at = now() WHERE id = 'aaaa1190-0000-0000-0000-00000000000e';
SET LOCAL ROLE authenticated;
SELECT public.t119_c();
SELECT throws_ok($$ SELECT public.moth_undo_move(public.t119_move_id('m10')) $$, 'P0001', 'moth_move:not_found', 'a project gone since reads as not there');
RESET ROLE;


-- ── K. More than one file, and what an undo asks ────────────────────────────
SELECT public.t119_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1190-0000-0000-0000-00000000000f', '11111111-1111-1111-1111-111111111111', 'Third', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1190-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'Soon gone', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1190-0000-0000-0000-000000000021', '11111111-1111-1111-1111-111111111111', 'Staffed without C', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL);
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1190-0000-0000-0000-00000000000f', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1190-0000-0000-0000-00000000000f', 'abababab-abab-abab-abab-abababababab', '11111111-1111-1111-1111-111111111111', 'manager'),
  ('aaaa1190-0000-0000-0000-000000000010', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1190-0000-0000-0000-000000000021', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT DO NOTHING;
SELECT public.t119_file('11900000-0000-0000-0000-000000000801', 'aaaa1190-0000-0000-0000-00000000000a', 'many-a.mov', '11900000-0000-0000-0000-0000000000f2');
SELECT public.t119_file('11900000-0000-0000-0000-000000000802', 'aaaa1190-0000-0000-0000-00000000000b', 'many-b.mov');
UPDATE public.files SET phase_id = '11900000-0000-0000-0000-0000000000a1' WHERE id = '11900000-0000-0000-0000-000000000801';
SET LOCAL ROLE authenticated;
SELECT public.t119_c();
INSERT INTO t119_ret SELECT 'mm', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000801'::uuid, '11900000-0000-0000-0000-000000000802'::uuid, '11900000-0000-0000-0000-000000000801'::uuid], 'aaaa1190-0000-0000-0000-00000000000f');
SELECT is((public.t119_v('mm') ->> 'moved')::int, 2, 'two files from two projects, a repeated id moving once');
SELECT is((public.t119_v('mm') ->> 'links_cleared')::int, 1, 'the links counted across the batch');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.files WHERE id IN ('11900000-0000-0000-0000-000000000801', '11900000-0000-0000-0000-000000000802') AND project_id = 'aaaa1190-0000-0000-0000-00000000000f'), 2, 'both rows moved');
SELECT is((SELECT jsonb_array_length(items) FROM public.file_moves WHERE id = public.t119_move_id('mm')), 2, 'under one journal row holding both');
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'um', public.moth_undo_move(public.t119_move_id('mm'));
SELECT is((public.t119_v('um') ->> 'moved')::int, 2, 'the undo moves both');
RESET ROLE;
SELECT is((SELECT row(project_id, folder_id, phase_id)::text FROM public.files WHERE id = '11900000-0000-0000-0000-000000000801'), '(aaaa1190-0000-0000-0000-00000000000a,11900000-0000-0000-0000-0000000000f2,11900000-0000-0000-0000-0000000000a1)', 'each back where it was');
SELECT is((SELECT project_id FROM public.files WHERE id = '11900000-0000-0000-0000-000000000802'), 'aaaa1190-0000-0000-0000-00000000000b'::uuid, 'from its own project');

-- The gate comes before the positions: each file has moved on as well, so a position test run
-- first would say changed_since, and so say where the file is.
SELECT public.t119_file('11900000-0000-0000-0000-000000000811', 'aaaa1190-0000-0000-0000-000000000010', 'gate-project.mov');
SELECT public.t119_file('11900000-0000-0000-0000-000000000812', 'aaaa1190-0000-0000-0000-00000000000a', 'gate-file.mov');
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'mg1', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000811'::uuid], 'aaaa1190-0000-0000-0000-00000000000b');
INSERT INTO t119_ret SELECT 'mg2', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000812'::uuid], 'aaaa1190-0000-0000-0000-00000000000b');
SELECT lives_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000811'::uuid, '11900000-0000-0000-0000-000000000812'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', '11900000-0000-0000-0000-0000000000f9') $$, 'both refiled since');
RESET ROLE;
SELECT public.t119_a();
UPDATE public.projects SET deleted_at = now() WHERE id = 'aaaa1190-0000-0000-0000-000000000010';
UPDATE public.files SET is_financial = true WHERE id = '11900000-0000-0000-0000-000000000812';
SET LOCAL ROLE authenticated;
SELECT public.t119_c();
SELECT throws_ok($$ SELECT public.moth_undo_move(public.t119_move_id('mg1')) $$, 'P0001', 'moth_move:not_found', 'a project gone since reads as not there, not as changed');
SELECT throws_ok($$ SELECT public.moth_undo_move(public.t119_move_id('mg2')) $$, 'P0001', 'moth_move:not_found', 'and a file that is an invoice since');
RESET ROLE;

-- Each way a file can have changed since.
SELECT public.t119_file('11900000-0000-0000-0000-000000000821', 'aaaa1190-0000-0000-0000-00000000000a', 'arm-project.mov');
SELECT public.t119_file('11900000-0000-0000-0000-000000000822', 'aaaa1190-0000-0000-0000-00000000000a', 'arm-path.mov');
SELECT public.t119_file('11900000-0000-0000-0000-000000000823', 'aaaa1190-0000-0000-0000-00000000000a', 'arm-provider.mov');
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'ma1', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000821'::uuid], 'aaaa1190-0000-0000-0000-00000000000b');
INSERT INTO t119_ret SELECT 'ma2', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000822'::uuid], 'aaaa1190-0000-0000-0000-00000000000b');
INSERT INTO t119_ret SELECT 'ma3', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000823'::uuid], 'aaaa1190-0000-0000-0000-00000000000b');
SELECT lives_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000821'::uuid], 'aaaa1190-0000-0000-0000-00000000000f') $$, 'moved on to a third project, no folder at either end');
RESET ROLE;
UPDATE public.files SET storage_path = storage_path || '.kept' WHERE id = '11900000-0000-0000-0000-000000000822';
UPDATE public.files SET storage_provider = 'local_server' WHERE id = '11900000-0000-0000-0000-000000000823';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.moth_undo_move(public.t119_move_id('ma1')) $$, 'P0001', 'moth_move:changed_since', 'another project since');
SELECT throws_ok($$ SELECT public.moth_undo_move(public.t119_move_id('ma2')) $$, 'P0001', 'moth_move:changed_since', 'another key since');
SELECT throws_ok($$ SELECT public.moth_undo_move(public.t119_move_id('ma3')) $$, 'P0001', 'moth_move:changed_since', 'another provider since');
RESET ROLE;

-- A picture, by association.
SELECT public.t119_file('11900000-0000-0000-0000-000000000831', 'aaaa1190-0000-0000-0000-00000000000a', 'pic-legacy.mov');
UPDATE public.files SET thumbnail_url = 'projects/aaaa1190-0000-0000-0000-00000000000a/thumbs/legacy.jpg' WHERE id = '11900000-0000-0000-0000-000000000831';
SELECT public.t119_file('11900000-0000-0000-0000-000000000832', 'aaaa1190-0000-0000-0000-00000000000a', 'pic-blank.mov');
UPDATE public.files SET thumbnail_url = ' ' WHERE id = '11900000-0000-0000-0000-000000000832';
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'mp', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000831'::uuid, '11900000-0000-0000-0000-000000000832'::uuid], 'aaaa1190-0000-0000-0000-00000000000b');
RESET ROLE;
SELECT is((SELECT thumbnail_url FROM public.files WHERE id = '11900000-0000-0000-0000-000000000831'), NULL::text, 'a legacy picture does not follow the file');
SELECT is((SELECT array_agg(kind || ':' || bucket_id) FROM public.storage_gc_queue WHERE file_id = '11900000-0000-0000-0000-000000000831' AND reason = 'file-purged' AND status = 'pending'), ARRAY['thumbnail:rabbit-thumbnails'], 'it is queued');
SELECT is((SELECT thumbnail_url FROM public.files WHERE id = '11900000-0000-0000-0000-000000000832'), NULL::text, 'a blank one is cleared');
SELECT is((SELECT count(*)::int FROM public.storage_gc_queue WHERE file_id = '11900000-0000-0000-0000-000000000832'), 0, 'and queues nothing');
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'up', public.moth_undo_move(public.t119_move_id('mp'));
SELECT is((public.t119_v('up') ->> 'pictures_not_restored')::int, 1, 'an undo says it could not bring the picture back');
RESET ROLE;

-- Within a project the flag stays, both ways.
SELECT public.t119_file('11900000-0000-0000-0000-000000000841', 'aaaa1190-0000-0000-0000-00000000000a', 'core.mov');
UPDATE public.files SET is_core_definer = true WHERE id = '11900000-0000-0000-0000-000000000841';
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'mcw', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000841'::uuid], 'aaaa1190-0000-0000-0000-00000000000a', '11900000-0000-0000-0000-0000000000f2');
RESET ROLE;
SELECT is((SELECT is_core_definer FROM public.files WHERE id = '11900000-0000-0000-0000-000000000841'), true, 'refiling a core file keeps its flag');
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'ucw', public.moth_undo_move(public.t119_move_id('mcw'));
RESET ROLE;
SELECT is((SELECT row(folder_id, is_core_definer)::text FROM public.files WHERE id = '11900000-0000-0000-0000-000000000841'), '(,t)', 'and so does its undo');

-- The other seats.
SELECT public.t119_file('11900000-0000-0000-0000-000000000851', 'aaaa1190-0000-0000-0000-00000000000f', 'seat-manager.mov');
SELECT public.t119_file('11900000-0000-0000-0000-000000000852', 'aaaa1190-0000-0000-0000-000000000021', 'seat-off.mov');
SELECT public.t119_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222');
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1190-0000-0000-0000-000000000022', '22222222-2222-2222-2222-222222222222', 'Theirs', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false, NULL);
SET LOCAL ROLE authenticated;
SELECT public.t119_d();
SELECT is(public.t119_m(ARRAY['11900000-0000-0000-0000-000000000102'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, true) -> 'items' -> 0 ->> 'how', 'metadata', 'a workspace manager may move a file');
SELECT public.t119_v();
SELECT is(public.t119_m(ARRAY['11900000-0000-0000-0000-000000000851'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, true) -> 'items' -> 0 ->> 'how', 'metadata', 'and a manager of its project');
SELECT public.t119_c();
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000852'::uuid], 'aaaa1190-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:not_allowed_source', 'and a member off a staffed project may not');
SELECT public.t119_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000102'::uuid], 'aaaa1190-0000-0000-0000-000000000022') $$, 'P0001', 'moth_move:not_found', 'another company''s admin, to a project of its own');
RESET ROLE;

-- A company on its own bucket: nothing can look for an object there, so nothing is taken on trust.
SELECT public.t119_a();
SELECT public.t119_file('11900000-0000-0000-0000-000000000871', 'aaaa1190-0000-0000-0000-00000000000c', 'in-bucket.mov');
SELECT public.t119_local('11900000-0000-0000-0000-000000000872', 'aaaa1190-0000-0000-0000-00000000000a', 'bucket-local.mov');
SELECT public.t119_file('11900000-0000-0000-0000-000000000873', 'aaaa1190-0000-0000-0000-00000000000a', 'bucket-assoc.mov');
INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3', '{"region":"r","bucket":"b","accessKeyId":"A"}'::jsonb);
SET LOCAL ROLE authenticated;
SELECT public.t119_e();
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000871'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, true) $$, 'P0001', 'moth_move:s3_moves_off', 'a re-home into the bucket is not planned');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000871'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, false, jsonb_build_array(jsonb_build_object('file_id', '11900000-0000-0000-0000-000000000871', 'path', 'projects/aaaa1190-0000-0000-0000-00000000000b/files/11900000-0000-0000-0000-000000000871/1700000000000-in-bucket.mov'))) $$, 'P0001', 'moth_move:s3_moves_off', 'nor taken on the caller''s word');
SELECT public.t119_c();
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000872'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, true) $$, 'P0001', 'moth_move:s3_moves_off', 'nor a copy up');
SELECT is(public.t119_m(ARRAY['11900000-0000-0000-0000-000000000873'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, true) -> 'items' -> 0 ->> 'how', 'metadata', 'CONTROL: a move by association needs no new copy, in any company');
RESET ROLE;
SELECT is((SELECT row(project_id, storage_provider)::text FROM public.files WHERE id = '11900000-0000-0000-0000-000000000871'), '(aaaa1190-0000-0000-0000-00000000000c,supabase)', 'and the file stays as it was');
SELECT is((SELECT count(*)::int FROM public.storage_gc_queue WHERE file_id = '11900000-0000-0000-0000-000000000871'), 0, 'its only body not queued');
-- Back on Petal with a bucket remembered: Petal's storage, where the object can be looked for.
UPDATE public.workspace_storage SET mode = 'central' WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL ROLE authenticated;
SELECT public.t119_e();
SELECT is(public.t119_m(ARRAY['11900000-0000-0000-0000-000000000871'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, true) -> 'items' -> 0 ->> 'to_provider', 'supabase', 'a company back on Petal re-homes to Petal');
RESET ROLE;
DELETE FROM public.workspace_storage WHERE workspace_id = '11111111-1111-1111-1111-111111111111';


-- ── J. The office server ────────────────────────────────────────────────────
CREATE FUNCTION public.t119_root() RETURNS text LANGUAGE sql IMMUTABLE AS $f$ SELECT replace('//nas/share/wilson', '/', chr(92)) $f$;
INSERT INTO public.workspace_storage (workspace_id, mode, provider, root_path, root_kind)
VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 'network', public.t119_root(), 'unc');
SELECT public.t119_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, folder_root) VALUES
  ('aaaa1190-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'Salt Share', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, public.t119_root() || chr(92) || 'Salt-Hours'),
  ('aaaa1190-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'Moon Share', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, public.t119_root() || chr(92) || 'Moon-Film'),
  ('aaaa1190-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'No Folder', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL);
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1190-0000-0000-0000-000000000011', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1190-0000-0000-0000-000000000012', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1190-0000-0000-0000-000000000013', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT DO NOTHING;
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('11900000-0000-0000-0000-0000000000d0', 'aaaa1190-0000-0000-0000-000000000011', NULL, 'root', 'salt', ''),
  ('11900000-0000-0000-0000-0000000000d1', 'aaaa1190-0000-0000-0000-000000000011', '11900000-0000-0000-0000-0000000000d0', 'category', 'ops', 'ops'),
  ('11900000-0000-0000-0000-0000000000d2', 'aaaa1190-0000-0000-0000-000000000012', NULL, 'root', 'moon', ''),
  ('11900000-0000-0000-0000-0000000000d3', 'aaaa1190-0000-0000-0000-000000000012', '11900000-0000-0000-0000-0000000000d2', 'category', 'in', 'in');
INSERT INTO public.tasks (id, project_id, workspace_id, title) VALUES ('11900000-0000-0000-0000-0000000000d4', 'aaaa1190-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'Share task');

SELECT public.t119_share('11900000-0000-0000-0000-000000000601', 'aaaa1190-0000-0000-0000-000000000011', 'Salt-Hours/ops/deep/m.mov');
SELECT public.t119_share('11900000-0000-0000-0000-000000000602', 'aaaa1190-0000-0000-0000-000000000011', 'Salt-Hours/a/same.mov');
SELECT public.t119_share('11900000-0000-0000-0000-000000000603', 'aaaa1190-0000-0000-0000-000000000011', 'Salt-Hours/b/same.mov');
SELECT public.t119_share('11900000-0000-0000-0000-000000000604', 'aaaa1190-0000-0000-0000-000000000011', 'Salt-Hours/there.mov');
SELECT public.t119_share('11900000-0000-0000-0000-000000000605', 'aaaa1190-0000-0000-0000-000000000012', 'Moon-Film/there.mov');
SELECT public.t119_share('11900000-0000-0000-0000-000000000606', 'aaaa1190-0000-0000-0000-000000000011', 'Salt-Hours/ops/back.mov');
UPDATE public.files SET folder_id = '11900000-0000-0000-0000-0000000000d1', task_id = '11900000-0000-0000-0000-0000000000d4', is_core_definer = true WHERE id = '11900000-0000-0000-0000-000000000606';

SET LOCAL ROLE authenticated;
SELECT public.t119_c();
INSERT INTO t119_ret SELECT 'sp', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000601'::uuid], 'aaaa1190-0000-0000-0000-000000000012', NULL, true);
SELECT is(public.t119_v('sp') -> 'items' -> 0 ->> 'how', 'share_move', 'the plan says the real file moves');
SELECT is(public.t119_v('sp') -> 'items' -> 0 ->> 'to_path', 'nas:Moon-Film/m.mov', 'where to');
SELECT is(public.t119_v('sp') -> 'items' -> 0 ->> 'from', 'Salt-Hours/ops/deep/m.mov', 'and from where');
SELECT is(public.t119_v('sp') -> 'items' -> 0 ->> 'to_provider', 'network_share', 'and it stays on the server');
SELECT is(public.t119_m(ARRAY['11900000-0000-0000-0000-000000000601'::uuid], 'aaaa1190-0000-0000-0000-000000000012', '11900000-0000-0000-0000-0000000000d3', true) -> 'items' -> 0 ->> 'to_path', 'nas:Moon-Film/in/m.mov', 'and a folder''s path is part of it');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.network_share_ops WHERE file_id = '11900000-0000-0000-0000-000000000601'), 0, 'the plan journals nothing');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000604'::uuid], 'aaaa1190-0000-0000-0000-000000000012') $$, 'P0001', 'moth_move:name_taken', 'a name a row holds there');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000602'::uuid, '11900000-0000-0000-0000-000000000603'::uuid], 'aaaa1190-0000-0000-0000-000000000012') $$, 'P0001', 'moth_move:name_taken', 'two of a batch with one name');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000602'::uuid, '11900000-0000-0000-0000-000000000603'::uuid], 'aaaa1190-0000-0000-0000-000000000012', NULL, true) $$, 'P0001', 'moth_move:name_taken', 'and the plan says so too');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000601'::uuid], 'aaaa1190-0000-0000-0000-000000000013') $$, 'P0001', 'moth_move:no_folder', 'a destination with no folder');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000601'::uuid], 'aaaa1190-0000-0000-0000-000000000012', NULL, false, jsonb_build_array(jsonb_build_object('file_id', '11900000-0000-0000-0000-000000000601', 'path', 'nas:Moon-Film/other.mov'))) $$, 'P0001', 'moth_move:plan_changed', 'a place that is not the one the server names');

INSERT INTO t119_ret SELECT 'sm', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000601'::uuid], 'aaaa1190-0000-0000-0000-000000000012', NULL, false, jsonb_build_array(jsonb_build_object('file_id', '11900000-0000-0000-0000-000000000601', 'path', 'nas:Moon-Film/m.mov')));
SELECT is(public.t119_v('sm') -> 'ops' -> 0 ->> 'to', 'Moon-Film/m.mov', 'the commit hands the desktop its rename');
SELECT is(public.t119_v('sm') -> 'ops' -> 0 ->> 'from', 'Salt-Hours/ops/deep/m.mov', 'from where the file is');
RESET ROLE;
SELECT is((SELECT row(project_id, storage_path)::text FROM public.files WHERE id = '11900000-0000-0000-0000-000000000601'), '(aaaa1190-0000-0000-0000-000000000012,nas:Moon-Film/m.mov)', 'the row goes first');
SELECT is((SELECT row(state, op, project_id, dest_project_id)::text FROM public.network_share_ops WHERE id = public.t119_op('sm')), '(pending,move,aaaa1190-0000-0000-0000-000000000011,aaaa1190-0000-0000-0000-000000000012)', 'with one pending operation');
SELECT is((SELECT origin ->> 'from_path' FROM public.network_share_ops WHERE id = public.t119_op('sm')), 'nas:Salt-Hours/ops/deep/m.mov', 'that remembers where it came from');
SELECT is((SELECT origin ->> 'move_id' FROM public.network_share_ops WHERE id = public.t119_op('sm')), public.t119_v('sm') ->> 'move_id', 'and which move it was');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000601'::uuid], 'aaaa1190-0000-0000-0000-000000000011') $$, 'P0001', 'moth_move:pending', 'it cannot move again while the desktop is moving it');
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000601'::uuid], 'aaaa1190-0000-0000-0000-000000000012', '11900000-0000-0000-0000-0000000000d3') $$, 'P0001', 'moth_move:pending', 'nor change folder');
SELECT throws_ok($$ SELECT public.moth_undo_move(public.t119_move_id('sm')) $$, 'P0001', 'moth_move:pending', 'nor be undone');
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[public.t119_op('sm')], 'done') $$, 'the desktop renamed it');
-- Back to the exact place, deep as it was, which no folder row names.
SELECT is(public.moth_undo_move(public.t119_move_id('sm'), true) -> 'items' -> 0 ->> 'to_path', 'nas:Salt-Hours/ops/deep/m.mov', 'an office-server undo can be planned');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.network_share_ops WHERE file_id = '11900000-0000-0000-0000-000000000601' AND state = 'pending'), 0, 'and the plan journals nothing');
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'su', public.moth_undo_move(public.t119_move_id('sm'));
SELECT is(public.t119_v('su') -> 'ops' -> 0 ->> 'to', 'Salt-Hours/ops/deep/m.mov', 'an undo sends it to the exact place it left');
RESET ROLE;
SELECT is((SELECT row(project_id, storage_path)::text FROM public.files WHERE id = '11900000-0000-0000-0000-000000000601'), '(aaaa1190-0000-0000-0000-000000000011,nas:Salt-Hours/ops/deep/m.mov)', 'and the row goes first again');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[public.t119_op('su')], 'done') $$, 'the desktop renamed it back');
-- The exact place taken since.
INSERT INTO t119_ret SELECT 'sr', public.moth_undo_move(public.t119_move_id('su'));
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[public.t119_op('sr')], 'done') $$, 'redo settles too');
RESET ROLE;
SELECT public.t119_share('11900000-0000-0000-0000-000000000607', 'aaaa1190-0000-0000-0000-000000000011', 'Salt-Hours/ops/deep/m.mov');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.moth_undo_move(public.t119_move_id('sr')) $$, 'P0001', 'moth_move:name_taken', 'an undo onto a name taken since');

-- The rename failed: the row goes back as it was.
INSERT INTO t119_ret SELECT 'sn', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000606'::uuid], 'aaaa1190-0000-0000-0000-000000000012', '11900000-0000-0000-0000-0000000000d3');
RESET ROLE;
SELECT is((SELECT row(storage_path, folder_id, task_id, is_core_definer)::text FROM public.files WHERE id = '11900000-0000-0000-0000-000000000606'),
  '(nas:Moon-Film/in/back.mov,11900000-0000-0000-0000-0000000000d3,,f)', 'the move cleared the row''s links');
-- Its old name taken in the window, as only a row already there can: the person is told.
SELECT public.t119_share('11900000-0000-0000-0000-000000000608', 'aaaa1190-0000-0000-0000-000000000011', 'Salt-Hours/ops/BACK.mov');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.network_share_settle(ARRAY[public.t119_op('sn')], 'not_moved') $$, 'P0001', 'network_share: occupied', 'a way back onto a name taken says so, whatever its case');
RESET ROLE;
DELETE FROM public.files WHERE id = '11900000-0000-0000-0000-000000000608';
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[public.t119_op('sn')], 'not_moved') $$, 'with the name free it settles');
SELECT is(current_setting('wilson.file_move', true), '', 'and the marker is empty');
RESET ROLE;
SELECT is((SELECT row(project_id, storage_path, folder_id, task_id, is_core_definer)::text FROM public.files WHERE id = '11900000-0000-0000-0000-000000000606'),
  '(aaaa1190-0000-0000-0000-000000000011,nas:Salt-Hours/ops/back.mov,11900000-0000-0000-0000-0000000000d1,11900000-0000-0000-0000-0000000000d4,t)', 'the row is back: project, place, folder, link and flag');
SELECT is((SELECT state FROM public.network_share_ops WHERE id = public.t119_op('sn')), 'reverted', 'the operation is closed');
SELECT is((SELECT undo_of FROM public.file_moves WHERE undo_of = public.t119_move_id('sn')), public.t119_move_id('sn'), 'and the way back has a journal row of its own');
SELECT is((SELECT count(*)::int FROM public.file_events WHERE file_id = '11900000-0000-0000-0000-000000000606' AND event = 'moved_in' AND project_id = 'aaaa1190-0000-0000-0000-000000000011'), 1, 'and the old project hears it came back');

-- A way back with the journal row purged by then: the operation holds all it needs.
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'sq', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000606'::uuid], 'aaaa1190-0000-0000-0000-000000000012');
RESET ROLE;
DELETE FROM public.file_moves WHERE id = public.t119_move_id('sq');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[public.t119_op('sq')], 'not_moved') $$, 'a way back outlives its journal row');
RESET ROLE;
SELECT is((SELECT storage_path FROM public.files WHERE id = '11900000-0000-0000-0000-000000000606'), 'nas:Salt-Hours/ops/back.mov', 'and it lands');
-- A row that is not where its operation put it is not moved again.
SELECT public.t119_share('11900000-0000-0000-0000-000000000609', 'aaaa1190-0000-0000-0000-000000000011', 'Salt-Hours/drift.mov');
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'sd', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000609'::uuid], 'aaaa1190-0000-0000-0000-000000000012');
RESET ROLE;
UPDATE public.files SET storage_path = 'nas:Moon-Film/drifted.mov' WHERE id = '11900000-0000-0000-0000-000000000609';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.network_share_settle(ARRAY[public.t119_op('sd')], 'not_moved') $$, 'P0001', 'network_share: changed_since', 'a row moved some other way stays put');
RESET ROLE;

-- Within a project on the server: only the folder, and the desktop has nothing to do.
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'sw', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000604'::uuid], 'aaaa1190-0000-0000-0000-000000000011', '11900000-0000-0000-0000-0000000000d1');
SELECT is(public.t119_v('sw') -> 'ops', '[]'::jsonb, 'a folder change on the server has no operation');
RESET ROLE;
SELECT is((SELECT row(folder_id, storage_path)::text FROM public.files WHERE id = '11900000-0000-0000-0000-000000000604'), '(11900000-0000-0000-0000-0000000000d1,nas:Salt-Hours/there.mov)', 'and the locator stays');

-- A body on one computer, in a company on an office server: adopted, server first.
SELECT public.t119_local('11900000-0000-0000-0000-000000000701', 'aaaa1190-0000-0000-0000-000000000011', 'clip.mov');
UPDATE public.files SET thumbnail_url = storage_path || '.jpg', task_id = '11900000-0000-0000-0000-0000000000d4' WHERE id = '11900000-0000-0000-0000-000000000701';
SELECT public.t119_local('11900000-0000-0000-0000-000000000702', 'aaaa1190-0000-0000-0000-000000000011', 'kept.mov');
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'ap', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000701'::uuid], 'aaaa1190-0000-0000-0000-000000000012', NULL, true);
SELECT is((public.t119_v('ap') -> 'items' -> 0 ->> 'how') || ' ' || (public.t119_v('ap') -> 'items' -> 0 ->> 'to_provider') || ' ' || (public.t119_v('ap') -> 'items' -> 0 ->> 'to_path'), 'copy_up network_share nas:Moon-Film/clip.mov', 'the plan names its place on the server');
INSERT INTO t119_ret SELECT 'am', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000701'::uuid], 'aaaa1190-0000-0000-0000-000000000012');
SELECT is(public.t119_v('am') -> 'ops' -> 0 ->> 'to', 'Moon-Film/clip.mov', 'the commit takes no copy: the desktop copies after');
RESET ROLE;
SELECT is((SELECT row(storage_provider, storage_path, thumbnail_url IS NULL, project_id)::text FROM public.files WHERE id = '11900000-0000-0000-0000-000000000701'), '(network_share,nas:Moon-Film/clip.mov,t,aaaa1190-0000-0000-0000-000000000012)', 'the row is on the server, with no picture');
SELECT is((SELECT row(op, state, from_locator IS NULL)::text FROM public.network_share_ops WHERE id = public.t119_op('am')), '(adopt,pending,t)', 'one pending adopt');
SELECT is((SELECT count(*)::int FROM public.storage_gc_queue WHERE file_id = '11900000-0000-0000-0000-000000000701'), 0, 'and nothing queued, because the copy may yet fail');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[public.t119_op('am')], 'not_moved') $$, 'the copy failed');
RESET ROLE;
SELECT is((SELECT row(storage_provider, storage_path = 'projects/aaaa1190-0000-0000-0000-000000000011/files/11900000-0000-0000-0000-000000000701/clip.mov', thumbnail_url IS NOT NULL, project_id, task_id)::text FROM public.files WHERE id = '11900000-0000-0000-0000-000000000701'),
  '(local_server,t,t,aaaa1190-0000-0000-0000-000000000011,11900000-0000-0000-0000-0000000000d4)', 'the row is back on its computer, picture and link with it');
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'ak', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000702'::uuid], 'aaaa1190-0000-0000-0000-000000000012');
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[public.t119_op('ak')], 'done', jsonb_build_object(public.t119_op('ak')::text, jsonb_build_object('s', '12'))) $$, 'the copy worked');
-- Its undo stays on the server: the row does not go back down to the computer.
INSERT INTO t119_ret SELECT 'aku', public.moth_undo_move(public.t119_move_id('ak'));
SELECT is(public.t119_v('aku') -> 'ops' -> 0 ->> 'to', 'Salt-Hours/kept.mov', 'an adopted file goes back as a move on the server');
RESET ROLE;
SELECT is((SELECT row(storage_provider, storage_path, project_id)::text FROM public.files WHERE id = '11900000-0000-0000-0000-000000000702'), '(network_share,nas:Salt-Hours/kept.mov,aaaa1190-0000-0000-0000-000000000011)', 'and the row stays network_share');

-- A key naming a private project, in such a company, waits for the desktop.
SELECT public.t119_file('11900000-0000-0000-0000-000000000703', 'aaaa1190-0000-0000-0000-00000000000c', 'quiet.mov');
SET LOCAL ROLE authenticated;
SELECT public.t119_e();
SELECT throws_ok($$ SELECT public.t119_m(ARRAY['11900000-0000-0000-0000-000000000703'::uuid], 'aaaa1190-0000-0000-0000-00000000000b', NULL, true) $$, 'P0001', 'moth_move:copy_refused', 'a re-home has nowhere to go on an office server');
RESET ROLE;

-- Two operations settled together, both going back.
SELECT public.t119_share('11900000-0000-0000-0000-0000000006a1', 'aaaa1190-0000-0000-0000-000000000011', 'Salt-Hours/pair-1.mov');
SELECT public.t119_share('11900000-0000-0000-0000-0000000006a2', 'aaaa1190-0000-0000-0000-000000000011', 'Salt-Hours/pair-2.mov');
SET LOCAL ROLE authenticated;
SELECT public.t119_c();
INSERT INTO t119_ret SELECT 'p2', public.t119_m(ARRAY['11900000-0000-0000-0000-0000000006a1'::uuid, '11900000-0000-0000-0000-0000000006a2'::uuid], 'aaaa1190-0000-0000-0000-000000000012');
SELECT is(jsonb_array_length(public.t119_v('p2') -> 'ops'), 2, 'two files, two renames for the desktop');
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[(public.t119_v('p2') -> 'ops' -> 0 ->> 'op_id')::uuid, (public.t119_v('p2') -> 'ops' -> 1 ->> 'op_id')::uuid], 'not_moved') $$, 'neither happened');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.files WHERE id IN ('11900000-0000-0000-0000-0000000006a1', '11900000-0000-0000-0000-0000000006a2') AND project_id = 'aaaa1190-0000-0000-0000-000000000011' AND storage_path LIKE 'nas:Salt-Hours/pair-%'), 2, 'and both rows are back');

-- An undo the desktop could not make can be tried again.
SELECT public.t119_share('11900000-0000-0000-0000-0000000006b1', 'aaaa1190-0000-0000-0000-000000000011', 'Salt-Hours/retry.mov');
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'rt', public.t119_m(ARRAY['11900000-0000-0000-0000-0000000006b1'::uuid], 'aaaa1190-0000-0000-0000-000000000012');
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[public.t119_op('rt')], 'done') $$, 'the move happened');
INSERT INTO t119_ret SELECT 'rtu', public.moth_undo_move(public.t119_move_id('rt'));
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[public.t119_op('rtu')], 'not_moved') $$, 'and its undo could not');
RESET ROLE;
SELECT is((SELECT undone_at FROM public.file_moves WHERE id = public.t119_move_id('rt')), NULL::timestamptz, 'so the move does not read as undone');
SELECT is((SELECT row(project_id, storage_path)::text FROM public.files WHERE id = '11900000-0000-0000-0000-0000000006b1'), '(aaaa1190-0000-0000-0000-000000000012,nas:Moon-Film/retry.mov)', 'and the row is where the file is');
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'rtv', public.moth_undo_move(public.t119_move_id('rt'));
SELECT is(public.t119_v('rtv') -> 'ops' -> 0 ->> 'to', 'Salt-Hours/retry.mov', 'it can be tried again');
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[public.t119_op('rtv')], 'done') $$, 'and this time it works');
RESET ROLE;
SELECT ok((SELECT undone_at IS NOT NULL FROM public.file_moves WHERE id = public.t119_move_id('rt')), 'and the move reads as undone');

-- A batch half of which went back cannot be undone whole.
SELECT public.t119_share('11900000-0000-0000-0000-0000000006c1', 'aaaa1190-0000-0000-0000-000000000011', 'Salt-Hours/half-1.mov');
SELECT public.t119_share('11900000-0000-0000-0000-0000000006c2', 'aaaa1190-0000-0000-0000-000000000011', 'Salt-Hours/half-2.mov');
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'hb', public.t119_m(ARRAY['11900000-0000-0000-0000-0000000006c1'::uuid, '11900000-0000-0000-0000-0000000006c2'::uuid], 'aaaa1190-0000-0000-0000-000000000012');
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[(public.t119_v('hb') -> 'ops' -> 0 ->> 'op_id')::uuid, (public.t119_v('hb') -> 'ops' -> 1 ->> 'op_id')::uuid], 'done') $$, 'both moved');
INSERT INTO t119_ret SELECT 'hbu', public.moth_undo_move(public.t119_move_id('hb'));
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[(public.t119_v('hbu') -> 'ops' -> 0 ->> 'op_id')::uuid], 'done') $$, 'one went back');
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[(public.t119_v('hbu') -> 'ops' -> 1 ->> 'op_id')::uuid], 'not_moved') $$, 'one could not');
SELECT throws_ok($$ SELECT public.moth_undo_move(public.t119_move_id('hb')) $$, 'P0001', 'moth_move:changed_since', 'and the whole cannot be undone: the file that went back is not where the move left it');
RESET ROLE;

-- A way back whose folder and link have gone lands without them.
SELECT public.t119_a();
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES ('11900000-0000-0000-0000-0000000000d5', 'aaaa1190-0000-0000-0000-000000000011', '11900000-0000-0000-0000-0000000000d0', 'category', 'gone', 'gone');
INSERT INTO public.tasks (id, project_id, workspace_id, title) VALUES ('11900000-0000-0000-0000-0000000000d6', 'aaaa1190-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'Going');
SELECT public.t119_share('11900000-0000-0000-0000-0000000006d1', 'aaaa1190-0000-0000-0000-000000000011', 'Salt-Hours/gone/wb.mov');
UPDATE public.files SET folder_id = '11900000-0000-0000-0000-0000000000d5', task_id = '11900000-0000-0000-0000-0000000000d6' WHERE id = '11900000-0000-0000-0000-0000000006d1';
SET LOCAL ROLE authenticated;
SELECT public.t119_c();
INSERT INTO t119_ret SELECT 'wb', public.t119_m(ARRAY['11900000-0000-0000-0000-0000000006d1'::uuid], 'aaaa1190-0000-0000-0000-000000000012');
RESET ROLE;
SELECT public.t119_a();
DELETE FROM public.tasks WHERE id = '11900000-0000-0000-0000-0000000000d6';
DELETE FROM public.folders WHERE id = '11900000-0000-0000-0000-0000000000d5';
SET LOCAL ROLE authenticated;
SELECT public.t119_c();
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[public.t119_op('wb')], 'not_moved') $$, 'a way back with its folder and link gone still settles');
RESET ROLE;
SELECT is((SELECT row(project_id, folder_id, task_id, storage_path)::text FROM public.files WHERE id = '11900000-0000-0000-0000-0000000006d1'), '(aaaa1190-0000-0000-0000-000000000011,,,nas:Salt-Hours/gone/wb.mov)', 'and lands without them');

-- An undo's own refusals on the server.
SELECT public.t119_share('11900000-0000-0000-0000-0000000006e1', 'aaaa1190-0000-0000-0000-000000000011', 'Salt-Hours/refuse.mov');
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'rf', public.t119_m(ARRAY['11900000-0000-0000-0000-0000000006e1'::uuid], 'aaaa1190-0000-0000-0000-000000000012');
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[public.t119_op('rf')], 'done') $$, 'moved and settled');
RESET ROLE;
SELECT public.t119_a();
UPDATE public.projects SET folder_root = public.t119_root() || chr(92) || 'Elsewhere' WHERE id = 'aaaa1190-0000-0000-0000-000000000011';
SET LOCAL ROLE authenticated;
SELECT public.t119_c();
SELECT throws_ok($$ SELECT public.moth_undo_move(public.t119_move_id('rf')) $$, 'P0001', 'moth_move:no_folder', 'the place it left is no longer in its project''s folder');
RESET ROLE;
SELECT public.t119_a();
UPDATE public.projects SET folder_root = public.t119_root() || chr(92) || 'Salt-Hours' WHERE id = 'aaaa1190-0000-0000-0000-000000000011';
UPDATE public.projects SET folder_root = public.t119_root() || chr(92) || 'Elsewhere' WHERE id = 'aaaa1190-0000-0000-0000-000000000012';
SET LOCAL ROLE authenticated;
SELECT public.t119_c();
SELECT throws_ok($$ SELECT public.moth_undo_move(public.t119_move_id('rf')) $$, 'P0001', 'moth_move:no_folder', 'and the file itself no longer in its project''s folder');
RESET ROLE;
SELECT public.t119_a();
UPDATE public.projects SET folder_root = public.t119_root() || chr(92) || 'Moon-Film' WHERE id = 'aaaa1190-0000-0000-0000-000000000012';
UPDATE public.workspace_storage SET mode = 'central' WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL ROLE authenticated;
SELECT public.t119_c();
SELECT throws_ok($$ SELECT public.moth_undo_move(public.t119_move_id('rf')) $$, 'P0001', 'moth_move:drive_changed', 'a company no longer on the server');
RESET ROLE;
UPDATE public.workspace_storage SET mode = 'byos' WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
-- A place an operation is leaving, its row already gone from there.
SELECT public.t119_share('11900000-0000-0000-0000-0000000006f1', 'aaaa1190-0000-0000-0000-000000000011', 'Salt-Hours/held.mov');
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'hd', public.t119_m(ARRAY['11900000-0000-0000-0000-0000000006f1'::uuid], 'aaaa1190-0000-0000-0000-000000000012');
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[public.t119_op('hd')], 'done') $$, 'moved, so the place is free');
RESET ROLE;
SELECT public.t119_share('11900000-0000-0000-0000-0000000006f2', 'aaaa1190-0000-0000-0000-000000000011', 'Salt-Hours/held.mov');
SET LOCAL ROLE authenticated;
INSERT INTO t119_ret SELECT 'hd2', public.t119_m(ARRAY['11900000-0000-0000-0000-0000000006f2'::uuid], 'aaaa1190-0000-0000-0000-000000000012', '11900000-0000-0000-0000-0000000000d3');
SELECT throws_ok($$ SELECT public.moth_undo_move(public.t119_move_id('hd')) $$, 'P0001', 'moth_move:name_taken', 'an undo onto a place another file is still leaving');
RESET ROLE;

-- After 24 hours, whoever could check both folders may call off a move between projects.
SELECT public.t119_share('11900000-0000-0000-0000-0000000006a9', 'aaaa1190-0000-0000-0000-000000000011', 'Salt-Hours/stale.mov');
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1190-0000-0000-0000-000000000011', 'abababab-abab-abab-abab-abababababab', '11111111-1111-1111-1111-111111111111', 'manager') ON CONFLICT DO NOTHING;
SET LOCAL ROLE authenticated;
SELECT public.t119_c();
INSERT INTO t119_ret SELECT 'st', public.t119_m(ARRAY['11900000-0000-0000-0000-0000000006a9'::uuid], 'aaaa1190-0000-0000-0000-000000000012');
SELECT public.t119_a();
SELECT throws_ok($$ SELECT public.network_share_settle(ARRAY[public.t119_op('st')], 'not_moved') $$, '42501', 'network_share: not allowed', 'before 24 hours not even an admin');
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(public.network_share_stale_moves()) e WHERE e ->> 'op_id' = public.t119_op('st')::text), 0, 'and it is not listed yet');
RESET ROLE;
UPDATE public.network_share_ops SET created_at = now() - interval '25 hours' WHERE id = public.t119_op('st');
SET LOCAL ROLE authenticated;
SELECT public.t119_a();
SELECT throws_ok($$ SELECT public.network_share_settle(ARRAY[public.t119_op('st')], 'done') $$, '42501', 'network_share: not allowed', 'only its own computer can say it moved');
SELECT is((SELECT e ->> 'to' FROM jsonb_array_elements(public.network_share_stale_moves()) e WHERE e ->> 'op_id' = public.t119_op('st')::text), 'Moon-Film/stale.mov', 'an admin can find it, and where it was going');
SELECT public.t119_v();
SELECT throws_ok($$ SELECT public.network_share_settle(ARRAY[public.t119_op('st')], 'not_moved') $$, '42501', 'network_share: not allowed', 'a manager of one end cannot call it off');
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(public.network_share_stale_moves()) e WHERE e ->> 'op_id' = public.t119_op('st')::text), 0, 'nor see it');
SELECT public.t119_e();
SELECT throws_ok($$ SELECT public.network_share_settle(ARRAY[public.t119_op('st')], 'not_moved') $$, '42501', 'network_share: not allowed', 'nor someone on neither');
RESET ROLE;
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1190-0000-0000-0000-000000000012', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'manager') ON CONFLICT DO NOTHING;
SET LOCAL ROLE authenticated;
SELECT public.t119_e();
SELECT throws_ok($$ SELECT public.network_share_settle(ARRAY[public.t119_op('st')], 'not_moved') $$, '42501', 'network_share: not allowed', 'nor a manager of the other end alone');
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(public.network_share_stale_moves()) e WHERE e ->> 'op_id' = public.t119_op('st')::text), 0, 'who does not see it either');
SELECT public.t119_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222');
SELECT throws_ok($$ SELECT public.network_share_settle(ARRAY[public.t119_op('st')], 'not_moved') $$, '42501', 'network_share: not allowed', 'nor another company''s admin');
SELECT is(public.network_share_stale_moves(), '[]'::jsonb, 'whose list does not hold it');
SELECT public.t119_a();
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[public.t119_op('st')], 'not_moved') $$, 'an admin calls it off');
RESET ROLE;
SELECT is((SELECT row(project_id, storage_path)::text FROM public.files WHERE id = '11900000-0000-0000-0000-0000000006a9'), '(aaaa1190-0000-0000-0000-000000000011,nas:Salt-Hours/stale.mov)', 'the row is back where the file is');
SELECT is((SELECT state FROM public.network_share_ops WHERE id = public.t119_op('st')), 'reverted', 'the operation is closed');
SET LOCAL ROLE authenticated;
SELECT public.t119_a();
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(public.network_share_stale_moves()) e WHERE e ->> 'op_id' = public.t119_op('st')::text), 0, 'and it is off the list');
RESET ROLE;
SELECT is((SELECT actor_user_id FROM public.file_moves WHERE undo_of = public.t119_move_id('st')), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'and the way back names who called it off');

-- Someone else calling off a stale undo leaves it for its mover to try again.
SELECT public.t119_share('11900000-0000-0000-0000-0000000006a8', 'aaaa1190-0000-0000-0000-000000000011', 'Salt-Hours/stale-undo.mov');
SET LOCAL ROLE authenticated;
SELECT public.t119_c();
INSERT INTO t119_ret SELECT 'su2', public.t119_m(ARRAY['11900000-0000-0000-0000-0000000006a8'::uuid], 'aaaa1190-0000-0000-0000-000000000012');
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[public.t119_op('su2')], 'done') $$, 'it moved');
INSERT INTO t119_ret SELECT 'su3', public.moth_undo_move(public.t119_move_id('su2'));
RESET ROLE;
UPDATE public.network_share_ops SET created_at = now() - interval '25 hours' WHERE id = public.t119_op('su3');
SET LOCAL ROLE authenticated;
SELECT public.t119_a();
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[public.t119_op('su3')], 'not_moved') $$, 'its undo never settled, and an admin calls that off');
RESET ROLE;
SELECT is((SELECT undone_at FROM public.file_moves WHERE id = public.t119_move_id('su2')), NULL::timestamptz, 'the move no longer reads as undone');
SET LOCAL ROLE authenticated;
SELECT public.t119_c();
SELECT is(public.moth_undo_move(public.t119_move_id('su2')) -> 'ops' -> 0 ->> 'to', 'Salt-Hours/stale-undo.mov', 'and its mover can try again');
RESET ROLE;

-- An adopt between projects is called off the same way.
SELECT public.t119_local('11900000-0000-0000-0000-000000000703', 'aaaa1190-0000-0000-0000-000000000011', 'stale-adopt.mov');
SET LOCAL ROLE authenticated;
SELECT public.t119_c();
INSERT INTO t119_ret SELECT 'sa', public.t119_m(ARRAY['11900000-0000-0000-0000-000000000703'::uuid], 'aaaa1190-0000-0000-0000-000000000012');
RESET ROLE;
UPDATE public.network_share_ops SET created_at = now() - interval '25 hours' WHERE id = public.t119_op('sa');
SET LOCAL ROLE authenticated;
SELECT public.t119_a();
SELECT is((SELECT e ->> 'op' FROM jsonb_array_elements(public.network_share_stale_moves()) e WHERE e ->> 'op_id' = public.t119_op('sa')::text), 'adopt', 'a stale adopt is listed');
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[public.t119_op('sa')], 'not_moved') $$, 'and can be called off');
RESET ROLE;
SELECT is((SELECT row(storage_provider, project_id)::text FROM public.files WHERE id = '11900000-0000-0000-0000-000000000703'), '(local_server,aaaa1190-0000-0000-0000-000000000011)', 'the row is back on its computer');

SELECT * FROM finish();
ROLLBACK;
