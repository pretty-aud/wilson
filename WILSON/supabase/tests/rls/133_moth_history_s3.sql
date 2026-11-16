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
-- G. Rounds B and the second look: money and Legal reach no tagging or link, gone or not; a purge's removals read
--    as they were, to the audience the gone thing last had; a note
--    made personal again keeps its tagging's past to its owner; the peer alone; failure marks and the window; what
--    is not recorded; three more of the checks.
-- =============================================================================

BEGIN;
SELECT plan(88);

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
          AND NOT has_function_privilege('authenticated', 'public._moth_history_end(text,uuid)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public._moth_history_end_visible(uuid,text,uuid)', 'EXECUTE'),
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

-- ── G. Round B (the review round of 0128 and 0129) ──────────────────────────
-- G1. Money: a tagging and a link on a file that turns money go blank, and stay unread when they go; a link gone
--     before then is read by the file's lock, and once the file is purged, by its locked record.
RESET ROLE;
SELECT public.t133_a();
INSERT INTO public.moth_tag_assignments (id, tag_id, tier, target_type, target_id)
VALUES ('13300000-0000-0000-0000-000000000111', public.t133_tag('Mira'), 'company', 'file', '13300000-0000-0000-0000-000000000081'),
       ('13300000-0000-0000-0000-000000000117', public.t133_tag('Mira'), 'personal', 'file', '13300000-0000-0000-0000-000000000081');
INSERT INTO public.moth_relationships (id, source_type, source_id, dest_type, dest_id, label)
VALUES ('13300000-0000-0000-0000-000000000121', 'asset', '13300000-0000-0000-0000-000000000051', 'file', '13300000-0000-0000-0000-000000000081', 'see the fee memo'),
       ('13300000-0000-0000-0000-000000000123', 'task', '13300000-0000-0000-0000-000000000061', 'file', '13300000-0000-0000-0000-000000000081', 'was the fee');
DELETE FROM public.moth_relationships WHERE id = '13300000-0000-0000-0000-000000000123';
SET LOCAL ROLE authenticated;
SELECT public.t133_d();
SELECT is(public.t133_seen('13300000-0000-0000-0000-000000000111') + public.t133_seen('13300000-0000-0000-0000-000000000121') + public.t133_seen('13300000-0000-0000-0000-000000000123'), 4,
  'a member reads the record of a tagging and of links on a file they see');
RESET ROLE;
SELECT public.t133_a();
UPDATE public.files SET is_financial = true WHERE id = '13300000-0000-0000-0000-000000000081';
SELECT ok((SELECT bool_and(h.locked AND h.prior IS NULL AND h.state IS NULL) FROM public.moth_history h
            WHERE h.entity_id IN ('13300000-0000-0000-0000-000000000111', '13300000-0000-0000-0000-000000000117', '13300000-0000-0000-0000-000000000121')),
  'once the file is money, the record of the taggings and the link still on it goes blank');
DELETE FROM public.moth_tag_assignments WHERE id = '13300000-0000-0000-0000-000000000111';
DELETE FROM public.moth_relationships WHERE id = '13300000-0000-0000-0000-000000000121';
SELECT is((SELECT count(*)::int FROM public.moth_history h WHERE h.entity_id IN ('13300000-0000-0000-0000-000000000111', '13300000-0000-0000-0000-000000000121') AND NOT h.locked), 0,
  'and their going writes nothing');
SET LOCAL ROLE authenticated;
SELECT public.t133_d();
SELECT is(public.t133_seen('13300000-0000-0000-0000-000000000111') + public.t133_seen('13300000-0000-0000-0000-000000000121'), 0, 'so a member reads none of either, gone');
SELECT is(public.t133_seen('13300000-0000-0000-0000-000000000123'), 0, 'nor of a link gone before the file was money');
RESET ROLE;
DELETE FROM public.files WHERE id = '13300000-0000-0000-0000-000000000081';
SELECT is((SELECT count(*)::int FROM public.moth_history h WHERE h.entity_id = '13300000-0000-0000-0000-000000000117' AND NOT h.locked), 0,
  'a tagging the money file''s purge takes writes nothing either');
