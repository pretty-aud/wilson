-- =============================================================================
-- 103_otter_subject_shares.sql — B1 (2026-10-27): subject shares, migration
-- 0100 (docs/design/OTTER_SUBJECT_SHARES_DESIGN.md §3; this suite is its §4).
--
-- A share is a ROW ABOUT TWO PEOPLE AND A SUBJECT: one subject, one person, a
-- live link they accept first. These probes pin, in timeline order:
--   * the structure (one SELECT policy, no write grant, nine functions, the
--     guard trigger armed by two GUCs, the partial unique index, the chain and
--     batch columns, the self-FK that cascades);
--   * who may share (the owner; a receiver who accepted, passing it on; never
--     an admin or a granted editor: consent is not transferable, S1);
--   * what opens and what stays closed (ONE subject row, never the course,
--     the other subjects or the documents; read-only; each person's own
--     progression under the client's link:<subject_id> key);
--   * the index's disclosure per side (the pending receiver's minimum, the
--     live columns once accepted, the SNAPSHOTS once settled);
--   * the guard binding every role, armed or not (the forged cross-workspace
--     row SH5, the two forged onward rows SHX and SHZ, and two more forged
--     probe rows SHV and SHW the runner removes again);
--   * the chain (SH1 → SH9 → SH10) and its fall, the batch (a whole course as
--     rows that are each a single row), the three hands that may end a row
--     and the cascade below it; the audit lines, ids only, scoped to the
--     workspace AND the code (suite 70's lesson).
--
-- 🚨 The suite is ONE transaction: every GUC a probe arms is reset to '' right
-- after, and every "unarmed" probe first asserts the GUC reads EMPTY with
-- coalesce (a GUC never set reads NULL, not ''). The share ids the functions
-- return are kept in a temp table (t103) read through pg_temp.sh('SH1').
-- tests.login_as() sets NO app_role: the admin's claims are built by hand.
-- Every refusal is the function's whole sentence (throws_ok matches the whole
-- message); the anon column is 42501 throughout (0033: no grant, no EXECUTE).
-- =============================================================================

BEGIN;

SELECT plan(442);

SELECT * FROM tests.rls_setup();

-- ── the share ids the functions return ──────────────────────────────────────
CREATE TEMP TABLE t103 (k TEXT PRIMARY KEY, v UUID NOT NULL);
GRANT SELECT, INSERT ON t103 TO PUBLIC;
CREATE FUNCTION pg_temp.sh(TEXT) RETURNS UUID LANGUAGE sql STABLE
AS $f$ SELECT v FROM t103 WHERE k = $1 $f$;
GRANT EXECUTE ON FUNCTION pg_temp.sh(TEXT) TO PUBLIC;

-- ── fixtures (runner: RLS bypassed) ─────────────────────────────────────────
-- user_a  : workspace admin (from rls_setup)      user_b : admin of workspace B
-- user_c  : the OWNER of C1..C4                   user_d : the RECEIVER
-- user_e  : a plain third person (no grant)       user_g : a granted EDITOR on C1
-- user_h  : a plain member, the end of the chain  user_f : DEACTIVATED
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user_d@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user_e@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7', 'user_g@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('abababab-abab-abab-abab-abababababab', 'user_h@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('fafafafa-fafa-fafa-fafa-fafafafafafa', 'user_f@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','user','user_c','User C',true),
  ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','user','user_d','User D',true),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','user','user_e','User E',true),
  ('11111111-1111-1111-1111-111111111111','a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7','user','user_g','User G',true),
  ('11111111-1111-1111-1111-111111111111','abababab-abab-abab-abab-abababababab','user','user_h','User H',true),
  ('11111111-1111-1111-1111-111111111111','fafafafa-fafa-fafa-fafa-fafafafafafa','user','user_f','User F',false)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- C1 Blender 5.0 (personal, c) with S1 modifiers, S2 rigging, S6 materials;
-- C2 Houdini (personal, c) with S3 sops and the STUB S5 vops (C2 carries a
-- hotkeys document, so "nothing copied" at accept is a real probe);
-- C3 Shared Topic (SHARED, c) with S4; C4 Empty Topic (c) with no subject;
-- D1 "My Blender" (personal, d): the SAME slug as C1, a different name, its
-- own subject `modifiers` (the key decides and the slugs may coincide).
INSERT INTO public.otter_courses (id, workspace_id, owner_id, slug, name, visibility, hotkeys)
VALUES
  ('0c000103-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','blender-5-0','Blender 5.0','personal','{"categories": []}'::jsonb),
  ('0c000103-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','houdini','Houdini','personal',
   '{"categories": [{"category": "General", "shortcuts": [{"action": "Save", "keys": "Ctrl+S"}]}]}'::jsonb),
  ('0c000103-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','shared-topic','Shared Topic','shared','{"categories": []}'::jsonb),
  ('0c000103-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','empty-topic','Empty Topic','personal','{"categories": []}'::jsonb),
  ('0c000103-0000-0000-0000-000000000011','11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','blender-5-0','My Blender','personal','{"categories": []}'::jsonb);

INSERT INTO public.otter_subjects
  (id, workspace_id, course_id, owner_id, slug, title, subject_order, is_stub)
VALUES
  ('05000103-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','0c000103-0000-0000-0000-000000000001','cccccccc-cccc-cccc-cccc-cccccccccccc','modifiers','Modifiers',1,false),
  ('05000103-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','0c000103-0000-0000-0000-000000000001','cccccccc-cccc-cccc-cccc-cccccccccccc','rigging','Rigging',2,false),
  ('05000103-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111','0c000103-0000-0000-0000-000000000001','cccccccc-cccc-cccc-cccc-cccccccccccc','materials','Materials',3,false),
  ('05000103-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','0c000103-0000-0000-0000-000000000002','cccccccc-cccc-cccc-cccc-cccccccccccc','sops','SOPs',1,false),
  ('05000103-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','0c000103-0000-0000-0000-000000000002','cccccccc-cccc-cccc-cccc-cccccccccccc','vops','VOPs',2,true),
  ('05000103-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','0c000103-0000-0000-0000-000000000003','cccccccc-cccc-cccc-cccc-cccccccccccc','shared-sub','Shared Sub',1,false),
  ('05000103-0000-0000-0000-000000000011','11111111-1111-1111-1111-111111111111','0c000103-0000-0000-0000-000000000011','dddddddd-dddd-dddd-dddd-dddddddddddd','modifiers','My Modifiers',1,false);

-- g holds an EDITOR grant on C1: a read grant too (0022's course arm), which
-- is exactly why g is never the end of a chain here.
INSERT INTO public.otter_course_editors (workspace_id, course_id, user_id, granted_by)
VALUES ('11111111-1111-1111-1111-111111111111','0c000103-0000-0000-0000-000000000001','a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7','cccccccc-cccc-cccc-cccc-cccccccccccc');

-- ── 1. Structure ────────────────────────────────────────────────────────────
SELECT has_table('public', 'otter_subject_shares', 'otter_subject_shares table exists (0100 §1)');

SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
            WHERE oid = 'public.otter_subject_shares'::regclass),
          'RLS is enabled AND forced on otter_subject_shares');

SELECT has_function('public', 'otter_subject_share', ARRAY['uuid','uuid','text'],
                    'otter_subject_share(uuid, uuid, text) exists');
SELECT has_function('public', 'otter_subject_share_course', ARRAY['uuid','uuid','text'],
                    'otter_subject_share_course(uuid, uuid, text) exists');
SELECT has_function('public', 'otter_subject_share_make', ARRAY['uuid','uuid','text','uuid'],
                    'otter_subject_share_make(uuid, uuid, text, uuid) exists (the internal row-maker)');
SELECT has_function('public', 'otter_subject_share_accept', ARRAY['uuid'],
                    'otter_subject_share_accept(uuid) exists');
SELECT has_function('public', 'otter_subject_share_decline', ARRAY['uuid'],
                    'otter_subject_share_decline(uuid) exists');
SELECT has_function('public', 'otter_subject_share_revoke', ARRAY['uuid'],
                    'otter_subject_share_revoke(uuid) exists');
SELECT has_function('public', 'otter_subject_shares_index',
                    'otter_subject_shares_index() exists');
SELECT has_function('public', 'otter_has_accepted_subject_share', ARRAY['uuid'],
                    'otter_has_accepted_subject_share(uuid) exists (the consent helper)');
SELECT has_function('public', 'fn_otter_subject_share_guard',
                    'fn_otter_subject_share_guard() exists');

SELECT has_trigger('public', 'otter_subject_shares', 'trg_otter_subject_share_guard',
                   'the guard trigger exists');
SELECT has_trigger('public', 'otter_subject_shares', 'trg_otter_subject_share_audit',
                   'the audit-touch trigger exists');

-- tgtype bits: 1 row, 2 before, 4 insert, 16 update. Its name proves none.
SELECT is((SELECT (tgtype::int & 23) FROM pg_trigger
            WHERE tgrelid = 'public.otter_subject_shares'::regclass
              AND tgname = 'trg_otter_subject_share_guard'),
          23, 'the guard is BEFORE, FOR EACH ROW, for INSERT and for UPDATE (tgtype, not its name)');

SELECT ok((SELECT indexdef LIKE 'CREATE UNIQUE INDEX%'
              AND indexdef LIKE '%WHERE%'
              AND indexdef LIKE '%pending%'
              AND indexdef LIKE '%accepted%'
             FROM pg_indexes
            WHERE schemaname = 'public' AND indexname = 'otter_subject_share_live_uidx'),
          'one LIVE share per (subject, person): the partial unique index, with its predicate');

SELECT ok((SELECT column_default FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'otter_subject_shares'
              AND column_name = 'workspace_id')
          IN ('current_workspace_id()', 'public.current_workspace_id()'),
          'workspace_id defaults to current_workspace_id(): a sharer cannot file into another workspace');

SELECT is((SELECT column_default FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'otter_subject_shares'
              AND column_name = 'shared_by'),
          'auth.uid()', 'shared_by defaults to auth.uid(): a sharer cannot file as someone else');

SELECT has_column('public', 'otter_subject_shares', 'batch_id',         'batch_id exists (the batch, §1.5)');
SELECT has_column('public', 'otter_subject_shares', 'via_share_id',     'via_share_id exists (the chain, §1.4)');
SELECT has_column('public', 'otter_subject_shares', 'subject_owner_id', 'subject_owner_id exists (the owner, by column)');
SELECT has_column('public', 'otter_subject_shares', 'chain_depth',      'chain_depth exists');
SELECT col_not_null('public', 'otter_subject_shares', 'subject_owner_id', 'subject_owner_id is NOT NULL');
SELECT col_not_null('public', 'otter_subject_shares', 'subject_title',    'subject_title (the snapshot) is NOT NULL');
SELECT col_not_null('public', 'otter_subject_shares', 'course_name',      'course_name (the snapshot) is NOT NULL');

SELECT is((SELECT column_default FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'otter_subject_shares'
              AND column_name = 'chain_depth'),
          '1', 'chain_depth defaults to 1 (an owner-made row)');

SELECT ok(EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = 'public.otter_subject_shares'::regclass
                     AND conname = 'otter_subject_share_chain_chk' AND contype = 'c'),
          'otter_subject_share_chain_chk exists (the chain''s shape, row by row)');

SELECT ok((SELECT confdeltype = 'c' FROM pg_constraint
            WHERE conrelid = 'public.otter_subject_shares'::regclass
              AND conname = 'otter_subject_share_via_fkey' AND contype = 'f'),
          'the self-FK via_share_id cascades: a child row never outlives its parent row');

SELECT is((SELECT count(*)::int FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'otter_subject_shares'),
          1, 'exactly one policy on the share table');

SELECT is((SELECT cmd FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'otter_subject_shares'),
          'SELECT', '… and it is SELECT: every write goes through the functions');

SELECT ok((SELECT qual LIKE '%subject_owner_id%' AND qual NOT LIKE '%otter_subject_shares%'
             FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'otter_subject_shares'),
          'the policy admits the subject''s owner by COLUMN and never reads its own table (recursion)');

