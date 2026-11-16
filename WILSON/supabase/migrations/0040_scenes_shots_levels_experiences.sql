-- =========================================================================
-- 0040_scenes_shots_levels_experiences.sql — Session 25.
--
-- The four R.A.B.B.I.T. entity tables the cloud never had, plus the half of
-- the `projects` drift that this session consumes.
--
-- Idempotent: safe to re-run.
-- ORDERING: nothing depends on this one yet. It depends on 0004
--           (fn_populate_workspace_from_project, touch_updated_at), 0013
--           (can_write_project) and 0014 (the live-parent SELECT shape).
--
-- WHY THIS EXISTS
-- ---------------
-- MEASURED 2026-08-04 against wilson-dev: `public.projects` has 31 columns
-- and NONE of the seventeen added below. There is no scenes, shots, levels or
-- experiences table anywhere in the cloud schema — supabaseAdapter.js:1292-1305
-- throws "table not yet created" for all eight write methods, and does not
-- implement the four list methods at all.
--
-- Audrey, explicitly: "it shouldn't only be cloud. it should be able to live
-- in a local server as well." So this is not "make them cloud", it is PARITY.
-- The local Express routes (electron/main.cjs:1305-1308) spread req.body into
-- a JSON bundle with no column check whatsoever, so there is no server-side
-- schema to port from. Every column below was derived from what the React
-- actually reads and writes — ScenesView.jsx, LevelsView.jsx,
-- ExperiencesView.jsx and RabbitProvider.jsx — exactly as 0037 derived the
-- budget columns from the budget views.
--
-- 🚨 THE PLANNING DOCUMENTS NAMED THE WRONG COLUMN, AGAIN.
-- ---------------------------------------------------------
-- MASTER_PLAN_S19_ONWARD.md:512 and SESSION_25_prompt.md both say this
-- session must add `code`, and cite ClientViewTab.jsx:129 reading
-- `project?.code` as the proof.
--
-- `project.code` is NOT a missing column. It is a WRONG READ. MEASURED: the
-- only writer of a project code anywhere in the app is
-- ProjectSummaryView.jsx:605, `update('project_code', v)`, and the auto-naming
-- that consumes it reads `project.project_code`
-- (ScenesView.jsx:345, :359, :2105, :2540). Nothing in src/ or electron/ ever
-- writes a bare `code` key on a project.
--
-- So adding a `code` column would have created a column nothing ever writes,
-- passed review, closed the documented gap, and left the client-facing
-- topsheet still printing "--" forever. This is the third repetition of the
-- S24 lesson (`margin` vs `budget_margin_pct`): a planning document is a claim
-- about the code and it decays like any other claim. The column added here is
-- `project_code`, and ClientViewTab is fixed to read it.
--
-- 🚨 WHY THE THREE _enabled FLAGS ARRIVE WITH THE ENTITIES AND NOT BEFORE.
-- Rabbit.jsx:85-87 hides the Scenes, Levels and Experiences TABS on these
-- flags, and BudgetView.jsx:54-57,183 hides four budget sub-tabs on them.
-- Absent column -> undefined -> falsy -> everything hidden, which is why
-- nobody has ever seen these views in cloud. Adding the flags before the
-- tables would have unhidden views whose every write throws.
-- =========================================================================


-- ── 1. The `projects` drift this session consumes ────────────────────────
--
-- Seventeen columns, every one of them WRITTEN by the Project Control Panel
-- (ProjectSummaryView.jsx:522-841) and dropped on the floor today: the S23
-- allowlist keeps them out of the request, so the panel appears to save and
-- silently discards the field.
--
-- `folder_slug`, `folder_root` and `files_dir` are deliberately NOT here.
-- They belong to the folder-tree session (S26) and Audrey approved splitting
-- the drift so each session adds what it consumes.

