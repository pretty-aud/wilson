-- =============================================================================
-- 90_legal_files.sql — post-overhaul S4b: the Legal gate (migration 0088).
--
-- Audrey, 2026-10-01: a Legal file is seen by "same as money files for now"
-- (workspace admins and the project's managers — can_access_project_money),
-- and Legal is chosen when the file is added: "its just the folder that is
-- locked".
--
-- WHO IS WHO (all in workspace A, on project A unless said otherwise):
--   user_a  workspace ADMIN (rls_setup) — money-cleared by the first arm
--   user_d  workspace 'user', project MANAGER — money-cleared by the second
--   user_p  workspace MANAGER, project MANAGER — reads edit history, cleared
--   user_c  workspace 'user', project MEMBER — the person the gate is for
--   user_r  workspace 'user', project REVIEWER
--   user_m  workspace MANAGER holding only a project MEMBER seat — the money
--           gate's own edge: can_write_project says yes, money says no
--   user_b  workspace B's admin; anon
--
-- WHAT THIS PINS, in order of how badly it would hurt:
--   * 🚨 A Legal file's ROW, OBJECT and THUMBNAIL are invisible and unwritable
--     to user_c, user_r, user_m, user_b and anon (§C-§F), each beside a
--     PRESENCE CONTROL one probe away (the same reader sees a plain file /
--     object), and readable by user_a, user_d and user_p (§B, §G).
--   * 🚨 Nothing else names it to them (§C-§E, §H-§J): the download log, the
--     trash RPCs (an existence oracle and a write, measured open before 0088
--     for invoices), file events — the purged certificate included — edit
--     history, and the realtime topic (measured: invoice rows were broadcast
--     whole to every project reader before 0088).
--   * The tag and the folder never disagree; Legal is never core; a Legal
--     body never leaves Supabase (§I, by the CHECK each refusal names).
--   * The structure the behaviour stands on: the list, the two classifiers,
--     the four policies and the CHECKs WHOLE as Postgres prints them (S4a
--     trap 16), the sixteen storage policies untouched, the quota inherited.
--   * Review round 1 (§K): a Legal path is fixed when the file is added (no
--     move in or out, for anyone); a locked third segment is always a real
--     projects/… key; a reservation for a locked key needs the money gate.
--   * Review round 2 (§L): the quota meter never tells anyone whether
--     another person's key is reserved; the hourly sweep's certificate for an
--     abandoned Legal upload is flagged, so a member never reads it.
--
-- Every absence probe has a presence control, so an empty answer cannot pass
-- by accident. Proven by breakers against 0088 before it was applied
-- anywhere: the table is in the S4b hand-off.
--
-- 🚨 RUNS INSIDE ONE TRANSACTION THAT ROLLS BACK. Nothing here survives.
-- Postgres-side reads are scoped to the fixture ids: dev carries real rows.
-- Nothing deletes from storage.objects (protect_delete forbids it).
-- =============================================================================

BEGIN;

SELECT plan(108);

SELECT * FROM tests.rls_setup();

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
  ('90900000-0000-0000-0000-0000000000a1', 'user_r@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('90900000-0000-0000-0000-0000000000a2', 'user_m@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('90900000-0000-0000-0000-0000000000a3', 'user_p@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user',    'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'user',    'user_d', 'User D', true),
  ('11111111-1111-1111-1111-111111111111', '90900000-0000-0000-0000-0000000000a1', 'user',    'user_r', 'User R', true),
  ('11111111-1111-1111-1111-111111111111', '90900000-0000-0000-0000-0000000000a2', 'manager', 'user_m', 'User M', true),
  ('11111111-1111-1111-1111-111111111111', '90900000-0000-0000-0000-0000000000a3', 'manager', 'user_p', 'User P', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role)
VALUES
  ('aaaa1111-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1111-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'manager'),
  ('aaaa1111-0000-0000-0000-000000000001', '90900000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1111-0000-0000-0000-000000000001', '90900000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1111-0000-0000-0000-000000000001', '90900000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'manager')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;

-- Sign in as one person, claims in the JWT's own shape (current_app_role reads
-- app_metadata.app_role from the claims). Called as postgres; leaves the
-- session as `authenticated` until the next RESET ROLE.
CREATE FUNCTION pg_temp.act_as(p_uid UUID, p_app_role TEXT, p_ws UUID DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_uid, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', p_app_role))::text, true);
  PERFORM set_config('role', 'authenticated', true);
END;
$$;

-- Fixture ids:
--   f9…01  THE Legal file   projects/A/LEGAL/A/1-contract.pdf  (+ its .jpg)
--   f9…02  a plain file      projects/A/project/A/1-brief.pdf   (+ its object)
--   f9…03  an invoice        projects/A/INVOICES/A/1-invoice.pdf
--   f9…04  user_c's own plain file, for the move-into-LEGAL attempts


-- ══ A. Structure ═════════════════════════════════════════════════════════════

SELECT ok(
  public.rabbit_money_segment('LEGAL') AND public.rabbit_money_segment('legal')
  AND public.rabbit_money_segment('Legal') AND public.rabbit_money_segment('INVOICES')
  AND public.rabbit_money_segment('FINANCE') AND NOT public.rabbit_money_segment('ASSETS')
  AND NOT public.rabbit_money_segment('LEGALS') AND public.rabbit_money_segment(NULL) IS FALSE,
  'the one list locks LEGAL in any case beside INVOICES and FINANCE; nothing ordinary; NULL is false');  -- 1

SELECT ok(
  public.rabbit_legal_segment('LEGAL') AND public.rabbit_legal_segment('lEgAl')
  AND NOT public.rabbit_legal_segment('INVOICES') AND NOT public.rabbit_legal_segment('FINANCE')
  AND public.rabbit_legal_segment(NULL) IS FALSE
  AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['LEGAL','legal','Legal','lEgAl']) s
                   WHERE public.rabbit_legal_segment(s) AND NOT public.rabbit_money_segment(s)),
  'rabbit_legal_segment names LEGAL only, and every Legal segment is a locked one');                     -- 2

SELECT ok(
  public.file_row_is_money(true, 'projects/p/project/p/1-a.pdf')
  AND public.file_row_is_money(false, 'projects/p/LEGAL/p/1-a.pdf')
  AND public.file_row_is_money(false, 'projects/p/invoices/p/1-a.pdf')
  AND NOT public.file_row_is_money(false, 'projects/p/ASSETS/p/1-a.pdf')
  AND NOT public.file_row_is_money(false, 'local-name.pdf')
  AND public.file_row_is_money(NULL, NULL) IS FALSE,
  'file_row_is_money reads BOTH axes (the flag, the folder) and is never NULL');                         -- 3

SELECT ok(
  has_function_privilege('authenticated', 'public.file_row_is_money(boolean, text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.rabbit_legal_segment(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.file_row_is_money(boolean, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.rabbit_legal_segment(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.edit_history_file_class(uuid, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.fn_edit_history_money_snapshot()', 'EXECUTE'),
  'the helpers the policies call are authenticated-only; the DEFINER classifier and trigger are closed'); -- 4

-- 5-9: the four files policies, clause by clause, WHOLE (S4a trap 16).
SELECT is(
  (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'files' AND policyname = 'files_select'),
  '((deleted_at IS NULL) AND (workspace_id = current_workspace_id()) AND (EXISTS ( SELECT 1' || chr(10)
  || '   FROM projects p' || chr(10) || '  WHERE (p.id = files.project_id))) AND ((NOT file_row_is_money(is_financial, storage_path)) OR can_access_project_money(project_id)))',
  'files_select is 0038''s body with the money arm on both axes');                                      -- 5
SELECT is(
  (SELECT with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'files' AND policyname = 'files_insert'),
  '((workspace_id = current_workspace_id()) AND has_active_membership(workspace_id) AND can_write_project(project_id) AND ((NOT file_row_is_money(is_financial, storage_path)) OR can_access_project_money(project_id)) AND (EXISTS ( SELECT 1' || chr(10)
  || '   FROM projects p' || chr(10) || '  WHERE (p.id = files.project_id))))',
  'files_insert is 0083''s body with the money arm on both axes');                                      -- 6
SELECT is(
  (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'files' AND policyname = 'files_update'),
  '((workspace_id = current_workspace_id()) AND has_active_membership(workspace_id) AND can_write_project(project_id) AND ((NOT file_row_is_money(is_financial, storage_path)) OR can_access_project_money(project_id)))',
  'files_update USING is 0083''s with the money arm on both axes');                                    -- 7
SELECT is(
  (SELECT with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'files' AND policyname = 'files_update'),
  '((workspace_id = current_workspace_id()) AND can_write_project(project_id) AND ((NOT file_row_is_money(is_financial, storage_path)) OR can_access_project_money(project_id)) AND (EXISTS ( SELECT 1' || chr(10)
  || '   FROM projects p' || chr(10) || '  WHERE (p.id = files.project_id))))',
  'files_update WITH CHECK is 0083''s with the money arm on both axes');                               -- 8
SELECT is(
  (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'files' AND policyname = 'files_delete'),
  '((workspace_id = current_workspace_id()) AND has_active_membership(workspace_id) AND can_write_project(project_id) AND ((NOT file_row_is_money(is_financial, storage_path)) OR can_access_project_money(project_id)))',
  'files_delete is 0038''s body with the money arm on both axes');                                      -- 9

SELECT is(
  (SELECT array_agg(policyname::TEXT ORDER BY policyname) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'files' AND permissive = 'PERMISSIVE'),
  ARRAY['files_delete','files_insert','files_select','files_update']::TEXT[],
  'files keeps exactly its four permissive policies — none added beside');                               -- 10

-- 11-13: the CHECKs, whole.
SELECT is(
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid = 'public.files'::regclass AND conname = 'files_legal_folder_chk'),
  'CHECK ((COALESCE((tags @> ARRAY[''legal''::text]), false) = rabbit_legal_segment(split_part(storage_path, ''/''::text, 3))))',
  'files_legal_folder_chk ties the legal tag to the LEGAL folder, exactly');                             -- 11
SELECT is(
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid = 'public.files'::regclass AND conname = 'files_legal_not_core_chk'),
  'CHECK ((NOT (is_core_definer AND (COALESCE((tags @> ARRAY[''legal''::text]), false) OR rabbit_legal_segment(split_part(storage_path, ''/''::text, 3))))))',
  'files_legal_not_core_chk keeps a Legal file out of Core, by tag or folder');                          -- 12
SELECT is(
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid = 'public.files'::regclass AND conname = 'files_money_provider_chk'),
  'CHECK (((storage_provider = ''supabase''::storage_provider) OR (NOT (COALESCE(is_financial, false) OR rabbit_money_segment(split_part(storage_path, ''/''::text, 3))))))',
  'files_money_provider_chk (0050) is untouched: it covers LEGAL through the one list');                 -- 13

