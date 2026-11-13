-- =============================================================================
-- 139_per_row_work.sql — F7 (wave 2): the database's per-row work (0137).
--
-- A. The restatement: 188 policies ask has_active_membership once per statement, one is left per row on purpose
--    (auth_events_insert, which pins no company), and nothing else about them moved.
-- B. The plans: an InitPlan where there was a call per row, on a top-level policy, an EXISTS one, a write and
--    storage.objects. CONTROL: one policy put back to the per-row form shows up in both A's count and B's plan.
-- C. The answers did not change, shape by shape: another company, a person in two companies, a membership taken
--    away, the note whose pin sits above an OR, a parent row's EXISTS, a write.
-- D. The meter: the new body against 0115's, on planted keys of every spelling (upper case, braces, no hyphens, an
--    extra hyphen, an empty third segment, two segments, another root, a neighbouring prefix) and a moved copy with
--    its picture. CONTROLS: the live body with arm 1b or arm 2 taken out disagrees.
-- E. The indexes: six narrow ones gone, their wider ones valid; the two for ai-files serve the reads as PostgREST
--    sends them (values and the JSON key as parameters) under a custom plan, and, said as a test, not under a
--    generic one.
-- =============================================================================

BEGIN;
SELECT plan(50);

SELECT * FROM tests.rls_setup();

-- user_c is in both companies; user_d's membership of A was taken away.
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
SELECT u.id, u.email, crypt('testpw', gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
       'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()
  FROM (VALUES
    ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'user_c@test.local'),
    ('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, 'user_d@test.local')) u(id, email)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true),
  ('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c2', 'User C', true),
  ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'user', 'user_d', 'User D', false)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET is_active = EXCLUDED.is_active, app_role = EXCLUDED.app_role;

CREATE FUNCTION public.t139_as(p_user uuid, p_ws uuid, p_role text DEFAULT 'user')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_role))::text, true);
END;
$f$;
-- The plan's text, costs off.
CREATE FUNCTION public.t139_plan(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  r record;
  v text := '';
BEGIN
  FOR r IN EXECUTE 'EXPLAIN (COSTS OFF) ' || p_sql LOOP
    v := v || r."QUERY PLAN" || E'\n';
  END LOOP;
  RETURN v;
END;
$f$;
-- The policies that still call has_active_membership outside the sub-select: a call is 'has_active_membership(', a
-- sub-select ends 'AS has_active_membership)', whatever the search_path qualifies.
CREATE FUNCTION public.t139_per_row() RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT COALESCE(string_agg(p.n, ', ' ORDER BY p.n), '')
    FROM (SELECT schemaname || '.' || tablename || '.' || policyname AS n,
                 COALESCE(qual, '') || ' ' || COALESCE(with_check, '') AS t
            FROM pg_policies) p
   WHERE (length(p.t) - length(replace(p.t, 'has_active_membership(', ''))) / 22
       > (length(p.t) - length(replace(p.t, 'AS has_active_membership)', ''))) / 25
$f$;
-- How many rows an UPDATE reaches, as the caller.
CREATE FUNCTION public.t139_updated(p_task uuid) RETURNS int LANGUAGE plpgsql AS $f$
DECLARE
  n int;
BEGIN
  UPDATE public.tasks SET title = title || '.' WHERE id = p_task;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$f$;
GRANT EXECUTE ON FUNCTION public.t139_as(uuid, uuid, text), public.t139_plan(text), public.t139_updated(uuid) TO authenticated;

-- ── A. The restatement ─────────────────────────────────────────────────────────
-- 1
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE COALESCE(qual, '') || COALESCE(with_check, '') LIKE '%SELECT %has_active_membership(%current_workspace_id()) AS has_active_membership)%'),
  188,
  '188 policies ask has_active_membership once per statement, inside a sub-select');
-- 2
SELECT is(public.t139_per_row(), 'public.auth_events.auth_events_insert',
  'exactly one still asks per row: auth_events_insert');
-- 3
SELECT ok(
  (SELECT with_check LIKE '%(workspace_id IS NULL) OR %has_active_membership(workspace_id))%'
     FROM pg_policies WHERE schemaname = 'public' AND tablename = 'auth_events' AND policyname = 'auth_events_insert'),
  'auth_events_insert keeps its own text: a member may name a company only by membership of THAT company');
