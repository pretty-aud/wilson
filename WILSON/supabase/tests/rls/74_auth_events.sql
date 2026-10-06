-- =============================================================================
-- 74_auth_events.sql — Track B, bundle B2: authentication events (migration 0070).
--
-- Pins the whole of "sign-in, MFA, sign-out and timeout events are written
-- server-side and read only by the people entitled to them":
--   * the grants — anon touches nothing, a client role cannot run a hook,
--     supabase_auth_admin (GoTrue) can, and nobody but service_role purges
--   * the two GoTrue hooks log the right row and ALWAYS answer "continue"
--   * a client row is stamped from the caller's own session: a forged user_id,
--     workspace or address in the body is overwritten, never trusted
--   * a client cannot write a hook row, a failure, or a server-only kind, and
--     cannot update or delete anything
--   * read scope — a member sees only their own rows; an admin sees their
--     company's rows and the hook rows of its members and NOT another
--     company's; an operator sees everything; anon sees nothing
--   * the retention purge
--
-- 🚨 tests.login_as() sets NO app_role, so every admin probe builds its claims
-- by hand (the suite-70 lesson). A probe that forgets silently tests a plain
-- member, which for a read-scope suite would pass for the wrong reason.
-- =============================================================================

BEGIN;

SELECT plan(35);

SELECT * FROM tests.rls_setup();

-- ── fixtures (runner: RLS bypassed) ─────────────────────────────────────────
-- user_a: admin of ws_a (rls_setup)     user_b: admin of ws_b (rls_setup)
-- user_c: plain member of ws_a          one live GoTrue session for user_c,
--                                       with an address and a user agent
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO auth.sessions (id, user_id, created_at, updated_at, ip, user_agent)
VALUES ('5e551011-0000-4000-8000-000000000074',
        'cccccccc-cccc-cccc-cccc-cccccccccccc', now(), now(),
        '203.0.113.74'::inet, 'pgTAP suite 74')
ON CONFLICT (id) DO NOTHING;

-- ── structure + grants ──────────────────────────────────────────────────────
SELECT has_table('public', 'auth_events', 'auth_events table exists');

SELECT ok(
  (SELECT c.relrowsecurity AND c.relforcerowsecurity
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'auth_events'),
  'auth_events is under FORCE ROW LEVEL SECURITY'
);

SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.auth_events', 'SELECT') OR
    has_table_privilege('anon', 'public.auth_events', 'INSERT') OR
    has_table_privilege('anon', 'public.auth_events', 'UPDATE') OR
    has_table_privilege('anon', 'public.auth_events', 'DELETE')
  ),
  'anon holds no table privilege on auth_events'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.auth_events', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.auth_events', 'DELETE'),
  'authenticated holds no UPDATE or DELETE privilege on auth_events'
);

SELECT ok(
  NOT has_function_privilege('anon',          'public.hook_password_verification_attempt(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.hook_password_verification_attempt(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon',          'public.hook_mfa_verification_attempt(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.hook_mfa_verification_attempt(jsonb)', 'EXECUTE'),
  'neither hook is executable by anon or authenticated (#44)'
);

SELECT ok(
  has_function_privilege('supabase_auth_admin', 'public.hook_password_verification_attempt(jsonb)', 'EXECUTE')
  AND has_function_privilege('supabase_auth_admin', 'public.hook_mfa_verification_attempt(jsonb)', 'EXECUTE'),
  'both hooks are executable by supabase_auth_admin (GoTrue)'
);

SELECT ok(
  NOT has_function_privilege('anon',          'public.purge_auth_events(interval)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.purge_auth_events(interval)', 'EXECUTE')
  AND NOT has_function_privilege('anon',          'public.is_member_of_current_workspace(uuid)', 'EXECUTE'),
  'purge_auth_events and the membership helper are out of reach of anon (and the purge of authenticated)'
);

-- ── the hooks (runner, as GoTrue would call them) ───────────────────────────
SELECT is(
  public.hook_password_verification_attempt(
    '{"user_id":"cccccccc-cccc-cccc-cccc-cccccccccccc","valid":false}'::jsonb) ->> 'decision',
  'continue',
  'password hook: a failed check answers continue'
);

SELECT is(
  (SELECT count(*)::int FROM public.auth_events
    WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
      AND kind = 'sign_in' AND outcome = 'failure' AND source = 'gotrue_hook'),
  1,
  'password hook: the failed check is one sign_in/failure row from gotrue_hook'
);

SELECT is(
  public.hook_password_verification_attempt(
    '{"user_id":"cccccccc-cccc-cccc-cccc-cccccccccccc","valid":true}'::jsonb) ->> 'decision',
  'continue',
  'password hook: a successful check answers continue'
);

