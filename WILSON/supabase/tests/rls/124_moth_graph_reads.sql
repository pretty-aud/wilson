-- =============================================================================
-- 124_moth_graph_reads.sql — M.O.T.H. Session 2 (MO2), what the graph reads besides files and folders (0122).
--
-- A. Who may call, and as whom it runs.
-- B. The two gates, for the seven new kinds: each is its project's, the trash keeps it out, a personal
--    space is its owner's alone (no admin leg), a private project its creator's and admins', another company
--    nothing, the same answer as for an id that does not exist. Writes as the project's own rule says.
--    0124 (MO3, MO2-09): a phase or a task set aside by its bid version is no target, to read or to write.
-- C. A project's items, in one answer: exactly the live ones (none trashed, gone or set aside by a bid version),
--    a phase's parent phase and a shot's scene, a name cut short, and whether the answer was cut.
-- D. A project's links between items and folders: exactly the stored relationships between two live ends. A
--    trashed or set-aside end, an id an asset's array still holds after its row went, and an entity folder under
--    a locked folder give no line.
-- E. What each file is filed against, and who last changed it, a page at a time: only for a file Moth shows, and
--    each item only when it is a live item of the same project.
-- F. What MO2's planted breakages found unprobed: ids of the wrong kind, a kind the gate does not know, every
--    new kind written by a writer and none by a reviewer, a phase's name cut, an entity folder of a trashed asset.
--
-- Fixture ids: projects aaaa1240-…, everything else 12400000-…
-- user_a (rls_setup) is the admin; user_c a plain member seated on P and creator of private X; user_d a
-- workspace manager; user_e has a personal space S; user_r sits on P as its reviewer; user_n has left;
-- user_b is the other company's admin.
-- =============================================================================

BEGIN;

SELECT plan(87);

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
  ('11111111-1111-1111-1111-111111111111', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'user', 'user_n', 'User N', false)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET is_active = EXCLUDED.is_active, app_role = EXCLUDED.app_role;

CREATE FUNCTION public.t124_as(p_user uuid, p_role text, p_ws uuid DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_role))::text, true);
END;
$f$;
CREATE FUNCTION public.t124_a() RETURNS void LANGUAGE sql AS $f$ SELECT public.t124_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin') $f$;
CREATE FUNCTION public.t124_b() RETURNS void LANGUAGE sql AS $f$ SELECT public.t124_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222') $f$;
CREATE FUNCTION public.t124_c() RETURNS void LANGUAGE sql AS $f$ SELECT public.t124_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user') $f$;
CREATE FUNCTION public.t124_d() RETURNS void LANGUAGE sql AS $f$ SELECT public.t124_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager') $f$;
CREATE FUNCTION public.t124_e() RETURNS void LANGUAGE sql AS $f$ SELECT public.t124_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user') $f$;
CREATE FUNCTION public.t124_r() RETURNS void LANGUAGE sql AS $f$ SELECT public.t124_as('99999999-9999-9999-9999-999999999999', 'user') $f$;
CREATE FUNCTION public.t124_n() RETURNS void LANGUAGE sql AS $f$ SELECT public.t124_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'user') $f$;

-- Every line of a project, one string, in the read's own order; every item, likewise; one item's object.
CREATE FUNCTION public.t124_links(p uuid) RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT COALESCE(string_agg((l ->> 'link') || ':' || right(l ->> 'source_id', 3) || '>' || right(l ->> 'target_id', 3), ' '
                             ORDER BY l ->> 'link', l ->> 'source_id', l ->> 'target_id'), '')
    FROM jsonb_array_elements(public.moth_project_links(p) -> 'links') l
$f$;
CREATE FUNCTION public.t124_nlinks(p uuid) RETURNS integer LANGUAGE sql STABLE AS $f$
  SELECT jsonb_array_length(public.moth_project_links(p) -> 'links')
$f$;
CREATE FUNCTION public.t124_items(p uuid) RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT COALESCE(string_agg((i ->> 'kind') || ':' || right(i ->> 'id', 3), ' ' ORDER BY i ->> 'kind', i ->> 'id'), '')
    FROM jsonb_array_elements(public.moth_project_items(p) -> 'items') i
