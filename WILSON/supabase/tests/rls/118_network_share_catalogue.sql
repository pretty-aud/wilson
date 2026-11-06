-- =============================================================================
-- 118_network_share_catalogue.sql — migration 0117, the office server as a catalogue and
-- the desktop as its file manager (M.O.T.H. Session 1; docs/design/MOTH_DESIGN.md §1.2,
-- §1.4 "0117", §1.5, §1.6, §2.2 PS-7, §2.4). Table-less: 116 and 117 hold the tables.
--
-- What this pins, in order:
--   A  what a locator may be, and a bin path
--   B  which folder is whose: network_share_space_folder and network_share_claims
--   C  the projects guard's two new arms, with a slug's shape
--   D  the three CHECKs on files, by name, and the live-rows index
--   E  an apply: added, kept, changed, missing, found again, renamed, dropped
--   F  an apply's refusals
--   G  what stands guard over a row after an apply: the marker, 0114's guard, and this
--      file's guard on a client's hard delete
--   H  the file manager: trash, restore, settle, add, pending_mine, the two cores
--   I  a purge: the certificate, the queue, the meter and purge_ok
--   J  a personal space on the office server (PS-7)
--   K  who may call what, and who names the marker
--   M  what the first review found: gates, a row its folder has left, nested folders, a split
--      walk, a capped sweep, a rename across calls, a held purge, and the sentence of each refusal
--   L  the row cap (last: it drops the CHECKs and triggers inside this transaction)
--
-- user_a is the admin (rls_setup); user_b the other company's admin; user_c a plain user
-- with a member seat on P, and the owner of the personal space R; user_d a workspace manager
-- with no seat; user_e a plain user with a manager seat on P, who made the private project Q;
-- user_v a plain user with a reviewer seat on P, who cannot write it; user_n an inactive
-- member whose token still says they belong.
--
-- Fixture ids: projects aaaa1111-…-0000000118xx, folders 11800000-…-0000000000fx, files
-- 11800000-…-000000000xxx. Drive and folders are built with replace() and chr(92), so no
-- backslash path sits in this file. No probe is a multi-line text literal: tap-hosted.py
-- builds CRLF on her PC and CI builds LF.
-- =============================================================================

BEGIN;

SELECT plan(382);

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
    ('abababab-abab-abab-abab-abababababab'::uuid, 'user_v@test.local'),
    ('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, 'user_n@test.local')) u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager', 'user_d', 'User D', true),
  ('11111111-1111-1111-1111-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user', 'user_e', 'User E', true),
  ('11111111-1111-1111-1111-111111111111', 'abababab-abab-abab-abab-abababababab', 'user', 'user_v', 'User V', true),
  ('11111111-1111-1111-1111-111111111111', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'user', 'user_n', 'User N', false)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- Who is asking.
CREATE FUNCTION public.t118_as(p_user uuid, p_role text, p_ws uuid DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_role))::text, true);
END;
$f$;
CREATE FUNCTION public.t118_a() RETURNS void LANGUAGE sql AS $f$ SELECT public.t118_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin') $f$;
CREATE FUNCTION public.t118_c() RETURNS void LANGUAGE sql AS $f$ SELECT public.t118_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user') $f$;
CREATE FUNCTION public.t118_d() RETURNS void LANGUAGE sql AS $f$ SELECT public.t118_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager') $f$;
CREATE FUNCTION public.t118_e() RETURNS void LANGUAGE sql AS $f$ SELECT public.t118_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user') $f$;
CREATE FUNCTION public.t118_v() RETURNS void LANGUAGE sql AS $f$ SELECT public.t118_as('abababab-abab-abab-abab-abababababab', 'user') $f$;

CREATE FUNCTION public.t118_root() RETURNS text LANGUAGE sql IMMUTABLE AS
$f$ SELECT replace('//nas/share/wilson', '/', chr(92)) $f$;
CREATE FUNCTION public.t118_folder(p text) RETURNS text LANGUAGE sql IMMUTABLE AS
$f$ SELECT public.t118_root() || chr(92) || replace(p, '/', chr(92)) $f$;

CREATE FUNCTION public.t118_apply(p_project uuid, p_folder text, p_dirs jsonb, p_bin jsonb DEFAULT '[]'::jsonb,
                                  p_final boolean DEFAULT true, p_stopped text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS
$f$ SELECT public.network_share_catalogue_apply(p_project, public.t118_root(), p_folder, p_dirs, p_bin, p_final, p_stopped) $f$;

-- One directory, as a walk sends it. A file is [name, size]; each carries the same fixed time.
CREATE FUNCTION public.t118_dir(p_d text, p_complete boolean, p_subdirs text[], p_files jsonb)
RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object('d', p_d, 'complete', p_complete, 'subdirs', to_jsonb(p_subdirs),
    'files', COALESCE((SELECT jsonb_agg(jsonb_build_object('n', f ->> 0, 's', f ->> 1, 'm', '2026-10-01T10:00:00Z'))
                         FROM jsonb_array_elements(p_files) f), '[]'::jsonb));
$f$;

-- The id of the row at a locator, live or not, and a row's own facts, read as the runner.
CREATE FUNCTION public.t118_id(p_loc text) RETURNS uuid LANGUAGE sql STABLE AS
$f$ SELECT f.id FROM public.files f WHERE f.storage_path = 'nas:' || p_loc ORDER BY f.deleted_at NULLS FIRST LIMIT 1 $f$;

CREATE FUNCTION public.t118_top(p_a_size text DEFAULT '10') RETURNS jsonb LANGUAGE sql AS $f$
  SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours',
    jsonb_build_array(jsonb_build_object('d', 'Salt-Hours', 'complete', true, 'subdirs', '[]'::jsonb, 'files',
      jsonb_build_array(
        jsonb_build_object('n', 'a.mov', 's', p_a_size, 'm', '2026-10-01T10:00:00Z', 't', 'video/quicktime'),
        jsonb_build_object('n', 'b.mov', 's', '20', 'm', '2026-10-01T10:00:00Z'),
        jsonb_build_object('n', 'c.txt', 's', '30')))));
$f$;

CREATE FUNCTION public.t118_many(p_n integer) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  FOR i IN 1 .. p_n LOOP
    PERFORM public.t118_apply('aaaa1111-0000-0000-0000-000000011805', 'Rate', '[]'::jsonb, '[]'::jsonb, false);
  END LOOP;
END;
$f$;

CREATE TEMP TABLE t118_ret (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON t118_ret TO authenticated;

-- A row as nothing but the runner can write it: unbound, so no guard judges it.
CREATE FUNCTION public.t118_row(p_id uuid, p_project uuid, p_loc text, p_size bigint DEFAULT 1)
RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, size_bytes, source_modified_at)
  VALUES (p_id, p_project, regexp_replace(p_loc, '^.*/', ''), 'network_share', 'nas:' || p_loc, p_size, '2026-10-01T10:00:00Z');
$f$;

INSERT INTO public.workspace_storage (workspace_id, mode, provider, root_path, root_kind)
VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 'network', public.t118_root(), 'unc');

-- 0049 asks the caller's seat, so the fixtures carry the admin's claims.
SELECT public.t118_a();

INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, folder_root, personal_owner_id) VALUES
  ('aaaa1111-0000-0000-0000-000000011801', '11111111-1111-1111-1111-111111111111', 'Salt Hours', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, public.t118_folder('Salt-Hours'), NULL),
  ('aaaa1111-0000-0000-0000-000000011802', '11111111-1111-1111-1111-111111111111', 'Quiet Room', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true, public.t118_folder('Quiet-Room'), NULL),
  ('aaaa1111-0000-0000-0000-000000011803', '11111111-1111-1111-1111-111111111111', 'No Folder', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL, NULL),
  ('aaaa1111-0000-0000-0000-000000011804', '11111111-1111-1111-1111-111111111111', 'Personal space', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true, NULL, 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('aaaa1111-0000-0000-0000-000000011805', '11111111-1111-1111-1111-111111111111', 'Rate', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, public.t118_folder('Rate'), NULL),
  ('aaaa1111-0000-0000-0000-000000011806', '11111111-1111-1111-1111-111111111111', 'Moon Film', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, public.t118_folder('Moon-Film'), NULL),
  ('aaaa1111-0000-0000-0000-000000011807', '11111111-1111-1111-1111-111111111111', 'Goner', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, public.t118_folder('Goner'), NULL),
  ('aaaa1111-0000-0000-0000-000000011808', '11111111-1111-1111-1111-111111111111', 'Leaving', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, public.t118_folder('Leaving'), NULL);

INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1111-0000-0000-0000-000000011801', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1111-0000-0000-0000-000000011801', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'manager'),
  ('aaaa1111-0000-0000-0000-000000011801', 'abababab-abab-abab-abab-abababababab', '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1111-0000-0000-0000-000000011806', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT DO NOTHING;

INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('11800000-0000-0000-0000-0000000000f0', 'aaaa1111-0000-0000-0000-000000011801', NULL, 'root', 'salt', ''),
  ('11800000-0000-0000-0000-0000000000f1', 'aaaa1111-0000-0000-0000-000000011801', '11800000-0000-0000-0000-0000000000f0', 'category', 'rushes', 'rushes'),
  ('11800000-0000-0000-0000-0000000000f2', 'aaaa1111-0000-0000-0000-000000011801', '11800000-0000-0000-0000-0000000000f1', 'category', 'day1', 'rushes/day1'),
  ('11800000-0000-0000-0000-0000000000f3', 'aaaa1111-0000-0000-0000-000000011801', '11800000-0000-0000-0000-0000000000f0', 'category', 'invoices', 'INVOICES'),
  ('11800000-0000-0000-0000-0000000000f4', 'aaaa1111-0000-0000-0000-000000011806', NULL, 'root', 'moon', ''),
  ('11800000-0000-0000-0000-0000000000f5', 'aaaa1111-0000-0000-0000-000000011806', '11800000-0000-0000-0000-0000000000f4', 'category', 'plates', 'plates'),
  ('11800000-0000-0000-0000-0000000000f6', 'aaaa1111-0000-0000-0000-000000011801', '11800000-0000-0000-0000-0000000000f0', 'category', 'gone', 'gone');


-- ── A. What a locator may be ─────────────────────────────────────────────────
SELECT ok(public.network_share_locator_ok('Salt-Hours/rushes/A001.mov'), 'a plain path is a locator');
SELECT ok(public.network_share_locator_ok('_WILSON_PERSONAL/cccccccc-cccc-cccc-cccc-cccccccccccc/x.mov'), 'and a personal space''s');
SELECT ok(public.network_share_locator_ok('a/My Clip (2).mov'), 'and a name with spaces and brackets');
SELECT ok(public.network_share_locator_ok('a/caf' || chr(233) || '.mov'), 'and an accented name in NFC');
SELECT is((SELECT array_agg(x) FROM unnest(ARRAY[
    'a/INVOICES/x', 'a/invoices/x', 'FINANCE/x', 'a/Legal/x', 'a/P_DATABASES/b', 'a/P_RECEIPTS&INVOICES/b',
    'a/x_crewinvoices/b', 'a/x_talentinvoices/b', 'a/.wilson/x', '.a', 'a/../b', '../b', 'a/..', 'a' || chr(92) || 'b',
    'C:/x', 'a//b', '/a', 'a/', 'a/b.', 'a/b ', 'a' || chr(8238) || 'b', 'e' || chr(769), 'a' || chr(8203) || 'b',
    'a' || chr(1) || 'b', 'a' || chr(159) || 'b', 'a' || chr(65279) || 'b', 'a' || chr(65024) || 'b', 'a' || chr(917601) || 'b',
    'a' || chr(917760) || 'b', 'a' || chr(1564) || 'b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', '', repeat('a', 1025)]) x
   WHERE public.network_share_locator_ok(x)), NULL::text[],
  'each of 38 refused shapes is refused');
SELECT ok(public.network_share_locator_ok('a/INVOICES.zip') AND public.network_share_locator_ok('a/databases/x'),
  'a name that only looks like a money folder is not one');
SELECT is(public.network_share_locator_ok(NULL), false, 'NULL is false, never NULL: a CHECK would admit it');
SELECT is(public.network_share_path_shape_ok(NULL), false, 'and for the shape alone');
SELECT is(public.network_share_bin_ok(NULL), false, 'and for a bin path');
SELECT ok(public.network_share_path_shape_ok('Finance'), 'the shape alone says nothing of money names');
SELECT ok(NOT public.network_share_locator_ok('Finance'), 'and the locator does');
SELECT ok(public.network_share_bin_ok('a/b/.wilson-bin/11800000-0000-0000-0000-000000000001/x.mov'), 'a bin path');
SELECT is((SELECT array_agg(x) FROM unnest(ARRAY[
    'a/b/.wilson-bin/1/x.mov',
    'a/INVOICES/.wilson-bin/11800000-0000-0000-0000-000000000001/x.mov',
    'a/.wilson-bin/11800000-0000-0000-0000-000000000001/x/y.mov',
    '.wilson-bin/11800000-0000-0000-0000-000000000001/x.mov',
    'a/.wilson-bin/11800000-0000-0000-0000-000000000001/.x',
    'a/.wilson-bin/11800000-0000-0000-0000-00000000000G/x.mov',
    'a/x.mov']) x
   WHERE public.network_share_bin_ok(x)), NULL::text[],
  'each of seven bad bin paths is refused');


-- ── B. Which folder is whose ─────────────────────────────────────────────────
SELECT is(public.network_share_space_folder('aaaa1111-0000-0000-0000-000000011801'), 'Salt-Hours',
  'a folder_root, relative to the drive with forward slashes');
SELECT is(public.network_share_space_folder('aaaa1111-0000-0000-0000-000000011804'), '_WILSON_PERSONAL/cccccccc-cccc-cccc-cccc-cccccccccccc',
  'a personal space''s fixed folder');
SELECT is(public.network_share_space_folder('aaaa1111-0000-0000-0000-000000011803'), NULL, 'no folder_root, no folder: never a slug or a title');
SELECT is(public.network_share_space_folder('11800000-0000-0000-0000-00000000dead'), NULL, 'no project, no folder');
SELECT is((SELECT count(*)::int FROM public.network_share_claims('11111111-1111-1111-1111-111111111111')
            WHERE project_id IS NULL AND prefix = '_WILSON_PERSONAL' AND placed), 1,
  'the reserved parent is a claim under no project');
SELECT is((SELECT prefix FROM public.network_share_claims('11111111-1111-1111-1111-111111111111')
            WHERE project_id = 'aaaa1111-0000-0000-0000-000000011804'), '_WILSON_PERSONAL/cccccccc-cccc-cccc-cccc-cccccccccccc',
  'a personal space claims its folder');

-- A trashed project still holds its claim.
UPDATE public.projects SET deleted_at = now() WHERE id = 'aaaa1111-0000-0000-0000-000000011807';
SELECT is((SELECT prefix FROM public.network_share_claims('11111111-1111-1111-1111-111111111111')
            WHERE project_id = 'aaaa1111-0000-0000-0000-000000011807'), 'Goner',
  'a trashed project still claims its folder');

-- The drive's own rules: anything but byos, network and UNC is no folder at all.
UPDATE public.workspace_storage SET mode = 'central' WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
SELECT is(public.network_share_space_folder('aaaa1111-0000-0000-0000-000000011801'), NULL, 'a company back on Petal keeps its row and has no folder');
UPDATE public.workspace_storage SET mode = 'byos' WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
UPDATE public.workspace_storage SET root_path = 'C:/wilson', root_kind = 'local' WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
SELECT is(public.network_share_space_folder('aaaa1111-0000-0000-0000-000000011804'), NULL, 'a local root has no folder, a personal space included');
UPDATE public.workspace_storage SET root_path = public.t118_root(), root_kind = 'unc' WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
UPDATE public.workspace_storage SET root_path = public.t118_root() || '2' WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
SELECT is(public.network_share_space_folder('aaaa1111-0000-0000-0000-000000011801'), NULL, 'a drive that has moved leaves a folder_root unplaced');
SELECT is((SELECT placed FROM public.network_share_claims('11111111-1111-1111-1111-111111111111')
            WHERE project_id = 'aaaa1111-0000-0000-0000-000000011801'), false, 'and the claim says so');
UPDATE public.workspace_storage SET root_path = public.t118_root() WHERE workspace_id = '11111111-1111-1111-1111-111111111111';


-- ── C. The projects guard's two arms, and a slug's shape ─────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t118_a();
SELECT throws_ok($$ UPDATE public.projects SET folder_root = public.t118_folder('Salt-Hours') WHERE id = 'aaaa1111-0000-0000-0000-000000011803' $$,
  '42501', 'This folder is already used by another project or space on the company server.', 'a folder another project holds is refused');
SELECT throws_ok($$ UPDATE public.projects SET folder_root = public.t118_folder('Salt-Hours/rushes') WHERE id = 'aaaa1111-0000-0000-0000-000000011803' $$,
  '42501', 'This folder is already used by another project or space on the company server.', 'and one inside it');
SELECT throws_ok($$ UPDATE public.projects SET folder_root = public.t118_folder('salt-hours') WHERE id = 'aaaa1111-0000-0000-0000-000000011803' $$,
  '42501', 'This folder is already used by another project or space on the company server.', 'whatever the case');
SELECT throws_ok($$ UPDATE public.projects SET folder_root = public.t118_folder('Goner') WHERE id = 'aaaa1111-0000-0000-0000-000000011803' $$,
  '42501', 'This folder is already used by another project or space on the company server.', 'and one a trashed project holds');
SELECT throws_ok($$ UPDATE public.projects SET folder_root = public.t118_folder('_WILSON_PERSONAL') WHERE id = 'aaaa1111-0000-0000-0000-000000011803' $$,
  '42501', 'This folder is already used by another project or space on the company server.', 'and the reserved parent');
SELECT throws_ok($$ UPDATE public.projects SET folder_root = public.t118_folder('_WILSON_PERSONAL/cccccccc-cccc-cccc-cccc-cccccccccccc') WHERE id = 'aaaa1111-0000-0000-0000-000000011803' $$,
  '42501', 'This folder is already used by another project or space on the company server.', 'and someone''s personal folder');
SELECT throws_ok($$ UPDATE public.projects SET folder_slug = 'Salt-Hours' WHERE id = 'aaaa1111-0000-0000-0000-000000011803' $$,
  '42501', 'This folder is already used by another project or space on the company server.', 'a slug is held to the same');
SELECT lives_ok($$ UPDATE public.projects SET folder_root = public.t118_folder('Salt-Hours2') WHERE id = 'aaaa1111-0000-0000-0000-000000011803' $$,
  'a cousin folder is not an overlap');
SELECT lives_ok($$ UPDATE public.projects SET folder_root = NULL WHERE id = 'aaaa1111-0000-0000-0000-000000011803' $$,
  'and a folder may be cleared');
-- Containing: a project set to hold another's folder.
RESET ROLE;
UPDATE public.projects SET folder_root = public.t118_folder('Tree/Branch') WHERE id = 'aaaa1111-0000-0000-0000-000000011803';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ UPDATE public.projects SET folder_root = public.t118_folder('Tree') WHERE id = 'aaaa1111-0000-0000-0000-000000011806' $$,
  '42501', 'This folder is already used by another project or space on the company server.', 'and one that contains another''s');