SELECT ok(
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (policyname LIKE 'rabbit\_files%' OR policyname LIKE 'rabbit\_thumbnails%')
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%rabbit_money_segment(%') = 16
  AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname LIKE 'rabbit\_%\_money\_%'
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%can_access_project_money(%') = 8,
  'the sixteen storage policies ride the one list, unchanged (eight of them carry the money gate)');     -- 14

SELECT ok(
  public.rabbit_quota_exempt_bytes('projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/x/1-c.pdf', 4000)
  AND NOT public.rabbit_quota_exempt_bytes('projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/x/1-c.pdf',
                                           public.rabbit_quota_exempt_max_bytes() + 1),
  'I6: a Legal body inherits 0078''s bounded quota exemption (exempt to 25 MiB, weighed above)');        -- 15


-- ══ B. The project manager adds a Legal file — the controls ═════════════════

SELECT pg_temp.act_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user');

SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/1-contract.pdf',
            'dddddddd-dddd-dddd-dddd-dddddddddddd', '{"size": 4000}'::jsonb)$$,
  'the project manager writes a Legal body under LEGAL/ (the money INSERT policy admits them)');        -- 16

SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-thumbnails',
            'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/1-contract.pdf.jpg',
            'dddddddd-dddd-dddd-dddd-dddddddddddd', '{"mimetype":"image/jpeg"}'::jsonb)$$,
  'and its thumbnail, at the same key plus .jpg');                                                       -- 17

