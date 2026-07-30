-- =============================================================================
-- 0022_otter_content.sql — Session 10 (O.T.T.E.R. cloud content model)
--
-- Moves O.T.T.E.R. off local-disk JSON (otter-data/) onto workspace-tenanted
-- cloud tables. Prerequisite for the S11 web build: a browser has no in-app
-- Express server, so `fetch('/api/software/...')` has no local backend there.
--
-- THREE VISIBILITY TIERS (Audrey, 2026-07-28 — locked #17 refined):
--
--   'personal'          Owner-only content. NO admin content bypass (notes
--                       precedent, 0017). Admins can see that the course
--                       EXISTS — title/owner/subject count — via
--                       otter_course_index(), but never its lesson bodies.
--   'shared'            Readable by every active workspace member. Writable by
--                       the owner, workspace admins, and specific members the
--                       owner grants edit access (otter_course_editors).
--   'company_standard'  A 'shared' course an ADMIN has blessed as the company's
--                       canonical version of a topic. Offered in place of
--                       generating a new one. Only admins may set or clear this
--                       tier (enforced in otter_courses_update WITH CHECK).
--
-- NEVER cross-company: every row carries workspace_id and every policy starts
-- from `workspace_id = public.current_workspace_id()` (locked #17 — no global
-- wiki). Deactivated members are locked out of BOTH reads and writes, per the
-- Session 9 alignment (0020) — this is the new baseline, so unlike 0017's notes
-- the SELECT policies here DO require has_active_membership.
--
--   1. otter_courses         — the "software"/course (was software/<slug>/_meta.json
--                              plus the five sibling reference documents, which
--                              become JSONB columns: they are singleton
--                              whole-document blobs that the app merges in place,
--                              never queries piecewise).
--   2. otter_subjects        — one row per subject (was subjects/<slug>.json).
--                              Queryable metadata is columnar; the nested
--                              sections[]→lessons[] content stays JSONB (it is
--                              always loaded and saved whole).
--   3. otter_progress        — PER-USER study state. On disk this lived in the
--                              course directory (_progress.json) because OTTER
--                              was single-user; in the cloud it MUST re-key to
--                              (course, user) or two people studying one shared
--                              course would overwrite each other's completion.
--   4. otter_course_editors  — per-user edit grants on a course (project_members
--                              shape from 0013: composite FK to workspace_members
--                              so a grant dies with the membership).
--   5. otter_change_requests — a user who forked a company-standard course can
--                              propose their changes back with a written
--                              rationale; admins review.
--
--   6. Live-row helpers (otter_has_editor_grant / otter_is_course_owner /
--      otter_can_write_course) — SECURITY DEFINER so policies never recurse
--      (the 0008 lesson), and live-row so a revoked grant takes effect at once
--      (the 0020 has_rate_card_grant convention).
--   7. Soft delete + 30-day trash. 0014's soft_delete_row() could NOT be
--      reused: fn_trash_authz hardcodes the seven RABBIT tables and routes
--      authorization through the project-role helpers, which have no meaning
--      here. otter_soft_delete_row()/otter_restore_row() are the OTTER-shaped
--      equivalents and carry the same SELECT-policies-see-both-sides-of-an-
--      UPDATE reasoning that forced 0014 to use RPCs in the first place.
--   8. otter_fork_course() — "use the company standard course" forks a personal
--      copy so the official version stays pristine and admin edits never change
--      a course underneath someone mid-study.
--   9. otter_course_index() — the metadata-only admin view (see 'personal').
--
-- DELIBERATE EXCLUSIONS (documented in db/README.md §19):
--   * NO storage bucket. O.T.T.E.R. has zero binary content — no images, audio
--     or uploads anywhere in the tool (verified across Otter.jsx, Validator.jsx
--     and every /api/software route). A bucket would be dead surface.
--   * NOT broadcast on any realtime topic. The 0018 workspace channel delivers
--     full row payloads to every subscriber, so personal course bodies must
--     never ride it; and courses are not a live co-editing surface (edit rights
--     are owner/admin/grantee, not concurrent authoring). Revisit only with a
--     per-course topic in the 0016 `rabbit:project:{id}` style.
--   * NOT edit-history captured. 0012's entity CHECK stays locked to the 13
--     RABBIT tables — same precedent as project_members (0013) and notes (0017).
--   * Scraped page text from _references.json is NOT migrated (url + title
--     only). It is a regenerable cache of third-party page content; copying it
--     into a shared multi-tenant database is content risk for no benefit.
--
-- pgTAP: 26_otter_courses.sql, 27_otter_subjects.sql, 28_otter_progress.sql,
--        29_otter_course_editors.sql, 30_otter_change_requests.sql
-- Idempotent: safe to re-run — **BUT a manual re-run MUST be followed by
-- re-running 0025** (Session 13). This file recreates fn_otter_cr_review,
-- otter_courses_select, otter_cr_insert/otter_cr_update and
-- otter_course_index() at their Session 10 definitions; on a database where
-- 0025 has applied, running 0022 alone silently strips the change-request
-- state machine, the apply-only approval rule and the review-window read arm,
-- and BOTH files' post-conditions still pass in that state. The migration
-- runner applies by version and never re-runs, so this only bites a by-hand
-- replay.
-- =============================================================================

-- ── 1. otter_courses ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.otter_courses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL DEFAULT public.current_workspace_id()
                  REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- FK-less per the 0007 convention: a course must survive its author's
  -- auth.users row disappearing (the roster row carries the display label).
  owner_id        UUID NOT NULL DEFAULT auth.uid(),
  -- Slug is the local-disk identity (slugify(name)) and the natural key the
  -- migration tool dedupes on. Kept as data, NOT as the primary key: renaming
  -- a course must not orphan its subjects, progress or change requests.
  slug            TEXT NOT NULL,
  name            TEXT NOT NULL,
  course_type     TEXT NOT NULL DEFAULT 'software'
                  CHECK (course_type IN ('software', 'coding_language', 'node_software')),
  skill_level     TEXT NOT NULL DEFAULT 'beginner'
                  CHECK (skill_level IN ('beginner', 'intermediate', 'advanced')),
  visibility      TEXT NOT NULL DEFAULT 'personal'
                  CHECK (visibility IN ('personal', 'shared', 'company_standard')),
  -- Provenance for forks (otter_fork_course / "use the company standard").
  -- FK-less and ON DELETE-less on purpose: the fork outlives its source.
  source_course_id UUID,
  -- The five per-course reference documents. Each is one whole-document blob
  -- the app merges in place (hotkeys/functions/nodes have their own merge
  -- semantics in the client); none is ever queried piecewise.
  hotkeys         JSONB NOT NULL DEFAULT '{"categories": []}'::jsonb,
  functions       JSONB NOT NULL DEFAULT '{"categories": []}'::jsonb,
  nodes           JSONB NOT NULL DEFAULT '{"systems": []}'::jsonb,
  reference_urls  JSONB NOT NULL DEFAULT '{"urls": []}'::jsonb,
  corrections     JSONB NOT NULL DEFAULT '{"corrections": []}'::jsonb,
  deleted_at      TIMESTAMPTZ,
  deleted_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID,
  CONSTRAINT otter_courses_slug_chk  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
                                            AND char_length(slug) BETWEEN 1 AND 120),
  CONSTRAINT otter_courses_name_chk  CHECK (char_length(name) BETWEEN 1 AND 200),
  -- Bound the reference blobs. The largest real document on disk is ~48 KB;
  -- 2 MB leaves generous headroom while stopping a runaway merge loop from
  -- turning one row into a multi-hundred-megabyte payload.
  CONSTRAINT otter_courses_hotkeys_sz_chk CHECK (pg_column_size(hotkeys)        <= 2097152),
  CONSTRAINT otter_courses_funcs_sz_chk   CHECK (pg_column_size(functions)      <= 2097152),
  CONSTRAINT otter_courses_nodes_sz_chk   CHECK (pg_column_size(nodes)          <= 2097152),
  CONSTRAINT otter_courses_refs_sz_chk    CHECK (pg_column_size(reference_urls) <= 2097152),
  CONSTRAINT otter_courses_corr_sz_chk    CHECK (pg_column_size(corrections)    <= 2097152)
);

