-- =============================================================================
-- 0031_model_control_plane.sql — Session 20 (the model control plane)
--
-- S19 made every AI call site resolve its model through one registry
-- (src/lib/aiModels.js) instead of 28 hardcoded strings. The registry reads
-- three override tiers — user, workspace, platform — and until now all three
-- were empty: `setModelSources()` was fed only by a localStorage map, so a
-- model change was still a code change for everyone except the one person
-- sitting at that browser.
--
-- This migration is the storage half of D1/D2/D4: Audrey approves a model
-- once, and every company can use it.
--
--   1. public.platform_approved_models — the operator-curated CATALOGUE.
--      D4 says company admins and users may only choose from models the
--      WILSON operator has approved; free text is operator-only. That makes
--      the catalogue a platform-level asset, so it is the ONE table in this
--      file that every authenticated user can read regardless of company.
--
--      It has NO write policy, and that is deliberate rather than an
--      oversight. D5 says a new model id must be validated against Anthropic
--      before it can be saved. If an operator could INSERT here through
--      PostgREST, the validation in the `operator-models` Edge Function
--      would be decorative — one crafted request would put an unvalidated
--      id into every company's picker. So writes go through service_role
--      only, exactly as workspace_ai_keys and platform_audit do, and
--      supabase/tests/rls/35_platform_audit.sql:194-202 already pins the
--      same rule for the audit stream ('even an operator cannot write
--      platform_audit directly').
--
--      ⚠️ The SELECT policy is `USING (true)` — the FIRST unscoped read
--      policy in this schema. Every other policy in 0000-0030 is scoped to a
--      workspace, a membership, or is_platform_operator(). It is stated here
--      because it looks like a mistake and is not: the audience is narrowed
--      by the GRANT (authenticated only, anon revoked), and the catalogue is
--      deliberately not secret — a company cannot choose from a list it
--      cannot read. Note which line is the control: on platform_audit
--      (0028:207-218) the identical GRANT sits beside an operator-only
--      policy, so THE POLICY IS THE GATE, NOT THE GRANT. Copying that block
--      and changing only the grant would produce a catalogue nobody can read.
--
--   2. public.platform_model_defaults — the platform tier. One row per
--      registry key that Audrey has pinned; absence means "fall through to
--      the built-in floor in code", which is why nothing is seeded here.
--
--      This is the only table carrying `effort`. Audrey's decision
--      (2026-08-02): effort stays operator-only. It is a performance lever
--      with a sharp edge — S19 MEASURED D.O.G.'s full deck at 137.9s with no
--      effort field against 69.1s at `medium`, and ai-proxy streams through
--      an Edge Function, so an admin setting `max` could push a working deck
--      past the deadline. Companies choose the model; the platform chooses
--      how hard it thinks.
--
--   3. public.workspace_model_overrides — the workspace tier. A company
--      admin's choice, beating the platform default for that company.
--
--   4. public.user_model_overrides — the user tier, and the one the S20 plan
--      did not list. Block E ("migrate userModelPrefs into the user tier")
--      has nowhere to land without it: the prefs live in localStorage under
--      'wilson.modelPrefs.v1' today, which means they follow a browser
--      rather than a person and vanish on a cache clear.
--
-- Design notes:
--   - D4 IS ENFORCED IN THE DATABASE, not just in the picker. Both override
--     tables FK model_id -> platform_approved_models, so an admin or user
--     literally cannot store a model the operator has not approved, whatever
--     client they use. What this does NOT cover is a one-off request POSTed
--     straight at ai-proxy with an arbitrary model; gating that would put a
--     catalogue read on the path of every AI call, and turning a database
--     hiccup into an AI outage is the exact failure class that cost 47 days.
--     Audrey's call, 2026-08-02: client-side for the picker, FK for storage,
--     ai-proxy left alone. Recorded in docs/OUTSTANDING.md.
--   - RETIREMENT IS SOFT. `retired_at` is set; the row stays. A hard delete
--     would break the FK from any override still pointing at it and would
--     erase the record that the model was ever offered. There is therefore
--     no DELETE policy and no DELETE privilege on the catalogue.
--   - REGISTRY KEYS ARE NOT ENUMERATED IN A CHECK. aiModels.js:60-62 calls
--     the key a persistence contract, and freezing all 28 into the schema
--     would mean a migration for every new call site. The CHECK is a shape
--     test instead. A typo'd key can therefore persist, but it is inert:
--     every read path iterates REGISTRY and looks the key up, so a row whose
--     key is not in the registry is never consulted.
--   - NO fn_audit_touch TRIGGER on any of these tables. It sets
--     updated_by := auth.uid(), which is NULL under service_role, so the
--     operator tables would blank their own actor on every Edge write
--     (0030:149-155 documents exactly this). The writers stamp the columns
--     instead, which is what workspace_ai_keys does (0028:148-150, no
--     trigger anywhere in the tree).
--   - Index naming uses 0027/0028's `idx_<table>_<cols>` prefix form.
--   - Never FOR ALL: 0029 exists to undo one. Write arms are separate.
--
-- Idempotent: safe to re-run.
--
-- ORDERING RULE: this file extends the `action` CHECK on public.platform_audit
-- that 0028 creates. A manual re-run of 0028 restores the closed 10-value
-- constraint and `operator-models` will start failing every audit write with
-- a check violation — so a re-run of 0028 MUST be followed by a re-run of
-- 0031. (Same class as 0002->0029 and 0011->0030; see MASTER_PLAN §2.)
--
-- pgTAP: 39_platform_approved_models.sql, 40_platform_model_defaults.sql,
--        41_workspace_model_overrides.sql, 42_user_model_overrides.sql (new).
-- =============================================================================

-- ── 1. platform_approved_models — the operator-curated catalogue ─────────────

CREATE TABLE IF NOT EXISTS public.platform_approved_models (
  -- Shape-checked against the same regex as isWellFormedModelId()
  -- (aiModels.js:193). Anthropic remains the authority on whether an id
  -- actually resolves; that is what operator-models validates before insert.
  model_id       TEXT PRIMARY KEY
                   CHECK (model_id ~ '^claude-[a-z0-9][a-z0-9.-]{2,63}$'),
  label          TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 64),
  hint           TEXT NOT NULL DEFAULT ''
                   CHECK (char_length(hint) <= 200),
  -- Display order in every picker. Ties break on label.
  sort_order     INT  NOT NULL DEFAULT 100,
  -- How the id was proven at save time. 'validated' = Anthropic answered 200
  -- to a 1-token probe. 'unverified' = the probe was INCONCLUSIVE (429, 5xx,
  -- network) and the operator saved anyway, which D5 permits — refusing a
  -- good model because Anthropic was briefly busy would be its own bug. A
  -- 404 is never saved at all.
  validation     TEXT NOT NULL DEFAULT 'unverified'
                   CHECK (validation IN ('validated', 'unverified')),
  validated_at   TIMESTAMPTZ,
  -- Soft retirement. NULL = offerable. Set = keep the row, drop it from the
  -- pickers, leave existing overrides pointing at it resolvable.
  retired_at     TIMESTAMPTZ,
  -- Operator who approved / retired. No FK: an operator account may be
  -- deleted long after the catalogue entry it created (platform_audit
  -- reasoning, 0028:167-169).
  approved_by    UUID,
  retired_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_approved_models_live
  ON public.platform_approved_models (sort_order, label)
  WHERE retired_at IS NULL;

-- Every authenticated user reads the catalogue; nobody writes it from a
-- client. FORCE is safe: no SECURITY DEFINER trigger writes this table, so
-- there is no owner-path write to break (the 0028:154-156 test).
ALTER TABLE public.platform_approved_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_approved_models FORCE ROW LEVEL SECURITY;

-- ⚠️ Unscoped by design — see the header. The GRANT below is what limits the
-- audience to signed-in users; this policy deliberately adds no further test.
DROP POLICY IF EXISTS platform_approved_models_read ON public.platform_approved_models;
CREATE POLICY platform_approved_models_read ON public.platform_approved_models
  FOR SELECT
  USING (true);

REVOKE ALL ON public.platform_approved_models FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.platform_approved_models FROM authenticated;
GRANT  SELECT ON public.platform_approved_models TO authenticated;

COMMENT ON TABLE public.platform_approved_models IS
  'Session 20: the operator-curated catalogue of Claude models every company may choose from (D4). Read by every authenticated user; written ONLY by service_role through the operator-models Edge Function, so the Anthropic validation D5 requires cannot be bypassed with a PostgREST call. Retirement is soft (retired_at) so existing overrides keep resolving.';

-- ── 2. platform_model_defaults — the platform tier (+ effort) ────────────────

CREATE TABLE IF NOT EXISTS public.platform_model_defaults (
  -- A src/lib/aiModels.js REGISTRY key. Shape-checked, not enumerated —
  -- see the header. Rows whose key is not in the registry are inert.
  registry_key   TEXT PRIMARY KEY
                   CHECK (registry_key ~ '^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+)+$'),
  -- NULL means "no platform opinion" — resolution falls through to the
  -- built-in floor for this function's tier.
  model_id       TEXT REFERENCES public.platform_approved_models(model_id)
                   ON DELETE RESTRICT,
  -- OPERATOR-ONLY, and the only effort store in the system (Audrey,
  -- 2026-08-02). Mirrors EFFORT_LEVELS in aiModels.js:294.
  effort         TEXT CHECK (effort IS NULL OR effort IN ('low', 'medium', 'high', 'xhigh', 'max')),
  updated_by     UUID,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_model_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_model_defaults FORCE ROW LEVEL SECURITY;

-- Same shape as the catalogue: every signed-in user must be able to READ the
-- platform default in order to resolve a model, and nobody writes from a
-- client.
DROP POLICY IF EXISTS platform_model_defaults_read ON public.platform_model_defaults;
CREATE POLICY platform_model_defaults_read ON public.platform_model_defaults
  FOR SELECT
  USING (true);

REVOKE ALL ON public.platform_model_defaults FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.platform_model_defaults FROM authenticated;
GRANT  SELECT ON public.platform_model_defaults TO authenticated;

COMMENT ON TABLE public.platform_model_defaults IS
  'Session 20: per-function platform default model, keyed by aiModels.js REGISTRY key. Absence = fall through to the built-in floor in code, which is why nothing is seeded. Carries the ONLY effort column in the system: effort is operator-only because ai-proxy runs on an Edge Function and an over-ambitious setting costs wall-clock a company admin cannot see (S19 measured 137.9s unset vs 69.1s at medium for dog.fullDeck).';

-- ── 3. workspace_model_overrides — the workspace tier ────────────────────────

CREATE TABLE IF NOT EXISTS public.workspace_model_overrides (
  workspace_id   UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  registry_key   TEXT NOT NULL
                   CHECK (registry_key ~ '^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+)+$'),
  -- FK is how D4 is enforced for STORED overrides: an admin cannot persist a
  -- model the operator has not approved, whatever client they use.
  model_id       TEXT NOT NULL REFERENCES public.platform_approved_models(model_id)
                   ON DELETE RESTRICT,
  updated_by     UUID,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, registry_key)
);

ALTER TABLE public.workspace_model_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_model_overrides FORCE ROW LEVEL SECURITY;

-- Every member of the company READS its overrides — resolution needs them on
-- every AI call, not just in the admin screen.
DROP POLICY IF EXISTS workspace_model_overrides_select ON public.workspace_model_overrides;
CREATE POLICY workspace_model_overrides_select ON public.workspace_model_overrides
  FOR SELECT
  USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  );

