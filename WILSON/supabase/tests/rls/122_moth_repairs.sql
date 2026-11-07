-- =============================================================================
-- 122_moth_repairs.sql — M.O.T.H. Session 1 (MO1), what the whole-session review found (0121).
--
-- Her two answers: an admin moves a former member's personal files into a project; members see only
-- full or nearly full. The repairs: one refused project holds back that project only; an admin may
-- call off what a person who has left began; an adopt's old picture goes when it can no longer come
-- back; an operation left past the retention does not hold a row in the bin for ever; the read path
-- says what the last check did not find. Table-less.
--
-- Fixture ids: projects aaaa1220-…, files 12200000-…
-- user_a (rls_setup) is the admin; user_c a plain member; user_d a workspace manager; user_e an active
-- member with a personal space; user_n has left and has a personal space.
-- =============================================================================

BEGIN;

SELECT plan(110);

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
    ('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, 'user_n@test.local')) u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager', 'user_d', 'User D', true),
  ('11111111-1111-1111-1111-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user', 'user_e', 'User E', true),
  ('11111111-1111-1111-1111-111111111111', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'user', 'user_n', 'User N', false)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET is_active = EXCLUDED.is_active;

CREATE FUNCTION public.t122_as(p_user uuid, p_role text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', p_role))::text, true);
END;
$f$;
CREATE FUNCTION public.t122_a() RETURNS void LANGUAGE sql AS $f$ SELECT public.t122_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin') $f$;
CREATE FUNCTION public.t122_c() RETURNS void LANGUAGE sql AS $f$ SELECT public.t122_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user') $f$;
CREATE FUNCTION public.t122_d() RETURNS void LANGUAGE sql AS $f$ SELECT public.t122_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager') $f$;
CREATE FUNCTION public.t122_e() RETURNS void LANGUAGE sql AS $f$ SELECT public.t122_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user') $f$;
CREATE FUNCTION public.t122_n() RETURNS void LANGUAGE sql AS $f$ SELECT public.t122_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'user') $f$;

CREATE FUNCTION public.t122_file(p_id uuid, p_project uuid, p_name text, p_thumb boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_key text := 'projects/' || p_project || '/files/' || p_id || '/' || p_name;
BEGIN
  INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('rabbit-files', v_key, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, thumbnail_url)
  VALUES (p_id, p_project, p_name, 'supabase', v_key, CASE WHEN p_thumb THEN v_key || '.jpg' END);
END;
$f$;
CREATE FUNCTION public.t122_share(p_id uuid, p_project uuid, p_loc text)
RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, size_bytes, source_modified_at)
  VALUES (p_id, p_project, regexp_replace(p_loc, '^.*/', ''), 'network_share', 'nas:' || p_loc, 1, '2026-10-01T10:00:00Z');
