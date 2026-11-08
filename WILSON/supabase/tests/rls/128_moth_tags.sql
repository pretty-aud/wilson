-- =============================================================================
-- 128_moth_tags.sql — M.O.T.H. Session 3 (MO3): typed tags, the company's and each person's (0126 §3).
--
-- A. Structure: forced row security, four policies, the client's columns (never a tag's tier, owner or what it
--    stands for), no channel.
-- B. A company's tags: a live admin makes, renames (a new revision) and retires them, of a company type; every
--    active member reads them; none is deleted; a member and a manager make or rename none.
-- C. A person's own tags: theirs alone (no admin leg), of a company type or their own; deleted by them, and their
--    assignments with them.
-- D. A type the writer may not use is refused in the words of a type that is not there.
-- E. One live label a type, tier and owner, in moth_tag_norm's form; the words' rules.
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
CREATE FUNCTION public.t128_as(p_user uuid, p_role text, p_ws uuid DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_role))::text, true);
END;
$f$;
CREATE FUNCTION public.t128_a() RETURNS void LANGUAGE sql AS $f$ SELECT public.t128_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin') $f$;
CREATE FUNCTION public.t128_b() RETURNS void LANGUAGE sql AS $f$ SELECT public.t128_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222') $f$;
CREATE FUNCTION public.t128_c() RETURNS void LANGUAGE sql AS $f$ SELECT public.t128_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user') $f$;
CREATE FUNCTION public.t128_d() RETURNS void LANGUAGE sql AS $f$ SELECT public.t128_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager') $f$;
CREATE FUNCTION public.t128_e() RETURNS void LANGUAGE sql AS $f$ SELECT public.t128_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user') $f$;
CREATE FUNCTION public.t128_r() RETURNS void LANGUAGE sql AS $f$ SELECT public.t128_as('99999999-9999-9999-9999-999999999999', 'user') $f$;
CREATE FUNCTION public.t128_n() RETURNS void LANGUAGE sql AS $f$ SELECT public.t128_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'user') $f$;
-- The SQLSTATE a statement is refused with, or 'no refusal'.
CREATE FUNCTION public.t128_err(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
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
CREATE FUNCTION public.t128_words(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'no refusal';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$f$;

-- A tag's id by its label and owner (NULL for the company's), as the database sees it.
CREATE FUNCTION public.t128_tag(p_label text, p_owner uuid DEFAULT NULL) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $f$
  SELECT id FROM public.moth_tags WHERE label = p_label AND owner_id IS NOT DISTINCT FROM p_owner ORDER BY created_at, id LIMIT 1
$f$;
GRANT EXECUTE ON FUNCTION public.t128_tag(text, uuid) TO authenticated;

-- P and Q shared, X user_c's private project, S user_e's personal space; each with a few things.
SELECT public.t128_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1280-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Salt Hours', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1280-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Second', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL);
SELECT public.t128_c();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1280-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Private', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true, NULL);
SELECT public.t128_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1280-0000-0000-0000-0000000000e0', '11111111-1111-1111-1111-111111111111', 'Personal space', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1280-0000-0000-0000-00000000000a', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1280-0000-0000-0000-00000000000a', '99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'reviewer')
ON CONFLICT DO NOTHING;
INSERT INTO public.assets (id, project_id, name) VALUES
  ('12800000-0000-0000-0000-000000000051', 'aaaa1280-0000-0000-0000-00000000000a', 'Mira'),
  ('12800000-0000-0000-0000-000000000052', 'aaaa1280-0000-0000-0000-00000000000b', 'Elsewhere'),
  ('12800000-0000-0000-0000-0000000000e1', 'aaaa1280-0000-0000-0000-0000000000e0', 'Pitch');
