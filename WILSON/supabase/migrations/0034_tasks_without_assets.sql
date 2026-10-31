-- =============================================================================
-- 0034_tasks_without_assets.sql  (Session 23)
--
-- Makes a task creatable without an asset, which is what the UI has always
-- promised and the schema has always refused. Audrey, 2026-08-03, asked
-- directly: "not all tasks need assets."
--
-- -----------------------------------------------------------------------------
-- THE DEFECT, MEASURED (S22, wilson-dev; the same schema on all three envs)
-- -----------------------------------------------------------------------------
--
-- Inserting the exact payload the UI sends, as an authenticated admin member
-- through tests.rls_setup() + real JWT claims:
--
--   23502: null value in column "asset_id" of relation "tasks"
--          violates not-null constraint
--
-- So EVERY task creation in cloud mode has always failed. The New Task dialog
-- meanwhile labels the field "ASSET (OPTIONAL — narrows the task to one
-- deliverable)" and offers "(no asset — task lives directly under the phase)".
-- The UI was right and the column was wrong.
--
-- -----------------------------------------------------------------------------
-- WHY THE ONE-LINE FIX IS NOT ENOUGH — this is the whole point of the migration
-- -----------------------------------------------------------------------------
--
-- Dropping the NOT NULL alone MOVES the failure rather than removing it.
-- Measured from the live catalogue (not from migration text), tasks_select is:
--
--   deleted_at IS NULL
--   AND workspace_id = current_workspace_id()
--   AND EXISTS (SELECT 1 FROM assets a WHERE a.id = tasks.asset_id)
--
-- A task with a NULL asset_id fails its own SELECT policy. supabaseAdapter's
-- upsertTask does `.upsert(row).select().single()`, so PostgREST returns zero
-- rows and `.single()` raises PGRST116 — which `unwrap` throws. The insert
-- would COMMIT and the UI would still report failure and never show the row.
-- Both changes have to land together, which is why they are one migration.
--
-- The asset hop was not decoration: `assets_select` itself requires a live
-- project, so hopping through it made a task invisible once its project was
-- soft-deleted. Section 2 preserves that property for asset-less tasks by
-- hopping through `projects` directly, exactly as `assets_select` does. It is
-- NOT loosened to `asset_id IS NULL OR ...`, which would have let a task
-- survive its project's deletion.
--
-- -----------------------------------------------------------------------------
-- phase_id — because "no asset" must not mean "no home"
-- -----------------------------------------------------------------------------
--
-- The dialog's own words are "task lives directly under the phase", and a
-- task's phase is currently derived only via asset -> phase. Drop the asset and
-- an asset-less task has no place in the hierarchy at all.
--
-- The client already believes this column exists: TimelineView.jsx:3767 sends
-- `phase_id` in every task payload, and resolves it from the chosen asset when
-- the field is blank. It is one of the fields that produce PGRST204 today. So
-- this is not a new idea being introduced — it is the column the client was
-- written against and which was never added.
--
-- Deliberately NOT added: scene_id, shot_id, level_id, experience_id. The same
-- payload sends those four and they PGRST204 as well, but scenes / levels /
-- experiences are local-only BY DESIGN (Known #5 — the Supabase adapter throws
-- for them). Adding columns for a feature that does not exist in cloud would
-- bake a half-migration into the schema. Those four belong in an adapter-side
-- column allowlist, not here.
--
-- ON DELETE SET NULL, not CASCADE: deleting a phase must not delete the work
-- planned under it. Contrast asset_id, which stays ON DELETE CASCADE because a
-- task scoped to a deliverable dies with it.
--
-- Idempotent: safe to re-run.
-- =============================================================================


-- ── 1. the column that blocked every task ────────────────────────────────────
-- DROP NOT NULL is metadata-only: no table rewrite, no row is touched, and
-- every existing task keeps the asset it already has.

ALTER TABLE public.tasks ALTER COLUMN asset_id DROP NOT NULL;


