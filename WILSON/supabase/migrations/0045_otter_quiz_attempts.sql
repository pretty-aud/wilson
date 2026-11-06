-- =========================================================================
-- 0045_otter_quiz_attempts.sql — Session 30.
--
-- One personal quiz history, wiped after 30 days, replacing a per-course
-- column that no code has ever written.
--
-- Idempotent: safe to re-run.
-- ORDERING: depends on 0004 (fn_audit_touch), 0020 (has_active_membership as
--           it now stands), 0022 (otter_progress, whose quiz_attempts column
--           this retires). Nothing depends on this one yet.
--
--
-- 🚨 WHAT WAS MEASURED BEFORE ANY OF THIS WAS WRITTEN (2026-08-05)
-- -------------------------------------------------------------------------
-- `otter_progress.quiz_attempts` has existed since 0022 and **no row on any
-- environment has ever carried a value**: 0 rows with a non-empty array on
-- dev, staging AND prod — where `otter_progress` itself holds 0 rows, and
-- `otter_courses` holds 0 rows, including trashed ones. On Local Server, where
-- Audrey's six real courses live, all six `_quiz-history.json` files exist and
-- all six hold `attempts: []`. 0022's own comment said so at the time: "Quiz
-- attempts were never actually written on disk ... no UI writes it in S10."
--
-- So this is not "add persistence for quiz scores". The column, both adapter
-- ops, the route mapping and a PASSING unit test have all existed for twenty
-- sessions with nothing calling the writer. That is the fourth instance of the
-- shape (the folder tree in S27, task templates in S28, and O.T.T.E.R.'s own
-- unreferenced `setOtterAdapterMode`) and the first where a green unit test
-- covers the dead path.
--
--
-- 🚨 WHY A NEW TABLE AND NOT THE EXISTING COLUMN — the fact that decides it
-- -------------------------------------------------------------------------
-- **A quiz is not per-course.** `quizSelections` (Otter.jsx:129) is
-- `{ [courseSlug]: 'all' | Set<subjectSlug> }` and `getQuizContent`
-- (:1975-2024) concatenates lesson content across EVERY selected course —
-- `softwareNames.join(', ')` at :2020 is the giveaway. Tick Blender and Unity
-- and you get one quiz, one score.
--
-- `otter_progress` is keyed `(course_id, user_id)` with
-- `course_id UUID NOT NULL REFERENCES otter_courses(id)`. A two-course attempt
-- has no single course_id, so the "obvious" wiring — post the score under
-- whichever course happens to be active — would file results against a course
-- that may not even be among the ones examined. Sizing this as "call the
-- writer that already exists" produces exactly that.
--
-- Audrey chose the shape (2026-08-05), having been shown that it needs a
-- schema change: *"lets have one personal quiz history but wipe it every
-- month. its not needed."* Read as: build it, keep it small, do not invest.
-- This migration is deliberately the least schema that satisfies it.
--
--
-- 🚨 WHY THE 30-DAY WIPE IS IN THE **SELECT POLICY** AND NOT ONLY IN A PRUNER
-- -------------------------------------------------------------------------
-- The adapter deletes the caller's own rows older than 30 days before each
-- insert, which reclaims the space. But a pruner that only runs on write does
-- nothing for a user who never takes another quiz, and "wiped every month"
-- would then be true of active users and false of everyone else — the promise
-- would hold by luck.
--
-- Putting the window in the SELECT policy makes it a database guarantee: after
-- 30 days the row is unreachable through PostgREST by anybody, whatever the
-- client remembers to filter. The DELETE policy deliberately does NOT carry
-- the window, or the pruner could never reach the rows it exists to remove.
--
-- 🚨 AND THE WINDOW MAKES EXPIRED ROWS UNDELETABLE BY THE CLIENT, WHICH IS
-- WHY public.otter_prune_quiz_attempts() EXISTS. This was not foreseen — pgTAP
-- suite 55's probe pair caught it on the first run, `have: 2 want: 1`.
-- PostgreSQL applies SELECT policies to an UPDATE or DELETE whenever the
-- statement has to READ the rows, which a `WHERE taken_at < …` does. So a row
-- the window hides cannot be matched by the pruner's own WHERE clause, and
-- "deleted after 30 days" would have meant "hidden after 30 days and then kept
-- forever" — strictly worse than no window, because the rows accumulate where
-- nobody can see them.
--
-- The pruner is therefore SECURITY DEFINER, takes no arguments, and can only
-- ever touch `auth.uid()`'s own expired rows. Probe 15 pins the refusal a
-- plain client DELETE gets, so nobody removes the function believing the
-- direct path works.
--
-- ⚠️ One more interaction: `INSERT ... RETURNING` re-checks the SELECT policy
-- against the new row, so an attempt inserted with a BACKDATED `taken_at`
-- beyond the window would insert and then return zero rows, which a caller
-- reads as failure. Nothing backdates — `taken_at` defaults to now() and the
-- adapter never sends it — but a future importer must set the window aside
-- deliberately rather than discover this.
--
--
-- 🚨 WORKSPACE-SCOPED, AND THAT IS NOT THE S31 PET RULE BEING BROKEN
-- -------------------------------------------------------------------------
-- Audrey's separate requirement for the pet and per-user settings is ONE per
-- PERSON, not per workspace. This table is per (workspace, user), and the
-- difference is deliberate: a quiz attempt is ABOUT courses, courses are
-- workspace-scoped, and carrying a Blender score from one company into
-- another would list a course the reader cannot open. The pet belongs to the
-- person; a mark belongs to the syllabus it was earned against.
-- =========================================================================


