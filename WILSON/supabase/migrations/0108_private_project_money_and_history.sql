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
--   §6  The backfill, through the walk (R8 e). Counts before and after are
--       written as NOTICEs; the hand-off records them per environment.
--   §7  edit_history_select: 0092's body word for word plus the arm
--       `rate cards OR admin OR (can_read_project_topic(project_id) AND (NOT
--       captured_private OR the caller created the project))` (R8 f).
--   §8  Post-conditions.
--
-- 🚨 0092 is NOT re-runnable after this file: its post-condition 10 pins
-- edit_history_select whole and post-condition 12 pins 0037's money body, and
-- both are restated here. Re-run THIS file after any replay of 0012, 0037,
-- 0061, 0082, 0088 or 0092. Accepted, fail-closed narrowings (PR-07): a
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
ALTER TABLE public.edit_history
  ADD COLUMN IF NOT EXISTS captured_private boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.edit_history.captured_private IS
  '0108: whether the row''s project was private when the change was captured (for a projects row, private on either side of the change). A row captured while private is read only by the project''s creator and the workspace admins, even after the project is made public again (edit_history_select).';

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
-- from the history itself: the 'old' side of the first LATER history row of
-- that entity that changed the column (an update carrying it, or the delete),
-- else the live row when it already existed then, else the entity's create
-- row. "Later" is (created_at, id) after (p_at, p_after): ids order rows
-- written in one transaction, which share created_at.
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
  v     text;
  v_n   integer;
