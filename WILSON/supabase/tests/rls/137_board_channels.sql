-- =============================================================================
-- 137_board_channels.sql — M.O.T.H. Session 4 (MO4): a board's two live channels (0132).
--
-- A. Structure: the names are the server's; who may ask whether a name is theirs; the six triggers; on a stack with
--    realtime, the two policies and none that lets a client send on the database's channel.
-- B. Names: a reader is given both names at the board's epoch and generation; nobody else is given any; a name is
--    readable only by a reader, only as it stands now, and only in its own shape.
-- C. The audience moves: a board in the trash, a member who leaves, is removed or changes role, and a project's
--    privacy flip each rename the board, and its old names no longer read; a change that narrows nothing renames
--    nothing.
-- D. On a stack with realtime: one save is one message on the board's channel, with no file's id and without a
--    long pen's points; a removal one more; a renaming says AUDIENCE on both old names; a reader reads the board's
--    channel and sends on its live one only; nobody else reads either. Elsewhere 'vacuous', as 20, 23 and 112.
-- =============================================================================

BEGIN;
SELECT plan(42);

SELECT * FROM tests.rls_setup();

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
SELECT u.id, u.email, crypt('testpw', gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
       'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()
  FROM (VALUES
    ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'user_c@test.local'),
    ('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, 'user_d@test.local'),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, 'user_e@test.local')) u(id, email)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager', 'user_d', 'User D', true),
  ('11111111-1111-1111-1111-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user', 'user_e', 'User E', true)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET is_active = EXCLUDED.is_active, app_role = EXCLUDED.app_role;

CREATE FUNCTION public.t137_as(p_user uuid, p_role text, p_ws uuid DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_role))::text, true);
END;
$f$;
CREATE FUNCTION public.t137_err(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  s text;
BEGIN
  EXECUTE p_sql;
  RETURN 'no refusal';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS s = RETURNED_SQLSTATE;
  RETURN s;
END;
$f$;
-- A board's two names as the server makes them, and its generation.
CREATE FUNCTION public.t137_name(p_board uuid, p_live boolean) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $f$ SELECT public.board_topic(p_board, p_live) $f$;
CREATE FUNCTION public.t137_gen(p_board uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $f$ SELECT audience_gen FROM public.boards WHERE id = p_board $f$;
-- Whether the person may read a name, asked as them.
CREATE FUNCTION public.t137_reads(p_user uuid, p_role text, p_topic text) RETURNS boolean LANGUAGE plpgsql AS $f$
DECLARE
  v boolean;
BEGIN
  PERFORM public.t137_as(p_user, p_role);
  SET LOCAL ROLE authenticated;
  v := public.board_topic_readable(p_topic);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RETURN v;
END;
$f$;

-- realtime here or not: 'ok' where realtime.send lands a row, else not.
CREATE FUNCTION pg_temp.rt_env() RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  n BIGINT;
BEGIN
  IF to_regclass('realtime.messages') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'realtime' AND p.proname = 'send') THEN
    RETURN 'no-schema';
  END IF;
  PERFORM realtime.send('{"probe":true}'::jsonb, 'PGTAP-PROBE', 'moth:pgtap:137-partition-probe', true);
  EXECUTE 'SELECT count(*) FROM realtime.messages WHERE topic = ''moth:pgtap:137-partition-probe''' INTO n;
  RETURN CASE WHEN n = 0 THEN 'no-partition' ELSE 'ok' END;
END;
$$;
-- The messages on a topic, as 'EVENT/op' a message, sorted (one transaction's messages share their moment, so their
-- order is not theirs to keep), or 'nothing'; 'vacuous' without realtime.
CREATE FUNCTION pg_temp.heard(p_topic TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  s TEXT;
BEGIN
  IF pg_temp.rt_env() <> 'ok' THEN
    RETURN 'vacuous';
  END IF;
  EXECUTE 'SELECT COALESCE(string_agg(event || ''/'' || COALESCE(payload ->> ''op'', ''''), '' '' ORDER BY event, payload ->> ''op''), ''nothing'')
             FROM realtime.messages WHERE topic = $1' INTO s USING p_topic;
  RETURN s;
END;
$$;
CREATE FUNCTION pg_temp.payloads(p_topic TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  j JSONB;
BEGIN
  IF pg_temp.rt_env() <> 'ok' THEN
    RETURN NULL;
  END IF;
  EXECUTE 'SELECT COALESCE(jsonb_agg(payload ORDER BY payload ->> ''op'' DESC), ''[]'') FROM realtime.messages WHERE topic = $1' INTO j USING p_topic;
  RETURN j;
END;
$$;
CREATE FUNCTION pg_temp.want(p_want TEXT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT CASE WHEN pg_temp.rt_env() <> 'ok' THEN 'vacuous' ELSE p_want END
$$;
-- How many rows of a topic a person reads joined as that topic, and whether they may send on it (the policies).
CREATE FUNCTION pg_temp.joined_reads(p_user uuid, p_role text, p_topic TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  n BIGINT;
BEGIN
  IF pg_temp.rt_env() <> 'ok' THEN
    RETURN 'vacuous';
  END IF;
  PERFORM public.t137_as(p_user, p_role);
  SET LOCAL ROLE authenticated;
  PERFORM set_config('realtime.topic', p_topic, true);
  EXECUTE 'SELECT count(*) FROM realtime.messages WHERE topic = $1' INTO n USING p_topic;
  PERFORM set_config('realtime.topic', '', true);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RETURN CASE WHEN n > 0 THEN 'reads' ELSE 'reads nothing' END;
END;
$$;
CREATE FUNCTION pg_temp.joined_sends(p_user uuid, p_role text, p_topic TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v TEXT := 'sends';
BEGIN
  IF pg_temp.rt_env() <> 'ok' THEN
    RETURN 'vacuous';
  END IF;
  PERFORM public.t137_as(p_user, p_role);
  SET LOCAL ROLE authenticated;
  PERFORM set_config('realtime.topic', p_topic, true);
  BEGIN
    EXECUTE 'INSERT INTO realtime.messages (topic, extension, payload, event, private) VALUES ($1, ''broadcast'', ''{"x":1}'', ''cursor'', true)'
      USING p_topic;
  EXCEPTION WHEN insufficient_privilege THEN
    v := 'refused';
  END;
  PERFORM set_config('realtime.topic', '', true);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RETURN v;
END;
$$;

-- P shared with a board BP; X user_c's private project with BX; S user_e's personal space with BS.
SELECT public.t137_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin');
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1370-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Salt Hours', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1370-0000-0000-0000-0000000000e0', '11111111-1111-1111-1111-111111111111', 'Personal space', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
SELECT public.t137_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user');
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1370-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Private', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true, NULL);
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1370-0000-0000-0000-00000000000a', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT DO NOTHING;
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('13700000-0000-0000-0000-0000000000a0', 'aaaa1370-0000-0000-0000-00000000000a', NULL, 'root', 'salt-hours', ''),
  ('13700000-0000-0000-0000-0000000000a1', 'aaaa1370-0000-0000-0000-00000000000a', '13700000-0000-0000-0000-0000000000a0', 'custom', 'mood', 'mood'),
  ('13700000-0000-0000-0000-0000000000c0', 'aaaa1370-0000-0000-0000-00000000000c', NULL, 'root', 'private', ''),
  ('13700000-0000-0000-0000-0000000000c1', 'aaaa1370-0000-0000-0000-00000000000c', '13700000-0000-0000-0000-0000000000c0', 'custom', 'secret', 'secret'),
  ('13700000-0000-0000-0000-0000000000e0', 'aaaa1370-0000-0000-0000-0000000000e0', NULL, 'root', 'ps-e', ''),
  ('13700000-0000-0000-0000-0000000000e1', 'aaaa1370-0000-0000-0000-0000000000e0', '13700000-0000-0000-0000-0000000000e0', 'custom', 'pitch', 'pitch');
INSERT INTO public.boards (id, folder_id) VALUES
  ('13700000-0000-0000-0000-0000000000f1', '13700000-0000-0000-0000-0000000000a1'),
  ('13700000-0000-0000-0000-0000000000f2', '13700000-0000-0000-0000-0000000000c1'),
  ('13700000-0000-0000-0000-0000000000f3', '13700000-0000-0000-0000-0000000000e1');
INSERT INTO public.files (id, project_id, folder_id, name, mime_type, storage_provider, storage_path, tags, is_financial) VALUES
  ('13700000-0000-0000-0000-000000000081', 'aaaa1370-0000-0000-0000-00000000000a', '13700000-0000-0000-0000-0000000000a1', 'note.md', 'text/markdown', 'supabase', 'projects/aaaa1370-0000-0000-0000-00000000000a/files/13700000-0000-0000-0000-000000000081/note.md', '{}', false);
SELECT set_config('request.jwt.claims', '{}', true);

-- ── A. Structure ────────────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege('authenticated', 'public.board_topic(uuid,boolean,integer)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.board_topic_readable(text)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.board_topic_readable(text)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.board_channels(uuid)', 'EXECUTE'),
  'a board''s names are the server''s; a signed-in person asks only whether one is theirs');
SELECT is((SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
            ('trg_board_elements_broadcast_ins', 'trg_board_elements_broadcast_upd', 'trg_board_elements_broadcast_del',
             'trg_boards_audience_moved', 'trg_projects_board_epoch_moved', 'trg_workspace_members_board_audience')), 6,
  'the six triggers');
SELECT is(CASE WHEN to_regclass('realtime.messages') IS NULL THEN 'vacuous'
               ELSE (SELECT string_agg(policyname || ':' || cmd, ',' ORDER BY policyname) FROM pg_policies
                      WHERE schemaname = 'realtime' AND tablename = 'messages' AND policyname LIKE 'moth_board%') END,
          CASE WHEN to_regclass('realtime.messages') IS NULL THEN 'vacuous'
               ELSE 'moth_board_live_write:INSERT,moth_board_topic_read:SELECT' END,
  'two policies on the channels: a read of both, a send on the live one');
SELECT ok(to_regclass('realtime.messages') IS NULL
          OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages'
                          AND cmd IN ('INSERT', 'ALL') AND COALESCE(with_check, qual, '') ~ 'moth:board:'),
  'and none lets a client send on the database''s channel');

-- ── B. Names ────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t137_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user');
SELECT is(public.board_channels('13700000-0000-0000-0000-0000000000f1') ->> 'topic',
  'moth:board:13700000-0000-0000-0000-0000000000f1:0.0', 'a reader is given the board''s channel');
SELECT is(public.board_channels('13700000-0000-0000-0000-0000000000f1') ->> 'live_topic',
  'moth:board-live:13700000-0000-0000-0000-0000000000f1:0.0', 'and its live channel');
SELECT public.t137_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222');
SELECT is(public.t137_err($$SELECT public.board_channels('13700000-0000-0000-0000-0000000000f1')$$), '42501', 'another company is given nothing');
SELECT public.t137_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin');
SELECT is(public.t137_err($$SELECT public.board_channels('13700000-0000-0000-0000-0000000000f3')$$), '42501', 'nor an admin another person''s space''s');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
SELECT ok(public.t137_reads('dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager', 'moth:board:13700000-0000-0000-0000-0000000000f1:0.0'),
  'any active member reads a shared project''s board channel');
SELECT ok(public.t137_reads('dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager', 'moth:board-live:13700000-0000-0000-0000-0000000000f1:0.0'),
  'and its live channel');
SELECT ok(NOT public.t137_reads('dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager', 'moth:board:13700000-0000-0000-0000-0000000000f1:0.1'),
  'never at a generation that is not the board''s');
SELECT ok(NOT public.t137_reads('dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager', 'moth:board:13700000-0000-0000-0000-0000000000f1:1.0'),
  'nor at an epoch that is not the project''s');
SELECT ok(NOT public.t137_reads('dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager', 'moth:board:13700000-0000-0000-0000-0000000000f1:0.0:x'),
  'nor with anything after the name');
SELECT ok(NOT public.t137_reads('dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager', 'moth:boardx:13700000-0000-0000-0000-0000000000f1:0.0'),
  'nor in another shape');
SELECT ok(NOT public.t137_reads('dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager', 'moth:board:13700000-0000-0000-0000-0000000000f2:0.0'),
  'a private project''s board is not another member''s');
SELECT ok(public.t137_reads('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'moth:board:13700000-0000-0000-0000-0000000000f2:0.0'),
  'but its maker''s');
SELECT ok(NOT public.t137_reads('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin', 'moth:board:13700000-0000-0000-0000-0000000000f3:0.0'),
  'a personal space''s board is not an admin''s');
SELECT ok(public.t137_reads('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user', 'moth:board:13700000-0000-0000-0000-0000000000f3:0.0'),
  'but its owner''s');

-- ── C. The audience moves ───────────────────────────────────────────────────
-- A change that narrows nothing renames nothing.
UPDATE public.workspace_members SET display_name = 'User D again'
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
UPDATE public.workspace_members SET is_active = true
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
SELECT is(public.t137_gen('13700000-0000-0000-0000-0000000000f1'), 0, 'a new name or an unchanged standing renames nothing');
-- user_d changes role: every board of the company is renamed.
UPDATE public.workspace_members SET app_role = 'user'
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
SELECT is(public.t137_gen('13700000-0000-0000-0000-0000000000f1') || ',' || public.t137_gen('13700000-0000-0000-0000-0000000000f2')
          || ',' || public.t137_gen('13700000-0000-0000-0000-0000000000f3'), '1,1,1', 'a role change renames every board of the company');
SELECT is(pg_temp.heard('moth:board:13700000-0000-0000-0000-0000000000f1:0.0') || ' | ' || pg_temp.heard('moth:board-live:13700000-0000-0000-0000-0000000000f1:0.0'),
  pg_temp.want('AUDIENCE/audience | AUDIENCE/audience'), 'and both old names hear AUDIENCE');
SELECT ok(NOT public.t137_reads('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'moth:board:13700000-0000-0000-0000-0000000000f1:0.0')
          AND public.t137_reads('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'moth:board:13700000-0000-0000-0000-0000000000f1:0.1'),
  'the old name no longer reads; the new one does');
UPDATE public.workspace_members SET is_active = false
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
SELECT is(public.t137_gen('13700000-0000-0000-0000-0000000000f1'), 2, 'a member who leaves renames them');
SELECT ok(NOT public.t137_reads('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user', 'moth:board:13700000-0000-0000-0000-0000000000f1:0.2'),
  'and reads none of them, not even by the new name');
DELETE FROM public.workspace_members
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
SELECT is(public.t137_gen('13700000-0000-0000-0000-0000000000f1'), 3, 'a member removed renames them');
-- The board's folder goes to the trash: renamed, and no name reads.
SELECT public.t137_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user');
SET LOCAL ROLE authenticated;
SELECT ok((public.moth_trash_folders(ARRAY['13700000-0000-0000-0000-0000000000a1']::uuid[]) ->> 'batches') = '1', 'the board goes to the trash');
RESET ROLE;
SELECT is(public.t137_gen('13700000-0000-0000-0000-0000000000f1'), 4, 'which renames it');
SELECT ok(NOT public.t137_reads('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'moth:board:13700000-0000-0000-0000-0000000000f1:0.4'),
  'and a board in the trash has no readable name');
SELECT public.t137_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user');
SET LOCAL ROLE authenticated;
SELECT ok((public.moth_restore_folders(ARRAY['13700000-0000-0000-0000-0000000000a1']::uuid[]) ->> 'folders') = '1', 'it comes back');
RESET ROLE;
-- A privacy flip moves the project's epoch, and so the name.
UPDATE public.projects SET is_private = true WHERE id = 'aaaa1370-0000-0000-0000-00000000000a';
SELECT ok((SELECT topic_epoch FROM public.projects WHERE id = 'aaaa1370-0000-0000-0000-00000000000a') > 0
          AND public.t137_name('13700000-0000-0000-0000-0000000000f1', false) LIKE 'moth:board:13700000-0000-0000-0000-0000000000f1:%.4'
          AND public.t137_name('13700000-0000-0000-0000-0000000000f1', false) <> 'moth:board:13700000-0000-0000-0000-0000000000f1:0.4',
  'a privacy flip renames the board by its project''s epoch');
SELECT is(pg_temp.heard('moth:board:13700000-0000-0000-0000-0000000000f1:0.4'), pg_temp.want('AUDIENCE/audience'),
  'and its old name hears AUDIENCE');
UPDATE public.projects SET is_private = false WHERE id = 'aaaa1370-0000-0000-0000-00000000000a';
-- A project put in the trash narrows its boards' audience to nobody: renamed.
SELECT set_config('request.jwt.claims', '{}', true);
UPDATE public.projects SET deleted_at = now() WHERE id = 'aaaa1370-0000-0000-0000-0000000000e0';
SELECT is(public.t137_gen('13700000-0000-0000-0000-0000000000f3'), 4, 'a project in the trash renames its boards');
UPDATE public.projects SET deleted_at = NULL WHERE id = 'aaaa1370-0000-0000-0000-0000000000e0';

-- ── D. Messages ─────────────────────────────────────────────────────────────
SELECT public.t137_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user');
SET LOCAL ROLE authenticated;
SELECT ok((public.board_put_elements('13700000-0000-0000-0000-0000000000f1', jsonb_build_array(
    jsonb_build_object('id', '13700000-0000-0000-0000-000000000e01', 'kind', 'shape', 'shape', 'circle'),
    jsonb_build_object('id', '13700000-0000-0000-0000-000000000e02', 'kind', 'sticky', 'file_id', '13700000-0000-0000-0000-000000000081'),
    jsonb_build_object('id', '13700000-0000-0000-0000-000000000e03', 'kind', 'pen',
                       'points', (SELECT jsonb_agg(n) FROM generate_series(1, 2000) n)))) -> 'saved') IS NOT NULL,
  'a save of three elements');
RESET ROLE;
SELECT is(pg_temp.heard(public.t137_name('13700000-0000-0000-0000-0000000000f1', false)), pg_temp.want('elements/put'),
  'is one message on the board''s channel');
SELECT ok(pg_temp.rt_env() <> 'ok'
          OR (jsonb_array_length(pg_temp.payloads(public.t137_name('13700000-0000-0000-0000-0000000000f1', false)) -> 0 -> 'elements') = 3
              AND NOT (pg_temp.payloads(public.t137_name('13700000-0000-0000-0000-0000000000f1', false))::text ~ 'file_id|000000000081')
              AND (SELECT (e ->> 'has_file')::boolean FROM jsonb_array_elements(pg_temp.payloads(public.t137_name('13700000-0000-0000-0000-0000000000f1', false)) -> 0 -> 'elements') e
                    WHERE e ->> 'id' = '13700000-0000-0000-0000-000000000e02')
              AND (SELECT (e ->> 'points_omitted')::boolean FROM jsonb_array_elements(pg_temp.payloads(public.t137_name('13700000-0000-0000-0000-0000000000f1', false)) -> 0 -> 'elements') e
                    WHERE e ->> 'id' = '13700000-0000-0000-0000-000000000e03')),
  'with the three elements, no file''s id, a sticky marked as holding one, a long pen''s points left out');
SELECT public.t137_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user');
SET LOCAL ROLE authenticated;
SELECT ok((public.board_delete_elements('13700000-0000-0000-0000-0000000000f1', ARRAY['13700000-0000-0000-0000-000000000e01', '13700000-0000-0000-0000-000000000e03']::uuid[]) -> 'removed') IS NOT NULL,
  'a removal of two');
RESET ROLE;
SELECT is(pg_temp.heard(public.t137_name('13700000-0000-0000-0000-0000000000f1', false)), pg_temp.want('elements/put elements/remove'),
  'is one message more');
SELECT is(pg_temp.joined_reads('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', public.t137_name('13700000-0000-0000-0000-0000000000f1', false)),
  pg_temp.want('reads'), 'a reader joined to the board''s channel reads it');
SELECT is(pg_temp.joined_reads('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', public.t137_name('13700000-0000-0000-0000-0000000000f1', false)),
  pg_temp.want('reads nothing'), 'someone the board is not for, joined to the same name, reads nothing of it');
SELECT is(pg_temp.joined_sends('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', public.t137_name('13700000-0000-0000-0000-0000000000f1', false)),
  pg_temp.want('refused'), 'and never sends on it');
SELECT is(pg_temp.joined_sends('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', public.t137_name('13700000-0000-0000-0000-0000000000f1', true)),
  pg_temp.want('sends'), 'but sends a cursor on the live one');
SELECT is(pg_temp.joined_sends('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user', public.t137_name('13700000-0000-0000-0000-0000000000f2', true)),
  pg_temp.want('refused'), 'someone who cannot read a board sends nothing on its live channel');

SELECT * FROM finish();
ROLLBACK;