SELECT is(
  (SELECT count(*)::int FROM public.auth_events
    WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
      AND kind = 'sign_in' AND outcome = 'success' AND source = 'gotrue_hook'),
  1,
  'password hook: the successful check is one sign_in/success row'
);

SELECT is(
  public.hook_mfa_verification_attempt(
    '{"factor_id":"f0f0f0f0-0000-4000-8000-000000000001","factor_type":"totp","user_id":"cccccccc-cccc-cccc-cccc-cccccccccccc","valid":false}'::jsonb) ->> 'decision',
  'continue',
  'mfa hook: a failed challenge answers continue'
);

SELECT is(
  (SELECT count(*)::int FROM public.auth_events
    WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
      AND kind = 'mfa_verify' AND outcome = 'failure' AND factor_type = 'totp'
      AND context ->> 'factor_id' = 'f0f0f0f0-0000-4000-8000-000000000001'),
  1,
  'mfa hook: the failed challenge is one mfa_verify/failure row carrying the factor'
);

SELECT is(
  public.hook_password_verification_attempt('{}'::jsonb) ->> 'decision',
  'continue',
  'password hook: a payload without a user still answers continue'
);

SELECT is(
  (SELECT count(*)::int FROM public.auth_events WHERE user_id IS NULL),
  0,
  'password hook: a payload without a user logs nothing'
);

-- one hook row for user_b (another company) and one for user_a (an admin of
-- user_c's company), for the read-scope probes below
SELECT public.hook_password_verification_attempt(
  '{"user_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","valid":true}'::jsonb);
SELECT public.hook_password_verification_attempt(
  '{"user_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","valid":false}'::jsonb);

-- ── client writes (user_c, plain member of ws_a) ────────────────────────────
SELECT tests.login_as(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '11111111-1111-1111-1111-111111111111'
);

-- The body names user_a, another company and a made-up address. None of it
-- survives the stamp.
SELECT lives_ok(
  $$ INSERT INTO public.auth_events
       (user_id, workspace_id, kind, outcome, source, ip_address, user_agent, context)
     VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
             '22222222-2222-2222-2222-222222222222',
             'sign_out', 'success', 'client', '198.51.100.9'::inet, 'forged', '{"why":"test"}') $$,
  'client: a member can write a sign_out row'
);

SELECT is(
  (SELECT count(*)::int FROM public.auth_events
    WHERE kind = 'sign_out'
      AND user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
      AND workspace_id = '11111111-1111-1111-1111-111111111111'
      AND source = 'client'
      AND ip_address IS NULL AND user_agent IS NULL
      AND context ->> 'why' = 'test'),
  1,
  'client: the row is stamped from the JWT — forged user, company and address overwritten, context kept'
);

-- Same person, but the claims now carry the session GoTrue minted: the
-- address and user agent come from auth.sessions.
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',  'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'role', 'authenticated',
    'session_id', '5e551011-0000-4000-8000-000000000074',
    'app_metadata', jsonb_build_object('workspace_id', '11111111-1111-1111-1111-111111111111')
  )::text,
  true
);

SELECT lives_ok(
  $$ INSERT INTO public.auth_events (kind, outcome, source)
     VALUES ('idle_timeout', 'success', 'client') $$,
  'client: an idle_timeout row with a session claim is accepted'
);

