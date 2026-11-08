-- =============================================================================
-- 127_moth_tag_types.sql — M.O.T.H. Session 3 (MO3): a tag's type, its shape and its colour (0126 §2).
--
-- A. Structure: forced row security, four policies, the client's columns, no channel.
-- B. A company's types: its live admins make, rename and retire them; every active member reads them; a manager,
--    a member, someone who has left and another company do not make or read them; none is deleted.
-- C. A person's own types: theirs alone, no admin leg; made, renamed and deleted by them.
-- D. The words and the marks: a name trimmed, at most 60, one live name a tier and owner in moth_tag_norm's form;
--    the shapes and colours the graph draws.
--
-- Personas as suite 125's: user_a admin, user_c a member, user_d a workspace manager, user_e a member, user_r a
-- reviewer, user_n has left, user_b the other company's admin.
-- =============================================================================

BEGIN;
SELECT plan(39);

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
CREATE FUNCTION public.t127_as(p_user uuid, p_role text, p_ws uuid DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_role))::text, true);
END;
$f$;
CREATE FUNCTION public.t127_a() RETURNS void LANGUAGE sql AS $f$ SELECT public.t127_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin') $f$;
CREATE FUNCTION public.t127_b() RETURNS void LANGUAGE sql AS $f$ SELECT public.t127_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222') $f$;
CREATE FUNCTION public.t127_c() RETURNS void LANGUAGE sql AS $f$ SELECT public.t127_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user') $f$;
CREATE FUNCTION public.t127_d() RETURNS void LANGUAGE sql AS $f$ SELECT public.t127_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager') $f$;
CREATE FUNCTION public.t127_e() RETURNS void LANGUAGE sql AS $f$ SELECT public.t127_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user') $f$;
CREATE FUNCTION public.t127_r() RETURNS void LANGUAGE sql AS $f$ SELECT public.t127_as('99999999-9999-9999-9999-999999999999', 'user') $f$;
CREATE FUNCTION public.t127_n() RETURNS void LANGUAGE sql AS $f$ SELECT public.t127_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'user') $f$;
-- The SQLSTATE a statement is refused with, or 'no refusal'.
CREATE FUNCTION public.t127_err(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
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
CREATE FUNCTION public.t127_words(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'no refusal';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$f$;

-- A tag's id by its label and owner (NULL for the company's), as the database sees it.
CREATE FUNCTION public.t127_tag(p_label text, p_owner uuid DEFAULT NULL) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $f$
  SELECT id FROM public.moth_tags WHERE label = p_label AND owner_id IS NOT DISTINCT FROM p_owner ORDER BY created_at, id LIMIT 1
$f$;
GRANT EXECUTE ON FUNCTION public.t127_tag(text, uuid) TO authenticated;

-- P and Q shared, X user_c's private project, S user_e's personal space; each with a few things.
SELECT public.t127_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1270-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Salt Hours', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1270-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Second', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL);
SELECT public.t127_c();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1270-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Private', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true, NULL);
SELECT public.t127_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1270-0000-0000-0000-0000000000e0', '11111111-1111-1111-1111-111111111111', 'Personal space', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1270-0000-0000-0000-00000000000a', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1270-0000-0000-0000-00000000000a', '99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'reviewer')
ON CONFLICT DO NOTHING;
INSERT INTO public.assets (id, project_id, name) VALUES
  ('12700000-0000-0000-0000-000000000051', 'aaaa1270-0000-0000-0000-00000000000a', 'Mira'),
  ('12700000-0000-0000-0000-000000000052', 'aaaa1270-0000-0000-0000-00000000000b', 'Elsewhere'),
  ('12700000-0000-0000-0000-0000000000e1', 'aaaa1270-0000-0000-0000-0000000000e0', 'Pitch');
INSERT INTO public.tasks (id, project_id, title) VALUES
  ('12700000-0000-0000-0000-000000000061', 'aaaa1270-0000-0000-0000-00000000000a', 'Grade the harbour');
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial) VALUES
  ('12700000-0000-0000-0000-000000000081', 'aaaa1270-0000-0000-0000-00000000000a', 'mira.png', 'supabase', 'projects/aaaa1270-0000-0000-0000-00000000000a/files/12700000-0000-0000-0000-000000000081/mira.png', false),
  ('12700000-0000-0000-0000-000000000082', 'aaaa1270-0000-0000-0000-00000000000a', 'fee.pdf', 'supabase', 'projects/aaaa1270-0000-0000-0000-00000000000a/files/12700000-0000-0000-0000-000000000082/fee.pdf', true),
  ('12700000-0000-0000-0000-0000000000e2', 'aaaa1270-0000-0000-0000-0000000000e0', 'pitch.png', 'supabase', 'projects/aaaa1270-0000-0000-0000-0000000000e0/files/12700000-0000-0000-0000-0000000000e2/pitch.png', false);