$f$;
CREATE FUNCTION public.t122_leave(p_ids uuid[], p_dest uuid, p_plan boolean DEFAULT false, p_bodies jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $f$ SELECT public.moth_move_leaver_files(p_ids, p_dest, NULL, p_plan, p_bodies) $f$;

-- A refusal's sentence, where it holds figures a probe should not pin.
CREATE FUNCTION public.t122_err(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  d text;
BEGIN
  EXECUTE p_sql;
  RETURN 'no refusal';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS d = MESSAGE_TEXT;
  RETURN d;
END;
$f$;

CREATE TEMP TABLE t122_ret (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON t122_ret TO authenticated;
CREATE FUNCTION public.t122_v(p_key text) RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT v FROM t122_ret WHERE k = p_key $f$;

SELECT public.t122_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1220-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Salt Hours', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1220-0000-0000-0000-0000000000a0', '11111111-1111-1111-1111-111111111111', 'Personal space', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('aaaa1220-0000-0000-0000-0000000000e0', '11111111-1111-1111-1111-111111111111', 'Personal space', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  ('aaaa1220-0000-0000-0000-0000000000f0', '11111111-1111-1111-1111-111111111111', 'Personal space', 'ffffffff-ffff-ffff-ffff-ffffffffffff', true, 'ffffffff-ffff-ffff-ffff-ffffffffffff');

INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1220-0000-0000-0000-00000000000a', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT DO NOTHING;

SELECT public.t122_file('12200000-0000-0000-0000-000000000001', 'aaaa1220-0000-0000-0000-0000000000f0', 'keep.mov', true);
INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('rabbit-files', 'projects/aaaa1220-0000-0000-0000-0000000000f0/LEGAL/legal.pdf', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, tags)
VALUES ('12200000-0000-0000-0000-000000000002', 'aaaa1220-0000-0000-0000-0000000000f0', 'legal.pdf', 'supabase', 'projects/aaaa1220-0000-0000-0000-0000000000f0/LEGAL/legal.pdf', ARRAY['legal']);
SELECT public.t122_file('12200000-0000-0000-0000-000000000003', 'aaaa1220-0000-0000-0000-0000000000e0', 'theirs.mov');
SELECT public.t122_file('12200000-0000-0000-0000-000000000004', 'aaaa1220-0000-0000-0000-0000000000f0', 'also.mov');
SELECT public.t122_file('12200000-0000-0000-0000-000000000005', 'aaaa1220-0000-0000-0000-0000000000f0', 'binned.mov');
UPDATE public.files SET deleted_at = now() WHERE id = '12200000-0000-0000-0000-000000000005';

-- ── A. Who may call ─────────────────────────────────────────────────────────
SELECT ok(has_function_privilege('authenticated', 'public.moth_move_leaver_files(uuid[],uuid,uuid,boolean,jsonb)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.moth_move_leaver_files(uuid[],uuid,uuid,boolean,jsonb)', 'EXECUTE'),
  'the move is for signed-in callers');
SELECT ok(has_function_privilege('authenticated', 'public.moth_leaver_files(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.moth_leaver_files(uuid)', 'EXECUTE'),
  'the list is for signed-in callers');
SELECT ok(NOT has_function_privilege('authenticated', 'rabbit_private.personal_space_of_a_leaver(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'rabbit_private.personal_space_of_a_leaver(uuid)', 'EXECUTE'),
  'who has left is asked by definers only');
SELECT ok(NOT has_function_privilege('authenticated', 'public._network_share_may_call_off(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public._network_share_may_call_off(uuid)', 'EXECUTE'),
  'and so is who may call off');

-- ── B. The list ─────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t122_a();
SELECT is((SELECT string_agg(name, ',' ORDER BY name) FROM public.moth_leaver_files('aaaa1220-0000-0000-0000-0000000000f0')), 'also.mov,keep.mov',
  'an admin is offered what has not been binned, and no Legal file');
SELECT is((SELECT count(*)::int FROM public.moth_leaver_files('aaaa1220-0000-0000-0000-0000000000e0')), 0,
  'nothing while the owner is an active member');
SELECT is((SELECT count(*)::int FROM public.moth_leaver_files('aaaa1220-0000-0000-0000-00000000000a')), 0,
  'and nothing of an ordinary project');
SELECT public.t122_d();
SELECT is((SELECT count(*)::int FROM public.moth_leaver_files('aaaa1220-0000-0000-0000-0000000000f0')), 0, 'nothing for a workspace manager');
SELECT public.t122_c();
SELECT is((SELECT count(*)::int FROM public.moth_leaver_files('aaaa1220-0000-0000-0000-0000000000f0')), 0, 'nothing for a plain member');
RESET ROLE;
SELECT public.t122_a();
INSERT INTO public.expenses (id, workspace_id, project_id, title, file_ids)
VALUES ('12200000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111', 'aaaa1220-0000-0000-0000-0000000000f0', 'a receipt', ARRAY['12200000-0000-0000-0000-000000000004'::uuid]);
SET LOCAL ROLE authenticated;
SELECT is((SELECT string_agg(name, ',' ORDER BY name) FROM public.moth_leaver_files('aaaa1220-0000-0000-0000-0000000000f0')), 'keep.mov',
  'a file an expense names is money, and is not offered');
RESET ROLE;
DELETE FROM public.expenses WHERE id = '12200000-0000-0000-0000-0000000000e1';

-- ── C. Who is refused, and how ──────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t122_c();
SELECT throws_ok($$ SELECT public.t122_leave(ARRAY['12200000-0000-0000-0000-000000000001'::uuid], 'aaaa1220-0000-0000-0000-00000000000a', true) $$,
  'P0001', 'moth_move:not_found', 'a plain member reads it as not there');
SELECT public.t122_d();
SELECT throws_ok($$ SELECT public.t122_leave(ARRAY['12200000-0000-0000-0000-000000000001'::uuid], 'aaaa1220-0000-0000-0000-00000000000a', true) $$,
  'P0001', 'moth_move:not_found', 'and so does a workspace manager');
SELECT public.t122_a();
SELECT throws_ok($$ SELECT public.t122_leave(ARRAY['12200000-0000-0000-0000-000000000003'::uuid], 'aaaa1220-0000-0000-0000-00000000000a', true) $$,
  'P0001', 'moth_move:not_found', 'an admin is refused while the owner is an active member');
SELECT throws_ok($$ SELECT public.t122_leave(ARRAY['12200000-0000-0000-0000-000000000001'::uuid, '12200000-0000-0000-0000-000000000003'::uuid], 'aaaa1220-0000-0000-0000-00000000000a', true) $$,
  'P0001', 'moth_move:not_found', 'one file of an active owner in the batch refuses all of it');
SELECT throws_ok($$ SELECT public.t122_leave(ARRAY['12200000-0000-0000-0000-000000000002'::uuid], 'aaaa1220-0000-0000-0000-00000000000a', true) $$,
  'P0001', 'moth_move:not_found', 'a Legal file reads as not there, for an admin too');
SELECT throws_ok($$ SELECT public.t122_leave(ARRAY['12200000-0000-0000-0000-000000000001'::uuid, '12200000-0000-0000-0000-000000000002'::uuid], 'aaaa1220-0000-0000-0000-00000000000a', true) $$,
  'P0001', 'moth_move:not_found', 'and one in the batch refuses all of it');
SELECT throws_ok($$ SELECT public.t122_leave(ARRAY['12200000-0000-0000-0000-000000000005'::uuid], 'aaaa1220-0000-0000-0000-00000000000a', true) $$,
  'P0001', 'moth_move:not_found', 'a binned file does not move');
SELECT throws_ok($$ SELECT public.t122_leave(ARRAY['12200000-0000-0000-0000-000000000001'::uuid], 'aaaa1220-0000-0000-0000-0000000000a0', true) $$,
  'P0001', 'moth_move:not_allowed_destination', 'not into the admin''s own personal space');
SELECT throws_ok($$ SELECT public.t122_leave(ARRAY['12200000-0000-0000-0000-000000000001'::uuid], 'aaaa1220-0000-0000-0000-0000000000e0', true) $$,
  'P0001', 'moth_move:not_allowed_destination', 'nor into someone else''s');
SELECT throws_ok($$ SELECT public.t122_leave(ARRAY['12200000-0000-0000-0000-000000000099'::uuid], 'aaaa1220-0000-0000-0000-00000000000a', true) $$,
  'P0001', 'moth_move:not_found', 'a file that does not exist reads the same');
SELECT throws_ok($$ SELECT public.t122_leave('{}'::uuid[], 'aaaa1220-0000-0000-0000-00000000000a', true) $$,
  'P0001', 'moth_move:empty', 'nothing to move is said');
SELECT throws_ok($$ SELECT public.moth_move_items(ARRAY['12200000-0000-0000-0000-000000000001'::uuid], 'aaaa1220-0000-0000-0000-00000000000a', NULL, true) $$,
  'P0001', 'moth_move:not_found', '🚨 the ordinary move still reads a former member''s file as not there, for an admin');
RESET ROLE;

-- ── D. The one question is asked of the person, not of the marker ───────────
SELECT set_config('wilson.moth_leaver_move', 'on', true);
SET LOCAL ROLE authenticated;
SELECT public.t122_c();
SELECT ok(NOT public.moth_can_write_target('file', '12200000-0000-0000-0000-000000000001'), '🚨 a member with the marker on still may not write it');
SELECT ok(NOT public.moth_can_read_target('file', '12200000-0000-0000-0000-000000000001'), 'nor read it');
SELECT public.t122_d();
SELECT ok(NOT public.moth_can_write_target('file', '12200000-0000-0000-0000-000000000001'), 'nor may a workspace manager');
SELECT public.t122_a();
SELECT ok(public.moth_can_write_target('file', '12200000-0000-0000-0000-000000000001'), 'CONTROL: the admin passes with it on');
SELECT ok(NOT public.moth_can_write_target('file', '12200000-0000-0000-0000-000000000003'), 'and still not on an active owner''s file');
SELECT ok(NOT public.moth_can_write_target('file', '12200000-0000-0000-0000-000000000002'), 'and still not on a Legal file');
RESET ROLE;
SELECT set_config('wilson.moth_leaver_move', '', true);
SET LOCAL ROLE authenticated;
SELECT public.t122_a();
SELECT ok(NOT public.moth_can_write_target('file', '12200000-0000-0000-0000-000000000001'), 'with it off the admin does not');
SELECT ok(NOT public.moth_can_read_target('file', '12200000-0000-0000-0000-000000000001'), 'nor read it through Moth');

-- ── E. Moth's own reads are as they were ────────────────────────────────────
SELECT is((SELECT count(*)::int FROM public.moth_islands() i WHERE i.id = 'aaaa1220-0000-0000-0000-0000000000f0'), 0,
  '🚨 a former member''s space is no island, for an admin');
SELECT is((SELECT count(*)::int FROM public.moth_project_files('aaaa1220-0000-0000-0000-0000000000f0')), 0,
  'and its files are not on Moth''s list');

-- ── F. The move ─────────────────────────────────────────────────────────────
INSERT INTO t122_ret SELECT 'plan', public.t122_leave(ARRAY['12200000-0000-0000-0000-000000000001'::uuid], 'aaaa1220-0000-0000-0000-00000000000a', true);
SELECT is(public.t122_v('plan') -> 'items' -> 0 ->> 'how', 'rehome', 'a key under the personal space needs a new copy');
SELECT is((SELECT count(*)::int FROM public.app_events WHERE code = 'WIL-4115' AND context ->> 'owner_user_id' = 'ffffffff-ffff-ffff-ffff-ffffffffffff'), 0, 'a plan records nothing');
RESET ROLE;
SELECT is((SELECT project_id::text FROM public.files WHERE id = '12200000-0000-0000-0000-000000000001'), 'aaaa1220-0000-0000-0000-0000000000f0', 'and moves nothing');
SELECT is(COALESCE(current_setting('wilson.moth_leaver_move', true), ''), '', 'and leaves no marker on');
-- What the real client's copy asks of the storage policies, as the admin: to read the old copy, and to write the new.
SET LOCAL ROLE authenticated;
SELECT public.t122_a();
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'rabbit-files' AND name = 'projects/aaaa1220-0000-0000-0000-0000000000f0/files/12200000-0000-0000-0000-000000000001/keep.mov'), 1,
  '🚨 the admin can read the copy it must copy');
SELECT lives_ok(format($q$ INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('rabbit-files', %L, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $q$, public.t122_v('plan') -> 'items' -> 0 ->> 'to_path'),
  '🚨 and write the new one under the project');
SELECT lives_ok(format($q$ INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('rabbit-thumbnails', %L, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $q$, public.t122_v('plan') -> 'items' -> 0 ->> 'to_thumb'),
  'and its picture');
INSERT INTO t122_ret SELECT 'did', public.t122_leave(ARRAY['12200000-0000-0000-0000-000000000001'::uuid], 'aaaa1220-0000-0000-0000-00000000000a', false,
  jsonb_build_array(jsonb_build_object('file_id', '12200000-0000-0000-0000-000000000001',
    'path', public.t122_v('plan') -> 'items' -> 0 ->> 'to_path', 'thumbnail', public.t122_v('plan') -> 'items' -> 0 ->> 'to_thumb')));
SELECT is((public.t122_v('did') ->> 'moved')::int, 1, 'the commit says one moved');
RESET ROLE;
SELECT is((SELECT row(project_id, storage_path = public.t122_v('plan') -> 'items' -> 0 ->> 'to_path')::text FROM public.files WHERE id = '12200000-0000-0000-0000-000000000001'),
  '(aaaa1220-0000-0000-0000-00000000000a,t)', '🚨 the file is in the project, at its new key');
SELECT is((SELECT count(*)::int FROM public.storage_gc_queue WHERE file_id = '12200000-0000-0000-0000-000000000001'), 2, 'and the old copy and its picture are queued');
SELECT is((SELECT count(*)::int FROM public.app_events WHERE code = 'WIL-4115' AND context ->> 'owner_user_id' = 'ffffffff-ffff-ffff-ffff-ffffffffffff'), 1, '🚨 one line in the admin activity list');
SELECT is((SELECT row(event_type, actor_user_id, context ->> 'project_id', context ->> 'dest_project_id', context ->> 'file_count')::text
             FROM public.app_events WHERE code = 'WIL-4115' AND context ->> 'owner_user_id' = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  '(admin,aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa,aaaa1220-0000-0000-0000-0000000000f0,aaaa1220-0000-0000-0000-00000000000a,1)',
  'naming who, whose, where and how many, by id');
SELECT is((SELECT count(*)::int FROM public.app_events WHERE code = 'WIL-4115' AND context::text LIKE '%keep.mov%'), 0, 'and no file''s name');
SELECT is((SELECT count(*)::int FROM public.file_events WHERE file_id = '12200000-0000-0000-0000-000000000001' AND event IN ('moved_out', 'moved_in')), 2, 'its own log says it moved');
SET LOCAL ROLE authenticated;
SELECT public.t122_a();
SELECT throws_ok(format($q$ SELECT public.moth_undo_move(%L) $q$, public.t122_v('did') ->> 'move_id'), 'P0001', 'moth_move:not_found',
  'it does not go back into that space by an undo');
RESET ROLE;

-- A person back in the company is no former member.
UPDATE public.workspace_members SET is_active = true WHERE user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' AND workspace_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL ROLE authenticated;
SELECT public.t122_a();
SELECT throws_ok($$ SELECT public.t122_leave(ARRAY['12200000-0000-0000-0000-000000000004'::uuid], 'aaaa1220-0000-0000-0000-00000000000a', true) $$,
  'P0001', 'moth_move:not_found', '🚨 someone made active again has their space back');
SELECT is((SELECT count(*)::int FROM public.moth_leaver_files('aaaa1220-0000-0000-0000-0000000000f0')), 0, 'and nothing is offered');
RESET ROLE;
UPDATE public.workspace_members SET is_active = false WHERE user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' AND workspace_id = '11111111-1111-1111-1111-111111111111';

-- ── G. The storage notice ───────────────────────────────────────────────────
INSERT INTO public.workspace_storage_plans (workspace_id, quota_bytes, status)
VALUES ('11111111-1111-1111-1111-111111111111', 1000000, 'active')
ON CONFLICT (workspace_id) DO UPDATE SET quota_bytes = 1000000, status = 'active';
SET LOCAL ROLE authenticated;
SELECT public.t122_a();
SELECT is((SELECT quota_bytes || '|' || (used_bytes IS NOT NULL) || '|' || fullness FROM public.workspace_storage_usage()), '1000000|true|ok', 'an admin reads the figures');
SELECT public.t122_d();
SELECT is((SELECT (quota_bytes IS NULL) || '|' || (used_bytes IS NULL) || '|' || fullness || '|' || status FROM public.workspace_storage_usage()), 'true|true|ok|active', '🚨 a workspace manager does not');
SELECT public.t122_c();
SELECT is((SELECT (quota_bytes IS NULL) || '|' || (used_bytes IS NULL) || '|' || fullness || '|' || status FROM public.workspace_storage_usage()), 'true|true|ok|active', '🚨 nor does a plain member');
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES ('rabbit-files', 'projects/aaaa1220-0000-0000-0000-00000000000a/files/12200000-0000-0000-0000-000000000011/big.mov', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{"size":950000}'::jsonb);
SET LOCAL ROLE authenticated;
SELECT public.t122_c();
SELECT is((SELECT fullness FROM public.workspace_storage_usage()), 'nearly_full', '9 parts in 10 is nearly full');
SELECT public.t122_a();
SELECT is((SELECT fullness FROM public.workspace_storage_usage()), 'nearly_full', 'and an admin is told it too');
SELECT public.t122_c();
SELECT throws_ok($$ SELECT public.reserve_upload_bytes('projects/aaaa1220-0000-0000-0000-00000000000a/files/12200000-0000-0000-0000-000000000012/more.mov', 100000000) $$,
  'PT402', 'There is not enough Petal cloud storage left for "more.mov". Add a smaller file, or contact an admin to raise the plan — deleting files does not free space straight away, because deleted files stay recoverable for 30 days.',
  '🚨 a member''s refusal names no amount');
SELECT public.t122_d();
SELECT throws_ok($$ SELECT public.reserve_upload_bytes('projects/aaaa1220-0000-0000-0000-00000000000a/files/12200000-0000-0000-0000-000000000012/more.mov', 100000000) $$,
  'PT402', 'There is not enough Petal cloud storage left for "more.mov". Add a smaller file, or contact an admin to raise the plan — deleting files does not free space straight away, because deleted files stay recoverable for 30 days.',
  'nor does a workspace manager''s');
RESET ROLE;
SELECT public.t122_a();
SET LOCAL ROLE authenticated;
SELECT ok(public.t122_err($$ SELECT public.reserve_upload_bytes('projects/aaaa1220-0000-0000-0000-00000000000a/files/12200000-0000-0000-0000-000000000012/more.mov', 100000000) $$)
  ~ '^Not enough Petal cloud storage for "more\.mov": it needs [0-9]', 'an admin''s has the figures, as it did');
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES ('rabbit-files', 'projects/aaaa1220-0000-0000-0000-00000000000a/files/12200000-0000-0000-0000-000000000013/bigger.mov', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{"size":100000}'::jsonb);
SET LOCAL ROLE authenticated;
SELECT public.t122_c();
SELECT is((SELECT fullness FROM public.workspace_storage_usage()), 'full', 'all of it is full');
SELECT throws_ok($$ SELECT public.reserve_upload_bytes('projects/aaaa1220-0000-0000-0000-00000000000a/files/12200000-0000-0000-0000-000000000012/more.mov', 100000000) $$,
  'PT402', 'This company''s Petal cloud storage is full (uploads in progress count). Contact an admin to raise the plan — deleting files does not free space straight away, because deleted files stay recoverable for 30 days.',
  '🚨 and a full company''s refusal to a member names no amount');
SELECT public.t122_a();
SELECT ok(public.t122_err($$ SELECT public.reserve_upload_bytes('projects/aaaa1220-0000-0000-0000-00000000000a/files/12200000-0000-0000-0000-000000000012/more.mov', 100000000) $$)
  ~ '^This company has used all [0-9]', 'an admin''s has the figure');
RESET ROLE;
DELETE FROM public.workspace_storage_plans WHERE workspace_id = '11111111-1111-1111-1111-111111111111';

-- ── G2. Round 2: what a former member's move can and cannot carry ─────────────
-- What can never move is not offered: one of them would sink a whole batch, unnamed.
SELECT public.t122_a();
SET LOCAL lock_timeout = '15s';
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path) VALUES
  ('12200000-0000-0000-0000-000000000081', 'aaaa1220-0000-0000-0000-0000000000f0', 'computer.mov', 'local_server', 'projects/aaaa1220-0000-0000-0000-0000000000f0/files/12200000-0000-0000-0000-000000000081/computer.mov');
SELECT public.t122_share('12200000-0000-0000-0000-000000000082', 'aaaa1220-0000-0000-0000-0000000000f0', '_WILSON_PERSONAL/ffffffff-ffff-ffff-ffff-ffffffffffff/j-theirs.mov');
SELECT public.t122_file('12200000-0000-0000-0000-000000000083', 'aaaa1220-0000-0000-0000-0000000000f0', 'version.mov');
SELECT public.t122_file('12200000-0000-0000-0000-000000000084', 'aaaa1220-0000-0000-0000-0000000000f0', 'read.pdf');
SELECT public.t122_file('12200000-0000-0000-0000-000000000085', 'aaaa1220-0000-0000-0000-0000000000f0', 'fine.mov');
INSERT INTO public.assets (id, project_id, name) VALUES ('12200000-0000-0000-0000-000000000086', 'aaaa1220-0000-0000-0000-0000000000f0', 'An asset');
INSERT INTO public.asset_versions (id, asset_id, version_no, file_id) VALUES ('12200000-0000-0000-0000-000000000087', '12200000-0000-0000-0000-000000000086', 1, '12200000-0000-0000-0000-000000000083');
INSERT INTO public.ingestion_runs (id, project_id) VALUES ('12200000-0000-0000-0000-000000000088', 'aaaa1220-0000-0000-0000-0000000000f0');
INSERT INTO public.ingestion_chunks (id, run_id, chunk_index, file_id) VALUES ('12200000-0000-0000-0000-000000000089', '12200000-0000-0000-0000-000000000088', 0, '12200000-0000-0000-0000-000000000084');
SET LOCAL ROLE authenticated;
SELECT public.t122_a();
SELECT is((SELECT count(*)::int FROM public.moth_leaver_files('aaaa1220-0000-0000-0000-0000000000f0') WHERE name IN ('computer.mov', 'j-theirs.mov', 'version.mov', 'read.pdf')), 0,
  '🚨 a body on their computer or their server folder, a version of an asset and a file read in are not offered');
SELECT is((SELECT count(*)::int FROM public.moth_leaver_files('aaaa1220-0000-0000-0000-0000000000f0') WHERE name = 'fine.mov'), 1, 'CONTROL: an ordinary file beside them is');
SELECT throws_ok($$ SELECT public.t122_leave(ARRAY['12200000-0000-0000-0000-000000000081'::uuid], 'aaaa1220-0000-0000-0000-00000000000a', true) $$,
  'P0001', 'moth_move:on_their_computer', '🚨 a body on that person''s computer is refused, a plan included, which on an office server would adopt a file that never arrives');
SELECT throws_ok($$ SELECT public.t122_leave(ARRAY['12200000-0000-0000-0000-000000000085'::uuid, '12200000-0000-0000-0000-000000000081'::uuid], 'aaaa1220-0000-0000-0000-00000000000a', false) $$,
  'P0001', 'moth_move:on_their_computer', 'and it refuses the whole call');
RESET ROLE;
SELECT is((SELECT project_id::text FROM public.files WHERE id = '12200000-0000-0000-0000-000000000085'), 'aaaa1220-0000-0000-0000-0000000000f0', 'and nothing moved');

-- 🚨 A record must fit: at about 195 ids a large move was rolled back by the log's limit, every copy made in vain.
SELECT public.t122_a();
DO $do$
BEGIN
  FOR i IN 1..210 LOOP
    PERFORM public.t122_file(('12200000-0000-0000-0001-' || lpad(i::text, 12, '0'))::uuid, 'aaaa1220-0000-0000-0000-0000000000f0', 'many' || i || '.mov');
  END LOOP;
END
$do$;
SET LOCAL ROLE authenticated;
SELECT public.t122_a();
INSERT INTO t122_ret SELECT 'many', public.t122_leave(ARRAY(SELECT ('12200000-0000-0000-0001-' || lpad(i::text, 12, '0'))::uuid FROM generate_series(1, 210) i), 'aaaa1220-0000-0000-0000-00000000000a', true);
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name, owner_id)
SELECT 'rabbit-files', e ->> 'to_path', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' FROM jsonb_array_elements(public.t122_v('many') -> 'items') e;
SET LOCAL ROLE authenticated;
SELECT public.t122_a();
INSERT INTO t122_ret SELECT 'many_did', public.t122_leave(ARRAY(SELECT ('12200000-0000-0000-0001-' || lpad(i::text, 12, '0'))::uuid FROM generate_series(1, 210) i), 'aaaa1220-0000-0000-0000-00000000000a', false,
  (SELECT jsonb_agg(jsonb_build_object('file_id', e ->> 'id', 'path', e ->> 'to_path', 'thumbnail', NULL)) FROM jsonb_array_elements(public.t122_v('many') -> 'items') e));
SELECT is((public.t122_v('many_did') ->> 'moved')::int, 210, '🚨 210 of a former member''s files move in one go');
RESET ROLE;
SELECT is((SELECT (context ->> 'file_count')::int FROM public.app_events WHERE code = 'WIL-4115' AND context ->> 'move_id' = public.t122_v('many_did') ->> 'move_id'), 210,
  'and the record says how many, under the move''s id');

-- The plan's size is an admin's too, read directly.
INSERT INTO public.workspace_storage_plans (workspace_id, quota_bytes, status)
VALUES ('11111111-1111-1111-1111-111111111111', 1000000, 'active')
ON CONFLICT (workspace_id) DO UPDATE SET quota_bytes = 1000000, status = 'active';
SET LOCAL ROLE authenticated;
SELECT public.t122_c();
SELECT is((SELECT count(*)::int FROM public.workspace_storage_plans), 0, '🚨 a member cannot read the plan''s size off the table');
SELECT public.t122_d();
SELECT is((SELECT count(*)::int FROM public.workspace_storage_plans), 0, 'nor can a manager');
SELECT public.t122_a();
SELECT is((SELECT count(*)::int FROM public.workspace_storage_plans), 1, 'CONTROL: an admin can');
RESET ROLE;
DELETE FROM public.workspace_storage_plans WHERE workspace_id = '11111111-1111-1111-1111-111111111111';

-- ── H. The office server ────────────────────────────────────────────────────
CREATE FUNCTION public.t122_root() RETURNS text LANGUAGE sql IMMUTABLE AS $f$ SELECT replace('//nas/share/wilson', '/', chr(92)) $f$;
INSERT INTO public.workspace_storage (workspace_id, mode, provider, root_path, root_kind)
VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 'network', public.t122_root(), 'unc')
ON CONFLICT (workspace_id) DO UPDATE SET mode = 'byos', provider = 'network', root_path = public.t122_root(), root_kind = 'unc';
SELECT public.t122_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, folder_root) VALUES
  ('aaaa1220-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'Salt Share', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, public.t122_root() || chr(92) || 'Salt-Hours'),
  ('aaaa1220-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'Moon Share', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, public.t122_root() || chr(92) || 'Moon-Film');
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1220-0000-0000-0000-000000000011', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1220-0000-0000-0000-000000000012', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1220-0000-0000-0000-000000000011', 'ffffffff-ffff-ffff-ffff-ffffffffffff', '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT DO NOTHING;

-- A file in that person's folder on the server is refused by name: only their token opens it.
SELECT public.t122_share('12200000-0000-0000-0000-000000000021', 'aaaa1220-0000-0000-0000-0000000000f0', '_WILSON_PERSONAL/ffffffff-ffff-ffff-ffff-ffffffffffff/onserver.mov');
SET LOCAL ROLE authenticated;
SELECT public.t122_a();
SELECT throws_ok($$ SELECT public.t122_leave(ARRAY['12200000-0000-0000-0000-000000000021'::uuid], 'aaaa1220-0000-0000-0000-000000000011', true) $$,
  'P0001', 'moth_move:in_their_server_folder', '🚨 a former member''s file on the office server says why');
RESET ROLE;

-- One refused project holds back that project only.
SELECT public.t122_share('12200000-0000-0000-0000-000000000031', 'aaaa1220-0000-0000-0000-000000000011', 'Salt-Hours/one.mov');
SELECT public.t122_share('12200000-0000-0000-0000-000000000032', 'aaaa1220-0000-0000-0000-000000000012', 'Moon-Film/two.mov');
SET LOCAL ROLE authenticated;
SELECT public.t122_c();
INSERT INTO t122_ret SELECT 'p1', public.moth_trash_files(ARRAY['12200000-0000-0000-0000-000000000031'::uuid]);
INSERT INTO t122_ret SELECT 'p2', public.moth_trash_files(ARRAY['12200000-0000-0000-0000-000000000032'::uuid]);
SELECT is(jsonb_array_length(public.network_share_pending_mine()), 2, 'CONTROL: both are pending');
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(public.network_share_pending_mine()) e WHERE (e ->> 'size')::bigint = 1 AND (e ->> 'created_at') IS NOT NULL), 2,
  '🚨 what is pending says each file''s size, for the repeat to compare, and each operation''s age');
RESET ROLE;
SELECT public.t122_a();
UPDATE public.projects SET folder_root = NULL WHERE id = 'aaaa1220-0000-0000-0000-000000000011';
SET LOCAL ROLE authenticated;
SELECT public.t122_c();
SELECT is((SELECT string_agg(e ->> 'to', ',') FROM jsonb_array_elements(public.network_share_pending_mine()) e),
  public.t122_v('p2') -> 'ops' -> 0 ->> 'to', '🚨 a project with no folder holds back its own operation, and not the other''s');
RESET ROLE;
SELECT public.t122_a();
UPDATE public.projects SET folder_root = public.t122_root() || chr(92) || 'Salt-Hours' WHERE id = 'aaaa1220-0000-0000-0000-000000000011';
SET LOCAL ROLE authenticated;
SELECT public.t122_c();
SELECT lives_ok(format($q$ SELECT public.network_share_settle(ARRAY[%L, %L]::uuid[], 'done') $q$, public.t122_v('p1') -> 'ops' -> 0 ->> 'op_id', public.t122_v('p2') -> 'ops' -> 0 ->> 'op_id'),
  'and both settle once it has one again');
RESET ROLE;

-- What a person who has left began in their own space: a move out, and a delete.
UPDATE public.workspace_members SET is_active = true WHERE user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' AND workspace_id = '11111111-1111-1111-1111-111111111111';
SELECT public.t122_share('12200000-0000-0000-0000-000000000041', 'aaaa1220-0000-0000-0000-0000000000f0', '_WILSON_PERSONAL/ffffffff-ffff-ffff-ffff-ffffffffffff/leaving.mov');
SELECT public.t122_share('12200000-0000-0000-0000-000000000042', 'aaaa1220-0000-0000-0000-0000000000f0', '_WILSON_PERSONAL/ffffffff-ffff-ffff-ffff-ffffffffffff/deleting.mov');
SET LOCAL ROLE authenticated;
SELECT public.t122_n();
INSERT INTO t122_ret SELECT 'lm', public.moth_move_items(ARRAY['12200000-0000-0000-0000-000000000041'::uuid], 'aaaa1220-0000-0000-0000-000000000011');
INSERT INTO t122_ret SELECT 'lt', public.moth_trash_files(ARRAY['12200000-0000-0000-0000-000000000042'::uuid]);
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.network_share_ops WHERE file_id IN ('12200000-0000-0000-0000-000000000041', '12200000-0000-0000-0000-000000000042') AND state = 'pending'), 2, 'CONTROL: both are pending');
SET LOCAL ROLE authenticated;
SELECT public.t122_a();
SELECT throws_ok(format($q$ SELECT public.network_share_settle(ARRAY[%L]::uuid[], 'not_moved') $q$, public.t122_v('lm') -> 'ops' -> 0 ->> 'op_id'),
  '42501', 'network_share: not allowed', 'an admin may not call it off while its person is an active member, and it is young');
RESET ROLE;
UPDATE public.network_share_ops SET created_at = now() - interval '25 hours' WHERE file_id IN ('12200000-0000-0000-0000-000000000041', '12200000-0000-0000-0000-000000000042');
SET LOCAL ROLE authenticated;
SELECT public.t122_a();
SELECT throws_ok(format($q$ SELECT public.network_share_settle(ARRAY[%L]::uuid[], 'not_moved') $q$, public.t122_v('lm') -> 'ops' -> 0 ->> 'op_id'),
  '42501', 'network_share: not allowed', 'nor when old, while its person is still here');
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(public.network_share_stale_moves()) e WHERE e ->> 'file_id' = '12200000-0000-0000-0000-000000000041'), 0, 'and it is not on their list');
RESET ROLE;
UPDATE public.workspace_members SET is_active = false WHERE user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' AND workspace_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL ROLE authenticated;
SELECT public.t122_c();
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(public.network_share_stale_moves()) e WHERE e ->> 'file_id' IN ('12200000-0000-0000-0000-000000000041', '12200000-0000-0000-0000-000000000042')), 0, 'a plain member is offered neither');
SELECT throws_ok(format($q$ SELECT public.network_share_settle(ARRAY[%L]::uuid[], 'not_moved') $q$, public.t122_v('lm') -> 'ops' -> 0 ->> 'op_id'),
  '42501', 'network_share: not allowed', 'and may call off neither');
