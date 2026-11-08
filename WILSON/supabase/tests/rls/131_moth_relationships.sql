-- =============================================================================
-- 131_moth_relationships.sql — M.O.T.H. Session 3 (MO3): links between things (0127).
--
-- A. Structure: forced row security, four policies each asking Moth's gate, the client's columns, the nine text
--    triggers, no channel.
-- B. A hand-drawn link: from a thing the person may change to a thing they see; a reviewer draws none; money, a
--    private project not theirs, a missing thing: refused alike; never to itself; never a typed one from a client.
-- C. Seeing a link: both ends seen, through the gate; an admin sees a private project's; someone who has left and
--    another company see none.
-- D. Changing and removing a hand-drawn link: its words, by those who may change where it starts; never its ends.
-- E. A typed link in R.A.B.B.I.T. text: a key reserved for a thing the writer sees becomes a link of the field that
--    first saves it, and that field's alone: copied elsewhere it links nothing, and an undo brings its link back; a
--    key of someone else's, or past its day, links nothing; the words' removal removes the link and leaves a
--    hand-drawn one; a writer who cannot see a key's thing keeps its link.
-- F. A note's typed links, from the keys its editor sends with the version they were read from; a personal note's
--    links are its owner's alone.
-- G. The reads: the graph's, a thing's links and "Mentioned in", and the picker's, each showing only what the caller
--    sees, and never starved of it by what they cannot see.
-- H. A link goes with either end.
-- =============================================================================

BEGIN;
SELECT plan(64);

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
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, 'user_e@test.local'),
    ('99999999-9999-9999-9999-999999999999'::uuid, 'user_r@test.local'),
    ('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, 'user_n@test.local')) u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager', 'user_d', 'User D', true),
  ('11111111-1111-1111-1111-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user', 'user_e', 'User E', true),
  ('11111111-1111-1111-1111-111111111111', '99999999-9999-9999-9999-999999999999', 'user', 'user_r', 'User R', true),
  ('11111111-1111-1111-1111-111111111111', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'user', 'user_n', 'User N', true)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET is_active = EXCLUDED.is_active, app_role = EXCLUDED.app_role;

-- Who the suite asks as: the claims carry the company and the role, as a signed-in person's token does.
CREATE FUNCTION public.t131_as(p_user uuid, p_role text, p_ws uuid DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_role))::text, true);
END;
$f$;
CREATE FUNCTION public.t131_a() RETURNS void LANGUAGE sql AS $f$ SELECT public.t131_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin') $f$;
CREATE FUNCTION public.t131_b() RETURNS void LANGUAGE sql AS $f$ SELECT public.t131_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222') $f$;
CREATE FUNCTION public.t131_c() RETURNS void LANGUAGE sql AS $f$ SELECT public.t131_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user') $f$;
CREATE FUNCTION public.t131_d() RETURNS void LANGUAGE sql AS $f$ SELECT public.t131_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager') $f$;
CREATE FUNCTION public.t131_e() RETURNS void LANGUAGE sql AS $f$ SELECT public.t131_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user') $f$;
CREATE FUNCTION public.t131_r() RETURNS void LANGUAGE sql AS $f$ SELECT public.t131_as('99999999-9999-9999-9999-999999999999', 'user') $f$;
CREATE FUNCTION public.t131_n() RETURNS void LANGUAGE sql AS $f$ SELECT public.t131_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'user') $f$;
-- The SQLSTATE a statement is refused with, or 'no refusal'.
CREATE FUNCTION public.t131_err(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
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
-- The words a statement is refused with, or 'no refusal'.
CREATE FUNCTION public.t131_words(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'no refusal';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$f$;

-- A tag's id by its label and owner (NULL for the company's), as the database sees it.
CREATE FUNCTION public.t131_tag(p_label text, p_owner uuid DEFAULT NULL) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $f$
  SELECT id FROM public.moth_tags WHERE label = p_label AND owner_id IS NOT DISTINCT FROM p_owner ORDER BY created_at, id LIMIT 1
$f$;
GRANT EXECUTE ON FUNCTION public.t131_tag(text, uuid) TO authenticated;

-- P and Q shared, X user_c's private project, S user_e's personal space; each with a few things.
SELECT public.t131_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1310-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Salt Hours', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1310-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Second', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL);
SELECT public.t131_c();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1310-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Private', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true, NULL);
SELECT public.t131_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1310-0000-0000-0000-0000000000e0', '11111111-1111-1111-1111-111111111111', 'Personal space', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1310-0000-0000-0000-00000000000a', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1310-0000-0000-0000-00000000000a', '99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'reviewer')
ON CONFLICT DO NOTHING;
INSERT INTO public.assets (id, project_id, name) VALUES
  ('13100000-0000-0000-0000-000000000051', 'aaaa1310-0000-0000-0000-00000000000a', 'Mira'),
  ('13100000-0000-0000-0000-000000000052', 'aaaa1310-0000-0000-0000-00000000000b', 'Elsewhere'),
  ('13100000-0000-0000-0000-0000000000e1', 'aaaa1310-0000-0000-0000-0000000000e0', 'Pitch');
