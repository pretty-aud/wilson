-- =============================================================================
-- 100_no_main_item.sql — migration 0097 (VW1m, 2026-10-16): a task's items are
-- its items, and deleting an asset never deletes a task.
--
-- Audrey (2026-10-16): "lets not have main asset be a thing. thats not needed
-- and i dont like."; deleting an asset that tasks are linked to: "The tasks
-- stay (Recommended)"; an asset in the trash: "Hidden, back on restore
-- (Recommended)" (the client hides it; the database keeps the task).
--
-- What this pins (each probe names the 0097 section it holds to), under real
-- logins (app_role in app_metadata: current_app_role() reads the JWT):
--   * The catalogue (§1–§7): the asset key sets NULL; tasks_select is the
--     project hop with no asset arm; tasks has exactly its four policies;
--     fn_tasks_sync_items has no replace arm and moves nothing; the three
--     sync triggers attached; the functions SECURITY INVOKER and no client's;
--     fn_realtime_broadcast still 0096's body.
--   * tasks_select restated ARM BY ARM (the 0062 lesson: a rewritten policy
--     that drops an arm is an escalation, so each is proved under a login):
--     a trashed task hidden; another workspace's admin sees nothing; a
--     private project's task hidden from a workspace manager who cannot see
--     the project (the hop now judges EVERY task by its own project), with
--     controls; a trashed project's task hidden; anon nothing.
--   * Newly visible (§1, §2): a task whose only asset is in the trash stays,
--     with its item rows; restored, nothing changed. A task whose asset is
--     hard-deleted survives with its other items and the copy on the next;
--     a set-aside task survives the 30-day purge of its asset with asset_id
--     NULL and its scene item kept.
--   * The add-only write (§3), as a project MEMBER (an older app's single
--     column): A then B keeps A and adds B at the end, the column reads A;
--     writing an item the task has moves nothing; clearing removes only the
--     item it named and the column reads the next; a scene works the same;
--     the end of a kind at INTEGER's largest does not overflow; another
--     project's asset is refused; a whole-row re-send changes nothing.
--   * The seed (§5): a new task's columns still become its items.
--   * reorder_task_items (0096 §6) still works and the copy follows (§4).
--
-- Postgres-side reads are ALWAYS scoped to fixture ids — dev carries real
-- projects (S33, 439f702). The first three-digit suite: rls.yml's coverage
-- guard and replay list and scripts/tap-all.mjs learned three digits with it.
-- =============================================================================

BEGIN;

SELECT plan(52);

SELECT * FROM tests.rls_setup();

-- ── Extra fixtures ─────────────────────────────────────────────────────────
--   user_d  app_role 'user',    project_a MEMBER        -> writes
--   user_e  app_role 'manager', no seat, not P's creator -> never sees P
--   user_f  app_role 'user',    the private project's creator
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
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
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','user','user_d','User D',true),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','manager','user_e','User E',true),
  ('11111111-1111-1111-1111-111111111111','ffffffff-ffff-ffff-ffff-ffffffffffff','user','user_f','User F',true)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET app_role = EXCLUDED.app_role;

