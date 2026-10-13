-- =============================================================================
-- 0065_otter_subject_shares.sql — 2026-08-12
--
-- SHARE ONE SUBJECT WITH ONE PERSON, AS A LIVE LINK THEY ACCEPT FIRST.
--
-- Audrey, 2026-08-12, on what sharing a subject should do:
--   "so if the receiver doesnt have the course in their library of the subject.
--    you would add the new course and then place the subject in there. if the
--    user already has that software/ language course, you add the new subject
--    shared to that course."
-- and, asked whether it is a copy or a link, and whether it should arrive
-- unannounced:
--   LIVE LINK. ACCEPT FIRST.
-- and on progress:
--   "each user should have their own progression of subjects. dont make it a
--    universal one"
--
-- So: I share a subject with you. It waits until you accept. On accept it
-- appears inside YOUR copy of that course — created for you if you do not have
-- one — and you read MY subject live. My edits reach you; you cannot edit it;
-- it disappears if I delete it or revoke the share.
--
-- ── WHY THIS IS NOT A VISIBILITY TIER ────────────────────────────────────────
-- otter_subjects has NO visibility column and never has. Its SELECT policy is
-- pure inheritance — a subject is readable exactly when its parent course is
-- (0022, deliberately: "Visibility is INHERITED, not duplicated"). Giving
-- subjects their own tier would duplicate the thing 0022 refused to duplicate.
-- A share is therefore a ROW ABOUT TWO PEOPLE, not a property of the subject,
-- and the read it grants rides a consent helper exactly as 0025's review window
-- and 0064's nomination window do.
--
-- ── 🚨 THE PROGRESS COLLISION — READ BEFORE TOUCHING THE CLIENT ──────────────
-- otter_progress is one row per (course_id, user_id) and its completed_lessons
-- JSONB is keyed BY SUBJECT SLUG:
--     { '<subject-slug>': { completed_lessons: [...], last_accessed } }
-- A linked subject is displayed inside the recipient's course but belongs to
-- the sharer's. If I link you my "intro" and your course already has an
-- "intro", THE TWO COLLIDE ON ONE KEY and ticking a lesson in mine marks it
-- complete in yours.
--
-- The client MUST therefore key a linked subject's progress as
--     'link:<subject_id>'
-- rather than by slug. That is additive — every existing key keeps working, and
-- progress.get already tolerates unknown shapes. There is no schema change for
-- it, which is precisely why it is written down here: nothing in the database
-- can enforce it, so this comment is the only guard.
--
-- Audrey's rule falls out for free: progress stays keyed to (host course, user),
-- so YOUR completion of a linked subject is yours, mine is mine, and yours
-- SURVIVES me revoking the link — the row is on your course, not mine.
--
-- ── WHAT ACCEPTING DOES ──────────────────────────────────────────────────────
-- otter_subject_share_accept() is SECURITY DEFINER because the recipient must
-- read the SOURCE course's name/slug/type to build their own copy, and that
-- course may be personal to the sharer — otter_courses_select would hide it.
-- Definer buys that read; it does not bypass triggers, and this function only
-- INSERTs a course (the pin trigger is BEFORE UPDATE), so there is no
-- silent-revert hazard here of the kind 0064 had to work around.
--
-- The host course is matched on (workspace_id, owner_id = recipient, slug),
-- because slug is what "the same software/language course" means structurally —
-- it is frozen at creation and forks inherit it verbatim. Matching on NAME
-- would attach to a course the recipient renamed, or miss one they renamed.
--
-- ⚠️ WHAT THIS DELIBERATELY DOES NOT DO
--   * No subject `visibility` column. See above.
--   * You may only share a subject in a course YOU OWN. Consent is not
--     transferable — the same rule 0025 and 0064 enforce for their windows.
--   * Sharing does NOT expose the rest of the source course. The helper grants
--     read on ONE subject id, not on its parent.
--   * The recipient can never edit a linked subject. otter_subjects_update is
--     untouched, so writes still require otter_can_write_course on the SOURCE.
--   * No company-wide subject share. Audrey described a receiver, singular.
--   * No DELETE policy — a declined or revoked share is a record.
--   * It does NOT alter otter_progress. The namespacing above is a CLIENT
--     obligation, deliberately, because the collision is a display concern.
--
-- 🚨 ORDERING RULE: this file redefines otter_subjects_select, which 0022
-- creates. A manual re-run of 0022 must be followed by this file, or subject
-- links silently stop being readable while every post-condition still passes.
--
-- pgTAP: supabase/tests/rls/71_otter_subject_shares.sql (new suite).
-- Idempotent: IF NOT EXISTS / DROP+CREATE throughout. Safe to re-run.
-- =============================================================================

