-- pgTAP: workspace-level realtime channel (Session 8, migration 0018)
--
-- Guards four invariants:
--   1. The workspace broadcast trigger exists on projects, workspace_members,
--      tasks, assets and project_members — and on NOTHING private:
--      notes/note_subjects must never grow a broadcast trigger (their
--      content is owner-private; every workspace-channel subscriber is
--      merely a workspace member).
--   2. can_read_workspace_topic(): own workspace + ACTIVE membership → true;
--      foreign workspace, NULL, or INACTIVE membership → false. Note the
--      deliberate divergence from can_read_project_topic: the workspace gate
--      IS stricter than table reads for inactive members (it reuses the
--      has_active_membership check every write policy uses) — S9 closes the
--      table-read side to match.
--   3. Writes through the trigger never break, in any environment.
--   4. Relevance filters: task events with no assignee/reviewer on either
--      side are SKIPPED, asset UPDATEs that change neither deleted_at nor
--      name/phase_id (reorder churn) are SKIPPED; assigned-task, project
--      and asset-trash events land on rabbit:workspace:% wherever realtime
--      infrastructure exists.
--
-- De-auth pair before every persona switch: tests schema is runner-only.

BEGIN;
SELECT plan(20);

SELECT * FROM tests.rls_setup();

-- ── extra fixtures (runner: RLS bypassed) ────────────────────────────────
-- Inactive member of ws_a (same id as 20_realtime.sql's user_g).
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7',
   'user_g@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7',
   'user', 'user_g', 'User G (inactive)', false)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- Asset + an UNASSIGNED task under project_a for the skip-filter probe.
INSERT INTO public.assets (id, project_id, name)
VALUES ('aaaa1111-0000-0000-0000-000000003001',
        'aaaa1111-0000-0000-0000-000000000001', 'WS Realtime Asset');

INSERT INTO public.tasks (id, asset_id, project_id, title)
VALUES ('aaaa1111-0000-0000-0000-000000003002',
        'aaaa1111-0000-0000-0000-000000003001',
        'aaaa1111-0000-0000-0000-000000000001', 'Unassigned Task');

-- Environment-tolerant inspectors (see 20_realtime.sql for the status
-- vocabulary and why routability is probed empirically).
CREATE FUNCTION pg_temp.ws_broadcast_status(p_min BIGINT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  n BIGINT;
BEGIN
  IF to_regclass('realtime.messages') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'realtime' AND p.proname = 'broadcast_changes'
  ) THEN
    RETURN 'no-schema';
  END IF;
  PERFORM realtime.send('{"probe":true}'::jsonb, 'PGTAP-PROBE',
                        'rabbit:pgtap:ws-partition-probe', true);
  EXECUTE 'SELECT count(*) FROM realtime.messages
            WHERE topic = ''rabbit:pgtap:ws-partition-probe'''
    INTO n;
  IF n = 0 THEN
    RETURN 'no-partition';
  END IF;
  EXECUTE 'SELECT count(*) FROM realtime.messages
            WHERE topic LIKE ''rabbit:workspace:%'' AND extension = ''broadcast'''
    INTO n;
  RETURN CASE WHEN n >= p_min THEN 'landed' ELSE 'missed' END;
END;
$$;

CREATE FUNCTION pg_temp.ws_policy_status()
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  IF to_regclass('realtime.messages') IS NULL THEN
    RETURN 'no-schema';
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'realtime' AND tablename = 'messages'
         AND policyname IN ('rabbit_workspace_topic_read',
                            'rabbit_workspace_topic_presence_write')) = 2 THEN
    RETURN 'both-present';
  END IF;
  RETURN 'missing';
END;
$$;

-- Dashboard relevance filter: an unassigned-task write must add NOTHING to
-- the workspace topic. Count-delta probe, tolerant of absent infrastructure
-- (with no schema there is nothing to count; with no partition both counts
-- are equal anyway, which is exactly the invariant).
CREATE FUNCTION pg_temp.ws_task_skip_status()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  before_n BIGINT;
  after_n  BIGINT;
BEGIN
  IF to_regclass('realtime.messages') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'realtime' AND p.proname = 'broadcast_changes'
  ) THEN
    RETURN 'no-schema';
  END IF;
  EXECUTE 'SELECT count(*) FROM realtime.messages
            WHERE topic LIKE ''rabbit:workspace:%'' AND extension = ''broadcast'''
    INTO before_n;
  UPDATE public.tasks SET title = 'Unassigned Task v2'
   WHERE id = 'aaaa1111-0000-0000-0000-000000003002';
  EXECUTE 'SELECT count(*) FROM realtime.messages
            WHERE topic LIKE ''rabbit:workspace:%'' AND extension = ''broadcast'''
    INTO after_n;
  RETURN CASE WHEN after_n = before_n THEN 'skipped-ok' ELSE 'leaked' END;
END;
$$;

-- Asset churn filter: a sort_order-only UPDATE (reorder) must add NOTHING
-- to the workspace topic (deleted_at/name/phase_id unchanged).
CREATE FUNCTION pg_temp.ws_asset_skip_status()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  before_n BIGINT;
  after_n  BIGINT;
