-- =============================================================================
-- 114_file_moves.sql — migration 0113, the move journal and the same-project keys
-- (M.O.T.H. Session 1; docs/design/MOTH_DESIGN.md §1.4 "0113", §1.11, §2.3 MV-5).
--
-- What this pins:
--   * The journal is closed: RLS forced, no policies, and every read and write
--     refused to a client; anon holds nothing. The audit trigger stamps the
--     caller.
--   * fn_checked_move_admits admits one thing only: the row the marker names,
--     written in this transaction, by this person, with an item matching all
--     five values. Every other combination is false, and false is never NULL.
--   * The same-project keys bind every writer, the runner included: a folder
--     parented across projects and a file filed in another project's folder are
--     refused by the foreign key, and a folder's delete still clears only
--     folder_id. (A client meets 0107's guard first; suite 05 and 52 pin that side.)
--   * fn_moth_body_provider_for and the purge.
--
-- Fixture ids are hex: projects aaaa1111-…-000000001141 and 42, folders
-- 11400000-…-0000000000fx, files 11400000-…-0000000001xx, journal rows
-- 11400000-…-0000000002xx. user_a (rls_setup) is the admin; user_c a plain user.
-- =============================================================================

BEGIN;

SELECT plan(44);

SELECT * FROM tests.rls_setup();

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local', crypt('testpw', gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.projects (id, workspace_id, title, created_by) VALUES
  ('aaaa1111-0000-0000-0000-000000001141', '11111111-1111-1111-1111-111111111111', 'Moves A', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('aaaa1111-0000-0000-0000-000000001142', '11111111-1111-1111-1111-111111111111', 'Moves B', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('11400000-0000-0000-0000-0000000000f0', 'aaaa1111-0000-0000-0000-000000001141', NULL, 'root', 'moves-a', ''),
  ('11400000-0000-0000-0000-0000000000f1', 'aaaa1111-0000-0000-0000-000000001141', '11400000-0000-0000-0000-0000000000f0', 'custom', 'A1', 'A1'),
  ('11400000-0000-0000-0000-0000000000f2', 'aaaa1111-0000-0000-0000-000000001141', '11400000-0000-0000-0000-0000000000f1', 'custom', 'A2', 'A1/A2'),
  ('11400000-0000-0000-0000-0000000000f8', 'aaaa1111-0000-0000-0000-000000001142', NULL, 'root', 'moves-b', ''),
  ('11400000-0000-0000-0000-0000000000f9', 'aaaa1111-0000-0000-0000-000000001142', '11400000-0000-0000-0000-0000000000f8', 'custom', 'B1', 'B1');

INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, folder_id) VALUES
  ('11400000-0000-0000-0000-000000000101', 'aaaa1111-0000-0000-0000-000000001141', 'a.txt', 'supabase',
   'projects/aaaa1111-0000-0000-0000-000000001141/files/101/a.txt', '11400000-0000-0000-0000-0000000000f2');


-- ── 1-5: the objects ─────────────────────────────────────────────────────────
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.file_moves'::regclass),
  'file_moves has row level security on and forced');
SELECT is((SELECT count(*)::int FROM pg_policy WHERE polrelid = 'public.file_moves'::regclass), 0,
  'file_moves has no policies');
SELECT ok(NOT has_table_privilege('anon', 'public.file_moves', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'anon holds no privilege on file_moves');
SELECT ok(NOT has_table_privilege('authenticated', 'public.file_moves', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'authenticated holds no privilege on file_moves');
SELECT ok(NOT has_function_privilege('authenticated', 'public.fn_checked_move_admits(uuid,uuid,uuid,text,text)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.fn_checked_move_admits(uuid,uuid,uuid,text,text)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.fn_moth_body_provider_for(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.fn_moth_body_provider_for(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.purge_file_moves(interval)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.purge_file_moves(interval)', 'EXECUTE'),
  'no client may call the admission, the provider helper or the purge');


-- ── 6-9: the keys, by catalogue ──────────────────────────────────────────────
SELECT is((SELECT count(*)::int FROM pg_constraint
            WHERE conrelid = 'public.folders'::regclass AND contype = 'u' AND conname = 'folders_id_project_key'), 1,
  'folders has UNIQUE (id, project_id)');
SELECT is((SELECT count(*)::int FROM pg_constraint c
             JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
            WHERE c.conrelid = 'public.folders'::regclass AND c.contype = 'f' AND a.attname = 'parent_id'), 1,
  'exactly one foreign key on folders.parent_id');
SELECT is((SELECT count(*)::int FROM pg_constraint c
             JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
            WHERE c.conrelid = 'public.files'::regclass AND c.contype = 'f' AND a.attname = 'folder_id'), 1,
  'exactly one foreign key on files.folder_id');
SELECT is((SELECT confdelsetcols::text FROM pg_constraint
            WHERE conrelid = 'public.files'::regclass AND conname = 'files_folder_same_project_fk'),
  (SELECT ARRAY[attnum]::text FROM pg_attribute WHERE attrelid = 'public.files'::regclass AND attname = 'folder_id'),
  'a folder''s delete clears folder_id and only folder_id');


-- ── 10-14: the keys bind the runner, who passes every guard ─────────────────
SELECT throws_ok($$
  INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path)
  VALUES ('11400000-0000-0000-0000-0000000000fa', 'aaaa1111-0000-0000-0000-000000001142',
          '11400000-0000-0000-0000-0000000000f1', 'custom', 'x', 'B1/x')
$$, '23503', NULL, 'a folder parented across projects is refused, even for the runner');
SELECT throws_ok($$
  UPDATE public.folders SET parent_id = '11400000-0000-0000-0000-0000000000f1' WHERE id = '11400000-0000-0000-0000-0000000000f9'
$$, '23503', NULL, 'and so is a re-parent across projects');
SELECT throws_ok($$
  INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, folder_id)
  VALUES ('11400000-0000-0000-0000-000000000102', 'aaaa1111-0000-0000-0000-000000001142', 'x', 'supabase',
          'projects/aaaa1111-0000-0000-0000-000000001142/files/102/x', '11400000-0000-0000-0000-0000000000f1')
$$, '23503', NULL, 'a file filed in another project''s folder is refused');
SELECT throws_ok($$
  UPDATE public.files SET project_id = 'aaaa1111-0000-0000-0000-000000001142' WHERE id = '11400000-0000-0000-0000-000000000101'
$$, '23503', NULL, 'and a file cannot leave its folder''s project with the folder still set');
SELECT throws_ok($$
  UPDATE public.folders SET project_id = 'aaaa1111-0000-0000-0000-000000001142' WHERE id = '11400000-0000-0000-0000-0000000000f2'
$$, '23503', NULL, 'nor can a folder with a parent in its project change project');

-- 15-16: a delete still works as it did: a child folder goes, a file stays.
DELETE FROM public.folders WHERE id = '11400000-0000-0000-0000-0000000000f1';
SELECT is((SELECT count(*)::int FROM public.folders WHERE id = '11400000-0000-0000-0000-0000000000f2'), 0,
  'deleting a folder still takes its children');
SELECT is((SELECT folder_id IS NULL AND project_id = 'aaaa1111-0000-0000-0000-000000001141' FROM public.files WHERE id = '11400000-0000-0000-0000-000000000101'), true,
  'and clears the file''s folder_id, keeping its project');


-- ── 17-19: the provider helper ───────────────────────────────────────────────
SELECT is(public.fn_moth_body_provider_for('11111111-1111-1111-1111-111111111111'), 'supabase',
  'a company with no storage row keeps its bodies with Supabase');
INSERT INTO public.workspace_storage (workspace_id, provider, mode, root_path, root_kind)
VALUES ('11111111-1111-1111-1111-111111111111', 'network', 'byos', repeat(chr(92), 2) || 'server' || chr(92) || 'share', 'unc')
ON CONFLICT (workspace_id) DO UPDATE SET provider = 'network', mode = 'byos', root_path = EXCLUDED.root_path, root_kind = 'unc', provider_config = NULL;
SELECT is(public.fn_moth_body_provider_for('11111111-1111-1111-1111-111111111111'), 'network_share',
  'an office-server company''s new bodies go to the share');
UPDATE public.workspace_storage
   SET provider = 's3', root_path = NULL, root_kind = NULL,
       provider_config = '{"bucket":"b","region":"r","accessKeyId":"k"}'::jsonb
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
SELECT is(public.fn_moth_body_provider_for('11111111-1111-1111-1111-111111111111'), 's3',
  'an s3 company''s new bodies go to s3');


-- ── 20-22: the audit trigger and the shape, as the runner with user_c's claims ─
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);

