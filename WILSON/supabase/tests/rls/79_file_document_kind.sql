-- =============================================================================
-- 79_file_document_kind.sql — Track C, bundle C3: the two columns a project
-- attachment has always been written with (migration 0075), and the four things
-- adding them must not have changed.
--
-- What this pins, in order of how badly it would hurt to get wrong:
--
--   * 🚨 THE VOCABULARY IS THE 0000 ENUM, NOT A SECOND ONE (probes 3, 9-11):
--     document_kind takes the type ingestion_runs has used since 0000, so an
--     invented kind is refused by the database (probe 10) while a real one is
--     accepted (probe 9, the presence control) and the ten labels are pinned
--     exactly (probe 11). A TEXT column with a hand-written CHECK would drift
--     from the client's DOCUMENT_KINDS array the first time either list grew;
--     probes 3 and 10 are what refuse it.
--
--   * 🚨 THE POLARITY TRIPWIRE (probe 17): files.is_core_definer is STILL
--     NOT NULL DEFAULT false. MASTER_PLAN §6 #31 trap (b) is that D.O.G. reads
--     `isCore !== false` (default TRUE) while this column defaults FALSE, and
--     the tempting "fix" is to move the default here — which would silently
--     re-mean every RABBIT file on every project. C3 resolves the polarity in
--     the client and in the migration tool instead; this probe is what fails
--     if a later session reaches for the database again.
--
--   * THE MONEY GATE IS UNTOUCHED (probes 20-23): a plain project member reads
--     an ordinary attachment's kind and description (20, the presence control)
--     and NOTHING of an invoice's (21), while a project manager reads both
--     (22-23). New columns on a money-gated table are a way to widen a read
--     surface without touching a policy; 78 pins the same shape for
--     file_events, and this is its twin for `files` itself.
--
--   * THE POLICIES DID NOT MOVE (probes 12-14): four policies, exactly those
--     four names, RLS enabled AND forced. 0038 inverted the invoice gate by
--     re-pointing a policy that looked incidental to its migration; a column
--     addition is exactly the kind of migration a re-point can ride.
--
--   * THE CAP IS REAL (probes 6-8): 2000 characters accepted, 2001 refused,
--     and the constraint asserted by its DEFINITION rather than its name —
--     a widened body under the same name would pass a name-only test.
--
--   * NULL IS A LEGAL KIND (probes 4, 18): the client's select offers "—" and
--     sends null for it, and every image and video row has no document kind at
--     all. A NOT NULL or a DEFAULT 'other' here would either refuse those
--     uploads or make them claim to be documents.
--
-- Every absence check has a presence control one probe away, so an empty
-- result cannot pass by accident. Proven by breakers before 0075 was applied
-- to any environment — the table is in the commit message.
--
-- 🚨 RUNS INSIDE ONE TRANSACTION THAT ROLLS BACK. Nothing here survives.
-- =============================================================================

BEGIN;

SELECT plan(23);

SELECT * FROM tests.rls_setup();

-- user_c: a plain ws_a member on project A with no money access. user_d: a
-- ws_a 'user' who MANAGES project A — can_access_project_money's second arm,
-- with no admin claim anywhere. The same two people suite 78 uses, for the
-- same reason: the money arm has two readers and one non-reader.
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now()),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user_d@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111',
   'dddddddd-dddd-dddd-dddd-dddddddddddd', 'user', 'user_d', 'User D', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.project_members (project_id, user_id, workspace_id, project_role)
VALUES
  ('aaaa1111-0000-0000-0000-000000000001',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'member'),
  ('aaaa1111-0000-0000-0000-000000000001',
   'dddddddd-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111', 'manager')
ON CONFLICT (project_id, user_id) DO NOTHING;

-- ══ 1. The shape ════════════════════════════════════════════════════════════

SELECT has_column('public'::name, 'files'::name, 'document_kind'::name,
  'files.document_kind exists');                                             -- 1

SELECT has_column('public'::name, 'files'::name, 'description'::name,
  'files.description exists');                                               -- 2

-- 🚨 udt_name, not data_type: an enum column reports data_type = 'USER-DEFINED'
-- for EVERY enum, so a TEXT-plus-CHECK rewrite and a wrong-enum rewrite would
-- both slip past a data_type test. udt_name names the type itself.
SELECT is(
  (SELECT udt_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'files'
      AND column_name = 'document_kind'),
  'document_kind',
  '🚨 files.document_kind is the 0000 document_kind enum, not a second vocabulary');
                                                                             -- 3