$f$;
CREATE FUNCTION public.t124_item(p uuid, id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $f$
  SELECT i FROM jsonb_array_elements(public.moth_project_items(p) -> 'items') i WHERE i ->> 'id' = id::text
$f$;
CREATE FUNCTION public.t124_facts(p uuid) RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT COALESCE(string_agg(right(f.file_id::text, 3) || '['
           || concat_ws(',', 'p' || right(f.phase_id::text, 3), 'a' || right(f.asset_id::text, 3), 't' || right(f.task_id::text, 3),
                        's' || right(f.scene_id::text, 3), 'h' || right(f.shot_id::text, 3), 'l' || right(f.level_id::text, 3),
                        'e' || right(f.experience_id::text, 3)) || ']', ' ' ORDER BY f.file_id), '')
    FROM public.moth_project_file_facts(p) f
$f$;

-- ── Fixtures (as the database, with the admin's claims for the audit stamps) ──────────────────
SELECT public.t124_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1240-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Salt Hours', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL);
SELECT public.t124_c();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1240-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Private', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true, NULL);
SELECT public.t124_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1240-0000-0000-0000-0000000000e0', '11111111-1111-1111-1111-111111111111', 'Personal space', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');

INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1240-0000-0000-0000-00000000000a', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1240-0000-0000-0000-00000000000a', '99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'reviewer')
ON CONFLICT DO NOTHING;

-- P: phases 001 (live), 002 (its child), 003 (trashed), 004 (child of the trashed one).
INSERT INTO public.phases (id, project_id, name) VALUES
  ('12400000-0000-0000-0000-000000000001', 'aaaa1240-0000-0000-0000-00000000000a', 'Pre'),
  ('12400000-0000-0000-0000-000000000003', 'aaaa1240-0000-0000-0000-00000000000a', 'Gone');
INSERT INTO public.phases (id, project_id, name, parent_phase_id) VALUES
  ('12400000-0000-0000-0000-000000000002', 'aaaa1240-0000-0000-0000-00000000000a', 'Pre: boards', '12400000-0000-0000-0000-000000000001'),
  ('12400000-0000-0000-0000-000000000004', 'aaaa1240-0000-0000-0000-00000000000a', 'Under gone', '12400000-0000-0000-0000-000000000003');
UPDATE public.phases SET deleted_at = now() WHERE id = '12400000-0000-0000-0000-000000000003';

-- Scenes 011 and 012 (012 goes, leaving its id in an asset's array), shot 021 in 011, level 031, experience 041.
INSERT INTO public.scenes (id, project_id, name, scene_number) VALUES
  ('12400000-0000-0000-0000-000000000011', 'aaaa1240-0000-0000-0000-00000000000a', 'Harbour', 1),
  ('12400000-0000-0000-0000-000000000012', 'aaaa1240-0000-0000-0000-00000000000a', 'Cut', 2);
INSERT INTO public.shots (id, project_id, scene_id, name, shot_number) VALUES
  ('12400000-0000-0000-0000-000000000021', 'aaaa1240-0000-0000-0000-00000000000a', '12400000-0000-0000-0000-000000000011', 'Wide', 1);
INSERT INTO public.levels (id, project_id, name) VALUES
  ('12400000-0000-0000-0000-000000000031', 'aaaa1240-0000-0000-0000-00000000000a', 'Dock');
INSERT INTO public.experiences (id, project_id, name) VALUES
  ('12400000-0000-0000-0000-000000000041', 'aaaa1240-0000-0000-0000-00000000000a', 'Tour');

-- Assets 051 (live, in phase 001, in scenes 011 and 012, shot 021, level 031, experience 041), 052 (trashed),
-- 053 (a long name).
INSERT INTO public.assets (id, project_id, name, phase_id, scene_ids, shot_ids, level_ids, experience_ids) VALUES
  ('12400000-0000-0000-0000-000000000051', 'aaaa1240-0000-0000-0000-00000000000a', 'Mira', '12400000-0000-0000-0000-000000000001',
   ARRAY['12400000-0000-0000-0000-000000000011'::uuid, '12400000-0000-0000-0000-000000000012'::uuid],
   ARRAY['12400000-0000-0000-0000-000000000021'::uuid], ARRAY['12400000-0000-0000-0000-000000000031'::uuid],
   ARRAY['12400000-0000-0000-0000-000000000041'::uuid]),
  ('12400000-0000-0000-0000-000000000052', 'aaaa1240-0000-0000-0000-00000000000a', 'Binned', NULL, '{}', '{}', '{}', '{}'),
  ('12400000-0000-0000-0000-000000000053', 'aaaa1240-0000-0000-0000-00000000000a', repeat('L', 400), NULL, '{}', '{}', '{}', '{}');
UPDATE public.assets SET deleted_at = now() WHERE id = '12400000-0000-0000-0000-000000000052';
DELETE FROM public.scenes WHERE id = '12400000-0000-0000-0000-000000000012';

-- Tasks 061 (about asset 051, scene 011, shot 021, phase 001; items shot 021 and level 031), 062 (trashed,
-- about asset 051), 063 (about nothing).
INSERT INTO public.tasks (id, project_id, title, asset_id, scene_id, shot_id, phase_id) VALUES
  ('12400000-0000-0000-0000-000000000061', 'aaaa1240-0000-0000-0000-00000000000a', 'Rig Mira', '12400000-0000-0000-0000-000000000051',
   '12400000-0000-0000-0000-000000000011', '12400000-0000-0000-0000-000000000021', '12400000-0000-0000-0000-000000000001'),
  ('12400000-0000-0000-0000-000000000062', 'aaaa1240-0000-0000-0000-00000000000a', 'Old', '12400000-0000-0000-0000-000000000051', NULL, NULL, NULL),
  ('12400000-0000-0000-0000-000000000063', 'aaaa1240-0000-0000-0000-00000000000a', 'Loose', NULL, NULL, NULL, NULL);
UPDATE public.tasks SET deleted_at = now() WHERE id = '12400000-0000-0000-0000-000000000062';
-- 064 set aside by a bid version (0090), about asset 051; 065 about the trashed asset 052; phase 005 set aside,
-- the parent of phase 006; asset 054 in the trashed phase 003.
INSERT INTO public.phases (id, project_id, name) VALUES
  ('12400000-0000-0000-0000-000000000005', 'aaaa1240-0000-0000-0000-00000000000a', 'Aside');
INSERT INTO public.phases (id, project_id, name, parent_phase_id) VALUES
  ('12400000-0000-0000-0000-000000000006', 'aaaa1240-0000-0000-0000-00000000000a', 'Under aside', '12400000-0000-0000-0000-000000000005');
INSERT INTO public.tasks (id, project_id, title, asset_id) VALUES
  ('12400000-0000-0000-0000-000000000064', 'aaaa1240-0000-0000-0000-00000000000a', 'Aside task', '12400000-0000-0000-0000-000000000051'),
  ('12400000-0000-0000-0000-000000000065', 'aaaa1240-0000-0000-0000-00000000000a', 'About binned', '12400000-0000-0000-0000-000000000052');
INSERT INTO public.assets (id, project_id, name, phase_id) VALUES
  ('12400000-0000-0000-0000-000000000054', 'aaaa1240-0000-0000-0000-00000000000a', 'In gone phase', '12400000-0000-0000-0000-000000000003');
ALTER TABLE public.tasks DISABLE TRIGGER USER;
ALTER TABLE public.phases DISABLE TRIGGER USER;
UPDATE public.tasks SET set_aside_at = now() WHERE id = '12400000-0000-0000-0000-000000000064';
UPDATE public.phases SET set_aside_at = now() WHERE id = '12400000-0000-0000-0000-000000000005';
ALTER TABLE public.tasks ENABLE TRIGGER USER;
ALTER TABLE public.phases ENABLE TRIGGER USER;
INSERT INTO public.task_items (task_id, project_id, entity_type, entity_id, position) VALUES
  ('12400000-0000-0000-0000-000000000061', 'aaaa1240-0000-0000-0000-00000000000a', 'level', '12400000-0000-0000-0000-000000000031', 9);

-- X (private, user_c's): asset 0c1. S (user_e's space): asset 0e1 and a task 0e2 about it. The other company: asset 0b1.
INSERT INTO public.assets (id, project_id, name) VALUES
  ('12400000-0000-0000-0000-0000000000c1', 'aaaa1240-0000-0000-0000-00000000000c', 'Secret'),
  ('12400000-0000-0000-0000-0000000000e1', 'aaaa1240-0000-0000-0000-0000000000e0', 'Pitch');
INSERT INTO public.tasks (id, project_id, title, asset_id) VALUES
  ('12400000-0000-0000-0000-0000000000e2', 'aaaa1240-0000-0000-0000-0000000000e0', 'Draft', '12400000-0000-0000-0000-0000000000e1');
SELECT public.t124_b();
INSERT INTO public.assets (id, project_id, name) VALUES
  ('12400000-0000-0000-0000-0000000000b1', 'bbbb2222-0000-0000-0000-000000000001', 'Theirs');
SELECT public.t124_a();

-- P's folders: the root, ASSETS, and Mira's own folder.
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('12400000-0000-0000-0000-000000000070', 'aaaa1240-0000-0000-0000-00000000000a', NULL, 'root', 'salt-hours', ''),
  ('12400000-0000-0000-0000-000000000071', 'aaaa1240-0000-0000-0000-00000000000a', '12400000-0000-0000-0000-000000000070', 'category', 'ASSETS', 'ASSETS');
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path, entity_type, asset_id) VALUES
  ('12400000-0000-0000-0000-000000000072', 'aaaa1240-0000-0000-0000-00000000000a', '12400000-0000-0000-0000-000000000071', 'entity', 'mira', 'ASSETS/mira', 'asset', '12400000-0000-0000-0000-000000000051');

-- P's files: 081 (Mira's, shot 021), 082 (money, Mira's), 083 (Legal, scene 011), 084 (trashed, task 061),
-- 085 (filed against private X's asset: no line), 086 (nothing).
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial, tags, asset_id, shot_id, scene_id, task_id, created_by) VALUES
  ('12400000-0000-0000-0000-000000000081', 'aaaa1240-0000-0000-0000-00000000000a', 'mira.png', 'supabase', 'projects/aaaa1240-0000-0000-0000-00000000000a/files/12400000-0000-0000-0000-000000000081/mira.png', false, '{}', '12400000-0000-0000-0000-000000000051', '12400000-0000-0000-0000-000000000021', NULL, NULL, 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('12400000-0000-0000-0000-000000000082', 'aaaa1240-0000-0000-0000-00000000000a', 'fee.pdf', 'supabase', 'projects/aaaa1240-0000-0000-0000-00000000000a/files/12400000-0000-0000-0000-000000000082/fee.pdf', true, '{}', '12400000-0000-0000-0000-000000000051', NULL, NULL, NULL, NULL),
  ('12400000-0000-0000-0000-000000000083', 'aaaa1240-0000-0000-0000-00000000000a', 'release.pdf', 'supabase', 'projects/aaaa1240-0000-0000-0000-00000000000a/LEGAL/aaaa1240-0000-0000-0000-00000000000a/12400000-0000-0000-0000-000000000083-release.pdf', false, ARRAY['legal'], NULL, NULL, '12400000-0000-0000-0000-000000000011', NULL, NULL),
  ('12400000-0000-0000-0000-000000000084', 'aaaa1240-0000-0000-0000-00000000000a', 'old.png', 'supabase', 'projects/aaaa1240-0000-0000-0000-00000000000a/files/12400000-0000-0000-0000-000000000084/old.png', false, '{}', NULL, NULL, NULL, '12400000-0000-0000-0000-000000000061', NULL),
  ('12400000-0000-0000-0000-000000000086', 'aaaa1240-0000-0000-0000-00000000000a', 'plain.txt', 'supabase', 'projects/aaaa1240-0000-0000-0000-00000000000a/files/12400000-0000-0000-0000-000000000086/plain.txt', false, '{}', NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, phase_id, task_id, scene_id, level_id, experience_id) VALUES
  ('12400000-0000-0000-0000-000000000087', 'aaaa1240-0000-0000-0000-00000000000a', 'all.txt', 'supabase', 'projects/aaaa1240-0000-0000-0000-00000000000a/files/12400000-0000-0000-0000-000000000087/all.txt',
   '12400000-0000-0000-0000-000000000001', '12400000-0000-0000-0000-000000000061', '12400000-0000-0000-0000-000000000011',
   '12400000-0000-0000-0000-000000000031', '12400000-0000-0000-0000-000000000041'),
  ('12400000-0000-0000-0000-000000000088', 'aaaa1240-0000-0000-0000-00000000000a', 'aside.txt', 'supabase', 'projects/aaaa1240-0000-0000-0000-00000000000a/files/12400000-0000-0000-0000-000000000088/aside.txt',
   '12400000-0000-0000-0000-000000000005', '12400000-0000-0000-0000-000000000064', NULL, NULL, NULL);
UPDATE public.files SET deleted_at = now() WHERE id = '12400000-0000-0000-0000-000000000084';
-- A file of P filed against X's asset: the same-project guard refuses it from a client, and the read's
-- positive form is pinned for the day a row reaches that state another way.
ALTER TABLE public.files DISABLE TRIGGER USER;
INSERT INTO public.files (id, project_id, workspace_id, name, storage_provider, storage_path, asset_id) VALUES
  ('12400000-0000-0000-0000-000000000085', 'aaaa1240-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'stray.png', 'supabase', 'projects/aaaa1240-0000-0000-0000-00000000000a/files/12400000-0000-0000-0000-000000000085/stray.png', '12400000-0000-0000-0000-0000000000c1');
UPDATE public.files SET updated_by = 'dddddddd-dddd-dddd-dddd-dddddddddddd' WHERE id = '12400000-0000-0000-0000-000000000086';
-- MO2 round 1: S holds a plain file of its own, so a read of S's facts by anyone but its owner has a row to leak.
INSERT INTO public.files (id, project_id, workspace_id, name, storage_provider, storage_path, created_by) VALUES
  ('12400000-0000-0000-0000-0000000000e3', 'aaaa1240-0000-0000-0000-0000000000e0', '11111111-1111-1111-1111-111111111111', 'pitch.png', 'supabase', 'projects/aaaa1240-0000-0000-0000-0000000000e0/files/12400000-0000-0000-0000-0000000000e3/pitch.png', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
ALTER TABLE public.files ENABLE TRIGGER USER;

-- ── A. Who may call ─────────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege('authenticated', 'public._moth_target_eligible(text,uuid,boolean)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public._moth_target_eligible(text,uuid,boolean)', 'EXECUTE'),
  'the eligibility helper is a definer''s own');
SELECT ok(has_function_privilege('authenticated', 'public.moth_project_items(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.moth_project_items(uuid)', 'EXECUTE'),
  'items: signed-in callers only');
SELECT ok(has_function_privilege('authenticated', 'public.moth_project_links(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.moth_project_links(uuid)', 'EXECUTE'),
  'links: signed-in callers only');
SELECT ok(has_function_privilege('authenticated', 'public.moth_project_file_facts(uuid,uuid,integer)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.moth_project_file_facts(uuid,uuid,integer)', 'EXECUTE'),
  'file facts: signed-in callers only');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE prosecdef AND oid IN ('public.moth_project_items(uuid)'::regprocedure,
            'public.moth_project_links(uuid)'::regprocedure, 'public.moth_project_file_facts(uuid,uuid,integer)'::regprocedure)), 0,
  'the three reads run as their caller, under the caller''s own row security');

-- ── B. The gates, for the new kinds ─────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t124_a();
SELECT ok(public.moth_can_read_target('phase', '12400000-0000-0000-0000-000000000001')
          AND public.moth_can_read_target('phase', '12400000-0000-0000-0000-000000000002'), 'admin: a live phase and its child');
SELECT ok(NOT public.moth_can_read_target('phase', '12400000-0000-0000-0000-000000000003'), 'admin: a trashed phase is not a target');
SELECT ok(public.moth_can_read_target('asset', '12400000-0000-0000-0000-000000000051'), 'admin: a live asset');
SELECT ok(NOT public.moth_can_read_target('asset', '12400000-0000-0000-0000-000000000052'), 'admin: a trashed asset is not');
SELECT ok(public.moth_can_read_target('task', '12400000-0000-0000-0000-000000000061'), 'admin: a live task');
SELECT ok(NOT public.moth_can_read_target('task', '12400000-0000-0000-0000-000000000062'), 'admin: a trashed task is not');
-- 0124 (MO2-09): set aside by its bid version (the fixtures above), a phase and a task are no targets.
SELECT ok(NOT public.moth_can_read_target('phase', '12400000-0000-0000-0000-000000000005')
          AND NOT public.moth_can_read_target('task', '12400000-0000-0000-0000-000000000064'),
  'admin: a phase and a task set aside by a bid version are not targets (0124)');
SELECT ok(NOT public.moth_can_write_target('phase', '12400000-0000-0000-0000-000000000005')
          AND NOT public.moth_can_write_target('task', '12400000-0000-0000-0000-000000000064'),
  '… nor targets to write to (0124)');
RESET ROLE;
ALTER TABLE public.tasks DISABLE TRIGGER USER;
ALTER TABLE public.phases DISABLE TRIGGER USER;
UPDATE public.tasks SET set_aside_at = NULL WHERE id = '12400000-0000-0000-0000-000000000064';
UPDATE public.phases SET set_aside_at = NULL WHERE id = '12400000-0000-0000-0000-000000000005';
SET LOCAL ROLE authenticated;
SELECT public.t124_a();
SELECT ok(public.moth_can_read_target('phase', '12400000-0000-0000-0000-000000000005')
          AND public.moth_can_read_target('task', '12400000-0000-0000-0000-000000000064')
          AND public.moth_can_write_target('phase', '12400000-0000-0000-0000-000000000005')
          AND public.moth_can_write_target('task', '12400000-0000-0000-0000-000000000064'),
  'CONTROL: brought back by their version, both are targets again (0124)');
RESET ROLE;
UPDATE public.tasks SET set_aside_at = now() WHERE id = '12400000-0000-0000-0000-000000000064';
UPDATE public.phases SET set_aside_at = now() WHERE id = '12400000-0000-0000-0000-000000000005';
ALTER TABLE public.tasks ENABLE TRIGGER USER;
ALTER TABLE public.phases ENABLE TRIGGER USER;
SET LOCAL ROLE authenticated;
SELECT public.t124_a();
SELECT ok(public.moth_can_read_target('scene', '12400000-0000-0000-0000-000000000011')
          AND public.moth_can_read_target('shot', '12400000-0000-0000-0000-000000000021')
          AND public.moth_can_read_target('level', '12400000-0000-0000-0000-000000000031')
          AND public.moth_can_read_target('experience', '12400000-0000-0000-0000-000000000041'),
  'admin: a scene, a shot, a level and an experience');
SELECT ok(NOT public.moth_can_read_target('scene', '12400000-0000-0000-0000-000000000012'), 'a scene that went is not');
SELECT ok(public.moth_can_read_target('asset', '12400000-0000-0000-0000-0000000000c1'), 'admin: an asset of a private project (0072)');
SELECT ok(NOT public.moth_can_read_target('asset', '12400000-0000-0000-0000-0000000000e1')
          AND NOT public.moth_can_read_target('task', '12400000-0000-0000-0000-0000000000e2'),
  'admin: nothing of another person''s personal space (no admin leg)');
SELECT ok(NOT public.moth_can_read_target('asset', '12400000-0000-0000-0000-0000000000b1'), 'admin: nothing of another company');
SELECT ok(NOT public.moth_can_read_target('milestone', '12400000-0000-0000-0000-000000000051')
          AND NOT public.moth_can_read_target('bin', '12400000-0000-0000-0000-000000000051')
          AND NOT public.moth_can_read_target('note', '12400000-0000-0000-0000-000000000051')
          AND NOT public.moth_can_read_target('mtag', '12400000-0000-0000-0000-000000000051'),
  'a kind still unknown is false, even for an id that exists as another kind');
SELECT ok(NOT public.moth_can_read_target('asset', '12400000-0000-0000-0000-0000000000ff')
          AND NOT public.moth_can_read_target('asset', NULL), 'an id that does not exist, and none, are false');
SELECT ok(NOT public.moth_can_read_target('shot', '12400000-0000-0000-0000-000000000051'), 'an asset''s id asked as a shot is false');
SELECT ok(public.moth_can_write_target('asset', '12400000-0000-0000-0000-000000000051')
          AND public.moth_can_write_target('phase', '12400000-0000-0000-0000-000000000001')
          AND public.moth_can_write_target('experience', '12400000-0000-0000-0000-000000000041'), 'admin may write P''s items');
SELECT ok(NOT public.moth_can_write_target('asset', '12400000-0000-0000-0000-0000000000e1'), 'admin may not write into another''s space');
SELECT ok(NOT public.moth_can_write_target('task', '12400000-0000-0000-0000-000000000062'), 'nor a trashed task');

SELECT public.t124_e();
SELECT ok(public.moth_can_read_target('asset', '12400000-0000-0000-0000-0000000000e1')
          AND public.moth_can_read_target('task', '12400000-0000-0000-0000-0000000000e2')
          AND public.moth_can_write_target('task', '12400000-0000-0000-0000-0000000000e2'),
  'the owner reads and writes their own space''s items');
SELECT ok(NOT public.moth_can_read_target('asset', '12400000-0000-0000-0000-0000000000c1'), 'a member reads nothing of a private project not theirs');

SELECT public.t124_c();
SELECT ok(public.moth_can_read_target('asset', '12400000-0000-0000-0000-0000000000c1'), 'its creator reads the private project''s asset');
SELECT ok(public.moth_can_write_target('task', '12400000-0000-0000-0000-000000000061')
          AND public.moth_can_write_target('shot', '12400000-0000-0000-0000-000000000021')
          AND public.moth_can_write_target('level', '12400000-0000-0000-0000-000000000031')
          AND public.moth_can_write_target('scene', '12400000-0000-0000-0000-000000000011'), 'a seated member writes P''s items, a level and a scene among them');
SELECT ok(NOT public.moth_can_read_target('task', '12400000-0000-0000-0000-0000000000e2'), 'a member reads nothing of another''s space');

SELECT public.t124_r();
SELECT ok(public.moth_can_read_target('asset', '12400000-0000-0000-0000-000000000051'), 'the reviewer reads P''s asset');
SELECT ok(NOT public.moth_can_write_target('asset', '12400000-0000-0000-0000-000000000051')
          AND NOT public.moth_can_write_target('level', '12400000-0000-0000-0000-000000000031'),
  'the reviewer cannot write P''s items');

SELECT public.t124_d();
SELECT ok(public.moth_can_write_target('scene', '12400000-0000-0000-0000-000000000011'), 'a workspace manager writes P''s scene');
SELECT ok(NOT public.moth_can_read_target('asset', '12400000-0000-0000-0000-0000000000c1'), 'a workspace manager reads nothing of private X');

SELECT public.t124_n();
SELECT ok(NOT public.moth_can_read_target('asset', '12400000-0000-0000-0000-000000000051')
          AND NOT public.moth_can_read_target('phase', '12400000-0000-0000-0000-000000000001'), 'someone who has left reads nothing');

SELECT public.t124_b();
SELECT ok(NOT public.moth_can_read_target('phase', '12400000-0000-0000-0000-000000000001')
          AND NOT public.moth_can_write_target('asset', '12400000-0000-0000-0000-000000000051'),
  'another company: false for a phase (no workspace column) and for an asset, as for an id that does not exist');
SELECT ok(public.moth_can_read_target('asset', '12400000-0000-0000-0000-0000000000b1'), 'the other company reads its own asset');
RESET ROLE;

-- ── C. A project's items ────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t124_a();
SELECT is(public.t124_items('aaaa1240-0000-0000-0000-00000000000a'),
  'asset:051 asset:053 asset:054 experience:041 level:031 phase:001 phase:002 phase:004 phase:006 scene:011 shot:021 task:061 task:063 task:065',
  'the admin reads P''s live items: none trashed, gone or set aside by a bid version');
SELECT is((public.t124_item('aaaa1240-0000-0000-0000-00000000000a', '12400000-0000-0000-0000-000000000002') ->> 'parent_kind') || ':'
          || right(public.t124_item('aaaa1240-0000-0000-0000-00000000000a', '12400000-0000-0000-0000-000000000002') ->> 'parent_id', 3),
  'phase:001', 'a phase lives in its parent phase');
SELECT ok(jsonb_typeof(public.t124_item('aaaa1240-0000-0000-0000-00000000000a', '12400000-0000-0000-0000-000000000004') -> 'parent_id') = 'null'
          AND jsonb_typeof(public.t124_item('aaaa1240-0000-0000-0000-00000000000a', '12400000-0000-0000-0000-000000000006') -> 'parent_id') = 'null',
  'a phase whose parent is in the trash, or set aside, lives in the project');
SELECT is((public.t124_item('aaaa1240-0000-0000-0000-00000000000a', '12400000-0000-0000-0000-000000000021') ->> 'parent_kind') || ':'
          || right(public.t124_item('aaaa1240-0000-0000-0000-00000000000a', '12400000-0000-0000-0000-000000000021') ->> 'parent_id', 3),
  'scene:011', 'a shot lives in its scene');
SELECT is(public.t124_item('aaaa1240-0000-0000-0000-00000000000a', '12400000-0000-0000-0000-000000000061') ->> 'name',
  'Rig Mira', 'a task is named by its title');
SELECT is(char_length(public.t124_item('aaaa1240-0000-0000-0000-00000000000a', '12400000-0000-0000-0000-000000000053') ->> 'name'),
  300, 'a long name is cut to 300 characters');
SELECT is(public.moth_project_items('aaaa1240-0000-0000-0000-00000000000a') -> 'truncated', 'false'::jsonb, 'and the answer says it was not cut');
SELECT is(public.t124_items('aaaa1240-0000-0000-0000-0000000000e0'), '', 'the admin reads nothing of another person''s space');
SELECT is(public.t124_items('aaaa1240-0000-0000-0000-00000000000c'), 'asset:0c1', 'the admin reads the private project''s items');

SELECT public.t124_e();
SELECT is(public.t124_items('aaaa1240-0000-0000-0000-0000000000e0'), 'asset:0e1 task:0e2', 'the owner reads their own space''s items');
SELECT is(public.t124_items('aaaa1240-0000-0000-0000-00000000000c'), '', 'a member reads nothing of a private project not theirs');

SELECT public.t124_r();
SELECT is(jsonb_array_length(public.moth_project_items('aaaa1240-0000-0000-0000-00000000000a') -> 'items'), 14, 'the reviewer reads P''s items');
SELECT public.t124_n();
SELECT is(jsonb_array_length(public.moth_project_items('aaaa1240-0000-0000-0000-00000000000a') -> 'items'), 0, 'someone who has left reads none');
SELECT public.t124_b();
SELECT is(jsonb_array_length(public.moth_project_items('aaaa1240-0000-0000-0000-00000000000a') -> 'items'), 0, 'another company reads none');
SELECT is(public.moth_project_items('aaaa1240-0000-0000-0000-0000000000ff'), '{"items":[],"truncated":false}'::jsonb, 'a project that does not exist reads none');
RESET ROLE;

-- ── D. A project's links ────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t124_a();
SELECT is(public.t124_links('aaaa1240-0000-0000-0000-00000000000a'),
  'asset_experience:051>041 asset_level:051>031 asset_phase:051>001 asset_scene:051>011 asset_shot:051>021 '
  || 'folder_item:072>051 '
  || 'task_asset:061>051 task_item:061>011 task_item:061>021 task_item:061>031 task_phase:061>001',
  'the admin reads exactly P''s stored relationships between live, visible items and folders, one line a pair');
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(public.moth_project_links('aaaa1240-0000-0000-0000-00000000000a') -> 'links') l
            WHERE l ->> 'source_id' IN ('12400000-0000-0000-0000-000000000062', '12400000-0000-0000-0000-000000000064', '12400000-0000-0000-0000-000000000065')
               OR l ->> 'target_id' IN ('12400000-0000-0000-0000-000000000052', '12400000-0000-0000-0000-000000000003', '12400000-0000-0000-0000-000000000005')), 0,
  'a trashed or set-aside task gives no line, and none goes to a trashed asset or to a trashed or set-aside phase');
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(public.moth_project_links('aaaa1240-0000-0000-0000-00000000000a') -> 'links') l
            WHERE l ->> 'target_id' = '12400000-0000-0000-0000-000000000012'), 0,
  'an id an asset''s array still holds after its scene went gives no line');
