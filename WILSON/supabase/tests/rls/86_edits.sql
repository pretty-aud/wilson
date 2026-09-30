-- =============================================================================
-- 86_edits.sql — migration 0084 (post-overhaul bundle S3a, 2026-09-30):
-- EDITS (D6) — an ordered JSONB list of items referencing shots, one linear
-- chain per shot list, archived and never deleted.
--
-- What this pins (each probe names the 0084 section it holds to):
--   * Structure (§5, §7, §8, §10c): RLS enabled AND forced, exactly the
--     three policies select/insert/update — NO delete policy (D4/D18) — both
--     write policies hop to projects and call the gate, the stamp/audit/guard
--     triggers are armed, archive_edit is a definer that calls
--     passes_project_privacy exactly once.
--   * The row's shape (§5): items is an ARRAY, snapshot an object or NULL,
--     the parent is an edit of the SAME list (the composite FK) and never the
--     edit itself, (list, title, version) is unique.
--   * The gate (§2, D8): a reviewer creates an edit and rewrites its items.
--     A member can neither archive through a plain UPDATE (the §7a guard)
--     nor call archive_edit (§10c's seat check), and no edit moves to
--     another list. The PROJECT manager archives; an archived edit is frozen;
--     restore works. authenticated holds no DELETE privilege at all.
--   * D17: deleting a shot leaves the edits that name it alone — the item
--     stays, to be shown as "Missing shot" (why items are JSONB, not FKs).
--   * Deleting a PARENT edit (as postgres; clients cannot) whose ARCHIVED
--     child survives lives: the FK's SET NULL reaches the §7a guard as a
--     nested trigger, and the guard's pg_trigger_depth() arm lets it through
--     — without that arm this delete (and a project purge) would be refused
--     with "this edit is archived".
--   * Deleting a list (as postgres; clients cannot) cascades its edits.
--   * Tenancy: an admin of the other workspace sees nothing and archive_edit
--     answers "edit not found". anon holds nothing.
--
-- Postgres-side reads are ALWAYS scoped to fixture ids — dev carries real
-- projects (S33, 439f702).
-- =============================================================================

BEGIN;

SELECT plan(37);

SELECT * FROM tests.rls_setup();

-- ── Extra fixtures ─────────────────────────────────────────────────────────
-- project_a is STAFFED (suite 84's shape):
--   user_c  app_role 'user', project_a REVIEWER -> edits yes (D8)
--   user_d  app_role 'user', project_a MEMBER   -> edits yes, archive NO
--   user_e  app_role 'user', project_a MANAGER  -> archive YES
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
  ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','user','user_d','User D',true),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','user','user_e','User E',true)
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

-- One scene with two shots; two lists; one edit on each list, both called
-- "Assembly · v1" — legal, because the key is per LIST (§5).
INSERT INTO public.scenes (id, project_id, name, scene_number)
VALUES ('86860000-0000-0000-0000-0000000000c1', 'aaaa1111-0000-0000-0000-000000000001', 'SC1', 1);

INSERT INTO public.shots (id, project_id, scene_id, name, shot_number)
VALUES ('86860000-0000-0000-0000-0000000000d1', 'aaaa1111-0000-0000-0000-000000000001',
        '86860000-0000-0000-0000-0000000000c1', 'SH1', 1),
       ('86860000-0000-0000-0000-0000000000d2', 'aaaa1111-0000-0000-0000-000000000001',
        '86860000-0000-0000-0000-0000000000c1', 'SH2', 2);

INSERT INTO public.shot_lists (id, project_id, title, version)
VALUES ('86860000-0000-0000-0000-0000000000a1', 'aaaa1111-0000-0000-0000-000000000001', 'Main', 1),
       ('86860000-0000-0000-0000-0000000000a2', 'aaaa1111-0000-0000-0000-000000000001', 'Pickups', 1);

INSERT INTO public.edits (id, project_id, shot_list_id, title, version, items)
VALUES ('86860000-0000-0000-0000-0000000000e1', 'aaaa1111-0000-0000-0000-000000000001',
        '86860000-0000-0000-0000-0000000000a1', 'Assembly', 1,
        '[{"id": "86860000-0000-0000-0000-0000000001f1", "scene_id": "86860000-0000-0000-0000-0000000000c1", "shot_id": "86860000-0000-0000-0000-0000000000d1", "label": "1A", "notes": ""}]'::jsonb),
       ('86860000-0000-0000-0000-0000000000eb', 'aaaa1111-0000-0000-0000-000000000001',
        '86860000-0000-0000-0000-0000000000a2', 'Assembly', 1, '[]'::jsonb);


-- ── 1-10: structure (§5, §7, §8, §10c) ────────────────────────────────────

SELECT has_table('public'::name, 'edits'::name, 'edits table exists (§5)');

SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.edits'::regclass),
  'edits has RLS enabled and forced (§8)');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'edits' AND cmd = 'ALL'),
  0, 'edits has no FOR ALL policy (§8)');