-- The private project (created_by user_f: the privacy arm reads created_by),
-- a public neighbour in the same workspace (its asset is visible to every
-- caller, so only task_items' composite key can refuse it), and a project in
-- the trash.
INSERT INTO public.projects (id, workspace_id, title, is_private, created_by, deleted_at) VALUES
  ('aaaa1111-0000-0000-0000-000000000100', '11111111-1111-1111-1111-111111111111',
   'Private P100', true,  'ffffffff-ffff-ffff-ffff-ffffffffffff', NULL),
  ('aaaa1111-0000-0000-0000-000000000102', '11111111-1111-1111-1111-111111111111',
   'Neighbour P100', false, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL),
  ('aaaa1111-0000-0000-0000-000000000101', '11111111-1111-1111-1111-111111111111',
   'Trashed P100', false, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now());

INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role)
VALUES
  ('aaaa1111-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;

-- project_a's rows: assets a1–a8, scenes c1–c2; the neighbour's a9; the
-- private project's aa; the trashed project's ab.
INSERT INTO public.assets (id, project_id, name) VALUES
  ('10010000-0000-0000-0000-0000000000a1', 'aaaa1111-0000-0000-0000-000000000001', 'Lighthouse Interior'),
  ('10010000-0000-0000-0000-0000000000a2', 'aaaa1111-0000-0000-0000-000000000001', 'Storm Lantern'),
  ('10010000-0000-0000-0000-0000000000a3', 'aaaa1111-0000-0000-0000-000000000001', 'Keeper'),
  ('10010000-0000-0000-0000-0000000000a4', 'aaaa1111-0000-0000-0000-000000000001', 'Rowboat'),
  ('10010000-0000-0000-0000-0000000000a5', 'aaaa1111-0000-0000-0000-000000000001', 'Oar'),
  ('10010000-0000-0000-0000-0000000000a6', 'aaaa1111-0000-0000-0000-000000000001', 'Gull'),
  ('10010000-0000-0000-0000-0000000000a7', 'aaaa1111-0000-0000-0000-000000000001', 'Fog Bank'),
  ('10010000-0000-0000-0000-0000000000a8', 'aaaa1111-0000-0000-0000-000000000001', 'Bell'),
  ('10010000-0000-0000-0000-0000000000a9', 'aaaa1111-0000-0000-0000-000000000102', 'Neighbour asset'),
  ('10010000-0000-0000-0000-0000000000aa', 'aaaa1111-0000-0000-0000-000000000100', 'Private asset'),
  ('10010000-0000-0000-0000-0000000000ab', 'aaaa1111-0000-0000-0000-000000000101', 'Trashed project asset');
INSERT INTO public.scenes (id, project_id, name, scene_number) VALUES
  ('10010000-0000-0000-0000-0000000000c1', 'aaaa1111-0000-0000-0000-000000000001', 'SC1', 1),
  ('10010000-0000-0000-0000-0000000000c2', 'aaaa1111-0000-0000-0000-000000000001', 'SC2', 2);

-- Tasks, inserted as postgres: the seed (0096 §7c, kept by §5) makes their
-- first items.
--   T1 asset a1 (the add-only write) · T2 asset a7 (its asset trashed)
--   T3 asset a4 (+ a5) (a4 hard-deleted) · T5 nothing (trashed)
--   T7 asset a1 (+ a2) (the reorder) · TP the private project's (asset aa)
--   T8 the trashed project's (asset ab)
INSERT INTO public.tasks (id, project_id, title, asset_id) VALUES
  ('10010000-0000-0000-0000-000000000b01', 'aaaa1111-0000-0000-0000-000000000001', 'T1',
   '10010000-0000-0000-0000-0000000000a1'),
  ('10010000-0000-0000-0000-000000000b02', 'aaaa1111-0000-0000-0000-000000000001', 'T2',
   '10010000-0000-0000-0000-0000000000a7'),
  ('10010000-0000-0000-0000-000000000b03', 'aaaa1111-0000-0000-0000-000000000001', 'T3',
   '10010000-0000-0000-0000-0000000000a4'),
  ('10010000-0000-0000-0000-000000000b05', 'aaaa1111-0000-0000-0000-000000000001', 'T5', NULL),
  ('10010000-0000-0000-0000-000000000b07', 'aaaa1111-0000-0000-0000-000000000001', 'T7',
   '10010000-0000-0000-0000-0000000000a1'),
  ('10010000-0000-0000-0000-000000000bf1', 'aaaa1111-0000-0000-0000-000000000100', 'TP',
   '10010000-0000-0000-0000-0000000000aa'),
  ('10010000-0000-0000-0000-000000000b08', 'aaaa1111-0000-0000-0000-000000000101', 'T8',
   '10010000-0000-0000-0000-0000000000ab');

INSERT INTO public.task_items (task_id, project_id, entity_type, entity_id, position) VALUES
  ('10010000-0000-0000-0000-000000000b03', 'aaaa1111-0000-0000-0000-000000000001', 'asset', '10010000-0000-0000-0000-0000000000a5', 1),
  ('10010000-0000-0000-0000-000000000b07', 'aaaa1111-0000-0000-0000-000000000001', 'asset', '10010000-0000-0000-0000-0000000000a2', 1);

-- T4: SET ASIDE (0090: never purged), its asset a6 and the scene SC1. A set
-- aside is the bid versions' (the money gate's) or the service role's.
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;
INSERT INTO public.tasks (id, project_id, title, asset_id, scene_id, set_aside_at) VALUES
  ('10010000-0000-0000-0000-000000000b04', 'aaaa1111-0000-0000-0000-000000000001', 'T4',
   '10010000-0000-0000-0000-0000000000a6', '10010000-0000-0000-0000-0000000000c1', now());
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);