SELECT public.t127_c();
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial) VALUES
  ('12700000-0000-0000-0000-0000000000c1', 'aaaa1270-0000-0000-0000-00000000000c', 'secret.png', 'supabase', 'projects/aaaa1270-0000-0000-0000-00000000000c/files/12700000-0000-0000-0000-0000000000c1/secret.png', false);
-- user_n leaves once everything is made.
UPDATE public.workspace_members SET is_active = false
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

-- ── A. Structure ────────────────────────────────────────────────────────────
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.moth_tag_types'::regclass), 'row security is forced');
SELECT is((SELECT string_agg(policyname || ':' || cmd, ',' ORDER BY policyname) FROM pg_policies WHERE tablename = 'moth_tag_types'),
  'moth_tag_types_delete:DELETE,moth_tag_types_insert:INSERT,moth_tag_types_select:SELECT,moth_tag_types_update:UPDATE', 'four policies, one a verb');
SELECT is((SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.column_privileges
            WHERE table_schema = 'public' AND table_name = 'moth_tag_types' AND grantee = 'authenticated' AND privilege_type = 'INSERT'),
  'colour,name,shape,tier', 'a client sends a tier, a name, a shape and a colour, and the database says whose and which company''s');
SELECT is((SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.column_privileges
            WHERE table_schema = 'public' AND table_name = 'moth_tag_types' AND grantee = 'authenticated' AND privilege_type = 'UPDATE'),
  'colour,name,retired_at,shape', 'and changes a name, a shape, a colour or a retirement, never the tier or the owner');
SELECT ok(NOT has_table_privilege('anon', 'public.moth_tag_types', 'SELECT')
          AND NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                           WHERE t.tgrelid = 'public.moth_tag_types'::regclass AND p.proname LIKE '%broadcast%'),
  'nothing for anon, and on no realtime topic');

-- ── B. A company's types ────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t127_a();
SELECT lives_ok($$INSERT INTO public.moth_tag_types (tier, name, shape, colour) VALUES ('company', 'Character', 'diamond', 'rose')$$,
  'a live admin makes a company type');
SELECT is((SELECT (owner_id IS NULL)::text || ':' || workspace_id::text FROM public.moth_tag_types WHERE name = 'Character'),
  'true:11111111-1111-1111-1111-111111111111', 'with no owner, in the admin''s company');
SELECT is(public.t127_err($$INSERT INTO public.moth_tag_types (tier, name) VALUES ('company', 'character')$$), '23505',
  'one live company type a name, in moth_tag_norm''s form');
SELECT public.t127_d();
SELECT is(public.t127_err($$INSERT INTO public.moth_tag_types (tier, name) VALUES ('company', 'Location')$$), '42501',
  'a workspace manager makes no company type');
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', jsonb_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin'))::text, true);
SELECT is(public.t127_err($$INSERT INTO public.moth_tag_types (tier, name) VALUES ('company', 'Location')$$), '42501',
  'nor a member whose token says admin: the membership row decides (round A)');
SELECT public.t127_d();
SELECT is((SELECT count(*)::int FROM public.moth_tag_types WHERE name = 'Character'), 1, 'and reads the company''s');
WITH u AS (UPDATE public.moth_tag_types SET name = 'Persona' WHERE name = 'Character' RETURNING 1)
SELECT is(count(*)::int, 0, 'and renames none') FROM u;
SELECT public.t127_c();
SELECT is(public.t127_err($$INSERT INTO public.moth_tag_types (tier, name) VALUES ('company', 'Location')$$), '42501',
  'nor does a member');