SELECT is(
  (SELECT is_nullable || '/' || COALESCE(column_default, 'no-default')
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'files'
      AND column_name = 'document_kind'),
  'YES/no-default',
  'document_kind is nullable with no default — media rows have no kind');    -- 4

SELECT is(
  (SELECT data_type || '/' || is_nullable || '/' || COALESCE(column_default, 'no-default')
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'files'
      AND column_name = 'description'),
  'text/YES/no-default',
  'description is nullable text with no default');                           -- 5

-- ══ 2. The description cap ══════════════════════════════════════════════════

-- By DEFINITION, not by name: a constraint renamed to match while its body was
-- widened passes a name-only test.
SELECT is(
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid = 'public.files'::regclass
      AND conname = 'files_description_len_chk'),
  'CHECK (((description IS NULL) OR (char_length(description) <= 2000)))',
  'files_description_len_chk caps description at 2000 characters');          -- 6

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- PRESENCE CONTROL for probe 8: exactly 2000 characters is accepted, so the
-- refusal below is the cap firing and not the INSERT failing for some other
-- reason.
SELECT lives_ok($$
  INSERT INTO public.files (id, project_id, name, storage_provider, storage_path,
                            size_bytes, is_financial, document_kind, description)
  VALUES ('aaaa1111-0000-0000-0000-000000007901',
          'aaaa1111-0000-0000-0000-000000000001', 'brief.pdf', 'supabase',
          'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c3/1-brief.pdf',
          2048, false, 'brief', repeat('x', 2000))
$$, 'a 2000-character description is accepted');                             -- 7

SELECT throws_ok($$
  INSERT INTO public.files (id, project_id, name, storage_provider, storage_path,
                            size_bytes, is_financial, description)
  VALUES ('aaaa1111-0000-0000-0000-000000007902',
          'aaaa1111-0000-0000-0000-000000000001', 'long.pdf', 'supabase',
          'projects/aaaa1111-0000-0000-0000-000000000001/ASSETS/c3/1-long.pdf',
          1, false, repeat('x', 2001))
$$, '23514', NULL, 'a 2001-character description is refused by the cap');     -- 8

-- ══ 3. The vocabulary ═══════════════════════════════════════════════════════

-- PRESENCE CONTROL for probe 10: a real kind IS writable on this column, so
-- the refusal below is the enum rejecting an unknown label rather than the
-- column rejecting kinds generally. (That the ten labels are the right ten is
-- probe 11's job, and that the column IS that type is probe 3's; those two
-- plus this one cover the vocabulary without a ten-way UPDATE whose join
-- semantics would make "all ten were tried" a claim rather than a fact.)
SELECT lives_ok($$
  UPDATE public.files SET document_kind = 'pitch_bible'
   WHERE id = 'aaaa1111-0000-0000-0000-000000007901'
$$, 'a real document kind is accepted on the column');                       -- 9

-- 🚨 NO EXPLICIT CAST. `'storyboard'::public.document_kind` would raise 22P02
-- even against a TEXT column, because the cast names the type rather than the
-- column — the breaker run proved it (B1 left this probe green). A bare string
-- is coerced to whatever the COLUMN is, so this fails the moment the column
-- stops being the enum.
SELECT throws_ok($$
  UPDATE public.files SET document_kind = 'storyboard'
   WHERE id = 'aaaa1111-0000-0000-0000-000000007901'
$$, '22P02', NULL,
  '🚨 an invented document kind is refused by the database, not by the client');
                                                                             -- 10

SELECT is(
  (SELECT array_agg(e.enumlabel::TEXT ORDER BY e.enumlabel)
     FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'document_kind' AND t.typnamespace = 'public'::regnamespace),
  ARRAY['brief','deck','gdd','lookbook','notes','other','outline',
        'pitch_bible','script','treatment']::TEXT[],
  'the document_kind enum still has exactly the ten values 0000 declared');   -- 11

-- ══ 4. Nothing else moved ═══════════════════════════════════════════════════

SELECT is(
  (SELECT count(*)::INT FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'files'),
  4, 'public.files still has exactly four policies');                        -- 12

