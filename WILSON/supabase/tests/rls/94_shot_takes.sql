-- =============================================================================
-- 94_shot_takes.sql — migration 0091 (Bins on the cloud, bundle BC1,
-- 2026-10-07): shot_takes under RLS, the take RPCs and their invariant, and
-- THE POSTER POLICY BOTH WAYS (Audrey's B4: "never take images when external
-- access is denied").
--
-- What this pins (each probe names the 0091 section it holds to):
--   * Structure (§5, §7d, §8): the table, RLS enabled AND forced, exactly four
--     policies by NAME, the realtime trigger; the RPCs exist with the
--     argument lists the client sends.
--   * THE INVARIANT (§10c–§10h), driven through the RPCs as the desktop
--     drives rabbitBins.cjs: the first take a shot gets is its primary and
--     later ones alt; a pair already assigned is skipped; asking for primary
--     demotes the current one; promoting SWAPS roles; demoting the primary
--     hands the role to the next in order; the only take of a shot stays
--     primary whatever is asked; position moves a take within its shot; a
--     reorder keeps the unnamed takes in their old order and refuses ids
--     that are none of the shot's; removing the primary promotes the next;
--     replace_shot_takes puts rows back with their ids and roles.
--   * Constraints (§5): (shot, file) once; a take cannot point at another
--     project's shot (the same-project composite FK); CASCADE from the file
--     and from the shot.
--   * THE GATE (§7d, B6): a REVIEWER assigns; a workspace user with NO seat
--     reads the takes and is refused every RPC with 42501 (never a quiet
--     200: each RPC probes its write first); the other workspace's admin
--     sees none; anon holds nothing.
--   * 🚨 THE POSTER POLICY, BOTH WAYS (§9, B4 — a DATABASE rule): with the
--     switch OFF a bin file's poster is REFUSED by name
--     (petal_bin_posters_remote_viewing_insert — a RESTRICTIVE denial names
--     its policy, suite 65's measurement) while an ordinary entity's
--     thumbnail and a rabbit-files object with the same key shape still land
--     (the self-limiting arms); with the switch ON the poster lands, is
--     regenerated in place, a MEMBER and a REVIEWER (B6, the permissive
--     pair) write theirs, and a workspace user with no seat is still refused;
--     OFF again, an in-place regeneration is filtered to zero rows and a new
--     poster refused — while the EXISTING poster stays readable by a project
--     member (reading follows membership, never the switch) and invisible to
--     the other workspace. The two restrictive policies are asserted
--     RESTRICTIVE in the catalogue (dropping the keyword leaves a valid
--     policy that enforces nothing — 0055's B1), and the rabbit_thumbnails%
--     neighbours are untouched at 8.
--
-- A planted copy of 0091 without the switch arm is caught by probes 43, 53
-- and 54 (the OFF refusals); one without AS RESTRICTIVE by 57 and 58 and
-- again by 43 — recorded in the BC1 hand-off's breaker table.
--
-- Every write whose effect a later probe reads is its OWN statement: a
-- data-changing function called inside the probe's query would run against
-- that query's snapshot and the probe would read the state before it.
--
-- Postgres-side reads are ALWAYS scoped to fixture ids — dev carries real
-- projects.
-- =============================================================================

BEGIN;

SELECT plan(63);

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
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'user_e@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','user','user_c','User C',true),
  ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','user','user_d','User D',true),
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','user','user_e','User E',true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.project_members
  (project_id, user_id, workspace_id, project_role)
VALUES
  ('aaaa1111-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1111-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;

-- A shot in the OTHER workspace's project, for the cross-project FK probe.
INSERT INTO public.scenes (id, project_id, workspace_id, name, scene_number)
VALUES ('94940000-0000-0000-0000-00000000bc01', 'bbbb2222-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222', 'B scene', 1);
INSERT INTO public.shots (id, project_id, workspace_id, scene_id, name, shot_number)
VALUES ('94940000-0000-0000-0000-00000000bb01', 'bbbb2222-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222', '94940000-0000-0000-0000-00000000bc01', 'B shot', 10);


-- ── 1-5: structure (§5, §7d, §8) ───────────────────────────────────────────

SELECT has_table('public'::name, 'shot_takes'::name, 'shot_takes exists (§5)');
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.shot_takes'::regclass),
  'shot_takes has RLS enabled and forced (§7d)');
SELECT is(
  (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'shot_takes'),
  ARRAY['shot_takes_delete', 'shot_takes_insert', 'shot_takes_select', 'shot_takes_update'],
  'shot_takes has exactly select / insert / update / delete (§7d)');
SELECT has_trigger('public', 'shot_takes', 'trg_shot_takes_realtime', 'takes are broadcast (§8, B7)');
-- The trigger can be attached while the body has no arm for the table: then
-- v_project is NULL and nothing is broadcast, with no error (0077's lesson).
-- Comments stripped first; each name once (CASE takes the first match).
SELECT ok((
  SELECT bool_and(h = 1) FROM (
    SELECT (length(b) - length(replace(b, '''' || t || '''', ''))) / length('''' || t || '''') AS h
      FROM (SELECT regexp_replace(regexp_replace(pg_get_functiondef('public.fn_realtime_broadcast()'::regprocedure),
                                                 '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g') AS b) body,
           unnest(ARRAY['bins', 'bin_files', 'shot_takes']) AS t) hits),
  'fn_realtime_broadcast names bins, bin_files and shot_takes exactly once each (§8; breaker B10)');


-- ── 6-29: the invariant through the RPCs, as the workspace admin ───────────

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

INSERT INTO public.scenes (id, project_id, name, scene_number)
VALUES ('94940000-0000-0000-0000-000000000c01', 'aaaa1111-0000-0000-0000-000000000001', 'WLSN_SC094', 94);
INSERT INTO public.shots (id, project_id, scene_id, name, shot_number)
VALUES ('94940000-0000-0000-0000-000000000501', 'aaaa1111-0000-0000-0000-000000000001', '94940000-0000-0000-0000-000000000c01', 'SH0010', 10),
       ('94940000-0000-0000-0000-000000000502', 'aaaa1111-0000-0000-0000-000000000001', '94940000-0000-0000-0000-000000000c01', 'SH0020', 20),
       ('94940000-0000-0000-0000-000000000503', 'aaaa1111-0000-0000-0000-000000000001', '94940000-0000-0000-0000-000000000c01', 'SH0030', 30);
INSERT INTO public.bin_locations (id, workspace_id, name, unc_path)
VALUES ('94940000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Footage NAS', '\\nas\footage');
INSERT INTO public.bins (id, project_id, name, kind)
VALUES ('94940000-0000-0000-0000-000000000b01', 'aaaa1111-0000-0000-0000-000000000001', 'Footage', 'footage');
INSERT INTO public.bin_files (id, project_id, bin_id, location_id, relative_path, display_name, original_name, extension, media_type)
VALUES
  ('94940000-0000-0000-0000-000000000f01', 'aaaa1111-0000-0000-0000-000000000001', '94940000-0000-0000-0000-000000000b01',
   '94940000-0000-0000-0000-00000000000a', 'A001/T1.mov', 'T1', 'T1.mov', '.mov', 'video'),
  ('94940000-0000-0000-0000-000000000f02', 'aaaa1111-0000-0000-0000-000000000001', '94940000-0000-0000-0000-000000000b01',
   '94940000-0000-0000-0000-00000000000a', 'A001/T2.mov', 'T2', 'T2.mov', '.mov', 'video'),
  ('94940000-0000-0000-0000-000000000f03', 'aaaa1111-0000-0000-0000-000000000001', '94940000-0000-0000-0000-000000000b01',
   '94940000-0000-0000-0000-00000000000a', 'A001/T3.mov', 'T3', 'T3.mov', '.mov', 'video');

-- 5-7: the first take a shot gets is its primary; the next is alt; 0..n-1.
SELECT is((SELECT jsonb_array_length(public.assign_shot_takes($j$[
    {"shot_id": "94940000-0000-0000-0000-000000000501", "bin_file_id": "94940000-0000-0000-0000-000000000f01"},
    {"shot_id": "94940000-0000-0000-0000-000000000501", "bin_file_id": "94940000-0000-0000-0000-000000000f02"}
  ]$j$::jsonb) -> 'created')),
  2, 'assign_shot_takes creates two takes on one shot');
SELECT is((SELECT array_agg(role ORDER BY position) FROM public.shot_takes WHERE shot_id = '94940000-0000-0000-0000-000000000501'),
  ARRAY['primary', 'alt'], 'the first is primary, the second alt');
SELECT is((SELECT array_agg(position ORDER BY position) FROM public.shot_takes WHERE shot_id = '94940000-0000-0000-0000-000000000501'),
  ARRAY[0, 1], 'positions read 0..n-1');

-- 8: a pair already assigned is skipped, never duplicated.
SELECT is((SELECT public.assign_shot_takes($j$[
    {"shot_id": "94940000-0000-0000-0000-000000000501", "bin_file_id": "94940000-0000-0000-0000-000000000f01"}
  ]$j$::jsonb) -> 'skipped' -> 0 ->> 'reason'),
  'already_assigned', 'the same pair again is reported skipped');

-- 9-10: asking for primary demotes the current one.
SELECT lives_ok($$
  SELECT public.assign_shot_takes($j$[
    {"shot_id": "94940000-0000-0000-0000-000000000501", "bin_file_id": "94940000-0000-0000-0000-000000000f03", "role": "primary"}
  ]$j$::jsonb)
$$, 'a third take asks to be primary');
SELECT is((SELECT array_agg(bin_file_id::text ORDER BY bin_file_id) FROM public.shot_takes
            WHERE shot_id = '94940000-0000-0000-0000-000000000501' AND role = 'primary'),
  ARRAY['94940000-0000-0000-0000-000000000f03'], 'it is, and it is the ONLY primary (the old one is alt)');

-- 11-12: promoting SWAPS roles with the current primary.
SELECT lives_ok($$
  SELECT public.update_shot_take(
    (SELECT id FROM public.shot_takes WHERE bin_file_id = '94940000-0000-0000-0000-000000000f01' AND shot_id = '94940000-0000-0000-0000-000000000501'),
    '{"role": "primary"}'::jsonb)
$$, 'T1 is promoted to primary');
SELECT is((SELECT array_agg(t.role ORDER BY t.bin_file_id) FROM public.shot_takes t
            WHERE t.shot_id = '94940000-0000-0000-0000-000000000501'
              AND t.bin_file_id IN ('94940000-0000-0000-0000-000000000f01', '94940000-0000-0000-0000-000000000f03')),
  ARRAY['primary', 'alt'], 'the roles SWAPPED: T1 primary, T3 alt');

-- 13-14: position moves a take within its shot.
SELECT lives_ok($$
  SELECT public.update_shot_take(
    (SELECT id FROM public.shot_takes WHERE bin_file_id = '94940000-0000-0000-0000-000000000f02' AND shot_id = '94940000-0000-0000-0000-000000000501'),
    '{"position": 0}'::jsonb)
$$, 'T2 is moved to position 0');
SELECT is((SELECT array_agg(t.bin_file_id::text ORDER BY t.position) FROM public.shot_takes t
            WHERE t.shot_id = '94940000-0000-0000-0000-000000000501'),
  ARRAY['94940000-0000-0000-0000-000000000f02', '94940000-0000-0000-0000-000000000f01', '94940000-0000-0000-0000-000000000f03'],
  'and the others shifted down');

-- 15-16: demoting the primary hands the role to the next in order.
SELECT lives_ok($$
  SELECT public.update_shot_take(
    (SELECT id FROM public.shot_takes WHERE bin_file_id = '94940000-0000-0000-0000-000000000f01' AND shot_id = '94940000-0000-0000-0000-000000000501'),
    '{"role": "alt"}'::jsonb)
$$, 'T1, the primary, is demoted to alt');
SELECT is((SELECT t.bin_file_id FROM public.shot_takes t
            WHERE t.shot_id = '94940000-0000-0000-0000-000000000501' AND t.role = 'primary'),
  '94940000-0000-0000-0000-000000000f02'::uuid, 'T2, first in order, is the primary now');

-- 17: notes.
SELECT is((SELECT public.update_shot_take(
             (SELECT id FROM public.shot_takes WHERE bin_file_id = '94940000-0000-0000-0000-000000000f03' AND shot_id = '94940000-0000-0000-0000-000000000501'),
             '{"notes": "keep for the trailer"}'::jsonb) -> 'take' ->> 'notes'),
  'keep for the trailer', 'notes are written and read back on the take');

-- 18-20: the only take of a shot stays primary whatever is asked.
SELECT lives_ok($$
  SELECT public.assign_shot_takes($j$[
    {"shot_id": "94940000-0000-0000-0000-000000000502", "bin_file_id": "94940000-0000-0000-0000-000000000f01"}
  ]$j$::jsonb)
$$, 'a second shot gets its one take');
SELECT lives_ok($$
  SELECT public.update_shot_take(
    (SELECT id FROM public.shot_takes WHERE shot_id = '94940000-0000-0000-0000-000000000502'),
    '{"role": "alt"}'::jsonb)
$$, 'it is asked to be an alt');
SELECT is((SELECT t.role FROM public.shot_takes t WHERE t.shot_id = '94940000-0000-0000-0000-000000000502'),
  'primary', 'a shot''s only take stays primary');

-- 21-23: reorder.
SELECT lives_ok($$
  SELECT public.reorder_shot_takes('94940000-0000-0000-0000-000000000501'::uuid,
    ARRAY[(SELECT id FROM public.shot_takes WHERE bin_file_id = '94940000-0000-0000-0000-000000000f03' AND shot_id = '94940000-0000-0000-0000-000000000501')])
$$, 'T3 is put first');
SELECT is((SELECT array_agg(t.bin_file_id::text ORDER BY t.position) FROM public.shot_takes t
            WHERE t.shot_id = '94940000-0000-0000-0000-000000000501'),
  ARRAY['94940000-0000-0000-0000-000000000f03', '94940000-0000-0000-0000-000000000f02', '94940000-0000-0000-0000-000000000f01'],
  'reorder_shot_takes puts the listed take first and the rest in their old order');
SELECT throws_ok($$
  SELECT public.reorder_shot_takes('94940000-0000-0000-0000-000000000501'::uuid, ARRAY['94940000-0000-0000-0000-0000000000ff'::uuid])
$$, '22023', 'none of the ids is a take of that shot', 'a reorder naming no take of the shot is a caller''s mistake, not an order');

-- 24-26: remove.
SELECT is((SELECT jsonb_array_length(public.remove_shot_takes(
    ARRAY[(SELECT id FROM public.shot_takes WHERE bin_file_id = '94940000-0000-0000-0000-000000000f02' AND shot_id = '94940000-0000-0000-0000-000000000501')]) -> 'removed')),
  1, 'remove_shot_takes unassigns the primary (T2)');
SELECT is((SELECT t.bin_file_id FROM public.shot_takes t WHERE t.shot_id = '94940000-0000-0000-0000-000000000501' AND t.role = 'primary'),
  '94940000-0000-0000-0000-000000000f03'::uuid, 'and the next in order (T3, at position 0) is promoted');
SELECT throws_ok($$
  SELECT public.remove_shot_takes(ARRAY['94940000-0000-0000-0000-0000000000ff'::uuid])
$$, 'P0002', 'shot-take not found', 'removing an id that is no take is said');

-- 27-28: replace — the undo primitive.
SELECT is((SELECT jsonb_array_length(public.replace_shot_takes(ARRAY['94940000-0000-0000-0000-000000000501'::uuid], $j$[
    {"id": "94940000-0000-0000-0000-00000000aa01", "shot_id": "94940000-0000-0000-0000-000000000501", "bin_file_id": "94940000-0000-0000-0000-000000000f02", "role": "part", "position": 0},
    {"shot_id": "94940000-0000-0000-0000-000000000501", "bin_file_id": "94940000-0000-0000-0000-000000000f01", "role": "primary", "position": 1}
  ]$j$::jsonb) -> 'shotTakes')),
  2, 'replace_shot_takes makes the shot''s rows exactly the two given');
SELECT is((SELECT role || '|' || position::text FROM public.shot_takes WHERE id = '94940000-0000-0000-0000-00000000aa01'),
  'part|0', 'a given id and role are kept (a part stays a part beside the explicit primary)');


-- ── 30-31: constraints (§5) ────────────────────────────────────────────────

SELECT throws_ok($$
  INSERT INTO public.shot_takes (project_id, shot_id, bin_file_id, role, position)
  VALUES ('aaaa1111-0000-0000-0000-000000000001', '94940000-0000-0000-0000-000000000501',
          '94940000-0000-0000-0000-000000000f02', 'alt', 5)
$$, '23505', NULL, 'a (shot, file) pair is held once');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT throws_ok($$
  INSERT INTO public.shot_takes (project_id, workspace_id, shot_id, bin_file_id, role, position)
  VALUES ('aaaa1111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
          '94940000-0000-0000-0000-00000000bb01', '94940000-0000-0000-0000-000000000f03', 'alt', 0)
$$, '23503', NULL, 'a take cannot point at another project''s shot (the same-project composite FK) — even as postgres');


-- ── 32-40: the gate (B6), tenancy, anon ────────────────────────────────────

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;

SELECT lives_ok($$
  SELECT public.assign_shot_takes($j$[
    {"shot_id": "94940000-0000-0000-0000-000000000503", "bin_file_id": "94940000-0000-0000-0000-000000000f02"}
  ]$j$::jsonb)
$$, 'a REVIEWER assigns a take (B6)');

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

SELECT is((SELECT count(*)::int FROM public.shot_takes WHERE shot_id = '94940000-0000-0000-0000-000000000501'),
  2, 'a workspace user with no seat READS the takes');
SELECT throws_ok($$
  SELECT public.assign_shot_takes($j$[
    {"shot_id": "94940000-0000-0000-0000-000000000503", "bin_file_id": "94940000-0000-0000-0000-000000000f01"}
  ]$j$::jsonb)
$$, '42501', NULL, 'but cannot assign one');
SELECT throws_ok($$
  SELECT public.update_shot_take('94940000-0000-0000-0000-00000000aa01'::uuid, '{"notes": "x"}'::jsonb)
$$, '42501', NULL, 'cannot change one (the RPC probes its write first: a filtered UPDATE is said, not swallowed)');
SELECT throws_ok($$
  SELECT public.remove_shot_takes(ARRAY['94940000-0000-0000-0000-00000000aa01'::uuid])
$$, '42501', NULL, 'cannot remove one');
SELECT throws_ok($$
  SELECT public.reorder_shot_takes('94940000-0000-0000-0000-000000000501'::uuid, ARRAY['94940000-0000-0000-0000-00000000aa01'::uuid])
$$, '42501', NULL, 'cannot reorder them');
SELECT throws_ok($$
  SELECT public.replace_shot_takes(ARRAY['94940000-0000-0000-0000-000000000501'::uuid], $j$[
    {"shot_id": "94940000-0000-0000-0000-000000000501", "bin_file_id": "94940000-0000-0000-0000-000000000f01"}
  ]$j$::jsonb)
$$, '42501', NULL, 'cannot replace them');

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
SELECT is((SELECT count(*)::int FROM public.shot_takes WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001'),
  0, 'the other workspace''s admin sees no take of project A');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT count(*) FROM public.shot_takes $$, '42501', NULL, 'anon cannot read shot_takes');
RESET ROLE;


-- ── 41-42: the cascades (§5) ───────────────────────────────────────────────

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'role', 'authenticated',
  'app_metadata', json_build_object(
    'workspace_id', '11111111-1111-1111-1111-111111111111',
    'app_role', 'admin')
)::text, true);
SET LOCAL ROLE authenticated;

DELETE FROM public.bin_files WHERE id = '94940000-0000-0000-0000-000000000f01';
SELECT is((SELECT count(*)::int FROM public.shot_takes WHERE bin_file_id = '94940000-0000-0000-0000-000000000f01'),
  0, 'removing a clip takes its takes with it (CASCADE from the file; T1 sat on two shots)');
DELETE FROM public.shots WHERE id = '94940000-0000-0000-0000-000000000501';
SELECT is((SELECT count(*)::int FROM public.shot_takes WHERE shot_id = '94940000-0000-0000-0000-000000000501'),
  0, 'deleting a shot takes its takes with it (CASCADE from the shot)');


-- ── 43-56: THE POSTER POLICY, BOTH WAYS (§9, B4) ───────────────────────────

-- 42: the switch is OFF (its default). The caller is a workspace ADMIN, so
-- every permissive arm passes; the ONLY thing that can refuse this is the
-- restrictive switch policy — and a restrictive denial names its policy.
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-thumbnails',
            'projects/aaaa1111-0000-0000-0000-000000000001/bin_files/94940000-0000-0000-0000-000000000f02/1-poster.jpg',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"image/jpeg"}'::jsonb)$$,
  '42501',
  'new row violates row-level security policy "petal_bin_posters_remote_viewing_insert" for table "objects"',
  'SWITCH OFF: a bin file''s poster is REFUSED, by the switch policy''s own name (B4)');

-- 43-44: the self-limiting arms — another entity's thumbnail, and the same
-- key shape in another bucket, still land while the switch is off.
SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-thumbnails',
            'projects/aaaa1111-0000-0000-0000-000000000001/assets/a1/1-dailies.mov.jpg',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"image/jpeg"}'::jsonb)$$,
  'SWITCH OFF: an ordinary entity''s thumbnail still lands (the entity-segment arm)');
SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-files',
            'projects/aaaa1111-0000-0000-0000-000000000001/bin_files/94940000-0000-0000-0000-000000000f02/1-notes.txt',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"text/plain"}'::jsonb)$$,
  'SWITCH OFF: the same key shape in another bucket is not this policy''s business (the bucket arm)');

