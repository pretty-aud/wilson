-- =============================================================================
-- 0050_storage_provider_registry.sql — Session 36 (the registry, no provider)
--
-- WHY THIS EXISTS
-- ---------------
-- Audrey, 2026-08-07 (NETWORK_STORAGE_DESIGN.md §4a2b), verbatim:
--   "So remember its bring your own storage solution … nas, gdrive, AWS s3
--    buckets, etc are all going to be options if we add the gdrive solution
--    dont remove other options"
--
-- Bring-your-own-storage is a FAMILY. S34 (0048) shipped its first member —
-- a filesystem root on the customer's NAS — but encoded it as though byos
-- MEANT a filesystem path: root_path + root_kind ∈ ('unc','local'). This
-- migration adds the axis that was missing, so the second member is a value
-- and not a fork.
--
-- 🚨 THE HOLE THIS CLOSES, and it is the whole reason the session exists.
-- A row for a bucket-backed workspace carries root_path AND root_kind NULL,
-- and every one of 0048's five CHECKs is SATISFIED by that row: three are
-- guarded by `root_path IS NULL OR …` / `root_kind IS NULL OR …`
-- (root_canon, kind_shape, kind), root_pair reduces to `true = true`, and
-- mode_chk only ever looks at `mode`. So all five PASS while nothing
-- whatsoever validates the config. Widening root_kind to 'gdrive' would have
-- been `false = false` — a workspace that reads as configured and resolves
-- nowhere. The converse rule is what was absent: a provider that is NOT a
-- filesystem must not carry a path at all.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
-- ----------------------------------
-- It adds NO provider. `provider` is CHECKed against exactly the two that
-- exist today — 'petal' (Supabase, mode central) and 'network' (the S34
-- NAS/server root, mode byos). 's3' arrives in S37 and 'gdrive' in S38, each
-- widening this CHECK in its own migration ALONGSIDE the adapter that can
-- actually resolve it. Listing them here would ship exactly the "looks
-- configured, resolves nowhere" state described above, and would break the
-- house rule from S25: add a reveal-flag WITH the thing it reveals, never
-- before.
--
-- 🚨 ADDITIVE BY CONTRACT: 0048's FIVE CHECKS ARE NOT TOUCHED.
-- The brief proposed making them "conditional on provider = 'network'".
-- Measured, that is unnecessary and strictly worse: each one is already
-- `root_path IS NULL OR …`, so each is already inert for a pathless provider
-- and fully binding for a network one. Rewriting them could only weaken
-- them. They are left byte-for-byte as S34 wrote them, which is a stronger
-- proof that the NAS path is unchanged than any test could be, and suite 60
-- re-runs S34's four refusal shapes against provider='network' anyway.
--
-- 🚨 CONSTRAINT NAMES ARE LOAD-BEARING — MEASURED ON DEV, 2026-08-07.
-- When a row violates several CHECKs at once, Postgres reports the one whose
-- name sorts FIRST ALPHABETICALLY, not the one declared first. (Probed with a
-- temp table carrying zz_declared_first_chk and aa_declared_second_chk over
-- the same predicate: the aa_ one is reported.) pgTAP throws_ok matches
-- SQLERRM EXACTLY, so a carelessly-named new constraint silently steals an
-- existing suite's expected message and the failure reads as unrelated.
-- Hence `workspace_storage_root_provider_path_chk` rather than
-- `..._provider_path_chk`: the `root_` prefix sorts it AFTER root_canon_chk
-- and root_pair_chk, so suite 58's four throws_ok probes keep reporting the
-- constraints they always did. Suite 58's fixtures still gain an explicit
-- provider (see that file) because a NAS fixture should SAY it is a NAS —
-- the ordering rule is the belt, the explicit fixture is the braces.
--
-- WHAT THE LIVE DATA SAYS — MEASURED BY QUERY ON ALL THREE ENVS, 2026-08-07,
-- and it contradicts the brief, which asserted that existing byos rows carry
-- a real filesystem root:
--        env      workspaces  ws_storage rows  byos  central  with root_path
--        dev           4            0            0      0          0
--        staging       1            1            1      0          0   ← !
--        prod          0            0            0      0          0
-- The ENTIRE live corpus is ONE row: staging, mode 'byos', root_path NULL,
-- root_kind NULL — an admin who chose "our own server" and has not yet said
-- which folder. So "byos rows carry a real root, therefore they are network"
-- is false. The backfill below is still `byos → network`, but for the reason
-- that actually holds: at the moment this migration runs, 'network' is the
-- ONLY byos provider that exists, so it is the only truthful reading of a
-- byos row. No row anywhere is reinterpreted.
--
-- THE TWO AXES STAY SEPARATE:
--   * mode     = which storage is ACTIVE ('central' = Petal cloud, 'byos' =
--                the customer's own). The axis S41 keys billing off, and the
--                axis every consumer already gates on. Untouched.
--   * provider = WHICH customer-side provider is configured ('network'
--                today; 's3' S37, 'gdrive' S38). 'petal' means "none
--                configured".
--
-- 🚨 THE CONSTRAINT BETWEEN THEM IS ONE-DIRECTIONAL, AND THE FIRST DRAFT OF
-- THIS MIGRATION GOT IT WRONG. A biconditional — (mode='central') =
-- (provider='petal') — reads well and is WRONG, because it silently deletes a
-- feature S34 shipped on purpose. 0048's header: "a root, when present,
-- SURVIVES a switch back to 'central' so re-enabling does not mean retyping."
-- The retained root is inert, not active, and two independent layers already
-- enforce that by keying on MODE:
--   * App.jsx's push effect sends rootPath only when `row.mode === 'byos'`,
--     so a retained root is pushed as null and main.cjs never resolves it.
--   * 0049's fn_project_folder_root_guard refuses unless mode is 'byos',
--     regardless of root_path.
-- A biconditional would have forced provider back to 'petal' on that switch,
-- losing the retained provider exactly as losing root_path would lose the
-- retained path — the same retyping problem, one column over. Caught by
-- suite 59's probes 24/25, which are S34's own retained-root test.
-- So the rule is only the direction that is genuinely incoherent:
-- **mode 'byos' requires a real provider**. central + network is LEGAL and
-- means "on Petal cloud now, NAS remembered".
--
-- Idempotent: safe to re-run.
-- ORDERING: depends on 0048 (workspace_storage) and 0042
--   (public.rabbit_money_segment, used by the files constraint below).
--   No replay trap: nothing else creates these constraints, and 0048 uses
--   CREATE TABLE IF NOT EXISTS so a 0048 replay does not drop them.
-- pgTAP: 60_workspace_storage_provider.sql (new); 58 updated for the fixtures.
-- =============================================================================

-- ── 1. The provider axis ─────────────────────────────────────────────────────
-- DEFAULT 'petal' pairs with 0048's DEFAULT 'central' so a bare
-- INSERT (workspace_id) still produces a coherent row, and so suites 58/59's
-- eight existing fixture INSERTs — which name only
-- (workspace_id, mode, root_path, root_kind) — keep working. A NOT NULL with
-- no default would have failed all eight.

ALTER TABLE public.workspace_storage
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'petal';

-- ONE JSONB, never flat per-provider columns (§4a2b). Neither provider that
-- exists today takes any config: 'network' carries its location in root_path,
-- and 'petal' has nothing to configure. The CHECK below is written as the
-- RULE rather than as "must be NULL", so S37 widening the provider CHECK to
-- 's3' automatically permits an s3 config object without editing this
-- constraint — that is what makes adding a provider additive.
ALTER TABLE public.workspace_storage
  ADD COLUMN IF NOT EXISTS provider_config JSONB;

COMMENT ON COLUMN public.workspace_storage.provider IS
  'WHICH customer-side provider is configured: ''network'' (the customer''s own NAS/server filesystem root, S34) or ''petal'' meaning none. A SEPARATE axis from `mode`, which says which storage is ACTIVE — and only one-directionally bound to it (workspace_storage_mode_provider_chk: byos requires a real provider). central + network is the legal, INERT, retained state 0048''s retyping rule depends on: the NAS is remembered, and App.jsx / 0049 both ignore it until byos is re-selected. Adding a provider (S37 s3, S38 gdrive) widens workspace_storage_provider_chk in that provider''s OWN migration, alongside the adapter that can resolve it — never ahead of it.';
COMMENT ON COLUMN public.workspace_storage.provider_config IS
  'The provider''s own settings, as ONE JSONB object — never flat per-provider columns (NETWORK_STORAGE_DESIGN.md §4a2b: that is how the second provider forks the first). NULL for ''petal'' and ''network'', which have nothing to configure beyond root_path. Validated per provider by workspace_storage_provider_config_chk.';

-- ── 2. Backfill, before any constraint that could refuse it ──────────────────
-- Deterministic and derived from the data, not from an assumption about it.
-- 'byos' can only have meant the filesystem root, because it is the only byos
-- provider 0048 could express. A 'central' row with no path keeps the column
-- default ('petal' = none configured). Written as an idempotent UPDATE so a
-- re-run is a no-op rather than an error.
-- (Measured above: this touches exactly one row, on staging.)

-- 🚨 BOTH arms matter, and the second is the retained state. A row on
-- 'central' that still carries a root_path is 0048's retyping rule mid-flight
-- — it has a filesystem provider configured but inactive. Backfilling only on
-- mode would leave it provider='petal' WITH a path, which
-- workspace_storage_root_provider_path_chk then refuses, and the migration
-- would abort on a shape S34 deliberately supports. (Measured 2026-08-07:
-- zero such rows on dev, staging or prod — so this arm is correctness for the
-- next environment, not a fix for this one.)
UPDATE public.workspace_storage
   SET provider = 'network'
 WHERE provider <> 'network'
   AND (mode = 'byos' OR root_path IS NOT NULL);

-- ── 3. The constraints ───────────────────────────────────────────────────────
-- ADD CONSTRAINT has no IF NOT EXISTS, so each is wrapped: a duplicate_object
-- makes a re-run a no-op. (0000's house idempotency shape.)

DO $c$
BEGIN
  -- Only the providers that EXIST. See the header: listing S37/S38's values
  -- here would ship a configurable provider that resolves nowhere.
  BEGIN
    ALTER TABLE public.workspace_storage
      ADD CONSTRAINT workspace_storage_provider_chk
      CHECK (provider IN ('petal', 'network'));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- One direction only — see the header. "We are on our own storage, and the
  -- provider is Petal" is incoherent and is refused. The converse pairing,
  -- central + a real provider, is the RETAINED state 0048 designed for and
  -- must stay legal.
  BEGIN
    ALTER TABLE public.workspace_storage
      ADD CONSTRAINT workspace_storage_mode_provider_chk
      CHECK (mode <> 'byos' OR provider <> 'petal');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- 🚨 THE CONVERSE ARM — the hole named in the header. 0048's five CHECKs
  -- all say "IF there is a path, it must be well-formed"; none says "there
  -- must not BE a path". Without this, a gdrive or s3 row could carry a stray
  -- root_path that resolveConfiguredRootDir() (main.cjs) would read and
  -- happily resolve files against — a filesystem root on a workspace whose
  -- media is in a bucket. Named with the `root_` prefix deliberately: see the
  -- alphabetical-reporting note in the header.
  BEGIN
    ALTER TABLE public.workspace_storage
      ADD CONSTRAINT workspace_storage_root_provider_path_chk
      CHECK (root_path IS NULL OR provider = 'network');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- Per-provider config validation. Written as the general rule so a provider
  -- added later inherits it: petal and network take NO config; any other
  -- provider's config, if present, must be a JSON object (not a bare string,
  -- number or array — jsonb_typeof pins that, and 'null'::jsonb is a JSON
  -- null, which is NOT an object and is therefore refused rather than
  -- mistaken for SQL NULL).
  BEGIN
    ALTER TABLE public.workspace_storage
      ADD CONSTRAINT workspace_storage_provider_config_chk
      CHECK (provider_config IS NULL
             OR (jsonb_typeof(provider_config) = 'object'
                 AND provider NOT IN ('petal', 'network')));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END
$c$;

-- ── 4. 🚨 Money-gated files never leave Supabase ─────────────────────────────
-- §4a2b invariant 2, and the one rule in this family whose failure is silent
-- and expensive. INVOICES/ and FINANCE/ are manager-only because the storage
-- path's third segment says so and POSTGRES enforces it
-- (public.rabbit_money_segment, 0042, via eight storage.objects policies).
-- Drive has opaque ids and its own sharing model; S3 has bucket policies —
-- neither binds to a WILSON project role. A money file in either store is the
-- 0038 hole re-opened somewhere RLS cannot see it.
--
-- The client half of this pin lives at the ONE place that already decides the
-- money path (supabaseAdapter.uploadFile's `scope.financial ? 'INVOICES'`
-- branch), so the row and the segment cannot disagree. This constraint is the
-- other half: a refusal in depth, per the S34 rule, that holds for a devtools
-- caller, a hand-made PostgREST request, or a future adapter that forgets.
--
-- BOTH axes are checked, because either alone is a way in:
--   * is_financial — the ROW gate (0038's files_select money arm).
--   * the path's third segment — the BLOB gate (0042's eight policies), and
--     the stronger of the two, since it is what governs the bytes. This is
--     the S35 lesson applied: guard whatever OUTRANKS your field.
-- rabbit_money_segment is IMMUTABLE (0042) and so is legal in a CHECK;
-- calling it rather than re-listing INVOICES/FINANCE keeps 0042's "ONE
-- definition" property — a third reserved segment stays a one-line change.
--
-- ⚠️ split_part HERE IS NOT THE SAME EXTRACTOR AS THE POLICIES' foldername,
-- and the difference is worth writing down because it is easy to get backwards.
-- 0042's eight storage.objects policies read `(storage.foldername(name))[3]`,
-- which drops the FILENAME — so it is NULL for a three-field path. split_part
-- keeps it, so for `projects/<id>/PROJECT.json` it returns 'PROJECT.json'
-- (NOT '', as an earlier draft of this comment claimed). The manifest is
-- unaffected either way, but for the real reason:
-- rabbit_money_segment('PROJECT.json') is FALSE. The two extractors agree for
-- every four-field-or-longer path, which is every uploaded file
-- (projects/<id>/<entity>/<entityId>/<name>); they diverge only at depth
-- three, where THIS CHECK IS THE STRICTER of the two — it would refuse a file
-- literally named INVOICES sitting at projects/<id>/INVOICES, which the
-- policies would treat as ungated. Stricter is the safe direction for a
-- money rule, and it is deliberate. A bare local_server filename has one
-- field, so split_part returns '' and rabbit_money_segment('') is false.
--
-- Safe to add against live data: files holds ZERO rows on dev, staging AND
-- prod (measured by query, 2026-08-07), and every writer in the repo already
-- resolves to 'supabase' — `uploadFile`'s storage_provider assignment (now via
-- fileProviderFor, which returns 'supabase' for the PETAL workspace provider)
-- and runMigration.js's literal. Cited by SYMBOL, not line: this very change
-- moved uploadFile's assignment.

