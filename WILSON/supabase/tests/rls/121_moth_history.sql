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

SELECT plan(290);

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
CREATE FUNCTION public.t121_walk(p_scope uuid) RETURNS uuid[] LANGUAGE plpgsql AS $f$
DECLARE
  v_out uuid[] := '{}';
  v_key uuid;
  v_i   integer := 0;
BEGIN
  LOOP
    v_key := (SELECT x.row_key FROM public.moth_history_read(p_scope, NULL, v_key, 1) x);
    EXIT WHEN v_key IS NULL OR v_i > 500;
    v_out := v_out || v_key;
    v_i := v_i + 1;
  END LOOP;
  RETURN v_out;
END;
$f$;

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
SELECT is(has_function_privilege('authenticated', 'public.fn_moth_history_redact_receipts()', 'EXECUTE'), false, 'a client cannot call the receipts'' redaction');
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
-- A column gone from a list silently corrupts every rebuild before it, so each is named here too.
SELECT is((SELECT array_agg(x.tbl || ':' || x.c ORDER BY x.tbl, x.c) FROM (VALUES
  ('projects', 'title status project_type is_private personal_owner_id deleted_at'),
  ('phases', 'name status parent_phase_id sort_order deleted_at'),
  ('assets', 'name type type_label status phase_id sort_order scene_ids shot_ids level_ids experience_ids deleted_at'),
  ('tasks', 'title status phase_id asset_id scene_id shot_id project_id deleted_at'),
  ('files', 'name project_id folder_id kind mime_type size_bytes document_kind tags is_core_definer phase_id asset_id task_id scene_id shot_id level_id experience_id deleted_at is_financial storage_path share_missing_since'),
  ('folders', 'project_id parent_id slug label kind entity_type sort_order path asset_id scene_id shot_id level_id experience_id'),
  ('scenes', 'name scene_number status sort_order'),
  ('shots', 'name shot_number scene_id status sort_order'),
  ('levels', 'name status sort_order'),
  ('experiences', 'name status sort_order'),
  ('task_items', 'task_id entity_type entity_id position')
  ) AS w(tbl, cols), LATERAL (SELECT w.tbl, c FROM unnest(string_to_array(w.cols, ' ')) c) x
   WHERE NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = ('public.' || x.tbl)::regclass AND t.tgname = 'trg_' || x.tbl || '_moth_history_upd'
                      AND pg_get_triggerdef(t.oid) LIKE '%old.' || CASE WHEN x.c = 'position' THEN '"position"' ELSE x.c END || ' IS DISTINCT FROM new.%')), NULL::text[], 'every pinned column is in its table''s list');
SELECT is((SELECT count(*)::int FROM pg_proc p, unnest(p.proconfig) c WHERE p.oid IN ('public.fn_moth_history_capture()'::regprocedure, 'public.moth_history_read(uuid,timestamp with time zone,uuid,integer)'::regprocedure, 'public.moth_history_window(uuid)'::regprocedure, 'public._moth_history_folder_locked(uuid,jsonb)'::regprocedure) AND c LIKE 'search_path=%'), 4, 'each definer pins its search_path');


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
SELECT is((public.t121_last('files', '12100000-0000-0000-0000-000000000102')).state ->> 'name', 'two.mov', 'with its metadata');
SELECT is((public.t121_last('files', '12100000-0000-0000-0000-000000000102')).prior_project_id, 'aaaa1210-0000-0000-0000-00000000000a'::uuid, 'from');
SELECT is((public.t121_last('files', '12100000-0000-0000-0000-000000000102')).state_project_id, 'aaaa1210-0000-0000-0000-00000000000b'::uuid, 'to');
SELECT is((public.t121_last('files', '12100000-0000-0000-0000-000000000102')).actor_user_id, 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'by the person who moved it');

