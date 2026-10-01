-- =============================================================================
-- 84_shot_lists.sql — migration 0084 (post-overhaul bundle S3a, 2026-09-30):
-- shot lists, the project's ACTIVE-list pointer, the manager/admin RPCs and
-- the one-time backfill.
--
-- What this pins (each probe names the 0084 section it holds to):
--   * Structure (§3, §7, §8, §10): RLS enabled AND forced, exactly the three
--     policies select/insert/update — NO delete policy (D4/D18: archived,
--     never deleted) — both write policies hop to projects and call the new
--     gate, the stamp/audit/guard triggers are armed, the two definer RPCs
--     call passes_project_privacy exactly once.
--   * THE GATE on a STAFFED project (§2, D8): a REVIEWER can create a shot
--     list and still cannot create a scene — the D8 pair: can_edit_shot_lists
--     is deliberately wider than can_write_project, and only for lists. A
--     member edits a list's title but cannot archive it (the §7a guard), and
--     cannot move the active pointer either through the RPC (§10a's seat
--     check) or directly (the §7b guard) — while the same member's ordinary
--     project edit, sending the pointer back unchanged, still lands.
--   * SET ACTIVE and ARCHIVE are the PROJECT manager's and the workspace
--     admin's (D8): the project manager (app_role 'user') activates, archives
--     a non-active list, restores it; the active list cannot be archived; an
--     archived list is frozen and cannot be made active. A workspace-level
--     'manager' with no seat is refused both RPCs — yet may still create a
--     list (can_edit_shot_lists' admin/manager leg).
--   * Constraints (§3): (project, title, version) unique; a blank title is
--     refused; authenticated holds no DELETE privilege at all.
--   * Tenancy: an admin of the other workspace sees none of it, cannot write
--     into it, and the RPC does not confirm the project exists.
--   * PRIVATE projects (§8's hop, §10's passes_project_privacy): a second
--     manager SEATED on a private project (can_edit_shot_lists says yes)
--     can neither see its lists, add one, activate one nor archive one —
--     each refusal paired with a CONTROL on the public project.
--   * THE BACKFILL (§11, D11), which CI cannot see (its migration-time call
--     runs against an empty database): seeded here, it makes "Shot list 1 ·
--     v1", active, holding every scene in scene_number order and every shot
--     in shot_number order per scene, and a second call makes nothing.
--   * Deleting the ACTIVE list clears the pointer through the FK's SET NULL
--     without tripping the §7b guard.
--   * REVIEW ROUND 1 (§7a, §10, the R1 addendum's D and F): a list cannot be
--     INSERTED already archived (either column); an upsert re-send of an
--     archived list that omits the archive columns (what the cloud adapter
--     now sends) gets "this shot list is archived — restore it before
--     changing it"; a plain UPDATE cannot restore; a workspace ADMIN with no
--     seat activates, archives and restores (the RPCs' other leg); titles
--     are stored trimmed, on INSERT and UPDATE, and the (title, version) key
--     compares them trimmed.
--   * REVIEW ROUND 2 (§7a, R2-5): "trimmed" is ALL leading and trailing
--     whitespace ([[:space:]], as the JS backends' trim() does), not spaces
--     only — a title sent as tab + text + newline is stored as the text, and
--     one that is nothing but a tab and a newline is blank once trimmed and
--     refused by the blank-title CHECK, as the Local Server and the fixtures
--     refuse it.
--   * anon holds nothing; no client role executes the backfill.
--
-- Postgres-side reads are ALWAYS scoped to fixture ids — dev carries real
-- projects (S33, 439f702), and on a hosted run 0084's own backfill has just
-- given every real project with scenes a list inside this transaction.
-- =============================================================================

BEGIN;

SELECT plan(87);

SELECT * FROM tests.rls_setup();

-- ── Extra fixtures ─────────────────────────────────────────────────────────
-- project_a is STAFFED here, so no leg of either gate opens by accident
-- through 0013's unstaffed opening (the map's trap 12).
--
--   user_c  app_role 'user',    project_a REVIEWER -> lists yes, scenes NO
--   user_d  app_role 'user',    project_a MEMBER   -> lists yes, activate/archive NO
--   user_e  app_role 'user',    project_a MANAGER  -> activate/archive YES;
--           later seated manager on the private project by postgres
--   user_f  app_role 'manager', NO seat anywhere   -> lists yes (gate's
--           manager leg), activate/archive NO (the seat rule); creates the
--           private project
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
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','user','user_c','User C',true),
  ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','user','user_d','User D',true),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','user','user_e','User E',true),
  ('11111111-1111-1111-1111-111111111111','ffffffff-ffff-ffff-ffff-ffffffffffff','manager','user_f','User F',true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.project_members
  (project_id, user_id, workspace_id, project_role)
VALUES
  ('aaaa1111-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1111-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1111-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   '11111111-1111-1111-1111-111111111111', 'manager')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;


-- ── 1-12: structure (§3, §7, §8, §10) ─────────────────────────────────────

SELECT has_table('public'::name, 'shot_lists'::name, 'shot_lists table exists (§3)');

SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.shot_lists'::regclass),
  'shot_lists has RLS enabled and forced (§8)');

-- A broad FOR ALL arm ORs with every narrow arm beside it and silently wins
-- (0029; S15's CRITICAL).
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'shot_lists' AND cmd = 'ALL'),
  0, 'shot_lists has no FOR ALL policy (§8)');

-- The NAMES, not just the count: a fourth policy that was a DELETE would
-- turn "archived, never deleted" (D4/D18) into a label.
SELECT is(
  (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'shot_lists'),
  ARRAY['shot_lists_insert', 'shot_lists_select', 'shot_lists_update']::text[],
  'shot_lists has exactly three policies — select, insert, update, and NO delete policy (D4/D18)');

-- §8: every write policy hops to projects AND calls the new gate — the 0082
-- §3b lesson (return=minimal inserts never meet a SELECT policy). UPDATE's
-- USING is held to the same standard as its WITH CHECK.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'shot_lists'
      AND cmd IN ('INSERT', 'UPDATE')
      AND with_check LIKE '%projects%' AND with_check LIKE '%can_edit_shot_lists%'
      AND (cmd = 'INSERT' OR (qual LIKE '%projects%' AND qual LIKE '%can_edit_shot_lists%'))),
  2, 'both shot_lists write policies hop to projects and call can_edit_shot_lists (§8)');

