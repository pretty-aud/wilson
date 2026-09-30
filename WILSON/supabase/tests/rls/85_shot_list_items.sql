-- =============================================================================
-- 85_shot_list_items.sql — migration 0084 (post-overhaul bundle S3a,
-- 2026-09-30): list MEMBERSHIP (D1 + D3), replace_shot_list_items and
-- upsert_shot_list_items.
--
-- What this pins (each probe names the 0084 section it holds to):
--   * Structure (§4, §8): RLS enabled AND forced, exactly four policies
--     (removing a shot from a list IS a delete here), every write policy hops
--     to projects and calls can_edit_shot_lists, the stamp and audit
--     triggers are armed, and replace_shot_list_items and
--     upsert_shot_list_items are SECURITY INVOKER — they grant nothing the
--     table's own policies do not (§10d, §10e).
--   * The row's shape (§4): exactly one of scene_id / shot_id, both ways; a
--     list holds each scene and each shot once; an item can only name a
--     scene of ITS OWN project — the composite FK, proved by a caller who can
--     see the other project's scene (a plain FK on scene_id would pass).
--   * The gate on a STAFFED project (§2, D8): a reviewer adds and removes
--     items; a workspace member with no seat cannot.
--   * replace_shot_list_items (§10d): swaps a list's whole membership
--     (count and positions after; a missing position is the item's index; an
--     id already in THIS list keeps its row), is ATOMIC (a call that names
--     another project's scene fails whole and leaves the previous set), and
--     SKIPS an id that belongs to another list rather than rewriting it.
--   * An ARCHIVED list's membership is frozen (review round 1, §4's write
--     policies): a reviewer's add, remove, reorder, replace and upsert on it
--     all fail or match nothing and leave its set as it was — each beside the
--     identical write on a LIVE twin, which lands. A scene delete still takes
--     the scene out of the archived list (the FK CASCADE is not judged by RLS).
--   * upsert_shot_list_items (§10e, the delta write): writes ONLY the rows it
--     names — an unnamed item of the list survives — returns exactly those
--     rows, and skips an id that belongs to another list.
--   * Tenancy: an admin of another workspace sees nothing and the helper
--     answers "shot list not found".
--   * PRIVATE projects (§8's hop): a second manager seated on a private
--     project neither sees its items, adds one, nor reaches it through the
--     helper — with a CONTROL on the public project and a presence check.
--   * Deleting a scene removes it from every list (§4's CASCADE, D3).
--   * anon holds nothing.
--
-- Postgres-side reads are ALWAYS scoped to fixture ids — dev carries real
-- projects (S33, 439f702).
-- =============================================================================

BEGIN;

SELECT plan(55);

SELECT * FROM tests.rls_setup();

-- ── Extra fixtures ─────────────────────────────────────────────────────────
--   user_c  app_role 'user',    project_a REVIEWER -> items yes (D8)
--   user_d  app_role 'user',    project_a MEMBER   (seat only; keeps the
--           project staffed the way suite 84's is)
--   user_e  app_role 'user',    project_a MANAGER, and seated MANAGER on the
--           private project, which they did not create
--   user_f  app_role 'manager', the private project's creator
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
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','user','user_e','User E',true),
  ('11111111-1111-1111-1111-111111111111','ffffffff-ffff-ffff-ffff-ffffffffffff','manager','user_f','User F',true),
  ('11111111-1111-1111-1111-111111111111','99999999-9999-9999-9999-999999999999','user','user_g','User G',true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- A second project in the SAME workspace, unstaffed and public, so its scene
-- is visible to every caller below: the composite FK is then the only thing
-- that can refuse an item naming it.
INSERT INTO public.projects (id, workspace_id, title, created_by)
VALUES ('aaaa1111-0000-0000-0000-000000000285', '11111111-1111-1111-1111-111111111111',
        'Neighbour project', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- The private project, created_by user_f: the privacy arm (0072) reads
-- created_by, so seeding it as postgres with the creator named is the same
-- row the client path writes (suite 84 walks that path; this suite needs the
-- row, not the walk).
INSERT INTO public.projects (id, workspace_id, title, is_private, created_by)
VALUES ('aaaa1111-0000-0000-0000-000000000085', '11111111-1111-1111-1111-111111111111',
        'Private P85', true, 'ffffffff-ffff-ffff-ffff-ffffffffffff');

INSERT INTO public.project_members
  (project_id, user_id, workspace_id, project_role)
VALUES
  ('aaaa1111-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1111-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1111-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   '11111111-1111-1111-1111-111111111111', 'manager'),
  ('aaaa1111-0000-0000-0000-000000000085', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
   '11111111-1111-1111-1111-111111111111', 'manager'),
  ('aaaa1111-0000-0000-0000-000000000085', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   '11111111-1111-1111-1111-111111111111', 'manager')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;

-- project_a: three scenes, two shots on scene 1, one unlinked shot.
INSERT INTO public.scenes (id, project_id, name, scene_number)
VALUES ('85850000-0000-0000-0000-0000000000c1', 'aaaa1111-0000-0000-0000-000000000001', 'SC1', 1),
       ('85850000-0000-0000-0000-0000000000c2', 'aaaa1111-0000-0000-0000-000000000001', 'SC2', 2),
       ('85850000-0000-0000-0000-0000000000c3', 'aaaa1111-0000-0000-0000-000000000001', 'SC3', 3),
       ('85850000-0000-0000-0000-0000000000cb', 'aaaa1111-0000-0000-0000-000000000285', 'NEIGHBOUR', 1),
       ('85850000-0000-0000-0000-0000000000cf', 'aaaa1111-0000-0000-0000-000000000085', 'PRIVATE1', 1),
       ('85850000-0000-0000-0000-0000000000ca', 'aaaa1111-0000-0000-0000-000000000085', 'PRIVATE2', 2);

INSERT INTO public.shots (id, project_id, scene_id, name, shot_number)
VALUES ('85850000-0000-0000-0000-0000000000d1', 'aaaa1111-0000-0000-0000-000000000001',
        '85850000-0000-0000-0000-0000000000c1', 'SH1', 1),
       ('85850000-0000-0000-0000-0000000000d2', 'aaaa1111-0000-0000-0000-000000000001',
        '85850000-0000-0000-0000-0000000000c1', 'SH2', 2),
       ('85850000-0000-0000-0000-0000000000d3', 'aaaa1111-0000-0000-0000-000000000001',
        NULL, 'SH_UNLINKED', 1);

-- Two lists on project_a (LA 'Main', LB 'Pickups') and one on the private
-- project (LP).
INSERT INTO public.shot_lists (id, project_id, title, version)
VALUES ('85850000-0000-0000-0000-0000000000a1', 'aaaa1111-0000-0000-0000-000000000001', 'Main', 1),
       ('85850000-0000-0000-0000-0000000000a2', 'aaaa1111-0000-0000-0000-000000000001', 'Pickups', 1),
       ('85850000-0000-0000-0000-0000000000af', 'aaaa1111-0000-0000-0000-000000000085', 'Private list', 1);

-- LA: SC1 (0), SC2 (1), SH1 (0 within SC1). LB: SC3. LP: PRIVATE1.
INSERT INTO public.shot_list_items (id, shot_list_id, project_id, scene_id, shot_id, position)
VALUES ('85850000-0000-0000-0000-0000000000e1', '85850000-0000-0000-0000-0000000000a1',
        'aaaa1111-0000-0000-0000-000000000001', '85850000-0000-0000-0000-0000000000c1', NULL, 0),
       ('85850000-0000-0000-0000-0000000000e2', '85850000-0000-0000-0000-0000000000a1',
        'aaaa1111-0000-0000-0000-000000000001', '85850000-0000-0000-0000-0000000000c2', NULL, 1),
       ('85850000-0000-0000-0000-0000000000e3', '85850000-0000-0000-0000-0000000000a1',
        'aaaa1111-0000-0000-0000-000000000001', NULL, '85850000-0000-0000-0000-0000000000d1', 0),
       ('85850000-0000-0000-0000-0000000000eb', '85850000-0000-0000-0000-0000000000a2',
        'aaaa1111-0000-0000-0000-000000000001', '85850000-0000-0000-0000-0000000000c3', NULL, 0),
       ('85850000-0000-0000-0000-0000000000ef', '85850000-0000-0000-0000-0000000000af',
        'aaaa1111-0000-0000-0000-000000000085', '85850000-0000-0000-0000-0000000000cf', NULL, 0);

-- Review round 1: three more lists on project_a.
--   LC 'Archived cut' — ARCHIVED below; holds SC2 (1c1) and SH1 (1c2). Its
--      membership is frozen, and SC2's delete (probe 50) must still reach it.
--   LD 'Live twin'    — the same two members, LIVE: every freeze probe runs
--      the identical write here as its CONTROL.
--   LE 'Delta list'   — SC1 (1e1, position 0) and SC3 (1e2, position 1), for
--      upsert_shot_list_items.
INSERT INTO public.shot_lists (id, project_id, title, version)
VALUES ('85850000-0000-0000-0000-0000000000ac', 'aaaa1111-0000-0000-0000-000000000001', 'Archived cut', 1),
       ('85850000-0000-0000-0000-0000000000ad', 'aaaa1111-0000-0000-0000-000000000001', 'Live twin', 1),
       ('85850000-0000-0000-0000-0000000000ae', 'aaaa1111-0000-0000-0000-000000000001', 'Delta list', 1);

INSERT INTO public.shot_list_items (id, shot_list_id, project_id, scene_id, shot_id, position)
VALUES ('85850000-0000-0000-0000-0000000001c1', '85850000-0000-0000-0000-0000000000ac',
        'aaaa1111-0000-0000-0000-000000000001', '85850000-0000-0000-0000-0000000000c2', NULL, 0),
       ('85850000-0000-0000-0000-0000000001c2', '85850000-0000-0000-0000-0000000000ac',
        'aaaa1111-0000-0000-0000-000000000001', NULL, '85850000-0000-0000-0000-0000000000d1', 0),
       ('85850000-0000-0000-0000-0000000001d1', '85850000-0000-0000-0000-0000000000ad',
        'aaaa1111-0000-0000-0000-000000000001', '85850000-0000-0000-0000-0000000000c2', NULL, 0),
       ('85850000-0000-0000-0000-0000000001d2', '85850000-0000-0000-0000-0000000000ad',
        'aaaa1111-0000-0000-0000-000000000001', NULL, '85850000-0000-0000-0000-0000000000d1', 0),
       ('85850000-0000-0000-0000-0000000001e1', '85850000-0000-0000-0000-0000000000ae',
        'aaaa1111-0000-0000-0000-000000000001', '85850000-0000-0000-0000-0000000000c1', NULL, 0),
       ('85850000-0000-0000-0000-0000000001e2', '85850000-0000-0000-0000-0000000000ae',
        'aaaa1111-0000-0000-0000-000000000001', '85850000-0000-0000-0000-0000000000c3', NULL, 1);

-- Archive LC through the RPC's own arm — the GUC archive_shot_list() sets —
-- because §7a refuses postgres too (only service_role and a nested trigger
-- pass it). Its members went in first, while it was live, the order a real
-- list is filled and then archived in.
SELECT set_config('wilson.shot_list_archive', '85850000-0000-0000-0000-0000000000ac', true);
UPDATE public.shot_lists
   SET archived_at = now(), archived_by = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
 WHERE id = '85850000-0000-0000-0000-0000000000ac';
SELECT set_config('wilson.shot_list_archive', '', true);


-- ── 1-9: structure (§4, §8, §10d, §10e) ──────────────────────────────────

SELECT has_table('public'::name, 'shot_list_items'::name, 'shot_list_items table exists (§4)');

SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.shot_list_items'::regclass),
  'shot_list_items has RLS enabled and forced (§8)');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'shot_list_items' AND cmd = 'ALL'),
  0, 'shot_list_items has no FOR ALL policy (§8)');

SELECT is(
  (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'shot_list_items'),
  ARRAY['shot_list_items_delete', 'shot_list_items_insert',
        'shot_list_items_select', 'shot_list_items_update']::text[],
  'shot_list_items has exactly four policies — removing a shot from a list IS a delete here (§8)');

-- §8: every write policy hops to projects and calls the gate (the 0082 §3b
-- lesson). DELETE has only a USING, so COALESCE reads whichever is there.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'shot_list_items'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
      AND COALESCE(with_check, qual) LIKE '%projects%'
      AND COALESCE(with_check, qual) LIKE '%can_edit_shot_lists%'),
  3, 'all three shot_list_items write policies hop to projects and call can_edit_shot_lists (§8)');

SELECT has_trigger('public', 'shot_list_items', 'trg_shot_list_items_populate_workspace',
  'shot_list_items stamps workspace_id on insert (§7)');

SELECT has_trigger('public', 'shot_list_items', 'trg_shot_list_items_audit',
  'shot_list_items stamps created_by/updated_by through fn_audit_touch (§7)');

-- §10d: the helper runs AS THE CALLER, so every row it touches passes the
-- table's own policies. A definer here would be a second, unreviewed gate.
SELECT ok(
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'replace_shot_list_items'
             AND NOT p.prosecdef),
  'replace_shot_list_items exists and is NOT security definer (§10d)');

