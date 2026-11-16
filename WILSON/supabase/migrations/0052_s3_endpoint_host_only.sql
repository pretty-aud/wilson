-- =============================================================================
-- 0052_s3_endpoint_host_only.sql — Session 37, from its own adversarial review
--
-- WHY THIS EXISTS
-- ---------------
-- 0051's endpoint arm accepted `^https://[^[:space:]]+$` with no trailing
-- slash, which admits an endpoint carrying a PATH — the shape every
-- reverse-proxied MinIO deployment uses:
--
--     https://storage.example.com/minio
--
-- `s3HostAndPath()` builds the URL path itself (`/{bucket}/{key}` or
-- `/{key}`), so anything in the endpoint's own path is SILENTLY DISCARDED.
-- Every presigned URL would be minted against the wrong origin path, with a
-- SigV4 signature computed over a canonical URI the gateway never sees. The
-- admin gets a row that says "configured" and a store that resolves nowhere
-- — which is precisely the failure §4a2b and 0050's required-direction arm
-- exist to prevent, arriving through the one field nobody thought to bound.
--
-- Worse, the failure LIES about its cause: it surfaces as a 404 naming the
-- bucket, sending the admin to check the one field that was right.
--
-- Refused rather than supported, deliberately. Carrying a mount point into
-- the canonical request is real signing work with no measured customer
-- asking for it; a sentence that says "host only" costs nothing and can be
-- widened later if a real deployment needs it. The refusal is now in all
-- three layers, which is the S34 rule: the CHECK here, `s3HostAndPath()` in
-- the signer, and `validateS3Draft()` beside the field.
--
-- 🚨 REPLACED BY DROP + ADD, NOT A WRAPPED ADD. 0051's constraint already
-- exists on dev, and every `ADD CONSTRAINT` in this repo is wrapped in
-- `EXCEPTION WHEN duplicate_object` — so a wrapped re-ADD would be a SILENT
-- NO-OP and this migration would "apply" while changing nothing (measured,
-- S36). The predicate below is 0051's, verbatim, plus one arm.
--
-- NOT VALID is deliberately NOT used: the entire live corpus of
-- workspace_storage is one row with no s3 config (measured 2026-08-07), so
-- validation is free and a validated constraint is the honest state.
--
-- Idempotent: safe to re-run (DROP IF EXISTS + ADD).
-- ORDERING: depends on 0051.
-- pgTAP: 61_workspace_storage_s3.sql (probe added).
-- =============================================================================

ALTER TABLE public.workspace_storage
  DROP CONSTRAINT IF EXISTS workspace_storage_s3_config_chk;

ALTER TABLE public.workspace_storage
  ADD CONSTRAINT workspace_storage_s3_config_chk
  CHECK (
    provider <> 's3'
    OR (
      provider_config IS NOT NULL
      AND provider_config ?& ARRAY['bucket', 'region', 'accessKeyId']
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
               AND (provider_config->>'endpoint') !~ '/$'
               -- 🚨 THE ARM THIS MIGRATION ADDS: host only. Nothing may follow
               -- the authority — no path, no query, no fragment. `s3HostAndPath`
               -- would drop it and sign the wrong URI.
               AND (provider_config->>'endpoint') !~ '^https://[^/?#]+[/?#]'))
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

COMMENT ON CONSTRAINT workspace_storage_s3_config_chk ON public.workspace_storage IS
  'Session 37: the required-direction arm 0050''s header demanded, tightened by S37''s own adversarial review. provider=''s3'' must carry a well-formed provider_config — required keys present (bucket/region/accessKeyId), no unknown keys, prefix in the canonical form 0048 enforces for root_path, and an endpoint that is HTTPS and HOST-ONLY: s3HostAndPath() builds the URL path itself, so a path/query/fragment in the endpoint would be silently dropped and every presigned URL signed against the wrong canonical URI. The secret is NOT here — workspace_storage_secrets holds it, service-role only.';

-- ── Post-conditions ─────────────────────────────────────────────────────────
DO $post$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.workspace_storage'::regclass
     AND contype = 'c' AND conname = 'workspace_storage_s3_config_chk';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '0052 post-condition failed: workspace_storage_s3_config_chk is missing';
  END IF;
  -- The new arm actually LANDED (the wrapped-ADD no-op failure mode).
  IF v_def NOT LIKE '%[/?#]%' THEN
    RAISE EXCEPTION '0052 post-condition failed: the host-only endpoint arm is absent — did a wrapped ADD no-op? (got: %)', v_def;
  END IF;
  -- And 0051's own arms survived the replacement.
  IF v_def NOT LIKE '%accessKeyId%' OR v_def NOT LIKE '%forcePathStyle%' THEN
    RAISE EXCEPTION '0052 post-condition failed: the replacement lost one of 0051''s arms (got: %)', v_def;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.workspace_storage
     WHERE provider = 's3'
       AND provider_config ? 'endpoint'
       AND (provider_config->>'endpoint') ~ '^https://[^/?#]+[/?#]'
  ) THEN
    RAISE EXCEPTION '0052 post-condition failed: a live row carries a path-bearing endpoint';
  END IF;
END
$post$;
