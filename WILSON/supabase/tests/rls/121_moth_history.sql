-- =============================================================================
-- 121_moth_history.sql — M.O.T.H. Session 1 (MO1), the record of what changed (0119).
--
-- moth_history, its capture on eleven tables, redaction on lock, the two readers and the
-- purge. A person's write never fails for it; what they read is what they could see then
-- and can see now.
--
-- Fixture ids: projects aaaa1210-…, files 12100000-…-…
-- user_a (rls_setup) is the admin; user_c a plain member; user_d a workspace manager; user_e
-- creates the private projects; user_v a reviewer; user_n is not active any more.
-- =============================================================================

BEGIN;

SELECT plan(165);

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

CREATE FUNCTION public.t121_as(p_user uuid, p_role text, p_ws uuid DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_role))::text, true);
END;
$f$;
CREATE FUNCTION public.t121_a() RETURNS void LANGUAGE sql AS $f$ SELECT public.t121_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin') $f$;
CREATE FUNCTION public.t121_c() RETURNS void LANGUAGE sql AS $f$ SELECT public.t121_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user') $f$;
CREATE FUNCTION public.t121_d() RETURNS void LANGUAGE sql AS $f$ SELECT public.t121_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager') $f$;
CREATE FUNCTION public.t121_e() RETURNS void LANGUAGE sql AS $f$ SELECT public.t121_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user') $f$;
CREATE FUNCTION public.t121_v() RETURNS void LANGUAGE sql AS $f$ SELECT public.t121_as('abababab-abab-abab-abab-abababababab', 'user') $f$;

CREATE FUNCTION public.t121_file(p_id uuid, p_project uuid, p_name text, p_folder uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_key text := 'projects/' || p_project || '/files/' || p_id || '/' || p_name;
BEGIN
  INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('rabbit-files', v_key, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, folder_id)
  VALUES (p_id, p_project, p_name, 'supabase', v_key, p_folder);
END;
$f$;
-- Rows as the runner sees them, for what capture wrote.
CREATE FUNCTION public.t121_n(p_type text, p_id uuid, p_action text DEFAULT NULL) RETURNS integer LANGUAGE sql STABLE AS $f$
  SELECT count(*)::int FROM public.moth_history h WHERE h.entity_type = p_type AND h.entity_id = p_id AND (p_action IS NULL OR h.action = p_action);
$f$;
CREATE FUNCTION public.t121_last(p_type text, p_id uuid) RETURNS public.moth_history LANGUAGE sql STABLE AS $f$
  SELECT h FROM public.moth_history h WHERE h.entity_type = p_type AND h.entity_id = p_id ORDER BY h.id DESC LIMIT 1;
$f$;
-- Rows as a person reads them.
CREATE FUNCTION public.t121_read(p_id uuid, p_scope uuid DEFAULT NULL) RETURNS integer LANGUAGE sql AS $f$
  SELECT count(*)::int FROM public.moth_history_read(p_scope) r WHERE r.entity_id = p_id;
$f$;
GRANT EXECUTE ON FUNCTION public.t121_read(uuid, uuid) TO authenticated;

SELECT public.t121_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1210-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Salt Hours', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1210-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Moon Film', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1210-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Quiet X', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true, NULL),
  ('aaaa1210-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'Quiet Y', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true, NULL),
  ('aaaa1210-0000-0000-0000-0000000000c0', '11111111-1111-1111-1111-111111111111', 'Personal space', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true, 'cccccccc-cccc-cccc-cccc-cccccccccccc');
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1210-0000-0000-0000-00000000000a', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1210-0000-0000-0000-00000000000a', 'abababab-abab-abab-abab-abababababab', '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1210-0000-0000-0000-00000000000b', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT DO NOTHING;
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('12100000-0000-0000-0000-0000000000f0', 'aaaa1210-0000-0000-0000-00000000000a', NULL, 'root', 'salt', ''),
  ('12100000-0000-0000-0000-0000000000f1', 'aaaa1210-0000-0000-0000-00000000000a', '12100000-0000-0000-0000-0000000000f0', 'category', 'rushes', 'rushes'),
  ('12100000-0000-0000-0000-0000000000f3', 'aaaa1210-0000-0000-0000-00000000000a', '12100000-0000-0000-0000-0000000000f0', 'category', 'invoices', 'INVOICES');


-- ── A. Who can touch it ─────────────────────────────────────────────────────
SELECT ok((SELECT relrowsecurity AND NOT relforcerowsecurity FROM pg_class WHERE oid = 'public.moth_history'::regclass), 'row security on and not forced, as edit_history is');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'moth_history'), 0, 'no policy');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['anon', 'authenticated']) r
            WHERE has_table_privilege(r, 'public.moth_history', 'SELECT,INSERT,UPDATE,DELETE') OR has_sequence_privilege(r, 'public.moth_history_id_seq', 'USAGE,SELECT,UPDATE')), 0, 'no client holds any privilege on it or its sequence');
SELECT is((SELECT array_agg(x) FROM unnest(ARRAY['public.moth_history_read(uuid,timestamp with time zone,uuid,integer)', 'public.moth_history_window(uuid)', 'public.purge_moth_history(interval)',
    'public.fn_moth_history_capture()', 'public.moth_history_project(text,jsonb)', 'public.moth_history_projection_ok(jsonb)', 'public._moth_history_audience(text,jsonb,uuid)', 'public._moth_history_entity_visible(uuid,text,uuid)']) x
   WHERE has_function_privilege('anon', x::regprocedure, 'EXECUTE')), NULL::text[], 'anon can call none of them');
SELECT is((SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY['public.moth_history_read(uuid,timestamp with time zone,uuid,integer)', 'public.moth_history_window(uuid)', 'public.purge_moth_history(interval)',
    'public.fn_moth_history_capture()', 'public.moth_history_project(text,jsonb)', 'public.moth_history_projection_ok(jsonb)', 'public._moth_history_audience(text,jsonb,uuid)', 'public._moth_history_entity_visible(uuid,text,uuid)']) x
   WHERE has_function_privilege('authenticated', x::regprocedure, 'EXECUTE')), ARRAY['public.moth_history_read(uuid,timestamp with time zone,uuid,integer)', 'public.moth_history_window(uuid)'], 'a client may call the two readers and nothing else');
