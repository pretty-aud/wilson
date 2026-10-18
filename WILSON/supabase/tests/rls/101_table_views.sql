-- =============================================================================
-- 101_table_views.sql — migration 0098 (VW1c, 2026-10-17): custom table views'
-- and groupings' data — public.table_views and public.item_groupings.
--
-- The CI coverage guard maps BOTH tables here: table_views is in RLS_TABLES
-- with this file; item_groupings is in COVERED_BY → 101_table_views (93_bins'
-- shape — the guard demands a suite named exactly for each listed table).
--
-- What this pins (each probe names the 0098 section it holds to):
--   * Structure (§2–§7, §10): RLS enabled AND forced, four policies a table,
--     every arm named (the workspace, the membership, the project hop; every
--     write can_write_project), UPDATE's check equal to its USING; anon holds
--     nothing; the column grants exactly (an upsert has no column to stand
--     on); the revision sequence USAGE-only; every trigger attached; the
--     sweep SECURITY DEFINER and no client's; fn_realtime_broadcast names
--     EIGHTEEN tables once each, on exactly eighteen tables, 0098's body.
--   * Reading (Q1): a reviewer and a seatless member read a project's views;
--     another workspace, an inactive member and anon read nothing; a private
--     project's views are hidden from a manager who did not make it.
--   * Writing (Q2): an admin, a manager without a seat and a member write; a
--     reviewer, a seatless member of a staffed project, an inactive member and
--     another workspace's admin cannot; the stamps are the server's; a client
--     cannot send the stamps, the revision or (outside §10's isolation) the
--     workspace.
--   * The revision: a new one on insert and on every change of config, never
--     on a rename, a reorder or a save of the same config; a save from an old
--     revision writes nothing; a view made again with its id never repeats a
--     number. The pin keeps created_by and created_at on update.
--   * The CHECKs and the caps (200 views, 500 groupings a project and table).
--   * reorder_table_views (§8): the named views first, the rest after, dense,
--     no revision; refusals; a reviewer moves nothing; another table's view
--     is ignored.
--   * item_groupings (§3, §4): the set sorted and made distinct; unique per
--     (project, table, kind); the pairs; 1 to 100 ids; each id a live row of
--     its kind in the project, checked as the caller (another project's, a
--     trashed asset, an unknown id, the wrong kind refused).
--   * The sweep (§5): a member's scene delete shrinks a grouping; a grouping
--     shrunk to another's set is deleted; one left empty is deleted; the
--     trash changes nothing; the nightly purge runs whole through a
--     collision; a project's delete takes its groupings.
--   * PRIVACY and tenancy, each arm isolated (§6): with workspace_id granted
--     for the moment (rolled back), another workspace's admin is refused by
--     the project hop alone, and a manager who did not make a private project
--     by its privacy arm alone — with a CONTROL on the public project and the
--     creator's own insert.
--
-- Postgres-side reads are ALWAYS scoped to fixture ids — dev carries real
-- projects (S33, 439f702).
-- =============================================================================

BEGIN;

SELECT plan(118);

SELECT * FROM tests.rls_setup();

-- ── Extra fixtures ─────────────────────────────────────────────────────────
--   user_c  app_role 'user',    project_a REVIEWER  -> reads, no writes
--   user_d  app_role 'user',    project_a MEMBER    -> writes
--   user_e  app_role 'manager', no seat anywhere, NOT the private project's
--           creator -> writes project_a (the app role), never sees P
--   user_f  app_role 'user',    the private project's creator, seated MANAGER
--   user_g  app_role 'user',    NO seat on the staffed project_a -> refused
--   user_h  app_role 'admin',   INACTIVE in ws_a -> nothing
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
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('88888888-8888-8888-8888-888888888888', 'user_h@test.local',
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
  ('11111111-1111-1111-1111-111111111111','99999999-9999-9999-9999-999999999999','user','user_g','User G',true),
  ('11111111-1111-1111-1111-111111111111','88888888-8888-8888-8888-888888888888','admin','user_h','User H',false)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET app_role = EXCLUDED.app_role, is_active = EXCLUDED.is_active;

-- The private project P (created_by user_f: the privacy arm reads created_by)
-- and a public, unstaffed neighbour N in the same workspace.
INSERT INTO public.projects (id, workspace_id, title, is_private, created_by) VALUES
  ('aaaa1111-0000-0000-0000-000000000101', '11111111-1111-1111-1111-111111111111',
   'Private P101', true, 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  ('aaaa1111-0000-0000-0000-000000000102', '11111111-1111-1111-1111-111111111111',
   'Neighbour N101', false, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role)
VALUES
  ('aaaa1111-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1111-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1111-0000-0000-0000-000000000101', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
   '11111111-1111-1111-1111-111111111111', 'manager')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;

-- project_a's items. Assets a1–a6 (a5 in the trash; a6 for the purge),
-- 1b0–1b8 (the groupings' cap), scenes c1–c2, shots d1–d2 (in scene c1),
-- the level e1, the experience f1. N's asset 9a1; P's asset 8a1.
INSERT INTO public.assets (id, project_id, name) VALUES
  ('10100000-0000-0000-0000-0000000000a1', 'aaaa1111-0000-0000-0000-000000000001', 'A1'),
  ('10100000-0000-0000-0000-0000000000a2', 'aaaa1111-0000-0000-0000-000000000001', 'A2'),
  ('10100000-0000-0000-0000-0000000000a3', 'aaaa1111-0000-0000-0000-000000000001', 'A3'),
  ('10100000-0000-0000-0000-0000000000a4', 'aaaa1111-0000-0000-0000-000000000001', 'A4'),
  ('10100000-0000-0000-0000-0000000000a5', 'aaaa1111-0000-0000-0000-000000000001', 'A5 (trash)'),
  ('10100000-0000-0000-0000-0000000000a6', 'aaaa1111-0000-0000-0000-000000000001', 'A6 (purge)'),
  ('10100000-0000-0000-0000-0000000009a1', 'aaaa1111-0000-0000-0000-000000000102', 'Neighbour asset'),
  ('10100000-0000-0000-0000-0000000008a1', 'aaaa1111-0000-0000-0000-000000000101', 'Private asset');
INSERT INTO public.assets (id, project_id, name)
SELECT ('10100000-0000-0000-0000-0000000001b' || g)::uuid, 'aaaa1111-0000-0000-0000-000000000001', 'B' || g
  FROM generate_series(0, 8) AS g;
INSERT INTO public.scenes (id, project_id, name, scene_number) VALUES
  ('10100000-0000-0000-0000-0000000000c1', 'aaaa1111-0000-0000-0000-000000000001', 'SC1', 1),
  ('10100000-0000-0000-0000-0000000000c2', 'aaaa1111-0000-0000-0000-000000000001', 'SC2', 2);
INSERT INTO public.shots (id, project_id, scene_id, name, shot_number) VALUES
  ('10100000-0000-0000-0000-0000000000d1', 'aaaa1111-0000-0000-0000-000000000001',
   '10100000-0000-0000-0000-0000000000c1', 'SH1', 1),
  ('10100000-0000-0000-0000-0000000000d2', 'aaaa1111-0000-0000-0000-000000000001',
   '10100000-0000-0000-0000-0000000000c1', 'SH2', 2);
INSERT INTO public.levels (id, project_id, name) VALUES
  ('10100000-0000-0000-0000-0000000000e1', 'aaaa1111-0000-0000-0000-000000000001', 'L1');
INSERT INTO public.experiences (id, project_id, name) VALUES
  ('10100000-0000-0000-0000-0000000000f1', 'aaaa1111-0000-0000-0000-000000000001', 'X1');

-- Views, made as postgres (no JWT: the stamps stay NULL, the revision is
-- taken). project_a: tasks v01–v03, assets v04. P: v05. project_b: v06.
INSERT INTO public.table_views (id, project_id, table_key, name, position, config) VALUES
  ('10111111-0000-0000-0000-000000000001', 'aaaa1111-0000-0000-0000-000000000001', 'tasks', 'Shoot week', 0, '{"version":1}'),
  ('10111111-0000-0000-0000-000000000002', 'aaaa1111-0000-0000-0000-000000000001', 'tasks', 'Review', 1, '{"version":1}'),
  ('10111111-0000-0000-0000-000000000003', 'aaaa1111-0000-0000-0000-000000000001', 'tasks', 'Mine', 2, '{"version":1}'),
  ('10111111-0000-0000-0000-000000000004', 'aaaa1111-0000-0000-0000-000000000001', 'assets', 'Props', 5, '{"version":1}'),
  ('10111111-0000-0000-0000-000000000005', 'aaaa1111-0000-0000-0000-000000000101', 'tasks', 'Private view', 0, '{"version":1}'),
  ('10111111-0000-0000-0000-000000000006', 'bbbb2222-0000-0000-0000-000000000001', 'tasks', 'B view', 0, '{"version":1}');

-- The assets in the trash now (a5) — after the views, before the groupings
-- (as postgres the ids' check sees every row; a member's sees the trash's).
UPDATE public.assets SET deleted_at = now() WHERE id = '10100000-0000-0000-0000-0000000000a5';

-- Groupings, made as postgres (the pin sorts the sets).
INSERT INTO public.item_groupings (id, project_id, table_key, kind, entity_ids) VALUES
  ('10122222-0000-0000-0000-000000000001', 'aaaa1111-0000-0000-0000-000000000001', 'tasks', 'asset',
   ARRAY['10100000-0000-0000-0000-0000000000a2', '10100000-0000-0000-0000-0000000000a1']::uuid[]),
  ('10122222-0000-0000-0000-000000000002', 'aaaa1111-0000-0000-0000-000000000001', 'tasks', 'scene',
   ARRAY['10100000-0000-0000-0000-0000000000c1', '10100000-0000-0000-0000-0000000000c2']::uuid[]),
  ('10122222-0000-0000-0000-000000000003', 'aaaa1111-0000-0000-0000-000000000001', 'tasks', 'shot',
   ARRAY['10100000-0000-0000-0000-0000000000d1', '10100000-0000-0000-0000-0000000000d2']::uuid[]),
  ('10122222-0000-0000-0000-000000000004', 'aaaa1111-0000-0000-0000-000000000001', 'tasks', 'shot',
   ARRAY['10100000-0000-0000-0000-0000000000d1']::uuid[]),
  ('10122222-0000-0000-0000-000000000005', 'aaaa1111-0000-0000-0000-000000000001', 'tasks', 'level',
   ARRAY['10100000-0000-0000-0000-0000000000e1']::uuid[]),
  ('10122222-0000-0000-0000-000000000006', 'aaaa1111-0000-0000-0000-000000000001', 'tasks', 'asset',
   ARRAY['10100000-0000-0000-0000-0000000000a1', '10100000-0000-0000-0000-0000000000a4']::uuid[]),
  ('10122222-0000-0000-0000-000000000007', 'aaaa1111-0000-0000-0000-000000000001', 'tasks', 'asset',
   ARRAY['10100000-0000-0000-0000-0000000000a3', '10100000-0000-0000-0000-0000000000a6']::uuid[]),
  ('10122222-0000-0000-0000-000000000008', 'aaaa1111-0000-0000-0000-000000000001', 'tasks', 'asset',
   ARRAY['10100000-0000-0000-0000-0000000000a3']::uuid[]),
  ('10122222-0000-0000-0000-000000000009', 'aaaa1111-0000-0000-0000-000000000101', 'tasks', 'asset',
   ARRAY['10100000-0000-0000-0000-0000000008a1']::uuid[]),
  ('10122222-0000-0000-0000-00000000000a', 'aaaa1111-0000-0000-0000-000000000102', 'tasks', 'asset',
   ARRAY['10100000-0000-0000-0000-0000000009a1']::uuid[]);


-- ═════════════════════════════════════════════════════════════════════════
-- Structure (§2–§7, §10), as postgres
-- ═════════════════════════════════════════════════════════════════════════

-- 1
SELECT has_table('public', 'table_views', 'public.table_views exists (0098 §2)');
-- 2
SELECT has_table('public', 'item_groupings', 'public.item_groupings exists (0098 §3)');

-- 3
SELECT ok(
  (SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class
    WHERE oid IN ('public.table_views'::regclass, 'public.item_groupings'::regclass)),
  'both tables ENABLE and FORCE row level security (§6)');

-- 4
SELECT is(
  (SELECT string_agg(tablename || '.' || lower(cmd), ',' ORDER BY tablename, cmd) FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('table_views', 'item_groupings') AND permissive = 'PERMISSIVE'),
  'item_groupings.delete,item_groupings.insert,item_groupings.select,item_groupings.update,'
  || 'table_views.delete,table_views.insert,table_views.select,table_views.update',
  'four permissive policies a table, one per verb, none FOR ALL (§6)');

-- 5
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('table_views', 'item_groupings')
      AND position('current_workspace_id()' IN COALESCE(qual, '') || COALESCE(with_check, '')) > 0
      AND position('has_active_membership(workspace_id)' IN COALESCE(qual, '') || COALESCE(with_check, '')) > 0
      AND (COALESCE(qual, '') || COALESCE(with_check, '')) ~ ('FROM projects p\s+WHERE \(p\.id = ' || tablename || '\.project_id\)')
      AND (cmd = 'SELECT' OR position('can_write_project(project_id)' IN COALESCE(qual, '') || COALESCE(with_check, '')) > 0)),
  8,
  'every policy names the workspace, the membership and the project hop; every write can_write_project (§6, 0062)');

-- 6
SELECT ok(
  (SELECT bool_and(qual = with_check) FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('table_views', 'item_groupings') AND cmd = 'UPDATE'),
  'each UPDATE policy''s WITH CHECK is its USING (§6)');

-- 7
SELECT ok(
  NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
               WHERE table_schema = 'public' AND table_name IN ('table_views', 'item_groupings')
                 AND grantee IN ('anon', 'PUBLIC'))
  AND NOT EXISTS (SELECT 1 FROM information_schema.column_privileges
               WHERE table_schema = 'public' AND table_name IN ('table_views', 'item_groupings')
                 AND grantee IN ('anon', 'PUBLIC')),
  'anon and PUBLIC hold nothing on either table (§7)');

-- 8
SELECT is(
  (SELECT string_agg(column_name || ':' || privilege_type, ',' ORDER BY column_name, privilege_type)
     FROM information_schema.column_privileges
    WHERE table_schema = 'public' AND table_name = 'table_views' AND grantee = 'authenticated'
      AND privilege_type IN ('INSERT', 'UPDATE')),
  'config:INSERT,config:UPDATE,id:INSERT,name:INSERT,name:UPDATE,position:INSERT,position:UPDATE,'
  || 'project_id:INSERT,table_key:INSERT',
  'table_views: INSERT on exactly (id, project_id, table_key, name, position, config), UPDATE on exactly (name, position, config) — an upsert has nothing to stand on (§7)');

-- 9
SELECT is(
  (SELECT string_agg(column_name || ':' || privilege_type, ',' ORDER BY column_name, privilege_type)
     FROM information_schema.column_privileges
    WHERE table_schema = 'public' AND table_name = 'item_groupings' AND grantee = 'authenticated'
      AND privilege_type IN ('INSERT', 'UPDATE')),
  'entity_ids:INSERT,id:INSERT,kind:INSERT,project_id:INSERT,table_key:INSERT',
  'item_groupings: INSERT on exactly (id, project_id, table_key, kind, entity_ids), no UPDATE at all (§7)');

-- 10
SELECT ok(
  has_table_privilege('authenticated', 'public.table_views', 'SELECT')
  AND has_table_privilege('authenticated', 'public.table_views', 'DELETE')
  AND has_table_privilege('authenticated', 'public.item_groupings', 'SELECT')
  AND has_table_privilege('authenticated', 'public.item_groupings', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.table_views', 'TRUNCATE')
  AND NOT has_table_privilege('authenticated', 'public.item_groupings', 'TRUNCATE'),
  'authenticated SELECTs and DELETEs both tables whole, and truncates neither (§7)');

-- 11
SELECT ok(
  has_sequence_privilege('authenticated', 'public.table_views_revision_seq', 'USAGE')
  AND NOT has_sequence_privilege('authenticated', 'public.table_views_revision_seq', 'UPDATE')
  AND NOT has_sequence_privilege('authenticated', 'public.table_views_revision_seq', 'SELECT')
  AND NOT has_sequence_privilege('anon', 'public.table_views_revision_seq', 'USAGE'),
  'the revision sequence: USAGE for the pin''s nextval and nothing else, stated (§7, step 0 finding 11)');

-- 12
SELECT is(
  (SELECT string_agg(c.relname || '.' || tg.tgname, ',' ORDER BY c.relname, tg.tgname)
     FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    WHERE NOT tg.tgisinternal AND c.relname IN ('table_views', 'item_groupings')),
  'item_groupings.trg_item_groupings_audit,item_groupings.trg_item_groupings_cap,item_groupings.trg_item_groupings_pin,'
  || 'item_groupings.trg_item_groupings_populate_workspace,item_groupings.trg_item_groupings_realtime,'
  || 'item_groupings.trg_item_groupings_validate,'
  || 'table_views.trg_table_views_audit,table_views.trg_table_views_cap,table_views.trg_table_views_pin,'
  || 'table_views.trg_table_views_populate_workspace,table_views.trg_table_views_realtime',
  'every trigger attached, the BEFORE ones named to fire audit → cap → pin → populate_workspace → validate (§4)');

-- 13
SELECT is(
  (SELECT string_agg(c.relname::text, ',' ORDER BY c.relname::text)
     FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    WHERE NOT tg.tgisinternal AND tg.tgfoid = 'public.fn_item_groupings_forget()'::regprocedure),
  'assets,experiences,levels,scenes,shots',
  'the sweep is on the five item tables (§5)');

-- 14
SELECT ok(
  (SELECT prosecdef AND 'search_path=public' = ANY (proconfig) FROM pg_proc
    WHERE oid = 'public.fn_item_groupings_forget()'::regprocedure)
  AND NOT has_function_privilege('authenticated', 'public.fn_item_groupings_forget()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.fn_item_groupings_forget()', 'EXECUTE')
  AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname = 'public' AND p.prosecdef
                     AND p.proname IN ('fn_is_sorted_uuid_set', 'fn_table_views_cap', 'fn_item_groupings_cap',
                                       'fn_table_views_pin', 'fn_item_groupings_pin', 'fn_item_groupings_validate',
                                       'reorder_table_views', 'set_table_view_last')),
  'the sweep alone is SECURITY DEFINER (search_path pinned) and no client may run it; every other 0098 function runs as the caller (§4, §5, §8, §9)');

-- 15
SELECT ok(
  has_function_privilege('authenticated', 'public.reorder_table_views(uuid, text, uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.reorder_table_views(uuid, text, uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.fn_table_views_pin()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.fn_item_groupings_validate()', 'EXECUTE'),
  'reorder_table_views is authenticated-only; the trigger functions are no client''s (§4, §8)');

-- 16
SELECT is(
  (SELECT count(*)::int
     FROM (SELECT regexp_replace(regexp_replace(pg_get_functiondef('public.fn_realtime_broadcast()'::regprocedure),
                    '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g') AS body) b,
          unnest(ARRAY['projects', 'phases', 'assets', 'tasks', 'files', 'comments', 'task_dependencies',
                       'phase_dependencies', 'task_links', 'asset_versions', 'project_members', 'milestones',
                       'bins', 'bin_files', 'shot_takes', 'task_items', 'table_views', 'item_groupings']) AS t(name)
    WHERE (length(b.body) - length(replace(b.body, '''' || t.name || '''', ''))) / length('''' || t.name || '''') = 1),
  18,
  'fn_realtime_broadcast names each of the EIGHTEEN tables exactly once — no arm lost in the restatement (§10)');

-- 17
SELECT is(
  (SELECT string_agg(c.relname::text, ',' ORDER BY c.relname::text)
     FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid JOIN pg_class c ON c.oid = tg.tgrelid
    WHERE p.proname = 'fn_realtime_broadcast' AND NOT tg.tgisinternal),
  'asset_versions,assets,bin_files,bins,comments,files,item_groupings,milestones,phase_dependencies,'
  || 'phases,project_members,projects,shot_takes,table_views,task_dependencies,task_items,task_links,tasks',
  'the broadcast trigger is on exactly the eighteen project-scoped tables (§10)');

-- 18
SELECT is(
  (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.fn_realtime_broadcast()'::regprocedure),
  'e5abdcf2b8abce914416acb148144971',
  'fn_realtime_broadcast is 0098''s body, the one §0''s re-run guard names (§10)');

-- 19
SELECT ok(
  pg_get_functiondef('public.fn_realtime_broadcast()'::regprocedure) LIKE '%file_row_is_money((to_jsonb(NEW)%'
  AND pg_get_functiondef('public.fn_realtime_broadcast()'::regprocedure) LIKE '%file_row_is_money((to_jsonb(OLD)%'
  AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_realtime_broadcast()'::regprocedure),
  'fn_realtime_broadcast keeps 0088''s money arm for files (NEW and OLD) and stays SECURITY DEFINER (§10)');

-- 20
SELECT ok(
  (SELECT revision FROM public.table_views WHERE id = '10111111-0000-0000-0000-000000000001') > 0
  AND (SELECT count(DISTINCT revision) FROM public.table_views
        WHERE id::text LIKE '10111111-0000-0000-0000-00000000000%') = 6,
  'every view made takes a revision of its own from the sequence (§4b)');

-- 21
SELECT is(
  (SELECT entity_ids FROM public.item_groupings WHERE id = '10122222-0000-0000-0000-000000000001'),
  ARRAY['10100000-0000-0000-0000-0000000000a1', '10100000-0000-0000-0000-0000000000a2']::uuid[],
  'a grouping''s set is stored sorted (§4b)');


-- ═════════════════════════════════════════════════════════════════════════
-- Reading (Q1)
-- ═════════════════════════════════════════════════════════════════════════

-- A REVIEWER reads every view and grouping of the project.
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 22
SELECT is(
  (SELECT count(*)::int FROM public.table_views WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  4, 'a reviewer reads the project''s four views (Q1: shared with the team)');
-- 23
SELECT is(
  (SELECT count(*)::int FROM public.item_groupings WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  8, 'a reviewer reads the project''s eight groupings (Q-D2: saved for the project)');

-- A SEATLESS member of the staffed project reads them too.
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '99999999-9999-9999-9999-999999999999', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 24
SELECT is(
  (SELECT count(*)::int FROM public.table_views WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  4, 'a member with no seat on the staffed project reads its views');

-- Another workspace's ADMIN reads nothing of workspace A.
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '22222222-2222-2222-2222-222222222222', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- 25
SELECT is(
  (SELECT count(*)::int FROM public.table_views WHERE id::text LIKE '10111111-%'),
  1, 'another workspace''s admin reads only their own workspace''s view, never workspace A''s');
-- 26
SELECT is(
  (SELECT count(*)::int FROM public.item_groupings WHERE id::text LIKE '10122222-%'),
  0, 'another workspace''s admin reads no grouping of workspace A');

-- An INACTIVE member reads nothing.
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '88888888-8888-8888-8888-888888888888', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- 27
SELECT is(
  (SELECT count(*)::int FROM public.table_views WHERE id::text LIKE '10111111-%')
  + (SELECT count(*)::int FROM public.item_groupings WHERE id::text LIKE '10122222-%'),
  0, 'an inactive member reads no view and no grouping (the membership arm)');
-- 28
SELECT throws_ok(
  $$INSERT INTO public.table_views (project_id, table_key, name, position, config)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'tasks', 'Inactive', 9, '{}')$$,
  '42501', NULL,
  'an inactive member, an admin by the token, cannot save a view');

-- A MANAGER who did not make the private project neither reads its views
-- nor its groupings; its creator does (the privacy arm, through projects).
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

-- 29
SELECT is(
  (SELECT count(*)::int FROM public.table_views WHERE project_id = 'aaaa1111-0000-0000-0000-000000000101')
  + (SELECT count(*)::int FROM public.item_groupings WHERE project_id = 'aaaa1111-0000-0000-0000-000000000101'),
  0, 'a manager who did not make the private project reads none of its views or groupings');
-- 30
SELECT is(
  (SELECT count(*)::int FROM public.table_views WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  4, 'CONTROL: the same manager reads the public project''s views');

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 31
SELECT is(
  (SELECT count(*)::int FROM public.table_views WHERE project_id = 'aaaa1111-0000-0000-0000-000000000101')
  + (SELECT count(*)::int FROM public.item_groupings WHERE project_id = 'aaaa1111-0000-0000-0000-000000000101'),
  2, 'CONTROL: the private project''s creator reads its view and its grouping');


-- ═════════════════════════════════════════════════════════════════════════
-- Writing views (Q2)
-- ═════════════════════════════════════════════════════════════════════════

-- A project MEMBER.
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 32
SELECT lives_ok(
  $$INSERT INTO public.table_views (id, project_id, table_key, name, position, config)
    VALUES ('10111111-0000-0000-0000-000000000011', 'aaaa1111-0000-0000-0000-000000000001',
            'tasks', 'Member view', 3, '{"version":1,"layout":"table"}')$$,
  'a member saves a view for everyone (Q2), the workspace stamped by the server');
-- 33
SELECT ok(
  (SELECT created_by = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid
      AND updated_by = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid
      AND revised_by = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid
      AND revision > 0
      AND workspace_id = '11111111-1111-1111-1111-111111111111'::uuid
     FROM public.table_views WHERE id = '10111111-0000-0000-0000-000000000011'),
  'the new view''s stamps, revision and workspace are the server''s (§4b)');
-- 34
SELECT throws_ok(
  $$INSERT INTO public.table_views (project_id, table_key, name, position, config, created_by)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'tasks', 'Forged', 9, '{}', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')$$,
  '42501', NULL,
  'a client cannot send created_by (§7)');
-- 35
SELECT throws_ok(
  $$INSERT INTO public.table_views (project_id, table_key, name, position, config, revision)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'tasks', 'Forged', 9, '{}', 1)$$,
  '42501', NULL,
  'a client cannot send a revision (§7)');
-- 36
SELECT throws_ok(
  $$INSERT INTO public.table_views (project_id, workspace_id, table_key, name, position, config)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'tasks', 'Forged', 9, '{}')$$,
  '42501', NULL,
  'a client cannot send the workspace — the trigger stamps it (§7)');
-- 37
SELECT throws_ok(
  $$INSERT INTO public.table_views (id, project_id, table_key, name, position, config)
    VALUES ('10111111-0000-0000-0000-000000000001', 'aaaa1111-0000-0000-0000-000000000001', 'tasks', 'Upsert', 0, '{}')
    ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id, project_id = EXCLUDED.project_id, table_key = EXCLUDED.table_key,
      name = EXCLUDED.name, position = EXCLUDED.position, config = EXCLUDED.config$$,
  '42501', NULL,
  'an upsert as PostgREST sends it is refused: a view is made with insert and saved with update (§7)');
-- 38
SELECT throws_ok(
  $$UPDATE public.table_views SET revision = 1 WHERE id = '10111111-0000-0000-0000-000000000001'$$,
  '42501', NULL,
  'a client cannot write a revision (§7)');
-- 39
SELECT lives_ok(
  $$DELETE FROM public.table_views WHERE id = '10111111-0000-0000-0000-000000000011'$$,
  'a member deletes a view');
-- 40
SELECT is(
  (SELECT count(*)::int FROM public.table_views WHERE id = '10111111-0000-0000-0000-000000000011'),
  0, 'and it is gone');

-- A REVIEWER: reads, never writes.
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 41
SELECT throws_ok(
  $$INSERT INTO public.table_views (project_id, table_key, name, position, config)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'tasks', 'Reviewer view', 9, '{}')$$,
  '42501', NULL,
  'a reviewer cannot save a view (Q2, Q-F)');
-- 42
WITH u AS (
  UPDATE public.table_views SET name = 'Reviewer rename', config = '{"version":1,"x":1}'
   WHERE id = '10111111-0000-0000-0000-000000000001' RETURNING 1)
SELECT is(count(*)::int, 0, 'a reviewer''s update of a view writes nothing (the silent filter)') FROM u;
-- 43
WITH d AS (
  DELETE FROM public.table_views WHERE id = '10111111-0000-0000-0000-000000000001' RETURNING 1)
SELECT is(count(*)::int, 0, 'a reviewer''s delete of a view removes nothing') FROM d;

-- A SEATLESS member of the staffed project.
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '99999999-9999-9999-9999-999999999999', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 44
SELECT throws_ok(
  $$INSERT INTO public.table_views (project_id, table_key, name, position, config)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'tasks', 'Seatless view', 9, '{}')$$,
  '42501', NULL,
  'a member with no seat on a staffed project cannot save a view (can_write_project)');

-- Another workspace's ADMIN.
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '22222222-2222-2222-2222-222222222222', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- 45
SELECT throws_ok(
  $$INSERT INTO public.table_views (project_id, table_key, name, position, config)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'tasks', 'Theirs', 9, '{}')$$,
  '42501', NULL,
  'another workspace''s admin cannot save a view into workspace A');

-- A MANAGER without a seat writes the public project (her Q2: admins and
-- managers); the company ADMIN too.
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

-- 46
SELECT lives_ok(
  $$INSERT INTO public.table_views (id, project_id, table_key, name, position, config)
    VALUES ('10111111-0000-0000-0000-000000000012', 'aaaa1111-0000-0000-0000-000000000001',
            'tasks', 'Manager view', 3, '{}')$$,
  'a company manager with no seat saves a view on the project');

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- 47
SELECT lives_ok(
  $$INSERT INTO public.table_views (id, project_id, table_key, name, position, config)
    VALUES ('10111111-0000-0000-0000-000000000014', 'aaaa1111-0000-0000-0000-000000000001',
            'tasks', 'Admin view', 4, '{}')$$,
  'a company admin saves a view on the project');

-- 48
SELECT is(
  (SELECT name FROM public.table_views WHERE id = '10111111-0000-0000-0000-000000000001'),
  'Shoot week',
  'the reviewer''s update left the view as it was');


-- ═════════════════════════════════════════════════════════════════════════
-- The revision, the pin, the conditional save (§4b)
-- ═════════════════════════════════════════════════════════════════════════
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
SELECT set_config('t101.v1', (SELECT revision::text FROM public.table_views
                               WHERE id = '10111111-0000-0000-0000-000000000001'), true);

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 49
WITH u AS (
  UPDATE public.table_views SET config = '{"version":1,"sorts":[{"field":"title","dir":"asc"}]}'
   WHERE id = '10111111-0000-0000-0000-000000000001'
     AND revision = current_setting('t101.v1')::bigint
  RETURNING 1)
SELECT is(count(*)::int, 1, 'a save from the view''s revision writes (the conditional save)') FROM u;
-- 50
SELECT ok(
  (SELECT revision > current_setting('t101.v1')::bigint
      AND revised_by = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid
     FROM public.table_views WHERE id = '10111111-0000-0000-0000-000000000001'),
  'a change of config takes a new revision and names who made it (§4b)');
-- 51
WITH u AS (
  UPDATE public.table_views SET config = '{"version":1,"stale":true}'
   WHERE id = '10111111-0000-0000-0000-000000000001'
     AND revision = current_setting('t101.v1')::bigint
  RETURNING 1)
SELECT is(count(*)::int, 0, 'a save from the old revision writes nothing (changed meanwhile)') FROM u;

SELECT set_config('t101.v1b', (SELECT revision::text FROM public.table_views
                                WHERE id = '10111111-0000-0000-0000-000000000001'), true);
SELECT set_config('t101.v2', (SELECT revision::text FROM public.table_views
                               WHERE id = '10111111-0000-0000-0000-000000000002'), true);
UPDATE public.table_views SET name = 'Shoot week, renamed' WHERE id = '10111111-0000-0000-0000-000000000001';
UPDATE public.table_views SET position = 7 WHERE id = '10111111-0000-0000-0000-000000000002';
UPDATE public.table_views SET config = '{"version":1,"sorts":[{"field":"title","dir":"asc"}]}'
 WHERE id = '10111111-0000-0000-0000-000000000001';

-- 52
SELECT is(
  (SELECT revision FROM public.table_views WHERE id = '10111111-0000-0000-0000-000000000001'),
  current_setting('t101.v1b')::bigint,
  'a rename, and a save of the same config, keep the revision (§4b: only a change of settings is new)');
-- 53
SELECT ok(
  (SELECT revised_by = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid AND name = 'Shoot week, renamed'
     FROM public.table_views WHERE id = '10111111-0000-0000-0000-000000000001'),
  'the rename landed and revised_by is still who changed the settings');
-- 54
SELECT ok(
  (SELECT position = 7 AND revision = current_setting('t101.v2')::bigint AND revised_by IS NULL
     FROM public.table_views WHERE id = '10111111-0000-0000-0000-000000000002'),
  'a move keeps the revision and who made it (§4b)');

-- The pin, against a privileged writer that is signed in: created_by and
-- created_at cannot be rewritten.
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'role', 'authenticated')::text, true);
UPDATE public.table_views
   SET created_by = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', created_at = '2000-01-01T00:00:00Z'
 WHERE id = '10111111-0000-0000-0000-000000000002';

-- 55
SELECT ok(
  (SELECT created_by IS NULL AND created_at > '2001-01-01T00:00:00Z'::timestamptz
     FROM public.table_views WHERE id = '10111111-0000-0000-0000-000000000002'),
  'the pin keeps created_by and created_at on update, whoever writes (§4b; VW1''s trap 7)');

-- A view deleted and made again with its id (an undo) never repeats a number.
SELECT set_config('request.jwt.claims', '{}', true);
SELECT set_config('t101.v3', (SELECT revision::text FROM public.table_views
                               WHERE id = '10111111-0000-0000-0000-000000000003'), true);

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

DELETE FROM public.table_views WHERE id = '10111111-0000-0000-0000-000000000003';
-- 56
SELECT lives_ok(
  $$INSERT INTO public.table_views (id, project_id, table_key, name, position, config)
    VALUES ('10111111-0000-0000-0000-000000000003', 'aaaa1111-0000-0000-0000-000000000001',
            'tasks', 'Mine', 2, '{"version":1}')$$,
  'a deleted view is made again with its id (an undo of the delete)');
-- 57
SELECT ok(
  (SELECT revision > current_setting('t101.v3')::bigint FROM public.table_views
    WHERE id = '10111111-0000-0000-0000-000000000003'),
  'and it takes a revision no view ever had, so an old change for now cannot save over it (§2)');


-- ═════════════════════════════════════════════════════════════════════════
-- The CHECKs and the cap (§2, §4a), as the member
-- ═════════════════════════════════════════════════════════════════════════

-- 58
SELECT throws_ok(
  $$INSERT INTO public.table_views (project_id, table_key, name, position, config)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'tasks', '', 9, '{}')$$,
  '23514', NULL, 'an empty name is refused');
-- 59
SELECT throws_ok(
  $$INSERT INTO public.table_views (project_id, table_key, name, position, config)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'tasks', ' Padded', 9, '{}')$$,
  '23514', NULL, 'a name with a space at its start is refused (trimmed)');
-- 60
SELECT throws_ok(
  format($$INSERT INTO public.table_views (project_id, table_key, name, position, config)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'tasks', %L, 9, '{}')$$, repeat('x', 81)),
  '23514', NULL, 'an 81-character name is refused');
-- 61
SELECT lives_ok(
  format($$INSERT INTO public.table_views (project_id, table_key, name, position, config)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'tasks', %L, 9, '{}')$$, repeat('x', 80)),
  'CONTROL: an 80-character name is kept');
