-- =============================================================================
-- 0106_s3_endpoint_public_hosts.sql — P8, night 5 of
-- docs/sessions/PLAN_TO_1_0.md (2026-10-28): Phase 8 of
-- TPN_AUDIT/REMEDIATION_PLAN.md, two findings' database halves.
--
-- §1. TPN-NET-016 — Edge Functions fetched an admin's S3 endpoint with no
--     private-address refusal. 0052's CHECK on workspace_storage admitted
--     `https://10.0.0.5` and `https://nas.local`, so a company's admin could
--     aim storage-secret's probe and storage-gc's drain at addresses inside
--     the platform. The functions now vet the host they will reach
--     (_shared/s3Reach.ts: a public literal, or a public name whose every
--     resolved answer is public; one TLS connection to that literal; no
--     redirect followed). This file is the row's half, at the SAVE (the S34
--     rule: the CHECK here, the vet in the functions, validateS3Draft beside
--     the field): workspace_storage_s3_config_chk is 0052's predicate,
--     VERBATIM, plus one arm — s3_endpoint_host_ok(endpoint): a literal host
--     must be public (0093's gateway_is_public_ip: never private, loopback,
--     link-local, CGNAT, multicast, documentation or reserved), a name must
--     carry two labels and be neither localhost, a local suffix (.local,
--     .localhost, .internal, .intranet, .lan, .home, .corp, .localdomain,
--     .home.arpa, .invalid, .test, .example, .onion) nor a Supabase host. A
--     NAME that resolves to a private address cannot be caught in SQL: the
--     functions catch it at the secret's save (storage-secret `set`) and at
--     every use. Replaced by DROP + ADD, as 0052 did (a wrapped re-ADD is a
--     silent no-op). Validated, not NOT VALID: the pre-flight first counts
--     the rows the new arm would refuse and STOPS with the count, never a
--     value, so the apply never fails mid-file (the plan's Fable round).
--
-- §2. TPN-ENC-015 — the re-seal's audit verb. operator-ai-keys' `reseal`
--     action (P8) writes one platform_audit row per run, action
--     `secret.resealed`, carrying the counts and the key version and never a
--     value or a hint. platform_audit_action_check is a closed set (0028,
--     widened by 0031, 0055, 0066): restated here from 0066's full list plus
--     the one verb, with 0066's own post-condition shape (the new verb
--     admitted, an old one still admitted).
--
-- HOW IT IS APPLIED (the house way, never `supabase db push`): this file's
-- statements by `supabase db query --linked --file` from an LF copy, then,
-- in a second call, the history row (INSERT INTO
-- supabase_migrations.schema_migrations (version, name, statements) SELECT
-- '0106', 's3_endpoint_public_hosts', ARRAY[<this whole file>] WHERE NOT
-- EXISTS (… version = '0106')); md5(statements[1]) is the LF file's md5.
--
-- ORDERING — depends on: 0052 (the constraint it restates), 0093
-- (gateway_is_public_ip), 0066 (the action list it restates). Numbers:
-- 0106 / suite 109 (0102 and suite 105 stay reserved for the avatars
-- policy). Idempotent: OR REPLACE and DROP + ADD throughout.
--
-- ROLLBACK (a reviewed reverse file): restate workspace_storage_s3_config_chk
-- from 0052 (DROP + ADD) and platform_audit_action_check from 0066; drop
-- s3_endpoint_host_ok. A row saved under this file's arm is a valid row
-- under 0052's.
-- =============================================================================


-- =============================================================================
-- 0. PRE-FLIGHT
-- =============================================================================
DO $$
BEGIN
  IF to_regprocedure('public.gateway_is_public_ip(inet)') IS NULL THEN
    RAISE EXCEPTION '0106 pre-flight failed: gateway_is_public_ip is missing — apply 0093 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.workspace_storage'::regclass AND conname = 'workspace_storage_s3_config_chk') THEN
    RAISE EXCEPTION '0106 pre-flight failed: workspace_storage_s3_config_chk is missing — apply 0052 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.platform_audit'::regclass AND conname = 'platform_audit_action_check') THEN
    RAISE EXCEPTION '0106 pre-flight failed: platform_audit_action_check is missing — apply 0066 first';
  END IF;
END $$;