SELECT ok(has_table_privilege('authenticated', 'public.otter_subject_shares', 'SELECT')
          AND NOT has_table_privilege('authenticated', 'public.otter_subject_shares', 'INSERT')
          AND NOT has_table_privilege('authenticated', 'public.otter_subject_shares', 'UPDATE')
          AND NOT has_table_privilege('authenticated', 'public.otter_subject_shares', 'DELETE'),
          'authenticated holds SELECT and nothing else on otter_subject_shares');

SELECT ok(NOT (has_table_privilege('anon', 'public.otter_subject_shares', 'SELECT')
            OR has_table_privilege('anon', 'public.otter_subject_shares', 'INSERT')
            OR has_table_privilege('anon', 'public.otter_subject_shares', 'UPDATE')
            OR has_table_privilege('anon', 'public.otter_subject_shares', 'DELETE')),
          'anon holds no table privilege on otter_subject_shares');

-- anon is a member of PUBLIC, so a PUBLIC grant (CREATE FUNCTION's default) shows here.
SELECT ok(NOT has_function_privilege('anon', 'public.otter_subject_share(uuid,uuid,text)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.otter_subject_share_course(uuid,uuid,text)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.otter_subject_share_make(uuid,uuid,text,uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.otter_subject_share_accept(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.otter_subject_share_decline(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.otter_subject_share_revoke(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.otter_subject_shares_index()', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.otter_has_accepted_subject_share(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.fn_otter_subject_share_guard()', 'EXECUTE'),
          'anon (and so PUBLIC) can execute none of the nine functions');

SELECT ok(NOT has_function_privilege('authenticated', 'public.fn_otter_subject_share_guard()', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.otter_subject_share_make(uuid,uuid,text,uuid)', 'EXECUTE'),
          'authenticated can execute neither the guard nor the row-maker');

SELECT ok(has_function_privilege('authenticated', 'public.otter_subject_share(uuid,uuid,text)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.otter_subject_share_course(uuid,uuid,text)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.otter_subject_share_accept(uuid)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.otter_subject_share_decline(uuid)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.otter_subject_share_revoke(uuid)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.otter_subject_shares_index()', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.otter_has_accepted_subject_share(uuid)', 'EXECUTE'),
          'authenticated can call the five, the index and the helper');

-- ── 2. Sharing, as the owner ────────────────────────────────────────────────
-- as c, the owner
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');

-- 🚨 THE CLIENT'S ACTUAL CALL SHAPE: rpc('otter_subject_share', {subject, person,
-- note}). workspace_id, shared_by, the snapshots, the owner column and the
-- depth are the server's to decide.
INSERT INTO t103 VALUES ('SH1', public.otter_subject_share('05000103-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Have a look at the modifiers chapter'));
SELECT ok(pg_temp.sh('SH1') IS NOT NULL, 'SH1: the owner shares S1 with d and gets a share id back');

SELECT is((SELECT status FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH1')),
          'pending', 'SH1 starts pending');
SELECT is((SELECT shared_by FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH1')),
          'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'shared_by is the caller');
SELECT is((SELECT workspace_id FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH1')),
          '11111111-1111-1111-1111-111111111111'::uuid, 'workspace_id is the caller''s workspace');
SELECT is((SELECT subject_title FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH1')),
          'Modifiers', 'the subject''s title is snapshotted at share time');
SELECT is((SELECT course_name FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH1')),
          'Blender 5.0', 'the course''s name is snapshotted at share time');
SELECT is((SELECT chain_depth FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH1')),
          1::smallint, 'an owner-made row is depth 1');
SELECT is((SELECT via_share_id FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH1')),
          NULL::uuid, '… and hangs from nothing');
SELECT is((SELECT subject_owner_id FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH1')),
          'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'subject_owner_id is the live owner');
SELECT is((SELECT batch_id FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH1')),
          NULL::uuid, 'a single share carries no batch id');
SELECT is((SELECT message FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH1')),
          'Have a look at the modifiers chapter', 'the note is kept');

SELECT throws_ok($$SELECT public.otter_subject_share('05000103-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', NULL)$$,
  'this subject is already shared with that person',
  'SH1 again: one live share per subject and person');

SELECT throws_ok($$SELECT public.otter_subject_share('05000103-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', NULL)$$,
  'choose a colleague to share it with',
  'sharing with yourself is refused');

SELECT throws_ok($$SELECT public.otter_subject_share('05000103-0000-0000-0000-000000000001', 'fafafafa-fafa-fafa-fafa-fafafafafafa', NULL)$$,
  'that person is not an active member of this workspace',
  'sharing with a deactivated member is refused');

SELECT throws_ok($$SELECT public.otter_subject_share('05000103-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', NULL)$$,
  'that person is not an active member of this workspace',
  'sharing with someone in another workspace is refused');

INSERT INTO t103 VALUES ('SH2', public.otter_subject_share('05000103-0000-0000-0000-000000000003', 'dddddddd-dddd-dddd-dddd-dddddddddddd', NULL));
SELECT ok(pg_temp.sh('SH2') IS NOT NULL, 'SH2: S3 (Houdini; no Houdini course on d''s side) shared with d');

INSERT INTO t103 VALUES ('SH3', public.otter_subject_share('05000103-0000-0000-0000-000000000004', 'dddddddd-dddd-dddd-dddd-dddddddddddd', NULL));
SELECT ok(pg_temp.sh('SH3') IS NOT NULL, 'SH3: a subject of a SHARED course can be shared too');

INSERT INTO t103 VALUES ('SH4', public.otter_subject_share('05000103-0000-0000-0000-000000000002', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Rigging, for the pipeline'));
SELECT ok(pg_temp.sh('SH4') IS NOT NULL, 'SH4: S2 shared with e (to be declined)');

INSERT INTO t103 VALUES ('SH7', public.otter_subject_share('05000103-0000-0000-0000-000000000005', 'dddddddd-dddd-dddd-dddd-dddddddddddd', NULL));
SELECT ok(pg_temp.sh('SH7') IS NOT NULL, 'SH7: a STUB may be shared (an outline that fills live)');

-- The message tells a missing GRANT from a missing POLICY (also 42501).
SELECT throws_ok($$
  INSERT INTO public.otter_subject_shares (subject_id, shared_with, subject_title, course_name, subject_owner_id)
  VALUES ('05000103-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Modifiers', 'Blender 5.0', 'cccccccc-cccc-cccc-cccc-cccccccccccc')
$$, '42501', 'permission denied for table otter_subject_shares',
  'the owner cannot INSERT a share row directly: no grant, by its message');

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT throws_ok($$SELECT public.otter_subject_share('05000103-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', NULL)$$,
  'choose a colleague to share it with',
  'as d, sharing S1 with d is self: that check runs before standing');

SELECT throws_ok($$SELECT public.otter_subject_share('05000103-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', NULL)$$,
  'only the owner of a course, or someone who accepted a share of this subject, may share it',
  'as d, sharing S1 with e is refused: not the owner, and no accepted link yet');

-- as e, the third person
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT throws_ok($$SELECT public.otter_subject_share('05000103-0000-0000-0000-000000000001', 'abababab-abab-abab-abab-abababababab', NULL)$$,
  'only the owner of a course, or someone who accepted a share of this subject, may share it',
  'a plain member cannot share someone else''s subject (S1)');

-- as g, a granted editor on C1
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7', '11111111-1111-1111-1111-111111111111');
SELECT throws_ok($$SELECT public.otter_subject_share('05000103-0000-0000-0000-000000000001', 'abababab-abab-abab-abab-abababababab', NULL)$$,
  'only the owner of a course, or someone who accepted a share of this subject, may share it',
  'a GRANTED EDITOR cannot share it either: an editor grant is not consent (S1)');

-- as a, the ADMIN (claims by hand: tests.login_as sets no app_role)
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);
SELECT throws_ok($$SELECT public.otter_subject_share('05000103-0000-0000-0000-000000000001', 'abababab-abab-abab-abab-abababababab', NULL)$$,
  'only the owner of a course, or someone who accepted a share of this subject, may share it',
  'an ADMIN cannot share a member''s subject (S1: only the owner)');

SELECT throws_ok($$
  INSERT INTO public.otter_subject_shares (subject_id, shared_with, subject_title, course_name, subject_owner_id)
  VALUES ('05000103-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Modifiers', 'Blender 5.0', 'cccccccc-cccc-cccc-cccc-cccccccccccc')
$$, '42501', NULL, 'an admin cannot INSERT a share row directly either');

-- as b, active in workspace B
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222');
SELECT throws_ok($$SELECT public.otter_subject_share('05000103-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL)$$,
  'subject not found in this workspace',
  'another workspace''s member cannot share it: b is active in B, so membership passes and the subject is not there');

-- ── 3. Before accept ────────────────────────────────────────────────────────
-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000001'),
          0, 'before accepting, d reads nothing of S1');
SELECT is((SELECT count(*)::int FROM public.otter_courses WHERE id = '0c000103-0000-0000-0000-000000000001'),
          0, '… nor of C1');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH1')),
          1, 'd reads SH1''s row: the receiver is a party');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares),
          4, 'd reads exactly the four rows naming them (SH1, SH2, SH3, SH7)');

WITH upd AS (
  UPDATE public.otter_subjects SET description = 'edited before accepting'
   WHERE id = '05000103-0000-0000-0000-000000000001' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0, 'd cannot UPDATE S1 before accepting (0 rows, nothing thrown)');

SELECT throws_ok($$
  INSERT INTO public.otter_subject_shares (subject_id, shared_with, subject_title, course_name, subject_owner_id)
  VALUES ('05000103-0000-0000-0000-000000000002', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Rigging', 'Blender 5.0', 'cccccccc-cccc-cccc-cccc-cccccccccccc')
$$, '42501', NULL, 'd cannot INSERT a share row directly');

SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index()),
          4, 'd''s index lists the four pending offers');
SELECT is((SELECT subject_title FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          'Modifiers', 'the pending receiver learns the title (a definer read: they cannot read the subject yet)');
SELECT is((SELECT course_name FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          'Blender 5.0', '… the course''s name');
SELECT is((SELECT sharer_label FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          'User C', '… the sharer''s label');
SELECT is((SELECT owner_label FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          'User C', '… and the owner''s label (one person, for an owner-made row)');
SELECT is((SELECT message FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          'Have a look at the modifiers chapter', '… and the note');
SELECT is((SELECT state FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          'pending', '… state pending');
SELECT is((SELECT via_share_id FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          NULL::uuid, '… via_share_id null');
SELECT is((SELECT batch_id FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          NULL::uuid, '… batch_id null');
SELECT is((SELECT chain_depth FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          1::smallint, '… chain_depth 1');
SELECT is((SELECT is_owner FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          false, '… is_owner false');
SELECT is((SELECT is_mine FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          false, '… is_mine false');
SELECT is((SELECT course_id FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          NULL::uuid, 'the pending receiver gets NO course id (the disclosure is the minimum to decide on)');
SELECT is((SELECT course_slug FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          NULL::text, '… no course slug');
SELECT is((SELECT course_type FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          NULL::text, '… no course type');
SELECT is((SELECT skill_level FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          NULL::text, '… no skill level');
SELECT is((SELECT host_course_id FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          NULL::uuid, '… no host while pending');
SELECT is((SELECT host_live FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          false, '… host_live false while pending');
SELECT is((SELECT subject_is_stub FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH7')),
          true, 'a stub is flagged as an outline for the receiver');

-- as e, the third person
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares),
          1, 'e reads SH4''s row and no other');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index()),
          1, 'e''s index lists SH4 only');
SELECT is((SELECT state FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH4')),
          'pending', '… pending');
SELECT is((SELECT course_id FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH4')),
          NULL::uuid, '… with the pending receiver''s nulls');
SELECT throws_ok($$
  INSERT INTO public.otter_subject_shares (subject_id, shared_with, subject_title, course_name, subject_owner_id)
  VALUES ('05000103-0000-0000-0000-000000000002', 'abababab-abab-abab-abab-abababababab', 'Rigging', 'Blender 5.0', 'cccccccc-cccc-cccc-cccc-cccccccccccc')
$$, '42501', NULL, 'e cannot INSERT a share row directly');
SELECT throws_ok($$
  UPDATE public.otter_subject_shares SET status = 'accepted', host_course_id = '0c000103-0000-0000-0000-0000000000f5'
   WHERE id = pg_temp.sh('SH4')
$$, '42501', NULL, 'e cannot UPDATE their own offer directly');

-- as g, a granted editor on C1
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares),
          0, 'g (a granted editor on C1) reads no share row: a grant is not a party');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index()),
          0, '… and g''s index is empty');

-- as a, the ADMIN (claims by hand: tests.login_as sets no app_role)
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares),
          0, 'an ADMIN reads no share row: a share is between people, not workspace business');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index()),
          0, '… and an admin''s index is empty');

-- as b, active in workspace B
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares),
          0, 'another workspace reads no share row');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index()),
          0, '… and its index is empty');
SELECT throws_ok($$
  INSERT INTO public.otter_subject_shares (subject_id, shared_with, subject_title, course_name, subject_owner_id)
  VALUES ('05000103-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Modifiers', 'Blender 5.0', 'cccccccc-cccc-cccc-cccc-cccccccccccc')
$$, '42501', NULL, 'b cannot INSERT a share row directly');
SELECT throws_ok($$
  UPDATE public.otter_subject_shares SET message = 'from B' WHERE id = pg_temp.sh('SH1')
$$, '42501', NULL, 'b cannot UPDATE a share row directly');

-- anon: 42501, never 0 rows (0033 revoked every privilege; a count would abort the file)
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET ROLE anon;
SELECT throws_ok($$SELECT count(*) FROM public.otter_subject_shares$$,
  '42501', NULL, 'anon cannot read the share table at all');
SELECT throws_ok($$SELECT count(*) FROM public.otter_subject_shares_index()$$,
  '42501', NULL, 'anon cannot call the index');
SELECT throws_ok($$SELECT public.otter_subject_share('05000103-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', NULL)$$,
  '42501', NULL, 'anon cannot call otter_subject_share');
SELECT throws_ok($$SELECT public.otter_subject_share_accept(pg_temp.sh('SH1'))$$,
  '42501', NULL, 'anon cannot call otter_subject_share_accept');

-- as c, the owner
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index()),
          5, 'the owner''s index lists the five rows made so far (SH1, SH2, SH3, SH4, SH7)');
SELECT is((SELECT is_owner FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          true, '… is_owner true for the owner');
SELECT is((SELECT is_mine FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          true, '… is_mine true: the owner made the row');
SELECT is((SELECT course_id FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          '0c000103-0000-0000-0000-000000000001'::uuid, '… the owner sees the course id (their own course)');
SELECT is((SELECT course_slug FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          'blender-5-0', '… and its slug');
SELECT is((SELECT receiver_label FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          'User D', '… and the receiver''s label');
SELECT is((SELECT host_course_id FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          NULL::uuid, '… and never the receiver''s host');
SELECT throws_ok($$
  UPDATE public.otter_subject_shares SET message = 'rewritten by the owner' WHERE id = pg_temp.sh('SH1')
$$, '42501', 'permission denied for table otter_subject_shares',
  'the owner cannot UPDATE their own row directly either: no grant');

-- ── 4. Accept ───────────────────────────────────────────────────────────────
-- The two wrong hands try SH4 (e's offer), not SH1: a function mutated to
-- skip the receiver check would then land SH4 for the wrong person, and the
-- probes that follow would redden rather than the file aborting at d's own
-- accept of SH1 (the failing control's shape, measured).
-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT throws_ok($$SELECT public.otter_subject_share_accept(pg_temp.sh('SH4'))$$,
  'only the person it was shared with may accept it',
  'a third person cannot accept SH4 (d is nobody to it)');

-- as c, the owner
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT throws_ok($$SELECT public.otter_subject_share_accept(pg_temp.sh('SH4'))$$,
  'only the person it was shared with may accept it',
  'the owner cannot accept their own offer');

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT throws_ok($$
  UPDATE public.otter_subject_shares SET status = 'accepted', host_course_id = '0c000103-0000-0000-0000-000000000011'
   WHERE id = pg_temp.sh('SH1')
$$, '42501', 'permission denied for table otter_subject_shares',
  'd cannot accept by UPDATING the row: no UPDATE grant');

INSERT INTO t103 VALUES ('H1', public.otter_subject_share_accept(pg_temp.sh('SH1')));
SELECT is(pg_temp.sh('H1'), '0c000103-0000-0000-0000-000000000011'::uuid,
          'd accepts SH1 and it lands in D1: the SLUG matched, the name ("My Blender") ignored');
SELECT is((SELECT status FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH1')),
          'accepted', 'SH1 is accepted');
SELECT is((SELECT host_course_id FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH1')),
          '0c000103-0000-0000-0000-000000000011'::uuid, '… host_course_id is D1');
SELECT ok((SELECT responded_at IS NOT NULL FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH1')),
          '… responded_at is stamped');

SELECT throws_ok($$SELECT public.otter_subject_share_accept(pg_temp.sh('SH1'))$$,
  'this share is accepted — only a pending share can be accepted',
  'accepting twice is refused');

INSERT INTO t103 VALUES ('H2', public.otter_subject_share_accept(pg_temp.sh('SH2')));
SELECT isnt(pg_temp.sh('H2'), '0c000103-0000-0000-0000-000000000011'::uuid,
          'd accepts SH2 and a NEW course is made (no Houdini course on d''s side)');
SELECT is((SELECT owner_id FROM public.otter_courses WHERE id = pg_temp.sh('H2')),
          'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, '… the new course is d''s');
SELECT is((SELECT slug FROM public.otter_courses WHERE id = pg_temp.sh('H2')),
          'houdini', '… with the OWNER''s slug');
SELECT is((SELECT name FROM public.otter_courses WHERE id = pg_temp.sh('H2')),
          'Houdini', '… and the owner''s course name');
SELECT is((SELECT visibility FROM public.otter_courses WHERE id = pg_temp.sh('H2')),
          'personal', '… personal');
SELECT is((SELECT hotkeys FROM public.otter_courses WHERE id = pg_temp.sh('H2')),
          '{"categories": []}'::jsonb, '… hotkeys at their default: nothing of the source course is copied');
SELECT is((SELECT created_by FROM public.otter_courses WHERE id = pg_temp.sh('H2')),
          'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, '… created_by the receiver (the audit trigger ran as them)');

INSERT INTO t103 VALUES ('H3', public.otter_subject_share_accept(pg_temp.sh('SH3')));
SELECT is((SELECT slug FROM public.otter_courses WHERE id = pg_temp.sh('H3')),
          'shared-topic', 'd accepts SH3: a D-side course for the shared course''s slug');

INSERT INTO t103 VALUES ('H7', public.otter_subject_share_accept(pg_temp.sh('SH7')));
SELECT is(pg_temp.sh('H7'), pg_temp.sh('H2'),
          'd accepts SH7 (the stub): it lands in the Houdini course just made (the same slug, a second link in one host)');

-- ── 5. After accept ─────────────────────────────────────────────────────────
-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000001'),
          1, 'after accepting, d reads S1 (the arm)');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000002'),
          0, '… but not S2, the course''s other subject');
SELECT is((SELECT count(*)::int FROM public.otter_courses WHERE id = '0c000103-0000-0000-0000-000000000001'),
          0, '… nor C1 itself (0022''s rule kept)');
SELECT is((SELECT count(*)::int FROM public.otter_courses WHERE id = '0c000103-0000-0000-0000-000000000001' AND hotkeys IS NOT NULL),
          0, '… nor C1''s hotkeys through the table');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE course_id = '0c000103-0000-0000-0000-000000000001'),
          1, 'subject.list on the owner''s course id lists exactly the linked subject (the second door, consented)');
SELECT is((SELECT id FROM public.otter_subjects WHERE course_id = '0c000103-0000-0000-0000-000000000001'),
          '05000103-0000-0000-0000-000000000001'::uuid, '… which is S1');

WITH upd AS (
  UPDATE public.otter_subjects SET description = 'edited by the receiver'
   WHERE id = '05000103-0000-0000-0000-000000000001' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0, 'd cannot UPDATE S1: a link is read-only');

SELECT throws_ok($$
  INSERT INTO public.otter_subjects (workspace_id, course_id, owner_id, slug, title)
  VALUES ('11111111-1111-1111-1111-111111111111', '0c000103-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'sneak', 'Sneak')
$$, '42501', 'new row violates row-level security policy for table "otter_subjects"',
  'd cannot INSERT a subject into C1');

-- The client's progress shape: the receiver's OWN row for their HOST course,
-- the linked subject under 'link:<subject_id>' (design §1.3).
SELECT lives_ok($$
  INSERT INTO public.otter_progress (workspace_id, course_id, user_id, completed_lessons)
  VALUES ('11111111-1111-1111-1111-111111111111', '0c000103-0000-0000-0000-000000000011', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
          jsonb_build_object('link:05000103-0000-0000-0000-000000000001',
            jsonb_build_object('completed_lessons', jsonb_build_array('lesson_1_1'),
                               'last_accessed', '2026-10-27T00:00:00Z')))
  ON CONFLICT (course_id, user_id) DO UPDATE SET completed_lessons = EXCLUDED.completed_lessons
$$, 'd upserts progress on D1 under the link key');

SELECT is((SELECT completed_lessons->'link:05000103-0000-0000-0000-000000000001'->'completed_lessons'
             FROM public.otter_progress WHERE course_id = '0c000103-0000-0000-0000-000000000011' AND user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
          '["lesson_1_1"]'::jsonb, '… and reads it back');

SELECT lives_ok($$
  INSERT INTO public.otter_progress (workspace_id, course_id, user_id, completed_lessons)
  VALUES ('11111111-1111-1111-1111-111111111111', pg_temp.sh('H2'), 'dddddddd-dddd-dddd-dddd-dddddddddddd',
          jsonb_build_object('link:05000103-0000-0000-0000-000000000003',
            jsonb_build_object('completed_lessons', jsonb_build_array('lesson_1_1'),
                               'last_accessed', '2026-10-27T00:00:00Z')))
  ON CONFLICT (course_id, user_id) DO UPDATE SET completed_lessons = EXCLUDED.completed_lessons
$$, 'd upserts progress on the Houdini host under S3''s link key (read back after the purge, group 8)');

SELECT throws_ok($$
  INSERT INTO public.otter_progress (workspace_id, course_id, user_id)
  VALUES ('11111111-1111-1111-1111-111111111111', '0c000103-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd')
$$, '42501', 'new row violates row-level security policy for table "otter_progress"',
  'progress on C1 (the owner''s course) is refused: the course is not readable');

SELECT is(public.otter_has_accepted_subject_share('05000103-0000-0000-0000-000000000001'), true,  'the helper is true for d on S1');
SELECT is(public.otter_has_accepted_subject_share('05000103-0000-0000-0000-000000000002'), false, '… and false for d on S2');

-- as e, the third person
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000001'),
          0, 'e reads nothing of S1');
SELECT is(public.otter_has_accepted_subject_share('05000103-0000-0000-0000-000000000001'), false, 'the helper is false for e');

-- as b, active in workspace B
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000001'),
          0, 'another workspace reads nothing of S1');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000002'),
          0, '… nor of S2');
SELECT is((SELECT count(*)::int FROM public.otter_courses WHERE id = '0c000103-0000-0000-0000-000000000001'),
          0, '… nor of C1');

-- as c, the owner
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_progress WHERE course_id = '0c000103-0000-0000-0000-000000000011'),
          0, 'the owner cannot read the receiver''s progress row (each person''s own progression)');
SELECT is(public.otter_has_accepted_subject_share('05000103-0000-0000-0000-000000000001'), false, 'the helper is false for the owner (not a receiver)');

WITH upd AS (
  UPDATE public.otter_subjects SET description = 'edited by the owner'
   WHERE id = '05000103-0000-0000-0000-000000000001' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1, 'the owner still edits S1: the receiver reads the edit live');

-- ── 6. The forged row ───────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT is(coalesce(current_setting('wilson.otter_subject_share_insert', true), ''), '',
          'CONTROL: the insert arm reads empty before the runner arms it');

-- (the receiver is g, whom no later row names for S1: a guard mutated to
-- drop this invariant then lands the row and the probe reddens, instead of
-- the forged SH5 below colliding with it on the live index.)
SELECT set_config('wilson.otter_subject_share_insert', '05000103-0000-0000-0000-000000000001', true);
SELECT throws_ok($$
  INSERT INTO public.otter_subject_shares
    (workspace_id, subject_id, shared_by, shared_with, subject_title, course_name, subject_owner_id)
  VALUES ('22222222-2222-2222-2222-222222222222', '05000103-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7', 'Modifiers', 'Blender 5.0', 'cccccccc-cccc-cccc-cccc-cccccccccccc')
$$, 'a subject share names a subject of its own workspace',
  'an ARMED insert naming workspace B and subject S1 is refused: the guard''s workspace invariant binds the runner too');
SELECT set_config('wilson.otter_subject_share_insert', '', true);

-- With the trigger OFF the forgery lands: it must satisfy every CHECK and
-- NOT NULL nothing else stamps for it (the status, a host, responded_at, the
-- snapshots, subject_owner_id, chain_depth).
ALTER TABLE public.otter_subject_shares DISABLE TRIGGER trg_otter_subject_share_guard;
INSERT INTO public.otter_subject_shares
  (id, workspace_id, subject_id, shared_by, shared_with, status, subject_title, course_name,
   host_course_id, responded_at, subject_owner_id, chain_depth)
VALUES
  ('e5000103-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', '05000103-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'accepted', 'Modifiers', 'Blender 5.0',
   '0c000103-0000-0000-0000-0000000000f5', now(), 'cccccccc-cccc-cccc-cccc-cccccccccccc', 1),
  -- SH5P: the same forgery left PENDING, so b can try to accept it (the
  -- accept's workspace belt); the runner removes it again below.
  ('e5000103-0000-0000-0000-000000000015', '22222222-2222-2222-2222-222222222222', '05000103-0000-0000-0000-000000000002', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'pending', 'Rigging', 'Blender 5.0',
   NULL, NULL, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 1);
ALTER TABLE public.otter_subject_shares ENABLE TRIGGER trg_otter_subject_share_guard;

SELECT is((SELECT count(*)::int FROM public.otter_subject_shares WHERE id = 'e5000103-0000-0000-0000-000000000005'),
          1, 'SH5, a cross-workspace row, is forged with the guard off');

-- as b, active in workspace B
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222');
SELECT is(public.otter_has_accepted_subject_share('05000103-0000-0000-0000-000000000001'), false,
          'the helper is FALSE for b on S1: the subject''s workspace is not the share''s (the belt)');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000001'),
          0, '… b reads nothing of S1 through the forged row');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index()),
          0, '… and b''s index is EMPTY: the index lists no cross-tenant row (the belt, repeated)');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares WHERE id = 'e5000103-0000-0000-0000-000000000005'),
          1, '… though the raw row itself is readable to b (its workspace, its party): the belts are what keep it inert');
SELECT throws_ok($$SELECT public.otter_subject_share_accept('e5000103-0000-0000-0000-000000000015')$$,
  'subject not found in this workspace',
  'b cannot accept SH5P, a forged pending cross-workspace row: the accept''s workspace belt');
-- The b column of the matrix, the four function cells: another workspace's
-- rows are not found from here.
SELECT throws_ok($$SELECT public.otter_subject_share_accept(pg_temp.sh('SH1'))$$,
  'share not found in this workspace', 'b cannot accept SH1');
SELECT throws_ok($$SELECT public.otter_subject_share_decline(pg_temp.sh('SH4'))$$,
  'share not found in this workspace', 'b cannot decline SH4');
SELECT throws_ok($$SELECT public.otter_subject_share_revoke(pg_temp.sh('SH1'))$$,
  'share not found in this workspace', 'b cannot revoke SH1');
SELECT throws_ok($$SELECT public.otter_subject_share_course('0c000103-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL)$$,
  'course not found in this workspace', 'b cannot share C1 whole');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
DELETE FROM public.otter_subject_shares WHERE id = 'e5000103-0000-0000-0000-000000000015';
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares WHERE id = 'e5000103-0000-0000-0000-000000000015'),
          0, 'the runner removes SH5P (one probe, no function ran on it)');

SELECT is(coalesce(current_setting('wilson.otter_subject_share_update', true), ''), '',
          'CONTROL: the update arm reads empty before the runner''s unarmed update');
SELECT throws_ok($$
  UPDATE public.otter_subject_shares SET message = 'rewritten by the runner'
   WHERE id = pg_temp.sh('SH4')
$$, 'a subject share changes through accept, decline or revoke, not by updating a row',
  'an UNARMED update raises even for the runner: the guard binds every role');

SELECT set_config('wilson.otter_subject_share_update', pg_temp.sh('SH1')::text, true);
UPDATE public.otter_subject_shares SET host_course_id = '0c000103-0000-0000-0000-0000000000f5' WHERE id = pg_temp.sh('SH1');
SELECT is((SELECT host_course_id FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH1')),
          '0c000103-0000-0000-0000-000000000011'::uuid, 'an armed update with NO status change cannot move host_course_id (the no-transition arm)');
-- The guard's transition table (§1.1's half the functions never reach),
-- armed, as the runner: each raises, so nothing moves.
SELECT throws_ok($$
  UPDATE public.otter_subject_shares SET status = 'declined' WHERE id = pg_temp.sh('SH1')
$$, 'a subject share cannot move from accepted to declined',
  'an armed update cannot move an accepted share to declined');
SELECT throws_ok($$
  UPDATE public.otter_subject_shares SET status = 'revoked' WHERE id = pg_temp.sh('SH1')
$$, 'a revoked share records who ended it',
  'an armed revoke without ended_by is refused');
SELECT set_config('wilson.otter_subject_share_update', '', true);
SELECT set_config('wilson.otter_subject_share_update', pg_temp.sh('SH4')::text, true);
SELECT throws_ok($$
  UPDATE public.otter_subject_shares SET status = 'accepted' WHERE id = pg_temp.sh('SH4')
$$, 'accepting places the subject in a course',
  'an armed accept without a host is refused');
SELECT set_config('wilson.otter_subject_share_update', '', true);
SELECT set_config('wilson.otter_subject_share_insert', '05000103-0000-0000-0000-000000000006', true);
SELECT throws_ok($$
  INSERT INTO public.otter_subject_shares
    (workspace_id, subject_id, shared_by, shared_with, status, subject_title, course_name,
     host_course_id, responded_at, subject_owner_id)
  VALUES ('11111111-1111-1111-1111-111111111111', '05000103-0000-0000-0000-000000000006', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'abababab-abab-abab-abab-abababababab', 'accepted', 'Materials', 'Blender 5.0', '0c000103-0000-0000-0000-0000000000f5', now(), 'cccccccc-cccc-cccc-cccc-cccccccccccc')
$$, 'a new subject share starts pending, with nothing decided',
  'an armed insert that starts accepted is refused');
SELECT set_config('wilson.otter_subject_share_insert', '', true);
-- The three provenance pins, probed on SH3 (accepted; no chain hangs from it,
-- so a guard mutated to drop the pins lands the move and these redden without
-- the later chain aborting the file). Owner e, not d: a row naming its
-- receiver as the owner fails the CHECK before any pin could be measured.
SELECT set_config('wilson.otter_subject_share_update', pg_temp.sh('SH3')::text, true);
UPDATE public.otter_subject_shares
   SET via_share_id = pg_temp.sh('SH4'), subject_owner_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', chain_depth = 5
 WHERE id = pg_temp.sh('SH3');
SELECT is((SELECT via_share_id FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH3')),
          NULL::uuid, '… nor via_share_id (pinned)');
SELECT is((SELECT subject_owner_id FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH3')),
          'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, '… nor subject_owner_id (pinned)');
SELECT is((SELECT chain_depth FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH3')),
          1::smallint, '… nor chain_depth (pinned)');
SELECT set_config('wilson.otter_subject_share_update', '', true);

-- ── 7. Decline ──────────────────────────────────────────────────────────────
-- as c, the owner
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT throws_ok($$SELECT public.otter_subject_share_decline(pg_temp.sh('SH4'))$$,
  'only the person it was shared with may decline it',
  'the owner cannot decline their own offer');

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT throws_ok($$SELECT public.otter_subject_share_decline(pg_temp.sh('SH4'))$$,
  'only the person it was shared with may decline it',
  'd cannot decline SH4 (not its receiver)');

-- as e, the third person
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT throws_ok($$SELECT public.otter_subject_share_revoke(pg_temp.sh('SH4'))$$,
  'this share is still waiting for your answer — decline it instead',
  'a receiver cannot REMOVE a pending offer: they decline it (S3)');

SELECT lives_ok($$SELECT public.otter_subject_share_decline(pg_temp.sh('SH4'))$$,
  'e declines SH4');
SELECT is((SELECT status FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH4')),
          'declined', 'SH4 is declined');
SELECT ok((SELECT responded_at IS NOT NULL FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH4')),
          '… responded_at stamped');
SELECT is((SELECT host_course_id FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH4')),
          NULL::uuid, '… host stays null');

SELECT throws_ok($$SELECT public.otter_subject_share_decline(pg_temp.sh('SH4'))$$,
  'this share is declined — only a pending share can be declined',
  'declining twice is refused');

SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000002'),
          0, 'e reads nothing of S2: nothing was opened');

-- as c, the owner
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
UPDATE public.otter_subjects SET title = 'Rigging II' WHERE id = '05000103-0000-0000-0000-000000000002';
SELECT is((SELECT title FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000002'),
          'Rigging II', 'the owner renames S2 (a live edit after the decline)');
SELECT is((SELECT subject_title FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH4')),
          'Rigging II', 'the owner''s index shows SH4 declined with the LIVE title (the record)');
SELECT is((SELECT state FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH4')),
          'declined', '… state declined');

-- as e, the third person
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT subject_title FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH4')),
          'Rigging', 'the ex-receiver''s index shows the SNAPSHOT ("Rigging"), never the live title');
SELECT is((SELECT course_name FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH4')),
          'Blender 5.0', '… and the course name as it was');
SELECT is((SELECT course_slug FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH4')),
          NULL::text, '… course_slug null');
SELECT is((SELECT course_id FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH4')),
          NULL::uuid, '… course_id null');
SELECT is((SELECT subject_is_stub FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH4')),
          NULL::boolean, '… is_stub null: nothing live');

-- Nothing reopens: the guard's transition table, armed, as the runner.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('wilson.otter_subject_share_update', pg_temp.sh('SH4')::text, true);
SELECT throws_ok($$
  UPDATE public.otter_subject_shares SET status = 'accepted', host_course_id = '0c000103-0000-0000-0000-0000000000f5'
   WHERE id = pg_temp.sh('SH4')
$$, 'a subject share cannot move from declined to accepted',
  'an armed update cannot reopen a declined share as accepted');
SELECT throws_ok($$
  UPDATE public.otter_subject_shares SET status = 'pending' WHERE id = pg_temp.sh('SH4')
$$, 'a subject share cannot move from declined to pending',
  '… nor as pending');
SELECT set_config('wilson.otter_subject_share_update', '', true);

-- ── 8. Trash, restore, purge ────────────────────────────────────────────────
-- as c, the owner
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT ok(public.otter_soft_delete_row('otter_subjects', '05000103-0000-0000-0000-000000000003'), 'the owner trashes S3');

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000003'),
          0, 'd reads nothing of S3 while it sits in the trash');
SELECT is((SELECT state FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH2')),
          'gone', 'd''s index shows SH2 as gone');
SELECT is((SELECT status FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH2')),
          'accepted', '… while the stored status stays accepted (gone is derived)');
SELECT is(public.otter_has_accepted_subject_share('05000103-0000-0000-0000-000000000003'), false, '… and the helper is false meanwhile');

-- as c, the owner
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT ok(public.otter_restore_row('otter_subjects', '05000103-0000-0000-0000-000000000003'), 'the owner restores S3');

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000003'),
          1, 'd reads S3 again: the link resumes with nothing to redo');
SELECT is((SELECT state FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH2')),
          'accepted', '… and SH2 reads accepted again');

-- as c, the owner
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
INSERT INTO t103 VALUES ('SH8', public.otter_subject_share('05000103-0000-0000-0000-000000000005', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', NULL));
SELECT ok(pg_temp.sh('SH8') IS NOT NULL, 'SH8: the stub S5 offered to e');
SELECT ok(public.otter_soft_delete_row('otter_subjects', '05000103-0000-0000-0000-000000000005'), 'the owner trashes S5 before e answers');

-- as e, the third person
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT throws_ok($$SELECT public.otter_subject_share_accept(pg_temp.sh('SH8'))$$,
  'that subject no longer exists',
  'a pending share whose subject is in the trash cannot be accepted');
SELECT is((SELECT state FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH8')),
          'gone', '… and SH8 reads gone to e');

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT state FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH7')),
          'gone', 'd''s accepted SH7 (the same S5) reads gone meanwhile');

-- as c, the owner
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT ok(public.otter_restore_row('otter_subjects', '05000103-0000-0000-0000-000000000005'), 'the owner restores S5');

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT state FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH7')),
          'accepted', '… and SH7 is accepted again');

-- The purge (what purge_otter_trash does after 30 days), as the runner.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
DELETE FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000003';
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH2')),
          0, 'the purge hard-deletes S3 and SH2''s row goes with it (ON DELETE CASCADE: "it disappears if I delete it")');

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT completed_lessons->'link:05000103-0000-0000-0000-000000000003'->'completed_lessons'
             FROM public.otter_progress WHERE course_id = pg_temp.sh('H2') AND user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
          '["lesson_1_1"]'::jsonb, 'd''s progress on the Houdini host still holds the link key: the row is theirs');

-- ── 9. The owner leaves, the receiver leaves ────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
UPDATE public.workspace_members SET is_active = false WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000001'),
          1, 'with the OWNER deactivated, d still reads S1 (S4: the link stays live; S1 is in a PERSONAL course, so only the arm opens it)');

-- as c, the owner
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT throws_ok($$SELECT public.otter_subject_share_revoke(pg_temp.sh('SH1'))$$,
  'not_a_workspace_member', 'a deactivated owner cannot revoke');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
UPDATE public.workspace_members SET is_active = true  WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
UPDATE public.workspace_members SET is_active = false WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000001'),
          0, 'a deactivated RECEIVER reads nothing');
SELECT throws_ok($$SELECT count(*) FROM public.otter_subject_shares_index()$$,
  'not_a_workspace_member', '… and their index raises');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
UPDATE public.workspace_members SET is_active = true WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000001'),
          1, 'reactivated, d reads S1 again');

-- ── 9b. Passing it on (the chain, §1.4) ─────────────────────────────────────
-- as e, the third person
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT throws_ok($$SELECT public.otter_subject_share('05000103-0000-0000-0000-000000000001', 'abababab-abab-abab-abab-abababababab', NULL)$$,
  'only the owner of a course, or someone who accepted a share of this subject, may share it',
  'e cannot pass S1 on before holding it');

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
INSERT INTO t103 VALUES ('SH9', public.otter_subject_share('05000103-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Passing this on'));
SELECT ok(pg_temp.sh('SH9') IS NOT NULL, 'SH9: d (who accepted SH1) passes S1 on to e');
SELECT is((SELECT via_share_id FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH9')),
          pg_temp.sh('SH1'), '… SH9 hangs from SH1');
SELECT is((SELECT subject_owner_id FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH9')),
          'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, '… and names the live owner, c');
SELECT is((SELECT chain_depth FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH9')),
          2::smallint, '… depth 2');
SELECT is((SELECT batch_id FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH9')),
          NULL::uuid, '… no batch');
SELECT is((SELECT shared_by FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH9')),
          'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, '… shared_by d');
SELECT is((SELECT status FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH9')),
          'pending', '… pending');

-- as e, the third person
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT throws_ok($$SELECT public.otter_subject_share('05000103-0000-0000-0000-000000000001', 'abababab-abab-abab-abab-abababababab', NULL)$$,
  'only the owner of a course, or someone who accepted a share of this subject, may share it',
  'e cannot pass S1 on while SH9 is only pending');

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT throws_ok($$SELECT public.otter_subject_share('05000103-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', NULL)$$,
  'that is their own subject',
  'd cannot pass S1 to its owner');

-- as e, the third person
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
INSERT INTO t103 VALUES ('E1', public.otter_subject_share_accept(pg_temp.sh('SH9')));
SELECT is((SELECT slug FROM public.otter_courses WHERE id = pg_temp.sh('E1')),
          'blender-5-0', 'e accepts SH9: a new course of e''s with the OWNER''s slug (not d''s D1 by name)');
SELECT is((SELECT name FROM public.otter_courses WHERE id = pg_temp.sh('E1')),
          'Blender 5.0', '… and the owner''s course name');
SELECT is((SELECT owner_id FROM public.otter_courses WHERE id = pg_temp.sh('E1')),
          'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, '… owned by e');
SELECT is((SELECT visibility FROM public.otter_courses WHERE id = pg_temp.sh('E1')),
          'personal', '… personal');
SELECT is((SELECT status FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH9')),
          'accepted', '… SH9 accepted');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000001'),
          1, 'e reads S1 through the chain');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000002'),
          0, '… and nothing of S2');
SELECT is((SELECT count(*)::int FROM public.otter_courses WHERE id = '0c000103-0000-0000-0000-000000000001'),
          0, '… nor of C1');
SELECT is(public.otter_has_accepted_subject_share('05000103-0000-0000-0000-000000000001'), true, 'the helper is true for e: the chain is whole');

INSERT INTO t103 VALUES ('SH10', public.otter_subject_share('05000103-0000-0000-0000-000000000001', 'abababab-abab-abab-abab-abababababab', NULL));
SELECT is((SELECT via_share_id FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH10')),
          pg_temp.sh('SH9'), 'SH10: e passes S1 on to h, hanging from SH9');
SELECT is((SELECT chain_depth FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH10')),
          3::smallint, '… depth 3');

-- as h, a plain member (the end of the chain)
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('abababab-abab-abab-abab-abababababab', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index()),
          1, 'h''s index lists SH10 only');
SELECT is((SELECT owner_label FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH10')),
          'User C', '… with the owner''s label');
SELECT is((SELECT sharer_label FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH10')),
          'User E', '… and the sharer''s (the two differ on an onward offer)');
SELECT is((SELECT subject_title FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH10')),
          'Modifiers', '… the title');
SELECT is((SELECT course_id FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH10')),
          NULL::uuid, '… and the pending receiver''s nulls before accepting');

INSERT INTO t103 VALUES ('HH', public.otter_subject_share_accept(pg_temp.sh('SH10')));
SELECT is((SELECT owner_id FROM public.otter_courses WHERE id = pg_temp.sh('HH')),
          'abababab-abab-abab-abab-abababababab'::uuid, 'h accepts SH10: a course of h''s');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000001'),
          1, 'h reads S1 (three links from the owner)');
SELECT is(public.otter_has_accepted_subject_share('05000103-0000-0000-0000-000000000001'), true, 'the helper is true for h');

SELECT throws_ok($$SELECT public.otter_subject_share('05000103-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', NULL)$$,
  'that is their own subject', 'h cannot pass S1 to its owner');

-- as e, the third person
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT throws_ok($$SELECT public.otter_subject_share('05000103-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', NULL)$$,
  'this subject is already shared with that person',
  'e cannot pass S1 back to d: d holds SH1 live (a chain cannot circle)');

-- The rows each person sees.
-- as c, the owner
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index()
            WHERE id IN (pg_temp.sh('SH1'), pg_temp.sh('SH9'), pg_temp.sh('SH10'))),
          3, 'the owner''s index lists the whole chain SH1, SH9, SH10');
SELECT is((SELECT bool_and(is_owner) FROM public.otter_subject_shares_index()
            WHERE id IN (pg_temp.sh('SH1'), pg_temp.sh('SH9'), pg_temp.sh('SH10'))),
          true, '… is_owner true on all three');
SELECT is((SELECT via_share_id FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH9')),
          pg_temp.sh('SH1'), '… SH9 via SH1');
SELECT is((SELECT via_share_id FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH10')),
          pg_temp.sh('SH9'), '… SH10 via SH9');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index()
            WHERE id IN (pg_temp.sh('SH1'), pg_temp.sh('SH9'), pg_temp.sh('SH10'))
              AND owner_label = 'User C'),
          3, '… owner_label "User C" on all three');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares
            WHERE id IN (pg_temp.sh('SH1'), pg_temp.sh('SH9'), pg_temp.sh('SH10'))),
          3, 'through the table, the owner reads all three rows (the owner''s arm)');

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index()
            WHERE id IN (pg_temp.sh('SH1'), pg_temp.sh('SH9'))),
          2, 'd''s index lists SH1 (received) and SH9 (made)');
SELECT is((SELECT is_mine FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH9')),
          true, '… SH9 is_mine');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH10')),
          0, '… and not SH10');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares
            WHERE id IN (pg_temp.sh('SH1'), pg_temp.sh('SH9'))),
          2, 'through the table, d reads SH1 and SH9');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH10')),
          0, '… and not SH10');

-- as e, the third person
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index()
            WHERE id IN (pg_temp.sh('SH9'), pg_temp.sh('SH10'))),
          2, 'e''s index lists SH9 (received) and SH10 (made)');
SELECT is((SELECT sharer_label FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH9')),
          'User D', '… SH9''s sharer is d');
SELECT is((SELECT owner_label FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH9')),
          'User C', '… and its owner c');
SELECT is((SELECT is_mine FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH10')),
          true, '… SH10 is_mine');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          0, '… and not SH1');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares
            WHERE id IN (pg_temp.sh('SH9'), pg_temp.sh('SH10'))),
          2, 'through the table, e reads SH9 and SH10');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH1')),
          0, '… and not SH1');

-- as h, a plain member (the end of the chain)
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('abababab-abab-abab-abab-abababababab', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index()),
          1, 'h''s index lists SH10 only');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares),
          1, 'through the table, h reads SH10 only');

-- as a, the ADMIN (claims by hand: tests.login_as sets no app_role)
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index()),
          0, 'an admin lists none of the chain');

-- as g, a granted editor on C1
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index()),
          0, 'g lists none of the chain');

-- The guard's two new invariants, with the trigger ON (armed by the runner).
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('wilson.otter_subject_share_insert', '05000103-0000-0000-0000-000000000002', true);
SELECT throws_ok($$
  INSERT INTO public.otter_subject_shares
    (workspace_id, subject_id, shared_by, shared_with, subject_title, course_name,
     subject_owner_id, via_share_id, chain_depth)
  VALUES ('11111111-1111-1111-1111-111111111111', '05000103-0000-0000-0000-000000000002', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7', 'Rigging II', 'Blender 5.0', 'cccccccc-cccc-cccc-cccc-cccccccccccc', pg_temp.sh('SH4'), 2)
$$, 'an onward share links to the accepted share its sharer holds',
  'an ARMED onward row hanging from a DECLINED link is refused (the guard''s link invariant)');
SELECT set_config('wilson.otter_subject_share_insert', '', true);

SELECT set_config('wilson.otter_subject_share_insert', '05000103-0000-0000-0000-000000000001', true);
SELECT throws_ok($$
  INSERT INTO public.otter_subject_shares
    (workspace_id, subject_id, shared_by, shared_with, subject_title, course_name, subject_owner_id)
  VALUES ('11111111-1111-1111-1111-111111111111', '05000103-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7', 'Modifiers', 'Blender 5.0', 'dddddddd-dddd-dddd-dddd-dddddddddddd')
$$, 'a subject share names the owner of its subject''s course',
  'an ARMED owner-made row naming d as the owner is refused (the guard''s owner invariant)');
SELECT set_config('wilson.otter_subject_share_insert', '', true);

SELECT set_config('wilson.otter_subject_share_insert', '05000103-0000-0000-0000-000000000006', true);
SELECT throws_ok($$
  INSERT INTO public.otter_subject_shares
    (workspace_id, subject_id, shared_by, shared_with, subject_title, course_name,
     subject_owner_id, chain_depth)
  VALUES ('11111111-1111-1111-1111-111111111111', '05000103-0000-0000-0000-000000000006', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'abababab-abab-abab-abab-abababababab', 'Materials', 'Blender 5.0', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 9)
$$, '23514', NULL, 'an ARMED row at depth 9 is refused by the CHECK (a chain is at most eight links)');
SELECT set_config('wilson.otter_subject_share_insert', '', true);

-- The forged onward rows, with the trigger OFF: SHX hangs from a DECLINED link
-- (a link that does not resolve); SHZ sits at depth 8 under a depth-1 row (a
-- chain at the bound, with a link that is not whole); SHV is a root row that
-- misnames its owner; SHW hangs from SH1, which was shared with d, not with
-- its sharer e. SHV and SHW exist for one probe each and the runner removes
-- them again, so no function runs on them and the audit counts stand.
ALTER TABLE public.otter_subject_shares DISABLE TRIGGER trg_otter_subject_share_guard;
INSERT INTO public.otter_subject_shares
  (id, workspace_id, subject_id, shared_by, shared_with, status, subject_title, course_name,
   host_course_id, responded_at, subject_owner_id, via_share_id, chain_depth)
VALUES
  ('e5000103-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '05000103-0000-0000-0000-000000000002', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'abababab-abab-abab-abab-abababababab', 'accepted', 'Rigging II', 'Blender 5.0',
   '0c000103-0000-0000-0000-0000000000f5', now(), 'cccccccc-cccc-cccc-cccc-cccccccccccc', pg_temp.sh('SH4'), 2),
  ('e5000103-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', '05000103-0000-0000-0000-000000000004', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'abababab-abab-abab-abab-abababababab', 'accepted', 'Shared Sub', 'Shared Topic',
   '0c000103-0000-0000-0000-0000000000f5', now(), 'cccccccc-cccc-cccc-cccc-cccccccccccc', pg_temp.sh('SH3'), 8),
  ('e5000103-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', '05000103-0000-0000-0000-000000000006', 'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'accepted', 'Materials', 'Blender 5.0',
   '0c000103-0000-0000-0000-0000000000f5', now(), 'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7', NULL, 1),
  ('e5000103-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', '05000103-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'accepted', 'Modifiers', 'Blender 5.0',
   '0c000103-0000-0000-0000-0000000000f5', now(), 'cccccccc-cccc-cccc-cccc-cccccccccccc', pg_temp.sh('SH1'), 2),
  -- SHU and SHT, two PENDING forgeries for the accept's two other belts (a
  -- root row misnaming its owner; an onward row under a declined link), each
  -- for one probe, removed by the runner below.
  ('e5000103-0000-0000-0000-00000000000e', '11111111-1111-1111-1111-111111111111', '05000103-0000-0000-0000-000000000004', 'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'pending', 'Shared Sub', 'Shared Topic',
   NULL, NULL, 'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7', NULL, 1),
  ('e5000103-0000-0000-0000-00000000000f', '11111111-1111-1111-1111-111111111111', '05000103-0000-0000-0000-000000000002', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'pending', 'Rigging II', 'Blender 5.0',
   NULL, NULL, 'cccccccc-cccc-cccc-cccc-cccccccccccc', pg_temp.sh('SH4'), 2);
ALTER TABLE public.otter_subject_shares ENABLE TRIGGER trg_otter_subject_share_guard;

-- as h, a plain member (the end of the chain)
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('abababab-abab-abab-abab-abababababab', '11111111-1111-1111-1111-111111111111');
SELECT is(public.otter_has_accepted_subject_share('05000103-0000-0000-0000-000000000002'), false,
          'SHX (accepted, hanging from a DECLINED link): the helper is false for h');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000002'),
          0, '… h reads nothing of S2');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index() WHERE id = 'e5000103-0000-0000-0000-00000000000a'),
          0, '… h''s index does not list SHX');
SELECT throws_ok($$SELECT public.otter_subject_share_accept('e5000103-0000-0000-0000-00000000000a')$$,
  'this share is accepted — only a pending share can be accepted',
  '… and h cannot accept it (it already says accepted)');
-- The row-maker's chain lock: h holds SHX accepted, so standing passes and
-- the walk up reaches SH4; the re-read under FOR SHARE finds it declined and
-- refuses (the helper, run after, is the belt that would say the same).
SELECT throws_ok($$SELECT public.otter_subject_share('05000103-0000-0000-0000-000000000002', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', NULL)$$,
  'this subject is no longer shared with you',
  '… and h cannot pass S2 on: the chain lock re-reads the link above and finds it not accepted');

-- as e, the third person
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index() WHERE id = 'e5000103-0000-0000-0000-00000000000a'),
          0, '… nor does e''s index (the sharer it names)');

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index() WHERE id = 'e5000103-0000-0000-0000-00000000000a'),
          0, '… nor does d''s (d is nobody to SHX)');

-- as c, the owner
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT state FROM public.otter_subject_shares_index() WHERE id = 'e5000103-0000-0000-0000-00000000000a'),
          'gone', '… the owner''s index lists SHX as gone (a link that does not resolve)');
SELECT lives_ok($$SELECT public.otter_subject_share_revoke('e5000103-0000-0000-0000-00000000000a')$$,
  'the owner ends SHX (any row of their subject)');
SELECT is((SELECT ended_by FROM public.otter_subject_shares WHERE id = 'e5000103-0000-0000-0000-00000000000a'),
          'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, '… ended_by c');
SELECT is((SELECT status FROM public.otter_subject_shares WHERE id = 'e5000103-0000-0000-0000-00000000000a'),
          'revoked', '… revoked');

-- as h, a plain member (the end of the chain)
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('abababab-abab-abab-abab-abababababab', '11111111-1111-1111-1111-111111111111');
SELECT throws_ok($$SELECT public.otter_subject_share('05000103-0000-0000-0000-000000000004', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', NULL)$$,
  'this subject has been passed on as far as it can go',
  'SHZ (depth 8): h cannot pass S4 on, the chain is at its bound (the arm runs before the walk)');
SELECT is(public.otter_has_accepted_subject_share('05000103-0000-0000-0000-000000000004'), false,
          '… the helper is false for h on S4 (SHZ''s depth does not fit SH3''s)');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000004'),
          1, '… h reads S4 through 0022''s shared arm only (a shared course): nothing new opens');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index() WHERE id = 'e5000103-0000-0000-0000-00000000000b'),
          0, '… h''s index hides SHZ');

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index() WHERE id = 'e5000103-0000-0000-0000-00000000000b'),
          0, '… so does d''s (the sharer it names)');

-- as c, the owner
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT state FROM public.otter_subject_shares_index() WHERE id = 'e5000103-0000-0000-0000-00000000000b'),
          'gone', '… the owner''s index lists SHZ as gone from the start (its link is not whole)');

-- as g, a granted editor on C1
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT is_owner FROM public.otter_subject_shares_index() WHERE id = 'e5000103-0000-0000-0000-00000000000c'),
          false, 'SHV (a root row forged to name g as the owner): g''s index does NOT call g the owner (is_owner reads the live course)');
SELECT is((SELECT state FROM public.otter_subject_shares_index() WHERE id = 'e5000103-0000-0000-0000-00000000000c'),
          'gone', '… and lists it as gone (the course is not g''s)');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares WHERE id = 'e5000103-0000-0000-0000-00000000000c'),
          1, '… the raw row is readable to g: the policy trusts the column (the in-tenant residual, design §10)');

