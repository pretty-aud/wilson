-- =============================================================================
-- 115_stable_file_bodies.sql — migration 0114, a file's stored copy stays at the key
-- it was made under, and clients no longer change where a file is kept or filed
-- (M.O.T.H. Session 1; docs/design/MOTH_DESIGN.md §1.2 "files column guards", §1.5,
-- §2.1 SB-4, SB-5, SB-8 to SB-13, SB-18).
--
-- What this pins, section by section:
--   A  The objects: who may call what, what runs as whom, the trigger, the indexes,
--      the columns, the switch. Inside a client-called definer, current_user is the
--      owner and the role setting still says 'authenticated': arm 2 rests on it.
--   B  Arm 1, UPDATE: the file's id, and each of the nine columns, one refusal, one sentence; identical
--      resends pass. A plain patch can neither clear nor change folder_id, which
--      closes the last route around the folder chain 0111 walks.
--   C  Arm 1, INSERT: one probe per reason, each row otherwise admissible, so each
--      refusal is that reason's. The same sentence for a money key whether or not
--      the object exists. The positives, and the reruns the migration leans on.
--   D  Arm 2, bound definers planted here: unmarked writes refused; the journal row
--      admits exactly its own values, and is seen from inside a BEFORE trigger though
--      the admission is STABLE; each marker is bound to its row; the foreign key's
--      SET NULL passes; unbound sessions pass everything.
--   E  Arm 3, an office-server row is the catalogue's.
--   F  Arm 4, a personal space keeps its files in the company's storage.
--   G  rekey_file_body: one refusal per reason, the compare-and-set, the two phases,
--      money only growing, the marker left empty.
--   H  storage_object_claimed arm by arm, storage_object_current_project as the
--      caller, file_key_shape_ok's table.
--   I  files_body_follow's codes and answers, files_body_retire's queue rows.
--   J  fn_projects_owner_guard's new arm, and that it answers only whom it should.
--   K  fn_same_project_refs_guard: the skip is gone, whatever a definer sets.
--   L  Which functions name each marker.
--   M  0115: who reaches a stored copy, as the storage policies read it, and which
--      policies say so. Real reads, writes and deletes on storage.objects.
--
-- The re-key and follow calls go through pg_temp.t115_ask, which answers text, error
-- and detail included: a top-level statement that raises would end the whole run.
--
-- Only section M deletes from storage.objects, under storage.allow_delete_query. Fixture ids are hex:
-- projects 11500000-aaaa-…-00000000000n (S and T shared, P private and created by
-- user_c, Q user_c's personal space, E user_e's, D binned), 11500000-bbbb-… another
-- company's, 11500000-dddd-… ids no project holds yet; folders 11500000-…-0000000000fx;
-- files 11500000-…-00000000snnn, where s is the section (a0 objects, b, c, d, e, f;
-- a1 G, a2 H, a3 I, a4 J, a5 K).
--
-- user_a is the admin (rls_setup); user_b the other company's admin; user_c a plain user
-- with a member seat on S, who writes it and has no money; user_d a workspace manager
-- with no seat (Legal, not money), also a plain member of the other company; user_e a
-- plain user with a reviewer seat on S; user_f a plain user with a manager seat on S
-- (money and Legal); user_n an inactive member whose token still says they belong.
-- =============================================================================

BEGIN;

SELECT plan(615);

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
  ('11111111-1111-1111-1111-111111111111', '99999999-9999-9999-9999-999999999999', 'user', 'user_n', 'User N', false),
  ('22222222-2222-2222-2222-222222222222', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'user', 'user_d_b', 'User D (B)', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- As the runner: no auth context, so nothing is auto-staffed and the guards pass.
INSERT INTO public.projects (id, workspace_id, title, is_private, created_by) VALUES
  ('11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Shared S', false, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('11500000-aaaa-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Shared T', false, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('11500000-aaaa-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Private P', true, 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('11500000-aaaa-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Binned', false, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('11500000-bbbb-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Other company', false, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
INSERT INTO public.projects (id, workspace_id, title, is_private, personal_owner_id, created_by) VALUES
  ('11500000-aaaa-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Personal space', true, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('11500000-aaaa-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Personal space', true, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
UPDATE public.projects SET deleted_at = now() WHERE id = '11500000-aaaa-0000-0000-000000000006';

INSERT INTO public.project_members (project_id, user_id, project_role) VALUES
  ('11500000-aaaa-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'member'),
  ('11500000-aaaa-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'reviewer'),
  ('11500000-aaaa-0000-0000-000000000001', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'manager'),
  ('11500000-aaaa-0000-0000-000000000001', '99999999-9999-9999-9999-999999999999', 'member'),
  ('11500000-aaaa-0000-0000-000000000004', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'manager'),
  ('11500000-aaaa-0000-0000-000000000005', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'manager');

INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('11500000-0000-0000-0000-0000000000f0', '11500000-aaaa-0000-0000-000000000001', NULL, 'root', 'shared-s', ''),
  ('11500000-0000-0000-0000-0000000000f1', '11500000-aaaa-0000-0000-000000000001', '11500000-0000-0000-0000-0000000000f0', 'category', 'INVOICES', 'INVOICES'),
  ('11500000-0000-0000-0000-0000000000f2', '11500000-aaaa-0000-0000-000000000001', '11500000-0000-0000-0000-0000000000f0', 'custom', 'Working', 'Working'),
  ('11500000-0000-0000-0000-0000000000f3', '11500000-aaaa-0000-0000-000000000001', '11500000-0000-0000-0000-0000000000f0', 'custom', 'Working2', 'Working2'),
  ('11500000-0000-0000-0000-0000000000f4', '11500000-aaaa-0000-0000-000000000001', '11500000-0000-0000-0000-0000000000f0', 'custom', 'Disposable', 'Disposable'),
  ('11500000-0000-0000-0000-0000000000f8', '11500000-aaaa-0000-0000-000000000002', NULL, 'root', 'shared-t', ''),
  ('11500000-0000-0000-0000-0000000000f9', '11500000-aaaa-0000-0000-000000000002', '11500000-0000-0000-0000-0000000000f8', 'custom', 'Dest', 'Dest');

-- What a statement answered, as text: its first column, or its error with the detail.
CREATE FUNCTION pg_temp.t115_ask(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_out    text;
  v_detail text;
BEGIN
  EXECUTE p_sql INTO v_out;
  RETURN COALESCE(v_out, '(null)');
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
  RETURN SQLSTATE || ': ' || SQLERRM || CASE WHEN COALESCE(v_detail, '') <> '' THEN ' / ' || v_detail ELSE '' END;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.t115_ask(text) TO PUBLIC;

-- The planted definers: what a future RPC would be, as far as the guard can tell.
CREATE FUNCTION public.t115_whoami() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN current_user || '/' || COALESCE(current_setting('role', true), '');
END;
$$;
CREATE FUNCTION public.t115_exec(p_sql text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  EXECUTE p_sql;
END;
$$;
CREATE FUNCTION public.t115_marked(p_marker text, p_value text, p_sql text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config(p_marker, p_value, true);
  EXECUTE p_sql;
  PERFORM set_config(p_marker, '', true);
END;
$$;
-- The checked move's order of work (0118): the journal row, the marker, the one UPDATE.
CREATE FUNCTION public.t115_journal_move(p_item jsonb, p_sql text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.file_moves (workspace_id, items)
  VALUES ('11111111-1111-1111-1111-111111111111', jsonb_build_array(p_item))
  RETURNING id INTO v_id;
  PERFORM set_config('wilson.file_move', v_id::text, true);
  EXECUTE p_sql;
  PERFORM set_config('wilson.file_move', '', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.t115_whoami() TO authenticated;
GRANT EXECUTE ON FUNCTION public.t115_exec(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.t115_marked(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.t115_journal_move(jsonb, text) TO authenticated;


-- ── A. The objects ───────────────────────────────────────────────────────────
SELECT ok(NOT has_schema_privilege('anon', 'rabbit_private', 'USAGE')
          AND NOT has_schema_privilege('public', 'rabbit_private', 'USAGE'),
  'rabbit_private is closed to anon and PUBLIC');
SELECT ok(has_schema_privilege('authenticated', 'rabbit_private', 'USAGE')
          AND has_schema_privilege('service_role', 'rabbit_private', 'USAGE'),
  'and open to a signed-in caller, whose guard calls it, and to service_role');

SELECT ok(NOT has_function_privilege('authenticated', 'rabbit_private.files_body_follow(uuid,uuid,jsonb)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'rabbit_private.files_body_follow(uuid,uuid,jsonb)', 'EXECUTE'),
  'files_body_follow is closed to clients');
SELECT ok(NOT has_function_privilege('authenticated', 'rabbit_private.files_body_retire(uuid,jsonb)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'rabbit_private.files_body_retire(uuid,jsonb)', 'EXECUTE'),
  'files_body_retire is closed to clients');
SELECT ok(NOT has_function_privilege('authenticated', 'rabbit_private.project_id_tied_elsewhere(uuid,uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'rabbit_private.project_id_tied_elsewhere(uuid,uuid)', 'EXECUTE'),
  'project_id_tied_elsewhere is closed to clients');

SELECT ok(has_function_privilege('authenticated', 'rabbit_private.file_key_admissible(text,text,uuid,uuid,uuid,boolean)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'rabbit_private.file_key_admissible(text,text,uuid,uuid,uuid,boolean)', 'EXECUTE'),
  'file_key_admissible is open to a signed-in caller, not to anon');
SELECT ok(has_function_privilege('authenticated', 'rabbit_private.storage_object_claimed(text,text)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'rabbit_private.storage_object_claimed(text,text)', 'EXECUTE'),
  'storage_object_claimed is open to a signed-in caller, not to anon');
SELECT ok(has_function_privilege('authenticated', 'rabbit_private.storage_object_current_project(text,text)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'rabbit_private.storage_object_current_project(text,text)', 'EXECUTE'),
  'storage_object_current_project is open to a signed-in caller, not to anon');
SELECT ok(has_function_privilege('authenticated', 'public.rekey_file_body(uuid,text,text,text,text,boolean)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.rekey_file_body(uuid,text,text,text,text,boolean)', 'EXECUTE'),
  'rekey_file_body is for a signed-in caller, not for anon');

SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_files_body_guard()'::regprocedure), false,
  'fn_files_body_guard is not a definer: current_user is who ran the write');
SELECT ok(NOT has_function_privilege('authenticated', 'public.fn_files_body_guard()', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.fn_files_body_guard()', 'EXECUTE'),
  'and it is closed to clients');
SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = 'rabbit_private.storage_object_current_project(text,text)'::regprocedure), false,
  'storage_object_current_project is not a definer: files_select decides as the caller');
SELECT is((SELECT count(*)::int FROM pg_proc
            WHERE oid IN ('rabbit_private.storage_object_claimed(text,text)'::regprocedure,
                          'rabbit_private.file_key_admissible(text,text,uuid,uuid,uuid,boolean)'::regprocedure,
                          'rabbit_private.project_id_tied_elsewhere(uuid,uuid)'::regprocedure,
                          'rabbit_private.files_body_follow(uuid,uuid,jsonb)'::regprocedure,
                          'rabbit_private.files_body_retire(uuid,jsonb)'::regprocedure,
                          'public.rekey_file_body(uuid,text,text,text,text,boolean)'::regprocedure)
              AND prosecdef
              AND 'row_security=off' = ANY (proconfig)
              AND 'search_path=public' = ANY (proconfig)), 6,
  'the six definers run with row security off and a pinned search_path');
SELECT is((SELECT count(*)::int FROM pg_proc
            WHERE pronamespace = 'rabbit_private'::regnamespace
              AND (has_function_privilege('anon', oid, 'EXECUTE')
                   OR NOT ('search_path=public' = ANY (COALESCE(proconfig, ARRAY[]::text[]))))), 0,
  'nothing in rabbit_private is open to anon or has a loose search_path');

SELECT is((SELECT count(*)::int FROM pg_trigger
            WHERE tgrelid = 'public.files'::regclass
              AND tgname = 'trg_files_body_guard'
              AND tgenabled = 'O'
              AND tgfoid = 'public.fn_files_body_guard()'::regprocedure
              AND position('BEFORE INSERT OR UPDATE ON public.files FOR EACH ROW' IN pg_get_triggerdef(oid)) > 0), 1,
  'trg_files_body_guard is attached, before insert or update, for each row');

SELECT is((SELECT count(*)::int
             FROM unnest(ARRAY['public.files_storage_path_key_uidx', 'public.files_s3_namespace_uidx',
                               'public.files_moved_body_ws_idx', 'public.storage_gc_queue_claim_idx',
                               'public.file_events_purged_path_idx', 'public.file_events_project_any_idx']) AS i
            WHERE to_regclass(i) IS NOT NULL), 6,
  'the six indexes are there');
SELECT is((SELECT count(*)::int FROM pg_index
            WHERE indexrelid IN (to_regclass('public.files_storage_path_key_uidx'), to_regclass('public.files_s3_namespace_uidx'))
              AND indisunique AND indisvalid), 2,
  'and two of them are unique');
SELECT is((SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attname)
             FROM pg_attribute
            WHERE attrelid = 'public.files'::regclass
              AND attname IN ('share_bin_path', 'share_missing_since')
              AND attnum > 0 AND NOT attisdropped),
  'share_bin_path:text,share_missing_since:timestamp with time zone',
  'the two office-server columns are there');
SELECT is(rabbit_private.s3_body_moves_on(), false, 's3_body_moves_on answers false until 0120');

-- The indexes bind the runner too, who passes every guard.
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path) VALUES
  ('11500000-0000-0000-0000-00000000a001', '11500000-aaaa-0000-0000-000000000001', 'held.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a001/held.txt'),
  ('11500000-0000-0000-0000-00000000a002', '11500000-aaaa-0000-0000-000000000001', 's3.bin', 's3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a002/s3.bin');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000a003', '11500000-aaaa-0000-0000-000000000001', 'x', 's3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a001/held.txt') $$,
  '23505', 'duplicate key value violates unique constraint "files_storage_path_key_uidx"',
  'a stored key has one row across the three key providers, for every writer');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000a003', '11500000-aaaa-0000-0000-000000000001', 'x', 's3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a002/s3.bin.jpg') $$,
  '23505', 'duplicate key value violates unique constraint "files_s3_namespace_uidx"',
  'in a company''s own bucket a body and its picture share names: K and K.jpg are one');
SELECT lives_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                   VALUES ('11500000-0000-0000-0000-00000000a003', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a002/s3.bin.jpg') $$,
  'CONTROL: K.jpg is free for a row on another provider');
SELECT lives_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                   VALUES ('11500000-0000-0000-0000-00000000a004', '11500000-aaaa-0000-0000-000000000001', 'x', 'network_share', 'projects/11500000-aaaa-0000-0000-000000000001/files/a001/held.txt') $$,
  'CONTROL: an office-server row is outside these indexes');

-- Inside a client-called definer: the owner, and the role setting still says who asks.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(current_user::text, 'authenticated', 'CONTROL: outside the definer the caller is authenticated');
SELECT is(public.t115_whoami(),
  (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE proname = 't115_whoami') || '/authenticated',
  'inside a client-called definer current_user is the owner and the role setting reads authenticated');
SELECT throws_ok($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a001', '11500000-aaaa-0000-0000-000000000002') $$,
  '42501', 'permission denied for function files_body_follow', 'a client cannot call files_body_follow');
SELECT throws_ok($$ SELECT rabbit_private.files_body_retire('11500000-0000-0000-0000-00000000a001', '[]') $$,
  '42501', 'permission denied for function files_body_retire', 'nor files_body_retire');
SELECT throws_ok($$ SELECT rabbit_private.project_id_tied_elsewhere('11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111') $$,
  '42501', 'permission denied for function project_id_tied_elsewhere', 'nor project_id_tied_elsewhere');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT rabbit_private.storage_object_claimed('rabbit-files', 'x') $$,
  '42501', 'permission denied for schema rabbit_private', 'anon cannot reach rabbit_private at all');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a001', 'x', 'y', NULL, NULL) $$,
  '42501', 'permission denied for function rekey_file_body', 'nor call rekey_file_body');
RESET ROLE;


-- ── B. Arm 1, UPDATE, as a client who can write the project ──────────────────
INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES
  ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/b001/filed.txt', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, folder_id) VALUES
  ('11500000-0000-0000-0000-00000000b001', '11500000-aaaa-0000-0000-000000000001', 'filed.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/b001/filed.txt', '11500000-0000-0000-0000-0000000000f2'),
  ('11500000-0000-0000-0000-00000000b002', '11500000-aaaa-0000-0000-000000000001', 'under-invoices.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/b002/under-invoices.txt', '11500000-0000-0000-0000-0000000000f1');
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial) VALUES
  ('11500000-0000-0000-0000-00000000b003', '11500000-aaaa-0000-0000-000000000001', 'flagged.pdf', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/b003/flagged.pdf', true);

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ UPDATE public.files SET project_id = '11500000-aaaa-0000-0000-000000000002' WHERE id = '11500000-0000-0000-0000-00000000b001' $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'arm 1 refuses a change of project_id');
SELECT throws_ok($$ UPDATE public.files SET workspace_id = '22222222-2222-2222-2222-222222222222' WHERE id = '11500000-0000-0000-0000-00000000b001' $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'arm 1 refuses a change of workspace_id');
SELECT throws_ok($$ UPDATE public.files SET folder_id = '11500000-0000-0000-0000-0000000000f3' WHERE id = '11500000-0000-0000-0000-00000000b001' $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'arm 1 refuses a change of folder_id');
SELECT throws_ok($$ UPDATE public.files SET storage_provider = 's3' WHERE id = '11500000-0000-0000-0000-00000000b001' $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'arm 1 refuses a change of storage_provider');
SELECT throws_ok($$ UPDATE public.files SET storage_path = 'projects/11500000-aaaa-0000-0000-000000000001/files/b001/other.txt' WHERE id = '11500000-0000-0000-0000-00000000b001' $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'arm 1 refuses a change of storage_path');
SELECT throws_ok($$ UPDATE public.files SET thumbnail_url = storage_path || '.jpg' WHERE id = '11500000-0000-0000-0000-00000000b001' $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'arm 1 refuses a change of thumbnail_url, even to the derived picture');
SELECT throws_ok($$ UPDATE public.files SET is_financial = true WHERE id = '11500000-0000-0000-0000-00000000b001' $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'arm 1 refuses a change of is_financial');
SELECT throws_ok($$ UPDATE public.files SET share_missing_since = now() WHERE id = '11500000-0000-0000-0000-00000000b001' $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'arm 1 refuses a change of share_missing_since');
SELECT throws_ok($$ UPDATE public.files SET share_bin_path = 'bin/b001' WHERE id = '11500000-0000-0000-0000-00000000b001' $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'arm 1 refuses a change of share_bin_path');
SELECT throws_ok($$ UPDATE public.files SET id = '11500000-0000-0000-0000-00000000b0ff' WHERE id = '11500000-0000-0000-0000-00000000b001' $$,
  '42501', 'A file keeps its id.', 'a client cannot change a file''s id');
SELECT throws_ok($$ UPDATE public.files SET storage_path = 'projects/11500000-aaaa-0000-0000-000000000001/LEGAL/b001/filed.txt' WHERE id = '11500000-0000-0000-0000-00000000b001' $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'the guard answers ahead of trg_files_legal_fixed');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000b001', '11500000-aaaa-0000-0000-000000000001', 'filed.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/b001/filed.txt')
                    ON CONFLICT (id) DO UPDATE SET storage_path = 'projects/11500000-aaaa-0000-0000-000000000001/files/b001/upsert.txt' $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'an upsert''s DO UPDATE meets the same arm');
SELECT is((SELECT project_id::text || '|' || workspace_id::text || '|' || folder_id::text || '|' || storage_provider::text
                  || '|' || storage_path || '|' || COALESCE(thumbnail_url, '-') || '|' || is_financial::text
                  || '|' || COALESCE(share_missing_since::text, '-') || '|' || COALESCE(share_bin_path, '-')
             FROM public.files WHERE id = '11500000-0000-0000-0000-00000000b001'),
  '11500000-aaaa-0000-0000-000000000001|11111111-1111-1111-1111-111111111111|11500000-0000-0000-0000-0000000000f2|supabase|projects/11500000-aaaa-0000-0000-000000000001/files/b001/filed.txt|-|false|-|-',
  'and nothing moved');

SELECT lives_ok($$ UPDATE public.files
                      SET project_id = '11500000-aaaa-0000-0000-000000000001', workspace_id = '11111111-1111-1111-1111-111111111111', folder_id = '11500000-0000-0000-0000-0000000000f2', storage_provider = 'supabase',
                          storage_path = 'projects/11500000-aaaa-0000-0000-000000000001/files/b001/filed.txt', thumbnail_url = NULL, is_financial = false,
                          share_missing_since = NULL, share_bin_path = NULL, description = 'resent'
                    WHERE id = '11500000-0000-0000-0000-00000000b001' $$,
  'resending all nine same values with a description change passes');
SELECT is((SELECT description FROM public.files WHERE id = '11500000-0000-0000-0000-00000000b001'), 'resent', 'and the description lands');
SELECT lives_ok($$ UPDATE public.files SET project_id = '11500000-aaaa-0000-0000-000000000001', description = 'own project' WHERE id = '11500000-0000-0000-0000-00000000b001' $$,
  'a client''s patch resending a filed row''s own project passes');
SELECT is((SELECT folder_id FROM public.files WHERE id = '11500000-0000-0000-0000-00000000b001'), '11500000-0000-0000-0000-0000000000f2'::uuid, 'and the row is still filed');
SELECT lives_ok($$ UPDATE public.files SET tags = ARRAY['production'], name = 'renamed.txt', mime_type = 'text/plain', size_bytes = 5 WHERE id = '11500000-0000-0000-0000-00000000b001' $$,
  'the columns arm 1 does not name stay a client''s');
SELECT is((SELECT name || '|' || tags::text || '|' || mime_type || '|' || size_bytes::text FROM public.files WHERE id = '11500000-0000-0000-0000-00000000b001'),
  'renamed.txt|{production}|text/plain|5', 'and they land');

-- The folder chain: a client can neither clear nor change folder_id.
SELECT is(public.moth_can_read_target('file', '11500000-0000-0000-0000-00000000b001'), true, 'CONTROL: Moth reads a file in a working folder');
SELECT is(public.moth_can_read_target('file', '11500000-0000-0000-0000-00000000b002'), false, 'a non-money file filed under INVOICES is hidden from Moth');
SELECT throws_ok($$ UPDATE public.files SET folder_id = NULL WHERE id = '11500000-0000-0000-0000-00000000b002' $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'a plain patch cannot clear its folder_id');
SELECT throws_ok($$ UPDATE public.files SET folder_id = '11500000-0000-0000-0000-0000000000f2' WHERE id = '11500000-0000-0000-0000-00000000b002' $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'nor point it at a working folder');
SELECT is(public.moth_can_read_target('file', '11500000-0000-0000-0000-00000000b002'), false, 'so it is still hidden after both');
SELECT is((SELECT folder_id FROM public.files WHERE id = '11500000-0000-0000-0000-00000000b002'), '11500000-0000-0000-0000-0000000000f1'::uuid, 'and still filed under INVOICES');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ UPDATE public.files SET folder_id = NULL WHERE id = '11500000-0000-0000-0000-00000000b002' $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'an admin is a client too');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ UPDATE public.files SET is_financial = false WHERE id = '11500000-0000-0000-0000-00000000b003' $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'and someone with money access cannot take a row''s money flag away');
SELECT is((SELECT is_financial FROM public.files WHERE id = '11500000-0000-0000-0000-00000000b003'), true, 'the row is still money');


-- ── C. Arm 1, INSERT: one reason each, the row otherwise admissible ──────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name, owner_id)
SELECT 'rabbit-files', k, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' FROM unnest(ARRAY[
  'projects/11500000-aaaa-0000-0000-000000000002/files/c101/x.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/bin_files/c102/x.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/connection-check/c103/x.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/FINANCE/c104/x.pdf',
  'projects/11500000-aaaa-0000-0000-000000000001/files',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c106.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c001/held.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c002/held-trashed.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c003/theirs.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c109/queued.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c110/failed.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c111/picture.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c112/purged.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c113/purged.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c115/pic.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c116/drive.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c117/nas.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c118/x.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c119/x.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c120/x.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c121/x.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/c122/x.pdf',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c124/x.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/LEGAL/c125/x.pdf',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c201/ok.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c206/pic.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c207/x.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/c208/x.pdf',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c209/x.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c210/x.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c211/recarry.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c212/deleted.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c213/orphan.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c214/trashed-event.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/LEGAL/c215/x.pdf',
  'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/c216/x.pdf',
  'projects/11500000-AAAA-0000-0000-000000000001/files/c217/x.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c218/s3.bin.jpg',
  'projects/11500000-aaaa-0000-0000-000000000001/files/c301/ok.txt',
  'projects/11500000-bbbb-0000-0000-000000000001/files/c302/x.txt',
  'projects/11500000-aaaa-0000-0000-000000000006/files/c303/x.txt',
  'projects/11500000-aaaa-0000-0000-000000000003/files/c304/x.txt'
]) AS k;
INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES
  ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/c130/x.txt', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, deleted_at) VALUES
  ('11500000-0000-0000-0000-00000000c001', '11500000-aaaa-0000-0000-000000000001', 'held.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c001/held.txt', NULL),
  ('11500000-0000-0000-0000-00000000c002', '11500000-aaaa-0000-0000-000000000001', 'held-trashed.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c002/held-trashed.txt', now()),
  ('11500000-0000-0000-0000-00000000c003', '11500000-bbbb-0000-0000-000000000001', 'theirs.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c003/theirs.txt', NULL),
  ('11500000-0000-0000-0000-00000000c004', '11500000-aaaa-0000-0000-000000000001', 's3.bin', 's3', 'projects/11500000-aaaa-0000-0000-000000000001/files/c004/s3.bin', NULL);
INSERT INTO public.storage_gc_queue (bucket_id, object_path, workspace_id, file_id, reason, provider, kind, status) VALUES
  ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/c109/queued.txt', '11111111-1111-1111-1111-111111111111', '11500000-0000-0000-0000-00000000c109', 'file-purged', 'supabase', 'body', 'pending'),
  ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/c110/failed.txt', '11111111-1111-1111-1111-111111111111', '11500000-0000-0000-0000-00000000c110', 'file-purged', 'supabase', 'body', 'failed'),
  ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/c111/picture.txt.jpg', '11111111-1111-1111-1111-111111111111', '11500000-0000-0000-0000-00000000c111', 'file-purged', 'supabase', 'thumbnail', 'pending'),
  ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/c212/deleted.txt', '11111111-1111-1111-1111-111111111111', '11500000-0000-0000-0000-00000000c212', 'file-purged', 'supabase', 'body', 'deleted'),
  ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/c213/orphan.txt', '11111111-1111-1111-1111-111111111111', NULL, 'orphan-scan', 'supabase', 'body', 'pending');
INSERT INTO public.file_events (workspace_id, project_id, file_id, storage_provider, event, old_path) VALUES
  ('11111111-1111-1111-1111-111111111111', '11500000-aaaa-0000-0000-000000000002', '11500000-0000-0000-0000-00000000c112', 'supabase', 'purged', 'projects/11500000-aaaa-0000-0000-000000000001/files/c112/purged.txt'),
  ('11111111-1111-1111-1111-111111111111', '11500000-aaaa-0000-0000-000000000002', '11500000-0000-0000-0000-00000000c113', 'supabase', 'purged', 'projects/11500000-aaaa-0000-0000-000000000001/files/c113/purged.txt.jpg'),
  ('11111111-1111-1111-1111-111111111111', '11500000-aaaa-0000-0000-000000000001', '11500000-0000-0000-0000-00000000c211', 'supabase', 'purged', 'projects/11500000-aaaa-0000-0000-000000000001/files/c211/recarry.txt'),
  ('11111111-1111-1111-1111-111111111111', '11500000-aaaa-0000-0000-000000000002', '11500000-0000-0000-0000-00000000c214', 'supabase', 'trashed', 'projects/11500000-aaaa-0000-0000-000000000001/files/c214/trashed-event.txt');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000c101', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000002/files/c101/x.txt') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'a key under another project');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000c102', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/bin_files/c102/x.txt') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'a third segment of bin_files');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000c103', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/connection-check/c103/x.txt') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'a third segment of connection-check');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000c105', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'a 3-segment key');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000c106', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c106.txt') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'a 4-segment key');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000c107', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c001/held.txt') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'a key held by another row, answered ahead of the unique index');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000c108', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c002/held-trashed.txt') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'a key held by a trashed row');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000c126', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c003/theirs.txt') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'a key held by a row of another company');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000c127', '11500000-aaaa-0000-0000-000000000001', 'x', 's3', 'projects/11500000-aaaa-0000-0000-000000000001/files/c004/s3.bin') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'an s3 key another row holds');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000c128', '11500000-aaaa-0000-0000-000000000001', 'x', 's3', 'projects/11500000-aaaa-0000-0000-000000000001/files/c004/s3.bin.jpg') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'an s3 key whose bare form another row holds');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000c109', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c109/queued.txt') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'a key waiting in the purge queue');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000c110', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c110/failed.txt') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'a key whose purge failed and will be retried');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000c111', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c111/picture.txt') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'a key whose picture waits in the purge queue');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000c112', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c112/purged.txt') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'a purged moved key');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000c113', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c113/purged.txt') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'a key whose .jpg form is a purged moved key');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000c114', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c114/missing.txt') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'supabase with no object at the key');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000c130', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c130/x.txt') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'an object of that name in another bucket is not its body');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, thumbnail_url)
                    VALUES ('11500000-0000-0000-0000-00000000c115', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c115/pic.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/c115/other.jpg') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'a picture other than path.jpg');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000c116', '11500000-aaaa-0000-0000-000000000001', 'x', 'google_drive', 'projects/11500000-aaaa-0000-0000-000000000001/files/c116/drive.txt') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'the google_drive provider');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000c117', '11500000-aaaa-0000-0000-000000000001', 'x', 'network_share', 'projects/11500000-aaaa-0000-0000-000000000001/files/c117/nas.txt') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'the network_share provider');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, folder_id)
                    VALUES ('11500000-0000-0000-0000-00000000c118', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c118/x.txt', '11500000-0000-0000-0000-0000000000f9') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'another project''s folder, answered ahead of the same-project guard');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, folder_id)
                    VALUES ('11500000-0000-0000-0000-00000000c119', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c119/x.txt', '11500000-0000-0000-0000-0000000000f1') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'a non-money row in a locked folder');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, share_bin_path)
                    VALUES ('11500000-0000-0000-0000-00000000c120', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c120/x.txt', 'bin/c120') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'share_bin_path set');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, share_missing_since)
                    VALUES ('11500000-0000-0000-0000-00000000c121', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c121/x.txt', now()) $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'share_missing_since set');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000c122', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/c122/x.pdf') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'a money key by a non-money member, the object there');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000c123', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/c123/x.pdf') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'the same sentence with no object there');
SELECT is(rabbit_private.file_key_admissible('supabase', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/c122/x.pdf', '11500000-aaaa-0000-0000-000000000001', '11500000-0000-0000-0000-00000000c122', NULL, false), false,
  'the helper answers a non-money member false for a money key whose object is there');
SELECT is(rabbit_private.file_key_admissible('supabase', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/c123/x.pdf', '11500000-aaaa-0000-0000-000000000001', '11500000-0000-0000-0000-00000000c123', NULL, false), false,
  'and false when it is not: nothing here says what exists');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial)
                    VALUES ('11500000-0000-0000-0000-00000000c124', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c124/x.txt', true) $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'the money flag on an ordinary key by a non-money member');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, tags)
                    VALUES ('11500000-0000-0000-0000-00000000c125', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/LEGAL/c125/x.pdf', ARRAY['legal']) $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'a Legal key by a member who cannot see Legal');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000c129', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c301/ok.txt') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'a reviewer: the guard answers ahead of RLS');

-- FINANCE takes someone who may touch money, or the money check would answer first.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000c104', '11500000-aaaa-0000-0000-000000000001', 'x', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/FINANCE/c104/x.pdf') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'a third segment of FINANCE, by someone with money access');

-- The positives.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                   VALUES ('11500000-0000-0000-0000-00000000c201', '11500000-aaaa-0000-0000-000000000001', 'ok.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c201/ok.txt') $$,
  'a valid key with its object is accepted');
SELECT is((SELECT workspace_id FROM public.files WHERE id = '11500000-0000-0000-0000-00000000c201'), '11111111-1111-1111-1111-111111111111'::uuid,
  'and trg_files_populate_workspace still fills the company, though it fires after the guard');
SELECT lives_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                   VALUES ('11500000-0000-0000-0000-00000000c201', '11500000-aaaa-0000-0000-000000000001', 'ok.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c201/ok.txt')
                   ON CONFLICT (id) DO NOTHING $$,
  'the same id and path again with ON CONFLICT (id) DO NOTHING raises nothing');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000c201', '11500000-aaaa-0000-0000-000000000001', 'ok.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c201/ok.txt') $$,
  '23505', NULL, 'and without it reaches the unique violation the migration''s rerun counts as skipped');
SELECT is((SELECT count(*)::int FROM public.files WHERE id = '11500000-0000-0000-0000-00000000c201'), 1, 'still one row');
SELECT lives_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                   VALUES ('11500000-0000-0000-0000-00000000c204', '11500000-aaaa-0000-0000-000000000003', 'local.mov', 'local_server', 'projects/11500000-aaaa-0000-0000-000000000003/files/c204/local.mov') $$,
  'local_server with an admissible key and no object is accepted on a private project');
SELECT lives_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                   VALUES ('11500000-0000-0000-0000-00000000c205', '11500000-aaaa-0000-0000-000000000001', 's3.bin', 's3', 'projects/11500000-aaaa-0000-0000-000000000001/files/c205/s3.bin') $$,
  's3 with an admissible key and no object is accepted: only Supabase can be looked up');