INSERT INTO public.tasks (id, project_id, title) VALUES
  ('13100000-0000-0000-0000-000000000061', 'aaaa1310-0000-0000-0000-00000000000a', 'Grade the harbour');
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial) VALUES
  ('13100000-0000-0000-0000-000000000081', 'aaaa1310-0000-0000-0000-00000000000a', 'mira.png', 'supabase', 'projects/aaaa1310-0000-0000-0000-00000000000a/files/13100000-0000-0000-0000-000000000081/mira.png', false),
  ('13100000-0000-0000-0000-000000000082', 'aaaa1310-0000-0000-0000-00000000000a', 'fee.pdf', 'supabase', 'projects/aaaa1310-0000-0000-0000-00000000000a/files/13100000-0000-0000-0000-000000000082/fee.pdf', true),
  ('13100000-0000-0000-0000-0000000000e2', 'aaaa1310-0000-0000-0000-0000000000e0', 'pitch.png', 'supabase', 'projects/aaaa1310-0000-0000-0000-0000000000e0/files/13100000-0000-0000-0000-0000000000e2/pitch.png', false);
SELECT public.t131_c();
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial) VALUES
  ('13100000-0000-0000-0000-0000000000c1', 'aaaa1310-0000-0000-0000-00000000000c', 'secret.png', 'supabase', 'projects/aaaa1310-0000-0000-0000-00000000000c/files/13100000-0000-0000-0000-0000000000c1/secret.png', false);
-- user_n leaves once everything is made.
UPDATE public.workspace_members SET is_active = false
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO public.notes (id, workspace_id, owner_id, title, tier) VALUES
  ('13100000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Lighting the harbour', 'shared'),
  ('13100000-0000-0000-0000-0000000000b2', '11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Grade, my own notes', 'personal');
-- The relationships a caller sees, as source:target, sorted.
CREATE FUNCTION public.t131_seen() RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT COALESCE(string_agg(right(source_id::text, 3) || '>' || right(dest_id::text, 3) || ':' || origin, ',' ORDER BY source_id, dest_id, origin), '')
    FROM public.moth_relationships
$f$;
-- Every link as the database holds it, the same way.
CREATE FUNCTION public.t131_all() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT COALESCE(string_agg(right(source_id::text, 3) || '>' || right(dest_id::text, 3) || ':' || origin || COALESCE(':' || field, ''), ','
                             ORDER BY source_id, dest_id, origin, field), '')
    FROM public.moth_relationships
$f$;

