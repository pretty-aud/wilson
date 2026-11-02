-- =============================================================================
-- 112_private_project_channels.sql — migration 0109, the privacy repairs'
-- part C (M.O.T.H. Session 1; docs/design/MOTH_DESIGN.md §2.6 R9, R10).
--
-- What this pins:
--   * The bodies (CI-biting): project_topic and project_topic_matches exist
--     with their grants; fn_realtime_broadcast is 0109's (md5); the workspace
--     broadcast judges its sides before its filters and builds AUDIENCE from
--     literals; the project broadcast compares both sides' projects and keeps
--     the files money test; the bid version sender routes by project_topic.
--   * The join test (CI-biting): project_topic_matches admits a project the
--     caller can see at its CURRENT epoch only (none at 0, digits after), and
--     nothing else; the project-topic read policy uses it, measured as a
--     member reading realtime.messages under a stale and a current topic.
--   * The workspace topic: a private project's writes (create, rename, an
--     assigned task, an asset trashed, a seat) add nothing; the same on a
--     public project land; a visibility flip, either way, sends exactly one
--     AUDIENCE with no id and no title; a move out of a private project is
--     INSERT-shaped with no old row, a move into one DELETE-shaped with the
--     public side only; a move that gains an assignee only on the private
--     side sends nothing (SEC-8).
--   * The project topic: a move between projects sends a DELETE to the old
--     project's topic and an INSERT to the new one's; a narrowing sends one
--     AUDIENCE to the old topic and the write to the new one, and later
--     writes reach only the new one; a dependency across projects sends
--     nothing; a bid version reaches the current topic.
--
-- Environment-tolerant like 23_workspace_realtime.sql: a stack without the
-- realtime schema (CI's db-only stack) answers 'vacuous' for every channel
-- probe, so they bite only where realtime.messages exists (the wilson-dev
-- rehearsal, which records its planted controls). Fixture ids are hex
-- (projects aaaa1111-…-00000000012x, rows 11200000-…). Every write is the
-- runner's (unbound), so 0107's guards let the cross-project rows through and
-- still bump the epoch on a narrowing (for every caller).
-- =============================================================================

BEGIN;

SELECT plan(40);

SELECT * FROM tests.rls_setup();

-- user_c: plain 'user'; user_d: 'manager', the projects' creator; user_e: a
-- second 'manager' with no seat. user_a (from rls_setup) is the admin.
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
  ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','manager','user_d','User D',true),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','manager','user_e','User E',true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- P private; Q, R and S public (Q is flipped both ways on the workspace
-- topic, R for the join test, S on the project topic).
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private) VALUES
  ('aaaa1111-0000-0000-0000-000000000121', '11111111-1111-1111-1111-111111111111', 'Private P 112', 'dddddddd-dddd-dddd-dddd-dddddddddddd', true),
  ('aaaa1111-0000-0000-0000-000000000122', '11111111-1111-1111-1111-111111111111', 'Public Q 112',  'dddddddd-dddd-dddd-dddd-dddddddddddd', false),
  ('aaaa1111-0000-0000-0000-000000000123', '11111111-1111-1111-1111-111111111111', 'Public R 112',  'dddddddd-dddd-dddd-dddd-dddddddddddd', false),
  ('aaaa1111-0000-0000-0000-000000000124', '11111111-1111-1111-1111-111111111111', 'Public S 112',  'dddddddd-dddd-dddd-dddd-dddddddddddd', false);

INSERT INTO public.assets (id, workspace_id, project_id, name) VALUES
  ('11200000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000121', 'P asset'),
  ('11200000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000121', 'P asset, moved to Q'),
  ('11200000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000122', 'Q asset');