SELECT lives_ok(
  $$INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path,
                              thumbnail_url, size_bytes, is_financial, tags, description)
    VALUES ('f9000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
            'aaaa1111-0000-0000-0000-000000000001', 'contract.pdf', 'supabase',
            'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/1-contract.pdf',
            'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/1-contract.pdf.jpg',
            4000, false, ARRAY['legal'], 'release terms, confidential')$$,
  'and the Legal row: the legal tag WITH the LEGAL folder, on Supabase, not is_financial');              -- 18

-- The plain file and the invoice beside it (the controls below lean on both).
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES ('rabbit-files',
        'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/1-brief.pdf',
        'dddddddd-dddd-dddd-dddd-dddddddddddd', '{"size": 300}'::jsonb);
INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path, size_bytes, is_financial)
VALUES ('f9000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
        'aaaa1111-0000-0000-0000-000000000001', 'brief.pdf', 'supabase',
        'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/1-brief.pdf',
        300, false),
       ('f9000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
        'aaaa1111-0000-0000-0000-000000000001', 'invoice.pdf', 'supabase',
        'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/aaaa1111-0000-0000-0000-000000000001/1-invoice.pdf',
        200, true);

SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id = 'f9000000-0000-0000-0000-000000000001'),
  1, 'CONTROL: the project manager reads the Legal row');                                                -- 19
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE name = 'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/1-contract.pdf'),
  1, 'CONTROL: the project manager reads the Legal body');                                               -- 20
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'rabbit-thumbnails'
      AND name = 'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/1-contract.pdf.jpg'),
  1, 'CONTROL: the project manager reads the Legal thumbnail');                                          -- 21

SELECT lives_ok(
  $$UPDATE public.files SET description = 'release terms, confidential (signed)'
     WHERE id = 'f9000000-0000-0000-0000-000000000001'$$,
  'the project manager edits the Legal file''s note (a files UPDATE: edit history is written)');         -- 22

SELECT is(
  (SELECT count(*)::int FROM public.file_events WHERE file_id = 'f9000000-0000-0000-0000-000000000001'),
  1, 'CONTROL: the project manager reads the Legal file''s uploaded event');                             -- 23

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

-- user_c's own plain file and object.
SELECT pg_temp.act_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user');
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES ('rabbit-files',
        'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/2-mine.pdf',
        'cccccccc-cccc-cccc-cccc-cccccccccccc', '{"size": 100}'::jsonb);
INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path, size_bytes, is_financial)
VALUES ('f9000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
        'aaaa1111-0000-0000-0000-000000000001', 'mine.pdf', 'supabase',
        'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/2-mine.pdf',
        100, false);


-- ══ C. A project MEMBER (user_c) ═════════════════════════════════════════════

SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id = 'f9000000-0000-0000-0000-000000000002'),
  1, 'PRESENCE CONTROL: the member reads the plain file');                                               -- 24
SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id = 'f9000000-0000-0000-0000-000000000001'),
  0, '🚨 the member cannot read the Legal row — name, note, tags, size');                                -- 25
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE name = 'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/1-brief.pdf'),
  1, 'PRESENCE CONTROL: storage RLS admits the member to the plain body');                               -- 26
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'rabbit-files'
      AND name = 'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/1-contract.pdf'),
  0, '🚨 the member cannot read the Legal body');                                                        -- 27
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'rabbit-thumbnails'
      AND name = 'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/1-contract.pdf.jpg'),
  0, '🚨 the member cannot read the Legal thumbnail — a legible picture of the page');                   -- 28
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE name ILIKE 'projects/aaaa1111-0000-0000-0000-000000000001/legal/%'),
  0, 'the member lists nothing under LEGAL/ in either bucket, in any case');                             -- 29

SELECT throws_ok(
  $$INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path, size_bytes, is_financial, tags)
    VALUES ('f9000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111',
            'aaaa1111-0000-0000-0000-000000000001', 'm.pdf', 'supabase',
            'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-m.pdf',
            10, false, ARRAY['legal'])$$,
  '42501', NULL, 'I7: the member cannot add a Legal row (files_insert''s money arm)');                   -- 30
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files', 'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-m.pdf',
            'cccccccc-cccc-cccc-cccc-cccccccccccc', '{"size": 10}'::jsonb)$$,
  'new row violates row-level security policy for table "objects"',
  'I7: the member cannot write a body under LEGAL/');                                                    -- 31
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-thumbnails', 'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-m.pdf.jpg',
            'cccccccc-cccc-cccc-cccc-cccccccccccc', '{"mimetype":"image/jpeg"}'::jsonb)$$,
  'new row violates row-level security policy for table "objects"',
  'nor a thumbnail under LEGAL/');                                                                       -- 32
SELECT throws_ok(
  $$UPDATE storage.objects
       SET name = 'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/2-mine.pdf'
     WHERE name = 'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/2-mine.pdf'$$,
  'new row violates row-level security policy for table "objects"',
  'nor rename an ordinary body INTO LEGAL/ (the WITH CHECK arm)');                                       -- 33

WITH upd AS (
  UPDATE public.files SET description = 'member got in'
   WHERE id = 'f9000000-0000-0000-0000-000000000001' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0, 'the member''s UPDATE of the Legal row lands on nothing'); -- 34

WITH del AS (
  DELETE FROM public.files WHERE id = 'f9000000-0000-0000-0000-000000000001' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM del), 0, 'the member''s DELETE of the Legal row lands on nothing'); -- 35

-- 🚨 The DELETE that reads NO column: only files_delete's USING judges it (a
-- WHERE would bring files_select in, which is why probe 35 cannot isolate
-- it). Counted inside a sub-block that is then undone, so the fixtures stay.
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;
CREATE TEMP TABLE legal90_delete (n INT);
GRANT ALL ON legal90_delete TO PUBLIC;
SELECT pg_temp.act_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user');
DO $$
DECLARE
  v_n INT;
BEGIN
  BEGIN
    DELETE FROM public.files;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'legal90: undo the column-free delete';
  EXCEPTION WHEN raise_exception THEN
    NULL;
  END;
  INSERT INTO legal90_delete VALUES (v_n);
END $$;
SELECT is((SELECT n FROM legal90_delete), 2,
  '🚨 the member''s column-free DELETE reaches the two plain rows and neither money row (files_delete''s arm)'); -- 36

