-- =============================================================================
-- 57_user_settings.sql — Session 31: personal settings per PERSON (0046).
--
-- What it PINS:
--   1. Own row only, on all four verbs, with NO admin bypass. These are the
--      user's own edited AI prompts — prose they wrote, not a business record,
--      and a company admin has no read on them.
--   2. 🚨 NO WORKSPACE DEPENDENCE (probe 14), for the same reason and with the
--      same citation as 56_user_pets.sql: 0020:18-21, the self-row exception.
--      One set of settings per person, everywhere.
--   3. One row per person by PRIMARY KEY.
--   4. Both JSONB columns must be OBJECTS — the client spreads them, and an
--      array or scalar would throw at the call site instead of the boundary.
--
-- The sibling suite 56 carries the fuller commentary; this one is deliberately
-- the same shape so a reader can diff them.
-- =============================================================================

BEGIN;

SELECT plan(21);

SELECT * FROM tests.rls_setup();

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'user_d@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Both in workspace A: per-user isolation must be provable without tenancy
-- doing the work.
INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','user','user_c','User C',true),
  ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','user','user_d','User D',true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- ── structure ───────────────────────────────────────────────────────────────
SELECT has_table('public', 'user_settings', 'user_settings table exists');

SELECT ok(
  (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.user_settings'::regclass),
  'user_settings has FORCE ROW LEVEL SECURITY');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname='public' AND tablename='user_settings' AND cmd='ALL'),
  0, 'no FOR ALL policy arm');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname='public' AND tablename='user_settings'),
  4, 'user_settings carries exactly four policies, one per verb');

SELECT has_trigger('public', 'user_settings', 'trg_user_settings_touch',
  'updated_at is stamped by trigger');

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema='public' AND table_name='user_settings'
       AND grantee IN ('anon', 'PUBLIC')
  ),
  'neither anon nor PUBLIC holds any privilege on user_settings');

-- ── user_c stores their prompts ─────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

-- user_id OMITTED, exactly as the client omits it.
SELECT lives_ok(
  $$INSERT INTO public.user_settings (prompts, agent_prompt_overrides)
    VALUES ('{"companion":"be warm and brief","mc":"four options"}'::jsonb,
            '{"otter":{"systemPromptOverride":"cite sources"}}'::jsonb)$$,
  'a member can store their own settings');

SELECT is(
  (SELECT user_id::text FROM public.user_settings LIMIT 1),
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'the database stamps the owner from the JWT, not the client');

SELECT throws_ok(
  $$INSERT INTO public.user_settings (user_id, prompts)
    VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', '{"companion":"stolen"}'::jsonb)$$,
  'new row violates row-level security policy for table "user_settings"',
  'a member cannot store settings on behalf of someone else');

-- ── user_d has their own ────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd',
                      '11111111-1111-1111-1111-111111111111');

SELECT lives_ok(
  $$INSERT INTO public.user_settings (prompts)
    VALUES ('{"companion":"be terse"}'::jsonb)$$,
  'a second member in the SAME workspace stores their own settings independently');

-- Presence control: this reader DOES see a row, so the zero probes cannot pass
-- vacuously on an empty table.
SELECT is((SELECT count(*)::int FROM public.user_settings),
          1, 'each member sees exactly one settings row — their own (presence control)');

SELECT is((SELECT prompts->>'companion' FROM public.user_settings),
          'be terse', 'and it is THEIR prompt text, not the other member''s');

-- ── no admin bypass ─────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT is((SELECT count(*)::int FROM public.user_settings),
          0, 'a workspace ADMIN cannot read a member''s prompt text');

-- ── 🚨 no workspace, still your settings ────────────────────────────────────
-- Claims carry `sub` and nothing else. Every other policied table in this
-- schema returns zero rows here. If a later session adds the workspace clause
-- its neighbours all have, THIS is the probe that fails.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','cccccccc-cccc-cccc-cccc-cccccccccccc','role','authenticated'
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT is((SELECT prompts->>'companion' FROM public.user_settings),
          'be warm and brief',
          'a user with NO workspace in their JWT still reads their own settings');

-- ── editable, and only your own ─────────────────────────────────────────────
-- Deliberately still running under the workspace-less claims set above, so
-- this proves a user with no workspace can WRITE their settings as well as read
-- them — the half a read-only probe would miss.
SELECT lives_ok(
  $$UPDATE public.user_settings
       SET prompts = prompts || '{"companion":"be warmer"}'::jsonb$$,
  'a member with NO workspace can still update their own settings');

-- The statement above was unqualified; assert the VALUE on the other row,
-- because an RLS-refused UPDATE raises nothing and affects zero rows.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT prompts->>'companion' FROM public.user_settings
    WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'be terse',
  'an unqualified UPDATE could not reach the other member''s settings');

-- ── the JSONB columns must be objects ───────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

SELECT throws_ok(
  $$UPDATE public.user_settings SET prompts = '["not","an","object"]'::jsonb$$,
  'new row for relation "user_settings" violates check constraint "user_settings_prompts_chk"',
  'prompts must be an object — the client spreads it');

SELECT throws_ok(
  $$INSERT INTO public.user_settings (prompts) VALUES ('{}'::jsonb)$$,
  'duplicate key value violates unique constraint "user_settings_pkey"',
  'one settings row per person is a PRIMARY KEY, not a convention');

-- ── a person can discard their own ──────────────────────────────────────────
SELECT lives_ok(
  $$DELETE FROM public.user_settings$$,
  'a member can delete their own settings');

SELECT is((SELECT count(*)::int FROM public.user_settings),
          0, 'and they are gone for them');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- Scoped to user_d like the :161 probe above, not count(*): an unscoped
-- postgres read counts REAL rows on a live env (suite 56's twin probe
-- failed exactly that way in S33, have:2, the day dev carried an actual
-- pet — this table's writer shipped in S31 and is one sign-in away from
-- the same decay).
SELECT is((SELECT count(*)::int FROM public.user_settings
            WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
          1, 'the other member''s settings survived the unqualified DELETE');

SELECT * FROM finish();

ROLLBACK;
