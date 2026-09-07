-- =========================================================================
-- 49_shots.sql — Session 25, migration 0040.
--
-- Structure and the two behaviours unique to shots. The shared access rules
-- (member writes, reviewer reads only, cross-workspace denied) are proved
-- once in 48_scenes.sql — all four tables carry the identical policy shape.
--
-- 🚨 PROBES 7-8 ARE THE POINT OF THIS FILE.
-- An UNPARENTED shot must be insertable AND readable. ScenesView.jsx:305
-- buckets shots with no scene_id under '__unlinked__' and :576 renders that
-- bucket as "Unlinked shots" — it is a real, displayed state, not an error.
--
-- This is the exact trap S23 spent hours inside. 0014 gave tasks_select an
-- `EXISTS (SELECT 1 FROM assets a WHERE a.id = tasks.asset_id)` arm, so once
-- tasks.asset_id was allowed to be NULL the row failed its OWN select policy
-- and .single() came back PGRST116. Relaxing the column without fixing the
-- policy MOVES the failure instead of removing it, and the move is silent.
-- shots_select therefore hops to the PROJECT, never to the scene, and probe 8
-- is what fails if anyone ever "tightens" it.
-- =========================================================================
BEGIN;

SELECT plan(11);

SELECT * FROM tests.rls_setup();


-- ── 1-4: the standing structural block ───────────────────────────────────

SELECT has_table('public'::name, 'shots'::name, 'shots table exists');

SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.shots'::regclass),
  'shots has RLS enabled and forced');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'shots' AND cmd = 'ALL'),
  0, 'shots has no FOR ALL policy');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'shots'),
  4, 'shots has exactly four policies (select/insert/update/delete)');


-- ── 5: workspace stamping ────────────────────────────────────────────────

SELECT has_trigger('public', 'shots',
  'trg_shots_populate_workspace',
  'shots stamps workspace_id on insert');


-- ── 6: scene_id is NULLABLE ──────────────────────────────────────────────
-- Expressed over information_schema rather than col_not_null(), because the
-- local pgTAP shim has no col_not_null and the whole run would abort.

SELECT is(
  (SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shots'
      AND column_name = 'scene_id'),
  'YES',
  'shots.scene_id is NULLABLE — an unlinked shot is a real UI state');


-- ── Act as the workspace admin for the behavioural probes ────────────────

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


-- ── 7-8: THE S23 TRAP — an unparented shot inserts AND reads back ────────

SELECT lives_ok(
  $$INSERT INTO public.shots (id, project_id, scene_id, name, shot_number)
    VALUES ('66660000-0000-0000-0000-0000000000d1',
            'aaaa1111-0000-0000-0000-000000000001', NULL, 'orphan', 1)$$,
  'a shot with no scene can be created');

-- If shots_select ever grows an EXISTS-on-scene arm, the INSERT above still
-- succeeds and THIS is the probe that fails — which is precisely the failure
-- mode that made "New task does nothing" so expensive to diagnose: the write
-- lands and the read denies it, with no error anywhere.
SELECT is(
  (SELECT count(*)::int FROM public.shots
    WHERE id = '66660000-0000-0000-0000-0000000000d1'),
  1,
  'an unparented shot is READABLE — shots_select hops to the project, never the scene');


-- ── 9: deleting a scene cascades to its shots ────────────────────────────
--
-- The UI deletes a scene's shots one at a time before the scene
-- (ScenesView.jsx:398-402). The cascade makes that outcome atomic instead of
-- dependent on a client-side loop completing — a half-failed loop would leave
-- shots pointing at a scene that no longer exists.

INSERT INTO public.scenes (id, project_id, name, scene_number)
VALUES ('55550000-0000-0000-0000-0000000000e1',
        'aaaa1111-0000-0000-0000-000000000001', 'WLSN_SC009', 9);

INSERT INTO public.shots (id, project_id, scene_id, name, shot_number)
VALUES ('66660000-0000-0000-0000-0000000000e1',
        'aaaa1111-0000-0000-0000-000000000001',
        '55550000-0000-0000-0000-0000000000e1', 'WLSN_SC009_SH0001', 1);

DELETE FROM public.scenes WHERE id = '55550000-0000-0000-0000-0000000000e1';

SELECT is(
  (SELECT count(*)::int FROM public.shots
    WHERE id = '66660000-0000-0000-0000-0000000000e1'),
  0,
  'deleting a scene cascades to its shots');


-- ── 10: frame_count cannot go negative ───────────────────────────────────
-- Every scene runtime and project total is a sum of these against
-- projects.fps (ScenesView.jsx:320). One negative value silently shortens a
-- whole project's runtime rather than failing anywhere visible.

SELECT throws_ok(
  $$INSERT INTO public.shots (project_id, name, frame_count)
    VALUES ('aaaa1111-0000-0000-0000-000000000001', 'negative', -1)$$,
  'new row for relation "shots" violates check constraint "shots_frame_count_nonneg"',
  'frame_count cannot be negative');


SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- ── 11: the migration-0011 privilege trap, for shots ─────────────────────
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.shots', 'SELECT') OR
    has_table_privilege('anon', 'public.shots', 'INSERT') OR
    has_table_privilege('anon', 'public.shots', 'UPDATE') OR
    has_table_privilege('anon', 'public.shots', 'DELETE')
  ),
  'anon holds no table privilege on shots'
);

SELECT * FROM finish();
ROLLBACK;