ALTER TABLE public.projects
  -- Auto-naming settings. ScenesView.jsx:344-364 builds scene and shot names
  -- as CODE{sep}SC{n} and CODE{sep}SC{n}{sep}SH{n}; these are its inputs, and
  -- the defaults below are the exact fallbacks that code already applies, so
  -- an existing project behaves identically before anyone opens the panel.
  ADD COLUMN IF NOT EXISTS project_code             TEXT,
  ADD COLUMN IF NOT EXISTS scene_separator          TEXT    NOT NULL DEFAULT '_',
  ADD COLUMN IF NOT EXISTS scene_digits             INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS shot_digits              INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS scene_start_number       INTEGER NOT NULL DEFAULT 1,

  -- Timecode. ScenesView.jsx:236 `project?.fps || 24`; every runtime and
  -- frame total on the Scenes view is computed from it. NUMERIC because
  -- 29.97 and 59.94 are offered (ProjectSummaryView.jsx:744).
  ADD COLUMN IF NOT EXISTS fps                      NUMERIC(6,2) NOT NULL DEFAULT 24,

  -- The three module toggles. DEFAULT false is deliberate: it reproduces
  -- today's behaviour exactly (absent -> falsy -> tab hidden), so applying
  -- this migration changes nothing on screen until someone opts in. A
  -- DEFAULT true would have switched three tabs on across every existing
  -- project in all three environments at once.
  ADD COLUMN IF NOT EXISTS scenes_enabled           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS levels_enabled           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS experiences_enabled      BOOLEAN NOT NULL DEFAULT false,

  -- Real-time engine. ProjectSummaryView.jsx:626-630 and :766-770 keep this
  -- and levels_enabled in sync in BOTH directions — each toggle writes the
  -- other — so one existing without the other means every flip half-saves.
  ADD COLUMN IF NOT EXISTS uses_realtime_engine     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS engine_type              TEXT,
  ADD COLUMN IF NOT EXISTS engine_proprietary_name  TEXT,
  ADD COLUMN IF NOT EXISTS engine_version           TEXT,
  ADD COLUMN IF NOT EXISTS engine_project_name      TEXT,
  ADD COLUMN IF NOT EXISTS engine_repo_url          TEXT,

  -- Classification. project_type is not decoration: handleTypeChange
  -- (ProjectSummaryView.jsx:529-540) applies a template that sets the three
  -- toggles above from the chosen type, so without this column choosing a
  -- type flips the toggles and then loses the type that explains why.
  ADD COLUMN IF NOT EXISTS project_type             TEXT,
  ADD COLUMN IF NOT EXISTS project_tier             TEXT;

COMMENT ON COLUMN public.projects.project_code IS
  'The short project code used by scene/shot auto-naming (ScenesView.jsx:345) and printed on the client topsheet. NOTE: ClientViewTab read `project.code` until S25 — there has never been a `code` column and nothing ever wrote one. The writer is ProjectSummaryView.jsx:605.';
COMMENT ON COLUMN public.projects.scene_separator IS
  'Separator between the code and SC/SH segments. Defaults to the same ''_'' the UI already falls back to, so naming is unchanged for existing projects.';
COMMENT ON COLUMN public.projects.fps IS
  'Frames per second, driving every timecode and runtime total on the Scenes view. NUMERIC, not INTEGER: 29.97 and 59.94 are offered.';
COMMENT ON COLUMN public.projects.scenes_enabled IS
  'Shows the Scenes tab (Rabbit.jsx:85) and the By Scene / By Shot budget tabs (BudgetView.jsx:54-55). DEFAULT false reproduces the pre-0040 behaviour — toggling OFF only hides the view, it never deletes scenes.';
COMMENT ON COLUMN public.projects.levels_enabled IS
  'Shows the Levels tab. Kept in sync with uses_realtime_engine in both directions by the control panel.';
COMMENT ON COLUMN public.projects.experiences_enabled IS
  'Shows the Experiences tab and the By Experience budget tab.';
COMMENT ON COLUMN public.projects.project_type IS
  'Drives DEFAULT_PROJECT_TYPE_TEMPLATES, which sets scenes_enabled / levels_enabled / experiences_enabled / uses_realtime_engine when the type changes (ProjectSummaryView.jsx:529-540).';


-- ── 2. scenes ────────────────────────────────────────────────────────────
--
-- Fields derived from ScenesView.jsx: the create payload (:371-376), the
-- detail popup's editors, and every column the table and gallery render.

CREATE TABLE IF NOT EXISTS public.scenes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES public.projects(id)   ON DELETE CASCADE,
  workspace_id     UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  name             TEXT,
  description      TEXT,
  notes            TEXT,
  scene_number     INTEGER,
  status           TEXT NOT NULL DEFAULT 'not_started',
  type             TEXT,
  time_of_day      TEXT,
  thumbnail_image  TEXT,
  start_date       DATE,
  end_date         DATE,
  sort_order       INTEGER NOT NULL DEFAULT 0,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       UUID,

  -- The nine statuses are shared verbatim by all four entities
  -- (ScenesView.jsx:40-43, LevelsView.jsx:33, ExperiencesView.jsx:33).
  -- NULL is admitted because a patch may clear the field; the UI's own
  -- fallback is 'not_started'.
  CONSTRAINT scenes_status_chk CHECK (
    status IS NULL OR status IN (
      'not_started', 'in_progress', 'pending_review', 'needs_revisions',
      'approved', 'final', 'blocked', 'on_hold', 'omitted')
  )
);

