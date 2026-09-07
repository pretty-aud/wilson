-- =============================================================================
-- 56_user_pets.sql — Session 31: one pet per PERSON (0046).
--
-- What it PINS:
--   1. Own row only, on all four verbs, with NO admin bypass — a company admin
--      cannot read an employee's pet.
--   2. 🚨 NO WORKSPACE DEPENDENCE. Probe 16 is the one that makes this table
--      different from the other 40 policied tables in the schema: a JWT
--      carrying NO workspace_id at all can still read and write its own pet.
--      That is the point of the migration, and it is the probe that fails if a
--      later session "fixes" the policy by adding the workspace clause every
--      neighbour has.
--   3. `state` is DERIVED and must not become a column — derivePetState is a
--      pure function of form/sleepingSince/hunger/happiness, and a stored copy
--      could disagree with the row it describes.
--   4. One row per person, enforced by the PRIMARY KEY rather than by client
--      convention.
--   5. The CHECK constraints match the bounds the client already applies, so a
--      legitimate save can never be refused.
--
-- ⚠️ This suite deliberately does NOT copy 42_user_model_overrides.sql. Its
-- "an admin cannot read a personal setting" probe is confounded — the admin it
-- uses is not a member of the workspace under test — and it carries no
-- presence control, so it would pass against an empty table. Probes 12-14 here
-- put both people in the SAME workspace and assert a count AND a
-- discriminating value.
-- =============================================================================

BEGIN;

SELECT plan(39);

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

-- Both in workspace A on purpose: per-user isolation must be provable WITHOUT
-- tenancy doing the work. Two people in two workspaces would pass even if the
-- policy were workspace-scoped, which is the confound in suite 42.
INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','user','user_c','User C',true),
  ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','user','user_d','User D',true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- ── structure ───────────────────────────────────────────────────────────────
SELECT has_table('public', 'user_pets', 'user_pets table exists');

SELECT ok(
  (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.user_pets'::regclass),
  'user_pets has FORCE ROW LEVEL SECURITY');

-- 0029: a FOR ALL arm ORs with every narrow arm beside it and silently wins.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname='public' AND tablename='user_pets' AND cmd='ALL'),
  0, 'no FOR ALL policy arm');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname='public' AND tablename='user_pets'),
  4, 'user_pets carries exactly four policies, one per verb');

SELECT has_trigger('public', 'user_pets', 'trg_user_pets_touch',
  'updated_at is stamped by trigger');

-- PUBLIC as well as anon — the S22 grantee lesson: an object can carry a bare
-- =X/postgres aclitem, so naming only anon is a silent no-op reporting success.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema='public' AND table_name='user_pets'
       AND grantee IN ('anon', 'PUBLIC')
  ),
  'neither anon nor PUBLIC holds any privilege on user_pets');

-- Spelled as a count rather than hasnt_column(): this pgTAP build has no
-- four-argument hasnt_column, and suite 48 probe 18 already asserts an absence
-- this way for projects.code.
SELECT is(
  (SELECT count(*)::int FROM information_schema.columns
    WHERE table_schema='public' AND table_name='user_pets' AND column_name='state'),
  0, 'state is NOT a column — it is derived from form/sleepingSince/hunger/happiness');

-- ── user_c adopts a pet ─────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

-- user_id is OMITTED, exactly as the client omits it, so this exercises the
-- DEFAULT auth.uid() rather than a payload the app never sends. Supplying it is
-- what made a pgTAP suite pass over a dead client path once already.
SELECT lives_ok(
  $$INSERT INTO public.user_pets (name, gender, breed, form, hunger, happiness,
                                  difficulty, born_at, last_updated_at)
    VALUES ('Ollie', 'male', 'blob', 'ghost', 0, 0, 'low',
            now() - INTERVAL '20 days', now())$$,
  'a member can store their own pet');

SELECT is(
  (SELECT user_id::text FROM public.user_pets LIMIT 1),
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'the database stamps the owner from the JWT, not the client');