-- 4
SELECT ok(
  (SELECT qual LIKE '%(owner_id = auth.uid()) OR ((tier <> ''personal''::text) AND ( SELECT %has_active_membership(%current_workspace_id()) AS has_active_membership))%'
          AND qual LIKE '((workspace_id = %current_workspace_id()) AND (deleted_at IS NULL) AND %'
     FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notes' AND policyname = 'notes_select'),
  'notes_select: the pin at the outer AND, the owner arm, then the sub-select under the OR');
-- 5
SELECT is(
  (SELECT roles::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'network_share_checks' AND policyname = 'network_share_checks_select'),
  '{authenticated}',
  'ALTER POLICY left a policy''s roles alone (network_share_checks_select is TO authenticated)');
-- 6
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE permissive = 'RESTRICTIVE' AND COALESCE(qual, '') || COALESCE(with_check, '') LIKE '%has_active_membership(%'),
  0,
  'no RESTRICTIVE policy calls it (the quota policy is untouched)');
-- 7
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE COALESCE(qual, '') || COALESCE(with_check, '') LIKE '%has_active_membership(%'),
  189,
  '189 policies call it at all, as before');

-- ── B. The plans ───────────────────────────────────────────────────────────────
INSERT INTO public.tasks (id, project_id, workspace_id, title) VALUES
  ('aaaa1391-0000-4000-8000-000000000001', 'aaaa1111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'A task');
INSERT INTO public.rate_cards (id, workspace_id, name) VALUES
  ('aaaa1392-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'Rates');
INSERT INTO public.rate_card_entries (rate_card_id, role_label, role_slug) VALUES
  ('aaaa1392-0000-4000-8000-000000000001', 'Editor', 'editor');
INSERT INTO public.notes (id, workspace_id, owner_id, title, tier) VALUES
  ('aaaa1393-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'D''s own', 'personal'),
  ('aaaa1393-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Shared', 'shared');

SELECT public.t139_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'admin');
SET LOCAL ROLE authenticated;
-- 8
SELECT ok(strpos(public.t139_plan('SELECT id FROM public.projects'), 'InitPlan') > 0
          AND strpos(public.t139_plan('SELECT id FROM public.projects'), 'has_active_membership(') = 0,
  'a projects read: an InitPlan, and no call left in a filter');
-- 9
SELECT ok(strpos(public.t139_plan('SELECT id FROM public.rate_card_entries'), 'InitPlan') > 0
          AND strpos(public.t139_plan('SELECT id FROM public.rate_card_entries'), 'has_active_membership(') = 0,
  'a parent row''s EXISTS (rate_card_entries through rate_cards): an InitPlan');
-- 10
SELECT ok(strpos(public.t139_plan('UPDATE public.tasks SET title = title'), 'InitPlan') > 0
          AND strpos(public.t139_plan('UPDATE public.tasks SET title = title'), 'has_active_membership(') = 0,
  'a write, its USING and its CHECK and the projects hop: InitPlans only');
-- 11
SELECT ok(strpos(public.t139_plan('DELETE FROM storage.objects WHERE bucket_id = ''rabbit-files'''), 'InitPlan') > 0
          AND strpos(public.t139_plan('DELETE FROM storage.objects WHERE bucket_id = ''rabbit-files'''), 'has_active_membership(') = 0,
  'storage.objects (the bare form): an InitPlan');
RESET ROLE;

-- CONTROL: projects_select put back to 0013's per-row form. Both instruments see it; then it is restored.
ALTER POLICY projects_select ON public.projects
  USING (((deleted_at IS NULL) AND (workspace_id = public.current_workspace_id()) AND public.has_active_membership(workspace_id) AND ((NOT is_private) OR (created_by = auth.uid()) OR (public.current_app_role() = 'admin'::text))));
-- 12
SELECT is(public.t139_per_row(), 'public.auth_events.auth_events_insert, public.projects.projects_select',
  'CONTROL: the per-row form put back is counted');
SET LOCAL ROLE authenticated;
-- 13
SELECT ok(strpos(public.t139_plan('SELECT id FROM public.projects'), 'has_active_membership(workspace_id)') > 0,
  'CONTROL: and shows in the plan as a call per row');
RESET ROLE;
ALTER POLICY projects_select ON public.projects
  USING (((deleted_at IS NULL) AND (workspace_id = public.current_workspace_id()) AND (SELECT public.has_active_membership(public.current_workspace_id())) AND ((NOT is_private) OR (created_by = auth.uid()) OR (public.current_app_role() = 'admin'::text))));
-- 14
SELECT is(public.t139_per_row(), 'public.auth_events.auth_events_insert', 'restored');

-- ── C. The answers ────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
-- 15
SELECT is((SELECT count(*)::int FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000001'), 1,
  'a member reads their company''s project');
SELECT public.t139_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'admin');
-- 16
SELECT is((SELECT count(*)::int FROM public.projects), 0,
  'signed into a company they are not in, nothing');
SELECT public.t139_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222');
-- 17
SELECT is((SELECT string_agg(id::text, ',') FROM public.projects WHERE id IN ('aaaa1111-0000-0000-0000-000000000001', 'bbbb2222-0000-0000-0000-000000000001')),
  'bbbb2222-0000-0000-0000-000000000001',
  'a person in two companies reads the one they are signed into, not the other');
-- 18
SELECT is((SELECT count(*)::int FROM public.rate_card_entries), 0,
  'nor the other company''s rate card entries (the EXISTS shape)');
SELECT public.t139_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
-- 19
SELECT is((SELECT count(*)::int FROM public.projects), 0, 'a membership taken away reads no project');
-- 20
SELECT is((SELECT count(*)::int FROM public.rate_card_entries), 0, '...no rate card entry');
-- 21
SELECT is(public.t139_updated('aaaa1391-0000-4000-8000-000000000001'), 0, '...and changes no task');
-- 22
SELECT is((SELECT string_agg(title, ',' ORDER BY title) FROM public.notes), 'D''s own',
  '...but still reads their own personal note (the owner arm of notes_select), and not the shared one');
SELECT public.t139_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
-- 23
SELECT is((SELECT string_agg(title, ',' ORDER BY title) FROM public.notes), 'Shared',
  'an active member reads the shared note and not another person''s personal one');
SELECT public.t139_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'admin');
-- 24
SELECT is((SELECT count(*)::int FROM public.rate_card_entries), 1, 'the admin reads the entry through its card');
-- 25
SELECT is(public.t139_updated('aaaa1391-0000-4000-8000-000000000001'), 1, 'and changes the task');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- ── D. The meter ──────────────────────────────────────────────────────────────
-- 0115's body, verbatim, under a test name: the old meter beside the new.
CREATE FUNCTION public.t139_old_meter(ws UUID)
RETURNS BIGINT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(c.bytes), 0)::bigint
    FROM (
      SELECT COALESCE(public.rabbit_object_incoming_bytes(o.metadata), 0) AS bytes
        FROM storage.objects o
        JOIN public.projects p
          ON p.id = public.fn_try_uuid((storage.foldername(o.name))[2])
       WHERE o.bucket_id IN ('rabbit-files', 'rabbit-thumbnails')
         AND (storage.foldername(o.name))[1] = 'projects'
         AND p.workspace_id = ws
      UNION ALL
      SELECT COALESCE(public.rabbit_object_incoming_bytes(o.metadata), 0)
        FROM (
          SELECT 'rabbit-files'::text AS bucket, f.storage_path AS key
            FROM public.files f
           WHERE f.workspace_id = ws
             AND f.storage_provider = 'supabase'
             AND lower(split_part(f.storage_path, '/', 2)) <> f.project_id::text
          UNION
          SELECT 'rabbit-thumbnails'::text, f.thumbnail_url
            FROM public.files f
           WHERE f.workspace_id = ws
             AND f.storage_provider = 'supabase'
             AND lower(split_part(f.storage_path, '/', 2)) <> f.project_id::text
        ) m
        JOIN storage.objects o ON o.bucket_id = m.bucket AND o.name = m.key
       WHERE NOT EXISTS (SELECT 1 FROM public.projects p
                          WHERE p.id = public.fn_try_uuid((storage.foldername(o.name))[2]))
    ) c;