SELECT lives_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                   VALUES ('11500000-0000-0000-0000-00000000c205', '11500000-aaaa-0000-0000-000000000001', 's3.bin', 's3', 'projects/11500000-aaaa-0000-0000-000000000001/files/c205/s3.bin')
                   ON CONFLICT (id) DO NOTHING $$,
  'and its rerun passes: the row is not judged against its own bare form');
SELECT lives_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, thumbnail_url)
                   VALUES ('11500000-0000-0000-0000-00000000c206', '11500000-aaaa-0000-0000-000000000001', 'pic.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c206/pic.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/c206/pic.txt.jpg') $$,
  'a derived picture is accepted');
SELECT lives_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, folder_id)
                   VALUES ('11500000-0000-0000-0000-00000000c207', '11500000-aaaa-0000-0000-000000000001', 'x.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c207/x.txt', '11500000-0000-0000-0000-0000000000f2') $$,
  'a row filed in its project''s working folder is accepted');
SELECT lives_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                   VALUES ('11500000-0000-0000-0000-00000000c211', '11500000-aaaa-0000-0000-000000000001', 'recarry.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c211/recarry.txt') $$,
  'a purged key that never moved is free again: the certificate names its own project');
SELECT lives_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                   VALUES ('11500000-0000-0000-0000-00000000c212', '11500000-aaaa-0000-0000-000000000001', 'deleted.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c212/deleted.txt') $$,
  'a queue row already drained claims nothing');
SELECT lives_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                   VALUES ('11500000-0000-0000-0000-00000000c213', '11500000-aaaa-0000-0000-000000000001', 'orphan.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c213/orphan.txt') $$,
  'a queue row naming no file claims nothing');
SELECT lives_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                   VALUES ('11500000-0000-0000-0000-00000000c214', '11500000-aaaa-0000-0000-000000000001', 'trashed-event.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c214/trashed-event.txt') $$,
  'only a purge certificate claims: a trash event naming the key does not');
SELECT lives_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                   VALUES ('11500000-0000-0000-0000-00000000c217', '11500000-aaaa-0000-0000-000000000001', 'x.txt', 'supabase', 'projects/11500000-AAAA-0000-0000-000000000001/files/c217/x.txt') $$,
  'the second segment is compared case-folded');
SELECT lives_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                   VALUES ('11500000-0000-0000-0000-00000000c218', '11500000-aaaa-0000-0000-000000000001', 's3.bin.jpg', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c218/s3.bin.jpg') $$,
  'CONTROL: a .jpg key is ordinary outside a company''s bucket');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial, folder_id)
                   VALUES ('11500000-0000-0000-0000-00000000c208', '11500000-aaaa-0000-0000-000000000001', 'x.pdf', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/c208/x.pdf', true, '11500000-0000-0000-0000-0000000000f1') $$,
  'someone with money access files a money row in a locked folder');
SELECT lives_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial)
                   VALUES ('11500000-0000-0000-0000-00000000c209', '11500000-aaaa-0000-0000-000000000001', 'x.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c209/x.txt', true) $$,
  'and adds a flagged row under an ordinary key');
SELECT lives_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial, folder_id)
                   VALUES ('11500000-0000-0000-0000-00000000c210', '11500000-aaaa-0000-0000-000000000001', 'x.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c210/x.txt', true, '11500000-0000-0000-0000-0000000000f1') $$,
  'and files that flagged row in a locked folder: the flag alone makes it money');

-- A workspace manager with no seat sees Legal, and not money.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, tags)
                   VALUES ('11500000-0000-0000-0000-00000000c215', '11500000-aaaa-0000-0000-000000000001', 'x.pdf', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/LEGAL/c215/x.pdf', ARRAY['legal']) $$,
  'a workspace manager adds a Legal row');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000c216', '11500000-aaaa-0000-0000-000000000001', 'x.pdf', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/c216/x.pdf') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'and not an invoice');

-- The caller's rights on the project, one at a time, the helper asked directly.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(rabbit_private.file_key_admissible('supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c301/ok.txt', '11500000-aaaa-0000-0000-000000000001', '11500000-0000-0000-0000-00000000c301', NULL, false), true,
  'CONTROL: the helper admits a good key for someone who writes the project');
SELECT is(rabbit_private.file_key_admissible('supabase', 'projects/11500000-bbbb-0000-0000-000000000001/files/c302/x.txt', '11500000-bbbb-0000-0000-000000000001', '11500000-0000-0000-0000-00000000c302', NULL, false), false,
  'another company''s project: false');
SELECT is(rabbit_private.file_key_admissible('supabase', 'projects/11500000-aaaa-0000-0000-000000000006/files/c303/x.txt', '11500000-aaaa-0000-0000-000000000006', '11500000-0000-0000-0000-00000000c303', NULL, false), false,
  'a binned project: false');
SELECT is(rabbit_private.file_key_admissible(NULL, 'projects/11500000-aaaa-0000-0000-000000000001/files/c301/ok.txt', '11500000-aaaa-0000-0000-000000000001', '11500000-0000-0000-0000-00000000c301', NULL, false), false,
  'a NULL provider: false, never NULL');
SELECT is(rabbit_private.file_key_admissible('supabase', NULL, '11500000-aaaa-0000-0000-000000000001', '11500000-0000-0000-0000-00000000c301', NULL, false), false,
  'a NULL path: false, never NULL');
SELECT is(rabbit_private.file_key_admissible('supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c301/ok.txt', NULL, '11500000-0000-0000-0000-00000000c301', NULL, false), false,
  'a NULL project: false, never NULL');
SELECT is(rabbit_private.file_key_admissible('supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c301/ok.txt', '11500000-aaaa-0000-0000-000000000001', NULL, NULL, false), true,
  'a NULL file id excludes nothing: the key is still free');
SELECT is(rabbit_private.file_key_admissible('supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c301/ok.txt', '11500000-aaaa-0000-0000-000000000001', '11500000-0000-0000-0000-00000000c301', '11500000-dead-dead-dead-000000000000', false), false,
  'a folder that does not exist: false');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(rabbit_private.file_key_admissible('supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c301/ok.txt', '11500000-aaaa-0000-0000-000000000001', '11500000-0000-0000-0000-00000000c301', NULL, false), false,
  'a reviewer does not write the project: false');
SELECT is(rabbit_private.file_key_admissible('supabase', 'projects/11500000-aaaa-0000-0000-000000000003/files/c304/x.txt', '11500000-aaaa-0000-0000-000000000003', '11500000-0000-0000-0000-00000000c304', NULL, false), false,
  'a private project someone else made: false');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '99999999-9999-9999-9999-999999999999', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(rabbit_private.file_key_admissible('supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c301/ok.txt', '11500000-aaaa-0000-0000-000000000001', '11500000-0000-0000-0000-00000000c301', NULL, false), false,
  'an inactive member whose token still says they belong: false');
SELECT set_config('request.jwt.claims', '{}', true);
SELECT is(rabbit_private.file_key_admissible('supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/c301/ok.txt', '11500000-aaaa-0000-0000-000000000001', '11500000-0000-0000-0000-00000000c301', NULL, false), false,
  'no company in the token: false, never NULL');


-- ── D. Arm 2: bound definers ─────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, folder_id) VALUES
  ('11500000-0000-0000-0000-00000000d001', '11500000-aaaa-0000-0000-000000000001', 'a.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/d001/a.txt', '11500000-0000-0000-0000-0000000000f2'),
  ('11500000-0000-0000-0000-00000000d002', '11500000-aaaa-0000-0000-000000000001', 'a.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/d002/a.txt', '11500000-0000-0000-0000-0000000000f2'),
  ('11500000-0000-0000-0000-00000000d003', '11500000-aaaa-0000-0000-000000000001', 'a.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/d003/a.txt', '11500000-0000-0000-0000-0000000000f2'),
  ('11500000-0000-0000-0000-00000000d004', '11500000-aaaa-0000-0000-000000000001', 'a.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/d004/a.txt', NULL),
  ('11500000-0000-0000-0000-00000000d005', '11500000-aaaa-0000-0000-000000000001', 'a.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/d005/a.txt', '11500000-0000-0000-0000-0000000000f4'),
  ('11500000-0000-0000-0000-00000000d006', '11500000-aaaa-0000-0000-000000000001', 'a.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/d006/a.txt', '11500000-0000-0000-0000-0000000000f2'),
  ('11500000-0000-0000-0000-00000000d007', '11500000-aaaa-0000-0000-000000000001', 'a.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/d007/a.txt', '11500000-0000-0000-0000-0000000000f2'),
  ('11500000-0000-0000-0000-00000000d008', '11500000-aaaa-0000-0000-000000000001', 'a.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/d008/a.txt', '11500000-0000-0000-0000-0000000000f2'),
  ('11500000-0000-0000-0000-00000000d009', '11500000-aaaa-0000-0000-000000000003', 'local.mov', 'local_server', 'projects/11500000-aaaa-0000-0000-000000000003/files/d009/local.mov', NULL),
  ('11500000-0000-0000-0000-00000000d010', '11500000-aaaa-0000-0000-000000000001', 'a.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/d010/a.txt', NULL),
  ('11500000-0000-0000-0000-00000000d011', '11500000-aaaa-0000-0000-000000000001', 'a.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/d011/a.txt', '11500000-0000-0000-0000-0000000000f2');
-- The journal rows a marker will name: another transaction's, and another person's.
INSERT INTO public.file_moves (id, workspace_id, actor_user_id, txid, items) VALUES
  ('11500000-0000-0000-0000-00000000d101', '11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', txid_current() - 1,
   '[{"id":"11500000-0000-0000-0000-00000000d008","to_project":"11500000-aaaa-0000-0000-000000000002","to_folder":"11500000-0000-0000-0000-0000000000f9","to_provider":"supabase","to_path":"projects/11500000-aaaa-0000-0000-000000000002/files/d008/new.txt"}]'),
  ('11500000-0000-0000-0000-00000000d102', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', txid_current(),
   '[{"id":"11500000-0000-0000-0000-00000000d001","to_project":"11500000-aaaa-0000-0000-000000000002","to_folder":"11500000-0000-0000-0000-0000000000f9","to_provider":"supabase","to_path":"projects/11500000-aaaa-0000-0000-000000000002/files/d001/new.txt"}]');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.t115_exec($q$ UPDATE public.files SET project_id = '11500000-aaaa-0000-0000-000000000002' WHERE id = '11500000-0000-0000-0000-00000000d001' $q$) $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'a definer''s change of project_id, no marker');
SELECT throws_ok($$ SELECT public.t115_exec($q$ UPDATE public.files SET folder_id = '11500000-0000-0000-0000-0000000000f3' WHERE id = '11500000-0000-0000-0000-00000000d001' $q$) $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'a definer''s change of folder_id to a folder, no marker');
SELECT throws_ok($$ SELECT public.t115_exec($q$ UPDATE public.files SET storage_path = 'projects/11500000-aaaa-0000-0000-000000000001/files/d001/b.txt' WHERE id = '11500000-0000-0000-0000-00000000d001' $q$) $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'a definer''s change of storage_path, no marker');
SELECT throws_ok($$ SELECT public.t115_exec($q$ UPDATE public.files SET workspace_id = '22222222-2222-2222-2222-222222222222' WHERE id = '11500000-0000-0000-0000-00000000d001' $q$) $$,
  '42501', 'A file stays in its company.', 'a definer''s change of workspace_id, no marker');
SELECT throws_ok($$ SELECT public.t115_exec($q$ UPDATE public.files SET storage_provider = 's3' WHERE id = '11500000-0000-0000-0000-00000000d001' $q$) $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'a definer''s change of storage_provider, no marker');
SELECT throws_ok($$ SELECT public.t115_exec($q$ UPDATE public.files SET thumbnail_url = storage_path || '.jpg' WHERE id = '11500000-0000-0000-0000-00000000d001' $q$) $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'a definer''s change of thumbnail_url, no marker');
SELECT throws_ok($$ SELECT public.t115_exec($q$ UPDATE public.files SET is_financial = true WHERE id = '11500000-0000-0000-0000-00000000d001' $q$) $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'a definer''s change of is_financial, no marker');
SELECT throws_ok($$ SELECT public.t115_exec($q$ UPDATE public.files SET share_missing_since = now() WHERE id = '11500000-0000-0000-0000-00000000d001' $q$) $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'a definer''s change of share_missing_since, no marker');
SELECT throws_ok($$ SELECT public.t115_exec($q$ UPDATE public.files SET share_bin_path = 'bin/d001' WHERE id = '11500000-0000-0000-0000-00000000d001' $q$) $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'a definer''s change of share_bin_path, no marker');
SELECT throws_ok($$ SELECT public.t115_exec($q$ UPDATE public.files SET id = '11500000-0000-0000-0000-00000000d0ff' WHERE id = '11500000-0000-0000-0000-00000000d001' $q$) $$,
  '42501', 'A file keeps its id.', 'a definer cannot change a file''s id');
SELECT lives_ok($$ SELECT public.t115_exec($q$ UPDATE public.files SET description = 'a definer''s edit' WHERE id = '11500000-0000-0000-0000-00000000d001' $q$) $$,
  'CONTROL: a definer''s edit of anything else passes');
SELECT is((SELECT description FROM public.files WHERE id = '11500000-0000-0000-0000-00000000d001'), 'a definer''s edit', 'and it lands');
SELECT lives_ok($$ SELECT public.t115_exec($q$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                                              VALUES ('11500000-0000-0000-0000-00000000d012', '11500000-aaaa-0000-0000-000000000001', 'a.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/d012/no-object.txt') $q$) $$,
  'CONTROL: arm 2 judges changes: a definer''s insert passes');
SELECT is((SELECT count(*)::int FROM public.files WHERE id = '11500000-0000-0000-0000-00000000d012'), 1, 'and the row is there');
SELECT is(pg_temp.t115_ask($$ SELECT public.soft_delete_row('files', '11500000-0000-0000-0000-00000000d010') $$), 'true', 'CONTROL: soft_delete_row still trashes an ordinary row');
SELECT is(pg_temp.t115_ask($$ SELECT public.restore_soft_deleted('files', '11500000-0000-0000-0000-00000000d010') $$), 'true', 'CONTROL: and restore_soft_deleted brings it back');

-- The journal: exactly its own values, or nothing.
SELECT throws_ok($$ SELECT public.t115_journal_move(
    '{"id":"11500000-0000-0000-0000-00000000d004","to_project":"11500000-aaaa-0000-0000-000000000002","to_folder":"11500000-0000-0000-0000-0000000000f9","to_provider":"supabase","to_path":"projects/11500000-aaaa-0000-0000-000000000002/files/d001/new.txt"}',
    $q$ UPDATE public.files SET project_id = '11500000-aaaa-0000-0000-000000000002', folder_id = '11500000-0000-0000-0000-0000000000f9', storage_path = 'projects/11500000-aaaa-0000-0000-000000000002/files/d001/new.txt' WHERE id = '11500000-0000-0000-0000-00000000d001' $q$) $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'a journal naming another file');
SELECT throws_ok($$ SELECT public.t115_journal_move(
    '{"id":"11500000-0000-0000-0000-00000000d001","to_project":"11500000-aaaa-0000-0000-000000000003","to_folder":"11500000-0000-0000-0000-0000000000f9","to_provider":"supabase","to_path":"projects/11500000-aaaa-0000-0000-000000000002/files/d001/new.txt"}',
    $q$ UPDATE public.files SET project_id = '11500000-aaaa-0000-0000-000000000002', folder_id = '11500000-0000-0000-0000-0000000000f9', storage_path = 'projects/11500000-aaaa-0000-0000-000000000002/files/d001/new.txt' WHERE id = '11500000-0000-0000-0000-00000000d001' $q$) $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'a journal naming another project');
SELECT throws_ok($$ SELECT public.t115_journal_move(
    '{"id":"11500000-0000-0000-0000-00000000d001","to_project":"11500000-aaaa-0000-0000-000000000002","to_folder":null,"to_provider":"supabase","to_path":"projects/11500000-aaaa-0000-0000-000000000002/files/d001/new.txt"}',
    $q$ UPDATE public.files SET project_id = '11500000-aaaa-0000-0000-000000000002', folder_id = '11500000-0000-0000-0000-0000000000f9', storage_path = 'projects/11500000-aaaa-0000-0000-000000000002/files/d001/new.txt' WHERE id = '11500000-0000-0000-0000-00000000d001' $q$) $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'a journal naming another folder');
SELECT throws_ok($$ SELECT public.t115_journal_move(
    '{"id":"11500000-0000-0000-0000-00000000d001","to_project":"11500000-aaaa-0000-0000-000000000002","to_folder":"11500000-0000-0000-0000-0000000000f9","to_provider":"s3","to_path":"projects/11500000-aaaa-0000-0000-000000000002/files/d001/new.txt"}',
    $q$ UPDATE public.files SET project_id = '11500000-aaaa-0000-0000-000000000002', folder_id = '11500000-0000-0000-0000-0000000000f9', storage_path = 'projects/11500000-aaaa-0000-0000-000000000002/files/d001/new.txt' WHERE id = '11500000-0000-0000-0000-00000000d001' $q$) $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'a journal naming another provider');
SELECT throws_ok($$ SELECT public.t115_journal_move(
    '{"id":"11500000-0000-0000-0000-00000000d001","to_project":"11500000-aaaa-0000-0000-000000000002","to_folder":"11500000-0000-0000-0000-0000000000f9","to_provider":"supabase","to_path":"projects/11500000-aaaa-0000-0000-000000000002/files/d001/other.txt"}',
    $q$ UPDATE public.files SET project_id = '11500000-aaaa-0000-0000-000000000002', folder_id = '11500000-0000-0000-0000-0000000000f9', storage_path = 'projects/11500000-aaaa-0000-0000-000000000002/files/d001/new.txt' WHERE id = '11500000-0000-0000-0000-00000000d001' $q$) $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'a journal naming another path');
SELECT throws_ok($$ SELECT public.t115_journal_move(
    '{"id":"11500000-0000-0000-0000-00000000d001","to_project":"11500000-aaaa-0000-0000-000000000001","to_folder":"11500000-0000-0000-0000-0000000000f2","to_provider":"supabase","to_path":"projects/11500000-aaaa-0000-0000-000000000001/files/d001/a.txt"}',
    $q$ UPDATE public.files SET workspace_id = '22222222-2222-2222-2222-222222222222' WHERE id = '11500000-0000-0000-0000-00000000d001' $q$) $$,
  '42501', 'A file stays in its company.', 'workspace_id is refused even with a matching journal');
SELECT throws_ok($$ SELECT public.t115_marked('wilson.file_move', '11500000-0000-0000-0000-00000000d102',
    $q$ UPDATE public.files SET project_id = '11500000-aaaa-0000-0000-000000000002', folder_id = '11500000-0000-0000-0000-0000000000f9', storage_path = 'projects/11500000-aaaa-0000-0000-000000000002/files/d001/new.txt' WHERE id = '11500000-0000-0000-0000-00000000d001' $q$) $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'a marker naming another person''s journal row');
SELECT throws_ok($$ SELECT public.t115_marked('wilson.file_move', '11500000-0000-0000-0000-00000000d101',
    $q$ UPDATE public.files SET project_id = '11500000-aaaa-0000-0000-000000000002', folder_id = '11500000-0000-0000-0000-0000000000f9', storage_path = 'projects/11500000-aaaa-0000-0000-000000000002/files/d008/new.txt' WHERE id = '11500000-0000-0000-0000-00000000d008' $q$) $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'a marker naming another transaction''s row');
SELECT is((SELECT project_id FROM public.files WHERE id = '11500000-0000-0000-0000-00000000d001'), '11500000-aaaa-0000-0000-000000000001'::uuid, 'none of those moved it');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
UPDATE public.file_moves SET txid = txid_current() WHERE id = '11500000-0000-0000-0000-00000000d101';
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.t115_marked('wilson.file_move', '11500000-0000-0000-0000-00000000d101',
    $q$ UPDATE public.files SET project_id = '11500000-aaaa-0000-0000-000000000002', folder_id = '11500000-0000-0000-0000-0000000000f9', storage_path = 'projects/11500000-aaaa-0000-0000-000000000002/files/d008/new.txt' WHERE id = '11500000-0000-0000-0000-00000000d008' $q$) $$,
  'CONTROL: the same row, this transaction''s now, admits it: the transaction was the reason');