SELECT public.t122_a();
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(public.network_share_stale_moves()) e WHERE e ->> 'file_id' IN ('12200000-0000-0000-0000-000000000041', '12200000-0000-0000-0000-000000000042')), 2, '🚨 once they have left, an admin is offered both');
SELECT throws_ok(format($q$ SELECT public.network_share_settle(ARRAY[%L]::uuid[], 'done') $q$, public.t122_v('lm') -> 'ops' -> 0 ->> 'op_id'),
  '42501', 'network_share: not allowed', 'and may not say one happened');
SELECT throws_ok(format($q$ SELECT public.network_share_settle(ARRAY[%L]::uuid[], 'done') $q$, public.t122_v('lt') -> 'ops' -> 0 ->> 'op_id'),
  '42501', 'network_share: not allowed', 'nor the other');
SELECT lives_ok(format($q$ SELECT public.network_share_settle(ARRAY[%L, %L]::uuid[], 'not_moved') $q$, public.t122_v('lm') -> 'ops' -> 0 ->> 'op_id', public.t122_v('lt') -> 'ops' -> 0 ->> 'op_id'),
  'but may say they did not');
RESET ROLE;
SELECT is((SELECT project_id::text FROM public.files WHERE id = '12200000-0000-0000-0000-000000000041'), 'aaaa1220-0000-0000-0000-0000000000f0', 'the moved row is back where its file still is');
SELECT is((SELECT deleted_at IS NULL FROM public.files WHERE id = '12200000-0000-0000-0000-000000000042'), true, 'and the deleted one is live again');

