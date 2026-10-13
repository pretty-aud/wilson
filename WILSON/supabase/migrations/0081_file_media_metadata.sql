-- =============================================================================
-- 0081_file_media_metadata.sql — Demo 2026-09-11: what a file row says about
-- the file itself.
--
-- Audrey, 2026-09-11, verbatim: "make sure that in the databases for files,
-- it states the name of the file, file type, creation date and time, file
-- size, if its an audio or video file the duration as well."
--
-- name, mime_type, size_bytes and uploaded_at / created_at have been on
-- public.files since 0000. Two facts the row could not hold:
--   * duration_sec — for audio/video, read from the bytes by the renderer as
--     the file is added (storage/mediaMetadata.js: a <video>/<audio> element,
--     bounded, best-effort — NULL where the browser cannot decode the codec).
--   * source_modified_at — the source file's own modified time, the one
--     timestamp a browser File object carries (its birth time is not
--     readable from a renderer). uploaded_at / created_at remain the record's.
-- Nullable, no default, no policy change: RLS on files is untouched.
--
-- Reserved number: 0081 (0073–0075 are Track C's, 0076/0078 C, 0077 A,
-- 0079 bins, 0080 assemblies — DEMO_2026-09-11_PLAN.md §5).
-- pgTAP: supabase/tests/rls/81_file_media_metadata.sql.
-- =============================================================================

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS duration_sec NUMERIC(12,3);

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS source_modified_at TIMESTAMPTZ;

COMMENT ON COLUMN public.files.duration_sec IS
  'Demo 2026-09-11: duration in seconds for an audio/video file, read from the bytes by the renderer as the file was added (best-effort; NULL where the browser could not decode it). The Local Server bundle carries the same field.';

COMMENT ON COLUMN public.files.source_modified_at IS
  'Demo 2026-09-11: the source file''s own last-modified time as the browser reported it when the file was added. uploaded_at / created_at are the record''s own times.';

-- ── Post-conditions ─────────────────────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'files'
         AND column_name IN ('duration_sec', 'source_modified_at')) <> 2 THEN
    RAISE EXCEPTION '0081 post-condition failed: files.duration_sec / files.source_modified_at missing';
  END IF;
END $$;
