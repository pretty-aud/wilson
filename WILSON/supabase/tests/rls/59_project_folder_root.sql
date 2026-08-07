-- =============================================================================
-- 59_project_folder_root.sql — Session 35: who sets projects.folder_root, and
-- where it may point (migration 0049).
--
-- What this pins:
--   * The seat: workspace admin/manager only — and the probe that matters is
--     the plain MEMBER, because can_write_project's unstaffed arm admits them
--     through RLS, so only the guard stands between a member and the column.
--   * 🚨 The COALESCE (0047 lesson): a CLAIM-LESS caller also passes RLS on
--     an unstaffed project (NULL app_role → NULL OR true = true in
--     can_write_project), and without the COALESCE the guard's IF NOT (NULL)
--     silently waves them through. The claim-less probe fails if the
--     COALESCE is ever removed.
--   * The boundary: strictly inside workspace_storage.root_path (byos),
--     case-folded, separator-bounded (a \\nas\projects-wilson2 cousin cannot
--     prefix-match), equality refused, canonical form required (dot
--     segments, trailing/doubled separators, forward slashes, device
--     namespace all refused).
--   * The overblock controls: a member's ordinary edit, and an update that
--     re-sends folder_root UNCHANGED (the adapter-echo shape), both pass.
--
-- Per the S33 lesson, each guard check gets a caller that passes the other
-- two: the member probe (seat fails; drive configured; path contained), the
-- outside-drive probe (seat passes; drive configured; containment fails),
-- and the no-drive probes (seat passes; path fine; anchor missing).
--
-- Postgres-side reads are ALWAYS scoped to the fixture rows — dev carries
-- real projects (S33, 439f702).
-- =============================================================================

BEGIN;

SELECT plan(31);

SELECT * FROM tests.rls_setup();

-- user_c: plain 'user'-role ACTIVE member of workspace A (suite 58's shape).
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role,
                        instance_id, created_at, updated_at)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'user_c@test.local',
   crypt('testpw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','user','user_c','User C',true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- ── structure ───────────────────────────────────────────────────────────────

SELECT has_trigger('public', 'projects', 'trg_projects_folder_root_guard',
  'the folder_root guard is wired to projects');

SELECT ok(
  position('COALESCE' IN
    pg_get_functiondef('public.fn_project_folder_root_guard()'::regprocedure)) > 0,
  'the seat is COALESCE''d — NULL must refuse, not skip (0047)');

SELECT ok(
  NOT (SELECT prosecdef FROM pg_proc
        WHERE oid = 'public.fn_project_folder_root_guard()'::regprocedure),
  'the guard is not SECURITY DEFINER — its storage read stays caller-scoped');

-- ── the drive: admin of A configures byos storage (0048 happy path) ─────────
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT lives_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, root_path, root_kind)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', '\\nas\projects\wilson', 'unc')$$,
  'fixture: workspace A has a byos drive');

-- ── the seat: admin and manager pass ────────────────────────────────────────

SELECT lives_ok(
  $$UPDATE public.projects SET folder_root = '\\nas\projects\wilson\Hero-Film'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'a workspace admin points the project folder inside the drive');

SELECT is(
  (SELECT folder_root FROM public.projects
    WHERE id = 'aaaa1111-0000-0000-0000-000000000001'),
  '\\nas\projects\wilson\Hero-Film',
  'and the value landed verbatim');

-- The claim is what the guard reads, not the workspace_members row: user_c's
-- row says 'user', and a manager CLAIM is what qualifies (suite 58 idiom).
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','cccccccc-cccc-cccc-cccc-cccccccccccc','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','manager')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT lives_ok(
  $$UPDATE public.projects SET folder_root = '\\nas\projects\wilson\Hero-Film-Cut2'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'a workspace manager repoints the folder — the folder half is theirs');

-- Case-folded containment: NTFS is case-insensitive and the drive was stored
-- with different casing than this candidate carries.
SELECT lives_ok(
  $$UPDATE public.projects SET folder_root = '\\NAS\Projects\WILSON\Case-Fold'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'containment is case-folded — a recased spelling of the same drive passes');

