-- =============================================================================
-- 40_platform_model_defaults.sql — Session 20: the platform tier
-- (migration 0031).
--
-- The bottom of the three override tiers: what every company gets when
-- neither it nor the user has chosen anything. Two properties matter.
--
-- (1) It is READ by everyone and WRITTEN by nobody from a client. Resolution
--     runs on every AI call, in every company, so an ordinary member must be
--     able to read this table — but the operator console writes it through a
--     service_role Edge Function, exactly as it does the catalogue.
--
-- (2) It carries the ONLY `effort` column in the system, and that is a
--     decision rather than an accident (Audrey, 2026-08-02). ai-proxy streams
--     through an Edge Function; S19 MEASURED D.O.G.'s full deck at 137.9s with
--     no effort field against 69.1s at `medium`. A company admin cannot see
--     that trade-off, so they do not get the lever — they choose the model,
--     the platform chooses how hard it thinks. If an `effort` column ever
--     appears on workspace_model_overrides or user_model_overrides, that
--     decision has been reversed by accident.
-- =============================================================================
BEGIN;

SELECT plan(13);

SELECT * FROM tests.rls_setup();

-- 1: the object exists.
SELECT has_table('public'::name, 'platform_model_defaults'::name,
  'platform_model_defaults table exists');

-- 2: effort lives here.
SELECT has_column('public'::name, 'platform_model_defaults'::name, 'effort'::name,
  'platform_model_defaults carries the effort column');

-- 3-5: RLS on and forced, one policy, and it is a read.
SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.platform_model_defaults'::regclass),
  'platform_model_defaults has RLS enabled and forced'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'platform_model_defaults'),
  1, 'platform_model_defaults has exactly one policy'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'platform_model_defaults'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE')),
  0, 'platform_model_defaults has no client write policy'
);

-- 6-7: the privilege layer, asserted separately from the policy layer —
-- 0011 grants ALL on every new table and only the REVOKE in 0031 takes it away.
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.platform_model_defaults', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.platform_model_defaults', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.platform_model_defaults', 'DELETE'),
  'authenticated holds no write privilege on the platform defaults'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.platform_model_defaults', 'SELECT'),
  'anon cannot read the platform defaults'
);

-- 8: effort is constrained to the five levels aiModels.js:294 accepts.
-- A typo here would reach Anthropic as an invalid request body.
SELECT throws_ok(
  $$ INSERT INTO public.platform_model_defaults (registry_key, effort)
     VALUES ('dog.pageOutline', 'ludicrous') $$,
  'new row for relation "platform_model_defaults" violates check constraint "platform_model_defaults_effort_check"',
  'an unknown effort level is refused by the CHECK'
);

-- 9: D4 reaches the platform tier too — Audrey cannot pin a default to a
-- model she has not first added to the catalogue.
SELECT throws_ok(
  $$ INSERT INTO public.platform_model_defaults (registry_key, model_id)
     VALUES ('dog.imagePrompts', 'claude-nope-9') $$,
  'insert or update on table "platform_model_defaults" violates foreign key constraint "platform_model_defaults_model_id_fkey"',
  'a platform default cannot point at an unapproved model'
);

-- 10: a valid row is accepted, so the constraints above are not simply
-- refusing everything.
SELECT lives_ok(
  $$ INSERT INTO public.platform_model_defaults (registry_key, model_id, effort)
     VALUES ('dog.fullDeck', 'claude-sonnet-5', 'medium') $$,
  'an approved model with a valid effort level is accepted'
);

-- ── As a plain (non-admin) member ───────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 11: resolution needs this on every AI call, so it must be readable.
SELECT is(
  (SELECT count(*)::int FROM public.platform_model_defaults
    WHERE registry_key = 'dog.fullDeck'),
  1, 'an ordinary member reads the platform default'
);

-- 12: but cannot set one.
SELECT throws_ok(
  $$ INSERT INTO public.platform_model_defaults (registry_key, model_id)
     VALUES ('otter.course', 'claude-opus-5') $$,
  'permission denied for table platform_model_defaults',
  'a member cannot set a platform default'
);

-- ── As a platform operator ──────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

INSERT INTO public.platform_operators (user_id)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
ON CONFLICT (user_id) DO NOTHING;

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- 13: not even the operator, for the same reason as the catalogue — the
-- console writes through operator-models under service_role so every change
-- is validated and leaves an audit certificate.
SELECT throws_ok(
  $$ INSERT INTO public.platform_model_defaults (registry_key, model_id)
     VALUES ('otter.course', 'claude-opus-5') $$,
  'permission denied for table platform_model_defaults',
  'even a platform operator cannot set a default directly'
);

SELECT * FROM finish();
ROLLBACK;
