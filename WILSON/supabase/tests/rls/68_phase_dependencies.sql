-- pgTAP: phase_dependencies (migration 0061)
--
-- The phase→phase sibling of task_dependencies. Parent-join RLS via
-- phases → projects, because phases carries no workspace_id of its own.
--
-- Beyond the usual tenancy assertions this suite pins two things that have no
-- other visible symptom:
--
--   * THE FOREIGN KEYS POINT AT phases, NOT tasks. The table was written by
--     adapting its sibling, and the single most plausible way to get it wrong
--     is to leave `references tasks(id)` in place. Nothing at runtime would
--     complain: task ids and phase ids are both uuids, so the table would
--     simply refuse every real phase edge with a 23503 that the UI reports as
--     "could not link those phases".
--
--   * THE CONSTRAINT NAMES. supabaseAdapter.loadProject disambiguates its
--     PostgREST embed BY CONSTRAINT NAME, because a table with two FKs to the
--     same parent is ambiguous (PGRST201). If either name changes, the fetch
--     400s, the adapter's `.catch(() => [])` turns that into an empty array,
--     and every Gantt arrow in the product disappears with no error anywhere.
--     That is a silent, app-wide regression pinned by nothing else in the repo
--     — including for task_dependencies, whose name has been load-bearing and
--     untested since 0000. Both are asserted here.
--
-- The negative assertions are deliberate FAILING CONTROLS: a suite made only
-- of "the write succeeds" checks passes just as happily against a table with
-- no constraints at all.
--
-- 🚨 ERRORS ARE MATCHED BY SQLSTATE, NOT BY MESSAGE TEXT, which diverges from
-- the older suites in this directory. throws_ok matches SQLERRM EXACTLY, and
-- Postgres names the ALPHABETICALLY FIRST matching constraint when it reports
-- a violation — so a message-matched assertion silently starts failing the day
-- someone adds an unrelated constraint whose name sorts earlier. The
-- `::char(5)` cast is required: without it `throws_ok(TEXT, TEXT)` resolves to
-- the errMSG overload and the assertion would compare a SQLSTATE against a
-- message and always fail.
BEGIN;
SELECT plan(12);

SELECT * FROM tests.rls_setup();

-- Phases in both workspaces. rls_setup seeds workspaces, members and one
-- project each; phases are this suite's own fixture.
INSERT INTO public.phases (id, project_id, name, sort_order) VALUES
  ('aaaa1111-0000-0000-0000-00000000fa01', 'aaaa1111-0000-0000-0000-000000000001', 'Phase A1', 0),
  ('aaaa1111-0000-0000-0000-00000000fa02', 'aaaa1111-0000-0000-0000-000000000001', 'Phase A2', 1),
  ('aaaa1111-0000-0000-0000-00000000fa03', 'aaaa1111-0000-0000-0000-000000000001', 'Phase A3', 2),
  ('bbbb2222-0000-0000-0000-00000000fb01', 'bbbb2222-0000-0000-0000-000000000001', 'Phase B1', 0),
  ('bbbb2222-0000-0000-0000-00000000fb02', 'bbbb2222-0000-0000-0000-000000000001', 'Phase B2', 1);

-- One task in workspace A, used only to prove the FKs reject a task id.
INSERT INTO public.assets (id, project_id, name) VALUES
  ('aaaa1111-0000-0000-0000-00000000aa61', 'aaaa1111-0000-0000-0000-000000000001', 'Asset A61');
INSERT INTO public.tasks (id, asset_id, project_id, title) VALUES
  ('aaaa1111-0000-0000-0000-00000000c161', 'aaaa1111-0000-0000-0000-00000000aa61',
   'aaaa1111-0000-0000-0000-000000000001', 'Task A61');

-- One phase edge per workspace, seeded as superuser (RLS does not apply).
INSERT INTO public.phase_dependencies (id, predecessor_id, successor_id, type) VALUES
  ('aaaa1111-0000-0000-0000-00000000da01',
   'aaaa1111-0000-0000-0000-00000000fa01', 'aaaa1111-0000-0000-0000-00000000fa02', 'FS'),
  ('bbbb2222-0000-0000-0000-00000000db01',
   'bbbb2222-0000-0000-0000-00000000fb01', 'bbbb2222-0000-0000-0000-00000000fb02', 'FS');

SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

-- ── 1-3. tenancy ────────────────────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM public.phase_dependencies
    WHERE id = 'aaaa1111-0000-0000-0000-00000000da01'),
  1, 'user_a can SELECT own-workspace phase_dependency'
);

SELECT is(
  (SELECT count(*)::int FROM public.phase_dependencies
    WHERE id = 'bbbb2222-0000-0000-0000-00000000db01'),
  0, 'user_a cannot SELECT workspace-B phase_dependency'
);

WITH upd AS (
  UPDATE public.phase_dependencies SET lag_days = 99
   WHERE id = 'bbbb2222-0000-0000-0000-00000000db01'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0,
  'user_a cannot UPDATE workspace-B phase_dependency');

-- ── 4. the audit trigger is actually attached ───────────────────────────────