-- 62
SELECT throws_ok(
  $$INSERT INTO public.table_views (project_id, table_key, name, position, config)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'tasks', E'Two\nlines', 9, '{}')$$,
  '23514', NULL, 'a name with a control character is refused');
-- 63
SELECT throws_ok(
  $$INSERT INTO public.table_views (project_id, table_key, name, position, config)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'budget', 'Budget view', 9, '{}')$$,
  '23514', NULL, 'a table with no views (budget) is refused');
-- 64
SELECT throws_ok(
  $$INSERT INTO public.table_views (project_id, table_key, name, position, config)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'tasks', 'Negative', -1, '{}')$$,
  '23514', NULL, 'a negative position is refused');
-- 65
SELECT throws_ok(
  $$INSERT INTO public.table_views (project_id, table_key, name, position, config)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'tasks', 'Array', 9, '[1,2]')$$,
  '23514', NULL, 'a config that is not an object is refused');
-- 66
SELECT throws_ok(
  $$INSERT INTO public.table_views (project_id, table_key, name, position, config)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'tasks', 'Huge', 9,
            jsonb_build_object('pad', repeat('x', 33000)))$$,
  '23514', NULL, 'a config over 32 KB is refused');

-- The cap: 200 views on the Scenes table of project_a, made as postgres.
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO public.table_views (project_id, table_key, name, position, config)
SELECT 'aaaa1111-0000-0000-0000-000000000001', 'scenes', 'Scenes ' || g, g, '{}'::jsonb
  FROM generate_series(0, 199) AS g;

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 67
SELECT throws_ok(
  $$INSERT INTO public.table_views (project_id, table_key, name, position, config)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'scenes', 'The 201st', 200, '{}')$$,
  '54000', NULL, 'a project''s table holds at most 200 views; the 201st is refused in words (§4a)');