SET LOCAL ROLE authenticated;
SELECT public.t133_d();
SELECT is(public.t133_seen('13300000-0000-0000-0000-000000000123'), 0, 'and with the file purged, its locked record keeps that link unread');

-- G1c. A file gone with no record of its own (its going never written): its links read to no one, their maker too.
RESET ROLE;
SELECT public.t133_e();
INSERT INTO public.moth_relationships (id, source_type, source_id, dest_type, dest_id, label)
VALUES ('13300000-0000-0000-0000-000000000124', 'asset', '13300000-0000-0000-0000-0000000000e1', 'file', '13300000-0000-0000-0000-0000000000e2', 'pitch');
DELETE FROM public.files WHERE id = '13300000-0000-0000-0000-0000000000e2';
DELETE FROM public.moth_history WHERE entity_type = 'files' AND entity_id = '13300000-0000-0000-0000-0000000000e2';
SET LOCAL ROLE authenticated;
SELECT public.t133_e();
SELECT is(public.t133_seen('13300000-0000-0000-0000-000000000124'), 0, 'a link to a file gone with no record of its own reads to no one');

-- G2. What the capture asks of an end.
RESET ROLE;
SELECT ok((SELECT e.o_locked AND e.o_class IS NULL FROM public._moth_history_end('file', '13300000-0000-0000-0000-000000000082') e),
  'an end in money is locked, with no audience');
SELECT ok((SELECT s.o_locked FROM public._moth_history_s3_side('moth_relationships',
            jsonb_build_object('source_type', 'task', 'source_id', '13300000-0000-0000-0000-000000000061', 'dest_type', 'file',
                               'dest_id', '13300000-0000-0000-0000-000000000082')) s),
  'so a link to it is locked');
SELECT ok((SELECT e.o_gone AND NOT e.o_locked FROM public._moth_history_end('task', gen_random_uuid()) e),
  'and a thing that cannot be found is gone, not locked');
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path)
SELECT '13300000-0000-0000-0000-0000000001f0', 'aaaa1330-0000-0000-0000-00000000000a', NULL, 'root', 'salt', ''
 WHERE NOT EXISTS (SELECT 1 FROM public.folders WHERE project_id = 'aaaa1330-0000-0000-0000-00000000000a' AND kind = 'root');
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('13300000-0000-0000-0000-0000000001f3', 'aaaa1330-0000-0000-0000-00000000000a', (SELECT id FROM public.folders WHERE project_id = 'aaaa1330-0000-0000-0000-00000000000a' AND kind = 'root' LIMIT 1), 'category', 'invoices', 'INVOICES'),
  ('13300000-0000-0000-0000-0000000001f1', 'aaaa1330-0000-0000-0000-00000000000a', (SELECT id FROM public.folders WHERE project_id = 'aaaa1330-0000-0000-0000-00000000000a' AND kind = 'root' LIMIT 1), 'category', 'rushes', 'rushes');
SELECT ok((SELECT e.o_locked FROM public._moth_history_end('folder', '13300000-0000-0000-0000-0000000001f3') e)
          AND NOT (SELECT e.o_locked FROM public._moth_history_end('folder', '13300000-0000-0000-0000-0000000001f1') e),
  'a money folder is locked too, and another folder is not');
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, tags, is_financial) VALUES
  ('13300000-0000-0000-0000-000000000084', 'aaaa1330-0000-0000-0000-00000000000a', 'nda.pdf', 'supabase', 'projects/aaaa1330-0000-0000-0000-00000000000a/legal/a/nda.pdf', '{legal}', false);
SELECT ok((SELECT e.o_locked FROM public._moth_history_end('file', '13300000-0000-0000-0000-000000000084') e), 'and so is a Legal file');

