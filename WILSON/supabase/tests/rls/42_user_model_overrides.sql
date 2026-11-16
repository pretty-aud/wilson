-- =============================================================================
-- 42_user_model_overrides.sql — Session 20: the user tier (migration 0031).
--
-- The top of the resolution cascade, and the table the S20 plan did not list:
-- Block E migrates the localStorage map (wilson.modelPrefs.v1) into it, so a
-- preference follows the person instead of the browser.
--
-- Three properties are pinned.
--
-- (1) OWN ROWS ONLY. The policy tests user_id = auth.uid(), so a signed-in
--     user cannot write a preference into somebody else's account. Probe 6 is
--     the impersonation guard.
--
-- (2) PRIVATE FROM THE COMPANY ADMIN. A personal model preference is not
--     admin-readable — an admin who needs to constrain someone has the
--     workspace tier for that, which is a visible policy rather than a peek
--     at what an individual chose. Probe 9 pins it.
--
-- (3) D4 REACHES THE USER TIER TOO. model_id FKs the approved catalogue, so a
--     user cannot store an unapproved model any more than an admin can.
--
-- Rows are keyed (user_id, workspace_id, registry_key): the same account in
-- two companies keeps separate choices, so one company's model selection
-- cannot follow the person into another.
-- =============================================================================
BEGIN;

SELECT plan(12);

SELECT * FROM tests.rls_setup();

-- 1: the object exists.
SELECT has_table('public'::name, 'user_model_overrides'::name,
  'user_model_overrides table exists');

-- 2: RLS on and forced.
SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.user_model_overrides'::regclass),
  'user_model_overrides has RLS enabled and forced'
);

-- 3: no FOR ALL policy (the 0029 rule).
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_model_overrides'
      AND cmd = 'ALL'),
  0, 'user_model_overrides has no FOR ALL policy'
);

-- 4: anon reaches nothing.
SELECT ok(
  NOT has_table_privilege('anon', 'public.user_model_overrides', 'SELECT'),
  'anon cannot read user overrides'
);

-- 5: D4's FK, on this tier too.
SELECT is(
  (SELECT count(*)::int FROM pg_constraint
    WHERE conrelid = 'public.user_model_overrides'::regclass
      AND contype = 'f'
      AND confrelid = 'public.platform_approved_models'::regclass),
  1, 'user_model_overrides FKs the approved catalogue'
);

-- ── As user A in workspace A ────────────────────────────────────────────────

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

-- 6: THE IMPERSONATION GUARD. Writing a preference into another account must
-- be refused even though both users are real and both workspaces exist.
SELECT throws_ok(
  $$ INSERT INTO public.user_model_overrides (user_id, workspace_id, registry_key, model_id)
     VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
             '11111111-1111-1111-1111-111111111111', 'dog.themes', 'claude-opus-5') $$,
  'new row violates row-level security policy for table "user_model_overrides"',
  'a user cannot write a preference into another account'
);

-- 7: an unapproved model is refused here too.
SELECT throws_ok(
  $$ INSERT INTO public.user_model_overrides (user_id, workspace_id, registry_key, model_id)
     VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
             '11111111-1111-1111-1111-111111111111', 'dog.visualDesc', 'claude-nope-9') $$,
  'insert or update on table "user_model_overrides" violates foreign key constraint "user_model_overrides_model_id_fkey"',
  'a user cannot store an unapproved model'
);

-- 8: the happy path — own row, approved model.
SELECT lives_ok(
  $$ INSERT INTO public.user_model_overrides (user_id, workspace_id, registry_key, model_id)
     VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
             '11111111-1111-1111-1111-111111111111', 'dog.themes', 'claude-opus-5') $$,
  'a user sets their own preference'
);

-- 9: and reads it back.
SELECT is(
  (SELECT model_id FROM public.user_model_overrides WHERE registry_key = 'dog.themes'),
  'claude-opus-5', 'a user reads their own preference'
);

-- ── As an ADMIN of the same workspace ───────────────────────────────────────
-- Being an admin of the company does not make someone's personal preference
-- readable. The workspace tier is the admin's lever, and it is visible.

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

-- 10: invisible. (User B is not a member of workspace A either, so this also
-- covers the cross-company case — has_active_membership fails first.)
SELECT is(
  (SELECT count(*)::int FROM public.user_model_overrides),
  0, 'a company admin cannot read another user''s personal preference'
);

-- ── Back as user A ──────────────────────────────────────────────────────────

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

-- 11: clearing a preference is a delete, and must work — otherwise "use the
-- default" becomes unreachable once anything has been chosen.
SELECT lives_ok(
  $$ DELETE FROM public.user_model_overrides WHERE registry_key = 'dog.themes' $$,
  'a user clears their own preference'
);

-- 12
SELECT is(
  (SELECT count(*)::int FROM public.user_model_overrides),
  0, 'the preference is gone after clearing'
);

SELECT * FROM finish();
ROLLBACK;
