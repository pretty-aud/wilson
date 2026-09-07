-- =========================================================================
-- 52_folders.sql — Session 26, migration 0041.
--
-- The behavioural suite for the folder tree.
--
-- What it PINS:
--  1. The standing structural block — table, RLS enabled AND forced, four
--     policies, no FOR ALL arm, workspace stamped by trigger (1-6).
--  2. THE ACCESS RULES. Folders are ordinary project content, not money: a
--     project MEMBER creates them, a REVIEWER reads but cannot write, and an
--     admin of another workspace sees nothing (7-13).
--  3. 🚨 THE ANTI-DOUBLE-FOLDER GUARANTEE (14-15). The named hazard of this
--     session is one entity ending up with two folders because two copies of
--     fileSlugify disagreed. Both uniqueness rules are asserted, because a
--     duplicate that only the client prevents is a duplicate.
--  4. 🚨 AUDREY'S ACTUAL REQUIREMENT (16-17): deleting a scene takes its
--     folder with it, but TOGGLING A CATEGORY OFF DELETES NOTHING. The whole
--     reason this is a table rather than a storage convention is that an
--     empty folder has to be able to outlive its contents.
--  5. Containment and shape (18-19) — `path` is concatenated onto a
--     filesystem root, so a traversal segment is a write outside the project.
--  6. The two `projects` columns this session consumes (20-21).
--  7. anon reaches nothing (22).
--
-- NOT asserted, deliberately: that `projects.files_dir` is absent. 0040's
-- suite asserts `projects.code` stays absent because `code` is a wrong NAME
-- that must never exist. `files_dir` is the right name for a feature that has
-- no cloud implementation yet (relink is local_server only) — it should
-- arrive WITH that feature, so pinning its absence would only have to be
-- deleted by the session that legitimately adds it. See 0041's header.
-- =========================================================================
BEGIN;

SELECT plan(22);

SELECT * FROM tests.rls_setup();

-- ── Extra fixtures ───────────────────────────────────────────────────────
-- rls_setup gives two workspace ADMINS. What matters here is the ORDINARY
-- roles, because folders are ordinary project content.
--
--   user_c  app_role 'user', project_a reviewer -> read yes, write no
--   user_d  app_role 'user', project_a member   -> read yes, write YES

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now()),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user_d@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111',
   'dddddddd-dddd-dddd-dddd-dddddddddddd', 'user', 'user_d', 'User D', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.project_members
  (project_id, user_id, workspace_id, project_role)
VALUES
  ('aaaa1111-0000-0000-0000-000000000001',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1111-0000-0000-0000-000000000001',
   'dddddddd-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;

-- Two scenes, seeded as postgres so the folder probes below do not depend on
-- the scenes policies passing first.
INSERT INTO public.scenes (id, project_id, workspace_id, name, scene_number)
VALUES
  ('55550000-0000-0000-0000-0000000000f1',
   'aaaa1111-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'WLSN_SC001', 1),
  ('55550000-0000-0000-0000-0000000000f2',
   'aaaa1111-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'WLSN_SC002', 2)
ON CONFLICT (id) DO NOTHING;


-- ── 1-4: the standing structural block ───────────────────────────────────

SELECT has_table('public'::name, 'folders'::name, 'folders table exists');

SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.folders'::regclass),
  'folders has RLS enabled and forced');

-- A broad FOR ALL arm ORs with every narrow arm beside it and silently wins.
-- 0029 exists specifically to undo one; this stops another appearing.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'folders' AND cmd = 'ALL'),
  0, 'folders has no FOR ALL policy');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'folders'),
  4, 'folders has exactly four policies (select/insert/update/delete)');


-- ── 5-6: workspace stamping ──────────────────────────────────────────────
-- No client sends workspace_id; the adapter builds folder rows from the
-- project and the entity only.

SELECT has_trigger('public', 'folders',
  'trg_folders_populate_workspace',
  'folders stamps workspace_id on insert');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- The project root. parent_id NULL and path '' are what makes it the root,
-- and the two root CHECK constraints tie those together so a "root" with a
-- path or a child with no parent cannot exist.
INSERT INTO public.folders (id, project_id, kind, slug, path)
VALUES ('f0000000-0000-0000-0000-000000000001'::uuid,
        'aaaa1111-0000-0000-0000-000000000001', 'root', 'Project-A', '');

