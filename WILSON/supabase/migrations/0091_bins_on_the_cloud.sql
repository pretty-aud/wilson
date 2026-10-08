-- =============================================================================
-- 0091_bins_on_the_cloud.sql — Bins on the cloud, bundle BC1 (2026-10-07).
--
-- Bins, bin files and shot takes exist today only in the desktop app's
-- signed-out Local Server mode (electron/rabbitBins.cjs, the project bundle's
-- `bins` / `binFiles` / `binRoots` / `shotTakes`). Audrey's A9 — "i need the
-- system to work the same if im using a cloud based solution or a NAS server"
-- — and her B answers of 2026-10-05/06 (docs/design/BINS_CLOUD_QUESTIONS.md,
-- verbatim; the plan is docs/design/BINS_CLOUD_PLAN.md) put the LISTS AND THE
-- LOGGING in the cloud while the FOOTAGE STAYS ON THE COMPANY'S SERVER.
--
-- HER RULINGS THAT SHAPE THIS FILE
-- --------------------------------
--   B1  "the footage would live in the server. so the user is going to just
--       pull the path in the server not the actual files themselves" — a
--       cloud clip is a REFERENCE: a footage LOCATION plus a relative path.
--       Nothing here holds a byte of footage.
--   B2  A location is saved by its NETWORK ADDRESS (\\server\footage), named,
--       never as a drive letter — the same string on every computer on the
--       network. bin_locations.unc_path's CHECK refuses anything else.
--   B4  "if the user allows external access pictures are fine. never take
--       images when external access is denied" — a clip's small picture goes
--       to rabbit-thumbnails ONLY in a workspace whose admin has turned
--       remote viewing on. A DATABASE rule: the RESTRICTIVE storage policies
--       in §9, not a client courtesy.
--   B5a The admin's switch, per company, off by default:
--       workspaces.remote_viewing_enabled.
--   B6  Reviewers may do everything members may in bins. The gate is
--       can_edit_shot_lists() (0084), which admits reviewers. No new gate.
--   B7  Live: bins, bin_files and shot_takes join the project broadcast.
--   B10 Removing a clip never touches the file on the server. A bin's delete
--       cascades to its files' ROWS; a file's delete cascades to its takes.
--   B12 The signed-out desktop is unchanged: its bundle keeps source_path and
--       binRoots; nothing here reaches it.
--
-- WHAT THIS ADDS
-- --------------
--   1. workspaces.remote_viewing_enabled (B5a) + rabbit_remote_viewing_enabled()
--   2. public.bin_locations   per WORKSPACE: a named network share
--   3. public.bins            per project: a tree of containers
--   4. public.bin_files       per project: a reference (location + relative
--                             path) with the logging, the technical columns
--                             and the poster's key
--   5. public.shot_takes      bin files assigned to shots, ordered, with a role
--   6. The gc hook: a removed clip's poster is queued for disposal (0053's
--      rule — derived content must not outlive its source)
--   7. RLS on the four, the private-projects arm through the projects hop
--   8. Realtime for the three project tables (0077's mechanism)
--   9. The POSTER POLICIES (B4): RESTRICTIVE INSERT and UPDATE on
--      rabbit-thumbnails for keys whose entity segment is bin_files
--  10. SECURITY INVOKER RPCs for the writes that must be one transaction:
--      delete_bin, reorder_bins, add_bin_files, move_bin_files,
--      copy_bin_files, restore_bin_files, assign_shot_takes,
--      update_shot_take, remove_shot_takes, reorder_shot_takes,
--      replace_shot_takes (and fn_normalize_shot_takes behind them)
--  11. Post-conditions
--
-- DECISIONS THE BRIEF LEFT TO THIS FILE, AND WHY
-- ---------------------------------------------
--   * bin_locations is WRITTEN by anyone past can_edit_shot_lists() on any
--     project of the workspace they can see (the policy hops through
--     projects under the caller's RLS, so a private project they cannot see
--     does not count). A location is the company's, not one project's, and
--     the person adding clips from a share is the person who first names it;
--     B6 says a reviewer may add clips, so a reviewer may name a share.
--     Removing a location that still has clips is REFUSED (the FK is
--     ON DELETE RESTRICT): a clip can never lose its address.
--   * bin_files.poster_path is a column the brief's list does not name. The
--     poster's key carries a timestamp and a name
--     (projects/{project}/bin_files/{id}/{ts}-{name}), so without a column
--     the browser could not find a clip's picture — the files table's
--     thumbnail_url precedent. Its CHECK keeps a row from claiming a key
--     outside its own project's bin_files prefix.
--   * A bin's tree is kept acyclic by a BEFORE trigger; reorder_bins detaches
--     every named bin first so a legitimate reorder never trips it.
--   * Takes: the Local Server keeps a removed file's takes as orphans for an
--     undo to bring back. Here the FKs CASCADE (the brief), so removal
--     answers carry the takes that went with them (`removedTakes`) and the
--     provider snapshots takes before a removal for its undo.
--   * relative_path uses forward slashes ('/'), never a backslash or a drive
--     letter, so one string resolves on every platform; the desktop joins it
--     onto unc_path with its own separator.
--
-- ORDERING — depends on:
--   0001 fn_audit_touch, workspaces; 0004 fn_populate_workspace_from_project,
--   has_active_membership (0008's form); 0008 current_app_role; 0013
--   project_role_for; 0014 the live-parent SELECT shape; 0040 scenes / shots;
--   0042 fn_try_uuid, rabbit_money_segment; 0044 projects UNIQUE (id,
--   workspace_id); 0051/0054 storage_gc_queue (+ kind); 0053 the
--   rabbit-thumbnails bucket; 0072 projects.is_private; 0082
--   passes_project_privacy; 0084 can_edit_shot_lists AND the composite keys
--   scenes_id_project_key / shots_id_project_key; 0088 the current body of
--   fn_realtime_broadcast (file_row_is_money) — restated whole below.
-- The pre-flight refuses to run without 0084's gate, 0082's arm and the
-- composite keys. Nothing depends on this one yet.
--
-- Numbers: 0091 / suites 93 (bins, bin_files, bin_locations, the switch) and
-- 94 (shot_takes, the poster policy both ways, the RPCs). 0079 and 0080,
-- reserved on paper for bins and assemblies, are RETIRED (BINS_CLOUD_PLAN §2):
-- 0079 would sort before migrations already applied everywhere. Next free
-- after this: 0092 / suite 95.
-- Idempotent: IF NOT EXISTS, guarded ALTERs, CREATE OR REPLACE, DROP-then-
-- CREATE for triggers and policies. No backfill: the cloud has no bins yet.
-- =============================================================================


-- =============================================================================
-- 0. PRE-FLIGHT — refuse to run on a target that lacks what this file calls
-- =============================================================================
DO $$
BEGIN
  IF to_regprocedure('public.can_edit_shot_lists(uuid)') IS NULL THEN
    RAISE EXCEPTION '0091 pre-flight failed: public.can_edit_shot_lists(uuid) is missing — apply 0084 first';
  END IF;
  IF to_regprocedure('public.passes_project_privacy(uuid)') IS NULL THEN
    RAISE EXCEPTION '0091 pre-flight failed: public.passes_project_privacy(uuid) is missing — apply 0082 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'projects'
                    AND column_name = 'is_private') THEN
    RAISE EXCEPTION '0091 pre-flight failed: projects.is_private is missing — apply 0072 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scenes_id_project_key')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shots_id_project_key') THEN
    RAISE EXCEPTION '0091 pre-flight failed: the composite keys on scenes / shots are missing — apply 0084 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'rabbit-thumbnails') THEN
    RAISE EXCEPTION '0091 pre-flight failed: the rabbit-thumbnails bucket is missing — apply 0053 first';
  END IF;
  IF to_regprocedure('public.fn_try_uuid(text)') IS NULL
     OR to_regprocedure('public.rabbit_money_segment(text)') IS NULL THEN
    RAISE EXCEPTION '0091 pre-flight failed: fn_try_uuid / rabbit_money_segment missing — apply 0042 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'storage_gc_queue'
                    AND column_name = 'kind') THEN
    RAISE EXCEPTION '0091 pre-flight failed: storage_gc_queue.kind is missing — apply 0054 first';
  END IF;
  IF to_regprocedure('public.file_row_is_money(boolean, text)') IS NULL THEN
    RAISE EXCEPTION '0091 pre-flight failed: file_row_is_money is missing — apply 0088 first (fn_realtime_broadcast is restated here from its 0088 body)';
  END IF;
END $$;


-- =============================================================================
-- 1. THE SWITCH — workspaces.remote_viewing_enabled (B5a)
-- =============================================================================
-- "Allow files to be viewed from outside the office network." Off by default.
-- Read by the poster policies now (§9) and by the file gateway later (BC4).
--
-- WHO MAY FLIP IT — measured, not assumed: workspaces_admin_update (0020)
-- is the only client UPDATE policy on workspaces and admits a workspace ADMIN
-- only (id = current_workspace_id(), current_app_role() = 'admin', an active
-- membership); workspaces_operator_update (0029) admits platform operators.
-- fn_workspaces_client_guard (0020/0048) pins the columns a client may never
-- change; this one is meant to be changed by an admin, so it is not added
-- there. No new policy and no new trigger: §11 pins that the admin policy
-- still names 'admin', and suite 93 proves a member's UPDATE changes nothing
-- while an admin's lands.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS remote_viewing_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.workspaces.remote_viewing_enabled IS
  '0091 (Audrey''s B5a, 2026-10-06): "Allow files to be viewed from outside the office network." Off by default; changed by a workspace admin only (workspaces_admin_update, 0020). While it is OFF no picture of a clip may be uploaded to rabbit-thumbnails (the RESTRICTIVE poster policies, B4) and the file gateway (BC4) answers only inside the network. It is the TPN compliance boundary and the control says so.';

-- The poster policies ask this as a function, SECURITY DEFINER, so the answer
-- does not depend on whether the caller may read the workspaces row. Strictly
-- boolean: a NULL under a RESTRICTIVE policy denies (0055's lesson), which is
-- the right direction here, but COALESCE says so in words.
CREATE OR REPLACE FUNCTION public.rabbit_remote_viewing_enabled(p_project UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT w.remote_viewing_enabled
      FROM public.projects p
      JOIN public.workspaces w ON w.id = p.workspace_id
     WHERE p.id = p_project
       -- Not an oracle across companies: SECURITY DEFINER reads past
       -- RLS, so the answer is for an active member of the project's
       -- workspace only — anyone else reads false, the same as for a
       -- project that does not exist. (A member may read the column on
       -- their own workspaces row anyway; this adds nothing for them.)
       AND public.has_active_membership(p.workspace_id)
  ), false);
$$;