-- G3. A purge takes a note's tagging and its link with it: their going reads to those who read them.
SET LOCAL ROLE authenticated;
SELECT public.t133_c();
INSERT INTO public.notes (id, title, tier) VALUES ('13300000-0000-0000-0000-000000000101', 'C, purged', 'shared');
RESET ROLE;
SELECT public.t133_c();
INSERT INTO public.moth_tag_assignments (id, tag_id, tier, target_type, target_id)
VALUES ('13300000-0000-0000-0000-000000000112', public.t133_tag('Mira'), 'company', 'note', '13300000-0000-0000-0000-000000000101');
INSERT INTO public.moth_relationships (id, source_type, source_id, dest_type, dest_id, label)
VALUES ('13300000-0000-0000-0000-000000000122', 'note', '13300000-0000-0000-0000-000000000101', 'asset', '13300000-0000-0000-0000-000000000051', 'about');
DELETE FROM public.notes WHERE id = '13300000-0000-0000-0000-000000000101';
SET LOCAL ROLE authenticated;
SELECT public.t133_d();
SELECT is(public.t133_last('13300000-0000-0000-0000-000000000112'), 'removed:false:true', 'a tagging a purge took reads as removed, as it was');
SELECT is(public.t133_seen('13300000-0000-0000-0000-000000000112'), 2, 'after it was added');
SELECT is(public.t133_last('13300000-0000-0000-0000-000000000122'), 'removed:false:true', 'and so does a link');
SELECT is(public.t133_last('13300000-0000-0000-0000-000000000101'), 'removed:false:true', 'and the note itself');

-- G3b. A tagging the record never held (made before it began), on a note: a purge takes it, and its going is told to
--      those its note was for (the note's own going is written first, before its foreign keys' cascade).
SET LOCAL ROLE authenticated;
SELECT public.t133_c();
INSERT INTO public.notes (id, title, tier) VALUES ('13300000-0000-0000-0000-000000000104', 'C, older', 'shared');
RESET ROLE;
SELECT public.t133_c();
INSERT INTO public.moth_tag_assignments (id, tag_id, tier, target_type, target_id)
VALUES ('13300000-0000-0000-0000-000000000116', public.t133_tag('Mira'), 'company', 'note', '13300000-0000-0000-0000-000000000104');
DELETE FROM public.moth_history WHERE entity_id = '13300000-0000-0000-0000-000000000116';
DELETE FROM public.notes WHERE id = '13300000-0000-0000-0000-000000000104';
SET LOCAL ROLE authenticated;
SELECT public.t133_d();
SELECT is(public.t133_last('13300000-0000-0000-0000-000000000116'), 'removed:false:true', 'a tagging the record never held, on a note, is told gone to those its note was for');
RESET ROLE;

-- G3c. A purge of a file or an asset no one locked: its tagging's and its link's going read as removed.
RESET ROLE;
SELECT public.t133_a();
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial) VALUES
  ('13300000-0000-0000-0000-000000000083', 'aaaa1330-0000-0000-0000-00000000000a', 'still.png', 'supabase', 'projects/aaaa1330-0000-0000-0000-00000000000a/files/13300000-0000-0000-0000-000000000083/still.png', false);
INSERT INTO public.assets (id, project_id, name) VALUES ('13300000-0000-0000-0000-000000000054', 'aaaa1330-0000-0000-0000-00000000000a', 'Gull');
INSERT INTO public.moth_tag_assignments (id, tag_id, tier, target_type, target_id)
VALUES ('13300000-0000-0000-0000-000000000118', public.t133_tag('Mira'), 'company', 'file', '13300000-0000-0000-0000-000000000083'),
       ('13300000-0000-0000-0000-000000000119', public.t133_tag('Mira'), 'company', 'asset', '13300000-0000-0000-0000-000000000054');
INSERT INTO public.moth_relationships (id, source_type, source_id, dest_type, dest_id, label)
VALUES ('13300000-0000-0000-0000-000000000125', 'task', '13300000-0000-0000-0000-000000000061', 'file', '13300000-0000-0000-0000-000000000083', 'a still');
DELETE FROM public.files WHERE id = '13300000-0000-0000-0000-000000000083';
DELETE FROM public.assets WHERE id = '13300000-0000-0000-0000-000000000054';
SET LOCAL ROLE authenticated;
SELECT public.t133_d();
SELECT is(public.t133_last('13300000-0000-0000-0000-000000000118') || ' ' || public.t133_last('13300000-0000-0000-0000-000000000125') || ' ' || public.t133_last('13300000-0000-0000-0000-000000000119'),
  'removed:false:true removed:false:true removed:false:true', 'a purge of a file or an asset: its taggings'' and its link''s going read as removed');

