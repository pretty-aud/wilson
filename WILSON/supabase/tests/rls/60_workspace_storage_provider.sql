-- =============================================================================
-- 60_workspace_storage_provider.sql — Session 36: the storage provider
-- registry (0050)
--
-- What this pins, in the order the session's contract states it:
--
-- 🚨 REFERENCED BY DESCRIPTION, NOT BY ORDINAL. An earlier draft of this
-- header cited probe numbers and two of the four were off by one — they shift
-- the moment a probe is inserted, which this file has now done. Cite what a
-- probe SAYS (the project's cite-symbols-not-lines rule).
--
--   1. ADDITIVE BY CONTRACT. 0048's five path CHECKs are still present AND
--      still refuse exactly what they refused in S34 — re-run here against
--      provider = 'network', which is what a NAS row now says. If any S34
--      refusal is looser after this session, the session failed its own
--      contract, and the three 'network: …' refusals plus their accept
--      control are what notice.
--
--   2. THE CONVERSE ARM, which is the hole 0050 exists to close. A pathless
--      provider satisfies all five 0048 CHECKs vacuously (root_path and
--      root_kind both NULL). 'a non-filesystem provider cannot carry a
--      root_path (the converse arm)' is the probe that fails if
--      workspace_storage_root_provider_path_chk is ever dropped, and it is
--      constructed to violate that constraint and NOTHING ELSE (mode
--      'central' + provider 'petal' satisfies mode_provider_chk; the path is
--      canonical UNC with a matching kind, so root_pair, root_canon and
--      kind_shape all pass). Per the S33 rule, a refusal probe pins one check
--      only if every other check waves its caller through.
--
--   3. NO UN-IMPLEMENTED PROVIDER SHIPS. Probes 12-13 assert that 'gdrive'
--      and 's3' are REFUSED today. They are not typos — they are the session's
--      promise that S37 and S38 each widen the CHECK alongside the adapter
--      that can resolve the value, never ahead of it.
--
--   4. MONEY-GATED FILES NEVER LEAVE SUPABASE (§4a2b invariant 2). BOTH arms
--      of the constraint are pinned INDEPENDENTLY — 'is_financial alone …'
--      isolates the row flag over an ordinary path, and 'an INVOICES path …
--      even with is_financial false' isolates the reserved segment — plus the
--      combined production shape and FOUR ACCEPT controls, so the constraint
--      can neither pass by refusing everything nor lose an arm unnoticed.
--
--   5. 0049 STILL BINDS, AND ALREADY FAILS CLOSED FOR A PATHLESS PROVIDER.
--      fn_project_folder_root_guard refuses when root_path IS NULL. That is
--      the shape of staging's one real row TODAY (mode byos, no path yet) and
--      it is also the shape every bucket-backed provider will have, so
--      "what does a project folder mean when the provider is not a
--      filesystem?" is already answered: it is refused, with a sentence
--      naming what to do. Probes 29-31 prove it without needing a provider
--      that does not exist yet.
--
-- 🚨 CONSTRAINT NAMES DECIDE THE MESSAGE. Measured on dev 2026-08-07: with
-- several CHECKs violated at once Postgres reports the ALPHABETICALLY FIRST
-- constraint name, and throws_ok matches SQLERRM exactly. Every refusal probe
-- below is therefore built to violate exactly ONE constraint. See 0050's
-- header.
--
-- Postgres-side reads are ALWAYS scoped to the fixture workspaces — dev
-- carries real rows, and an unscoped count decays the day the feature is used.
-- =============================================================================

BEGIN;

SELECT plan(32);

SELECT * FROM tests.rls_setup();

-- ── 1. Structure (as postgres: RLS is not what these prove) ──────────────────

SELECT has_column('public', 'workspace_storage', 'provider',
  'workspace_storage.provider exists');

SELECT has_column('public', 'workspace_storage', 'provider_config',
  'workspace_storage.provider_config exists');

SELECT is(
  (SELECT is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name='workspace_storage'
      AND column_name='provider'),
  'NO', 'provider is NOT NULL — a row with no provider resolves nowhere');

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
    WHERE conrelid='public.workspace_storage'::regclass AND contype='c'
      AND conname IN ('workspace_storage_provider_chk',
                      'workspace_storage_mode_provider_chk',
                      'workspace_storage_root_provider_path_chk',
                      'workspace_storage_provider_config_chk')),
  4, '0050 added exactly its four provider constraints');