-- One live course per (owner, slug): the natural key the migration tool relies
-- on for its 23505 insertOrSkip idempotency (0002 runMigration convention).
-- Partial so a soft-deleted course never blocks recreating the same topic.
CREATE UNIQUE INDEX IF NOT EXISTS otter_courses_owner_slug_uidx
  ON public.otter_courses (workspace_id, owner_id, slug)
  WHERE deleted_at IS NULL;

-- At most ONE company-standard course per topic — two competing "official"
-- Blender Basics courses would defeat the whole point of the tier.
CREATE UNIQUE INDEX IF NOT EXISTS otter_courses_standard_slug_uidx
  ON public.otter_courses (workspace_id, slug)
  WHERE visibility = 'company_standard' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS otter_courses_ws_vis_idx
  ON public.otter_courses (workspace_id, visibility)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS otter_courses_ws_owner_idx
  ON public.otter_courses (workspace_id, owner_id)
  WHERE deleted_at IS NULL;
-- Supports the 30-day purge sweep.
CREATE INDEX IF NOT EXISTS otter_courses_trash_idx
  ON public.otter_courses (deleted_at)
  WHERE deleted_at IS NOT NULL;

DROP TRIGGER IF EXISTS trg_otter_courses_audit ON public.otter_courses;
CREATE TRIGGER trg_otter_courses_audit
  BEFORE INSERT OR UPDATE ON public.otter_courses
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_touch();

ALTER TABLE public.otter_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otter_courses FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE public.otter_courses IS
  'Session 10: O.T.T.E.R. courses (was otter-data/software/<slug>/). visibility = personal | shared | company_standard. Personal content has no admin bypass — admins get metadata only via otter_course_index(). Soft-deleted via otter_soft_delete_row().';

-- ── 2. otter_subjects ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.otter_subjects (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL DEFAULT public.current_workspace_id()
                   REFERENCES public.workspaces(id) ON DELETE CASCADE,
  course_id        UUID NOT NULL REFERENCES public.otter_courses(id) ON DELETE CASCADE,
  -- Denormalised from the course so migration/backfill and the trash purge can
  -- reason about a subject without a join. Kept in step by fn_otter_subject_sync.
  owner_id         UUID NOT NULL DEFAULT auth.uid(),
  slug             TEXT NOT NULL,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  skill_level      TEXT NOT NULL DEFAULT 'beginner'
                   CHECK (skill_level IN ('beginner', 'intermediate', 'advanced')),
  is_stub          BOOLEAN NOT NULL DEFAULT false,
  -- A REAL persisted field. On disk this was recomputed (and every subject file
  -- rewritten) on EVERY list read by renumberSubjects()'s regex heuristic —
  -- which as a cloud read would mean N UPDATEs per page load. The heuristic
  -- moves client-side and runs only on explicit reorder/renumber.
  subject_order    INTEGER NOT NULL DEFAULT 0,
  estimated_hours  NUMERIC(6,2),
  -- Nested generated content. Always loaded and saved whole; never queried
  -- piecewise. sections[] -> lessons[] -> key_takeaways[] is 3 levels deep.
  sections         JSONB NOT NULL DEFAULT '[]'::jsonb,
  section_outlines JSONB NOT NULL DEFAULT '[]'::jsonb,
  sources          JSONB NOT NULL DEFAULT '[]'::jsonb,
  prerequisites    JSONB NOT NULL DEFAULT '[]'::jsonb,
  deleted_at       TIMESTAMPTZ,
  deleted_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       UUID,
  CONSTRAINT otter_subjects_slug_chk  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
                                             AND char_length(slug) BETWEEN 1 AND 120),
  CONSTRAINT otter_subjects_title_chk CHECK (char_length(title) BETWEEN 1 AND 300),
  CONSTRAINT otter_subjects_desc_chk  CHECK (char_length(description) <= 4000),
  CONSTRAINT otter_subjects_order_chk CHECK (subject_order >= 0),
  -- Largest real subject on disk is 48 KB; 4 MB is a runaway guard, not a limit.
  CONSTRAINT otter_subjects_sections_sz_chk CHECK (pg_column_size(sections) <= 4194304)
);

