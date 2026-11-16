-- =============================================================================
-- 132_moth_mention_reservations.sql — M.O.T.H. Session 3 (MO3): the keys a picker reserves (0127 §2, §4).
--
-- A. Structure: forced row security and no policy at all; no client reads or writes a reservation.
-- B. A reservation is its maker's, for a thing they see, with an opaque key of twelve hex digits.
-- C. At most 500 waiting a person; those past their day go as new ones are made; a key a field has used is that
--    field's, kept past its day; the 500 are every key of the day, kept or not (round A, its second look).
-- D. The token's form, as the text triggers read it.
-- =============================================================================

BEGIN;
SELECT plan(21);

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
CREATE FUNCTION public.t132_as(p_user uuid, p_role text, p_ws uuid DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_role))::text, true);
END;
$f$;
CREATE FUNCTION public.t132_a() RETURNS void LANGUAGE sql AS $f$ SELECT public.t132_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin') $f$;
CREATE FUNCTION public.t132_b() RETURNS void LANGUAGE sql AS $f$ SELECT public.t132_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222') $f$;
CREATE FUNCTION public.t132_c() RETURNS void LANGUAGE sql AS $f$ SELECT public.t132_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user') $f$;
CREATE FUNCTION public.t132_d() RETURNS void LANGUAGE sql AS $f$ SELECT public.t132_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager') $f$;
CREATE FUNCTION public.t132_e() RETURNS void LANGUAGE sql AS $f$ SELECT public.t132_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user') $f$;
CREATE FUNCTION public.t132_r() RETURNS void LANGUAGE sql AS $f$ SELECT public.t132_as('99999999-9999-9999-9999-999999999999', 'user') $f$;
CREATE FUNCTION public.t132_n() RETURNS void LANGUAGE sql AS $f$ SELECT public.t132_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'user') $f$;
-- The SQLSTATE a statement is refused with, or 'no refusal'.
CREATE FUNCTION public.t132_err(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
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
CREATE FUNCTION public.t132_words(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'no refusal';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$f$;

-- A tag's id by its label and owner (NULL for the company's), as the database sees it.
CREATE FUNCTION public.t132_tag(p_label text, p_owner uuid DEFAULT NULL) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $f$
  SELECT id FROM public.moth_tags WHERE label = p_label AND owner_id IS NOT DISTINCT FROM p_owner ORDER BY created_at, id LIMIT 1
$f$;
GRANT EXECUTE ON FUNCTION public.t132_tag(text, uuid) TO authenticated;

-- P and Q shared, X user_c's private project, S user_e's personal space; each with a few things.
SELECT public.t132_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1320-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Salt Hours', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1320-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Second', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL);
SELECT public.t132_c();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1320-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Private', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true, NULL);
SELECT public.t132_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1320-0000-0000-0000-0000000000e0', '11111111-1111-1111-1111-111111111111', 'Personal space', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1320-0000-0000-0000-00000000000a', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1320-0000-0000-0000-00000000000a', '99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'reviewer')
ON CONFLICT DO NOTHING;
INSERT INTO public.assets (id, project_id, name) VALUES
  ('13200000-0000-0000-0000-000000000051', 'aaaa1320-0000-0000-0000-00000000000a', 'Mira'),
  ('13200000-0000-0000-0000-000000000052', 'aaaa1320-0000-0000-0000-00000000000b', 'Elsewhere'),
  ('13200000-0000-0000-0000-0000000000e1', 'aaaa1320-0000-0000-0000-0000000000e0', 'Pitch');
