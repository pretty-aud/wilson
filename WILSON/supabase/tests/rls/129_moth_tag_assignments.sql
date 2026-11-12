-- =============================================================================
-- 129_moth_tag_assignments.sql — M.O.T.H. Session 3 (MO3): a tag on a thing (0126 §4).
--
-- A. Structure: forced row security, three policies (no update), the client's columns, no channel.
-- B. A company assignment: made by those who may change the thing, seen by everyone who sees it; not by a reviewer,
--    nor seen by someone who has left or another company; one a tag and thing.
-- C. A personal assignment: anyone who sees the thing tags it privately, with their own tag or a company one; seen
--    by them alone (no admin leg); whose it is the database says.
-- D. A thing or a tag the writer may not use: refused as one that is not there (money, a private project, someone
--    else's personal space, someone else's tag, a company assignment of a personal tag, a retired tag).
-- E. Removing: a company one by those who may change the thing; a personal one by its owner alone. No update.
-- F. It goes with its thing, and hides while its thing is in the trash.
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
CREATE FUNCTION public.t129_as(p_user uuid, p_role text, p_ws uuid DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_role))::text, true);
END;
$f$;
CREATE FUNCTION public.t129_a() RETURNS void LANGUAGE sql AS $f$ SELECT public.t129_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin') $f$;
CREATE FUNCTION public.t129_b() RETURNS void LANGUAGE sql AS $f$ SELECT public.t129_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222') $f$;
CREATE FUNCTION public.t129_c() RETURNS void LANGUAGE sql AS $f$ SELECT public.t129_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user') $f$;
CREATE FUNCTION public.t129_d() RETURNS void LANGUAGE sql AS $f$ SELECT public.t129_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager') $f$;
CREATE FUNCTION public.t129_e() RETURNS void LANGUAGE sql AS $f$ SELECT public.t129_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user') $f$;
CREATE FUNCTION public.t129_r() RETURNS void LANGUAGE sql AS $f$ SELECT public.t129_as('99999999-9999-9999-9999-999999999999', 'user') $f$;
CREATE FUNCTION public.t129_n() RETURNS void LANGUAGE sql AS $f$ SELECT public.t129_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'user') $f$;
-- The SQLSTATE a statement is refused with, or 'no refusal'.
CREATE FUNCTION public.t129_err(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
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
CREATE FUNCTION public.t129_words(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'no refusal';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$f$;

-- A tag's id by its label and owner (NULL for the company's), as the database sees it.
CREATE FUNCTION public.t129_tag(p_label text, p_owner uuid DEFAULT NULL) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $f$
  SELECT id FROM public.moth_tags WHERE label = p_label AND owner_id IS NOT DISTINCT FROM p_owner ORDER BY created_at, id LIMIT 1
$f$;
GRANT EXECUTE ON FUNCTION public.t129_tag(text, uuid) TO authenticated;

-- P and Q shared, X user_c's private project, S user_e's personal space; each with a few things.
SELECT public.t129_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1290-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Salt Hours', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1290-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Second', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL);
SELECT public.t129_c();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1290-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Private', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true, NULL);
SELECT public.t129_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1290-0000-0000-0000-0000000000e0', '11111111-1111-1111-1111-111111111111', 'Personal space', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1290-0000-0000-0000-00000000000a', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1290-0000-0000-0000-00000000000a', '99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'reviewer')
ON CONFLICT DO NOTHING;
INSERT INTO public.assets (id, project_id, name) VALUES
  ('12900000-0000-0000-0000-000000000051', 'aaaa1290-0000-0000-0000-00000000000a', 'Mira'),
  ('12900000-0000-0000-0000-000000000052', 'aaaa1290-0000-0000-0000-00000000000b', 'Elsewhere'),
  ('12900000-0000-0000-0000-0000000000e1', 'aaaa1290-0000-0000-0000-0000000000e0', 'Pitch');