SELECT lives_ok($$ UPDATE public.projects SET folder_root = public.t118_folder('Tree/Branch/Leaf') WHERE id = 'aaaa1111-0000-0000-0000-000000011803' $$,
  'a project may move within its own folder');
RESET ROLE;
UPDATE public.projects SET folder_root = NULL WHERE id = 'aaaa1111-0000-0000-0000-000000011803';
SET LOCAL ROLE authenticated;

SELECT throws_ok($$
  INSERT INTO public.projects (id, workspace_id, title, folder_slug)
  VALUES ('aaaa1111-0000-0000-0000-000000011809', '11111111-1111-1111-1111-111111111111', 'Second Salt', 'salt-hours')
$$, '42501', 'This folder is already used by another project or space on the company server.', 'a new project''s slug is held to it too');
SELECT public.t118_e();
SELECT throws_ok($$ UPDATE public.projects SET folder_slug = 'a' WHERE id = 'aaaa1111-0000-0000-0000-000000011801' $$,
  '42501', 'Only an admin or a manager can change a project''s folder.', 'a project manager''s seat does not change a slug');
SELECT public.t118_d();
SELECT lives_ok($$ UPDATE public.projects SET folder_slug = 'New-Slug' WHERE id = 'aaaa1111-0000-0000-0000-000000011803' $$,
  'a workspace manager does');
SELECT is((SELECT folder_slug FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000011803'), 'New-Slug', 'and it took');
SELECT public.t118_a();
SELECT lives_ok($$ UPDATE public.projects SET folder_slug = 'Finance' WHERE id = 'aaaa1111-0000-0000-0000-000000011803' $$,
  'a money name is a fair slug: a project called Finance must still come up from the desktop');
SELECT is((SELECT count(*)::int FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000011803' AND folder_slug = 'Finance'), 1, 'and it took');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.network_share_claims('11111111-1111-1111-1111-111111111111')
            WHERE project_id = 'aaaa1111-0000-0000-0000-000000011803'), 0,
  'and it claims nothing, because no catalogue could list it');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ UPDATE public.projects SET folder_slug = '' WHERE id = 'aaaa1111-0000-0000-0000-000000011803' $$,
  'an empty slug, what the desktop makes of a title with no letters');
SELECT throws_ok($$ UPDATE public.projects SET folder_slug = 'a/b' WHERE id = 'aaaa1111-0000-0000-0000-000000011803' $$,
  '23514', 'new row for relation "projects" violates check constraint "projects_folder_slug_shape_chk"', 'a slug of two segments violates the CHECK');
SELECT throws_ok($$ UPDATE public.projects SET folder_slug = 'a' || chr(92) || 'b' WHERE id = 'aaaa1111-0000-0000-0000-000000011803' $$,
  '23514', 'new row for relation "projects" violates check constraint "projects_folder_slug_shape_chk"', 'and a backslash');
SELECT throws_ok($$ UPDATE public.projects SET folder_slug = '..' WHERE id = 'aaaa1111-0000-0000-0000-000000011803' $$,
  '23514', 'new row for relation "projects" violates check constraint "projects_folder_slug_shape_chk"', 'and the parent folder');
RESET ROLE;
UPDATE public.projects SET folder_slug = NULL WHERE id = 'aaaa1111-0000-0000-0000-000000011803';

-- A company with no office server: nothing reads a claim, so nothing is refused.
SELECT public.t118_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$
  INSERT INTO public.projects (id, workspace_id, title, folder_slug) VALUES
    ('bbbb2222-0000-0000-0000-000000011801', '22222222-2222-2222-2222-222222222222', 'One', 'Same-Name'),
    ('bbbb2222-0000-0000-0000-000000011802', '22222222-2222-2222-2222-222222222222', 'Two', 'Same-Name')
$$, 'two desktops'' projects may share a folder name in a company whose files are in the cloud');
RESET ROLE;
-- Earlier arms: still there.
SELECT public.t118_c();
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ UPDATE public.projects SET folder_slug = 'x' WHERE id = 'aaaa1111-0000-0000-0000-000000011804' $$,
  '42501', 'A personal space cannot be shared, put in the bin or moved to another folder. Its files can.', 'a personal space keeps its folder: 0110''s arm comes first');
RESET ROLE;


-- ── D. The three CHECKs, by name, and the live-rows index ────────────────────
CREATE FUNCTION public.t118_ins(p_provider text, p_path text, p_thumb text DEFAULT NULL, p_fin boolean DEFAULT false,
                                p_tags text[] DEFAULT '{}', p_missing timestamptz DEFAULT NULL, p_bin text DEFAULT NULL)
RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.files (project_id, name, storage_provider, storage_path, thumbnail_url, is_financial, tags, share_missing_since, share_bin_path)
  VALUES ('aaaa1111-0000-0000-0000-000000011806', 'x', p_provider::public.storage_provider, p_path, p_thumb, p_fin, p_tags, p_missing, p_bin);
$f$;

SELECT throws_ok($$ SELECT public.t118_ins('network_share', 'nas:Moon-Film/.x') $$, '23514',
  'new row for relation "files" violates check constraint "files_network_share_shape_chk"', 'a dot-led locator breaks the shape');
SELECT throws_ok($$ SELECT public.t118_ins('network_share', 'nas:Moon-Film/LEGAL/x') $$, '23514',
  'new row for relation "files" violates check constraint "files_network_share_shape_chk"', 'and a Legal one');
SELECT throws_ok($$ SELECT public.t118_ins('network_share', 'nas:Moon-Film/x', 'nas:Moon-Film/x.jpg') $$, '23514',
  'new row for relation "files" violates check constraint "files_network_share_shape_chk"', 'and a picture');
-- The money flag and the Legal tag are refused by whichever CHECK answers first; both are fine.
SELECT throws_ok($$ SELECT public.t118_ins('network_share', 'nas:Moon-Film/x', NULL, true) $$, '23514', NULL, 'and the money flag');
SELECT throws_ok($$ SELECT public.t118_ins('network_share', 'projects/x/files/y/z') $$, '23514',
  'new row for relation "files" violates check constraint "files_network_share_namespace_chk"', 'a key under network_share breaks the namespace');
SELECT throws_ok($$ SELECT public.t118_ins('supabase', 'nas:Moon-Film/x') $$, '23514',
  'new row for relation "files" violates check constraint "files_network_share_namespace_chk"', 'and a locator under another provider');
SELECT throws_ok($$ SELECT public.t118_ins('supabase', 'projects/aaaa1111-0000-0000-0000-000000011806/files/1/x', NULL, false, '{}', now()) $$, '23514',
  'new row for relation "files" violates check constraint "files_network_share_extra_chk"', 'a missing mark on another provider''s row breaks the extra');
SELECT throws_ok($$ SELECT public.t118_ins('supabase', 'projects/aaaa1111-0000-0000-0000-000000011806/files/1/x', NULL, false, '{}', NULL, 'a/.wilson-bin/11800000-0000-0000-0000-000000000001/x') $$, '23514',
  'new row for relation "files" violates check constraint "files_network_share_extra_chk"', 'and a bin path');
SELECT throws_ok($$ SELECT public.t118_ins('network_share', 'nas:Moon-Film/x', NULL, false, '{}', NULL, 'Moon-Film/.wilson-bin/1/x') $$, '23514',
  'new row for relation "files" violates check constraint "files_network_share_extra_chk"', 'and a bin path of the wrong shape');
SELECT throws_ok($$ SELECT public.t118_ins('network_share', 'nas:Moon-Film/x', NULL, false, '{legal}') $$, '23514', NULL, 'and the Legal tag');
SELECT lives_ok($$ SELECT public.t118_ins('network_share', 'nas:Moon-Film/ok.mov') $$, 'a good row');
SELECT throws_ok($$ SELECT public.t118_ins('network_share', 'nas:moon-film/OK.mov') $$, '23505', NULL, 'two live rows cannot hold one locator, whatever the case');
UPDATE public.files SET deleted_at = now() WHERE storage_path = 'nas:Moon-Film/ok.mov';
SELECT lives_ok($$ SELECT public.t118_ins('network_share', 'nas:Moon-Film/ok.mov') $$, 'a trashed row leaves its name free');
SELECT ok(NOT has_function_privilege('anon', 'public.network_share_locator_ok(text)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.network_share_locator_ok(text)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.network_share_bin_ok(text)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.network_share_path_shape_ok(text)', 'EXECUTE'),
  'a client writing any file row needs these: a CHECK asks for EXECUTE as whoever writes');


-- ── E. An apply ──────────────────────────────────────────────────────────────
SELECT public.t118_e();
SET LOCAL ROLE authenticated;
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours',
    jsonb_build_array(jsonb_build_object('d', 'Salt-Hours', 'complete', true, 'subdirs', '[]'::jsonb, 'files',
      '[{"n":"a.mov","s":"10","m":"2026-10-01T10:00:00Z","t":"video/quicktime"},{"n":"b.mov","s":"20","m":"2026-10-01T10:00:00Z"},{"n":"c.txt","s":"30"}]'::jsonb))
  ) ->> 'added'), '3', 'three entries make three rows');
SELECT is(current_setting('wilson.network_share_writer', true), '', 'and the marker is empty after the call');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.files WHERE project_id = 'aaaa1111-0000-0000-0000-000000011801' AND storage_provider = 'network_share'), 3, 'three rows');
SELECT is((SELECT storage_path || '|' || name || '|' || size_bytes || '|' || mime_type || '|' || kind::text || '|' || created_by::text
             FROM public.files WHERE storage_path = 'nas:Salt-Hours/a.mov'),
  'nas:Salt-Hours/a.mov|a.mov|10|video/quicktime|source|eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'a row says what the walk said, and who checked');
SELECT is((SELECT source_modified_at FROM public.files WHERE storage_path = 'nas:Salt-Hours/a.mov'), '2026-10-01T10:00:00Z'::timestamptz, 'and when it was modified');
SELECT is((SELECT count(*)::int FROM public.files WHERE storage_path = 'nas:Salt-Hours/c.txt' AND source_modified_at IS NULL AND mime_type IS NULL), 1,
  'a walk may leave out the time and the type: a file dated before 1980 is still listed');
SELECT is((SELECT count(*)::int FROM public.file_events WHERE project_id = 'aaaa1111-0000-0000-0000-000000011801' AND event = 'catalogued'), 3, 'the events say catalogued');
SELECT is((SELECT count(*)::int FROM public.file_events WHERE project_id = 'aaaa1111-0000-0000-0000-000000011801' AND event = 'uploaded'), 0, 'and not uploaded');

CREATE TEMP TABLE t118_keep ON COMMIT DROP AS SELECT id, storage_path FROM public.files WHERE project_id = 'aaaa1111-0000-0000-0000-000000011801';

SET LOCAL ROLE authenticated;
SELECT is((SELECT public.t118_top() - 'checked_at'),
  '{"added":0,"stale":[],"renamed":0,"updated":0,"purge_ok":[],"found_again":0,"restore_back":[],"more_missing": false, "newly_missing":0}'::jsonb,
  'the same walk again, in the same transaction, changes nothing');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.files f JOIN t118_keep k ON k.id = f.id AND k.storage_path = f.storage_path), 3, 'and the ids stand');
SET LOCAL ROLE authenticated;
SELECT is((SELECT public.t118_top('11') ->> 'updated'), '1', 'a size change updates the row');
RESET ROLE;
SELECT is((SELECT size_bytes FROM public.files WHERE storage_path = 'nas:Salt-Hours/a.mov'), 11::bigint, 'to the new size');

-- Missing, and found again.
SET LOCAL ROLE authenticated;
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours',
    jsonb_build_array(public.t118_dir('Salt-Hours', true, '{}', '[["a.mov","11"],["c.txt","30"]]'))) ->> 'newly_missing'), '1',
  'a complete directory without an entry marks it missing');
RESET ROLE;
SELECT ok((SELECT share_missing_since IS NOT NULL AND deleted_at IS NULL FROM public.files WHERE storage_path = 'nas:Salt-Hours/b.mov'), 'and nothing is deleted by a check');
SET LOCAL ROLE authenticated;
SELECT is((SELECT public.t118_top('11') ->> 'found_again'), '1', 'seeing it again clears the mark');
RESET ROLE;
SELECT is((SELECT share_missing_since FROM public.files WHERE storage_path = 'nas:Salt-Hours/b.mov'), NULL, 'and it is clear');

-- An incomplete directory marks nothing; a folder in subdirs with no record of its own marks nothing.
SELECT public.t118_row('11800000-0000-0000-0000-000000000301', 'aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours/rushes/r1.mov');
SELECT public.t118_row('11800000-0000-0000-0000-000000000302', 'aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours/rushes/day1/r2.mov');
SET LOCAL ROLE authenticated;
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours',
    jsonb_build_array(public.t118_dir('Salt-Hours/rushes', false, '{}', '[]'))) ->> 'newly_missing'), '0',
  'an incomplete directory marks nothing: an unreadable folder or a cut walk');
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours',
    jsonb_build_array(public.t118_dir('Salt-Hours', true, '{rushes}', '[["a.mov","11"],["b.mov","20"],["c.txt","30"]]'))) ->> 'newly_missing'), '0',
  'a subfolder the directory still has answers for itself');
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours',
    jsonb_build_array(public.t118_dir('Salt-Hours/rushes', true, '{day1}', '[["r1.mov","1"]]'))) ->> 'newly_missing'), '0',
  'and one level down the same');
-- A vanished subfolder marks everything under it, at any depth.
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours',
    jsonb_build_array(public.t118_dir('Salt-Hours', true, '{}', '[["a.mov","11"],["b.mov","20"],["c.txt","30"]]'))) ->> 'newly_missing'), '2',
  'a vanished subfolder marks its rows at any depth');
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours',
    jsonb_build_array(public.t118_dir('Salt-Hours', true, '{Rushes}', '[["a.mov","11"],["b.mov","20"],["c.txt","30"]]'),
                      public.t118_dir('Salt-Hours/Rushes', true, '{Day1}', '[["r1.mov","1"]]'),
                      public.t118_dir('Salt-Hours/Rushes/Day1', true, '{}', '[["r2.mov","1"]]'))) ->> 'found_again'), '2',
  'and a split walk finds them again, the folder''s case changed');
RESET ROLE;
SELECT is((SELECT storage_path FROM public.files WHERE id = '11800000-0000-0000-0000-000000000302'), 'nas:Salt-Hours/Rushes/Day1/r2.mov', 'and the row takes the new case');
SELECT is((SELECT count(*)::int FROM public.file_events WHERE file_id = '11800000-0000-0000-0000-000000000302' AND event = 'moved'), 1, 'which is a locator change');

-- Filed in the folder its path names, the case aside; and the top of the folder is no folder.
SET LOCAL ROLE authenticated;
SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours',
  jsonb_build_array(public.t118_dir('Salt-Hours/Rushes', false, '{}', '[["f1.mov","5"]]'),
                    public.t118_dir('Salt-Hours/no-such', false, '{}', '[["f2.mov","5"]]'),
                    public.t118_dir('Salt-Hours', false, '{}', '[["f3.mov","5"]]')));
RESET ROLE;
SELECT is((SELECT folder_id FROM public.files WHERE storage_path = 'nas:Salt-Hours/Rushes/f1.mov'), '11800000-0000-0000-0000-0000000000f1'::uuid, 'filed in the folder its path names');
SELECT is((SELECT folder_id FROM public.files WHERE storage_path = 'nas:Salt-Hours/no-such/f2.mov'), NULL, 'no such folder, no folder');
SELECT is((SELECT folder_id FROM public.files WHERE storage_path = 'nas:Salt-Hours/f3.mov'), NULL, 'and the top of the space is no folder');

-- A rename: same name, size and time, each the only one of its kind.
SELECT public.t118_row('11800000-0000-0000-0000-000000000303', 'aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours/gone/mv.mov', 77);
SET LOCAL ROLE authenticated;
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours',
    jsonb_build_array(public.t118_dir('Salt-Hours/gone', true, '{}', '[]'),
                      public.t118_dir('Salt-Hours/Rushes', true, '{Day1}', '[["r1.mov","1"],["f1.mov","5"],["mv.mov","77"]]'))) ->> 'renamed'), '1',
  'a rename keeps the row');
RESET ROLE;
SELECT is((SELECT storage_path FROM public.files WHERE id = '11800000-0000-0000-0000-000000000303'), 'nas:Salt-Hours/Rushes/mv.mov', 'at its new locator');
SELECT is((SELECT folder_id FROM public.files WHERE id = '11800000-0000-0000-0000-000000000303'), '11800000-0000-0000-0000-0000000000f1'::uuid, 'in its new folder');
SELECT is((SELECT count(*)::int FROM public.file_events WHERE file_id = '11800000-0000-0000-0000-000000000303' AND event = 'moved'), 1, 'and it records moved');
SELECT is((SELECT count(*)::int FROM public.files WHERE lower(storage_path) = 'nas:salt-hours/rushes/mv.mov'), 1, 'with no second row');

-- Two rows that could be the same file: neither is a rename. One entry, two candidates.
SELECT public.t118_row('11800000-0000-0000-0000-000000000304', 'aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours/gone/tw.mov', 88);
SELECT public.t118_row('11800000-0000-0000-0000-000000000305', 'aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours/gone2/tw.mov', 88);
SET LOCAL ROLE authenticated;
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours',
    jsonb_build_array(public.t118_dir('Salt-Hours/gone', true, '{}', '[]'),
                      public.t118_dir('Salt-Hours/gone2', true, '{}', '[]'),
                      public.t118_dir('Salt-Hours/Rushes', true, '{Day1}', '[["r1.mov","1"],["f1.mov","5"],["mv.mov","77"],["tw.mov","88"]]'))) -> 'renamed'), '0'::jsonb,
  'two candidates for one file: not a rename');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.files WHERE id IN ('11800000-0000-0000-0000-000000000304', '11800000-0000-0000-0000-000000000305') AND share_missing_since IS NOT NULL), 2,
  'both read as missing');
