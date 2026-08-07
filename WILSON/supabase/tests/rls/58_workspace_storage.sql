-- =============================================================================
-- 58_workspace_storage.sql — Session 34: the workspace storage root (0048)
--
-- What this pins:
--   * workspace_storage structure: FORCE RLS, four policies (no FOR ALL),
--     audit trigger, zero anon/PUBLIC privileges, the three CHECK families.
--   * Members READ the root (every desktop resolves it); ONLY admins write.
--     The write policy has three arms — workspace claim, admin role claim,
--     live membership — and per the S33 lesson each arm gets a caller that
--     PASSES the other two, because a refusal probe pins one check only if
--     every other check waves its caller through:
--       - role arm:       active member of A, claims A, app_role 'user'
--       - membership arm: DEACTIVATED member of A, claims A, app_role 'admin'
--       - claim arm:      active member of A AND B, signed into B,
--                         app_role 'admin', targeting A's row
--     Proven by breakers before commit: deleting one arm from 0048's policies
--     fails exactly that probe and no other.
--   * fn_workspaces_client_guard refuses client writes to the legacy
--     workspaces.storage_mode / storage_config (the §3.4 live wire), while a
--     control probe proves an admin can still update unprotected columns.
--     A claim-less caller is refused too — by RLS row-hiding, which raises
--     nothing, so that probe asserts the VALUE afterwards (an RLS-refused
--     UPDATE is silent; suite 56 idiom).
--
-- Postgres-side reads are ALWAYS scoped to the fixture workspaces — dev
-- carries real rows (S33, 439f702), and an unscoped count decays the day the
-- feature is used.
--
-- 🚨 SESSION 36: every fixture below that carries a root_path now NAMES
-- provider = 'network' (0050). Two reasons, and the second is the one that
-- would otherwise cost a session:
--   * Truth. A fixture configuring a NAS should say it is a NAS. 0050's
--     workspace_storage_mode_provider_chk binds mode to provider, so a byos
--     row that lets provider default to 'petal' is an incoherent row.
--   * MEASURED on dev, 2026-08-07: when a row violates several CHECKs at
--     once, Postgres reports the one whose name sorts FIRST ALPHABETICALLY,
--     not the one declared first — and throws_ok matches SQLERRM EXACTLY.
--     Left defaulting, the byos+path fixtures would violate the new
--     mode_provider_chk as well, and THAT name sorts ahead of
--     root_canon_chk / root_pair_chk, so three probes below would have
--     started reporting a constraint they are not about. Naming provider
--     makes each probe violate exactly ONE constraint, which is what a
--     single-constraint assertion should always have done.
-- Nothing here is relaxed: every refusal, message and expectation is S34's.
-- =============================================================================

BEGIN;

SELECT plan(31);

SELECT * FROM tests.rls_setup();

-- user_c: plain 'user'-role member of workspace A, ACTIVE. user_d: member of
-- A minted INACTIVE — the stale-admin-JWT shape needs a live row that says no.
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

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','user','user_c','User C',true),
  -- Dual-workspace shape (claim arm, probe 23): user_c is ALSO an active
  -- member of B, so signed into B every arm except the workspace claim passes.
  ('22222222-2222-2222-2222-222222222222','cccccccc-cccc-cccc-cccc-cccccccccccc','user','user_c_b','User C in B',true),
  -- 'user' in workspace_members on purpose: the policies read the JWT claim,
  -- not this column, so the row's own role must not be what saves the probe.
  ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','user','user_d','User D',false)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- ── structure ───────────────────────────────────────────────────────────────

SELECT has_table('public', 'workspace_storage', 'workspace_storage table exists');

SELECT ok(
  (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.workspace_storage'::regclass),
  'workspace_storage has FORCE ROW LEVEL SECURITY');

-- 0029: a FOR ALL arm ORs with every narrow arm beside it and silently wins.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname='public' AND tablename='workspace_storage' AND cmd='ALL'),
  0, 'no FOR ALL policy arm');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname='public' AND tablename='workspace_storage'),
  4, 'workspace_storage carries exactly four policies, one per verb');

SELECT has_trigger('public', 'workspace_storage', 'trg_workspace_storage_audit',
  'audit stamping is wired (fn_audit_touch)');

-- PUBLIC as well as anon — the S22 grantee lesson.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema='public' AND table_name='workspace_storage'
       AND grantee IN ('anon', 'PUBLIC')
  ),
  'neither anon nor PUBLIC holds any privilege on workspace_storage');