INSERT INTO public.tasks (id, project_id, title) VALUES
  ('12900000-0000-0000-0000-000000000061', 'aaaa1290-0000-0000-0000-00000000000a', 'Grade the harbour');
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial) VALUES
  ('12900000-0000-0000-0000-000000000081', 'aaaa1290-0000-0000-0000-00000000000a', 'mira.png', 'supabase', 'projects/aaaa1290-0000-0000-0000-00000000000a/files/12900000-0000-0000-0000-000000000081/mira.png', false),
  ('12900000-0000-0000-0000-000000000082', 'aaaa1290-0000-0000-0000-00000000000a', 'fee.pdf', 'supabase', 'projects/aaaa1290-0000-0000-0000-00000000000a/files/12900000-0000-0000-0000-000000000082/fee.pdf', true),
  ('12900000-0000-0000-0000-0000000000e2', 'aaaa1290-0000-0000-0000-0000000000e0', 'pitch.png', 'supabase', 'projects/aaaa1290-0000-0000-0000-0000000000e0/files/12900000-0000-0000-0000-0000000000e2/pitch.png', false);
SELECT public.t129_c();
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial) VALUES
  ('12900000-0000-0000-0000-0000000000c1', 'aaaa1290-0000-0000-0000-00000000000c', 'secret.png', 'supabase', 'projects/aaaa1290-0000-0000-0000-00000000000c/files/12900000-0000-0000-0000-0000000000c1/secret.png', false);
-- user_n leaves once everything is made.
UPDATE public.workspace_members SET is_active = false
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

-- Whole-session round 1: a Legal file (its tag and its path), beside the money one.
SELECT public.t129_a();
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, tags, is_financial) VALUES
  ('12900000-0000-0000-0000-000000000083', 'aaaa1290-0000-0000-0000-00000000000a', 'nda.pdf', 'supabase', 'projects/aaaa1290-0000-0000-0000-00000000000a/legal/a/nda.pdf', '{legal}', false);

