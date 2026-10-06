-- =========================================================================
-- 0037_budget_system.sql — Session 24.
--
-- The five money tables, and the manager-only gate that guards them.
--
-- Idempotent: safe to re-run.
-- ORDERING: 0036 -> 0037. 0037 adds the FK for projects.budget_active_version_id,
--           which 0036 creates as a bare UUID because this table did not exist yet.
--
-- WHY THIS EXISTS
-- ---------------
-- MEASURED 2026-08-03 against a full census of all 36 public tables on
-- wilson-dev AND wilson-staging: there is no budget_lines, budget_actuals,
-- budget_versions or expenses table anywhere in the cloud schema. The entire
-- R.A.B.B.I.T. budget — bid, actuals, versions, expenses — exists only in
-- main's local JSON bundle (`budget.json`).
--
-- The React side, by contrast, is essentially COMPLETE and has been all
-- along. `useBudgetLines.js`, `CrewTeamTab.jsx`, `TalentTab.jsx`,
-- `ClientViewTab.jsx` and `BudgetView.jsx` already implement the whole model
-- Audrey specified. What is missing is the database underneath them and the
-- adapter between. Every column below was derived from what those files
-- actually read and write — there is no server-side schema to port from,
-- because the local Express routes spread `req.body` into a JSON array with
-- no validation at all (`electron/main.cjs:1094`).
--
-- THE MODEL — three states, computed differently, by different people
-- ------------------------------------------------------------------
--   BID     rate x days. Priced against a ROLE from the rate card before any
--           real person exists (tasks.assigned_role_slug x tasks.bid_days),
--           switching to that person's INTERNAL rate once they are assigned.
--           Talent is not modelled through tasks; its days are typed straight
--           into the budget.
--   ACTUAL  entered per PAY PERIOD, per line item — hence budget_actuals is a
--           line x period GRID, not a single number. External people are
--           entered by hand from invoices; internal staff will be filled in
--           later by a timecard system that does not exist yet. That system
--           writes into the same cells, distinguished by `source`.
--   FINAL   a locked snapshot for reviewing total cost and profit.
--           budget_versions.snapshot stores the percentages AS APPLIED, so
--           changing a default later cannot rewrite history.
--
-- Margin IS the profit: actual cost to the company is the line total minus
-- the margin and contingency added to it. Each line therefore stores enough
-- to reconstruct base cost, contingency and margin SEPARATELY — storing only
-- the marked-up total would make profit underivable.
--
-- 🚨 MARGIN AND CONTINGENCY ARE EACH APPLIED TO THE BASE, NOT COMPOUNDED.
-- MEASURED in the existing UI, three independent places that agree:
--   BudgetView.jsx:347-349   marginAmt = base * m; contAmt = base * c;
--                            grandTotal = base + marginAmt + contAmt
--   CrewTeamTab.jsx:332-333  marginAmt = bidTotal * m; contAmt = bidTotal * c
--   ClientViewTab.jsx:86-88  same shape
-- Contingency is NOT added first and then margined. Recorded here because a
-- budget that applies these in the wrong order is wrong in a way nobody
-- notices for months.
--
-- 🚨 PER-LINE PERCENTAGES ARE A FALLBACK, NOT A SEED.
-- budget_lines.margin_pct / contingency_pct are NULLABLE ON PURPOSE. NULL
-- means "inherit the project default". CrewTeamTab.jsx:330-331 resolves
-- `line.margin_pct != null ? line : projectDefault`, and :439 RESETS a line
-- by writing NULL back. Giving these columns `NOT NULL DEFAULT 0` would
-- silently sever every line from the project default and pin the whole
-- budget at 0% — the exact bug Audrey reported, reintroduced one layer down.
-- =========================================================================


