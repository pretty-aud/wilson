-- =============================================================================
-- 0075_file_document_kind_and_description.sql — Track C, bundle C3: the two
-- columns a project attachment has always been written with and the cloud has
-- never had.
--
-- Audrey's ruling that lands here (FIX_PLAN_2026-09-04.md, answer 27):
-- "build it now" — D.O.G. cloud attachments — together with her parity rule
-- (2026-08-10): "all functionality should be the same in both versions of the
-- app."
--
-- THIS IS TRAP (a) OF MASTER_PLAN.md §6 #31, VERBATIM: "a migration adding
-- files.description + files.document_kind — ProjectsPage writes both on every
-- attachment and `files` has neither". Re-measured on wilson-dev 2026-09-07
-- before writing a line: `information_schema.columns` for public.files returns
-- 29 columns and neither of these is among them.
--
-- The defect that makes it a bug rather than a gap. ProjectFilesTable's Kind
-- select and Description cell call onUpdate(id, { document_kind }) and
-- onUpdate(id, { description }); ProjectsPage.handleFileUpdate routes a cloud
-- row to supabaseAdapter.updateFile, which runs toColumns('files', …) against
-- FILE_COLUMNS. Neither key is in that Set, so BOTH ARE SILENTLY STRIPPED and
-- the PATCH becomes a no-op the optimistic setCloudFiles() hides until the
-- next listFiles(). Local Server's PATCH route spreads req.body wholesale, so
-- the same two gestures DO persist on the desktop — the parity rule broken in
-- the direction that is hardest to see. The columns close it from the bottom;
-- FILE_COLUMNS + columnAllowlist.test.js close it from the top, in the same
-- commit, because either alone still loses the write.
--
-- ── ONE DEFINITION, NOT A SECOND ONE ─────────────────────────────────────────
-- 🚨 `document_kind` IS ALREADY A TYPE. 0000 declares
--   create type document_kind as enum ('script','treatment','gdd','brief',
--     'deck','outline','notes','pitch_bible','lookbook','other');
-- and ingestion_runs.document_kind has used it since. The client's
-- DOCUMENT_KINDS array in ProjectFilesTable.jsx lists exactly those ten. A
-- fresh TEXT + CHECK here would have been a SECOND vocabulary for one concept,
-- free to drift from the enum by one value and from the client by another —
-- the shape 0074's header calls out as the way a money arm goes wrong. The
-- column takes the existing type, so the database refuses an invented kind
-- with 22P02 and the two vocabularies cannot diverge.
--
-- NULLABLE, unlike ingestion_runs' NOT NULL DEFAULT 'other'. A file's kind is
-- a claim about a DOCUMENT; an image, a video or a plain asset has none, and
-- the client's select offers "—" as its first option and sends null for it.
-- Defaulting every uploaded frame of footage to 'other' would make the column
-- lie on the majority of rows. An ingestion RUN, by contrast, always ingested
-- something, which is why that one is NOT NULL.
--
-- `description` is free text with a 2000-character cap. The cap is a sanity
-- bound in the 0028 idiom (secret_ciphertext BETWEEN 16 AND 4096), not a
-- product limit: the cell is a one-line input. Without it the column is an
-- unbounded write surface on a table every project member can UPDATE.
--
-- ── WHAT THIS MIGRATION DELIBERATELY DOES NOT DO ─────────────────────────────
-- No policy is created, dropped or restated. Both columns live on `files`,
-- whose four policies (0004, re-pointed by 0027/0038/0042) already decide who
-- may SELECT and UPDATE a row; a column is not a separate grant surface under
-- RLS. Post-condition 4 asserts the policy COUNT and their names are exactly
-- what this migration inherited, so a future edit that quietly re-points one
-- while "adding a column" fails here rather than in production. That is the
-- 0059 lesson pointed at a migration that has no business touching a policy.
--
-- No backfill. Every existing files row genuinely has no document kind and no
-- description — the two fields have never been storable. NULL is the true
-- value, and inventing 'other' for 3 dev rows and 0 staging rows would be a
-- fabricated claim about content nobody classified. (0074 backfilled because
-- is_financial had a true value derivable from two live sources; this does
-- not.)
--
-- No change to files.is_core_definer. §6 #31 trap (b) — the polarity flip — is
-- resolved in the CLIENT and in the migration TOOL, not here: this column's
-- NOT NULL DEFAULT false is correct for RABBIT's own meaning ("this file
-- defines the asset"), and D.O.G.'s legacy default-true reading belongs to the
-- legacy arrays it reads. Moving the default would change every RABBIT file's
-- meaning to fix a D.O.G. one. The commit message states the ruling in full.
--
-- ORDERING: depends on 0000 (public.files, type document_kind). Independent of
-- 0073 and 0074 — C3 touches neither upload_reservations nor file_events.
-- pgTAP: 79_file_document_kind.sql (new).
-- =============================================================================

-- ── 1. The two columns ───────────────────────────────────────────────────────

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS document_kind public.document_kind;

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS description TEXT;

-- Idempotent by the 0073 idiom: DROP then ADD, so re-applying the file cannot
-- fail on an existing constraint and cannot leave a stale definition behind.
ALTER TABLE public.files
  DROP CONSTRAINT IF EXISTS files_description_len_chk;
ALTER TABLE public.files
  ADD CONSTRAINT files_description_len_chk
    CHECK (description IS NULL OR char_length(description) <= 2000);