-- ── A. Structure ────────────────────────────────────────────────────────────
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.moth_relationships'::regclass), 'row security is forced');
SELECT is((SELECT string_agg(policyname || ':' || cmd, ',' ORDER BY policyname) FROM pg_policies WHERE tablename = 'moth_relationships'),
  'moth_relationships_delete:DELETE,moth_relationships_insert:INSERT,moth_relationships_select:SELECT,moth_relationships_update:UPDATE', 'four policies');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE tablename = 'moth_relationships'
            AND COALESCE(qual, '') || COALESCE(with_check, '') ~ 'moth_can_(read|write)_target'), 4, 'each asks Moth''s gate');
SELECT is((SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.column_privileges
            WHERE table_schema = 'public' AND table_name = 'moth_relationships' AND grantee = 'authenticated' AND privilege_type = 'INSERT'),
  'dest_id,dest_type,label,source_id,source_type', 'a client sends two ends and words; never how a link came, nor a key');
SELECT is((SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.column_privileges
            WHERE table_schema = 'public' AND table_name = 'moth_relationships' AND grantee = 'authenticated' AND privilege_type = 'UPDATE'),
  'label', 'and changes its words alone');
SELECT is((SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
            WHERE t.tgfoid = 'public.fn_moth_text_mentions()'::regprocedure),
  'assets,experiences,files,levels,phases,projects,scenes,shots,tasks', 'a typed link follows the words of nine kinds of thing');
SELECT ok(NOT has_table_privilege('anon', 'public.moth_relationships', 'SELECT')
          AND NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                           WHERE t.tgrelid = 'public.moth_relationships'::regclass AND p.proname LIKE '%broadcast%'),
  'nothing for anon, and on no realtime topic');

-- ── B. A hand-drawn link ────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t131_c();
SELECT lives_ok($$INSERT INTO public.moth_relationships (source_type, source_id, dest_type, dest_id, label)
                  VALUES ('asset', '13100000-0000-0000-0000-000000000051', 'task', '13100000-0000-0000-0000-000000000061', 'appears in')$$,
  'a member who may change P links P''s asset to its task, with words on the line');
SELECT is(public.t131_err($$INSERT INTO public.moth_relationships (source_type, source_id, dest_type, dest_id)
                  VALUES ('asset', '13100000-0000-0000-0000-000000000051', 'task', '13100000-0000-0000-0000-000000000061')$$),
  '23505', 'once a way');
SELECT is(public.t131_words($$INSERT INTO public.moth_relationships (source_type, source_id, dest_type, dest_id)
                  VALUES ('asset', '13100000-0000-0000-0000-000000000051', 'file', '13100000-0000-0000-0000-000000000082')$$),
  'new row violates row-level security policy for table "moth_relationships"', 'never to a money file');
SELECT is(public.t131_words($$INSERT INTO public.moth_relationships (source_type, source_id, dest_type, dest_id)
                  VALUES ('asset', '13100000-0000-0000-0000-000000000051', 'file', '13100000-0000-0000-0000-00000000dead')$$),
  'new row violates row-level security policy for table "moth_relationships"', 'refused as a thing that is not there is');
SELECT lives_ok($$INSERT INTO public.moth_relationships (source_type, source_id, dest_type, dest_id)
                  VALUES ('asset', '13100000-0000-0000-0000-000000000051', 'file', '13100000-0000-0000-0000-0000000000c1')$$,
  'the creator of a private project links into it');
SELECT is(public.t131_err($$INSERT INTO public.moth_relationships (source_type, source_id, dest_type, dest_id)
                  VALUES ('task', '13100000-0000-0000-0000-000000000061', 'task', '13100000-0000-0000-0000-000000000061')$$),
  '23514', 'never to itself');
SELECT is(public.t131_err($$INSERT INTO public.moth_relationships (source_type, source_id, dest_type, dest_id, origin)
                  VALUES ('task', '13100000-0000-0000-0000-000000000061', 'asset', '13100000-0000-0000-0000-000000000051', 'inline')$$),
  '42501', 'and no client makes a typed one: only the words do');
