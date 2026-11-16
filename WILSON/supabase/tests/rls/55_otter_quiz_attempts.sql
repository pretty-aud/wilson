-- =============================================================================
-- 55_otter_quiz_attempts.sql — Session 30: one personal quiz history (0045).
--
-- Two properties carry this table and neither is obvious from reading it:
--
--   * A quiz spans COURSES, so an attempt has no course_id and its privacy
--     cannot be inherited from a parent row the way otter_subjects inherits
--     from otter_courses. Owner-only has to be stated on every verb, and
--     there is no admin bypass — 0022's rule for study state, applied to
--     what somebody scored.
--
--   * The 30-day retention lives in the SELECT policy. Probes 14-16 are a
--     TRIO, and the middle one is the reason the other two are not enough:
--     an expired attempt must be INVISIBLE (14), a plain client DELETE
--     CANNOT reach it (15, because PostgreSQL applies SELECT policies to a
--     DELETE that reads rows in its WHERE clause), and therefore only
--     otter_prune_quiz_attempts() can clear it (16).
--
--     🚨 Probe 15 exists because this suite FOUND that on its first run —
--     `have: 2 want: 1` — when 0045 had the window and no pruner, which would
--     have shipped "wiped every month" meaning "hidden every month and then
--     kept forever". Deleting probe 15 as redundant is how somebody later
--     removes the definer function believing the ordinary path works.
-- =============================================================================

BEGIN;

SELECT plan(22);

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

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','user','user_c','User C',true),
  ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','user','user_d','User D',true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- ── structure ───────────────────────────────────────────────────────────────
SELECT has_table('public', 'otter_quiz_attempts', 'otter_quiz_attempts table exists');

SELECT ok(
  (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.otter_quiz_attempts'::regclass),
  'otter_quiz_attempts has FORCE ROW LEVEL SECURITY');

-- 0029: a FOR ALL arm ORs with every narrow arm beside it and silently wins.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname='public' AND tablename='otter_quiz_attempts' AND cmd='ALL'),
  0, 'no FOR ALL policy arm');

-- 0011's blanket grant plus its ALTER DEFAULT PRIVILEGES is the trap 0033
-- closed. Assert the end state; a policy-only check passes with a privilege
-- hole wide open, which is how 26 tables stayed exposed until S21 tripped over
-- one. PUBLIC as well as anon — the S22 grantee lesson.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema='public' AND table_name='otter_quiz_attempts'
       AND grantee IN ('anon', 'PUBLIC')
  ),
  'neither anon nor PUBLIC holds any privilege on otter_quiz_attempts');

-- 🚨 THE ONE ASSERTION THAT MATTERS MOST ABOUT THE PRUNER. It is SECURITY
-- DEFINER, so it bypasses RLS by design and PostgREST serves it at
-- /rest/v1/rpc/ — the grantee IS its security. S22 found seven functions in
-- this schema executable by anon for exactly this reason, and they were a live
-- pre-auth RLS bypass rather than a latent grant.
--
-- Checked against the ACL rather than has_function_privilege(), because a
-- function carries a bare `=X/postgres` aclitem and the PUBLIC grant is
-- grantee 0 — a check that only names `anon` passes while PUBLIC holds it,
-- which is the exact no-op that made 0033's first draft wrong.
SELECT ok(
  NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      LEFT JOIN pg_roles r ON r.oid = a.grantee
     WHERE n.nspname = 'public'
       AND p.proname = 'otter_prune_quiz_attempts'
       AND a.privilege_type = 'EXECUTE'
       AND (a.grantee = 0 OR r.rolname = 'anon')
  ),
  'neither anon nor PUBLIC may EXECUTE otter_prune_quiz_attempts()');

-- ── user_c records an attempt ───────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

-- workspace_id and user_id are OMITTED, exactly as supabaseOtterAdapter omits
-- them, so this exercises the DEFAULTs rather than a payload the app never
-- sends. Supplying them is what made the pgTAP suites pass over a dead client
-- path once already (supabaseOtterAdapter.js:117).
SELECT lives_ok(
  $$INSERT INTO public.otter_quiz_attempts (score, total, courses, question_types)
    VALUES (7, 10,
            '[{"id":"c1","name":"Blender 5.0"},{"id":"c2","name":"Unity 6"}]'::jsonb,
            '["mc"]'::jsonb)$$,
  'a member can record their own quiz attempt across two courses');

SELECT is(
  (SELECT workspace_id::text || ' ' || user_id::text
     FROM public.otter_quiz_attempts LIMIT 1),
  '11111111-1111-1111-1111-111111111111 cccccccc-cccc-cccc-cccc-cccccccccccc',
  'the database stamps tenancy and owner from the JWT, not the client');

SELECT throws_ok(
  $$INSERT INTO public.otter_quiz_attempts (user_id, score, total)
    VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 9, 10)$$,
  'new row violates row-level security policy for table "otter_quiz_attempts"',
  'a member cannot record an attempt on behalf of someone else');