-- as a, the ADMIN (claims by hand: tests.login_as sets no app_role)
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);
SELECT is((SELECT is_owner FROM public.otter_subject_shares_index() WHERE id = 'e5000103-0000-0000-0000-00000000000c'),
          false, '… its receiver a lists SHV, is_owner false');
SELECT is((SELECT state FROM public.otter_subject_shares_index() WHERE id = 'e5000103-0000-0000-0000-00000000000c'),
          'gone', '… gone');
SELECT is(public.otter_has_accepted_subject_share('05000103-0000-0000-0000-000000000006'), false,
          '… and the helper is false for a: the root was not made by the live owner');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000006'),
          0, '… a reads nothing of S6');

-- as c, the owner
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT is_owner FROM public.otter_subject_shares_index() WHERE id = 'e5000103-0000-0000-0000-00000000000c'),
          true, 'the live owner c lists SHV as theirs');
SELECT is((SELECT state FROM public.otter_subject_shares_index() WHERE id = 'e5000103-0000-0000-0000-00000000000c'),
          'gone', '… as gone');

-- as a, the ADMIN (claims by hand: tests.login_as sets no app_role)
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);
SELECT is(public.otter_has_accepted_subject_share('05000103-0000-0000-0000-000000000001'), false,
          'SHW (accepted, hanging from SH1, which was shared with d and not with its sharer e): the helper is false for a');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000001'),
          0, '… a reads nothing of S1');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index() WHERE id = 'e5000103-0000-0000-0000-00000000000d'),
          0, '… a''s index hides SHW');