SELECT is((SELECT project_id FROM public.files WHERE id = '11500000-0000-0000-0000-00000000d008'), '11500000-aaaa-0000-0000-000000000002'::uuid, 'and the row moved');
SELECT lives_ok($$ SELECT public.t115_journal_move(
    '{"id":"11500000-0000-0000-0000-00000000d002","how":"metadata","to_project":"11500000-aaaa-0000-0000-000000000002","to_folder":"11500000-0000-0000-0000-0000000000f9","to_provider":"supabase","to_path":"projects/11500000-aaaa-0000-0000-000000000002/files/d002/new.txt"}',
    $q$ UPDATE public.files SET project_id = '11500000-aaaa-0000-0000-000000000002', folder_id = '11500000-0000-0000-0000-0000000000f9', storage_path = 'projects/11500000-aaaa-0000-0000-000000000002/files/d002/new.txt' WHERE id = '11500000-0000-0000-0000-00000000d002' $q$) $$,
  'a definer that writes the journal, sets the marker and then updates to exactly those values is admitted: the STABLE admission sees the row from inside a BEFORE trigger');
SELECT is((SELECT project_id::text || '|' || folder_id::text || '|' || storage_provider::text || '|' || storage_path FROM public.files WHERE id = '11500000-0000-0000-0000-00000000d002'),
  '11500000-aaaa-0000-0000-000000000002|11500000-0000-0000-0000-0000000000f9|supabase|projects/11500000-aaaa-0000-0000-000000000002/files/d002/new.txt', 'and the row moved');
SELECT lives_ok($$ SELECT public.t115_journal_move(
    '{"id":"11500000-0000-0000-0000-00000000d009","how":"copy_up","to_project":"11500000-aaaa-0000-0000-000000000002","to_folder":null,"to_provider":"supabase","to_path":"projects/11500000-aaaa-0000-0000-000000000002/files/d009/local.mov"}',
    $q$ UPDATE public.files SET project_id = '11500000-aaaa-0000-0000-000000000002', storage_provider = 'supabase', storage_path = 'projects/11500000-aaaa-0000-0000-000000000002/files/d009/local.mov' WHERE id = '11500000-0000-0000-0000-00000000d009' $q$) $$,
  'the journal admits a provider change with the move, a NULL folder matching a NULL folder');
SELECT is((SELECT storage_provider::text FROM public.files WHERE id = '11500000-0000-0000-0000-00000000d009'), 'supabase', 'and the row is on the new provider');

-- The re-key marker is bound to one file, and is about the locator.
SELECT throws_ok($$ SELECT public.t115_marked('wilson.body_rekey', 'file:11500000-0000-0000-0000-00000000d004',
    $q$ UPDATE public.files SET storage_path = 'projects/11500000-aaaa-0000-0000-000000000001/files/d001/b.txt' WHERE id = '11500000-0000-0000-0000-00000000d001' $q$) $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'wilson.body_rekey naming another file');
SELECT throws_ok($$ SELECT public.t115_marked('wilson.body_rekey', 'on',
    $q$ UPDATE public.files SET storage_path = 'projects/11500000-aaaa-0000-0000-000000000001/files/d001/b.txt' WHERE id = '11500000-0000-0000-0000-00000000d001' $q$) $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'wilson.body_rekey that names no file');
SELECT lives_ok($$ SELECT public.t115_marked('wilson.body_rekey', 'file:11500000-0000-0000-0000-00000000d003',
    $q$ UPDATE public.files SET storage_path = 'projects/11500000-aaaa-0000-0000-000000000001/files/d003/b.txt', thumbnail_url = 'projects/11500000-aaaa-0000-0000-000000000001/files/d003/b.txt.jpg' WHERE id = '11500000-0000-0000-0000-00000000d003' $q$) $$,
  'wilson.body_rekey naming this file admits a locator change');
SELECT is((SELECT storage_path FROM public.files WHERE id = '11500000-0000-0000-0000-00000000d003'), 'projects/11500000-aaaa-0000-0000-000000000001/files/d003/b.txt', 'and the locator changed');
SELECT throws_ok($$ SELECT public.t115_marked('wilson.body_rekey', 'file:11500000-0000-0000-0000-00000000d003',
    $q$ UPDATE public.files SET project_id = '11500000-aaaa-0000-0000-000000000002', folder_id = NULL WHERE id = '11500000-0000-0000-0000-00000000d003' $q$) $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'and does not admit a project change');
SELECT throws_ok($$ SELECT public.t115_marked('wilson.body_rekey', 'file:11500000-0000-0000-0000-00000000d003',
    $q$ UPDATE public.files SET folder_id = '11500000-0000-0000-0000-0000000000f3' WHERE id = '11500000-0000-0000-0000-00000000d003' $q$) $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'nor a folder change');
SELECT throws_ok($$ SELECT public.t115_marked('wilson.body_rekey', 'file:11500000-0000-0000-0000-00000000d003',
    $q$ UPDATE public.files SET storage_provider = 's3' WHERE id = '11500000-0000-0000-0000-00000000d003' $q$) $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'nor a provider change');

-- The office-server marker means nothing on an ordinary row.
SELECT throws_ok($$ SELECT public.t115_marked('wilson.network_share_writer', 'op:11500000-0000-0000-0000-00000000d001',
    $q$ UPDATE public.files SET storage_path = 'projects/11500000-aaaa-0000-0000-000000000001/files/d001/b.txt' WHERE id = '11500000-0000-0000-0000-00000000d001' $q$) $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'wilson.network_share_writer naming an ordinary row');
SELECT throws_ok($$ SELECT public.t115_marked('wilson.network_share_writer', 'check:11500000-aaaa-0000-0000-000000000001',
    $q$ UPDATE public.files SET storage_path = 'projects/11500000-aaaa-0000-0000-000000000001/files/d001/b.txt' WHERE id = '11500000-0000-0000-0000-00000000d001' $q$) $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'wilson.network_share_writer naming an ordinary row''s project');

-- The foreign key's own SET NULL runs as the table's owner, with the client's role setting.
SELECT lives_ok($$ DELETE FROM public.folders WHERE id = '11500000-0000-0000-0000-0000000000f4' $$,
  'a client deletes an ordinary folder');
SELECT is((SELECT folder_id IS NULL AND project_id = '11500000-aaaa-0000-0000-000000000001' FROM public.files WHERE id = '11500000-0000-0000-0000-00000000d005'), true,
  'and the foreign key leaves the file in its project with folder_id NULL');

-- Unbound sessions pass everything.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path) VALUES
  ('11500000-0000-0000-0000-00000000d0f0', '11500000-aaaa-0000-0000-000000000001', 'a.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/d0f0/a.txt');
SELECT lives_ok($$ UPDATE public.files SET id = '11500000-0000-0000-0000-00000000d0f1' WHERE id = '11500000-0000-0000-0000-00000000d0f0' $$,
  'the runner, unbound, may change a file''s id');
SELECT lives_ok($$ UPDATE public.files
                      SET project_id = '11500000-aaaa-0000-0000-000000000002', folder_id = '11500000-0000-0000-0000-0000000000f9', workspace_id = '22222222-2222-2222-2222-222222222222', storage_provider = 's3',
                          storage_path = 'projects/11500000-aaaa-0000-0000-000000000002/files/d006/new.bin', thumbnail_url = 'other.jpg',
                          share_missing_since = now(), share_bin_path = 'bin/d006'
                    WHERE id = '11500000-0000-0000-0000-00000000d006' $$,
  'the runner, unbound, changes every guarded column at once');
SELECT is((SELECT project_id::text || '|' || folder_id::text || '|' || workspace_id::text || '|' || storage_provider::text
                  || '|' || storage_path || '|' || thumbnail_url || '|' || (share_missing_since IS NOT NULL)::text || '|' || share_bin_path
             FROM public.files WHERE id = '11500000-0000-0000-0000-00000000d006'),
  '11500000-aaaa-0000-0000-000000000002|11500000-0000-0000-0000-0000000000f9|22222222-2222-2222-2222-222222222222|s3|projects/11500000-aaaa-0000-0000-000000000002/files/d006/new.bin|other.jpg|true|bin/d006', 'and every one of them changed');
SELECT lives_ok($$ UPDATE public.files SET is_financial = true WHERE id = '11500000-0000-0000-0000-00000000d011' $$,
  'and the money flag');
SELECT is((SELECT is_financial FROM public.files WHERE id = '11500000-0000-0000-0000-00000000d011'), true, 'which changed too');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SELECT lives_ok($$ UPDATE public.files SET storage_path = 'projects/11500000-aaaa-0000-0000-000000000001/files/d011/new.txt', folder_id = NULL WHERE id = '11500000-0000-0000-0000-00000000d011' $$,
  'the runner with a user''s claims is still unbound');
SELECT is((SELECT storage_path FROM public.files WHERE id = '11500000-0000-0000-0000-00000000d011' AND folder_id IS NULL), 'projects/11500000-aaaa-0000-0000-000000000001/files/d011/new.txt', 'and the row changed');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;
SELECT lives_ok($$ UPDATE public.files SET storage_path = 'projects/11500000-aaaa-0000-0000-000000000001/files/d007/new.txt', folder_id = NULL WHERE id = '11500000-0000-0000-0000-00000000d007' $$,
  'service_role is unbound');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT is((SELECT storage_path FROM public.files WHERE id = '11500000-0000-0000-0000-00000000d007' AND folder_id IS NULL), 'projects/11500000-aaaa-0000-0000-000000000001/files/d007/new.txt', 'and the row changed');


-- ── E. Arm 3: an office-server row is the catalogue's ────────────────────────
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, size_bytes, mime_type, source_modified_at, deleted_at) VALUES
  ('11500000-0000-0000-0000-00000000e001', '11500000-aaaa-0000-0000-000000000001', 'a.mov', 'network_share', 'nas:Shared S/e001/a.mov', 10, 'video/mp4', '2026-01-01', NULL),
  ('11500000-0000-0000-0000-00000000e002', '11500000-aaaa-0000-0000-000000000001', 'a.mov', 'network_share', 'nas:Shared S/e002/a.mov', 10, 'video/mp4', '2026-01-01', NULL),
  ('11500000-0000-0000-0000-00000000e003', '11500000-aaaa-0000-0000-000000000001', 'a.mov', 'network_share', 'nas:Shared S/e003/a.mov', 10, 'video/mp4', '2026-01-01', now()),
  ('11500000-0000-0000-0000-00000000e004', '11500000-aaaa-0000-0000-000000000001', 'a.mov', 'network_share', 'nas:Shared S/e004/a.mov', 10, 'video/mp4', '2026-01-01', NULL),
  ('11500000-0000-0000-0000-00000000e005', '11500000-aaaa-0000-0000-000000000001', 'a.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/e005/a.txt', 10, 'text/plain', NULL, NULL),
  ('11500000-0000-0000-0000-00000000e006', '11500000-aaaa-0000-0000-000000000001', 'a.mov', 'network_share', 'nas:Shared S/e006/a.mov', 10, 'video/mp4', '2026-01-01', NULL);

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ UPDATE public.files SET deleted_at = now() WHERE id = '11500000-0000-0000-0000-00000000e001' $$,
  '42501', 'A file on your office server changes only through the desktop app.', 'a client''s change of deleted_at');
SELECT throws_ok($$ UPDATE public.files SET deleted_by = auth.uid() WHERE id = '11500000-0000-0000-0000-00000000e001' $$,
  '42501', 'A file on your office server changes only through the desktop app.', 'a client''s change of deleted_by');
SELECT throws_ok($$ UPDATE public.files SET size_bytes = 11 WHERE id = '11500000-0000-0000-0000-00000000e001' $$,
  '42501', 'A file on your office server changes only through the desktop app.', 'a client''s change of size_bytes');
SELECT throws_ok($$ UPDATE public.files SET mime_type = 'video/quicktime' WHERE id = '11500000-0000-0000-0000-00000000e001' $$,
  '42501', 'A file on your office server changes only through the desktop app.', 'a client''s change of mime_type');
SELECT throws_ok($$ UPDATE public.files SET source_modified_at = '2026-02-02' WHERE id = '11500000-0000-0000-0000-00000000e001' $$,
  '42501', 'A file on your office server changes only through the desktop app.', 'a client''s change of source_modified_at');
SELECT throws_ok($$ UPDATE public.files SET share_missing_since = now() WHERE id = '11500000-0000-0000-0000-00000000e001' $$,
  '42501', 'A file on your office server changes only through the desktop app.', 'a client''s change of share_missing_since');
SELECT throws_ok($$ UPDATE public.files SET share_bin_path = 'bin/e001' WHERE id = '11500000-0000-0000-0000-00000000e001' $$,
  '42501', 'A file on your office server changes only through the desktop app.', 'a client''s change of share_bin_path');
SELECT throws_ok($$ SELECT public.t115_exec($q$ UPDATE public.files SET deleted_at = now() WHERE id = '11500000-0000-0000-0000-00000000e001' $q$) $$,
  '42501', 'A file on your office server changes only through the desktop app.', 'a definer''s change of deleted_at');
SELECT throws_ok($$ SELECT public.t115_exec($q$ UPDATE public.files SET deleted_by = auth.uid() WHERE id = '11500000-0000-0000-0000-00000000e001' $q$) $$,
  '42501', 'A file on your office server changes only through the desktop app.', 'a definer''s change of deleted_by');
SELECT throws_ok($$ SELECT public.t115_exec($q$ UPDATE public.files SET size_bytes = 11 WHERE id = '11500000-0000-0000-0000-00000000e001' $q$) $$,
  '42501', 'A file on your office server changes only through the desktop app.', 'a definer''s change of size_bytes');
SELECT throws_ok($$ SELECT public.t115_exec($q$ UPDATE public.files SET mime_type = 'video/quicktime' WHERE id = '11500000-0000-0000-0000-00000000e001' $q$) $$,
  '42501', 'A file on your office server changes only through the desktop app.', 'a definer''s change of mime_type');
SELECT throws_ok($$ SELECT public.t115_exec($q$ UPDATE public.files SET source_modified_at = '2026-02-02' WHERE id = '11500000-0000-0000-0000-00000000e001' $q$) $$,
  '42501', 'A file on your office server changes only through the desktop app.', 'a definer''s change of source_modified_at');
SELECT throws_ok($$ SELECT public.t115_exec($q$ UPDATE public.files SET share_missing_since = now() WHERE id = '11500000-0000-0000-0000-00000000e001' $q$) $$,
  '42501', 'A file on your office server changes only through the desktop app.', 'a definer''s change of share_missing_since');
SELECT throws_ok($$ SELECT public.t115_exec($q$ UPDATE public.files SET share_bin_path = 'bin/e001' WHERE id = '11500000-0000-0000-0000-00000000e001' $q$) $$,
  '42501', 'A file on your office server changes only through the desktop app.', 'a definer''s change of share_bin_path');
SELECT throws_ok($$ SELECT public.soft_delete_row('files', '11500000-0000-0000-0000-00000000e001') $$,
  '42501', 'A file on your office server changes only through the desktop app.', 'soft_delete_row called by a client on an office-server row');
SELECT throws_ok($$ SELECT public.restore_soft_deleted('files', '11500000-0000-0000-0000-00000000e003') $$,
  '42501', 'A file on your office server changes only through the desktop app.', 'and restore_soft_deleted on a trashed one');
SELECT throws_ok($$ UPDATE public.files SET storage_path = 'nas:Shared S/e001/b.mov' WHERE id = '11500000-0000-0000-0000-00000000e001' $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'a client''s change of its locator meets arm 1');
SELECT lives_ok($$ UPDATE public.files SET description = 'on the share' WHERE id = '11500000-0000-0000-0000-00000000e001' $$,
  'a client''s description edit passes');
SELECT is((SELECT description FROM public.files WHERE id = '11500000-0000-0000-0000-00000000e001'), 'on the share', 'and lands');
SELECT lives_ok($$ UPDATE public.files SET size_bytes = 10, mime_type = 'video/mp4', deleted_at = NULL, share_bin_path = NULL WHERE id = '11500000-0000-0000-0000-00000000e001' $$,
  'and resending the same catalogue values passes');
SELECT lives_ok($$ UPDATE public.files SET size_bytes = 11, mime_type = 'text/html' WHERE id = '11500000-0000-0000-0000-00000000e005' $$,
  'CONTROL: the same columns are a client''s on an ordinary row');
SELECT is((SELECT size_bytes FROM public.files WHERE id = '11500000-0000-0000-0000-00000000e005'), 11::bigint, 'and they land');

-- The writer's marker, bound to this row or this project.
SELECT lives_ok($$ SELECT public.t115_marked('wilson.network_share_writer', 'op:11500000-0000-0000-0000-00000000e001',
    $q$ UPDATE public.files SET size_bytes = 12, mime_type = 'video/webm', source_modified_at = '2026-03-03',
                                share_missing_since = '2026-04-04', share_bin_path = 'bin/e001', deleted_at = '2026-05-05', deleted_by = auth.uid()
        WHERE id = '11500000-0000-0000-0000-00000000e001' $q$) $$,
  'a definer with the marker naming this row changes the catalogue''s columns');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT is((SELECT size_bytes FROM public.files WHERE id = '11500000-0000-0000-0000-00000000e001' AND share_bin_path = 'bin/e001' AND deleted_at IS NOT NULL), 12::bigint,
  'and they changed');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.t115_marked('wilson.network_share_writer', 'check:11500000-aaaa-0000-0000-000000000001',
    $q$ UPDATE public.files SET size_bytes = 13 WHERE id = '11500000-0000-0000-0000-00000000e002' $q$) $$,
  'a definer with the marker naming this project changes them');
SELECT is((SELECT size_bytes FROM public.files WHERE id = '11500000-0000-0000-0000-00000000e002'), 13::bigint, 'and it changed');
SELECT lives_ok($$ SELECT public.t115_marked('wilson.network_share_writer', 'check:11500000-aaaa-0000-0000-000000000001',
    $q$ UPDATE public.files SET storage_path = 'nas:Shared S/e002/b.mov', folder_id = '11500000-0000-0000-0000-0000000000f2' WHERE id = '11500000-0000-0000-0000-00000000e002' $q$) $$,
  'and changes its locator and folder: the third admission');
SELECT is((SELECT storage_path FROM public.files WHERE id = '11500000-0000-0000-0000-00000000e002'), 'nas:Shared S/e002/b.mov', 'and they changed');
SELECT lives_ok($$ SELECT public.t115_marked('wilson.network_share_writer', 'op:11500000-0000-0000-0000-00000000e005',
    $q$ UPDATE public.files SET storage_provider = 'network_share', storage_path = 'nas:Shared S/e005/a.txt' WHERE id = '11500000-0000-0000-0000-00000000e005' $q$) $$,
  'and adopts an ordinary row onto the share under the row''s own marker');
SELECT is((SELECT storage_provider::text FROM public.files WHERE id = '11500000-0000-0000-0000-00000000e005'), 'network_share', 'and it is on the share');
SELECT lives_ok($$ SELECT public.t115_marked('wilson.network_share_writer', 'op:11500000-0000-0000-0000-00000000e006', $q$ SELECT public.soft_delete_row('files', '11500000-0000-0000-0000-00000000e006') $q$) $$,
  'soft_delete_row itself passes under the row''s own marker: the way the trash RPC will call it');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT is((SELECT deleted_by FROM public.files WHERE id = '11500000-0000-0000-0000-00000000e006' AND deleted_at IS NOT NULL), 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'the row is trashed, in the caller''s name');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.t115_marked('wilson.network_share_writer', 'op:11500000-0000-0000-0000-00000000e006', $q$ SELECT public.restore_soft_deleted('files', '11500000-0000-0000-0000-00000000e006') $q$) $$,
  'and restore_soft_deleted, likewise');
SELECT is((SELECT count(*)::int FROM public.files WHERE id = '11500000-0000-0000-0000-00000000e006'), 1, 'and the row is back in sight');
SELECT throws_ok($$ SELECT public.t115_marked('wilson.network_share_writer', 'op:11500000-0000-0000-0000-00000000e002',
    $q$ UPDATE public.files SET size_bytes = 14 WHERE id = '11500000-0000-0000-0000-00000000e004' $q$) $$,
  '42501', 'A file on your office server changes only through the desktop app.', 'the marker naming another row is refused');
SELECT throws_ok($$ SELECT public.t115_marked('wilson.network_share_writer', 'check:11500000-aaaa-0000-0000-000000000002',
    $q$ UPDATE public.files SET size_bytes = 14 WHERE id = '11500000-0000-0000-0000-00000000e004' $q$) $$,
  '42501', 'A file on your office server changes only through the desktop app.', 'the marker naming another project is refused');
SELECT throws_ok($$ SELECT public.t115_marked('wilson.network_share_writer', 'op:11500000-0000-0000-0000-00000000e002',
    $q$ UPDATE public.files SET storage_path = 'nas:Shared S/e004/b.mov' WHERE id = '11500000-0000-0000-0000-00000000e004' $q$) $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'and it admits no locator change either');
SELECT throws_ok($$ SELECT public.t115_marked('wilson.network_share_writer', 'op:11500000-0000-0000-0000-00000000e004',
    $q$ UPDATE public.files SET project_id = '11500000-aaaa-0000-0000-000000000002' WHERE id = '11500000-0000-0000-0000-00000000e004' $q$) $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'never project_id, under the row''s own marker');
SELECT throws_ok($$ SELECT public.t115_marked('wilson.network_share_writer', 'check:11500000-aaaa-0000-0000-000000000002',
    $q$ UPDATE public.files SET project_id = '11500000-aaaa-0000-0000-000000000002' WHERE id = '11500000-0000-0000-0000-00000000e004' $q$) $$,
  '42501', 'A file''s project, folder and storage change only through Move to.', 'nor under the marker of the project it would go to');
SELECT throws_ok($$ SELECT public.t115_marked('wilson.network_share_writer', 'op:11500000-0000-0000-0000-00000000e004',
    $q$ UPDATE public.files SET workspace_id = '22222222-2222-2222-2222-222222222222' WHERE id = '11500000-0000-0000-0000-00000000e004' $q$) $$,
  '42501', 'A file stays in its company.', 'nor workspace_id');


-- ── F. Arm 4: a personal space keeps its files in the company's storage ───────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name, owner_id)
SELECT 'rabbit-files', k, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' FROM unnest(ARRAY[
  'projects/11500000-aaaa-0000-0000-000000000004/files/f105/x.txt'
]) AS k;
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path) VALUES
  ('11500000-0000-0000-0000-00000000f001', '11500000-aaaa-0000-0000-000000000004', 'a.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000004/files/f001/a.txt'),
  ('11500000-0000-0000-0000-00000000f002', '11500000-aaaa-0000-0000-000000000003', 'a.mov', 'local_server', 'projects/11500000-aaaa-0000-0000-000000000003/files/f002/a.mov'),
  ('11500000-0000-0000-0000-00000000f003', '11500000-aaaa-0000-0000-000000000003', 'a.mov', 'local_server', 'projects/11500000-aaaa-0000-0000-000000000003/files/f003/a.mov'),
  ('11500000-0000-0000-0000-00000000f004', '11500000-aaaa-0000-0000-000000000004', 'older.mov', 'local_server', 'projects/11500000-aaaa-0000-0000-000000000004/files/f004/older.mov'); -- the runner, unbound, may seed this

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000f101', '11500000-aaaa-0000-0000-000000000004', 'a.mov', 'local_server', 'projects/11500000-aaaa-0000-0000-000000000004/files/f101/a.mov') $$,
  '42501', 'A personal space keeps its files in the company''s storage, not on one computer.', 'a local_server row in the caller''s own personal space');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000f102', '11500000-aaaa-0000-0000-000000000004', 'a.doc', 'google_drive', 'projects/11500000-aaaa-0000-0000-000000000004/files/f102/a.doc') $$,
  '42501', 'A personal space keeps its files in the company''s storage, not on one computer.', 'a google_drive row there');
SELECT throws_ok($$ SELECT public.t115_exec($q$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                                               VALUES ('11500000-0000-0000-0000-00000000f103', '11500000-aaaa-0000-0000-000000000004', 'a.mov', 'local_server', 'projects/11500000-aaaa-0000-0000-000000000004/files/f103/a.mov') $q$) $$,
  '42501', 'A personal space keeps its files in the company''s storage, not on one computer.', 'a definer''s insert of one: every bound caller');
SELECT lives_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                   VALUES ('11500000-0000-0000-0000-00000000f104', '11500000-aaaa-0000-0000-000000000003', 'a.mov', 'local_server', 'projects/11500000-aaaa-0000-0000-000000000003/files/f104/a.mov') $$,
  'on an ordinary private project a local_server row is accepted');
SELECT lives_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                   VALUES ('11500000-0000-0000-0000-00000000f105', '11500000-aaaa-0000-0000-000000000004', 'x.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000004/files/f105/x.txt') $$,
  'and in the personal space a row in the company''s storage is accepted');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000f106', '11500000-aaaa-0000-0000-000000000005', 'a.mov', 'local_server', 'projects/11500000-aaaa-0000-0000-000000000005/files/f106/a.mov') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'a space the caller cannot see reads as no row: nobody learns what it is');
SELECT throws_ok($$ SELECT public.t115_journal_move(
    '{"id":"11500000-0000-0000-0000-00000000f001","to_project":"11500000-aaaa-0000-0000-000000000004","to_folder":null,"to_provider":"local_server","to_path":"projects/11500000-aaaa-0000-0000-000000000004/files/f001/a.txt"}',
    $q$ UPDATE public.files SET storage_provider = 'local_server' WHERE id = '11500000-0000-0000-0000-00000000f001' $q$) $$,
  '42501', 'A personal space keeps its files in the company''s storage, not on one computer.', 'a definer''s provider change to local_server there, even with a matching journal');
SELECT throws_ok($$ SELECT public.t115_journal_move(
    '{"id":"11500000-0000-0000-0000-00000000f002","to_project":"11500000-aaaa-0000-0000-000000000004","to_folder":null,"to_provider":"local_server","to_path":"projects/11500000-aaaa-0000-0000-000000000003/files/f002/a.mov"}',
    $q$ UPDATE public.files SET project_id = '11500000-aaaa-0000-0000-000000000004' WHERE id = '11500000-0000-0000-0000-00000000f002' $q$) $$,
  '42501', 'A personal space keeps its files in the company''s storage, not on one computer.', 'a definer''s move of a local_server row in, even with a matching journal');
SELECT lives_ok($$ SELECT public.t115_journal_move(
    '{"id":"11500000-0000-0000-0000-00000000f003","to_project":"11500000-aaaa-0000-0000-000000000004","to_folder":null,"to_provider":"supabase","to_path":"projects/11500000-aaaa-0000-0000-000000000004/files/f003/a.mov"}',
    $q$ UPDATE public.files SET project_id = '11500000-aaaa-0000-0000-000000000004', storage_provider = 'supabase', storage_path = 'projects/11500000-aaaa-0000-0000-000000000004/files/f003/a.mov' WHERE id = '11500000-0000-0000-0000-00000000f003' $q$) $$,
  'a copy-up into a personal space is admitted: the provider switches in the same UPDATE');
