-- =============================================================================
-- 99_task_items.sql — migration 0096 (FX2, 2026-10-11): a task relates to many
-- items (assets, scenes, shots, levels, experiences).
--
-- What this pins (each probe names the 0096 section it holds to):
--   * Structure (§2–§5, §9): RLS enabled AND forced, exactly four policies,
--     each hopping to projects AND tasks, each write policy carrying the
--     workspace, the membership and can_write_project, UPDATE's check equal
--     to its USING; anon holds nothing; a client may UPDATE `position` and no
--     other column; six same-project CASCADE keys; the five GENERATED typed
--     columns; every trigger attached; every function SECURITY INVOKER;
--     fn_realtime_broadcast names sixteen tables once each and keeps 0088's
--     money arm (0062: a restated body that drops an arm is an escalation, so
--     each arm is proved).
--   * The seed (§7c): a new task's single columns become its first items.
--   * task_items → tasks (§7a): the task's column of the item's kind is the
--     main item — after an insert, a reorder and a delete; a level's or an
--     experience's item never touches the task; a column of a kind the task
--     has no item for (a pre-0096 link to another project's asset) is left.
--   * tasks → task_items (§7b): a new id REPLACES the main item; an id the
--     task already has MOVES first and nothing is removed; a cleared column
--     removes that item and the next one becomes main; a re-sent row changes
--     nothing; another project's asset is refused (asset_id is same-project
--     now).
--   * Cascades (§2): deleting a scene the task has two of hands "main" to the
--     other (as a project MEMBER under scenes_delete); a secondary asset's
--     delete leaves the task; the MAIN asset's delete takes the task, other
--     items and all (0034's rule kept); a level's delete and a task's delete
--     take their items.
--   * The trash: a trashed task's items are hidden and cannot be written; a
--     restore brings them back.
--   * The gate (§4): a reviewer and a seatless member of a staffed project
--     read items but cannot add, move or remove one; a member can.
--   * Tenancy and PRIVACY (§4's hops): another workspace's admin sees nothing
--     and cannot write; a workspace MANAGER who did not create a private
--     project neither sees, adds nor removes its items — with workspace_id
--     SENT, so the stamping trigger cannot refuse for the wrong reason — with
--     a CONTROL on the public project and the creator's own add.
--   * reorder_task_items (§6): a stale view's ids go first and the rest
--     follow; duplicates and unknown kinds are refused; a reviewer moves
--     nothing.
--   * The sync's setting is restored after every statement.
--
-- Postgres-side reads are ALWAYS scoped to fixture ids — dev carries real
-- projects (S33, 439f702).
-- =============================================================================

BEGIN;

SELECT plan(97);

SELECT * FROM tests.rls_setup();

-- ── Extra fixtures ─────────────────────────────────────────────────────────
--   user_c  app_role 'user',    project_a REVIEWER  -> reads, no writes
--   user_d  app_role 'user',    project_a MEMBER    -> writes
--   user_e  app_role 'manager', no seat anywhere, NOT the private project's
--           creator -> writes project_a (the app role), never sees P
--   user_f  app_role 'user',    the private project's creator, seated MANAGER
--   user_g  app_role 'user',    NO seat on the staffed project_a -> refused
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
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'user_f@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('99999999-9999-9999-9999-999999999999', 'user_g@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','user','user_c','User C',true),
  ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','user','user_d','User D',true),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','manager','user_e','User E',true),
  ('11111111-1111-1111-1111-111111111111','ffffffff-ffff-ffff-ffff-ffffffffffff','user','user_f','User F',true),
  ('11111111-1111-1111-1111-111111111111','99999999-9999-9999-9999-999999999999','user','user_g','User G',true)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET app_role = EXCLUDED.app_role;

-- A neighbour project in the SAME workspace, public and unstaffed, so its
-- asset is visible to every caller: the composite key is then the only thing
-- that can refuse an item naming it.
INSERT INTO public.projects (id, workspace_id, title, created_by)
VALUES ('aaaa1111-0000-0000-0000-000000000299', '11111111-1111-1111-1111-111111111111',
        'Neighbour P99', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- The private project, created_by user_f (the privacy arm reads created_by).
INSERT INTO public.projects (id, workspace_id, title, is_private, created_by)
VALUES ('aaaa1111-0000-0000-0000-000000000099', '11111111-1111-1111-1111-111111111111',
        'Private P99', true, 'ffffffff-ffff-ffff-ffff-ffffffffffff');

INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role)
VALUES
  ('aaaa1111-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1111-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1111-0000-0000-0000-000000000099', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
   '11111111-1111-1111-1111-111111111111', 'manager')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;

-- project_a's rows. Suffixes: assets a1–a7, scenes c1–c2, shots d1–d2, the
-- level e1, the experience f1; tasks …b01–b09; items …01xx.
INSERT INTO public.assets (id, project_id, name) VALUES
  ('99990000-0000-0000-0000-0000000000a1', 'aaaa1111-0000-0000-0000-000000000001', 'A1'),
  ('99990000-0000-0000-0000-0000000000a2', 'aaaa1111-0000-0000-0000-000000000001', 'A2'),
  ('99990000-0000-0000-0000-0000000000a3', 'aaaa1111-0000-0000-0000-000000000001', 'A3'),
  ('99990000-0000-0000-0000-0000000000a4', 'aaaa1111-0000-0000-0000-000000000001', 'A4'),
  ('99990000-0000-0000-0000-0000000000a5', 'aaaa1111-0000-0000-0000-000000000001', 'A5'),
  ('99990000-0000-0000-0000-0000000000a6', 'aaaa1111-0000-0000-0000-000000000001', 'A6'),
  ('99990000-0000-0000-0000-0000000000a7', 'aaaa1111-0000-0000-0000-000000000001', 'A7'),
  ('99990000-0000-0000-0000-0000000000a9', 'aaaa1111-0000-0000-0000-000000000299', 'Neighbour asset'),
  ('99990000-0000-0000-0000-0000000000a8', 'aaaa1111-0000-0000-0000-000000000099', 'Private asset');
INSERT INTO public.scenes (id, project_id, name, scene_number) VALUES
  ('99990000-0000-0000-0000-0000000000c1', 'aaaa1111-0000-0000-0000-000000000001', 'SC1', 1),
  ('99990000-0000-0000-0000-0000000000c2', 'aaaa1111-0000-0000-0000-000000000001', 'SC2', 2);
INSERT INTO public.shots (id, project_id, scene_id, name, shot_number) VALUES
  ('99990000-0000-0000-0000-0000000000d1', 'aaaa1111-0000-0000-0000-000000000001',
   '99990000-0000-0000-0000-0000000000c1', 'SH1', 1),
  ('99990000-0000-0000-0000-0000000000d2', 'aaaa1111-0000-0000-0000-000000000001',
   '99990000-0000-0000-0000-0000000000c1', 'SH2', 2);
INSERT INTO public.levels (id, project_id, name) VALUES
  ('99990000-0000-0000-0000-0000000000e1', 'aaaa1111-0000-0000-0000-000000000001', 'L1');
INSERT INTO public.experiences (id, project_id, name) VALUES
  ('99990000-0000-0000-0000-0000000000f1', 'aaaa1111-0000-0000-0000-000000000001', 'X1');

-- Tasks, inserted as postgres: the seed trigger (§7c) makes their first items.
--   T1 asset A1 · T2 nothing · T3 scene SC1 + shot SH1 · T4 asset A4 (+ A5)
--   T5 asset A6 (+ A7) · T7 asset A3 (the trash) · T9 three assets (reorder)
--   TP the private project's task, asset "Private asset"
INSERT INTO public.tasks (id, project_id, title, asset_id, scene_id, shot_id) VALUES
  ('99990000-0000-0000-0000-000000000b01', 'aaaa1111-0000-0000-0000-000000000001', 'T1',
   '99990000-0000-0000-0000-0000000000a1', NULL, NULL),
  ('99990000-0000-0000-0000-000000000b02', 'aaaa1111-0000-0000-0000-000000000001', 'T2', NULL, NULL, NULL),
  ('99990000-0000-0000-0000-000000000b03', 'aaaa1111-0000-0000-0000-000000000001', 'T3', NULL,
   '99990000-0000-0000-0000-0000000000c1', '99990000-0000-0000-0000-0000000000d1'),
  ('99990000-0000-0000-0000-000000000b04', 'aaaa1111-0000-0000-0000-000000000001', 'T4',
   '99990000-0000-0000-0000-0000000000a4', NULL, NULL),
  ('99990000-0000-0000-0000-000000000b05', 'aaaa1111-0000-0000-0000-000000000001', 'T5',
   '99990000-0000-0000-0000-0000000000a6', NULL, NULL),
  ('99990000-0000-0000-0000-000000000b07', 'aaaa1111-0000-0000-0000-000000000001', 'T7',
   '99990000-0000-0000-0000-0000000000a3', NULL, NULL),
  ('99990000-0000-0000-0000-000000000b09', 'aaaa1111-0000-0000-0000-000000000001', 'T9',
   '99990000-0000-0000-0000-0000000000a1', NULL, NULL),
  ('99990000-0000-0000-0000-000000000bf9', 'aaaa1111-0000-0000-0000-000000000099', 'TP',
   '99990000-0000-0000-0000-0000000000a8', NULL, NULL);

INSERT INTO public.task_items (id, task_id, project_id, entity_type, entity_id, position) VALUES
  ('99990000-0000-0000-0000-000000000145', '99990000-0000-0000-0000-000000000b04', 'aaaa1111-0000-0000-0000-000000000001',
   'asset', '99990000-0000-0000-0000-0000000000a5', 1),
  ('99990000-0000-0000-0000-000000000157', '99990000-0000-0000-0000-000000000b05', 'aaaa1111-0000-0000-0000-000000000001',
   'asset', '99990000-0000-0000-0000-0000000000a7', 1),
  ('99990000-0000-0000-0000-000000000192', '99990000-0000-0000-0000-000000000b09', 'aaaa1111-0000-0000-0000-000000000001',
   'asset', '99990000-0000-0000-0000-0000000000a2', 1),
  ('99990000-0000-0000-0000-000000000193', '99990000-0000-0000-0000-000000000b09', 'aaaa1111-0000-0000-0000-000000000001',
   'asset', '99990000-0000-0000-0000-0000000000a3', 2);

-- T6: a link made before 0096 to ANOTHER project's asset (0000's FK was
-- plain). Made with the sync marked on so the seed skips it — the only way
-- such a row exists after 0096 — then a scene item is added the normal way.
DO $$ BEGIN PERFORM set_config('wilson.task_items_sync', 'on', true); END $$;
INSERT INTO public.tasks (id, project_id, title, asset_id) VALUES
  ('99990000-0000-0000-0000-000000000b06', 'aaaa1111-0000-0000-0000-000000000001', 'T6',
   '99990000-0000-0000-0000-0000000000a9');