-- Company admins write. The canonical triple (0020:278-290), split into
-- separate arms because 0029 exists specifically to undo a FOR ALL.
--
-- KNOWN LIMIT: current_app_role() is a JWT claim (0008:32-42), so a
-- just-demoted admin keeps write access until their token refreshes. That is
-- the same window every other admin write in WILSON carries; it is called out
-- here rather than discovered later. has_active_membership() closes the
-- DEACTIVATED case, which is the one 0020 was written to fix.
DROP POLICY IF EXISTS workspace_model_overrides_admin_insert ON public.workspace_model_overrides;
CREATE POLICY workspace_model_overrides_admin_insert ON public.workspace_model_overrides
  FOR INSERT
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_app_role() = 'admin'
    AND public.has_active_membership(workspace_id)
  );

DROP POLICY IF EXISTS workspace_model_overrides_admin_update ON public.workspace_model_overrides;
CREATE POLICY workspace_model_overrides_admin_update ON public.workspace_model_overrides
  FOR UPDATE
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_app_role() = 'admin'
    AND public.has_active_membership(workspace_id)
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_app_role() = 'admin'
    AND public.has_active_membership(workspace_id)
  );

DROP POLICY IF EXISTS workspace_model_overrides_admin_delete ON public.workspace_model_overrides;
CREATE POLICY workspace_model_overrides_admin_delete ON public.workspace_model_overrides
  FOR DELETE
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_app_role() = 'admin'
    AND public.has_active_membership(workspace_id)
  );

