-- =============================================================================
-- 111_private_project_money_and_history.sql — migration 0108, the privacy
-- repairs' part B (M.O.T.H. Session 1; docs/design/MOTH_DESIGN.md §2.6 R7, R8).
--
-- What this pins:
--   * Money: a SECOND manager seated as manager on a private project (user_e)
--     no longer opens its money: the gate, budget lines, expenses, budget
--     versions, the INVOICES and LEGAL storage paths in both buckets, and the
--     Legal gate are all closed on the private project and open on the public
--     one (the CONTROL); the creator (seated) and an admin keep them.
--   * History: one capture probe per captured table (14): the create row
--     names the project, and captured_private says whether it was private;
--     rate cards name none. A row moved between projects, a dependency that
--     joins two projects and a cascaded child are stamped with no project
--     (admins only); the second manager reads none of the private project's
--     rows or of the move; rows captured while a project was private stay the
--     creator's and the admins' after it is made public; a trashed project's
--     history is the admins'; rate cards stay every manager's.
--   * The walk: rows before and after a recorded move resolve to the old and
--     the new project; a dependency only when both endpoints sat in one.
--   * The resolver and the walk are closed to client roles.
--
-- Fixture ids are hex (prefix 1110…). Postgres-side reads are scoped to the
-- fixture rows. Every fixture write is the runner's (unbound), so the
-- same-project guard (0107) lets the planted cross-project rows through.
-- =============================================================================

BEGIN;

SELECT plan(53);

SELECT * FROM tests.rls_setup();

-- user_c: plain 'user'; user_d: 'manager', the private projects' creator;
-- user_e: a SECOND 'manager', seated manager on P and on Q. user_a (from
-- rls_setup) is the workspace admin.
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user_d@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user_e@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','user','user_c','User C',true),
  ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','manager','user_d','User D',true),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','manager','user_e','User E',true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- P private (user_d's), Q public, R private now and made public below, T
-- public and trashed below.
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private) VALUES
  ('aaaa1111-0000-0000-0000-000000000111', '11111111-1111-1111-1111-111111111111', 'Private P', 'dddddddd-dddd-dddd-dddd-dddddddddddd', true),
  ('aaaa1111-0000-0000-0000-000000000112', '11111111-1111-1111-1111-111111111111', 'Public Q',  'dddddddd-dddd-dddd-dddd-dddddddddddd', false),
  ('aaaa1111-0000-0000-0000-000000000113', '11111111-1111-1111-1111-111111111111', 'Flipped R', 'dddddddd-dddd-dddd-dddd-dddddddddddd', true),
  ('aaaa1111-0000-0000-0000-000000000114', '11111111-1111-1111-1111-111111111111', 'Trashed T', 'dddddddd-dddd-dddd-dddd-dddddddddddd', false);

INSERT INTO public.project_members (workspace_id, project_id, user_id, project_role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'manager'),
  ('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000112', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'manager'),
  ('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager')
ON CONFLICT DO NOTHING;

-- Money on P and on Q.
INSERT INTO public.budget_lines (id, workspace_id, project_id) VALUES
  ('11100000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000111'),
  ('11100000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000112');
