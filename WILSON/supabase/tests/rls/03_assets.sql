-- pgTAP: assets RLS (direct workspace_id, populated by trigger)
BEGIN;
SELECT plan(6);

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


-- ── 0033: the migration-0011 privilege trap, for assets ──
-- 0011's blanket GRANT plus its ALTER DEFAULT PRIVILEGES left anon holding
-- every table privilege on assets; 0033 revoked it. Assert the revoke rather
-- than assume it — a policy-only check passes while a privilege hole is wide
-- open, which is exactly how 26 tables stayed open until S21 tripped over one.
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.assets', 'SELECT') OR
    has_table_privilege('anon', 'public.assets', 'INSERT') OR
    has_table_privilege('anon', 'public.assets', 'UPDATE') OR
    has_table_privilege('anon', 'public.assets', 'DELETE')
  ),
  'anon holds no table privilege on assets'
);

SELECT * FROM finish();
ROLLBACK;
