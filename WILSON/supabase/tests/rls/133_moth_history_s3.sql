-- =============================================================================
-- 133_moth_history_s3.sql — M.O.T.H. Session 3 (MO3): the record of workspace notes, typed tags, their assignments
-- and links (0128, 0129).
--
-- A. Structure: the six peer columns, the seven checks validated, two triggers on each of the four tables, the
--    helpers no client's to call, and the checks refusing a company row with a project or a person's peer with no
--    owner. (0129's own post-conditions ask every company it finds for its four marks.)
-- B. A note's record: a personal note's to its owner alone (no admin leg); a shared note's to every active member, not
--    to one who left nor another company; its title and tier, never its body; sharing reads to others as an arrival;
--    the trash as a trash.
-- C. A typed tag's record: the company's to its members, a person's own to them alone.
-- D. An assignment's record: a person's own tagging to them alone; the company's to whoever sees the thing; on a thing
--    in a private project, to that project's audience.
-- E. A link's record: to whoever sees both its ends, never to one who sees only one; from a person's own note, theirs.
-- F. The window names the four.
-- =============================================================================

BEGIN;
SELECT plan(33);

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
CREATE FUNCTION public.t133_as(p_user uuid, p_role text, p_ws uuid DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_role))::text, true);
END;
$f$;
CREATE FUNCTION public.t133_a() RETURNS void LANGUAGE sql AS $f$ SELECT public.t133_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin') $f$;
CREATE FUNCTION public.t133_b() RETURNS void LANGUAGE sql AS $f$ SELECT public.t133_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222') $f$;
CREATE FUNCTION public.t133_c() RETURNS void LANGUAGE sql AS $f$ SELECT public.t133_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user') $f$;
CREATE FUNCTION public.t133_d() RETURNS void LANGUAGE sql AS $f$ SELECT public.t133_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager') $f$;
CREATE FUNCTION public.t133_e() RETURNS void LANGUAGE sql AS $f$ SELECT public.t133_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user') $f$;
CREATE FUNCTION public.t133_r() RETURNS void LANGUAGE sql AS $f$ SELECT public.t133_as('99999999-9999-9999-9999-999999999999', 'user') $f$;
CREATE FUNCTION public.t133_n() RETURNS void LANGUAGE sql AS $f$ SELECT public.t133_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'user') $f$;
-- The SQLSTATE a statement is refused with, or 'no refusal'.
CREATE FUNCTION public.t133_err(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
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
CREATE FUNCTION public.t133_words(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'no refusal';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$f$;

-- A tag's id by its label and owner (NULL for the company's), as the database sees it.
CREATE FUNCTION public.t133_tag(p_label text, p_owner uuid DEFAULT NULL) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $f$
  SELECT id FROM public.moth_tags WHERE label = p_label AND owner_id IS NOT DISTINCT FROM p_owner ORDER BY created_at, id LIMIT 1
$f$;
GRANT EXECUTE ON FUNCTION public.t133_tag(text, uuid) TO authenticated;

-- P and Q shared, X user_c's private project, S user_e's personal space; each with a few things.
SELECT public.t133_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1330-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Salt Hours', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1330-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Second', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL);
SELECT public.t133_c();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1330-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Private', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true, NULL);
SELECT public.t133_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1330-0000-0000-0000-0000000000e0', '11111111-1111-1111-1111-111111111111', 'Personal space', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1330-0000-0000-0000-00000000000a', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1330-0000-0000-0000-00000000000a', '99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'reviewer')
ON CONFLICT DO NOTHING;
INSERT INTO public.assets (id, project_id, name) VALUES
  ('13300000-0000-0000-0000-000000000051', 'aaaa1330-0000-0000-0000-00000000000a', 'Mira'),
  ('13300000-0000-0000-0000-000000000052', 'aaaa1330-0000-0000-0000-00000000000b', 'Elsewhere'),
  ('13300000-0000-0000-0000-0000000000e1', 'aaaa1330-0000-0000-0000-0000000000e0', 'Pitch');