COMMENT ON COLUMN public.files.document_kind IS
  '0075 — what KIND of document this file is, from the 0000 document_kind enum. '
  'NULL for anything that is not a document (images, video, ordinary assets). '
  'Written by the Resources drop zone (auto-detected from the name) and '
  'editable in ProjectFilesTable; read by D.O.G. to pick a project''s deck '
  'attachments out of public.files.';

COMMENT ON COLUMN public.files.description IS
  '0075 — free-text note about this file, capped at 2000 characters by '
  'files_description_len_chk. Written by ProjectFilesTable''s Description cell.';

-- ── 2. Post-conditions ───────────────────────────────────────────────────────
-- Each one is a tripwire for a specific way this migration, or a later one,
-- could be green and wrong.

DO $$
DECLARE
  n INT;
  v TEXT[];
BEGIN
  -- 1. Both columns exist, on the right table, with the right types, and both
  --    are NULLABLE. A NOT NULL slipped onto document_kind would refuse every
  --    image upload; onto description, every upload at all.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'files'
       AND column_name = 'document_kind'
       AND udt_name = 'document_kind' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION '0075 post-condition failed: files.document_kind is missing, not the document_kind enum, or NOT NULL';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'files'
       AND column_name = 'description'
       AND data_type = 'text' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION '0075 post-condition failed: files.description is missing, not text, or NOT NULL';
  END IF;

  -- 2. Neither column carries a DEFAULT. A default of 'other' on document_kind
  --    would make every media row claim to be a document, which is exactly the
  --    lie the nullable choice above exists to avoid — and a default is the
  --    easiest thing for a later ALTER to add without anyone noticing.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'files'
       AND column_name IN ('document_kind', 'description')
       AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION '0075 post-condition failed: one of the new columns has acquired a DEFAULT';
  END IF;

  -- 3. The vocabulary is the 0000 enum and still has exactly its ten values.
  --    The client's DOCUMENT_KINDS array is pinned against this same list by
  --    documentKind.test.js; if a session widens one it must widen the other,
  --    and this is the half that fails loudly.
  SELECT array_agg(e.enumlabel::TEXT ORDER BY e.enumlabel) INTO v
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
   WHERE t.typname = 'document_kind' AND t.typnamespace = 'public'::regnamespace;
  IF v IS DISTINCT FROM ARRAY[
    'brief','deck','gdd','lookbook','notes','other','outline','pitch_bible','script','treatment'
  ]::TEXT[] THEN
    RAISE EXCEPTION '0075 post-condition failed: the document_kind enum is %, not the ten values 0000 declared', v;
  END IF;

  -- 4. 🚨 THE POLICIES ON files ARE UNTOUCHED. This migration adds columns and
  --    nothing else; a policy that changed here would be a silent re-point
  --    riding a column addition, which is how 0038 inverted the invoice gate.
  --    Both the count and the names, because a DROP + CREATE pair keeps the
  --    count identical. These are the TABLE policies on public.files
  --    (files_select/insert/update/delete, 0004 as re-pointed by 0027/0038);
  --    the EIGHT rabbit_files_* policies the brief warns about live on
  --    storage.objects and are a different family this migration never sees.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'files';
  IF n <> 4 THEN
    RAISE EXCEPTION '0075 post-condition failed: % policies on public.files, expected the 4 this migration inherited', n;
  END IF;
  SELECT array_agg(policyname::TEXT ORDER BY policyname) INTO v
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'files';
  IF v IS DISTINCT FROM ARRAY[
    'files_delete','files_insert','files_select','files_update'
  ]::TEXT[] THEN
    RAISE EXCEPTION '0075 post-condition failed: the files policies are now %, not the four this migration inherited', v;
  END IF;

  -- 5. RLS is still enabled AND forced on files. A column addition cannot turn
  --    it off, but every migration that touches this table asserts it, because
  --    the day one does the whole money gate is gone.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.files'::regclass AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION '0075 post-condition failed: RLS is no longer enabled and forced on public.files';
  END IF;

  -- 6. The description cap is present and is a CHECK, not a domain or a
  --    trigger someone could disable. Asserted by DEFINITION, not by name
  --    alone: a constraint renamed to match while its body was widened would
  --    pass a name-only test.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.files'::regclass AND contype = 'c'
       AND conname = 'files_description_len_chk'
       AND pg_get_constraintdef(oid) LIKE '%char_length(description) <= 2000%'
  ) THEN
    RAISE EXCEPTION '0075 post-condition failed: files_description_len_chk is missing or no longer caps at 2000';
  END IF;

  -- 7. is_core_definer is exactly as it was — NOT NULL, DEFAULT false. §6 #31
  --    trap (b) is resolved in the client and the migration tool; a session
  --    that "fixed" the polarity by moving this default would change what
  --    every RABBIT file means, and would do it here. This is the tripwire.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'files'
       AND column_name = 'is_core_definer'
       AND is_nullable = 'NO' AND column_default = 'false'
  ) THEN
    RAISE EXCEPTION '0075 post-condition failed: files.is_core_definer is no longer NOT NULL DEFAULT false';
  END IF;

  -- 8. Nothing new was granted. anon holds nothing on files and still does;
  --    the two columns inherit the table's grants, and a column-level GRANT
  --    would be invisible to every other check in this block.
  IF EXISTS (
    SELECT 1 FROM information_schema.column_privileges
     WHERE table_schema = 'public' AND table_name = 'files'
       AND grantee IN ('anon', 'PUBLIC')
  ) THEN
    RAISE EXCEPTION '0075 post-condition failed: anon or PUBLIC holds a column privilege on public.files';
  END IF;
END $$;
