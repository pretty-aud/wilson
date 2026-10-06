-- =========================================================================
-- 54_task_templates.sql — Session 28, migration 0044.
--
-- What it PINS:
--  1. The standing structural block — table, RLS enabled AND forced, four
--     policies, no FOR ALL arm, the touch trigger (1-5).
--  2. 🚨 AUDREY'S ACTUAL RULE (2026-08-04), written NON-PRIVILEGED CASE FIRST
--     because that is the half a permissive mistake passes silently: admins
--     and workspace managers write anything in their workspace, a project
--     manager writes only templates pinned to THEIR project, and an ordinary
--     project member writes nothing while still reading everything (6-18).
--  3. 🚨 THE TENANCY FIX (8-9). Local Server's GET /projects/:id/task-
--     templates filters on project_id ALONE and would hand another
--     workspace its global templates. The cloud read must not port that
--     predicate. Probe 8 is the PRESENCE CONTROL for probe 9's absence —
--     standing rule 2, because a suite that only ever proves "sees nothing"
--     also passes when the table is empty for an unrelated reason.
--  4. 🚨 THE USING-vs-WITH-CHECK ESCAPE (15) — and NOT the version of it you
--     would expect. Omitting WITH CHECK is safe: Postgres reuses USING as
--     the new-row check. What opens the hole is a WITH CHECK that is merely
--     WEAKER than USING, which is the shape every other UPDATE policy in
--     this schema already uses. Drop can_write_task_template from it and a
--     project manager can re-point their own pinned template at project_id
--     NULL, ending up with a workspace-wide template they could never have
--     created. Both spellings were run against wilson-dev; only the weakened
--     one failed this probe.
--  5. Integrity the policies cannot express (19-22): tasks is an array, a
--     pin cannot cross a workspace, and deleting a template does not delete
--     the assets built from it.
--  6. anon reaches neither the table nor the predicate (23-24).
--
-- CONTEXT worth carrying: at the time this was written the feature had never
-- produced a row on ANY backend — the Local Server template directory exists
-- and is empty. Every probe below therefore describes behaviour that has
-- never been exercised by a user, which is exactly why the session does not
-- end here. See 0044's header.
-- =========================================================================
BEGIN;

SELECT plan(24);

SELECT * FROM tests.rls_setup();

-- ── Extra fixtures ───────────────────────────────────────────────────────
-- rls_setup gives two workspace ADMINS. The rule under test distinguishes
-- four seats, three of which it does not supply:
--
--   user_c  app_role 'user',    project_a manager  -> writes PINNED only
--   user_d  app_role 'user',    project_a member   -> reads, writes nothing
--   user_e  app_role 'manager', no project seat    -> writes anything in ws_a

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now()),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user_d@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now()),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user_e@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user',    'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111',
   'dddddddd-dddd-dddd-dddd-dddddddddddd', 'user',    'user_d', 'User D', true),
  ('11111111-1111-1111-1111-111111111111',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'manager', 'user_e', 'User E', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.project_members
  (project_id, user_id, workspace_id, project_role)
VALUES
  ('aaaa1111-0000-0000-0000-000000000001',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'manager'),
  ('aaaa1111-0000-0000-0000-000000000001',
   'dddddddd-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;

-- One asset, for the ON DELETE SET NULL probe at the end. Seeded as postgres
-- so that probe does not depend on the assets policies passing first.
INSERT INTO public.assets (id, project_id, name) VALUES
  ('aaaa1111-0000-0000-0000-00000000aa01',
   'aaaa1111-0000-0000-0000-000000000001', 'Asset A')
ON CONFLICT (id) DO NOTHING;

-- Workspace B's own global template — the PRESENCE CONTROL for probe 9.
INSERT INTO public.task_templates (id, workspace_id, project_id, name)
VALUES ('77770000-0000-0000-0000-0000000000b0',
        '22222222-2222-2222-2222-222222222222', NULL, 'B Global')
ON CONFLICT (id) DO NOTHING;


-- ── 1-5: the standing structural block ───────────────────────────────────

SELECT has_table('public'::name, 'task_templates'::name,
  'task_templates table exists');

SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.task_templates'::regclass),
  'task_templates has RLS enabled and forced');

-- A broad FOR ALL arm ORs with every narrow arm beside it and silently wins.
-- 0029 exists specifically to undo one; this stops another appearing.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'task_templates' AND cmd = 'ALL'),
  0, 'task_templates has no FOR ALL policy');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'task_templates'),
  4, 'task_templates has exactly four policies (select/insert/update/delete)');