SELECT public.t131_r();
SELECT is(public.t131_err($$INSERT INTO public.moth_relationships (source_type, source_id, dest_type, dest_id)
                  VALUES ('task', '13100000-0000-0000-0000-000000000061', 'asset', '13100000-0000-0000-0000-000000000051')$$),
  '42501', 'a reviewer draws no link: they may not change P');
SELECT public.t131_d();
SELECT is(public.t131_err($$INSERT INTO public.moth_relationships (source_type, source_id, dest_type, dest_id)
                  VALUES ('task', '13100000-0000-0000-0000-000000000061', 'file', '13100000-0000-0000-0000-0000000000c1')$$),
  '42501', 'a manager links nothing into someone''s private project');

-- ── C. Seeing a link ────────────────────────────────────────────────────────
SELECT is(public.t131_seen(), '051>061:manual', 'a manager sees the link between two things of P, and not the one into the private project');
SELECT public.t131_a();
SELECT is(public.t131_seen(), '051>061:manual,051>0c1:manual', 'an admin sees both: admins see private projects');
SELECT public.t131_n();
SELECT is(public.t131_seen(), '', 'someone who has left sees none');
SELECT public.t131_b();
SELECT is(public.t131_seen(), '', 'nor does another company');

-- ── D. Changing and removing a hand-drawn link ──────────────────────────────
SELECT public.t131_c();
WITH u AS (UPDATE public.moth_relationships SET label = 'stars in' WHERE dest_id = '13100000-0000-0000-0000-000000000061' RETURNING 1)
SELECT is(count(*)::int, 1, 'its words change, by those who may change where it starts') FROM u;
SELECT is(public.t131_err($$UPDATE public.moth_relationships SET dest_id = '13100000-0000-0000-0000-000000000051' WHERE dest_id = '13100000-0000-0000-0000-000000000061'$$),
  '42501', 'never its ends');
SELECT public.t131_r();
WITH u AS (UPDATE public.moth_relationships SET label = 'by R' RETURNING 1)
SELECT is(count(*)::int, 0, 'a reviewer changes none') FROM u;
WITH d AS (DELETE FROM public.moth_relationships RETURNING 1)
SELECT is(count(*)::int, 0, 'nor removes one') FROM d;
SELECT public.t131_c();
WITH d AS (DELETE FROM public.moth_relationships WHERE dest_id = '13100000-0000-0000-0000-0000000000c1' RETURNING 1)
SELECT is(count(*)::int, 1, 'its maker removes the one into the private project') FROM d;

-- ── E. A typed link in R.A.B.B.I.T. text ────────────────────────────────────
SELECT set_config('t131.k1', public.moth_mention_reserve('task', '13100000-0000-0000-0000-000000000061'), true);
SELECT ok(current_setting('t131.k1') ~ '^[0-9a-f]{12}$', 'picking a thing reserves an opaque key for it');
UPDATE public.assets SET description = 'See [[Grade it|m:' || current_setting('t131.k1') || ']] soon.' WHERE id = '13100000-0000-0000-0000-000000000051';
SELECT is(public.t131_all(), '051>061:inline:description,051>061:manual',
  'saving the words with the key makes a typed link of that field, beside the hand-drawn one');
SELECT is(public.t131_seen(), '051>061:inline,051>061:manual', 'which the writer sees');
UPDATE public.files SET description = 'Copied [[Grade it|m:' || current_setting('t131.k1') || ']] here.' WHERE id = '13100000-0000-0000-0000-000000000081';
SELECT is(public.t131_all(), '051>061:inline:description,051>061:manual',
  'a key is the field''s that first saved it: copied into another thing''s words, it links nothing');
UPDATE public.files SET description = NULL WHERE id = '13100000-0000-0000-0000-000000000081';
SELECT public.t131_r();
SELECT set_config('t131.k2', public.moth_mention_reserve('asset', '13100000-0000-0000-0000-000000000051'), true);
SELECT public.t131_c();
UPDATE public.tasks SET description = 'With [[Mira|m:' || current_setting('t131.k2') || ']] in it.' WHERE id = '13100000-0000-0000-0000-000000000061';
SELECT is(public.t131_all(), '051>061:inline:description,051>061:manual', 'nor does a key someone else reserved');
SELECT public.t131_d();
SELECT throws_ok($$SELECT public.moth_mention_reserve('file', '13100000-0000-0000-0000-0000000000c1')$$,
  '42501', 'That is not something you can link to.', 'no one reserves a key for a thing they cannot see');
