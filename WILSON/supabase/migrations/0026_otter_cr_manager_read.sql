-- =============================================================================
-- 0026_otter_cr_manager_read.sql — Session 13 follow-up (Audrey, 2026-07-30)
--
-- "reviewer … can view requests in otter" — the middle APP tier (app_role
-- 'manager'; the brief's tool-wide Manager, NOT the RABBIT project-level
-- reviewer seat) can now SEE the change-request queue. Under 0022/0025 the
-- SELECT policy admitted only the proposer, workspace admins and the target
-- course's owner, so a manager opening O.T.T.E.R.'s Requests view got an
-- empty list.
--
-- VIEW ONLY — deliberately unchanged:
--   * DECIDING stays admins + the target course's owner (Audrey, locked #22:
--     "the admin … review and approve or deny"). otter_cr_update's arms and
--     fn_otter_cr_review's reviewer check are untouched, so a manager's
--     decision UPDATE matches zero rows and otter_cr_apply() refuses them.
--   * THE REVIEW WINDOW stays consent-scoped to deciders.
--     otter_has_open_review_access() is untouched: the proposer consented to
--     REVIEWERS reading their personal fork, not to every manager — a manager
--     sees the request row (summary, status, outcome), never the fork.
--
-- current_app_role() in this policy is fine: 0022's post-condition only
-- forbids it in SELECT policies on otter_courses/otter_progress (personal
-- CONTENT); otter_cr_select has used it for the admin arm since 0022.
-- The manager arm deliberately follows that SAME JWT convention rather than
-- the live-row rule the S13 decide/window/apply paths use: this is a
-- read-only queue listing, its staleness window (a demoted manager reads
-- until their token refreshes) is identical to the admin arm's since 0022,
-- and mixing JWT and live-row arms inside one policy would make the policy
-- itself lie about its freshness. Every path that ACTS is live-row.
--
-- ORDERING RULE (extends the 0025 note): 0022 also creates otter_cr_select,
-- so a MANUAL re-run of 0022 must now be followed by 0025 AND 0026. The
-- migration runner's by-version ordering keeps every normal path safe.
--
-- Idempotent: safe to re-run.
-- pgTAP: 32_otter_cr_apply.sql grows four manager probes (view yes; decide,
-- window, apply no).
-- =============================================================================

DROP POLICY IF EXISTS otter_cr_select ON public.otter_change_requests;
CREATE POLICY otter_cr_select ON public.otter_change_requests
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (
      proposed_by = auth.uid()
      -- 0026: managers may VIEW the queue (Audrey, 2026-07-30). Deciding and
      -- the fork window remain admin + target-owner only.
      OR public.current_app_role() IN ('admin', 'manager')
      OR public.otter_is_course_owner(target_course_id)
    )
  );

-- The table's self-documentation still described the Session 10 contract
-- (proposer + admins see rows; only admins decide; only the proposer
-- withdraws) — false three ways since 0025/0026. Future sessions treat these
-- comments as the record, so keep it truthful.
COMMENT ON TABLE public.otter_change_requests IS
  'A proposal to fold a forked course''s changes back into the company-standard original. Visible to the proposer, workspace admins and managers (0026 — managers view only), and the target course''s owner. Deciding (approve-and-apply via otter_cr_apply, or decline-with-note) is admins + the target course''s owner; the proposer may refine, withdraw, resubmit after a decline, or accept it (0025). No DELETE policy — review history is retained.';

-- ── Post-conditions ──────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'otter_change_requests'
       AND policyname = 'otter_cr_select' AND cmd = 'SELECT'
       AND qual LIKE '%manager%'
  ) THEN
    RAISE EXCEPTION '0026 post-condition failed: manager read arm missing from otter_cr_select';
  END IF;

  -- Review history is still retained, and the personal-content rule still
  -- holds (the manager arm must never leak into otter_courses/otter_progress).
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'otter_change_requests' AND cmd = 'DELETE'
  ) THEN
    RAISE EXCEPTION '0026 post-condition failed: otter_change_requests must retain review history';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('otter_courses', 'otter_progress')
       AND cmd = 'SELECT'
       AND qual LIKE '%current_app_role%'
  ) THEN
    RAISE EXCEPTION '0026 post-condition failed: admin bypass leaked into a personal-content SELECT policy';
  END IF;
END $$;
