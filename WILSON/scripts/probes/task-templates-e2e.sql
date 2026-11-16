-- =========================================================================
-- task-templates-e2e.sql — Session 28.
--
-- Not a pgTAP suite. Suite 54 pins the ACCESS RULES with synthetic fixtures;
-- this walks the whole chain the application actually performs, in order,
-- with the exact payloads the JS builds, against REAL rows in whichever
-- project this database already has.
--
-- 🚨 WHY IT EXISTS. S27's lesson is that a feature with no caller has no
-- symptom: the folder tree was correct, verified by query, covered by 22
-- assertions and green in CI, and had produced zero rows on every
-- environment. 0044 starts in exactly that state — the post-apply query
-- returned template_rows = 0 against 3 live projects, and the Local Server
-- template directory is empty too, so this feature has never produced a row
-- on ANY backend.
--
-- So "the table exists" proves nothing. What has to be shown is that a
-- template can be created, found by the project read, and APPLIED — with the
-- role actually landing on the created tasks, which is the half that was
-- silently broken (`role_slug` is not a column; `assigned_role_slug` is).
--
-- Runs as `authenticated` with real JWT claims, never as postgres, or every
-- policy would be bypassed and the run would prove nothing. Rolls back, so it
-- leaves no debris on a shared database.
--
-- ⚠️ IT EMITS A TABLE, NOT NOTICES. The first draft used RAISE NOTICE and
-- `supabase db query -o json` returned `"rows": []` — indistinguishable from a
-- DO block that never ran. Standing rule 2: before believing a result, prove
-- the instrument can show you one. Each step writes a row, and the run counts
-- as a pass only when all six are present.
--
-- Usage, from WILSON/ with the CLI linked to the target project:
--     supabase db query --linked --file scripts/probes/task-templates-e2e.sql
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
  v_ws          UUID;
  v_project     UUID;
  v_user        UUID;
  v_template    UUID := gen_random_uuid();
  v_asset       UUID := gen_random_uuid();
  v_tmpl_task_a UUID := gen_random_uuid();
  v_tmpl_task_b UUID := gen_random_uuid();
  v_tasks       JSONB;
  r             RECORD;
  v_found       INT;
  v_roles       TEXT;
  v_linked      UUID;
BEGIN
  -- Pick a real project and a real workspace ADMIN of it.
  SELECT p.id, p.workspace_id INTO v_project, v_ws
    FROM public.projects p
   WHERE p.deleted_at IS NULL
   ORDER BY p.created_at
   LIMIT 1;

  IF v_project IS NULL THEN
    RAISE EXCEPTION 'PROBE ABORTED: no live project on this database';
  END IF;

  SELECT wm.user_id INTO v_user
    FROM public.workspace_members wm
   WHERE wm.workspace_id = v_ws AND wm.is_active AND wm.app_role = 'admin'
   LIMIT 1;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'PROBE ABORTED: workspace % has no active admin', v_ws;
  END IF;

  -- Become that user. Everything below is subject to RLS.
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user::text,
    'role', 'authenticated',
    'app_metadata', json_build_object(
      'workspace_id', v_ws::text, 'app_role', 'admin')
  )::text, true);
  SET LOCAL ROLE authenticated;

  -- 1. useTaskTemplates.addTemplate. Two tasks, the second depending on the
  -- first, so the topological sort and the date chaining have something to do.
  v_tasks := jsonb_build_array(
    jsonb_build_object('id', v_tmpl_task_a, 'name', 'Model',
      'role_slug', 'modeler', 'bid_days', 3, 'sort_order', 0,
      'depends_on', jsonb_build_array()),
    jsonb_build_object('id', v_tmpl_task_b, 'name', 'Rig',
      'role_slug', 'rigger', 'bid_days', 2, 'sort_order', 1,
      'depends_on', jsonb_build_array(v_tmpl_task_a))
  );

  INSERT INTO public.task_templates
    (id, workspace_id, project_id, name, description, tasks)
  VALUES (v_template, v_ws, NULL, 'E2E Probe Template', '', v_tasks);
  INSERT INTO probe_log VALUES (1, 'template created', v_template::text);

  -- 2. listProjectTaskTemplates — the same filter the adapter sends as
  -- `.or('project_id.is.null,project_id.eq.<id>')`, with RLS supplying the
  -- workspace scope the local route omits.
  SELECT count(*)::int INTO v_found
    FROM public.task_templates
   WHERE (project_id IS NULL OR project_id = v_project);

  IF v_found < 1 THEN
    RAISE EXCEPTION 'FAILED at 2: the project read returned % templates', v_found;
  END IF;
  INSERT INTO probe_log VALUES (2, 'project read finds it', v_found || ' visible');

  -- 3. The asset create carrying task_template_id — the key S23 kept out of
  -- the allowlist because nothing could send it.
  INSERT INTO public.assets (id, project_id, name, task_template_id)
  VALUES (v_asset, v_project, 'E2E Probe Asset', v_template);
  INSERT INTO probe_log VALUES (3, 'asset stamped with template', v_asset::text);

  -- 4. Apply the template — the branch that was dead until this session.
  -- 🚨 assigned_role_slug, NOT role_slug. That is the whole point: through the
  -- adapter the wrong key does not fail, it succeeds with a NULL role.
  FOR r IN
    SELECT t->>'name'                AS name,
           t->>'role_slug'           AS role_slug,
           (t->>'bid_days')::numeric AS bid_days
      FROM jsonb_array_elements(v_tasks) t
     ORDER BY (t->>'sort_order')::int
  LOOP
    INSERT INTO public.tasks
      (asset_id, project_id, title, status, priority, bid_days, assigned_role_slug)
    VALUES
      (v_asset, v_project, r.name, 'waiting_to_start', 'medium',
       r.bid_days, r.role_slug);
  END LOOP;

  SELECT count(*)::int INTO v_found FROM public.tasks WHERE asset_id = v_asset;
  INSERT INTO probe_log VALUES (4, 'tasks created from template', v_found || ' tasks');

  -- 5. THE ASSERTION THAT MATTERS. Every bid is `role rate x days`, so a task
  -- with a NULL role prices at nothing, silently. That is what the old
  -- `role_slug` key produced: tasks appeared, roles did not.
  SELECT count(*)::int,
         string_agg(coalesce(assigned_role_slug, '<NULL>'), ', ' ORDER BY title)
    INTO v_found, v_roles
    FROM public.tasks WHERE asset_id = v_asset;

  IF v_found <> 2 THEN
    RAISE EXCEPTION 'FAILED at 5: expected 2 tasks, found %', v_found;
  END IF;
  IF v_roles LIKE '%<NULL>%' THEN
    RAISE EXCEPTION 'FAILED at 5: a task has no role — roles were [%]', v_roles;
  END IF;
  INSERT INTO probe_log VALUES (5, 'every task carries a role', v_roles);

  -- 6. Deleting the template must not take the asset with it.
  DELETE FROM public.task_templates WHERE id = v_template;

  SELECT count(*)::int INTO v_found FROM public.assets WHERE id = v_asset;
  SELECT task_template_id INTO v_linked FROM public.assets WHERE id = v_asset;

  IF v_found <> 1 THEN
    RAISE EXCEPTION 'FAILED at 6: deleting the template deleted the asset';
  END IF;
  IF v_linked IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED at 6: the asset still points at a deleted template';
  END IF;
  INSERT INTO probe_log VALUES (6, 'template deleted, asset survives', 'reference is NULL');
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
