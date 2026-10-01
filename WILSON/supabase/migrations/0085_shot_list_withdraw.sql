-- =============================================================================
-- 0085_shot_list_withdraw.sql — post-overhaul S3a, after its hand-off
-- (Audrey's answers of 2026-09-30).
--
-- WHAT AUDREY ASKED
-- -----------------
-- The S3a hand-off put a question to her: the undo of "New list" / "New edit"
-- archives the new row, and archiving is a project manager's or a workspace
-- admin's (D8) — so a member or reviewer who made a list by mistake had no
-- undo. Her answer, verbatim: "allow users to view their most recently
-- deleted list. only right after they deleted." Then, from the options put to
-- her:
--   * WITHDRAW, briefly viewable — nothing is deleted (D18). The row is set
--     aside (archived) by the person who made it; right after, its maker sees
--     it as "Recently removed" and can open it or restore it. How long that
--     shows ("until they leave the Scenes tab") is the provider's and S3b's,
--     not this file's.
--   * Only UNTOUCHED new ones — nobody can lose saved history this way. A LIST
--     is untouched while it was never Saved (snapshot still {}) and no live
--     edit is made on it (and it is not the active list — D4, for everyone).
--     An EDIT is untouched while it was never Saved (snapshot still NULL) and
--     no live edit continues it.
--
-- WHAT THIS CHANGES
-- -----------------
-- 1. archive_shot_list / archive_edit gain a MAKER path beside the manager /
--    admin seat check: the caller made the row (created_by = auth.uid()), may
--    still write shot lists on the project (can_edit_shot_lists — a maker who
--    lost their seat loses this too), and the row is untouched. Withdraw =
--    archive by its maker. Restore = only a row the caller themselves set
--    aside (archived_by = auth.uid()), still untouched. Everything else in
--    both bodies is 0084's, restated whole (the 0059 lesson: a CREATE OR
--    REPLACE that drops an arm is a privilege escalation); §3's
--    post-conditions check every arm with comments stripped (0077 §3c).
-- 2. created_by becomes the maker's own, structurally, because the maker path
--    rests on it. A signed-in INSERT is stamped with auth.uid() whatever the
--    client sent, and no UPDATE can change it. Until now fn_audit_touch (0001)
--    filled created_by only when the client left it NULL, so a client could
--    name anyone as a list's maker — harmless while no right hung on it.
--
-- WHAT IS DELIBERATELY NOT CHANGED
-- --------------------------------
-- * Who archives or restores a TOUCHED list or edit, or someone else's: still
--   a project manager or a workspace admin (D8), with 0084's refusal text.
-- * The ACTIVE list is never archived, by anyone (D4): the maker path reaches
--   that refusal like every other caller.
-- * 0084's chain indexes (one root, one child): a withdrawn edit keeps its
--   place in its list's chain, so the next new edit continues from it — with
--   the same items, since an untouched edit was never Saved.
-- * No new column. A withdrawn row is one whose archived_by equals its
--   created_by; S3b's Archived section can say "withdrawn by its maker".
-- * The D11 backfill's lists have no maker (created_by NULL — they were made
--   by the migration), so the maker path can never reach them.
-- * The Local Server has no roles (D8: there both actions are labels) and the
--   dev fixtures run as a workspace admin, so neither backend changes; the
--   provider checks "untouched" itself before every withdraw, on every backend.
--
-- ORDERING: after 0084 (it restates 0084's archive_shot_list / archive_edit and
-- adds a trigger to 0084's two tables; the pre-flight refuses to run without
-- them), 0082 (passes_project_privacy, called once in each body), 0013
-- (project_role_for), 0008 (current_app_role, has_active_membership).
-- Independent of everything else. Nothing depends on this one yet.
-- Numbers: 0085 was the next free migration after 0084; pgTAP suite 87
-- (87_shot_list_withdraw.sql).
-- Idempotent: CREATE OR REPLACE / DROP-then-CREATE throughout.
-- =============================================================================


-- =============================================================================
-- 0. PRE-FLIGHT
-- =============================================================================
DO $$
BEGIN
  IF to_regprocedure('public.archive_shot_list(uuid, boolean)') IS NULL
     OR to_regprocedure('public.archive_edit(uuid, boolean)') IS NULL
     OR to_regprocedure('public.can_edit_shot_lists(uuid)') IS NULL
     OR to_regclass('public.shot_lists') IS NULL
     OR to_regclass('public.edits') IS NULL THEN
    RAISE EXCEPTION '0085 pre-flight failed: 0084 (shot lists and edits) is not applied — apply it first';
  END IF;
  IF to_regprocedure('public.passes_project_privacy(uuid)') IS NULL THEN
    RAISE EXCEPTION '0085 pre-flight failed: passes_project_privacy (0082) is missing';
  END IF;
