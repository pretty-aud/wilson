-- =============================================================================
-- 0130_boards.sql — M.O.T.H. Session 4 (MO4): boards and their elements.
-- (docs/sessions/PLAN_MOTH.md §4 "boards", "board_elements" and §5 Session 4; the brief §7.1 to §7.3;
--  docs/design/MOTH_DESIGN.md §2.5 "DEFERRED (S4)" and SEC-08.)
--
-- A board IS a folder (her ruling, brief §7.1): a sticky is a markdown file in it, a dropped picture or video a real
-- file in it, so the board and the Files page always agree. What the folder cannot hold is the canvas itself: where
-- each thing sits, its shape and style, and the lines between them. That is one row an element (brief §7.3), so two
-- people moving two shapes never overwrite each other and a drag never rewrites the board.
--
-- WHAT THIS CHANGES
-- -----------------
--   §1  boards: one row a board, keyed by its folder (folder_id UNIQUE; (folder_id, project_id) to folders (id,
--       project_id), so a board is always in its folder's project); a custom folder only; no deleted_at (a board goes
--       to the trash with its folder, 0131). revision and audience_gen are the server's (0132's channels).
--   §2  board_elements: kind (shape, connector, frame, pen, text, sticky, media, embed), its geometry, stacking order,
--       style, words, a pen's points; a sticky, a medium or an embed points at a files row (ON DELETE SET NULL: a gone
--       file leaves the stop-sign tile); a connector's two ends are elements of the same board (composite keys), so a
--       line follows its shapes and never crosses boards. Hard delete, which never reaches a file.
--   §3  Guards. A board's company, project and folder are stamped from its folder and never change but by the
--       folder's own key (a move, 0131). An element's kind and file never change; its file must be one its writer may
--       read through Moth's gate (money, Legal, a private project not theirs, another person's space: refused alike);
--       a sticky's and a medium's file sits in the board's own folder when placed; a connector's ends are not itself.
--       fn_folders_board_guard: a client never deletes a folder holding a board (or an ancestor of one), and never
--       moves a board's folder by hand: boards go to the trash and move through Moth's functions (0131).
--   §4  Row security: SELECT only, for both tables, through moth_can_read_target('folder', the board's folder) (which
--       refuses money and Legal trees, SEC-08, and keeps a personal space its owner's alone in Moth); an element whose
--       file the reader may not read is left out of the table's reads. No client INSERT, UPDATE or DELETE: every
--       write is §5's.
--   §5  board_create(project, parent folder, title): a custom folder and its board, in one step. board_read(board):
--       the board and its elements for the caller, an element whose file they may not read as a stop-sign tile with
--       no file id or name. board_put_elements(board, elements): up to 500 elements a call, last writer wins each,
--       an undo naming the version it expects and skipped (said, not refused) when someone changed it since.
--       board_delete_elements(board, ids, versions): the same, for removal. At most 5,000 elements a board and 500
--       boards a project.
--
-- No realtime topic in this file (0132 adds the board's two channels). Not in edit_history, the takeout or
-- moth_history yet (0134 records a board's existence). One transaction, re-runnable, no enum. Suites 134_boards.sql
-- and 135_board_elements.sql; RLS_TABLES gains boards and board_elements.
-- =============================================================================

SET LOCAL lock_timeout = '15s';

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
BEGIN
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0130 refused: % does not bypass row security', current_user;
  END IF;
  -- The keys this file's foreign keys need (0113), and Moth's gates (0111, 0125, 0126).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.folders'::regclass
                  AND conname = 'folders_id_project_key' AND contype = 'u') THEN
    RAISE EXCEPTION '0130 refused: folders_id_project_key (0113) is missing';
  END IF;
  IF to_regprocedure('public.moth_can_read_target(text,uuid)') IS NULL
     OR to_regprocedure('public.moth_can_write_target(text,uuid)') IS NULL
     OR to_regprocedure('public.moth_folder_chain_locked(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '0130 refused: Moth''s gates (0111) are missing';
  END IF;
  -- 0129 is applied (the record's three checks validated): this file follows Session 3.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.moth_history'::regclass
              AND conname IN ('moth_history_b_entity_chk', 'moth_history_c_class_chk', 'moth_history_g_peer_chk')
              AND NOT convalidated)
     OR (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.moth_history'::regclass
          AND conname IN ('moth_history_b_entity_chk', 'moth_history_c_class_chk', 'moth_history_g_peer_chk')) <> 3 THEN
    RAISE EXCEPTION '0130 refused: 0129 must be applied first';
  END IF;
  -- A second run finds this file's own tables; anything else of these names is not ours.
  IF to_regclass('public.boards') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.boards')
                      AND conname = 'boards_folder_key') THEN
    RAISE EXCEPTION '0130 refused: a table public.boards exists that this file did not make';
  END IF;
  IF to_regclass('public.board_elements') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.board_elements')
                      AND conname = 'board_elements_board_fk') THEN
    RAISE EXCEPTION '0130 refused: a table public.board_elements exists that this file did not make';
  END IF;
END $$;

-- §1 boards ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.boards (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL,
  folder_id     UUID NOT NULL,
  -- 0132: the board's channels are named with it; it moves when the board's audience may have changed.
  audience_gen  INTEGER NOT NULL DEFAULT 0,
  -- Counts each change of the board's elements by one, so a reader can tell it has missed one.
  revision      BIGINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID,
  CONSTRAINT boards_folder_key UNIQUE (folder_id),
  CONSTRAINT boards_id_project_key UNIQUE (id, project_id),
  -- A board is in its folder's project, always: a folder moved to another project (0131) takes its board along.
  CONSTRAINT boards_folder_fk FOREIGN KEY (folder_id, project_id)
    REFERENCES public.folders (id, project_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT boards_gen_chk CHECK (audience_gen >= 0 AND revision >= 0)
);
CREATE INDEX IF NOT EXISTS boards_project_idx ON public.boards (project_id);
CREATE INDEX IF NOT EXISTS boards_workspace_idx ON public.boards (workspace_id);

-- §2 board_elements -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.board_elements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL,
  board_id      UUID NOT NULL,
  kind          TEXT NOT NULL,
  shape         TEXT,
  x             DOUBLE PRECISION NOT NULL DEFAULT 0,
  y             DOUBLE PRECISION NOT NULL DEFAULT 0,
  w             DOUBLE PRECISION NOT NULL DEFAULT 0,
  h             DOUBLE PRECISION NOT NULL DEFAULT 0,
  rotation      DOUBLE PRECISION NOT NULL DEFAULT 0,
  z             BIGINT NOT NULL DEFAULT 0,
  style         JSONB NOT NULL DEFAULT '{}'::jsonb,
  body          TEXT,
  points        JSONB,
  file_id       UUID REFERENCES public.files(id) ON DELETE SET NULL,
  from_id       UUID,
  from_anchor   TEXT,
  to_id         UUID,
  to_anchor     TEXT,
  version       BIGINT NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID,
  CONSTRAINT board_elements_id_board_key UNIQUE (id, board_id),
  CONSTRAINT board_elements_board_fk FOREIGN KEY (board_id, project_id)
    REFERENCES public.boards (id, project_id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- A connector's ends are elements of its own board; a removed end leaves that end free, never another board's.
  CONSTRAINT board_elements_from_fk FOREIGN KEY (from_id, board_id)
    REFERENCES public.board_elements (id, board_id) ON DELETE SET NULL (from_id),
  CONSTRAINT board_elements_to_fk FOREIGN KEY (to_id, board_id)
    REFERENCES public.board_elements (id, board_id) ON DELETE SET NULL (to_id),
  CONSTRAINT board_elements_kind_chk CHECK (kind IN
    ('shape', 'connector', 'frame', 'pen', 'text', 'sticky', 'media', 'embed')),
  CONSTRAINT board_elements_shape_chk CHECK ((kind = 'shape') = (shape IS NOT NULL) AND (shape IS NULL OR shape IN
    ('rectangle', 'rounded_rectangle', 'circle', 'oval', 'triangle', 'diamond', 'star', 'hexagon', 'arrow',
     'double_arrow', 'speech_bubble', 'process', 'decision', 'document', 'database', 'terminator', 'input_output',
     'predefined_process', 'connector_circle'))),
  CONSTRAINT board_elements_geometry_chk CHECK (
    x BETWEEN -10000000 AND 10000000 AND y BETWEEN -10000000 AND 10000000
    AND w BETWEEN 0 AND 1000000 AND h BETWEEN 0 AND 1000000 AND rotation BETWEEN -360 AND 360),
  CONSTRAINT board_elements_style_chk CHECK (jsonb_typeof(style) = 'object' AND pg_column_size(style) <= 4096),
  CONSTRAINT board_elements_body_chk CHECK (body IS NULL OR char_length(body) <= 10000),
  CONSTRAINT board_elements_points_chk CHECK (points IS NULL
    OR (jsonb_typeof(points) = 'array' AND pg_column_size(points) <= 262144)),
  -- Only a sticky, a medium and an embed hold a file; only a connector has ends. A placed file may later go
  -- (ON DELETE SET NULL): that is the stop-sign tile, so the check asks only that no other kind holds one.
  CONSTRAINT board_elements_file_kind_chk CHECK (file_id IS NULL OR kind IN ('sticky', 'media', 'embed')),
  CONSTRAINT board_elements_ends_kind_chk CHECK (kind = 'connector'
    OR (from_id IS NULL AND to_id IS NULL AND from_anchor IS NULL AND to_anchor IS NULL)),
  CONSTRAINT board_elements_anchor_chk CHECK (
    (from_anchor IS NULL OR from_anchor IN ('auto', 'top', 'right', 'bottom', 'left', 'center'))
    AND (to_anchor IS NULL OR to_anchor IN ('auto', 'top', 'right', 'bottom', 'left', 'center'))),
  CONSTRAINT board_elements_not_self_chk CHECK (from_id IS DISTINCT FROM id AND to_id IS DISTINCT FROM id),
  CONSTRAINT board_elements_version_chk CHECK (version >= 1)
);
CREATE INDEX IF NOT EXISTS board_elements_board_idx ON public.board_elements (board_id, z, id);
CREATE INDEX IF NOT EXISTS board_elements_file_idx ON public.board_elements (file_id) WHERE file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS board_elements_from_idx ON public.board_elements (from_id, board_id) WHERE from_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS board_elements_to_idx ON public.board_elements (to_id, board_id) WHERE to_id IS NOT NULL;

-- §3 Guards ---------------------------------------------------------------------

-- The style a kind may carry: known keys only, each of its own type and range. Words go in body, never in style.
CREATE OR REPLACE FUNCTION rabbit_private.board_style_ok(p_kind text, p_style jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  k TEXT;
  v JSONB;
BEGIN
  IF p_style IS NULL OR jsonb_typeof(p_style) <> 'object' THEN
    RETURN false;
  END IF;
  FOR k, v IN SELECT e.key, e.value FROM jsonb_each(p_style) e LOOP
    IF k IN ('fill', 'stroke', 'colour', 'text_colour') THEN
      IF jsonb_typeof(v) <> 'string' OR NOT ((v #>> '{}') ~ '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$' OR (v #>> '{}') = 'none') THEN
        RETURN false;
      END IF;
    ELSIF k = 'dash' THEN
      IF jsonb_typeof(v) <> 'string' OR (v #>> '{}') NOT IN ('solid', 'dashed', 'dotted') THEN
        RETURN false;
      END IF;
    ELSIF k = 'width' THEN
      IF jsonb_typeof(v) <> 'number' OR (v #>> '{}')::numeric NOT BETWEEN 0 AND 40 THEN
        RETURN false;
      END IF;
    ELSIF k = 'opacity' THEN
      IF jsonb_typeof(v) <> 'number' OR (v #>> '{}')::numeric NOT BETWEEN 0 AND 1 THEN
        RETURN false;
      END IF;
    ELSIF k = 'font_size' THEN
      IF jsonb_typeof(v) <> 'number' OR (v #>> '{}')::numeric NOT BETWEEN 6 AND 400 THEN
        RETURN false;
      END IF;
    ELSIF k = 'align' THEN
      IF jsonb_typeof(v) <> 'string' OR (v #>> '{}') NOT IN ('left', 'center', 'right') THEN
        RETURN false;
      END IF;
    ELSIF k = 'route' AND p_kind = 'connector' THEN
      IF jsonb_typeof(v) <> 'string' OR (v #>> '{}') NOT IN ('straight', 'curved', 'elbow') THEN
        RETURN false;
      END IF;
    ELSIF k IN ('start_head', 'end_head') AND p_kind = 'connector' THEN
      IF jsonb_typeof(v) <> 'string' OR (v #>> '{}') NOT IN ('none', 'arrow', 'open_arrow', 'dot', 'diamond') THEN
        RETURN false;
      END IF;
    ELSIF k = 'corner' AND p_kind IN ('shape', 'frame', 'sticky', 'media', 'embed') THEN
      IF jsonb_typeof(v) <> 'number' OR (v #>> '{}')::numeric NOT BETWEEN 0 AND 1000 THEN
        RETURN false;
      END IF;
    ELSE
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION rabbit_private.board_style_ok(text, jsonb) FROM PUBLIC, anon, authenticated;

-- A pen's stroke or a connector's bends: numbers only, in pairs, at most 20,000 numbers (10,000 points).
CREATE OR REPLACE FUNCTION rabbit_private.board_points_ok(p_kind text, p_points jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_points IS NULL THEN p_kind <> 'pen'
    WHEN p_kind NOT IN ('pen', 'connector') THEN false
    WHEN jsonb_typeof(p_points) <> 'array' THEN false
    WHEN jsonb_array_length(p_points) % 2 <> 0 THEN false
    WHEN jsonb_array_length(p_points) > CASE WHEN p_kind = 'pen' THEN 20000 ELSE 128 END THEN false
    WHEN p_kind = 'pen' AND jsonb_array_length(p_points) < 2 THEN false
    ELSE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_points) e
                      WHERE jsonb_typeof(e) <> 'number' OR abs((e #>> '{}')::numeric) > 10000000)
  END;
$$;
REVOKE EXECUTE ON FUNCTION rabbit_private.board_points_ok(text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_boards_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind TEXT;
  v_ws   UUID;
  v_proj UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT fo.kind, fo.workspace_id, fo.project_id INTO v_kind, v_ws, v_proj
      FROM public.folders fo WHERE fo.id = NEW.folder_id;
    IF v_kind IS DISTINCT FROM 'custom' THEN
      RAISE EXCEPTION 'A board is a folder of its own.' USING ERRCODE = '42501';
    END IF;
    NEW.workspace_id := v_ws;
    NEW.project_id := v_proj;
    NEW.audience_gen := 0;
    NEW.revision := 0;
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
    NEW.updated_by := NEW.created_by;
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  -- UPDATE. Who and where a board is never changes; its project follows its folder's (the key's cascade, a
  -- nested statement) and nothing else moves it.
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.folder_id IS DISTINCT FROM OLD.folder_id OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (NEW.project_id IS DISTINCT FROM OLD.project_id AND pg_trigger_depth() < 2) THEN
    RAISE EXCEPTION 'A board stays with its folder.' USING ERRCODE = '42501';
  END IF;
  IF NEW.audience_gen < OLD.audience_gen OR NEW.revision < OLD.revision THEN
    RAISE EXCEPTION 'A board''s counts only go up.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_boards_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_boards_guard ON public.boards;
CREATE TRIGGER trg_boards_guard
  BEFORE INSERT OR UPDATE ON public.boards
  FOR EACH ROW EXECUTE FUNCTION public.fn_boards_guard();

CREATE OR REPLACE FUNCTION public.fn_board_elements_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws       UUID;
  v_proj     UUID;
  v_folder   UUID;
  v_file_dir UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1
     AND NEW.id = OLD.id AND NEW.board_id = OLD.board_id AND NEW.kind = OLD.kind
     AND NEW.version = OLD.version
     AND (NEW.project_id IS DISTINCT FROM OLD.project_id
          OR (NEW.file_id IS NULL AND OLD.file_id IS NOT NULL)
          OR (NEW.from_id IS NULL AND OLD.from_id IS NOT NULL)
          OR (NEW.to_id IS NULL AND OLD.to_id IS NOT NULL)) THEN
    -- A key's own action: the board's project followed its folder, or a placed file or a connector's end went.
    RETURN NEW;
  END IF;

  SELECT b.workspace_id, b.project_id, b.folder_id INTO v_ws, v_proj, v_folder
    FROM public.boards b WHERE b.id = NEW.board_id;
  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'board not found' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.board_id IS DISTINCT FROM OLD.board_id
       OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.file_id IS DISTINCT FROM OLD.file_id
       OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'An element keeps its board, its kind and its file.' USING ERRCODE = '42501';
    END IF;
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  ELSE
    NEW.workspace_id := v_ws;
    NEW.project_id := v_proj;
    NEW.version := 1;
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
    NEW.updated_by := NEW.created_by;
    NEW.created_at := now();
    NEW.updated_at := now();
    IF NEW.kind IN ('sticky', 'media', 'embed') AND NEW.file_id IS NULL THEN
      RAISE EXCEPTION 'A sticky, a picture or an embed needs its file.' USING ERRCODE = '22023';
    END IF;
    IF NEW.file_id IS NOT NULL THEN
      -- Asked as the writer: a file they may not read is refused in the words a missing one would get.
      IF NOT COALESCE(public.moth_can_read_target('file', NEW.file_id), false) THEN
        RAISE EXCEPTION 'file not found' USING ERRCODE = '42501';
      END IF;
      IF NEW.kind IN ('sticky', 'media') THEN
        SELECT f.folder_id INTO v_file_dir FROM public.files f WHERE f.id = NEW.file_id;
        IF v_file_dir IS DISTINCT FROM v_folder THEN
          RAISE EXCEPTION 'A sticky or a dropped file lives in the board''s own folder.' USING ERRCODE = '22023';
        END IF;
      END IF;
    END IF;
  END IF;

  IF NOT rabbit_private.board_style_ok(NEW.kind, NEW.style) THEN
    RAISE EXCEPTION 'That style is not one a board knows.' USING ERRCODE = '22023';
  END IF;
  IF NOT rabbit_private.board_points_ok(NEW.kind, NEW.points) THEN
    RAISE EXCEPTION 'Those points are not a drawing a board knows.' USING ERRCODE = '22023';
  END IF;
  IF NEW.kind = 'sticky' AND NEW.body IS NOT NULL THEN
    RAISE EXCEPTION 'A sticky''s words live in its file.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_board_elements_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_board_elements_guard ON public.board_elements;
CREATE TRIGGER trg_board_elements_guard
  BEFORE INSERT OR UPDATE ON public.board_elements
  FOR EACH ROW EXECUTE FUNCTION public.fn_board_elements_guard();

-- A folder that holds a board, or has one below it, is never deleted or moved by a client's own statement: a
-- board goes to the trash with its folder and moves through Moth's functions (0131). A cascade from a project's
-- purge, the service role and a definer that binds no client role pass, as fn_folders_lock_guard lets them.
CREATE OR REPLACE FUNCTION public.fn_folders_board_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bound BOOLEAN := COALESCE(current_setting('role', true), '') IN ('authenticated', 'anon');
BEGIN
  IF NOT v_bound OR pg_trigger_depth() > 1 THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      WITH RECURSIVE down (id, depth) AS (
        SELECT OLD.id, 1
        UNION ALL
        SELECT c.id, down.depth + 1 FROM down JOIN public.folders c ON c.parent_id = down.id WHERE down.depth < 64
      )
      SELECT 1 FROM down JOIN public.boards b ON b.folder_id = down.id) THEN
      RAISE EXCEPTION 'A board goes to the trash; it is not deleted here.' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  -- 0131's moth_move_folders binds wilson.folder_op = 'move' for its own transaction, after its own checks.
  IF NEW.parent_id IS DISTINCT FROM OLD.parent_id
     AND COALESCE(current_setting('wilson.folder_op', true), '') <> 'move'
     AND EXISTS (SELECT 1 FROM public.boards b WHERE b.folder_id = OLD.id) THEN
    RAISE EXCEPTION 'A board moves through Move to.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_folders_board_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_folders_board_guard ON public.folders;
CREATE TRIGGER trg_folders_board_guard
  BEFORE DELETE OR UPDATE OF parent_id ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.fn_folders_board_guard();

-- §4 Row security ---------------------------------------------------------------
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boards FORCE ROW LEVEL SECURITY;
ALTER TABLE public.board_elements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_elements FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.boards FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.board_elements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.boards TO authenticated;
GRANT SELECT ON public.board_elements TO authenticated;
GRANT ALL ON public.boards TO service_role;
GRANT ALL ON public.board_elements TO service_role;

DROP POLICY IF EXISTS boards_select ON public.boards;
CREATE POLICY boards_select ON public.boards
  FOR SELECT TO authenticated
  USING (workspace_id = public.current_workspace_id()
         AND public.moth_can_read_target('folder', folder_id));

DROP POLICY IF EXISTS board_elements_select ON public.board_elements;
CREATE POLICY board_elements_select ON public.board_elements
  FOR SELECT TO authenticated
  USING (workspace_id = public.current_workspace_id()
         AND EXISTS (SELECT 1 FROM public.boards b
                      WHERE b.id = board_elements.board_id
                        AND public.moth_can_read_target('folder', b.folder_id))
         AND (file_id IS NULL OR public.moth_can_read_target('file', file_id)));

-- §5 Functions ------------------------------------------------------------------

-- The board a caller may read, its folder and its project, or nothing.
CREATE OR REPLACE FUNCTION rabbit_private.board_for(p_board uuid, p_write boolean)
RETURNS public.boards
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_b public.boards%ROWTYPE;
BEGIN
  SELECT * INTO v_b FROM public.boards b
   WHERE b.id = p_board AND b.workspace_id = public.current_workspace_id();
  IF NOT FOUND
     OR NOT COALESCE(public.moth_can_read_target('folder', v_b.folder_id), false)
     OR (p_write AND NOT COALESCE(public.moth_can_write_target('folder', v_b.folder_id), false)) THEN
    RETURN NULL;
  END IF;
  RETURN v_b;
END;
$$;
REVOKE EXECUTE ON FUNCTION rabbit_private.board_for(uuid, boolean) FROM PUBLIC, anon, authenticated;

-- A new board: a custom folder under the parent (the project's top folder when none is named) and its board row.
CREATE OR REPLACE FUNCTION public.board_create(p_project uuid, p_parent uuid DEFAULT NULL, p_title text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws     UUID := public.current_workspace_id();
  v_parent public.folders%ROWTYPE;
  v_title  TEXT := btrim(regexp_replace(COALESCE(p_title, ''), '[[:cntrl:]]', ' ', 'g'));
  v_base   TEXT;
  v_slug   TEXT;
  v_path   TEXT;
  v_n      INTEGER := 1;
  v_folder UUID;
  v_board  UUID;
BEGIN
  IF v_title = '' THEN
    v_title := 'Board';
  END IF;
  IF char_length(v_title) > 120 THEN
    RAISE EXCEPTION 'A board''s name is at most 120 characters.' USING ERRCODE = '22023';
  END IF;
  IF p_parent IS NULL THEN
    SELECT * INTO v_parent FROM public.folders fo
     WHERE fo.project_id = p_project AND fo.kind = 'root' AND fo.workspace_id = v_ws;
  ELSE
    SELECT * INTO v_parent FROM public.folders fo
     WHERE fo.id = p_parent AND fo.project_id = p_project AND fo.workspace_id = v_ws;
  END IF;
  -- The parent must be one the caller may write to through Moth's gate (no money or Legal tree, no private project
  -- not theirs, another person's space never). One refusal for all, missing included.
  IF v_parent.id IS NULL OR NOT COALESCE(public.moth_can_write_target('folder', v_parent.id), false) THEN
    RAISE EXCEPTION 'folder not found or not writable' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('moth-boards:' || p_project::text, 0));
  IF (SELECT count(*) FROM public.boards b WHERE b.project_id = p_project) >= 500 THEN
    RAISE EXCEPTION 'A project holds at most 500 boards.' USING ERRCODE = '54000';
  END IF;

  v_base := left(btrim(regexp_replace(lower(v_title), '[^a-z0-9]+', '-', 'g'), '-'), 60);
  IF v_base = '' THEN
    v_base := 'board';
  END IF;
  LOOP
    v_slug := CASE WHEN v_n = 1 THEN v_base ELSE v_base || '-' || v_n::text END;
    v_path := CASE WHEN v_parent.path = '' THEN v_slug ELSE v_parent.path || '/' || v_slug END;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.folders fo WHERE fo.project_id = p_project AND fo.path = v_path);
    v_n := v_n + 1;
    IF v_n > 200 THEN
      RAISE EXCEPTION 'Too many folders of that name here.' USING ERRCODE = '23505';
    END IF;
  END LOOP;

  INSERT INTO public.folders (project_id, workspace_id, parent_id, kind, slug, label, path, created_by, updated_by)
  VALUES (p_project, v_ws, v_parent.id, 'custom', v_slug, v_title, v_path, auth.uid(), auth.uid())
  RETURNING id INTO v_folder;
  IF public.moth_folder_chain_locked(v_ws, v_folder) THEN
    RAISE EXCEPTION 'folder not found or not writable' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.boards (folder_id, project_id, workspace_id) VALUES (v_folder, p_project, v_ws)
  RETURNING id INTO v_board;
  RETURN jsonb_build_object('board_id', v_board, 'folder_id', v_folder, 'project_id', p_project,
                            'title', v_title, 'path', v_path);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.board_create(uuid, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.board_create(uuid, uuid, text) TO authenticated;

-- One element as the caller may see it. A file they may not read, or one that has gone, is a stop-sign tile:
-- no file id, no name, only that it is missing.
CREATE OR REPLACE FUNCTION rabbit_private.board_element_json(e public.board_elements)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_file JSONB := NULL;
  v_missing BOOLEAN := false;
BEGIN
  IF e.kind IN ('sticky', 'media', 'embed') THEN
    IF e.file_id IS NOT NULL AND COALESCE(public.moth_can_read_target('file', e.file_id), false) THEN
      SELECT jsonb_build_object('id', f.id, 'name', left(f.name, 300), 'mime_type', f.mime_type,
                                'folder_id', f.folder_id, 'project_id', f.project_id)
        INTO v_file FROM public.files f WHERE f.id = e.file_id;
    END IF;
    v_missing := v_file IS NULL;
  END IF;
  RETURN jsonb_build_object(
    'id', e.id, 'kind', e.kind, 'shape', e.shape, 'x', e.x, 'y', e.y, 'w', e.w, 'h', e.h,
    'rotation', e.rotation, 'z', e.z, 'style', e.style, 'body', e.body, 'points', e.points,
    'file', v_file, 'missing', v_missing,
    'from_id', e.from_id, 'from_anchor', e.from_anchor, 'to_id', e.to_id, 'to_anchor', e.to_anchor,
    'version', e.version, 'updated_at', e.updated_at, 'updated_by', e.updated_by);
END;
$$;
REVOKE EXECUTE ON FUNCTION rabbit_private.board_element_json(public.board_elements) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.board_read(p_board uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_b public.boards%ROWTYPE := rabbit_private.board_for(p_board, false);
  v_label TEXT;
BEGIN
  IF v_b.id IS NULL THEN
    RAISE EXCEPTION 'board not found' USING ERRCODE = '42501';
  END IF;
  SELECT fo.label INTO v_label FROM public.folders fo WHERE fo.id = v_b.folder_id;
  RETURN jsonb_build_object(
    'board', jsonb_build_object('id', v_b.id, 'folder_id', v_b.folder_id, 'project_id', v_b.project_id,
                                'title', v_label, 'revision', v_b.revision, 'audience_gen', v_b.audience_gen,
                                'can_write', COALESCE(public.moth_can_write_target('folder', v_b.folder_id), false)),
    'elements', COALESCE((SELECT jsonb_agg(rabbit_private.board_element_json(e) ORDER BY e.z, e.id)
                            FROM (SELECT * FROM public.board_elements x WHERE x.board_id = v_b.id
                                   ORDER BY x.z, x.id LIMIT 5000) e), '[]'::jsonb),
    'truncated', (SELECT count(*) > 5000 FROM (SELECT 1 FROM public.board_elements x
                                                 WHERE x.board_id = v_b.id LIMIT 5001) c));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.board_read(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.board_read(uuid) TO authenticated;

-- Save elements: each is its whole new state (the client sends what it drew). Last writer wins each element; an
-- element with "expect" (an undo, or a redo) is saved only over that version, else it is skipped and named in
-- "conflicts". Ids may be the client's, for drawing before the answer; an id that is another board's is refused.
CREATE OR REPLACE FUNCTION public.board_put_elements(p_board uuid, p_elements jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_b        public.boards%ROWTYPE := rabbit_private.board_for(p_board, true);
  v_el       JSONB;
  v_id       UUID;
  v_old      public.board_elements%ROWTYPE;
  v_saved    JSONB := '[]'::jsonb;
  v_conf     JSONB := '[]'::jsonb;
  v_version  BIGINT;
  v_new      INTEGER := 0;
BEGIN
  IF v_b.id IS NULL THEN
    RAISE EXCEPTION 'board not found or not writable' USING ERRCODE = '42501';
  END IF;
  IF p_elements IS NULL OR jsonb_typeof(p_elements) <> 'array' OR jsonb_array_length(p_elements) = 0 THEN
    RAISE EXCEPTION 'Nothing to save.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_elements) > 500 THEN
    RAISE EXCEPTION 'At most 500 elements a save.' USING ERRCODE = '54000';
  END IF;
  -- One board's saves in order, so the count below and the versions are each one statement's truth.
  PERFORM 1 FROM public.boards b WHERE b.id = v_b.id FOR NO KEY UPDATE;

  FOR v_el IN SELECT e FROM jsonb_array_elements(p_elements) e LOOP
    IF jsonb_typeof(v_el) <> 'object' THEN
      RAISE EXCEPTION 'An element is an object.' USING ERRCODE = '22023';
    END IF;
    v_id := public.fn_try_uuid(v_el ->> 'id');
    IF v_id IS NULL THEN
      v_id := gen_random_uuid();
    END IF;
    SELECT * INTO v_old FROM public.board_elements x WHERE x.id = v_id FOR UPDATE;
    IF FOUND AND v_old.board_id IS DISTINCT FROM v_b.id THEN
      RAISE EXCEPTION 'element not found' USING ERRCODE = '42501';
    END IF;
    IF FOUND THEN
      IF v_el ? 'expect' AND (v_el ->> 'expect')::bigint IS DISTINCT FROM v_old.version THEN
        v_conf := v_conf || jsonb_build_object('id', v_id, 'version', v_old.version);
        CONTINUE;
      END IF;
      UPDATE public.board_elements x SET
        shape = CASE WHEN v_el ? 'shape' THEN v_el ->> 'shape' ELSE x.shape END,
        x = COALESCE((v_el ->> 'x')::double precision, x.x),
        y = COALESCE((v_el ->> 'y')::double precision, x.y),
        w = COALESCE((v_el ->> 'w')::double precision, x.w),
        h = COALESCE((v_el ->> 'h')::double precision, x.h),
        rotation = COALESCE((v_el ->> 'rotation')::double precision, x.rotation),
        z = COALESCE((v_el ->> 'z')::bigint, x.z),
        style = CASE WHEN v_el ? 'style' THEN COALESCE(v_el -> 'style', '{}'::jsonb) ELSE x.style END,
        body = CASE WHEN v_el ? 'body' THEN v_el ->> 'body' ELSE x.body END,
        points = CASE WHEN v_el ? 'points' THEN CASE WHEN jsonb_typeof(v_el -> 'points') = 'null' THEN NULL
                                                    ELSE v_el -> 'points' END ELSE x.points END,
        from_id = CASE WHEN v_el ? 'from_id' THEN public.fn_try_uuid(v_el ->> 'from_id') ELSE x.from_id END,
        from_anchor = CASE WHEN v_el ? 'from_anchor' THEN v_el ->> 'from_anchor' ELSE x.from_anchor END,
        to_id = CASE WHEN v_el ? 'to_id' THEN public.fn_try_uuid(v_el ->> 'to_id') ELSE x.to_id END,
        to_anchor = CASE WHEN v_el ? 'to_anchor' THEN v_el ->> 'to_anchor' ELSE x.to_anchor END
       WHERE x.id = v_id
      RETURNING x.version INTO v_version;
    ELSE
      IF v_el ? 'expect' THEN
        -- An undo of a removal brings an element back only if nobody made another under its id since.
        IF (v_el ->> 'expect')::bigint IS DISTINCT FROM 0 THEN
          v_conf := v_conf || jsonb_build_object('id', v_id, 'version', NULL);
          CONTINUE;
        END IF;
      END IF;
      v_new := v_new + 1;
      INSERT INTO public.board_elements (id, board_id, project_id, workspace_id, kind, shape, x, y, w, h, rotation, z,
                                         style, body, points, file_id, from_id, from_anchor, to_id, to_anchor)
      VALUES (v_id, v_b.id, v_b.project_id, v_b.workspace_id, v_el ->> 'kind', v_el ->> 'shape',
              COALESCE((v_el ->> 'x')::double precision, 0), COALESCE((v_el ->> 'y')::double precision, 0),
              COALESCE((v_el ->> 'w')::double precision, 0), COALESCE((v_el ->> 'h')::double precision, 0),
              COALESCE((v_el ->> 'rotation')::double precision, 0), COALESCE((v_el ->> 'z')::bigint, 0),
              COALESCE(v_el -> 'style', '{}'::jsonb), v_el ->> 'body',
              CASE WHEN jsonb_typeof(v_el -> 'points') IN ('array') THEN v_el -> 'points' END,
              public.fn_try_uuid(v_el ->> 'file_id'),
              public.fn_try_uuid(v_el ->> 'from_id'), v_el ->> 'from_anchor',
              public.fn_try_uuid(v_el ->> 'to_id'), v_el ->> 'to_anchor')
      RETURNING version INTO v_version;
    END IF;
    v_saved := v_saved || jsonb_build_object('id', v_id, 'version', v_version);
  END LOOP;

  IF v_new > 0 AND (SELECT count(*) FROM public.board_elements x WHERE x.board_id = v_b.id) > 5000 THEN
    RAISE EXCEPTION 'A board holds at most 5,000 elements.' USING ERRCODE = '54000';
  END IF;
  IF jsonb_array_length(v_saved) > 0 THEN
    UPDATE public.boards b SET revision = b.revision + 1, updated_at = now(), updated_by = auth.uid()
     WHERE b.id = v_b.id;
  END IF;
  RETURN jsonb_build_object('saved', v_saved, 'conflicts', v_conf);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.board_put_elements(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.board_put_elements(uuid, jsonb) TO authenticated;

-- Remove elements. A placement only: the file it showed stays where it is. With versions (an undo of a create), an
-- element changed since is skipped and named in "conflicts".
CREATE OR REPLACE FUNCTION public.board_delete_elements(p_board uuid, p_ids uuid[], p_versions bigint[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_b       public.boards%ROWTYPE := rabbit_private.board_for(p_board, true);
  v_gone    JSONB := '[]'::jsonb;
  v_conf    JSONB := '[]'::jsonb;
  i         INTEGER;
  v_ver     BIGINT;
BEGIN
  IF v_b.id IS NULL THEN
    RAISE EXCEPTION 'board not found or not writable' USING ERRCODE = '42501';
  END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) > 500
     OR (p_versions IS NOT NULL AND cardinality(p_versions) <> cardinality(p_ids)) THEN
    RAISE EXCEPTION 'At most 500 elements a removal, each with its version when versions are sent.' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.boards b WHERE b.id = v_b.id FOR NO KEY UPDATE;
  FOR i IN 1 .. cardinality(p_ids) LOOP
    SELECT x.version INTO v_ver FROM public.board_elements x
     WHERE x.id = p_ids[i] AND x.board_id = v_b.id FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;
    IF p_versions IS NOT NULL AND p_versions[i] IS DISTINCT FROM v_ver THEN
      v_conf := v_conf || jsonb_build_object('id', p_ids[i], 'version', v_ver);
      CONTINUE;
    END IF;
    DELETE FROM public.board_elements x WHERE x.id = p_ids[i] AND x.board_id = v_b.id;
    v_gone := v_gone || to_jsonb(p_ids[i]);
  END LOOP;
  IF jsonb_array_length(v_gone) > 0 THEN
    UPDATE public.boards b SET revision = b.revision + 1, updated_at = now(), updated_by = auth.uid()
     WHERE b.id = v_b.id;
  END IF;
  RETURN jsonb_build_object('removed', v_gone, 'conflicts', v_conf);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.board_delete_elements(uuid, uuid[], bigint[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.board_delete_elements(uuid, uuid[], bigint[]) TO authenticated;

COMMENT ON TABLE public.boards IS
  '0130: one row a board, keyed by its custom folder (UNIQUE folder_id; (folder_id, project_id) to folders). A board is '
  'a folder: its stickies and dropped files are files in it. Clients read it through moth_can_read_target(''folder'', '
  'folder_id) and never write it: board_create makes one; 0131 trashes and moves it with its folder.';
COMMENT ON TABLE public.board_elements IS
  '0130: one row an element of a board: placement, style, words, a pen''s points, a file for a sticky, a medium or an '
  'embed (ON DELETE SET NULL: the stop-sign tile), a connector''s ends in the same board. Clients read through the '
  'board''s folder gate and the file''s, and write only through board_put_elements and board_delete_elements. '
  'Removing an element never removes a file.';

-- §6 Post-conditions ------------------------------------------------------------
DO $$
DECLARE
  v_n INTEGER;
BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.boards'::regclass)
     OR NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.board_elements'::regclass) THEN
    RAISE EXCEPTION '0130 post-condition: row security not forced on the board tables';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('boards', 'board_elements');
  IF v_n <> 2 THEN
    RAISE EXCEPTION '0130 post-condition: % policies on the board tables, not 2', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
              WHERE table_schema = 'public' AND table_name IN ('boards', 'board_elements')
                AND grantee IN ('authenticated', 'anon', 'PUBLIC') AND privilege_type <> 'SELECT')
     OR EXISTS (SELECT 1 FROM information_schema.role_table_grants
                 WHERE table_schema = 'public' AND table_name IN ('boards', 'board_elements')
                   AND grantee IN ('anon', 'PUBLIC')) THEN
    RAISE EXCEPTION '0130 post-condition: a client may do more than read a board table';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.column_privileges
              WHERE table_schema = 'public' AND table_name IN ('boards', 'board_elements')
                AND grantee IN ('authenticated', 'anon') AND privilege_type <> 'SELECT') THEN
    RAISE EXCEPTION '0130 post-condition: a client holds a column grant beyond SELECT on a board table';
  END IF;
  IF has_function_privilege('anon', 'public.board_put_elements(uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'rabbit_private.board_for(uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'rabbit_private.board_element_json(public.board_elements)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.board_read(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0130 post-condition: the board functions'' grants are not as written';
  END IF;
  -- A board's connectors and its file are held by keys, not only by the functions.
  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conrelid = 'public.board_elements'::regclass AND contype = 'f'
     AND conname IN ('board_elements_board_fk', 'board_elements_from_fk', 'board_elements_to_fk');
  IF v_n <> 3 THEN
    RAISE EXCEPTION '0130 post-condition: % of the elements'' three keys', v_n;
  END IF;
  IF (SELECT confdeltype FROM pg_constraint WHERE conrelid = 'public.board_elements'::regclass
        AND contype = 'f' AND confrelid = 'public.files'::regclass) <> 'n' THEN
    RAISE EXCEPTION '0130 post-condition: an element''s file must be set null on the file''s delete';
  END IF;
  -- Nothing of a board reaches a file's delete: no key from files to the board tables.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.files'::regclass AND contype = 'f'
              AND confrelid IN ('public.boards'::regclass, 'public.board_elements'::regclass)) THEN
    RAISE EXCEPTION '0130 post-condition: files must not depend on a board';
  END IF;
END $$;