-- time_of_day, framing and camera_movement are deliberately UNCONSTRAINED.
-- They are long presentation lists (11, 16 and 22 entries) that will grow,
-- and a CHECK that falls behind the dropdown turns a harmless new option into
-- a write that fails. status and the FKs are the invariants worth enforcing.

CREATE INDEX IF NOT EXISTS scenes_project_idx ON public.scenes (project_id);
CREATE INDEX IF NOT EXISTS scenes_project_number_idx ON public.scenes (project_id, scene_number);

COMMENT ON TABLE public.scenes IS
  'Scenes for a project. Named by the auto-naming system from projects.project_code / scene_separator / scene_digits / scene_start_number. Toggling projects.scenes_enabled off HIDES the view and never deletes a row (Audrey, 2026-08-03).';
COMMENT ON COLUMN public.scenes.thumbnail_image IS
  'A path or URL to the thumbnail, never image bytes — the UI stores whatever its picker returned (ScenesView.jsx:2085).';


-- ── 3. shots ─────────────────────────────────────────────────────────────
--
-- 🚨 scene_id IS NULLABLE, AND shots_select MUST NOT REQUIRE A SCENE.
-- ScenesView.jsx:305 buckets shots with no scene under '__unlinked__' and
-- :576 renders that bucket as "Unlinked shots" — an unparented shot is a real,
-- displayed state. This is the exact trap S23 spent hours on: 0014 gave
-- tasks_select an `EXISTS (SELECT 1 FROM assets ...)` arm, so a task without
-- an asset failed its own SELECT policy and .single() returned PGRST116.
-- Making the column nullable there without fixing the policy would have MOVED
-- the failure rather than removing it. The SELECT policy below therefore hops
-- to the PROJECT, never to the scene.

CREATE TABLE IF NOT EXISTS public.shots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  workspace_id     UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  scene_id         UUID REFERENCES public.scenes(id) ON DELETE CASCADE,

  name             TEXT,
  description      TEXT,
  notes            TEXT,
  shot_number      INTEGER,
  status           TEXT NOT NULL DEFAULT 'not_started',
  type             TEXT,
  time_of_day      TEXT,
  framing          TEXT,
  camera_movement  TEXT,
  frame_count      INTEGER NOT NULL DEFAULT 0,
  thumbnail_image  TEXT,
  start_date       DATE,
  end_date         DATE,
  sort_order       INTEGER NOT NULL DEFAULT 0,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       UUID,

  CONSTRAINT shots_status_chk CHECK (
    status IS NULL OR status IN (
      'not_started', 'in_progress', 'pending_review', 'needs_revisions',
      'approved', 'final', 'blocked', 'on_hold', 'omitted')
  ),
  CONSTRAINT shots_frame_count_nonneg CHECK (frame_count >= 0)
);

CREATE INDEX IF NOT EXISTS shots_project_idx ON public.shots (project_id);
CREATE INDEX IF NOT EXISTS shots_scene_idx   ON public.shots (scene_id);

COMMENT ON TABLE public.shots IS
  'Shots, optionally parented to a scene. scene_id is NULLABLE on purpose: the UI renders unparented shots under "Unlinked shots" (ScenesView.jsx:576). shots_select hops to the PROJECT, not the scene — the tasks_select/asset_id trap from S23.';
COMMENT ON COLUMN public.shots.scene_id IS
  'Owning scene, or NULL for an unlinked shot. ON DELETE CASCADE matches the UI, which deletes a scene''s shots before the scene (ScenesView.jsx:398-402) — the cascade makes that atomic instead of a client-side loop that can half-fail.';
COMMENT ON COLUMN public.shots.frame_count IS
  'Frames in the shot. Scene runtime and every project total are derived from the sum of these against projects.fps (ScenesView.jsx:320).';


-- ── 4. levels ────────────────────────────────────────────────────────────
--
-- Levels and experiences are structurally identical — LevelsView.jsx and
-- ExperiencesView.jsx are line-for-line the same component with different
-- nouns (both create at :1009 with { name, status, description, files }).
-- They are kept as two tables rather than one polymorphic table because they
-- are two separate toggles, two separate tabs, two separate folder roots in
-- S26, and merging them would need a discriminator on every query for no gain.