-- ── 1. The money gate ────────────────────────────────────────────────────
--
-- Audrey, 2026-08-03: "only managers should see anything relating to money.
-- so actuals, bids, rates, etc. reviewers and team members should not see
-- financial values anywhere."
--
-- This CANNOT be done by hiding UI. Every R.A.B.B.I.T. table is reachable
-- through PostgREST with the caller's own JWT, so a team member who opens
-- devtools reads whatever RLS permits regardless of what React renders.
-- Hence a real policy on every table below.
--
-- CONFIRMED WITH AUDREY before writing: money = the project's managers, OR a
-- workspace admin. A workspace *manager* who holds only a project `member`
-- seat does NOT qualify — on wilson-staging that is `derek`, and he is the
-- reason this had to be asked rather than assumed.
--
-- 🚨 Deliberately UNLIKE can_write_project(). That helper opens with
-- `NOT project_is_staffed(p_project)` (0013:119-121), so on an unstaffed
-- project every active member passes. Money must fail CLOSED, so there is no
-- such arm here. can_manage_project_roster (0013:133-139) is the shape this
-- follows — except that it also admits workspace managers, which Audrey
-- explicitly excluded.
--
-- 🚨 The workspace check is not decoration. current_app_role() reads an
-- app_metadata claim from the caller's JWT and says nothing about WHICH
-- workspace they administer. Without the projects/workspace_id test below,
-- an admin of workspace B would satisfy `current_app_role() = 'admin'` for a
-- project in workspace A and read its entire budget. has_active_membership()
-- reads the live workspace_members row rather than the claim, so a
-- deactivated admin loses access without waiting for a token refresh.

CREATE OR REPLACE FUNCTION public.can_access_project_money(p_project UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.projects p
            WHERE p.id = p_project
              AND p.workspace_id = public.current_workspace_id()
              AND public.has_active_membership(p.workspace_id)
         )
     AND (
           public.current_app_role() = 'admin'
        OR public.project_role_for(p_project) = 'manager'
         );
$$;

COMMENT ON FUNCTION public.can_access_project_money(UUID) IS
  'The money gate: TRUE only for a workspace admin of the project''s own workspace, or a project_members row with project_role = manager. Deliberately has NO unstaffed-project opening — unlike can_write_project() — because money fails closed. Guards budget_lines, budget_actuals, budget_versions, expenses and project_rate_overrides, for both read and write.';

-- Functions carry a bare =X/postgres aclitem, so naming only anon is a
-- silent no-op. Revoke from PUBLIC as well (the S22 lesson, 0033:190-191).
REVOKE EXECUTE ON FUNCTION public.can_access_project_money(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_access_project_money(UUID) TO authenticated, service_role;


-- ── 2. budget_versions ───────────────────────────────────────────────────
--
-- A named snapshot of a bid. `snapshot` stores the tasks, the resolved
-- roleRates and the percentages AS THEY WERE (BudgetView.jsx:367-378,
-- enriched at :440-450), which is what makes "final" immutable in substance:
-- re-reading percentages live would let a later default edit rewrite a
-- closed project's history.

CREATE TABLE IF NOT EXISTS public.budget_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES public.projects(id)   ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'bid'
                  CHECK (type IN ('bid', 'actual', 'final')),
  is_active     BOOLEAN NOT NULL DEFAULT false,
  snapshot      JSONB   NOT NULL DEFAULT '{}'::jsonb,
  locked_at     TIMESTAMPTZ,
  locked_by     UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID
);

CREATE INDEX IF NOT EXISTS budget_versions_project_idx
  ON public.budget_versions (project_id);

COMMENT ON TABLE public.budget_versions IS
  'Named bid snapshots. The project locks to one via projects.budget_active_version_id. snapshot holds the tasks, roleRates and the margin/contingency percentages as applied at the time, so history cannot be rewritten by editing a default later.';


-- ── 3. budget_lines ──────────────────────────────────────────────────────
--
-- One row per costed thing: a crew member or role, a talent booking, or an
-- expense/travel row. `sheet` selects which tab owns it.