SELECT is((SELECT string_agg(DISTINCT l ->> 'source_kind', ' ') FROM jsonb_array_elements(public.moth_project_links('aaaa1240-0000-0000-0000-00000000000a') -> 'links') l),
  'asset folder task', 'every kind of source is drawn: a task, an asset and a folder (a file''s own come from its facts)');
SELECT is(public.moth_project_links('aaaa1240-0000-0000-0000-00000000000a') -> 'truncated', 'false'::jsonb, 'and the answer says it was not cut');
SELECT is(public.t124_links('aaaa1240-0000-0000-0000-0000000000e0'), '', 'the admin reads no line of another person''s space');

SELECT public.t124_e();
SELECT is(public.t124_links('aaaa1240-0000-0000-0000-0000000000e0'), 'task_asset:0e2>0e1', 'the owner reads their own space''s line');

SELECT public.t124_r();
SELECT is(public.t124_nlinks('aaaa1240-0000-0000-0000-00000000000a'), 11, 'the reviewer reads P''s lines');
SELECT public.t124_n();
SELECT is(public.t124_nlinks('aaaa1240-0000-0000-0000-00000000000a'), 0, 'someone who has left reads none');
SELECT public.t124_b();
SELECT is(public.t124_nlinks('aaaa1240-0000-0000-0000-00000000000a'), 0, 'another company reads none');
RESET ROLE;