-- 🚨 The additive-by-contract assertion. S34's rules are not conditioned,
-- relaxed or rewritten by this session — they are untouched, and this is what
-- notices if a later session "simplifies" one away.
SELECT is(
  (SELECT count(*)::int FROM pg_constraint
    WHERE conrelid='public.workspace_storage'::regclass AND contype='c'
      AND conname IN ('workspace_storage_mode_chk',
                      'workspace_storage_kind_chk',
                      'workspace_storage_root_pair_chk',
                      'workspace_storage_root_canon_chk',
                      'workspace_storage_kind_shape_chk')),
  5, 'all five of S34''s path CHECKs survive 0050 intact');

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
    WHERE conrelid='public.files'::regclass AND contype='c'
      AND conname='files_money_provider_chk'),
  1, 'files carries the money-provider constraint');

-- 🚨 BREAKER HYGIENE. Every refusal probe below INSERTs over the same primary
-- key, so while the constraints hold nothing persists and nothing collides.
-- The moment a constraint is NEUTERED to prove it, that INSERT succeeds and
-- the next probe dies on workspace_storage_pkey — which aborts the whole
-- script and reports a PK error instead of the arm that actually broke. These
-- cleanup DELETEs are no-ops in the green case and are what let each arm be
-- proven individually. (Learned the hard way running S36's own breakers.)
CREATE OR REPLACE FUNCTION pg_temp.ws_reset() RETURNS void LANGUAGE sql AS $$
  DELETE FROM public.workspace_storage
   WHERE workspace_id IN ('11111111-1111-1111-1111-111111111111',
                          '22222222-2222-2222-2222-222222222222');
$$;

-- ── 2. S34's NAS refusals, re-run under provider = 'network' ─────────────────
-- Identical shapes to suite 58's, with the provider stated. If any of these
-- stops refusing, the registry narrowed the NAS path.

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, root_path, root_kind)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 'network', '\\nas\projects\wilson\', 'unc')$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_root_canon_chk"',
  'network: a trailing separator is still refused (§3.2 unchanged)');

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, root_path)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 'network', 'C:\Projects')$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_root_pair_chk"',
  'network: a path without its kind is still refused');

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, root_path, root_kind)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 'network', 'C:\Projects', 'unc')$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_kind_shape_chk"',
  'network: a root_kind contradicting the path shape is still refused');

SELECT pg_temp.ws_reset();

-- The overblock control for the whole section: the canonical NAS row a real
-- customer saves must still be accepted, or the three refusals above would be
-- passing for the wrong reason.
SELECT lives_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, root_path, root_kind)
    VALUES ('22222222-2222-2222-2222-222222222222', 'byos', 'network', '\\nas\projects\wilson', 'unc')$$,
  'network: a canonical UNC root is still accepted');

SELECT is(
  (SELECT root_path FROM public.workspace_storage
    WHERE workspace_id = '22222222-2222-2222-2222-222222222222'),
  '\\nas\projects\wilson',
  'and it landed verbatim — the NAS path is byte-for-byte what S34 stored');

DELETE FROM public.workspace_storage
 WHERE workspace_id = '22222222-2222-2222-2222-222222222222';

-- ── 3. The provider vocabulary: only what exists ─────────────────────────────
-- These two probes are the session's promise, not an oversight.

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 'gdrive')$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_provider_chk"',
  'gdrive is refused until S38 ships the adapter that can resolve it');

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 's3')$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_provider_chk"',
  's3 is refused until S37 ships the adapter that can resolve it');

SELECT pg_temp.ws_reset();

-- ── 4. The two axes must agree ───────────────────────────────────────────────

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 'petal')$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_mode_provider_chk"',
  'byos + petal is refused — "the customer''s own storage, at Petal" is not a thing');