-- G4. A note made personal again: what it was tagged with, gone too, is its owner's alone; purged, so is the note.
SET LOCAL ROLE authenticated;
SELECT public.t133_c();
INSERT INTO public.notes (id, title, tier) VALUES ('13300000-0000-0000-0000-000000000102', 'C, then mine', 'shared');
RESET ROLE;
SELECT public.t133_c();
INSERT INTO public.moth_tag_assignments (id, tag_id, tier, target_type, target_id)
VALUES ('13300000-0000-0000-0000-000000000113', public.t133_tag('Mira'), 'company', 'note', '13300000-0000-0000-0000-000000000102');
DELETE FROM public.moth_tag_assignments WHERE id = '13300000-0000-0000-0000-000000000113';
SET LOCAL ROLE authenticated;
SELECT public.t133_d();
SELECT is(public.t133_seen('13300000-0000-0000-0000-000000000113'), 2, 'a member reads a shared note''s tagging, added and removed');
SELECT public.t133_c();
UPDATE public.notes SET tier = 'personal' WHERE id = '13300000-0000-0000-0000-000000000102';
SELECT public.t133_d();
SELECT is(public.t133_seen('13300000-0000-0000-0000-000000000113'), 0, 'made personal again, none of it reads to them');
SELECT public.t133_c();
SELECT is(public.t133_seen('13300000-0000-0000-0000-000000000113'), 2, 'its owner reads all of it');
RESET ROLE;
DELETE FROM public.notes WHERE id = '13300000-0000-0000-0000-000000000102';
SET LOCAL ROLE authenticated;
SELECT public.t133_d();
SELECT is(public.t133_seen('13300000-0000-0000-0000-000000000102') + public.t133_seen('13300000-0000-0000-0000-000000000113'), 0,
  'purged, neither the note nor its tagging reads to them: its last word was personal');
SELECT public.t133_c();
SELECT ok(public.t133_seen('13300000-0000-0000-0000-000000000102') > 0, 'its owner still reads the note''s record');

-- G5. The peer alone: a person's own tagging of a shared thing, gone, reads to them and to no one else.
RESET ROLE;
DELETE FROM public.moth_tag_assignments WHERE id = '13300000-0000-0000-0000-0000000000d2';
SET LOCAL ROLE authenticated;
SELECT public.t133_d();
SELECT is(public.t133_seen('13300000-0000-0000-0000-0000000000d2'), 0, 'one who sees the thing reads none of someone''s own tagging, gone');
SELECT public.t133_c();
SELECT is(public.t133_seen('13300000-0000-0000-0000-0000000000d2'), 2, 'its owner reads it added and removed');

-- G5b. A link's peer alone: from a thing they see to a note that was its owner's alone when the link was made.
SET LOCAL ROLE authenticated;
SELECT public.t133_c();
INSERT INTO public.notes (id, title) VALUES ('13300000-0000-0000-0000-000000000106', 'C, mine then');
RESET ROLE;
SELECT public.t133_c();
INSERT INTO public.moth_relationships (id, source_type, source_id, dest_type, dest_id, label)
VALUES ('13300000-0000-0000-0000-000000000126', 'asset', '13300000-0000-0000-0000-000000000051', 'note', '13300000-0000-0000-0000-000000000106', 'see my note');
DELETE FROM public.moth_relationships WHERE id = '13300000-0000-0000-0000-000000000126';
SET LOCAL ROLE authenticated;
SELECT public.t133_c();
UPDATE public.notes SET tier = 'shared' WHERE id = '13300000-0000-0000-0000-000000000106';
SELECT public.t133_d();
SELECT is(public.t133_seen('13300000-0000-0000-0000-000000000126'), 0, 'a link made to a note while it was its owner''s alone reads to no one else, though the note is shared now');
SELECT public.t133_c();
SELECT is(public.t133_seen('13300000-0000-0000-0000-000000000126'), 2, 'its maker reads it, made and gone');