SELECT is(
  (SELECT host(ip_address) || ' / ' || user_agent || ' / ' || session_id::text
     FROM public.auth_events
    WHERE kind = 'idle_timeout' AND user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  '203.0.113.74 / pgTAP suite 74 / 5e551011-0000-4000-8000-000000000074',
  'client: address, user agent and session id are stamped from auth.sessions'
);

-- A body claiming to be a hook row is not refused — it is CORRECTED. The
-- stamp overwrites `source` before the policy runs, so the row lands as the
-- client sign_in row it really is; nothing a client sends can ever be read
-- back as "GoTrue said so".
SELECT lives_ok(
  $$ INSERT INTO public.auth_events (kind, outcome, source)
     VALUES ('sign_in', 'success', 'gotrue_hook') $$,
  'client: a body claiming source gotrue_hook is accepted…'
);

SELECT is(
  (SELECT source FROM public.auth_events
    WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
      AND kind = 'sign_in'
      AND session_id = '5e551011-0000-4000-8000-000000000074'),
  'client',
  '…and stored as a client row — the forged source is overwritten, not trusted'
);

SELECT throws_ok(
  $$ INSERT INTO public.auth_events (kind, outcome, source)
     VALUES ('mfa_verify', 'success', 'client') $$,
  '42501',
  NULL,
  'client: cannot write a server-only kind (mfa_verify)'
);

SELECT throws_ok(
  $$ INSERT INTO public.auth_events (kind, outcome, source)
     VALUES ('sign_in', 'failure', 'client') $$,
  '42501',
  NULL,
  'client: cannot write a failure — failures are the hooks'' to record'
);

SELECT throws_ok(
  $$ UPDATE public.auth_events SET kind = 'session_cap' WHERE kind = 'sign_out' $$,
  '42501',
  NULL,
  'client: cannot update a row, even their own'
);

SELECT throws_ok(
  $$ DELETE FROM public.auth_events WHERE kind = 'sign_out' $$,
  '42501',
  NULL,
  'client: cannot delete a row, even their own'
);

-- ── read scope: a plain member ──────────────────────────────────────────────
-- user_c has 3 hook rows + 3 client rows (sign_out, idle_timeout, and the
-- corrected sign_in); user_a's failure row is in the same company and must
-- stay invisible to a plain member.
SELECT is(
  (SELECT count(*)::int FROM public.auth_events),
  6,
  'member: sees exactly their own six rows'
);

SELECT is(
  (SELECT count(*)::int FROM public.auth_events
    WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0,
  'member: cannot see another member''s rows'
);

-- ── read scope: an admin of ws_a ────────────────────────────────────────────
RESET ROLE;

-- 0071 fixture (runner, RLS bypassed, no stamp — the runner is not the
-- `authenticated` role): user_c also signed in to the OTHER company. A client
-- row tagged with ws_b, carrying ws_b's address. An admin of ws_a must not
-- see it; an admin of ws_b must.
INSERT INTO public.auth_events
  (user_id, workspace_id, kind, outcome, source, ip_address, user_agent, context)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc',
        '22222222-2222-2222-2222-222222222222',
        'sign_in', 'success', 'client', '198.51.100.71'::inet, 'pgTAP suite 74 (ws_b)',
        '{"surface":"app"}'::jsonb);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'workspace_id', '11111111-1111-1111-1111-111111111111',
      'app_role',     'admin'
    )
  )::text,
  true
);
SELECT set_config('role', 'authenticated', true);

SELECT is(
  (SELECT count(*)::int FROM public.auth_events
    WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  6,
  'admin: sees a member''s hook rows and client rows'
);

SELECT is(
  (SELECT count(*)::int FROM public.auth_events
    WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
      AND workspace_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'admin (0071): a shared member''s client row for the OTHER company — its address included — is invisible'
);

SELECT is(
  (SELECT count(*)::int FROM public.auth_events
    WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0,
  'admin: cannot read outside their company — another company''s admin has a hook row and it is invisible'
);

-- ── read scope: an admin of ws_b ────────────────────────────────────────────
RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'workspace_id', '22222222-2222-2222-2222-222222222222',
      'app_role',     'admin'
    )
  )::text,
  true
);
SELECT set_config('role', 'authenticated', true);

SELECT is(
  (SELECT count(*)::int FROM public.auth_events
    WHERE user_id <> 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      AND workspace_id IS DISTINCT FROM '22222222-2222-2222-2222-222222222222'),
  0,
  'admin of the other company: sees none of ws_a''s rows (hook or client)'
);

SELECT is(
  (SELECT host(ip_address) FROM public.auth_events
    WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  '198.51.100.71',
  'admin of the other company (0071): sees exactly the one row tagged with their own company, and not user_c''s hook rows'
);

-- ── read scope: anon ────────────────────────────────────────────────────────
-- Valid-but-empty claims on purpose: the planner pre-evaluates the policy's
-- STABLE helpers for its estimates, and an empty string there is a JSON
-- parse error (22P02) BEFORE the privilege check can refuse (42501).
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET ROLE anon;

SELECT throws_ok(
  $$ SELECT count(*) FROM public.auth_events $$,
  '42501',
  NULL,
  'anon: cannot read auth_events at all'
);

-- ── read scope: a platform operator ─────────────────────────────────────────
RESET ROLE;
INSERT INTO public.platform_operators (user_id)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
ON CONFLICT (user_id) DO NOTHING;

SELECT tests.login_as(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '22222222-2222-2222-2222-222222222222'
);

SELECT is(
  (SELECT count(*)::int FROM public.auth_events),
  9,
  'operator: sees every row across companies (7 for user_c, 1 for user_a, 1 for user_b)'
);

-- ── retention ───────────────────────────────────────────────────────────────
RESET ROLE;
SELECT is(
  public.purge_auth_events(INTERVAL '-1 day')::int,
  9,
  'purge_auth_events: deletes everything older than the cut-off (here: all nine)'
);

SELECT * FROM finish();
ROLLBACK;