-- 🚨 THE RETAINED STATE, and it must stay LEGAL. 0048: "a root, when present,
-- survives a switch back to 'central' so re-enabling does not mean retyping."
-- An admin on Petal cloud with their NAS remembered is central + network + a
-- path. The first draft of 0050 made this pair impossible with a
-- biconditional and suite 59 caught it; this probe is what stops it coming
-- back. The retained root is INERT, not active — App.jsx pushes it only when
-- mode is 'byos', and 0049 refuses a project folder for the same reason.
SELECT lives_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, root_path, root_kind)
    VALUES ('22222222-2222-2222-2222-222222222222', 'central', 'network', '\\nas\projects\wilson', 'unc')$$,
  'central + network + a path is the RETAINED state — S34''s retyping rule survives 0050');

DELETE FROM public.workspace_storage
 WHERE workspace_id = '22222222-2222-2222-2222-222222222222';

SELECT pg_temp.ws_reset();

-- ── 5. 🚨 THE CONVERSE ARM — the vacuous-pass hole 0050 closes ───────────────
-- mode 'central' + provider 'petal' satisfies mode_provider_chk; the path is
-- canonical UNC and root_kind matches its shape, so root_pair, root_canon and
-- kind_shape ALL PASS. Exactly one constraint can refuse this row, which is
-- what makes it a real breaker probe: delete
-- workspace_storage_root_provider_path_chk from 0050 and this row inserts
-- happily — a filesystem root on a workspace whose media is not on a
-- filesystem, which resolveConfiguredRootDir() would read and act on.
SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, root_path, root_kind)
    VALUES ('11111111-1111-1111-1111-111111111111', 'central', 'petal', '\\nas\projects\wilson', 'unc')$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_root_provider_path_chk"',
  'a non-filesystem provider cannot carry a root_path (the converse arm)');

SELECT pg_temp.ws_reset();

-- ── 6. Per-provider config validation ───────────────────────────────────────
-- Neither provider that exists takes config. Written in 0050 as the general
-- rule, so S37 widening the provider CHECK permits an s3 config with no edit
-- to the config CHECK.

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 'network', '{"bucket":"mine"}'::jsonb)$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_provider_config_chk"',
  'network takes no provider_config — its location is root_path');

SELECT throws_ok(
  $$INSERT INTO public.workspace_storage (workspace_id, mode, provider, provider_config)
    VALUES ('11111111-1111-1111-1111-111111111111', 'central', 'petal', '{"quota":"10GB"}'::jsonb)$$,
  'new row for relation "workspace_storage" violates check constraint "workspace_storage_provider_config_chk"',
  'petal takes no provider_config either — quotas are S41''s own table');

SELECT pg_temp.ws_reset();

-- ── 7. The defaults are coherent ────────────────────────────────────────────
-- 0048 defaults mode to 'central'; 0050 defaults provider to 'petal'. The two
-- defaults must satisfy mode_provider_chk, or the eight fixture INSERTs in
-- suites 58/59 that name neither column would fail.

SELECT lives_ok(
  $$INSERT INTO public.workspace_storage (workspace_id)
    VALUES ('22222222-2222-2222-2222-222222222222')$$,
  'a bare INSERT still works — the two column defaults are a coherent pair');

SELECT is(
  (SELECT mode || '/' || provider FROM public.workspace_storage
    WHERE workspace_id = '22222222-2222-2222-2222-222222222222'),
  'central/petal',
  'and it defaults to Petal cloud, as it did before this session');

DELETE FROM public.workspace_storage
 WHERE workspace_id = '22222222-2222-2222-2222-222222222222';

-- ── 8. 🚨 Money-gated files never leave Supabase (§4a2b invariant 2) ─────────
-- Only RLS enforces the money gate, and it can only see Supabase Storage.
-- BOTH axes are probed, because either alone is a way in.