-- G6. A failure mark keeps its peers: the window tells its restart only to those the row was for, one with no project too.
RESET ROLE;
CREATE TEMP TABLE t133_mark ON COMMIT DROP AS SELECT clock_timestamp() AS at;
GRANT SELECT ON t133_mark TO authenticated;
SELECT lives_ok($$INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, mark_kind,
                    state_project_id, state_class, state_peer_class, state_peer_owner_id, observed_at)
                  VALUES ('11111111-1111-1111-1111-111111111111', 'moth_tag_assignments', '11111111-1111-1111-1111-111111111111',
                          'mark_recording', 'capture_failed', 'aaaa1330-0000-0000-0000-00000000000a', 'shared', 'personal',
                          'cccccccc-cccc-cccc-cccc-cccccccccccc', (SELECT at FROM t133_mark))$$,
  'a failure mark may carry the peers of the row that failed');
SELECT ok(public.t133_words($$INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, mark_kind, state_peer_class)
          VALUES ('11111111-1111-1111-1111-111111111111', 'notes', '11111111-1111-1111-1111-111111111111', 'mark_recording', 'baseline', 'workspace')$$)
          LIKE '%moth_history_g_peer_chk%',
  'no other mark has a peer');
INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, mark_kind, state_class, observed_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'notes', '11111111-1111-1111-1111-111111111111', 'mark_recording', 'capture_failed',
        'workspace', (SELECT at FROM t133_mark));
SET LOCAL ROLE authenticated;
SELECT public.t133_d();
SELECT is((SELECT count(*)::int FROM public.moth_history_window() w
            WHERE w.entity_type = 'moth_tag_assignments' AND w.project_id = 'aaaa1330-0000-0000-0000-00000000000a'), 0,
  'a restart about someone''s own tagging is not told to others');
SELECT is((SELECT w.recording_since FROM public.moth_history_window() w WHERE w.entity_type = 'notes' AND w.project_id IS NULL),
  (SELECT at FROM t133_mark), 'a restart with no project moves its type''s own start, for every member');
SELECT public.t133_c();
SELECT is((SELECT count(*)::int FROM public.moth_history_window() w
            WHERE w.entity_type = 'moth_tag_assignments' AND w.project_id = 'aaaa1330-0000-0000-0000-00000000000a'), 1,
  'and the restart about their own tagging is told to its owner');

-- G7. The window names the four from its own list, not from the marks a company happens to hold.
RESET ROLE;
DELETE FROM public.moth_history WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND action = 'mark_recording'
   AND entity_type IN ('notes', 'moth_tags', 'moth_tag_assignments', 'moth_relationships');
SET LOCAL ROLE authenticated;
SELECT public.t133_d();
SELECT is((SELECT count(*)::int FROM public.moth_history_window()
            WHERE entity_type IN ('notes', 'moth_tags', 'moth_tag_assignments', 'moth_relationships') AND project_id IS NULL), 4,
  'with no mark for them, the window still names the four');

-- G8. What is not recorded: a note's words, a tag's bookkeeping.
SELECT public.t133_c();
INSERT INTO public.notes (id, title, tier, body_preview) VALUES ('13300000-0000-0000-0000-000000000103', 'C, with words', 'shared', 'SECRET-BODY words');
UPDATE public.notes SET body_preview = 'SECRET-BODY other words' WHERE id = '13300000-0000-0000-0000-000000000103';
SELECT is(public.t133_seen('13300000-0000-0000-0000-000000000103'), 1, 'a change to a note''s words alone writes no row');
SELECT ok((SELECT bool_and(COALESCE(h.state, '{}'::jsonb)::text !~ 'SECRET' AND COALESCE(h.prior, '{}'::jsonb)::text !~ 'SECRET')
            FROM public.moth_history_read() h WHERE h.entity_id = '13300000-0000-0000-0000-000000000103'),
  'and its record holds none of its words');
UPDATE public.notes SET title = 'C, with other words' WHERE id = '13300000-0000-0000-0000-000000000103';
SELECT is(public.t133_seen('13300000-0000-0000-0000-000000000103'), 2, 'a new title does');
RESET ROLE;
UPDATE public.moth_tags SET updated_at = updated_at + interval '1 minute' WHERE id = public.t133_tag('Mira');
SET LOCAL ROLE authenticated;
SELECT public.t133_d();
SELECT is(public.t133_seen(public.t133_tag('Mira')), 1, 'nor does a tag''s bookkeeping');