SELECT is((SELECT project_id::text || '|' || storage_provider::text FROM public.files WHERE id = '11500000-0000-0000-0000-00000000f003'), '11500000-aaaa-0000-0000-000000000004|supabase', 'and the row is there, in the company''s storage');
SELECT lives_ok($$ UPDATE public.files SET description = 'older' WHERE id = '11500000-0000-0000-0000-00000000f004' $$,
  'an older local_server row there still takes a description: neither provider nor project changed');
SELECT is((SELECT description FROM public.files WHERE id = '11500000-0000-0000-0000-00000000f004'), 'older', 'and it lands');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000f107', '11500000-aaaa-0000-0000-000000000005', 'a.mov', 'local_server', 'projects/11500000-aaaa-0000-0000-000000000005/files/f107/a.mov') $$,
  '42501', 'A personal space keeps its files in the company''s storage, not on one computer.', 'an admin, who can see the space, hears the sentence');


-- ── G. rekey_file_body ───────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name, owner_id)
SELECT 'rabbit-files', k, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' FROM unnest(ARRAY[
  'projects/11500000-aaaa-0000-0000-000000000001/shots/a101/two.mov',
  'projects/11500000-aaaa-0000-0000-000000000001/shots/a102/two.mov',
  'projects/11500000-aaaa-0000-0000-000000000001/shots/a103/two.mov',
  'projects/11500000-AAAA-0000-0000-000000000001/files/a110/two.txt',
  'projects/11500000-aaaa-0000-0000-000000000002/files/a110/two.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/a111/two.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/LEGAL/a112/two.pdf',
  'projects/11500000-aaaa-0000-0000-000000000001/files/a113/two.pdf',
  'projects/11500000-aaaa-0000-0000-000000000001/files/a114/two.pdf',
  'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a115/two.pdf',
  'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a116/two.pdf',
  'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a141/two.pdf',
  'projects/11500000-aaaa-0000-0000-000000000002/files/a118/two.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/a119/two.txt',
  'projects/11500000-aaaa-0000-0000-000000000006/files/a120/two.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/a123/two.txt',
  'projects/11500000-aaaa-0000-0000-000000000004/files/a121/two.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a130/two.pdf',
  'projects/11500000-aaaa-0000-0000-000000000001/files/a131/two.pdf',
  'projects/11500000-aaaa-0000-0000-000000000001/files/a132/two.pdf',
  'projects/11500000-aaaa-0000-0000-000000000001/files/a136/two.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/a139/taken.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/a137/two.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/a138/two.pdf'
]) AS k;
INSERT INTO public.files (id, project_id, workspace_id, name, storage_provider, storage_path, thumbnail_url, is_financial, tags, folder_id, deleted_at) VALUES
  ('11500000-0000-0000-0000-00000000a101', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.mov', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a101/one.mov', NULL, false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a102', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.mov', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a102/one.mov', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a102/one.mov.jpg', false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a103', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.mov', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a103/one.mov', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a103/one.mov.jpg', false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a110', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a110/one.txt', NULL, false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a111', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.txt', 'supabase', 'legacy/11500000-aaaa-0000-0000-000000000001/files/a111/one.txt', NULL, false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a112', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.pdf', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a112/one.pdf', NULL, false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a113', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.pdf', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/LEGAL/a113/one.pdf', NULL, false, '{legal}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a114', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.pdf', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a114/one.pdf', NULL, false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a115', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.pdf', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a115/one.pdf', NULL, false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a116', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.pdf', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a116/one.pdf', NULL, false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a117', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.bin', 's3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a117/one.bin', NULL, false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a118', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000002/files/a118/one.txt', NULL, false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a119', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a119/one.txt', NULL, false, '{}', NULL, now()),
  ('11500000-0000-0000-0000-00000000a120', '11500000-aaaa-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'one.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000006/files/a120/one.txt', NULL, false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a121', '11500000-aaaa-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'one.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000004/files/a121/one.txt', NULL, false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a122', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a122/one.txt', NULL, false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a123', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a123/one.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a123/one.txt.jpg', false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a124', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a124/one.txt', NULL, false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a125', '11500000-aaaa-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'one.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000003/files/a125/one.txt', NULL, false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a126', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.pdf', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/LEGAL/a126/one.pdf', NULL, false, '{legal}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a127', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.pdf', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a127/one.pdf', NULL, true, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a128', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.pdf', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a128/one.pdf', NULL, false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a129', '11500000-aaaa-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'one.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a129/one.txt', NULL, false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a130', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.pdf', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a130/one.pdf', NULL, false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a131', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.pdf', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a131/one.pdf', NULL, true, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a132', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.pdf', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a132/one.pdf', NULL, false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a134', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.pdf', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a134/one.pdf', NULL, false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a135', '11500000-aaaa-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'one.mov', 'local_server', 'projects/11500000-aaaa-0000-0000-000000000003/files/a135/one.mov', NULL, false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a136', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a136/one.txt', NULL, false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a137', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a137/one.txt', NULL, false, '{}', '11500000-0000-0000-0000-0000000000f1', NULL),
  ('11500000-0000-0000-0000-00000000a138', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.pdf', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a138/one.pdf', NULL, true, '{}', '11500000-0000-0000-0000-0000000000f1', NULL),
  ('11500000-0000-0000-0000-00000000a139', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'taken.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a139/taken.txt', NULL, false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a140', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.bin', 's3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a140/one.bin', NULL, false, '{}', NULL, NULL),
  ('11500000-0000-0000-0000-00000000a141', '11500000-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'one.pdf', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a141/one.pdf', 'projects/11500000-aaaa-0000-0000-000000000001/files/a141/one.pdf.jpg', false, '{}', NULL, NULL);

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
-- A valid re-key.
SELECT is(pg_temp.t115_ask($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a101', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a101/one.mov', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a101/two.mov', NULL, NULL) $$), 'true',
  'a valid re-key answers true');
SELECT is(COALESCE(current_setting('wilson.body_rekey', true), ''), '', 'and leaves wilson.body_rekey empty');
SELECT is((SELECT storage_path FROM public.files WHERE id = '11500000-0000-0000-0000-00000000a101'), 'projects/11500000-aaaa-0000-0000-000000000001/shots/a101/two.mov', 'and the row changed');

-- The compare-and-set: a stale call changes nothing and answers false.
SELECT is(pg_temp.t115_ask($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a103', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a103/stale.mov', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a103/two.mov', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a103/one.mov.jpg', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a103/one.mov.jpg') $$), 'false',
  'a stale from-path answers false');
SELECT is(pg_temp.t115_ask($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a103', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a103/one.mov', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a103/two.mov', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a103/stale.jpg', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a103/one.mov.jpg') $$), 'false',
  'a stale from-picture answers false');
SELECT is(pg_temp.t115_ask($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a103', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a103/one.mov', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a103/two.mov', NULL, NULL) $$), 'false',
  'a from-picture of NULL against a row with one answers false');
SELECT is((SELECT storage_path || '|' || thumbnail_url FROM public.files WHERE id = '11500000-0000-0000-0000-00000000a103'),
  'projects/11500000-aaaa-0000-0000-000000000001/shots/a103/one.mov|projects/11500000-aaaa-0000-0000-000000000001/shots/a103/one.mov.jpg', 'and none of them changed anything');

-- Two phases: the shot re-file moves a body first and its picture next.
SELECT is(pg_temp.t115_ask($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a102', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a102/one.mov', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a102/two.mov', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a102/one.mov.jpg', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a102/one.mov.jpg') $$), 'true',
  'phase one: the body moves and keeps its picture');
SELECT is((SELECT storage_path || '|' || thumbnail_url FROM public.files WHERE id = '11500000-0000-0000-0000-00000000a102'),
  'projects/11500000-aaaa-0000-0000-000000000001/shots/a102/two.mov|projects/11500000-aaaa-0000-0000-000000000001/shots/a102/one.mov.jpg', 'the path is new and the picture the old one');
SELECT is(pg_temp.t115_ask($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a102', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a102/two.mov', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a102/two.mov', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a102/one.mov.jpg', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a102/two.mov.jpg') $$), 'true',
  'phase two: the picture moves and the path stays');
SELECT is((SELECT storage_path || '|' || thumbnail_url FROM public.files WHERE id = '11500000-0000-0000-0000-00000000a102'),
  'projects/11500000-aaaa-0000-0000-000000000001/shots/a102/two.mov|projects/11500000-aaaa-0000-0000-000000000001/shots/a102/two.mov.jpg', 'both are new');

-- One refusal, every target otherwise admissible.
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a110', 'projects/11500000-aaaa-0000-0000-000000000001/files/a110/one.txt', 'projects/11500000-AAAA-0000-0000-000000000001/files/a110/two.txt', NULL, NULL) $$,
  '42501', 'file not found or not writable', 'across the second segment, in another case of the same id');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a110', 'projects/11500000-aaaa-0000-0000-000000000001/files/a110/one.txt', 'projects/11500000-aaaa-0000-0000-000000000002/files/a110/two.txt', NULL, NULL) $$,
  '42501', 'file not found or not writable', 'across the second segment, to another project');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a111', 'legacy/11500000-aaaa-0000-0000-000000000001/files/a111/one.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a111/two.txt', NULL, NULL) $$,
  '42501', 'file not found or not writable', 'across the first segment');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a115', 'projects/11500000-aaaa-0000-0000-000000000001/files/a115/one.pdf', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a115/two.pdf', NULL, NULL, true) $$,
  '42501', 'file not found or not writable', 'into INVOICES without money access');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a117', 'projects/11500000-aaaa-0000-0000-000000000001/files/a117/one.bin', 'projects/11500000-aaaa-0000-0000-000000000001/files/a117/two.bin', NULL, NULL) $$,
  '42501', 'file not found or not writable', 'an s3 row');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a118', 'projects/11500000-aaaa-0000-0000-000000000002/files/a118/one.txt', 'projects/11500000-aaaa-0000-0000-000000000002/files/a118/two.txt', NULL, NULL) $$,
  '42501', 'file not found or not writable', 'a moved row, to a new key');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a118', 'projects/11500000-aaaa-0000-0000-000000000002/files/a118/one.txt', 'projects/11500000-aaaa-0000-0000-000000000002/files/a118/one.txt', NULL, 'projects/11500000-aaaa-0000-0000-000000000002/files/a118/one.txt.jpg') $$,
  '42501', 'file not found or not writable', 'a moved row, its picture alone');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a119', 'projects/11500000-aaaa-0000-0000-000000000001/files/a119/one.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a119/two.txt', NULL, NULL) $$,
  '42501', 'file not found or not writable', 'a trashed row, to a new key');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a119', 'projects/11500000-aaaa-0000-0000-000000000001/files/a119/one.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a119/one.txt', NULL, 'projects/11500000-aaaa-0000-0000-000000000001/files/a119/one.txt.jpg') $$,
  '42501', 'file not found or not writable', 'a trashed row, its picture alone');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a122', 'projects/11500000-aaaa-0000-0000-000000000001/files/a122/one.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a122/nothing-here.txt', NULL, NULL) $$,
  '42501', 'file not found or not writable', 'no object at the new key');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a123', 'projects/11500000-aaaa-0000-0000-000000000001/files/a123/one.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a123/two.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a123/one.txt.jpg', 'projects/11500000-aaaa-0000-0000-000000000001/files/a123/other.jpg') $$,
  '42501', 'file not found or not writable', 'a picture other than unchanged, NULL or path.jpg');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a136', 'projects/11500000-aaaa-0000-0000-000000000001/files/a136/one.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a139/taken.txt', NULL, NULL) $$,
  '42501', 'file not found or not writable', 'a target another row holds');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a136', 'projects/11500000-aaaa-0000-0000-000000000001/files/a136/one.txt', NULL, NULL, NULL) $$,
  '42501', 'file not found or not writable', 'a NULL target');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a137', 'projects/11500000-aaaa-0000-0000-000000000001/files/a137/one.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a137/two.txt', NULL, NULL) $$,
  '42501', 'file not found or not writable', 'a non-money file filed in a locked folder');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-dead-dead-dead-000000000000', 'x', 'y', NULL, NULL) $$,
  '42501', 'file not found or not writable', 'a file that does not exist answers alike');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a126', 'projects/11500000-aaaa-0000-0000-000000000001/LEGAL/a126/one.pdf', 'projects/11500000-aaaa-0000-0000-000000000001/LEGAL/a126/one.pdf', NULL, 'projects/11500000-aaaa-0000-0000-000000000001/LEGAL/a126/one.pdf.jpg') $$,
  '42501', 'file not found or not writable', 'a Legal row by a member who cannot see Legal');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a127', 'projects/11500000-aaaa-0000-0000-000000000001/files/a127/one.pdf', 'projects/11500000-aaaa-0000-0000-000000000001/files/a127/one.pdf', NULL, 'projects/11500000-aaaa-0000-0000-000000000001/files/a127/one.pdf.jpg') $$,
  '42501', 'file not found or not writable', 'a flagged row by a member with no money access');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a128', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a128/one.pdf', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a128/one.pdf', NULL, 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a128/one.pdf.jpg') $$,
  '42501', 'file not found or not writable', 'an invoice by a member with no money access');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a129', 'projects/11500000-aaaa-0000-0000-000000000001/files/a129/one.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a129/one.txt', NULL, 'projects/11500000-aaaa-0000-0000-000000000001/files/a129/one.txt.jpg') $$,
  '42501', 'file not found or not writable', 'a row of another company, even under a project of this one');
SELECT is(pg_temp.t115_ask($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a125', 'projects/11500000-aaaa-0000-0000-000000000003/files/a125/one.txt', 'projects/11500000-aaaa-0000-0000-000000000003/files/a125/one.txt', NULL, 'projects/11500000-aaaa-0000-0000-000000000003/files/a125/one.txt.jpg') $$), 'true',
  'CONTROL: the creator of a private project re-keys its file''s picture');
SELECT is(pg_temp.t115_ask($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a121', 'projects/11500000-aaaa-0000-0000-000000000004/files/a121/one.txt', 'projects/11500000-aaaa-0000-0000-000000000004/files/a121/two.txt', NULL, NULL) $$), 'true',
  'CONTROL: the owner re-keys a file of their own personal space');
SELECT is(pg_temp.t115_ask($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a135', 'projects/11500000-aaaa-0000-0000-000000000003/files/a135/one.mov', 'projects/11500000-aaaa-0000-0000-000000000003/files/a135/two.mov', NULL, NULL) $$), 'true',
  'a local_server row needs no object at the new key');
SELECT is(pg_temp.t115_ask($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a140', 'projects/11500000-aaaa-0000-0000-000000000001/files/a140/one.bin', 'projects/11500000-aaaa-0000-0000-000000000001/files/a140/one.bin', NULL, 'projects/11500000-aaaa-0000-0000-000000000001/files/a140/one.bin.jpg') $$), 'true',
  'an s3 row keeps its key but takes a picture: only a change of path is refused');
SELECT is(pg_temp.t115_ask($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a136', 'projects/11500000-aaaa-0000-0000-000000000001/files/a136/one.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a136/two.txt', NULL, NULL) $$), 'true',
  'CONTROL: the same row to a good target goes through');
SELECT is(pg_temp.t115_ask($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a123', 'projects/11500000-aaaa-0000-0000-000000000001/files/a123/one.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a123/two.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a123/one.txt.jpg', NULL) $$), 'true',
  'a picture may go to NULL');
SELECT is(pg_temp.t115_ask($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a124', 'projects/11500000-aaaa-0000-0000-000000000001/files/a124/one.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a124/one.txt', NULL, 'projects/11500000-aaaa-0000-0000-000000000001/files/a124/one.txt.jpg') $$), 'true',
  'CONTROL: a member adds a derived picture to their file');
SELECT is(COALESCE(current_setting('wilson.body_rekey', true), ''), '', 'the marker is still empty afterwards');

-- Someone who may see money and Legal: the moves that would change a file's standing.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a112', 'projects/11500000-aaaa-0000-0000-000000000001/files/a112/one.pdf', 'projects/11500000-aaaa-0000-0000-000000000001/LEGAL/a112/two.pdf', NULL, NULL) $$,
  '42501', 'file not found or not writable', 'across LEGAL, into it');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a113', 'projects/11500000-aaaa-0000-0000-000000000001/LEGAL/a113/one.pdf', 'projects/11500000-aaaa-0000-0000-000000000001/files/a113/two.pdf', NULL, NULL) $$,
  '42501', 'file not found or not writable', 'across LEGAL, out of it');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a114', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a114/one.pdf', 'projects/11500000-aaaa-0000-0000-000000000001/files/a114/two.pdf', NULL, NULL) $$,
  '42501', 'file not found or not writable', 'out of INVOICES');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a116', 'projects/11500000-aaaa-0000-0000-000000000001/files/a116/one.pdf', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a116/two.pdf', NULL, NULL, false) $$,
  '42501', 'file not found or not writable', 'into INVOICES without p_financial');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a132', 'projects/11500000-aaaa-0000-0000-000000000001/files/a132/one.pdf', 'projects/11500000-aaaa-0000-0000-000000000001/files/a132/two.pdf', NULL, NULL, true) $$,
  '42501', 'file not found or not writable', 'money growing on a target that is not an invoices key');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a132', 'projects/11500000-aaaa-0000-0000-000000000001/files/a132/one.pdf', 'projects/11500000-aaaa-0000-0000-000000000001/files/a132/one.pdf', NULL, NULL, true) $$,
  '42501', 'file not found or not writable', 'money growing with the key unchanged, on a key that is not an invoices key');
SELECT is((SELECT is_financial FROM public.files WHERE id = '11500000-0000-0000-0000-00000000a132'), false, 'and that row is not money');
SELECT is(pg_temp.t115_ask($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a130', 'projects/11500000-aaaa-0000-0000-000000000001/files/a130/one.pdf', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a130/two.pdf', NULL, NULL, true) $$), 'true',
  'money goes false to true with p_financial on an invoices key');
SELECT is((SELECT storage_path || '|' || is_financial::text FROM public.files WHERE id = '11500000-0000-0000-0000-00000000a130'),
  'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a130/two.pdf|true', 'and the row is an invoice');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a141', 'projects/11500000-aaaa-0000-0000-000000000001/files/a141/one.pdf', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a141/two.pdf', 'projects/11500000-aaaa-0000-0000-000000000001/files/a141/one.pdf.jpg', 'projects/11500000-aaaa-0000-0000-000000000001/files/a141/one.pdf.jpg', true) $$,
  '42501', 'file not found or not writable', 'money growing while its picture stays at the old, open key');
SELECT is(pg_temp.t115_ask($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a141', 'projects/11500000-aaaa-0000-0000-000000000001/files/a141/one.pdf', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a141/two.pdf', 'projects/11500000-aaaa-0000-0000-000000000001/files/a141/one.pdf.jpg', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a141/two.pdf.jpg', true) $$), 'true',
  'CONTROL: money growing with its picture following');
SELECT is(pg_temp.t115_ask($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a134', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a134/one.pdf', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a134/one.pdf', NULL, NULL, true) $$), 'true',
  'and in place, on a row already under INVOICES');
SELECT is((SELECT is_financial FROM public.files WHERE id = '11500000-0000-0000-0000-00000000a134'), true, 'where the flag grows');
SELECT is(pg_temp.t115_ask($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a131', 'projects/11500000-aaaa-0000-0000-000000000001/files/a131/one.pdf', 'projects/11500000-aaaa-0000-0000-000000000001/files/a131/two.pdf', NULL, NULL, false) $$), 'true',
  'a flagged row re-keyed with p_financial false goes through');
SELECT is((SELECT storage_path || '|' || is_financial::text FROM public.files WHERE id = '11500000-0000-0000-0000-00000000a131'),
  'projects/11500000-aaaa-0000-0000-000000000001/files/a131/two.pdf|true', 'and its money never goes true to false');
SELECT is(pg_temp.t115_ask($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a138', 'projects/11500000-aaaa-0000-0000-000000000001/files/a138/one.pdf', 'projects/11500000-aaaa-0000-0000-000000000001/files/a138/two.pdf', NULL, NULL, false) $$), 'true',
  'a flagged row filed in a locked folder re-keys: the row is judged with its flag');
SELECT is(pg_temp.t115_ask($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a127', 'projects/11500000-aaaa-0000-0000-000000000001/files/a127/one.pdf', 'projects/11500000-aaaa-0000-0000-000000000001/files/a127/one.pdf', NULL, 'projects/11500000-aaaa-0000-0000-000000000001/files/a127/one.pdf.jpg') $$), 'true',
  'CONTROL: someone with money access re-keys a flagged row');
SELECT is(pg_temp.t115_ask($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a128', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a128/one.pdf', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a128/one.pdf', NULL, 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a128/one.pdf.jpg') $$), 'true',
  'CONTROL: and an invoice');

-- A workspace manager with no seat sees Legal, and not money, and writes a private project only if they made it.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.t115_ask($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a126', 'projects/11500000-aaaa-0000-0000-000000000001/LEGAL/a126/one.pdf', 'projects/11500000-aaaa-0000-0000-000000000001/LEGAL/a126/one.pdf', NULL, 'projects/11500000-aaaa-0000-0000-000000000001/LEGAL/a126/one.pdf.jpg') $$), 'true',
  'CONTROL: a workspace manager re-keys a Legal row');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a128', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a128/one.pdf', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a128/one.pdf', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a128/one.pdf.jpg', NULL) $$,
  '42501', 'file not found or not writable', 'and not an invoice');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a125', 'projects/11500000-aaaa-0000-0000-000000000003/files/a125/one.txt', 'projects/11500000-aaaa-0000-0000-000000000003/files/a125/one.txt', 'projects/11500000-aaaa-0000-0000-000000000003/files/a125/one.txt.jpg', NULL) $$,
  '42501', 'file not found or not writable', 'a private project someone else made');

-- Every other failure of authority, the picture alone so nothing else could answer.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a120', 'projects/11500000-aaaa-0000-0000-000000000006/files/a120/one.txt', 'projects/11500000-aaaa-0000-0000-000000000006/files/a120/two.txt', NULL, NULL) $$,
  '42501', 'file not found or not writable', 'a trashed project, to a new key');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a120', 'projects/11500000-aaaa-0000-0000-000000000006/files/a120/one.txt', 'projects/11500000-aaaa-0000-0000-000000000006/files/a120/one.txt', NULL, 'projects/11500000-aaaa-0000-0000-000000000006/files/a120/one.txt.jpg') $$,
  '42501', 'file not found or not writable', 'a trashed project, the picture alone');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a121', 'projects/11500000-aaaa-0000-0000-000000000004/files/a121/two.txt', 'projects/11500000-aaaa-0000-0000-000000000004/files/a121/two.txt', NULL, 'projects/11500000-aaaa-0000-0000-000000000004/files/a121/two.txt.jpg') $$,
  '42501', 'file not found or not writable', 'a non-owner on a personal-space file, an admin included');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a124', 'projects/11500000-aaaa-0000-0000-000000000001/files/a124/one.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a124/one.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a124/one.txt.jpg', NULL) $$,
  '42501', 'file not found or not writable', 'a reviewer does not write the project');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '99999999-9999-9999-9999-999999999999', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a124', 'projects/11500000-aaaa-0000-0000-000000000001/files/a124/one.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a124/one.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a124/one.txt.jpg', NULL) $$,
  '42501', 'file not found or not writable', 'an inactive member whose token still says they belong');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '22222222-2222-2222-2222-222222222222', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a124', 'projects/11500000-aaaa-0000-0000-000000000001/files/a124/one.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a124/one.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a124/one.txt.jpg', NULL) $$,
  '42501', 'file not found or not writable', 'another company''s admin');
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a129', 'projects/11500000-aaaa-0000-0000-000000000001/files/a129/one.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a129/one.txt', NULL, 'projects/11500000-aaaa-0000-0000-000000000001/files/a129/one.txt.jpg') $$,
  '42501', 'file not found or not writable', 'a row of that company under another company''s project');
SELECT set_config('request.jwt.claims', '{}', true);
SELECT throws_ok($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a124', 'projects/11500000-aaaa-0000-0000-000000000001/files/a124/one.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a124/one.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a124/one.txt.jpg', NULL) $$,
  '42501', 'file not found or not writable', 'no company in the token');

-- What the valid calls left behind, read as the runner.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.file_events
            WHERE file_id = '11500000-0000-0000-0000-00000000a101' AND event = 'moved'
              AND old_path = 'projects/11500000-aaaa-0000-0000-000000000001/shots/a101/one.mov' AND new_path = 'projects/11500000-aaaa-0000-0000-000000000001/shots/a101/two.mov'
              AND project_id = '11500000-aaaa-0000-0000-000000000001' AND actor_user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'), 1,
  'a valid re-key writes one moved file event, from the old key to the new, by the caller');
SELECT is((SELECT count(*)::int FROM public.file_events WHERE file_id = '11500000-0000-0000-0000-00000000a101' AND event = 'moved'), 1,
  'and no other');
SELECT is((SELECT count(*)::int FROM public.file_events WHERE file_id = '11500000-0000-0000-0000-00000000a103' AND event = 'moved'), 0,
  'a stale call writes none');
SELECT is((SELECT count(*)::int FROM public.file_events WHERE file_id = '11500000-0000-0000-0000-00000000a102' AND event = 'moved'), 1,
  'the two phases write one: the path moved once');