INSERT INTO public.file_moves (id, workspace_id, items) VALUES
  ('11400000-0000-0000-0000-000000000201', '11111111-1111-1111-1111-111111111111',
   jsonb_build_array(
     jsonb_build_object('id', '11400000-0000-0000-0000-000000000101', 'how', 'metadata',
                        'to_project', 'aaaa1111-0000-0000-0000-000000001142',
                        'to_folder', '11400000-0000-0000-0000-0000000000f9',
                        'to_provider', 'supabase', 'to_path', 'projects/b/files/101/a.txt'),
     jsonb_build_object('id', '11400000-0000-0000-0000-000000000103', 'how', 'metadata',
                        'to_project', 'aaaa1111-0000-0000-0000-000000001142',
                        'to_folder', NULL,
                        'to_provider', 'supabase', 'to_path', 'projects/b/files/103/c.txt')));

SELECT is((SELECT created_by::text FROM public.file_moves WHERE id = '11400000-0000-0000-0000-000000000201'),
  'cccccccc-cccc-cccc-cccc-cccccccccccc', 'the audit trigger stamps the caller');
SELECT is((SELECT actor_user_id::text FROM public.file_moves WHERE id = '11400000-0000-0000-0000-000000000201'),
  'cccccccc-cccc-cccc-cccc-cccccccccccc', 'the actor defaults to the caller');