-- A Legal folder holds an entity folder: the folder end is locked, so no line (as postgres, the guard would
-- refuse a client).
SELECT public.t124_a();
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('12400000-0000-0000-0000-000000000073', 'aaaa1240-0000-0000-0000-00000000000a', '12400000-0000-0000-0000-000000000070', 'custom', 'LEGAL', 'LEGAL');
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path, entity_type, scene_id) VALUES
  ('12400000-0000-0000-0000-000000000074', 'aaaa1240-0000-0000-0000-00000000000a', '12400000-0000-0000-0000-000000000073', 'entity', 'harbour', 'LEGAL/harbour', 'scene', '12400000-0000-0000-0000-000000000011');
SET LOCAL ROLE authenticated;
SELECT public.t124_a();
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(public.moth_project_links('aaaa1240-0000-0000-0000-00000000000a') -> 'links') l
            WHERE l ->> 'source_id' = '12400000-0000-0000-0000-000000000074'), 0,
  'an entity folder inside a Legal folder gives no line');
SELECT is(public.t124_nlinks('aaaa1240-0000-0000-0000-00000000000a'), 11, 'and the rest stand');
RESET ROLE;

-- ── E. What each file is filed against, and who last changed it ────────────
SET LOCAL ROLE authenticated;
SELECT public.t124_a();
SELECT is(public.t124_facts('aaaa1240-0000-0000-0000-00000000000a'),
  '081[a051,h021] 085[] 086[] 087[p001,t061,s011,l031,e041] 088[]',
  'facts only for the files Moth shows (no money, Legal or trashed file), and only live items of this project: '
  || 'not another project''s asset, not a set-aside task or phase');
