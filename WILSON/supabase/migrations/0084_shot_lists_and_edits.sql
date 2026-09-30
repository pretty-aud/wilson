-- =============================================================================
-- 0084_shot_lists_and_edits.sql — post-overhaul bundle S3a (2026-09-30).
--
-- Versioned SHOT LISTS and EDITS for R.A.B.B.I.T.'s scenes and shots, "like
-- the budget's versioning" (Audrey's brief, 2026-09-29), on the shape she
-- ruled in docs/design/POST_OVERHAUL_PLAN.md §0.1 (D1–D22) and the S3a brief
-- (docs/sessions/briefs/po-s3a-shot-lists-schema.md).
--
-- WHAT THIS ADDS
-- --------------
--   1. public.shot_lists       a list = title + integer version (D14), a
--                              summary, a "Save" snapshot, archived_at (D4).
--   2. public.shot_list_items  MEMBERSHIP, not copies (D1 + D3): one row per
--                              (list, scene) or (list, shot) with a position.
--   3. public.edits            an ordered list of items referencing shot ids
--                              (D6), one linear chain per list.
--   4. projects.active_shot_list_id — structural one-active (the 0036/0037
--                              budget_active_version_id shape), GUARDED.
--   5. tasks.scene_id / shot_id and assets.scene_ids / shot_ids (D9).
--   6. budget_versions.shot_list_id + summary.
--   7. can_edit_shot_lists(), the NEW gate that admits reviewers (D8).
--   8. set_active_shot_list / archive_shot_list / archive_edit — SECURITY
--      DEFINER RPCs, manager/admin only (D8) — plus replace_shot_list_items,
--      a SECURITY INVOKER helper that swaps one list's membership atomically.
--   9. The backfill (D11): "Shot list 1 · v1", active, for every project that
--      has scenes or shots, holding every one of them in today's order.
--
-- 🚨 THE CONSEQUENCE THAT MUST REACH EVERY READER (D1 + D3). A scene's or a
-- shot's name, description, notes, status and thumbnail — every column of
-- public.scenes / public.shots — are SHARED by every list that contains it.
-- Only MEMBERSHIP and ORDER are per list (shot_list_items). "New list from the
-- current one" links the same rows; it never copies a scene. Takes and files
-- hang off the shot row and are therefore visible from every list (D22).
--
-- WHO MAY DO WHAT (D8, Audrey 2026-09-29)
-- ---------------------------------------
--   read     anyone who can read the project (the 0040 live-parent hop, which
--            carries 0072's private-project arm through projects_select).
--   write    lists, their membership and edits: project managers, members AND
--            REVIEWERS, plus workspace admins/managers and anyone on an
--            unstaffed project — can_edit_shot_lists(). Reviewers were
--            comment-only everywhere until now; this is the first place a
--            reviewer writes anything. Scenes, shots, tasks and budgets keep
--            can_write_project / the money gate — a reviewer still cannot
--            create a scene (suite 84 proves both halves).
--   activate / archive    workspace admin or project manager ONLY, through the
--            three SECURITY DEFINER RPCs. Two guard triggers make the plain
--            UPDATE policies unable to do either (the 0064 GUC-arm pattern).
--
-- ORDERING — depends on:
--   0001 fn_audit_touch; 0004 fn_populate_workspace_from_project,
--   has_active_membership (as redefined by 0008); 0008 current_app_role;
--   0013 project_role_for, project_is_staffed (and can_write_project, whose
--   shape the new gate mirrors); 0014 the live-parent SELECT shape; 0034 tasks
--   (asset_id nullable, project_id NOT NULL); 0037 budget_versions; 0040
--   scenes / shots; 0044 projects UNIQUE (id, workspace_id), used here for the
--   same composite-FK guarantee; 0072 projects.is_private (the SELECT hop
--   inherits it); 0082 passes_project_privacy(), which the three definer RPCs
--   call — the pre-flight below REFUSES to run without it, so on a target
--   that lacks 0082 this file fails before touching anything.
-- Independent of 0067–0081 and of 0083: it redefines nothing any of them
-- defines (no policy or function of theirs is restated). No existing policy is
-- dropped or restated. Nothing depends on this one yet.
--
-- NOT HERE, ON PURPOSE
--   * Realtime: scenes and shots are not broadcast (0040, Audrey's choice) and
--     neither are these three tables. A project's active_shot_list_id DOES
--     reach other windows, because projects rows are broadcast; a client that
--     has not loaded the named list treats the project as having no active
--     list until it reloads (documented in the S3a hand-off).
--   * Edit history (0012): scenes and shots are not captured; neither are
--     these. S3c's draft edit lives in the provider, not in the database.
--   * tasks.level_id / experience_id: the Timeline sends them too (0034's
--     header); they stay local-only. D9 names scene and shot only.
--
-- REVIEW ROUND 1 (2026-09-30), folded in before the file ever reached a
-- database: an archived list's MEMBERSHIP is frozen too (the items write
-- policies), membership deltas get their own invoker function
-- (upsert_shot_list_items) so no client rewrites a whole list from a stale
-- view, the edit chain is enforced (one root, one child, a fixed parent),
-- titles are stored trimmed, and passes_project_privacy's caller roll-call
-- names the three new definers.
--
-- Numbers: 0084 was the next free migration after the merge's 0082 and 0083
-- (0079/0080 stay reserved on paper). pgTAP: 84_shot_lists.sql,
-- 85_shot_list_items.sql, 86_edits.sql; probes added to 01_projects,
-- 03_assets, 04_tasks and 45_budget_versions.
-- Idempotent: IF NOT EXISTS / DROP-then-CREATE / guarded ALTERs throughout;
-- the backfill only touches projects that have no shot list yet.
-- =============================================================================


-- =============================================================================
-- 0. PRE-FLIGHT — refuse to run on a target that lacks what this file calls
-- =============================================================================
DO $$
BEGIN
  IF to_regprocedure('public.passes_project_privacy(uuid)') IS NULL THEN
    RAISE EXCEPTION '0084 pre-flight failed: public.passes_project_privacy(uuid) is missing — apply 0082 (and its predecessors 0067, 0072) first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'projects'
                    AND column_name = 'is_private') THEN
    RAISE EXCEPTION '0084 pre-flight failed: projects.is_private is missing — apply 0072 first';
  END IF;
  IF to_regclass('public.scenes') IS NULL OR to_regclass('public.shots') IS NULL
     OR to_regclass('public.budget_versions') IS NULL THEN
    RAISE EXCEPTION '0084 pre-flight failed: scenes / shots (0040) or budget_versions (0037) missing';
  END IF;
END $$;