REVOKE ALL ON public.workspace_model_overrides FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER
  ON public.workspace_model_overrides FROM authenticated;
GRANT  SELECT, INSERT, UPDATE, DELETE
  ON public.workspace_model_overrides TO authenticated;

COMMENT ON TABLE public.workspace_model_overrides IS
  'Session 20: per-company model override, beating the platform default. Every member reads (resolution needs it on every AI call); only a company admin writes. model_id FKs the approved catalogue, so D4 is enforced in the database for stored overrides and not only in the picker.';

-- ── 4. user_model_overrides — the user tier ──────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_model_overrides (
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Scoped per company as well as per person: the same account in two
  -- workspaces should not drag one company's model choices into another.
  workspace_id   UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  registry_key   TEXT NOT NULL
                   CHECK (registry_key ~ '^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+)+$'),
  model_id       TEXT NOT NULL REFERENCES public.platform_approved_models(model_id)
                   ON DELETE RESTRICT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, workspace_id, registry_key)
);

ALTER TABLE public.user_model_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_model_overrides FORCE ROW LEVEL SECURITY;

-- Own rows only, in the workspace the caller is currently signed in to.
-- Deliberately NOT readable by a company admin: this is a personal setting,
-- and an admin who needs to constrain a user has the workspace tier for that.
DROP POLICY IF EXISTS user_model_overrides_select ON public.user_model_overrides;
CREATE POLICY user_model_overrides_select ON public.user_model_overrides
  FOR SELECT
  USING (
    user_id = auth.uid()
    AND workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  );