$$;
-- The LIVE body with one arm cut out, under another name: the controls.
CREATE FUNCTION public.t139_cut(p_name text, p_from text, p_to text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  s text := (SELECT prosrc FROM pg_proc WHERE oid = 'public.workspace_petal_committed_bytes(uuid)'::regprocedure);
  i int := strpos(s, p_from);
  j int := strpos(s, p_to);
BEGIN
  IF i = 0 OR j = 0 OR j <= i THEN
    RAISE EXCEPTION 't139_cut: % not found in the live body', p_from;
  END IF;
  EXECUTE format('CREATE FUNCTION public.%I(ws uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS %L',
                 p_name, substr(s, 1, i - 1) || substr(s, j));
END;
$f$;
SELECT public.t139_cut('t139_no_1b', '      -- 1b.', '      -- 2.');
SELECT public.t139_cut('t139_no_2', E'      UNION ALL\n      -- 2.', '    ) c;');

-- P1 and P2 are company A's, Q is B's; PURGED names no project any more.
INSERT INTO public.projects (id, workspace_id, title, created_by) VALUES
  ('aaaa1390-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'P1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('aaaa1390-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'P2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbb1390-0000-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'Q', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
INSERT INTO storage.objects (bucket_id, name, metadata) VALUES
  ('rabbit-files',      'projects/aaaa1390-0000-4000-8000-000000000001/a/b/1-x.bin',      '{"size": "1"}'),
  ('rabbit-thumbnails', 'projects/aaaa1390-0000-4000-8000-000000000001/x.jpg',            '{"size": "2"}'),
  ('rabbit-files',      'projects/AAAA1390-0000-4000-8000-000000000001/u.bin',            '{"size": "4"}'),
  ('rabbit-files',      'projects/{aaaa1390-0000-4000-8000-000000000001}/braces.bin',     '{"size": "8"}'),
  ('rabbit-files',      'projects/aaaa1390000040008000000000000001/nohyph.bin',           '{"size": "16"}'),
  ('rabbit-files',      'projects/aaaa-1390-0000-4000-8000-000000000001/extra.bin',       '{"size": "32"}'),
  ('rabbit-files',      'projects/aaaa1390-0000-4000-8000-000000000001/',                 '{"size": "64"}'),
  ('rabbit-files',      'projects/aaaa1390-0000-4000-8000-000000000001',                  '{"size": "128"}'),
  ('rabbit-files',      'projects/bbbb1390-0000-4000-8000-000000000001/q.bin',            '{"size": "256"}'),
  ('rabbit-files',      'other/aaaa1390-0000-4000-8000-000000000001/o.bin',               '{"size": "512"}'),
  ('rabbit-files',      'projects/aaaa1390-0000-4000-8000-000000000001.x/y.bin',          '{"size": "1024"}'),
  ('rabbit-files',      'projects/dddd1390-0000-4000-8000-0000000000ff/m.bin',            '{"size": "2048"}'),
  ('rabbit-thumbnails', 'projects/dddd1390-0000-4000-8000-0000000000ff/m.bin.jpg',        '{"size": "4096"}'),
  ('rabbit-files',      'projects/aaaa1390-0000-4000-8000-000000000001/zz.bin',           '{"contentLength": "8192"}');
-- The moved copy: a row of P2 whose key's second segment names no project, and its picture.
INSERT INTO public.files (project_id, workspace_id, name, storage_provider, storage_path, thumbnail_url) VALUES
  ('aaaa1390-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'm.bin', 'supabase',
   'projects/dddd1390-0000-4000-8000-0000000000ff/m.bin', 'projects/dddd1390-0000-4000-8000-0000000000ff/m.bin.jpg');

-- 26
SELECT is(public.workspace_petal_committed_bytes('11111111-1111-1111-1111-111111111111'), 14463::bigint,
  'A: canonical 1 + picture 2 + upper 4 + braces 8 + no hyphens 16 + extra hyphen 32 + empty third segment 64 + moved 2048 + its picture 4096 + contentLength 8192; not the two-segment key, B''s, other/ or P1.x');
-- 27
SELECT is(public.workspace_petal_committed_bytes('11111111-1111-1111-1111-111111111111'),
          public.t139_old_meter('11111111-1111-1111-1111-111111111111'),
  'A: the new meter equals 0115''s');
-- 28
SELECT ok(public.workspace_petal_committed_bytes('22222222-2222-2222-2222-222222222222') = 256
          AND public.t139_old_meter('22222222-2222-2222-2222-222222222222') = 256,
  'B: 256 by both');
-- 29
SELECT ok(public.workspace_petal_committed_bytes('33333333-3333-4333-8333-333333333333') = 0
          AND public.t139_old_meter('33333333-3333-4333-8333-333333333333') = 0
          AND public.workspace_petal_committed_bytes(NULL) = 0,
  'a company with nothing, and NULL: 0 by both');
-- 30
SELECT isnt(public.t139_no_1b('11111111-1111-1111-1111-111111111111'),
            public.t139_old_meter('11111111-1111-1111-1111-111111111111'),
  'CONTROL: without arm 1b the four other spellings of P1''s id are not counted, a quota bypass');
-- 31
SELECT isnt(public.t139_no_2('11111111-1111-1111-1111-111111111111'),
            public.t139_old_meter('11111111-1111-1111-1111-111111111111'),
  'CONTROL: without arm 2 the moved copy and its picture are not counted');
-- 32
SELECT is((SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.workspace_petal_committed_bytes(uuid)'::regprocedure),
  '67bd041258c73fecae5b4031357e42d2', 'the meter is 0137''s body');
-- 33
SELECT ok((SELECT p.prosecdef AND p.provolatile = 's' AND r.rolbypassrls FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
            WHERE p.oid = 'public.workspace_petal_committed_bytes(uuid)'::regprocedure),
  'a STABLE definer whose owner bypasses row security');
-- 34
SELECT ok(NOT has_function_privilege('anon', 'public.workspace_petal_committed_bytes(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.workspace_petal_committed_bytes(uuid)', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.workspace_petal_committed_bytes(uuid)', 'EXECUTE'),
  'service_role only');
-- 35
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
             AND policyname = 'petal_storage_quota_insert' AND permissive = 'RESTRICTIVE' AND cmd = 'INSERT'), 1,
  'the quota''s RESTRICTIVE policy is still there, as it was');

-- ── E. The indexes ────────────────────────────────────────────────────────────
-- 36
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['bin_files_location_idx', 'budget_lines_project_idx', 'folders_project_idx',
                                                  'scenes_project_idx', 'tasks_project_idx', 'otter_courses_ws_owner_idx']) n
            WHERE to_regclass('public.' || n) IS NOT NULL), 0,
  'the six narrow indexes are gone');