-- as c, the owner
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT state FROM public.otter_subject_shares_index() WHERE id = 'e5000103-0000-0000-0000-00000000000d'),
          'gone', '… the owner''s index lists SHW as gone');

-- as a, the ADMIN (claims by hand: tests.login_as sets no app_role)
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);
SELECT throws_ok($$SELECT public.otter_subject_share_accept('e5000103-0000-0000-0000-00000000000e')$$,
  'that subject has changed hands since it was shared',
  'SHU (a pending root row misnaming its owner): its receiver cannot accept it (the accept''s owner belt)');
SELECT throws_ok($$SELECT public.otter_subject_share_accept('e5000103-0000-0000-0000-00000000000f')$$,
  'the person who passed this on no longer has it',
  'SHT (a pending onward row under a DECLINED link): its receiver cannot accept it (the accept''s link belt)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
DELETE FROM public.otter_subject_shares WHERE id IN ('e5000103-0000-0000-0000-00000000000c', 'e5000103-0000-0000-0000-00000000000d', 'e5000103-0000-0000-0000-00000000000e', 'e5000103-0000-0000-0000-00000000000f');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares WHERE id IN ('e5000103-0000-0000-0000-00000000000c', 'e5000103-0000-0000-0000-00000000000d', 'e5000103-0000-0000-0000-00000000000e', 'e5000103-0000-0000-0000-00000000000f')),
          0, 'the runner removes the four forged probe rows (no function ran on them, no audit line: group 11''s counts stand)');

