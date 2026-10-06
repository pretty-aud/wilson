-- pgTAP: phases RLS (parent-join via projects)
BEGIN;
SELECT plan(5);

SELECT * FROM tests.rls_setup();

-- Seed one phase in each workspace (service_role context — RLS bypassed).
INSERT INTO public.phases (id, project_id, name) VALUES
  ('aaaa1111-0000-0000-0000-000000000a01', 'aaaa1111-0000-0000-0000-000000000001', 'Phase A'),
  ('bbbb2222-0000-0000-0000-000000000b01', 'bbbb2222-0000-0000-0000-000000000001', 'Phase B');

SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

SELECT is(
  (SELECT count(*)::int FROM public.phases WHERE id = 'aaaa1111-0000-0000-0000-000000000a01'),
  1, 'user_a can SELECT own-workspace phase'
);

SELECT is(
  (SELECT count(*)::int FROM public.phases WHERE id = 'bbbb2222-0000-0000-0000-000000000b01'),
  0, 'user_a cannot SELECT workspace-B phase'
);

WITH upd AS (
  UPDATE public.phases SET name = 'hijack' WHERE id = 'bbbb2222-0000-0000-0000-000000000b01'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0, 'user_a cannot UPDATE workspace-B phase');

INSERT INTO public.phases (id, project_id, name)
VALUES ('aaaa1111-0000-0000-0000-000000000a99', 'aaaa1111-0000-0000-0000-000000000001', 'audit probe');

SELECT is(
  (SELECT created_by FROM public.phases WHERE id = 'aaaa1111-0000-0000-0000-000000000a99'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'phases audit trigger populates created_by'
);


-- ── 0033: the migration-0011 privilege trap, for phases ──
-- 0011's blanket GRANT plus its ALTER DEFAULT PRIVILEGES left anon holding
-- every table privilege on phases; 0033 revoked it. Assert the revoke rather
-- than assume it — a policy-only check passes while a privilege hole is wide
-- open, which is exactly how 26 tables stayed open until S21 tripped over one.
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.phases', 'SELECT') OR
    has_table_privilege('anon', 'public.phases', 'INSERT') OR
    has_table_privilege('anon', 'public.phases', 'UPDATE') OR
    has_table_privilege('anon', 'public.phases', 'DELETE')
  ),
  'anon holds no table privilege on phases'
);

SELECT * FROM finish();
ROLLBACK;
