-- =============================================================================
-- 0025_otter_cr_apply.sql — Session 13 (change-request approval that APPLIES)
--
-- Locked #22 (Audrey, 2026-07-29): "we need to make sure the approval
-- automatically updates the course … the admin should be able to review and
-- approve or they should be able to decline for the end user to be able to
-- review the decision and either accept or do changes the admin is asking for
-- … the admin should be able to add a note/explanation for the decline that
-- can be shared with the user" and "when the user submits the change that
-- should allow the admin to see the course now".
--
-- Under 0022 an approval was a decision record that moved no content, and
-- fn_otter_cr_review hard-blocked ANY transition out of a non-open state, so
-- the revise-and-resubmit conversation could not exist. 0025 makes the flow
-- real:
--
--   open ──approve──►  approved   (terminal — and APPLIES, via otter_cr_apply)
--     │
--     └──decline───►  changes_requested   (review_note REQUIRED)
--                          │
--                          ├─ proposer accepts ──► rejected + acknowledged_at
--                          └─ proposer resubmits ─► open  (revision + 1)
--
--   open ──proposer withdraws──► withdrawn   (terminal)
--   open ──reviewer flat-no───► rejected     (terminal; note optional)
--
-- 'approved', 'rejected' and 'withdrawn' are terminal; nothing transitions out
-- of them. 'changes_requested' is a conversation state that only the PROPOSER
-- may leave (accept or resubmit) — a decline is a request back to them, not an
-- ending (Postel's Law: the decline is a conversation, not an error).
--
-- THE TWO DECISIONS THAT SHAPE otter_cr_apply (both Audrey's, 2026-07-29):
--
--   * ADDITIVE ONLY. Approval INSERTs subjects the standard lacks and UPDATEs
--     the ones the proposer changed, matched by slug. It NEVER deletes: one
--     approval must not silently strip lessons from everyone's official
--     course. A proposer who wants something removed says so in the summary
--     and the admin deletes by hand.
--   * AUTO-ARCHIVE FIRST. O.T.T.E.R. is deliberately not edit-history captured
--     (db/README §19), so overwriting lesson text is otherwise unrecoverable.
--     Every apply first snapshots the target into a PERSONAL course owned by
--     the approving admin, named '<name> (before change #<revision>)', and
--     records it on the request as archive_course_id.
--
--   SUBJECTS ONLY (§6 #29). The five per-course reference documents carry
--   merge semantics that live in client JS (otterRoutes.js mergeHotkeys /
--   mergeFunctions / mergeNodes); reimplementing them in plpgsql would
--   duplicate load-bearing logic, and overwriting them would break
--   additive-only. The approve dialog says so.
--
-- THE REVIEW WINDOW (locked #22, third clause). Submitting a request grants
-- reviewers READ access to the proposer's source course while the request is
-- 'open' or 'changes_requested', and access ends when it settles. This is a
-- CONSENTED exception to "a personal course is private even from admins"
-- (0022), not a bypass:
--
--   * It rides a SECURITY DEFINER helper, otter_has_open_review_access(),
--     added as one OR arm to otter_courses_select. The role check lives
--     INSIDE the helper (live workspace_members row, never the JWT) because
--     0022 ships a post-condition that fails the migration if a SELECT policy
--     on otter_courses or otter_progress mentions current_app_role() — and
--     0022 is documented safe to re-run. The helper keeps that true and puts
--     the consented exception in one auditable place.
--   * The window only opens on a course the PROPOSER OWNS. Without that,
--     filing a request whose source_course_id names a COLLEAGUE's personal
--     course would expose it to admins without the colleague's consent —
--     source ownership is checked at INSERT (policy) and again inside the
--     helper and the apply RPC (belt and braces, since source_course_id is
--     client-supplied).
--   * Read only. No write arm is added anywhere; subjects come along for free
--     because otter_subjects_select's live-parent EXISTS runs under the
--     caller's own RLS.
--
-- Idempotent: safe to re-run. ORDERING RULE: this file overwrites objects
-- 0022 also creates (fn_otter_cr_review, otter_courses_select,
-- otter_cr_insert/update, otter_course_index) — 0025 must always run AFTER
-- 0022, and any MANUAL re-run of 0022 must be followed by re-running this
-- file, or the state machine and review window silently revert to their S10
-- shapes while every post-condition still passes. The migration runner's
-- by-version ordering guarantees this on every normal path.
-- pgTAP: 32_otter_cr_apply.sql (new); 30_otter_change_requests.sql updated —
-- its direct-approve probe now pins the reject path, because a direct UPDATE
-- to 'approved' is exactly what this migration forbids.
-- =============================================================================

-- ── 1. Columns + constraints ─────────────────────────────────────────────────

ALTER TABLE public.otter_change_requests
  ADD COLUMN IF NOT EXISTS applied_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS applied_by        UUID,
  -- FK-less like otter_courses.source_course_id: the archive is an ordinary
  -- personal course the admin may later trash/purge, and provenance must not
  -- block the purge sweep.
  ADD COLUMN IF NOT EXISTS archive_course_id UUID,
  ADD COLUMN IF NOT EXISTS revision          INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS acknowledged_at   TIMESTAMPTZ;

-- The status CHECK gains 'changes_requested'. The 0022 constraint was declared
-- inline, so it carries the auto-generated name.
ALTER TABLE public.otter_change_requests
  DROP CONSTRAINT IF EXISTS otter_change_requests_status_check;
ALTER TABLE public.otter_change_requests
  DROP CONSTRAINT IF EXISTS otter_cr_status_chk;
ALTER TABLE public.otter_change_requests
  ADD CONSTRAINT otter_cr_status_chk
  CHECK (status IN ('open', 'approved', 'rejected', 'withdrawn', 'changes_requested'));

-- A decline is a request back to the proposer — without words it is just a
-- closed door. The trigger raises a friendlier message first; this is the
-- schema-level backstop.
ALTER TABLE public.otter_change_requests
  DROP CONSTRAINT IF EXISTS otter_cr_declined_note_chk;
ALTER TABLE public.otter_change_requests
  ADD CONSTRAINT otter_cr_declined_note_chk
  CHECK (status <> 'changes_requested'
         OR (review_note IS NOT NULL AND btrim(review_note) <> ''));

-- Applied stamps only ever appear on an approved request. Deliberately NOT the
-- other direction: requests approved under 0022 (decision-record era) exist in
-- all three envs with applied_at NULL, and they must stay valid.
ALTER TABLE public.otter_change_requests
  DROP CONSTRAINT IF EXISTS otter_cr_applied_chk;
ALTER TABLE public.otter_change_requests
  ADD CONSTRAINT otter_cr_applied_chk
  CHECK (status = 'approved'
         OR (applied_at IS NULL AND applied_by IS NULL AND archive_course_id IS NULL));

ALTER TABLE public.otter_change_requests
  DROP CONSTRAINT IF EXISTS otter_cr_revision_chk;
ALTER TABLE public.otter_change_requests
  ADD CONSTRAINT otter_cr_revision_chk CHECK (revision >= 1);

-- otter_courses_select now probes "is there a live review on this course" per
-- row; 0022 indexed by target but never by source.
CREATE INDEX IF NOT EXISTS otter_cr_source_status_idx
  ON public.otter_change_requests (source_course_id, status)
  WHERE status IN ('open', 'changes_requested');

COMMENT ON COLUMN public.otter_change_requests.revision IS
  'Session 13: how many times this request has been submitted. Bumped by fn_otter_cr_review on changes_requested → open.';
COMMENT ON COLUMN public.otter_change_requests.archive_course_id IS
  'Session 13: the pre-apply snapshot of the target course, created by otter_cr_apply and owned by the approver. FK-less on purpose.';
COMMENT ON COLUMN public.otter_change_requests.acknowledged_at IS
  'Session 13: when the proposer accepted a decline (changes_requested → rejected). Only that transition sets it.';

-- ── 2. The review-window helper ──────────────────────────────────────────────
-- True when the caller may read p_course_id BECAUSE it is the source of a live
-- change request they are entitled to review. See the header for why the role
-- check lives here and not in the policy.

CREATE OR REPLACE FUNCTION public.otter_has_open_review_access(p_course_id UUID)
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

  -- Live-row membership and role, never the JWT (the 0010/0021/0024
  -- convention): a deactivated or demoted reviewer loses the window on the
  -- next statement, not the next token refresh.
  SELECT wm.app_role INTO v_role
    FROM public.workspace_members wm
   WHERE wm.workspace_id = v_ws
     AND wm.user_id = v_uid
     AND wm.is_active;
  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM public.otter_change_requests cr
      JOIN public.otter_courses src ON src.id = cr.source_course_id
      JOIN public.otter_courses tgt ON tgt.id = cr.target_course_id
     WHERE cr.source_course_id = p_course_id
       AND cr.workspace_id = v_ws
       AND cr.status IN ('open', 'changes_requested')
       -- Consent: only the proposer's OWN course opens. A request naming a
       -- colleague's course must never expose it (also refused at INSERT).
       AND src.owner_id = cr.proposed_by
       AND src.deleted_at IS NULL
       -- Reviewers are exactly who 0022's otter_cr_update lets decide:
       -- workspace admins and the target course's owner.
       AND (v_role = 'admin' OR tgt.owner_id = v_uid)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_has_open_review_access(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_has_open_review_access(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.otter_has_open_review_access IS
  'Session 13: consented review-window read access. True when p_course_id is the proposer-owned source of an open/changes_requested change request and the caller is a workspace admin or the target course''s owner (live row). Read-only — no write path consults it.';

-- ── 3. Policies ──────────────────────────────────────────────────────────────

-- 3a. otter_courses_select gains the review-window arm. Everything else is
--     0022 verbatim — and still no current_app_role() anywhere in the qual.
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
    )
  );

-- 3b. otter_cr_insert: 0022 verbatim plus three tightenings.
DROP POLICY IF EXISTS otter_cr_insert ON public.otter_change_requests;
CREATE POLICY otter_cr_insert ON public.otter_change_requests
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND proposed_by = auth.uid()
    AND status = 'open'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    -- 0025: the review note is the reviewer's field. 0022 let a proposer
    -- pre-fill it at INSERT ("Approved by Ops"), which an apply would then
    -- carry into the settled row as an apparent endorsement.
    AND review_note IS NULL
    -- 0025: a request is born at revision 1 with no decision residue.
    AND revision = 1
    AND applied_at IS NULL
    AND applied_by IS NULL
    AND archive_course_id IS NULL
    AND acknowledged_at IS NULL
    AND public.otter_course_visibility(target_course_id) = 'company_standard'
    -- 0025: the target must be a course the proposer can actually READ in
    -- their own workspace. otter_course_visibility() is workspace-blind
    -- (DEFINER), so without this a member could file a request in workspace B
    -- naming workspace A's standard course — undecidable junk whose approval
    -- can only abort (found by the S13 adversarial review). The EXISTS runs
    -- under the caller's own RLS, the 0022 otter_progress_insert pattern.
    AND EXISTS (
      SELECT 1 FROM public.otter_courses c
       WHERE c.id = otter_change_requests.target_course_id
    )
    -- 0025: submitting opens the SOURCE course to reviewers, so the source
    -- must be the proposer's own (see header — consent, not convenience).
    AND (source_course_id IS NULL OR public.otter_is_course_owner(source_course_id))
  );

-- 3c. otter_cr_update: the proposer's WITH CHECK arm gains 'rejected' so
--     "accept the decision" (changes_requested → rejected, acknowledged) can
--     pass RLS. fn_otter_cr_review is what stops a proposer using it to decide
--     an OPEN request — the transition table only reaches 'rejected' from
--     'open' via a reviewer.
DROP POLICY IF EXISTS otter_cr_update ON public.otter_change_requests;
CREATE POLICY otter_cr_update ON public.otter_change_requests
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (
      proposed_by = auth.uid()
      OR public.current_app_role() = 'admin'
      OR public.otter_is_course_owner(target_course_id)
    )
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (
      public.current_app_role() = 'admin'
      OR public.otter_is_course_owner(target_course_id)
      -- The proposer may refine while open, withdraw, resubmit after a
      -- decline (NEW.status = 'open'), or accept a decline
      -- (NEW.status = 'rejected'). The trigger owns WHICH of those a given
      -- FROM-state permits.
      OR (proposed_by = auth.uid() AND status IN ('open', 'withdrawn', 'rejected'))
    )
  );

-- ── 4. fn_otter_cr_review — the transition table ─────────────────────────────
-- Everything 0022 got right is preserved: the reviewer is stamped server-side
-- from auth.uid(), proposed_by / target_course_id / workspace_id are
-- immutable, and a proposer can never write review fields. New here: the full
-- state machine, revision bumping, the required decline note, acknowledged_at,
-- and the rule that 'approved' is only reachable through otter_cr_apply()
-- (via a transaction-local GUC the RPC sets) — because locked #22 says
-- approving IS applying, a bare status flip would be a lie.

CREATE OR REPLACE FUNCTION public.fn_otter_cr_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  -- Reviewer authority from the LIVE membership row, not the JWT — the same
  -- rule otter_has_open_review_access and otter_cr_apply follow, so a demoted
  -- admin loses all three on the next statement, not the next token refresh.
  -- COALESCE is load-bearing (the fn_otter_pin_course_identity lesson): the
  -- OR chain can be NULL and NOT(NULL) is not true.
  v_is_reviewer BOOLEAN := COALESCE(
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
       WHERE wm.workspace_id = OLD.workspace_id
         AND wm.user_id = auth.uid()
         AND wm.is_active
         AND wm.app_role = 'admin'
    )
    OR public.otter_is_course_owner(OLD.target_course_id), false);
  -- Set only by otter_cr_apply, transaction-locally, to the id it is applying.
  v_via_apply   BOOLEAN := COALESCE(
    current_setting('wilson.otter_cr_apply', true) = OLD.id::text, false);
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status IN ('approved', 'rejected', 'withdrawn') THEN
      RAISE EXCEPTION 'change request already % — reopen is not permitted', OLD.status;
    END IF;

    -- Baseline pins for every transition; specific arms override below.
    NEW.revision        := OLD.revision;
    NEW.acknowledged_at := OLD.acknowledged_at;

    IF OLD.status = 'open' AND NEW.status = 'approved' THEN
      IF NOT v_via_apply THEN
        RAISE EXCEPTION 'approving applies the change — call otter_cr_apply() instead of setting the status';
      END IF;
      NEW.reviewed_by := v_uid;
      NEW.reviewed_at := now();

    ELSIF OLD.status = 'open' AND NEW.status = 'rejected' THEN
      IF NOT v_is_reviewer THEN
        RAISE EXCEPTION 'only an admin or the standard course''s owner may decide a change request';
      END IF;
      NEW.reviewed_by := v_uid;
      NEW.reviewed_at := now();

    ELSIF OLD.status = 'open' AND NEW.status = 'changes_requested' THEN
      IF NOT v_is_reviewer THEN
        RAISE EXCEPTION 'only an admin or the standard course''s owner may decide a change request';
      END IF;
      IF NEW.review_note IS NULL OR btrim(NEW.review_note) = '' THEN
        RAISE EXCEPTION 'declining requires a note to the proposer — say what should change';
      END IF;
      NEW.reviewed_by := v_uid;
      NEW.reviewed_at := now();

    ELSIF OLD.status = 'open' AND NEW.status = 'withdrawn' THEN
      IF v_uid IS DISTINCT FROM OLD.proposed_by THEN
        RAISE EXCEPTION 'only the proposer may withdraw a change request';
      END IF;
      -- Proposer actions never write review fields. The reviewer stamps MUST
      -- be pinned here too: otter_cr_reviewed_chk exempts 'withdrawn', so a
      -- withdraw that smuggled reviewed_by/reviewed_at would store a forged
      -- review by a named admin in the permanently retained history (found by
      -- the S13 adversarial review).
      NEW.review_note := OLD.review_note;
      NEW.reviewed_by := OLD.reviewed_by;
      NEW.reviewed_at := OLD.reviewed_at;

    ELSIF OLD.status = 'changes_requested' AND NEW.status = 'open' THEN
      -- Revise and resubmit: a fresh round. The reviewer stamps clear (nobody
      -- has decided THIS revision); the note stays — it is the conversation.
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
      RAISE EXCEPTION 'a change request cannot move from % to %', OLD.status, NEW.status;
    END IF;

  ELSE
    -- No status change: the review fields are not the proposer's to write
    -- (0022's anti-forgery, preserved verbatim), and the 0025 bookkeeping
    -- columns are not anyone's to write outside their transitions.
    NEW.reviewed_by     := OLD.reviewed_by;
    NEW.reviewed_at     := OLD.reviewed_at;
    NEW.revision        := OLD.revision;
    NEW.acknowledged_at := OLD.acknowledged_at;
    IF NEW.review_note IS DISTINCT FROM OLD.review_note AND NOT v_is_reviewer THEN
      NEW.review_note := OLD.review_note;
    END IF;
    -- A settled request is a RECORD. Adding 'rejected' to the proposer's RLS
    -- arm (so they can accept a decline) also let them target an
    -- already-rejected row with a summary edit — a no-status-change write the
    -- 0022 arm used to refuse. Freeze the words on every terminal row instead
    -- of raising: the ON DELETE SET NULL update from a purged fork lands in
    -- this branch too, and it must keep working (found by the S13 adversarial
    -- review).
    IF OLD.status IN ('approved', 'rejected', 'withdrawn') THEN
      NEW.summary     := OLD.summary;
      NEW.review_note := OLD.review_note;
    END IF;
  END IF;

  -- The apply stamps belong to otter_cr_apply alone.
  IF NOT v_via_apply THEN
    NEW.applied_at        := OLD.applied_at;
    NEW.applied_by        := OLD.applied_by;
    NEW.archive_course_id := OLD.archive_course_id;
  END IF;

  -- Immutable provenance (0022, preserved). source_course_id may only move to
  -- NULL — that is the ON DELETE SET NULL path when the fork is purged, which
  -- must keep working — never to a DIFFERENT course, which would re-point the
  -- review window after submission.
  NEW.proposed_by      := OLD.proposed_by;
  NEW.target_course_id := OLD.target_course_id;
  NEW.workspace_id     := OLD.workspace_id;
  IF NEW.source_course_id IS NOT NULL
     AND NEW.source_course_id IS DISTINCT FROM OLD.source_course_id THEN
    NEW.source_course_id := OLD.source_course_id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_otter_cr_review() FROM PUBLIC, anon, authenticated;

-- 0022 created the trigger; CREATE OR REPLACE FUNCTION re-points it in place.
-- Recreate defensively anyway so 0025 stands alone on a fresh database where
-- 0022 has already run (it has, everywhere) — a no-op there.
DROP TRIGGER IF EXISTS trg_otter_cr_review ON public.otter_change_requests;
CREATE TRIGGER trg_otter_cr_review
  BEFORE UPDATE ON public.otter_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_otter_cr_review();

-- ── 5. otter_cr_apply() — the only path to 'approved' ────────────────────────

CREATE OR REPLACE FUNCTION public.otter_cr_apply(p_cr_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_ws         UUID := public.current_workspace_id();
  v_role       TEXT;
  v_cr         public.otter_change_requests%ROWTYPE;
  v_tgt        public.otter_courses%ROWTYPE;
  v_src        public.otter_courses%ROWTYPE;
  v_archive_id UUID;
  v_s          public.otter_subjects%ROWTYPE;
BEGIN
  -- Live-row membership and role (0024 convention).
  SELECT wm.app_role INTO v_role
    FROM public.workspace_members wm
   WHERE wm.workspace_id = v_ws
     AND wm.user_id = v_uid
     AND wm.is_active;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'not_a_workspace_member';
  END IF;

  -- Lock the request row: two admins approving concurrently must serialize,
  -- and the loser must see a settled request, not double-apply.
  SELECT * INTO v_cr
    FROM public.otter_change_requests
   WHERE id = p_cr_id
     FOR UPDATE;

  IF v_cr.id IS NULL OR v_cr.workspace_id IS DISTINCT FROM v_ws THEN
    RAISE EXCEPTION 'change request not found in this workspace';
  END IF;
  IF v_cr.status <> 'open' THEN
    RAISE EXCEPTION 'change request is % — only an open request can be approved and applied', v_cr.status;
  END IF;

  SELECT * INTO v_tgt
    FROM public.otter_courses c
   WHERE c.id = v_cr.target_course_id
     AND c.deleted_at IS NULL;
  IF v_tgt.id IS NULL THEN
    RAISE EXCEPTION 'the standard course this request targets no longer exists';
  END IF;
  IF v_tgt.workspace_id IS DISTINCT FROM v_ws THEN
    RAISE EXCEPTION 'the target course is not in this workspace';
  END IF;
  IF NOT COALESCE(v_role = 'admin' OR v_tgt.owner_id = v_uid, false) THEN
    RAISE EXCEPTION 'only an admin or the standard course''s owner may approve';
  END IF;
  IF v_tgt.visibility <> 'company_standard' THEN
    RAISE EXCEPTION 'the target is no longer the company standard — approve would edit a private course';
  END IF;

  SELECT * INTO v_src
    FROM public.otter_courses c
   WHERE c.id = v_cr.source_course_id
     AND c.deleted_at IS NULL;
  IF v_src.id IS NULL THEN
    RAISE EXCEPTION 'the proposer''s course no longer exists — there is nothing to apply';
  END IF;
  IF v_src.workspace_id IS DISTINCT FROM v_ws THEN
    RAISE EXCEPTION 'the proposer''s course is not in this workspace';
  END IF;
  -- Belt-and-braces consent re-check (also enforced at INSERT and in
  -- otter_has_open_review_access): only the proposer's own work gets applied.
  IF v_src.owner_id IS DISTINCT FROM v_cr.proposed_by THEN
    RAISE EXCEPTION 'the source course is not owned by the proposer';
  END IF;

  -- 1. Archive: a personal snapshot of the target, owned by the approver.
  --    otter_fork_course is reused whole — it already copies the course row
  --    and every live subject, re-asserts readability (the caller can read a
  --    company_standard course by definition), forces the copy personal, and
  --    handles slug collisions in the approver's namespace. left() keeps the
  --    label inside otter_courses_name_chk (200) whatever the target's name.
  v_archive_id := public.otter_fork_course(
    v_tgt.id,
    left(v_tgt.name, 170) || ' (before change #' || v_cr.revision || ')');

  -- The fork deliberately blanks `corrections` (agent memory, not content).
  -- An archive is a faithful snapshot, so copy it back.
  UPDATE public.otter_courses
     SET corrections = v_tgt.corrections
   WHERE id = v_archive_id;

  -- 2. Additive apply, matched by slug. UPDATE the subjects the proposer
  --    changed, INSERT the ones the standard lacks, and NEVER delete — a
  --    subject the proposer removed from their fork survives in the standard.
  --    Note there is no ON CONFLICT here on purpose: the subject uniqueness
  --    index is partial (WHERE deleted_at IS NULL), which ON CONFLICT cannot
  --    target (the 42P10 trap), so this is an explicit match-then-write loop.
  FOR v_s IN
    SELECT * FROM public.otter_subjects s
     WHERE s.course_id = v_src.id
       AND s.deleted_at IS NULL
     ORDER BY s.subject_order, s.slug
  LOOP
    UPDATE public.otter_subjects t
       SET title            = v_s.title,
           description      = v_s.description,
           skill_level      = v_s.skill_level,
           is_stub          = v_s.is_stub,
           subject_order    = v_s.subject_order,
           estimated_hours  = v_s.estimated_hours,
           sections         = v_s.sections,
           section_outlines = v_s.section_outlines,
           sources          = v_s.sources,
           prerequisites    = v_s.prerequisites
     WHERE t.course_id = v_tgt.id
       AND t.slug = v_s.slug
       AND t.deleted_at IS NULL;

    IF NOT FOUND THEN
      -- owner_id is denormalised from the COURSE (0022), so a new subject in
      -- the standard belongs to the standard's owner — never the proposer,
      -- never the approver. created_by/updated_by record who actually wrote.
      INSERT INTO public.otter_subjects (
        workspace_id, course_id, owner_id, slug, title, description,
        skill_level, is_stub, subject_order, estimated_hours,
        sections, section_outlines, sources, prerequisites,
        created_by, updated_by
      ) VALUES (
        v_ws, v_tgt.id, v_tgt.owner_id, v_s.slug, v_s.title, v_s.description,
        v_s.skill_level, v_s.is_stub, v_s.subject_order, v_s.estimated_hours,
        v_s.sections, v_s.section_outlines, v_s.sources, v_s.prerequisites,
        v_uid, v_uid
      );
    END IF;
  END LOOP;

  -- 3. Settle the request. The transaction-local GUC is what lets the trigger
  --    accept open → approved and the applied_* stamps; it is cleared straight
  --    after so nothing else in this transaction can ride it.
  PERFORM set_config('wilson.otter_cr_apply', v_cr.id::text, true);
  UPDATE public.otter_change_requests
     SET status            = 'approved',
         applied_at        = now(),
         applied_by        = v_uid,
         archive_course_id = v_archive_id
   WHERE id = v_cr.id;
  PERFORM set_config('wilson.otter_cr_apply', '', true);

  RETURN v_archive_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_cr_apply(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_cr_apply(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.otter_cr_apply IS
  'Session 13: approves an open change request by APPLYING it (locked #22). Archives the target to a personal copy owned by the approver, then copies the proposer''s live subjects into the target additively (update by slug, insert when absent, never delete; subjects only — reference documents are untouched). Returns the archive course id. The only path to status=approved.';

-- ── 6. otter_course_index: the window shows up in the index too ──────────────
-- Same declared signature (pgTAP 26 pins it); two boolean expressions gain the
-- review-window arm so (a) a non-admin standard-course owner LISTS the
-- proposer's course at all, and (b) can_read_content tells the client the row
-- is actually fetchable — which is what the Admin Terminal's "open their
-- course" affordance keys on.

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
          OR public.otter_has_open_review_access(c.id)) AS can_read_content,
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
     )
   ORDER BY c.updated_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_course_index() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_course_index() TO authenticated, service_role;

-- ── 7. Post-conditions ───────────────────────────────────────────────────────

DO $$
DECLARE
  t TEXT;
BEGIN
  -- The status machine actually widened.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.otter_change_requests'::regclass
       AND conname = 'otter_cr_status_chk'
       AND pg_get_constraintdef(oid) LIKE '%changes_requested%'
  ) THEN
    RAISE EXCEPTION '0025 post-condition failed: status CHECK does not include changes_requested';
  END IF;

  -- 0022's central rule survives this migration: no app-role bypass in any
  -- personal-content SELECT policy. The review window rides the helper.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('otter_courses', 'otter_progress')
       AND cmd = 'SELECT'
       AND qual LIKE '%current_app_role%'
  ) THEN
    RAISE EXCEPTION '0025 post-condition failed: admin bypass leaked into a personal-content SELECT policy';
  END IF;

  -- Review history is still retained.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'otter_change_requests' AND cmd = 'DELETE'
  ) THEN
    RAISE EXCEPTION '0025 post-condition failed: otter_change_requests must retain review history';
  END IF;

  FOREACH t IN ARRAY ARRAY['otter_cr_apply(uuid)', 'otter_has_open_review_access(uuid)',
                           'otter_course_index()', 'otter_fork_course(uuid,text)']
  LOOP
    IF to_regprocedure('public.' || t) IS NULL THEN
      RAISE EXCEPTION '0025 post-condition failed: function % missing', t;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'trg_otter_cr_review' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '0025 post-condition failed: trg_otter_cr_review missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'otter_cr_source_status_idx'
  ) THEN
    RAISE EXCEPTION '0025 post-condition failed: source-status index missing';
  END IF;
END $$;
