-- =============================================================================
-- 125_moth_views.sql — M.O.T.H. Session 2 (MO2): saved views (0123 §1).
--
-- A. Structure: forced row security, four policies each asking Moth's gate, the grants (no id, company or
--    owner from a client), the revision sequence, no channel.
-- B. Writing: a project's writers save a project's view, a reviewer cannot, anyone saves their own; the scope's
--    shape; the database says whose and which company's a view is; a config holds no id; the name's rules.
-- C. Reading: a project's views to those Moth shows the project to (a personal space's to its owner alone, no
--    admin leg; a private project's to its creator and admins); a person's own views to that person alone,
--    admins included; nothing to someone who has left or to another company.
-- D. Changing: the writers only; the revision moves with the config and not with a rename; a save from an old
--    copy changes nothing; the scope, project and owner never change.
-- E. Deleting, the cap, and a project in the trash.
-- F. Planted: the composite key dropped, and Moth's gate swapped for the projects hop alone; each must turn a
--    probe red, and each is put back.
-- G. What MO2's planted breakages found unprobed: a blanket write on another's own view; two companies. It runs
--    before F, because F's controls rewrite the read policy from this suite's own copy.
--
-- Fixture ids: projects aaaa1250-…, views by their names. Users as suite 124's: user_a admin, user_c a member
-- seated on P and creator of private X, user_d a workspace manager, user_e with personal space S, user_r P's
-- reviewer, user_n has left, user_b the other company's admin.
-- S4b-07's accepted class: a uuid-only 23505 cannot arise here, because a client sends no id.
-- =============================================================================

BEGIN;

SELECT plan(74);

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
    ('99999999-9999-9999-9999-999999999999'::uuid, 'user_r@test.local'),
    ('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, 'user_n@test.local')) u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager', 'user_d', 'User D', true),
  ('11111111-1111-1111-1111-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user', 'user_e', 'User E', true),
  ('11111111-1111-1111-1111-111111111111', '99999999-9999-9999-9999-999999999999', 'user', 'user_r', 'User R', true),
  ('11111111-1111-1111-1111-111111111111', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'user', 'user_n', 'User N', true)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET is_active = EXCLUDED.is_active, app_role = EXCLUDED.app_role;

CREATE FUNCTION public.t125_as(p_user uuid, p_role text, p_ws uuid DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_role))::text, true);
END;
$f$;
CREATE FUNCTION public.t125_a() RETURNS void LANGUAGE sql AS $f$ SELECT public.t125_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin') $f$;
CREATE FUNCTION public.t125_b() RETURNS void LANGUAGE sql AS $f$ SELECT public.t125_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222') $f$;
CREATE FUNCTION public.t125_c() RETURNS void LANGUAGE sql AS $f$ SELECT public.t125_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user') $f$;
CREATE FUNCTION public.t125_d() RETURNS void LANGUAGE sql AS $f$ SELECT public.t125_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager') $f$;
CREATE FUNCTION public.t125_e() RETURNS void LANGUAGE sql AS $f$ SELECT public.t125_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user') $f$;
CREATE FUNCTION public.t125_r() RETURNS void LANGUAGE sql AS $f$ SELECT public.t125_as('99999999-9999-9999-9999-999999999999', 'user') $f$;
CREATE FUNCTION public.t125_n() RETURNS void LANGUAGE sql AS $f$ SELECT public.t125_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'user') $f$;

-- A view's id by its name, as the database sees it.
CREATE FUNCTION public.t125_id(p_name text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT id FROM public.moth_views WHERE name = p_name
$f$;
GRANT EXECUTE ON FUNCTION public.t125_id(text) TO authenticated;
-- The names a caller can see, in order.
CREATE FUNCTION public.t125_seen() RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT COALESCE(string_agg(name, ', ' ORDER BY name), '') FROM public.moth_views
$f$;
CREATE FUNCTION public.t125_err(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  s text;
BEGIN
  EXECUTE p_sql;
  RETURN 'no refusal';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS s = RETURNED_SQLSTATE;
  RETURN s;
END;
$f$;

SELECT public.t125_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1250-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Salt Hours', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1250-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Second', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL);
SELECT public.t125_c();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1250-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Private', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true, NULL);
SELECT public.t125_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1250-0000-0000-0000-0000000000e0', '11111111-1111-1111-1111-111111111111', 'Personal space', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1250-0000-0000-0000-00000000000a', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1250-0000-0000-0000-00000000000a', '99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'reviewer')
ON CONFLICT DO NOTHING;

