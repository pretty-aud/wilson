-- pgTAP: projects RLS
BEGIN;
SELECT plan(4);

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
INSERT INTO public.projects (id, workspace_id, title)
VALUES ('aaaa1111-0000-0000-0000-000000000099',
        '11111111-1111-1111-1111-111111111111',
        'audit probe');

SELECT is(
  (SELECT created_by FROM public.projects WHERE id = 'aaaa1111-0000-0000-0000-000000000099'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'fn_audit_touch populates created_by from auth.uid()'
);

SELECT * FROM finish();
ROLLBACK;