-- =============================================================================
-- 1. COMPOSITE KEYS ON THE PARENTS — so a child can only point inside its own
--    project
-- =============================================================================
--
-- Every link this file adds names a scene, a shot or a list by id AND carries
-- the child's own project_id, and the FK is on the PAIR. A plain FK proves only
-- that the id exists somewhere; the pair proves it exists IN THIS PROJECT, so a
-- task, an item, an edit or a budget version can never be pointed at another
-- project's (or another workspace's, or a private project's) scene. `id` is
-- already each table's primary key, so (id, project_id) is trivially unique and
-- costs one small index — the 0044 reasoning, which did the same for
-- (projects.id, workspace_id).
--
-- The default MATCH SIMPLE is what makes the nullable links right: when any
-- column of the key is NULL the constraint is not checked, so an unlinked task
-- (scene_id NULL) is unaffected while a linked one is fully checked.
--
-- Guarded by pg_constraint rather than DROP-then-ADD: once the FKs below depend
-- on these, a DROP would fail on a re-run (0044's DROP-then-ADD of
-- projects_id_workspace_key has exactly that latent problem).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.scenes'::regclass AND conname = 'scenes_id_project_key') THEN
    ALTER TABLE public.scenes ADD CONSTRAINT scenes_id_project_key UNIQUE (id, project_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.shots'::regclass AND conname = 'shots_id_project_key') THEN
    ALTER TABLE public.shots ADD CONSTRAINT shots_id_project_key UNIQUE (id, project_id);
  END IF;
END $$;


-- =============================================================================
-- 2. THE GATE — can_edit_shot_lists()
-- =============================================================================
--
-- can_write_project (0013) with ONE change: 'reviewer' joins the seat list.
-- Audrey, D8 (2026-09-29): "Managers, members AND reviewers may create and
-- edit shot lists and edits." A reviewer reads a project and comments on it;
-- building a shot list is part of reviewing a cut, so she opened it to them.
--
-- 🚨 NEVER REUSE THIS GATE FOR SCENES, SHOTS, TASKS, ASSETS OR BUDGETS. It is
-- deliberately wider than can_write_project. Scenes and shots stay on
-- can_write_project (0040) — a reviewer may put an existing shot in a list but
-- may not create, rename or delete the shot itself, because those columns are
-- shared by every list (D3). Budgets stay on the money gate.
--
-- COALESCE is load-bearing (the 0044 lesson): current_app_role() is NULL for a
-- plain user and project_role_for() is NULL for an unseated one; bare, the
-- expression is `NULL OR false OR NULL` = NULL. A NULL policy expression
-- denies, so the answer would be right today by accident; strictly boolean
-- legs keep it right after the next edit.
--
-- Like can_write_project, it does NOT check membership, the workspace or the
-- private-project arm: every policy that calls it also checks
-- has_active_membership and the workspace, and hops to projects under the
-- caller's RLS (which carries the privacy arm). The three definer RPCs below do
-- NOT use this gate at all — they have their own, narrower check.

CREATE OR REPLACE FUNCTION public.can_edit_shot_lists(p_project UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(public.current_app_role() IN ('admin', 'manager'), FALSE)
      OR NOT public.project_is_staffed(p_project)
      OR COALESCE(public.project_role_for(p_project) IN ('manager', 'member', 'reviewer'), FALSE);
$$;

-- Functions carry a bare =X/postgres aclitem, so PUBLIC is named as well as
-- anon (the S22 grantee lesson). authenticated needs EXECUTE: the policies
-- call it as the caller.
REVOKE EXECUTE ON FUNCTION public.can_edit_shot_lists(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_edit_shot_lists(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.can_edit_shot_lists(UUID) IS
  '0084 (D8, Audrey 2026-09-29): who may create and edit shot lists, their membership and edits — workspace admin/manager, anyone on an UNSTAFFED project, or a project manager, member OR REVIEWER. can_write_project (0013) plus the reviewer seat. NEVER reuse it for scenes, shots, tasks, assets or budgets: those columns are shared by every list and keep can_write_project / the money gate. Client mirror: project.shotlist.write in src/permissions/projectRoleMatrix.js (the LOCKSTEP invariant).';


-- =============================================================================
-- 3. shot_lists
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.shot_lists (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES public.projects(id)   ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  title         TEXT    NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  summary       TEXT,
  -- Written by "Save" (D5): the list's scenes, shots and membership as they
  -- were at that moment. The rows themselves are shared and keep changing
  -- (D3); this is what a saved version keeps for history.
  snapshot      JSONB   NOT NULL DEFAULT '{}'::jsonb,
  archived_at   TIMESTAMPTZ,
  archived_by   UUID,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID,

  -- D14: shown "Title · v3"; the pair is unique per project, archived or not.
  CONSTRAINT shot_lists_project_title_version_key UNIQUE (project_id, title, version),
  -- The composite target for every child's same-project FK (§1's reasoning).
  CONSTRAINT shot_lists_id_project_key UNIQUE (id, project_id),
  -- The row's workspace is its project's (0044's guarantee, same FK).
  CONSTRAINT shot_lists_project_workspace_fk
    FOREIGN KEY (project_id, workspace_id) REFERENCES public.projects (id, workspace_id),
  CONSTRAINT shot_lists_version_positive_chk CHECK (version >= 1),
  -- A blank title would make "· v1" the whole label and collide invisibly.
  -- The provider and the Local Server route refuse it before any write, so
  -- this never fires as a surprise after an optimistic update (0044's worry).
  CONSTRAINT shot_lists_title_not_blank_chk CHECK (btrim(title) <> ''),
  CONSTRAINT shot_lists_snapshot_is_object_chk CHECK (jsonb_typeof(snapshot) = 'object')
);

CREATE INDEX IF NOT EXISTS shot_lists_project_idx ON public.shot_lists (project_id);

COMMENT ON TABLE public.shot_lists IS
  '0084: a project''s shot lists (D1–D5, D14). title + integer version, unique per project, shown "Title · v3". Membership lives in shot_list_items — the scene and shot ROWS are shared by every list that contains them (D3). Archived, never deleted (D4/D18): there is no DELETE policy or grant. The project''s active list is projects.active_shot_list_id, changed only by set_active_shot_list().';
COMMENT ON COLUMN public.shot_lists.snapshot IS
  'Written on "Save" (D5): the list''s scenes, shots and membership as they were, for history — the rows themselves are shared and keep changing. {} until the first save.';
COMMENT ON COLUMN public.shot_lists.archived_at IS
  'Set and cleared ONLY by archive_shot_list() (manager/admin; refuses the active list). trg_shot_lists_guard refuses any other change and any edit of an archived list''s row; the shot_list_items write policies refuse any change to an archived list''s membership.';


-- =============================================================================
-- 4. shot_list_items — the membership table
-- =============================================================================
--
-- Exactly one of scene_id / shot_id. Scene items order the scenes of a list;
-- shot items order the shots WITHIN their scene (position restarts at 0 per
-- scene, and for the "Unlinked shots" bucket). A list never holds the same
-- scene or the same shot twice (the two partial unique indexes).
--
-- ON DELETE CASCADE from the scene / shot: deleting a scene or shot removes it
-- from every list (the shared-row rule, D3). Edits are different — an edit
-- item referencing a deleted shot stays as "Missing shot" (D17), which is why
-- edits hold JSONB (§5) and not FKs.

CREATE TABLE IF NOT EXISTS public.shot_list_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shot_list_id  UUID NOT NULL,
  project_id    UUID NOT NULL REFERENCES public.projects(id)   ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  scene_id      UUID,
  shot_id       UUID,
  position      INTEGER NOT NULL DEFAULT 0,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID,

  CONSTRAINT shot_list_items_exactly_one_chk CHECK ((scene_id IS NULL) <> (shot_id IS NULL)),
  CONSTRAINT shot_list_items_position_nonneg_chk CHECK (position >= 0),
  CONSTRAINT shot_list_items_list_fk
    FOREIGN KEY (shot_list_id, project_id) REFERENCES public.shot_lists (id, project_id) ON DELETE CASCADE,
  CONSTRAINT shot_list_items_scene_fk
    FOREIGN KEY (scene_id, project_id) REFERENCES public.scenes (id, project_id) ON DELETE CASCADE,
  CONSTRAINT shot_list_items_shot_fk
    FOREIGN KEY (shot_id, project_id) REFERENCES public.shots (id, project_id) ON DELETE CASCADE,
  CONSTRAINT shot_list_items_project_workspace_fk
    FOREIGN KEY (project_id, workspace_id) REFERENCES public.projects (id, workspace_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS shot_list_items_list_scene_key
  ON public.shot_list_items (shot_list_id, scene_id) WHERE scene_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS shot_list_items_list_shot_key
  ON public.shot_list_items (shot_list_id, shot_id) WHERE shot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS shot_list_items_list_position_idx
  ON public.shot_list_items (shot_list_id, position);
CREATE INDEX IF NOT EXISTS shot_list_items_scene_idx
  ON public.shot_list_items (scene_id) WHERE scene_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS shot_list_items_shot_idx
  ON public.shot_list_items (shot_id) WHERE shot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS shot_list_items_project_idx
  ON public.shot_list_items (project_id);

COMMENT ON TABLE public.shot_list_items IS
  '0084: list MEMBERSHIP (D1 + D3) — one row per (list, scene) or (list, shot), never a copy of the scene or shot. Scene positions order a list''s scenes; shot positions order shots within their scene. Every FK is on (id, project_id), so an item can only name a scene, shot or list of its own project. Deleting a scene or shot removes it from every list (CASCADE).';


-- =============================================================================
-- 5. edits
-- =============================================================================
--
-- 🚨 WHY `items` IS JSONB AND NOT A CHILD TABLE — the 0044 task_templates
-- precedent, and its three reasons hold here too:
--   1. The only write is WHOLE-ARRAY: S3c's draft edit lives in the provider
--      and "Save" writes it in one go (D2/D5, D13). A child table would need
--      diff/upsert/delete reconciliation for no gain.
--   2. Items reference each other only inside one document (ordering,
--      repeats of the same shot — D6 allows repeats, so (edit, shot) is not
--      even unique).
--   3. One shape on both backends: the Local Server stores the same array.
-- And a fourth, specific to edits: D17 — a deleted shot stays in an edit as
-- "Missing shot". An FK would cascade it away or refuse the delete.
--
-- Each item: { id, scene_id, shot_id, label, notes } (no in/out points, D6).
-- The CHECK admits only an array; the element shape is the client's contract.
--
-- One linear chain per list (D6): parent_edit_id names an edit of the SAME
-- list (the composite FK), SET NULL if the parent row ever goes.

CREATE TABLE IF NOT EXISTS public.edits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES public.projects(id)   ON DELETE CASCADE,
  workspace_id    UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  shot_list_id    UUID NOT NULL,

  title           TEXT    NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  summary         TEXT,
  parent_edit_id  UUID,
  items           JSONB   NOT NULL DEFAULT '[]'::jsonb,
  snapshot        JSONB,
  archived_at     TIMESTAMPTZ,
  archived_by     UUID,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID,

  CONSTRAINT edits_list_title_version_key UNIQUE (project_id, shot_list_id, title, version),
  CONSTRAINT edits_id_list_key UNIQUE (id, shot_list_id),
  CONSTRAINT edits_list_fk
    FOREIGN KEY (shot_list_id, project_id) REFERENCES public.shot_lists (id, project_id) ON DELETE CASCADE,
  CONSTRAINT edits_parent_same_list_fk
    FOREIGN KEY (parent_edit_id, shot_list_id) REFERENCES public.edits (id, shot_list_id)
    ON DELETE SET NULL (parent_edit_id),
  CONSTRAINT edits_project_workspace_fk
    FOREIGN KEY (project_id, workspace_id) REFERENCES public.projects (id, workspace_id),
  CONSTRAINT edits_items_is_array_chk CHECK (jsonb_typeof(items) = 'array'),
  CONSTRAINT edits_snapshot_is_object_chk CHECK (snapshot IS NULL OR jsonb_typeof(snapshot) = 'object'),
  CONSTRAINT edits_version_positive_chk CHECK (version >= 1),
  CONSTRAINT edits_title_not_blank_chk CHECK (btrim(title) <> ''),
  CONSTRAINT edits_not_own_parent_chk CHECK (parent_edit_id IS NULL OR parent_edit_id <> id)
);

CREATE INDEX IF NOT EXISTS edits_project_idx ON public.edits (project_id);
CREATE INDEX IF NOT EXISTS edits_list_idx    ON public.edits (shot_list_id);

-- D6, "one linear chain per list" (review R1: branching and cycles were
-- accepted). No edit has two children, and a list has one root; the guard
-- (§7a) makes parent_edit_id immutable, so no cycle can form. Edits are never
-- deleted singly (archive only; a list's edits go together with it), so the
-- FK's SET NULL can never promote a second root.
CREATE UNIQUE INDEX IF NOT EXISTS edits_one_child_key
  ON public.edits (parent_edit_id) WHERE parent_edit_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS edits_one_root_per_list_key
  ON public.edits (shot_list_id) WHERE parent_edit_id IS NULL;

COMMENT ON TABLE public.edits IS
  '0084: an edit (D6) — an ordered list of items referencing shot ids (repeats allowed, scene order, no in/out points), ONE linear chain per list via parent_edit_id (same-list composite FK; one root and one child each, by unique index; the parent is fixed at creation). Edits may exist on any list, active or not. Archived, never deleted (no DELETE policy or grant).';
COMMENT ON COLUMN public.edits.items IS
  'JSONB array of { id, scene_id, shot_id, label, notes }. Not a child table — see 0084 §5 (0044''s three reasons, plus D17: a deleted shot stays as "Missing shot").';


-- =============================================================================
-- 6. The link columns on existing tables (D9, and the budget's list)
-- =============================================================================

-- ── 6a. projects.active_shot_list_id — structural one-active ────────────────
-- The 0036/0037 budget_active_version_id shape: a pointer on the project, not
-- a per-row is_active flag flipped client-side. The FK is on the PAIR
-- (active_shot_list_id, id) -> (shot_lists.id, project_id): the active list
-- must be one of THIS project's lists. ON DELETE SET NULL names the one
-- column (PG15+), because nulling projects.id is impossible.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS active_shot_list_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.projects'::regclass
                    AND conname = 'projects_active_shot_list_fk') THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_active_shot_list_fk
      FOREIGN KEY (active_shot_list_id, id)
      REFERENCES public.shot_lists (id, project_id)
      ON DELETE SET NULL (active_shot_list_id);
  END IF;
END $$;

COMMENT ON COLUMN public.projects.active_shot_list_id IS
  '0084: the project''s ACTIVE shot list (D10: every surface except the Scenes tab reads it). NULL = no list is active and the client shows every scene and shot, as before 0084. Changed ONLY by set_active_shot_list() (admin or project manager): trg_projects_active_shot_list_guard refuses a change through the ordinary projects UPDATE policy. The composite FK keeps it inside this project.';

-- ── 6b. tasks.scene_id / shot_id ────────────────────────────────────────────
-- 0034 deliberately left these out ("scenes are local-only BY DESIGN"). 0040
-- made scenes and shots cloud tables and D9 asks for the link, so the reason
-- is gone. Same-project composite FKs; SET NULL, so deleting a scene or shot
-- never deletes the work planned against it (0034's own rule for phase_id).
-- tasks' existing policies (0013/0034) govern these columns like any other.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS scene_id UUID,
  ADD COLUMN IF NOT EXISTS shot_id  UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.tasks'::regclass AND conname = 'tasks_scene_fk') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_scene_fk FOREIGN KEY (scene_id, project_id)
      REFERENCES public.scenes (id, project_id) ON DELETE SET NULL (scene_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.tasks'::regclass AND conname = 'tasks_shot_fk') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_shot_fk FOREIGN KEY (shot_id, project_id)
      REFERENCES public.shots (id, project_id) ON DELETE SET NULL (shot_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tasks_scene_idx ON public.tasks (scene_id) WHERE scene_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_shot_idx  ON public.tasks (shot_id)  WHERE shot_id  IS NOT NULL;

COMMENT ON COLUMN public.tasks.scene_id IS
  '0084 (D9): the scene this task is for, or NULL. Same-project composite FK; SET NULL when the scene is deleted. ScenesView creates tasks with it set; BudgetView''s By-scene report reads it.';
COMMENT ON COLUMN public.tasks.shot_id IS
  '0084 (D9): the shot this task is for, or NULL. Same-project composite FK; SET NULL when the shot is deleted.';

-- ── 6c. assets.scene_ids / shot_ids ─────────────────────────────────────────
-- The client's existing local shape (RelationsPanel, ProjectAssetsView write
-- whole arrays). 🚨 THE INTEGRITY TRADE-OFF: an array element cannot be an FK,
-- so deleting a scene leaves its id in every asset that named it. The client
-- already resolves ids against the loaded scenes and drops unknown ones, so an
-- orphan is invisible, not wrong. No trigger: an array rewrite on every scene
-- delete would touch every asset row of the project. If orphans ever matter,
-- the sweep is safe to run at any hour (idempotent, one statement per array):
--   UPDATE public.assets a SET scene_ids = ARRAY(
--     SELECT x FROM unnest(a.scene_ids) x
--      WHERE EXISTS (SELECT 1 FROM public.scenes s WHERE s.id = x AND s.project_id = a.project_id))
--    WHERE EXISTS (SELECT 1 FROM unnest(a.scene_ids) x
--      WHERE NOT EXISTS (SELECT 1 FROM public.scenes s WHERE s.id = x AND s.project_id = a.project_id));
--   (and the same for shot_ids against public.shots)
-- NOT NULL DEFAULT '{}' is a metadata-only change on PG11+ (no rewrite).

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS scene_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS shot_ids  UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.assets.scene_ids IS
  '0084 (D9): scenes this asset appears in. An array, so NOT an FK: a deleted scene''s id may linger (the client ignores unknown ids); 0084''s header carries a safe orphan sweep.';
COMMENT ON COLUMN public.assets.shot_ids IS
  '0084 (D9): shots this asset appears in. Array, not an FK — see scene_ids.';

-- ── 6d. budget_versions.shot_list_id + summary ─────────────────────────────
-- Which list a budget version was built against (S3c puts the dropdown on the
-- create-version row). summary: the F8 question — added now, nullable, because
-- a column nobody writes yet is harmless and saves a second migration on the
-- same table. Both sit under the money gate like the rest of the row (0037).

ALTER TABLE public.budget_versions
  ADD COLUMN IF NOT EXISTS shot_list_id UUID,
  ADD COLUMN IF NOT EXISTS summary      TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.budget_versions'::regclass
                    AND conname = 'budget_versions_shot_list_fk') THEN
    ALTER TABLE public.budget_versions
      ADD CONSTRAINT budget_versions_shot_list_fk FOREIGN KEY (shot_list_id, project_id)
      REFERENCES public.shot_lists (id, project_id) ON DELETE SET NULL (shot_list_id);
  END IF;
END $$;

COMMENT ON COLUMN public.budget_versions.shot_list_id IS
  '0084: the shot list this budget version was built against, or NULL. Same-project composite FK.';
COMMENT ON COLUMN public.budget_versions.summary IS
  '0084: a short description of the version (question F8). Nullable; nothing writes it yet.';


-- =============================================================================
-- 7. Stamping, audit and the two GUARD triggers
-- =============================================================================
--
-- workspace_id is NOT NULL and no client sends it: 0004's stamping trigger,
-- LANGUAGE plpgsql and NOT SECURITY DEFINER (the precondition for FORCE RLS).
-- fn_audit_touch (0001) stamps created_by/updated_by as well as the times —
-- the 0040 tables used touch_updated_at only and never learn who wrote them.

DROP TRIGGER IF EXISTS trg_shot_lists_populate_workspace ON public.shot_lists;
CREATE TRIGGER trg_shot_lists_populate_workspace
  BEFORE INSERT ON public.shot_lists
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_from_project();

DROP TRIGGER IF EXISTS trg_shot_list_items_populate_workspace ON public.shot_list_items;
CREATE TRIGGER trg_shot_list_items_populate_workspace
  BEFORE INSERT ON public.shot_list_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_from_project();

DROP TRIGGER IF EXISTS trg_edits_populate_workspace ON public.edits;
CREATE TRIGGER trg_edits_populate_workspace
  BEFORE INSERT ON public.edits
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_from_project();

DROP TRIGGER IF EXISTS trg_shot_lists_audit ON public.shot_lists;
CREATE TRIGGER trg_shot_lists_audit
  BEFORE INSERT OR UPDATE ON public.shot_lists
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_touch();

DROP TRIGGER IF EXISTS trg_shot_list_items_audit ON public.shot_list_items;
CREATE TRIGGER trg_shot_list_items_audit
  BEFORE INSERT OR UPDATE ON public.shot_list_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_touch();

DROP TRIGGER IF EXISTS trg_edits_audit ON public.edits;
CREATE TRIGGER trg_edits_audit
  BEFORE INSERT OR UPDATE ON public.edits
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_touch();

-- ── 7a. The shot-list / edit guard ──────────────────────────────────────────
-- The plain UPDATE policies admit every can_edit_shot_lists caller, reviewers
-- included, so on their own they would let anyone archive (D8 says managers
-- and admins only) and let an archived list be rewritten (D4: saved history
-- is never cleared). This trigger closes both, the 0064 way: the RPC arms a
-- transaction-local GUC naming the ONE row it is changing; anything else that
-- touches archived_at/archived_by, or touches an archived row at all, is
-- refused. It also pins the row to its project and list: a list or edit never
-- moves (the composite FKs refuse most moves already; this makes it explicit).
--
-- service_role passes (the 0049 folder-root guard's rule): the operator and
-- Edge Functions are not the client this guards against.
--
-- One function serves both tables; TG_TABLE_NAME picks the GUC.

CREATE OR REPLACE FUNCTION public.fn_shot_list_archive_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_armed BOOLEAN := TG_OP = 'UPDATE' AND COALESCE(
    current_setting(CASE TG_TABLE_NAME WHEN 'shot_lists' THEN 'wilson.shot_list_archive'
                                       ELSE 'wilson.edit_archive' END, true) = OLD.id::text,
    false);
BEGIN
  -- Titles are stored trimmed on every path (review R1: the Local Server and
  -- the provider compare TRIMMED titles for the (title, version) key; the
  -- UNIQUE here would otherwise treat "Main" and "Main " as two lists).
  NEW.title := btrim(NEW.title);

  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- INSERT: a row is born live. Archiving is the RPC's alone (D8), and a row
  -- that ARRIVES archived would skip it (merge review of S3a's adapters: the
  -- guard was UPDATE-only). PostgREST's upsert fires this for the proposed
  -- row before the conflict check, so re-sending an archived row is refused
  -- here too — an archived row cannot be changed by any path but the RPC.
  IF TG_OP = 'INSERT' THEN
    IF NEW.archived_at IS NOT NULL OR NEW.archived_by IS NOT NULL THEN
      RAISE EXCEPTION '% are archived and restored only by a project manager or a workspace admin, through %()',
        CASE TG_TABLE_NAME WHEN 'shot_lists' THEN 'shot lists' ELSE 'edits' END,
        CASE TG_TABLE_NAME WHEN 'shot_lists' THEN 'archive_shot_list' ELSE 'archive_edit' END
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- An UPDATE issued by ANOTHER trigger is not a client write. The one that
  -- can reach here is the FK's own ON DELETE SET NULL (parent_edit_id): an
  -- operator or a cascade removing a parent edit must not be refused because
  -- a surviving child is archived (clients cannot delete edits at all). A
  -- client statement fires this at depth 1; no trigger on these tables issues
  -- an UPDATE of its own, so depth > 1 is always the FK action.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'a % row cannot move to another project', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  -- NESTED, not `TG_TABLE_NAME = 'edits' AND NEW.shot_list_id …`: the one
  -- function serves both tables, and a shot_lists row has no shot_list_id —
  -- PL/pgSQL resolves every field in an expression before it evaluates the
  -- AND, so the flat form raised 42703 on every shot_lists UPDATE (suite 84
  -- caught it). The inner statement is only ever prepared for edits.
  IF TG_TABLE_NAME = 'edits' THEN
    IF NEW.shot_list_id IS DISTINCT FROM OLD.shot_list_id THEN
      RAISE EXCEPTION 'an edit cannot move to another shot list' USING ERRCODE = '42501';
    END IF;
    -- D6: one linear chain per list. An edit's place in the chain is fixed
    -- when it is made (its parent already exists then), which is what makes a
    -- cycle impossible; the two unique indexes in §5 forbid a branch and a
    -- second root. The FK's own SET NULL passed above (depth > 1).
    IF NEW.parent_edit_id IS DISTINCT FROM OLD.parent_edit_id THEN
      RAISE EXCEPTION 'an edit''s place in its chain cannot change' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_armed THEN
    RETURN NEW;
  END IF;

  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at
     OR NEW.archived_by IS DISTINCT FROM OLD.archived_by THEN
    RAISE EXCEPTION '% are archived and restored only by a project manager or a workspace admin, through %()',
      CASE TG_TABLE_NAME WHEN 'shot_lists' THEN 'shot lists' ELSE 'edits' END,
      CASE TG_TABLE_NAME WHEN 'shot_lists' THEN 'archive_shot_list' ELSE 'archive_edit' END
      USING ERRCODE = '42501';
  END IF;

  IF OLD.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'this % is archived — restore it before changing it',
      CASE TG_TABLE_NAME WHEN 'shot_lists' THEN 'shot list' ELSE 'edit' END
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_shot_list_archive_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_shot_lists_guard ON public.shot_lists;
CREATE TRIGGER trg_shot_lists_guard
  BEFORE INSERT OR UPDATE ON public.shot_lists
  FOR EACH ROW EXECUTE FUNCTION public.fn_shot_list_archive_guard();

DROP TRIGGER IF EXISTS trg_edits_guard ON public.edits;
CREATE TRIGGER trg_edits_guard
  BEFORE INSERT OR UPDATE ON public.edits
  FOR EACH ROW EXECUTE FUNCTION public.fn_shot_list_archive_guard();

COMMENT ON FUNCTION public.fn_shot_list_archive_guard() IS
  '0084: refuses a row INSERTED already archived, and a change to archived_at/archived_by outside archive_shot_list() / archive_edit() (their transaction-local GUC names the one row), refuses any change to an archived row, and pins a list or edit to its project (and an edit to its list). service_role passes, and so does an UPDATE issued by another trigger (the FK''s ON DELETE SET NULL on parent_edit_id during a cascade — the project purge).';

-- ── 7b. The active-list guard on projects ───────────────────────────────────
-- projects_update (0013) admits every can_write_project caller — every member
-- of the project — to every column. Without this, a member could PATCH
-- projects.active_shot_list_id directly and D8's "set active: managers and
-- admins" would be a label. The RPC arms the GUC with the project id.
--
-- Only a CHANGE is examined (IS NOT DISTINCT FROM, the 0049 rule): a client
-- that sends the whole project row back with the pointer unchanged must not be
-- refused. One more case passes: the FK's own ON DELETE SET NULL, which runs an
-- UPDATE here after the list row is gone — "clearing a pointer to a list that
-- no longer exists" is never an authorisation question. SECURITY DEFINER so
-- that existence check does not depend on the caller's RLS.

CREATE OR REPLACE FUNCTION public.fn_projects_active_shot_list_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.active_shot_list_id IS NOT DISTINCT FROM OLD.active_shot_list_id THEN
    RETURN NEW;
  END IF;
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(current_setting('wilson.shot_list_activate', true) = OLD.id::text, false) THEN
    RETURN NEW;
  END IF;
  IF NEW.active_shot_list_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.shot_lists l WHERE l.id = OLD.active_shot_list_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'the active shot list is changed only by a project manager or a workspace admin, through set_active_shot_list()'
    USING ERRCODE = '42501';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_projects_active_shot_list_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_projects_active_shot_list_guard ON public.projects;
CREATE TRIGGER trg_projects_active_shot_list_guard
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.fn_projects_active_shot_list_guard();

COMMENT ON FUNCTION public.fn_projects_active_shot_list_guard() IS
  '0084: projects.active_shot_list_id changes only through set_active_shot_list() (its transaction-local GUC names the project), by service_role, or when the FK clears a pointer to a list row that no longer exists. An unchanged value always passes.';


-- =============================================================================
-- 8. RLS
-- =============================================================================
--
-- Separate policies per command, never FOR ALL (0029; S15's CRITICAL).
--
-- SELECT hops to the live PROJECT under the caller's RLS (the 0014/0040
-- shape), so a trashed project hides its lists, and 0072's private-project arm
-- reaches these rows with no policy of their own.
--
-- 🚨 Every WRITE policy hops too — the 0082 §3b / 0083 lesson. supabase-js's
-- .insert() without .select() sends Prefer: return=minimal, so no SELECT
-- policy is ever consulted; and an UPDATE or DELETE that reads no column is
-- judged by its own policy alone. Without the hop, a workspace manager (the
-- gate's admin/manager leg) holding a private project's id could write lists
-- into it. The hop is evaluated as the caller under projects_select: all four
-- of its arms (workspace, live, membership, privacy).
--
-- UPDATE's WITH CHECK is IDENTICAL to its USING (0044: "WITH CHECK must not be
-- weaker than USING").
--
-- shot_lists and edits have NO delete policy and no DELETE grant: archived,
-- never deleted (D4/D18). A project's hard delete cascades as the owner.

ALTER TABLE public.shot_lists      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shot_lists      FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.shot_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shot_list_items FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.edits           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edits           FORCE  ROW LEVEL SECURITY;

-- shot_lists
DROP POLICY IF EXISTS shot_lists_select ON public.shot_lists;
CREATE POLICY shot_lists_select ON public.shot_lists
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = shot_lists.project_id)
  );

DROP POLICY IF EXISTS shot_lists_insert ON public.shot_lists;
CREATE POLICY shot_lists_insert ON public.shot_lists
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_edit_shot_lists(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = shot_lists.project_id)
  );

DROP POLICY IF EXISTS shot_lists_update ON public.shot_lists;
CREATE POLICY shot_lists_update ON public.shot_lists
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_edit_shot_lists(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = shot_lists.project_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_edit_shot_lists(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = shot_lists.project_id)
  );

-- shot_list_items (removing a shot from a list IS a delete here).
-- Every write also requires the parent list NOT to be archived (review R1:
-- D4/D18 — "saved lists are never cleared" — held only for the list ROW; a
-- reviewer could empty an archived list's membership through PostgREST or
-- replace_shot_list_items). A scene or shot DELETE still takes its items out
-- of archived lists too: the FK CASCADE is a referential action, which RLS
-- does not judge — the shared-row rule (D3) wins over the freeze.
DROP POLICY IF EXISTS shot_list_items_select ON public.shot_list_items;
CREATE POLICY shot_list_items_select ON public.shot_list_items
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = shot_list_items.project_id)
  );

DROP POLICY IF EXISTS shot_list_items_insert ON public.shot_list_items;
CREATE POLICY shot_list_items_insert ON public.shot_list_items
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_edit_shot_lists(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = shot_list_items.project_id)
    AND NOT EXISTS (SELECT 1 FROM public.shot_lists l
                     WHERE l.id = shot_list_items.shot_list_id AND l.archived_at IS NOT NULL)
  );

DROP POLICY IF EXISTS shot_list_items_update ON public.shot_list_items;
CREATE POLICY shot_list_items_update ON public.shot_list_items
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_edit_shot_lists(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = shot_list_items.project_id)
    AND NOT EXISTS (SELECT 1 FROM public.shot_lists l
                     WHERE l.id = shot_list_items.shot_list_id AND l.archived_at IS NOT NULL)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_edit_shot_lists(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = shot_list_items.project_id)
    AND NOT EXISTS (SELECT 1 FROM public.shot_lists l
                     WHERE l.id = shot_list_items.shot_list_id AND l.archived_at IS NOT NULL)
  );

DROP POLICY IF EXISTS shot_list_items_delete ON public.shot_list_items;
CREATE POLICY shot_list_items_delete ON public.shot_list_items
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_edit_shot_lists(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = shot_list_items.project_id)
    AND NOT EXISTS (SELECT 1 FROM public.shot_lists l
                     WHERE l.id = shot_list_items.shot_list_id AND l.archived_at IS NOT NULL)
  );

-- edits
DROP POLICY IF EXISTS edits_select ON public.edits;
CREATE POLICY edits_select ON public.edits
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = edits.project_id)
  );

