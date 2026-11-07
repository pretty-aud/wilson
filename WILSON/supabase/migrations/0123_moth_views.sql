-- =============================================================================
-- 0123_moth_views.sql — M.O.T.H. Session 2 (MO2): saved views, their layouts, and each person's Moth settings.
-- (docs/design/MOTH_DESIGN.md §1.13, §2.5 "DEFERRED (S2)", the personal area's A6-1 and SEC-11;
--  docs/sessions/briefs/MOTH_PLANNING_BRIEF.md §2 "Saved views" and "Layouts persist", §12a.2.)
--
--   §1  moth_views. A view is a project's, shared with everyone who may write to that project (the
--       custom table views' pattern, 0098), or a person's own across every project they can see
--       (an 'aggregate' view: the quick starts are of that kind). Its config says which kinds are dots,
--       which lines show, the layout and the filters, and can hold no id at all (a CHECK refuses anything
--       shaped like one): whatever a view points at is a row of §2, read through Moth's gate each time.
--   §2  moth_layout_positions. Where each dot of a view was put, and its marks: pinned by hand, opened
--       (a folder shown open), the focus. A place is readable only while its view and its target are
--       (moth_can_read_target, live), and a person's own places are theirs alone: a person's own view, or
--       a view of their personal space, keeps the places of its owner, never shared. A shared project
--       view's places are written by those who may write to the project, so a reviewer looks but cannot
--       rearrange. Places are written only through moth_put_positions and moth_clear_positions, definers that
--       check the view and the right once and each target through Moth's gate, and read in bulk through
--       moth_view_positions; a target the caller cannot see is refused exactly as one that does not exist.
--   §3  user_settings.moth_prefs. Per company, for this person: the last view (her §12a.2, "Moth reopens on
--       the person's last view"), whether the first visit is done, the appearance in Settings and the
--       folders opened last (§3.3). Written by set_moth_prefs; read by moth_prefs(), which trusts nothing
--       stored: it drops what is not of its shape, keeps a folder only while the person can still see it,
--       and starts afresh for a membership made again (a person deactivated and reactivated keeps theirs, every
--       id in it read again through Moth's gate).
-- Views are hard-deleted (the page's undo makes the view again, with its places), and nothing here is captured
-- into moth_history or sent on a channel (no broadcast trigger names either table). Suites 125_moth_views.sql and
-- 126_moth_layout_positions.sql, and 57_user_settings.sql.
-- =============================================================================

SET LOCAL lock_timeout = '15s';

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
DECLARE
  v_md5 TEXT;
  v_fn  RECORD;
BEGIN
  IF to_regprocedure('public.moth_project_items(uuid)') IS NULL THEN
    RAISE EXCEPTION '0123 refused: 0122 must be applied first';
  END IF;
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0123 refused: % does not bypass row security', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'user_settings' AND column_name = 'table_view_last') THEN
    RAISE EXCEPTION '0123 refused: user_settings is not 0098''s';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.projects'::regclass AND contype = 'u'
                    AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.projects'::regclass AND attname = 'id'),
                                       (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.projects'::regclass AND attname = 'workspace_id')]::smallint[]) THEN
    RAISE EXCEPTION '0123 refused: projects has no (id, workspace_id) key for a view to name';
  END IF;
  -- A second run finds its own functions, or none.
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('public.fn_moth_views_pin()', '0349739ead25a724e85e6153e587a9ab'),
      ('public.fn_moth_views_cap()', 'ebf516313daa29c2cd11b7968501cd6c'),
      ('rabbit_private.moth_target_project(text,uuid)', '92d4ccab0e850e9fcf5b5bff0b669e23'),
      ('public.fn_moth_layout_positions_pin()', 'c59e26073d09892e318485d765da16a1'),
      ('public.moth_put_positions(uuid,jsonb)', 'f59d16206c43c1a57a07de799bb22246'),
      ('public.moth_clear_positions(uuid)', '7a348d2d44c7f5ebdbba48530d6ed6c9'),
      ('public.moth_view_positions(uuid)', 'ad15d4bee300230db7fc52d8dfa6c48a'),
      ('public.set_moth_prefs(jsonb)', '7898e7c598d844a3d28c130a7e933973'),
      ('public.moth_prefs()', 'fd458943dde1fc38acccf2f800590c6a')
    ) AS t(sig, now_is)
  LOOP
    IF to_regprocedure(v_fn.sig) IS NULL THEN
      CONTINUE;
    END IF;
    SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc WHERE oid = v_fn.sig::regprocedure;
    IF v_md5 IS DISTINCT FROM v_fn.now_is THEN
      RAISE EXCEPTION '0123 refused: % is not this file''s body (md5 %)', v_fn.sig, v_md5;
    END IF;
  END LOOP;
  -- A table already there must be this file's whole: a draft's, missing a CHECK or a key, would pass CREATE TABLE
  -- IF NOT EXISTS silently.
  IF to_regclass('public.moth_views') IS NOT NULL THEN
    IF (SELECT count(*) FROM pg_constraint WHERE conrelid = to_regclass('public.moth_views') AND conname IN
         ('moth_views_id_workspace_key', 'moth_views_scope_chk', 'moth_views_name_chk', 'moth_views_position_chk',
          'moth_views_config_chk', 'moth_views_config_no_ids_chk', 'moth_views_project_fk')) <> 7 THEN
      RAISE EXCEPTION '0123 refused: a moth_views table is here that is not this file''s';
    END IF;
  END IF;
  IF to_regclass('public.moth_layout_positions') IS NOT NULL THEN
    IF (SELECT count(*) FROM pg_constraint WHERE conrelid = to_regclass('public.moth_layout_positions') AND contype IN ('f', 'c')) <> 16 THEN
      RAISE EXCEPTION '0123 refused: a moth_layout_positions table is here that is not this file''s';
    END IF;
  END IF;
END $$;

-- §1 Saved views ---------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.moth_views_revision_seq AS BIGINT;

CREATE TABLE IF NOT EXISTS public.moth_views (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL DEFAULT public.current_workspace_id() REFERENCES public.workspaces(id) ON DELETE CASCADE,
  scope_kind    TEXT NOT NULL,
  project_id    UUID,
  owner_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  position      INTEGER NOT NULL DEFAULT 0,
  revision      BIGINT NOT NULL DEFAULT 0,
  revised_by    UUID,
  config        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID,

  CONSTRAINT moth_views_id_workspace_key UNIQUE (id, workspace_id),
  CONSTRAINT moth_views_scope_chk CHECK (
    (scope_kind = 'project' AND project_id IS NOT NULL AND owner_id IS NULL)
    OR (scope_kind = 'aggregate' AND project_id IS NULL AND owner_id IS NOT NULL)),
  CONSTRAINT moth_views_name_chk
    CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 80 AND name !~ '[[:cntrl:]]'),
  CONSTRAINT moth_views_position_chk CHECK (position >= 0),
  CONSTRAINT moth_views_config_chk
    CHECK (jsonb_typeof(config) = 'object' AND octet_length(config::text) <= 32768),
  -- SEC-02: no id in a config, with or without its hyphens. What a view points at is a row of §2.
  CONSTRAINT moth_views_config_no_ids_chk
    CHECK (config::text !~* '[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}'),
  CONSTRAINT moth_views_project_fk
    FOREIGN KEY (project_id, workspace_id) REFERENCES public.projects (id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS moth_views_project_idx ON public.moth_views (project_id, position, created_at, id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_views_owner_idx ON public.moth_views (workspace_id, owner_id, position, created_at, id) WHERE owner_id IS NOT NULL;

-- Who a view belongs to is never the client's to say: its company is the caller's, a person's own view is
-- the caller's own, and none of that, nor its scope or project, changes after. A new revision on insert and on
-- every change of config, so a save from an old copy cannot land over a newer one; a rename or a reorder keeps
-- it (0098's pattern).
CREATE OR REPLACE FUNCTION public.fn_moth_views_pin()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_me UUID := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_me IS NOT NULL THEN
      NEW.workspace_id := public.current_workspace_id();
      NEW.owner_id     := CASE WHEN NEW.scope_kind = 'aggregate' THEN v_me END;
      NEW.created_by   := v_me;
      NEW.updated_by   := v_me;
      NEW.created_at   := now();
      NEW.updated_at   := now();
    END IF;
    NEW.revision   := nextval('public.moth_views_revision_seq');
    NEW.revised_by := v_me;
  ELSE
    NEW.id           := OLD.id;
    NEW.workspace_id := OLD.workspace_id;
    NEW.scope_kind   := OLD.scope_kind;
    NEW.project_id   := OLD.project_id;
    NEW.owner_id     := OLD.owner_id;
    NEW.created_by   := OLD.created_by;
    NEW.created_at   := OLD.created_at;
    NEW.updated_at   := now();
    NEW.updated_by   := COALESCE(v_me, OLD.updated_by);
    IF NEW.config IS DISTINCT FROM OLD.config THEN
      NEW.revision   := nextval('public.moth_views_revision_seq');
      NEW.revised_by := v_me;
    ELSE
      NEW.revision   := OLD.revision;
      NEW.revised_by := OLD.revised_by;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- At most 200 views a project, and 200 of a person's own in a company. Two inserts at once cannot both take the
-- last place (the lock), and the count is of the rows the caller can see: a project's writer sees all of its.
CREATE OR REPLACE FUNCTION public.fn_moth_views_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_n INT;
BEGIN
  IF NEW.scope_kind = 'project' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('moth_views:p:' || NEW.project_id::text, 0));
    SELECT count(*) INTO v_n FROM public.moth_views WHERE project_id = NEW.project_id;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended('moth_views:o:' || NEW.workspace_id::text || ':' || COALESCE(NEW.owner_id::text, ''), 0));
    SELECT count(*) INTO v_n FROM public.moth_views WHERE workspace_id = NEW.workspace_id AND owner_id = NEW.owner_id;
  END IF;
  IF v_n >= 200 THEN
    RAISE EXCEPTION 'At most 200 saved views here.' USING ERRCODE = '54000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_moth_views_a_pin ON public.moth_views;
CREATE TRIGGER trg_moth_views_a_pin BEFORE INSERT OR UPDATE ON public.moth_views
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_views_pin();
DROP TRIGGER IF EXISTS trg_moth_views_b_cap ON public.moth_views;
CREATE TRIGGER trg_moth_views_b_cap BEFORE INSERT ON public.moth_views
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_views_cap();
REVOKE EXECUTE ON FUNCTION public.fn_moth_views_pin() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_moth_views_cap() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.moth_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moth_views FORCE  ROW LEVEL SECURITY;

-- A project's view through the projects hop and Moth's gate (owner-only for a personal space, no admin leg);
-- a person's own view to that person alone, admins included.
DROP POLICY IF EXISTS moth_views_select ON public.moth_views;
CREATE POLICY moth_views_select ON public.moth_views
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND ((scope_kind = 'project'
          AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = moth_views.project_id AND p.workspace_id = moth_views.workspace_id)
          AND public.moth_can_read_target('project', project_id))
         OR (scope_kind = 'aggregate' AND owner_id = auth.uid()))
  );

DROP POLICY IF EXISTS moth_views_insert ON public.moth_views;
CREATE POLICY moth_views_insert ON public.moth_views
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND ((scope_kind = 'project'
          AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = moth_views.project_id AND p.workspace_id = moth_views.workspace_id)
          AND public.moth_can_write_target('project', project_id))
         OR (scope_kind = 'aggregate' AND owner_id = auth.uid()))
  );