INSERT INTO public.tasks (id, project_id, title) VALUES
  ('13300000-0000-0000-0000-000000000061', 'aaaa1330-0000-0000-0000-00000000000a', 'Grade the harbour');
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial) VALUES
  ('13300000-0000-0000-0000-000000000081', 'aaaa1330-0000-0000-0000-00000000000a', 'mira.png', 'supabase', 'projects/aaaa1330-0000-0000-0000-00000000000a/files/13300000-0000-0000-0000-000000000081/mira.png', false),
  ('13300000-0000-0000-0000-000000000082', 'aaaa1330-0000-0000-0000-00000000000a', 'fee.pdf', 'supabase', 'projects/aaaa1330-0000-0000-0000-00000000000a/files/13300000-0000-0000-0000-000000000082/fee.pdf', true),
  ('13300000-0000-0000-0000-0000000000e2', 'aaaa1330-0000-0000-0000-0000000000e0', 'pitch.png', 'supabase', 'projects/aaaa1330-0000-0000-0000-0000000000e0/files/13300000-0000-0000-0000-0000000000e2/pitch.png', false);
SELECT public.t133_c();
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial) VALUES
  ('13300000-0000-0000-0000-0000000000c1', 'aaaa1330-0000-0000-0000-00000000000c', 'secret.png', 'supabase', 'projects/aaaa1330-0000-0000-0000-00000000000c/files/13300000-0000-0000-0000-0000000000c1/secret.png', false);
-- user_n leaves once everything is made.
UPDATE public.workspace_members SET is_active = false
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

-- How many of the record's rows about one thing the caller reads, and the newest one's word, in the reader's own
-- order (every row of one transaction shares its moment).
CREATE FUNCTION public.t133_seen(p_id uuid) RETURNS int LANGUAGE sql STABLE AS $f$
  SELECT count(*)::int FROM public.moth_history_read() h WHERE h.entity_id = p_id
$f$;
CREATE FUNCTION public.t133_last(p_id uuid) RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT h.action || ':' || (h.prior IS NULL)::text || ':' || (h.state IS NULL)::text
    FROM public.moth_history_read() WITH ORDINALITY AS h WHERE h.entity_id = p_id ORDER BY h.ordinality LIMIT 1
$f$;
GRANT EXECUTE ON FUNCTION public.t133_seen(uuid), public.t133_last(uuid) TO authenticated;

-- ── A. Structure ───────────────────────────────────────────────────────────
SELECT is((SELECT count(*)::int FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'moth_history' AND column_name ~ '_peer_' AND is_nullable = 'YES'), 6,
  'the record has a peer for each side: a project, a class and an owner');
SELECT is((SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'public.moth_history'::regclass AND contype = 'c' AND convalidated), 7,
  'and its seven checks, validated');
SELECT is((SELECT count(*)::int FROM pg_trigger WHERE tgfoid = 'public.fn_moth_history_capture()'::regprocedure
            AND tgrelid IN ('public.notes'::regclass, 'public.moth_tags'::regclass, 'public.moth_tag_assignments'::regclass,
                            'public.moth_relationships'::regclass)), 8,
  'notes, typed tags, their assignments and links are recorded, two triggers each');
SELECT ok(NOT has_function_privilege('authenticated', 'public._moth_history_s3_side(text,jsonb)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public._moth_history_end(text,uuid)', 'EXECUTE'),
  'whose a row is, is no client''s to ask');
SELECT is(public.t133_err($$INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, state_project_id, state_class, state)
          VALUES ('11111111-1111-1111-1111-111111111111', 'notes', gen_random_uuid(), 'create', 'aaaa1330-0000-0000-0000-00000000000a', 'workspace', '{"title": "x"}')$$),
  '23514', 'a company row has no project');
SELECT is(public.t133_err($$INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, state_class, state, state_peer_class)
          VALUES ('11111111-1111-1111-1111-111111111111', 'notes', gen_random_uuid(), 'create', 'workspace', '{"title": "x"}', 'personal')$$),
  '23514', 'and a person''s peer has an owner');