DROP POLICY IF EXISTS edits_insert ON public.edits;
CREATE POLICY edits_insert ON public.edits
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_edit_shot_lists(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = edits.project_id)
  );

DROP POLICY IF EXISTS edits_update ON public.edits;
CREATE POLICY edits_update ON public.edits
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_edit_shot_lists(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = edits.project_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_edit_shot_lists(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = edits.project_id)
  );


-- =============================================================================
-- 9. Privileges
-- =============================================================================
-- 0033 disarmed 0011's default privileges, but a policy-only check passes while
-- a privilege hole is open (S21), so the revoke is stated, PUBLIC included (the
-- S22 grantee lesson). No DELETE on the two archive-only tables: with no DELETE
-- policy a delete is refused anyway; without the grant it never reaches RLS.

REVOKE ALL ON public.shot_lists      FROM PUBLIC, anon;
REVOKE ALL ON public.shot_list_items FROM PUBLIC, anon;
REVOKE ALL ON public.edits           FROM PUBLIC, anon;
REVOKE ALL ON public.shot_lists      FROM authenticated;
REVOKE ALL ON public.shot_list_items FROM authenticated;
REVOKE ALL ON public.edits           FROM authenticated;

GRANT SELECT, INSERT, UPDATE         ON public.shot_lists      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shot_list_items TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.edits           TO authenticated;