SELECT is(has_function_privilege('service_role', 'public.purge_moth_history(interval)', 'EXECUTE'), true, 'CONTROL: the purge is service_role''s');
SELECT ok(pg_get_function_result('public.moth_history_read(uuid,timestamp with time zone,uuid,integer)'::regprocedure) !~* 'bigint', 'the reader hands out no bigint');
SELECT is((SELECT count(*)::int FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgfoid = 'public.fn_moth_history_capture()'::regprocedure), 22, 'twenty-two triggers');
SELECT is((SELECT array_agg(DISTINCT c.relname::text ORDER BY c.relname::text) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal AND t.tgfoid = 'public.fn_moth_history_capture()'::regprocedure),
  ARRAY['assets', 'experiences', 'files', 'folders', 'levels', 'phases', 'projects', 'scenes', 'shots', 'task_items', 'tasks'], 'on the eleven tables');
SELECT ok((SELECT pg_get_triggerdef(t.oid) LIKE '%share_missing_since%' AND pg_get_triggerdef(t.oid) LIKE '%is_financial%' AND pg_get_triggerdef(t.oid) LIKE '%storage_path%' FROM pg_trigger t WHERE t.tgname = 'trg_files_moth_history_upd'), 'the files list holds what classification needs');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE prosrc LIKE '%moth_history%' AND proname IN ('fn_realtime_broadcast', 'fn_workspace_realtime_broadcast')), 0, 'it is on no realtime topic');


-- ── B. What a file writes ───────────────────────────────────────────────────
SELECT public.t121_file('12100000-0000-0000-0000-000000000101', 'aaaa1210-0000-0000-0000-00000000000a', 'one.mov');
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000101', 'create'), 1, 'a new file writes one create');
SELECT is((public.t121_last('files', '12100000-0000-0000-0000-000000000101')).state ->> 'name', 'one.mov', 'naming it');
SELECT is((public.t121_last('files', '12100000-0000-0000-0000-000000000101')).state_class, 'shared', 'for everyone in a shared project');
SELECT is((public.t121_last('files', '12100000-0000-0000-0000-000000000101')).prior, NULL::jsonb, 'with nothing before it');
SELECT ok(public.moth_history_projection_ok((public.t121_last('files', '12100000-0000-0000-0000-000000000101')).state), 'its state is within the allowlist');
SELECT is((public.t121_last('files', '12100000-0000-0000-0000-000000000101')).state ? 'storage_path', false, 'and holds no locator');
SELECT is((public.t121_last('files', '12100000-0000-0000-0000-000000000101')).actor_user_id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'and it names who');

UPDATE public.files SET name = 'one-renamed.mov' WHERE id = '12100000-0000-0000-0000-000000000101';
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000101', 'update'), 1, 'a rename writes an update');
SELECT is((public.t121_last('files', '12100000-0000-0000-0000-000000000101')).prior ->> 'name', 'one.mov', 'with the name before');
SELECT is((public.t121_last('files', '12100000-0000-0000-0000-000000000101')).state ->> 'name', 'one-renamed.mov', 'and after');

UPDATE public.files SET description = 'nobody records this' WHERE id = '12100000-0000-0000-0000-000000000101';
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000101'), 2, 'a description writes nothing');
UPDATE public.files SET storage_path = storage_path || '.kept' WHERE id = '12100000-0000-0000-0000-000000000101';
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000101'), 2, 'nor does a new key, which is not structural');

UPDATE public.files SET folder_id = '12100000-0000-0000-0000-0000000000f1' WHERE id = '12100000-0000-0000-0000-000000000101';
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000101', 'move'), 1, 'a folder change is a move');
SELECT is((public.t121_last('files', '12100000-0000-0000-0000-000000000101')).state ->> 'folder_id', '12100000-0000-0000-0000-0000000000f1', 'saying where');

-- Through the moves RPC: one row for the whole change.
SELECT public.t121_file('12100000-0000-0000-0000-000000000102', 'aaaa1210-0000-0000-0000-00000000000a', 'two.mov');
SET LOCAL ROLE authenticated;
SELECT public.t121_c();
SELECT lives_ok($$ SELECT public.moth_move_items(ARRAY['12100000-0000-0000-0000-000000000102'::uuid], 'aaaa1210-0000-0000-0000-00000000000b') $$, 'a move between projects');
RESET ROLE;
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000102', 'move'), 1, 'writes one move');
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000102'), 2, 'and nothing else');
SELECT is((public.t121_last('files', '12100000-0000-0000-0000-000000000102')).prior_project_id, 'aaaa1210-0000-0000-0000-00000000000a'::uuid, 'from');
SELECT is((public.t121_last('files', '12100000-0000-0000-0000-000000000102')).state_project_id, 'aaaa1210-0000-0000-0000-00000000000b'::uuid, 'to');
SELECT is((public.t121_last('files', '12100000-0000-0000-0000-000000000102')).actor_user_id, 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'by the person who moved it');

-- Through the trash paths.
SET LOCAL ROLE authenticated;
SELECT public.t121_a();
SELECT is(public.soft_delete_row('files', '12100000-0000-0000-0000-000000000102'), true, 'trashed');
SELECT is((public.t121_read('12100000-0000-0000-0000-000000000102')), 3, 'an admin still reads a trashed file''s rows');
SELECT is(public.restore_soft_deleted('files', '12100000-0000-0000-0000-000000000102'), true, 'restored');
RESET ROLE;
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000102', 'trash'), 1, 'a trash is recorded, though its projection does not change');
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000102', 'restore'), 1, 'and a restore');

-- A catalogue row, whoever the writer says it is.
SELECT set_config('wilson.network_share_writer', 'check:aaaa1210-0000-0000-0000-00000000000a', true);
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, size_bytes, source_modified_at) VALUES
  ('12100000-0000-0000-0000-000000000103', 'aaaa1210-0000-0000-0000-00000000000a', 'server.mov', 'network_share', 'nas:Salt-Hours/server.mov', 1, '2026-10-01T10:00:00Z');
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000103', 'create'), 1, 'a catalogue insert under the writer''s marker is captured');
SELECT is((public.t121_last('files', '12100000-0000-0000-0000-000000000103')).state -> 'missing', 'false'::jsonb, 'as there');
UPDATE public.files SET share_missing_since = now() WHERE id = '12100000-0000-0000-0000-000000000103';
SELECT is((public.t121_last('files', '12100000-0000-0000-0000-000000000103')).state -> 'missing', 'true'::jsonb, 'and then as missing');
SELECT set_config('wilson.network_share_writer', '', true);