-- 37
SELECT is((SELECT count(*)::int FROM pg_index i
            WHERE i.indexrelid IN ('public.bin_files_location_path_idx'::regclass, 'public.budget_lines_project_sheet_idx'::regclass,
                                   'public.folders_project_path_uniq'::regclass, 'public.scenes_project_number_idx'::regclass,
                                   'public.tasks_project_phase_idx'::regclass, 'public.otter_courses_owner_slug_uidx'::regclass)
              AND i.indisvalid AND i.indisready), 6,
  'the six wider ones with the same leading columns are here and valid');
-- 38
SELECT is(pg_get_indexdef('public.app_events_ai_files_file_id_idx'::regclass),
  'CREATE INDEX app_events_ai_files_file_id_idx ON public.app_events USING btree (((context ->> ''file_id''::text))) WHERE ((context ->> ''tool''::text) = ''ai-files''::text)',
  'the file-id index, partial on the ai-files rows');
-- 39
SELECT is(pg_get_indexdef('public.app_events_ai_files_ws_id_idx'::regclass),
  'CREATE INDEX app_events_ai_files_ws_id_idx ON public.app_events USING btree (workspace_id, id) WHERE ((code = ''WIL-6001''::text) AND ((context ->> ''tool''::text) = ''ai-files''::text))',
  'the workspace-and-id index, partial on the upload rows');
