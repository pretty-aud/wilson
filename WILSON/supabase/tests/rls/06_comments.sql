-- pgTAP: comments RLS (polymorphic — denormalized workspace_id via trigger)
BEGIN;
SELECT plan(5);

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

SELECT * FROM finish();
ROLLBACK;