CREATE TABLE IF NOT EXISTS public.levels (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES public.projects(id)   ON DELETE CASCADE,
  workspace_id     UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  name             TEXT,
  description      TEXT,
  notes            TEXT,
  status           TEXT NOT NULL DEFAULT 'not_started',
  thumbnail_image  TEXT,
  start_date       DATE,
  end_date         DATE,
  sort_order       INTEGER NOT NULL DEFAULT 0,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       UUID,

  CONSTRAINT levels_status_chk CHECK (
    status IS NULL OR status IN (
      'not_started', 'in_progress', 'pending_review', 'needs_revisions',
      'approved', 'final', 'blocked', 'on_hold', 'omitted')
  )
);

CREATE INDEX IF NOT EXISTS levels_project_idx ON public.levels (project_id);

COMMENT ON TABLE public.levels IS
  'Game/realtime levels for a project. Gated by projects.levels_enabled, which the control panel keeps in sync with uses_realtime_engine.';


-- ── 5. experiences ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.experiences (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES public.projects(id)   ON DELETE CASCADE,
  workspace_id     UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  name             TEXT,
  description      TEXT,
  notes            TEXT,
  status           TEXT NOT NULL DEFAULT 'not_started',
  thumbnail_image  TEXT,
  start_date       DATE,
  end_date         DATE,
  sort_order       INTEGER NOT NULL DEFAULT 0,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       UUID,

  CONSTRAINT experiences_status_chk CHECK (
    status IS NULL OR status IN (
      'not_started', 'in_progress', 'pending_review', 'needs_revisions',
      'approved', 'final', 'blocked', 'on_hold', 'omitted')
  )
);

CREATE INDEX IF NOT EXISTS experiences_project_idx ON public.experiences (project_id);

COMMENT ON TABLE public.experiences IS
  'Physical activations, events and immersive experiences (ProjectSummaryView.jsx:832). Structurally identical to levels; separate because they are separate toggles, tabs and folder roots.';


-- ── 6. Workspace stamping and updated_at ─────────────────────────────────
--
-- workspace_id is NOT NULL and no client sends it — RabbitProvider adds only
-- id, project_id and sort_order (RabbitProvider.jsx:1309-1314). Reuse 0004's
-- trigger: it is LANGUAGE plpgsql and NOT SECURITY DEFINER, which is the
-- precondition for FORCE ROW LEVEL SECURITY below.

DROP TRIGGER IF EXISTS trg_scenes_populate_workspace ON public.scenes;
CREATE TRIGGER trg_scenes_populate_workspace
  BEFORE INSERT ON public.scenes
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_from_project();

DROP TRIGGER IF EXISTS trg_shots_populate_workspace ON public.shots;
CREATE TRIGGER trg_shots_populate_workspace
  BEFORE INSERT ON public.shots
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_from_project();

DROP TRIGGER IF EXISTS trg_levels_populate_workspace ON public.levels;
CREATE TRIGGER trg_levels_populate_workspace
  BEFORE INSERT ON public.levels
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_from_project();

DROP TRIGGER IF EXISTS trg_experiences_populate_workspace ON public.experiences;
CREATE TRIGGER trg_experiences_populate_workspace
  BEFORE INSERT ON public.experiences
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_from_project();

DROP TRIGGER IF EXISTS trg_scenes_touch ON public.scenes;
CREATE TRIGGER trg_scenes_touch
  BEFORE UPDATE ON public.scenes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_shots_touch ON public.shots;
CREATE TRIGGER trg_shots_touch
  BEFORE UPDATE ON public.shots
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_levels_touch ON public.levels;
CREATE TRIGGER trg_levels_touch
  BEFORE UPDATE ON public.levels
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_experiences_touch ON public.experiences;
CREATE TRIGGER trg_experiences_touch
  BEFORE UPDATE ON public.experiences
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ── 7. RLS ───────────────────────────────────────────────────────────────
--
-- These are NOT money. They use the ordinary project gate that assets and
-- tasks use (can_write_project, 0013), NOT can_access_project_money — a team
-- member is expected to create and edit scenes and shots. The money gate is
-- deliberately narrower and would lock the whole feature to managers.
--
-- Four separate policies per table, never FOR ALL: a broad FOR ALL arm ORs
-- with every narrow arm beside it and silently wins. That is what 0029 exists
-- to undo and what cost S15 a CRITICAL.
--
-- SELECT hops to the live PROJECT (the 0014 shape), so a soft-deleted project
-- hides its scenes, shots, levels and experiences. There is no deleted_at on
-- these tables: the provider hard-deletes (RabbitProvider.jsx:1344-1357) and
-- so does the local Express route, and inventing soft-delete on one adapter
-- only would break the parity this session exists to establish.
--
-- UPDATE carries USING and WITH CHECK with the same predicate, or a row could
-- be repointed at a project the caller does not control.

