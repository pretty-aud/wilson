-- =============================================================================
-- 0028_operator_console.sql — Session 15 (platform operator console + TPN)
--
-- The server half of the Platform Operator Console (/wilsonadmin, locked #18)
-- plus the durable rate limiter TPN asks for (MASTER_PLAN §6 #16). Five
-- things land here:
--
--   1. public.is_platform_operator() — the LIVE-ROW operator predicate.
--      Until now `is_platform_operator` existed only as a JWT claim that
--      exactly one client file read (usePermissions.js); no policy, helper
--      or Edge Function ever trusted it server-side. Operator authority is
--      the public.platform_operators TABLE (0001), and this helper is how
--      every new policy asks. Deliberately NOT the claim: a revoked
--      operator must lose reach on the next statement, not the next token
--      refresh — the S13 "reviewer authority is live-row everywhere"
--      lesson, applied to the highest tier in the system.
--
--   2. public.workspace_ai_keys — the per-company Anthropic key store the
--      ai-proxy seam (S12, locked #21) has been reading for since it
--      shipped. The key is stored as AES-256-GCM CIPHERTEXT produced by
--      _shared/aiKeyCrypto.ts; the data-encryption key lives in the
--      WILSON_AI_KEY_SECRET Edge-Function secret and never touches
--      Postgres. That matters because of locked #11/#15: the nightly
--      pg_dump lands in Backblaze B2, so a plaintext key column would put
--      every tenant's Anthropic credential in an off-platform backup.
--      Service-role only (the storage_gc_queue shape, 0027): RLS on, ZERO
--      policies, privileges revoked. No client — not an admin, not an
--      operator — ever reads a key back; the console sees key_hint only,
--      which is locked #8 (show-once) applied to tenant credentials.
--
--      NOT Supabase Vault, and the reason is worth recording: vault +
--      vault.decrypted_secrets exist on all three hosted projects, but the
--      CI pgTAP job runs `supabase start` on a LOCAL stack this machine
--      cannot run (no Docker), so a vault dependency inside the migration
--      chain would be unverifiable until it either passed or broke every
--      job at once. App-layer AES-GCM keeps the migration plain SQL, keeps
--      the ciphertext just as opaque in a dump, and puts the crypto
--      somewhere the adversarial review can read it.
--
--   3. public.platform_audit — the operator-tier append-only stream, and
--      the answer to the half of gap #34 that CASCADEs. app_events and
--      file_events both carry `workspace_id ... ON DELETE CASCADE`, so a
--      tenant teardown destroys its own audit trail and its own
--      TPN-CONT-002 deletion certificates along with it. platform_audit
--      carries NO foreign key and snapshots the slug/name as text, so the
--      record of a company's destruction OUTLIVES the company. Operators
--      read it; only service_role writes it. RETENTION: no purge job, by
--      the same TPN-LOG-004 reasoning as file_events (audit ≥ 1 year;
--      destruction certificates outlive their subject).
--
--   4. public.operator_workspace_summary() — one cross-tenant read, done
--      once, in SQL. A platform operator has NO cross-tenant reach today
--      beyond public.workspaces and public.auth_attempt_log: every other
--      table gates on public.current_workspace_id(), and
--      custom_access_token_hook refuses to mint a workspace_id the caller
--      is not a member of (0001), so the console genuinely cannot read
--      per-company numbers with an anon-key client. Rather than widen RLS
--      across tenants — which would put every company's rows one policy
--      bug away from each other — the console reads through service-role
--      Edge Functions, and this DEFINER aggregate is the single query
--      behind its list view.
--
--   5. public.edge_rate_limits + public.fn_rate_limit_hit() — the durable,
--      cross-isolate rate limiter (§6 #16). Every Edge-Function limiter
--      shipped so far is an in-memory Map inside one isolate
--      (ai-proxy's AI_PROXY_RPM window, provision-workspace's invite
--      budget), which means the effective limit is RPM × however many
--      isolates the platform happens to be running — unknowable, and
--      resets on every cold start. This is a fixed-window counter in
--      Postgres: shared by every isolate, atomic under concurrency, and
--      survives redeploys.
--
-- Design notes:
--   - Index naming follows 0027's `idx_<table>_<cols>` prefix form (the
--     repo is split between that and a `_idx` suffix form; 0027 is the
--     most recent precedent and this file matches it).
--   - No policy from any earlier migration is redefined here, so there is
--     NO ordering rule attached to 0028 (contrast 0022/0025/0026 — see
--     MASTER_PLAN §2). The one policy added to an existing table
--     (platform_operators) is a NEW policy alongside the 0002 one, not a
--     replacement, because permissive policies OR together.
--   - Teardown deliberately gets no `wilson.bypass_last_admin_guard`
--     wrapper. 0020's guard already returns early when the parent
--     workspaces row is gone, which is exactly the teardown case; setting
--     the GUC would widen the window in which any other statement in that
--     transaction could strip a live workspace's last admin, for no gain.
--   - fn_rate_limit_hit is a FIXED window, not a sliding one. A sliding
--     window needs per-hit rows (unbounded write amplification on the one
--     endpoint that already costs money per call); a fixed window is one
--     upsert. The cost is the standard boundary effect — up to 2× the
--     limit across a window edge — which is stated here rather than
--     discovered later.
--
-- Idempotent: safe to re-run.
-- pgTAP: 34_workspace_ai_keys.sql, 35_platform_audit.sql (new).
-- =============================================================================

-- ── 1. is_platform_operator() — live-row operator predicate ──────────────────

CREATE OR REPLACE FUNCTION public.is_platform_operator()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_operators po
     WHERE po.user_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.is_platform_operator() IS
  'Session 15: TRUE when the caller holds a live public.platform_operators row. SECURITY DEFINER so a policy can ask without granting the table. Deliberately reads the TABLE, never the is_platform_operator JWT claim — revocation must bite on the next statement, not the next token refresh.';

-- 0011's default privileges auto-grant EXECUTE to anon — re-lock, then grant
-- back to the roles that evaluate policies (policies run as the querying role).
REVOKE EXECUTE ON FUNCTION public.is_platform_operator() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_platform_operator() TO authenticated, service_role;

-- platform_operators: 0002 gives it a self-SELECT policy only, so an operator
-- cannot see who else is one. Add an operator arm (NEW policy — 0002's is left
-- untouched, and permissive policies OR together) and revoke client writes
-- belt-and-braces: granting/revoking operator status stays service_role-only,
-- through the operator-access Edge Function.
DROP POLICY IF EXISTS platform_operators_operator_read ON public.platform_operators;
CREATE POLICY platform_operators_operator_read ON public.platform_operators
  FOR SELECT
  USING (public.is_platform_operator());

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.platform_operators FROM anon, authenticated;

-- ── 2. workspace_ai_keys — per-company Anthropic key (ciphertext) ────────────

CREATE TABLE IF NOT EXISTS public.workspace_ai_keys (
  workspace_id   UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- base64(iv ‖ ciphertext ‖ tag) from _shared/aiKeyCrypto.ts. The bound is a
  -- sanity cap, not a format check: an Anthropic key is ~108 chars, so 4096
  -- leaves room for envelope growth without letting a bad write park a
  -- megabyte here.
  key_ciphertext TEXT NOT NULL CHECK (char_length(key_ciphertext) BETWEEN 16 AND 4096),
  -- Last 4 characters of the plaintext key, for "sk-ant-…9f2c" in the console.
  -- This is the ONLY part of a tenant key any client ever sees (locked #8).
  key_hint       TEXT NOT NULL CHECK (char_length(key_hint) BETWEEN 1 AND 12),
  -- Bumped if the envelope format ever changes, so a decrypt can branch
  -- instead of guessing.
  key_version    SMALLINT NOT NULL DEFAULT 1 CHECK (key_version > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID
);

-- Service-role only, the 0027 storage_gc_queue shape: RLS on with ZERO
-- policies denies every client role, and privileges are revoked as well.
-- FORCE is safe here (unlike file_events/edit_history) because no SECURITY
-- DEFINER trigger writes this table — there is no owner-path write to break.
ALTER TABLE public.workspace_ai_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_ai_keys FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_ai_keys FROM anon, authenticated;

COMMENT ON TABLE public.workspace_ai_keys IS
  'Session 15: per-workspace Anthropic API key as AES-256-GCM ciphertext (key in the WILSON_AI_KEY_SECRET Edge-Function secret, never in Postgres — the nightly pg_dump goes off-platform to B2). Read by ai-proxy, written by operator-ai-keys, both service_role. No client reads a key back; the console sees key_hint only.';

-- ── 3. platform_audit — operator stream that outlives a tenant ───────────────

CREATE TABLE IF NOT EXISTS public.platform_audit (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- No FK to auth.users: an operator account may be deleted long after the
  -- action it certifies. Same reasoning as file_events.file_id (0027).
  actor_user_id  UUID,
  actor_label    TEXT CHECK (actor_label IS NULL OR char_length(actor_label) <= 200),
  action         TEXT NOT NULL CHECK (action IN (
                   'workspace.created',
                   'workspace.renamed',
                   'workspace.suspended',
                   'workspace.restored',
                   'workspace.teardown',
                   'blob.purged',
                   'ai_key.set',
                   'ai_key.cleared',
                   'operator.granted',
                   'operator.revoked')),
  -- NO FK, and slug/name are SNAPSHOTS: the whole point of this table is
  -- that a 'workspace.teardown' row is still readable — and still names the
  -- company — after public.workspaces no longer has the row.
  workspace_id   UUID,
  workspace_slug TEXT CHECK (workspace_slug IS NULL OR char_length(workspace_slug) <= 64),
  workspace_name TEXT CHECK (workspace_name IS NULL OR char_length(workspace_name) <= 200),
  code           TEXT CHECK (code IS NULL OR code ~ '^WIL-[0-9]{4}$'),
  severity       TEXT NOT NULL DEFAULT 'info'
                   CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  message        TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  context        JSONB NOT NULL DEFAULT '{}'::jsonb
                   CHECK (char_length(context::text) <= 8000),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_time
  ON public.platform_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_workspace
  ON public.platform_audit (workspace_id, created_at DESC);

-- Operators read; only service_role writes (BYPASSRLS). Append-only: no
-- UPDATE/DELETE policy exists and those privileges are revoked, so a
-- destruction certificate cannot be edited away by anyone holding an
-- operator session.
ALTER TABLE public.platform_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_audit FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_audit_operator_read ON public.platform_audit;
CREATE POLICY platform_audit_operator_read ON public.platform_audit
  FOR SELECT
  USING (public.is_platform_operator());

REVOKE ALL ON public.platform_audit FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.platform_audit FROM authenticated;
GRANT  SELECT ON public.platform_audit TO authenticated;

COMMENT ON TABLE public.platform_audit IS
  'Session 15: append-only platform-operator audit stream. Carries NO workspace FK and snapshots slug/name as text so a workspace.teardown certificate survives the CASCADE that removes app_events and file_events (gap #34). No purge job, by TPN-LOG-004 (audit >= 1 year).';

-- ── 4. operator_workspace_summary() — the console list view ──────────────────
-- One DEFINER aggregate instead of a cross-tenant RLS widening. Returns every
-- workspace including suspended ones (deleted_at IS NOT NULL), which the
-- member-facing workspaces_select deliberately hides.

DROP FUNCTION IF EXISTS public.operator_workspace_summary();
CREATE FUNCTION public.operator_workspace_summary()
RETURNS TABLE (
  workspace_id   UUID,
  name           TEXT,
  slug           TEXT,
  created_at     TIMESTAMPTZ,
  deleted_at     TIMESTAMPTZ,
  storage_mode   TEXT,
  member_count   BIGINT,
  active_members BIGINT,
  admin_count    BIGINT,
  project_count  BIGINT,
  file_count     BIGINT,
  blob_count     BIGINT,
  has_ai_key     BOOLEAN,
  ai_key_hint    TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    w.id,
    w.name,
    w.slug,
    w.created_at,
    w.deleted_at,
    w.storage_mode,
    (SELECT count(*) FROM public.workspace_members m WHERE m.workspace_id = w.id),
    (SELECT count(*) FROM public.workspace_members m WHERE m.workspace_id = w.id AND m.is_active),
    (SELECT count(*) FROM public.workspace_members m
      WHERE m.workspace_id = w.id AND m.is_active AND m.app_role = 'admin'),
    (SELECT count(*) FROM public.projects p WHERE p.workspace_id = w.id),
    (SELECT count(*) FROM public.files f WHERE f.workspace_id = w.id),
    -- Blobs this tenant owns in the rabbit-files bucket. This is the number
    -- the teardown confirm has to state, because these are the objects the
    -- storage sweep must remove BEFORE the row disappears.
    (SELECT count(*) FROM public.files f
      WHERE f.workspace_id = w.id AND f.storage_provider = 'supabase'),
    (k.workspace_id IS NOT NULL),
    k.key_hint
  FROM public.workspaces w
  LEFT JOIN public.workspace_ai_keys k ON k.workspace_id = w.id
  ORDER BY w.created_at;
$$;

-- service_role only: this crosses every tenant boundary in the system. It is
-- reachable exclusively from the operator-* Edge Functions, which run the
-- operator guard first.
REVOKE EXECUTE ON FUNCTION public.operator_workspace_summary()
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.operator_workspace_summary() TO service_role;

COMMENT ON FUNCTION public.operator_workspace_summary() IS
  'Session 15: cross-tenant workspace roll-up for the operator console list view. service_role only — the console reaches it through operator-workspaces, never with an anon-key client. Includes suspended (soft-deleted) workspaces, which workspaces_select hides from members.';

-- ── 5. edge_rate_limits + fn_rate_limit_hit() — durable limiter (§6 #16) ─────

CREATE TABLE IF NOT EXISTS public.edge_rate_limits (
  bucket       TEXT NOT NULL CHECK (char_length(bucket) BETWEEN 1 AND 64),
  subject      TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
  window_start TIMESTAMPTZ NOT NULL,
  hits         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, subject, window_start)
);

CREATE INDEX IF NOT EXISTS idx_edge_rate_limits_window
  ON public.edge_rate_limits (window_start);

-- Service-role only (storage_gc_queue shape). A client that could read this
-- table could enumerate every workspace's request volume.
ALTER TABLE public.edge_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edge_rate_limits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.edge_rate_limits FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_rate_limit_hit(
  p_bucket         TEXT,
  p_subject        TEXT,
  p_limit          INT,
  p_window_seconds INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_hits         INT;
BEGIN
  IF p_limit IS NULL OR p_limit <= 0
     OR p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
    -- A caller that cannot state a sane limit gets refused rather than
    -- silently unlimited. NaN/0 from a bad env var is exactly how the
    -- in-memory limiter this replaces could have been switched off.
    RETURN TRUE;
  END IF;

  -- Fixed window: floor(now / window) — one row per (bucket, subject, window).
  v_window_start := to_timestamp(
    floor(extract(epoch FROM clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  -- Atomic under concurrency: the upsert takes the row lock, so two isolates
  -- racing the same subject serialise here rather than both reading `hits`
  -- and both deciding they are under the limit.
  INSERT INTO public.edge_rate_limits (bucket, subject, window_start, hits)
  VALUES (p_bucket, left(p_subject, 200), v_window_start, 1)
  ON CONFLICT (bucket, subject, window_start)
  DO UPDATE SET hits = public.edge_rate_limits.hits + 1
  RETURNING hits INTO v_hits;

  RETURN v_hits > p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_rate_limit_hit(TEXT, TEXT, INT, INT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_rate_limit_hit(TEXT, TEXT, INT, INT) TO service_role;

COMMENT ON FUNCTION public.fn_rate_limit_hit(TEXT, TEXT, INT, INT) IS
  'Session 15 (TPN, gap #16): durable fixed-window rate limiter shared by every Edge Function isolate. Returns TRUE when the caller is OVER the limit for this window. Counts the current call before comparing, so p_limit is inclusive. Fixed window means up to 2x the limit can pass across a window edge — accepted; a sliding window would need per-hit rows.';

-- Retention: windows are only interesting while they are current. Sweep
-- anything older than a day so the table stays small.
CREATE OR REPLACE FUNCTION public.purge_edge_rate_limits(
  p_keep INTERVAL DEFAULT INTERVAL '1 day'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INT;
BEGIN
  DELETE FROM public.edge_rate_limits
   WHERE window_start < now() - p_keep;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_edge_rate_limits(INTERVAL)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_edge_rate_limits(INTERVAL) TO service_role;

-- Schedule nightly where pg_cron exists (hosted envs). The CI local stack
-- ships without pg_cron; a scheduling hiccup must never fail the migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule(
      'wilson-purge-rate-limits',
      '59 4 * * *',
      $job$ SELECT public.purge_edge_rate_limits(); $job$
    );
  ELSE
    RAISE NOTICE 'pg_cron unavailable — rate-limit purge not scheduled (expected in CI local stack)';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'could not schedule rate-limit purge via pg_cron: %', SQLERRM;
END $$;

-- ── 6. Post-conditions ───────────────────────────────────────────────────────

DO $$
DECLARE
  n INT;
BEGIN
  -- workspace_ai_keys: RLS on + forced, and ZERO policies (service_role only).
  -- A policy appearing here would mean a client can read tenant API keys.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE relname = 'workspace_ai_keys' AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION '0028 post-condition failed: workspace_ai_keys RLS not enabled+forced';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'workspace_ai_keys'
  ) THEN
    RAISE EXCEPTION '0028 post-condition failed: workspace_ai_keys must have no client policies';
  END IF;

  -- platform_audit: RLS on, exactly one SELECT policy, append-only.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE relname = 'platform_audit' AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION '0028 post-condition failed: platform_audit RLS not enabled+forced';
  END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'platform_audit';
  IF n <> 1 THEN
    RAISE EXCEPTION '0028 post-condition failed: platform_audit must have exactly 1 policy (select), found %', n;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'platform_audit'
       AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION '0028 post-condition failed: platform_audit must stay append-only';
  END IF;

  -- platform_audit must NOT carry a workspaces FK — the whole point is that a
  -- teardown certificate survives the CASCADE (gap #34).
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.platform_audit'::regclass
       AND contype = 'f'
       AND confrelid = 'public.workspaces'::regclass
  ) THEN
    RAISE EXCEPTION '0028 post-condition failed: platform_audit must not FK workspaces (certificates outlive the tenant)';
  END IF;

  -- edge_rate_limits: RLS on + forced, zero policies.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE relname = 'edge_rate_limits' AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION '0028 post-condition failed: edge_rate_limits RLS not enabled+forced';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'edge_rate_limits'
  ) THEN
    RAISE EXCEPTION '0028 post-condition failed: edge_rate_limits must have no client policies';
  END IF;

  -- platform_operators keeps BOTH arms: the 0002 self-read and the new
  -- operator-read. Losing the self arm would break usePermissions' ability to
  -- tell a user they are an operator.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'platform_operators'
     AND policyname IN ('platform_operators_self', 'platform_operators_operator_read');
  IF n <> 2 THEN
    RAISE EXCEPTION '0028 post-condition failed: platform_operators needs both the self and operator read policies, found %', n;
  END IF;

  -- Functions exist with the expected signatures.
  IF to_regprocedure('public.is_platform_operator()') IS NULL
     OR to_regprocedure('public.operator_workspace_summary()') IS NULL
     OR to_regprocedure('public.fn_rate_limit_hit(text,text,int,int)') IS NULL
     OR to_regprocedure('public.purge_edge_rate_limits(interval)') IS NULL THEN
    RAISE EXCEPTION '0028 post-condition failed: an operator/rate-limit function is missing';
  END IF;

  -- The cross-tenant reader must never be reachable by a client role. This is
  -- the single most important privilege assertion in the file.
  IF has_function_privilege('authenticated', 'public.operator_workspace_summary()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.operator_workspace_summary()', 'EXECUTE') THEN
    RAISE EXCEPTION '0028 post-condition failed: operator_workspace_summary must be service_role only';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_rate_limit_hit(text,text,int,int)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_rate_limit_hit(text,text,int,int)', 'EXECUTE') THEN
    RAISE EXCEPTION '0028 post-condition failed: fn_rate_limit_hit must be service_role only';
  END IF;
END $$;