-- §10e, the same reason: the delta write (review round 1) runs as the caller,
-- which is also what makes the archived-list freeze below reach it.
SELECT ok(
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'upsert_shot_list_items'
             AND NOT p.prosecdef),
  'upsert_shot_list_items exists and is NOT security definer (§10e)');


-- ── 10-13: the row's shape (§4), as postgres ──────────────────────────────
-- Matched by SQLSTATE AND message: the message names the constraint, so a
-- refusal by some other constraint cannot pass for this one.

SELECT throws_ok(
  $$INSERT INTO public.shot_list_items (shot_list_id, project_id, scene_id, shot_id, position)
    VALUES ('85850000-0000-0000-0000-0000000000a1', 'aaaa1111-0000-0000-0000-000000000001',
            NULL, NULL, 5)$$,
  '23514', 'new row for relation "shot_list_items" violates check constraint "shot_list_items_exactly_one_chk"',
  'an item naming NEITHER a scene nor a shot is refused (§4 exactly-one CHECK)');

SELECT throws_ok(
  $$INSERT INTO public.shot_list_items (shot_list_id, project_id, scene_id, shot_id, position)
    VALUES ('85850000-0000-0000-0000-0000000000a1', 'aaaa1111-0000-0000-0000-000000000001',
            '85850000-0000-0000-0000-0000000000c3', '85850000-0000-0000-0000-0000000000d2', 5)$$,
  '23514', 'new row for relation "shot_list_items" violates check constraint "shot_list_items_exactly_one_chk"',
  'an item naming BOTH a scene and a shot is refused (§4 exactly-one CHECK)');

