-- =============================================================================
-- 0061_phase_dependencies.sql
-- Phase 2 of Audrey's 2026-08-10 build pass — timeline dependencies.
--
-- THE BUG THIS SERVES
-- -------------------
-- The Gantt lets a user drag a link between two TASK bars and, in the default
-- groupBy='phase' mode, between two PHASE bars (the cyan grip in DetailBar,
-- `backgroundColor: phaseStyle ? '#22d3ee' : '#fb923c'`). Both gestures build a
-- row carrying `kind` and `project_id`, neither of which is a column on
-- public.task_dependencies, so PostgREST rejected the WHOLE request with
-- PGRST204 and TimelineView swallowed it with `.catch(() => {})`.
--
-- The client-side half of that is fixed in supabaseAdapter.js (a real
-- COLUMN_ALLOWLIST entry, the S23 pattern this table was missed by). But the
-- allowlist alone fixes only TASK edges. A phase edge additionally hits:
--
--   * `predecessor_id uuid not null references tasks(id)` — a phase id is not a
--     task id, so 23503 foreign_key_violation; and
--   * task_deps_insert's `EXISTS (SELECT 1 FROM public.tasks pre WHERE
--     pre.id = predecessor_id ...)` (0013) — which denies it first.
--
-- So phase edges need schema. This migration is that schema.
--
--
-- WHY A SEPARATE TABLE AND NOT A `kind` COLUMN
-- --------------------------------------------
-- The obvious shape is `ALTER TABLE task_dependencies ADD COLUMN kind`, drop
-- the two FKs to tasks(id) so the columns can hold either id, and branch every
-- policy on kind. That was measured and REJECTED. Dropping those FKs breaks
-- four things at once, and the first one is silent and app-wide:
--
--   1. 🚨 THE LOADER. supabaseAdapter.loadProject fetches dependencies through
--      the FK BY NAME:
--        .select('*, predecessor:tasks!task_dependencies_predecessor_id_fkey(project_id)')
--      Drop the constraint and PostgREST can no longer resolve that
--      relationship (PGRST200 / HTTP 400). unwrap() throws, and the call ends
--      in `.catch(() => [])`. RabbitProvider then does
--      `setBundle({ ...EMPTY_BUNDLE, ...next })`, so bundle.dependencies
--      becomes [] for EVERY project: no Gantt arrows anywhere, buildSchedule
--      reflows every task off its explicit dates, selectCriticalPath returns a
--      degenerate path — with no error surfaced at any layer and no test that
--      fails (supabaseLoadProject.test.js asserts only that the key exists).
--      That constraint name appears exactly ONCE in the repo and is pinned by
--      nothing, because 0000 declares the FK inline and unnamed.
--
--   2. ON DELETE CASCADE goes with it. purge_soft_deleted() (0014) hard-deletes
--      tasks and deliberately does NOT list task_dependencies — it relies on
--      the cascade. Without it the nightly sweep either orphans rows or raises
--      an FK error inside a service_role cron job.
--
--   3. All four task_deps_* policies would need a kind-aware branch, replacing
--      a shape that is correct today and has carried a pgTAP suite since S2.
--
--   4. Referential integrity would have to be rebuilt in triggers — insert-time
--      existence checks for two parent tables, plus delete-time cascade from
--      BOTH tasks and phases. That is five new pieces of machinery replacing
--      machinery that works.
--
-- A sibling table costs none of that. No DDL in this file names
-- public.task_dependencies: its FKs, its cascade, its unique constraint, its
-- policies and the loader's embed all keep working exactly as they do today.
--
-- ⚠️ But "not touched" would be an overclaim, so state it precisely. §5 and §6
-- CREATE OR REPLACE two SHARED trigger functions — fn_realtime_broadcast (10
-- tables) and fn_edit_history_capture (13) — and widen a CHECK on the shared
-- edit_history table. task_dependencies' realtime and history run through both
-- functions. Each body below is reproduced from 0016 and 0012 with exactly one
-- branch added, because Postgres has no "add a branch" operation; any drift
-- would break every table that uses them, not only the new one. §7 asserts the
-- surviving triggers rather than trusting the reproduction.
-- `kind` stays what it already is on the client — a render-time discriminator
-- (`const kind = d.kind || 'task'` in DetailPane.visibleDeps) — and the adapter
-- stamps it from WHICH TABLE the row came from rather than from a column. That
-- also means uniqueness needs no composite key: each table is unique on its own
-- (predecessor_id, successor_id), which is the constraint 0014's header already
-- reasons about.
--
-- The one thing the sibling shape does NOT give for free is the parent-join
-- plumbing, so this migration adds it deliberately: RLS, grants, the audit
-- trigger, the realtime broadcast case and the edit-history case, each mirroring
-- what task_dependencies already carries. A leaf table that is missing one of
-- those is the "half-wired feature" shape this repo has shipped nine times.
--
-- NOT SOFT-DELETE. Mirrors task_dependencies: 0014's header records that the six
-- leaf/link tables stay hard-delete because their UNIQUE constraints would
-- collide with recreated rows. In-session undo is the provider's inverse-op
-- history stack. The deleted_at/deleted_by columns exist only so the table's
-- shape matches its sibling; nothing writes them.
--
-- Idempotent: IF NOT EXISTS / DROP POLICY IF EXISTS throughout. Safe to re-run.
-- =============================================================================


-- =============================================================================
-- 1. TABLE
-- =============================================================================

-- 🚨 THE TWO FOREIGN KEYS ARE NAMED EXPLICITLY, and that is load-bearing.
--
-- A table with TWO foreign keys to the same parent is ambiguous to PostgREST:
-- `phases!inner(project_id)` cannot tell predecessor from successor and fails
-- with PGRST201. The embed must be disambiguated by CONSTRAINT NAME, which
-- means the adapter hardcodes that name — supabaseAdapter.loadProject does
-- exactly this today for task_dependencies.
--
-- 0000 declared task_dependencies' FKs INLINE and UNNAMED, so the name the
-- adapter depends on is Postgres's auto-generated one, pinned by nothing and
-- asserted by no test. If it ever changes, the fetch 400s, `.catch(() => [])`
-- swallows it, and every Gantt arrow in the product disappears with no error.
-- Naming them here makes the contract explicit instead of incidental. The
-- chosen names are the same ones Postgres would generate, so this is a
-- documentation change on a new table, not a rename of anything existing.
CREATE TABLE IF NOT EXISTS public.phase_dependencies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  predecessor_id  UUID NOT NULL,
  successor_id    UUID NOT NULL,
  CONSTRAINT phase_dependencies_predecessor_id_fkey
    FOREIGN KEY (predecessor_id) REFERENCES public.phases(id) ON DELETE CASCADE,
  CONSTRAINT phase_dependencies_successor_id_fkey
    FOREIGN KEY (successor_id)  REFERENCES public.phases(id) ON DELETE CASCADE,
  type            public.dep_type NOT NULL DEFAULT 'FS',
  lag_days        INTEGER NOT NULL DEFAULT 0,

  -- Audit columns, matching what 0004 §4a backfilled onto task_dependencies so
  -- fn_audit_touch always has a column to write to.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID,
  updated_by      UUID,
  last_updated_by UUID,
  last_updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  deleted_by      UUID
);

-- Constraints added separately so a re-run over a table created by an earlier
-- partial apply still gets them. 🚨 A wrapped ADD CONSTRAINT cannot WIDEN an
-- existing one — it is a silent no-op — so anything that must CHANGE is
-- DROP + ADD (see the edit_history CHECK in §6), never a bare ADD.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.phase_dependencies'::regclass
       AND conname  = 'phase_dependencies_pair_uniq'
  ) THEN
    ALTER TABLE public.phase_dependencies
      ADD CONSTRAINT phase_dependencies_pair_uniq UNIQUE (predecessor_id, successor_id);
  END IF;

  -- A phase cannot depend on itself. The UI already refuses it
  -- (`id !== fromId` in beginDependencyDrag), but a gesture guard is not a
  -- data guard: the AI agent tool and any future writer bypass it entirely.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.phase_dependencies'::regclass
       AND conname  = 'phase_dependencies_no_self_edge'
  ) THEN
    ALTER TABLE public.phase_dependencies
      ADD CONSTRAINT phase_dependencies_no_self_edge CHECK (predecessor_id <> successor_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS phase_dependencies_pre_idx
  ON public.phase_dependencies(predecessor_id);
CREATE INDEX IF NOT EXISTS phase_dependencies_suc_idx
  ON public.phase_dependencies(successor_id);

COMMENT ON TABLE public.phase_dependencies IS
  'Phase-to-phase Gantt edges. Sibling of task_dependencies; the client unions '
  'both into ctx.dependencies and stamps `kind` from the source table. 0061.';


-- =============================================================================
-- 2. RLS — parent-join via phases → projects, mirroring task_deps_* (0013)
-- =============================================================================
--
-- phases has no workspace_id (it is a parent-join table), so the join to
-- projects is what carries the tenancy check. RLS on phases/projects also
-- applies inside these EXISTS clauses, which is how soft-deleted parents drop
-- out automatically — the same inheritance 0014's header relies on for the
-- other leaf tables.
--
-- SELECT is workspace-scoped only, matching task_deps_select: listing is not a
-- privileged action, modifying is. INSERT/UPDATE/DELETE additionally require an
-- active membership AND can_write_project, which is the shape 0013 gave
-- task_deps_insert/update/delete.

ALTER TABLE public.phase_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phase_dependencies FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS phase_deps_select ON public.phase_dependencies;
DROP POLICY IF EXISTS phase_deps_insert ON public.phase_dependencies;
DROP POLICY IF EXISTS phase_deps_update ON public.phase_dependencies;
DROP POLICY IF EXISTS phase_deps_delete ON public.phase_dependencies;

CREATE POLICY phase_deps_select ON public.phase_dependencies
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.phases pre
        JOIN public.projects pp ON pp.id = pre.project_id
       WHERE pre.id = phase_dependencies.predecessor_id
         AND pp.workspace_id = public.current_workspace_id()
    )
    AND EXISTS (
      SELECT 1 FROM public.phases suc
        JOIN public.projects sp ON sp.id = suc.project_id
       WHERE suc.id = phase_dependencies.successor_id
         AND sp.workspace_id = public.current_workspace_id()
    )
  );

CREATE POLICY phase_deps_insert ON public.phase_dependencies
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.phases pre
        JOIN public.projects pp ON pp.id = pre.project_id
       WHERE pre.id = predecessor_id
         AND pp.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(pp.workspace_id)
         AND public.can_write_project(pp.id)
    )
    AND EXISTS (
      SELECT 1 FROM public.phases suc
        JOIN public.projects sp ON sp.id = suc.project_id
       WHERE suc.id = successor_id
         AND sp.workspace_id = public.current_workspace_id()
    )
  );

CREATE POLICY phase_deps_update ON public.phase_dependencies
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.phases pre
        JOIN public.projects pp ON pp.id = pre.project_id
       WHERE pre.id = phase_dependencies.predecessor_id
         AND pp.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(pp.workspace_id)
         AND public.can_write_project(pp.id)
    )
  );

CREATE POLICY phase_deps_delete ON public.phase_dependencies
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.phases pre
        JOIN public.projects pp ON pp.id = pre.project_id
       WHERE pre.id = phase_dependencies.predecessor_id
         AND pp.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(pp.workspace_id)
         AND public.can_write_project(pp.id)
    )
  );


-- =============================================================================
-- 3. PRIVILEGES
-- =============================================================================
--
-- 🚨 0011 issued a blanket GRANT to anon AND left ALTER DEFAULT PRIVILEGES
-- armed, which is how 25 tables ended up readable by anon until 0033 disarmed
-- it. A table created after 0033 is not born exposed — but asserting the revoke
-- costs nothing and the pgTAP suite carries the standing probe either way. A
-- policy-only check passes happily while a privilege hole is wide open.
--
-- Named PUBLIC as well as anon: a table can carry a bare =X/postgres aclitem,
-- so naming only anon can be a silent no-op that reports success (S22).

REVOKE ALL ON public.phase_dependencies FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.phase_dependencies TO authenticated;
GRANT ALL ON public.phase_dependencies TO service_role;


-- =============================================================================
-- 4. AUDIT TRIGGER — fn_audit_touch (0001), as attached to task_dependencies
-- =============================================================================

DROP TRIGGER IF EXISTS trg_phase_dependencies_audit ON public.phase_dependencies;
CREATE TRIGGER trg_phase_dependencies_audit
  BEFORE INSERT OR UPDATE ON public.phase_dependencies
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_touch();


-- =============================================================================
-- 5. REALTIME — extend fn_realtime_broadcast (0016) and attach the trigger
-- =============================================================================
--
-- Without this a phase edge created by one collaborator never reaches another
-- until a full reload. task_dependencies resolves its project through the
-- predecessor TASK; the phase table resolves through the predecessor PHASE.
--
-- CREATE OR REPLACE is safe here: the signature is unchanged (RETURNS TRIGGER,
-- no arguments), so this is a body swap, not the 42P13 return-type change that
-- bit 0059.

CREATE OR REPLACE FUNCTION public.fn_realtime_broadcast()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     JSONB;
  v_project UUID;
BEGIN
  -- Environments without the realtime schema (db-only CI stack) skip
  -- silently. Cheap catalog probe; the EXCEPTION guard below is the backstop.
  -- 🚨 Probes for the FUNCTION, not just the schema — a stack carrying the
  -- schema without broadcast_changes would pass a schema-only check and then
  -- raise a WARNING on every single write.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'realtime' AND p.proname = 'broadcast_changes'
  ) THEN
    RETURN NULL;
  END IF;

  -- PG14+: the unassigned side of NEW/OLD reads as NULL in row triggers.
  v_row := COALESCE(to_jsonb(NEW), to_jsonb(OLD));

  CASE TG_TABLE_NAME
    WHEN 'projects' THEN
      v_project := (v_row ->> 'id')::uuid;
    WHEN 'phases', 'assets', 'tasks', 'files', 'project_members' THEN
      v_project := (v_row ->> 'project_id')::uuid;
    WHEN 'comments' THEN
      v_project := public.fn_comment_project_id(
        v_row ->> 'entity_type', (v_row ->> 'entity_id')::uuid);
    WHEN 'task_dependencies' THEN
      SELECT t.project_id INTO v_project FROM public.tasks t
       WHERE t.id = (v_row ->> 'predecessor_id')::uuid;
    -- 0061: the phase sibling. Resolves through phases, not tasks.
    WHEN 'phase_dependencies' THEN
      SELECT ph.project_id INTO v_project FROM public.phases ph
       WHERE ph.id = (v_row ->> 'predecessor_id')::uuid;
    WHEN 'task_links' THEN
      SELECT t.project_id INTO v_project FROM public.tasks t
       WHERE t.id = (v_row ->> 'task_id')::uuid;
    WHEN 'asset_versions' THEN
      SELECT a.project_id INTO v_project FROM public.assets a
       WHERE a.id = (v_row ->> 'asset_id')::uuid;
    ELSE
      v_project := NULL;
  END CASE;

  IF v_project IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM realtime.broadcast_changes(
    'rabbit:project:' || v_project::text,
    TG_OP, TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD
  );

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Same resilience contract as fn_edit_history_capture (0012): a broadcast
  -- failure NEVER aborts the user's write.
  RAISE WARNING 'realtime broadcast failed for %.% (%): %',
    TG_TABLE_NAME, v_row ->> 'id', TG_OP, SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_realtime_broadcast() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_phase_dependencies_realtime ON public.phase_dependencies;
CREATE TRIGGER trg_phase_dependencies_realtime
  AFTER INSERT OR UPDATE OR DELETE ON public.phase_dependencies
  FOR EACH ROW EXECUTE FUNCTION public.fn_realtime_broadcast();


-- =============================================================================
-- 6. EDIT HISTORY — widen the entity_type CHECK, extend the capture function
-- =============================================================================
--
-- task_dependencies has been captured since 0012. Omitting the phase sibling
-- would make a phase link invisible in history while a task link is visible —
-- an asymmetry nobody would think to look for.
--
-- 🚨 The CHECK must be DROPPED and re-ADDED. A wrapped `ADD CONSTRAINT` cannot
-- widen an existing one; it is a silent no-op that reports success. The
-- constraint is discovered by definition rather than by name because 0012
-- declared it inline, so its name is Postgres-generated and not pinned
-- anywhere. The new constraint is explicitly named so the next migration can
-- find it. The result is READ BACK below and the migration ABORTS if the widen
-- did not take.

-- 🚨 GUARDED, because DROP + retype is a NARROWING operation in disguise. This
-- block re-types the whole value list from source. If a LATER migration widens
-- the list again and someone re-runs 0061 — a repair, a fresh environment
-- rebuilt from migrations, a `db reset` — an unguarded version would silently
-- delete that later value and every history row for it would stop being
-- captured, behind fn_edit_history_capture's `EXCEPTION WHEN OTHERS → RAISE
-- WARNING`: no error, no row, no failing test. That is migration 0027's
-- rabbit-files cap reset, exactly. So: if the constraint already admits
-- phase_dependencies, this migration's work is done and it touches nothing.
DO $$
DECLARE
  c RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.edit_history'::regclass
       AND contype  = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%entity_type%'
       AND pg_get_constraintdef(oid) ILIKE '%phase_dependencies%'
  ) THEN
    RAISE NOTICE '0061: edit_history entity_type CHECK already admits phase_dependencies — leaving it alone';
    RETURN;
  END IF;

  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.edit_history'::regclass
       AND contype  = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%entity_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.edit_history DROP CONSTRAINT %I', c.conname);
  END LOOP;

  ALTER TABLE public.edit_history
    ADD CONSTRAINT edit_history_entity_type_check CHECK (entity_type IN (
      'projects','phases','assets','tasks','files',
      'comments','rate_cards','rate_card_entries',
      'asset_versions','task_dependencies','phase_dependencies','task_links',
      'ingestion_runs','ingestion_chunks'));
END $$;

-- Read it back — BOTH WAYS. Checking only that the new value arrived would let
-- a dropped or misspelled INHERITED value through: the migration would be
-- green, and history capture for whichever table lost its value would fail
-- forever inside the capture function's WHEN OTHERS handler, which raises a
-- WARNING and returns NULL. No error, no row, nothing to notice.
DO $$
DECLARE
  v_def  TEXT;
  v_want TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.edit_history'::regclass
     AND conname  = 'edit_history_entity_type_check';

  IF v_def IS NULL THEN
    -- Only legal if a differently-named constraint already admits the value
    -- (the guarded early-return above).
    SELECT pg_get_constraintdef(oid) INTO v_def
      FROM pg_constraint
     WHERE conrelid = 'public.edit_history'::regclass
       AND contype  = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%entity_type%'
     LIMIT 1;
  END IF;

  IF v_def IS NULL THEN
    RAISE EXCEPTION '0061 post-condition failed: edit_history has no entity_type CHECK at all';
  END IF;

  FOREACH v_want IN ARRAY ARRAY[
    'projects','phases','assets','tasks','files',
    'comments','rate_cards','rate_card_entries',
    'asset_versions','task_dependencies','phase_dependencies','task_links',
    'ingestion_runs','ingestion_chunks'
  ]
  LOOP
    IF v_def NOT LIKE '%''' || v_want || '''%' THEN
      RAISE EXCEPTION
        '0061 post-condition failed: edit_history entity_type CHECK no longer admits % (def=%)',
        v_want, v_def;
    END IF;
  END LOOP;
END $$;

-- Extend the capture function's step (b) parent join with a phase_dependencies
-- branch. Body swap only; the signature is unchanged, so CREATE OR REPLACE is
-- safe (the 42P13 return-type trap that bit 0059 applies to a CHANGED
-- signature, not to a body edit).
--
-- Without the branch the trigger would still mostly work — step (c) falls back
-- to current_workspace_id() — but a service_role write or a cascade path with
-- no JWT claim would resolve NULL and the row would be dropped at step (d).
-- The whole point of step (b) is to not depend on the caller's claim.
--
-- Reproduced in full because Postgres has no "add a branch" operation. The only
-- difference from 0012 is the phase_dependencies WHEN, marked below.
CREATE OR REPLACE FUNCTION public.fn_edit_history_capture()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     JSONB;
  v_ws      UUID;
  v_actor   UUID;
  v_label   TEXT;
  v_action  TEXT;
  v_diff    JSONB;
  c_noise   CONSTANT TEXT[] :=
    ARRAY['updated_at', 'updated_by', 'last_updated_at', 'last_updated_by'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := to_jsonb(OLD);
  ELSE
    v_row := to_jsonb(NEW);
  END IF;

  -- (a) row's own column
  IF v_row ? 'workspace_id' THEN
    v_ws := (v_row ->> 'workspace_id')::uuid;
  END IF;

  -- (b) parent join
  IF v_ws IS NULL THEN
    CASE TG_TABLE_NAME
      WHEN 'phases' THEN
        SELECT p.workspace_id INTO v_ws FROM public.projects p
         WHERE p.id = (v_row ->> 'project_id')::uuid;
      WHEN 'ingestion_runs' THEN
        SELECT p.workspace_id INTO v_ws FROM public.projects p
         WHERE p.id = (v_row ->> 'project_id')::uuid;
      WHEN 'asset_versions' THEN
        SELECT a.workspace_id INTO v_ws FROM public.assets a
         WHERE a.id = (v_row ->> 'asset_id')::uuid;
      WHEN 'task_dependencies' THEN
        SELECT t.workspace_id INTO v_ws FROM public.tasks t
         WHERE t.id = (v_row ->> 'predecessor_id')::uuid;
      -- ── 0061: the phase sibling. Two hops, because phases has no
      -- workspace_id of its own.
      WHEN 'phase_dependencies' THEN
        SELECT pr.workspace_id INTO v_ws
          FROM public.phases ph
          JOIN public.projects pr ON pr.id = ph.project_id
         WHERE ph.id = (v_row ->> 'predecessor_id')::uuid;
      WHEN 'task_links' THEN
        SELECT t.workspace_id INTO v_ws FROM public.tasks t
         WHERE t.id = (v_row ->> 'task_id')::uuid;
      WHEN 'rate_card_entries' THEN
        SELECT rc.workspace_id INTO v_ws FROM public.rate_cards rc
         WHERE rc.id = (v_row ->> 'rate_card_id')::uuid;
      WHEN 'ingestion_chunks' THEN
        SELECT p.workspace_id INTO v_ws
          FROM public.ingestion_runs ir
          JOIN public.projects p ON p.id = ir.project_id
         WHERE ir.id = (v_row ->> 'run_id')::uuid;
      ELSE
        v_ws := NULL;
    END CASE;
  END IF;

  -- (c) caller's claim
  IF v_ws IS NULL THEN
    v_ws := public.current_workspace_id();
  END IF;

  -- (d) unresolvable — skip, never block the write
  IF v_ws IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'create';
    v_diff   := jsonb_build_object('new', jsonb_strip_nulls(to_jsonb(NEW)));
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
    v_diff   := jsonb_build_object('old', jsonb_strip_nulls(to_jsonb(OLD)));
  ELSE
    v_action := 'update';
    SELECT jsonb_object_agg(
             o.key, jsonb_build_object('old', o.value, 'new', n.value))
      INTO v_diff
      FROM jsonb_each(to_jsonb(OLD)) o
      JOIN jsonb_each(to_jsonb(NEW)) n ON n.key = o.key
     WHERE o.value IS DISTINCT FROM n.value
       AND NOT (o.key = ANY (c_noise));
    IF v_diff IS NULL OR v_diff = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
  END IF;

  v_actor := auth.uid();
  IF v_actor IS NOT NULL THEN
    SELECT COALESCE(wm.display_name, wm.username) INTO v_label
      FROM public.workspace_members wm
     WHERE wm.workspace_id = v_ws
       AND wm.user_id = v_actor;
  END IF;

  INSERT INTO public.edit_history
    (workspace_id, entity_type, entity_id, actor_user_id, actor_label,
     action, diff)
  VALUES
    (v_ws, TG_TABLE_NAME, (v_row ->> 'id')::uuid, v_actor, v_label,
     v_action, v_diff);

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'edit_history capture failed for %.% (%): %',
    TG_TABLE_NAME, v_row ->> 'id', TG_OP, SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_edit_history_capture() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_phase_dependencies_edit_history ON public.phase_dependencies;
CREATE TRIGGER trg_phase_dependencies_edit_history
  AFTER INSERT OR UPDATE OR DELETE ON public.phase_dependencies
  FOR EACH ROW EXECUTE FUNCTION public.fn_edit_history_capture();


-- =============================================================================
-- 7. POST-CONDITIONS — assert, do not assume
-- =============================================================================
--
-- Migration 0027 taught this the expensive way: a migration can be green and
-- have changed nothing. Every claim this file makes is checked here.

DO $$
DECLARE
  has_rls    BOOLEAN;
  is_forced  BOOLEAN;
  n_policies INT;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity
    INTO has_rls, is_forced
    FROM pg_class WHERE oid = 'public.phase_dependencies'::regclass;

  IF NOT has_rls OR NOT is_forced THEN
    RAISE EXCEPTION '0061: RLS not forced on phase_dependencies (rowsecurity=%, force=%)',
      has_rls, is_forced;
  END IF;

  SELECT count(*) INTO n_policies
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'phase_dependencies';

  IF n_policies <> 4 THEN
    RAISE EXCEPTION '0061: expected 4 policies on phase_dependencies, found %', n_policies;
  END IF;

  IF has_table_privilege('anon', 'public.phase_dependencies', 'SELECT')
     OR has_table_privilege('anon', 'public.phase_dependencies', 'INSERT')
     OR has_table_privilege('anon', 'public.phase_dependencies', 'UPDATE')
     OR has_table_privilege('anon', 'public.phase_dependencies', 'DELETE') THEN
    RAISE EXCEPTION '0061: anon still holds a table privilege on phase_dependencies';
  END IF;

  -- Both FKs must point at phases, not tasks. This is the whole point of the
  -- table; a copy-paste from task_dependencies would silently keep tasks(id).
  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'public.phase_dependencies'::regclass
         AND contype = 'f'
         AND confrelid = 'public.phases'::regclass) <> 2 THEN
    RAISE EXCEPTION '0061: phase_dependencies does not have exactly 2 FKs to public.phases';
  END IF;

  -- ...and they must carry the names the adapter's PostgREST embed hint uses.
  -- Without the hint the embed is ambiguous (two FKs to the same parent =
  -- PGRST201) and the dependency fetch returns nothing, silently.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.phase_dependencies'::regclass
       AND conname  = 'phase_dependencies_predecessor_id_fkey'
  ) THEN
    RAISE EXCEPTION
      '0061: phase_dependencies_predecessor_id_fkey is missing — supabaseAdapter.loadProject names this constraint in its embed hint';
  END IF;

  -- 🚨 ALL THREE TRIGGERS. This file's own header argues that "a leaf table
  -- missing one of those is the half-wired feature shape this repo has shipped
  -- nine times" — and then attached them without checking. Each failure is
  -- silent in its own way: no audit trigger means created_by stays NULL; no
  -- realtime trigger means a collaborator never sees the link appear; no
  -- edit-history trigger means the change is absent from the history panel.
  -- None of the three raises anything at write time.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.phase_dependencies'::regclass
                    AND tgname  = 'trg_phase_dependencies_audit') THEN
    RAISE EXCEPTION '0061: trg_phase_dependencies_audit is not attached';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.phase_dependencies'::regclass
                    AND tgname  = 'trg_phase_dependencies_realtime') THEN
    RAISE EXCEPTION '0061: trg_phase_dependencies_realtime is not attached';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.phase_dependencies'::regclass
                    AND tgname  = 'trg_phase_dependencies_edit_history') THEN
    RAISE EXCEPTION '0061: trg_phase_dependencies_edit_history is not attached';
  END IF;

  -- The two shared functions this migration REPLACED must still serve their
  -- original tables. CREATE OR REPLACE swaps the body for every trigger that
  -- references it, so a drifted reproduction breaks 10 tables (realtime) and
  -- 13 (edit history), not just the new one.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.task_dependencies'::regclass
                    AND tgname  = 'trg_task_dependencies_realtime') THEN
    RAISE EXCEPTION '0061: trg_task_dependencies_realtime disappeared';
  END IF;

  -- task_dependencies must be UNTOUCHED — in particular the FK the loader
  -- resolves by name must still exist. If this fires, the migration has
  -- reintroduced the silent empty-Gantt regression it was written to avoid.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.task_dependencies'::regclass
       AND contype  = 'f'
       AND conname  = 'task_dependencies_predecessor_id_fkey'
  ) THEN
    RAISE EXCEPTION
      '0061: task_dependencies_predecessor_id_fkey is missing — supabaseAdapter.loadProject resolves this FK BY NAME and would silently return zero dependencies';
  END IF;
END $$;