-- An adopt's old picture goes once it can no longer come back.
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, thumbnail_url) VALUES
  ('12200000-0000-0000-0000-000000000051', 'aaaa1220-0000-0000-0000-000000000011', 'pic.mov', 'local_server', 'projects/aaaa1220-0000-0000-0000-000000000011/files/12200000-0000-0000-0000-000000000051/pic.mov', 'projects/aaaa1220-0000-0000-0000-000000000011/files/12200000-0000-0000-0000-000000000051/pic.mov.jpg'),
  ('12200000-0000-0000-0000-000000000052', 'aaaa1220-0000-0000-0000-000000000011', 'pic2.mov', 'local_server', 'projects/aaaa1220-0000-0000-0000-000000000011/files/12200000-0000-0000-0000-000000000052/pic2.mov', 'projects/aaaa1220-0000-0000-0000-000000000011/files/12200000-0000-0000-0000-000000000052/pic2.mov.jpg');
SET LOCAL ROLE authenticated;
SELECT public.t122_c();
INSERT INTO t122_ret SELECT 'ad', public.moth_move_items(ARRAY['12200000-0000-0000-0000-000000000051'::uuid], 'aaaa1220-0000-0000-0000-000000000012');
INSERT INTO t122_ret SELECT 'ad2', public.moth_move_items(ARRAY['12200000-0000-0000-0000-000000000052'::uuid], 'aaaa1220-0000-0000-0000-000000000012');
SELECT lives_ok(format($q$ SELECT public.network_share_settle(ARRAY[%L]::uuid[], 'not_moved') $q$, public.t122_v('ad2') -> 'ops' -> 0 ->> 'op_id'), 'an adopt that did not happen settles');
SELECT lives_ok(format($q$ SELECT public.network_share_settle(ARRAY[%L]::uuid[], 'done', jsonb_build_object(%L, jsonb_build_object('s', '3'))) $q$,
  public.t122_v('ad') -> 'ops' -> 0 ->> 'op_id', public.t122_v('ad') -> 'ops' -> 0 ->> 'op_id'), 'and one that did');
