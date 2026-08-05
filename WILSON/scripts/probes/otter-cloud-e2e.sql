-- =========================================================================
-- otter-cloud-e2e.sql — Session 30.
--
-- Not a pgTAP suite. Suites 26-32 pin the ACCESS RULES with synthetic
-- fixtures; this walks the whole chain the application actually performs, in
-- order, with the exact payloads supabaseOtterAdapter.js builds, against the
-- real workspace this database already has.
--
-- 🚨 WHY IT EXISTS, and it is a stronger reason than S28's was.
-- MEASURED 2026-08-05, on dev, staging AND prod: `otter_courses` holds
-- **0 rows** — including trashed ones — and so do `otter_subjects` and
-- `otter_progress`. Every one of Audrey's six courses (49 subjects, 138
-- lessons) lives in %APPDATA%\wilson\otter-data on one laptop. So O.T.T.E.R.
-- has never created a course in the cloud on ANY environment, and none of the
-- seven pgTAP suites covering it can tell you that, because every one of them
-- inserts its own fixtures.
--
-- Audrey, 2026-08-05: *"we can start with otter being empty. i can generate
-- new courses during beta testing."* That makes this the gating risk of the
-- whole session — if `course.create` refuses the way `tasks` did in S23, she
-- hits it on her first beta course and nothing else here matters.
--
-- The instrument's honesty matters as much as its result (standing rule 2):
-- it emits a TABLE, not NOTICEs, because `db query -o json` discards
-- RAISE NOTICE and a DO block that never ran is then indistinguishable from
-- one that logged nothing. Each step writes a row; the run passes only when
-- all six are present.
--
-- Runs as `authenticated` with real JWT claims, never as postgres, or every
-- policy would be bypassed and the run would prove nothing. Rolls back, so it
-- leaves no debris on a shared database.
--
-- Usage, from WILSON/ with the CLI linked to the target project:
--     supabase db query --linked --file scripts/probes/otter-cloud-e2e.sql
-- =========================================================================
BEGIN;

CREATE TEMP TABLE probe_log (n INT, step TEXT, detail TEXT);
-- The DO block runs as `authenticated`, which owns nothing here. Without this
-- the first log INSERT 42501s — which is a real result, not a nuisance: it is
-- the probe proving it really did drop privilege rather than quietly staying
-- postgres and passing every policy vacuously.
GRANT INSERT, SELECT ON probe_log TO authenticated;

DO $probe$
DECLARE
  v_ws        UUID;
  v_user      UUID;
  v_course    UUID;
  v_ws_got    UUID;
  v_owner_got UUID;
  v_sections  JSONB;
  v_found     INT;
  v_content   TEXT;
  v_subject   UUID;

  -- The Validator's two halves of one replacement (Validator.jsx:431-432:
  -- `lesson.content.replace(fix.original, fix.proposed)`).
  c_wrong  TEXT := 'Blender ships with a Cycles renderer that is CPU-only.';
  c_right  TEXT := 'Blender ships with a Cycles renderer that supports GPU compute.';