-- ── B. A note's record ──────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t133_c();
INSERT INTO public.notes (id, title) VALUES ('13300000-0000-0000-0000-0000000000b1', 'C, alone');
INSERT INTO public.notes (id, title, tier) VALUES ('13300000-0000-0000-0000-0000000000b2', 'C, shared', 'shared');
INSERT INTO public.notes (id, title) VALUES ('13300000-0000-0000-0000-0000000000b3', 'C, linking');
SELECT is(public.t133_seen('13300000-0000-0000-0000-0000000000b1'), 1, 'a person reads their own note''s record');
SELECT is((SELECT state FROM public.moth_history_read() WHERE entity_id = '13300000-0000-0000-0000-0000000000b2'),
  '{"tier": "shared", "title": "C, shared"}'::jsonb, 'which holds its title and tier, never its body');
SELECT public.t133_d();
SELECT is(public.t133_seen('13300000-0000-0000-0000-0000000000b1'), 0, 'a manager reads none of someone''s personal note''s record');
SELECT is(public.t133_seen('13300000-0000-0000-0000-0000000000b2'), 1, 'and a shared note''s, as every member does');
SELECT public.t133_a();
SELECT is(public.t133_seen('13300000-0000-0000-0000-0000000000b1'), 0, 'an admin reads no one''s personal note''s record: no admin leg');
SELECT public.t133_b();
SELECT is(public.t133_seen('13300000-0000-0000-0000-0000000000b2'), 0, 'nor does another company');
SELECT public.t133_n();
SELECT throws_ok($$SELECT * FROM public.moth_history_read()$$, '42501', 'that history is not available', 'nor someone who has left');
SELECT public.t133_c();
UPDATE public.notes SET tier = 'shared' WHERE id = '13300000-0000-0000-0000-0000000000b1';
SELECT public.note_trash('13300000-0000-0000-0000-0000000000b2');
SELECT public.t133_d();
SELECT is(public.t133_last('13300000-0000-0000-0000-0000000000b1'), 'added:true:false',
  'a note shared reads to others as one that arrived, with nothing of its private past');
SELECT is(public.t133_seen('13300000-0000-0000-0000-0000000000b1'), 1, 'and only that');
SELECT is(public.t133_last('13300000-0000-0000-0000-0000000000b2'), 'trashed:false:false', 'a shared note put in the trash reads as trashed');

-- ── C. A typed tag's record ─────────────────────────────────────────────────
-- Made by the test with each person's claims, as suite 128's are: a client sets no id.
RESET ROLE;
SELECT public.t133_a();
INSERT INTO public.moth_tag_types (id, tier, name) VALUES ('13300000-0000-0000-0000-0000000000a1', 'company', 'Character');
INSERT INTO public.moth_tags (type_id, tier, label) VALUES ('13300000-0000-0000-0000-0000000000a1', 'company', 'Mira');
SELECT public.t133_c();
INSERT INTO public.moth_tag_types (id, tier, name) VALUES ('13300000-0000-0000-0000-0000000000c9', 'personal', 'Mine');
INSERT INTO public.moth_tags (type_id, tier, label) VALUES ('13300000-0000-0000-0000-0000000000c9', 'personal', 'Lantern');
SET LOCAL ROLE authenticated;
SELECT is(public.t133_seen(public.t133_tag('Lantern', 'cccccccc-cccc-cccc-cccc-cccccccccccc')), 1, 'a person reads their own tag''s record');
SELECT public.t133_d();
SELECT is(public.t133_seen(public.t133_tag('Mira')), 1, 'a member reads the company''s');
SELECT is(public.t133_seen(public.t133_tag('Lantern', 'cccccccc-cccc-cccc-cccc-cccccccccccc')), 0, 'and none of someone''s own');
SELECT public.t133_a();
SELECT is(public.t133_seen(public.t133_tag('Lantern', 'cccccccc-cccc-cccc-cccc-cccccccccccc')), 0, 'nor does an admin');