CREATE TABLE IF NOT EXISTS public.budget_lines (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id             UUID NOT NULL REFERENCES public.projects(id)   ON DELETE CASCADE,
  workspace_id           UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  sheet                  TEXT NOT NULL DEFAULT 'crew'
                           CHECK (sheet IN ('crew', 'talent', 'expenses_travel')),
  department             TEXT,
  sort_order             INTEGER NOT NULL DEFAULT 0,
  label                  TEXT,
  description            TEXT,
  is_section_header      BOOLEAN NOT NULL DEFAULT false,

  -- Who / what this line prices.
  team_member_id         UUID,
  role_slug              TEXT,

  -- The bid arithmetic: rate x days x qty (crew/talent), cost x days x qty
  -- (expenses). useBudgetLines.js:236-244.
  rate                   NUMERIC(14,2) NOT NULL DEFAULT 0,
  days                   NUMERIC(10,2) NOT NULL DEFAULT 0,
  qty                    NUMERIC(10,2) NOT NULL DEFAULT 1,
  cost                   NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_na_days             BOOLEAN NOT NULL DEFAULT false,
  is_na_qty              BOOLEAN NOT NULL DEFAULT false,

  -- NULL means "inherit the project default". See the header warning.
  margin_pct             NUMERIC(7,3),
  contingency_pct        NUMERIC(7,3),

  -- Agency fees. The global project fee applies unless opted out; a talent
  -- line's own rep fee is ADDITIVE on top (useBudgetLines.js:246-256).
  agency_opt_out         BOOLEAN NOT NULL DEFAULT false,
  talent_agency_fee_pct  NUMERIC(7,3),

  -- Talent booking detail (TalentTab.jsx).
  talent_type            TEXT,
  agent_name             TEXT,
  agency_name            TEXT,
  email                  TEXT,
  phone                  TEXT,
  union_id               TEXT,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by             UUID,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by             UUID,

  CONSTRAINT budget_lines_pct_nonneg CHECK (
    (margin_pct            IS NULL OR margin_pct            >= 0) AND
    (contingency_pct       IS NULL OR contingency_pct       >= 0) AND
    (talent_agency_fee_pct IS NULL OR talent_agency_fee_pct >= 0)
  )
);

CREATE INDEX IF NOT EXISTS budget_lines_project_idx
  ON public.budget_lines (project_id);
CREATE INDEX IF NOT EXISTS budget_lines_project_sheet_idx
  ON public.budget_lines (project_id, sheet);

COMMENT ON TABLE public.budget_lines IS
  'One costed row per crew member/role, talent booking or expense line. Base cost, contingency and margin are stored separately so "actual cost to the company" (line total minus margin and contingency) stays derivable and profit can be computed.';
COMMENT ON COLUMN public.budget_lines.margin_pct IS
  'NULL means INHERIT projects.budget_margin_pct. Nullable on purpose — CrewTeamTab.jsx:330 resolves the fallback and :439 resets a line by writing NULL. A NOT NULL DEFAULT 0 here would pin every line at 0%.';
COMMENT ON COLUMN public.budget_lines.contingency_pct IS
  'NULL means INHERIT projects.budget_contingency_pct. See margin_pct.';
COMMENT ON COLUMN public.budget_lines.team_member_id IS
  'The person this line prices. Intentionally NO foreign key: on cloud this is a workspace_members.user_id, on Local Server it is a local team_members.id, and the same UI serves both adapters. Adding an FK would break adapter parity.';
COMMENT ON COLUMN public.budget_lines.role_slug IS
  'The rate-card role this line prices when no real person is assigned yet — the BID case. Matches rate_card_entries.role_slug and tasks.assigned_role_slug. Assigning a person switches the line to their internal rate (CrewTeamTab.jsx:315-319 prefers wage over day_rate).';


-- ── 4. budget_actuals ────────────────────────────────────────────────────
--
-- The line x pay-period GRID. One row IS one cell. `column_index` is the
-- period ordinal; what a period means comes from
-- projects.budget_actual_column_mode.
--
-- Built so the future timecard system can write internal staff totals into
-- the same cells the production team types external invoice totals into —
-- `source` is what tells them apart. That system is explicitly NOT built
-- here (Audrey: "this is for after we finish all our sessions").

CREATE TABLE IF NOT EXISTS public.budget_actuals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES public.projects(id)      ON DELETE CASCADE,
  workspace_id     UUID NOT NULL REFERENCES public.workspaces(id)    ON DELETE CASCADE,
  line_id          UUID NOT NULL REFERENCES public.budget_lines(id)  ON DELETE CASCADE,
  column_index     INTEGER NOT NULL CHECK (column_index >= 0),
  value            NUMERIC(14,2) NOT NULL DEFAULT 0,
  invoice_number   TEXT,
  expense_id       UUID,
  source           TEXT NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual', 'timecard', 'expense')),
  notes            TEXT,
  attachment_name  TEXT,
  attachment_path  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       UUID,

  -- One cell per line per period. The UI already upserts by finding the
  -- existing cell first (CrewTeamTab.jsx:411, TalentTab.jsx:351), so this
  -- constraint matches the intended behaviour and turns a double-write into
  -- a loud error instead of two silently disagreeing values for one period.
  CONSTRAINT budget_actuals_line_column_uniq UNIQUE (line_id, column_index)
);

