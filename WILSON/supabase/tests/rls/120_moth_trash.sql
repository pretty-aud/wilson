-- =============================================================================
-- 120_moth_trash.sql — M.O.T.H. Session 1 (MO1), Moth's trash (0118).
--
-- moth_trash_files, moth_restore_files and moth_trash_index: one exclusion before any row
-- is touched, fn_trash_authz unchanged, office-server rows through their own calls, and a
-- view with no locators. Table-less.
--
-- user_a (rls_setup) is the admin; user_c a plain member; user_d a workspace manager; user_v
-- a reviewer; user_n is not active any more.
-- =============================================================================

BEGIN;

SELECT plan(75);

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
    ('abababab-abab-abab-abab-abababababab'::uuid, 'user_v@test.local'),
    ('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, 'user_n@test.local')) u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager', 'user_d', 'User D', true),
  ('11111111-1111-1111-1111-111111111111', 'abababab-abab-abab-abab-abababababab', 'user', 'user_v', 'User V', true),
  ('11111111-1111-1111-1111-111111111111', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'user', 'user_n', 'User N', false)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

CREATE FUNCTION public.t120_as(p_user uuid, p_role text, p_ws uuid DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_role))::text, true);
END;
$f$;
CREATE FUNCTION public.t120_a() RETURNS void LANGUAGE sql AS $f$ SELECT public.t120_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin') $f$;
CREATE FUNCTION public.t120_c() RETURNS void LANGUAGE sql AS $f$ SELECT public.t120_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user') $f$;
CREATE FUNCTION public.t120_d() RETURNS void LANGUAGE sql AS $f$ SELECT public.t120_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager') $f$;
CREATE FUNCTION public.t120_v() RETURNS void LANGUAGE sql AS $f$ SELECT public.t120_as('abababab-abab-abab-abab-abababababab', 'user') $f$;

CREATE FUNCTION public.t120_file(p_id uuid, p_project uuid, p_name text, p_folder uuid DEFAULT NULL)
RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, folder_id)
  VALUES (p_id, p_project, p_name, 'supabase', 'projects/' || p_project || '/files/' || p_id || '/' || p_name, p_folder);
$f$;
CREATE FUNCTION public.t120_seen(p_id uuid) RETURNS boolean LANGUAGE sql AS $f$
  SELECT EXISTS (SELECT 1 FROM public.moth_trash_index(500) x WHERE x.id = p_id);
$f$;
CREATE TEMP TABLE t120_ret (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON t120_ret TO authenticated;

SELECT public.t120_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1200-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Salt Hours', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1200-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Goes to the bin', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1200-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'Staffed without C', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1200-0000-0000-0000-0000000000c0', '11111111-1111-1111-1111-111111111111', 'Personal space', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true, 'cccccccc-cccc-cccc-cccc-cccccccccccc');
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1200-0000-0000-0000-00000000000a', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1200-0000-0000-0000-00000000000a', 'abababab-abab-abab-abab-abababababab', '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1200-0000-0000-0000-00000000000b', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1200-0000-0000-0000-00000000000d', 'abababab-abab-abab-abab-abababababab', '11111111-1111-1111-1111-111111111111', 'manager')
ON CONFLICT DO NOTHING;
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('12000000-0000-0000-0000-0000000000f0', 'aaaa1200-0000-0000-0000-00000000000a', NULL, 'root', 'salt', ''),
  ('12000000-0000-0000-0000-0000000000f3', 'aaaa1200-0000-0000-0000-00000000000a', '12000000-0000-0000-0000-0000000000f0', 'category', 'invoices', 'INVOICES');

SELECT public.t120_file('12000000-0000-0000-0000-000000000101', 'aaaa1200-0000-0000-0000-00000000000a', 'one.mov');
SELECT public.t120_file('12000000-0000-0000-0000-000000000102', 'aaaa1200-0000-0000-0000-00000000000a', 'two.mov');
SELECT public.t120_file('12000000-0000-0000-0000-000000000103', 'aaaa1200-0000-0000-0000-00000000000a', 'three.mov');
SELECT public.t120_file('12000000-0000-0000-0000-000000000104', 'aaaa1200-0000-0000-0000-0000000000c0', 'mine.mov');
SELECT public.t120_file('12000000-0000-0000-0000-000000000106', 'aaaa1200-0000-0000-0000-00000000000d', 'seat-manager.mov');
SELECT public.t120_file('12000000-0000-0000-0000-000000000107', 'aaaa1200-0000-0000-0000-00000000000d', 'seat-workspace.mov');
SELECT public.t120_file('12000000-0000-0000-0000-000000000105', 'aaaa1200-0000-0000-0000-00000000000a', 'under-money.pdf', '12000000-0000-0000-0000-0000000000f3');
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial) VALUES
  ('12000000-0000-0000-0000-000000000111', 'aaaa1200-0000-0000-0000-00000000000a', 'inv.pdf', 'supabase', 'projects/aaaa1200-0000-0000-0000-00000000000a/invoices/a/inv.pdf', true);
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, tags) VALUES
  ('12000000-0000-0000-0000-000000000112', 'aaaa1200-0000-0000-0000-00000000000a', 'nda.pdf', 'supabase', 'projects/aaaa1200-0000-0000-0000-00000000000a/legal/a/nda.pdf', '{legal}');