-- 🚨 The UPDATE that reads NO column (0083's C-R2-01 shape): only
-- files_update's own USING and WITH CHECK judge it, no SELECT policy. With
-- the money arm in USING it skips the Legal row and the invoice; without it
-- the Legal row reaches WITH CHECK and the whole statement aborts.
SELECT lives_ok(
  $$UPDATE public.files SET description = 'member column-free'$$,
  'the member''s column-free UPDATE runs — files_update''s USING never offers it a money row');           -- 37

-- …and the column-free UPDATE that makes every row it reaches MONEY by the
-- flag: only files_update's WITH CHECK can refuse it. (Until review round 1
-- this was a column-free MOVE into LEGAL; since then trg_files_legal_fixed, a
-- BEFORE trigger, refuses a move before WITH CHECK is consulted, so the move
-- has its own probe, 86, and this one isolates WITH CHECK on the flag axis.)
-- Run in a sub-block that is undone whatever happens, so that if the gate
-- ever fails here the changed rows do not take the rest of this suite down.
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;
CREATE TEMP TABLE legal90_move (outcome TEXT);
GRANT ALL ON legal90_move TO PUBLIC;
SELECT pg_temp.act_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user');
DO $$
DECLARE
  v_n INT;
  v_outcome TEXT;
BEGIN
  BEGIN
    UPDATE public.files SET is_financial = true;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_outcome := 'flagged ' || v_n || ' row(s)';
    RAISE EXCEPTION 'legal90: undo the column-free flag';
  EXCEPTION
    WHEN raise_exception THEN NULL;
    WHEN OTHERS THEN v_outcome := SQLSTATE;
  END;
  INSERT INTO legal90_move VALUES (v_outcome);
END $$;
SELECT is((SELECT outcome FROM legal90_move), '42501',
  '🚨 the member cannot make a file money by flagging it (files_update WITH CHECK, alone)');             -- 38

SELECT throws_ok(
  $$UPDATE public.files SET tags = ARRAY['legal'] WHERE id = 'f9000000-0000-0000-0000-000000000004'$$,
  '23514', 'new row for relation "files" violates check constraint "files_legal_folder_chk"',
  'I3: ticking Legal on an existing file is refused by the CHECK (for the member)');                     -- 39

SELECT throws_ok(
  $$SELECT public.log_file_downloaded('f9000000-0000-0000-0000-000000000001')$$,
  'log_file_downloaded: file not found or not readable',
  'the member cannot log a read of the Legal file — no oracle, no minted event');                        -- 40
SELECT lives_ok(
  $$SELECT public.log_file_downloaded('f9000000-0000-0000-0000-000000000002')$$,
  'CONTROL: the member logs a read of the plain file');                                                  -- 41
SELECT throws_ok(
  $$SELECT public.soft_delete_row('files', 'f9000000-0000-0000-0000-000000000001')$$,
  'not allowed to soft-delete or restore this row',
  '🚨 the member cannot trash the Legal file by id (fn_trash_authz''s money arm)');                      -- 42
SELECT throws_ok(
  $$SELECT public.restore_soft_deleted('files', 'f9000000-0000-0000-0000-000000000001')$$,
  'not allowed to soft-delete or restore this row',
  'nor restore it');                                                                                     -- 43
SELECT throws_ok(
  $$SELECT public.soft_delete_row('files', 'f9000000-0000-0000-0000-000000000003')$$,
  'not allowed to soft-delete or restore this row',
  '🚨 nor trash an INVOICE by id — measured open before 0088 (true, true)');                            -- 44

SELECT is(
  (SELECT count(*)::int FROM public.file_events WHERE file_id = 'f9000000-0000-0000-0000-000000000002'),
  2, 'PRESENCE CONTROL: the member reads the plain file''s events (uploaded, downloaded)');               -- 45
SELECT is(
  (SELECT count(*)::int FROM public.file_events WHERE file_id = 'f9000000-0000-0000-0000-000000000001'),
  0, '🚨 the member reads none of the Legal file''s events');                                             -- 46

SELECT throws_ok(
  $$SELECT public.reserve_upload_bytes(
    'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-small.pdf', 4000)$$,
  '42501', 'reserve_upload_bytes: you cannot write to this project',
  'the member cannot reserve a LEGAL key, even a small one — the refusal any non-writer gets (0088 §5b)');  -- 47

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;


-- ══ D. A project REVIEWER (user_r) ═══════════════════════════════════════════

SELECT pg_temp.act_as('90900000-0000-0000-0000-0000000000a1', 'user');

SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id = 'f9000000-0000-0000-0000-000000000002'),
  1, 'PRESENCE CONTROL: the reviewer reads the plain file');                                             -- 48
SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id = 'f9000000-0000-0000-0000-000000000001'),
  0, '🚨 the reviewer cannot read the Legal row');                                                        -- 49
SELECT is(
  (SELECT count(*)::int FROM storage.objects WHERE name ILIKE 'projects/aaaa1111-0000-0000-0000-000000000001/legal/%'),
  0, '🚨 the reviewer reads no Legal body or thumbnail');                                                -- 50
SELECT is(
  (SELECT count(*)::int FROM public.file_events WHERE file_id = 'f9000000-0000-0000-0000-000000000001'),
  0, 'the reviewer reads none of the Legal file''s events');                                             -- 51
SELECT throws_ok(
  $$SELECT public.log_file_downloaded('f9000000-0000-0000-0000-000000000001')$$,
  'log_file_downloaded: file not found or not readable',
  'the reviewer cannot log a read of the Legal file');                                                   -- 52

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;


-- ══ E. A WORKSPACE MANAGER holding a MEMBER seat (user_m) — the gate's edge ═══

SELECT pg_temp.act_as('90900000-0000-0000-0000-0000000000a2', 'manager');

SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id = 'f9000000-0000-0000-0000-000000000002'),
  1, 'PRESENCE CONTROL: the workspace manager reads the plain file');                                    -- 53
SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id = 'f9000000-0000-0000-0000-000000000001'),
  0, '🚨 a workspace manager with a member seat cannot read the Legal row');                             -- 54
SELECT is(
  (SELECT count(*)::int FROM storage.objects WHERE name ILIKE 'projects/aaaa1111-0000-0000-0000-000000000001/legal/%'),
  0, 'nor its body or thumbnail');                                                                       -- 55
