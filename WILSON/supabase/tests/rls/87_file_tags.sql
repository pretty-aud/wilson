-- =============================================================================
-- 87_file_tags.sql — post-overhaul S4a: files.tags (migration 0085), and the
-- things adding it must not have changed.
--
-- What this pins, in order of how badly it would hurt to get wrong:
--
--   * THE VOCABULARY IS THE NINE, EXACTLY (probes 15-21): a member writes all
--     nine (15-16, the presence control), and the database refuses 'notes'
--     (17 — the tenth tag Audrey removed, E3), a different case (18), a NULL
--     element (19), NULL itself (20) and a tenth element (21). Refusals are
--     matched by SQLSTATE, not message text (suite 68's reason: Postgres names
--     the alphabetically first violated constraint).
--
--   * TAGS FOLLOW THE ROW'S POLICIES, WHICH DID NOT MOVE (probes 11-12,
--     22-23): four policies with their four names, RLS enabled and forced; a
--     member of ANOTHER workspace writes nothing (22 raises no error because
--     RLS filters the row, 23 proves the tags are unchanged — 22 alone could
--     not fail).
--
--   * E12, START EMPTY (probe 14): a row written without tags reads '{}'.
--
--   * E13, EDIT HISTORY (probes 13, 24): trg_files_edit_history is still on
--     files, and a tag edit leaves an 'update' row whose diff names `tags`.
--
--   * E2, CORE IN HER WORDS (probes 9-10): the comment carries her definition
--     and the column kept NOT NULL DEFAULT false (0075's tripwire).
--
--   * THE NINE AND NOTHING ELSE (probes 29-30, review round 1, R1-TST-17):
--     a word outside the vocabulary that is not 'notes' is refused, and the
--     CHECK's definition holds exactly nine quoted words.
--
--   * ONE DIMENSION (probes 25-28, review round 1, R1-SEC-04): the flat
--     CHECK by definition; a 2-D array — which `<@` and cardinality() both
--     flatten, so the other two checks let it in — is refused; the same
--     four tags flat are accepted (the presence control), and so is the
--     empty array, which has no dimensions at all.
--
-- Every absence check has a presence control one probe away. 🚨 RUNS INSIDE
-- ONE TRANSACTION THAT ROLLS BACK. Nothing here survives.
-- =============================================================================

BEGIN;

SELECT plan(30);

SELECT * FROM tests.rls_setup();

-- user_c: a plain ws_a member on project A (suite 79's member).
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role)
VALUES
  ('aaaa1111-0000-0000-0000-000000000001',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT (project_id, user_id) DO NOTHING;

-- One ordinary (not financial) project A file, written WITHOUT tags.
INSERT INTO public.files (id, project_id, name, mime_type, size_bytes,
                          storage_provider, storage_path, is_financial)
VALUES ('aaaa1111-0000-0000-0000-0000000087f1',
        'aaaa1111-0000-0000-0000-000000000001', 'treatment.pdf', 'application/pdf',
        2048, 'supabase',
        'projects/aaaa1111-0000-0000-0000-000000000001/project/87-treatment.pdf',
        false);

-- ══ 1. The shape ════════════════════════════════════════════════════════════

SELECT has_column('public'::name, 'files'::name, 'tags'::name,
  'files.tags exists');                                                      -- 1

SELECT col_type_is('public'::name, 'files'::name, 'tags'::name, 'text[]',
  'files.tags is text[]');                                                   -- 2

SELECT col_not_null('public'::name, 'files'::name, 'tags'::name,
  'files.tags is NOT NULL');                                                 -- 3

SELECT is(
  (SELECT column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'files' AND column_name = 'tags'),
  '''{}''::text[]',
  'files.tags defaults to the empty array');                                 -- 4

SELECT ok(EXISTS (
  SELECT 1 FROM pg_constraint
   WHERE conrelid = 'public.files'::regclass AND contype = 'c'
     AND conname = 'files_tags_known_chk'
     AND pg_get_constraintdef(oid) LIKE '%tags <@%'),
  'files_tags_known_chk is a CHECK on containment in the vocabulary');       -- 5

SELECT ok(EXISTS (
  SELECT 1 FROM pg_constraint
   WHERE conrelid = 'public.files'::regclass AND contype = 'c'
     AND conname = 'files_tags_len_chk'
     -- The closing parenthesis is part of the pattern: without it '<= 99'
     -- matched too (breaker B1, S4a).
     AND pg_get_constraintdef(oid) LIKE '%cardinality(tags) <= 9)%'),
  'files_tags_len_chk bounds a row at nine tags');                           -- 6

SELECT ok(EXISTS (
  SELECT 1 FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'files'
     AND indexname = 'files_tags_gin' AND indexdef ILIKE '%USING gin (tags)%'),
  'files_tags_gin is a GIN index on tags');                                  -- 7

SELECT ok(NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY['Production','Creative','Legal','Finance','Reference',
                             'Assets','Code','Shots','Documentation']) AS t
   WHERE COALESCE(col_description('public.files'::regclass,
           (SELECT attnum FROM pg_attribute
             WHERE attrelid = 'public.files'::regclass AND attname = 'tags')), '')
         NOT LIKE '%' || t || '%'),
  'the tags column comment names all nine');                                 -- 8

SELECT ok(
  col_description('public.files'::regclass,
    (SELECT attnum FROM pg_attribute
      WHERE attrelid = 'public.files'::regclass AND attname = 'is_core_definer'))
  LIKE '%files that give context about the project%the script, the treatment, storyboards, mood boards%',
  'is_core_definer''s comment is Audrey''s definition (E2)');                -- 9

SELECT is(
  (SELECT is_nullable || '/' || COALESCE(column_default, 'no-default')
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'files'
      AND column_name = 'is_core_definer'),
  'NO/false',
  'is_core_definer kept NOT NULL DEFAULT false (only its comment changed)'); -- 10

SELECT is(
  (SELECT array_agg(policyname::TEXT ORDER BY policyname)
     FROM pg_policies WHERE schemaname = 'public' AND tablename = 'files'),
  ARRAY['files_delete','files_insert','files_select','files_update']::TEXT[],
  'the four files policies, by name, are the ones 0085 inherited');         -- 11

SELECT ok(EXISTS (
  SELECT 1 FROM pg_class
   WHERE oid = 'public.files'::regclass AND relrowsecurity AND relforcerowsecurity),
  'RLS is still enabled and forced on files');                              -- 12

SELECT has_trigger('public'::name, 'files'::name, 'trg_files_edit_history'::name,
  'trg_files_edit_history still captures files (E13)');                     -- 13

-- ══ 2. Behaviour ════════════════════════════════════════════════════════════

SELECT is(
  (SELECT tags FROM public.files WHERE id = 'aaaa1111-0000-0000-0000-0000000087f1'),
  '{}'::TEXT[],
  'a row written without tags starts empty (E12)');                         -- 14

-- user_c, a plain member of project A, in the JWT's own claim shape.
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','cccccccc-cccc-cccc-cccc-cccccccccccc','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','user')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT lives_ok($$
  UPDATE public.files
     SET tags = ARRAY['production','creative','legal','finance','reference',
                      'assets','code','shots','documentation']
   WHERE id = 'aaaa1111-0000-0000-0000-0000000087f1'
$$, 'a project member tags a file with all nine');                          -- 15

SELECT is(
  (SELECT tags FROM public.files WHERE id = 'aaaa1111-0000-0000-0000-0000000087f1'),
  ARRAY['production','creative','legal','finance','reference',
        'assets','code','shots','documentation']::TEXT[],
  'the nine read back, in the order written');                              -- 16

SELECT throws_ok($$
  UPDATE public.files SET tags = ARRAY['notes']
   WHERE id = 'aaaa1111-0000-0000-0000-0000000087f1'
$$, '23514', NULL, '''notes'' is refused (E3 removed it)');                 -- 17

SELECT throws_ok($$
  UPDATE public.files SET tags = ARRAY['Production']
   WHERE id = 'aaaa1111-0000-0000-0000-0000000087f1'
$$, '23514', NULL, 'a tag in another case is refused (stored lower case)'); -- 18

SELECT throws_ok($$
  UPDATE public.files SET tags = ARRAY[NULL]::TEXT[]
   WHERE id = 'aaaa1111-0000-0000-0000-0000000087f1'
$$, '23514', NULL, 'a NULL element is refused');                            -- 19

SELECT throws_ok($$
  UPDATE public.files SET tags = NULL
   WHERE id = 'aaaa1111-0000-0000-0000-0000000087f1'
$$, '23502', NULL, 'NULL tags are refused (NOT NULL)');                     -- 20

SELECT throws_ok($$
  UPDATE public.files
     SET tags = ARRAY['production','creative','legal','finance','reference',
                      'assets','code','shots','documentation','code']
   WHERE id = 'aaaa1111-0000-0000-0000-0000000087f1'
$$, '23514', NULL, 'a tenth element is refused (files_tags_len_chk)');      -- 21

-- user_b: workspace B's admin, nothing to do with project A.
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','22222222-2222-2222-2222-222222222222','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT lives_ok($$
  UPDATE public.files SET tags = '{}'
   WHERE id = 'aaaa1111-0000-0000-0000-0000000087f1'
$$, 'another workspace''s write raises nothing (RLS filters the row) …');  -- 22

-- user_a: workspace A's admin — reads the row and the history.
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT is(
  (SELECT cardinality(tags) FROM public.files WHERE id = 'aaaa1111-0000-0000-0000-0000000087f1'),
  9,
  '… and lands on nothing: the nine are still there');                      -- 23

SELECT ok(EXISTS (
  SELECT 1 FROM public.edit_history
   WHERE entity_type = 'files'
     AND entity_id = 'aaaa1111-0000-0000-0000-0000000087f1'
     AND action = 'update'
     AND diff ? 'tags'),
  'the tag edit left an update row in the edit history (E13)');             -- 24

-- ══ 3. One dimension (R1-SEC-04) ═══════════════════════════════════════════

SELECT ok(EXISTS (
  SELECT 1 FROM pg_constraint
   WHERE conrelid = 'public.files'::regclass AND contype = 'c'
     AND conname = 'files_tags_flat_chk'
     AND pg_get_constraintdef(oid) LIKE '%array_ndims(tags)%= 1)%'),
  'files_tags_flat_chk keeps tags one-dimensional');                         -- 25

SELECT throws_ok($$
  UPDATE public.files SET tags = '{{code,legal},{shots,assets}}'::TEXT[]
   WHERE id = 'aaaa1111-0000-0000-0000-0000000087f1'
$$, '23514', NULL, 'a 2-D array is refused (a tag the client would not see)'); -- 26

SELECT lives_ok($$
  UPDATE public.files SET tags = ARRAY['code','legal','shots','assets']
   WHERE id = 'aaaa1111-0000-0000-0000-0000000087f1'
$$, 'the same four tags, flat, are accepted');                              -- 27

SELECT lives_ok($$
  UPDATE public.files SET tags = '{}'
   WHERE id = 'aaaa1111-0000-0000-0000-0000000087f1'
$$, 'the empty array (no dimensions) is still accepted');                   -- 28

-- ══ 4. The nine and nothing else (R1-TST-17) ═══════════════════════════════

SELECT throws_ok($$
  UPDATE public.files SET tags = ARRAY['misc']
   WHERE id = 'aaaa1111-0000-0000-0000-0000000087f1'
$$, '23514', NULL, 'a word outside the nine (not only ''notes'') is refused'); -- 29

SELECT is(
  (SELECT count(*)::INT
     FROM pg_constraint c,
          regexp_matches(pg_get_constraintdef(c.oid), '''[a-z]+''', 'g') AS w
    WHERE c.conrelid = 'public.files'::regclass AND c.conname = 'files_tags_known_chk'),
  9,
  'files_tags_known_chk''s definition lists exactly nine words');             -- 30

SELECT * FROM finish();
ROLLBACK;