DROP POLICY IF EXISTS moth_views_update ON public.moth_views;
CREATE POLICY moth_views_update ON public.moth_views
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND ((scope_kind = 'project'
          AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = moth_views.project_id AND p.workspace_id = moth_views.workspace_id)
          AND public.moth_can_write_target('project', project_id))
         OR (scope_kind = 'aggregate' AND owner_id = auth.uid()))
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND ((scope_kind = 'project'
          AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = moth_views.project_id AND p.workspace_id = moth_views.workspace_id)
          AND public.moth_can_write_target('project', project_id))
         OR (scope_kind = 'aggregate' AND owner_id = auth.uid()))
  );

DROP POLICY IF EXISTS moth_views_delete ON public.moth_views;
CREATE POLICY moth_views_delete ON public.moth_views
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND ((scope_kind = 'project'
          AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = moth_views.project_id AND p.workspace_id = moth_views.workspace_id)
          AND public.moth_can_write_target('project', project_id))
         OR (scope_kind = 'aggregate' AND owner_id = auth.uid()))
  );

-- No id, company or owner from the client: a chosen id could only ask whether another company holds it.
REVOKE ALL ON public.moth_views FROM PUBLIC, anon;
REVOKE ALL ON public.moth_views FROM authenticated;
GRANT SELECT, DELETE ON public.moth_views TO authenticated;
GRANT INSERT (scope_kind, project_id, name, position, config) ON public.moth_views TO authenticated;
GRANT UPDATE (name, position, config) ON public.moth_views TO authenticated;
GRANT ALL ON public.moth_views TO service_role;
REVOKE ALL ON SEQUENCE public.moth_views_revision_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SEQUENCE public.moth_views_revision_seq TO authenticated, service_role;