SELECT is(
  (SELECT count(*)::int FROM public.file_events WHERE file_id = 'f9000000-0000-0000-0000-000000000001'),
  0, 'nor its events');                                                                                  -- 56
SELECT ok(
  (SELECT count(*) FROM public.edit_history
    WHERE entity_type = 'files' AND entity_id = 'f9000000-0000-0000-0000-000000000002') > 0,
  'PRESENCE CONTROL: the workspace manager reads the plain file''s edit history');                       -- 57
SELECT is(
  (SELECT count(*)::int FROM public.edit_history
    WHERE entity_type = 'files' AND entity_id = 'f9000000-0000-0000-0000-000000000001'),
  0, '🚨 nor the Legal file''s edit history — measured open for invoices before 0088');                  -- 58
SELECT is(
  (SELECT count(*)::int FROM public.edit_history
    WHERE entity_type = 'files' AND entity_id = 'f9000000-0000-0000-0000-000000000003'),
  0, '…and an invoice''s history is closed to them too');                                                -- 59
SELECT throws_ok(
  $$SELECT public.soft_delete_row('files', 'f9000000-0000-0000-0000-000000000001')$$,
  'not allowed to soft-delete or restore this row',
  'can_write_project says yes to a workspace manager; the money arm still refuses the trash');           -- 60
SELECT throws_ok(
  $$SELECT public.log_file_downloaded('f9000000-0000-0000-0000-000000000001')$$,
  'log_file_downloaded: file not found or not readable',
  'nor may they log a read of it');                                                                      -- 61
SELECT throws_ok(
  $$INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path, size_bytes, is_financial, tags)
    VALUES ('f9000000-0000-0000-0000-0000000000c2', '11111111-1111-1111-1111-111111111111',
            'aaaa1111-0000-0000-0000-000000000001', 'w.pdf', 'supabase',
            'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-w.pdf',
            10, false, ARRAY['legal'])$$,
  '42501', NULL, 'nor add a Legal row');                                                                 -- 62

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;


-- ══ F. Another workspace, and anon ═══════════════════════════════════════════

SELECT pg_temp.act_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', '22222222-2222-2222-2222-222222222222');
SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id IN ('f9000000-0000-0000-0000-000000000001',
                                                      'f9000000-0000-0000-0000-000000000002')),
  0, 'another workspace''s admin reads neither file');                                                   -- 63
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT count(*) FROM public.files$$,
  '42501', NULL, 'anon holds no privilege on files at all');                                             -- 64
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);


-- ══ G. The money-cleared readers ═════════════════════════════════════════════

SELECT pg_temp.act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin');
SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id = 'f9000000-0000-0000-0000-000000000001'),
  1, 'the workspace admin reads the Legal row');                                                         -- 65
SELECT is(
  (SELECT count(*)::int FROM storage.objects WHERE name ILIKE 'projects/aaaa1111-0000-0000-0000-000000000001/legal/%'),
  2, 'the workspace admin reads the Legal body and its thumbnail');                                      -- 66
SELECT is(
  (SELECT count(*)::int FROM public.edit_history
    WHERE entity_type = 'files' AND entity_id = 'f9000000-0000-0000-0000-000000000001'),
  2, 'the workspace admin reads the Legal file''s history (created, note edited)');                      -- 67
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

SELECT pg_temp.act_as('90900000-0000-0000-0000-0000000000a3', 'manager');
SELECT is(
  (SELECT count(*)::int FROM public.edit_history
    WHERE entity_type = 'files' AND entity_id = 'f9000000-0000-0000-0000-000000000001'),
  2, 'a workspace manager who MANAGES the project reads it (edit_history''s money arm admits them)');    -- 68
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

CREATE TEMP TABLE legal90_rpc (k TEXT, v TEXT);
GRANT ALL ON legal90_rpc TO PUBLIC;

SELECT pg_temp.act_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user');
SELECT lives_ok(
  $$SELECT public.log_file_downloaded('f9000000-0000-0000-0000-000000000001')$$,
  'CONTROL: the project manager logs a read of the Legal file');                                         -- 69
-- Each answer recorded, never raised past the suite: true, true is the pass.
DO $$
BEGIN
  BEGIN
    INSERT INTO legal90_rpc VALUES ('1-trash', public.soft_delete_row('files', 'f9000000-0000-0000-0000-000000000001')::text);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO legal90_rpc VALUES ('1-trash', SQLSTATE);
  END;
  BEGIN
    INSERT INTO legal90_rpc VALUES ('2-restore', public.restore_soft_deleted('files', 'f9000000-0000-0000-0000-000000000001')::text);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO legal90_rpc VALUES ('2-restore', SQLSTATE);
  END;
END $$;
SELECT is(
  (SELECT string_agg(v, ',' ORDER BY k) FROM legal90_rpc),
  'true,true', 'CONTROL: the project manager trashes and restores the Legal file');                      -- 70


-- ══ H. The CHECKs — as the project manager, so only the CHECK can refuse ═════
-- Matched by the constraint's name: each row breaks exactly one CHECK.

SELECT throws_ok(
  $$INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path, size_bytes, is_financial, tags)
    VALUES ('f9000000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111',
            'aaaa1111-0000-0000-0000-000000000001', 't.pdf', 'supabase',
            'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/9-t.pdf',
            10, false, ARRAY['legal'])$$,
  '23514', 'new row for relation "files" violates check constraint "files_legal_folder_chk"',
  'I3: the legal tag without the LEGAL folder is refused');                                              -- 71
SELECT throws_ok(
  $$INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path, size_bytes, is_financial, tags)
    VALUES ('f9000000-0000-0000-0000-0000000000d2', '11111111-1111-1111-1111-111111111111',
            'aaaa1111-0000-0000-0000-000000000001', 'u.pdf', 'supabase',
            'projects/aaaa1111-0000-0000-0000-000000000001/legal/aaaa1111-0000-0000-0000-000000000001/9-u.pdf',
            10, false, ARRAY[]::text[])$$,
  '23514', 'new row for relation "files" violates check constraint "files_legal_folder_chk"',
  'I3: the LEGAL folder (any case) without the tag is refused');                                         -- 72