-- =============================================================================
-- 1. s3_endpoint_host_ok — the host of an endpoint, as 0052 admits one
-- =============================================================================
CREATE OR REPLACE FUNCTION public.s3_endpoint_host_ok(p_endpoint TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $$
DECLARE
  v_auth TEXT;
  v_host TEXT;
  v_ip   INET;
BEGIN
  -- No endpoint: AWS's own hosts (s3.<region>.amazonaws.com), public by construction.
  IF p_endpoint IS NULL THEN RETURN true; END IF;
  IF p_endpoint !~ '^https://[^/?#]+$' THEN RETURN false; END IF;
  v_auth := lower(substring(p_endpoint FROM 9));
  -- No credentials in the authority.
  IF position('@' IN v_auth) > 0 THEN RETURN false; END IF;
  -- The host: a bracketed IPv6 literal, else everything before the port.
  IF v_auth ~ '^\[' THEN
    v_host := substring(v_auth FROM '^\[([^\]]+)\]');
    IF v_host IS NULL OR v_auth !~ '^\[[^\]]+\](:[0-9]{1,5})?$' THEN RETURN false; END IF;
  ELSE
    IF v_auth !~ '^[^:]+(:[0-9]{1,5})?$' THEN RETURN false; END IF;  -- an unbracketed colon run is no host
    v_host := split_part(v_auth, ':', 1);
  END IF;
  IF v_host = '' OR char_length(v_host) > 253 THEN RETURN false; END IF;
  -- A literal: public, or nothing.
  IF v_host ~ '^[0-9a-f:.]+$' AND v_host ~ '[:.]' THEN
    BEGIN
      v_ip := v_host::inet;
    EXCEPTION WHEN OTHERS THEN
      RETURN false;
    END;
    IF host(v_ip) <> v_host THEN RETURN false; END IF;  -- one canonical spelling, as 0093 asks of an inside host
    RETURN public.gateway_is_public_ip(v_ip);
  END IF;
  -- A name: two labels at least, lower-case, and none of the local suffixes
  -- (gatewayReach.ts's LOCAL_NAME_SUFFIX and SUPABASE_HOST_SUFFIX, the same list).
  IF v_host !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$' THEN RETURN false; END IF;
  IF v_host ~ '\.(local|localhost|internal|intranet|lan|home|corp|localdomain|invalid|test|example|onion)$'
     OR v_host ~ '\.home\.arpa$' THEN
    RETURN false;
  END IF;
  IF v_host ~ '(^|\.)supabase\.(co|in|net|com)$' THEN RETURN false; END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.s3_endpoint_host_ok(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s3_endpoint_host_ok(TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.s3_endpoint_host_ok(TEXT) IS
  '0106 (TPN-NET-016): true when an S3 endpoint (https://host or https://host:port; NULL means AWS) names a PUBLIC host — a literal gateway_is_public_ip admits in its canonical spelling, or a lower-case name of two or more labels that is not localhost, a local suffix (.local .localhost .internal .intranet .lan .home .corp .localdomain .home.arpa .invalid .test .example .onion) or a Supabase host. The row''s half of the rule the functions apply when they reach the bucket (_shared/s3Reach.ts resolves a name and refuses a private answer; SQL cannot).';


-- =============================================================================
-- 1b. The rows the new arm would refuse: counted, and the apply stops here
--     if any exists (no value is printed; the controller asks the company)
-- =============================================================================
DO $$
DECLARE
  v_n INT;
BEGIN
  SELECT count(*) INTO v_n
    FROM public.workspace_storage
   WHERE provider = 's3'
     AND provider_config ? 'endpoint'
     AND NOT public.s3_endpoint_host_ok(provider_config ->> 'endpoint');
  IF v_n > 0 THEN
    RAISE EXCEPTION '0106 stopped before the constraint: % workspace_storage row(s) name an S3 endpoint inside a private network, which the new arm refuses; fix those rows with their companies first (the hand-off says how), then apply this file again', v_n;
  END IF;
END $$;


-- =============================================================================
-- 1c. workspace_storage_s3_config_chk — 0052's predicate, verbatim, plus one arm
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
               -- 0052's arm: host only. Nothing may follow the authority — no
               -- path, no query, no fragment. `s3HostAndPath` would drop it and
               -- sign the wrong URI.
               AND (provider_config->>'endpoint') !~ '^https://[^/?#]+[/?#]'
               -- 🚨 THE ARM THIS MIGRATION ADDS (TPN-NET-016): a PUBLIC host.
               AND public.s3_endpoint_host_ok(provider_config->>'endpoint')))
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
               AND (provider_config->>'prefix') !~ '(^|/)\.\.?(/|$)'))
    )
  );

COMMENT ON CONSTRAINT workspace_storage_s3_config_chk ON public.workspace_storage IS
  '0051''s s3 config shape, 0052''s host-only endpoint, 0106''s PUBLIC endpoint host (TPN-NET-016: s3_endpoint_host_ok — never a private, loopback, link-local, CGNAT or reserved literal, never a local or Supabase name).';


