-- =========================================================================
-- 0067_milestones.sql — Track A, bundle A2, session 2.
--
-- `public.milestones`: the last R.A.B.B.I.T. entity with no cloud table, plus
-- the trash + restore path Audrey's ruling 38 asks for.
--
-- Idempotent: safe to re-run.
-- ORDERING: depends on 0004 (fn_populate_workspace_from_project,
--           touch_updated_at), 0013 (can_write_project), 0014 (the whole
--           soft-delete machinery this file extends) and 0024 (the trash-index
--           idiom the listing function copies). Nothing depends on it yet.
--
-- WHY THIS EXISTS
-- ---------------
-- Audrey, ruling 26: build cloud milestones "like scenes and levels got"
-- (0040). Ruling 38: milestone delete gets trash + undo. MASTER_PLAN.md §6 #5
-- has carried "milestones / scenes / levels / experiences have no cloud
-- tables" since S2 and #10 has carried "milestones have no undo path (kept
-- confirm dialog)"; 0040 closed three quarters of #5 and this file closes the
-- rest of both.
--
-- MEASURED on the working tree, 2026-09-07 (not remembered):
--   * supabaseAdapter.js's Milestones block is two throws —
--     `upsertMilestone` / `deleteMilestone` both raise "[supabase] milestones
--     table not yet created — use local_server adapter". There is no list
--     method and no `milestones` key in loadProject.
--   * localServerAdapter.js DOES have all three (its list reads the project
--     bundle's `milestones` array), and its loadProject carries the key —
--     with S17's comment above it, because omitting it dropped every
--     milestone on load (§6 #47, the real data loss).
--   * electron/main.cjs registers `rabbitSubentityRoutes('milestones',
--     'milestones')` — the plain form, no dependency sweep, correctly: a
--     milestone is not a dependency endpoint.
--   * RabbitProvider.jsx already has addMilestone / updateMilestone /
--     deleteMilestone with an undo/redo history entry, and EMPTY_BUNDLE
--     carries `milestones: []`.
--
-- So the client half of milestones is real and working on ONE adapter. This
-- migration is what makes the other adapter's methods implementable.
--
-- THE COLUMNS ARE THE ONES THE WRITER WRITES, derived by reading the writer
-- rather than by inventing a schema — the S24 (`margin` vs
-- `budget_margin_pct`) and S25 (`code` vs `project_code`) lesson, twice
-- learned. TimelineView.jsx's editor save builds exactly this payload for
-- mode 'milestone':
--     { title, date, color, description, phase_id }
-- and RabbitProvider.addMilestone adds `id` and `project_id`. The desktop's
-- rabbitTouch stamps `created_at` and `updated_at`. Nothing else is ever
-- written by any surface in the app, so nothing else is a column here beyond
-- the workspace/audit/trash spine every RABBIT table carries.
--
-- `date` is a Postgres col_name_keyword: legal unquoted as a column name,
-- which is why it can stay `date` — and it MUST stay `date`, because that is
-- the key the editor's payload uses. Renaming it here would leave the write
-- landing in a column nothing reads, which is the exact failure mode the two
-- lessons above describe.
--
-- 🚨 THE S23 TRAP — WHY milestones_select HOPS TO THE PROJECT.
-- ------------------------------------------------------------
-- `phase_id` is NULLABLE. TimelineView's editor writes `draft.phase_id || null`
-- and its "new milestone" affordance opens with no phase at all, so an
-- unparented milestone is a real, displayed state — it is drawn on the
-- timeline by its DATE, not by its phase.
--
-- 0014 gave tasks_select an `EXISTS (SELECT 1 FROM assets …)` arm and a task
-- with no asset then failed its own SELECT policy: the row inserted, the
-- returning read matched nothing, and `.single()` answered PGRST116. 0040's
-- shots_select was written to avoid the repeat. This is the third time, and
-- the answer is the same: the live-parent EXISTS below hops to the PROJECT,
-- never to the phase. A milestone attached to a soft-deleted phase stays
-- visible, which is also what the timeline should do — the milestone has its
-- own date.
--
-- `phase_id` is ON DELETE SET NULL, matching `files`' loose attachments
-- (0014 §2: "a file outlives those parents"). A milestone outlives its phase:
-- a hard-deleted phase must not silently take a dated milestone with it.
--
-- WHAT THIS FILE DOES NOT DO
-- --------------------------
-- Milestones are NOT added to the realtime broadcast (0016) or to edit-history
-- capture (0012). MASTER_PLAN §6 #5 records both gaps for all four entities;
-- 0040 did not close them for scenes/shots/levels/experiences either, and
-- closing them for one entity alone would be a new inconsistency rather than
-- parity. The row lands, the trash works, and a second window sees it on its
-- next project load — the same contract scenes have had since S25.
-- =========================================================================


-- ── 1. the table ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.milestones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES public.projects(id)   ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Nullable on purpose; see the S23 trap in the header.
  phase_id      UUID REFERENCES public.phases(id) ON DELETE SET NULL,

  title         TEXT,
  date          DATE,
  color         TEXT,
  description   TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID,

  -- Trash from day one (ruling 38). 0014's machinery is extended in §5 rather
  -- than duplicated, so a milestone leaves and re-enters the trash through the
  -- same two RPCs every other RABBIT row uses.
  deleted_at    TIMESTAMPTZ,
  deleted_by    UUID
);

-- `title` and `date` are NOT NULL-constrained at the database, deliberately.
-- The editor already refuses an empty title or date with its own message
-- ("Milestone title is required." / "Milestone date is required."), and a
-- NOT NULL here would turn a partial patch — RabbitProvider.updateMilestone
-- re-sends the whole row, but a future partial writer would not — into a
-- 23502 the UI has no copy for. The invariants worth enforcing at this layer
-- are the foreign keys and the workspace, and those are enforced.

CREATE INDEX IF NOT EXISTS milestones_project_idx
  ON public.milestones (project_id);
CREATE INDEX IF NOT EXISTS milestones_phase_idx
  ON public.milestones (phase_id);
-- Partial index matching milestones_select's predicate, the 0014 §3 pattern.
CREATE INDEX IF NOT EXISTS milestones_live_project_idx
  ON public.milestones (project_id) WHERE deleted_at IS NULL;
-- Drives milestones_trash_index() and purge_soft_deleted()'s new loop arm.
CREATE INDEX IF NOT EXISTS milestones_trashed_idx
  ON public.milestones (project_id, deleted_at) WHERE deleted_at IS NOT NULL;

COMMENT ON TABLE public.milestones IS
  'Dated markers on a project timeline (TimelineView.jsx). Soft-delete from day one — ruling 38 — through 0014''s soft_delete_row/restore_soft_deleted, whose allowlist this migration extends. Not broadcast and not edit-history captured, the same limit scenes/levels/experiences carry (MASTER_PLAN §6 #5).';
COMMENT ON COLUMN public.milestones.phase_id IS
  'Optional owning phase, or NULL for a milestone that sits on the timeline by date alone. NULLABLE ON PURPOSE: milestones_select hops to the PROJECT, never to the phase — the tasks_select/asset_id trap from S23 and the shots_select/scene_id repeat from 0040. ON DELETE SET NULL because a milestone outlives its phase.';
COMMENT ON COLUMN public.milestones.date IS
  'The date the milestone marks. Named `date` because that is the key TimelineView''s editor payload writes; it is a Postgres col_name_keyword and legal unquoted as a column name.';
COMMENT ON COLUMN public.milestones.color IS
  'Hex string chosen in the editor; the timeline falls back to #f59e0b when it is null (TimelineView.jsx renders that default in the minimap and the diamond).';


-- ── 2. workspace stamp, touch, and the soft-delete stamp ─────────────────
--
-- No client sends workspace_id — RabbitProvider.addMilestone builds the row as
-- { id, project_id, ...payload }. 0004's trigger derives it from the project.
-- It is LANGUAGE plpgsql and NOT SECURITY DEFINER, which is the precondition
-- for FORCE ROW LEVEL SECURITY below.

DROP TRIGGER IF EXISTS trg_milestones_populate_workspace ON public.milestones;
CREATE TRIGGER trg_milestones_populate_workspace
  BEFORE INSERT ON public.milestones
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_from_project();

DROP TRIGGER IF EXISTS trg_milestones_touch ON public.milestones;
CREATE TRIGGER trg_milestones_touch
  BEFORE UPDATE ON public.milestones
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 0014's stamp trigger, with the same WHEN clause its own loop uses. It sets
-- deleted_by on the null→set transition and clears it on restore. Its
-- projects-only admin guard reads TG_TABLE_NAME and therefore does not apply
-- here, which is correct: deleting a milestone is ordinary project write work.
DROP TRIGGER IF EXISTS trg_milestones_soft_delete ON public.milestones;
CREATE TRIGGER trg_milestones_soft_delete
  BEFORE UPDATE ON public.milestones
  FOR EACH ROW
  WHEN (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
  EXECUTE FUNCTION public.fn_soft_delete_stamp();


-- ── 3. RLS ───────────────────────────────────────────────────────────────
--
-- Not money: the ordinary project gate (can_write_project, 0013), the same one
-- assets, tasks, scenes and shots use. can_access_project_money would lock
-- milestones to managers, and a team member is expected to place one.
--
-- Four separate policies, never a FOR ALL arm: a broad FOR ALL ORs with every
-- narrow arm beside it and silently wins. That is what 0029 exists to undo and
-- what cost S15 a CRITICAL.
--
-- SELECT carries `deleted_at IS NULL` (the row leaves the timeline the moment
-- it is trashed) plus the live-PROJECT hop. UPDATE carries USING and WITH
-- CHECK with the same predicate, or a row could be repointed at a project the
-- caller does not control.
--
-- 🚨 The UPDATE policy is why the trash is RPC-only. Postgres applies the
-- SELECT policy to BOTH sides of a policy-checked UPDATE, so a plain
-- `UPDATE milestones SET deleted_at = now()` fails: the NEW row is invisible
-- to milestones_select. 0014 measured that live on wilson-dev and answered it
-- with the two SECURITY DEFINER RPCs; §5 puts milestones on that path instead
-- of inventing a second one.

ALTER TABLE public.milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milestones FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS milestones_select ON public.milestones;
CREATE POLICY milestones_select ON public.milestones
  FOR SELECT USING (
    deleted_at IS NULL
    AND workspace_id = public.current_workspace_id()
    -- The hop is to the PROJECT, never to phase_id. See the header.
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = milestones.project_id)
  );

DROP POLICY IF EXISTS milestones_insert ON public.milestones;
CREATE POLICY milestones_insert ON public.milestones
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  );