RESET ROLE;
SELECT is((SELECT row(bucket_id, object_path, provider, kind)::text FROM public.storage_gc_queue WHERE file_id = '12200000-0000-0000-0000-000000000051'),
  '(rabbit-thumbnails,projects/aaaa1220-0000-0000-0000-000000000011/files/12200000-0000-0000-0000-000000000051/pic.mov.jpg,supabase,thumbnail)',
  '🚨 the one that did queues its old picture');
SELECT is((SELECT count(*)::int FROM public.storage_gc_queue WHERE file_id = '12200000-0000-0000-0000-000000000052'), 0, 'and the one that did not keeps it');
SELECT is((SELECT thumbnail_url IS NOT NULL FROM public.files WHERE id = '12200000-0000-0000-0000-000000000052'), true, 'which its row names again');

-- An operation left past the retention does not hold a row or a project in the bin for ever.
SELECT public.t122_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, folder_root) VALUES
  ('aaaa1220-0000-0000-0000-000000000021', '11111111-1111-1111-1111-111111111111', 'Long Gone', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, public.t122_root() || chr(92) || 'Long-Gone'),
  ('aaaa1220-0000-0000-0000-000000000022', '11111111-1111-1111-1111-111111111111', 'Lately Gone', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, public.t122_root() || chr(92) || 'Lately-Gone');
