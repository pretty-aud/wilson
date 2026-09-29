-- =============================================================================
-- 0064_otter_course_nominations.sql — 2026-08-12
--
-- ANYONE MAY SUBMIT A COURSE TO BECOME THE COMPANY STANDARD; ADMINS AND
-- MANAGERS DECIDE.
--
-- Audrey, 2026-08-10, verbatim:
--   "in otter, how does a user submit a course to be part of the company wide
--    otter tool? i cant see anywau to submit it"
--
-- The answer was: there was no way, for anyone but an admin, and no way to ask.
-- `company_standard` was reachable only by an admin flipping `visibility` on a
-- course they could already see — immediate, unreviewed, and with no surface
-- anywhere in the product representing "make my course the standard". Nothing
-- could even create the FIRST standard of a topic except that manual flip.
--
-- 🚨 RE-RUN ORDER, ADDED 2026-09-07 (Track A, A4).
--    0069_otter_nomination_self_approval_audit.sql REPLACES this file's
--    `otter_nomination_apply`, adding the WIL-4108 self-approval audit line.
--    The version-ordered runner is safe (0064 then 0069). A BY-HAND REPLAY OF
--    THIS FILE AFTER 0069 SILENTLY REVERTS THAT AUDIT LINE, and both files'
--    post-conditions still pass, because neither knows about the other's
--    additions. If you replay 0064, replay 0069 straight after it.
--    (0069's header carries the mirror of this warning. The trap is the one
--    0022/0025 set and MASTER_PLAN records.)
--
-- Audrey, 2026-08-12, on the shape:
--   "it needs to be reviewers/managers not just admins with approval access.
--    anyone should be able to submit to become company standard"
--
-- There is no `reviewer` app_role — app_role is exactly {admin, manager, user},
-- and "reviewer" is a RABBIT PROJECT role on a different axis that O.T.T.E.R.
-- never consults. So "reviewers/managers" is implemented as app_role IN
-- ('admin','manager'), read from the LIVE workspace_members row.
--
-- ── WHY A NEW TABLE AND NOT otter_change_requests ────────────────────────────
-- The change-request engine is the right SHAPE and the wrong TARGET. Its
-- `target_course_id` is NOT NULL and `otter_cr_insert` requires
-- `otter_course_visibility(target_course_id) = 'company_standard'` — a request
-- can only be filed against a course that ALREADY is the standard. A nomination
-- has no target; that is the whole point of it. Widening that policy would
-- change a predicate four pgTAP files and three post-conditions exercise, to
-- express something it was never about.
--
-- So: a sibling table that REUSES the parts that were hard to get right — the
-- status machine, the revision counter, the decline-as-conversation, the
-- consented review window, the "approving IS applying" GUC — and targets a
-- course instead of a standard.
--
-- ── WHY APPROVAL CANNOT BE AN UPDATE ─────────────────────────────────────────
-- `fn_otter_pin_course_identity` fires BEFORE UPDATE and, for a non-admin,
-- SILENTLY ASSIGNS `NEW.visibility := OLD.visibility`. It never raises. A
-- manager approving would get "1 row affected", a success response, and an
-- unchanged course. SECURITY DEFINER does not help: it buys RLS bypass, not
-- trigger bypass, and auth.uid()/current_app_role() still resolve to the caller
-- inside a definer body.
--
-- The mechanism is therefore the one otter_cr_apply already uses on
-- fn_otter_cr_review: a SECURITY DEFINER RPC that sets a TRANSACTION-LOCAL GUC
-- naming the exact row it is acting on, and a trigger arm that honours it.
-- Two separate GUCs, because two different id spaces are involved:
--   wilson.otter_nomination_apply   → the NOMINATION id (fn_otter_nomination_review)
--   wilson.otter_nomination_promote → the COURSE id     (fn_otter_pin_course_identity)
-- One GUC holding two kinds of id would authorise the wrong row eventually.
--
-- 🚨 fn_otter_pin_course_identity IS A GUARD FUNCTION AND IS EDITED HERE.
-- 0062 exists because 0059 rewrote a guard function to add one column and
-- silently deleted its grant-flag checks, opening a live privilege escalation.
-- The deployed body was read with pg_get_functiondef before this was written
-- and is byte-identical to 0022's; the version below is that body with ONE arm
-- added AHEAD of the existing two, which are reproduced verbatim including both
-- COALESCE wrappers. A post-condition at the foot of this file asserts both
-- original arms are still present. Do not "tidy" it.
--
-- ── THE CONSENT DECISION ─────────────────────────────────────────────────────
-- 0026 deliberately gave managers the change-request QUEUE and not the review
-- WINDOW: "the proposer consented to reviewers, not the tier". Letting managers
-- approve nominations reopens that question, so it was put back to Audrey
-- (2026-08-12), who chose: submitting a course grants approvers a read-only
-- window on it, ending when the nomination is decided — the act of submitting
-- IS the consent, exactly as it already is for change requests.
--
-- 🚨 That window is a NEW helper, otter_has_open_nomination_access. It is NOT a
-- widening of otter_has_open_review_access, because that helper also backs the
-- change-request window — adding 'manager' there would silently expose every
-- open change-request fork to every manager as a side effect. Two consents,
-- two functions.
--
-- Like its sibling it is plpgsql SECURITY DEFINER, NOT sql: the role test must
-- not be inlinable into the calling policy's `qual`, because 0022/0025/0026 all
-- ship a post-condition that fails the build if `current_app_role` appears in a
-- SELECT policy on otter_courses/otter_progress. This helper avoids the JWT
-- entirely and reads workspace_members, which is also the S13 convention for
-- anything that ACTS.
--
-- ── REPLACING AN INCUMBENT STANDARD ──────────────────────────────────────────
-- `otter_courses_standard_slug_uidx` allows one company_standard per
-- (workspace_id, slug). Promoting into an occupied slug is a raw, uncaught
-- 23505. So the RPC demotes the incumbent to 'shared' IN THE SAME TRANSACTION,
-- before promoting, and records which course it demoted.
--
-- Demote, never trash: otter_change_requests.target_course_id is ON DELETE
-- CASCADE and the 30-day purge hard-deletes, so trashing an incumbent would
-- destroy every change request ever approved against it — history that 0025 and
-- 0026 both ship post-conditions to protect.
--
-- ⚠️ THE SLUG IS NOT THE TOPIC. `slug` is frozen at creation, never re-derived
-- on rename, and a fork whose slug collided in its owner's namespace gets a
-- numeric suffix — so "blender-basics-2" does NOT collide with
-- "blender-basics", and approving it would yield TWO live standards for one
-- topic, which is the exact thing the index exists to prevent. Matching the
-- incumbent by NAME instead is not a fix: it would demote by one key and
-- collide on another. This migration therefore REFUSES LOUDLY — if a
-- company_standard course with the same name (case-insensitively) but a
-- different slug exists, the approval raises and says so. A refusal a human can
-- read beats a silent second standard.
--
-- ⚠️ WHAT THIS DELIBERATELY DOES NOT DO
--   * It does NOT widen fn_otter_pin_course_identity's role test to managers.
--     Approval authority lives in the RPC, which reads the live membership row.
--     Widening the trigger would also hand managers the everyday
--     ShareCourseDialog PATCH path, which nobody asked for.
--   * It does NOT touch otter_cr_insert / otter_cr_update / otter_cr_apply /
--     otter_has_open_review_access / fn_otter_cr_review. Change requests are
--     unchanged, and pgTAP 32's four manager-refusal probes must stay GREEN. A
--     manager still cannot decide a CHANGE REQUEST.
--   * It does NOT add a fourth `visibility` value. A "nominated" tier would be
--     invisible to otter_courses_select, otter_course_index, VISIBILITY_META,
--     CourseBadges.jsx and courseMatchesFilter, all of which enumerate three.
--     Nomination state lives on the nomination row.
--   * It does NOT widen otter_courses_insert. A manager still cannot CREATE a
--     course directly into the company_standard tier; they can only approve an
--     existing one into it.
--   * It does NOT grant DELETE. Decision history is retained, as for change
--     requests.
--   * Audit columns mirror otter_change_requests (created/updated only), not
--     0061's fuller leaf-table set. This is a decision-history sibling of that
--     table, not a RABBIT leaf entity, and matching its sibling matters more.
--
-- 🚨 ORDERING RULE (inherited from 0025 and 0026, and now extended):
-- this file redefines otter_courses_select, otter_course_index() and
-- fn_otter_pin_course_identity. A manual re-run of 0022 must be followed by
-- 0025, 0026 AND 0064, or the review window, the manager queue read and the
-- whole nomination flow silently revert while every post-condition still
-- passes.
--
-- pgTAP: supabase/tests/rls/70_otter_course_nominations.sql (new suite).
-- Idempotent: IF NOT EXISTS / DROP+CREATE throughout. Safe to re-run.
-- =============================================================================

