-- =============================================================================
-- 0051_s3_storage_provider.sql — Session 37 (S3-compatible storage, the first
-- BYO provider)
--
-- WHY THIS EXISTS
-- ---------------
-- §4a2/§4a2b of NETWORK_STORAGE_DESIGN.md: a customer with no office server
-- brings their own bucket — AWS S3, Backblaze B2, Wasabi, Hetzner, Cloudflare
-- R2 or MinIO, all one API. S36 (0050) built the registry this plugs into;
-- this migration widens the provider vocabulary to 's3' ALONGSIDE the adapter
-- that can resolve it (the §12.1a rule: never ahead of it — suite 60 asserted
-- 's3' was REFUSED until this exact commit, and that probe is inverted in the
-- same commit as the tripwire it was designed to be).
--
-- WHAT THIS ADDS
--   1. 's3' in the files.storage_provider ENUM (where THIS body is).
--   2. 's3' in workspace_storage_provider_chk (what the workspace CHOSE) —
--      by EXPLICIT DROP + re-ADD, see the replay note below.
--   3. workspace_storage_s3_config_chk — the REQUIRED-direction arm 0050's
--      header demanded ("permits is not requires"): an s3 row must carry a
--      well-formed config, or it is "looks configured, resolves nowhere".
--   4. public.workspace_storage_secrets — the bucket secret, AES-256-GCM
--      ciphertext on the 0028 workspace_ai_keys precedent. Service-role only.
--   5. can_presign_project_write / can_presign_project_read — the presign
--      Edge Function's authorisation predicates, SECURITY INVOKER so the
--      caller's own RLS answers, not a service-role paraphrase of it.
--   6. storage_gc_queue.provider + a widened enqueue trigger, so an s3 body
--      whose row is purged is enqueued for certified disposal like a
--      Supabase one (lifecycle parity — the brief's §4).
--
-- 🚨 THE ENUM AND THE CHECK ARE TWO VOCABULARIES (S36 outcome, correction 3).
-- files.storage_provider (a named enum, 0000) records where a BODY is;
-- workspace_storage.provider (TEXT + CHECK) records what the workspace CHOSE.
-- They cannot merge: a financial file is 'supabase' whatever was chosen.
-- ALTER TYPE ... ADD VALUE runs fine inside this transaction but the new
-- value CANNOT BE USED in it — nothing below writes or casts 's3' as an enum
-- value; the trigger WHEN below compares ::text against TEXT literals for
-- exactly that reason.
--
-- 🚨 REPLAY NOTE — the widening is an EXPLICIT DROP + ADD, not a wrapped ADD.
-- Every ADD CONSTRAINT in this repo is wrapped in `EXCEPTION WHEN
-- duplicate_object` for idempotency, and S36 measured the consequence: against
-- a database where the constraint already exists, a wrapped ADD is a SILENT
-- NO-OP. A wrapped widening would leave the two-value CHECK in place on every
-- already-migrated environment and this migration would "apply" while changing
-- nothing. DROP IF EXISTS + ADD is idempotent AND actually lands. (A later
-- replay of 0050 cannot narrow it back: 0050's own ADD is wrapped, so it
-- no-ops against this constraint's name.)
--
-- 🚨 CONSTRAINT NAMES ARE LOAD-BEARING (S36, measured): Postgres reports the
-- ALPHABETICALLY FIRST violated CHECK and throws_ok matches SQLERRM exactly.
-- 'workspace_storage_s3_config_chk' sorts AFTER every existing
-- workspace_storage constraint (kind < mode < provider < root < s3), so it
-- steals no suite's message. Where a row violates both the config-shape rule
-- (workspace_storage_provider_config_chk, `p` < `s`) and this arm, the 0050
-- name is reported — suite 61's probes are built to violate exactly one.
--
-- THE CONFIG SHAPE (ONE JSONB, per §4a2b — never flat per-provider columns):
--   { endpoint?, region, bucket, prefix?, accessKeyId, forcePathStyle? }
--   * endpoint  — what makes it six providers, not one. Absent = AWS.
--                 https:// only (pre-release content; TPN wants transit
--                 encryption), no trailing slash (canonical form).
--   * region    — SigV4 needs one everywhere ('auto' for R2, 'us-east-1'
--                 for MinIO installs that never set one).
--   * bucket    — required. No slashes, no whitespace.
--   * prefix    — the tenant's chosen root INSIDE the bucket, the analogue
--                 of 0048's root_path. Same discipline as
--                 workspace_storage_root_canon_chk: no leading or trailing
--                 slash, no doubled slash, no backslash, no dot segments.
--                 §3.2's measured trailing-separator breakage applies to a
--                 key prefix verbatim.
--   * accessKeyId — NOT secret (it is the username half); the secret half
--                 lives ONLY in workspace_storage_secrets, never in this
--                 JSONB, which every workspace member can read.
--   * forcePathStyle — MinIO and some self-hosted gateways need path-style
--                 addressing; getting it wrong presents as DNS failure,
--                 which reads as "the bucket does not exist". In the config
--                 so the error can say so.
--   The key allowlist is enforced (config minus the six known keys must be
--   empty): a typo'd key is refused at write time, not discovered as a
--   silently-ignored setting during an incident.
--
-- 🚨 storage_path FOR AN s3 BODY EXCLUDES THE PREFIX — this is load-bearing,
-- not a style choice. files.storage_path stays the row-shaped key
-- (projects/<id>/<entity>/<entityId>/<ts>-<name>) for every provider; the
-- workspace's prefix is prepended at RESOLUTION (by the presign function),
-- never stored. Two reasons, either sufficient:
--   * files_money_provider_chk reads split_part(storage_path, '/', 3). A
--     stored prefix would SHIFT the third segment and blind the path axis of
--     the money gate for every prefixed workspace — the constraint cannot
--     know the tenant's prefix.
--   * a workspace that later edits its prefix would orphan every stored key;
--     prefix belongs with bucket/endpoint in the CONNECTION config, and a
--     connection change orphaning bodies is already the stated NAS-root rule.
--
-- WHY THE SECRET IS NOT IN provider_config: provider_config rides
-- fetchWorkspaceStorage's select into every signed-in client. The 0028 rule
-- (locked #8 applied to tenant credentials) is that no client ever reads a
-- credential back — ciphertext included. Separate table, RLS on, FORCEd,
-- zero policies, privileges revoked: service_role only, exactly
-- workspace_ai_keys. The Edge secret is WILSON_STORAGE_KEY_SECRET — its OWN
-- master key, not WILSON_AI_KEY_SECRET, so rotating one credential domain
-- cannot orphan the other's ciphertext.
--
-- Idempotent: safe to re-run.
-- ORDERING: depends on 0050 (provider/provider_config), 0048
-- (workspace_storage), 0027 (storage_gc_queue + enqueue trigger), 0013
-- (can_write_project + helpers), 0008 (has_active_membership), 0001
-- (current_workspace_id), 0000 (storage_provider enum).
-- pgTAP: 61_workspace_storage_s3.sql + 62_workspace_storage_secrets.sql
-- (new); 60's "s3 is refused" probe inverted in this same commit.
-- =============================================================================

-- ── 1. The enum gains the body location ──────────────────────────────────────
-- Where an S3 body IS, on the file row (resolve-from-the-row, S36). Appended,
-- IF NOT EXISTS, and deliberately NOT USED anywhere else in this migration —
-- see the header. google_drive has sat unused in this enum since 0000; 's3'
-- gains its writer (supabaseAdapter.uploadFile via fileProviderFor) in this
-- same commit.
ALTER TYPE public.storage_provider ADD VALUE IF NOT EXISTS 's3';

-- ── 2. The workspace vocabulary widens ───────────────────────────────────────
ALTER TABLE public.workspace_storage
  DROP CONSTRAINT IF EXISTS workspace_storage_provider_chk;
ALTER TABLE public.workspace_storage
  ADD CONSTRAINT workspace_storage_provider_chk
  CHECK (provider IN ('petal', 'network', 's3'));

-- ── 3. The required-direction arm ────────────────────────────────────────────
DO $c$
BEGIN
  -- 0050's provider_config CHECK PERMITS an s3 config; this arm REQUIRES one,
  -- well-formed. Wrapped ADD is safe here: the constraint is new, and a
  -- replay's no-op leaves this same text in place.
  BEGIN
    ALTER TABLE public.workspace_storage
      ADD CONSTRAINT workspace_storage_s3_config_chk
      CHECK (
        provider <> 's3'
        OR (
          provider_config IS NOT NULL
          AND provider_config ?& ARRAY['bucket', 'region', 'accessKeyId']
          -- Key allowlist: nothing but the six known keys. jsonb minus the
          -- allowlist must leave the empty object.
          AND (provider_config - ARRAY['endpoint', 'region', 'bucket', 'prefix',
                                       'accessKeyId', 'forcePathStyle']::text[])
              = '{}'::jsonb
          AND jsonb_typeof(provider_config->'bucket') = 'string'
          AND (provider_config->>'bucket') <> ''
          AND (provider_config->>'bucket') = btrim(provider_config->>'bucket')
          AND (provider_config->>'bucket') !~ '[\\/[:space:]]'
          AND jsonb_typeof(provider_config->'region') = 'string'
          AND (provider_config->>'region') <> ''
          AND (provider_config->>'region') !~ '[\\/[:space:]]'
          AND jsonb_typeof(provider_config->'accessKeyId') = 'string'
          AND (provider_config->>'accessKeyId') <> ''
          AND (provider_config->>'accessKeyId') = btrim(provider_config->>'accessKeyId')
          AND (NOT provider_config ? 'endpoint'
               OR (jsonb_typeof(provider_config->'endpoint') = 'string'
                   AND (provider_config->>'endpoint') ~ '^https://[^[:space:]]+$'
                   AND (provider_config->>'endpoint') !~ '/$'))
          AND (NOT provider_config ? 'forcePathStyle'
               OR jsonb_typeof(provider_config->'forcePathStyle') = 'boolean')
          AND (NOT provider_config ? 'prefix'
               OR (jsonb_typeof(provider_config->'prefix') = 'string'
                   AND (provider_config->>'prefix') <> ''
                   AND (provider_config->>'prefix') = btrim(provider_config->>'prefix')
                   AND (provider_config->>'prefix') !~ '[\\]'
                   AND (provider_config->>'prefix') !~ '^/'
                   AND (provider_config->>'prefix') !~ '/$'
                   AND (provider_config->>'prefix') !~ '//'
                   AND (provider_config->>'prefix') !~ '(^|/)\.{1,2}(/|$)'))
        )
      );
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END
$c$;

COMMENT ON CONSTRAINT workspace_storage_s3_config_chk ON public.workspace_storage IS
  'Session 37: the required-direction arm 0050''s header demanded. provider=''s3'' must carry a well-formed provider_config — required keys present (bucket/region/accessKeyId), no unknown keys, endpoint https and canonical, prefix in the same canonical form 0048 enforces for root_path (no leading/trailing/doubled separators, no dot segments, no backslash). The secret is NOT here — workspace_storage_secrets holds it, service-role only.';

-- ── 4. The bucket secret, on the 0028 precedent ──────────────────────────────
-- base64(iv[12] ‖ ciphertext ‖ tag[16]) from _shared/storageSecretCrypto.ts
-- (the storage-shaped twin of aiKeyCrypto.ts; master key
-- WILSON_STORAGE_KEY_SECRET, an Edge-Function secret, never in Postgres).
-- Written by storage-secret (workspace admin, adminGuard), read by
-- storage-presign and storage-gc. No client ever reads it back; the console
-- sees key_hint only.
CREATE TABLE IF NOT EXISTS public.workspace_storage_secrets (
  workspace_id       UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- A bucket secret key is ≤ ~64 chars for every supported provider; 4096 is
  -- the 0028 sanity cap, not a format check.
  secret_ciphertext  TEXT NOT NULL CHECK (char_length(secret_ciphertext) BETWEEN 16 AND 4096),
  -- Last 4 characters of the plaintext secret — the ONLY part any client
  -- ever sees ("…9f2c" beside the Test button).
  key_hint           TEXT NOT NULL CHECK (char_length(key_hint) BETWEEN 1 AND 12),
  key_version        SMALLINT NOT NULL DEFAULT 1 CHECK (key_version > 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         UUID
);

-- Service-role only: RLS on + FORCEd with ZERO policies denies every client
-- role; privileges are revoked as the belt. The 0028 shape exactly — a
-- post-condition below fails this migration if a policy ever appears here.
ALTER TABLE public.workspace_storage_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_storage_secrets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_storage_secrets FROM anon, authenticated;

COMMENT ON TABLE public.workspace_storage_secrets IS
  'Session 37: per-workspace S3-compatible bucket secret, AES-256-GCM ciphertext (0028 workspace_ai_keys precedent). Master key = WILSON_STORAGE_KEY_SECRET Edge secret, never in Postgres — a pg_dump carries ciphertext the archive cannot open. Service-role only: RLS forced, zero policies, privileges revoked. Clients see key_hint only, via the storage-secret Edge Function.';

-- ── 5. The presign predicates ────────────────────────────────────────────────
-- The storage-presign Edge Function is an AUTHORISATION BOUNDARY, not a
-- formality (the brief's §2): minting a URL for a key the caller may not
-- touch would make it a signing oracle for any authenticated user.
--
-- These are SECURITY INVOKER on purpose, called over PostgREST WITH THE
-- CALLER'S OWN JWT (the Edge Function forwards it): auth.uid(),
-- current_workspace_id() and projects-row visibility all evaluate as the
-- real caller under real RLS. That is the S33 rule satisfied by
-- construction — the policy is EVALUATED, not replicated, so an arm added
-- to can_write_project later is picked up here for free.
--
-- The write predicate is files_insert's own arm list (0038), minus the
-- financial arm — the presign function refuses money-segment keys wholesale
-- before ever asking (money never leaves Supabase, so there is no money
-- presign to authorise).
--
-- COALESCE(…, false): the subquery yields NULL for a project the caller
-- cannot see (RLS hides the row), and NULL fails OPEN in an IF (S33's
-- measured lesson) — the Edge Function tests `=== true`, and this COALESCE
-- keeps the SQL side airtight for any other caller too.

CREATE OR REPLACE FUNCTION public.can_presign_project_write(p_project UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT p.workspace_id = public.current_workspace_id()
       AND public.has_active_membership(p.workspace_id)
       AND public.can_write_project(p.id)
      FROM public.projects p
     WHERE p.id = p_project
       AND p.deleted_at IS NULL
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.can_presign_project_read(p_project UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT p.workspace_id = public.current_workspace_id()
       AND public.has_active_membership(p.workspace_id)
      FROM public.projects p
     WHERE p.id = p_project
       AND p.deleted_at IS NULL
  ), false);
$$;

REVOKE EXECUTE ON FUNCTION public.can_presign_project_write(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_presign_project_read(UUID)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_presign_project_write(UUID) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.can_presign_project_read(UUID)  TO authenticated, service_role;

COMMENT ON FUNCTION public.can_presign_project_write(UUID) IS
  'Session 37: the storage-presign Edge Function''s write gate, called over PostgREST with the CALLER''S JWT. SECURITY INVOKER so projects visibility, current_workspace_id() and can_write_project() all evaluate as the real caller — the files_insert policy''s arms evaluated, not replicated (S33). COALESCE keeps an invisible project a refusal, never a NULL.';
COMMENT ON FUNCTION public.can_presign_project_read(UUID) IS
  'Session 37: the storage-presign Edge Function''s read gate — workspace match + active membership + RLS-visible live project, i.e. files_select''s project-visibility arm evaluated as the caller. Money-segment keys are refused by the function before this is ever asked.';

-- ── 6. Certified disposal for s3 bodies (lifecycle parity) ───────────────────
-- 0027's enqueue trigger fired only for storage_provider='supabase', so an s3
-- body whose row is purged would leak at the provider with no ledger entry.
-- The queue row now records WHICH provider holds the body; storage-gc drains
-- s3 rows by signed DELETE against the workspace's configured bucket.
ALTER TABLE public.storage_gc_queue
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'supabase';

DO $q$
BEGIN
  BEGIN
    ALTER TABLE public.storage_gc_queue
      ADD CONSTRAINT storage_gc_queue_provider_chk
      CHECK (provider IN ('supabase', 's3'));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END
$q$;

-- bucket_id for an s3 row is the MARKER 'byo-s3', not a bucket name: the real
-- bucket lives in the workspace's provider_config AT DRAIN TIME (a workspace
-- that renames its bucket between purge and drain should hit the new bucket,
-- and the trigger cannot see provider_config anyway).
-- ::text comparisons throughout — the enum value 's3' was added in THIS
-- transaction and cannot be referenced as an enum literal here (see header).
CREATE OR REPLACE FUNCTION public.fn_files_gc_enqueue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.storage_gc_queue (bucket_id, object_path, workspace_id, file_id, reason, provider)
  VALUES (
    CASE WHEN OLD.storage_provider::text = 's3' THEN 'byo-s3' ELSE 'rabbit-files' END,
    OLD.storage_path, OLD.workspace_id, OLD.id, 'file-purged',
    OLD.storage_provider::text
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- A failed enqueue orphans one blob; the Edge Function's orphan scan is
  -- the backstop for blobs whose PROJECT still resolves to a workspace.
  -- (Supabase bodies only — a customer bucket is never scanned; see §12.4.)
  RAISE WARNING 'storage_gc enqueue failed for file %: %', OLD.id, SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_files_gc_enqueue() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_files_gc_enqueue ON public.files;
CREATE TRIGGER trg_files_gc_enqueue
  AFTER DELETE ON public.files
  FOR EACH ROW
  WHEN (OLD.storage_provider::text IN ('supabase', 's3'))
  EXECUTE FUNCTION public.fn_files_gc_enqueue();

-- ── 7. Post-conditions ───────────────────────────────────────────────────────
DO $post$
DECLARE
  v_count INT;
  v_def   TEXT;
BEGIN
  -- 1. The enum carries 's3' (catalog read — not a USE of the value).
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'storage_provider' AND e.enumlabel = 's3'
  ) THEN
    RAISE EXCEPTION '0051 post-condition failed: storage_provider enum lacks ''s3''';
  END IF;

  -- 2. The widened vocabulary actually LANDED (the replay-note failure mode:
  -- a wrapped ADD would leave the two-value CHECK and this catches it).
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.workspace_storage'::regclass
     AND contype = 'c' AND conname = 'workspace_storage_provider_chk';
  IF v_def IS NULL OR v_def NOT LIKE '%''s3''%' THEN
    RAISE EXCEPTION '0051 post-condition failed: workspace_storage_provider_chk was not widened to ''s3'' (got: %)', COALESCE(v_def, '<missing>');
  END IF;

  -- 3. The required-direction arm exists.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.workspace_storage'::regclass
       AND contype = 'c' AND conname = 'workspace_storage_s3_config_chk'
  ) THEN
    RAISE EXCEPTION '0051 post-condition failed: workspace_storage_s3_config_chk is missing';
  END IF;

  -- 4. 0050's other three constraints and the money pin survive, and 0048's
  -- five path CHECKs are intact — additive by contract, again.
  SELECT count(*) INTO v_count FROM pg_constraint
   WHERE conrelid = 'public.workspace_storage'::regclass AND contype = 'c'
     AND conname IN ('workspace_storage_mode_provider_chk',
                     'workspace_storage_root_provider_path_chk',
                     'workspace_storage_provider_config_chk');
  IF v_count <> 3 THEN
    RAISE EXCEPTION '0051 post-condition failed: expected 0050''s three sibling constraints intact, found %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM pg_constraint
   WHERE conrelid = 'public.workspace_storage'::regclass AND contype = 'c'
     AND conname IN ('workspace_storage_mode_chk',
                     'workspace_storage_kind_chk',
                     'workspace_storage_root_pair_chk',
                     'workspace_storage_root_canon_chk',
                     'workspace_storage_kind_shape_chk');
  IF v_count <> 5 THEN
    RAISE EXCEPTION '0051 post-condition failed: expected 0048''s five path CHECKs intact, found %', v_count;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.files'::regclass
       AND contype = 'c' AND conname = 'files_money_provider_chk'
  ) THEN
    RAISE EXCEPTION '0051 post-condition failed: files_money_provider_chk is missing';
  END IF;

  -- 5. The secrets table is service-role only: RLS on, FORCEd, ZERO policies
  -- (the 0028 shape — a policy here is a client read path and fails the
  -- migration), and no client privileges.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.workspace_storage_secrets'::regclass
       AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION '0051 post-condition failed: workspace_storage_secrets RLS must be enabled AND forced';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'workspace_storage_secrets'
  ) THEN
    RAISE EXCEPTION '0051 post-condition failed: workspace_storage_secrets must have no client policies';
  END IF;
  IF has_table_privilege('authenticated', 'public.workspace_storage_secrets', 'SELECT')
     OR has_table_privilege('anon', 'public.workspace_storage_secrets', 'SELECT') THEN
    RAISE EXCEPTION '0051 post-condition failed: workspace_storage_secrets is readable by a client role';
  END IF;

  -- 6. The presign predicates exist, are callable by authenticated, and are
  -- NOT callable by anon.
  IF NOT has_function_privilege('authenticated', 'public.can_presign_project_write(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.can_presign_project_read(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0051 post-condition failed: presign predicates are not callable by authenticated';
  END IF;
  IF has_function_privilege('anon', 'public.can_presign_project_write(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.can_presign_project_read(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0051 post-condition failed: presign predicates are callable by anon';
  END IF;

  -- 7. The queue gained its provider column and the trigger was widened.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'storage_gc_queue'
       AND column_name = 'provider' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION '0051 post-condition failed: storage_gc_queue.provider missing or nullable';
  END IF;
  SELECT pg_get_triggerdef(oid) INTO v_def FROM pg_trigger
   WHERE tgrelid = 'public.files'::regclass AND tgname = 'trg_files_gc_enqueue';
  IF v_def IS NULL OR v_def NOT LIKE '%s3%' THEN
    RAISE EXCEPTION '0051 post-condition failed: trg_files_gc_enqueue was not widened to s3 (got: %)', COALESCE(v_def, '<missing>');
  END IF;

  -- 8. Live-data sanity, scoped to the real table: no s3 row without its
  -- config can exist (the constraint refuses it; this reports if one
  -- predated the constraint somehow).
  SELECT count(*) INTO v_count FROM public.workspace_storage
   WHERE provider = 's3' AND provider_config IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION '0051 post-condition failed: % s3 row(s) carry no provider_config', v_count;
  END IF;
END
$post$;