INSERT INTO public.tasks (id, workspace_id, project_id, title, assignee_id) VALUES
  ('11200000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000121', 'P task, assigned, moved to Q', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  ('11200000-0000-0000-0000-0000000000b2', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000122', 'Q task, assigned, moved to P', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  ('11200000-0000-0000-0000-0000000000b3', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000122', 'Q task, unassigned, moved to P', NULL),
  ('11200000-0000-0000-0000-0000000000b4', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000122', 'Q task, a dependency end', NULL),
  ('11200000-0000-0000-0000-0000000000b5', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000121', 'P task, a dependency end', NULL),
  ('11200000-0000-0000-0000-0000000000b6', '11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000124', 'S task', NULL);

-- ── the channel inspectors (runner) ───────────────────────────────────────
-- 'no-schema' (no realtime.messages or broadcast_changes), 'no-partition'
-- (realtime.send lands nothing), else 'ok' — as 20_realtime.sql's vocabulary.
CREATE FUNCTION pg_temp.rt_env()
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
                        'rabbit:pgtap:112-partition-probe', true);
  EXECUTE 'SELECT count(*) FROM realtime.messages
            WHERE topic = ''rabbit:pgtap:112-partition-probe'''
    INTO n;
  RETURN CASE WHEN n = 0 THEN 'no-partition' ELSE 'ok' END;
END;
$$;

-- What one write adds to realtime.messages on the topics given, labelled.
CREATE TEMP TABLE cap (k TEXT PRIMARY KEY, env TEXT, sent JSONB);

CREATE FUNCTION pg_temp.capture(p_k TEXT, p_sql TEXT, p_topics TEXT[], p_labels TEXT[])
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_env    TEXT := pg_temp.rt_env();
  v_before TEXT[];
  v_sent   JSONB := '[]'::jsonb;
BEGIN
  IF v_env = 'ok' THEN
    EXECUTE 'SELECT COALESCE(array_agg(id::text), ''{}'') FROM realtime.messages WHERE topic = ANY($1)'
      INTO v_before USING p_topics;
  END IF;
  EXECUTE p_sql;
  IF v_env = 'ok' THEN
    EXECUTE 'SELECT COALESCE(jsonb_agg(jsonb_build_object(''label'', $3[array_position($1, topic)],
                                                         ''event'', event, ''payload'', payload)), ''[]''::jsonb)
               FROM realtime.messages WHERE topic = ANY($1) AND NOT (id::text = ANY($2))'
      INTO v_sent USING p_topics, v_before, p_labels;
  END IF;
  INSERT INTO cap VALUES (p_k, v_env, v_sent);
END;
$$;

-- 'vacuous' without realtime; else the events, 'label:EVENT' in order, or 'nothing'.
CREATE FUNCTION pg_temp.got(p_k TEXT)
RETURNS TEXT LANGUAGE sql AS $$
  SELECT CASE WHEN env <> 'ok' THEN 'vacuous'
              ELSE COALESCE((SELECT string_agg((e ->> 'label') || ':' || (e ->> 'event'), ' '
                                               ORDER BY e ->> 'label', e ->> 'event')
                               FROM jsonb_array_elements(sent) e), 'nothing') END
    FROM cap WHERE k = p_k;
$$;

CREATE FUNCTION pg_temp.want(p_k TEXT, p_want TEXT)
RETURNS TEXT LANGUAGE sql AS $$
  SELECT CASE WHEN env <> 'ok' THEN 'vacuous' ELSE p_want END FROM cap WHERE k = p_k;
$$;

-- The payload of the one event a capture holds for a label.
CREATE FUNCTION pg_temp.payload(p_k TEXT, p_label TEXT)
RETURNS JSONB LANGUAGE sql AS $$
  SELECT (SELECT e -> 'payload' FROM jsonb_array_elements(sent) e WHERE e ->> 'label' = p_label LIMIT 1)
    FROM cap WHERE k = p_k;
$$;

CREATE FUNCTION pg_temp.vacuous(p_k TEXT)
RETURNS BOOLEAN LANGUAGE sql AS $$
  SELECT env <> 'ok' FROM cap WHERE k = p_k;
$$;

-- How many rows of realtime.messages on p_row_topic a member reads with the
-- channel joined as p_join (realtime.topic() reads the realtime.topic
-- setting): the read policy, measured. NULL without realtime.messages.
CREATE FUNCTION pg_temp.visible_as(p_user UUID, p_join TEXT, p_row_topic TEXT)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  n BIGINT;
BEGIN
  IF to_regclass('realtime.messages') IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM tests.login_as(p_user, '11111111-1111-1111-1111-111111111111');
  PERFORM set_config('realtime.topic', p_join, true);
  EXECUTE 'SELECT count(*) FROM realtime.messages WHERE topic = $1' INTO n USING p_row_topic;
  PERFORM set_config('realtime.topic', '', true);
  PERFORM set_config('request.jwt.claims', '{}', true);
  RESET ROLE;
  RETURN n;
END;
$$;

-- ── probes 1-11: the bodies and grants (CI-biting) ────────────────────────
SELECT has_function('public', 'project_topic', ARRAY['uuid'], 'project_topic(uuid) exists'); -- 1
SELECT has_function('public', 'project_topic_matches', ARRAY['text'], 'project_topic_matches(text) exists'); -- 2

SELECT ok(
  NOT has_function_privilege('anon', 'public.project_topic(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.project_topic(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.project_topic_matches(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.project_topic_matches(text)', 'EXECUTE')
  AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.project_topic(uuid)'::regprocedure)
  AND NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.project_topic_matches(text)'::regprocedure),
  'project_topic is a definer no client runs; project_topic_matches is the caller''s (INVOKER), granted to authenticated only'); -- 3

SELECT is(
  (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.fn_realtime_broadcast()'::regprocedure),
  'cb26163e64f063de4da39c4eb316de4b',
  'fn_realtime_broadcast is 0109''s body, the one its pre-flight names'); -- 4

SELECT ok(
  (SELECT strpos(b, 'is_private') > 0 AND strpos(b, '''rabbit:workspace:''') > 0
      AND strpos(b, 'v_sn :=') > 0 AND strpos(b, 'v_sn :=') < strpos(b, 'assignee_id')
     FROM (SELECT regexp_replace(regexp_replace(prosrc, '/\*.*?\*/', '', 'g'), '--[^' || chr(10) || ']*', '', 'g') AS b
             FROM pg_proc WHERE oid = 'public.fn_workspace_realtime_broadcast()'::regprocedure) s),
  'the workspace broadcast reads is_private and judges each side before the assignee filter (SEC-8)'); -- 5

SELECT ok(
  (SELECT strpos(regexp_replace(b, '\s+', ' ', 'g'),
                 'jsonb_build_object(''table'', ''projects'', ''schema'', ''public'', ''operation'', ''AUDIENCE'', ''record'', NULL, ''old_record'', NULL), ''AUDIENCE''') > 0
     FROM (SELECT regexp_replace(regexp_replace(prosrc, '/\*.*?\*/', '', 'g'), '--[^' || chr(10) || ']*', '', 'g') AS b
             FROM pg_proc WHERE oid = 'public.fn_workspace_realtime_broadcast()'::regprocedure) s),
  'the workspace AUDIENCE event is built from literals only: no id, no title'); -- 6