-- 45-47: ON — the poster lands and is regenerated in place.
WITH upd AS (
  UPDATE public.workspaces SET remote_viewing_enabled = true
   WHERE id = '11111111-1111-1111-1111-111111111111' RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 1, 'the admin turns remote viewing ON (B5a)');

SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-thumbnails',
            'projects/aaaa1111-0000-0000-0000-000000000001/bin_files/94940000-0000-0000-0000-000000000f02/1-poster.jpg',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"image/jpeg"}'::jsonb)$$,
  'SWITCH ON: the same poster now lands');

WITH upd AS (
  UPDATE storage.objects
     SET metadata = '{"mimetype":"image/jpeg","regenerated":true}'::jsonb
   WHERE bucket_id = 'rabbit-thumbnails'
     AND name = 'projects/aaaa1111-0000-0000-0000-000000000001/bin_files/94940000-0000-0000-0000-000000000f02/1-poster.jpg'
  RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 1, 'SWITCH ON: a poster is regenerated in place');

-- 48-50: a MEMBER and a REVIEWER write theirs (B6); a user with no seat cannot.
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
SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-thumbnails',
            'projects/aaaa1111-0000-0000-0000-000000000001/bin_files/94940000-0000-0000-0000-000000000f03/1-poster.jpg',
            'dddddddd-dddd-dddd-dddd-dddddddddddd',
            '{"mimetype":"image/jpeg"}'::jsonb)$$,
  'SWITCH ON: a MEMBER writes a poster');

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
SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-thumbnails',
            'projects/aaaa1111-0000-0000-0000-000000000001/bin_files/94940000-0000-0000-0000-000000000f03/2-poster.jpg',
            'cccccccc-cccc-cccc-cccc-cccccccccccc',
            '{"mimetype":"image/jpeg"}'::jsonb)$$,
  'SWITCH ON: a REVIEWER writes a poster (B6, the permissive pair past can_edit_shot_lists)');

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
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-thumbnails',
            'projects/aaaa1111-0000-0000-0000-000000000001/bin_files/94940000-0000-0000-0000-000000000f03/3-poster.jpg',
            'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
            '{"mimetype":"image/jpeg"}'::jsonb)$$,
  '42501', NULL, 'SWITCH ON: a workspace user with no seat is still refused (no permissive arm admits them)');

