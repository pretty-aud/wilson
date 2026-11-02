-- =============================================================================
-- 0108_private_project_money_and_history.sql — M.O.T.H. Session 1 (MO1), the
-- privacy repairs, part B (docs/design/MOTH_DESIGN.md §1.4 "0108" and §2.6 R7
-- and R8).
--
-- WHAT IS WRONG TODAY (read in the code and on a stack built from 0000 to
-- 0107, 2026-11-02)
-- -------------------------------------------------------------------------
-- (1) The money gate has no privacy arm. can_access_project_money (0037) is
--     true for a workspace admin or for a project_members row with
--     project_role = 'manager'. A manager SEAT on a project that its creator
--     later made private still opens the project's budget lines, actuals,
--     versions, expenses, rate overrides and the INVOICES / RECEIPTS / LEGAL
--     storage paths, although projects_select (0072) hides the project from
--     that person. can_access_project_legal (0092) calls the money gate first,
--     so the Legal audience inherits the same hole through its money leg.
-- (2) Edit history has no project audience. edit_history_select (0012, 0088,
--     0092) admits every workspace admin and manager to every row of the
--     workspace: a private project's task titles, asset names, comments and
--     phase dates reach every manager through the history panel. Only files
--     rows carry a project_id (0088's snapshot), and that snapshot reads the
--     LIVE files row first, so a file moved from P to Q has its whole P-era
--     history stamped Q and handed to Q's readers (SEC-1).
--
-- WHAT THIS FILE DOES
-- -------------------
--   §1  can_access_project_money: 0037's body with AND
--       passes_project_privacy(p_project) between the workspace EXISTS and
--       the role arm (R7). Same signature, grants and language. Its COMMENT
--       and passes_project_privacy's COMMENT are restated (new callers).
--   §2  edit_history.captured_private boolean NOT NULL DEFAULT false: whether
--       the row's project was private when the change was captured.
--   §3  edit_history_project_of(entity_type, row): the project a row of one of
--       0061's fourteen captured tables belongs to, now (R8 a);
--       edit_history_value_at and edit_history_project_at: the value of one
--       column, and the project, at a past moment, walked back from the
--       history itself (R8 e). All three DEFINER, revoked from clients.
--   §4  fn_edit_history_capture: 0061's body word for word plus both sides'
--       projects (a change that crosses projects, or a dependency whose
--       endpoints sit in different projects, gets NULL: admins only), the
--       captured_private flag, and topic_epoch in the noise list (R8 b).
--   §5  fn_edit_history_money_snapshot: 0092's body word for word plus one
--       line: an update whose diff carries project_id gets NULL (R8 d).
--   §6  The backfill (R8 e), as a revoked function, edit_history_restamp,
--       run once here: counts and time are written as a NOTICE; the hand-off
--       records them per environment. A project deleted for good leaves its
--       history to the admins (trg_projects_edit_history_gone), so a later
--       holder of its id reads none of it.
--   §7  edit_history_select: 0092's body word for word plus the arm
--       `rate cards OR admin OR (can_read_project_topic(project_id) AND (NOT
--       captured_private OR the caller created the project))` (R8 f).
--   §8  Post-conditions.
--
-- 🚨 0092 is NOT re-runnable after this file as it stands: its post-condition
-- 10 pins edit_history_select whole and post-condition 12 pins 0037's money
-- body, and both are restated here. The order that restores everything is:
-- re-run 0037, then 0092, then THIS file. Re-run THIS file after any replay
-- of 0012, 0037, 0061, 0082, 0088 or 0092 (a replay of 0088 or 0092 puts back
-- the policy without the project arm and the snapshot without the move line,
-- silently). Accepted, fail-closed narrowings (PR-07): a
-- cascaded child delete whose parent is already gone, and the history of a
-- trashed project, become admins only. One transaction, no enum. Suite:
-- supabase/tests/rls/111_private_project_money_and_history.sql.
-- =============================================================================

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.can_access_project_legal(uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'edit_history' AND column_name = 'is_legal') THEN
    RAISE EXCEPTION '0108 refused: 0092''s Legal objects (can_access_project_legal, edit_history.is_legal) are missing';
  END IF;
  IF to_regprocedure('public.fn_projects_owner_guard()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'topic_epoch') THEN
    RAISE EXCEPTION '0108 refused: 0107 is not applied (fn_projects_owner_guard, projects.topic_epoch)';
  END IF;
  IF to_regprocedure('public.passes_project_privacy(uuid)') IS NULL
     OR to_regprocedure('public.can_read_project_topic(uuid)') IS NULL
     OR to_regprocedure('public.fn_comment_project_id(text, uuid)') IS NULL
     OR to_regprocedure('public.fn_try_uuid(text)') IS NULL THEN
    RAISE EXCEPTION '0108 refused: passes_project_privacy (0082), can_read_project_topic (0016), fn_comment_project_id or fn_try_uuid is missing';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
         AND tgfoid = 'public.fn_edit_history_capture()'::regprocedure) <> 14 THEN
    RAISE EXCEPTION '0108 refused: fn_edit_history_capture is not attached to 0061''s fourteen tables';
  END IF;
END $$;

-- §1 The money gate: the privacy arm (R7) -----------------------------------------
-- 0037's body, word for word, with one conjunct between the workspace EXISTS
-- and the role arm. A manager seat on a private project the caller can no
-- longer see opens nothing; the creator and the workspace admins keep it.
CREATE OR REPLACE FUNCTION public.can_access_project_money(p_project uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.projects p
            WHERE p.id = p_project
              AND p.workspace_id = public.current_workspace_id()
              AND public.has_active_membership(p.workspace_id)
         )
     AND public.passes_project_privacy(p_project)
     AND (
           public.current_app_role() = 'admin'
        OR public.project_role_for(p_project) = 'manager'
         );
$$;

COMMENT ON FUNCTION public.can_access_project_money(uuid) IS
  'The money gate: TRUE only for a workspace admin of the project''s own workspace, or a project_members row with project_role = manager — and, since 0108, only on a project the caller may see (passes_project_privacy: not private, or the caller created it, or the caller is a workspace admin), so a manager seat on a private project opens nothing. Deliberately has NO unstaffed-project opening — unlike can_write_project() — because money fails closed. Guards budget_lines, budget_actuals, budget_versions, expenses and project_rate_overrides, for both read and write, and the money storage paths. Privacy narrows it; nothing widens it.';

COMMENT ON FUNCTION public.passes_project_privacy(uuid) IS
  '0082: the privacy arm of projects_select (0072) — the project is not private, or the caller created it, or the caller is a workspace admin — restated for SECURITY DEFINER bodies, which bypass RLS and cannot delegate to the policy (a SECURITY INVOKER helper called from a definer body runs as the owner). Callers: milestones_trash_index, fn_trash_authz (0082); reserve_upload_bytes, log_file_downloaded (0083); can_access_project_legal (0092); can_access_project_money (0108). Keep it word-for-word with the policy; suites 82, 83, 95 and 111 and those migrations'' post-conditions pin it. No client role executes it.';

-- §2 edit_history.captured_private ------------------------------------------------
-- DEFAULT true, so any writer that leaves the flag out fails closed (review
-- round 1, F4); the capture always writes it and the backfill sets every row.
ALTER TABLE public.edit_history
  ADD COLUMN IF NOT EXISTS captured_private boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.edit_history.captured_private IS
  '0108: whether the row''s project was private when the change was captured (for a projects row, private on either side of the change). A row captured while private is read only by the project''s creator and the workspace admins, even after the project is made public again (edit_history_select). DEFAULT true: a writer that leaves it out fails closed. Rate cards: false.';

COMMENT ON COLUMN public.edit_history.project_id IS
  '0108 (first 0088, files rows only): the project the captured row belonged to when the change was made, for every project-scoped type (edit_history_project_of in the capture; the files snapshot for files). NULL — the workspace admins'' alone — for a change between projects, a dependency whose endpoints sit in different projects, a child whose parent was already gone (a cascade), an unresolvable row, every row of a project that has been deleted for good (trg_projects_edit_history_gone), and rate cards (workspace-level). What edit_history_select hands can_read_project_topic, can_access_project_money and can_access_project_legal.';

-- The walk's lookups (one entity's rows in the order they were written) and
-- the purge trigger's (one project's rows). Without the first, the backfill
-- scans the table once per row (review round 1, F6).
CREATE INDEX IF NOT EXISTS idx_edit_history_entity_walk
  ON public.edit_history (entity_type, entity_id, id);