SELECT throws_ok(
  $$INSERT INTO public.shot_list_items (shot_list_id, project_id, scene_id, position)
    VALUES ('85850000-0000-0000-0000-0000000000a1', 'aaaa1111-0000-0000-0000-000000000001',
            '85850000-0000-0000-0000-0000000000c1', 7)$$,
  '23505', 'duplicate key value violates unique constraint "shot_list_items_list_scene_key"',
  'a list holds each scene once (§4 partial unique index)');

SELECT throws_ok(
  $$INSERT INTO public.shot_list_items (shot_list_id, project_id, shot_id, position)
    VALUES ('85850000-0000-0000-0000-0000000000a1', 'aaaa1111-0000-0000-0000-000000000001',
            '85850000-0000-0000-0000-0000000000d1', 7)$$,
  '23505', 'duplicate key value violates unique constraint "shot_list_items_list_shot_key"',
  'a list holds each shot once (§4 partial unique index)');


-- ── 14-26: the REVIEWER — items and the replace helper ────────────────────

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
  $$INSERT INTO public.shot_list_items (id, shot_list_id, project_id, shot_id, position)
    VALUES ('85850000-0000-0000-0000-0000000000e4', '85850000-0000-0000-0000-0000000000a1',
            'aaaa1111-0000-0000-0000-000000000001', '85850000-0000-0000-0000-0000000000d2', 1)$$,
  'a project REVIEWER adds a shot to a list (§2, D8)');