-- ── A. Who may call ─────────────────────────────────────────────────────────
SELECT is((SELECT array_agg(x) FROM unnest(ARRAY['public.moth_trash_files(uuid[])', 'public.moth_restore_files(uuid[])', 'public.moth_trash_index(integer,timestamp with time zone)']) x
            WHERE has_function_privilege('anon', x::regprocedure, 'EXECUTE')), NULL::text[], 'anon can call none of the three');
SELECT is(has_function_privilege('authenticated', 'public._moth_trash_batch(uuid[],boolean)', 'EXECUTE'), false, 'and no client the batch inside them');

SET LOCAL ROLE authenticated;
SELECT public.t120_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'user');
SELECT throws_ok($$ SELECT public.moth_trash_files(ARRAY['12000000-0000-0000-0000-000000000101'::uuid]) $$, 'P0001', 'moth_trash:not_a_workspace_member', 'someone no longer active cannot delete');
SELECT throws_ok($$ SELECT public.moth_restore_files(ARRAY['12000000-0000-0000-0000-000000000101'::uuid]) $$, 'P0001', 'moth_trash:not_a_workspace_member', 'or restore');
SELECT throws_ok($$ SELECT public.moth_trash_index() $$, 'P0001', 'moth_trash:not_a_workspace_member', 'or look');
SELECT public.t120_c();
SELECT throws_ok($$ SELECT public.moth_trash_files('{}'::uuid[]) $$, 'P0001', 'moth_trash:empty', 'no files');
SELECT throws_ok($$ SELECT public.moth_restore_files(ARRAY[NULL::uuid]) $$, 'P0001', 'moth_trash:empty', 'only a NULL');
SELECT throws_ok($$ SELECT public.moth_trash_files((SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 501))) $$, 'P0001', 'moth_trash:too_many', 'over 500');


-- ── B. One exclusion, before any row is touched ─────────────────────────────
SELECT throws_ok($$ SELECT public.moth_trash_files(ARRAY['12000000-0000-0000-0000-00000000dead'::uuid]) $$, 'P0001', 'moth_trash:not_found', 'a file that does not exist');
SELECT throws_ok($$ SELECT public.moth_trash_files(ARRAY['12000000-0000-0000-0000-000000000105'::uuid]) $$, 'P0001', 'moth_trash:not_found', 'a file under INVOICES reads the same');
SELECT throws_ok($$ SELECT public.moth_trash_files(ARRAY['12000000-0000-0000-0000-000000000112'::uuid]) $$, 'P0001', 'moth_trash:not_found', 'and a Legal file');
SELECT throws_ok($$ SELECT public.moth_trash_files(ARRAY['12000000-0000-0000-0000-000000000101'::uuid, '12000000-0000-0000-0000-000000000111'::uuid]) $$, 'P0001', 'moth_trash:not_found', 'a batch with one invoice');
SELECT public.t120_a();
SELECT throws_ok($$ SELECT public.moth_trash_files(ARRAY['12000000-0000-0000-0000-000000000101'::uuid, '12000000-0000-0000-0000-000000000111'::uuid]) $$, 'P0001', 'moth_trash:not_found', 'even for an admin');
SELECT throws_ok($$ SELECT public.moth_trash_files(ARRAY['12000000-0000-0000-0000-000000000104'::uuid]) $$, 'P0001', 'moth_trash:not_found', 'nor can an admin reach someone''s personal space here');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.files WHERE id = '12000000-0000-0000-0000-000000000101' AND deleted_at IS NULL), 1, 'and nothing was trashed');
SET LOCAL ROLE authenticated;

