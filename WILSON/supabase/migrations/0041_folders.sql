-- =========================================================================
-- 0041_folders.sql — Session 26.
--
-- The backend-agnostic folder tree, plus the half of the `projects` drift
-- this session actually consumes.
--
-- Idempotent: safe to re-run.
-- ORDERING: depends on 0004 (fn_populate_workspace_from_project,
--           touch_updated_at), 0013 (can_write_project, has_active_membership)
--           and 0040 (scenes/shots/levels/experiences, which the entity FKs
--           point at). Nothing depends on this one yet — S27 will.
--
-- WHY A TABLE AND NOT A PATH CONVENTION
-- --------------------------------------
-- DECIDED by Audrey, 2026-08-04, and not to be re-opened. Supabase Storage
-- has no real folders — it is object storage with path prefixes, so an EMPTY
-- folder cannot exist at all. Audrey's requirement is that toggling a
-- category off "should only remove it from the R.A.B.B.I.T. view and never
-- delete the folders", which needs a folder that outlives its contents.
--
-- So the table records the tree and the storage path is DERIVED from it. The
-- same rows describe the same tree on Local Server (real directories),
-- Supabase (path prefixes) and Drive (read-only), which is what makes a
-- backend switch not lose the structure.
--
-- MEASURED 2026-08-04 against wilson-dev: `public.folders` does not exist;
-- `public.projects` has 48 columns and none of folder_slug / folder_root /
-- files_dir; the only folder creation anywhere in the app is
-- electron/main.cjs:838 `ensureProjectFolders`, which is fs.mkdirSync against
-- local disk and therefore desktop + Local-Server only.
--
--
-- 🚨 WHY `files_dir` IS NOT HERE, THOUGH BOTH PLAN DOCUMENTS ASK FOR IT
-- ---------------------------------------------------------------------
-- MASTER_PLAN_S19_ONWARD.md:413 and SESSION_26_prompt.md both say S26 adds
-- `folder_slug`, `folder_root` AND `files_dir`, citing the relink reset at
-- ProjectSummaryView.jsx:1010 (`update?.('files_dir', null)`) as the writer.
-- That citation is real. The write is also UNREACHABLE on this backend, and
-- the difference is the whole point:
--
--   * The button lives inside `{project?.files_dir && ( … )}`
--     (ProjectSummaryView.jsx:999). It renders only when the column is
--     already NON-NULL, and all it ever writes is NULL.
--   * The only thing that ever sets a non-null value is the local Express
--     relink route (electron/main.cjs:1615).
--   * `relinkScan` / `relinkApply` are local_server ONLY — MEASURED, zero
--     occurrences in supabaseAdapter.js and googleDriveAdapter.js, and
--     adapters/index.js:121 says so in the contract itself.
--
-- So on Supabase the value can never become non-null, the block can never
-- render, and the write can never fire. A `files_dir` column here would be
-- written by nothing — the same shape as `task_template_id`, which S23
-- deliberately left out for exactly this reason ("a column for a feature with
-- no cloud implementation is schema debt").
--
-- This is NOT the `code` case and must not be recorded as one. `code` was a
-- wrong NAME that must never exist, and 0040's suite asserts its absence.
-- `files_dir` is the RIGHT name for a feature that has not been built here
-- yet: when relink comes to cloud, that session adds the column alongside it.
-- No probe asserts its absence, because absence is not the invariant —
-- "arrives with its feature" is.
--
-- The two columns below are different, and were checked the same way:
--   * `folder_root` HAS a reachable writer today — ProjectSummaryView.jsx:401
--     and :987, both `updateProject`. They need window.electronAPI.pickDirectory,
--     which exists in Electron REGARDLESS of the selected backend (the same
--     fact RabbitProvider.jsx:1985 already records about FileManager). The
--     desktop app in cloud mode reaches them today and the value is dropped
--     with a console warning.
--   * `folder_slug` is written by THIS session's ensureProjectFolders. It is
--     the tree's anchor, and it is what makes "rename the project, keep the
--     folder" possible at all.
-- =========================================================================


-- ── 1. The `projects` drift this session consumes ────────────────────────

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS folder_slug TEXT,
  ADD COLUMN IF NOT EXISTS folder_root TEXT;

COMMENT ON COLUMN public.projects.folder_slug IS
  'The project folder''s name — one path segment, produced by fileSlugify. Persisted rather than derived from title so that renaming a project does NOT move its folder: the label changes, the slug stays. Mirrored by folders.slug on the kind=''root'' row.';
COMMENT ON COLUMN public.projects.folder_root IS
  'Desktop-only: the absolute directory the project folder lives in, chosen with the OS picker (ProjectSummaryView.jsx:401, :987). NULL in the web build, where the tree resolves against the rabbit-files bucket instead. Written from Electron in EITHER backend, which is why the cloud table needs it.';


-- ── 2. folders ───────────────────────────────────────────────────────────
--
-- One row per folder. Four kinds:
--
--   root      the project folder itself. parent_id IS NULL, path = ''.
--   category  a top-level bucket: ASSETS, SCENES, SHOTS, LEVELS,
--             EXPERIENCES, INVOICES, FILES.
--   entity    one asset / scene / shot / level / experience's own folder.
--             Audrey: five scenes means FIVE folders under SCENES/, not one
--             shared one.
--   custom    a user-made folder. Nothing creates one yet — S27 — but the
--             kind exists so adding it later is not a CHECK-constraint
--             migration on a live table.
--
-- `path` is relative to the project folder, so it is the SAME string on every
-- backend:
--     disk      <projects.folder_root>/<path>
--     supabase  projects/<project_id>/<path>   (rabbit-files bucket)
-- The root row's own slug is deliberately NOT part of `path`, because the
-- root is where `path` is measured from.
--
-- 🚨 `path` IS COMPUTED CLIENT-SIDE AND STORED, NOT GENERATED IN POSTGRES.
-- This follows S25's naming decision exactly, and for the same stated reason
-- (entityNaming.js:20-26): the same project must produce the same folder on
-- Supabase and on Local Server, and Local Server is a JSON bundle with no
-- Postgres in it. A generated column here would be a second implementation
-- that only one of the two backends could ever run.

CREATE TABLE IF NOT EXISTS public.folders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES public.projects(id)   ON DELETE CASCADE,
  workspace_id   UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  parent_id      UUID REFERENCES public.folders(id) ON DELETE CASCADE,

  kind           TEXT NOT NULL,
  entity_type    TEXT,

  -- Five nullable FKs rather than a polymorphic (entity_type, entity_id)
  -- pair. A polymorphic id cannot be an FK, so nothing would stop a folder
  -- pointing at a scene that no longer exists, and deleting a scene would
  -- leave its folder row behind forever. These cascade, which is the same
  -- choice 0040 made for shots.scene_id: the database does it atomically
  -- instead of a client-side loop that can half-fail.
  --
  -- NOTE this cascade has nothing to do with the toggles. Turning
  -- scenes_enabled off does not delete a scene, so it cannot reach these —
  -- pinned by probe 17 in the suite, because "never delete the folders" is
  -- the requirement the whole design exists to satisfy.
  asset_id       UUID REFERENCES public.assets(id)       ON DELETE CASCADE,
  scene_id       UUID REFERENCES public.scenes(id)       ON DELETE CASCADE,
  shot_id        UUID REFERENCES public.shots(id)        ON DELETE CASCADE,
  level_id       UUID REFERENCES public.levels(id)       ON DELETE CASCADE,
  experience_id  UUID REFERENCES public.experiences(id)  ON DELETE CASCADE,

  slug           TEXT NOT NULL,
  label          TEXT,
  path           TEXT NOT NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID,

  CONSTRAINT folders_kind_chk CHECK (
    kind IN ('root', 'category', 'entity', 'custom')
  ),

  CONSTRAINT folders_entity_type_values_chk CHECK (
    entity_type IS NULL OR entity_type IN (
      'asset', 'scene', 'shot', 'level', 'experience', 'invoice', 'file')
  ),

  -- Exactly one entity FK on an entity folder, none on any other kind.
  CONSTRAINT folders_entity_link_chk CHECK (
    (CASE WHEN asset_id      IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN scene_id      IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN shot_id       IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN level_id      IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN experience_id IS NOT NULL THEN 1 ELSE 0 END)
    = CASE WHEN kind = 'entity' THEN 1 ELSE 0 END
  ),

  -- …and entity_type must name the one that is set, so a query can filter on
  -- entity_type alone without checking five columns and being wrong.
  CONSTRAINT folders_entity_type_agrees_chk CHECK (
    kind <> 'entity' OR (
         (entity_type = 'asset'      AND asset_id      IS NOT NULL)
      OR (entity_type = 'scene'      AND scene_id      IS NOT NULL)
      OR (entity_type = 'shot'       AND shot_id       IS NOT NULL)
      OR (entity_type = 'level'      AND level_id      IS NOT NULL)
      OR (entity_type = 'experience' AND experience_id IS NOT NULL)
    )
  ),

  -- The root is the only folder without a parent, and the only one whose
  -- path is empty.
  CONSTRAINT folders_root_shape_chk CHECK (
    (kind = 'root') = (parent_id IS NULL)
  ),
  CONSTRAINT folders_root_path_chk CHECK (
    (kind = 'root') = (path = '')
  ),

  CONSTRAINT folders_slug_nonempty_chk CHECK (slug <> ''),

  -- Containment. `path` is concatenated onto a filesystem root or a storage
  -- prefix, so a traversal segment here is a write outside the project.
  -- S17 (#45 family) had to retro-fit resolveContainedFilePath for the same
  -- class of hazard on a client-writable slug; this refuses it at the door.
  CONSTRAINT folders_path_shape_chk CHECK (
    path !~ '(^/|/$|//|\.\.|\\)'
  ),
  CONSTRAINT folders_slug_shape_chk CHECK (
    slug !~ '(/|\.\.|\\)'
  )
);

-- 🚨 THE ANTI-DOUBLE-FOLDER GUARANTEE.
-- The named hazard of this whole session is one entity ending up with two
-- folders because two copies of fileSlugify disagreed. Both of these make
-- that a constraint violation rather than a silent duplicate:
CREATE UNIQUE INDEX IF NOT EXISTS folders_project_path_uniq
  ON public.folders (project_id, path);

CREATE UNIQUE INDEX IF NOT EXISTS folders_asset_uniq
  ON public.folders (asset_id)      WHERE asset_id      IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS folders_scene_uniq
  ON public.folders (scene_id)      WHERE scene_id      IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS folders_shot_uniq
  ON public.folders (shot_id)       WHERE shot_id       IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS folders_level_uniq
  ON public.folders (level_id)      WHERE level_id      IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS folders_experience_uniq
  ON public.folders (experience_id) WHERE experience_id IS NOT NULL;

-- ONE ROOT PER PROJECT needs no index of its own, and this is worth stating
-- because a `(project_id) WHERE kind='root'` index looks obviously right.
-- It was written, and MEASURED to be dead: folders_root_path_chk makes
-- path='' true for roots and ONLY for roots, so folders_project_path_uniq
-- already refuses the second root and does so first. The extra index would
-- never fire — a constraint that reads like a guard while doing no work is
-- worse than none, because the next reader believes it. Suite probe 19
-- asserts the behaviour rather than the index name for the same reason.

CREATE INDEX IF NOT EXISTS folders_project_idx ON public.folders (project_id);
CREATE INDEX IF NOT EXISTS folders_parent_idx  ON public.folders (parent_id);

COMMENT ON TABLE public.folders IS
  'The project folder tree, independent of storage backend. The table is the source of truth (Audrey, 2026-08-04); the storage path is derived from it. Supabase Storage has no real folders, so an empty folder can only exist as a row — which is what makes "toggling a category off never deletes the folders" possible.';
COMMENT ON COLUMN public.folders.path IS
  'Path RELATIVE to the project folder — '''' for the root, ''SCENES'' for the category, ''SCENES/Wlsn-Sc001'' for a scene. Identical on every backend: disk resolves it against projects.folder_root, Supabase against projects/<project_id>/ in rabbit-files. Computed client-side by folderPaths.js, never in Postgres, for the reason entityNaming.js:20-26 gives about adapter parity.';
COMMENT ON COLUMN public.folders.slug IS
  'This folder''s own path segment. On a root row it mirrors projects.folder_slug and is NOT part of `path`, because the root is where `path` is measured from.';
COMMENT ON COLUMN public.folders.label IS
  'Display name. Deliberately allowed to drift from `slug`: a folders table makes "rename the thing, keep the folder where it is" possible, which a filesystem-only design could not do. NULL means "show the slug".';
COMMENT ON COLUMN public.folders.kind IS
  'root | category | entity | custom. `custom` is unused until S27 and exists now so adding user folders later is not a CHECK migration on a live table.';


-- ── 3. Workspace stamping and updated_at ─────────────────────────────────
--
-- workspace_id is NOT NULL and no client sends it. Reuse 0004's trigger: it
-- is LANGUAGE plpgsql and NOT SECURITY DEFINER, which is the precondition for
-- FORCE ROW LEVEL SECURITY below.

DROP TRIGGER IF EXISTS trg_folders_populate_workspace ON public.folders;
CREATE TRIGGER trg_folders_populate_workspace
  BEFORE INSERT ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_from_project();

DROP TRIGGER IF EXISTS trg_folders_touch ON public.folders;
CREATE TRIGGER trg_folders_touch
  BEFORE UPDATE ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ── 4. RLS ───────────────────────────────────────────────────────────────
--
-- Folders are ORDINARY PROJECT CONTENT, so they use can_write_project (0013),
-- NOT can_access_project_money — the same call 0040 made for scenes, and for
-- the same reason: a team member has to be able to create an asset, and an
-- asset that cannot get a folder is not created properly.
--
-- Note what this means for INVOICES: the folder ROW is visible to any project
-- reader, because a folder is a name, not a payment. The invoice FILES inside
-- it stay manager-only, gated twice by 0038/0039 — files.is_financial on the
-- row and the reserved INVOICES path segment on the blob. Making the folder
-- row manager-only as well would hide the tree's shape from the people
-- entitled to see it, and would protect nothing that is not already protected.
--
-- Four separate policies, never FOR ALL: a broad FOR ALL arm ORs with every
-- narrow arm beside it and silently wins (0029; it cost S15 a CRITICAL).
--
-- SELECT hops to the live PROJECT (the 0014 shape), so a soft-deleted project
-- hides its folders. UPDATE carries USING and WITH CHECK with the same
-- predicate, or a row could be repointed at a project the caller cannot write.

ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folders FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS folders_select ON public.folders;
CREATE POLICY folders_select ON public.folders
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = folders.project_id)
  );

DROP POLICY IF EXISTS folders_insert ON public.folders;
CREATE POLICY folders_insert ON public.folders
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  );

DROP POLICY IF EXISTS folders_update ON public.folders;
CREATE POLICY folders_update ON public.folders
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.can_write_project(project_id)
  );

DROP POLICY IF EXISTS folders_delete ON public.folders;
CREATE POLICY folders_delete ON public.folders
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  );


-- ── 5. Privileges ────────────────────────────────────────────────────────
--
-- 0033 disarmed 0011's ALTER DEFAULT PRIVILEGES, so a table created after it
-- is not born exposed — but asserting the revoke costs nothing and the suite
-- carries the standing probe either way. A policy-only check passes happily
-- while a privilege hole is wide open (S21 found 25 such tables).
--
-- PUBLIC is named as well as anon: an object can carry a bare =X/postgres
-- aclitem, so naming only anon can be a silent no-op that reports success
-- (the S22 grantee lesson).

REVOKE ALL ON public.folders FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.folders TO authenticated;
GRANT ALL ON public.folders TO service_role;