-- 🚨 THE ROW AXIS, ISOLATED. The path here is ORDINARY, so
-- rabbit_money_segment('asset') is false and the path arm waves this caller
-- through — only `COALESCE(is_financial, false)` can refuse it.
--
-- The first draft of this probe used an INVOICES path AND is_financial=true,
-- which meant the PATH arm refused it and the probe passed identically with
-- the row arm deleted from the constraint. It was labelled "row axis" and
-- pinned nothing. Caught by S36's own pre-deploy adversarial review, against a
-- suite already green at 31/31 with five discriminating breakers — the
-- breakers neuter whole constraints, so they are arm-blind by construction.
-- This is the file's own stated rule turned on itself: a refusal probe pins
-- one check only if every OTHER check waves its caller through.
SELECT throws_ok(
  $$INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial)
    VALUES ('aaaa1111-0000-0000-0000-0000000060a1',
            'aaaa1111-0000-0000-0000-000000000001', 'scan.pdf', 'google_drive',
            'projects/aaaa1111-0000-0000-0000-000000000001/asset/a1/1-scan.pdf', true)$$,
  'new row for relation "files" violates check constraint "files_money_provider_chk"',
  'is_financial alone keeps a file in Supabase, whatever its path (row axis)');

-- And the shape production actually produces: uploadFile derives BOTH the
-- INVOICES segment and is_financial from the same scope.financial, so a real
-- invoice trips both arms. Kept as its own probe so the combined case stays
-- covered now that the one above no longer covers it by accident.
SELECT throws_ok(
  $$INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial)
    VALUES ('aaaa1111-0000-0000-0000-0000000060a5',
            'aaaa1111-0000-0000-0000-000000000001', 'invoice.pdf', 'google_drive',
            'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/x/1-invoice.pdf', true)$$,
  'new row for relation "files" violates check constraint "files_money_provider_chk"',
  'a real invoice trips both arms — the shape uploadFile actually writes');

-- The PATH axis alone, with is_financial deliberately FALSE: the third
-- segment is the BLOB gate and it OUTRANKS the row flag, so a caller who
-- simply omits is_financial must not get an ungoverned invoice (the S35
-- lesson — guard whatever outranks your field).
SELECT throws_ok(
  $$INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial)
    VALUES ('aaaa1111-0000-0000-0000-0000000060a2',
            'aaaa1111-0000-0000-0000-000000000001', 'invoice.pdf', 'google_drive',
            'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/x/1-invoice.pdf', false)$$,
  'new row for relation "files" violates check constraint "files_money_provider_chk"',
  'an INVOICES path cannot leave Supabase even with is_financial false (path axis)');

-- 0039's case-insensitivity carries into the constraint, because it calls the
-- same one definition rather than re-listing the segments.
SELECT throws_ok(
  $$INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial)
    VALUES ('aaaa1111-0000-0000-0000-0000000060a3',
            'aaaa1111-0000-0000-0000-000000000001', 'invoice.pdf', 'google_drive',
            'projects/aaaa1111-0000-0000-0000-000000000001/invoices/x/1-invoice.pdf', false)$$,
  'new row for relation "files" violates check constraint "files_money_provider_chk"',
  'the segment match is case-folded — lowercase invoices is refused too');

SELECT throws_ok(
  $$INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial)
    VALUES ('aaaa1111-0000-0000-0000-0000000060a4',
            'aaaa1111-0000-0000-0000-000000000001', 'RATES.json', 'google_drive',
            'projects/aaaa1111-0000-0000-0000-000000000001/FINANCE/RATES.json', false)$$,
  'new row for relation "files" violates check constraint "files_money_provider_chk"',
  'FINANCE is money-gated too — the rates file cannot leave Supabase');

-- ── The four ACCEPT controls ────────────────────────────────────────────────
-- Without these the constraint could pass by refusing every non-Supabase file,
-- which would silently make BYO storage impossible — the exact opposite of
-- what this session is for.