-- §2 Where each dot of a view was put --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.moth_layout_positions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  view_id         UUID NOT NULL,
  workspace_id    UUID NOT NULL DEFAULT public.current_workspace_id(),
  target_type     TEXT NOT NULL,
  target_id       UUID,
  target_tag      TEXT,
  owner_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  x               DOUBLE PRECISION NOT NULL,
  y               DOUBLE PRECISION NOT NULL,
  pinned          BOOLEAN NOT NULL DEFAULT false,
  is_open         BOOLEAN NOT NULL DEFAULT false,
  is_focus        BOOLEAN NOT NULL DEFAULT false,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID,
  -- One typed reference per kind, so a place goes when its thing does. Id-only on purpose (unlike 0096's),
  -- because a file moves between projects and keeps its places.
  project_ref     UUID GENERATED ALWAYS AS (CASE WHEN target_type = 'project' THEN target_id END) STORED,
  folder_ref      UUID GENERATED ALWAYS AS (CASE WHEN target_type = 'folder' THEN target_id END) STORED,
  file_ref        UUID GENERATED ALWAYS AS (CASE WHEN target_type = 'file' THEN target_id END) STORED,
  phase_ref       UUID GENERATED ALWAYS AS (CASE WHEN target_type = 'phase' THEN target_id END) STORED,
  asset_ref       UUID GENERATED ALWAYS AS (CASE WHEN target_type = 'asset' THEN target_id END) STORED,
  task_ref        UUID GENERATED ALWAYS AS (CASE WHEN target_type = 'task' THEN target_id END) STORED,
  scene_ref       UUID GENERATED ALWAYS AS (CASE WHEN target_type = 'scene' THEN target_id END) STORED,
  shot_ref        UUID GENERATED ALWAYS AS (CASE WHEN target_type = 'shot' THEN target_id END) STORED,
  level_ref       UUID GENERATED ALWAYS AS (CASE WHEN target_type = 'level' THEN target_id END) STORED,
  experience_ref  UUID GENERATED ALWAYS AS (CASE WHEN target_type = 'experience' THEN target_id END) STORED,

  CONSTRAINT moth_layout_positions_view_fk
    FOREIGN KEY (view_id, workspace_id) REFERENCES public.moth_views (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT moth_layout_positions_project_ref_fk FOREIGN KEY (project_ref) REFERENCES public.projects (id) ON DELETE CASCADE,
  CONSTRAINT moth_layout_positions_folder_ref_fk FOREIGN KEY (folder_ref) REFERENCES public.folders (id) ON DELETE CASCADE,
  CONSTRAINT moth_layout_positions_file_ref_fk FOREIGN KEY (file_ref) REFERENCES public.files (id) ON DELETE CASCADE,
  CONSTRAINT moth_layout_positions_phase_ref_fk FOREIGN KEY (phase_ref) REFERENCES public.phases (id) ON DELETE CASCADE,
  CONSTRAINT moth_layout_positions_asset_ref_fk FOREIGN KEY (asset_ref) REFERENCES public.assets (id) ON DELETE CASCADE,
  CONSTRAINT moth_layout_positions_task_ref_fk FOREIGN KEY (task_ref) REFERENCES public.tasks (id) ON DELETE CASCADE,
  CONSTRAINT moth_layout_positions_scene_ref_fk FOREIGN KEY (scene_ref) REFERENCES public.scenes (id) ON DELETE CASCADE,
  CONSTRAINT moth_layout_positions_shot_ref_fk FOREIGN KEY (shot_ref) REFERENCES public.shots (id) ON DELETE CASCADE,
  CONSTRAINT moth_layout_positions_level_ref_fk FOREIGN KEY (level_ref) REFERENCES public.levels (id) ON DELETE CASCADE,
  CONSTRAINT moth_layout_positions_experience_ref_fk FOREIGN KEY (experience_ref) REFERENCES public.experiences (id) ON DELETE CASCADE,
  CONSTRAINT moth_layout_positions_type_chk CHECK (target_type IN
    ('project', 'folder', 'file', 'phase', 'asset', 'task', 'scene', 'shot', 'level', 'experience', 'tag')),
  CONSTRAINT moth_layout_positions_target_chk CHECK (
    ((target_type = 'tag') = (target_id IS NULL)) AND ((target_type = 'tag') = (target_tag IS NOT NULL))),
  -- A tag dot is one of the file tags' fixed words (0085), less the two that never reach Moth.
  CONSTRAINT moth_layout_positions_tag_chk CHECK (target_tag IS NULL OR target_tag IN
    ('production', 'creative', 'reference', 'assets', 'code', 'shots', 'documentation')),
  -- Finite (NaN is not equal to itself, and Infinity is past the bound) and within the layout's world.
  CONSTRAINT moth_layout_positions_xy_chk CHECK (x = x AND y = y AND abs(x) <= 1e7 AND abs(y) <= 1e7)
);

CREATE UNIQUE INDEX IF NOT EXISTS moth_layout_positions_target_key
  ON public.moth_layout_positions (view_id, target_type, target_id, target_tag, owner_id) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX IF NOT EXISTS moth_layout_positions_focus_key
  ON public.moth_layout_positions (view_id, owner_id) NULLS NOT DISTINCT WHERE is_focus;
-- One for each reference, so a project, a file or an item that goes takes its places by index, not by a scan.
CREATE INDEX IF NOT EXISTS moth_layout_positions_project_ref_idx ON public.moth_layout_positions (project_ref) WHERE project_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_layout_positions_folder_ref_idx ON public.moth_layout_positions (folder_ref) WHERE folder_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_layout_positions_file_ref_idx ON public.moth_layout_positions (file_ref) WHERE file_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_layout_positions_phase_ref_idx ON public.moth_layout_positions (phase_ref) WHERE phase_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_layout_positions_asset_ref_idx ON public.moth_layout_positions (asset_ref) WHERE asset_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_layout_positions_task_ref_idx ON public.moth_layout_positions (task_ref) WHERE task_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_layout_positions_scene_ref_idx ON public.moth_layout_positions (scene_ref) WHERE scene_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_layout_positions_shot_ref_idx ON public.moth_layout_positions (shot_ref) WHERE shot_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_layout_positions_level_ref_idx ON public.moth_layout_positions (level_ref) WHERE level_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_layout_positions_experience_ref_idx ON public.moth_layout_positions (experience_ref) WHERE experience_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_layout_positions_owner_idx ON public.moth_layout_positions (owner_id) WHERE owner_id IS NOT NULL;

-- Which project a target is in. Asked by the definers below.
CREATE OR REPLACE FUNCTION rabbit_private.moth_target_project(p_kind text, p_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_kind
    WHEN 'project'    THEN (SELECT p.id FROM public.projects p WHERE p.id = p_id)
    WHEN 'folder'     THEN (SELECT fo.project_id FROM public.folders fo WHERE fo.id = p_id)
    WHEN 'file'       THEN (SELECT f.project_id FROM public.files f WHERE f.id = p_id)
    WHEN 'phase'      THEN (SELECT ph.project_id FROM public.phases ph WHERE ph.id = p_id)
    WHEN 'asset'      THEN (SELECT a.project_id FROM public.assets a WHERE a.id = p_id)
    WHEN 'task'       THEN (SELECT t.project_id FROM public.tasks t WHERE t.id = p_id)
    WHEN 'scene'      THEN (SELECT s.project_id FROM public.scenes s WHERE s.id = p_id)
    WHEN 'shot'       THEN (SELECT sh.project_id FROM public.shots sh WHERE sh.id = p_id)
    WHEN 'level'      THEN (SELECT l.project_id FROM public.levels l WHERE l.id = p_id)
    WHEN 'experience' THEN (SELECT e.project_id FROM public.experiences e WHERE e.id = p_id)
  END;
$$;
REVOKE ALL ON FUNCTION rabbit_private.moth_target_project(text, uuid) FROM PUBLIC, anon, authenticated;

-- The only writers are the definers below. On an update, only where a place is and its marks may change, and the
-- row says when and by whom; what it is of, and whose, never.
CREATE OR REPLACE FUNCTION public.fn_moth_layout_positions_pin()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.id           := OLD.id;
    NEW.view_id      := OLD.view_id;
    NEW.workspace_id := OLD.workspace_id;
    NEW.target_type  := OLD.target_type;
    NEW.target_id    := OLD.target_id;
    NEW.target_tag   := OLD.target_tag;
    NEW.owner_id     := OLD.owner_id;
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_moth_layout_positions_pin ON public.moth_layout_positions;
CREATE TRIGGER trg_moth_layout_positions_pin BEFORE INSERT OR UPDATE ON public.moth_layout_positions
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_layout_positions_pin();
REVOKE EXECUTE ON FUNCTION public.fn_moth_layout_positions_pin() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.moth_layout_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moth_layout_positions FORCE  ROW LEVEL SECURITY;

-- Read: the view (through its own policy), the target (Moth's gate, live), and only the caller's own or shared
-- places. There is no client write: a client holds SELECT only.
DROP POLICY IF EXISTS moth_layout_positions_select ON public.moth_layout_positions;
CREATE POLICY moth_layout_positions_select ON public.moth_layout_positions
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND EXISTS (SELECT 1 FROM public.moth_views v
                 WHERE v.id = moth_layout_positions.view_id AND v.workspace_id = moth_layout_positions.workspace_id)
    AND (owner_id IS NULL OR owner_id = auth.uid())
    AND (target_type = 'tag' OR public.moth_can_read_target(target_type, target_id))
  );

REVOKE ALL ON public.moth_layout_positions FROM PUBLIC, anon;
REVOKE ALL ON public.moth_layout_positions FROM authenticated;
GRANT SELECT ON public.moth_layout_positions TO authenticated;
GRANT ALL ON public.moth_layout_positions TO service_role;

-- The view a caller may use, and the places they may write in it: their own (a view of their own, or of their
-- personal space), or a shared project view's when they may write to the project. Refused with one sentence,
-- the words a missing key would give, when the view is hidden or not there (SEC-11: no row's existence told).
-- Returns the owner the places are written under (NULL for shared), and whether the caller may write.
CREATE OR REPLACE FUNCTION rabbit_private.moth_view_access(p_view uuid, OUT o_scope text, OUT o_project uuid, OUT o_owner uuid, OUT o_write boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me UUID := auth.uid();
  v_ws UUID := public.current_workspace_id();
BEGIN
  SELECT v.scope_kind, v.project_id INTO o_scope, o_project
    FROM public.moth_views v
   WHERE v.id = p_view
     AND v_me IS NOT NULL AND v.workspace_id = v_ws
     AND public.has_active_membership(v_ws)
     AND ((v.scope_kind = 'project' AND public.moth_can_read_target('project', v.project_id))
          OR (v.scope_kind = 'aggregate' AND v.owner_id = v_me));
  IF o_scope IS NULL THEN
    RAISE EXCEPTION 'insert or update on table "moth_layout_positions" violates foreign key constraint "moth_layout_positions_view_fk"'
      USING ERRCODE = '23503';
  END IF;
  IF o_scope = 'aggregate'
     OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = o_project AND p.personal_owner_id IS NOT NULL) THEN
    o_owner := v_me;
    o_write := true;
  ELSE
    o_owner := NULL;
    o_write := public.moth_can_write_target('project', o_project);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION rabbit_private.moth_view_access(uuid) FROM PUBLIC, anon, authenticated;

-- Many places in one call, each added or moved. The view and the right are asked once; each target through
-- Moth's gate, and a project's view takes that project's things only. The shape is checked whole first, so a list
-- is taken all or not at all; a target named twice keeps its last place; one focus at most, which clears the old
-- one whoever can see it (a mark cleared tells nothing). At most 1,000 places a call, and 20,000 a view for each
-- owner, counted under a lock.
CREATE OR REPLACE FUNCTION public.moth_put_positions(p_view uuid, p_places jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  a      RECORD;
  v_n    INT;
  v_bad  RECORD;
  v_have INT;
BEGIN
  IF p_view IS NULL OR p_places IS NULL OR jsonb_typeof(p_places) <> 'array' OR jsonb_array_length(p_places) > 1000 THEN
    RAISE EXCEPTION 'Places come as a list of at most 1,000.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_places) AS e(v)
     WHERE jsonb_typeof(e.v) <> 'object'
        OR jsonb_typeof(e.v -> 't') IS DISTINCT FROM 'string'
        OR jsonb_typeof(e.v -> 'x') IS DISTINCT FROM 'number'
        OR jsonb_typeof(e.v -> 'y') IS DISTINCT FROM 'number'
        OR (e.v ? 'pinned' AND jsonb_typeof(e.v -> 'pinned') <> 'boolean')
        OR (e.v ? 'open' AND jsonb_typeof(e.v -> 'open') <> 'boolean')
        OR (e.v ? 'focus' AND jsonb_typeof(e.v -> 'focus') <> 'boolean')
        OR (e.v ->> 't' = 'tag' AND (jsonb_typeof(e.v -> 'tag') IS DISTINCT FROM 'string' OR e.v ? 'id'))
        OR (e.v ->> 't' <> 'tag' AND (e.v ? 'tag'
            OR jsonb_typeof(e.v -> 'id') IS DISTINCT FROM 'string'
            OR (e.v ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
  ) THEN
    RAISE EXCEPTION 'A place is not of the right shape.' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_places) AS e(v) WHERE (e.v ->> 'focus') = 'true') > 1 THEN
    RAISE EXCEPTION 'A view has one focus at most.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO a FROM rabbit_private.moth_view_access(p_view);
  IF NOT a.o_write THEN
    RAISE EXCEPTION 'Only those who may change this project may move its shared places.' USING ERRCODE = '42501';
  END IF;

  -- Each target as Moth shows it to the caller; hidden or not there, the same words.
  SELECT e.v ->> 't' AS t, e.v ->> 'tag' AS tag, e.v ->> 'id' AS id INTO v_bad
    FROM jsonb_array_elements(p_places) AS e(v)
   WHERE CASE WHEN e.v ->> 't' = 'tag' THEN false
              ELSE NOT public.moth_can_read_target(e.v ->> 't', (e.v ->> 'id')::uuid) END
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'insert or update on table "moth_layout_positions" violates foreign key constraint "moth_layout_positions_%_ref_fk"',
      v_bad.t USING ERRCODE = '23503';
  END IF;
  IF a.o_scope = 'project' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_places) AS e(v)
        WHERE e.v ->> 't' <> 'tag'
          AND rabbit_private.moth_target_project(e.v ->> 't', (e.v ->> 'id')::uuid) IS DISTINCT FROM a.o_project) THEN
    RAISE EXCEPTION 'A project''s view keeps the places of that project''s things only.' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('moth_layout_positions:' || p_view::text || ':' || COALESCE(a.o_owner::text, ''), 0));
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_places) AS e(v) WHERE (e.v ->> 'focus') = 'true') THEN
    UPDATE public.moth_layout_positions SET is_focus = false
     WHERE view_id = p_view AND owner_id IS NOT DISTINCT FROM a.o_owner AND is_focus;
  END IF;
  INSERT INTO public.moth_layout_positions AS p
         (view_id, workspace_id, target_type, target_id, target_tag, owner_id, x, y, pinned, is_open, is_focus)
  SELECT p_view, public.current_workspace_id(), d.t, d.id, d.tag, a.o_owner, d.x, d.y, d.pinned, d.is_open, d.is_focus
    FROM (
      SELECT DISTINCT ON (e.v ->> 't', (e.v ->> 'id')::uuid, e.v ->> 'tag')
             e.v ->> 't' AS t,
             (e.v ->> 'id')::uuid AS id,
             e.v ->> 'tag' AS tag,
             (e.v ->> 'x')::double precision AS x,
             (e.v ->> 'y')::double precision AS y,
             COALESCE((e.v ->> 'pinned')::boolean, false) AS pinned,
             COALESCE((e.v ->> 'open')::boolean, false) AS is_open,
             COALESCE((e.v ->> 'focus')::boolean, false) AS is_focus
        FROM jsonb_array_elements(p_places) WITH ORDINALITY AS e(v, n)
       ORDER BY e.v ->> 't', (e.v ->> 'id')::uuid, e.v ->> 'tag', e.n DESC
    ) d
  ON CONFLICT (view_id, target_type, target_id, target_tag, owner_id)
  DO UPDATE SET x = EXCLUDED.x, y = EXCLUDED.y, pinned = EXCLUDED.pinned,
                is_open = EXCLUDED.is_open, is_focus = EXCLUDED.is_focus;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  SELECT count(*) INTO v_have FROM public.moth_layout_positions
   WHERE view_id = p_view AND owner_id IS NOT DISTINCT FROM a.o_owner;
  -- Past the bound on raw rows, count only what the caller sees, so a place whose target is hidden now (a file
  -- moved where they cannot follow) never shows itself by a refusal.
  IF v_have > 20000 THEN
    SELECT count(*) INTO v_have FROM public.moth_layout_positions pl
     WHERE pl.view_id = p_view AND pl.owner_id IS NOT DISTINCT FROM a.o_owner
       AND (pl.target_type = 'tag' OR public.moth_can_read_target(pl.target_type, pl.target_id));
    IF v_have > 20000 THEN
      RAISE EXCEPTION 'A view keeps at most 20,000 places.' USING ERRCODE = '54000';
    END IF;
  END IF;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_put_positions(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_put_positions(uuid, jsonb) TO authenticated;

-- A view's places, cleared (its Reset): the caller's own, or a shared view's when they may write to the project.
-- Every one goes, those whose targets are hidden now too, so none comes back when its target does; the number said
-- is of those the caller could see, so a hidden one is not told by it.
CREATE OR REPLACE FUNCTION public.moth_clear_positions(p_view uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  a   RECORD;
  v_n INT;
BEGIN
  SELECT * INTO a FROM rabbit_private.moth_view_access(p_view);
  IF NOT a.o_write THEN
    RAISE EXCEPTION 'Only those who may change this project may clear its shared places.' USING ERRCODE = '42501';
  END IF;
  WITH gone AS (
    DELETE FROM public.moth_layout_positions WHERE view_id = p_view AND owner_id IS NOT DISTINCT FROM a.o_owner
    RETURNING target_type, target_id
  )
  SELECT count(*) INTO v_n FROM gone g WHERE g.target_type = 'tag' OR public.moth_can_read_target(g.target_type, g.target_id);
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_clear_positions(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_clear_positions(uuid) TO authenticated;

-- A view's places in bulk, in one answer ({ places }), so no page re-runs the scan: the view asked once, each
-- target through Moth's gate after the fence, the caller's own and the shared ones. What the SELECT policy answers,
-- at one gate a row instead of several. A hidden or missing view answers no place.
CREATE OR REPLACE FUNCTION public.moth_view_positions(p_view uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  a   RECORD;
  v_r jsonb;
BEGIN
  BEGIN
    SELECT * INTO a FROM rabbit_private.moth_view_access(p_view);
  EXCEPTION WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('places', '[]'::jsonb);
  END;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('target_type', c.target_type, 'target_id', c.target_id, 'target_tag', c.target_tag,
                                               'x', c.x, 'y', c.y, 'pinned', c.pinned, 'is_open', c.is_open, 'is_focus', c.is_focus,
                                               'mine', c.owner_id IS NOT NULL) ORDER BY c.id), '[]'::jsonb)
    INTO v_r
    FROM (
      SELECT pl.* FROM public.moth_layout_positions pl
       WHERE pl.view_id = p_view AND (pl.owner_id IS NULL OR pl.owner_id = auth.uid())
       ORDER BY pl.id
      OFFSET 0
    ) c
   WHERE c.target_type = 'tag' OR public.moth_can_read_target(c.target_type, c.target_id);
  RETURN jsonb_build_object('places', v_r);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_view_positions(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_view_positions(uuid) TO authenticated;

-- §3 Each person's Moth settings ------------------------------------------------------
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS moth_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.user_settings'::regclass AND conname = 'user_settings_moth_prefs_chk') THEN
    ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_moth_prefs_chk
      CHECK (jsonb_typeof(moth_prefs) = 'object' AND octet_length(moth_prefs::text) <= 32768);
  END IF;
END $$;

-- One company's entry, merged: what the patch names replaces what was there (appearance key by key), and the
-- entry is stamped with when this person's membership was made, as milliseconds (a number, so no session's time
-- zone can change it), and when it was written. A person removed from the company and added again has a new
-- membership and starts afresh; one deactivated and reactivated keeps theirs, every id in it read again through
-- Moth's gate. At most ten companies are kept, the newest.
CREATE OR REPLACE FUNCTION public.set_moth_prefs(p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me    UUID := auth.uid();
  v_ws    UUID := public.current_workspace_id();
  v_since NUMERIC;
  v_all   JSONB;
  v_cur   JSONB;
  v_app   JSONB;
  v_key   TEXT;
  v_patch JSONB := p_patch;
BEGIN
  IF v_me IS NULL OR v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RAISE EXCEPTION 'Moth''s settings are not available.' USING ERRCODE = '42501';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Moth''s settings come as one object.' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN ('last_view', 'first_visit_done', 'appearance', 'recent') THEN
      RAISE EXCEPTION 'Moth has no setting called %.', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF p_patch ? 'last_view' AND NOT (
       jsonb_typeof(p_patch -> 'last_view') = 'null'
       OR (jsonb_typeof(p_patch -> 'last_view') = 'string'
           AND (p_patch ->> 'last_view') ~* '^(q:(tags|folders)|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$')) THEN
    RAISE EXCEPTION 'The last view is a quick start or a saved view.' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'first_visit_done' AND jsonb_typeof(p_patch -> 'first_visit_done') <> 'boolean' THEN
    RAISE EXCEPTION 'The first visit is done or not.' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'appearance' THEN
    v_app := p_patch -> 'appearance';
    IF jsonb_typeof(v_app) <> 'object' OR EXISTS (
         SELECT 1 FROM jsonb_each(v_app) AS a(k, v)
          WHERE NOT ((a.k = 'glow' AND jsonb_typeof(a.v) = 'string' AND (a.v #>> '{}') ~ '^#[0-9a-f]{6}$')
                  OR (a.k = 'size_by' AND (a.v #>> '{}') IN ('contents', 'recency') AND jsonb_typeof(a.v) = 'string')
                  OR (a.k = 'colour_by' AND (a.v #>> '{}') IN ('kind', 'file_type', 'tag', 'editor') AND jsonb_typeof(a.v) = 'string')
                  OR (a.k = 'light' AND (a.v #>> '{}') IN ('auto', 'full', 'light') AND jsonb_typeof(a.v) = 'string'))) THEN
      RAISE EXCEPTION 'That is not one of Moth''s appearance settings.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_patch ? 'recent' AND (
       jsonb_typeof(p_patch -> 'recent') <> 'array'
       OR jsonb_array_length(p_patch -> 'recent') > 8
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_patch -> 'recent') AS r(v)
                   WHERE jsonb_typeof(r.v) <> 'object'
                      OR (r.v ->> 'k') IS DISTINCT FROM 'folder' AND (r.v ->> 'k') IS DISTINCT FROM 'project'
                      OR jsonb_typeof(r.v -> 'id') IS DISTINCT FROM 'string'
                      OR (r.v ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      OR (SELECT count(*) FROM jsonb_object_keys(r.v)) <> 2)) THEN
    RAISE EXCEPTION 'The folders opened last are at most eight, each a folder or a project.' USING ERRCODE = '22023';
  END IF;

  -- A quick start is kept in the reader's own letters.
  IF jsonb_typeof(v_patch -> 'last_view') = 'string' THEN
    v_patch := jsonb_set(v_patch, '{last_view}', to_jsonb(lower(v_patch ->> 'last_view')));
  END IF;
  SELECT floor(extract(epoch FROM wm.created_at) * 1000) INTO v_since
    FROM public.workspace_members wm
   WHERE wm.workspace_id = v_ws AND wm.user_id = v_me AND wm.is_active;

  INSERT INTO public.user_settings (user_id) VALUES (v_me) ON CONFLICT (user_id) DO NOTHING;
  SELECT us.moth_prefs INTO v_all FROM public.user_settings us WHERE us.user_id = v_me FOR UPDATE;
  v_all := COALESCE(v_all, '{}'::jsonb);
  v_cur := COALESCE(v_all -> v_ws::text, '{}'::jsonb);
  IF jsonb_typeof(v_cur) <> 'object' OR jsonb_typeof(v_cur -> 'member_since') IS DISTINCT FROM 'number'
     OR (v_cur ->> 'member_since')::numeric IS DISTINCT FROM v_since THEN
    v_cur := '{}'::jsonb;
  END IF;
  v_app := COALESCE(CASE WHEN jsonb_typeof(v_cur -> 'appearance') = 'object' THEN v_cur -> 'appearance' END, '{}'::jsonb)
        || COALESCE(v_patch -> 'appearance', '{}'::jsonb);
  v_cur := v_cur || (v_patch - 'appearance')
        || jsonb_build_object('appearance', v_app,
                              'member_since', v_since,
                              'at', floor(extract(epoch FROM clock_timestamp()) * 1000));
  v_all := v_all || jsonb_build_object(v_ws::text, v_cur);
  -- The ten newest companies.
  SELECT COALESCE(jsonb_object_agg(k.key, k.value), '{}'::jsonb) INTO v_all
    FROM (SELECT e.key, e.value FROM jsonb_each(v_all) AS e
           ORDER BY CASE WHEN jsonb_typeof(e.value -> 'at') = 'number' THEN (e.value ->> 'at')::numeric END DESC NULLS LAST, e.key
           LIMIT 10) k;
  UPDATE public.user_settings SET moth_prefs = v_all WHERE user_id = v_me;
  RETURN public.moth_prefs();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_moth_prefs(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_moth_prefs(jsonb) TO authenticated;

-- What this person's settings say for this company, trusting nothing stored (the row is the person's own to
-- write directly): each value is kept only in its own shape, the last view only while it is a quick start or
-- a view the person can see, and an opened folder only while Moth shows it to them. Eight at most.
CREATE OR REPLACE FUNCTION public.moth_prefs()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me    UUID := auth.uid();
  v_ws    UUID := public.current_workspace_id();
  v_since NUMERIC;
  v_cur   JSONB;
  v_out   JSONB := '{}'::jsonb;
  v_lv    TEXT;
  v_app   JSONB := '{}'::jsonb;
  v_rec   JSONB := '[]'::jsonb;
  v_row   RECORD;
BEGIN
  IF v_me IS NULL OR v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RETURN '{}'::jsonb;
  END IF;
  SELECT floor(extract(epoch FROM wm.created_at) * 1000) INTO v_since
    FROM public.workspace_members wm
   WHERE wm.workspace_id = v_ws AND wm.user_id = v_me AND wm.is_active;
  SELECT us.moth_prefs -> v_ws::text INTO v_cur FROM public.user_settings us WHERE us.user_id = v_me;
  IF v_cur IS NULL OR jsonb_typeof(v_cur) <> 'object' OR jsonb_typeof(v_cur -> 'member_since') IS DISTINCT FROM 'number'
     OR (v_cur ->> 'member_since')::numeric IS DISTINCT FROM v_since THEN
    RETURN '{}'::jsonb;
  END IF;

  IF jsonb_typeof(v_cur -> 'last_view') = 'string' THEN
    v_lv := v_cur ->> 'last_view';
    IF v_lv IN ('q:tags', 'q:folders')
       OR (v_lv ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           AND EXISTS (SELECT 1 FROM public.moth_views v WHERE v.id = v_lv::uuid)) THEN
      v_out := v_out || jsonb_build_object('last_view', v_lv);
    END IF;
  END IF;
  IF jsonb_typeof(v_cur -> 'first_visit_done') = 'boolean' THEN
    v_out := v_out || jsonb_build_object('first_visit_done', v_cur -> 'first_visit_done');
  END IF;
  IF jsonb_typeof(v_cur -> 'appearance') = 'object' THEN
    SELECT COALESCE(jsonb_object_agg(a.k, a.v), '{}'::jsonb) INTO v_app
      FROM jsonb_each(v_cur -> 'appearance') AS a(k, v)
     WHERE jsonb_typeof(a.v) = 'string'
       AND ((a.k = 'glow' AND (a.v #>> '{}') ~ '^#[0-9a-f]{6}$')
            OR (a.k = 'size_by' AND (a.v #>> '{}') IN ('contents', 'recency'))
            OR (a.k = 'colour_by' AND (a.v #>> '{}') IN ('kind', 'file_type', 'tag', 'editor'))
            OR (a.k = 'light' AND (a.v #>> '{}') IN ('auto', 'full', 'light')));
    v_out := v_out || jsonb_build_object('appearance', v_app);
  END IF;
  IF jsonb_typeof(v_cur -> 'recent') = 'array' THEN
    FOR v_row IN
      SELECT r.v FROM jsonb_array_elements(v_cur -> 'recent') WITH ORDINALITY AS r(v, n)
       WHERE jsonb_typeof(r.v) = 'object'
         AND (r.v ->> 'k') IN ('folder', 'project')
         AND jsonb_typeof(r.v -> 'id') = 'string'
         AND (r.v ->> 'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       ORDER BY r.n
       LIMIT 32
    LOOP
      EXIT WHEN jsonb_array_length(v_rec) >= 8;
      IF public.moth_can_read_target(v_row.v ->> 'k', (v_row.v ->> 'id')::uuid) THEN
        v_rec := v_rec || jsonb_build_array(jsonb_build_object('k', v_row.v ->> 'k', 'id', v_row.v ->> 'id'));
      END IF;
    END LOOP;
    v_out := v_out || jsonb_build_object('recent', v_rec);
  END IF;
  RETURN v_out;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_prefs() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_prefs() TO authenticated;

-- §4 Post-conditions ---------------------------------------------------------------
DO $$
DECLARE
  v_fn RECORD;
  v_t  TEXT;
BEGIN
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('public.fn_moth_views_pin()', '0349739ead25a724e85e6153e587a9ab'),
      ('public.fn_moth_views_cap()', 'ebf516313daa29c2cd11b7968501cd6c'),
      ('rabbit_private.moth_target_project(text,uuid)', '92d4ccab0e850e9fcf5b5bff0b669e23'),
      ('rabbit_private.moth_view_access(uuid)', '72f49b136935ac7ddc2741880bdfc639'),
      ('public.fn_moth_layout_positions_pin()', 'c59e26073d09892e318485d765da16a1'),
      ('public.moth_put_positions(uuid,jsonb)', 'f59d16206c43c1a57a07de799bb22246'),
      ('public.moth_clear_positions(uuid)', '7a348d2d44c7f5ebdbba48530d6ed6c9'),
      ('public.moth_view_positions(uuid)', 'ad15d4bee300230db7fc52d8dfa6c48a'),
      ('public.set_moth_prefs(jsonb)', '7898e7c598d844a3d28c130a7e933973'),
      ('public.moth_prefs()', 'fd458943dde1fc38acccf2f800590c6a')
    ) AS t(sig, now_is)
  LOOP
    IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = v_fn.sig::regprocedure) IS DISTINCT FROM v_fn.now_is THEN
      RAISE EXCEPTION '0123 post-condition: % is not this file''s body', v_fn.sig;
    END IF;
  END LOOP;

  FOR v_fn IN SELECT * FROM (VALUES
      ('public.moth_put_positions(uuid,jsonb)', true),
      ('public.moth_clear_positions(uuid)', true),
      ('public.moth_view_positions(uuid)', true),
      ('public.set_moth_prefs(jsonb)', true),
      ('public.moth_prefs()', true),
      ('public.fn_moth_views_pin()', false),
      ('public.fn_moth_views_cap()', false),
      ('public.fn_moth_layout_positions_pin()', false),
      ('rabbit_private.moth_target_project(text,uuid)', false),
      ('rabbit_private.moth_view_access(uuid)', false)
    ) AS t(sig, open)
  LOOP
    IF has_function_privilege('anon', v_fn.sig::regprocedure, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn.sig::regprocedure, 'EXECUTE') IS DISTINCT FROM v_fn.open THEN
      RAISE EXCEPTION '0123 post-condition: % has the wrong grants', v_fn.sig;
    END IF;
  END LOOP;

  FOREACH v_t IN ARRAY ARRAY['moth_views', 'moth_layout_positions'] LOOP
    IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = ('public.' || v_t)::regclass) THEN
      RAISE EXCEPTION '0123 post-condition: % does not force row security', v_t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = v_t AND (cmd = 'ALL' OR permissive <> 'PERMISSIVE')) THEN
      RAISE EXCEPTION '0123 post-condition: % has a FOR ALL or a restrictive policy', v_t;
    END IF;
    -- S6 (MOTH_DESIGN R3): every policy asks Moth's gate.
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = v_t
                AND COALESCE(qual, '') || COALESCE(with_check, '') !~ 'moth_can_(read|write)_target') THEN
      RAISE EXCEPTION '0123 post-condition: a policy of % does not ask Moth''s gate', v_t;
    END IF;
    IF has_table_privilege('anon', ('public.' || v_t)::regclass, 'SELECT')
       OR has_column_privilege('authenticated', ('public.' || v_t)::regclass, 'id', 'INSERT')
       OR has_column_privilege('authenticated', ('public.' || v_t)::regclass, 'workspace_id', 'INSERT')
       OR has_column_privilege('authenticated', ('public.' || v_t)::regclass, 'owner_id', 'INSERT')
       OR has_column_privilege('authenticated', ('public.' || v_t)::regclass, 'owner_id', 'UPDATE') THEN
      RAISE EXCEPTION '0123 post-condition: % lets a client choose what is the database''s to say', v_t;
    END IF;
    -- No channel: the house sends rows through broadcast triggers (0016), so no trigger on either table may be
    -- one, and no broadcast function may name either table.
    IF EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_proc pr ON pr.oid = tg.tgfoid
                WHERE tg.tgrelid = ('public.' || v_t)::regclass AND NOT tg.tgisinternal AND pr.proname ~ 'broadcast')
       OR EXISTS (SELECT 1 FROM pg_proc pr WHERE pr.pronamespace = 'public'::regnamespace AND pr.proname ~ 'broadcast'
                   AND position(v_t IN pr.prosrc) > 0)
       OR EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = v_t) THEN
      RAISE EXCEPTION '0123 post-condition: % is on a channel', v_t;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'moth_views') <> 4
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'moth_layout_positions') <> 1
     OR has_table_privilege('authenticated', 'public.moth_layout_positions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.moth_layout_positions', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.moth_layout_positions', 'DELETE') THEN
    RAISE EXCEPTION '0123 post-condition: the views'' four policies, or the places'' read-only one, are not as written';
  END IF;
  -- The tables' shape, by name: what a draft could have left out.
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.moth_views'::regclass AND conname IN
       ('moth_views_id_workspace_key', 'moth_views_scope_chk', 'moth_views_name_chk', 'moth_views_position_chk',
        'moth_views_config_chk', 'moth_views_config_no_ids_chk', 'moth_views_project_fk')) <> 7
     OR (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.moth_layout_positions'::regclass AND contype IN ('f', 'c')) <> 16
     OR (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.moth_layout_positions'::regclass AND attgenerated = 's') <> 10
     OR (SELECT count(*) FROM pg_index WHERE indrelid = 'public.moth_layout_positions'::regclass) <> 14
     -- The places' key to their view is the composite one: an id-only key would let a place's company differ.
     OR (SELECT array_agg(a.attname::text ORDER BY k.n) FROM pg_constraint c
           CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, n)
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
          WHERE c.conrelid = 'public.moth_layout_positions'::regclass AND c.conname = 'moth_layout_positions_view_fk')
        IS DISTINCT FROM ARRAY['view_id', 'workspace_id']
     OR (SELECT array_agg(a.attname::text ORDER BY k.n) FROM pg_constraint c
           CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, n)
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
          WHERE c.conrelid = 'public.moth_views'::regclass AND c.conname = 'moth_views_project_fk')
        IS DISTINCT FROM ARRAY['project_id', 'workspace_id'] THEN
    RAISE EXCEPTION '0123 post-condition: a table is not of this file''s shape';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.user_settings'::regclass AND conname = 'user_settings_moth_prefs_chk') THEN
    RAISE EXCEPTION '0123 post-condition: moth_prefs has no bound';
  END IF;

  RAISE NOTICE '0123 OK';
END $$;
