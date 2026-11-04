-- =============================================================================
-- 110_private_project_write_hops.sql — migration 0107, the privacy repairs'
-- part A (M.O.T.H. Session 1; docs/design/MOTH_DESIGN.md §2.6 R2 to R6).
--
-- What this pins:
--   * Structure: the two guards are SECURITY DEFINER, attached, and no client
--     role executes them; the catalogue scans S1 (one SELECT policy on
--     projects), S2 (every permissive clause on a project-scoped table hops),
--     S3 (both dependency endpoints) and S5 (every same-project link guarded)
--     come back clean at the tip, so a later table that forgets its hop
--     fails here; and each scan is shown able to see a planted breakage.
--   * A second manager who has a private project's id can neither write into
--     it (insert, a move in, a filter-less update or delete, a comment) nor
--     read its roster or its pinned templates; the same writes on the PUBLIC
--     project live (the CONTROL), and a postgres read proves the private rows
--     untouched.
--   * The projects guard: a sent created_by is ignored and pinned; only the
--     creator or an admin changes is_private; only someone who manages the
--     team chooses the producer; topic_epoch bumps once on a narrowing and a
--     client cannot set it.
--   * Same-project references: a link to another project's asset, scene,
--     phase or task is refused with 23503, and the same link inside the
--     project lives.
--
-- Fixture ids are hex. Postgres-side reads are scoped to the fixture rows.
-- =============================================================================

BEGIN;

SELECT plan(51);

SELECT * FROM tests.rls_setup();

-- user_c: plain 'user' member; user_d: 'manager', the private project's
-- creator; user_e: a SECOND 'manager', not the creator. No seats on project A,
-- so it is unstaffed and can_write_project is true for all three there.
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

-- Fixtures on the PUBLIC project A (as postgres).
INSERT INTO public.assets (id, workspace_id, project_id, name) VALUES
  ('11000000-0000-0000-0000-0000000000b2', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000001', 'Public asset');
INSERT INTO public.scenes (id, workspace_id, project_id) VALUES
  ('11000000-0000-0000-0000-0000000000b3', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000001');
INSERT INTO public.tasks (id, workspace_id, project_id, title) VALUES
  ('11000000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000001', 'Public task');
INSERT INTO public.phases (id, project_id, name) VALUES
  ('11000000-0000-0000-0000-0000000000b8', 'aaaa1111-0000-0000-0000-000000000001', 'Public phase');
INSERT INTO public.task_templates (id, workspace_id, project_id) VALUES
  ('11000000-0000-0000-0000-0000000000c6', '11111111-1111-1111-1111-111111111111', NULL);
INSERT INTO public.milestones (id, workspace_id, project_id, title) VALUES
  ('11000000-0000-0000-0000-0000000000b4', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000001', 'Public key date');
INSERT INTO public.comments (id, workspace_id, entity_type, entity_id, body) VALUES
  ('11000000-0000-0000-0000-0000000000b5', '11111111-1111-1111-1111-111111111111', 'task', '11000000-0000-0000-0000-0000000000b1', 'Public note');
INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path) VALUES
  ('11000000-0000-0000-0000-0000000000b7', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000001', 'public.txt', 'supabase',
   'projects/aaaa1111-0000-0000-0000-000000000001/project/x/1-public.txt');


-- ── 1-7: structure, and the catalogue scans at the tip ───────────────────────

SELECT ok(
  EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
             AND p.proname = 'fn_projects_owner_guard' AND p.prosecdef)
  AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.projects'::regclass
                 AND t.tgname = 'trg_projects_owner_guard' AND NOT t.tgisinternal),
  'the projects owner guard is SECURITY DEFINER and attached to projects');

SELECT is(
  (SELECT count(*)::int FROM pg_trigger t
    WHERE NOT t.tgisinternal AND t.tgname = 'trg_' || t.tgrelid::regclass::text || '_same_project_refs'
      AND t.tgfoid = 'public.fn_same_project_refs_guard()'::regprocedure),
  10, 'the same-project guard is attached to its ten tables');

