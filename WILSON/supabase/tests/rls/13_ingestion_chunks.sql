-- pgTAP: ingestion_chunks RLS (parent-join via ingestion_runs → projects)
BEGIN;
SELECT plan(4);

SELECT * FROM tests.rls_setup();

INSERT INTO public.ingestion_runs (id, project_id, status) VALUES
  ('aaaa1111-0000-0000-0000-00000000ad01', 'aaaa1111-0000-0000-0000-000000000001', 'queued'),
  ('bbbb2222-0000-0000-0000-00000000ad02', 'bbbb2222-0000-0000-0000-000000000001', 'queued');

INSERT INTO public.ingestion_chunks (id, run_id, chunk_index) VALUES
  ('aaaa1111-0000-0000-0000-00000000ae01', 'aaaa1111-0000-0000-0000-00000000ad01', 0),
  ('bbbb2222-0000-0000-0000-00000000ae02', 'bbbb2222-0000-0000-0000-00000000ad02', 0);

SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

SELECT is(
  (SELECT count(*)::int FROM public.ingestion_chunks WHERE id = 'aaaa1111-0000-0000-0000-00000000ae01'),
  1, 'user_a can SELECT own-workspace ingestion_chunk'
);

SELECT is(
  (SELECT count(*)::int FROM public.ingestion_chunks WHERE id = 'bbbb2222-0000-0000-0000-00000000ae02'),
  0, 'user_a cannot SELECT workspace-B ingestion_chunk'
);

WITH upd AS (
  UPDATE public.ingestion_chunks SET chunk_label = 'hijack'
   WHERE id = 'bbbb2222-0000-0000-0000-00000000ae02'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0, 'user_a cannot UPDATE workspace-B ingestion_chunk');

INSERT INTO public.ingestion_chunks (id, run_id, chunk_index)
VALUES ('aaaa1111-0000-0000-0000-00000000ae99',
        'aaaa1111-0000-0000-0000-00000000ad01', 1);

SELECT is(
  (SELECT created_by FROM public.ingestion_chunks WHERE id = 'aaaa1111-0000-0000-0000-00000000ae99'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'ingestion_chunks audit trigger populates created_by'
);

SELECT * FROM finish();
ROLLBACK;
