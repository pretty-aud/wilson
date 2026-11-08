-- =============================================================================
-- 130_moth_tag_nominations.sql — M.O.T.H. Session 3 (MO3): putting a tag forward, the admins' decision, the fold
-- and the merge (0126 §5, §6), and Moth's gate for a typed tag (§7).
--
-- A. Structure: forced row security, one policy (reading), no client write; who may call what.
-- B. Putting a tag forward: one's own live tag only, once, with a note of at most 1,000; the words consented to.
-- C. Reading: the proposer's own, and every one to the company's live admins.
-- D. Deciding: a live admin only, never a manager; a rejection with its note.
-- E. Approving: the company tag (of the company type of that name) made or named, and every person's own tag of the
--    same label and type name folded into it, exact matches only; each owner's assignments repointed and still theirs
--    alone; the other open nominations of it approved too; a folded tag's place goes to the company tag's dot.
-- F. Withdrawing: the proposer's, while open.
-- G. Merging two company tags: a live admin only; assignments repointed (one already there stays one); a person's
--    private use of the merged tag follows it and stays theirs.
-- H. Moth's gate for a typed tag: a person's own to them alone, the company's to its members, a folded one to no one.
-- =============================================================================

BEGIN;
SELECT plan(55);

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
CREATE FUNCTION public.t130_as(p_user uuid, p_role text, p_ws uuid DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_role))::text, true);
END;
$f$;
CREATE FUNCTION public.t130_a() RETURNS void LANGUAGE sql AS $f$ SELECT public.t130_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin') $f$;
CREATE FUNCTION public.t130_b() RETURNS void LANGUAGE sql AS $f$ SELECT public.t130_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222') $f$;
CREATE FUNCTION public.t130_c() RETURNS void LANGUAGE sql AS $f$ SELECT public.t130_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user') $f$;
CREATE FUNCTION public.t130_d() RETURNS void LANGUAGE sql AS $f$ SELECT public.t130_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'manager') $f$;
CREATE FUNCTION public.t130_e() RETURNS void LANGUAGE sql AS $f$ SELECT public.t130_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user') $f$;
CREATE FUNCTION public.t130_r() RETURNS void LANGUAGE sql AS $f$ SELECT public.t130_as('99999999-9999-9999-9999-999999999999', 'user') $f$;
CREATE FUNCTION public.t130_n() RETURNS void LANGUAGE sql AS $f$ SELECT public.t130_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'user') $f$;
-- The SQLSTATE a statement is refused with, or 'no refusal'.
CREATE FUNCTION public.t130_err(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
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
CREATE FUNCTION public.t130_words(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'no refusal';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$f$;

-- A tag's id by its label and owner (NULL for the company's), as the database sees it.
CREATE FUNCTION public.t130_tag(p_label text, p_owner uuid DEFAULT NULL) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $f$
  SELECT id FROM public.moth_tags WHERE label = p_label AND owner_id IS NOT DISTINCT FROM p_owner ORDER BY created_at, id LIMIT 1
$f$;
GRANT EXECUTE ON FUNCTION public.t130_tag(text, uuid) TO authenticated;

-- P and Q shared, X user_c's private project, S user_e's personal space; each with a few things.
SELECT public.t130_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1300-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Salt Hours', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL),
  ('aaaa1300-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Second', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL);
SELECT public.t130_c();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1300-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Private', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true, NULL);
SELECT public.t130_a();
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private, personal_owner_id) VALUES
  ('aaaa1300-0000-0000-0000-0000000000e0', '11111111-1111-1111-1111-111111111111', 'Personal space', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role) VALUES
  ('aaaa1300-0000-0000-0000-00000000000a', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1300-0000-0000-0000-00000000000a', '99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'reviewer')
ON CONFLICT DO NOTHING;
INSERT INTO public.assets (id, project_id, name) VALUES
  ('13000000-0000-0000-0000-000000000051', 'aaaa1300-0000-0000-0000-00000000000a', 'Mira'),
  ('13000000-0000-0000-0000-000000000052', 'aaaa1300-0000-0000-0000-00000000000b', 'Elsewhere'),
  ('13000000-0000-0000-0000-0000000000e1', 'aaaa1300-0000-0000-0000-0000000000e0', 'Pitch');
