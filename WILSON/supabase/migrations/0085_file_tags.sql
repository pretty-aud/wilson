-- =============================================================================
-- 0085_file_tags.sql — post-overhaul S4a: files.tags, the nine folder-like
-- categories a project file can carry, and files.is_core_definer described in
-- Audrey's own words.
--
-- Her rulings (docs/design/POST_OVERHAUL_PLAN.md §0.1, 2026-09-29):
--   E3  "several; beside Kind; remove the notes tag option; monochrome" —
--       NINE tags: Production, Creative, Legal, Finance, Reference, Assets,
--       Code, Shots, Documentation. Several per file. Kind stays what it is
--       (the document sub-type: script, treatment, deck …); a tag is the
--       folder-like category beside it.
--   E12 "start empty" — every existing row gets '{}', no backfill; the old
--       files.kind column (0000's file_kind: source / deliverable / …) is
--       ignored, not mapped onto a tag.
--   E2  "Core = the existing flag, its description rewritten to your
--       definition" — is_core_definer's comment below.
--   E4  labels only in this bundle: Finance is DISPLAYED from is_financial
--       and never written as a tag by the client; Legal is a plain label
--       until S4b builds its gate. The vocabulary still lists both, so the
--       Legal gate (S4b) can arrive without widening this CHECK.
--
-- ── ONE ARRAY COLUMN, ONE CHECK, NOT A JOIN TABLE ────────────────────────────
-- A file's tags are a small closed set read with the row everywhere the row
-- is read (the explorer, the file window, the filter). A text[] constrained
-- to the vocabulary keeps them ON the row the four files policies already
-- gate — a join table would be a second RLS surface, a second realtime topic
-- and a second edit-history stream for nine words. The CHECK is containment
-- (`<@`), so any subset of the nine is legal, the empty set included, and an
-- element outside it — a typo, 'notes' (E3 removed it), a NULL element, a
-- different case — is refused by the database with 23514.
--
-- The client is the other half (supabaseAdapter FILE_COLUMNS gains `tags` in
-- the same commit; columnAllowlist.test.js pins it, with a planted control).
-- A client AHEAD of this migration probes the column once per session (the
-- 0081 pattern, 42703 → absent) and strips `tags` from every write, so the
-- beta keeps working until this is applied.
--
-- ── WHAT THIS MIGRATION DELIBERATELY DOES NOT DO ─────────────────────────────
-- No policy is created, dropped or restated: a column is not a separate grant
-- surface under RLS, and files' four policies (0004, re-pointed by
-- 0027/0038/0042/0083) already decide who may read and write a row — and so
-- who may tag it. Post-condition 3 asserts the count AND the names, 0075's
-- shape, so a re-point cannot ride a column addition. The Legal gate is S4b's
-- (a new predicate, the files and storage policies), after Audrey rules on
-- its audience.
--
-- No trigger. Tag edits ride the existing edit history (E13):
-- trg_files_edit_history (0012) already captures every UPDATE on files; suite
-- 87 pins that it is still there.
--
-- A size bound beside the vocabulary: cardinality(tags) <= 9. Containment
-- alone would accept 'code' a thousand times over; with nine distinct words
-- there is never a reason for a tenth element. The 0075 idiom (a sanity
-- bound on a column every project member can UPDATE), not a product limit.
--
-- And ONE dimension (S4a review round 1, R1-SEC-04, measured on dev): `<@`
-- and cardinality() both flatten, so '{{code,legal},{shots,assets}}' passed
-- the two checks above. The client reads top-level elements only, so such a
-- row shows no tags while a containment query (`tags @> '{legal}'`, the
-- shape S4b's Legal gate will want) still finds 'legal' in it: a hidden tag.
-- coalesce, because the empty array has no dimensions (array_ndims is NULL).
-- Duplicates stay allowed: readers dedupe, and a CHECK cannot hold the
-- subquery DISTINCT would need.
--
-- ORDERING: depends on 0000 (public.files) and on nothing after it. Applied
-- by `supabase db query --linked --file supabase/migrations/0085_file_tags.sql`
-- (never `db push`); the dev and staging commands are in the S4a hand-off's
-- "Waiting on Audrey". pgTAP: 87_file_tags.sql (new).
-- =============================================================================

-- ── 1. The column ────────────────────────────────────────────────────────────

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- Idempotent by the 0073 idiom: DROP then ADD, so re-applying the file cannot
-- fail on an existing constraint and cannot leave a stale definition behind.
ALTER TABLE public.files
  DROP CONSTRAINT IF EXISTS files_tags_known_chk;
ALTER TABLE public.files
  ADD CONSTRAINT files_tags_known_chk
    CHECK (tags <@ ARRAY[
      'production', 'creative', 'legal', 'finance', 'reference',
      'assets', 'code', 'shots', 'documentation'
    ]::TEXT[]);

ALTER TABLE public.files
  DROP CONSTRAINT IF EXISTS files_tags_len_chk;
ALTER TABLE public.files
  ADD CONSTRAINT files_tags_len_chk
    CHECK (cardinality(tags) <= 9);

ALTER TABLE public.files
  DROP CONSTRAINT IF EXISTS files_tags_flat_chk;
ALTER TABLE public.files
  ADD CONSTRAINT files_tags_flat_chk
    CHECK (COALESCE(array_ndims(tags), 1) = 1);

-- "Every file tagged Legal", "every Shots file": a containment query, which
-- is what a GIN index on an array serves.
CREATE INDEX IF NOT EXISTS files_tags_gin
  ON public.files USING gin (tags);

COMMENT ON COLUMN public.files.tags IS
  '0085 — the file''s categories, any of nine: Production, Creative, Legal, '
  'Finance, Reference, Assets, Code, Shots, Documentation (stored lower case; '
  'files_tags_known_chk). Several per file, beside document_kind. Finance is '
  'shown from is_financial and never written by the client; Legal is a label '
  'until its gate (S4b). Starts empty on every row (no backfill).';

COMMENT ON COLUMN public.files.is_core_definer IS
  'Core project file (Audrey, 2026-09-29): files that give context about the '
  'project — the script, the treatment, storyboards, mood boards. Intake and '
  'D.O.G. read the core files as the project''s context. NOT NULL DEFAULT false.';

-- ── 2. Post-conditions ───────────────────────────────────────────────────────

DO $$
DECLARE
  n INT;
  v TEXT[];
BEGIN
  -- 1. The column: text[], NOT NULL, defaulting to the empty array. A NULL
  --    default would make every reader distinguish "no tags" from "unknown";
  --    a nullable column would let a write put it there.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'files'
       AND column_name = 'tags'
       AND data_type = 'ARRAY' AND udt_name = '_text'
       AND is_nullable = 'NO'
       AND column_default = '''{}''::text[]'
  ) THEN
    RAISE EXCEPTION '0085 post-condition failed: files.tags is missing, not text[], nullable, or not DEFAULT ''{}''';
  END IF;

  -- 2. The vocabulary CHECK, asserted by DEFINITION rather than by name (a
  --    widened body under the same name would pass a name-only test): every
  --    one of the nine is in it, and 'notes' — the tenth tag E3 removed — is
  --    not.
  SELECT array_agg(t ORDER BY t) INTO v
    FROM unnest(ARRAY['production','creative','legal','finance','reference',
                      'assets','code','shots','documentation']) AS t
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.files'::regclass AND contype = 'c'
        AND conname = 'files_tags_known_chk'
        AND pg_get_constraintdef(oid) LIKE '%''' || t || '''%');
  IF v IS NOT NULL THEN
    RAISE EXCEPTION '0085 post-condition failed: files_tags_known_chk is missing or does not list %', v;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.files'::regclass AND conname = 'files_tags_known_chk'
       AND pg_get_constraintdef(oid) LIKE '%''notes''%'
  ) THEN
    RAISE EXCEPTION '0085 post-condition failed: files_tags_known_chk admits ''notes'', which E3 removed';
  END IF;

  -- 3. 🚨 THE POLICIES ON files ARE UNTOUCHED — 0075's post-condition 4,
  --    repeated here because this is the same kind of migration: a column
  --    addition a policy re-point could ride. Count AND names, because a
  --    DROP + CREATE pair keeps the count identical.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'files';
  IF n <> 4 THEN
    RAISE EXCEPTION '0085 post-condition failed: % policies on public.files, expected the 4 this migration inherited', n;
  END IF;
  SELECT array_agg(policyname::TEXT ORDER BY policyname) INTO v
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'files';
  IF v IS DISTINCT FROM ARRAY[
    'files_delete','files_insert','files_select','files_update'
  ]::TEXT[] THEN
    RAISE EXCEPTION '0085 post-condition failed: the files policies are now %, not the four this migration inherited', v;
  END IF;

  -- 4. RLS still enabled AND forced on files.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.files'::regclass AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION '0085 post-condition failed: RLS is no longer enabled and forced on public.files';
  END IF;

  -- 5. is_core_definer kept its shape (0075's tripwire 7): this migration
  --    rewrites the column's COMMENT only, never its default — D.O.G.'s
  --    default-true reading is resolved in the client (§6 #31 trap (b)).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'files'
       AND column_name = 'is_core_definer'
       AND is_nullable = 'NO' AND column_default = 'false'
  ) THEN
    RAISE EXCEPTION '0085 post-condition failed: files.is_core_definer is no longer NOT NULL DEFAULT false';
  END IF;

  -- 6. The edit history still captures files (E13: tag and note edits ride
  --    it, no new event type).
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.files'::regclass
       AND tgname = 'trg_files_edit_history' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '0085 post-condition failed: trg_files_edit_history is gone, so tag edits would leave no history';
  END IF;

  -- 7. The GIN index is there and is on tags.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'files'
       AND indexname = 'files_tags_gin' AND indexdef ILIKE '%USING gin (tags)%'
  ) THEN
    RAISE EXCEPTION '0085 post-condition failed: files_tags_gin is missing or not a GIN index on tags';
  END IF;

  -- 8. The size bound, by definition (review round 1, R1-SEC-03: the one
  --    guard against an unbounded array on a column every member can UPDATE
  --    was the one check this block did not make). The closing parenthesis
  --    is part of the pattern, so '<= 99' does not pass.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.files'::regclass AND contype = 'c'
       AND conname = 'files_tags_len_chk'
       AND pg_get_constraintdef(oid) LIKE '%cardinality(tags) <= 9)%'
  ) THEN
    RAISE EXCEPTION '0085 post-condition failed: files_tags_len_chk is missing or does not bound tags at nine';
  END IF;

  -- 9. One dimension, by definition (R1-SEC-04).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.files'::regclass AND contype = 'c'
       AND conname = 'files_tags_flat_chk'
       AND pg_get_constraintdef(oid) LIKE '%array_ndims(tags)%= 1)%'
  ) THEN
    RAISE EXCEPTION '0085 post-condition failed: files_tags_flat_chk is missing or does not keep tags one-dimensional';
  END IF;
END $$;