BEGIN
  IF to_regclass('realtime.messages') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'realtime' AND p.proname = 'broadcast_changes'
  ) THEN
    RETURN 'no-schema';
  END IF;
  EXECUTE 'SELECT count(*) FROM realtime.messages
            WHERE topic LIKE ''rabbit:workspace:%'' AND extension = ''broadcast'''
    INTO before_n;
  UPDATE public.assets SET sort_order = 99
   WHERE id = 'aaaa1111-0000-0000-0000-000000003001';
  EXECUTE 'SELECT count(*) FROM realtime.messages
            WHERE topic LIKE ''rabbit:workspace:%'' AND extension = ''broadcast'''
    INTO after_n;
  RETURN CASE WHEN after_n = before_n THEN 'skipped-ok' ELSE 'leaked' END;
END;
$$;

-- ── probes 1-2: functions exist ──────────────────────────────────────────
SELECT has_function('public', 'fn_workspace_realtime_broadcast',
  'fn_workspace_realtime_broadcast() exists');
SELECT has_function('public', 'can_read_workspace_topic', ARRAY['uuid'],
  'can_read_workspace_topic(uuid) exists');

-- ── probes 3-8: triggers on exactly the right tables ─────────────────────
SELECT has_trigger('public', 'projects',          'trg_projects_ws_realtime',          'projects workspace broadcast trigger');
SELECT has_trigger('public', 'workspace_members', 'trg_workspace_members_ws_realtime', 'workspace_members workspace broadcast trigger');
SELECT has_trigger('public', 'tasks',             'trg_tasks_ws_realtime',             'tasks workspace broadcast trigger');
SELECT has_trigger('public', 'assets',            'trg_assets_ws_realtime',            'assets workspace broadcast trigger (transitive-hide path)');
SELECT has_trigger('public', 'project_members',   'trg_project_members_ws_realtime',   'project_members workspace broadcast trigger (role/staffing liveness)');

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid IN ('public.notes'::regclass, 'public.note_subjects'::regclass)
      AND NOT tgisinternal
      AND tgfoid IN ('public.fn_workspace_realtime_broadcast()'::regprocedure,
                     'public.fn_realtime_broadcast()'::regprocedure)
  ),
  'notes/note_subjects have NO broadcast trigger — private content never rides a channel'
);

-- ── probes 9-11: topic authorization as an active ws_a member ────────────
SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

SELECT is(public.can_read_workspace_topic('11111111-1111-1111-1111-111111111111'),
  true,  'active ws_a member can read the ws_a workspace topic');
SELECT is(public.can_read_workspace_topic('22222222-2222-2222-2222-222222222222'),
  false, 'ws_a member cannot read the ws_b workspace topic');
SELECT is(public.can_read_workspace_topic(NULL),
  false, 'NULL workspace (unparseable topic suffix) is denied');

-- ── probe 12: INACTIVE member is denied (stricter than table reads) ──────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as(
  'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7',
  '11111111-1111-1111-1111-111111111111'
);

SELECT is(public.can_read_workspace_topic('11111111-1111-1111-1111-111111111111'),
  false, 'inactive member is denied the workspace topic (table reads aligned in S9 — 0020)');

-- ── probe 13: cross-workspace persona ────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '22222222-2222-2222-2222-222222222222'
);

SELECT is(public.can_read_workspace_topic('11111111-1111-1111-1111-111111111111'),
  false, 'ws_b member cannot read the ws_a workspace topic');

-- ── probes 14-20: policies + write paths + relevance filters (runner) ────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT ok(pg_temp.ws_policy_status() IN ('both-present', 'no-schema'),
  'workspace-topic realtime.messages policies exist wherever realtime.messages does');

SELECT lives_ok(
  $$UPDATE public.projects SET title = 'Project A (ws-realtime)'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'projects UPDATE with workspace broadcast trigger attached succeeds');

SELECT lives_ok(
  $$INSERT INTO public.tasks (id, asset_id, project_id, title, assignee_id)
    VALUES ('aaaa1111-0000-0000-0000-000000003003',
            'aaaa1111-0000-0000-0000-000000003001',
            'aaaa1111-0000-0000-0000-000000000001',
            'Assigned Task',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'assigned-task INSERT with workspace broadcast trigger attached succeeds');

SELECT ok(pg_temp.ws_task_skip_status() IN ('skipped-ok', 'no-schema'),
  'unassigned-task write adds nothing to the workspace topic (relevance filter)');

SELECT ok(pg_temp.ws_asset_skip_status() IN ('skipped-ok', 'no-schema'),
  'asset reorder churn (sort_order) adds nothing to the workspace topic');

-- Asset trash must broadcast (the transitive-hide path: hides child tasks
-- without touching any tasks row). Via the RPC as an authed persona —
-- fn_trash_authz rejects claimless callers.
SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

SELECT lives_ok(
  $$SELECT public.soft_delete_row('assets',
      'aaaa1111-0000-0000-0000-000000003001')$$,
  'asset trash RPC with workspace broadcast trigger attached succeeds');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- The projects UPDATE + assigned-task INSERT + asset trash above must have
-- landed at least 3 workspace-topic rows wherever the infrastructure exists.
SELECT ok(pg_temp.ws_broadcast_status(3) IN ('landed', 'no-schema', 'no-partition'),
  'broadcast rows land on rabbit:workspace:% when realtime infrastructure is present');

SELECT * FROM finish();
ROLLBACK;
