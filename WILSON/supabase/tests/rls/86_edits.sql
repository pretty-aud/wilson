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
--     the parent is an edit of the SAME list (the composite FK), and
--     (list, title, version) is unique. An edit is never its own parent:
--     since review round 2 the §7a guard refuses that first on INSERT (the
--     row's own id does not exist yet), and the CHECK, the backstop on the
--     one path the guard waves through (service_role), is pinned there.
--   * The gate (§2, D8): a reviewer creates an edit and rewrites its items.
--     A member can neither archive through a plain UPDATE (the §7a guard)
--     nor call archive_edit (§10c's seat check), and no edit moves to
--     another list. The PROJECT manager archives; an archived edit is frozen;
--     restore works. authenticated holds no DELETE privilege at all.
--   * D6's ONE LINEAR CHAIN (review round 1, §5's two partial unique indexes
--     and §7a): a second root on a list and a second child of one parent are
--     refused (23505), a child of the latest edit lives, and an edit's parent
--     never changes after creation — the probe is the cycle round 1 found.
--     Review round 2 (§7a's INSERT arm): the parent must ALREADY EXIST when
--     the edit is made. One multi-row INSERT of two edits naming each other
--     — the two-edit cycle the indexes let in — is refused, and so is a
--     parent id that names no edit; both are matched by the guard's own
--     sentence, because the composite FK's refusal is 23503 too.
--   * PRIVATE projects (§8's hop, §7a, §10c's passes_project_privacy): a
--     second manager SEATED on a private project they did not create can
--     neither add a root edit to it (the INSERT policy's hop), nor continue
--     its chain (§7a reads the parent AS THE CALLER, so a parent they cannot
--     see gets the same sentence as an id that names no edit — no existence
--     oracle), nor archive one — beside CONTROLs on the public project — and
--     the refusals change nothing.
--   * A workspace ADMIN with no seat archives and restores an edit (§10c's
--     admin leg; every other archive probe uses the project manager's seat).
--   * D17: deleting a shot leaves the edits that name it alone — the item
--     stays, to be shown as "Missing shot" (why items are JSONB, not FKs).
--   * Deleting edits (as postgres; clients cannot): a MIDDLE edit is refused
--     with 23505 — the FK's SET NULL would make its child a second root
--     beside the root (review round 2: an operator removes edits from the tip
--     backwards, or the whole list). Deleting the ROOT, whose ARCHIVED child
--     survives, lives: the SET NULL reaches the §7a guard as a nested
--     trigger, and the guard's pg_trigger_depth() arm lets it through —
--     without that arm it would be refused with "this edit is archived".
--   * Deleting a list (as postgres; clients cannot) cascades its edits, the
--     whole chain in one statement.
--   * Tenancy: an admin of the other workspace sees nothing and archive_edit
--     answers "edit not found". anon holds nothing.
--
-- Postgres-side reads are ALWAYS scoped to fixture ids — dev carries real
-- projects (S33, 439f702).
-- =============================================================================

BEGIN;

SELECT plan(56);

SELECT * FROM tests.rls_setup();

-- ── Extra fixtures ─────────────────────────────────────────────────────────
-- project_a is STAFFED (suite 84's shape):
--   user_c  app_role 'user', project_a REVIEWER -> edits yes (D8)
--   user_d  app_role 'user', project_a MEMBER   -> edits yes, archive NO
--   user_e  app_role 'user', project_a MANAGER  -> archive YES; also seated
--           MANAGER on the private project, which they did not create
--   user_f  app_role 'manager', no seat on project_a; the private project's
--           creator (85's shape: seeded as postgres with created_by named)
--   user_a  tests.rls_setup()'s workspace ADMIN, seated nowhere
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

-- The private project, created_by user_f: the privacy arm (0072) reads
-- created_by, so seeding it as postgres with the creator named is the row the
-- client path writes (suite 84 walks that path; this suite needs the row).
INSERT INTO public.projects (id, workspace_id, title, is_private, created_by)
VALUES ('aaaa1111-0000-0000-0000-000000000086', '11111111-1111-1111-1111-111111111111',
        'Private P86', true, 'ffffffff-ffff-ffff-ffff-ffffffffffff');

INSERT INTO public.project_members
  (project_id, user_id, workspace_id, project_role)
VALUES
  ('aaaa1111-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1111-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1111-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   '11111111-1111-1111-1111-111111111111', 'manager'),
  ('aaaa1111-0000-0000-0000-000000000086', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
   '11111111-1111-1111-1111-111111111111', 'manager'),
  ('aaaa1111-0000-0000-0000-000000000086', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
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

-- The private project's list and its root edit (ef), for 35-40.
INSERT INTO public.shot_lists (id, project_id, title, version)
VALUES ('86860000-0000-0000-0000-0000000000af', 'aaaa1111-0000-0000-0000-000000000086', 'Private list', 1);

INSERT INTO public.edits (id, project_id, shot_list_id, title, version, items)
VALUES ('86860000-0000-0000-0000-0000000000ef', 'aaaa1111-0000-0000-0000-000000000086',
        '86860000-0000-0000-0000-0000000000af', 'Private assembly', 1, '[]'::jsonb);


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


-- ── 11-16: the row's shape (§5, §7a), as postgres ────────────────────────
-- Matched by SQLSTATE AND message: the message names the constraint (or is
-- the guard's own sentence), so a refusal by something else cannot pass.

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

-- D6: one linear chain PER LIST. eb is a real edit, of the other list, so
-- §7a's existence check (round 2) passes it and the composite FK answers —
-- with the FK's sentence, which the guard's probes (14, 24, 25, 36) must NOT
-- get.
SELECT throws_ok(
  $$INSERT INTO public.edits (project_id, shot_list_id, title, version, parent_edit_id)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', '86860000-0000-0000-0000-0000000000a1',
            'Cross-list child', 1, '86860000-0000-0000-0000-0000000000eb')$$,
  '23503', 'insert or update on table "edits" violates foreign key constraint "edits_parent_same_list_fk"',
  'an edit''s parent must be an edit of the SAME list (§5 composite FK, D6)');

-- 14-15: an edit cannot be its own parent. Review round 2 made §7a refuse an
-- INSERT whose parent does not ALREADY exist, and a row's own id does not
-- exist until the row does — so on INSERT the guard answers before the CHECK
-- is ever evaluated (BEFORE triggers run first), with its own sentence.
SELECT throws_ok(
  $$INSERT INTO public.edits (id, project_id, shot_list_id, title, version, parent_edit_id)
    VALUES ('86860000-0000-0000-0000-0000000000e0', 'aaaa1111-0000-0000-0000-000000000001',
            '86860000-0000-0000-0000-0000000000a1', 'Own parent', 1,
            '86860000-0000-0000-0000-0000000000e0')$$,
  '23503', 'an edit''s parent must be another edit of the same shot list',
  'an edit cannot be its own parent — on INSERT §7a refuses it first: its parent does not exist yet (D6, R2-6)');

-- The CHECK is the backstop where the guard waves a row through: service_role
-- (the operator, Edge Functions) returns from §7a before its INSERT arm. The
-- FK alone cannot catch a self-parent — the row satisfies its own
-- (id, shot_list_id) key the moment it exists. service_role bypasses RLS, so
-- nothing but the CHECK stands here (suite 15 switches role the same way).
SELECT set_config('role', 'service_role', true);

SELECT throws_ok(
  $$INSERT INTO public.edits (id, project_id, shot_list_id, title, version, parent_edit_id)
    VALUES ('86860000-0000-0000-0000-0000000000e0', 'aaaa1111-0000-0000-0000-000000000001',
            '86860000-0000-0000-0000-0000000000a1', 'Own parent', 1,
            '86860000-0000-0000-0000-0000000000e0')$$,
  '23514', 'new row for relation "edits" violates check constraint "edits_not_own_parent_chk"',
  'past the guard, as service_role, the CHECK still refuses an edit that is its own parent (§5)');

RESET ROLE;

SELECT throws_ok(
  $$INSERT INTO public.edits (project_id, shot_list_id, title, version)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', '86860000-0000-0000-0000-0000000000a1',
            'Assembly', 1)$$,
  '23505', 'duplicate key value violates unique constraint "edits_list_title_version_key"',
  '(list, title, version) is unique — the other list''s "Assembly · v1" did not collide, this one does (§5)');


-- ── 17-19: the REVIEWER creates and rewrites an edit ──────────────────────

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


-- ── 20-25: D6 — ONE linear chain per list (review rounds 1 and 2) ─────────
-- Still the reviewer. Main's chain is e1 -> e2. Round 1 found branches and
-- cycles accepted; §5's two partial unique indexes now forbid a second root
-- and a second child, and §7a fixes an edit's parent when it is made (and,
-- since round 2, requires that parent to exist already). Each title below is
-- new to Main, so the one key a probe can trip is its own.

SELECT throws_ok(
  $$INSERT INTO public.edits (project_id, shot_list_id, title, version)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', '86860000-0000-0000-0000-0000000000a1',
            'Second root', 1)$$,
  '23505', 'duplicate key value violates unique constraint "edits_one_root_per_list_key"',
  'a list has ONE root edit — a second parentless edit on Main is refused (§5, D6)');

SELECT throws_ok(
  $$INSERT INTO public.edits (project_id, shot_list_id, title, version, parent_edit_id)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', '86860000-0000-0000-0000-0000000000a1',
            'Branch', 1, '86860000-0000-0000-0000-0000000000e1')$$,
  '23505', 'duplicate key value violates unique constraint "edits_one_child_key"',
  'an edit has ONE child — a second child of e1, which already has e2, is refused: no branches (§5, D6)');

SELECT lives_ok(
  $$INSERT INTO public.edits (id, project_id, shot_list_id, title, version, parent_edit_id)
    VALUES ('86860000-0000-0000-0000-0000000000e3', 'aaaa1111-0000-0000-0000-000000000001',
            '86860000-0000-0000-0000-0000000000a1', 'Continued', 1,
            '86860000-0000-0000-0000-0000000000e2')$$,
  'CONTROL: a child of the LATEST edit (e2) lives — the chain continues from its end');

-- The cycle round 1 named, e1 -> e2 -> e3 -> e1. Nothing but the guard
-- refuses it: e3 has no child yet, Main would merely have no root, and e3 is
-- an edit of the same list, so the composite FK is satisfied.
SELECT throws_ok(
  $$UPDATE public.edits SET parent_edit_id = '86860000-0000-0000-0000-0000000000e3'
     WHERE id = '86860000-0000-0000-0000-0000000000e1'$$,
  '42501', 'an edit''s place in its chain cannot change',
  'an edit''s parent cannot change after creation — here the change would close a cycle (§7a, D6)');

-- 24-25, review round 2 (closure#6): the cycle an INSERT could still make.
-- One multi-row INSERT naming two fresh edits as each other's parent passed
-- everything else — the self-FK is checked at the END of the statement, when
-- both rows exist; neither row is a root and each parent gets one child, so
-- both indexes pass — and left a two-edit loop beside the chain, which a
-- walker following parent_edit_id would never leave. §7a's INSERT arm now
-- requires the parent to exist ALREADY: a row-level BEFORE trigger sees the
-- rows earlier in its own statement, never later ones, so the FIRST row of
-- any such loop is refused. Both probes match the guard's SENTENCE: the
-- composite FK refuses with 23503 too (probe 13's text), so the SQLSTATE
-- alone could not tell the guard from it — and 25, without the guard, would
-- reach exactly that FK refusal.
SELECT throws_ok(
  $$INSERT INTO public.edits (id, project_id, shot_list_id, title, version, parent_edit_id)
    VALUES ('86860000-0000-0000-0000-0000000003a1', 'aaaa1111-0000-0000-0000-000000000001',
            '86860000-0000-0000-0000-0000000000a1', 'Loop A', 1,
            '86860000-0000-0000-0000-0000000003a2'),
           ('86860000-0000-0000-0000-0000000003a2', 'aaaa1111-0000-0000-0000-000000000001',
            '86860000-0000-0000-0000-0000000000a1', 'Loop B', 1,
            '86860000-0000-0000-0000-0000000003a1')$$,
  '23503', 'an edit''s parent must be another edit of the same shot list',
  'one INSERT of two edits naming EACH OTHER as parent is refused — the first row''s parent does not exist yet (§7a, D6, R2-6)');

SELECT throws_ok(
  $$INSERT INTO public.edits (project_id, shot_list_id, title, version, parent_edit_id)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', '86860000-0000-0000-0000-0000000000a1',
            'Orphan', 1, '86860000-0000-0000-0000-0000000003ff')$$,
  '23503', 'an edit''s parent must be another edit of the same shot list',
  'an edit naming a parent id that is no edit at all is refused with §7a''s sentence, not the FK''s (D6, R2-6)');


-- ── 26-28: the MEMBER cannot archive, and no edit changes list ────────────

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


-- ── 29-34: the PROJECT manager archives, and the archive freezes ──────────

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


-- ── 35-40: a PRIVATE project and a second manager seated on it ────────────
-- 84/85's shape. Still user_e: a project MANAGER here and, seated by
-- postgres, on the private project user_f created. can_edit_shot_lists and
-- archive_edit's seat check both say yes to them there, so what refuses them
-- is privacy — §8's projects hop on the INSERT policy, §7a's parent check
-- (which reads edits as the caller), and passes_project_privacy in
-- archive_edit.

-- 🚨 workspace_id is SENT (suite 82's note): the populate trigger reads
-- projects as the caller and would fill nothing on a private project, and the
-- row would then fail the WORKSPACE arm — a refusal for the wrong reason.
--
-- 35: a ROOT edit (no parent), so §7a's parent check has nothing to read and
-- the INSERT policy's projects hop is the one arm left. Matched by RLS's own
-- sentence: Postgres checks the policy BEFORE the unique indexes, so were the
-- hop gone this row would reach edits_one_root_per_list_key (the private list
-- already has its root, ef) and fail with 23505 instead. (Round 1 continued
-- the chain from ef here; since round 2 §7a refuses that first — 36.)
SELECT throws_ok($$
  INSERT INTO public.edits (id, workspace_id, project_id, shot_list_id, title, version)
  VALUES ('86860000-0000-0000-0000-0000000000e7', '11111111-1111-1111-1111-111111111111',
          'aaaa1111-0000-0000-0000-000000000086', '86860000-0000-0000-0000-0000000000af',
          'Intruder root', 1)
$$, '42501', 'new row violates row-level security policy for table "edits"',
  'a manager SEATED on a private project they did not create cannot add an edit to it (§8''s hop — the gate alone says yes)');

-- 36: continuing the private chain from ef. §7a's existence check reads
-- edits AS THE CALLER, and ef is on a project user_e cannot see, so for them
-- it does not exist: the answer is word for word what an id naming no edit
-- gets (probe 25). A check that read past RLS would find ef, and the RLS
-- refusal that followed would tell a hidden edit apart from a made-up id.
SELECT throws_ok($$
  INSERT INTO public.edits (id, workspace_id, project_id, shot_list_id, title, version, parent_edit_id)
  VALUES ('86860000-0000-0000-0000-0000000000e9', '11111111-1111-1111-1111-111111111111',
          'aaaa1111-0000-0000-0000-000000000086', '86860000-0000-0000-0000-0000000000af',
          'Intruder cut', 1, '86860000-0000-0000-0000-0000000000ef')
$$, '23503', 'an edit''s parent must be another edit of the same shot list',
  'nor continue its chain: a parent on a project they cannot see does not exist for them — the same sentence as a made-up id, no existence oracle (§7a, R2-6)');

-- CONTROL for both: the same caller continues the PUBLIC project's chain
-- (Pickups, from eb), the shape of 36, and it lives.
SELECT lives_ok($$
  INSERT INTO public.edits (id, workspace_id, project_id, shot_list_id, title, version, parent_edit_id)
  VALUES ('86860000-0000-0000-0000-0000000000e8', '11111111-1111-1111-1111-111111111111',
          'aaaa1111-0000-0000-0000-000000000001', '86860000-0000-0000-0000-0000000000a2',
          'Second manager cut', 1, '86860000-0000-0000-0000-0000000000eb')
$$, 'CONTROL: the same INSERT on the PUBLIC project''s list lives');

SELECT throws_ok(
  $$SELECT public.archive_edit('86860000-0000-0000-0000-0000000000ef', true)$$,
  'P0002', 'edit not found',
  'nor archive the private project''s edit — archive_edit''s passes_project_privacy, and no hint that it exists (§10c)');

SELECT lives_ok(
  $$SELECT public.archive_edit('86860000-0000-0000-0000-0000000000e8', true)$$,
  'CONTROL: the same caller archives the PUBLIC project''s edit it just made');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- The refusals wrote nothing (read as postgres, scoped to fixture ids).
SELECT ok(
  (SELECT archived_at IS NULL FROM public.edits
    WHERE id = '86860000-0000-0000-0000-0000000000ef')
  AND NOT EXISTS (SELECT 1 FROM public.edits
                   WHERE id IN ('86860000-0000-0000-0000-0000000000e7',
                                '86860000-0000-0000-0000-0000000000e9'))
  AND (SELECT archived_at IS NOT NULL FROM public.edits
        WHERE id = '86860000-0000-0000-0000-0000000000e8'),
  'the refusals changed nothing on the private project (its edit live, neither intruder row), and the CONTROL archive landed');


-- ── 41-45: a workspace ADMIN with no seat archives and restores ──────────
-- D8's other leg: 29-33 used the project manager's seat. user_a is
-- tests.rls_setup()'s admin; that helper runs as postgres with no auth.uid(),
-- so 0020's auto-staff seats nobody — checked first, not assumed.
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

SELECT lives_ok(
  $$SELECT public.archive_edit('86860000-0000-0000-0000-0000000000eb', true)$$,
  'a workspace ADMIN with no seat archives an edit (§10c: the current_app_role() = ''admin'' leg, D8)');

SELECT ok(
  (SELECT archived_at IS NOT NULL AND archived_by = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
     FROM public.edits WHERE id = '86860000-0000-0000-0000-0000000000eb'),
  'the archive stamped archived_at and archived_by = the admin (§10c)');

SELECT lives_ok(
  $$SELECT public.archive_edit('86860000-0000-0000-0000-0000000000eb', false)$$,
  'the admin restores it (p_archived false, §10c)');

SELECT ok(
  (SELECT archived_at IS NULL AND archived_by IS NULL
     FROM public.edits WHERE id = '86860000-0000-0000-0000-0000000000eb'),
  'the restore cleared archived_at and archived_by (§10c)');


-- ── 46-47: an admin of ANOTHER workspace ──────────────────────────────────

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


-- ── 48-56: as postgres — D17, deleting edits, the CASCADE, privileges ────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- D17: SH2 is item 2 of the reviewer's edit (probe 18). No FK stops the
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
-- and a nested trigger pass it). The root's delete below then meets an
-- ARCHIVED survivor.
SELECT set_config('wilson.edit_archive', '86860000-0000-0000-0000-0000000000e2', true);
UPDATE public.edits SET archived_at = now()
 WHERE id = '86860000-0000-0000-0000-0000000000e2';
SELECT set_config('wilson.edit_archive', '', true);

-- 50, review round 2 (sql2#6): Main's chain is e1 -> e2 -> e3 (probe 22).
-- Deleting the MIDDLE edit e2 fires the FK's SET NULL on e3, which would
-- become a second root while e1 is still one, and the non-deferrable one-root
-- index refuses the whole delete. Clients cannot delete edits at all; an
-- operator removes them from the tip backwards, or removes the list (the
-- whole chain goes in one statement, 53).
SELECT throws_ok(
  $$DELETE FROM public.edits WHERE id = '86860000-0000-0000-0000-0000000000e2'$$,
  '23505', 'duplicate key value violates unique constraint "edits_one_root_per_list_key"',
  'deleting a MIDDLE edit (as postgres) is refused — its child would become a second root (§5, D6)');

-- 🚨 Deleting the ROOT e1 fires edits_parent_same_list_fk's ON DELETE SET
-- NULL (parent_edit_id): an UPDATE of the archived child issued BY A TRIGGER,
-- so the guard runs at pg_trigger_depth() 2 and its nested-trigger arm lets
-- it through. Without that arm this raises "this edit is archived — restore
-- it before changing it". e2 becomes the root as e1 goes, so the one-root
-- index is satisfied.
SELECT lives_ok(
  $$DELETE FROM public.edits WHERE id = '86860000-0000-0000-0000-0000000000e1'$$,
  'deleting the ROOT edit (as postgres — no client may) whose ARCHIVED child survives raises nothing (§7a''s nested-trigger arm)');

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
                 '86860000-0000-0000-0000-0000000000e2',
                 '86860000-0000-0000-0000-0000000000e3')),
  0, 'and its remaining chain, e2 -> e3, went with it in one statement (§5 edits_list_fk ON DELETE CASCADE)');

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