-- 40
SELECT is((SELECT count(*)::int FROM pg_index WHERE indexrelid IN ('public.app_events_ai_files_file_id_idx'::regclass, 'public.app_events_ai_files_ws_id_idx'::regclass)
             AND indisvalid AND indisready), 2, 'both valid');

-- The reads exactly as PostgREST sends them: every value and the JSON key bound as parameters.
INSERT INTO public.app_events (workspace_id, actor_user_id, event_type, code, message, context)
SELECT '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'system', 'WIL-6001', 'AI file upload completed',
       jsonb_build_object('tool', 'ai-files', 'file_id', 'file_t139' || lpad(g::text, 8, '0'), 'size_bytes', g, 'mime_type', 'application/pdf')
  FROM generate_series(1, 40) g;
INSERT INTO public.app_events (workspace_id, event_type, code, message, context)
SELECT '11111111-1111-1111-1111-111111111111', 'system', 'WIL-6001', 'A generation', jsonb_build_object('tool', 'ai-proxy', 'n', g)
  FROM generate_series(1, 200) g;
ANALYZE public.app_events;
PREPARE t139_rows(text, text, text, uuid) AS
  SELECT "public"."app_events"."workspace_id", "public"."app_events"."context" FROM "public"."app_events"
   WHERE "public"."app_events"."code" = $1 AND "public"."app_events"."context"->>$2 = $3 AND "public"."app_events"."workspace_id" = $4
   ORDER BY "public"."app_events"."id" ASC LIMIT 1000 OFFSET 0;