-- ── 1. The table ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.otter_course_nominations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 🚨 THE DEFAULTS ARE LOAD-BEARING, and matching otter_change_requests is not
  -- cosmetic. The client inserts only { course_id, summary } — every other
  -- column is the server's to decide, and a proposer must not be able to name
  -- themselves as someone else or file into another workspace. Without these
  -- two DEFAULTs every real insert dies on a NOT NULL violation while a pgTAP
  -- suite that supplies them explicitly stays green: this exact gap was found
  -- by writing the adapter, not by the 34 probes that passed over it.
  workspace_id  UUID NOT NULL DEFAULT public.current_workspace_id()
                REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- The course being put forward. CASCADE: a purged course leaves no decidable
  -- nomination behind, and unlike a change request there is no second course
  -- whose history we would be destroying.
  course_id     UUID NOT NULL REFERENCES public.otter_courses(id) ON DELETE CASCADE,
  proposed_by   UUID NOT NULL DEFAULT auth.uid(),
  summary       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open',
  reviewed_by   UUID,
  reviewed_at   TIMESTAMPTZ,
  review_note   TEXT,
  revision      INTEGER NOT NULL DEFAULT 1,
  acknowledged_at TIMESTAMPTZ,
  applied_at    TIMESTAMPTZ,
  applied_by    UUID,
  -- The standard this one displaced, if any. FK-less on purpose, matching
  -- otter_change_requests.archive_course_id: it is a historical pointer, and it
  -- must survive the other course being trashed.
  superseded_course_id UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID
);

-- Idempotent re-assertion: CREATE TABLE IF NOT EXISTS is a no-op on a database
-- where an earlier draft of this file already ran, so the defaults above would
-- never land there. Setting them explicitly is cheap and cannot be skipped.
ALTER TABLE public.otter_course_nominations
  ALTER COLUMN workspace_id SET DEFAULT public.current_workspace_id();