-- ── the INSERT branch (S35 review: UPDATE-only coverage missed it) ──────────
-- The guard fires on INSERT too, BEFORE trg_projects_populate_workspace, so
-- it anchors via COALESCE(NEW.workspace_id, current_workspace_id()). Here
-- workspace_id IS supplied (the app always does), exercising the first arm.
-- Admin claim is live from the section above.
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT lives_ok(
  $$INSERT INTO public.projects (id, workspace_id, title, folder_root)
    VALUES ('aaaa1111-0000-0000-0000-0000000000f1',
            '11111111-1111-1111-1111-111111111111', 'Insert Inside',
            '\\nas\projects\wilson\New-Proj')$$,
  'an admin can CREATE a project with a folder inside the drive (INSERT branch)');

SELECT throws_ok(
  $$INSERT INTO public.projects (id, workspace_id, title, folder_root)
    VALUES ('aaaa1111-0000-0000-0000-0000000000f2',
            '11111111-1111-1111-1111-111111111111', 'Insert Outside',
            'C:\Rogue\Proj')$$,
  'the project folder must be inside the workspace storage drive (\\nas\projects\wilson)',
  'a CREATE with a folder outside the drive is refused (INSERT branch, containment)');

-- ── the seat: a member is refused BY THE GUARD (RLS admits them) ────────────
-- project_a is unstaffed (tests.rls_setup seeds no project_members), so
-- can_write_project's unstaffed arm waves user_c through projects_update and
-- ONLY the guard refuses. This is the probe that distinguishes the trigger
-- from the policy.
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','cccccccc-cccc-cccc-cccc-cccccccccccc','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','user')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT throws_ok(
  $$UPDATE public.projects SET folder_root = '\\nas\projects\wilson\Mine'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'only a workspace admin or manager can set a project folder',
  'a plain member cannot set the folder even though RLS admits their write');

SELECT throws_ok(
  $$UPDATE public.projects SET folder_root = NULL
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'only a workspace admin or manager can set a project folder',
  'clearing the folder is a storage decision too — the seat gates it');

-- Overblock control A: the same member's ordinary edit passes untouched.
SELECT lives_ok(
  $$UPDATE public.projects SET description = 'member edit'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'the guard does not overblock — a member''s ordinary edit still lands');

-- Overblock control B: an update that RE-SENDS folder_root unchanged passes —
-- the adapter-echo shape. Refusing it would brick every later patch of a
-- project whose folder predates a seat change.
SELECT lives_ok(
  $$UPDATE public.projects
       SET folder_root = folder_root, description = 'echo edit'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'an unchanged folder_root riding an ordinary edit does not fire the guard');

-- ── 🚨 the COALESCE probe: a CLAIM-LESS caller must be refused, not skipped ──
-- tests.login_as mints NO app_role. can_write_project = NULL OR NOT staffed
-- OR ... = true, so RLS admits the write and the guard's seat sees NULL.
-- Without the COALESCE this UPDATE would LAND (IF NOT NULL skips). Proven by
-- breaker before commit: removing the COALESCE fails exactly this probe.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

SELECT throws_ok(
  $$UPDATE public.projects SET folder_root = '\\nas\projects\wilson\Claimless'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'only a workspace admin or manager can set a project folder',
  'a claim-less caller is REFUSED by the seat — NULL does not skip the guard (0047)');

-- ── the boundary: seat passes, containment decides ──────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT throws_ok(
  $$UPDATE public.projects SET folder_root = 'C:\Elsewhere\Hero'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'the project folder must be inside the workspace storage drive (\\nas\projects\wilson)',
  'an admin cannot point the folder outside the drive — the boundary binds everyone');

SELECT throws_ok(
  $$UPDATE public.projects SET folder_root = '\\nas\projects\wilson2\Hero'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'the project folder must be inside the workspace storage drive (\\nas\projects\wilson)',
  'a name-prefix cousin of the drive is not inside it (separator boundary)');

SELECT throws_ok(
  $$UPDATE public.projects SET folder_root = '\\nas\projects\wilson'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'the project folder must be inside the workspace storage drive (\\nas\projects\wilson)',
  'the drive itself is not a project folder — strictly inside');

