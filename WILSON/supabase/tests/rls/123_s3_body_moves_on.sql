-- =============================================================================
-- 123_s3_body_moves_on.sql — M.O.T.H. Session 1 (MO1), the last database change (0120).
--
-- A file in a company's own bucket moves between projects, by association when its key names no private
-- project, and a source-only reader is then denied a signed URL. A new copy in the bucket is taken only on
-- a look by Petal's server, spent once. The plan's to_provider is compared at the commit. The look's table
-- and its writer are closed to every client. The switch still stands if it is turned off again.
--
-- A Edge of the look: grants and shape.   B The writer's arms.    C By association, and who may read after.
-- D A new copy: no look, wrong look, old look, spent look.        E The plan's provider.
-- F Petal's body into the bucket, a computer's, a leaver's.       G Undo.   H The switch off again.
-- =============================================================================
BEGIN;

SELECT plan(108);

SELECT * FROM tests.rls_setup();

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
SELECT u.id, u.email, crypt('testpw', gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
       'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()
  FROM (VALUES
    ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'user_c@test.local'),
    ('abababab-abab-abab-abab-abababababab'::uuid, 'user_r@test.local'),
    ('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, 'user_n@test.local')) u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111', 'abababab-abab-abab-abab-abababababab', 'user', 'user_r', 'User R', true),
  ('11111111-1111-1111-1111-111111111111', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'user', 'user_n', 'User N', false)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

CREATE FUNCTION public.t123_as(p_user uuid, p_role text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', p_role))::text, true);
END;
$f$;
CREATE FUNCTION public.t123_a() RETURNS void LANGUAGE sql AS $f$ SELECT public.t123_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin') $f$;
CREATE FUNCTION public.t123_c() RETURNS void LANGUAGE sql AS $f$ SELECT public.t123_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user') $f$;
CREATE FUNCTION public.t123_r() RETURNS void LANGUAGE sql AS $f$ SELECT public.t123_as('abababab-abab-abab-abab-abababababab', 'user') $f$;

-- A file in the bucket, as nothing but the runner can write it.
CREATE FUNCTION public.t123_s3(p_id uuid, p_project uuid, p_name text, p_thumb boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v_key text := 'projects/' || p_project || '/files/' || p_id || '/' || p_name;
BEGIN
  INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, thumbnail_url)
  VALUES (p_id, p_project, p_name, 's3', v_key, CASE WHEN p_thumb THEN v_key || '.jpg' END);
  RETURN v_key;
END;
$f$;
CREATE FUNCTION public.t123_petal(p_id uuid, p_project uuid, p_name text)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_key text := 'projects/' || p_project || '/files/' || p_id || '/' || p_name;
BEGIN
  INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('rabbit-files', v_key, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  INSERT INTO public.files (id, project_id, name, storage_provider, storage_path)
  VALUES (p_id, p_project, p_name, 'supabase', v_key);
END;
$f$;
-- The key a plan would mint for this file in that project.
CREATE FUNCTION public.t123_key(p_id uuid, p_project uuid, p_name text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT 'projects/' || p_project || '/files/' || p_id || '/1700000000000-' || p_name
$f$;
CREATE FUNCTION public.t123_body(p_id uuid, p_provider text, p_path text, p_thumb text DEFAULT NULL) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('file_id', p_id, 'to_provider', p_provider, 'path', p_path, 'thumbnail', p_thumb)))
$f$;
CREATE FUNCTION public.t123_m(p_ids uuid[], p_dest uuid, p_plan boolean DEFAULT false, p_bodies jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $f$ SELECT public.moth_move_items(p_ids, p_dest, NULL, p_plan, p_bodies) $f$;
CREATE FUNCTION public.t123_detail(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
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
CREATE FUNCTION public.t123_looks(p_path text) RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$
  SELECT count(*)::int FROM rabbit_private.s3_body_looks l WHERE l.object_path = p_path
$f$;
GRANT EXECUTE ON FUNCTION public.t123_looks(text) TO authenticated;

-- A look as the sweep or a clock would find it.
CREATE FUNCTION public.t123_put_look(p_ws uuid, p_path text, p_by uuid, p_at timestamptz DEFAULT now())
RETURNS void LANGUAGE sql AS $f$
  INSERT INTO rabbit_private.s3_body_looks (workspace_id, object_path, bucket_mark, seen_by, seen_at)
  VALUES (p_ws, p_path, rabbit_private.s3_bucket_mark(p_ws), p_by, p_at)
$f$;
-- Whether the job is there, where the stack has pg_cron at all. EXECUTE, so a stack without it can parse this.
CREATE FUNCTION public.t123_job(OUT schedule text) LANGUAGE plpgsql AS $f$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    schedule := 'no pg_cron here';
  ELSE
    EXECUTE $q$ SELECT schedule FROM cron.job WHERE jobname = 'wilson-sweep-s3-looks' $q$ INTO schedule;
  END IF;
END;
$f$;

CREATE TEMP TABLE t123_ret (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON t123_ret TO authenticated;
CREATE FUNCTION public.t123_v(p_key text) RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT v FROM t123_ret WHERE k = p_key $f$;

SELECT public.t123_a();

-- A: a public source with a reader of its own. B: private, the writer is a member and the reader is not.
-- P: private, so a key naming it must be copied. Q: public, another destination. S: a leaver's own space.
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1230-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Salt Hours', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1230-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Moon Film', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true, NULL),
  ('aaaa1230-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Quiet Room', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true, NULL),
  ('aaaa1230-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'Open Door', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1230-0000-0000-0000-00000000000e', '11111111-1111-1111-1111-111111111111', 'Gone', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1230-0000-0000-0000-0000000000f0', '11111111-1111-1111-1111-111111111111', 'Personal space', 'ffffffff-ffff-ffff-ffff-ffffffffffff', true, 'ffffffff-ffff-ffff-ffff-ffffffffffff');
UPDATE public.projects SET deleted_at = now() WHERE id = 'aaaa1230-0000-0000-0000-00000000000e';

INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1230-0000-0000-0000-00000000000a', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1230-0000-0000-0000-00000000000a', 'abababab-abab-abab-abab-abababababab', '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1230-0000-0000-0000-00000000000b', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1230-0000-0000-0000-00000000000c', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1230-0000-0000-0000-00000000000d', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT DO NOTHING;

-- ── A. The look's table and writer are nobody's but the server's ────────────────────────
SELECT is(rabbit_private.s3_body_moves_on(), true, '0120 turns the switch on');
SELECT is(to_regclass('public.s3_body_looks'), NULL, 'the look is not a table PostgREST serves');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'rabbit_private.s3_body_looks'::regclass), 'row security is on, with no policy');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'rabbit_private' AND tablename = 's3_body_looks'), 0, 'and no policy');
SELECT ok(NOT has_table_privilege('anon', 'rabbit_private.s3_body_looks', 'SELECT,INSERT,UPDATE,DELETE'), 'anon has no grant on it');
SELECT ok(NOT has_table_privilege('authenticated', 'rabbit_private.s3_body_looks', 'SELECT,INSERT,UPDATE,DELETE'), 'a signed-in person has none');
SELECT ok(NOT has_table_privilege('service_role', 'rabbit_private.s3_body_looks', 'SELECT,INSERT,UPDATE,DELETE'), 'nor the service role, which has its one function');
SELECT is((SELECT confdeltype::text FROM pg_constraint WHERE conrelid = 'rabbit_private.s3_body_looks'::regclass AND contype = 'f'), 'c', 'a look goes with its company');
SELECT ok(NOT has_function_privilege('anon', 'public.s3_body_look_record(uuid,text,uuid)', 'EXECUTE'), 'anon cannot record a look');
SELECT ok(NOT has_function_privilege('authenticated', 'public.s3_body_look_record(uuid,text,uuid)', 'EXECUTE'), 'a signed-in person cannot');
SELECT ok(has_function_privilege('service_role', 'public.s3_body_look_record(uuid,text,uuid)', 'EXECUTE'), 'the service role can');
SELECT ok((SELECT prosecdef AND proconfig @> ARRAY['search_path=public'] FROM pg_proc WHERE oid = 'public.s3_body_look_record(uuid,text,uuid)'::regprocedure), 'it runs as its owner, on a fixed path');
SELECT ok((SELECT provolatile = 's' FROM pg_proc WHERE oid = 'rabbit_private.s3_body_moves_on()'::regprocedure), 'the switch is stable, so turning it off reaches a live connection');
SELECT ok(NOT has_function_privilege('authenticated', 'rabbit_private.s3_bucket_mark(uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'rabbit_private.s3_bucket_mark(uuid)', 'EXECUTE'), 'a client cannot ask which bucket');
SELECT ok(NOT has_function_privilege('authenticated', 'rabbit_private.s3_body_looks_sweep()', 'EXECUTE') AND NOT has_function_privilege('anon', 'rabbit_private.s3_body_looks_sweep()', 'EXECUTE'), 'nor run the sweep');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'rabbit_private.s3_body_looks_sweep()'::regprocedure) AND (SELECT prosecdef FROM pg_proc WHERE oid = 'rabbit_private.s3_bucket_mark(uuid)'::regprocedure), 'both run as their owner');
SELECT ok(public.t123_job() IN ('no pg_cron here', '53 4 * * *'), 'the sweep is a nightly job, where the stack has pg_cron');
SET LOCAL ROLE authenticated;
SELECT public.t123_c();
SELECT throws_ok($$ SELECT public.s3_body_look_record('11111111-1111-1111-1111-111111111111', 'projects/aaaa1230-0000-0000-0000-00000000000b/files/x/y.mov', 'cccccccc-cccc-cccc-cccc-cccccccccccc') $$,
  '42501', NULL, 'and a signed-in person is refused by the database, not just by the grant''s reading');
SELECT throws_ok($$ SELECT count(*) FROM rabbit_private.s3_body_looks $$, '42501', NULL, 'a signed-in person cannot read a look');
SELECT throws_ok($$ INSERT INTO rabbit_private.s3_body_looks (workspace_id, object_path, seen_by) VALUES ('11111111-1111-1111-1111-111111111111', 'x', 'cccccccc-cccc-cccc-cccc-cccccccccccc') $$, '42501', NULL, 'nor write one');
RESET ROLE;

-- Both companies go onto their own buckets.
INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3', '{"region":"r","bucket":"b","accessKeyId":"A"}'::jsonb),
       ('22222222-2222-2222-2222-222222222222', 'byos', 's3', '{"region":"r","bucket":"theirs","accessKeyId":"B"}'::jsonb)
ON CONFLICT (workspace_id) DO UPDATE SET mode = 'byos', provider = 's3', root_path = NULL, root_kind = NULL, provider_config = EXCLUDED.provider_config;

-- ── B. The writer's arms ───────────────────────────────────────────────────────────────
SET LOCAL ROLE service_role;
SELECT is(public.s3_body_look_record('11111111-1111-1111-1111-111111111111', public.t123_key('12300000-0000-0000-0000-000000000b01', 'aaaa1230-0000-0000-0000-00000000000b', 'b.mov'), 'cccccccc-cccc-cccc-cccc-cccccccccccc'), true, 'the service role records a look');
RESET ROLE;
SELECT is((SELECT row(seen_by, seen_at = now())::text FROM rabbit_private.s3_body_looks WHERE object_path = public.t123_key('12300000-0000-0000-0000-000000000b01', 'aaaa1230-0000-0000-0000-00000000000b', 'b.mov')), '(cccccccc-cccc-cccc-cccc-cccccccccccc,t)', 'who asked, and when');
SELECT is(public.s3_body_look_record(NULL, public.t123_key('12300000-0000-0000-0000-000000000b02', 'aaaa1230-0000-0000-0000-00000000000b', 'b.mov'), 'cccccccc-cccc-cccc-cccc-cccccccccccc'), false, 'no company, no look');
SELECT is(public.s3_body_look_record('11111111-1111-1111-1111-111111111111', public.t123_key('12300000-0000-0000-0000-000000000b02', 'aaaa1230-0000-0000-0000-00000000000b', 'b.mov'), NULL), false, 'nobody asking, no look');
SELECT is(public.s3_body_look_record('11111111-1111-1111-1111-111111111111', 'somewhere/else.mov', 'cccccccc-cccc-cccc-cccc-cccccccccccc'), false, 'a key that is not a file''s shape');
SELECT is(public.s3_body_look_record('11111111-1111-1111-1111-111111111111', 'projects/aaaa1230-0000-0000-0000-00000000000b/too-shallow.mov', 'cccccccc-cccc-cccc-cccc-cccccccccccc'), false, 'under a real project, too shallow');
SELECT is(public.s3_body_look_record('11111111-1111-1111-1111-111111111111', 'projects/aaaa1230-0000-0000-0000-00000000000b/files/x/a b.mov', 'cccccccc-cccc-cccc-cccc-cccccccccccc'), false, 'under a real project, with a character no key holds');
SELECT is(public.s3_body_look_record('11111111-1111-1111-1111-111111111111', NULL, 'cccccccc-cccc-cccc-cccc-cccccccccccc'), false, 'no key at all');
SELECT is(public.s3_body_look_record('11111111-1111-1111-1111-111111111111', 'projects/aaaa1230-0000-0000-0000-0000000000ff/files/x/y.mov', 'cccccccc-cccc-cccc-cccc-cccccccccccc'), false, 'a project that is not there');
SELECT is(public.s3_body_look_record('11111111-1111-1111-1111-111111111111', 'projects/aaaa1230-0000-0000-0000-00000000000e/files/x/y.mov', 'cccccccc-cccc-cccc-cccc-cccccccccccc'), false, 'a project in the bin');
SELECT is(public.s3_body_look_record('22222222-2222-2222-2222-222222222222', 'projects/aaaa1230-0000-0000-0000-00000000000b/files/x/y.mov', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), false, 'another company''s project');
SELECT is(public.s3_body_look_record('11111111-1111-1111-1111-111111111111', 'projects/aaaa1230-0000-0000-0000-00000000000b/files/x/y.mov', 'ffffffff-ffff-ffff-ffff-ffffffffffff'), false, 'a person who has left');
SELECT is(public.s3_body_look_record('11111111-1111-1111-1111-111111111111', 'projects/aaaa1230-0000-0000-0000-00000000000b/files/x/y.mov', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), false, 'a person of another company');
UPDATE public.workspace_storage SET mode = 'central' WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
SELECT is(public.s3_body_look_record('11111111-1111-1111-1111-111111111111', 'projects/aaaa1230-0000-0000-0000-00000000000b/files/x/y.mov', 'cccccccc-cccc-cccc-cccc-cccccccccccc'), false, 'a company on Petal''s storage now has no bucket to have looked in');
UPDATE public.workspace_storage SET mode = 'byos' WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
SELECT is((SELECT count(*)::int FROM rabbit_private.s3_body_looks), 1, 'and none of those wrote anything');
-- A second look at one key is one row, the latest.
UPDATE rabbit_private.s3_body_looks SET seen_at = now() - interval '1 hour', seen_by = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', bucket_mark = 'old';
SELECT is(public.s3_body_look_record('11111111-1111-1111-1111-111111111111', public.t123_key('12300000-0000-0000-0000-000000000b01', 'aaaa1230-0000-0000-0000-00000000000b', 'b.mov'), 'cccccccc-cccc-cccc-cccc-cccccccccccc'), true, 'a second look');
SELECT is((SELECT array_agg(row(seen_by, seen_at = now(), bucket_mark = rabbit_private.s3_bucket_mark('11111111-1111-1111-1111-111111111111'))::text) FROM rabbit_private.s3_body_looks), ARRAY['(cccccccc-cccc-cccc-cccc-cccccccccccc,t,t)'], 'is the one row, the latest');
DELETE FROM rabbit_private.s3_body_looks;

-- ── C. By association: the key stays, the row answers ────────────────────────────────────
SELECT public.t123_a();
SELECT public.t123_s3('12300000-0000-0000-0000-000000000c01', 'aaaa1230-0000-0000-0000-00000000000a', 'plain.mov', true);
SET LOCAL ROLE authenticated;
SELECT public.t123_r();
SELECT is(public.can_presign_object('projects/aaaa1230-0000-0000-0000-00000000000a/files/12300000-0000-0000-0000-000000000c01/plain.mov', 'get'), true, 'CONTROL: a reader of the source may read it before the move');
SELECT public.t123_c();
SELECT is(public.t123_m(ARRAY['12300000-0000-0000-0000-000000000c01'::uuid], 'aaaa1230-0000-0000-0000-00000000000b', true) -> 'items' -> 0 ->> 'how', 'metadata', 'the plan: by association, no copy');
INSERT INTO t123_ret SELECT 'c1', public.t123_m(ARRAY['12300000-0000-0000-0000-000000000c01'::uuid], 'aaaa1230-0000-0000-0000-00000000000b');
SELECT is(public.t123_v('c1') ->> 'moved', '1', 'a file in the bucket moves between projects');
RESET ROLE;
SELECT is((SELECT row(project_id, storage_provider, storage_path, thumbnail_url)::text FROM public.files WHERE id = '12300000-0000-0000-0000-000000000c01'),
  '(aaaa1230-0000-0000-0000-00000000000b,s3,projects/aaaa1230-0000-0000-0000-00000000000a/files/12300000-0000-0000-0000-000000000c01/plain.mov,projects/aaaa1230-0000-0000-0000-00000000000a/files/12300000-0000-0000-0000-000000000c01/plain.mov.jpg)', 'the row follows, and the key and its picture stay');
SELECT is((SELECT count(*)::int FROM public.storage_gc_queue WHERE file_id = '12300000-0000-0000-0000-000000000c01'), 0, 'and nothing is queued');
SELECT is((SELECT items -> 0 ->> 'to_provider' FROM public.file_moves WHERE id = (public.t123_v('c1') ->> 'move_id')::uuid), 's3', 'the journal says so');
SET LOCAL ROLE authenticated;
SELECT public.t123_r();
SELECT is(public.can_presign_object('projects/aaaa1230-0000-0000-0000-00000000000a/files/12300000-0000-0000-0000-000000000c01/plain.mov', 'get'), false, 'a source-only reader is denied a signed URL');
SELECT is(public.can_presign_object('projects/aaaa1230-0000-0000-0000-00000000000a/files/12300000-0000-0000-0000-000000000c01/plain.mov', 'head'), false, 'and a look at it');
SELECT is(public.can_presign_object('projects/aaaa1230-0000-0000-0000-00000000000a/files/12300000-0000-0000-0000-000000000c01/plain.mov.jpg', 'get'), false, 'and its picture');
SELECT is((SELECT count(*)::int FROM public.files WHERE storage_path LIKE 'projects/aaaa1230-0000-0000-0000-00000000000a/files/12300000-0000-0000-0000-000000000c01/%'), 0, 'and storage-read-urls'' row read finds nothing to vouch for it');
SELECT public.t123_c();
SELECT is(public.can_presign_object('projects/aaaa1230-0000-0000-0000-00000000000a/files/12300000-0000-0000-0000-000000000c01/plain.mov', 'get'), true, 'a reader of the destination may read it, under the key the source named');
SELECT is((SELECT count(*)::int FROM public.files WHERE storage_path LIKE 'projects/aaaa1230-0000-0000-0000-00000000000a/files/12300000-0000-0000-0000-000000000c01/%'), 1, 'and the row read vouches for it');
SELECT is(public.can_presign_object('projects/aaaa1230-0000-0000-0000-00000000000a/files/12300000-0000-0000-0000-000000000c01/plain.mov', 'put'), false, 'no one writes over a key a row names');
SELECT is(public.can_presign_object('projects/aaaa1230-0000-0000-0000-00000000000a/files/12300000-0000-0000-0000-000000000c01/plain.mov', 'del'), false, 'or deletes it');
-- Someone else moved it here first, and this person's copy has no move to go with.
SELECT throws_ok(format($q$ SELECT public.t123_m(ARRAY['12300000-0000-0000-0000-000000000c01'::uuid], 'aaaa1230-0000-0000-0000-00000000000b', false, public.t123_body('12300000-0000-0000-0000-000000000c01', 's3', %L)) $q$,
    public.t123_key('12300000-0000-0000-0000-000000000c01', 'aaaa1230-0000-0000-0000-00000000000b', 'plain.mov')),
  'P0001', 'moth_move:plan_changed', 'a copy offered for a file already there is refused, so the client takes it back');
RESET ROLE;

-- ── D. A new copy in the bucket, only on a look ─────────────────────────────────────────
SELECT public.t123_a();
SELECT public.t123_s3('12300000-0000-0000-0000-000000000d01', 'aaaa1230-0000-0000-0000-00000000000c', 'hidden.mov', true);
SELECT public.t123_s3('12300000-0000-0000-0000-000000000d02', 'aaaa1230-0000-0000-0000-00000000000c', 'also.mov');
SET LOCAL ROLE authenticated;
SELECT public.t123_c();
INSERT INTO t123_ret SELECT 'dp', public.t123_m(ARRAY['12300000-0000-0000-0000-000000000d01'::uuid], 'aaaa1230-0000-0000-0000-00000000000d', true);
SELECT is(public.t123_v('dp') -> 'items' -> 0 ->> 'how', 'rehome', 'a key naming a private project needs a copy');
SELECT is(public.t123_v('dp') -> 'items' -> 0 ->> 'to_provider', 's3', 'and the plan says the bucket');
SELECT ok(public.t123_v('dp') -> 'items' -> 0 ->> 'to_path' LIKE 'projects/aaaa1230-0000-0000-0000-00000000000d/files/12300000-0000-0000-0000-000000000d01/%-hidden.mov', 'under the destination, this file, this name');
SELECT throws_ok($$ SELECT public.t123_m(ARRAY['12300000-0000-0000-0000-000000000d01'::uuid], 'aaaa1230-0000-0000-0000-00000000000d') $$, 'P0001', 'moth_move:needs_copy', 'no copy offered');
SELECT throws_ok(format($q$ SELECT public.t123_m(ARRAY['12300000-0000-0000-0000-000000000d01'::uuid], 'aaaa1230-0000-0000-0000-00000000000d', false, public.t123_body('12300000-0000-0000-0000-000000000d01', 's3', %L)) $q$,
    public.t123_key('12300000-0000-0000-0000-000000000d01', 'aaaa1230-0000-0000-0000-00000000000d', 'hidden.mov')),
  'P0001', 'moth_move:copy_not_seen', 'a copy nobody has looked at is taken on nobody''s word');
SELECT is(public.t123_detail(format($q$ SELECT public.t123_m(ARRAY['12300000-0000-0000-0000-000000000d01'::uuid], 'aaaa1230-0000-0000-0000-00000000000d', false, public.t123_body('12300000-0000-0000-0000-000000000d01', 's3', %L)) $q$,
    public.t123_key('12300000-0000-0000-0000-000000000d01', 'aaaa1230-0000-0000-0000-00000000000d', 'hidden.mov'))),
  'The new copy could not be found in your company''s bucket, so nothing moved.', 'in those words');
RESET ROLE;
SELECT is((SELECT row(project_id, storage_path)::text FROM public.files WHERE id = '12300000-0000-0000-0000-000000000d01'),
  '(aaaa1230-0000-0000-0000-00000000000c,projects/aaaa1230-0000-0000-0000-00000000000c/files/12300000-0000-0000-0000-000000000d01/hidden.mov)', 'the file stays as it was');
SELECT is((SELECT count(*)::int FROM public.storage_gc_queue WHERE file_id = '12300000-0000-0000-0000-000000000d01'), 0, 'its only body not queued');
-- A look at another key, at the right key in another company, and an old look say nothing.
SELECT public.s3_body_look_record('11111111-1111-1111-1111-111111111111', public.t123_key('12300000-0000-0000-0000-000000000d01', 'aaaa1230-0000-0000-0000-00000000000d', 'other.mov'), 'cccccccc-cccc-cccc-cccc-cccccccccccc');
SELECT public.t123_put_look('22222222-2222-2222-2222-222222222222', public.t123_key('12300000-0000-0000-0000-000000000d01', 'aaaa1230-0000-0000-0000-00000000000d', 'hidden.mov'), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SET LOCAL ROLE authenticated;
SELECT public.t123_c();
SELECT throws_ok(format($q$ SELECT public.t123_m(ARRAY['12300000-0000-0000-0000-000000000d01'::uuid], 'aaaa1230-0000-0000-0000-00000000000d', false, public.t123_body('12300000-0000-0000-0000-000000000d01', 's3', %L)) $q$,
    public.t123_key('12300000-0000-0000-0000-000000000d01', 'aaaa1230-0000-0000-0000-00000000000d', 'hidden.mov')),
  'P0001', 'moth_move:copy_not_seen', 'a look at another key, or by another company, says nothing');
RESET ROLE;
DELETE FROM rabbit_private.s3_body_looks;
SELECT public.t123_put_look('11111111-1111-1111-1111-111111111111', public.t123_key('12300000-0000-0000-0000-000000000d01', 'aaaa1230-0000-0000-0000-00000000000d', 'hidden.mov'), 'cccccccc-cccc-cccc-cccc-cccccccccccc', now() - interval '1 day');
SET LOCAL ROLE authenticated;
SELECT public.t123_c();
SELECT throws_ok(format($q$ SELECT public.t123_m(ARRAY['12300000-0000-0000-0000-000000000d01'::uuid], 'aaaa1230-0000-0000-0000-00000000000d', false, public.t123_body('12300000-0000-0000-0000-000000000d01', 's3', %L)) $q$,
    public.t123_key('12300000-0000-0000-0000-000000000d01', 'aaaa1230-0000-0000-0000-00000000000d', 'hidden.mov')),
  'P0001', 'moth_move:copy_not_seen', 'a look a day old says nothing');
RESET ROLE;
UPDATE rabbit_private.s3_body_looks SET seen_at = now() - interval '23 hours 59 minutes';
UPDATE public.workspace_storage SET provider_config = provider_config || '{"bucket":"moved"}'::jsonb WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL ROLE authenticated;
SELECT public.t123_c();
SELECT throws_ok(format($q$ SELECT public.t123_m(ARRAY['12300000-0000-0000-0000-000000000d01'::uuid], 'aaaa1230-0000-0000-0000-00000000000d', false, public.t123_body('12300000-0000-0000-0000-000000000d01', 's3', %L)) $q$,
    public.t123_key('12300000-0000-0000-0000-000000000d01', 'aaaa1230-0000-0000-0000-00000000000d', 'hidden.mov')),
  'P0001', 'moth_move:copy_not_seen', 'a look says nothing once the company''s bucket has changed');
RESET ROLE;
UPDATE public.workspace_storage SET provider_config = '{"region":"r","bucket":"b","accessKeyId":"A"}'::jsonb WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
UPDATE public.workspace_storage SET provider_config = provider_config || '{"endpoint":"https://elsewhere.example.com"}'::jsonb WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL ROLE authenticated;
SELECT public.t123_c();
SELECT throws_ok(format($q$ SELECT public.t123_m(ARRAY['12300000-0000-0000-0000-000000000d01'::uuid], 'aaaa1230-0000-0000-0000-00000000000d', false, public.t123_body('12300000-0000-0000-0000-000000000d01', 's3', %L)) $q$,
    public.t123_key('12300000-0000-0000-0000-000000000d01', 'aaaa1230-0000-0000-0000-00000000000d', 'hidden.mov')),
  'P0001', 'moth_move:copy_not_seen', 'a look says nothing once the company''s endpoint has changed');
RESET ROLE;
UPDATE public.workspace_storage SET provider_config = '{"region":"r","bucket":"b","accessKeyId":"A"}'::jsonb WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
UPDATE public.workspace_storage SET provider_config = provider_config || '{"prefix":"somewhere"}'::jsonb WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL ROLE authenticated;
SELECT public.t123_c();
SELECT throws_ok(format($q$ SELECT public.t123_m(ARRAY['12300000-0000-0000-0000-000000000d01'::uuid], 'aaaa1230-0000-0000-0000-00000000000d', false, public.t123_body('12300000-0000-0000-0000-000000000d01', 's3', %L)) $q$,
    public.t123_key('12300000-0000-0000-0000-000000000d01', 'aaaa1230-0000-0000-0000-00000000000d', 'hidden.mov')),
  'P0001', 'moth_move:copy_not_seen', 'a look says nothing once the company''s prefix has changed');
RESET ROLE;
UPDATE public.workspace_storage SET provider_config = '{"region":"r","bucket":"b","accessKeyId":"A"}'::jsonb WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
-- A batch that fails on its second file spends nothing.
SET LOCAL ROLE authenticated;
SELECT public.t123_c();
SELECT throws_ok(format($q$ SELECT public.t123_m(ARRAY['12300000-0000-0000-0000-000000000d01'::uuid, '12300000-0000-0000-0000-000000000d02'::uuid], 'aaaa1230-0000-0000-0000-00000000000d', false,
      public.t123_body('12300000-0000-0000-0000-000000000d01', 's3', %L) || public.t123_body('12300000-0000-0000-0000-000000000d02', 's3', %L)) $q$,
    public.t123_key('12300000-0000-0000-0000-000000000d01', 'aaaa1230-0000-0000-0000-00000000000d', 'hidden.mov'),
    public.t123_key('12300000-0000-0000-0000-000000000d02', 'aaaa1230-0000-0000-0000-00000000000d', 'also.mov')),
  'P0001', 'moth_move:copy_not_seen', 'a batch with one copy unseen is refused');
SELECT is(public.t123_looks(public.t123_key('12300000-0000-0000-0000-000000000d01', 'aaaa1230-0000-0000-0000-00000000000d', 'hidden.mov')), 1, 'and the other file''s look is not spent');
-- With a look, but not a key the move can use.
SELECT throws_ok(format($q$ SELECT public.t123_m(ARRAY['12300000-0000-0000-0000-000000000d01'::uuid], 'aaaa1230-0000-0000-0000-00000000000d', false, public.t123_body('12300000-0000-0000-0000-000000000d01', 's3', %L, 'projects/aaaa1230-0000-0000-0000-00000000000d/files/x/elsewhere.jpg')) $q$,
    public.t123_key('12300000-0000-0000-0000-000000000d01', 'aaaa1230-0000-0000-0000-00000000000d', 'hidden.mov')),
  'P0001', 'moth_move:copy_refused', 'a picture beside no copy is refused, whatever the look said');
-- The move.
INSERT INTO t123_ret SELECT 'd1', public.t123_m(ARRAY['12300000-0000-0000-0000-000000000d01'::uuid], 'aaaa1230-0000-0000-0000-00000000000d', false,
  public.t123_body('12300000-0000-0000-0000-000000000d01', 's3', public.t123_key('12300000-0000-0000-0000-000000000d01', 'aaaa1230-0000-0000-0000-00000000000d', 'hidden.mov'),
    public.t123_key('12300000-0000-0000-0000-000000000d01', 'aaaa1230-0000-0000-0000-00000000000d', 'hidden.mov') || '.jpg'));
SELECT is(public.t123_v('d1') ->> 'moved', '1', 'with a look at the new copy, it moves');
SELECT is(public.t123_looks(public.t123_key('12300000-0000-0000-0000-000000000d01', 'aaaa1230-0000-0000-0000-00000000000d', 'hidden.mov')), 0, 'and the look is spent');
RESET ROLE;
SELECT is((SELECT row(project_id, storage_provider, storage_path)::text FROM public.files WHERE id = '12300000-0000-0000-0000-000000000d01'),
  '(aaaa1230-0000-0000-0000-00000000000d,s3,projects/aaaa1230-0000-0000-0000-00000000000d/files/12300000-0000-0000-0000-000000000d01/1700000000000-hidden.mov)', 'the row names the new copy');
SELECT is((SELECT array_agg(row(bucket_id, provider, kind, object_path)::text ORDER BY kind) FROM public.storage_gc_queue WHERE file_id = '12300000-0000-0000-0000-000000000d01'),
  ARRAY['(byo-s3,s3,body,projects/aaaa1230-0000-0000-0000-00000000000c/files/12300000-0000-0000-0000-000000000d01/hidden.mov)',
        '(byo-s3,s3,thumbnail,projects/aaaa1230-0000-0000-0000-00000000000c/files/12300000-0000-0000-0000-000000000d01/hidden.mov.jpg)'], 'and the old copy and picture are queued from the bucket');

-- ── E. The plan's provider, at the commit ───────────────────────────────────────────────
SELECT public.t123_a();
SELECT public.t123_petal('12300000-0000-0000-0000-000000000e01', 'aaaa1230-0000-0000-0000-00000000000c', 'plan.mov');
SELECT public.s3_body_look_record('11111111-1111-1111-1111-111111111111', public.t123_key('12300000-0000-0000-0000-000000000e01', 'aaaa1230-0000-0000-0000-00000000000d', 'plan.mov'), 'cccccccc-cccc-cccc-cccc-cccccccccccc');
INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('rabbit-files', public.t123_key('12300000-0000-0000-0000-000000000e01', 'aaaa1230-0000-0000-0000-00000000000d', 'plan.mov'), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SET LOCAL ROLE authenticated;
SELECT public.t123_c();
-- On the bucket now, whatever the copy says.
SELECT throws_ok(format($q$ SELECT public.t123_m(ARRAY['12300000-0000-0000-0000-000000000e01'::uuid], 'aaaa1230-0000-0000-0000-00000000000d', false, public.t123_body('12300000-0000-0000-0000-000000000e01', 'supabase', %L)) $q$,
    public.t123_key('12300000-0000-0000-0000-000000000e01', 'aaaa1230-0000-0000-0000-00000000000d', 'plan.mov')),
  'P0001', 'moth_move:plan_changed', 'a copy planned for Petal''s storage, on a company now on its bucket, even with a look');
SELECT throws_ok(format($q$ SELECT public.t123_m(ARRAY['12300000-0000-0000-0000-000000000e01'::uuid], 'aaaa1230-0000-0000-0000-00000000000d', false, jsonb_build_array(jsonb_build_object('file_id', '12300000-0000-0000-0000-000000000e01', 'path', %L))) $q$,
    public.t123_key('12300000-0000-0000-0000-000000000e01', 'aaaa1230-0000-0000-0000-00000000000d', 'plan.mov')),
  'P0001', 'moth_move:plan_changed', 'a copy that says nothing of where it went');
RESET ROLE;
-- Back on Petal's storage.
UPDATE public.workspace_storage SET mode = 'central' WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL ROLE authenticated;
SELECT public.t123_c();
SELECT throws_ok(format($q$ SELECT public.t123_m(ARRAY['12300000-0000-0000-0000-000000000e01'::uuid], 'aaaa1230-0000-0000-0000-00000000000d', false, public.t123_body('12300000-0000-0000-0000-000000000e01', 's3', %L)) $q$,
    public.t123_key('12300000-0000-0000-0000-000000000e01', 'aaaa1230-0000-0000-0000-00000000000d', 'plan.mov')),
  'P0001', 'moth_move:plan_changed', 'a copy planned for the bucket, on a company now on Petal''s storage');
INSERT INTO t123_ret SELECT 'e1', public.t123_m(ARRAY['12300000-0000-0000-0000-000000000e01'::uuid], 'aaaa1230-0000-0000-0000-00000000000d', false,
  public.t123_body('12300000-0000-0000-0000-000000000e01', 'supabase', public.t123_key('12300000-0000-0000-0000-000000000e01', 'aaaa1230-0000-0000-0000-00000000000d', 'plan.mov')));
SELECT is(public.t123_v('e1') ->> 'moved', '1', 'CONTROL: on Petal''s storage, as planned, a copy there moves with no look');
SELECT is(public.t123_looks(public.t123_key('12300000-0000-0000-0000-000000000e01', 'aaaa1230-0000-0000-0000-00000000000d', 'plan.mov')), 1, 'and spends none');
RESET ROLE;
SELECT is((SELECT row(storage_provider, storage_path)::text FROM public.files WHERE id = '12300000-0000-0000-0000-000000000e01'),
  '(supabase,projects/aaaa1230-0000-0000-0000-00000000000d/files/12300000-0000-0000-0000-000000000e01/1700000000000-plan.mov)', 'the row says Petal''s storage');
DELETE FROM rabbit_private.s3_body_looks;
UPDATE public.workspace_storage SET mode = 'byos' WHERE workspace_id = '11111111-1111-1111-1111-111111111111';

-- ── F. Into the bucket from Petal's storage, from a computer, and a leaver's ───────────────
SELECT public.t123_a();
SELECT public.t123_petal('12300000-0000-0000-0000-000000000f01', 'aaaa1230-0000-0000-0000-00000000000c', 'petal.mov');
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path) VALUES
  ('12300000-0000-0000-0000-000000000f02', 'aaaa1230-0000-0000-0000-00000000000a', 'desk.mov', 'local_server', 'projects/aaaa1230-0000-0000-0000-00000000000a/files/12300000-0000-0000-0000-000000000f02/desk.mov');
SELECT public.t123_petal('12300000-0000-0000-0000-000000000f03', 'aaaa1230-0000-0000-0000-0000000000f0', 'left.mov');
SELECT public.t123_s3('12300000-0000-0000-0000-000000000f05', 'aaaa1230-0000-0000-0000-0000000000f0', 'bucketed.mov');
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial) VALUES
  ('12300000-0000-0000-0000-000000000f04', 'aaaa1230-0000-0000-0000-00000000000a', 'inv.pdf', 'supabase', 'projects/aaaa1230-0000-0000-0000-00000000000a/invoices/a/inv.pdf', true);
SET LOCAL ROLE authenticated;
SELECT public.t123_c();
SELECT is(public.t123_m(ARRAY['12300000-0000-0000-0000-000000000f01'::uuid], 'aaaa1230-0000-0000-0000-00000000000d', true) -> 'items' -> 0 ->> 'to_provider', 's3', 'a Petal body that needs a copy goes to the company''s bucket');
SELECT throws_ok(format($q$ SELECT public.t123_m(ARRAY['12300000-0000-0000-0000-000000000f01'::uuid], 'aaaa1230-0000-0000-0000-00000000000d', false, public.t123_body('12300000-0000-0000-0000-000000000f01', 's3', %L)) $q$,
    public.t123_key('12300000-0000-0000-0000-000000000f01', 'aaaa1230-0000-0000-0000-00000000000d', 'petal.mov')),
  'P0001', 'moth_move:copy_not_seen', 'and needs a look too');
SELECT is(public.t123_m(ARRAY['12300000-0000-0000-0000-000000000f02'::uuid], 'aaaa1230-0000-0000-0000-00000000000d', true) -> 'items' -> 0 ->> 'how', 'copy_up', 'a body on a computer is a copy up');
SELECT throws_ok($$ SELECT public.t123_m(ARRAY['12300000-0000-0000-0000-000000000f04'::uuid], 'aaaa1230-0000-0000-0000-00000000000d', true) $$, 'P0001', 'moth_move:not_found', 'money stays out of a move, so out of the bucket');
RESET ROLE;
SELECT public.s3_body_look_record('11111111-1111-1111-1111-111111111111', public.t123_key('12300000-0000-0000-0000-000000000f01', 'aaaa1230-0000-0000-0000-00000000000d', 'petal.mov'), 'cccccccc-cccc-cccc-cccc-cccccccccccc');
SELECT public.s3_body_look_record('11111111-1111-1111-1111-111111111111', public.t123_key('12300000-0000-0000-0000-000000000f02', 'aaaa1230-0000-0000-0000-00000000000d', 'desk.mov'), 'cccccccc-cccc-cccc-cccc-cccccccccccc');
SET LOCAL ROLE authenticated;
SELECT public.t123_c();
INSERT INTO t123_ret SELECT 'f1', public.t123_m(ARRAY['12300000-0000-0000-0000-000000000f01'::uuid, '12300000-0000-0000-0000-000000000f02'::uuid], 'aaaa1230-0000-0000-0000-00000000000d', false,
  public.t123_body('12300000-0000-0000-0000-000000000f01', 's3', public.t123_key('12300000-0000-0000-0000-000000000f01', 'aaaa1230-0000-0000-0000-00000000000d', 'petal.mov'))
  || public.t123_body('12300000-0000-0000-0000-000000000f02', 's3', public.t123_key('12300000-0000-0000-0000-000000000f02', 'aaaa1230-0000-0000-0000-00000000000d', 'desk.mov')));
SELECT is(public.t123_v('f1') ->> 'moved', '2', 'on their looks, both move');
RESET ROLE;
SELECT is((SELECT array_agg(storage_provider::text) FROM public.files WHERE id IN ('12300000-0000-0000-0000-000000000f01', '12300000-0000-0000-0000-000000000f02')), ARRAY['s3', 's3'], 'and both rows say the bucket');
SELECT is((SELECT array_agg(row(bucket_id, provider, kind)::text) FROM public.storage_gc_queue WHERE file_id = '12300000-0000-0000-0000-000000000f01'), ARRAY['(rabbit-files,supabase,body)'], 'Petal''s old copy is queued from Petal''s storage');
SELECT is((SELECT count(*)::int FROM public.storage_gc_queue WHERE file_id = '12300000-0000-0000-0000-000000000f02'), 0, 'and a computer''s stays with the computer');
-- A former member's personal file, for an admin: the same move, the same look.
SET LOCAL ROLE authenticated;
SELECT public.t123_a();
SELECT is((SELECT array_agg(name) FROM public.moth_leaver_files('aaaa1230-0000-0000-0000-0000000000f0')), ARRAY['left.mov'], 'the list offers a leaver''s Petal body on a company with its own bucket, and not one already in the bucket');
SELECT is((public.moth_move_leaver_files(ARRAY['12300000-0000-0000-0000-000000000f03'::uuid], 'aaaa1230-0000-0000-0000-00000000000d', NULL, true, NULL)) -> 'items' -> 0 ->> 'to_provider', 's3', 'a leaver''s Petal body is copied to the company''s bucket');
SELECT throws_ok(format($q$ SELECT public.moth_move_leaver_files(ARRAY['12300000-0000-0000-0000-000000000f03'::uuid], 'aaaa1230-0000-0000-0000-00000000000d', NULL, false, public.t123_body('12300000-0000-0000-0000-000000000f03', 's3', %L)) $q$,
    public.t123_key('12300000-0000-0000-0000-000000000f03', 'aaaa1230-0000-0000-0000-00000000000d', 'left.mov')),
  'P0001', 'moth_move:copy_not_seen', 'and an admin''s move needs a look like anyone''s');
RESET ROLE;
SELECT public.s3_body_look_record('11111111-1111-1111-1111-111111111111', public.t123_key('12300000-0000-0000-0000-000000000f03', 'aaaa1230-0000-0000-0000-00000000000d', 'left.mov'), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SET LOCAL ROLE authenticated;
SELECT public.t123_a();
SELECT is(public.moth_move_leaver_files(ARRAY['12300000-0000-0000-0000-000000000f03'::uuid], 'aaaa1230-0000-0000-0000-00000000000d', NULL, false, public.t123_body('12300000-0000-0000-0000-000000000f03', 's3', public.t123_key('12300000-0000-0000-0000-000000000f03', 'aaaa1230-0000-0000-0000-00000000000d', 'left.mov'))) ->> 'moved', '1', 'with one, it moves');
RESET ROLE;

-- ── G. Undo ───────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t123_c();
-- A copy made under a public project goes back by association: nothing about it is hidden.
INSERT INTO t123_ret SELECT 'g0', public.moth_undo_move((public.t123_v('d1') ->> 'move_id')::uuid);
SELECT is(public.t123_v('g0') ->> 'moved', '1', 'a move that made a copy under a public project is undone by association');
SELECT is(public.t123_looks(public.t123_key('12300000-0000-0000-0000-000000000d01', 'aaaa1230-0000-0000-0000-00000000000d', 'hidden.mov')), 0, 'and needs no look: the key stays');
RESET ROLE;
SELECT is((SELECT row(project_id, storage_path)::text FROM public.files WHERE id = '12300000-0000-0000-0000-000000000d01'),
  '(aaaa1230-0000-0000-0000-00000000000c,projects/aaaa1230-0000-0000-0000-00000000000d/files/12300000-0000-0000-0000-000000000d01/1700000000000-hidden.mov)', 'the row is back, on the new copy');
-- A copy made under a private project cannot go back by association: no hidden id leaves it.
SELECT public.t123_a();
SELECT public.t123_s3('12300000-0000-0000-0000-000000000d03', 'aaaa1230-0000-0000-0000-00000000000c', 'private.mov');
SELECT public.s3_body_look_record('11111111-1111-1111-1111-111111111111', public.t123_key('12300000-0000-0000-0000-000000000d03', 'aaaa1230-0000-0000-0000-00000000000b', 'private.mov'), 'cccccccc-cccc-cccc-cccc-cccccccccccc');
SET LOCAL ROLE authenticated;
SELECT public.t123_c();
INSERT INTO t123_ret SELECT 'd3', public.t123_m(ARRAY['12300000-0000-0000-0000-000000000d03'::uuid], 'aaaa1230-0000-0000-0000-00000000000b', false,
  public.t123_body('12300000-0000-0000-0000-000000000d03', 's3', public.t123_key('12300000-0000-0000-0000-000000000d03', 'aaaa1230-0000-0000-0000-00000000000b', 'private.mov')));
SELECT throws_ok(format($q$ SELECT public.moth_undo_move(%L) $q$, public.t123_v('d3') ->> 'move_id'), 'P0001', 'moth_move:needs_copy', 'a copy under a private project needs a fresh one to go back, not the undo');
INSERT INTO t123_ret SELECT 'g1', public.moth_undo_move((public.t123_v('c1') ->> 'move_id')::uuid);
SELECT is(public.t123_v('g1') ->> 'moved', '1', 'a move by association is undone');
RESET ROLE;
SELECT is((SELECT row(project_id, storage_provider, storage_path)::text FROM public.files WHERE id = '12300000-0000-0000-0000-000000000c01'),
  '(aaaa1230-0000-0000-0000-00000000000a,s3,projects/aaaa1230-0000-0000-0000-00000000000a/files/12300000-0000-0000-0000-000000000c01/plain.mov)', 'and the row is back, on the same key');
SET LOCAL ROLE authenticated;
SELECT public.t123_r();
SELECT is(public.can_presign_object('projects/aaaa1230-0000-0000-0000-00000000000a/files/12300000-0000-0000-0000-000000000c01/plain.mov', 'get'), true, 'and the source''s reader may read it again');
RESET ROLE;

-- ── H. The switch, turned off again, still stands ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION rabbit_private.s3_body_moves_on()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$ SELECT false; $$;
SELECT public.t123_a();
SELECT public.t123_s3('12300000-0000-0000-0000-000000000901', 'aaaa1230-0000-0000-0000-00000000000a', 'off.mov');
SELECT public.t123_petal('12300000-0000-0000-0000-000000000902', 'aaaa1230-0000-0000-0000-00000000000c', 'offpetal.mov');
SELECT public.t123_petal('12300000-0000-0000-0000-000000000903', 'aaaa1230-0000-0000-0000-0000000000f0', 'offleft.mov');
SET LOCAL ROLE authenticated;
SELECT public.t123_c();
SELECT throws_ok($$ SELECT public.t123_m(ARRAY['12300000-0000-0000-0000-000000000901'::uuid], 'aaaa1230-0000-0000-0000-00000000000b') $$, 'P0001', 'moth_move:s3_moves_off', 'a file in the bucket does not move');
SELECT throws_ok($$ SELECT public.t123_m(ARRAY['12300000-0000-0000-0000-000000000902'::uuid], 'aaaa1230-0000-0000-0000-00000000000d', true) $$, 'P0001', 'moth_move:s3_moves_off', 'and nothing new goes in');
SELECT public.t123_a();
SELECT is((SELECT count(*)::int FROM public.moth_leaver_files('aaaa1230-0000-0000-0000-0000000000f0')), 0, 'and a leaver''s list offers nothing');
SELECT public.t123_c();
SELECT is(public.can_presign_object(public.t123_key('12300000-0000-0000-0000-000000000d01', 'aaaa1230-0000-0000-0000-00000000000d', 'hidden.mov'), 'get'), true, 'and a file moved while it was on stays readable');
RESET ROLE;
CREATE OR REPLACE FUNCTION rabbit_private.s3_body_moves_on()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$ SELECT true; $$;

-- ── I. The nightly sweep: what a look saw and nobody moved ───────────────────────────────────
DELETE FROM rabbit_private.s3_body_looks;
SELECT public.t123_put_look('11111111-1111-1111-1111-111111111111', 'projects/aaaa1230-0000-0000-0000-00000000000b/files/i/at-the-day.mov', 'cccccccc-cccc-cccc-cccc-cccccccccccc', now() - interval '1 day');
SELECT public.t123_put_look('11111111-1111-1111-1111-111111111111', 'projects/aaaa1230-0000-0000-0000-00000000000b/files/i/within-the-day.mov', 'cccccccc-cccc-cccc-cccc-cccccccccccc', now() - interval '23 hours 59 minutes');
SELECT public.t123_put_look('22222222-2222-2222-2222-222222222222', 'projects/other/files/i/theirs.mov', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', now() - interval '2 days');
-- A row names this key, and a row names this picture: neither is queued, whatever the look says.
SELECT public.t123_put_look('11111111-1111-1111-1111-111111111111', 'projects/aaaa1230-0000-0000-0000-00000000000a/files/12300000-0000-0000-0000-000000000c01/plain.mov', 'cccccccc-cccc-cccc-cccc-cccccccccccc', now() - interval '2 days');
SELECT is(rabbit_private.s3_body_looks_sweep(), 3, 'the sweep takes the three past the day');
SELECT is((SELECT array_agg(object_path) FROM rabbit_private.s3_body_looks), ARRAY['projects/aaaa1230-0000-0000-0000-00000000000b/files/i/within-the-day.mov'], 'and leaves the one within it');
SELECT is((SELECT array_agg(row(bucket_id, provider, kind, reason, status, workspace_id, file_id)::text ORDER BY kind) FROM public.storage_gc_queue WHERE object_path LIKE 'projects/aaaa1230-0000-0000-0000-00000000000b/files/i/at-the-day.mov%'),
  ARRAY['(byo-s3,s3,body,orphan-scan,pending,11111111-1111-1111-1111-111111111111,)', '(byo-s3,s3,thumbnail,orphan-scan,pending,11111111-1111-1111-1111-111111111111,)'], 'its copy and picture go to the drain, from the bucket');
SELECT is((SELECT array_agg(object_path ORDER BY object_path) FROM public.storage_gc_queue WHERE object_path LIKE 'projects/other/files/i/%' AND workspace_id = '22222222-2222-2222-2222-222222222222'),
  ARRAY['projects/other/files/i/theirs.mov', 'projects/other/files/i/theirs.mov.jpg'], 'each company''s from its own');
SELECT is((SELECT count(*)::int FROM public.storage_gc_queue WHERE object_path LIKE 'projects/aaaa1230-0000-0000-0000-00000000000a/files/12300000-0000-0000-0000-000000000c01/%'), 0, 'and what a row names is not queued');
SELECT is(rabbit_private.s3_body_looks_sweep(), 0, 'a second night finds nothing');
SET LOCAL ROLE authenticated;
SELECT public.t123_a();
SELECT throws_ok($$ SELECT rabbit_private.s3_body_looks_sweep() $$, '42501', NULL, 'an admin cannot run it');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
