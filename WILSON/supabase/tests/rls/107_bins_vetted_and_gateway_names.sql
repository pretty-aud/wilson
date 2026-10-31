-- =============================================================================
-- 107_bins_vetted_and_gateway_names.sql — migration 0104 (P8, night 5,
-- 2026-10-28): the vetted mark on bin_files and bin_locations
-- (TPN-AUTH-012) and gateways.inside_names (TPN-ENC-013's cloud half).
--
-- What this pins (each probe names the 0104 section it holds to):
--   * Structure (§1, §3, §4, §5): the four columns; the two triggers;
--     gateway_clips_for_tickets still SECURITY INVOKER; inside_names and its
--     CHECK.
--   * WHO MAY VET (§2, §3): an ADMIN's or a MANAGER's insert or re-point is
--     stamped (vetted_by = them); a REVIEWER still adds a clip and names a
--     location (B6, D8: lives_ok, as suite 93 pins them) and neither is
--     checked; a reviewer's clip inherits a checked twin's mark (the same
--     project, location and BYTE-EQUAL path) and not a case-different one;
--     a reviewer re-pointing an admin's clip clears its mark; a reviewer or
--     member setting or withdrawing a mark by hand is 42501; a copy inherits;
--     a reviewer's restore of their own unchecked row stays unchecked; a
--     manager marks and withdraws by hand, and re-points with a fresh stamp;
--     a member re-pointing a checked location clears it; a rename keeps it;
--     a client's supplied mark on INSERT is ignored; a non-client (postgres)
--     keeps what it supplies (the fixtures' way).
--   * THE GATEWAY (§4, §6, §7, §8), as the service role: gateway_sync_apply
--     confirms checked clips at checked locations only (never an unchecked
--     clip, never a checked clip at an unchecked location); the locations
--     list carries checked locations only; gateway_clips_for_tickets, as the
--     reviewer, answers the checked clip alone; inside_names stored at
--     enrolment (literals dropped) and at sync, exposed by gateways_visible to
--     a member, refused by the CHECK for a literal.
--
-- The failing controls, before 0104: every "is NULL" on a reviewer's row
-- read a missing column (42703); gateway_sync_apply confirmed the reviewer's
-- clip and listed the member's location; the mark probes had no column to
-- refuse (the 42501 asserted here is the trigger's, after).
--
-- Postgres-side reads are ALWAYS scoped to fixture ids — dev carries real
-- projects.
-- =============================================================================

BEGIN;

SELECT plan(61);

SELECT * FROM tests.rls_setup();

-- ── Extra fixtures (suite 93's cast) ───────────────────────────────────────
--   user_c  app_role 'user',    project_a REVIEWER
--   user_d  app_role 'user',    project_a MEMBER
--   user_f  app_role 'manager', no seat (the gate's manager leg; a VETTER)
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
  ('11111111-1111-1111-1111-111111111111','ffffffff-ffff-ffff-ffff-ffffffffffff','manager','user_f','User F',true)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET app_role = EXCLUDED.app_role, is_active = EXCLUDED.is_active;

INSERT INTO public.project_members
  (project_id, user_id, workspace_id, project_role)
VALUES
  ('aaaa1111-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'reviewer'),
  ('aaaa1111-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111', 'member')
ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;

-- The bin every clip below lands in, by postgres.
INSERT INTO public.bins (id, project_id, workspace_id, name, kind) VALUES
  ('10700000-0000-0000-0000-0000000000b1', 'aaaa1111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Day 107', 'footage');


-- ── 1-8: structure (§1, §3, §4, §5) ────────────────────────────────────────

SELECT has_column('public'::name, 'bin_files'::name, 'vetted_at'::name, 'bin_files.vetted_at exists (§1)');
SELECT has_column('public'::name, 'bin_files'::name, 'vetted_by'::name, 'bin_files.vetted_by exists (§1)');
SELECT has_column('public'::name, 'bin_locations'::name, 'vetted_at'::name, 'bin_locations.vetted_at exists (§1)');
SELECT has_column('public'::name, 'bin_locations'::name, 'vetted_by'::name, 'bin_locations.vetted_by exists (§1)');
SELECT has_trigger('public', 'bin_files', 'trg_bin_files_vet', 'the mark is decided by trg_bin_files_vet (§3)');
SELECT has_trigger('public', 'bin_locations', 'trg_bin_locations_vet', 'and by trg_bin_locations_vet (§3)');
SELECT ok(
  NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.gateway_clips_for_tickets(uuid[])'::regprocedure),
  'gateway_clips_for_tickets stays SECURITY INVOKER (§4; the S33 rule)');
SELECT ok(
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'gateways' AND column_name = 'inside_names')
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.gateways'::regclass AND conname = 'gateways_inside_names_chk'),
  'gateways.inside_names exists under gateways_inside_names_chk (§5)');


-- ── 9-12: the ADMIN names a location and adds a clip: both checked (§2, §3) ─

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
  VALUES ('10700000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Footage 107', '\\nas107\footage')
$$, 'an admin names a location');
SELECT is((SELECT vetted_by FROM public.bin_locations WHERE id = '10700000-0000-0000-0000-00000000000a'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'the admin''s location is checked, by them (§3)');

SELECT lives_ok($$
  INSERT INTO public.bin_files (id, project_id, bin_id, location_id, relative_path, display_name, original_name, extension, media_type)
  VALUES ('10700000-0000-0000-0000-0000000000f1', 'aaaa1111-0000-0000-0000-000000000001',
          '10700000-0000-0000-0000-0000000000b1', '10700000-0000-0000-0000-00000000000a',
          'A001/F1.mov', 'F1', 'F1.mov', '.mov', 'video')
$$, 'an admin adds a clip');
SELECT is((SELECT vetted_by FROM public.bin_files WHERE id = '10700000-0000-0000-0000-0000000000f1'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'the admin''s clip is checked, by them (§3)');


-- ── 13-25: the REVIEWER: B6 and D8 kept, nothing of theirs checked (§3) ────

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
  INSERT INTO public.bin_files (id, project_id, bin_id, location_id, relative_path, display_name, original_name, extension, media_type)
  VALUES ('10700000-0000-0000-0000-0000000000f2', 'aaaa1111-0000-0000-0000-000000000001',
          '10700000-0000-0000-0000-0000000000b1', '10700000-0000-0000-0000-00000000000a',
          'A001/F2.mov', 'F2', 'F2.mov', '.mov', 'video')
$$, 'a REVIEWER still adds a clip (B6, as suite 93 pins it)');
SELECT ok((SELECT vetted_at IS NULL AND vetted_by IS NULL FROM public.bin_files WHERE id = '10700000-0000-0000-0000-0000000000f2'),
  '🚨 but the reviewer''s clip is NOT checked: the gateway will not serve its path (§3)');

SELECT lives_ok($$
  INSERT INTO public.bin_locations (id, workspace_id, name, unc_path)
  VALUES ('10700000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Sound 107', '\\nas107\sound')
$$, 'a REVIEWER still names a location (D8)');
SELECT ok((SELECT vetted_at IS NULL FROM public.bin_locations WHERE id = '10700000-0000-0000-0000-00000000000b'),
  '🚨 but the reviewer''s location is NOT checked (§3)');

-- The twin: the admin's checked path, byte for byte, in the same project.
INSERT INTO public.bin_files (id, project_id, bin_id, location_id, relative_path, display_name, original_name, extension, media_type)
VALUES ('10700000-0000-0000-0000-0000000000f3', 'aaaa1111-0000-0000-0000-000000000001',
        '10700000-0000-0000-0000-0000000000b1', '10700000-0000-0000-0000-00000000000a',
        'A001/F1.mov', 'F1 again', 'F1.mov', '.mov', 'video');
SELECT is((SELECT vetted_by FROM public.bin_files WHERE id = '10700000-0000-0000-0000-0000000000f3'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'a reviewer''s row at a path the admin already checked inherits the admin''s mark (the same file, §3)');

-- Not a twin: the same letters in another case (another file on a case-sensitive mount).
INSERT INTO public.bin_files (id, project_id, bin_id, location_id, relative_path, display_name, original_name, extension, media_type)
VALUES ('10700000-0000-0000-0000-0000000000f9', 'aaaa1111-0000-0000-0000-000000000001',
        '10700000-0000-0000-0000-0000000000b1', '10700000-0000-0000-0000-00000000000a',
        'A001/f1.MOV', 'f1 lower', 'f1.MOV', '.mov', 'video');
SELECT ok((SELECT vetted_at IS NULL FROM public.bin_files WHERE id = '10700000-0000-0000-0000-0000000000f9'),
  '🚨 a case-different path is no twin: byte-equal only (the plan''s round, finding 2)');

SELECT throws_ok($$
  UPDATE public.bin_files SET vetted_at = now() WHERE id = '10700000-0000-0000-0000-0000000000f2'
$$, '42501', 'Only a workspace admin or manager can mark a clip as checked for the file gateway.',
  '🚨 a reviewer cannot mark their own clip as checked (§3)');

-- The copy of a checked row (the twin F3) is checked too: it is the same file.
-- Two checked rows share the path before the copy (F1 and F3); three after.
SELECT public.copy_bin_files(ARRAY['10700000-0000-0000-0000-0000000000f3'::uuid], '10700000-0000-0000-0000-0000000000b1'::uuid);
SELECT is((SELECT count(*)::int FROM public.bin_files
            WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001' AND relative_path = 'A001/F1.mov' AND vetted_at IS NOT NULL),
  3, 'a reviewer''s copy of a checked clip (an instance of the same file) inherits the mark (§3)');

-- A reviewer re-points the admin's clip: the mark goes with the old path.
WITH upd AS (UPDATE public.bin_files SET relative_path = 'A001/moved.mov'
              WHERE id = '10700000-0000-0000-0000-0000000000f1' RETURNING 1)
SELECT is((SELECT count(*)::int FROM upd), 1, 'a reviewer may still re-point a clip (0091''s policy)');
SELECT ok((SELECT vetted_at IS NULL AND vetted_by IS NULL FROM public.bin_files WHERE id = '10700000-0000-0000-0000-0000000000f1'),
  '🚨 and the re-pointed clip is no longer checked: a path a reviewer wrote is never served (§3)');

-- Their own removal, undone: back as it was, unchecked.
DELETE FROM public.bin_files WHERE id = '10700000-0000-0000-0000-0000000000f2';
SELECT is((SELECT public.restore_bin_files($j$[
    {"id": "10700000-0000-0000-0000-0000000000f2", "bin_id": "10700000-0000-0000-0000-0000000000b1",
     "location_id": "10700000-0000-0000-0000-00000000000a", "relative_path": "A001/F2.mov",
     "display_name": "F2", "original_name": "F2.mov", "extension": ".mov", "media_type": "video",
     "added_by": "cccccccc-cccc-cccc-cccc-cccccccccccc"}
  ]$j$::jsonb) -> 'restored' -> 0 ->> 'id'),
  '10700000-0000-0000-0000-0000000000f2', 'a reviewer''s own removal, undone: the row comes back (restore_bin_files, B11)');
SELECT ok((SELECT vetted_at IS NULL FROM public.bin_files WHERE id = '10700000-0000-0000-0000-0000000000f2'),
  'and it comes back unchecked, as it went (§3)');

-- A supplied mark on INSERT is ignored for a client who may not vet.
INSERT INTO public.bin_files (id, project_id, bin_id, location_id, relative_path, display_name, original_name, extension, media_type, vetted_at, vetted_by)
VALUES ('10700000-0000-0000-0000-0000000000f8', 'aaaa1111-0000-0000-0000-000000000001',
        '10700000-0000-0000-0000-0000000000b1', '10700000-0000-0000-0000-00000000000a',
        'A001/F8.mov', 'F8', 'F8.mov', '.mov', 'video', now(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT ok((SELECT vetted_at IS NULL AND vetted_by IS NULL FROM public.bin_files WHERE id = '10700000-0000-0000-0000-0000000000f8'),
  '🚨 a mark a reviewer supplies on INSERT is ignored: the trigger decides, never the client (§3)');


-- ── 26-32: the MANAGER marks, withdraws, re-points, adds (§3) ──────────────

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

UPDATE public.bin_files SET vetted_at = '2001-01-01'::timestamptz WHERE id = '10700000-0000-0000-0000-0000000000f2';
SELECT ok((SELECT vetted_by = 'ffffffff-ffff-ffff-ffff-ffffffffffff' AND vetted_at > now() - interval '1 minute'
             FROM public.bin_files WHERE id = '10700000-0000-0000-0000-0000000000f2'),
  'a manager marks the reviewer''s clip by hand: stamped now(), by them, whatever time they sent (§3)');

UPDATE public.bin_files SET vetted_at = NULL WHERE id = '10700000-0000-0000-0000-0000000000f2';
SELECT ok((SELECT vetted_at IS NULL AND vetted_by IS NULL FROM public.bin_files WHERE id = '10700000-0000-0000-0000-0000000000f2'),
  'a manager withdraws a mark (§3)');

UPDATE public.bin_files SET relative_path = 'A001/F2b.mov' WHERE id = '10700000-0000-0000-0000-0000000000f2';
SELECT is((SELECT vetted_by FROM public.bin_files WHERE id = '10700000-0000-0000-0000-0000000000f2'),
  'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, 'a manager re-pointing a clip checks the new path (§3)');

INSERT INTO public.bin_files (id, project_id, bin_id, location_id, relative_path, display_name, original_name, extension, media_type)
VALUES ('10700000-0000-0000-0000-0000000000f4', 'aaaa1111-0000-0000-0000-000000000001',
        '10700000-0000-0000-0000-0000000000b1', '10700000-0000-0000-0000-00000000000a',
        'A001/F4.mov', 'F4', 'F4.mov', '.mov', 'video');
SELECT is((SELECT vetted_by FROM public.bin_files WHERE id = '10700000-0000-0000-0000-0000000000f4'),
  'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, 'a manager''s clip is checked, by them (§3)');

INSERT INTO public.bin_locations (id, workspace_id, name, unc_path)
VALUES ('10700000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'VFX 107', '\\nas107\vfx');
SELECT is((SELECT vetted_by FROM public.bin_locations WHERE id = '10700000-0000-0000-0000-00000000000c'),
  'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, 'a manager''s location is checked, by them (§3)');

UPDATE public.bin_locations SET vetted_at = now() WHERE id = '10700000-0000-0000-0000-00000000000b';
SELECT is((SELECT vetted_by FROM public.bin_locations WHERE id = '10700000-0000-0000-0000-00000000000b'),
  'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, 'a manager marks the reviewer''s location by hand (§3)');

UPDATE public.bin_locations SET name = 'Sound stage 107' WHERE id = '10700000-0000-0000-0000-00000000000b';
SELECT is((SELECT vetted_by FROM public.bin_locations WHERE id = '10700000-0000-0000-0000-00000000000b'),
  'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, 'a rename keeps a location''s mark: only the address matters (§3)');

-- A checked clip at a location the member below will re-point (probe 37's).
INSERT INTO public.bin_files (id, project_id, bin_id, location_id, relative_path, display_name, original_name, extension, media_type)
VALUES ('10700000-0000-0000-0000-0000000000f6', 'aaaa1111-0000-0000-0000-000000000001',
        '10700000-0000-0000-0000-0000000000b1', '10700000-0000-0000-0000-00000000000c',
        'VFX/F6.exr', 'F6', 'F6.exr', '.exr', 'still');


-- ── 33-36: the MEMBER (§3) ─────────────────────────────────────────────────

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

-- (0091's policy admits the member's re-point, as suite 93 pins; a refused
-- UPDATE would leave the mark standing and fail this probe too.)
UPDATE public.bin_locations SET unc_path = '\\nas107\vfx2' WHERE id = '10700000-0000-0000-0000-00000000000c';
SELECT ok((SELECT vetted_at IS NULL AND unc_path = '\\nas107\vfx2' FROM public.bin_locations WHERE id = '10700000-0000-0000-0000-00000000000c'),
  '🚨 a member re-pointing a checked location clears its mark: the gateway forgets it (§3)');

SELECT throws_ok($$
  UPDATE public.bin_locations SET vetted_at = NULL WHERE id = '10700000-0000-0000-0000-00000000000b'
$$, '42501', 'Only a workspace admin or manager can mark a footage location as checked for the file gateway.',
  'a member cannot withdraw a location''s mark (§3)');

SELECT throws_ok($$
  UPDATE public.bin_files SET vetted_at = NULL WHERE id = '10700000-0000-0000-0000-0000000000f4'
$$, '42501', NULL, 'a member cannot withdraw a clip''s mark either (§3)');

INSERT INTO public.bin_files (id, project_id, bin_id, location_id, relative_path, display_name, original_name, extension, media_type)
VALUES ('10700000-0000-0000-0000-0000000000f5', 'aaaa1111-0000-0000-0000-000000000001',
        '10700000-0000-0000-0000-0000000000b1', '10700000-0000-0000-0000-00000000000b',
        'S/F5.wav', 'F5', 'F5.wav', '.wav', 'audio');
SELECT ok((SELECT vetted_at IS NULL FROM public.bin_files WHERE id = '10700000-0000-0000-0000-0000000000f5'),
  'a member''s clip is not checked (§3)');


-- ── 37-45: the GATEWAY, as the service role (§4, §6, §7, §8) ───────────────

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
-- A token, made by postgres directly; the enrolment as suite 96 does it.
INSERT INTO public.gateway_enrolment_tokens (workspace_id, token_hash, created_by)
VALUES ('11111111-1111-1111-1111-111111111111', encode(sha256(convert_to('wgt_SUITE107TOKENSUITE107TOKEN0107', 'UTF8')), 'hex'),
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT set_config('wg107.pem', '-----BEGIN CERTIFICATE-----' || chr(10)
  || encode(decode('30' || repeat('5b', 90), 'hex'), 'base64') || chr(10) || '-----END CERTIFICATE-----', true);
SELECT set_config('wg107.body', jsonb_build_object(
  'name', 'Studio NAS 107', 'platform', 'container', 'version', '1.0.0', 'hostname', 'studio-nas107',
  'inside_addresses', jsonb_build_array(jsonb_build_object('host', '192.168.107.10', 'port', 8443)),
  'inside_names', jsonb_build_array(jsonb_build_object('host', 'Studio-NAS107', 'port', 8443),
                                    jsonb_build_object('host', '8.8.8.8', 'port', 8443),
                                    jsonb_build_object('host', '192.168.107.10', 'port', 8443),
                                    jsonb_build_object('host', 'gw01.studio.lan', 'port', 8443)),
  'root_cert_pem', current_setting('wg107.pem'))::text, true);

SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;

SELECT set_config('wg107.enrol', public.gateway_enrol_apply(
  encode(sha256(convert_to('wgt_SUITE107TOKENSUITE107TOKEN0107', 'UTF8')), 'hex'),
  encode(sha256(convert_to('wgc_suite107-credential', 'UTF8')), 'hex'),
  current_setting('wg107.body')::jsonb, '198.51.100.17'::inet,
  encode(sha256(convert_to('wilson-reach-key:wgc_suite107-credential', 'UTF8')), 'hex'))::text, true);
SELECT set_config('wg107.gw', current_setting('wg107.enrol')::jsonb ->> 'gateway_id', true);

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT is((SELECT inside_names FROM public.gateways WHERE id = current_setting('wg107.gw')::uuid),
  '[{"host": "studio-nas107", "port": 8443}]'::jsonb,
  'enrolment stores the gateway''s names, lower-cased; the literals and the FQDN are dropped (§5, §6)');

SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;
SELECT set_config('wg107.sync', public.gateway_sync_apply(current_setting('wg107.gw')::uuid,
  jsonb_build_object('version', '1.0.1', 'hostname', 'studio-nas107',
    'inside_names', jsonb_build_array(jsonb_build_object('host', 'studio-nas107', 'port', 8443),
                                      jsonb_build_object('host', 'studio-nas107.local', 'port', 8443))),
  '198.51.100.17'::inet,
  jsonb_build_array(
    jsonb_build_object('clip', '10700000-0000-0000-0000-0000000000f4', 'loc', '10700000-0000-0000-0000-00000000000a', 'path', 'A001/F4.mov'),
    jsonb_build_object('clip', '10700000-0000-0000-0000-0000000000f2', 'loc', '10700000-0000-0000-0000-00000000000a', 'path', 'A001/F2b.mov'),
    jsonb_build_object('clip', '10700000-0000-0000-0000-0000000000f3', 'loc', '10700000-0000-0000-0000-00000000000a', 'path', 'A001/F1.mov'),
    jsonb_build_object('clip', '10700000-0000-0000-0000-0000000000f1', 'loc', '10700000-0000-0000-0000-00000000000a', 'path', 'A001/moved.mov'),
    jsonb_build_object('clip', '10700000-0000-0000-0000-0000000000f5', 'loc', '10700000-0000-0000-0000-00000000000b', 'path', 'S/F5.wav'),
    jsonb_build_object('clip', '10700000-0000-0000-0000-0000000000f6', 'loc', '10700000-0000-0000-0000-00000000000c', 'path', 'VFX/F6.exr'))
)::text, true);
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is((SELECT inside_names FROM public.gateways WHERE id = current_setting('wg107.gw')::uuid),
  '[{"host": "studio-nas107", "port": 8443}, {"host": "studio-nas107.local", "port": 8443}]'::jsonb,
  'a sync stores the names it reports (§7)');

SELECT ok(
  (current_setting('wg107.sync')::jsonb -> 'confirmed') @> '["10700000-0000-0000-0000-0000000000f4", "10700000-0000-0000-0000-0000000000f2", "10700000-0000-0000-0000-0000000000f3"]'::jsonb
  AND jsonb_array_length(current_setting('wg107.sync')::jsonb -> 'confirmed') = 3,
  '🚨 the catalogue check confirms the checked clips at a checked location: the manager''s, the manager-marked one, the inherited twin — and nothing else (§7, D22)');
SELECT ok(
  NOT ((current_setting('wg107.sync')::jsonb -> 'confirmed') @> '["10700000-0000-0000-0000-0000000000f1"]'::jsonb)
  AND NOT ((current_setting('wg107.sync')::jsonb -> 'confirmed') @> '["10700000-0000-0000-0000-0000000000f5"]'::jsonb),
  '🚨 never the clip a reviewer re-pointed, never a member''s unchecked clip: their paths are not served (§7)');
SELECT ok(
  NOT ((current_setting('wg107.sync')::jsonb -> 'confirmed') @> '["10700000-0000-0000-0000-0000000000f6"]'::jsonb),
  '🚨 a checked clip at a location a member re-pointed is not confirmed either (§7)');
SELECT is(
  (SELECT jsonb_agg(l ->> 'id' ORDER BY l ->> 'id') FROM jsonb_array_elements(current_setting('wg107.sync')::jsonb -> 'bin_locations') AS l
    WHERE l ->> 'id' LIKE '10700000-%'),
  '["10700000-0000-0000-0000-00000000000a", "10700000-0000-0000-0000-00000000000b"]'::jsonb,
  '🚨 the gateway is told the checked locations only; the one the member re-pointed is not among them (§7)');

-- The member's browser reads the names from the view (the fingerprint confirmed by postgres standing in for the admin).
UPDATE public.gateways SET root_confirmed_at = now(), root_confirmed_by = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
 WHERE id = current_setting('wg107.gw')::uuid;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT inside_names FROM public.gateways_visible WHERE id = current_setting('wg107.gw')::uuid),
  '[{"host": "studio-nas107", "port": 8443}, {"host": "studio-nas107.local", "port": 8443}]'::jsonb,
  'a MEMBER''s browser reads the names from gateways_visible, to probe them before the addresses (§8)');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT throws_ok(
  format($q$UPDATE public.gateways SET inside_names = '[{"host": "10.0.0.1", "port": 8443}]'::jsonb WHERE id = %L$q$, current_setting('wg107.gw')),
  '23514', NULL, 'the CHECK refuses a literal among the names (§5)');

-- gateway_clips_for_tickets, as the REVIEWER: the checked clip alone.
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT jsonb_agg(t.bin_file_id) FROM public.gateway_clips_for_tickets(ARRAY[
     '10700000-0000-0000-0000-0000000000f4'::uuid, '10700000-0000-0000-0000-0000000000f5'::uuid,
     '10700000-0000-0000-0000-0000000000f6'::uuid, '10700000-0000-0000-0000-0000000000f1'::uuid]) AS t),
  '["10700000-0000-0000-0000-0000000000f4"]'::jsonb,
  '🚨 no ticket for an unchecked clip, a clip at an unchecked location, or a re-pointed one: only the checked clip is answered (§4)');
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;


-- ── 46-47: a non-client keeps what it supplies (§3) ───────────────────────

INSERT INTO public.bin_files (id, project_id, workspace_id, bin_id, location_id, relative_path, display_name, original_name, extension, media_type, vetted_at)
VALUES ('10700000-0000-0000-0000-0000000000f7', 'aaaa1111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        '10700000-0000-0000-0000-0000000000b1', '10700000-0000-0000-0000-00000000000a',
        'A001/F7.mov', 'F7', 'F7.mov', '.mov', 'video', now());
SELECT ok((SELECT vetted_at IS NOT NULL FROM public.bin_files WHERE id = '10700000-0000-0000-0000-0000000000f7'),
  'postgres (a fixture, a migration) keeps the mark it supplies (§3)');
SELECT ok((SELECT vetted_at IS NULL FROM public.bin_files WHERE id = '10700000-0000-0000-0000-0000000000f8'),
  'CONTROL: the reviewer''s supplied mark above was not kept (§3)');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);


-- ── 48-61: build rounds 1 and 2's corrections — a copy or an undo is no
--          check; a check or a withdrawal by hand is of the file, cascaded
--          AFTER the statement (0104 §3, §3b) ───────────────────────────────

-- Both bodies set the mode (pinned: a restatement without the line would stamp again).
SELECT ok(COALESCE((SELECT p.prosrc LIKE '%set_config(''wilson.bins_mark'', ''inherit'', true)%' FROM pg_proc p
                     WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'copy_bin_files'), false),
  'copy_bin_files sets wilson.bins_mark = inherit for its inserts (§3b)');
SELECT ok(COALESCE((SELECT p.prosrc LIKE '%set_config(''wilson.bins_mark'', ''inherit'', true)%' FROM pg_proc p
                     WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'restore_bin_files'), false),
  'restore_bin_files sets wilson.bins_mark = inherit for its inserts (§3b)');

-- The reviewer adds F12, unchecked.
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
INSERT INTO public.bin_files (id, project_id, bin_id, location_id, relative_path, display_name, original_name, extension, media_type)
VALUES ('10700000-0000-0000-0000-0000000000fc', 'aaaa1111-0000-0000-0000-000000000001',
        '10700000-0000-0000-0000-0000000000b1', '10700000-0000-0000-0000-00000000000a',
        'A001/F12.mov', 'F12', 'F12.mov', '.mov', 'video');
RESET ROLE;

-- The manager copies it: the copy is no check.
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT jsonb_array_length(public.copy_bin_files(ARRAY['10700000-0000-0000-0000-0000000000fc'::uuid], '10700000-0000-0000-0000-0000000000b1'::uuid) -> 'created')),
  1, 'a manager copies a reviewer''s unchecked clip (0091 §10m)');
SELECT is((SELECT count(*)::int FROM public.bin_files
            WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001' AND relative_path = 'A001/F12.mov' AND vetted_at IS NOT NULL),
  0, '🚨 the copy is not a check: nobody looked at the path, so neither row is checked (round 1, finding 1)');
-- CONTROL: the manager's own clip at a new address is checked, as before.
INSERT INTO public.bin_files (id, project_id, bin_id, location_id, relative_path, display_name, original_name, extension, media_type)
VALUES ('10700000-0000-0000-0000-0000000000fd', 'aaaa1111-0000-0000-0000-000000000001',
        '10700000-0000-0000-0000-0000000000b1', '10700000-0000-0000-0000-00000000000a',
        'A001/F13.mov', 'F13', 'F13.mov', '.mov', 'video');
SELECT ok((SELECT vetted_by = 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid FROM public.bin_files WHERE id = '10700000-0000-0000-0000-0000000000fd'),
  'CONTROL: the manager''s own clip is checked, by them (§3)');

-- The reviewer removes their own F12; the manager's undo of that removal is no check either, and the mark the client sends with it is ignored.
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
DELETE FROM public.bin_files WHERE id = '10700000-0000-0000-0000-0000000000fc';
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT public.restore_bin_files($j$[
    {"id": "10700000-0000-0000-0000-0000000000fc", "bin_id": "10700000-0000-0000-0000-0000000000b1",
     "location_id": "10700000-0000-0000-0000-00000000000a", "relative_path": "A001/F12.mov",
     "display_name": "F12", "original_name": "F12.mov", "extension": ".mov", "media_type": "video",
     "added_by": "cccccccc-cccc-cccc-cccc-cccccccccccc", "vetted_at": "2026-10-28T00:00:00Z"}
  ]$j$::jsonb) -> 'restored' -> 0 ->> 'id'),
  '10700000-0000-0000-0000-0000000000fc', 'a manager undoes the reviewer''s removal (restore_bin_files)');
SELECT ok((SELECT vetted_at IS NULL FROM public.bin_files WHERE id = '10700000-0000-0000-0000-0000000000fc'),
  '🚨 the undo is not a check, and the mark sent with it is ignored (round 1, finding 1)');

-- The manager checks F12 by hand: a check given by hand is of that row (the copy keeps its own state).
UPDATE public.bin_files SET vetted_at = now() WHERE id = '10700000-0000-0000-0000-0000000000fc';
SELECT is((SELECT count(*)::int FROM public.bin_files
            WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001' AND relative_path = 'A001/F12.mov' AND vetted_at IS NOT NULL),
  2, 'a check given by hand is of the FILE: the copy, the same file, is checked with it (round 2, finding 3)');
RESET ROLE;

-- The reviewer's new row at the now-checked address inherits (§3): two rows carry the mark.
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'user')
)::text, true);
SET LOCAL ROLE authenticated;
INSERT INTO public.bin_files (id, project_id, bin_id, location_id, relative_path, display_name, original_name, extension, media_type)
VALUES ('10700000-0000-0000-0000-0000000000fe', 'aaaa1111-0000-0000-0000-000000000001',
        '10700000-0000-0000-0000-0000000000b1', '10700000-0000-0000-0000-00000000000a',
        'A001/F12.mov', 'F12 again', 'F12.mov', '.mov', 'video');
SELECT is((SELECT count(*)::int FROM public.bin_files
            WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001' AND relative_path = 'A001/F12.mov' AND vetted_at IS NOT NULL),
  3, 'a reviewer''s new row at a checked address inherits the mark (§3)');
RESET ROLE;

-- The manager withdraws the check on F12: every row at that file loses it.
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'manager')
)::text, true);
SET LOCAL ROLE authenticated;
UPDATE public.bin_files SET vetted_at = NULL WHERE id = '10700000-0000-0000-0000-0000000000fc';
SELECT is((SELECT count(*)::int FROM public.bin_files
            WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001' AND relative_path = 'A001/F12.mov' AND vetted_at IS NOT NULL),
  0, '🚨 withdrawing the check on one row withdraws it from every row at that file (round 1, finding 2)');

-- One statement withdrawing two rows at the same file: the cascade runs AFTER the statement, so no 27000.
UPDATE public.bin_files SET vetted_at = now() WHERE id = '10700000-0000-0000-0000-0000000000fc';
SELECT is((SELECT count(*)::int FROM public.bin_files
            WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001' AND relative_path = 'A001/F12.mov' AND vetted_at IS NOT NULL),
  3, 'the check given again by hand reaches every row at the file (round 2, finding 3)');
SELECT lives_ok($$
  UPDATE public.bin_files SET vetted_at = NULL
   WHERE id IN ('10700000-0000-0000-0000-0000000000fc', '10700000-0000-0000-0000-0000000000fe')
$$, 'one statement withdraws two rows at the same file (round 2, finding 1: the cascade is an AFTER trigger)');
SELECT is((SELECT count(*)::int FROM public.bin_files
            WHERE project_id = 'aaaa1111-0000-0000-0000-000000000001' AND relative_path = 'A001/F12.mov' AND vetted_at IS NOT NULL),
  0, 'and every row at the file is unchecked after it (round 2, finding 1)');
SELECT ok(EXISTS (SELECT 1 FROM pg_trigger tg
                   WHERE tg.tgrelid = 'public.bin_files'::regclass AND tg.tgname = 'trg_bin_files_vet_cascade'
                     AND (tg.tgtype & 2) = 0 AND (tg.tgtype & 16) = 16 AND tg.tgqual IS NOT NULL),
  'the cascade is an AFTER UPDATE row trigger with a WHEN clause (§3)');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);

SELECT * FROM finish();
ROLLBACK;
