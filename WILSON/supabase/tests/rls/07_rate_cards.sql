-- pgTAP: rate_cards RLS (direct workspace_id)
BEGIN;
SELECT plan(4);

SELECT * FROM tests.rls_setup();

INSERT INTO public.rate_cards (id, workspace_id, name) VALUES
  ('aaaa1111-0000-0000-0000-000000000e01', '11111111-1111-1111-1111-111111111111', 'RC A'),
  ('bbbb2222-0000-0000-0000-000000000e02', '22222222-2222-2222-2222-222222222222', 'RC B');

SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

SELECT is(
  (SELECT count(*)::int FROM public.rate_cards WHERE id = 'aaaa1111-0000-0000-0000-000000000e01'),
  1, 'user_a can SELECT own-workspace rate_card'
);

SELECT is(
  (SELECT count(*)::int FROM public.rate_cards WHERE id = 'bbbb2222-0000-0000-0000-000000000e02'),
  0, 'user_a cannot SELECT workspace-B rate_card'
);

WITH upd AS (
  UPDATE public.rate_cards SET name = 'hijack' WHERE id = 'bbbb2222-0000-0000-0000-000000000e02'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0, 'user_a cannot UPDATE workspace-B rate_card');

INSERT INTO public.rate_cards (id, workspace_id, name)
VALUES ('aaaa1111-0000-0000-0000-000000000e99',
        '11111111-1111-1111-1111-111111111111', 'audit probe');

SELECT is(
  (SELECT created_by FROM public.rate_cards WHERE id = 'aaaa1111-0000-0000-0000-000000000e99'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'rate_cards audit trigger populates created_by'
);

SELECT * FROM finish();
ROLLBACK;