CREATE UNIQUE INDEX IF NOT EXISTS otter_subjects_course_slug_uidx
  ON public.otter_subjects (course_id, slug)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS otter_subjects_course_order_idx
  ON public.otter_subjects (course_id, subject_order)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS otter_subjects_ws_idx
  ON public.otter_subjects (workspace_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS otter_subjects_trash_idx
  ON public.otter_subjects (deleted_at)
  WHERE deleted_at IS NOT NULL;

DROP TRIGGER IF EXISTS trg_otter_subjects_audit ON public.otter_subjects;
CREATE TRIGGER trg_otter_subjects_audit
  BEFORE INSERT OR UPDATE ON public.otter_subjects
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_touch();

ALTER TABLE public.otter_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otter_subjects FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE public.otter_subjects IS
  'Session 10: O.T.T.E.R. subjects (was otter-data/software/<slug>/subjects/<slug>.json). Metadata is columnar; sections[]->lessons[] content stays JSONB. Visibility is inherited from the parent course through a live-parent EXISTS in the SELECT policy (0014 pattern).';

-- ── 3. otter_progress ────────────────────────────────────────────────────────
-- PER-USER study state. The on-disk _progress.json sat in the course directory
-- because OTTER was single-user; keying it to the course alone in a shared
-- workspace would let two people studying one course clobber each other.

CREATE TABLE IF NOT EXISTS public.otter_progress (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL DEFAULT public.current_workspace_id()
                    REFERENCES public.workspaces(id) ON DELETE CASCADE,
  course_id         UUID NOT NULL REFERENCES public.otter_courses(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL DEFAULT auth.uid(),
  -- Keyed BY SUBJECT, because a lesson id ("lesson_1_1") is positional and only
  -- unique within its own subject — Validator.jsx builds the same composite key
  -- client-side. Stored shape matches what Otter.jsx keeps in memory so the
  -- adapter round-trips it without translation loss:
  --   { "<subject-slug>": { "completed_lessons": ["lesson_1_1"],
  --                         "last_accessed": "2026-07-01T..." } }
  completed_lessons JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Quiz attempts were never actually written on disk (_quiz-history.json is
  -- seeded and read but has no writer). The slot exists so the shape is settled
  -- when the quiz surface starts persisting; no UI writes it in S10.
  quiz_attempts     JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_accessed     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        UUID,
  CONSTRAINT otter_progress_lessons_sz_chk CHECK (pg_column_size(completed_lessons) <= 1048576),
  CONSTRAINT otter_progress_quiz_sz_chk    CHECK (pg_column_size(quiz_attempts)     <= 1048576)
);

CREATE UNIQUE INDEX IF NOT EXISTS otter_progress_course_user_uidx
  ON public.otter_progress (course_id, user_id);
CREATE INDEX IF NOT EXISTS otter_progress_ws_user_idx
  ON public.otter_progress (workspace_id, user_id);

DROP TRIGGER IF EXISTS trg_otter_progress_audit ON public.otter_progress;
CREATE TRIGGER trg_otter_progress_audit
  BEFORE INSERT OR UPDATE ON public.otter_progress
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_touch();

ALTER TABLE public.otter_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otter_progress FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE public.otter_progress IS
  'Session 10: per-user O.T.T.E.R. study state, one row per (course, user). Owner-only with NO admin bypass — a member''s study record is private. Hard delete (cascades with the course).';

-- ── 4. otter_course_editors ──────────────────────────────────────────────────
-- Per-user edit grants (Audrey: "owners can add others to have edit access").
-- Composite FK to workspace_members (the 0013 project_members shape) so a grant
-- cannot outlive the membership it was issued against.

CREATE TABLE IF NOT EXISTS public.otter_course_editors (
  workspace_id  UUID NOT NULL,
  course_id     UUID NOT NULL REFERENCES public.otter_courses(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL,
  granted_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, user_id),
  CONSTRAINT otter_course_editors_member_fk
    FOREIGN KEY (workspace_id, user_id)
    REFERENCES public.workspace_members (workspace_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS otter_course_editors_user_idx
  ON public.otter_course_editors (workspace_id, user_id);

ALTER TABLE public.otter_course_editors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otter_course_editors FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE public.otter_course_editors IS
  'Session 10: per-user edit grants on an O.T.T.E.R. course. Composite FK to workspace_members (0013 project_members shape) so a grant dies with the membership. Managed by the course owner or a workspace admin.';

-- ── 5. otter_change_requests ─────────────────────────────────────────────────
-- A user who forked a company-standard course can propose their changes back
-- with a written rationale; admins review (Audrey, 2026-07-28).

CREATE TABLE IF NOT EXISTS public.otter_change_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL DEFAULT public.current_workspace_id()
                   REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- The company-standard course the change is proposed AGAINST.
  target_course_id UUID NOT NULL REFERENCES public.otter_courses(id) ON DELETE CASCADE,
  -- The proposer's fork the changes come FROM. SET NULL: a withdrawn fork must
  -- not erase the request an admin is mid-review on.
  source_course_id UUID REFERENCES public.otter_courses(id) ON DELETE SET NULL,
  proposed_by      UUID NOT NULL DEFAULT auth.uid(),
  -- The user's own words: what they changed and why. This is the review surface.
  summary          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'approved', 'rejected', 'withdrawn')),
  reviewed_by      UUID,
  reviewed_at      TIMESTAMPTZ,
  review_note      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       UUID,
  CONSTRAINT otter_cr_summary_chk CHECK (char_length(summary) BETWEEN 1 AND 4000),
  CONSTRAINT otter_cr_note_chk    CHECK (review_note IS NULL OR char_length(review_note) <= 4000),
  -- A decided request must record who decided it.
  CONSTRAINT otter_cr_reviewed_chk CHECK (
    (status IN ('open', 'withdrawn'))
    OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS otter_cr_target_status_idx
  ON public.otter_change_requests (target_course_id, status);
CREATE INDEX IF NOT EXISTS otter_cr_ws_status_idx
  ON public.otter_change_requests (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS otter_cr_proposer_idx
  ON public.otter_change_requests (workspace_id, proposed_by);

DROP TRIGGER IF EXISTS trg_otter_cr_audit ON public.otter_change_requests;
CREATE TRIGGER trg_otter_cr_audit
  BEFORE INSERT OR UPDATE ON public.otter_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_touch();

ALTER TABLE public.otter_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otter_change_requests FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE public.otter_change_requests IS
  'Session 10: a proposal to fold a forked course''s changes back into the company-standard original. Visible to the proposer and to workspace admins; only admins may approve/reject, only the proposer may withdraw.';

-- ── 6. Live-row helpers ──────────────────────────────────────────────────────
-- All SECURITY DEFINER so policies never recurse (the 0008 lesson) and so a
-- revoked grant or a changed visibility takes effect on the next statement
-- rather than on the next token refresh (the 0020 has_rate_card_grant rule).

-- Reads ONLY otter_course_editors — safe to call from otter_courses policies.
-- The workspace re-check is not redundant: DEFINER bypasses RLS, and a user who
-- administers their OWN workspace could otherwise mint a grant row there naming
-- a course UUID belonging to a different workspace (course ids are visible to
-- the client — in cloud mode the "slug" IS the UUID) and have it honoured while
-- their active workspace was that other one.
CREATE OR REPLACE FUNCTION public.otter_has_editor_grant(p_course_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.otter_course_editors e
     WHERE e.course_id = p_course_id
       AND e.user_id = auth.uid()
       AND e.workspace_id = public.current_workspace_id()
  );
$$;

-- Reads ONLY otter_courses — safe to call from otter_course_editors policies.
CREATE OR REPLACE FUNCTION public.otter_is_course_owner(p_course_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.otter_courses c
     WHERE c.id = p_course_id
       AND c.owner_id = auth.uid()
       AND c.workspace_id = public.current_workspace_id()
       AND c.deleted_at IS NULL
  );
$$;

-- Course visibility, ignoring RLS. Used by policies that must know the tier of
-- a row they may not (yet) be able to SELECT.
CREATE OR REPLACE FUNCTION public.otter_course_visibility(p_course_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.visibility
    FROM public.otter_courses c
   WHERE c.id = p_course_id
     AND c.deleted_at IS NULL;
$$;

-- The single write gate: owner, workspace admin, or explicitly granted editor —
-- always inside the caller's workspace and always requiring an ACTIVE
-- membership (0020 alignment).
CREATE OR REPLACE FUNCTION public.otter_can_write_course(p_course_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws    UUID;
  v_owner UUID;
BEGIN
  SELECT c.workspace_id, c.owner_id INTO v_ws, v_owner
    FROM public.otter_courses c
   WHERE c.id = p_course_id
     AND c.deleted_at IS NULL;

  IF v_ws IS NULL
     OR v_ws IS DISTINCT FROM public.current_workspace_id()
     OR NOT public.has_active_membership(v_ws) THEN
    RETURN false;
  END IF;

  -- COALESCE so the answer is always a real boolean: a NULL leaking out of
  -- here is read as "deny" by an RLS policy but as "allow" by any caller that
  -- inverts it with NOT.
  RETURN COALESCE(
    v_owner = auth.uid()
    OR public.current_app_role() = 'admin'
    OR public.otter_has_editor_grant(p_course_id), false);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_has_editor_grant(UUID)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.otter_is_course_owner(UUID)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.otter_course_visibility(UUID)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.otter_can_write_course(UUID)   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_has_editor_grant(UUID)   TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.otter_is_course_owner(UUID)    TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.otter_course_visibility(UUID)  TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.otter_can_write_course(UUID)   TO authenticated, service_role;

-- ── 7. RLS policies ──────────────────────────────────────────────────────────

-- 7a. otter_courses ----------------------------------------------------------

DROP POLICY IF EXISTS otter_courses_select ON public.otter_courses;
DROP POLICY IF EXISTS otter_courses_insert ON public.otter_courses;
DROP POLICY IF EXISTS otter_courses_update ON public.otter_courses;
DROP POLICY IF EXISTS otter_courses_delete ON public.otter_courses;

-- Reading CONTENT. Personal courses are owner-only with no admin bypass; an
-- admin who needs to know a personal course exists uses otter_course_index(),
-- which returns metadata and never a lesson body.
CREATE POLICY otter_courses_select ON public.otter_courses
  FOR SELECT USING (
    deleted_at IS NULL
    AND workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (
      owner_id = auth.uid()
      OR visibility IN ('shared', 'company_standard')
      OR public.otter_has_editor_grant(id)
    )
  );

-- New courses are always born personal. Promotion to shared is an explicit
-- act by the owner; promotion to company_standard is admin-only (below).
CREATE POLICY otter_courses_insert ON public.otter_courses
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND owner_id = auth.uid()
    AND deleted_at IS NULL
    AND (
      visibility <> 'company_standard'
      OR public.current_app_role() = 'admin'
    )
  );

-- USING gates which rows you may touch; WITH CHECK gates what you may turn
-- them into. Re-pointing a course at another owner or workspace is refused on
-- both sides, and only an admin may move a row into or out of the
-- company_standard tier.
CREATE POLICY otter_courses_update ON public.otter_courses
  FOR UPDATE USING (
    deleted_at IS NULL
    AND workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.otter_can_write_course(id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.otter_can_write_course(id)
    -- Trashing is NOT a plain UPDATE. 0014 relied on the observation that
    -- Postgres re-checks the SELECT policy against the NEW row; stating it
    -- here makes the refusal explicit and version-independent, and forces
    -- every delete through otter_soft_delete_row() where authorization and
    -- the deleted_by stamp actually live.
    AND deleted_at IS NULL
    AND (
      visibility <> 'company_standard'
      OR public.current_app_role() = 'admin'
    )
  );

-- Hard DELETE is reserved for the owner and admins — the everyday path is
-- otter_soft_delete_row() (30-day trash). Granted editors may edit content but
-- may not destroy someone else's course.
CREATE POLICY otter_courses_delete ON public.otter_courses
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (owner_id = auth.uid() OR public.current_app_role() = 'admin')
  );

-- 7b. otter_subjects ---------------------------------------------------------

DROP POLICY IF EXISTS otter_subjects_select ON public.otter_subjects;
DROP POLICY IF EXISTS otter_subjects_insert ON public.otter_subjects;
DROP POLICY IF EXISTS otter_subjects_update ON public.otter_subjects;
DROP POLICY IF EXISTS otter_subjects_delete ON public.otter_subjects;

-- Visibility is INHERITED, not duplicated: the live-parent EXISTS runs under
-- the caller's own RLS (the 0014 pattern), so a course that otter_courses_select
-- hides — personal-and-not-yours, or soft-deleted — transitively hides every
-- subject beneath it with no propagation writes.
CREATE POLICY otter_subjects_select ON public.otter_subjects
  FOR SELECT USING (
    deleted_at IS NULL
    AND workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND EXISTS (
      SELECT 1 FROM public.otter_courses c WHERE c.id = otter_subjects.course_id
    )
  );

CREATE POLICY otter_subjects_insert ON public.otter_subjects
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND deleted_at IS NULL
    AND public.otter_can_write_course(course_id)
  );

CREATE POLICY otter_subjects_update ON public.otter_subjects
  FOR UPDATE USING (
    deleted_at IS NULL
    AND workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.otter_can_write_course(course_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.otter_can_write_course(course_id)
    -- As with courses: trashing goes through otter_soft_delete_row(), never a
    -- plain UPDATE.
    AND deleted_at IS NULL
  );

CREATE POLICY otter_subjects_delete ON public.otter_subjects
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.otter_can_write_course(course_id)
  );

-- 7c. otter_progress ---------------------------------------------------------
-- Own rows only, on every verb, with NO admin bypass: what a member has and
-- has not studied is theirs (the notes precedent).

DROP POLICY IF EXISTS otter_progress_select ON public.otter_progress;
DROP POLICY IF EXISTS otter_progress_insert ON public.otter_progress;
DROP POLICY IF EXISTS otter_progress_update ON public.otter_progress;
DROP POLICY IF EXISTS otter_progress_delete ON public.otter_progress;

CREATE POLICY otter_progress_select ON public.otter_progress
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND user_id = auth.uid()
  );

-- You may only start tracking progress on a course you can actually read —
-- the EXISTS runs under the caller's RLS, so it inherits otter_courses_select.
CREATE POLICY otter_progress_insert ON public.otter_progress
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.otter_courses c WHERE c.id = otter_progress.course_id
    )
  );

CREATE POLICY otter_progress_update ON public.otter_progress
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND user_id = auth.uid()
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND user_id = auth.uid()
  );

