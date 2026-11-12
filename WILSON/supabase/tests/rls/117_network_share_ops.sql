-- =============================================================================
-- 117_network_share_ops.sql — migration 0117, the office-server journal
-- (M.O.T.H. Session 1; docs/design/MOTH_DESIGN.md §1.4 "0117", §1.5, §2.4 NS-D12).
--
-- What this pins:
--   * The journal is closed: row security on and forced, no policies, and no client may
--     read or write it. Only definers do; suite 118 drives them.
--   * One pending operation per file, and the shape of a row: its op, its state, and
--     that a settled row says when.
--   * A row goes with its file, because a file id may be sent again.
--   * The purge removes only settled rows older than its retention, a pending one however
--     old it is, and refuses a retention under a day.
--
-- user_a is the admin (rls_setup). Fixture ids: project aaaa1111-…-000000011701, files
-- 11700000-…-0000000001xx, journal rows 11700000-…-0000000002xx.
-- =============================================================================

BEGIN;

SELECT plan(25);

SELECT * FROM tests.rls_setup();

INSERT INTO public.projects (id, workspace_id, title, created_by) VALUES
  ('aaaa1111-0000-0000-0000-000000011701', '11111111-1111-1111-1111-111111111111', 'Journal', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

INSERT INTO public.files (id, project_id, name, storage_provider, storage_path) VALUES
  ('11700000-0000-0000-0000-000000000101', 'aaaa1111-0000-0000-0000-000000011701', 'a.mov', 'network_share', 'nas:Journal/a.mov'),
  ('11700000-0000-0000-0000-000000000102', 'aaaa1111-0000-0000-0000-000000011701', 'b.mov', 'network_share', 'nas:Journal/b.mov'),
  ('11700000-0000-0000-0000-000000000103', 'aaaa1111-0000-0000-0000-000000011701', 'c.mov', 'network_share', 'nas:Journal/c.mov');

CREATE FUNCTION public.t117_op(p_id uuid, p_file uuid, p_state text, p_settled timestamptz)
RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.network_share_ops
    (id, workspace_id, file_id, project_id, op, to_locator, state, created_by, settled_at)
  VALUES
    (p_id, '11111111-1111-1111-1111-111111111111', p_file, 'aaaa1111-0000-0000-0000-000000011701', 'trash',
     'Journal/.wilson-bin/x/y', p_state, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', p_settled);
$f$;


-- ── closed ──────────────────────────────────────────────────────────────
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.network_share_ops'::regclass),
  'network_share_ops has row level security on and forced');
SELECT is((SELECT count(*)::int FROM pg_policy WHERE polrelid = 'public.network_share_ops'::regclass), 0,
  'network_share_ops has no policies');
SELECT ok(NOT has_table_privilege('authenticated', 'public.network_share_ops', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'authenticated holds no privilege');
SELECT ok(NOT has_table_privilege('anon', 'public.network_share_ops', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'anon holds no privilege');
SELECT ok(NOT has_function_privilege('authenticated', 'public.purge_network_share_ops(interval)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.purge_network_share_ops(interval)', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.purge_network_share_ops(interval)', 'EXECUTE'),
  'only the service may run the purge');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.purge_network_share_ops(interval)'::regprocedure),
  'the purge is a definer');

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin')
)::text, true);

SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT count(*) FROM public.network_share_ops $$, '42501', NULL, 'an admin cannot read the journal');
SELECT throws_ok($$
  INSERT INTO public.network_share_ops (workspace_id, file_id, project_id, op, to_locator)
  VALUES ('11111111-1111-1111-1111-111111111111', '11700000-0000-0000-0000-000000000101',
          'aaaa1111-0000-0000-0000-000000011701', 'trash', 'x')
$$, '42501', NULL, 'or write it');
SELECT throws_ok($$ UPDATE public.network_share_ops SET state = 'done' $$, '42501', NULL, 'or change it');
SELECT throws_ok($$ DELETE FROM public.network_share_ops $$, '42501', NULL, 'or empty it');
RESET ROLE;


-- ── one pending per file, and the shape ───────────────────────────────
SELECT lives_ok($$ SELECT public.t117_op('11700000-0000-0000-0000-000000000201', '11700000-0000-0000-0000-000000000101', 'pending', NULL) $$,
  'a pending operation');
SELECT throws_ok($$ SELECT public.t117_op('11700000-0000-0000-0000-000000000202', '11700000-0000-0000-0000-000000000101', 'pending', NULL) $$,
  '23505', NULL, 'a second pending operation on the same file is refused');
