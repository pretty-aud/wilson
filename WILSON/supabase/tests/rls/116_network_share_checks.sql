-- =============================================================================
-- 116_network_share_checks.sql — migration 0117, a space's "last checked" row
-- (M.O.T.H. Session 1; docs/design/MOTH_DESIGN.md §1.4 "0117", §2.4 NS-D6, NS-D10, NS-X13).
--
-- What this pins:
--   * The table is what the design says: row security on and forced, one SELECT policy,
--     SELECT for authenticated, nothing for anon, and no client write.
--   * Who reads it: the project hop decides. A member of a public project, the creator
--     and an admin of a private one, the owner of a personal space and an admin there;
--     not another company, an inactive member, a non-creator of a private project, or
--     anybody once the project is in the trash.
--   * What the apply writes: its own clock, who checked, and that a walk split across
--     calls counts as one, moving "last checked" only at its final call.
--   * The thin broadcast: its own function, the project's id alone.
--
-- user_a is the admin (rls_setup); user_b the other company's admin; user_c a plain user
-- with a member seat on P; user_d a workspace manager with no seat; user_e a plain user
-- with a manager seat on P; user_n an inactive member whose token still says they belong.
-- Fixture ids: projects aaaa1111-…-0000000116xx. The drive and folders are built with
-- replace() and chr(92), so no backslash path sits in this file.
-- =============================================================================

BEGIN;

SELECT plan(38);

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
ON CONFLICT (workspace_id, user_id) DO NOTHING;

CREATE FUNCTION public.t116_as(p_user uuid, p_role text, p_ws uuid DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_role))::text, true);
END;
$f$;

CREATE FUNCTION public.t116_root() RETURNS text LANGUAGE sql IMMUTABLE AS
$f$ SELECT replace('//nas/share/wilson', '/', chr(92)) $f$;
CREATE FUNCTION public.t116_folder(p text) RETURNS text LANGUAGE sql IMMUTABLE AS
$f$ SELECT public.t116_root() || chr(92) || replace(p, '/', chr(92)) $f$;

CREATE FUNCTION public.t116_apply(p_project uuid, p_folder text, p_dirs jsonb, p_final boolean DEFAULT true, p_stopped text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS
$f$ SELECT public.network_share_catalogue_apply(p_project, public.t116_root(), p_folder, p_dirs, '[]'::jsonb, p_final, p_stopped) $f$;

INSERT INTO public.workspace_storage (workspace_id, mode, provider, root_path, root_kind)
VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 'network', public.t116_root(), 'unc');

-- 0049 asks the caller's seat, so the fixtures carry the admin's claims.
SELECT public.t116_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin');

INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, folder_root, personal_owner_id) VALUES
  ('aaaa1111-0000-0000-0000-000000011601', '11111111-1111-1111-1111-111111111111', 'Salt Hours', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, public.t116_folder('Salt-Hours'), NULL),
  ('aaaa1111-0000-0000-0000-000000011602', '11111111-1111-1111-1111-111111111111', 'Quiet Room', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true, public.t116_folder('Quiet-Room'), NULL),
  ('aaaa1111-0000-0000-0000-000000011603', '11111111-1111-1111-1111-111111111111', 'Personal space', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true, NULL, 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('aaaa1111-0000-0000-0000-000000011604', '11111111-1111-1111-1111-111111111111', 'Going Away', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, public.t116_folder('Going-Away'), NULL);

INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role)
VALUES
  ('aaaa1111-0000-0000-0000-000000011601', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1111-0000-0000-0000-000000011601', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'manager')
ON CONFLICT DO NOTHING;


-- ── the table ───────────────────────────────────────────────────────────
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.network_share_checks'::regclass),
  'network_share_checks has row level security on and forced');
SELECT is((SELECT count(*)::int FROM pg_policy WHERE polrelid = 'public.network_share_checks'::regclass), 1,
  'network_share_checks has one policy');
SELECT is((SELECT polcmd::text FROM pg_policy WHERE polrelid = 'public.network_share_checks'::regclass), 'r',
  'and it is a SELECT policy');
SELECT ok(has_table_privilege('authenticated', 'public.network_share_checks', 'SELECT'),
  'authenticated may read');