-- ═════════════════════════════════════════════════════════════════════════
-- The catalogue (§1–§7)
-- ═════════════════════════════════════════════════════════════════════════

-- 1
SELECT is(
  (SELECT string_agg(pg_get_constraintdef(c.oid), ' | ')
     FROM pg_constraint c
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attname = 'asset_id'
    WHERE c.conrelid = 'public.tasks'::regclass AND c.contype = 'f'
      AND c.confrelid = 'public.assets'::regclass AND c.conkey = ARRAY[a.attnum]::int2[]),
  'FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL',
  'tasks.asset_id has ONE key to assets, ON DELETE SET NULL: deleting an asset never deletes a task (§1)');

-- 2
SELECT is(
  (SELECT regexp_replace(regexp_replace(qual, 'public\.', '', 'g'), '\s+', ' ', 'g')
     FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tasks' AND policyname = 'tasks_select'),
  '((deleted_at IS NULL) AND (workspace_id = current_workspace_id()) AND (EXISTS ( SELECT 1 FROM projects p WHERE (p.id = tasks.project_id))))',
  'tasks_select is the trash arm, the workspace arm and the hop to the task''s own project, and names no asset (§2)');

-- 3
SELECT is(
  (SELECT string_agg(policyname || ':' || cmd || ':' || permissive, ',' ORDER BY policyname)
     FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tasks'),
  'tasks_delete:DELETE:PERMISSIVE,tasks_insert:INSERT:PERMISSIVE,tasks_select:SELECT:PERMISSIVE,tasks_update:UPDATE:PERMISSIVE',
  'tasks has exactly its four permissive policies, one per command, none FOR ALL (§2: DROP then CREATE, never a second)');

-- 4
SELECT ok(
  (SELECT (length(s) - length(replace(s, 'delete from', ''))) / length('delete from') = 1
          AND position('if v_new is null then delete from public.task_items' IN s) > 0
          AND s !~ '\mupdate\M'
          AND position('max(x.position)' IN s) > 0
     FROM (SELECT lower(regexp_replace(regexp_replace(prosrc, '--[^' || chr(10) || ']*', '', 'g'), '\s+', ' ', 'g')) AS s
             FROM pg_proc WHERE oid = 'public.fn_tasks_sync_items()'::regprocedure) f),
  'fn_tasks_sync_items: its one DELETE is the cleared column''s, it UPDATEs nothing (no item moves), it adds at the end (§3)');

-- 5
SELECT is(
  (SELECT count(*)::int FROM pg_trigger tg
    WHERE NOT tg.tgisinternal AND tg.tgenabled <> 'D'
      AND ((tg.tgrelid = 'public.task_items'::regclass AND tg.tgname = 'trg_task_items_sync_task'
            AND tg.tgfoid = 'public.fn_task_items_sync_task()'::regprocedure)
        OR (tg.tgrelid = 'public.tasks'::regclass AND tg.tgname = 'trg_tasks_sync_items'
            AND tg.tgfoid = 'public.fn_tasks_sync_items()'::regprocedure)
        OR (tg.tgrelid = 'public.tasks'::regclass AND tg.tgname = 'trg_tasks_seed_items'
            AND tg.tgfoid = 'public.fn_tasks_seed_items()'::regprocedure))),
  3,
  'the three sync triggers are attached to their functions (§3–§5: same triggers)');

-- 6
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.prosecdef
                 AND p.proname IN ('reorder_task_items', 'fn_task_items_sync_task',
                                   'fn_tasks_sync_items', 'fn_tasks_seed_items'))
  AND NOT has_function_privilege('authenticated', 'public.fn_tasks_sync_items()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.fn_tasks_sync_items()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.fn_task_items_sync_task()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.fn_task_items_sync_task()', 'EXECUTE')
  AND position('FOR NO KEY UPDATE' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_task_items_sync_task()'::regprocedure)) > 0,
  'the sync functions are SECURITY INVOKER and no client''s; the copy''s writer still locks the task row (§4, R1-5)');

-- 7
SELECT is(
  (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.fn_realtime_broadcast()'::regprocedure),
  '2e8cc917144b17b674af3ca03fa76055',
  'fn_realtime_broadcast is 0096''s body, untouched: 0097 does not restate it');


-- ═════════════════════════════════════════════════════════════════════════
-- The seed (§5) and the copy, read as postgres
-- ═════════════════════════════════════════════════════════════════════════

-- 8
SELECT is(
  (SELECT string_agg(entity_type || ':' || right(entity_id::text, 2) || ':' || position, ',' ORDER BY entity_type, position, id)
     FROM public.task_items WHERE task_id = '10010000-0000-0000-0000-000000000b04'),
  'asset:a6:0,scene:c1:0',
  'a new task''s asset_id and scene_id became its items (§5, set aside or not)');


-- ═════════════════════════════════════════════════════════════════════════
-- The add-only write (§3), as a project MEMBER: an older app's column
-- ═════════════════════════════════════════════════════════════════════════
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 9
SELECT lives_ok(
  $$INSERT INTO public.tasks (id, project_id, title, asset_id, scene_id)
    VALUES ('10010000-0000-0000-0000-000000000b06', 'aaaa1111-0000-0000-0000-000000000001', 'T6',
            '10010000-0000-0000-0000-0000000000a8', '10010000-0000-0000-0000-0000000000c2')$$,
  'a member makes a task with an asset and a scene (a template, an older app)');

-- 10
SELECT is(
  (SELECT string_agg(entity_type || ':' || right(entity_id::text, 2) || ':' || position, ',' ORDER BY entity_type, position, id)
     FROM public.task_items WHERE task_id = '10010000-0000-0000-0000-000000000b06'),
  'asset:a8:0,scene:c2:0',
  'and its columns became its items, under the member''s own login (§5)');

-- 11
SELECT lives_ok(
  $$UPDATE public.tasks SET asset_id = '10010000-0000-0000-0000-0000000000a2'
     WHERE id = '10010000-0000-0000-0000-000000000b01'$$,
  'a member writes asset B over a task holding asset A (an older app''s one-asset field)');

-- 12
SELECT is(
  (SELECT string_agg(right(entity_id::text, 2) || ':' || position, ',' ORDER BY position, created_at, id)
     FROM public.task_items WHERE task_id = '10010000-0000-0000-0000-000000000b01' AND entity_type = 'asset'),
  'a1:0,a2:1',
  'A is kept and B is ADDED at the end: nothing is replaced (§3)');

-- 13
SELECT is(
  (SELECT asset_id FROM public.tasks WHERE id = '10010000-0000-0000-0000-000000000b01'),
  '10010000-0000-0000-0000-0000000000a1'::uuid,
  'and the column reads A: the copy is the first item in the stored order, not what was written (§3)');

-- 14
SELECT lives_ok(
  $$UPDATE public.tasks SET asset_id = '10010000-0000-0000-0000-0000000000a2'
     WHERE id = '10010000-0000-0000-0000-000000000b01'$$,
  'a member writes B again, an asset the task already has (what opening an older bid version sends)');

-- 15
SELECT is(
  (SELECT string_agg(right(entity_id::text, 2) || ':' || position, ',' ORDER BY position, created_at, id)
       || '@' || (SELECT right(asset_id::text, 2) FROM public.tasks WHERE id = '10010000-0000-0000-0000-000000000b01')
     FROM public.task_items WHERE task_id = '10010000-0000-0000-0000-000000000b01' AND entity_type = 'asset'),
  'a1:0,a2:1@a1',
  'an item the task has moves NOTHING; the column still reads A (§3)');

-- 16
SELECT lives_ok(
  $$UPDATE public.tasks SET asset_id = '10010000-0000-0000-0000-0000000000a3'
     WHERE id = '10010000-0000-0000-0000-000000000b01'$$,
  'a member writes a third asset');

-- 17
SELECT is(
  (SELECT string_agg(right(entity_id::text, 2) || ':' || position, ',' ORDER BY position, created_at, id)
     FROM public.task_items WHERE task_id = '10010000-0000-0000-0000-000000000b01' AND entity_type = 'asset'),
  'a1:0,a2:1,a3:2',
  'it lands at the end, after B (§3)');

-- 18
SELECT lives_ok(
  $$UPDATE public.tasks SET asset_id = NULL WHERE id = '10010000-0000-0000-0000-000000000b01'$$,
  'a member clears the column (it read A)');

-- 19
SELECT is(
  (SELECT string_agg(right(entity_id::text, 2) || ':' || position, ',' ORDER BY position, created_at, id)
       || '@' || (SELECT COALESCE(right(asset_id::text, 2), '-') FROM public.tasks WHERE id = '10010000-0000-0000-0000-000000000b01')
     FROM public.task_items WHERE task_id = '10010000-0000-0000-0000-000000000b01' AND entity_type = 'asset'),
  'a2:1,a3:2@a2',
  'clearing removes ONLY the item it named, nothing moves, and the column reads the next: B (§3)');

-- 20
SELECT lives_ok(
  $$UPDATE public.tasks SET scene_id = '10010000-0000-0000-0000-0000000000c1'
     WHERE id = '10010000-0000-0000-0000-000000000b01'$$,
  'a member writes a scene to a task with none');

-- 21
SELECT lives_ok(
  $$UPDATE public.tasks SET scene_id = '10010000-0000-0000-0000-0000000000c2'
     WHERE id = '10010000-0000-0000-0000-000000000b01'$$,
  'then another scene over it');

-- 22
SELECT is(
  (SELECT string_agg(right(entity_id::text, 2) || ':' || position, ',' ORDER BY position, created_at, id)
       || '@' || (SELECT right(scene_id::text, 2) FROM public.tasks WHERE id = '10010000-0000-0000-0000-000000000b01')
     FROM public.task_items WHERE task_id = '10010000-0000-0000-0000-000000000b01' AND entity_type = 'scene'),
  'c1:0,c2:1@c1',
  'a scene is added the same way: SC1 kept, SC2 after it, the column reads SC1 (§3)');

-- 23
SELECT lives_ok(
  $$UPDATE public.tasks SET asset_id = asset_id, scene_id = scene_id, shot_id = shot_id
     WHERE id = '10010000-0000-0000-0000-000000000b01'$$,
  'a whole-row re-send (the Timeline''s older editor sends all three on every save)');

-- 24
SELECT is(
  (SELECT string_agg(entity_type || ':' || right(entity_id::text, 2) || ':' || position, ',' ORDER BY entity_type, position, id)
     FROM public.task_items WHERE task_id = '10010000-0000-0000-0000-000000000b01'),
  'asset:a2:1,asset:a3:2,scene:c1:0,scene:c2:1',
  'a re-send of the same values changes no item (§3)');

-- 25
-- The end of a kind at INTEGER's largest: a member moves A3 there (position
-- is the one column a client may UPDATE), then adds one more.
UPDATE public.task_items SET position = 2147483647
 WHERE task_id = '10010000-0000-0000-0000-000000000b01' AND entity_type = 'asset'
   AND entity_id = '10010000-0000-0000-0000-0000000000a3';
SELECT lives_ok(
  $$UPDATE public.tasks SET asset_id = '10010000-0000-0000-0000-0000000000a5'
     WHERE id = '10010000-0000-0000-0000-000000000b01'$$,
  'a write after an item at INTEGER''s largest position lives (no overflow)');

-- 26
SELECT is(
  (SELECT position FROM public.task_items
    WHERE task_id = '10010000-0000-0000-0000-000000000b01' AND entity_type = 'asset'
      AND entity_id = '10010000-0000-0000-0000-0000000000a5'),
  2147483647,
  'and the new item is capped there: nothing overflows and nothing before it moves (§3)');


-- ═════════════════════════════════════════════════════════════════════════
-- reorder_task_items (0096 §6) and the copy (§4), as the same member
-- ═════════════════════════════════════════════════════════════════════════

-- 27
SELECT lives_ok(
  $$SELECT count(*) FROM public.reorder_task_items('10010000-0000-0000-0000-000000000b07', 'asset',
      ARRAY[(SELECT id FROM public.task_items WHERE task_id = '10010000-0000-0000-0000-000000000b07'
               AND entity_type = 'asset' AND entity_id = '10010000-0000-0000-0000-0000000000a2')]::uuid[])$$,
  'a member reorders T7''s assets, B first (an older app''s Move up)');

-- 28
SELECT is(
  (SELECT string_agg(right(entity_id::text, 2) || ':' || position, ',' ORDER BY position, created_at, id)
       || '@' || (SELECT right(asset_id::text, 2) FROM public.tasks WHERE id = '10010000-0000-0000-0000-000000000b07')
     FROM public.task_items WHERE task_id = '10010000-0000-0000-0000-000000000b07' AND entity_type = 'asset'),
  'a2:0,a1:1@a2',
  'the reorder still works, and the copy follows the new first item (§4)');


-- ═════════════════════════════════════════════════════════════════════════
-- Another project's asset, as the workspace admin who can see it
-- ═════════════════════════════════════════════════════════════════════════
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- 29
SELECT throws_ok(
  $$UPDATE public.tasks SET asset_id = '10010000-0000-0000-0000-0000000000a9'
     WHERE id = '10010000-0000-0000-0000-000000000b07'$$,
  '23503', NULL,
  'writing another project''s asset through the column is refused: the add goes through task_items'' composite key (§3)');

-- 30
SELECT is(
  (SELECT string_agg(right(entity_id::text, 2), ',' ORDER BY position, created_at, id)
     FROM public.task_items WHERE task_id = '10010000-0000-0000-0000-000000000b07' AND entity_type = 'asset'),
  'a2,a1',
  'and nothing was added or removed (§3)');


-- ═════════════════════════════════════════════════════════════════════════
-- tasks_select, arm by arm (§2; the 0062 lesson)
-- ═════════════════════════════════════════════════════════════════════════

-- 31 (the trashed project arm, through projects_select)
SELECT is(
  (SELECT count(*)::int FROM public.tasks WHERE id = '10010000-0000-0000-0000-000000000b08'),
  0,
  'a trashed project''s task is hidden, even from the workspace admin (§2: the project hop, 0014''s live arm)');

-- 32 (CONTROL for the privacy arm: the admin sees the private project's task)
SELECT is(
  (SELECT count(*)::int FROM public.tasks WHERE id = '10010000-0000-0000-0000-000000000bf1'),
  1,
  'CONTROL: the workspace admin sees the private project''s task (the privacy arm admits an admin)');

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 33
SELECT ok(
  public.soft_delete_row('tasks', '10010000-0000-0000-0000-000000000b05'),
  'a member trashes T5');

-- 34 (the trash arm)
SELECT is(
  (SELECT count(*)::int FROM public.tasks WHERE id = '10010000-0000-0000-0000-000000000b05'),
  0,
  'a trashed task is hidden (§2: deleted_at IS NULL)');

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

-- 35 (the privacy arm, through projects_select)
SELECT is(
  (SELECT count(*)::int FROM public.tasks WHERE id = '10010000-0000-0000-0000-000000000bf1'),
  0,
  'a workspace manager who did not create a private project does not see its task (§2: the project hop, 0072''s privacy arm)');

-- 36
SELECT is(
  (SELECT count(*)::int FROM public.tasks WHERE id = '10010000-0000-0000-0000-000000000b01'),
  1,
  'CONTROL: the same manager sees a public project''s task (the refusal above is the privacy arm)');

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 37
SELECT is(
  (SELECT count(*)::int FROM public.tasks WHERE id = '10010000-0000-0000-0000-000000000bf1'),
  1,
  'CONTROL: the private project''s creator sees its task');

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '22222222-2222-2222-2222-222222222222', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- 38 (the workspace arm)
SELECT is(
  (SELECT count(*)::int FROM public.tasks WHERE id::text LIKE '10010000-%'),
  0,
  'another workspace''s admin sees none of the fixture tasks (§2: the workspace arm)');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
SET LOCAL ROLE anon;

-- 39
SELECT throws_ok(
  $$SELECT count(*) FROM public.tasks$$,
  '42501', NULL,
  'anon cannot read tasks at all');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);

-- 40
SELECT is(
  (SELECT count(*)::int FROM public.tasks
    WHERE id IN ('10010000-0000-0000-0000-000000000b05', '10010000-0000-0000-0000-000000000b08',
                 '10010000-0000-0000-0000-000000000bf1')),
  3,
  'PRESENCE: the three hidden tasks exist (the zeros above are the policy, not a missing row)');


-- ═════════════════════════════════════════════════════════════════════════
-- Newly visible: an asset in the trash, hard-deleted, purged (§1, §2)
-- ═════════════════════════════════════════════════════════════════════════
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 41
SELECT ok(
  public.soft_delete_row('assets', '10010000-0000-0000-0000-0000000000a7'),
  'a member puts T2''s only asset in the trash');

-- 42
SELECT is(
  (SELECT count(*)::int FROM public.tasks WHERE id = '10010000-0000-0000-0000-000000000b02')
  || '/' || (SELECT count(*)::int FROM public.task_items WHERE task_id = '10010000-0000-0000-0000-000000000b02')
  || '/' || (SELECT count(*)::int FROM public.assets WHERE id = '10010000-0000-0000-0000-0000000000a7'),
  '1/1/0',
  'the task STAYS, its item row with it, while the asset itself is hidden (§2; 0034''s asset arm would have hidden the task)');

-- 43
SELECT ok(
  public.restore_soft_deleted('assets', '10010000-0000-0000-0000-0000000000a7'),
  'a member restores the asset');

-- 44
SELECT is(
  (SELECT count(*)::int FROM public.tasks WHERE id = '10010000-0000-0000-0000-000000000b02')
  || '/' || (SELECT right(entity_id::text, 2) FROM public.task_items WHERE task_id = '10010000-0000-0000-0000-000000000b02')
  || '/' || (SELECT right(asset_id::text, 2) FROM public.tasks WHERE id = '10010000-0000-0000-0000-000000000b02'),
  '1/a7/a7',
  'restored, nothing had changed: the item and the copy are where they were (the trash touches no task)');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);

