-- =============================================================================
-- 0077_milestones_realtime.sql
-- Track A — key dates live-sync between windows. Audrey's ruling of 2026-09-07.
--
-- WHAT SHE ASKED FOR, AND THE HALF SHE DELIBERATELY DID NOT
-- --------------------------------------------------------
-- "key dates get LIVE SYNC between windows like tasks ... KEY DATES ONLY, her
-- explicit choice: scenes, shots, levels and experiences keep the reload
-- limit, recorded in the handbook as a conscious difference, not an
-- oversight." (FIX_PLAN_2026-09-04.md, the A3 row.)
--
-- So this file adds ONE arm and ONE trigger. It deliberately does not touch
-- scenes, shots, levels or experiences, and it deliberately does not add
-- milestones to edit-history capture (0012) — that limit stands, and 0067's
-- table comment is corrected below to say exactly which half changed.
--
-- 🚨 THE NUMBER. 0067's own header and FIX_PLAN's first draft both said this
-- work would be 0068. It is not: 0068 is A3's user_pets stale-write guard and
-- is already applied on dev, so Track A's reservation (0067-0069) was
-- over-subscribed and the ledger moved live sync to 0077, from the unused end.
-- 0069 stays reserved for A4's otter_nomination_apply. Check the ledger in
-- FIX_PLAN_2026-09-04.md before taking any number.
--
-- WHY A MIGRATION AT ALL, when the client change is three lines
-- ------------------------------------------------------------
-- Because without the trigger the client is worse than it was: it would stand
-- ready to merge `milestones` events that the database never sends, which
-- reads exactly like working live sync until two people are in the same
-- project and nothing arrives. The trigger is the half that makes the feature
-- exist; state/realtimeMerge.js is the half that makes it visible.
--
-- WHAT IT COSTS, STATED
-- ---------------------
-- realtime.broadcast_changes publishes FULL old and new rows to the project
-- topic, bypassing RLS — that is the whole reason broadcast was chosen over
-- postgres_changes (0016's header), because a soft delete's NEW row fails the
-- subscriber's SELECT policy and the "this was just trashed" event would
-- otherwise never arrive. So a trashed key date's row now reaches every
-- subscriber to `rabbit:project:{id}`.
--
-- That is not a new exposure. Channel join authz is can_read_project_topic(),
-- which is SECURITY INVOKER over projects_select — workspace match, live
-- project, active membership. milestones_select is workspace match + live
-- project + `deleted_at IS NULL`. Everyone who can hear the topic can already
-- read every task, asset, file and comment on that project through the same
-- mechanism, and could read the key date itself a moment before it was
-- trashed. The set of people who learn something new is empty.
--
-- CREATE OR REPLACE, AND THE 0059 LESSON
-- --------------------------------------
-- Postgres has no "add a branch" operation, so the whole body of
-- fn_realtime_broadcast is restated below — reproduced from 0061 (which
-- reproduced it from 0016) with exactly one WHEN arm widened. 0059 became a
-- live privilege escalation by dropping arms during a CREATE OR REPLACE, and
-- this function is shared by ELEVEN other tables, so §3's post-condition
-- asserts every one of their triggers still stands rather than trusting the
-- reproduction. The signature is unchanged (RETURNS TRIGGER, no arguments),
-- so this is a body swap and not the 42P13 return-type change that bit 0059.
--
-- Idempotent: CREATE OR REPLACE, DROP TRIGGER IF EXISTS. Safe to re-run.
-- No table DDL, no policy change, no grant change.
-- =============================================================================


-- =============================================================================
-- 1. THE FUNCTION — one arm widened
-- =============================================================================
--
-- `milestones` joins the plain project_id branch rather than getting a branch
-- of its own: 0067 gave the table a NOT NULL project_id column, exactly like
-- phases, assets, tasks and files. The parent-join arms below exist only for
-- tables that have no project_id of their own.

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
  -- silently. Probes for the FUNCTION, not just the schema — a stack carrying
  -- the schema without broadcast_changes would pass a schema-only check and
  -- then raise a WARNING on every single write.
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
    -- 0077: milestones joins this arm. It has its own project_id (0067).
    WHEN 'phases', 'assets', 'tasks', 'files', 'project_members', 'milestones' THEN
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

  -- Unroutable (cascade delete with the parent already gone, dead-end comment
  -- walk): skip. The subtree's own parent event already told clients
  -- everything they need.
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
  -- failure NEVER aborts the user's write. A missed event degrades to the
  -- reconnect refetch path on the client.
  RAISE WARNING 'realtime broadcast failed for %.% (%): %',
    TG_TABLE_NAME, v_row ->> 'id', TG_OP, SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_realtime_broadcast() FROM PUBLIC, anon, authenticated;


-- =============================================================================
-- 2. THE TRIGGER
-- =============================================================================
--
-- AFTER INSERT OR UPDATE OR DELETE, FOR EACH ROW, exactly as the other twelve
-- carry it. All three operations matter and none is optional:
--   INSERT — a colleague adds a key date and it appears;
--   UPDATE — the same event carries a retitle, a date move, a soft DELETE
--            (deleted_at set) and a RESTORE (deleted_at cleared). Ruling 38's
--            trash is delivered entirely through this one operation;
--   DELETE — the hard delete behind `?purge=1` and the undo of a create.

DROP TRIGGER IF EXISTS trg_milestones_realtime ON public.milestones;
CREATE TRIGGER trg_milestones_realtime
  AFTER INSERT OR UPDATE OR DELETE ON public.milestones
  FOR EACH ROW EXECUTE FUNCTION public.fn_realtime_broadcast();


-- =============================================================================
-- 3. POST-CONDITIONS — assert, do not assume
-- =============================================================================
--
-- 0027 taught this the expensive way: a migration can be green and have
-- changed nothing.
--
-- What is deliberately NOT asserted here: that scenes, shots, levels and
-- experiences still have no realtime trigger. It is true today and it is
-- Audrey's ruling, but a post-condition that fails on a legitimate future
-- widening is the guarded-narrowing trap 0061's header describes — a replay
-- of this file after a later migration adds one would abort for no reason.
-- That half of the ruling is pinned in supabase/tests/rls/72_milestone_realtime.sql
-- instead, where changing it is a deliberate act with a diff.

DO $$
DECLARE
  t         TEXT;
  v_def     TEXT;
  v_body    TEXT;
  v_hits    INT;
  v_tgtype  SMALLINT;
BEGIN
  -- 3a. The new trigger exists, on the right table, running the right
  --     function. `has_trigger` by name alone would pass a trigger pointed at
  --     something else entirely.
  SELECT tg.tgtype INTO v_tgtype
    FROM pg_trigger tg
    JOIN pg_proc p ON p.oid = tg.tgfoid
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE tg.tgrelid = 'public.milestones'::regclass
     AND tg.tgname  = 'trg_milestones_realtime'
     AND n.nspname  = 'public'
     AND p.proname  = 'fn_realtime_broadcast';

  IF v_tgtype IS NULL THEN
    RAISE EXCEPTION
      '0077: trg_milestones_realtime is not attached to public.milestones, or does not run public.fn_realtime_broadcast';
  END IF;

  -- 3b. ...and it fires on all three operations, FOR EACH ROW, AFTER.
  --     pg_trigger.tgtype bits: 1 = ROW, 2 = BEFORE, 4 = INSERT, 8 = DELETE,
  --     16 = UPDATE. A trigger created for INSERT alone would satisfy 3a and
  --     deliver no trash event at all, which is the half of ruling 38 that
  --     this migration exists to carry.
  IF (v_tgtype & 1) = 0 THEN
    RAISE EXCEPTION '0077: trg_milestones_realtime is not FOR EACH ROW (tgtype=%)', v_tgtype;
  END IF;
  IF (v_tgtype & 2) <> 0 THEN
    RAISE EXCEPTION '0077: trg_milestones_realtime is a BEFORE trigger (tgtype=%)', v_tgtype;
  END IF;
  IF (v_tgtype & 4) = 0 OR (v_tgtype & 8) = 0 OR (v_tgtype & 16) = 0 THEN
    RAISE EXCEPTION
      '0077: trg_milestones_realtime does not cover INSERT, UPDATE and DELETE (tgtype=%)', v_tgtype;
  END IF;

  -- 3c. The arm is really in the body, and in the RIGHT branch. The trigger
  --     can be attached and correct while the function has no idea what a
  --     milestone is: v_project resolves to NULL, the function returns early,
  --     and NOTHING is broadcast, with no error anywhere. That is precisely
  --     the failure this whole file is one line of defence against.
  --
  --     🚨 COMMENTS ARE STRIPPED FIRST. pg_get_functiondef returns the source
  --     INCLUDING its comments, so a line reading
  --     `-- WHEN 'project_members', 'milestones' THEN` satisfied the first
  --     version of this check with the arm deleted (R1). Everything below
  --     tests v_body, never v_def.
  SELECT pg_get_functiondef('public.fn_realtime_broadcast()'::regprocedure)
    INTO v_def;
  v_body := regexp_replace(v_def, '--[^' || chr(10) || ']*', '', 'g');

  IF v_body NOT LIKE '%''project_members'', ''milestones''%' THEN
    RAISE EXCEPTION
      '0077: fn_realtime_broadcast has no milestones arm in the project_id branch — the trigger would fire and resolve no project';
  END IF;

  --     ...and it appears EXACTLY ONCE. PL/pgSQL CASE takes the FIRST matching
  --     arm, so an earlier `WHEN ''milestones'' THEN v_project := NULL` would
  --     shadow the real one while the LIKE above still matched (R1).
  v_hits := (length(v_body) - length(replace(v_body, '''milestones''', '')))
            / length('''milestones''');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION
      '0077: ''milestones'' appears % times in fn_realtime_broadcast; exactly one arm may name it, or an earlier arm shadows the real one', v_hits;
  END IF;

  -- 3d. 🚨 EVERY OTHER ARM SURVIVED THE RETYPED BODY.
  --
  --     The first version of this block looped over the eleven triggers and
  --     said it was guarding against 0059's dropped arms. R1 pointed out that
  --     it cannot: pg_trigger holds the function's OID, and CREATE OR REPLACE
  --     does not change the OID, so replacing a body can never detach a
  --     trigger. The check named the right risk and then measured something
  --     else — which is the shape of a reassuring instrument.
  --
  --     The risk when a shared body is RETYPED from another migration is that
  --     one of the eleven other WHEN arms is lost. Every trigger stays
  --     attached, v_project comes back NULL for that table, the function
  --     RETURNs before broadcasting, and a collaborator simply stops seeing
  --     other people's work appear — on a table nobody edited, with nothing
  --     raised anywhere. So each table name is checked in the BODY.
  --
  --     The trigger loop is kept underneath it: cheap, and it does catch the
  --     different failure of a fresh environment where a migration was
  --     skipped.
  FOREACH t IN ARRAY ARRAY['projects','phases','assets','tasks','files',
                           'comments','task_dependencies','phase_dependencies',
                           'task_links','asset_versions','project_members']
  LOOP
    IF v_body NOT LIKE '%''' || t || '''%' THEN
      RAISE EXCEPTION
        '0077: fn_realtime_broadcast no longer names % — an arm was lost while the body was retyped', t;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
       WHERE tgrelid = ('public.' || quote_ident(t))::regclass
         AND tgname  = 'trg_' || t || '_realtime'
    ) THEN
      RAISE EXCEPTION '0077: trg_%_realtime is not attached', t;
    END IF;
  END LOOP;

  RAISE NOTICE '0077: milestones broadcast on rabbit:project:{id}; all 12 project triggers present';
END $$;


-- =============================================================================
-- 4. COMMENTS — the claims two earlier files make are now false
-- =============================================================================

-- 0016 said 10 tables; 0061 made it 11 and did not update this; 0077 makes 12.
COMMENT ON FUNCTION public.fn_realtime_broadcast() IS
  'Session 7 (0016): publishes every write on the project-scoped RABBIT tables to the private topic rabbit:project:{project_id} via realtime.broadcast_changes. Full old/new rows — soft deletes and restores deliver, unlike postgres_changes under the 0014 SELECT policies. Never aborts the write. TWELVE tables as of 0077: projects, phases, assets, tasks, files, comments, task_dependencies, phase_dependencies (0061), task_links, asset_versions, project_members, milestones (0077).';

-- 0067 ended "Not broadcast and not edit-history captured, the same limit
-- scenes/levels/experiences carry". Half of that is now wrong, and the other
-- half is now a DIFFERENCE rather than a shared limit — which is Audrey's
-- explicit choice and has to read as one.
COMMENT ON TABLE public.milestones IS
  'Dated markers on a project timeline (TimelineView.jsx, and rows on the Tasks tab). Soft-delete from day one — ruling 38 — through 0014''s soft_delete_row/restore_soft_deleted, whose allowlist 0067 extends. BROADCAST since 0077 (Audrey, 2026-09-07: key dates live-sync between windows like tasks) — key dates ONLY: scenes, shots, levels and experiences keep the reload limit by her explicit choice, recorded in SYSTEMS_HANDBOOK §4.5 and §13.3 as a conscious difference rather than an oversight. Still NOT edit-history captured (0012); that limit is unchanged.';