INSERT INTO public.tasks (id, project_id, title) VALUES
  ('13200000-0000-0000-0000-000000000061', 'aaaa1320-0000-0000-0000-00000000000a', 'Grade the harbour');
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial) VALUES
  ('13200000-0000-0000-0000-000000000081', 'aaaa1320-0000-0000-0000-00000000000a', 'mira.png', 'supabase', 'projects/aaaa1320-0000-0000-0000-00000000000a/files/13200000-0000-0000-0000-000000000081/mira.png', false),
  ('13200000-0000-0000-0000-000000000082', 'aaaa1320-0000-0000-0000-00000000000a', 'fee.pdf', 'supabase', 'projects/aaaa1320-0000-0000-0000-00000000000a/files/13200000-0000-0000-0000-000000000082/fee.pdf', true),
  ('13200000-0000-0000-0000-0000000000e2', 'aaaa1320-0000-0000-0000-0000000000e0', 'pitch.png', 'supabase', 'projects/aaaa1320-0000-0000-0000-0000000000e0/files/13200000-0000-0000-0000-0000000000e2/pitch.png', false);
SELECT public.t132_c();
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial) VALUES
  ('13200000-0000-0000-0000-0000000000c1', 'aaaa1320-0000-0000-0000-00000000000c', 'secret.png', 'supabase', 'projects/aaaa1320-0000-0000-0000-00000000000c/files/13200000-0000-0000-0000-0000000000c1/secret.png', false);
-- user_n leaves once everything is made.
UPDATE public.workspace_members SET is_active = false
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

-- ── A. Structure ────────────────────────────────────────────────────────────
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.moth_mention_reservations'::regclass), 'row security is forced');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE tablename = 'moth_mention_reservations'), 0, 'and no policy: no client is let in');
SELECT ok(NOT has_table_privilege('authenticated', 'public.moth_mention_reservations', 'SELECT')
          AND NOT has_table_privilege('authenticated', 'public.moth_mention_reservations', 'INSERT')
          AND NOT has_table_privilege('authenticated', 'public.moth_mention_reservations', 'DELETE')
          AND NOT has_table_privilege('anon', 'public.moth_mention_reservations', 'SELECT'),
  'no client holds a privilege on it');
SELECT ok(NOT has_function_privilege('authenticated', 'rabbit_private.moth_mentions_apply(uuid,text,uuid,text,text[])', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'rabbit_private.moth_mention_keys(text)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.moth_mention_reserve(text,uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.moth_mention_reserve(text,uuid)', 'EXECUTE'),
  'a signed-in person reserves; the reading and the applying are the server''s');

-- ── B. A reservation ────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t132_c();
SELECT set_config('t132.k', public.moth_mention_reserve('asset', '13200000-0000-0000-0000-000000000051'), true);
SELECT is(public.t132_err($$SELECT * FROM public.moth_mention_reservations$$), '42501', 'its maker reads no reservation, not even their own');
RESET ROLE;
SELECT is((SELECT created_by::text || ':' || dest_type || ':' || right(dest_id::text, 3) FROM public.moth_mention_reservations
            WHERE mention_key = current_setting('t132.k')),
  'cccccccc-cccc-cccc-cccc-cccccccccccc:asset:051', 'it holds whose it is and the thing, under an opaque key');
SELECT ok(current_setting('t132.k') ~ '^[0-9a-f]{12}$'
          AND position(current_setting('t132.k') IN replace('13200000-0000-0000-0000-000000000051', '-', '')) = 0,
  'twelve hex digits that are not the thing''s id');