-- The generic path stays what it was: can_write_project is owner-only on a personal space (0110).
SELECT public.t120_d();
SELECT throws_ok($$ SELECT public.soft_delete_row('files', '12000000-0000-0000-0000-000000000104') $$, 'P0001', 'not allowed to soft-delete or restore this row', 'on the generic path a manager is refused a personal space');
SELECT public.t120_v();
SELECT throws_ok($$ SELECT public.soft_delete_row('files', '12000000-0000-0000-0000-000000000104') $$, 'P0001', 'not allowed to soft-delete or restore this row', 'and an unstaffed member');
SELECT public.t120_a();
SELECT throws_ok($$ SELECT public.soft_delete_row('files', '12000000-0000-0000-0000-000000000104') $$, 'P0001', 'not allowed to soft-delete or restore this row', 'and an admin');
SELECT public.t120_c();
SELECT is(public.soft_delete_row('files', '12000000-0000-0000-0000-000000000104'), true, 'its owner is allowed');
SELECT is(public.restore_soft_deleted('files', '12000000-0000-0000-0000-000000000104'), true, 'both ways');

-- fn_trash_authz still answers, in Moth's words.
SELECT public.t120_v();
SELECT throws_ok($$ SELECT public.moth_trash_files(ARRAY['12000000-0000-0000-0000-000000000101'::uuid]) $$, 'P0001', 'moth_trash:not_allowed', 'a reviewer is refused');


-- ── C. Delete and restore ───────────────────────────────────────────────────
SELECT public.t120_c();
INSERT INTO t120_ret SELECT 't1', public.moth_trash_files(ARRAY['12000000-0000-0000-0000-000000000101'::uuid, '12000000-0000-0000-0000-000000000102'::uuid, '12000000-0000-0000-0000-000000000101'::uuid]);
SELECT is((SELECT v FROM t120_ret WHERE k = 't1'), '{"done": 2, "ops": []}'::jsonb, 'two files, once each, and nothing for the desktop');
SELECT is(public.moth_trash_files(ARRAY['12000000-0000-0000-0000-000000000101'::uuid]) ->> 'done', '0', 'one already in the trash adds nothing');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.files WHERE id IN ('12000000-0000-0000-0000-000000000101', '12000000-0000-0000-0000-000000000102') AND deleted_at IS NOT NULL AND deleted_by = 'cccccccc-cccc-cccc-cccc-cccccccccccc'), 2, 'in the trash, naming who');
SET LOCAL ROLE authenticated;
SELECT is(public.moth_restore_files(ARRAY['12000000-0000-0000-0000-000000000103'::uuid]) ->> 'done', '0', 'restoring a live row adds nothing');
SELECT is(public.moth_restore_files(ARRAY['12000000-0000-0000-0000-000000000102'::uuid]) ->> 'done', '1', 'and a trashed one comes back');
RESET ROLE;
SELECT is((SELECT row(deleted_at, deleted_by)::text FROM public.files WHERE id = '12000000-0000-0000-0000-000000000102'), '(,)', 'with nothing left of its delete');
SET LOCAL ROLE authenticated;
SELECT public.t120_v();
SELECT throws_ok($$ SELECT public.moth_restore_files(ARRAY['12000000-0000-0000-0000-000000000101'::uuid]) $$, 'P0001', 'moth_trash:not_allowed', 'a reviewer cannot restore');
-- The other seats, each both ways.
SELECT public.t120_c();
SELECT throws_ok($$ SELECT public.moth_trash_files(ARRAY['12000000-0000-0000-0000-000000000106'::uuid]) $$, 'P0001', 'moth_trash:not_allowed', 'a member off a staffed project is refused');
SELECT public.t120_v();
SELECT is(public.moth_trash_files(ARRAY['12000000-0000-0000-0000-000000000106'::uuid]) ->> 'done', '1', 'a manager of the project may delete');
SELECT public.t120_c();
SELECT throws_ok($$ SELECT public.moth_restore_files(ARRAY['12000000-0000-0000-0000-000000000106'::uuid]) $$, 'P0001', 'moth_trash:not_allowed', 'and a member off it may not restore');
SELECT public.t120_v();
SELECT is(public.moth_restore_files(ARRAY['12000000-0000-0000-0000-000000000106'::uuid]) ->> 'done', '1', 'and the manager may');
SELECT public.t120_d();
SELECT is(public.moth_trash_files(ARRAY['12000000-0000-0000-0000-000000000107'::uuid]) ->> 'done', '1', 'a workspace manager may delete');
SELECT is(public.moth_restore_files(ARRAY['12000000-0000-0000-0000-000000000107'::uuid]) ->> 'done', '1', 'and restore');
SELECT public.t120_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222');
SELECT throws_ok($$ SELECT public.moth_trash_files(ARRAY['12000000-0000-0000-0000-000000000107'::uuid]) $$, 'P0001', 'moth_trash:not_found', 'another company''s admin reads it as not there');
SELECT throws_ok($$ SELECT public.moth_restore_files(ARRAY['12000000-0000-0000-0000-000000000107'::uuid]) $$, 'P0001', 'moth_trash:not_found', 'both ways');