-- 68
SELECT lives_ok(
  $$INSERT INTO public.table_views (project_id, table_key, name, position, config)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'shots', 'Shots view', 0, '{}')$$,
  'CONTROL: the cap is per table — the Shots table still takes one');


-- ═════════════════════════════════════════════════════════════════════════
-- reorder_table_views (§8), as the member
-- ═════════════════════════════════════════════════════════════════════════
-- project_a's Tasks views now: v01 (0), v03 (2), v12 (3), v14 (4), v02 (7),
-- and the 80-character one (9).
SELECT set_config('t101.v1c', (SELECT revision::text FROM public.table_views
                                WHERE id = '10111111-0000-0000-0000-000000000001'), true);

-- 69
SELECT is(
  (SELECT count(*)::int FROM public.reorder_table_views('aaaa1111-0000-0000-0000-000000000001', 'tasks',
     ARRAY['10111111-0000-0000-0000-000000000003', '10111111-0000-0000-0000-000000000001',
           '10111111-0000-0000-0000-000000000004']::uuid[])),
  6,
  'a reorder returns the six rows it moved (the Assets view it names is ignored)');
-- 70
SELECT is(
  (SELECT string_agg(right(id::text, 2), ',' ORDER BY position) FROM public.table_views
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001' AND table_key = 'tasks'),
  '03,01,12,14,02,' || (SELECT right(id::text, 2) FROM public.table_views
                          WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001' AND table_key = 'tasks'
                            AND char_length(name) = 80),
  'the named views first in the order given, every other view after in its own order, dense (§8)');
-- 71
SELECT ok(
  (SELECT array_agg(position ORDER BY position) = ARRAY[0, 1, 2, 3, 4, 5] FROM public.table_views
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001' AND table_key = 'tasks')
  AND (SELECT position FROM public.table_views WHERE id = '10111111-0000-0000-0000-000000000004') = 5,
  'positions are dense from 0, and the Assets view named in a Tasks reorder kept its place');
-- 72
SELECT is(
  (SELECT revision FROM public.table_views WHERE id = '10111111-0000-0000-0000-000000000001'),
  current_setting('t101.v1c')::bigint,
  'a reorder never makes a new revision (§8)');
-- 73
SELECT throws_ok(
  $$SELECT * FROM public.reorder_table_views('aaaa1111-0000-0000-0000-000000000001', 'budget', ARRAY[]::uuid[])$$,
  '22023', NULL, 'an unknown table is refused');
-- 74
SELECT throws_ok(
  $$SELECT * FROM public.reorder_table_views('aaaa1111-0000-0000-0000-000000000001', 'tasks',
      ARRAY['10111111-0000-0000-0000-000000000001', '10111111-0000-0000-0000-000000000001']::uuid[])$$,
  '22023', NULL, 'a view named twice is refused');
-- 75
SELECT throws_ok(
  $$SELECT * FROM public.reorder_table_views('aaaa1111-0000-0000-0000-000000000001', 'tasks',
      ARRAY['10111111-0000-0000-0000-000000000001', NULL]::uuid[])$$,
  '22023', NULL, 'an empty view id is refused');

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 76
SELECT is(
  (SELECT count(*)::int FROM public.reorder_table_views('aaaa1111-0000-0000-0000-000000000001', 'tasks',
     ARRAY['10111111-0000-0000-0000-000000000002']::uuid[])),
  0, 'a reviewer''s reorder moves nothing (the policies decide, SECURITY INVOKER)');
-- 77
SELECT is(
  (SELECT position FROM public.table_views WHERE id = '10111111-0000-0000-0000-000000000002'),
  4, 'and the view the reviewer named is where it was');


-- ═════════════════════════════════════════════════════════════════════════
-- Groupings (§3, §4), as the member
-- ═════════════════════════════════════════════════════════════════════════
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 78
SELECT lives_ok(
  $$INSERT INTO public.item_groupings (id, project_id, table_key, kind, entity_ids)
    VALUES ('10122222-0000-0000-0000-000000000011', 'aaaa1111-0000-0000-0000-000000000001', 'tasks', 'asset',
            ARRAY['10100000-0000-0000-0000-0000000000a3', '10100000-0000-0000-0000-0000000000a2',
                  '10100000-0000-0000-0000-0000000000a3']::uuid[])$$,
  'a member makes a grouping (Q-D2)');
-- 79
SELECT ok(
  (SELECT entity_ids = ARRAY['10100000-0000-0000-0000-0000000000a2', '10100000-0000-0000-0000-0000000000a3']::uuid[]
      AND created_by = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid
      AND workspace_id = '11111111-1111-1111-1111-111111111111'::uuid
     FROM public.item_groupings WHERE id = '10122222-0000-0000-0000-000000000011'),
  'its set is stored sorted with the repeat dropped, its stamps the server''s (§4b)');
-- 80
SELECT throws_ok(
  $$INSERT INTO public.item_groupings (project_id, table_key, kind, entity_ids)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'tasks', 'asset',
            ARRAY['10100000-0000-0000-0000-0000000000a3', '10100000-0000-0000-0000-0000000000a2']::uuid[])$$,
  '23505', NULL, 'the same set twice for one table and kind is refused, in any order (§3)');
-- 81
SELECT throws_ok(
  $$INSERT INTO public.item_groupings (project_id, table_key, kind, entity_ids)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'assets', 'asset',
            ARRAY['10100000-0000-0000-0000-0000000000a1']::uuid[])$$,
  '23514', NULL, 'the Assets table cannot be grouped by assets (§4.11''s pairs)');