-- A 0020 replay recreates the guard WITHOUT the storage arms and reports
-- success (0048 ORDERING note). These two probes are what notice.
SELECT ok(
  position('storage_mode' IN
    pg_get_functiondef('public.fn_workspaces_client_guard()'::regprocedure)) > 0,
  'fn_workspaces_client_guard carries the storage_mode arm');

SELECT ok(
  position('storage_config' IN
    pg_get_functiondef('public.fn_workspaces_client_guard()'::regprocedure)) > 0,
  'fn_workspaces_client_guard carries the storage_config arm');

-- ── CHECK constraints (as postgres: RLS is not what these prove) ────────────

-- provider 'network' so mode_provider_chk (0050) is SATISFIED and this row
-- violates mode_chk alone — 'dropbox' is not a mode under any provider.
SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider)
    VALUES ('11111111-1111-1111-1111-111111111111', 'dropbox', 'network')$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_mode_chk"',
  'mode outside central|byos is refused');

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, root_path)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 'network', 'C:\Projects')$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_root_pair_chk"',
  'a root path without its kind is refused — half a config resolves nowhere');

-- §3.2: the pre-S33 guard refused every file under a root saved with a
-- trailing separator. The canonical form is enforced where drift would start.
SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, root_path, root_kind)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 'network', '\\nas\projects\wilson\', 'unc')$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_root_canon_chk"',
  'a trailing separator is refused — canonical UNC only (§3.2)');

-- ── role arm: an active member with a USER claim cannot write ───────────────
-- Claims are built by hand (tests.login_as sets no app_role): workspace A ✓,
-- membership active ✓, app_role 'user' ✗ — only the role arm refuses.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','cccccccc-cccc-cccc-cccc-cccccccccccc','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','user')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, root_path, root_kind)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 'network', '\\nas\projects\wilson', 'unc')$$,
  'new row violates row-level security policy for table "workspace_storage"',
  'an active member with a user claim cannot set the root (role arm)');

-- ── the admin happy path ────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT lives_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, root_path, root_kind)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 'network', '\\nas\projects\wilson', 'unc')$$,
  'a workspace admin sets the storage root');

-- Precisely worded: fn_audit_touch DEFAULTS created_by from the JWT when the
-- client omits it (this INSERT omitted it, as the app does). It does not
-- overwrite a client-supplied value — that is the house mechanism on every
-- workspace table, and a probe claiming "not by the client" would assert
-- more than the mechanism guarantees (S34 review).
SELECT is(
  (SELECT created_by::text FROM public.workspace_storage
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'created_by defaults from the JWT when the client omits it (fn_audit_touch)');

SELECT lives_ok(
  $$UPDATE public.workspace_storage
       SET root_path = '\\nas\projects\wilson-live'
     WHERE workspace_id = '11111111-1111-1111-1111-111111111111'$$,
  'a workspace admin repoints the root');

SELECT is(
  (SELECT root_path FROM public.workspace_storage
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'),
  '\\nas\projects\wilson-live',
  'and the new value landed');

-- ── members read the root ───────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

-- Presence control: this reader DOES see the row, so every count-0 below
-- cannot pass vacuously.
SELECT is(
  (SELECT count(*)::int FROM public.workspace_storage),
  1, 'an active member sees the workspace root (presence control)');

SELECT is(
  (SELECT root_path FROM public.workspace_storage),
  '\\nas\projects\wilson-live',
  'and reads the actual value — every desktop resolves the same share');

-- A member's UPDATE matches no rows under the admin-only USING, and an
-- RLS-refused UPDATE raises NOTHING — so the probe is the value afterwards.
UPDATE public.workspace_storage
   SET root_path = 'C:\Mine'
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111';
-- A member's DELETE is silent the same way.
DELETE FROM public.workspace_storage
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111';

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT root_path FROM public.workspace_storage
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'),
  '\\nas\projects\wilson-live',
  'a member''s UPDATE changed nothing — the whole company''s media stays put');

SELECT is(
  (SELECT count(*)::int FROM public.workspace_storage
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'),
  1, 'a member''s DELETE removed nothing');

-- ── membership arm: an ADMIN claim over a deactivated membership ────────────
-- The S33 stale-JWT shape: claims say admin of A (role arm ✓, claim arm ✓);
-- the live workspace_members row says is_active = false. Only the membership
-- arm refuses. Breaker-proven: with has_active_membership deleted from 0048's
-- policies, every other probe in this file stays green and these two fail.
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','dddddddd-dddd-dddd-dddd-dddddddddddd','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT is(
  (SELECT count(*)::int FROM public.workspace_storage),
  0, 'a deactivated member sees no root even with an admin claim (membership arm, SELECT)');

UPDATE public.workspace_storage
   SET root_path = 'C:\Stale'
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111';

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT root_path FROM public.workspace_storage
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'),
  '\\nas\projects\wilson-live',
  'and their UPDATE changed nothing (membership arm, UPDATE)');

-- ── claim arm: a dual-workspace member signed into the OTHER workspace ──────
-- user_c is an ACTIVE member of both A and B. Signed into B with an admin
-- claim, targeting A's row: role arm ✓, membership in A live ✓ — only
-- current_workspace_id() ≠ A refuses. The plain cross-workspace caller cannot
-- pin this (membership refuses them first); only this shape discriminates.
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','cccccccc-cccc-cccc-cccc-cccccccccccc','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','22222222-2222-2222-2222-222222222222','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

UPDATE public.workspace_storage
   SET root_path = 'C:\OtherHat'
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111';

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT root_path FROM public.workspace_storage
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'),
  '\\nas\projects\wilson-live',
  'signed into workspace B, an active member of A cannot repoint A''s root (claim arm)');