REVOKE ALL ON FUNCTION public.rabbit_remote_viewing_enabled(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rabbit_remote_viewing_enabled(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.rabbit_remote_viewing_enabled(UUID) IS
  '0091: whether the workspace that owns p_project has remote viewing on (B5a). SECURITY DEFINER so the storage policies can ask it whatever the caller may read; false for an unknown project and for a caller who is not an active member of its workspace (no oracle across companies).';


-- =============================================================================
-- 2. bin_locations — a named network share, per WORKSPACE (B2)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.bin_locations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  -- The network address: \\server\share or deeper. Never a drive letter —
  -- Z: means something different on every machine (B2, and the storage
  -- design's reason for refusing drive letters). The CHECK is 0041's path
  -- shape applied to a UNC path: it must begin with two backslashes, each
  -- segment must be non-empty and free of the characters Windows forbids in
  -- a name (and of the forward slash), no segment may be . or .., and it
  -- cannot end in a backslash.
  unc_path      TEXT NOT NULL,
  added_by      UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT bin_locations_id_workspace_key UNIQUE (id, workspace_id),
  CONSTRAINT bin_locations_name_not_blank_chk CHECK (btrim(name) <> ''),
  CONSTRAINT bin_locations_unc_path_shape_chk CHECK (
    unc_path ~ '^\\\\[^\\/:*?"<>|]+(\\[^\\/:*?"<>|]+)+$'
    AND unc_path !~ '(^|\\)\.\.?(\\|$)'
    AND length(unc_path) <= 1024
  )
);

-- One row per share per company, whatever the case it was typed in.
CREATE UNIQUE INDEX IF NOT EXISTS bin_locations_workspace_unc_key
  ON public.bin_locations (workspace_id, lower(unc_path));

COMMENT ON TABLE public.bin_locations IS
  '0091 (B2): a company''s footage locations — a NAME and a NETWORK ADDRESS (\\server\share), never a drive letter. A cloud bin file is a location plus a relative path; unc_path + relative_path is the same string on every computer on the network. Readable by every member of the workspace; written by anyone who may edit shot lists on a project of the workspace they can see (can_edit_shot_lists, B6). A location that still has clips cannot be removed (bin_files_location_fk is ON DELETE RESTRICT).';
COMMENT ON COLUMN public.bin_locations.unc_path IS
  'The share''s network address, \\server\share[\folder…]. CHECK: begins with two backslashes, non-empty segments without \ / : * ? " < > |, no . or .. segment, no trailing backslash, at most 1024 characters. Unique per workspace, compared lower-cased.';

CREATE OR REPLACE FUNCTION public.fn_bin_locations_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.added_by IS NULL THEN NEW.added_by := auth.uid(); END IF;
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.updated_at := COALESCE(NEW.updated_at, now());
  ELSE
    NEW.updated_at := now();
  END IF;
  NEW.name := regexp_replace(NEW.name, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  NEW.unc_path := regexp_replace(NEW.unc_path, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_bin_locations_touch() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bin_locations_touch ON public.bin_locations;
CREATE TRIGGER trg_bin_locations_touch
  BEFORE INSERT OR UPDATE ON public.bin_locations
  FOR EACH ROW EXECUTE FUNCTION public.fn_bin_locations_touch();


-- =============================================================================
-- 3. bins — the tree of containers, per project
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.bins (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES public.projects(id)   ON DELETE CASCADE,
  workspace_id   UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  kind           TEXT NOT NULL DEFAULT 'other',
  color          TEXT,
  parent_bin_id  UUID,
  sort_order     INTEGER NOT NULL DEFAULT 0,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID,

  -- The composite target for every child's same-project FK (0084 §1).
  CONSTRAINT bins_id_project_key UNIQUE (id, project_id),
  -- A bin's parent is a bin of the SAME project; deleting a bin takes its
  -- children (and, through bin_files_bin_fk, their files' rows — never a
  -- byte, B10).
  CONSTRAINT bins_parent_fk
    FOREIGN KEY (parent_bin_id, project_id) REFERENCES public.bins (id, project_id) ON DELETE CASCADE,
  CONSTRAINT bins_project_workspace_fk
    FOREIGN KEY (project_id, workspace_id) REFERENCES public.projects (id, workspace_id),
  CONSTRAINT bins_name_not_blank_chk CHECK (btrim(name) <> ''),
  CONSTRAINT bins_kind_chk CHECK (kind IN ('footage', 'audio', 'stills', 'graphics', 'vfx', 'selects', 'other')),
  CONSTRAINT bins_color_chk CHECK (color IS NULL OR color IN ('red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink')),
  CONSTRAINT bins_not_own_parent_chk CHECK (parent_bin_id IS NULL OR parent_bin_id <> id)
);

CREATE INDEX IF NOT EXISTS bins_project_idx ON public.bins (project_id);
CREATE INDEX IF NOT EXISTS bins_parent_idx  ON public.bins (parent_bin_id) WHERE parent_bin_id IS NOT NULL;

COMMENT ON TABLE public.bins IS
  '0091: a project''s bins (docs/BINS_DESIGN.md §4.4) — a tree (parent_bin_id, same-project composite FK, CASCADE) of named containers with a kind and a label colour. Deleting a bin deletes its children and its files'' ROWS; the footage on the server is never touched (B10). Written past can_edit_shot_lists() — reviewers included (B6).';

-- A bin cannot be inside itself. BEFORE, immediate: a single PATCH that
-- would close a loop is refused at once; reorder_bins (§10) detaches every
-- named bin before re-attaching, so a legitimate reorder never passes
-- through a loop. SECURITY DEFINER so the walk reads every ancestor whatever
-- the caller's RLS shows (it reads ids only). Bounded.
CREATE OR REPLACE FUNCTION public.fn_bins_cycle_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cur UUID := NEW.parent_bin_id;
  v_n   INT  := 0;
BEGIN
  WHILE v_cur IS NOT NULL AND v_n < 10000 LOOP
    IF v_cur = NEW.id THEN
      RAISE EXCEPTION 'a bin cannot be inside itself' USING ERRCODE = '23514';
    END IF;
    SELECT b.parent_bin_id INTO v_cur FROM public.bins b WHERE b.id = v_cur;
    v_n := v_n + 1;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_bins_cycle_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bins_cycle_guard ON public.bins;
CREATE TRIGGER trg_bins_cycle_guard
  BEFORE INSERT OR UPDATE OF parent_bin_id ON public.bins
  FOR EACH ROW EXECUTE FUNCTION public.fn_bins_cycle_guard();

DROP TRIGGER IF EXISTS trg_bins_populate_workspace ON public.bins;
CREATE TRIGGER trg_bins_populate_workspace
  BEFORE INSERT ON public.bins
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_from_project();

DROP TRIGGER IF EXISTS trg_bins_audit ON public.bins;
CREATE TRIGGER trg_bins_audit
  BEFORE INSERT OR UPDATE ON public.bins
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_touch();


-- =============================================================================
-- 4. bin_files — a reference to a file where it sits, with the logging
-- =============================================================================
-- Every column of docs/BINS_DESIGN.md §4.4 except source_path, which becomes
-- location_id + relative_path (B1/B2), plus poster_path (the picture's key in
-- rabbit-thumbnails, B4). `online` is never stored: it is a fact about the
-- computer reading the row, not about the row.

CREATE TABLE IF NOT EXISTS public.bin_files (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES public.projects(id)   ON DELETE CASCADE,
  workspace_id      UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  bin_id            UUID NOT NULL,
  location_id       UUID NOT NULL,
  -- Inside the location, with forward slashes: 'A001/A001_C001.mov', or the
  -- folder of a frame sequence. Never absolute, never a drive letter, never
  -- a traversal (the CHECK, 0041's shape).
  relative_path     TEXT NOT NULL,

  display_name      TEXT NOT NULL,
  original_name     TEXT NOT NULL,
  extension         TEXT NOT NULL DEFAULT '',
  mime_type         TEXT,
  is_sequence       BOOLEAN NOT NULL DEFAULT false,
  sequence_pattern  TEXT,
  frame_count       INTEGER,
  size_bytes        BIGINT,
  mtime             TIMESTAMPTZ,
  media_type        TEXT NOT NULL DEFAULT 'other',
  tags              TEXT[] NOT NULL DEFAULT '{}',
  scene_id          UUID,
  shot_id           UUID,
  slate             TEXT,
  take_number       INTEGER,
  take_modifier     TEXT,
  camera            TEXT,
  roll              TEXT,
  shoot_day         DATE,
  description       TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  review_flag       TEXT NOT NULL DEFAULT 'unflagged',
  circled           BOOLEAN NOT NULL DEFAULT false,
  color             TEXT,
  duration_sec      DOUBLE PRECISION,
  width             INTEGER,
  height            INTEGER,
  fps               DOUBLE PRECISION,
  codec             TEXT,
  timecode_start    TEXT,
  probe_status      TEXT NOT NULL DEFAULT 'pending',
  sort_order        INTEGER NOT NULL DEFAULT 0,
  -- The poster's key in rabbit-thumbnails:
  -- projects/{project_id}/bin_files/{bin_file_id}/{ts}-{name}. NULL until a
  -- computer that can reach the file uploads one — and that upload lands
  -- only while the workspace's switch is on (§9).
  poster_path       TEXT,

  added_by          UUID,
  added_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT bin_files_id_project_key UNIQUE (id, project_id),
  CONSTRAINT bin_files_bin_fk
    FOREIGN KEY (bin_id, project_id) REFERENCES public.bins (id, project_id) ON DELETE CASCADE,
  -- A clip names a location of its OWN workspace, and a location with clips
  -- cannot be removed: the clip would lose its address.
  CONSTRAINT bin_files_location_fk
    FOREIGN KEY (location_id, workspace_id) REFERENCES public.bin_locations (id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT bin_files_scene_fk
    FOREIGN KEY (scene_id, project_id) REFERENCES public.scenes (id, project_id) ON DELETE SET NULL (scene_id),
  CONSTRAINT bin_files_shot_fk
    FOREIGN KEY (shot_id, project_id) REFERENCES public.shots (id, project_id) ON DELETE SET NULL (shot_id),
  CONSTRAINT bin_files_project_workspace_fk
    FOREIGN KEY (project_id, workspace_id) REFERENCES public.projects (id, workspace_id),
  CONSTRAINT bin_files_relative_path_shape_chk CHECK (
    relative_path <> ''
    AND relative_path !~ '(^/|/$|//|\\|:)'
    AND relative_path !~ '(^|/)\.\.?(/|$)'
    AND length(relative_path) <= 1024
  ),
  CONSTRAINT bin_files_display_name_not_blank_chk CHECK (btrim(display_name) <> ''),
  CONSTRAINT bin_files_media_type_chk CHECK (media_type IN ('video', 'still', 'sequence', 'audio', 'graphic', 'vfx', 'document', 'other')),
  CONSTRAINT bin_files_review_flag_chk CHECK (review_flag IN ('unflagged', 'select', 'reject')),
  CONSTRAINT bin_files_color_chk CHECK (color IS NULL OR color IN ('red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink')),
  CONSTRAINT bin_files_probe_status_chk CHECK (probe_status IN ('pending', 'done', 'failed', 'unavailable')),
  CONSTRAINT bin_files_take_number_chk CHECK (take_number IS NULL OR take_number > 0),
  CONSTRAINT bin_files_tags_len_chk CHECK (cardinality(tags) <= 50),
  -- The picture a row names is in ITS project's bin_files prefix. A copy
  -- (an instance of the same file) may share its sibling's picture; a row
  -- can never point at another project's.
  CONSTRAINT bin_files_poster_path_shape_chk CHECK (
    poster_path IS NULL
    OR (poster_path LIKE 'projects/' || project_id::text || '/bin_files/%'
        AND poster_path !~ '(//|\.\.|\\)'
        AND length(poster_path) <= 1024)
  )
);

CREATE INDEX IF NOT EXISTS bin_files_project_idx  ON public.bin_files (project_id);
CREATE INDEX IF NOT EXISTS bin_files_bin_idx      ON public.bin_files (bin_id, sort_order);
CREATE INDEX IF NOT EXISTS bin_files_location_idx ON public.bin_files (location_id);
CREATE INDEX IF NOT EXISTS bin_files_shot_idx     ON public.bin_files (shot_id)  WHERE shot_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS bin_files_scene_idx    ON public.bin_files (scene_id) WHERE scene_id IS NOT NULL;
-- The duplicate check (B8: same location, same file) — one index serves it
-- on the server side too, compared lower-cased as Windows shares are.
CREATE INDEX IF NOT EXISTS bin_files_location_path_idx ON public.bin_files (location_id, lower(relative_path));

COMMENT ON TABLE public.bin_files IS
  '0091: a REFERENCE to a clip, still, audio file, sequence folder or document where it sits on the company''s server (B1): location_id (bin_locations, the share) + relative_path (inside it, forward slashes), with the logging (slate, take, camera, flags, colour, notes…) and the technical columns read on the computer that added it. Instances of one file are separate rows (copy_bin_files). `online` is never stored. Deleting the row never touches the file (B10); the row''s poster (poster_path) is queued for disposal. Written past can_edit_shot_lists() (B6).';
COMMENT ON COLUMN public.bin_files.relative_path IS
  'Inside the location, forward slashes, no leading or trailing slash, no . or .. segment, no backslash or colon (so never a drive letter). The desktop resolves unc_path + relative_path with its own separator.';
COMMENT ON COLUMN public.bin_files.poster_path IS
  'The clip''s small picture in rabbit-thumbnails: projects/{project_id}/bin_files/{bin_file_id}/{ts}-{name}, NULL until one is uploaded. The upload is admitted only while the workspace''s remote_viewing_enabled is on (B4, the RESTRICTIVE poster policies); a teammate on the office network makes their own locally either way. CHECK: inside this project''s bin_files prefix.';

CREATE OR REPLACE FUNCTION public.fn_bin_files_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.added_by IS NULL THEN NEW.added_by := auth.uid(); END IF;
    NEW.added_at := COALESCE(NEW.added_at, now());
    NEW.updated_at := COALESCE(NEW.updated_at, now());
  ELSE
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_bin_files_touch() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bin_files_populate_workspace ON public.bin_files;
CREATE TRIGGER trg_bin_files_populate_workspace
  BEFORE INSERT ON public.bin_files
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_from_project();

DROP TRIGGER IF EXISTS trg_bin_files_touch ON public.bin_files;
CREATE TRIGGER trg_bin_files_touch
  BEFORE INSERT OR UPDATE ON public.bin_files
  FOR EACH ROW EXECUTE FUNCTION public.fn_bin_files_touch();


-- =============================================================================
-- 5. shot_takes — bin files assigned to shots (milestone 2 of the bins)
-- =============================================================================
-- One shot may have several takes, one take may serve several shots (§6 Q6);
-- ordered by position; `role` primary | part | alt, exactly one primary per
-- shot that has any. The RPCs in §10 keep that invariant on every write
-- (fn_normalize_shot_takes), as rabbitBins.cjs does on the desktop.

CREATE TABLE IF NOT EXISTS public.shot_takes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES public.projects(id)   ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  shot_id       UUID NOT NULL,
  bin_file_id   UUID NOT NULL,
  role          TEXT NOT NULL DEFAULT 'alt',
  position      INTEGER NOT NULL DEFAULT 0,
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT shot_takes_shot_file_key UNIQUE (shot_id, bin_file_id),
  -- A take cannot point at another project's shot or file (0084 §1's pair).
  CONSTRAINT shot_takes_shot_fk
    FOREIGN KEY (shot_id, project_id) REFERENCES public.shots (id, project_id) ON DELETE CASCADE,
  CONSTRAINT shot_takes_file_fk
    FOREIGN KEY (bin_file_id, project_id) REFERENCES public.bin_files (id, project_id) ON DELETE CASCADE,
  CONSTRAINT shot_takes_project_workspace_fk
    FOREIGN KEY (project_id, workspace_id) REFERENCES public.projects (id, workspace_id),
  CONSTRAINT shot_takes_role_chk CHECK (role IN ('primary', 'part', 'alt')),
  CONSTRAINT shot_takes_position_nonneg_chk CHECK (position >= 0)
);

CREATE INDEX IF NOT EXISTS shot_takes_project_idx ON public.shot_takes (project_id);
CREATE INDEX IF NOT EXISTS shot_takes_shot_idx    ON public.shot_takes (shot_id, position);
CREATE INDEX IF NOT EXISTS shot_takes_file_idx    ON public.shot_takes (bin_file_id);

COMMENT ON TABLE public.shot_takes IS
  '0091: a bin file assigned to a shot, many-to-many, ordered by position, with a role (primary — the take the shot is cut from, exactly one per shot that has any; part — one piece of a shot rebuilt from several; alt — a spare). Same-project composite FKs; CASCADE from the shot and from the file. Written through the SECURITY INVOKER RPCs (assign_shot_takes…), which re-establish the one-primary / 0..n-1 invariant after every write.';

CREATE OR REPLACE FUNCTION public.fn_shot_takes_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.updated_at := COALESCE(NEW.updated_at, now());
  ELSE
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_shot_takes_touch() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_shot_takes_populate_workspace ON public.shot_takes;
CREATE TRIGGER trg_shot_takes_populate_workspace
  BEFORE INSERT ON public.shot_takes
  FOR EACH ROW EXECUTE FUNCTION public.fn_populate_workspace_from_project();

DROP TRIGGER IF EXISTS trg_shot_takes_touch ON public.shot_takes;
CREATE TRIGGER trg_shot_takes_touch
  BEFORE INSERT OR UPDATE ON public.shot_takes
  FOR EACH ROW EXECUTE FUNCTION public.fn_shot_takes_touch();


-- =============================================================================
-- 6. A removed clip's poster is queued for disposal
-- =============================================================================
-- 0053's rule (TPN-CONT-011): derived content must not outlive what it was
-- made from. The footage is untouched (B10); the POSTER is WILSON's own
-- object and is metered (0055), so it goes on the same queue a file's
-- thumbnail goes on, kind 'thumbnail', provider 'supabase' — storage-gc's
-- drain checks files.thumbnail_url for a restorability claim, finds none,
-- and removes it. file_id is NULL: the row is not a files row. A failed
-- enqueue never aborts the delete (0051's contract).
-- storage-gc's ORPHAN SCAN walks rabbit-files only, so a live poster in
-- rabbit-thumbnails is never mistaken for garbage (measured in BC1).

CREATE OR REPLACE FUNCTION public.fn_bin_files_gc_enqueue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- An INSTANCE (copy_bin_files) shares its sibling's picture: the object is
  -- queued only when no other row names it any more. This body runs as its
  -- owner, so it sees every row whatever the deleting caller may read.
  IF OLD.poster_path IS NOT NULL AND btrim(OLD.poster_path) <> ''
     AND NOT EXISTS (SELECT 1 FROM public.bin_files f
                      WHERE f.poster_path = OLD.poster_path AND f.id <> OLD.id) THEN
    INSERT INTO public.storage_gc_queue (bucket_id, object_path, workspace_id, file_id, reason, provider, kind)
    VALUES ('rabbit-thumbnails', OLD.poster_path, OLD.workspace_id, NULL, 'file-purged', 'supabase', 'thumbnail');
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'storage_gc enqueue failed for bin file %: %', OLD.id, SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_bin_files_gc_enqueue() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bin_files_gc_enqueue ON public.bin_files;
CREATE TRIGGER trg_bin_files_gc_enqueue
  AFTER DELETE ON public.bin_files
  FOR EACH ROW
  WHEN (OLD.poster_path IS NOT NULL)
  EXECUTE FUNCTION public.fn_bin_files_gc_enqueue();

COMMENT ON FUNCTION public.fn_bin_files_gc_enqueue() IS
  '0091: when a bin_files row is deleted (removed, or taken by its bin''s delete) and no other row names its picture, its poster in rabbit-thumbnails is queued for disposal (storage_gc_queue, kind thumbnail, file_id NULL). The footage on the server is never touched. Never aborts the delete.';


-- =============================================================================
-- 7. RLS — the four tables
-- =============================================================================
-- Separate policies per command, never FOR ALL (0029). SELECT on the three
-- project tables hops to the live PROJECT under the caller's RLS (the
-- 0014/0040 shape), so a trashed project hides its bins and 0072's private-
-- project arm reaches these rows with no policy of their own. EVERY WRITE
-- policy hops too (the 0082 §3b / 0083 lesson: an insert with
-- return=minimal consults no SELECT policy). The gate is can_edit_shot_lists
-- (B6: reviewers may do everything members may). UPDATE's WITH CHECK is
-- identical to its USING (0044).
--
-- bin_locations is a WORKSPACE table: read by every active member; written
-- by anyone who passes the gate on a project of the workspace THEY CAN SEE —
-- the EXISTS over projects runs under the caller's RLS, so a private project
-- they are seated on but cannot see does not open the door.

ALTER TABLE public.bin_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bin_locations FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.bins          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bins          FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.bin_files     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bin_files     FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.shot_takes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shot_takes    FORCE  ROW LEVEL SECURITY;

-- ── 7a. bin_locations ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS bin_locations_select ON public.bin_locations;
CREATE POLICY bin_locations_select ON public.bin_locations
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
  );

DROP POLICY IF EXISTS bin_locations_insert ON public.bin_locations;
CREATE POLICY bin_locations_insert ON public.bin_locations
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND EXISTS (SELECT 1 FROM public.projects p
                 WHERE p.workspace_id = bin_locations.workspace_id
                   AND public.can_edit_shot_lists(p.id))
  );

DROP POLICY IF EXISTS bin_locations_update ON public.bin_locations;
CREATE POLICY bin_locations_update ON public.bin_locations
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND EXISTS (SELECT 1 FROM public.projects p
                 WHERE p.workspace_id = bin_locations.workspace_id
                   AND public.can_edit_shot_lists(p.id))
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND EXISTS (SELECT 1 FROM public.projects p
                 WHERE p.workspace_id = bin_locations.workspace_id
                   AND public.can_edit_shot_lists(p.id))
  );

DROP POLICY IF EXISTS bin_locations_delete ON public.bin_locations;
CREATE POLICY bin_locations_delete ON public.bin_locations
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND EXISTS (SELECT 1 FROM public.projects p
                 WHERE p.workspace_id = bin_locations.workspace_id
                   AND public.can_edit_shot_lists(p.id))
  );

