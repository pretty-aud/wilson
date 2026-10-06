-- =============================================================================
-- 36_edge_rate_limits.sql — Session 15: the durable Edge-Function rate
-- limiter (migration 0028, MASTER_PLAN §6 #16 / TPN AS-3.8).
--
-- What this replaces: every limiter shipped so far is an in-memory Map
-- inside ONE Deno isolate (ai-proxy's AI_PROXY_RPM window,
-- provision-workspace's invite budget). The effective limit was therefore
-- RPM × however many isolates the platform happened to be running, and it
-- reset on every cold start. This one is a row in Postgres, so every
-- isolate shares it.
--
-- Pinned here: the counter actually counts and refuses past the limit;
-- subjects and buckets have independent budgets (a noisy workspace must not
-- lock out a quiet one); a nonsensical limit fails CLOSED rather than
-- silently unlimited (the NaN-guard lesson from ai-proxy, moved into the
-- function so no caller can get it wrong); and neither the table nor the
-- function is reachable from a client role — request volume per workspace
-- is itself information worth withholding.
--
-- The counting probes use a ONE-YEAR window on purpose. The window is
-- derived from clock_timestamp(), so a short window could in principle
-- straddle a boundary mid-test and turn a deterministic assertion into a
-- once-in-a-while flake; a year-long window makes that impossible in
-- practice while exercising exactly the same code path.
-- =============================================================================
BEGIN;

SELECT plan(16);

SELECT * FROM tests.rls_setup();

-- 1-3: the objects exist, with the signatures the Edge Functions call.
SELECT has_table('public'::name, 'edge_rate_limits'::name,
  'edge_rate_limits table exists');
SELECT has_function('public', 'fn_rate_limit_hit',
  ARRAY['text', 'text', 'integer', 'integer'],
  'fn_rate_limit_hit(text, text, integer, integer) exists');
SELECT has_function('public', 'purge_edge_rate_limits', ARRAY['interval'],
  'purge_edge_rate_limits(interval) exists');

-- 4-5: service-role-only shape — RLS on and forced, zero policies.
SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.edge_rate_limits'::regclass),
  'edge_rate_limits has RLS enabled and forced'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'edge_rate_limits'),
  0, 'edge_rate_limits has no policies (service_role only)'
);

-- 6-8: privileges. The function is the only intended door, and it is
-- service_role's alone — a client that could call it could also burn another
-- workspace's budget by passing that workspace's id as the subject.
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.edge_rate_limits', 'SELECT'),
  'authenticated has no SELECT privilege on edge_rate_limits'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.fn_rate_limit_hit(text,text,int,int)', 'EXECUTE'),
  'authenticated cannot execute fn_rate_limit_hit()'
);
SELECT ok(
  has_function_privilege('service_role', 'public.fn_rate_limit_hit(text,text,int,int)', 'EXECUTE'),
  'service_role can execute fn_rate_limit_hit()'
);

-- ── Counting behaviour (as the runner) ──────────────────────────────────────

-- 9-11: three calls at limit 3 are all allowed; the fourth is refused. The
-- current call is counted BEFORE the comparison, so p_limit is inclusive —
-- "3 per window" means the third call still succeeds.
SELECT ok(
  NOT public.fn_rate_limit_hit('tap-bucket', 'subject-1', 3, 31536000),
  'first call is under the limit'
);
SELECT ok(
  NOT public.fn_rate_limit_hit('tap-bucket', 'subject-1', 3, 31536000)
  AND NOT public.fn_rate_limit_hit('tap-bucket', 'subject-1', 3, 31536000),
  'calls two and three are still under the limit'
);
SELECT ok(
  public.fn_rate_limit_hit('tap-bucket', 'subject-1', 3, 31536000),
  'the fourth call is refused'
);

-- 12: a different subject has its own budget. Without this, one runaway
-- workspace would rate-limit every other tenant on the platform.
SELECT ok(
  NOT public.fn_rate_limit_hit('tap-bucket', 'subject-2', 3, 31536000),
  'a different subject has an independent budget'
);

-- 13: and so does a different bucket, so adding a limiter to a new endpoint
-- cannot starve an existing one.
SELECT ok(
  NOT public.fn_rate_limit_hit('other-bucket', 'subject-1', 3, 31536000),
  'a different bucket has an independent budget'
);

-- 14: a nonsensical limit fails CLOSED. Number('60rpm') is NaN, and the
-- in-memory limiter this replaces would have been silently switched off by
-- exactly that; here a bad limit refuses the request instead.
SELECT ok(
  public.fn_rate_limit_hit('tap-bucket', 'subject-3', 0, 31536000)
  AND public.fn_rate_limit_hit('tap-bucket', 'subject-3', 5, 0)
  AND public.fn_rate_limit_hit('tap-bucket', 'subject-3', NULL, 60),
  'a zero/NULL limit or window refuses rather than allowing everything'
);

-- 15: retention sweep. window_start is seeded relative to now() so the
-- frozen-now()-inside-one-transaction trap (S14) does not apply — both sides
-- of the comparison move together.
--
-- The purge runs as its OWN statement, deliberately: SQL does not guarantee
-- the evaluation order of the operands of AND, so folding the call and the
-- "row is gone" assertion into one expression can evaluate the assertion
-- first and fail against a row the purge is about to delete.
INSERT INTO public.edge_rate_limits (bucket, subject, window_start, hits)
VALUES ('tap-bucket', 'ancient', now() - INTERVAL '3 days', 99);

SELECT public.purge_edge_rate_limits(INTERVAL '1 day');

SELECT is(
  (SELECT count(*)::int FROM public.edge_rate_limits
    WHERE bucket = 'tap-bucket' AND subject = 'ancient'),
  0, 'purge_edge_rate_limits drops windows older than the retention interval'
);

-- ── As a workspace admin ────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

-- 16: the counters are invisible to clients — they leak per-workspace
-- request volume, which is business information about another tenant.
SELECT throws_ok(
  $$ SELECT count(*) FROM public.edge_rate_limits $$,
  'permission denied for table edge_rate_limits',
  'authenticated cannot read edge_rate_limits'
);

SELECT * FROM finish();
ROLLBACK;