SELECT throws_ok(
  $$INSERT INTO public.user_pets (user_id, name)
    VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Stolen')$$,
  'new row violates row-level security policy for table "user_pets"',
  'a member cannot store a pet on behalf of someone else');

-- ── user_d has their own — the two must not collide ─────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd',
                      '11111111-1111-1111-1111-111111111111');

SELECT lives_ok(
  $$INSERT INTO public.user_pets (name, gender, form, hunger, happiness, difficulty)
    VALUES ('Dee', 'female', 'adult', 55, 60, 'high')$$,
  'a second member in the SAME workspace stores their own pet independently');

-- Presence control: this reader DOES see a row, so the zero below cannot pass
-- vacuously on an empty table.
SELECT is((SELECT count(*)::int FROM public.user_pets),
          1, 'each member sees exactly one pet — their own (presence control)');

SELECT is((SELECT name FROM public.user_pets),
          'Dee', 'and it is THEIR pet, not the other member''s');

-- ── no admin bypass ─────────────────────────────────────────────────────────
-- tests.login_as does not set app_role, so the claims are built by hand.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT is((SELECT count(*)::int FROM public.user_pets),
          0, 'a workspace ADMIN cannot read a member''s pet — it is not a business record');

-- ── another workspace ───────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                      '22222222-2222-2222-2222-222222222222');

SELECT is((SELECT count(*)::int FROM public.user_pets),
          0, 'another workspace sees no pets');

-- ── 🚨 THE PROBE THAT DEFINES THIS TABLE: no workspace, still your pet ──────
-- Claims carry `sub` and NOTHING else — no app_metadata, so no workspace_id.
-- Every other policied table in this schema would return zero rows here.
-- 0020:18-21 is the citation: the self arm stays open so a deactivated member
-- can still see their own row. If a later session adds the workspace clause its
-- neighbours all have, THIS is the probe that fails.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','cccccccc-cccc-cccc-cccc-cccccccccccc','role','authenticated'
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT is((SELECT count(*)::int FROM public.user_pets),
          1, 'a user with NO workspace in their JWT still sees their own pet');

SELECT is((SELECT name FROM public.user_pets),
          'Ollie', 'and it is the right pet, read without any workspace context');

-- ── a pet is EDITABLE, unlike a quiz attempt ────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd',
                      '11111111-1111-1111-1111-111111111111');

SELECT lives_ok(
  $$UPDATE public.user_pets SET hunger = 80, happiness = 90, form = 'adult'$$,
  'a member can update their own pet — feeding it has to persist');

-- An RLS-refused UPDATE raises nothing and affects zero rows, so the only way
-- to tell a silent no-op from a successful write is to assert the VALUE.
-- The statement above already ran unqualified; it must not have touched
-- user_c's row.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT hunger FROM public.user_pets
    WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  0::double precision,
  'an unqualified UPDATE could not reach the other member''s pet');

-- ── one row per person ──────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

SELECT throws_ok(
  $$INSERT INTO public.user_pets (name) VALUES ('Second')$$,
  'duplicate key value violates unique constraint "user_pets_pkey"',
  'one pet per person is a PRIMARY KEY, not a convention');

-- ── the CHECKs match what the client can actually produce ───────────────────
SELECT throws_ok(
  $$UPDATE public.user_pets SET form = 'dragon'$$,
  'new row for relation "user_pets" violates check constraint "user_pets_form_chk"',
  'form is limited to the five the sprite can render');

SELECT throws_ok(
  $$UPDATE public.user_pets SET hunger = 101$$,
  'new row for relation "user_pets" violates check constraint "user_pets_hunger_chk"',
  'hunger cannot exceed the 100 the client clamps to');

SELECT throws_ok(
  $$UPDATE public.user_pets SET difficulty = 'nightmare'$$,
  'new row for relation "user_pets" violates check constraint "user_pets_difficulty_chk"',
  'difficulty is limited to the three DECAY_RATES keys');

