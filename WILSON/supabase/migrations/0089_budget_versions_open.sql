-- =============================================================================
-- 0089_budget_versions_open.sql — post-overhaul bundle S5 (2026-10-05).
--
-- Bid versions become LIVING DOCUMENTS. Audrey's F2 (2026-10-05, verbatim in
-- docs/design/POST_OVERHAUL_ANSWERS.md): "viewing a version is read-only. to
-- edit a version press "Edit this version": WILSON asks once to confirm, then
-- loads that version into the live Timeline and Budget and it becomes the
-- open version. while a version is open, Save writes the changes back INTO
-- that version ... a new version is only made on purpose with "Save as new
-- version", which asks for a name." The brief:
-- docs/sessions/briefs/po-s5-budget-versions.md, step 1.
--
-- THREE STATES, THREE WORDS (one per project each)
-- -------------------------------------------------
--   OPEN      projects.open_budget_version_id — NEW HERE. The version whose
--             data is in the live Timeline and Budget; Save writes back into
--             it. NULL = no version is open (the live schedule belongs to no
--             version yet).
--   SELECTED  budget_versions.is_active — the variance baseline. A misnamed
--             column (0037): it never meant "locked" and never meant "open".
--             Not renamed (the allowlist and 0037's policies read it); every
--             word written about it from S5 on says "selected".
--   LOCKED    projects.budget_active_version_id + budget_versions.locked_at /
--             locked_by (0036/0037) — "Budget active — in production". Not
--             touched here.
--
-- WHAT THIS ADDS
-- --------------
--   1. budget_versions UNIQUE (id, project_id) — the composite key a
--      same-project FK needs (0084 §1's reasoning: the pair proves the row is
--      in THIS project, a plain FK only that it exists somewhere).
--   2. projects.open_budget_version_id, with the composite FK
--      (open_budget_version_id, id) -> budget_versions (id, project_id)
--      ON DELETE SET NULL (open_budget_version_id) — 0084 §6a's shape for
--      active_shot_list_id. Deleting the open version closes it; it never
--      takes the project with it.
--   3. trg_projects_open_budget_version_guard. projects_update (0013) admits
--      every can_write_project caller — every MEMBER of the project — to every
--      column, and a member is not past the money gate (0037). The pointer
--      names a money row, so a CHANGE to it is refused unless the caller
--      passes can_access_project_money(project): a project manager or a
--      workspace admin (D8). The ordinary UPDATE policy still admits the write
--      for them; the guard narrows it. An unchanged value always passes (the
--      0049 rule: whole rows are re-sent), and so does the FK's own SET NULL
--      after the version row is gone.
--   4. select_budget_version(p_project, p_version) — the SELECTED bid in ONE
--      statement: the named version's is_active becomes true and every other
--      version of the project's false (NULL clears them all). Before this,
--      the client upserted every version in a loop (BudgetView's
--      setActiveVersion), which could leave two selected if it stopped half
--      way; only the dev fixtures cleared the previous one in one write.
--      SECURITY INVOKER: budget_versions' own policies (the money gate) apply
--      to the UPDATE; the explicit check up front only says so in words.
--
-- NOT HERE, ON PURPOSE
-- --------------------
--   * No new snapshot COLUMNS. What a version carries from S5 on (F1 phases,
--     task dates and key dates; F6 the span; F7 the totals with and before the
--     agency fee; F8's automatic line) grows the JSONB `snapshot`, which sits
--     under the money gate with the rest of the row (0037). The typed note is
--     0084's `summary` column, already there.
--   * No "one selected per project" unique index: rows written by the old
--     loop may hold two today, and an index would refuse to build there. The
--     RPC keeps it to one from here on; the client reads the newest selected.
--   * The lock (budget_active_version_id, locked_at, locked_by) is unchanged:
--     the client now writes locked_at / locked_by at activation (F12.2), under
--     the same policies.
--   * Realtime: projects rows are broadcast (0016), so another window sees
--     the pointer move; budget_versions are not broadcast (unchanged).
--
-- ORDERING — depends on: 0013 projects_update / can_write_project; 0036
--   projects.budget_* ; 0037 budget_versions + can_access_project_money;
--   0084 budget_versions.summary / shot_list_id (the pre-flight refuses
--   without them: the S5 client writes both). Independent of 0085, 0086,
--   0088. Nothing depends on this one yet.
-- Numbers: 0089 / suite 91 (supabase/tests/rls/91_budget_versions_open.sql).
-- 0087 and suite 89 were held for S3b and never used; 0079/0080 stay reserved
-- on paper. Next free after this: 0090 / suite 92.
-- Idempotent: guarded ALTERs, CREATE OR REPLACE, DROP-then-CREATE triggers.
-- =============================================================================


-- =============================================================================
-- 0. PRE-FLIGHT — refuse to run on a target that lacks what this file uses
-- =============================================================================
DO $$
BEGIN
  IF to_regclass('public.budget_versions') IS NULL THEN
    RAISE EXCEPTION '0089 pre-flight failed: public.budget_versions is missing — apply 0037 first';
  END IF;
  IF to_regprocedure('public.can_access_project_money(uuid)') IS NULL THEN
    RAISE EXCEPTION '0089 pre-flight failed: public.can_access_project_money(uuid) is missing — apply 0037 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'budget_versions'
                    AND column_name = 'summary') THEN
    RAISE EXCEPTION '0089 pre-flight failed: budget_versions.summary is missing — apply 0084 first';
  END IF;
END $$;


-- =============================================================================
-- 1. THE COMPOSITE KEY ON budget_versions
-- =============================================================================
-- `id` is the primary key, so (id, project_id) is trivially unique; it costs
-- one small index and lets the project's pointer be a same-project FK.
-- Guarded by pg_constraint rather than DROP-then-ADD: once the FK below
-- depends on it, a DROP would fail on a re-run (0084 §1's note).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.budget_versions'::regclass
                    AND conname = 'budget_versions_id_project_key') THEN
    ALTER TABLE public.budget_versions
      ADD CONSTRAINT budget_versions_id_project_key UNIQUE (id, project_id);
  END IF;
END $$;


-- =============================================================================
-- 2. projects.open_budget_version_id
-- =============================================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS open_budget_version_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.projects'::regclass
                    AND conname = 'projects_open_budget_version_fk') THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_open_budget_version_fk
      FOREIGN KEY (open_budget_version_id, id)
      REFERENCES public.budget_versions (id, project_id)
      ON DELETE SET NULL (open_budget_version_id);
  END IF;