SELECT is(
  (SELECT workspace_id FROM public.folders
    WHERE id = 'f0000000-0000-0000-0000-000000000001'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'workspace_id is stamped from the project, with no client involvement');

-- The SCENES category, and one scene's own folder under it. Audrey: five
-- scenes means five folders, so the entity row carries scene_id and the
-- category row does not.
INSERT INTO public.folders (id, project_id, parent_id, kind, entity_type, slug, path)
VALUES ('f0000000-0000-0000-0000-000000000002'::uuid,
        'aaaa1111-0000-0000-0000-000000000001',
        'f0000000-0000-0000-0000-000000000001', 'category', 'scene',
        'SCENES', 'SCENES');

INSERT INTO public.folders (id, project_id, parent_id, kind, entity_type,
                            scene_id, slug, path)
VALUES ('f0000000-0000-0000-0000-000000000003'::uuid,
        'aaaa1111-0000-0000-0000-000000000001',
        'f0000000-0000-0000-0000-000000000002', 'entity', 'scene',
        '55550000-0000-0000-0000-0000000000f1',
        'Wlsn-Sc001', 'SCENES/Wlsn-Sc001');


-- ── 7-8: a project MEMBER can read AND write ─────────────────────────────
--
-- The assertion that distinguishes folders from the money tables. They use
-- can_write_project, NOT can_access_project_money: a team member has to be
-- able to create an asset, and an asset that cannot get a folder has not
-- really been created.

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.folders
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  3, 'a project member reads the folder tree (root + category + entity)');

SELECT lives_ok(
  $$INSERT INTO public.folders (project_id, parent_id, kind, entity_type,
                                scene_id, slug, path)
    VALUES ('aaaa1111-0000-0000-0000-000000000001',
            'f0000000-0000-0000-0000-000000000002', 'entity', 'scene',
            '55550000-0000-0000-0000-0000000000f2',
            'Wlsn-Sc002', 'SCENES/Wlsn-Sc002')$$,
  'a project member can create a folder — folders are not money');


-- ── 9-11: a project REVIEWER reads but cannot write ──────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.folders
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  4, 'a project reviewer can READ the folder tree');

SELECT throws_ok(
  $$INSERT INTO public.folders (project_id, parent_id, kind, slug, path)
    VALUES ('aaaa1111-0000-0000-0000-000000000001',
            'f0000000-0000-0000-0000-000000000001', 'custom', 'Sneaky', 'Sneaky')$$,
  'new row violates row-level security policy for table "folders"',
  'a project reviewer cannot create a folder');

-- The silent-zero-rows hazard: an RLS-refused UPDATE raises nothing and
-- affects no rows, so a client checking only for an error concludes the write
-- landed. Prove the row is untouched rather than trusting the missing error.
UPDATE public.folders SET slug = 'Hijacked', path = 'Hijacked'
 WHERE id = 'f0000000-0000-0000-0000-000000000002';

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT path FROM public.folders
    WHERE id = 'f0000000-0000-0000-0000-000000000002'),
  'SCENES',
  'a reviewer''s UPDATE raises no error and changes nothing (the silent-zero-rows hazard)');


-- ── 12-13: an admin of ANOTHER workspace is denied, read and write ───────

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '22222222-2222-2222-2222-222222222222',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.folders),
  0, 'an admin of a different workspace cannot read this project''s folders');

SELECT throws_ok(
  $$INSERT INTO public.folders (project_id, parent_id, kind, slug, path)
    VALUES ('aaaa1111-0000-0000-0000-000000000001',
            'f0000000-0000-0000-0000-000000000001', 'custom', 'Cross', 'Cross')$$,
  'new row violates row-level security policy for table "folders"',
  'an admin of a different workspace cannot create a folder here');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;


-- ── 14-15: 🚨 THE ANTI-DOUBLE-FOLDER GUARANTEE ───────────────────────────
--
-- fileSlugify exists in two copies — entityNaming.js:110 (renderer) and
-- electron/main.cjs:66 (main process, which cannot import from the renderer
-- bundle). If they ever disagree, one scene gets two folders. A client-side
-- check would not catch the case where the two PROCESSES disagree, because
-- each one would be individually consistent. These two indexes do.

SELECT throws_ok(
  $$INSERT INTO public.folders (project_id, parent_id, kind, slug, path)
    VALUES ('aaaa1111-0000-0000-0000-000000000001',
            'f0000000-0000-0000-0000-000000000002', 'custom',
            'Wlsn-Sc001', 'SCENES/Wlsn-Sc001')$$,
  'duplicate key value violates unique constraint "folders_project_path_uniq"',
  'two folders cannot occupy the same path in one project');