SELECT ok(
  NOT (has_function_privilege('anon', 'public.fn_projects_owner_guard()', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.fn_projects_owner_guard()', 'EXECUTE')
       OR has_function_privilege('anon', 'public.fn_same_project_refs_guard()', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.fn_same_project_refs_guard()', 'EXECUTE')),
  'no client role executes either guard');

-- S1
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'projects' AND cmd = 'SELECT'),
  1, 'S1: projects has exactly one SELECT policy (a second one would widen every hop)');

-- S2, as 0107's post-condition reads it, over every table at the tip.
CREATE TEMP VIEW s2_offenders AS
SELECT x.tablename, x.policyname, x.clause
  FROM (
    SELECT p.tablename, p.policyname, cl.clause, cl.txt
      FROM pg_policies p
      JOIN pg_class c ON c.relname = p.tablename AND c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
      CROSS JOIN LATERAL (VALUES ('using', p.qual), ('check', p.with_check)) AS cl(clause, txt)
     WHERE p.schemaname = 'public' AND p.permissive = 'PERMISSIVE' AND cl.txt IS NOT NULL
       AND (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'project_id' AND NOT a.attisdropped)
            OR c.relname IN ('asset_versions', 'task_links', 'task_dependencies', 'phase_dependencies', 'ingestion_chunks', 'comments'))
       AND (has_table_privilege('authenticated', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'INSERT')
            OR has_table_privilege('authenticated', c.oid, 'UPDATE') OR has_table_privilege('authenticated', c.oid, 'DELETE'))
  ) x
 WHERE x.txt !~ '(FROM|JOIN) \(?projects [a-z_]+'
   AND NOT (x.tablename = 'asset_versions' AND x.txt ~ 'FROM assets')
   AND NOT (x.tablename = 'task_links' AND x.txt ~ 'FROM tasks')
   AND NOT (x.tablename = 'ingestion_chunks' AND x.txt ~ 'ingestion_runs')
   AND NOT (x.tablename = 'task_dependencies' AND x.txt ~ 'FROM tasks')
   AND NOT (x.tablename = 'phase_dependencies' AND x.txt ~ 'phases pre')
   AND NOT (x.tablename IN ('budget_versions', 'budget_lines', 'budget_actuals', 'expenses', 'project_rate_overrides')
            AND x.txt ~ 'can_access_project_money\(project_id\)')
   AND NOT (x.tablename IN ('file_events', 'edit_history') AND x.txt ~ 'can_read_project_topic\(project_id\)')
   -- (0108 gave edit_history_select its arm, so its pinned exception is gone.)
   AND NOT (x.tablename = 'upload_reservations' AND x.policyname = 'upload_reservations_select'
            AND x.txt ~ 'created_by = auth\.uid\(\)');

SELECT is((SELECT count(*)::int FROM s2_offenders), 0,
  'S2: every permissive clause on a client-privileged project-scoped table hops to projects (or its anchor, or its own gate)');

-- S3
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('task_dependencies', 'phase_dependencies')
      AND cmd IN ('INSERT', 'UPDATE')
      AND position('predecessor_id' IN COALESCE(with_check, qual)) > 0
      AND position('successor_id' IN COALESCE(with_check, qual)) > 0),
  4, 'S3: the INSERT and UPDATE checks of both dependency tables name both endpoints');

-- S5
CREATE TEMP VIEW s5_offenders AS
SELECT s.tbl, s.col
  FROM (
    SELECT c.conrelid, c.conrelid::regclass::text AS tbl, c.confrelid::regclass::text AS target,
           (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) AS col
      FROM pg_constraint c
     WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace AND cardinality(c.conkey) = 1
       AND c.confrelid <> 'public.projects'::regclass
       AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attname = 'project_id' AND NOT a.attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.confrelid AND a.attname = 'project_id' AND NOT a.attisdropped)
  ) s,
  LATERAL (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_same_project_refs_guard()'::regprocedure) g
 WHERE NOT (position(format('"%s":"%s"', s.col, s.target) IN g.prosrc) > 0
            OR (s.tbl = 'assets' AND s.col = 'task_template_id' AND position('task_template_id' IN g.prosrc) > 0))
    OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = s.conrelid AND NOT tg.tgisinternal
                    AND tg.tgname = 'trg_' || s.tbl || '_same_project_refs');

SELECT is((SELECT count(*)::int FROM s5_offenders), 0,
  'S5: every single-column link between two project-scoped tables is guarded to one project');


-- ── 8-10: each scan sees a planted breakage (and the breakage is removed) ────

CREATE POLICY projects_planted_wide ON public.projects FOR SELECT USING (true);
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'projects' AND cmd = 'SELECT'),
  2, 'CONTROL: S1 sees a planted second SELECT policy on projects');
DROP POLICY projects_planted_wide ON public.projects;