SELECT ok(
  (SELECT strpos(b, 'public.project_topic(') > 0 AND strpos(b, 'realtime.send(') > 0
      AND strpos(b, 'v_pn IS NOT DISTINCT FROM v_po') > 0
      AND strpos(b, 'public.file_row_is_money((to_jsonb(NEW) ->> ''is_financial'')::boolean') > 0
      AND strpos(b, 'public.file_row_is_money((to_jsonb(OLD) ->> ''is_financial'')::boolean') > 0
     FROM (SELECT regexp_replace(regexp_replace(regexp_replace(prosrc, '/\*.*?\*/', '', 'g'), '--[^' || chr(10) || ']*', '', 'g'), '\s+', ' ', 'g') AS b
             FROM pg_proc WHERE oid = 'public.fn_realtime_broadcast()'::regprocedure) s),
  'the project broadcast routes by project_topic, compares both sides'' projects, and keeps the files money test on both sides'); -- 7

SELECT ok(
  (SELECT strpos(b, 'public.project_topic(v_project)') > 0 AND strpos(b, 'broadcast_changes') = 0
      AND strpos(b, 'to_jsonb(NEW)') = 0
     FROM (SELECT regexp_replace(regexp_replace(prosrc, '/\*.*?\*/', '', 'g'), '--[^' || chr(10) || ']*', '', 'g') AS b
             FROM pg_proc WHERE oid = 'public.fn_budget_versions_broadcast()'::regprocedure) s),
  'the bid version sender routes by project_topic and never sends a whole row'); -- 8

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.fn_workspace_realtime_broadcast()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.fn_realtime_broadcast()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.fn_budget_versions_broadcast()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.fn_workspace_realtime_broadcast()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.fn_realtime_broadcast()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.fn_budget_versions_broadcast()', 'EXECUTE'),
  'no client role may run the three broadcast definers'); -- 9