SELECT lives_ok($$ SELECT public.t117_op('11700000-0000-0000-0000-000000000203', '11700000-0000-0000-0000-000000000101', 'done', now()) $$,
  'a settled one beside it is not');
SELECT throws_ok($$ SELECT public.t117_op('11700000-0000-0000-0000-000000000204', '11700000-0000-0000-0000-000000000102', 'done', NULL) $$,
  '23514', 'new row for relation "network_share_ops" violates check constraint "network_share_ops_settled_chk"',
  'a settled row says when');
SELECT throws_ok($$ SELECT public.t117_op('11700000-0000-0000-0000-000000000205', '11700000-0000-0000-0000-000000000102', 'pending', now()) $$,
  '23514', 'new row for relation "network_share_ops" violates check constraint "network_share_ops_settled_chk"',
  'and a pending row does not');
SELECT throws_ok($$ SELECT public.t117_op('11700000-0000-0000-0000-000000000206', '11700000-0000-0000-0000-000000000102', 'lost', now()) $$,
  '23514', 'new row for relation "network_share_ops" violates check constraint "network_share_ops_state_chk"',
  'a state outside the list is refused');
SELECT throws_ok($$
  INSERT INTO public.network_share_ops (workspace_id, file_id, project_id, op, to_locator, created_by)
  VALUES ('11111111-1111-1111-1111-111111111111', '11700000-0000-0000-0000-000000000102',
          'aaaa1111-0000-0000-0000-000000011701', 'rename', 'x', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
$$, '23514', 'new row for relation "network_share_ops" violates check constraint "network_share_ops_op_chk"',
  'an op outside the list is refused');
SELECT throws_ok($$
  INSERT INTO public.network_share_ops (workspace_id, file_id, project_id, op, to_locator, origin, created_by)
  VALUES ('11111111-1111-1111-1111-111111111111', '11700000-0000-0000-0000-000000000102',
          'aaaa1111-0000-0000-0000-000000011701', 'trash', 'x', jsonb_build_object('a', repeat('x', 4001)),
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
$$, '23514', 'new row for relation "network_share_ops" violates check constraint "network_share_ops_origin_chk"',
  'an origin over 4,000 bytes is refused');


-- ── a row goes with its file ──────────────────────────────────────────
SELECT lives_ok($$ SELECT public.t117_op('11700000-0000-0000-0000-000000000207', '11700000-0000-0000-0000-000000000103', 'done', now()) $$,
  'a settled row for the third file');
DELETE FROM public.files WHERE id = '11700000-0000-0000-0000-000000000103';
SELECT is((SELECT count(*)::int FROM public.network_share_ops WHERE file_id = '11700000-0000-0000-0000-000000000103'), 0,
  'and it goes when the file goes');


-- ── the purge ─────────────────────────────────────────────────────────
SELECT public.t117_op('11700000-0000-0000-0000-000000000208', '11700000-0000-0000-0000-000000000102', 'done', now() - interval '91 days');
SELECT public.t117_op('11700000-0000-0000-0000-000000000209', '11700000-0000-0000-0000-000000000102', 'reverted', now() - interval '91 days');
SELECT public.t117_op('11700000-0000-0000-0000-000000000210', '11700000-0000-0000-0000-000000000102', 'done', now() - interval '89 days');
UPDATE public.network_share_ops SET created_at = now() - interval '200 days' WHERE id = '11700000-0000-0000-0000-000000000201';

SELECT public.purge_network_share_ops();

SELECT is((SELECT count(*)::int FROM public.network_share_ops
            WHERE id IN ('11700000-0000-0000-0000-000000000208', '11700000-0000-0000-0000-000000000209')), 0,
  'the purge removes settled rows past 90 days, done and reverted alike');
SELECT is((SELECT count(*)::int FROM public.network_share_ops WHERE id = '11700000-0000-0000-0000-000000000210'), 1,
  'and keeps a younger settled row');
SELECT is((SELECT count(*)::int FROM public.network_share_ops WHERE id = '11700000-0000-0000-0000-000000000201'), 1,
  'and a pending row however old it is');
SELECT throws_ok($$ SELECT public.purge_network_share_ops(interval '1 hour') $$, 'P0001',
  'purge_network_share_ops: the retention must be at least a day', 'it refuses a retention under a day');
SELECT ok(
  to_regclass('cron.job') IS NULL
  OR (SELECT count(*) = 1 FROM cron.job WHERE jobname = 'wilson-purge-network-share-ops' AND schedule = '50 4 * * *'),
  'the purge is scheduled at 04:50 where pg_cron is present');

SELECT * FROM finish();
ROLLBACK;