-- An undo is one move, and a new key on the same row is none.
SELECT public.t121_file('12100000-0000-0000-0000-000000000107', 'aaaa1210-0000-0000-0000-00000000000a', 'undo.mov');
SET LOCAL ROLE authenticated;
SELECT public.t121_c();
CREATE TEMP TABLE t121_ret (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON t121_ret TO authenticated;
INSERT INTO t121_ret SELECT 'm', public.moth_move_items(ARRAY['12100000-0000-0000-0000-000000000107'::uuid], 'aaaa1210-0000-0000-0000-00000000000b');
SELECT lives_ok($$ SELECT public.moth_undo_move((SELECT (v ->> 'move_id')::uuid FROM t121_ret WHERE k = 'm')) $$, 'and undone');
RESET ROLE;
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000107', 'move'), 2, 'one move each way');
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000107'), 3, 'and nothing else');

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

-- Every table, each way, and no restart mark for any of it.
INSERT INTO public.scenes (id, project_id, workspace_id, name, scene_number) VALUES ('12100000-0000-0000-0000-0000000000b1', 'aaaa1210-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Scene', 1);
INSERT INTO public.shots (id, project_id, scene_id, name, shot_number) VALUES ('12100000-0000-0000-0000-0000000000b2', 'aaaa1210-0000-0000-0000-00000000000a', '12100000-0000-0000-0000-0000000000b1', 'Shot', 1), ('12100000-0000-0000-0000-0000000000b9', 'aaaa1210-0000-0000-0000-00000000000a', NULL, 'Loose', 2);
INSERT INTO public.levels (id, project_id, name) VALUES ('12100000-0000-0000-0000-0000000000b3', 'aaaa1210-0000-0000-0000-00000000000a', 'Level');
INSERT INTO public.experiences (id, project_id, name) VALUES ('12100000-0000-0000-0000-0000000000b4', 'aaaa1210-0000-0000-0000-00000000000a', 'Experience');
INSERT INTO public.phases (id, project_id, name) VALUES ('12100000-0000-0000-0000-0000000000b5', 'aaaa1210-0000-0000-0000-00000000000a', 'Parent phase'), ('12100000-0000-0000-0000-0000000000b6', 'aaaa1210-0000-0000-0000-00000000000a', 'Child phase');
INSERT INTO public.assets (id, project_id, workspace_id, name) VALUES ('12100000-0000-0000-0000-0000000000b7', 'aaaa1210-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Asset 2');
INSERT INTO public.tasks (id, project_id, workspace_id, title) VALUES ('12100000-0000-0000-0000-0000000000b8', 'aaaa1210-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Task 2');
SELECT is((SELECT array_agg(h.entity_type ORDER BY h.entity_type) FROM public.moth_history h WHERE h.entity_id IN ('12100000-0000-0000-0000-0000000000b1', '12100000-0000-0000-0000-0000000000b2', '12100000-0000-0000-0000-0000000000b3', '12100000-0000-0000-0000-0000000000b4') AND h.action = 'create'), ARRAY['experiences', 'levels', 'scenes', 'shots'], 'the four quieter tables write a create');
SELECT is((public.t121_last('scenes', '12100000-0000-0000-0000-0000000000b1')).state, '{"name": "Scene", "number": 1}'::jsonb - 'x' || (public.t121_last('scenes', '12100000-0000-0000-0000-0000000000b1')).state - 'name' - 'number' || '{"name": "Scene", "number": 1}'::jsonb, 'a scene''s name and number');
SELECT is((public.t121_last('scenes', '12100000-0000-0000-0000-0000000000b1')).state ->> 'number', '1', 'its number under that name');
SELECT is((public.t121_last('shots', '12100000-0000-0000-0000-0000000000b2')).state ->> 'scene_id', '12100000-0000-0000-0000-0000000000b1', 'a shot''s scene');
SELECT is((public.t121_last('shots', '12100000-0000-0000-0000-0000000000b2')).state ->> 'number', '1', 'and number');
UPDATE public.scenes SET status = 'approved' WHERE id = '12100000-0000-0000-0000-0000000000b1';
SELECT is((public.t121_last('scenes', '12100000-0000-0000-0000-0000000000b1')).action, 'update', 'a status change alone speaks');
SELECT is((public.t121_last('scenes', '12100000-0000-0000-0000-0000000000b1')).state ->> 'status', 'approved', 'saying so');
UPDATE public.shots SET scene_id = NULL WHERE id = '12100000-0000-0000-0000-0000000000b2';
SELECT is((public.t121_last('shots', '12100000-0000-0000-0000-0000000000b2')).action, 'move', 'a shot off its scene is a move');
UPDATE public.levels SET name = 'Level 2' WHERE id = '12100000-0000-0000-0000-0000000000b3';
SELECT is((public.t121_last('levels', '12100000-0000-0000-0000-0000000000b3')).state ->> 'name', 'Level 2', 'a level renamed');
UPDATE public.experiences SET sort_order = 7 WHERE id = '12100000-0000-0000-0000-0000000000b4';
SELECT is((public.t121_last('experiences', '12100000-0000-0000-0000-0000000000b4')).state ->> 'sort_order', '7', 'an experience reordered');
UPDATE public.phases SET parent_phase_id = '12100000-0000-0000-0000-0000000000b5' WHERE id = '12100000-0000-0000-0000-0000000000b6';
SELECT is((public.t121_last('phases', '12100000-0000-0000-0000-0000000000b6')).action, 'move', 'a phase under a parent is a move');
SELECT is((public.t121_last('phases', '12100000-0000-0000-0000-0000000000b6')).state ->> 'parent_phase_id', '12100000-0000-0000-0000-0000000000b5', 'saying which');
UPDATE public.phases SET status = 'done' WHERE id = '12100000-0000-0000-0000-0000000000b5';
SELECT is((public.t121_last('phases', '12100000-0000-0000-0000-0000000000b5')).state ->> 'status', 'done', 'a phase''s status alone');
UPDATE public.assets SET phase_id = '12100000-0000-0000-0000-0000000000b5' WHERE id = '12100000-0000-0000-0000-0000000000b7';
SELECT is((public.t121_last('assets', '12100000-0000-0000-0000-0000000000b7')).action, 'move', 'an asset under a phase is a move');
SELECT is((public.t121_last('assets', '12100000-0000-0000-0000-0000000000b7')).state ->> 'phase_id', '12100000-0000-0000-0000-0000000000b5', 'saying which');
UPDATE public.tasks SET phase_id = '12100000-0000-0000-0000-0000000000b5' WHERE id = '12100000-0000-0000-0000-0000000000b8';
SELECT is((public.t121_last('tasks', '12100000-0000-0000-0000-0000000000b8')).action, 'move', 'and a task');
UPDATE public.tasks SET status = 'in_progress' WHERE id = '12100000-0000-0000-0000-0000000000b8';
SELECT is((public.t121_last('tasks', '12100000-0000-0000-0000-0000000000b8')).state ->> 'status', 'in_progress', 'a task''s status alone');
UPDATE public.assets SET deleted_at = now() WHERE id = '12100000-0000-0000-0000-0000000000b7';
SELECT is((public.t121_last('assets', '12100000-0000-0000-0000-0000000000b7')).action, 'trash', 'an asset trashed');
UPDATE public.assets SET deleted_at = NULL WHERE id = '12100000-0000-0000-0000-0000000000b7';
SELECT is((public.t121_last('assets', '12100000-0000-0000-0000-0000000000b7')).action, 'restore', 'and restored');
UPDATE public.tasks SET deleted_at = now() WHERE id = '12100000-0000-0000-0000-0000000000b8';
SELECT is((public.t121_last('tasks', '12100000-0000-0000-0000-0000000000b8')).action, 'trash', 'a task trashed');
UPDATE public.phases SET deleted_at = now() WHERE id = '12100000-0000-0000-0000-0000000000b6';
SELECT is((public.t121_last('phases', '12100000-0000-0000-0000-0000000000b6')).action, 'trash', 'a phase trashed');
UPDATE public.projects SET status = 'on_hold' WHERE id = 'aaaa1210-0000-0000-0000-000000000011';
SELECT is((public.t121_last('projects', 'aaaa1210-0000-0000-0000-000000000011')).state ->> 'status', 'on_hold', 'a project''s status alone');
UPDATE public.projects SET deleted_at = now() WHERE id = 'aaaa1210-0000-0000-0000-000000000011';
SELECT is((public.t121_last('projects', 'aaaa1210-0000-0000-0000-000000000011')).action, 'trash', 'a project trashed');
DELETE FROM public.levels WHERE id = '12100000-0000-0000-0000-0000000000b3';
SELECT is((public.t121_last('levels', '12100000-0000-0000-0000-0000000000b3')).action, 'delete', 'a level deleted');
-- A task taken to another project speaks, though nothing it stores has changed.
INSERT INTO public.tasks (id, project_id, workspace_id, title) VALUES ('12100000-0000-0000-0000-0000000000b0', 'aaaa1210-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Wandering');
UPDATE public.tasks SET project_id = 'aaaa1210-0000-0000-0000-00000000000b' WHERE id = '12100000-0000-0000-0000-0000000000b0';
SELECT is((public.t121_last('tasks', '12100000-0000-0000-0000-0000000000b0')).state_project_id, 'aaaa1210-0000-0000-0000-00000000000b'::uuid, 'a task taken to another project is recorded');
SELECT is((public.t121_last('tasks', '12100000-0000-0000-0000-0000000000b0')).prior_project_id, 'aaaa1210-0000-0000-0000-00000000000a'::uuid, 'from where');
-- A plain file gone, and a folder moved.
SELECT public.t121_file('12100000-0000-0000-0000-000000000108', 'aaaa1210-0000-0000-0000-00000000000a', 'going.mov');
DELETE FROM public.files WHERE id = '12100000-0000-0000-0000-000000000108';
SELECT is((public.t121_last('files', '12100000-0000-0000-0000-000000000108')).action, 'delete', 'a file deleted');
SELECT is((public.t121_last('files', '12100000-0000-0000-0000-000000000108')).prior ->> 'name', 'going.mov', 'with its name before');
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES ('12100000-0000-0000-0000-0000000000fb', 'aaaa1210-0000-0000-0000-00000000000a', '12100000-0000-0000-0000-0000000000f0', 'category', 'movable', 'movable');
UPDATE public.folders SET parent_id = '12100000-0000-0000-0000-0000000000f1', path = 'rushes/movable' WHERE id = '12100000-0000-0000-0000-0000000000fb';
SELECT is((public.t121_last('folders', '12100000-0000-0000-0000-0000000000fb')).action, 'move', 'a folder under another is a move');
SELECT is((public.t121_last('folders', '12100000-0000-0000-0000-0000000000fb')).state ->> 'parent_id', '12100000-0000-0000-0000-0000000000f1', 'saying which');
-- A money word lower down is only a name: the walk asks it only under a root.
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES ('12100000-0000-0000-0000-0000000000fc', 'aaaa1210-0000-0000-0000-00000000000a', '12100000-0000-0000-0000-0000000000f1', 'custom', 'invoices', 'rushes/invoices');
SELECT is(public.t121_n('folders', '12100000-0000-0000-0000-0000000000fc', 'create'), 1, 'a folder called invoices deep in a tree is recorded');
SELECT is((SELECT count(*)::int FROM public.moth_history h WHERE h.workspace_id = '11111111-1111-1111-1111-111111111111' AND h.mark_kind = 'capture_failed'), 0, 'and not one restart mark among any of it');

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
UPDATE public.tasks SET title = repeat('t', 4000) || 'changed past the cut' WHERE id = '12100000-0000-0000-0000-0000000000a3';
SELECT is(public.t121_n('tasks', '12100000-0000-0000-0000-0000000000a3', 'update'), 1, 'a change past the cut still speaks: two sides cut alike were not alike');
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
CREATE TEMP TABLE t121_wide ON COMMIT DROP AS
  SELECT n, public.moth_history_project('assets', v) AS p FROM (VALUES
    ('control', jsonb_build_object('name', repeat(chr(1), 300), 'type_label', repeat(chr(1), 300), 'status', repeat(chr(1), 300), 'scene_ids', (SELECT jsonb_agg(gen_random_uuid()) FROM generate_series(1, 9)))),
    ('wide', jsonb_build_object('name', repeat(chr(26085), 300), 'scene_ids', (SELECT jsonb_agg(gen_random_uuid()) FROM generate_series(1, 20)), 'shot_ids', (SELECT jsonb_agg(gen_random_uuid()) FROM generate_series(1, 20)), 'level_ids', (SELECT jsonb_agg(gen_random_uuid()) FROM generate_series(1, 20)), 'experience_ids', (SELECT jsonb_agg(gen_random_uuid()) FROM generate_series(1, 20)))),
    ('tags', jsonb_build_object('name', 'x', 'type_label', repeat('y', 300), 'scene_ids', (SELECT jsonb_agg(repeat('z', 200)) FROM generate_series(1, 200)))),
    ('last', jsonb_build_object('name', 'x', 'phase_id', '12100000-0000-0000-0000-0000000000a1', 'scene_ids', (SELECT jsonb_agg(repeat('z', 1000)) FROM generate_series(1, 5))))
  ) AS t(n, v);
SELECT is((SELECT array_agg(n ORDER BY n) FROM t121_wide WHERE public.moth_history_projection_ok(p)), ARRAY['control', 'last', 'tags', 'wide'], 'whatever goes in, what comes out fits: text that takes six octets a character, wide characters, long array items');
SELECT is((SELECT count(*)::int FROM t121_wide WHERE p -> 'truncated' = 'true'::jsonb), 4, 'each marked cut');
SELECT is((SELECT p ->> 'phase_id' FROM t121_wide WHERE n = 'last'), '12100000-0000-0000-0000-0000000000a1', 'and an id is never cut short: it is no id then');
SELECT is((SELECT p ? 'scene_ids' FROM t121_wide WHERE n = 'last'), false, 'an array too long even at five goes altogether');
SELECT is((SELECT prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql') FROM pg_proc WHERE oid = 'public.moth_history_projection_ok(jsonb)'::regprocedure), true, 'the check is plpgsql, so a row does not plan it afresh');
SELECT is((SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'moth_history' AND indexname = 'moth_history_marks_idx' AND indexdef LIKE '%mark_recording%'), 1, 'and the window has its index');
SELECT is(public.moth_history_projection_ok(jsonb_build_object('name', 'x', 'title', repeat('t', 300), 'slug', repeat('t', 300), 'scene_ids', (SELECT jsonb_agg(repeat('z', 200)) FROM generate_series(1, 20)))), false, 'and the check does refuse past 4,096 octets');
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

-- A side locked only before the change.
DELETE FROM public.files WHERE id = '12100000-0000-0000-0000-000000000201';
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000201'), 0, 'deleting a file under INVOICES writes nothing');
SELECT public.t121_file('12100000-0000-0000-0000-000000000206', 'aaaa1210-0000-0000-0000-00000000000a', 'leaving-money.pdf', '12100000-0000-0000-0000-0000000000f3');
UPDATE public.files SET folder_id = '12100000-0000-0000-0000-0000000000f1' WHERE id = '12100000-0000-0000-0000-000000000206';
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000206'), 0, 'nor does moving one out of it, whose name it would give away');
-- A folder that has rows, then is locked.
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES ('12100000-0000-0000-0000-0000000000f6', 'aaaa1210-0000-0000-0000-00000000000a', '12100000-0000-0000-0000-0000000000f0', 'category', 'open', 'open');
UPDATE public.folders SET label = 'Open Name' WHERE id = '12100000-0000-0000-0000-0000000000f6';
SELECT is(public.t121_n('folders', '12100000-0000-0000-0000-0000000000f6'), 2, 'a folder has two rows');
UPDATE public.folders SET path = 'INVOICES/open' WHERE id = '12100000-0000-0000-0000-0000000000f6';
SELECT is((SELECT count(*)::int FROM public.moth_history h WHERE h.entity_id = '12100000-0000-0000-0000-0000000000f6' AND h.locked AND h.prior IS NULL AND h.state IS NULL), 2, 'put under money, both go blank');
DELETE FROM public.folders WHERE id = '12100000-0000-0000-0000-0000000000f6';
SET LOCAL ROLE authenticated;
SELECT public.t121_a();
SELECT is(public.t121_read('12100000-0000-0000-0000-0000000000f6'), 0, 'and stay unread once it has gone');
RESET ROLE;
-- A category called invoices whose path says otherwise, and what is under it.
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES ('12100000-0000-0000-0000-0000000000f7', 'aaaa1210-0000-0000-0000-00000000000a', '12100000-0000-0000-0000-0000000000f0', 'category', 'invoices', 'Receipts-old');
SELECT is(public.t121_n('folders', '12100000-0000-0000-0000-0000000000f7'), 0, 'a money slug under a root writes nothing, whatever its path says');
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES ('12100000-0000-0000-0000-0000000000f8', 'aaaa1210-0000-0000-0000-00000000000a', '12100000-0000-0000-0000-0000000000f7', 'custom', 'y', 'Receipts-old/y');
SELECT is(public.t121_n('folders', '12100000-0000-0000-0000-0000000000f8'), 0, 'nor a folder under it');
UPDATE public.folders SET label = 'Named' WHERE id = '12100000-0000-0000-0000-0000000000f8';
SELECT is(public.t121_n('folders', '12100000-0000-0000-0000-0000000000f8'), 0, 'nor a rename of it');
DELETE FROM public.folders WHERE id = '12100000-0000-0000-0000-0000000000f8';
SELECT is(public.t121_n('folders', '12100000-0000-0000-0000-0000000000f8'), 0, 'nor its delete');
DELETE FROM public.folders WHERE id = '12100000-0000-0000-0000-0000000000f7';
SELECT is(public.t121_n('folders', '12100000-0000-0000-0000-0000000000f7'), 0, 'nor the delete of the category itself, with no row left to walk from');
-- A path alone says money, with no such category in the project.
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES ('12100000-0000-0000-0000-0000000000c6', 'aaaa1210-0000-0000-0000-00000000000a', '12100000-0000-0000-0000-0000000000f0', 'category', 'plainly', 'LEGAL/plainly');
SELECT is(public.t121_n('folders', '12100000-0000-0000-0000-0000000000c6'), 0, 'a path that begins with a money word writes nothing, whatever its slug');
-- A parent alone says money, with a path that does not.
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES ('12100000-0000-0000-0000-0000000000c7', 'aaaa1210-0000-0000-0000-00000000000a', '12100000-0000-0000-0000-0000000000f3', 'custom', 'z', 'elsewhere/z');
SELECT is(public.t121_n('folders', '12100000-0000-0000-0000-0000000000c7'), 0, 'a parent under money writes nothing, whatever the path says');
-- A mark sharing a file's id, and the receipts' redaction.
SELECT public.t121_file('12100000-0000-0000-0000-000000000209', 'aaaa1210-0000-0000-0000-00000000000a', 'mark-id.pdf');
INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, mark_kind) VALUES ('11111111-1111-1111-1111-111111111111', 'files', '12100000-0000-0000-0000-000000000209', 'mark_recording', 'suspended');
INSERT INTO public.expenses (id, workspace_id, project_id, file_ids) VALUES ('12100000-0000-0000-0000-0000000000e3', '11111111-1111-1111-1111-111111111111', 'aaaa1210-0000-0000-0000-00000000000a', ARRAY['12100000-0000-0000-0000-000000000209'::uuid]);
SELECT is((SELECT count(*)::int FROM public.moth_history h WHERE h.entity_id = '12100000-0000-0000-0000-000000000209' AND h.action = 'create' AND h.locked), 1, 'naming a file redacts it, with a mark sharing its id left standing');
DELETE FROM public.moth_history WHERE entity_id = '12100000-0000-0000-0000-000000000209' AND mark_kind = 'suspended';
-- Below a money category, with the folder between deleted: the cascade finds no walk, and its path still says.
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES ('12100000-0000-0000-0000-0000000000c3', 'aaaa1210-0000-0000-0000-00000000000a', '12100000-0000-0000-0000-0000000000f0', 'category', 'invoices', 'Receipts-y');
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES ('12100000-0000-0000-0000-0000000000c4', 'aaaa1210-0000-0000-0000-00000000000a', '12100000-0000-0000-0000-0000000000c3', 'custom', 'c', 'Receipts-y/c');
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES ('12100000-0000-0000-0000-0000000000c5', 'aaaa1210-0000-0000-0000-00000000000a', '12100000-0000-0000-0000-0000000000c4', 'custom', 'd', 'Receipts-y/c/d');
DELETE FROM public.folders WHERE id = '12100000-0000-0000-0000-0000000000c4';
SELECT is(public.t121_n('folders', '12100000-0000-0000-0000-0000000000c5'), 0, 'a folder gone with its parent, under a renamed money category, writes nothing');
-- A file that moved in and became a receipt with no write to it, its project then purged: older rows on the other side go blank.
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private) VALUES
  ('aaaa1210-0000-0000-0000-000000000016', '11111111-1111-1111-1111-111111111111', 'Soon Purged', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
SELECT public.t121_file('12100000-0000-0000-0000-000000000207', 'aaaa1210-0000-0000-0000-00000000000b', 'becomes-receipt.pdf');
UPDATE public.files SET project_id = 'aaaa1210-0000-0000-0000-000000000016' WHERE id = '12100000-0000-0000-0000-000000000207';
INSERT INTO public.expenses (id, workspace_id, project_id, file_ids) VALUES
  ('12100000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111', 'aaaa1210-0000-0000-0000-000000000016', ARRAY['12100000-0000-0000-0000-000000000207'::uuid]);
SELECT is((SELECT count(*)::int FROM public.moth_history h WHERE h.entity_id = '12100000-0000-0000-0000-000000000207' AND h.locked AND h.prior IS NULL AND h.state IS NULL), 2, 'an expense naming it blanks its two rows at once');
DELETE FROM public.projects WHERE id = 'aaaa1210-0000-0000-0000-000000000016';
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000207'), 2, 'its project purged: they stay blank, and no row is added');
SET LOCAL ROLE authenticated;
SELECT public.t121_c();
SELECT is(public.t121_read('12100000-0000-0000-0000-000000000207'), 0, 'and a member of its old project reads none');
RESET ROLE;
SELECT public.t121_a();
-- A planted id equal to the company's: redaction still works, and leaves the marks alone.
INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, mark_kind) VALUES ('11111111-1111-1111-1111-111111111111', 'files', '11111111-1111-1111-1111-111111111111', 'mark_recording', 'suspended');
SELECT public.t121_file('11111111-1111-1111-1111-111111111111', 'aaaa1210-0000-0000-0000-00000000000a', 'same-id.mov');
SELECT is((SELECT count(*)::int FROM public.moth_history h WHERE h.entity_id = '11111111-1111-1111-1111-111111111111' AND h.entity_type = 'files' AND h.action = 'create'), 1, 'a file with its company''s id is recorded');
UPDATE public.files SET is_financial = true WHERE id = '11111111-1111-1111-1111-111111111111';
SELECT is((SELECT count(*)::int FROM public.moth_history h WHERE h.entity_id = '11111111-1111-1111-1111-111111111111' AND h.entity_type = 'files' AND h.action = 'create' AND h.locked), 1, 'and redacted, because the mark sharing its id is not touched');
SELECT is((SELECT count(*)::int FROM public.moth_history h WHERE h.entity_id = '11111111-1111-1111-1111-111111111111' AND h.entity_type = 'files' AND h.action = 'mark_recording' AND NOT h.locked), 1, 'which still stands');
DELETE FROM public.files WHERE id = '11111111-1111-1111-1111-111111111111';
DELETE FROM public.moth_history WHERE entity_id = '11111111-1111-1111-1111-111111111111' AND mark_kind = 'suspended';

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
SELECT public.t121_file('12100000-0000-0000-0000-000000000208', 'aaaa1210-0000-0000-0000-00000000000a', 'linked-later.pdf');
INSERT INTO public.expenses (id, workspace_id, project_id, file_ids) VALUES
  ('12100000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111', 'aaaa1210-0000-0000-0000-00000000000a', ARRAY['12100000-0000-0000-0000-000000000205'::uuid]);
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000205', 'create'), 1, 'a file an expense has named since, with no write to the file');
SELECT is((public.t121_last('files', '12100000-0000-0000-0000-000000000205')).locked, true, 'is blanked by the expense');
UPDATE public.expenses SET file_ids = ARRAY['12100000-0000-0000-0000-000000000208'::uuid, '12100000-0000-0000-0000-000000000205'::uuid] WHERE id = '12100000-0000-0000-0000-0000000000e1';
SELECT is((public.t121_last('files', '12100000-0000-0000-0000-000000000208')).locked, true, 'and one added to it later, at once');
SET LOCAL ROLE authenticated;
SELECT public.t121_a();
SELECT is(public.t121_read('12100000-0000-0000-0000-000000000205'), 0, 'and an admin reads none of it');
SELECT is(public.t121_read('12100000-0000-0000-0000-000000000208'), 0, 'nor of one added to an expense later');
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
SELECT throws_ok($$ INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, prior_class) VALUES ('11111111-1111-1111-1111-111111111111', 'files', gen_random_uuid(), 'update', 'personal') $$, '23514', 'new row for relation "moth_history" violates check constraint "moth_history_c_class_chk"', 'the prior side too');
SELECT throws_ok($$ INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, prior_class, prior_owner_id) VALUES ('11111111-1111-1111-1111-111111111111', 'files', gen_random_uuid(), 'update', 'shared', gen_random_uuid()) $$, '23514', 'new row for relation "moth_history" violates check constraint "moth_history_c_class_chk"', 'shared with an owner, before');
SELECT throws_ok($$ INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, state_class) VALUES ('11111111-1111-1111-1111-111111111111', 'files', gen_random_uuid(), 'update', 'public') $$, '23514', 'new row for relation "moth_history" violates check constraint "moth_history_c_class_chk"', 'a class that is none');
SELECT throws_ok($$ INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, prior_project_id) VALUES ('11111111-1111-1111-1111-111111111111', 'files', gen_random_uuid(), 'create', gen_random_uuid()) $$, '23514', 'new row for relation "moth_history" violates check constraint "moth_history_d_shape_chk"', 'a create from a project');
SELECT throws_ok($$ INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, state_project_id) VALUES ('11111111-1111-1111-1111-111111111111', 'files', gen_random_uuid(), 'delete', gen_random_uuid()) $$, '23514', 'new row for relation "moth_history" violates check constraint "moth_history_d_shape_chk"', 'a delete into a project');
SELECT throws_ok($$ INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, mark_kind, state) VALUES ('11111111-1111-1111-1111-111111111111', 'files', gen_random_uuid(), 'mark_recording', 'baseline', '{"name":"x"}') $$, '23514', 'new row for relation "moth_history" violates check constraint "moth_history_d_shape_chk"', 'a mark that says something');
SELECT throws_ok($$ INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, mark_kind, actor_user_id) VALUES ('11111111-1111-1111-1111-111111111111', 'files', gen_random_uuid(), 'mark_recording', 'baseline', gen_random_uuid()) $$, '23514', 'new row for relation "moth_history" violates check constraint "moth_history_d_shape_chk"', 'a mark with an actor');
SELECT throws_ok($$ INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, mark_kind, prior_project_id) VALUES ('11111111-1111-1111-1111-111111111111', 'files', gen_random_uuid(), 'mark_recording', 'suspended', gen_random_uuid()) $$, '23514', 'new row for relation "moth_history" violates check constraint "moth_history_d_shape_chk"', 'a suspension scoped to a project');
SELECT throws_ok($$ INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, locked, prior) VALUES ('11111111-1111-1111-1111-111111111111', 'files', gen_random_uuid(), 'update', true, '{"name":"x"}') $$, '23514', 'new row for relation "moth_history" violates check constraint "moth_history_e_locked_chk"', 'a locked row with a before');
SELECT throws_ok($$ INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, prior) VALUES ('11111111-1111-1111-1111-111111111111', 'files', gen_random_uuid(), 'update', '{"storage_path":"x"}') $$, '23514', 'new row for relation "moth_history" violates check constraint "moth_history_f_projection_chk"', 'a locator before');
SELECT lives_ok($$ INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, mark_kind, state_project_id) VALUES ('11111111-1111-1111-1111-111111111111', 'files', '11111111-1111-1111-1111-111111111111', 'mark_recording', 'capture_failed', 'aaaa1210-0000-0000-0000-00000000000a') $$, 'CONTROL: a restart may name its project');
DELETE FROM public.moth_history WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND mark_kind = 'capture_failed';
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
SELECT is((SELECT count(*)::int FROM public.moth_history_read('aaaa1210-0000-0000-0000-00000000000b', now() - interval '200 days') x WHERE x.observed_at < now() - interval '90 days'), 0, 'a since older than 90 days reads as 90');
RESET ROLE;
-- A read of a row that shows both sides, by value.
SELECT public.t121_file('12100000-0000-0000-0000-000000000304', 'aaaa1210-0000-0000-0000-00000000000a', 'both.mov');
SELECT public.t121_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user');
UPDATE public.files SET project_id = 'aaaa1210-0000-0000-0000-00000000000b' WHERE id = '12100000-0000-0000-0000-000000000304';
SELECT public.t121_a();
SET LOCAL ROLE authenticated;
SELECT public.t121_c();
SELECT is((SELECT row(x.action, x.prior_project_id, x.state_project_id, x.prior ->> 'name', x.state ->> 'name', x.actor_user_id)::text FROM public.moth_history_read() x WHERE x.entity_id = '12100000-0000-0000-0000-000000000304' AND x.action = 'moved'),
  '(moved,aaaa1210-0000-0000-0000-00000000000a,aaaa1210-0000-0000-0000-00000000000b,both.mov,both.mov,eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee)', 'each column of a move, by value');