-- G10. A merge moves a tagging to the tag it now stands for: whoever reads the tagging reads the move, both sides.
RESET ROLE;
SELECT public.t133_a();
INSERT INTO public.moth_tags (id, type_id, tier, label)
VALUES ('13300000-0000-0000-0000-0000000001a2', '13300000-0000-0000-0000-0000000000a1', 'company', 'Mira Two');
INSERT INTO public.moth_tag_assignments (id, tag_id, tier, target_type, target_id)
VALUES ('13300000-0000-0000-0000-000000000114', '13300000-0000-0000-0000-0000000001a2', 'company', 'asset', '13300000-0000-0000-0000-000000000051');
SET LOCAL ROLE authenticated;
SELECT public.t133_a();
SELECT public.moth_tag_merge('13300000-0000-0000-0000-0000000001a2', public.t133_tag('Mira'));
SELECT public.t133_d();
SELECT is(public.t133_last('13300000-0000-0000-0000-000000000114'), 'moved:false:false', 'a merge reads as a tagging moved, both sides shown');

-- G11. A project's purge: the taggings it takes with it write nothing no one could read.
RESET ROLE;
SELECT public.t133_a();
INSERT INTO public.assets (id, project_id, name) VALUES ('13300000-0000-0000-0000-000000000053', 'aaaa1330-0000-0000-0000-00000000000b', 'Gone soon');
INSERT INTO public.moth_tag_assignments (id, tag_id, tier, target_type, target_id)
VALUES ('13300000-0000-0000-0000-000000000115', public.t133_tag('Mira'), 'company', 'asset', '13300000-0000-0000-0000-000000000053'),
       ('13300000-0000-0000-0000-00000000011e', public.t133_tag('Mira'), 'personal', 'asset', '13300000-0000-0000-0000-000000000053');
DELETE FROM public.moth_history WHERE entity_id = '13300000-0000-0000-0000-00000000011e';
DELETE FROM public.projects WHERE id = 'aaaa1330-0000-0000-0000-00000000000b';
SELECT is((SELECT count(*)::int FROM public.moth_history h WHERE h.entity_id = '13300000-0000-0000-0000-000000000115') || ' '
          || (SELECT count(*)::int FROM public.moth_history h WHERE h.entity_id = '13300000-0000-0000-0000-00000000011e'), '1 0',
  'a project''s purge: a tagging recorded leaves only the row of its making, one never recorded leaves nothing');

-- G11b. A purge of the project at a link's far end: its going writes nothing no one could read.
RESET ROLE;
SELECT public.t133_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id)
VALUES ('aaaa1330-0000-0000-0000-00000000000e', '11111111-1111-1111-1111-111111111111', 'Short-lived', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL);
INSERT INTO public.assets (id, project_id, name) VALUES ('13300000-0000-0000-0000-000000000055', 'aaaa1330-0000-0000-0000-00000000000e', 'Buoy');
INSERT INTO public.moth_relationships (id, source_type, source_id, dest_type, dest_id, label)
VALUES ('13300000-0000-0000-0000-000000000127', 'asset', '13300000-0000-0000-0000-000000000051', 'asset', '13300000-0000-0000-0000-000000000055', 'like');
DELETE FROM public.projects WHERE id = 'aaaa1330-0000-0000-0000-00000000000e';
SELECT is((SELECT count(*)::int FROM public.moth_history h WHERE h.entity_id = '13300000-0000-0000-0000-000000000127'), 1,
  'a link whose far end''s project is purged leaves only the row of its making');

-- G9. Three more of the checks, each by its own name.
RESET ROLE;
SELECT ok(public.t133_words($$INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, state_class, state_owner_id, state)
          VALUES ('11111111-1111-1111-1111-111111111111', 'notes', gen_random_uuid(), 'create', 'workspace', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '{"title": "x"}')$$)
          LIKE '%moth_history_c_class_chk%',
  'a company row has no owner');
SELECT ok(public.t133_words($$INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, state_class, state, prior_peer_class)
          VALUES ('11111111-1111-1111-1111-111111111111', 'moth_tag_assignments', gen_random_uuid(), 'create', 'workspace', '{"tier": "company"}', 'workspace')$$)
          LIKE '%moth_history_g_peer_chk%',
  'a create has no prior peer');