-- ── cross-workspace read ────────────────────────────────────────────────────
SELECT tests.login_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                      '22222222-2222-2222-2222-222222222222');

SELECT is(
  (SELECT count(*)::int FROM public.workspace_storage),
  0, 'workspace B''s admin sees nothing of A''s storage (presence-controlled above)');

-- ── admin DELETE, last so every refusal above ran against a real row ────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT lives_ok(
  $$DELETE FROM public.workspace_storage
     WHERE workspace_id = '11111111-1111-1111-1111-111111111111'$$,
  'a workspace admin clears the storage config');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.workspace_storage
    WHERE workspace_id = '11111111-1111-1111-1111-111111111111'),
  0, 'and the row is actually gone — lives_ok alone cannot tell a 0-row DELETE from a real one');

-- ── the legacy live wire (fn_workspaces_client_guard, §3.4) ─────────────────
-- An ADMIN passes workspaces_admin_update, so these callers reach the trigger
-- — which is the point: the guard is what refuses, not the policy.
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT throws_ok(
  $$UPDATE public.workspaces SET storage_mode = 'byos'
     WHERE id = '11111111-1111-1111-1111-111111111111'$$,
  'workspace storage settings are not client-editable — the live store is workspace_storage (0048)',
  'an admin cannot poke the legacy storage_mode — the live wire is closed');

SELECT throws_ok(
  $$UPDATE public.workspaces SET storage_config = '{"bucket":"evil"}'::jsonb
     WHERE id = '11111111-1111-1111-1111-111111111111'$$,
  'workspace storage settings are not client-editable — the live store is workspace_storage (0048)',
  'an admin cannot poke the legacy storage_config either');

-- The breaker expected to PASS: the guard must not overblock. An admin rename
-- rides workspaces_admin_update through this same trigger (CompanySection).
SELECT lives_ok(
  $$UPDATE public.workspaces SET name = name
     WHERE id = '11111111-1111-1111-1111-111111111111'$$,
  'the guard does not overblock — an admin still updates unprotected columns');

-- ── claim-less caller ───────────────────────────────────────────────────────
-- tests.login_as mints NO app_role, so current_app_role() is NULL. The
-- refusal here comes from RLS row-hiding (NULL fails a policy CLOSED), which
-- raises nothing — so the probe asserts the value. This is the 0047 lesson's
-- other half: NULL fails CLOSED in a policy, and this proves the policy is
-- where this caller is stopped.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

UPDATE public.workspaces SET storage_mode = 'byos'
 WHERE id = '11111111-1111-1111-1111-111111111111';

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT storage_mode FROM public.workspaces
    WHERE id = '11111111-1111-1111-1111-111111111111'),
  'central',
  'a claim-less caller''s write to storage_mode changed nothing (refused by RLS before the trigger)');

-- ── kind must match the path's shape (appended in review; probe 31) ─────────
-- A row claiming 'unc' over a drive path would make every consumer of
-- root_kind — including main.cjs's apply-a-local-root-only-where-it-exists
-- rule — reason from a lie. As postgres: RLS is not what this proves, and
-- the A-row is deleted by probe 25 so there is no PK collision.
SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, root_path, root_kind)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 'network', 'C:\Projects', 'unc')$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_kind_shape_chk"',
  'a root_kind that contradicts the path''s shape is refused');

SELECT * FROM finish();

ROLLBACK;