DROP POLICY IF EXISTS user_model_overrides_insert ON public.user_model_overrides;
CREATE POLICY user_model_overrides_insert ON public.user_model_overrides
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  );

DROP POLICY IF EXISTS user_model_overrides_update ON public.user_model_overrides;
CREATE POLICY user_model_overrides_update ON public.user_model_overrides
  FOR UPDATE
  USING (
    user_id = auth.uid()
    AND workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  )
  WITH CHECK (
    user_id = auth.uid()
    AND workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  );

DROP POLICY IF EXISTS user_model_overrides_delete ON public.user_model_overrides;
CREATE POLICY user_model_overrides_delete ON public.user_model_overrides
  FOR DELETE
  USING (
    user_id = auth.uid()
    AND workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  );

REVOKE ALL ON public.user_model_overrides FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER
  ON public.user_model_overrides FROM authenticated;
GRANT  SELECT, INSERT, UPDATE, DELETE
  ON public.user_model_overrides TO authenticated;

COMMENT ON TABLE public.user_model_overrides IS
  'Session 20: per-user model override, the top of the resolution cascade. Replaces the localStorage map (wilson.modelPrefs.v1) so a preference follows the person rather than the browser. Own rows only — not readable by a company admin; the workspace tier is the admin''s lever.';

-- ── 5. platform_audit — admit the model actions ──────────────────────────────
--
-- 0028 closed `action` to ten values. operator-models writes certificates for
-- catalogue and default changes like every other operator write, so the
-- constraint has to admit them. See the ORDERING RULE in the header.

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
    'model.default_cleared'));

-- ── 6. Seed the catalogue ────────────────────────────────────────────────────
--
-- The four ids SELECTABLE_MODELS offered (aiModels.js:286-291), which the S20
-- pickers replace. Seeding matters for more than convenience: both override
-- tables FK this one, so an empty catalogue would make every picker empty and
-- every override unsavable on the day this ships.
--
-- `validation` records what is actually known, not what is assumed. The S19
-- probe MEASURED sonnet-5, sonnet-4-6 and haiku-4-5 answering 200 through
-- ai-proxy; opus-5 is documented as current but was never probed, and
-- aiModels.js:283-284 says so. Marking it 'validated' here would be inventing
-- evidence.