GRANT ALL ON public.shot_lists      TO service_role;
GRANT ALL ON public.shot_list_items TO service_role;
GRANT ALL ON public.edits           TO service_role;


-- =============================================================================
-- 10. The RPCs
-- =============================================================================
--
-- Set active and archive are manager/admin decisions (D8). SECURITY DEFINER,
-- because they must write a column and a row the ordinary policies deliberately
-- cannot. A definer body reads with RLS bypassed, so it spells out EVERY arm of
-- the read gate itself — workspace, live project, membership, and the 0072
-- privacy arm through passes_project_privacy() (0082), exactly once each: the
-- trap 0082 and 0083 both closed after the fact (a definer that copies the
-- pre-0072 predicate lets a leaked private-project id through).
--
-- The seat check follows can_access_project_money (0037) — workspace admin OR
-- project manager, no unstaffed opening, no workspace-manager leg — because D8
-- groups set-active with the budget's owners. COALESCE makes it strictly
-- boolean (current_app_role() and project_role_for() are NULL for ordinary
-- callers; inside a NOT, NULL would ALLOW — the 0064 lesson).
--
-- Both lock the PROJECT row FOR UPDATE first, so a set-active and an archive of
-- the same list cannot interleave into "the active list is archived".
--
-- A refusal for "no such list", "not in your workspace", "trashed project" and
-- "private project you cannot see" is ONE message, so the RPC is not an
-- existence oracle for ids the caller cannot see.