-- ── 9c. A whole course (the batch, §1.5) ────────────────────────────────────
-- as c, the owner
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
-- lives_ok, so a batch function mutated to raise mid-batch reddens here
-- instead of aborting the file (the failing control's shape, measured).
SELECT lives_ok($$INSERT INTO t103 VALUES ('BATCH', public.otter_subject_share_course('0c000103-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'The whole course'))$$,
  'the owner shares C1 whole with e');
SELECT ok(pg_temp.sh('BATCH') IS NOT NULL, '… and gets a batch id');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares WHERE batch_id = pg_temp.sh('BATCH')),
          2, 'exactly two rows carry it: S1 is SKIPPED (e holds SH9 live)');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares
            WHERE batch_id = pg_temp.sh('BATCH') AND subject_id IN ('05000103-0000-0000-0000-000000000002', '05000103-0000-0000-0000-000000000006')),
          2, '… the two are S2 and S6');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares
            WHERE batch_id = pg_temp.sh('BATCH') AND status = 'pending' AND shared_by = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
              AND via_share_id IS NULL AND chain_depth = 1),
          2, '… both pending, made by c, no link above, depth 1 (a batch row is a root)');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index()
            WHERE batch_id = pg_temp.sh('BATCH') AND is_owner),
          2, '… and the owner''s index lists both, is_owner true');