-- ── 1. The table ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.otter_subject_shares (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Defaults matter: the client sends { subject_id, shared_with } and nothing
  -- else, so a sharer cannot file as someone else or into another workspace.
  -- (0064 shipped a first draft WITHOUT these and 34 green probes missed it,
  -- because the suite supplied the columns the client never sends.)
  workspace_id   UUID NOT NULL DEFAULT public.current_workspace_id()
                 REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- The LIVE source. CASCADE is the feature, not a convenience: "it disappears
  -- if I delete it" is what a live link means.
  subject_id     UUID NOT NULL REFERENCES public.otter_subjects(id) ON DELETE CASCADE,
  shared_by      UUID NOT NULL DEFAULT auth.uid(),
  shared_with    UUID NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  message        TEXT,
  -- The RECIPIENT'S course the subject is displayed inside. NULL until accepted.
  -- FK-less on purpose, matching otter_change_requests.archive_course_id: it is
  -- a historical pointer that must outlive the course being trashed.
  host_course_id UUID,
  responded_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID
);

ALTER TABLE public.otter_subject_shares
  ALTER COLUMN workspace_id SET DEFAULT public.current_workspace_id();
ALTER TABLE public.otter_subject_shares
  ALTER COLUMN shared_by    SET DEFAULT auth.uid();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_subject_shares'::regclass
                    AND conname = 'otter_subject_share_status_chk') THEN
    ALTER TABLE public.otter_subject_shares ADD CONSTRAINT otter_subject_share_status_chk
      CHECK (status IN ('pending', 'accepted', 'declined', 'revoked'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_subject_shares'::regclass
                    AND conname = 'otter_subject_share_not_self_chk') THEN
    ALTER TABLE public.otter_subject_shares ADD CONSTRAINT otter_subject_share_not_self_chk
      CHECK (shared_with <> shared_by);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_subject_shares'::regclass
                    AND conname = 'otter_subject_share_message_chk') THEN
    ALTER TABLE public.otter_subject_shares ADD CONSTRAINT otter_subject_share_message_chk
      CHECK (message IS NULL OR char_length(message) <= 2000);
  END IF;

  -- Only an accepted share has a host course, and an accepted one must.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.otter_subject_shares'::regclass
                    AND conname = 'otter_subject_share_host_chk') THEN
    ALTER TABLE public.otter_subject_shares ADD CONSTRAINT otter_subject_share_host_chk
      CHECK ((status = 'accepted') = (host_course_id IS NOT NULL));
  END IF;
END $$;

-- One LIVE share of a given subject to a given person. Re-sharing after a
-- decline or a revoke is allowed; queueing five copies is not.
CREATE UNIQUE INDEX IF NOT EXISTS otter_subject_share_live_uidx
  ON public.otter_subject_shares (subject_id, shared_with)
  WHERE status IN ('pending', 'accepted');

CREATE INDEX IF NOT EXISTS otter_subject_share_recipient_idx
  ON public.otter_subject_shares (shared_with, status);