CREATE POLICY otter_progress_delete ON public.otter_progress
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND user_id = auth.uid()
  );

-- 7d. otter_course_editors ---------------------------------------------------

DROP POLICY IF EXISTS otter_course_editors_select ON public.otter_course_editors;
DROP POLICY IF EXISTS otter_course_editors_insert ON public.otter_course_editors;
DROP POLICY IF EXISTS otter_course_editors_delete ON public.otter_course_editors;

-- You can see a grant if it is yours, if you own the course, or if you are an
-- admin. otter_is_course_owner reads otter_courses as definer, so this never
-- recurses back into this table.
CREATE POLICY otter_course_editors_select ON public.otter_course_editors
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (
      user_id = auth.uid()
      OR public.otter_is_course_owner(course_id)
      OR public.current_app_role() = 'admin'
    )
  );

-- Only the course OWNER or an admin may grant edit access — a granted editor
-- cannot recruit further editors.
--
-- The admin arm is deliberately restricted to NON-personal courses. Without
-- that restriction an admin could launder themselves past the "no admin content
-- bypass" rule: otter_course_index() hands them every course's UUID, they
-- insert a self-grant, and otter_courses_select's editor arm then opens the
-- lesson bodies. Admins administer shared and company-standard material; a
-- member's private study material stays private, and only its owner can widen
-- access to it.
CREATE POLICY otter_course_editors_insert ON public.otter_course_editors
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (
      public.otter_is_course_owner(course_id)
      OR (
        public.current_app_role() = 'admin'
        AND public.otter_course_visibility(course_id) <> 'personal'
      )
    )
  );