ALTER TABLE public.otter_course_nominations
  ALTER COLUMN proposed_by  SET DEFAULT auth.uid();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_course_nominations'::regclass
                    AND conname = 'otter_nom_note_chk') THEN
    ALTER TABLE public.otter_course_nominations ADD CONSTRAINT otter_nom_note_chk
      CHECK (review_note IS NULL OR char_length(review_note) <= 4000);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_course_nominations'::regclass
                    AND conname = 'otter_nom_status_chk') THEN
    ALTER TABLE public.otter_course_nominations ADD CONSTRAINT otter_nom_status_chk
      CHECK (status IN ('open', 'changes_requested', 'approved', 'rejected', 'withdrawn'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_course_nominations'::regclass
                    AND conname = 'otter_nom_summary_chk') THEN
    ALTER TABLE public.otter_course_nominations ADD CONSTRAINT otter_nom_summary_chk
      CHECK (btrim(summary) <> '' AND length(summary) <= 4000);
  END IF;

  -- A decline must say what should change. Same rule as otter_cr_declined_note_chk:
  -- a decline with no note is a dead end for the proposer.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_course_nominations'::regclass
                    AND conname = 'otter_nom_declined_note_chk') THEN
    ALTER TABLE public.otter_course_nominations ADD CONSTRAINT otter_nom_declined_note_chk
      CHECK (status <> 'changes_requested'
             OR (review_note IS NOT NULL AND btrim(review_note) <> ''));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_course_nominations'::regclass
                    AND conname = 'otter_nom_revision_chk') THEN
    ALTER TABLE public.otter_course_nominations ADD CONSTRAINT otter_nom_revision_chk
      CHECK (revision >= 1);
  END IF;

  -- Only an approved nomination carries apply stamps, and an approved one must.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_course_nominations'::regclass
                    AND conname = 'otter_nom_applied_chk') THEN
    ALTER TABLE public.otter_course_nominations ADD CONSTRAINT otter_nom_applied_chk
      CHECK ((status = 'approved') = (applied_at IS NOT NULL));
  END IF;
END $$;

-- One live nomination per course. Without this a user can queue five
-- nominations for the same course and a reviewer sees five identical rows.
CREATE UNIQUE INDEX IF NOT EXISTS otter_nom_one_live_per_course_uidx
  ON public.otter_course_nominations (course_id)
  WHERE status IN ('open', 'changes_requested');

CREATE INDEX IF NOT EXISTS otter_nom_workspace_status_idx
  ON public.otter_course_nominations (workspace_id, status);
CREATE INDEX IF NOT EXISTS otter_nom_proposed_by_idx
  ON public.otter_course_nominations (proposed_by);
CREATE INDEX IF NOT EXISTS otter_nom_course_idx
  ON public.otter_course_nominations (course_id);

ALTER TABLE public.otter_course_nominations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otter_course_nominations FORCE  ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_otter_nom_audit ON public.otter_course_nominations;
CREATE TRIGGER trg_otter_nom_audit
  BEFORE INSERT OR UPDATE ON public.otter_course_nominations
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_touch();

REVOKE ALL    ON public.otter_course_nominations FROM PUBLIC, anon;
-- No DELETE: a decision is a record. Same rule as otter_change_requests.
GRANT  SELECT, INSERT, UPDATE ON public.otter_course_nominations TO authenticated;
GRANT  ALL    ON public.otter_course_nominations TO service_role;

COMMENT ON TABLE public.otter_course_nominations IS
  '0064: a proposal that a course become the workspace company standard. Anyone may nominate a course they own; workspace admins and managers decide. Approval runs through otter_nomination_apply() — the only path to status=approved.';
COMMENT ON COLUMN public.otter_course_nominations.superseded_course_id IS
  '0064: the company_standard course this nomination displaced (demoted to shared), if there was one. FK-less on purpose — a historical pointer that must outlive the other row.';

-- ── 2. The consent helper ────────────────────────────────────────────────────
-- True when the caller may read p_course_id BECAUSE it is the subject of a live
-- nomination they are entitled to decide. See the header for why the role test
-- lives here rather than in the policy, and why this is not a widening of
-- otter_has_open_review_access.