-- ── D. An assignment's record ───────────────────────────────────────────────
RESET ROLE;
INSERT INTO public.moth_tag_assignments (id, tag_id, tier, target_type, target_id)
VALUES ('13300000-0000-0000-0000-0000000000d1', public.t133_tag('Mira'), 'company', 'task', '13300000-0000-0000-0000-000000000061');
SELECT public.t133_c();
INSERT INTO public.moth_tag_assignments (id, tag_id, tier, target_type, target_id)
VALUES ('13300000-0000-0000-0000-0000000000d2', public.t133_tag('Mira'), 'personal', 'asset', '13300000-0000-0000-0000-000000000051'),
       ('13300000-0000-0000-0000-0000000000d3', public.t133_tag('Mira'), 'company', 'file', '13300000-0000-0000-0000-0000000000c1');
SET LOCAL ROLE authenticated;
SELECT is(public.t133_seen('13300000-0000-0000-0000-0000000000d2'), 1, 'a person reads the record of their own tagging');
SELECT is(public.t133_seen('13300000-0000-0000-0000-0000000000d3'), 1, 'and of a company tag on their private project''s file');
SELECT public.t133_d();
SELECT is(public.t133_seen('13300000-0000-0000-0000-0000000000d2'), 0, 'no one else reads a person''s private tagging');
SELECT is(public.t133_seen('13300000-0000-0000-0000-0000000000d1'), 1, 'a company tagging, whoever sees the thing reads');
SELECT is(public.t133_seen('13300000-0000-0000-0000-0000000000d3'), 0, 'but not one on a thing in a private project they cannot see');
SELECT public.t133_a();
SELECT is(public.t133_seen('13300000-0000-0000-0000-0000000000d2'), 0, 'nor does an admin read a person''s own tagging');

-- ── E. A link's record ──────────────────────────────────────────────────────
SELECT public.t133_c();
INSERT INTO public.moth_relationships (source_type, source_id, dest_type, dest_id, label)
VALUES ('asset', '13300000-0000-0000-0000-000000000051', 'file', '13300000-0000-0000-0000-0000000000c1', 'shot on'),
       ('note', '13300000-0000-0000-0000-0000000000b3', 'asset', '13300000-0000-0000-0000-000000000051', NULL);
SELECT public.t133_d();
INSERT INTO public.moth_relationships (source_type, source_id, dest_type, dest_id)
VALUES ('asset', '13300000-0000-0000-0000-000000000051', 'task', '13300000-0000-0000-0000-000000000061');
RESET ROLE;
CREATE TEMP TABLE t133_links ON COMMIT DROP AS
SELECT r.id, r.source_type || '>' || r.dest_type AS k FROM public.moth_relationships r WHERE r.workspace_id = '11111111-1111-1111-1111-111111111111';
GRANT SELECT ON t133_links TO authenticated;
SET LOCAL ROLE authenticated;
SELECT public.t133_c();
SELECT is(public.t133_seen((SELECT id FROM t133_links WHERE k = 'asset>file')), 1, 'the maker of a link into their private project reads its record');
SELECT is(public.t133_seen((SELECT id FROM t133_links WHERE k = 'note>asset')), 1, 'and of a link from their own note');
SELECT public.t133_d();
SELECT is(public.t133_seen((SELECT id FROM t133_links WHERE k = 'asset>file')), 0, 'one who sees only one end reads none of it');
SELECT is(public.t133_seen((SELECT id FROM t133_links WHERE k = 'note>asset')), 0, 'nor of a link from someone''s own note');
SELECT public.t133_e();
SELECT is(public.t133_seen((SELECT id FROM t133_links WHERE k = 'asset>task')), 1, 'a link between two things a member sees, they read');
SELECT is((SELECT state ->> 'origin' FROM public.moth_history_read() WHERE entity_id = (SELECT id FROM t133_links WHERE k = 'asset>task')),
  'manual', 'with how it came, and its ends');

-- ── F. The window ───────────────────────────────────────────────────────────
SELECT is((SELECT count(*)::int FROM public.moth_history_window()
            WHERE entity_type IN ('notes', 'moth_tags', 'moth_tag_assignments', 'moth_relationships') AND project_id IS NULL), 4,
  'the window says since when each of the four is recorded');

SELECT * FROM finish();
ROLLBACK;