DROP POLICY IF EXISTS milestones_update ON public.milestones;
CREATE POLICY milestones_update ON public.milestones
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.can_write_project(project_id)
  );

DROP POLICY IF EXISTS milestones_delete ON public.milestones;
CREATE POLICY milestones_delete ON public.milestones
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  );


-- ── 4. Privileges ────────────────────────────────────────────────────────
--
-- 🚨 0011 issued a blanket GRANT to anon and left ALTER DEFAULT PRIVILEGES
-- armed, which is how 25 tables ended up readable by anon until 0033. 0033
-- disarmed the defaults, so a table created after it is not born exposed — but
-- asserting the revoke costs nothing and the post-condition below SCANS the
-- ACL rather than listing four privileges by name.
--
-- PUBLIC is named as well as anon: a table can carry a bare =X/postgres
-- aclitem, so naming only anon can be a silent no-op that reports success —
-- the S22 grantee lesson.

REVOKE ALL ON public.milestones FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.milestones TO authenticated;
GRANT ALL ON public.milestones TO service_role;


-- ── 5. The trash: extending 0014 rather than duplicating it ──────────────
--
-- 🚨 BOTH FUNCTIONS BELOW ARE REPLACED WHOLE, AND THE ONLY INTENDED
-- DIFFERENCE IN EACH IS THE ADDED 'milestones'. 0059 dropped a guard's
-- clauses with a CREATE OR REPLACE and it cost a live privilege escalation;
-- 0064 shipped a post-condition to catch the repeat. §6 asserts here that
-- every one of 0014's seven tables survived in both lists and that the
-- projects arm of the stamp trigger's guard is untouched (it lives in
-- fn_soft_delete_stamp, which this file does not replace at all).