-- No one's claims while the fixture tags are made, so the pins keep each owner given here (a signed-in caller's
-- own tag is always the caller's).
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO public.moth_tag_types (id, workspace_id, tier, owner_id, name) VALUES
  ('12900000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'company', NULL, 'Character'),
  ('12900000-0000-0000-0000-0000000000c9', '11111111-1111-1111-1111-111111111111', 'personal', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Software');
INSERT INTO public.moth_tags (id, workspace_id, type_id, tier, owner_id, label, retired_at) VALUES
  ('12900000-0000-0000-0000-000000000101', '11111111-1111-1111-1111-111111111111', '12900000-0000-0000-0000-0000000000a1', 'company', NULL, 'Mira', NULL),
  ('12900000-0000-0000-0000-000000000102', '11111111-1111-1111-1111-111111111111', '12900000-0000-0000-0000-0000000000a1', 'company', NULL, 'Gone', now()),
  ('12900000-0000-0000-0000-0000000001c1', '11111111-1111-1111-1111-111111111111', '12900000-0000-0000-0000-0000000000c9', 'personal', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Blender', NULL),
  ('12900000-0000-0000-0000-0000000001e1', '11111111-1111-1111-1111-111111111111', '12900000-0000-0000-0000-0000000000a1', 'personal', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Mood', NULL),
  ('12900000-0000-0000-0000-000000000191', '11111111-1111-1111-1111-111111111111', '12900000-0000-0000-0000-0000000000a1', 'personal', '99999999-9999-9999-9999-999999999999', 'Look', NULL);

-- ── A. Structure ────────────────────────────────────────────────────────────
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.moth_tag_assignments'::regclass), 'row security is forced');
SELECT is((SELECT string_agg(policyname || ':' || cmd, ',' ORDER BY policyname) FROM pg_policies WHERE tablename = 'moth_tag_assignments'),
  'moth_tag_assignments_delete:DELETE,moth_tag_assignments_insert:INSERT,moth_tag_assignments_select:SELECT', 'three policies, and none to change one');
SELECT is((SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.column_privileges
            WHERE table_schema = 'public' AND table_name = 'moth_tag_assignments' AND grantee = 'authenticated' AND privilege_type = 'INSERT'),
  'tag_id,target_id,target_type,tier', 'a client sends a tag, a thing and a tier; whose it is the database says');
SELECT ok(NOT has_table_privilege('authenticated', 'public.moth_tag_assignments', 'UPDATE')
          AND NOT has_table_privilege('anon', 'public.moth_tag_assignments', 'SELECT'),
  'no client changes an assignment, and anon reads none');
SELECT ok((SELECT count(*) FROM pg_policies WHERE tablename = 'moth_tag_assignments'
            AND COALESCE(qual, '') || COALESCE(with_check, '') ~ 'moth_can_(read|write)_target') = 3
          AND NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                           WHERE t.tgrelid = 'public.moth_tag_assignments'::regclass AND p.proname LIKE '%broadcast%'),
  'every policy asks Moth''s gate, and none is on a realtime topic');

-- ── B. A company assignment ─────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t129_c();
SELECT lives_ok($$INSERT INTO public.moth_tag_assignments (tag_id, tier, target_type, target_id)
                  VALUES ('12900000-0000-0000-0000-000000000101', 'company', 'asset', '12900000-0000-0000-0000-000000000051')$$,
  'a member who may change P tags P''s asset for the company');
SELECT is(public.t129_err($$INSERT INTO public.moth_tag_assignments (tag_id, tier, target_type, target_id)
                  VALUES ('12900000-0000-0000-0000-000000000101', 'company', 'asset', '12900000-0000-0000-0000-000000000051')$$),
  '23505', 'once: one company assignment a tag and thing');
SELECT public.t129_r();
SELECT is((SELECT count(*)::int FROM public.moth_tag_assignments WHERE target_id = '12900000-0000-0000-0000-000000000051' AND tier = 'company'), 1,
  'P''s reviewer sees it');
SELECT is(public.t129_err($$INSERT INTO public.moth_tag_assignments (tag_id, tier, target_type, target_id)
                  VALUES ('12900000-0000-0000-0000-000000000101', 'company', 'task', '12900000-0000-0000-0000-000000000061')$$),
  '42501', 'but makes none: a reviewer may not change P');
SELECT public.t129_n();
SELECT is((SELECT count(*)::int FROM public.moth_tag_assignments), 0, 'someone who has left sees none');
SELECT public.t129_b();
SELECT is((SELECT count(*)::int FROM public.moth_tag_assignments), 0, 'nor does another company');
RESET ROLE;
SELECT is((SELECT (owner_id IS NULL)::text || ':' || created_by::text FROM public.moth_tag_assignments WHERE tier = 'company'),
  'true:cccccccc-cccc-cccc-cccc-cccccccccccc', 'a company assignment has no owner, and says who made it');

-- ── C. A personal assignment ────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t129_r();
SELECT lives_ok($$INSERT INTO public.moth_tag_assignments (tag_id, tier, target_type, target_id)
                  VALUES ('12900000-0000-0000-0000-000000000191', 'personal', 'asset', '12900000-0000-0000-0000-000000000051')$$,
  'a reviewer, who sees P''s asset, tags it privately with their own tag');
SELECT lives_ok($$INSERT INTO public.moth_tag_assignments (tag_id, tier, target_type, target_id)
                  VALUES ('12900000-0000-0000-0000-000000000101', 'personal', 'asset', '12900000-0000-0000-0000-000000000051')$$,
  '… and with a company tag, privately, beside the company''s own');
SELECT is(public.t129_err($$INSERT INTO public.moth_tag_assignments (tag_id, tier, owner_id, target_type, target_id)
                  VALUES ('12900000-0000-0000-0000-000000000191', 'personal', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'task', '12900000-0000-0000-0000-000000000061')$$),
  '42501', 'and no client says whose an assignment is');
SELECT is((SELECT count(*)::int FROM public.moth_tag_assignments WHERE target_id = '12900000-0000-0000-0000-000000000051'), 3,
  'the reviewer sees the company''s assignment and their own two');
SELECT public.t129_c();
SELECT is((SELECT count(*)::int FROM public.moth_tag_assignments WHERE target_id = '12900000-0000-0000-0000-000000000051'), 1,
  'another member sees the company''s alone: a person''s tags never travel with what they tag');
SELECT public.t129_a();
SELECT is((SELECT count(*)::int FROM public.moth_tag_assignments WHERE tier = 'personal'), 0, 'nor does an admin: no admin leg');
RESET ROLE;
SELECT is((SELECT owner_id FROM public.moth_tag_assignments WHERE tag_id = '12900000-0000-0000-0000-000000000191'),
  '99999999-9999-9999-9999-999999999999'::uuid, 'whose a personal assignment is, the database said');

-- ── D. A thing or a tag the writer may not use ──────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t129_c();
SELECT is(public.t129_words($$INSERT INTO public.moth_tag_assignments (tag_id, tier, target_type, target_id)
                  VALUES ('12900000-0000-0000-0000-000000000101', 'company', 'file', '12900000-0000-0000-0000-000000000082')$$),
  'new row violates row-level security policy for table "moth_tag_assignments"', 'a money file is no thing to tag');
SELECT is(public.t129_words($$INSERT INTO public.moth_tag_assignments (tag_id, tier, target_type, target_id)
                  VALUES ('12900000-0000-0000-0000-000000000101', 'company', 'file', '12900000-0000-0000-0000-000000000083')$$),
  'new row violates row-level security policy for table "moth_tag_assignments"', 'nor a Legal file');
SELECT is(public.t129_words($$INSERT INTO public.moth_tag_assignments (tag_id, tier, target_type, target_id)
                  VALUES ('12900000-0000-0000-0000-000000000101', 'company', 'file', '12900000-0000-0000-0000-00000000dead')$$),
  'new row violates row-level security policy for table "moth_tag_assignments"', 'refused as a thing that is not there is');
SELECT is(public.t129_words($$INSERT INTO public.moth_tag_assignments (tag_id, tier, target_type, target_id)
                  VALUES ('12900000-0000-0000-0000-0000000001e1', 'personal', 'asset', '12900000-0000-0000-0000-000000000051')$$),
  'insert or update on table "moth_tag_assignments" violates foreign key constraint "moth_tag_assignments_tag_fk"',
  'someone else''s own tag is refused in the words of a tag that is not there');
SELECT is(public.t129_words($$INSERT INTO public.moth_tag_assignments (tag_id, tier, target_type, target_id)
                  VALUES ('12900000-0000-0000-0000-00000000dead', 'personal', 'asset', '12900000-0000-0000-0000-000000000051')$$),
  'insert or update on table "moth_tag_assignments" violates foreign key constraint "moth_tag_assignments_tag_fk"', 'which are these');
SELECT is(public.t129_err($$INSERT INTO public.moth_tag_assignments (tag_id, tier, target_type, target_id)
                  VALUES ('12900000-0000-0000-0000-0000000001c1', 'company', 'asset', '12900000-0000-0000-0000-000000000051')$$),
  '23503', 'a person''s own tag makes no company assignment');
SELECT is(public.t129_err($$INSERT INTO public.moth_tag_assignments (tag_id, tier, target_type, target_id)
                  VALUES ('12900000-0000-0000-0000-000000000102', 'company', 'task', '12900000-0000-0000-0000-000000000061')$$),
  '23503', 'and a retired tag makes none at all');
SELECT public.t129_d();
SELECT is(public.t129_err($$INSERT INTO public.moth_tag_assignments (tag_id, tier, target_type, target_id)
                  VALUES ('12900000-0000-0000-0000-000000000101', 'personal', 'file', '12900000-0000-0000-0000-0000000000c1')$$),
  '42501', 'a manager tags nothing of someone''s private project, even privately');
SELECT public.t129_a();
SELECT is(public.t129_err($$INSERT INTO public.moth_tag_assignments (tag_id, tier, target_type, target_id)
                  VALUES ('12900000-0000-0000-0000-000000000101', 'company', 'file', '12900000-0000-0000-0000-0000000000e2')$$),
  '42501', 'an admin tags nothing of someone''s personal space');
SELECT public.t129_e();
SELECT lives_ok($$INSERT INTO public.moth_tag_assignments (tag_id, tier, target_type, target_id)
                  VALUES ('12900000-0000-0000-0000-0000000001e1', 'personal', 'file', '12900000-0000-0000-0000-0000000000e2')$$,
  'the owner of that space tags their own file');
SELECT public.t129_a();
SELECT is((SELECT count(*)::int FROM public.moth_tag_assignments WHERE target_id = '12900000-0000-0000-0000-0000000000e2'), 0,
  'and the admin sees none of it');

-- ── E. Removing ─────────────────────────────────────────────────────────────
SELECT public.t129_r();
WITH d AS (DELETE FROM public.moth_tag_assignments WHERE tier = 'company' RETURNING 1)
SELECT is(count(*)::int, 0, 'a reviewer removes no company assignment') FROM d;
SELECT is(public.t129_err($$UPDATE public.moth_tag_assignments SET tag_id = '12900000-0000-0000-0000-000000000101' WHERE tier = 'personal'$$), '42501',
  'and no one changes one: it is removed and made again');
SELECT public.t129_a();
WITH d AS (DELETE FROM public.moth_tag_assignments WHERE tag_id = '12900000-0000-0000-0000-000000000191' RETURNING 1)
SELECT is(count(*)::int, 0, 'an admin removes no one''s personal assignment') FROM d;
SELECT public.t129_r();
WITH d AS (DELETE FROM public.moth_tag_assignments WHERE tag_id = '12900000-0000-0000-0000-000000000191' RETURNING 1)
SELECT is(count(*)::int, 1, 'its owner does') FROM d;
SELECT public.t129_c();
WITH d AS (DELETE FROM public.moth_tag_assignments WHERE tier = 'company' AND target_id = '12900000-0000-0000-0000-000000000051' RETURNING 1)
SELECT is(count(*)::int, 1, 'a member who may change P removes the company''s') FROM d;

-- ── F. With its thing ───────────────────────────────────────────────────────
SELECT lives_ok($$INSERT INTO public.moth_tag_assignments (tag_id, tier, target_type, target_id)
                  VALUES ('12900000-0000-0000-0000-000000000101', 'company', 'file', '12900000-0000-0000-0000-000000000081')$$,
  'a file of P tagged');
RESET ROLE;
UPDATE public.files SET deleted_at = now() WHERE id = '12900000-0000-0000-0000-000000000081';
SET LOCAL ROLE authenticated;
SELECT public.t129_c();
SELECT is((SELECT count(*)::int FROM public.moth_tag_assignments WHERE target_id = '12900000-0000-0000-0000-000000000081'), 0,
  'its assignment hides while the file is in the trash');
RESET ROLE;
UPDATE public.files SET deleted_at = NULL WHERE id = '12900000-0000-0000-0000-000000000081';
SET LOCAL ROLE authenticated;
SELECT public.t129_c();
SELECT is((SELECT count(*)::int FROM public.moth_tag_assignments WHERE target_id = '12900000-0000-0000-0000-000000000081'), 1,
  'and shows again when it comes back');
RESET ROLE;
DELETE FROM public.assets WHERE id = '12900000-0000-0000-0000-000000000051';
SELECT is((SELECT count(*)::int FROM public.moth_tag_assignments WHERE target_id = '12900000-0000-0000-0000-000000000051'), 0,
  'an asset deleted takes its assignments, the reviewer''s private one included');

SELECT * FROM finish();
ROLLBACK;