INSERT INTO t103 SELECT 'B2', id FROM public.otter_subject_shares
  WHERE batch_id = pg_temp.sh('BATCH') AND subject_id = '05000103-0000-0000-0000-000000000002';
INSERT INTO t103 SELECT 'B6', id FROM public.otter_subject_shares
  WHERE batch_id = pg_temp.sh('BATCH') AND subject_id = '05000103-0000-0000-0000-000000000006';
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares
            WHERE subject_id = '05000103-0000-0000-0000-000000000001' AND shared_with = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' AND status IN ('pending', 'accepted')),
          1, '… and S1 → e is still the one live row, SH9 (no second offer)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.app_events
            WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4110'
              AND context->>'batch_id' = pg_temp.sh('BATCH')::text),
          2, 'two more WIL-4110 lines, each context carrying the one batch id');

-- as e, the third person
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index() WHERE batch_id = pg_temp.sh('BATCH')),
          2, 'e''s index lists the two with the one batch_id (the inbox groups by it)');
SELECT is((SELECT course_id FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('B2')),
          NULL::uuid, '… with the pending receiver''s nulls');
SELECT is((SELECT subject_title FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('B6')),
          'Materials', '… and the titles');

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index() WHERE batch_id = pg_temp.sh('BATCH')),
          0, 'd''s index does not list the batch');