-- 82
SELECT throws_ok(
  $$INSERT INTO public.item_groupings (project_id, table_key, kind, entity_ids)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'levels', 'scene',
            ARRAY['10100000-0000-0000-0000-0000000000c1']::uuid[])$$,
  '23514', NULL, 'the Levels table cannot be grouped by scenes (§4.11''s pairs)');
-- 83
SELECT throws_ok(
  $$INSERT INTO public.item_groupings (project_id, table_key, kind, entity_ids)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'tasks', 'asset', ARRAY[]::uuid[])$$,
  '23514', NULL, 'an empty set is refused');
-- 84
SELECT throws_ok(
  $$INSERT INTO public.item_groupings (project_id, table_key, kind, entity_ids)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'tasks', 'asset',
            ARRAY['10100000-0000-0000-0000-0000000000a1', NULL]::uuid[])$$,
  '23514', NULL, 'a set holding an empty id is refused, never silently reshaped');
-- 85
SELECT throws_ok(
  $$INSERT INTO public.item_groupings (project_id, table_key, kind, entity_ids)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'tasks', 'asset',
            ARRAY['10100000-0000-0000-0000-0000000009a1']::uuid[])$$,
  '23503', NULL, 'another project''s asset is refused (the ids'' check, §4c)');
-- 86
SELECT throws_ok(
  $$INSERT INTO public.item_groupings (project_id, table_key, kind, entity_ids)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'tasks', 'asset',
            ARRAY['10100000-0000-0000-0000-0000000000a1', '10100000-0000-0000-0000-0000000000a5']::uuid[])$$,
  '23503', NULL, 'an asset in the trash is refused (checked as the caller)');