CREATE POLICY tasks_planted_unhopped ON public.tasks FOR SELECT USING (workspace_id = public.current_workspace_id());
SELECT is(
  (SELECT count(*)::int FROM s2_offenders WHERE tablename = 'tasks' AND policyname = 'tasks_planted_unhopped'),
  1, 'CONTROL: S2 sees a planted policy that does not hop');
DROP POLICY tasks_planted_unhopped ON public.tasks;

DROP TRIGGER trg_tasks_same_project_refs ON public.tasks;
SELECT is(
  (SELECT count(*)::int FROM s5_offenders WHERE tbl = 'tasks'),
  2, 'CONTROL: S5 sees both of tasks'' links once the guard''s trigger is gone');
CREATE TRIGGER trg_tasks_same_project_refs BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.fn_same_project_refs_guard();


-- ── 11-12: the creator makes a private project; a sent created_by is ignored ─

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

SELECT lives_ok($$
  INSERT INTO public.projects (id, workspace_id, title, is_private, created_by)
  VALUES ('aaaa1111-0000-0000-0000-000000000110', '11111111-1111-1111-1111-111111111111',
          'Private P', true, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')
$$, 'a manager makes a private project, sending someone else as its creator');

SELECT is(
  (SELECT created_by::text FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000110'),
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'the guard stamps the caller as creator and ignores the sent created_by (the creator can see it)');

-- Fixtures inside the private project (as postgres).
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
INSERT INTO public.tasks (id, workspace_id, project_id, title) VALUES
  ('11000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000110', 'Private task');
INSERT INTO public.assets (id, workspace_id, project_id, name) VALUES
  ('11000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000110', 'Private asset');
INSERT INTO public.scenes (id, workspace_id, project_id) VALUES
  ('11000000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000110');
INSERT INTO public.milestones (id, workspace_id, project_id, title) VALUES
  ('11000000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000110', 'Private key date');
INSERT INTO public.comments (id, workspace_id, entity_type, entity_id, body) VALUES
  ('11000000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111', 'task', '11000000-0000-0000-0000-0000000000a1', 'Private note');
INSERT INTO public.task_templates (id, workspace_id, project_id) VALUES
  ('11000000-0000-0000-0000-0000000000a6', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000110');
INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path) VALUES
  ('11000000-0000-0000-0000-0000000000a7', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000110', 'brief.txt', 'supabase',
   'projects/aaaa1111-0000-0000-0000-000000000110/project/x/1-brief.txt');
-- The creator's seat on P is made by the project's own auto-staff trigger (0020).


-- ── 13-25: a second manager with the id — refused, with the public CONTROL ───

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

-- workspace_id is SENT (suite 82's reason): the populate trigger reads
-- projects under RLS, so on a private project it would fill nothing and the
-- row would fail the workspace arm, a refusal for the wrong reason.
SELECT throws_ok($$
  INSERT INTO public.tasks (id, workspace_id, project_id, title)
  VALUES ('11000000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111',
          'aaaa1111-0000-0000-0000-000000000110', 'Intruder')
$$, '42501', NULL, 'another manager cannot insert a task INTO a private project (tasks_insert''s hop)');

-- No oracle: the same refusal whether the link names a real hidden asset of
-- the private project or another project's asset (the guard leaves a project
-- the caller cannot see to RLS; BEFORE triggers run before RLS).
SELECT throws_ok($$
  INSERT INTO public.tasks (id, workspace_id, project_id, title, asset_id)
  VALUES ('11000000-0000-0000-0000-0000000000e3', '11111111-1111-1111-1111-111111111111',
          'aaaa1111-0000-0000-0000-000000000110', 'Intruder', '11000000-0000-0000-0000-0000000000a2')
$$, '42501', NULL, 'naming the private project''s real asset: refused by RLS');

SELECT throws_ok($$
  INSERT INTO public.tasks (id, workspace_id, project_id, title, asset_id)
  VALUES ('11000000-0000-0000-0000-0000000000e4', '11111111-1111-1111-1111-111111111111',
          'aaaa1111-0000-0000-0000-000000000110', 'Intruder', '11000000-0000-0000-0000-0000000000b2')
$$, '42501', NULL, 'naming another project''s asset: the same RLS refusal, not the guard''s 23503 (no existence oracle)');

SELECT lives_ok($$
  INSERT INTO public.tasks (id, workspace_id, project_id, title)
  VALUES ('11000000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111',
          'aaaa1111-0000-0000-0000-000000000001', 'Second manager, public')
$$, 'CONTROL: the same insert into the PUBLIC project lives');

SELECT throws_ok($$
  UPDATE public.tasks SET project_id = 'aaaa1111-0000-0000-0000-000000000110'
   WHERE id = '11000000-0000-0000-0000-0000000000e1'
$$, '42501', NULL, 'nor move a task INTO it (tasks_update''s WITH CHECK)');

SELECT is(
  (SELECT count(*)::int FROM public.tasks
    WHERE id = '11000000-0000-0000-0000-0000000000e1' AND project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  1, 'PRESENCE CONTROL: the task stays on the public project after the refused move');

-- A blanket write reads no column, so no SELECT policy judges it and only
-- USING can (a write naming a row by id is also judged by the SELECT policy,
-- which already hopped before 0107, so it could not show the new hops). Each
-- runs over every row this caller can reach in the fixture workspace: the
-- public rows change (probe 26 proves the statement ran), the private ones
-- do not (probe 25).
SELECT lives_ok($$
  UPDATE public.tasks SET title = 'Renamed by intruder'
$$, 'a blanket update of tasks runs (tasks_update''s USING hop keeps the private task out)');

SELECT lives_ok($$
  DELETE FROM public.files
$$, 'a blanket delete of files runs (files_delete''s hop keeps the private file out)');

SELECT lives_ok($$
  UPDATE public.milestones SET title = 'Renamed by intruder'
$$, 'a blanket update of key dates runs (milestones_update''s USING hop keeps the private one out)');

SELECT throws_ok($$
  INSERT INTO public.comments (id, workspace_id, entity_type, entity_id, body)
  VALUES ('11000000-0000-0000-0000-0000000000e5', '11111111-1111-1111-1111-111111111111',
          'task', '11000000-0000-0000-0000-0000000000a1', 'Intruder note')
$$, '42501', NULL, 'nor comment on a private task (comments_insert''s hop through fn_comment_project_id)');

SELECT lives_ok($$
  UPDATE public.comments SET body = 'Rewritten by intruder'
$$, 'a blanket update of comments runs (comments_update''s USING hop keeps the private one out)');

SELECT is(
  (SELECT count(*)::int FROM public.project_members WHERE project_id = 'aaaa1111-0000-0000-0000-000000000110'),
  0, 'the private project''s roster is not readable by another manager (project_members_select''s hop)');

SELECT is(
  (SELECT count(*)::int FROM public.task_templates
    WHERE id IN ('11000000-0000-0000-0000-0000000000a6', '11000000-0000-0000-0000-0000000000c6')),
  1, 'only the workspace template is readable; the one pinned to the private project is not');

SELECT lives_ok($$
  UPDATE public.projects SET title = 'Renamed by intruder'
$$, 'a blanket update of projects runs (projects_update''s privacy arm keeps the private project out)');


-- ── 25-26: postgres reads both sides back ────────────────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.tasks WHERE id = '11000000-0000-0000-0000-0000000000a1' AND title = 'Private task')
  + (SELECT count(*)::int FROM public.files WHERE id = '11000000-0000-0000-0000-0000000000a7')
  + (SELECT count(*)::int FROM public.milestones WHERE id = '11000000-0000-0000-0000-0000000000a4' AND title = 'Private key date')
  + (SELECT count(*)::int FROM public.comments WHERE id = '11000000-0000-0000-0000-0000000000a5' AND body = 'Private note')
  + (SELECT count(*)::int FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000110' AND title = 'Private P'),
  5, 'the private task, file, key date, comment and project are all as they were');

SELECT is(
  (SELECT count(*)::int FROM public.tasks
    WHERE id IN ('11000000-0000-0000-0000-0000000000b1', '11000000-0000-0000-0000-0000000000e1')
      AND title = 'Renamed by intruder')
  + (1 - (SELECT count(*)::int FROM public.files WHERE id = '11000000-0000-0000-0000-0000000000b7'))
  + (SELECT count(*)::int FROM public.milestones WHERE id = '11000000-0000-0000-0000-0000000000b4' AND title = 'Renamed by intruder')
  + (SELECT count(*)::int FROM public.comments WHERE id = '11000000-0000-0000-0000-0000000000b5' AND body = 'Rewritten by intruder')
  + (SELECT count(*)::int FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000001' AND title = 'Renamed by intruder'),
  6, 'CONTROL: the same blanket writes did change the public rows (two tasks, the file, the key date, the comment, the project)');


-- ── 27-30: a plain member on the public project: the projects guard ──────────

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok($$
  UPDATE public.projects SET producer_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
   WHERE id = 'aaaa1111-0000-0000-0000-000000000001'
$$, '42501', 'Only someone who manages this project''s team can choose its producer.',
  'a member who cannot manage the team cannot make themselves producer (the seat it would mint)');

SELECT throws_ok($$
  UPDATE public.projects SET is_private = true WHERE id = 'aaaa1111-0000-0000-0000-000000000001'
$$, '42501', 'Only the person who made this project, or an admin, can change who can see it.',
  'a member who did not make the project cannot make it private');

SELECT lives_ok($$
  UPDATE public.projects SET created_by = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
   WHERE id = 'aaaa1111-0000-0000-0000-000000000001'
$$, 'a member''s update that sends created_by runs (the guard pins the column)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT is(
  (SELECT created_by::text FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000001'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'the public project''s creator is unchanged');


-- ── 31-42: the creator: the epoch, and same-project references ──────────────

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok($$
  UPDATE public.projects SET is_private = false WHERE id = 'aaaa1111-0000-0000-0000-000000000110'
$$, 'the creator may share their project');

SELECT lives_ok($$
  UPDATE public.projects SET is_private = true WHERE id = 'aaaa1111-0000-0000-0000-000000000110'
$$, 'and make it private again');

SELECT is(
  (SELECT topic_epoch FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000110'),
  1, 'topic_epoch moved once, on the narrowing, not on the widening');

SELECT lives_ok($$
  UPDATE public.projects SET topic_epoch = 99 WHERE id = 'aaaa1111-0000-0000-0000-000000000110'
$$, 'an update that sends topic_epoch runs');

SELECT is(
  (SELECT topic_epoch FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000110'),
  1, 'a client cannot set topic_epoch (the guard pins it)');

SELECT throws_ok($$
  INSERT INTO public.tasks (id, workspace_id, project_id, title, asset_id)
  VALUES ('11000000-0000-0000-0000-0000000000d2', '11111111-1111-1111-1111-111111111111',
          'aaaa1111-0000-0000-0000-000000000110', 'Linked across', '11000000-0000-0000-0000-0000000000b2')
$$, '23503', 'That item belongs to another project or no longer exists.',
  'a task cannot name another project''s asset');

SELECT lives_ok($$
  INSERT INTO public.tasks (id, workspace_id, project_id, title, asset_id)
  VALUES ('11000000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111',
          'aaaa1111-0000-0000-0000-000000000110', 'Linked inside', '11000000-0000-0000-0000-0000000000a2')
$$, 'CONTROL: the same task naming its own project''s asset lives');

SELECT throws_ok($$
  UPDATE public.assets SET scene_ids = ARRAY['11000000-0000-0000-0000-0000000000b3']::uuid[]
   WHERE id = '11000000-0000-0000-0000-0000000000a2'
$$, '23503', 'That item belongs to another project or no longer exists.',
  'an asset cannot list another project''s scene');

SELECT lives_ok($$
  UPDATE public.assets SET scene_ids = ARRAY['11000000-0000-0000-0000-0000000000a3']::uuid[]
   WHERE id = '11000000-0000-0000-0000-0000000000a2'
$$, 'CONTROL: listing its own project''s scene lives');

SELECT throws_ok($$
  INSERT INTO public.task_dependencies (predecessor_id, successor_id)
  VALUES ('11000000-0000-0000-0000-0000000000a1', '11000000-0000-0000-0000-0000000000b1')
$$, '23503', 'That item belongs to another project or no longer exists.',
  'a dependency cannot join tasks of two projects');

SELECT lives_ok($$
  INSERT INTO public.task_dependencies (predecessor_id, successor_id)
  VALUES ('11000000-0000-0000-0000-0000000000a1', '11000000-0000-0000-0000-0000000000d1')
$$, 'CONTROL: a dependency between two tasks of one project lives');

SELECT throws_ok($$
  UPDATE public.milestones SET phase_id = '11000000-0000-0000-0000-0000000000b8'
   WHERE id = '11000000-0000-0000-0000-0000000000a4'
$$, '23503', 'That item belongs to another project or no longer exists.',
  'a key date cannot hang on another project''s phase');


-- ── 43: an admin may change any project's visibility ─────────────────────────

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

SELECT lives_ok($$
  UPDATE public.projects SET is_private = false WHERE id = 'aaaa1111-0000-0000-0000-000000000110'
$$, 'an admin may change the visibility of a project they did not make');

-- ═════════════════════════════════════════════════════════════════════════
-- MO1 (2026-11-04, migration 0110): the owner guard restated with two arms.
-- A project id this company has already had, held by no row now (its
-- history, its comments still name it: the 0108 review), cannot be created
-- again by a client; a fresh id can (CONTROL); a live row's id still answers
-- 23505. The body keeps every 0107 arm and names the personal ones (the
-- personal arms' behaviour is suite 80's).
-- ═════════════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('11010000-0000-0000-0000-0000000000c1', 'mo1_m@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES ('11111111-1111-1111-1111-111111111111', '11010000-0000-0000-0000-0000000000c1', 'manager', 'mo1_m', 'MO1 M', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- A project deleted for good (by the runner), leaving its history and a
-- comment that names it.
INSERT INTO public.projects (id, workspace_id, title)
VALUES ('11010000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Deleted for good');
INSERT INTO public.comments (id, workspace_id, entity_type, entity_id, body)
VALUES ('11010000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'project',
        '11010000-0000-0000-0000-0000000000a1', 'A note on the old project');
DELETE FROM public.projects WHERE id = '11010000-0000-0000-0000-0000000000a1';

CREATE FUNCTION pg_temp.mo1_as(p_uid UUID, p_app_role TEXT, p_ws UUID DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_uid, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_app_role))::text, true);
  PERFORM set_config('role', 'authenticated', true);
END;
$$;

SELECT pg_temp.mo1_as('11010000-0000-0000-0000-0000000000c1', 'manager');
SELECT throws_ok($$
  INSERT INTO public.projects (id, workspace_id, title)
  VALUES ('11010000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Same id, again')
$$, '42501', NULL, 'MO1: a client cannot create again a project id this company has had');
SELECT lives_ok($$
  INSERT INTO public.projects (id, workspace_id, title)
  VALUES ('11010000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'A fresh id')
$$, 'MO1: CONTROL: a fresh id is created as before');
SELECT throws_ok($$
  INSERT INTO public.projects (id, workspace_id, title)
  VALUES ('aaaa1111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'A live id')
$$, '23505', NULL, 'MO1: a live row''s id still answers the primary key (23505), as before');
SELECT throws_ok($$
  UPDATE public.projects SET id = '11010000-0000-0000-0000-0000000000a1' WHERE id = '11010000-0000-0000-0000-0000000000a3'
$$, '42501', 'A project keeps its id.', 'MO1: nor can a client change a project''s id to take a used one over (review round 1)');
SELECT lives_ok($$
  UPDATE public.projects SET title = 'A fresh id, renamed' WHERE id = '11010000-0000-0000-0000-0000000000a3'
$$, 'MO1: CONTROL: the same project''s other columns still change');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT ok(
  (SELECT strpos(b, 'NEW.created_by := OLD.created_by') > 0 AND strpos(b, 'NEW.topic_epoch := OLD.topic_epoch + 1') > 0
      AND strpos(b, 'can_manage_project_roster(OLD.id)') > 0 AND strpos(b, 'current_setting(''role'', true)') > 0
      AND strpos(b, 'NEW.personal_owner_id IS DISTINCT FROM OLD.personal_owner_id') > 0
      AND strpos(b, 'OLD.personal_owner_id IS NOT NULL') > 0
      AND strpos(b, 'NEW.deleted_at IS DISTINCT FROM OLD.deleted_at') > 0
      AND strpos(b, 'NEW.folder_slug IS DISTINCT FROM OLD.folder_slug') > 0
      AND strpos(b, 'NEW.folder_root IS DISTINCT FROM OLD.folder_root') > 0
      AND strpos(b, 'public.edit_history h') > 0 AND strpos(b, 'public.comments c') > 0
      AND strpos(b, 'public.file_events fe') > 0 AND strpos(b, 'NEW.id IS DISTINCT FROM OLD.id') > 0
     FROM (SELECT regexp_replace(regexp_replace(prosrc, '/\*.*?\*/', '', 'g'), '--[^' || chr(10) || ']*', '', 'g') AS b
             FROM pg_proc WHERE oid = 'public.fn_projects_owner_guard()'::regprocedure) s),
  'MO1: the owner guard keeps every 0107 arm and carries 0110''s personal and id-reuse arms');

SELECT * FROM finish();
ROLLBACK;