INSERT INTO public.expenses (id, workspace_id, project_id) VALUES
  ('11100000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000111'),
  ('11100000-0000-0000-0000-0000000000b2', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000112');
INSERT INTO public.budget_versions (id, workspace_id, project_id, name) VALUES
  ('11100000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000111', 'P v1'),
  ('11100000-0000-0000-0000-0000000000b3', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000112', 'Q v1');
INSERT INTO storage.objects (bucket_id, name)
SELECT b, 'projects/' || p || '/' || seg || '/x/1.pdf'
  FROM unnest(ARRAY['rabbit-files', 'rabbit-thumbnails']) b,
       unnest(ARRAY['aaaa1111-0000-0000-0000-000000000111', 'aaaa1111-0000-0000-0000-000000000112']) p,
       unnest(ARRAY['INVOICES', 'LEGAL']) seg;

-- One row of every captured table in P (and its twin in Q where a probe
-- needs a control).
INSERT INTO public.phases (id, project_id, name) VALUES
  ('11100000-0000-0000-0000-0000000000a4', 'aaaa1111-0000-0000-0000-000000000111', 'P phase'),
  ('11100000-0000-0000-0000-0000000000a5', 'aaaa1111-0000-0000-0000-000000000111', 'P phase 2');
INSERT INTO public.assets (id, workspace_id, project_id, name) VALUES
  ('11100000-0000-0000-0000-0000000000a6', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000111', 'P asset'),
  ('11100000-0000-0000-0000-0000000000a7', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000111', 'P asset to move');
INSERT INTO public.tasks (id, workspace_id, project_id, title) VALUES
  ('11100000-0000-0000-0000-0000000000a8', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000111', 'P task'),
  ('11100000-0000-0000-0000-0000000000a9', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000111', 'P task 2'),
  ('11100000-0000-0000-0000-0000000000b8', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000112', 'Q task'),
  ('11100000-0000-0000-0000-0000000000b9', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000112', 'Q task with a link');
INSERT INTO public.task_dependencies (id, predecessor_id, successor_id) VALUES
  ('11100000-0000-0000-0000-0000000000aa', '11100000-0000-0000-0000-0000000000a8', '11100000-0000-0000-0000-0000000000a9'),
  ('11100000-0000-0000-0000-0000000000ba', '11100000-0000-0000-0000-0000000000b8', '11100000-0000-0000-0000-0000000000a8');
INSERT INTO public.task_links (id, task_id, url) VALUES
  ('11100000-0000-0000-0000-0000000000ab', '11100000-0000-0000-0000-0000000000a8', 'https://example.test/p'),
  ('11100000-0000-0000-0000-0000000000bb', '11100000-0000-0000-0000-0000000000b9', 'https://example.test/q');
INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path) VALUES
  ('11100000-0000-0000-0000-0000000000ac', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000111', 'p.txt', 'supabase',
   'projects/aaaa1111-0000-0000-0000-000000000111/project/x/1-p.txt'),
  ('11100000-0000-0000-0000-0000000000ad', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000111', 'moving.txt', 'supabase',
   'projects/aaaa1111-0000-0000-0000-000000000111/project/x/1-moving.txt');
INSERT INTO public.asset_versions (id, asset_id, version_no) VALUES
  ('11100000-0000-0000-0000-0000000000ae', '11100000-0000-0000-0000-0000000000a6', 1);
INSERT INTO public.comments (id, workspace_id, entity_type, entity_id, body) VALUES
  ('11100000-0000-0000-0000-0000000000af', '11111111-1111-1111-1111-111111111111', 'task', '11100000-0000-0000-0000-0000000000a8', 'P note');
INSERT INTO public.rate_cards (id, workspace_id, name) VALUES
  ('11100000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'Card');
INSERT INTO public.rate_card_entries (id, rate_card_id, role_label, role_slug) VALUES
  ('11100000-0000-0000-0000-0000000000c2', '11100000-0000-0000-0000-0000000000c1', 'Editor', 'editor');
INSERT INTO public.ingestion_runs (id, project_id) VALUES
  ('11100000-0000-0000-0000-0000000000c3', 'aaaa1111-0000-0000-0000-000000000111');
INSERT INTO public.ingestion_chunks (id, run_id, chunk_index) VALUES
  ('11100000-0000-0000-0000-0000000000c4', '11100000-0000-0000-0000-0000000000c3', 0);
INSERT INTO public.phase_dependencies (id, predecessor_id, successor_id) VALUES
  ('11100000-0000-0000-0000-0000000000c5', '11100000-0000-0000-0000-0000000000a4', '11100000-0000-0000-0000-0000000000a5');

-- The changes: an asset and a file moved P -> Q; a link's task deleted (the
-- link cascades); R made public, with a task captured on each side of it; T
-- trashed after a task was added to it.
UPDATE public.assets SET project_id = 'aaaa1111-0000-0000-0000-000000000112' WHERE id = '11100000-0000-0000-0000-0000000000a7';
UPDATE public.assets SET name = 'Moved asset, renamed in Q' WHERE id = '11100000-0000-0000-0000-0000000000a7';
UPDATE public.files SET project_id = 'aaaa1111-0000-0000-0000-000000000112',
                        storage_path = 'projects/aaaa1111-0000-0000-0000-000000000112/project/x/1-moving.txt'
 WHERE id = '11100000-0000-0000-0000-0000000000ad';
-- The delete carries the workspace claim a client's always has (the runner
-- has none, and 0061's step (d) would then skip the cascaded child's row).
SELECT set_config('request.jwt.claims', json_build_object(
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111'))::text, true);
DELETE FROM public.tasks WHERE id = '11100000-0000-0000-0000-0000000000b9';
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO public.tasks (id, workspace_id, project_id, title) VALUES
  ('11100000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000113', 'Written while R was private');
UPDATE public.projects SET is_private = false WHERE id = 'aaaa1111-0000-0000-0000-000000000113';
INSERT INTO public.tasks (id, workspace_id, project_id, title) VALUES
  ('11100000-0000-0000-0000-0000000000d2', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000113', 'Written after R was made public'),
  ('11100000-0000-0000-0000-0000000000d3', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000114', 'T task');
UPDATE public.projects SET deleted_at = now() WHERE id = 'aaaa1111-0000-0000-0000-000000000114';

-- The capture's answer for one entity's row of one action: 'project|private'.
CREATE TEMP TABLE h111 AS
  SELECT entity_type, entity_id, action, id,
         COALESCE(project_id::text, '-') || '|' || captured_private::text AS stamp
    FROM public.edit_history
   WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
GRANT SELECT ON h111 TO authenticated;


-- ── 1-3: structure ────────────────────────────────────────────────────────────

SELECT ok(
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'edit_history' AND column_name = 'captured_private'
             AND data_type = 'boolean' AND is_nullable = 'NO' AND column_default = 'true'),
  'edit_history.captured_private is boolean NOT NULL DEFAULT true (a writer that leaves it out fails closed)');

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.edit_history_project_of(text, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.edit_history_project_of(text, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.edit_history_value_at(text, uuid, text, timestamptz, bigint)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.edit_history_value_at(text, uuid, text, timestamptz, bigint)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.edit_history_project_at(text, uuid, jsonb, timestamptz, bigint, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.edit_history_project_at(text, uuid, jsonb, timestamptz, bigint, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.edit_history_restamp()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.edit_history_restamp()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.fn_edit_history_project_gone()', 'EXECUTE')
  AND (SELECT bool_and(prosecdef AND provolatile = 's' AND proconfig @> ARRAY['search_path=public'])
         FROM pg_proc WHERE pronamespace = 'public'::regnamespace
          AND proname IN ('edit_history_project_of', 'edit_history_value_at', 'edit_history_project_at'))
  AND (SELECT bool_and(prosecdef AND proconfig @> ARRAY['search_path=public'])
         FROM pg_proc WHERE pronamespace = 'public'::regnamespace
          AND proname IN ('edit_history_restamp', 'fn_edit_history_project_gone')),
  'the resolver, both walks, the restamp and the purge step are SECURITY DEFINER, search_path pinned, closed to client roles (the readers STABLE)');

SELECT ok(
  (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'edit_history' AND policyname = 'edit_history_select')
    ~ 'can_read_project_topic\(project_id\)'
  AND (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'edit_history' AND policyname = 'edit_history_select')
    ~ 'NOT captured_private'
  AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'edit_history') = 1,
  'edit_history keeps one policy, and it carries the topic-reader arm and the captured_private arm (scan S2''s gate for this table)');


-- ── 4-17: one capture probe per captured table ────────────────────────────────

SELECT is((SELECT stamp FROM h111 WHERE entity_type = 'projects' AND entity_id = 'aaaa1111-0000-0000-0000-000000000111' AND action = 'create'),
  'aaaa1111-0000-0000-0000-000000000111|true', 'projects: a private project''s create row is its own, captured private');
SELECT is((SELECT stamp FROM h111 WHERE entity_type = 'phases' AND entity_id = '11100000-0000-0000-0000-0000000000a4' AND action = 'create'),
  'aaaa1111-0000-0000-0000-000000000111|true', 'phases: the project, captured private');
SELECT is((SELECT stamp FROM h111 WHERE entity_type = 'assets' AND entity_id = '11100000-0000-0000-0000-0000000000a6' AND action = 'create'),
  'aaaa1111-0000-0000-0000-000000000111|true', 'assets: the project, captured private');
SELECT is((SELECT stamp FROM h111 WHERE entity_type = 'tasks' AND entity_id = '11100000-0000-0000-0000-0000000000b8' AND action = 'create'),
  'aaaa1111-0000-0000-0000-000000000112|false', 'tasks: a public project''s task is its project''s, not private');
SELECT is((SELECT stamp FROM h111 WHERE entity_type = 'task_dependencies' AND entity_id = '11100000-0000-0000-0000-0000000000aa' AND action = 'create'),
  'aaaa1111-0000-0000-0000-000000000111|true', 'task_dependencies: both endpoints in P, so P');
SELECT is((SELECT stamp FROM h111 WHERE entity_type = 'task_links' AND entity_id = '11100000-0000-0000-0000-0000000000ab' AND action = 'create'),
  'aaaa1111-0000-0000-0000-000000000111|true', 'task_links: through the task');
SELECT is((SELECT stamp FROM h111 WHERE entity_type = 'files' AND entity_id = '11100000-0000-0000-0000-0000000000ac' AND action = 'create'),
  'aaaa1111-0000-0000-0000-000000000111|true', 'files: the project (the snapshot agrees), captured private');
SELECT is((SELECT stamp FROM h111 WHERE entity_type = 'asset_versions' AND entity_id = '11100000-0000-0000-0000-0000000000ae' AND action = 'create'),
  'aaaa1111-0000-0000-0000-000000000111|true', 'asset_versions: through the asset');
SELECT is((SELECT stamp FROM h111 WHERE entity_type = 'comments' AND entity_id = '11100000-0000-0000-0000-0000000000af' AND action = 'create'),
  'aaaa1111-0000-0000-0000-000000000111|true', 'comments: through fn_comment_project_id');
SELECT is((SELECT stamp FROM h111 WHERE entity_type = 'rate_cards' AND entity_id = '11100000-0000-0000-0000-0000000000c1' AND action = 'create'),
  '-|false', 'rate_cards: workspace-level, no project');
SELECT is((SELECT stamp FROM h111 WHERE entity_type = 'rate_card_entries' AND entity_id = '11100000-0000-0000-0000-0000000000c2' AND action = 'create'),
  '-|false', 'rate_card_entries: workspace-level, no project');
SELECT is((SELECT stamp FROM h111 WHERE entity_type = 'ingestion_runs' AND entity_id = '11100000-0000-0000-0000-0000000000c3' AND action = 'create'),
  'aaaa1111-0000-0000-0000-000000000111|true', 'ingestion_runs: the project');
SELECT is((SELECT stamp FROM h111 WHERE entity_type = 'ingestion_chunks' AND entity_id = '11100000-0000-0000-0000-0000000000c4' AND action = 'create'),
  'aaaa1111-0000-0000-0000-000000000111|true', 'ingestion_chunks: through the run');
SELECT is((SELECT stamp FROM h111 WHERE entity_type = 'phase_dependencies' AND entity_id = '11100000-0000-0000-0000-0000000000c5' AND action = 'create'),
  'aaaa1111-0000-0000-0000-000000000111|true', 'phase_dependencies: both endpoints in P, so P');


-- ── 18-22: rows that belong to no one side ─────────────────────────────────────

SELECT is((SELECT stamp FROM h111 WHERE entity_type = 'task_dependencies' AND entity_id = '11100000-0000-0000-0000-0000000000ba' AND action = 'create'),
  '-|true', 'a dependency that joins Q to P names no project (admins only)');
SELECT is((SELECT stamp FROM h111 WHERE entity_type = 'assets' AND entity_id = '11100000-0000-0000-0000-0000000000a7' AND action = 'update'
            AND id = (SELECT min(id) FROM h111 WHERE entity_type = 'assets' AND entity_id = '11100000-0000-0000-0000-0000000000a7' AND action = 'update')),
  '-|true', '🚨 the asset''s move from P to Q names no project (the capture resolves both sides)');
SELECT is((SELECT stamp FROM h111 WHERE entity_type = 'assets' AND entity_id = '11100000-0000-0000-0000-0000000000a7' AND action = 'update'
            AND id = (SELECT max(id) FROM h111 WHERE entity_type = 'assets' AND entity_id = '11100000-0000-0000-0000-0000000000a7' AND action = 'update')),
  'aaaa1111-0000-0000-0000-000000000112|false', 'CONTROL: its rename in Q afterwards is Q''s');
SELECT is((SELECT stamp FROM h111 WHERE entity_type = 'files' AND entity_id = '11100000-0000-0000-0000-0000000000ad' AND action = 'update'),
  '-|true', '🚨 the file''s move from P to Q names no project (the snapshot''s move line; the classifier alone would say Q)');
SELECT is((SELECT stamp FROM h111 WHERE entity_type = 'task_links' AND entity_id = '11100000-0000-0000-0000-0000000000bb' AND action = 'delete'),
  '-|true', 'a link deleted with its task (a cascade: the parent is gone) names no project (admins only)');


-- ── 23-25: the walk ─────────────────────────────────────────────────────────────

SELECT is(
  public.edit_history_project_at('assets', '11100000-0000-0000-0000-0000000000a7', NULL, now(),
    (SELECT id FROM h111 WHERE entity_type = 'assets' AND entity_id = '11100000-0000-0000-0000-0000000000a7' AND action = 'create')),
  'aaaa1111-0000-0000-0000-000000000111'::uuid,
  'the walk: just after the moved asset''s create row, its project was P (the move''s old side)');
SELECT is(
  public.edit_history_project_at('assets', '11100000-0000-0000-0000-0000000000a7', NULL, now(),
    (SELECT max(id) FROM h111 WHERE entity_type = 'assets' AND entity_id = '11100000-0000-0000-0000-0000000000a7')),
  'aaaa1111-0000-0000-0000-000000000112'::uuid,
  'the walk: after the move, Q (the live row)');

-- Crafted rows for an entity that no longer exists: created in P, renamed,
-- moved to Q, renamed, deleted.
INSERT INTO public.edit_history (workspace_id, entity_type, entity_id, action, diff, created_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'tasks', '11100000-0000-0000-0000-0000000000e1', 'create',
   '{"new": {"id": "11100000-0000-0000-0000-0000000000e1", "project_id": "aaaa1111-0000-0000-0000-000000000111", "title": "t"}}', now() - interval '5 days'),
  ('11111111-1111-1111-1111-111111111111', 'tasks', '11100000-0000-0000-0000-0000000000e1', 'update',
   '{"title": {"old": "t", "new": "t2"}}', now() - interval '4 days'),
  ('11111111-1111-1111-1111-111111111111', 'tasks', '11100000-0000-0000-0000-0000000000e1', 'update',
   '{"project_id": {"old": "aaaa1111-0000-0000-0000-000000000111", "new": "aaaa1111-0000-0000-0000-000000000112"}}', now() - interval '3 days'),
  ('11111111-1111-1111-1111-111111111111', 'tasks', '11100000-0000-0000-0000-0000000000e1', 'update',
   '{"title": {"old": "t2", "new": "t3"}}', now() - interval '2 days'),
  ('11111111-1111-1111-1111-111111111111', 'tasks', '11100000-0000-0000-0000-0000000000e1', 'delete',
   '{"old": {"id": "11100000-0000-0000-0000-0000000000e1", "project_id": "aaaa1111-0000-0000-0000-000000000112", "title": "t3"}}', now() - interval '1 day');
SELECT is(
  ARRAY[public.edit_history_project_at('tasks', '11100000-0000-0000-0000-0000000000e1', NULL, now() - interval '4 days'),
        public.edit_history_project_at('tasks', '11100000-0000-0000-0000-0000000000e1', NULL, now() - interval '2 days')],
  ARRAY['aaaa1111-0000-0000-0000-000000000111', 'aaaa1111-0000-0000-0000-000000000112']::uuid[],
  'the walk over crafted rows of a deleted entity: the rename before the move was P''s, the one after it Q''s');


-- ── 26-32: the restamp (0108's backfill) over history as it was before 0108 ─────

-- It agrees with the live capture: over every row the fixtures wrote, it
-- changes nothing.
CREATE TEMP TABLE h111_live AS
  SELECT id, project_id, captured_private FROM public.edit_history
   WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND entity_id <> '11100000-0000-0000-0000-0000000000e1';
-- (Taken before the crafted rows below, so it holds only what the live capture wrote.)

-- Crafted rows, written as history stood before 0108 (no project, the
-- column's default flag) and, for files, as 0088's snapshot left them.
-- (a) a reused file id: X lived in P (create, delete); X now lives in Q, and
--     0088 stamped the P-era rows with Q from the live row.
INSERT INTO public.edit_history (workspace_id, entity_type, entity_id, action, diff) VALUES
  ('11111111-1111-1111-1111-111111111111', 'files', '11100000-0000-0000-0000-0000000000f1', 'create',
   '{"new": {"id": "11100000-0000-0000-0000-0000000000f1", "project_id": "aaaa1111-0000-0000-0000-000000000111", "name": "p-secret.txt"}}'),
  ('11111111-1111-1111-1111-111111111111', 'files', '11100000-0000-0000-0000-0000000000f1', 'delete',
   '{"old": {"id": "11100000-0000-0000-0000-0000000000f1", "project_id": "aaaa1111-0000-0000-0000-000000000111", "name": "p-secret.txt"}}');
INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path) VALUES
  ('11100000-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000112', 'q.txt', 'supabase',
   'projects/aaaa1111-0000-0000-0000-000000000112/project/x/1-q.txt');
-- 0088's backfill was an UPDATE (no trigger sees it) that took the LIVE row's
-- project: Q.
UPDATE public.edit_history SET project_id = 'aaaa1111-0000-0000-0000-000000000112'
 WHERE entity_id = '11100000-0000-0000-0000-0000000000f1' AND action IN ('create', 'delete')
   AND diff::text LIKE '%p-secret%';
-- (b) a task made in Q with a link, moved into P, its link edited there, then
--     deleted (the link cascades: the parent's delete row is written first).
INSERT INTO public.edit_history (workspace_id, entity_type, entity_id, action, diff) VALUES
  ('11111111-1111-1111-1111-111111111111', 'tasks', '11100000-0000-0000-0000-0000000000f2', 'create',
   '{"new": {"id": "11100000-0000-0000-0000-0000000000f2", "project_id": "aaaa1111-0000-0000-0000-000000000112", "title": "t"}}'),
  ('11111111-1111-1111-1111-111111111111', 'task_links', '11100000-0000-0000-0000-0000000000f3', 'create',
   '{"new": {"id": "11100000-0000-0000-0000-0000000000f3", "task_id": "11100000-0000-0000-0000-0000000000f2", "url": "https://example.test/q"}}'),
  ('11111111-1111-1111-1111-111111111111', 'tasks', '11100000-0000-0000-0000-0000000000f2', 'update',
   '{"project_id": {"old": "aaaa1111-0000-0000-0000-000000000112", "new": "aaaa1111-0000-0000-0000-000000000111"}}'),
  ('11111111-1111-1111-1111-111111111111', 'task_links', '11100000-0000-0000-0000-0000000000f3', 'update',
   '{"url": {"old": "https://example.test/q", "new": "https://example.test/p-only"}}'),
  ('11111111-1111-1111-1111-111111111111', 'tasks', '11100000-0000-0000-0000-0000000000f2', 'delete',
   '{"old": {"id": "11100000-0000-0000-0000-0000000000f2", "project_id": "aaaa1111-0000-0000-0000-000000000111", "title": "t"}}'),
  ('11111111-1111-1111-1111-111111111111', 'task_links', '11100000-0000-0000-0000-0000000000f3', 'delete',
   '{"old": {"id": "11100000-0000-0000-0000-0000000000f3", "task_id": "11100000-0000-0000-0000-0000000000f2", "url": "https://example.test/p-only"}}');
-- (d) a task made in Q, moved into P and renamed there, whose delete was
--     never recorded (a cascade with no claim, before 0108): no later row and
--     no live row, so the rename's project is read from the latest row before
--     it that carries one — the move's new side, P — never the create row's Q.
INSERT INTO public.edit_history (workspace_id, entity_type, entity_id, action, diff) VALUES
  ('11111111-1111-1111-1111-111111111111', 'tasks', '11100000-0000-0000-0000-0000000000f5', 'create',
   '{"new": {"id": "11100000-0000-0000-0000-0000000000f5", "project_id": "aaaa1111-0000-0000-0000-000000000112", "title": "t"}}'),
  ('11111111-1111-1111-1111-111111111111', 'tasks', '11100000-0000-0000-0000-0000000000f5', 'update',
   '{"project_id": {"old": "aaaa1111-0000-0000-0000-000000000112", "new": "aaaa1111-0000-0000-0000-000000000111"}}'),
  ('11111111-1111-1111-1111-111111111111', 'tasks', '11100000-0000-0000-0000-0000000000f5', 'update',
   '{"title": {"old": "t", "new": "P-only title"}}');
-- (c) a project B made public, made private, deleted for good; then its id
--     created again, as a public project, by the second manager.
INSERT INTO public.edit_history (workspace_id, entity_type, entity_id, action, diff) VALUES
  ('11111111-1111-1111-1111-111111111111', 'projects', 'aaaa1111-0000-0000-0000-000000000115', 'create',
   '{"new": {"id": "aaaa1111-0000-0000-0000-000000000115", "title": "Old B", "is_private": false}}'),
  ('11111111-1111-1111-1111-111111111111', 'projects', 'aaaa1111-0000-0000-0000-000000000115', 'update',
   '{"is_private": {"old": false, "new": true}}'),
  ('11111111-1111-1111-1111-111111111111', 'projects', 'aaaa1111-0000-0000-0000-000000000115', 'delete',
   '{"old": {"id": "aaaa1111-0000-0000-0000-000000000115", "title": "Old B, secret", "is_private": true}}');
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private) VALUES
  ('aaaa1111-0000-0000-0000-000000000115', '11111111-1111-1111-1111-111111111111', 'New B', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', false);

CREATE TEMP TABLE h111_restamp AS SELECT public.edit_history_restamp() AS res;

SELECT is(
  (SELECT count(*)::int FROM h111_live l JOIN public.edit_history eh ON eh.id = l.id
    WHERE eh.project_id IS DISTINCT FROM l.project_id OR eh.captured_private IS DISTINCT FROM l.captured_private),
  0, 'the restamp agrees with the live capture: over every row the fixtures wrote it changes nothing');
SELECT is(
  public.edit_history_restamp(),
  '{"project_set": 0, "project_gone": 0, "captured_private_set": 0}'::jsonb,
  'run again, it changes nothing at all');
SELECT is(
  (SELECT string_agg(action || ':' || COALESCE(project_id::text, '-') || '|' || captured_private::text, ' ' ORDER BY id)
     FROM public.edit_history WHERE entity_id = '11100000-0000-0000-0000-0000000000e1'),
  'create:aaaa1111-0000-0000-0000-000000000111|true update:aaaa1111-0000-0000-0000-000000000111|true update:-|true update:aaaa1111-0000-0000-0000-000000000112|false delete:aaaa1111-0000-0000-0000-000000000112|false',
  'a moved task''s old history: P''s rows private, the move no one''s, Q''s rows Q''s');
SELECT is(
  (SELECT string_agg(action || ':' || COALESCE(project_id::text, '-') || '|' || captured_private::text, ' ' ORDER BY id)
     FROM public.edit_history WHERE entity_id = '11100000-0000-0000-0000-0000000000f1'),
  'create:aaaa1111-0000-0000-0000-000000000111|true delete:aaaa1111-0000-0000-0000-000000000111|true create:aaaa1111-0000-0000-0000-000000000112|false',
  '🚨 a reused file id: the earlier file''s rows go back to P (0088 had stamped them Q from the live row); the new file''s are Q''s');
SELECT is(
  (SELECT string_agg(action || ':' || COALESCE(project_id::text, '-') || '|' || captured_private::text, ' ' ORDER BY id)
     FROM public.edit_history WHERE entity_id = '11100000-0000-0000-0000-0000000000f3'),
  'create:aaaa1111-0000-0000-0000-000000000112|false update:aaaa1111-0000-0000-0000-000000000111|true delete:-|true',
  '🚨 a link of a task moved Q -> P then deleted: made in Q, edited in P (private), and its cascaded delete no one''s — never Q''s, its parent''s first project');
SELECT is(
  (SELECT string_agg(action || ':' || COALESCE(project_id::text, '-') || '|' || captured_private::text, ' ' ORDER BY id)
     FROM public.edit_history WHERE entity_id = '11100000-0000-0000-0000-0000000000f5'),
  'create:aaaa1111-0000-0000-0000-000000000112|false update:-|true update:aaaa1111-0000-0000-0000-000000000111|true',
  '🚨 a moved task with no delete row and no live row: its rename in P is P''s (private), not its first project''s');
SELECT is(
  (SELECT string_agg(action || ':' || COALESCE(project_id::text, '-'), ' ' ORDER BY id)
     FROM public.edit_history WHERE entity_type = 'projects' AND entity_id = 'aaaa1111-0000-0000-0000-000000000115'),
  'create:- update:- delete:- create:aaaa1111-0000-0000-0000-000000000115',
  '🚨 a reused project id: the earlier project''s rows name no project (admins only); only the new one''s create row is B''s');

-- ── 33-34: a project deleted for good leaves its history to the admins ──────────

INSERT INTO public.projects (id, workspace_id, title, created_by, is_private) VALUES
  ('aaaa1111-0000-0000-0000-000000000116', '11111111-1111-1111-1111-111111111111', 'Purged P2', 'dddddddd-dddd-dddd-dddd-dddddddddddd', true);
INSERT INTO public.tasks (id, workspace_id, project_id, title) VALUES
  ('11100000-0000-0000-0000-0000000000f4', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000116', 'P2 secret task');
INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path) VALUES
  ('11100000-0000-0000-0000-0000000000f6', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000116', 'p2-secret.txt', 'supabase',
   'projects/aaaa1111-0000-0000-0000-000000000116/project/x/1-p2-secret.txt');
SELECT set_config('request.jwt.claims', json_build_object(
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111'))::text, true);
DELETE FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000116';
SELECT set_config('request.jwt.claims', '{}', true);

SELECT ok(
  (SELECT count(*) FROM public.edit_history WHERE project_id = 'aaaa1111-0000-0000-0000-000000000116') = 0
  AND (SELECT count(*) FROM public.edit_history
        WHERE entity_id IN ('aaaa1111-0000-0000-0000-000000000116', '11100000-0000-0000-0000-0000000000f4',
                            '11100000-0000-0000-0000-0000000000f6')) >= 6,
  '🚨 a project deleted for good: every row of its history (its own, its task''s and file''s, the cascades'') is kept and names no project');

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

INSERT INTO public.projects (id, workspace_id, title, is_private) VALUES
  ('aaaa1111-0000-0000-0000-000000000116', '11111111-1111-1111-1111-111111111111', 'Squatted P2', true);
SELECT is(
  (SELECT string_agg(entity_id::text || ':' || action, ',') FROM public.edit_history
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000000116'
       OR entity_id IN ('aaaa1111-0000-0000-0000-000000000116', '11100000-0000-0000-0000-0000000000f4',
                        '11100000-0000-0000-0000-0000000000f6')),
  'aaaa1111-0000-0000-0000-000000000116:create',
  '🚨 whoever creates the id again reads only their own create row — none of the old private project''s history, though they are its creator now');

-- ── 35-43: the second manager (user_e, seated manager on P and Q) ──────────────


SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT ok(
  public.can_access_project_money('aaaa1111-0000-0000-0000-000000000111') IS FALSE
  AND public.can_access_project_money('aaaa1111-0000-0000-0000-000000000112') IS TRUE,
  '🚨 a manager seat on a private project the person cannot see opens no money; on the public project it does (CONTROL)');
SELECT ok(
  public.can_access_project_legal('aaaa1111-0000-0000-0000-000000000111') IS FALSE
  AND public.can_access_project_legal('aaaa1111-0000-0000-0000-000000000112') IS TRUE,
  'the Legal gate follows: closed on P, open on Q');
SELECT is(
  ARRAY[(SELECT count(*)::int FROM public.budget_lines WHERE id IN ('11100000-0000-0000-0000-0000000000a1', '11100000-0000-0000-0000-0000000000b1')),
        (SELECT count(*)::int FROM public.expenses WHERE id IN ('11100000-0000-0000-0000-0000000000a2', '11100000-0000-0000-0000-0000000000b2')),
        (SELECT count(*)::int FROM public.budget_versions WHERE id IN ('11100000-0000-0000-0000-0000000000a3', '11100000-0000-0000-0000-0000000000b3'))],
  ARRAY[1, 1, 1],
  'P''s budget line, expense and budget version are hidden; Q''s one each are read');
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE name LIKE 'projects/aaaa1111-0000-0000-0000-000000000111/%' AND bucket_id IN ('rabbit-files', 'rabbit-thumbnails')),
  0, '🚨 P''s INVOICES and LEGAL objects in both buckets: none');
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE name LIKE 'projects/aaaa1111-0000-0000-0000-000000000112/%' AND bucket_id IN ('rabbit-files', 'rabbit-thumbnails')),
  4, 'CONTROL: Q''s four (INVOICES and LEGAL, both buckets) are read');

SELECT is(
  (SELECT count(*)::int FROM public.edit_history
    WHERE project_id IN ('aaaa1111-0000-0000-0000-000000000111', 'aaaa1111-0000-0000-0000-000000000113', 'aaaa1111-0000-0000-0000-000000000114')
       OR (project_id IS NULL AND entity_type NOT IN ('rate_cards', 'rate_card_entries'))
       OR diff::text LIKE '%aaaa1111-0000-0000-0000-000000000111%'),
  1,
  '🚨 no row of P, of T (trashed), of a move or naming P''s id — the one row is R''s, captured after it was made public');
SELECT is(
  (SELECT string_agg(entity_id::text, ',') FROM public.edit_history WHERE project_id = 'aaaa1111-0000-0000-0000-000000000113'),
  '11100000-0000-0000-0000-0000000000d2',
  'R: the task written after it was made public is read; the one written while it was private, and R''s own private-era rows, are not');
SELECT ok(
  (SELECT count(*) FROM public.edit_history WHERE project_id = 'aaaa1111-0000-0000-0000-000000000112') >= 3
  AND EXISTS (SELECT 1 FROM public.edit_history WHERE entity_id = '11100000-0000-0000-0000-0000000000a7' AND project_id = 'aaaa1111-0000-0000-0000-000000000112'),
  'CONTROL: Q''s history is read, including the moved asset''s rename in Q');
SELECT is(
  (SELECT count(*)::int FROM public.edit_history WHERE entity_type IN ('rate_cards', 'rate_card_entries')
      AND entity_id IN ('11100000-0000-0000-0000-0000000000c1', '11100000-0000-0000-0000-0000000000c2')),
  2, 'rate cards stay every manager''s');


-- ── 44-48: the creator (user_d, seated manager on P) ───────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT ok(
  public.can_access_project_money('aaaa1111-0000-0000-0000-000000000111') IS TRUE
  AND (SELECT count(*) FROM public.budget_lines WHERE id = '11100000-0000-0000-0000-0000000000a1') = 1,
  'the creator, seated manager, keeps P''s money');
SELECT ok(
  (SELECT count(*) FROM public.edit_history WHERE project_id = 'aaaa1111-0000-0000-0000-000000000111') >= 10,
  'the creator reads P''s history, captured private');
SELECT is(
  (SELECT count(*)::int FROM public.edit_history WHERE project_id = 'aaaa1111-0000-0000-0000-000000000113' AND entity_type = 'tasks'),
  2, 'the creator reads both of R''s tasks: the private-era row is hers');
SELECT is(
  (SELECT count(*)::int FROM public.edit_history WHERE project_id IS NULL AND entity_type <> 'rate_cards' AND entity_type <> 'rate_card_entries'),
  0, 'a row with no project (the moves, the split dependency, the cascaded link) is not even the creator''s');
SELECT is(
  (SELECT count(*)::int FROM public.edit_history WHERE project_id = 'aaaa1111-0000-0000-0000-000000000114'),
  0, 'a trashed project''s history is not the creator''s either (can_read_project_topic is false on a trashed project)');


-- ── 49-52: the workspace admin (user_a) ─────────────────────────────────────────

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

SELECT ok(
  public.can_access_project_money('aaaa1111-0000-0000-0000-000000000111') IS TRUE
  AND (SELECT count(*) FROM public.expenses WHERE id = '11100000-0000-0000-0000-0000000000a2') = 1,
  'an admin keeps P''s money');
SELECT is(
  (SELECT count(*)::int FROM public.edit_history
    WHERE entity_id IN ('11100000-0000-0000-0000-0000000000a7', '11100000-0000-0000-0000-0000000000ad',
                        '11100000-0000-0000-0000-0000000000ba', '11100000-0000-0000-0000-0000000000bb')
      AND project_id IS NULL),
  4, 'an admin reads the rows with no project: both moves, the split dependency, the cascaded link');
SELECT is(
  (SELECT count(*)::int FROM public.edit_history WHERE project_id = 'aaaa1111-0000-0000-0000-000000000114'),
  (SELECT count(*)::int FROM h111 WHERE stamp LIKE 'aaaa1111-0000-0000-0000-000000000114|%'),
  'an admin reads all of the trashed project''s history');
SELECT throws_ok(
  $$SELECT public.edit_history_project_of('tasks', '{}'::jsonb)$$,
  '42501', NULL, 'a client cannot call the resolver, not even an admin');


-- ── 53: a plain member reads no history at all (0012, unchanged) ──────────────

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
  (SELECT count(*)::int FROM public.edit_history WHERE workspace_id = '11111111-1111-1111-1111-111111111111'),
  0, 'a plain member reads no history (0012''s role arm, unchanged)');

SELECT * FROM finish();
ROLLBACK;
