-- =============================================================================
-- 126_moth_layout_positions.sql — M.O.T.H. Session 2 (MO2): where each dot of a view was put (0123 §2).
--
-- A. Structure: forced row security, one policy, for reading, asking Moth's gate; a client writes nothing
--    directly; one place a target and owner, one focus, an index for each cascade, no channel.
-- B. Writing, only through moth_put_positions and moth_clear_positions (a client writes no place directly): a
--    shared view's places by its project's writers, not its reviewer; one's own view's places by its owner; a
--    view or a target the caller cannot see refused exactly as one that does not exist; a project's view holds
--    that project's things only; whose a place is the database says; the shapes; a target named twice, in any
--    letters; one focus, which a focus left on a file now hidden does not block (review round 1); a target named
--    twice folded before its focus is counted (0124, MO2-10).
-- C. Reading: the view, the target and the owner each decide, live: a file that becomes money, one in the
--    trash, and another person's own places vanish; nothing for someone who has left or another company.
-- D. Clearing, and what goes with a target or a view.
-- E. Planted: the read policy without the target's gate must show a hidden place; the key to the view planted
--    id-only must let a place's company differ from its view's.
-- F. What MO2's planted breakages found unprobed: a level's place, new marks on a move, a deleted target's places.
--
-- Fixture ids: projects aaaa1260-…, everything else 12600000-… Users as suite 124's.
-- S4b-07's accepted class: no uuid-only 23505 can arise, because a client sends no id.
-- =============================================================================

BEGIN;

SELECT plan(86);

SELECT * FROM tests.rls_setup();

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
SELECT u.id, u.email, crypt('testpw', gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
       'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()
  FROM (VALUES
    ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'user_c@test.local'),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, 'user_e@test.local'),
    ('99999999-9999-9999-9999-999999999999'::uuid, 'user_r@test.local'),
    ('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, 'user_n@test.local')) u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user', 'user_e', 'User E', true),
  ('11111111-1111-1111-1111-111111111111', '99999999-9999-9999-9999-999999999999', 'user', 'user_r', 'User R', true),
  ('11111111-1111-1111-1111-111111111111', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'user', 'user_n', 'User N', true)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET is_active = EXCLUDED.is_active, app_role = EXCLUDED.app_role;

CREATE FUNCTION public.t126_as(p_user uuid, p_role text, p_ws uuid DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_role))::text, true);
END;
$f$;
CREATE FUNCTION public.t126_a() RETURNS void LANGUAGE sql AS $f$ SELECT public.t126_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin') $f$;
CREATE FUNCTION public.t126_b() RETURNS void LANGUAGE sql AS $f$ SELECT public.t126_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222') $f$;
CREATE FUNCTION public.t126_c() RETURNS void LANGUAGE sql AS $f$ SELECT public.t126_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user') $f$;
CREATE FUNCTION public.t126_e() RETURNS void LANGUAGE sql AS $f$ SELECT public.t126_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user') $f$;
CREATE FUNCTION public.t126_r() RETURNS void LANGUAGE sql AS $f$ SELECT public.t126_as('99999999-9999-9999-9999-999999999999', 'user') $f$;
CREATE FUNCTION public.t126_n() RETURNS void LANGUAGE sql AS $f$ SELECT public.t126_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'user') $f$;

CREATE FUNCTION public.t126_err(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  s text;
  m text;
BEGIN
  EXECUTE p_sql;
  RETURN 'no refusal';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS s = RETURNED_SQLSTATE, m = MESSAGE_TEXT;
  RETURN s || ' ' || m;
END;
$f$;
CREATE FUNCTION public.t126_put(p_view uuid, p_places jsonb) RETURNS integer LANGUAGE sql AS $f$
  SELECT public.moth_put_positions(p_view, p_places)
$f$;
-- What a caller sees of a view's places: kind, the end of its id or the tag, its owner's first letter.
CREATE FUNCTION public.t126_seen(p_view uuid) RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT COALESCE(string_agg(target_type || ':' || COALESCE(right(target_id::text, 3), target_tag) || ':' || COALESCE(left(owner_id::text, 1), '-'),
                             ' ' ORDER BY target_type, COALESCE(target_id::text, target_tag)), '')
    FROM public.moth_layout_positions WHERE view_id = p_view
$f$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
SELECT public.t126_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1260-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Salt Hours', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1260-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Second', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1260-0000-0000-0000-0000000000e0', '11111111-1111-1111-1111-111111111111', 'Personal space', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1260-0000-0000-0000-00000000000a', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1260-0000-0000-0000-00000000000a', '99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'reviewer')
ON CONFLICT DO NOTHING;
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('12600000-0000-0000-0000-000000000070', 'aaaa1260-0000-0000-0000-00000000000a', NULL, 'root', 'salt-hours', ''),
  ('12600000-0000-0000-0000-000000000071', 'aaaa1260-0000-0000-0000-00000000000a', '12600000-0000-0000-0000-000000000070', 'category', 'ASSETS', 'ASSETS');