-- §7: no client sends workspace_id, and nothing learns who wrote a row
-- without fn_audit_touch (the 0040 tables never did).
SELECT has_trigger('public', 'shot_lists', 'trg_shot_lists_populate_workspace',
  'shot_lists stamps workspace_id on insert (§7)');

SELECT has_trigger('public', 'shot_lists', 'trg_shot_lists_audit',
  'shot_lists stamps created_by/updated_by through fn_audit_touch (§7)');

SELECT has_trigger('public', 'shot_lists', 'trg_shot_lists_guard',
  'shot_lists carries the archive guard (§7a)');

SELECT has_trigger('public', 'projects', 'trg_projects_active_shot_list_guard',
  'projects carries the active-list guard (§7b)');

-- Expressed over pg_proc rather than has_function() (suite 82's reason: the
-- shim and pgTAP resolve its overloads differently).
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND p.proname IN ('can_edit_shot_lists', 'set_active_shot_list', 'archive_shot_list')),
  3, 'can_edit_shot_lists, set_active_shot_list and archive_shot_list are SECURITY DEFINER (§2, §10)');

-- Comments stripped before counting (0077 §3c): a `-- passes_project_privacy`
-- line must not satisfy this, and a second live mention must not either.
SELECT is(
  (SELECT (length(b) - length(replace(b, 'passes_project_privacy(', ''))) / length('passes_project_privacy(')
     FROM (SELECT regexp_replace(regexp_replace(
                    pg_get_functiondef('public.set_active_shot_list(uuid, uuid)'::regprocedure),
                    '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g') AS b) s),
  1, 'set_active_shot_list calls passes_project_privacy exactly once, comments stripped (§10a)');

SELECT is(
  (SELECT (length(b) - length(replace(b, 'passes_project_privacy(', ''))) / length('passes_project_privacy(')
     FROM (SELECT regexp_replace(regexp_replace(
                    pg_get_functiondef('public.archive_shot_list(uuid, boolean)'::regprocedure),
                    '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g') AS b) s),
  1, 'archive_shot_list calls passes_project_privacy exactly once, comments stripped (§10b)');


-- ── 13-15: the workspace admin — stamping, audit, and no backfill ─────────
-- Claims in the JWT's own shape (suite 59): current_app_role() reads
-- app_metadata.app_role from the claims, not from workspace_members.

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

INSERT INTO public.scenes (id, project_id, name, scene_number)
VALUES ('84840000-0000-0000-0000-0000000000c1',
        'aaaa1111-0000-0000-0000-000000000001', 'WLSN_SC001', 1);

-- No workspace_id: the stamp trigger's job (probe 13).
INSERT INTO public.shot_lists (id, project_id, title, version)
VALUES ('84840000-0000-0000-0000-0000000000a1',
        'aaaa1111-0000-0000-0000-000000000001', 'Main', 1),
       ('84840000-0000-0000-0000-0000000000a3',
        'aaaa1111-0000-0000-0000-000000000001', 'Alt', 1);

SELECT is(
  (SELECT workspace_id FROM public.shot_lists
    WHERE id = '84840000-0000-0000-0000-0000000000a1'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'workspace_id is stamped from the project, with no client involvement (§7)');

SELECT is(
  (SELECT created_by FROM public.shot_lists
    WHERE id = '84840000-0000-0000-0000-0000000000a1'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'created_by is the inserting caller, stamped by fn_audit_touch (§7)');

-- §11: the backfill writes lists into EVERY project of EVERY workspace, so
-- not even a workspace admin may call it. Permission, not RLS, refuses it.
SELECT throws_ok(
  $$SELECT public.backfill_shot_lists()$$,
  '42501', 'permission denied for function backfill_shot_lists',
  'a workspace admin cannot execute backfill_shot_lists (§11: no client role may)');


-- ── 16-18: the REVIEWER — the D8 pair ─────────────────────────────────────

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

SELECT lives_ok(
  $$INSERT INTO public.shot_lists (id, project_id, title, version)
    VALUES ('84840000-0000-0000-0000-0000000000a2',
            'aaaa1111-0000-0000-0000-000000000001', 'Reviewer cut', 1)$$,
  'a project REVIEWER can create a shot list (§2, D8 — the first thing a reviewer may write)');

-- 🚨 THE OTHER HALF OF D8. Scenes keep can_write_project (0040): a reviewer
-- may put an existing scene in a list but may not create one, because a
-- scene's columns are shared by every list (D3). If this ever lives, the new
-- gate has leaked into the scene policies.
SELECT throws_ok(
  $$INSERT INTO public.scenes (project_id, name, scene_number)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'reviewer scene', 99)$$,
  '42501', 'new row violates row-level security policy for table "scenes"',
  'the same reviewer still CANNOT create a scene — can_edit_shot_lists is wider than can_write_project for lists ONLY (D8)');

SELECT is(
  (SELECT count(*)::int FROM public.shot_lists
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  3, 'the reviewer reads every list of the project (§8, the live-parent hop)');


-- ── 19-25: the MEMBER — edits a list, cannot archive or activate ──────────

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

SELECT lives_ok(
  $$UPDATE public.shot_lists SET title = 'Main cut'
     WHERE id = '84840000-0000-0000-0000-0000000000a1'$$,
  'a project member can update a list''s title (§8 shot_lists_update)');

-- The silent-zero-rows hazard: a refused UPDATE raises nothing, so the
-- lives_ok above proves nothing on its own. Read it back.
SELECT is(
  (SELECT title FROM public.shot_lists WHERE id = '84840000-0000-0000-0000-0000000000a1'),
  'Main cut', 'and the new title landed');

SELECT throws_ok(
  $$UPDATE public.shot_lists SET archived_at = now()
     WHERE id = '84840000-0000-0000-0000-0000000000a3'$$,
  '42501', 'shot lists are archived and restored only by a project manager or a workspace admin, through archive_shot_list()',
  'a member''s UPDATE of archived_at is refused by the guard, although the UPDATE policy admits them (§7a)');

SELECT throws_ok(
  $$SELECT public.set_active_shot_list('aaaa1111-0000-0000-0000-000000000001',
                                       '84840000-0000-0000-0000-0000000000a1')$$,
  '42501', 'only a project manager or a workspace admin can change the active shot list',
  'a member cannot call set_active_shot_list (§10a''s seat check, D8)');

-- projects_update (0013) admits every member to every column; only the §7b
-- guard stands between a member and the pointer.
SELECT throws_ok(
  $$UPDATE public.projects SET active_shot_list_id = '84840000-0000-0000-0000-0000000000a1'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  '42501', 'the active shot list is changed only by a project manager or a workspace admin, through set_active_shot_list()',
  'a member cannot move projects.active_shot_list_id directly either (§7b)');

-- CONTROL for the refusal above: the same member, the same project, the same
-- (NULL) pointer state — and the pointer column IS in the SET list, sent back
-- unchanged the way a client returns the whole row. The guard examines a
-- CHANGE, not the column's presence (the 0049 rule).
SELECT lives_ok(
  $$UPDATE public.projects
       SET title = 'Project A (renamed by a member)', active_shot_list_id = NULL
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'CONTROL: the member''s ordinary project edit lives when the pointer is sent back unchanged (§7b examines only a change)');

SELECT is(
  (SELECT title FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000001'),
  'Project A (renamed by a member)', 'and it landed — the row really reached the guard');


-- ── 26-34: the PROJECT manager (app_role 'user') — activate and archive ───

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.set_active_shot_list('aaaa1111-0000-0000-0000-000000000001',
                                       '84840000-0000-0000-0000-0000000000a1')$$,
  'a PROJECT manager with app_role ''user'' can set the active list (§10a, D8)');

SELECT is(
  (SELECT active_shot_list_id FROM public.projects
    WHERE id = 'aaaa1111-0000-0000-0000-000000000001'),
  '84840000-0000-0000-0000-0000000000a1'::uuid,
  'and the pointer moved (the RPC armed the §7b guard for its own write)');

SELECT lives_ok(
  $$SELECT public.archive_shot_list('84840000-0000-0000-0000-0000000000a3', true)$$,
  'the project manager archives a NON-active list (§10b, D4)');

SELECT ok(
  (SELECT archived_at IS NOT NULL AND archived_by = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid
     FROM public.shot_lists WHERE id = '84840000-0000-0000-0000-0000000000a3'),
  'the archive stamped archived_at and archived_by = the caller (§10b)');

SELECT throws_ok(
  $$SELECT public.archive_shot_list('84840000-0000-0000-0000-0000000000a1', true)$$,
  'P0001', 'the active shot list cannot be archived — make another list active first',
  'the ACTIVE list cannot be archived, even by its project manager (§10b, D4)');

-- D4: saved history is never rewritten. Even the manager's plain UPDATE of an
-- archived list is refused until it is restored.
SELECT throws_ok(
  $$UPDATE public.shot_lists SET title = 'Alt (edited while archived)'
     WHERE id = '84840000-0000-0000-0000-0000000000a3'$$,
  '42501', 'this shot list is archived — restore it before changing it',
  'an archived list''s plain UPDATE is refused (§7a)');

SELECT throws_ok(
  $$SELECT public.set_active_shot_list('aaaa1111-0000-0000-0000-000000000001',
                                       '84840000-0000-0000-0000-0000000000a3')$$,
  'P0001', 'an archived shot list cannot be made active — restore it first',
  'an archived list cannot be made active (§10a)');

SELECT lives_ok(
  $$SELECT public.archive_shot_list('84840000-0000-0000-0000-0000000000a3', false)$$,
  'the project manager restores the list (p_archived false, §10b)');

SELECT ok(
  (SELECT archived_at IS NULL AND archived_by IS NULL
     FROM public.shot_lists WHERE id = '84840000-0000-0000-0000-0000000000a3'),
  'the restore cleared archived_at and archived_by (§10b)');


-- ── 35-41: a WORKSPACE manager with no seat — writes lists, no seat rule ──
-- D8: "a workspace-level manager app role does NOT qualify" for activate and
-- archive. The gate still admits them to lists (the can_write_project shape).

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.set_active_shot_list('aaaa1111-0000-0000-0000-000000000001',
                                       '84840000-0000-0000-0000-0000000000a2')$$,
  '42501', 'only a project manager or a workspace admin can change the active shot list',
  'a workspace MANAGER with no seat cannot set the active list — the seat rule (§10a, D8)');

SELECT throws_ok(
  $$SELECT public.archive_shot_list('84840000-0000-0000-0000-0000000000a2', true)$$,
  '42501', 'only a project manager or a workspace admin can archive or restore a shot list',
  'nor archive one (§10b, D8)');

SELECT is(
  public.can_edit_shot_lists('aaaa1111-0000-0000-0000-000000000001'),
  true, 'yet can_edit_shot_lists admits them — the gate''s admin/manager leg (§2)');

SELECT lives_ok(
  $$INSERT INTO public.shot_lists (id, project_id, title, version)
    VALUES ('84840000-0000-0000-0000-0000000000a4',
            'aaaa1111-0000-0000-0000-000000000001', 'Manager draft', 1)$$,
  'so the workspace manager may create a list on the staffed project (§2, §8)');

SELECT throws_ok(
  $$INSERT INTO public.shot_lists (project_id, title, version)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'Reviewer cut', 1)$$,
  '23505', 'duplicate key value violates unique constraint "shot_lists_project_title_version_key"',
  '(project, title, version) is unique — D14''s "Title · v1" never names two lists');

SELECT throws_ok(
  $$INSERT INTO public.shot_lists (project_id, title, version)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', '   ', 1)$$,
  '23514', 'new row for relation "shot_lists" violates check constraint "shot_lists_title_not_blank_chk"',
  'a blank title is refused (§3: " · v1" alone would collide invisibly)');

-- §9: no DELETE grant, so a delete never even reaches RLS.
SELECT throws_ok(
  $$DELETE FROM public.shot_lists WHERE id = '84840000-0000-0000-0000-0000000000a4'$$,
  '42501', 'permission denied for table shot_lists',
  'authenticated holds no DELETE privilege on shot_lists — archived, never deleted (§9, D4/D18)');


-- ── 42-44: an admin of ANOTHER workspace ──────────────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '22222222-2222-2222-2222-222222222222',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.shot_lists
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  0, 'an admin of a different workspace sees none of this project''s lists (§8)');

SELECT throws_ok(
  $$INSERT INTO public.shot_lists (project_id, title, version)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'cross-tenant', 1)$$,
  '42501', 'new row violates row-level security policy for table "shot_lists"',
  'an admin of a different workspace cannot create a list here (§8)');

