-- =========================================================================
-- 51_experiences.sql — Session 25, migration 0040.
--
-- Structure for experiences. Access rules are proved once in 48_scenes.sql.
--
-- Experiences and levels are structurally identical — LevelsView.jsx and
-- ExperiencesView.jsx are the same component with different nouns. They are
-- two tables rather than one because they are two toggles, two tabs and (in
-- S26) two folder roots; merging them would need a discriminator on every
-- query for no gain. This suite exists partly to make that duplication
-- explicit rather than accidental, and partly because CI's coverage guard
-- requires one file per table (rls.yml:49-84).
-- =========================================================================
BEGIN;

SELECT plan(8);

SELECT * FROM tests.rls_setup();


-- ── 1-4: the standing structural block ───────────────────────────────────

SELECT has_table('public'::name, 'experiences'::name,
  'experiences table exists');

SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.experiences'::regclass),
  'experiences has RLS enabled and forced');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'experiences' AND cmd = 'ALL'),
  0, 'experiences has no FOR ALL policy');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'experiences'),
  4, 'experiences has exactly four policies (select/insert/update/delete)');


-- ── 5: workspace stamping ────────────────────────────────────────────────

SELECT has_trigger('public', 'experiences',
  'trg_experiences_populate_workspace',
  'experiences stamps workspace_id on insert');


-- ── 6-7: the create dialog's payload, and the stamp ──────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.experiences (id, project_id, sort_order, name, status, description)
    VALUES ('88880000-0000-0000-0000-00000000ab01',
            'aaaa1111-0000-0000-0000-000000000001', 0,
            'Experience 1', 'not_started', '')$$,
  'the create dialog''s exact payload inserts');

SELECT is(
  (SELECT workspace_id FROM public.experiences
    WHERE id = '88880000-0000-0000-0000-00000000ab01'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'workspace_id is stamped from the project, with no client involvement');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;


-- ── 8: the migration-0011 privilege trap, for experiences ────────────────
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.experiences', 'SELECT') OR
    has_table_privilege('anon', 'public.experiences', 'INSERT') OR
    has_table_privilege('anon', 'public.experiences', 'UPDATE') OR
    has_table_privilege('anon', 'public.experiences', 'DELETE')
  ),
  'anon holds no table privilege on experiences'
);

SELECT * FROM finish();
ROLLBACK;