SELECT is((SELECT count(*)::int FROM public.files WHERE storage_path = 'nas:Salt-Hours/Rushes/tw.mov'), 1, 'and the new file is a row of its own');

-- Entries: a frame sequence, Local Server's prefix, and what is dropped.
SET LOCAL ROLE authenticated;
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours',
    jsonb_build_array(jsonb_build_object('d', 'Salt-Hours/ents', 'complete', true, 'subdirs', '[]'::jsonb, 'files',
      jsonb_build_array(
        jsonb_build_object('n', 'plate_v1', 's', '4096', 'm', '2026-10-01T10:00:00Z', 't', 'inode/x-frame-sequence'),
        jsonb_build_object('n', '11800000-0000-0000-0000-000000000999-clip.mov', 's', '5'))))
  ) ->> 'added'), '2', 'a sequence is one entry');
RESET ROLE;
SELECT is((SELECT mime_type FROM public.files WHERE storage_path = 'nas:Salt-Hours/ents/plate_v1'), 'inode/x-frame-sequence', 'and says so');
SELECT is((SELECT name FROM public.files WHERE storage_path = 'nas:Salt-Hours/ents/11800000-0000-0000-0000-000000000999-clip.mov'), 'clip.mov', 'Local Server''s prefix comes off the name, not the locator');

SET LOCAL ROLE authenticated;
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours',
    jsonb_build_array(
      jsonb_build_object('d', 'Salt-Hours/drop', 'complete', false, 'subdirs', '[]'::jsonb, 'files',
        (SELECT jsonb_agg(jsonb_build_object('n', n, 's', '1')) FROM unnest(ARRAY[
          '.hidden', '..', 'a' || chr(92) || 'b', 'a:b', 'x' || chr(8238) || 'y', 'e' || chr(769), 'INVOICES', 'LEGAL', 'P_DATABASES', 'y/z']) n)),
      jsonb_build_object('d', 'Salt-Hours/INVOICES', 'complete', false, 'subdirs', '[]'::jsonb, 'files', '[{"n":"inv.pdf","s":"1"}]'::jsonb),
      jsonb_build_object('d', 'Salt-Hours/.wilson-bin', 'complete', false, 'subdirs', '[]'::jsonb, 'files', '[{"n":"b.pdf","s":"1"}]'::jsonb),
      jsonb_build_object('d', 'Moon-Film', 'complete', false, 'subdirs', '[]'::jsonb, 'files', '[{"n":"other.mov","s":"1"}]'::jsonb),
      jsonb_build_object('d', 'Salt-Hours2', 'complete', false, 'subdirs', '[]'::jsonb, 'files', '[{"n":"cousin.mov","s":"1"}]'::jsonb)
    )) ->> 'added'), '0', 'money, Legal, _DATABASES, dot, ''..'', backslash, colon, bidi and non-NFC names, a directory outside the folder: all dropped');
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours',
    '[{"d":"Salt-Hours/bad","complete":false,"subdirs":[],"files":[{"n":"s1","s":"-1"},{"n":"s2","s":"abc"},{"n":"s3"},{"n":"s4","s":"1234567890123456"},{"n":"m1","s":"1","m":"yesterday"},{"n":"m2","s":"1","m":"1979-12-31T23:59:59Z"},{"n":"m3","s":"1","m":"2999-01-01T00:00:00Z"},{"n":"m4","s":"1","m":"2026-02-31T10:00:00Z"},{"n":"t1","s":"1","t":"not a type"},7,"x"]}]'::jsonb
  ) ->> 'added'), '0', 'a bad size, time or type drops the entry, and the rest of the call stands');

-- A file an entry is dropped for is still a file the walk found: its row is not missing.
RESET ROLE;
SELECT public.t118_row('11800000-0000-0000-0000-000000000306', 'aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours/seen/old.mov');
SET LOCAL ROLE authenticated;
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours',
    '[{"d":"Salt-Hours/seen","complete":true,"subdirs":[],"files":[{"n":"old.mov","s":"1","m":"1979-12-31T23:59:59Z"}]}]'::jsonb) ->> 'newly_missing'), '0',
  'an entry dropped for its date does not make its row missing');

-- Bad shapes of the call itself are refused or ignored, never a raw error.
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours',
    '[7,"x",null,{"d":7},{"d":"Salt-Hours/w","files":"x","subdirs":"y","complete":"true"}]'::jsonb) ->> 'added'), '0',
  'junk inside the array is passed over');
RESET ROLE;

-- A row its folder has left: folder_root pointed elsewhere after it was listed.
SELECT public.t118_row('11800000-0000-0000-0000-000000000307', 'aaaa1111-0000-0000-0000-000000011806', 'Old-Moon/plate.mov');
SELECT public.t118_a();
SET LOCAL ROLE authenticated;
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011806', 'Moon-Film',
    jsonb_build_array(public.t118_dir('Moon-Film', true, '{}', '[["ok.mov","1"]]')), '[]', false) ->> 'newly_missing'), '0',
  'a row outside the folder waits for the walk''s final call');
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011806', 'Moon-Film',
    jsonb_build_array(public.t118_dir('Moon-Film', true, '{}', '[["ok.mov","1"]]'))) ->> 'newly_missing'), '1',
  'then it reads as missing: it cannot be walked from here');
RESET ROLE;
SELECT ok((SELECT share_missing_since IS NOT NULL FROM public.files WHERE id = '11800000-0000-0000-0000-000000000307'), 'and the row says so');
DELETE FROM public.files WHERE id = '11800000-0000-0000-0000-000000000307';

-- A private project's catalogue writes history. A manager who did not create it reads none of it.
SELECT public.t118_e();
SET LOCAL ROLE authenticated;
SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011802', 'Quiet-Room',
  jsonb_build_array(public.t118_dir('Quiet-Room', true, '{}', '[["q.mov","1"]]')));
RESET ROLE;
SELECT ok((SELECT count(*) FROM public.edit_history WHERE entity_type = 'files' AND project_id = 'aaaa1111-0000-0000-0000-000000011802') >= 1,
  'a private project''s catalogue writes history');
SET LOCAL ROLE authenticated;
SELECT public.t118_d();
SELECT is((SELECT count(*)::int FROM public.edit_history WHERE entity_type = 'files' AND project_id = 'aaaa1111-0000-0000-0000-000000011802'), 0,
  'and a manager who did not create it reads none of it');
SELECT is((SELECT count(*)::int FROM public.file_events WHERE project_id = 'aaaa1111-0000-0000-0000-000000011802'), 0,
  'nor its events');
SELECT is((SELECT count(*)::int FROM public.files WHERE project_id = 'aaaa1111-0000-0000-0000-000000011802'), 0,
  'nor its rows');
RESET ROLE;


-- ── F. An apply's refusals ───────────────────────────────────────────────────
CREATE FUNCTION public.t118_refused() RETURNS jsonb LANGUAGE sql AS $f$
  SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours', jsonb_build_array(public.t118_dir('Salt-Hours/z', false, '{}', '[]')));
$f$;

SET LOCAL ROLE authenticated;
SELECT public.t118_c();
SELECT throws_ok($$ SELECT public.t118_refused() $$, '42501', 'network_share: not allowed', 'a member''s seat does not check');
SELECT public.t118_v();
SELECT throws_ok($$ SELECT public.t118_refused() $$, '42501', 'network_share: not allowed', 'nor a reviewer''s');
SELECT public.t118_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222');
SELECT throws_ok($$ SELECT public.t118_refused() $$, '42501', 'network_share: not allowed', 'nor another company''s admin');
SELECT public.t118_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'admin');
SELECT throws_ok($$ SELECT public.t118_refused() $$, '42501', 'network_share: not allowed', 'nor an inactive member whose token says admin');
SELECT public.t118_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin');
SELECT throws_ok($$ SELECT public.t118_refused() $$, '42501', 'network_share: not allowed', 'nor someone with this company''s id in a token and no seat in it');
SELECT public.t118_d();
SELECT throws_ok($$ SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011802', 'Quiet-Room', '[]'::jsonb) $$, '42501', 'network_share: not allowed',
  'nor a manager on a private project someone else made: the same sentence');
SELECT throws_ok($$ SELECT public.t118_apply('11800000-0000-0000-0000-00000000dead', 'Quiet-Room', '[]'::jsonb) $$, '42501', 'network_share: not allowed',
  'and the same for a project that does not exist');
SELECT throws_ok($$ SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011807', 'Goner', '[]'::jsonb) $$, '42501', 'network_share: not allowed',
  'and a trashed project');
SELECT public.t118_c();
SELECT lives_ok($$ SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011804', '_WILSON_PERSONAL/cccccccc-cccc-cccc-cccc-cccccccccccc', '[]'::jsonb, '[]', false) $$,
  'the owner holds the seat on a personal space');
SELECT public.t118_a();
SELECT throws_ok($$ SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011804', '_WILSON_PERSONAL/cccccccc-cccc-cccc-cccc-cccccccccccc', '[]'::jsonb) $$, '42501', 'network_share: not allowed',
  'an admin does not');

SELECT throws_ok($$ SELECT public.network_share_catalogue_apply('aaaa1111-0000-0000-0000-000000011801', 'C:/wilson', 'Salt-Hours', '[]'::jsonb) $$, 'P0001', 'network_share: drive_changed',
  'a root that is not the company''s');
SELECT throws_ok($$ SELECT public.network_share_catalogue_apply('aaaa1111-0000-0000-0000-000000011801', NULL, 'Salt-Hours', '[]'::jsonb) $$, 'P0001', 'network_share: drive_changed', 'or no root');
SELECT lives_ok($$ SELECT public.network_share_catalogue_apply('aaaa1111-0000-0000-0000-000000011801', upper(public.t118_root()), 'Salt-Hours', '[]'::jsonb, '[]', false) $$, 'the case of the root does not matter');
RESET ROLE;
UPDATE public.workspace_storage SET mode = 'central' WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.t118_refused() $$, 'P0001', 'network_share: drive_changed', 'a company back on Petal has no drive');
RESET ROLE;
UPDATE public.workspace_storage SET mode = 'byos', root_path = 'C:/wilson', root_kind = 'local' WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.t118_refused() $$, 'P0001', 'network_share: drive_changed', 'and a local root');
RESET ROLE;
UPDATE public.workspace_storage SET root_path = public.t118_root(), root_kind = 'unc' WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL ROLE authenticated;

SELECT throws_ok($$ SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011803', 'No-Folder', '[]'::jsonb) $$, 'P0001', 'network_share: no_folder', 'no folder_root: no folder');
SELECT throws_ok($$ SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011801', 'Other', '[]'::jsonb) $$, 'P0001', 'network_share: no_folder', 'a folder that is not the project''s');
RESET ROLE;

-- An unplaced claim anywhere refuses everyone; an overlap refuses its parties. Both planted by
-- the service, which 0049 and the guard let through.
SET LOCAL ROLE service_role;
UPDATE public.projects SET folder_root = 'C:/elsewhere' WHERE id = 'aaaa1111-0000-0000-0000-000000011803';
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.t118_refused() $$, 'P0001', 'network_share: folders_unplaced', 'a folder outside the drive anywhere in the company refuses: it may overlap');
RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE public.projects SET folder_root = NULL, folder_slug = 'Salt-Hours' WHERE id = 'aaaa1111-0000-0000-0000-000000011803';
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.t118_refused() $$, 'P0001', 'network_share: folder_shared', 'a slug equal to the folder refuses rather than skips');
RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE public.projects SET folder_slug = NULL, folder_root = public.t118_folder('Salt-Hours/rushes') WHERE id = 'aaaa1111-0000-0000-0000-000000011803';
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.t118_refused() $$, 'P0001', 'network_share: folder_shared', 'a project nested inside refuses');
RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE public.projects SET folder_root = public.t118_folder('_WILSON_PERSONAL') WHERE id = 'aaaa1111-0000-0000-0000-000000011803';
RESET ROLE;
SELECT public.t118_c();
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011804', '_WILSON_PERSONAL/cccccccc-cccc-cccc-cccc-cccccccccccc', '[]'::jsonb) $$, 'P0001', 'network_share: folder_shared',
  'a project holding the reserved parent refuses a personal space''s check');
RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE public.projects SET folder_root = NULL WHERE id = 'aaaa1111-0000-0000-0000-000000011803';
RESET ROLE;
SET LOCAL ROLE authenticated;

-- Limits.
SELECT public.t118_a();
SELECT throws_ok($$ SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011805', 'Rate', (SELECT jsonb_build_array(jsonb_build_object('d', 'Rate', 'complete', false, 'subdirs', '[]'::jsonb, 'files', jsonb_agg(jsonb_build_object('n', 'f' || g, 's', '1')))) FROM generate_series(1, 5001) g)) $$,
  'P0001', 'network_share: too_large', '5,001 entries');
SELECT throws_ok($$ SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011805', 'Rate', (SELECT jsonb_agg(jsonb_build_object('d', 'Rate/d' || g)) FROM generate_series(1, 2001) g)) $$,
  'P0001', 'network_share: too_large', '2,001 directories');
SELECT throws_ok($$ SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011805', 'Rate', '[]'::jsonb, (SELECT jsonb_agg('x' || g) FROM generate_series(1, 501) g)) $$,
  'P0001', 'network_share: too_large', '501 bin entries');
SELECT throws_ok($$ SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011805', 'Rate', '{}'::jsonb) $$, 'P0001', 'network_share: bad_request', 'directories that are not an array');
SELECT throws_ok($$ SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011805', 'Rate', '[]'::jsonb, '{}'::jsonb) $$, 'P0001', 'network_share: bad_request', 'a bin that is not an array');

SELECT lives_ok($$ SELECT public.t118_many(60) $$, 'sixty calls in ten minutes');
SELECT throws_ok($$ SELECT public.t118_many(1) $$, 'P0001', 'network_share: too_soon', 'the sixty-first is refused');
RESET ROLE;
UPDATE public.network_share_checks SET window_started_at = now() - interval '11 minutes' WHERE project_id = 'aaaa1111-0000-0000-0000-000000011805';
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.t118_many(1) $$, 'and ten minutes on, the count starts again');
RESET ROLE;


-- ── G. What stands guard after an apply ──────────────────────────────────────
SELECT public.t118_c();
SET LOCAL ROLE authenticated;
SELECT throws_ok($$
  INSERT INTO public.files (project_id, name, storage_provider, storage_path)
  VALUES ('aaaa1111-0000-0000-0000-000000011801', 'x', 'network_share', 'nas:Salt-Hours/x.mov')
$$, '42501', 'This file''s stored copy is not one this project can claim.', 'a client cannot insert an office-server row, after an apply in this transaction too');
SELECT throws_ok($$ UPDATE public.files SET storage_path = 'nas:Salt-Hours/y.mov' WHERE storage_path = 'nas:Salt-Hours/a.mov' $$, '42501', NULL, 'nor change its locator');
SELECT throws_ok($$ UPDATE public.files SET size_bytes = 1 WHERE storage_path = 'nas:Salt-Hours/a.mov' $$, '42501', 'A file on your office server changes only through the desktop app.', 'nor its size');
SELECT throws_ok($$ UPDATE public.files SET deleted_at = now() WHERE storage_path = 'nas:Salt-Hours/a.mov' $$, '42501', 'A file on your office server changes only through the desktop app.', 'nor trash it by hand');
SELECT throws_ok($$ UPDATE public.files SET project_id = 'aaaa1111-0000-0000-0000-000000011806' WHERE storage_path = 'nas:Salt-Hours/a.mov' $$, '42501', NULL, 'nor move it');
SELECT throws_ok($$ UPDATE public.files SET share_missing_since = now() WHERE storage_path = 'nas:Salt-Hours/a.mov' $$, '42501', NULL, 'nor mark it missing');
SELECT throws_ok($$ SELECT public.soft_delete_row('files', public.t118_id('Salt-Hours/a.mov')) $$, '42501', 'A file on your office server changes only through the desktop app.', 'the generic trash call is refused');
SELECT lives_ok($$ UPDATE public.files SET description = 'A note', tags = '{creative}' WHERE storage_path = 'nas:Salt-Hours/a.mov' $$, 'a description and a tag stay a client''s to edit');
RESET ROLE;
SELECT is((SELECT description FROM public.files WHERE storage_path = 'nas:Salt-Hours/a.mov'), 'A note', 'and it took');

-- Hard delete: 0117's guard, 0114's note (g).
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ DELETE FROM public.files WHERE storage_path = 'nas:Salt-Hours/a.mov' $$, '42501', 'A file on your office server changes only through the desktop app.', 'a client''s hard delete is refused');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.files WHERE storage_path = 'nas:Salt-Hours/a.mov'), 1, 'and the row is still there');
SELECT public.t118_row('11800000-0000-0000-0000-000000000308', 'aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours/trashed/del.mov');
UPDATE public.files SET deleted_at = now() WHERE id = '11800000-0000-0000-0000-000000000308';
SELECT public.t118_a();
SET LOCAL ROLE authenticated;
-- A WHERE on a column brings the SELECT policy in, which hides a trashed row. A blanket statement
-- reaches the write policy alone: suite 115's section M has the same note.
SELECT throws_ok($$ DELETE FROM public.files $$, '42501', 'A file on your office server changes only through the desktop app.', 'a blanket delete by an admin stops at the first office-server row');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.files WHERE id = '11800000-0000-0000-0000-000000000308'), 1, 'and a trashed row is still there');
-- A file on another provider is not this guard's.
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path) VALUES
  ('11800000-0000-0000-0000-000000000309', 'aaaa1111-0000-0000-0000-000000011801', 'p.txt', 'supabase', 'projects/aaaa1111-0000-0000-0000-000000011801/files/11800000-0000-0000-0000-000000000309/p.txt');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ DELETE FROM public.files WHERE id = '11800000-0000-0000-0000-000000000309' $$, 'another provider''s row is not this guard''s');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.files WHERE id = '11800000-0000-0000-0000-000000000309'), 0, 'and it is gone: the guard returned OLD');