-- One message for "not yours" and "not there" (§10): the RPC is not an
-- existence oracle for ids the caller cannot see.
SELECT throws_ok(
  $$SELECT public.set_active_shot_list('aaaa1111-0000-0000-0000-000000000001',
                                       '84840000-0000-0000-0000-0000000000a1')$$,
  'P0002', 'project not found',
  'an admin of a different workspace cannot activate a list here, and is not told the project exists (§10a)');


-- ── 45-54: a PRIVATE project and a second manager seated on it ────────────
-- 80/82's shape. user_f (workspace manager) creates the private project
-- through the client path, so created_by is theirs (fn_audit_touch) and
-- 0020's auto-staff seats them. Postgres then seats user_e as a MANAGER of it:
-- can_edit_shot_lists(private) is TRUE for user_e (the seat), so the only arm
-- left to refuse them is privacy — §8's projects hop on the policies and
-- passes_project_privacy in the definer RPCs.

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok($$
  INSERT INTO public.projects (id, workspace_id, title, is_private)
  VALUES ('aaaa1111-0000-0000-0000-000000000084',
          '11111111-1111-1111-1111-111111111111', 'Private P84', true)
$$, 'SETUP: a workspace manager creates a private project (created_by stamped by fn_audit_touch)');

SELECT lives_ok($$
  INSERT INTO public.shot_lists (id, project_id, title, version)
  VALUES ('84840000-0000-0000-0000-0000000000f1',
          'aaaa1111-0000-0000-0000-000000000084', 'Private list', 1)
$$, 'OWNER CONTROL: the creator adds a list to their private project — the hop admits them');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