SELECT throws_ok($$SELECT public.moth_mention_reserve('file', '13100000-0000-0000-0000-00000000dead')$$,
  '42501', 'That is not something you can link to.', 'in the words of a thing that is not there');
SELECT public.t131_c();
UPDATE public.assets SET description = 'Nothing typed now.' WHERE id = '13100000-0000-0000-0000-000000000051';
SELECT is(public.t131_all(), '051>061:manual', 'the words'' removal removes the typed link, and leaves the hand-drawn one');
UPDATE public.assets SET description = 'See [[Grade it|m:' || current_setting('t131.k1') || ']] soon.' WHERE id = '13100000-0000-0000-0000-000000000051';
SELECT is(public.t131_all(), '051>061:inline:description,051>061:manual', 'an undo brings the words back to their field, and their link with them');
UPDATE public.assets SET description = 'Nothing typed now.' WHERE id = '13100000-0000-0000-0000-000000000051';
SELECT set_config('t131.k3', public.moth_mention_reserve('file', '13100000-0000-0000-0000-0000000000c1'), true);
UPDATE public.assets SET description = 'Shot on [[the secret one|m:' || current_setting('t131.k3') || ']].' WHERE id = '13100000-0000-0000-0000-000000000051';
SELECT is(public.t131_all(), '051>061:manual,051>0c1:inline:description', 'the creator of the private project types a link into it');
SELECT public.t131_d();
UPDATE public.assets SET description = 'Shot by night on [[the secret one|m:' || current_setting('t131.k3') || ']].' WHERE id = '13100000-0000-0000-0000-000000000051';
SELECT is(public.t131_all(), '051>061:manual,051>0c1:inline:description',
  'a manager who cannot see that file changes the other words, and its link stays');
SELECT is(public.t131_seen(), '051>061:manual', 'and still does not see it');
SELECT public.t131_c();
SELECT set_config('t131.k4', public.moth_mention_reserve('task', '13100000-0000-0000-0000-000000000061'), true);
RESET ROLE;
UPDATE public.moth_mention_reservations SET created_at = now() - interval '2 days' WHERE mention_key = current_setting('t131.k4');
SET LOCAL ROLE authenticated;
SELECT public.t131_c();
UPDATE public.files SET description = 'Late [[Grade|m:' || current_setting('t131.k4') || ']].' WHERE id = '13100000-0000-0000-0000-000000000081';
SELECT is(public.t131_all(), '051>061:manual,051>0c1:inline:description', 'and a key past its day links nothing');

-- ── F. A note's typed links ─────────────────────────────────────────────────
SELECT set_config('t131.k5', public.moth_mention_reserve('task', '13100000-0000-0000-0000-000000000061'), true);
SELECT is(public.moth_note_mentions_sync('13100000-0000-0000-0000-0000000000b1', 3, ARRAY[current_setting('t131.k5')]), false,
  'keys read from a version the note no longer is are not used');
SELECT is(public.t131_all(), '051>061:manual,051>0c1:inline:description', 'and link nothing');
SELECT ok(public.moth_note_mentions_sync('13100000-0000-0000-0000-0000000000b1', 0, ARRAY[current_setting('t131.k5')]),
  'a note''s editor sends the keys in the body it saved, with that version');
