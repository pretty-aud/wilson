-- =============================================================================
-- measure-0118.sql: what the runbook's 0118 row asks to be measured before it runs. See that row.
--
--   python scripts/tap-hosted.py <W>/measure.sql supabase/migrations/0118_moth_moves_and_trash.sql scripts/measure-0118.sql
--   supabase db query --linked --file <W>/measure.sql
--
-- Leave the migration out of the first command once it is applied. Inside the quiet window, once:
-- it writes 500 and 5,000 test rows and rolls them back, about 9,500 dead rows in files until autovacuum.
-- =============================================================================
-- 0118's costs at size, as the role a client runs as, rolled back. No statement timeout is set, so the
-- real number shows; authenticated's limit is 8 s. The verdict is one failed check whose text is the numbers.
BEGIN;
SELECT plan(1);
SELECT * FROM tests.rls_setup();

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local', crypt('testpw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

CREATE FUNCTION public.mz_as(p_user uuid, p_role text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', p_role))::text, true);
END;
$f$;
CREATE TEMP TABLE mz (n serial, k text, ms integer) ON COMMIT DROP;
GRANT ALL ON mz TO authenticated;
GRANT ALL ON mz_n_seq TO authenticated;
CREATE TEMP TABLE mzr (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON mzr TO authenticated;
CREATE FUNCTION public.mz_time(p_key text, p_sql text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  t0 timestamptz := clock_timestamp();
  v  jsonb;
BEGIN
  EXECUTE p_sql INTO v;
  INSERT INTO mz (k, ms) VALUES (p_key, extract(epoch FROM clock_timestamp() - t0) * 1000);
  INSERT INTO mzr VALUES (p_key, v);
END;
$f$;

SELECT public.mz_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin');
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private) VALUES
  ('aaaa1299-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'From', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false),
  ('aaaa1299-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'To', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false),
  ('aaaa1299-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Hidden', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

-- 500 files by association.
INSERT INTO storage.objects (bucket_id, name, owner_id)
SELECT 'rabbit-files', 'projects/aaaa1299-0000-0000-0000-00000000000a/files/' || ('12990000-0000-0000-0000-' || lpad(g::text, 12, '0')) || '/m.mov', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  FROM generate_series(1, 500) g;
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
SELECT ('12990000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'aaaa1299-0000-0000-0000-00000000000a', 'm' || g || '.mov', 'supabase',
       'projects/aaaa1299-0000-0000-0000-00000000000a/files/' || ('12990000-0000-0000-0000-' || lpad(g::text, 12, '0')) || '/m.mov'
  FROM generate_series(1, 500) g;
CREATE FUNCTION public.mz_ids(p_from int, p_to int) RETURNS text LANGUAGE sql AS $f$
  SELECT 'ARRAY(SELECT (''12990000-0000-0000-0000-'' || lpad(g::text, 12, ''0''))::uuid FROM generate_series(' || p_from || ', ' || p_to || ') g)';
$f$;

SET LOCAL ROLE authenticated;
SELECT public.mz_time('plan500', 'SELECT public.moth_move_items(' || public.mz_ids(1, 500) || ', ''aaaa1299-0000-0000-0000-00000000000b'', NULL, true)');
SELECT public.mz_time('move500', 'SELECT public.moth_move_items(' || public.mz_ids(1, 500) || ', ''aaaa1299-0000-0000-0000-00000000000b'')');
SELECT public.mz_time('undo500', format('SELECT public.moth_undo_move(%L)', (SELECT v ->> 'move_id' FROM mzr WHERE k = 'move500')));
SELECT public.mz_time('trash500', 'SELECT public.moth_trash_files(' || public.mz_ids(1, 500) || ')');
SELECT public.mz_time('index500', 'SELECT to_jsonb(count(*)) FROM public.moth_trash_index(200)');
SELECT public.mz_time('restore500', 'SELECT public.moth_restore_files(' || public.mz_ids(1, 500) || ')');
RESET ROLE;

-- 5,000 files in the trash a member cannot see: the view walks them all, asking the gate of each.
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, deleted_at)
SELECT ('12991000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'aaaa1299-0000-0000-0000-00000000000c', 'h' || g, 'supabase',
       'projects/aaaa1299-0000-0000-0000-00000000000c/files/h' || g || '/h', now() - make_interval(secs => g)
  FROM generate_series(1, 5000) g;
-- And 5,000 an admin can see, so the same walk stops at its page.
SET LOCAL ROLE authenticated;
SELECT public.mz_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user');
SELECT public.mz_time('index_member_hidden5000', 'SELECT to_jsonb(count(*)) FROM public.moth_trash_index(200)');
SELECT public.mz_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin');
SELECT public.mz_time('index_admin_page200', 'SELECT to_jsonb(count(*)) FROM public.moth_trash_index(200)');
RESET ROLE;

-- An office server with 200 projects and spaces, and 500 files between two of them.
CREATE FUNCTION public.mz_root() RETURNS text LANGUAGE sql IMMUTABLE AS $f$ SELECT replace('//nas/share/wilson', '/', chr(92)) $f$;
INSERT INTO public.workspace_storage (workspace_id, mode, provider, root_path, root_kind)
VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 'network', public.mz_root(), 'unc')
ON CONFLICT (workspace_id) DO UPDATE SET mode = 'byos', provider = 'network', root_path = EXCLUDED.root_path, root_kind = 'unc', provider_config = NULL;
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, folder_root)
SELECT ('aaaa1298-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111', 'Space ' || g, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false,
       public.mz_root() || chr(92) || 'Space-' || g
  FROM generate_series(1, 200) g;
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, size_bytes, source_modified_at)
SELECT ('12992000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'aaaa1298-0000-0000-0000-000000000001', 'n' || g || '.mov', 'network_share',
       'nas:Space-1/n' || g || '.mov', 1, '2026-10-01T10:00:00Z'
  FROM generate_series(1, 500) g;
CREATE FUNCTION public.mz_share_ids() RETURNS text LANGUAGE sql AS $f$
  SELECT 'ARRAY(SELECT (''12992000-0000-0000-0000-'' || lpad(g::text, 12, ''0''))::uuid FROM generate_series(1, 500) g)';
$f$;
SET LOCAL ROLE authenticated;
SELECT public.mz_time('share_plan500', 'SELECT public.moth_move_items(' || public.mz_share_ids() || ', ''aaaa1298-0000-0000-0000-000000000002'', NULL, true)');
SELECT public.mz_time('share_move500', 'SELECT public.moth_move_items(' || public.mz_share_ids() || ', ''aaaa1298-0000-0000-0000-000000000002'')');
SELECT public.mz_time('share_settle500', format('SELECT public.network_share_settle(ARRAY(SELECT (e ->> ''op_id'')::uuid FROM jsonb_array_elements(%L::jsonb) e), ''done'')', (SELECT (v -> 'ops')::text FROM mzr WHERE k = 'share_move500')));
SELECT public.mz_time('share_undo500', format('SELECT public.moth_undo_move(%L)', (SELECT v ->> 'move_id' FROM mzr WHERE k = 'share_move500')));
SELECT public.mz_time('share_notmoved500', format('SELECT public.network_share_settle(ARRAY(SELECT (e ->> ''op_id'')::uuid FROM jsonb_array_elements(%L::jsonb) e), ''not_moved'')', (SELECT (v -> 'ops')::text FROM mzr WHERE k = 'share_undo500')));
RESET ROLE;

SELECT ok(false, 'MS ' || (SELECT string_agg(k || '=' || ms, ' ' ORDER BY n) FROM mz));
SELECT * FROM finish();
ROLLBACK;
