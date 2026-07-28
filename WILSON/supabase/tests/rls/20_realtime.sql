-- pgTAP: realtime broadcast triggers + private-channel topic authorization
-- (Session 7, migration 0016)
--
-- Guards three invariants:
--   1. The broadcast trigger exists on all 10 project-scoped tables and
--      NEVER breaks a write — INSERT, UPDATE and DELETE all succeed even
--      when the realtime schema (or today's messages partition) is absent.
--   2. can_read_project_topic() is SECURITY INVOKER and therefore exactly
--      mirrors projects_select: own live project → true; other workspace,
--      NULL, unparseable, or soft-deleted project → false.
--   3. The realtime.messages policies exist wherever realtime.messages
--      does (hosted + full local stack; db-only CI stacks skip both).
--
-- Persona probes run as 'authenticated' via tests.login_as — remember the
-- Session 6 lesson: de-auth (reset claims + RESET ROLE) BEFORE every
-- login_as call; the tests schema is runner-only.

BEGIN;
SELECT plan(27);

SELECT * FROM tests.rls_setup();

-- ── extra fixtures (runner: RLS bypassed) ────────────────────────────────
-- An inactive member of ws_a: the deactivated-with-live-token gap is
-- deliberately identical to table reads until Session 9 closes it there.
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

-- Scratch soft-deleted project in ws_a (probe: trashed topic denies).
INSERT INTO public.projects (id, workspace_id, title, created_by, deleted_at)
VALUES ('aaaa1111-0000-0000-0000-000000002077',
        '11111111-1111-1111-1111-111111111111',
        'Trashed Scratch', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now())
ON CONFLICT (id) DO NOTHING;

-- Asset + task under project_a for the write-path probes.
INSERT INTO public.assets (id, project_id, name)
VALUES ('aaaa1111-0000-0000-0000-000000002001',
        'aaaa1111-0000-0000-0000-000000000001', 'Realtime Asset');

INSERT INTO public.tasks (id, asset_id, project_id, title)
VALUES ('aaaa1111-0000-0000-0000-000000002002',
        'aaaa1111-0000-0000-0000-000000002001',
        'aaaa1111-0000-0000-0000-000000000001', 'Realtime Task');

-- Environment-tolerant realtime.messages inspector. Status values:
--   'no-schema'    — realtime.messages / broadcast_changes absent (db-only CI)
--   'no-partition' — send path not routable NOW (no partition covers now();
--                    realtime.send swallows the insert with a WARNING).
--                    Detected EMPIRICALLY via a probe send — checking
--                    pg_inherits alone would count stale historical
--                    partitions as routable and fail the suite spuriously.
--   'landed'       — >= p_min rabbit:project:% broadcast rows present
--   'missed'       — infrastructure present and routable but rows absent
--                    (a REAL failure)
CREATE FUNCTION pg_temp.rabbit_broadcast_status(p_min BIGINT)
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
  -- Empirical routability probe: realtime.send never raises — if its row
  -- didn't land, today's partition doesn't exist in this stack.
  PERFORM realtime.send('{"probe":true}'::jsonb, 'PGTAP-PROBE',
                        'rabbit:pgtap:partition-probe', true);
  EXECUTE 'SELECT count(*) FROM realtime.messages
            WHERE topic = ''rabbit:pgtap:partition-probe'''
    INTO n;
  IF n = 0 THEN
    RETURN 'no-partition';
  END IF;
  EXECUTE 'SELECT count(*) FROM realtime.messages
            WHERE topic LIKE ''rabbit:project:%'' AND extension = ''broadcast'''
    INTO n;
  RETURN CASE WHEN n >= p_min THEN 'landed' ELSE 'missed' END;
END;
$$;

CREATE FUNCTION pg_temp.rabbit_policy_status()
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  IF to_regclass('realtime.messages') IS NULL THEN
    RETURN 'no-schema';
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'realtime' AND tablename = 'messages'
         AND policyname IN ('rabbit_project_topic_read',
                            'rabbit_project_topic_presence_write')) = 2 THEN
    RETURN 'both-present';
  END IF;
  RETURN 'missing';
END;
$$;

-- ── probes 1-5: functions exist + fn_try_uuid behavior ───────────────────
SELECT has_function('public', 'fn_realtime_broadcast',
  'fn_realtime_broadcast() exists');
SELECT has_function('public', 'can_read_project_topic', ARRAY['uuid'],
  'can_read_project_topic(uuid) exists');
SELECT has_function('public', 'fn_try_uuid', ARRAY['text'],
  'fn_try_uuid(text) exists');

SELECT is(public.fn_try_uuid('rabbit:project:garbage'), NULL,
  'fn_try_uuid returns NULL for unparseable input instead of erroring');
