-- =============================================================================
-- 138_sticky_locks.sql — M.O.T.H. Session 4 (MO4): a sticky's soft lock and the one path to its words (0133).
--
-- A. Structure: forced row security, no policy, no client grant on the table or its numbers; the functions' grants;
--    rekey_file_body is 0133's.
-- B. The turn: the first writer gets it with a number; anyone else is told who holds it; the holder's own window
--    renews it; another window of the same person waits too; a reviewer, another company and someone who cannot see
--    the board get nothing; the turns on a board, for a reader.
-- C. Ending: a turn runs out by the database clock and the next claim gets a new number; renewing an ended or a
--    wrong number says false; a release is the holder's own.
-- D. Saving words: only the holder of the current turn, only over the key it read, only to a key the server admits
--    for the file's own project; an ended turn and an old number are refused in words, so a writer whose turn passed
--    never overwrites the next one's words. rekey_file_body refuses a sticky's file.
-- E. On a stack with realtime: a claim says 'lock', a save 'body', a release 'unlock' on the board's channel.
-- =============================================================================

BEGIN;
SELECT plan(41);

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
    ('99999999-9999-9999-9999-999999999999'::uuid, 'user_r@test.local')) u(id, email)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'user', 'user_d', 'User D', true),
  ('11111111-1111-1111-1111-111111111111', '99999999-9999-9999-9999-999999999999', 'user', 'user_r', 'User R', true)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET is_active = EXCLUDED.is_active, app_role = EXCLUDED.app_role;