SELECT throws_ok(
  $$UPDATE public.files SET tags = ARRAY[]::text[] WHERE id = 'f9000000-0000-0000-0000-000000000001'$$,
  '23514', 'new row for relation "files" violates check constraint "files_legal_folder_chk"',
  'I3: un-tagging a Legal file is refused');                                                             -- 73
SELECT throws_ok(
  $$UPDATE public.files
       SET storage_path = 'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/1-contract.pdf'
     WHERE id = 'f9000000-0000-0000-0000-000000000001'$$,
  '23514', 'files_legal_fixed: a file is Legal from the moment it is added, and only then — its path cannot move into or out of LEGAL',
  'I3: moving a Legal file out of LEGAL with its tag on is refused (trg_files_legal_fixed answers first)'); -- 74
SELECT throws_ok(
  $$UPDATE public.files SET tags = ARRAY['legal'] WHERE id = 'f9000000-0000-0000-0000-000000000002'$$,
  '23514', 'new row for relation "files" violates check constraint "files_legal_folder_chk"',
  'I3: ticking Legal on an existing file is refused for the project manager too');                       -- 75
SELECT throws_ok(
  $$UPDATE public.files SET is_core_definer = true WHERE id = 'f9000000-0000-0000-0000-000000000001'$$,
  '23514', 'new row for relation "files" violates check constraint "files_legal_not_core_chk"',
  'I5: a Legal file cannot be marked Core');                                                             -- 76
SELECT throws_ok(
  $$INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path, size_bytes, is_financial, tags, is_core_definer)
    VALUES ('f9000000-0000-0000-0000-0000000000d3', '11111111-1111-1111-1111-111111111111',
            'aaaa1111-0000-0000-0000-000000000001', 'v.pdf', 'supabase',
            'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-v.pdf',
            10, false, ARRAY['legal'], true)$$,
  '23514', 'new row for relation "files" violates check constraint "files_legal_not_core_chk"',
  'I5: nor added as Core');                                                                              -- 77
SELECT throws_ok(
  $$INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path, size_bytes, is_financial, tags)
    VALUES ('f9000000-0000-0000-0000-0000000000d4', '11111111-1111-1111-1111-111111111111',
            'aaaa1111-0000-0000-0000-000000000001', 's.pdf', 's3',
            'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-s.pdf',
            10, false, ARRAY['legal'])$$,
  '23514', 'new row for relation "files" violates check constraint "files_money_provider_chk"',
  'I4: a Legal body cannot live outside Supabase (files_money_provider_chk, by the one list)');          -- 78

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;


-- ══ I. The deletion certificate ══════════════════════════════════════════════
-- Purged as the nightly sweep does (postgres). Ruling 22 keeps an invoice's
-- certificate visible to every project reader; a Legal file's names it, so
-- 0088 hides it from non-money readers.

DELETE FROM public.files WHERE id IN ('f9000000-0000-0000-0000-000000000001',
                                      'f9000000-0000-0000-0000-000000000003');

SELECT pg_temp.act_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user');
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'f9000000-0000-0000-0000-000000000003' AND event = 'purged'),
  1, 'CONTROL (ruling 22): the member still reads the INVOICE''s deletion certificate');                -- 79
SELECT is(
  (SELECT count(*)::int FROM public.file_events WHERE file_id = 'f9000000-0000-0000-0000-000000000001'),
  0, '🚨 the member reads nothing of the Legal file — its deletion certificate included');               -- 80
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

SELECT pg_temp.act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin');
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'f9000000-0000-0000-0000-000000000001' AND event = 'purged'),
  1, 'the workspace admin reads the Legal file''s certificate');                                         -- 81
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

SELECT pg_temp.act_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user');
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'f9000000-0000-0000-0000-000000000001' AND event = 'purged'),
  1, 'the project manager reads it too');                                                                -- 82
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;


-- ══ J. What was written, read as postgres ════════════════════════════════════

SELECT ok(
  (SELECT count(*) FROM public.edit_history
    WHERE entity_type = 'files' AND entity_id = 'f9000000-0000-0000-0000-000000000001') >= 3
  AND NOT EXISTS (SELECT 1 FROM public.edit_history
    WHERE entity_type = 'files' AND entity_id = 'f9000000-0000-0000-0000-000000000001'
      AND (NOT is_financial OR project_id IS DISTINCT FROM 'aaaa1111-0000-0000-0000-000000000001')),
  'every history row of the Legal file — created, edited, trashed, restored, purged — is flagged with its project'); -- 83
SELECT ok(
  (SELECT count(*) FROM public.edit_history
    WHERE entity_type = 'files' AND entity_id = 'f9000000-0000-0000-0000-000000000002') > 0
  AND NOT EXISTS (SELECT 1 FROM public.edit_history
    WHERE entity_type = 'files' AND entity_id = 'f9000000-0000-0000-0000-000000000002' AND is_financial),
  'CONTROL: the plain file''s history is not flagged');                                                  -- 84