SELECT is((SELECT editor_id FROM public.moth_project_file_facts('aaaa1240-0000-0000-0000-00000000000a') WHERE file_id = '12400000-0000-0000-0000-000000000086'),
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, 'the last person to change it');
-- MO2 round 1: a file with no recorded change (updated_by NULL), added by user_c.
RESET ROLE;
ALTER TABLE public.files DISABLE TRIGGER USER;
INSERT INTO public.files (id, project_id, workspace_id, name, storage_provider, storage_path, created_by, updated_by) VALUES
  ('12400000-0000-0000-0000-000000000089', 'aaaa1240-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'added.png', 'supabase', 'projects/aaaa1240-0000-0000-0000-00000000000a/files/12400000-0000-0000-0000-000000000089/added.png', 'cccccccc-cccc-cccc-cccc-cccccccccccc', NULL);
ALTER TABLE public.files ENABLE TRIGGER USER;
SET LOCAL ROLE authenticated;
SELECT public.t124_a();
SELECT is((SELECT editor_id FROM public.moth_project_file_facts('aaaa1240-0000-0000-0000-00000000000a') WHERE file_id = '12400000-0000-0000-0000-000000000089'),
  'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'else whoever added it, where no change was recorded');
SELECT is((SELECT string_agg(right(file_id::text, 3), ' ' ORDER BY file_id) FROM public.moth_project_file_facts('aaaa1240-0000-0000-0000-00000000000a', '12400000-0000-0000-0000-000000000081', 2)),
  '085 086', 'a page follows the last id and keeps to its limit');
SELECT is((SELECT count(*)::int FROM public.moth_project_file_facts('aaaa1240-0000-0000-0000-00000000000a', NULL, 0)), 1, 'a limit below one reads one');
SELECT is((SELECT count(*)::int FROM public.moth_project_file_facts('aaaa1240-0000-0000-0000-0000000000e0')), 0, 'none of another person''s space');
SELECT public.t124_e();
SELECT is((SELECT count(*)::int FROM public.moth_project_file_facts('aaaa1240-0000-0000-0000-0000000000e0')), 1, 'CONTROL: its owner reads its one file');
SELECT public.t124_a();
SELECT public.t124_n();
SELECT is((SELECT count(*)::int FROM public.moth_project_file_facts('aaaa1240-0000-0000-0000-00000000000a')), 0, 'none for someone who has left');
SELECT public.t124_b();
SELECT is((SELECT count(*)::int FROM public.moth_project_file_facts('aaaa1240-0000-0000-0000-00000000000a')), 0, 'none for another company');
RESET ROLE;

-- ── F. What did not change ──────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t124_a();
SELECT ok(public.moth_can_read_target('project', 'aaaa1240-0000-0000-0000-00000000000a')
          AND public.moth_can_read_target('folder', '12400000-0000-0000-0000-000000000072')
          AND public.moth_can_read_target('file', '12400000-0000-0000-0000-000000000081'), 'a project, a folder and a file answer as before');
SELECT ok(NOT public.moth_can_read_target('file', '12400000-0000-0000-0000-000000000082')
          AND NOT public.moth_can_read_target('file', '12400000-0000-0000-0000-000000000083')
          AND NOT public.moth_can_read_target('folder', '12400000-0000-0000-0000-000000000073'), 'money, Legal and a Legal folder still refused');
SELECT ok(NOT public.moth_can_read_target('project', 'aaaa1240-0000-0000-0000-0000000000e0'), 'another person''s space still refused to the admin');
SELECT ok(NOT public.moth_can_write_target('file', '12400000-0000-0000-0000-000000000082'), 'a money file still not written through Moth');
SELECT public.t124_r();
SELECT ok(NOT public.moth_can_write_target('file', '12400000-0000-0000-0000-000000000081')
          AND public.moth_can_read_target('file', '12400000-0000-0000-0000-000000000081'), 'the reviewer reads a file and writes none');
RESET ROLE;

SELECT is((SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.moth_can_read_target(text,uuid)'::regprocedure),
  '295827d4e0db02e690624854aa6e8bfd', 'moth_can_read_target is 0111''s, unchanged (it asks the widened helper)');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('moth_project_items', 'moth_project_links', 'moth_project_file_facts')
            AND pronamespace = 'public'::regnamespace AND provolatile = 's'), 3, 'the three reads are STABLE');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE oid IN ('public._moth_target_eligible(text,uuid,boolean)'::regprocedure,
            'public.moth_can_write_target(text,uuid)'::regprocedure) AND prosecdef AND provolatile = 's'
            AND proconfig @> ARRAY['search_path=public']), 2, 'the two gates stay STABLE definers on a fixed path');

