-- pgTAP: comments RLS (polymorphic — denormalized workspace_id via trigger)
BEGIN;
SELECT plan(6);

SELECT * FROM tests.rls_setup();

-- Comments on the seed projects. Trigger populates workspace_id from entity.
INSERT INTO public.comments (id, entity_type, entity_id, body) VALUES
  ('aaaa1111-0000-0000-0000-0000000c0001', 'project',
   'aaaa1111-0000-0000-0000-000000000001', 'hello from A'),
  ('bbbb2222-0000-0000-0000-0000000c0002', 'project',
   'bbbb2222-0000-0000-0000-000000000001', 'hello from B');

SELECT is(
  (SELECT workspace_id FROM public.comments WHERE id = 'aaaa1111-0000-0000-0000-0000000c0001'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'fn_populate_workspace_for_comment denormalized workspace_id from project entity'
);

SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

SELECT is(
  (SELECT count(*)::int FROM public.comments WHERE id = 'aaaa1111-0000-0000-0000-0000000c0001'),
  1, 'user_a can SELECT own-workspace comment'
);

SELECT is(
  (SELECT count(*)::int FROM public.comments WHERE id = 'bbbb2222-0000-0000-0000-0000000c0002'),
  0, 'user_a cannot SELECT workspace-B comment'
);

WITH upd AS (
  UPDATE public.comments SET body = 'hijack' WHERE id = 'bbbb2222-0000-0000-0000-0000000c0002'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0, 'user_a cannot UPDATE workspace-B comment');

INSERT INTO public.comments (id, entity_type, entity_id, body)
VALUES ('aaaa1111-0000-0000-0000-0000000c0099', 'project',
        'aaaa1111-0000-0000-0000-000000000001', 'audit probe');

SELECT is(
  (SELECT created_by FROM public.comments WHERE id = 'aaaa1111-0000-0000-0000-0000000c0099'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'comments audit trigger populates created_by'
);


-- ── 0033: the migration-0011 privilege trap, for comments ──
-- 0011's blanket GRANT plus its ALTER DEFAULT PRIVILEGES left anon holding
-- every table privilege on comments; 0033 revoked it. Assert the revoke rather
-- than assume it — a policy-only check passes while a privilege hole is wide
-- open, which is exactly how 26 tables stayed open until S21 tripped over one.
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.comments', 'SELECT') OR
    has_table_privilege('anon', 'public.comments', 'INSERT') OR
    has_table_privilege('anon', 'public.comments', 'UPDATE') OR
    has_table_privilege('anon', 'public.comments', 'DELETE')
  ),
  'anon holds no table privilege on comments'
);

SELECT * FROM finish();
ROLLBACK;