-- The reviewer can SEE the neighbour's scene (a public, unstaffed project in
-- the same workspace) and the RLS check passes (the item's project is
-- project_a). Only the (scene_id, project_id) composite FK can refuse it —
-- a plain FK on scene_id would have let a list hold another project's scene.
SELECT throws_ok(
  $$INSERT INTO public.shot_list_items (shot_list_id, project_id, scene_id, position)
    VALUES ('85850000-0000-0000-0000-0000000000a1', 'aaaa1111-0000-0000-0000-000000000001',
            '85850000-0000-0000-0000-0000000000cb', 9)$$,
  '23503', 'insert or update on table "shot_list_items" violates foreign key constraint "shot_list_items_scene_fk"',
  'an item naming ANOTHER project''s scene is refused by the composite FK (§1, §4)');

SELECT lives_ok(
  $$DELETE FROM public.shot_list_items WHERE id = '85850000-0000-0000-0000-0000000000e4'$$,
  'the reviewer removes it again (§8 shot_list_items_delete)');

-- A refused DELETE raises nothing: read it back, while the reviewer can
-- still see the row if it survived.
SELECT is(
  (SELECT count(*)::int FROM public.shot_list_items
    WHERE id = '85850000-0000-0000-0000-0000000000e4'),
  0, 'and the item is really gone');

-- replace #1: keep e2 (moved to position 0), add SC3 at 1, add SH2 with NO
-- position (its index, 2). e1 (SC1) and e3 (SH1) are not named, so they go.
SELECT lives_ok(
  $$SELECT public.replace_shot_list_items('85850000-0000-0000-0000-0000000000a1', '[
      {"id": "85850000-0000-0000-0000-0000000000e2", "scene_id": "85850000-0000-0000-0000-0000000000c2", "position": 0},
      {"scene_id": "85850000-0000-0000-0000-0000000000c3", "position": 1},
      {"shot_id": "85850000-0000-0000-0000-0000000000d2"}
    ]'::jsonb)$$,
  'the reviewer replaces a list''s whole membership in one call (§10d)');

SELECT is(
  (SELECT count(*)::int FROM public.shot_list_items
    WHERE shot_list_id = '85850000-0000-0000-0000-0000000000a1'),
  3, 'the list now holds exactly the three items named — the two unnamed ones were deleted (§10d)');