SELECT public.t122_share('12200000-0000-0000-0000-000000000061', 'aaaa1220-0000-0000-0000-000000000021', 'Long-Gone/a.mov');
SELECT public.t122_share('12200000-0000-0000-0000-000000000062', 'aaaa1220-0000-0000-0000-000000000022', 'Lately-Gone/a.mov');
SELECT public.t122_share('12200000-0000-0000-0000-000000000063', 'aaaa1220-0000-0000-0000-000000000012', 'Moon-Film/old-delete.mov');
SELECT public.t122_share('12200000-0000-0000-0000-000000000064', 'aaaa1220-0000-0000-0000-000000000012', 'Moon-Film/new-delete.mov');
SET LOCAL ROLE authenticated;
SELECT public.t122_a();
INSERT INTO t122_ret SELECT 'o1', public.moth_trash_files(ARRAY['12200000-0000-0000-0000-000000000061'::uuid]);
INSERT INTO t122_ret SELECT 'o2', public.moth_trash_files(ARRAY['12200000-0000-0000-0000-000000000062'::uuid]);
INSERT INTO t122_ret SELECT 'o3', public.moth_trash_files(ARRAY['12200000-0000-0000-0000-000000000063'::uuid]);
INSERT INTO t122_ret SELECT 'o4', public.moth_trash_files(ARRAY['12200000-0000-0000-0000-000000000064'::uuid]);
RESET ROLE;
UPDATE public.projects SET deleted_at = now() - interval '40 days' WHERE id IN ('aaaa1220-0000-0000-0000-000000000021', 'aaaa1220-0000-0000-0000-000000000022');
UPDATE public.network_share_ops SET created_at = now() - interval '40 days' WHERE file_id = '12200000-0000-0000-0000-000000000061';
UPDATE public.network_share_ops SET created_at = now() - interval '10 days' WHERE file_id = '12200000-0000-0000-0000-000000000062';
UPDATE public.files SET deleted_at = now() - interval '40 days' WHERE id IN ('12200000-0000-0000-0000-000000000063', '12200000-0000-0000-0000-000000000064');
UPDATE public.network_share_ops SET created_at = now() - interval '40 days' WHERE file_id = '12200000-0000-0000-0000-000000000063';
UPDATE public.network_share_ops SET created_at = now() - interval '10 days' WHERE file_id = '12200000-0000-0000-0000-000000000064';
SELECT public.purge_soft_deleted();
SELECT is((SELECT count(*)::int FROM public.projects WHERE id = 'aaaa1220-0000-0000-0000-000000000021'), 0, '🚨 a project binned with an operation left past the retention goes');
SELECT is((SELECT count(*)::int FROM public.projects WHERE id = 'aaaa1220-0000-0000-0000-000000000022'), 1, 'one with a younger operation waits');
SELECT is((SELECT count(*)::int FROM public.files WHERE id = '12200000-0000-0000-0000-000000000063'), 0, '🚨 a trashed file held past the retention goes');
SELECT is((SELECT count(*)::int FROM public.files WHERE id = '12200000-0000-0000-0000-000000000064'), 1, 'one held by a younger operation waits');