INSERT INTO public.platform_approved_models
  (model_id, label, hint, sort_order, validation, validated_at)
VALUES
  ('claude-opus-5', 'Opus 5',
   'Most capable. Slowest and dearest.', 10, 'unverified', NULL),
  ('claude-sonnet-5', 'Sonnet 5',
   'The default for heavier work.', 20, 'validated', now()),
  ('claude-sonnet-4-6', 'Sonnet 4.6',
   'Previous generation. Does not think by default.', 30, 'validated', now()),
  ('claude-haiku-4-5-20251001', 'Haiku 4.5',
   'Fastest and cheapest. The default for light work.', 40, 'validated', now())
ON CONFLICT (model_id) DO NOTHING;

-- ── 7. Post-conditions ───────────────────────────────────────────────────────

DO $$
DECLARE
  n INT;
BEGIN
  -- RLS on, and forced, on all four.
  SELECT count(*) INTO n
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public'
     AND c.relname IN ('platform_approved_models', 'platform_model_defaults',
                       'workspace_model_overrides', 'user_model_overrides')
     AND c.relrowsecurity AND c.relforcerowsecurity;
  IF n <> 4 THEN
    RAISE EXCEPTION '0031 post-condition failed: expected 4 tables with RLS enabled and forced, found %', n;
  END IF;

  -- The catalogue and the platform defaults must have NO write policy. This
  -- is what keeps D5 enforceable; a stray operator INSERT policy here would
  -- make the Anthropic validation bypassable.
  SELECT count(*) INTO n
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('platform_approved_models', 'platform_model_defaults')
     AND cmd <> 'SELECT';
  IF n <> 0 THEN
    RAISE EXCEPTION '0031 post-condition failed: % write policies on the operator-owned tables; writes must go through service_role only', n;
  END IF;

  -- 0011's ALTER DEFAULT PRIVILEGES hands anon and authenticated ALL on every
  -- new table. Prove the REVOKEs above actually landed — a policy-only check
  -- would pass while the privilege hole is wide open.
  IF has_table_privilege('authenticated', 'public.platform_approved_models', 'INSERT')
     OR has_table_privilege('authenticated', 'public.platform_approved_models', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.platform_approved_models', 'DELETE') THEN
    RAISE EXCEPTION '0031 post-condition failed: authenticated can still write the catalogue';
  END IF;
  IF has_table_privilege('authenticated', 'public.platform_model_defaults', 'INSERT')
     OR has_table_privilege('authenticated', 'public.platform_model_defaults', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.platform_model_defaults', 'DELETE') THEN
    RAISE EXCEPTION '0031 post-condition failed: authenticated can still write the platform defaults';
  END IF;

  IF has_table_privilege('anon', 'public.platform_approved_models', 'SELECT')
     OR has_table_privilege('anon', 'public.platform_model_defaults', 'SELECT')
     OR has_table_privilege('anon', 'public.workspace_model_overrides', 'SELECT')
     OR has_table_privilege('anon', 'public.user_model_overrides', 'SELECT') THEN
    RAISE EXCEPTION '0031 post-condition failed: anon retains SELECT on a model control-plane table';
  END IF;

  -- The seed has to be there or every picker ships empty.
  SELECT count(*) INTO n FROM public.platform_approved_models WHERE retired_at IS NULL;
  IF n < 4 THEN
    RAISE EXCEPTION '0031 post-condition failed: expected at least 4 live catalogue rows, found %', n;
  END IF;

  -- The extended audit constraint must accept a Session 20 action.
  BEGIN
    PERFORM 1 WHERE 'model.approved' IN (
      'workspace.created','workspace.renamed','workspace.suspended','workspace.restored',
      'workspace.teardown','blob.purged','ai_key.set','ai_key.cleared','operator.granted',
      'operator.revoked','model.approved','model.retired','model.restored',
      'model.default_set','model.default_cleared');
  END;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'platform_audit_action_check'
       AND pg_get_constraintdef(oid) LIKE '%model.approved%'
  ) THEN
    RAISE EXCEPTION '0031 post-condition failed: platform_audit still rejects the model.* actions';
  END IF;
END $$;