-- Owners and admins revoke; a grantee may also remove themselves.
CREATE POLICY otter_course_editors_delete ON public.otter_course_editors
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (
      public.otter_is_course_owner(course_id)
      OR public.current_app_role() = 'admin'
      OR user_id = auth.uid()
    )
  );

-- Deliberately no UPDATE policy: a grant has no mutable fields. Regrant instead.

-- 7e. otter_change_requests --------------------------------------------------

DROP POLICY IF EXISTS otter_cr_select ON public.otter_change_requests;
DROP POLICY IF EXISTS otter_cr_insert ON public.otter_change_requests;
DROP POLICY IF EXISTS otter_cr_update ON public.otter_change_requests;

CREATE POLICY otter_cr_select ON public.otter_change_requests
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (
      proposed_by = auth.uid()
      OR public.current_app_role() = 'admin'
      OR public.otter_is_course_owner(target_course_id)
    )
  );

-- Requests are only meaningful against a company-standard course, and only the
-- caller may propose as themselves. Status starts 'open' and undecided.
CREATE POLICY otter_cr_insert ON public.otter_change_requests
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND proposed_by = auth.uid()
    AND status = 'open'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND public.otter_course_visibility(target_course_id) = 'company_standard'
  );

-- Admins (and the standard course's owner) decide; the proposer may only
-- withdraw. fn_otter_cr_review stamps the reviewer and blocks re-deciding a
-- settled request, so the policy only has to gate WHO may touch the row.
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
      -- The proposer may keep refining their rationale while the request is
      -- still open (Audrey: "the user should be able to clarify what changes
      -- they are recommending"), or withdraw it. They can never move it to
      -- approved/rejected — those are not in this list — and the review
      -- trigger separately refuses to reopen anything already settled.
      OR (proposed_by = auth.uid() AND status IN ('open', 'withdrawn'))
    )
  );

-- Deliberately no DELETE policy: review history is retained. Withdrawn is a
-- status, not a deletion.

