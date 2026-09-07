-- pgTAP: rate_card_entries RLS (parent-join via rate_cards; role-scoped
-- since migration 0015 — SELECT admin+manager, writes admin only)
BEGIN;
SELECT plan(9);

SELECT * FROM tests.rls_setup();

-- Seed a plain 'user' (user_c) and a 'manager' (user_d) in ws_a — same
-- fixture block as 17_edit_history.sql.
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   'user_c@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now()),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd',
   'user_d@test.local', crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'user', 'user_c', 'User C', true),
  ('11111111-1111-1111-1111-111111111111',
   'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'manager', 'user_d', 'User D', true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.rate_cards (id, workspace_id, name) VALUES
  ('aaaa1111-0000-0000-0000-000000000e01', '11111111-1111-1111-1111-111111111111', 'RC A'),
  ('bbbb2222-0000-0000-0000-000000000e02', '22222222-2222-2222-2222-222222222222', 'RC B');

INSERT INTO public.rate_card_entries (id, rate_card_id, role_label, role_slug) VALUES
  ('aaaa1111-0000-0000-0000-000000000f01', 'aaaa1111-0000-0000-0000-000000000e01', 'Lead', 'lead'),
  ('bbbb2222-0000-0000-0000-000000000f02', 'bbbb2222-0000-0000-0000-000000000e02', 'Lead', 'lead');

-- ── probes 1-4: admin path — reads + writes, tenancy intact ──────────────
-- The 0015 policies gate on app_role, which tests.login_as omits — use
-- inline claims (17_edit_history.sql pattern).
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
  (SELECT count(*)::int FROM public.rate_card_entries WHERE id = 'aaaa1111-0000-0000-0000-000000000f01'),
  1, 'admin can SELECT own-workspace rate_card_entry'
);

SELECT is(
  (SELECT count(*)::int FROM public.rate_card_entries WHERE id = 'bbbb2222-0000-0000-0000-000000000f02'),
  0, 'admin cannot SELECT workspace-B rate_card_entry'
);

WITH upd AS (
  UPDATE public.rate_card_entries SET role_label = 'hijack'
   WHERE id = 'bbbb2222-0000-0000-0000-000000000f02'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0, 'admin cannot UPDATE workspace-B rate_card_entry');

-- Exercise the 0015 identity columns on the way in.
INSERT INTO public.rate_card_entries
  (id, rate_card_id, role_label, role_slug, member_id, wage)
VALUES ('aaaa1111-0000-0000-0000-000000000f99',
        'aaaa1111-0000-0000-0000-000000000e01', 'audit', 'audit',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 100);

SELECT is(
  (SELECT created_by FROM public.rate_card_entries WHERE id = 'aaaa1111-0000-0000-0000-000000000f99'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'admin INSERT lands and the audit trigger populates created_by'
);

-- ── probes 5-6: read scoping — manager yes, plain user no ────────────────
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',  'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'workspace_id', '11111111-1111-1111-1111-111111111111',
      'app_role',     'manager'
    )
  )::text,
  true
);
SELECT set_config('role', 'authenticated', true);

SELECT is(
  (SELECT count(*)::int FROM public.rate_card_entries WHERE id = 'aaaa1111-0000-0000-0000-000000000f01'),
  1, 'manager can SELECT rate_card_entries'
);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',  'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'workspace_id', '11111111-1111-1111-1111-111111111111',
      'app_role',     'user'
    )
  )::text,
  true
);
SELECT set_config('role', 'authenticated', true);

SELECT is(
  (SELECT count(*)::int FROM public.rate_card_entries),
  0, 'plain user sees zero rate_card_entries'
);

-- ── probes 7-8: write scoping — admin only ───────────────────────────────
-- (still user_c — the plain user)
SELECT throws_ok(
  $$INSERT INTO public.rate_card_entries (id, rate_card_id, role_label, role_slug)
    VALUES ('aaaa1111-0000-0000-0000-000000000f03',
            'aaaa1111-0000-0000-0000-000000000e01', 'sneaky', 'sneaky')$$,
  'new row violates row-level security policy for table "rate_card_entries"',
  'plain user cannot INSERT rate_card_entries'
);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',  'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'workspace_id', '11111111-1111-1111-1111-111111111111',
      'app_role',     'manager'
    )
  )::text,
  true
);
SELECT set_config('role', 'authenticated', true);

SELECT throws_ok(
  $$INSERT INTO public.rate_card_entries (id, rate_card_id, role_label, role_slug)
    VALUES ('aaaa1111-0000-0000-0000-000000000f04',
            'aaaa1111-0000-0000-0000-000000000e01', 'sneaky', 'sneaky')$$,
  'new row violates row-level security policy for table "rate_card_entries"',
  'manager cannot INSERT rate_card_entries'
);


-- ── 0033: the migration-0011 privilege trap, for rate_card_entries ──
-- 0011's blanket GRANT plus its ALTER DEFAULT PRIVILEGES left anon holding
-- every table privilege on rate_card_entries; 0033 revoked it. Assert the revoke rather
-- than assume it — a policy-only check passes while a privilege hole is wide
-- open, which is exactly how 26 tables stayed open until S21 tripped over one.
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.rate_card_entries', 'SELECT') OR
    has_table_privilege('anon', 'public.rate_card_entries', 'INSERT') OR
    has_table_privilege('anon', 'public.rate_card_entries', 'UPDATE') OR
    has_table_privilege('anon', 'public.rate_card_entries', 'DELETE')
  ),
  'anon holds no table privilege on rate_card_entries'
);

SELECT * FROM finish();
ROLLBACK;