CREATE OR REPLACE FUNCTION public.otter_has_open_nomination_access(p_course_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_ws   UUID := public.current_workspace_id();
  v_role TEXT;
BEGIN
  IF v_uid IS NULL OR v_ws IS NULL THEN
    RETURN false;
  END IF;

  -- Live-row membership and role, never the JWT (the 0010/0021/0024/0025
  -- convention): a deactivated or demoted approver loses the window on the next
  -- statement, not the next token refresh.
  SELECT wm.app_role INTO v_role
    FROM public.workspace_members wm
   WHERE wm.workspace_id = v_ws
     AND wm.user_id = v_uid
     AND wm.is_active;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'manager') THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM public.otter_course_nominations n
      JOIN public.otter_courses c ON c.id = n.course_id
     WHERE n.course_id = p_course_id
       AND n.workspace_id = v_ws
       AND n.status IN ('open', 'changes_requested')
       -- Consent: only the proposer's OWN course opens, and only while the
       -- nomination is live. Also enforced at INSERT.
       AND c.owner_id = n.proposed_by
       AND c.deleted_at IS NULL
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_has_open_nomination_access(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_has_open_nomination_access(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.otter_has_open_nomination_access IS
  '0064: consented nomination-review read access. True when p_course_id is the proposer-owned subject of an open/changes_requested nomination and the caller is an active workspace admin or manager (live row). Read-only — no write path consults it.';

-- ── 3. The read window reaches the course ────────────────────────────────────
-- otter_courses_select: 0025 verbatim plus the nomination arm. Still no
-- current_app_role() anywhere in the qual — the role test rides the helper.

DROP POLICY IF EXISTS otter_courses_select ON public.otter_courses;
CREATE POLICY otter_courses_select ON public.otter_courses
  FOR SELECT USING (
    deleted_at IS NULL
    AND workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (
      owner_id = auth.uid()
      OR visibility IN ('shared', 'company_standard')
      OR public.otter_has_editor_grant(id)
      OR public.otter_has_open_review_access(id)
      OR public.otter_has_open_nomination_access(id)
    )
  );

-- otter_course_index: same declared signature (pgTAP 26 pins it). The window
-- joins can_read_content and the admission arm, and deliberately NOT can_write
-- — an approver reads a nominee's course, they do not edit it. That is the same
-- line 0025 drew for the change-request window.

CREATE OR REPLACE FUNCTION public.otter_course_index()
RETURNS TABLE (
  id               UUID,
  workspace_id     UUID,
  owner_id         UUID,
  owner_label      TEXT,
  slug             TEXT,
  name             TEXT,
  course_type      TEXT,
  skill_level      TEXT,
  visibility       TEXT,
  source_course_id UUID,
  subject_count    INTEGER,
  is_own           BOOLEAN,
  can_read_content BOOLEAN,
  can_write        BOOLEAN,
  created_at       TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ
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
  SELECT c.id,
         c.workspace_id,
         c.owner_id,
         COALESCE(wm.display_name, wm.username) AS owner_label,
         c.slug,
         c.name,
         c.course_type,
         c.skill_level,
         c.visibility,
         c.source_course_id,
         (SELECT count(*)::INTEGER FROM public.otter_subjects s
           WHERE s.course_id = c.id AND s.deleted_at IS NULL) AS subject_count,
         (c.owner_id = v_uid) AS is_own,
         (c.owner_id = v_uid
          OR c.visibility IN ('shared', 'company_standard')
          OR public.otter_has_editor_grant(c.id)
          OR public.otter_has_open_review_access(c.id)
          OR public.otter_has_open_nomination_access(c.id)) AS can_read_content,
         (c.owner_id = v_uid
          OR v_role = 'admin'
          OR public.otter_has_editor_grant(c.id)) AS can_write,
         c.created_at,
         c.updated_at
    FROM public.otter_courses c
    LEFT JOIN public.workspace_members wm
           ON wm.workspace_id = c.workspace_id AND wm.user_id = c.owner_id
   WHERE c.workspace_id = v_ws
     AND c.deleted_at IS NULL
     AND (
       v_role = 'admin'
       OR c.owner_id = v_uid
       OR c.visibility IN ('shared', 'company_standard')
       OR public.otter_has_editor_grant(c.id)
       OR public.otter_has_open_review_access(c.id)
       OR public.otter_has_open_nomination_access(c.id)
     )
   ORDER BY c.updated_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_course_index() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_course_index() TO authenticated, service_role;

-- ── 4. Nomination policies ───────────────────────────────────────────────────

-- Read: the proposer sees their own; admins and managers see the queue. This
-- table is decision metadata, not course content, so current_app_role() is
-- correct here and the otter_courses post-condition does not apply to it — the
-- same line 0026 drew for otter_cr_select.
DROP POLICY IF EXISTS otter_nom_select ON public.otter_course_nominations;
CREATE POLICY otter_nom_select ON public.otter_course_nominations
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (
      proposed_by = auth.uid()
      OR public.current_app_role() IN ('admin', 'manager')
    )
  );

-- Insert: anyone may nominate, but only a course they OWN — submitting opens
-- that course to approvers, and consent is not something you can give on
-- someone else's behalf. A course already in the tier has nothing to nominate.
DROP POLICY IF EXISTS otter_nom_insert ON public.otter_course_nominations;
CREATE POLICY otter_nom_insert ON public.otter_course_nominations
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND proposed_by = auth.uid()
    AND status = 'open'
    AND revision = 1
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    -- The decision fields are the approver's. A proposer pre-filling
    -- review_note ("Approved by Ops") would carry a forged endorsement into the
    -- settled row — the 0025 tightening, applied here from the start.
    AND review_note IS NULL
    AND applied_at IS NULL
    AND applied_by IS NULL
    AND superseded_course_id IS NULL
    AND acknowledged_at IS NULL
    AND public.otter_is_course_owner(course_id)
    AND public.otter_course_visibility(course_id) <> 'company_standard'
    -- otter_course_visibility() and otter_is_course_owner() are workspace-blind
    -- DEFINERs, so re-assert the course is readable in the caller's OWN
    -- workspace under their own RLS (the 0025 fix for cross-workspace junk).
    AND EXISTS (
      SELECT 1 FROM public.otter_courses c
       WHERE c.id = otter_course_nominations.course_id
    )
  );

-- Update: USING admits everyone who may touch the row at all; WITH CHECK is the
-- real decide gate. Widening USING alone would change nothing; widening
-- WITH CHECK alone is what grants decide rights.
DROP POLICY IF EXISTS otter_nom_update ON public.otter_course_nominations;
CREATE POLICY otter_nom_update ON public.otter_course_nominations
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (
      proposed_by = auth.uid()
      OR public.current_app_role() IN ('admin', 'manager')
    )
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (
      public.current_app_role() IN ('admin', 'manager')
      -- The proposer may refine while open, withdraw, resubmit after a decline
      -- (NEW.status = 'open'), or accept a decline (NEW.status = 'rejected').
      -- fn_otter_nomination_review owns WHICH of those a given FROM-state
      -- permits.
      OR (proposed_by = auth.uid() AND status IN ('open', 'withdrawn', 'rejected'))
    )
  );