SELECT is((SELECT array_agg(x.action) FROM public.moth_history_read('aaaa1210-0000-0000-0000-00000000000a') x WHERE x.entity_id = '12100000-0000-0000-0000-000000000304'), ARRAY['moved', 'added'], 'a source project still reads a file that left it, newest first');
RESET ROLE;
-- Each kind of thing, read back; a thing whose row has gone; a project before its trash.
SET LOCAL ROLE authenticated;
SELECT public.t121_c();
SELECT is((SELECT array_agg(DISTINCT x.entity_type ORDER BY x.entity_type) FROM public.moth_history_read('aaaa1210-0000-0000-0000-00000000000a') x WHERE x.entity_type <> 'projects'), ARRAY['assets', 'experiences', 'files', 'folders', 'levels', 'phases', 'scenes', 'shots', 'task_items', 'tasks'], 'a member reads every kind of thing in a project');
SELECT is(public.t121_read('aaaa1210-0000-0000-0000-00000000000a') >= 1, true, 'the project itself');
SELECT is((SELECT array_agg(DISTINCT x.action) FROM public.moth_history_read('aaaa1210-0000-0000-0000-00000000000a') x WHERE x.entity_id = '12100000-0000-0000-0000-0000000000b3' AND x.action = 'removed'), ARRAY['removed'], 'a level deleted reads as removed');
SELECT is((SELECT count(*)::int FROM public.moth_history_read('aaaa1210-0000-0000-0000-00000000000a') x WHERE x.entity_id = '12100000-0000-0000-0000-0000000000b3' AND x.action = 'removed' AND x.state IS NULL AND x.state_project_id IS NULL AND x.prior ->> 'name' = 'Level 2'), 1, 'with what it was, and nothing after');
SELECT is((SELECT count(*)::int FROM public.moth_history_read('aaaa1210-0000-0000-0000-00000000000a') x WHERE x.entity_id = '12100000-0000-0000-0000-0000000000a1' AND x.action = 'removed'), 1, 'a phase deleted too');
RESET ROLE;
-- Pages are by row, strictly older, however many share a moment.
SELECT is((SELECT count(*)::int FROM (SELECT DISTINCT observed_at FROM public.moth_history WHERE entity_id = '12100000-0000-0000-0000-000000000303') t), 1, 'CONTROL: these rows share one moment, as a transaction''s do');
SET LOCAL ROLE authenticated;
SELECT public.t121_c();
CREATE TEMP TABLE t121_page ON COMMIT DROP AS SELECT row_number() OVER () AS n, x.row_key FROM public.moth_history_read('aaaa1210-0000-0000-0000-00000000000b', NULL, NULL, 5000) x;
GRANT ALL ON t121_page TO authenticated;
SELECT ok((SELECT count(*) FROM t121_page) > 5, 'CONTROL: this page has rows that share one moment');
SELECT is(public.t121_walk('aaaa1210-0000-0000-0000-00000000000b'), (SELECT array_agg(row_key ORDER BY n) FROM t121_page), 'walked one row at a time, it is the same rows in the same order');
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
-- Shared, then closed: who passes the gate only for one side reads that side.
SELECT public.t121_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private) VALUES
  ('aaaa1210-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', 'Soon Closed', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', false);
SELECT public.t121_file('12100000-0000-0000-0000-000000000403', 'aaaa1210-0000-0000-0000-000000000014', 'closing.mov');
UPDATE public.files SET project_id = 'aaaa1210-0000-0000-0000-00000000000b' WHERE id = '12100000-0000-0000-0000-000000000403';
UPDATE public.projects SET is_private = true WHERE id = 'aaaa1210-0000-0000-0000-000000000014';
SET LOCAL ROLE authenticated;
SELECT public.t121_c();
SELECT is((SELECT array_agg(x.action) FROM public.moth_history_read() x WHERE x.entity_id = '12100000-0000-0000-0000-000000000403'), ARRAY['added'], 'its old project closed since: a member of the new one sees it added');
SELECT is((SELECT row(x.prior, x.prior_project_id)::text FROM public.moth_history_read() x WHERE x.entity_id = '12100000-0000-0000-0000-000000000403'), '(,)', 'with nothing of the old one');
SELECT public.t121_e();
SELECT is((SELECT count(*)::int FROM public.moth_history_read() x WHERE x.entity_id = '12100000-0000-0000-0000-000000000403' AND x.action = 'moved'), 1, 'CONTROL: its creator reads the move');
RESET ROLE;
-- Its old project trashed since: the same, because the gate asks more than privacy.
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private) VALUES
  ('aaaa1210-0000-0000-0000-000000000015', '11111111-1111-1111-1111-111111111111', 'Soon Trashed', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
SELECT public.t121_a();
SELECT public.t121_file('12100000-0000-0000-0000-000000000405', 'aaaa1210-0000-0000-0000-000000000015', 'leaving.mov');
UPDATE public.files SET project_id = 'aaaa1210-0000-0000-0000-00000000000b' WHERE id = '12100000-0000-0000-0000-000000000405';
UPDATE public.projects SET deleted_at = now() WHERE id = 'aaaa1210-0000-0000-0000-000000000015';
SET LOCAL ROLE authenticated;
SELECT public.t121_c();
SELECT is((SELECT array_agg(x.action) FROM public.moth_history_read() x WHERE x.entity_id = '12100000-0000-0000-0000-000000000405'), ARRAY['added'], 'its old project trashed since: a member sees it added');
RESET ROLE;
-- A parent that locks with no write to the child: the live gate hides the child's rows.
SELECT public.t121_a();
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('12100000-0000-0000-0000-0000000000fd', 'aaaa1210-0000-0000-0000-00000000000a', '12100000-0000-0000-0000-0000000000f0', 'category', 'plain', 'plain'),
  ('12100000-0000-0000-0000-0000000000fe', 'aaaa1210-0000-0000-0000-00000000000a', '12100000-0000-0000-0000-0000000000fd', 'custom', 'child', 'plain/child');
SELECT public.t121_file('12100000-0000-0000-0000-000000000406', 'aaaa1210-0000-0000-0000-00000000000a', 'in-child.mov', '12100000-0000-0000-0000-0000000000fe');
SET LOCAL ROLE authenticated;
SELECT public.t121_c();
SELECT is(public.t121_read('12100000-0000-0000-0000-0000000000fe'), 1, 'CONTROL: a folder''s row reads');
SELECT is(public.t121_read('12100000-0000-0000-0000-000000000406'), 1, 'CONTROL: and a file''s in it');
RESET ROLE;
UPDATE public.folders SET slug = 'invoices' WHERE id = '12100000-0000-0000-0000-0000000000fd';
SET LOCAL ROLE authenticated;
SELECT public.t121_c();
SELECT is(public.t121_read('12100000-0000-0000-0000-0000000000fe'), 0, 'its parent locked since: the live gate hides it, with no write to it');
SELECT is(public.t121_read('12100000-0000-0000-0000-000000000406'), 0, 'and the file in it');
RESET ROLE;
-- A folder that has gone is left to its sides.
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES ('12100000-0000-0000-0000-0000000000ff', 'aaaa1210-0000-0000-0000-00000000000a', '12100000-0000-0000-0000-0000000000f0', 'category', 'gone', 'gone-now');
DELETE FROM public.folders WHERE id = '12100000-0000-0000-0000-0000000000ff';
SET LOCAL ROLE authenticated;
SELECT public.t121_c();
SELECT is((SELECT count(*)::int FROM public.moth_history_read() x WHERE x.entity_id = '12100000-0000-0000-0000-0000000000ff' AND x.action = 'removed'), 1, 'a folder deleted reads as removed');
RESET ROLE;

-- Through a private project and out: each half shows the side a member can see.
SELECT public.t121_a();
SELECT public.t121_file('12100000-0000-0000-0000-000000000404', 'aaaa1210-0000-0000-0000-00000000000a', 'through.mov');
UPDATE public.files SET project_id = 'aaaa1210-0000-0000-0000-00000000000d' WHERE id = '12100000-0000-0000-0000-000000000404';
UPDATE public.files SET project_id = 'aaaa1210-0000-0000-0000-00000000000b' WHERE id = '12100000-0000-0000-0000-000000000404';
SET LOCAL ROLE authenticated;
SELECT public.t121_c();
SELECT is((SELECT count(*)::int FROM public.moth_history_read() x WHERE x.entity_id = '12100000-0000-0000-0000-000000000404' AND x.action = 'removed' AND x.state IS NULL AND x.state_project_id IS NULL AND x.prior_project_id = 'aaaa1210-0000-0000-0000-00000000000a'), 1, 'going in reads as removed, with no word of where');
SELECT is((SELECT count(*)::int FROM public.moth_history_read() x WHERE x.entity_id = '12100000-0000-0000-0000-000000000404' AND x.action = 'added' AND x.prior IS NULL AND x.prior_project_id IS NULL AND x.state_project_id = 'aaaa1210-0000-0000-0000-00000000000b' AND x.state ->> 'name' = 'through.mov'), 1, 'coming out reads as added, with no word of where');
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
UPDATE public.projects SET deleted_at = NULL WHERE id = 'aaaa1210-0000-0000-0000-000000000013';
SET LOCAL ROLE authenticated;
SELECT is(public.t121_read('aaaa1210-0000-0000-0000-000000000013') >= 2, true, 'CONTROL: restored, it reads again');
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
-- Each side of a mark asks, for itself.
INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, mark_kind, prior_project_id, prior_class, prior_owner_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 'levels', '11111111-1111-1111-1111-111111111111', 'mark_recording', 'capture_failed', 'aaaa1210-0000-0000-0000-00000000000b', 'shared', NULL),
  ('11111111-1111-1111-1111-111111111111', 'experiences', '11111111-1111-1111-1111-111111111111', 'mark_recording', 'capture_failed', 'aaaa1210-0000-0000-0000-00000000000b', 'private', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, mark_kind, state_project_id, state_class, observed_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'shots', '11111111-1111-1111-1111-111111111111', 'mark_recording', 'capture_failed', 'aaaa1210-0000-0000-0000-00000000000b', 'shared', now() - interval '120 days');
INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, mark_kind, state_project_id, state_class, state_owner_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 'scenes', '11111111-1111-1111-1111-111111111111', 'mark_recording', 'capture_failed', 'aaaa1210-0000-0000-0000-00000000000d', 'shared', NULL);
SET LOCAL ROLE authenticated;
SELECT public.t121_c();
SELECT is((SELECT count(*)::int FROM public.moth_history_window() w WHERE w.entity_type = 'levels' AND w.project_id = 'aaaa1210-0000-0000-0000-00000000000b'), 1, 'a restart on the side it left shows too');
SELECT is((SELECT count(*)::int FROM public.moth_history_window() w WHERE w.entity_type = 'experiences' AND w.project_id = 'aaaa1210-0000-0000-0000-00000000000b'), 0, 'one from when that project was private does not, to a member');
SELECT is((SELECT count(*)::int FROM public.moth_history_window() w WHERE w.entity_type = 'shots' AND w.project_id = 'aaaa1210-0000-0000-0000-00000000000b'), 0, 'one older than the type''s start adds nothing');
SELECT is((SELECT count(*)::int FROM public.moth_history_window() w WHERE w.entity_type = 'scenes' AND w.project_id = 'aaaa1210-0000-0000-0000-00000000000d'), 0, 'one on a project they cannot see now does not');
SELECT public.t121_e();
SELECT is((SELECT count(*)::int FROM public.moth_history_window() w WHERE w.entity_type = 'experiences' AND w.project_id = 'aaaa1210-0000-0000-0000-00000000000b'), 1, 'CONTROL: its creator sees it');
SELECT is((SELECT count(*)::int FROM public.moth_history_window() w WHERE w.entity_type = 'scenes' AND w.project_id = 'aaaa1210-0000-0000-0000-00000000000d'), 1, 'and hers');
RESET ROLE;
-- A mark that fails too: the write still goes on.
ALTER TABLE public.moth_history DROP CONSTRAINT moth_history_a_action_chk;
ALTER TABLE public.moth_history ADD CONSTRAINT moth_history_a_action_chk CHECK (action IN ('create', 'update', 'move', 'trash', 'restore', 'delete')) NOT VALID;
SELECT lives_ok($$ INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES ('12100000-0000-0000-0000-0000000000f9', 'aaaa1210-0000-0000-0000-00000000000a', '12100000-0000-0000-0000-0000000000f0', 'category', 'failing-twice', 'failing-twice') $$, 'with its capture and its mark both refused, a folder still goes in');
SELECT is((SELECT count(*)::int FROM public.folders WHERE id = '12100000-0000-0000-0000-0000000000f9'), 1, 'it is there');
ALTER TABLE public.moth_history DROP CONSTRAINT moth_history_a_action_chk;
ALTER TABLE public.moth_history ADD CONSTRAINT moth_history_a_action_chk CHECK (action IN ('create', 'update', 'move', 'trash', 'restore', 'delete', 'mark_recording'));

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
  ('11111111-1111-1111-1111-111111111111', 'files', '12100000-0000-0000-0000-000000000501', 'update', now() - interval '90 days 1 hour', 'aaaa1210-0000-0000-0000-00000000000a', 'shared', '{"name":"old"}'),
  ('11111111-1111-1111-1111-111111111111', 'files', '12100000-0000-0000-0000-000000000502', 'update', now() - interval '89 days 23 hours', 'aaaa1210-0000-0000-0000-00000000000a', 'shared', '{"name":"kept"}');
INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, state_project_id, state_class, state) VALUES
  ('11111111-1111-1111-1111-111111111111', 'files', '12100000-0000-0000-0000-000000000503', 'update', 'aaaa1210-0000-0000-0000-00000000000a', NULL, '{"name":"nobody knows who for"}');
INSERT INTO public.moth_history (row_key, workspace_id, entity_type, entity_id, action, state_project_id, state_class, state) VALUES
  ('12100000-0000-0000-0000-000000000b0b', '22222222-2222-2222-2222-222222222222', 'files', '12100000-0000-0000-0000-000000000504', 'update', NULL, 'shared', '{"name":"theirs"}');
SET LOCAL ROLE authenticated;
SELECT public.t121_c();
SELECT is(public.t121_read('12100000-0000-0000-0000-000000000503'), 0, 'a side nobody can say who for shows nobody');
SELECT throws_ok($$ SELECT * FROM public.moth_history_read(NULL, NULL, '12100000-0000-0000-0000-000000000b0b') $$, '42501', 'that history is not available', 'another company''s page reads as one that was never there');
SELECT is((SELECT count(*)::int FROM public.moth_history_read() x WHERE x.entity_id = '11111111-1111-1111-1111-111111111111'), 0, 'a mark is not a change, and is not read as one');
SELECT is((SELECT count(*)::int FROM public.moth_history_read(NULL, now() - interval '200 days') x WHERE x.entity_id = '12100000-0000-0000-0000-000000000501'), 0, 'an older since is still 90 days');
SELECT is(public.t121_read('12100000-0000-0000-0000-000000000501'), 0, 'older than 90 days reads as nothing even before the purge');
SELECT is(public.t121_read('12100000-0000-0000-0000-000000000502'), 1, 'CONTROL: just inside them does');
SELECT throws_ok($$ SELECT public.purge_moth_history() $$, '42501', NULL, 'a client cannot purge');
RESET ROLE;
SELECT throws_ok($$ SELECT public.purge_moth_history(interval '23 hours') $$, 'P0001', 'purge_moth_history: a retention under one day is refused', 'a retention under a day is refused');
SELECT is((SELECT public.purge_moth_history() >= 1), true, 'the purge says what it took');
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000501'), 0, 'just over 90 days is gone');
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000502'), 1, 'just under is kept');