-- fn_trash_authz: the allowlist gains one name. The resolution branches need
-- no change — milestones carries both `workspace_id` and `project_id` as
-- ordinary columns, so the ELSE arms of both CASE expressions already resolve
-- it, and can_write_project is already the right gate.
CREATE OR REPLACE FUNCTION public.fn_trash_authz(p_table TEXT, p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws      UUID;
  v_project UUID;
  v_allowed BOOLEAN;
BEGIN
  IF p_table NOT IN ('projects','phases','assets','tasks','files',
                     'comments','rate_cards','milestones') THEN
    RAISE EXCEPTION 'not a soft-delete table: %', p_table;
  END IF;

  -- Resolve the row's workspace and (where applicable) project for the
  -- authorization check. rate_cards are workspace-level → no project gate.
  EXECUTE format(
    'SELECT %s, %s FROM public.%I WHERE id = $1',
    CASE WHEN p_table = 'phases'
         THEN '(SELECT p.workspace_id FROM public.projects p WHERE p.id = project_id)'
         ELSE 'workspace_id' END,
    CASE p_table
      WHEN 'projects'   THEN 'id'
      WHEN 'rate_cards' THEN 'NULL::uuid'
      WHEN 'comments'   THEN 'public.fn_comment_project_id(entity_type, entity_id)'
      ELSE 'project_id' END,
    p_table)
    INTO v_ws, v_project
    USING p_id;

  v_allowed := CASE
    WHEN p_table = 'comments' THEN public.can_comment_project(v_project)
    WHEN v_project IS NULL    THEN true  -- rate_cards / dead-end walks
    ELSE public.can_write_project(v_project)
  END;

  IF v_ws IS NULL
     OR v_ws IS DISTINCT FROM public.current_workspace_id()
     OR NOT public.has_active_membership(v_ws)
     OR NOT COALESCE(v_allowed, false) THEN
    RAISE EXCEPTION 'not allowed to soft-delete or restore this row';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_trash_authz(TEXT, UUID)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fn_trash_authz IS
  'Authorizes a soft-delete or restore for one of the eight soft-delete RABBIT tables (0014''s seven plus milestones, 0067): workspace match, active membership and the project gate — the comment gate for comments, none for workspace-level rate_cards.';

-- purge_soft_deleted: the 30-day sweep gains the same name. Milestones are a
-- leaf, so the array position is after the parents whose CASCADE already takes
-- them: a purged project removes its milestones by FK, and this arm catches
-- the individually-trashed ones.
CREATE OR REPLACE FUNCTION public.purge_soft_deleted(
  p_retention INTERVAL DEFAULT INTERVAL '30 days'
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t TEXT;
  v_count BIGINT;
  v_total BIGINT := 0;
BEGIN
  -- Parents first so cascades do the bulk of the work; the remaining loops
  -- catch individually soft-deleted children.
  FOREACH t IN ARRAY ARRAY['projects','assets','tasks','phases','files',
                           'comments','rate_cards','milestones']
  LOOP
    EXECUTE format(
      'DELETE FROM public.%I WHERE deleted_at < now() - $1', t)
      USING p_retention;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_total := v_total + v_count;
  END LOOP;
  RETURN v_total;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_soft_deleted(INTERVAL)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_soft_deleted(INTERVAL) TO service_role;

COMMENT ON FUNCTION public.purge_soft_deleted IS
  'Hard-deletes rows soft-deleted more than p_retention ago (default 30 days) across the 8 soft-delete RABBIT tables; cascades take each subtree. service_role only; scheduled nightly as wilson-purge-soft-deleted where pg_cron exists (Session 6, milestones added 0067).';

-- The pg_cron job created by 0014 calls public.purge_soft_deleted() with no
-- arguments and is unchanged by the replacement above — same name, same
-- signature, same default. It is deliberately NOT rescheduled here: doing so
-- would duplicate the job on an environment where 0014's schedule already
-- exists.


-- ── 6. Reading the trash ─────────────────────────────────────────────────
--
-- milestones_select hides a trashed row, which is the point — the timeline
-- must not draw it. A "Recently deleted" list therefore cannot be a table
-- read, and widening the SELECT policy to admit trashed rows would put them
-- back on the timeline through every `select('*')` in the adapter.
--
-- So the listing is a function, on 0024's otter_trash_index() pattern:
-- SECURITY DEFINER, STABLE, one project.
--
-- 🚨 THE GATE IS A READ GATE, NOT can_write_project. This was the other way
-- round in the first version of this file and R1 caught what that implied: a
-- REVIEWER fails can_write_project (suite 71 probes 19-21 prove it), so
-- pressing "Deleted" answered a raised exception, which the panel could only
-- surface as a raw Postgres string. Reading which key dates were deleted is
-- the same class of information as reading the live ones, and a reviewer can
-- already read those. The gate is therefore the READ predicate — active
-- membership plus a live project in the caller's own workspace, which is
-- exactly projects_select (measured on wilson-dev 2026-09-07:
-- `deleted_at IS NULL AND workspace_id = current_workspace_id() AND
-- has_active_membership(workspace_id)`).
--
-- That does not create a dead control. Restore is gated CLIENT-side by
-- GatedAction on the same canWrite the rest of the timeline uses, so a
-- reviewer sees the list and a refusal in the app's own words; and if one
-- reached the RPC anyway, fn_trash_authz still refuses it. 0024's "dead
-- control" reasoning excluded rows a caller could never restore AND never
-- otherwise see; a reviewer here can see the project all day.
--
-- The project must still be LIVE, and that arm is unchanged: restoring a
-- milestone under a soft-deleted project is authorized by fn_trash_authz but
-- immediately re-hidden by milestones_select's parent hop (0024's subject arm,
-- verbatim reasoning).

DROP FUNCTION IF EXISTS public.milestones_trash_index(UUID);

CREATE FUNCTION public.milestones_trash_index(p_project_id UUID)
RETURNS TABLE (
  id               UUID,
  project_id       UUID,
  phase_id         UUID,
  title            TEXT,
  date             DATE,
  color            TEXT,
  description      TEXT,
  deleted_at       TIMESTAMPTZ,
  deleted_by       UUID,
  deleted_by_label TEXT,
  purges_at        TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws UUID := public.current_workspace_id();
  -- Must track purge_soft_deleted()'s p_retention default and the pg_cron job
  -- 'wilson-purge-soft-deleted' (04:47 UTC, 0014 section 4). It drives a
  -- "purges in N days" countdown only; nothing is deleted on this path.
  v_keep INTERVAL := INTERVAL '30 days';
BEGIN
  IF v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RAISE EXCEPTION 'not_a_workspace_member';
  END IF;
  -- The READ gate: the project must be one this caller can see. Spelled out
  -- rather than delegated, because this function is SECURITY DEFINER and
  -- therefore does NOT get projects_select applied for it.
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p
     WHERE p.id = p_project_id
       AND p.workspace_id = v_ws
       AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'not allowed to read this project''s trash';
  END IF;

  RETURN QUERY
  SELECT m.id,
         m.project_id,
         m.phase_id,
         m.title,
         m.date,
         m.color,
         m.description,
         m.deleted_at,
         m.deleted_by,
         COALESCE(dm.display_name, dm.username) AS deleted_by_label,
         (m.deleted_at + v_keep)                AS purges_at
    FROM public.milestones m
    LEFT JOIN public.workspace_members dm
           ON dm.workspace_id = m.workspace_id AND dm.user_id = m.deleted_by
   WHERE m.project_id   = p_project_id
     AND m.workspace_id = v_ws
     AND m.deleted_at IS NOT NULL
   -- No per-row parent check: every row here shares p_project_id, and the
   -- gate above already proved that project is live and in this workspace.
   -- Restoring under a trashed project is authorized by fn_trash_authz but
   -- immediately re-hidden by milestones_select, so the gate refusing the
   -- whole call is the same answer, one statement earlier.
   ORDER BY m.deleted_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.milestones_trash_index(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.milestones_trash_index(UUID)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.milestones_trash_index IS
  'Trashed milestones for one live project, newest first, with a purges_at countdown. SECURITY DEFINER because milestones_select hides trashed rows by design. Gated on READ (active membership + a live project in the caller''s workspace, i.e. projects_select), NOT on can_write_project: a reviewer can read the project''s live key dates and may read its deleted ones. Restore is gated separately, client-side by GatedAction and server-side by fn_trash_authz (0067, ruling 38).';


-- ── 7. Post-conditions ───────────────────────────────────────────────────

DO $$
DECLARE
  n     INTEGER;
  def   TEXT;
  allow TEXT;
  t     TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables
                  WHERE schemaname = 'public' AND tablename = 'milestones') THEN
    RAISE EXCEPTION '0067 post-condition failed: public.milestones missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_class
                  WHERE oid = 'public.milestones'::regclass
                    AND relrowsecurity AND relforcerowsecurity) THEN
    RAISE EXCEPTION '0067 post-condition failed: RLS must be enabled AND forced on milestones';
  END IF;

  -- Four policies, one per command, and NO FOR ALL arm (0029 / the S15
  -- CRITICAL): a FOR ALL policy reports cmd = 'ALL'.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'milestones';
  IF n <> 4 THEN
    RAISE EXCEPTION '0067 post-condition failed: expected 4 policies on milestones, found %', n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'milestones' AND cmd = 'ALL') THEN
    RAISE EXCEPTION '0067 post-condition failed: milestones carries a FOR ALL policy arm';
  END IF;

  -- 🚨 THE S23 TRAP, ASSERTED. The SELECT policy must not reach for phases:
  -- a nullable phase_id plus a phase hop is a write that cannot read itself.
  SELECT qual INTO def FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'milestones' AND policyname = 'milestones_select';
  IF def IS NULL OR def NOT LIKE '%projects%' THEN
    RAISE EXCEPTION '0067 post-condition failed: milestones_select must hop to the project';
  END IF;
  IF def LIKE '%phases%' THEN
    RAISE EXCEPTION '0067 post-condition failed: milestones_select hops to phases — the S23 trap (phase_id is nullable)';
  END IF;
  IF def NOT LIKE '%deleted_at%' THEN
    RAISE EXCEPTION '0067 post-condition failed: milestones_select must hide trashed rows';
  END IF;

  -- phase_id stays nullable, or the header's whole argument is void.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='milestones'
                AND column_name='phase_id' AND is_nullable='NO') THEN
    RAISE EXCEPTION '0067 post-condition failed: milestones.phase_id must stay nullable';
  END IF;

  -- Privileges: SCAN the ACL rather than naming four privileges (S22). A
  -- grantee with any privilege at all is a hole, including one arriving as a
  -- bare PUBLIC aclitem.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'milestones'
       AND grantee IN ('anon', 'PUBLIC')
  ) THEN
    RAISE EXCEPTION '0067 post-condition failed: anon or PUBLIC holds a privilege on milestones';
  END IF;
  IF has_function_privilege('anon', 'public.milestones_trash_index(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0067 post-condition failed: anon can execute milestones_trash_index';
  END IF;

  -- The three triggers that make a row usable: without the workspace stamp
  -- every insert dies 23502, and no probe that supplies workspace_id itself
  -- would ever notice (the 0064 lesson).
  FOREACH t IN ARRAY ARRAY['trg_milestones_populate_workspace',
                           'trg_milestones_touch',
                           'trg_milestones_soft_delete']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.milestones'::regclass
                      AND tgname = t AND NOT tgisinternal) THEN
      RAISE EXCEPTION '0067 post-condition failed: trigger % missing on milestones', t;
    END IF;
  END LOOP;

  -- 🚨 THE CREATE OR REPLACE GUARD (0059's escalation, 0064's answer).
  -- Every one of 0014's seven tables must still be in both lists, and the
  -- comments/rate_cards special cases must still be there.
  --
  -- 🚨 THE ALLOWLIST IS EXTRACTED, NOT SUBSTRING-SEARCHED. A plain
  -- `def LIKE '%''projects''%'` is VACUOUS for four of these eight names,
  -- because 'projects', 'phases', 'comments' and 'rate_cards' each occur a
  -- SECOND time inside this function's CASE arms — so dropping one from the
  -- IN-list would still have passed the guard while every soft-delete and
  -- restore for that entity died with "not a soft-delete table". Found by the
  -- R1 review of this file: a guard against 0059 that half of 0059's shape
  -- could walk straight through. Pull the IN-list out and compare it as a set.
  def := pg_get_functiondef('public.fn_trash_authz(text,uuid)'::regprocedure);
  allow := substring(def from 'p_table NOT IN \(([^)]*)\)');
  IF allow IS NULL THEN
    RAISE EXCEPTION '0067 post-condition failed: fn_trash_authz has no p_table allowlist at all';
  END IF;
  FOREACH t IN ARRAY ARRAY['projects','phases','assets','tasks','files',
                           'comments','rate_cards','milestones']
  LOOP
    IF allow NOT LIKE '%''' || t || '''%' THEN
      RAISE EXCEPTION '0067 post-condition failed: % dropped from fn_trash_authz''s allowlist', t;
    END IF;
  END LOOP;
  -- Exactly eight, so a name cannot be swapped for another without notice.
  IF array_length(string_to_array(allow, ','), 1) <> 8 THEN
    RAISE EXCEPTION '0067 post-condition failed: fn_trash_authz''s allowlist holds % entries, expected 8',
      array_length(string_to_array(allow, ','), 1);
  END IF;
  IF def NOT LIKE '%can_comment_project%' THEN
    RAISE EXCEPTION '0067 post-condition failed: the comments gate was dropped from fn_trash_authz';
  END IF;
  IF def NOT LIKE '%has_active_membership%' OR def NOT LIKE '%current_workspace_id%' THEN
    RAISE EXCEPTION '0067 post-condition failed: fn_trash_authz lost its workspace or membership check';
  END IF;

  def := pg_get_functiondef('public.purge_soft_deleted(interval)'::regprocedure);
  FOREACH t IN ARRAY ARRAY['projects','assets','tasks','phases','files',
                           'comments','rate_cards','milestones']
  LOOP
    IF def NOT LIKE '%''' || t || '''%' THEN
      RAISE EXCEPTION '0067 post-condition failed: % dropped from purge_soft_deleted''s sweep', t;
    END IF;
  END LOOP;

  -- fn_soft_delete_stamp is NOT replaced by this file; assert its projects
  -- admin guard is still there, so a future reader knows it was checked.
  def := pg_get_functiondef('public.fn_soft_delete_stamp()'::regprocedure);
  IF def NOT LIKE '%only workspace admins can delete or restore projects%' THEN
    RAISE EXCEPTION '0067 post-condition failed: the projects admin guard is missing from fn_soft_delete_stamp';
  END IF;

  RAISE NOTICE '0067 post-conditions passed: milestones, its trash path and 0014''s eight-table machinery.';
END $$;