SELECT is(
  (SELECT array_agg(policyname::TEXT ORDER BY policyname) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'files'),
  ARRAY['files_delete','files_insert','files_select','files_update']::TEXT[],
  'they are the same four policies, by name — no re-point rode the columns in');
                                                                             -- 13

SELECT is(
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
    WHERE oid = 'public.files'::regclass),
  true, 'RLS is still enabled AND forced on public.files');                   -- 14

-- The money arm survives verbatim in the SELECT policy. Asserted as a
-- substring of the compiled qual, so a re-worded but equivalent arm still
-- passes while a DELETED one fails.
SELECT ok(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'files'
      AND policyname = 'files_select')
  LIKE '%can_access_project_money%',
  'files_select still carries the 0038 money arm');                          -- 15

SELECT is(
  (SELECT count(*)::INT FROM information_schema.column_privileges
    WHERE table_schema = 'public' AND table_name = 'files'
      AND grantee IN ('anon', 'PUBLIC')),
  0, 'anon and PUBLIC hold no column privilege on public.files');            -- 16

-- 🚨 THE POLARITY TRIPWIRE. See the header.
SELECT is(
  (SELECT is_nullable || '/' || COALESCE(column_default, 'no-default')
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'files'
      AND column_name = 'is_core_definer'),
  'NO/false',
  '🚨 files.is_core_definer is still NOT NULL DEFAULT false — §6 #31 trap (b) '
  'is resolved in the client, never by moving this default');                -- 17

-- ══ 5. What a member can actually do ════════════════════════════════════════

-- The "—" option in ProjectFilesTable's Kind select sends null. If NULL were
-- refused, clearing a wrongly-detected kind would be impossible.
SELECT lives_ok($$
  UPDATE public.files SET document_kind = NULL, description = NULL
   WHERE id = 'aaaa1111-0000-0000-0000-000000007901'
$$, 'a kind and a description can be cleared back to NULL');                 -- 18

-- Two rows for the money probes: one ordinary attachment, one invoice, both
-- carrying a kind and a description so an over-broad read is visible.
UPDATE public.files
   SET document_kind = 'brief', description = 'the client brief'
 WHERE id = 'aaaa1111-0000-0000-0000-000000007901';

INSERT INTO public.files (id, project_id, name, storage_provider, storage_path,
                          size_bytes, is_financial, document_kind, description)
VALUES ('aaaa1111-0000-0000-0000-000000007903',
        'aaaa1111-0000-0000-0000-000000000001', 'invoice.pdf', 'supabase',
        'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/1-invoice.pdf',
        1024, true, 'other', 'october invoice, 12k');

SELECT is(
  (SELECT count(*)::INT FROM public.files
    WHERE id = 'aaaa1111-0000-0000-0000-000000007903'),
  1, 'the admin who wrote the invoice row can see it');                      -- 19

-- ── user_c: a plain member, no money access ─────────────────────────────────
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','cccccccc-cccc-cccc-cccc-cccccccccccc','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','user')
)::text, true);

-- PRESENCE CONTROL for probe 21.
SELECT is(
  (SELECT document_kind::TEXT || '/' || description FROM public.files
    WHERE id = 'aaaa1111-0000-0000-0000-000000007901'),
  'brief/the client brief',
  'a plain member reads an ordinary attachment''s kind and description');    -- 20

SELECT is(
  (SELECT count(*)::INT FROM public.files
    WHERE id = 'aaaa1111-0000-0000-0000-000000007903'
      AND (document_kind IS NOT NULL OR description IS NOT NULL)),
  0,
  '🚨 a plain member reads NOTHING of an invoice — the new columns did not '
  'widen the money gate');                                                   -- 21

-- ── user_d: a project manager, no admin claim ───────────────────────────────
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','dddddddd-dddd-dddd-dddd-dddddddddddd','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','user')
)::text, true);

SELECT is(
  (SELECT description FROM public.files
    WHERE id = 'aaaa1111-0000-0000-0000-000000007903'),
  'october invoice, 12k',
  'a project manager reads the invoice''s description through the money arm');
                                                                             -- 22

SELECT lives_ok($$
  UPDATE public.files SET description = 'october invoice, reissued'
   WHERE id = 'aaaa1111-0000-0000-0000-000000007903'
$$, 'and can write it — files_update''s money arm admits the same reader');  -- 23

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