SELECT throws_ok(
  $$INSERT INTO public.folders (project_id, parent_id, kind, entity_type,
                                scene_id, slug, path)
    VALUES ('aaaa1111-0000-0000-0000-000000000001',
            'f0000000-0000-0000-0000-000000000002', 'entity', 'scene',
            '55550000-0000-0000-0000-0000000000f1',
            'Wlsn-Sc001-Again', 'SCENES/Wlsn-Sc001-Again')$$,
  'duplicate key value violates unique constraint "folders_scene_uniq"',
  'one scene cannot have two folders, even under two different names');


-- ── 16-17: 🚨 AUDREY'S REQUIREMENT, BOTH HALVES ──────────────────────────
--
-- 16. Deleting a scene takes its folder row with it. The FK cascade does it
--     atomically instead of a client-side loop that can half-fail — the same
--     reasoning 0040 recorded for shots.scene_id.
--
-- 17. Turning the category OFF deletes NOTHING. Audrey, 2026-08-03: toggling
--     a category off "should only remove it from the R.A.B.B.I.T. view and
--     never delete the folders". This is the requirement the entire design
--     exists to satisfy, so it is asserted rather than assumed — and note it
--     is only assertable BECAUSE the folder is a row: on plain object storage
--     an emptied folder simply stops existing.

DELETE FROM public.scenes WHERE id = '55550000-0000-0000-0000-0000000000f2';

SELECT is(
  (SELECT count(*)::int FROM public.folders
    WHERE scene_id = '55550000-0000-0000-0000-0000000000f2'),
  0, 'deleting a scene cascades its folder row away');

UPDATE public.projects SET scenes_enabled = false
 WHERE id = 'aaaa1111-0000-0000-0000-000000000001';

SELECT is(
  (SELECT count(*)::int FROM public.folders
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  3,
  'turning scenes_enabled OFF deletes NO folders — the requirement the table exists for');


-- ── 18-19: containment and shape ─────────────────────────────────────────
--
-- `path` is concatenated onto projects.folder_root on disk and onto
-- projects/<id>/ in the rabbit-files bucket. S17 (#45 family) had to
-- retro-fit resolveContainedFilePath after a client-writable slug turned a
-- renameSync into an arbitrary-directory move; this refuses the input.

SELECT throws_ok(
  $$INSERT INTO public.folders (project_id, parent_id, kind, slug, path)
    VALUES ('aaaa1111-0000-0000-0000-000000000001',
            'f0000000-0000-0000-0000-000000000001', 'custom',
            'Escape', '../../etc')$$,
  'new row for relation "folders" violates check constraint "folders_path_shape_chk"',
  'a traversal segment in `path` is refused at the database');

-- One root per project falls out of two constraints that each earn their
-- place separately: folders_root_path_chk makes path='' true for roots and
-- ONLY for roots, and folders_project_path_uniq allows one row per path. A
-- dedicated `(project_id) WHERE kind='root'` index was written and MEASURED
-- to be dead — the path index always catches the second root first. What
-- matters is that the second root is refused, so that is what this asserts.
SELECT throws_ok(
  $$INSERT INTO public.folders (project_id, kind, slug, path)
    VALUES ('aaaa1111-0000-0000-0000-000000000001',
            'root', 'Second-Root', '')$$,
  'duplicate key value violates unique constraint "folders_project_path_uniq"',
  'a project cannot have two root folders');


-- ── 20-21: the `projects` columns this session consumes ──────────────────
--
-- `folder_root` has a reachable writer today (ProjectSummaryView.jsx:401 and
-- :987) which the desktop app reaches in EITHER backend, and which cloud has
-- been dropping with a console warning. `folder_slug` is written by this
-- session's own ensureProjectFolders and is what lets a project be renamed
-- without moving its folder.

SELECT has_column('public'::name, 'projects'::name, 'folder_slug'::name,
  'projects.folder_slug exists — the folder tree''s anchor');

SELECT has_column('public'::name, 'projects'::name, 'folder_root'::name,
  'projects.folder_root exists — written from Electron in either backend');


-- ── 22: the migration-0011 privilege trap, for folders ───────────────────
-- 0011's blanket GRANT plus its ALTER DEFAULT PRIVILEGES left anon holding
-- every privilege on 25 tables until 0033. Assert the revoke rather than
-- assume it — a policy-only check passes while a privilege hole is wide open.
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.folders', 'SELECT') OR
    has_table_privilege('anon', 'public.folders', 'INSERT') OR
    has_table_privilege('anon', 'public.folders', 'UPDATE') OR
    has_table_privilege('anon', 'public.folders', 'DELETE')
  ),
  'anon holds no table privilege on folders'
);

SELECT * FROM finish();
ROLLBACK;
