-- pgTAP: assets RLS (direct workspace_id, populated by trigger)
BEGIN;
SELECT plan(5);

SELECT * FROM tests.rls_setup();

-- Seed one asset in each workspace. workspace_id is auto-populated by the
-- BEFORE INSERT trigger from project_id.
INSERT INTO public.assets (id, project_id, name) VALUES
  ('aaaa1111-0000-0000-0000-00000000aa01', 'aaaa1111-0000-0000-0000-000000000001', 'Asset A'),
  ('bbbb2222-0000-0000-0000-00000000bb01', 'bbbb2222-0000-0000-0000-000000000001', 'Asset B');

-- Verify trigger denormalized workspace_id correctly.
SELECT is(
  (SELECT workspace_id FROM public.assets WHERE id = 'aaaa1111-0000-0000-0000-00000000aa01'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'fn_populate_workspace_from_project denormalized workspace_id'
);

SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

SELECT is(
  (SELECT count(*)::int FROM public.assets WHERE id = 'aaaa1111-0000-0000-0000-00000000aa01'),
  1, 'user_a can SELECT own-workspace asset'
);

SELECT is(
  (SELECT count(*)::int FROM public.assets WHERE id = 'bbbb2222-0000-0000-0000-00000000bb01'),
  0, 'user_a cannot SELECT workspace-B asset'
);

WITH upd AS (
  UPDATE public.assets SET name = 'hijack' WHERE id = 'bbbb2222-0000-0000-0000-00000000bb01'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0, 'user_a cannot UPDATE workspace-B asset');

INSERT INTO public.assets (id, project_id, name)
VALUES ('aaaa1111-0000-0000-0000-00000000aa99', 'aaaa1111-0000-0000-0000-000000000001', 'audit probe');

SELECT is(
  (SELECT created_by FROM public.assets WHERE id = 'aaaa1111-0000-0000-0000-00000000aa99'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'assets audit trigger populates created_by'
);

SELECT * FROM finish();
ROLLBACK;
