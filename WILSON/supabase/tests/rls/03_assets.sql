-- pgTAP: assets RLS (direct workspace_id, populated by trigger)
BEGIN;
SELECT plan(15);

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

-- ── 0084 (S3a, 2026-09-30, D9): assets.scene_ids / shot_ids ───────────────
-- Still postgres here: from tests.login_as below the suite is
-- `authenticated` and never switches back. These are the client's existing
-- local shape (RelationsPanel and ProjectAssetsView write whole arrays), and
-- §6c makes them NOT NULL DEFAULT '{}' so a row that never named a scene
-- reads as an empty array, never as NULL. An array element cannot be an FK,
-- so a deleted scene's id may linger here — §6c's documented trade-off,
-- deliberately not probed as an error.

SELECT has_column('public', 'assets', 'scene_ids', 'assets.scene_ids exists (0084 §6c)');
SELECT has_column('public', 'assets', 'shot_ids',  'assets.shot_ids exists (0084 §6c)');

-- col_type_is reads the DISPLAYED type (format_type), which is 'uuid[]';
-- information_schema.columns.data_type would say only 'ARRAY'.
SELECT col_type_is('public', 'assets', 'scene_ids', 'uuid[]', 'assets.scene_ids is uuid[]');
SELECT col_type_is('public', 'assets', 'shot_ids',  'uuid[]', 'assets.shot_ids is uuid[]');

SELECT col_not_null('public', 'assets', 'scene_ids', 'assets.scene_ids is NOT NULL');
SELECT col_not_null('public', 'assets', 'shot_ids',  'assets.shot_ids is NOT NULL');

-- 🚨 is() over pg_get_expr, NOT col_default_is: for an ARRAY default the two
-- runners disagree. The hosted shim compares the deparsed text, so it needs
-- '{}'::uuid[]; real pgTAP casts the expected text to the column type, so it
-- needs '{}' — and given '{}'::uuid[] it raises "malformed array literal"
-- and aborts the suite. The deparsed text, compared with is(), reads the
-- same on both.
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.assets'::regclass AND a.attname = 'scene_ids'),
  '''{}''::uuid[]', 'assets.scene_ids defaults to an empty array (deparses to ''{}''::uuid[])');

SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.assets'::regclass AND a.attname = 'shot_ids'),
  '''{}''::uuid[]', 'assets.shot_ids defaults to an empty array (deparses to ''{}''::uuid[])');

-- And the value a row actually gets (45_budget_versions.sql's house practice
-- for a non-scalar default): the asset seeded above never named either.
SELECT ok(
  (SELECT scene_ids = '{}'::uuid[] AND shot_ids = '{}'::uuid[]
     FROM public.assets WHERE id = 'aaaa1111-0000-0000-0000-00000000aa01'),
  'an asset inserted without them gets two empty arrays, not NULLs');

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