-- 45
DELETE FROM public.assets WHERE id = '10010000-0000-0000-0000-0000000000a4';
SELECT is(
  (SELECT count(*)::int FROM public.tasks WHERE id = '10010000-0000-0000-0000-000000000b03'),
  1,
  'hard-deleting a task''s FIRST asset leaves the task (§1: ON DELETE SET NULL; 0034''s cascade is gone)');

-- 46
SELECT is(
  (SELECT string_agg(right(i.entity_id::text, 2), ',') || '@' || COALESCE(right(t.asset_id::text, 2), '-')
     FROM public.task_items i JOIN public.tasks t ON t.id = i.task_id
    WHERE i.task_id = '10010000-0000-0000-0000-000000000b03'
    GROUP BY t.asset_id),
  'a5@a5',
  'its other asset is kept and the copy moved to it, whichever cascade ran first (§1, §3, §4)');

-- 47
-- T4's asset a6 goes to the trash (as the runner: the trash RPC is the
-- client's door, the stamp is what the purge reads), 40 days ago, and the
-- nightly purge runs (0067's purge_soft_deleted, as the service side does).
UPDATE public.assets SET deleted_at = now() - INTERVAL '40 days'
 WHERE id = '10010000-0000-0000-0000-0000000000a6';
SELECT ok(
  public.purge_soft_deleted() >= 1,
  'the 30-day purge takes the expired asset');

-- 48
SELECT is(
  (SELECT count(*)::int FROM public.assets WHERE id = '10010000-0000-0000-0000-0000000000a6')
  || '/' || (SELECT count(*)::int FROM public.tasks WHERE id = '10010000-0000-0000-0000-000000000b04'),
  '0/1',
  'the asset is gone for good and its SET-ASIDE task survives (0090: never purged; 0067''s cascade took it before 0097)');

-- 49
SELECT is(
  (SELECT COALESCE(asset_id::text, 'null') || '/' || (set_aside_at IS NOT NULL)::text || '/' || right(scene_id::text, 2)
     FROM public.tasks WHERE id = '10010000-0000-0000-0000-000000000b04'),
  'null/true/c1',
  'with asset_id NULL, still set aside, its scene kept (§1)');

-- 50
SELECT is(
  (SELECT string_agg(entity_type || ':' || right(entity_id::text, 2), ',' ORDER BY entity_type)
     FROM public.task_items WHERE task_id = '10010000-0000-0000-0000-000000000b04'),
  'scene:c1',
  'and its other item is kept: only the purged asset''s item left');

-- 51
SELECT is(
  COALESCE(current_setting('wilson.task_items_sync', true), ''),
  '',
  'the sync''s setting is restored after every statement (§3, §4)');

-- 52
SELECT is(
  (SELECT count(*)::int
     FROM public.tasks t
     JOIN LATERAL (SELECT k.kind,
                          (SELECT i.entity_id FROM public.task_items i
                            WHERE i.task_id = t.id AND i.entity_type = k.kind
                            ORDER BY i.position, i.created_at, i.id LIMIT 1) AS first_item,
                          CASE k.kind WHEN 'asset' THEN t.asset_id WHEN 'scene' THEN t.scene_id ELSE t.shot_id END AS col
                     FROM (VALUES ('asset'), ('scene'), ('shot')) AS k(kind)) m ON true
    WHERE t.id::text LIKE '10010000-%'
      AND (m.col IS DISTINCT FROM m.first_item)),
  0,
  'after everything above, every fixture task''s column of each kind IS its first item in the stored order, or NULL with none (the copy, §4)');

SELECT * FROM finish();
ROLLBACK;
