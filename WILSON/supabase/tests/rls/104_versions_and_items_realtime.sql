-- =============================================================================
-- 104_versions_and_items_realtime.sql — migration 0101 (R1, night 2 of
-- docs/sessions/PLAN_TO_1_0.md, 2026-10-27): bid versions on the project
-- channel as a thin event (S5-02), and an assigned task's items on the
-- workspace channel (the Dashboard's assets).
--
-- What this pins:
--   * Structure, everywhere (CI included): each function exists, is SECURITY
--     DEFINER with its search_path pinned, and no client role may run it; each
--     trigger is an enabled AFTER INSERT OR UPDATE OR DELETE row trigger
--     running its function; the workspace one reads the privacy flag and both
--     assignment columns.
--   * 🚨 Money (S5-02), everywhere: no trigger on budget_versions runs a
--     whole-row broadcast (fn_realtime_broadcast, fn_workspace_realtime_broadcast),
--     neither generic body names budget_versions, and the thin event's body
--     names no snapshot and passes no row to broadcast_changes.
--   * Every write still succeeds with the triggers on: a bid version made,
--     renamed and deleted by the workspace admin (past the money gate), a
--     task's second item added, and the same in a private project and on an
--     unassigned task.
--   * Where realtime is present — dev, by hand: rls.yml starts CI's stack
--     without realtime, so there these read 'no-schema' and are NOT a
--     measurement — the version's INSERT, UPDATE and DELETE each land on
--     rabbit:project:{project} with record and old_record cut to
--     {id, project_id}, and the version's name and snapshot appear in no
--     message anywhere; the assigned task's second item lands on
--     rabbit:workspace:{ws}; the private project's items and the unassigned
--     task's items do not. Each verdict has its instrument's CONTROL, as
--     suite 72's: an assets row on the project's topic (0016 has sent one
--     since Session 7) and an assigned task's row on the workspace's (0018).
--
-- Fixture ids carry 104 (10400000-…); every read is scoped to them.
-- =============================================================================

BEGIN;

SELECT plan(25);

SELECT * FROM tests.rls_setup();

-- ── Fixtures (runner) ───────────────────────────────────────────────────────
--   A1, A2  assets in project_a (public)
--   PP      a PRIVATE project in ws_a, made by user_a; PA1, PA2 its assets
--   T1      a task in project_a assigned to user_a, about A1 (0096 seeds its item)
--   T2      a task in project_a with neither assignee nor reviewer, about A1
--   TP      a task in PP assigned to user_a, about PA1
INSERT INTO public.assets (id, project_id, name) VALUES
  ('10400000-0000-0000-0000-0000000000a1', 'aaaa1111-0000-0000-0000-000000000001', 'R1 asset one'),
  ('10400000-0000-0000-0000-0000000000a2', 'aaaa1111-0000-0000-0000-000000000001', 'R1 asset two');

INSERT INTO public.projects (id, workspace_id, title, is_private, created_by) VALUES
  ('10400000-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111',
   'R1 private project', true, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

INSERT INTO public.assets (id, project_id, name) VALUES
  ('10400000-0000-0000-0000-0000000000b1', '10400000-0000-0000-0000-0000000000f1', 'R1 private asset one'),
  ('10400000-0000-0000-0000-0000000000b2', '10400000-0000-0000-0000-0000000000f1', 'R1 private asset two');

INSERT INTO public.tasks (id, project_id, asset_id, title, assignee_id) VALUES
  ('10400000-0000-0000-0000-0000000000c1', 'aaaa1111-0000-0000-0000-000000000001',
   '10400000-0000-0000-0000-0000000000a1', 'R1 assigned task', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('10400000-0000-0000-0000-0000000000c3', '10400000-0000-0000-0000-0000000000f1',
   '10400000-0000-0000-0000-0000000000b1', 'R1 private assigned task', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO public.tasks (id, project_id, asset_id, title) VALUES
  ('10400000-0000-0000-0000-0000000000c2', 'aaaa1111-0000-0000-0000-000000000001',
   '10400000-0000-0000-0000-0000000000a1', 'R1 unassigned task');

-- ── Environment-tolerant inspectors (suite 72's vocabulary) ────────────────
--   'no-schema'         realtime.messages / realtime.send absent (CI's stack)
--   'no-partition'      no partition covers now(): realtime.send drops the row
--   'instrument-broken' realtime is there and the CONTROL's row cannot be
--                       seen, so a verdict here would mean nothing
--   'landed' / 'missed', 'withheld' / 'leaked'   the verdicts
CREATE FUNCTION pg_temp.r1_env() RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE n BIGINT;
BEGIN
  IF to_regclass('realtime.messages') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'realtime' AND p.proname = 'send'
  ) THEN
    RETURN 'no-schema';
  END IF;
  BEGIN
    PERFORM realtime.send('{"probe":true}'::jsonb, 'PGTAP-PROBE', 'rabbit:pgtap:r1-partition-probe', true);
  EXCEPTION WHEN OTHERS THEN
    RETURN 'no-partition';
  END;
  EXECUTE 'SELECT count(*) FROM realtime.messages WHERE topic = ''rabbit:pgtap:r1-partition-probe''' INTO n;
  RETURN CASE WHEN n = 0 THEN 'no-partition' ELSE 'present' END;
END;
$$;

-- How many broadcast messages on `p_topic` carry `p_table` and, when given,
-- the record (or old_record) field `p_field` = `p_value`.
CREATE FUNCTION pg_temp.r1_count(p_topic TEXT, p_table TEXT, p_field TEXT DEFAULT NULL, p_value TEXT DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE n BIGINT;
BEGIN
  EXECUTE format(
    'SELECT count(*) FROM realtime.messages
      WHERE topic = %L AND extension = ''broadcast'' AND payload ->> ''table'' = %L
        AND (%L IS NULL OR payload -> ''record'' ->> %L = %L OR payload -> ''old_record'' ->> %L = %L)',
    p_topic, p_table, p_field, p_field, p_value, p_field, p_value)
    INTO n;
  RETURN n;
END;
$$;

-- The bid version's three events on project_a's topic, against the control.
CREATE FUNCTION pg_temp.r1_versions_status() RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  env   TEXT := pg_temp.r1_env();
  topic TEXT := 'rabbit:project:aaaa1111-0000-0000-0000-000000000001';
  n     BIGINT;
BEGIN
  IF env <> 'present' THEN RETURN env; END IF;
  IF pg_temp.r1_count(topic, 'assets', 'id', '10400000-0000-0000-0000-0000000000a1') = 0 THEN
    RETURN 'instrument-broken';
  END IF;
  EXECUTE format(
    'SELECT count(DISTINCT payload ->> ''operation'') FROM realtime.messages
      WHERE topic = %L AND extension = ''broadcast'' AND payload ->> ''table'' = ''budget_versions''
        AND (payload -> ''record'' ->> ''id'' = %L OR payload -> ''old_record'' ->> ''id'' = %L)',
    topic, '10400000-0000-0000-0000-0000000000d1', '10400000-0000-0000-0000-0000000000d1')
    INTO n;
  RETURN CASE WHEN n = 3 THEN 'landed' ELSE 'missed (' || n || ' of INSERT, UPDATE, DELETE)' END;
END;
$$;

-- 🚨 The money rule on the wire: the version's name and its snapshot's figure
-- are in no message on any topic, and every budget_versions message's record
-- and old_record hold the id and the project only.
CREATE FUNCTION pg_temp.r1_versions_money_status() RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  env TEXT := pg_temp.r1_env();
  n   BIGINT;
BEGIN
  IF env <> 'present' THEN RETURN env; END IF;
  EXECUTE 'SELECT count(*) FROM realtime.messages
            WHERE payload::text LIKE ''%R1 secret-name-104%'' OR payload::text LIKE ''%987654%''
               OR payload::text LIKE ''%R1 renamed-104%'' OR payload::text LIKE ''%876543%'''
    INTO n;
  IF n > 0 THEN RETURN 'leaked'; END IF;
  EXECUTE 'SELECT count(*) FROM realtime.messages
            WHERE payload ->> ''table'' = ''budget_versions''
              AND ((payload -> ''record'' IS NOT NULL AND jsonb_typeof(payload -> ''record'') = ''object''
                    AND (payload -> ''record'') - ''id'' - ''project_id'' <> ''{}''::jsonb)
                OR (payload -> ''old_record'' IS NOT NULL AND jsonb_typeof(payload -> ''old_record'') = ''object''
                    AND (payload -> ''old_record'') - ''id'' - ''project_id'' <> ''{}''::jsonb))'
    INTO n;
  RETURN CASE WHEN n > 0 THEN 'leaked' ELSE 'withheld' END;
END;
$$;

-- The workspace topic: the assigned task's second item, against the control.
CREATE FUNCTION pg_temp.r1_items_status() RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  env   TEXT := pg_temp.r1_env();
  topic TEXT := 'rabbit:workspace:11111111-1111-1111-1111-111111111111';
BEGIN
  IF env <> 'present' THEN RETURN env; END IF;
  IF pg_temp.r1_count(topic, 'tasks', 'id', '10400000-0000-0000-0000-0000000000c1') = 0 THEN
    RETURN 'instrument-broken';
  END IF;
  RETURN CASE WHEN pg_temp.r1_count(topic, 'task_items', 'entity_id', '10400000-0000-0000-0000-0000000000a2') > 0
              THEN 'landed' ELSE 'missed' END;
END;
$$;

-- Nothing of the private project's, nor of the unassigned task's items, on
-- the workspace topic.
CREATE FUNCTION pg_temp.r1_items_withheld_status(p_field TEXT, p_value TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE env TEXT := pg_temp.r1_env();
BEGIN
  IF env <> 'present' THEN RETURN env; END IF;
  RETURN CASE WHEN pg_temp.r1_count('rabbit:workspace:11111111-1111-1111-1111-111111111111', 'task_items', p_field, p_value) = 0
              THEN 'withheld' ELSE 'leaked' END;
END;
$$;


-- ═════════════════════════════════════════════════════════════════════════
-- Structure (everywhere)
-- ═════════════════════════════════════════════════════════════════════════

-- 1
SELECT has_function('public', 'fn_budget_versions_broadcast', 'fn_budget_versions_broadcast() exists (0101 §1)');
-- 2
SELECT has_function('public', 'fn_task_items_ws_broadcast', 'fn_task_items_ws_broadcast() exists (0101 §2)');

-- 3, 4: tgtype bits 1 ROW, 2 BEFORE, 4 INSERT, 8 DELETE, 16 UPDATE.
SELECT ok(EXISTS (
  SELECT 1 FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
   WHERE tg.tgrelid = 'public.budget_versions'::regclass AND tg.tgname = 'trg_budget_versions_realtime'
     AND p.proname = 'fn_budget_versions_broadcast' AND tg.tgenabled <> 'D'
     AND (tg.tgtype & 1) = 1 AND (tg.tgtype & 2) = 0 AND (tg.tgtype & 28) = 28),
  'budget_versions carries trg_budget_versions_realtime: enabled, AFTER INSERT OR UPDATE OR DELETE, per row, running fn_budget_versions_broadcast');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
   WHERE tg.tgrelid = 'public.task_items'::regclass AND tg.tgname = 'trg_task_items_ws_realtime'
     AND p.proname = 'fn_task_items_ws_broadcast' AND tg.tgenabled <> 'D'
     AND (tg.tgtype & 1) = 1 AND (tg.tgtype & 2) = 0 AND (tg.tgtype & 28) = 28),
  'task_items carries trg_task_items_ws_realtime: enabled, AFTER INSERT OR UPDATE OR DELETE, per row, running fn_task_items_ws_broadcast');

-- 5
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('fn_budget_versions_broadcast', 'fn_task_items_ws_broadcast')
      AND p.prosecdef AND 'search_path=public' = ANY (p.proconfig)),
  2, 'both functions are SECURITY DEFINER with search_path=public');
-- 6
SELECT ok(
  NOT has_function_privilege('anon', 'public.fn_budget_versions_broadcast()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.fn_budget_versions_broadcast()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.fn_task_items_ws_broadcast()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.fn_task_items_ws_broadcast()', 'EXECUTE'),
  'no client role may run either trigger function');

-- 7 🚨
SELECT is(
  (SELECT count(*)::int FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
    WHERE tg.tgrelid = 'public.budget_versions'::regclass AND NOT tg.tgisinternal
      AND p.proname IN ('fn_realtime_broadcast', 'fn_workspace_realtime_broadcast')),
  0, '🚨 no trigger on budget_versions publishes whole rows: a bid version is money (0037), and both channels are wider than the money gate');
-- 8 🚨 (comments stripped first, as suite 99's probe 14)
SELECT ok(
  (SELECT bool_and(strpos(regexp_replace(regexp_replace(pg_get_functiondef(f::regprocedure),
                    '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g'), 'budget_versions') = 0)
     FROM unnest(ARRAY['public.fn_realtime_broadcast()', 'public.fn_workspace_realtime_broadcast()']) AS f),
  '🚨 neither generic broadcast body names budget_versions (no whole-row arm for a money table)');
-- 9 🚨 The thin event: the record is built from the id and the project, and
-- nothing in the body names the snapshot or hands a row to broadcast_changes.
SELECT ok(
  (SELECT b LIKE '%jsonb_build_object(''id'', NEW.id, ''project_id'', NEW.project_id)%'
      AND b LIKE '%jsonb_build_object(''id'', OLD.id, ''project_id'', OLD.project_id)%'
      AND strpos(b, 'snapshot') = 0
      AND strpos(b, 'broadcast_changes') = 0
      AND strpos(b, 'to_jsonb(NEW)') = 0
     FROM (SELECT regexp_replace(regexp_replace(pg_get_functiondef('public.fn_budget_versions_broadcast()'::regprocedure),
                    '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g') AS b) s),
  '🚨 the bid version event is built from {id, project_id} alone: no snapshot, no whole row');
-- 10
SELECT ok(
  (SELECT b LIKE '%is_private%' AND b LIKE '%assignee_id%' AND b LIKE '%reviewer_id%'
     FROM (SELECT regexp_replace(regexp_replace(pg_get_functiondef('public.fn_task_items_ws_broadcast()'::regprocedure),
                    '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g') AS b) s),
  'the workspace item event reads the project''s privacy and the task''s assignee and reviewer');


-- ═════════════════════════════════════════════════════════════════════════
-- The writes still succeed with the triggers on (as the workspace admin)
-- ═════════════════════════════════════════════════════════════════════════
-- The claims carry the app role: can_access_project_money (0037) reads it,
-- and tests.login_as sets the workspace alone (suite 91's block).
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- 11
SELECT lives_ok(
  $$INSERT INTO public.budget_versions (id, project_id, name, snapshot)
    VALUES ('10400000-0000-0000-0000-0000000000d1', 'aaaa1111-0000-0000-0000-000000000001',
            'R1 secret-name-104', '{"roleRates": {"director": 987654}}'::jsonb)$$,
  'a bid version is made with the trigger on (the admin is past the money gate)');
-- 12
SELECT lives_ok(
  $$UPDATE public.budget_versions SET name = 'R1 renamed-104', snapshot = '{"roleRates": {"director": 876543}}'::jsonb
     WHERE id = '10400000-0000-0000-0000-0000000000d1'$$,
  'it is renamed and saved with the trigger on');
-- 13
SELECT lives_ok(
  $$DELETE FROM public.budget_versions WHERE id = '10400000-0000-0000-0000-0000000000d1'$$,
  'it is deleted with the trigger on');
-- 14
SELECT lives_ok(
  $$INSERT INTO public.task_items (task_id, project_id, entity_type, entity_id, position)
    VALUES ('10400000-0000-0000-0000-0000000000c1', 'aaaa1111-0000-0000-0000-000000000001',
            'asset', '10400000-0000-0000-0000-0000000000a2', 1)$$,
  'an assigned task''s second item is added with the trigger on');
-- 15
SELECT lives_ok(
  $$INSERT INTO public.task_items (task_id, project_id, entity_type, entity_id, position)
    VALUES ('10400000-0000-0000-0000-0000000000c2', 'aaaa1111-0000-0000-0000-000000000001',
            'asset', '10400000-0000-0000-0000-0000000000a2', 1)$$,
  'an unassigned task''s second item is added with the trigger on');
-- 16
SELECT lives_ok(
  $$INSERT INTO public.task_items (task_id, project_id, entity_type, entity_id, position)
    VALUES ('10400000-0000-0000-0000-0000000000c3', '10400000-0000-0000-0000-0000000000f1',
            'asset', '10400000-0000-0000-0000-0000000000b2', 1)$$,
  'a private project''s task gets its second item with the trigger on (its creator)');
-- 17
SELECT lives_ok(
  $$DELETE FROM public.task_items
     WHERE task_id = '10400000-0000-0000-0000-0000000000c1' AND entity_id = '10400000-0000-0000-0000-0000000000a2'$$,
  'and the assigned task''s second item is removed with the trigger on');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- The rows written are the database's: the item made above was kept and its
-- removal took it (the triggers changed no write).
-- 18
SELECT is(
  (SELECT count(*)::int FROM public.task_items
    WHERE task_id IN ('10400000-0000-0000-0000-0000000000c1', '10400000-0000-0000-0000-0000000000c2',
                      '10400000-0000-0000-0000-0000000000c3')),
  5, 'five items stand: each task''s seeded first, and the two second items not removed');
-- 19
SELECT is(
  (SELECT count(*)::int FROM public.budget_versions WHERE id = '10400000-0000-0000-0000-0000000000d1'),
  0, 'the bid version is gone: the trigger aborted no write');


-- ═════════════════════════════════════════════════════════════════════════
-- What reached the channels (dev, by hand; 'no-schema' in CI is UNMEASURED)
-- 🚨 THE STATUS LEADS EACH DESCRIPTION, so a tolerated skip can never be
-- read as a measurement.
-- ═════════════════════════════════════════════════════════════════════════

-- 20
SELECT ok(pg_temp.r1_versions_status() IN ('landed', 'no-schema', 'no-partition'),
  'versions status=' || pg_temp.r1_versions_status()
  || ' — the version''s INSERT, UPDATE and DELETE each reach rabbit:project:{id}');
-- 21 🚨
SELECT ok(pg_temp.r1_versions_money_status() IN ('withheld', 'no-schema', 'no-partition'),
  'versions money status=' || pg_temp.r1_versions_money_status()
  || ' — 🚨 the version''s name and snapshot are in no message; its events carry {id, project_id} alone');
-- 22
SELECT ok(pg_temp.r1_items_status() IN ('landed', 'no-schema', 'no-partition'),
  'items status=' || pg_temp.r1_items_status()
  || ' — an assigned task''s second item reaches rabbit:workspace:{ws}');
-- 23 🚨
SELECT ok(pg_temp.r1_items_withheld_status('project_id', '10400000-0000-0000-0000-0000000000f1') IN ('withheld', 'no-schema', 'no-partition'),
  'private status=' || pg_temp.r1_items_withheld_status('project_id', '10400000-0000-0000-0000-0000000000f1')
  || ' — 🚨 a private project''s items never reach the workspace channel');
-- 24
SELECT ok(pg_temp.r1_items_withheld_status('task_id', '10400000-0000-0000-0000-0000000000c2') IN ('withheld', 'no-schema', 'no-partition'),
  'unassigned status=' || pg_temp.r1_items_withheld_status('task_id', '10400000-0000-0000-0000-0000000000c2')
  || ' — an unassigned task''s items stay off the workspace channel');
-- 25 The instruments' controls, named: where realtime is present, the
-- project topic has the assets row and the workspace topic the assigned
-- task's row (a verdict above is 'instrument-broken' otherwise).
SELECT ok(
  pg_temp.r1_env() <> 'present'
  OR (pg_temp.r1_count('rabbit:project:aaaa1111-0000-0000-0000-000000000001', 'assets', 'id', '10400000-0000-0000-0000-0000000000a1') > 0
      AND pg_temp.r1_count('rabbit:workspace:11111111-1111-1111-1111-111111111111', 'tasks', 'id', '10400000-0000-0000-0000-0000000000c1') > 0),
  'env=' || pg_temp.r1_env() || ' — the CONTROLS: the assets row on the project topic (0016) and the assigned task on the workspace topic (0018)');

SELECT * FROM finish();
ROLLBACK;