-- as e, the third person
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT lives_ok($$INSERT INTO t103 VALUES ('HB2', public.otter_subject_share_accept(pg_temp.sh('B2')))$$,
  'e accepts the S2 row');
SELECT is(pg_temp.sh('HB2'), pg_temp.sh('E1'),
          '… it lands in e''s EXISTING blender-5-0 host (the one made at SH9''s accept)');
SELECT lives_ok($$INSERT INTO t103 VALUES ('HB6', public.otter_subject_share_accept(pg_temp.sh('B6')))$$,
  'e accepts the S6 row');
SELECT is(pg_temp.sh('HB6'), pg_temp.sh('E1'), '… the same host');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000002'), 1, 'e reads S2');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000006'), 1, '… and S6');

-- as c, the owner
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT throws_ok($$SELECT public.otter_subject_share_course('0c000103-0000-0000-0000-000000000002', 'dddddddd-dddd-dddd-dddd-dddddddddddd', NULL)$$,
  'every subject of this course is already shared with that person',
  'C2 whole with d: after the purge C2 holds S5 only, and SH7 is live to d');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares WHERE subject_id = '05000103-0000-0000-0000-000000000005' AND shared_with = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
          1, '… and no row was made (SH7 alone)');
SELECT throws_ok($$SELECT public.otter_subject_share_course('0c000103-0000-0000-0000-000000000004', 'dddddddd-dddd-dddd-dddd-dddddddddddd', NULL)$$,
  'this course has no subjects',
  'C4 whole with d: an empty course');
SELECT throws_ok($$SELECT public.otter_subject_share_course('0c000103-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', NULL)$$,
  'choose a colleague to share it with',
  'C1 whole with yourself');
SELECT throws_ok($$SELECT public.otter_subject_share_course('0c000103-0000-0000-0000-000000000001', 'fafafafa-fafa-fafa-fafa-fafafafafafa', NULL)$$,
  'that person is not an active member of this workspace',
  'C1 whole with a deactivated member');

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT throws_ok($$SELECT public.otter_subject_share_course('0c000103-0000-0000-0000-000000000001', 'abababab-abab-abab-abab-abababababab', NULL)$$,
  'only the owner of a course may share it whole',
  'd cannot share C1 whole');

-- as e, the third person
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT throws_ok($$SELECT public.otter_subject_share_course('0c000103-0000-0000-0000-000000000001', 'abababab-abab-abab-abab-abababababab', NULL)$$,
  'only the owner of a course may share it whole',
  'e, who holds links to S1, S2 and S6, cannot share C1 whole either (a received batch is not passed on whole)');

-- as a, the ADMIN (claims by hand: tests.login_as sets no app_role)
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);
SELECT throws_ok($$SELECT public.otter_subject_share_course('0c000103-0000-0000-0000-000000000001', 'abababab-abab-abab-abab-abababababab', NULL)$$,
  'only the owner of a course may share it whole',
  'nor can an admin');

-- as c, the owner
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT lives_ok($$SELECT public.otter_subject_share_revoke(pg_temp.sh('B6'))$$,
  'A BATCH ROW IS A SINGLE ROW: the owner revokes the S6 row alone');
SELECT is((SELECT status FROM public.otter_subject_shares WHERE id = pg_temp.sh('B6')),
          'revoked', '… revoked');
SELECT is((SELECT ended_by FROM public.otter_subject_shares WHERE id = pg_temp.sh('B6')),
          'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, '… ended_by c');
SELECT is((SELECT status FROM public.otter_subject_shares WHERE id = pg_temp.sh('B2')),
          'accepted', '… the S2 row untouched, still accepted');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT is((SELECT context->>'ended_by_role' FROM public.app_events
            WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4113'
              AND context->>'share_id' = pg_temp.sh('B6')::text
            ORDER BY id LIMIT 1),
          'owner', '… its WIL-4113 line says owner');

-- as e, the third person
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000006'), 0, 'e reads S6 no more');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000002'), 1, '… and S2 still');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('wilson.otter_subject_share_update', pg_temp.sh('B2')::text, true);
UPDATE public.otter_subject_shares SET batch_id = NULL WHERE id = pg_temp.sh('B2');
SELECT is((SELECT batch_id FROM public.otter_subject_shares WHERE id = pg_temp.sh('B2')),
          pg_temp.sh('BATCH'), 'an armed no-transition update cannot move batch_id (pinned)');
SELECT set_config('wilson.otter_subject_share_update', '', true);

-- ── 10. Revoke, and the chain falls ─────────────────────────────────────────
-- as e, the third person
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT throws_ok($$SELECT public.otter_subject_share_revoke(pg_temp.sh('SH4'))$$,
  'this share is already declined — there is nothing to end',
  'a declined share cannot be revoked');
SELECT throws_ok($$SELECT public.otter_subject_share_revoke(pg_temp.sh('SH1'))$$,
  'only the owner of the subject, the person who shared it, or the person it was shared with may end this share',
  'e is nobody to SH1');

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT throws_ok($$SELECT public.otter_subject_share_revoke(pg_temp.sh('SH10'))$$,
  'only the owner of the subject, the person who shared it, or the person it was shared with may end this share',
  'd is nobody to SH10 (h''s row, made by e)');

-- as c, the owner
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT lives_ok($$SELECT public.otter_subject_share_revoke(pg_temp.sh('SH1'))$$,
  'the owner revokes SH1');