-- =============================================================================
-- 2. platform_audit_action_check — 0066's list, verbatim, plus secret.resealed
-- =============================================================================
ALTER TABLE public.platform_audit DROP CONSTRAINT IF EXISTS platform_audit_action_check;
ALTER TABLE public.platform_audit ADD CONSTRAINT platform_audit_action_check
  CHECK (action IN (
    'workspace.created',
    'workspace.renamed',
    'workspace.suspended',
    'workspace.restored',
    'workspace.teardown',
    'blob.purged',
    'ai_key.set',
    'ai_key.cleared',
    'operator.granted',
    'operator.revoked',
    -- Session 20
    'model.approved',
    'model.retired',
    'model.restored',
    'model.default_set',
    'model.default_cleared',
    -- Session 41
    'storage_plan.set',
    'storage_plan.cleared',
    'storage_plan.suspended',
    'storage_plan.restored',
    -- Session 43b
    'workspace.invite_sent',
    -- P8 (TPN-ENC-015): one row per re-seal run, the counts and the key
    -- version, never a value or a hint
    'secret.resealed'));


-- =============================================================================
-- 3. POST-CONDITIONS — by example, on the catalogue, never on a fixture row
-- =============================================================================
DO $$
DECLARE
  v_ok BOOLEAN;
BEGIN
  -- The predicate itself.
  IF NOT public.s3_endpoint_host_ok('https://s3.us-west-004.backblazeb2.com')
     OR NOT public.s3_endpoint_host_ok('https://minio.example.com:9000')
     OR NOT public.s3_endpoint_host_ok('https://93.184.216.34')
     OR NOT public.s3_endpoint_host_ok(NULL) THEN
    RAISE EXCEPTION '0106 post-condition failed: s3_endpoint_host_ok refuses a public endpoint';
  END IF;
  IF public.s3_endpoint_host_ok('https://10.0.0.5')
     OR public.s3_endpoint_host_ok('https://192.168.1.2:9000')
     OR public.s3_endpoint_host_ok('https://169.254.169.254')
     OR public.s3_endpoint_host_ok('https://127.0.0.1:9000')
     OR public.s3_endpoint_host_ok('https://100.64.0.1')
     OR public.s3_endpoint_host_ok('https://[fd00::1]:9000')
     OR public.s3_endpoint_host_ok('https://[::1]')
     OR public.s3_endpoint_host_ok('https://nas.local')
     OR public.s3_endpoint_host_ok('https://localhost:9000')
     OR public.s3_endpoint_host_ok('https://minio.internal')
     OR public.s3_endpoint_host_ok('https://storage.lan:9000')
     OR public.s3_endpoint_host_ok('https://minio')
     OR public.s3_endpoint_host_ok('https://x.supabase.co')
     OR public.s3_endpoint_host_ok('https://u:p@s3.example.com')
     OR public.s3_endpoint_host_ok('https://fd00::1')
     OR public.s3_endpoint_host_ok('http://s3.example.com') THEN
    RAISE EXCEPTION '0106 post-condition failed: s3_endpoint_host_ok admits a private, local, bare, credentialed or non-https endpoint';
  END IF;
  -- The constraint carries the arm and 0052's.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.workspace_storage'::regclass
                    AND conname = 'workspace_storage_s3_config_chk'
                    AND pg_get_constraintdef(oid) LIKE '%s3_endpoint_host_ok%'
                    AND pg_get_constraintdef(oid) LIKE '%[/?#]%'
                    AND pg_get_constraintdef(oid) LIKE '%forcePathStyle%') THEN
    RAISE EXCEPTION '0106 post-condition failed: workspace_storage_s3_config_chk lacks the public-host arm or lost 0052''s';
  END IF;
  -- The audit verb: the new one admitted, an old one still admitted (0066's shape), and the row rolled back.
  BEGIN
    INSERT INTO public.platform_audit (action, message) VALUES ('secret.resealed', '0106 post-condition probe');
    v_ok := true;
    RAISE EXCEPTION USING ERRCODE = 'P0999';
  EXCEPTION
    WHEN check_violation THEN v_ok := false;
    WHEN SQLSTATE 'P0999' THEN NULL;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION '0106 post-condition failed: secret.resealed was NOT admitted by platform_audit_action_check';
  END IF;
  BEGIN
    INSERT INTO public.platform_audit (action, message) VALUES ('workspace.invite_sent', '0106 post-condition probe');
    v_ok := true;
    RAISE EXCEPTION USING ERRCODE = 'P0999';
  EXCEPTION
    WHEN check_violation THEN v_ok := false;
    WHEN SQLSTATE 'P0999' THEN NULL;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION '0106 post-condition failed: an old verb (workspace.invite_sent) was lost in the restatement';
  END IF;
  IF EXISTS (SELECT 1 FROM public.platform_audit WHERE message = '0106 post-condition probe') THEN
    RAISE EXCEPTION '0106 post-condition failed: a probe row survived';
  END IF;
  RAISE NOTICE '0106 OK: s3_endpoint_host_ok; workspace_storage_s3_config_chk restated from 0052 with the public-host arm; platform_audit_action_check restated from 0066 with secret.resealed';
END $$;