BEGIN
  IF p_entity_id IS NULL OR p_key IS NULL OR p_at IS NULL OR NOT (p_entity_type = ANY (c_types)) THEN
    RETURN NULL;
  END IF;

  SELECT CASE eh.action WHEN 'update' THEN eh.diff -> p_key ->> 'old' ELSE eh.diff -> 'old' ->> p_key END
    INTO v
    FROM public.edit_history eh
   WHERE eh.entity_type = p_entity_type AND eh.entity_id = p_entity_id
     AND ((eh.action = 'update' AND eh.diff ? p_key) OR eh.action = 'delete')
     AND (eh.created_at > p_at OR (eh.created_at = p_at AND eh.id > COALESCE(p_after, 0)))
   ORDER BY eh.created_at, eh.id
   LIMIT 1;
  IF FOUND THEN
    RETURN v;
  END IF;

  -- The live row, when it already existed at p_at (a files id is the
  -- client's to choose, so a newer row holding an old id does not vote).
  EXECUTE format(
    'SELECT to_jsonb(t) ->> $2 FROM public.%I t WHERE t.id = $1
        AND COALESCE((to_jsonb(t) ->> ''created_at'')::timestamptz <= $3, true)', p_entity_type)
    INTO v USING p_entity_id, p_key, p_at;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    RETURN v;
  END IF;

  SELECT eh.diff -> 'new' ->> p_key
    INTO v
    FROM public.edit_history eh
   WHERE eh.entity_type = p_entity_type AND eh.entity_id = p_entity_id AND eh.action = 'create'
     AND (eh.created_at < p_at OR (eh.created_at = p_at AND eh.id <= COALESCE(p_after, eh.id)))
   ORDER BY eh.created_at DESC, eh.id DESC
   LIMIT 1;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.edit_history_value_at(text, uuid, text, timestamptz, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edit_history_value_at(text, uuid, text, timestamptz, bigint) TO service_role;

COMMENT ON FUNCTION public.edit_history_value_at(text, uuid, text, timestamptz, bigint) IS
  '0108: the value one column of one captured entity had at a past moment, walked back from edit_history: the old side of the first later row of that entity that changed it (an update carrying it, or the delete), else the live row when it already existed then, else the entity''s create row. Used by edit_history_project_at and the 0108 backfill (and kept for replay). DEFINER; no client role executes it.';

-- The project one captured entity belonged to at a past moment. p_row is the
-- whole row the history row carries (a create''s new side, a delete''s old
-- side), or NULL for an update, whose diff holds only what changed.
CREATE OR REPLACE FUNCTION public.edit_history_project_at(
  p_entity_type text, p_entity_id uuid, p_row jsonb, p_at timestamptz, p_after bigint DEFAULT NULL)
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
BEGIN
  IF p_entity_id IS NULL THEN
    RETURN NULL;
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
      RETURN public.edit_history_project_at('assets', v_parent, NULL, p_at, p_after);
    WHEN 'task_links' THEN
      v_parent := public.fn_try_uuid(COALESCE(p_row ->> 'task_id',
                    public.edit_history_value_at(p_entity_type, p_entity_id, 'task_id', p_at, p_after)));
      RETURN public.edit_history_project_at('tasks', v_parent, NULL, p_at, p_after);
    WHEN 'ingestion_chunks' THEN
      v_parent := public.fn_try_uuid(COALESCE(p_row ->> 'run_id',
                    public.edit_history_value_at(p_entity_type, p_entity_id, 'run_id', p_at, p_after)));
      RETURN public.edit_history_project_at('ingestion_runs', v_parent, NULL, p_at, p_after);
    WHEN 'comments' THEN
      v_kind   := COALESCE(p_row ->> 'entity_type',
                    public.edit_history_value_at(p_entity_type, p_entity_id, 'entity_type', p_at, p_after));
      v_parent := public.fn_try_uuid(COALESCE(p_row ->> 'entity_id',
                    public.edit_history_value_at(p_entity_type, p_entity_id, 'entity_id', p_at, p_after)));
      RETURN CASE v_kind
               WHEN 'project' THEN v_parent
               WHEN 'phase'   THEN public.edit_history_project_at('phases', v_parent, NULL, p_at, p_after)
               WHEN 'asset'   THEN public.edit_history_project_at('assets', v_parent, NULL, p_at, p_after)
               WHEN 'task'    THEN public.edit_history_project_at('tasks', v_parent, NULL, p_at, p_after)
             END;
    WHEN 'task_dependencies', 'phase_dependencies' THEN
      v_a := public.edit_history_project_at(
               CASE p_entity_type WHEN 'task_dependencies' THEN 'tasks' ELSE 'phases' END,
               public.fn_try_uuid(COALESCE(p_row ->> 'predecessor_id',
                 public.edit_history_value_at(p_entity_type, p_entity_id, 'predecessor_id', p_at, p_after))),
               NULL, p_at, p_after);
      v_b := public.edit_history_project_at(
               CASE p_entity_type WHEN 'task_dependencies' THEN 'tasks' ELSE 'phases' END,
               public.fn_try_uuid(COALESCE(p_row ->> 'successor_id',
                 public.edit_history_value_at(p_entity_type, p_entity_id, 'successor_id', p_at, p_after))),
               NULL, p_at, p_after);
      RETURN CASE WHEN v_a = v_b THEN v_a END;
    ELSE
      RETURN NULL;  -- rate_cards, rate_card_entries, and anything else
  END CASE;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.edit_history_project_at(text, uuid, jsonb, timestamptz, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edit_history_project_at(text, uuid, jsonb, timestamptz, bigint) TO service_role;

COMMENT ON FUNCTION public.edit_history_project_at(text, uuid, jsonb, timestamptz, bigint) IS
  '0108: the project one captured entity belonged to at a past moment ("project at time t"), from the row the history row carries or, for an update, walked back through edit_history_value_at over the entity''s (or its parent''s) own recorded changes; a dependency only when both endpoints were in one project; rate cards NULL; any error NULL. Used by the 0108 backfill and kept for replay. DEFINER; no client role executes it.';

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
-- (1) project_id, through the walk: every row whose project_id is NULL (rate
-- cards excepted), and every row of a file with a recorded project change
-- (0088's snapshot stamped those from the live row). An update whose own diff
-- carries its anchor key gets NULL. (2) captured_private on every row with a
-- project: for a projects update that changed is_private, either side; else
-- the project's is_private at the time, walked back the same way; else true.
DO $$
DECLARE
  v_total     bigint;
  v_null_pre  bigint;
  v_null_post bigint;
  v_set       bigint;
  v_priv      bigint;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE project_id IS NULL) INTO v_total, v_null_pre FROM public.edit_history;

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
                 END AS pid
            FROM public.edit_history h
           WHERE h.entity_type NOT IN ('rate_cards', 'rate_card_entries')
             AND (h.project_id IS NULL
                  OR (h.entity_type = 'files'
                      AND EXISTS (SELECT 1 FROM public.edit_history m
                                   WHERE m.entity_type = 'files' AND m.entity_id = h.entity_id
                                     AND m.action = 'update' AND m.diff ? 'project_id')))) x
   WHERE x.id = eh.id
     AND eh.project_id IS DISTINCT FROM x.pid;
  GET DIAGNOSTICS v_set = ROW_COUNT;

  UPDATE public.edit_history eh
     SET captured_private = x.priv
    FROM (SELECT h.id,
                 CASE
                   WHEN h.entity_type = 'projects' AND h.action = 'update' AND h.diff ? 'is_private'
                     THEN COALESCE((h.diff -> 'is_private' ->> 'old')::boolean, false)
                       OR COALESCE((h.diff -> 'is_private' ->> 'new')::boolean, false)
                   ELSE COALESCE(public.edit_history_value_at('projects', h.project_id, 'is_private', h.created_at, h.id)::boolean,
                                 true)
                 END AS priv
            FROM public.edit_history h
           WHERE h.project_id IS NOT NULL) x
   WHERE x.id = eh.id
     AND eh.captured_private IS DISTINCT FROM x.priv;
  GET DIAGNOSTICS v_priv = ROW_COUNT;

  SELECT count(*) FILTER (WHERE project_id IS NULL) INTO v_null_post FROM public.edit_history;
  RAISE NOTICE '0108 backfill: % edit_history rows; project_id NULL before %, after % (% rows given or re-derived a project); % rows marked captured_private',
    v_total, v_null_pre, v_null_post, v_set, v_priv;
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

  -- 2. captured_private: boolean NOT NULL DEFAULT false.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'edit_history' AND column_name = 'captured_private'
                    AND data_type = 'boolean' AND is_nullable = 'NO' AND column_default = 'false') THEN
    RAISE EXCEPTION '0108 post-condition 2 failed: edit_history.captured_private is missing or mis-shaped';
  END IF;

  -- 3. The resolver and the walk: STABLE DEFINER, search_path pinned, closed
  --    to client roles; and the resolver's answer on synthetic rows.
  FOR r IN SELECT p.oid, p.proname, p.prosecdef, p.provolatile, p.proconfig FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('edit_history_project_of', 'edit_history_value_at', 'edit_history_project_at') LOOP
    IF NOT r.prosecdef OR r.provolatile <> 's' OR r.proconfig IS NULL OR NOT ('search_path=public' = ANY (r.proconfig)) THEN
      RAISE EXCEPTION '0108 post-condition 3 failed: % must be STABLE SECURITY DEFINER with search_path pinned', r.proname;
    END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE') OR has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION '0108 post-condition 3 failed: a client role can EXECUTE %', r.proname;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
         AND proname IN ('edit_history_project_of', 'edit_history_value_at', 'edit_history_project_at')) <> 3 THEN
    RAISE EXCEPTION '0108 post-condition 3 failed: the resolver, the value walk and the project walk must each exist once';
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

  -- 7. The backfill: no update row that moved an entity between projects
  --    still names a project, and no row of a project-scoped type that the
  --    walk resolves is left without one.
  IF EXISTS (SELECT 1 FROM public.edit_history
              WHERE action = 'update' AND project_id IS NOT NULL
                AND entity_type IN ('phases', 'assets', 'tasks', 'files', 'ingestion_runs')
                AND diff ? 'project_id') THEN
    RAISE EXCEPTION '0108 post-condition 7 failed: a move between projects is still stamped with a project';
  END IF;
  IF EXISTS (SELECT 1 FROM public.edit_history
              WHERE entity_type IN ('rate_cards', 'rate_card_entries') AND (project_id IS NOT NULL OR captured_private)) THEN
    RAISE EXCEPTION '0108 post-condition 7 failed: a rate card row carries a project';
  END IF;
END $$;