INSERT INTO public.phase_dependencies (id, predecessor_id, successor_id, type)
VALUES ('aaaa1111-0000-0000-0000-00000000da99',
        'aaaa1111-0000-0000-0000-00000000fa02',
        'aaaa1111-0000-0000-0000-00000000fa03', 'SS');

SELECT is(
  (SELECT created_by FROM public.phase_dependencies
    WHERE id = 'aaaa1111-0000-0000-0000-00000000da99'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'phase_dependencies audit trigger populates created_by'
);

-- ── 5-7. constraints and RLS, as user_a ─────────────────────────────────────
-- These three all pass the INSERT policy first (user_a is a workspace admin
-- writing into workspace A), so the constraint is genuinely what refuses them.

SELECT throws_ok(
  $$INSERT INTO public.phase_dependencies (predecessor_id, successor_id)
    VALUES ('aaaa1111-0000-0000-0000-00000000fa01',
            'aaaa1111-0000-0000-0000-00000000fa01')$$,
  '23514'::char(5),
  NULL::text,
  'a phase cannot depend on itself (CHECK)'
);

SELECT throws_ok(
  $$INSERT INTO public.phase_dependencies (predecessor_id, successor_id)
    VALUES ('aaaa1111-0000-0000-0000-00000000fa01',
            'aaaa1111-0000-0000-0000-00000000fa02')$$,
  '23505'::char(5),
  NULL::text,
  'the same phase pair cannot be linked twice (UNIQUE)'
);

SELECT throws_ok(
  $$INSERT INTO public.phase_dependencies (predecessor_id, successor_id)
    VALUES ('bbbb2222-0000-0000-0000-00000000fb01',
            'bbbb2222-0000-0000-0000-00000000fb02')$$,
  '42501'::char(5),
  NULL::text,
  'user_a cannot INSERT a phase_dependency into workspace B'
);

-- ── 8-12. structure, back as superuser ──────────────────────────────────────

-- 🚨 NOT tests.logout(). The `tests` schema is RUNNER-ONLY: 0005 creates it
-- with a bare CREATE SCHEMA and no GRANT, and 0011 grants USAGE only IN SCHEMA
-- public — so calling any tests.* function while role = authenticated raises
-- 42501 "permission denied for schema tests", which aborts the whole
-- transaction and takes every assertion after it with it (25P02). This is the
-- claims-reset + RESET ROLE idiom the other suites use; 37_workspace_write_
-- lockdown.sql states the rule in its header and 19_soft_delete.sql repeats it.
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

-- THE COPY-PASTE CONTROL. If the FKs had been left pointing at tasks(id), this
-- insert would SUCCEED and every other assertion in this file would still pass.
--
-- 🚨 Runs as superuser deliberately. As user_a the INSERT policy would refuse
-- it first — a task id resolves to no phase row, so the WITH CHECK fails — and
-- the assertion would be handed 42501 instead of 23503. It would look like it
-- was testing the foreign key while actually testing RLS a second time, and it
-- would keep passing if the FK were wrong. RLS off is what makes the FK the
-- only thing left that can refuse this row.
SELECT throws_ok(
  $$INSERT INTO public.phase_dependencies (predecessor_id, successor_id)
    VALUES ('aaaa1111-0000-0000-0000-00000000c161',
            'aaaa1111-0000-0000-0000-00000000fa03')$$,
  '23503'::char(5),
  NULL::text,
  'a TASK id is not a valid phase_dependencies endpoint (FK targets phases)'
);

-- Hard-deleting a phase takes its edges with it. The nightly purge (0014)
-- relies on exactly this for the task table and does not list either edge
-- table in its loop.
DELETE FROM public.phases WHERE id = 'aaaa1111-0000-0000-0000-00000000fa03';

SELECT is(
  (SELECT count(*)::int FROM public.phase_dependencies
    WHERE id = 'aaaa1111-0000-0000-0000-00000000da99'),
  0, 'deleting a phase cascades to its phase_dependencies rows'
);

SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.phase_dependencies', 'SELECT') OR
    has_table_privilege('anon', 'public.phase_dependencies', 'INSERT') OR
    has_table_privilege('anon', 'public.phase_dependencies', 'UPDATE') OR
    has_table_privilege('anon', 'public.phase_dependencies', 'DELETE')
  ),
  'anon holds no table privilege on phase_dependencies'
);

-- The two embed-hint names supabaseAdapter.loadProject hardcodes. Losing
-- either one empties the Gantt silently.
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid  = 'public.phase_dependencies'::regclass
       AND conname   = 'phase_dependencies_predecessor_id_fkey'
       AND confrelid = 'public.phases'::regclass
  ),
  'phase_dependencies_predecessor_id_fkey exists and targets phases (PostgREST embed hint)'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid  = 'public.task_dependencies'::regclass
       AND conname   = 'task_dependencies_predecessor_id_fkey'
       AND confrelid = 'public.tasks'::regclass
  ),
  'task_dependencies_predecessor_id_fkey still exists and targets tasks (PostgREST embed hint)'
);

SELECT * FROM finish();
ROLLBACK;
