-- =========================================================================
-- 0043_files_entity_and_folder_links.sql — Session 27.
--
-- `files` learns where it is FILED and what it is ABOUT.
--
-- Idempotent: safe to re-run.
--
-- 🚨 ORDERING: 0040 -> 0041 -> 0043. The four entity FKs point at 0040's
-- tables and folder_id points at 0041's. Replay forwards only.
--
--
-- WHAT WAS MEASURED (wilson-dev, 2026-08-04)
-- -------------------------------------------
-- public.files has 24 columns and exactly three entity links: phase_id,
-- asset_id, task_id. There is no scene_id, shot_id, level_id, experience_id
-- or folder_id.
--
-- Meanwhile FileManager.jsx:84 has computed
--   parentType = sceneId ? 'SCENES' : shotId ? 'SHOTS' : 'ASSETS'
-- since long before any of this, filters on `f.scene_id === sceneId` and
-- `f.shot_id === shotId` (:88-92), and passes scene_id/shot_id straight into
-- addManagedFile (:134-145). Those filters have always run against
-- `managedFiles` — a local_server-ONLY store held as loose JSON, where an
-- unknown key is simply a key. In cloud the array is always empty, so the
-- filter matched nothing and nobody saw a failure.
--
--
-- 🚨 WHY THIS IS NOT THE `files_dir` MISTAKE
-- -------------------------------------------
-- S26 was told to add projects.files_dir, WITH a correct citation to a real
-- writer, and the right answer was still to add nothing — because that writer
-- (the local relink route) cannot run on the backend the column would live
-- on, so the value could never become non-null.
--
-- The test is therefore two questions, not one: who writes this, and CAN that
-- writer run here? Both are answered for all five columns:
--
--   * scene_id / shot_id — FileManager already sends them, and this session
--     routes it through adapter.uploadFile, which runs on BOTH writable
--     backends. The writer exists AND it runs here.
--   * level_id / experience_id — added WITH their writers in the same
--     session, not ahead of them: LevelsView and ExperiencesView get the same
--     FileManager surface. This is the S25 rule about reveal-flags applied to
--     columns — the thing and the thing that fills it ship together.
--   * folder_id — 0041's tree is the organising principle, and the Resources
--     folder view reads files THROUGH it. Written by uploadFile on both
--     backends.
--
-- If any of these had been a column for a feature with no implementation on
-- this backend, the right move would have been to leave it out.
--
--
-- TWO AXES, NOT ONE — and they are deliberately allowed to differ
-- ---------------------------------------------------------------
--   folder_id  = WHERE THE FILE IS FILED. Points into the 0041 tree.
--   entity FKs = WHAT THE FILE IS ABOUT.  Same role phase_id/asset_id/task_id
--                have had since 0000.
--
-- For a file uploaded against an entity the two agree by construction,
-- because supabaseAdapter.uploadFile derives the folder FROM the entity —
-- one writer, so they cannot drift apart on the write path. They are still
-- separate columns because they answer different questions: a reference image
-- can be filed under ASSETS/Hero while being ABOUT a task, and the folder
-- view must show it where it lives while the task panel shows it where it
-- belongs.
--
-- ON DELETE SET NULL throughout, matching phase_id/asset_id/task_id at
-- 0000:224-226 rather than inventing a new convention. Deleting a scene must
-- not delete the file ROW: the blob is still in the bucket, and a row is the
-- only thing that knows where. Losing it strands the object with nothing but
-- the GC orphan scan to find it. The same reasoning covers folder_id, and it
-- is also what Audrey's "toggling a category off must NEVER delete the
-- folders" requires of everything hanging off the tree.
--
-- No exclusivity CHECK. phase_id, asset_id and task_id have always been
-- settable together (a task's file legitimately carries its asset and phase
-- context), and adding a constraint the existing three do not have would
-- refuse rows the current code already writes.
-- =========================================================================