-- ── A. Structure ────────────────────────────────────────────────────────────
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.moth_views'::regclass), 'row security is forced');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'moth_views'), 4, 'four policies');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'moth_views' AND (cmd = 'ALL' OR permissive <> 'PERMISSIVE')), 0,
  'none FOR ALL, none restrictive');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'moth_views'
            AND COALESCE(qual, '') || COALESCE(with_check, '') ~ 'moth_can_(read|write)_target'), 4, 'every policy asks Moth''s gate (S6)');
SELECT ok(has_table_privilege('authenticated', 'public.moth_views', 'SELECT') AND has_table_privilege('authenticated', 'public.moth_views', 'DELETE')
          AND NOT has_table_privilege('anon', 'public.moth_views', 'SELECT'), 'signed-in callers read and delete; anon nothing');
SELECT is((SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.column_privileges
            WHERE table_schema = 'public' AND table_name = 'moth_views' AND grantee = 'authenticated' AND privilege_type = 'INSERT'),
  'config,name,position,project_id,scope_kind', 'a client inserts the scope, the project, a name, a place in the list and a config, and nothing else');
SELECT is((SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.column_privileges
            WHERE table_schema = 'public' AND table_name = 'moth_views' AND grantee = 'authenticated' AND privilege_type = 'UPDATE'),
  'config,name,position', 'and changes a name, a place in the list and a config only');
SELECT ok(has_sequence_privilege('authenticated', 'public.moth_views_revision_seq', 'USAGE')
          AND NOT has_sequence_privilege('authenticated', 'public.moth_views_revision_seq', 'UPDATE')
          AND NOT has_sequence_privilege('authenticated', 'public.moth_views_revision_seq', 'SELECT'), 'the revision sequence: USAGE only');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_proc pr ON pr.oid = tg.tgfoid
                       WHERE tg.tgrelid = 'public.moth_views'::regclass AND NOT tg.tgisinternal AND pr.proname ~ 'broadcast')
          AND NOT EXISTS (SELECT 1 FROM pg_proc pr WHERE pr.pronamespace = 'public'::regnamespace AND pr.proname ~ 'broadcast'
                           AND position('moth_views' IN pr.prosrc) > 0),
  'no view is sent on a channel: no broadcast trigger on the table, and no broadcast function names it (0016)');