-- F. What the plants found unprobed (MO2's planted breakages): an id of one kind asked as another, or no id of its
-- kind at all, is refused even where the company holds that kind; a project's id under a kind the gate does not
-- know is refused; a writer writes every new kind and a reviewer none; a phase's name is cut too; an entity folder
-- whose asset is trashed draws no line.
SELECT public.t124_a();
INSERT INTO public.phases (id, project_id, name) VALUES ('12400000-0000-0000-0000-0000000000f1', 'aaaa1240-0000-0000-0000-00000000000a', repeat('P', 400));
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path, entity_type, asset_id) VALUES
  ('12400000-0000-0000-0000-0000000000f2', 'aaaa1240-0000-0000-0000-00000000000a', '12400000-0000-0000-0000-000000000071', 'entity', 'binned', 'ASSETS/binned', 'asset', '12400000-0000-0000-0000-000000000052');
SET LOCAL ROLE authenticated;
SELECT public.t124_a();
SELECT ok(NOT public.moth_can_read_target('experience', '12400000-0000-0000-0000-000000000031')
          AND NOT public.moth_can_read_target('level', '12400000-0000-0000-0000-000000000041')
          AND NOT public.moth_can_read_target('shot', '12400000-0000-0000-0000-000000000011')
          AND NOT public.moth_can_read_target('scene', '12400000-0000-0000-0000-000000000021')
          AND NOT public.moth_can_read_target('phase', '12400000-0000-0000-0000-000000000051')
          AND NOT public.moth_can_read_target('experience', '12400000-0000-0000-0000-00000000dead')
          AND NOT public.moth_can_read_target('shot', '12400000-0000-0000-0000-00000000dead'),
  'an id asked as another kind, or no row of its kind, is refused where the company holds that kind');