-- 51-53: OFF again — nothing new lands, nothing is regenerated.
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
WITH upd AS (
  UPDATE public.workspaces SET remote_viewing_enabled = false
   WHERE id = '11111111-1111-1111-1111-111111111111' RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 1, 'the admin turns remote viewing OFF again');

WITH upd AS (
  UPDATE storage.objects
     SET metadata = '{"mimetype":"image/jpeg","regenerated":2}'::jsonb
   WHERE bucket_id = 'rabbit-thumbnails'
     AND name = 'projects/aaaa1111-0000-0000-0000-000000000001/bin_files/94940000-0000-0000-0000-000000000f02/1-poster.jpg'
  RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 0, 'SWITCH OFF: an in-place regeneration is filtered to nothing (the restrictive USING)');

SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('rabbit-thumbnails',
            'projects/aaaa1111-0000-0000-0000-000000000001/bin_files/94940000-0000-0000-0000-000000000f02/2-poster.jpg',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"mimetype":"image/jpeg"}'::jsonb)$$,
  '42501',
  'new row violates row-level security policy "petal_bin_posters_remote_viewing_insert" for table "objects"',
  'SWITCH OFF: a new poster is refused again, by name');

-- 54-55: the EXISTING poster stays readable by a project member (reading
-- follows membership, never the switch) and invisible to the other workspace.
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
SELECT is((SELECT count(*)::int FROM storage.objects
            WHERE bucket_id = 'rabbit-thumbnails'
              AND name = 'projects/aaaa1111-0000-0000-0000-000000000001/bin_files/94940000-0000-0000-0000-000000000f02/1-poster.jpg'),
  1, 'SWITCH OFF: a project MEMBER still reads the poster that was made while it was on');

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
SELECT is((SELECT count(*)::int FROM storage.objects
            WHERE bucket_id = 'rabbit-thumbnails'
              AND name LIKE 'projects/aaaa1111-0000-0000-0000-000000000001/bin_files/%'),
  0, 'the other workspace''s admin reads no poster of project A');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);