SELECT is(
  (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'edits'),
  ARRAY['edits_insert', 'edits_select', 'edits_update']::text[],
  'edits has exactly three policies — select, insert, update, and NO delete policy (D4/D18)');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'edits'
      AND cmd IN ('INSERT', 'UPDATE')
      AND with_check LIKE '%projects%' AND with_check LIKE '%can_edit_shot_lists%'
      AND (cmd = 'INSERT' OR (qual LIKE '%projects%' AND qual LIKE '%can_edit_shot_lists%'))),
  2, 'both edits write policies hop to projects and call can_edit_shot_lists (§8)');

SELECT has_trigger('public', 'edits', 'trg_edits_populate_workspace',
  'edits stamps workspace_id on insert (§7)');

SELECT has_trigger('public', 'edits', 'trg_edits_audit',
  'edits stamps created_by/updated_by through fn_audit_touch (§7)');

SELECT has_trigger('public', 'edits', 'trg_edits_guard',
  'edits carries the archive guard (§7a)');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'archive_edit' AND p.prosecdef),
  'archive_edit exists and is SECURITY DEFINER (§10c)');

-- Comments stripped before counting (0077 §3c).
SELECT is(
  (SELECT (length(b) - length(replace(b, 'passes_project_privacy(', ''))) / length('passes_project_privacy(')
     FROM (SELECT regexp_replace(regexp_replace(
                    pg_get_functiondef('public.archive_edit(uuid, boolean)'::regprocedure),
                    '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g') AS b) s),
  1, 'archive_edit calls passes_project_privacy exactly once, comments stripped (§10c)');


-- ── 11-15: the row's shape (§5), as postgres ──────────────────────────────
-- Matched by SQLSTATE AND message: the message names the constraint.

SELECT throws_ok(
  $$INSERT INTO public.edits (project_id, shot_list_id, title, version, items)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', '86860000-0000-0000-0000-0000000000a1',
            'Items as an object', 1, '{}'::jsonb)$$,
  '23514', 'new row for relation "edits" violates check constraint "edits_items_is_array_chk"',
  'an edit''s items must be a JSON ARRAY (§5)');

SELECT throws_ok(
  $$INSERT INTO public.edits (project_id, shot_list_id, title, version, snapshot)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', '86860000-0000-0000-0000-0000000000a1',
            'Snapshot as an array', 1, '[]'::jsonb)$$,
  '23514', 'new row for relation "edits" violates check constraint "edits_snapshot_is_object_chk"',
  'an edit''s snapshot is an object or NULL — never an array (§5)');

-- D6: one linear chain PER LIST. eb is a real edit, of the other list.
SELECT throws_ok(
  $$INSERT INTO public.edits (project_id, shot_list_id, title, version, parent_edit_id)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', '86860000-0000-0000-0000-0000000000a1',
            'Cross-list child', 1, '86860000-0000-0000-0000-0000000000eb')$$,
  '23503', 'insert or update on table "edits" violates foreign key constraint "edits_parent_same_list_fk"',
  'an edit''s parent must be an edit of the SAME list (§5 composite FK, D6)');

-- The FK alone cannot catch this one: the row satisfies its own
-- (id, shot_list_id) key the moment it exists.
SELECT throws_ok(
  $$INSERT INTO public.edits (id, project_id, shot_list_id, title, version, parent_edit_id)
    VALUES ('86860000-0000-0000-0000-0000000000e0', 'aaaa1111-0000-0000-0000-000000000001',
            '86860000-0000-0000-0000-0000000000a1', 'Own parent', 1,
            '86860000-0000-0000-0000-0000000000e0')$$,
  '23514', 'new row for relation "edits" violates check constraint "edits_not_own_parent_chk"',
  'an edit cannot be its own parent (§5)');

SELECT throws_ok(
  $$INSERT INTO public.edits (project_id, shot_list_id, title, version)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', '86860000-0000-0000-0000-0000000000a1',
            'Assembly', 1)$$,
  '23505', 'duplicate key value violates unique constraint "edits_list_title_version_key"',
  '(list, title, version) is unique — the other list''s "Assembly · v1" did not collide, this one does (§5)');


-- ── 16-18: the REVIEWER creates and rewrites an edit ──────────────────────

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