-- ── C. What the other tables write ──────────────────────────────────────────
-- A project's own row says who it is for: a flip is seen from both sides.
SELECT is((public.t121_last('projects', 'aaaa1210-0000-0000-0000-00000000000a')).state ->> 'title', 'Salt Hours', 'a project writes its title');
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private) VALUES
  ('aaaa1210-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'To Flip', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', false);
UPDATE public.projects SET is_private = true WHERE id = 'aaaa1210-0000-0000-0000-000000000011';
SELECT is((public.t121_last('projects', 'aaaa1210-0000-0000-0000-000000000011')).prior_class, 'shared', 'a flip was shared');
SELECT is((public.t121_last('projects', 'aaaa1210-0000-0000-0000-000000000011')).state_class, 'private', 'and is private');
SELECT is((public.t121_last('projects', 'aaaa1210-0000-0000-0000-000000000011')).state_owner_id, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, 'with its creator');
SELECT is((public.t121_last('projects', 'aaaa1210-0000-0000-0000-0000000000c0')).state_class, 'personal', 'a personal space is personal');
SELECT is((public.t121_last('projects', 'aaaa1210-0000-0000-0000-0000000000c0')).state_owner_id, 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'with its owner');
SELECT is((SELECT row(a.o_class, a.o_owner)::text FROM public._moth_history_audience('projects', '{"is_private": true}'::jsonb, 'aaaa1210-0000-0000-0000-000000000012') a), '(private,)', 'a private project with no creator is still private, owned by nobody');
SELECT is((SELECT row(a.o_class, a.o_owner)::text FROM public._moth_history_audience('phases', '{}'::jsonb, 'aaaa1210-0000-0000-0000-00000000dead') a), '(,)', 'and a side whose project has gone is nobody''s');
SELECT lives_ok($$ INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, state_project_id, state_class, state)
  VALUES ('11111111-1111-1111-1111-111111111111', 'projects', 'aaaa1210-0000-0000-0000-000000000012', 'update', 'aaaa1210-0000-0000-0000-000000000012', 'private', '{"title":"x"}') $$, 'which the table allows');

-- Phases have no workspace of their own, so the row's comes through its project.
INSERT INTO public.phases (id, project_id, name) VALUES ('12100000-0000-0000-0000-0000000000a1', 'aaaa1210-0000-0000-0000-00000000000a', 'Phase');
SELECT is((public.t121_last('phases', '12100000-0000-0000-0000-0000000000a1')).workspace_id, '11111111-1111-1111-1111-111111111111'::uuid, 'a phase finds its company through its project');
UPDATE public.phases SET name = 'Phase renamed' WHERE id = '12100000-0000-0000-0000-0000000000a1';
SELECT is(public.t121_n('phases', '12100000-0000-0000-0000-0000000000a1', 'update'), 1, 'a phase rename');
DELETE FROM public.phases WHERE id = '12100000-0000-0000-0000-0000000000a1';
SELECT is(public.t121_n('phases', '12100000-0000-0000-0000-0000000000a1', 'delete'), 1, 'and its delete');
SELECT is((public.t121_last('phases', '12100000-0000-0000-0000-0000000000a1')).state, NULL::jsonb, 'with nothing after it');

-- A folder carries its name, by its label.
UPDATE public.folders SET label = 'The Rushes' WHERE id = '12100000-0000-0000-0000-0000000000f1';
SELECT is((public.t121_last('folders', '12100000-0000-0000-0000-0000000000f1')).prior ->> 'name', 'rushes', 'a folder''s name before its label');
SELECT is((public.t121_last('folders', '12100000-0000-0000-0000-0000000000f1')).state ->> 'name', 'The Rushes', 'and after');
SELECT is((public.t121_last('folders', '12100000-0000-0000-0000-0000000000f1')).state ? 'path', false, 'and no path');

-- A task's item, and a title too long.
INSERT INTO public.assets (id, project_id, workspace_id, name) VALUES ('12100000-0000-0000-0000-0000000000a2', 'aaaa1210-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Asset');
INSERT INTO public.tasks (id, project_id, workspace_id, title) VALUES ('12100000-0000-0000-0000-0000000000a3', 'aaaa1210-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', repeat('t', 5000));
SELECT is((public.t121_last('tasks', '12100000-0000-0000-0000-0000000000a3')).state -> 'truncated', 'true'::jsonb, 'a 5 KB title still writes a row, marked cut');
SELECT is(length((public.t121_last('tasks', '12100000-0000-0000-0000-0000000000a3')).state ->> 'title'), 300, 'at 300 characters');
INSERT INTO public.task_items (id, task_id, project_id, entity_type, entity_id, position) VALUES
  ('12100000-0000-0000-0000-0000000000a4', '12100000-0000-0000-0000-0000000000a3', 'aaaa1210-0000-0000-0000-00000000000a', 'asset', '12100000-0000-0000-0000-0000000000a2', 1);
SELECT is((public.t121_last('task_items', '12100000-0000-0000-0000-0000000000a4')).state ->> 'item_type', 'asset', 'a task item says what it points at');
SELECT is((public.t121_last('task_items', '12100000-0000-0000-0000-0000000000a4')).state ->> 'item_id', '12100000-0000-0000-0000-0000000000a2', 'and which');
UPDATE public.tasks SET asset_id = '12100000-0000-0000-0000-0000000000a2' WHERE id = '12100000-0000-0000-0000-0000000000a3';
SELECT is((public.t121_last('tasks', '12100000-0000-0000-0000-0000000000a3')).action, 'move', 'a task placed under an asset is a move');
-- Arrays of ids that would pass the row's size are cut to fit, not refused.
CREATE TEMP TABLE t121_big ON COMMIT DROP AS
  SELECT public.moth_history_project('assets', jsonb_build_object('name', 'a', 'scene_ids', (SELECT jsonb_agg(gen_random_uuid()) FROM generate_series(1, 300)), 'shot_ids', (SELECT jsonb_agg(gen_random_uuid()) FROM generate_series(1, 300)))) AS p;
