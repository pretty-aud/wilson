-- pgTAP: ingestion_runs RLS (parent-join via projects)
BEGIN;
SELECT plan(4);

SELECT * FROM tests.rls_setup();

INSERT INTO public.ingestion_runs (id, project_id, status) VALUES
  ('aaaa1111-0000-0000-0000-00000000ad01', 'aaaa1111-0000-0000-0000-000000000001', 'queued'),
  ('bbbb2222-0000-0000-0000-00000000ad02', 'bbbb2222-0000-0000-0000-000000000001', 'queued');

SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

SELECT is(
  (SELECT count(*)::int FROM public.ingestion_runs WHERE id = 'aaaa1111-0000-0000-0000-00000000ad01'),
  1, 'user_a can SELECT own-workspace ingestion_run'
);

SELECT is(
  (SELECT count(*)::int FROM public.ingestion_runs WHERE id = 'bbbb2222-0000-0000-0000-00000000ad02'),
  0, 'user_a cannot SELECT workspace-B ingestion_run'
);

WITH upd AS (
  UPDATE public.ingestion_runs SET status = 'failed'
   WHERE id = 'bbbb2222-0000-0000-0000-00000000ad02'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0, 'user_a cannot UPDATE workspace-B ingestion_run');

INSERT INTO public.ingestion_runs (id, project_id, status)
VALUES ('aaaa1111-0000-0000-0000-00000000ad99',
        'aaaa1111-0000-0000-0000-000000000001', 'queued');

SELECT is(
  (SELECT created_by FROM public.ingestion_runs WHERE id = 'aaaa1111-0000-0000-0000-00000000ad99'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'ingestion_runs audit trigger populates created_by'
);

SELECT * FROM finish();
ROLLBACK;