-- ── D. The trash view ───────────────────────────────────────────────────────
RESET ROLE;
SELECT public.t120_a();
UPDATE public.files SET deleted_at = now() - interval '5 days' WHERE id = '12000000-0000-0000-0000-000000000101';
UPDATE public.files SET deleted_at = now() - interval '31 days', deleted_by = 'cccccccc-cccc-cccc-cccc-cccccccccccc' WHERE id = '12000000-0000-0000-0000-000000000103';
UPDATE public.files SET deleted_at = now() WHERE id IN ('12000000-0000-0000-0000-000000000105', '12000000-0000-0000-0000-000000000111', '12000000-0000-0000-0000-000000000112', '12000000-0000-0000-0000-000000000104');
SELECT public.t120_file('12000000-0000-0000-0000-000000000201', 'aaaa1200-0000-0000-0000-00000000000b', 'binned.mov');
UPDATE public.files SET deleted_at = now() WHERE id = '12000000-0000-0000-0000-000000000201';
UPDATE public.projects SET deleted_at = now() WHERE id = 'aaaa1200-0000-0000-0000-00000000000b';
SET LOCAL ROLE authenticated;
SELECT public.t120_c();
SELECT is((SELECT array_agg(x.id ORDER BY x.id) FROM public.moth_trash_index() x), ARRAY['12000000-0000-0000-0000-000000000101'::uuid, '12000000-0000-0000-0000-000000000104'::uuid], 'a member sees the trashed file and their own space''s: not money, Legal, a locked folder, a binned project, or a row past its 30 days');
SELECT is((SELECT purges_at FROM public.moth_trash_index() x WHERE x.id = '12000000-0000-0000-0000-000000000101'), (now() - interval '5 days') + interval '30 days', 'purges_at is 30 days on');
SELECT is((SELECT deleted_by_label FROM public.moth_trash_index() x WHERE x.id = '12000000-0000-0000-0000-000000000101'), 'User C', 'it names who');
SELECT is((SELECT row(project_title, name, can_restore, needs_desktop)::text FROM public.moth_trash_index() x WHERE x.id = '12000000-0000-0000-0000-000000000101'), '("Salt Hours",one.mov,t,f)', 'and what');
SELECT public.t120_a();
SELECT is(public.t120_seen('12000000-0000-0000-0000-000000000101'), true, 'CONTROL: an admin sees an ordinary trashed file');
SELECT is(public.t120_seen('12000000-0000-0000-0000-000000000104'), false, 'an admin does not see someone''s personal space here');
SELECT is(public.t120_seen('12000000-0000-0000-0000-000000000111'), false, 'nor an invoice');
SELECT public.t120_v();
SELECT is((SELECT can_restore FROM public.moth_trash_index() x WHERE x.id = '12000000-0000-0000-0000-000000000101'), false, 'a reviewer sees it and may not restore it');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM pg_proc p, unnest(p.proargnames) a
            WHERE p.oid = 'public.moth_trash_index(integer,timestamp with time zone)'::regprocedure
              AND a IN ('storage_path', 'thumbnail_url', 'storage_provider', 'share_bin_path')), 0, 'no locator column');

SET LOCAL ROLE authenticated;
SELECT public.t120_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222');
SELECT is(public.t120_seen('12000000-0000-0000-0000-000000000101'), false, 'another company''s admin sees nothing of it');