SELECT has_trigger('public', 'task_templates', 'trg_task_templates_touch',
  'task_templates maintains updated_at');


-- ── 6-7: a workspace ADMIN writes both kinds ─────────────────────────────

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
  $$INSERT INTO public.task_templates (id, workspace_id, project_id, name, tasks)
    VALUES ('77770000-0000-0000-0000-0000000000a1',
            '11111111-1111-1111-1111-111111111111', NULL, 'A Global',
            '[{"id":"11111111-0000-0000-0000-000000000001","name":"Model",
               "role_slug":"modeler","bid_days":3,"sort_order":0,
               "depends_on":[]}]'::jsonb)$$,
  'a workspace admin creates a GLOBAL template');

SELECT lives_ok(
  $$INSERT INTO public.task_templates (id, workspace_id, project_id, name)
    VALUES ('77770000-0000-0000-0000-0000000000a2',
            '11111111-1111-1111-1111-111111111111',
            'aaaa1111-0000-0000-0000-000000000001', 'A Pinned')$$,
  'a workspace admin creates a template PINNED to a project');


-- ── 8-9: the tenancy fix, with its presence control ──────────────────────
--
-- Local Server's project read filters on project_id alone, so it returns
-- every global template in the store regardless of owner. Here RLS supplies
-- the workspace scope that predicate omits — which is why the cloud adapter
-- can run the same `project_id IS NULL OR project_id = x` filter safely.

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
  (SELECT count(*)::int FROM public.task_templates
    WHERE workspace_id = '22222222-2222-2222-2222-222222222222'),
  1, 'workspace B''s admin DOES see workspace B''s own template (presence control)');

SELECT is(
  (SELECT count(*)::int FROM public.task_templates
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'),
  0, 'workspace B''s admin sees NONE of workspace A''s templates, global included');


-- ── 10-12: a project MEMBER reads everything and writes nothing ──────────
--
-- Reading is not a judgement call: the New Asset dialog's Task Template
-- dropdown is reached by anyone who can create an asset, which is
-- can_write_project — members included. A template nobody can read is a
-- template nobody can use.

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

SELECT is(
  (SELECT count(*)::int FROM public.task_templates),
  2, 'a project member READS both the global and the pinned template');

SELECT throws_ok(
  $$INSERT INTO public.task_templates (workspace_id, project_id, name)
    VALUES ('11111111-1111-1111-1111-111111111111', NULL, 'Sneaky')$$,
  'new row violates row-level security policy for table "task_templates"',
  'a project member cannot create a template');

-- The silent-zero-rows hazard: an RLS-refused UPDATE raises nothing and
-- affects no rows, so a client checking only for an error concludes the write
-- landed. Prove the row is untouched rather than trusting the missing error.
UPDATE public.task_templates SET name = 'Hijacked'
 WHERE id = '77770000-0000-0000-0000-0000000000a1';

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT name FROM public.task_templates
    WHERE id = '77770000-0000-0000-0000-0000000000a1'),
  'A Global',
  'a member''s UPDATE raises no error and changes nothing (silent-zero-rows)');


-- ── 13-17: a project MANAGER — their own pin, and nothing else ───────────

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$UPDATE public.task_templates
       SET tasks = '[{"id":"11111111-0000-0000-0000-000000000009","name":"Rig",
                      "role_slug":"rigger","bid_days":2,"sort_order":0,
                      "depends_on":[]}]'::jsonb
     WHERE id = '77770000-0000-0000-0000-0000000000a2'$$,
  'a project manager edits the template pinned to THEIR project');

SELECT is(
  (SELECT jsonb_array_length(tasks) FROM public.task_templates
    WHERE id = '77770000-0000-0000-0000-0000000000a2'),
  1, '...and the edit actually landed');

-- 🚨 The USING-vs-WITH-CHECK escape. USING passes (the OLD row is pinned to
-- their project); the new-row check is what refuses. MEASURED: weakening
-- WITH CHECK to the workspace clause alone makes THIS probe, and only this
-- probe, fail — while removing WITH CHECK altogether changes nothing,
-- because Postgres then reuses USING. See 0044's section 5.
SELECT throws_ok(
  $$UPDATE public.task_templates SET project_id = NULL
     WHERE id = '77770000-0000-0000-0000-0000000000a2'$$,
  'new row violates row-level security policy for table "task_templates"',
  'a project manager cannot promote their pinned template to global');