-- A folder's delete still empties the row's folder (RI, 0114's folder-to-NULL rule).
SELECT public.t118_row('11800000-0000-0000-0000-000000000310', 'aaaa1111-0000-0000-0000-000000011806', 'Moon-Film/plates/p1.mov');
UPDATE public.files SET folder_id = '11800000-0000-0000-0000-0000000000f5' WHERE id = '11800000-0000-0000-0000-000000000310';
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ DELETE FROM public.folders WHERE id = '11800000-0000-0000-0000-0000000000f5' $$, 'a folder may go, with an office-server row in it');
RESET ROLE;
SELECT is((SELECT folder_id FROM public.files WHERE id = '11800000-0000-0000-0000-000000000310'), NULL, 'and the row just loses its folder');
-- rekey_file_body is not a way in: the namespace CHECK stands after its own refusals.
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.rekey_file_body(public.t118_id('Salt-Hours/a.mov'), 'nas:Salt-Hours/a.mov', 'projects/aaaa1111-0000-0000-0000-000000011801/files/x/a.mov', NULL, NULL) $$, '42501', 'file not found or not writable', 'rekey_file_body cannot give an office-server row a key');
RESET ROLE;


-- ── H. The file manager ──────────────────────────────────────────────────────
SELECT public.t118_row('11800000-0000-0000-0000-000000000401', 'aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours/ops/t1.mov');
SELECT public.t118_row('11800000-0000-0000-0000-000000000402', 'aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours/ops/t2.mov');
SELECT public.t118_row('11800000-0000-0000-0000-000000000403', 'aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours/ops/t3.mov');

SET LOCAL ROLE authenticated;

-- Refused, one sentence each, and nothing changes.
SELECT public.t118_v();
SELECT throws_ok($$ SELECT public.network_share_trash(ARRAY['11800000-0000-0000-0000-000000000401'::uuid]) $$, '42501', 'network_share: not allowed', 'a reviewer cannot delete');
SELECT public.t118_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222');
SELECT throws_ok($$ SELECT public.network_share_trash(ARRAY['11800000-0000-0000-0000-000000000401'::uuid]) $$, '42501', 'network_share: not allowed', 'nor another company''s admin');
SELECT public.t118_c();
SELECT throws_ok($$ SELECT public.network_share_trash(ARRAY['11800000-0000-0000-0000-000000000401'::uuid, '11800000-0000-0000-0000-00000000dead'::uuid]) $$, '42501', 'network_share: not allowed', 'a batch with a missing id is refused whole');
SELECT throws_ok($$ SELECT public.network_share_trash('{}'::uuid[]) $$, 'P0001', 'network_share: bad_request', 'an empty batch');
SELECT throws_ok($$ SELECT public.network_share_trash((SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 501))) $$, 'P0001', 'network_share: bad_request', 'or over 500');

-- Delete, and the file never moved.
INSERT INTO t118_ret SELECT 't1', public.network_share_trash(ARRAY['11800000-0000-0000-0000-000000000401'::uuid]);
SELECT is((SELECT v -> 0 ->> 'from' FROM t118_ret WHERE k = 't1'), 'Salt-Hours/ops/t1.mov', 'delete says where the file is');
SELECT is((SELECT v -> 0 ->> 'to' FROM t118_ret WHERE k = 't1'), 'Salt-Hours/.wilson-bin/11800000-0000-0000-0000-000000000401/t1.mov', 'and where it goes');
SELECT is(current_setting('wilson.network_share_writer', true), '', 'the marker is empty after the call');
SELECT throws_ok($$ SELECT public.network_share_trash(ARRAY['11800000-0000-0000-0000-000000000401'::uuid]) $$, '42501', 'network_share: not allowed', 'a row already in the trash reads as not there');
RESET ROLE;
SELECT ok((SELECT deleted_at IS NOT NULL AND deleted_by = 'cccccccc-cccc-cccc-cccc-cccccccccccc' AND share_bin_path = 'Salt-Hours/.wilson-bin/11800000-0000-0000-0000-000000000401/t1.mov' AND storage_path = 'nas:Salt-Hours/ops/t1.mov'
             FROM public.files WHERE id = '11800000-0000-0000-0000-000000000401'),
  'the row is in the trash, with its bin path, and keeps its locator');
SELECT is((SELECT state || '/' || op FROM public.network_share_ops WHERE file_id = '11800000-0000-0000-0000-000000000401'), 'pending/trash', 'and one pending operation');
SELECT is((SELECT count(*)::int FROM public.file_events WHERE file_id = '11800000-0000-0000-0000-000000000401' AND event = 'trashed'), 1, 'and a trashed event');

-- Pending: a walk skips it; nobody else settles it; it shows in pending_mine for its creator alone.
SET LOCAL ROLE authenticated;
SELECT public.t118_e();
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours',
    jsonb_build_array(public.t118_dir('Salt-Hours/ops', false, '{}', '[["t1.mov","1"]]'))) ->> 'added'), '0',
  'an entry at a pending operation''s locator is not inserted');
SELECT is(public.network_share_pending_mine(), '[]'::jsonb, 'pending_mine is empty for someone else');
SELECT throws_ok($$ SELECT public.network_share_settle(ARRAY[(SELECT (v -> 0 ->> 'op_id')::uuid FROM t118_ret WHERE k = 't1')], 'done') $$, '42501', 'network_share: not allowed',
  'and they cannot settle it, the check seat included, before 24 hours');
SELECT public.t118_c();
SELECT is((SELECT jsonb_array_length(public.network_share_pending_mine())), 1, 'pending_mine shows its creator');
SELECT is((SELECT public.network_share_pending_mine() -> 0 ->> 'to'), 'Salt-Hours/.wilson-bin/11800000-0000-0000-0000-000000000401/t1.mov', 'where it was going');
SELECT throws_ok($$ SELECT public.network_share_settle(ARRAY[(SELECT (v -> 0 ->> 'op_id')::uuid FROM t118_ret WHERE k = 't1')], 'perhaps') $$, 'P0001', 'network_share: bad_request', 'an outcome outside the two');
SELECT throws_ok($$ SELECT public.network_share_settle(ARRAY['11800000-0000-0000-0000-00000000dead'::uuid], 'done') $$, '42501', 'network_share: not allowed', 'an operation that does not exist');

-- 'not_moved' puts the row back.
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[(SELECT (v -> 0 ->> 'op_id')::uuid FROM t118_ret WHERE k = 't1')], 'not_moved') $$, 'the rename failed');
SELECT throws_ok($$ SELECT public.network_share_settle(ARRAY[(SELECT (v -> 0 ->> 'op_id')::uuid FROM t118_ret WHERE k = 't1')], 'done') $$, '42501', 'network_share: not allowed', 'a settled operation reads as not there');
SELECT is(current_setting('wilson.network_share_writer', true), '', 'the marker is empty after the call');
RESET ROLE;
SELECT ok((SELECT deleted_at IS NULL AND deleted_by IS NULL AND share_bin_path IS NULL FROM public.files WHERE id = '11800000-0000-0000-0000-000000000401'), 'settle not_moved restores the row');
SELECT is((SELECT state FROM public.network_share_ops WHERE file_id = '11800000-0000-0000-0000-000000000401'), 'reverted', 'and closes the operation');
SELECT is((SELECT count(*)::int FROM public.file_events WHERE file_id = '11800000-0000-0000-0000-000000000401' AND event = 'restored'), 1, 'and says restored');

-- Delete again, done, then restore.
SET LOCAL ROLE authenticated;
INSERT INTO t118_ret SELECT 't1b', public.network_share_trash(ARRAY['11800000-0000-0000-0000-000000000401'::uuid]);
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[(SELECT (v -> 0 ->> 'op_id')::uuid FROM t118_ret WHERE k = 't1b')], 'done') $$, 'the rename worked');
RESET ROLE;
SELECT ok((SELECT deleted_at IS NOT NULL AND share_bin_path IS NOT NULL FROM public.files WHERE id = '11800000-0000-0000-0000-000000000401'), 'done leaves the row in the trash');
SELECT is((SELECT count(*)::int FROM public.network_share_ops WHERE file_id = '11800000-0000-0000-0000-000000000401' AND state = 'pending'), 0, 'with nothing pending');
UPDATE public.files SET deleted_at = '2026-10-20T00:00:00Z' WHERE id = '11800000-0000-0000-0000-000000000401';

SET LOCAL ROLE authenticated;
SELECT public.t118_v();
SELECT throws_ok($$ SELECT public.network_share_restore(ARRAY['11800000-0000-0000-0000-000000000401'::uuid]) $$, '42501', 'network_share: not allowed', 'a reviewer cannot restore');
SELECT public.t118_c();
SELECT throws_ok($$ SELECT public.network_share_restore(ARRAY['11800000-0000-0000-0000-000000000402'::uuid]) $$, '42501', 'network_share: not allowed', 'a live row cannot be restored');
INSERT INTO t118_ret SELECT 'r1', public.network_share_restore(ARRAY['11800000-0000-0000-0000-000000000401'::uuid]);
SELECT is((SELECT v -> 0 ->> 'to' FROM t118_ret WHERE k = 'r1'), 'Salt-Hours/ops/t1.mov', 'restore says where the file goes back to');
RESET ROLE;
SELECT ok((SELECT deleted_at IS NULL AND share_bin_path IS NOT NULL FROM public.files WHERE id = '11800000-0000-0000-0000-000000000401'), 'the row is live, and keeps its bin path until it settles');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.network_share_trash(ARRAY['11800000-0000-0000-0000-000000000401'::uuid]) $$, 'P0001', 'network_share: pending', 'a row with a pending operation cannot start another');
-- The file is still in the bin: back to the trash, with its own date.
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[(SELECT (v -> 0 ->> 'op_id')::uuid FROM t118_ret WHERE k = 'r1')], 'not_moved') $$, 'the rename back failed');
RESET ROLE;
SELECT is((SELECT deleted_at FROM public.files WHERE id = '11800000-0000-0000-0000-000000000401'), '2026-10-20T00:00:00Z'::timestamptz, 'the row goes back to the trash with its own date: the 30 days do not start again');
SELECT is((SELECT deleted_by FROM public.files WHERE id = '11800000-0000-0000-0000-000000000401'), 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'and who deleted it');
SET LOCAL ROLE authenticated;
INSERT INTO t118_ret SELECT 'r2', public.network_share_restore(ARRAY['11800000-0000-0000-0000-000000000401'::uuid]);
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[(SELECT (v -> 0 ->> 'op_id')::uuid FROM t118_ret WHERE k = 'r2')], 'done') $$, 'the rename back worked');
RESET ROLE;
SELECT ok((SELECT deleted_at IS NULL AND share_bin_path IS NULL FROM public.files WHERE id = '11800000-0000-0000-0000-000000000401'), 'settle done clears the bin path');

-- Occupied, and a batch is whole.
SET LOCAL ROLE authenticated;
INSERT INTO t118_ret SELECT 't2', public.network_share_trash(ARRAY['11800000-0000-0000-0000-000000000402'::uuid]);
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[(SELECT (v -> 0 ->> 'op_id')::uuid FROM t118_ret WHERE k = 't2')], 'done') $$, 'a second file in the bin');
RESET ROLE;
-- A new file at its old name: a trashed twin. The walk lists it, and a rename beside it applies cleanly.
SET LOCAL ROLE authenticated;
SELECT public.t118_e();
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours',
    jsonb_build_array(public.t118_dir('Salt-Hours/ops', false, '{}', '[["t2.mov","9"]]'))) ->> 'added'), '1',
  'a new file at a trashed file''s old name is listed: a trashed twin');
SELECT public.t118_c();
SELECT throws_ok($$ SELECT public.network_share_restore(ARRAY['11800000-0000-0000-0000-000000000402'::uuid]) $$, 'P0001', 'network_share: occupied', 'restore when the name is taken is refused');
SELECT throws_ok($$ SELECT public.network_share_trash(ARRAY['11800000-0000-0000-0000-000000000403'::uuid, '11800000-0000-0000-0000-000000000402'::uuid]) $$, '42501', 'network_share: not allowed', 'one trashed row in a batch refuses it whole');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.files WHERE id = '11800000-0000-0000-0000-000000000402' AND deleted_at IS NOT NULL), 1, 'and the row stays in the trash');
SELECT is((SELECT deleted_at FROM public.files WHERE id = '11800000-0000-0000-0000-000000000403'), NULL, 'and the good row was not touched');

-- After 24 hours a check seat may settle what somebody left, if both ends are inside this folder.
SET LOCAL ROLE authenticated;
INSERT INTO t118_ret SELECT 't3', public.network_share_trash(ARRAY['11800000-0000-0000-0000-000000000403'::uuid]);
RESET ROLE;
UPDATE public.network_share_ops SET created_at = now() - interval '25 hours' WHERE file_id = '11800000-0000-0000-0000-000000000403' AND state = 'pending';
SET LOCAL ROLE authenticated;
SELECT public.t118_e();
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours', '[]'::jsonb, '[]'::jsonb, false) -> 'stale' -> 0 ->> 'from'), 'Salt-Hours/ops/t3.mov', 'an apply lists a stale in-folder operation');
SELECT public.t118_v();
SELECT throws_ok($$ SELECT public.network_share_settle(ARRAY[(SELECT (v -> 0 ->> 'op_id')::uuid FROM t118_ret WHERE k = 't3')], 'done') $$, '42501', 'network_share: not allowed', 'a reviewer still cannot settle it');
SELECT public.t118_e();
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[(SELECT (v -> 0 ->> 'op_id')::uuid FROM t118_ret WHERE k = 't3')], 'done') $$, 'a check seat may');
RESET ROLE;

-- A creator who has lost the seat no longer sees or settles it.
SET LOCAL ROLE authenticated;
SELECT public.t118_c();
INSERT INTO t118_ret SELECT 'lost', public.network_share_record_added('aaaa1111-0000-0000-0000-000000011801', public.t118_root(), NULL, '[{"n":"lost.mov","s":"3"}]'::jsonb);
INSERT INTO t118_ret SELECT 'lost2', public.network_share_trash(ARRAY[(SELECT (v -> 0 ->> 'id')::uuid FROM t118_ret WHERE k = 'lost')]);
RESET ROLE;
DELETE FROM public.project_members WHERE project_id = 'aaaa1111-0000-0000-0000-000000011801' AND user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
SET LOCAL ROLE authenticated;
SELECT is(public.network_share_pending_mine(), '[]'::jsonb, 'someone who has left the project no longer sees their pending operation');
SELECT throws_ok($$ SELECT public.network_share_settle(ARRAY[(SELECT (v -> 0 ->> 'op_id')::uuid FROM t118_ret WHERE k = 'lost2')], 'done') $$, '42501', 'network_share: not allowed', 'nor settles it');
RESET ROLE;
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1111-0000-0000-0000-000000011801', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[(SELECT (v -> 0 ->> 'op_id')::uuid FROM t118_ret WHERE k = 'lost2')], 'done') $$, 'and takes it up again on coming back');

-- Add.
SELECT public.t118_v();
SELECT throws_ok($$ SELECT public.network_share_record_added('aaaa1111-0000-0000-0000-000000011801', public.t118_root(), NULL, '[{"n":"v.mov","s":"3"}]'::jsonb) $$, '42501', 'network_share: not allowed', 'a reviewer cannot add');
SELECT public.t118_c();
INSERT INTO t118_ret SELECT 'add', public.network_share_record_added('aaaa1111-0000-0000-0000-000000011801', public.t118_root(), '11800000-0000-0000-0000-0000000000f1', '[{"n":"add1.mov","s":"3","m":"2026-10-01T10:00:00Z","t":"video/quicktime"},{"n":"add2.mov","s":"4"}]'::jsonb);
SELECT is((SELECT v -> 0 ->> 'to' FROM t118_ret WHERE k = 'add'), 'Salt-Hours/rushes/add1.mov', 'an add lands at the space''s folder and the folder''s path');
SELECT is(current_setting('wilson.network_share_writer', true), '', 'the marker is empty after the call');
SELECT throws_ok($$ SELECT public.network_share_record_added('aaaa1111-0000-0000-0000-000000011801', public.t118_root(), '11800000-0000-0000-0000-0000000000f1', '[{"n":"ADD1.mov","s":"3"}]'::jsonb) $$, 'P0001', 'network_share: occupied', 'a name already listed is refused');
SELECT throws_ok($$ SELECT public.network_share_record_added('aaaa1111-0000-0000-0000-000000011801', public.t118_root(), NULL, '[{"n":"dup.mov","s":"3"},{"n":"DUP.mov","s":"3"}]'::jsonb) $$, 'P0001', 'network_share: occupied', 'and the same name twice in one call');
SELECT throws_ok($$ SELECT public.network_share_record_added('aaaa1111-0000-0000-0000-000000011801', public.t118_root(), NULL, '[{"n":"INVOICES","s":"3"}]'::jsonb) $$, 'P0001', 'network_share: bad_name', 'a money name');
SELECT throws_ok($$ SELECT public.network_share_record_added('aaaa1111-0000-0000-0000-000000011801', public.t118_root(), NULL, '[{"n":"a/b.mov","s":"3"}]'::jsonb) $$, 'P0001', 'network_share: bad_name', 'a name with a slash in it');
SELECT throws_ok($$ SELECT public.network_share_record_added('aaaa1111-0000-0000-0000-000000011801', public.t118_root(), NULL, '[{"n":".x.mov","s":"3"}]'::jsonb) $$, 'P0001', 'network_share: bad_name', 'a dot-led name');
SELECT throws_ok($$ SELECT public.network_share_record_added('aaaa1111-0000-0000-0000-000000011801', public.t118_root(), NULL, '[{"n":"s.mov","s":"x"}]'::jsonb) $$, 'P0001', 'network_share: bad_entry', 'a bad size');
SELECT throws_ok($$ SELECT public.network_share_record_added('aaaa1111-0000-0000-0000-000000011801', public.t118_root(), NULL, '[{"n":"s.mov","s":"1","m":"soon"}]'::jsonb) $$, 'P0001', 'network_share: bad_entry', 'a bad time');
SELECT throws_ok($$ SELECT public.network_share_record_added('aaaa1111-0000-0000-0000-000000011801', public.t118_root(), NULL, '[{"n":"s.mov","s":"1","t":"no type"}]'::jsonb) $$, 'P0001', 'network_share: bad_entry', 'a bad type');
SELECT throws_ok($$ SELECT public.network_share_record_added('aaaa1111-0000-0000-0000-000000011801', public.t118_root(), NULL, '[7]'::jsonb) $$, 'P0001', 'network_share: bad_entry', 'an entry that is not an object');
SELECT throws_ok($$ SELECT public.network_share_record_added('aaaa1111-0000-0000-0000-000000011801', public.t118_root(), NULL, '[]'::jsonb) $$, 'P0001', 'network_share: bad_request', 'no entries');
SELECT throws_ok($$ SELECT public.network_share_record_added('aaaa1111-0000-0000-0000-000000011801', public.t118_root(), NULL, (SELECT jsonb_agg(jsonb_build_object('n', 'f' || g, 's', '1')) FROM generate_series(1, 51) g)) $$, 'P0001', 'network_share: bad_request', '51 entries');
SELECT throws_ok($$ SELECT public.network_share_record_added('aaaa1111-0000-0000-0000-000000011801', 'C:/wilson', NULL, '[{"n":"r.mov","s":"3"}]'::jsonb) $$, 'P0001', 'network_share: drive_changed', 'another root');
SELECT throws_ok($$ SELECT public.network_share_record_added('aaaa1111-0000-0000-0000-000000011801', public.t118_root(), '11800000-0000-0000-0000-0000000000f4', '[{"n":"r.mov","s":"3"}]'::jsonb) $$, 'P0001', 'network_share: no_folder', 'another project''s folder');
SELECT throws_ok($$ SELECT public.network_share_record_added('aaaa1111-0000-0000-0000-000000011801', public.t118_root(), '11800000-0000-0000-0000-0000000000f3', '[{"n":"r.mov","s":"3"}]'::jsonb) $$, 'P0001', 'network_share: no_folder', 'a money folder');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.file_events WHERE file_id = (SELECT (v -> 0 ->> 'id')::uuid FROM t118_ret WHERE k = 'add') AND event = 'uploaded'), 1, 'a WILSON add records uploaded');
SELECT is((SELECT state || '/' || op FROM public.network_share_ops WHERE file_id = (SELECT (v -> 0 ->> 'id')::uuid FROM t118_ret WHERE k = 'add')), 'done/add', 'and the journal says done: the copy came first');
SELECT is((SELECT size_bytes || '|' || folder_id::text || '|' || mime_type FROM public.files WHERE id = (SELECT (v -> 0 ->> 'id')::uuid FROM t118_ret WHERE k = 'add')), '3|11800000-0000-0000-0000-0000000000f1|video/quicktime', 'and the row says what the desktop said');
SELECT is((SELECT count(*)::int FROM public.files WHERE storage_path = 'nas:Salt-Hours/rushes/add2.mov' AND thumbnail_url IS NULL AND NOT is_financial), 1, 'no picture, no flag');