-- ── I2. More than a batch ───────────────────────────────────────────────────
-- The newest 2,100 are in a private project, and older than them 5,200 anyone may read.
INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, observed_at, state_project_id, state_class, state_owner_id, state)
SELECT '11111111-1111-1111-1111-111111111111', 'files', gen_random_uuid(), 'update', now() + make_interval(mins => 10) - make_interval(secs => g),
       'aaaa1210-0000-0000-0000-00000000000d', 'private', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', jsonb_build_object('name', 'hidden ' || g)
  FROM generate_series(1, 2100) g;
INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, observed_at, state_project_id, state_class, state)
SELECT '11111111-1111-1111-1111-111111111111', 'files', gen_random_uuid(), 'update', now() + make_interval(mins => 5) - make_interval(secs => g / 100.0),
       'aaaa1210-0000-0000-0000-00000000000a', 'shared', jsonb_build_object('name', 'open ' || g)
  FROM generate_series(1, 5200) g;
SET LOCAL ROLE authenticated;
SELECT public.t121_c();
SELECT is((SELECT count(*)::int FROM public.moth_history_read(NULL, NULL, NULL, 10) x), 10, 'past a whole batch it cannot see, a member still gets what it asked for, and no more');
SELECT is((SELECT min(x.state ->> 'name') FROM public.moth_history_read(NULL, NULL, NULL, 1) x), 'open 1', 'the newest it may see');
SELECT is((SELECT count(*)::int FROM public.moth_history_read(NULL, NULL, NULL, 6000) x), 5000, 'and no more than 5,000 whatever it asks');
SELECT public.t121_e();
SELECT is((SELECT x.state ->> 'name' FROM public.moth_history_read(NULL, NULL, NULL, 1) x), 'hidden 1', 'its creator gets the newest of all: a batch is the newest first');
RESET ROLE;
DELETE FROM public.moth_history WHERE observed_at > now();