INSERT INTO public.tasks (id, project_id, title) VALUES
  ('12800000-0000-0000-0000-000000000061', 'aaaa1280-0000-0000-0000-00000000000a', 'Grade the harbour');
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial) VALUES
  ('12800000-0000-0000-0000-000000000081', 'aaaa1280-0000-0000-0000-00000000000a', 'mira.png', 'supabase', 'projects/aaaa1280-0000-0000-0000-00000000000a/files/12800000-0000-0000-0000-000000000081/mira.png', false),
  ('12800000-0000-0000-0000-000000000082', 'aaaa1280-0000-0000-0000-00000000000a', 'fee.pdf', 'supabase', 'projects/aaaa1280-0000-0000-0000-00000000000a/files/12800000-0000-0000-0000-000000000082/fee.pdf', true),
  ('12800000-0000-0000-0000-0000000000e2', 'aaaa1280-0000-0000-0000-0000000000e0', 'pitch.png', 'supabase', 'projects/aaaa1280-0000-0000-0000-0000000000e0/files/12800000-0000-0000-0000-0000000000e2/pitch.png', false);
SELECT public.t128_c();
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial) VALUES
  ('12800000-0000-0000-0000-0000000000c1', 'aaaa1280-0000-0000-0000-00000000000c', 'secret.png', 'supabase', 'projects/aaaa1280-0000-0000-0000-00000000000c/files/12800000-0000-0000-0000-0000000000c1/secret.png', false);
-- user_n leaves once everything is made.
UPDATE public.workspace_members SET is_active = false
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

SELECT public.t128_a();
INSERT INTO public.moth_tag_types (id, tier, name) VALUES
  ('12800000-0000-0000-0000-0000000000a1', 'company', 'Character'),
  ('12800000-0000-0000-0000-0000000000a2', 'company', 'Location'),
  ('12800000-0000-0000-0000-0000000000a3', 'company', 'Role');
SELECT public.t128_c();
INSERT INTO public.moth_tag_types (id, tier, name) VALUES ('12800000-0000-0000-0000-0000000000c9', 'personal', 'Software');
SELECT public.t128_e();
INSERT INTO public.moth_tag_types (id, tier, name) VALUES ('12800000-0000-0000-0000-0000000000e9', 'personal', 'Mood');
RESET ROLE;

-- ── A. Structure ────────────────────────────────────────────────────────────
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.moth_tags'::regclass), 'row security is forced');
SELECT is((SELECT string_agg(policyname || ':' || cmd, ',' ORDER BY policyname) FROM pg_policies WHERE tablename = 'moth_tags'),
  'moth_tags_delete:DELETE,moth_tags_insert:INSERT,moth_tags_select:SELECT,moth_tags_update:UPDATE', 'four policies, one a verb');
SELECT is((SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.column_privileges
            WHERE table_schema = 'public' AND table_name = 'moth_tags' AND grantee = 'authenticated' AND privilege_type = 'INSERT'),
  'label,tier,type_id', 'a client sends a type, a tier and a label');
SELECT is((SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.column_privileges
            WHERE table_schema = 'public' AND table_name = 'moth_tags' AND grantee = 'authenticated' AND privilege_type = 'UPDATE'),
  'label,retired_at,type_id', 'and changes a label, a type or a retirement: what a tag stands for is the fold''s alone');
SELECT ok(NOT has_table_privilege('anon', 'public.moth_tags', 'SELECT')
          AND NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                           WHERE t.tgrelid = 'public.moth_tags'::regclass AND p.proname LIKE '%broadcast%'),
  'nothing for anon, and on no realtime topic');

-- ── B. A company's tags ─────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t128_a();
SELECT lives_ok($$INSERT INTO public.moth_tags (type_id, tier, label) VALUES ('12800000-0000-0000-0000-0000000000a1', 'company', 'Mira')$$,
  'a live admin makes a company tag of a company type');
SELECT is((SELECT (owner_id IS NULL)::text || ':' || revision::text || ':' || (canonical_id IS NULL)::text FROM public.moth_tags WHERE label = 'Mira'),
  'true:1:true', 'with no owner, at its first revision, standing for itself');