-- The realtime topic, measured where realtime exists (suite 72's instrument:
-- the plain file's broadcast is the control). CI starts without realtime, so
-- there this is a catalog check and nothing more; the measurement is the hand
-- run against dev, recorded in the S4b hand-off.
CREATE FUNCTION pg_temp.legal_broadcast_status()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  n     BIGINT;
  topic TEXT := 'rabbit:project:aaaa1111-0000-0000-0000-000000000001';
BEGIN
  IF to_regclass('realtime.messages') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'realtime' AND p.proname = 'broadcast_changes'
  ) THEN
    RETURN 'no-schema';
  END IF;
  BEGIN
    PERFORM realtime.send('{"probe":true}'::jsonb, 'PGTAP-PROBE', 'rabbit:pgtap:legal-partition-probe', true);
  EXCEPTION WHEN OTHERS THEN
    RETURN 'no-partition';
  END;
  EXECUTE 'SELECT count(*) FROM realtime.messages WHERE topic = ''rabbit:pgtap:legal-partition-probe''' INTO n;
  IF n = 0 THEN
    RETURN 'no-partition';
  END IF;
  EXECUTE format(
    'SELECT count(*) FROM realtime.messages
      WHERE topic = %L AND extension = ''broadcast''
        AND payload::text LIKE ''%%f9000000-0000-0000-0000-000000000002%%''', topic) INTO n;
  IF n = 0 THEN
    RETURN 'instrument-broken';
  END IF;
  EXECUTE format(
    'SELECT count(*) FROM realtime.messages
      WHERE topic = %L
        AND (payload::text LIKE ''%%f9000000-0000-0000-0000-000000000001%%''
          OR payload::text LIKE ''%%f9000000-0000-0000-0000-000000000003%%''
          OR payload::text LIKE ''%%1-contract.pdf%%'')', topic) INTO n;
  RETURN CASE WHEN n = 0 THEN 'withheld' ELSE 'leaked' END;
END;
$$;

SELECT ok(
  pg_temp.legal_broadcast_status() IN ('withheld', 'no-schema', 'no-partition'),
  'broadcast status=' || pg_temp.legal_broadcast_status()
  || ' — no Legal or invoice row reaches rabbit:project:{id}, while the plain file does');               -- 85


-- ══ K. Review round 1 — the path is fixed at add; one money path; reservations ═
-- S4b's security reviewer, measured on dev before these were written: a
-- money-cleared person declassified a Legal file with one UPDATE (out of
-- LEGAL, tag dropped); a row at projects/{id}/LEGAL was gated as a row and not
-- as an event; a member reserved a locked key and learned from the sweep
-- whether it existed.

SELECT pg_temp.act_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user');
-- The old probe 38: the member's column-free MOVE into LEGAL, tag included.
CREATE TEMP TABLE legal90_move2 (outcome TEXT);
GRANT ALL ON legal90_move2 TO PUBLIC;
DO $$
DECLARE
  v_n INT;
  v_outcome TEXT;
BEGIN
  BEGIN
    UPDATE public.files
       SET storage_path = 'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-moved.pdf',
           tags = ARRAY['legal'];
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_outcome := 'moved ' || v_n || ' row(s)';
    RAISE EXCEPTION 'legal90: undo the column-free move';
  EXCEPTION
    WHEN raise_exception THEN NULL;
    WHEN OTHERS THEN v_outcome := SQLSTATE;
  END;
  INSERT INTO legal90_move2 VALUES (v_outcome);
END $$;
SELECT is((SELECT outcome FROM legal90_move2), '23514',
  '🚨 the member cannot turn a file Legal by moving it, even with the tag (trg_files_legal_fixed)');       -- 86
SELECT throws_ok(
  $$SELECT public.reserve_upload_bytes(
    'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-big-guess.pdf', 27262976)$$,
  '42501', 'reserve_upload_bytes: you cannot write to this project',
  '🚨 the member cannot reserve a large LEGAL key — the existence test the reviewer measured');           -- 87
SELECT throws_ok(
  $$SELECT public.reserve_upload_bytes(
    'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/aaaa1111-0000-0000-0000-000000000001/9-big-guess.pdf', 27262976)$$,
  '42501', 'reserve_upload_bytes: you cannot write to this project',
  'nor an INVOICES key: the arm is the money gate, not a Legal special case');                           -- 88
SELECT isnt(
  public.reserve_upload_bytes(
    'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/9-big-plain.mov', 27262976),
  NULL::bigint,
  'CONTROL: the member still reserves a large ORDINARY key');                                            -- 89

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;
SELECT pg_temp.act_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user');
-- A fresh Legal row: the fixture Legal file was purged in §I, and an UPDATE
-- of a row that is not there raises nothing (the first draft of 90 and 92
-- passed and failed on exactly that).
INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path, size_bytes, is_financial, tags)
VALUES ('f9000000-0000-0000-0000-0000000000d7', '11111111-1111-1111-1111-111111111111',
        'aaaa1111-0000-0000-0000-000000000001', 'k-contract.pdf', 'supabase',
        'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/7-k-contract.pdf',
        10, false, ARRAY['legal']);
SELECT throws_ok(
  $$UPDATE public.files
       SET storage_path = 'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/7-k-contract.pdf',
           tags = ARRAY[]::text[]
     WHERE id = 'f9000000-0000-0000-0000-0000000000d7'$$,
  '23514', 'files_legal_fixed: a file is Legal from the moment it is added, and only then — its path cannot move into or out of LEGAL',
  '🚨 the project manager cannot DECLASSIFY a Legal file (out of LEGAL, tag dropped) — measured open in round 1'); -- 90
SELECT throws_ok(
  $$UPDATE public.files
       SET storage_path = 'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/2-plain.pdf',
           tags = ARRAY['legal']
     WHERE id = 'f9000000-0000-0000-0000-000000000002'$$,
  '23514', 'files_legal_fixed: a file is Legal from the moment it is added, and only then — its path cannot move into or out of LEGAL',
  'nor make an existing file Legal by moving it in with the tag (Legal is chosen when the file is added)'); -- 91
-- CONTROL: a path change that stays inside LEGAL is not the trigger's
-- business (undone in a sub-block; the fixture path is used below).
CREATE TEMP TABLE legal90_rename (outcome TEXT);
GRANT ALL ON legal90_rename TO PUBLIC;
DO $$
DECLARE
  v_n INT;
  v_outcome TEXT;
BEGIN
  BEGIN
    UPDATE public.files
       SET storage_path = 'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/7-k-contract-renamed.pdf'
     WHERE id = 'f9000000-0000-0000-0000-0000000000d7';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_outcome := 'renamed ' || v_n;
    RAISE EXCEPTION 'legal90: undo the rename';
  EXCEPTION
    WHEN raise_exception THEN NULL;
    WHEN OTHERS THEN v_outcome := SQLSTATE;
  END;
  INSERT INTO legal90_rename VALUES (v_outcome);
END $$;
SELECT is((SELECT outcome FROM legal90_rename), 'renamed 1',
  'CONTROL: the project manager may change a Legal file''s path WITHIN LEGAL');                           -- 92
SELECT throws_ok(
  $$INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path, size_bytes, is_financial, tags)
    VALUES ('f9000000-0000-0000-0000-0000000000d5', '11111111-1111-1111-1111-111111111111',
            'aaaa1111-0000-0000-0000-000000000001', 'settlement.pdf', 'supabase',
            'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL', 10, false, ARRAY['legal'])$$,
  '23514', 'new row for relation "files" violates check constraint "files_money_key_chk"',
  'one money path: a Legal row at projects/{id}/LEGAL (no deeper) is refused (files_money_key_chk)');   -- 93
SELECT throws_ok(
  $$INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path, size_bytes, is_financial, tags)
    VALUES ('f9000000-0000-0000-0000-0000000000d6', '11111111-1111-1111-1111-111111111111',
            'aaaa1111-0000-0000-0000-000000000001', 'release_form.pdf', 'supabase',
            'files/aaaa1111-0000-0000-0000-000000000001/LEGAL/x/1-release_form.pdf', 10, false, ARRAY['legal'])$$,
  '23514', 'new row for relation "files" violates check constraint "files_money_key_chk"',
  'nor one whose key does not start projects/ — its events would not be gated');                         -- 94
SELECT is(
  public.reserve_upload_bytes(
    'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-small-pm.pdf', 4000),
  NULL::bigint,
  'CONTROL: for the project manager a small LEGAL key is still reservation-exempt (NULL, no row)');     -- 95
SELECT isnt(
  public.reserve_upload_bytes(
    'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-big-pm.pdf', 27262976),
  NULL::bigint,
  'CONTROL: and a large one is reserved like any upload past 0078''s bound');                            -- 96

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

-- The structure the four above stand on.
SELECT is(
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid = 'public.files'::regclass AND contype = 'c' AND conname = 'files_money_key_chk'),
  'CHECK (((NOT rabbit_money_segment(split_part(storage_path, ''/''::text, 3))) OR rabbit_money_key(storage_path)))',
  'files_money_key_chk, whole');                                                                         -- 97
SELECT ok(
  EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
           WHERE tg.tgrelid = 'public.files'::regclass AND tg.tgname = 'trg_files_legal_fixed'
             AND p.proname = 'fn_files_legal_fixed' AND tg.tgenabled = 'O'
             AND (tg.tgtype & 1) <> 0 AND (tg.tgtype & 2) <> 0 AND (tg.tgtype & 16) <> 0
             AND (tg.tgtype & 4) = 0 AND (tg.tgtype & 8) = 0),
  'trg_files_legal_fixed is BEFORE UPDATE, FOR EACH ROW, enabled');                                       -- 98
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.fn_files_legal_fixed()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.fn_files_legal_fixed()', 'EXECUTE'),
  'the trigger function is closed to client roles');                                                     -- 99
SELECT ok(
  strpos(regexp_replace(regexp_replace(
           pg_get_functiondef('public.reserve_upload_bytes(text, bigint)'::regprocedure),
           '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g'),
         'OR (public.rabbit_money_key(p_path)') > 0,
  'reserve_upload_bytes carries the money arm in its comment-stripped body');                             -- 100


-- ══ L. Review round 2 — the quota meter, and the sweep's certificate ════════
-- Measured on dev against round 1's 0088: rabbit_petal_storage_ok(project,
-- bytes, path) set aside whichever reservation matched `path`, so a member
-- could confirm a manager's large Legal upload in flight at a guessed key and
-- read its size; and sweep_abandoned_uploads wrote 'upload_abandoned' with
-- is_financial false, so the abandoned Legal upload's name, key and size
-- reached every project reader.
--
-- The reservations used here were made in §K: user_d's large Legal key
-- (probe 96) and user_c's large ordinary key (probe 89). Both are still open.
-- workspace_upload_reserved_bytes is service_role only, so it is asked as
-- postgres with the person's claims in place (auth.uid() reads them).

SELECT pg_temp.act_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user');
RESET ROLE;
SELECT is(
  public.workspace_upload_reserved_bytes('11111111-1111-1111-1111-111111111111',
    'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-big-pm.pdf'),
  public.workspace_upload_reserved_bytes('11111111-1111-1111-1111-111111111111',
    'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-a-wrong-guess.pdf'),
  '🚨 for the member, the manager''s Legal key and a wrong guess weigh the same — no oracle (0088 §5c)');   -- 101
SELECT pg_temp.act_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user');
RESET ROLE;
SELECT is(
  public.workspace_upload_reserved_bytes('11111111-1111-1111-1111-111111111111',
    'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-a-wrong-guess.pdf')
  - public.workspace_upload_reserved_bytes('11111111-1111-1111-1111-111111111111',
    'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-big-pm.pdf'),
  27262976::bigint,
  'CONTROL: the uploader''s OWN reservation is still set aside when their object is weighed');           -- 102
SELECT set_config('request.jwt.claims', '', true);

-- The sweep, as cron runs it (postgres), over the two reservations made to
-- look expired.
UPDATE public.upload_reservations
   SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
   AND storage_path IN (
     'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-big-pm.pdf',
     'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/9-big-plain.mov');
SELECT * FROM public.sweep_abandoned_uploads('11111111-1111-1111-1111-111111111111');

SELECT ok(
  (SELECT is_financial FROM public.file_events
    WHERE event = 'upload_abandoned'
      AND new_path = 'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-big-pm.pdf'),
  'the sweep''s certificate for the abandoned Legal upload is flagged (trg_file_events_money)');           -- 103

SELECT pg_temp.act_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user');
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE event = 'upload_abandoned' AND new_path LIKE '%9-big-pm.pdf'),
  0, '🚨 the member does not read the abandoned Legal upload''s certificate — measured open in round 2');  -- 104
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE event = 'upload_abandoned' AND new_path LIKE '%9-big-plain.mov'),
  1, 'PRESENCE CONTROL: the member reads the abandoned ordinary upload''s certificate');                 -- 105
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;
SELECT pg_temp.act_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user');
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE event = 'upload_abandoned' AND new_path LIKE '%9-big-pm.pdf'),
  1, 'CONTROL: the project manager reads it');                                                           -- 106
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

SELECT ok(
  EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
           WHERE tg.tgrelid = 'public.file_events'::regclass AND tg.tgname = 'trg_file_events_money'
             AND p.proname = 'fn_file_events_money_snapshot' AND tg.tgenabled = 'O'
             AND (tg.tgtype & 1) <> 0 AND (tg.tgtype & 2) <> 0 AND (tg.tgtype & 4) <> 0),
  'trg_file_events_money is BEFORE INSERT, FOR EACH ROW, enabled');                                      -- 107
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.fn_file_events_money_snapshot()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.workspace_upload_reserved_bytes(uuid, text)', 'EXECUTE'),
  'the trigger function and the reserved-bytes meter stay closed to client roles');                      -- 108

SELECT * FROM finish();
ROLLBACK;