CREATE INDEX IF NOT EXISTS budget_actuals_project_idx
  ON public.budget_actuals (project_id);
CREATE INDEX IF NOT EXISTS budget_actuals_line_idx
  ON public.budget_actuals (line_id);

COMMENT ON TABLE public.budget_actuals IS
  'The actuals grid: one row per budget line per pay period. Actuals are NOT derived from tasks.logged_days — external people are entered by hand from invoices, and internal staff will later be written here by a timecard system, distinguished by source.';
COMMENT ON COLUMN public.budget_actuals.source IS
  'manual = typed by the production team from an invoice. timecard = written by the future time-tracking system (not built). expense = carried from an expenses row.';


-- ── 5. expenses ──────────────────────────────────────────────────────────
--
-- ONE row carries BOTH the bid figure and the actual figure
-- (estimated_cost / actual_cost), which is how useExpenses.js:103-104
-- already models it — not two separate sets of rows.

CREATE TABLE IF NOT EXISTS public.expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES public.projects(id)   ON DELETE CASCADE,
  workspace_id    UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title           TEXT NOT NULL DEFAULT '',
  description     TEXT,
  estimated_cost  NUMERIC(14,2) NOT NULL DEFAULT 0,
  actual_cost     NUMERIC(14,2) NOT NULL DEFAULT 0,
  purchase_date   DATE,
  asset_ids       UUID[] NOT NULL DEFAULT '{}',
  phase_ids       UUID[] NOT NULL DEFAULT '{}',
  task_ids        UUID[] NOT NULL DEFAULT '{}',
  file_ids        UUID[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID
);

CREATE INDEX IF NOT EXISTS expenses_project_idx
  ON public.expenses (project_id);

COMMENT ON TABLE public.expenses IS
  'Project expenses. One row carries both the bid figure (estimated_cost) and what it really cost (actual_cost) — the same row, two columns, matching useExpenses.js. purchase_date is a real DATE, so the adapter must convert the UI''s empty-string default to NULL.';


-- ── 6. project_rate_overrides ────────────────────────────────────────────
--
-- 🚨 THE ONE GENUINELY NEW IDEA IN THIS MIGRATION, and the most important.
--
-- Audrey, twice, for both real people and bid roles:
--   "when a manager makes a change on the rate card in a project that is
--    going to be project specific meaning the managers change should not
--    change the internal rate card. some projects will have different rates
--    for people."
--
-- rate_cards / rate_card_entries are WORKSPACE-level. Today the budget reads
-- rates straight off them (BudgetView.jsx:142-151 builds roleRates from
-- rateCard.entries), so a manager editing a rate inside a project would
-- rewrite that rate for EVERY other project in the company — silently, with
-- no record of what the other projects' numbers used to be. That is a
-- data-integrity failure that would be very hard to notice and impossible to
-- reconstruct afterwards.
--
-- This table is the override layer. Resolution order is:
--     project override  ->  workspace rate card  ->  blank
--
-- Keyed by role_slug for an unstaffed BID line, and by member_id once a real
-- person holds the line. Exactly one of the two is set per row.

CREATE TABLE IF NOT EXISTS public.project_rate_overrides (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES public.projects(id)   ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  role_slug     TEXT,
  member_id     UUID,

  day_rate      NUMERIC(14,2),
  week_rate     NUMERIC(14,2),
  month_rate    NUMERIC(14,2),
  wage          NUMERIC(14,2),
  currency      TEXT NOT NULL DEFAULT 'USD',
  notes         TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID,

  -- A row must override SOMETHING. Both set is also rejected: a row keyed by
  -- both a role and a person has no single resolution order and would make
  -- the lookup ambiguous.
  CONSTRAINT project_rate_overrides_target_chk CHECK (
    (role_slug IS NOT NULL AND member_id IS NULL) OR
    (role_slug IS NULL     AND member_id IS NOT NULL)
  )
);

-- Partial uniques: one override per role per project, one per person per
-- project. Without these a second override row would shadow the first
-- non-deterministically and the same project would price differently
-- depending on row order.
CREATE UNIQUE INDEX IF NOT EXISTS project_rate_overrides_role_uniq
  ON public.project_rate_overrides (project_id, role_slug)
  WHERE role_slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS project_rate_overrides_member_uniq
  ON public.project_rate_overrides (project_id, member_id)
  WHERE member_id IS NOT NULL;