-- ── 57-63: the policies' shape in the catalogue, and the RPCs ──────────────

SELECT is(
  (SELECT permissive || '|' || cmd FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'petal_bin_posters_remote_viewing_insert'),
  'RESTRICTIVE|INSERT',
  'the poster INSERT policy is RESTRICTIVE — permissive would OR with 0053''s and enforce nothing');
SELECT is(
  (SELECT permissive || '|' || cmd || '|' || CASE WHEN with_check IS NULL THEN 'no-check' ELSE 'check' END FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'petal_bin_posters_remote_viewing_update'),
  'RESTRICTIVE|UPDATE|check',
  'the poster UPDATE policy is RESTRICTIVE with a WITH CHECK arm');
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'rabbit_thumbnails%'),
  8, 'the rabbit_thumbnails% neighbours are untouched at 8 (0053 / 0055 count them)');

SELECT has_function('public', 'assign_shot_takes', ARRAY['jsonb'], 'assign_shot_takes(jsonb) exists (§10d)');
SELECT has_function('public', 'update_shot_take', ARRAY['uuid', 'jsonb'], 'update_shot_take(uuid, jsonb) exists (§10e)');
SELECT has_function('public', 'replace_shot_takes', ARRAY['uuid[]', 'jsonb'], 'replace_shot_takes(uuid[], jsonb) exists (§10h)');
SELECT has_function('public', 'delete_bin', ARRAY['uuid', 'text', 'uuid'], 'delete_bin(uuid, text, uuid) exists (§10i)');

SELECT * FROM finish();
ROLLBACK;