SELECT is(
  (SELECT array_agg(COALESCE(scene_id, shot_id) ORDER BY position, id) FROM public.shot_list_items
    WHERE shot_list_id = '85850000-0000-0000-0000-0000000000a1'),
  ARRAY['85850000-0000-0000-0000-0000000000c2',
        '85850000-0000-0000-0000-0000000000c3',
        '85850000-0000-0000-0000-0000000000d2']::uuid[],
  'in the positions given, and a missing position is the item''s index (§10d)');

SELECT ok(
  EXISTS (SELECT 1 FROM public.shot_list_items
           WHERE id = '85850000-0000-0000-0000-0000000000e2'
             AND shot_list_id = '85850000-0000-0000-0000-0000000000a1'
             AND scene_id = '85850000-0000-0000-0000-0000000000c2'
             AND position = 0),
  'an id already in THIS list keeps its row (e2 moved, not re-created — §10d)');

-- replace #2 is ATOMIC: its second item names the neighbour's scene, so the
-- INSERT fails its FK after the DELETE has already run — and the whole call,
-- DELETE included, must roll back.
SELECT throws_ok(
  $$SELECT public.replace_shot_list_items('85850000-0000-0000-0000-0000000000a1', '[
      {"id": "85850000-0000-0000-0000-0000000000e2", "scene_id": "85850000-0000-0000-0000-0000000000c2", "position": 0},
      {"scene_id": "85850000-0000-0000-0000-0000000000cb"}
    ]'::jsonb)$$,
  '23503', NULL,
  'a replace naming another project''s scene fails whole (§10d, the composite FK)');

SELECT is(
  (SELECT array_agg(COALESCE(scene_id, shot_id) ORDER BY position, id) FROM public.shot_list_items
    WHERE shot_list_id = '85850000-0000-0000-0000-0000000000a1'),
  ARRAY['85850000-0000-0000-0000-0000000000c2',
        '85850000-0000-0000-0000-0000000000c3',
        '85850000-0000-0000-0000-0000000000d2']::uuid[],
  'and the previous set is intact — the delete half did not land on its own');

-- replace #3 names eb, which belongs to LB. ON CONFLICT ... WHERE same list
-- skips it: it is neither moved into LA nor rewritten to SC1.
SELECT lives_ok(
  $$SELECT public.replace_shot_list_items('85850000-0000-0000-0000-0000000000a1', '[
      {"id": "85850000-0000-0000-0000-0000000000eb", "scene_id": "85850000-0000-0000-0000-0000000000c1", "position": 0},
      {"id": "85850000-0000-0000-0000-0000000000e2", "scene_id": "85850000-0000-0000-0000-0000000000c2", "position": 1}
    ]'::jsonb)$$,
  'a replace naming another list''s item id raises nothing (§10d)');

SELECT ok(
  EXISTS (SELECT 1 FROM public.shot_list_items
           WHERE id = '85850000-0000-0000-0000-0000000000eb'
             AND shot_list_id = '85850000-0000-0000-0000-0000000000a2'
             AND scene_id = '85850000-0000-0000-0000-0000000000c3'
             AND position = 0),
  'the other list''s item is untouched — still LB''s, still SC3, still position 0 (skipped, not rewritten)');

SELECT is(
  (SELECT array_agg(id ORDER BY id) FROM public.shot_list_items
    WHERE shot_list_id = '85850000-0000-0000-0000-0000000000a1'),
  ARRAY['85850000-0000-0000-0000-0000000000e2']::uuid[],
  'and LA holds only e2 — the skipped id was not written into it');


-- ── 27-38: an ARCHIVED list's membership is frozen (review round 1) ───────
-- Still the reviewer. D4/D18 held only for the list ROW until round 1: any
-- list writer could empty an archived list through PostgREST or the helper.
-- Every items write policy (§4/§8) now also requires the parent list to be
-- live. Each refusal on LC is followed by the IDENTICAL write on LD, its live
-- twin, which must land — so what refuses is the freeze, not the seat, the
-- project or the shape of the write.
--
-- 🚨 RLS refuses differently per command, and these probes follow Postgres:
-- a write that PROPOSES a row (an INSERT, and both helpers, whose INSERT ...
-- ON CONFLICT DO UPDATE meets either the insert WITH CHECK or, for an
-- existing id, the conflict-update USING check — both raise) fails with
-- 42501, so the helpers are matched on the SQLSTATE alone; a plain UPDATE or
-- DELETE whose USING clause excludes the row raises NOTHING — it matches
-- zero rows. Those two are asserted as "0 rows" (the data-modifying-CTE
-- shape of suites 01-08), each against its control's "1 row".

