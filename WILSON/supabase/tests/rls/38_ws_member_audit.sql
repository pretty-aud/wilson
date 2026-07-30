-- =============================================================================
-- 38_ws_member_audit.sql — Session 17 (migration 0030).
--
-- Pins the two release-gating database fixes:
--
--   §6 #42 / TPN-LOG-005 — privilege changes on workspace_members are now
--   captured into the server-reserved app_events 'admin' stream by a
--   SECURITY DEFINER trigger. The probes hold BOTH halves: that a privilege
--   change writes exactly one attributable row, AND that a profile-only edit
--   writes none — an audit stream that logs everything is one nobody reads.
--
--   §6 #44 — custom_access_token_hook is no longer client-executable. The
--   probe checks anon AND authenticated AND that supabase_auth_admin kept its
--   grant, because revoking too much breaks sign-in silently at token
--   issuance, where nothing in this suite would notice.
--
-- login_as sets NO app_role claim (0005), so probes needing one build the JWT
-- by hand — the S13 discipline. De-auth before every mid-file login with a
-- claims reset + RESET ROLE (the tests schema is runner-only).
-- =============================================================================
BEGIN;

SELECT plan(14);

SELECT * FROM tests.rls_setup();

-- A third member of workspace A, so an admin has somebody other than
-- themselves to promote (fn_ws_members_prevent_self_role_change blocks
-- self-promotion, which would otherwise be the obvious probe).
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local',
        crypt('testpw', gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        'authenticated', 'authenticated',
        '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES ('11111111-1111-1111-1111-111111111111',
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        'user', 'user_c', 'User C', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;


-- ── #44: the access-token hook is locked down ───────────────────────────────

-- 1-2: no client role may compute another user's claim set. The hook reads
-- its target user id from the caller-supplied `event` argument, not
-- auth.uid(), so EXECUTE is the only thing standing between a signed-in
-- caller and every other user's memberships, app_role and operator flag.
SELECT ok(
  NOT has_function_privilege('authenticated',
        'public.custom_access_token_hook(jsonb)', 'EXECUTE'),
  'authenticated cannot execute custom_access_token_hook'
);
SELECT ok(
  NOT has_function_privilege('anon',
        'public.custom_access_token_hook(jsonb)', 'EXECUTE'),
  'anon cannot execute custom_access_token_hook'
);

-- 3: the half that must NOT regress. GoTrue calls the hook as
-- supabase_auth_admin at token issuance; revoking this breaks every sign-in,
-- and it breaks it somewhere no other probe in this repo looks.
SELECT ok(
  has_function_privilege('supabase_auth_admin',
        'public.custom_access_token_hook(jsonb)', 'EXECUTE'),
  'supabase_auth_admin retains EXECUTE on the hook (sign-in still works)'
);


-- ── #42: the capture trigger exists and is not client-callable ──────────────

SELECT has_function('public', 'fn_ws_members_audit_capture',
  'fn_ws_members_audit_capture() exists');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_trigger
           WHERE tgname = 'trg_ws_members_audit'
             AND tgrelid = 'public.workspace_members'::regclass
             AND NOT tgisinternal),
  'trg_ws_members_audit is installed on workspace_members'
);

SELECT ok(
  NOT has_function_privilege('authenticated',
        'public.fn_ws_members_audit_capture()', 'EXECUTE'),
  'authenticated cannot call the capture function directly'
);


-- ── A real privilege change, made the way the browser makes it ──────────────

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

-- The exact statement useWorkspaceMembers.js issues: a raw .update() under
-- the FOR ALL ws_members_admin_write policy.
UPDATE public.workspace_members
   SET app_role = 'manager'
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
   AND user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- 7: exactly one row — not zero (the trigger never fired / RLS refused it and
-- the catch-all swallowed the refusal) and not two.
SELECT is(
  (SELECT count(*)::int FROM public.app_events
    WHERE code = 'WIL-4105'
      AND context->>'target_user_id' = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  1, 'a role promotion writes exactly one WIL-4105 audit row'
);

-- 8: attributable. An audit row that cannot name the actor answers nothing.
SELECT is(
  (SELECT actor_user_id FROM public.app_events
    WHERE code = 'WIL-4105'
      AND context->>'target_user_id' = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'the audit row names the acting admin'
);

-- 9: and carries the before/after, which is the whole point — the roster
-- already shows the end state.
SELECT is(
  (SELECT context->'app_role'->>'from' || '->' || (context->'app_role'->>'to')
     FROM public.app_events
    WHERE code = 'WIL-4105'
      AND context->>'target_user_id' = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'user->manager', 'the audit row records the before and after role'
);

-- 10: it lands in the reserved stream, which no client can write to.
SELECT is(
  (SELECT event_type FROM public.app_events
    WHERE code = 'WIL-4105'
      AND context->>'target_user_id' = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'admin', 'the audit row is on the server-reserved admin stream'
);


-- ── The deliberate silence: profile edits are not privilege changes ─────────

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

UPDATE public.workspace_members
   SET title = 'Senior Widget Wrangler', pronouns = 'they/them'
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
   AND user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- 11: still exactly one row. A trigger that logged every UPDATE would bury
-- the four transitions that matter under avatar and pronoun churn.
SELECT is(
  (SELECT count(*)::int FROM public.app_events
    WHERE code = 'WIL-4105'
      AND context->>'target_user_id' = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  1, 'a profile-only edit writes NO audit row'
);


-- ── A rate-card grant is a privilege change too ─────────────────────────────

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

UPDATE public.workspace_members
   SET grant_rate_card_edit = true
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
   AND user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

-- 12: THE PROBE FOR THE FORGERY GUARD. A member cannot mint their own
-- "promoted to admin" line — 0021's INSERT policy reserves the stream, and
-- the trigger's authority comes from BYPASSRLS on the function owner, not
-- from the caller.
SELECT throws_ok(
  $$ INSERT INTO public.app_events
       (workspace_id, event_type, code, message)
     VALUES ('11111111-1111-1111-1111-111111111111',
             'admin', 'WIL-4105', 'Forged privilege change') $$,
  'new row violates row-level security policy for table "app_events"',
  'a signed-in member cannot forge an admin-stream audit row'
);

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- 13: the grant change was captured.
SELECT is(
  (SELECT count(*)::int FROM public.app_events
    WHERE code = 'WIL-4105'
      AND context->>'target_user_id' = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  2, 'a rate-card grant change writes its own audit row'
);


-- ── The audit must never abort the write it audits ──────────────────────────

-- 14: deleting a workspace CASCADEs its memberships, firing this trigger for
-- each — while the parent workspaces row the audit row's FK points at is
-- disappearing. 0012/0027's catch-all idiom is what keeps teardown working.
SELECT lives_ok(
  $$ DELETE FROM public.workspaces
      WHERE id = '22222222-2222-2222-2222-222222222222' $$,
  'the capture trigger does not abort a workspace CASCADE delete'
);

SELECT * FROM finish();
ROLLBACK;