COMMENT ON TABLE public.project_rate_overrides IS
  'Project-scoped rate overrides. A rate edited inside a project lands HERE and must never write back to rate_cards / rate_card_entries, which are workspace-wide. Resolution: project override -> workspace rate card -> blank. Without this table, negotiating one project''s rate would silently rewrite every other project''s numbers.';
COMMENT ON COLUMN public.project_rate_overrides.member_id IS
  'A real person (workspace_members.user_id on cloud). No FK, for the same adapter-parity reason as budget_lines.team_member_id.';
COMMENT ON COLUMN public.project_rate_overrides.wage IS
  'The INTERNAL rate. Audrey: the external/day rate is mainly a bidding instrument; once a real person is assigned the line switches to their internal rate.';


-- ── 7. Close the FK 0036 could not create ────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.projects'::regclass
       AND conname  = 'projects_budget_active_version_id_fkey'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_budget_active_version_id_fkey
      FOREIGN KEY (budget_active_version_id)
      REFERENCES public.budget_versions(id) ON DELETE SET NULL;
  END IF;
END $$;


-- ── 8. Workspace stamping ────────────────────────────────────────────────
--
-- workspace_id is NOT NULL on all five tables, but no client sends it — the
-- same arrangement tasks/phases/assets already use. Reuse 0004's trigger
-- rather than a new one; it is LANGUAGE plpgsql and NOT SECURITY DEFINER,
-- which is the precondition for FORCE ROW LEVEL SECURITY below (0031:142-143).

DROP TRIGGER IF EXISTS trg_budget_versions_populate_workspace ON public.budget_versions;
CREATE TRIGGER trg_budget_versions_populate_workspace
  BEFORE INSERT ON public.budget_versions
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_from_project();

DROP TRIGGER IF EXISTS trg_budget_lines_populate_workspace ON public.budget_lines;
CREATE TRIGGER trg_budget_lines_populate_workspace
  BEFORE INSERT ON public.budget_lines
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_from_project();

DROP TRIGGER IF EXISTS trg_budget_actuals_populate_workspace ON public.budget_actuals;
CREATE TRIGGER trg_budget_actuals_populate_workspace
  BEFORE INSERT ON public.budget_actuals
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_from_project();

DROP TRIGGER IF EXISTS trg_expenses_populate_workspace ON public.expenses;
CREATE TRIGGER trg_expenses_populate_workspace
  BEFORE INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_from_project();

DROP TRIGGER IF EXISTS trg_project_rate_overrides_populate_workspace ON public.project_rate_overrides;
CREATE TRIGGER trg_project_rate_overrides_populate_workspace
  BEFORE INSERT ON public.project_rate_overrides
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_from_project();

-- updated_at maintenance, same helper the rest of the schema uses.
DROP TRIGGER IF EXISTS trg_budget_versions_touch ON public.budget_versions;
CREATE TRIGGER trg_budget_versions_touch
  BEFORE UPDATE ON public.budget_versions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_budget_lines_touch ON public.budget_lines;
CREATE TRIGGER trg_budget_lines_touch
  BEFORE UPDATE ON public.budget_lines
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_budget_actuals_touch ON public.budget_actuals;
CREATE TRIGGER trg_budget_actuals_touch
  BEFORE UPDATE ON public.budget_actuals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_expenses_touch ON public.expenses;
CREATE TRIGGER trg_expenses_touch
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_project_rate_overrides_touch ON public.project_rate_overrides;
CREATE TRIGGER trg_project_rate_overrides_touch
  BEFORE UPDATE ON public.project_rate_overrides
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ── 9. RLS ───────────────────────────────────────────────────────────────
--
-- Four separate policies per table, never FOR ALL: a broad FOR ALL arm ORs
-- with every narrow arm beside it and silently wins, which is precisely what
-- 0029 exists to undo and what cost S15 a CRITICAL.
--
-- UPDATE carries both USING and WITH CHECK with the same predicate,
-- otherwise a manager could repoint a row at a project they do not control.
--
-- The row's own workspace_id is checked alongside the helper, as
-- defence in depth: the helper already resolves the workspace through
-- projects, so a row whose workspace_id disagreed with its project would be
-- unreachable rather than mis-served.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'budget_versions', 'budget_lines', 'budget_actuals',
    'expenses', 'project_rate_overrides'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR SELECT
        USING (workspace_id = public.current_workspace_id()
               AND public.can_access_project_money(project_id))
    $f$, t || '_select', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR INSERT
        WITH CHECK (workspace_id = public.current_workspace_id()
                    AND public.can_access_project_money(project_id))
    $f$, t || '_insert', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR UPDATE
        USING (workspace_id = public.current_workspace_id()
               AND public.can_access_project_money(project_id))
        WITH CHECK (workspace_id = public.current_workspace_id()
                    AND public.can_access_project_money(project_id))
    $f$, t || '_update', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR DELETE
        USING (workspace_id = public.current_workspace_id()
               AND public.can_access_project_money(project_id))
    $f$, t || '_delete', t);

    -- The 0011/0033 grant shape. anon reaches nothing; authenticated gets
    -- exactly the four DML privileges and none of the structural ones.
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;