-- 87
SELECT throws_ok(
  $$INSERT INTO public.item_groupings (project_id, table_key, kind, entity_ids)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'tasks', 'asset',
            ARRAY['10100000-0000-0000-0000-00000000ffff']::uuid[])$$,
  '23503', NULL, 'an unknown id is refused');
-- 88
SELECT throws_ok(
  $$INSERT INTO public.item_groupings (project_id, table_key, kind, entity_ids)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'tasks', 'asset',
            ARRAY['10100000-0000-0000-0000-0000000000c1']::uuid[])$$,
  '23503', NULL, 'a scene named as an asset is refused (each id a row of its own kind)');
-- 89
SELECT lives_ok(
  $$INSERT INTO public.item_groupings (project_id, table_key, kind, entity_ids)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'assets', 'scene',
            ARRAY['10100000-0000-0000-0000-0000000000c1']::uuid[])$$,
  'CONTROL: the Assets table grouped by a scene of the project is kept');
-- 90
SELECT throws_ok(
  $$UPDATE public.item_groupings SET entity_ids = ARRAY['10100000-0000-0000-0000-0000000000a1']::uuid[]
     WHERE id = '10122222-0000-0000-0000-000000000011'$$,
  '42501', NULL, 'a grouping cannot be edited — it is made and removed whole (§7)');