SELECT is((SELECT p -> 'truncated' FROM t121_big), 'true'::jsonb, 'an asset with hundreds of links is marked cut');
SELECT is((SELECT jsonb_array_length(p -> 'scene_ids') FROM t121_big), 20, 'to twenty of each, to fit');
SELECT ok((SELECT public.moth_history_projection_ok(p) FROM t121_big), 'and what it makes is what the table allows');
SELECT is(jsonb_array_length(public.moth_history_project('assets', jsonb_build_object('scene_ids', (SELECT jsonb_agg(gen_random_uuid()) FROM generate_series(1, 90)))) -> 'scene_ids'), 90, 'fewer that fit are kept whole');
SELECT is(public.moth_history_project('assets', jsonb_build_object('scene_ids', (SELECT jsonb_agg(gen_random_uuid()) FROM generate_series(1, 90)))) ? 'truncated', false, 'and not marked');
SELECT is(jsonb_array_length(public.moth_history_project('files', jsonb_build_object('tags', (SELECT jsonb_agg(g::text) FROM generate_series(1, 250) g))) -> 'categories'), 200, 'short values are cut to 200 and no further');
SELECT is(public.moth_history_project('files', '{"storage_path":"x","thumbnail_url":"y","description":"z","storage_provider":"s3","name":"n","created_by":"u"}'::jsonb) - 'missing', '{"name":"n"}'::jsonb, 'no locator, no description, no person');
SELECT is(public.moth_history_project('projects', '{"title":"t","budget_total":5,"folder_root":"r","client_name":"c","description":"d"}'::jsonb), '{"title":"t"}'::jsonb, 'no money, no folder');
SELECT is(public.moth_history_project('folders', '{"slug":"s","path":"p/q"}'::jsonb), '{"name":"s","slug":"s"}'::jsonb, 'a folder with no label is named by its slug, and its path stays out');
SELECT is(public.moth_history_project('files', NULL), NULL::jsonb, 'nothing makes nothing');
SELECT throws_ok($$ SELECT public.moth_history_project('notes', '{}'::jsonb) $$, 'P0001', 'moth_history_project: no map for notes', 'a table with no map is refused, not guessed at');


-- ── D. Money and Legal ──────────────────────────────────────────────────────
SELECT public.t121_file('12100000-0000-0000-0000-000000000201', 'aaaa1210-0000-0000-0000-00000000000a', 'under-money.pdf', '12100000-0000-0000-0000-0000000000f3');
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000201'), 0, 'a file under INVOICES writes nothing');
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial) VALUES
  ('12100000-0000-0000-0000-000000000202', 'aaaa1210-0000-0000-0000-00000000000a', 'inv.pdf', 'supabase', 'projects/aaaa1210-0000-0000-0000-00000000000a/invoices/a/inv.pdf', true);
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000202'), 0, 'nor an invoice');
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, tags) VALUES
  ('12100000-0000-0000-0000-000000000203', 'aaaa1210-0000-0000-0000-00000000000a', 'nda.pdf', 'supabase', 'projects/aaaa1210-0000-0000-0000-00000000000a/legal/a/nda.pdf', '{legal}');
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000203'), 0, 'nor a Legal file');
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('12100000-0000-0000-0000-0000000000f4', 'aaaa1210-0000-0000-0000-00000000000a', '12100000-0000-0000-0000-0000000000f3', 'category', 'march', 'INVOICES/march');
SELECT is(public.t121_n('folders', '12100000-0000-0000-0000-0000000000f4'), 0, 'nor a folder under INVOICES');
SET LOCAL ROLE authenticated;
SELECT public.t121_a();
SELECT throws_ok($$ UPDATE public.folders SET path = 'FILES', slug = 'files' WHERE id = '12100000-0000-0000-0000-0000000000f3' $$, '42501', NULL, 'and the lock cannot be renamed away, even by an admin');
RESET ROLE;

-- A file that becomes money loses its history for good.
SELECT public.t121_file('12100000-0000-0000-0000-000000000204', 'aaaa1210-0000-0000-0000-00000000000a', 'becomes.pdf');
UPDATE public.files SET name = 'becomes-money.pdf' WHERE id = '12100000-0000-0000-0000-000000000204';
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000204'), 2, 'two rows before');
SET LOCAL ROLE authenticated;
SELECT public.t121_a();
SELECT is(public.t121_read('12100000-0000-0000-0000-000000000204'), 2, 'an admin reads them');
RESET ROLE;
UPDATE public.files SET is_financial = true WHERE id = '12100000-0000-0000-0000-000000000204';
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000204'), 2, 'flagging it writes no row');
SELECT is((SELECT count(*)::int FROM public.moth_history h WHERE h.entity_id = '12100000-0000-0000-0000-000000000204' AND h.locked AND h.prior IS NULL AND h.state IS NULL), 2, 'and blanks both');
SET LOCAL ROLE authenticated;
SELECT public.t121_a();
SELECT is(public.t121_read('12100000-0000-0000-0000-000000000204'), 0, 'an admin reads none');
SELECT public.t121_c();
SELECT is(public.t121_read('12100000-0000-0000-0000-000000000204'), 0, 'nor a member');
RESET ROLE;
SELECT public.t121_a();
UPDATE public.files SET deleted_at = now() - interval '40 days' WHERE id = '12100000-0000-0000-0000-000000000204';
SELECT is((SELECT public.purge_soft_deleted() IS NOT NULL), true, 'a purge runs');
SET LOCAL ROLE authenticated;
SELECT public.t121_a();
SELECT is(public.t121_read('12100000-0000-0000-0000-000000000204'), 0, 'and after a trash and a purge, still none');
RESET ROLE;