INSERT INTO public.tasks (id, project_id, title) VALUES
  ('13000000-0000-0000-0000-000000000061', 'aaaa1300-0000-0000-0000-00000000000a', 'Grade the harbour');
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial) VALUES
  ('13000000-0000-0000-0000-000000000081', 'aaaa1300-0000-0000-0000-00000000000a', 'mira.png', 'supabase', 'projects/aaaa1300-0000-0000-0000-00000000000a/files/13000000-0000-0000-0000-000000000081/mira.png', false),
  ('13000000-0000-0000-0000-000000000082', 'aaaa1300-0000-0000-0000-00000000000a', 'fee.pdf', 'supabase', 'projects/aaaa1300-0000-0000-0000-00000000000a/files/13000000-0000-0000-0000-000000000082/fee.pdf', true),
  ('13000000-0000-0000-0000-0000000000e2', 'aaaa1300-0000-0000-0000-0000000000e0', 'pitch.png', 'supabase', 'projects/aaaa1300-0000-0000-0000-0000000000e0/files/13000000-0000-0000-0000-0000000000e2/pitch.png', false);
SELECT public.t130_c();
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial) VALUES
  ('13000000-0000-0000-0000-0000000000c1', 'aaaa1300-0000-0000-0000-00000000000c', 'secret.png', 'supabase', 'projects/aaaa1300-0000-0000-0000-00000000000c/files/13000000-0000-0000-0000-0000000000c1/secret.png', false);
-- user_n leaves once everything is made.
UPDATE public.workspace_members SET is_active = false
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