SELECT is((SELECT txid FROM public.file_moves WHERE id = '11400000-0000-0000-0000-000000000201'),
  txid_current(), 'the txid defaults to this transaction');


-- ── 23-34: the admission ─────────────────────────────────────────────────────
SELECT set_config('wilson.file_move', '', true);
SELECT is(public.fn_checked_move_admits('11400000-0000-0000-0000-000000000101', 'aaaa1111-0000-0000-0000-000000001142',
          '11400000-0000-0000-0000-0000000000f9', 'supabase', 'projects/b/files/101/a.txt'), false,
  'no marker: false, even for an item that matches');
SELECT set_config('wilson.file_move', '11400000-0000-0000-0000-000000000299', true);
SELECT is(public.fn_checked_move_admits('11400000-0000-0000-0000-000000000101', 'aaaa1111-0000-0000-0000-000000001142',
          '11400000-0000-0000-0000-0000000000f9', 'supabase', 'projects/b/files/101/a.txt'), false,
  'a marker naming no row: false');

SELECT set_config('wilson.file_move', '11400000-0000-0000-0000-000000000201', true);
SELECT is(public.fn_checked_move_admits('11400000-0000-0000-0000-000000000101', 'aaaa1111-0000-0000-0000-000000001142',
          '11400000-0000-0000-0000-0000000000f9', 'supabase', 'projects/b/files/101/a.txt'), true,
  'the marker, this transaction, this person, all five values: true');
SELECT is(public.fn_checked_move_admits('11400000-0000-0000-0000-000000000103', 'aaaa1111-0000-0000-0000-000000001142',
          NULL, 'supabase', 'projects/b/files/103/c.txt'), true,
  'an item with no folder matches a NULL folder');
SELECT is(public.fn_checked_move_admits('11400000-0000-0000-0000-000000000103', 'aaaa1111-0000-0000-0000-000000001142',
          '11400000-0000-0000-0000-0000000000f9', 'supabase', 'projects/b/files/103/c.txt'), false,
  'but not a folder it does not name');
SELECT is(public.fn_checked_move_admits('11400000-0000-0000-0000-000000000101', 'aaaa1111-0000-0000-0000-000000001142',
          NULL, 'supabase', 'projects/b/files/101/a.txt'), false,
  'and a NULL folder does not stand for any folder');
SELECT is(public.fn_checked_move_admits('11400000-0000-0000-0000-000000000199', 'aaaa1111-0000-0000-0000-000000001142',
          '11400000-0000-0000-0000-0000000000f9', 'supabase', 'projects/b/files/101/a.txt'), false,
  'another file: false');
SELECT is(public.fn_checked_move_admits('11400000-0000-0000-0000-000000000101', 'aaaa1111-0000-0000-0000-000000001141',
          '11400000-0000-0000-0000-0000000000f9', 'supabase', 'projects/b/files/101/a.txt'), false,
  'another project: false');