DO $$ BEGIN PERFORM set_config('wilson.task_items_sync', '', true); END $$;
INSERT INTO public.task_items (task_id, project_id, entity_type, entity_id, position) VALUES
  ('99990000-0000-0000-0000-000000000b06', 'aaaa1111-0000-0000-0000-000000000001',
   'scene', '99990000-0000-0000-0000-0000000000c1', 0);


-- ═════════════════════════════════════════════════════════════════════════
-- Structure (§2–§5, §9)
-- ═════════════════════════════════════════════════════════════════════════

-- 1
SELECT has_table('public', 'task_items', 'public.task_items exists (0096 §2)');

-- 2
SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.task_items'::regclass),
  'task_items has RLS ENABLED and FORCED (§4)');

-- 3
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'task_items'
      AND cmd IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE') AND permissive = 'PERMISSIVE'),
  4,
  'exactly four permissive policies, one per command, none FOR ALL (§4)');

-- 4
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'task_items'
      AND (COALESCE(qual, '') || ' ' || COALESCE(with_check, '')) ~ 'FROM projects p\s+WHERE \(p\.id = task_items\.project_id\)'
      AND (COALESCE(qual, '') || ' ' || COALESCE(with_check, '')) ~ 'FROM tasks t\s+WHERE \(t\.id = task_items\.task_id\)'
      AND (COALESCE(qual, '') || ' ' || COALESCE(with_check, '')) LIKE '%current_workspace_id()%'),
  4,
  'every policy carries the workspace arm and hops to the project AND the task (§4: privacy, trash)');

