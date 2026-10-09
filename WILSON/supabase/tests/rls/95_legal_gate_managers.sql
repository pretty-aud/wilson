-- =============================================================================
-- 95_legal_gate_managers.sql — post-overhaul S4d: Legal files get a gate of
-- their own (migration 0092). Workspace managers see them without taking a
-- project's manager seat; money does not widen; a deleted file's record
-- follows the file's gate for a Legal file and an invoice alike.
--
-- Audrey, 2026-10-08: who else sees Legal files — "Also workspace managers,
-- without taking a seat." 2026-10-09 (Legal 1): "keep legal docs and invoices
-- hidden from members and reviewers. admins and managers should have the
-- ability to see it." D8: money stays the project manager's and the admin's.
--
-- WHO IS WHO (all in workspace A, on project A unless said otherwise):
--   user_a  workspace ADMIN (rls_setup) — both gates by the first arm
--   user_d  workspace 'user', project MANAGER — both gates by the seat
--   user_c  workspace 'user', project MEMBER
--   user_r  workspace 'user', project REVIEWER
--   user_m  workspace MANAGER holding only a project MEMBER seat — the Legal
--           gate's new audience, and still outside the money gate
--   user_n  workspace MANAGER with NO seat on project A — the same, and the
--           creator of the private project P3
--   user_b  workspace B's admin, acting as B's workspace manager; anon
--   P2      a PRIVATE project in workspace A created by user_d (its manager)
--   P3      a PRIVATE project in workspace A created by user_n (no seats)
--
-- WHAT THIS PINS, in order of how badly it would hurt:
--   * 🚨 MONEY DOES NOT WIDEN (§C, §D, §F, §O): user_m and user_n read no
--     invoice row, body, thumbnail, FINANCE mirror, event, history row or
--     deletion certificate, reserve no INVOICES / FINANCE key, trash and
--     download no invoice, add no invoice, cannot rename a Legal object into
--     INVOICES or flag a Legal row — each beside a PRESENCE CONTROL (the same
--     reader sees the Legal thing), and the money predicate itself has no
--     app-manager leg (§A).
--   * 🚨 A workspace manager SEES Legal files without a seat (§C, §D): the
--     row, the body, the thumbnail, the events, the edit history, the
--     download log, the trash RPCs, a reservation for a LEGAL key, a Legal
--     row they add — every closure S4b's hand-off §3 listed, re-pointed.
--   * 🚨 A member and a reviewer still see NOTHING of a Legal file (§E), the
--     deletion certificate included; and since Legal 1 nothing of an
--     invoice's deletion either (§I) — ruling 22 narrowed, with the plain
--     file's certificate as the presence control.
--   * Another workspace's manager, a forged claim, and anon get nothing (§F).
--   * A private project (§H): a workspace manager who did not create it sees
--     none of its Legal files (0072's arm inside the predicate); its creator,
--     a workspace manager, sees its Legal file and still not its invoice.
--   * The sweep's certificate (§J), the meter (§K) and the realtime topic (§L)
--     answer the new audience the same way they answer the money audience.
--   * The structure the behaviour stands on (§A): the predicate's body, the
--     three classifiers and their subset relations, the CHECK, the four files
--     policies, the eight money storage policies and both read policies —
--     WHOLE as Postgres prints them (S4a trap 16).
--
-- Every absence probe has a presence control, so an empty answer cannot pass
-- by accident. 🚨 RUNS INSIDE ONE TRANSACTION THAT ROLLS BACK. Postgres-side
-- reads are scoped to the fixture ids: dev carries real rows. Nothing deletes
-- from storage.objects (protect_delete forbids it).
-- =============================================================================

BEGIN;

SELECT plan(151);

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
  ('95950000-0000-0000-0000-0000000000a1', 'user_r95@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('95950000-0000-0000-0000-0000000000a2', 'user_m95@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('95950000-0000-0000-0000-0000000000a3', 'user_n95@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user',    'user_c',   'User C', true),
  ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'user',    'user_d',   'User D', true),
  ('11111111-1111-1111-1111-111111111111', '95950000-0000-0000-0000-0000000000a1', 'user',    'user_r95', 'User R', true),
  ('11111111-1111-1111-1111-111111111111', '95950000-0000-0000-0000-0000000000a2', 'manager', 'user_m95', 'User M', true),
  ('11111111-1111-1111-1111-111111111111', '95950000-0000-0000-0000-0000000000a3', 'manager', 'user_n95', 'User N', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role)
VALUES
  ('aaaa1111-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1111-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'manager'),
  ('aaaa1111-0000-0000-0000-000000000001', '95950000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1111-0000-0000-0000-000000000001', '95950000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;

-- The two private projects (0072), as postgres: fn_audit_touch keeps an
-- explicit created_by. P2 is user_d's (and user_d holds its manager seat);
-- P3 is user_n's, a workspace manager with no seat anywhere.
INSERT INTO public.projects (id, workspace_id, title, created_by, is_private)
VALUES
  ('95950000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Private P2 (user_d)', 'dddddddd-dddd-dddd-dddd-dddddddddddd', true),
  ('95950000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Private P3 (user_n)', '95950000-0000-0000-0000-0000000000a3', true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role)
VALUES
  ('95950000-0000-0000-0000-000000000002', 'dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'manager')
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

-- Fixture ids, all on project A unless said otherwise:
--   f95…01  THE Legal file     projects/A/LEGAL/A/1-contract.pdf  (+ its .jpg)
--   f95…02  a plain file        projects/A/project/A/1-brief.pdf   (+ its object)
--   f95…03  an invoice          projects/A/INVOICES/A/1-invoice.pdf (+ body, .jpg)
--           the FINANCE mirror  projects/A/FINANCE/RATES.json (an object only)
--   f95…04  P2's Legal file     projects/P2/LEGAL/P2/1-nda.pdf     (+ body)
--   f95…05  P2's invoice
--   f95…06  P3's Legal file     projects/P3/LEGAL/P3/1-option.pdf  (+ body)
--   f95…07  P3's invoice
--   f95…08  a Legal file user_m ADDS in §C (+ body, .jpg)


-- ══ A. Structure ═════════════════════════════════════════════════════════════

-- A1-A3: the predicate — grants, shape, and its comment-stripped body.
SELECT ok(
  has_function_privilege('authenticated', 'public.can_access_project_legal(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.can_access_project_legal(uuid)', 'EXECUTE')
  AND EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.can_access_project_legal(uuid)'::regprocedure
               AND prosecdef AND provolatile = 's' AND proconfig @> ARRAY['search_path=public']),
  'can_access_project_legal: STABLE SECURITY DEFINER, search_path pinned, authenticated may call it (the client asks it), anon may not'); -- 1

CREATE TEMP TABLE legal95_body AS
  SELECT regexp_replace(regexp_replace(
           pg_get_functiondef('public.can_access_project_legal(uuid)'::regprocedure),
           '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g') AS body;
SELECT ok(
  (SELECT bool_and((length(body) - length(replace(body, piece, ''))) / length(piece) = 1)
     FROM legal95_body, unnest(ARRAY[
       'COALESCE(public.can_access_project_money(p_project), false)',
       'public.current_app_role() = ''manager''',
       'p.workspace_id = public.current_workspace_id()',
       'public.has_active_membership(p.workspace_id)',
       'public.passes_project_privacy(p_project)']) AS piece),
  'its body is the money gate (called, once) OR the manager leg with 0037''s workspace hop and 0072''s arm (passes_project_privacy), each once'); -- 2
SELECT ok(
  (SELECT body !~ 'current_app_role\(\) = ''admin''' AND body !~ 'project_role_for' AND body !~ 'project_is_staffed' FROM legal95_body),
  'it copies no money leg and opens no unstaffed project — Legal fails closed like money');                 -- 3

-- A4: 🚨 the money predicate is 0037's — no app-manager leg, no Legal gate.
SELECT ok(
  (SELECT b !~ 'current_app_role\(\)\s*(=|IN)\s*\(?''manager'''
      AND b !~ 'ARRAY\[''admin''::text, ''manager''::text\]'
      AND strpos(b, 'can_access_project_legal') = 0
      AND strpos(b, 'public.project_role_for(p_project) = ''manager''') > 0
      AND strpos(b, 'public.current_app_role() = ''admin''') > 0
     FROM (SELECT regexp_replace(regexp_replace(
             pg_get_functiondef('public.can_access_project_money(uuid)'::regprocedure),
             '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g') AS b) s),
  '🚨 can_access_project_money is 0037''s body: admin or the project''s manager, never a workspace manager, never the Legal gate'); -- 4

-- A5-A7: the classifiers, never NULL, each a SUBSET of its twin.
SELECT ok(
  public.file_row_is_legal(false, 'projects/p/LEGAL/x/1-a.pdf')
  AND public.file_row_is_legal(NULL, 'projects/p/legal/x/1-a.pdf')
  AND NOT public.file_row_is_legal(true, 'projects/p/LEGAL/x/1-a.pdf')
  AND NOT public.file_row_is_legal(false, 'projects/p/INVOICES/x/1-a.pdf')
  AND NOT public.file_row_is_legal(false, 'projects/p/FINANCE/RATES.json')
  AND NOT public.file_row_is_legal(true, 'projects/p/project/x/1-a.pdf')
  AND NOT public.file_row_is_legal(false, 'local-name.pdf')
  AND public.file_row_is_legal(NULL, NULL) IS FALSE,
  'file_row_is_legal: under LEGAL and NOT flagged; never an invoice, a FINANCE mirror or a plain file; never NULL');   -- 5
SELECT ok(
  public.rabbit_legal_key('projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/x/1-a.pdf')
  AND public.rabbit_legal_key('projects/aaaa1111-0000-0000-0000-000000000001/legal/x/1-a.pdf')
  AND NOT public.rabbit_legal_key('projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/x/1-a.pdf')
  AND NOT public.rabbit_legal_key('LEGAL/x/1-a.pdf')
  AND NOT public.rabbit_legal_key('files/p/LEGAL/x/1-a.pdf')
  AND public.rabbit_legal_key(NULL) IS FALSE
  AND public.file_event_is_legal(NULL, 'projects/p/LEGAL/x/1-a.pdf')
  AND public.file_event_is_legal('projects/p/LEGAL/x/1-a.pdf', NULL)
  AND NOT public.file_event_is_legal('projects/p/INVOICES/x/1-a.pdf', 'projects/p/FINANCE/RATES.json')
  AND public.file_event_is_legal(NULL, NULL) IS FALSE,
  'rabbit_legal_key / file_event_is_legal: a row-shaped projects/{id}/LEGAL/… key, either path; never a money key; never NULL'); -- 6
SELECT ok(
  NOT EXISTS (SELECT 1 FROM unnest(ARRAY['projects/p/LEGAL/x/1-a.pdf', 'projects/p/legal/x/1-a.pdf', 'projects/p/Legal/x/1-a.pdf']) k
               WHERE (public.file_row_is_legal(false, k) AND NOT public.file_row_is_money(false, k))
                  OR (public.rabbit_legal_key(k) AND NOT public.rabbit_money_key(k))
                  OR (public.file_event_is_legal(k, NULL) AND NOT public.file_event_is_financial(false, k, NULL)))
  AND has_function_privilege('authenticated', 'public.file_row_is_legal(boolean, text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.rabbit_legal_key(text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.file_event_is_legal(text, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.file_row_is_legal(boolean, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.rabbit_legal_key(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.file_event_is_legal(text, text)', 'EXECUTE'),
  'every Legal classifier is a subset of its money twin (a Legal thing is still a locked thing), callable by authenticated, not by anon'); -- 7

-- A8: the CHECK, whole.
SELECT is(
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid = 'public.files'::regclass AND conname = 'files_legal_not_financial_chk'),
  'CHECK ((NOT (COALESCE(is_financial, false) AND (COALESCE((tags @> ARRAY[''legal''::text]), false) OR rabbit_legal_segment(split_part(storage_path, ''/''::text, 3))))))',
  'files_legal_not_financial_chk: a Legal file (tag or folder) is never is_financial, exactly');          -- 8

-- A9-A13: the four files policies, clause by clause, WHOLE.
SELECT is(
  (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'files' AND policyname = 'files_select'),
  '((deleted_at IS NULL) AND (workspace_id = current_workspace_id()) AND (EXISTS ( SELECT 1' || chr(10)
  || '   FROM projects p' || chr(10) || '  WHERE (p.id = files.project_id))) AND ((NOT file_row_is_money(is_financial, storage_path)) OR can_access_project_money(project_id) OR (file_row_is_legal(is_financial, storage_path) AND can_access_project_legal(project_id))))',
  'files_select: 0088''s body with the Legal arm');                                                       -- 9
SELECT is(
  (SELECT with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'files' AND policyname = 'files_insert'),
  '((workspace_id = current_workspace_id()) AND has_active_membership(workspace_id) AND can_write_project(project_id) AND ((NOT file_row_is_money(is_financial, storage_path)) OR can_access_project_money(project_id) OR (file_row_is_legal(is_financial, storage_path) AND can_access_project_legal(project_id))) AND (EXISTS ( SELECT 1' || chr(10)
  || '   FROM projects p' || chr(10) || '  WHERE (p.id = files.project_id))))',
  'files_insert: 0088''s body with the Legal arm');                                                       -- 10
SELECT is(
  (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'files' AND policyname = 'files_update'),
  '((workspace_id = current_workspace_id()) AND has_active_membership(workspace_id) AND can_write_project(project_id) AND ((NOT file_row_is_money(is_financial, storage_path)) OR can_access_project_money(project_id) OR (file_row_is_legal(is_financial, storage_path) AND can_access_project_legal(project_id))))',
  'files_update USING: 0088''s with the Legal arm');                                                      -- 11
SELECT is(
  (SELECT with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'files' AND policyname = 'files_update'),
  '((workspace_id = current_workspace_id()) AND can_write_project(project_id) AND ((NOT file_row_is_money(is_financial, storage_path)) OR can_access_project_money(project_id) OR (file_row_is_legal(is_financial, storage_path) AND can_access_project_legal(project_id))) AND (EXISTS ( SELECT 1' || chr(10)
  || '   FROM projects p' || chr(10) || '  WHERE (p.id = files.project_id))))',
  'files_update WITH CHECK: 0088''s with the Legal arm');                                                 -- 12
SELECT is(
  (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'files' AND policyname = 'files_delete'),
  '((workspace_id = current_workspace_id()) AND has_active_membership(workspace_id) AND can_write_project(project_id) AND ((NOT file_row_is_money(is_financial, storage_path)) OR can_access_project_money(project_id) OR (file_row_is_legal(is_financial, storage_path) AND can_access_project_legal(project_id))))',
  'files_delete: 0088''s body with the Legal arm');                                                       -- 13
SELECT is(
  (SELECT array_agg(policyname::TEXT ORDER BY policyname) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'files' AND permissive = 'PERMISSIVE'),
  ARRAY['files_delete','files_insert','files_select','files_update']::TEXT[],
  'files keeps exactly its four permissive policies — none added beside');                               -- 14

-- A15-A16: the eight money storage policies WHOLE (both buckets, every
-- clause), the eight base ones untouched in shape.
CREATE TEMP TABLE legal95_obj AS
  SELECT b AS bucket, p AS prefix,
         '((bucket_id = ''' || b || '''::text) AND (auth.role() = ''authenticated''::text) AND ((storage.foldername(name))[1] = ''projects''::text) AND rabbit_money_segment((storage.foldername(name))[3]) AND (can_access_project_money(fn_try_uuid((storage.foldername(name))[2])) OR (rabbit_legal_segment((storage.foldername(name))[3]) AND can_access_project_legal(fn_try_uuid((storage.foldername(name))[2])))))' AS gate
    FROM (VALUES ('rabbit-files', 'rabbit_files'), ('rabbit-thumbnails', 'rabbit_thumbnails')) v(b, p);
SELECT ok(
  (SELECT bool_and(
      (SELECT qual FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = prefix || '_money_select' AND cmd = 'SELECT') = gate
      AND (SELECT with_check FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = prefix || '_money_insert' AND cmd = 'INSERT') = gate
      AND (SELECT qual FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = prefix || '_money_update' AND cmd = 'UPDATE') = gate
      AND (SELECT with_check FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = prefix || '_money_update' AND cmd = 'UPDATE') = gate
      AND (SELECT qual FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = prefix || '_money_delete' AND cmd = 'DELETE') = gate)
     FROM legal95_obj),
  'the eight money storage policies, both buckets, every clause: the segment still LOCKED (rabbit_money_segment), opened by the money gate OR, for LEGAL, the Legal gate'); -- 15
SELECT ok(
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (policyname LIKE 'rabbit\_files%' OR policyname LIKE 'rabbit\_thumbnails%')
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%rabbit_money_segment((storage.foldername(name))[3])%') = 16
  AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (policyname LIKE 'rabbit\_files\_%' OR policyname LIKE 'rabbit\_thumbnails\_%')
     AND policyname NOT LIKE '%\_money\_%'
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%(NOT rabbit_money_segment((storage.foldername(name))[3]))%'
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%FROM projects p%'
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) NOT LIKE '%can_access_project_%') = 8
  AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
               AND policyname = 'petal_storage_quota_insert' AND permissive = 'RESTRICTIVE'),
  'the sixteen ride the one list; the eight base ones still negate it, hop to projects and name no gate; the quota policy is still RESTRICTIVE'); -- 16

-- A17-A18: the two read policies, whole — no purged arm (Legal 1).
SELECT is(
  (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'edit_history' AND policyname = 'edit_history_select'),
  '((workspace_id = current_workspace_id()) AND (current_app_role() = ANY (ARRAY[''admin''::text, ''manager''::text])) AND has_active_membership(workspace_id) AND ((NOT is_financial) OR (current_app_role() = ''admin''::text) OR COALESCE(can_access_project_money(project_id), false) OR (is_legal AND COALESCE(can_access_project_legal(project_id), false))))',
  'edit_history_select: 0012''s arms, 0088''s money arm, and the Legal arm on is_legal rows');            -- 17
SELECT is(
  (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'file_events' AND policyname = 'file_events_select'),
  '((workspace_id = current_workspace_id()) AND has_active_membership(workspace_id) AND (can_read_project_topic(project_id) OR (current_app_role() = ''admin''::text)) AND ((NOT is_financial) OR (current_app_role() = ''admin''::text) OR COALESCE(can_access_project_money(project_id), false) OR (file_event_is_legal(old_path, new_path) AND COALESCE(can_access_project_legal(project_id), false))))',
  '🚨 file_events_select: 0074''s arms, the money arm, the Legal arm — and NO purged exception (Legal 1)'); -- 18

-- A19-A20: edit_history's is_legal snapshot column, the classifier's three
-- answers, the trigger; the DEFINER pieces closed to clients.
SELECT ok(
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'edit_history'
           AND column_name = 'is_legal' AND is_nullable = 'NO' AND column_default = 'false')
  AND (SELECT proargnames FROM pg_proc WHERE oid = 'public.edit_history_file_class(uuid, jsonb)'::regprocedure)
      = ARRAY['p_entity_id', 'p_diff', 'is_money', 'is_legal', 'project_id']::text[]
  AND EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
               WHERE tg.tgrelid = 'public.edit_history'::regclass AND tg.tgname = 'trg_edit_history_money'
                 AND p.proname = 'fn_edit_history_money_snapshot' AND tg.tgenabled = 'O'
                 AND (tg.tgtype & 1) <> 0 AND (tg.tgtype & 2) <> 0 AND (tg.tgtype & 4) <> 0),
  'edit_history.is_legal (NOT NULL DEFAULT false), the classifier answers (is_money, is_legal, project_id), the BEFORE INSERT trigger stands'); -- 19
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.edit_history_file_class(uuid, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.edit_history_file_class(uuid, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.fn_edit_history_money_snapshot()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.fn_trash_authz(text, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.passes_project_privacy(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.log_file_downloaded(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.reserve_upload_bytes(text, bigint)', 'EXECUTE'),
  'the DEFINER classifier, trigger, trash gate and privacy restatement are closed to clients; the two client RPCs stay callable'); -- 20


-- ══ B. The project manager adds the fixtures — presence controls ═════════════

SELECT pg_temp.act_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user');

SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/1-contract.pdf',
            'dddddddd-dddd-dddd-dddd-dddddddddddd', '{"size": 4000}'::jsonb),
           ('rabbit-thumbnails',
            'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/1-contract.pdf.jpg',
            'dddddddd-dddd-dddd-dddd-dddddddddddd', '{"mimetype":"image/jpeg"}'::jsonb),
           ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/aaaa1111-0000-0000-0000-000000000001/1-invoice.pdf',
            'dddddddd-dddd-dddd-dddd-dddddddddddd', '{"size": 200}'::jsonb),
           ('rabbit-thumbnails',
            'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/aaaa1111-0000-0000-0000-000000000001/1-invoice.pdf.jpg',
            'dddddddd-dddd-dddd-dddd-dddddddddddd', '{"mimetype":"image/jpeg"}'::jsonb),
           ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/FINANCE/RATES.json',
            'dddddddd-dddd-dddd-dddd-dddddddddddd', '{"size": 120}'::jsonb),
           ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/1-brief.pdf',
            'dddddddd-dddd-dddd-dddd-dddddddddddd', '{"size": 300}'::jsonb)$$,
  'the project manager writes the Legal body and thumbnail, the invoice body and thumbnail, the FINANCE mirror and a plain body'); -- 21

SELECT lives_ok(
  $$INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path,
                              thumbnail_url, size_bytes, is_financial, tags, description)
    VALUES ('f9500000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
            'aaaa1111-0000-0000-0000-000000000001', 'contract.pdf', 'supabase',
            'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/1-contract.pdf',
            'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/1-contract.pdf.jpg',
            4000, false, ARRAY['legal'], 'release terms, confidential'),
           ('f9500000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
            'aaaa1111-0000-0000-0000-000000000001', 'brief.pdf', 'supabase',
            'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/1-brief.pdf',
            NULL, 300, false, ARRAY[]::text[], 'the brief'),
           ('f9500000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
            'aaaa1111-0000-0000-0000-000000000001', 'invoice.pdf', 'supabase',
            'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/aaaa1111-0000-0000-0000-000000000001/1-invoice.pdf',
            'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/aaaa1111-0000-0000-0000-000000000001/1-invoice.pdf.jpg',
            200, true, ARRAY[]::text[], 'net 30')$$,
  'and the three rows: the Legal file (tag with folder, not is_financial), the plain file, the invoice'); -- 22

SELECT lives_ok(
  $$UPDATE public.files SET description = 'release terms, confidential (signed)'
     WHERE id = 'f9500000-0000-0000-0000-000000000001'$$,
  'the project manager edits the Legal file''s note, and the invoice''s (edit history is written for both)'); -- 23
UPDATE public.files SET description = 'net 30 (approved)' WHERE id = 'f9500000-0000-0000-0000-000000000003';

SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id IN ('f9500000-0000-0000-0000-000000000001', 'f9500000-0000-0000-0000-000000000003')),
  2, 'CONTROL: the project manager reads the Legal row and the invoice');                                 -- 24
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE name ILIKE 'projects/aaaa1111-0000-0000-0000-000000000001/invoices/%'
       OR name = 'projects/aaaa1111-0000-0000-0000-000000000001/FINANCE/RATES.json'),
  3, 'CONTROL: the project manager reads the invoice body, its thumbnail and the FINANCE mirror');        -- 25

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

-- The private projects' files, as postgres (RLS bypassed): a Legal file and an
-- invoice on each, no plain file (the column-free DELETE probe counts rows).
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES ('rabbit-files',
        'projects/95950000-0000-0000-0000-000000000002/LEGAL/95950000-0000-0000-0000-000000000002/1-nda.pdf',
        'dddddddd-dddd-dddd-dddd-dddddddddddd', '{"size": 500}'::jsonb),
       ('rabbit-files',
        'projects/95950000-0000-0000-0000-000000000003/LEGAL/95950000-0000-0000-0000-000000000003/1-option.pdf',
        '95950000-0000-0000-0000-0000000000a3', '{"size": 600}'::jsonb);
INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path, size_bytes, is_financial, tags)
VALUES ('f9500000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
        '95950000-0000-0000-0000-000000000002', 'nda.pdf', 'supabase',
        'projects/95950000-0000-0000-0000-000000000002/LEGAL/95950000-0000-0000-0000-000000000002/1-nda.pdf',
        500, false, ARRAY['legal']),
       ('f9500000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
        '95950000-0000-0000-0000-000000000002', 'p2-invoice.pdf', 'supabase',
        'projects/95950000-0000-0000-0000-000000000002/INVOICES/95950000-0000-0000-0000-000000000002/1-p2-invoice.pdf',
        50, true, ARRAY[]::text[]),
       ('f9500000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
        '95950000-0000-0000-0000-000000000003', 'option.pdf', 'supabase',
        'projects/95950000-0000-0000-0000-000000000003/LEGAL/95950000-0000-0000-0000-000000000003/1-option.pdf',
        600, false, ARRAY['legal']),
       ('f9500000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
        '95950000-0000-0000-0000-000000000003', 'p3-invoice.pdf', 'supabase',
        'projects/95950000-0000-0000-0000-000000000003/INVOICES/95950000-0000-0000-0000-000000000003/1-p3-invoice.pdf',
        60, true, ARRAY[]::text[]);

-- user_c's own plain file and object (the reservation and delete controls).
SELECT pg_temp.act_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user');
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES ('rabbit-files',
        'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/2-mine.pdf',
        'cccccccc-cccc-cccc-cccc-cccccccccccc', '{"size": 100}'::jsonb);
INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path, size_bytes, is_financial)
VALUES ('f9500000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111',
        'aaaa1111-0000-0000-0000-000000000001', 'mine.pdf', 'supabase',
        'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/2-mine.pdf',
        100, false);
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

CREATE TEMP TABLE legal95_rpc (k TEXT, v TEXT);
GRANT ALL ON legal95_rpc TO PUBLIC;


-- ══ C. A WORKSPACE MANAGER holding a MEMBER seat (user_m) — the new audience ══

SELECT pg_temp.act_as('95950000-0000-0000-0000-0000000000a2', 'manager');

SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id = 'f9500000-0000-0000-0000-000000000002'),
  1, 'PRESENCE CONTROL: the workspace manager reads the plain file');                                    -- 26
SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id = 'f9500000-0000-0000-0000-000000000001'),
  1, '🚨 the workspace manager reads the Legal ROW without a manager seat — name, note, tags, size (Audrey, 2026-10-08)'); -- 27
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'rabbit-files'
      AND name = 'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/1-contract.pdf'),
  1, '🚨 …and the Legal BODY');                                                                          -- 28
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'rabbit-thumbnails'
      AND name = 'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/1-contract.pdf.jpg'),
  1, '…and its THUMBNAIL');                                                                              -- 29
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE name ILIKE 'projects/aaaa1111-0000-0000-0000-000000000001/legal/%'),
  2, '…and lists both under LEGAL/');                                                                    -- 30
SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id = 'f9500000-0000-0000-0000-000000000003'),
  0, '🚨 MONEY DOES NOT WIDEN: the workspace manager cannot read the INVOICE row');                       -- 31
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE name ILIKE 'projects/aaaa1111-0000-0000-0000-000000000001/invoices/%'),
  0, '🚨 nor the invoice body or its thumbnail, in either bucket');                                       -- 32
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE name = 'projects/aaaa1111-0000-0000-0000-000000000001/FINANCE/RATES.json'),
  0, '🚨 nor the FINANCE mirror (the rates)');                                                           -- 33

-- Events and history.
SELECT is(
  (SELECT count(*)::int FROM public.file_events WHERE file_id = 'f9500000-0000-0000-0000-000000000001'),
  1, 'the workspace manager reads the Legal file''s uploaded event');                                     -- 34
SELECT is(
  (SELECT count(*)::int FROM public.file_events WHERE file_id = 'f9500000-0000-0000-0000-000000000003'),
  0, '🚨 and none of the invoice''s');                                                                    -- 35
SELECT ok(
  (SELECT count(*) FROM public.edit_history
    WHERE entity_type = 'files' AND entity_id = 'f9500000-0000-0000-0000-000000000002') > 0,
  'PRESENCE CONTROL: the workspace manager reads the plain file''s edit history (0012 admits app managers)'); -- 36
SELECT is(
  (SELECT count(*)::int FROM public.edit_history
    WHERE entity_type = 'files' AND entity_id = 'f9500000-0000-0000-0000-000000000001'),
  2, '🚨 the workspace manager reads the Legal file''s edit history (created, note edited) — closed to them under 0088'); -- 37
SELECT is(
  (SELECT count(*)::int FROM public.edit_history
    WHERE entity_type = 'files' AND entity_id = 'f9500000-0000-0000-0000-000000000003'),
  0, '🚨 and none of the invoice''s history, which was also edited');                                     -- 38

-- The download log and the trash.
SELECT lives_ok(
  $$SELECT public.log_file_downloaded('f9500000-0000-0000-0000-000000000001')$$,
  'the workspace manager logs a read of the Legal file');                                                -- 39
SELECT throws_ok(
  $$SELECT public.log_file_downloaded('f9500000-0000-0000-0000-000000000003')$$,
  'log_file_downloaded: file not found or not readable',
  '🚨 and cannot log a read of the invoice — the refusal any non-reader gets (no oracle)');              -- 40
DO $$
BEGIN
  BEGIN
    INSERT INTO legal95_rpc VALUES ('c1-trash', public.soft_delete_row('files', 'f9500000-0000-0000-0000-000000000001')::text);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO legal95_rpc VALUES ('c1-trash', SQLSTATE);
  END;
  BEGIN
    INSERT INTO legal95_rpc VALUES ('c2-restore', public.restore_soft_deleted('files', 'f9500000-0000-0000-0000-000000000001')::text);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO legal95_rpc VALUES ('c2-restore', SQLSTATE);
  END;
END $$;
SELECT is(
  (SELECT string_agg(v, ',' ORDER BY k) FROM legal95_rpc WHERE k LIKE 'c%'),
  'true,true', 'the workspace manager trashes and restores the Legal file by id (fn_trash_authz''s Legal clause)'); -- 41
SELECT throws_ok(
  $$SELECT public.soft_delete_row('files', 'f9500000-0000-0000-0000-000000000003')$$,
  'not allowed to soft-delete or restore this row',
  '🚨 and cannot trash the invoice by id — the refusal an unknown id gets');                             -- 42

-- Reservations: a LEGAL key yes (small: exempt, NULL; large: reserved), an
-- INVOICES or FINANCE key no, small or large, with one refusal.
SELECT is(
  public.reserve_upload_bytes(
    'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-small-wm.pdf', 4000),
  NULL::bigint, 'the workspace manager reserves a small LEGAL key: reservation-exempt (NULL, no row)');   -- 43
SELECT isnt(
  public.reserve_upload_bytes(
    'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-big-wm.pdf', 27262976),
  NULL::bigint, '…and a large one is reserved like any upload past 0078''s bound');                      -- 44
SELECT throws_ok(
  $$SELECT public.reserve_upload_bytes(
    'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/aaaa1111-0000-0000-0000-000000000001/9-small-wm.pdf', 4000)$$,
  '42501', 'reserve_upload_bytes: you cannot write to this project',
  '🚨 a small INVOICES key is refused in the first refusal — before the exemption, so no "exempt" answer leaks'); -- 45
SELECT throws_ok(
  $$SELECT public.reserve_upload_bytes(
    'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/aaaa1111-0000-0000-0000-000000000001/9-big-wm.pdf', 27262976)$$,
  '42501', 'reserve_upload_bytes: you cannot write to this project',
  '🚨 a large INVOICES key too — no existence test for a guessed invoice key');                          -- 46
SELECT throws_ok(
  $$SELECT public.reserve_upload_bytes(
    'projects/aaaa1111-0000-0000-0000-000000000001/FINANCE/RATES.json', 120)$$,
  '42501', 'reserve_upload_bytes: you cannot write to this project',
  '🚨 and the FINANCE mirror');                                                                           -- 47

-- Writes.
SELECT lives_ok(
  $$UPDATE public.files SET description = 'countersigned by the workspace manager'
     WHERE id = 'f9500000-0000-0000-0000-000000000001'$$,
  'the workspace manager edits the Legal file''s note (files_update, USING and WITH CHECK)');             -- 48
SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/8-nda.pdf',
            '95950000-0000-0000-0000-0000000000a2', '{"size": 10}'::jsonb),
           ('rabbit-thumbnails',
            'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/8-nda.pdf.jpg',
            '95950000-0000-0000-0000-0000000000a2', '{"mimetype":"image/jpeg"}'::jsonb)$$,
  '🚨 the workspace manager writes a Legal body and thumbnail under LEGAL/ (the money INSERT policies'' Legal arm)'); -- 49
SELECT lives_ok(
  $$INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path, thumbnail_url, size_bytes, is_financial, tags)
    VALUES ('f9500000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
            'aaaa1111-0000-0000-0000-000000000001', 'nda.pdf', 'supabase',
            'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/8-nda.pdf',
            'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/8-nda.pdf.jpg',
            10, false, ARRAY['legal'])$$,
  '…and adds the Legal row (files_insert''s Legal arm): Add as Legal works for them');                   -- 50
SELECT throws_ok(
  $$INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path, size_bytes, is_financial)
    VALUES ('f9500000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111',
            'aaaa1111-0000-0000-0000-000000000001', 'w-invoice.pdf', 'supabase',
            'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/aaaa1111-0000-0000-0000-000000000001/9-w.pdf',
            10, true)$$,
  '42501', NULL, '🚨 but cannot add an invoice row');                                                     -- 51
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files', 'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/aaaa1111-0000-0000-0000-000000000001/9-w.pdf',
            '95950000-0000-0000-0000-0000000000a2', '{"size": 10}'::jsonb)$$,
  'new row violates row-level security policy for table "objects"',
  '🚨 nor write a body under INVOICES/');                                                                 -- 52
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-thumbnails', 'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/aaaa1111-0000-0000-0000-000000000001/9-w.pdf.jpg',
            '95950000-0000-0000-0000-0000000000a2', '{"mimetype":"image/jpeg"}'::jsonb)$$,
  'new row violates row-level security policy for table "objects"',
  '🚨 nor a thumbnail under INVOICES/');                                                                  -- 53
SELECT throws_ok(
  $$UPDATE storage.objects
       SET name = 'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/aaaa1111-0000-0000-0000-000000000001/8-nda.pdf'
     WHERE name = 'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/8-nda.pdf'$$,
  'new row violates row-level security policy for table "objects"',
  '🚨 nor rename a Legal object INTO INVOICES/ (the money UPDATE policy''s WITH CHECK: INVOICES is not Legal, and money refuses them)'); -- 54
SELECT throws_ok(
  $$UPDATE public.files SET is_financial = true WHERE id = 'f9500000-0000-0000-0000-000000000008'$$,
  '42501', NULL, '🚨 nor turn their Legal file into an invoice by flagging it (files_update WITH CHECK refuses before the CHECK)'); -- 55
SELECT throws_ok(
  $$UPDATE public.files
       SET storage_path = 'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/8-nda.pdf',
           tags = ARRAY[]::text[]
     WHERE id = 'f9500000-0000-0000-0000-000000000008'$$,
  '23514', 'files_legal_fixed: a file is Legal from the moment it is added, and only then — its path cannot move into or out of LEGAL',
  'nor declassify it: Legal is fixed at add for the new audience too (trg_files_legal_fixed)');          -- 56

-- The two column-free statements (0083 C-R2-01 / suite 90 probes 36-38): only
-- files_delete''s and files_update''s own clauses judge them. Counted inside
-- a sub-block that is then undone, so the fixtures stay.
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;
CREATE TEMP TABLE legal95_cf (k TEXT, v TEXT);
GRANT ALL ON legal95_cf TO PUBLIC;
SELECT pg_temp.act_as('95950000-0000-0000-0000-0000000000a2', 'manager');
DO $$
DECLARE
  v_n INT;
  v_out TEXT;
BEGIN
  BEGIN
    DELETE FROM public.files;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_n::text;
    RAISE EXCEPTION 'legal95: undo the column-free delete';
  EXCEPTION
    WHEN raise_exception THEN NULL;
    WHEN OTHERS THEN v_out := SQLSTATE;
  END;
  INSERT INTO legal95_cf VALUES ('delete', v_out);
  BEGIN
    UPDATE public.files SET is_financial = true;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := 'flagged ' || v_n;
    RAISE EXCEPTION 'legal95: undo the column-free flag';
  EXCEPTION
    WHEN raise_exception THEN NULL;
    WHEN OTHERS THEN v_out := SQLSTATE;
  END;
  INSERT INTO legal95_cf VALUES ('flag', v_out);
END $$;
SELECT is((SELECT v FROM legal95_cf WHERE k = 'delete'), '4',
  '🚨 the workspace manager''s column-free DELETE reaches project A''s two plain rows and two Legal rows — never the invoice, never a private project''s Legal row (files_delete''s arm)'); -- 57
SELECT is((SELECT v FROM legal95_cf WHERE k = 'flag'), '42501',
  '🚨 their column-free UPDATE cannot make anything money by flagging it (files_update WITH CHECK, alone)'); -- 58

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;


-- ══ D. A WORKSPACE MANAGER with NO seat (user_n) ═════════════════════════════

SELECT pg_temp.act_as('95950000-0000-0000-0000-0000000000a3', 'manager');

SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id = 'f9500000-0000-0000-0000-000000000001'),
  1, '🚨 a workspace manager with NO seat on the project reads the Legal row ("without taking a seat")');  -- 59
SELECT is(
  (SELECT count(*)::int FROM storage.objects WHERE name ILIKE 'projects/aaaa1111-0000-0000-0000-000000000001/legal/%'),
  4, '…and every Legal body and thumbnail (two files, four objects)');                                   -- 60
SELECT is(
  (SELECT count(*)::int FROM public.file_events WHERE file_id = 'f9500000-0000-0000-0000-000000000001'),
  4, '…and the Legal file''s events (uploaded; user_m''s download, trash and restore)');                  -- 61
SELECT ok(
  (SELECT count(*) FROM public.edit_history
    WHERE entity_type = 'files' AND entity_id = 'f9500000-0000-0000-0000-000000000001') >= 3,
  '…and its edit history (created, two note edits)');                                                    -- 62
SELECT lives_ok(
  $$SELECT public.log_file_downloaded('f9500000-0000-0000-0000-000000000001')$$,
  '…and logs a read of it');                                                                             -- 63
SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id = 'f9500000-0000-0000-0000-000000000003'),
  0, '🚨 and still no invoice row');                                                                      -- 64
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE name ILIKE 'projects/aaaa1111-0000-0000-0000-000000000001/invoices/%'
       OR name = 'projects/aaaa1111-0000-0000-0000-000000000001/FINANCE/RATES.json'),
  0, '🚨 no invoice object, thumbnail or FINANCE mirror');                                                -- 65
SELECT is(
  (SELECT count(*)::int FROM public.edit_history
    WHERE entity_type = 'files' AND entity_id = 'f9500000-0000-0000-0000-000000000003'),
  0, '🚨 and none of the invoice''s history');                                                            -- 66
SELECT throws_ok(
  $$SELECT public.soft_delete_row('files', 'f9500000-0000-0000-0000-000000000003')$$,
  'not allowed to soft-delete or restore this row',
  '🚨 and cannot trash the invoice');                                                                     -- 67

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;


-- ══ E. A project MEMBER (user_c) and a REVIEWER (user_r): still nothing ══════

SELECT pg_temp.act_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user');

SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id = 'f9500000-0000-0000-0000-000000000002'),
  1, 'PRESENCE CONTROL: the member reads the plain file');                                               -- 68
SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id IN ('f9500000-0000-0000-0000-000000000001', 'f9500000-0000-0000-0000-000000000008')),
  0, '🚨 the member reads neither Legal row — the manager''s nor the one the workspace manager added');  -- 69
SELECT is(
  (SELECT count(*)::int FROM storage.objects WHERE name ILIKE 'projects/aaaa1111-0000-0000-0000-000000000001/legal/%'),
  0, '🚨 nor any Legal body or thumbnail');                                                               -- 70
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id IN ('f9500000-0000-0000-0000-000000000001', 'f9500000-0000-0000-0000-000000000008')),
  0, '🚨 nor any Legal event — the workspace manager''s download of one included');                       -- 71
SELECT throws_ok(
  $$SELECT public.log_file_downloaded('f9500000-0000-0000-0000-000000000008')$$,
  'log_file_downloaded: file not found or not readable',
  'the member cannot log a read of the workspace manager''s Legal file');                                -- 72
SELECT throws_ok(
  $$SELECT public.soft_delete_row('files', 'f9500000-0000-0000-0000-000000000008')$$,
  'not allowed to soft-delete or restore this row',
  'nor trash it by id');                                                                                 -- 73
SELECT throws_ok(
  $$SELECT public.reserve_upload_bytes(
    'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-small-c.pdf', 4000)$$,
  '42501', 'reserve_upload_bytes: you cannot write to this project',
  'nor reserve a LEGAL key — the Legal arm admits the Legal audience, not a member');                    -- 74
SELECT throws_ok(
  $$INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path, size_bytes, is_financial, tags)
    VALUES ('f9500000-0000-0000-0000-0000000000c2', '11111111-1111-1111-1111-111111111111',
            'aaaa1111-0000-0000-0000-000000000001', 'm.pdf', 'supabase',
            'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-m.pdf',
            10, false, ARRAY['legal'])$$,
  '42501', NULL, 'nor add a Legal row');                                                                  -- 75
SELECT isnt(
  public.reserve_upload_bytes(
    'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/9-big-plain.mov', 27262976),
  NULL::bigint, 'CONTROL: the member still reserves a large ORDINARY key');                              -- 76

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;
SELECT pg_temp.act_as('95950000-0000-0000-0000-0000000000a1', 'user');

SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id = 'f9500000-0000-0000-0000-000000000002'),
  1, 'PRESENCE CONTROL: the reviewer reads the plain file');                                             -- 77
SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id IN ('f9500000-0000-0000-0000-000000000001', 'f9500000-0000-0000-0000-000000000008')),
  0, '🚨 the reviewer reads neither Legal row');                                                          -- 78
SELECT is(
  (SELECT count(*)::int FROM storage.objects WHERE name ILIKE 'projects/aaaa1111-0000-0000-0000-000000000001/legal/%'),
  0, 'nor any Legal body or thumbnail');                                                                 -- 79
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id IN ('f9500000-0000-0000-0000-000000000001', 'f9500000-0000-0000-0000-000000000008')),
  0, 'nor any Legal event');                                                                             -- 80
SELECT throws_ok(
  $$SELECT public.log_file_downloaded('f9500000-0000-0000-0000-000000000001')$$,
  'log_file_downloaded: file not found or not readable',
  'the reviewer cannot log a read of the Legal file');                                                   -- 81

SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;


-- ══ F. Another workspace's manager, a forged claim, and anon ═════════════════

-- user_b is workspace B's admin acting as B's workspace MANAGER: the hop
-- (p.workspace_id = current_workspace_id()) keeps them out of A's Legal files.
SELECT pg_temp.act_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'manager', '22222222-2222-2222-2222-222222222222');
SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id IN ('f9500000-0000-0000-0000-000000000001', 'f9500000-0000-0000-0000-000000000002')),
  0, 'another workspace''s manager reads neither A''s Legal file nor its plain file');                    -- 82
SELECT is(
  (SELECT count(*)::int FROM storage.objects WHERE name ILIKE 'projects/aaaa1111-0000-0000-0000-000000000001/%'),
  0, 'nor any of A''s objects');                                                                         -- 83
SELECT ok(
  public.can_access_project_legal('aaaa1111-0000-0000-0000-000000000001') IS FALSE,
  'the predicate itself answers false, not NULL, for a manager of another workspace (0037''s hop, copied)'); -- 84
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

-- A forged claim: user_b naming workspace A with app_role manager. The hop
-- reads the LIVE membership row (has_active_membership), not the claim.
SELECT pg_temp.act_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'manager', '11111111-1111-1111-1111-111111111111');
SELECT ok(
  public.can_access_project_legal('aaaa1111-0000-0000-0000-000000000001') IS FALSE
  AND (SELECT count(*) FROM public.files WHERE id = 'f9500000-0000-0000-0000-000000000001') = 0,
  'a claim naming workspace A with app_role manager, from someone with no membership there, opens nothing'); -- 85
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT public.can_access_project_legal('aaaa1111-0000-0000-0000-000000000001')$$,
  '42501', NULL, 'anon cannot even call the Legal predicate');                                            -- 86
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);


-- ══ G. The money-cleared readers: unchanged ══════════════════════════════════

SELECT pg_temp.act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin');
SELECT is(
  (SELECT count(*)::int FROM public.files
    WHERE id IN ('f9500000-0000-0000-0000-000000000001', 'f9500000-0000-0000-0000-000000000003', 'f9500000-0000-0000-0000-000000000008')),
  3, 'the workspace admin reads both Legal rows and the invoice');                                       -- 87
SELECT is(
  (SELECT count(*)::int FROM public.edit_history
    WHERE entity_type = 'files' AND entity_id = 'f9500000-0000-0000-0000-000000000003'),
  2, 'and the invoice''s history (created, note edited)');                                               -- 88
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

SELECT pg_temp.act_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user');
SELECT is(
  (SELECT count(*)::int FROM public.files
    WHERE id IN ('f9500000-0000-0000-0000-000000000001', 'f9500000-0000-0000-0000-000000000003', 'f9500000-0000-0000-0000-000000000008')),
  3, 'the project manager reads both Legal rows (the workspace manager''s included) and the invoice');    -- 89
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'f9500000-0000-0000-0000-000000000001' AND event = 'downloaded'),
  2, 'and sees the two downloads the workspace managers logged against the Legal file');                 -- 90
SELECT isnt(
  public.reserve_upload_bytes(
    'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/aaaa1111-0000-0000-0000-000000000001/9-big-pm.pdf', 27262976),
  NULL::bigint, 'CONTROL: the project manager reserves a large INVOICES key (the sweep probes lean on it)'); -- 91
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;


-- ══ H. Private projects (0072's arm inside the predicate) ════════════════════

-- P2 is user_d's. user_m is a workspace manager but not its creator.
SELECT pg_temp.act_as('95950000-0000-0000-0000-0000000000a2', 'manager');
SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id = 'f9500000-0000-0000-0000-000000000004'),
  0, '🚨 a workspace manager who did not create a PRIVATE project reads none of its Legal rows');         -- 92
SELECT is(
  (SELECT count(*)::int FROM storage.objects WHERE name ILIKE 'projects/95950000-0000-0000-0000-000000000002/%'),
  0, 'nor its Legal body (the predicate carries 0072''s arm; the money storage policies have no hop of their own)'); -- 93
SELECT is(
  (SELECT count(*)::int FROM public.file_events WHERE project_id = '95950000-0000-0000-0000-000000000002'),
  0, 'nor its events');                                                                                  -- 94
SELECT ok(
  public.can_access_project_legal('95950000-0000-0000-0000-000000000002') IS FALSE,
  'the predicate says false for them on P2 (passes_project_privacy)');                                   -- 95
SELECT throws_ok(
  $$SELECT public.log_file_downloaded('f9500000-0000-0000-0000-000000000004')$$,
  'log_file_downloaded: file not found or not readable',
  'they cannot log a read of P2''s Legal file');                                                         -- 96
SELECT throws_ok(
  $$SELECT public.soft_delete_row('files', 'f9500000-0000-0000-0000-000000000004')$$,
  'not allowed to soft-delete or restore this row',
  'nor trash it by id');                                                                                 -- 97
SELECT throws_ok(
  $$SELECT public.reserve_upload_bytes(
    'projects/95950000-0000-0000-0000-000000000002/LEGAL/95950000-0000-0000-0000-000000000002/9-guess.pdf', 4000)$$,
  '42501', 'reserve_upload_bytes: you cannot write to this project',
  'nor reserve a LEGAL key under it — the same refusal, so P2''s existence is not confirmed');           -- 98
SELECT throws_ok(
  $$INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path, size_bytes, is_financial, tags)
    VALUES ('f9500000-0000-0000-0000-0000000000c3', '11111111-1111-1111-1111-111111111111',
            '95950000-0000-0000-0000-000000000002', 'x.pdf', 'supabase',
            'projects/95950000-0000-0000-0000-000000000002/LEGAL/95950000-0000-0000-0000-000000000002/9-x.pdf',
            10, false, ARRAY['legal'])$$,
  '42501', NULL, 'nor add a Legal row to it (files_insert''s parent hop, 0083)');                         -- 99
-- P3 is user_n''s; user_m is not its creator either.
SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id = 'f9500000-0000-0000-0000-000000000006'),
  0, '…and the same for P3, another manager''s private project');                                        -- 100
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

-- user_n created P3: a workspace manager who is the creator sees its Legal
-- file (both arms of the predicate) and still not its invoice (no seat).
SELECT pg_temp.act_as('95950000-0000-0000-0000-0000000000a3', 'manager');
SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id = 'f9500000-0000-0000-0000-000000000006'),
  1, 'the workspace manager who CREATED private P3 reads its Legal row');                                -- 101
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE name = 'projects/95950000-0000-0000-0000-000000000003/LEGAL/95950000-0000-0000-0000-000000000003/1-option.pdf'),
  1, '…and its body');                                                                                   -- 102
SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id = 'f9500000-0000-0000-0000-000000000007'),
  0, '🚨 and not P3''s invoice — creating a project is not the money gate');                              -- 103
SELECT ok(
  public.can_access_project_legal('95950000-0000-0000-0000-000000000003') IS TRUE
  AND public.can_access_project_money('95950000-0000-0000-0000-000000000003') IS NOT TRUE,
  'the two predicates say so directly: Legal yes, money no');                                            -- 104
SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id = 'f9500000-0000-0000-0000-000000000004'),
  0, 'and P2 (user_d''s) is closed to them');                                                            -- 105
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

-- The admin and the creator-manager, as controls.
SELECT pg_temp.act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin');
SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id IN ('f9500000-0000-0000-0000-000000000004', 'f9500000-0000-0000-0000-000000000006')),
  2, 'CONTROL: the workspace admin reads both private projects'' Legal rows');                           -- 106
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;
SELECT pg_temp.act_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user');
SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id IN ('f9500000-0000-0000-0000-000000000004', 'f9500000-0000-0000-0000-000000000005')),
  2, 'CONTROL: P2''s creator and manager reads its Legal row and its invoice');                          -- 107
SELECT is(
  (SELECT count(*)::int FROM public.files WHERE id = 'f9500000-0000-0000-0000-000000000006'),
  0, 'and nothing of P3 (not theirs)');                                                                  -- 108
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;


-- ══ I. The deletion record follows the file's gate (Legal 1) ═════════════════
-- Purged as the nightly sweep does (postgres): the Legal file, the invoice and
-- the plain file. The plain file''s certificate is every reader''s — the
-- presence control for each absence below.

DELETE FROM public.files WHERE id IN ('f9500000-0000-0000-0000-000000000001',
                                      'f9500000-0000-0000-0000-000000000002',
                                      'f9500000-0000-0000-0000-000000000003');

SELECT ok(
  (SELECT bool_and(is_financial) FROM public.file_events
    WHERE event = 'purged' AND file_id IN ('f9500000-0000-0000-0000-000000000001', 'f9500000-0000-0000-0000-000000000003'))
  AND (SELECT NOT is_financial FROM public.file_events
        WHERE event = 'purged' AND file_id = 'f9500000-0000-0000-0000-000000000002'),
  'the three certificates exist; the Legal file''s and the invoice''s are flagged, the plain file''s is not'); -- 109

SELECT pg_temp.act_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user');
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'f9500000-0000-0000-0000-000000000002' AND event = 'purged'),
  1, 'PRESENCE CONTROL: the member reads the plain file''s deletion certificate');                       -- 110
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'f9500000-0000-0000-0000-000000000003' AND event = 'purged'),
  0, '🚨 the member no longer reads the INVOICE''s deletion certificate (Legal 1 narrows ruling 22)');     -- 111
SELECT is(
  (SELECT count(*)::int FROM public.file_events WHERE file_id = 'f9500000-0000-0000-0000-000000000001'),
  0, '🚨 nor anything of the Legal file, its certificate included');                                      -- 112
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

SELECT pg_temp.act_as('95950000-0000-0000-0000-0000000000a1', 'user');
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'f9500000-0000-0000-0000-000000000002' AND event = 'purged'),
  1, 'PRESENCE CONTROL: the reviewer reads the plain file''s certificate');                              -- 113
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE event = 'purged'
      AND file_id IN ('f9500000-0000-0000-0000-000000000001', 'f9500000-0000-0000-0000-000000000003')),
  0, '🚨 the reviewer reads neither the invoice''s nor the Legal file''s certificate');                   -- 114
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

SELECT pg_temp.act_as('95950000-0000-0000-0000-0000000000a2', 'manager');
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'f9500000-0000-0000-0000-000000000001' AND event = 'purged'),
  1, 'the workspace manager (member seat) reads the Legal file''s certificate');                         -- 115
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE file_id = 'f9500000-0000-0000-0000-000000000003' AND event = 'purged'),
  0, '🚨 and not the invoice''s');                                                                        -- 116
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

SELECT pg_temp.act_as('95950000-0000-0000-0000-0000000000a3', 'manager');
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE event = 'purged'
      AND file_id IN ('f9500000-0000-0000-0000-000000000001', 'f9500000-0000-0000-0000-000000000003')),
  1, 'the workspace manager with no seat reads one certificate of the two: the Legal file''s');           -- 117
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

SELECT pg_temp.act_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user');
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE event = 'purged'
      AND file_id IN ('f9500000-0000-0000-0000-000000000001', 'f9500000-0000-0000-0000-000000000003')),
  2, 'the project manager reads both');                                                                  -- 118
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

SELECT pg_temp.act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin');
SELECT is(
  (SELECT count(*)::int FROM public.file_events
    WHERE event = 'purged'
      AND file_id IN ('f9500000-0000-0000-0000-000000000001', 'f9500000-0000-0000-0000-000000000002', 'f9500000-0000-0000-0000-000000000003')),
  3, 'the workspace admin reads all three');                                                             -- 119
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;


-- ══ J. The hourly sweep's certificate (0088 §9b, re-pointed by the policy) ═══
-- The reservations used here were made above: user_m''s large LEGAL key
-- (probe 44), user_d''s large INVOICES key (91) and user_c''s large plain key
-- (76). The sweep runs as cron does (postgres) over the three, made to look
-- expired.

UPDATE public.upload_reservations
   SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
   AND storage_path IN (
     'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-big-wm.pdf',
     'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/aaaa1111-0000-0000-0000-000000000001/9-big-pm.pdf',
     'projects/aaaa1111-0000-0000-0000-000000000001/project/aaaa1111-0000-0000-0000-000000000001/9-big-plain.mov');
SELECT * FROM public.sweep_abandoned_uploads('11111111-1111-1111-1111-111111111111');

SELECT ok(
  (SELECT bool_and(is_financial) FROM public.file_events
    WHERE event = 'upload_abandoned'
      AND (new_path LIKE '%9-big-wm.pdf' OR new_path LIKE '%9-big-pm.pdf'))
  AND (SELECT count(*) FROM public.file_events WHERE event = 'upload_abandoned'
        AND (new_path LIKE '%9-big-wm.pdf' OR new_path LIKE '%9-big-pm.pdf' OR new_path LIKE '%9-big-plain.mov')) = 3,
  'the sweep wrote three certificates; the Legal one and the invoice one are flagged (trg_file_events_money)'); -- 120

SELECT pg_temp.act_as('95950000-0000-0000-0000-0000000000a2', 'manager');
SELECT is(
  (SELECT count(*)::int FROM public.file_events WHERE event = 'upload_abandoned' AND new_path LIKE '%9-big-wm.pdf'),
  1, 'the workspace manager reads the certificate for their own abandoned Legal upload');                -- 121
SELECT is(
  (SELECT count(*)::int FROM public.file_events WHERE event = 'upload_abandoned' AND new_path LIKE '%9-big-pm.pdf'),
  0, '🚨 and not the one for the abandoned INVOICE upload');                                              -- 122
SELECT is(
  (SELECT count(*)::int FROM public.file_events WHERE event = 'upload_abandoned' AND new_path LIKE '%9-big-plain.mov'),
  1, 'PRESENCE CONTROL: and the plain one');                                                             -- 123
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

SELECT pg_temp.act_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user');
SELECT is(
  (SELECT count(*)::int FROM public.file_events WHERE event = 'upload_abandoned' AND new_path LIKE '%9-big-wm.pdf'),
  0, '🚨 the member does not read the abandoned Legal upload''s certificate');                            -- 124
SELECT is(
  (SELECT count(*)::int FROM public.file_events WHERE event = 'upload_abandoned' AND new_path LIKE '%9-big-plain.mov'),
  1, 'PRESENCE CONTROL: the member reads their own abandoned plain upload''s');                           -- 125
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

SELECT pg_temp.act_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user');
SELECT is(
  (SELECT count(*)::int FROM public.file_events WHERE event = 'upload_abandoned'
    AND (new_path LIKE '%9-big-wm.pdf' OR new_path LIKE '%9-big-pm.pdf')),
  2, 'CONTROL: the project manager reads both the Legal and the invoice certificates');                  -- 126
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;


-- ══ K. The quota meter (0088 §5c, unchanged): no oracle for the new audience ═
-- user_m''s large Legal reservation was swept above; user_d''s INVOICES one
-- too. Two fresh ones, so the meter has something open to weigh.

SELECT pg_temp.act_as('95950000-0000-0000-0000-0000000000a2', 'manager');
SELECT public.reserve_upload_bytes(
  'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-big-wm2.pdf', 27262976);
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

SELECT pg_temp.act_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user');
RESET ROLE;
SELECT is(
  public.workspace_upload_reserved_bytes('11111111-1111-1111-1111-111111111111',
    'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-big-wm2.pdf'),
  public.workspace_upload_reserved_bytes('11111111-1111-1111-1111-111111111111',
    'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-a-wrong-guess.pdf'),
  '🚨 for the member, the workspace manager''s Legal key in flight and a wrong guess weigh the same — no oracle'); -- 127
SELECT pg_temp.act_as('95950000-0000-0000-0000-0000000000a2', 'manager');
RESET ROLE;
SELECT is(
  public.workspace_upload_reserved_bytes('11111111-1111-1111-1111-111111111111',
    'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-a-wrong-guess.pdf')
  - public.workspace_upload_reserved_bytes('11111111-1111-1111-1111-111111111111',
    'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-big-wm2.pdf'),
  27262976::bigint,
  'CONTROL: the workspace manager''s OWN reservation is set aside when their object is weighed');        -- 128
SELECT set_config('request.jwt.claims', '', true);


-- ══ L. The realtime topic: a Legal row is still never broadcast ══════════════
-- Suite 90''s instrument: the plain file''s broadcast (user_d''s insert in §B)
-- is the control; the Legal rows (user_d''s and user_m''s) and the invoice
-- must not reach rabbit:project:{id}. CI starts without realtime, so there
-- this is a catalog check and nothing more.

CREATE FUNCTION pg_temp.legal95_broadcast_status()
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
    PERFORM realtime.send('{"probe":true}'::jsonb, 'PGTAP-PROBE', 'rabbit:pgtap:legal95-partition-probe', true);
  EXCEPTION WHEN OTHERS THEN
    RETURN 'no-partition';
  END;
  EXECUTE 'SELECT count(*) FROM realtime.messages WHERE topic = ''rabbit:pgtap:legal95-partition-probe''' INTO n;
  IF n = 0 THEN
    RETURN 'no-partition';
  END IF;
  EXECUTE format(
    'SELECT count(*) FROM realtime.messages
      WHERE topic = %L AND extension = ''broadcast''
        AND payload::text LIKE ''%%f9500000-0000-0000-0000-000000000002%%''', topic) INTO n;
  IF n = 0 THEN
    RETURN 'instrument-broken';
  END IF;
  EXECUTE format(
    'SELECT count(*) FROM realtime.messages
      WHERE topic = %L
        AND (payload::text LIKE ''%%f9500000-0000-0000-0000-000000000001%%''
          OR payload::text LIKE ''%%f9500000-0000-0000-0000-000000000003%%''
          OR payload::text LIKE ''%%f9500000-0000-0000-0000-000000000008%%''
          OR payload::text LIKE ''%%1-contract.pdf%%''
          OR payload::text LIKE ''%%8-nda.pdf%%'')', topic) INTO n;
  RETURN CASE WHEN n = 0 THEN 'withheld' ELSE 'leaked' END;
END;
$$;

SELECT ok(
  pg_temp.legal95_broadcast_status() IN ('withheld', 'no-schema', 'no-partition'),
  'broadcast status=' || pg_temp.legal95_broadcast_status()
  || ' — neither Legal row (the workspace manager''s included) nor the invoice reaches rabbit:project:{id}, while the plain file does'); -- 129
SELECT ok(
  strpos(regexp_replace(regexp_replace(
           pg_get_functiondef('public.fn_realtime_broadcast()'::regprocedure),
           '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g'),
         'can_access_project_legal') = 0,
  'fn_realtime_broadcast has grown no Legal arm — a broadcast has no per-recipient filter');             -- 130


-- ══ M. What was written, read as postgres ════════════════════════════════════

SELECT ok(
  (SELECT count(*) FROM public.edit_history
    WHERE entity_type = 'files' AND entity_id = 'f9500000-0000-0000-0000-000000000001') >= 4
  AND NOT EXISTS (SELECT 1 FROM public.edit_history
    WHERE entity_type = 'files' AND entity_id = 'f9500000-0000-0000-0000-000000000001'
      AND (NOT is_financial OR NOT is_legal OR project_id IS DISTINCT FROM 'aaaa1111-0000-0000-0000-000000000001')),
  'every history row of the Legal file — created, edited twice, trashed, restored, purged — is is_financial AND is_legal, with its project'); -- 131
SELECT ok(
  (SELECT count(*) FROM public.edit_history
    WHERE entity_type = 'files' AND entity_id = 'f9500000-0000-0000-0000-000000000003') >= 2
  AND NOT EXISTS (SELECT 1 FROM public.edit_history
    WHERE entity_type = 'files' AND entity_id = 'f9500000-0000-0000-0000-000000000003'
      AND (NOT is_financial OR is_legal)),
  'every history row of the invoice is is_financial and NOT is_legal');                                  -- 132
SELECT ok(
  (SELECT count(*) FROM public.edit_history
    WHERE entity_type = 'files' AND entity_id = 'f9500000-0000-0000-0000-000000000002') > 0
  AND NOT EXISTS (SELECT 1 FROM public.edit_history
    WHERE entity_type = 'files' AND entity_id = 'f9500000-0000-0000-0000-000000000002' AND (is_financial OR is_legal)),
  'CONTROL: the plain file''s history carries neither flag');                                            -- 133
SELECT ok(
  (SELECT bool_and(is_financial) FROM public.file_events
    WHERE file_id IN ('f9500000-0000-0000-0000-000000000001', 'f9500000-0000-0000-0000-000000000008')),
  'every event of both Legal files — the workspace managers'' downloads included — is flagged (0088''s one definition)'); -- 134
SELECT ok(
  (SELECT bool_and(is_legal AND is_financial) FROM public.edit_history
    WHERE entity_type = 'files' AND entity_id = 'f9500000-0000-0000-0000-000000000008'),
  'the history of the Legal file the workspace manager added is is_legal too');                          -- 135
SELECT ok(
  (SELECT bool_and(is_legal AND is_financial) FROM public.edit_history
    WHERE entity_type = 'files' AND entity_id IN ('f9500000-0000-0000-0000-000000000004', 'f9500000-0000-0000-0000-000000000006'))
  AND (SELECT bool_and(is_financial AND NOT is_legal) FROM public.edit_history
    WHERE entity_type = 'files' AND entity_id IN ('f9500000-0000-0000-0000-000000000005', 'f9500000-0000-0000-0000-000000000007')),
  'rows written as postgres (no claims) are classified the same: the private projects'' Legal files is_legal, their invoices not'); -- 136


-- ══ N. The CHECK — as the project manager, so only the CHECK can refuse ═════

SELECT pg_temp.act_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user');
SELECT throws_ok(
  $$INSERT INTO public.files (id, workspace_id, project_id, name, storage_provider, storage_path, size_bytes, is_financial, tags)
    VALUES ('f9500000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111',
            'aaaa1111-0000-0000-0000-000000000001', 'both.pdf', 'supabase',
            'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/9-both.pdf',
            10, true, ARRAY['legal'])$$,
  '23514', 'new row for relation "files" violates check constraint "files_legal_not_financial_chk"',
  'a Legal file cannot be added as an invoice too (files_legal_not_financial_chk)');                     -- 137
SELECT throws_ok(
  $$UPDATE public.files SET is_financial = true WHERE id = 'f9500000-0000-0000-0000-000000000008'$$,
  '23514', 'new row for relation "files" violates check constraint "files_legal_not_financial_chk"',
  'nor can the project manager flag an existing Legal file (RLS admits them; the CHECK refuses)');       -- 138
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;


-- ══ O. The two predicates, asked directly as each person ═════════════════════
-- The client asks can_access_project_legal over RPC before a Legal upload
-- moves a byte (supabaseAdapter), as it asked the money gate before 0092.

SELECT pg_temp.act_as('95950000-0000-0000-0000-0000000000a2', 'manager');
SELECT ok(
  public.can_access_project_legal('aaaa1111-0000-0000-0000-000000000001') IS TRUE
  AND public.can_access_project_money('aaaa1111-0000-0000-0000-000000000001') IS NOT TRUE,
  'user_m (workspace manager, member seat): Legal true, money not');                                     -- 139
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;
SELECT pg_temp.act_as('95950000-0000-0000-0000-0000000000a3', 'manager');
SELECT ok(
  public.can_access_project_legal('aaaa1111-0000-0000-0000-000000000001') IS TRUE
  AND public.can_access_project_money('aaaa1111-0000-0000-0000-000000000001') IS NOT TRUE,
  'user_n (workspace manager, no seat): Legal true, money not — and the Legal answer is never NULL');     -- 140
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;
SELECT pg_temp.act_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user');
SELECT ok(
  public.can_access_project_legal('aaaa1111-0000-0000-0000-000000000001') IS FALSE
  AND public.can_access_project_money('aaaa1111-0000-0000-0000-000000000001') IS NOT TRUE,
  'user_c (member): neither');                                                                           -- 141
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;
SELECT pg_temp.act_as('95950000-0000-0000-0000-0000000000a1', 'user');
SELECT ok(
  public.can_access_project_legal('aaaa1111-0000-0000-0000-000000000001') IS FALSE,
  'user_r (reviewer): not Legal');                                                                       -- 142
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;
SELECT pg_temp.act_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user');
SELECT ok(
  public.can_access_project_legal('aaaa1111-0000-0000-0000-000000000001') IS TRUE
  AND public.can_access_project_money('aaaa1111-0000-0000-0000-000000000001') IS TRUE,
  'user_d (project manager): both');                                                                     -- 143
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin');
SELECT ok(
  public.can_access_project_legal('aaaa1111-0000-0000-0000-000000000001') IS TRUE
  AND public.can_access_project_money('aaaa1111-0000-0000-0000-000000000001') IS TRUE,
  'user_a (workspace admin): both');                                                                     -- 144
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;
-- A claim-less member: a JWT with no app_role at all (0074's probe 29). The
-- money gate answers NULL there — the 0047 trap every definer COALESCEs
-- against — and the Legal predicate must answer false, never NULL.
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111'))::text, true);
SELECT set_config('role', 'authenticated', true);
SELECT ok(
  public.can_access_project_money('aaaa1111-0000-0000-0000-000000000001') IS NULL
  AND public.can_access_project_legal('aaaa1111-0000-0000-0000-000000000001') IS FALSE
  AND public.can_access_project_legal(NULL) IS FALSE
  AND public.can_access_project_legal('00000000-0000-0000-0000-000000000000') IS FALSE,
  'a claim-less member: the money gate answers NULL (the 0047 IF-NOT trap) and the Legal predicate FALSE, never NULL; a NULL or unknown project is false too'); -- 145
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

-- The money tables themselves: a workspace manager with a member seat reads
-- none of project A's budget — the Legal gate reaches no money table.
SELECT pg_temp.act_as('95950000-0000-0000-0000-0000000000a2', 'manager');
SELECT is(
  (SELECT count(*)::int FROM public.budget_versions WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001')
  + (SELECT count(*)::int FROM public.budget_lines WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001')
  + (SELECT count(*)::int FROM public.project_rate_overrides WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  0, '🚨 the workspace manager reads no budget version, budget line or rate override of the project (D8: money stays the project manager''s)'); -- 146
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
               AND tablename IN ('budget_lines', 'budget_actuals', 'budget_versions', 'expenses', 'project_rate_overrides')
               AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%can_access_project_legal%'),
  'no money table policy asks the Legal gate');                                                          -- 147
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

-- The classifiers tell the two kinds apart on the fixtures themselves.
SELECT ok(
  public.file_row_is_legal(false, 'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/8-nda.pdf')
  AND NOT public.file_row_is_legal(true, 'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/aaaa1111-0000-0000-0000-000000000001/1-invoice.pdf')
  AND public.file_row_is_money(true, 'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/aaaa1111-0000-0000-0000-000000000001/1-invoice.pdf')
  AND public.file_row_is_money(false, 'projects/aaaa1111-0000-0000-0000-000000000001/LEGAL/aaaa1111-0000-0000-0000-000000000001/8-nda.pdf'),
  'a Legal row is Legal and money; an invoice is money and not Legal');                                  -- 148
SELECT ok(
  public.rabbit_money_segment('LEGAL') AND public.rabbit_legal_segment('LEGAL')
  AND public.rabbit_money_segment('INVOICES') AND NOT public.rabbit_legal_segment('INVOICES')
  AND public.rabbit_money_segment('FINANCE') AND NOT public.rabbit_legal_segment('FINANCE'),
  'LEGAL is still in the one locked list; INVOICES and FINANCE are locked and not Legal');                -- 149
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.files WHERE is_financial AND public.rabbit_legal_segment(split_part(storage_path, '/', 3)))
  AND NOT EXISTS (SELECT 1 FROM public.edit_history WHERE is_legal AND NOT is_financial),
  'no row is both an invoice and Legal; no history row is Legal without being money');                   -- 150
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'file_events'),
  1, 'file_events keeps exactly its one policy (SELECT): clients write nothing');                        -- 151

SELECT * FROM finish();
ROLLBACK;