SELECT is(public.fn_checked_move_admits('11400000-0000-0000-0000-000000000101', 'aaaa1111-0000-0000-0000-000000001142',
          '11400000-0000-0000-0000-0000000000f9', 's3', 'projects/b/files/101/a.txt'), false,
  'another provider: false');
SELECT is(public.fn_checked_move_admits('11400000-0000-0000-0000-000000000101', 'aaaa1111-0000-0000-0000-000000001142',
          '11400000-0000-0000-0000-0000000000f9', 'supabase', 'projects/b/files/101/other.txt'), false,
  'another path: false');
SELECT is(public.fn_checked_move_admits('11400000-0000-0000-0000-000000000101', 'aaaa1111-0000-0000-0000-000000001142',
          '11400000-0000-0000-0000-0000000000f9', 'supabase', 'projects/b/files/103/c.txt'), false,
  'values taken from two different items: false');

-- Another person holding the marker.
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SELECT is(public.fn_checked_move_admits('11400000-0000-0000-0000-000000000101', 'aaaa1111-0000-0000-0000-000000001142',
          '11400000-0000-0000-0000-0000000000f9', 'supabase', 'projects/b/files/101/a.txt'), false,
  'another person: false, admins included');

-- ── 35-36: another transaction's row, and no signed-in person ────────────────
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
UPDATE public.file_moves SET txid = txid - 1 WHERE id = '11400000-0000-0000-0000-000000000201';
SELECT is(public.fn_checked_move_admits('11400000-0000-0000-0000-000000000101', 'aaaa1111-0000-0000-0000-000000001142',
          '11400000-0000-0000-0000-0000000000f9', 'supabase', 'projects/b/files/101/a.txt'), false,
  'a row from another transaction: false');
UPDATE public.file_moves SET txid = txid_current() WHERE id = '11400000-0000-0000-0000-000000000201';
SELECT set_config('request.jwt.claims', '{}', true);
SELECT is(public.fn_checked_move_admits('11400000-0000-0000-0000-000000000101', 'aaaa1111-0000-0000-0000-000000001142',
          '11400000-0000-0000-0000-0000000000f9', 'supabase', 'projects/b/files/101/a.txt'), false,
  'no signed-in person: false, never NULL');


-- ── 37-40: every write and read refused to a client ──────────────────────────
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT * FROM public.file_moves $$, '42501', NULL, 'an admin may not read the journal');
SELECT throws_ok($$ INSERT INTO public.file_moves (workspace_id, items) VALUES ('11111111-1111-1111-1111-111111111111', '[{}]') $$,
  '42501', NULL, 'an admin may not write it');
SELECT throws_ok($$ UPDATE public.file_moves SET undone_at = now() $$, '42501', NULL, 'nor change it');
SELECT throws_ok($$ DELETE FROM public.file_moves $$, '42501', NULL, 'nor delete from it');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);


-- ── 41-43: the shape and the purge ───────────────────────────────────────────
SELECT throws_ok($$ INSERT INTO public.file_moves (workspace_id, actor_user_id, items)
                    VALUES ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '[]') $$,
  '23514', NULL, 'an empty journal row is refused');
SELECT throws_ok($$ SELECT public.purge_file_moves(interval '1 hour') $$, 'P0001', NULL,
  'the purge refuses a retention under a day');
UPDATE public.file_moves SET created_at = now() - interval '31 days' WHERE id = '11400000-0000-0000-0000-000000000201';
INSERT INTO public.file_moves (id, workspace_id, actor_user_id, items) VALUES
  ('11400000-0000-0000-0000-000000000202', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '[{"id":"x"}]');
SELECT is(public.purge_file_moves(), 1, 'the purge deletes what is past 30 days and keeps the rest');

-- 44: the purge's job, where this stack has pg_cron (CI's db-only stack may not).
SELECT ok(
  to_regclass('cron.job') IS NULL
  OR (SELECT count(*) = 1 FROM cron.job WHERE jobname = 'wilson-purge-file-moves' AND schedule = '41 4 * * *'),
  'the purge is scheduled at 04:41 where pg_cron is present');

SELECT * FROM finish();
ROLLBACK;