-- The cores, as 0118's fn_moth_apply_moves will call them: the runner with a person's claims.
SELECT public.t118_c();
SELECT public.t118_row('11800000-0000-0000-0000-000000000404', 'aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours/ops/m1.mov');
SELECT is((SELECT public._network_share_move_core('11800000-0000-0000-0000-000000000404', 'aaaa1111-0000-0000-0000-000000011806', '11800000-0000-0000-0000-0000000000f4', '{}'::jsonb, false) ->> 'to'), 'Moon-Film/m1.mov',
  'a plan says where the file lands; the root folder has no path');
SELECT is((SELECT count(*)::int FROM public.network_share_ops WHERE file_id = '11800000-0000-0000-0000-000000000404'), 0, 'and writes nothing');
INSERT INTO t118_ret SELECT 'm1', public._network_share_move_core('11800000-0000-0000-0000-000000000404', 'aaaa1111-0000-0000-0000-000000011806', NULL, '{"project_id":"x"}'::jsonb);
SELECT is((SELECT state || '/' || op || '/' || dest_project_id::text || '/' || (origin ->> 'project_id') FROM public.network_share_ops WHERE file_id = '11800000-0000-0000-0000-000000000404'),
  'pending/move/aaaa1111-0000-0000-0000-000000011806/x', 'a commit journals one pending move with its origin');
SELECT is((SELECT storage_path FROM public.files WHERE id = '11800000-0000-0000-0000-000000000404'), 'nas:Salt-Hours/ops/m1.mov', 'and leaves the row to fn_moth_apply_moves');
SELECT throws_ok($$ SELECT public._network_share_move_core('11800000-0000-0000-0000-000000000404', 'aaaa1111-0000-0000-0000-000000011806', NULL, '{}'::jsonb) $$, 'P0001', 'network_share: pending', 'a pending file cannot be moved again');
SELECT public.t118_row('11800000-0000-0000-0000-000000000405', 'aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours/ops/m1b/m1.mov');
SELECT throws_ok($$ SELECT public._network_share_move_core('11800000-0000-0000-0000-000000000405', 'aaaa1111-0000-0000-0000-000000011806', NULL, '{}'::jsonb) $$, 'P0001', 'network_share: occupied', 'a name a pending operation is bringing is taken');
SELECT throws_ok($$ SELECT public._network_share_move_core('11800000-0000-0000-0000-000000000405', 'aaaa1111-0000-0000-0000-000000011803', NULL, '{}'::jsonb) $$, 'P0001', 'network_share: no_folder', 'a destination with no folder');
SELECT throws_ok($$ SELECT public._network_share_move_core('11800000-0000-0000-0000-000000000405', 'aaaa1111-0000-0000-0000-000000011807', NULL, '{}'::jsonb) $$, 'P0001', 'network_share: no_folder', 'a trashed destination');
SELECT throws_ok($$ SELECT public._network_share_move_core('11800000-0000-0000-0000-000000000309', 'aaaa1111-0000-0000-0000-000000011806', NULL, '{}'::jsonb) $$, '42501', 'network_share: not allowed', 'a row that is gone');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.network_share_settle(ARRAY[(SELECT (v ->> 'op_id')::uuid FROM t118_ret WHERE k = 'm1')], 'not_moved') $$, 'P0001', 'network_share: moves_not_ready', 'a move''s way back is 0118''s, under the journal: refused until then');
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[(SELECT (v ->> 'op_id')::uuid FROM t118_ret WHERE k = 'm1')], 'done') $$, 'its done is here');
RESET ROLE;

INSERT INTO public.files (id, project_id, name, storage_provider, storage_path) VALUES
  ('11800000-0000-0000-0000-000000000406', 'aaaa1111-0000-0000-0000-000000011801', 'local.mov', 'local_server', 'projects/aaaa1111-0000-0000-0000-000000011801/files/11800000-0000-0000-0000-000000000406/local.mov');
SELECT throws_ok($$ SELECT public._network_share_adopt_core('11800000-0000-0000-0000-000000000404', 'aaaa1111-0000-0000-0000-000000011806', NULL, '{}'::jsonb) $$, '42501', 'network_share: not allowed', 'adopt is for a local file');
SELECT throws_ok($$ SELECT public._network_share_move_core('11800000-0000-0000-0000-000000000406', 'aaaa1111-0000-0000-0000-000000011806', NULL, '{}'::jsonb) $$, '42501', 'network_share: not allowed', 'and a move for an office-server one');
INSERT INTO t118_ret SELECT 'ad', public._network_share_adopt_core('11800000-0000-0000-0000-000000000406', 'aaaa1111-0000-0000-0000-000000011806', NULL, '{"path":"p"}'::jsonb);
SELECT is((SELECT v ->> 'to' FROM t118_ret WHERE k = 'ad'), 'Moon-Film/local.mov', 'adopt says where the copy goes');
SELECT is((SELECT from_locator IS NULL AND state = 'pending' AND op = 'adopt' FROM public.network_share_ops WHERE file_id = '11800000-0000-0000-0000-000000000406'), true, 'with no from: the body is on a computer');
-- What fn_moth_apply_moves will have done by the time the desktop settles.
UPDATE public.files SET storage_provider = 'network_share', storage_path = 'nas:Moon-Film/local.mov', project_id = 'aaaa1111-0000-0000-0000-000000011806' WHERE id = '11800000-0000-0000-0000-000000000406';
SET LOCAL ROLE authenticated;
SELECT public.t118_a();
SELECT throws_ok($$ SELECT public.network_share_settle(ARRAY[(SELECT (v ->> 'op_id')::uuid FROM t118_ret WHERE k = 'ad')], 'done') $$, '42501', 'network_share: not allowed', 'adopt''s done is its creator''s');
SELECT public.t118_c();
SELECT throws_ok($$ SELECT public.network_share_settle(ARRAY[(SELECT (v ->> 'op_id')::uuid FROM t118_ret WHERE k = 'ad')], 'done') $$, 'P0001', 'network_share: bad_facts', 'and needs the facts of the copy');
SELECT throws_ok($$ SELECT public.network_share_settle(ARRAY[(SELECT (v ->> 'op_id')::uuid FROM t118_ret WHERE k = 'ad')], 'done', jsonb_build_object((SELECT v ->> 'op_id' FROM t118_ret WHERE k = 'ad'), jsonb_build_object('s', 'x', 'm', '2026-10-01T10:00:00Z'))) $$, 'P0001', 'network_share: bad_facts', 'a bad size is refused');
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[(SELECT (v ->> 'op_id')::uuid FROM t118_ret WHERE k = 'ad')], 'done', jsonb_build_object((SELECT v ->> 'op_id' FROM t118_ret WHERE k = 'ad'), jsonb_build_object('s', '4242', 'm', '2026-10-01T10:00:00Z'))) $$, 'with them it settles');
RESET ROLE;
SELECT is((SELECT size_bytes FROM public.files WHERE id = '11800000-0000-0000-0000-000000000406'), 4242::bigint, 'and the row takes the copy''s size');


-- ── I. A purge ───────────────────────────────────────────────────────────────
SELECT public.t118_row('11800000-0000-0000-0000-000000000501', 'aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours/purge/p1.mov');
SELECT public.t118_row('11800000-0000-0000-0000-000000000502', 'aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours/purge/p2.mov');
SELECT public.t118_row('11800000-0000-0000-0000-000000000503', 'aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours/purge/p3.mov');
SET LOCAL ROLE authenticated;
SELECT public.t118_c();
INSERT INTO t118_ret SELECT 'p1', public.network_share_trash(ARRAY['11800000-0000-0000-0000-000000000501'::uuid]);
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[(SELECT (v -> 0 ->> 'op_id')::uuid FROM t118_ret WHERE k = 'p1')], 'done') $$, 'a file in the bin');
RESET ROLE;
UPDATE public.files SET deleted_at = now() - interval '31 days' WHERE id = '11800000-0000-0000-0000-000000000501';
UPDATE public.files SET deleted_at = now() - interval '31 days' WHERE id = '11800000-0000-0000-0000-000000000502';

SELECT public.purge_soft_deleted();

SELECT is((SELECT count(*)::int FROM public.files WHERE id IN ('11800000-0000-0000-0000-000000000501', '11800000-0000-0000-0000-000000000502')), 0, 'the nightly purge removes them at 30 days');
SELECT is((SELECT details ->> 'body' FROM public.file_events WHERE file_id = '11800000-0000-0000-0000-000000000501' AND event = 'purged'), 'company server bin', 'the certificate says the file is in the bin');
SELECT is((SELECT details ->> 'body' FROM public.file_events WHERE file_id = '11800000-0000-0000-0000-000000000502' AND event = 'purged'), 'left on the company server', 'or left where it was');
SELECT is((SELECT count(*)::int FROM public.storage_gc_queue
            WHERE object_path LIKE 'nas:%'
               OR file_id IN ('11800000-0000-0000-0000-000000000501', '11800000-0000-0000-0000-000000000502')), 0,
  'and nothing is queued: the server''s files are not the cloud''s to remove');
SELECT is((SELECT count(*)::int FROM public.network_share_ops WHERE file_id = '11800000-0000-0000-0000-000000000501'), 0, 'its journal goes with it');

SET LOCAL ROLE authenticated;
SELECT public.t118_e();
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours', '[]'::jsonb,
    '["11800000-0000-0000-0000-000000000501","11800000-0000-0000-0000-000000000403","11800000-0000-0000-0000-00000000dead","not-a-uuid"]'::jsonb, false) -> 'purge_ok'),
  '["11800000-0000-0000-0000-000000000501"]'::jsonb, 'the id then appears in purge_ok, and only that id');
-- Moon-Film's certificate does not answer for Salt Hours' bin.
SELECT public.t118_a();
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011806', 'Moon-Film', '[]'::jsonb, '["11800000-0000-0000-0000-000000000501"]'::jsonb, false) -> 'purge_ok'), '[]'::jsonb,
  'another project''s certificate does not');
-- A live row whose file is still in the bin goes back. One with a pending operation does not.
SELECT public.t118_e();
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours', '[]'::jsonb, '["11800000-0000-0000-0000-000000000503"]'::jsonb, false) -> 'restore_back' -> 0 ->> 'to'), 'Salt-Hours/purge/p3.mov', 'a live row found in the bin goes back');
RESET ROLE;

-- The cloud's meter is not the server's.
SELECT public.t118_row('11800000-0000-0000-0000-000000000504', 'aaaa1111-0000-0000-0000-000000011801', 'Salt-Hours/purge/big.mov', 5000000);
CREATE TEMP TABLE t118_meter ON COMMIT DROP AS SELECT public.workspace_petal_committed_bytes('11111111-1111-1111-1111-111111111111') AS b;
DELETE FROM public.files WHERE id = '11800000-0000-0000-0000-000000000504';
SELECT is(public.workspace_petal_committed_bytes('11111111-1111-1111-1111-111111111111'), (SELECT b FROM t118_meter), 'and an office-server row does not count in Petal''s storage');

-- A project's delete cascades through this guard, and the certificate says where the files are.
SELECT public.t118_row('11800000-0000-0000-0000-000000000505', 'aaaa1111-0000-0000-0000-000000011808', 'Leaving/g.mov');
SELECT public.t118_a();
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ DELETE FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000011808' $$, 'an admin''s delete of a project goes through to its office-server rows');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.files WHERE id = '11800000-0000-0000-0000-000000000505'), 0, 'and they are gone');
SELECT is((SELECT details ->> 'body' FROM public.file_events WHERE file_id = '11800000-0000-0000-0000-000000000505' AND event = 'purged'), 'left on the company server', 'with a certificate');


-- ── J. A personal space on the office server (PS-7) ──────────────────────────
SELECT public.t118_c();
SET LOCAL ROLE authenticated;
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011804', '_WILSON_PERSONAL/cccccccc-cccc-cccc-cccc-cccccccccccc',
    jsonb_build_array(public.t118_dir('_WILSON_PERSONAL/cccccccc-cccc-cccc-cccc-cccccccccccc', true, '{}', '[["mine.mov","6"]]'))) ->> 'added'), '1',
  'the owner''s walk lists their own folder');