-- ── 10a. set_active_shot_list ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_active_shot_list(p_project UUID, p_list UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws      UUID := public.current_workspace_id();
  v_project UUID;
  v_list    public.shot_lists%ROWTYPE;
BEGIN
  IF v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RAISE EXCEPTION 'not_a_workspace_member' USING ERRCODE = '42501';
  END IF;

  SELECT p.id INTO v_project
    FROM public.projects p
   WHERE p.id = p_project
     AND p.workspace_id = v_ws
     AND p.deleted_at IS NULL
     AND public.passes_project_privacy(p.id)
     FOR UPDATE;
  IF v_project IS NULL THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT COALESCE(public.current_app_role() = 'admin'
                  OR public.project_role_for(v_project) = 'manager', false) THEN
    RAISE EXCEPTION 'only a project manager or a workspace admin can change the active shot list'
      USING ERRCODE = '42501';
  END IF;

  -- p_list NULL clears the pointer: back to "no active list" (every scene and
  -- shot shows). That is what an undo of the first activation needs.
  IF p_list IS NOT NULL THEN
    SELECT * INTO v_list FROM public.shot_lists l
     WHERE l.id = p_list AND l.project_id = v_project;
    IF v_list.id IS NULL THEN
      RAISE EXCEPTION 'shot list not found in this project' USING ERRCODE = 'P0002';
    END IF;
    IF v_list.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'an archived shot list cannot be made active — restore it first';
    END IF;
  END IF;

  PERFORM set_config('wilson.shot_list_activate', v_project::text, true);
  UPDATE public.projects SET active_shot_list_id = p_list WHERE id = v_project;
  PERFORM set_config('wilson.shot_list_activate', '', true);

  RETURN p_list;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_active_shot_list(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_active_shot_list(UUID, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.set_active_shot_list(UUID, UUID) IS
  '0084 (D8): make p_list the project''s active shot list (NULL clears it). Workspace admin or project manager only; the list must belong to the project and not be archived. SECURITY DEFINER with its own read gate (workspace, live, membership, passes_project_privacy). Returns the new active list id.';

-- ── 10b. archive_shot_list ──────────────────────────────────────────────────
-- p_archived = false restores (the undo of an archive). Archiving an archived
-- list, or restoring a live one, is a no-op that returns the row unchanged.
CREATE OR REPLACE FUNCTION public.archive_shot_list(p_list UUID, p_archived BOOLEAN DEFAULT true)
RETURNS public.shot_lists
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws      UUID := public.current_workspace_id();
  v_list    public.shot_lists%ROWTYPE;
  v_active  UUID;
BEGIN
  IF v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RAISE EXCEPTION 'not_a_workspace_member' USING ERRCODE = '42501';
  END IF;

  SELECT p.active_shot_list_id INTO v_active
    FROM public.shot_lists l
    JOIN public.projects p ON p.id = l.project_id
   WHERE l.id = p_list
     AND p.workspace_id = v_ws
     AND p.deleted_at IS NULL
     AND public.passes_project_privacy(p.id)
     FOR UPDATE OF p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shot list not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_list FROM public.shot_lists WHERE id = p_list;

  IF NOT COALESCE(public.current_app_role() = 'admin'
                  OR public.project_role_for(v_list.project_id) = 'manager', false) THEN
    RAISE EXCEPTION 'only a project manager or a workspace admin can archive or restore a shot list'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(p_archived, true) AND v_active IS NOT DISTINCT FROM p_list THEN
    RAISE EXCEPTION 'the active shot list cannot be archived — make another list active first';
  END IF;

  PERFORM set_config('wilson.shot_list_archive', p_list::text, true);
  UPDATE public.shot_lists
     SET archived_at = CASE WHEN COALESCE(p_archived, true) THEN COALESCE(archived_at, now()) ELSE NULL END,
         archived_by = CASE WHEN COALESCE(p_archived, true) THEN COALESCE(archived_by, auth.uid()) ELSE NULL END
   WHERE id = p_list
  RETURNING * INTO v_list;
  PERFORM set_config('wilson.shot_list_archive', '', true);

  RETURN v_list;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.archive_shot_list(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.archive_shot_list(UUID, BOOLEAN) TO authenticated, service_role;

COMMENT ON FUNCTION public.archive_shot_list(UUID, BOOLEAN) IS
  '0084 (D4/D8/D18): archive (p_archived true, the default) or restore (false) a shot list. Workspace admin or project manager only; refuses to archive the project''s ACTIVE list. Lists are never deleted. SECURITY DEFINER with its own read gate (workspace, live, membership, passes_project_privacy). Returns the row.';

-- ── 10c. archive_edit ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.archive_edit(p_edit UUID, p_archived BOOLEAN DEFAULT true)
RETURNS public.edits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws    UUID := public.current_workspace_id();
  v_edit  public.edits%ROWTYPE;
BEGIN
  IF v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RAISE EXCEPTION 'not_a_workspace_member' USING ERRCODE = '42501';
  END IF;

  SELECT e.* INTO v_edit
    FROM public.edits e
    JOIN public.projects p ON p.id = e.project_id
   WHERE e.id = p_edit
     AND p.workspace_id = v_ws
     AND p.deleted_at IS NULL
     AND public.passes_project_privacy(p.id)
     FOR UPDATE OF e;
  IF v_edit.id IS NULL THEN
    RAISE EXCEPTION 'edit not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT COALESCE(public.current_app_role() = 'admin'
                  OR public.project_role_for(v_edit.project_id) = 'manager', false) THEN
    RAISE EXCEPTION 'only a project manager or a workspace admin can archive or restore an edit'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('wilson.edit_archive', p_edit::text, true);
  UPDATE public.edits
     SET archived_at = CASE WHEN COALESCE(p_archived, true) THEN COALESCE(archived_at, now()) ELSE NULL END,
         archived_by = CASE WHEN COALESCE(p_archived, true) THEN COALESCE(archived_by, auth.uid()) ELSE NULL END
   WHERE id = p_edit
  RETURNING * INTO v_edit;
  PERFORM set_config('wilson.edit_archive', '', true);

  RETURN v_edit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.archive_edit(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.archive_edit(UUID, BOOLEAN) TO authenticated, service_role;

COMMENT ON FUNCTION public.archive_edit(UUID, BOOLEAN) IS
  '0084 (D4/D8): archive (default) or restore an edit. Workspace admin or project manager only. SECURITY DEFINER with its own read gate (workspace, live, membership, passes_project_privacy). Returns the row.';

-- ── 10d. replace_shot_list_items — atomic membership swap (SECURITY INVOKER) ─
-- Undo of a reorder or a removal puts a list's membership back verbatim (the
-- bins' replaceShotTakes idea); over PostgREST that is a delete plus an upsert
-- in two requests, which can half-land. This does both in one transaction AS
-- THE CALLER: every row it touches passes shot_list_items' own policies, so it
-- grants nothing the table does not. Delete first, then upsert, so an entity
-- that changes item id does not trip the (list, scene)/(list, shot) keys.
-- An id already used by ANOTHER list's item is skipped, never rewritten.

CREATE OR REPLACE FUNCTION public.replace_shot_list_items(p_list UUID, p_items JSONB)
RETURNS SETOF public.shot_list_items
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_project  UUID;
  v_archived TIMESTAMPTZ;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'items must be a JSON array' USING ERRCODE = '22023';
  END IF;

  SELECT l.project_id, l.archived_at INTO v_project, v_archived FROM public.shot_lists l WHERE l.id = p_list;
  IF v_project IS NULL THEN
    RAISE EXCEPTION 'shot list not found' USING ERRCODE = 'P0002';
  END IF;
  -- Said out loud (review round 1): the items policies already refuse an
  -- archived list's writes, but a DELETE the policy filters out, or an empty
  -- set, would otherwise succeed in silence. Same sentence as every backend.
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'this shot list is archived — restore it before changing it' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.shot_list_items i
   WHERE i.shot_list_id = p_list
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_items) e
        WHERE e ? 'id' AND (e ->> 'id')::uuid = i.id);

  INSERT INTO public.shot_list_items AS t (id, shot_list_id, project_id, scene_id, shot_id, position)
  SELECT COALESCE((e ->> 'id')::uuid, gen_random_uuid()),
         p_list,
         v_project,
         NULLIF(e ->> 'scene_id', '')::uuid,
         NULLIF(e ->> 'shot_id', '')::uuid,
         COALESCE((e ->> 'position')::int, (ord - 1)::int)
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS x(e, ord)
  ON CONFLICT (id) DO UPDATE
     SET scene_id = EXCLUDED.scene_id,
         shot_id  = EXCLUDED.shot_id,
         position = EXCLUDED.position
   WHERE t.shot_list_id = EXCLUDED.shot_list_id;

  RETURN QUERY
    SELECT * FROM public.shot_list_items i
     WHERE i.shot_list_id = p_list
     ORDER BY i.position, i.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.replace_shot_list_items(UUID, JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.replace_shot_list_items(UUID, JSONB) TO authenticated, service_role;

COMMENT ON FUNCTION public.replace_shot_list_items(UUID, JSONB) IS
  '0084: replace one list''s membership with p_items ([{id?, scene_id | shot_id, position?}]) in one transaction — delete the rows not named, upsert the rest. SECURITY INVOKER: every row passes shot_list_items'' own policies (incl. the archived-list freeze). An id belonging to another list is skipped. Returns the list''s items, ordered. The provider writes DELTAS (upsert_shot_list_items + a DELETE of named ids); this whole-set form is for tooling and bulk restores.';


-- ── 10e. upsert_shot_list_items — the DELTA write (SECURITY INVOKER) ────────
-- Review R1 (provider#0): membership changes written as whole-list replaces
-- from one client's view deleted the items a collaborator had added since
-- that client loaded (items are not broadcast). Adds, reorders and the undo of
-- a removal write ONLY the rows they name through this; removals delete only
-- named ids (a plain PostgREST DELETE). Nothing unnamed is ever touched.
-- As the caller, under shot_list_items' own policies; an id that belongs to
-- ANOTHER list is skipped, never moved. Returns the rows it wrote.

CREATE OR REPLACE FUNCTION public.upsert_shot_list_items(p_list UUID, p_items JSONB)
RETURNS SETOF public.shot_list_items
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_project  UUID;
  v_archived TIMESTAMPTZ;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'items must be a JSON array' USING ERRCODE = '22023';
  END IF;

  SELECT l.project_id, l.archived_at INTO v_project, v_archived FROM public.shot_lists l WHERE l.id = p_list;
  IF v_project IS NULL THEN
    RAISE EXCEPTION 'shot list not found' USING ERRCODE = 'P0002';
  END IF;
  -- Said out loud (review round 1): the items policies already refuse an
  -- archived list's writes, but a DELETE the policy filters out, or an empty
  -- set, would otherwise succeed in silence. Same sentence as every backend.
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'this shot list is archived — restore it before changing it' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  INSERT INTO public.shot_list_items AS t (id, shot_list_id, project_id, scene_id, shot_id, position)
  SELECT COALESCE((e ->> 'id')::uuid, gen_random_uuid()),
         p_list,
         v_project,
         NULLIF(e ->> 'scene_id', '')::uuid,
         NULLIF(e ->> 'shot_id', '')::uuid,
         COALESCE((e ->> 'position')::int, (ord - 1)::int)
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS x(e, ord)
  ON CONFLICT (id) DO UPDATE
     SET scene_id = EXCLUDED.scene_id,
         shot_id  = EXCLUDED.shot_id,
         position = EXCLUDED.position
   WHERE t.shot_list_id = EXCLUDED.shot_list_id
  RETURNING t.*;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_shot_list_items(UUID, JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.upsert_shot_list_items(UUID, JSONB) TO authenticated, service_role;

COMMENT ON FUNCTION public.upsert_shot_list_items(UUID, JSONB) IS
  '0084 (review R1): write ONLY the named items of one list ([{id?, scene_id | shot_id, position?}]) — insert new ids, update existing ones of THIS list, skip ids of another list, delete nothing. SECURITY INVOKER: every row passes shot_list_items'' own policies (incl. the archived-list freeze). Returns the rows written.';


-- ── 10f. passes_project_privacy — its caller roll-call ────────────────────────
-- 0082's COMMENT names its callers so the next reader finds every definer
-- that restates the privacy arm; 0084 adds three. The function itself is NOT
-- redefined (0082 owns it; 0082's post-conditions pin its body).
COMMENT ON FUNCTION public.passes_project_privacy(UUID) IS
  '0082: the privacy arm of projects_select (0072) — the project is not private, or the caller created it, or the caller is a workspace admin — restated for SECURITY DEFINER bodies, which bypass RLS and cannot delegate to the policy (a SECURITY INVOKER helper called from a definer body runs as the owner). Callers: milestones_trash_index, fn_trash_authz (0082); set_active_shot_list, archive_shot_list, archive_edit (0084). Keep it word-for-word with the policy; suite 82 and 0082''s post-conditions pin both. No client role executes it.';


-- =============================================================================
-- 11. BACKFILL (D11) — "Shot list 1 · v1", active, for every project with
--     scenes or shots
-- =============================================================================
--
-- Every project that has at least one scene OR shot and no shot list yet gets
-- one list holding every scene (position = scene_number order) and every shot
-- (position = shot_number order within its scene, and within the "Unlinked
-- shots" bucket), made active. No edit is created. Trashed projects are
-- included: a restore must bring back a project whose Scenes tab behaves as it
-- did. "Or shots" is one step wider than the brief's "with scenes": a project
-- whose only rows are unlinked shots would otherwise be the one project where
-- the list and the scenes disagree.
--
-- A FUNCTION, not an anonymous block, so a pgTAP suite can seed scenes and
-- call it (CI applies migrations to an EMPTY database, so the call below backfills
-- nothing there; suite 84 is what proves the logic). No client role may call
-- it: it writes lists into every project in every workspace. SECURITY INVOKER —
-- it runs as whoever calls it (the migration owner, the suite as postgres).
--
-- Idempotent: a project that already has any shot list is skipped, so a re-run
-- (or a replay after people have edited their lists) touches nothing.
--
-- The pointer update is armed per project with the same GUC the RPC uses, so
-- the §7b guard sees an authorised change. It bumps each backfilled project's
-- updated_at / last_updated and writes one edit_history row with no actor —
-- the truthful record of a system change.
--
-- The post-condition is checked INSIDE the function, against exactly the lists
-- this call created (a re-run on edited lists must not fail it): each holds
-- every scene and shot of its project exactly once, and is the active list.
-- A failure raises, so the whole call — every list it made — rolls back.

CREATE OR REPLACE FUNCTION public.backfill_shot_lists()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  r       RECORD;
  v_list  UUID;
  v_lists UUID[] := '{}';
  v_bad   INT;
BEGIN
  FOR r IN
    SELECT p.id AS project_id, p.workspace_id
      FROM public.projects p
     WHERE (EXISTS (SELECT 1 FROM public.scenes s WHERE s.project_id = p.id)
            OR EXISTS (SELECT 1 FROM public.shots sh WHERE sh.project_id = p.id))
       AND NOT EXISTS (SELECT 1 FROM public.shot_lists l WHERE l.project_id = p.id)
     ORDER BY p.id
  LOOP
    INSERT INTO public.shot_lists (project_id, workspace_id, title, version, summary)
    VALUES (r.project_id, r.workspace_id, 'Shot list 1', 1, 'Created from existing scenes')
    RETURNING id INTO v_list;
    v_lists := v_lists || v_list;

    INSERT INTO public.shot_list_items (shot_list_id, project_id, workspace_id, scene_id, position)
    SELECT v_list, r.project_id, r.workspace_id, s.id,
           (row_number() OVER (ORDER BY s.scene_number NULLS LAST, s.sort_order, s.created_at, s.id) - 1)::int
      FROM public.scenes s
     WHERE s.project_id = r.project_id;

    INSERT INTO public.shot_list_items (shot_list_id, project_id, workspace_id, shot_id, position)
    SELECT v_list, r.project_id, r.workspace_id, sh.id,
           (row_number() OVER (PARTITION BY sh.scene_id
                               ORDER BY sh.shot_number NULLS LAST, sh.sort_order, sh.created_at, sh.id) - 1)::int
      FROM public.shots sh
     WHERE sh.project_id = r.project_id;

    PERFORM set_config('wilson.shot_list_activate', r.project_id::text, true);
    UPDATE public.projects SET active_shot_list_id = v_list
     WHERE id = r.project_id AND active_shot_list_id IS NULL;
  END LOOP;
  PERFORM set_config('wilson.shot_list_activate', '', true);

  SELECT count(*) INTO v_bad
    FROM unnest(v_lists) AS u(list_id)
    JOIN public.shot_lists l ON l.id = u.list_id
   WHERE (SELECT count(*) FROM public.scenes s WHERE s.project_id = l.project_id)
           <> (SELECT count(*) FROM public.shot_list_items i
                WHERE i.shot_list_id = l.id AND i.scene_id IS NOT NULL)
      OR (SELECT count(*) FROM public.shots s WHERE s.project_id = l.project_id)
           <> (SELECT count(*) FROM public.shot_list_items i
                WHERE i.shot_list_id = l.id AND i.shot_id IS NOT NULL)
      OR NOT EXISTS (SELECT 1 FROM public.projects p
                      WHERE p.id = l.project_id AND p.active_shot_list_id = l.id);
  IF v_bad > 0 THEN
    RAISE EXCEPTION '0084 backfill post-condition failed: % backfilled list(s) do not hold every scene and shot of their project exactly once, or are not active', v_bad;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.projects p
     WHERE (EXISTS (SELECT 1 FROM public.scenes s WHERE s.project_id = p.id)
            OR EXISTS (SELECT 1 FROM public.shots sh WHERE sh.project_id = p.id))
       AND NOT EXISTS (SELECT 1 FROM public.shot_lists l WHERE l.project_id = p.id)
  ) THEN
    RAISE EXCEPTION '0084 backfill post-condition failed: a project with scenes or shots still has no shot list';
  END IF;

  RETURN coalesce(array_length(v_lists, 1), 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.backfill_shot_lists() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.backfill_shot_lists() TO service_role;

COMMENT ON FUNCTION public.backfill_shot_lists() IS
  '0084 (D11): give every project that has scenes or shots and no shot list "Shot list 1 · v1" (summary "Created from existing scenes") holding every scene and shot in today''s order, and make it active. Idempotent (skips projects with any list); raises and rolls back if a list it made is incomplete. Run once by 0084; no client role may execute it.';

DO $$
DECLARE
  v_made INT;
BEGIN
  v_made := public.backfill_shot_lists();
  RAISE NOTICE '0084 backfill: % project(s) given "Shot list 1 · v1"', v_made;
END $$;


-- =============================================================================
-- 12. POST-CONDITIONS — scan the catalogue, do not assume (S22)
-- =============================================================================

DO $$
DECLARE
  t        TEXT;
  v_n      INT;
  v_body   TEXT;
  v_hits   INT;
  v_expect INT;
BEGIN
  -- 12a. the three tables: RLS enabled + forced, the exact policy count, no
  --      FOR ALL, anon holds nothing, the stamp and audit triggers are armed.
  FOREACH t IN ARRAY ARRAY['shot_lists', 'shot_list_items', 'edits'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION '0084 post-condition failed: table % missing', t;
    END IF;
    SELECT count(*) INTO v_n FROM pg_class
     WHERE oid = ('public.' || t)::regclass AND relrowsecurity AND relforcerowsecurity;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '0084 post-condition failed: % lacks ENABLE+FORCE row level security', t;
    END IF;
    SELECT count(*) INTO v_n FROM pg_policies
     WHERE schemaname = 'public' AND tablename = t AND cmd = 'ALL';
    IF v_n <> 0 THEN
      RAISE EXCEPTION '0084 post-condition failed: % has a FOR ALL policy', t;
    END IF;
    v_expect := CASE t WHEN 'shot_list_items' THEN 4 ELSE 3 END;
    SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = t;
    IF v_n <> v_expect THEN
      RAISE EXCEPTION '0084 post-condition failed: % has % policies, expected %', t, v_n, v_expect;
    END IF;
    -- every write policy hops to projects (the 0082 §3b lesson)
    SELECT count(*) INTO v_n FROM pg_policies
     WHERE schemaname = 'public' AND tablename = t AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
       AND (position('projects' IN COALESCE(with_check, qual, '')) = 0
            OR position('can_edit_shot_lists' IN COALESCE(with_check, qual, '')) = 0
            OR (cmd = 'UPDATE' AND (position('projects' IN COALESCE(qual, '')) = 0
                                    OR position('can_edit_shot_lists' IN COALESCE(qual, '')) = 0)));
    IF v_n <> 0 THEN
      RAISE EXCEPTION '0084 post-condition failed: a write policy on % lacks the projects hop or the can_edit_shot_lists gate', t;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema = 'public' AND table_name = t AND grantee IN ('anon', 'PUBLIC')) THEN
      RAISE EXCEPTION '0084 post-condition failed: anon or PUBLIC holds privileges on %', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = ('public.' || t)::regclass
                      AND NOT tgisinternal AND tgname = 'trg_' || t || '_populate_workspace')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = ('public.' || t)::regclass
                      AND NOT tgisinternal AND tgname = 'trg_' || t || '_audit') THEN
      RAISE EXCEPTION '0084 post-condition failed: % lacks its workspace-stamp or audit trigger', t;
    END IF;
  END LOOP;

  -- 12b. archive-only: no DELETE grant for authenticated on lists and edits.
  IF has_table_privilege('authenticated', 'public.shot_lists', 'DELETE')
     OR has_table_privilege('authenticated', 'public.edits', 'DELETE') THEN
    RAISE EXCEPTION '0084 post-condition failed: authenticated can DELETE shot_lists or edits (archive only, D4/D18)';
  END IF;

  -- 12c. the guards are armed.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.shot_lists'::regclass
                    AND tgname = 'trg_shot_lists_guard' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.edits'::regclass
                    AND tgname = 'trg_edits_guard' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.projects'::regclass
                    AND tgname = 'trg_projects_active_shot_list_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '0084 post-condition failed: a guard trigger is missing';
  END IF;

  -- 12d. the gate: SECURITY DEFINER, names the reviewer seat (comments
  --      stripped first — 0077 §3c: a commented-out arm has passed a body
  --      check before), anon cannot execute, authenticated can.
  v_body := pg_get_functiondef('public.can_edit_shot_lists(uuid)'::regprocedure);
  v_body := regexp_replace(v_body, '/\*.*?\*/', '', 'gs');
  v_body := regexp_replace(v_body, '--[^' || chr(10) || ']*', '', 'g');
  IF v_body NOT LIKE '%''reviewer''%' OR v_body NOT LIKE '%project_is_staffed%' THEN
    RAISE EXCEPTION '0084 post-condition failed: can_edit_shot_lists lost the reviewer seat or the unstaffed opening';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.can_edit_shot_lists(uuid)'::regprocedure AND prosecdef) THEN
    RAISE EXCEPTION '0084 post-condition failed: can_edit_shot_lists must be SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'public.can_edit_shot_lists(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.can_edit_shot_lists(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0084 post-condition failed: can_edit_shot_lists privileges are wrong';
  END IF;

  -- 12e. the three definer RPCs: SECURITY DEFINER, call passes_project_privacy
  --      exactly once (comment-stripped), check the seat, anon cannot execute,
  --      authenticated can. The invoker helper is NOT a definer.
  FOREACH t IN ARRAY ARRAY['public.set_active_shot_list(uuid, uuid)',
                           'public.archive_shot_list(uuid, boolean)',
                           'public.archive_edit(uuid, boolean)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = t::regprocedure AND prosecdef) THEN
      RAISE EXCEPTION '0084 post-condition failed: % must be SECURITY DEFINER', t;
    END IF;
    v_body := pg_get_functiondef(t::regprocedure);
    v_body := regexp_replace(v_body, '/\*.*?\*/', '', 'gs');
    v_body := regexp_replace(v_body, '--[^' || chr(10) || ']*', '', 'g');
    v_hits := (length(v_body) - length(replace(v_body, 'passes_project_privacy(', '')))
              / length('passes_project_privacy(');
    IF v_hits <> 1 THEN
      RAISE EXCEPTION '0084 post-condition failed: % names passes_project_privacy % times (expected 1)', t, v_hits;
    END IF;
    IF v_body NOT LIKE '%has_active_membership(v_ws)%'
       OR v_body NOT LIKE '%p.deleted_at IS NULL%'
       OR v_body NOT LIKE '%p.workspace_id = v_ws%'
       OR v_body NOT LIKE '%current_app_role() = ''admin''%'
       OR v_body NOT LIKE '%project_role_for(%) = ''manager''%' THEN
      RAISE EXCEPTION '0084 post-condition failed: % lost an arm of its read gate or its seat check', t;
    END IF;
    IF has_function_privilege('anon', t, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', t, 'EXECUTE') THEN
      RAISE EXCEPTION '0084 post-condition failed: % privileges are wrong', t;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.replace_shot_list_items(uuid, jsonb)'::regprocedure AND prosecdef) THEN
    RAISE EXCEPTION '0084 post-condition failed: replace_shot_list_items must stay SECURITY INVOKER';
  END IF;
  IF has_function_privilege('anon', 'public.replace_shot_list_items(uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '0084 post-condition failed: anon can execute replace_shot_list_items';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.upsert_shot_list_items(uuid, jsonb)'::regprocedure AND prosecdef)
     OR has_function_privilege('anon', 'public.upsert_shot_list_items(uuid, jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.upsert_shot_list_items(uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '0084 post-condition failed: upsert_shot_list_items must be SECURITY INVOKER, executable by authenticated and not by anon';
  END IF;

  -- 12g. the archived-list freeze on every items write policy (review R1),
  --      and the D6 chain indexes.
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'shot_list_items' AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
     AND (position('archived_at' IN COALESCE(with_check, qual, '')) = 0
          OR (cmd = 'UPDATE' AND position('archived_at' IN COALESCE(qual, '')) = 0));
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0084 post-condition failed: a shot_list_items write policy lacks the archived-list freeze';
  END IF;
  IF to_regclass('public.edits_one_child_key') IS NULL OR to_regclass('public.edits_one_root_per_list_key') IS NULL THEN
    RAISE EXCEPTION '0084 post-condition failed: the D6 one-chain indexes are missing';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_projects_active_shot_list_guard()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_shot_list_archive_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION '0084 post-condition failed: a client role can execute a guard trigger function';
  END IF;

  -- 12f. the link columns and their same-project FKs.
  FOREACH t IN ARRAY ARRAY['projects.active_shot_list_id', 'tasks.scene_id', 'tasks.shot_id',
                           'assets.scene_ids', 'assets.shot_ids',
                           'budget_versions.shot_list_id', 'budget_versions.summary'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = split_part(t, '.', 1)
                      AND column_name = split_part(t, '.', 2)) THEN
      RAISE EXCEPTION '0084 post-condition failed: column % missing', t;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE contype = 'f' AND conname IN (
     'projects_active_shot_list_fk', 'tasks_scene_fk', 'tasks_shot_fk',
     'budget_versions_shot_list_fk', 'shot_list_items_list_fk', 'shot_list_items_scene_fk',
     'shot_list_items_shot_fk', 'edits_list_fk', 'edits_parent_same_list_fk')
     AND array_length(conkey, 1) = 2;
  IF v_n <> 9 THEN
    RAISE EXCEPTION '0084 post-condition failed: expected 9 two-column same-project FKs, found %', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'assets'
                AND column_name IN ('scene_ids', 'shot_ids') AND is_nullable = 'YES') THEN
    RAISE EXCEPTION '0084 post-condition failed: assets.scene_ids / shot_ids must be NOT NULL (default {})';
  END IF;

  RAISE NOTICE '0084 OK: shot_lists / shot_list_items / edits under RLS (3/4/3 policies, every write hops), can_edit_shot_lists admits reviewers, three manager/admin RPCs with the privacy arm, the active-list and archive guards armed, 9 same-project FKs.';
END $$;