INSERT INTO public.project_members
  (project_id, user_id, workspace_id, project_role)
VALUES ('aaaa1111-0000-0000-0000-000000000084', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
        '11111111-1111-1111-1111-111111111111', 'manager')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.shot_lists
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000000084'),
  0, 'the seated second manager sees none of the private project''s lists (§8: the SELECT hop carries 0072''s arm)');

-- 🚨 workspace_id is SENT, not left to the populate trigger: that trigger
-- runs as the caller and reads projects under RLS, so on a private project it
-- would fill nothing and the row would fail the WORKSPACE arm — a refusal for
-- the wrong reason, which is what an attacker's client never hands us. With
-- the column supplied, the only arm that can refuse is the §8 hop.
SELECT throws_ok($$
  INSERT INTO public.shot_lists (id, workspace_id, project_id, title, version)
  VALUES ('84840000-0000-0000-0000-0000000000e1',
          '11111111-1111-1111-1111-111111111111',
          'aaaa1111-0000-0000-0000-000000000084', 'Intruder', 1)
$$, '42501', NULL,
  'a manager SEATED on a private project they did not create cannot add a list to it (§8''s hop — the gate alone says yes)');

SELECT lives_ok($$
  INSERT INTO public.shot_lists (id, workspace_id, project_id, title, version)
  VALUES ('84840000-0000-0000-0000-0000000000a5',
          '11111111-1111-1111-1111-111111111111',
          'aaaa1111-0000-0000-0000-000000000001', 'Second manager draft', 1)
$$, 'CONTROL: the same INSERT into the PUBLIC project lives — workspace, membership and gate all say yes');