SELECT ok(NOT has_table_privilege('authenticated', 'public.network_share_checks', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'authenticated may write nothing');
SELECT ok(NOT has_table_privilege('anon', 'public.network_share_checks', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'anon holds nothing');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_network_share_checks_broadcast()'::regprocedure)
          AND NOT has_function_privilege('authenticated', 'public.fn_network_share_checks_broadcast()', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.fn_network_share_checks_broadcast()', 'EXECUTE'),
  'the broadcast is a definer no client may call');
SELECT ok((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_network_share_checks_broadcast()'::regprocedure)
            LIKE '%jsonb_build_object(''id'', v_project, ''project_id'', v_project)%'
          AND (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_network_share_checks_broadcast()'::regprocedure) NOT LIKE '%to_jsonb%',
  'the broadcast says the project''s id and nothing else');
SELECT is((SELECT count(*)::int FROM pg_trigger WHERE tgrelid = 'public.network_share_checks'::regclass AND NOT tgisinternal
            AND tgname IN ('trg_network_share_checks_broadcast', 'trg_network_share_checks_audit', 'trg_network_share_checks_populate_workspace')), 3,
  'its three triggers are on');


-- ── what the apply writes ──────────────────────────────────────────────
SELECT public.t116_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user');
SET LOCAL ROLE authenticated;
SELECT public.t116_apply('aaaa1111-0000-0000-0000-000000011601', 'Salt-Hours',
  '[{"d":"Salt-Hours","complete":true,"subdirs":[],"files":[{"n":"a.mov","s":"10"},{"n":"b.mov","s":"20"}]}]'::jsonb);
RESET ROLE;

CREATE TEMP TABLE t116_first ON COMMIT DROP AS
  SELECT * FROM public.network_share_checks WHERE project_id = 'aaaa1111-0000-0000-0000-000000011601';

SELECT is((SELECT last_checked_by FROM t116_first), 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, 'the check says who ran it');
SELECT is((SELECT files_seen FROM t116_first), 2, 'and how many files it saw');
SELECT is((SELECT workspace_id FROM t116_first), '11111111-1111-1111-1111-111111111111'::uuid, 'and it is in this company');
SELECT is((SELECT folder_locator FROM t116_first), 'Salt-Hours', 'and names the folder');
SELECT ok((SELECT complete FROM t116_first), 'a walk with every directory complete is complete');

SELECT public.t116_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin');
SET LOCAL ROLE authenticated;
SELECT public.t116_apply('aaaa1111-0000-0000-0000-000000011601', 'Salt-Hours',
  '[{"d":"Salt-Hours","complete":true,"subdirs":[],"files":[{"n":"a.mov","s":"10"}]}]'::jsonb);
RESET ROLE;

SELECT is((SELECT last_checked_by FROM public.network_share_checks WHERE project_id = 'aaaa1111-0000-0000-0000-000000011601'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'a second caller''s apply changes who checked');
SELECT is((SELECT files_seen FROM public.network_share_checks WHERE project_id = 'aaaa1111-0000-0000-0000-000000011601'), 1,
  'and the count');
SELECT ok((SELECT last_checked_at FROM public.network_share_checks WHERE project_id = 'aaaa1111-0000-0000-0000-000000011601')
            > (SELECT last_checked_at FROM t116_first),
  'and the time, within one transaction: its own clock, not now()');
SELECT is((SELECT missing_count FROM public.network_share_checks WHERE project_id = 'aaaa1111-0000-0000-0000-000000011601'), 1,
  'and how many it could not find');


-- ── a walk split across calls ─────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t116_apply('aaaa1111-0000-0000-0000-000000011601', 'Salt-Hours',
  '[{"d":"Salt-Hours/rushes","complete":true,"subdirs":[],"files":[{"n":"c.mov","s":"30"}]}]'::jsonb, false);
RESET ROLE;
CREATE TEMP TABLE t116_mid ON COMMIT DROP AS
  SELECT * FROM public.network_share_checks WHERE project_id = 'aaaa1111-0000-0000-0000-000000011601';
SELECT ok((SELECT run_open FROM t116_mid), 'a call that is not the last leaves the walk open');
SET LOCAL ROLE authenticated;
SELECT public.t116_apply('aaaa1111-0000-0000-0000-000000011601', 'Salt-Hours',
  '[{"d":"Salt-Hours/stills","complete":false,"subdirs":[],"files":[{"n":"d.tif","s":"40"}]}]'::jsonb, true, 'Salt-Hours/stills');
RESET ROLE;
SELECT is((SELECT files_seen FROM public.network_share_checks WHERE project_id = 'aaaa1111-0000-0000-0000-000000011601'), 2,
  'the final call counts the whole walk''s files');
SELECT is((SELECT dirs_checked FROM public.network_share_checks WHERE project_id = 'aaaa1111-0000-0000-0000-000000011601'), 2,
  'and its directories');
SELECT ok(NOT (SELECT complete FROM public.network_share_checks WHERE project_id = 'aaaa1111-0000-0000-0000-000000011601'),
  'a directory cut short makes the walk incomplete');
SELECT is((SELECT next_start FROM public.network_share_checks WHERE project_id = 'aaaa1111-0000-0000-0000-000000011601'), 'Salt-Hours/stills',
  'and says where the next one starts');
SELECT ok((SELECT last_checked_at FROM public.network_share_checks WHERE project_id = 'aaaa1111-0000-0000-0000-000000011601')
            > (SELECT last_checked_at FROM t116_mid),
  'only the final call moved last checked');
SELECT ok(NOT (SELECT run_open FROM public.network_share_checks WHERE project_id = 'aaaa1111-0000-0000-0000-000000011601'),
  'and it closes the walk');


-- ── who reads ─────────────────────────────────────────────────────────
INSERT INTO public.network_share_checks (project_id, workspace_id, folder_locator, last_checked_at, last_checked_by, complete)
VALUES
  ('aaaa1111-0000-0000-0000-000000011602', '11111111-1111-1111-1111-111111111111', 'Quiet-Room', now(), 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true),
  ('aaaa1111-0000-0000-0000-000000011603', '11111111-1111-1111-1111-111111111111', '_WILSON_PERSONAL/cccccccc-cccc-cccc-cccc-cccccccccccc', now(), 'cccccccc-cccc-cccc-cccc-cccccccccccc', true),
  ('aaaa1111-0000-0000-0000-000000011604', '11111111-1111-1111-1111-111111111111', 'Going-Away', now(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
UPDATE public.projects SET deleted_at = now() WHERE id = 'aaaa1111-0000-0000-0000-000000011604';

CREATE FUNCTION public.t116_seen(p uuid) RETURNS integer LANGUAGE sql STABLE AS
$f$ SELECT count(*)::int FROM public.network_share_checks c WHERE c.project_id = p $f$;

SET LOCAL ROLE authenticated;

SELECT public.t116_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user');
SELECT is(public.t116_seen('aaaa1111-0000-0000-0000-000000011601'), 1, 'a member reads a public project''s row');
SELECT is(public.t116_seen('aaaa1111-0000-0000-0000-000000011602'), 0, 'a plain user does not read a private project''s');
SELECT is(public.t116_seen('aaaa1111-0000-0000-0000-000000011603'), 1, 'the owner reads a personal space''s');

SELECT public.t116_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user');
SELECT is(public.t116_seen('aaaa1111-0000-0000-0000-000000011602'), 1, 'the creator reads a private project''s');
SELECT is(public.t116_seen('aaaa1111-0000-0000-0000-000000011603'), 0, 'nobody else''s personal space, for a plain user');

SELECT public.t116_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin');
SELECT is(public.t116_seen('aaaa1111-0000-0000-0000-000000011602'), 1, 'an admin reads a private project''s');
SELECT is(public.t116_seen('aaaa1111-0000-0000-0000-000000011604'), 0, 'nobody reads a trashed project''s, an admin included');

SELECT public.t116_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager');
SELECT is(public.t116_seen('aaaa1111-0000-0000-0000-000000011602'), 0, 'a manager who did not create a private project does not read its row');

SELECT public.t116_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222');
SELECT is(public.t116_seen('aaaa1111-0000-0000-0000-000000011601'), 0, 'another company''s admin reads nothing');

SELECT public.t116_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'user');
SELECT is(public.t116_seen('aaaa1111-0000-0000-0000-000000011601'), 0, 'an inactive member reads nothing');


-- ── no client write, for anyone ───────────────────────────────────────
SELECT public.t116_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin');
SELECT throws_ok($$
  INSERT INTO public.network_share_checks (project_id, workspace_id, folder_locator)
  VALUES ('aaaa1111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x')
$$, '42501', NULL, 'an admin cannot insert a check row');
SELECT throws_ok($$
  UPDATE public.network_share_checks SET files_seen = 0 WHERE project_id = 'aaaa1111-0000-0000-0000-000000011601'
$$, '42501', NULL, 'or update one');
SELECT throws_ok($$
  DELETE FROM public.network_share_checks WHERE project_id = 'aaaa1111-0000-0000-0000-000000011601'
$$, '42501', NULL, 'or delete one');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