SELECT is((SELECT count(*)::int FROM public.moth_tag_types WHERE name = 'Character'), 1, 'who reads it too');
SELECT public.t127_n();
SELECT is((SELECT count(*)::int FROM public.moth_tag_types), 0, 'someone who has left reads none');
SELECT public.t127_b();
SELECT is((SELECT count(*)::int FROM public.moth_tag_types), 0, 'nor does another company');
SELECT public.t127_a();
WITH u AS (UPDATE public.moth_tag_types SET name = 'Characters', shape = 'star' WHERE name = 'Character' RETURNING 1)
SELECT is(count(*)::int, 1, 'the admin renames and reshapes it') FROM u;
WITH d AS (DELETE FROM public.moth_tag_types WHERE name = 'Characters' RETURNING 1)
SELECT is(count(*)::int, 0, 'and deletes no company type: one is retired, since someone''s own tag may be of it') FROM d;
WITH u AS (UPDATE public.moth_tag_types SET retired_at = now() WHERE name = 'Characters' RETURNING 1)
SELECT is(count(*)::int, 1, 'retired') FROM u;
SELECT lives_ok($$INSERT INTO public.moth_tag_types (tier, name) VALUES ('company', 'characters')$$,
  'and a retired name may be taken again');
SELECT is(public.t127_err($$UPDATE public.moth_tag_types SET tier = 'personal' WHERE name = 'characters'$$), '42501',
  'a type''s tier is no client''s to change');

-- ── C. A person's own types ─────────────────────────────────────────────────
SELECT public.t127_c();
SELECT lives_ok($$INSERT INTO public.moth_tag_types (tier, name, shape) VALUES ('personal', 'Software', 'hexagon')$$,
  'a member makes a type of their own');
SELECT is((SELECT owner_id FROM public.moth_tag_types WHERE name = 'Software'), 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
  'whose the database says');
SELECT lives_ok($$INSERT INTO public.moth_tag_types (tier, name) VALUES ('personal', 'characters')$$,
  'a person''s own may share a name with the company''s');
SELECT is(public.t127_err($$INSERT INTO public.moth_tag_types (tier, name, owner_id) VALUES ('personal', 'Forged', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')$$),
  '42501', 'and says nothing of whose: no client sends an owner');
SELECT public.t127_e();
SELECT is((SELECT count(*)::int FROM public.moth_tag_types WHERE tier = 'personal'), 0, 'another member reads none of it');
WITH u AS (UPDATE public.moth_tag_types SET name = 'Mine now' WHERE name = 'Software' RETURNING 1)
SELECT is(count(*)::int, 0, 'nor changes it') FROM u;
SELECT public.t127_a();
SELECT is((SELECT count(*)::int FROM public.moth_tag_types WHERE tier = 'personal'), 0, 'nor does an admin: no admin leg');
WITH d AS (DELETE FROM public.moth_tag_types WHERE name = 'Software' RETURNING 1)
SELECT is(count(*)::int, 0, 'nor deletes it') FROM d;
SELECT public.t127_c();
WITH u AS (UPDATE public.moth_tag_types SET colour = 'teal' WHERE name = 'Software' RETURNING 1)
SELECT is(count(*)::int, 1, 'its owner changes it') FROM u;
WITH d AS (DELETE FROM public.moth_tag_types WHERE name = 'characters' AND tier = 'personal' RETURNING 1)
SELECT is(count(*)::int, 1, 'and deletes it') FROM d;

-- ── D. The words and the marks ──────────────────────────────────────────────
SELECT is(public.t127_err($$INSERT INTO public.moth_tag_types (tier, name) VALUES ('personal', ' padded')$$), '23514', 'a name is trimmed');
SELECT is(public.t127_err($$INSERT INTO public.moth_tag_types (tier, name) VALUES ('personal', repeat('n', 61))$$), '23514', 'of at most 60');
SELECT is(public.t127_err(format($$INSERT INTO public.moth_tag_types (tier, name) VALUES ('personal', %L)$$, 'a' || chr(10) || 'b')), '23514',
  'with no control character');
SELECT is(public.t127_err($$INSERT INTO public.moth_tag_types (tier, name) VALUES ('personal', 'SOFTWARE')$$), '23505',
  'one live name a person, whatever its case');
SELECT is(public.t127_err($$INSERT INTO public.moth_tag_types (tier, name, shape) VALUES ('personal', 'Blob', 'blob')$$), '23514',
  'a shape the graph draws');
SELECT is(public.t127_err($$INSERT INTO public.moth_tag_types (tier, name, colour) VALUES ('personal', 'Blob', '#ff0000')$$), '23514',
  'and a colour of its own, never a free one');
SELECT is(public.t127_err($$INSERT INTO public.moth_tag_types (tier, name) VALUES ('team', 'Blob')$$), '42501',
  'and one of the two tiers: any other is no one''s to make');
RESET ROLE;
SELECT is(public.moth_tag_norm(' Ａ　Cast   List '), 'a cast list', 'moth_tag_norm: width, spaces and case fold to one form');

SELECT * FROM finish();
ROLLBACK;
