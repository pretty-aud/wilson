-- =============================================================================
-- 25_app_events.sql — Session 9: app_events log (migration 0021).
-- Active members write (actor stamped server-side), admins read, append-only,
-- workspace-isolated, 90-day purge.
-- =============================================================================

BEGIN;

SELECT plan(13);

SELECT * FROM tests.rls_setup();

-- extra fixtures (runner: RLS bypassed): user_c active, user_g inactive, ws_a
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   'user_c@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now()),
  ('a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7',
   'user_g@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111',
   'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7', 'user', 'user_g', 'User G (inactive)', false)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- ── structure ────────────────────────────────────────────────────────────
SELECT has_table('public', 'app_events', 'app_events table exists');

SELECT ok(
  (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.app_events'::regclass),
  'app_events has FORCE ROW LEVEL SECURITY');

-- ── probes 3-4: active member writes; actor is stamped, never trusted ────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '11111111-1111-1111-1111-111111111111'
);

WITH ins AS (
  INSERT INTO public.app_events (workspace_id, event_type, code, severity, message)
  VALUES ('11111111-1111-1111-1111-111111111111',
          'error', 'WIL-2001', 'error', 'Realtime channel error')
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM ins), 1,
          'active member can insert an app event');

-- Spoofed actor: the stamp trigger overwrites it with auth.uid().
INSERT INTO public.app_events (workspace_id, actor_user_id, event_type, severity, message)
VALUES ('11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'system', 'info', 'Spoof attempt');

-- ── probe 4: non-admin cannot read ───────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.app_events),
  0, 'non-admin member reads no app events');

-- ── probe 5: actor stamp (checked as the RLS-bypassing runner) ───────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.app_events
    WHERE actor_user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  2, 'client-supplied actor_user_id is overwritten with auth.uid()');

-- ── probe 6: admin reads the workspace stream ────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
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

-- Scoped to the CLIENT-written stream. Session 17's trg_ws_members_audit
-- (migration 0030) writes an 'admin' row for every membership change, and
-- tests.rls_setup() plus this file's own fixtures create four of them — so
-- an unfiltered count here measured the fixtures, not the policy. The
-- contract this probe exists for is "an admin reads what probe 4's non-admin
-- could not", and that is unchanged.
SELECT is(
  (SELECT count(*)::int FROM public.app_events WHERE event_type <> 'admin'),
  2, 'admin reads the workspace event stream');

-- ── probes 7-8: append-only ──────────────────────────────────────────────
WITH upd AS (
  UPDATE public.app_events SET message = 'rewritten' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0,
          'app events cannot be updated (append-only)');

WITH del AS (
  DELETE FROM public.app_events RETURNING 1
)
SELECT is((SELECT count(*)::int FROM del), 0,
          'app events cannot be deleted (append-only)');

-- ── probe 9: cross-workspace insert denied ───────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '22222222-2222-2222-2222-222222222222'
);

SELECT throws_ok(
  $$INSERT INTO public.app_events (workspace_id, event_type, severity, message)
    VALUES ('11111111-1111-1111-1111-111111111111', 'system', 'info', 'cross-ws')$$,
  'new row violates row-level security policy for table "app_events"',
  'cross-workspace insert is denied');

-- ── probe 10: inactive member cannot write ───────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as(
  'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7',
  '11111111-1111-1111-1111-111111111111'
);

SELECT throws_ok(
  $$INSERT INTO public.app_events (workspace_id, event_type, severity, message)
    VALUES ('11111111-1111-1111-1111-111111111111', 'system', 'info', 'ghost write')$$,
  'new row violates row-level security policy for table "app_events"',
  'inactive member cannot insert app events');

-- ── probe 11: the 'admin' stream is server-reserved ──────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '11111111-1111-1111-1111-111111111111'
);

SELECT throws_ok(
  $$INSERT INTO public.app_events (workspace_id, event_type, code, severity, message)
    VALUES ('11111111-1111-1111-1111-111111111111',
            'admin', 'WIL-4103', 'critical', 'Forged deactivation')$$,
  'new row violates row-level security policy for table "app_events"',
  'clients cannot mint admin-stream events or WIL-41xx codes');

-- ── probes 12-13: retention ──────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT has_function('public', 'purge_app_events', ARRAY['interval'],
  'purge_app_events(interval) exists');

-- Backdate one row (runner is superuser: RLS bypassed) and sweep it.
UPDATE public.app_events
   SET created_at = now() - INTERVAL '100 days'
 WHERE message = 'Spoof attempt';

SELECT is(
  public.purge_app_events()::int,
  1, 'purge_app_events sweeps rows older than 90 days');

SELECT * FROM finish();
ROLLBACK;