SELECT throws_ok($$ SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011804', '_WILSON_PERSONAL/dddddddd-dddd-dddd-dddd-dddddddddddd', '[]'::jsonb) $$, 'P0001', 'network_share: no_folder', 'and no other folder');
INSERT INTO t118_ret SELECT 'pa', public.network_share_record_added('aaaa1111-0000-0000-0000-000000011804', public.t118_root(), NULL, '[{"n":"added.mov","s":"8"}]'::jsonb);
SELECT is((SELECT v -> 0 ->> 'to' FROM t118_ret WHERE k = 'pa'), '_WILSON_PERSONAL/cccccccc-cccc-cccc-cccc-cccccccccccc/added.mov', 'an add lands in their folder');
INSERT INTO t118_ret SELECT 'pt', public.network_share_trash(ARRAY[(SELECT (v -> 0 ->> 'id')::uuid FROM t118_ret WHERE k = 'pa')]);
SELECT is((SELECT v -> 0 ->> 'to' FROM t118_ret WHERE k = 'pt'), '_WILSON_PERSONAL/cccccccc-cccc-cccc-cccc-cccccccccccc/.wilson-bin/' || (SELECT v -> 0 ->> 'id' FROM t118_ret WHERE k = 'pa') || '/added.mov', 'a delete goes to the bin inside it');
SELECT public.t118_e();
SELECT is((SELECT count(*)::int FROM public.files WHERE project_id = 'aaaa1111-0000-0000-0000-000000011804'), 0, 'nobody else reads the rows');
SELECT throws_ok($$ SELECT public.network_share_record_added('aaaa1111-0000-0000-0000-000000011804', public.t118_root(), NULL, '[{"n":"x.mov","s":"8"}]'::jsonb) $$, '42501', 'network_share: not allowed', 'nor adds');
SELECT public.t118_a();
SELECT throws_ok($$ SELECT public.network_share_record_added('aaaa1111-0000-0000-0000-000000011804', public.t118_root(), NULL, '[{"n":"x.mov","s":"8"}]'::jsonb) $$, '42501', 'network_share: not allowed', 'an admin neither: the seat is the owner''s');
SELECT throws_ok($$ SELECT public.network_share_trash(ARRAY[public.t118_id('_WILSON_PERSONAL/cccccccc-cccc-cccc-cccc-cccccccccccc/mine.mov')]) $$, '42501', 'network_share: not allowed', 'nor deletes');
RESET ROLE;


-- ── K. Who may call what, and who names the marker ───────────────────────────
SELECT ok(NOT has_function_privilege('anon', 'public.network_share_catalogue_apply(uuid,text,text,jsonb,jsonb,boolean,text,boolean)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.network_share_record_added(uuid,text,uuid,jsonb)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.network_share_trash(uuid[])', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.network_share_restore(uuid[])', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.network_share_settle(uuid[],text,jsonb)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.network_share_pending_mine()', 'EXECUTE'),
  'anon may call none of the six');
SELECT ok(has_function_privilege('authenticated', 'public.network_share_catalogue_apply(uuid,text,text,jsonb,jsonb,boolean,text,boolean)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.network_share_record_added(uuid,text,uuid,jsonb)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.network_share_trash(uuid[])', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.network_share_restore(uuid[])', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.network_share_settle(uuid[],text,jsonb)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.network_share_pending_mine()', 'EXECUTE'),
  'a signed-in client may');
SELECT is((SELECT array_agg(x) FROM unnest(ARRAY[
    'public.network_share_space_folder(uuid)', 'public.network_share_claims(uuid)',
    'public._network_share_mtime(text)', 'public._network_share_drive(uuid)',
    'public._network_share_inside(text,text)', 'public._network_share_placed(text,text)',
    'public._network_share_folder_refused(uuid,text)', 'public._network_share_assert_folder(uuid,uuid,text)',
    'public._network_share_overlaps(text,text)',
    'public._network_share_claim_taken(uuid,uuid,text,text)',
    'public._network_share_may_check(uuid)', 'public._network_share_may_write(uuid)',
    'public._network_share_lock_projects(uuid[])', 'public._network_share_target(uuid,uuid,uuid,text,uuid)',
    'public._network_share_replay_origin(uuid)', 'public._network_share_move_core(uuid,uuid,uuid,jsonb,boolean)',
    'public._network_share_adopt_core(uuid,uuid,uuid,jsonb,boolean)',
    'public.fn_files_network_share_delete_guard()']) x
   WHERE has_function_privilege('authenticated', x, 'EXECUTE') OR has_function_privilege('anon', x, 'EXECUTE')), NULL::text[],
  'and no client may call any of the fifteen helpers');
SELECT is((SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p
            WHERE p.prosecdef
              AND p.pronamespace = 'public'::regnamespace
              AND (p.proname LIKE 'network\_share\_%' OR p.proname LIKE '\_network\_share\_%')
              AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search\_path=%')), NULL::text[],
  'every definer pins its search path');
SELECT is((SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p
            WHERE p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
              AND p.prosrc LIKE '%wilson.network_share_writer%'),
  ARRAY['fn_file_events_capture', 'fn_files_body_guard', 'fn_realtime_broadcast',
        'network_share_catalogue_apply', 'network_share_record_added', 'network_share_restore',
        'network_share_settle', 'network_share_trash'],
  'the marker is named by the three readers and the five writers, and nothing else');
SELECT is((SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p
            WHERE p.proname IN ('network_share_catalogue_apply', 'network_share_record_added', 'network_share_restore', 'network_share_settle', 'network_share_trash')
              AND p.prosrc NOT LIKE '%set_config(''wilson.network_share_writer'', '''', true)%'), NULL::text[],
  'and each writer resets it');


-- ── M. What the first review found ──────────────────────────────────────────
RESET ROLE;
SELECT public.t118_a();

-- These folders could not be set by anyone bound: that is what is being proved.
CREATE FUNCTION public.t118_repoint(p_project uuid, p_folder text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  ALTER TABLE public.projects DISABLE TRIGGER USER;
  UPDATE public.projects SET folder_root = public.t118_folder(p_folder) WHERE id = p_project;
  ALTER TABLE public.projects ENABLE TRIGGER USER;
END;
$f$;
CREATE FUNCTION public.t118_trashed(p_id uuid, p_project uuid, p_loc text, p_folder text) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, size_bytes, source_modified_at, deleted_at, share_bin_path)
  VALUES (p_id, p_project, regexp_replace(p_loc, '^.*/', ''), 'network_share', 'nas:' || p_loc, 1, '2026-10-01T10:00:00Z', now(),
          p_folder || '/.wilson-bin/' || p_id::text || '/' || regexp_replace(p_loc, '^.*/', ''));
$f$;
CREATE FUNCTION public.t118_add(p_project uuid, p_folder_id uuid, p_name text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT public.network_share_record_added(p_project, public.t118_root(), p_folder_id,
    jsonb_build_array(jsonb_build_object('n', p_name, 's', '3')));
$f$;
CREATE FUNCTION public.t118_walk(p_project uuid, p_folder text, p_dirs jsonb, p_final boolean, p_first boolean) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT public.network_share_catalogue_apply(p_project, public.t118_root(), p_folder, p_dirs, '[]'::jsonb, p_final, NULL, p_first);
$f$;
CREATE FUNCTION public.t118_op(p_key text) RETURNS uuid LANGUAGE sql STABLE AS
$f$ SELECT COALESCE(v -> 0 ->> 'op_id', v ->> 'op_id')::uuid FROM t118_ret WHERE k = p_key $f$;
-- As suite 112: a stack may have no realtime schema, or no partition for today.
CREATE FUNCTION public.t118_rt_env() RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  n bigint;
BEGIN
  IF to_regclass('realtime.messages') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
                     WHERE ns.nspname = 'realtime' AND p.proname = 'send') THEN
    RETURN 'no-schema';
  END IF;
  PERFORM realtime.send('{"probe":true}'::jsonb, 'PGTAP-PROBE', 'rabbit:pgtap:118-partition-probe', true);
  EXECUTE 'SELECT count(*) FROM realtime.messages WHERE topic = ''rabbit:pgtap:118-partition-probe''' INTO n;
  RETURN CASE WHEN n = 0 THEN 'no-partition' ELSE 'ok' END;
END;
$f$;
CREATE FUNCTION public.t118_msgs(p_project uuid) RETURNS integer LANGUAGE plpgsql AS $f$
DECLARE
  n integer;
BEGIN
  EXECUTE 'SELECT count(*)::int FROM realtime.messages WHERE topic = $1 AND payload ->> ''table'' = ''network_share_checks'''
    INTO n USING public.project_topic(p_project);
  RETURN n;
END;
$f$;
CREATE TEMP TABLE t118_rt ON COMMIT DROP AS SELECT public.t118_rt_env() AS env;
GRANT ALL ON t118_rt TO authenticated;

ALTER TABLE public.projects DISABLE TRIGGER USER;
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, folder_root, deleted_at) VALUES
  ('aaaa1111-0000-0000-0000-000000011811', '11111111-1111-1111-1111-111111111111', 'Round', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, public.t118_folder('Round'), NULL),
  ('aaaa1111-0000-0000-0000-000000011812', '11111111-1111-1111-1111-111111111111', 'Gone Round', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, public.t118_folder('Gone-Round'), now()),
  ('aaaa1111-0000-0000-0000-000000011814', '11111111-1111-1111-1111-111111111111', 'Tree', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, public.t118_folder('Tree'), NULL),
  ('aaaa1111-0000-0000-0000-000000011815', '11111111-1111-1111-1111-111111111111', 'Branch', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, public.t118_folder('Tree/Branch'), NULL),
  ('aaaa1111-0000-0000-0000-000000011816', '11111111-1111-1111-1111-111111111111', 'Claimer', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL, NULL),
  ('aaaa1111-0000-0000-0000-000000011817', '11111111-1111-1111-1111-111111111111', 'Third', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, public.t118_folder('Round3'), NULL),
  ('aaaa1111-0000-0000-0000-000000011818', '11111111-1111-1111-1111-111111111111', 'Finance', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, public.t118_folder('Finance'), NULL),
  ('aaaa1111-0000-0000-0000-000000011819', '11111111-1111-1111-1111-111111111111', 'Walker', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, public.t118_folder('Walker'), NULL),
  ('aaaa1111-0000-0000-0000-000000011813', '22222222-2222-2222-2222-222222222222', 'Other', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false, NULL, NULL);
ALTER TABLE public.projects ENABLE TRIGGER USER;
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1111-0000-0000-0000-000000011811', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'), ('aaaa1111-0000-0000-0000-000000011811', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'manager'),
  ('aaaa1111-0000-0000-0000-000000011814', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'), ('aaaa1111-0000-0000-0000-000000011817', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'), ('aaaa1111-0000-0000-0000-000000011819', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT DO NOTHING;
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('11800000-0000-0000-0000-0000000000f8', 'aaaa1111-0000-0000-0000-000000011814', NULL, 'root', 'tree', ''),
  ('11800000-0000-0000-0000-0000000000f9', 'aaaa1111-0000-0000-0000-000000011814', '11800000-0000-0000-0000-0000000000f8', 'category', 'branch', 'Branch');
SELECT public.t118_row('11800000-0000-0000-0000-000000000901'::uuid, 'aaaa1111-0000-0000-0000-000000011811', 'Round/k.mov');
SELECT public.t118_row('11800000-0000-0000-0000-000000000902'::uuid, 'aaaa1111-0000-0000-0000-000000011802', 'Quiet-Room/z.mov');
SELECT public.t118_row('11800000-0000-0000-0000-000000000903'::uuid, 'aaaa1111-0000-0000-0000-000000011814', 'Tree/k.mov');
SELECT public.t118_trashed('11800000-0000-0000-0000-000000000904'::uuid, 'aaaa1111-0000-0000-0000-000000011814', 'Tree/t.mov', 'Tree');
SELECT public.t118_row('11800000-0000-0000-0000-000000000905'::uuid, 'aaaa1111-0000-0000-0000-000000011811', 'Round/ops/t1.mov');
SELECT public.t118_row('11800000-0000-0000-0000-000000000906'::uuid, 'aaaa1111-0000-0000-0000-000000011811', 'Round/ops/t2.mov');
SELECT public.t118_row('11800000-0000-0000-0000-000000000907'::uuid, 'aaaa1111-0000-0000-0000-000000011811', 'Round/ops/t3.mov');

-- What every read of zero above is measured against: somebody does read these.
SET LOCAL ROLE authenticated;
SELECT public.t118_a();
SELECT ok((SELECT count(*) FROM public.edit_history WHERE entity_type = 'files' AND project_id = 'aaaa1111-0000-0000-0000-000000011802') >= 1, 'an admin reads a private project''s catalogue history');
SELECT public.t118_e();
SELECT ok((SELECT count(*) FROM public.file_events WHERE project_id = 'aaaa1111-0000-0000-0000-000000011802') >= 1, 'the creator reads its events');
SELECT ok((SELECT count(*) FROM public.files WHERE project_id = 'aaaa1111-0000-0000-0000-000000011802') >= 1, 'and its rows');
SELECT public.t118_c();
SELECT ok((SELECT count(*) FROM public.files WHERE project_id = 'aaaa1111-0000-0000-0000-000000011804') >= 1, 'the owner reads their personal space''s rows');

-- _network_share_may_write's own gates, one sentence each.
SELECT public.t118_d();
SELECT throws_ok($$ SELECT public.t118_add('aaaa1111-0000-0000-0000-000000011802', NULL, 'no.mov') $$, '42501', 'network_share: not allowed', 'a manager with no seat on a private project cannot add');
SELECT throws_ok($$ SELECT public.network_share_trash(ARRAY['11800000-0000-0000-0000-000000000902'::uuid]) $$, '42501', 'network_share: not allowed', 'nor delete');
SELECT public.t118_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'admin');
SELECT throws_ok($$ SELECT public.t118_add('aaaa1111-0000-0000-0000-000000011811', NULL, 'no.mov') $$, '42501', 'network_share: not allowed', 'an inactive member with an admin''s token cannot add');
SELECT throws_ok($$ SELECT public.network_share_trash(ARRAY['11800000-0000-0000-0000-000000000901'::uuid]) $$, '42501', 'network_share: not allowed', 'nor delete');
SELECT public.t118_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222');
SELECT throws_ok($$ SELECT public.t118_add('aaaa1111-0000-0000-0000-000000011811', NULL, 'no.mov') $$, '42501', 'network_share: not allowed', 'another company''s admin cannot add');
SELECT public.t118_a();
SELECT throws_ok($$ SELECT public.t118_add('aaaa1111-0000-0000-0000-000000011812', NULL, 'no.mov') $$, '42501', 'network_share: not allowed', 'nobody adds to a project in the bin');
SELECT lives_ok($$ SELECT public.t118_add('aaaa1111-0000-0000-0000-000000011811', NULL, 'yes.mov') $$, 'and the admin adds to a live one');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.files WHERE storage_path = 'nas:Round/yes.mov'), 1, 'one row, in its folder');

-- Never a slug: a member-writable column never names a folder a walk or an add reads.
UPDATE public.projects SET folder_slug = 'New-Slug' WHERE id = 'aaaa1111-0000-0000-0000-000000011803';
SELECT is(public.network_share_space_folder('aaaa1111-0000-0000-0000-000000011803'), NULL, 'a slug is never a project''s folder');
SELECT throws_ok($$ SELECT public._network_share_move_core('11800000-0000-0000-0000-000000000901'::uuid, 'aaaa1111-0000-0000-0000-000000011803', NULL, '{}'::jsonb, false) $$, 'P0001', 'network_share: no_folder', 'nor a place a file can land');
SET LOCAL ROLE authenticated;
SELECT public.t118_a();
SELECT throws_ok($$ SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011803', 'New-Slug', '[]'::jsonb) $$, 'P0001', 'network_share: no_folder', 'nor what an apply may walk');
RESET ROLE;
UPDATE public.projects SET folder_slug = NULL WHERE id = 'aaaa1111-0000-0000-0000-000000011803';

-- A live row with an unsettled operation is walked past (NS-D5).
SET LOCAL ROLE authenticated;
SELECT public.t118_c();
INSERT INTO t118_ret SELECT 'm-t', public.network_share_trash(ARRAY['11800000-0000-0000-0000-000000000905'::uuid]);
SELECT public.network_share_settle(ARRAY[public.t118_op('m-t')], 'done');
INSERT INTO t118_ret SELECT 'm-r', public.network_share_restore(ARRAY['11800000-0000-0000-0000-000000000905'::uuid]);
SELECT public.t118_e();
INSERT INTO t118_ret SELECT 'm-w', public.t118_apply('aaaa1111-0000-0000-0000-000000011811', 'Round',
  jsonb_build_array(public.t118_dir('Round/ops', true, '{}', '[["t2.mov","1"],["t3.mov","1"]]')), jsonb_build_array('11800000-0000-0000-0000-000000000905'::uuid), false);
SELECT is((SELECT v ->> 'newly_missing' FROM t118_ret WHERE k = 'm-w'), '0', 'a walk does not mark a row an unsettled restore holds');
SELECT is((SELECT v -> 'restore_back' FROM t118_ret WHERE k = 'm-w'), '[]'::jsonb, 'nor ask for its file back');
RESET ROLE;
SELECT is((SELECT share_missing_since FROM public.files WHERE id = '11800000-0000-0000-0000-000000000905'::uuid), NULL, 'it reads as there');
UPDATE public.files SET share_missing_since = now() WHERE id = '11800000-0000-0000-0000-000000000905'::uuid;
SET LOCAL ROLE authenticated;
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011811', 'Round',
    jsonb_build_array(public.t118_dir('Round/ops', true, '{}', '[["t1.mov","1"],["t2.mov","1"],["t3.mov","1"]]')), '[]'::jsonb, false) ->> 'found_again'), '0',
  'a walk that finds it does not clear it either');
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011811', 'Round',
    jsonb_build_array(public.t118_dir('Round/ops', true, '{}', '[["t2.mov","1"],["t3.mov","1"]]'),
                      public.t118_dir('Round/ops2', true, '{}', '[["t1.mov","1"]]')), '[]'::jsonb, false) ->> 'renamed'), '0',
  'and a row an operation holds is not renamed, even one marked');
RESET ROLE;
SELECT is((SELECT storage_path FROM public.files WHERE id = '11800000-0000-0000-0000-000000000905'::uuid), 'nas:Round/ops/t1.mov', 'it stays where the journal says');
UPDATE public.files SET share_missing_since = NULL WHERE id = '11800000-0000-0000-0000-000000000905'::uuid;
-- The left-behind arm, on a final call.
SELECT public.t118_repoint('aaaa1111-0000-0000-0000-000000011811', 'Round2');
SET LOCAL ROLE authenticated;
SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011811', 'Round2', '[]'::jsonb);
RESET ROLE;
SELECT is((SELECT share_missing_since FROM public.files WHERE id = '11800000-0000-0000-0000-000000000905'::uuid), NULL, 'a row its folder has left is not marked while an operation holds it');
SELECT ok((SELECT share_missing_since IS NOT NULL FROM public.files WHERE id = '11800000-0000-0000-0000-000000000906'::uuid), 'and its neighbour is');
SELECT public.t118_repoint('aaaa1111-0000-0000-0000-000000011811', 'Round');
UPDATE public.files SET share_missing_since = NULL WHERE project_id = 'aaaa1111-0000-0000-0000-000000011811';
SET LOCAL ROLE authenticated;
SELECT public.t118_c();
SELECT public.network_share_settle(ARRAY[public.t118_op('m-r')], 'done');
RESET ROLE;

-- Renames: beside a trashed twin, across directories in one call, across a walk's calls, and two
-- candidates for one row.
SELECT public.t118_row('11800000-0000-0000-0000-000000000910'::uuid, 'aaaa1111-0000-0000-0000-000000011819', 'Walker/old/m.mov', 5);
SELECT public.t118_trashed('11800000-0000-0000-0000-000000000911'::uuid, 'aaaa1111-0000-0000-0000-000000011819', 'Walker/new/m.mov', 'Walker');
SELECT public.t118_row('11800000-0000-0000-0000-000000000912'::uuid, 'aaaa1111-0000-0000-0000-000000011819', 'Walker/ga/x2.mov', 6);
SELECT public.t118_row('11800000-0000-0000-0000-000000000913'::uuid, 'aaaa1111-0000-0000-0000-000000011819', 'Walker/ha/y.mov', 7);
SELECT public.t118_a();
SET LOCAL ROLE authenticated;
INSERT INTO t118_ret SELECT 'm-rn1', public.t118_apply('aaaa1111-0000-0000-0000-000000011819', 'Walker',
  jsonb_build_array(public.t118_dir('Walker', true, ARRAY['new','ga','ha'], '[]'),
                    public.t118_dir('Walker/new', true, '{}', '[["m.mov","5"]]')));
SELECT is((SELECT v ->> 'renamed' FROM t118_ret WHERE k = 'm-rn1'), '1', 'a folder renamed on the server: the row beside a trashed twin keeps its id');
SELECT is((SELECT v ->> 'added' FROM t118_ret WHERE k = 'm-rn1'), '0', 'and nothing comes up as new');
RESET ROLE;
SELECT is((SELECT storage_path FROM public.files WHERE id = '11800000-0000-0000-0000-000000000910'::uuid), 'nas:Walker/new/m.mov', 'at its new place');
SELECT is((SELECT size_bytes::int FROM public.files WHERE id = '11800000-0000-0000-0000-000000000911'::uuid), 1, 'and the trashed twin is left exactly as it was');
SET LOCAL ROLE authenticated;
SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011819', 'Walker',
  jsonb_build_array(public.t118_dir('Walker', true, ARRAY['new','gb','ha'], '[]')), '[]'::jsonb, false);