-- A folder that goes under money, by the guard's only door: the runner, as a repair would.
SELECT public.t121_file('12100000-0000-0000-0000-000000000205', 'aaaa1210-0000-0000-0000-00000000000a', 'linked.pdf');
INSERT INTO public.expenses (id, workspace_id, project_id, file_ids) VALUES
  ('12100000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111', 'aaaa1210-0000-0000-0000-00000000000a', ARRAY['12100000-0000-0000-0000-000000000205'::uuid]);
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000205', 'create'), 1, 'a file an expense has named since, with no write to the file');
SET LOCAL ROLE authenticated;
SELECT public.t121_a();
SELECT is(public.t121_read('12100000-0000-0000-0000-000000000205'), 0, 'is hidden from an admin by the live gate');
RESET ROLE;


-- ── E. One fixture, one CHECK ───────────────────────────────────────────────
SELECT throws_ok($$ INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action) VALUES ('11111111-1111-1111-1111-111111111111', 'files', gen_random_uuid(), 'observe') $$,
  '23514', 'new row for relation "moth_history" violates check constraint "moth_history_a_action_chk"', 'an action outside the vocabulary');
SELECT throws_ok($$ INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, state) VALUES ('11111111-1111-1111-1111-111111111111', 'notes', gen_random_uuid(), 'create', '{"name":"x"}') $$,
  '23514', 'new row for relation "moth_history" violates check constraint "moth_history_b_entity_chk"', 'a table outside the eleven');
SELECT throws_ok($$ INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, state_class) VALUES ('11111111-1111-1111-1111-111111111111', 'files', gen_random_uuid(), 'update', 'personal') $$,
  '23514', 'new row for relation "moth_history" violates check constraint "moth_history_c_class_chk"', 'personal with no owner');
SELECT throws_ok($$ INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, state_class, state_owner_id) VALUES ('11111111-1111-1111-1111-111111111111', 'files', gen_random_uuid(), 'update', 'shared', gen_random_uuid()) $$,
  '23514', 'new row for relation "moth_history" violates check constraint "moth_history_c_class_chk"', 'shared with an owner');
SELECT throws_ok($$ INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, prior) VALUES ('11111111-1111-1111-1111-111111111111', 'files', gen_random_uuid(), 'create', '{"name":"x"}') $$,
  '23514', 'new row for relation "moth_history" violates check constraint "moth_history_d_shape_chk"', 'a create with a before');
SELECT throws_ok($$ INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, state) VALUES ('11111111-1111-1111-1111-111111111111', 'files', gen_random_uuid(), 'delete', '{"name":"x"}') $$,
  '23514', 'new row for relation "moth_history" violates check constraint "moth_history_d_shape_chk"', 'a delete with an after');
SELECT throws_ok($$ INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, mark_kind) VALUES ('11111111-1111-1111-1111-111111111111', 'files', gen_random_uuid(), 'mark_recording', 'observed') $$,
  '23514', 'new row for relation "moth_history" violates check constraint "moth_history_d_shape_chk"', 'a mark of no kind');
SELECT throws_ok($$ INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, mark_kind, state_project_id) VALUES ('11111111-1111-1111-1111-111111111111', 'files', gen_random_uuid(), 'mark_recording', 'baseline', gen_random_uuid()) $$,
  '23514', 'new row for relation "moth_history" violates check constraint "moth_history_d_shape_chk"', 'a baseline scoped to a project');
SELECT throws_ok($$ INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, mark_kind) VALUES ('11111111-1111-1111-1111-111111111111', 'files', gen_random_uuid(), 'update', 'baseline') $$,
  '23514', 'new row for relation "moth_history" violates check constraint "moth_history_d_shape_chk"', 'a change with a mark');
SELECT throws_ok($$ INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, locked, state) VALUES ('11111111-1111-1111-1111-111111111111', 'files', gen_random_uuid(), 'update', true, '{"name":"x"}') $$,
  '23514', 'new row for relation "moth_history" violates check constraint "moth_history_e_locked_chk"', 'a locked row that says anything');
SELECT throws_ok($$ INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, state) VALUES ('11111111-1111-1111-1111-111111111111', 'files', gen_random_uuid(), 'update', '{"storage_path":"x"}') $$,
  '23514', 'new row for relation "moth_history" violates check constraint "moth_history_f_projection_chk"', 'a locator');
SELECT is(public.moth_history_projection_ok(NULL), false, 'the check is never NULL');
SELECT is(public.moth_history_projection_ok('[]'::jsonb), false, 'an array is not a projection');
SELECT is(public.moth_history_projection_ok(jsonb_build_object('name', repeat('x', 301))), false, 'nor a name over 300');
SELECT is(public.moth_history_projection_ok(jsonb_build_object('scene_ids', (SELECT jsonb_agg(g) FROM generate_series(1, 201) g))), false, 'nor an array over 200');
SELECT is(public.moth_history_projection_ok('{"name":{"a":1}}'::jsonb), false, 'nor an object inside');
SELECT is(public.moth_history_projection_ok('{"scene_ids":[{"a":1}]}'::jsonb), false, 'nor an object in an array');
SELECT is(public.moth_history_projection_ok('{"name":"x","folder_id":"y"}'::jsonb), true, 'CONTROL: this is');