-- 91
SELECT throws_ok(
  $$INSERT INTO public.item_groupings (id, project_id, table_key, kind, entity_ids)
    VALUES ('10122222-0000-0000-0000-000000000011', 'aaaa1111-0000-0000-0000-000000000001', 'tasks', 'asset',
            ARRAY['10100000-0000-0000-0000-0000000000a1']::uuid[])
    ON CONFLICT (id) DO UPDATE SET entity_ids = EXCLUDED.entity_ids$$,
  '42501', NULL, 'an upsert of a grouping is refused (§7)');

-- 100 ids at most: 101 assets made as postgres.
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO public.assets (id, project_id, name)
SELECT ('10100000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid, 'aaaa1111-0000-0000-0000-000000000001', 'Many ' || g
  FROM generate_series(1, 101) AS g;

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 92
SELECT throws_ok(
  $$INSERT INTO public.item_groupings (project_id, table_key, kind, entity_ids)
    SELECT 'aaaa1111-0000-0000-0000-000000000001', 'tasks', 'asset',
           ARRAY(SELECT ('10100000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid FROM generate_series(1, 101) AS g)$$,
  '23514', NULL, 'a grouping of 101 items is refused (§3: at most 100)');
-- 93
SELECT lives_ok(
  $$INSERT INTO public.item_groupings (project_id, table_key, kind, entity_ids)
    SELECT 'aaaa1111-0000-0000-0000-000000000001', 'tasks', 'asset',
           ARRAY(SELECT ('10100000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid FROM generate_series(1, 100) AS g)$$,
  'CONTROL: a grouping of 100 items is kept');

-- The reviewer and the seatless member.
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 94
SELECT throws_ok(
  $$INSERT INTO public.item_groupings (project_id, table_key, kind, entity_ids)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'tasks', 'asset',
            ARRAY['10100000-0000-0000-0000-0000000000a4']::uuid[])$$,
  '42501', NULL, 'a reviewer cannot make a grouping (Q-F)');
-- 95
WITH d AS (
  DELETE FROM public.item_groupings WHERE id = '10122222-0000-0000-0000-000000000001' RETURNING 1)
SELECT is(count(*)::int, 0, 'a reviewer''s removal of a grouping removes nothing') FROM d;

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '99999999-9999-9999-9999-999999999999', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 96
SELECT throws_ok(
  $$INSERT INTO public.item_groupings (project_id, table_key, kind, entity_ids)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'tasks', 'asset',
            ARRAY['10100000-0000-0000-0000-0000000000a4']::uuid[])$$,
  '42501', NULL, 'a member with no seat on a staffed project cannot make a grouping');

-- The groupings' cap: 500 on the Levels table of project_a (distinct
-- subsets of the nine B assets), made as postgres.
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO public.item_groupings (project_id, table_key, kind, entity_ids)
SELECT 'aaaa1111-0000-0000-0000-000000000001', 'levels', 'asset',
       ARRAY(SELECT ('10100000-0000-0000-0000-0000000001b' || b)::uuid
               FROM generate_series(0, 8) AS b WHERE (g >> b) & 1 = 1)
  FROM generate_series(1, 500) AS g;

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 97
SELECT throws_ok(
  $$INSERT INTO public.item_groupings (project_id, table_key, kind, entity_ids)
    SELECT 'aaaa1111-0000-0000-0000-000000000001', 'levels', 'asset',
           ARRAY(SELECT ('10100000-0000-0000-0000-0000000001b' || b)::uuid
                   FROM generate_series(0, 8) AS b WHERE (501 >> b) & 1 = 1)$$,
  '54000', NULL, 'a project''s table holds at most 500 groupings; the 501st is refused in words (§4a)');
-- 98
SELECT lives_ok(
  $$INSERT INTO public.item_groupings (project_id, table_key, kind, entity_ids)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'experiences', 'asset',
            ARRAY['10100000-0000-0000-0000-0000000000a1']::uuid[])$$,
  'CONTROL: the cap is per table — the Experiences table still takes one');
-- 99
SELECT lives_ok(
  $$DELETE FROM public.item_groupings WHERE id = '10122222-0000-0000-0000-000000000011'$$,
  'a member removes a grouping (Q-D5)');


-- ═════════════════════════════════════════════════════════════════════════
-- The sweep (§5): an item deleted for good leaves its groupings
-- ═════════════════════════════════════════════════════════════════════════

-- 100
SELECT lives_ok(
  $$DELETE FROM public.scenes WHERE id = '10100000-0000-0000-0000-0000000000c2'$$,
  '🚨 a MEMBER deletes a scene a grouping names — the sweep runs as its owner, so the delete is not refused');
-- 101
SELECT lives_ok(
  $$DELETE FROM public.shots WHERE id = '10100000-0000-0000-0000-0000000000d2'$$,
  'a member deletes a shot whose grouping would shrink to another grouping''s set');
-- 102
SELECT lives_ok(
  $$DELETE FROM public.levels WHERE id = '10100000-0000-0000-0000-0000000000e1'$$,
  'a member deletes the only level a grouping names');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);