SELECT ok(public.t133_words($$INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, state_class, state, state_peer_class, state_peer_project_id)
          VALUES ('11111111-1111-1111-1111-111111111111', 'moth_tag_assignments', gen_random_uuid(), 'create', 'workspace', '{"tier": "company"}', 'workspace', 'aaaa1330-0000-0000-0000-00000000000a')$$)
          LIKE '%moth_history_g_peer_chk%',
  'and the company''s peer has no project');

-- G12. A tag's new name and a link's new words are recorded.
RESET ROLE;
SELECT public.t133_a();
UPDATE public.moth_tags SET label = 'Mira Lund' WHERE id = public.t133_tag('Mira');
SELECT public.t133_d();
UPDATE public.moth_relationships SET label = 'leads to' WHERE id = (SELECT id FROM t133_links WHERE k = 'asset>task');
SET LOCAL ROLE authenticated;
SELECT public.t133_d();
SELECT is(public.t133_last(public.t133_tag('Mira Lund')), 'changed:false:false', 'a tag renamed reads as changed');
SELECT is(public.t133_last((SELECT id FROM t133_links WHERE k = 'asset>task')), 'changed:false:false', 'and a link given new words');

-- G12b. A tag retired is recorded too.
RESET ROLE;
CREATE TEMP TABLE t133_lund ON COMMIT DROP AS SELECT public.t133_tag('Mira Lund') AS id;
GRANT SELECT ON t133_lund TO authenticated;
SELECT public.t133_a();
UPDATE public.moth_tags SET retired_at = now() WHERE id = (SELECT id FROM t133_lund);
SET LOCAL ROLE authenticated;
SELECT public.t133_d();
SELECT is(public.t133_last((SELECT id FROM t133_lund)), 'changed:false:false', 'a tag retired reads as changed');

-- G13. The side of a going whose thing has gone: what the thing's own record last said (a note made personal: its
--      owner's), and where that record says nothing, the row's own last side with its project's class asked again (a
--      project made private: 'private'). A private project is read only by its creator and admins, so the stored
--      sides are read here, as the test.
SET LOCAL ROLE authenticated;
SELECT public.t133_c();
INSERT INTO public.notes (id, title, tier) VALUES ('13300000-0000-0000-0000-000000000107', 'C, shared then mine', 'shared');
RESET ROLE;
SELECT public.t133_a();
INSERT INTO public.moth_tags (id, type_id, tier, label)
VALUES ('13300000-0000-0000-0000-0000000001a3', '13300000-0000-0000-0000-0000000000a1', 'company', 'Gannet');
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id)
VALUES ('aaaa1330-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'Quiet', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL);
INSERT INTO public.assets (id, project_id, name) VALUES ('13300000-0000-0000-0000-000000000057', 'aaaa1330-0000-0000-0000-00000000000d', 'Skua');
INSERT INTO public.moth_tag_assignments (id, tag_id, tier, target_type, target_id)
VALUES ('13300000-0000-0000-0000-00000000011b', '13300000-0000-0000-0000-0000000001a3', 'company', 'asset', '13300000-0000-0000-0000-000000000057');
SELECT public.t133_c();
INSERT INTO public.moth_tag_assignments (id, tag_id, tier, target_type, target_id)
VALUES ('13300000-0000-0000-0000-00000000011a', '13300000-0000-0000-0000-0000000001a3', 'company', 'note', '13300000-0000-0000-0000-000000000107');
SET LOCAL ROLE authenticated;
SELECT public.t133_c();
UPDATE public.notes SET tier = 'personal' WHERE id = '13300000-0000-0000-0000-000000000107';
RESET ROLE;
SELECT public.t133_a();
UPDATE public.projects SET is_private = true WHERE id = 'aaaa1330-0000-0000-0000-00000000000d';
DELETE FROM public.moth_history WHERE entity_type = 'assets' AND entity_id = '13300000-0000-0000-0000-000000000057';
DELETE FROM public.notes WHERE id = '13300000-0000-0000-0000-000000000107';
DELETE FROM public.assets WHERE id = '13300000-0000-0000-0000-000000000057';
SELECT is((SELECT h.prior_class || ' ' || COALESCE(h.prior_owner_id::text, '-') FROM public.moth_history h
            WHERE h.entity_id = '13300000-0000-0000-0000-00000000011a' AND h.action = 'delete'),
  'personal cccccccc-cccc-cccc-cccc-cccccccccccc', 'a tagging''s going takes the side its gone note''s own record last said: its owner''s');
SELECT is((SELECT h.prior_class FROM public.moth_history h WHERE h.entity_id = '13300000-0000-0000-0000-00000000011b' AND h.action = 'delete'),
  'private', 'and with no record of the thing, the row''s own last side, its project''s class asked again');

-- G9b. Four more of the peer check's clauses, each by name.
RESET ROLE;
SELECT ok(public.t133_words($$INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, prior_class, prior, state_peer_class)
          VALUES ('11111111-1111-1111-1111-111111111111', 'moth_tag_assignments', gen_random_uuid(), 'delete', 'workspace', '{"tier": "company"}', 'workspace')$$)
          LIKE '%moth_history_g_peer_chk%',
  'a delete has no state peer');
