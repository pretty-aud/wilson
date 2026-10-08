-- =============================================================================
-- 93_bins.sql — migration 0091 (Bins on the cloud, bundle BC1, 2026-10-07):
-- bin_locations, bins and bin_files under RLS, the location's shape CHECK,
-- the admin's remote-viewing switch, the cascades and the bins RPCs.
-- (shot_takes and the POSTER policies are suite 94.)
--
-- bin_files and bin_locations are covered HERE, not by a file of their own:
-- rls.yml maps them to this suite in COVERED_BY (the file_events →
-- 33_file_lifecycle precedent); `bins` is in RLS_TABLES and this is its
-- NN_<table>.sql.
--
-- What this pins (each probe names the 0091 section it holds to):
--   * Structure (§2–§4, §7, §8): the three tables exist, RLS enabled AND
--     forced, exactly four policies each, by NAME; the realtime triggers on
--     bins and bin_files; the switch column with its NOT NULL and its
--     default.
--   * THE LOCATION'S SHAPE (§2, B2): \\server\share is accepted; a drive
--     letter, a traversal, a trailing backslash, a forward-slash form and a
--     bare \\server are refused by the CHECK; the same share typed in another
--     case is the same share (23505); name and address are stored trimmed.
--   * THE CLIP'S ADDRESS (§4): relative_path refuses a leading slash, a
--     traversal, a drive letter; poster_path refuses a key outside the row's
--     own project; a location that still has clips cannot be removed (23503,
--     RESTRICT); workspace_id is stamped from the project.
--   * THE GATE (§7, B6): on a STAFFED project a REVIEWER adds a bin, a clip
--     and a location, flags a clip and removes one — the same as a MEMBER; a
--     workspace 'user' with NO seat reads the bins but is refused every write
--     (42501 on INSERT, zero rows on UPDATE / DELETE — RLS filters, it does
--     not refuse, so the counts are asserted); a workspace MANAGER with no
--     seat writes through the gate's manager leg.
--   * TENANCY: the other workspace's admin sees none of it and cannot write
--     into it; anon holds nothing.
--   * PRIVATE PROJECTS (§7's hop through projects_select): a member SEATED
--     as manager on a private project they cannot see reads no bin of it and
--     cannot add one — each refusal paired with a CONTROL on the public
--     project.
--   * THE SWITCH (§1, B5a): a member's UPDATE of remote_viewing_enabled
--     changes nothing; the other workspace's admin's changes nothing; the
--     workspace's own admin's lands and reads back true.
--   * THE TREE: a bin cannot be made its own ancestor (23514, the guard);
--     reorder_bins swaps a parent and its child legitimately (no false
--     refusal); deleting a parent takes its children and their files' rows,
--     and a removed clip's poster is queued for disposal (§6).
--   * THE RPCs (§10): add_bin_files makes sub-bins from a path, reports an
--     item whose location is not this company's as invalid, and refuses a
--     caller without the gate; delete_bin moves or removes; move_bin_files
--     and copy_bin_files; restore_bin_files puts a removed row back with its
--     id and reports a row whose bin is gone; delete_bin for a reader past
--     the SELECT hop but not the gate is 42501, not a quiet 200.
--
-- Postgres-side reads are ALWAYS scoped to fixture ids — dev carries real
-- projects.
-- =============================================================================

BEGIN;

SELECT plan(98);

SELECT * FROM tests.rls_setup();

-- ── Extra fixtures ─────────────────────────────────────────────────────────
-- project_a is STAFFED here, so no leg of the gate opens by accident through
-- 0013's unstaffed opening.
--   user_c  app_role 'user',    project_a REVIEWER -> every bins write (B6)
--   user_d  app_role 'user',    project_a MEMBER   -> every bins write;
--           later seated manager on the private project by postgres
--   user_e  app_role 'user',    NO seat            -> reads, no writes
--   user_f  app_role 'manager', NO seat            -> writes (the gate's
--           manager leg); creates the private project
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
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user_e@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'user_f@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','user','user_c','User C',true),
  ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','user','user_d','User D',true),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','user','user_e','User E',true),
  ('11111111-1111-1111-1111-111111111111','ffffffff-ffff-ffff-ffff-ffffffffffff','manager','user_f','User F',true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.project_members
  (project_id, user_id, workspace_id, project_role)
VALUES
  ('aaaa1111-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1111-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;


-- ── 1-13: structure (§2–§4, §7, §8) ────────────────────────────────────────

SELECT has_table('public'::name, 'bin_locations'::name, 'bin_locations exists (§2)');
SELECT has_table('public'::name, 'bins'::name,          'bins exists (§3)');
SELECT has_table('public'::name, 'bin_files'::name,     'bin_files exists (§4)');

SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.bin_locations'::regclass),
  'bin_locations has RLS enabled and forced (§7)');
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.bins'::regclass),
  'bins has RLS enabled and forced (§7)');
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.bin_files'::regclass),
  'bin_files has RLS enabled and forced (§7)');