-- ── F. Who may read ─────────────────────────────────────────────────────────
SELECT public.t121_file('12100000-0000-0000-0000-000000000301', 'aaaa1210-0000-0000-0000-00000000000c', 'quiet.mov');
SELECT public.t121_file('12100000-0000-0000-0000-000000000302', 'aaaa1210-0000-0000-0000-0000000000c0', 'mine.mov');
SET LOCAL ROLE authenticated;
SELECT public.t121_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222');
SELECT throws_ok($$ SELECT * FROM public.moth_history_read('aaaa1210-0000-0000-0000-00000000000a') $$, '42501', 'that history is not available', 'another company''s project');
SELECT public.t121_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'user');
SELECT throws_ok($$ SELECT * FROM public.moth_history_read() $$, '42501', 'that history is not available', 'someone no longer active');
SELECT throws_ok($$ SELECT * FROM public.moth_history_window() $$, '42501', 'that history is not available', 'at the window too');
SELECT public.t121_c();
SELECT throws_ok($$ SELECT * FROM public.moth_history_read('12100000-0000-0000-0000-00000000dead') $$, '42501', 'that history is not available', 'a project that does not exist');
SELECT throws_ok($$ SELECT * FROM public.moth_history_read('aaaa1210-0000-0000-0000-00000000000c') $$, '42501', 'that history is not available', 'a private project, for a member');
SELECT throws_ok($$ SELECT * FROM public.moth_history_read(NULL, NULL, '12100000-0000-0000-0000-00000000dead') $$, '42501', 'that history is not available', 'a page that was never there');
SELECT throws_ok($$ SELECT * FROM public.moth_history_window('aaaa1210-0000-0000-0000-00000000000c') $$, '42501', 'that history is not available', 'and a window on it');
SELECT is(public.t121_read('12100000-0000-0000-0000-000000000101', 'aaaa1210-0000-0000-0000-00000000000a') >= 3, true, 'a member reads a shared project');
SELECT public.t121_v();
SELECT is(public.t121_read('12100000-0000-0000-0000-000000000101', 'aaaa1210-0000-0000-0000-00000000000a') >= 3, true, 'and a reviewer');
SELECT public.t121_d();
SELECT throws_ok($$ SELECT * FROM public.moth_history_read('aaaa1210-0000-0000-0000-00000000000c') $$, '42501', 'that history is not available', 'a manager, a private project');
SELECT is(public.t121_read('12100000-0000-0000-0000-000000000301'), 0, 'and reads nothing of it in the whole');
SELECT public.t121_e();
SELECT is(public.t121_read('12100000-0000-0000-0000-000000000301', 'aaaa1210-0000-0000-0000-00000000000c'), 1, 'its creator reads it');
SELECT public.t121_a();
SELECT is(public.t121_read('12100000-0000-0000-0000-000000000301', 'aaaa1210-0000-0000-0000-00000000000c'), 1, 'and an admin');
SELECT throws_ok($$ SELECT * FROM public.moth_history_read('aaaa1210-0000-0000-0000-0000000000c0') $$, '42501', 'that history is not available', 'an admin, someone''s personal space');
SELECT is(public.t121_read('12100000-0000-0000-0000-000000000302'), 0, 'and reads nothing of it in the whole');
SELECT public.t121_c();
SELECT is(public.t121_read('12100000-0000-0000-0000-000000000302', 'aaaa1210-0000-0000-0000-0000000000c0'), 1, 'its owner reads it');
-- The shape of what comes back.
SELECT is((SELECT array_agg(r.action ORDER BY r.action) FROM (SELECT DISTINCT x.action FROM public.moth_history_read('aaaa1210-0000-0000-0000-00000000000a') x WHERE x.entity_id = '12100000-0000-0000-0000-000000000101') r),
  ARRAY['added', 'changed', 'moved'], 'its own words for what happened');
SELECT is((SELECT array_agg(r.action ORDER BY r.action) FROM (SELECT DISTINCT x.action FROM public.moth_history_read('aaaa1210-0000-0000-0000-00000000000b') x WHERE x.entity_id = '12100000-0000-0000-0000-000000000102') r),
  ARRAY['moved', 'restored', 'trashed'], 'someone on both ends sees a move, a trash and a restore as themselves');
RESET ROLE;
SELECT public.t121_a();
SELECT public.t121_file('12100000-0000-0000-0000-000000000303', 'aaaa1210-0000-0000-0000-00000000000b', 'pages.mov');
UPDATE public.files SET name = 'pages-1.mov' WHERE id = '12100000-0000-0000-0000-000000000303';
UPDATE public.files SET name = 'pages-2.mov' WHERE id = '12100000-0000-0000-0000-000000000303';
UPDATE public.files SET deleted_at = now() WHERE id = '12100000-0000-0000-0000-000000000303';
UPDATE public.files SET deleted_at = NULL WHERE id = '12100000-0000-0000-0000-000000000303';
SET LOCAL ROLE authenticated;
SELECT public.t121_c();
SELECT is((SELECT array_agg(x.action ORDER BY x.observed_at DESC, x.row_key) FILTER (WHERE x.action IN ('trashed', 'restored')) FROM public.moth_history_read('aaaa1210-0000-0000-0000-00000000000b') x WHERE x.entity_id = '12100000-0000-0000-0000-000000000303') IS NOT NULL, true, 'a trash and a restore in their own words');
SELECT is((SELECT count(*)::int FROM public.moth_history_read('aaaa1210-0000-0000-0000-00000000000b', NULL, NULL, 2) x), 2, 'a limit is kept');
SELECT is((SELECT count(*)::int FROM public.moth_history_read('aaaa1210-0000-0000-0000-00000000000b', NULL, NULL, 0) x), 1, 'a limit under 1 reads as 1');
SELECT is((SELECT count(*)::int FROM public.moth_history_read('aaaa1210-0000-0000-0000-00000000000b', now() + interval '1 hour') x), 0, 'a since in the future reads nothing');
RESET ROLE;
-- Pages are by row, strictly older, however many share a moment.
SELECT is((SELECT count(*)::int FROM (SELECT DISTINCT observed_at FROM public.moth_history WHERE entity_id = '12100000-0000-0000-0000-000000000303') t), 1, 'CONTROL: these rows share one moment, as a transaction''s do');
SET LOCAL ROLE authenticated;
SELECT public.t121_c();
CREATE TEMP TABLE t121_page ON COMMIT DROP AS SELECT x.row_key FROM public.moth_history_read(NULL, NULL, NULL, 5000) x WHERE x.entity_id = '12100000-0000-0000-0000-000000000303';
SELECT is((SELECT count(*)::int FROM public.moth_history_read(NULL, NULL, (SELECT r.row_key FROM public.moth_history_read(NULL, NULL, NULL, 1) r LIMIT 1), 5000) x
            WHERE x.row_key = (SELECT r.row_key FROM public.moth_history_read(NULL, NULL, NULL, 1) r LIMIT 1)), 0, 'the next page does not repeat its last row');
RESET ROLE;