SELECT throws_ok(
  $$UPDATE public.projects SET folder_root = '\\nas\projects\wilson\x\..\..\Elsewhere'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'the project folder must be a canonical path — no trailing or doubled separators, no . or .. segments, no forward slashes, no device namespace',
  'dot segments are refused — a passing prefix must not be escapable');

SELECT throws_ok(
  $$UPDATE public.projects SET folder_root = '\\nas\projects\wilson\Hero\'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'the project folder must be a canonical path — no trailing or doubled separators, no . or .. segments, no forward slashes, no device namespace',
  'a trailing separator is refused — canonical form only (§3.2)');

SELECT throws_ok(
  $$UPDATE public.projects SET folder_root = '//nas/projects/wilson/Hero'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'the project folder must be a canonical path — no trailing or doubled separators, no . or .. segments, no forward slashes, no device namespace',
  'forward slashes are refused — the canonical form is backslash');

SELECT throws_ok(
  $$UPDATE public.projects SET folder_root = '\\?\C:\Windows'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'the project folder must be a canonical path — no trailing or doubled separators, no . or .. segments, no forward slashes, no device namespace',
  'the device namespace is refused outright');

SELECT throws_ok(
  $$UPDATE public.projects SET folder_root = '\\nas\projects\wilson\\Hero'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'the project folder must be a canonical path — no trailing or doubled separators, no . or .. segments, no forward slashes, no device namespace',
  'a doubled separator inside the path is refused');

-- ── the anchor: no byos drive, no folder ────────────────────────────────────
-- Mode flipped to central: the root SURVIVES (0048's retyping rule) but the
-- workspace is no longer on its own storage, so a folder cannot be set.
SELECT lives_ok(
  $$UPDATE public.workspace_storage SET mode = 'central'
     WHERE workspace_id = '11111111-1111-1111-1111-111111111111'$$,
  'fixture: workspace A switches back to central storage');

SELECT throws_ok(
  $$UPDATE public.projects SET folder_root = '\\nas\projects\wilson\Hero-2'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'no workspace storage drive is configured — an admin sets the drive first (Admin Terminal, Storage)',
  'central mode has no drive to be inside — the folder set is refused');

SELECT lives_ok(
  $$DELETE FROM public.workspace_storage
     WHERE workspace_id = '11111111-1111-1111-1111-111111111111'$$,
  'fixture: workspace A''s storage row is removed entirely');

SELECT throws_ok(
  $$UPDATE public.projects SET folder_root = '\\nas\projects\wilson\Hero-3'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'no workspace storage drive is configured — an admin sets the drive first (Admin Terminal, Storage)',
  'no storage row at all: same refusal — the drive comes first (Audrey''s order)');

-- An admin can still CLEAR with no drive configured: clearing is a reset to
-- the configured chain, not a placement.
SELECT lives_ok(
  $$UPDATE public.projects SET folder_root = NULL
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'clearing the folder needs no drive — it is a reset, not a placement');

-- ── workspace B: the anchor is per-workspace, PROVEN against a real B drive ──
-- 🚨 A borrow test needs a lender. B gets its OWN byos drive (a DIFFERENT
-- path), so refusing A's path is refused as "outside B's drive" — not "no
-- drive at all" (which is what an empty table would vacuously give; S35
-- review). The anchor being B's row, not A's, is the whole claim.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','22222222-2222-2222-2222-222222222222','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT lives_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, root_path, root_kind)
    VALUES ('22222222-2222-2222-2222-222222222222', 'byos', '\\nas\projectsB\wilson', 'unc')$$,
  'fixture: workspace B configures its OWN byos drive (a different share)');

SELECT throws_ok(
  $$UPDATE public.projects SET folder_root = '\\nas\projects\wilson\Hero'
     WHERE id = 'bbbb2222-0000-0000-0000-000000000001'$$,
  'the project folder must be inside the workspace storage drive (\\nas\projectsB\wilson)',
  'B''s admin cannot point a B project at A''s drive — the anchor is B''s own row, and the message names B''s drive');

SELECT lives_ok(
  $$UPDATE public.projects SET folder_root = '\\nas\projectsB\wilson\Hero'
     WHERE id = 'bbbb2222-0000-0000-0000-000000000001'$$,
  'B''s admin CAN point a B project inside B''s own drive');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