INSERT INTO public.assets (id, project_id, name) VALUES
  ('12600000-0000-0000-0000-000000000051', 'aaaa1260-0000-0000-0000-00000000000a', 'Mira'),
  ('12600000-0000-0000-0000-000000000052', 'aaaa1260-0000-0000-0000-00000000000b', 'Elsewhere'),
  ('12600000-0000-0000-0000-0000000000e1', 'aaaa1260-0000-0000-0000-0000000000e0', 'Pitch');
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial) VALUES
  ('12600000-0000-0000-0000-000000000081', 'aaaa1260-0000-0000-0000-00000000000a', 'mira.png', 'supabase', 'projects/aaaa1260-0000-0000-0000-00000000000a/files/12600000-0000-0000-0000-000000000081/mira.png', false),
  ('12600000-0000-0000-0000-000000000082', 'aaaa1260-0000-0000-0000-00000000000a', 'fee.pdf', 'supabase', 'projects/aaaa1260-0000-0000-0000-00000000000a/files/12600000-0000-0000-0000-000000000082/fee.pdf', true),
  ('12600000-0000-0000-0000-000000000083', 'aaaa1260-0000-0000-0000-00000000000a', 'later.png', 'supabase', 'projects/aaaa1260-0000-0000-0000-00000000000a/files/12600000-0000-0000-0000-000000000083/later.png', false),
  ('12600000-0000-0000-0000-000000000084', 'aaaa1260-0000-0000-0000-00000000000a', 'binned.png', 'supabase', 'projects/aaaa1260-0000-0000-0000-00000000000a/files/12600000-0000-0000-0000-000000000084/binned.png', false),
  -- An id with letters in it, so naming it in capitals is naming it differently (0124's plants).
  ('12600000-0000-0000-0000-0000000000ab', 'aaaa1260-0000-0000-0000-00000000000a', 'lettered.png', 'supabase', 'projects/aaaa1260-0000-0000-0000-00000000000a/files/12600000-0000-0000-0000-0000000000ab/lettered.png', false);

-- The views: P's shared one (VP), the reviewer's own (VR), the admin's own (VA), the owner's view of their space
-- (VS). Each made with its maker's claims, because the database says whose a view is.
INSERT INTO public.moth_views (id, scope_kind, project_id, name) VALUES
  ('12600000-0000-0000-0000-0000000000a1', 'project', 'aaaa1260-0000-0000-0000-00000000000a', 'VP'),
  ('12600000-0000-0000-0000-0000000000a3', 'aggregate', NULL, 'VA');
SELECT public.t126_r();
INSERT INTO public.moth_views (id, scope_kind, name) VALUES ('12600000-0000-0000-0000-0000000000a2', 'aggregate', 'VR');
SELECT public.t126_e();
INSERT INTO public.moth_views (id, scope_kind, project_id, name) VALUES
  ('12600000-0000-0000-0000-0000000000a4', 'project', 'aaaa1260-0000-0000-0000-0000000000e0', 'VS');
SELECT public.t126_a();

-- ── A. Structure ────────────────────────────────────────────────────────────
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.moth_layout_positions'::regclass), 'row security is forced');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'moth_layout_positions'
            AND cmd = 'SELECT' AND permissive = 'PERMISSIVE' AND qual ~ 'moth_can_read_target'), 1,
  'one policy, for reading, asking Moth''s gate (S6)');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'moth_layout_positions'), 1, 'and no other');
SELECT ok(has_table_privilege('authenticated', 'public.moth_layout_positions', 'SELECT')
          AND NOT has_table_privilege('authenticated', 'public.moth_layout_positions', 'INSERT')
          AND NOT has_table_privilege('authenticated', 'public.moth_layout_positions', 'UPDATE')
          AND NOT has_table_privilege('authenticated', 'public.moth_layout_positions', 'DELETE')
          AND NOT has_table_privilege('anon', 'public.moth_layout_positions', 'SELECT'),
  'a client reads places and writes none directly; anon nothing');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_proc pr ON pr.oid = tg.tgfoid
                       WHERE tg.tgrelid = 'public.moth_layout_positions'::regclass AND NOT tg.tgisinternal AND pr.proname ~ 'broadcast')
          AND NOT EXISTS (SELECT 1 FROM pg_proc pr WHERE pr.pronamespace = 'public'::regnamespace AND pr.proname ~ 'broadcast'
                           AND position('moth_layout_positions' IN pr.prosrc) > 0),
  'no place is sent on a channel (no broadcast trigger, no broadcast function names the table)');