-- ── G. Two audiences, then and now ──────────────────────────────────────────
-- From a private project into a shared one, whose creator then opens the first: nobody learns
-- where it came from.
SELECT public.t121_a();
SELECT public.t121_file('12100000-0000-0000-0000-000000000401', 'aaaa1210-0000-0000-0000-00000000000c', 'from-x.mov');
UPDATE public.files SET project_id = 'aaaa1210-0000-0000-0000-00000000000a' WHERE id = '12100000-0000-0000-0000-000000000401';
UPDATE public.projects SET is_private = false WHERE id = 'aaaa1210-0000-0000-0000-00000000000c';
SET LOCAL ROLE authenticated;
SELECT public.t121_c();
SELECT is((SELECT array_agg(x.action) FROM public.moth_history_read() x WHERE x.entity_id = '12100000-0000-0000-0000-000000000401'), ARRAY['added'], 'a member sees it added');
SELECT is((SELECT row(x.prior, x.prior_project_id)::text FROM public.moth_history_read() x WHERE x.entity_id = '12100000-0000-0000-0000-000000000401'), '(,)', 'with nothing of where it was');
SELECT public.t121_d();
SELECT is((SELECT array_agg(x.action) FROM public.moth_history_read() x WHERE x.entity_id = '12100000-0000-0000-0000-000000000401'), ARRAY['added'], 'and a manager the same');
SELECT is((SELECT row(x.prior, x.prior_project_id)::text FROM public.moth_history_read() x WHERE x.entity_id = '12100000-0000-0000-0000-000000000401'), '(,)', 'as nothing');
SELECT public.t121_e();
SELECT is((SELECT count(*)::int FROM public.moth_history_read() x WHERE x.entity_id = '12100000-0000-0000-0000-000000000401' AND x.action = 'moved'), 1, 'CONTROL: its creator sees the move');
SELECT public.t121_a();
SELECT is((SELECT count(*)::int FROM public.moth_history_read() x WHERE x.entity_id = '12100000-0000-0000-0000-000000000401' AND x.action = 'moved'), 1, 'and an admin');
RESET ROLE;
-- From a shared project into a private one: a member sees none of it, the create included.
SELECT public.t121_file('12100000-0000-0000-0000-000000000402', 'aaaa1210-0000-0000-0000-00000000000a', 'to-y.mov');
UPDATE public.files SET project_id = 'aaaa1210-0000-0000-0000-00000000000d' WHERE id = '12100000-0000-0000-0000-000000000402';
SET LOCAL ROLE authenticated;
SELECT public.t121_c();
SELECT is(public.t121_read('12100000-0000-0000-0000-000000000402'), 0, 'a file gone to a private project shows a member nothing');
SELECT public.t121_e();
SELECT is(public.t121_read('12100000-0000-0000-0000-000000000402'), 2, 'its creator sees both rows');
RESET ROLE;
-- A trashed project hides its history, and a deleted one is left to its sides.
SELECT public.t121_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private) VALUES
  ('aaaa1210-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'To Trash', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
UPDATE public.projects SET deleted_at = now() WHERE id = 'aaaa1210-0000-0000-0000-000000000013';
SET LOCAL ROLE authenticated;
SELECT public.t121_a();
SELECT is(public.t121_read('aaaa1210-0000-0000-0000-000000000013'), 0, 'a trashed project hides its history, for an admin too');
RESET ROLE;


-- ── H. How far back it can be trusted ───────────────────────────────────────
SET LOCAL ROLE service_role;
UPDATE public.workspaces SET created_at = now() - interval '200 days' WHERE id = '11111111-1111-1111-1111-111111111111';
RESET ROLE;
INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, mark_kind, observed_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'files', '11111111-1111-1111-1111-111111111111', 'mark_recording', 'baseline', now() - interval '10 days'),
  ('11111111-1111-1111-1111-111111111111', 'folders', '11111111-1111-1111-1111-111111111111', 'mark_recording', 'baseline', now() - interval '10 days'),
  ('11111111-1111-1111-1111-111111111111', 'tasks', '11111111-1111-1111-1111-111111111111', 'mark_recording', 'baseline', now() - interval '100 days');
SET LOCAL ROLE authenticated;
SELECT public.t121_c();
SELECT is((SELECT w.recording_since FROM public.moth_history_window() w WHERE w.entity_type = 'files' AND w.project_id IS NULL), now() - interval '10 days', 'a type begins at its mark');
SELECT is((SELECT w.recording_since FROM public.moth_history_window() w WHERE w.entity_type = 'tasks' AND w.project_id IS NULL), now() - interval '90 days', 'or 90 days ago, when that is later');
RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE public.workspaces SET created_at = now() - interval '5 days' WHERE id = '11111111-1111-1111-1111-111111111111';
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT public.t121_c();
SELECT is((SELECT w.recording_since FROM public.moth_history_window() w WHERE w.entity_type = 'files' AND w.project_id IS NULL), now() - interval '5 days', 'or when the company began, when that is later');
SELECT is((SELECT w.recording_since FROM public.moth_history_window() w WHERE w.entity_type = 'levels' AND w.project_id IS NULL), now() - interval '5 days', 'and a type with no mark at the company''s start');
SELECT is((SELECT count(*)::int FROM public.moth_history_window() w WHERE w.project_id IS NULL), 11, 'one row per type');
RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE public.workspaces SET created_at = now() - interval '200 days' WHERE id = '11111111-1111-1111-1111-111111111111';
RESET ROLE;
INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, mark_kind, observed_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'levels', '11111111-1111-1111-1111-111111111111', 'mark_recording', 'suspended', now() - interval '3 days');
SET LOCAL ROLE authenticated;
SELECT public.t121_c();
SELECT is((SELECT w.recording_since FROM public.moth_history_window() w WHERE w.entity_type = 'levels' AND w.project_id IS NULL), now() - interval '3 days', 'a suspension restarts the type');
RESET ROLE;

-- A capture that fails: the write goes on, and the record says it restarts here.
ALTER TABLE public.moth_history DROP CONSTRAINT moth_history_b_entity_chk;
ALTER TABLE public.moth_history ADD CONSTRAINT moth_history_b_entity_chk
  CHECK ((action = 'mark_recording' AND entity_type ~ '^[a-z_]{1,63}$')
         OR entity_type IN ('projects', 'phases', 'assets', 'tasks', 'files', 'scenes', 'shots', 'levels', 'experiences', 'task_items')) NOT VALID;