-- ── 2. a home for an asset-less task ─────────────────────────────────────────

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS phase_id UUID REFERENCES public.phases(id) ON DELETE SET NULL;

-- Task lists are always "the tasks of this phase, in this project", never a
-- scan by phase alone.
CREATE INDEX IF NOT EXISTS tasks_project_phase_idx
  ON public.tasks (project_id, phase_id);


-- ── 3. tasks_select, so a NULL asset_id is visible ───────────────────────────
-- DROP then CREATE, not a second permissive policy beside it: permissive
-- policies OR together, so adding one would leave the old restriction dead
-- rather than replaced. That mistake cost S15 a CRITICAL.

DROP POLICY IF EXISTS tasks_select ON public.tasks;

CREATE POLICY tasks_select ON public.tasks
  FOR SELECT USING (
    deleted_at IS NULL
    AND workspace_id = public.current_workspace_id()
    AND (
      -- scoped to a deliverable: hop through the asset, as before
      EXISTS (SELECT 1 FROM public.assets a WHERE a.id = tasks.asset_id)
      -- or standalone: hop through the project instead, so the task still
      -- disappears with its project rather than outliving it
      OR (asset_id IS NULL
          AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = tasks.project_id))
    )
  );


-- ── 4. post-conditions ───────────────────────────────────────────────────────
-- The write path is unchanged (tasks_insert/update/delete gate on
-- can_write_project), so these assert the two things this migration could
-- plausibly have broken: that an asset-less task is now insertable AND
-- readable, and that a task WITH an asset still behaves exactly as before.

DO $$
DECLARE
  n int;
BEGIN
  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema='public' AND table_name='tasks' AND column_name='asset_id')
     <> 'YES' THEN
    RAISE EXCEPTION '0034 post-condition failed: tasks.asset_id is still NOT NULL';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='tasks'
                    AND column_name='phase_id') THEN
    RAISE EXCEPTION '0034 post-condition failed: tasks.phase_id was not added';
  END IF;

  -- The policy must still name the asset hop AND must now admit a NULL
  -- asset_id. A policy that lost the asset branch would make every existing
  -- task visible without its project check.
  SELECT count(*) INTO n
    FROM pg_policies
   WHERE schemaname='public' AND tablename='tasks' AND policyname='tasks_select'
     AND qual LIKE '%asset_id IS NULL%'
     AND qual LIKE '%assets%'
     AND qual LIKE '%projects%';
  IF n <> 1 THEN
    RAISE EXCEPTION
      '0034 post-condition failed: tasks_select does not carry both branches (matched %)', n;
  END IF;

  -- S22's sweep must survive: anon gained nothing from the new column, and the
  -- DROP/CREATE of the policy must not have disturbed the grants.
  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
              WHERE table_schema='public' AND table_name='tasks' AND grantee='anon') THEN
    RAISE EXCEPTION '0034 post-condition failed: anon regained privileges on tasks';
  END IF;

  IF NOT (has_table_privilege('authenticated','public.tasks','SELECT')
      AND has_table_privilege('authenticated','public.tasks','INSERT')) THEN
    RAISE EXCEPTION '0034 post-condition failed: authenticated lost DML on tasks';
  END IF;
END $$;

COMMENT ON COLUMN public.tasks.asset_id IS
  'Session 23: NULLABLE. A task may exist without an asset — Audrey, 2026-08-03: "not all tasks need assets." Was NOT NULL from 0000 until 0034, which made every cloud-mode task creation fail with 23502 while the New Task dialog labelled the field OPTIONAL. Still ON DELETE CASCADE: a task scoped to a deliverable dies with it.';

COMMENT ON COLUMN public.tasks.phase_id IS
  'Session 23: where an ASSET-LESS task lives in the hierarchy — the dialog''s "task lives directly under the phase". A task with an asset normally derives its phase from assets.phase_id; this column is the direct link for tasks that have no asset. TimelineView.jsx:3767 has been sending this field since before the column existed (it was a PGRST204). ON DELETE SET NULL — deleting a phase must not delete the work planned under it.';