ALTER TABLE public.scenes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenes      FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.shots       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shots       FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.levels      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.levels      FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.experiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiences FORCE  ROW LEVEL SECURITY;

-- scenes
DROP POLICY IF EXISTS scenes_select ON public.scenes;
CREATE POLICY scenes_select ON public.scenes
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = scenes.project_id)
  );

DROP POLICY IF EXISTS scenes_insert ON public.scenes;
CREATE POLICY scenes_insert ON public.scenes
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  );

DROP POLICY IF EXISTS scenes_update ON public.scenes;
CREATE POLICY scenes_update ON public.scenes
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.can_write_project(project_id)
  );

DROP POLICY IF EXISTS scenes_delete ON public.scenes;
CREATE POLICY scenes_delete ON public.scenes
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  );

-- shots — note the parent hop is the PROJECT, never the scene.
DROP POLICY IF EXISTS shots_select ON public.shots;
CREATE POLICY shots_select ON public.shots
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = shots.project_id)
  );

DROP POLICY IF EXISTS shots_insert ON public.shots;
CREATE POLICY shots_insert ON public.shots
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  );

DROP POLICY IF EXISTS shots_update ON public.shots;
CREATE POLICY shots_update ON public.shots
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.can_write_project(project_id)
  );

DROP POLICY IF EXISTS shots_delete ON public.shots;
CREATE POLICY shots_delete ON public.shots
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  );

-- levels
DROP POLICY IF EXISTS levels_select ON public.levels;
CREATE POLICY levels_select ON public.levels
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = levels.project_id)
  );

DROP POLICY IF EXISTS levels_insert ON public.levels;
CREATE POLICY levels_insert ON public.levels
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  );

DROP POLICY IF EXISTS levels_update ON public.levels;
CREATE POLICY levels_update ON public.levels
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.can_write_project(project_id)
  );

DROP POLICY IF EXISTS levels_delete ON public.levels;
CREATE POLICY levels_delete ON public.levels
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  );

-- experiences
DROP POLICY IF EXISTS experiences_select ON public.experiences;
CREATE POLICY experiences_select ON public.experiences
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = experiences.project_id)
  );

DROP POLICY IF EXISTS experiences_insert ON public.experiences;
CREATE POLICY experiences_insert ON public.experiences
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  );

DROP POLICY IF EXISTS experiences_update ON public.experiences;
CREATE POLICY experiences_update ON public.experiences
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.can_write_project(project_id)
  );

DROP POLICY IF EXISTS experiences_delete ON public.experiences;
CREATE POLICY experiences_delete ON public.experiences
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_write_project(project_id)
  );


-- ── 8. Privileges ────────────────────────────────────────────────────────
--
-- 🚨 0011 issued a blanket GRANT to anon AND left ALTER DEFAULT PRIVILEGES
-- armed, which is how 25 tables ended up fully readable by anon until 0033.
-- 0033 disarmed the default privileges, so a table created after it is not
-- born exposed — but asserting the revoke costs nothing and the pgTAP suites
-- below carry the standing probe either way. A policy-only check passes
-- happily while a privilege hole is wide open.
--
-- Named PUBLIC as well as anon: functions and tables can carry a bare
-- =X/postgres aclitem, so naming only anon can be a silent no-op that reports
-- success (the S22 grantee lesson).

REVOKE ALL ON public.scenes      FROM PUBLIC, anon;
REVOKE ALL ON public.shots       FROM PUBLIC, anon;
REVOKE ALL ON public.levels      FROM PUBLIC, anon;
REVOKE ALL ON public.experiences FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scenes      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shots       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.levels      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.experiences TO authenticated;

GRANT ALL ON public.scenes      TO service_role;
GRANT ALL ON public.shots       TO service_role;
GRANT ALL ON public.levels      TO service_role;
GRANT ALL ON public.experiences TO service_role;
