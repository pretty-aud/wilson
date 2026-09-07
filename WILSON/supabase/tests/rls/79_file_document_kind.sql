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
--   * 🚨 THE POLARITY TRIPWIRE (probe 18): files.is_core_definer is STILL
--     NOT NULL DEFAULT false. MASTER_PLAN §6 #31 trap (b) is that D.O.G. reads
--     `isCore !== false` (default TRUE) while this column defaults FALSE, and
--     the tempting "fix" is to move the default here — which would silently
--     re-mean every RABBIT file on every project. C3 resolves the polarity in
--     the client and in the migration tool instead; this probe is what fails
--     if a later session reaches for the database again.
--
--   * THE MONEY GATE IS UNTOUCHED, ON BOTH SIDES (probes 21-25): a plain
--     project member reads an ordinary attachment's kind and description (22,
--     the presence control) and NOTHING of an invoice's (23); their WRITE to
--     an invoice lands on nothing (23-24, added in review round 1 — files_UPDATE
--     carries the same 0038 money arm and had only a positive control, so a
--     dropped arm there tripped nothing — though see probe 15's note: it
--     turned out no behavioural probe CAN isolate files_update, and the fix
--     was to make probe 15 structural across all four policies); a project
--     manager reads and writes both (24-25). New columns on a money-gated
--     table are a way to widen a surface without touching a policy; 78 pins
--     the same shape for file_events, and this is its twin for `files`.
--
--   * 🚨 WHAT anon CAN DO, ASKED OF THE ROLE (probes 16-17). The first version
--     of probe 16 counted `information_schema.column_privileges` and COULD NOT
--     FAIL: this file runs as `authenticated` from probe 7 onward, and that
--     view hides rows granted to anon by postgres from any role that is
--     neither. `has_table_privilege` is role-independent — suite 77's own
--     round-1 note says the same of `role_table_grants` — and 17 is the
--     presence control it had been missing.
--
--   * THE POLICIES DID NOT MOVE (probes 12-14): four policies, exactly those
--     four names, RLS enabled AND forced. 0038 inverted the invoice gate by
--     re-pointing a policy that looked incidental to its migration; a column
--     addition is exactly the kind of migration a re-point can ride.
--     ⚠️ Probe 13 checks NAMES, so it cannot see a DROP + CREATE of the same
--     name — breaker B5 proved that, tripping 15 and 23 while 13 stayed
--     green. That is why the arms are asserted as well as the names.
--
--   * THE CAP IS REAL (probes 6-8): 2000 characters accepted, 2001 refused,
--     and the constraint asserted by its DEFINITION rather than its name —
--     a widened body under the same name would pass a name-only test.
--
--   * NULL IS A LEGAL KIND (probes 4, 20): the client's select offers "—" and
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

SELECT plan(25);

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

