-- pgTAP: asset_versions RLS (parent-join via assets)
BEGIN;
SELECT plan(4);

SELECT * FROM tests.rls_setup();

INSERT INTO public.assets (id, project_id, name) VALUES
  ('aaaa1111-0000-0000-0000-00000000aa01', 'aaaa1111-0000-0000-0000-000000000001', 'Asset A'),
  ('bbbb2222-0000-0000-0000-00000000bb01', 'bbbb2222-0000-0000-0000-000000000001', 'Asset B');

INSERT INTO public.asset_versions (id, asset_id, version_no) VALUES
  ('aaaa1111-0000-0000-0000-00000000ee01', 'aaaa1111-0000-0000-0000-00000000aa01', 1),
  ('bbbb2222-0000-0000-0000-00000000ee02', 'bbbb2222-0000-0000-0000-00000000bb01', 1);

SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

SELECT is(
  (SELECT count(*)::int FROM public.asset_versions WHERE id = 'aaaa1111-0000-0000-0000-00000000ee01'),
  1, 'user_a can SELECT own-workspace asset_version'
);

SELECT is(
  (SELECT count(*)::int FROM public.asset_versions WHERE id = 'bbbb2222-0000-0000-0000-00000000ee02'),
  0, 'user_a cannot SELECT workspace-B asset_version'
);

WITH upd AS (
  UPDATE public.asset_versions SET notes = 'hijack'
   WHERE id = 'bbbb2222-0000-0000-0000-00000000ee02'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0, 'user_a cannot UPDATE workspace-B asset_version');

INSERT INTO public.asset_versions (id, asset_id, version_no)
VALUES ('aaaa1111-0000-0000-0000-00000000ee99', 'aaaa1111-0000-0000-0000-00000000aa01', 2);

SELECT is(
  (SELECT created_by FROM public.asset_versions WHERE id = 'aaaa1111-0000-0000-0000-00000000ee99'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'asset_versions audit trigger populates created_by'
);

SELECT * FROM finish();
ROLLBACK;