SELECT is((SELECT string_agg(p.proname || ':' || CASE WHEN p.prosecdef THEN 'definer' ELSE 'invoker' END, ' ' ORDER BY p.proname)
             FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('moth_put_positions', 'moth_clear_positions', 'moth_view_positions')
              AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')),
  'moth_clear_positions:definer moth_put_positions:definer moth_view_positions:definer', 'the three ways in are definers, for signed-in callers only');
SELECT ok(NOT has_function_privilege('authenticated', 'rabbit_private.moth_view_access(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'rabbit_private.moth_target_project(text,uuid)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.fn_moth_layout_positions_pin()', 'EXECUTE'),
  'their helpers and the pin are not a client''s to call');
SELECT ok(position('20000' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.moth_put_positions(uuid,jsonb)'::regprocedure)) > 0
          AND position('pg_advisory_xact_lock' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.moth_put_positions(uuid,jsonb)'::regprocedure)) > 0,
  'the put counts a view''s places under a lock, at most 20,000 an owner');
SELECT is((SELECT count(*)::int FROM pg_index WHERE indrelid = 'public.moth_layout_positions'::regclass), 16,
  'a key, one place a target and owner, one focus, and an index for each of the twelve references (0126: a note''s and a typed tag''s) and for the owner');
-- 0124 (MO2-12): the two keys and the access the put stands on, by what they are, not by their names.
SELECT is(pg_get_indexdef('public.moth_layout_positions_target_key'::regclass) || ' | ' || pg_get_indexdef('public.moth_layout_positions_focus_key'::regclass),
  'CREATE UNIQUE INDEX moth_layout_positions_target_key ON public.moth_layout_positions USING btree (view_id, target_type, target_id, target_tag, owner_id) NULLS NOT DISTINCT'
  || ' | CREATE UNIQUE INDEX moth_layout_positions_focus_key ON public.moth_layout_positions USING btree (view_id, owner_id) NULLS NOT DISTINCT WHERE is_focus',
  'one place a target and owner, one focus a view and owner: the two keys by their definitions (0124)');
SELECT is((SELECT md5(replace(prosrc, chr(13), '')) || ' ' || prosecdef::text || ' ' || proconfig::text FROM pg_proc
            WHERE oid = 'rabbit_private.moth_view_access(uuid)'::regprocedure),
  '72f49b136935ac7ddc2741880bdfc639 true {search_path=public}', 'the places'' access is 0123''s body, as its definer, on the path pinned (0124)');

-- ── B. Writing ──────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t126_c();
SELECT is(public.t126_put('12600000-0000-0000-0000-0000000000a1', jsonb_build_array(
  jsonb_build_object('t', 'file', 'id', '12600000-0000-0000-0000-000000000081', 'x', 10, 'y', 20),
  jsonb_build_object('t', 'folder', 'id', '12600000-0000-0000-0000-000000000071', 'x', -5.5, 'y', 0, 'open', true),
  jsonb_build_object('t', 'asset', 'id', '12600000-0000-0000-0000-000000000051', 'x', 1, 'y', 2, 'pinned', true),
  jsonb_build_object('t', 'project', 'id', 'aaaa1260-0000-0000-0000-00000000000a', 'x', 0, 'y', 0),
  jsonb_build_object('t', 'tag', 'tag', 'creative', 'x', 3, 'y', 4),
  jsonb_build_object('t', 'file', 'id', '12600000-0000-0000-0000-000000000083', 'x', 7, 'y', 7),
  jsonb_build_object('t', 'file', 'id', '12600000-0000-0000-0000-000000000084', 'x', 8, 'y', 8, 'focus', true))), 7,
  'a seated member puts seven places in P''s shared view');
SELECT is(public.t126_seen('12600000-0000-0000-0000-0000000000a1'),
  'asset:051:- file:081:- file:083:- file:084:- folder:071:- project:00a:- tag:creative:-', '… all shared, none owned');
SELECT is(public.t126_err($$ INSERT INTO public.moth_layout_positions (view_id, target_type, target_tag, x, y)
                             VALUES ('12600000-0000-0000-0000-0000000000a1', 'tag', 'code', 1, 1) $$),
  '42501 permission denied for table moth_layout_positions', 'a client cannot write a place directly');
SELECT ok(public.t126_err($$ UPDATE public.moth_layout_positions SET x = 1 WHERE view_id = '12600000-0000-0000-0000-0000000000a1' $$) LIKE '42501 %'
          AND public.t126_err($$ DELETE FROM public.moth_layout_positions WHERE view_id = '12600000-0000-0000-0000-0000000000a1' $$) LIKE '42501 %',
  'nor move or remove one directly');
SELECT public.t126_r();
SELECT ok(public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000a1', '[{"t":"file","id":"12600000-0000-0000-0000-000000000081","x":99,"y":99}]') $$) LIKE '42501 %',
  'the reviewer cannot move a shared place');
SELECT ok(public.t126_err($$ SELECT public.moth_clear_positions('12600000-0000-0000-0000-0000000000a1') $$) LIKE '42501 %',
  'nor clear them');
SELECT is(public.t126_put('12600000-0000-0000-0000-0000000000a2', '[{"t":"file","id":"12600000-0000-0000-0000-000000000081","x":5,"y":5}]'), 1,
  'the reviewer puts a place in their own view');
SELECT is(public.t126_seen('12600000-0000-0000-0000-0000000000a2'), 'file:081:9', '… which is theirs');
SELECT public.t126_a();
SELECT is(public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000a2', '[{"t":"file","id":"12600000-0000-0000-0000-000000000081","x":1,"y":1}]') $$),
          public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000ff', '[{"t":"file","id":"12600000-0000-0000-0000-000000000081","x":1,"y":1}]') $$),
  'another person''s view is refused exactly as a view that does not exist');
SELECT ok(public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000ff', '[{"t":"file","id":"12600000-0000-0000-0000-000000000081","x":1,"y":1}]') $$)
          LIKE '23503 %moth_layout_positions_view_fk%', '… with the words a missing key gives');
SELECT is(public.t126_err($$ SELECT public.moth_clear_positions('12600000-0000-0000-0000-0000000000a2') $$),
          public.t126_err($$ SELECT public.moth_clear_positions('12600000-0000-0000-0000-0000000000ff') $$),
  'and so is a clear of it');
SELECT is(public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000a3', '[{"t":"file","id":"12600000-0000-0000-0000-000000000082","x":1,"y":1}]') $$),
          public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000a3', '[{"t":"file","id":"12600000-0000-0000-0000-0000000000ff","x":1,"y":1}]') $$),
  'a money file is refused exactly as a file that does not exist');
SELECT is(public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000a3', '[{"t":"asset","id":"12600000-0000-0000-0000-0000000000e1","x":1,"y":1}]') $$),
          public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000a3', '[{"t":"asset","id":"12600000-0000-0000-0000-0000000000fe","x":1,"y":1}]') $$),
  'another person''s space''s asset, the same (no admin leg)');
SELECT is(public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000a4', '[{"t":"asset","id":"12600000-0000-0000-0000-0000000000e1","x":1,"y":1}]') $$),
          public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000fd', '[{"t":"asset","id":"12600000-0000-0000-0000-0000000000e1","x":1,"y":1}]') $$),
  'the owner''s view of their space is, to the admin, a view that does not exist');
SELECT is(public.t126_put('12600000-0000-0000-0000-0000000000a3', '[{"t":"asset","id":"12600000-0000-0000-0000-000000000052","x":1,"y":1},{"t":"asset","id":"12600000-0000-0000-0000-000000000051","x":2,"y":2}]'), 2,
  'one''s own view holds things of any project one sees');
SELECT public.t126_c();
SELECT ok(public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000a1', '[{"t":"asset","id":"12600000-0000-0000-0000-000000000052","x":1,"y":1}]') $$) LIKE '23514 %',
  'a project''s view holds that project''s things only');
SELECT public.t126_e();
SELECT is(public.t126_put('12600000-0000-0000-0000-0000000000a4', '[{"t":"asset","id":"12600000-0000-0000-0000-0000000000e1","x":1,"y":1}]'), 1,
  'the owner puts a place in their space''s view');
SELECT is(public.t126_seen('12600000-0000-0000-0000-0000000000a4'), 'asset:0e1:e', '… and a personal space''s place is its owner''s, never shared');
SELECT public.t126_b();
SELECT ok(public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000a1', '[{"t":"tag","tag":"creative","x":1,"y":1}]') $$) LIKE '23503 %',
  'another company: P''s view does not exist');
SELECT public.t126_c();
SELECT ok(public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000a1', '{"t":"tag"}') $$) LIKE '22023 %', 'places come as a list');
SELECT ok(public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000a1', (SELECT jsonb_agg(jsonb_build_object('t','tag','tag','code','x',g,'y',g)) FROM generate_series(1, 1001) g)) $$) LIKE '22023 %',
  'of at most 1,000');
SELECT ok(public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000a1', '[{"t":"file","id":"12600000-0000-0000-0000-000000000081","x":"1","y":1}]') $$) LIKE '22023 %',
  'where a place is, is numbers');
SELECT ok(public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000a1', '[{"t":"file","id":"not-an-id","x":1,"y":1}]') $$) LIKE '22023 %', 'a target''s id is an id');
SELECT ok(public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000a1', '[{"t":"tag","tag":"code","id":"12600000-0000-0000-0000-000000000081","x":1,"y":1}]') $$) LIKE '22023 %',
  'a tag has no id');
SELECT ok(public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000a1', '[{"t":"tag","tag":"code","x":1,"y":1,"pinned":"yes"}]') $$) LIKE '22023 %', 'a mark is true or false');
SELECT ok(public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000a1', '[{"t":"tag","tag":"legal","x":1,"y":1}]') $$) LIKE '23514 %', 'no Legal tag dot');
SELECT ok(public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000a1', '[{"t":"tag","tag":"code","x":1e8,"y":1}]') $$) LIKE '23514 %', 'a place is within the world');
SELECT ok(public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000a1', '[{"t":"note","id":"12600000-0000-0000-0000-000000000081","x":1,"y":1}]') $$) LIKE '23503 %', 'a kind Moth does not know is a target that does not exist');
SELECT ok(public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000a1', '[{"t":"tag","tag":"code","x":1,"y":1,"focus":true},{"t":"tag","tag":"shots","x":1,"y":1,"focus":true}]') $$) LIKE '22023 %',
  'one focus at most');
SELECT is(public.t126_put('12600000-0000-0000-0000-0000000000a1', '[{"t":"file","id":"12600000-0000-0000-0000-000000000081","x":30,"y":30},{"t":"file","id":"12600000-0000-0000-0000-000000000081","x":40,"y":41}]'), 1,
  'a target named twice is one place');
SELECT is(public.t126_put('12600000-0000-0000-0000-0000000000a1', jsonb_build_array(
            jsonb_build_object('t', 'file', 'id', '12600000-0000-0000-0000-0000000000ab', 'x', 50, 'y', 51),
            jsonb_build_object('t', 'file', 'id', upper('12600000-0000-0000-0000-0000000000ab'), 'x', 40, 'y', 41))), 1,
  'and named in capitals, still the same place: one place, never two writes of it in one call');
SELECT is((SELECT x::text || ',' || y::text FROM public.moth_layout_positions WHERE view_id = '12600000-0000-0000-0000-0000000000a1' AND target_id = '12600000-0000-0000-0000-0000000000ab'),
  '40,41', '… at its last place');
RESET ROLE;
-- The lettered file's place goes again, so the places counted below are as they were.
DELETE FROM public.moth_layout_positions WHERE target_id = '12600000-0000-0000-0000-0000000000ab';

-- The focus on a file that leaves the picture: a new focus must still land, and say nothing of it (review round 1).
UPDATE public.files SET deleted_at = now() WHERE id = '12600000-0000-0000-0000-000000000084';
SET LOCAL ROLE authenticated;
SELECT public.t126_c();
SELECT is(public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000a1', '[{"t":"asset","id":"12600000-0000-0000-0000-000000000051","x":1,"y":2,"pinned":true,"focus":true}]') $$),
  'no refusal', 'a new focus lands when the old one''s file went to the trash, with nothing said of it');
RESET ROLE;
SELECT is((SELECT string_agg(target_type || ':' || right(target_id::text, 3), ',') FROM public.moth_layout_positions
            WHERE view_id = '12600000-0000-0000-0000-0000000000a1' AND is_focus), 'asset:051', '… and it is the one focus');
UPDATE public.files SET deleted_at = NULL WHERE id = '12600000-0000-0000-0000-000000000084';
SET LOCAL ROLE authenticated;
SELECT public.t126_c();
SELECT is(public.t126_put('12600000-0000-0000-0000-0000000000a1', '[{"t":"folder","id":"12600000-0000-0000-0000-000000000071","x":-5.5,"y":0,"open":true,"focus":true}]'), 1, 'another focus');
SELECT is((SELECT string_agg(target_type, ',') FROM public.moth_layout_positions WHERE view_id = '12600000-0000-0000-0000-0000000000a1' AND is_focus),
  'folder', '… replaces the first: a view has one');
-- 0124 (MO2-10): a target named twice is folded first, the last naming it winning, and only then is a focus counted.
SELECT is(public.t126_put('12600000-0000-0000-0000-0000000000a1', '[{"t":"file","id":"12600000-0000-0000-0000-000000000081","x":1,"y":1,"focus":true},{"t":"file","id":"12600000-0000-0000-0000-000000000081","x":2,"y":2}]'), 1,
  'a target sent with a focus and then without is one place (0124)');
SELECT is((SELECT string_agg(target_type, ',') FROM public.moth_layout_positions WHERE view_id = '12600000-0000-0000-0000-0000000000a1' AND is_focus),
  'folder', '… and the focus stays where it was, since the place that names no focus is the one kept (0124)');
SELECT is(public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000a1', '[{"t":"file","id":"12600000-0000-0000-0000-000000000081","x":3,"y":3,"focus":true},{"t":"file","id":"12600000-0000-0000-0000-000000000081","x":4,"y":4,"focus":true}]') $$),
  'no refusal', 'a target sent twice, each time with a focus, is one focus, not two (0124)');
SELECT is((SELECT string_agg(target_type || ':' || right(target_id::text, 3), ',') FROM public.moth_layout_positions WHERE view_id = '12600000-0000-0000-0000-0000000000a1' AND is_focus),
  'file:081', '… and it is the focus now, alone (0124)');
RESET ROLE;

-- ── C. Reading ──────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t126_r();
SELECT is((SELECT count(*)::int FROM public.moth_layout_positions WHERE view_id = '12600000-0000-0000-0000-0000000000a1'), 7, 'the reviewer reads P''s shared places');
SELECT is((SELECT count(*)::int FROM public.moth_layout_positions), 8, 'and their own, and no one else''s');
SELECT is((SELECT count(*)::int FROM jsonb_to_recordset(public.moth_view_positions('12600000-0000-0000-0000-0000000000a1') -> 'places') AS v(target_type text, target_id uuid, target_tag text, mine boolean)), 7, 'the bulk read answers the same');
SELECT is((SELECT string_agg(target_type || ':' || mine::text, ' ') FROM jsonb_to_recordset(public.moth_view_positions('12600000-0000-0000-0000-0000000000a2') -> 'places') AS v(target_type text, target_id uuid, target_tag text, mine boolean)), 'file:true',
  '… and says which places are the caller''s own');
SELECT public.t126_a();
SELECT is((SELECT count(*)::int FROM public.moth_layout_positions WHERE view_id IN ('12600000-0000-0000-0000-0000000000a2', '12600000-0000-0000-0000-0000000000a4')), 0,
  'the admin reads none of the reviewer''s own places, nor of the owner''s space');
SELECT is((SELECT count(*)::int FROM jsonb_to_recordset(public.moth_view_positions('12600000-0000-0000-0000-0000000000a4') -> 'places') AS v(target_type text, target_id uuid, target_tag text, mine boolean))
          + (SELECT count(*)::int FROM jsonb_to_recordset(public.moth_view_positions('12600000-0000-0000-0000-0000000000a2') -> 'places') AS v(target_type text, target_id uuid, target_tag text, mine boolean)), 0, '… in bulk either');
SELECT public.t126_e();
SELECT is(public.t126_seen('12600000-0000-0000-0000-0000000000a4'), 'asset:0e1:e', 'the owner reads their space''s place');
SELECT public.t126_b();
SELECT is((SELECT count(*)::int FROM public.moth_layout_positions) + (SELECT count(*)::int FROM jsonb_to_recordset(public.moth_view_positions('12600000-0000-0000-0000-0000000000a1') -> 'places') AS v(target_type text, target_id uuid, target_tag text, mine boolean)), 0,
  'another company reads none');
RESET ROLE;

UPDATE public.files SET is_financial = true WHERE id = '12600000-0000-0000-0000-000000000083';
UPDATE public.files SET deleted_at = now() WHERE id = '12600000-0000-0000-0000-000000000084';
SET LOCAL ROLE authenticated;
SELECT public.t126_c();
SELECT is(public.t126_seen('12600000-0000-0000-0000-0000000000a1'),
  'asset:051:- file:081:- folder:071:- project:00a:- tag:creative:-', 'a file that became money, and one in the trash, leave the picture at once');
SELECT is((SELECT count(*)::int FROM public.moth_layout_positions WHERE target_id = '12600000-0000-0000-0000-000000000083')
          + (SELECT count(*)::int FROM jsonb_to_recordset(public.moth_view_positions('12600000-0000-0000-0000-0000000000a1') -> 'places') AS v(target_type text, target_id uuid, target_tag text, mine boolean) WHERE target_id IN ('12600000-0000-0000-0000-000000000083', '12600000-0000-0000-0000-000000000084')), 0,
  '… even asked by its id, and in bulk');
RESET ROLE;
SELECT public.t126_a();
UPDATE public.workspace_members SET is_active = false
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND user_id = '99999999-9999-9999-9999-999999999999';
SET LOCAL ROLE authenticated;
SELECT public.t126_r();
SELECT is((SELECT count(*)::int FROM public.moth_layout_positions) + (SELECT count(*)::int FROM jsonb_to_recordset(public.moth_view_positions('12600000-0000-0000-0000-0000000000a2') -> 'places') AS v(target_type text, target_id uuid, target_tag text, mine boolean)), 0,
  'someone who has left reads none, their own included');
SELECT ok(public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000a2', '[{"t":"tag","tag":"code","x":1,"y":1}]') $$) LIKE '23503 %',
  'and writes none');
RESET ROLE;
SELECT public.t126_a();
UPDATE public.workspace_members SET is_active = true
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND user_id = '99999999-9999-9999-9999-999999999999';

-- ── D. Clearing, and what goes with a target or a view ──────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t126_c();
SELECT is(public.moth_clear_positions('12600000-0000-0000-0000-0000000000a1'), 5,
  'a writer clears a shared view''s places, and is told only of the five it could see');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.moth_layout_positions WHERE view_id = '12600000-0000-0000-0000-0000000000a1'), 0,
  '… so none comes back when its file does');
SELECT is((SELECT count(*)::int FROM public.moth_layout_positions WHERE view_id = '12600000-0000-0000-0000-0000000000a2'), 1,
  'and another view''s places stand');
DELETE FROM public.assets WHERE id = '12600000-0000-0000-0000-000000000051';
SELECT is((SELECT count(*)::int FROM public.moth_layout_positions WHERE asset_ref = '12600000-0000-0000-0000-000000000051'), 0,
  'a thing removed for good takes its places with it, in every view');
DELETE FROM public.moth_views WHERE id = '12600000-0000-0000-0000-0000000000a2';
SELECT is((SELECT count(*)::int FROM public.moth_layout_positions WHERE view_id = '12600000-0000-0000-0000-0000000000a2'), 0, 'and a view its places');
SELECT is((SELECT count(*)::int FROM public.files WHERE id = '12600000-0000-0000-0000-000000000081'), 1, 'and never a file: a layout''s removal touches no file');

-- The owner decides as well (MO2 review round 1): another person's own place, planted in a shared view as the
-- database (no function writes one there), is not shown to a member who sees the view and its file.
INSERT INTO public.moth_layout_positions (view_id, workspace_id, target_type, target_id, owner_id, x, y)
VALUES ('12600000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'file', '12600000-0000-0000-0000-000000000081', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 1, 1);
SET LOCAL ROLE authenticated;
SELECT public.t126_c();
SELECT ok(public.moth_can_read_target('file', '12600000-0000-0000-0000-000000000081')
          AND position('file:081:e' IN public.t126_seen('12600000-0000-0000-0000-0000000000a1')) = 0
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.moth_view_positions('12600000-0000-0000-0000-0000000000a1') -> 'places') pl
                           WHERE pl ->> 'target_id' = '12600000-0000-0000-0000-000000000081' AND (pl ->> 'mine')::boolean),
  'another person''s own place in a shared view is not shown, through the table or the read');
RESET ROLE;
DELETE FROM public.moth_layout_positions WHERE view_id = '12600000-0000-0000-0000-0000000000a1' AND owner_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

-- ── D2. 0126 (MO3): a note's and a typed tag's places ───────────────────────
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO public.moth_tag_types (id, workspace_id, tier, name) VALUES ('12600000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111', 'company', 'Character');
INSERT INTO public.moth_tags (id, workspace_id, type_id, tier, label) VALUES ('12600000-0000-0000-0000-0000000000b2', '11111111-1111-1111-1111-111111111111', '12600000-0000-0000-0000-0000000000b1', 'company', 'Mira');
INSERT INTO public.notes (id, workspace_id, owner_id, title, tier) VALUES
  ('12600000-0000-0000-0000-0000000000b3', '11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Harbour light', 'shared'),
  ('12600000-0000-0000-0000-0000000000b4', '11111111-1111-1111-1111-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Mine alone', 'personal'),
  ('12600000-0000-0000-0000-0000000000b5', '11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'C, to herself', 'personal');
INSERT INTO public.moth_tag_types (id, workspace_id, tier, owner_id, name) VALUES ('12600000-0000-0000-0000-0000000000b6', '11111111-1111-1111-1111-111111111111', 'personal', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Mine');
INSERT INTO public.moth_tags (id, workspace_id, type_id, tier, owner_id, label) VALUES ('12600000-0000-0000-0000-0000000000b7', '11111111-1111-1111-1111-111111111111', '12600000-0000-0000-0000-0000000000b6', 'personal', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Mira');
SET LOCAL ROLE authenticated;
SELECT public.t126_c();
SELECT is(public.t126_put('12600000-0000-0000-0000-0000000000a1', '[{"t":"mtag","id":"12600000-0000-0000-0000-0000000000b2","x":1,"y":1},{"t":"note","id":"12600000-0000-0000-0000-0000000000b3","x":2,"y":2}]'), 2,
  'a project''s view keeps the places of a typed tag and a note, which belong to no project (0126)');
SELECT ok(public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000a1', '[{"t":"note","id":"12600000-0000-0000-0000-0000000000b4","x":3,"y":3}]') $$) LIKE '23503 %',
  'someone else''s personal note has no place, refused as one that is not there (0126)');
SELECT ok(public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000a1', '[{"t":"note","id":"12600000-0000-0000-0000-0000000000b5","x":3,"y":3}]') $$) LIKE '23503 %',
  'nor has one''s own personal note a place in a shared view, refused alike (round A)');
SELECT ok(public.t126_err($$ SELECT public.t126_put('12600000-0000-0000-0000-0000000000a1', '[{"t":"mtag","id":"12600000-0000-0000-0000-0000000000b7","x":3,"y":3}]') $$) LIKE '23503 %',
  'nor one''s own personal typed tag (round A)');
SELECT public.t126_r();
SELECT ok(public.t126_seen('12600000-0000-0000-0000-0000000000a1') LIKE '%mtag:0b2:-%' AND public.t126_seen('12600000-0000-0000-0000-0000000000a1') LIKE '%note:0b3:-%',
  'P''s reviewer sees the shared places of the company''s tag and the shared note (0126)');
SELECT public.t126_e();
SELECT is(public.t126_put('12600000-0000-0000-0000-0000000000a4', '[{"t":"note","id":"12600000-0000-0000-0000-0000000000b4","x":4,"y":4}]'), 1, 'a person places their own note in their personal space''s view (0126)');
SELECT public.t126_a();
SELECT is(public.t126_seen('12600000-0000-0000-0000-0000000000a4'), '', 'and an admin sees nothing of it (0126)');
RESET ROLE;
DELETE FROM public.moth_layout_positions WHERE target_type IN ('note', 'mtag');

-- ── E. Planted: the read policy without Moth's gate on the target ───────────
SET LOCAL ROLE authenticated;
SELECT public.t126_c();
SELECT is(public.t126_put('12600000-0000-0000-0000-0000000000a1', '[{"t":"file","id":"12600000-0000-0000-0000-000000000081","x":1,"y":1}]'), 1, 'a place again');
RESET ROLE;
UPDATE public.files SET is_financial = true WHERE id = '12600000-0000-0000-0000-000000000081';
ALTER POLICY moth_layout_positions_select ON public.moth_layout_positions USING (
  workspace_id = public.current_workspace_id() AND public.has_active_membership(workspace_id)
  AND EXISTS (SELECT 1 FROM public.moth_views v WHERE v.id = moth_layout_positions.view_id AND v.workspace_id = moth_layout_positions.workspace_id)
  AND (owner_id IS NULL OR owner_id = auth.uid()));
SET LOCAL ROLE authenticated;
SELECT public.t126_c();
SELECT is((SELECT count(*)::int FROM public.moth_layout_positions WHERE target_id = '12600000-0000-0000-0000-000000000081'), 1,
  'CONTROL: without the target''s gate, the place of a file that became money would show');
RESET ROLE;
ALTER POLICY moth_layout_positions_select ON public.moth_layout_positions USING (
  workspace_id = public.current_workspace_id() AND public.has_active_membership(workspace_id)
  AND EXISTS (SELECT 1 FROM public.moth_views v WHERE v.id = moth_layout_positions.view_id AND v.workspace_id = moth_layout_positions.workspace_id)
  AND (owner_id IS NULL OR owner_id = auth.uid())
  AND (target_type = 'tag' OR public.moth_can_read_target(target_type, target_id)));
SET LOCAL ROLE authenticated;
SELECT public.t126_c();
SELECT is((SELECT count(*)::int FROM public.moth_layout_positions WHERE target_id = '12600000-0000-0000-0000-000000000081'), 0, '… and with it, none');
RESET ROLE;

-- The key to the view, planted id-only: as the database (no caller to take the company from), a place whose company
-- is not its view's is refused by the composite key, and lands without it.
SELECT is(public.t126_err($$ INSERT INTO public.moth_layout_positions (view_id, workspace_id, target_type, target_tag, x, y)
                             VALUES ('12600000-0000-0000-0000-0000000000a1', '22222222-2222-2222-2222-222222222222', 'tag', 'code', 1, 1) $$)
          LIKE '23503 %', true, 'a place''s company is its view''s (the composite key)');
ALTER TABLE public.moth_layout_positions DROP CONSTRAINT moth_layout_positions_view_fk;
ALTER TABLE public.moth_layout_positions ADD CONSTRAINT moth_layout_positions_view_fk_planted FOREIGN KEY (view_id) REFERENCES public.moth_views (id) ON DELETE CASCADE;
SELECT is(public.t126_err($$ INSERT INTO public.moth_layout_positions (view_id, workspace_id, target_type, target_tag, x, y)
                             VALUES ('12600000-0000-0000-0000-0000000000a1', '22222222-2222-2222-2222-222222222222', 'tag', 'code', 1, 1) $$),
  'no refusal', 'CONTROL: with the key planted id-only, the same place lands');
DELETE FROM public.moth_layout_positions WHERE workspace_id = '22222222-2222-2222-2222-222222222222';
ALTER TABLE public.moth_layout_positions DROP CONSTRAINT moth_layout_positions_view_fk_planted;
ALTER TABLE public.moth_layout_positions ADD CONSTRAINT moth_layout_positions_view_fk FOREIGN KEY (view_id, workspace_id) REFERENCES public.moth_views (id, workspace_id) ON DELETE CASCADE;

-- F. What the plants found unprobed (MO2's planted breakages): a level takes a place like the other kinds; a place
-- moved again takes its new marks; a task or a file that goes takes its places with it.
SELECT public.t126_a();
INSERT INTO public.levels (id, project_id, name) VALUES ('12600000-0000-0000-0000-0000000000f1', 'aaaa1260-0000-0000-0000-00000000000a', 'Dock');
INSERT INTO public.tasks (id, project_id, title) VALUES ('12600000-0000-0000-0000-0000000000f2', 'aaaa1260-0000-0000-0000-00000000000a', 'Grade');
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial) VALUES
  ('12600000-0000-0000-0000-0000000000f3', 'aaaa1260-0000-0000-0000-00000000000a', 'gone.png', 'supabase', 'projects/aaaa1260-0000-0000-0000-00000000000a/files/12600000-0000-0000-0000-0000000000f3/gone.png', false);
SET LOCAL ROLE authenticated;
SELECT public.t126_a();
SELECT is(public.t126_put('12600000-0000-0000-0000-0000000000a1', '[{"t":"level","id":"12600000-0000-0000-0000-0000000000f1","x":1,"y":2},{"t":"task","id":"12600000-0000-0000-0000-0000000000f2","x":3,"y":4},{"t":"file","id":"12600000-0000-0000-0000-0000000000f3","x":5,"y":6,"open":true,"pinned":true}]'::jsonb),
  3, 'a level, a task and a file each take a place in a shared view');
SELECT is(public.t126_put('12600000-0000-0000-0000-0000000000a1', '[{"t":"file","id":"12600000-0000-0000-0000-0000000000f3","x":7,"y":8}]'::jsonb), 1, 'the file''s place moved again');
SELECT is((SELECT is_open::text || ' ' || pinned::text || ' ' || x::text FROM public.moth_layout_positions WHERE view_id = '12600000-0000-0000-0000-0000000000a1' AND target_id = '12600000-0000-0000-0000-0000000000f3'),
  'false false 7', 'a place moved again takes its new marks, not the old ones');
RESET ROLE;
ALTER TABLE public.tasks DISABLE TRIGGER USER;
ALTER TABLE public.files DISABLE TRIGGER USER;
DELETE FROM public.tasks WHERE id = '12600000-0000-0000-0000-0000000000f2';
DELETE FROM public.files WHERE id = '12600000-0000-0000-0000-0000000000f3';
ALTER TABLE public.tasks ENABLE TRIGGER USER;
ALTER TABLE public.files ENABLE TRIGGER USER;
SELECT ok((SELECT count(*) FROM public.moth_layout_positions WHERE target_id IN ('12600000-0000-0000-0000-0000000000f2', '12600000-0000-0000-0000-0000000000f3')) = 0
          AND (SELECT count(*) FROM public.moth_layout_positions WHERE target_id = '12600000-0000-0000-0000-0000000000f1') = 1,
  'a task or a file that goes takes its places with it, and the level''s stays');

SELECT * FROM finish();
ROLLBACK;