CREATE INDEX IF NOT EXISTS otter_subject_share_sender_idx
  ON public.otter_subject_shares (shared_by, status);
CREATE INDEX IF NOT EXISTS otter_subject_share_host_idx
  ON public.otter_subject_shares (host_course_id) WHERE host_course_id IS NOT NULL;

ALTER TABLE public.otter_subject_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otter_subject_shares FORCE  ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_otter_subject_share_audit ON public.otter_subject_shares;
CREATE TRIGGER trg_otter_subject_share_audit
  BEFORE INSERT OR UPDATE ON public.otter_subject_shares
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_touch();

REVOKE ALL    ON public.otter_subject_shares FROM PUBLIC, anon;
GRANT  SELECT, INSERT, UPDATE ON public.otter_subject_shares TO authenticated;
GRANT  ALL    ON public.otter_subject_shares TO service_role;

COMMENT ON TABLE public.otter_subject_shares IS
  '0065: a live link of ONE subject to ONE person, accepted before it appears. The recipient reads the sharer''s subject inside their own host course; they never own or edit it, and it vanishes when the source is deleted or the share revoked.';
COMMENT ON COLUMN public.otter_subject_shares.host_course_id IS
  '0065: the RECIPIENT''S course the linked subject is displayed inside, found or created on accept. FK-less on purpose.';

-- ── 2. The consent helper ────────────────────────────────────────────────────
-- True when the caller may read p_subject_id BECAUSE it was shared with them and
-- they accepted. plpgsql SECURITY DEFINER, not sql: it must not inline into the
-- calling policy's qual (0022/0025/0026 all fail the build if current_app_role
-- appears in a personal-content SELECT policy, and an inlinable helper can
-- expand into it). This one reads no role at all — a share names one person.

CREATE OR REPLACE FUNCTION public.otter_has_accepted_subject_share(p_subject_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_ws  UUID := public.current_workspace_id();
BEGIN
  IF v_uid IS NULL OR v_ws IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM public.otter_subject_shares s
      JOIN public.otter_subjects sub ON sub.id = s.subject_id
      JOIN public.otter_courses  src ON src.id = sub.course_id
     WHERE s.subject_id = p_subject_id
       AND s.workspace_id = v_ws
       AND s.shared_with = v_uid
       AND s.status = 'accepted'
       AND sub.deleted_at IS NULL
       AND src.deleted_at IS NULL
       -- Consent re-check: only the sharer's OWN course opens, and only the
       -- subject named. Also enforced at INSERT.
       AND src.owner_id = s.shared_by
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_has_accepted_subject_share(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_has_accepted_subject_share(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.otter_has_accepted_subject_share IS
  '0065: consented read on ONE linked subject. True when p_subject_id was shared with the caller by the owner of its course and the caller accepted. Grants nothing on the parent course.';

-- ── 3. The read reaches the subject, and only the subject ────────────────────
-- 0022 verbatim plus the link arm. The inheritance rule is untouched: a subject
-- of a course you can read is still readable through the EXISTS. The new arm
-- adds exactly one more way in, for one row at a time.

DROP POLICY IF EXISTS otter_subjects_select ON public.otter_subjects;
CREATE POLICY otter_subjects_select ON public.otter_subjects
  FOR SELECT USING (
    deleted_at IS NULL
    AND workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (
      EXISTS (
        SELECT 1 FROM public.otter_courses c WHERE c.id = otter_subjects.course_id
      )
      OR public.otter_has_accepted_subject_share(id)
    )
  );

-- ── 4. Policies on the share row ─────────────────────────────────────────────

-- Both sides of a share can see it. Nobody else can — a share is between two
-- people, and unlike a nomination it is not workspace business.
DROP POLICY IF EXISTS otter_subject_share_select ON public.otter_subject_shares;
CREATE POLICY otter_subject_share_select ON public.otter_subject_shares
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (shared_by = auth.uid() OR shared_with = auth.uid())
  );

-- You may only share a subject in a course you OWN, to an ACTIVE colleague.
DROP POLICY IF EXISTS otter_subject_share_insert ON public.otter_subject_shares;
CREATE POLICY otter_subject_share_insert ON public.otter_subject_shares
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND shared_by = auth.uid()
    AND status = 'pending'
    AND host_course_id IS NULL
    AND responded_at IS NULL
    -- The subject must be one the caller can read in their OWN workspace, and
    -- its course must be theirs. The EXISTS runs under the caller's own RLS.
    AND EXISTS (
      SELECT 1 FROM public.otter_subjects sub
       WHERE sub.id = otter_subject_shares.subject_id
         AND public.otter_is_course_owner(sub.course_id)
    )
    -- The recipient must be a live member. A share to a deactivated account
    -- would sit pending forever in a queue nobody reads.
    AND EXISTS (
      SELECT 1 FROM public.workspace_members wm
       WHERE wm.workspace_id = otter_subject_shares.workspace_id
         AND wm.user_id = otter_subject_shares.shared_with
         AND wm.is_active
    )
  );

-- USING admits both parties; WITH CHECK is the real gate on who may do what.
-- fn_otter_subject_share_respond owns WHICH transition each side may make.
DROP POLICY IF EXISTS otter_subject_share_update ON public.otter_subject_shares;
CREATE POLICY otter_subject_share_update ON public.otter_subject_shares
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (shared_by = auth.uid() OR shared_with = auth.uid())
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (shared_by = auth.uid() OR shared_with = auth.uid())
  );