-- ── 5. fn_otter_nomination_review — the transition table ─────────────────────

CREATE OR REPLACE FUNCTION public.fn_otter_nomination_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  -- Approver authority from the LIVE membership row, never the JWT. COALESCE is
  -- load-bearing: the EXISTS can be NULL and NOT(NULL) is not true (the
  -- fn_otter_pin_course_identity lesson).
  v_is_approver BOOLEAN := COALESCE(
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
       WHERE wm.workspace_id = OLD.workspace_id
         AND wm.user_id = auth.uid()
         AND wm.is_active
         AND wm.app_role IN ('admin', 'manager')
    ), false);
  -- Set only by otter_nomination_apply, transaction-locally, to the id it is
  -- applying.
  v_via_apply   BOOLEAN := COALESCE(
    current_setting('wilson.otter_nomination_apply', true) = OLD.id::text, false);
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status IN ('approved', 'rejected', 'withdrawn') THEN
      RAISE EXCEPTION 'nomination already % — reopen is not permitted', OLD.status;
    END IF;

    NEW.revision        := OLD.revision;
    NEW.acknowledged_at := OLD.acknowledged_at;

    IF OLD.status = 'open' AND NEW.status = 'approved' THEN
      -- Approving IS promoting. A bare status flip would record an approval
      -- that never changed the tier.
      IF NOT v_via_apply THEN
        RAISE EXCEPTION 'approving promotes the course — call otter_nomination_apply() instead of setting the status';
      END IF;
      NEW.reviewed_by := v_uid;
      NEW.reviewed_at := now();

    ELSIF OLD.status = 'open' AND NEW.status = 'rejected' THEN
      IF NOT v_is_approver THEN
        RAISE EXCEPTION 'only an admin or a manager may decide a nomination';
      END IF;
      NEW.reviewed_by := v_uid;
      NEW.reviewed_at := now();

    ELSIF OLD.status = 'open' AND NEW.status = 'changes_requested' THEN
      IF NOT v_is_approver THEN
        RAISE EXCEPTION 'only an admin or a manager may decide a nomination';
      END IF;
      IF NEW.review_note IS NULL OR btrim(NEW.review_note) = '' THEN
        RAISE EXCEPTION 'declining requires a note to the proposer — say what should change';
      END IF;
      NEW.reviewed_by := v_uid;
      NEW.reviewed_at := now();

    ELSIF OLD.status = 'open' AND NEW.status = 'withdrawn' THEN
      IF v_uid IS DISTINCT FROM OLD.proposed_by THEN
        RAISE EXCEPTION 'only the proposer may withdraw a nomination';
      END IF;
      -- Proposer actions never write review fields. Pinning them here matters:
      -- a withdraw that smuggled reviewed_by/reviewed_at would store a forged
      -- review by a named approver in retained history (the S13 finding).
      NEW.review_note := OLD.review_note;
      NEW.reviewed_by := OLD.reviewed_by;
      NEW.reviewed_at := OLD.reviewed_at;

    ELSIF OLD.status = 'changes_requested' AND NEW.status = 'open' THEN
      -- Revise and resubmit: a fresh round. Reviewer stamps clear (nobody has
      -- decided THIS revision); the note stays — it is the conversation.
      IF v_uid IS DISTINCT FROM OLD.proposed_by THEN
        RAISE EXCEPTION 'only the proposer may revise and resubmit';
      END IF;
      NEW.revision        := OLD.revision + 1;
      NEW.reviewed_by     := NULL;
      NEW.reviewed_at     := NULL;
      NEW.acknowledged_at := NULL;
      NEW.review_note     := OLD.review_note;

    ELSIF OLD.status = 'changes_requested' AND NEW.status = 'rejected' THEN
      -- Accept the decision. The DECLINER stays the reviewer of record — the
      -- proposer acknowledging is not a review.
      IF v_uid IS DISTINCT FROM OLD.proposed_by THEN
        RAISE EXCEPTION 'only the proposer may accept the decision';
      END IF;
      NEW.reviewed_by     := OLD.reviewed_by;
      NEW.reviewed_at     := OLD.reviewed_at;
      NEW.review_note     := OLD.review_note;
      NEW.acknowledged_at := now();

    ELSE
      RAISE EXCEPTION 'a nomination cannot move from % to %', OLD.status, NEW.status;
    END IF;

  ELSE
    NEW.reviewed_by     := OLD.reviewed_by;
    NEW.reviewed_at     := OLD.reviewed_at;
    NEW.revision        := OLD.revision;
    NEW.acknowledged_at := OLD.acknowledged_at;
    IF NEW.review_note IS DISTINCT FROM OLD.review_note AND NOT v_is_approver THEN
      NEW.review_note := OLD.review_note;
    END IF;
    -- A settled nomination is a RECORD. Freeze the words rather than raising:
    -- the proposer's RLS arm includes 'rejected' so they can accept a decline,
    -- which would otherwise let them edit the summary of a closed row.
    IF OLD.status IN ('approved', 'rejected', 'withdrawn') THEN
      NEW.summary     := OLD.summary;
      NEW.review_note := OLD.review_note;
    END IF;
  END IF;

  -- The apply stamps belong to otter_nomination_apply alone.
  IF NOT v_via_apply THEN
    NEW.applied_at           := OLD.applied_at;
    NEW.applied_by           := OLD.applied_by;
    NEW.superseded_course_id := OLD.superseded_course_id;
  END IF;

  -- Immutable provenance. course_id in particular: re-pointing it after
  -- submission would move the consented read window onto a different course.
  NEW.proposed_by  := OLD.proposed_by;
  NEW.course_id    := OLD.course_id;
  NEW.workspace_id := OLD.workspace_id;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_otter_nomination_review() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_otter_nom_review ON public.otter_course_nominations;