-- ── The columns ──────────────────────────────────────────────────────────

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS scene_id      uuid REFERENCES public.scenes(id)      ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shot_id       uuid REFERENCES public.shots(id)       ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS level_id      uuid REFERENCES public.levels(id)      ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS experience_id uuid REFERENCES public.experiences(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS folder_id     uuid REFERENCES public.folders(id)     ON DELETE SET NULL;

COMMENT ON COLUMN public.files.folder_id IS
  'Where the file is FILED — a row in the 0041 folder tree. Distinct from the entity FKs, which say what the file is ABOUT. ON DELETE SET NULL: removing a folder must never destroy the row that knows where the blob is.';
COMMENT ON COLUMN public.files.scene_id IS
  'What the file is ABOUT, same role as asset_id/task_id since 0000. FileManager.jsx has filtered on this since before the column existed — it was matching against the local_server-only managedFiles store, which is why nothing ever failed in cloud.';

-- Partial indexes: every one of these is overwhelmingly NULL (a file belongs
-- to at most one entity), so indexing the NULLs would be most of the index.
CREATE INDEX IF NOT EXISTS files_scene_idx      ON public.files(scene_id)      WHERE scene_id      IS NOT NULL;
CREATE INDEX IF NOT EXISTS files_shot_idx       ON public.files(shot_id)       WHERE shot_id       IS NOT NULL;
CREATE INDEX IF NOT EXISTS files_level_idx      ON public.files(level_id)      WHERE level_id      IS NOT NULL;
CREATE INDEX IF NOT EXISTS files_experience_idx ON public.files(experience_id) WHERE experience_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS files_folder_idx     ON public.files(folder_id)     WHERE folder_id     IS NOT NULL;

-- ── Post-conditions ──────────────────────────────────────────────────────

DO $$
DECLARE
  n INT;
  bad TEXT;
BEGIN
  -- 1. All five columns landed.
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'files'
     AND column_name IN ('scene_id', 'shot_id', 'level_id', 'experience_id', 'folder_id');
  IF n <> 5 THEN
    RAISE EXCEPTION '0043 post-condition failed: % of 5 new columns exist on files', n;
  END IF;

  -- 2. Every one is a REAL foreign key. A uuid column that merely looks like a
  --    link is how a folder ends up pointing at a scene that no longer exists
  --    (0041's stated reason for five nullable FKs over a polymorphic pair).
  SELECT count(*) INTO n
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
   WHERE c.conrelid = 'public.files'::regclass
     AND c.contype = 'f'
     AND a.attname IN ('scene_id', 'shot_id', 'level_id', 'experience_id', 'folder_id');
  IF n <> 5 THEN
    RAISE EXCEPTION '0043 post-condition failed: % of 5 new columns carry a foreign key', n;
  END IF;

  -- 3. Every one is SET NULL, not CASCADE. A CASCADE here would delete file
  --    rows when a scene is deleted and strand their blobs — checked rather
  --    than trusted, because the two differ by one word in the DDL.
  SELECT string_agg(a.attname, ', ') INTO bad
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
   WHERE c.conrelid = 'public.files'::regclass
     AND c.contype = 'f'
     AND a.attname IN ('scene_id', 'shot_id', 'level_id', 'experience_id', 'folder_id')
     AND c.confdeltype <> 'n';   -- 'n' = SET NULL
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '0043 post-condition failed: these FKs are not ON DELETE SET NULL: %', bad;
  END IF;

  -- 4. The indexes exist.
  SELECT count(*) INTO n FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'files'
     AND indexname IN ('files_scene_idx', 'files_shot_idx', 'files_level_idx',
                       'files_experience_idx', 'files_folder_idx');
  IF n <> 5 THEN
    RAISE EXCEPTION '0043 post-condition failed: % of 5 partial indexes exist', n;
  END IF;

  -- 5. RLS is untouched and still gates the money flag. ADD COLUMN does not
  --    alter policies, but the four files_* policies are what keep an invoice
  --    manager-only and this migration is the one that made files reachable
  --    from three new UI surfaces.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'files'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%can_access_project_money%';
  IF n <> 4 THEN
    RAISE EXCEPTION '0043 post-condition failed: % of 4 files policies carry the money gate', n;
  END IF;

  -- 6. The 0011 privilege trap. ADD COLUMN creates no new object so the table's
  --    existing grants apply — but S21 reasoned exactly that way about 0032 and
  --    was still wrong, because nobody had checked the EXISTING grant state.
  --    Scan, do not reason.
  IF has_table_privilege('anon', 'public.files', 'SELECT')
     OR has_table_privilege('anon', 'public.files', 'INSERT')
     OR has_table_privilege('anon', 'public.files', 'UPDATE')
     OR has_table_privilege('anon', 'public.files', 'DELETE') THEN
    RAISE EXCEPTION '0043 post-condition failed: anon holds a privilege on files';
  END IF;

  RAISE NOTICE '0043 OK: files gained 5 SET NULL links (4 entity + folder), 5 partial indexes, money gate and anon revocation intact.';
END $$;