END $$;


-- =============================================================================
-- 1. The maker is the maker — created_by pinned on shot_lists and edits
-- =============================================================================
--
-- BEFORE INSERT OR UPDATE, named so it fires after trg_*_audit (BEFORE triggers
-- run in name order): fn_audit_touch fills a NULL created_by first, then this
-- overrides whatever a signed-in client sent. A call with no user — a
-- migration, an operator's script, service_role — keeps what it sent (the D11
-- backfill's NULL, an import's original maker). On UPDATE the old value always
-- wins, for everyone. Not SECURITY DEFINER (it reads nothing), which keeps
-- FORCE RLS's precondition (0004's note).

CREATE OR REPLACE FUNCTION public.fn_shot_list_pin_maker()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL THEN
      NEW.created_by := auth.uid();
    END IF;
  ELSE
    NEW.created_by := OLD.created_by;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_shot_list_pin_maker() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_shot_lists_pin_maker ON public.shot_lists;
CREATE TRIGGER trg_shot_lists_pin_maker
  BEFORE INSERT OR UPDATE ON public.shot_lists
  FOR EACH ROW EXECUTE FUNCTION public.fn_shot_list_pin_maker();

DROP TRIGGER IF EXISTS trg_edits_pin_maker ON public.edits;
CREATE TRIGGER trg_edits_pin_maker
  BEFORE INSERT OR UPDATE ON public.edits
  FOR EACH ROW EXECUTE FUNCTION public.fn_shot_list_pin_maker();

COMMENT ON FUNCTION public.fn_shot_list_pin_maker() IS
  '0085: a signed-in INSERT into shot_lists / edits is stamped created_by = auth.uid() whatever the client sent; no UPDATE changes created_by. A call with no user (migration, service_role) keeps what it sent. The maker path of archive_shot_list / archive_edit rests on it.';


-- =============================================================================
-- 2. The two RPCs — 0084's bodies, plus the maker path
-- =============================================================================

-- ── 2a. archive_shot_list ───────────────────────────────────────────────────
-- p_archived = false restores (the undo of an archive). Archiving an archived
-- list, or restoring a live one, is a no-op that returns the row unchanged.
CREATE OR REPLACE FUNCTION public.archive_shot_list(p_list UUID, p_archived BOOLEAN DEFAULT true)
RETURNS public.shot_lists
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws        UUID := public.current_workspace_id();
  v_list      public.shot_lists%ROWTYPE;
  v_active    UUID;
  v_archive   BOOLEAN := COALESCE(p_archived, true);
  v_untouched BOOLEAN;