-- ── 1. Retire otter_progress.quiz_attempts ───────────────────────────────
--
-- Guarded rather than assumed. The census above was taken minutes before this
-- was written, and a migration applied later against a database somebody has
-- since used must not silently discard rows. If any attempt data exists, this
-- REFUSES and the drop has to be reconsidered by a person.
--
-- Wrapped in EXECUTE because a plpgsql block referencing a dropped column
-- fails to parse at run time, which would break the second run of an
-- otherwise idempotent migration.

DO $guard$
DECLARE
  v_rows INT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'otter_progress'
       AND column_name = 'quiz_attempts'
  ) THEN
    EXECUTE $q$
      SELECT count(*)::int FROM public.otter_progress
       WHERE jsonb_typeof(quiz_attempts) = 'array'
         AND jsonb_array_length(quiz_attempts) > 0
    $q$ INTO v_rows;

    IF v_rows > 0 THEN
      RAISE EXCEPTION
        '0045 refuses to drop otter_progress.quiz_attempts: % row(s) carry attempt data. '
        'It was empty on dev, staging and prod on 2026-08-05. Migrate those rows into '
        'public.otter_quiz_attempts first, then re-run.', v_rows;
    END IF;
  END IF;
END
$guard$;

ALTER TABLE public.otter_progress
  DROP CONSTRAINT IF EXISTS otter_progress_quiz_sz_chk;
ALTER TABLE public.otter_progress
  DROP COLUMN IF EXISTS quiz_attempts;


-- ── 2. otter_quiz_attempts ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.otter_quiz_attempts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Defaulted, not client-supplied, so tenancy comes from the JWT and the
  -- adapter cannot mis-stamp it (the pattern every other O.T.T.E.R. table
  -- follows, and the reason supabaseOtterAdapter omits both columns).
  workspace_id   UUID NOT NULL DEFAULT public.current_workspace_id()
                 REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL DEFAULT auth.uid(),

  taken_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  score          INT NOT NULL,
  total          INT NOT NULL,

  -- [{ "id": "<course id>", "name": "Blender 5.0" }, ...]
  --
  -- 🚨 Denormalised ON PURPOSE, with no FK. Two reasons, both load-bearing:
  --   * a course id is a UUID in cloud and a slugified name on Local Server,
  --     so one column cannot reference otter_courses on both backends;
  --   * otter_courses purges 30 days after trashing, and an FK would take the
  --     attempt with it. A mark should outlive the course it was earned
  --     against for as long as the history is kept — storing the NAME is what
  --     keeps the row readable once the course is gone.
  courses        JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- ["mc"] | ["mc","codeId"] — which question kinds were included.
  -- `codeWrite` challenges are never scored (nothing marks them, and
  -- quizComplete is only ever set from the multiple-choice path), so an
  -- attempt exists only when there were graded questions.
  question_types JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID,

  -- renderQuizResults divides by `total` (Otter.jsx:4721), so a zero here is a
  -- NaN on screen rather than a bad row in a report.
  CONSTRAINT otter_quiz_attempts_total_chk   CHECK (total > 0),
  CONSTRAINT otter_quiz_attempts_score_chk   CHECK (score >= 0 AND score <= total),
  CONSTRAINT otter_quiz_attempts_courses_chk CHECK (jsonb_typeof(courses) = 'array'),
  CONSTRAINT otter_quiz_attempts_types_chk   CHECK (jsonb_typeof(question_types) = 'array'),
  -- Bounded for the same reason 0022 bounded quiz_attempts, but two orders of
  -- magnitude smaller: this holds a handful of {id,name} pairs, not a history.
  CONSTRAINT otter_quiz_attempts_courses_sz_chk CHECK (pg_column_size(courses) <= 8192)
);