-- ── I. The read path says what the last check did not find ──────────────────
SELECT public.t122_share('12200000-0000-0000-0000-000000000071', 'aaaa1220-0000-0000-0000-000000000012', 'Moon-Film/gone.mov');
SET LOCAL lock_timeout = '15s';
UPDATE public.files SET share_missing_since = now() WHERE id = '12200000-0000-0000-0000-000000000071';
SET LOCAL ROLE authenticated;
SELECT public.t122_c();
SELECT is((SELECT share_missing_since IS NOT NULL FROM public.moth_project_files('aaaa1220-0000-0000-0000-000000000012') WHERE id = '12200000-0000-0000-0000-000000000071'), true,
  '🚨 a file the last check did not find says so on Moth''s list');
RESET ROLE;

-- ── J. Round 2 ───────────────────────────────────────────────────────────────
-- A device name is no locator, and a project called Con keeps its folder_slug.
SELECT is(public.network_share_locator_ok('Moon-Film/aux.mov'), false, '🚨 a device name is no locator, with an extension');
SELECT is(public.network_share_locator_ok('Moon-Film/COM1/x.mov'), false, 'or as a folder on the way, in any case');
SELECT is(public.network_share_locator_ok('Moon-Film/auxiliary.mov'), true, 'CONTROL: a longer name is one');
SELECT is(public.network_share_path_shape_ok('Con'), true, '🚨 and a slug keeps it: projects_folder_slug_shape_chk asks the shape');