SELECT is((SELECT status FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH1')),
          'revoked', 'SH1 revoked');
SELECT is((SELECT ended_by FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH1')),
          'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, '… ended_by c');
SELECT is((SELECT host_course_id FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH1')),
          '0c000103-0000-0000-0000-000000000011'::uuid, '… host_course_id KEPT (history: the notice can say which course it left)');
SELECT ok((SELECT responded_at IS NOT NULL FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH1')),
          '… responded_at kept');
SELECT is((SELECT status FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH9')),
          'revoked', 'THE CHAIN FALLS: SH9 is revoked too');
SELECT is((SELECT ended_by FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH9')),
          'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, '… ended_by c');
SELECT is((SELECT status FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH10')),
          'revoked', '… and SH10');
SELECT is((SELECT ended_by FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH10')),
          'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, '… ended_by c');
SELECT ok((SELECT host_course_id IS NOT NULL FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH10')),
          '… hosts kept down the chain');

UPDATE public.otter_subjects SET title = 'Modifiers II' WHERE id = '05000103-0000-0000-0000-000000000001';

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.app_events
            WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4113'
              AND context->>'cascaded_from' = pg_temp.sh('SH1')::text),
          2, 'two upstream lines name SH1 as the row that fell');
SELECT is((SELECT count(*)::int FROM public.app_events
            WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4113'
              AND context->>'share_id' = pg_temp.sh('SH1')::text
              AND context->>'ended_by_role' = 'owner'),
          1, '… and one owner line for SH1 itself');
SELECT is((SELECT context->>'ended_by_role' FROM public.app_events
            WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4113'
              AND context->>'share_id' = pg_temp.sh('SH10')::text
            ORDER BY id LIMIT 1),
          'upstream', 'SH10''s line says upstream');
SELECT is((SELECT context->>'course_id' FROM public.app_events
            WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4113'
              AND context->>'share_id' = pg_temp.sh('SH10')::text
            ORDER BY id LIMIT 1),
          '0c000103-0000-0000-0000-000000000001', '… and carries the course id');

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000001'), 0, 'd reads S1 no more');
SELECT is(public.otter_has_accepted_subject_share('05000103-0000-0000-0000-000000000001'), false, '… the helper is false for d');
SELECT is((SELECT subject_title FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          'Modifiers', 'd''s index shows SH1 with the SNAPSHOT title (the owner has since renamed it)');
SELECT is((SELECT course_id FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          NULL::uuid, '… every live column null');
SELECT is((SELECT subject_title FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH9')),
          'Modifiers', '… and SH9 (the row d made) the same way');
SELECT is((SELECT course_slug FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH9')),
          NULL::text, '… course_slug null');
SELECT is((SELECT completed_lessons->'link:05000103-0000-0000-0000-000000000001'->'completed_lessons'
             FROM public.otter_progress WHERE course_id = '0c000103-0000-0000-0000-000000000011' AND user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
          '["lesson_1_1"]'::jsonb, 'd''s D1 progress row is untouched');

-- as e, the third person
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000001'), 0, 'e reads S1 no more (SH9 fell)');
SELECT is(public.otter_has_accepted_subject_share('05000103-0000-0000-0000-000000000001'), false, '… the helper is false for e');
SELECT is((SELECT subject_title FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH9')),
          'Modifiers', 'e''s index shows SH9 with the snapshot');
SELECT is((SELECT course_id FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH10')),
          NULL::uuid, '… and SH10 with every live column null');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000002'),
          1, 'e still reads S2: a batch row is a root, the cascade reaches descendants only');

-- as h, a plain member (the end of the chain)
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('abababab-abab-abab-abab-abababababab', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000001'), 0, 'h reads S1 no more (SH10 fell)');
SELECT is(public.otter_has_accepted_subject_share('05000103-0000-0000-0000-000000000001'), false, '… the helper is false for h');

-- as c, the owner
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT subject_title FROM public.otter_subject_shares_index() WHERE id = pg_temp.sh('SH1')),
          'Modifiers II', 'the owner''s index shows SH1 with the LIVE title');

-- From here every share and accept is in lives_ok: a revoke mutated to drop
-- its cascade leaves e and h holding links this timeline re-shares into, and
-- the reds must land as probes, not as an abort (the control's shape, measured).
SELECT lives_ok($$INSERT INTO t103 VALUES ('SH6', public.otter_subject_share('05000103-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', NULL))$$,
  'SH6: the owner shares S1 with d again (no live row: allowed)');

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT lives_ok($$INSERT INTO t103 VALUES ('H6', public.otter_subject_share_accept(pg_temp.sh('SH6')))$$,
  'd accepts SH6');
SELECT is(pg_temp.sh('H6'), '0c000103-0000-0000-0000-000000000011'::uuid, '… into D1');
SELECT lives_ok($$INSERT INTO t103 VALUES ('SH11', public.otter_subject_share('05000103-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', NULL))$$,
  'SH11: d passes S1 on to e');
SELECT is((SELECT via_share_id FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH11')),
          pg_temp.sh('SH6'), '… via SH6');

-- as e, the third person
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT lives_ok($$INSERT INTO t103 VALUES ('H11', public.otter_subject_share_accept(pg_temp.sh('SH11')))$$,
  'e accepts SH11');
SELECT is(pg_temp.sh('H11'), pg_temp.sh('E1'), '… into the existing host');

-- as c, the owner
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT lives_ok($$SELECT public.otter_subject_share_revoke(pg_temp.sh('SH11'))$$,
  'THE OWNER ENDS ANY ROW: c revokes SH11 directly');
SELECT is((SELECT ended_by FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH11')),
          'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, '… ended_by c');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT is((SELECT context->>'ended_by_role' FROM public.app_events
            WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4113'
              AND context->>'share_id' = pg_temp.sh('SH11')::text
            ORDER BY id LIMIT 1),
          'owner', '… role owner');
SELECT is((SELECT count(*)::int FROM public.app_events
            WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4113'
              AND context->>'cascaded_from' = pg_temp.sh('SH11')::text),
          0, '… no descendant');

-- as e, the third person
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000001'), 0, 'e reads S1 no more');

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000001'),
          1, 'd still reads S1 (the link above is untouched)');
SELECT lives_ok($$INSERT INTO t103 VALUES ('SH12', public.otter_subject_share('05000103-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', NULL))$$,
  'SH12: d passes S1 on to e again');

-- as e, the third person
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT lives_ok($$INSERT INTO t103 VALUES ('H12', public.otter_subject_share_accept(pg_temp.sh('SH12')))$$,
  'e accepts SH12');
SELECT is((SELECT status FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH12')),
          'accepted', '… SH12 accepted');

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT lives_ok($$SELECT public.otter_subject_share_revoke(pg_temp.sh('SH12'))$$,
  'THE SHARER WITHDRAWS WHAT THEY PASSED ON: d revokes SH12');
SELECT is((SELECT ended_by FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH12')),
          'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, '… ended_by d');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT is((SELECT context->>'ended_by_role' FROM public.app_events
            WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4113'
              AND context->>'share_id' = pg_temp.sh('SH12')::text
            ORDER BY id LIMIT 1),
          'sharer', '… role sharer');

-- as e, the third person
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000001'), 0, 'e reads S1 no more');

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000001'), 1, 'd still reads S1');
SELECT lives_ok($$INSERT INTO t103 VALUES ('SH13', public.otter_subject_share('05000103-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', NULL))$$,
  'SH13: d passes S1 on to e once more');

-- as e, the third person
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT lives_ok($$INSERT INTO t103 VALUES ('H13', public.otter_subject_share_accept(pg_temp.sh('SH13')))$$,
  'e accepts SH13');
SELECT lives_ok($$INSERT INTO t103 VALUES ('SH14', public.otter_subject_share('05000103-0000-0000-0000-000000000001', 'abababab-abab-abab-abab-abababababab', NULL))$$,
  'SH14: e passes S1 on to h');
SELECT is((SELECT chain_depth FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH14')),
          3::smallint, '… via SH13, depth 3');

-- as h, a plain member (the end of the chain)
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('abababab-abab-abab-abab-abababababab', '11111111-1111-1111-1111-111111111111');
SELECT lives_ok($$INSERT INTO t103 VALUES ('H14', public.otter_subject_share_accept(pg_temp.sh('SH14')))$$,
  'h accepts SH14');
SELECT is(pg_temp.sh('H14'), pg_temp.sh('HH'), '… into the host made at SH10');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000001'), 1, 'h reads S1 again');

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT lives_ok($$SELECT public.otter_subject_share_revoke(pg_temp.sh('SH6'))$$,
  'THE MIDDLE PERSON REMOVES THEIR OWN LINK (S3): d revokes SH6');
SELECT is((SELECT ended_by FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH6')),
          'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, '… ended_by d');
SELECT is((SELECT status FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH13')),
          'revoked', '… SH13 falls');
SELECT is((SELECT ended_by FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH13')),
          'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, '… ended_by d');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT is((SELECT status FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH14')),
          'revoked', '… and SH14 falls');
SELECT is((SELECT ended_by FROM public.otter_subject_shares WHERE id = pg_temp.sh('SH14')),
          'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, '… ended_by d');
SELECT is((SELECT context->>'ended_by_role' FROM public.app_events
            WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4113'
              AND context->>'share_id' = pg_temp.sh('SH6')::text
            ORDER BY id LIMIT 1),
          'receiver', 'SH6''s line says receiver');
SELECT is((SELECT count(*)::int FROM public.app_events
            WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4113'
              AND context->>'cascaded_from' = pg_temp.sh('SH6')::text
              AND context->>'ended_by_role' = 'upstream'),
          2, '… and two upstream lines name SH6');

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000001'), 0, 'd reads S1 no more');
-- as e, the third person
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000001'), 0, 'e reads S1 no more');
-- as h, a plain member (the end of the chain)
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('abababab-abab-abab-abab-abababababab', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000001'), 0, 'h reads S1 no more');

-- as c, the owner
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT lives_ok($$SELECT public.otter_subject_share_revoke(pg_temp.sh('SH3'))$$,
  'the owner revokes SH3 (a subject of a SHARED course)');

-- as d, the receiver
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subjects WHERE id = '05000103-0000-0000-0000-000000000004'),
          1, 'd still reads S4 through 0022''s shared arm: the share and the tier are two different reads');
SELECT is(public.otter_has_accepted_subject_share('05000103-0000-0000-0000-000000000004'), false, '… while the helper itself is false now');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT is((SELECT status FROM public.otter_subject_shares WHERE id = 'e5000103-0000-0000-0000-00000000000b'),
          'accepted', 'SHZ is NOT reached by SH3''s cascade (its depth is 8, not 2): it stays accepted in storage');
SELECT is((SELECT count(*)::int FROM public.app_events
            WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4113'
              AND context->>'share_id' = 'e5000103-0000-0000-0000-00000000000b'),
          0, '… and no line was written for it');

-- as c, the owner
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT state FROM public.otter_subject_shares_index() WHERE id = 'e5000103-0000-0000-0000-00000000000b'),
          'gone', '… still gone to the owner');

-- as h, a plain member (the end of the chain)
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('abababab-abab-abab-abab-abababababab', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.otter_subject_shares_index() WHERE id = 'e5000103-0000-0000-0000-00000000000b'),
          0, '… still hidden from h');

-- as c, the owner
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');
SELECT lives_ok($$SELECT public.otter_subject_share_revoke('e5000103-0000-0000-0000-00000000000b')$$,
  'the owner ends SHZ by hand');
SELECT is((SELECT ended_by FROM public.otter_subject_shares WHERE id = 'e5000103-0000-0000-0000-00000000000b'),
          'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, '… ended_by c');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT is((SELECT context->>'ended_by_role' FROM public.app_events
            WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4113'
              AND context->>'share_id' = 'e5000103-0000-0000-0000-00000000000b'
            ORDER BY id LIMIT 1),
          'owner', '… role owner');

-- ── 11. Audit: ids only, one line per transition ────────────────────────────
-- Every count is scoped to workspace A AND the code (suite 70's lesson), so a
-- future writer of app_events cannot move it.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.app_events WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4110'),
          15, 'WIL-4110: fifteen shares were made (SH1..SH4, SH6..SH14, the two batch rows); the refusals and the forged rows wrote none');
SELECT is((SELECT count(*)::int FROM public.app_events WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4111'),
          13, 'WIL-4111: thirteen accepted');
SELECT is((SELECT count(*)::int FROM public.app_events WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4112'),
          1, 'WIL-4112: one declined');
SELECT is((SELECT count(*)::int FROM public.app_events WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4113'),
          12, 'WIL-4113: twelve ended (SH1 and its two upstream lines, SHX, the S6 batch row, SH11, SH12, SH6 and its two, SH3, SHZ)');
SELECT is((SELECT count(*)::int FROM public.app_events
            WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4113' AND context->>'ended_by_role' = 'upstream'),
          4, '… four of them upstream');
SELECT is((SELECT count(*)::int FROM public.app_events
            WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4113' AND context->>'ended_by_role' = 'upstream'
              AND context->>'cascaded_from' IS NULL),
          0, '… and every upstream line carries cascaded_from');
SELECT is((SELECT count(*)::int FROM public.app_events
            WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4113'
              AND context->>'ended_by_role' IN ('owner', 'sharer', 'receiver')),
          8, '… eight by a hand: owner, sharer or receiver');
SELECT is((SELECT count(*)::int FROM public.app_events
            WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code LIKE 'WIL-411%'
              AND (context ? 'subject_title' OR context ? 'title' OR context ? 'name')),
          0, 'no audit context carries a title or a name: ids only');
SELECT is((SELECT count(*)::int FROM public.app_events
            WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code LIKE 'WIL-411%' AND event_type <> 'admin'),
          0, 'every line is on the admin stream');
SELECT is((SELECT count(*)::int FROM public.app_events
            WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code LIKE 'WIL-411%' AND context->>'course_id' IS NULL),
          0, 'every line carries course_id');
SELECT is((SELECT actor_user_id FROM public.app_events
            WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4110'
              AND context->>'share_id' = pg_temp.sh('SH1')::text
            ORDER BY id LIMIT 1),
          'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'SH1''s line names the sharer, server-stamped');
SELECT is((SELECT context->>'chain_depth' FROM public.app_events
            WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4110'
              AND context->>'share_id' = pg_temp.sh('SH10')::text
            ORDER BY id LIMIT 1),
          '3', 'SH10''s line carries its depth');
SELECT is((SELECT context->>'via_share_id' FROM public.app_events
            WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4110'
              AND context->>'share_id' = pg_temp.sh('SH10')::text
            ORDER BY id LIMIT 1),
          pg_temp.sh('SH9')::text, '… and the link it hangs from');
SELECT is((SELECT context->>'host_course_id' FROM public.app_events
            WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4111'
              AND context->>'share_id' = pg_temp.sh('SH1')::text
            ORDER BY id LIMIT 1),
          '0c000103-0000-0000-0000-000000000011', 'SH1''s accept line carries the host');

-- as a, the ADMIN (claims by hand: tests.login_as sets no app_role)
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);
SELECT is((SELECT count(*)::int FROM public.app_events WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4110'),
          15, 'an ADMIN reads the lines');

-- as e, the third person
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111');
SELECT is((SELECT count(*)::int FROM public.app_events WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND code = 'WIL-4110'),
          0, '… a member does not');
SELECT throws_ok($$
  INSERT INTO public.app_events (workspace_id, event_type, code, severity, message)
  VALUES ('11111111-1111-1111-1111-111111111111', 'admin', 'WIL-4110', 'info', 'forged')
$$, '42501', NULL, '… and cannot forge one: the admin stream stays reserved');

-- ── 12. Belt ────────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT ok(EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = 'otter_subjects' AND cmd = 'SELECT'
                     AND qual LIKE '%otter_has_accepted_subject_share%'),
          'the link arm is in otter_subjects_select');
SELECT ok(EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = 'otter_subjects' AND cmd = 'SELECT'
                     AND qual LIKE '%otter_courses%'
                     AND qual LIKE '%has_active_membership%'
                     AND qual LIKE '%deleted_at IS NULL%'),
          '… beside 0022''s own guards (the course EXISTS, the membership, the trash)');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies
                       WHERE schemaname = 'public' AND tablename = 'otter_subjects' AND cmd = 'UPDATE'
                         AND (qual LIKE '%otter_has_accepted_subject_share%'
                              OR with_check LIKE '%otter_has_accepted_subject_share%')),
          '… and NOT in otter_subjects_update: a linked subject is read-only');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies
                       WHERE schemaname = 'public'
                         AND tablename IN ('otter_courses', 'otter_subjects', 'otter_progress')
                         AND cmd = 'SELECT' AND qual LIKE '%current_app_role%'),
          'no admin bypass in a personal-content SELECT policy');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies
                       WHERE schemaname = 'public' AND tablename = 'otter_subject_shares'
                         AND cmd <> 'SELECT'),
          'no write policy on the share table, DELETE included: the cascade is the FK''s');

SELECT * FROM finish();

ROLLBACK;