-- Restore asks the same one exclusion, an admin included.
SELECT public.t120_a();
SELECT throws_ok($$ SELECT public.moth_restore_files(ARRAY['12000000-0000-0000-0000-000000000105'::uuid]) $$, 'P0001', 'moth_trash:not_found', 'a file under INVOICES stays in the trash');
SELECT throws_ok($$ SELECT public.moth_restore_files(ARRAY['12000000-0000-0000-0000-000000000111'::uuid]) $$, 'P0001', 'moth_trash:not_found', 'and an invoice');
SELECT throws_ok($$ SELECT public.moth_restore_files(ARRAY['12000000-0000-0000-0000-000000000112'::uuid]) $$, 'P0001', 'moth_trash:not_found', 'and a Legal file');
SELECT throws_ok($$ SELECT public.moth_restore_files(ARRAY['12000000-0000-0000-0000-000000000201'::uuid]) $$, 'P0001', 'moth_trash:not_found', 'and a file in a project in the bin');
SELECT throws_ok($$ SELECT public.moth_restore_files(ARRAY['12000000-0000-0000-0000-000000000104'::uuid]) $$, 'P0001', 'moth_trash:not_found', 'and someone''s personal file');
SELECT throws_ok($$ SELECT public.moth_restore_files(ARRAY['12000000-0000-0000-0000-00000000dead'::uuid]) $$, 'P0001', 'moth_trash:not_found', 'and one that does not exist');
SELECT throws_ok($$ SELECT public.moth_restore_files(ARRAY['12000000-0000-0000-0000-000000000101'::uuid, '12000000-0000-0000-0000-000000000111'::uuid]) $$, 'P0001', 'moth_trash:not_found', 'a batch with one invoice restores nothing');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.files WHERE id IN ('12000000-0000-0000-0000-000000000101', '12000000-0000-0000-0000-000000000105', '12000000-0000-0000-0000-000000000111', '12000000-0000-0000-0000-000000000112', '12000000-0000-0000-0000-000000000201') AND deleted_at IS NOT NULL), 5, 'and nothing came back');

-- Trashed together, read in pages: a page runs on to the end of its batch.
SELECT public.t120_a();
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, deleted_at)
SELECT ('12000000-0000-0000-0000-0000000003' || lpad(g::text, 2, '0'))::uuid, 'aaaa1200-0000-0000-0000-00000000000a', 'b' || g, 'supabase',
       'projects/aaaa1200-0000-0000-0000-00000000000a/files/b' || g || '/b' || g, now() - interval '4 days'
  FROM generate_series(1, 5) g;
SET LOCAL ROLE authenticated;
SELECT public.t120_c();
SELECT is((SELECT count(*)::int FROM public.moth_trash_index(2, now() - interval '1 hour') x), 5, 'a page of 2 takes all 5 of a batch, or the cursor would strand 3');
SELECT is((SELECT array_agg(x.id) FROM public.moth_trash_index(1, now() - interval '4 days') x), ARRAY['12000000-0000-0000-0000-000000000101'::uuid], 'the next page starts after it');
SELECT is((SELECT count(*)::int FROM public.moth_trash_index(0, now() - interval '4 days' + interval '1 second') x), 5, 'a limit below 1 reads as 1');
SELECT is((SELECT count(*)::int FROM public.moth_trash_index(1, now() - interval '30 days 1 hour') x), 0, 'and nothing before the 30 days is listed at all');
RESET ROLE;


-- ── E. The office server ────────────────────────────────────────────────────
CREATE FUNCTION public.t120_root() RETURNS text LANGUAGE sql IMMUTABLE AS $f$ SELECT replace('//nas/share/wilson', '/', chr(92)) $f$;
INSERT INTO public.workspace_storage (workspace_id, mode, provider, root_path, root_kind)
VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 'network', public.t120_root(), 'unc');
SELECT public.t120_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, folder_root) VALUES
  ('aaaa1200-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'Salt Share', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, public.t120_root() || chr(92) || 'Salt-Hours');
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1200-0000-0000-0000-000000000011', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1200-0000-0000-0000-000000000011', 'abababab-abab-abab-abab-abababababab', '11111111-1111-1111-1111-111111111111', 'reviewer')
ON CONFLICT DO NOTHING;
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path) VALUES
  ('12000000-0000-0000-0000-000000000401', 'aaaa1200-0000-0000-0000-000000000011', 'a.mov', 'network_share', 'nas:Salt-Hours/a.mov'),
  ('12000000-0000-0000-0000-000000000402', 'aaaa1200-0000-0000-0000-000000000011', 'b.mov', 'network_share', 'nas:Salt-Hours/b.mov');