SELECT throws_ok(
  $$INSERT INTO public.shot_list_items (shot_list_id, project_id, shot_id, position)
    VALUES ('85850000-0000-0000-0000-0000000000ac', 'aaaa1111-0000-0000-0000-000000000001',
            '85850000-0000-0000-0000-0000000000d2', 5)$$,
  '42501', 'new row violates row-level security policy for table "shot_list_items"',
  'a reviewer cannot ADD an item to an ARCHIVED list (§4 insert policy, R1-B)');

SELECT lives_ok(
  $$INSERT INTO public.shot_list_items (id, shot_list_id, project_id, shot_id, position)
    VALUES ('85850000-0000-0000-0000-0000000001d3', '85850000-0000-0000-0000-0000000000ad',
            'aaaa1111-0000-0000-0000-000000000001', '85850000-0000-0000-0000-0000000000d2', 5)$$,
  'CONTROL: the same add to the LIVE twin lands');

WITH del AS (
  DELETE FROM public.shot_list_items WHERE id = '85850000-0000-0000-0000-0000000001c2'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM del), 0,
  'a reviewer''s DELETE of an archived list''s item matches no row (§4 delete policy, R1-B)');

WITH del AS (
  DELETE FROM public.shot_list_items WHERE id = '85850000-0000-0000-0000-0000000001d2'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM del), 1,
  'CONTROL: the same DELETE on the live twin removes its item');

WITH upd AS (
  UPDATE public.shot_list_items SET position = 4 WHERE id = '85850000-0000-0000-0000-0000000001c1'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0,
  'a reviewer''s reorder (UPDATE of position) on an archived list matches no row (§4 update policy, R1-B)');

WITH upd AS (
  UPDATE public.shot_list_items SET position = 4 WHERE id = '85850000-0000-0000-0000-0000000001d1'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1,
  'CONTROL: the same reorder on the live twin moves its item');

-- The helpers run AS THE CALLER (§10d, §10e), so the same policies stop
-- them. replace deletes the unnamed rows first — on LC that DELETE matches
-- nothing — then proposes the named ones, and the proposal raises. The set
-- is read back after each refusal.
SELECT throws_ok(
  $$SELECT public.replace_shot_list_items('85850000-0000-0000-0000-0000000000ac', '[
      {"id": "85850000-0000-0000-0000-0000000001c1", "scene_id": "85850000-0000-0000-0000-0000000000c2", "position": 1},
      {"scene_id": "85850000-0000-0000-0000-0000000000c3", "position": 0}
    ]'::jsonb)$$,
  '42501', NULL,
  'replace_shot_list_items on an ARCHIVED list is refused (§10d runs under the frozen policies, R1-B)');

SELECT is(
  (SELECT array_agg(id::text || '@' || position ORDER BY id) FROM public.shot_list_items
    WHERE shot_list_id = '85850000-0000-0000-0000-0000000000ac'),
  ARRAY['85850000-0000-0000-0000-0000000001c1@0',
        '85850000-0000-0000-0000-0000000001c2@0']::text[],
  'and the archived list holds exactly what it held — the refused add, delete, reorder and replace changed nothing');

SELECT lives_ok(
  $$SELECT public.replace_shot_list_items('85850000-0000-0000-0000-0000000000ad', '[
      {"id": "85850000-0000-0000-0000-0000000001d1", "scene_id": "85850000-0000-0000-0000-0000000000c2", "position": 1},
      {"scene_id": "85850000-0000-0000-0000-0000000000c3", "position": 0}
    ]'::jsonb)$$,
  'CONTROL: the same replace on the live twin lives');

SELECT throws_ok(
  $$SELECT public.upsert_shot_list_items('85850000-0000-0000-0000-0000000000ac', '[
      {"id": "85850000-0000-0000-0000-0000000001c1", "scene_id": "85850000-0000-0000-0000-0000000000c2", "position": 2},
      {"shot_id": "85850000-0000-0000-0000-0000000000d2", "position": 0}
    ]'::jsonb)$$,
  '42501', NULL,
  'upsert_shot_list_items on an ARCHIVED list is refused (§10e runs under the frozen policies, R1-B)');

SELECT is(
  (SELECT array_agg(id::text || '@' || position ORDER BY id) FROM public.shot_list_items
    WHERE shot_list_id = '85850000-0000-0000-0000-0000000000ac'),
  ARRAY['85850000-0000-0000-0000-0000000001c1@0',
        '85850000-0000-0000-0000-0000000001c2@0']::text[],
  'and the archived list is still unchanged');