DO $m$
BEGIN
  BEGIN
    ALTER TABLE public.files
      ADD CONSTRAINT files_money_provider_chk
      CHECK (
        storage_provider = 'supabase'
        OR NOT (
          COALESCE(is_financial, false)
          OR public.rabbit_money_segment(split_part(storage_path, '/', 3))
        )
      );
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END
$m$;

COMMENT ON CONSTRAINT files_money_provider_chk ON public.files IS
  'Session 36 (NETWORK_STORAGE_DESIGN.md §4a2b invariant 2): a money-gated file body NEVER leaves Supabase, whatever storage provider the workspace selected. Money-ness is read on BOTH axes — the is_financial row flag (0038) and the reserved third path segment (0042, public.rabbit_money_segment) — because either alone is a way in. Only RLS enforces the money gate, and no Drive or S3 sharing model binds to a WILSON project role.';

-- ── 5. Post-conditions ───────────────────────────────────────────────────────
-- The only check in this change that runs against dev, staging AND prod.

DO $post$
DECLARE
  v_count INT;
  v_bad   INT;
BEGIN
  -- The two columns exist and provider is NOT NULL with a default.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='workspace_storage'
       AND column_name='provider' AND is_nullable='NO'
  ) THEN
    RAISE EXCEPTION '0050 post-condition failed: workspace_storage.provider missing or nullable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='workspace_storage'
       AND column_name='provider_config' AND data_type='jsonb'
  ) THEN
    RAISE EXCEPTION '0050 post-condition failed: workspace_storage.provider_config missing or not jsonb';
  END IF;

  -- All four new constraints landed. Counted over an EXACT name list, so an
  -- unrelated constraint added later cannot stand in for a missing one.
  SELECT count(*) INTO v_count FROM pg_constraint
   WHERE conrelid='public.workspace_storage'::regclass AND contype='c'
     AND conname IN ('workspace_storage_provider_chk',
                     'workspace_storage_mode_provider_chk',
                     'workspace_storage_root_provider_path_chk',
                     'workspace_storage_provider_config_chk');
  IF v_count <> 4 THEN
    RAISE EXCEPTION '0050 post-condition failed: expected 4 provider constraints, found %', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.files'::regclass
       AND contype='c' AND conname='files_money_provider_chk'
  ) THEN
    RAISE EXCEPTION '0050 post-condition failed: files_money_provider_chk is missing';
  END IF;

  -- 🚨 0048's five CHECKs must still be there, unmodified in NUMBER at least.
  -- This session's contract is that the NAS path is untouched; a future
  -- session that "simplifies" one of them away should fail here.
  SELECT count(*) INTO v_count FROM pg_constraint
   WHERE conrelid='public.workspace_storage'::regclass AND contype='c'
     AND conname IN ('workspace_storage_mode_chk',
                     'workspace_storage_kind_chk',
                     'workspace_storage_root_pair_chk',
                     'workspace_storage_root_canon_chk',
                     'workspace_storage_kind_shape_chk');
  IF v_count <> 5 THEN
    RAISE EXCEPTION '0050 post-condition failed: expected 0048''s five path CHECKs intact, found %', v_count;
  END IF;

  -- The backfill left nothing incoherent. Scoped to the real table, so it
  -- reports on live rows rather than passing vacuously.
  SELECT count(*) INTO v_bad FROM public.workspace_storage
   WHERE mode = 'byos' AND provider = 'petal';
  IF v_bad > 0 THEN
    RAISE EXCEPTION '0050 post-condition failed: % byos row(s) still have no real provider', v_bad;
  END IF;

  SELECT count(*) INTO v_bad FROM public.workspace_storage
   WHERE root_path IS NOT NULL AND provider <> 'network';
  IF v_bad > 0 THEN
    RAISE EXCEPTION '0050 post-condition failed: % row(s) carry a path under a non-filesystem provider', v_bad;
  END IF;
END
$post$;
