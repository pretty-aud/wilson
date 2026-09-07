-- pgTAP: projects RLS
BEGIN;
SELECT plan(5);

-- Seed the shared fixture (ws_a, ws_b, user_a, user_b, project_a, project_b).
SELECT * FROM tests.rls_setup();

-- ── probe 1: same-tenant SELECT allowed ────────────────────────────────────
SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

SELECT is(
  (SELECT count(*)::int FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000001'),
  1,
  'user_a can SELECT own project'
);

-- ── probe 2: cross-tenant SELECT denied ────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.projects WHERE id = 'bbbb2222-0000-0000-0000-000000000001'),
  0,
  'user_a cannot SELECT workspace B project'
);

-- ── probe 3: cross-tenant UPDATE denied (affects zero rows) ────────────────
WITH upd AS (
  UPDATE public.projects SET title = 'hijack' WHERE id = 'bbbb2222-0000-0000-0000-000000000001'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0, 'user_a cannot UPDATE workspace B project');

-- ── probe 4: audit column populates on INSERT ──────────────────────────────
-- 0013 tightened projects INSERT to app admin/manager; tests.login_as
-- carries no app_role claim, so the write needs inline admin claims
-- (17_edit_history.sql pattern).
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

INSERT INTO public.projects (id, workspace_id, title)
VALUES ('aaaa1111-0000-0000-0000-000000000099',
        '11111111-1111-1111-1111-111111111111',
        'audit probe');

SELECT is(
  (SELECT created_by FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000099'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'fn_audit_touch populates created_by from auth.uid()'
);


-- ── 0033: the migration-0011 privilege trap, for projects ──
-- 0011's blanket GRANT plus its ALTER DEFAULT PRIVILEGES left anon holding
-- every table privilege on projects; 0033 revoked it. Assert the revoke rather
-- than assume it — a policy-only check passes while a privilege hole is wide
-- open, which is exactly how 26 tables stayed open until S21 tripped over one.
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.projects', 'SELECT') OR
    has_table_privilege('anon', 'public.projects', 'INSERT') OR
    has_table_privilege('anon', 'public.projects', 'UPDATE') OR
    has_table_privilege('anon', 'public.projects', 'DELETE')
  ),
  'anon holds no table privilege on projects'
);

SELECT * FROM finish();
ROLLBACK;