SELECT lives_ok(
  $$SELECT public.upsert_shot_list_items('85850000-0000-0000-0000-0000000000ad', '[
      {"id": "85850000-0000-0000-0000-0000000001d1", "scene_id": "85850000-0000-0000-0000-0000000000c2", "position": 2},
      {"shot_id": "85850000-0000-0000-0000-0000000000d2", "position": 0}
    ]'::jsonb)$$,
  'CONTROL: the same upsert on the live twin lives');


-- ── 39-41: upsert_shot_list_items — the DELTA write (§10e, R1-A) ──────────
-- Still the reviewer, on LE (SC1 at 0, SC3 at 1). The call names three rows:
-- 1e1 moves (SC1 to position 2), 1e3 is new (SC2 at 0), and eb is LB's item,
-- named with a different payload. 1e2 (SC3) is NOT named. Round 1's HIGH was
-- a whole-set write from one client's stale view deleting a collaborator's
-- newer items; the delta form must leave every unnamed row alone.
--
-- The call sits in a DO block inside lives_ok: what it RETURNS is part of the
-- contract (the adapters hand it back as "the rows written"), and a bare call
-- inside is() would abort the whole run if it raised (the map's trap 13).
-- The block raises, naming what it got, when the returned set is wrong.
SELECT lives_ok($q$
  DO $d$
  DECLARE
    v uuid[];
  BEGIN
    SELECT array_agg(r.id ORDER BY r.id) INTO v
      FROM public.upsert_shot_list_items('85850000-0000-0000-0000-0000000000ae', '[
        {"id": "85850000-0000-0000-0000-0000000001e1", "scene_id": "85850000-0000-0000-0000-0000000000c1", "position": 2},
        {"id": "85850000-0000-0000-0000-0000000001e3", "scene_id": "85850000-0000-0000-0000-0000000000c2", "position": 0},
        {"id": "85850000-0000-0000-0000-0000000000eb", "shot_id": "85850000-0000-0000-0000-0000000000d3", "position": 5}
      ]'::jsonb) AS r;
    IF v IS DISTINCT FROM ARRAY['85850000-0000-0000-0000-0000000001e1',
                                '85850000-0000-0000-0000-0000000001e3']::uuid[] THEN
      RAISE EXCEPTION 'upsert_shot_list_items returned %', v;
    END IF;
  END
  $d$
$q$, 'the reviewer upserts three named items and gets back exactly the two written — the moved one and the new one, not the other list''s (§10e)');

SELECT is(
  (SELECT array_agg(COALESCE(scene_id, shot_id)::text || '@' || position ORDER BY id)
     FROM public.shot_list_items
    WHERE shot_list_id = '85850000-0000-0000-0000-0000000000ae'),
  ARRAY['85850000-0000-0000-0000-0000000000c1@2',
        '85850000-0000-0000-0000-0000000000c3@1',
        '85850000-0000-0000-0000-0000000000c2@0']::text[],
  'LE holds the moved SC1, the new SC2 and the UNNAMED SC3 untouched — a delta deletes nothing (§10e, R1-A)');

SELECT ok(
  EXISTS (SELECT 1 FROM public.shot_list_items
           WHERE id = '85850000-0000-0000-0000-0000000000eb'
             AND shot_list_id = '85850000-0000-0000-0000-0000000000a2'
             AND scene_id = '85850000-0000-0000-0000-0000000000c3'
             AND shot_id IS NULL
             AND position = 0),
  'the other list''s item is untouched — still LB''s, still SC3, still position 0 (skipped, not moved or rewritten)');


-- ── 42-43: an admin of ANOTHER workspace ──────────────────────────────────

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
  (SELECT count(*)::int FROM public.shot_list_items
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  0, 'an admin of a different workspace sees none of this project''s items (§8)');

SELECT throws_ok(
  $$SELECT public.replace_shot_list_items('85850000-0000-0000-0000-0000000000a1', '[]'::jsonb)$$,
  'P0002', 'shot list not found',
  'an admin of a different workspace calling the helper gets "shot list not found" (§10d reads as the caller)');


-- ── 44: a workspace member with NO seat on the staffed project ────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '99999999-9999-9999-9999-999999999999',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.shot_list_items (shot_list_id, project_id, scene_id, position)
    VALUES ('85850000-0000-0000-0000-0000000000a1', 'aaaa1111-0000-0000-0000-000000000001',
            '85850000-0000-0000-0000-0000000000c3', 5)$$,
  '42501', 'new row violates row-level security policy for table "shot_list_items"',
  'a workspace member with no seat on a STAFFED project cannot add an item (§2: no unstaffed opening here)');


-- ── 45-48: a second manager SEATED on a private project ───────────────────
-- can_edit_shot_lists(private) is TRUE for user_e (the manager seat), so the
-- only arm left to refuse them is privacy, through §8's projects hop.

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

