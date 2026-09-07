-- =============================================================================
-- 30_otter_change_requests.sql — Session 10: change requests (0022).
--
-- "Give the user the ability to put a request to update the course with their
-- updates — the user should be able to clarify what changes they are
-- recommending for the admin to review" (Audrey, 2026-07-28).
--
-- Probes pin: requests only make sense against a company-standard course, the
-- proposer may refine or withdraw but never approve, admins decide, a settled
-- request can never be reopened, and review history is never deletable.
-- =============================================================================

BEGIN;

SELECT plan(17);

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

INSERT INTO public.otter_courses (id, workspace_id, owner_id, slug, name, visibility)
VALUES
  ('0c000005-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','official-blender','Official Blender','company_standard'),
  ('0c000005-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','just-shared','Just Shared','shared');

-- ── structure ───────────────────────────────────────────────────────────────
SELECT has_table('public', 'otter_change_requests', 'otter_change_requests table exists');

SELECT ok(
  (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.otter_change_requests'::regclass),
  'otter_change_requests has FORCE ROW LEVEL SECURITY');

-- Review history is retained: there is deliberately no DELETE policy at all.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname='public' AND tablename='otter_change_requests' AND cmd='DELETE'),
  0, 'change requests have no DELETE policy — review history is retained');

-- ── user_c forks and proposes changes back ──────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

SELECT lives_ok(
  $$INSERT INTO public.otter_change_requests
      (id, workspace_id, target_course_id, proposed_by, summary)
    VALUES ('0a000005-0000-0000-0000-000000000001',
            '11111111-1111-1111-1111-111111111111',
            '0c000005-0000-0000-0000-000000000001',
            'cccccccc-cccc-cccc-cccc-cccccccccccc',
            'Section 3 still describes the 4.0 shortcut layout; I updated it for 5.0.')$$,
  'a member can propose changes to a company-standard course');

SELECT throws_ok(
  $$INSERT INTO public.otter_change_requests
      (workspace_id, target_course_id, proposed_by, summary)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '0c000005-0000-0000-0000-000000000002',
            'cccccccc-cccc-cccc-cccc-cccccccccccc',
            'not a standard course')$$,
  'new row violates row-level security policy for table "otter_change_requests"',
  'change requests only apply to company-standard courses');

SELECT is((SELECT count(*)::int FROM public.otter_change_requests),
          1, 'the proposer can read their own request');

-- The proposer may keep clarifying while it is open.
WITH upd AS (
  UPDATE public.otter_change_requests
     SET summary = 'Section 3 describes the 4.0 shortcut layout; updated for 5.0 and added the new pie menu.'
   WHERE id='0a000005-0000-0000-0000-000000000001' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1,
          'the proposer can refine their own rationale while it is open');

-- Since 0025 the refusal comes from fn_otter_cr_review (BEFORE triggers fire
-- ahead of the WITH CHECK), and 'approved' is unreachable by ANYONE through a
-- bare status flip — approval only exists as otter_cr_apply() (pgTAP 32).
SELECT throws_ok(
  $$UPDATE public.otter_change_requests SET status='approved'
     WHERE id='0a000005-0000-0000-0000-000000000001'$$,
  'approving applies the change — call otter_cr_apply() instead of setting the status',
  'the proposer cannot approve their own request');

-- ── an unrelated member sees nothing ────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd',
                      '11111111-1111-1111-1111-111111111111');

SELECT is((SELECT count(*)::int FROM public.otter_change_requests),
          0, 'an unrelated member cannot see other people''s change requests');

-- ── the admin reviews ───────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT is((SELECT count(*)::int FROM public.otter_change_requests),
          1, 'an admin sees the workspace''s change requests');

-- 0025 note: this suite pins the DECIDE mechanics (reviewer stamp, settled is
-- terminal) through the reject path, because a direct UPDATE to 'approved' is
-- now forbidden — approving goes through otter_cr_apply(), pinned in pgTAP 32.
WITH upd AS (
  UPDATE public.otter_change_requests
     SET status='rejected', review_note='Superseded — the official course was rewritten for 5.1.'
   WHERE id='0a000005-0000-0000-0000-000000000001' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1, 'an admin can reject a request');

-- The reviewer is stamped server-side, never client-supplied.
SELECT is((SELECT reviewed_by FROM public.otter_change_requests
            WHERE id='0a000005-0000-0000-0000-000000000001'),
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
          'the reviewer is stamped from auth.uid()');

SELECT ok((SELECT reviewed_at IS NOT NULL FROM public.otter_change_requests
            WHERE id='0a000005-0000-0000-0000-000000000001'),
          'reviewed_at is stamped on decision');

SELECT throws_ok(
  $$UPDATE public.otter_change_requests SET status='withdrawn'
     WHERE id='0a000005-0000-0000-0000-000000000001'$$,
  'change request already rejected — reopen is not permitted',
  'a settled request can never be re-decided');

-- ── the proposer withdraws a second, still-open request ─────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

INSERT INTO public.otter_change_requests
  (id, workspace_id, target_course_id, proposed_by, summary)
VALUES ('0a000005-0000-0000-0000-000000000002',
        '11111111-1111-1111-1111-111111111111',
        '0c000005-0000-0000-0000-000000000001',
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        'Second thought about the modifier chapter.');

WITH upd AS (
  UPDATE public.otter_change_requests SET status='withdrawn'
   WHERE id='0a000005-0000-0000-0000-000000000002' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1,
          'the proposer can withdraw their own open request');

-- Provenance is immutable regardless of who writes.
UPDATE public.otter_change_requests
   SET proposed_by='dddddddd-dddd-dddd-dddd-dddddddddddd'
 WHERE id='0a000005-0000-0000-0000-000000000002';

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is((SELECT proposed_by FROM public.otter_change_requests
            WHERE id='0a000005-0000-0000-0000-000000000002'),
          'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
          'proposed_by is immutable');


-- ── 0033: the migration-0011 privilege trap, for otter_change_requests ──
-- 0011's blanket GRANT plus its ALTER DEFAULT PRIVILEGES left anon holding
-- every table privilege on otter_change_requests; 0033 revoked it. Assert the revoke rather
-- than assume it — a policy-only check passes while a privilege hole is wide
-- open, which is exactly how 26 tables stayed open until S21 tripped over one.
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.otter_change_requests', 'SELECT') OR
    has_table_privilege('anon', 'public.otter_change_requests', 'INSERT') OR
    has_table_privilege('anon', 'public.otter_change_requests', 'UPDATE') OR
    has_table_privilege('anon', 'public.otter_change_requests', 'DELETE')
  ),
  'anon holds no table privilege on otter_change_requests'
);

SELECT * FROM finish();
ROLLBACK;