-- 103
SELECT is(
  (SELECT entity_ids FROM public.item_groupings WHERE id = '10122222-0000-0000-0000-000000000002'),
  ARRAY['10100000-0000-0000-0000-0000000000c1']::uuid[],
  'the scene left the grouping that named it; the grouping stays with the rest (§5)');
-- 104
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.item_groupings WHERE id = '10122222-0000-0000-0000-000000000003')
  AND (SELECT entity_ids FROM public.item_groupings WHERE id = '10122222-0000-0000-0000-000000000004')
      = ARRAY['10100000-0000-0000-0000-0000000000d1']::uuid[],
  'a grouping shrunk to another grouping''s set is deleted, the other kept (§5, step 0 finding 2)');
-- 105
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.item_groupings WHERE id = '10122222-0000-0000-0000-000000000005'),
  'a grouping left with no items is deleted (§5)');

-- The trash changes nothing (her Q-N4: hidden, back on restore).
UPDATE public.assets SET deleted_at = now() WHERE id = '10100000-0000-0000-0000-0000000000a4';
-- 106
SELECT is(
  (SELECT entity_ids FROM public.item_groupings WHERE id = '10122222-0000-0000-0000-000000000006'),
  ARRAY['10100000-0000-0000-0000-0000000000a1', '10100000-0000-0000-0000-0000000000a4']::uuid[],
  'an asset put in the trash stays named: the client hides the grouping while it is there (§5.2)');