SELECT throws_ok(
  $$SELECT public.set_active_shot_list('aaaa1111-0000-0000-0000-000000000084',
                                       '84840000-0000-0000-0000-0000000000f1')$$,
  'P0002', 'project not found',
  'nor activate a list on it — set_active_shot_list''s passes_project_privacy (§10a)');

SELECT lives_ok(
  $$SELECT public.set_active_shot_list('aaaa1111-0000-0000-0000-000000000001',
                                       '84840000-0000-0000-0000-0000000000a2')$$,
  'CONTROL: the same caller activates a list on the PUBLIC project, where they are the project manager');

SELECT throws_ok(
  $$SELECT public.archive_shot_list('84840000-0000-0000-0000-0000000000f1', true)$$,
  'P0002', 'shot list not found',
  'nor archive the private project''s list — archive_shot_list''s passes_project_privacy (§10b; probe 28 is its control)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- The refusals wrote nothing (read as postgres, scoped to fixture ids).
SELECT ok(
  (SELECT active_shot_list_id IS NULL FROM public.projects
    WHERE id = 'aaaa1111-0000-0000-0000-000000000084')
  AND (SELECT archived_at IS NULL FROM public.shot_lists
        WHERE id = '84840000-0000-0000-0000-0000000000f1')
  AND NOT EXISTS (SELECT 1 FROM public.shot_lists
                   WHERE id = '84840000-0000-0000-0000-0000000000e1'),
  'the refused calls changed nothing on the private project: no pointer, the list live, no intruder row');

SELECT is(
  (SELECT active_shot_list_id FROM public.projects
    WHERE id = 'aaaa1111-0000-0000-0000-000000000001'),
  '84840000-0000-0000-0000-0000000000a2'::uuid,
  'and the public-project CONTROL really moved the pointer');


-- ── 55-61: THE BACKFILL (§11, D11) ────────────────────────────────────────
-- CI applies 0084 to an EMPTY database, so its own call backfills nothing
-- there; this is the only place the logic runs against rows. A fresh project
-- with two scenes numbered 2 then 1 (so insertion order and scene order
-- disagree), two shots on the scene numbered 1 (shot_number 2 then 1) and one
-- unlinked shot, and NO list.

INSERT INTO public.projects (id, workspace_id, title, created_by)
VALUES ('aaaa1111-0000-0000-0000-0000000084b0',
        '11111111-1111-1111-1111-111111111111', 'Backfill probe',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

INSERT INTO public.scenes (id, project_id, name, scene_number)
VALUES ('84840000-0000-0000-0000-0000000000b1', 'aaaa1111-0000-0000-0000-0000000084b0', 'SC_TWO', 2),
       ('84840000-0000-0000-0000-0000000000b2', 'aaaa1111-0000-0000-0000-0000000084b0', 'SC_ONE', 1);

INSERT INTO public.shots (id, project_id, scene_id, name, shot_number)
VALUES ('84840000-0000-0000-0000-0000000000d1', 'aaaa1111-0000-0000-0000-0000000084b0',
        '84840000-0000-0000-0000-0000000000b2', 'SH_TWO', 2),
       ('84840000-0000-0000-0000-0000000000d2', 'aaaa1111-0000-0000-0000-0000000084b0',
        '84840000-0000-0000-0000-0000000000b2', 'SH_ONE', 1),
       ('84840000-0000-0000-0000-0000000000d3', 'aaaa1111-0000-0000-0000-0000000084b0',
        NULL, 'SH_UNLINKED', 1);

-- lives_ok, not a bare call: the function raises its own post-condition, and
-- a raise here must be a failed probe, not an aborted run. Its return value
-- is not asserted — on a hosted run other rows may qualify; the effects on
-- the fixture project below are what the probe is about.
SELECT lives_ok(
  $$SELECT public.backfill_shot_lists()$$,
  'backfill_shot_lists() runs as the owner and its post-condition holds (§11)');

SELECT is(
  (SELECT array_agg(title || ' | v' || version || ' | ' || summary ORDER BY id)
     FROM public.shot_lists
    WHERE project_id = 'aaaa1111-0000-0000-0000-0000000084b0'),
  ARRAY['Shot list 1 | v1 | Created from existing scenes']::text[],
  'the project got exactly one list, "Shot list 1" v1, summary "Created from existing scenes" (D11)');

SELECT ok(
  EXISTS (SELECT 1 FROM public.projects p
            JOIN public.shot_lists l ON l.id = p.active_shot_list_id
           WHERE p.id = 'aaaa1111-0000-0000-0000-0000000084b0'
             AND l.project_id = 'aaaa1111-0000-0000-0000-0000000084b0'),
  'the backfilled list is the project''s ACTIVE list (D11)');

SELECT is(
  (SELECT count(*)::int FROM public.shot_list_items
    WHERE project_id = 'aaaa1111-0000-0000-0000-0000000084b0'),
  5, 'it holds all five rows — two scenes and three shots, the unlinked one included (§11)');

SELECT is(
  (SELECT array_agg(scene_id ORDER BY position) FROM public.shot_list_items
    WHERE project_id = 'aaaa1111-0000-0000-0000-0000000084b0' AND scene_id IS NOT NULL),
  ARRAY['84840000-0000-0000-0000-0000000000b2',
        '84840000-0000-0000-0000-0000000000b1']::uuid[],
  'scene positions follow scene_number, not insertion order (§11, D11)');

-- Shot positions restart at 0 per scene AND for the unlinked bucket.
SELECT is(
  (SELECT array_agg(shot_id::text || '@' || position ORDER BY shot_id) FROM public.shot_list_items
    WHERE project_id = 'aaaa1111-0000-0000-0000-0000000084b0' AND shot_id IS NOT NULL),
  ARRAY['84840000-0000-0000-0000-0000000000d1@1',
        '84840000-0000-0000-0000-0000000000d2@0',
        '84840000-0000-0000-0000-0000000000d3@0']::text[],
  'shot positions follow shot_number within their scene and restart at 0 for the unlinked bucket (§11, §4)');

SELECT is(
  public.backfill_shot_lists(), 0,
  'a second call makes nothing — a project with any list is skipped (§11, idempotent)');


-- ── 62-64: deleting the ACTIVE list (as postgres) clears the pointer ──────
-- §7b's one extra pass: the FK's own ON DELETE SET NULL runs an UPDATE on
-- projects after the list row is gone. That is never an authorisation
-- question, and the guard must not turn it into an error.

SELECT lives_ok(
  $$DELETE FROM public.shot_lists WHERE project_id = 'aaaa1111-0000-0000-0000-0000000084b0'$$,
  'deleting the ACTIVE list raises nothing — the guard lets the FK''s SET NULL through (§6a, §7b)');

SELECT ok(
  EXISTS (SELECT 1 FROM public.projects
           WHERE id = 'aaaa1111-0000-0000-0000-0000000084b0' AND active_shot_list_id IS NULL),
  'the project stands, its active_shot_list_id cleared (§6a ON DELETE SET NULL)');

SELECT is(
  (SELECT count(*)::int FROM public.shot_list_items
    WHERE project_id = 'aaaa1111-0000-0000-0000-0000000084b0'),
  0, 'and the list''s items went with it (§4 CASCADE)');


-- ── 65-84: REVIEW ROUNDS 1 AND 2 (2026-09-30) ─────────────────────────────
-- What round 1 added to §7a, and the coverage its reviewers found missing:
-- a list cannot be BORN archived (the INSERT arm); a re-send of an archived
-- list through the cloud adapter's upsert — which now strips archived_at /
-- archived_by (the R1 addendum's F) — meets the UPDATE arm and gets the
-- sentence the Local Server and the fixtures answer with; a plain UPDATE
-- cannot restore; the workspace-ADMIN leg of the RPCs' seat check (every
-- probe above used the project manager's seat); titles stored trimmed (D).
-- Round 2 widened "trimmed" to all whitespace (R2-5, 82-84).
-- Still postgres here (62-64).

-- 65: user_a is tests.rls_setup()'s workspace admin. That helper runs as
-- postgres with no auth.uid(), so 0020's auto-staff seats nobody, and no
-- probe above seats them — checked, not assumed, so the admin leg of §10's
-- seat check is the only thing that can admit them below.
SELECT is(
  (SELECT count(*)::int FROM public.project_members
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'
      AND user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0, 'PRECONDITION: the workspace admin holds no seat on the staffed project_a');

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- 66-69: D8 — SET ACTIVE and ARCHIVE are the workspace admin's as well as
-- the project manager's. The active list is a2 here (probe 51's CONTROL moved
-- it), so a3 can be made active and a1 is free to archive.
SELECT lives_ok(
  $$SELECT public.set_active_shot_list('aaaa1111-0000-0000-0000-000000000001',
                                       '84840000-0000-0000-0000-0000000000a3')$$,
  'a workspace ADMIN with no seat sets the active list (§10a: the current_app_role() = ''admin'' leg, D8)');

SELECT is(
  (SELECT active_shot_list_id FROM public.projects
    WHERE id = 'aaaa1111-0000-0000-0000-000000000001'),
  '84840000-0000-0000-0000-0000000000a3'::uuid,
  'and the pointer moved to a3');

SELECT lives_ok(
  $$SELECT public.archive_shot_list('84840000-0000-0000-0000-0000000000a1', true)$$,
  'the same admin archives a NON-active list (§10b, D8)');

SELECT ok(
  (SELECT archived_at IS NOT NULL AND archived_by = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
     FROM public.shot_lists WHERE id = '84840000-0000-0000-0000-0000000000a1'),
  'the archive stamped archived_at and archived_by = the admin (§10b)');

-- 70-73: the REVIEWER, while a1 is archived.
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

-- §7a's INSERT arm (the merge review of S3a's adapters: the guard was
-- UPDATE-only, so a row that ARRIVED archived skipped the RPC). The insert
-- policy admits a reviewer (probe 16), so the guard is all that stands here.
SELECT throws_ok(
  $$INSERT INTO public.shot_lists (id, project_id, title, version, archived_at)
    VALUES ('84840000-0000-0000-0000-0000000001a1',
            'aaaa1111-0000-0000-0000-000000000001', 'Born archived', 1, now())$$,
  '42501', 'shot lists are archived and restored only by a project manager or a workspace admin, through archive_shot_list()',
  'a reviewer cannot INSERT a list that is already archived (§7a''s INSERT arm)');

SELECT throws_ok(
  $$INSERT INTO public.shot_lists (id, project_id, title, version, archived_by)
    VALUES ('84840000-0000-0000-0000-0000000001a2',
            'aaaa1111-0000-0000-0000-000000000001', 'Born archived by', 1,
            'cccccccc-cccc-cccc-cccc-cccccccccccc')$$,
  '42501', 'shot lists are archived and restored only by a project manager or a workspace admin, through archive_shot_list()',
  'nor one carrying only archived_by — the arm checks either column (§7a)');

-- The upsert the cloud adapter sends (R1 addendum F): every payload column in
-- the ON CONFLICT SET list and NO archive column, so the proposed row passes
-- the INSERT arm and the conflict reaches the UPDATE arm, which refuses any
-- change to an archived row — the same sentence as the other two backends.
SELECT throws_ok(
  $$INSERT INTO public.shot_lists (id, project_id, title, version, summary)
    VALUES ('84840000-0000-0000-0000-0000000000a1',
            'aaaa1111-0000-0000-0000-000000000001', 'Main cut', 1, 'Re-sent while archived')
    ON CONFLICT (id) DO UPDATE
       SET project_id = EXCLUDED.project_id, title = EXCLUDED.title,
           version = EXCLUDED.version, summary = EXCLUDED.summary$$,
  '42501', 'this shot list is archived — restore it before changing it',
  'an upsert re-send of an ARCHIVED list that omits archived_at/archived_by gets the archived sentence (§7a UPDATE arm, R1-F)');

-- CONTROL: the identical re-send of a LIVE list lives, so the refusal above
-- is the archived arm, not the upsert's shape or the reviewer's seat.
SELECT lives_ok(
  $$INSERT INTO public.shot_lists (id, project_id, title, version, summary)
    VALUES ('84840000-0000-0000-0000-0000000000a4',
            'aaaa1111-0000-0000-0000-000000000001', 'Manager draft', 1, 'Re-sent while live')
    ON CONFLICT (id) DO UPDATE
       SET project_id = EXCLUDED.project_id, title = EXCLUDED.title,
           version = EXCLUDED.version, summary = EXCLUDED.summary$$,
  'CONTROL: the same re-send of a LIVE list lives');

-- 74: the MEMBER tries the restore a plain UPDATE would be.
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

SELECT throws_ok(
  $$UPDATE public.shot_lists SET archived_at = NULL
     WHERE id = '84840000-0000-0000-0000-0000000000a1'$$,
  '42501', 'shot lists are archived and restored only by a project manager or a workspace admin, through archive_shot_list()',
  'a member cannot RESTORE a list by clearing archived_at — only archive_shot_list() restores (§7a, D8)');

-- 75-84: the ADMIN restores; then titles are stored trimmed.
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

SELECT lives_ok(
  $$SELECT public.archive_shot_list('84840000-0000-0000-0000-0000000000a1', false)$$,
  'the admin restores the list (p_archived false, §10b)');

SELECT ok(
  (SELECT archived_at IS NULL AND archived_by IS NULL
     FROM public.shot_lists WHERE id = '84840000-0000-0000-0000-0000000000a1'),
  'the restore cleared archived_at and archived_by (§10b)');

-- R1 addendum D: §7a stores the title trimmed on every path, so the
-- (project, title, version) key compares what the Local Server and the
-- provider compare. Untrimmed, "Reviewer cut " and "Reviewer cut" would be two
-- lists that both render as "Reviewer cut · v1".
SELECT lives_ok(
  $$INSERT INTO public.shot_lists (id, project_id, title, version)
    VALUES ('84840000-0000-0000-0000-0000000001a3',
            'aaaa1111-0000-0000-0000-000000000001', '  Trimmed  ', 1)$$,
  'a list titled with surrounding spaces is created (§7a, R1-D)');

SELECT is(
  (SELECT title FROM public.shot_lists WHERE id = '84840000-0000-0000-0000-0000000001a3'),
  'Trimmed', 'and its title is stored trimmed');

SELECT throws_ok(
  $$INSERT INTO public.shot_lists (project_id, title, version)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'Reviewer cut ', 1)$$,
  '23505', 'duplicate key value violates unique constraint "shot_lists_project_title_version_key"',
  'a trailing-space twin of the existing "Reviewer cut · v1" collides — the key compares the TRIMMED title (R1-D)');

SELECT lives_ok(
  $$UPDATE public.shot_lists SET title = '  Manager cut  '
     WHERE id = '84840000-0000-0000-0000-0000000000a4'$$,
  'a rename with surrounding spaces lives (the UPDATE path)');

SELECT is(
  (SELECT title FROM public.shot_lists WHERE id = '84840000-0000-0000-0000-0000000000a4'),
  'Manager cut', 'and the UPDATE path stores it trimmed too (§7a trims before any other check)');

-- 82-84, review round 2 (R2-5): round 1's btrim() stripped SPACES only, while
-- the Local Server, the fixtures and the provider trim with JS trim(), which
-- strips every whitespace character. A title arriving as "\tMain\n" (PostgREST,
-- tooling) was stored as-is next to "Main" — two lists both shown "Main · v1"
-- — and a title of only a tab passed the blank-title CHECK that the other
-- backends' 400 refuses. §7a now strips [[:space:]] from both ends. E'' so
-- the tab and the newline are real characters, not backslash text.
SELECT lives_ok(
  $$INSERT INTO public.shot_lists (id, project_id, title, version)
    VALUES ('84840000-0000-0000-0000-0000000001a4',
            'aaaa1111-0000-0000-0000-000000000001', E'\tTabbed title\n', 1)$$,
  'a list titled with a leading TAB and a trailing NEWLINE is created (§7a, R2-5)');

SELECT is(
  (SELECT title FROM public.shot_lists WHERE id = '84840000-0000-0000-0000-0000000001a4'),
  'Tabbed title', 'and its title is stored with both stripped — all whitespace, not spaces only (R2-5)');

-- Trimmed to '' by §7a (a BEFORE trigger, so it runs before any CHECK), the
-- title then fails shot_lists_title_not_blank_chk. With spaces-only trimming
-- this row was stored.
SELECT throws_ok(
  $$INSERT INTO public.shot_lists (project_id, title, version)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', E'\t\n', 1)$$,
  '23514', 'new row for relation "shot_lists" violates check constraint "shot_lists_title_not_blank_chk"',
  'a title that is only a tab and a newline is blank once trimmed, and refused (§3 CHECK after §7a''s trim, R2-5)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;


-- ── 85-87: privileges (§9, §10, §11) ──────────────────────────────────────
-- 0011's blanket GRANT plus its default privileges left anon holding every
-- privilege on 25 tables until 0033; a policy-only check passes while a
-- privilege hole is wide open (S21).

SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.shot_lists', 'SELECT') OR
    has_table_privilege('anon', 'public.shot_lists', 'INSERT') OR
    has_table_privilege('anon', 'public.shot_lists', 'UPDATE') OR
    has_table_privilege('anon', 'public.shot_lists', 'DELETE')
  ),
  'anon holds no table privilege on shot_lists (§9)');