CREATE INDEX IF NOT EXISTS otter_quiz_attempts_user_taken_idx
  ON public.otter_quiz_attempts (user_id, taken_at DESC);
-- Supports the pruner's `taken_at <` sweep and the workspace cascade.
CREATE INDEX IF NOT EXISTS otter_quiz_attempts_ws_taken_idx
  ON public.otter_quiz_attempts (workspace_id, taken_at);

COMMENT ON TABLE public.otter_quiz_attempts IS
  'Session 30: one personal quiz history per (workspace, user), kept for 30 days. Replaces otter_progress.quiz_attempts, which was per-course and had no writer on any backend. A quiz can span several courses, so an attempt has no single course_id — see the courses column.';
COMMENT ON COLUMN public.otter_quiz_attempts.courses IS
  'Denormalised [{id, name}] of every course the questions were drawn from. No FK: the id is a UUID in cloud and a slug on Local Server, and an attempt must outlive the purge of the course it examined.';
COMMENT ON COLUMN public.otter_quiz_attempts.taken_at IS
  'When the quiz finished. The SELECT policy hides rows older than 30 days, so this is the retention clock as well as a timestamp; the DELETE policy deliberately omits the window so the pruner can still reach them.';


-- ── 3. updated_at / audit stamps ─────────────────────────────────────────
-- fn_audit_touch is LANGUAGE plpgsql and NOT SECURITY DEFINER, which is the
-- precondition for FORCE ROW LEVEL SECURITY below. Same trigger otter_progress
-- uses, so created_by/updated_by are stamped identically.

DROP TRIGGER IF EXISTS trg_otter_quiz_attempts_audit ON public.otter_quiz_attempts;
CREATE TRIGGER trg_otter_quiz_attempts_audit
  BEFORE INSERT OR UPDATE ON public.otter_quiz_attempts
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_touch();


-- ── 4. RLS ───────────────────────────────────────────────────────────────
--
-- Own rows only, on every verb, with NO admin bypass — otter_progress's stated
-- rule (0022:599-600, "what a member has and has not studied is theirs")
-- applied to what they scored, which is if anything more personal.
--
-- Never FOR ALL: a broad FOR ALL arm ORs with every narrow arm beside it and
-- silently wins (0029; it cost S15 a CRITICAL).
--
-- 🚨 THERE IS DELIBERATELY NO UPDATE POLICY. An attempt is a record of
-- something that happened; nothing in the UI edits one, and RLS default-denies
-- what no policy admits, so "immutable" is enforced by the absence rather than
-- by a CHECK anybody could forget. If a future feature needs to annotate an
-- attempt, it adds the policy explicitly and states why.

ALTER TABLE public.otter_quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otter_quiz_attempts FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS otter_quiz_attempts_select ON public.otter_quiz_attempts;
DROP POLICY IF EXISTS otter_quiz_attempts_insert ON public.otter_quiz_attempts;
DROP POLICY IF EXISTS otter_quiz_attempts_update ON public.otter_quiz_attempts;
DROP POLICY IF EXISTS otter_quiz_attempts_delete ON public.otter_quiz_attempts;