-- The nightly purge, scoped to this suite: a6 went to the trash 101 years
-- ago and the purge keeps 100 years, so no real row of dev's is touched.
-- Its grouping {a3, a6} shrinks to the set of {a3}: the collision runs
-- INSIDE the purge, which must not roll back whole.
UPDATE public.assets SET deleted_at = now() - interval '101 years' WHERE id = '10100000-0000-0000-0000-0000000000a6';
-- 107
SELECT lives_ok(
  $$SELECT public.purge_soft_deleted(interval '100 years')$$,
  '🚨 the nightly purge runs through a grouping collision (step 0 finding 2)');
-- 108
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.assets WHERE id = '10100000-0000-0000-0000-0000000000a6')
  AND NOT EXISTS (SELECT 1 FROM public.item_groupings WHERE id = '10122222-0000-0000-0000-000000000007')
  AND (SELECT entity_ids FROM public.item_groupings WHERE id = '10122222-0000-0000-0000-000000000008')
      = ARRAY['10100000-0000-0000-0000-0000000000a3']::uuid[],
  'the purged asset is gone, its grouping deleted as a repeat of {a3}, which stays (§5)');

-- A project's delete takes its groupings by its own key (the sweep stands
-- down while the project goes).
-- 109
SELECT lives_ok(
  $$DELETE FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000102'$$,
  'a project with groupings and items is deleted');
-- 110
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.item_groupings WHERE id = '10122222-0000-0000-0000-00000000000a'),
  'and its groupings went with it');


-- ═════════════════════════════════════════════════════════════════════════
-- PRIVACY and tenancy, each arm isolated (§6)
-- ═════════════════════════════════════════════════════════════════════════
-- workspace_id is granted for the moment (this file rolls back), so the
-- stamping trigger cannot refuse for the wrong reason: each refusal below is
-- the policy's project hop alone.
GRANT INSERT (workspace_id) ON public.table_views TO authenticated;

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '22222222-2222-2222-2222-222222222222', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- 111
SELECT throws_ok(
  $$INSERT INTO public.table_views (project_id, workspace_id, table_key, name, position, config)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'tasks', 'Across', 9, '{}')$$,
  '42501', NULL,
  'another workspace''s admin, sending their own workspace, is refused by the project hop alone');

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

-- 112
SELECT throws_ok(
  $$INSERT INTO public.table_views (project_id, workspace_id, table_key, name, position, config)
    VALUES ('aaaa1111-0000-0000-0000-000000000101', '11111111-1111-1111-1111-111111111111', 'tasks', 'Peek', 9, '{}')$$,
  '42501', NULL,
  '🚨 a manager who did not make the private project cannot save a view into it, workspace sent (the privacy arm)');
-- 113
SELECT lives_ok(
  $$INSERT INTO public.table_views (project_id, workspace_id, table_key, name, position, config)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'tasks', 'Sent', 9, '{}')$$,
  'CONTROL: the same insert into the public project, workspace sent, is kept');
-- 114
WITH u AS (
  UPDATE public.table_views SET name = 'Peeked' WHERE id = '10111111-0000-0000-0000-000000000005' RETURNING 1)
SELECT is(count(*)::int, 0, 'the manager''s update of the private project''s view writes nothing') FROM u;
-- 115
SELECT throws_ok(
  $$INSERT INTO public.item_groupings (project_id, table_key, kind, entity_ids)
    VALUES ('aaaa1111-0000-0000-0000-000000000101', 'tasks', 'asset',
            ARRAY['10100000-0000-0000-0000-0000000008a1']::uuid[])$$,
  '23503', NULL,
  'nor make a grouping there: its asset is not the caller''s to name (refused before the policy is asked)');

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 116
SELECT lives_ok(
  $$INSERT INTO public.table_views (project_id, table_key, name, position, config)
    VALUES ('aaaa1111-0000-0000-0000-000000000101', 'tasks', 'Creator''s view', 1, '{}')$$,
  'CONTROL: the private project''s creator saves a view into it');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
REVOKE INSERT (workspace_id) ON public.table_views FROM authenticated;

-- 117
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.table_views', 'workspace_id', 'INSERT')
  AND (SELECT name FROM public.table_views WHERE id = '10111111-0000-0000-0000-000000000005') = 'Private view',
  'the moment''s grant is gone, and the private view is as it was');

-- ═════════════════════════════════════════════════════════════════════════
-- anon
-- ═════════════════════════════════════════════════════════════════════════
SET LOCAL ROLE anon;

-- 118
SELECT throws_ok(
  $$SELECT count(*) FROM public.table_views$$,
  '42501', NULL, 'anon cannot read views at all');

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