SELECT lives_ok(
  $$INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial)
    VALUES ('aaaa1111-0000-0000-0000-0000000060b1',
            'aaaa1111-0000-0000-0000-000000000001', 'dailies.mov', 'google_drive',
            'projects/aaaa1111-0000-0000-0000-000000000001/asset/a1/1-dailies.mov', false)$$,
  'an ORDINARY file may live at another provider — BYO storage still works');

SELECT lives_ok(
  $$INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial)
    VALUES ('aaaa1111-0000-0000-0000-0000000060b2',
            'aaaa1111-0000-0000-0000-000000000001', 'invoice.pdf', 'supabase',
            'projects/aaaa1111-0000-0000-0000-000000000001/INVOICES/x/1-invoice.pdf', true)$$,
  'a financial file in Supabase is accepted — the gate is the provider, not the money');

-- The manifest. ⚠️ Its third split_part field is 'PROJECT.json' — NOT '', as
-- an earlier draft of this comment claimed — and it is accepted because
-- rabbit_money_segment('PROJECT.json') is FALSE. Worth stating precisely,
-- because 0042's policies use a DIFFERENT extractor:
-- (storage.foldername(name))[3] drops the filename and so is NULL here. The
-- two agree for every four-field-or-longer path (i.e. every uploaded file);
-- at depth three this CHECK is the stricter, which is the safe direction for
-- a money rule. The genuine '' case is probe 28's bare filename.
SELECT lives_ok(
  $$INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial)
    VALUES ('aaaa1111-0000-0000-0000-0000000060b3',
            'aaaa1111-0000-0000-0000-000000000001', 'PROJECT.json', 'google_drive',
            'projects/aaaa1111-0000-0000-0000-000000000001/PROJECT.json', false)$$,
  'a short path is not money-gated — the manifest shape stays accepted');

-- Local Server stores a BARE FILENAME with no segments at all (main.cjs).
SELECT lives_ok(
  $$INSERT INTO public.files (id, project_id, name, storage_provider, storage_path, is_financial)
    VALUES ('aaaa1111-0000-0000-0000-0000000060b4',
            'aaaa1111-0000-0000-0000-000000000001', 'clip.mov', 'local_server',
            'clip.mov', false)$$,
  'a bare local_server filename is not money-gated — split_part yields no segment');

-- ── 9. 0049 still binds, and already fails closed for a pathless provider ────
-- Cleared while still unauthenticated, so a breaker's stray row is removed
-- without depending on the admin DELETE policy.
SELECT pg_temp.ws_reset();

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','role','authenticated',
  'app_metadata', jsonb_build_object(
    'workspace_id','11111111-1111-1111-1111-111111111111','app_role','admin')
)::text, true);
SELECT set_config('role','authenticated', true);

INSERT INTO public.workspace_storage (workspace_id, mode, provider, root_path, root_kind)
VALUES ('11111111-1111-1111-1111-111111111111', 'byos', 'network', '\\nas\projects\wilson', 'unc');

SELECT lives_ok(
  $$UPDATE public.projects SET folder_root = '\\nas\projects\wilson\Alpha'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'with a network drive configured, 0049 still admits a folder inside it');

-- Clear the path but stay byos/network. This is staging's REAL row today (an
-- admin mid-setup) and it is also the shape every bucket-backed provider will
-- carry, since a bucket has no root_path. 0049 reads root_path, so it refuses
-- — which is the answer to "what is a project folder when the provider is not
-- a filesystem": there isn't one, and the sentence says what to do.
UPDATE public.workspace_storage
   SET root_path = NULL, root_kind = NULL
 WHERE workspace_id = '11111111-1111-1111-1111-111111111111';

SELECT throws_ok(
  $$UPDATE public.projects SET folder_root = '\\nas\projects\wilson\Beta'
     WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  'no workspace storage drive is configured — an admin sets the drive first (Admin Terminal, Storage)',
  'a pathless provider refuses a project folder, naming what to do');

SELECT is(
  (SELECT folder_root FROM public.projects
    WHERE id = 'aaaa1111-0000-0000-0000-000000000001'),
  '\\nas\projects\wilson\Alpha',
  'and the refused write changed nothing');

SELECT * FROM finish();

ROLLBACK;