CREATE FUNCTION public.t138_as(p_user uuid, p_role text, p_ws uuid DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_role))::text, true);
END;
$f$;
CREATE FUNCTION public.t138_c() RETURNS void LANGUAGE sql AS $f$ SELECT public.t138_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user') $f$;
CREATE FUNCTION public.t138_d() RETURNS void LANGUAGE sql AS $f$ SELECT public.t138_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user') $f$;
CREATE FUNCTION public.t138_r() RETURNS void LANGUAGE sql AS $f$ SELECT public.t138_as('99999999-9999-9999-9999-999999999999', 'user') $f$;
CREATE FUNCTION public.t138_err(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
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
CREATE FUNCTION public.t138_words(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'no refusal';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$f$;
-- The turn's row and the file's key, as the database sees them.
CREATE FUNCTION public.t138_lock() RETURNS public.sticky_locks LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT * FROM public.sticky_locks WHERE element_id = '13800000-0000-0000-0000-000000000e01'
$f$;
CREATE FUNCTION public.t138_key() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT storage_path FROM public.files WHERE id = '13800000-0000-0000-0000-000000000081'
$f$;
GRANT EXECUTE ON FUNCTION public.t138_lock() TO authenticated;
GRANT EXECUTE ON FUNCTION public.t138_key() TO authenticated;
-- The turn passes its end, as the database's clock would make it.
CREATE FUNCTION public.t138_age() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$
  UPDATE public.sticky_locks SET claimed_at = claimed_at - interval '1 minute', expires_at = clock_timestamp() - interval '1 second'
   WHERE element_id = '13800000-0000-0000-0000-000000000e01'
$f$;
CREATE FUNCTION pg_temp.heard(p_topic TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  s TEXT;
BEGIN
  IF to_regclass('realtime.messages') IS NULL OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
       WHERE ns.nspname = 'realtime' AND p.proname = 'send') THEN
    RETURN 'vacuous';
  END IF;
  EXECUTE 'SELECT COALESCE(string_agg(payload ->> ''op'', '' '' ORDER BY inserted_at, id), ''nothing'')
             FROM realtime.messages WHERE topic = $1 AND event = ''sticky''' INTO s USING p_topic;
  RETURN s;
END;
$$;
CREATE FUNCTION pg_temp.want(p_want TEXT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT CASE WHEN to_regclass('realtime.messages') IS NULL OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
       WHERE ns.nspname = 'realtime' AND p.proname = 'send') THEN 'vacuous' ELSE p_want END
$$;

-- Whether a topic's messages carry a sticky's key or its file's id (false without realtime).
CREATE FUNCTION pg_temp.leaks(p_topic TEXT) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  v BOOLEAN;
BEGIN
  IF pg_temp.want('x') = 'vacuous' THEN
    RETURN false;
  END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM realtime.messages WHERE topic = $1 AND payload::text ~ ''v[0-9]-note|000000000081'')'
    INTO v USING p_topic;
  RETURN v;
END;
$$;

-- P with a board BP and a sticky on it; user_c and user_d its members, user_r a reviewer.
SELECT public.t138_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin');
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1380-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Salt Hours', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL);
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1380-0000-0000-0000-00000000000a', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1380-0000-0000-0000-00000000000a', 'dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1380-0000-0000-0000-00000000000a', '99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'reviewer')
ON CONFLICT DO NOTHING;
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('13800000-0000-0000-0000-0000000000a0', 'aaaa1380-0000-0000-0000-00000000000a', NULL, 'root', 'salt-hours', ''),
  ('13800000-0000-0000-0000-0000000000a1', 'aaaa1380-0000-0000-0000-00000000000a', '13800000-0000-0000-0000-0000000000a0', 'custom', 'mood', 'mood');
INSERT INTO public.boards (id, folder_id) VALUES ('13800000-0000-0000-0000-0000000000f1', '13800000-0000-0000-0000-0000000000a1');
INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES
  ('rabbit-files', 'projects/aaaa1380-0000-0000-0000-00000000000a/files/13800000-0000-0000-0000-000000000081/v1-note.md', 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('rabbit-files', 'projects/aaaa1380-0000-0000-0000-00000000000a/files/13800000-0000-0000-0000-000000000081/v2-note.md', 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('rabbit-files', 'projects/aaaa1380-0000-0000-0000-00000000000a/files/13800000-0000-0000-0000-000000000081/v3-note.md', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
INSERT INTO public.files (id, project_id, folder_id, name, mime_type, storage_provider, storage_path, tags, is_financial) VALUES
  ('13800000-0000-0000-0000-000000000081', 'aaaa1380-0000-0000-0000-00000000000a', '13800000-0000-0000-0000-0000000000a1', 'note.md', 'text/markdown', 'supabase',
   'projects/aaaa1380-0000-0000-0000-00000000000a/files/13800000-0000-0000-0000-000000000081/v1-note.md', '{}', false);
INSERT INTO public.board_elements (id, board_id, kind, file_id) VALUES
  ('13800000-0000-0000-0000-000000000e01', '13800000-0000-0000-0000-0000000000f1', 'sticky', '13800000-0000-0000-0000-000000000081');
SELECT set_config('request.jwt.claims', '{}', true);

-- ── A. Structure ────────────────────────────────────────────────────────────
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.sticky_locks'::regclass),
  'sticky_locks: row security forced');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE tablename = 'sticky_locks'), 0, 'and no policy at all');
SELECT ok(NOT has_table_privilege('authenticated', 'public.sticky_locks', 'SELECT')
          AND NOT has_table_privilege('authenticated', 'public.sticky_locks', 'INSERT')
          AND NOT has_table_privilege('anon', 'public.sticky_locks', 'SELECT')
          AND NOT has_sequence_privilege('authenticated', 'public.sticky_lock_generation_seq', 'USAGE'),
  'no client reads or writes a turn, or draws a number');
SELECT ok(has_function_privilege('authenticated', 'public.sticky_claim(uuid,text)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.sticky_renew(uuid,bigint)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.sticky_release(uuid,bigint)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.sticky_status(uuid)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.board_sticky_publish(uuid,bigint,text,text)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.board_sticky_publish(uuid,bigint,text,text)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'rabbit_private.sticky_for(uuid)', 'EXECUTE'),
  'the five are a signed-in person''s; the helper nobody''s');
SELECT ok((SELECT prosrc FROM pg_proc WHERE oid = 'public.rekey_file_body(uuid,text,text,text,text,boolean)'::regprocedure)
          ~ 'A sticky''''s words are saved from its board', 'rekey_file_body carries the sticky''s refusal');

-- ── B. The turn ─────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t138_c();
SELECT is((public.sticky_claim('13800000-0000-0000-0000-000000000e01', 'tab-c-one-0001') ->> 'granted'), 'true', 'the first writer gets the turn');
SELECT ok((public.t138_lock()).generation > 0 AND (public.t138_lock()).holder = 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'with a number, as theirs');
SELECT public.t138_d();
SELECT is((public.sticky_claim('13800000-0000-0000-0000-000000000e01', 'tab-d-one-0001') - 'ends_in_ms')::text,
  '{"granted": false, "holder_label": "User C"}', 'someone else is told whose it is, for the name and the glow');
SELECT public.t138_c();
SELECT is((public.sticky_claim('13800000-0000-0000-0000-000000000e01', 'tab-c-one-0001') ->> 'generation')::bigint, (public.t138_lock()).generation,
  'the holder''s own window renews it, same number');
SELECT is((public.sticky_claim('13800000-0000-0000-0000-000000000e01', 'tab-c-two-0002') ->> 'granted'), 'false',
  'another window of the same person waits too');
SELECT is(public.t138_err($$SELECT public.sticky_claim('13800000-0000-0000-0000-000000000e01', 'bad')$$), '22023', 'a window''s name has its shape');
SELECT public.t138_r();
SELECT is(public.t138_err($$SELECT public.sticky_claim('13800000-0000-0000-0000-000000000e01', 'tab-r-one-0001')$$), '42501', 'a reviewer gets no turn');
SELECT is((public.sticky_status('13800000-0000-0000-0000-0000000000f1') -> 0 ->> 'holder_label') || ':' || (public.sticky_status('13800000-0000-0000-0000-0000000000f1') -> 0 ->> 'mine'),
  'User C:false', 'but sees whose turn it is');
SELECT public.t138_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222');
SELECT is(public.t138_err($$SELECT public.sticky_claim('13800000-0000-0000-0000-000000000e01', 'tab-b-one-0001')$$), '42501', 'another company gets none');
SELECT is(public.t138_err($$SELECT public.sticky_status('13800000-0000-0000-0000-0000000000f1')$$), '42501', 'and sees none');
SELECT is(public.t138_err($$SELECT * FROM public.sticky_locks$$), '42501', 'nobody reads the table');

-- ── D (first). Saving words ─────────────────────────────────────────────────
SELECT public.t138_c();
SELECT ok(public.board_sticky_publish('13800000-0000-0000-0000-000000000e01', (public.t138_lock()).generation,
          'projects/aaaa1380-0000-0000-0000-00000000000a/files/13800000-0000-0000-0000-000000000081/v1-note.md',
          'projects/aaaa1380-0000-0000-0000-00000000000a/files/13800000-0000-0000-0000-000000000081/v2-note.md'),
  'the holder saves the sticky''s words to a fresh key');
SELECT is(public.t138_key(), 'projects/aaaa1380-0000-0000-0000-00000000000a/files/13800000-0000-0000-0000-000000000081/v2-note.md',
  'and the file reads them there');
SELECT ok(NOT public.board_sticky_publish('13800000-0000-0000-0000-000000000e01', (public.t138_lock()).generation,
          'projects/aaaa1380-0000-0000-0000-00000000000a/files/13800000-0000-0000-0000-000000000081/v1-note.md',
          'projects/aaaa1380-0000-0000-0000-00000000000a/files/13800000-0000-0000-0000-000000000081/v3-note.md'),
  'a save over a key that is no longer the file''s says false');
SELECT is(public.t138_words($$SELECT public.board_sticky_publish('13800000-0000-0000-0000-000000000e01', (public.t138_lock()).generation,
          'projects/aaaa1380-0000-0000-0000-00000000000a/files/13800000-0000-0000-0000-000000000081/v2-note.md',
          'projects/aaaa1380-0000-0000-0000-00000000000a/files/13800000-0000-0000-0000-000000000081/v9-note.md')$$),
  'That is not a place this sticky''s words can be kept.', 'a key with nothing stored there is refused');
SELECT is(public.t138_words($$SELECT public.board_sticky_publish('13800000-0000-0000-0000-000000000e01', (public.t138_lock()).generation,
          'projects/aaaa1380-0000-0000-0000-00000000000a/files/13800000-0000-0000-0000-000000000081/v2-note.md',
          'projects/aaaa1380-0000-0000-0000-00000000000b/files/13800000-0000-0000-0000-000000000081/v3-note.md')$$),
  'That is not a place this sticky''s words can be kept.', 'and a key of another project');
SELECT public.t138_d();
SELECT is(public.t138_words($$SELECT public.board_sticky_publish('13800000-0000-0000-0000-000000000e01', (public.t138_lock()).generation,
          'projects/aaaa1380-0000-0000-0000-00000000000a/files/13800000-0000-0000-0000-000000000081/v2-note.md',
          'projects/aaaa1380-0000-0000-0000-00000000000a/files/13800000-0000-0000-0000-000000000081/v3-note.md')$$),
  'sticky_turn_ended', 'someone who does not hold the turn saves nothing, even with its number');
SELECT is(public.t138_words($$SELECT public.rekey_file_body('13800000-0000-0000-0000-000000000081',
          'projects/aaaa1380-0000-0000-0000-00000000000a/files/13800000-0000-0000-0000-000000000081/v2-note.md',
          'projects/aaaa1380-0000-0000-0000-00000000000a/files/13800000-0000-0000-0000-000000000081/v3-note.md', NULL, NULL)$$),
  'A sticky''s words are saved from its board.', 'nor through rekey_file_body');
SELECT is(public.t138_key(), 'projects/aaaa1380-0000-0000-0000-00000000000a/files/13800000-0000-0000-0000-000000000081/v2-note.md',
  'the words stay the holder''s');

-- ── C. Ending ───────────────────────────────────────────────────────────────
SELECT public.t138_c();
CREATE TEMP TABLE t138_gen AS SELECT (public.t138_lock()).generation AS g;
SELECT is((public.sticky_renew('13800000-0000-0000-0000-000000000e01', (SELECT g FROM t138_gen)) ->> 'ok'), 'true', 'the holder renews while typing');
SELECT is((public.sticky_renew('13800000-0000-0000-0000-000000000e01', (SELECT g FROM t138_gen) + 1) ->> 'ok'), 'false', 'never under another number');
SELECT public.t138_d();
SELECT is((public.sticky_renew('13800000-0000-0000-0000-000000000e01', (SELECT g FROM t138_gen)) ->> 'ok'), 'false', 'nor someone else, with the number');
SELECT ok(NOT public.sticky_release('13800000-0000-0000-0000-000000000e01', (SELECT g FROM t138_gen)), 'nor lets it go for them');
-- user_c's window closes without a word: the turn runs out by the clock.
SELECT public.t138_age();
SELECT is((public.sticky_status('13800000-0000-0000-0000-0000000000f1'))::text, '[]', 'an ended turn is nobody''s');
SELECT is((public.sticky_claim('13800000-0000-0000-0000-000000000e01', 'tab-d-one-0001') ->> 'granted'), 'true', 'the next writer gets it');
SELECT ok((public.t138_lock()).generation > (SELECT g FROM t138_gen), 'with a new, larger number');
SELECT public.t138_c();
SELECT is((public.sticky_renew('13800000-0000-0000-0000-000000000e01', (SELECT g FROM t138_gen)) ->> 'ok'), 'false', 'the old holder cannot renew it back');
SELECT is(public.t138_words($$SELECT public.board_sticky_publish('13800000-0000-0000-0000-000000000e01', (SELECT g FROM t138_gen),
          'projects/aaaa1380-0000-0000-0000-00000000000a/files/13800000-0000-0000-0000-000000000081/v2-note.md',
          'projects/aaaa1380-0000-0000-0000-00000000000a/files/13800000-0000-0000-0000-000000000081/v3-note.md')$$),
  'sticky_turn_ended', 'nor save over the new writer''s words with the old number');
SELECT public.t138_d();
SELECT ok(public.board_sticky_publish('13800000-0000-0000-0000-000000000e01', (public.t138_lock()).generation,
          'projects/aaaa1380-0000-0000-0000-00000000000a/files/13800000-0000-0000-0000-000000000081/v2-note.md',
          'projects/aaaa1380-0000-0000-0000-00000000000a/files/13800000-0000-0000-0000-000000000081/v3-note.md'),
  'the new holder saves');
SELECT public.t138_age();
SELECT is(public.t138_words($$SELECT public.board_sticky_publish('13800000-0000-0000-0000-000000000e01', (public.t138_lock()).generation,
          'projects/aaaa1380-0000-0000-0000-00000000000a/files/13800000-0000-0000-0000-000000000081/v3-note.md',
          'projects/aaaa1380-0000-0000-0000-00000000000a/files/13800000-0000-0000-0000-000000000081/v2-note.md')$$),
  'sticky_turn_ended', 'a turn that ran out saves nothing, even its own holder''s');
SELECT is((public.sticky_claim('13800000-0000-0000-0000-000000000e01', 'tab-d-one-0001') ->> 'granted'), 'true', 'its holder claims again');
SELECT ok(public.sticky_release('13800000-0000-0000-0000-000000000e01', (public.t138_lock()).generation), 'and lets it go on blur');
SELECT ok((public.t138_lock()).element_id IS NULL, 'the turn is gone');

-- ── E. Messages ─────────────────────────────────────────────────────────────
RESET ROLE;
SELECT is(pg_temp.heard('moth:board:13800000-0000-0000-0000-0000000000f1:0.0'), pg_temp.want('lock body lock body lock unlock'),
  'each claim, save and release was said on the board''s channel');
SELECT ok(NOT pg_temp.leaks('moth:board:13800000-0000-0000-0000-0000000000f1:0.0'),
  'and never with a key or a file''s id');
SELECT ok((SELECT count(*) FROM public.files WHERE id = '13800000-0000-0000-0000-000000000081') = 1, 'the sticky''s file is still one file');

SELECT * FROM finish();
ROLLBACK;