-- 🚨 THE MONEY ARM SURVIVES ON ALL FOUR POLICIES — the only instrument that
-- can see it, and review round 1 is why this is structural rather than
-- behavioural.
--
-- The first version pinned files_select alone, and round 1 asked for a
-- negative twin on files_UPDATE: a plain member's write to an invoice landing
-- on nothing. MEASURED with the arm deliberately dropped from files_update
-- (breaker B10), that write STILL affects zero rows — because an UPDATE's
-- WHERE clause reads the row, so Postgres applies the SELECT policy to it as
-- well as the UPDATE policy's USING. files_update's arm is therefore NOT
-- independently observable from a client while files_select's stands, and no
-- behavioural probe can isolate it. Asserting the compiled qual can.
--
-- Asserted as a substring, so a re-worded but equivalent arm still passes
-- while a DELETED one fails; `permissive` too, because a RESTRICTIVE policy
-- with the same body means something entirely different (0041's lesson).
SELECT is(
  (SELECT count(*)::INT FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'files'
      AND permissive = 'PERMISSIVE'
      AND (COALESCE(qual, '') LIKE '%can_access_project_money%'
        OR COALESCE(with_check, '') LIKE '%can_access_project_money%')),
  4, 'all four files policies still carry the 0038 money arm');              -- 15

-- 🚨 REWRITTEN IN REVIEW ROUND 1, BECAUSE THE FIRST VERSION COULD NOT FAIL.
-- It counted `information_schema.column_privileges` for grantee IN
-- ('anon','PUBLIC') — but this file has been running as `authenticated` since
-- probe 7, and that view's final predicate is
-- `pg_has_role(grantor,'USAGE') OR pg_has_role(grantee,'USAGE') OR grantee =
-- 'PUBLIC'`. As `authenticated`, rows granted TO anon BY postgres are filtered
-- out of the view entirely, so a deliberate
-- `GRANT SELECT (description) ON public.files TO anon` still read 0.
--
-- has_table_privilege is role-independent and is the idiom 77's own round-1
-- note already established for exactly this reason ("role_table_grants OMITS
-- grants made to PUBLIC … anon INHERITS PUBLIC, so asking what anon CAN DO
-- covers both"). All seven privileges, because a column addition is a
-- plausible moment for a stray GRANT of any of them.
-- 🚨 TWO INSTRUMENTS, BECAUSE A COLUMN GRANT IS NOT A TABLE GRANT. Breaker B9
-- is `GRANT SELECT (description) ON public.files TO anon` — the exact shape a
-- migration that adds columns might reach for — and has_table_privilege stays
-- FALSE for it, because the table-level bit is untouched. has_column_privilege
-- is the one that sees it, and it is asked about the two columns 0075 adds,
-- which are the only ones this migration could have granted.
SELECT ok(
  NOT (has_table_privilege('anon', 'public.files', 'SELECT')
    OR has_table_privilege('anon', 'public.files', 'INSERT')
    OR has_table_privilege('anon', 'public.files', 'UPDATE')
    OR has_table_privilege('anon', 'public.files', 'DELETE')
    OR has_table_privilege('anon', 'public.files', 'TRUNCATE')
    OR has_table_privilege('anon', 'public.files', 'REFERENCES')
    OR has_table_privilege('anon', 'public.files', 'TRIGGER')
    OR has_column_privilege('anon', 'public.files', 'document_kind', 'SELECT')
    OR has_column_privilege('anon', 'public.files', 'document_kind', 'UPDATE')
    OR has_column_privilege('anon', 'public.files', 'description', 'SELECT')
    OR has_column_privilege('anon', 'public.files', 'description', 'UPDATE')),
  'anon (and so PUBLIC) can do nothing at all on public.files, table or column');
                                                                            -- 16

-- PRESENCE CONTROL for probe 16 — the one absence check in this file that had
-- none, which is how the vacuous version survived. If has_table_privilege
-- itself were answering NO to everything, this would fail too.
SELECT ok(
  has_table_privilege('authenticated', 'public.files', 'SELECT')
  AND has_table_privilege('authenticated', 'public.files', 'UPDATE'),
  'authenticated CAN select and update public.files — the probe above is '
  'reading real answers');                                                  -- 17

-- 🚨 THE POLARITY TRIPWIRE. See the header.
SELECT is(
  (SELECT is_nullable || '/' || COALESCE(column_default, 'no-default')
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'files'
      AND column_name = 'is_core_definer'),
  'NO/false',
  '🚨 files.is_core_definer is still NOT NULL DEFAULT false — §6 #31 trap (b) '
  'is resolved in the client, never by moving this default');                -- 18

-- ══ 5. What a member can actually do ════════════════════════════════════════

-- The "—" option in ProjectFilesTable's Kind select sends null. If NULL were
-- refused, clearing a wrongly-detected kind would be impossible.
SELECT lives_ok($$
  UPDATE public.files SET document_kind = NULL, description = NULL
   WHERE id = 'aaaa1111-0000-0000-0000-000000007901'
$$, 'a kind and a description can be cleared back to NULL');                 -- 19

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
  1, 'the admin who wrote the invoice row can see it');                      -- 20

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
  'a plain member reads an ordinary attachment''s kind and description');    -- 21

SELECT is(
  (SELECT count(*)::INT FROM public.files
    WHERE id = 'aaaa1111-0000-0000-0000-000000007903'
      AND (document_kind IS NOT NULL OR description IS NOT NULL)),
  0,
  '🚨 a plain member reads NOTHING of an invoice — the new columns did not '
  'widen the money gate');                                                   -- 22

-- 🚨 THE NEGATIVE TWIN FOR files_update's MONEY ARM (review round 1). Probe
-- 15 pins the arm on files_select by its compiled qual and the last probe in
-- this file is a POSITIVE control on files_update — a manager writing an
-- invoice. Neither fails if the arm is dropped from files_update, which is
-- the write half of the same gate 0038 once inverted. A plain member's UPDATE
-- must reach zero rows: RLS filters the row out of the USING clause rather
-- than raising, so this is a row count, not a throws_ok.
-- ⚠️ RLS FILTERS, IT DOES NOT RAISE: an UPDATE whose USING clause excludes
-- the row affects zero rows and returns cleanly, so there is nothing for
-- throws_ok to catch. (A data-modifying CTE cannot be nested inside is()
-- either — 0A000.) The write is attempted here and its ABSENCE is asserted by
-- the manager one probe below, who is the only reader who can see the value.
--
-- ⚠️ AND IT IS DEFENCE IN DEPTH, NOT AN ISOLATION OF files_update. Breaker
-- B10 measured it: with the money arm dropped from files_update and left on
-- files_select, this write still touches zero rows, because the UPDATE's WHERE
-- clause reads the row and so passes the SELECT policy too. What this pair
-- proves is the property that matters to a person — a plain member cannot
-- change an invoice at all — and probe 15 is what would notice the arm going
-- missing from any one policy.
SELECT lives_ok($$
  UPDATE public.files SET description = 'member got in'
   WHERE id = 'aaaa1111-0000-0000-0000-000000007903'
$$, 'a plain member''s UPDATE of an invoice is filtered, not refused');     -- 23

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
  '🚨 a project manager reads the invoice through the money arm — AND the '
  'plain member''s write above landed on nothing');
                                                                             -- 24

SELECT lives_ok($$
  UPDATE public.files SET description = 'october invoice, reissued'
   WHERE id = 'aaaa1111-0000-0000-0000-000000007903'
$$, 'and can write it — files_update''s money arm admits the same reader');  -- 25

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