SELECT ok(
  to_regclass('realtime.messages') IS NULL
  OR (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'realtime' AND tablename = 'messages'
         AND policyname IN ('rabbit_project_topic_read', 'rabbit_project_topic_presence_write')
         AND COALESCE(qual, with_check) LIKE '%project_topic_matches(realtime.topic())%') = 2,
  'both project-topic policies test the topic''s epoch wherever realtime.messages exists'); -- 10

SELECT is(
  (SELECT count(*)::int FROM pg_trigger
    WHERE NOT tgisinternal AND tgfoid = 'public.fn_workspace_realtime_broadcast()'::regprocedure),
  5, 'the workspace broadcast is on its five tables, unchanged'); -- 11

-- ── probes 12-18: the join test, at each epoch (CI-biting) ───────────────
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT is(public.project_topic_matches('rabbit:project:aaaa1111-0000-0000-0000-000000000123'), true,
  'a member joins a public project''s topic at epoch 0'); -- 12
SELECT ok(NOT public.project_topic_matches('rabbit:project:aaaa1111-0000-0000-0000-000000000123:1')
          AND NOT public.project_topic_matches('rabbit:project:aaaa1111-0000-0000-0000-000000000123:0'),
  'at epoch 0 the topic has no suffix: '':1'' and '':0'' are refused'); -- 13
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

UPDATE public.projects SET is_private = true WHERE id = 'aaaa1111-0000-0000-0000-000000000123';
SELECT ok(public.project_topic('aaaa1111-0000-0000-0000-000000000123') = 'rabbit:project:aaaa1111-0000-0000-0000-000000000123:1'
          AND public.project_topic('11200000-0000-0000-0000-0000000000ff') IS NULL,
  'a narrowing moves the project to epoch 1''s topic; a project that does not exist has none'); -- 14

SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT is(public.project_topic_matches('rabbit:project:aaaa1111-0000-0000-0000-000000000123:1'), false,
  'a member who cannot see the private project cannot join its new topic'); -- 15
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT ok(public.project_topic_matches('rabbit:project:aaaa1111-0000-0000-0000-000000000123:1')
          AND NOT public.project_topic_matches('rabbit:project:aaaa1111-0000-0000-0000-000000000123'),
  'the creator joins the new topic, and not the stale one'); -- 16
SELECT ok(NOT public.project_topic_matches('rabbit:project:aaaa1111-0000-0000-0000-000000000123:x')
          AND NOT public.project_topic_matches('rabbit:project:aaaa1111-0000-0000-0000-000000000123:1:x')
          AND NOT public.project_topic_matches('rabbit:project:aaaa1111-0000-0000-0000-000000000123:01')
          AND NOT public.project_topic_matches('rabbit:project:11200000-0000-0000-0000-0000000000ff')
          AND NOT public.project_topic_matches('rabbit:workspace:aaaa1111-0000-0000-0000-000000000123')
          AND NOT public.project_topic_matches(NULL),
  'a suffix that is not the epoch, a fifth part, a stranger''s id, another kind of topic or none: refused'); -- 17
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

UPDATE public.projects SET is_private = false WHERE id = 'aaaa1111-0000-0000-0000-000000000123';
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT ok(public.project_topic_matches('rabbit:project:aaaa1111-0000-0000-0000-000000000123:1')
          AND NOT public.project_topic_matches('rabbit:project:aaaa1111-0000-0000-0000-000000000123'),
  'made public again, the project keeps epoch 1: the member joins '':1'', never the topic it heard before'); -- 18
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- ── probe 19: the read policy, measured ───────────────────────────────────
-- R's UPDATE back to public above went to 'rabbit:project:R:1' (both sides at
-- epoch 1). A member joined on the stale topic reads none of it; joined on
-- the current topic, the member reads it.
SELECT ok(
  pg_temp.rt_env() <> 'ok'
  OR (pg_temp.visible_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'rabbit:project:aaaa1111-0000-0000-0000-000000000123',
                         'rabbit:project:aaaa1111-0000-0000-0000-000000000123:1') = 0
      AND pg_temp.visible_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'rabbit:project:aaaa1111-0000-0000-0000-000000000123:1',
                             'rabbit:project:aaaa1111-0000-0000-0000-000000000123:1') >= 1),
  'the project-topic read policy refuses a stale epoch''s join and admits the current one (vacuous without realtime)'); -- 19

