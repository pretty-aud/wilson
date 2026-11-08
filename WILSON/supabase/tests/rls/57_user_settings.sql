-- =============================================================================
-- 57_user_settings.sql — Session 31: personal settings per PERSON (0046).
--
-- What it PINS:
--   1. Own row only, on all four verbs, with NO admin bypass. These are the
--      user's own edited AI prompts — prose they wrote, not a business record,
--      and a company admin has no read on them.
--   2. 🚨 NO WORKSPACE DEPENDENCE (probe 14), for the same reason and with the
--      same citation as 56_user_pets.sql: 0020:18-21, the self-row exception.
--      One set of settings per person, everywhere.
--   3. One row per person by PRIMARY KEY.
--   4. Both JSONB columns must be OBJECTS — the client spreads them, and an
--      array or scalar would throw at the call site instead of the boundary.
--   5. 0098 (VW1c, 2026-10-17): table_view_last, the last used view of each
--      table (her Q4), written through set_table_view_last — the first-ever
--      write makes the row, a write merges one key, the 300 newest stay, the
--      refusals, the CHECK, and nobody else's row is reached (probes 22-37).
--   6. 0123 (MO2, 2026-11-07): moth_prefs, Moth's own settings per person and company, written through
--      set_moth_prefs and read through moth_prefs(), which trusts nothing stored (probes 38-61).
--   7. 0124 (MO3, MO2-12): that map's bound pinned by its definition, not its name (probe 63).
--
-- The sibling suite 56 carries the fuller commentary; this one is deliberately
-- the same shape so a reader can diff them.
-- =============================================================================

BEGIN;

SELECT plan(63);

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

-- Both in workspace A: per-user isolation must be provable without tenancy
-- doing the work.
INSERT INTO public.workspace_members
  (workspace_id, user_id, app_role, username, display_name, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111','cccccccc-cccc-cccc-cccc-cccccccccccc','user','user_c','User C',true),
  ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','user','user_d','User D',true)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- ── structure ───────────────────────────────────────────────────────────────
SELECT has_table('public', 'user_settings', 'user_settings table exists');

SELECT ok(
  (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.user_settings'::regclass),
  'user_settings has FORCE ROW LEVEL SECURITY');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname='public' AND tablename='user_settings' AND cmd='ALL'),
  0, 'no FOR ALL policy arm');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname='public' AND tablename='user_settings'),
  4, 'user_settings carries exactly four policies, one per verb');

SELECT has_trigger('public', 'user_settings', 'trg_user_settings_touch',
  'updated_at is stamped by trigger');

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema='public' AND table_name='user_settings'
       AND grantee IN ('anon', 'PUBLIC')
  ),
  'neither anon nor PUBLIC holds any privilege on user_settings');

-- ── user_c stores their prompts ─────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

-- user_id OMITTED, exactly as the client omits it.
SELECT lives_ok(
  $$INSERT INTO public.user_settings (prompts, agent_prompt_overrides)
    VALUES ('{"companion":"be warm and brief","mc":"four options"}'::jsonb,
            '{"otter":{"systemPromptOverride":"cite sources"}}'::jsonb)$$,
  'a member can store their own settings');

SELECT is(
  (SELECT user_id::text FROM public.user_settings LIMIT 1),
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'the database stamps the owner from the JWT, not the client');

SELECT throws_ok(
  $$INSERT INTO public.user_settings (user_id, prompts)
    VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', '{"companion":"stolen"}'::jsonb)$$,
  'new row violates row-level security policy for table "user_settings"',
  'a member cannot store settings on behalf of someone else');

-- ── user_d has their own ────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd',
                      '11111111-1111-1111-1111-111111111111');

SELECT lives_ok(
  $$INSERT INTO public.user_settings (prompts)
    VALUES ('{"companion":"be terse"}'::jsonb)$$,
  'a second member in the SAME workspace stores their own settings independently');

