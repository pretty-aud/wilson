-- =========================================================================
-- 0036_project_budget_settings.sql — Session 24.
--
-- The project-level budget settings the R.A.B.B.I.T. budget UI has always
-- read and has never been able to save, plus the per-project job title.
--
-- Idempotent: safe to re-run.
--
-- WHY THIS EXISTS
-- ---------------
-- Audrey reported: "the default contingency and margin come up as 0% and
-- updating the percentage doesn't save." That is not a save bug. MEASURED
-- 2026-08-03 against wilson-dev and wilson-staging: `public.projects` has 22
-- columns and NONE of the nine below is among them. There was nowhere to
-- save a percentage, and 0% is what an absent value renders as
-- (`BudgetView.jsx:342` — `Number(project.budget_margin_pct ?? 0) || 0`).
--
-- Same defect class as `tasks.asset_id` (0034) and `assets.start_date`
-- (0035): a UI built against main's local JSON project shape, on a cloud
-- table that never gained the fields.
--
-- 🚨 THE COLUMN NAMES ARE NOT WHAT THE PLANNING DOCS ASSUMED.
-- `MASTER_PLAN_S19_ONWARD.md` and `SESSION_24_prompt.md` both list the
-- missing columns as `margin` and `contingency`. The UI actually reads
-- `budget_margin_pct` and `budget_contingency_pct`, and it reads seven more
-- besides. Adding `projects.margin` would have satisfied the plan document
-- and left the reported bug fully intact — the percentage would still have
-- read 0% and still not saved. Every name below was taken from a grep of
-- the budget views, not from a document.
--
-- The full read sites, so the next session can re-verify rather than trust:
--   budget_margin_pct         BudgetView.jsx:342, CrewTeamTab.jsx:264,
--                             ClientViewTab.jsx:22
--   budget_contingency_pct    BudgetView.jsx:343, CrewTeamTab.jsx:265,
--                             ClientViewTab.jsx:23
--   budget_agency_enabled     BudgetView.jsx:344, :902, CrewTeamTab.jsx:257,
--                             useBudgetLines.js:231
--   budget_agency_pct         BudgetView.jsx:345, :903, CrewTeamTab.jsx:258,
--                             useBudgetLines.js:230
--   budget_actual_column_mode CrewTeamTab.jsx:259, TalentTab.jsx:308,
--                             written by ProjectSummaryView.jsx:669
--   budget_actual_column_count CrewTeamTab.jsx:260, TalentTab.jsx:309
--   budget_active             BudgetView.jsx:433, written :457/:467
--   budget_active_version_id  BudgetView.jsx:434, written :458/:468
--   budget_finalized          BudgetView.jsx:361, written :459/:469
--
-- `budget_active_version_id` is deliberately NOT given its FK here — the
-- table it points at (`public.budget_versions`) is created in 0037.
-- ORDERING: 0036 -> 0037. 0037 adds the FK.
--
-- WHY `project_title` IS A NEW COLUMN AND NOT `project_members.project_role`
-- -------------------------------------------------------------------------
-- Audrey: "you can have a company/title role AND a separate project role."
-- She means a job title on this project — "Lead Animator", "Comp
-- Supervisor" — free text a manager types.
--
-- 🚨 `project_members.project_role` is NOT that. It is a PERMISSION column
-- (`manager` | `member` | `reviewer`, 0013:44-45) read by
-- `project_role_for()` and through it by `can_write_project()`,
-- `can_comment_project()` and `can_manage_project_roster()` — the
-- SECURITY DEFINER helpers behind the RLS policies on tasks, assets,
-- comments and the roster. Writing "Lead Animator" into it would silently
-- fail every one of those gates and make controls vanish with no error,
-- which is exactly the failure S23 spent hours chasing.
--
-- Confirmed with Audrey 2026-08-03 before writing this: a separate field.
-- There are now four related concepts, and they are all distinct:
--   workspace_members.app_role       admin/manager/user — workspace permission
--   workspace_members.title          company job title
--   project_members.project_role     manager/member/reviewer — project permission
--   project_members.project_title    job title ON THIS PROJECT   <- new here
-- =========================================================================