SELECT ok(
  NOT (
    has_function_privilege('anon', 'public.set_active_shot_list(uuid, uuid)', 'EXECUTE') OR
    has_function_privilege('anon', 'public.archive_shot_list(uuid, boolean)', 'EXECUTE') OR
    has_function_privilege('anon', 'public.archive_edit(uuid, boolean)', 'EXECUTE') OR
    has_function_privilege('anon', 'public.can_edit_shot_lists(uuid)', 'EXECUTE') OR
    has_function_privilege('anon', 'public.replace_shot_list_items(uuid, jsonb)', 'EXECUTE')
  )
  AND has_function_privilege('authenticated', 'public.set_active_shot_list(uuid, uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.archive_shot_list(uuid, boolean)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.archive_edit(uuid, boolean)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.can_edit_shot_lists(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.replace_shot_list_items(uuid, jsonb)', 'EXECUTE'),
  'anon executes none of the five shot-list functions; authenticated executes all five (§2, §10)');

SELECT ok(
  NOT (
    has_function_privilege('anon', 'public.backfill_shot_lists()', 'EXECUTE') OR
    has_function_privilege('authenticated', 'public.backfill_shot_lists()', 'EXECUTE')
  ),
  'no client role executes backfill_shot_lists (§11)');

SELECT * FROM finish();
ROLLBACK;