SELECT ok(NOT has_function_privilege('authenticated', 'public.fn_moth_views_pin()', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.fn_moth_views_cap()', 'EXECUTE'), 'the triggers are not a client''s to call');

-- ── B. Writing ──────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t125_c();
SELECT lives_ok($$ INSERT INTO public.moth_views (scope_kind, project_id, name, config)
                    VALUES ('project', 'aaaa1250-0000-0000-0000-00000000000a', 'P shared', '{"layout":"force","nodeKinds":["project","folder","file"]}') $$,
  'a seated member saves a view of P');
SELECT public.t125_a();
SELECT lives_ok($$ INSERT INTO public.moth_views (scope_kind, project_id, name) VALUES ('project', 'aaaa1250-0000-0000-0000-00000000000a', 'P admin') $$,
  'the admin saves a view of P');
SELECT lives_ok($$ INSERT INTO public.moth_views (scope_kind, name) VALUES ('aggregate', 'A own') $$, 'the admin saves a view of their own');
SELECT public.t125_r();
SELECT is(public.t125_err($$ INSERT INTO public.moth_views (scope_kind, project_id, name) VALUES ('project', 'aaaa1250-0000-0000-0000-00000000000a', 'R tries') $$),
  '42501', 'the reviewer cannot save a view of P');
SELECT lives_ok($$ INSERT INTO public.moth_views (scope_kind, name, config) VALUES ('aggregate', 'R own', '{"layout":"radial"}') $$,
  'the reviewer saves a view of their own');
SELECT public.t125_e();
SELECT lives_ok($$ INSERT INTO public.moth_views (scope_kind, project_id, name) VALUES ('project', 'aaaa1250-0000-0000-0000-0000000000e0', 'S own') $$,
  'the owner saves a view of their personal space');
SELECT public.t125_a();
SELECT is(public.t125_err($$ INSERT INTO public.moth_views (scope_kind, project_id, name) VALUES ('project', 'aaaa1250-0000-0000-0000-0000000000e0', 'A into S') $$),
  '42501', 'the admin cannot save a view of another person''s space');
SELECT public.t125_c();
SELECT lives_ok($$ INSERT INTO public.moth_views (scope_kind, project_id, name) VALUES ('project', 'aaaa1250-0000-0000-0000-00000000000c', 'X view') $$,
  'the creator saves a view of private X');
SELECT public.t125_d();
SELECT is(public.t125_err($$ INSERT INTO public.moth_views (scope_kind, project_id, name) VALUES ('project', 'aaaa1250-0000-0000-0000-00000000000c', 'D into X') $$),
  '42501', 'a workspace manager cannot save a view of private X');
SELECT public.t125_b();
SELECT is(public.t125_err($$ INSERT INTO public.moth_views (scope_kind, project_id, name) VALUES ('project', 'aaaa1250-0000-0000-0000-00000000000a', 'B into P') $$),
  '42501', 'another company cannot save a view of P');
SELECT is(public.t125_err($$ INSERT INTO public.moth_views (scope_kind, project_id, name) VALUES ('project', 'aaaa1250-0000-0000-0000-0000000000ff', 'B into none') $$),
  '42501', '… the same answer as for a project that does not exist');
SELECT public.t125_n();
SELECT lives_ok($$ INSERT INTO public.moth_views (scope_kind, name) VALUES ('aggregate', 'N own') $$, 'an active member saves their own view');

SELECT public.t125_c();
SELECT is(public.t125_err($$ INSERT INTO public.moth_views (scope_kind, project_id, name) VALUES ('aggregate', 'aaaa1250-0000-0000-0000-00000000000a', 'mixed') $$),
  '23514', 'a view of one''s own names no project');
SELECT is(public.t125_err($$ INSERT INTO public.moth_views (scope_kind, name) VALUES ('project', 'no project') $$),
  '42501', 'a project''s view names its project (row security answers before the CHECK)');
SELECT is(public.t125_err($$ INSERT INTO public.moth_views (scope_kind, name) VALUES ('team', 'odd scope') $$),
  '42501', 'there are two scopes');
SELECT is(public.t125_err($$ INSERT INTO public.moth_views (id, scope_kind, name) VALUES ('12500000-0000-0000-0000-000000000001', 'aggregate', 'chosen id') $$),
  '42501', 'a client cannot choose an id');
SELECT is(public.t125_err($$ INSERT INTO public.moth_views (scope_kind, owner_id, name) VALUES ('aggregate', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'for D') $$),
  '42501', 'nor an owner');
SELECT is(public.t125_err($$ INSERT INTO public.moth_views (scope_kind, workspace_id, name) VALUES ('aggregate', '22222222-2222-2222-2222-222222222222', 'elsewhere') $$),
  '42501', 'nor a company');
SELECT is(public.t125_err($$ INSERT INTO public.moth_views (scope_kind, name, config) VALUES ('aggregate', 'has id', '{"focus":"12400000-0000-0000-0000-000000000051"}') $$),
  '23514', 'a config holds no id');
SELECT is(public.t125_err($$ INSERT INTO public.moth_views (scope_kind, name, config) VALUES ('aggregate', 'has bare id', '{"k":"124000000000000000000000000000ab"}') $$),
  '23514', 'nor one without its hyphens');
SELECT is(public.t125_err($$ INSERT INTO public.moth_views (scope_kind, name, config) VALUES ('aggregate', 'has upper id', '{"k":"12400000-0000-0000-0000-0000000000AB"}') $$),
  '23514', 'nor one in capitals');
SELECT is(public.t125_err($$ INSERT INTO public.moth_views (scope_kind, name, position) VALUES ('aggregate', 'below', -1) $$),
  '23514', 'a place in the list is not below the first');
SELECT is(public.t125_err($$ INSERT INTO public.moth_views (scope_kind, name, config) VALUES ('aggregate', 'has array', '[1]') $$),
  '23514', 'a config is an object');
SELECT is(public.t125_err($$ INSERT INTO public.moth_views (scope_kind, name, config) VALUES ('aggregate', 'big', jsonb_build_object('pad', repeat('x', 33000))) $$),
  '23514', 'of at most 32 KB');
SELECT is(public.t125_err($$ INSERT INTO public.moth_views (scope_kind, name) VALUES ('aggregate', ' padded') $$), '23514', 'a name is trimmed');
SELECT is(public.t125_err($$ INSERT INTO public.moth_views (scope_kind, name) VALUES ('aggregate', repeat('n', 81)) $$), '23514', 'of at most 80 characters');
SELECT is(public.t125_err(format($$ INSERT INTO public.moth_views (scope_kind, name) VALUES ('aggregate', %L) $$, 'a' || chr(10) || 'b')), '23514', 'with no control character');
RESET ROLE;

SELECT is((SELECT owner_id FROM public.moth_views WHERE name = 'R own'), '99999999-9999-9999-9999-999999999999'::uuid, 'a view of one''s own is the caller''s');
SELECT ok((SELECT owner_id IS NULL AND workspace_id = '11111111-1111-1111-1111-111111111111' AND created_by = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
             FROM public.moth_views WHERE name = 'P shared'), 'a project''s view has no owner, is of the caller''s company, and says who made it');
SELECT ok((SELECT revision > 0 FROM public.moth_views WHERE name = 'P shared'), 'a new view has a revision');

-- ── C. Reading ──────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t125_a();
SELECT is(public.t125_seen(), 'A own, P admin, P shared, X view', 'the admin: P''s views, private X''s, and their own; not S''s, not others'' own');
SELECT public.t125_c();
SELECT is(public.t125_seen(), 'P admin, P shared, X view', 'the creator: P''s views and private X''s');
SELECT public.t125_r();
SELECT is(public.t125_seen(), 'P admin, P shared, R own', 'the reviewer: P''s views and their own');
SELECT public.t125_d();
SELECT is(public.t125_seen(), 'P admin, P shared', 'a workspace manager: P''s views, not private X''s');
SELECT public.t125_e();
SELECT is(public.t125_seen(), 'P admin, P shared, S own', 'the owner: their own space''s view, and P''s');
SELECT public.t125_b();
SELECT is(public.t125_seen(), '', 'another company sees none');
RESET ROLE;
SELECT public.t125_a();
UPDATE public.workspace_members SET is_active = false
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
SET LOCAL ROLE authenticated;
SELECT public.t125_n();
SELECT is(public.t125_seen(), '', 'someone who has left sees none, their own included');
SELECT is(public.t125_err($$ INSERT INTO public.moth_views (scope_kind, name) VALUES ('aggregate', 'N again') $$), '42501',
  'nor saves one');
UPDATE public.moth_views SET name = 'N renamed' WHERE id = public.t125_id('N own');
DELETE FROM public.moth_views WHERE id = public.t125_id('N own');
RESET ROLE;
SELECT is((SELECT name FROM public.moth_views WHERE id = public.t125_id('N own')), 'N own', 'nor changes or deletes their own');

-- ── D. Changing ─────────────────────────────────────────────────────────────
SELECT set_config('t125.rev', (SELECT revision::text FROM public.moth_views WHERE name = 'P shared'), true);
SET LOCAL ROLE authenticated;
SELECT public.t125_c();
UPDATE public.moth_views SET name = 'P renamed' WHERE id = public.t125_id('P shared');
SELECT is((SELECT revision::text FROM public.moth_views WHERE name = 'P renamed'), current_setting('t125.rev'), 'a rename keeps the revision');
UPDATE public.moth_views SET position = 3 WHERE id = public.t125_id('P renamed');
SELECT is((SELECT revision::text || ':' || position::text FROM public.moth_views WHERE name = 'P renamed'), current_setting('t125.rev') || ':3',
  'a reorder keeps the revision too');
UPDATE public.moth_views SET config = '{"layout":"radial"}' WHERE id = public.t125_id('P renamed');
SELECT ok((SELECT revision::text FROM public.moth_views WHERE name = 'P renamed') <> current_setting('t125.rev'), 'a new config is a new revision');
UPDATE public.moth_views SET config = '{"layout":"force"}' WHERE id = public.t125_id('P renamed') AND revision = current_setting('t125.rev')::bigint;
SELECT is((SELECT config ->> 'layout' FROM public.moth_views WHERE name = 'P renamed'), 'radial', 'a save from an old copy changes nothing');
SELECT is(public.t125_err($$ UPDATE public.moth_views SET project_id = 'aaaa1250-0000-0000-0000-00000000000b' WHERE name = 'P renamed' $$), '42501',
  'a view''s project cannot be changed');
SELECT is(public.t125_err($$ UPDATE public.moth_views SET scope_kind = 'aggregate' WHERE name = 'P renamed' $$), '42501', 'nor its scope');
SELECT public.t125_r();
UPDATE public.moth_views SET name = 'R renames P' WHERE id = public.t125_id('P admin');
SELECT is((SELECT count(*)::int FROM public.moth_views WHERE name = 'P admin'), 1, 'the reviewer cannot change P''s view');
UPDATE public.moth_views SET name = 'R own 2' WHERE id = public.t125_id('R own');
SELECT is((SELECT count(*)::int FROM public.moth_views WHERE name = 'R own 2'), 1, 'the reviewer changes their own');
SELECT public.t125_a();
UPDATE public.moth_views SET name = 'A renames R' WHERE id = public.t125_id('R own 2');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.moth_views WHERE name = 'R own 2'), 1, 'the admin cannot change another person''s own view');

