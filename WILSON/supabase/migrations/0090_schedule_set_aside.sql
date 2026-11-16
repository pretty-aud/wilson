-- =============================================================================
-- 0090_schedule_set_aside.sql — post-overhaul bundle S5b (2026-10-05).
--
-- Audrey's ruling of 2026-10-05 (docs/design/POST_OVERHAUL_ANSWERS.md, "the
-- open-version ruling"): asked what happens, when "Mid ROM v2" is opened, to
-- tasks on the Timeline that are not part of v2, she answered "(a)": they
-- leave the Timeline while v2 is open and come back when a version that
-- holds them is opened again — EACH VERSION SHOWS EXACTLY ITS OWN SCHEDULE.
-- The design: docs/sessions/handoffs/po-s5b-2026-10-05.md, "Step 0" (written
-- and committed before this file).
--
-- WHAT THIS ADDS
-- --------------
--   1. set_aside_at TIMESTAMPTZ on tasks, phases and milestones (key dates).
--      A row is LIVE (neither stamp), SET ASIDE (set_aside_at, no
--      deleted_at: the open version does not hold it; kept whole — its
--      comments, files, links, dependencies, assignments, logged days and
--      scene/shot links stay on it — never listed in a trash, never purged:
--      purge_soft_deleted and milestones_trash_index read deleted_at only),
--      or TRASHED (deleted_at). A trashed row is never also set aside.
--   2. trg_<table>_set_aside_guard (one SECURITY DEFINER function, three
--      triggers). Setting a row aside or bringing it back belongs to the bid
--      versions, which are the money gate's (D8: "only project admins can
--      access the budget"): a CHANGE of set_aside_at, or an INSERT carrying
--      one, needs can_access_project_money(project) or the service role.
--      An unchanged value always passes (whole rows are re-sent). Trashing a
--      row CLEARS its stamp, for anyone the trash admits, so a row taken out
--      of the trash comes back live.
--   3. set_aside_schedule_rows(p_project, p_on, p_tasks, p_phases,
--      p_milestones) — the one writer: the named rows of the three tables in
--      ONE transaction, trashed rows untouched, a row already in the asked
--      state untouched (its stamp kept). SECURITY INVOKER: the tables' own
--      UPDATE policies and the guard apply. Returns the stamp and the counts.
--   4. S5-01 — trg_projects_budget_settings_guard. MEASURED first (S5b,
--      rolled back on wilson-dev): projects_update (0013) admitted a project
--      MEMBER's change to every one of the nine budget columns 0036 added,
--      the lock included. They now change only past the money gate, in
--      0089 §3's shape (see §4 below).
--
-- NOT HERE, ON PURPOSE
-- --------------------
--   * No change to any SELECT policy. Filtering set-aside rows there would
--     repeat the soft-delete trap: the row could no longer be read back to be
--     brought back, and a plain PATCH of it would be refused. Every client
--     loader splits them out instead (the hand-off's reader table).
--   * No record of WHICH open set a row aside: nothing would read it (an
--     open's undo carries its own ids; "held only by this version" is
--     computed from the snapshots).
--   * No refusal while a budget is active: the client opens nothing then
--     (part 1's R1-10), and an undo of a version's delete must still be able
--     to put its rows back aside.
--   * budget_total and budget_currency (0000) are not guarded: the Projects
--     page shows and edits them for anyone who may edit the project, and a
--     trigger cannot hide a read. Audrey's to rule.
--
-- ORDERING — depends on: 0013 (projects_update), 0014 (deleted_at,
--   soft_delete_row, purge_soft_deleted), 0036 (projects.budget_*), 0037
--   (can_access_project_money, budget_versions), 0067 (milestones), 0089
--   (the S5 client's other half: the pre-flight refuses without it).
-- Numbers: 0090 / suite 92 (supabase/tests/rls/92_schedule_set_aside.sql).
-- 0087 and suite 89 were never used; 0079/0080 stay reserved on paper.
-- Next free after this: 0091 / suite 93.
-- Idempotent: guarded ALTERs, CREATE OR REPLACE, DROP-then-CREATE triggers.
-- =============================================================================


-- =============================================================================
-- 0. PRE-FLIGHT — refuse to run on a target that lacks what this file uses
-- =============================================================================
DO $$
BEGIN
  IF to_regprocedure('public.can_access_project_money(uuid)') IS NULL THEN
    RAISE EXCEPTION '0090 pre-flight failed: public.can_access_project_money(uuid) is missing — apply 0037 first';
  END IF;
  IF to_regclass('public.milestones') IS NULL THEN
    RAISE EXCEPTION '0090 pre-flight failed: public.milestones is missing — apply 0067 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'projects'
                    AND column_name = 'open_budget_version_id') THEN
    RAISE EXCEPTION '0090 pre-flight failed: projects.open_budget_version_id is missing — apply 0089 first';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name IN ('tasks', 'phases', 'milestones')
         AND column_name = 'deleted_at') <> 3 THEN
    RAISE EXCEPTION '0090 pre-flight failed: tasks, phases and milestones must each have deleted_at (0000 / 0067)';
  END IF;
END $$;


-- =============================================================================
-- 1. THE STAMP
-- =============================================================================

ALTER TABLE public.tasks      ADD COLUMN IF NOT EXISTS set_aside_at TIMESTAMPTZ;
ALTER TABLE public.phases     ADD COLUMN IF NOT EXISTS set_aside_at TIMESTAMPTZ;
ALTER TABLE public.milestones ADD COLUMN IF NOT EXISTS set_aside_at TIMESTAMPTZ;

COMMENT ON COLUMN public.tasks.set_aside_at IS
  '0090 (S5b, Audrey''s ruling (a) of 2026-10-05: each bid version shows exactly its own schedule): set when the OPEN bid version does not hold this task. The row is kept whole (comments, files, links, dependencies, assignments, logged_days, scene/shot links) and hidden by every client reader; it is never in a trash and never purged. Cleared when a version that holds it is opened. Changed only past the money gate (trg_tasks_set_aside_guard); trashing clears it.';
COMMENT ON COLUMN public.phases.set_aside_at IS
  '0090 (S5b): set when the OPEN bid version does not hold this phase. Kept whole, hidden by every client reader, never in a trash, never purged; cleared when a version that holds it is opened. Money-gated (trg_phases_set_aside_guard); trashing clears it.';
COMMENT ON COLUMN public.milestones.set_aside_at IS
  '0090 (S5b): set when the OPEN bid version does not hold this key date. Kept whole, hidden by every client reader, never in "Recently deleted" (milestones_trash_index reads deleted_at only), never purged; cleared when a version that holds it is opened. Money-gated (trg_milestones_set_aside_guard); trashing clears it.';


-- =============================================================================
-- 2. THE GUARD — set aside / bring back only past the money gate
-- =============================================================================
-- One function for the three tables (each has project_id). SECURITY DEFINER
-- so can_access_project_money and the trash rule do not depend on the
-- caller's RLS; it reads the caller's JWT claims, which a definer body still
-- sees. soft_delete_row is itself SECURITY DEFINER and passes through the
-- trash arm below before any authorisation question is asked.

CREATE OR REPLACE FUNCTION public.fn_schedule_set_aside_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A trashed row is never set aside: the trash wins and clears the stamp,
  -- so a restore brings the row back LIVE. No authorisation needed here —
  -- whoever the trash admitted may trash.
  IF NEW.deleted_at IS NOT NULL THEN
    NEW.set_aside_at := NULL;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.set_aside_at IS NOT DISTINCT FROM OLD.set_aside_at THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.set_aside_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.project_id IS NOT NULL AND public.can_access_project_money(NEW.project_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'a row is set aside or brought back only by someone who can see this project''s budget (a project manager or a workspace admin): the bid versions decide it'
    USING ERRCODE = '42501';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_schedule_set_aside_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tasks_set_aside_guard ON public.tasks;
CREATE TRIGGER trg_tasks_set_aside_guard
  BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.fn_schedule_set_aside_guard();

DROP TRIGGER IF EXISTS trg_phases_set_aside_guard ON public.phases;
CREATE TRIGGER trg_phases_set_aside_guard
  BEFORE INSERT OR UPDATE ON public.phases
  FOR EACH ROW EXECUTE FUNCTION public.fn_schedule_set_aside_guard();

DROP TRIGGER IF EXISTS trg_milestones_set_aside_guard ON public.milestones;
CREATE TRIGGER trg_milestones_set_aside_guard
  BEFORE INSERT OR UPDATE ON public.milestones
  FOR EACH ROW EXECUTE FUNCTION public.fn_schedule_set_aside_guard();

COMMENT ON FUNCTION public.fn_schedule_set_aside_guard() IS
  '0090 (S5b): tasks / phases / milestones.set_aside_at changes (or arrives on an INSERT) only for a caller past the money gate (can_access_project_money: a workspace admin or the project''s manager) or the service role. An unchanged value passes. A row being trashed (deleted_at set) has its stamp cleared, for anyone the trash admits: a trashed row is never also set aside.';


-- =============================================================================
-- 3. set_aside_schedule_rows — the one writer
-- =============================================================================
-- p_on true sets the named rows aside (now()), false brings them back. Rows
-- of another project, trashed rows, and rows already in the asked state are
-- untouched — an earlier stamp is kept. The three tables in one transaction:
-- an open that set aside some tasks and not their phase would leave a mix.

CREATE OR REPLACE FUNCTION public.set_aside_schedule_rows(
  p_project    UUID,
  p_on         BOOLEAN,
  p_tasks      UUID[] DEFAULT '{}',
  p_phases     UUID[] DEFAULT '{}',
  p_milestones UUID[] DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_at TIMESTAMPTZ := CASE WHEN p_on THEN now() ELSE NULL END;
  v_tasks INT;
  v_phases INT;
  v_milestones INT;
BEGIN
  IF p_project IS NULL OR p_on IS NULL THEN
    RAISE EXCEPTION 'set_aside_schedule_rows: a project and p_on are required' USING ERRCODE = '22004';
  END IF;
  IF NOT public.can_access_project_money(p_project) THEN
    RAISE EXCEPTION 'a row is set aside or brought back only by someone who can see this project''s budget (a project manager or a workspace admin): the bid versions decide it'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.tasks SET set_aside_at = v_at
   WHERE project_id = p_project AND id = ANY(COALESCE(p_tasks, '{}'::uuid[]))
     AND deleted_at IS NULL
     AND (CASE WHEN p_on THEN set_aside_at IS NULL ELSE set_aside_at IS NOT NULL END);
  GET DIAGNOSTICS v_tasks = ROW_COUNT;

  UPDATE public.phases SET set_aside_at = v_at
   WHERE project_id = p_project AND id = ANY(COALESCE(p_phases, '{}'::uuid[]))
     AND deleted_at IS NULL
     AND (CASE WHEN p_on THEN set_aside_at IS NULL ELSE set_aside_at IS NOT NULL END);
  GET DIAGNOSTICS v_phases = ROW_COUNT;

  UPDATE public.milestones SET set_aside_at = v_at
   WHERE project_id = p_project AND id = ANY(COALESCE(p_milestones, '{}'::uuid[]))
     AND deleted_at IS NULL
     AND (CASE WHEN p_on THEN set_aside_at IS NULL ELSE set_aside_at IS NOT NULL END);
  GET DIAGNOSTICS v_milestones = ROW_COUNT;

  RETURN jsonb_build_object('set_aside_at', v_at, 'tasks', v_tasks, 'phases', v_phases, 'milestones', v_milestones);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_aside_schedule_rows(UUID, BOOLEAN, UUID[], UUID[], UUID[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_aside_schedule_rows(UUID, BOOLEAN, UUID[], UUID[], UUID[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.set_aside_schedule_rows(UUID, BOOLEAN, UUID[], UUID[], UUID[]) IS
  '0090 (S5b): sets the named tasks / phases / key dates of one project aside (p_on) or brings them back, in one transaction; trashed rows and rows already in that state are untouched. SECURITY INVOKER: the tables'' UPDATE policies and trg_*_set_aside_guard apply; the up-front money check says so in words (42501). Returns {set_aside_at, tasks, phases, milestones}.';


-- =============================================================================
-- 4. S5-01 — THE BUDGET'S SETTINGS, changed only past the money gate
-- =============================================================================
-- MEASURED before this was written (S5b, 2026-10-05, a rolled-back probe on
-- wilson-dev as a project MEMBER, 21/21 collected): projects_update admitted,
-- and the row took, a change to every one of the nine columns 0036 added —
-- margin, contingency, agency % and on/off, the actuals mode and count, and
-- the lock (budget_active, budget_active_version_id, budget_finalized), set
-- and lifted. A reviewer was refused by projects_update itself. Only the
-- hidden Budget tab stood between a member and the budget (D8: "only project
-- admins can access the budget").
--
-- 0089 §3's shape: only a CHANGE is examined (a whole row re-sent with the
-- values unchanged passes; numeric 10 and 10.000 are not distinct), the
-- service role passes, and the lock FK's own ON DELETE SET NULL (0037)
-- passes when it clears a pointer to a version row that is gone and changes
-- nothing else. Everyone else needs can_access_project_money(project).
-- BEFORE UPDATE only: an INSERT is a new project (projects_insert: an admin
-- or a workspace manager), and the desktop-to-cloud copy inserts or skips.
--
-- The legitimate writers, by grep (2026-10-05): the Budget tab (margin,
-- contingency, agency, actuals, the lock — money-gated on screen), Project
-- settings' "Budget variables" (ProjectSummaryView, behind canSeeMoney), the
-- intake wizard (an INSERT), runMigration (insert-or-skip), and the
-- provider's bid-version composites (setProjectBudgetFields, past the gate).

CREATE OR REPLACE FUNCTION public.fn_projects_budget_settings_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_others_same BOOLEAN;
BEGIN
  v_others_same :=
        NEW.budget_margin_pct          IS NOT DISTINCT FROM OLD.budget_margin_pct
    AND NEW.budget_contingency_pct     IS NOT DISTINCT FROM OLD.budget_contingency_pct
    AND NEW.budget_agency_pct          IS NOT DISTINCT FROM OLD.budget_agency_pct
    AND NEW.budget_agency_enabled      IS NOT DISTINCT FROM OLD.budget_agency_enabled
    AND NEW.budget_actual_column_mode  IS NOT DISTINCT FROM OLD.budget_actual_column_mode
    AND NEW.budget_actual_column_count IS NOT DISTINCT FROM OLD.budget_actual_column_count
    AND NEW.budget_active              IS NOT DISTINCT FROM OLD.budget_active
    AND NEW.budget_finalized           IS NOT DISTINCT FROM OLD.budget_finalized;
  IF v_others_same AND NEW.budget_active_version_id IS NOT DISTINCT FROM OLD.budget_active_version_id THEN
    RETURN NEW;
  END IF;
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  -- The lock FK's own SET NULL (0037): a pointer that WAS set, to a version
  -- row that is gone, cleared with nothing else changed beside it.
  IF v_others_same
     AND OLD.budget_active_version_id IS NOT NULL
     AND NEW.budget_active_version_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.budget_versions v WHERE v.id = OLD.budget_active_version_id) THEN
    RETURN NEW;
  END IF;
  IF public.can_access_project_money(OLD.id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'the budget''s settings (margin, contingency, agency, actuals and the lock) are changed only by someone who can see this project''s budget (a project manager or a workspace admin)'
    USING ERRCODE = '42501';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_projects_budget_settings_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_projects_budget_settings_guard ON public.projects;
CREATE TRIGGER trg_projects_budget_settings_guard
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.fn_projects_budget_settings_guard();

COMMENT ON FUNCTION public.fn_projects_budget_settings_guard() IS
  '0090 (S5b, S5-01; D8): the nine budget settings 0036 added to projects (margin, contingency, agency % and on/off, actuals mode and count, budget_active, budget_active_version_id, budget_finalized) change only for a caller past the money gate (can_access_project_money), the service role, or the lock FK''s own SET NULL when the locked version row is gone. An unchanged value always passes. projects_update (0013) admits every member; this narrows those nine columns to the gate.';


-- =============================================================================
-- 5. POST-CONDITIONS — scan the catalogue, do not assume (S22)
-- =============================================================================
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['tasks', 'phases', 'milestones'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = t
                      AND column_name = 'set_aside_at'
                      AND data_type = 'timestamp with time zone') THEN
      RAISE EXCEPTION '0090 post-condition failed: %.set_aside_at (timestamptz) missing', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = format('public.%I', t)::regclass
                      AND tgname = format('trg_%s_set_aside_guard', t) AND NOT tgisinternal) THEN
      RAISE EXCEPTION '0090 post-condition failed: trg_%_set_aside_guard missing', t;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'fn_schedule_set_aside_guard' AND p.prosecdef) THEN
    RAISE EXCEPTION '0090 post-condition failed: fn_schedule_set_aside_guard missing or not SECURITY DEFINER';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_schedule_set_aside_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION '0090 post-condition failed: authenticated can execute the set-aside guard';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'set_aside_schedule_rows' AND NOT p.prosecdef) THEN
    RAISE EXCEPTION '0090 post-condition failed: set_aside_schedule_rows missing or not SECURITY INVOKER';
  END IF;
  IF has_function_privilege('anon', 'public.set_aside_schedule_rows(uuid, boolean, uuid[], uuid[], uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION '0090 post-condition failed: anon can execute set_aside_schedule_rows';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.projects'::regclass
                    AND tgname = 'trg_projects_budget_settings_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '0090 post-condition failed: trg_projects_budget_settings_guard missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'fn_projects_budget_settings_guard' AND p.prosecdef) THEN
    RAISE EXCEPTION '0090 post-condition failed: fn_projects_budget_settings_guard missing or not SECURITY DEFINER';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_projects_budget_settings_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION '0090 post-condition failed: authenticated can execute the budget settings guard';
  END IF;
  -- The trash is not the store (constraint 2): the purge and the key-date
  -- trash index still select on deleted_at alone.
  IF pg_get_functiondef('public.purge_soft_deleted(interval)'::regprocedure) ~* 'set_aside' THEN
    RAISE EXCEPTION '0090 post-condition failed: purge_soft_deleted reads set_aside_at — a set-aside row must never be purged';
  END IF;
  RAISE NOTICE '0090 OK: set_aside_at on tasks / phases / milestones (money-gated guard, trashing clears it), set_aside_schedule_rows (invoker), the budget settings guard (S5-01).';
END $$;