SELECT throws_ok(
  $$UPDATE public.user_pets SET feedback = '{"not":"an array"}'::jsonb$$,
  'new row for relation "user_pets" violates check constraint "user_pets_feedback_chk"',
  'feedback must be an array');

-- ── a person can discard their own pet ──────────────────────────────────────
SELECT lives_ok(
  $$DELETE FROM public.user_pets$$,
  'a member can delete their own pet and start over');

SELECT is((SELECT count(*)::int FROM public.user_pets),
          0, 'and it is gone for them');

-- ...but only theirs. Read as postgres, because the member can no longer see
-- the row that proves the other one survived. Scoped to user_d, NOT
-- count(*) over the table: this table now carries REAL rows on live envs
-- (S33 measured have:2 on dev — someone's actual pet), and an unscoped
-- count decays the day the feature gets used. Every other count probe in
-- this suite is implicitly scoped by the self-only policy; a postgres read
-- has no such scope and must bring its own.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is((SELECT count(*)::int FROM public.user_pets
            WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
          1, 'the other member''s pet survived the unqualified DELETE');

-- ═══════════════════════════════════════════════════════════════════════════
-- Track A, bundle A3 (2026-09-07) — migration 0068's stale-write guard, and
-- the feedback size cap 0046 asserted in a comment and never tested.
--
-- 🚨 user_c's pet was DELETED by the probes above; user_d's survived. Every
-- probe below therefore runs as user_d, on the row the delete section proved
-- is still there.
-- ═══════════════════════════════════════════════════════════════════════════

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT has_trigger('public', 'user_pets', 'trg_user_pets_reject_stale_write',
  '0068: the stale-write guard is attached to user_pets');

-- Presence is not the property — TIMING is. An AFTER trigger would raise after
-- the row had already been written by a statement that then rolls back, and a
-- STATEMENT-level one has no OLD/NEW at all, so either would make the guard
-- meaningless while has_trigger stayed green.
SELECT is(
  (SELECT count(*)::int FROM pg_trigger
    WHERE tgrelid = 'public.user_pets'::regclass
      AND tgname  = 'trg_user_pets_reject_stale_write'
      AND NOT tgisinternal
      AND (tgtype & 1) = 1 AND (tgtype & 2) = 2 AND (tgtype & 16) = 16),
  1, 'and it is BEFORE UPDATE, FOR EACH ROW');

SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd',
                      '11111111-1111-1111-1111-111111111111');

-- ── the ACCEPTING CONTROL that matters most ────────────────────────────────
-- An UNCHANGED anchor is the ordinary case: every save that does not move
-- hunger or happiness — Pet Mode, difficulty, Reset History, renaming a
-- hatchling — re-sends the anchor the client is holding. A guard written with
-- <= instead of < refuses all of those, which is the way a concurrency check
-- is most likely to ship broken. now() is the transaction's start time and the
-- row was inserted in this transaction, so this genuinely is equality.
SELECT lives_ok(
  $$UPDATE public.user_pets SET name = 'Dee-equal', last_updated_at = now()$$,
  '0068: a save carrying the SAME anchor is accepted — the unchanged-anchor case');

-- ── the REFUSING PROBE ─────────────────────────────────────────────────────
-- The SQLSTATE, not the message: the client branches on this to re-read
-- instead of retrying, and a message match is what rots.
SELECT throws_ok(
  $$UPDATE public.user_pets SET name = 'Stale', last_updated_at = now() - INTERVAL '1 hour'$$,
  'WP001',
  NULL,
  '0068: a save carrying an OLDER anchor is refused with SQLSTATE WP001');

-- 🚨 Counted over the WHOLE condition, not read as a column. A probe that
-- selects one field and compares it can pass on NULL = NULL when the row it
-- meant to inspect is not there at all — the false pass the A2 session found
-- under the exact mutation its probe existed to catch. This asserts BOTH
-- halves at once: the equal-anchor write landed (name is 'Dee-equal') and the
-- older-anchor write did not (it is not 'Stale').
SELECT is(
  (SELECT count(*)::int FROM public.user_pets
    WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
      AND name = 'Dee-equal'),
  1, 'the refused write changed nothing, and the accepted one did');

-- ── forward is still allowed ───────────────────────────────────────────────
-- Without this the guard could be "refuse every UPDATE" and everything above
-- would still be green.
SELECT lives_ok(
  $$UPDATE public.user_pets
       SET happiness = 41, last_updated_at = now() + INTERVAL '1 hour'$$,
  '0068: a save carrying a NEWER anchor is accepted');

SELECT is(
  (SELECT count(*)::int FROM public.user_pets
    WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
      AND happiness = 41
      AND last_updated_at > now()),
  1, 'and the newer anchor is what is stored');

-- ── 🚨 THE SHAPE THE CLIENT ACTUALLY SENDS ─────────────────────────────────
--
-- Every probe above is a bare UPDATE. `saveCloudPet` issues PostgREST's upsert,
-- `INSERT … ON CONFLICT (user_id) DO UPDATE`, and that is the ONLY statement
-- production ever takes against this table. A BEFORE UPDATE trigger does fire
-- for the conflicting row — but "does" was a reading of the manual rather than
-- a measurement, and a guard bypassed by the one path that matters would have
-- been invisible to every other probe in this file.
--
-- The row's anchor is now() + 1 hour after the probe above, so now() is older.
SELECT throws_ok(
  $$INSERT INTO public.user_pets (name, last_updated_at)
    VALUES ('Upserted', now())
    ON CONFLICT (user_id) DO UPDATE
      SET name = EXCLUDED.name, last_updated_at = EXCLUDED.last_updated_at$$,
  'WP001',
  NULL,
  '0068: the guard fires on the UPSERT the client actually sends, not only on a bare UPDATE');

SELECT is(
  (SELECT count(*)::int FROM public.user_pets
    WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
      AND name = 'Dee-equal'),
  1, 'and the refused upsert left the row alone');

-- ── the feedback size cap — 0046 asserted this in a comment and never tested it
--
-- 🚨 MEASURED on wilson-dev, 2026-09-07, before these probes were written:
-- fifty entries whose botResponse is 4096 characters (the ceiling a 1024
-- max_tokens reply can reach) and whose userMsg is 200 come to 219,807 bytes
-- against a 262,144 cap — 84% of it. The cap is NOT comfortably above what the
-- product can produce, which is exactly what the OUTSTANDING entry suspected,
-- and Create Egg carries the whole array into the new pet.
--
-- These two probes are the accepting control and the refusing probe for that
-- number. Neither touches last_updated_at, so NEW.last_updated_at equals OLD's
-- and 0068's guard lets both through to the CHECK — which is the point of
-- running them here rather than in a suite of their own.
SELECT lives_ok(
  $$UPDATE public.user_pets SET feedback = (
      SELECT jsonb_agg(jsonb_build_object(
        'timestamp', '2026-09-07T12:00:00.000Z',
        'userMsg',   repeat('u', 200),
        'botResponse', repeat('b', 4096),
        'rating',    'up'))
      FROM generate_series(1, 50))$$,
  'the maximal LEGITIMATE feedback array — 50 entries at the reply ceiling — is accepted');

-- Presence control: without this the lives_ok above would pass just as well if
-- the UPDATE had matched no rows at all.
SELECT is(
  (SELECT jsonb_array_length(feedback)::int FROM public.user_pets
    WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  50, 'and all fifty entries are actually stored');

SELECT throws_ok(
  $$UPDATE public.user_pets SET feedback = (
      SELECT jsonb_agg(jsonb_build_object(
        'timestamp', '2026-09-07T12:00:00.000Z',
        'userMsg',   repeat('u', 200),
        'botResponse', repeat('b', 6000),
        'rating',    'up'))
      FROM generate_series(1, 50))$$,
  'new row for relation "user_pets" violates check constraint "user_pets_feedback_sz_chk"',
  'a feedback array over 262144 bytes is refused by the CHECK, not silently truncated');

SELECT * FROM finish();

ROLLBACK;