SELECT is(public.t128_err($$INSERT INTO public.moth_tags (type_id, tier, label) VALUES ('12800000-0000-0000-0000-0000000000c9', 'company', 'Blender')$$),
  '23503', 'and none of someone''s own type');
WITH u AS (UPDATE public.moth_tags SET label = 'Mira Lund' WHERE label = 'Mira' RETURNING revision)
SELECT is((SELECT revision FROM u), 2::bigint, 'a rename is a new revision') ;
WITH u AS (UPDATE public.moth_tags SET retired_at = now() WHERE label = 'Mira Lund' RETURNING revision)
SELECT is((SELECT revision FROM u), 2::bigint, 'a retirement is not');
UPDATE public.moth_tags SET retired_at = NULL WHERE label = 'Mira Lund';
WITH d AS (DELETE FROM public.moth_tags WHERE label = 'Mira Lund' RETURNING 1)
SELECT is(count(*)::int, 0, 'no company tag is deleted: it is retired or merged') FROM d;
SELECT is(public.t128_err($$UPDATE public.moth_tags SET canonical_id = NULL WHERE label = 'Mira Lund'$$), '42501',
  'what a tag stands for is no client''s to say');
SELECT is(public.t128_err($$UPDATE public.moth_tags SET tier = 'personal' WHERE label = 'Mira Lund'$$), '42501',
  'nor its tier');
SELECT public.t128_d();
SELECT is(public.t128_err($$INSERT INTO public.moth_tags (type_id, tier, label) VALUES ('12800000-0000-0000-0000-0000000000a1', 'company', 'Jonah')$$),
  '42501', 'a workspace manager makes no company tag');
WITH u AS (UPDATE public.moth_tags SET label = 'by D' WHERE label = 'Mira Lund' RETURNING 1)
SELECT is(count(*)::int, 0, 'nor renames one') FROM u;
SELECT is((SELECT count(*)::int FROM public.moth_tags WHERE tier = 'company'), 1, 'and reads the company''s');
SELECT public.t128_r();
SELECT is((SELECT count(*)::int FROM public.moth_tags WHERE tier = 'company'), 1, 'as does a reviewer');
SELECT public.t128_n();
SELECT is((SELECT count(*)::int FROM public.moth_tags), 0, 'someone who has left reads none');
SELECT public.t128_b();
SELECT is((SELECT count(*)::int FROM public.moth_tags), 0, 'nor does another company');

-- ── C. A person's own tags ──────────────────────────────────────────────────
SELECT public.t128_c();
SELECT lives_ok($$INSERT INTO public.moth_tags (type_id, tier, label) VALUES ('12800000-0000-0000-0000-0000000000c9', 'personal', 'Blender 5.0')$$,
  'a member makes a tag of their own type');
SELECT lives_ok($$INSERT INTO public.moth_tags (type_id, tier, label) VALUES ('12800000-0000-0000-0000-0000000000a1', 'personal', 'Mira')$$,
  'and of a company type');
SELECT is((SELECT owner_id FROM public.moth_tags WHERE label = 'Blender 5.0'), 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
  'whose the database says');
SELECT is(public.t128_err($$INSERT INTO public.moth_tags (type_id, tier, label) VALUES ('12800000-0000-0000-0000-0000000000a1', 'company', 'Jonah')$$),
  '42501', 'and no company tag');
SELECT public.t128_e();
SELECT is((SELECT count(*)::int FROM public.moth_tags WHERE tier = 'personal'), 0, 'another member reads none of them');
SELECT lives_ok($$INSERT INTO public.moth_tags (type_id, tier, label) VALUES ('12800000-0000-0000-0000-0000000000a1', 'personal', 'Mira')$$,
  'and may have a "Mira" of their own: two people''s tags never collide');