-- ── 5. The transition table ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_otter_subject_share_respond()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_recipient BOOLEAN := COALESCE(v_uid = OLD.shared_with, false);
  v_sender    BOOLEAN := COALESCE(v_uid = OLD.shared_by,   false);
  v_via_accept BOOLEAN := COALESCE(
    current_setting('wilson.otter_subject_share_accept', true) = OLD.id::text, false);
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status IN ('accepted', 'declined', 'revoked') AND NEW.status <> 'revoked' THEN
      RAISE EXCEPTION 'this share is already % — it cannot be reopened', OLD.status;
    END IF;

    IF NEW.status = 'accepted' THEN
      -- Accepting places the subject in a course. A bare status flip would
      -- record an acceptance with nowhere for the subject to appear, and the
      -- host_course_id CHECK would fail confusingly rather than helpfully.
      IF NOT v_via_accept THEN
        RAISE EXCEPTION 'accepting places the subject in your library — call otter_subject_share_accept() instead of setting the status';
      END IF;
      NEW.responded_at := now();

    ELSIF NEW.status = 'declined' THEN
      IF NOT v_recipient THEN
        RAISE EXCEPTION 'only the person it was shared with may decline it';
      END IF;
      NEW.responded_at := now();

    ELSIF NEW.status = 'revoked' THEN
      -- Either side may end it: the sharer takes it back, the recipient drops
      -- it. Both are the same terminal state — the link stops resolving.
      IF NOT (v_sender OR v_recipient) THEN
        RAISE EXCEPTION 'only the sharer or the recipient may end this share';
      END IF;
      NEW.responded_at := now();
      -- Keep the host pointer for history, but the CHECK ties it to 'accepted'.
      NEW.host_course_id := NULL;

    ELSE
      RAISE EXCEPTION 'a subject share cannot move from % to %', OLD.status, NEW.status;
    END IF;
  END IF;

  -- The host pointer belongs to the accept RPC alone.
  IF NOT v_via_accept AND NEW.status <> 'revoked' THEN
    NEW.host_course_id := OLD.host_course_id;
  END IF;

  -- Immutable provenance: re-pointing any of these after the fact would move a
  -- consented read onto a different subject or a different person.
  NEW.subject_id   := OLD.subject_id;
  NEW.shared_by    := OLD.shared_by;
  NEW.shared_with  := OLD.shared_with;
  NEW.workspace_id := OLD.workspace_id;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_otter_subject_share_respond() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_otter_subject_share_respond ON public.otter_subject_shares;