SELECT public.t120_file('12000000-0000-0000-0000-000000000403', 'aaaa1200-0000-0000-0000-00000000000a', 'mixed.mov');
SET LOCAL ROLE authenticated;
SELECT public.t120_v();
SELECT throws_ok($$ SELECT public.moth_trash_files(ARRAY['12000000-0000-0000-0000-000000000401'::uuid]) $$, 'P0001', 'moth_trash:not_allowed', 'a reviewer is refused an office-server file in the same words');
SELECT public.t120_c();
INSERT INTO t120_ret SELECT 's1', public.moth_trash_files(ARRAY['12000000-0000-0000-0000-000000000401'::uuid, '12000000-0000-0000-0000-000000000403'::uuid]);
SELECT is((SELECT (v ->> 'done')::int FROM t120_ret WHERE k = 's1'), 2, 'one batch can hold both kinds');
SELECT is((SELECT v -> 'ops' -> 0 ->> 'to' FROM t120_ret WHERE k = 's1'), 'Salt-Hours/.wilson-bin/12000000-0000-0000-0000-000000000401/a.mov', 'and the desktop gets its rename');
SELECT is((SELECT jsonb_array_length(v -> 'ops') FROM t120_ret WHERE k = 's1'), 1, 'for the office-server row alone');
SELECT is(current_setting('wilson.network_share_writer', true), '', 'and the marker is empty');
SELECT is(public.t120_seen('12000000-0000-0000-0000-000000000401'), true, 'it is in the view');
SELECT is((SELECT needs_desktop FROM public.moth_trash_index(500) x WHERE x.id = '12000000-0000-0000-0000-000000000401'), true, 'needing the desktop');
SELECT is((SELECT needs_desktop FROM public.moth_trash_index(500) x WHERE x.id = '12000000-0000-0000-0000-000000000403'), false, 'and the other not');
SELECT is(public.moth_trash_files(ARRAY['12000000-0000-0000-0000-000000000401'::uuid]) ->> 'done', '0', 'one already in the trash adds nothing, on the server too');
SELECT throws_ok($$ SELECT public.moth_restore_files(ARRAY['12000000-0000-0000-0000-000000000401'::uuid]) $$, 'P0001', 'moth_trash:pending', 'while the desktop is moving it, it says so');
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[(SELECT (v -> 'ops' -> 0 ->> 'op_id')::uuid FROM t120_ret WHERE k = 's1')], 'done') $$, 'the file reached the bin');
INSERT INTO t120_ret SELECT 's2', public.moth_restore_files(ARRAY['12000000-0000-0000-0000-000000000401'::uuid, '12000000-0000-0000-0000-000000000403'::uuid, '12000000-0000-0000-0000-000000000402'::uuid]);
SELECT is((SELECT (v ->> 'done')::int FROM t120_ret WHERE k = 's2'), 2, 'restore takes both kinds, and a live row adds nothing');
SELECT is((SELECT v -> 'ops' -> 0 ->> 'to' FROM t120_ret WHERE k = 's2'), 'Salt-Hours/a.mov', 'and says where the file goes back to');
RESET ROLE;
SELECT is((SELECT deleted_at IS NULL AND share_bin_path IS NOT NULL FROM public.files WHERE id = '12000000-0000-0000-0000-000000000401'), true, 'the row is live, and keeps its bin path until it settles');
-- A batch is whole on the server too: a good file and one an operation holds.
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.moth_trash_files(ARRAY['12000000-0000-0000-0000-000000000401'::uuid, '12000000-0000-0000-0000-000000000402'::uuid]) $$, 'P0001', 'moth_trash:pending', 'a batch with a pending row stops');
RESET ROLE;
SELECT is((SELECT deleted_at FROM public.files WHERE id = '12000000-0000-0000-0000-000000000402'), NULL::timestamptz, 'and the good file is untouched');


-- ── F. The cap ──────────────────────────────────────────────────────────────
SELECT public.t120_a();
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, deleted_at)
SELECT ('12000000-0000-0000-0000-00000001' || lpad(g::text, 4, '0'))::uuid, 'aaaa1200-0000-0000-0000-00000000000a', 'c' || g, 'supabase',
       'projects/aaaa1200-0000-0000-0000-00000000000a/files/c' || g || '/c' || g, now() - make_interval(secs => g)
  FROM generate_series(1, 501) g;
SET LOCAL ROLE authenticated;
SELECT public.t120_c();
SELECT is((SELECT count(*)::int FROM public.moth_trash_index(600) x), 500, 'a page is capped at 500, whatever is asked');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