-- ── 7b. bins ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS bins_select ON public.bins;
CREATE POLICY bins_select ON public.bins
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = bins.project_id)
  );

DROP POLICY IF EXISTS bins_insert ON public.bins;
CREATE POLICY bins_insert ON public.bins
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_edit_shot_lists(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = bins.project_id)
  );

DROP POLICY IF EXISTS bins_update ON public.bins;
CREATE POLICY bins_update ON public.bins
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_edit_shot_lists(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = bins.project_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_edit_shot_lists(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = bins.project_id)
  );

DROP POLICY IF EXISTS bins_delete ON public.bins;
CREATE POLICY bins_delete ON public.bins
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_edit_shot_lists(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = bins.project_id)
  );

-- ── 7c. bin_files ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS bin_files_select ON public.bin_files;
CREATE POLICY bin_files_select ON public.bin_files
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = bin_files.project_id)
  );

DROP POLICY IF EXISTS bin_files_insert ON public.bin_files;
CREATE POLICY bin_files_insert ON public.bin_files
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_edit_shot_lists(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = bin_files.project_id)
  );

DROP POLICY IF EXISTS bin_files_update ON public.bin_files;
CREATE POLICY bin_files_update ON public.bin_files
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_edit_shot_lists(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = bin_files.project_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_edit_shot_lists(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = bin_files.project_id)
  );

DROP POLICY IF EXISTS bin_files_delete ON public.bin_files;
CREATE POLICY bin_files_delete ON public.bin_files
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_edit_shot_lists(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = bin_files.project_id)
  );

-- ── 7d. shot_takes ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS shot_takes_select ON public.shot_takes;
CREATE POLICY shot_takes_select ON public.shot_takes
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = shot_takes.project_id)
  );

DROP POLICY IF EXISTS shot_takes_insert ON public.shot_takes;
CREATE POLICY shot_takes_insert ON public.shot_takes
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_edit_shot_lists(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = shot_takes.project_id)
  );

DROP POLICY IF EXISTS shot_takes_update ON public.shot_takes;
CREATE POLICY shot_takes_update ON public.shot_takes
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_edit_shot_lists(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = shot_takes.project_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_edit_shot_lists(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = shot_takes.project_id)
  );

DROP POLICY IF EXISTS shot_takes_delete ON public.shot_takes;
CREATE POLICY shot_takes_delete ON public.shot_takes
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.can_edit_shot_lists(project_id)
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = shot_takes.project_id)
  );

-- ── 7e. Privileges (0033 disarmed the defaults; the revoke is stated, PUBLIC
--        included — the S22 grantee lesson) ─────────────────────────────────
REVOKE ALL ON public.bin_locations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.bins          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.bin_files     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.shot_takes    FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bin_locations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bins          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bin_files     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shot_takes    TO authenticated;

GRANT ALL ON public.bin_locations TO service_role;
GRANT ALL ON public.bins          TO service_role;
GRANT ALL ON public.bin_files     TO service_role;
GRANT ALL ON public.shot_takes    TO service_role;


-- =============================================================================
-- 8. REALTIME — the three project tables join the broadcast (B7)
-- =============================================================================
-- 0088's body of fn_realtime_broadcast, reproduced whole (Postgres has no
-- "add an arm"), with bins, bin_files and shot_takes joining the plain
-- project_id arm: each has its own project_id. Every other arm is untouched,
-- and §11 asserts every one of the FIFTEEN names appears exactly once (the
-- 0077 §3d invariant: CASE takes the first match). bin_locations is a
-- workspace table and is NOT broadcast: a location is named once; the
-- client re-reads the list on open.

CREATE OR REPLACE FUNCTION public.fn_realtime_broadcast()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     JSONB;
  v_project UUID;
BEGIN
  -- Environments without the realtime schema (db-only CI stack) skip
  -- silently. Probes for the FUNCTION, not just the schema — a stack carrying
  -- the schema without broadcast_changes would pass a schema-only check and
  -- then raise a WARNING on every single write.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'realtime' AND p.proname = 'broadcast_changes'
  ) THEN
    RETURN NULL;
  END IF;

  -- PG14+: the unassigned side of NEW/OLD reads as NULL in row triggers.
  v_row := COALESCE(to_jsonb(NEW), to_jsonb(OLD));

  CASE TG_TABLE_NAME
    WHEN 'projects' THEN
      v_project := (v_row ->> 'id')::uuid;
    -- 0077: milestones joins this arm. It has its own project_id (0067).
    -- 0091: bins, bin_files and shot_takes join it too (B7: a flag or a take
    -- appears for everyone without reloading).
    WHEN 'phases', 'assets', 'tasks', 'project_members', 'milestones',
         'bins', 'bin_files', 'shot_takes' THEN
      v_project := (v_row ->> 'project_id')::uuid;
    -- 0088: files has its own arm. A money row — the flag or a locked folder,
    -- on either side of the write — is never put on the project channel.
    WHEN 'files' THEN
      IF public.file_row_is_money((to_jsonb(NEW) ->> 'is_financial')::boolean,
                                  to_jsonb(NEW) ->> 'storage_path')
         OR public.file_row_is_money((to_jsonb(OLD) ->> 'is_financial')::boolean,
                                     to_jsonb(OLD) ->> 'storage_path') THEN
        RETURN NULL;
      END IF;
      v_project := (v_row ->> 'project_id')::uuid;
    WHEN 'comments' THEN
      v_project := public.fn_comment_project_id(
        v_row ->> 'entity_type', (v_row ->> 'entity_id')::uuid);
    WHEN 'task_dependencies' THEN
      SELECT t.project_id INTO v_project FROM public.tasks t
       WHERE t.id = (v_row ->> 'predecessor_id')::uuid;
    -- 0061: the phase sibling. Resolves through phases, not tasks.
    WHEN 'phase_dependencies' THEN
      SELECT ph.project_id INTO v_project FROM public.phases ph
       WHERE ph.id = (v_row ->> 'predecessor_id')::uuid;
    WHEN 'task_links' THEN
      SELECT t.project_id INTO v_project FROM public.tasks t
       WHERE t.id = (v_row ->> 'task_id')::uuid;
    WHEN 'asset_versions' THEN
      SELECT a.project_id INTO v_project FROM public.assets a
       WHERE a.id = (v_row ->> 'asset_id')::uuid;
    ELSE
      v_project := NULL;
  END CASE;

  -- Unroutable (cascade delete with the parent already gone, dead-end comment
  -- walk): skip. The subtree's own parent event already told clients
  -- everything they need.
  IF v_project IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM realtime.broadcast_changes(
    'rabbit:project:' || v_project::text,
    TG_OP, TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD
  );

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Same resilience contract as fn_edit_history_capture (0012): a broadcast
  -- failure NEVER aborts the user's write. A missed event degrades to the
  -- reconnect refetch path on the client. (And a money test that raises
  -- broadcasts nothing: the arm above fails closed.)
  RAISE WARNING 'realtime broadcast failed for %.% (%): %',
    TG_TABLE_NAME, v_row ->> 'id', TG_OP, SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_realtime_broadcast() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bins_realtime ON public.bins;
CREATE TRIGGER trg_bins_realtime
  AFTER INSERT OR UPDATE OR DELETE ON public.bins
  FOR EACH ROW EXECUTE FUNCTION public.fn_realtime_broadcast();

DROP TRIGGER IF EXISTS trg_bin_files_realtime ON public.bin_files;
CREATE TRIGGER trg_bin_files_realtime
  AFTER INSERT OR UPDATE OR DELETE ON public.bin_files
  FOR EACH ROW EXECUTE FUNCTION public.fn_realtime_broadcast();

