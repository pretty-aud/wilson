-- =============================================================================
-- 41_workspace_model_overrides.sql — Session 20: the workspace tier
-- (migration 0031).
--
-- A company admin's model choice, beating the platform default for that
-- company only. Three properties are pinned.
--
-- (1) D4 IS ENFORCED IN THE DATABASE, not just in the picker. model_id FKs
--     platform_approved_models, so an admin cannot store a model the operator
--     has not approved whatever client they use. Probe 7 is that guarantee.
--     Restricting the dropdown is cosmetic; this is the part with teeth.
--
-- (2) Ordinary members READ but do not WRITE. Resolution runs on every AI
--     call for every member, so a read-gated-to-admins table would break
--     generation for everyone else — but only an admin chooses.
--
-- (3) Tenancy. An admin of workspace A cannot write workspace B's row and
--     cannot see it either.
--
-- KNOWN LIMIT, asserted nowhere because it is not fixable at this layer:
-- current_app_role() is a JWT claim (0008:32-42), so a just-demoted admin
-- keeps write access until their token refreshes. has_active_membership()
-- closes the deactivated case, which is the one 0020 was written to fix.
-- =============================================================================
BEGIN;

SELECT plan(14);

SELECT * FROM tests.rls_setup();

-- 1: the object exists.
SELECT has_table('public'::name, 'workspace_model_overrides'::name,
  'workspace_model_overrides table exists');

-- 2: RLS on and forced.
SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.workspace_model_overrides'::regclass),
  'workspace_model_overrides has RLS enabled and forced'
);

-- 3: no FOR ALL policy. 0029 exists specifically to undo one, because a broad
-- FOR ALL arm ORs with every narrow arm beside it and silently wins.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workspace_model_overrides'
      AND cmd = 'ALL'),
  0, 'workspace_model_overrides has no FOR ALL policy'
);

-- 4: anon reaches nothing.
SELECT ok(
  NOT has_table_privilege('anon', 'public.workspace_model_overrides', 'SELECT'),
  'anon cannot read workspace overrides'
);

-- 5: the FK that makes D4 real.
SELECT is(
  (SELECT count(*)::int FROM pg_constraint
    WHERE conrelid = 'public.workspace_model_overrides'::regclass
      AND contype = 'f'
      AND confrelid = 'public.platform_approved_models'::regclass),
  1, 'workspace_model_overrides FKs the approved catalogue'
);

-- 6: effort must NOT appear here — it is operator-only by decision, and a
-- column added here would hand a company admin the Edge-deadline lever.
SELECT is(
  (SELECT count(*)::int FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workspace_model_overrides'
      AND column_name = 'effort'),
  0, 'workspace_model_overrides carries no effort column (operator-only by decision)'
);

-- ── As an ADMIN of workspace A ──────────────────────────────────────────────

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

-- 7: THE D4 PROBE. An unapproved model is refused by the database, not by
-- the dropdown. If this ever passes, D4 is worth exactly as much as the
-- client-side picker restricting it — which is to say nothing.
SELECT throws_ok(
  $$ INSERT INTO public.workspace_model_overrides (workspace_id, registry_key, model_id)
     VALUES ('11111111-1111-1111-1111-111111111111', 'dog.fullDeck', 'claude-not-approved-9') $$,
  'insert or update on table "workspace_model_overrides" violates foreign key constraint "workspace_model_overrides_model_id_fkey"',
  'an admin cannot store a model the operator has not approved'
);

-- 8: tenancy — writing another company's row is refused by the policy.
SELECT throws_ok(
  $$ INSERT INTO public.workspace_model_overrides (workspace_id, registry_key, model_id)
     VALUES ('22222222-2222-2222-2222-222222222222', 'dog.fullDeck', 'claude-opus-5') $$,
  'new row violates row-level security policy for table "workspace_model_overrides"',
  'an admin cannot set another company''s override'
);

-- 9: the happy path.
SELECT lives_ok(
  $$ INSERT INTO public.workspace_model_overrides (workspace_id, registry_key, model_id)
     VALUES ('11111111-1111-1111-1111-111111111111', 'dog.fullDeck', 'claude-opus-5') $$,
  'an admin sets their own company''s override'
);

-- 10: and can change it.
SELECT lives_ok(
  $$ UPDATE public.workspace_model_overrides SET model_id = 'claude-sonnet-5'
      WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
        AND registry_key = 'dog.fullDeck' $$,
  'an admin changes their own company''s override'
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

-- 11: members READ — resolution needs this on every AI call they make.
SELECT is(
  (SELECT model_id FROM public.workspace_model_overrides
    WHERE registry_key = 'dog.fullDeck'),
  'claude-sonnet-5',
  'an ordinary member reads their company''s override'
);

-- 12: but does not write.
SELECT throws_ok(
  $$ INSERT INTO public.workspace_model_overrides (workspace_id, registry_key, model_id)
     VALUES ('11111111-1111-1111-1111-111111111111', 'otter.course', 'claude-opus-5') $$,
  'new row violates row-level security policy for table "workspace_model_overrides"',
  'a non-admin member cannot set a company override'
);

-- ── As an admin of workspace B ──────────────────────────────────────────────

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

-- 13: the other company's row is invisible, not an error. A leak here would
-- be silent — company B would simply see A's choices listed as its own.
SELECT is(
  (SELECT count(*)::int FROM public.workspace_model_overrides),
  0, 'an admin of another company sees none of workspace A''s overrides'
);

-- An RLS-refused UPDATE affects zero rows instead of raising. This statement
-- therefore SUCCEEDS while changing nothing, which is exactly the hazard: a
-- client that checks only for an error concludes the write landed. Run it as
-- workspace B's admin, then read the row back as the runner.
UPDATE public.workspace_model_overrides SET model_id = 'claude-opus-5'
 WHERE registry_key = 'dog.fullDeck';

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- 14
SELECT is(
  (SELECT model_id FROM public.workspace_model_overrides
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
      AND registry_key = 'dog.fullDeck'),
  'claude-sonnet-5',
  'a cross-company UPDATE raises no error and changes nothing (the silent-zero-rows hazard)'
);

SELECT * FROM finish();
ROLLBACK;