-- 5
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'task_items'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
      AND (COALESCE(qual, '') || ' ' || COALESCE(with_check, '')) LIKE '%has_active_membership(workspace_id)%'
      AND (COALESCE(qual, '') || ' ' || COALESCE(with_check, '')) LIKE '%can_write_project(project_id)%'),
  3,
  'every write policy carries has_active_membership and can_write_project (tasks'' gate, not the money gate)');

-- 6
SELECT ok(
  (SELECT qual IS NOT NULL AND qual = with_check FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'task_items' AND cmd = 'UPDATE'),
  'task_items_update''s WITH CHECK is its USING, arm for arm (0044)');

-- 7
SELECT ok(
  NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
               WHERE table_schema = 'public' AND table_name = 'task_items' AND grantee IN ('anon', 'PUBLIC'))
  AND NOT EXISTS (SELECT 1 FROM information_schema.column_privileges
               WHERE table_schema = 'public' AND table_name = 'task_items' AND grantee IN ('anon', 'PUBLIC')),
  'anon and PUBLIC hold no privilege on task_items, table or column (§5)');

-- 8
SELECT ok(
  has_table_privilege('authenticated', 'public.task_items', 'SELECT')
  AND has_table_privilege('authenticated', 'public.task_items', 'INSERT')
  AND has_table_privilege('authenticated', 'public.task_items', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.task_items', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.task_items', 'TRUNCATE')
  AND has_column_privilege('authenticated', 'public.task_items', 'position', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.task_items', 'entity_id', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.task_items', 'entity_type', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.task_items', 'task_id', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.task_items', 'project_id', 'UPDATE'),
  'authenticated: SELECT, INSERT, DELETE, and UPDATE of position ONLY (§5)');

-- 9
SELECT is(
  (SELECT count(*)::int FROM pg_constraint
    WHERE conrelid = 'public.task_items'::regclass AND contype = 'f'
      AND conname IN ('task_items_task_fk', 'task_items_asset_fk', 'task_items_scene_fk',
                      'task_items_shot_fk', 'task_items_level_fk', 'task_items_experience_fk')
      AND pg_get_constraintdef(oid) LIKE '%, project_id) REFERENCES %(id, project_id) ON DELETE CASCADE%'),
  6,
  'six same-project keys on (…, project_id) → (id, project_id), each ON DELETE CASCADE (§2)');

-- 10
SELECT ok(
  EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.task_items'::regclass
             AND conname = 'task_items_task_entity_key'
             AND pg_get_constraintdef(oid) = 'UNIQUE (task_id, entity_type, entity_id)'),
  'a task names an item once: UNIQUE (task_id, entity_type, entity_id) (§2)');

-- 11
SELECT is(
  (SELECT count(*)::int FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'task_items'
      AND column_name IN ('asset_id', 'scene_id', 'shot_id', 'level_id', 'experience_id')
      AND is_generated = 'ALWAYS'),
  5,
  'the five typed columns are GENERATED ALWAYS from entity_type + entity_id (§2)');

-- 12
SELECT is(
  (SELECT count(*)::int FROM pg_trigger
    WHERE NOT tgisinternal
      AND ((tgrelid = 'public.task_items'::regclass
            AND tgname IN ('trg_task_items_populate_workspace', 'trg_task_items_audit',
                           'trg_task_items_sync_task', 'trg_task_items_realtime'))
        OR (tgrelid = 'public.tasks'::regclass
            AND tgname IN ('trg_tasks_sync_items', 'trg_tasks_seed_items')))),
  6,
  'the six triggers are attached: stamp, audit, both directions of the sync, the seed, realtime (§3, §7, §9)');

-- 13
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.prosecdef
                 AND p.proname IN ('reorder_task_items', 'fn_task_items_sync_task',
                                   'fn_tasks_sync_items', 'fn_tasks_seed_items'))
  AND has_function_privilege('authenticated', 'public.reorder_task_items(uuid, text, uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.reorder_task_items(uuid, text, uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.fn_tasks_sync_items()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.fn_task_items_sync_task()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.fn_tasks_seed_items()', 'EXECUTE'),
  'every 0096 function is SECURITY INVOKER; reorder is authenticated-only; the trigger functions no client''s (§6, §7)');