-- ── H. What claims a stored copy, and who answers for it ─────────────────────
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, thumbnail_url, is_financial, deleted_at) VALUES
  ('11500000-0000-0000-0000-00000000a201', '11500000-aaaa-0000-0000-000000000001', 'live.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a201/live.txt', NULL, false, NULL),
  ('11500000-0000-0000-0000-00000000a202', '11500000-aaaa-0000-0000-000000000001', 'trashed.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a202/trashed.txt', NULL, false, now()),
  ('11500000-0000-0000-0000-00000000a203', '11500000-aaaa-0000-0000-000000000003', 'local.mov', 'local_server', 'projects/11500000-aaaa-0000-0000-000000000003/files/a203/local.mov', NULL, false, NULL),
  ('11500000-0000-0000-0000-00000000a204', '11500000-aaaa-0000-0000-000000000001', 's3.bin', 's3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a204/s3.bin', 'projects/11500000-aaaa-0000-0000-000000000001/files/a204/s3.bin.jpg', false, NULL),
  ('11500000-0000-0000-0000-00000000a205', '11500000-aaaa-0000-0000-000000000001', 'drive.doc', 'google_drive', 'projects/11500000-aaaa-0000-0000-000000000001/files/a205/drive.doc', NULL, false, NULL),
  ('11500000-0000-0000-0000-00000000a206', '11500000-aaaa-0000-0000-000000000001', 'share.mov', 'network_share', 'projects/11500000-aaaa-0000-0000-000000000001/files/a206/share.mov', NULL, false, NULL),
  ('11500000-0000-0000-0000-00000000a207', '11500000-bbbb-0000-0000-000000000001', 'theirs.txt', 'supabase', 'projects/11500000-bbbb-0000-0000-000000000001/files/a207/theirs.txt', NULL, false, NULL),
  ('11500000-0000-0000-0000-00000000a208', '11500000-aaaa-0000-0000-000000000001', 'picture.jpg', 's3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a208/picture.jpg', NULL, false, NULL),
  ('11500000-0000-0000-0000-00000000a2f0', '11500000-aaaa-0000-0000-000000000001', 'k.bin', 's3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a2f0/k.bin', 'projects/11500000-aaaa-0000-0000-000000000001/files/a2f0/k.bin.png', false, NULL),
  ('11500000-0000-0000-0000-00000000a209', '11500000-aaaa-0000-0000-000000000001', 's3-trashed.bin', 's3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a209/s3.bin', NULL, false, now()),
  ('11500000-0000-0000-0000-00000000a210', '11500000-aaaa-0000-0000-000000000003', 'hidden.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000003/files/a210/hidden.txt', NULL, false, NULL),
  ('11500000-0000-0000-0000-00000000a211', '11500000-aaaa-0000-0000-000000000001', 'poster.jpg', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/bin_files/a211/poster.jpg', NULL, false, NULL),
  ('11500000-0000-0000-0000-00000000a212', '11500000-aaaa-0000-0000-000000000001', 'check', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/connection-check/a212/check', NULL, false, NULL),
  ('11500000-0000-0000-0000-00000000a213', '11500000-aaaa-0000-0000-000000000001', 'PROJECT.json', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/PROJECT.json', NULL, false, NULL),
  ('11500000-0000-0000-0000-00000000a214', '11500000-aaaa-0000-0000-000000000001', 'RATES.json', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/FINANCE/RATES.json', NULL, false, NULL),
  ('11500000-0000-0000-0000-00000000a215', '11500000-aaaa-0000-0000-000000000001', 'PROJECT.json', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a215/PROJECT.json', NULL, false, NULL),
  ('11500000-0000-0000-0000-00000000a216', '11500000-aaaa-0000-0000-000000000001', 'flag.pdf', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a216/flag.pdf', NULL, true, NULL),
  ('11500000-0000-0000-0000-00000000a217', '11500000-aaaa-0000-0000-000000000001', 'invoice.pdf', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a217/invoice.pdf', NULL, false, NULL),
  ('11500000-0000-0000-0000-00000000a218', '11500000-aaaa-0000-0000-000000000001', 'moved.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000002/files/a218/moved.txt', NULL, false, NULL);
INSERT INTO public.storage_gc_queue (bucket_id, object_path, workspace_id, file_id, reason, provider, kind, status) VALUES
  ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a220/pending.txt', '11111111-1111-1111-1111-111111111111', '11500000-0000-0000-0000-00000000a220', 'file-purged', 'supabase', 'body', 'pending'),
  ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a221/failed.txt', '11111111-1111-1111-1111-111111111111', '11500000-0000-0000-0000-00000000a221', 'file-purged', 'supabase', 'body', 'failed'),
  ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a222/deleted.txt', '11111111-1111-1111-1111-111111111111', '11500000-0000-0000-0000-00000000a222', 'file-purged', 'supabase', 'body', 'deleted'),
  ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a223/no-file.txt', '11111111-1111-1111-1111-111111111111', NULL, 'orphan-scan', 'supabase', 'body', 'pending');
INSERT INTO public.file_events (workspace_id, project_id, file_id, storage_provider, event, old_path) VALUES
  ('11111111-1111-1111-1111-111111111111', '11500000-aaaa-0000-0000-000000000002', '11500000-0000-0000-0000-00000000a230', 'supabase', 'purged', 'projects/11500000-aaaa-0000-0000-000000000001/files/a230/moved.txt'),
  ('11111111-1111-1111-1111-111111111111', '11500000-aaaa-0000-0000-000000000001', '11500000-0000-0000-0000-00000000a231', 'supabase', 'purged', 'projects/11500000-aaaa-0000-0000-000000000001/files/a231/stayed.txt'),
  ('11111111-1111-1111-1111-111111111111', '11500000-aaaa-0000-0000-000000000002', '11500000-0000-0000-0000-00000000a232', 's3', 'purged', 'projects/11500000-aaaa-0000-0000-000000000001/files/a232/moved.bin'),
  ('11111111-1111-1111-1111-111111111111', '11500000-aaaa-0000-0000-000000000002', '11500000-0000-0000-0000-00000000a233', 's3', 'purged', 'projects/11500000-aaaa-0000-0000-000000000001/files/a233/moved.bin.jpg'),
  ('11111111-1111-1111-1111-111111111111', '11500000-aaaa-0000-0000-000000000002', '11500000-0000-0000-0000-00000000a234', 'supabase', 'trashed', 'projects/11500000-aaaa-0000-0000-000000000001/files/a234/not-purged.txt'),
  ('11111111-1111-1111-1111-111111111111', '11500000-aaaa-0000-0000-000000000002', '11500000-0000-0000-0000-00000000a235', 'local_server', 'purged', 'projects/11500000-aaaa-0000-0000-000000000001/files/a235/moved.mov'),
  ('11111111-1111-1111-1111-111111111111', '11500000-aaaa-0000-0000-000000000002', '11500000-0000-0000-0000-00000000a236', 'supabase', 'purged', 'projects/11500000-aaaa-0000-0000-000000000001/files/a236/moved.txt.jpg');

-- Arm 1: a files row, in any trash state, whichever company it belongs to.
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a201/live.txt'), true, 'a live row claims its body');
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a202/trashed.txt'), true, 'so does a trashed row');
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000003/files/a203/local.mov'), true, 'so does a local_server row');
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a204/s3.bin'), false, 'an s3 row claims nothing in Petal''s bucket');
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a205/drive.doc'), false, 'nor does a google_drive row');
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a206/share.mov'), false, 'nor an office-server row');
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a999/nothing.txt'), false, 'a key nothing names is not claimed');
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', NULL), false, 'a NULL name is not claimed, and not NULL');
-- A picture in rabbit-thumbnails.
SELECT is(rabbit_private.storage_object_claimed('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a201/live.txt.jpg'), true, 'a row claims its picture in rabbit-thumbnails');
SELECT is(rabbit_private.storage_object_claimed('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a202/trashed.txt.jpg'), true, 'a trashed row too');
SELECT is(rabbit_private.storage_object_claimed('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000003/files/a203/local.mov.jpg'), true, 'a local_server row too');
SELECT is(rabbit_private.storage_object_claimed('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a201/live.txt'), false, 'but rabbit-thumbnails holds only .jpg names');
SELECT is(rabbit_private.storage_object_claimed('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a201/live.txt.png'), false, 'and another four-letter ending names nothing');
SELECT is(rabbit_private.storage_object_claimed('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a204/s3.bin.jpg'), false, 'and an s3 row''s picture is not there');
-- s3 with and without .jpg.
SELECT is(rabbit_private.storage_object_claimed('byo-s3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a204/s3.bin'), true, 'an s3 row claims its body');
SELECT is(rabbit_private.storage_object_claimed('byo-s3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a204/s3.bin.jpg'), true, 'and its picture beside it');
SELECT is(rabbit_private.storage_object_claimed('byo-s3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a208/picture'), true, 'a body whose own name ends .jpg claims the bare form');
SELECT is(rabbit_private.storage_object_claimed('byo-s3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a209/s3.bin'), true, 'a trashed s3 row claims too');
SELECT is(rabbit_private.storage_object_claimed('byo-s3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a201/live.txt'), false, 'a Supabase row claims nothing in a company''s bucket');
-- Row-less shapes, though a row names each.
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/bin_files/a211/poster.jpg'), false, 'a bin poster is row-less');
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/connection-check/a212/check'), false, 'a connection check is row-less');
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/PROJECT.json'), false, 'PROJECT.json is row-less');
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/FINANCE/RATES.json'), false, 'FINANCE/RATES.json is row-less');
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a215/PROJECT.json'), true, 'CONTROL: a file merely called PROJECT.json is claimed');
-- The purge queue.
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a220/pending.txt'), true, 'a pending queue row naming a file claims');
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a221/failed.txt'), true, 'a failed one too: it will be retried');
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a222/deleted.txt'), false, 'a deleted one does not');
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a223/no-file.txt'), false, 'a queue row naming no file does not');
SELECT is(rabbit_private.storage_object_claimed('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a220/pending.txt'), false, 'and a queue row claims only in its own bucket');
-- The purge certificate of a moved copy.
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a230/moved.txt'), true, 'a purged event whose project differs from the key''s second segment claims');
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a231/stayed.txt'), false, 'one whose project matches does not');
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a234/not-purged.txt'), false, 'an event that is not a purge does not');
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a235/moved.mov'), true, 'a purged local_server row claims in Petal''s bucket');
SELECT is(rabbit_private.storage_object_claimed('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a230/moved.txt.jpg'), true, 'and it claims its picture');
SELECT is(rabbit_private.storage_object_claimed('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a230/moved.txt.png'), false, 'and only its .jpg');
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a230/moved.txt.jpg'), false, 'but a .jpg in Petal''s body bucket is not its picture');
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a232/moved.bin'), false, 'an s3 certificate does not fit Petal''s bucket');
SELECT is(rabbit_private.storage_object_claimed('byo-s3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a230/moved.txt'), false, 'a Supabase certificate does not fit a company''s bucket');
SELECT is(rabbit_private.storage_object_claimed('byo-s3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a232/moved.bin'), true, 'an s3 certificate claims the body');
SELECT is(rabbit_private.storage_object_claimed('byo-s3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a232/moved.bin.jpg'), true, 'and the name with .jpg');
SELECT is(rabbit_private.storage_object_claimed('byo-s3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a233/moved.bin'), true, 'and a certificate whose path has .jpg claims the bare name');
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a236/moved.txt'), false, 'only in a company''s bucket, where body and picture share names');

-- A signed-in caller of one company hears about another's: a definer, with row security off.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', 'projects/11500000-bbbb-0000-0000-000000000001/files/a207/theirs.txt'), true, 'a claim is across every company');

-- Who answers for it: files_select decides, as the caller.
SELECT is(rabbit_private.storage_object_current_project('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a201/live.txt'), '11500000-aaaa-0000-0000-000000000001'::uuid, 'a visible row gives its project');
SELECT is(rabbit_private.storage_object_current_project('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a201/live.txt.jpg'), '11500000-aaaa-0000-0000-000000000001'::uuid, 'and for its picture');
SELECT is(rabbit_private.storage_object_current_project('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000002/files/a218/moved.txt'), '11500000-aaaa-0000-0000-000000000001'::uuid, 'a moved copy answers to its current project, not its key''s');
SELECT is(rabbit_private.storage_object_current_project('byo-s3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a204/s3.bin'), '11500000-aaaa-0000-0000-000000000001'::uuid, 'an s3 body gives its project');
SELECT is(rabbit_private.storage_object_current_project('byo-s3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a204/s3.bin.jpg'), '11500000-aaaa-0000-0000-000000000001'::uuid, 'and the picture the row names');
SELECT is(rabbit_private.storage_object_current_project('byo-s3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a208/picture.jpg.jpg'), NULL::uuid, 'not a picture the row does not name');
SELECT is(rabbit_private.storage_object_current_project('byo-s3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a2f0/k.bin.png'), NULL::uuid, 'nor a picture the row names under another suffix: only .jpg shares a body''s name');
SELECT is(rabbit_private.storage_object_current_project('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a201/live.txt'), NULL::uuid, 'a name without .jpg gives no picture''s project');
SELECT is(rabbit_private.storage_object_current_project('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a201/live.txt.png'), NULL::uuid, 'nor does another four-letter ending');
SELECT is(rabbit_private.storage_object_current_project('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000003/files/a203/local.mov'), '11500000-aaaa-0000-0000-000000000003'::uuid, 'a local_server row answers in Petal''s bucket');
SELECT is(rabbit_private.storage_object_current_project('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000003/files/a203/local.mov.jpg'), '11500000-aaaa-0000-0000-000000000003'::uuid, 'and for its picture');
SELECT is(rabbit_private.storage_object_current_project('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a204/s3.bin'), NULL::uuid, 'an s3 row answers nothing in Petal''s bucket');
SELECT is(rabbit_private.storage_object_current_project('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a204/s3.bin.jpg'), NULL::uuid, 'and nothing in Petal''s picture bucket');
SELECT is(rabbit_private.storage_object_current_project('byo-s3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a201/live.txt'), NULL::uuid, 'a Supabase row answers nothing in a company''s bucket');
SELECT is(rabbit_private.storage_object_current_project('some-other-bucket', 'projects/11500000-aaaa-0000-0000-000000000001/files/a201/live.txt'), NULL::uuid, 'nor does anything in a bucket it does not know');
SELECT is(rabbit_private.storage_object_current_project('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a202/trashed.txt'), NULL::uuid, 'a trashed row gives NULL');
SELECT is(rabbit_private.storage_object_current_project('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a216/flag.pdf'), NULL::uuid, 'a flagged row gives a non-money member NULL');
SELECT is(rabbit_private.storage_object_current_project('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a217/invoice.pdf'), NULL::uuid, 'an invoice gives a non-money member NULL');
SELECT is(rabbit_private.storage_object_current_project('rabbit-files', 'projects/11500000-bbbb-0000-0000-000000000001/files/a207/theirs.txt'), NULL::uuid, 'another company''s row gives NULL');
SELECT is(rabbit_private.storage_object_current_project('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000003/files/a210/hidden.txt'), '11500000-aaaa-0000-0000-000000000003'::uuid, 'CONTROL: a private project''s file gives its creator the project');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(rabbit_private.storage_object_current_project('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000003/files/a210/hidden.txt'), NULL::uuid, 'and anyone else NULL');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(rabbit_private.storage_object_current_project('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a216/flag.pdf'), '11500000-aaaa-0000-0000-000000000001'::uuid, 'CONTROL: someone with money access gets the flagged row''s project');
SELECT is(rabbit_private.storage_object_current_project('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a217/invoice.pdf'), '11500000-aaaa-0000-0000-000000000001'::uuid, 'CONTROL: and the invoice''s');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- Two rows naming one key is what the unique index forbids, so it goes for a moment:
-- if it ever happened, neither row would answer for the copy.
DROP INDEX IF EXISTS public.files_storage_path_key_uidx;
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path) VALUES
  ('11500000-0000-0000-0000-00000000a219', '11500000-aaaa-0000-0000-000000000002', 'twin.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a201/live.txt');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(rabbit_private.storage_object_current_project('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a201/live.txt'), NULL::uuid, 'two rows naming one key: neither answers');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
DELETE FROM public.files WHERE id = '11500000-0000-0000-0000-00000000a219';
DELETE FROM public.storage_gc_queue WHERE file_id = '11500000-0000-0000-0000-00000000a219';
SELECT lives_ok($$ CREATE UNIQUE INDEX files_storage_path_key_uidx
                     ON public.files (storage_path text_pattern_ops)
                     WHERE storage_provider IN ('supabase', 's3', 'local_server') $$,
  'and the index goes back: no other two rows name one key');

-- file_key_shape_ok, a small table.
SELECT is((SELECT array_agg(k ORDER BY k) FROM unnest(ARRAY[
    'projects/p/scenes/a/b', 'projects/p/shots/a/b', 'projects/p/levels/a/b', 'projects/p/experiences/a/b',
    'projects/p/assets/a/b', 'projects/p/tasks/a/b', 'projects/p/phases/a/b', 'projects/p/project/a/b',
    'projects/p/files/a/b', 'projects/p/invoices/a/b', 'projects/p/legal/a/b',
    'projects/p/INVOICES/a/b', 'projects/p/Legal/a/b', 'projects/p/SHOTS/a/b',
    'projects/p/files/a/b/c/d.e_f-G9', 'projects/p/files/a/' || repeat('x', 1005)
  ]) AS k WHERE rabbit_private.file_key_shape_ok(k) IS NOT TRUE), NULL::text[],
  'file_key_shape_ok allows every key the uploaders make, up to 1024 characters');
SELECT is((SELECT array_agg(k ORDER BY k) FROM unnest(ARRAY[
    '', 'projects', 'projects/p/files', 'projects/p/files/a', 'x/p/files/a/b', 'Projects/p/files/a/b',
    'projects/p/FINANCE/a/b', 'projects/p/bin_files/a/b', 'projects/p/connection-check/a/b', 'projects/p/other/a/b',
    'projects/p/files/a b/c', 'projects/p/files/../c', 'projects/p/files/./c', 'projects/p/files/a/..', 'projects//files/a/b',
    'projects/p/files/a/', '/projects/p/files/a/b', 'projects/p/files/a/caf' || chr(233), 'projects/p/files/a/b%c',
    'projects/p/files/a/' || repeat('x', 1006)
  ]) AS k WHERE rabbit_private.file_key_shape_ok(k) IS NOT FALSE), NULL::text[],
  'file_key_shape_ok refuses every other shape, false and never NULL');
SELECT is(rabbit_private.file_key_shape_ok(NULL), false, 'a NULL key is false, never NULL');


-- ── I. files_body_follow and files_body_retire, as the runner with a user's claims ──
INSERT INTO storage.objects (bucket_id, name, owner_id)
SELECT 'rabbit-files', k, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' FROM unnest(ARRAY[
  'projects/11500000-aaaa-0000-0000-000000000001/bin_files/a305/x.txt',
  'projects/11500000-aaaa-0000-0000-000000000003/files/a307/moved.txt',
  'projects/11500000-aaaa-0000-0000-000000000004/files/a308/moved.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/a309/plain.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/a310/plain.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/a311/plain.txt',
  'projects/11500000-aaaa-0000-0000-000000000003/files/a312/moved.txt',
  'projects/11500000-aaaa-0000-0000-000000000002/files/a312/copy.txt',
  'projects/11500000-aaaa-0000-0000-000000000002/shots/a312/copy.txt',
  'projects/11500000-aaaa-0000-0000-000000000002/INVOICES/a312/copy.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/a312/wrong-project.txt',
  'projects/11500000-aaaa-0000-0000-000000000002/files/a313/copy.mov',
  'projects/11500000-aaaa-0000-0000-000000000002/files/a314/moved.txt',
  'projects/11500000-aaaa-0000-0000-000000000003/files/a319/own.txt',
  'projects/11500000-aaaa-0000-0000-000000000001/files/a321/plain.txt'
]) AS k;
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, thumbnail_url) VALUES
  ('11500000-0000-0000-0000-00000000a301', '11500000-aaaa-0000-0000-000000000001', 'drive.doc', 'google_drive', 'projects-drive/a301/drive.doc', NULL),
  ('11500000-0000-0000-0000-00000000a302', '11500000-aaaa-0000-0000-000000000001', 'share.mov', 'network_share', 'nas:Shared S/a302/share.mov', NULL),
  ('11500000-0000-0000-0000-00000000a303', '11500000-aaaa-0000-0000-000000000001', 's3.bin', 's3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a303/s3.bin', NULL),
  ('11500000-0000-0000-0000-00000000a304', '11500000-aaaa-0000-0000-000000000001', 'gone.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a304/gone.txt', NULL),
  ('11500000-0000-0000-0000-00000000a305', '11500000-aaaa-0000-0000-000000000001', 'x.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/bin_files/a305/x.txt', NULL),
  ('11500000-0000-0000-0000-00000000a306', '11500000-aaaa-0000-0000-000000000003', 'local.mov', 'local_server', 'projects/11500000-aaaa-0000-0000-000000000003/files/a306/local.mov', NULL),
  ('11500000-0000-0000-0000-00000000a307', '11500000-aaaa-0000-0000-000000000001', 'moved.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000003/files/a307/moved.txt', NULL),
  ('11500000-0000-0000-0000-00000000a308', '11500000-aaaa-0000-0000-000000000001', 'moved.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000004/files/a308/moved.txt', NULL),
  ('11500000-0000-0000-0000-00000000a309', '11500000-aaaa-0000-0000-000000000001', 'plain.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a309/plain.txt', NULL),
  ('11500000-0000-0000-0000-00000000a310', '11500000-aaaa-0000-0000-000000000001', 'plain.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a310/plain.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a310/old-picture.jpg'),
  ('11500000-0000-0000-0000-00000000a311', '11500000-aaaa-0000-0000-000000000001', 'plain.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a311/plain.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a311/plain.txt.jpg'),
  ('11500000-0000-0000-0000-00000000a312', '11500000-aaaa-0000-0000-000000000001', 'moved.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000003/files/a312/moved.txt', 'projects/11500000-aaaa-0000-0000-000000000003/files/a312/moved.txt.jpg'),
  ('11500000-0000-0000-0000-00000000a313', '11500000-aaaa-0000-0000-000000000003', 'local.mov', 'local_server', 'projects/11500000-aaaa-0000-0000-000000000003/files/a313/local.mov', 'projects/11500000-aaaa-0000-0000-000000000003/files/a313/local.mov.jpg'),
  ('11500000-0000-0000-0000-00000000a314', '11500000-aaaa-0000-0000-000000000001', 'moved.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000002/files/a314/moved.txt', NULL),
  ('11500000-0000-0000-0000-00000000a316', '11500000-aaaa-0000-0000-000000000001', 'legacy.bin', 's3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a316/legacy.bin', 'projects/11500000-aaaa-0000-0000-000000000001/files/a316/old-picture.jpg'),
  ('11500000-0000-0000-0000-00000000a317', '11500000-aaaa-0000-0000-000000000001', 'moved.bin', 's3', 'projects/11500000-aaaa-0000-0000-000000000003/files/a317/moved.bin', 'projects/11500000-aaaa-0000-0000-000000000003/files/a317/moved.bin.jpg'),
  ('11500000-0000-0000-0000-00000000a318', '11500000-aaaa-0000-0000-000000000001', 'plain.bin', 's3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a318/plain.bin', NULL),
  ('11500000-0000-0000-0000-00000000a319', '11500000-aaaa-0000-0000-000000000003', 'own.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000003/files/a319/own.txt', NULL),
  ('11500000-0000-0000-0000-00000000a320', '11500000-aaaa-0000-0000-000000000001', 'local.mov', 'local_server', 'projects/11500000-aaaa-0000-0000-000000000001/files/a320/local.mov', NULL),
  ('11500000-0000-0000-0000-00000000a321', '11500000-aaaa-0000-0000-000000000001', 'plain.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a321/plain.txt', '');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a301', '11500000-aaaa-0000-0000-000000000002') $$),
  'P0001: body_elsewhere / This file is kept outside WILSON''s storage, so it cannot move this way.', 'body_elsewhere for google_drive');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a302', '11500000-aaaa-0000-0000-000000000002') $$),
  'P0001: body_elsewhere / This file is kept outside WILSON''s storage, so it cannot move this way.', 'body_elsewhere for network_share');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a303', '11500000-aaaa-0000-0000-000000000002') $$),
  'P0001: s3_moves_off / Files in your company''s own bucket cannot move between projects yet.', 's3_moves_off for an s3 row');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-dead-dead-dead-000000000000', '11500000-aaaa-0000-0000-000000000002') $$),
  'P0001: body_missing / That file is not there any more.', 'body_missing for a row that is gone');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a304', '11500000-aaaa-0000-0000-000000000002') $$),
  'P0001: body_missing / This file''s stored copy is missing, so it cannot move.', 'body_missing for a Supabase row with no object');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a305', '11500000-aaaa-0000-0000-000000000002') $$),
  'P0001: body_shape / This file is stored in a way that cannot move between projects.', 'body_shape for a key that fails the shape');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a306', '11500000-aaaa-0000-0000-000000000002') $$),
  'P0001: needs_copy / This file has to be copied to the new project first.', 'needs_copy for a local_server row');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a320', '11500000-aaaa-0000-0000-000000000002') $$),
  'P0001: needs_copy / This file has to be copied to the new project first.', 'and for one whose key names a shared project: its body is on one computer');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a307', '11500000-aaaa-0000-0000-000000000002') $$),
  'P0001: needs_copy / This file has to be copied to the new project first.', 'needs_copy for a key naming a private project other than the destination');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a308', '11500000-aaaa-0000-0000-000000000002') $$),
  'P0001: needs_copy / This file has to be copied to the new project first.', 'needs_copy for a key naming a personal space');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a319', '11500000-aaaa-0000-0000-000000000002') $$),
  'P0001: needs_copy / This file has to be copied to the new project first.', 'needs_copy for a file leaving the private project its key names');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a307', '11500000-aaaa-0000-0000-000000000002', '[{"file_id":"11500000-0000-0000-0000-00000000a309","to_provider":"supabase","to_path":"projects/11500000-aaaa-0000-0000-000000000002/files/a312/copy.txt","to_thumb":null}]') $$),
  'P0001: needs_copy / This file has to be copied to the new project first.', 'and a copy offered for another file is no copy');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a309', '11500000-aaaa-0000-0000-000000000002', '[{"file_id":"11500000-0000-0000-0000-00000000a309","to_provider":"supabase","to_path":"projects/11500000-aaaa-0000-0000-000000000002/files/a312/copy.txt","to_thumb":null}]') $$),
  'P0001: copy_not_needed / This file does not need a new copy to move.', 'copy_not_needed for a shared origin given a copy');

-- By association: the key stays.
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a309', '11500000-aaaa-0000-0000-000000000002') $$),
  '{"set":{},"retire":[]}'::jsonb::text, 'association answers an empty set and retire');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a309', '11500000-aaaa-0000-0000-000000000002', NULL) $$),
  '{"set":{},"retire":[]}'::jsonb::text, 'and a NULL list of copies is no copy');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a311', '11500000-aaaa-0000-0000-000000000002') $$),
  '{"set":{},"retire":[]}'::jsonb::text, 'a derived picture stays with its body');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a307', '11500000-aaaa-0000-0000-000000000003') $$),
  '{"set":{},"retire":[]}'::jsonb::text, 'a move back into the private project its key names is by association');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a314', '11500000-aaaa-0000-0000-000000000003') $$),
  '{"set":{},"retire":[]}'::jsonb::text, 'a key naming a shared project needs no copy, wherever it goes');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a310', '11500000-aaaa-0000-0000-000000000002') $$),
  '{"set":{"thumbnail_url":null},"retire":[{"bucket":"rabbit-thumbnails","path":"projects/11500000-aaaa-0000-0000-000000000001/files/a310/old-picture.jpg","provider":"supabase","kind":"thumbnail"}]}'::jsonb::text,
  'a legacy picture is detached and retired');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a321', '11500000-aaaa-0000-0000-000000000002') $$),
  '{"set":{"thumbnail_url":null},"retire":[]}'::jsonb::text, 'a blank picture is cleared, and nothing is retired for it');