-- No one's claims while the fixtures are made, so each owner given here stands.
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO public.moth_tag_types (id, workspace_id, tier, owner_id, name, shape, colour) VALUES
  ('13000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'company', NULL, 'Character', 'circle', 'mist'),
  ('13000000-0000-0000-0000-0000000000c9', '11111111-1111-1111-1111-111111111111', 'personal', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'character', 'diamond', 'rose'),
  ('13000000-0000-0000-0000-000000000099', '11111111-1111-1111-1111-111111111111', 'personal', '99999999-9999-9999-9999-999999999999', 'Location', 'square', 'sky'),
  ('13000000-0000-0000-0000-0000000000c8', '11111111-1111-1111-1111-111111111111', 'personal', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Places', 'star', 'rose');
INSERT INTO public.moth_tags (id, workspace_id, type_id, tier, owner_id, label) VALUES
  ('13000000-0000-0000-0000-0000000001c1', '11111111-1111-1111-1111-111111111111', '13000000-0000-0000-0000-0000000000c9', 'personal', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Mira'),
  ('13000000-0000-0000-0000-0000000001c2', '11111111-1111-1111-1111-111111111111', '13000000-0000-0000-0000-0000000000c9', 'personal', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Mira2'),
  ('13000000-0000-0000-0000-0000000001e1', '11111111-1111-1111-1111-111111111111', '13000000-0000-0000-0000-0000000000a1', 'personal', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'MIRA'),
  ('13000000-0000-0000-0000-000000000191', '11111111-1111-1111-1111-111111111111', '13000000-0000-0000-0000-000000000099', 'personal', '99999999-9999-9999-9999-999999999999', 'Mira'),
  ('13000000-0000-0000-0000-0000000002a1', '11111111-1111-1111-1111-111111111111', '13000000-0000-0000-0000-0000000000a1', 'company', NULL, 'Jonah'),
  ('13000000-0000-0000-0000-0000000002a2', '11111111-1111-1111-1111-111111111111', '13000000-0000-0000-0000-0000000000a1', 'company', NULL, 'Jonah Lund'),
  ('13000000-0000-0000-0000-0000000002a3', '11111111-1111-1111-1111-111111111111', '13000000-0000-0000-0000-0000000000a1', 'company', NULL, 'Retired'),
  ('13000000-0000-0000-0000-0000000001d1', '11111111-1111-1111-1111-111111111111', '13000000-0000-0000-0000-0000000000a1', 'personal', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Mira'),
  ('13000000-0000-0000-0000-0000000001c3', '11111111-1111-1111-1111-111111111111', '13000000-0000-0000-0000-0000000000c8', 'personal', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Harbour'),
  ('13000000-0000-0000-0000-0000000001c4', '11111111-1111-1111-1111-111111111111', '13000000-0000-0000-0000-0000000000c9', 'personal', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Mira3'),
  ('13000000-0000-0000-0000-0000000001c5', '11111111-1111-1111-1111-111111111111', '13000000-0000-0000-0000-0000000000c9', 'personal', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Mira4');
UPDATE public.moth_tags SET retired_at = now() WHERE id IN ('13000000-0000-0000-0000-0000000002a3', '13000000-0000-0000-0000-0000000001d1');
INSERT INTO public.moth_tag_assignments (workspace_id, tag_id, tier, owner_id, target_type, target_id) VALUES
  ('11111111-1111-1111-1111-111111111111', '13000000-0000-0000-0000-0000000001c1', 'personal', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'asset', '13000000-0000-0000-0000-000000000051'),
  ('11111111-1111-1111-1111-111111111111', '13000000-0000-0000-0000-0000000001e1', 'personal', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'asset', '13000000-0000-0000-0000-000000000051'),
  ('11111111-1111-1111-1111-111111111111', '13000000-0000-0000-0000-0000000001e1', 'personal', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'task', '13000000-0000-0000-0000-000000000061'),
  ('11111111-1111-1111-1111-111111111111', '13000000-0000-0000-0000-0000000002a1', 'company', NULL, 'asset', '13000000-0000-0000-0000-000000000051'),
  ('11111111-1111-1111-1111-111111111111', '13000000-0000-0000-0000-0000000002a2', 'company', NULL, 'asset', '13000000-0000-0000-0000-000000000051'),
  ('11111111-1111-1111-1111-111111111111', '13000000-0000-0000-0000-0000000002a1', 'personal', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'task', '13000000-0000-0000-0000-000000000061');
-- user_c's own view, with a place for the dot of their tag "Mira".
INSERT INTO public.moth_views (id, workspace_id, scope_kind, owner_id, name) VALUES
  ('13000000-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111', 'aggregate', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Mine');
INSERT INTO public.moth_layout_positions (view_id, workspace_id, target_type, target_id, owner_id, x, y) VALUES
  ('13000000-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111', 'mtag', '13000000-0000-0000-0000-0000000001c1', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 12, 34);
-- And P's shared map, holding a place of user_e's own "MIRA" that no client could have put there (round A refuses
-- it): a fold must not publish it.
INSERT INTO public.moth_views (id, workspace_id, scope_kind, project_id, name) VALUES
  ('13000000-0000-0000-0000-0000000000f2', '11111111-1111-1111-1111-111111111111', 'project', 'aaaa1300-0000-0000-0000-00000000000a', 'P map');
INSERT INTO public.moth_layout_positions (view_id, workspace_id, target_type, target_id, owner_id, x, y) VALUES
  ('13000000-0000-0000-0000-0000000000f2', '11111111-1111-1111-1111-111111111111', 'mtag', '13000000-0000-0000-0000-0000000001e1', NULL, 5, 6);
-- A nomination's id, by its proposer and label, as the database sees it.
CREATE FUNCTION public.t130_nom(p_proposer uuid, p_label text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT id FROM public.moth_tag_nominations WHERE proposer_id = p_proposer AND label = p_label ORDER BY created_at, id DESC LIMIT 1
$f$;
GRANT EXECUTE ON FUNCTION public.t130_nom(uuid, text) TO authenticated;

-- ── A. Structure ────────────────────────────────────────────────────────────
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.moth_tag_nominations'::regclass), 'row security is forced');
SELECT is((SELECT string_agg(policyname || ':' || cmd, ',' ORDER BY policyname) FROM pg_policies WHERE tablename = 'moth_tag_nominations'),
  'moth_tag_nominations_select:SELECT', 'one policy, for reading');
SELECT ok(NOT has_table_privilege('authenticated', 'public.moth_tag_nominations', 'INSERT')
          AND NOT has_table_privilege('authenticated', 'public.moth_tag_nominations', 'UPDATE')
          AND NOT has_table_privilege('authenticated', 'public.moth_tag_nominations', 'DELETE'),
  'no client writes a nomination: the functions do');
SELECT ok(has_function_privilege('authenticated', 'public.moth_tag_nominate(uuid,text)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.moth_tag_nomination_decide(uuid,boolean,text)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.moth_tag_merge(uuid,uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.moth_tag_nominate(uuid,text)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'rabbit_private.moth_tag_fold(uuid,uuid,uuid)', 'EXECUTE'),
  'a signed-in person calls the four; the fold is no one''s to call');

-- ── B. Putting a tag forward ────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t130_c();
SELECT ok(public.moth_tag_nominate('13000000-0000-0000-0000-0000000001c1', 'We use her in every show.') IS NOT NULL, 'a member puts their own tag forward');
SELECT is((SELECT label || ' | ' || type_name || ' | ' || status FROM public.moth_tag_nominations WHERE proposer_id = auth.uid()),
  'Mira | character | open', 'consenting to its label and its type''s name, and nothing else');
SELECT throws_ok($$SELECT public.moth_tag_nominate('13000000-0000-0000-0000-0000000001c1')$$, '23505', 'That tag is put forward already.', 'once');
SELECT throws_ok($$SELECT public.moth_tag_nominate('13000000-0000-0000-0000-0000000001e1')$$, '42501', 'That tag is not one you can put forward.',
  'not someone else''s');
SELECT throws_ok($$SELECT public.moth_tag_nominate('13000000-0000-0000-0000-0000000002a1')$$, '42501', 'That tag is not one you can put forward.',
  'nor a company tag');
SELECT throws_ok(format($$SELECT public.moth_tag_nominate('13000000-0000-0000-0000-0000000001c2', %L)$$, repeat('x', 1001)), '22023', NULL,
  'with a note of 1,000 characters at most');
SELECT public.t130_e();
SELECT ok(public.moth_tag_nominate('13000000-0000-0000-0000-0000000001e1') IS NOT NULL, 'another member puts their "MIRA" forward too');
SELECT public.t130_r();
SELECT ok(public.moth_tag_nominate('13000000-0000-0000-0000-000000000191') IS NOT NULL, 'and a reviewer their "Mira" of a type of their own');

-- ── C. Reading ──────────────────────────────────────────────────────────────
SELECT public.t130_c();
SELECT is((SELECT count(*)::int FROM public.moth_tag_nominations), 1, 'a proposer reads their own');
SELECT public.t130_d();
SELECT is((SELECT count(*)::int FROM public.moth_tag_nominations), 0, 'a workspace manager reads none');
SELECT public.t130_a();
SELECT is((SELECT count(*)::int FROM public.moth_tag_nominations), 3, 'a live admin reads every one, to decide');

-- ── D. Deciding ─────────────────────────────────────────────────────────────
SELECT public.t130_d();
SELECT throws_ok(format($$SELECT public.moth_tag_nomination_decide(%L, true)$$, public.t130_nom('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Mira')),
  '42501', 'Only a workspace admin decides what becomes a company tag.', 'a manager does not decide');
SELECT public.t130_c();
SELECT throws_ok(format($$SELECT public.moth_tag_nomination_decide(%L, true)$$, public.t130_nom('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Mira')),
  '42501', 'Only a workspace admin decides what becomes a company tag.', 'nor does the proposer');
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', jsonb_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin'))::text, true);
SELECT throws_ok(format($$SELECT public.moth_tag_nomination_decide(%L, true)$$, public.t130_nom('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Mira')),
  '42501', 'Only a workspace admin decides what becomes a company tag.', 'nor a member whose token says admin: the membership row decides');
SELECT public.t130_a();
SELECT throws_ok($$SELECT public.moth_tag_nomination_decide('13000000-0000-0000-0000-00000000dead', true)$$,
  '42501', 'That nomination is not open.', 'an admin decides only what is open');
SELECT is(public.moth_tag_nomination_decide(public.t130_nom('99999999-9999-9999-9999-999999999999', 'Mira'), false, 'A place, not a person.'), NULL::uuid,
  'an admin turns one down');
SELECT public.t130_r();
SELECT is((SELECT status || ' | ' || review_note FROM public.moth_tag_nominations), 'rejected | A place, not a person.',
  'and its proposer reads why');

-- ── E. Approving ────────────────────────────────────────────────────────────
SELECT public.t130_a();
SELECT set_config('t130.tag', public.moth_tag_nomination_decide(public.t130_nom('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Mira'), true, 'Yes.')::text, true);
SELECT ok(current_setting('t130.tag') <> '', 'an admin approves, and is given the company tag');
RESET ROLE;
SELECT is((SELECT label || ' | ' || tier || ' | ' || (type_id = '13000000-0000-0000-0000-0000000000a1')::text FROM public.moth_tags WHERE id = current_setting('t130.tag')::uuid),
  'Mira | company | true', 'a company "Mira" of the company type of that name');
SELECT is((SELECT string_agg(right(id::text, 3) || ':' || COALESCE((canonical_id = current_setting('t130.tag')::uuid)::text, 'own'), ',' ORDER BY id)
             FROM public.moth_tags WHERE tier = 'personal'),
  '191:own,1c1:true,1c2:own,1c3:own,1c4:own,1c5:own,1d1:own,1e1:true',
  'every exact match folds into it, of either type of that name; another label, another type''s name and a tag its owner retired do not');
SELECT is((SELECT string_agg(owner_id::text || ':' || target_type || ':' || tier, ',' ORDER BY owner_id, target_type) FROM public.moth_tag_assignments
            WHERE tag_id = current_setting('t130.tag')::uuid),
  'cccccccc-cccc-cccc-cccc-cccccccccccc:asset:personal,eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee:asset:personal,eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee:task:personal',
  'each owner''s assignments now point at it, and are still that owner''s own');
SELECT is((SELECT string_agg(status || ':' || (result_tag_id = current_setting('t130.tag')::uuid)::text, ',' ORDER BY created_at, id) FROM public.moth_tag_nominations
            WHERE label IN ('Mira', 'MIRA') AND status = 'approved'),
  'approved:true,approved:true', 'the other open nomination of the same word is approved into it too');
SELECT is((SELECT target_id::text || ' ' || x::text || ',' || y::text FROM public.moth_layout_positions WHERE view_id = '13000000-0000-0000-0000-0000000000f1'),
  current_setting('t130.tag') || ' 12,34', 'a folded tag''s place in its owner''s own view goes to the company tag''s dot');
SELECT is((SELECT count(*)::int FROM public.moth_layout_positions WHERE view_id = '13000000-0000-0000-0000-0000000000f2'), 0,
  'and a shared place of a person''s tag is never published: it goes');
SET LOCAL ROLE authenticated;
SELECT public.t130_c();
SELECT is((SELECT count(*)::int FROM public.moth_tag_assignments WHERE tag_id = current_setting('t130.tag')::uuid), 1,
  'the proposer sees their own use of it, and not another''s');
SELECT public.t130_a();
SELECT is((SELECT count(*)::int FROM public.moth_tag_assignments WHERE tag_id = current_setting('t130.tag')::uuid), 0,
  'and the admin who approved it sees none of them: nothing private travelled');
SELECT throws_ok(format($$SELECT public.moth_tag_nomination_decide(%L, true)$$, public.t130_nom('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Mira')),
  '42501', 'That nomination is not open.', 'a decided nomination is decided');

-- ── F. Withdrawing ──────────────────────────────────────────────────────────
SELECT public.t130_c();
SELECT ok(public.moth_tag_nominate('13000000-0000-0000-0000-0000000001c2') IS NOT NULL, 'a member puts another tag forward');
SELECT public.t130_e();
SELECT throws_ok(format($$SELECT public.moth_tag_nomination_withdraw(%L)$$, public.t130_nom('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Mira2')),
  '42501', 'That is not an open nomination of yours.', 'someone else does not withdraw it');
SELECT public.t130_c();
SELECT ok(public.moth_tag_nomination_withdraw(public.t130_nom('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Mira2')), 'its proposer does');
SELECT throws_ok(format($$SELECT public.moth_tag_nomination_withdraw(%L)$$, public.t130_nom('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Mira2')),
  '42501', 'That is not an open nomination of yours.', 'once');
SELECT ok(public.moth_tag_nominate('13000000-0000-0000-0000-0000000001c4') IS NOT NULL, 'a member puts a third tag forward');
SELECT lives_ok($$DELETE FROM public.moth_tags WHERE id = '13000000-0000-0000-0000-0000000001c4'$$, 'and deletes it');
SELECT ok(public.moth_tag_nominate('13000000-0000-0000-0000-0000000001c5') IS NOT NULL, 'puts a fourth forward');
SELECT lives_ok($$UPDATE public.moth_tags SET retired_at = now() WHERE id = '13000000-0000-0000-0000-0000000001c5'$$, 'and retires it');
SELECT ok(public.moth_tag_nominate('13000000-0000-0000-0000-0000000001c3') IS NOT NULL, 'and puts a tag of a type of their own forward');
SELECT public.t130_a();
SELECT is((SELECT status FROM public.moth_tag_nominations WHERE label = 'Mira3'), 'withdrawn',
  'a deleted tag''s nomination reads as withdrawn, as if its proposer had withdrawn it');
SELECT is((SELECT status FROM public.moth_tag_nominations WHERE label = 'Mira4'), 'withdrawn',
  'and so does a retired one''s');
SELECT set_config('t130.places', public.moth_tag_nomination_decide(public.t130_nom('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Harbour'), true)::text, true);
SELECT is((SELECT ty.name || ':' || ty.shape || ':' || ty.colour FROM public.moth_tags t JOIN public.moth_tag_types ty ON ty.id = t.type_id
            WHERE t.id = current_setting('t130.places')::uuid),
  'Places:circle:mist', 'a new company type takes the plain look, not the proposer''s own');
SELECT public.t130_c();

-- ── G. Merging ──────────────────────────────────────────────────────────────
SELECT throws_ok($$SELECT public.moth_tag_merge('13000000-0000-0000-0000-0000000002a1', '13000000-0000-0000-0000-0000000002a2')$$,
  '42501', 'Only a workspace admin merges company tags.', 'a member merges no company tags');
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', jsonb_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin'))::text, true);
SELECT throws_ok($$SELECT public.moth_tag_merge('13000000-0000-0000-0000-0000000002a1', '13000000-0000-0000-0000-0000000002a2')$$,
  '42501', 'Only a workspace admin merges company tags.', 'nor a member whose token says admin');
SELECT public.t130_c();
SELECT public.t130_a();
SELECT throws_ok($$SELECT public.moth_tag_merge('13000000-0000-0000-0000-0000000001c2', '13000000-0000-0000-0000-0000000002a2')$$,
  '22023', NULL, 'an admin merges no one''s own tag');
SELECT throws_ok($$SELECT public.moth_tag_merge('13000000-0000-0000-0000-0000000002a1', '13000000-0000-0000-0000-0000000002a3')$$,
  '22023', NULL, 'nor into a retired tag');
SELECT throws_ok($$SELECT public.moth_tag_merge('13000000-0000-0000-0000-0000000002a1', '13000000-0000-0000-0000-0000000002a1')$$,
  '22023', NULL, 'nor a tag into itself');
SELECT is(public.moth_tag_merge('13000000-0000-0000-0000-0000000002a1', '13000000-0000-0000-0000-0000000002a2'), '13000000-0000-0000-0000-0000000002a2'::uuid,
  'an admin merges "Jonah" into "Jonah Lund"');
RESET ROLE;
SELECT is((SELECT canonical_id FROM public.moth_tags WHERE id = '13000000-0000-0000-0000-0000000002a1'), '13000000-0000-0000-0000-0000000002a2'::uuid,
  'which it stands for now');
SELECT is((SELECT string_agg(target_type || ':' || tier || ':' || COALESCE(right(owner_id::text, 4), '-'), ',' ORDER BY target_type, tier)
             FROM public.moth_tag_assignments WHERE tag_id = '13000000-0000-0000-0000-0000000002a2'),
  'asset:company:-,task:personal:cccc',
  'its assignments are the other''s: the company one already there stays one, and a person''s private use follows, still theirs');
SELECT is((SELECT count(*)::int FROM public.moth_tag_assignments WHERE tag_id = '13000000-0000-0000-0000-0000000002a1'), 0, 'and none is left on it');

-- ── H. Moth's gate for a typed tag ──────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT public.t130_c();
SELECT ok(public.moth_can_read_target('mtag', '13000000-0000-0000-0000-0000000001c2')
          AND NOT public.moth_can_read_target('mtag', '13000000-0000-0000-0000-0000000001c1')
          AND public.moth_can_read_target('mtag', '13000000-0000-0000-0000-0000000002a2')
          AND NOT public.moth_can_read_target('mtag', '13000000-0000-0000-0000-0000000002a1'),
  'a person sees their own tag''s dot and the company''s; a folded or merged tag is no dot');
SELECT public.t130_a();
SELECT ok(NOT public.moth_can_read_target('mtag', '13000000-0000-0000-0000-0000000001c2'), 'an admin sees no one''s own tag''s dot');
SELECT public.t130_b();
SELECT ok(NOT public.moth_can_read_target('mtag', '13000000-0000-0000-0000-0000000002a2'), 'another company sees none');

SELECT * FROM finish();
ROLLBACK;