-- ── 10. Post-conditions ──────────────────────────────────────────────────
--
-- Scan every object rather than the list that was written above. The list is
-- what would miss something; the scan is what catches it (S22).

DO $$
DECLARE
  t          TEXT;
  v_tables   TEXT[] := ARRAY['budget_versions', 'budget_lines', 'budget_actuals',
                             'expenses', 'project_rate_overrides'];
  v_n        INT;
BEGIN
  FOREACH t IN ARRAY v_tables LOOP
    -- 10a. exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = t) THEN
      RAISE EXCEPTION '0037 post-condition failed: table % missing', t;
    END IF;

    -- 10b. RLS enabled AND forced
    SELECT count(*) INTO v_n FROM pg_class
      WHERE oid = ('public.' || t)::regclass
        AND relrowsecurity AND relforcerowsecurity;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '0037 post-condition failed: % lacks ENABLE+FORCE row level security', t;
    END IF;

    -- 10c. exactly four policies, none of them FOR ALL
    SELECT count(*) INTO v_n FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND cmd = 'ALL';
    IF v_n <> 0 THEN
      RAISE EXCEPTION '0037 post-condition failed: % has a FOR ALL policy, which ORs with and defeats the narrow arms', t;
    END IF;
    SELECT count(*) INTO v_n FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t;
    IF v_n <> 4 THEN
      RAISE EXCEPTION '0037 post-condition failed: % has % policies, expected 4', t, v_n;
    END IF;

    -- 10d. anon holds nothing. Scanned per table, not assumed from the
    -- REVOKE having been written.
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema = 'public' AND table_name = t AND grantee = 'anon') THEN
      RAISE EXCEPTION '0037 post-condition failed: anon holds privileges on %', t;
    END IF;

    -- 10e. the workspace stamp is armed, or every insert fails NOT NULL
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = ('public.' || t)::regclass
                      AND NOT tgisinternal
                      AND tgname = 'trg_' || t || '_populate_workspace') THEN
      RAISE EXCEPTION '0037 post-condition failed: % has no workspace-stamping trigger', t;
    END IF;
  END LOOP;

  -- 10f. the money gate exists and anon cannot execute it. A SECURITY
  -- DEFINER function reachable by anon is a pre-auth RLS bypass served at
  -- /rest/v1/rpc/ — the live hole S22 found on seven functions.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'can_access_project_money'
  ) THEN
    RAISE EXCEPTION '0037 post-condition failed: can_access_project_money missing';
  END IF;
  IF has_function_privilege('anon', 'public.can_access_project_money(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0037 post-condition failed: anon can execute can_access_project_money';
  END IF;

  -- 10g. the FK 0036 deferred
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.projects'::regclass
       AND conname  = 'projects_budget_active_version_id_fkey'
  ) THEN
    RAISE EXCEPTION '0037 post-condition failed: projects.budget_active_version_id has no FK';
  END IF;

  -- 10h. the fallback semantics survived. If either of these ever became
  -- NOT NULL, every budget line would silently stop inheriting the project
  -- default and pin itself at whatever default was imposed.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'budget_lines'
       AND column_name IN ('margin_pct', 'contingency_pct')
       AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION '0037 post-condition failed: budget_lines.margin_pct/contingency_pct must stay NULLABLE — NULL is how a line inherits the project default';
  END IF;

  RAISE NOTICE '0037 OK: 5 money tables, RLS enabled+forced with 4 policies each, anon clean, money gate armed.';
END $$;