-- Server-side review stamp: the reviewer is always the caller, and a settled
-- request can never be re-decided (0021 fn_app_events_stamp convention).
CREATE OR REPLACE FUNCTION public.fn_otter_cr_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status <> 'open' THEN
      RAISE EXCEPTION 'change request already % — reopen is not permitted', OLD.status;
    END IF;
    IF NEW.status IN ('approved', 'rejected') THEN
      NEW.reviewed_by := auth.uid();
      NEW.reviewed_at := now();
    END IF;
  ELSE
    -- No status change: the review fields are not the proposer's to write.
    -- Without this, a proposer editing their own open request could set
    -- reviewed_by to a real admin's id and review_note to "Approved by Ops",
    -- forging an endorsement that renders as genuine.
    NEW.reviewed_by := OLD.reviewed_by;
    NEW.reviewed_at := OLD.reviewed_at;
    IF NEW.review_note IS DISTINCT FROM OLD.review_note
       AND NOT COALESCE(public.current_app_role() = 'admin'
                        OR public.otter_is_course_owner(OLD.target_course_id), false) THEN
      NEW.review_note := OLD.review_note;
    END IF;
  END IF;
  -- Immutable provenance.
  NEW.proposed_by      := OLD.proposed_by;
  NEW.target_course_id := OLD.target_course_id;
  NEW.workspace_id     := OLD.workspace_id;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_otter_cr_review() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_otter_cr_review ON public.otter_change_requests;
CREATE TRIGGER trg_otter_cr_review
  BEFORE UPDATE ON public.otter_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_otter_cr_review();