-- The NAMES, not just the count (a fifth policy, or a FOR ALL, would show).
SELECT is(
  (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bin_locations'),
  ARRAY['bin_locations_delete', 'bin_locations_insert', 'bin_locations_select', 'bin_locations_update'],
  'bin_locations has exactly select / insert / update / delete (§7a)');
SELECT is(
  (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bins'),
  ARRAY['bins_delete', 'bins_insert', 'bins_select', 'bins_update'],
  'bins has exactly select / insert / update / delete (§7b)');
SELECT is(
  (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bin_files'),
  ARRAY['bin_files_delete', 'bin_files_insert', 'bin_files_select', 'bin_files_update'],
  'bin_files has exactly select / insert / update / delete (§7c)');

SELECT has_trigger('public', 'bins', 'trg_bins_realtime', 'bins are broadcast (§8, B7)');
SELECT has_trigger('public', 'bin_files', 'trg_bin_files_realtime', 'bin_files are broadcast (§8, B7)');

SELECT col_not_null('public'::name, 'workspaces'::name, 'remote_viewing_enabled'::name,
  'workspaces.remote_viewing_enabled is NOT NULL (§1)');
SELECT col_default_is('public'::name, 'workspaces'::name, 'remote_viewing_enabled'::name, 'false',
  'remote_viewing_enabled defaults to false — off until an admin turns it on (B5a)');


-- ── 14-26: the workspace admin names a location and builds a tree (§2–§4) ──

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok($$
  INSERT INTO public.bin_locations (id, workspace_id, name, unc_path)
  VALUES ('93930000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111',
          '  Footage NAS  ', '\\nas\footage')
$$, 'a location is saved by its network address (B2)');

SELECT is((SELECT name || '|' || unc_path FROM public.bin_locations WHERE id = '93930000-0000-0000-0000-00000000000a'),
  'Footage NAS|\\nas\footage', 'the name is stored trimmed; the address as typed');

SELECT throws_ok($$
  INSERT INTO public.bin_locations (workspace_id, name, unc_path)
  VALUES ('11111111-1111-1111-1111-111111111111', 'Drive', 'Z:\footage')
$$, '23514', NULL, 'a drive letter is refused — it means something different on every machine (B2)');

SELECT throws_ok($$
  INSERT INTO public.bin_locations (workspace_id, name, unc_path)
  VALUES ('11111111-1111-1111-1111-111111111111', 'Sneaky', '\\nas\footage\..\secret')
$$, '23514', NULL, 'a traversal segment is refused');

SELECT throws_ok($$
  INSERT INTO public.bin_locations (workspace_id, name, unc_path)
  VALUES ('11111111-1111-1111-1111-111111111111', 'Trailing', '\\nas\footage\')
$$, '23514', NULL, 'a trailing backslash is refused');

SELECT throws_ok($$
  INSERT INTO public.bin_locations (workspace_id, name, unc_path)
  VALUES ('11111111-1111-1111-1111-111111111111', 'Slashes', '//nas/footage')
$$, '23514', NULL, 'a forward-slash form is refused — the address is written as Windows writes it');

SELECT throws_ok($$
  INSERT INTO public.bin_locations (workspace_id, name, unc_path)
  VALUES ('11111111-1111-1111-1111-111111111111', 'Server only', '\\nas')
$$, '23514', NULL, 'a bare server with no share is refused');

SELECT throws_ok($$
  INSERT INTO public.bin_locations (workspace_id, name, unc_path)
  VALUES ('11111111-1111-1111-1111-111111111111', 'Again', '\\NAS\Footage')
$$, '23505', NULL, 'the same share typed in another case is the same share (unique per workspace, lower-cased)');

SELECT lives_ok($$
  INSERT INTO public.bins (id, project_id, name, kind)
  VALUES ('93930000-0000-0000-0000-000000000001', 'aaaa1111-0000-0000-0000-000000000001', 'Footage', 'footage')
$$, 'the admin makes a bin');

SELECT is((SELECT workspace_id FROM public.bins WHERE id = '93930000-0000-0000-0000-000000000001'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'workspace_id is stamped from the project (0004''s trigger)');

SELECT lives_ok($$
  INSERT INTO public.bins (id, project_id, name, kind, parent_bin_id)
  VALUES ('93930000-0000-0000-0000-000000000002', 'aaaa1111-0000-0000-0000-000000000001', 'Day 1', 'footage',
          '93930000-0000-0000-0000-000000000001')
$$, 'and a child bin inside it');

SELECT throws_ok($$
  UPDATE public.bins SET parent_bin_id = '93930000-0000-0000-0000-000000000002'
   WHERE id = '93930000-0000-0000-0000-000000000001'
$$, '23514', 'a bin cannot be inside itself', 'the parent cannot be moved under its own child (the cycle guard, §3)');

SELECT lives_ok($$
  INSERT INTO public.bin_files (id, project_id, bin_id, location_id, relative_path, display_name, original_name, extension, media_type)
  VALUES ('93930000-0000-0000-0000-000000000011', 'aaaa1111-0000-0000-0000-000000000001',
          '93930000-0000-0000-0000-000000000002', '93930000-0000-0000-0000-00000000000a',
          'A001/A001_C001.mov', 'A001_C001', 'A001_C001.mov', '.mov', 'video')
$$, 'a clip is a location plus a relative path (B1)');


-- ── 27-33: the clip's address and picture (§4) ─────────────────────────────

SELECT throws_ok($$
  INSERT INTO public.bin_files (project_id, bin_id, location_id, relative_path, display_name, original_name)
  VALUES ('aaaa1111-0000-0000-0000-000000000001', '93930000-0000-0000-0000-000000000002',
          '93930000-0000-0000-0000-00000000000a', '../secret.mov', 'x', 'secret.mov')
$$, '23514', NULL, 'a relative path with a traversal is refused');

SELECT throws_ok($$
  INSERT INTO public.bin_files (project_id, bin_id, location_id, relative_path, display_name, original_name)
  VALUES ('aaaa1111-0000-0000-0000-000000000001', '93930000-0000-0000-0000-000000000002',
          '93930000-0000-0000-0000-00000000000a', 'C:/clip.mov', 'x', 'clip.mov')
$$, '23514', NULL, 'a drive letter inside a relative path is refused');

SELECT throws_ok($$
  INSERT INTO public.bin_files (project_id, bin_id, location_id, relative_path, display_name, original_name)
  VALUES ('aaaa1111-0000-0000-0000-000000000001', '93930000-0000-0000-0000-000000000002',
          '93930000-0000-0000-0000-00000000000a', '/clip.mov', 'x', 'clip.mov')
$$, '23514', NULL, 'an absolute (leading-slash) relative path is refused');

SELECT throws_ok($$
  UPDATE public.bin_files SET poster_path = 'projects/bbbb2222-0000-0000-0000-000000000001/bin_files/93930000-0000-0000-0000-000000000011/1-poster.jpg'
   WHERE id = '93930000-0000-0000-0000-000000000011'
$$, '23514', NULL, 'a poster key outside the row''s own project is refused');

SELECT lives_ok($$
  UPDATE public.bin_files SET poster_path = 'projects/aaaa1111-0000-0000-0000-000000000001/bin_files/93930000-0000-0000-0000-000000000011/1-poster.jpg'
   WHERE id = '93930000-0000-0000-0000-000000000011'
$$, 'a poster key inside the project''s bin_files prefix is accepted');

SELECT throws_ok($$
  DELETE FROM public.bin_locations WHERE id = '93930000-0000-0000-0000-00000000000a'
$$, '23503', NULL, 'a location that still has clips cannot be removed (RESTRICT): a clip never loses its address');

SELECT throws_ok($$
  INSERT INTO public.bin_files (project_id, bin_id, location_id, relative_path, display_name, original_name)
  VALUES ('aaaa1111-0000-0000-0000-000000000001', '93930000-0000-0000-0000-000000000002',
          '93930000-0000-0000-0000-00000000000a', 'A001/x.mov', '   ', 'x.mov')
$$, '23514', NULL, 'a blank display name is refused');


-- ── 34-42: THE GATE — a REVIEWER does everything a member does (§7, B6) ────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok($$
  INSERT INTO public.bins (id, project_id, name, kind)
  VALUES ('93930000-0000-0000-0000-000000000003', 'aaaa1111-0000-0000-0000-000000000001', 'Reviewer''s bin', 'selects')
$$, 'a REVIEWER adds a bin (B6: reviewers do everything members may)');

SELECT lives_ok($$
  INSERT INTO public.bin_files (id, project_id, bin_id, location_id, relative_path, display_name, original_name, extension, media_type)
  VALUES ('93930000-0000-0000-0000-000000000012', 'aaaa1111-0000-0000-0000-000000000001',
          '93930000-0000-0000-0000-000000000003', '93930000-0000-0000-0000-00000000000a',
          'A001/A001_C002.mov', 'A001_C002', 'A001_C002.mov', '.mov', 'video')
$$, 'a REVIEWER adds a clip');

SELECT lives_ok($$
  INSERT INTO public.bin_locations (id, workspace_id, name, unc_path)
  VALUES ('93930000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Sound', '\\nas\sound')
$$, 'a REVIEWER names a location (past the gate on a project they can see)');

WITH upd AS (
  UPDATE public.bin_files SET review_flag = 'select', color = 'green', circled = true
   WHERE id = '93930000-0000-0000-0000-000000000011' RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 1, 'a REVIEWER flags, colours and circles a clip');

WITH upd AS (
  UPDATE public.bins SET name = 'Day 1 (lighthouse)'
   WHERE id = '93930000-0000-0000-0000-000000000002' RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 1, 'a REVIEWER renames a bin');

WITH del AS (
  DELETE FROM public.bin_files WHERE id = '93930000-0000-0000-0000-000000000012' RETURNING 1)
SELECT is((SELECT count(*)::int FROM del), 1, 'a REVIEWER removes a clip (its row only, B10)');

SELECT is((SELECT count(*)::int FROM public.bin_files WHERE id = '93930000-0000-0000-0000-000000000012'),
  0, 'and the row is gone');

-- CONTROL for the reviewer pair (suite 84's D8 pair): the same reviewer still
-- cannot create a SCENE — can_edit_shot_lists is wider than can_write_project
-- for bins and lists only.
SELECT throws_ok($$
  INSERT INTO public.scenes (project_id, name, scene_number)
  VALUES ('aaaa1111-0000-0000-0000-000000000001', 'WLSN_SC093', 93)
$$, '42501', NULL, 'CONTROL: the same reviewer cannot create a scene (scenes keep can_write_project)');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok($$
  INSERT INTO public.bins (id, project_id, name, kind)
  VALUES ('93930000-0000-0000-0000-000000000004', 'aaaa1111-0000-0000-0000-000000000001', 'Member''s bin', 'audio')
$$, 'a MEMBER adds a bin');


-- ── 43-50: a workspace user with NO seat reads, and is refused every write ─

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*)::int FROM public.bins WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  4, 'a workspace user with no seat READS the project''s bins (the SELECT hop admits a project reader)');
SELECT is((SELECT count(*)::int FROM public.bin_locations WHERE workspace_id = '11111111-1111-1111-1111-111111111111'),
  2, '…and the company''s locations (every active member reads them)');

SELECT throws_ok($$
  INSERT INTO public.bins (project_id, name, kind)
  VALUES ('aaaa1111-0000-0000-0000-000000000001', 'No seat', 'other')
$$, '42501', NULL, 'but cannot add a bin to a staffed project (the gate)');

SELECT throws_ok($$
  INSERT INTO public.bin_files (project_id, bin_id, location_id, relative_path, display_name, original_name)
  VALUES ('aaaa1111-0000-0000-0000-000000000001', '93930000-0000-0000-0000-000000000001',
          '93930000-0000-0000-0000-00000000000a', 'A001/no_seat.mov', 'x', 'no_seat.mov')
$$, '42501', NULL, 'nor a clip');

SELECT throws_ok($$
  INSERT INTO public.bin_locations (workspace_id, name, unc_path)
  VALUES ('11111111-1111-1111-1111-111111111111', 'No seat', '\\nas\noseat')
$$, '42501', NULL, 'nor a location (no project of the workspace they can see admits them past the gate)');

-- 🚨 RLS FILTERS an UPDATE and a DELETE rather than refusing them: the
-- statement succeeds and touches nothing. Counted, never trusted on silence.
WITH upd AS (
  UPDATE public.bin_files SET review_flag = 'reject'
   WHERE id = '93930000-0000-0000-0000-000000000011' RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 0, 'their UPDATE of a clip changes nothing (filtered)');

WITH del AS (
  DELETE FROM public.bins WHERE id = '93930000-0000-0000-0000-000000000003' RETURNING 1)
SELECT is((SELECT count(*)::int FROM del), 0, 'their DELETE of a bin removes nothing (filtered)');

WITH upd AS (
  UPDATE public.bin_locations SET name = 'Renamed by nobody'
   WHERE id = '93930000-0000-0000-0000-00000000000a' RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 0, 'their rename of a location changes nothing (filtered)');


-- ── 51: a workspace MANAGER with no seat writes (the gate's manager leg) ───

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok($$
  INSERT INTO public.bins (id, project_id, name, kind)
  VALUES ('93930000-0000-0000-0000-000000000005', 'aaaa1111-0000-0000-0000-000000000001', 'Manager''s bin', 'vfx')
$$, 'a workspace manager with no seat adds a bin (can_edit_shot_lists'' admin/manager leg)');


-- ── 52-58: tenancy — the other workspace's admin, and anon ────────────────

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

SELECT is((SELECT count(*)::int FROM public.bins WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  0, 'the other workspace''s admin sees no bin of project A');
SELECT is((SELECT count(*)::int FROM public.bin_files WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  0, '…no clip of it');
SELECT is((SELECT count(*)::int FROM public.bin_locations WHERE workspace_id = '11111111-1111-1111-1111-111111111111'),
  0, '…and no location of workspace A');

SELECT throws_ok($$
  INSERT INTO public.bins (project_id, name, kind)
  VALUES ('aaaa1111-0000-0000-0000-000000000001', 'Foreign', 'other')
$$, '42501', NULL, 'and cannot add a bin to project A');

SELECT throws_ok($$
  INSERT INTO public.bin_locations (workspace_id, name, unc_path)
  VALUES ('11111111-1111-1111-1111-111111111111', 'Foreign', '\\theirs\share')
$$, '42501', NULL, 'nor a location to workspace A');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SET LOCAL ROLE anon;

SELECT throws_ok($$ SELECT count(*) FROM public.bins $$, '42501', NULL, 'anon cannot read bins');
SELECT throws_ok($$ SELECT count(*) FROM public.bin_locations $$, '42501', NULL, 'anon cannot read bin_locations');

RESET ROLE;


-- ── 59-66: PRIVATE projects (§7's hop through projects_select) ────────────
-- user_f (workspace manager) creates a private project and adds a bin to it
-- (the owner control). user_d, seated MANAGER on it by postgres, can neither
-- see that bin nor add one — while on the PUBLIC project the same user_d
-- can (the control).

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok($$
  INSERT INTO public.projects (id, workspace_id, title, is_private)
  VALUES ('aaaa1111-0000-0000-0000-000000000093',
          '11111111-1111-1111-1111-111111111111', 'Private P93', true)
$$, 'SETUP: a workspace manager creates a private project (created_by stamped by fn_audit_touch)');

SELECT lives_ok($$
  INSERT INTO public.bins (id, project_id, name, kind)
  VALUES ('93930000-0000-0000-0000-000000000006', 'aaaa1111-0000-0000-0000-000000000093', 'Private bin', 'footage')
$$, 'OWNER CONTROL: the creator adds a bin to their private project');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

INSERT INTO public.project_members
  (project_id, user_id, workspace_id, project_role)
VALUES ('aaaa1111-0000-0000-0000-000000000093', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        '11111111-1111-1111-1111-111111111111', 'manager')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*)::int FROM public.bins WHERE project_id = 'aaaa1111-0000-0000-0000-000000000093'),
  0, 'a manager SEATED on a private project they cannot see reads none of its bins');

-- workspace_id is SENT, not derived: the populate trigger would read the
-- project under the caller's RLS and leave it NULL, refusing for the wrong
-- reason — the HOP is what this probe pins (breaker B9).
SELECT throws_ok($$
  INSERT INTO public.bins (project_id, workspace_id, name, kind)
  VALUES ('aaaa1111-0000-0000-0000-000000000093', '11111111-1111-1111-1111-111111111111', 'Leaked id', 'other')
$$, '42501', NULL, 'and cannot add a bin to it with its id and workspace (the write policy hops through projects_select)');

SELECT throws_ok($$
  INSERT INTO public.bin_files (project_id, workspace_id, bin_id, location_id, relative_path, display_name, original_name)
  VALUES ('aaaa1111-0000-0000-0000-000000000093', '11111111-1111-1111-1111-111111111111',
          '93930000-0000-0000-0000-000000000006', '93930000-0000-0000-0000-00000000000a', 'A001/leak.mov', 'leak', 'leak.mov')
$$, '42501', NULL, 'nor a clip into its bin (bin_files_insert hops too; breaker B13)');

WITH upd AS (
  UPDATE public.bins SET name = 'renamed' WHERE id = '93930000-0000-0000-0000-000000000006' RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 0, 'nor rename its bin (filtered)');

SELECT is((SELECT count(*)::int FROM public.bins WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  5, 'CONTROL: the same user_d reads the PUBLIC project''s bins');

SELECT lives_ok($$
  INSERT INTO public.bins (id, project_id, name, kind)
  VALUES ('93930000-0000-0000-0000-000000000007', 'aaaa1111-0000-0000-0000-000000000001', 'Public, by d', 'stills')
$$, 'CONTROL: and adds a bin to the public project');


-- ── 67-71: THE SWITCH (§1, B5a) — a member cannot flip it; an admin can ─────

WITH upd AS (
  UPDATE public.workspaces SET remote_viewing_enabled = true
   WHERE id = '11111111-1111-1111-1111-111111111111' RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 0, 'a MEMBER''s flip of remote_viewing_enabled changes nothing (workspaces_admin_update, 0020)');

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

WITH upd AS (
  UPDATE public.workspaces SET remote_viewing_enabled = true
   WHERE id = '11111111-1111-1111-1111-111111111111' RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 0, 'the OTHER workspace''s admin''s flip changes nothing');

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

SELECT is((SELECT remote_viewing_enabled FROM public.workspaces WHERE id = '11111111-1111-1111-1111-111111111111'),
  false, 'the switch is still off (neither attempt landed)');

WITH upd AS (
  UPDATE public.workspaces SET remote_viewing_enabled = true
   WHERE id = '11111111-1111-1111-1111-111111111111' RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 1, 'the workspace''s own ADMIN flips it');

SELECT is((SELECT public.rabbit_remote_viewing_enabled('aaaa1111-0000-0000-0000-000000000001')),
  true, 'and rabbit_remote_viewing_enabled() reads it for the project');


-- ── 72-83: THE RPCs (§10) — as the admin ───────────────────────────────────

-- add_bin_files: two items, one under a sub-bin path, into the Footage bin.
SELECT lives_ok($$
  SELECT public.add_bin_files('93930000-0000-0000-0000-000000000001'::uuid, $j$[
    {"location_id": "93930000-0000-0000-0000-00000000000a", "relative_path": "A002/A002_C001.mov",
     "original_name": "A002_C001.mov", "extension": ".mov", "media_type": "video", "sub_bin": "Day 2/A cam",
     "size_bytes": 1234, "duration_sec": 12.5, "take_number": 3, "tags": ["camera-original"]},
    {"location_id": "93930000-0000-0000-0000-00000000000a", "relative_path": "A002/sound.wav",
     "original_name": "sound.wav", "extension": ".wav", "media_type": "audio"}
  ]$j$::jsonb, true)
$$, 'add_bin_files accepts two items, one under a sub-bin path');

SELECT is((SELECT count(*)::int FROM public.bins b
            WHERE b.project_id = 'aaaa1111-0000-0000-0000-000000000001' AND b.name IN ('Day 2', 'A cam')),
  2, 'the sub-bin path made two nested bins');

SELECT is((SELECT b.name FROM public.bin_files f JOIN public.bins b ON b.id = f.bin_id
            WHERE f.relative_path = 'A002/A002_C001.mov'),
  'A cam', 'the clip landed in the innermost sub-bin');

SELECT is((SELECT f.display_name || '|' || f.take_number::text || '|' || f.tags[1]
             FROM public.bin_files f WHERE f.relative_path = 'A002/A002_C001.mov'),
  'A002_C001|3|camera-original', 'the display name was derived from the file name; the logging kept');

SELECT is((SELECT (public.add_bin_files('93930000-0000-0000-0000-000000000001'::uuid, $j$[
    {"location_id": "93930000-0000-0000-0000-00000000000f", "relative_path": "x/y.mov"}
  ]$j$::jsonb, true) -> 'results' -> 0 ->> 'status')),
  'invalid', 'an item naming a location that is not this company''s is reported invalid, not written');

-- reorder_bins: the child becomes a root and its old parent goes under it —
-- a real reorder that passes THROUGH a loop if parents were not detached first.
SELECT lives_ok($$
  SELECT public.reorder_bins($j$[
    {"id": "93930000-0000-0000-0000-000000000002", "parent_bin_id": null, "sort_order": 0},
    {"id": "93930000-0000-0000-0000-000000000001", "parent_bin_id": "93930000-0000-0000-0000-000000000002", "sort_order": 0}
  ]$j$::jsonb)
$$, 'reorder_bins swaps a parent and its child without a false cycle refusal');

SELECT is((SELECT parent_bin_id FROM public.bins WHERE id = '93930000-0000-0000-0000-000000000001'),
  '93930000-0000-0000-0000-000000000002'::uuid, 'the old parent now sits under its old child');

SELECT throws_ok($$
  SELECT public.reorder_bins($j$[
    {"id": "93930000-0000-0000-0000-000000000002", "parent_bin_id": "93930000-0000-0000-0000-000000000001", "sort_order": 0}
  ]$j$::jsonb)
$$, '23514', 'a bin cannot be inside itself', 'a reorder that would close a real loop is refused');

-- move / copy
SELECT is((SELECT jsonb_array_length(public.move_bin_files(
    ARRAY['93930000-0000-0000-0000-000000000011'::uuid], '93930000-0000-0000-0000-000000000004'::uuid, NULL) -> 'moved')),
  1, 'move_bin_files moves a clip to another bin');

SELECT is((SELECT bin_id FROM public.bin_files WHERE id = '93930000-0000-0000-0000-000000000011'),
  '93930000-0000-0000-0000-000000000004'::uuid, 'and the row says so');

SELECT lives_ok($$
  SELECT public.copy_bin_files(ARRAY['93930000-0000-0000-0000-000000000011'::uuid], '93930000-0000-0000-0000-000000000005'::uuid)
$$, 'copy_bin_files makes an INSTANCE: a second row with the same address');

SELECT is((SELECT count(*)::int FROM public.bin_files
            WHERE relative_path = 'A001/A001_C001.mov' AND project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  2, 'two rows now share the one file (and the one poster key)');


-- ── 84-91: delete_bin, the cascade and the poster's disposal (§3, §6, §10) ─

-- The Member's bin holds clip 11 (with a poster key). delete_bin in MOVE mode
-- re-homes it; then remove mode on the receiving bin removes the row. The
-- poster is queued only once NO row names it: the copy in the Manager's bin
-- still does, so the first delete queues nothing and the copy's delete does.
SELECT is((SELECT jsonb_array_length(public.delete_bin('93930000-0000-0000-0000-000000000004'::uuid, 'move',
                                                       '93930000-0000-0000-0000-000000000007'::uuid) -> 'movedFiles')),
  1, 'delete_bin in move mode re-homes the bin''s clip');

SELECT is((SELECT bin_id FROM public.bin_files WHERE id = '93930000-0000-0000-0000-000000000011'),
  '93930000-0000-0000-0000-000000000007'::uuid, 'the clip is in the target bin and its bin is gone');

SELECT throws_ok($$
  SELECT public.delete_bin('93930000-0000-0000-0000-000000000007'::uuid, 'move', '93930000-0000-0000-0000-000000000007'::uuid)
$$, '22023', NULL, 'a move INTO the deleted bin itself is refused');

SELECT is((SELECT jsonb_array_length(public.delete_bin('93930000-0000-0000-0000-000000000007'::uuid, 'remove', NULL) -> 'removedFiles')),
  1, 'delete_bin in remove mode reports the clip it took');

SELECT is((SELECT count(*)::int FROM public.bin_files WHERE id = '93930000-0000-0000-0000-000000000011'),
  0, 'the clip''s row went with its bin (CASCADE) — the file on the server did not');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
SELECT is((SELECT count(*)::int FROM public.storage_gc_queue
            WHERE bucket_id = 'rabbit-thumbnails' AND kind = 'thumbnail' AND status = 'pending'
              AND object_path = 'projects/aaaa1111-0000-0000-0000-000000000001/bin_files/93930000-0000-0000-0000-000000000011/1-poster.jpg'),
  0, 'its poster is NOT queued while the instance in the Manager''s bin still names it (§6)');

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

WITH del AS (
  DELETE FROM public.bin_files
   WHERE bin_id = '93930000-0000-0000-0000-000000000005' AND relative_path = 'A001/A001_C001.mov' RETURNING 1)
SELECT is((SELECT count(*)::int FROM del), 1, 'the admin removes the instance too');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
SELECT is((SELECT count(*)::int FROM public.storage_gc_queue
            WHERE bucket_id = 'rabbit-thumbnails' AND kind = 'thumbnail' AND status = 'pending'
              AND object_path = 'projects/aaaa1111-0000-0000-0000-000000000001/bin_files/93930000-0000-0000-0000-000000000011/1-poster.jpg'),
  1, 'and now, with no row naming it, the poster is queued for disposal (§6)');


-- ── 92-98: restore, and the RPCs for a reader past the hop but not the gate ─

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT is((SELECT public.restore_bin_files($j$[
    {"id": "93930000-0000-0000-0000-000000000011", "bin_id": "93930000-0000-0000-0000-000000000005",
     "location_id": "93930000-0000-0000-0000-00000000000a", "relative_path": "A001/A001_C001.mov",
     "display_name": "A001_C001", "original_name": "A001_C001.mov", "extension": ".mov", "media_type": "video",
     "review_flag": "select", "added_by": "cccccccc-cccc-cccc-cccc-cccccccccccc"}
  ]$j$::jsonb) -> 'restored' -> 0 ->> 'id'),
  '93930000-0000-0000-0000-000000000011', 'restore_bin_files puts a removed row back with its own id');

SELECT is((SELECT added_by FROM public.bin_files WHERE id = '93930000-0000-0000-0000-000000000011'),
  'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'who added it is kept on the way back (B11)');

SELECT is((SELECT public.restore_bin_files($j$[
    {"id": "93930000-0000-0000-0000-000000000099", "bin_id": "93930000-0000-0000-0000-000000000007",
     "location_id": "93930000-0000-0000-0000-00000000000a", "relative_path": "A001/gone.mov", "display_name": "gone"}
  ]$j$::jsonb) -> 'skipped' -> 0 ->> 'reason'),
  'bin_gone', 'a row whose bin was deleted meanwhile is REPORTED, not dropped');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT throws_ok($$
  SELECT public.delete_bin('93930000-0000-0000-0000-000000000005'::uuid, 'remove', NULL)
$$, '42501', NULL, 'delete_bin for a reader past the SELECT hop but not the gate is a refusal, not a quiet 200');

SELECT throws_ok($$
  SELECT public.add_bin_files('93930000-0000-0000-0000-000000000005'::uuid, $j$[
    {"location_id": "93930000-0000-0000-0000-00000000000a", "relative_path": "A001/no_seat.mov"}
  ]$j$::jsonb, true)
$$, '42501', NULL, 'add_bin_files for the same reader is refused by bin_files_insert');

SELECT throws_ok($$
  SELECT public.move_bin_files(ARRAY['93930000-0000-0000-0000-000000000011'::uuid], '93930000-0000-0000-0000-000000000001'::uuid, NULL)
$$, '42501', NULL, 'move_bin_files for the same reader is refused');

SELECT throws_ok($$
  SELECT public.reorder_bins($j$[{"id": "93930000-0000-0000-0000-000000000005", "parent_bin_id": null, "sort_order": 9}]$j$::jsonb)
$$, '42501', NULL, 'reorder_bins for the same reader is refused');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);

SELECT * FROM finish();
ROLLBACK;
