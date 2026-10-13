-- =============================================================================
-- 0024_otter_trash_index.sql — Session 11 (O.T.T.E.R. UI)
--
-- WHY THIS EXISTS
--
-- Session 10 shipped a working 30-day trash for O.T.T.E.R. — otter_soft_delete_row()
-- puts a row in, otter_restore_row() takes it out, both pgTAP-pinned — and no way
-- whatsoever to find out what is IN it. Every read path filters trashed rows out:
--
--   * otter_courses_select  begins `deleted_at IS NULL`
--   * otter_subjects_select begins `deleted_at IS NULL`
--   * otter_course_index()  filters `c.deleted_at IS NULL`
--
-- otter_restore_row(p_table, p_id) needs a UUID, and after 0022 there is no
-- supported way for a client to learn one. 0022's own fn_otter_trash_authz
-- comment states the consequence outright: "a trashed course vanishes from its
-- own owner's view (and from otter_course_index), so they cannot even find it to
-- restore, and purge_otter_trash hard-deletes it after 30 days." That is carry-
-- forward gap #20, and it cannot be closed in the client alone.
--
-- otter_trash_index() is the missing read side. It is deliberately shaped as the
-- exact sibling of otter_course_index():
--
--   * SECURITY DEFINER, because by construction it must see rows that RLS hides.
--   * METADATA ONLY. No sections, no lesson bodies, no reference documents. A
--     trashed personal course must be no more readable than a live one, and an
--     admin who can restore a course still may not read it (0022's central rule).
--     Post-condition + pgTAP 31 both assert the signature never grows a content
--     column, mirroring the guard on otter_course_index.
--   * Live-row membership and role, never the JWT — definer bypasses RLS, so the
--     function re-checks itself (the 0010/0021/0022 convention).
--
-- WHO SEES WHAT — mirrors fn_otter_trash_authz exactly, because anything this
-- function lists must actually be restorable by the caller. Divergence here
-- would mean either an un-restorable row in the UI or a restorable row the UI
-- cannot find, and both are the bug this migration exists to fix.
--
--   trashed COURSE   owner, or a workspace admin.
--                    NOT granted editors — 0022 gives them no rights over
--                    trashing a course, so listing one to them would be an
--                    affordance they cannot use.
--   trashed SUBJECT  owner of the parent course, a workspace admin, or a
--                    granted editor of that course (subject trashing IS
--                    ordinary editing, and is reversible by anyone who can
--                    write the course).
--
-- ONE DELIBERATE NARROWING vs fn_otter_trash_authz: a subject whose parent
-- course is ALSO trashed is not listed. fn_otter_trash_authz would authorize
-- restoring it, but the restored subject would immediately be re-hidden by
-- otter_subjects_select's live-parent EXISTS, so the UI would offer a button
-- that visibly does nothing. Restore the course and the subject reappears here
-- on its own. This is the O.T.T.E.R. analogue of RABBIT carry-forward gap #4,
-- closed by construction rather than by an error message.
--
-- NOT ADDED: a friendlier failure for the one restore that can legitimately
-- fail. otter_courses_owner_slug_uidx is partial (WHERE deleted_at IS NULL), so
-- if the owner has since created a new course with the same slug, restoring the
-- old one raises 23505. Rewriting otter_restore_row to catch that would mean
-- re-deploying a function three environments already run; the client handles the
-- collision instead (see supabaseOtterAdapter's course.restore).
--
-- pgTAP: 31_otter_trash.sql
-- Idempotent: safe to re-run.
-- =============================================================================

-- ── otter_trash_index() ──────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.otter_trash_index();

CREATE FUNCTION public.otter_trash_index()
RETURNS TABLE (
  id               UUID,
  kind             TEXT,
  course_id        UUID,
  course_name      TEXT,
  name             TEXT,
  slug             TEXT,
  visibility       TEXT,
  owner_id         UUID,
  owner_label      TEXT,
  is_own           BOOLEAN,
  subject_count    INTEGER,
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
  v_uid  UUID := auth.uid();
  v_ws   UUID := public.current_workspace_id();
  v_role TEXT;
  -- Must track purge_otter_trash()'s p_keep default and the pg_cron job
  -- 'wilson-purge-otter-trash' (04:55 UTC, 0022 section 8). It drives a
  -- "purges in N days" countdown only; nothing is deleted on this path.
  v_keep INTERVAL := INTERVAL '30 days';
BEGIN
  SELECT wm.app_role INTO v_role
    FROM public.workspace_members wm
   WHERE wm.workspace_id = v_ws
     AND wm.user_id = v_uid
     AND wm.is_active;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'not_a_workspace_member';
  END IF;

  RETURN QUERY
  -- ── trashed courses ───────────────────────────────────────────────────────
  SELECT c.id,
         'course'::TEXT                                   AS kind,
         c.id                                             AS course_id,
         NULL::TEXT                                       AS course_name,
         c.name,
         c.slug,
         c.visibility,
         c.owner_id,
         COALESCE(wm.display_name, wm.username)           AS owner_label,
         (c.owner_id = v_uid)                             AS is_own,
         -- Subjects that are still live under the trashed course: these come
         -- back WITH it. Individually-trashed ones stay in the trash and
         -- surface as their own rows once the parent is restored.
         (SELECT count(*)::INTEGER FROM public.otter_subjects s
           WHERE s.course_id = c.id AND s.deleted_at IS NULL) AS subject_count,
         c.deleted_at,
         c.deleted_by,
         COALESCE(dm.display_name, dm.username)           AS deleted_by_label,
         (c.deleted_at + v_keep)                          AS purges_at
    FROM public.otter_courses c
    LEFT JOIN public.workspace_members wm
           ON wm.workspace_id = c.workspace_id AND wm.user_id = c.owner_id
    LEFT JOIN public.workspace_members dm
           ON dm.workspace_id = c.workspace_id AND dm.user_id = c.deleted_by
   WHERE c.workspace_id = v_ws
     AND c.deleted_at IS NOT NULL
     -- fn_otter_trash_authz's course arm: owner or admin. Granted editors are
     -- deliberately excluded — they cannot restore a course, so listing it
     -- would be a dead control.
     AND (c.owner_id = v_uid OR v_role = 'admin')

  UNION ALL

  -- ── trashed subjects under a LIVE course ──────────────────────────────────
  SELECT s.id,
         'subject'::TEXT                                  AS kind,
         s.course_id,
         c.name                                           AS course_name,
         s.title                                          AS name,
         s.slug,
         c.visibility,
         c.owner_id,
         COALESCE(wm.display_name, wm.username)           AS owner_label,
         (c.owner_id = v_uid)                             AS is_own,
         0                                                AS subject_count,
         s.deleted_at,
         s.deleted_by,
         COALESCE(dm.display_name, dm.username)           AS deleted_by_label,
         (s.deleted_at + v_keep)                          AS purges_at
    FROM public.otter_subjects s
    JOIN public.otter_courses c ON c.id = s.course_id
    LEFT JOIN public.workspace_members wm
           ON wm.workspace_id = c.workspace_id AND wm.user_id = c.owner_id
    LEFT JOIN public.workspace_members dm
           ON dm.workspace_id = s.workspace_id AND dm.user_id = s.deleted_by
   WHERE s.workspace_id = v_ws
     AND s.deleted_at IS NOT NULL
     -- Parent must be live: restoring under a trashed parent is authorized by
     -- fn_otter_trash_authz but immediately re-hidden by otter_subjects_select.
     AND c.deleted_at IS NULL
     -- fn_otter_trash_authz's subject arm: owner, admin, or granted editor.
     AND (c.owner_id = v_uid
          OR v_role = 'admin'
          OR public.otter_has_editor_grant(s.course_id))

   ORDER BY 12 DESC;   -- deleted_at, newest first
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_trash_index() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_trash_index() TO authenticated, service_role;

COMMENT ON FUNCTION public.otter_trash_index IS
  'Session 11: metadata-only listing of soft-deleted O.T.T.E.R. courses and subjects the caller may restore. Closes carry-forward gap #20 — after 0022 nothing could enumerate the trash, so otter_restore_row had no reachable argument. Authorization mirrors fn_otter_trash_authz; returns no lesson content, so an admin who can restore a personal course still cannot read it.';

-- ── Post-conditions ──────────────────────────────────────────────────────────

DO $$
DECLARE
  v_result TEXT;
BEGIN
  IF to_regprocedure('public.otter_trash_index()') IS NULL THEN
    RAISE EXCEPTION '0024 post-condition failed: otter_trash_index() missing';
  END IF;

  -- The whole contract: a trash listing must never become a content read.
  -- Same guard 0022 put on otter_course_index, for the same reason — this
  -- function is SECURITY DEFINER and therefore the one place a personal
  -- course's body could leak to an admin by accident.
  SELECT pg_get_function_result(p.oid) INTO v_result
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'otter_trash_index';

  IF v_result ~ '(sections|section_outlines|hotkeys|functions|nodes|corrections|reference_urls|completed_lessons)' THEN
    RAISE EXCEPTION '0024 post-condition failed: otter_trash_index leaks a content column';
  END IF;

  -- anon must never reach it: the function bypasses RLS by design.
  IF has_function_privilege('anon', 'public.otter_trash_index()', 'EXECUTE') THEN
    RAISE EXCEPTION '0024 post-condition failed: anon can execute otter_trash_index()';
  END IF;
END $$;