CREATE TRIGGER trg_otter_nom_review
  BEFORE UPDATE ON public.otter_course_nominations
  FOR EACH ROW EXECUTE FUNCTION public.fn_otter_nomination_review();

-- ── 6. fn_otter_pin_course_identity — ONE arm added ──────────────────────────
-- 🚨 GUARD FUNCTION. The two arms below the new one are 0022 verbatim, including
-- both COALESCE wrappers, verified against the DEPLOYED body with
-- pg_get_functiondef before this file was written. A post-condition asserts they
-- are still here. See the header: 0059 deleted a guard's clauses exactly this
-- way and it cost a live privilege escalation.

CREATE OR REPLACE FUNCTION public.fn_otter_pin_course_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.workspace_id := OLD.workspace_id;
  NEW.owner_id     := OLD.owner_id;

  -- Visibility is part of a course's identity, not ordinary content. The
  -- UPDATE policy's WITH CHECK only ever looked at the NEW value, which left
  -- two holes: a granted editor could publish the owner's PERSONAL course
  -- workspace-wide (write access is not permission to disclose), and anyone
  -- with write access could quietly demote a company_standard course out of
  -- the tier because the admin arm never fired on the way DOWN.
  -- COALESCE is load-bearing. current_app_role() is NULL for a plain member
  -- (the JWT simply has no app_role claim), so `NOT (false OR NULL)` is NULL,
  -- and plpgsql treats `IF NULL` as false — the guard silently did nothing for
  -- exactly the users it exists to stop. RLS policies get away with the bare
  -- comparison because NULL there means "deny"; inside a NOT it means "allow".
  IF NEW.visibility IS DISTINCT FROM OLD.visibility THEN
    -- 0064: otter_nomination_apply() is promoting this exact course, or
    -- demoting the incumbent standard it displaces, inside its own transaction.
    -- It has already established from the LIVE workspace_members row that the
    -- caller is an active admin or manager. The GUC is transaction-local and
    -- names one course id, so it cannot leak to another statement or row.
    -- This arm is FIRST because it is an authorisation the two arms below
    -- cannot express: they test the JWT, and a manager legitimately fails both.
    IF COALESCE(current_setting('wilson.otter_nomination_promote', true)
                = OLD.id::text, false) THEN
      NULL;
    ELSIF NOT COALESCE(OLD.owner_id = auth.uid()
                    OR public.current_app_role() = 'admin', false) THEN
      -- Only the owner (or an admin) decides who may see a course at all.
      NEW.visibility := OLD.visibility;
    ELSIF (OLD.visibility = 'company_standard' OR NEW.visibility = 'company_standard')
          AND COALESCE(public.current_app_role(), '') <> 'admin' THEN
      -- Entering or LEAVING the company-standard tier is admin-only.
      NEW.visibility := OLD.visibility;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 0022 created the trigger; CREATE OR REPLACE FUNCTION re-points it in place.
-- Recreate defensively so this file stands alone. A no-op where 0022 has run.
DROP TRIGGER IF EXISTS trg_otter_pin_course ON public.otter_courses;
CREATE TRIGGER trg_otter_pin_course
  BEFORE UPDATE ON public.otter_courses
  FOR EACH ROW EXECUTE FUNCTION public.fn_otter_pin_course_identity();

-- ── 7. otter_nomination_apply() — the only path to 'approved' ────────────────