SELECT public.t128_a();
SELECT is((SELECT count(*)::int FROM public.moth_tags WHERE tier = 'personal'), 0, 'an admin reads no one''s own tags: no admin leg');
WITH d AS (DELETE FROM public.moth_tags WHERE id = public.t128_tag('Blender 5.1', 'cccccccc-cccc-cccc-cccc-cccccccccccc') RETURNING 1)
SELECT is(count(*)::int, 0, 'nor deletes one') FROM d;
SELECT public.t128_c();
WITH u AS (UPDATE public.moth_tags SET label = 'Blender 5.1' WHERE id = public.t128_tag('Blender 5.0', 'cccccccc-cccc-cccc-cccc-cccccccccccc') RETURNING 1)
SELECT is(count(*)::int, 1, 'its owner renames it') FROM u;
RESET ROLE;
-- The owner's own assignment of it, so its deletion can be seen to take that too.
SELECT public.t128_c();
SET LOCAL ROLE authenticated;
INSERT INTO public.moth_tag_assignments (tag_id, tier, target_type, target_id)
VALUES (public.t128_tag('Blender 5.1', 'cccccccc-cccc-cccc-cccc-cccccccccccc'), 'personal', 'asset', '12800000-0000-0000-0000-000000000051');
WITH d AS (DELETE FROM public.moth_tags WHERE id = public.t128_tag('Blender 5.1', 'cccccccc-cccc-cccc-cccc-cccccccccccc') RETURNING 1)
SELECT is(count(*)::int, 1, 'and deletes it') FROM d;
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.moth_tag_assignments WHERE target_id = '12800000-0000-0000-0000-000000000051'), 0,
  '… and its assignments go with it');

-- ── D. A type the writer may not use ────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t128_c();
SELECT is(public.t128_words($$INSERT INTO public.moth_tags (type_id, tier, label) VALUES ('12800000-0000-0000-0000-0000000000e9', 'personal', 'Calm')$$),
  'insert or update on table "moth_tags" violates foreign key constraint "moth_tags_type_fk"',
  'someone else''s type is refused in the words of a type that is not there');
SELECT is(public.t128_words($$INSERT INTO public.moth_tags (type_id, tier, label) VALUES ('12800000-0000-0000-0000-00000000dead', 'personal', 'Calm')$$),
  'insert or update on table "moth_tags" violates foreign key constraint "moth_tags_type_fk"',
  'which are these');
RESET ROLE;
UPDATE public.moth_tag_types SET retired_at = now() WHERE id = '12800000-0000-0000-0000-0000000000a2';
SET LOCAL ROLE authenticated;
SELECT public.t128_a();
SELECT is(public.t128_err($$INSERT INTO public.moth_tags (type_id, tier, label) VALUES ('12800000-0000-0000-0000-0000000000a2', 'company', 'Harbour')$$),
  '23503', 'and so is a retired type');
SELECT is(public.t128_err($$UPDATE public.moth_tags SET type_id = '12800000-0000-0000-0000-0000000000c9' WHERE label = 'Mira Lund' AND tier = 'company'$$),
  '23503', 'a company tag moved to someone''s own type is refused the same way');

-- ── E. One live label a type, tier and owner ────────────────────────────────
SELECT is(public.t128_err($$INSERT INTO public.moth_tags (type_id, tier, label) VALUES ('12800000-0000-0000-0000-0000000000a1', 'company', 'MIRA LUND')$$),
  '23505', 'one live company label a type, whatever its case');
SELECT lives_ok($$INSERT INTO public.moth_tags (type_id, tier, label) VALUES ('12800000-0000-0000-0000-0000000000a3', 'company', 'Mira Lund')$$,
  'the same label of another type is another tag');
SELECT is(public.t128_err($$INSERT INTO public.moth_tags (type_id, tier, label) VALUES ('12800000-0000-0000-0000-0000000000a1', 'company', ' padded')$$), '23514', 'a label is trimmed');
SELECT is(public.t128_err(format($$INSERT INTO public.moth_tags (type_id, tier, label) VALUES ('12800000-0000-0000-0000-0000000000a1', 'company', %L)$$, repeat('x', 81))), '23514', 'of at most 80');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.moth_tags WHERE label = 'Mira'), 2, 'two people''s own "Mira", stored apart');

SELECT * FROM finish();
ROLLBACK;