-- Parent e1 is an edit of the SAME list (probe 13's positive control), and
-- the snapshot is an object (probe 12's).
SELECT lives_ok(
  $$INSERT INTO public.edits (id, project_id, shot_list_id, title, version, parent_edit_id, items, snapshot)
    VALUES ('86860000-0000-0000-0000-0000000000e2', 'aaaa1111-0000-0000-0000-000000000001',
            '86860000-0000-0000-0000-0000000000a1', 'Reviewer cut', 1,
            '86860000-0000-0000-0000-0000000000e1',
            '[{"id": "86860000-0000-0000-0000-0000000002f1", "scene_id": "86860000-0000-0000-0000-0000000000c1", "shot_id": "86860000-0000-0000-0000-0000000000d1", "label": "1A", "notes": ""},
              {"id": "86860000-0000-0000-0000-0000000002f2", "scene_id": "86860000-0000-0000-0000-0000000000c1", "shot_id": "86860000-0000-0000-0000-0000000000d1", "label": "1A again", "notes": "a repeat is allowed (D6)"}]'::jsonb,
            '{"savedAt": "2026-09-30T12:00:00Z"}'::jsonb)$$,
  'a project REVIEWER creates an edit on a list, chained to that list''s edit (§2, D6, D8)');

SELECT lives_ok(
  $$UPDATE public.edits
       SET items = '[{"id": "86860000-0000-0000-0000-0000000002f1", "scene_id": "86860000-0000-0000-0000-0000000000c1", "shot_id": "86860000-0000-0000-0000-0000000000d1", "label": "1A", "notes": ""},
                     {"id": "86860000-0000-0000-0000-0000000002f3", "scene_id": "86860000-0000-0000-0000-0000000000c1", "shot_id": "86860000-0000-0000-0000-0000000000d2", "label": "1B", "notes": ""},
                     {"id": "86860000-0000-0000-0000-0000000002f2", "scene_id": "86860000-0000-0000-0000-0000000000c1", "shot_id": "86860000-0000-0000-0000-0000000000d1", "label": "1A again", "notes": ""}]'::jsonb
     WHERE id = '86860000-0000-0000-0000-0000000000e2'$$,
  'the reviewer rewrites the edit''s items — the whole array in one write (§5)');

-- A refused UPDATE raises nothing: read it back.
SELECT is(
  (SELECT jsonb_array_length(items) FROM public.edits
    WHERE id = '86860000-0000-0000-0000-0000000000e2'),
  3, 'and the three-item array landed');


-- ── 19-21: the MEMBER cannot archive, and no edit changes list ────────────

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
  $$UPDATE public.edits SET archived_at = now()
     WHERE id = '86860000-0000-0000-0000-0000000000e2'$$,
  '42501', 'edits are archived and restored only by a project manager or a workspace admin, through archive_edit()',
  'a member''s UPDATE of archived_at is refused by the guard, although the UPDATE policy admits them (§7a, D8)');

SELECT throws_ok(
  $$SELECT public.archive_edit('86860000-0000-0000-0000-0000000000e2', true)$$,
  '42501', 'only a project manager or a workspace admin can archive or restore an edit',
  'a member cannot call archive_edit (§10c''s seat check, D8)');

SELECT throws_ok(
  $$UPDATE public.edits SET shot_list_id = '86860000-0000-0000-0000-0000000000a2'
     WHERE id = '86860000-0000-0000-0000-0000000000e2'$$,
  '42501', 'an edit cannot move to another shot list',
  'an edit cannot move to another list — the guard pins it (§7a)');


-- ── 22-27: the PROJECT manager archives, and the archive freezes ──────────

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
  $$SELECT public.archive_edit('86860000-0000-0000-0000-0000000000e2', true)$$,
  'a PROJECT manager with app_role ''user'' archives the edit (§10c, D4/D8)');

SELECT ok(
  (SELECT archived_at IS NOT NULL AND archived_by = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid
     FROM public.edits WHERE id = '86860000-0000-0000-0000-0000000000e2'),
  'the archive stamped archived_at and archived_by = the caller (§10c)');

SELECT throws_ok(
  $$UPDATE public.edits SET title = 'Reviewer cut (edited while archived)'
     WHERE id = '86860000-0000-0000-0000-0000000000e2'$$,
  '42501', 'this edit is archived — restore it before changing it',
  'an archived edit''s plain UPDATE is refused, even for the manager (§7a, D4)');

SELECT lives_ok(
  $$SELECT public.archive_edit('86860000-0000-0000-0000-0000000000e2', false)$$,
  'the project manager restores the edit (p_archived false, §10c)');