-- ── E. Deleting, the cap, a project in the trash ────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t125_r();
DELETE FROM public.moth_views WHERE id = public.t125_id('P admin');
SELECT public.t125_a();
DELETE FROM public.moth_views WHERE id = public.t125_id('R own 2');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.moth_views WHERE name IN ('P admin', 'R own 2')), 2,
  'neither the reviewer nor the admin deletes what is not theirs to');
SET LOCAL ROLE authenticated;
SELECT public.t125_c();
DELETE FROM public.moth_views WHERE id = public.t125_id('P admin');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.moth_views WHERE name = 'P admin'), 0, 'a writer deletes P''s view');

SET LOCAL ROLE authenticated;
SELECT public.t125_a();
INSERT INTO public.moth_views (scope_kind, project_id, name)
  SELECT 'project', 'aaaa1250-0000-0000-0000-00000000000b', 'cap ' || g FROM generate_series(1, 200) g;
SELECT is(public.t125_err($$ INSERT INTO public.moth_views (scope_kind, project_id, name) VALUES ('project', 'aaaa1250-0000-0000-0000-00000000000b', 'cap 201') $$),
  '54000', 'a project holds at most 200 views');
SELECT public.t125_c();
INSERT INTO public.moth_views (scope_kind, name) SELECT 'aggregate', 'own ' || g FROM generate_series(1, 200) g;
SELECT is(public.t125_err($$ INSERT INTO public.moth_views (scope_kind, name) VALUES ('aggregate', 'own 201') $$), '54000', 'and a person 200 of their own');
SELECT public.t125_e();
SELECT lives_ok($$ INSERT INTO public.moth_views (scope_kind, name) VALUES ('aggregate', 'E own') $$, 'another person''s count is their own');
RESET ROLE;