CREATE TRIGGER trg_otter_subject_share_respond
  BEFORE UPDATE ON public.otter_subject_shares
  FOR EACH ROW EXECUTE FUNCTION public.fn_otter_subject_share_respond();

-- ── 6. otter_subject_share_accept() — the only path to 'accepted' ────────────

CREATE OR REPLACE FUNCTION public.otter_subject_share_accept(p_share_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_ws     UUID := public.current_workspace_id();
  v_share  public.otter_subject_shares%ROWTYPE;
  v_sub    public.otter_subjects%ROWTYPE;
  v_src    public.otter_courses%ROWTYPE;
  v_host   UUID;
BEGIN
  IF v_uid IS NULL OR v_ws IS NULL THEN
    RAISE EXCEPTION 'not_a_workspace_member';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members wm
                  WHERE wm.workspace_id = v_ws AND wm.user_id = v_uid AND wm.is_active) THEN
    RAISE EXCEPTION 'not_a_workspace_member';
  END IF;

  SELECT * INTO v_share FROM public.otter_subject_shares
   WHERE id = p_share_id FOR UPDATE;

  IF v_share.id IS NULL OR v_share.workspace_id IS DISTINCT FROM v_ws THEN
    RAISE EXCEPTION 'share not found in this workspace';
  END IF;
  IF v_share.shared_with IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'only the person it was shared with may accept it';
  END IF;
  IF v_share.status <> 'pending' THEN
    RAISE EXCEPTION 'this share is % — only a pending share can be accepted', v_share.status;
  END IF;

  SELECT * INTO v_sub FROM public.otter_subjects
   WHERE id = v_share.subject_id AND deleted_at IS NULL;
  IF v_sub.id IS NULL THEN
    RAISE EXCEPTION 'that subject no longer exists';
  END IF;

  SELECT * INTO v_src FROM public.otter_courses
   WHERE id = v_sub.course_id AND deleted_at IS NULL;
  IF v_src.id IS NULL THEN
    RAISE EXCEPTION 'the course that subject belongs to no longer exists';
  END IF;
  IF v_src.owner_id IS DISTINCT FROM v_share.shared_by THEN
    RAISE EXCEPTION 'that subject is no longer owned by the person who shared it';
  END IF;

  -- "if the user already has that software/language course, you add the new
  --  subject shared to that course" — matched on SLUG, which is what "the same
  --  course" means structurally: frozen at creation, inherited by forks, and
  --  unaffected by either person renaming their copy.
  SELECT c.id INTO v_host
    FROM public.otter_courses c
   WHERE c.workspace_id = v_ws
     AND c.owner_id = v_uid
     AND c.slug = v_src.slug
     AND c.deleted_at IS NULL
   LIMIT 1;

  -- "if the receiver doesnt have the course ... you would add the new course
  --  and then place the subject in there."
  IF v_host IS NULL THEN
    INSERT INTO public.otter_courses
      (workspace_id, owner_id, slug, name, course_type, skill_level, visibility)
    VALUES
      (v_ws, v_uid, v_src.slug, v_src.name, v_src.course_type, v_src.skill_level, 'personal')
    RETURNING id INTO v_host;
  END IF;

  PERFORM set_config('wilson.otter_subject_share_accept', v_share.id::text, true);
  UPDATE public.otter_subject_shares
     SET status = 'accepted', host_course_id = v_host
   WHERE id = v_share.id;
  PERFORM set_config('wilson.otter_subject_share_accept', '', true);

  RETURN v_host;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_subject_share_accept(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_subject_share_accept(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.otter_subject_share_accept IS
  '0065: accepts a pending subject share. Finds the recipient''s course with the same slug, or creates a personal one for them, then links the subject into it. Returns the host course id. The only path to status=accepted.';

-- ── 7. Post-conditions ───────────────────────────────────────────────────────

DO $$
DECLARE
  t TEXT;
  n INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class
                  WHERE oid = 'public.otter_subject_shares'::regclass
                    AND relrowsecurity AND relforcerowsecurity) THEN
    RAISE EXCEPTION '0065 post-condition failed: RLS must be enabled AND forced on otter_subject_shares';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'otter_subject_shares';
  IF n <> 3 THEN
    RAISE EXCEPTION '0065 post-condition failed: expected 3 policies, found %', n;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname='public' AND tablename='otter_subject_shares' AND cmd='DELETE') THEN
    RAISE EXCEPTION '0065 post-condition failed: share history must be retained';
  END IF;

  IF has_table_privilege('anon', 'public.otter_subject_shares', 'SELECT')
     OR has_table_privilege('anon', 'public.otter_subject_shares', 'INSERT')
     OR has_table_privilege('anon', 'public.otter_subject_shares', 'UPDATE')
     OR has_table_privilege('anon', 'public.otter_subject_shares', 'DELETE') THEN
    RAISE EXCEPTION '0065 post-condition failed: anon holds a privilege on otter_subject_shares';
  END IF;

  -- The client sends only { subject_id, shared_with }.
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema='public' AND table_name='otter_subject_shares'
         AND column_name='workspace_id') IS DISTINCT FROM 'current_workspace_id()' THEN
    RAISE EXCEPTION '0065 post-condition failed: workspace_id must default to current_workspace_id()';
  END IF;
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema='public' AND table_name='otter_subject_shares'
         AND column_name='shared_by') IS DISTINCT FROM 'auth.uid()' THEN
    RAISE EXCEPTION '0065 post-condition failed: shared_by must default to auth.uid()';
  END IF;

  -- 🚨 The link arm landed AND 0022's inheritance rule survived it.
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='otter_subjects' AND cmd='SELECT'
                    AND qual LIKE '%otter_has_accepted_subject_share%') THEN
    RAISE EXCEPTION '0065 post-condition failed: the subject-link arm is missing from otter_subjects_select';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='otter_subjects' AND cmd='SELECT'
                    AND qual LIKE '%otter_courses%') THEN
    RAISE EXCEPTION '0065 post-condition failed: 0022 course inheritance was dropped from otter_subjects_select';
  END IF;

  -- The admin-bypass rule 0022/0025/0026/0064 all defend.
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname='public' AND tablename IN ('otter_courses','otter_progress')
                AND cmd='SELECT' AND qual LIKE '%current_app_role%') THEN
    RAISE EXCEPTION '0065 post-condition failed: admin bypass leaked into a personal-content SELECT policy';
  END IF;

  -- A linked subject must stay READ-only: the update policy is untouched.
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname='public' AND tablename='otter_subjects' AND cmd='UPDATE'
                AND with_check LIKE '%otter_has_accepted_subject_share%') THEN
    RAISE EXCEPTION '0065 post-condition failed: the link arm leaked into otter_subjects_update — a recipient must never edit a linked subject';
  END IF;

  FOREACH t IN ARRAY ARRAY['otter_subject_share_accept(uuid)',
                           'otter_has_accepted_subject_share(uuid)',
                           'fn_otter_subject_share_respond()']
  LOOP
    IF to_regprocedure('public.' || t) IS NULL THEN
      RAISE EXCEPTION '0065 post-condition failed: function % missing', t;
    END IF;
  END LOOP;

  FOREACH t IN ARRAY ARRAY['trg_otter_subject_share_audit', 'trg_otter_subject_share_respond']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.otter_subject_shares'::regclass
                      AND tgname = t AND NOT tgisinternal) THEN
      RAISE EXCEPTION '0065 post-condition failed: trigger % missing', t;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