SELECT ok(
  (SELECT archived_at IS NULL AND archived_by IS NULL
     FROM public.edits WHERE id = '86860000-0000-0000-0000-0000000000e2'),
  'the restore cleared archived_at and archived_by (§10c)');

-- §9: no DELETE grant, so a delete never even reaches RLS.
SELECT throws_ok(
  $$DELETE FROM public.edits WHERE id = '86860000-0000-0000-0000-0000000000e2'$$,
  '42501', 'permission denied for table edits',
  'authenticated holds no DELETE privilege on edits — archived, never deleted (§9, D4/D18)');


-- ── 28-29: an admin of ANOTHER workspace ──────────────────────────────────

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
  (SELECT count(*)::int FROM public.edits
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  0, 'an admin of a different workspace sees none of this project''s edits (§8)');

-- One message for "not yours" and "not there" (§10): no existence oracle.
SELECT throws_ok(
  $$SELECT public.archive_edit('86860000-0000-0000-0000-0000000000e1', true)$$,
  'P0002', 'edit not found',
  'an admin of a different workspace cannot archive an edit here, and is not told it exists (§10c)');


-- ── 30-37: as postgres — D17, the nested SET NULL, the CASCADE, privileges

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- D17: SH2 is item 2 of the reviewer's edit (probe 17). No FK stops the
-- delete and nothing rewrites the edit.
SELECT lives_ok(
  $$DELETE FROM public.shots WHERE id = '86860000-0000-0000-0000-0000000000d2'$$,
  'a shot that an edit names can be deleted — edit items are not FKs (§5, D17)');

SELECT ok(
  EXISTS (SELECT 1 FROM public.edits e
           WHERE e.id = '86860000-0000-0000-0000-0000000000e2'
             AND jsonb_array_length(e.items) = 3
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(e.items) it
                          WHERE it ->> 'shot_id' = '86860000-0000-0000-0000-0000000000d2')),
  'and the edit still holds all three items, the deleted shot''s included — shown as "Missing shot" (D17)');

-- Archive the child e2 through the RPC's own arm — the GUC archive_edit()
-- sets — because the §7a guard refuses postgres as well (only service_role
-- and a nested trigger pass it). The parent's delete below then meets an
-- ARCHIVED survivor.
SELECT set_config('wilson.edit_archive', '86860000-0000-0000-0000-0000000000e2', true);
UPDATE public.edits SET archived_at = now()
 WHERE id = '86860000-0000-0000-0000-0000000000e2';
SELECT set_config('wilson.edit_archive', '', true);

-- 🚨 Deleting the parent e1 fires edits_parent_same_list_fk's ON DELETE SET
-- NULL (parent_edit_id): an UPDATE of the archived child issued BY A TRIGGER,
-- so the guard runs at pg_trigger_depth() 2 and its nested-trigger arm lets
-- it through. Without that arm this raises "this edit is archived — restore
-- it before changing it", and so would a project purge that removes a parent
-- before its archived child.
SELECT lives_ok(
  $$DELETE FROM public.edits WHERE id = '86860000-0000-0000-0000-0000000000e1'$$,
  'deleting a parent edit (as postgres — no client may) whose ARCHIVED child survives raises nothing (§7a''s nested-trigger arm)');

SELECT ok(
  EXISTS (SELECT 1 FROM public.edits
           WHERE id = '86860000-0000-0000-0000-0000000000e2'
             AND parent_edit_id IS NULL AND archived_at IS NOT NULL),
  'the child survives, still archived, with parent_edit_id cleared (§5 ON DELETE SET NULL (parent_edit_id))');

SELECT lives_ok(
  $$DELETE FROM public.shot_lists WHERE id = '86860000-0000-0000-0000-0000000000a1'$$,
  'deleting a list (as postgres — no client may) raises nothing, with an archived edit on it');

SELECT is(
  (SELECT count(*)::int FROM public.edits
    WHERE id IN ('86860000-0000-0000-0000-0000000000e1',
                 '86860000-0000-0000-0000-0000000000e2')),
  0, 'and its remaining edit went with it (§5 edits_list_fk ON DELETE CASCADE)');

SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.edits', 'SELECT') OR
    has_table_privilege('anon', 'public.edits', 'INSERT') OR
    has_table_privilege('anon', 'public.edits', 'UPDATE') OR
    has_table_privilege('anon', 'public.edits', 'DELETE')
  ),
  'anon holds no table privilege on edits (§9)');

SELECT ok(
  NOT has_function_privilege('anon', 'public.archive_edit(uuid, boolean)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.archive_edit(uuid, boolean)', 'EXECUTE'),
  'anon cannot execute archive_edit; authenticated can (§10c)');

SELECT * FROM finish();
ROLLBACK;