SELECT ok(public.t133_words($$INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, state_class, state, state_peer_class)
          VALUES ('11111111-1111-1111-1111-111111111111', 'moth_tag_assignments', gen_random_uuid(), 'create', 'workspace', '{"tier": "company"}', 'friends')$$)
          LIKE '%moth_history_g_peer_chk%',
  'a peer is one of the four classes');
SELECT ok(public.t133_words($$INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, state_class, state, state_peer_class, state_peer_owner_id)
          VALUES ('11111111-1111-1111-1111-111111111111', 'moth_tag_assignments', gen_random_uuid(), 'create', 'workspace', '{"tier": "company"}', 'shared', 'cccccccc-cccc-cccc-cccc-cccccccccccc')$$)
          LIKE '%moth_history_g_peer_chk%',
  'a shared peer has no owner');
SELECT ok(public.t133_words($$INSERT INTO public.moth_history (workspace_id, entity_type, entity_id, action, state_class, state, state_peer_project_id)
          VALUES ('11111111-1111-1111-1111-111111111111', 'moth_tag_assignments', gen_random_uuid(), 'create', 'workspace', '{"tier": "company"}', 'aaaa1330-0000-0000-0000-00000000000a')$$)
          LIKE '%moth_history_g_peer_chk%',
  'and a peer''s project comes with its class');

-- G14. A capture that fails: the tagging goes in, and the mark of the restart keeps the row's peers (here, the person's
--      own), so the window tells it only to them (G6). The check is swapped for the rest of this transaction only.
RESET ROLE;
ALTER TABLE public.moth_history DROP CONSTRAINT moth_history_b_entity_chk;
ALTER TABLE public.moth_history ADD CONSTRAINT moth_history_b_entity_chk
  CHECK ((action = 'mark_recording' AND entity_type ~ '^[a-z_]{1,63}$')
         OR entity_type IN ('projects', 'phases', 'assets', 'tasks', 'files', 'folders', 'scenes', 'shots', 'levels', 'experiences',
                            'task_items', 'notes', 'moth_tags', 'moth_relationships')) NOT VALID;
SELECT public.t133_c();
SELECT lives_ok($$INSERT INTO public.moth_tag_assignments (id, tag_id, tier, target_type, target_id)
                  VALUES ('13300000-0000-0000-0000-00000000011c', '13300000-0000-0000-0000-0000000001a3', 'personal', 'task', '13300000-0000-0000-0000-000000000061')$$,
  'a tagging goes in though its capture fails');
SELECT is((SELECT h.state_project_id::text || ' ' || h.state_class || ' ' || h.state_peer_class || ' ' || h.state_peer_owner_id::text
             FROM public.moth_history h
            WHERE h.workspace_id = '11111111-1111-1111-1111-111111111111' AND h.action = 'mark_recording' AND h.mark_kind = 'capture_failed'
              AND h.entity_type = 'moth_tag_assignments' ORDER BY h.id DESC LIMIT 1),
  'aaaa1330-0000-0000-0000-00000000000a shared personal cccccccc-cccc-cccc-cccc-cccccccccccc', 'and its mark keeps the row''s side and its peer');

SELECT * FROM finish();
ROLLBACK;