DROP TRIGGER IF EXISTS trg_shot_takes_realtime ON public.shot_takes;
CREATE TRIGGER trg_shot_takes_realtime
  AFTER INSERT OR UPDATE OR DELETE ON public.shot_takes
  FOR EACH ROW EXECUTE FUNCTION public.fn_realtime_broadcast();

COMMENT ON FUNCTION public.fn_realtime_broadcast() IS
  'Session 7 (0016): publishes every write on the project-scoped RABBIT tables to the private topic rabbit:project:{project_id} via realtime.broadcast_changes. Full old/new rows — soft deletes and restores deliver, unlike postgres_changes under the 0014 SELECT policies. Never aborts the write. FIFTEEN tables as of 0091: projects, phases, assets, tasks, files (0088: money rows excluded), comments, task_dependencies, phase_dependencies (0061), task_links, asset_versions, project_members, milestones (0077), bins, bin_files, shot_takes (0091).';


-- =============================================================================
-- 9. THE POSTER POLICIES (B4) — RESTRICTIVE, on rabbit-thumbnails
-- =============================================================================
-- "never take images when external access is denied." The permissive
-- rabbit_thumbnails_* policies (0053) admit any project writer's thumbnail;
-- permissive policies OR together, so a NINTH permissive policy could refuse
-- nothing (the 0038 inversion, 0055's lesson). These are AS RESTRICTIVE: they
-- AND over the permissive set. Self-limiting first (0055 §7's rule — a
-- restrictive policy is evaluated for EVERY insert into storage.objects):
-- another bucket, or another entity segment, passes untouched. For a key
-- whose THIRD segment is bin_files, the upload lands only while the
-- workspace that owns the project in the SECOND segment has remote viewing
-- on. Reading an existing poster stays on the bucket's project-membership
-- SELECT policy, as every other entity's thumbnail does.
--
-- The names do not start with rabbit_thumbnails: 0053's post-condition 3,
-- 0055's post-condition 6 and suites 63 / 65 count that prefix and require
-- exactly 8.

DROP POLICY IF EXISTS petal_bin_posters_remote_viewing_insert ON storage.objects;
CREATE POLICY petal_bin_posters_remote_viewing_insert ON storage.objects
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    bucket_id <> 'rabbit-thumbnails'
    OR (storage.foldername(name))[3] IS DISTINCT FROM 'bin_files'
    OR public.rabbit_remote_viewing_enabled(public.fn_try_uuid((storage.foldername(name))[2]))
  );

DROP POLICY IF EXISTS petal_bin_posters_remote_viewing_update ON storage.objects;
CREATE POLICY petal_bin_posters_remote_viewing_update ON storage.objects
  AS RESTRICTIVE
  FOR UPDATE
  USING (
    bucket_id <> 'rabbit-thumbnails'
    OR (storage.foldername(name))[3] IS DISTINCT FROM 'bin_files'
    OR public.rabbit_remote_viewing_enabled(public.fn_try_uuid((storage.foldername(name))[2]))
  )
  WITH CHECK (
    bucket_id <> 'rabbit-thumbnails'
    OR (storage.foldername(name))[3] IS DISTINCT FROM 'bin_files'
    OR public.rabbit_remote_viewing_enabled(public.fn_try_uuid((storage.foldername(name))[2]))
  );

COMMENT ON POLICY petal_bin_posters_remote_viewing_insert ON storage.objects IS
  '0091 (Audrey''s B4): a bin file''s poster may be put in rabbit-thumbnails only while the owning workspace''s remote_viewing_enabled is on. RESTRICTIVE: it ANDs over the permissive rabbit_thumbnails_* policies; passes for every other bucket and every other entity segment.';
COMMENT ON POLICY petal_bin_posters_remote_viewing_update ON storage.objects IS
  '0091 (B4): the same rule for an in-place regeneration of a bin file''s poster.';

-- ── 9b. The reviewer's way in (B6) ─────────────────────────────────────────
-- 0053's permissive rabbit_thumbnails_insert / _update admit a project
-- WRITER (can_write_project), which a reviewer is not. B6 says a reviewer may
-- add a clip, and the computer that adds a clip is the one that makes its
-- picture — so for the bin_files segment alone a PERMISSIVE pair admits
-- anyone past can_edit_shot_lists on the key's project (the same gate as the
-- rows). It opens nothing else: the key must sit under projects/{a project
-- the caller can read}/bin_files/, the money segment is impossible there
-- (bin_files is not one), and the RESTRICTIVE pair above still ANDs the
-- switch over it. Reading stays rabbit_thumbnails_select's (membership).

DROP POLICY IF EXISTS petal_bin_posters_insert ON storage.objects;
CREATE POLICY petal_bin_posters_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'rabbit-thumbnails'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND (storage.foldername(name))[3] = 'bin_files'
    AND NOT public.rabbit_money_segment((storage.foldername(name))[3])
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = public.fn_try_uuid((storage.foldername(name))[2])
    )
    AND public.has_active_membership(public.current_workspace_id())
    AND public.can_edit_shot_lists(public.fn_try_uuid((storage.foldername(name))[2]))
  );

DROP POLICY IF EXISTS petal_bin_posters_update ON storage.objects;
CREATE POLICY petal_bin_posters_update ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'rabbit-thumbnails'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND (storage.foldername(name))[3] = 'bin_files'
    AND NOT public.rabbit_money_segment((storage.foldername(name))[3])
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = public.fn_try_uuid((storage.foldername(name))[2])
    )
    AND public.has_active_membership(public.current_workspace_id())
    AND public.can_edit_shot_lists(public.fn_try_uuid((storage.foldername(name))[2]))
  )
  WITH CHECK (
    bucket_id = 'rabbit-thumbnails'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = 'projects'
    AND (storage.foldername(name))[3] = 'bin_files'
    AND NOT public.rabbit_money_segment((storage.foldername(name))[3])
    AND EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = public.fn_try_uuid((storage.foldername(name))[2])
    )
    AND public.has_active_membership(public.current_workspace_id())
    AND public.can_edit_shot_lists(public.fn_try_uuid((storage.foldername(name))[2]))
  );

COMMENT ON POLICY petal_bin_posters_insert ON storage.objects IS
  '0091 (B6): a bin file''s poster may be written by anyone past can_edit_shot_lists on the key''s project — reviewers included, as for the rows. Permissive, for the bin_files segment only; the RESTRICTIVE switch policies still AND over it.';
COMMENT ON POLICY petal_bin_posters_update ON storage.objects IS
  '0091 (B6): the same for an in-place regeneration.';


-- =============================================================================
-- 10. THE RPCs — SECURITY INVOKER, the tables'' own policies apply
-- =============================================================================
-- Each is one transaction over several rows (a bin''s delete with its files
-- moved, a take assignment that demotes a sibling, a reorder) — over plain
-- PostgREST those would be several requests that can half-land. Every row
-- they touch passes the tables'' own policies as the caller: they grant
-- nothing. Refusals carry a SQLSTATE the client maps: P0002 not found,
-- 22023 a bad argument, 42501 a write RLS filtered to nothing. The answers
-- are the Local Server''s shapes (electron/rabbitBins.cjs), so the provider
-- reads one shape whichever backend answered.