-- 7f. Identity pinning ───────────────────────────────────────────────────────
-- Policies decide WHO may write a row; they do not by themselves stop a
-- permitted writer from re-pointing it. Without these triggers a granted
-- editor could set owner_id to themselves (stealing the course) or to someone
-- else (dumping it), and a subject could be moved between courses to smuggle
-- content across a visibility boundary. Ownership transfer is not a feature —
-- so the identity columns are simply immutable, enforced server-side rather
-- than left to every client write path to remember.

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
    IF NOT COALESCE(OLD.owner_id = auth.uid()
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

CREATE OR REPLACE FUNCTION public.fn_otter_pin_subject_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.workspace_id := OLD.workspace_id;
  NEW.course_id    := OLD.course_id;
  NEW.owner_id     := OLD.owner_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_otter_pin_progress_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.workspace_id := OLD.workspace_id;
  NEW.course_id    := OLD.course_id;
  NEW.user_id      := OLD.user_id;
  RETURN NEW;
END;
$$;

-- Postgres fires BEFORE ROW triggers in trigger-name order, which puts these
-- before the audit trigger on some tables and after it on others. That is
-- harmless here: the pin triggers touch only identity columns and
-- fn_audit_touch touches only updated_at/updated_by — disjoint sets, so the
-- order genuinely does not matter. Do not add overlapping columns to either
-- without revisiting this.
DROP TRIGGER IF EXISTS trg_otter_pin_course ON public.otter_courses;
CREATE TRIGGER trg_otter_pin_course
  BEFORE UPDATE ON public.otter_courses
  FOR EACH ROW EXECUTE FUNCTION public.fn_otter_pin_course_identity();

DROP TRIGGER IF EXISTS trg_otter_pin_subject ON public.otter_subjects;
CREATE TRIGGER trg_otter_pin_subject
  BEFORE UPDATE ON public.otter_subjects
  FOR EACH ROW EXECUTE FUNCTION public.fn_otter_pin_subject_identity();

DROP TRIGGER IF EXISTS trg_otter_pin_progress ON public.otter_progress;
CREATE TRIGGER trg_otter_pin_progress
  BEFORE UPDATE ON public.otter_progress
  FOR EACH ROW EXECUTE FUNCTION public.fn_otter_pin_progress_identity();

-- A grant row carries its own workspace_id (it needs one for the composite FK
-- to workspace_members). Nothing structurally tied that to the COURSE's
-- workspace, so a grant could name a course in workspace A while claiming
-- workspace B. Assert the invariant at write time rather than relying on every
-- policy to re-derive it.
CREATE OR REPLACE FUNCTION public.fn_otter_editor_grant_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course_ws UUID;
BEGIN
  SELECT c.workspace_id INTO v_course_ws
    FROM public.otter_courses c WHERE c.id = NEW.course_id;
  IF v_course_ws IS NULL OR v_course_ws IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION 'editor grant workspace does not match the course workspace';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_otter_editor_grant_workspace()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_otter_editor_grant_ws ON public.otter_course_editors;
CREATE TRIGGER trg_otter_editor_grant_ws
  BEFORE INSERT OR UPDATE ON public.otter_course_editors
  FOR EACH ROW EXECUTE FUNCTION public.fn_otter_editor_grant_workspace();

-- ── 8. Soft delete + trash ───────────────────────────────────────────────────
-- 0014's soft_delete_row() cannot be reused: fn_trash_authz hardcodes the seven
-- RABBIT tables and authorizes through can_write_project(), which has no
-- meaning here. The SAME reasoning still applies though — Postgres applies
-- SELECT policies to BOTH sides of an UPDATE that reads the table, so setting
-- deleted_at through a plain UPDATE fails (the NEW row is no longer visible)
-- and restoring is a silent 0-row match (the OLD row is already hidden). Both
-- directions therefore go through SECURITY DEFINER RPCs.

-- Self-contained on purpose. It must NOT delegate to otter_can_write_course():
-- that helper answers "may I write this LIVE course" and filters
-- `deleted_at IS NULL`, so routing restore through it made the trash a
-- one-way door — the row being restored is by definition already hidden.
-- 0014's fn_trash_authz resolves its row directly for the same reason.
CREATE OR REPLACE FUNCTION public.fn_otter_trash_authz(p_table TEXT, p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws     UUID;
  v_course UUID;
  v_owner  UUID;
BEGIN
  IF p_table NOT IN ('otter_courses', 'otter_subjects') THEN
    RAISE EXCEPTION 'not an otter soft-delete table: %', p_table;
  END IF;

  -- Definer, and deliberately no deleted_at predicate: trashed rows must stay
  -- resolvable so they can be authorized for restore.
  EXECUTE format(
    'SELECT workspace_id, %s FROM public.%I WHERE id = $1',
    CASE p_table WHEN 'otter_courses' THEN 'id' ELSE 'course_id' END,
    p_table)
    INTO v_ws, v_course
    USING p_id;

  IF v_ws IS NULL
     OR v_ws IS DISTINCT FROM public.current_workspace_id()
     OR NOT public.has_active_membership(v_ws) THEN
    RAISE EXCEPTION 'not allowed to trash or restore this otter row';
  END IF;

  -- Same rule otter_can_write_course applies (owner / admin / granted editor),
  -- evaluated against the owning course whether or not it is currently trashed.
  SELECT c.owner_id INTO v_owner
    FROM public.otter_courses c
   WHERE c.id = v_course;

  -- Trashing a COURSE is destructive in a way editing is not: a trashed course
  -- vanishes from its own owner's view (and from otter_course_index), so they
  -- cannot even find it to restore, and purge_otter_trash hard-deletes it after
  -- 30 days along with every user's progress. Granted editors therefore get the
  -- same rights here as otter_courses_delete gives them: none. They may still
  -- trash individual SUBJECTS, which is ordinary editing and reversible by
  -- anyone who can write the course.
  -- COALESCE: see fn_otter_pin_course_identity. Without it current_app_role()
  -- being NULL makes the whole NOT(...) NULL, the IF is skipped, and the RAISE
  -- never fires — i.e. everyone is allowed.
  IF v_owner IS NULL
     OR NOT COALESCE(
       v_owner = auth.uid()
       OR public.current_app_role() = 'admin'
       OR (p_table = 'otter_subjects' AND public.otter_has_editor_grant(v_course)),
       false
     ) THEN
    RAISE EXCEPTION 'not allowed to trash or restore this otter row';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_otter_trash_authz(TEXT, UUID)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.otter_soft_delete_row(p_table TEXT, p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows BIGINT;
BEGIN
  PERFORM public.fn_otter_trash_authz(p_table, p_id);
  EXECUTE format(
    'UPDATE public.%I SET deleted_at = now(), deleted_by = auth.uid()
      WHERE id = $1 AND deleted_at IS NULL',
    p_table)
    USING p_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.otter_restore_row(p_table TEXT, p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows BIGINT;
BEGIN
  -- fn_otter_trash_authz resolves the row as definer, so a hidden (trashed)
  -- row is still reachable for the authorization check.
  PERFORM public.fn_otter_trash_authz(p_table, p_id);
  EXECUTE format(
    'UPDATE public.%I SET deleted_at = NULL, deleted_by = NULL
      WHERE id = $1 AND deleted_at IS NOT NULL',
    p_table)
    USING p_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_soft_delete_row(TEXT, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_soft_delete_row(TEXT, UUID) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.otter_restore_row(TEXT, UUID)     FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_restore_row(TEXT, UUID)     TO authenticated, service_role;

COMMENT ON FUNCTION public.otter_soft_delete_row IS
  'Session 10: moves an otter_courses/otter_subjects row to trash after re-checking workspace, active membership and course write rights. The only client path in — a plain UPDATE fails the SELECT policy on the NEW row (the 0014 lesson).';
COMMENT ON FUNCTION public.otter_restore_row IS
  'Session 10: restores a trashed otter_courses/otter_subjects row. The only client path out — a plain UPDATE cannot see the hidden OLD row and silently matches nothing.';

-- 30-day trash retention, matching the RABBIT sweep (locked in 0014).
CREATE OR REPLACE FUNCTION public.purge_otter_trash(p_keep INTERVAL DEFAULT INTERVAL '30 days')
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted BIGINT;
  v_total   BIGINT := 0;
BEGIN
  -- Subjects first: deleting a course cascades its subjects anyway, but
  -- sweeping them explicitly keeps the count honest and reclaims subjects
  -- trashed under a still-live course.
  DELETE FROM public.otter_subjects
   WHERE deleted_at IS NOT NULL AND deleted_at < now() - p_keep;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  v_total := v_total + v_deleted;

  DELETE FROM public.otter_courses
   WHERE deleted_at IS NOT NULL AND deleted_at < now() - p_keep;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  v_total := v_total + v_deleted;

  RETURN v_total;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_otter_trash(INTERVAL) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_otter_trash(INTERVAL) TO service_role;

-- Schedule where pg_cron exists (hosted envs). The CI local stack ships without
-- it; a scheduling hiccup must never fail the migration (0012/0021 idiom).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule(
      'wilson-purge-otter-trash',
      '55 4 * * *',
      $job$ SELECT public.purge_otter_trash(); $job$
    );
  ELSE
    RAISE NOTICE 'pg_cron unavailable — otter trash purge not scheduled (expected in CI local stack)';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'could not schedule otter trash purge via pg_cron: %', SQLERRM;
END $$;

-- ── 9. otter_fork_course() ───────────────────────────────────────────────────
-- "Use the company standard course" — takes a personal copy so the official
-- version stays pristine and an admin edit never changes a course underneath
-- someone mid-study (Audrey, 2026-07-28). Also the generic duplicate path.

CREATE OR REPLACE FUNCTION public.otter_fork_course(p_course_id UUID, p_new_name TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src      public.otter_courses%ROWTYPE;
  v_ws       UUID := public.current_workspace_id();
  v_new_id   UUID;
  v_name     TEXT;
  v_slug     TEXT;
  v_suffix   INTEGER := 2;
BEGIN
  IF v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RAISE EXCEPTION 'not an active member of this workspace';
  END IF;

  SELECT * INTO v_src FROM public.otter_courses c
   WHERE c.id = p_course_id AND c.deleted_at IS NULL;

  IF v_src.id IS NULL OR v_src.workspace_id IS DISTINCT FROM v_ws THEN
    RAISE EXCEPTION 'course not found in this workspace';
  END IF;

  -- Definer bypasses RLS, so re-assert what otter_courses_select would allow:
  -- you may only fork something you can actually read.
  IF NOT (v_src.owner_id = auth.uid()
          OR v_src.visibility IN ('shared', 'company_standard')
          OR public.otter_has_editor_grant(p_course_id)) THEN
    RAISE EXCEPTION 'not allowed to fork this course';
  END IF;

  v_name := COALESCE(NULLIF(btrim(p_new_name), ''), v_src.name);
  v_slug := v_src.slug;

  -- The fork lands in the caller's own namespace, so a collision only happens
  -- when they already hold a course of that slug. Suffix until free.
  WHILE EXISTS (
    SELECT 1 FROM public.otter_courses c
     WHERE c.workspace_id = v_ws AND c.owner_id = auth.uid()
       AND c.slug = v_slug AND c.deleted_at IS NULL
  ) LOOP
    v_slug := left(v_src.slug, 110) || '-' || v_suffix::text;
    v_suffix := v_suffix + 1;
    IF v_suffix > 50 THEN
      RAISE EXCEPTION 'could not allocate a free slug for the fork';
    END IF;
  END LOOP;

  INSERT INTO public.otter_courses (
    workspace_id, owner_id, slug, name, course_type, skill_level,
    visibility, source_course_id,
    hotkeys, functions, nodes, reference_urls, corrections,
    created_by, updated_by
  ) VALUES (
    v_ws, auth.uid(), v_slug, v_name, v_src.course_type, v_src.skill_level,
    -- A fork is ALWAYS personal: taking a copy must never republish it.
    'personal', v_src.id,
    v_src.hotkeys, v_src.functions, v_src.nodes, v_src.reference_urls,
    -- Corrections are the original author's agent memory, not content.
    '{"corrections": []}'::jsonb,
    auth.uid(), auth.uid()
  )
  RETURNING id INTO v_new_id;

  INSERT INTO public.otter_subjects (
    workspace_id, course_id, owner_id, slug, title, description, skill_level,
    is_stub, subject_order, estimated_hours,
    sections, section_outlines, sources, prerequisites,
    created_by, updated_by
  )
  SELECT v_ws, v_new_id, auth.uid(), s.slug, s.title, s.description, s.skill_level,
         s.is_stub, s.subject_order, s.estimated_hours,
         s.sections, s.section_outlines, s.sources, s.prerequisites,
         auth.uid(), auth.uid()
    FROM public.otter_subjects s
   WHERE s.course_id = p_course_id
     AND s.deleted_at IS NULL;

  RETURN v_new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_fork_course(UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_fork_course(UUID, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.otter_fork_course IS
  'Session 10: takes a personal copy of a readable course (with its live subjects) and records source_course_id. Forks are always born personal. Backs the "use the company standard course instead of generating a new one" flow.';

-- ── 10. otter_course_index() — metadata-only admin visibility ────────────────
-- Audrey, 2026-07-28: "admins can see that it exists, not its contents."
-- Returns one row per live course in the workspace. For courses the caller may
-- read, can_read_content is true and the client may go fetch the real row; for
-- everyone else's PERSONAL courses an admin gets the existence facts only —
-- no sections, no lesson bodies, no reference documents.

DROP FUNCTION IF EXISTS public.otter_course_index();

CREATE FUNCTION public.otter_course_index()
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
  -- Membership + role from the LIVE row, never the JWT (0010/0021 convention:
  -- definer bypasses RLS, so the function re-checks itself).
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
          OR public.otter_has_editor_grant(c.id)) AS can_read_content,
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
     -- Admins see every course EXISTS. Everyone else sees only what they can
     -- actually open — no fishing for colleagues' personal course titles.
     AND (
       v_role = 'admin'
       OR c.owner_id = v_uid
       OR c.visibility IN ('shared', 'company_standard')
       OR public.otter_has_editor_grant(c.id)
     )
   ORDER BY c.updated_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.otter_course_index() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_course_index() TO authenticated, service_role;

COMMENT ON FUNCTION public.otter_course_index IS
  'Session 10: metadata-only course index. Admins see that every course exists (title, owner, subject count) without any lesson content; can_read_content tells the client whether the real row is fetchable. Backs the O.T.T.E.R. mine/shared/standard filters.';

-- ── 11. Post-conditions ──────────────────────────────────────────────────────

DO $$
DECLARE
  t         TEXT;
  has_rls   BOOLEAN;
  is_forced BOOLEAN;
BEGIN
  FOREACH t IN ARRAY ARRAY['otter_courses', 'otter_subjects', 'otter_progress',
                           'otter_course_editors', 'otter_change_requests']
  LOOP
    EXECUTE format(
      'SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = %L::regclass',
      'public.' || t)
      INTO has_rls, is_forced;
    IF NOT COALESCE(has_rls, false) OR NOT COALESCE(is_forced, false) THEN
      RAISE EXCEPTION '0022 post-condition failed for %: rowsecurity=%, force=%',
        t, has_rls, is_forced;
    END IF;
  END LOOP;

  -- Personal content must never be readable through an app-role bypass: no
  -- policy on these tables may mention current_app_role() in a SELECT arm.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('otter_courses', 'otter_progress')
       AND cmd = 'SELECT'
       AND qual LIKE '%current_app_role%'
  ) THEN
    RAISE EXCEPTION '0022 post-condition failed: admin bypass leaked into a personal-content SELECT policy';
  END IF;

  -- Change requests and editor grants are append/decide-only.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'otter_change_requests' AND cmd = 'DELETE'
  ) THEN
    RAISE EXCEPTION '0022 post-condition failed: otter_change_requests must retain review history';
  END IF;

  FOREACH t IN ARRAY ARRAY['otter_soft_delete_row(text,uuid)', 'otter_restore_row(text,uuid)',
                           'otter_fork_course(uuid,text)', 'otter_course_index()',
                           'otter_can_write_course(uuid)', 'purge_otter_trash(interval)']
  LOOP
    IF to_regprocedure('public.' || t) IS NULL THEN
      RAISE EXCEPTION '0022 post-condition failed: function % missing', t;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'otter_courses_standard_slug_uidx'
  ) THEN
    RAISE EXCEPTION '0022 post-condition failed: company-standard uniqueness index missing';
  END IF;

  -- Identity pinning is a security control, not a nicety: without it a granted
  -- editor can reassign ownership. Fail the migration if a trigger is missing.
  FOREACH t IN ARRAY ARRAY['trg_otter_pin_course', 'trg_otter_pin_subject',
                           'trg_otter_pin_progress']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t AND NOT tgisinternal) THEN
      RAISE EXCEPTION '0022 post-condition failed: identity-pin trigger % missing', t;
    END IF;
  END LOOP;
END $$;