RESET ROLE;
SELECT ok((SELECT share_missing_since IS NOT NULL FROM public.files WHERE id = '11800000-0000-0000-0000-000000000912'::uuid), 'a walk''s first call marks the rows of a folder that has gone');
SET LOCAL ROLE authenticated;
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011819', 'Walker',
    jsonb_build_array(public.t118_dir('Walker/gb', true, '{}', '[["x2.mov","6"]]'))) ->> 'renamed'), '1', 'and its next call finds them at the new name');
RESET ROLE;
SELECT ok((SELECT storage_path = 'nas:Walker/gb/x2.mov' AND share_missing_since IS NULL FROM public.files WHERE id = '11800000-0000-0000-0000-000000000912'::uuid), 'the same row, no longer missing');
SET LOCAL ROLE authenticated;
INSERT INTO t118_ret SELECT 'm-rn2', public.t118_apply('aaaa1111-0000-0000-0000-000000011819', 'Walker',
  jsonb_build_array(public.t118_dir('Walker', true, ARRAY['new','gb','hb','hc'], '[]'),
                    public.t118_dir('Walker/hb', true, '{}', '[["y.mov","7"]]'),
                    public.t118_dir('Walker/hc', true, '{}', '[["y.mov","7"]]')));
SELECT is((SELECT (v ->> 'renamed') || '/' || (v ->> 'added') FROM t118_ret WHERE k = 'm-rn2'), '0/2', 'two equal entries and one gone row: not a rename');
RESET ROLE;
-- A trashed row keeps its facts, whatever a walk reports at its old place.
UPDATE public.files SET deleted_at = now(), share_bin_path = 'Walker/.wilson-bin/' || '11800000-0000-0000-0000-000000000913'::uuid::text || '/y.mov' WHERE id = '11800000-0000-0000-0000-000000000913'::uuid;
SET LOCAL ROLE authenticated;
SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011819', 'Walker', jsonb_build_array(public.t118_dir('Walker/ha', true, '{}', '[["y.mov","99"]]')), '[]'::jsonb, false);
RESET ROLE;
SELECT is((SELECT size_bytes::int FROM public.files WHERE id = '11800000-0000-0000-0000-000000000913'::uuid), 7, 'a trashed row''s facts do not move');

-- After 24 hours: a check seat settles what began and ends in its own folder, and nothing else.
SELECT public.t118_row('11800000-0000-0000-0000-000000000920'::uuid, 'aaaa1111-0000-0000-0000-000000011811', 'Round/ad.mov');
SELECT public.t118_row('11800000-0000-0000-0000-000000000921'::uuid, 'aaaa1111-0000-0000-0000-000000011811', 'Round/mv.mov');
SELECT public.t118_row('11800000-0000-0000-0000-000000000922'::uuid, 'aaaa1111-0000-0000-0000-000000011806', 'Moon-Film/mv2.mov');
SELECT public.t118_row('11800000-0000-0000-0000-000000000923'::uuid, 'aaaa1111-0000-0000-0000-000000011811', 'Round/old.mov');
INSERT INTO public.network_share_ops (id, workspace_id, file_id, project_id, dest_project_id, op, from_locator, to_locator, origin, created_by, created_at) VALUES
  ('11800000-0000-0000-0000-00000000a920', '11111111-1111-1111-1111-111111111111', '11800000-0000-0000-0000-000000000920'::uuid, 'aaaa1111-0000-0000-0000-000000011811', 'aaaa1111-0000-0000-0000-000000011811', 'adopt', NULL, 'Round/ad.mov', '{}', 'cccccccc-cccc-cccc-cccc-cccccccccccc', now() - interval '25 hours'),
  ('11800000-0000-0000-0000-00000000a921', '11111111-1111-1111-1111-111111111111', '11800000-0000-0000-0000-000000000921'::uuid, 'aaaa1111-0000-0000-0000-000000011811', 'aaaa1111-0000-0000-0000-000000011806', 'move', 'Round/mv.mov', 'Moon-Film/mv.mov', '{}', 'cccccccc-cccc-cccc-cccc-cccccccccccc', now() - interval '25 hours'),
  ('11800000-0000-0000-0000-00000000a922', '11111111-1111-1111-1111-111111111111', '11800000-0000-0000-0000-000000000922'::uuid, 'aaaa1111-0000-0000-0000-000000011811', 'aaaa1111-0000-0000-0000-000000011806', 'move', 'Round/mv2.mov', 'Moon-Film/mv2.mov', '{}', 'cccccccc-cccc-cccc-cccc-cccccccccccc', now() - interval '25 hours'),
  ('11800000-0000-0000-0000-00000000a923', '11111111-1111-1111-1111-111111111111', '11800000-0000-0000-0000-000000000923'::uuid, 'aaaa1111-0000-0000-0000-000000011811', 'aaaa1111-0000-0000-0000-000000011811', 'adopt', NULL, 'Round/old.mov', '{}', 'cccccccc-cccc-cccc-cccc-cccccccccccc', now());
SET LOCAL ROLE authenticated;
SELECT public.t118_a();
SELECT throws_ok($$ SELECT public.network_share_settle(ARRAY['11800000-0000-0000-0000-00000000a920'::uuid], 'done') $$, '42501', 'network_share: not allowed', 'a check seat cannot settle somebody''s adopt, however old');
SELECT throws_ok($$ SELECT public.network_share_settle(ARRAY['11800000-0000-0000-0000-00000000a921'::uuid], 'not_moved') $$, '42501', 'network_share: not allowed', 'nor a cross-project move, with the row at its source');
SELECT throws_ok($$ SELECT public.network_share_settle(ARRAY['11800000-0000-0000-0000-00000000a922'::uuid], 'done') $$, '42501', 'network_share: not allowed', 'nor one with the row at its destination');
INSERT INTO t118_ret SELECT 'm-st', public.t118_apply('aaaa1111-0000-0000-0000-000000011811', 'Round', '[]'::jsonb, '[]'::jsonb, false);
SELECT is((SELECT count(*)::int FROM t118_ret, jsonb_array_elements(v -> 'stale') e WHERE k = 'm-st' AND e ->> 'op_id' LIKE '11800000-0000-0000-0000-00000000a92%'), 0, 'and none of them is offered to it as stale');
-- A verified copy with a date this cannot store: the size goes on, the row's time stays.
SELECT public.t118_c();
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY['11800000-0000-0000-0000-00000000a923'::uuid], 'done',
    '{"11800000-0000-0000-0000-00000000a923":{"s":"44","m":"1970-01-01T00:00:00Z"}}'::jsonb) $$, 'an adopt of a file dated before 1980 can settle');
RESET ROLE;
SELECT ok((SELECT size_bytes = 44 AND source_modified_at = '2026-10-01T10:00:00Z' FROM public.files WHERE id = '11800000-0000-0000-0000-000000000923'::uuid), 'with its size, and the row''s own time');
DELETE FROM public.network_share_ops WHERE file_id IN ('11800000-0000-0000-0000-000000000920'::uuid, '11800000-0000-0000-0000-000000000921'::uuid, '11800000-0000-0000-0000-000000000922'::uuid, '11800000-0000-0000-0000-000000000923'::uuid);

-- A client's hard delete: a trashed row is guarded too, on its own.
SELECT public.t118_row('11800000-0000-0000-0000-000000000930'::uuid, 'aaaa1111-0000-0000-0000-000000011813', 'Other/t.mov');
UPDATE public.files SET deleted_at = now(), share_bin_path = 'Other/.wilson-bin/' || '11800000-0000-0000-0000-000000000930'::uuid::text || '/t.mov' WHERE id = '11800000-0000-0000-0000-000000000930'::uuid;
SELECT public.t118_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ DELETE FROM public.files $$, '42501', 'A file on your office server changes only through the desktop app.', 'a client cannot hard-delete a trashed office-server row');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.files WHERE id = '11800000-0000-0000-0000-000000000930'::uuid), 1, 'it is still there');

-- A walk across calls: only the last moves "last checked", and it reads complete only if all were.
SELECT public.t118_a();
INSERT INTO t118_ret SELECT 'm-lc', to_jsonb(last_checked_at) FROM public.network_share_checks WHERE project_id = 'aaaa1111-0000-0000-0000-000000011819';
SET LOCAL ROLE authenticated;
SELECT public.t118_walk('aaaa1111-0000-0000-0000-000000011819', 'Walker', jsonb_build_array(public.t118_dir('Walker/gb', true, '{}', '[["x2.mov","6"]]')), false, true);
RESET ROLE;
SELECT is((SELECT to_jsonb(last_checked_at) FROM public.network_share_checks WHERE project_id = 'aaaa1111-0000-0000-0000-000000011819'), (SELECT v FROM t118_ret WHERE k = 'm-lc'), 'a call that is not the last leaves last checked alone');
SELECT ok((SELECT run_open FROM public.network_share_checks WHERE project_id = 'aaaa1111-0000-0000-0000-000000011819'), 'and holds the run open');
SET LOCAL ROLE authenticated;
SELECT public.t118_walk('aaaa1111-0000-0000-0000-000000011819', 'Walker', jsonb_build_array(public.t118_dir('Walker/new', true, '{}', '[["m.mov","5"]]')), true, false);
RESET ROLE;
SELECT ok((SELECT complete AND NOT run_open AND dirs_checked = 2 AND files_seen = 2
             AND to_jsonb(last_checked_at) IS DISTINCT FROM (SELECT v FROM t118_ret WHERE k = 'm-lc')
             FROM public.network_share_checks WHERE project_id = 'aaaa1111-0000-0000-0000-000000011819'), 'the last call closes it, adds up the run and moves last checked');
SET LOCAL ROLE authenticated;
SELECT public.t118_walk('aaaa1111-0000-0000-0000-000000011819', 'Walker', jsonb_build_array(public.t118_dir('Walker/gb', false, '{}', '[]')), false, true);
SELECT public.t118_walk('aaaa1111-0000-0000-0000-000000011819', 'Walker', jsonb_build_array(public.t118_dir('Walker/new', true, '{}', '[["m.mov","5"]]')), true, false);
RESET ROLE;
SELECT ok((SELECT NOT complete FROM public.network_share_checks WHERE project_id = 'aaaa1111-0000-0000-0000-000000011819'), 'one incomplete call and the walk is not complete, though its last was');
SET LOCAL ROLE authenticated;
SELECT public.t118_walk('aaaa1111-0000-0000-0000-000000011819', 'Walker', '[]'::jsonb, true, true);
RESET ROLE;
SELECT ok((SELECT NOT complete FROM public.network_share_checks WHERE project_id = 'aaaa1111-0000-0000-0000-000000011819'), 'a walk that sent no directory has checked nothing');
SET LOCAL ROLE authenticated;
SELECT public.t118_walk('aaaa1111-0000-0000-0000-000000011819', 'Walker', '[{"d":"../x","complete":true,"files":[]}]'::jsonb || jsonb_build_array(public.t118_dir('Walker/new', true, '{}', '[["m.mov","5"]]')), true, true);
RESET ROLE;
SELECT ok((SELECT NOT complete FROM public.network_share_checks WHERE project_id = 'aaaa1111-0000-0000-0000-000000011819'), 'a walk with a directory it could not use is not complete');
-- A walk that stopped half way does not spoil the next one.
SET LOCAL ROLE authenticated;
SELECT public.t118_walk('aaaa1111-0000-0000-0000-000000011819', 'Walker', jsonb_build_array(public.t118_dir('Walker/gb', false, '{}', '[]')), false, true);
SELECT public.t118_walk('aaaa1111-0000-0000-0000-000000011819', 'Walker', jsonb_build_array(public.t118_dir('Walker/new', true, '{}', '[["m.mov","5"]]')), true, true);
RESET ROLE;
SELECT ok((SELECT complete AND dirs_checked = 1 AND files_seen = 1 FROM public.network_share_checks WHERE project_id = 'aaaa1111-0000-0000-0000-000000011819'), 'a walk''s first call starts afresh: an abandoned walk is forgotten');