BEGIN
  -- Pick a real workspace and a real active admin of it.
  SELECT wm.workspace_id, wm.user_id INTO v_ws, v_user
    FROM public.workspace_members wm
   WHERE wm.is_active AND wm.app_role = 'admin'
   ORDER BY wm.workspace_id
   LIMIT 1;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'PROBE ABORTED: no active workspace admin on this database';
  END IF;

  -- Become that user. Everything below is subject to RLS.
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user::text,
    'role', 'authenticated',
    'app_metadata', json_build_object(
      'workspace_id', v_ws::text, 'app_role', 'admin')
  )::text, true);
  SET LOCAL ROLE authenticated;

  -- ── 1. course.create (supabaseOtterAdapter.js:154-174) ──────────────────
  -- 🚨 workspace_id and owner_id are DELIBERATELY OMITTED, exactly as the
  -- adapter omits them (its header, :23-25: "the columns DEFAULT to
  -- current_workspace_id() / auth.uid(), so the database decides tenancy from
  -- the JWT and a client can never mis-stamp it"). Supplying them here would
  -- test a payload the app never sends — which is precisely the mistake the
  -- adapter's own comment at :117 records about the pgTAP suites.
  INSERT INTO public.otter_courses (slug, name, course_type, skill_level, visibility)
  VALUES ('e2e-probe-course', 'E2E Probe Course', 'software', 'beginner', 'personal')
  RETURNING id, workspace_id, owner_id INTO v_course, v_ws_got, v_owner_got;

  IF v_ws_got IS DISTINCT FROM v_ws THEN
    RAISE EXCEPTION 'FAILED at 1: workspace defaulted to %, expected %', v_ws_got, v_ws;
  END IF;
  IF v_owner_got IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'FAILED at 1: owner defaulted to %, expected %', v_owner_got, v_user;
  END IF;
  INSERT INTO probe_log VALUES (1, 'course created, tenancy self-stamped', v_course::text);

  -- ── 2. course.list (adapter :138-143) — the LIBRARY read ────────────────
  -- Not a table read: the RPC also carries subject_count and the capability
  -- flags the tier chips render from. A course that inserts fine but never
  -- appears here is invisible in the app, which is the same class of bug as
  -- the S27 folder tree.
  SELECT count(*)::int INTO v_found
    FROM public.otter_course_index() i
   WHERE i.id = v_course;

  IF v_found <> 1 THEN
    RAISE EXCEPTION 'FAILED at 2: otter_course_index() does not list the new course';
  END IF;
  INSERT INTO probe_log VALUES (2, 'course visible in the library RPC', 'otter_course_index sees it');

  -- ── 3. subject.save, INSERT branch (adapter :256-272) ───────────────────
  -- The real sections shape: sections[] -> lessons[] with a content body, the
  -- structure Validator.jsx walks at :429-436 and Otter.jsx renders.
  v_sections := jsonb_build_array(
    jsonb_build_object(
      'title', 'Rendering',
      'lessons', jsonb_build_array(
        jsonb_build_object(
          'id', 'lesson_1_1',
          'title', 'The render engines',
          'content', c_wrong,
          'key_takeaways', jsonb_build_array('Cycles is the path tracer'))))
  );

  INSERT INTO public.otter_subjects
    (course_id, slug, title, description, skill_level, is_stub, subject_order,
     sections, section_outlines, sources, prerequisites)
  VALUES
    (v_course, 'rendering', 'Rendering', '', 'beginner', false, 1,
     v_sections, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)
  RETURNING id INTO v_subject;
  INSERT INTO probe_log VALUES (3, 'subject saved with lesson content', v_subject::text);

  -- ── 4. subject.get (adapter :215-221) ───────────────────────────────────
  SELECT s.sections->0->'lessons'->0->>'content' INTO v_content
    FROM public.otter_subjects s
   WHERE s.course_id = v_course AND s.slug = 'rendering';

  IF v_content IS DISTINCT FROM c_wrong THEN
    RAISE EXCEPTION 'FAILED at 4: read back [%], expected the stored lesson body', v_content;
  END IF;
  INSERT INTO probe_log VALUES (4, 'lesson content reads back intact', left(v_content, 40) || '...');

  -- ── 5. THE VALIDATOR'S "ACCEPT FIX" (Validator.jsx:444, PUT -> subject.save
  --       update branch). This is the write Audrey loses today. ────────────
  UPDATE public.otter_subjects
     SET sections = jsonb_set(sections, '{0,lessons,0,content}', to_jsonb(c_right))
   WHERE course_id = v_course AND slug = 'rendering';

  GET DIAGNOSTICS v_found = ROW_COUNT;
  -- 0 rows means RLS refused. The adapter turns that into a 403 (:266); the
  -- UI currently turns it into a green tick, which is the defect this session
  -- fixes on the client. Here it must simply be 1.
  IF v_found <> 1 THEN
    RAISE EXCEPTION 'FAILED at 5: the corrected lesson updated % rows, expected 1', v_found;
  END IF;
  INSERT INTO probe_log VALUES (5, 'validator fix accepted by the database', '1 row updated');

  -- ── 6. The correction SURVIVES the round trip ───────────────────────────
  -- The assertion that matters: a write that "succeeds" and stores the old
  -- text is the exact failure the user reports as "my fix did not save".
  SELECT s.sections->0->'lessons'->0->>'content' INTO v_content
    FROM public.otter_subjects s
   WHERE s.course_id = v_course AND s.slug = 'rendering';

  IF v_content IS DISTINCT FROM c_right THEN
    RAISE EXCEPTION 'FAILED at 6: after the fix the lesson still reads [%]', v_content;
  END IF;
  INSERT INTO probe_log VALUES (6, 'corrected text persisted', left(v_content, 45) || '...');
END
$probe$;

RESET ROLE;

-- The verdict. `steps` MUST be 6 — a DO block that aborted early leaves fewer
-- rows, and one that never ran leaves none.
SELECT
  (SELECT count(*)::int FROM probe_log)                                 AS steps,
  (SELECT count(*)::int = 6 FROM probe_log)                             AS passed,
  (SELECT string_agg(n || '. ' || step || ' (' || detail || ')', E'\n' ORDER BY n)
     FROM probe_log)                                                    AS trace;

ROLLBACK;