-- Presence control: this reader DOES see a row, so the zero probes cannot pass
-- vacuously on an empty table.
SELECT is((SELECT count(*)::int FROM public.user_settings),
          1, 'each member sees exactly one settings row — their own (presence control)');

SELECT is((SELECT prompts->>'companion' FROM public.user_settings),
          'be terse', 'and it is THEIR prompt text, not the other member''s');

-- ── no admin bypass ─────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT is((SELECT count(*)::int FROM public.user_settings),
          0, 'a workspace ADMIN cannot read a member''s prompt text');

-- ── 🚨 no workspace, still your settings ────────────────────────────────────
-- Claims carry `sub` and nothing else. Every other policied table in this
-- schema returns zero rows here. If a later session adds the workspace clause
-- its neighbours all have, THIS is the probe that fails.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','cccccccc-cccc-cccc-cccc-cccccccccccc','role','authenticated'
)::text, true);
SELECT set_config('role','authenticated', true);

SELECT is((SELECT prompts->>'companion' FROM public.user_settings),
          'be warm and brief',
          'a user with NO workspace in their JWT still reads their own settings');

-- ── editable, and only your own ─────────────────────────────────────────────
-- Deliberately still running under the workspace-less claims set above, so
-- this proves a user with no workspace can WRITE their settings as well as read
-- them — the half a read-only probe would miss.
SELECT lives_ok(
  $$UPDATE public.user_settings
       SET prompts = prompts || '{"companion":"be warmer"}'::jsonb$$,
  'a member with NO workspace can still update their own settings');

-- The statement above was unqualified; assert the VALUE on the other row,
-- because an RLS-refused UPDATE raises nothing and affects zero rows.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