CREATE INDEX IF NOT EXISTS idx_edit_history_project
  ON public.edit_history (project_id) WHERE project_id IS NOT NULL;

-- A project deleted for good takes its history out of every audience but the
-- admins'. Its id can be created again (projects.id is the client's to send),
-- and without this the new holder would read the old project's history —
-- its private-era rows through the creator arm, its invoices through the
-- money gate (review round 1, F1). Statement-level, so it runs after the
-- cascaded children's own captures have been written.
CREATE OR REPLACE FUNCTION public.fn_edit_history_project_gone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.edit_history eh
     SET project_id = NULL
   WHERE eh.project_id IN (SELECT o.id FROM old_rows o);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_edit_history_project_gone() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_projects_edit_history_gone ON public.projects;
CREATE TRIGGER trg_projects_edit_history_gone
  AFTER DELETE ON public.projects
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_edit_history_project_gone();

COMMENT ON FUNCTION public.fn_edit_history_project_gone() IS
  '0108: after a projects DELETE (statement-level, transition table), sets project_id NULL on every edit_history row of the deleted projects, so a project deleted for good leaves its history to the workspace admins and a later holder of the same id reads none of it. DEFINER; no client role executes it.';

-- §3 The resolver and the walk (R8 a, e) --------------------------------------------
-- The project a row of one of 0061's fourteen captured tables belongs to, read
-- from the row and, for child types, from the parent as it is now. A
-- dependency belongs to a project only when both endpoints sit in it. Rate
-- cards are workspace-level: NULL. Any other type, or any error: NULL.
CREATE OR REPLACE FUNCTION public.edit_history_project_of(p_entity_type text, p_row jsonb)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project uuid;
BEGIN
  IF p_row IS NULL THEN
    RETURN NULL;
  END IF;
  CASE p_entity_type
    WHEN 'projects' THEN
      v_project := public.fn_try_uuid(p_row ->> 'id');
    WHEN 'phases', 'assets', 'tasks', 'files', 'ingestion_runs' THEN
      v_project := public.fn_try_uuid(p_row ->> 'project_id');
    WHEN 'comments' THEN
      v_project := public.fn_comment_project_id(p_row ->> 'entity_type', public.fn_try_uuid(p_row ->> 'entity_id'));
    WHEN 'asset_versions' THEN
      SELECT a.project_id INTO v_project FROM public.assets a
       WHERE a.id = public.fn_try_uuid(p_row ->> 'asset_id');
    WHEN 'task_links' THEN
      SELECT t.project_id INTO v_project FROM public.tasks t
       WHERE t.id = public.fn_try_uuid(p_row ->> 'task_id');
    WHEN 'ingestion_chunks' THEN
      SELECT r.project_id INTO v_project FROM public.ingestion_runs r
       WHERE r.id = public.fn_try_uuid(p_row ->> 'run_id');
    WHEN 'task_dependencies' THEN
      SELECT a.project_id INTO v_project
        FROM public.tasks a JOIN public.tasks b ON b.project_id = a.project_id
       WHERE a.id = public.fn_try_uuid(p_row ->> 'predecessor_id')
         AND b.id = public.fn_try_uuid(p_row ->> 'successor_id');
    WHEN 'phase_dependencies' THEN
      SELECT a.project_id INTO v_project
        FROM public.phases a JOIN public.phases b ON b.project_id = a.project_id
       WHERE a.id = public.fn_try_uuid(p_row ->> 'predecessor_id')
         AND b.id = public.fn_try_uuid(p_row ->> 'successor_id');
    ELSE
      v_project := NULL;  -- rate_cards, rate_card_entries, and anything else
  END CASE;
  RETURN v_project;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.edit_history_project_of(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edit_history_project_of(text, jsonb) TO service_role;

COMMENT ON FUNCTION public.edit_history_project_of(text, jsonb) IS
  '0108: the project a row of one of 0061''s fourteen edit-history tables belongs to: projects by id; phases, assets, tasks, files and ingestion_runs by project_id; comments through fn_comment_project_id; asset_versions, task_links and ingestion_chunks through their parent as it is now; a task or phase dependency only when both endpoints sit in one project; rate cards (workspace-level) and any other type NULL; any error NULL. Called by fn_edit_history_capture for both sides of a change. DEFINER; no client role executes it.';

-- The value one column of one captured entity had at a past moment, read
-- from the history itself: (1) the 'old' side of the first LATER history row
-- of that entity that changed the column (an update carrying it, or the
-- delete); else (2) the live row, when it already existed then; else (3) the
-- side as it stood of the LATEST row at or before that moment that carries
-- the column (a delete's old, an update's new, a create's new) — never the
-- create row alone, which would hand a moved-then-deleted entity back to its
-- first project (review round 1, F5). With p_after (a history row's id) the
-- order is by id: one entity's rows are written in the order its changes
-- were made, while created_at is each transaction's start and can disagree
-- (review round 1, F7). Without it, by created_at.
CREATE OR REPLACE FUNCTION public.edit_history_value_at(
  p_entity_type text, p_entity_id uuid, p_key text, p_at timestamptz, p_after bigint DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_types CONSTANT text[] := ARRAY['projects', 'phases', 'assets', 'tasks', 'task_dependencies', 'task_links',
    'files', 'asset_versions', 'comments', 'rate_cards', 'rate_card_entries', 'ingestion_runs',
    'ingestion_chunks', 'phase_dependencies'];
  v      text;
  v_live boolean := false;
BEGIN
  IF p_entity_id IS NULL OR p_key IS NULL OR (p_at IS NULL AND p_after IS NULL)
     OR NOT (p_entity_type = ANY (c_types)) THEN
    RETURN NULL;
  END IF;

  SELECT CASE eh.action WHEN 'update' THEN eh.diff -> p_key ->> 'old' ELSE eh.diff -> 'old' ->> p_key END
    INTO v
    FROM public.edit_history eh
   WHERE eh.entity_type = p_entity_type AND eh.entity_id = p_entity_id
     AND ((eh.action = 'update' AND eh.diff ? p_key) OR eh.action = 'delete')
     AND CASE WHEN p_after IS NOT NULL THEN eh.id > p_after ELSE eh.created_at > p_at END
   ORDER BY eh.id
   LIMIT 1;
  IF FOUND THEN
    RETURN v;
  END IF;

  -- The live row, when it already existed at p_at (a files id is the
  -- client's to choose, so a newer row holding an old id does not vote).
  -- Static per table (a planned statement each), not one dynamic EXECUTE
  -- re-planned on every call: the backfill calls this for every row.
  CASE p_entity_type
    WHEN 'projects'           THEN SELECT to_jsonb(t) ->> p_key, true INTO v, v_live FROM public.projects t           WHERE t.id = p_entity_id AND COALESCE(t.created_at <= p_at, true);
    WHEN 'phases'             THEN SELECT to_jsonb(t) ->> p_key, true INTO v, v_live FROM public.phases t             WHERE t.id = p_entity_id AND COALESCE(t.created_at <= p_at, true);
    WHEN 'assets'             THEN SELECT to_jsonb(t) ->> p_key, true INTO v, v_live FROM public.assets t             WHERE t.id = p_entity_id AND COALESCE(t.created_at <= p_at, true);
    WHEN 'tasks'              THEN SELECT to_jsonb(t) ->> p_key, true INTO v, v_live FROM public.tasks t              WHERE t.id = p_entity_id AND COALESCE(t.created_at <= p_at, true);
    WHEN 'files'              THEN SELECT to_jsonb(t) ->> p_key, true INTO v, v_live FROM public.files t              WHERE t.id = p_entity_id AND COALESCE(t.created_at <= p_at, true);
    WHEN 'ingestion_runs'     THEN SELECT to_jsonb(t) ->> p_key, true INTO v, v_live FROM public.ingestion_runs t     WHERE t.id = p_entity_id AND COALESCE(t.created_at <= p_at, true);
    WHEN 'asset_versions'     THEN SELECT to_jsonb(t) ->> p_key, true INTO v, v_live FROM public.asset_versions t     WHERE t.id = p_entity_id AND COALESCE(t.created_at <= p_at, true);
    WHEN 'task_links'         THEN SELECT to_jsonb(t) ->> p_key, true INTO v, v_live FROM public.task_links t         WHERE t.id = p_entity_id AND COALESCE(t.created_at <= p_at, true);
    WHEN 'ingestion_chunks'   THEN SELECT to_jsonb(t) ->> p_key, true INTO v, v_live FROM public.ingestion_chunks t   WHERE t.id = p_entity_id AND COALESCE(t.created_at <= p_at, true);
    WHEN 'comments'           THEN SELECT to_jsonb(t) ->> p_key, true INTO v, v_live FROM public.comments t           WHERE t.id = p_entity_id AND COALESCE(t.created_at <= p_at, true);
    WHEN 'task_dependencies'  THEN SELECT to_jsonb(t) ->> p_key, true INTO v, v_live FROM public.task_dependencies t  WHERE t.id = p_entity_id AND COALESCE(t.created_at <= p_at, true);
    WHEN 'phase_dependencies' THEN SELECT to_jsonb(t) ->> p_key, true INTO v, v_live FROM public.phase_dependencies t WHERE t.id = p_entity_id AND COALESCE(t.created_at <= p_at, true);
    WHEN 'rate_cards'         THEN SELECT to_jsonb(t) ->> p_key, true INTO v, v_live FROM public.rate_cards t         WHERE t.id = p_entity_id AND COALESCE(t.created_at <= p_at, true);
    WHEN 'rate_card_entries'  THEN SELECT to_jsonb(t) ->> p_key, true INTO v, v_live FROM public.rate_card_entries t  WHERE t.id = p_entity_id AND COALESCE(t.created_at <= p_at, true);
  END CASE;
  IF v_live THEN
    RETURN v;
  END IF;

  SELECT CASE eh.action WHEN 'update' THEN eh.diff -> p_key ->> 'new'
                        WHEN 'create' THEN eh.diff -> 'new' ->> p_key
                        ELSE eh.diff -> 'old' ->> p_key END
    INTO v
    FROM public.edit_history eh
   WHERE eh.entity_type = p_entity_type AND eh.entity_id = p_entity_id
     AND (eh.action IN ('create', 'delete') OR (eh.action = 'update' AND eh.diff ? p_key))
     AND CASE WHEN p_after IS NOT NULL THEN eh.id <= p_after ELSE eh.created_at <= p_at END
   ORDER BY eh.id DESC
   LIMIT 1;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.edit_history_value_at(text, uuid, text, timestamptz, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edit_history_value_at(text, uuid, text, timestamptz, bigint) TO service_role;

COMMENT ON FUNCTION public.edit_history_value_at(text, uuid, text, timestamptz, bigint) IS
  '0108: the value one column of one captured entity had at a past moment, walked back from edit_history: the old side of the first later row of that entity that changed it (an update carrying it, or the delete), else the live row when it already existed then, else the latest row at or before that moment that carries it (a delete''s old, an update''s new, a create''s new). Ordered by history id when p_after is given, else by created_at. Used by edit_history_project_at and edit_history_restamp (kept for replay). DEFINER; no client role executes it.';

-- The project one captured entity belonged to at a past moment. p_row is the
-- whole row the history row carries (a create's new side, a delete's old
-- side), or NULL for an update, whose diff holds only what changed.
-- p_as_parent: the entity is the PARENT of the row being placed (a task
-- link's task, a dependency's endpoint, a comment's subject). A parent that
-- was already gone at that moment places the child nowhere — NULL, as the
-- live capture does for a cascaded child, whose parent row is deleted first.
CREATE OR REPLACE FUNCTION public.edit_history_project_at(
  p_entity_type text, p_entity_id uuid, p_row jsonb, p_at timestamptz, p_after bigint DEFAULT NULL,
  p_as_parent boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent  uuid;
  v_kind    text;
  v_a       uuid;
  v_b       uuid;
  v_last    text;
BEGIN
  IF p_entity_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_as_parent THEN
    -- Gone at that moment: its latest create or delete row at or before it
    -- is the delete. By history id when p_after is given: a cascade's parent
    -- delete row is written before the child's (the RI cascade runs with
    -- its triggers queued behind the parent's; measured, review round 1).
    SELECT eh.action INTO v_last
      FROM public.edit_history eh
     WHERE eh.entity_type = p_entity_type AND eh.entity_id = p_entity_id
       AND eh.action IN ('create', 'delete')
       AND CASE WHEN p_after IS NOT NULL THEN eh.id <= p_after ELSE eh.created_at <= p_at END
     ORDER BY eh.id DESC
     LIMIT 1;
    IF v_last = 'delete' THEN
      RETURN NULL;
    END IF;
  END IF;
  CASE p_entity_type
    WHEN 'projects' THEN
      RETURN p_entity_id;
    WHEN 'phases', 'assets', 'tasks', 'files', 'ingestion_runs' THEN
      RETURN public.fn_try_uuid(COALESCE(p_row ->> 'project_id',
               public.edit_history_value_at(p_entity_type, p_entity_id, 'project_id', p_at, p_after)));
    WHEN 'asset_versions' THEN
      v_parent := public.fn_try_uuid(COALESCE(p_row ->> 'asset_id',
                    public.edit_history_value_at(p_entity_type, p_entity_id, 'asset_id', p_at, p_after)));
      RETURN public.edit_history_project_at('assets', v_parent, NULL, p_at, p_after, true);
    WHEN 'task_links' THEN
      v_parent := public.fn_try_uuid(COALESCE(p_row ->> 'task_id',
                    public.edit_history_value_at(p_entity_type, p_entity_id, 'task_id', p_at, p_after)));
      RETURN public.edit_history_project_at('tasks', v_parent, NULL, p_at, p_after, true);
    WHEN 'ingestion_chunks' THEN
      v_parent := public.fn_try_uuid(COALESCE(p_row ->> 'run_id',
                    public.edit_history_value_at(p_entity_type, p_entity_id, 'run_id', p_at, p_after)));
      RETURN public.edit_history_project_at('ingestion_runs', v_parent, NULL, p_at, p_after, true);
    WHEN 'comments' THEN
      v_kind   := COALESCE(p_row ->> 'entity_type',
                    public.edit_history_value_at(p_entity_type, p_entity_id, 'entity_type', p_at, p_after));
      v_parent := public.fn_try_uuid(COALESCE(p_row ->> 'entity_id',
                    public.edit_history_value_at(p_entity_type, p_entity_id, 'entity_id', p_at, p_after)));
      RETURN CASE v_kind
               WHEN 'project' THEN public.edit_history_project_at('projects', v_parent, NULL, p_at, p_after, true)
               WHEN 'phase'   THEN public.edit_history_project_at('phases', v_parent, NULL, p_at, p_after, true)
               WHEN 'asset'   THEN public.edit_history_project_at('assets', v_parent, NULL, p_at, p_after, true)
               WHEN 'task'    THEN public.edit_history_project_at('tasks', v_parent, NULL, p_at, p_after, true)
             END;
    WHEN 'task_dependencies', 'phase_dependencies' THEN
      v_a := public.edit_history_project_at(
               CASE p_entity_type WHEN 'task_dependencies' THEN 'tasks' ELSE 'phases' END,
               public.fn_try_uuid(COALESCE(p_row ->> 'predecessor_id',
                 public.edit_history_value_at(p_entity_type, p_entity_id, 'predecessor_id', p_at, p_after))),
               NULL, p_at, p_after, true);
      v_b := public.edit_history_project_at(
               CASE p_entity_type WHEN 'task_dependencies' THEN 'tasks' ELSE 'phases' END,
               public.fn_try_uuid(COALESCE(p_row ->> 'successor_id',
                 public.edit_history_value_at(p_entity_type, p_entity_id, 'successor_id', p_at, p_after))),
               NULL, p_at, p_after, true);
      RETURN CASE WHEN v_a = v_b THEN v_a END;
    ELSE
      RETURN NULL;  -- rate_cards, rate_card_entries, and anything else
  END CASE;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.edit_history_project_at(text, uuid, jsonb, timestamptz, bigint, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edit_history_project_at(text, uuid, jsonb, timestamptz, bigint, boolean) TO service_role;

COMMENT ON FUNCTION public.edit_history_project_at(text, uuid, jsonb, timestamptz, bigint, boolean) IS
  '0108: the project one captured entity belonged to at a past moment ("project at time t"), from the row the history row carries or, for an update, walked back through edit_history_value_at over the entity''s (or its parent''s) own recorded changes; a child whose parent was already gone at that moment (a cascade) NULL, as the live capture; a dependency only when both endpoints were in one project; rate cards NULL; any error NULL. Used by edit_history_restamp and kept for replay. DEFINER; no client role executes it.';

-- §4 The capture (R8 b) --------------------------------------------------------------
-- Reproduced in full from 0061, because Postgres has no "add a branch"
-- operation. The differences, each marked 0108: four declarations,
-- 'topic_epoch' in c_noise, the block that resolves both sides' projects and
-- the private flag, and project_id and captured_private in the INSERT.
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
  -- 0108: each side's project, the row's project, and whether it was private.
  v_pn      UUID;
  v_po      UUID;
  v_project UUID;
  v_priv    BOOLEAN;
  c_noise   CONSTANT TEXT[] :=
    ARRAY['updated_at', 'updated_by', 'last_updated_at', 'last_updated_by', 'topic_epoch'];
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

  -- ── 0108 (MO1): the project of BOTH sides. A change whose two sides sit
  -- in different projects (a move, a child re-pointed to another project's
  -- parent, a comment re-pointed), or a dependency whose endpoints differ,
  -- belongs to neither side's readers: project_id NULL, admins only.
  IF TG_OP <> 'INSERT' THEN
    v_po := public.edit_history_project_of(TG_TABLE_NAME, to_jsonb(OLD));
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_pn := public.edit_history_project_of(TG_TABLE_NAME, to_jsonb(NEW));
  END IF;
  v_project := CASE TG_OP
                 WHEN 'INSERT' THEN v_pn
                 WHEN 'DELETE' THEN v_po
                 ELSE CASE WHEN v_pn IS NOT DISTINCT FROM v_po THEN v_pn END
               END;
  -- A project that no longer exists (the row is a cascade of its deletion,
  -- written after trg_projects_edit_history_gone has run) names no one.
  IF v_project IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = v_project) THEN
    v_project := NULL;
  END IF;
  IF TG_TABLE_NAME IN ('rate_cards', 'rate_card_entries') THEN
    v_priv := false;
  ELSIF TG_TABLE_NAME = 'projects' THEN
    v_priv := COALESCE((to_jsonb(OLD) ->> 'is_private')::boolean, false)
           OR COALESCE((to_jsonb(NEW) ->> 'is_private')::boolean, false);
  ELSE
    v_priv := COALESCE((SELECT p.is_private FROM public.projects p WHERE p.id = v_project), true);
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
     action, diff, project_id, captured_private)
  VALUES
    (v_ws, TG_TABLE_NAME, (v_row ->> 'id')::uuid, v_actor, v_label,
     v_action, v_diff, v_project, v_priv);

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'edit_history capture failed for %.% (%): %',
    TG_TABLE_NAME, v_row ->> 'id', TG_OP, SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_edit_history_capture() FROM PUBLIC, anon, authenticated;

-- §5 The files snapshot: a move belongs to neither side (R8 d) ----------------------
-- 0092's body word for word, plus the one marked line. The classifier reads
-- the live row first, so a files update that moved the file would otherwise
-- be stamped with the destination and handed to its readers.
CREATE OR REPLACE FUNCTION public.fn_edit_history_money_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.entity_type IS DISTINCT FROM 'files' THEN
    RETURN NEW;
  END IF;
  SELECT c.is_money, c.project_id
    INTO NEW.is_financial, NEW.project_id
    FROM public.edit_history_file_class(NEW.entity_id, NEW.diff) c;
  -- 0108 (MO1): a change that moved the file between projects: admins only.
  IF NEW.action = 'update' AND NEW.diff ? 'project_id' THEN NEW.project_id := NULL; END IF;
  -- 0108 (MO1): and a file of a project that no longer exists (a cascade of
  -- the project's deletion): admins only, as fn_edit_history_capture.
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id) THEN NEW.project_id := NULL; END IF;
  NEW.is_financial := COALESCE(NEW.is_financial, true);
  NEW.is_legal := COALESCE(public.edit_history_file_is_legal(NEW.entity_id, NEW.diff), false);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  NEW.is_financial := true;
  NEW.is_legal := false;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_edit_history_money_snapshot() FROM PUBLIC, anon, authenticated;

-- §6 The backfill (R8 e) --------------------------------------------------------------
-- A revoked DEFINER function, so suite 111 can run it over crafted rows of the
-- shape history had before this file (review round 1, F8), and so a replay
-- can run it again. Over every row of edit_history:
--   (1) project_id through the walk, rate cards excepted (they keep NULL).
--       Every row is re-derived, files included: 0088's snapshot stamped
--       files rows from the LIVE row, so a moved file's, and a reused file
--       id's, earlier rows carry the wrong project (F3). An update whose own
--       diff carries its anchor key gets NULL (a move).
--   (2) NULL for every row of a project that no longer exists, and for every
--       row of a project written before that project's own latest create row
--       (an earlier holder of the same id; F1).
--   (3) captured_private: rate cards false; a row with no project true (it is
--       the admins' anyway); a projects create, delete or is_private update
--       from its own diff (a delete's old side, a flip's either side; F2);
--       anything else the project's is_private at that moment, walked back,
--       else true.
-- It returns the counts it changed. Re-running it changes nothing (suite 111).
CREATE OR REPLACE FUNCTION public.edit_history_restamp()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project bigint;
  v_gone    bigint;
  v_priv    bigint;
BEGIN
  UPDATE public.edit_history eh
     SET project_id = x.pid
    FROM (SELECT h.id,
                 CASE
                   WHEN h.action = 'update' AND h.diff ?| (CASE h.entity_type
                          WHEN 'projects'           THEN ARRAY['id']
                          WHEN 'asset_versions'     THEN ARRAY['asset_id']
                          WHEN 'task_links'         THEN ARRAY['task_id']
                          WHEN 'ingestion_chunks'   THEN ARRAY['run_id']
                          WHEN 'comments'           THEN ARRAY['entity_type', 'entity_id']
                          WHEN 'task_dependencies'  THEN ARRAY['predecessor_id', 'successor_id']
                          WHEN 'phase_dependencies' THEN ARRAY['predecessor_id', 'successor_id']
                          ELSE ARRAY['project_id'] END)
                     THEN NULL
                   ELSE public.edit_history_project_at(
                          h.entity_type, h.entity_id,
                          CASE h.action WHEN 'create' THEN h.diff -> 'new' WHEN 'delete' THEN h.diff -> 'old' END,
                          h.created_at, h.id)
                 END AS walked
            FROM public.edit_history h
           WHERE h.entity_type NOT IN ('rate_cards', 'rate_card_entries')) w
   CROSS JOIN LATERAL (
     SELECT CASE
              WHEN w.walked IS NULL THEN NULL
              WHEN NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = w.walked) THEN NULL
              WHEN w.id < (SELECT max(c.id) FROM public.edit_history c
                            WHERE c.entity_type = 'projects' AND c.entity_id = w.walked AND c.action = 'create') THEN NULL
              ELSE w.walked
            END AS pid) x
   WHERE w.id = eh.id
     AND eh.project_id IS DISTINCT FROM x.pid;
  GET DIAGNOSTICS v_project = ROW_COUNT;

  UPDATE public.edit_history eh
     SET project_id = NULL
   WHERE eh.project_id IS NOT NULL
     AND (NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = eh.project_id)
          OR eh.id < (SELECT max(c.id) FROM public.edit_history c
                       WHERE c.entity_type = 'projects' AND c.entity_id = eh.project_id AND c.action = 'create'));
  GET DIAGNOSTICS v_gone = ROW_COUNT;

  UPDATE public.edit_history eh
     SET captured_private = x.priv
    FROM (SELECT h.id,
                 CASE
                   WHEN h.entity_type IN ('rate_cards', 'rate_card_entries') THEN false
                   WHEN h.project_id IS NULL THEN true
                   WHEN h.entity_type = 'projects' AND h.action = 'create'
                     THEN COALESCE((h.diff -> 'new' ->> 'is_private')::boolean, false)
                   WHEN h.entity_type = 'projects' AND h.action = 'delete'
                     THEN COALESCE((h.diff -> 'old' ->> 'is_private')::boolean, false)
                   WHEN h.entity_type = 'projects' AND h.diff ? 'is_private'
                     THEN COALESCE((h.diff -> 'is_private' ->> 'old')::boolean, false)
                       OR COALESCE((h.diff -> 'is_private' ->> 'new')::boolean, false)
                   -- A project whose visibility never changed: its live value, no walk.
                   WHEN NOT EXISTS (SELECT 1 FROM public.edit_history f
                                     WHERE f.entity_type = 'projects' AND f.entity_id = h.project_id
                                       AND f.action = 'update' AND f.diff ? 'is_private')
                     THEN COALESCE((SELECT p.is_private FROM public.projects p WHERE p.id = h.project_id), true)
                   ELSE COALESCE(public.edit_history_value_at('projects', h.project_id, 'is_private', h.created_at, h.id)::boolean,
                                 true)
                 END AS priv
            FROM public.edit_history h) x
   WHERE x.id = eh.id
     AND eh.captured_private IS DISTINCT FROM x.priv;
  GET DIAGNOSTICS v_priv = ROW_COUNT;

  RETURN jsonb_build_object('project_set', v_project, 'project_gone', v_gone, 'captured_private_set', v_priv);
END;
$$;

REVOKE ALL ON FUNCTION public.edit_history_restamp() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edit_history_restamp() TO service_role;

COMMENT ON FUNCTION public.edit_history_restamp() IS
  '0108: (re)derives edit_history.project_id and captured_private for every row from the history itself (edit_history_project_at, edit_history_value_at): a move, a split dependency, a cascaded child, a deleted project and an earlier holder of a reused project id get NULL; rate cards NULL and not private. Run once by 0108 over the history written before it; re-running it changes nothing on rows the live capture wrote (suite 111). Returns the counts it changed. DEFINER; no client role executes it.';

DO $$
DECLARE
  v_total     bigint;
  v_null_pre  bigint;
  v_null_post bigint;
  v_priv_post bigint;
  v_res       jsonb;
  v_t0        timestamptz := clock_timestamp();
BEGIN
  SELECT count(*), count(*) FILTER (WHERE project_id IS NULL) INTO v_total, v_null_pre FROM public.edit_history;
  v_res := public.edit_history_restamp();
  SELECT count(*) FILTER (WHERE project_id IS NULL), count(*) FILTER (WHERE captured_private)
    INTO v_null_post, v_priv_post FROM public.edit_history;
  RAISE NOTICE '0108 backfill: % edit_history rows in % ms; project_id NULL before %, after %; changed %; captured_private true after %',
    v_total, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_null_pre, v_null_post, v_res, v_priv_post;
END $$;

-- §7 edit_history_select: the project audience (R8 f) -------------------------------
-- 0092's body word for word, then one conjunct: rate cards stay the
-- workspace's; otherwise a workspace admin, or a reader of the project's topic
-- (can_read_project_topic: the caller can see the project under
-- projects_select) — and, for a row captured while the project was private,
-- only its creator. A NULL project (a move, a split dependency, a cascaded
-- child, an unresolvable row) is the admins' alone.
DROP POLICY IF EXISTS edit_history_select ON public.edit_history;
CREATE POLICY edit_history_select ON public.edit_history
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.current_app_role() IN ('admin', 'manager')
    AND public.has_active_membership(workspace_id)
    -- 0088: the money arm. COALESCE: NULL would deny anyway; say so.
    -- 0092: and the Legal arm, for rows snapshotted is_legal.
    AND (NOT is_financial
         OR public.current_app_role() = 'admin'
         OR COALESCE(public.can_access_project_money(project_id), false)
         OR (is_legal AND COALESCE(public.can_access_project_legal(project_id), false)))
    -- 0108: the project audience.
    AND (entity_type IN ('rate_cards', 'rate_card_entries')
         OR public.current_app_role() = 'admin'
         OR (public.can_read_project_topic(project_id)
             AND (NOT captured_private
                  OR EXISTS (SELECT 1 FROM public.projects p
                              WHERE p.id = edit_history.project_id AND p.created_by = auth.uid()))))
  );

COMMENT ON POLICY edit_history_select ON public.edit_history IS
  '0012 restated by 0088, 0092 and 0108: workspace admins and managers read their workspace''s edit history; a files row flagged is_financial (an invoice, receipt or Legal file, snapshotted at capture) is read only by a workspace admin or the project''s managers (can_access_project_money) — or, when it is also is_legal (a Legal file, 0092), by the Legal audience (can_access_project_legal: workspace managers included). Since 0108 a row is also its project''s: rate cards stay the workspace''s, a workspace admin reads every row, anyone else only rows of a project they can see (can_read_project_topic), and a row captured while the project was private (captured_private) only its creator. A row with no project (a move between projects, a split dependency, a cascaded child) is the admins'' alone. Re-run 0108 after any replay of 0012, 0088 or 0092; 0092 is not re-runnable after 0108.';

-- §8 Post-conditions --------------------------------------------------------------------
DO $$
DECLARE
  v_body  TEXT;
  v_n     INTEGER;
  v       TEXT;
  r       RECORD;
BEGIN
  -- 1. The money gate, whole (whitespace collapsed); the privacy arm once.
  SELECT btrim(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_body
    FROM pg_proc WHERE oid = 'public.can_access_project_money(uuid)'::regprocedure;
  IF v_body IS DISTINCT FROM 'SELECT EXISTS ( SELECT 1 FROM public.projects p WHERE p.id = p_project AND p.workspace_id = public.current_workspace_id() AND public.has_active_membership(p.workspace_id) ) AND public.passes_project_privacy(p_project) AND ( public.current_app_role() = ''admin'' OR public.project_role_for(p_project) = ''manager'' );' THEN
    RAISE EXCEPTION '0108 post-condition 1 failed: can_access_project_money reads %', v_body;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.can_access_project_money(uuid)'::regprocedure
                  AND prosecdef AND provolatile = 's' AND proconfig @> ARRAY['search_path=public']) THEN
    RAISE EXCEPTION '0108 post-condition 1 failed: can_access_project_money must stay STABLE SECURITY DEFINER with search_path pinned';
  END IF;
  -- …and the Legal gate is still 0092's, whole.
  SELECT btrim(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_body
    FROM pg_proc WHERE oid = 'public.can_access_project_legal(uuid)'::regprocedure;
  IF v_body IS DISTINCT FROM 'SELECT COALESCE(public.can_access_project_money(p_project), false) OR COALESCE( public.current_app_role() = ''manager'' AND EXISTS ( SELECT 1 FROM public.projects p WHERE p.id = p_project AND p.workspace_id = public.current_workspace_id() AND public.has_active_membership(p.workspace_id) ) AND public.passes_project_privacy(p_project), false);' THEN
    RAISE EXCEPTION '0108 post-condition 1 failed: can_access_project_legal is no longer 0092''s body';
  END IF;

  -- 2. captured_private: boolean NOT NULL DEFAULT true (fails closed); the
  --    walk's index; the purge trigger, statement-level on projects DELETE.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'edit_history' AND column_name = 'captured_private'
                    AND data_type = 'boolean' AND is_nullable = 'NO' AND column_default = 'true') THEN
    RAISE EXCEPTION '0108 post-condition 2 failed: edit_history.captured_private is missing or mis-shaped (boolean NOT NULL DEFAULT true)';
  END IF;
  IF to_regclass('public.idx_edit_history_entity_walk') IS NULL OR to_regclass('public.idx_edit_history_project') IS NULL THEN
    RAISE EXCEPTION '0108 post-condition 2 failed: the walk''s or the purge''s index is missing';
  END IF;
  IF (SELECT pg_get_triggerdef(tg.oid) FROM pg_trigger tg
       WHERE tg.tgrelid = 'public.projects'::regclass AND tg.tgname = 'trg_projects_edit_history_gone' AND tg.tgenabled = 'O')
     IS DISTINCT FROM 'CREATE TRIGGER trg_projects_edit_history_gone AFTER DELETE ON public.projects REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION fn_edit_history_project_gone()' THEN
    RAISE EXCEPTION '0108 post-condition 2 failed: trg_projects_edit_history_gone is missing, disabled or mis-shaped';
  END IF;

  -- 3. The resolver, the walks, the restamp and the purge step: DEFINER,
  --    search_path pinned, closed to client roles (the three readers STABLE);
  --    each exists once; and the resolver's answer on synthetic rows.
  FOR r IN SELECT p.oid, p.proname, p.prosecdef, p.provolatile, p.proconfig FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('edit_history_project_of', 'edit_history_value_at', 'edit_history_project_at',
                                'edit_history_restamp', 'fn_edit_history_project_gone') LOOP
    IF NOT r.prosecdef OR r.proconfig IS NULL OR NOT ('search_path=public' = ANY (r.proconfig))
       OR (r.proname LIKE 'edit_history\_%' AND r.proname <> 'edit_history_restamp' AND r.provolatile <> 's') THEN
      RAISE EXCEPTION '0108 post-condition 3 failed: % must be SECURITY DEFINER with search_path pinned (and STABLE if it only reads)', r.proname;
    END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE') OR has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION '0108 post-condition 3 failed: a client role can EXECUTE %', r.proname;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
         AND proname IN ('edit_history_project_of', 'edit_history_value_at', 'edit_history_project_at',
                         'edit_history_restamp', 'fn_edit_history_project_gone')) <> 5 THEN
    RAISE EXCEPTION '0108 post-condition 3 failed: the resolver, the two walks, the restamp and the purge step must each exist once';
  END IF;
  IF public.edit_history_project_of('projects', '{"id": "00000000-0000-0000-0000-0000000001a8"}') IS DISTINCT FROM '00000000-0000-0000-0000-0000000001a8'::uuid
     OR public.edit_history_project_of('tasks', '{"project_id": "00000000-0000-0000-0000-0000000001a8"}') IS DISTINCT FROM '00000000-0000-0000-0000-0000000001a8'::uuid
     OR public.edit_history_project_of('rate_cards', '{"project_id": "00000000-0000-0000-0000-0000000001a8"}') IS NOT NULL
     OR public.edit_history_project_of('no_such_table', '{"project_id": "00000000-0000-0000-0000-0000000001a8"}') IS NOT NULL
     OR public.edit_history_project_of('tasks', '{"project_id": "not a uuid"}') IS NOT NULL THEN
    RAISE EXCEPTION '0108 post-condition 3 failed: edit_history_project_of does not resolve by the 0108 map, or is not fail-closed';
  END IF;

  -- 4. The capture: 0061's parent joins kept, both sides resolved, the two
  --    new columns written, topic_epoch in the noise list, the guard kept,
  --    and still on the fourteen tables.
  v_body := regexp_replace(regexp_replace(
              pg_get_functiondef('public.fn_edit_history_capture()'::regprocedure),
              '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g');
  IF strpos(v_body, 'WHEN ''phases'' THEN') = 0 OR strpos(v_body, 'WHEN ''ingestion_runs'' THEN') = 0
     OR strpos(v_body, 'WHEN ''asset_versions'' THEN') = 0 OR strpos(v_body, 'WHEN ''task_dependencies'' THEN') = 0
     OR strpos(v_body, 'WHEN ''phase_dependencies'' THEN') = 0 OR strpos(v_body, 'WHEN ''task_links'' THEN') = 0
     OR strpos(v_body, 'WHEN ''rate_card_entries'' THEN') = 0 OR strpos(v_body, 'WHEN ''ingestion_chunks'' THEN') = 0
     OR strpos(v_body, 'v_po := public.edit_history_project_of(TG_TABLE_NAME, to_jsonb(OLD));') = 0
     OR strpos(v_body, 'v_pn := public.edit_history_project_of(TG_TABLE_NAME, to_jsonb(NEW));') = 0
     OR strpos(v_body, 'ELSE CASE WHEN v_pn IS NOT DISTINCT FROM v_po THEN v_pn END') = 0
     OR strpos(v_body, 'IF v_project IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = v_project) THEN') = 0
     OR strpos(v_body, 'action, diff, project_id, captured_private)') = 0
     OR strpos(v_body, 'v_action, v_diff, v_project, v_priv);') = 0
     OR strpos(v_body, '''last_updated_by'', ''topic_epoch''') = 0
     OR strpos(v_body, 'EXCEPTION WHEN OTHERS THEN') = 0 THEN
    RAISE EXCEPTION '0108 post-condition 4 failed: fn_edit_history_capture is not 0061''s body with the 0108 additions';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_edit_history_capture()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_edit_history_capture()', 'EXECUTE') THEN
    RAISE EXCEPTION '0108 post-condition 4 failed: a client role can EXECUTE fn_edit_history_capture';
  END IF;
  SELECT count(*) INTO v_n FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'O'
     AND tgfoid = 'public.fn_edit_history_capture()'::regprocedure;
  IF v_n <> 14 THEN
    RAISE EXCEPTION '0108 post-condition 4 failed: fn_edit_history_capture is attached to % tables (expected 14)', v_n;
  END IF;

  -- 5. The snapshot: 0092's four lines and the move line; still the only
  --    trigger on edit_history.
  v_body := regexp_replace(regexp_replace(
              pg_get_functiondef('public.fn_edit_history_money_snapshot()'::regprocedure),
              '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g');
  IF strpos(v_body, 'SELECT c.is_money, c.project_id') = 0
     OR strpos(v_body, 'INTO NEW.is_financial, NEW.project_id') = 0
     OR strpos(v_body, 'NEW.is_financial := COALESCE(NEW.is_financial, true);') = 0
     OR strpos(v_body, 'NEW.is_legal := COALESCE(public.edit_history_file_is_legal(NEW.entity_id, NEW.diff), false);') = 0
     OR strpos(v_body, 'IF NEW.action = ''update'' AND NEW.diff ? ''project_id'' THEN NEW.project_id := NULL; END IF;') = 0
     OR strpos(v_body, 'IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id) THEN NEW.project_id := NULL; END IF;') = 0
     OR strpos(v_body, 'INTO NEW.is_financial, NEW.project_id') > strpos(v_body, 'NEW.project_id := NULL') THEN
    RAISE EXCEPTION '0108 post-condition 5 failed: fn_edit_history_money_snapshot is not 0092''s body with the move line after the classifier';
  END IF;
  IF (SELECT string_agg(tgname, ', ' ORDER BY tgname) FROM pg_trigger
       WHERE tgrelid = 'public.edit_history'::regclass AND NOT tgisinternal) IS DISTINCT FROM 'trg_edit_history_money' THEN
    RAISE EXCEPTION '0108 post-condition 5 failed: edit_history must carry exactly trg_edit_history_money';
  END IF;

  -- 6. The policy, whole; still the one policy; and scan S2 passes for it
  --    (every clause calls can_read_project_topic(project_id)).
  SELECT qual INTO v FROM pg_policies WHERE schemaname = 'public' AND tablename = 'edit_history' AND policyname = 'edit_history_select';
  IF v IS DISTINCT FROM '((workspace_id = current_workspace_id()) AND (current_app_role() = ANY (ARRAY[''admin''::text, ''manager''::text])) AND has_active_membership(workspace_id) AND ((NOT is_financial) OR (current_app_role() = ''admin''::text) OR COALESCE(can_access_project_money(project_id), false) OR (is_legal AND COALESCE(can_access_project_legal(project_id), false))) AND ((entity_type = ANY (ARRAY[''rate_cards''::text, ''rate_card_entries''::text])) OR (current_app_role() = ''admin''::text) OR (can_read_project_topic(project_id) AND ((NOT captured_private) OR (EXISTS ( SELECT 1' || chr(10) || '   FROM projects p' || chr(10) || '  WHERE ((p.id = edit_history.project_id) AND (p.created_by = auth.uid()))))))))' THEN
    RAISE EXCEPTION '0108 post-condition 6 failed: edit_history_select reads %', v;
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'edit_history') <> 1 THEN
    RAISE EXCEPTION '0108 post-condition 6 failed: edit_history must keep exactly one policy (SELECT); clients write nothing';
  END IF;

  -- 7. The history as restamped. (a) No move between projects names a
  --    project. (b) Rate cards carry none and are not private. (c) No row
  --    names a project that no longer exists, or a project whose own latest
  --    create row came after it (an earlier holder of the id). (d) No files
  --    create or delete row names a project other than the one its own diff
  --    names (0088 stamped those from the live row). (e) No projects create
  --    or delete row that says private is stamped not private. (Running the
  --    restamp again changes nothing: suite 111 proves it; it is not re-run
  --    here, where it would double the time the table is locked.)
  IF EXISTS (SELECT 1 FROM public.edit_history
              WHERE action = 'update' AND project_id IS NOT NULL
                AND entity_type IN ('phases', 'assets', 'tasks', 'files', 'ingestion_runs')
                AND diff ? 'project_id') THEN
    RAISE EXCEPTION '0108 post-condition 7a failed: a move between projects is still stamped with a project';
  END IF;
  IF EXISTS (SELECT 1 FROM public.edit_history
              WHERE entity_type IN ('rate_cards', 'rate_card_entries') AND (project_id IS NOT NULL OR captured_private)) THEN
    RAISE EXCEPTION '0108 post-condition 7b failed: a rate card row carries a project or is marked private';
  END IF;
  IF EXISTS (SELECT 1 FROM public.edit_history eh
              WHERE eh.project_id IS NOT NULL
                AND (NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = eh.project_id)
                     OR eh.id < (SELECT max(c.id) FROM public.edit_history c
                                  WHERE c.entity_type = 'projects' AND c.entity_id = eh.project_id AND c.action = 'create'))) THEN
    RAISE EXCEPTION '0108 post-condition 7c failed: a history row names a deleted project, or an earlier holder of a reused project id';
  END IF;
  IF EXISTS (SELECT 1 FROM public.edit_history
              WHERE entity_type = 'files' AND action IN ('create', 'delete') AND project_id IS NOT NULL
                AND project_id::text IS DISTINCT FROM COALESCE(diff -> 'new' ->> 'project_id', diff -> 'old' ->> 'project_id')) THEN
    RAISE EXCEPTION '0108 post-condition 7d failed: a files create or delete row names a project other than its own';
  END IF;
  IF EXISTS (SELECT 1 FROM public.edit_history
              WHERE entity_type = 'projects' AND project_id IS NOT NULL AND NOT captured_private
                AND COALESCE((diff -> 'new' ->> 'is_private')::boolean, (diff -> 'old' ->> 'is_private')::boolean, false)
                AND action IN ('create', 'delete')) THEN
    RAISE EXCEPTION '0108 post-condition 7e failed: a private project''s create or delete row is stamped not private';
  END IF;
END $$;