-- A re-home, and its refusals.
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a312', '11500000-aaaa-0000-0000-000000000002', '[{"file_id":"11500000-0000-0000-0000-00000000a312","to_provider":"s3","to_path":"projects/11500000-aaaa-0000-0000-000000000002/files/a312/copy.txt","to_thumb":null}]') $$),
  'P0001: copy_refused / The new copy is not one this project can use.', 'copy_refused for the wrong provider');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a312', '11500000-aaaa-0000-0000-000000000002', '[{"file_id":"11500000-0000-0000-0000-00000000a312","to_provider":"supabase","to_path":"projects/11500000-aaaa-0000-0000-000000000002/files/a312/no-object.txt","to_thumb":null}]') $$),
  'P0001: copy_refused / The new copy is not one this project can use.', 'copy_refused for a path with no object');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a312', '11500000-aaaa-0000-0000-000000000002', '[{"file_id":"11500000-0000-0000-0000-00000000a312","to_provider":"supabase","to_path":"projects/11500000-aaaa-0000-0000-000000000001/files/a312/wrong-project.txt","to_thumb":null}]') $$),
  'P0001: copy_refused / The new copy is not one this project can use.', 'copy_refused for a path under another project');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a312', '11500000-aaaa-0000-0000-000000000002', '[{"file_id":"11500000-0000-0000-0000-00000000a312","to_provider":"supabase","to_path":"projects/11500000-aaaa-0000-0000-000000000002/files/a312/copy.txt","to_thumb":"projects/11500000-aaaa-0000-0000-000000000002/files/a312/other.jpg"}]') $$),
  'P0001: copy_refused / The new copy is not one this project can use.', 'copy_refused for the wrong picture');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a312', '11500000-aaaa-0000-0000-000000000002', '[{"file_id":"11500000-0000-0000-0000-00000000a312","to_provider":"supabase","to_path":"projects/11500000-aaaa-0000-0000-000000000002/shots/a312/copy.txt","to_thumb":null}]') $$),
  'P0001: copy_refused / The new copy is not one this project can use.', 'copy_refused for a third segment other than files, the object there and the key admissible');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a312', '11500000-aaaa-0000-0000-000000000002', '[{"file_id":"11500000-0000-0000-0000-00000000a312","to_provider":"supabase","to_path":"projects/11500000-aaaa-0000-0000-000000000002/INVOICES/a312/copy.txt","to_thumb":null}]') $$),
  'P0001: copy_refused / The new copy is not one this project can use.', 'copy_refused for a money key, even for an admin who may hold money');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a312', '11500000-aaaa-0000-0000-000000000002', '[{"file_id":"11500000-0000-0000-0000-00000000a312","to_provider":"supabase","to_path":"projects/11500000-aaaa-0000-0000-000000000002/files/a312/copy.txt","to_thumb":"projects/11500000-aaaa-0000-0000-000000000002/files/a312/copy.txt.jpg"}]') $$),
  '{"set":{"storage_provider":"supabase","storage_path":"projects/11500000-aaaa-0000-0000-000000000002/files/a312/copy.txt","thumbnail_url":"projects/11500000-aaaa-0000-0000-000000000002/files/a312/copy.txt.jpg"},"retire":[{"bucket":"rabbit-files","path":"projects/11500000-aaaa-0000-0000-000000000003/files/a312/moved.txt","provider":"supabase","kind":"body"},{"bucket":"rabbit-thumbnails","path":"projects/11500000-aaaa-0000-0000-000000000003/files/a312/moved.txt.jpg","provider":"supabase","kind":"thumbnail"}]}'::jsonb::text,
  'a re-home answers set and retire, with body and picture');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a313', '11500000-aaaa-0000-0000-000000000002', '[{"file_id":"11500000-0000-0000-0000-00000000a313","to_provider":"supabase","to_path":"projects/11500000-aaaa-0000-0000-000000000002/files/a313/copy.mov","to_thumb":null}]') $$),
  '{"set":{"storage_provider":"supabase","storage_path":"projects/11500000-aaaa-0000-0000-000000000002/files/a313/copy.mov","thumbnail_url":null},"retire":[{"bucket":"rabbit-thumbnails","path":"projects/11500000-aaaa-0000-0000-000000000003/files/a313/local.mov.jpg","provider":"supabase","kind":"thumbnail"}]}'::jsonb::text,
  'a local original is left to its desktop: only its picture is retired');

-- Retire writes what fn_files_gc_enqueue would, for the same row.
SELECT lives_ok($$ SELECT rabbit_private.files_body_retire('11500000-0000-0000-0000-00000000a312', '[{"bucket":"rabbit-files","path":"projects/11500000-aaaa-0000-0000-000000000003/files/a312/moved.txt","provider":"supabase","kind":"body"},{"bucket":"rabbit-thumbnails","path":"projects/11500000-aaaa-0000-0000-000000000003/files/a312/moved.txt.jpg","provider":"supabase","kind":"thumbnail"}]') $$,
  'files_body_retire takes what follow answered');
SELECT is((SELECT string_agg(bucket_id || '|' || object_path || '|' || provider || '|' || kind || '|' || reason || '|' || status || '|' || workspace_id::text || '|' || file_id::text, chr(10) ORDER BY id)
             FROM public.storage_gc_queue WHERE file_id = '11500000-0000-0000-0000-00000000a312'),
  'rabbit-files|projects/11500000-aaaa-0000-0000-000000000003/files/a312/moved.txt|supabase|body|file-purged|pending|11111111-1111-1111-1111-111111111111|11500000-0000-0000-0000-00000000a312' || chr(10) ||
  'rabbit-thumbnails|projects/11500000-aaaa-0000-0000-000000000003/files/a312/moved.txt.jpg|supabase|thumbnail|file-purged|pending|11111111-1111-1111-1111-111111111111|11500000-0000-0000-0000-00000000a312',
  'one queue row each, with reason file-purged, the file, the kind, the bucket and the provider');
SELECT is(rabbit_private.storage_object_claimed('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000003/files/a312/moved.txt.jpg'), true, 'and the picture is claimed until it is drained');
SELECT lives_ok($$ SELECT rabbit_private.files_body_retire('11500000-0000-0000-0000-00000000a309', NULL) $$, 'a NULL list retires nothing');
SELECT is((SELECT count(*)::int FROM public.storage_gc_queue WHERE file_id = '11500000-0000-0000-0000-00000000a309'), 0, 'and writes nothing');
SELECT lives_ok($$ SELECT rabbit_private.files_body_retire('11500000-0000-0000-0000-00000000a313', '[{"bucket":"rabbit-thumbnails","path":"projects/11500000-aaaa-0000-0000-000000000003/files/a313/local.mov.jpg","provider":"supabase","kind":"thumbnail"}]') $$,
  'a local original''s picture is retired alone');

-- An office-server company, then an s3 company, then back on Petal.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
INSERT INTO public.workspace_storage (workspace_id, provider, mode, root_path, root_kind)
VALUES ('11111111-1111-1111-1111-111111111111', 'network', 'byos', repeat(chr(92), 2) || 'server' || chr(92) || 'share', 'unc')
ON CONFLICT (workspace_id) DO UPDATE SET provider = 'network', mode = 'byos', root_path = EXCLUDED.root_path, root_kind = 'unc', provider_config = NULL;
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a307', '11500000-aaaa-0000-0000-000000000002', '[{"file_id":"11500000-0000-0000-0000-00000000a307","to_provider":"network_share","to_path":"projects/11500000-aaaa-0000-0000-000000000002/files/a312/copy.txt","to_thumb":null}]') $$),
  'P0001: copy_refused / A file moves onto your office server from the desktop app.', 'copy_refused for a company on an office server, whatever the copy says');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a307', '11500000-aaaa-0000-0000-000000000002', '[{"file_id":"11500000-0000-0000-0000-00000000a307","to_provider":"supabase","to_path":"projects/11500000-aaaa-0000-0000-000000000002/files/a312/copy.txt","to_thumb":null}]') $$),
  'P0001: copy_refused / A file moves onto your office server from the desktop app.', 'and for a copy in Petal''s bucket');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
UPDATE public.workspace_storage
   SET provider = 's3', root_path = NULL, root_kind = NULL,
       provider_config = '{"bucket":"b","region":"r","accessKeyId":"k"}'::jsonb
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111';

-- The s3 arms stand behind the switch, so the switch goes on as 0120 will, and back.
CREATE OR REPLACE FUNCTION rabbit_private.s3_body_moves_on()
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT true; $$;
DISCARD PLANS;
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a318', '11500000-aaaa-0000-0000-000000000002') $$),
  '{"set":{},"retire":[]}'::jsonb::text, 'with the switch on, an s3 row moves by association');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a316', '11500000-aaaa-0000-0000-000000000002') $$),
  '{"set":{"thumbnail_url":null},"retire":[{"bucket":"byo-s3","path":"projects/11500000-aaaa-0000-0000-000000000001/files/a316/old-picture.jpg","provider":"s3","kind":"thumbnail"}]}'::jsonb::text,
  'an s3 row''s legacy picture is retired from its own bucket');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a317', '11500000-aaaa-0000-0000-000000000002') $$),
  'P0001: needs_copy / This file has to be copied to the new project first.', 'an s3 key naming a private project needs a copy');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a317', '11500000-aaaa-0000-0000-000000000002', '[{"file_id":"11500000-0000-0000-0000-00000000a317","to_provider":"supabase","to_path":"projects/11500000-aaaa-0000-0000-000000000002/files/a312/copy.txt","to_thumb":null}]') $$),
  'P0001: copy_refused / The new copy is not one this project can use.', 'and a company on s3 refuses a copy in Petal''s bucket');
SELECT is(pg_temp.t115_ask($$ SELECT rabbit_private.files_body_follow('11500000-0000-0000-0000-00000000a317', '11500000-aaaa-0000-0000-000000000002', '[{"file_id":"11500000-0000-0000-0000-00000000a317","to_provider":"s3","to_path":"projects/11500000-aaaa-0000-0000-000000000002/files/a317/copy.bin","to_thumb":"projects/11500000-aaaa-0000-0000-000000000002/files/a317/copy.bin.jpg"}]') $$),
  '{"set":{"storage_provider":"s3","storage_path":"projects/11500000-aaaa-0000-0000-000000000002/files/a317/copy.bin","thumbnail_url":"projects/11500000-aaaa-0000-0000-000000000002/files/a317/copy.bin.jpg"},"retire":[{"bucket":"byo-s3","path":"projects/11500000-aaaa-0000-0000-000000000003/files/a317/moved.bin","provider":"s3","kind":"body"},{"bucket":"byo-s3","path":"projects/11500000-aaaa-0000-0000-000000000003/files/a317/moved.bin.jpg","provider":"s3","kind":"thumbnail"}]}'::jsonb::text,
  'and takes one in its own, where body and picture are retired from its bucket');
SELECT lives_ok($$ SELECT rabbit_private.files_body_retire('11500000-0000-0000-0000-00000000a317', '[{"bucket":"byo-s3","path":"projects/11500000-aaaa-0000-0000-000000000003/files/a317/moved.bin","provider":"s3","kind":"body"},{"bucket":"byo-s3","path":"projects/11500000-aaaa-0000-0000-000000000003/files/a317/moved.bin.jpg","provider":"s3","kind":"thumbnail"}]') $$,
  'files_body_retire takes the s3 answer');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
CREATE OR REPLACE FUNCTION rabbit_private.s3_body_moves_on()
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT false; $$;
DISCARD PLANS;
UPDATE public.workspace_storage SET mode = 'central' WHERE workspace_id = '11111111-1111-1111-1111-111111111111';

-- Deleting each row makes fn_files_gc_enqueue write its own queue rows: each pair must match.
DELETE FROM public.files WHERE id IN ('11500000-0000-0000-0000-00000000a312', '11500000-0000-0000-0000-00000000a313', '11500000-0000-0000-0000-00000000a317');
SELECT is((SELECT count(*)::int FROM (
             SELECT 1 FROM public.storage_gc_queue WHERE file_id = '11500000-0000-0000-0000-00000000a312'
              GROUP BY bucket_id, object_path, provider, kind, reason, workspace_id HAVING count(*) = 2) x), 2,
  'for a Supabase row, fn_files_gc_enqueue writes the same two rows files_body_retire did');
SELECT is((SELECT count(*)::int FROM (
             SELECT 1 FROM public.storage_gc_queue WHERE file_id = '11500000-0000-0000-0000-00000000a313'
              GROUP BY bucket_id, object_path, provider, kind, reason, workspace_id HAVING count(*) = 2) x), 1,
  'for a local_server row, the one picture');
SELECT is((SELECT count(*)::int FROM (
             SELECT 1 FROM public.storage_gc_queue WHERE file_id = '11500000-0000-0000-0000-00000000a317'
              GROUP BY bucket_id, object_path, provider, kind, reason, workspace_id HAVING count(*) = 2) x), 2,
  'for an s3 row, the same two rows in its own bucket');


-- ── J. fn_projects_owner_guard: an id tied to another company ─────────────────
INSERT INTO public.file_events (workspace_id, project_id, file_id, storage_provider, event, old_path) VALUES
  ('22222222-2222-2222-2222-222222222222', '11500000-dddd-0000-0000-000000000001', '11500000-0000-0000-0000-00000000a401', 'supabase', 'purged', 'projects/11500000-dddd-0000-0000-000000000001/files/a401/gone.txt'),
  ('11111111-1111-1111-1111-111111111111', '11500000-dddd-0000-0000-000000000004', '11500000-0000-0000-0000-00000000a404', 'supabase', 'purged', 'projects/11500000-dddd-0000-0000-000000000004/files/a404/gone.txt'),
  ('22222222-2222-2222-2222-222222222222', '11500000-aaaa-0000-0000-000000000001', '11500000-0000-0000-0000-00000000a405', 'supabase', 'purged', 'projects/11500000-aaaa-0000-0000-000000000001/files/a405/gone.txt'),
  ('22222222-2222-2222-2222-222222222222', '11500000-dddd-0000-0000-000000000008', '11500000-0000-0000-0000-00000000a408', 'supabase', 'purged', 'projects/11500000-dddd-0000-0000-000000000008/files/a408/gone.txt'),
  ('11111111-1111-1111-1111-111111111111', '11500000-dddd-0000-0000-000000000009', '11500000-0000-0000-0000-00000000a409', 'supabase', 'purged', 'projects/11500000-dddd-0000-0000-000000000009/files/a409/gone.txt');
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path) VALUES
  ('11500000-0000-0000-0000-00000000a402', '11500000-bbbb-0000-0000-000000000001', 'key.txt', 'supabase', 'projects/11500000-dddd-0000-0000-000000000002/files/a402/key.txt'),
  ('11500000-0000-0000-0000-00000000a403', '11500000-bbbb-0000-0000-000000000001', 'drive.doc', 'google_drive', 'projects/11500000-dddd-0000-0000-000000000003/files/a403/drive.doc'),
  ('11500000-0000-0000-0000-00000000a406', '11500000-aaaa-0000-0000-000000000001', 'own-key.txt', 'supabase', 'projects/11500000-dddd-0000-0000-000000000005/files/a406/own-key.txt');

SELECT is(rabbit_private.project_id_tied_elsewhere('11500000-dddd-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'), true, 'the helper: another company''s file events tie an id');
SELECT is(rabbit_private.project_id_tied_elsewhere('11500000-dddd-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222'), false, 'but not for that company');
SELECT is(rabbit_private.project_id_tied_elsewhere('11500000-dddd-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'), true, 'the helper: another company''s key ties an id');
SELECT is(rabbit_private.project_id_tied_elsewhere('11500000-dddd-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222'), false, 'but not for that company');
SELECT is(rabbit_private.project_id_tied_elsewhere('11500000-dddd-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111'), false, 'a key on a provider that holds no body here does not');
SELECT is(rabbit_private.project_id_tied_elsewhere('11500000-dddd-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111'), false, 'an id nobody names is tied to nobody');
-- A dead project's copies that no row names: a rate card, a manifest, a bin's poster.
INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES
  ('rabbit-files', 'projects/11500000-dddd-0000-0000-00000000000a/FINANCE/RATES.json', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('rabbit-files', 'projects/11500000-dddd-0000-0000-00000000000b/PROJECT.json', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('rabbit-thumbnails', 'projects/11500000-dddd-0000-0000-00000000000c/bin_files/a410/poster.jpg', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT is(rabbit_private.project_id_tied_elsewhere('11500000-dddd-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111'), true, 'the helper: a rate card no row names ties an id');
SELECT is(rabbit_private.project_id_tied_elsewhere('11500000-dddd-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111'), true, 'and a manifest');
SELECT is(rabbit_private.project_id_tied_elsewhere('11500000-dddd-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111'), true, 'and a picture');
SELECT is(rabbit_private.project_id_tied_elsewhere('11500000-dddd-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222'), true, 'for every company: a copy does not say whose it is');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ INSERT INTO public.projects (id, title) VALUES ('11500000-dddd-0000-0000-000000000001', 'Tied by events') $$,
  '42501', 'This project cannot be brought in under that id. Make a new project.', 'an admin creating a project whose id another company''s file events name');
SELECT throws_ok($$ INSERT INTO public.projects (id, workspace_id, title) VALUES ('11500000-dddd-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tied by a key') $$,
  '42501', 'This project cannot be brought in under that id. Make a new project.', 'an admin creating a project whose id another company''s key names');
SELECT throws_ok($$ INSERT INTO public.projects (id, title) VALUES ('11500000-dddd-0000-0000-00000000000a', 'A dead project''s rate card') $$,
  '42501', 'This project cannot be brought in under that id. Make a new project.', 'an admin cannot take a dead project''s id, and with it the rate card its key still authorises');
SELECT lives_ok($$ INSERT INTO public.projects (id, title) VALUES ('11500000-dddd-0000-0000-000000000006', 'Tied to nobody') $$,
  'an id tied to nobody passes');
SELECT is((SELECT count(*)::int FROM public.projects WHERE id = '11500000-dddd-0000-0000-000000000006'), 1, 'and the project is there');
SELECT lives_ok($$ INSERT INTO public.projects (id, title) VALUES ('11500000-dddd-0000-0000-000000000003', 'Named by a key that holds no body here') $$,
  'a key on another provider ties nothing');
SELECT lives_ok($$ INSERT INTO public.projects (id, title) VALUES ('11500000-dddd-0000-0000-000000000005', 'Named by this company''s own key') $$,
  'this company''s own key ties nothing: a re-carry passes');
SELECT throws_ok($$ INSERT INTO public.projects (id, title) VALUES ('11500000-dddd-0000-0000-000000000004', 'This company had it') $$,
  '42501', 'That project was deleted for good, and its id cannot be used again. Make a new project.', '0110''s arm still answers for an id this company has had');
SELECT throws_ok($$ INSERT INTO public.projects (id, title) VALUES ('11500000-aaaa-0000-0000-000000000001', 'A live id') $$,
  '23505', NULL, 'a live row''s id still answers 23505, even one another company''s events name');
SELECT throws_ok($$ INSERT INTO public.projects (id, workspace_id, title) VALUES ('11500000-dddd-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Naming the other company') $$,
  '42501', 'new row violates row-level security policy for table "projects"', 'an admin naming another company hears RLS');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ INSERT INTO public.projects (id, title) VALUES ('11500000-dddd-0000-0000-000000000001', 'Tied by events') $$,
  '42501', 'This project cannot be brought in under that id. Make a new project.', 'a workspace manager, whom projects_insert admits, hears the sentence');
SELECT throws_ok($$ INSERT INTO public.projects (id, workspace_id, title) VALUES ('11500000-dddd-0000-0000-000000000009', '22222222-2222-2222-2222-222222222222', 'Naming a company they also belong to') $$,
  '42501', 'new row violates row-level security policy for table "projects"', 'a caller naming another company they also belong to hears RLS, judged only for the company in the token');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ INSERT INTO public.projects (id, title) VALUES ('11500000-dddd-0000-0000-000000000001', 'Tied by events') $$,
  '42501', 'new row violates row-level security policy for table "projects"', 'a non-admin hears RLS''s answer for a tied id, not this sentence');
SELECT throws_ok($$ INSERT INTO public.projects (id, title) VALUES ('11500000-dddd-0000-0000-000000000007', 'Tied to nobody') $$,
  '42501', 'new row violates row-level security policy for table "projects"', 'the same answer as for an id tied to nobody');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '99999999-9999-9999-9999-999999999999', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ INSERT INTO public.projects (id, title) VALUES ('11500000-dddd-0000-0000-000000000001', 'Tied by events') $$,
  '42501', 'new row violates row-level security policy for table "projects"', 'an inactive admin hears RLS too');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT lives_ok($$ INSERT INTO public.projects (id, workspace_id, title) VALUES ('11500000-dddd-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'The runner') $$,
  'the runner, unbound, may bring a tied id in');


-- ── K. fn_same_project_refs_guard: the skip is gone ──────────────────────────
INSERT INTO public.phases (id, project_id, name) VALUES
  ('11500000-0000-0000-0000-00000000a501', '11500000-aaaa-0000-0000-000000000001', 'A phase of S'),
  ('11500000-0000-0000-0000-00000000a502', '11500000-aaaa-0000-0000-000000000002', 'A phase of T');
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path) VALUES
  ('11500000-0000-0000-0000-00000000a503', '11500000-aaaa-0000-0000-000000000001', 'a.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a503/a.txt');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.t115_marked('wilson.checked_move', 'on',
    $q$ UPDATE public.files SET phase_id = '11500000-0000-0000-0000-00000000a502' WHERE id = '11500000-0000-0000-0000-00000000a503' $q$) $$,
  '23503', 'That item belongs to another project or no longer exists.', 'a definer that sets wilson.checked_move and writes a cross-project reference is still refused');
SELECT throws_ok($$ SELECT public.t115_exec($q$ UPDATE public.files SET phase_id = '11500000-0000-0000-0000-00000000a502' WHERE id = '11500000-0000-0000-0000-00000000a503' $q$) $$,
  '23503', 'That item belongs to another project or no longer exists.', 'as it is without the setting');
SELECT lives_ok($$ SELECT public.t115_marked('wilson.checked_move', 'on',
    $q$ UPDATE public.files SET phase_id = '11500000-0000-0000-0000-00000000a501' WHERE id = '11500000-0000-0000-0000-00000000a503' $q$) $$,
  'CONTROL: a reference inside the project passes');
SELECT is((SELECT phase_id FROM public.files WHERE id = '11500000-0000-0000-0000-00000000a503'), '11500000-0000-0000-0000-00000000a501'::uuid, 'and it lands');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT is((SELECT count(*)::int FROM pg_proc p
            WHERE p.pronamespace IN ('public'::regnamespace, 'rabbit_private'::regnamespace)
              AND p.prosrc LIKE '%wilson.checked_move%'), 0,
  'no function in public or rabbit_private reads that setting');


-- ── L. Which functions name each marker ──────────────────────────────────────
-- 0117 and 0118 extend these lists, each with the functions it adds: the catalogue's
-- writers name the office-server marker, fn_moth_apply_moves the journal's. The planted
-- definers go first.
DROP FUNCTION public.t115_whoami();
DROP FUNCTION public.t115_exec(text);
DROP FUNCTION public.t115_marked(text, text, text);
DROP FUNCTION public.t115_journal_move(jsonb, text);

SELECT is((SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p
            WHERE p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
              AND p.prosrc LIKE '%wilson.file_move%'),
  ARRAY['fn_checked_move_admits'],
  'wilson.file_move is named by fn_checked_move_admits and nothing else');
SELECT is((SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p
            WHERE p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
              AND p.prosrc LIKE '%wilson.body_rekey%'),
  ARRAY['fn_files_body_guard', 'rekey_file_body'],
  'wilson.body_rekey is named by rekey_file_body and fn_files_body_guard and nothing else');
SELECT is((SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p
            WHERE p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
              AND p.prosrc LIKE '%wilson.network_share_writer%'),
  ARRAY['fn_file_events_capture', 'fn_files_body_guard', 'fn_realtime_broadcast'],
  'wilson.network_share_writer is read by the guard and, since 0116, by the capture and the broadcast, and named by nothing else');

-- ── M. 0115: who reaches a stored copy, as the storage policies read it ─────────────
-- Real reads and writes on storage.objects, each as the person named. Added here:
-- G private and created by user_f, X shared and purged below, and a seat for user_e on T,
-- so T is staffed and user_c cannot write it. Files a6nn. A file's key may name a project
-- that is not its own only because no client can write that (0114); the runner can.
-- 0118 is what will make such rows real.
CREATE FUNCTION pg_temp.t115_login(p_user uuid, p_ws uuid, p_app_role text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_app_role))::text, true);
  SET LOCAL ROLE authenticated;
