-- =============================================================================
-- measure-0119.sql: what the runbook's 0119 row asks to be measured before it runs. See that row.
--
--   python scripts/tap-hosted.py <W>/measure.sql supabase/migrations/0119_moth_history.sql scripts/measure-0119.sql
--   supabase db query --linked --file <W>/measure.sql
--
-- Leave the migration out of the first command once it is applied. Inside the quiet window, once:
-- it writes thousands of test rows and rolls them back, so dead rows wait for autovacuum.
-- The verdict is one failed check whose text is the numbers, in milliseconds. authenticated's limit is 8 s.
-- =============================================================================
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
CREATE FUNCTION public.mz_time(p_key text, p_sql text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  t0 timestamptz := clock_timestamp();
BEGIN
  EXECUTE p_sql;
  INSERT INTO mz (k, ms) VALUES (p_key, extract(epoch FROM clock_timestamp() - t0) * 1000);
END;
$f$;

SELECT public.mz_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin');
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private) VALUES
  ('aaaa1299-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Open', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false),
  ('aaaa1299-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Hidden', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('12990000-0000-0000-0000-0000000000f0', 'aaaa1299-0000-0000-0000-00000000000a', NULL, 'root', 'open', ''),
  ('12990000-0000-0000-0000-0000000000f1', 'aaaa1299-0000-0000-0000-00000000000a', '12990000-0000-0000-0000-0000000000f0', 'category', 'big', 'big');

-- What a catalogue call does to the table: 1,000 new rows and 1,500 marked gone, in a statement each.
SELECT public.mz_time('catalogue_add1000', $s$
  INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, size_bytes, source_modified_at)
  SELECT ('12993000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'aaaa1299-0000-0000-0000-00000000000a', 'n' || g || '.mov', 'network_share', 'nas:Open/n' || g || '.mov', 1, '2026-10-01T10:00:00Z'
    FROM generate_series(1, 1000) g $s$);
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, size_bytes, source_modified_at)
SELECT ('12994000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'aaaa1299-0000-0000-0000-00000000000a', 'g' || g || '.mov', 'network_share', 'nas:Open/g' || g || '.mov', 1, '2026-10-01T10:00:00Z'
  FROM generate_series(1, 1500) g;
SELECT public.mz_time('catalogue_missing1500', $s$
  UPDATE public.files SET share_missing_since = now() WHERE id IN (SELECT ('12994000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid FROM generate_series(1, 1500) g) $s$);

-- A folder holding 3,000 files, deleted: the key's SET NULL updates each.
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, folder_id)
SELECT ('12995000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'aaaa1299-0000-0000-0000-00000000000a', 'f' || g, 'local_server',
       'projects/aaaa1299-0000-0000-0000-00000000000a/files/' || ('12995000-0000-0000-0000-' || lpad(g::text, 12, '0')) || '/f', '12990000-0000-0000-0000-0000000000f1'
  FROM generate_series(1, 3000) g;
SELECT public.mz_time('folder_delete3000', $s$ DELETE FROM public.folders WHERE id = '12990000-0000-0000-0000-0000000000f1' $s$);

-- 20,000 rows nobody but an admin may see, newest; and 2,000 a member may, older.
INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, observed_at, state_project_id, state_class, state)
SELECT '11111111-1111-1111-1111-111111111111', 'files', ('12996000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'update', now() - make_interval(secs => g),
       'aaaa1299-0000-0000-0000-00000000000c', 'private', '{"name":"x"}'
  FROM generate_series(1, 20000) g;
INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, observed_at, state_project_id, state_class, state)
SELECT '11111111-1111-1111-1111-111111111111', 'files', ('12997000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'update', now() - interval '1 day' - make_interval(secs => g),
       'aaaa1299-0000-0000-0000-00000000000a', 'shared', '{"name":"y"}'
  FROM generate_series(1, 2000) g;
SET LOCAL ROLE authenticated;
SELECT public.mz_time('read_admin_limit100', 'SELECT count(*) FROM public.moth_history_read(NULL, NULL, NULL, 100)');
SELECT public.mz_time('read_admin_limit5000', 'SELECT count(*) FROM public.moth_history_read(NULL, NULL, NULL, 5000)');
SELECT public.mz_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user');
SELECT public.mz_time('read_member_past20000hidden', 'SELECT count(*) FROM public.moth_history_read(NULL, NULL, NULL, 100)');
SELECT public.mz_time('read_member_scoped', $s$ SELECT count(*) FROM public.moth_history_read('aaaa1299-0000-0000-0000-00000000000a', NULL, NULL, 100) $s$);
SELECT public.mz_time('window', 'SELECT count(*) FROM public.moth_history_window()');
RESET ROLE;
SELECT public.mz_time('purge_nothing_old', 'SELECT public.purge_moth_history()');

SELECT ok(false, 'MS ' || (SELECT string_agg(k || '=' || ms, ' ' ORDER BY n) FROM mz) || ' rows ' || (SELECT count(*) FROM public.moth_history));
SELECT * FROM finish();
ROLLBACK;