-- A folder that has turned all-numbered.
SELECT public.t122_share('12200000-0000-0000-0000-000000000091', 'aaaa1220-0000-0000-0000-000000000012', 'Moon-Film/Stills/still_01.png');
SELECT public.t122_share('12200000-0000-0000-0000-000000000092', 'aaaa1220-0000-0000-0000-000000000011', 'Salt-Hours/left.mov');
SET LOCAL ROLE authenticated;
SELECT public.t122_c();
INSERT INTO t122_ret SELECT 'gone', public.moth_move_items(ARRAY['12200000-0000-0000-0000-000000000092'::uuid], 'aaaa1220-0000-0000-0000-000000000012', NULL, false, NULL);
SELECT lives_ok(format($q$ SELECT public.network_share_settle(ARRAY[%L]::uuid[], 'done') $q$, public.t122_v('gone') -> 'ops' -> 0 ->> 'op_id'), 'a file moves away, and that settles');
RESET ROLE;
UPDATE public.project_members SET project_role = 'manager' WHERE project_id IN ('aaaa1220-0000-0000-0000-000000000011', 'aaaa1220-0000-0000-0000-000000000012') AND user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
SET LOCAL ROLE authenticated;
SELECT public.t122_c();
INSERT INTO t122_ret SELECT 'seq', public.network_share_catalogue_apply('aaaa1220-0000-0000-0000-000000000012', public.t122_root(), 'Moon-Film',
  jsonb_build_array(jsonb_build_object('d', 'Moon-Film', 'complete', true, 'subdirs', '[]'::jsonb, 'files', jsonb_build_array(
    jsonb_build_object('n', 'Stills', 's', '10', 't', 'inode/x-frame-sequence'),
    jsonb_build_object('n', 'plates', 's', '10', 't', 'inode/x-frame-sequence')))),
  '[]'::jsonb, true, NULL, true);
INSERT INTO t122_ret SELECT 'old_listing', public.network_share_catalogue_apply('aaaa1220-0000-0000-0000-000000000011', public.t122_root(), 'Salt-Hours',
  jsonb_build_array(jsonb_build_object('d', 'Salt-Hours', 'complete', true, 'subdirs', '[]'::jsonb, 'files', jsonb_build_array(
    jsonb_build_object('n', 'left.mov', 's', '1'),
    jsonb_build_object('n', 'new.mov', 's', '1')))),
  '[]'::jsonb, true, NULL, true);
RESET ROLE;
SELECT is((SELECT share_missing_since IS NULL FROM public.files WHERE id = '12200000-0000-0000-0000-000000000091'), true,
  '🚨 a file in a folder that has turned all-numbered is not called missing');
SELECT is((SELECT count(*)::int FROM public.files WHERE project_id = 'aaaa1220-0000-0000-0000-000000000012' AND lower(storage_path) = 'nas:moon-film/stills' AND deleted_at IS NULL), 0,
  '🚨 and that folder gets no row of its own beside it, which could not be opened');
SELECT is((SELECT count(*)::int FROM public.files WHERE project_id = 'aaaa1220-0000-0000-0000-000000000012' AND lower(storage_path) = 'nas:moon-film/plates' AND deleted_at IS NULL), 1,
  'CONTROL: a frame folder with nothing under it is one row, as ever');
SELECT is((SELECT count(*)::int FROM public.files WHERE project_id = 'aaaa1220-0000-0000-0000-000000000011' AND lower(storage_path) = 'nas:salt-hours/left.mov' AND deleted_at IS NULL), 0,
  '🚨 a listing older than a move does not add the moved file back at its old place');
SELECT is((SELECT count(*)::int FROM public.files WHERE project_id = 'aaaa1220-0000-0000-0000-000000000011' AND lower(storage_path) = 'nas:salt-hours/new.mov' AND deleted_at IS NULL), 1,
  'CONTROL: a new file beside it is added');
UPDATE public.network_share_ops SET settled_at = now() - interval '11 minutes' WHERE id = (public.t122_v('gone') -> 'ops' -> 0 ->> 'op_id')::uuid;
SET LOCAL ROLE authenticated;
SELECT public.t122_c();
INSERT INTO t122_ret SELECT 'later_listing', public.network_share_catalogue_apply('aaaa1220-0000-0000-0000-000000000011', public.t122_root(), 'Salt-Hours',
  jsonb_build_array(jsonb_build_object('d', 'Salt-Hours', 'complete', true, 'subdirs', '[]'::jsonb, 'files', jsonb_build_array(
    jsonb_build_object('n', 'left.mov', 's', '1'),
    jsonb_build_object('n', 'new.mov', 's', '1')))),
  '[]'::jsonb, true, NULL, true);
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.files WHERE project_id = 'aaaa1220-0000-0000-0000-000000000011' AND lower(storage_path) = 'nas:salt-hours/left.mov' AND deleted_at IS NULL), 1,
  'past ten minutes the name is free for a new file');

-- An operation left over a day, as the walk hands it back to finish: with the size a repeat compares.
SELECT public.t122_share('12200000-0000-0000-0000-000000000093', 'aaaa1220-0000-0000-0000-000000000012', 'Moon-Film/old.mov');
SET LOCAL ROLE authenticated;
SELECT public.t122_c();
INSERT INTO t122_ret SELECT 'old_op', public.moth_trash_files(ARRAY['12200000-0000-0000-0000-000000000093'::uuid]);
RESET ROLE;
UPDATE public.network_share_ops SET created_at = now() - interval '25 hours' WHERE id = (public.t122_v('old_op') -> 'ops' -> 0 ->> 'op_id')::uuid;
SET LOCAL ROLE authenticated;
SELECT public.t122_c();
INSERT INTO t122_ret SELECT 'stale_walk', public.network_share_catalogue_apply('aaaa1220-0000-0000-0000-000000000012', public.t122_root(), 'Moon-Film',
  jsonb_build_array(jsonb_build_object('d', 'Moon-Film', 'complete', true, 'subdirs', '[]'::jsonb, 'files', '[]'::jsonb)),
  '[]'::jsonb, true, NULL, true);
RESET ROLE;
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(public.t122_v('stale_walk') -> 'stale') e WHERE e ->> 'op_id' = public.t122_v('old_op') -> 'ops' -> 0 ->> 'op_id'), 1, 'CONTROL: the walk hands that operation back');
SELECT is((SELECT e ->> 'size' FROM jsonb_array_elements(public.t122_v('stale_walk') -> 'stale') e WHERE e ->> 'op_id' = public.t122_v('old_op') -> 'ops' -> 0 ->> 'op_id'), '1', '🚨 and says its size');

SELECT * FROM finish();
ROLLBACK;