SELECT is(
  (SELECT count(*)::int FROM public.shot_list_items
    WHERE shot_list_id = '85850000-0000-0000-0000-0000000000af'),
  0, 'the seated second manager sees none of the private list''s items (§8, the SELECT hop)');

-- 🚨 workspace_id is SENT, not left to the populate trigger (suite 82's
-- note): on a private project the trigger would fill nothing and the row
-- would fail the WORKSPACE arm — a refusal for the wrong reason.
SELECT throws_ok($$
  INSERT INTO public.shot_list_items (id, shot_list_id, project_id, workspace_id, scene_id, position)
  VALUES ('85850000-0000-0000-0000-0000000000e9', '85850000-0000-0000-0000-0000000000af',
          'aaaa1111-0000-0000-0000-000000000085', '11111111-1111-1111-1111-111111111111',
          '85850000-0000-0000-0000-0000000000ca', 1)
$$, '42501', NULL,
  'nor add an item to it (§8''s hop — the gate alone says yes)');

SELECT lives_ok($$
  INSERT INTO public.shot_list_items (id, shot_list_id, project_id, workspace_id, scene_id, position)
  VALUES ('85850000-0000-0000-0000-0000000000e8', '85850000-0000-0000-0000-0000000000a1',
          'aaaa1111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
          '85850000-0000-0000-0000-0000000000c1', 5)
$$, 'CONTROL: the same INSERT into the PUBLIC project''s list lives');

SELECT throws_ok(
  $$SELECT public.replace_shot_list_items('85850000-0000-0000-0000-0000000000af', '[]'::jsonb)$$,
  'P0002', 'shot list not found',
  'nor empty the private list through the helper — it reads the list as the caller (§10d)');


-- ── 49-55: as postgres — presence, the scene CASCADE, privileges ──────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT array_agg(id ORDER BY id) FROM public.shot_list_items
    WHERE shot_list_id = '85850000-0000-0000-0000-0000000000af'),
  ARRAY['85850000-0000-0000-0000-0000000000ef']::uuid[],
  'PRESENCE CONTROL: the private list still holds exactly its own item — the refusals were of real rows, and nothing was added or removed');

-- D3: a scene's row is shared by every list, so deleting it takes it out of
-- every list at once. SC2 is in LA as e2 (probe 26), in LC as 1c1 and LD as
-- 1d1 (fixtures), and in LE as 1e3 (probe 39).
SELECT lives_ok(
  $$DELETE FROM public.scenes WHERE id = '85850000-0000-0000-0000-0000000000c2'$$,
  'a scene that a list holds can be deleted');

SELECT is(
  (SELECT count(*)::int FROM public.shot_list_items
    WHERE id = '85850000-0000-0000-0000-0000000000e2'
       OR scene_id = '85850000-0000-0000-0000-0000000000c2'),
  0, 'and its items left every list (§4 ON DELETE CASCADE, D3)');

-- Review round 1's one exception to the freeze: it is a POLICY, and the FK's
-- CASCADE is a referential action RLS does not judge, so a scene delete still
-- takes the scene out of an ARCHIVED list — D3's shared-row rule wins. LC held
-- SC2 as 1c1 until this delete (probes 34 and 37 read it there).
SELECT is(
  (SELECT array_agg(id ORDER BY id) FROM public.shot_list_items
    WHERE shot_list_id = '85850000-0000-0000-0000-0000000000ac'),
  ARRAY['85850000-0000-0000-0000-0000000001c2']::uuid[],
  'the scene delete reached the ARCHIVED list too: its SC2 item is gone and its shot item stays (§4 CASCADE, R1-B)');

SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.shot_list_items', 'SELECT') OR
    has_table_privilege('anon', 'public.shot_list_items', 'INSERT') OR
    has_table_privilege('anon', 'public.shot_list_items', 'UPDATE') OR
    has_table_privilege('anon', 'public.shot_list_items', 'DELETE')
  ),
  'anon holds no table privilege on shot_list_items (§9)');

SELECT ok(
  NOT has_function_privilege('anon', 'public.replace_shot_list_items(uuid, jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.replace_shot_list_items(uuid, jsonb)', 'EXECUTE'),
  'anon cannot execute replace_shot_list_items; authenticated can (§10d)');

SELECT ok(
  NOT has_function_privilege('anon', 'public.upsert_shot_list_items(uuid, jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.upsert_shot_list_items(uuid, jsonb)', 'EXECUTE'),
  'anon cannot execute upsert_shot_list_items; authenticated can (§10e)');

SELECT * FROM finish();
ROLLBACK;