-- The 30-day window lives HERE, so the retention promise does not depend on a
-- pruner ever running. See the header.
CREATE POLICY otter_quiz_attempts_select ON public.otter_quiz_attempts
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND user_id = auth.uid()
    AND taken_at >= now() - INTERVAL '30 days'
  );

CREATE POLICY otter_quiz_attempts_insert ON public.otter_quiz_attempts
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND user_id = auth.uid()
  );

-- No window here, on purpose — but note that this is NOT sufficient on its
-- own to prune, because the SELECT policy above also gates the rows a DELETE's
-- WHERE clause can match. This policy is what lets a user clear their OWN
-- visible history; the expired tail needs the definer function below.
CREATE POLICY otter_quiz_attempts_delete ON public.otter_quiz_attempts
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND user_id = auth.uid()
  );


-- ── 4b. The pruner ───────────────────────────────────────────────────────
--
-- Exists because of the interaction described in the header: the SELECT
-- policy's 30-day window hides expired rows from a DELETE's WHERE clause, so
-- the client cannot reach the very rows it is meant to clear.
--
-- SECURITY DEFINER is the smallest tool that works, and it is kept safe by
-- shape rather than by argument checking: the function takes NO parameters and
-- hardcodes `auth.uid()`, so there is no input with which to ask it for
-- somebody else's rows. It cannot widen the window either — the interval is a
-- literal.
--
-- 🚨 REVOKE FROM PUBLIC, not just anon. A function carries a bare `=X/postgres`
-- aclitem, so naming only anon is a silent no-op that reports success — the
-- S22 lesson (0033:190-191), where seven anon-executable SECURITY DEFINER
-- functions were a live pre-auth RLS bypass because PostgREST serves them at
-- /rest/v1/rpc/. This one bypasses RLS by design, which makes the grantee the
-- whole of its security.

CREATE OR REPLACE FUNCTION public.otter_prune_quiz_attempts()
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH gone AS (
    DELETE FROM public.otter_quiz_attempts
     WHERE auth.uid() IS NOT NULL
       AND user_id = auth.uid()
       AND taken_at < now() - INTERVAL '30 days'
    RETURNING 1
  )
  SELECT count(*)::int FROM gone;
$$;

COMMENT ON FUNCTION public.otter_prune_quiz_attempts() IS
  'Deletes the CALLER''s quiz attempts older than 30 days and returns how many went. SECURITY DEFINER because otter_quiz_attempts_select hides expired rows, and PostgreSQL applies SELECT policies to a DELETE that reads rows in its WHERE clause — so the ordinary delete path cannot reach them (pgTAP 55 probe 15). Takes no arguments and hardcodes auth.uid(), so it cannot be aimed at another user.';

REVOKE EXECUTE ON FUNCTION public.otter_prune_quiz_attempts() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.otter_prune_quiz_attempts() TO authenticated, service_role;


-- ── 5. Privileges ────────────────────────────────────────────────────────
--
-- MEASURED on wilson-dev before writing this (2026-08-05): folders (0041),
-- task_templates (0044) and otter_progress (0022) all hold exactly
-- authenticated:{SELECT,INSERT,UPDATE,DELETE} and nothing for anon — 0033
-- disarmed 0011's ALTER DEFAULT PRIVILEGES, so a table created now is born
-- correct and neither 0041 nor 0044 issues a GRANT.
--
-- The REVOKEs below are therefore expected to be no-ops, and are here anyway:
-- S22's lesson is that assuming a grantee is what makes a hole invisible, and
-- a redundant REVOKE costs nothing while a missing one costs a CRITICAL.
-- Suite 55 asserts the end state rather than trusting either.
--
-- ⚠️ `authenticated` KEEPS the UPDATE privilege, even though section 4
-- deliberately grants no UPDATE policy. That looks inconsistent and is the
-- safer of the two options: RLS already denies every UPDATE (default-deny on
-- an unpoliced verb), so revoking the privilege as well would add nothing
-- today — and would make the eventual session that legitimately adds an
-- UPDATE policy watch it fail for a reason nowhere near the policy it just
-- wrote. One mechanism, stated in one place. Suite 55 pins the refusal, so it
-- is a tested guarantee rather than a convention.

REVOKE ALL ON public.otter_quiz_attempts FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.otter_quiz_attempts FROM authenticated;