SELECT is(public.t131_all(), '051>061:manual,051>0c1:inline:description,0b1>061:inline:body', 'and the shared note links to the task');
SELECT set_config('t131.k6', public.moth_mention_reserve('task', '13100000-0000-0000-0000-000000000061'), true);
SELECT ok(public.moth_note_mentions_sync('13100000-0000-0000-0000-0000000000b2', 0, ARRAY[current_setting('t131.k6')]), 'so does the owner''s personal note');
SELECT public.t131_d();
SELECT is(public.t131_seen(), '051>061:manual,0b1>061:inline', 'a manager sees the shared note''s link, and not the personal note''s');
SELECT throws_ok($$SELECT public.moth_note_mentions_sync('13100000-0000-0000-0000-0000000000b1', 0, ARRAY[]::text[])$$,
  '42501', 'That note is not one you can change.', 'and changes no one else''s note''s links');
SELECT public.t131_a();
SELECT is(public.t131_seen(), '051>061:manual,051>0c1:inline,0b1>061:inline', 'an admin sees no personal note''s link either');
SELECT public.t131_c();
SELECT throws_ok($$SELECT public.moth_note_mentions_sync('13100000-0000-0000-0000-0000000000b1', 0, ARRAY['not a key'])$$,
  '22023', NULL, 'a key is twelve hex digits');
SELECT ok(public.moth_note_mentions_sync('13100000-0000-0000-0000-0000000000b1', 0, ARRAY[]::text[]), 'a body with no key left');
SELECT is(public.t131_all(), '051>061:manual,051>0c1:inline:description,0b2>061:inline:body', 'takes its links away');

-- ── G. The reads ────────────────────────────────────────────────────────────
SELECT public.t131_d();
SELECT is((SELECT string_agg(right(l ->> 'source_id', 3) || '>' || right(l ->> 'target_id', 3), ',' ORDER BY l ->> 'source_id', l ->> 'target_id')
             FROM jsonb_array_elements(public.moth_relationships_read() -> 'links') AS l),
  '051>061', 'the graph''s read gives a manager the links it may see');
SELECT is((SELECT string_agg((x ->> 'kind') || ':' || (x ->> 'name') || ':' || (x ->> 'origin'), ',') FROM jsonb_array_elements(public.moth_item_links('task', '13100000-0000-0000-0000-000000000061') -> 'in') AS x),
  'asset:Mira:manual', 'a task''s "Mentioned in": the asset, by its name; not the personal note');
SELECT is(public.moth_item_links('file', '13100000-0000-0000-0000-0000000000c1'), '{"in": [], "out": []}'::jsonb,
  'nothing for a thing the caller cannot see, as for one that is not there');
SELECT ok(EXISTS (SELECT 1 FROM jsonb_array_elements(public.moth_mention_candidates('grade', 20)) c WHERE c ->> 'id' = '13100000-0000-0000-0000-000000000061'),
  'the picker offers the task by its words');
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(public.moth_mention_candidates('secret', 20))), 0, 'and never a private project''s file');
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(public.moth_mention_candidates('my own notes', 20))), 0, 'nor someone''s personal note');
SELECT public.t131_c();
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(public.moth_mention_candidates('fee', 20))), 0, 'nor a money file');
SELECT is((SELECT string_agg(c ->> 'kind', ',') FROM jsonb_array_elements(public.moth_mention_candidates('my own notes', 20)) c), 'note',
  'and gives its owner their own note');
SELECT is((SELECT string_agg(x ->> 'key', ',') FROM jsonb_array_elements(public.moth_item_links('asset', '13100000-0000-0000-0000-000000000051') -> 'out') AS x
            WHERE x ->> 'origin' = 'inline'),
  current_setting('t131.k3'), 'a thing''s typed link out carries its key, so its words are drawn as a link');
SELECT public.t131_a();
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(public.moth_mention_candidates('pitch', 20))), 0,
  'the picker offers an admin nothing of someone''s personal space');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