UPDATE public.task_templates SET name = 'Hijacked'
 WHERE id = '77770000-0000-0000-0000-0000000000a1';
DELETE FROM public.task_templates
 WHERE id = '77770000-0000-0000-0000-0000000000a1';

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT name FROM public.task_templates
    WHERE id = '77770000-0000-0000-0000-0000000000a1'),
  'A Global',
  'a project manager cannot edit a GLOBAL template');

SELECT is(
  (SELECT count(*)::int FROM public.task_templates
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'),
  2, '...nor delete one — the DELETE removed nothing');


-- ── 18: a workspace MANAGER with no project seat writes anything ─────────
--
-- The leg that distinguishes this rule from can_write_project: user_e holds
-- no project_members row at all, and must still be able to maintain the
-- workspace's shared templates.

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.task_templates (workspace_id, project_id, name)
    VALUES ('11111111-1111-1111-1111-111111111111', NULL, 'Manager Global')$$,
  'a workspace manager with NO project seat creates a global template');


-- ── 19-20: integrity the policies cannot express ─────────────────────────

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

-- A scalar here makes `(template.tasks || []).length` render NaN and topoSort
-- throw inside the create-asset path, which has a finally but no catch.
SELECT throws_ok(
  $$INSERT INTO public.task_templates (workspace_id, name, tasks)
    VALUES ('11111111-1111-1111-1111-111111111111', 'Bad', '"not-an-array"'::jsonb)$$,
  'new row for relation "task_templates" violates check constraint "task_templates_tasks_is_array_chk"',
  'tasks must be a JSON array');

-- The composite FK, not a policy: RLS passes here (an admin may write any
-- template in their own workspace), so this is refused by referential
-- integrity alone. MATCH SIMPLE leaves global templates unaffected, which is
-- what makes one constraint cover both shapes.
SELECT throws_ok(
  $$INSERT INTO public.task_templates (workspace_id, project_id, name)
    VALUES ('11111111-1111-1111-1111-111111111111',
            'bbbb2222-0000-0000-0000-000000000001', 'Cross')$$,
  'insert or update on table "task_templates" violates foreign key constraint "task_templates_project_workspace_fk"',
  'a template cannot be pinned to another workspace''s project');


-- ── 21-22: assets.task_template_id, and what deleting a template does ────

SELECT has_column('public'::name, 'assets'::name, 'task_template_id'::name,
  'assets records which template was applied');

-- ON DELETE SET NULL, not CASCADE. Deleting a template must never delete the
-- assets built from it — the tasks it generated are already independent rows.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

UPDATE public.assets SET task_template_id = '77770000-0000-0000-0000-0000000000a2'
 WHERE id = 'aaaa1111-0000-0000-0000-00000000aa01';
DELETE FROM public.task_templates
 WHERE id = '77770000-0000-0000-0000-0000000000a2';

SELECT is(
  (SELECT count(*)::int FROM public.assets
    WHERE id = 'aaaa1111-0000-0000-0000-00000000aa01'
      AND task_template_id IS NULL),
  1, 'deleting a template nulls the asset''s reference and leaves the asset');


-- ═══════════════════════════════════════════════════════════════════════
-- Catalogue: scan the object, not the list the migration wrote (S22)
-- ═══════════════════════════════════════════════════════════════════════

-- 23: a policy-only check passes happily while a privilege hole is wide open
-- (S21 found 25 such tables that way).
SELECT ok(
  NOT (has_table_privilege('anon', 'public.task_templates', 'SELECT')
    OR has_table_privilege('anon', 'public.task_templates', 'INSERT')
    OR has_table_privilege('anon', 'public.task_templates', 'UPDATE')
    OR has_table_privilege('anon', 'public.task_templates', 'DELETE')),
  'anon holds no privilege on task_templates');

-- 24: the 0011 grantee trap. Functions carry a bare =X/postgres aclitem, so a
-- REVOKE naming only anon can be a silent no-op that reports success.
SELECT ok(
  NOT has_function_privilege('anon', 'public.can_write_task_template(uuid)', 'EXECUTE'),
  'anon cannot execute can_write_task_template');

SELECT * FROM finish();
ROLLBACK;
