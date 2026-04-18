-- pgTAP: rate_card_entries RLS (parent-join via rate_cards)
BEGIN;
SELECT plan(4);

SELECT * FROM tests.rls_setup();

INSERT INTO public.rate_cards (id, workspace_id, name) VALUES
  ('aaaa1111-0000-0000-0000-000000000e01', '11111111-1111-1111-1111-111111111111', 'RC A'),
  ('bbbb2222-0000-0000-0000-000000000e02', '22222222-2222-2222-2222-222222222222', 'RC B');

INSERT INTO public.rate_card_entries (id, rate_card_id, role_label, role_slug) VALUES
  ('aaaa1111-0000-0000-0000-000000000f01', 'aaaa1111-0000-0000-0000-000000000e01', 'Lead', 'lead'),
  ('bbbb2222-0000-0000-0000-000000000f02', 'bbbb2222-0000-0000-0000-000000000e02', 'Lead', 'lead');

SELECT tests.login_as(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111'
);

SELECT is(
  (SELECT count(*)::int FROM public.rate_card_entries WHERE id = 'aaaa1111-0000-0000-0000-000000000f01'),
  1, 'user_a can SELECT own-workspace rate_card_entry'
);

SELECT is(
  (SELECT count(*)::int FROM public.rate_card_entries WHERE id = 'bbbb2222-0000-0000-0000-000000000f02'),
  0, 'user_a cannot SELECT workspace-B rate_card_entry'
);

WITH upd AS (
  UPDATE public.rate_card_entries SET role_label = 'hijack'
   WHERE id = 'bbbb2222-0000-0000-0000-000000000f02'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0, 'user_a cannot UPDATE workspace-B rate_card_entry');

INSERT INTO public.rate_card_entries (id, rate_card_id, role_label, role_slug)
VALUES ('aaaa1111-0000-0000-0000-000000000f99',
        'aaaa1111-0000-0000-0000-000000000e01', 'audit', 'audit');

SELECT is(
  (SELECT created_by FROM public.rate_card_entries WHERE id = 'aaaa1111-0000-0000-0000-000000000f99'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'rate_card_entries audit trigger populates created_by'
);

SELECT * FROM finish();
ROLLBACK;