SELECT is(public.t132_err($$INSERT INTO public.moth_mention_reservations (mention_key, workspace_id, created_by, dest_type, dest_id)
          VALUES ('NOTHEX123456', '11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'asset', '13200000-0000-0000-0000-000000000051')$$),
  '23514', 'a key is twelve lower-case hex digits');
SELECT is(public.t132_err($$INSERT INTO public.moth_mention_reservations (mention_key, workspace_id, created_by, dest_type, dest_id)
          VALUES ('aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'mtag', '13200000-0000-0000-0000-000000000051')$$),
  '23514', 'for a kind a link may join');

-- ── C. Bounds ───────────────────────────────────────────────────────────────
INSERT INTO public.moth_mention_reservations (mention_key, workspace_id, created_by, dest_type, dest_id)
SELECT lpad(to_hex(g), 12, '0'), '11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'asset', '13200000-0000-0000-0000-000000000051'
  FROM generate_series(1, 499) g;
SET LOCAL ROLE authenticated;
SELECT public.t132_c();
SELECT throws_ok($$SELECT public.moth_mention_reserve('asset', '13200000-0000-0000-0000-000000000051')$$, '54000', NULL,
  'at most 500 keys wait for a person''s save');
RESET ROLE;
UPDATE public.moth_mention_reservations SET created_at = now() - interval '2 days' WHERE created_by = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
SET LOCAL ROLE authenticated;
SELECT public.t132_e();
SELECT ok(public.moth_mention_reserve('asset', '13200000-0000-0000-0000-000000000051') IS NOT NULL, 'another person reserves');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.moth_mention_reservations WHERE created_by = 'cccccccc-cccc-cccc-cccc-cccccccccccc'), 0,
  'and those past their day are gone');
-- Keys fields have used: each person's 500 a day count them, saved or not; old ones count for nothing and stay.
INSERT INTO public.moth_mention_reservations (mention_key, workspace_id, created_by, dest_type, dest_id, created_at,
                                              used_kind, used_id, used_field, used_at)
SELECT lpad(to_hex(g + 4096), 12, '0'), '11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'asset', '13200000-0000-0000-0000-000000000051', now(),
       'task', '13200000-0000-0000-0000-000000000061', 'description', now()
  FROM generate_series(1, 500) g;
SET LOCAL ROLE authenticated;
SELECT public.t132_c();
SELECT throws_ok($$SELECT public.moth_mention_reserve('asset', '13200000-0000-0000-0000-000000000051')$$, '54000', NULL,
  'every key made in the last day counts, kept by a field or not: 500 a day at most');
RESET ROLE;
UPDATE public.moth_mention_reservations SET created_at = now() - interval '40 days', used_at = now() - interval '40 days'
 WHERE created_by = 'cccccccc-cccc-cccc-cccc-cccccccccccc' AND used_kind IS NOT NULL;
SET LOCAL ROLE authenticated;
SELECT public.t132_c();
SELECT ok(public.moth_mention_reserve('asset', '13200000-0000-0000-0000-000000000051') IS NOT NULL, 'keys made long ago, kept by their fields, count for nothing');
SELECT public.t132_e();
SELECT ok(public.moth_mention_reserve('asset', '13200000-0000-0000-0000-000000000051') IS NOT NULL, 'and another person''s reservation clears only waiting keys');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.moth_mention_reservations WHERE created_by = 'cccccccc-cccc-cccc-cccc-cccccccccccc' AND used_kind IS NOT NULL), 500,
  'every key a field has used stays, however old');
SELECT is(public.t132_err($$INSERT INTO public.moth_mention_reservations (mention_key, workspace_id, created_by, dest_type, dest_id, used_kind)
          VALUES ('bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'asset', '13200000-0000-0000-0000-000000000051', 'task')$$),
  '23514', 'a key is a field''s whole, or no field''s');

-- ── D. The token's form ─────────────────────────────────────────────────────
SELECT is(rabbit_private.moth_mention_keys('a [[One|m:0123456789ab]] b [[Two words|m:ba9876543210]] c'), ARRAY['0123456789ab', 'ba9876543210'],
  'each [[words|m:key]] gives its key');
SELECT is(rabbit_private.moth_mention_keys('[[Bad|m:0123456789AB]] [[Short|m:0123]] [[Long|m:0123456789abc]] [[No key]]'), ARRAY[]::text[],
  'and nothing else does: capitals, a short or long key, or no key');
SELECT is(rabbit_private.moth_mention_keys('[[Two' || chr(10) || 'lines|m:0123456789ab]] [[a[b|m:0123456789ab]]'), ARRAY[]::text[],
  'nor words that break a line or hold a bracket');
SELECT is(rabbit_private.moth_mention_keys(NULL), ARRAY[]::text[], 'and no words, no keys');

SELECT * FROM finish();
ROLLBACK;