SELECT ok(NOT public.moth_can_read_target('milestone', 'aaaa1240-0000-0000-0000-00000000000a')
          AND NOT public.moth_can_read_target('', 'aaaa1240-0000-0000-0000-00000000000a')
          AND NOT public.moth_can_read_target(NULL, 'aaaa1240-0000-0000-0000-00000000000a')
          AND NOT public.moth_can_write_target('milestone', 'aaaa1240-0000-0000-0000-00000000000a'),
  'a readable project''s id under a kind the gate does not know is refused');
SELECT ok(public.moth_can_write_target('phase', '12400000-0000-0000-0000-000000000001') AND public.moth_can_write_target('asset', '12400000-0000-0000-0000-000000000051')
          AND public.moth_can_write_target('task', '12400000-0000-0000-0000-000000000061') AND public.moth_can_write_target('scene', '12400000-0000-0000-0000-000000000011')
          AND public.moth_can_write_target('shot', '12400000-0000-0000-0000-000000000021') AND public.moth_can_write_target('level', '12400000-0000-0000-0000-000000000031')
          AND public.moth_can_write_target('experience', '12400000-0000-0000-0000-000000000041'),
  'the admin writes every new kind of a project they may change');
SELECT is(char_length(public.t124_item('aaaa1240-0000-0000-0000-00000000000a', '12400000-0000-0000-0000-0000000000f1') ->> 'name'), 300, 'a phase''s name is cut to 300 too');
SELECT ok(position('folder_item:0f2' IN public.t124_links('aaaa1240-0000-0000-0000-00000000000a')) = 0 AND position('>052' IN public.t124_links('aaaa1240-0000-0000-0000-00000000000a')) = 0,
  'an entity folder whose asset is trashed draws no line');
SELECT public.t124_r();
SELECT ok(NOT public.moth_can_write_target('phase', '12400000-0000-0000-0000-000000000001') AND NOT public.moth_can_write_target('asset', '12400000-0000-0000-0000-000000000051')
          AND NOT public.moth_can_write_target('task', '12400000-0000-0000-0000-000000000061') AND NOT public.moth_can_write_target('scene', '12400000-0000-0000-0000-000000000011')
          AND NOT public.moth_can_write_target('shot', '12400000-0000-0000-0000-000000000021') AND NOT public.moth_can_write_target('level', '12400000-0000-0000-0000-000000000031')
          AND NOT public.moth_can_write_target('experience', '12400000-0000-0000-0000-000000000041')
          AND public.moth_can_read_target('task', '12400000-0000-0000-0000-000000000061'),
  'the reviewer reads them and writes none');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