CREATE OR REPLACE FUNCTION public.otter_nomination_apply(p_nomination_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_ws         UUID := public.current_workspace_id();
  v_role       TEXT;
  v_nom        public.otter_course_nominations%ROWTYPE;
  v_course     public.otter_courses%ROWTYPE;
  v_incumbent  public.otter_courses%ROWTYPE;
  v_clash      TEXT;
  v_after      TEXT;
BEGIN
  SELECT wm.app_role INTO v_role
    FROM public.workspace_members wm
   WHERE wm.workspace_id = v_ws
     AND wm.user_id = v_uid
     AND wm.is_active;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'not_a_workspace_member';
  END IF;
  IF v_role NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'only an admin or a manager may approve a nomination';
  END IF;

  -- Lock the nomination: two approvers acting concurrently must serialize, and
  -- the loser must see a settled nomination rather than double-apply.
  SELECT * INTO v_nom
    FROM public.otter_course_nominations
   WHERE id = p_nomination_id
     FOR UPDATE;

  IF v_nom.id IS NULL OR v_nom.workspace_id IS DISTINCT FROM v_ws THEN
    RAISE EXCEPTION 'nomination not found in this workspace';
  END IF;
  IF v_nom.status <> 'open' THEN
    RAISE EXCEPTION 'nomination is % — only an open nomination can be approved', v_nom.status;
  END IF;

  -- Lock the course too: the incumbent search and the promotion must not race
  -- another approval for the same slug.
  SELECT * INTO v_course
    FROM public.otter_courses c
   WHERE c.id = v_nom.course_id
     AND c.deleted_at IS NULL
     FOR UPDATE;
  IF v_course.id IS NULL THEN
    RAISE EXCEPTION 'the nominated course no longer exists';
  END IF;
  IF v_course.workspace_id IS DISTINCT FROM v_ws THEN
    RAISE EXCEPTION 'the nominated course is not in this workspace';
  END IF;
  IF v_course.owner_id IS DISTINCT FROM v_nom.proposed_by THEN
    RAISE EXCEPTION 'the nominated course is no longer owned by the proposer';
  END IF;
  IF v_course.visibility = 'company_standard' THEN
    RAISE EXCEPTION 'this course is already the company standard';
  END IF;

  -- ⚠️ The slug is not the topic. A same-NAME standard on a DIFFERENT slug will
  -- not collide with the unique index, so approving would silently produce two
  -- live standards for one topic. Refuse loudly instead — see the header.
  SELECT c.name INTO v_clash
    FROM public.otter_courses c
   WHERE c.workspace_id = v_ws
     AND c.deleted_at IS NULL
     AND c.visibility = 'company_standard'
     AND c.slug <> v_course.slug
     AND lower(c.name) = lower(v_course.name)
   LIMIT 1;
  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION 'there is already a company standard called "%" under a different identifier — rename one of them, or approve a copy forked from the existing standard', v_clash;
  END IF;

  -- Demote the incumbent for this slug, if any. Demote, never trash: trashing
  -- CASCADEs away every change request ever approved against it.
  SELECT * INTO v_incumbent
    FROM public.otter_courses c
   WHERE c.workspace_id = v_ws
     AND c.slug = v_course.slug
     AND c.visibility = 'company_standard'
     AND c.deleted_at IS NULL
     AND c.id <> v_course.id
     FOR UPDATE;

  IF v_incumbent.id IS NOT NULL THEN
    PERFORM set_config('wilson.otter_nomination_promote', v_incumbent.id::text, true);
    UPDATE public.otter_courses SET visibility = 'shared' WHERE id = v_incumbent.id;

    -- The pin trigger reverts silently rather than raising, so a failed demote
    -- would leave the promotion below to die on 23505 — or worse, succeed
    -- against a stale read. Verify.
    SELECT visibility INTO v_after FROM public.otter_courses WHERE id = v_incumbent.id;
    IF v_after <> 'shared' THEN
      RAISE EXCEPTION 'could not stand down the current standard course — nothing has been changed';
    END IF;
  END IF;

  PERFORM set_config('wilson.otter_nomination_promote', v_course.id::text, true);
  UPDATE public.otter_courses SET visibility = 'company_standard' WHERE id = v_course.id;

  SELECT visibility INTO v_after FROM public.otter_courses WHERE id = v_course.id;
  IF v_after <> 'company_standard' THEN
    RAISE EXCEPTION 'the promotion did not take effect — nothing has been changed';
  END IF;

  -- Clear it before settling the nomination row: this GUC authorises a
  -- visibility change and must not still be live for any later statement in
  -- the caller's transaction.
  PERFORM set_config('wilson.otter_nomination_promote', '', true);

  PERFORM set_config('wilson.otter_nomination_apply', v_nom.id::text, true);
  UPDATE public.otter_course_nominations
     SET status               = 'approved',
         applied_at           = now(),
         applied_by           = v_uid,
         superseded_course_id = v_incumbent.id
   WHERE id = v_nom.id;
  PERFORM set_config('wilson.otter_nomination_apply', '', true);

  RETURN v_course.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_nomination_apply(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_nomination_apply(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.otter_nomination_apply IS
  '0064: approves an open nomination by PROMOTING the course to company_standard, demoting the incumbent standard for that slug to shared first. Refuses when a same-named standard exists under a different slug. Returns the promoted course id. The only path to status=approved.';

-- ── 8. Post-conditions ───────────────────────────────────────────────────────

DO $$
DECLARE
  t   TEXT;
  def TEXT;
  n   INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables
                  WHERE schemaname = 'public' AND tablename = 'otter_course_nominations') THEN
    RAISE EXCEPTION '0064 post-condition failed: otter_course_nominations missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_class
                  WHERE oid = 'public.otter_course_nominations'::regclass
                    AND relrowsecurity AND relforcerowsecurity) THEN
    RAISE EXCEPTION '0064 post-condition failed: RLS must be enabled AND forced on otter_course_nominations';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'otter_course_nominations';
  IF n <> 3 THEN
    RAISE EXCEPTION '0064 post-condition failed: expected 3 policies on otter_course_nominations, found %', n;
  END IF;

  -- Decision history is retained, as for change requests.
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'otter_course_nominations'
                AND cmd = 'DELETE') THEN
    RAISE EXCEPTION '0064 post-condition failed: otter_course_nominations must retain decision history';
  END IF;

  IF has_table_privilege('anon', 'public.otter_course_nominations', 'SELECT')
     OR has_table_privilege('anon', 'public.otter_course_nominations', 'INSERT')
     OR has_table_privilege('anon', 'public.otter_course_nominations', 'UPDATE')
     OR has_table_privilege('anon', 'public.otter_course_nominations', 'DELETE') THEN
    RAISE EXCEPTION '0064 post-condition failed: anon holds a privilege on otter_course_nominations';
  END IF;

  -- 🚨 The client inserts only { course_id, summary }. Without these defaults
  -- every real nomination dies on a NOT NULL violation, and no pgTAP probe that
  -- supplies the columns explicitly would ever notice.
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema='public' AND table_name='otter_course_nominations'
         AND column_name='workspace_id') IS DISTINCT FROM 'current_workspace_id()' THEN
    RAISE EXCEPTION '0064 post-condition failed: otter_course_nominations.workspace_id must default to current_workspace_id()';
  END IF;
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema='public' AND table_name='otter_course_nominations'
         AND column_name='proposed_by') IS DISTINCT FROM 'auth.uid()' THEN
    RAISE EXCEPTION '0064 post-condition failed: otter_course_nominations.proposed_by must default to auth.uid()';
  END IF;

  -- The manager arm actually landed (the 0026 probe idiom).
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'otter_course_nominations'
                    AND policyname = 'otter_nom_update'
                    AND with_check LIKE '%manager%') THEN
    RAISE EXCEPTION '0064 post-condition failed: the manager decide arm is missing from otter_nom_update WITH CHECK';
  END IF;

  -- 0022's central rule survives: no app-role bypass in any personal-content
  -- SELECT policy. The nomination window rides the helper, like the review one.
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public'
                AND tablename IN ('otter_courses', 'otter_progress')
                AND cmd = 'SELECT'
                AND qual LIKE '%current_app_role%') THEN
    RAISE EXCEPTION '0064 post-condition failed: admin bypass leaked into a personal-content SELECT policy';
  END IF;

  -- 🚨 The guard function still guards. 0059 deleted a guard's clauses with a
  -- CREATE OR REPLACE and it cost a live privilege escalation; this asserts
  -- both 0022 arms survived the arm added above.
  def := pg_get_functiondef('public.fn_otter_pin_course_identity()'::regprocedure);
  IF def NOT LIKE '%OLD.owner_id = auth.uid()%' THEN
    RAISE EXCEPTION '0064 post-condition failed: the owner-or-admin arm was dropped from fn_otter_pin_course_identity';
  END IF;
  IF def NOT LIKE '%company_standard%' OR def NOT LIKE '%<> ''admin''%' THEN
    RAISE EXCEPTION '0064 post-condition failed: the company-standard admin-only arm was dropped from fn_otter_pin_course_identity';
  END IF;
  IF (length(def) - length(replace(def, 'NEW.visibility := OLD.visibility', ''))) / 32 <> 2 THEN
    RAISE EXCEPTION '0064 post-condition failed: expected exactly 2 silent-revert assignments in fn_otter_pin_course_identity';
  END IF;
  IF (length(def) - length(replace(def, 'COALESCE', ''))) / 8 < 3 THEN
    RAISE EXCEPTION '0064 post-condition failed: a COALESCE wrapper was dropped from fn_otter_pin_course_identity';
  END IF;

  -- Change requests are untouched: a manager must still NOT be able to decide
  -- one. If this ever passes, the nomination work leaked into the CR policies
  -- and pgTAP 32's manager-refusal probes are about to start lying.
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'otter_change_requests'
                AND policyname = 'otter_cr_update'
                AND with_check LIKE '%manager%') THEN
    RAISE EXCEPTION '0064 post-condition failed: nomination work leaked a manager arm into otter_cr_update';
  END IF;

  FOREACH t IN ARRAY ARRAY['otter_nomination_apply(uuid)',
                           'otter_has_open_nomination_access(uuid)',
                           'otter_has_open_review_access(uuid)',
                           'otter_course_index()',
                           'fn_otter_nomination_review()']
  LOOP
    IF to_regprocedure('public.' || t) IS NULL THEN
      RAISE EXCEPTION '0064 post-condition failed: function % missing', t;
    END IF;
  END LOOP;

  FOREACH t IN ARRAY ARRAY['trg_otter_nom_audit', 'trg_otter_nom_review']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.otter_course_nominations'::regclass
                      AND tgname = t AND NOT tgisinternal) THEN
      RAISE EXCEPTION '0064 post-condition failed: trigger % missing', t;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.otter_courses'::regclass
                    AND tgname = 'trg_otter_pin_course' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '0064 post-condition failed: trg_otter_pin_course was not re-attached';
  END IF;
END $$;

-- PostgREST caches the schema. Without this the first nomination write fails
-- with a schema-cache miss, which reads as a broken feature rather than an
-- unapplied migration (the 0063 lesson).
NOTIFY pgrst, 'reload schema';