SELECT public.t125_a();
UPDATE public.projects SET deleted_at = now() WHERE id = 'aaaa1250-0000-0000-0000-00000000000c';
SET LOCAL ROLE authenticated;
SELECT public.t125_c();
SELECT is((SELECT count(*)::int FROM public.moth_views WHERE name = 'X view'), 0, 'a project in the trash shows none of its views');
RESET ROLE;
SELECT public.t125_a();
DELETE FROM public.projects WHERE id = 'aaaa1250-0000-0000-0000-00000000000b';
SELECT is((SELECT count(*)::int FROM public.moth_views WHERE name LIKE 'cap %'), 0, 'a project removed for good takes its views with it');

-- G. What the plants found unprobed. A blanket write reaches another's own view through the write policies alone
-- (a write that names its row is judged by the read policy too), so each is tried with no WHERE. Someone in two
-- companies sees, in one, only that company's own views.
SELECT public.t125_a();
INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES ('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c_two', 'User C Two', true)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET is_active = true;
SET LOCAL ROLE authenticated;
SELECT public.t125_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', '22222222-2222-2222-2222-222222222222');
SELECT lives_ok($$ INSERT INTO public.moth_views (scope_kind, name) VALUES ('aggregate', 'C elsewhere') $$,
  'someone in two companies saves a view of their own in the second');
SELECT ok(position('C elsewhere' IN public.t125_seen()) > 0, 'CONTROL: from the second company, its own view is seen');
SELECT public.t125_c();
SELECT is(position('C elsewhere' IN public.t125_seen()), 0, 'in the first company, the second company''s own view is not seen');
RESET ROLE;
CREATE TEMP TABLE t125_others ON COMMIT DROP AS
  SELECT id, name FROM public.moth_views WHERE scope_kind = 'aggregate' AND owner_id <> '99999999-9999-9999-9999-999999999999';
GRANT SELECT ON t125_others TO authenticated;
SET LOCAL ROLE authenticated;
SELECT public.t125_r();
SELECT public.t125_err($$ UPDATE public.moth_views SET name = 'r was here' $$);
SELECT public.t125_err($$ DELETE FROM public.moth_views $$);
RESET ROLE;
SELECT ok((SELECT count(*)::int FROM t125_others) >= 3
          AND (SELECT count(*)::int FROM t125_others o JOIN public.moth_views v ON v.id = o.id AND v.name = o.name)
            = (SELECT count(*)::int FROM t125_others),
  'a blanket rename and a blanket delete by P''s reviewer leave every other person''s own view as it was');

