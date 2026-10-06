-- =============================================================================
-- 39_platform_approved_models.sql — Session 20: the operator-curated model
-- catalogue (migration 0031).
--
-- Two things are pinned here, and they pull in opposite directions.
--
-- (1) EVERY authenticated user can READ this table, regardless of company.
--     D4 says admins and users may only choose from operator-approved models,
--     and a company cannot choose from a list it cannot see. Its SELECT policy
--     is `USING (true)` — the first unscoped read policy in the schema — so
--     the probes below check a member of workspace B reads the same rows as a
--     member of workspace A. If a later migration "tidies" this into a
--     workspace-scoped predicate, every picker outside the operator's own
--     company silently empties.
--
-- (2) NOBODY writes it from a client — not even a platform operator. D5 says
--     a model id must be validated against Anthropic before it can be saved,
--     and that validation lives in the operator-models Edge Function. An
--     operator INSERT policy here would make it decorative: one PostgREST
--     call would put an unvalidated id into every company's picker. This is
--     the same rule 35_platform_audit.sql:194-202 pins for the audit stream,
--     and probe 15 is its exact counterpart.
--
-- login_as sets no app_role claim (0005), so probes needing one build the
-- claims by hand (the 37_workspace_write_lockdown.sql idiom). De-auth before
-- every mid-file role change with claims-reset + RESET ROLE.
-- =============================================================================
BEGIN;

SELECT plan(16);

SELECT * FROM tests.rls_setup();

-- 1: the object exists.
SELECT has_table('public'::name, 'platform_approved_models'::name,
  'platform_approved_models table exists');

-- 2-4: RLS on and forced, exactly one policy, and it is a read.
SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.platform_approved_models'::regclass),
  'platform_approved_models has RLS enabled and forced'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'platform_approved_models'),
  1, 'platform_approved_models has exactly one policy'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'platform_approved_models'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE')),
  0, 'platform_approved_models has no client write policy (D5 stays enforceable)'
);

-- 5-6: the privilege layer, separately from the policy layer. 0011's
-- ALTER DEFAULT PRIVILEGES grants anon and authenticated ALL on every table
-- created after it, so this is not belt-and-braces — without the REVOKEs in
-- 0031 the policy above is the only thing standing up, and a policy-only
-- assertion would pass while the hole is open.
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.platform_approved_models', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.platform_approved_models', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.platform_approved_models', 'DELETE'),
  'authenticated holds no write privilege on the catalogue'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.platform_approved_models', 'SELECT'),
  'anon cannot read the catalogue'
);

-- 7: seeded. Both override tables FK this one, so an empty catalogue would
-- make every picker empty and every override unsavable on the day it ships.
SELECT ok(
  (SELECT count(*) FROM public.platform_approved_models WHERE retired_at IS NULL) >= 4,
  'the catalogue ships with at least 4 live models'
);

-- 8: the id shape is checked in the database, not only in the client.
SELECT throws_ok(
  $$ INSERT INTO public.platform_approved_models (model_id, label)
     VALUES ('gpt-4', 'Nope') $$,
  'new row for relation "platform_approved_models" violates check constraint "platform_approved_models_model_id_check"',
  'a non-Claude model id is refused by the CHECK'
);

-- ── As a plain (non-admin) member of workspace A ────────────────────────────

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

-- 9: an ordinary user reads it. This is the D4 half that makes pickers work.
SELECT ok(
  (SELECT count(*) FROM public.platform_approved_models) >= 4,
  'an ordinary member reads the catalogue'
);

-- 10-12: and cannot change it, by any verb.
SELECT throws_ok(
  $$ INSERT INTO public.platform_approved_models (model_id, label)
     VALUES ('claude-sneaky-1', 'Sneaky') $$,
  'permission denied for table platform_approved_models',
  'a member cannot add a model to the catalogue'
);
SELECT throws_ok(
  $$ UPDATE public.platform_approved_models SET label = 'renamed' $$,
  'permission denied for table platform_approved_models',
  'a member cannot rename a catalogue entry'
);
SELECT throws_ok(
  $$ DELETE FROM public.platform_approved_models $$,
  'permission denied for table platform_approved_models',
  'a member cannot delete a catalogue entry'
);

-- ── As a member of a DIFFERENT company ──────────────────────────────────────
-- The catalogue is platform-wide. If this ever becomes workspace-scoped, every
-- company except the operator's own gets an empty picker and no error.

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '22222222-2222-2222-2222-222222222222',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- 13
SELECT ok(
  (SELECT count(*) FROM public.platform_approved_models) >= 4,
  'a member of another workspace reads the same catalogue'
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

-- 14
SELECT ok(
  public.is_platform_operator(),
  'the fixture user is now a platform operator'
);

-- 15: THE PROBE THIS SUITE EXISTS FOR. If this ever passes, D5's Anthropic
-- validation has become optional and an unvalidated model id can reach every
-- company's picker with a single PostgREST call.
SELECT throws_ok(
  $$ INSERT INTO public.platform_approved_models (model_id, label)
     VALUES ('claude-operator-forged-1', 'Forged') $$,
  'permission denied for table platform_approved_models',
  'even a platform operator cannot write the catalogue directly (D5 must go through operator-models)'
);

-- ── Retirement is soft ──────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

UPDATE public.platform_approved_models
   SET retired_at = now()
 WHERE model_id = 'claude-sonnet-4-6';

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

-- 16: the row stays readable after retirement. Overrides FK this table, so a
-- hard delete would either fail or orphan a company's saved choice; retiring
-- must drop it from the pickers without breaking resolution for anyone who
-- already had it selected.
SELECT is(
  (SELECT count(*)::int FROM public.platform_approved_models
    WHERE model_id = 'claude-sonnet-4-6' AND retired_at IS NOT NULL),
  1, 'a retired model is still readable, so existing overrides keep resolving'
);

SELECT * FROM finish();
ROLLBACK;