-- ── 1. Project budget settings ───────────────────────────────────────────
--
-- Percentages are numeric(7,3), not float: this is money arithmetic and
-- binary floating point cannot represent 0.1. The CHECKs are deliberately
-- permissive (>= 0 only, no upper bound) — the UI already constrains to
-- 0..100, and a CHECK that rejects a legitimate figure in a money system is
-- worse than no CHECK at all.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS budget_margin_pct        NUMERIC(7,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS budget_contingency_pct   NUMERIC(7,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS budget_agency_pct        NUMERIC(7,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS budget_agency_enabled    BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS budget_actual_column_mode  TEXT       NOT NULL DEFAULT 'fortnightly',
  ADD COLUMN IF NOT EXISTS budget_actual_column_count INTEGER    NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS budget_active            BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS budget_active_version_id UUID,
  ADD COLUMN IF NOT EXISTS budget_finalized         BOOLEAN      NOT NULL DEFAULT false;

-- Constraints added separately so re-running is safe (ADD CONSTRAINT has no
-- IF NOT EXISTS in the Postgres versions this targets).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.projects'::regclass
       AND conname  = 'projects_budget_pct_nonneg'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_budget_pct_nonneg CHECK (
        budget_margin_pct      >= 0 AND
        budget_contingency_pct >= 0 AND
        budget_agency_pct      >= 0
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.projects'::regclass
       AND conname  = 'projects_budget_actual_column_mode_check'
  ) THEN
    -- The vocabulary is fixed by the existing UI, not invented here:
    -- ACTUALS_MODE_OPTIONS at ProjectSummaryView.jsx:669 and COLUMN_MODES at
    -- useBudgetLines.js:33-37 both list exactly these three.
    -- 'count' means "numbered columns, no dates" and pairs with
    -- budget_actual_column_count.
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_budget_actual_column_mode_check
        CHECK (budget_actual_column_mode IN ('fortnightly', 'weekly', 'count'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.projects'::regclass
       AND conname  = 'projects_budget_actual_column_count_check'
  ) THEN
    -- Upper bound is two years of weekly columns. The UI defaults to 20
    -- (CrewTeamTab.jsx:260). A grid this wide is already unusable; the bound
    -- exists to stop a typo rendering 100000 columns, not to express policy.
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_budget_actual_column_count_check
        CHECK (budget_actual_column_count > 0 AND budget_actual_column_count <= 104);
  END IF;
END $$;

COMMENT ON COLUMN public.projects.budget_margin_pct IS
  'Default margin % applied to every budget line that does not override it. Margin IS the profit: bid total minus actual cost. Read BudgetView.jsx:342, CrewTeamTab.jsx:264 (as a fallback for budget_lines.margin_pct), ClientViewTab.jsx:22 (shown to the client as "Production Fee", never as a percentage).';
COMMENT ON COLUMN public.projects.budget_contingency_pct IS
  'Default contingency % applied to every budget line that does not override it. Fallback, not a seed: budget_lines.contingency_pct NULL means "inherit this", and CrewTeamTab.jsx:439 resets a line by writing NULL back.';
COMMENT ON COLUMN public.projects.budget_agency_pct IS
  'Global agency fee %, applied to crew, talent and expenses unless a line sets agency_opt_out. Additive with a talent line''s own talent_agency_fee_pct (useBudgetLines.js:246-256) — they are separate concerns.';
COMMENT ON COLUMN public.projects.budget_agency_enabled IS
  'Whether budget_agency_pct applies at all. Separate flag so a rate can be kept on file while switched off.';
COMMENT ON COLUMN public.projects.budget_actual_column_mode IS
  'Pay-period cadence for the actuals grid: fortnightly | weekly | count. Actuals are entered per line item per period, so this decides what a column means. "count" = numbered columns with no dates, sized by budget_actual_column_count.';
COMMENT ON COLUMN public.projects.budget_actual_column_count IS
  'How many actuals columns to render. Only meaningful when budget_actual_column_mode = ''count''; the dated modes derive their own count from the project dates.';
COMMENT ON COLUMN public.projects.budget_active IS
  'True once a bid version has been activated (BudgetView.jsx:437-463). Locks the budget to budget_active_version_id.';
COMMENT ON COLUMN public.projects.budget_active_version_id IS
  'The budget_versions row this project is locked to. FK added in 0037, where the table is created. NULL while still bidding.';
COMMENT ON COLUMN public.projects.budget_finalized IS
  'The FINAL state: the budget has been reviewed and closed. Set together with budget_active by BudgetView.jsx:459.';

-- ── 2. Per-project job title ─────────────────────────────────────────────

ALTER TABLE public.project_members
  ADD COLUMN IF NOT EXISTS project_title TEXT;

COMMENT ON COLUMN public.project_members.project_title IS
  'Free-text JOB TITLE on this project — "Lead Animator", "Comp Supervisor". Manager-editable. 🚨 NOT a permission: that is project_role (manager/member/reviewer), which is read by project_role_for() and every RLS gate built on it. These two must never be conflated; writing a job title into project_role would silently break who can edit and who can see money.';

-- ── 3. Post-conditions ───────────────────────────────────────────────────
--
-- Scan for what should be true, rather than asserting the statements above
-- ran. A migration's text is not the database's state (S22).

DO $$
DECLARE
  v_missing TEXT;
  v_count   INT;
BEGIN
  -- 3a. Every column the budget UI reads now exists on projects.
  SELECT string_agg(c, ', ' ORDER BY c) INTO v_missing
    FROM unnest(ARRAY[
      'budget_margin_pct', 'budget_contingency_pct',
      'budget_agency_pct', 'budget_agency_enabled',
      'budget_actual_column_mode', 'budget_actual_column_count',
      'budget_active', 'budget_active_version_id', 'budget_finalized'
    ]) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'projects'
        AND column_name = c
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '0036 post-condition failed: projects still missing %', v_missing;
  END IF;

  -- 3b. The job title landed, and is NOT the permission column.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'project_members'
       AND column_name = 'project_title'
  ) THEN
    RAISE EXCEPTION '0036 post-condition failed: project_members.project_title missing';
  END IF;

  -- 3c. project_role is untouched — still text, still defaulted, still
  -- CHECK-constrained to the three permission values. If this ever fires,
  -- something rewrote the permission column and every RLS gate is suspect.
  SELECT count(*) INTO v_count
    FROM pg_constraint
   WHERE conrelid = 'public.project_members'::regclass
     AND contype  = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%project_role%'
     AND pg_get_constraintdef(oid) ILIKE '%manager%';
  IF v_count = 0 THEN
    RAISE EXCEPTION '0036 post-condition failed: the project_role CHECK constraint is gone — the permission column has been altered';
  END IF;

  -- 3d. The standing 0011/0033 privilege trap, for both touched tables.
  -- ALTER TABLE ADD COLUMN creates no new object, so this should be a no-op
  -- — but S21 proved that reasoning about what a migration does is not a
  -- substitute for querying what is there. Scan, do not assume.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public'
       AND table_name IN ('projects', 'project_members')
       AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION '0036 post-condition failed: anon holds privileges on projects or project_members';
  END IF;

  RAISE NOTICE '0036 OK: 9 budget settings on projects, project_title on project_members, project_role intact, anon clean.';
END $$;