-- ── J. A company going away ─────────────────────────────────────────────────
INSERT INTO public.workspaces (id, name, slug) VALUES ('33333333-1210-3333-3333-333333333333', 'Doomed Studio', 'ws-doomed-121');
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private) VALUES
  ('aaaa1210-0000-0000-0000-000000000033', '33333333-1210-3333-3333-333333333333', 'Doomed', NULL, false);
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path) VALUES
  ('12100000-0000-0000-0000-000000000601', 'aaaa1210-0000-0000-0000-000000000033', 'doomed.mov', 'local_server', 'projects/aaaa1210-0000-0000-0000-000000000033/files/12100000-0000-0000-0000-000000000601/doomed.mov');
INSERT INTO public.phases (id, project_id, name) VALUES ('12100000-0000-0000-0000-0000000000c1', 'aaaa1210-0000-0000-0000-000000000033', 'Doomed phase');
SELECT is((SELECT count(*)::int FROM public.moth_history WHERE workspace_id = '33333333-1210-3333-3333-333333333333'), 3, 'a company with a project, a file and a phase has three rows, under claims naming another company');
SELECT is(public.t121_n('phases', '12100000-0000-0000-0000-0000000000c1', 'create'), 1, 'a phase finds its own company, whoever is asking');
SELECT is((public.t121_last('phases', '12100000-0000-0000-0000-0000000000c1')).workspace_id, '33333333-1210-3333-3333-333333333333'::uuid, 'not the caller''s');
-- Claims that do not even parse: nothing here may read them.
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private) VALUES ('aaaa1210-0000-0000-0000-000000000034', '33333333-1210-3333-3333-333333333333', 'Doomed Too', NULL, false);
INSERT INTO public.phases (id, project_id, name) VALUES ('12100000-0000-0000-0000-0000000000c2', 'aaaa1210-0000-0000-0000-000000000034', 'Its phase');
INSERT INTO public.files (id, project_id, workspace_id, name, storage_provider, storage_path) VALUES
  ('12100000-0000-0000-0000-000000000602', 'aaaa1210-0000-0000-0000-000000000034', '33333333-1210-3333-3333-333333333333', 'its.mov', 'local_server', 'projects/aaaa1210-0000-0000-0000-000000000034/files/12100000-0000-0000-0000-000000000602/its.mov');