-- ── probes 20-33: the workspace topic ─────────────────────────────────────
SELECT pg_temp.capture('p_create', $$INSERT INTO public.projects (id, workspace_id, title, created_by, is_private)
  VALUES ('aaaa1111-0000-0000-0000-000000000125', '11111111-1111-1111-1111-111111111111', 'Private P2 112',
          'dddddddd-dddd-dddd-dddd-dddddddddddd', true)$$,
  ARRAY['rabbit:workspace:11111111-1111-1111-1111-111111111111'], ARRAY['ws']);
SELECT is(pg_temp.got('p_create'), pg_temp.want('p_create', 'nothing'),
  'a private project''s creation adds nothing to the workspace topic'); -- 20

SELECT pg_temp.capture('p_rename', $$UPDATE public.projects SET title = 'Private P 112, renamed'
  WHERE id = 'aaaa1111-0000-0000-0000-000000000121'$$,
  ARRAY['rabbit:workspace:11111111-1111-1111-1111-111111111111'], ARRAY['ws']);
SELECT is(pg_temp.got('p_rename'), pg_temp.want('p_rename', 'nothing'),
  'a private project''s rename adds nothing to the workspace topic'); -- 21

SELECT pg_temp.capture('p_task', $$INSERT INTO public.tasks (id, workspace_id, project_id, title, assignee_id)
  VALUES ('11200000-0000-0000-0000-0000000000b7', '11111111-1111-1111-1111-111111111111',
          'aaaa1111-0000-0000-0000-000000000121', 'P task, assigned', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')$$,
  ARRAY['rabbit:workspace:11111111-1111-1111-1111-111111111111'], ARRAY['ws']);
SELECT is(pg_temp.got('p_task'), pg_temp.want('p_task', 'nothing'),
  'an assigned task created in a private project adds nothing to the workspace topic'); -- 22

SELECT pg_temp.capture('p_trash', $$UPDATE public.assets SET deleted_at = now()
  WHERE id = '11200000-0000-0000-0000-0000000000a1'$$,
  ARRAY['rabbit:workspace:11111111-1111-1111-1111-111111111111'], ARRAY['ws']);
SELECT is(pg_temp.got('p_trash'), pg_temp.want('p_trash', 'nothing'),
  'an asset trashed in a private project adds nothing to the workspace topic'); -- 23

SELECT pg_temp.capture('p_seat', $$INSERT INTO public.project_members (workspace_id, project_id, user_id, project_role)
  VALUES ('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000121',
          'cccccccc-cccc-cccc-cccc-cccccccccccc', 'manager')$$,
  ARRAY['rabbit:workspace:11111111-1111-1111-1111-111111111111'], ARRAY['ws']);
SELECT is(pg_temp.got('p_seat'), pg_temp.want('p_seat', 'nothing'),
  'a seat on a private project adds nothing to the workspace topic'); -- 24

SELECT pg_temp.capture('q_writes', $$WITH r AS (UPDATE public.projects SET title = 'Public Q 112, renamed'
                                                 WHERE id = 'aaaa1111-0000-0000-0000-000000000122' RETURNING 1),
       t AS (INSERT INTO public.tasks (id, workspace_id, project_id, title, assignee_id)
             VALUES ('11200000-0000-0000-0000-0000000000b8', '11111111-1111-1111-1111-111111111111',
                     'aaaa1111-0000-0000-0000-000000000122', 'Q task, assigned', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') RETURNING 1),
       a AS (UPDATE public.assets SET deleted_at = now() WHERE id = '11200000-0000-0000-0000-0000000000a3' RETURNING 1),
       s AS (INSERT INTO public.project_members (workspace_id, project_id, user_id, project_role)
             VALUES ('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000122',
                     'cccccccc-cccc-cccc-cccc-cccccccccccc', 'manager') RETURNING 1)
  SELECT 1 FROM r, t, a, s$$,
  ARRAY['rabbit:workspace:11111111-1111-1111-1111-111111111111'], ARRAY['ws']);
SELECT ok(pg_temp.vacuous('q_writes')
          OR (SELECT jsonb_array_length(sent) >= 4 FROM cap WHERE k = 'q_writes'),
  'CONTROL for 21-24: the same four writes on a public project land on the workspace topic'); -- 25

SELECT pg_temp.capture('q_private', $$UPDATE public.projects SET is_private = true
  WHERE id = 'aaaa1111-0000-0000-0000-000000000122'$$,
  ARRAY['rabbit:workspace:11111111-1111-1111-1111-111111111111'], ARRAY['ws']);
SELECT is(pg_temp.got('q_private'), pg_temp.want('q_private', 'ws:AUDIENCE'),
  'making a project private sends the workspace exactly one AUDIENCE and nothing else'); -- 26
SELECT ok(pg_temp.vacuous('q_private')
          OR (pg_temp.payload('q_private', 'ws') -> 'record' = 'null'::jsonb
              AND pg_temp.payload('q_private', 'ws') -> 'old_record' = 'null'::jsonb
              AND strpos(pg_temp.payload('q_private', 'ws')::text, 'aaaa1111-0000-0000-0000-000000000122') = 0
              AND strpos(pg_temp.payload('q_private', 'ws')::text, 'Public Q') = 0),
  'the AUDIENCE carries no row: neither the project''s id nor its title'); -- 27

SELECT pg_temp.capture('q_public', $$UPDATE public.projects SET is_private = false
  WHERE id = 'aaaa1111-0000-0000-0000-000000000122'$$,
  ARRAY['rabbit:workspace:11111111-1111-1111-1111-111111111111'], ARRAY['ws']);
SELECT is(pg_temp.got('q_public'), pg_temp.want('q_public', 'ws:AUDIENCE'),
  'making it public again sends exactly one AUDIENCE'); -- 28

SELECT pg_temp.capture('p_to_q', $$UPDATE public.tasks SET project_id = 'aaaa1111-0000-0000-0000-000000000122'
  WHERE id = '11200000-0000-0000-0000-0000000000b1'$$,
  ARRAY['rabbit:workspace:11111111-1111-1111-1111-111111111111'], ARRAY['ws']);
SELECT is(pg_temp.got('p_to_q'), pg_temp.want('p_to_q', 'ws:INSERT'),
  'a task moved out of a private project reaches the workspace INSERT-shaped'); -- 29
SELECT ok(pg_temp.vacuous('p_to_q')
          OR (pg_temp.payload('p_to_q', 'ws') -> 'old_record' = 'null'::jsonb
              AND pg_temp.payload('p_to_q', 'ws') -> 'record' ->> 'project_id' = 'aaaa1111-0000-0000-0000-000000000122'
              AND pg_temp.payload('p_to_q', 'ws') ->> 'operation' = 'INSERT'),
  '…with its public side only: no old row from the private project'); -- 30

SELECT pg_temp.capture('q_to_p', $$UPDATE public.tasks SET project_id = 'aaaa1111-0000-0000-0000-000000000121'
  WHERE id = '11200000-0000-0000-0000-0000000000b2'$$,
  ARRAY['rabbit:workspace:11111111-1111-1111-1111-111111111111'], ARRAY['ws']);
SELECT is(pg_temp.got('q_to_p'), pg_temp.want('q_to_p', 'ws:DELETE'),
  'a task moved into a private project reaches the workspace DELETE-shaped'); -- 31
SELECT ok(pg_temp.vacuous('q_to_p')
          OR (pg_temp.payload('q_to_p', 'ws') -> 'record' = 'null'::jsonb
              AND pg_temp.payload('q_to_p', 'ws') -> 'old_record' ->> 'project_id' = 'aaaa1111-0000-0000-0000-000000000122'),
  '…with its public side only: no new row from the private project'); -- 32

SELECT pg_temp.capture('sec8', $$UPDATE public.tasks SET project_id = 'aaaa1111-0000-0000-0000-000000000121',
                                                        assignee_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
  WHERE id = '11200000-0000-0000-0000-0000000000b3'$$,
  ARRAY['rabbit:workspace:11111111-1111-1111-1111-111111111111'], ARRAY['ws']);
SELECT is(pg_temp.got('sec8'), pg_temp.want('sec8', 'nothing'),
  'SEC-8: a move into a private project that gains an assignee only there sends nothing (the filter tests the sides sent)'); -- 33

-- ── probes 34-40: the project topic ───────────────────────────────────────
SELECT pg_temp.capture('asset_move', $$UPDATE public.assets SET project_id = 'aaaa1111-0000-0000-0000-000000000122'
  WHERE id = '11200000-0000-0000-0000-0000000000a2'$$,
  ARRAY[public.project_topic('aaaa1111-0000-0000-0000-000000000121'), public.project_topic('aaaa1111-0000-0000-0000-000000000122')],
  ARRAY['P', 'Q']);
SELECT is(pg_temp.got('asset_move'), pg_temp.want('asset_move', 'P:DELETE Q:INSERT'),
  'an asset moved from P to Q: a DELETE on P''s topic and an INSERT on Q''s'); -- 34
SELECT ok(pg_temp.vacuous('asset_move')
          OR (strpos(pg_temp.payload('asset_move', 'Q')::text, 'aaaa1111-0000-0000-0000-000000000121') = 0
              AND pg_temp.payload('asset_move', 'Q') -> 'old_record' = 'null'::jsonb
              AND pg_temp.payload('asset_move', 'P') -> 'record' = 'null'::jsonb),
  'Q''s event holds no P id and no old row; P''s holds no new row'); -- 35

SELECT pg_temp.capture('s_private', $$UPDATE public.projects SET is_private = true
  WHERE id = 'aaaa1111-0000-0000-0000-000000000124'$$,
  ARRAY['rabbit:project:aaaa1111-0000-0000-0000-000000000124', 'rabbit:project:aaaa1111-0000-0000-0000-000000000124:1'],
  ARRAY['S0', 'S1']);
SELECT is(pg_temp.got('s_private'), pg_temp.want('s_private', 'S0:AUDIENCE S1:UPDATE'),
  'a narrowing: one AUDIENCE on the old topic, the UPDATE on the new one'); -- 36

SELECT pg_temp.capture('s_after', $$UPDATE public.tasks SET title = 'S task, renamed'
  WHERE id = '11200000-0000-0000-0000-0000000000b6'$$,
  ARRAY['rabbit:project:aaaa1111-0000-0000-0000-000000000124', 'rabbit:project:aaaa1111-0000-0000-0000-000000000124:1'],
  ARRAY['S0', 'S1']);
SELECT is(pg_temp.got('s_after'), pg_temp.want('s_after', 'S1:UPDATE'),
  'after it, a write reaches only the new topic: a listener on the old one hears nothing'); -- 37

SELECT pg_temp.capture('dep_cross', $$INSERT INTO public.task_dependencies (id, predecessor_id, successor_id)
  VALUES ('11200000-0000-0000-0000-0000000000c1', '11200000-0000-0000-0000-0000000000b5', '11200000-0000-0000-0000-0000000000b4')$$,
  ARRAY[public.project_topic('aaaa1111-0000-0000-0000-000000000121'), public.project_topic('aaaa1111-0000-0000-0000-000000000122')],
  ARRAY['P', 'Q']);
SELECT is(pg_temp.got('dep_cross'), pg_temp.want('dep_cross', 'nothing'),
  'a dependency joining two projects is sent to neither'); -- 38

SELECT pg_temp.capture('dep_same', $$INSERT INTO public.task_dependencies (id, predecessor_id, successor_id)
  VALUES ('11200000-0000-0000-0000-0000000000c2', '11200000-0000-0000-0000-0000000000b4', '11200000-0000-0000-0000-0000000000b1')$$,
  ARRAY[public.project_topic('aaaa1111-0000-0000-0000-000000000121'), public.project_topic('aaaa1111-0000-0000-0000-000000000122')],
  ARRAY['P', 'Q']);
SELECT is(pg_temp.got('dep_same'), pg_temp.want('dep_same', 'Q:INSERT'),
  'CONTROL for 38: a dependency inside Q reaches Q''s topic'); -- 39

SELECT pg_temp.capture('bid_version', $$INSERT INTO public.budget_versions (id, workspace_id, project_id, name)
  VALUES ('11200000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111',
          'aaaa1111-0000-0000-0000-000000000124', 'S bid 112')$$,
  ARRAY['rabbit:project:aaaa1111-0000-0000-0000-000000000124', 'rabbit:project:aaaa1111-0000-0000-0000-000000000124:1'],
  ARRAY['S0', 'S1']);
SELECT is(pg_temp.got('bid_version'), pg_temp.want('bid_version', 'S1:INSERT'),
  'a bid version''s thin event reaches the project''s current topic only'); -- 40

SELECT * FROM finish();
ROLLBACK;