-- 14
SELECT is(
  (SELECT count(*)::int
     FROM (SELECT regexp_replace(regexp_replace(pg_get_functiondef('public.fn_realtime_broadcast()'::regprocedure),
                    '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g') AS body) b,
          unnest(ARRAY['projects', 'phases', 'assets', 'tasks', 'files', 'comments', 'task_dependencies',
                       'phase_dependencies', 'task_links', 'asset_versions', 'project_members', 'milestones',
                       'bins', 'bin_files', 'shot_takes', 'task_items']) AS t(name)
    WHERE (length(b.body) - length(replace(b.body, '''' || t.name || '''', ''))) / length('''' || t.name || '''') = 1),
  16,
  'fn_realtime_broadcast names each of the SIXTEEN tables exactly once — no arm lost in the restatement (§9)');

-- 15
SELECT ok(
  pg_get_functiondef('public.fn_realtime_broadcast()'::regprocedure) LIKE '%file_row_is_money((to_jsonb(NEW)%'
  AND pg_get_functiondef('public.fn_realtime_broadcast()'::regprocedure) LIKE '%file_row_is_money((to_jsonb(OLD)%'
  AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_realtime_broadcast()'::regprocedure),
  'fn_realtime_broadcast keeps 0088''s money arm for files (NEW and OLD) and stays SECURITY DEFINER (§9)');

-- 16
SELECT is(
  (SELECT string_agg(c.relname::text, ',' ORDER BY c.relname::text)
     FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid JOIN pg_class c ON c.oid = tg.tgrelid
    WHERE p.proname = 'fn_realtime_broadcast' AND NOT tg.tgisinternal),
  'asset_versions,assets,bin_files,bins,comments,files,milestones,phase_dependencies,'
  || 'phases,project_members,projects,shot_takes,task_dependencies,task_items,task_links,tasks',
  'the broadcast trigger is on exactly the sixteen project-scoped tables (§9)');


-- ═════════════════════════════════════════════════════════════════════════
-- The seed (§7c), read as postgres
-- ═════════════════════════════════════════════════════════════════════════

-- 17
SELECT is(
  (SELECT string_agg(entity_type || ':' || right(entity_id::text, 2) || ':' || position, ',' ORDER BY entity_type, position, id)
     FROM public.task_items WHERE task_id = '99990000-0000-0000-0000-000000000b01'),
  'asset:a1:0',
  'a new task''s asset_id became its first item, at position 0 (§7c)');

-- 18
SELECT is(
  (SELECT string_agg(entity_type || ':' || right(entity_id::text, 2) || ':' || position, ',' ORDER BY entity_type, position, id)
     FROM public.task_items WHERE task_id = '99990000-0000-0000-0000-000000000b03'),
  'scene:c1:0,shot:d1:0',
  'a new task''s scene_id and shot_id became its first scene and first shot (§7c)');

-- 19
SELECT is(
  (SELECT count(*)::int FROM public.task_items WHERE task_id = '99990000-0000-0000-0000-000000000b02'),
  0,
  'a new task with no single link has no item (§7c)');

-- 20
SELECT is(
  (SELECT asset_id::text || '/' || scene_id::text FROM public.tasks WHERE id = '99990000-0000-0000-0000-000000000b06'),
  '99990000-0000-0000-0000-0000000000a9/99990000-0000-0000-0000-0000000000c1',
  'a scene item sets scene_id and leaves alone an asset_id the task has no asset item for (a pre-0096 link to another project) (§7a)');


-- ═════════════════════════════════════════════════════════════════════════
-- task_items → tasks (§7a), as a project MEMBER
-- ═════════════════════════════════════════════════════════════════════════
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 21
SELECT lives_ok(
  $$INSERT INTO public.task_items (id, task_id, project_id, entity_type, entity_id, position)
    VALUES ('99990000-0000-0000-0000-000000000112', '99990000-0000-0000-0000-000000000b01',
            'aaaa1111-0000-0000-0000-000000000001', 'asset', '99990000-0000-0000-0000-0000000000a2', 1)$$,
  'a member adds a second asset to a task');

-- 22
SELECT is(
  (SELECT asset_id FROM public.tasks WHERE id = '99990000-0000-0000-0000-000000000b01'),
  '99990000-0000-0000-0000-0000000000a1'::uuid,
  'the second asset leaves the main one: asset_id is still A1 (§7a)');

-- 23
SELECT lives_ok(
  $$SELECT count(*) FROM public.reorder_task_items('99990000-0000-0000-0000-000000000b01', 'asset',
      ARRAY['99990000-0000-0000-0000-000000000112',
            (SELECT id FROM public.task_items WHERE task_id = '99990000-0000-0000-0000-000000000b01'
               AND entity_type = 'asset' AND entity_id = '99990000-0000-0000-0000-0000000000a1')]::uuid[])$$,
  'a member reorders the task''s assets, A2 first (§6)');

-- 24
SELECT is(
  (SELECT asset_id FROM public.tasks WHERE id = '99990000-0000-0000-0000-000000000b01'),
  '99990000-0000-0000-0000-0000000000a2'::uuid,
  'the reorder made A2 the main asset: asset_id followed (§7a)');

-- 25
SELECT is(
  (SELECT string_agg(right(entity_id::text, 2) || ':' || position, ',' ORDER BY position, created_at, id)
     FROM public.task_items WHERE task_id = '99990000-0000-0000-0000-000000000b01' AND entity_type = 'asset'),
  'a2:0,a1:1',
  'positions are dense from 0 in the order named (§6)');

-- 26
SELECT lives_ok(
  $$DELETE FROM public.task_items WHERE id = '99990000-0000-0000-0000-000000000112'$$,
  'a member removes the main asset item');

-- 27
SELECT is(
  (SELECT asset_id FROM public.tasks WHERE id = '99990000-0000-0000-0000-000000000b01'),
  '99990000-0000-0000-0000-0000000000a1'::uuid,
  'removing the main asset hands "main" to the next: asset_id is A1 again (§7a)');

-- 28
SELECT lives_ok(
  $$INSERT INTO public.task_items (task_id, project_id, entity_type, entity_id, position) VALUES
      ('99990000-0000-0000-0000-000000000b01', 'aaaa1111-0000-0000-0000-000000000001', 'level',      '99990000-0000-0000-0000-0000000000e1', 0),
      ('99990000-0000-0000-0000-000000000b01', 'aaaa1111-0000-0000-0000-000000000001', 'experience', '99990000-0000-0000-0000-0000000000f1', 0)$$,
  'a member relates the task to a level and an experience (their only home on the cloud)');

-- 29
SELECT is(
  (SELECT asset_id::text || '/' || COALESCE(scene_id::text, '-') || '/' || COALESCE(shot_id::text, '-')
     FROM public.tasks WHERE id = '99990000-0000-0000-0000-000000000b01'),
  '99990000-0000-0000-0000-0000000000a1/-/-',
  'a level''s or an experience''s item never touches the task''s columns (§7a)');

-- 30
SELECT lives_ok(
  $$INSERT INTO public.task_items (id, task_id, project_id, entity_type, entity_id, position)
    VALUES ('99990000-0000-0000-0000-000000000123', '99990000-0000-0000-0000-000000000b02',
            'aaaa1111-0000-0000-0000-000000000001', 'asset', '99990000-0000-0000-0000-0000000000a3', 0)$$,
  'a member gives an asset-less task its first asset');

-- 31
SELECT is(
  (SELECT asset_id FROM public.tasks WHERE id = '99990000-0000-0000-0000-000000000b02'),
  '99990000-0000-0000-0000-0000000000a3'::uuid,
  'the first item set asset_id from NULL (§7a)');

-- 32
SELECT lives_ok(
  $$DELETE FROM public.task_items WHERE id = '99990000-0000-0000-0000-000000000123'$$,
  'a member removes the task''s only asset');

-- 33
SELECT ok(
  (SELECT asset_id IS NULL FROM public.tasks WHERE id = '99990000-0000-0000-0000-000000000b02'),
  'the last asset item gone, asset_id is NULL (§7a)');


-- ═════════════════════════════════════════════════════════════════════════
-- tasks → task_items (§7b): older clients and every single-column writer
-- ═════════════════════════════════════════════════════════════════════════

-- 34
SELECT lives_ok(
  $$UPDATE public.tasks SET asset_id = '99990000-0000-0000-0000-0000000000a2'
     WHERE id = '99990000-0000-0000-0000-000000000b01'$$,
  'a member writes asset_id to an asset the task does not have (an older client)');

-- 35
SELECT is(
  (SELECT string_agg(right(entity_id::text, 2) || ':' || position, ',' ORDER BY position, created_at, id)
     FROM public.task_items WHERE task_id = '99990000-0000-0000-0000-000000000b01' AND entity_type = 'asset'),
  'a2:0',
  'a NEW id replaces the main asset item, at its place (§7b)');

-- 36
SELECT is(
  (SELECT asset_id FROM public.tasks WHERE id = '99990000-0000-0000-0000-000000000b01'),
  '99990000-0000-0000-0000-0000000000a2'::uuid,
  'and asset_id says the new main item (§7b)');

-- 37
SELECT lives_ok(
  $$INSERT INTO public.task_items (task_id, project_id, entity_type, entity_id, position)
    VALUES ('99990000-0000-0000-0000-000000000b01', 'aaaa1111-0000-0000-0000-000000000001',
            'asset', '99990000-0000-0000-0000-0000000000a1', 1)$$,
  'a member adds A1 back as the second asset');

-- 38
SELECT lives_ok(
  $$UPDATE public.tasks SET asset_id = '99990000-0000-0000-0000-0000000000a1'
     WHERE id = '99990000-0000-0000-0000-000000000b01'$$,
  'a member writes asset_id to the task''s SECOND asset (what opening an older bid version does)');

-- 39
SELECT is(
  (SELECT string_agg(right(entity_id::text, 2) || ':' || position, ',' ORDER BY position, created_at, id)
     FROM public.task_items WHERE task_id = '99990000-0000-0000-0000-000000000b01' AND entity_type = 'asset'),
  'a1:0,a2:1',
  'an id the task already has MOVES first and nothing is removed (§7b)');

-- 40
SELECT lives_ok(
  $$UPDATE public.tasks SET asset_id = NULL WHERE id = '99990000-0000-0000-0000-000000000b01'$$,
  'a member clears asset_id');

-- 41
SELECT is(
  (SELECT asset_id FROM public.tasks WHERE id = '99990000-0000-0000-0000-000000000b01'),
  '99990000-0000-0000-0000-0000000000a2'::uuid,
  'a cleared column removes that item and the next one is main: asset_id is A2, not NULL (§7b)');

-- 42
SELECT is(
  (SELECT string_agg(right(entity_id::text, 2) || ':' || position, ',' ORDER BY position, created_at, id)
     FROM public.task_items WHERE task_id = '99990000-0000-0000-0000-000000000b01' AND entity_type = 'asset'),
  'a2:1',
  'only the cleared item went (§7b)');

-- 43
SELECT lives_ok(
  $$UPDATE public.tasks SET scene_id = '99990000-0000-0000-0000-0000000000c2'
     WHERE id = '99990000-0000-0000-0000-000000000b03'$$,
  'a member moves a task from SC1 to SC2 by its scene_id');

-- 44
SELECT is(
  (SELECT string_agg(entity_type || ':' || right(entity_id::text, 2) || ':' || position, ',' ORDER BY entity_type, position, id)
     FROM public.task_items WHERE task_id = '99990000-0000-0000-0000-000000000b03'),
  'scene:c2:0,shot:d1:0',
  'the scene item was replaced; the shot item is untouched (§7b)');

-- 45
SELECT lives_ok(
  $$UPDATE public.tasks SET asset_id = asset_id, scene_id = scene_id, shot_id = shot_id
     WHERE id = '99990000-0000-0000-0000-000000000b03'$$,
  'a whole-row re-send (the Timeline editor sends all three on every save)');

-- 46
SELECT is(
  (SELECT string_agg(entity_type || ':' || right(entity_id::text, 2) || ':' || position, ',' ORDER BY entity_type, position, id)
     FROM public.task_items WHERE task_id = '99990000-0000-0000-0000-000000000b03'),
  'scene:c2:0,shot:d1:0',
  'a re-send of the same values changes no item (§7b)');


-- ═════════════════════════════════════════════════════════════════════════
-- Same project, by construction (§2, §7b, §7c), as the workspace admin who
-- can see the neighbour project
-- ═════════════════════════════════════════════════════════════════════════
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- 47
SELECT throws_ok(
  $$INSERT INTO public.task_items (task_id, project_id, entity_type, entity_id)
    VALUES ('99990000-0000-0000-0000-000000000b01', 'aaaa1111-0000-0000-0000-000000000001',
            'asset', '99990000-0000-0000-0000-0000000000a9')$$,
  '23503', NULL,
  'an item cannot name another project''s asset, though the caller can see it (the composite key, §2)');

-- 48
SELECT throws_ok(
  $$UPDATE public.tasks SET asset_id = '99990000-0000-0000-0000-0000000000a9'
     WHERE id = '99990000-0000-0000-0000-000000000b02'$$,
  '23503', NULL,
  'asset_id cannot be pointed at another project''s asset any more (§7b; 0000''s key was plain)');

-- 49
SELECT throws_ok(
  $$INSERT INTO public.tasks (id, project_id, title, asset_id)
    VALUES ('99990000-0000-0000-0000-000000000b08', 'aaaa1111-0000-0000-0000-000000000001', 'T8',
            '99990000-0000-0000-0000-0000000000a9')$$,
  '23503', NULL,
  'nor can a new task be made on another project''s asset (§7c)');

-- 50
SELECT throws_ok(
  $$INSERT INTO public.task_items (task_id, project_id, entity_type, entity_id)
    VALUES ('99990000-0000-0000-0000-000000000b01', 'aaaa1111-0000-0000-0000-000000000001',
            'asset', '99990000-0000-0000-0000-0000000000a2')$$,
  '23505', NULL,
  'a task names an item once (§2)');

-- 51
SELECT throws_ok(
  $$INSERT INTO public.task_items (task_id, project_id, entity_type, entity_id)
    VALUES ('99990000-0000-0000-0000-000000000b01', 'aaaa1111-0000-0000-0000-000000000001',
            'phase', '99990000-0000-0000-0000-0000000000a2')$$,
  '23514', NULL,
  'only the five kinds (§2)');

-- 52
SELECT throws_ok(
  $$INSERT INTO public.task_items (task_id, project_id, entity_type, entity_id, position)
    VALUES ('99990000-0000-0000-0000-000000000b01', 'aaaa1111-0000-0000-0000-000000000001',
            'asset', '99990000-0000-0000-0000-0000000000a5', -1)$$,
  '23514', NULL,
  'a position is never negative (§2)');

-- 53
SELECT throws_ok(
  $$INSERT INTO public.task_items (task_id, project_id, entity_type, entity_id, asset_id)
    VALUES ('99990000-0000-0000-0000-000000000b01', 'aaaa1111-0000-0000-0000-000000000001',
            'asset', '99990000-0000-0000-0000-0000000000a5', '99990000-0000-0000-0000-0000000000a6')$$,
  '428C9', NULL,
  'a typed column cannot be written: it is generated from entity_id (§2)');


-- ═════════════════════════════════════════════════════════════════════════
-- Cascades (§2), the scene's as a project MEMBER under scenes_delete
-- ═════════════════════════════════════════════════════════════════════════
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 54
SELECT lives_ok(
  $$INSERT INTO public.task_items (id, task_id, project_id, entity_type, entity_id, position)
    VALUES ('99990000-0000-0000-0000-000000000131', '99990000-0000-0000-0000-000000000b03',
            'aaaa1111-0000-0000-0000-000000000001', 'scene', '99990000-0000-0000-0000-0000000000c1', 1)$$,
  'a member adds SC1 back to T3 as its second scene');

-- 55
SELECT ok(
  (SELECT workspace_id = '11111111-1111-1111-1111-111111111111'
          AND created_by = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
     FROM public.task_items WHERE id = '99990000-0000-0000-0000-000000000131'),
  'an item is stamped with its project''s workspace and its maker (§3)');

-- 56
SELECT lives_ok(
  $$DELETE FROM public.scenes WHERE id = '99990000-0000-0000-0000-0000000000c2'$$,
  'a member deletes SC2, T3''s main scene');

-- 57
SELECT is(
  (SELECT scene_id FROM public.tasks WHERE id = '99990000-0000-0000-0000-000000000b03'),
  '99990000-0000-0000-0000-0000000000c1'::uuid,
  'the deleted main scene hands "main" to the next scene, whichever cascade runs first (§7a, §7b)');

-- 58
SELECT is(
  (SELECT string_agg(entity_type || ':' || right(entity_id::text, 2) || ':' || position, ',' ORDER BY entity_type, position, id)
     FROM public.task_items WHERE task_id = '99990000-0000-0000-0000-000000000b03'),
  'scene:c1:1,shot:d1:0',
  'the deleted scene left T3 and nothing else did (§2)');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);

-- 59
DELETE FROM public.assets WHERE id = '99990000-0000-0000-0000-0000000000a5';
SELECT is(
  (SELECT string_agg(right(i.entity_id::text, 2) || '@' || right(t.asset_id::text, 2), ',')
     FROM public.task_items i JOIN public.tasks t ON t.id = i.task_id
    WHERE i.task_id = '99990000-0000-0000-0000-000000000b04'),
  'a4@a4',
  'deleting a SECONDARY asset takes its item and leaves the task and its main asset (§2, §7a)');

-- 60
DELETE FROM public.assets WHERE id = '99990000-0000-0000-0000-0000000000a6';
SELECT is(
  (SELECT count(*)::int FROM public.tasks WHERE id = '99990000-0000-0000-0000-000000000b05'),
  0,
  'deleting a task''s MAIN asset still takes the task, its other asset and all (0034''s rule; §7a never re-points to escape it)');

-- 61
SELECT is(
  (SELECT count(*)::int FROM public.task_items WHERE task_id = '99990000-0000-0000-0000-000000000b05'),
  0,
  'and the task''s items went with it (§2)');

-- 62
DELETE FROM public.levels WHERE id = '99990000-0000-0000-0000-0000000000e1';
SELECT is(
  (SELECT count(*)::int FROM public.task_items
    WHERE task_id = '99990000-0000-0000-0000-000000000b01' AND entity_type = 'level'),
  0,
  'deleting a level takes it off every task (§2)');

-- 63
INSERT INTO public.task_items (task_id, project_id, entity_type, entity_id)
VALUES ('99990000-0000-0000-0000-000000000b02', 'aaaa1111-0000-0000-0000-000000000001',
        'experience', '99990000-0000-0000-0000-0000000000f1');
DELETE FROM public.tasks WHERE id = '99990000-0000-0000-0000-000000000b02';
SELECT is(
  (SELECT count(*)::int FROM public.task_items WHERE task_id = '99990000-0000-0000-0000-000000000b02'),
  0,
  'deleting a task takes its items (§2)');


-- ═════════════════════════════════════════════════════════════════════════
-- The trash: a trashed task's items are hidden and frozen; restored, back
-- ═════════════════════════════════════════════════════════════════════════
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 64
SELECT ok(
  public.soft_delete_row('tasks', '99990000-0000-0000-0000-000000000b07'),
  'a member trashes T7');

-- 65
SELECT is(
  (SELECT count(*)::int FROM public.task_items WHERE task_id = '99990000-0000-0000-0000-000000000b07'),
  0,
  'a trashed task''s items are hidden (§4: the task hop)');

-- 66
SELECT throws_ok(
  $$INSERT INTO public.task_items (task_id, project_id, workspace_id, entity_type, entity_id)
    VALUES ('99990000-0000-0000-0000-000000000b07', 'aaaa1111-0000-0000-0000-000000000001',
            '11111111-1111-1111-1111-111111111111', 'asset', '99990000-0000-0000-0000-0000000000a7')$$,
  '42501', NULL,
  'and cannot be added to (§4)');

-- 67
SELECT ok(
  public.restore_soft_deleted('tasks', '99990000-0000-0000-0000-000000000b07'),
  'a member restores T7');

-- 68
SELECT is(
  (SELECT count(*)::int FROM public.task_items WHERE task_id = '99990000-0000-0000-0000-000000000b07'),
  1,
  'restored, its item is back (a trash never touched it)');


-- ═════════════════════════════════════════════════════════════════════════
-- reorder_task_items (§6): a stale view's ids first, the rest after
-- ═════════════════════════════════════════════════════════════════════════

-- 69
SELECT lives_ok(
  $$SELECT count(*) FROM public.reorder_task_items('99990000-0000-0000-0000-000000000b09', 'asset',
      ARRAY['99990000-0000-0000-0000-000000000193']::uuid[])$$,
  'a member reorders T9 naming only its third asset (a stale view)');

-- 70
SELECT is(
  (SELECT string_agg(right(entity_id::text, 2) || ':' || position, ',' ORDER BY position, created_at, id)
     FROM public.task_items WHERE task_id = '99990000-0000-0000-0000-000000000b09' AND entity_type = 'asset'),
  'a3:0,a1:1,a2:2',
  'the named item goes first and the unnamed follow in their order, dense from 0 (§6)');

-- 71
SELECT is(
  (SELECT asset_id FROM public.tasks WHERE id = '99990000-0000-0000-0000-000000000b09'),
  '99990000-0000-0000-0000-0000000000a3'::uuid,
  'and asset_id followed (§7a)');

-- 72
SELECT throws_ok(
  $$SELECT count(*) FROM public.reorder_task_items('99990000-0000-0000-0000-000000000b09', 'asset',
      ARRAY['99990000-0000-0000-0000-000000000193', '99990000-0000-0000-0000-000000000193']::uuid[])$$,
  '22023', NULL,
  'an item named twice is refused (§6)');

-- 73
SELECT throws_ok(
  $$SELECT count(*) FROM public.reorder_task_items('99990000-0000-0000-0000-000000000b09', 'phase',
      ARRAY['99990000-0000-0000-0000-000000000193']::uuid[])$$,
  '22023', NULL,
  'an unknown kind is refused (§6)');

-- 74
SELECT throws_ok(
  $$UPDATE public.task_items SET entity_id = '99990000-0000-0000-0000-0000000000a4'
     WHERE id = '99990000-0000-0000-0000-000000000193'$$,
  '42501', NULL,
  'a member cannot re-point an item: UPDATE is position only (§5)');

-- 75
SELECT throws_ok(
  $$UPDATE public.task_items SET task_id = '99990000-0000-0000-0000-000000000b01'
     WHERE id = '99990000-0000-0000-0000-000000000193'$$,
  '42501', NULL,
  'nor move it to another task (§5)');


-- ═════════════════════════════════════════════════════════════════════════
-- The gate on a STAFFED project (§4): a reviewer reads, never writes
-- ═════════════════════════════════════════════════════════════════════════
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 76
SELECT is(
  (SELECT count(*)::int FROM public.task_items WHERE task_id = '99990000-0000-0000-0000-000000000b09'),
  3,
  'a reviewer reads a task''s items');

-- 77
SELECT throws_ok(
  $$INSERT INTO public.task_items (task_id, project_id, workspace_id, entity_type, entity_id)
    VALUES ('99990000-0000-0000-0000-000000000b09', 'aaaa1111-0000-0000-0000-000000000001',
            '11111111-1111-1111-1111-111111111111', 'asset', '99990000-0000-0000-0000-0000000000a4')$$,
  '42501', NULL,
  'a reviewer cannot add an item (can_write_project, §4)');

-- 78
UPDATE public.task_items SET position = 5 WHERE id = '99990000-0000-0000-0000-000000000193';
SELECT is(
  (SELECT position FROM public.task_items WHERE id = '99990000-0000-0000-0000-000000000193'),
  0,
  'a reviewer''s move matches nothing (§4)');

-- 79
DELETE FROM public.task_items WHERE id = '99990000-0000-0000-0000-000000000193';
SELECT is(
  (SELECT count(*)::int FROM public.task_items WHERE id = '99990000-0000-0000-0000-000000000193'),
  1,
  'a reviewer''s remove matches nothing (§4)');

-- 80
SELECT lives_ok(
  $$SELECT count(*) FROM public.reorder_task_items('99990000-0000-0000-0000-000000000b09', 'asset',
      ARRAY['99990000-0000-0000-0000-000000000192']::uuid[])$$,
  'a reviewer may call reorder_task_items');

-- 81
SELECT is(
  (SELECT string_agg(right(entity_id::text, 2) || ':' || position, ',' ORDER BY position, created_at, id)
     FROM public.task_items WHERE task_id = '99990000-0000-0000-0000-000000000b09' AND entity_type = 'asset'),
  'a3:0,a1:1,a2:2',
  'but moves nothing: it is SECURITY INVOKER (§6)');

-- 82
UPDATE public.tasks SET asset_id = '99990000-0000-0000-0000-0000000000a1'
 WHERE id = '99990000-0000-0000-0000-000000000b09';
SELECT is(
  (SELECT string_agg(right(entity_id::text, 2) || ':' || position, ',' ORDER BY position, created_at, id)
     FROM public.task_items WHERE task_id = '99990000-0000-0000-0000-000000000b09' AND entity_type = 'asset'),
  'a3:0,a1:1,a2:2',
  'nor reaches the items through asset_id: tasks_update refuses the reviewer first (§7b)');

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '99999999-9999-9999-9999-999999999999', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 83
SELECT throws_ok(
  $$INSERT INTO public.task_items (task_id, project_id, workspace_id, entity_type, entity_id)
    VALUES ('99990000-0000-0000-0000-000000000b09', 'aaaa1111-0000-0000-0000-000000000001',
            '11111111-1111-1111-1111-111111111111', 'asset', '99990000-0000-0000-0000-0000000000a4')$$,
  '42501', NULL,
  'a workspace member with no seat on a staffed project cannot add an item (§4)');


-- ═════════════════════════════════════════════════════════════════════════
-- Tenancy (§4): another workspace's admin
-- ═════════════════════════════════════════════════════════════════════════
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '22222222-2222-2222-2222-222222222222', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- 84
SELECT is(
  (SELECT count(*)::int FROM public.task_items WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  0,
  'another workspace''s admin sees none of project_a''s items');

-- 85
SELECT throws_ok(
  $$INSERT INTO public.task_items (task_id, project_id, workspace_id, entity_type, entity_id)
    VALUES ('99990000-0000-0000-0000-000000000b09', 'aaaa1111-0000-0000-0000-000000000001',
            '11111111-1111-1111-1111-111111111111', 'asset', '99990000-0000-0000-0000-0000000000a4')$$,
  '42501', NULL,
  'nor writes one, workspace_id sent (§4)');


-- ═════════════════════════════════════════════════════════════════════════
-- PRIVACY (§4's hops): a workspace manager who did not create the project
-- ═════════════════════════════════════════════════════════════════════════
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);

-- 86
SELECT is(
  (SELECT count(*)::int FROM public.task_items WHERE task_id = '99990000-0000-0000-0000-000000000bf9'),
  1,
  'PRESENCE: the private project''s task has its item (seeded)');

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

-- 87
SELECT is(
  (SELECT count(*)::int FROM public.task_items WHERE task_id = '99990000-0000-0000-0000-000000000bf9'),
  0,
  'a workspace manager who did not create a private project sees none of its items');

-- 88
SELECT throws_ok(
  $$INSERT INTO public.task_items (task_id, project_id, workspace_id, entity_type, entity_id)
    VALUES ('99990000-0000-0000-0000-000000000bf9', 'aaaa1111-0000-0000-0000-000000000099',
            '11111111-1111-1111-1111-111111111111', 'asset', '99990000-0000-0000-0000-0000000000a8')$$,
  '42501', NULL,
  'nor adds one, workspace_id sent so the stamp cannot refuse for the wrong reason (the hop, §4)');

-- 89
DELETE FROM public.task_items WHERE task_id = '99990000-0000-0000-0000-000000000bf9';
SELECT lives_ok(
  $$INSERT INTO public.task_items (task_id, project_id, entity_type, entity_id, position)
    VALUES ('99990000-0000-0000-0000-000000000b09', 'aaaa1111-0000-0000-0000-000000000001',
            'asset', '99990000-0000-0000-0000-0000000000a4', 3)$$,
  'CONTROL: the same manager adds an item on the public project (the refusal above is the privacy arm)');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);

-- 90
SELECT is(
  (SELECT count(*)::int FROM public.task_items WHERE task_id = '99990000-0000-0000-0000-000000000bf9'),
  1,
  'the manager''s delete of the private project''s items matched nothing (§4)');

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 91
SELECT lives_ok(
  $$INSERT INTO public.task_items (task_id, project_id, entity_type, entity_id, position)
    VALUES ('99990000-0000-0000-0000-000000000bf9', 'aaaa1111-0000-0000-0000-000000000099',
            'asset', '99990000-0000-0000-0000-0000000000a8', 0)
    ON CONFLICT (task_id, entity_type, entity_id) DO NOTHING$$,
  'the private project''s creator writes its items');

-- 92
SELECT is(
  (SELECT count(*)::int FROM public.task_items WHERE task_id = '99990000-0000-0000-0000-000000000bf9'),
  1,
  'and reads them');


-- ═════════════════════════════════════════════════════════════════════════
-- anon, and the sync's setting
-- ═════════════════════════════════════════════════════════════════════════
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
SET LOCAL ROLE anon;

-- 93
SELECT throws_ok(
  $$SELECT count(*) FROM public.task_items$$,
  '42501', NULL,
  'anon cannot read task_items (§5)');

-- 94
SELECT throws_ok(
  $$SELECT count(*) FROM public.reorder_task_items('99990000-0000-0000-0000-000000000b09', 'asset', ARRAY[]::uuid[])$$,
  '42501', NULL,
  'anon cannot call reorder_task_items (§6)');

RESET ROLE;

-- 95
SELECT is(
  COALESCE(current_setting('wilson.task_items_sync', true), ''),
  '',
  'the sync''s setting is restored after every statement (§7)');

-- 96
SELECT is(
  (SELECT count(*)::int
     FROM public.tasks t
     JOIN LATERAL (SELECT k.kind,
                          (SELECT i.entity_id FROM public.task_items i
                            WHERE i.task_id = t.id AND i.entity_type = k.kind
                            ORDER BY i.position, i.created_at, i.id LIMIT 1) AS main,
                          CASE k.kind WHEN 'asset' THEN t.asset_id WHEN 'scene' THEN t.scene_id ELSE t.shot_id END AS col
                     FROM (VALUES ('asset'), ('scene'), ('shot')) AS k(kind)) m ON true
    WHERE t.id::text LIKE '99990000-%' AND m.main IS NOT NULL AND m.col IS DISTINCT FROM m.main),
  0,
  'after everything above, every fixture task''s single column of a kind it has items for IS its main item');

-- 97
SELECT is(
  (SELECT count(*)::int FROM public.tasks t
    WHERE t.id::text LIKE '99990000-%'
      AND ((t.asset_id IS NOT NULL AND t.id <> '99990000-0000-0000-0000-000000000b06'
            AND NOT EXISTS (SELECT 1 FROM public.task_items i WHERE i.task_id = t.id AND i.entity_type = 'asset' AND i.entity_id = t.asset_id))
        OR (t.scene_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM public.task_items i WHERE i.task_id = t.id AND i.entity_type = 'scene' AND i.entity_id = t.scene_id))
        OR (t.shot_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM public.task_items i WHERE i.task_id = t.id AND i.entity_type = 'shot' AND i.entity_id = t.shot_id)))),
  0,
  'and every fixture task''s single link has its item (T6''s pre-0096 cross-project asset excepted)');

SELECT * FROM finish();
ROLLBACK;