-- The thin broadcast: one signal for a check, on the project's own topic.
INSERT INTO t118_ret SELECT 'm-b0', to_jsonb(CASE WHEN (SELECT env FROM t118_rt) = 'ok' THEN public.t118_msgs('aaaa1111-0000-0000-0000-000000011819') ELSE 0 END);
SET LOCAL ROLE authenticated;
SELECT public.t118_walk('aaaa1111-0000-0000-0000-000000011819', 'Walker', jsonb_build_array(public.t118_dir('Walker/new', true, '{}', '[["m.mov","5"]]')), false, true);
RESET ROLE;
SELECT CASE WHEN (SELECT env FROM t118_rt) = 'ok'
  THEN is(public.t118_msgs('aaaa1111-0000-0000-0000-000000011819'), (SELECT (v #>> '{}')::int FROM t118_ret WHERE k = 'm-b0'), 'a call that is not the last sends nothing')
  ELSE ok(true, 'a call that is not the last sends nothing (no realtime here)') END;
SET LOCAL ROLE authenticated;
SELECT public.t118_walk('aaaa1111-0000-0000-0000-000000011819', 'Walker', jsonb_build_array(public.t118_dir('Walker/gb', true, '{}', '[["x2.mov","6"]]')), true, false);
RESET ROLE;
SELECT CASE WHEN (SELECT env FROM t118_rt) = 'ok'
  THEN is(public.t118_msgs('aaaa1111-0000-0000-0000-000000011819'), (SELECT (v #>> '{}')::int + 1 FROM t118_ret WHERE k = 'm-b0'), 'the last sends one')
  ELSE ok(true, 'the last sends one (no realtime here)') END;
INSERT INTO t118_ret SELECT 'm-b1', to_jsonb(CASE WHEN (SELECT env FROM t118_rt) = 'ok' THEN public.t118_msgs('aaaa1111-0000-0000-0000-000000011802') ELSE 0 END);
SELECT public.t118_e();
SET LOCAL ROLE authenticated;
SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011802', 'Quiet-Room', jsonb_build_array(public.t118_dir('Quiet-Room', true, '{}', '[["q.mov","1"],["z.mov","1"]]')));
RESET ROLE;
SELECT CASE WHEN (SELECT env FROM t118_rt) = 'ok'
  THEN is(public.t118_msgs('aaaa1111-0000-0000-0000-000000011802'), (SELECT (v #>> '{}')::int + 1 FROM t118_ret WHERE k = 'm-b1'), 'a private project''s goes to its own topic')
  ELSE ok(true, 'a private project''s goes to its own topic (no realtime here)') END;

-- The refusal arms nothing else reaches.
SELECT public.t118_row('11800000-0000-0000-0000-000000000940'::uuid, 'aaaa1111-0000-0000-0000-000000011811', 'Round/q.mov');
SELECT public.t118_trashed('11800000-0000-0000-0000-000000000942'::uuid, 'aaaa1111-0000-0000-0000-000000011811', 'Round/u.mov', 'Round');
SET LOCAL ROLE authenticated;
SELECT public.t118_c();
INSERT INTO t118_ret SELECT 'm-q', public.network_share_trash(ARRAY['11800000-0000-0000-0000-000000000940'::uuid]);
SELECT throws_ok($$ SELECT public.t118_add('aaaa1111-0000-0000-0000-000000011811', NULL, 'q.mov') $$, 'P0001', 'network_share: occupied', 'a name freed by a pending delete cannot be added while the file still sits there');
SELECT throws_ok($$ SELECT public.network_share_restore(ARRAY['11800000-0000-0000-0000-000000000940'::uuid]) $$, 'P0001', 'network_share: pending', 'nor can a row with a pending delete be restored');
RESET ROLE;
SELECT public.t118_row('11800000-0000-0000-0000-000000000941'::uuid, 'aaaa1111-0000-0000-0000-000000011811', 'Round/q.mov');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.network_share_settle(ARRAY[public.t118_op('m-q')], 'not_moved') $$, 'P0001', 'network_share: occupied', 'a delete that did not happen, with a live row at its name: refused, not a raw error');
RESET ROLE;
DELETE FROM public.files WHERE id = '11800000-0000-0000-0000-000000000941'::uuid;
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.network_share_settle(ARRAY[public.t118_op('m-q')], 'not_moved') $$, 'and with the name free it settles');
RESET ROLE;
UPDATE public.workspace_storage SET mode = 'central' WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.network_share_trash(ARRAY['11800000-0000-0000-0000-000000000901'::uuid]) $$, 'P0001', 'network_share: drive_changed', 'a company that has left its server: no delete');
SELECT throws_ok($$ SELECT public.network_share_restore(ARRAY['11800000-0000-0000-0000-000000000942'::uuid]) $$, 'P0001', 'network_share: drive_changed', 'and no restore');
RESET ROLE;
UPDATE public.workspace_storage SET mode = 'byos' WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
SELECT public.t118_e();
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011811', 'Round', jsonb_build_array(jsonb_build_object('d', 'Round', 'complete', false, 'subdirs',
    (SELECT jsonb_agg('s' || g) FROM generate_series(1, 20001) g)))) $$, 'P0001', 'network_share: too_large', 'more than 20,000 subfolders in a call');
RESET ROLE;

-- A row its folder has left names a file that may be somebody else's by now.
SELECT public.t118_row('11800000-0000-0000-0000-000000000943'::uuid, 'aaaa1111-0000-0000-0000-000000011811', 'Round/z.mov');
SELECT public.t118_trashed('11800000-0000-0000-0000-000000000944'::uuid, 'aaaa1111-0000-0000-0000-000000011811', 'Round/y.mov', 'Round');
SELECT public.t118_repoint('aaaa1111-0000-0000-0000-000000011811', 'Round2');
SELECT throws_ok($$ SELECT public._network_share_move_core('11800000-0000-0000-0000-000000000943'::uuid, 'aaaa1111-0000-0000-0000-000000011806', NULL, '{}'::jsonb, false) $$, 'P0001', 'network_share: no_folder', 'a row its folder has left cannot be moved');
SET LOCAL ROLE authenticated;
SELECT public.t118_c();
SELECT throws_ok($$ SELECT public.network_share_trash(ARRAY['11800000-0000-0000-0000-000000000943'::uuid]) $$, 'P0001', 'network_share: no_folder', 'nor deleted');
SELECT throws_ok($$ SELECT public.network_share_restore(ARRAY['11800000-0000-0000-0000-000000000944'::uuid]) $$, 'P0001', 'network_share: no_folder', 'nor a trashed one restored');
SELECT public.t118_e();
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011811', 'Round2', '[]'::jsonb, jsonb_build_array('11800000-0000-0000-0000-000000000943'::uuid), false) -> 'restore_back'), '[]'::jsonb, 'nor asked back from the bin');
SELECT public.t118_a();
SELECT throws_ok($$ UPDATE public.projects SET folder_root = public.t118_folder('Round') WHERE id = 'aaaa1111-0000-0000-0000-000000011816' $$, '42501', 'This folder is already used by another project or space on the company server.', 'and nobody else can take a folder another project''s rows are still in');
RESET ROLE;
SELECT public.t118_repoint('aaaa1111-0000-0000-0000-000000011811', 'Round');
UPDATE public.files SET share_missing_since = NULL WHERE project_id = 'aaaa1111-0000-0000-0000-000000011811';
-- Nor one an unsettled operation still names, with no live row there at all.
SELECT public.t118_row('11800000-0000-0000-0000-000000000945'::uuid, 'aaaa1111-0000-0000-0000-000000011817', 'Round3/p.mov');
SET LOCAL ROLE authenticated;
SELECT public.t118_c();
INSERT INTO t118_ret SELECT 'm-p', public.network_share_trash(ARRAY['11800000-0000-0000-0000-000000000945'::uuid]);
RESET ROLE;
SELECT public.t118_repoint('aaaa1111-0000-0000-0000-000000011817', 'Round4');
SET LOCAL ROLE authenticated;
SELECT public.t118_a();
SELECT throws_ok($$ UPDATE public.projects SET folder_root = public.t118_folder('Round3') WHERE id = 'aaaa1111-0000-0000-0000-000000011816' $$, '42501', 'This folder is already used by another project or space on the company server.', 'nor one an unsettled operation still names');
RESET ROLE;
SELECT public.t118_repoint('aaaa1111-0000-0000-0000-000000011817', 'Round3');
SET LOCAL ROLE authenticated;
SELECT public.t118_c();
SELECT public.network_share_settle(ARRAY[public.t118_op('m-p')], 'done');

-- Nested folders, set before the company moved to its server: every call that names a real file
-- refuses, not only the apply.
SELECT throws_ok($$ SELECT public.t118_add('aaaa1111-0000-0000-0000-000000011814', '11800000-0000-0000-0000-0000000000f9', 'cut.mov') $$, 'P0001', 'network_share: folder_shared', 'no add into a folder inside which another project lives');
SELECT throws_ok($$ SELECT public.network_share_trash(ARRAY['11800000-0000-0000-0000-000000000903'::uuid]) $$, 'P0001', 'network_share: folder_shared', 'no delete');
SELECT throws_ok($$ SELECT public.network_share_restore(ARRAY['11800000-0000-0000-0000-000000000904'::uuid]) $$, 'P0001', 'network_share: folder_shared', 'no restore');
RESET ROLE;
SELECT throws_ok($$ SELECT public._network_share_move_core('11800000-0000-0000-0000-000000000903'::uuid, 'aaaa1111-0000-0000-0000-000000011806', NULL, '{}'::jsonb, false) $$, 'P0001', 'network_share: folder_shared', 'no move out of it');
SELECT throws_ok($$ SELECT public._network_share_move_core('11800000-0000-0000-0000-000000000901'::uuid, 'aaaa1111-0000-0000-0000-000000011814', NULL, '{}'::jsonb, false) $$, 'P0001', 'network_share: folder_shared', 'and no move into it');
SELECT public.t118_repoint('aaaa1111-0000-0000-0000-000000011815', 'Branch-Free');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.t118_add('aaaa1111-0000-0000-0000-000000011814', '11800000-0000-0000-0000-0000000000f9', 'cut.mov') $$, 'and once the folders are apart, the add goes in');

-- A folder inside the drive under a name no catalogue may hold: refused when it is set, and one
-- already there stops only its own project.
SELECT public.t118_a();
SELECT throws_ok($$ UPDATE public.projects SET folder_root = public.t118_folder('Legal') WHERE id = 'aaaa1111-0000-0000-0000-000000011816' $$, '42501', 'WILSON cannot keep a project''s files in this folder on the company server. Choose another.', 'a money or Legal folder is refused when it is set');
SELECT throws_ok($$ UPDATE public.projects SET folder_root = public.t118_folder('.archive') WHERE id = 'aaaa1111-0000-0000-0000-000000011816' $$, '42501', 'WILSON cannot keep a project''s files in this folder on the company server. Choose another.', 'and a dot-led one');
SELECT throws_ok($$ UPDATE public.projects SET folder_root = public.t118_folder('_WILSO~1') WHERE id = 'aaaa1111-0000-0000-0000-000000011816' $$, '42501', 'WILSON cannot keep a project''s files in this folder on the company server. Choose another.', 'and a short name');
SELECT throws_ok($$ INSERT INTO public.projects (id, workspace_id, title, created_by, folder_root) VALUES ('aaaa1111-0000-0000-0000-00000001181a', '11111111-1111-1111-1111-111111111111', 'New', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', public.t118_folder('Invoices')) $$, '42501', 'WILSON cannot keep a project''s files in this folder on the company server. Choose another.', 'at an INSERT too');
SELECT throws_ok($$ UPDATE public.projects SET folder_root = public.t118_folder('Finance/sub') WHERE id = 'aaaa1111-0000-0000-0000-000000011816' $$, '42501', 'This folder is already used by another project or space on the company server.', 'a refused name still claims its path');
SELECT throws_ok($$ SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011818', 'Finance', '[]'::jsonb) $$, 'P0001', 'network_share: no_folder', 'one already there reads no_folder for its own project');
SELECT lives_ok($$ SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011811', 'Round', '[]'::jsonb, '[]'::jsonb, false) $$, 'and stops nobody else');
RESET ROLE;
SELECT ok((SELECT c.placed AND c.prefix = 'Finance' FROM public.network_share_claims('11111111-1111-1111-1111-111111111111') c WHERE c.project_id = 'aaaa1111-0000-0000-0000-000000011818'), 'it is a placed claim, on its path');
SELECT is(public._network_share_folder_refused('11111111-1111-1111-1111-111111111111', public.t118_root()), true, 'the drive itself is refused');
SELECT is(public._network_share_folder_refused('11111111-1111-1111-1111-111111111111', public.t118_folder('Fine')), false, 'a good folder is not');
SELECT is(public._network_share_folder_refused('11111111-1111-1111-1111-111111111111', 'C:/elsewhere'), false, 'nor one outside the drive: that is the apply''s unplaced claim');

-- The sweep: no more than the cap in a call, and the walk finishes by sending it again.
INSERT INTO public.files (project_id, name, storage_provider, storage_path, size_bytes)
SELECT 'aaaa1111-0000-0000-0000-000000011817', 'f' || g, 'network_share', 'nas:Round3/big/f' || g || '.mov', 1 FROM generate_series(1, 1501) g;
SELECT public.t118_a();
SET LOCAL ROLE authenticated;
INSERT INTO t118_ret SELECT 'm-s1', public.t118_apply('aaaa1111-0000-0000-0000-000000011817', 'Round3', jsonb_build_array(public.t118_dir('Round3/big', true, '{}', '[]')));
SELECT is((SELECT (v ->> 'newly_missing') || '/' || (v ->> 'more_missing') FROM t118_ret WHERE k = 'm-s1'), '1500/true', 'a sweep past the cap marks the cap and says there is more');
RESET ROLE;
SELECT ok((SELECT last_checked_at IS NULL AND NOT complete AND NOT run_open AND dirs_checked = 0 FROM public.network_share_checks WHERE project_id = 'aaaa1111-0000-0000-0000-000000011817'), 'and that send adds nothing to the run');
SET LOCAL ROLE authenticated;
INSERT INTO t118_ret SELECT 'm-s2', public.t118_apply('aaaa1111-0000-0000-0000-000000011817', 'Round3', jsonb_build_array(public.t118_dir('Round3/big', true, '{}', '[]')));
SELECT is((SELECT (v ->> 'newly_missing') || '/' || (v ->> 'more_missing') FROM t118_ret WHERE k = 'm-s2'), '1/false', 'the same call again finishes it');
RESET ROLE;
SELECT ok((SELECT last_checked_at IS NOT NULL AND complete AND dirs_checked = 1 AND missing_count = 1501 FROM public.network_share_checks WHERE project_id = 'aaaa1111-0000-0000-0000-000000011817'), 'and moves last checked, once');

-- A left-behind sweep has the same cap, with no room when the rest of the call took it all. A send
-- with more to do adds nothing, even a walk's first; the send that finishes starts the run afresh.
SELECT public.t118_repoint('aaaa1111-0000-0000-0000-000000011817', 'Round5');
UPDATE public.files SET share_missing_since = NULL WHERE project_id = 'aaaa1111-0000-0000-0000-000000011817';
INSERT INTO public.files (project_id, name, storage_provider, storage_path, size_bytes)
SELECT 'aaaa1111-0000-0000-0000-000000011817', 'g' || g, 'network_share', 'nas:Round5/big2/g' || g || '.mov', 1 FROM generate_series(1, 1500) g;
SET LOCAL ROLE authenticated;
SELECT public.t118_walk('aaaa1111-0000-0000-0000-000000011817', 'Round5', '[]'::jsonb, false, true);
INSERT INTO t118_ret SELECT 'm-s3', public.t118_walk('aaaa1111-0000-0000-0000-000000011817', 'Round5', jsonb_build_array(public.t118_dir('Round5/big2', true, '{}', '[]')), true, true);
SELECT is((SELECT (v ->> 'newly_missing') || '/' || (v ->> 'more_missing') FROM t118_ret WHERE k = 'm-s3'), '1500/true', 'with the cap spent on what has gone, the left-behind rows wait and it says so');
RESET ROLE;
SELECT ok((SELECT run_open FROM public.network_share_checks WHERE project_id = 'aaaa1111-0000-0000-0000-000000011817'), 'a first call with more to do leaves the run as it was');
SET LOCAL ROLE authenticated;
INSERT INTO t118_ret SELECT 'm-s4', public.t118_walk('aaaa1111-0000-0000-0000-000000011817', 'Round5', jsonb_build_array(public.t118_dir('Round5/big2', true, '{}', '[]')), true, true);
SELECT is((SELECT (v ->> 'newly_missing') || '/' || (v ->> 'more_missing') FROM t118_ret WHERE k = 'm-s4'), '1500/true', 'the left-behind sweep has the cap too');
INSERT INTO t118_ret SELECT 'm-s5', public.t118_walk('aaaa1111-0000-0000-0000-000000011817', 'Round5', jsonb_build_array(public.t118_dir('Round5/big2', true, '{}', '[]')), true, true);
SELECT is((SELECT (v ->> 'newly_missing') || '/' || (v ->> 'more_missing') FROM t118_ret WHERE k = 'm-s5'), '1/false', 'and the last send finishes it');
RESET ROLE;
SELECT ok((SELECT complete AND NOT run_open AND dirs_checked = 1 AND missing_count = 3001 FROM public.network_share_checks WHERE project_id = 'aaaa1111-0000-0000-0000-000000011817'), 'and the run is that send''s alone');

-- A desktop recovering from a crash asks the same questions before it renames anything.
INSERT INTO public.network_share_ops (id, workspace_id, file_id, project_id, op, from_locator, to_locator, created_by) VALUES
  ('11800000-0000-0000-0000-00000000a903', '11111111-1111-1111-1111-111111111111', '11800000-0000-0000-0000-000000000903'::uuid, 'aaaa1111-0000-0000-0000-000000011814', 'trash',
   'Tree/k.mov', 'Tree/.wilson-bin/11800000-0000-0000-0000-000000000903/k.mov', 'cccccccc-cccc-cccc-cccc-cccccccccccc');
SELECT public.t118_repoint('aaaa1111-0000-0000-0000-000000011815', 'Tree/Branch');
SET LOCAL ROLE authenticated;
SELECT public.t118_c();
SELECT throws_ok($$ SELECT public.network_share_pending_mine() $$, 'P0001', 'network_share: folder_shared', 'pending_mine refuses while the folder is not its own');
RESET ROLE;
UPDATE public.workspace_storage SET mode = 'central' WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.network_share_pending_mine() $$, 'P0001', 'network_share: drive_changed', 'or the company has left its server');
RESET ROLE;
UPDATE public.workspace_storage SET mode = 'byos' WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
SELECT public.t118_repoint('aaaa1111-0000-0000-0000-000000011815', 'Branch-Free');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(public.network_share_pending_mine()) e WHERE e ->> 'op_id' = '11800000-0000-0000-0000-00000000a903'), 1, 'and returns it once the folders are apart');
RESET ROLE;
DELETE FROM public.network_share_ops WHERE id = '11800000-0000-0000-0000-00000000a903';

-- A purge holds a project in the bin the same way, because its purge would cascade to the row.
SELECT public.t118_row('11800000-0000-0000-0000-000000000951'::uuid, 'aaaa1111-0000-0000-0000-000000011816', 'Claimer/pg.mov');
INSERT INTO public.network_share_ops (id, workspace_id, file_id, project_id, op, from_locator, to_locator, created_by) VALUES
  ('11800000-0000-0000-0000-00000000a951', '11111111-1111-1111-1111-111111111111', '11800000-0000-0000-0000-000000000951'::uuid, 'aaaa1111-0000-0000-0000-000000011816', 'trash',
   'Claimer/pg.mov', 'Claimer/.wilson-bin/11800000-0000-0000-0000-000000000951/pg.mov', 'cccccccc-cccc-cccc-cccc-cccccccccccc');
ALTER TABLE public.projects DISABLE TRIGGER USER;
UPDATE public.projects SET deleted_at = now() - interval '31 days' WHERE id = 'aaaa1111-0000-0000-0000-000000011816';
ALTER TABLE public.projects ENABLE TRIGGER USER;
SELECT public.purge_soft_deleted();
SELECT is((SELECT count(*)::int FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000011816'), 1, 'a project in the bin stays while a file in it has an unsettled operation');
SELECT is((SELECT state FROM public.network_share_ops WHERE id = '11800000-0000-0000-0000-00000000a951'), 'pending', 'and so does the journal');
UPDATE public.network_share_ops SET state = 'done', settled_at = now() WHERE id = '11800000-0000-0000-0000-00000000a951';
SELECT public.purge_soft_deleted();
SELECT is((SELECT count(*)::int FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000011816'), 0, 'and goes at the purge after it settles');

-- A purge holds a row whose operation has not settled, and takes it the night after.
SELECT public.t118_row('11800000-0000-0000-0000-000000000950'::uuid, 'aaaa1111-0000-0000-0000-000000011811', 'Round/pg.mov');
SET LOCAL ROLE authenticated;
SELECT public.t118_c();
INSERT INTO t118_ret SELECT 'm-pg', public.network_share_trash(ARRAY['11800000-0000-0000-0000-000000000950'::uuid]);
RESET ROLE;
UPDATE public.files SET deleted_at = now() - interval '31 days' WHERE id = '11800000-0000-0000-0000-000000000950'::uuid;
SELECT public.purge_soft_deleted();
SELECT is((SELECT count(*)::int FROM public.files WHERE id = '11800000-0000-0000-0000-000000000950'::uuid), 1, 'a trashed row with an unsettled operation stays past its 30 days');
SELECT is((SELECT state FROM public.network_share_ops WHERE file_id = '11800000-0000-0000-0000-000000000950'::uuid), 'pending', 'and so does its journal');
SET LOCAL ROLE authenticated;
SELECT public.network_share_settle(ARRAY[public.t118_op('m-pg')], 'done');
RESET ROLE;
UPDATE public.files SET deleted_at = now() - interval '31 days' WHERE id = '11800000-0000-0000-0000-000000000950'::uuid;
SELECT public.purge_soft_deleted();
SELECT is((SELECT count(*)::int FROM public.files WHERE id = '11800000-0000-0000-0000-000000000950'::uuid), 0, 'once it settles, the next purge takes it');

-- What a locator may not be, from the review: bytes, and short names.
SELECT is(public.network_share_locator_ok(repeat(chr(27721), 700)), false, 'a path under 1,024 characters and over 2,000 bytes');
SELECT is(public.network_share_locator_ok('P_DATA~1/rates.json'), false, 'a short name for a folder');
SELECT is(public.network_share_locator_ok('Salt-Hours/CLIP~12.MOV'), false, 'or for a file');
SELECT is(public.network_share_locator_ok('Salt-Hours/shot~final/a.mov'), true, 'a tilde in an ordinary name is fine');
SELECT is(public.network_share_locator_ok('a/' || repeat(chr(128512), 4) || '~1.txt'), false, 'a short name is counted in characters, as the desktop counts it');
SELECT is(public._network_share_mtime('2026-01-01T00:00:00+99:00'), NULL, 'a time zone no file has is no time at all, not an error');


-- ── L. The row cap ───────────────────────────────────────────────────────────
-- Fifty thousand rows through the guards would take a minute, so this transaction takes them off.
ALTER TABLE public.files DISABLE TRIGGER USER;
ALTER TABLE public.files DROP CONSTRAINT files_network_share_shape_chk;
ALTER TABLE public.files DROP CONSTRAINT files_network_share_namespace_chk;
ALTER TABLE public.files DROP CONSTRAINT files_network_share_extra_chk;
INSERT INTO public.files (workspace_id, project_id, name, storage_provider, storage_path)
SELECT '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000011805', 'x', 'network_share', 'nas:Rate/f' || g
  FROM generate_series(1, 49999) g;
ALTER TABLE public.files ENABLE TRIGGER USER;

UPDATE public.network_share_checks SET window_started_at = now() - interval '11 minutes' WHERE project_id = 'aaaa1111-0000-0000-0000-000000011805';
SELECT public.t118_a();
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011805', 'Rate', '[{"d":"Rate","complete":false,"subdirs":[],"files":[{"n":"n1","s":"1"},{"n":"n2","s":"1"}]}]'::jsonb, '[]', false) $$,
  'P0001', 'network_share: too_many', 'an apply that would take a project past 50,000 rows is refused whole');
SELECT throws_ok($$ SELECT public.network_share_record_added('aaaa1111-0000-0000-0000-000000011805', public.t118_root(), NULL, '[{"n":"n1","s":"1"},{"n":"n2","s":"1"}]'::jsonb) $$,
  'P0001', 'network_share: too_many', 'and an add');
SELECT is((SELECT public.t118_apply('aaaa1111-0000-0000-0000-000000011805', 'Rate', '[{"d":"Rate","complete":false,"subdirs":[],"files":[{"n":"n1","s":"1"}]}]'::jsonb, '[]', false) ->> 'added'), '1',
  'and the fifty-thousandth is not');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