PREPARE t139_naming(text, text, text, text, text[]) AS
  SELECT "public"."app_events"."workspace_id", "public"."app_events"."context" FROM "public"."app_events"
   WHERE "public"."app_events"."code" = $1 AND "public"."app_events"."context"->>$2 = $3 AND "public"."app_events"."context"->>$4 = ANY ($5)
   ORDER BY "public"."app_events"."id" ASC LIMIT 1000 OFFSET 0;
SET LOCAL enable_seqscan = off;
SET LOCAL plan_cache_mode = force_custom_plan;
-- 41
SELECT ok(strpos(public.t139_plan($q$EXECUTE t139_rows('WIL-6001', 'tool', 'ai-files', '11111111-1111-1111-1111-111111111111')$q$),
                 'app_events_ai_files_ws_id_idx') > 0,
  'readUploadRows(ws) as sent, a custom plan: the workspace-and-id index');
-- 42
SELECT ok(strpos(public.t139_plan($q$EXECUTE t139_naming('WIL-6001', 'tool', 'ai-files', 'file_id', ARRAY['file_t13900000001', 'file_t13900000002'])$q$),
                 'app_events_ai_files_file_id_idx') > 0,
  'readUploadRowsNaming(ids) as sent, a custom plan: the file-id index');
SET LOCAL plan_cache_mode = force_generic_plan;
-- 43
SELECT ok(strpos(public.t139_plan($q$EXECUTE t139_rows('WIL-6001', 'tool', 'ai-files', '11111111-1111-1111-1111-111111111111')$q$),
                 'app_events_ai_files_') = 0,
  'CONTROL, the caveat as a test: a generic plan cannot prove the predicate, so it does not use either');
-- 44
SELECT ok(strpos(public.t139_plan($q$EXECUTE t139_naming('WIL-6001', 'tool', 'ai-files', 'file_id', ARRAY['file_t13900000001'])$q$),
                 'app_events_ai_files_') = 0,
  'CONTROL: nor for the file ids (the JSON key itself is a parameter)');
SET LOCAL plan_cache_mode = auto;
SET LOCAL enable_seqscan = on;
-- 45
SELECT is((SELECT count(*)::int FROM public.app_events
            WHERE code = 'WIL-6001' AND context->>'tool' = 'ai-files' AND workspace_id = '11111111-1111-1111-1111-111111111111'), 40,
  'the index answers the same rows as the table');
-- 46
SELECT is((SELECT count(*)::int FROM public.app_events
            WHERE context->>'tool' = 'ai-files' AND context->>'file_id' = ANY (ARRAY['file_t13900000001', 'file_t13900000040', 'file_nope'])), 2,
  'and by file id');

-- ── A, again, as the end of the file ───────────────────────────────────────────
-- 47
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
             AND COALESCE(qual, '') || COALESCE(with_check, '') LIKE '%SELECT %has_active_membership(%current_workspace_id()) AS has_active_membership)%'), 9,
  'the nine storage.objects policies that called it ask once');
-- 48
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workspaces' AND policyname = 'workspaces_admin_update'
             AND qual LIKE '((id = %current_workspace_id()) AND %( SELECT %has_active_membership(%current_workspace_id()) AS has_active_membership))'
             AND with_check = qual), 1,
  'workspaces_admin_update (its column is id, pinned to the claim) restated in both clauses');
-- 49
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'asset_versions'
             AND COALESCE(qual, '') || COALESCE(with_check, '') LIKE '%(a.workspace_id = %current_workspace_id()) AND ( SELECT %has_active_membership(%current_workspace_id()) AS has_active_membership)%'), 3,
  'the EXISTS shape keeps its alias pin beside the sub-select (asset_versions'' three)');
-- 50
SELECT is(public.t139_per_row(), 'public.auth_events.auth_events_insert', 'and still only the one left per row');

SELECT * FROM finish();
ROLLBACK;