SELECT is(
  (SELECT prompts->>'companion' FROM public.user_settings
    WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'be terse',
  'an unqualified UPDATE could not reach the other member''s settings');

-- ── the JSONB columns must be objects ───────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

SELECT throws_ok(
  $$UPDATE public.user_settings SET prompts = '["not","an","object"]'::jsonb$$,
  'new row for relation "user_settings" violates check constraint "user_settings_prompts_chk"',
  'prompts must be an object — the client spreads it');

SELECT throws_ok(
  $$INSERT INTO public.user_settings (prompts) VALUES ('{}'::jsonb)$$,
  'duplicate key value violates unique constraint "user_settings_pkey"',
  'one settings row per person is a PRIMARY KEY, not a convention');

-- ── a person can discard their own ──────────────────────────────────────────
SELECT lives_ok(
  $$DELETE FROM public.user_settings$$,
  'a member can delete their own settings');

SELECT is((SELECT count(*)::int FROM public.user_settings),
          0, 'and they are gone for them');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- Scoped to user_d like the :161 probe above, not count(*): an unscoped
-- postgres read counts REAL rows on a live env (suite 56's twin probe
-- failed exactly that way in S33, have:2, the day dev carried an actual
-- pet — this table's writer shipped in S31 and is one sign-in away from
-- the same decay).
SELECT is((SELECT count(*)::int FROM public.user_settings
            WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
          1, 'the other member''s settings survived the unqualified DELETE');

-- ── 0098 (VW1c, 2026-10-17): the last used view (her Q4) ────────────────────
-- user_settings.table_view_last, written by the client only through
-- set_table_view_last (SECURITY INVOKER, one statement): the first-ever write
-- makes the person's row, a write merges one key with the server's clock, the
-- 300 newest are kept, and nobody else's row is reached.

-- 22
SELECT has_column('public', 'user_settings', 'table_view_last',
  'user_settings carries table_view_last (0098 §9)');

-- 23
SELECT ok(
  has_function_privilege('authenticated', 'public.set_table_view_last(text, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.set_table_view_last(text, text)', 'EXECUTE')
  AND NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.set_table_view_last(text, text)'::regprocedure),
  'set_table_view_last runs as the caller, for authenticated only');

-- user_c discarded their row above: their next write is a first-ever one.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
SELECT tests.login_as('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      '11111111-1111-1111-1111-111111111111');

-- 24
SELECT lives_ok(
  $$SELECT public.set_table_view_last('aaaa1111-0000-0000-0000-000000000001:tasks',
                                      '10111111-0000-0000-0000-000000000001')$$,
  'the first-ever write of a person with no settings row makes the row (one statement)');

-- 25
SELECT is(
  (SELECT table_view_last -> 'aaaa1111-0000-0000-0000-000000000001:tasks' ->> 'view' FROM public.user_settings),
  '10111111-0000-0000-0000-000000000001',
  'and holds the view for that project''s table');

-- 26
SELECT ok(
  (SELECT jsonb_typeof(table_view_last -> 'aaaa1111-0000-0000-0000-000000000001:tasks' -> 'at') = 'number'
      AND prompts = '{}'::jsonb
     FROM public.user_settings),
  'stamped with the server''s clock; the new row''s prompts left at their default');

-- 27
SELECT lives_ok(
  $$SELECT public.set_table_view_last('aaaa1111-0000-0000-0000-000000000001:assets', 'all')$$,
  'a second table''s last view merges in (the built-in All view is "all")');

-- 28
SELECT is(
  (SELECT string_agg(k, ',' ORDER BY k) FROM public.user_settings, jsonb_object_keys(table_view_last) AS k),
  'aaaa1111-0000-0000-0000-000000000001:assets,aaaa1111-0000-0000-0000-000000000001:tasks',
  'both keys kept: a write merges its one key, it never replaces the map');

-- 29
SELECT throws_ok(
  $$SELECT public.set_table_view_last('not-a-key', 'all')$$,
  '22023', NULL, 'a key that is not "<project id>:<table>" is refused');

-- 30
SELECT throws_ok(
  $$SELECT public.set_table_view_last('aaaa1111-0000-0000-0000-000000000001:budget', 'all')$$,
  '22023', NULL, 'a table with no views is refused');

-- 31
SELECT throws_ok(
  $$SELECT public.set_table_view_last('aaaa1111-0000-0000-0000-000000000001:tasks', 'everything')$$,
  '22023', NULL, 'a view that is neither an id nor "all" is refused');

-- The trim: user_d's map seeded with 300 old entries (at 1 … 300), as postgres.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;
UPDATE public.user_settings
   SET table_view_last = (SELECT jsonb_object_agg(lpad(g::text, 8, '0') || '-0000-0000-0000-000000000000:tasks',
                                                  jsonb_build_object('view', 'all', 'at', g))
                            FROM generate_series(1, 300) AS g)
 WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
SELECT tests.login_as('dddddddd-dddd-dddd-dddd-dddddddddddd',
                      '11111111-1111-1111-1111-111111111111');

-- 32
SELECT lives_ok(
  $$SELECT public.set_table_view_last('aaaa1111-0000-0000-0000-000000000001:tasks', 'all')$$,
  'a person with 300 tables remembered writes a 301st');

-- 33
SELECT ok(
  (SELECT count(*) = 300 FROM public.user_settings, jsonb_object_keys(table_view_last))
  AND (SELECT table_view_last ? 'aaaa1111-0000-0000-0000-000000000001:tasks' FROM public.user_settings)
  AND NOT (SELECT table_view_last ? '00000001-0000-0000-0000-000000000000:tasks' FROM public.user_settings)
  AND (SELECT table_view_last ? '00000002-0000-0000-0000-000000000000:tasks' FROM public.user_settings),
  'the 300 newest are kept: the oldest goes, the new one and the next-oldest stay');

-- 34
SELECT is(
  (SELECT prompts->>'companion' FROM public.user_settings),
  'be terse',
  'the merge never touches the prompts');

SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

-- 35
SELECT ok(
  (SELECT table_view_last ? 'aaaa1111-0000-0000-0000-000000000001:assets' FROM public.user_settings
    WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc')
  AND NOT (SELECT table_view_last ? 'aaaa1111-0000-0000-0000-000000000001:assets' FROM public.user_settings
            WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'each person''s writes land in their own row only');

-- 36
SELECT throws_ok(
  $$UPDATE public.user_settings SET table_view_last = '[1]'::jsonb
     WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'$$,
  '23514', NULL, 'the map must be an object, whoever writes it (the CHECK)');

-- 37
SELECT throws_ok(
  $$UPDATE public.user_settings SET table_view_last = jsonb_build_object('pad', repeat('x', 70000))
     WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'$$,
  '23514', NULL, 'the map is at most 64 KB');

-- ── 0123 (MO2): moth_prefs, Moth's own settings per person and company ─────────────────────────
-- Written through set_moth_prefs (a patch of known keys, merged), read through moth_prefs(), which trusts
-- nothing stored: the row is the person's own to write directly, so a forged entry is read as untrusted.
SELECT set_config('request.jwt.claims', '{}', true);
RESET ROLE;

CREATE FUNCTION public.t57_as(p_user uuid, p_ws uuid DEFAULT '11111111-1111-1111-1111-111111111111')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated',
    'app_metadata', json_build_object('workspace_id', p_ws, 'app_role', 'user'))::text, true);
END;
$f$;
CREATE FUNCTION public.t57_err(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  s text;
BEGIN
  EXECUTE p_sql;
  RETURN 'no refusal';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS s = RETURNED_SQLSTATE;
  RETURN s;
END;
$f$;

SELECT public.t57_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT set_config('request.jwt.claims', json_build_object('sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin'))::text, true);
INSERT INTO public.projects (id, workspace_id, title, created_by) VALUES
  ('aaaa0570-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Salt Hours', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO public.folders (id, project_id, parent_id, kind, slug, path) VALUES
  ('05700000-0000-0000-0000-000000000070', 'aaaa0570-0000-0000-0000-00000000000a', NULL, 'root', 'salt-hours', ''),
  ('05700000-0000-0000-0000-000000000071', 'aaaa0570-0000-0000-0000-00000000000a', '05700000-0000-0000-0000-000000000070', 'category', 'ASSETS', 'ASSETS'),
  ('05700000-0000-0000-0000-000000000072', 'aaaa0570-0000-0000-0000-00000000000a', '05700000-0000-0000-0000-000000000070', 'category', 'INVOICES', 'INVOICES');
SELECT public.t57_as('cccccccc-cccc-cccc-cccc-cccccccccccc');
INSERT INTO public.moth_views (id, scope_kind, name) VALUES ('05700000-0000-0000-0000-0000000000a1', 'aggregate', 'C own');
SELECT public.t57_as('dddddddd-dddd-dddd-dddd-dddddddddddd');
INSERT INTO public.moth_views (id, scope_kind, name) VALUES ('05700000-0000-0000-0000-0000000000a2', 'aggregate', 'D own');

CREATE TEMP TABLE t57_before ON COMMIT DROP AS SELECT table_view_last AS tvl, prompts AS pr FROM public.user_settings WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
GRANT SELECT ON t57_before TO authenticated;
-- 38
SELECT ok((SELECT is_nullable = 'NO' AND column_default LIKE '''{}''::jsonb%' FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'user_settings' AND column_name = 'moth_prefs'),
  'moth_prefs: an object, empty to begin with, never null');
-- 39
SELECT ok(NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.set_moth_prefs(jsonb)'::regprocedure)
          AND NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.moth_prefs()'::regprocedure)
          AND has_function_privilege('authenticated', 'public.set_moth_prefs(jsonb)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.moth_prefs()', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.set_moth_prefs(jsonb)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.moth_prefs()', 'EXECUTE'),
  'the writer and the reader run as their caller, for signed-in callers only');

SET LOCAL ROLE authenticated;
SELECT public.t57_as('cccccccc-cccc-cccc-cccc-cccccccccccc');
-- 40
SELECT is(public.moth_prefs(), '{}'::jsonb, 'nothing yet');
-- 41
SELECT is(public.set_moth_prefs('{"last_view":"q:tags","first_visit_done":true}') - 'appearance',
  '{"last_view":"q:tags","first_visit_done":true}'::jsonb, 'the first visit done, the last view a quick start');
-- 42
SELECT ok(public.set_moth_prefs('{"appearance":{"glow":"#ffb347","size_by":"contents"}}') IS NOT NULL
          AND (public.set_moth_prefs('{"appearance":{"colour_by":"tag"}}') -> 'appearance')
              = '{"glow":"#ffb347","size_by":"contents","colour_by":"tag"}'::jsonb,
  'appearance merges key by key');
-- 43
SELECT is(public.set_moth_prefs('{"last_view":"05700000-0000-0000-0000-0000000000a1"}') ->> 'last_view',
  '05700000-0000-0000-0000-0000000000a1', 'the last view may be a saved view the person sees');
-- 44
SELECT is(public.set_moth_prefs('{"recent":[{"k":"folder","id":"05700000-0000-0000-0000-000000000071"},{"k":"project","id":"aaaa0570-0000-0000-0000-00000000000a"}]}') -> 'recent',
  '[{"k":"folder","id":"05700000-0000-0000-0000-000000000071"},{"k":"project","id":"aaaa0570-0000-0000-0000-00000000000a"}]'::jsonb,
  'the folders opened last');
-- 45
SELECT is((public.moth_prefs() ->> 'first_visit_done') || ' ' || (public.moth_prefs() -> 'appearance' ->> 'glow'), 'true #ffb347',
  'each write keeps what it did not name');
-- 46
SELECT is(public.t57_err($$ SELECT public.set_moth_prefs('{"pets":1}') $$), '22023', 'no unknown setting');
-- 47
SELECT is(public.t57_err($$ SELECT public.set_moth_prefs('{"appearance":{"glow":"#FFF"}}') $$)
       || public.t57_err($$ SELECT public.set_moth_prefs('{"appearance":{"size_by":"big"}}') $$)
       || public.t57_err($$ SELECT public.set_moth_prefs('{"appearance":{"colour_by":1}}') $$)
       || public.t57_err($$ SELECT public.set_moth_prefs('{"appearance":{"blur":"on"}}') $$),
  '22023220232202322023', 'appearance only in its own words');
-- 48
SELECT is(public.t57_err($$ SELECT public.set_moth_prefs(jsonb_build_object('recent', (SELECT jsonb_agg(jsonb_build_object('k', 'folder', 'id', '05700000-0000-0000-0000-000000000071')) FROM generate_series(1, 9)))) $$)
       || public.t57_err($$ SELECT public.set_moth_prefs('{"recent":[{"k":"file","id":"05700000-0000-0000-0000-000000000071"}]}') $$)
       || public.t57_err($$ SELECT public.set_moth_prefs('{"recent":[{"k":"folder","id":"05700000-0000-0000-0000-000000000071","x":1}]}') $$)
       || public.t57_err($$ SELECT public.set_moth_prefs('{"recent":[{"k":"folder","id":"nope"}]}') $$),
  '22023220232202322023', 'at most eight folders opened last, each a folder or a project by id');
-- 49
SELECT is(public.t57_err($$ SELECT public.set_moth_prefs('{"last_view":"anything"}') $$)
       || public.t57_err($$ SELECT public.set_moth_prefs('{"first_visit_done":"yes"}') $$)
       || public.t57_err($$ SELECT public.set_moth_prefs('[1]') $$),
  '220232202322023', 'a last view, a first visit and the patch itself, each of its shape');

-- 50: a forged entry, written straight into the row the person owns.
UPDATE public.user_settings
   SET moth_prefs = jsonb_set(moth_prefs, ARRAY['11111111-1111-1111-1111-111111111111'],
         (moth_prefs -> '11111111-1111-1111-1111-111111111111')
         || jsonb_build_object(
              'last_view', '05700000-0000-0000-0000-0000000000a2',
              'appearance', '{"glow":"red","light":"light","extra":"x"}'::jsonb,
              'recent', '[{"k":"folder","id":"05700000-0000-0000-0000-000000000072"},{"k":"folder","id":"not-an-id"},{"k":"folder","id":"05700000-0000-0000-0000-000000000071"}]'::jsonb))
 WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
SELECT is(public.moth_prefs(),
  '{"first_visit_done":true,"appearance":{"light":"light"},"recent":[{"k":"folder","id":"05700000-0000-0000-0000-000000000071"}]}'::jsonb,
  'the reader keeps of a forged entry only what is of its shape and still visible: not another''s view, not a money folder');
-- 51
UPDATE public.user_settings
   SET moth_prefs = jsonb_set(moth_prefs, ARRAY['11111111-1111-1111-1111-111111111111', 'recent'],
         (SELECT jsonb_agg(jsonb_build_object('k', 'folder', 'id', '05700000-0000-0000-0000-000000000071')) FROM generate_series(1, 20)))
 WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
SELECT is(jsonb_array_length(public.moth_prefs() -> 'recent'), 8, 'eight at most, whatever is stored');
-- 52
UPDATE public.user_settings
   SET moth_prefs = jsonb_set(moth_prefs, ARRAY['11111111-1111-1111-1111-111111111111', 'member_since'], '946684800000')
 WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
SELECT is(public.moth_prefs(), '{}'::jsonb, 'an entry stamped for another membership is not this one''s');
-- 53
SELECT is(public.set_moth_prefs('{"first_visit_done":true}') - 'appearance', '{"first_visit_done":true}'::jsonb, '… and the next write starts afresh too');
SELECT is(public.set_moth_prefs('{"last_view":"Q:TAGS"}') ->> 'last_view', 'q:tags', 'a quick start is kept in the reader''s own letters');
RESET ROLE;
-- Removed from the company and added again: a new membership, so the settings start afresh.
SELECT set_config('request.jwt.claims', json_build_object('sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin'))::text, true);
DELETE FROM public.workspace_members WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
INSERT INTO public.workspace_members (workspace_id, user_id, app_role, username, display_name, is_active, created_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'user', 'user_c', 'User C', true, now() + interval '1 second');
SET LOCAL ROLE authenticated;
SELECT public.t57_as('cccccccc-cccc-cccc-cccc-cccccccccccc');
SELECT is(public.moth_prefs(), '{}'::jsonb, 'a person removed and added again starts afresh');
-- 54
UPDATE public.user_settings
   SET moth_prefs = moth_prefs || jsonb_build_object('22222222-2222-2222-2222-222222222222', jsonb_build_object('last_view', 'q:tags', 'member_since', (SELECT floor(extract(epoch FROM wm.created_at) * 1000) FROM public.workspace_members wm WHERE wm.workspace_id = '11111111-1111-1111-1111-111111111111' AND wm.user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc')))
 WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
SELECT is(public.moth_prefs() ->> 'last_view', NULL, 'another company''s entry is not this one''s, though stamped as this membership');
-- 55
UPDATE public.user_settings
   SET moth_prefs = moth_prefs || (SELECT jsonb_object_agg(lpad(g::text, 8, '0') || '-0000-0000-0000-000000000000', jsonb_build_object('at', g)) FROM generate_series(1, 12) g)
 WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
SELECT public.set_moth_prefs('{"first_visit_done":false}');
SELECT ok((SELECT count(*) FROM public.user_settings, jsonb_object_keys(moth_prefs) WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc') = 10
          AND (SELECT moth_prefs ? '11111111-1111-1111-1111-111111111111' FROM public.user_settings WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'ten companies at most, the newest, this one among them');
-- 56
SELECT ok((SELECT table_view_last = t57_before.tvl AND prompts = t57_before.pr FROM public.user_settings, t57_before WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'the other settings stand, each as it was');
RESET ROLE;
-- 57
SELECT is(COALESCE((SELECT moth_prefs FROM public.user_settings WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'), '{}'::jsonb), '{}'::jsonb,
  'another person''s row is untouched');
-- 58
SELECT set_config('request.jwt.claims', json_build_object('sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin'))::text, true);
INSERT INTO public.user_settings (user_id) VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd') ON CONFLICT (user_id) DO NOTHING;
UPDATE public.user_settings
   SET moth_prefs = jsonb_build_object('11111111-1111-1111-1111-111111111111', jsonb_build_object('first_visit_done', true, 'member_since', (SELECT floor(extract(epoch FROM wm.created_at) * 1000) FROM public.workspace_members wm WHERE wm.workspace_id = '11111111-1111-1111-1111-111111111111' AND wm.user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd')))
 WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
UPDATE public.workspace_members SET is_active = false
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111' AND user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
SET LOCAL ROLE authenticated;
SELECT public.t57_as('dddddddd-dddd-dddd-dddd-dddddddddddd');
SELECT is(public.t57_err($$ SELECT public.set_moth_prefs('{"first_visit_done":true}') $$) || ' ' || public.moth_prefs()::text, '42501 {}',
  'someone who has left neither writes nor reads Moth''s settings');
-- 59
SELECT public.t57_as('cccccccc-cccc-cccc-cccc-cccccccccccc');
SELECT is(public.t57_err($$ UPDATE public.user_settings SET moth_prefs = '[1]'::jsonb WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$)
       || public.t57_err($$ UPDATE public.user_settings SET moth_prefs = jsonb_build_object('pad', repeat('x', 33000)) WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$),
  '2351423514', 'the stored map is an object of at most 32 KB, whoever writes it');
RESET ROLE;

-- 62: what the plants found unprobed: a forged entry naming a file, a task or a phase as an opened folder, written
-- straight into the person's own row, is not given back, though the person can see that file.
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'role', 'authenticated',
  'app_metadata', json_build_object('workspace_id', '11111111-1111-1111-1111-111111111111', 'app_role', 'admin'))::text, true);
INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial) VALUES
  ('05700000-0000-0000-0000-0000000000f1', 'aaaa0570-0000-0000-0000-00000000000a', 'plain.png', 'supabase', 'projects/aaaa0570-0000-0000-0000-00000000000a/files/05700000-0000-0000-0000-0000000000f1/plain.png', false);
INSERT INTO public.tasks (id, project_id, title) VALUES ('05700000-0000-0000-0000-0000000000f2', 'aaaa0570-0000-0000-0000-00000000000a', 'Grade');
SET LOCAL ROLE authenticated;
SELECT public.set_moth_prefs('{"recent":[{"k":"folder","id":"05700000-0000-0000-0000-000000000071"}]}');
UPDATE public.user_settings
   SET moth_prefs = jsonb_set(moth_prefs, ARRAY['11111111-1111-1111-1111-111111111111', 'recent'],
         '[{"k":"file","id":"05700000-0000-0000-0000-0000000000f1"},{"k":"task","id":"05700000-0000-0000-0000-0000000000f2"},{"k":"folder","id":"05700000-0000-0000-0000-000000000071"}]'::jsonb)
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
SELECT ok(public.moth_can_read_target('file', '05700000-0000-0000-0000-0000000000f1')
          AND public.moth_can_read_target('task', '05700000-0000-0000-0000-0000000000f2')
          AND public.moth_prefs() -> 'recent' = '[{"k":"folder","id":"05700000-0000-0000-0000-000000000071"}]'::jsonb,
  'a forged opened folder that is a file or a task is not given back, though the file is the person''s to see');
RESET ROLE;

-- 63: 0124 (MO2-12): the stored map's bound by what it is, so a draft of the same name is not taken for it.
SELECT is((SELECT pg_get_constraintdef(c.oid) || ' ' || c.convalidated::text FROM pg_constraint c
            WHERE c.conrelid = 'public.user_settings'::regclass AND c.conname = 'user_settings_moth_prefs_chk'),
  'CHECK (((jsonb_typeof(moth_prefs) = ''object''::text) AND (octet_length((moth_prefs)::text) <= 32768))) true',
  'the settings'' bound is 0123''s, by its definition (0124)');

SELECT * FROM finish();

ROLLBACK;