-- ── user_d records their own — the two must not collide ─────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd',
                      '11111111-1111-1111-1111-111111111111');

SELECT lives_ok(
  $$INSERT INTO public.otter_quiz_attempts (score, total, courses)
    VALUES (3, 10, '[{"id":"c1","name":"Blender 5.0"}]'::jsonb)$$,
  'a second member records their own attempt independently');

SELECT is((SELECT count(*)::int FROM public.otter_quiz_attempts),
          1, 'each member sees only their own attempts');

SELECT is((SELECT score FROM public.otter_quiz_attempts),
          3, 'one member''s score is not the other''s');

-- ── no admin bypass ─────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT is((SELECT count(*)::int FROM public.otter_quiz_attempts),
          0, 'a workspace ADMIN cannot read another member''s quiz results');

-- ── another workspace ───────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                      '22222222-2222-2222-2222-222222222222');

SELECT is((SELECT count(*)::int FROM public.otter_quiz_attempts),
          0, 'another workspace sees no attempts');

-- ── an attempt is IMMUTABLE — 0045 grants no UPDATE policy at all ───────────
-- RLS default-denies an unpoliced verb, so this affects zero rows and raises
-- nothing. Asserting the VALUE rather than an error is the only way to tell a
-- silent no-op from a successful write.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd',
                      '11111111-1111-1111-1111-111111111111');

UPDATE public.otter_quiz_attempts SET score = 10;

SELECT is((SELECT score FROM public.otter_quiz_attempts),
          3, 'an attempt cannot be edited — there is no UPDATE policy');

-- ── retention: the pair that has to hold together ───────────────────────────
-- Backdating is possible because INSERT does not police taken_at; that is what
-- lets this suite test the window without waiting a month.
INSERT INTO public.otter_quiz_attempts (score, total, taken_at)
VALUES (1, 10, now() - INTERVAL '40 days');

SELECT is((SELECT count(*)::int FROM public.otter_quiz_attempts),
          1, 'an attempt older than 30 days is invisible — the window is in the SELECT policy');

-- 🚨 THE PROBE THAT CHANGED THE MIGRATION. An ordinary DELETE has to READ the
-- rows to evaluate its WHERE clause, and PostgreSQL applies SELECT policies to
-- that read — so the window hides the row from the very statement meant to
-- remove it, silently, affecting zero rows and raising nothing.
DELETE FROM public.otter_quiz_attempts
 WHERE taken_at < now() - INTERVAL '30 days';

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is((SELECT count(*)::int FROM public.otter_quiz_attempts
            WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
          2, 'a plain client DELETE CANNOT reach an expired attempt — the SELECT policy hides it from the WHERE clause');

-- ...which is why the pruner is SECURITY DEFINER. Same user, same intent, and
-- this one works because it runs outside the window it is enforcing.
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd',
                      '11111111-1111-1111-1111-111111111111');

SELECT is((SELECT public.otter_prune_quiz_attempts()),
          1, 'otter_prune_quiz_attempts() removes exactly the one expired attempt');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is((SELECT count(*)::int FROM public.otter_quiz_attempts
            WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
          1, 'the live attempt survives the prune — it clears the tail, not the history');

-- ── constraints ─────────────────────────────────────────────────────────────
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

-- renderQuizResults divides by total (Otter.jsx:4721): a zero is NaN on screen.
SELECT throws_ok(
  $$INSERT INTO public.otter_quiz_attempts (score, total) VALUES (0, 0)$$,
  'new row for relation "otter_quiz_attempts" violates check constraint "otter_quiz_attempts_total_chk"',
  'a quiz with no questions is not an attempt');

SELECT throws_ok(
  $$INSERT INTO public.otter_quiz_attempts (score, total) VALUES (11, 10)$$,
  'new row for relation "otter_quiz_attempts" violates check constraint "otter_quiz_attempts_score_chk"',
  'a score cannot exceed the number of questions');

SELECT throws_ok(
  $$INSERT INTO public.otter_quiz_attempts (score, total, courses)
    VALUES (1, 10, '{"id":"c1"}'::jsonb)$$,
  'new row for relation "otter_quiz_attempts" violates check constraint "otter_quiz_attempts_courses_chk"',
  'courses must be an array — an object would break every reader');

-- ── the retired column ──────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- 0045 moved quiz history out of otter_progress. Pinning its absence stops the
-- next session "restoring" a column whose writer now lives elsewhere — the
-- `projects.code` treatment, for the same reason.
-- Spelled as a count rather than hasnt_column(): this pgTAP build has no
-- four-argument hasnt_column, and suite 48 probe 18 already asserts an
-- absence this way for projects.code.
SELECT is(
  (SELECT count(*)::int FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'otter_progress'
      AND column_name = 'quiz_attempts'),
  0, 'otter_progress.quiz_attempts is retired — history lives in otter_quiz_attempts');

SELECT * FROM finish();
ROLLBACK;
