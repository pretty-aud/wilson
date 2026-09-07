-- =========================================================================
-- 71_milestones.sql — Track A, bundle A2 session 2, migration 0067.
--
-- Structure, the two behaviours unique to milestones, and the trash path
-- ruling 38 asks for.
--
-- 🚨 PROBES 8-9 ARE THE S23 TRAP, FOR THE THIRD TIME.
-- `phase_id` is NULLABLE — TimelineView's editor writes `draft.phase_id ||
-- null` and its "new milestone" affordance opens with none, so a milestone
-- that belongs to no phase is a real, displayed state: the timeline draws it
-- by its DATE. 0014 gave tasks_select an `EXISTS (SELECT 1 FROM assets …)`
-- arm, and once tasks.asset_id could be NULL the row failed its OWN select
-- policy — the insert landed, the returning read matched nothing, and
-- .single() answered PGRST116 with no error anywhere. 0040's shots_select was
-- written to avoid the repeat and 49_shots.sql probes 7-8 pin it.
-- milestones_select hops to the PROJECT, never the phase, and probe 9 is what
-- fails if anyone ever "tightens" it.
--
-- 🚨 PROBE 11 IS A PRESENCE CONTROL AND IS NOT DECORATION.
-- Probe 13 asserts a trashed milestone is INVISIBLE — a count of 0. A count of
-- 0 is also what an insert that never happened produces, so probe 13 passes
-- for the wrong reason if the fixture is broken. Probe 11 asserts the same row
-- is visible BEFORE the soft delete, which is the only thing that makes 13's
-- zero mean "hidden by policy".
--
-- The shared access rules are proved here rather than borrowed: milestones are
-- the first table to join 0014's soft-delete machinery since 0014 itself, so
-- this file also proves that machinery still holds for its original tables
-- (probe 22) after 0067 replaced two of its functions.
-- =========================================================================
BEGIN;

SELECT plan(30);

SELECT * FROM tests.rls_setup();

-- Two extra members of workspace A, exactly as 48_scenes.sql seeds them:
--   user_c  app_role 'user', project_a reviewer -> read yes, write no
--   user_d  app_role 'user', project_a member   -> read yes, write YES
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
   '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111',
   'dddddddd-dddd-dddd-dddd-dddddddddddd', 'user', 'user_d', 'User D', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.project_members
  (project_id, user_id, workspace_id, project_role)
VALUES
  ('aaaa1111-0000-0000-0000-000000000001',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1111-0000-0000-0000-000000000001',
   'dddddddd-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;


-- ── 1-4: the standing structural block ───────────────────────────────────

SELECT has_table('public'::name, 'milestones'::name, 'milestones table exists');

SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.milestones'::regclass),
  'milestones has RLS enabled and forced');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'milestones' AND cmd = 'ALL'),
  0, 'milestones has no FOR ALL policy');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'milestones'),
  4, 'milestones has exactly four policies (select/insert/update/delete)');


-- ── 5-6: the two triggers a write depends on ─────────────────────────────
-- No client sends workspace_id (RabbitProvider.addMilestone builds the row as
-- { id, project_id, ...payload }), so without the stamp every real insert dies
-- 23502 — and no probe that supplies workspace_id itself would ever notice.

SELECT has_trigger('public', 'milestones',
  'trg_milestones_populate_workspace',
  'milestones stamps workspace_id on insert');

SELECT has_trigger('public', 'milestones',
  'trg_milestones_soft_delete',
  'milestones carries 0014''s deleted_by stamp trigger');


-- ── 7: phase_id is NULLABLE ──────────────────────────────────────────────
-- Expressed over information_schema rather than col_not_null(), because the
-- local pgTAP shim has no col_not_null and the whole run would abort
-- (49_shots.sql says the same for the same reason).

SELECT is(
  (SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'milestones'
      AND column_name = 'phase_id'),
  'YES',
  'milestones.phase_id is NULLABLE — a milestone on no phase is a real UI state');


-- ── Act as the workspace admin for the behavioural probes ────────────────

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


-- ── 8-9: THE S23 TRAP — an unparented milestone inserts AND reads back ───

SELECT lives_ok(
  $$INSERT INTO public.milestones (id, project_id, phase_id, title, date)
    VALUES ('77770000-0000-0000-0000-0000000000a1',
            'aaaa1111-0000-0000-0000-000000000001', NULL, 'Lock picture', '2026-10-01')$$,
  'a milestone with no phase can be created');

-- If milestones_select ever grows an EXISTS-on-phase arm, the INSERT above
-- still succeeds and THIS is the probe that fails — the failure mode that made
-- "New task does nothing" so expensive to diagnose: the write lands and the
-- read denies it, silently.
SELECT is(
  (SELECT count(*)::int FROM public.milestones
    WHERE id = '77770000-0000-0000-0000-0000000000a1'),
  1,
  'an unparented milestone is READABLE — milestones_select hops to the project, never the phase');


-- ── 10: a milestone on a SOFT-DELETED phase stays visible ────────────────
-- The other half of the same argument: the milestone has its own date, so
-- hiding a phase must not hide it. A phase hop in the SELECT policy would
-- fail here even with phase_id set, which is the case probe 9 cannot reach.

INSERT INTO public.phases (id, project_id, name, sort_order)
VALUES ('88880000-0000-0000-0000-0000000000b1',
        'aaaa1111-0000-0000-0000-000000000001', 'Post', 1);

INSERT INTO public.milestones (id, project_id, phase_id, title, date)
VALUES ('77770000-0000-0000-0000-0000000000b1',
        'aaaa1111-0000-0000-0000-000000000001',
        '88880000-0000-0000-0000-0000000000b1', 'Delivery', '2026-11-15');

SELECT public.soft_delete_row('phases', '88880000-0000-0000-0000-0000000000b1');

SELECT is(
  (SELECT count(*)::int FROM public.milestones
    WHERE id = '77770000-0000-0000-0000-0000000000b1'),
  1,
  'a milestone whose phase is in the trash is still visible');


-- ── 11-16: trash, list, restore (ruling 38) ──────────────────────────────

INSERT INTO public.milestones (id, project_id, title, date)
VALUES ('77770000-0000-0000-0000-0000000000c1',
        'aaaa1111-0000-0000-0000-000000000001', 'Wrap', '2026-12-20');

-- 11: THE PRESENCE CONTROL. Probe 13's count of 0 means "hidden by policy"
-- only because this probe proved the row was there to hide.
SELECT is(
  (SELECT count(*)::int FROM public.milestones
    WHERE id = '77770000-0000-0000-0000-0000000000c1'),
  1,
  'PRESENCE CONTROL: the milestone about to be trashed is visible while live');

SELECT ok(
  public.soft_delete_row('milestones', '77770000-0000-0000-0000-0000000000c1'),
  'soft_delete_row accepts milestones — 0067 extended fn_trash_authz''s allowlist');

SELECT is(
  (SELECT count(*)::int FROM public.milestones
    WHERE id = '77770000-0000-0000-0000-0000000000c1'),
  0,
  'a trashed milestone leaves the timeline (milestones_select filters deleted_at)');

-- The listing exists precisely because the row above is now unreadable through
-- the table. A "Recently deleted" list cannot be a table read.
SELECT is(
  (SELECT count(*)::int FROM public.milestones_trash_index(
     'aaaa1111-0000-0000-0000-000000000001')
    WHERE id = '77770000-0000-0000-0000-0000000000c1'),
  1,
  'milestones_trash_index lists the trashed milestone');

-- deleted_by is stamped by 0014's trigger, not by the caller.
SELECT is(
  (SELECT deleted_by FROM public.milestones_trash_index(
     'aaaa1111-0000-0000-0000-000000000001')
    WHERE id = '77770000-0000-0000-0000-0000000000c1'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'the trash row carries deleted_by, stamped by fn_soft_delete_stamp');

-- 🚨 THE RESTORE AND THE READ OF ITS EFFECT MUST BE SEPARATE STATEMENTS.
-- Written as `ok(restore_soft_deleted(…) AND (SELECT count(*) …) = 1)` this
-- probe failed on wilson-dev even though the restore worked: a scalar
-- subquery in the same statement reads the snapshot taken BEFORE that
-- statement's own writes, so it still saw the row as trashed. The same trap
-- would make any single-statement "write then assert" probe lie in the
-- reassuring direction if the operands were reversed.
SELECT public.restore_soft_deleted('milestones', '77770000-0000-0000-0000-0000000000c1');

SELECT is(
  (SELECT count(*)::int FROM public.milestones
    WHERE id = '77770000-0000-0000-0000-0000000000c1'),
  1,
  'restore_soft_deleted brings the milestone back onto the timeline');


-- ── 17-18: a project MEMBER reads and writes ─────────────────────────────
-- Milestones deliberately use can_write_project, NOT can_access_project_money:
-- the money gate would lock the feature to managers and nobody would notice
-- until a team member tried to place a milestone.

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
  (SELECT count(*)::int FROM public.milestones
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  3, 'a project member reads milestones');

SELECT lives_ok(
  $$INSERT INTO public.milestones (project_id, title, date)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'Member milestone', '2026-10-15')$$,
  'a project member can create a milestone — milestones are not money');


-- ── 19-21: a project REVIEWER reads but cannot write or trash ────────────

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

SELECT is(
  (SELECT count(*)::int FROM public.milestones
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  4, 'a project reviewer can READ milestones');

SELECT throws_ok(
  $$INSERT INTO public.milestones (project_id, title, date)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'sneaky', '2026-10-31')$$,
  'new row violates row-level security policy for table "milestones"',
  'a project reviewer cannot create a milestone');

-- The RPC is the only path into the trash, so it is the path that must refuse.
-- Without this, a reviewer's Delete would be refused by the table policy but
-- allowed by a SECURITY DEFINER function that never re-checked.
SELECT throws_ok(
  $$SELECT public.soft_delete_row('milestones', '77770000-0000-0000-0000-0000000000a1')$$,
  'not allowed to soft-delete or restore this row',
  'a project reviewer cannot trash a milestone through the RPC');


-- ── 22: 0014's ORIGINAL tables still work after 0067 replaced its guards ─
-- 🚨 0059 dropped a guard's clauses with a CREATE OR REPLACE and it cost a
-- live privilege escalation. 0067 replaces fn_trash_authz and
-- purge_soft_deleted to add one name each; this probe is the cross-check that
-- the other seven names survived in the function that actually runs, not just
-- in the file that was written.

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

INSERT INTO public.assets (id, project_id, name)
VALUES ('99990000-0000-0000-0000-0000000000d1',
        'aaaa1111-0000-0000-0000-000000000001', 'Still soft-deletable');

-- Separate statements, for the reason probe 16 records: AND does not promise
-- left-to-right evaluation, and a restore that ran first would return false
-- and fail this probe for a reason that has nothing to do with 0067.
SELECT public.soft_delete_row('assets', '99990000-0000-0000-0000-0000000000d1');

SELECT ok(
  public.restore_soft_deleted('assets', '99990000-0000-0000-0000-0000000000d1'),
  'assets still round-trip through the trash after 0067 replaced fn_trash_authz');


-- ── 23: the migration-0011 privilege trap, for milestones ────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.milestones', 'SELECT') OR
    has_table_privilege('anon', 'public.milestones', 'INSERT') OR
    has_table_privilege('anon', 'public.milestones', 'UPDATE') OR
    has_table_privilege('anon', 'public.milestones', 'DELETE') OR
    has_function_privilege('anon', 'public.milestones_trash_index(uuid)', 'EXECUTE')
  ),
  'anon holds no privilege on milestones or its trash index'
);


-- ── 24-25: the trash index's OWN gate (R1 finding 7) ─────────────────────
--
-- 🚨 THESE ARE THE PROBES THE FIRST VERSION OF THIS FILE DID NOT HAVE.
-- milestones_trash_index is the one SECURITY DEFINER surface 0067 adds — it
-- reads public.milestones with RLS bypassed — and the suite exercised only its
-- happy path, as the workspace admin. Its gate was therefore unproven in BOTH
-- directions, and it was wrong: gated on can_write_project, a reviewer (who
-- fails that check, probes 19-21) got a raised exception where the panel could
-- only show a raw Postgres string. The gate is now the READ predicate.

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

-- A reviewer can READ the trash. Restore is refused elsewhere: client-side by
-- GatedAction, server-side by fn_trash_authz (probe 21).
SELECT lives_ok(
  $$SELECT * FROM public.milestones_trash_index('aaaa1111-0000-0000-0000-000000000001')$$,
  'a project reviewer can READ the trash index — it is gated on read, not on write');

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

-- A SECURITY DEFINER function bypasses RLS, so the workspace boundary here is
-- code rather than policy — which is exactly why it needs a probe.
SELECT throws_ok(
  $$SELECT * FROM public.milestones_trash_index('aaaa1111-0000-0000-0000-000000000001')$$,
  'not allowed to read this project''s trash',
  'an admin of ANOTHER workspace cannot read this project''s trash');


-- ── 26-27: cross-workspace isolation for the table itself ────────────────
-- Still acting as workspace B's admin. Every other access arm of the new
-- policy set had a probe; the workspace arm did not (R1 finding 11).

SELECT is(
  (SELECT count(*)::int FROM public.milestones
    WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  0, 'an admin of another workspace reads NO milestones from this project');

SELECT throws_ok(
  $$INSERT INTO public.milestones (project_id, title, date)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'cross-tenant', '2026-10-31')$$,
  'new row violates row-level security policy for table "milestones"',
  'an admin of another workspace cannot write a milestone into this project');


-- ── Back to the workspace admin for the last three ───────────────────────

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


-- ── 28: phase_id ON DELETE SET NULL, on a HARD delete (R1 finding 9) ─────
--
-- The header asserts this as a design invariant — "a hard-deleted phase must
-- not silently take a dated milestone with it" — and probe 10 only SOFT-deletes
-- a phase, which exercises the SELECT policy and never the FK action. Both
-- purge_soft_deleted and the desktop's phase route hard-delete, so this path
-- is real. Two lines stand between it and a silently-changed FK action.

-- 🚨 A FRESH, LIVE PHASE — not the one probe 10 soft-deleted. PostgreSQL
-- applies the SELECT policy to the rows a DELETE reads through its WHERE
-- clause, so a trashed phase is invisible and `DELETE FROM phases WHERE id=…`
-- matches ZERO rows: the first version of this probe deleted nothing and read
-- the FK action as broken. (Which is itself worth knowing: once a phase is in
-- the trash, only purge_soft_deleted — service_role — can hard-delete it.)
INSERT INTO public.phases (id, project_id, name, sort_order)
VALUES ('88880000-0000-0000-0000-0000000000b2',
        'aaaa1111-0000-0000-0000-000000000001', 'Delivery phase', 2);

INSERT INTO public.milestones (id, project_id, phase_id, title, date)
VALUES ('77770000-0000-0000-0000-0000000000b2',
        'aaaa1111-0000-0000-0000-000000000001',
        '88880000-0000-0000-0000-0000000000b2', 'Ship', '2026-12-01');

DELETE FROM public.phases WHERE id = '88880000-0000-0000-0000-0000000000b2';

SELECT is(
  (SELECT count(*)::int FROM public.milestones
    WHERE id = '77770000-0000-0000-0000-0000000000b2' AND phase_id IS NULL),
  1,
  'hard-deleting a phase SETS NULL on its milestones and KEEPS the row');


-- ── 29: purge_soft_deleted actually sweeps milestones (R1 finding 10) ────
--
-- 0067 adds one name to that function's array, and the migration's
-- post-condition only proves the LITERAL is in the source. This proves the
-- sweep reaches the table. The 33_file_lifecycle.sql idiom: a negative
-- interval makes everything already-trashed expired.

INSERT INTO public.milestones (id, project_id, title, date)
VALUES ('77770000-0000-0000-0000-0000000000f1',
        'aaaa1111-0000-0000-0000-000000000001', 'Purge me', '2026-07-01');
SELECT public.soft_delete_row('milestones', '77770000-0000-0000-0000-0000000000f1');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT public.purge_soft_deleted(INTERVAL '-1 second');

SELECT is(
  (SELECT count(*)::int FROM public.milestones
    WHERE id = '77770000-0000-0000-0000-0000000000f1'),
  0,
  'purge_soft_deleted hard-deletes an expired trashed milestone');


-- ── 30: a trashed PROJECT hides its trash too ────────────────────────────
--
-- LAST, because soft-deleting the project hides everything under it. Restoring
-- a milestone beneath a trashed project is authorized by fn_trash_authz and
-- then immediately re-hidden by milestones_select, so the index refuses the
-- whole call rather than listing rows whose Restore would be a no-op.

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT public.soft_delete_row('projects', 'aaaa1111-0000-0000-0000-000000000001');

SELECT throws_ok(
  $$SELECT * FROM public.milestones_trash_index('aaaa1111-0000-0000-0000-000000000001')$$,
  'not allowed to read this project''s trash',
  'the trash index refuses a project that is itself in the trash');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