END $$;

COMMENT ON COLUMN public.projects.open_budget_version_id IS
  '0089 (S5, Audrey''s F2): the project''s OPEN bid version — its data is in the live Timeline and Budget, and Save writes the live rows back into it. NULL = none open. Same-project composite FK, SET NULL when the version is deleted. Changed only by someone past the money gate (trg_projects_open_budget_version_guard). Not the SELECTED bid (budget_versions.is_active, the variance baseline) and not the LOCKED one (budget_active_version_id).';


-- =============================================================================
-- 3. THE GUARD — the pointer moves only for someone past the money gate
-- =============================================================================
-- 0084 §7b's shape. Only a CHANGE is examined (IS NOT DISTINCT FROM): a client
-- that sends a whole project row back with the pointer unchanged must not be
-- refused. The FK's own ON DELETE SET NULL runs an UPDATE here after the
-- version row is gone; clearing a pointer to a version that no longer exists
-- is never an authorisation question. SECURITY DEFINER so that existence
-- check does not depend on the caller's RLS (a member reads no versions at
-- all). can_access_project_money reads the caller's JWT claims, which a
-- definer body still sees.

CREATE OR REPLACE FUNCTION public.fn_projects_open_budget_version_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.open_budget_version_id IS NOT DISTINCT FROM OLD.open_budget_version_id THEN
    RETURN NEW;
  END IF;
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.open_budget_version_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.budget_versions v WHERE v.id = OLD.open_budget_version_id) THEN
    RETURN NEW;
  END IF;
  IF public.can_access_project_money(OLD.id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'the open bid version is changed only by someone who can see this project''s budget (a project manager or a workspace admin)'
    USING ERRCODE = '42501';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_projects_open_budget_version_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_projects_open_budget_version_guard ON public.projects;
CREATE TRIGGER trg_projects_open_budget_version_guard
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.fn_projects_open_budget_version_guard();

COMMENT ON FUNCTION public.fn_projects_open_budget_version_guard() IS
  '0089: projects.open_budget_version_id changes only for a caller past the money gate (can_access_project_money: a workspace admin or the project''s manager), for service_role, or when the FK clears a pointer to a version row that no longer exists. projects_update (0013) admits the write; this narrows it to the money gate, since a member passes projects_update but not the gate. An unchanged value always passes.';


-- =============================================================================
-- 4. select_budget_version — the SELECTED bid, in one statement
-- =============================================================================
-- p_version NULL clears the selection (F13: deleting the selected bid leaves
-- the dropdown on "Choose a bid version"; nothing is promoted). Returns the
-- selected id (NULL when cleared).

CREATE OR REPLACE FUNCTION public.select_budget_version(p_project UUID, p_version UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_project IS NULL THEN
    RAISE EXCEPTION 'select_budget_version: a project is required' USING ERRCODE = '22004';
  END IF;
  IF NOT public.can_access_project_money(p_project) THEN
    RAISE EXCEPTION 'the selected bid is chosen only by someone who can see this project''s budget (a project manager or a workspace admin)'
      USING ERRCODE = '42501';
  END IF;
  IF p_version IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.budget_versions v WHERE v.id = p_version AND v.project_id = p_project) THEN
    RAISE EXCEPTION 'bid version not found in this project' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.budget_versions
     SET is_active = (p_version IS NOT NULL AND id = p_version)
   WHERE project_id = p_project
     AND (is_active OR (p_version IS NOT NULL AND id = p_version));
  RETURN p_version;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.select_budget_version(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.select_budget_version(UUID, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.select_budget_version(UUID, UUID) IS
  '0089 (S5): makes one bid version the project''s SELECTED bid (budget_versions.is_active — the variance baseline, not the lock) and clears every other, in one UPDATE; NULL clears them all. SECURITY INVOKER: the money gate''s own policies apply; the up-front check says so in words (42501). A version of another project is not found (P0002).';


-- =============================================================================
-- 5. POST-CONDITIONS — scan the catalogue, do not assume (S22)
-- =============================================================================
DO $$
DECLARE
  v_confdel "char";
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'projects'
                    AND column_name = 'open_budget_version_id' AND data_type = 'uuid') THEN
    RAISE EXCEPTION '0089 post-condition failed: projects.open_budget_version_id (uuid) missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.budget_versions'::regclass
                    AND conname = 'budget_versions_id_project_key' AND contype = 'u') THEN
    RAISE EXCEPTION '0089 post-condition failed: budget_versions_id_project_key missing';
  END IF;
  SELECT confdeltype INTO v_confdel FROM pg_constraint
   WHERE conrelid = 'public.projects'::regclass AND conname = 'projects_open_budget_version_fk';
  IF v_confdel IS DISTINCT FROM 'n' THEN
    RAISE EXCEPTION '0089 post-condition failed: projects_open_budget_version_fk missing or not ON DELETE SET NULL';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.projects'::regclass
                    AND tgname = 'trg_projects_open_budget_version_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '0089 post-condition failed: trg_projects_open_budget_version_guard missing';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_projects_open_budget_version_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION '0089 post-condition failed: authenticated can execute the guard function';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'select_budget_version'
                    AND NOT p.prosecdef) THEN
    RAISE EXCEPTION '0089 post-condition failed: select_budget_version missing or not SECURITY INVOKER';
  END IF;
  IF has_function_privilege('anon', 'public.select_budget_version(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0089 post-condition failed: anon can execute select_budget_version';
  END IF;
  RAISE NOTICE '0089 OK: projects.open_budget_version_id (same-project FK, SET NULL, money-gated guard), select_budget_version (invoker).';
END $$;