END;
$$;
CREATE FUNCTION pg_temp.t115_logout() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  RESET ROLE;
END;
$$;
CREATE FUNCTION pg_temp.t115_sees(p_bucket text, p_name text) RETURNS int
LANGUAGE sql AS $$
  SELECT count(*)::int FROM storage.objects WHERE bucket_id = p_bucket AND name = p_name;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.t115_login(uuid, uuid, text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.t115_logout() TO PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.t115_sees(text, text) TO PUBLIC;

SELECT pg_temp.t115_logout();
INSERT INTO public.projects (id, workspace_id, title, is_private, created_by) VALUES
  ('11500000-aaaa-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Private G', true, 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  ('11500000-aaaa-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'Origin X', false, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO public.project_members (project_id, user_id, project_role) VALUES
  ('11500000-aaaa-0000-0000-000000000002', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'member');

INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, thumbnail_url, is_financial, deleted_at) VALUES
  -- An ordinary file: the key says what the row says.
  ('11500000-0000-0000-0000-00000000a601', '11500000-aaaa-0000-0000-000000000001', 'plain.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a601/plain.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a601/plain.txt.jpg', false, NULL),
  -- Moved out of shared S into private P, which user_c created.
  ('11500000-0000-0000-0000-00000000a602', '11500000-aaaa-0000-0000-000000000003', 'to-private.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a602/to-private.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a602/to-private.txt.jpg', false, NULL),
  -- Moved out of private G into shared S.
  ('11500000-0000-0000-0000-00000000a603', '11500000-aaaa-0000-0000-000000000001', 'from-private.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000007/files/a603/from-private.txt', 'projects/11500000-aaaa-0000-0000-000000000007/files/a603/from-private.txt.jpg', false, NULL),
  ('11500000-0000-0000-0000-00000000a604', '11500000-aaaa-0000-0000-000000000001', 'trashed.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a604/trashed.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a604/trashed.txt.jpg', false, now()),
  -- A receipt under an ordinary key: the base policies are what it answers to.
  ('11500000-0000-0000-0000-00000000a605', '11500000-aaaa-0000-0000-000000000001', 'receipt.pdf', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a605/receipt.pdf', 'projects/11500000-aaaa-0000-0000-000000000001/files/a605/receipt.pdf.jpg', true, NULL),
  ('11500000-0000-0000-0000-00000000a606', '11500000-bbbb-0000-0000-000000000001', 'theirs.txt', 'supabase', 'projects/11500000-bbbb-0000-0000-000000000001/files/a606/theirs.txt', 'projects/11500000-bbbb-0000-0000-000000000001/files/a606/theirs.txt.jpg', false, NULL),
  -- Moved out of X into T; X is purged below and its id taken by another company.
  ('11500000-0000-0000-0000-00000000a607', '11500000-aaaa-0000-0000-000000000002', 'out-of-x.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000008/files/a607/out-of-x.txt', 'projects/11500000-aaaa-0000-0000-000000000008/files/a607/out-of-x.txt.jpg', false, NULL),
  -- Purged below: moved out of live S (a608, with a copy; a609, without), and not moved (a610, a611).
  ('11500000-0000-0000-0000-00000000a608', '11500000-aaaa-0000-0000-000000000002', 'purged-moved.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a608/purged-moved.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a608/purged-moved.txt.jpg', false, NULL),
  ('11500000-0000-0000-0000-00000000a609', '11500000-aaaa-0000-0000-000000000002', 'purged-moved-gone.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a609/purged-moved-gone.txt', NULL, false, NULL),
  ('11500000-0000-0000-0000-00000000a610', '11500000-aaaa-0000-0000-000000000001', 'purged-here.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a610/purged-here.txt', NULL, false, NULL),
  ('11500000-0000-0000-0000-00000000a611', '11500000-aaaa-0000-0000-000000000001', 'carried-again.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a611/carried-again.txt', NULL, false, NULL),
  -- Pictures named only by thumbnail_url: a legacy one, one trashed, one flagged, a re-file stopped between its phases.
  ('11500000-0000-0000-0000-00000000a612', '11500000-aaaa-0000-0000-000000000001', 'legacy.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a612/legacy.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a612/old-picture.png', false, NULL),
  ('11500000-0000-0000-0000-00000000a613', '11500000-aaaa-0000-0000-000000000001', 'legacy-trashed.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a613/legacy-trashed.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a613/old-picture.jpg', false, now()),
  ('11500000-0000-0000-0000-00000000a614', '11500000-aaaa-0000-0000-000000000001', 'legacy-flagged.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a614/legacy-flagged.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a614/old-picture.jpg', true, NULL),
  ('11500000-0000-0000-0000-00000000a615', '11500000-aaaa-0000-0000-000000000001', 'refiled.mov', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a615/take-2/refiled.mov', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a615/take-1/refiled.mov.jpg', false, NULL),
  ('11500000-0000-0000-0000-00000000a616', '11500000-aaaa-0000-0000-000000000001', 's3-names-a-petal-picture.bin', 's3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a616/x.bin', 'projects/11500000-aaaa-0000-0000-000000000001/files/a616/petal-picture.jpg', false, NULL),
  ('11500000-0000-0000-0000-00000000a617', '11500000-aaaa-0000-0000-000000000001', 'drive-names-a-petal-picture.doc', 'google_drive', 'drive-a617', 'projects/11500000-aaaa-0000-0000-000000000001/files/a617/petal-picture.jpg', false, NULL),
  -- A picture one row's key implies and another's thumbnail_url names.
  ('11500000-0000-0000-0000-00000000a618', '11500000-aaaa-0000-0000-000000000001', 'twin-a.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a618/twin.txt', NULL, false, NULL),
  ('11500000-0000-0000-0000-00000000a619', '11500000-aaaa-0000-0000-000000000001', 'twin-b.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a619/twin.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a618/twin.txt.jpg', false, NULL),
  -- Two rows whose thumbnail_url names one picture.
  ('11500000-0000-0000-0000-00000000a620', '11500000-aaaa-0000-0000-000000000001', 'share-a.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a620/a.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a620/shared.jpg', false, NULL),
  ('11500000-0000-0000-0000-00000000a621', '11500000-aaaa-0000-0000-000000000001', 'share-b.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a621/b.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a620/shared.jpg', false, NULL),
  -- A row whose thumbnail_url names a row-less shape: the shape wins.
  ('11500000-0000-0000-0000-00000000a622', '11500000-aaaa-0000-0000-000000000001', 'names-a-poster.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a622/names-a-poster.txt', 'projects/11500000-aaaa-0000-0000-000000000001/bin_files/a622/poster.jpg', false, NULL),
  -- Moved out of T into S: a writer of S regenerates its picture, a writer of T cannot. a624 has no picture yet.
  ('11500000-0000-0000-0000-00000000a623', '11500000-aaaa-0000-0000-000000000001', 'out-of-t.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000002/files/a623/out-of-t.txt', 'projects/11500000-aaaa-0000-0000-000000000002/files/a623/out-of-t.txt.jpg', false, NULL),
  ('11500000-0000-0000-0000-00000000a624', '11500000-aaaa-0000-0000-000000000001', 'no-picture-yet.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000002/files/a624/no-picture-yet.txt', NULL, false, NULL),
  -- user_c uploaded these: a named body and picture, a trashed row's picture.
  ('11500000-0000-0000-0000-00000000a625', '11500000-aaaa-0000-0000-000000000001', 'own-named.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a625/own-named.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a625/own-named.txt.jpg', false, NULL),
  ('11500000-0000-0000-0000-00000000a626', '11500000-aaaa-0000-0000-000000000001', 'own-trashed.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a626/own-trashed.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a626/own-trashed.txt.jpg', false, now()),
  -- An invoice: the money policies answer, whatever the row says. And one trashed: they do not read the row.
  ('11500000-0000-0000-0000-00000000a627', '11500000-aaaa-0000-0000-000000000001', 'invoice.pdf', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a627/invoice.pdf', NULL, true, NULL),
  ('11500000-0000-0000-0000-00000000a655', '11500000-aaaa-0000-0000-000000000001', 'invoice-trashed.pdf', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a655/invoice-trashed.pdf', NULL, true, now()),
  -- Moved out of hidden G into S, with nothing stored yet: a writer of S makes its copy and its picture.
  ('11500000-0000-0000-0000-00000000a628', '11500000-aaaa-0000-0000-000000000001', 'from-hidden.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000007/files/a628/from-hidden.txt', 'projects/11500000-aaaa-0000-0000-000000000007/files/a628/from-hidden.txt.jpg', false, NULL),
  -- Moved out of T into S, its picture uploaded by a writer of T.
  ('11500000-0000-0000-0000-00000000a646', '11500000-aaaa-0000-0000-000000000001', 'out-of-t-2.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000002/files/a646/out-of-t-2.txt', 'projects/11500000-aaaa-0000-0000-000000000002/files/a646/out-of-t-2.txt.jpg', false, NULL),
  -- Planted before 0114, when thumbnail_url took any text: a name under another project.
  -- Another company's picture its own row names; a hidden project's; another company's nothing names.
  ('11500000-0000-0000-0000-00000000a650', '11500000-aaaa-0000-0000-000000000001', 'names-theirs.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a650/names-theirs.txt', 'projects/11500000-bbbb-0000-0000-000000000001/files/a606/theirs.txt.jpg', false, NULL),
  ('11500000-0000-0000-0000-00000000a651', '11500000-aaaa-0000-0000-000000000001', 'names-hidden.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a651/names-hidden.txt', 'projects/11500000-aaaa-0000-0000-000000000007/files/a652/hidden.txt.jpg', false, NULL),
  ('11500000-0000-0000-0000-00000000a652', '11500000-aaaa-0000-0000-000000000007', 'hidden.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000007/files/a652/hidden.txt', 'projects/11500000-aaaa-0000-0000-000000000007/files/a652/hidden.txt.jpg', false, NULL),
  ('11500000-0000-0000-0000-00000000a654', '11500000-aaaa-0000-0000-000000000001', 'names-unnamed.txt', 'supabase', 'projects/11500000-aaaa-0000-0000-000000000001/files/a654/names-unnamed.txt', 'projects/11500000-bbbb-0000-0000-000000000001/files/a653/unnamed.jpg', false, NULL);

INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
SELECT b, k, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{"size":1}'::jsonb
  FROM (VALUES
    ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a601/plain.txt'),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a601/plain.txt.jpg'),
    ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a602/to-private.txt'),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a602/to-private.txt.jpg'),
    ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000007/files/a603/from-private.txt'),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000007/files/a603/from-private.txt.jpg'),
    ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a604/trashed.txt'),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a604/trashed.txt.jpg'),
    ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a605/receipt.pdf'),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a605/receipt.pdf.jpg'),
    ('rabbit-files', 'projects/11500000-bbbb-0000-0000-000000000001/files/a606/theirs.txt'),
    ('rabbit-thumbnails', 'projects/11500000-bbbb-0000-0000-000000000001/files/a606/theirs.txt.jpg'),
    ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000008/files/a607/out-of-x.txt'),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000008/files/a607/out-of-x.txt.jpg'),
    ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a608/purged-moved.txt'),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a608/purged-moved.txt.jpg'),
    ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a610/purged-here.txt'),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a612/old-picture.png'),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a613/old-picture.jpg'),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a614/old-picture.jpg'),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a615/take-1/refiled.mov.jpg'),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a616/petal-picture.jpg'),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a618/twin.txt.jpg'),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a620/shared.jpg'),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/bin_files/a622/poster.jpg'),
    ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000002/files/a623/out-of-t.txt'),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000002/files/a623/out-of-t.txt.jpg'),
    ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a627/invoice.pdf'),
    -- Row-less shapes, and copies nothing names.
    ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/PROJECT.json'),
    ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000003/PROJECT.json'),
    ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/FINANCE/RATES.json'),
    ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/connection-check/a630/check'),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/bin_files/a631/poster.jpg'),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000003/bin_files/a632/poster.jpg'),
    ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a633/orphan.txt'),
    ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000003/files/a634/orphan.txt'),
    ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000006/files/a635/binned.txt'),
    ('rabbit-files', 'projects/11500000-bbbb-0000-0000-000000000001/files/a636/orphan.txt'),
    ('rabbit-files', 'elsewhere/11500000-aaaa-0000-0000-000000000001/files/a639/outside.txt'),
    ('rabbit-thumbnails', 'elsewhere/11500000-aaaa-0000-0000-000000000001/files/a639/outside.txt.jpg'),
    ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a655/invoice-trashed.pdf'),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a627/invoice.pdf.jpg'),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a649/unnamed.pdf.jpg'),
    ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a615/take-1/refiled.mov'),
    ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a614/old-picture'),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000007/files/a652/hidden.txt.jpg'),
    ('rabbit-thumbnails', 'projects/11500000-bbbb-0000-0000-000000000001/files/a653/unnamed.jpg')
  ) AS v(b, k);
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata, created_at)
SELECT b, k, 'cccccccc-cccc-cccc-cccc-cccccccccccc', '{"size":1}'::jsonb, t
  FROM (VALUES
    ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a625/own-named.txt', now()),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a625/own-named.txt.jpg', now()),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a626/own-trashed.txt.jpg', now()),
    ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a637/own-unnamed.txt', now()),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a637/own-unnamed.txt.jpg', now()),
    ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a638/own-old.txt', now() - interval '2 hours'),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a638/own-old.txt.jpg', now() - interval '2 hours'),
    ('rabbit-files', 'elsewhere/11500000-aaaa-0000-0000-000000000001/files/a648/own-outside.txt', now()),
    ('rabbit-thumbnails', 'elsewhere/11500000-aaaa-0000-0000-000000000001/files/a648/own-outside.txt.jpg', now())
  ) AS v(b, k, t);
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
SELECT b, k, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '{"size":1}'::jsonb
  FROM (VALUES
    -- user_e uploaded these: under S, which they read and do not write; a picture of a file moved out of T into S.
    ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a645/e-own.txt'),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a645/e-own.txt.jpg'),
    ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000002/files/a646/out-of-t-2.txt.jpg')
  ) AS v(b, k);

-- The new arm, on its own.
SELECT is(rabbit_private.storage_object_claimed('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a612/old-picture.png'), true, 'a row claims the picture only its thumbnail_url names, whatever its ending');
SELECT is(rabbit_private.storage_object_claimed('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a613/old-picture.jpg'), true, 'a trashed row too');
SELECT is(rabbit_private.storage_object_claimed('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a615/take-1/refiled.mov.jpg'), true, 'so does a re-file stopped between its phases');
SELECT is(rabbit_private.storage_object_claimed('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a616/petal-picture.jpg'), false, 'an s3 row''s thumbnail_url claims nothing in Petal''s picture bucket');
SELECT is(rabbit_private.storage_object_claimed('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a617/petal-picture.jpg'), false, 'nor does a Drive row''s');
SELECT is(rabbit_private.storage_object_claimed('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a612/old-picture.png'), false, 'and a thumbnail_url claims nothing in the body bucket');
SELECT is(rabbit_private.storage_object_claimed('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/bin_files/a622/poster.jpg'), false, 'a row-less shape stays row-less though a row names it');
SELECT is(rabbit_private.storage_object_claimed('rabbit-thumbnails', 'projects/11500000-bbbb-0000-0000-000000000001/files/a653/unnamed.jpg'), false, 'a thumbnail_url under another project claims nothing: a client could write any text there before 0114');
SELECT is(rabbit_private.storage_object_claimed('rabbit-thumbnails', 'projects/11500000-bbbb-0000-0000-000000000001/files/a606/theirs.txt.jpg'), true, 'CONTROL: the picture''s own row still claims it');
SELECT is(pg_get_indexdef('public.files_thumbnail_url_idx'::regclass),
  'CREATE INDEX files_thumbnail_url_idx ON public.files USING btree (thumbnail_url) WHERE ((thumbnail_url IS NOT NULL) AND (storage_provider = ANY (ARRAY[''supabase''::storage_provider, ''local_server''::storage_provider])))',
  'the picture arm has its partial index');

-- ── A plain reader of S with no seat anywhere else that matters: user_e reads S and T, not P or G.
SELECT pg_temp.t115_login('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'user');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a601/plain.txt'), 1, 'CONTROL: a reader of S reads an ordinary file''s copy');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a601/plain.txt.jpg'), 1, 'and its picture, named both ways, by one row');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a602/to-private.txt'), 0, 'a file moved out of S into a project hidden from this reader: its copy no longer answers to S');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a602/to-private.txt.jpg'), 0, 'nor does its picture');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000007/files/a603/from-private.txt'), 1, 'a file moved into S from a project hidden from this reader: its copy answers to S');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000007/files/a603/from-private.txt.jpg'), 1, 'and so does its picture');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a604/trashed.txt'), 0, 'a trashed file''s copy answers to nobody');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a604/trashed.txt.jpg'), 0, 'nor does its picture');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a605/receipt.pdf'), 0, 'a receipt under an ordinary key is not a non-money reader''s');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a605/receipt.pdf.jpg'), 0, 'nor is its picture');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-bbbb-0000-0000-000000000001/files/a606/theirs.txt'), 0, 'another company''s file is not read');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-bbbb-0000-0000-000000000001/files/a606/theirs.txt.jpg'), 0, 'nor its picture');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a612/old-picture.png'), 1, 'CONTROL: a picture only thumbnail_url names answers to its live row');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a613/old-picture.jpg'), 0, 'once that row is trashed nobody reads it');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a614/old-picture.jpg'), 0, 'nor a non-money reader, when the row is flagged');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a615/take-1/refiled.mov.jpg'), 1, 'a re-file stopped between its phases keeps its old picture readable through the row');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a616/petal-picture.jpg'), 1, 'CONTROL: what an s3 row''s thumbnail_url names here is unclaimed, so the old rule answers');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a618/twin.txt.jpg'), 0, 'a picture two rows name, one by its key and one by its thumbnail_url: neither answers');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a620/shared.jpg'), 0, 'nor when both name it by thumbnail_url');
-- Unclaimed: the rule each key always had.
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/PROJECT.json'), 1, 'PROJECT.json reads as it did');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000003/PROJECT.json'), 0, 'a hidden project''s does not');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/FINANCE/RATES.json'), 0, 'a rate card is not a non-money reader''s');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/connection-check/a630/check'), 1, 'a connection check reads as it did');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/bin_files/a631/poster.jpg'), 1, 'a bin poster reads as it did');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000003/bin_files/a632/poster.jpg'), 0, 'a hidden project''s does not');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/bin_files/a622/poster.jpg'), 1, 'and a row naming a poster does not change that');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a633/orphan.txt'), 1, 'a copy nothing names reads as it did');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000003/files/a634/orphan.txt'), 0, 'a hidden project''s does not');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000006/files/a635/binned.txt'), 0, 'nor a binned project''s');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-bbbb-0000-0000-000000000001/files/a636/orphan.txt'), 0, 'nor another company''s');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a627/invoice.pdf'), 0, 'an invoice is not a non-money reader''s');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a655/invoice-trashed.pdf'), 0, 'nor a trashed one');
SELECT is(pg_temp.t115_sees('rabbit-files', 'elsewhere/11500000-aaaa-0000-0000-000000000001/files/a639/outside.txt'), 0, 'a key outside projects/ reads for nobody');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'elsewhere/11500000-aaaa-0000-0000-000000000001/files/a639/outside.txt.jpg'), 0, 'nor a picture');

-- ── The creator of private P, who writes S and has no money.
SELECT pg_temp.t115_logout();
SELECT pg_temp.t115_login('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'user');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a602/to-private.txt'), 1, 'CONTROL: the file moved into P is read by P''s reader');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a602/to-private.txt.jpg'), 1, 'and so is its picture');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000003/PROJECT.json'), 1, 'CONTROL: and P''s own manifest');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000003/files/a634/orphan.txt'), 1, 'and a copy nothing names under P');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a604/trashed.txt'), 0, 'trashed is trashed for a writer too');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a605/receipt.pdf'), 0, 'and a receipt is not a writer''s without money');
-- Their row names a picture that is not theirs, planted before 0114. It opens nothing.
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-bbbb-0000-0000-000000000001/files/a606/theirs.txt.jpg'), 0, 'a row in S naming another company''s picture does not read it');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000007/files/a652/hidden.txt.jpg'), 0, 'nor a hidden project''s');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-bbbb-0000-0000-000000000001/files/a653/unnamed.jpg'), 0, 'nor one nothing else names');
SELECT is(rabbit_private.storage_object_current_project('rabbit-thumbnails', 'projects/11500000-bbbb-0000-0000-000000000001/files/a606/theirs.txt.jpg'), NULL::uuid, 'the row does not answer for it');
WITH upd AS (
  UPDATE storage.objects SET metadata = '{"size":9}'::jsonb
   WHERE bucket_id = 'rabbit-thumbnails' AND name = 'projects/11500000-bbbb-0000-0000-000000000001/files/a606/theirs.txt.jpg'
  RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 0, 'and it does not overwrite it');
SELECT throws_ok($$ INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
                    VALUES ('rabbit-thumbnails', 'projects/11500000-bbbb-0000-0000-000000000001/files/a653/never-there.jpg', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '{"size":1}'::jsonb) $$,
  '42501', 'new row violates row-level security policy for table "objects"', 'CONTROL: nor write beside it, under another company''s project');
-- A new row cannot take a picture another row names: this caller sees only their own, so
-- they would be answered for both. The same key on another provider, the same refusal.
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000a660', '11500000-aaaa-0000-0000-000000000001', 'x', 'local_server', 'projects/11500000-aaaa-0000-0000-000000000001/files/a614/old-picture') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'a writer cannot take the key whose picture a flagged row hidden from them names');
SELECT throws_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                    VALUES ('11500000-0000-0000-0000-00000000a661', '11500000-aaaa-0000-0000-000000000001', 'x', 'local_server', 'projects/11500000-aaaa-0000-0000-000000000001/files/a613/old-picture') $$,
  '42501', 'This file''s stored copy is not one this project can claim.', 'nor a trashed row''s');
SELECT is(pg_temp.t115_ask($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a625', 'projects/11500000-aaaa-0000-0000-000000000001/files/a625/own-named.txt', 'projects/11500000-aaaa-0000-0000-000000000001/files/a614/old-picture', 'projects/11500000-aaaa-0000-0000-000000000001/files/a625/own-named.txt.jpg', NULL, false) $$),
  '42501: file not found or not writable', 'and a re-key cannot reach it either');
SELECT lives_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                   VALUES ('11500000-0000-0000-0000-00000000a662', '11500000-aaaa-0000-0000-000000000001', 'x', 's3', 'projects/11500000-aaaa-0000-0000-000000000001/files/a614/old-picture') $$,
  'CONTROL: an s3 row keeps its picture in the company''s own bucket, so that key is free for it');
SELECT lives_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                   VALUES ('11500000-0000-0000-0000-00000000a663', '11500000-aaaa-0000-0000-000000000001', 'x', 'local_server', 'projects/11500000-aaaa-0000-0000-000000000001/files/a614/another-picture') $$,
  'CONTROL: and a key whose picture nothing names is free');
SELECT lives_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                   VALUES ('11500000-0000-0000-0000-00000000a665', '11500000-aaaa-0000-0000-000000000001', 'x', 'local_server', 'projects/11500000-aaaa-0000-0000-000000000001/files/a616/petal-picture') $$,
  'and a thumbnail_url on another provider''s row keeps no key from anyone: it claims nothing here');
SELECT is(pg_temp.t115_ask($$ SELECT public.rekey_file_body('11500000-0000-0000-0000-00000000a615', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a615/take-2/refiled.mov', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a615/take-1/refiled.mov', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a615/take-1/refiled.mov.jpg', 'projects/11500000-aaaa-0000-0000-000000000001/shots/a615/take-1/refiled.mov.jpg', false) $$),
  'true', 'a re-file stopped between its phases can go back: the picture its own row names keeps nothing from that row');

-- ── A manager of S: money, and no way into P.
SELECT pg_temp.t115_logout();
SELECT pg_temp.t115_login('ffffffff-ffff-ffff-ffff-ffffffffffff', '11111111-1111-1111-1111-111111111111', 'user');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a605/receipt.pdf'), 1, 'CONTROL: a receipt under an ordinary key is a money reader''s');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a605/receipt.pdf.jpg'), 1, 'and its picture');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a614/old-picture.jpg'), 1, 'and a flagged row''s picture only thumbnail_url names');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/FINANCE/RATES.json'), 1, 'CONTROL: and a rate card, as before');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a627/invoice.pdf'), 1, 'CONTROL: and an invoice, through the money policies');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a602/to-private.txt'), 0, 'a manager of the old project reads nothing of a file moved out to a hidden one');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a604/trashed.txt'), 0, 'trashed is trashed for a manager too');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a655/invoice-trashed.pdf'), 1, 'but the money policies do not read the row: a trashed invoice stays open to whoever may restore it');

-- ── The company's admin reads everything visible, and still nothing trashed.
SELECT pg_temp.t115_logout();
SELECT pg_temp.t115_login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'admin');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a604/trashed.txt'), 0, 'trashed is trashed for an admin too');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a613/old-picture.jpg'), 0, 'and a trashed row''s picture only thumbnail_url names');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a602/to-private.txt'), 1, 'CONTROL: an admin reads the file moved into a private project');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a605/receipt.pdf'), 1, 'CONTROL: and the receipt');

-- ── An inactive member's token still says they belong; nothing answers to it.
SELECT pg_temp.t115_logout();
SELECT pg_temp.t115_login('99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'user');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a601/plain.txt'), 0, 'an inactive member reads no named copy');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a633/orphan.txt'), 0, 'and no unnamed one');

-- ── Another company's member, with their own file.
SELECT pg_temp.t115_logout();
SELECT pg_temp.t115_login('dddddddd-dddd-dddd-dddd-dddddddddddd', '22222222-2222-2222-2222-222222222222', 'user');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-bbbb-0000-0000-000000000001/files/a606/theirs.txt'), 1, 'CONTROL: a member of the other company reads their own file');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-bbbb-0000-0000-000000000001/files/a606/theirs.txt.jpg'), 1, 'and its picture, whatever a row elsewhere says of it');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-bbbb-0000-0000-000000000001/files/a653/unnamed.jpg'), 1, 'and a picture nothing of theirs names, though a row elsewhere names it');
SELECT lives_ok($$ INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
                   VALUES ('11500000-0000-0000-0000-00000000a664', '11500000-bbbb-0000-0000-000000000001', 'x', 'local_server', 'projects/11500000-bbbb-0000-0000-000000000001/files/a653/unnamed') $$,
  'and a row elsewhere cannot keep them from a key: a name under another project claims nothing');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a601/plain.txt'), 0, 'and nothing of this company''s');

-- ── X is purged: what was moved out of it answers to where it went.
SELECT pg_temp.t115_logout();
DELETE FROM public.projects WHERE id = '11500000-aaaa-0000-0000-000000000008';
SELECT pg_temp.t115_login('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'user');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000008/files/a607/out-of-x.txt'), 1, 'its old project purged, a moved copy still reads');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000008/files/a607/out-of-x.txt.jpg'), 1, 'and its picture');
-- SEC-1: a project in another company takes X's id. The runner can; 0114's guard refuses a client.
SELECT pg_temp.t115_logout();
INSERT INTO public.projects (id, workspace_id, title, is_private, created_by) VALUES
  ('11500000-aaaa-0000-0000-000000000008', '22222222-2222-2222-2222-222222222222', 'Took the id', false, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT pg_temp.t115_login('dddddddd-dddd-dddd-dddd-dddddddddddd', '22222222-2222-2222-2222-222222222222', 'user');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000008/files/a607/out-of-x.txt'), 0, 'a project in another company holding the id reads nothing a file names');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000008/files/a607/out-of-x.txt.jpg'), 0, 'nor its picture');
SELECT lives_ok($$ INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
                   VALUES ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000008/files/a607/fresh-picture.jpg', 'dddddddd-dddd-dddd-dddd-dddddddddddd', '{"size":1}'::jsonb) $$,
  'CONTROL: a fresh key under that id is theirs to write: nothing names it');
WITH upd AS (
  UPDATE storage.objects SET metadata = '{"size":9}'::jsonb
   WHERE bucket_id = 'rabbit-thumbnails' AND name = 'projects/11500000-aaaa-0000-0000-000000000008/files/a607/out-of-x.txt.jpg'
  RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 0, 'but what a file in the other company names is not theirs to overwrite');
SELECT pg_temp.t115_logout();
SELECT pg_temp.t115_login('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'admin');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000008/files/a607/out-of-x.txt'), 0, 'nor does that company''s admin read it');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000008/files/a607/out-of-x.txt.jpg'), 0, 'nor its picture');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000008/files/a607/fresh-picture.jpg'), 1, 'CONTROL: that admin reads what nothing names under the id it holds');
WITH upd AS (
  UPDATE storage.objects SET metadata = '{"size":9}'::jsonb
   WHERE bucket_id = 'rabbit-thumbnails' AND name = 'projects/11500000-aaaa-0000-0000-000000000008/files/a607/fresh-picture.jpg'
  RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 1, 'CONTROL: and writes it');
WITH upd AS (
  UPDATE storage.objects SET metadata = '{"size":9}'::jsonb
   WHERE bucket_id = 'rabbit-thumbnails' AND name = 'projects/11500000-aaaa-0000-0000-000000000008/files/a607/out-of-x.txt.jpg'
  RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 0, 'and cannot overwrite what the other company''s file names');
-- A statement that names no row: the UPDATE policy alone decides (a WHERE on a column
-- brings the SELECT policy in as well). What it reached is read back below.
SELECT lives_ok($$ UPDATE storage.objects SET metadata = '{"size":77}'::jsonb $$, 'a blanket UPDATE by that admin is not refused');
SELECT pg_temp.t115_logout();
SELECT pg_temp.t115_login('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'user');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000008/files/a607/out-of-x.txt'), 1, 'CONTROL: the file''s own readers are not disturbed by that');
SELECT pg_temp.t115_logout();
SELECT is((SELECT metadata ->> 'size' FROM storage.objects WHERE bucket_id = 'rabbit-thumbnails' AND name = 'projects/11500000-aaaa-0000-0000-000000000008/files/a607/out-of-x.txt.jpg'), '1', 'the blanket UPDATE did not reach the picture the other company''s file names');
SELECT is((SELECT metadata ->> 'size' FROM storage.objects WHERE bucket_id = 'rabbit-files' AND name = 'projects/11500000-aaaa-0000-0000-000000000008/files/a607/out-of-x.txt'), '1', 'nor its copy');
SELECT is((SELECT metadata ->> 'size' FROM storage.objects WHERE bucket_id = 'rabbit-thumbnails' AND name = 'projects/11500000-aaaa-0000-0000-000000000008/files/a607/fresh-picture.jpg'), '77', 'CONTROL: it did reach what nothing names under the id that admin holds');