SELECT is(public.fn_try_uuid('aaaa1111-0000-0000-0000-000000000001'),
  'aaaa1111-0000-0000-0000-000000000001'::uuid,
  'fn_try_uuid round-trips a valid uuid');

-- ── probes 6-15: trigger present on all 10 tables ────────────────────────
SELECT has_trigger('public', 'projects',          'trg_projects_realtime',          'projects broadcast trigger');
SELECT has_trigger('public', 'phases',            'trg_phases_realtime',            'phases broadcast trigger');
SELECT has_trigger('public', 'assets',            'trg_assets_realtime',            'assets broadcast trigger');
SELECT has_trigger('public', 'tasks',             'trg_tasks_realtime',             'tasks broadcast trigger');
SELECT has_trigger('public', 'files',             'trg_files_realtime',             'files broadcast trigger');
SELECT has_trigger('public', 'comments',          'trg_comments_realtime',          'comments broadcast trigger');
SELECT has_trigger('public', 'task_dependencies', 'trg_task_dependencies_realtime', 'task_dependencies broadcast trigger');
SELECT has_trigger('public', 'task_links',        'trg_task_links_realtime',        'task_links broadcast trigger');
SELECT has_trigger('public', 'asset_versions',    'trg_asset_versions_realtime',    'asset_versions broadcast trigger');
SELECT has_trigger('public', 'project_members',   'trg_project_members_realtime',   'project_members broadcast trigger');

-- ── probes 16-19: topic authorization as an active ws_a member ───────────
SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

SELECT is(public.can_read_project_topic('aaaa1111-0000-0000-0000-000000000001'),
  true,  'ws_a member can read own live project topic');
SELECT is(public.can_read_project_topic('bbbb2222-0000-0000-0000-000000000001'),
  false, 'ws_a member cannot read a ws_b project topic');
SELECT is(public.can_read_project_topic(NULL),
  false, 'NULL project (unparseable topic suffix) is denied');
SELECT is(public.can_read_project_topic('aaaa1111-0000-0000-0000-000000002077'),
  false, 'soft-deleted project topic denies — channel access equals projects_select');

-- ── probe 20: inactive member (S9 deferred gap — mirrors table reads) ────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as(
  'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7',
  '11111111-1111-1111-1111-111111111111'
);

-- projects_select has no has_active_membership clause (deferred to S9), so
-- the topic gate deliberately matches: this pins parity, not aspiration.
SELECT is(public.can_read_project_topic('aaaa1111-0000-0000-0000-000000000001'),
  true, 'inactive member mirrors table-read behavior (S9 closes both together)');

-- ── probe 21: cross-workspace persona ────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '22222222-2222-2222-2222-222222222222'
);

SELECT is(public.can_read_project_topic('aaaa1111-0000-0000-0000-000000000001'),
  false, 'ws_b member cannot read a ws_a project topic');

-- ── probes 22-27: policies + write paths never break (runner) ────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT ok(pg_temp.rabbit_policy_status() IN ('both-present', 'no-schema'),
  'realtime.messages policies exist wherever realtime.messages does');

-- The load-bearing invariant: broadcast NEVER aborts a write, in any
-- environment. UPDATE (own-column resolution), INSERT + DELETE through the
-- task_links parent join (NEW-side and OLD-side resolution respectively).
SELECT lives_ok(
  $$UPDATE public.assets SET name = 'Realtime Asset v2'
     WHERE id = 'aaaa1111-0000-0000-0000-000000002001'$$,
  'UPDATE with broadcast trigger attached succeeds');

SELECT lives_ok(
  $$INSERT INTO public.task_links (id, task_id, label, url)
    VALUES ('aaaa1111-0000-0000-0000-000000002003',
            'aaaa1111-0000-0000-0000-000000002002',
            'ref', 'https://example.test/ref')$$,
  'INSERT resolving project via parent join succeeds');

SELECT lives_ok(
  $$DELETE FROM public.task_links
     WHERE id = 'aaaa1111-0000-0000-0000-000000002003'$$,
  'DELETE resolving project via OLD-side parent join succeeds');

-- Soft delete through the RPC still writes fine with the trigger attached
-- (the trigger fires inside the SECURITY DEFINER UPDATE). Needs an
-- authenticated persona — fn_trash_authz rejects claimless callers.
SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

SELECT lives_ok(
  $$SELECT public.soft_delete_row('assets',
      'aaaa1111-0000-0000-0000-000000002001')$$,
  'trash RPC with broadcast trigger attached succeeds');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- With full realtime infrastructure the 4 writes above must have landed
-- rows on the project topic; db-only stacks report no-schema/no-partition.
SELECT ok(pg_temp.rabbit_broadcast_status(4) IN ('landed', 'no-schema', 'no-partition'),
  'broadcast rows land on rabbit:project:% when realtime infrastructure is present');

SELECT * FROM finish();
ROLLBACK;