-- 510 files in the private project, 250 of them named to come before one of P's in the picker (it starts with
-- the words; P's only holds them), and every one linked to P's task ahead of a link from Q's asset (the same
-- moment, a lower id). And a folder of P.
CREATE TEMP TABLE t131_hidden ON COMMIT DROP AS
SELECT gen_random_uuid() AS id, g FROM generate_series(1, 510) AS g;
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial)
SELECT h.id, 'aaaa1310-0000-0000-0000-00000000000c', CASE WHEN h.g <= 250 THEN 'reel hidden ' ELSE 'link hidden ' END || h.g, 'supabase',
       'projects/aaaa1310-0000-0000-0000-00000000000c/files/' || h.id || '/hidden.png', false
  FROM t131_hidden h;
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial) VALUES
  ('13100000-0000-0000-0000-0000000000d1', 'aaaa1310-0000-0000-0000-00000000000a', 'the kept reel', 'supabase',
   'projects/aaaa1310-0000-0000-0000-00000000000a/files/13100000-0000-0000-0000-0000000000d1/kept.png', false),
  -- Its name holds the task's words without being them, and its id comes first: only the rank puts it second.
  ('13100000-0000-0000-0000-000000000001', 'aaaa1310-0000-0000-0000-00000000000a', 'Grade the harbour, take 2', 'supabase',
   'projects/aaaa1310-0000-0000-0000-00000000000a/files/13100000-0000-0000-0000-000000000001/take2.png', false);
INSERT INTO public.moth_relationships (workspace_id, source_type, source_id, dest_type, dest_id)
SELECT '11111111-1111-1111-1111-111111111111', 'file', h.id, 'task', '13100000-0000-0000-0000-000000000061'
  FROM t131_hidden h;
INSERT INTO public.moth_relationships (id, workspace_id, source_type, source_id, dest_type, dest_id) VALUES
  ('ffffffff-ffff-ffff-ffff-fffffffff131', '11111111-1111-1111-1111-111111111111', 'asset', '13100000-0000-0000-0000-000000000052',
   'task', '13100000-0000-0000-0000-000000000061');
INSERT INTO public.folders (id, project_id, workspace_id, kind, slug, label, path) VALUES
  ('13100000-0000-0000-0000-0000000000f0', 'aaaa1310-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'root', 'Salt_Hours', NULL, '');
INSERT INTO public.folders (id, project_id, workspace_id, parent_id, kind, slug, label, path) VALUES
  ('13100000-0000-0000-0000-0000000000f1', 'aaaa1310-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '13100000-0000-0000-0000-0000000000f0', 'custom', 'Harbour_plates', 'Harbour plates', 'Harbour_plates');
SET LOCAL ROLE authenticated;
SELECT public.t131_d();
SELECT ok(EXISTS (SELECT 1 FROM jsonb_array_elements(public.moth_mention_candidates('reel', 50)) c WHERE c ->> 'id' = '13100000-0000-0000-0000-0000000000d1'),
  'two hundred and fifty things the caller cannot see, ranked first, do not hide one they can');
SELECT ok(EXISTS (SELECT 1 FROM jsonb_array_elements(public.moth_item_links('task', '13100000-0000-0000-0000-000000000061') -> 'in') x
                   WHERE x ->> 'target_id' = '13100000-0000-0000-0000-000000000052'),
  'nor do five hundred and ten links from things they cannot see hide one in "Mentioned in"');
SELECT is((SELECT string_agg(c ->> 'kind', ',') FROM jsonb_array_elements(public.moth_mention_candidates('harbour plates', 20)) c), 'folder',
  'the picker offers a folder by its label');
SELECT is((SELECT c ->> 'kind' FROM jsonb_array_elements(public.moth_mention_candidates('grade the harbour', 20)) WITH ORDINALITY AS z(c, i) ORDER BY i LIMIT 1),
  'task', 'and an exact name comes first');

-- ── H. With either end ──────────────────────────────────────────────────────
RESET ROLE;
DELETE FROM public.tasks WHERE id = '13100000-0000-0000-0000-000000000061';
SELECT is(public.t131_all(), '051>0c1:inline:description', 'a task deleted takes every link to it');

SELECT * FROM finish();
ROLLBACK;