SELECT lives_ok($$ INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('12100000-0000-0000-0000-0000000000f5', 'aaaa1210-0000-0000-0000-00000000000a', '12100000-0000-0000-0000-0000000000f0', 'category', 'failing', 'failing') $$, 'a folder goes in though its capture fails');
SELECT is((SELECT count(*)::int FROM public.folders WHERE id = '12100000-0000-0000-0000-0000000000f5'), 1, 'it is there');
SELECT is(public.t121_n('folders', '12100000-0000-0000-0000-0000000000f5'), 0, 'with no row of history');
SELECT is((SELECT count(*)::int FROM public.moth_history h WHERE h.action = 'mark_recording' AND h.mark_kind = 'capture_failed' AND h.entity_type = 'folders' AND h.entity_id = '11111111-1111-1111-1111-111111111111' AND h.state_project_id = 'aaaa1210-0000-0000-0000-00000000000a'), 1, 'and a mark scoped to its project');
SET LOCAL ROLE authenticated;
SELECT public.t121_c();
SELECT is((SELECT w.recording_since FROM public.moth_history_window() w WHERE w.entity_type = 'folders' AND w.project_id = 'aaaa1210-0000-0000-0000-00000000000a'), now(), 'the window says that project''s folders restart now');
SELECT is((SELECT w.recording_since FROM public.moth_history_window() w WHERE w.entity_type = 'folders' AND w.project_id IS NULL), now() - interval '10 days', 'and the rest of the company''s do not');
SELECT is((SELECT count(*)::int FROM public.moth_history_window('aaaa1210-0000-0000-0000-00000000000b') w WHERE w.project_id IS NOT NULL), 0, 'nor another project''s window');
RESET ROLE;
-- Inside someone's personal space: invisible to anyone else.
SELECT lives_ok($$ INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('12100000-0000-0000-0000-0000000000c1', 'aaaa1210-0000-0000-0000-0000000000c0', NULL, 'root', 'mine', '') $$, 'another fails in a personal space');
SET LOCAL ROLE authenticated;
SELECT public.t121_a();
SELECT is((SELECT count(*)::int FROM public.moth_history_window() w WHERE w.project_id = 'aaaa1210-0000-0000-0000-0000000000c0'), 0, 'an admin sees no restart there');
SELECT public.t121_d();
SELECT is((SELECT count(*)::int FROM public.moth_history_window() w WHERE w.project_id = 'aaaa1210-0000-0000-0000-0000000000c0'), 0, 'nor a manager');
SELECT public.t121_c();
SELECT is((SELECT count(*)::int FROM public.moth_history_window() w WHERE w.project_id = 'aaaa1210-0000-0000-0000-0000000000c0'), 1, 'its owner does');
RESET ROLE;
ALTER TABLE public.moth_history DROP CONSTRAINT moth_history_b_entity_chk;
ALTER TABLE public.moth_history ADD CONSTRAINT moth_history_b_entity_chk
  CHECK ((action = 'mark_recording' AND entity_type ~ '^[a-z_]{1,63}$')
         OR entity_type IN ('projects', 'phases', 'assets', 'tasks', 'files', 'folders', 'scenes', 'shots', 'levels', 'experiences', 'task_items'));


-- ── I. The purge ────────────────────────────────────────────────────────────
INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, observed_at, state_project_id, state_class, state) VALUES
  ('11111111-1111-1111-1111-111111111111', 'files', '12100000-0000-0000-0000-000000000501', 'update', now() - interval '91 days', 'aaaa1210-0000-0000-0000-00000000000a', 'shared', '{"name":"old"}'),
  ('11111111-1111-1111-1111-111111111111', 'files', '12100000-0000-0000-0000-000000000502', 'update', now() - interval '89 days', 'aaaa1210-0000-0000-0000-00000000000a', 'shared', '{"name":"kept"}');
SET LOCAL ROLE authenticated;
SELECT public.t121_c();
SELECT is(public.t121_read('12100000-0000-0000-0000-000000000501'), 0, 'older than 90 days reads as nothing even before the purge');
SELECT is(public.t121_read('12100000-0000-0000-0000-000000000502'), 1, 'CONTROL: 89 days does');
SELECT throws_ok($$ SELECT public.purge_moth_history() $$, '42501', NULL, 'a client cannot purge');
RESET ROLE;
SELECT throws_ok($$ SELECT public.purge_moth_history(interval '23 hours') $$, 'P0001', 'purge_moth_history: a retention under one day is refused', 'a retention under a day is refused');
SELECT is((SELECT public.purge_moth_history() >= 1), true, 'the purge says what it took');
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000501'), 0, '91 days is gone');
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000502'), 1, '89 days is kept');


-- ── J. A company going away ─────────────────────────────────────────────────
INSERT INTO public.workspaces (id, name, slug) VALUES ('33333333-1210-3333-3333-333333333333', 'Doomed Studio', 'ws-doomed-121');
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private) VALUES
  ('aaaa1210-0000-0000-0000-000000000033', '33333333-1210-3333-3333-333333333333', 'Doomed', NULL, false);
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path) VALUES
  ('12100000-0000-0000-0000-000000000601', 'aaaa1210-0000-0000-0000-000000000033', 'doomed.mov', 'local_server', 'projects/aaaa1210-0000-0000-0000-000000000033/files/12100000-0000-0000-0000-000000000601/doomed.mov');
SELECT is((SELECT count(*)::int FROM public.moth_history WHERE workspace_id = '33333333-1210-3333-3333-333333333333'), 2, 'a company with a project and a file has two rows');
SELECT lives_ok($$ DELETE FROM public.workspaces WHERE id = '33333333-1210-3333-3333-333333333333' $$, 'deleting the company still works');
SELECT is((SELECT count(*)::int FROM public.moth_history WHERE workspace_id = '33333333-1210-3333-3333-333333333333'), 0, 'and leaves no rows');
SELECT is((SELECT count(*)::int FROM public.moth_history WHERE entity_id = '12100000-0000-0000-0000-000000000601'), 0, 'not one, under any company');

SELECT * FROM finish();
ROLLBACK;