-- ── 10a. small readers of a JSON value: NULL unless it is what it should be ─
CREATE OR REPLACE FUNCTION public.fn_bins_json_number(j JSONB)
RETURNS NUMERIC
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE WHEN j IS NOT NULL AND jsonb_typeof(j) = 'number' THEN (j #>> '{}')::numeric ELSE NULL END;
$$;

CREATE OR REPLACE FUNCTION public.fn_bins_json_timestamp(j JSONB)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  IF j IS NULL OR jsonb_typeof(j) <> 'string' THEN RETURN NULL; END IF;
  RETURN (j #>> '{}')::timestamptz;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_bins_json_uuid(j JSONB)
RETURNS UUID
LANGUAGE sql STABLE
AS $$
  SELECT CASE WHEN j IS NOT NULL AND jsonb_typeof(j) = 'string' THEN public.fn_try_uuid(j #>> '{}') ELSE NULL END;
$$;

REVOKE ALL ON FUNCTION public.fn_bins_json_number(JSONB)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bins_json_timestamp(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bins_json_uuid(JSONB)      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bins_json_number(JSONB)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bins_json_timestamp(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bins_json_uuid(JSONB)      TO authenticated, service_role;

-- ── 10b. The takes of a set of shots, as every take RPC answers ─────────────
CREATE OR REPLACE FUNCTION public.fn_shot_takes_answer(p_shots UUID[])
RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'affectedShotIds', COALESCE((SELECT jsonb_agg(DISTINCT s) FROM unnest(p_shots) AS s), '[]'::jsonb),
    'shotTakes', COALESCE((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.shot_id, t.position, t.created_at, t.id)
        FROM public.shot_takes t
       WHERE t.shot_id = ANY(p_shots)), '[]'::jsonb),
    'orphanTakes', '[]'::jsonb);
$$;
REVOKE ALL ON FUNCTION public.fn_shot_takes_answer(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_shot_takes_answer(UUID[]) TO authenticated, service_role;

-- ── 10c. The invariant: positions 0..n-1 in (position, created_at, id)
--         order; exactly one primary — p_prefer when it claims the role,
--         else the first claimant, else the first take; a demoted claimant
--         becomes alt, never part (rabbitBins.cjs normalizeShotTakes) ────────
CREATE OR REPLACE FUNCTION public.fn_normalize_shot_takes(p_shot UUID, p_prefer UUID DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_primary UUID;
  v_i       INT := 0;
  v_role    TEXT;
  r         RECORD;
BEGIN
  IF p_prefer IS NOT NULL THEN
    SELECT t.id INTO v_primary FROM public.shot_takes t
     WHERE t.shot_id = p_shot AND t.id = p_prefer AND t.role = 'primary';
  END IF;
  IF v_primary IS NULL THEN
    SELECT t.id INTO v_primary FROM public.shot_takes t
     WHERE t.shot_id = p_shot AND t.role = 'primary'
     ORDER BY t.position, t.created_at, t.id LIMIT 1;
  END IF;
  IF v_primary IS NULL THEN
    SELECT t.id INTO v_primary FROM public.shot_takes t
     WHERE t.shot_id = p_shot
     ORDER BY t.position, t.created_at, t.id LIMIT 1;
  END IF;
  IF v_primary IS NULL THEN
    RETURN;
  END IF;
  FOR r IN SELECT t.id, t.role, t.position FROM public.shot_takes t
            WHERE t.shot_id = p_shot ORDER BY t.position, t.created_at, t.id LOOP
    v_role := CASE WHEN r.id = v_primary THEN 'primary'
                   WHEN r.role = 'primary' THEN 'alt'
                   ELSE r.role END;
    IF r.position <> v_i OR r.role <> v_role THEN
      UPDATE public.shot_takes SET position = v_i, role = v_role WHERE id = r.id;
    END IF;
    v_i := v_i + 1;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_normalize_shot_takes(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_normalize_shot_takes(UUID, UUID) TO authenticated, service_role;

-- ── 10d. assign_shot_takes ─────────────────────────────────────────────────
-- Several files to one shot, one file to several shots, or any mix. The
-- whole batch is checked first; a pair already assigned is skipped, never
-- duplicated. The first take a shot gets is its primary; later ones alt
-- unless a role is given; asking for primary demotes the current one.
CREATE OR REPLACE FUNCTION public.assign_shot_takes(p_assignments JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  e          JSONB;
  v_shot     UUID;
  v_file     UUID;
  v_project  UUID;
  v_existing UUID;
  v_role     TEXT;
  v_n        INT;
  v_id       UUID;
  v_created  UUID[] := '{}';
  v_skipped  JSONB  := '[]'::jsonb;
  v_affected UUID[] := '{}';
BEGIN
  IF p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array' OR jsonb_array_length(p_assignments) = 0 THEN
    RAISE EXCEPTION 'assignments required' USING ERRCODE = '22023';
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p_assignments) AS x LOOP
    v_shot := public.fn_bins_json_uuid(e -> 'shot_id');
    v_file := public.fn_bins_json_uuid(e -> 'bin_file_id');
    IF v_shot IS NULL OR NOT EXISTS (SELECT 1 FROM public.shots s WHERE s.id = v_shot) THEN
      RAISE EXCEPTION 'shot % not found', COALESCE(e ->> 'shot_id', '(none)') USING ERRCODE = 'P0002';
    END IF;
    IF v_file IS NULL OR NOT EXISTS (SELECT 1 FROM public.bin_files f WHERE f.id = v_file) THEN
      RAISE EXCEPTION 'bin file % not found', COALESCE(e ->> 'bin_file_id', '(none)') USING ERRCODE = 'P0002';
    END IF;
  END LOOP;
  FOR e IN SELECT x FROM jsonb_array_elements(p_assignments) AS x LOOP
    v_shot := public.fn_bins_json_uuid(e -> 'shot_id');
    v_file := public.fn_bins_json_uuid(e -> 'bin_file_id');
    SELECT t.id INTO v_existing FROM public.shot_takes t
     WHERE t.shot_id = v_shot AND t.bin_file_id = v_file;
    IF v_existing IS NOT NULL THEN
      v_skipped := v_skipped || jsonb_build_object('shot_id', v_shot, 'bin_file_id', v_file,
                                                   'reason', 'already_assigned', 'id', v_existing);
      v_affected := array_append(v_affected, v_shot);
      v_existing := NULL;
      CONTINUE;
    END IF;
    SELECT count(*) INTO v_n FROM public.shot_takes t WHERE t.shot_id = v_shot;
    v_role := CASE WHEN (e ->> 'role') IN ('primary', 'part', 'alt') THEN e ->> 'role' ELSE NULL END;
    IF v_n = 0 THEN
      v_role := 'primary';
    ELSIF v_role IS NULL THEN
      v_role := 'alt';
    END IF;
    IF v_role = 'primary' AND v_n > 0 THEN
      UPDATE public.shot_takes SET role = 'alt' WHERE shot_id = v_shot AND role = 'primary';
    END IF;
    SELECT s.project_id INTO v_project FROM public.shots s WHERE s.id = v_shot;
    INSERT INTO public.shot_takes (project_id, shot_id, bin_file_id, role, position, notes)
    VALUES (v_project, v_shot, v_file, v_role, v_n, COALESCE(e ->> 'notes', ''))
    RETURNING id INTO v_id;
    v_created := array_append(v_created, v_id);
    v_affected := array_append(v_affected, v_shot);
    PERFORM public.fn_normalize_shot_takes(v_shot, v_id);
  END LOOP;
  RETURN public.fn_shot_takes_answer(v_affected) || jsonb_build_object(
    'created', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY array_position(v_created, t.id))
                           FROM public.shot_takes t WHERE t.id = ANY(v_created)), '[]'::jsonb),
    'skipped', v_skipped);
END;
$$;
REVOKE ALL ON FUNCTION public.assign_shot_takes(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_shot_takes(JSONB) TO authenticated, service_role;

-- ── 10e. update_shot_take — role / notes / position ─────────────────────────
-- Promoting a take to primary SWAPS roles with the current primary; demoting
-- the primary hands the role to the next take in order; the only take of a
-- shot stays primary whatever is asked. position moves the take within its
-- shot.
CREATE OR REPLACE FUNCTION public.update_shot_take(p_id UUID, p_patch JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_take public.shot_takes%ROWTYPE;
  v_next UUID;
  v_role TEXT;
  v_idx  INT;
  v_n    INT;
BEGIN
  SELECT * INTO v_take FROM public.shot_takes t WHERE t.id = p_id;
  IF v_take.id IS NULL THEN
    RAISE EXCEPTION 'shot-take not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'patch must be an object' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'role' AND COALESCE(p_patch ->> 'role', '') NOT IN ('primary', 'part', 'alt') THEN
    RAISE EXCEPTION 'role must be primary, part or alt' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'position' AND public.fn_bins_json_number(p_patch -> 'position') IS NULL THEN
    RAISE EXCEPTION 'position must be a number' USING ERRCODE = '22023';
  END IF;

  -- 🚨 RLS FILTERS an UPDATE rather than refusing it: a reader who passes the
  -- SELECT hop but not the write gate would otherwise get a quiet 200 with
  -- nothing changed. One probe write says so first (the S3a lesson).
  UPDATE public.shot_takes SET updated_at = now() WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'you cannot change this project''s takes' USING ERRCODE = '42501';
  END IF;

  IF p_patch ? 'notes' THEN
    UPDATE public.shot_takes SET notes = COALESCE(p_patch ->> 'notes', '') WHERE id = p_id;
  END IF;

  v_role := p_patch ->> 'role';
  IF p_patch ? 'role' AND v_role IS DISTINCT FROM v_take.role THEN
    IF v_role = 'primary' THEN
      UPDATE public.shot_takes SET role = v_take.role
       WHERE shot_id = v_take.shot_id AND role = 'primary' AND id <> p_id;
      UPDATE public.shot_takes SET role = 'primary' WHERE id = p_id;
    ELSIF v_take.role = 'primary' THEN
      SELECT t.id INTO v_next FROM public.shot_takes t
       WHERE t.shot_id = v_take.shot_id AND t.id <> p_id
       ORDER BY t.position, t.created_at, t.id LIMIT 1;
      IF v_next IS NOT NULL THEN
        UPDATE public.shot_takes SET role = 'primary' WHERE id = v_next;
        UPDATE public.shot_takes SET role = v_role WHERE id = p_id;
      END IF;
    ELSE
      UPDATE public.shot_takes SET role = v_role WHERE id = p_id;
    END IF;
  END IF;

  IF p_patch ? 'position' THEN
    SELECT count(*) INTO v_n FROM public.shot_takes t WHERE t.shot_id = v_take.shot_id AND t.id <> p_id;
    v_idx := GREATEST(0, LEAST(v_n, floor(public.fn_bins_json_number(p_patch -> 'position'))::int));
    WITH others AS (
      SELECT t.id, row_number() OVER (ORDER BY t.position, t.created_at, t.id) - 1 AS rn
        FROM public.shot_takes t WHERE t.shot_id = v_take.shot_id AND t.id <> p_id)
    UPDATE public.shot_takes t SET position = CASE WHEN o.rn < v_idx THEN o.rn ELSE o.rn + 1 END
      FROM others o WHERE t.id = o.id;
    UPDATE public.shot_takes SET position = v_idx WHERE id = p_id;
  END IF;

  PERFORM public.fn_normalize_shot_takes(v_take.shot_id, p_id);
  RETURN public.fn_shot_takes_answer(ARRAY[v_take.shot_id]) || jsonb_build_object(
    'take', (SELECT to_jsonb(t) FROM public.shot_takes t WHERE t.id = p_id));
END;
$$;
REVOKE ALL ON FUNCTION public.update_shot_take(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_shot_take(UUID, JSONB) TO authenticated, service_role;

-- ── 10f. remove_shot_takes — unassign; removing a primary promotes the next ─
CREATE OR REPLACE FUNCTION public.remove_shot_takes(p_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_removed  JSONB;
  v_affected UUID[];
  s          UUID;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RAISE EXCEPTION 'ids required' USING ERRCODE = '22023';
  END IF;
  -- The rows the caller may DELETE are the rows the delete policy shows:
  -- read them under that same filter, then delete exactly those.
  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.shot_id, t.position, t.id), array_agg(DISTINCT t.shot_id)
    INTO v_removed, v_affected
    FROM public.shot_takes t WHERE t.id = ANY(p_ids);
  IF v_removed IS NULL THEN
    RAISE EXCEPTION 'shot-take not found' USING ERRCODE = 'P0002';
  END IF;
  DELETE FROM public.shot_takes t WHERE t.id = ANY(p_ids);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'you cannot change this project''s takes' USING ERRCODE = '42501';
  END IF;
  FOREACH s IN ARRAY v_affected LOOP
    PERFORM public.fn_normalize_shot_takes(s, NULL);
  END LOOP;
  RETURN public.fn_shot_takes_answer(v_affected) || jsonb_build_object('removed', v_removed);
END;
$$;
REVOKE ALL ON FUNCTION public.remove_shot_takes(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_shot_takes(UUID[]) TO authenticated, service_role;

-- ── 10g. reorder_shot_takes — the listed ids take the given order; the rest
--         follow in the order they had; roles untouched ──────────────────────
CREATE OR REPLACE FUNCTION public.reorder_shot_takes(p_shot UUID, p_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  IF p_shot IS NULL OR p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RAISE EXCEPTION 'shot_id and ids required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shots s WHERE s.id = p_shot) THEN
    RAISE EXCEPTION 'shot not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shot_takes t WHERE t.shot_id = p_shot AND t.id = ANY(p_ids)) THEN
    RAISE EXCEPTION 'none of the ids is a take of that shot' USING ERRCODE = '22023';
  END IF;
  -- A reader past the SELECT hop but not the write gate: RLS would filter
  -- the UPDATE to nothing and this would answer 200 unchanged. Say so.
  UPDATE public.shot_takes SET updated_at = now() WHERE shot_id = p_shot AND id = ANY(p_ids);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'you cannot change this project''s takes' USING ERRCODE = '42501';
  END IF;
  WITH ordered AS (
    SELECT t.id,
           row_number() OVER (ORDER BY (array_position(p_ids, t.id) IS NULL),
                                       array_position(p_ids, t.id), t.position, t.created_at, t.id) - 1 AS rn
      FROM public.shot_takes t WHERE t.shot_id = p_shot)
  UPDATE public.shot_takes t SET position = o.rn
    FROM ordered o WHERE t.id = o.id AND t.position <> o.rn;
  PERFORM public.fn_normalize_shot_takes(p_shot, NULL);
  RETURN public.fn_shot_takes_answer(ARRAY[p_shot]);
END;
$$;
REVOKE ALL ON FUNCTION public.reorder_shot_takes(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_shot_takes(UUID, UUID[]) TO authenticated, service_role;

-- ── 10h. replace_shot_takes — the undo primitive: the named shots' rows
--         become exactly p_rows (ids kept where free) ───────────────────────
CREATE OR REPLACE FUNCTION public.replace_shot_takes(p_shots UUID[], p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  e         JSONB;
  s         UUID;
  v_shot    UUID;
  v_file    UUID;
  v_id      UUID;
  v_project UUID;
BEGIN
  IF p_shots IS NULL OR cardinality(p_shots) = 0 THEN
    RAISE EXCEPTION 'shotIds required' USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'rows must be a JSON array' USING ERRCODE = '22023';
  END IF;
  FOREACH s IN ARRAY p_shots LOOP
    SELECT sh.project_id INTO v_project FROM public.shots sh WHERE sh.id = s;
    IF v_project IS NULL THEN
      RAISE EXCEPTION 'shot % not found', s USING ERRCODE = 'P0002';
    END IF;
    -- A reader past the SELECT hop but not the write gate: the DELETE below
    -- would filter to nothing and a row the shot already holds would be
    -- skipped as "already there", so nothing would ever raise. The policies'
    -- own gate is asked first, in words (the tables still bind underneath).
    IF NOT (public.has_active_membership(public.current_workspace_id())
            AND public.can_edit_shot_lists(v_project)) THEN
      RAISE EXCEPTION 'you cannot change this project''s takes' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  DELETE FROM public.shot_takes t WHERE t.shot_id = ANY(p_shots);
  FOR e IN SELECT x FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS y(x, ord) ORDER BY ord LOOP
    v_shot := public.fn_bins_json_uuid(e -> 'shot_id');
    v_file := public.fn_bins_json_uuid(e -> 'bin_file_id');
    IF v_shot IS NULL OR NOT (v_shot = ANY(p_shots)) THEN CONTINUE; END IF;
    IF v_file IS NULL OR NOT EXISTS (SELECT 1 FROM public.bin_files f WHERE f.id = v_file) THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.shot_takes t WHERE t.shot_id = v_shot AND t.bin_file_id = v_file) THEN CONTINUE; END IF;
    v_id := public.fn_bins_json_uuid(e -> 'id');
    IF v_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.shot_takes t WHERE t.id = v_id) THEN v_id := NULL; END IF;
    SELECT sh.project_id INTO v_project FROM public.shots sh WHERE sh.id = v_shot;
    INSERT INTO public.shot_takes (id, project_id, shot_id, bin_file_id, role, position, notes, created_at)
    VALUES (COALESCE(v_id, gen_random_uuid()), v_project, v_shot, v_file,
            CASE WHEN (e ->> 'role') IN ('primary', 'part', 'alt') THEN e ->> 'role' ELSE 'alt' END,
            GREATEST(0, COALESCE(floor(public.fn_bins_json_number(e -> 'position'))::int, 0)),
            COALESCE(e ->> 'notes', ''),
            COALESCE(public.fn_bins_json_timestamp(e -> 'created_at'), now()));
  END LOOP;
  FOREACH s IN ARRAY p_shots LOOP
    PERFORM public.fn_normalize_shot_takes(s, NULL);
  END LOOP;
  RETURN public.fn_shot_takes_answer(p_shots);
END;
$$;
REVOKE ALL ON FUNCTION public.replace_shot_takes(UUID[], JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_shot_takes(UUID[], JSONB) TO authenticated, service_role;

-- ── 10i. delete_bin — a bin and its descendants; its files MOVED to a target
--         or REMOVED (their rows; never a byte, B10) ─────────────────────────
CREATE OR REPLACE FUNCTION public.delete_bin(p_bin UUID, p_mode TEXT DEFAULT 'remove', p_target UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_ids           UUID[];
  v_mode          TEXT := CASE WHEN p_mode = 'move' THEN 'move' ELSE 'remove' END;
  v_order         INT;
  v_moved         JSONB := '[]'::jsonb;
  v_removed_files JSONB := '[]'::jsonb;
  v_removed_takes JSONB := '[]'::jsonb;
  v_removed_bins  JSONB := '[]'::jsonb;
  r               RECORD;
BEGIN
  IF p_bin IS NULL OR NOT EXISTS (SELECT 1 FROM public.bins b WHERE b.id = p_bin) THEN
    RAISE EXCEPTION 'bin not found' USING ERRCODE = 'P0002';
  END IF;
  WITH RECURSIVE d AS (
    SELECT b.id FROM public.bins b WHERE b.id = p_bin
    UNION
    SELECT b.id FROM public.bins b JOIN d ON b.parent_bin_id = d.id)
  SELECT array_agg(d.id) INTO v_ids FROM d;

  IF v_mode = 'move' THEN
    IF p_target IS NULL OR p_target = ANY(v_ids)
       OR NOT EXISTS (SELECT 1 FROM public.bins b WHERE b.id = p_target) THEN
      RAISE EXCEPTION 'target bin must exist and be outside the deleted bin' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(max(f.sort_order), -1) + 1 INTO v_order FROM public.bin_files f WHERE f.bin_id = p_target;
    FOR r IN SELECT f.id, f.bin_id, f.sort_order FROM public.bin_files f
              WHERE f.bin_id = ANY(v_ids) ORDER BY f.sort_order, f.added_at, f.id LOOP
      UPDATE public.bin_files SET bin_id = p_target, sort_order = v_order WHERE id = r.id;
      IF NOT FOUND THEN RAISE EXCEPTION 'you cannot change this project''s bins' USING ERRCODE = '42501'; END IF;
      v_moved := v_moved || jsonb_build_object('id', r.id, 'from', r.bin_id,
                                               'sort_order', r.sort_order, 'new_sort_order', v_order);
      v_order := v_order + 1;
    END LOOP;
  ELSE
    SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.sort_order, f.id), '[]'::jsonb) INTO v_removed_files
      FROM public.bin_files f WHERE f.bin_id = ANY(v_ids);
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.shot_id, t.position, t.id), '[]'::jsonb) INTO v_removed_takes
      FROM public.shot_takes t JOIN public.bin_files f ON f.id = t.bin_file_id WHERE f.bin_id = ANY(v_ids);
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.sort_order, b.id), '[]'::jsonb) INTO v_removed_bins
    FROM public.bins b WHERE b.id = ANY(v_ids);

  DELETE FROM public.bins b WHERE b.id = p_bin;
  IF NOT FOUND THEN RAISE EXCEPTION 'you cannot change this project''s bins' USING ERRCODE = '42501'; END IF;

  RETURN jsonb_build_object('ok', true, 'removedBins', v_removed_bins, 'movedFiles', v_moved,
                            'removedFiles', v_removed_files, 'removedTakes', v_removed_takes);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_bin(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_bin(UUID, TEXT, UUID) TO authenticated, service_role;

-- ── 10j. reorder_bins — parents and sort orders for the named bins ──────────
-- Every named bin is DETACHED first, so re-attaching never passes through a
-- loop that is not in the final picture; the cycle guard then refuses only a
-- real one.
CREATE OR REPLACE FUNCTION public.reorder_bins(p_order JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  e         JSONB;
  v_id      UUID;
  v_parent  UUID;
  v_ids     UUID[] := '{}';
  v_project UUID;
BEGIN
  IF p_order IS NULL OR jsonb_typeof(p_order) <> 'array' OR jsonb_array_length(p_order) = 0 THEN
    RAISE EXCEPTION 'order required' USING ERRCODE = '22023';
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p_order) AS x LOOP
    v_id := public.fn_bins_json_uuid(e -> 'id');
    IF v_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.bins b WHERE b.id = v_id) THEN
      RAISE EXCEPTION 'bin % not found', COALESCE(e ->> 'id', '(none)') USING ERRCODE = '22023';
    END IF;
    v_parent := public.fn_bins_json_uuid(e -> 'parent_bin_id');
    IF v_parent IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.bins b WHERE b.id = v_parent) THEN
      RAISE EXCEPTION 'parent bin not found' USING ERRCODE = '22023';
    END IF;
    v_ids := array_append(v_ids, v_id);
  END LOOP;
  UPDATE public.bins SET parent_bin_id = NULL WHERE id = ANY(v_ids);
  FOR e IN SELECT x FROM jsonb_array_elements(p_order) AS x LOOP
    v_id := public.fn_bins_json_uuid(e -> 'id');
    UPDATE public.bins
       SET parent_bin_id = public.fn_bins_json_uuid(e -> 'parent_bin_id'),
           sort_order = COALESCE(floor(public.fn_bins_json_number(e -> 'sort_order'))::int, 0)
     WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'you cannot change this project''s bins' USING ERRCODE = '42501'; END IF;
  END LOOP;
  SELECT b.project_id INTO v_project FROM public.bins b WHERE b.id = v_ids[1];
  RETURN jsonb_build_object('ok', true, 'bins', COALESCE((
    SELECT jsonb_agg(to_jsonb(b) ORDER BY b.sort_order, b.id) FROM public.bins b WHERE b.project_id = v_project), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.reorder_bins(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_bins(JSONB) TO authenticated, service_role;

-- ── 10k. add_bin_files — confirmed items → rows (and sub-bins) ──────────────
-- An item: { location_id, relative_path, original_name?, extension?,
-- mime_type?, is_sequence?, sequence_pattern?, frame_count?, size_bytes?,
-- mtime?, media_type?, display_name?, tags?, scene_id?, shot_id?, slate?,
-- take_number?, take_modifier?, camera?, roll?, shoot_day?, description?,
-- notes?, review_flag?, circled?, color?, duration_sec?, width?, height?,
-- fps?, codec?, timecode_start?, probe_status?, sub_bin? }. `sub_bin`
-- ('Day01/stills') nests the row under bins named after the folders, made
-- here when p_create_sub_bins is true. The technical columns are what the
-- adding computer read (BC2); nothing here reads a file.
CREATE OR REPLACE FUNCTION public.add_bin_files(p_bin UUID, p_items JSONB, p_create_sub_bins BOOLEAN DEFAULT true)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_bin       public.bins%ROWTYPE;
  e           JSONB;
  v_loc       UUID;
  v_rel       TEXT;
  v_target    UUID;
  v_parent    UUID;
  v_seg       TEXT;
  v_child     UUID;
  v_is_seq    BOOLEAN;
  v_name      TEXT;
  v_ext       TEXT;
  v_order     INT;
  v_row       public.bin_files%ROWTYPE;
  v_created   JSONB := '[]'::jsonb;
  v_bins      JSONB := '[]'::jsonb;
  v_results   JSONB := '[]'::jsonb;
  v_tags      TEXT[];
BEGIN
  SELECT * INTO v_bin FROM public.bins b WHERE b.id = p_bin;
  IF v_bin.id IS NULL THEN
    RAISE EXCEPTION 'bin not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'items required' USING ERRCODE = '22023';
  END IF;

  FOR e IN SELECT x FROM jsonb_array_elements(p_items) WITH ORDINALITY AS y(x, ord) ORDER BY ord LOOP
    v_loc := public.fn_bins_json_uuid(e -> 'location_id');
    v_rel := NULLIF(btrim(COALESCE(e ->> 'relative_path', '')), '');
    IF v_loc IS NULL OR v_rel IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.bin_locations l WHERE l.id = v_loc AND l.workspace_id = v_bin.workspace_id) THEN
      v_results := v_results || jsonb_build_object('relative_path', e ->> 'relative_path', 'status', 'invalid');
      CONTINUE;
    END IF;

    v_target := p_bin;
    IF COALESCE(p_create_sub_bins, true) AND NULLIF(btrim(COALESCE(e ->> 'sub_bin', '')), '') IS NOT NULL THEN
      v_parent := p_bin;
      FOREACH v_seg IN ARRAY string_to_array(e ->> 'sub_bin', '/') LOOP
        CONTINUE WHEN btrim(v_seg) = '';
        SELECT b.id INTO v_child FROM public.bins b
         WHERE b.project_id = v_bin.project_id
           AND b.parent_bin_id IS NOT DISTINCT FROM v_parent
           AND lower(b.name) = lower(btrim(v_seg))
         ORDER BY b.sort_order, b.id LIMIT 1;
        IF v_child IS NULL THEN
          INSERT INTO public.bins (project_id, name, description, kind, parent_bin_id, sort_order)
          VALUES (v_bin.project_id, btrim(v_seg), '', 'footage', v_parent,
                  (SELECT COALESCE(max(b.sort_order), -1) + 1 FROM public.bins b
                    WHERE b.project_id = v_bin.project_id AND b.parent_bin_id IS NOT DISTINCT FROM v_parent))
          RETURNING id INTO v_child;
          v_bins := v_bins || (SELECT to_jsonb(b) FROM public.bins b WHERE b.id = v_child);
        END IF;
        v_parent := v_child;
        v_child := NULL;
      END LOOP;
      v_target := v_parent;
    END IF;

    v_is_seq := COALESCE((e ->> 'is_sequence')::boolean, false);
    v_name := COALESCE(NULLIF(btrim(COALESCE(e ->> 'original_name', '')), ''),
                       regexp_replace(v_rel, '^.*/', ''));
    v_ext := lower(COALESCE(NULLIF(e ->> 'extension', ''),
                   CASE WHEN v_name ~ '\.[A-Za-z0-9]{1,12}$' AND NOT v_is_seq
                        THEN regexp_replace(v_name, '^.*(\.[A-Za-z0-9]{1,12})$', '\1') ELSE '' END));
    SELECT COALESCE(max(f.sort_order), -1) + 1 INTO v_order FROM public.bin_files f WHERE f.bin_id = v_target;
    SELECT COALESCE(array_agg(btrim(t)) FILTER (WHERE btrim(t) <> ''), '{}')
      INTO v_tags
      FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(e -> 'tags') = 'array' THEN e -> 'tags' ELSE '[]'::jsonb END) AS t;

    INSERT INTO public.bin_files (
      project_id, bin_id, location_id, relative_path, display_name, original_name, extension, mime_type,
      is_sequence, sequence_pattern, frame_count, size_bytes, mtime, media_type, tags,
      scene_id, shot_id, slate, take_number, take_modifier, camera, roll, shoot_day,
      description, notes, review_flag, circled, color,
      duration_sec, width, height, fps, codec, timecode_start, probe_status, sort_order)
    VALUES (
      v_bin.project_id, v_target, v_loc, v_rel,
      COALESCE(NULLIF(btrim(COALESCE(e ->> 'display_name', '')), ''),
               CASE WHEN v_is_seq THEN v_name ELSE regexp_replace(v_name, '\.[A-Za-z0-9]{1,12}$', '') END),
      v_name, v_ext, NULLIF(e ->> 'mime_type', ''),
      v_is_seq, NULLIF(e ->> 'sequence_pattern', ''),
      public.fn_bins_json_number(e -> 'frame_count')::int,
      public.fn_bins_json_number(e -> 'size_bytes')::bigint,
      public.fn_bins_json_timestamp(e -> 'mtime'),
      CASE WHEN (e ->> 'media_type') IN ('video', 'still', 'sequence', 'audio', 'graphic', 'vfx', 'document', 'other')
           THEN e ->> 'media_type' WHEN v_is_seq THEN 'sequence' ELSE 'other' END,
      v_tags[1:50],
      public.fn_bins_json_uuid(e -> 'scene_id'), public.fn_bins_json_uuid(e -> 'shot_id'),
      NULLIF(e ->> 'slate', ''),
      CASE WHEN public.fn_bins_json_number(e -> 'take_number') > 0 THEN floor(public.fn_bins_json_number(e -> 'take_number'))::int ELSE NULL END,
      NULLIF(e ->> 'take_modifier', ''), NULLIF(e ->> 'camera', ''), NULLIF(e ->> 'roll', ''),
      CASE WHEN (e ->> 'shoot_day') ~ '^\d{4}-\d{2}-\d{2}$' THEN (e ->> 'shoot_day')::date ELSE NULL END,
      COALESCE(e ->> 'description', ''), COALESCE(e ->> 'notes', ''),
      CASE WHEN (e ->> 'review_flag') IN ('unflagged', 'select', 'reject') THEN e ->> 'review_flag' ELSE 'unflagged' END,
      COALESCE((e ->> 'circled')::boolean, false),
      CASE WHEN (e ->> 'color') IN ('red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink') THEN e ->> 'color' ELSE NULL END,
      CASE WHEN public.fn_bins_json_number(e -> 'duration_sec') > 0 THEN public.fn_bins_json_number(e -> 'duration_sec')::double precision ELSE NULL END,
      CASE WHEN public.fn_bins_json_number(e -> 'width') > 0 THEN floor(public.fn_bins_json_number(e -> 'width'))::int ELSE NULL END,
      CASE WHEN public.fn_bins_json_number(e -> 'height') > 0 THEN floor(public.fn_bins_json_number(e -> 'height'))::int ELSE NULL END,
      CASE WHEN public.fn_bins_json_number(e -> 'fps') > 0 THEN public.fn_bins_json_number(e -> 'fps')::double precision ELSE NULL END,
      NULLIF(e ->> 'codec', ''), NULLIF(e ->> 'timecode_start', ''),
      CASE WHEN (e ->> 'probe_status') IN ('pending', 'done', 'failed', 'unavailable') THEN e ->> 'probe_status' ELSE 'pending' END,
      v_order)
    RETURNING * INTO v_row;
    v_created := v_created || to_jsonb(v_row);
    v_results := v_results || jsonb_build_object('relative_path', v_rel, 'status', 'added', 'id', v_row.id, 'bin_id', v_target);
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'bins', v_bins, 'results', v_results);
END;
$$;
REVOKE ALL ON FUNCTION public.add_bin_files(UUID, JSONB, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_bin_files(UUID, JSONB, BOOLEAN) TO authenticated, service_role;

-- ── 10l. move_bin_files — to another bin; an undo passes the old positions ─
CREATE OR REPLACE FUNCTION public.move_bin_files(p_ids UUID[], p_bin UUID, p_sort_orders JSONB DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_order INT;
  v_new   INT;
  v_id    UUID;
  v_moved JSONB := '[]'::jsonb;
  r       RECORD;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RAISE EXCEPTION 'ids required' USING ERRCODE = '22023';
  END IF;
  IF p_bin IS NULL OR NOT EXISTS (SELECT 1 FROM public.bins b WHERE b.id = p_bin) THEN
    RAISE EXCEPTION 'bin not found' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(max(f.sort_order), -1) + 1 INTO v_order FROM public.bin_files f WHERE f.bin_id = p_bin;
  FOREACH v_id IN ARRAY p_ids LOOP
    SELECT f.id, f.bin_id, f.sort_order INTO r FROM public.bin_files f WHERE f.id = v_id;
    IF r.id IS NULL THEN CONTINUE; END IF;
    IF p_sort_orders IS NOT NULL AND jsonb_typeof(p_sort_orders) = 'object'
       AND public.fn_bins_json_number(p_sort_orders -> v_id::text) IS NOT NULL THEN
      v_new := floor(public.fn_bins_json_number(p_sort_orders -> v_id::text))::int;
    ELSE
      v_new := v_order;
      v_order := v_order + 1;
    END IF;
    UPDATE public.bin_files SET bin_id = p_bin, sort_order = v_new WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'you cannot change this project''s bins' USING ERRCODE = '42501'; END IF;
    v_moved := v_moved || jsonb_build_object('id', r.id, 'from', r.bin_id, 'sort_order', r.sort_order);
    r := NULL;
  END LOOP;
  RETURN jsonb_build_object('moved', v_moved, 'binFiles', COALESCE((
    SELECT jsonb_agg(to_jsonb(f) ORDER BY array_position(p_ids, f.id)) FROM public.bin_files f WHERE f.id = ANY(p_ids)), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.move_bin_files(UUID[], UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_bin_files(UUID[], UUID, JSONB) TO authenticated, service_role;

-- ── 10m. copy_bin_files — an INSTANCE: a new row, same reference, its own
--         logging; it keeps its sibling's poster key (same project) ──────────
CREATE OR REPLACE FUNCTION public.copy_bin_files(p_ids UUID[], p_bin UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_order   INT;
  v_id      UUID;
  v_new     UUID;
  v_created UUID[] := '{}';
  src       public.bin_files%ROWTYPE;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RAISE EXCEPTION 'ids required' USING ERRCODE = '22023';
  END IF;
  IF p_bin IS NULL OR NOT EXISTS (SELECT 1 FROM public.bins b WHERE b.id = p_bin) THEN
    RAISE EXCEPTION 'bin not found' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(max(f.sort_order), -1) + 1 INTO v_order FROM public.bin_files f WHERE f.bin_id = p_bin;
  FOREACH v_id IN ARRAY p_ids LOOP
    SELECT * INTO src FROM public.bin_files f WHERE f.id = v_id;
    IF src.id IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.bin_files (
      project_id, bin_id, location_id, relative_path, display_name, original_name, extension, mime_type,
      is_sequence, sequence_pattern, frame_count, size_bytes, mtime, media_type, tags,
      scene_id, shot_id, slate, take_number, take_modifier, camera, roll, shoot_day,
      description, notes, review_flag, circled, color,
      duration_sec, width, height, fps, codec, timecode_start, probe_status, sort_order, poster_path)
    VALUES (
      src.project_id, p_bin, src.location_id, src.relative_path, src.display_name, src.original_name, src.extension, src.mime_type,
      src.is_sequence, src.sequence_pattern, src.frame_count, src.size_bytes, src.mtime, src.media_type, src.tags,
      src.scene_id, src.shot_id, src.slate, src.take_number, src.take_modifier, src.camera, src.roll, src.shoot_day,
      src.description, src.notes, src.review_flag, src.circled, src.color,
      src.duration_sec, src.width, src.height, src.fps, src.codec, src.timecode_start, src.probe_status, v_order, src.poster_path)
    RETURNING id INTO v_new;
    v_created := array_append(v_created, v_new);
    v_order := v_order + 1;
    src := NULL;
  END LOOP;
  RETURN jsonb_build_object('created', COALESCE((
    SELECT jsonb_agg(to_jsonb(f) ORDER BY array_position(v_created, f.id)) FROM public.bin_files f WHERE f.id = ANY(v_created)), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.copy_bin_files(UUID[], UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copy_bin_files(UUID[], UUID) TO authenticated, service_role;

-- ── 10n. restore_bin_files — the undo of a removal: the rows go back verbatim
--         (ids kept; who added them kept, B11). A row whose bin is gone is
--         REPORTED (bin_gone), as is one without an address (invalid) ────────
CREATE OR REPLACE FUNCTION public.restore_bin_files(p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  e          JSONB;
  v_id       UUID;
  v_bin      public.bins%ROWTYPE;
  v_loc      UUID;
  v_rel      TEXT;
  v_row      public.bin_files%ROWTYPE;
  v_restored JSONB := '[]'::jsonb;
  v_skipped  JSONB := '[]'::jsonb;
  v_tags     TEXT[];
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'rows required' USING ERRCODE = '22023';
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS y(x, ord) ORDER BY ord LOOP
    v_id := public.fn_bins_json_uuid(e -> 'id');
    v_loc := public.fn_bins_json_uuid(e -> 'location_id');
    v_rel := NULLIF(btrim(COALESCE(e ->> 'relative_path', '')), '');
    IF jsonb_typeof(e) <> 'object' OR v_id IS NULL OR v_loc IS NULL OR v_rel IS NULL
       OR NULLIF(btrim(COALESCE(e ->> 'display_name', '')), '') IS NULL THEN
      v_skipped := v_skipped || jsonb_build_object('id', e ->> 'id', 'reason', 'invalid');
      CONTINUE;
    END IF;
    v_bin := NULL;
    SELECT * INTO v_bin FROM public.bins b WHERE b.id = public.fn_bins_json_uuid(e -> 'bin_id');
    IF v_bin.id IS NULL THEN
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'bin_gone');
      CONTINUE;
    END IF;
    SELECT COALESCE(array_agg(btrim(t)) FILTER (WHERE btrim(t) <> ''), '{}')
      INTO v_tags
      FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(e -> 'tags') = 'array' THEN e -> 'tags' ELSE '[]'::jsonb END) AS t;
    INSERT INTO public.bin_files AS f (
      id, project_id, bin_id, location_id, relative_path, display_name, original_name, extension, mime_type,
      is_sequence, sequence_pattern, frame_count, size_bytes, mtime, media_type, tags,
      scene_id, shot_id, slate, take_number, take_modifier, camera, roll, shoot_day,
      description, notes, review_flag, circled, color,
      duration_sec, width, height, fps, codec, timecode_start, probe_status, sort_order, poster_path,
      added_by, added_at)
    VALUES (
      v_id, v_bin.project_id, v_bin.id, v_loc, v_rel,
      btrim(e ->> 'display_name'),
      COALESCE(NULLIF(e ->> 'original_name', ''), regexp_replace(v_rel, '^.*/', '')),
      lower(COALESCE(e ->> 'extension', '')), NULLIF(e ->> 'mime_type', ''),
      COALESCE((e ->> 'is_sequence')::boolean, false), NULLIF(e ->> 'sequence_pattern', ''),
      public.fn_bins_json_number(e -> 'frame_count')::int,
      public.fn_bins_json_number(e -> 'size_bytes')::bigint,
      public.fn_bins_json_timestamp(e -> 'mtime'),
      CASE WHEN (e ->> 'media_type') IN ('video', 'still', 'sequence', 'audio', 'graphic', 'vfx', 'document', 'other')
           THEN e ->> 'media_type' ELSE 'other' END,
      v_tags[1:50],
      public.fn_bins_json_uuid(e -> 'scene_id'), public.fn_bins_json_uuid(e -> 'shot_id'),
      NULLIF(e ->> 'slate', ''),
      CASE WHEN public.fn_bins_json_number(e -> 'take_number') > 0 THEN floor(public.fn_bins_json_number(e -> 'take_number'))::int ELSE NULL END,
      NULLIF(e ->> 'take_modifier', ''), NULLIF(e ->> 'camera', ''), NULLIF(e ->> 'roll', ''),
      CASE WHEN (e ->> 'shoot_day') ~ '^\d{4}-\d{2}-\d{2}$' THEN (e ->> 'shoot_day')::date ELSE NULL END,
      COALESCE(e ->> 'description', ''), COALESCE(e ->> 'notes', ''),
      CASE WHEN (e ->> 'review_flag') IN ('unflagged', 'select', 'reject') THEN e ->> 'review_flag' ELSE 'unflagged' END,
      COALESCE((e ->> 'circled')::boolean, false),
      CASE WHEN (e ->> 'color') IN ('red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink') THEN e ->> 'color' ELSE NULL END,
      CASE WHEN public.fn_bins_json_number(e -> 'duration_sec') > 0 THEN public.fn_bins_json_number(e -> 'duration_sec')::double precision ELSE NULL END,
      CASE WHEN public.fn_bins_json_number(e -> 'width') > 0 THEN floor(public.fn_bins_json_number(e -> 'width'))::int ELSE NULL END,
      CASE WHEN public.fn_bins_json_number(e -> 'height') > 0 THEN floor(public.fn_bins_json_number(e -> 'height'))::int ELSE NULL END,
      CASE WHEN public.fn_bins_json_number(e -> 'fps') > 0 THEN public.fn_bins_json_number(e -> 'fps')::double precision ELSE NULL END,
      NULLIF(e ->> 'codec', ''), NULLIF(e ->> 'timecode_start', ''),
      CASE WHEN (e ->> 'probe_status') IN ('pending', 'done', 'failed', 'unavailable') THEN e ->> 'probe_status' ELSE 'pending' END,
      COALESCE(floor(public.fn_bins_json_number(e -> 'sort_order'))::int, 0),
      NULLIF(e ->> 'poster_path', ''),
      public.fn_bins_json_uuid(e -> 'added_by'),
      COALESCE(public.fn_bins_json_timestamp(e -> 'added_at'), now()))
    ON CONFLICT (id) DO UPDATE
      SET bin_id = EXCLUDED.bin_id, sort_order = EXCLUDED.sort_order,
          display_name = EXCLUDED.display_name, tags = EXCLUDED.tags,
          scene_id = EXCLUDED.scene_id, shot_id = EXCLUDED.shot_id, slate = EXCLUDED.slate,
          take_number = EXCLUDED.take_number, take_modifier = EXCLUDED.take_modifier,
          camera = EXCLUDED.camera, roll = EXCLUDED.roll, shoot_day = EXCLUDED.shoot_day,
          description = EXCLUDED.description, notes = EXCLUDED.notes,
          review_flag = EXCLUDED.review_flag, circled = EXCLUDED.circled, color = EXCLUDED.color
      WHERE f.project_id = EXCLUDED.project_id
    RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'invalid');
      CONTINUE;
    END IF;
    v_restored := v_restored || to_jsonb(v_row);
    v_row := NULL;
  END LOOP;
  RETURN jsonb_build_object('restored', v_restored, 'skipped', v_skipped,
                            'affectedShotIds', '[]'::jsonb, 'shotTakes', '[]'::jsonb, 'orphanTakes', '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.restore_bin_files(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_bin_files(JSONB) TO authenticated, service_role;


-- =============================================================================
-- 11. POST-CONDITIONS — scan the catalogue, do not assume (S22)
-- =============================================================================

DO $$
DECLARE
  t        TEXT;
  v_n      INT;
  v_body   TEXT;
  v_hits   INT;
  v_expect INT;
BEGIN
  -- 11a. the four tables: RLS enabled + forced, exactly four policies each,
  --      no FOR ALL, every write policy hops and names the gate, anon holds
  --      nothing, the triggers are armed.
  FOREACH t IN ARRAY ARRAY['bin_locations', 'bins', 'bin_files', 'shot_takes'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION '0091 post-condition failed: table % missing', t;
    END IF;
    SELECT count(*) INTO v_n FROM pg_class
     WHERE oid = ('public.' || t)::regclass AND relrowsecurity AND relforcerowsecurity;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '0091 post-condition failed: % lacks ENABLE+FORCE row level security', t;
    END IF;
    SELECT count(*) INTO v_n FROM pg_policies
     WHERE schemaname = 'public' AND tablename = t AND cmd = 'ALL';
    IF v_n <> 0 THEN
      RAISE EXCEPTION '0091 post-condition failed: % has a FOR ALL policy', t;
    END IF;
    SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = t;
    IF v_n <> 4 THEN
      RAISE EXCEPTION '0091 post-condition failed: % has % policies, expected 4', t, v_n;
    END IF;
    SELECT count(*) INTO v_n FROM pg_policies
     WHERE schemaname = 'public' AND tablename = t AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
       AND (position('projects' IN COALESCE(with_check, qual, '')) = 0
            OR position('can_edit_shot_lists' IN COALESCE(with_check, qual, '')) = 0
            OR position('has_active_membership' IN COALESCE(with_check, qual, '')) = 0
            OR (cmd = 'UPDATE' AND (position('projects' IN COALESCE(qual, '')) = 0
                                    OR position('can_edit_shot_lists' IN COALESCE(qual, '')) = 0)));
    IF v_n <> 0 THEN
      RAISE EXCEPTION '0091 post-condition failed: a write policy on % lacks the projects hop, the membership check or the can_edit_shot_lists gate', t;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema = 'public' AND table_name = t AND grantee IN ('anon', 'PUBLIC')) THEN
      RAISE EXCEPTION '0091 post-condition failed: anon or PUBLIC holds privileges on %', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['bins', 'bin_files', 'shot_takes'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = ('public.' || t)::regclass
                      AND NOT tgisinternal AND tgname = 'trg_' || t || '_populate_workspace')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = ('public.' || t)::regclass
                      AND NOT tgisinternal AND tgname = 'trg_' || t || '_realtime') THEN
      RAISE EXCEPTION '0091 post-condition failed: % lacks its workspace-stamp or realtime trigger', t;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.bins'::regclass AND tgname = 'trg_bins_audit' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.bins'::regclass AND tgname = 'trg_bins_cycle_guard' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.bin_files'::regclass AND tgname = 'trg_bin_files_touch' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.bin_files'::regclass AND tgname = 'trg_bin_files_gc_enqueue' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.shot_takes'::regclass AND tgname = 'trg_shot_takes_touch' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.bin_locations'::regclass AND tgname = 'trg_bin_locations_touch' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '0091 post-condition failed: a stamp, cycle-guard or gc trigger is missing';
  END IF;

  -- 11b. the composite, same-project / same-workspace FKs and the RESTRICT.
  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE contype = 'f' AND conname IN (
     'bins_parent_fk', 'bin_files_bin_fk', 'bin_files_location_fk', 'bin_files_scene_fk',
     'bin_files_shot_fk', 'shot_takes_shot_fk', 'shot_takes_file_fk')
     AND array_length(conkey, 1) = 2;
  IF v_n <> 7 THEN
    RAISE EXCEPTION '0091 post-condition failed: expected 7 two-column same-project/workspace FKs, found %', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bin_files_location_fk' AND confdeltype = 'r') THEN
    RAISE EXCEPTION '0091 post-condition failed: bin_files_location_fk is not ON DELETE RESTRICT — a clip could lose its address';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shot_takes_file_fk' AND confdeltype = 'c')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shot_takes_shot_fk' AND confdeltype = 'c')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bin_files_bin_fk' AND confdeltype = 'c')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bins_parent_fk' AND confdeltype = 'c') THEN
    RAISE EXCEPTION '0091 post-condition failed: a CASCADE the brief requires is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bin_locations_unc_path_shape_chk' AND contype = 'c')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bin_files_relative_path_shape_chk' AND contype = 'c')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bin_files_poster_path_shape_chk' AND contype = 'c')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shot_takes_shot_file_key' AND contype = 'u') THEN
    RAISE EXCEPTION '0091 post-condition failed: a shape CHECK or the (shot, file) key is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = to_regclass('public.bin_locations_workspace_unc_key') AND i.indisunique) THEN
    RAISE EXCEPTION '0091 post-condition failed: bin_locations_workspace_unc_key is missing or not unique';
  END IF;

  -- 11c. the switch: the column, its default, and the admin-only UPDATE path
  --      measured (workspaces_admin_update still names the admin role).
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'workspaces'
                    AND column_name = 'remote_viewing_enabled' AND is_nullable = 'NO'
                    AND column_default = 'false') THEN
    RAISE EXCEPTION '0091 post-condition failed: workspaces.remote_viewing_enabled missing, nullable or not defaulted to false';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'workspaces' AND policyname = 'workspaces_admin_update'
                    AND cmd = 'UPDATE' AND position('''admin''' IN COALESCE(qual, '')) > 0
                    AND position('''admin''' IN COALESCE(with_check, '')) > 0) THEN
    RAISE EXCEPTION '0091 post-condition failed: workspaces_admin_update no longer restricts the client UPDATE of workspaces to admins — the switch would be anyone''s';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'workspaces' AND cmd IN ('UPDATE', 'ALL')
                AND policyname NOT IN ('workspaces_admin_update', 'workspaces_operator_update')) THEN
    RAISE EXCEPTION '0091 post-condition failed: an UPDATE policy on workspaces other than the admin and operator ones exists — measure who may flip the switch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.rabbit_remote_viewing_enabled(uuid)'::regprocedure AND prosecdef)
     OR has_function_privilege('anon', 'public.rabbit_remote_viewing_enabled(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rabbit_remote_viewing_enabled(uuid)', 'EXECUTE')
     OR position('has_active_membership(p.workspace_id)' IN pg_get_functiondef('public.rabbit_remote_viewing_enabled(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '0091 post-condition failed: rabbit_remote_viewing_enabled must be SECURITY DEFINER, executable by authenticated and not by anon, and answer only an active member of the project''s workspace (has_active_membership in its body — no oracle across companies)';
  END IF;

  -- 11d. the poster policies: RESTRICTIVE, both commands, each naming the
  --      bucket, the entity segment and the switch function; the UPDATE one
  --      with a WITH CHECK arm. And the neighbours untouched: exactly 8
  --      rabbit_thumbnails% and 8 rabbit_files% (0053 / 0055).
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN ('petal_bin_posters_remote_viewing_insert', 'petal_bin_posters_remote_viewing_update')
     AND permissive = 'RESTRICTIVE'
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%rabbit-thumbnails%'
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%bin_files%'
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%rabbit_remote_viewing_enabled%';
  IF v_n <> 2 THEN
    RAISE EXCEPTION '0091 post-condition failed: % of 2 poster policies are RESTRICTIVE and name the bucket, the bin_files segment and the switch', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'storage' AND tablename = 'objects'
                    AND policyname = 'petal_bin_posters_remote_viewing_update' AND cmd = 'UPDATE'
                    AND with_check IS NOT NULL AND with_check LIKE '%rabbit_remote_viewing_enabled%') THEN
    RAISE EXCEPTION '0091 post-condition failed: the poster UPDATE policy lacks its WITH CHECK arm';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'storage' AND tablename = 'objects'
                    AND policyname = 'petal_bin_posters_remote_viewing_insert' AND cmd = 'INSERT') THEN
    RAISE EXCEPTION '0091 post-condition failed: the poster INSERT policy is not FOR INSERT';
  END IF;
  -- the reviewer's permissive pair: PERMISSIVE, the bin_files segment, the
  -- projects hop, membership and the gate — and NOT the switch (that is the
  -- restrictive pair's; a permissive copy of the switch would be ORed away).
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN ('petal_bin_posters_insert', 'petal_bin_posters_update')
     AND permissive = 'PERMISSIVE'
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%bin_files%'
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%projects%'
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%has_active_membership%'
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%can_edit_shot_lists%'
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%rabbit_money_segment%';
  IF v_n <> 2 THEN
    RAISE EXCEPTION '0091 post-condition failed: % of 2 reviewer poster policies are permissive and carry the segment, the hop, membership, the gate and the money predicate', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'petal_bin_posters%';
  IF v_n <> 4 THEN
    RAISE EXCEPTION '0091 post-condition failed: % petal_bin_posters%% policies, expected 4', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'rabbit_thumbnails%';
  IF v_n <> 8 THEN
    RAISE EXCEPTION '0091 post-condition failed: % rabbit_thumbnails%% policies, expected 8 (a poster policy took the wrong prefix)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'rabbit_files%';
  IF v_n <> 8 THEN
    RAISE EXCEPTION '0091 post-condition failed: % rabbit_files%% policies, expected 8', v_n;
  END IF;

  -- 11e. the realtime body: every one of the fifteen names exactly once
  --      (comments stripped first — 0077 §3c), and every trigger attached.
  v_body := pg_get_functiondef('public.fn_realtime_broadcast()'::regprocedure);
  v_body := regexp_replace(v_body, '/\*.*?\*/', '', 'gs');
  v_body := regexp_replace(v_body, '--[^' || chr(10) || ']*', '', 'g');
  FOREACH t IN ARRAY ARRAY['projects', 'phases', 'assets', 'tasks', 'files',
                           'comments', 'task_dependencies', 'phase_dependencies',
                           'task_links', 'asset_versions', 'project_members',
                           'milestones', 'bins', 'bin_files', 'shot_takes'] LOOP
    v_hits := (length(v_body) - length(replace(v_body, '''' || t || '''', ''))) / length('''' || t || '''');
    IF v_hits = 0 THEN
      RAISE EXCEPTION '0091 post-condition failed: fn_realtime_broadcast no longer names % — an arm was lost while the body was retyped', t;
    END IF;
    IF v_hits > 1 THEN
      RAISE EXCEPTION '0091 post-condition failed: % is named % times in fn_realtime_broadcast; a duplicate WHEN arm shadows the real one', t, v_hits;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = ('public.' || quote_ident(t))::regclass
                      AND tgname = 'trg_' || t || '_realtime') THEN
      RAISE EXCEPTION '0091 post-condition failed: trg_%_realtime is not attached', t;
    END IF;
  END LOOP;
  IF v_body NOT LIKE '%file_row_is_money%' THEN
    RAISE EXCEPTION '0091 post-condition failed: fn_realtime_broadcast lost 0088''s money arm for files';
  END IF;

  -- 11f. the RPCs: every one SECURITY INVOKER (they grant nothing), executable
  --      by authenticated, not by anon; the trigger functions by no client.
  FOREACH t IN ARRAY ARRAY['public.assign_shot_takes(jsonb)', 'public.update_shot_take(uuid, jsonb)',
                           'public.remove_shot_takes(uuid[])', 'public.reorder_shot_takes(uuid, uuid[])',
                           'public.replace_shot_takes(uuid[], jsonb)', 'public.delete_bin(uuid, text, uuid)',
                           'public.reorder_bins(jsonb)', 'public.add_bin_files(uuid, jsonb, boolean)',
                           'public.move_bin_files(uuid[], uuid, jsonb)', 'public.copy_bin_files(uuid[], uuid)',
                           'public.restore_bin_files(jsonb)', 'public.fn_normalize_shot_takes(uuid, uuid)',
                           'public.fn_shot_takes_answer(uuid[])'] LOOP
    IF to_regprocedure(t) IS NULL THEN
      RAISE EXCEPTION '0091 post-condition failed: % is missing', t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = t::regprocedure AND prosecdef) THEN
      RAISE EXCEPTION '0091 post-condition failed: % must stay SECURITY INVOKER', t;
    END IF;
    IF has_function_privilege('anon', t, 'EXECUTE') OR NOT has_function_privilege('authenticated', t, 'EXECUTE') THEN
      RAISE EXCEPTION '0091 post-condition failed: % privileges are wrong', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['public.fn_bins_cycle_guard()', 'public.fn_bin_files_gc_enqueue()',
                           'public.fn_bin_files_touch()', 'public.fn_shot_takes_touch()',
                           'public.fn_bin_locations_touch()'] LOOP
    IF has_function_privilege('authenticated', t, 'EXECUTE') OR has_function_privilege('anon', t, 'EXECUTE') THEN
      RAISE EXCEPTION '0091 post-condition failed: a client role can execute %', t;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_bin_files_gc_enqueue()'::regprocedure AND prosecdef)
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_bins_cycle_guard()'::regprocedure AND prosecdef) THEN
    RAISE EXCEPTION '0091 post-condition failed: the gc enqueue and the cycle guard must be SECURITY DEFINER';
  END IF;
  v_body := pg_get_functiondef('public.fn_bin_files_gc_enqueue()'::regprocedure);
  v_body := regexp_replace(v_body, '/\*.*?\*/', '', 'gs');
  v_body := regexp_replace(v_body, '--[^' || chr(10) || ']*', '', 'g');
  IF v_body NOT LIKE '%rabbit-thumbnails%' OR v_body NOT LIKE '%''thumbnail''%'
     OR v_body NOT LIKE '%f.id <> OLD.id%' THEN
    RAISE EXCEPTION '0091 post-condition failed: the gc enqueue does not name the thumbnails bucket and kind, or lost the shared-picture check';
  END IF;

  -- 11g. the shape CHECKs, exercised: a drive letter, a traversal, a trailing
  --      backslash and a forward slash are refused; the good shapes pass.
  IF NOT ('\\nas\footage' ~ '^\\\\[^\\/:*?"<>|]+(\\[^\\/:*?"<>|]+)+$')
     OR NOT ('\\nas\footage\2026' ~ '^\\\\[^\\/:*?"<>|]+(\\[^\\/:*?"<>|]+)+$')
     OR ('Z:\footage' ~ '^\\\\[^\\/:*?"<>|]+(\\[^\\/:*?"<>|]+)+$')
     OR ('\\nas\footage\' ~ '^\\\\[^\\/:*?"<>|]+(\\[^\\/:*?"<>|]+)+$')
     OR ('\\nas' ~ '^\\\\[^\\/:*?"<>|]+(\\[^\\/:*?"<>|]+)+$')
     OR ('//nas/footage' ~ '^\\\\[^\\/:*?"<>|]+(\\[^\\/:*?"<>|]+)+$')
     OR NOT ('\\nas\footage\..\secret' ~ '(^|\\)\.\.?(\\|$)')
     OR ('\\nas\footage\day.01' ~ '(^|\\)\.\.?(\\|$)') THEN
    RAISE EXCEPTION '0091 post-condition failed: the unc_path shape expression does not refuse what it must (or refuses a good share)';
  END IF;
  IF ('A001/clip.mov' ~ '(^/|/$|//|\\|:)') OR ('A001/clip.mov' ~ '(^|/)\.\.?(/|$)')
     OR NOT ('../clip.mov' ~ '(^|/)\.\.?(/|$)') OR NOT ('a/../b.mov' ~ '(^|/)\.\.?(/|$)')
     OR NOT ('/clip.mov' ~ '(^/|/$|//|\\|:)') OR NOT ('C:/clip.mov' ~ '(^/|/$|//|\\|:)')
     OR NOT ('a\b.mov' ~ '(^/|/$|//|\\|:)') THEN
    RAISE EXCEPTION '0091 post-condition failed: the relative_path shape expression does not refuse what it must (or refuses a good path)';
  END IF;

  RAISE NOTICE '0091 OK: bin_locations / bins / bin_files / shot_takes under RLS (4 policies each, every write hops and names can_edit_shot_lists), the switch on workspaces (admin-only by 0020), two RESTRICTIVE poster policies, 15 tables broadcast, 11 SECURITY INVOKER RPCs.';
END $$;