SELECT set_config('request.jwt.claims', '', true);
SELECT lives_ok($$ DELETE FROM public.projects WHERE id = 'aaaa1210-0000-0000-0000-000000000034' $$, 'deleting a project with a phase, with no claims to read');
SELECT is(public.t121_n('phases', '12100000-0000-0000-0000-0000000000c2', 'delete'), 0, 'a child of a project that has gone writes no row: nobody could read it');
SELECT is(public.t121_n('files', '12100000-0000-0000-0000-000000000602', 'delete'), 0, 'nor one that knows its own company');
SELECT is(public.t121_n('projects', 'aaaa1210-0000-0000-0000-000000000034', 'delete'), 1, 'the project''s own delete does');
SELECT public.t121_a();
SELECT lives_ok($$ DELETE FROM public.workspaces WHERE id = '33333333-1210-3333-3333-333333333333' $$, 'deleting the company still works');
SELECT is((SELECT count(*)::int FROM public.moth_history WHERE workspace_id = '33333333-1210-3333-3333-333333333333'), 0, 'and leaves no rows');
SELECT is((SELECT count(*)::int FROM public.moth_history WHERE entity_id = '12100000-0000-0000-0000-000000000601'), 0, 'not one, under any company');

SELECT * FROM finish();
ROLLBACK;