-- No admin leg in either write policy: an admin's blanket rename and delete leave another person's personal-space
-- views as they were (MO2 review round 1).
CREATE TEMP TABLE t125_space ON COMMIT DROP AS SELECT id, name FROM public.moth_views WHERE project_id = 'aaaa1250-0000-0000-0000-0000000000e0';
GRANT SELECT ON t125_space TO authenticated;
SET LOCAL ROLE authenticated;
SELECT public.t125_a();
SELECT public.t125_err($$ UPDATE public.moth_views SET name = 'admin was here' $$);
SELECT public.t125_err($$ DELETE FROM public.moth_views $$);
RESET ROLE;
SELECT ok((SELECT count(*) FROM t125_space) >= 1
          AND (SELECT count(*) FROM t125_space o JOIN public.moth_views v ON v.id = o.id AND v.name = o.name) = (SELECT count(*) FROM t125_space),
  'an admin''s blanket rename and delete leave another person''s personal-space views as they were');

-- ── F. Planted controls ─────────────────────────────────────────────────────
-- The composite key: a row whose company is not its project's. As the database (no caller, so the pin keeps the
-- company sent), the key refuses it; with the key planted id-only, it lands.
SELECT set_config('request.jwt.claims', '{}', true);
SELECT is(public.t125_err($$ INSERT INTO public.moth_views (workspace_id, scope_kind, project_id, name)
                             VALUES ('22222222-2222-2222-2222-222222222222', 'project', 'aaaa1250-0000-0000-0000-00000000000a', 'crossed') $$),
  '23503', 'a view''s project is of the view''s own company (the composite key)');
ALTER TABLE public.moth_views DROP CONSTRAINT moth_views_project_fk;
ALTER TABLE public.moth_views ADD CONSTRAINT moth_views_project_fk_planted FOREIGN KEY (project_id) REFERENCES public.projects (id) ON DELETE CASCADE;
SELECT is(public.t125_err($$ INSERT INTO public.moth_views (workspace_id, scope_kind, project_id, name)
                             VALUES ('22222222-2222-2222-2222-222222222222', 'project', 'aaaa1250-0000-0000-0000-00000000000a', 'crossed') $$),
  'no refusal', 'CONTROL: with the key planted id-only, the same row lands');
DELETE FROM public.moth_views WHERE name = 'crossed';
ALTER TABLE public.moth_views DROP CONSTRAINT moth_views_project_fk_planted;
ALTER TABLE public.moth_views ADD CONSTRAINT moth_views_project_fk FOREIGN KEY (project_id, workspace_id) REFERENCES public.projects (id, workspace_id) ON DELETE CASCADE;

-- Moth's gate swapped for the projects hop alone: the admin then sees the owner's view of their personal space.
SELECT public.t125_e();
INSERT INTO public.moth_views (scope_kind, project_id, name) VALUES ('project', 'aaaa1250-0000-0000-0000-0000000000e0', 'S again');
ALTER POLICY moth_views_select ON public.moth_views USING (
  workspace_id = public.current_workspace_id() AND public.has_active_membership(workspace_id)
  AND ((scope_kind = 'project' AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = moth_views.project_id AND p.workspace_id = moth_views.workspace_id))
       OR (scope_kind = 'aggregate' AND owner_id = auth.uid())));
SET LOCAL ROLE authenticated;
SELECT public.t125_a();
SELECT is((SELECT count(*)::int FROM public.moth_views WHERE name IN ('S own', 'S again')), 2,
  'CONTROL: with the hop alone, the admin would see another person''s personal-space views');
RESET ROLE;
ALTER POLICY moth_views_select ON public.moth_views USING (
  workspace_id = public.current_workspace_id() AND public.has_active_membership(workspace_id)
  AND ((scope_kind = 'project'
        AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = moth_views.project_id AND p.workspace_id = moth_views.workspace_id)
        AND public.moth_can_read_target('project', project_id))
       OR (scope_kind = 'aggregate' AND owner_id = auth.uid())));
SET LOCAL ROLE authenticated;
SELECT public.t125_a();
SELECT is((SELECT count(*)::int FROM public.moth_views WHERE name IN ('S own', 'S again')), 0, '… and with Moth''s gate put back, none');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
