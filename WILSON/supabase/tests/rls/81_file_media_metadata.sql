-- =============================================================================
-- 81_file_media_metadata.sql — Demo 2026-09-11: files.duration_sec and
-- files.source_modified_at (migration 0081).
--
-- What this pins: both columns exist and are nullable; a member writes and
-- reads them through the same files policies as before (no policy changed);
-- a row without them still inserts.
-- =============================================================================

BEGIN;

SELECT plan(6);

SELECT * FROM tests.rls_setup();

SELECT has_column('public', 'files', 'duration_sec', 'files.duration_sec exists');
SELECT has_column('public', 'files', 'source_modified_at', 'files.source_modified_at exists');
SELECT col_is_null('public', 'files', 'duration_sec', 'files.duration_sec is nullable');

-- user_a: admin of workspace A (rls_setup), in the JWT's own claim shape.
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT lives_ok($$
  INSERT INTO public.files (id, project_id, name, mime_type, size_bytes, storage_provider, storage_path,
                            is_financial, duration_sec, source_modified_at)
  VALUES ('aaaa1111-0000-0000-0000-0000000081a1',
          'aaaa1111-0000-0000-0000-000000000001', 'clip.mov', 'video/quicktime', 123456, 'supabase',
          'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/10-clip.mov',
          false, 92.457, '2026-09-10T12:00:00Z')
$$, 'a member files a clip with its duration and its source modified time');

SELECT is(
  (SELECT duration_sec FROM public.files WHERE id = 'aaaa1111-0000-0000-0000-0000000081a1'),
  92.457::numeric, 'the duration reads back to the millisecond');

SELECT lives_ok($$
  INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial)
  VALUES ('aaaa1111-0000-0000-0000-0000000081a2',
          'aaaa1111-0000-0000-0000-000000000001', 'still.png', 'supabase',
          'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/11-still.png', false)
$$, 'a row without the new columns still inserts (nullable, no default)');

SELECT * FROM finish();
ROLLBACK;
