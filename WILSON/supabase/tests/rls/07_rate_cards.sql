-- pgTAP: rate_cards RLS (direct workspace_id) + the 0032 `type` column
BEGIN;
SELECT plan(9);

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

-- ── probes 5-8: the 0032 `type` column ───────────────────────────────────
-- The whole internal-vs-general feature keys on this column, and it was
-- absent from the cloud schema until 0032 — useRateCard.js wrote it on every
-- card create and PostgREST rejected the insert with PGRST204.

SELECT has_column(
  'public', 'rate_cards', 'type',
  '0032: rate_cards has a type column'
);

-- Omitting `type` must land on the client-facing card, not NULL. This is the
-- same path every pre-0032 row took through the NOT NULL DEFAULT backfill.
INSERT INTO public.rate_cards (id, workspace_id, name)
VALUES ('aaaa1111-0000-0000-0000-000000000e97',
        '11111111-1111-1111-1111-111111111111', 'untyped card');

SELECT is(
  (SELECT type FROM public.rate_cards WHERE id = 'aaaa1111-0000-0000-0000-000000000e97'),
  'general',
  '0032: type defaults to general when the caller omits it'
);

-- The internal card is the one Audrey could not reach.
SELECT lives_ok(
  $$INSERT INTO public.rate_cards (id, workspace_id, name, type)
    VALUES ('aaaa1111-0000-0000-0000-000000000e96',
            '11111111-1111-1111-1111-111111111111', 'Internal Rate Card', 'internal')$$,
  '0032: type accepts internal'
);

-- Closed enum: a typo must fail loudly rather than create a third card shell
-- that no code path ever reads.
SELECT throws_ok(
  $$INSERT INTO public.rate_cards (id, workspace_id, name, type)
    VALUES ('aaaa1111-0000-0000-0000-000000000e95',
            '11111111-1111-1111-1111-111111111111', 'bogus card', 'contractor')$$,
  'new row for relation "rate_cards" violates check constraint "rc_type_chk"',
  '0032: rc_type_chk rejects a type outside general/internal'
);

-- ── probe 9: the migration-0011 privilege trap ───────────────────────────
-- 0011's ALTER DEFAULT PRIVILEGES re-widens anon on every object a later
-- migration creates. 0032 adds no new object, so a column inherits the
-- table's existing grants — but assert it rather than assume it, because a
-- policy-only check passes while a privilege hole is wide open.
SELECT ok(
  NOT (
    has_table_privilege('anon', 'public.rate_cards', 'SELECT') OR
    has_table_privilege('anon', 'public.rate_cards', 'INSERT') OR
    has_table_privilege('anon', 'public.rate_cards', 'UPDATE') OR
    has_table_privilege('anon', 'public.rate_cards', 'DELETE')
  ),
  'anon holds no table privilege on rate_cards'
);

SELECT * FROM finish();
ROLLBACK;