-- ── A purged moved copy: the queue claims it, then the certificate does.
SELECT pg_temp.t115_login('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'user');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a608/purged-moved.txt'), 1, 'CONTROL: before its purge, a copy moved into T reads, for a reader of T');
SELECT pg_temp.t115_logout();
DELETE FROM public.files WHERE id IN ('11500000-0000-0000-0000-00000000a608', '11500000-0000-0000-0000-00000000a609',
                                      '11500000-0000-0000-0000-00000000a610', '11500000-0000-0000-0000-00000000a611');
SELECT pg_temp.t115_login('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'user');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a608/purged-moved.txt'), 0, 'a purged moved copy, its queue row waiting: nobody reads it, though S still lives');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a608/purged-moved.txt.jpg'), 0, 'nor its picture');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a610/purged-here.txt'), 0, 'a file purged where it was made: nobody reads it while its queue row waits');
SELECT pg_temp.t115_logout();
SELECT pg_temp.t115_login('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'user');
SELECT throws_ok($$ INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
                    VALUES ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a611/carried-again.txt', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '{"size":1}'::jsonb) $$,
  '42501', 'new row violates row-level security policy for table "objects"', 'and its key cannot be written while the queue row waits');
SELECT pg_temp.t115_logout();
DELETE FROM public.storage_gc_queue WHERE file_id IN ('11500000-0000-0000-0000-00000000a608', '11500000-0000-0000-0000-00000000a609',
                                                      '11500000-0000-0000-0000-00000000a610', '11500000-0000-0000-0000-00000000a611');
SELECT pg_temp.t115_login('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'user');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a608/purged-moved.txt'), 0, 'its queue row gone, the certificate still claims it');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a608/purged-moved.txt.jpg'), 0, 'and its picture');
SELECT is(pg_temp.t115_sees('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a610/purged-here.txt'), 1, 'the drain done, a file purged where it was made is unclaimed: the old rule answers');
SELECT pg_temp.t115_logout();
SELECT pg_temp.t115_login('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'user');
SELECT throws_ok($$ INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
                    VALUES ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a609/purged-moved-gone.txt', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '{"size":1}'::jsonb) $$,
  '42501', 'new row violates row-level security policy for table "objects"', 'a writer of S cannot write at a purged moved key');
SELECT lives_ok($$ INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
                   VALUES ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a611/carried-again.txt', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '{"size":1}'::jsonb) $$,
  'but a key purged where it was made can be carried again once it is drained');

-- ── A queue row that names no file claims nothing (arm 2's file_id filter).
SELECT pg_temp.t115_logout();
INSERT INTO public.storage_gc_queue (bucket_id, object_path, workspace_id, file_id, reason, provider, kind, status) VALUES
  ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a633/orphan.txt.jpg', '11111111-1111-1111-1111-111111111111', NULL, 'orphan-scan', 'supabase', 'body', 'pending');
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata) VALUES
  ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a633/orphan.txt.jpg', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{"size":1}'::jsonb);
SELECT pg_temp.t115_login('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'user');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a633/orphan.txt.jpg'), 1, 'a queue row that names no file does not take a copy from its readers');
-- A bin's poster replaced, then restored to the older key while its queue row waits (SFB-02):
-- the row the real trigger writes (0091), and the poster still reads.
SELECT pg_temp.t115_logout();
INSERT INTO public.storage_gc_queue (bucket_id, object_path, workspace_id, file_id, reason, provider, kind, status) VALUES
  ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/bin_files/a631/poster.jpg', '11111111-1111-1111-1111-111111111111', NULL, 'file-purged', 'supabase', 'thumbnail', 'pending');
SELECT is(rabbit_private.storage_object_claimed('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/bin_files/a631/poster.jpg'), false, 'a replaced poster''s queue row does not claim it');
SELECT pg_temp.t115_login('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'user');
SELECT is(pg_temp.t115_sees('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/bin_files/a631/poster.jpg'), 1, 'and it reads as it did');

-- ── Writes. user_c writes S and not T. user_e writes T and not S.
SELECT pg_temp.t115_logout();
SELECT pg_temp.t115_login('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'user');
SELECT is(public.can_write_project('11500000-aaaa-0000-0000-000000000001'), true, 'CONTROL: user_c writes S');
SELECT is(public.can_write_project('11500000-aaaa-0000-0000-000000000002') IS TRUE, false, 'CONTROL: and not T');
SELECT lives_ok($$ INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
                   VALUES ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a640/fresh.txt', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '{"size":1}'::jsonb) $$,
  'a writer of S uploads to a fresh key under S');
SELECT lives_ok($$ INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
                   VALUES ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a640/fresh.txt.jpg', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '{"size":1}'::jsonb) $$,
  'and its picture');
SELECT throws_ok($$ INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
                    VALUES ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000002/files/a641/fresh.txt', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '{"size":1}'::jsonb) $$,
  '42501', 'new row violates row-level security policy for table "objects"', 'but not to a fresh key under T');
SELECT throws_ok($$ INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
                    VALUES ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000002/files/a641/fresh.txt.jpg', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '{"size":1}'::jsonb) $$,
  '42501', 'new row violates row-level security policy for table "objects"', 'nor its picture');
-- A file moved out of T into S: its picture is S's writers' to regenerate, under T's name.
SELECT lives_ok($$ INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
                   VALUES ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000002/files/a624/no-picture-yet.txt.jpg', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '{"size":1}'::jsonb) $$,
  'a writer of S makes the picture of a file moved into S, under its old project''s key');
WITH upd AS (
  UPDATE storage.objects SET metadata = '{"size":2}'::jsonb
   WHERE bucket_id = 'rabbit-thumbnails' AND name = 'projects/11500000-aaaa-0000-0000-000000000002/files/a623/out-of-t.txt.jpg'
  RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 1, 'and regenerates one that is there');
WITH upd AS (
  UPDATE storage.objects SET metadata = '{"size":2}'::jsonb
   WHERE bucket_id = 'rabbit-files' AND name = 'projects/11500000-aaaa-0000-0000-000000000002/files/a623/out-of-t.txt'
  RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 1, 'the same in the body bucket');
-- Out of a project hidden from this writer, into S: the key's own project does not decide.
WITH upd AS (
  UPDATE storage.objects SET metadata = '{"size":2}'::jsonb
   WHERE bucket_id = 'rabbit-thumbnails' AND name = 'projects/11500000-aaaa-0000-0000-000000000007/files/a603/from-private.txt.jpg'
  RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 1, 'a writer of S regenerates the picture of a file moved in from a project hidden from them');
WITH upd AS (
  UPDATE storage.objects SET metadata = '{"size":2}'::jsonb
   WHERE bucket_id = 'rabbit-files' AND name = 'projects/11500000-aaaa-0000-0000-000000000007/files/a603/from-private.txt'
  RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 1, 'the same in the body bucket');
SELECT lives_ok($$ INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
                   VALUES ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000007/files/a628/from-hidden.txt', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '{"size":1}'::jsonb) $$,
  'a writer of S makes the copy of a file moved in from a project hidden from them');
SELECT lives_ok($$ INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
                   VALUES ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000007/files/a628/from-hidden.txt.jpg', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '{"size":1}'::jsonb) $$,
  'and its picture');
-- A key nothing names: the rule it always had.
WITH upd AS (
  UPDATE storage.objects SET metadata = '{"size":2}'::jsonb
   WHERE bucket_id = 'rabbit-files' AND name = 'projects/11500000-aaaa-0000-0000-000000000001/files/a640/fresh.txt'
  RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 1, 'a writer of S updates a copy nothing names');
WITH upd AS (
  UPDATE storage.objects SET metadata = '{"size":2}'::jsonb
   WHERE bucket_id = 'rabbit-thumbnails' AND name = 'projects/11500000-aaaa-0000-0000-000000000001/files/a640/fresh.txt.jpg'
  RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 1, 'and a picture');
SELECT throws_ok($$ INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
                    VALUES ('rabbit-files', 'elsewhere/11500000-aaaa-0000-0000-000000000001/files/a644/outside.txt', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '{"size":1}'::jsonb) $$,
  '42501', 'new row violates row-level security policy for table "objects"', 'nobody uploads outside projects/');
SELECT throws_ok($$ INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
                    VALUES ('rabbit-thumbnails', 'elsewhere/11500000-aaaa-0000-0000-000000000001/files/a644/outside.txt.jpg', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '{"size":1}'::jsonb) $$,
  '42501', 'new row violates row-level security policy for table "objects"', 'nor a picture');
SELECT throws_ok($$ INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
                    VALUES ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000006/files/a644/binned.txt', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '{"size":1}'::jsonb) $$,
  '42501', 'new row violates row-level security policy for table "objects"', 'nor under a binned project');
SELECT throws_ok($$ INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
                    VALUES ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000006/files/a644/binned.txt.jpg', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '{"size":1}'::jsonb) $$,
  '42501', 'new row violates row-level security policy for table "objects"', 'nor a picture');
-- A rename onto a key under a project this writer cannot write: WITH CHECK refuses.
SELECT throws_ok($$ UPDATE storage.objects SET name = 'projects/11500000-aaaa-0000-0000-000000000002/files/a642/renamed.txt'
                     WHERE bucket_id = 'rabbit-files' AND name = 'projects/11500000-aaaa-0000-0000-000000000001/files/a601/plain.txt' $$,
  '42501', 'new row violates row-level security policy for table "objects"', 'a writer of S cannot rename a copy into T');
SELECT throws_ok($$ UPDATE storage.objects SET name = 'projects/11500000-aaaa-0000-0000-000000000002/files/a642/renamed.txt.jpg'
                     WHERE bucket_id = 'rabbit-thumbnails' AND name = 'projects/11500000-aaaa-0000-0000-000000000001/files/a601/plain.txt.jpg' $$,
  '42501', 'new row violates row-level security policy for table "objects"', 'nor a picture');
-- A rename onto a key a trashed file names, under a project they can write: the key's
-- prefix would have let it.
SELECT throws_ok($$ UPDATE storage.objects SET name = 'projects/11500000-aaaa-0000-0000-000000000001/files/a613/legacy-trashed.txt'
                     WHERE bucket_id = 'rabbit-files' AND name = 'projects/11500000-aaaa-0000-0000-000000000001/files/a640/fresh.txt' $$,
  '42501', 'new row violates row-level security policy for table "objects"', 'and cannot rename a copy onto a key a trashed file names');
WITH upd AS (
  UPDATE storage.objects SET metadata = '{"size":2}'::jsonb
   WHERE bucket_id = 'rabbit-files' AND name = 'projects/11500000-aaaa-0000-0000-000000000001/files/a604/trashed.txt'
  RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 0, 'a writer of S cannot touch a trashed file''s copy');
WITH upd AS (
  UPDATE storage.objects SET metadata = '{"size":2}'::jsonb
   WHERE bucket_id = 'rabbit-thumbnails' AND name = 'projects/11500000-aaaa-0000-0000-000000000001/files/a604/trashed.txt.jpg'
  RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 0, 'nor its picture');
SELECT pg_temp.t115_logout();
SELECT pg_temp.t115_login('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'user');
SELECT is(public.can_write_project('11500000-aaaa-0000-0000-000000000002'), true, 'CONTROL: user_e writes T');
SELECT is(public.can_write_project('11500000-aaaa-0000-0000-000000000001') IS TRUE, false, 'CONTROL: and not S');
SELECT lives_ok($$ INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
                   VALUES ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000002/files/a643/fresh.txt', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '{"size":1}'::jsonb) $$,
  'CONTROL: a writer of T uploads to a fresh key under T');
WITH upd AS (
  UPDATE storage.objects SET metadata = '{"size":3}'::jsonb
   WHERE bucket_id = 'rabbit-thumbnails' AND name = 'projects/11500000-aaaa-0000-0000-000000000002/files/a623/out-of-t.txt.jpg'
  RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 0, 'a writer of the old project cannot regenerate the picture of a file moved out of it');
WITH upd AS (
  UPDATE storage.objects SET metadata = '{"size":3}'::jsonb
   WHERE bucket_id = 'rabbit-files' AND name = 'projects/11500000-aaaa-0000-0000-000000000002/files/a623/out-of-t.txt'
  RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 0, 'nor change its copy');
SELECT throws_ok($$ INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
                    VALUES ('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000002/files/a624/no-picture-yet.txt', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '{"size":1}'::jsonb) $$,
  '42501', 'new row violates row-level security policy for table "objects"', 'nor write a copy at its key, which names their project');
SELECT pg_temp.t115_logout();

-- ── A statement that names no row: the UPDATE policy alone decides.
SELECT pg_temp.t115_login('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'user');
SELECT lives_ok($$ UPDATE storage.objects SET metadata = '{"size":88}'::jsonb $$, 'a blanket UPDATE by a writer of S is not refused');
SELECT pg_temp.t115_logout();
SELECT is((SELECT array_agg(k ORDER BY k) FROM unnest(ARRAY[
    'rabbit-files projects/11500000-aaaa-0000-0000-000000000001/files/a604/trashed.txt',
    'rabbit-thumbnails projects/11500000-aaaa-0000-0000-000000000001/files/a604/trashed.txt.jpg',
    'rabbit-files projects/11500000-aaaa-0000-0000-000000000001/files/a605/receipt.pdf',
    'rabbit-thumbnails projects/11500000-aaaa-0000-0000-000000000001/files/a605/receipt.pdf.jpg',
    'rabbit-thumbnails projects/11500000-aaaa-0000-0000-000000000001/files/a613/old-picture.jpg',
    'rabbit-thumbnails projects/11500000-aaaa-0000-0000-000000000001/files/a614/old-picture.jpg',
    'rabbit-files projects/11500000-aaaa-0000-0000-000000000001/FINANCE/RATES.json',
    'rabbit-files projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a627/invoice.pdf',
    'rabbit-thumbnails projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a627/invoice.pdf.jpg',
    'rabbit-thumbnails projects/11500000-aaaa-0000-0000-000000000001/INVOICES/a649/unnamed.pdf.jpg',
    'rabbit-thumbnails projects/11500000-bbbb-0000-0000-000000000001/files/a606/theirs.txt.jpg',
    'rabbit-files projects/11500000-bbbb-0000-0000-000000000001/files/a606/theirs.txt',
    'rabbit-thumbnails projects/11500000-bbbb-0000-0000-000000000001/files/a653/unnamed.jpg',
    'rabbit-thumbnails projects/11500000-aaaa-0000-0000-000000000007/files/a652/hidden.txt.jpg',
    'rabbit-files projects/11500000-aaaa-0000-0000-000000000002/files/a643/fresh.txt',
    'rabbit-files elsewhere/11500000-aaaa-0000-0000-000000000001/files/a639/outside.txt',
    'rabbit-thumbnails elsewhere/11500000-aaaa-0000-0000-000000000001/files/a639/outside.txt.jpg',
    'rabbit-files projects/11500000-aaaa-0000-0000-000000000006/files/a635/binned.txt'
  ]) AS k
   JOIN storage.objects o ON o.bucket_id || ' ' || o.name = k
  WHERE o.metadata ->> 'size' = '88'), NULL::text[],
  'it reached nothing trashed, flagged, money, hidden, binned, outside, another project''s or another company''s');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY[
    'rabbit-files projects/11500000-aaaa-0000-0000-000000000001/files/a601/plain.txt',
    'rabbit-thumbnails projects/11500000-aaaa-0000-0000-000000000001/files/a601/plain.txt.jpg',
    'rabbit-files projects/11500000-aaaa-0000-0000-000000000002/files/a623/out-of-t.txt',
    'rabbit-thumbnails projects/11500000-aaaa-0000-0000-000000000002/files/a623/out-of-t.txt.jpg',
    'rabbit-files projects/11500000-aaaa-0000-0000-000000000007/files/a603/from-private.txt',
    'rabbit-files projects/11500000-aaaa-0000-0000-000000000001/PROJECT.json',
    'rabbit-files projects/11500000-aaaa-0000-0000-000000000001/files/a633/orphan.txt'
  ]) AS k
   JOIN storage.objects o ON o.bucket_id || ' ' || o.name = k
  WHERE o.metadata ->> 'size' = '88'), 7,
  'CONTROL: it reached the ordinary files, the ones moved into S, a manifest and a copy nothing names');

-- ── An uploader's clean-up. A real DELETE: storage.protect_delete() lets the statement through
-- under the Storage API's own setting, so the policy decides (suite 94's reasoning).
SELECT pg_temp.t115_login('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'user');
SELECT set_config('storage.allow_delete_query', 'true', true);
WITH del AS (DELETE FROM storage.objects WHERE bucket_id = 'rabbit-files' AND name = 'projects/11500000-aaaa-0000-0000-000000000001/files/a625/own-named.txt' RETURNING 1)
SELECT is((SELECT count(*)::int FROM del), 0, 'an uploader cannot remove their own copy once a row names it, within the hour');
WITH del AS (DELETE FROM storage.objects WHERE bucket_id = 'rabbit-files' AND name = 'projects/11500000-aaaa-0000-0000-000000000001/files/a637/own-unnamed.txt' RETURNING 1)
SELECT is((SELECT count(*)::int FROM del), 1, 'CONTROL: an upload nothing names, they can');
WITH del AS (DELETE FROM storage.objects WHERE bucket_id = 'rabbit-files' AND name = 'projects/11500000-aaaa-0000-0000-000000000001/files/a638/own-old.txt' RETURNING 1)
SELECT is((SELECT count(*)::int FROM del), 0, 'but not after the hour');
WITH del AS (DELETE FROM storage.objects WHERE bucket_id = 'rabbit-files' AND name = 'projects/11500000-aaaa-0000-0000-000000000001/files/a633/orphan.txt' RETURNING 1)
SELECT is((SELECT count(*)::int FROM del), 0, 'and not someone else''s');
WITH del AS (DELETE FROM storage.objects WHERE bucket_id = 'rabbit-thumbnails' AND name = 'projects/11500000-aaaa-0000-0000-000000000001/files/a625/own-named.txt.jpg' RETURNING 1)
SELECT is((SELECT count(*)::int FROM del), 1, 'a picture they uploaded goes, though its row names it: moveReceipt removes one it could not move');
WITH del AS (DELETE FROM storage.objects WHERE bucket_id = 'rabbit-thumbnails' AND name = 'projects/11500000-aaaa-0000-0000-000000000001/files/a626/own-trashed.txt.jpg' RETURNING 1)
SELECT is((SELECT count(*)::int FROM del), 0, 'not the picture of a trashed row');
WITH del AS (DELETE FROM storage.objects WHERE bucket_id = 'rabbit-thumbnails' AND name = 'projects/11500000-aaaa-0000-0000-000000000001/files/a637/own-unnamed.txt.jpg' RETURNING 1)
SELECT is((SELECT count(*)::int FROM del), 1, 'CONTROL: and a picture nothing names goes too');
WITH del AS (DELETE FROM storage.objects WHERE bucket_id = 'rabbit-thumbnails' AND name = 'projects/11500000-aaaa-0000-0000-000000000001/files/a638/own-old.txt.jpg' RETURNING 1)
SELECT is((SELECT count(*)::int FROM del), 0, 'but not after the hour');
WITH del AS (DELETE FROM storage.objects WHERE bucket_id = 'rabbit-thumbnails' AND name = 'projects/11500000-aaaa-0000-0000-000000000001/files/a633/orphan.txt.jpg' RETURNING 1)
SELECT is((SELECT count(*)::int FROM del), 0, 'and not someone else''s');
WITH del AS (DELETE FROM storage.objects WHERE bucket_id = 'rabbit-thumbnails' AND name = 'projects/11500000-aaaa-0000-0000-000000000007/files/a628/from-hidden.txt.jpg' RETURNING 1)
SELECT is((SELECT count(*)::int FROM del), 1, 'the picture they made of a file moved in from a project hidden from them goes');
SELECT set_config('storage.allow_delete_query', 'false', true);
SELECT pg_temp.t115_logout();
-- user_e reads S and does not write it; they write T, and a file moved out of T is not theirs.
SELECT pg_temp.t115_login('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'user');
SELECT set_config('storage.allow_delete_query', 'true', true);
WITH del AS (DELETE FROM storage.objects WHERE bucket_id = 'rabbit-files' AND name = 'projects/11500000-aaaa-0000-0000-000000000001/files/a645/e-own.txt' RETURNING 1)
SELECT is((SELECT count(*)::int FROM del), 0, 'someone who no longer writes the project cannot remove even an upload nothing names');
WITH del AS (DELETE FROM storage.objects WHERE bucket_id = 'rabbit-thumbnails' AND name = 'projects/11500000-aaaa-0000-0000-000000000001/files/a645/e-own.txt.jpg' RETURNING 1)
SELECT is((SELECT count(*)::int FROM del), 0, 'nor a picture');
WITH del AS (DELETE FROM storage.objects WHERE bucket_id = 'rabbit-thumbnails' AND name = 'projects/11500000-aaaa-0000-0000-000000000002/files/a646/out-of-t-2.txt.jpg' RETURNING 1)
SELECT is((SELECT count(*)::int FROM del), 0, 'a writer of the old project cannot remove the picture of a file moved out of it, though they uploaded it');
SELECT set_config('storage.allow_delete_query', 'false', true);
SELECT pg_temp.t115_logout();
-- A statement that names no row: the DELETE policy alone decides.
SELECT pg_temp.t115_login('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'user');
SELECT set_config('storage.allow_delete_query', 'true', true);
SELECT lives_ok($$ DELETE FROM storage.objects $$, 'a blanket DELETE by a writer of S is not refused');
SELECT set_config('storage.allow_delete_query', 'false', true);
SELECT pg_temp.t115_logout();
SELECT is((SELECT count(*)::int FROM unnest(ARRAY[
    'rabbit-files projects/11500000-aaaa-0000-0000-000000000001/files/a625/own-named.txt',
    'rabbit-thumbnails projects/11500000-aaaa-0000-0000-000000000001/files/a626/own-trashed.txt.jpg',
    'rabbit-files projects/11500000-aaaa-0000-0000-000000000001/files/a638/own-old.txt',
    'rabbit-thumbnails projects/11500000-aaaa-0000-0000-000000000001/files/a638/own-old.txt.jpg',
    'rabbit-files projects/11500000-aaaa-0000-0000-000000000001/files/a633/orphan.txt',
    'rabbit-thumbnails projects/11500000-aaaa-0000-0000-000000000001/files/a633/orphan.txt.jpg',
    'rabbit-files projects/11500000-aaaa-0000-0000-000000000001/files/a601/plain.txt',
    'rabbit-files projects/11500000-aaaa-0000-0000-000000000002/files/a643/fresh.txt',
    'rabbit-files elsewhere/11500000-aaaa-0000-0000-000000000001/files/a648/own-outside.txt',
    'rabbit-thumbnails elsewhere/11500000-aaaa-0000-0000-000000000001/files/a648/own-outside.txt.jpg'
  ]) AS k
   JOIN storage.objects o ON o.bucket_id || ' ' || o.name = k), 10,
  'it removed no named copy, no trashed row''s picture, nothing past the hour, nothing outside projects/ and nothing of anyone else''s');
SELECT is((SELECT count(*)::int FROM storage.objects o
            WHERE (o.bucket_id, o.name) IN (('rabbit-files', 'projects/11500000-aaaa-0000-0000-000000000001/files/a640/fresh.txt'),
                                            ('rabbit-thumbnails', 'projects/11500000-aaaa-0000-0000-000000000001/files/a640/fresh.txt.jpg'))), 0,
  'CONTROL: it removed their own uploads nothing names');

-- ── The policies' text. The probes above read what they do; these read what they are.
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'rabbit\_files%'), 8, 'eight rabbit_files policies');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'rabbit\_thumbnails%'), 8, 'eight rabbit_thumbnails policies');
SELECT is((SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
            WHERE schemaname = 'storage' AND tablename = 'objects'
              AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%rabbit_private.storage_object_claimed%'
              AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%rabbit_private.storage_object_current_project%'),
  ARRAY['rabbit_files_delete_own', 'rabbit_files_insert', 'rabbit_files_select', 'rabbit_files_update',
        'rabbit_thumbnails_delete_own', 'rabbit_thumbnails_insert', 'rabbit_thumbnails_select', 'rabbit_thumbnails_update'],
  'the eight base policies, and no others, ask who answers for a copy');
SELECT is((SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
            WHERE schemaname = 'storage' AND tablename = 'objects'
              AND COALESCE(qual, '') LIKE '%NOT rabbit_private.storage_object_claimed(%'),
  ARRAY['rabbit_files_delete_own'],
  'only the body''s clean-up policy says NOT claimed');
SELECT is((SELECT count(*)::int FROM pg_policies
            WHERE schemaname = 'storage' AND tablename = 'objects'
              AND policyname IN ('rabbit_files_update', 'rabbit_thumbnails_update')
              AND qual LIKE '%rabbit_private.storage_object_current_project%'
              AND with_check LIKE '%rabbit_private.storage_object_current_project%'), 2,
  'both UPDATE policies judge both arms');
SELECT is((SELECT count(*)::int FROM pg_policies
            WHERE schemaname = 'storage' AND tablename = 'objects'
              AND policyname ~ '^rabbit_(files|thumbnails)_'
              AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%rabbit_money_segment((storage.foldername(name))[3])%'), 16,
  'all sixteen read the money segment');
SELECT is((SELECT array_agg(policyname || ' ' || md5(COALESCE(qual, '') || '|' || COALESCE(with_check, '')) ORDER BY policyname) FROM pg_policies
            WHERE schemaname = 'storage' AND tablename = 'objects'
              AND (policyname LIKE 'rabbit\_%\_money\_%' OR policyname LIKE 'petal\_%')),
  ARRAY['petal_bin_posters_delete_own df3b7e08dae664725c1eea676eae952e',
        'petal_bin_posters_insert be9f43c1c87bde7804826b8a0ec27da5',
        'petal_bin_posters_remote_viewing_insert 5c2903256ac409cfbddbda71e66231b2',
        'petal_bin_posters_remote_viewing_update 96a5f9c25a053395687e01b84953a0fc',
        'petal_bin_posters_update 4d66609119c6606e283b02890bfde3f9',
        'petal_storage_quota_insert b08a99323953283cd0545520859d6367',
        'rabbit_files_money_delete 2c70d5bc96bb3d74c43ce6a0e34bb24b',
        'rabbit_files_money_insert 72b98b2cf371ee0df286fef30d8d5686',
        'rabbit_files_money_select f11d87becc48841dafc2303baeb84f3a',
        'rabbit_files_money_update c41f98d184eb460e37cd4af118b9752a',
        'rabbit_thumbnails_money_delete d6cc2a54f9452f07f46f5844c532ef18',
        'rabbit_thumbnails_money_insert df7cff8a1541b983d8bd331cda474f82',
        'rabbit_thumbnails_money_select 78366b8dd04a4de12794c2f46da6f8cc',
        'rabbit_thumbnails_money_update a63468e65f7f5539ff6ca25160721fe7'],
  'the money, bin-poster and quota policies have the text they had');

SELECT * FROM finish();
ROLLBACK;