BEGIN
  IF v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RAISE EXCEPTION 'not_a_workspace_member' USING ERRCODE = '42501';
  END IF;

  SELECT p.active_shot_list_id INTO v_active
    FROM public.shot_lists l
    JOIN public.projects p ON p.id = l.project_id
   WHERE l.id = p_list
     AND p.workspace_id = v_ws
     AND p.deleted_at IS NULL
     AND public.passes_project_privacy(p.id)
     FOR UPDATE OF p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shot list not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_list FROM public.shot_lists WHERE id = p_list;

  IF NOT COALESCE(public.current_app_role() = 'admin'
                  OR public.project_role_for(v_list.project_id) = 'manager', false) THEN
    -- 0085: the MAKER path (Audrey, 2026-09-30). The caller made this list,
    -- may still write shot lists here, and — restoring — set it aside
    -- themselves (or it is not set aside at all: a no-op).
    IF NOT COALESCE(v_list.created_by IS NOT NULL
                    AND v_list.created_by = auth.uid()
                    AND public.can_edit_shot_lists(v_list.project_id)
                    AND (v_archive OR v_list.archived_at IS NULL OR v_list.archived_by = auth.uid()),
                    false) THEN
      RAISE EXCEPTION 'only a project manager or a workspace admin can archive or restore a shot list'
        USING ERRCODE = '42501';
    END IF;
    -- …and only while it is untouched: never Saved, no live edit on it.
    v_untouched := v_list.snapshot = '{}'::jsonb
      AND NOT EXISTS (SELECT 1 FROM public.edits e
                       WHERE e.shot_list_id = v_list.id AND e.archived_at IS NULL);
    IF NOT COALESCE(v_untouched, false) THEN
      RAISE EXCEPTION 'only an untouched shot list you made can be withdrawn — a project manager or a workspace admin can archive it'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_archive AND v_active IS NOT DISTINCT FROM p_list THEN
    RAISE EXCEPTION 'the active shot list cannot be archived — make another list active first';
  END IF;

  PERFORM set_config('wilson.shot_list_archive', p_list::text, true);
  UPDATE public.shot_lists
     SET archived_at = CASE WHEN v_archive THEN COALESCE(archived_at, now()) ELSE NULL END,
         archived_by = CASE WHEN v_archive THEN COALESCE(archived_by, auth.uid()) ELSE NULL END
   WHERE id = p_list
  RETURNING * INTO v_list;
  PERFORM set_config('wilson.shot_list_archive', '', true);

  RETURN v_list;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.archive_shot_list(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.archive_shot_list(UUID, BOOLEAN) TO authenticated, service_role;

COMMENT ON FUNCTION public.archive_shot_list(UUID, BOOLEAN) IS
  '0084 (D4/D8/D18) + 0085: archive (p_archived true, the default) or restore (false) a shot list. A workspace admin or project manager may do either; the list''s MAKER (created_by, still able to write shot lists here) may withdraw it — and restore what they withdrew — only while it is untouched (never Saved, no live edit). Refuses to archive the project''s ACTIVE list, for everyone. Lists are never deleted. SECURITY DEFINER with its own read gate (workspace, live, membership, passes_project_privacy). Returns the row.';

-- ── 2b. archive_edit ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.archive_edit(p_edit UUID, p_archived BOOLEAN DEFAULT true)
RETURNS public.edits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws        UUID := public.current_workspace_id();
  v_edit      public.edits%ROWTYPE;
  v_archive   BOOLEAN := COALESCE(p_archived, true);
  v_untouched BOOLEAN;
BEGIN
  IF v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RAISE EXCEPTION 'not_a_workspace_member' USING ERRCODE = '42501';
  END IF;

  SELECT e.* INTO v_edit
    FROM public.edits e
    JOIN public.projects p ON p.id = e.project_id
   WHERE e.id = p_edit
     AND p.workspace_id = v_ws
     AND p.deleted_at IS NULL
     AND public.passes_project_privacy(p.id)
     FOR UPDATE OF e;
  IF v_edit.id IS NULL THEN
    RAISE EXCEPTION 'edit not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT COALESCE(public.current_app_role() = 'admin'
                  OR public.project_role_for(v_edit.project_id) = 'manager', false) THEN
    -- 0085: the MAKER path — see archive_shot_list.
    IF NOT COALESCE(v_edit.created_by IS NOT NULL
                    AND v_edit.created_by = auth.uid()
                    AND public.can_edit_shot_lists(v_edit.project_id)
                    AND (v_archive OR v_edit.archived_at IS NULL OR v_edit.archived_by = auth.uid()),
                    false) THEN
      RAISE EXCEPTION 'only a project manager or a workspace admin can archive or restore an edit'
        USING ERRCODE = '42501';
    END IF;
    -- …and only while it is untouched: never Saved, no live edit continues it.
    v_untouched := v_edit.snapshot IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.edits c
                       WHERE c.parent_edit_id = v_edit.id AND c.archived_at IS NULL);
    IF NOT COALESCE(v_untouched, false) THEN
      RAISE EXCEPTION 'only an untouched edit you made can be withdrawn — a project manager or a workspace admin can archive it'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  PERFORM set_config('wilson.edit_archive', p_edit::text, true);
  UPDATE public.edits
     SET archived_at = CASE WHEN v_archive THEN COALESCE(archived_at, now()) ELSE NULL END,
         archived_by = CASE WHEN v_archive THEN COALESCE(archived_by, auth.uid()) ELSE NULL END
   WHERE id = p_edit
  RETURNING * INTO v_edit;
  PERFORM set_config('wilson.edit_archive', '', true);

  RETURN v_edit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.archive_edit(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.archive_edit(UUID, BOOLEAN) TO authenticated, service_role;

COMMENT ON FUNCTION public.archive_edit(UUID, BOOLEAN) IS
  '0084 (D4/D8) + 0085: archive (default) or restore an edit. A workspace admin or project manager may do either; the edit''s MAKER (created_by, still able to write shot lists here) may withdraw it — and restore what they withdrew — only while it is untouched (never Saved, no live edit continues it). SECURITY DEFINER with its own read gate (workspace, live, membership, passes_project_privacy). Returns the row.';


-- =============================================================================
-- 3. POST-CONDITIONS — every arm, comments stripped
-- =============================================================================

DO $$
DECLARE
  t      TEXT;
  v_body TEXT;
  v_hits INT;
BEGIN
  -- 3a. the pin trigger on both tables; its function is no client's to call.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.shot_lists'::regclass
                    AND tgname = 'trg_shot_lists_pin_maker' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.edits'::regclass
                    AND tgname = 'trg_edits_pin_maker' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '0085 post-condition failed: a pin-maker trigger is missing';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_shot_list_pin_maker()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_shot_list_pin_maker()', 'EXECUTE') THEN
    RAISE EXCEPTION '0085 post-condition failed: a client role can execute fn_shot_list_pin_maker';
  END IF;
  -- 3b. both RPC bodies keep EVERY 0084 arm and gain the maker path.
  FOREACH t IN ARRAY ARRAY['public.archive_shot_list(uuid, boolean)',
                           'public.archive_edit(uuid, boolean)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = t::regprocedure AND prosecdef) THEN
      RAISE EXCEPTION '0085 post-condition failed: % must be SECURITY DEFINER', t;
    END IF;
    v_body := pg_get_functiondef(t::regprocedure);
    v_body := regexp_replace(v_body, '/\*.*?\*/', '', 'gs');
    v_body := regexp_replace(v_body, '--[^' || chr(10) || ']*', '', 'g');
    v_hits := (length(v_body) - length(replace(v_body, 'passes_project_privacy(', '')))
              / length('passes_project_privacy(');
    IF v_hits <> 1 THEN
      RAISE EXCEPTION '0085 post-condition failed: % names passes_project_privacy % times (expected 1)', t, v_hits;
    END IF;
    IF v_body NOT LIKE '%has_active_membership(v_ws)%'
       OR v_body NOT LIKE '%p.deleted_at IS NULL%'
       OR v_body NOT LIKE '%p.workspace_id = v_ws%'
       OR v_body NOT LIKE '%current_app_role() = ''admin''%'
       OR v_body NOT LIKE '%project_role_for(%) = ''manager''%'
       OR v_body NOT LIKE '%created_by = auth.uid()%'
       OR v_body NOT LIKE '%can_edit_shot_lists(%'
       OR v_body NOT LIKE '%archived_by = auth.uid()%'
       OR v_body NOT LIKE '%archived_at IS NULL%'
       OR v_body NOT LIKE '%set_config(%' THEN
      RAISE EXCEPTION '0085 post-condition failed: % lost an arm of its read gate, its seat check or its maker path', t;
    END IF;
    IF has_function_privilege('anon', t, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', t, 'EXECUTE') THEN
      RAISE EXCEPTION '0085 post-condition failed: % privileges are wrong', t;
    END IF;
  END LOOP;

  v_body := regexp_replace(regexp_replace(
              pg_get_functiondef('public.archive_shot_list(uuid, boolean)'::regprocedure),
              '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g');
  IF v_body NOT LIKE '%the active shot list cannot be archived%'
     OR v_body NOT LIKE '%snapshot = ''{}''::jsonb%' THEN
    RAISE EXCEPTION '0085 post-condition failed: archive_shot_list lost the active-list refusal or the untouched test';
  END IF;
  v_body := regexp_replace(regexp_replace(
              pg_get_functiondef('public.archive_edit(uuid, boolean)'::regprocedure),
              '/\*.*?\*/', '', 'gs'), '--[^' || chr(10) || ']*', '', 'g');
  IF v_body NOT LIKE '%snapshot IS NULL%' OR v_body NOT LIKE '%parent_edit_id = v_edit.id%' THEN
    RAISE EXCEPTION '0085 post-condition failed: archive_edit lost the untouched test';
  END IF;

  -- 3c. 0084's guard is still armed on both tables (this file must not have
  --     disturbed what it builds on).
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.shot_lists'::regclass
                    AND tgname = 'trg_shot_lists_guard' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.edits'::regclass
                    AND tgname = 'trg_edits_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '0085 post-condition failed: 0084''s archive guard is missing';
  END IF;

  RAISE NOTICE '0085 OK: created_by pinned on shot_lists and edits; archive_shot_list / archive_edit keep every 0084 arm and add the maker''s withdraw of an untouched row';
END $$;
