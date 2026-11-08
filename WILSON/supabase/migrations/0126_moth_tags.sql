-- =============================================================================
-- 0126_moth_tags.sql — M.O.T.H. Session 3 (MO3): typed tags, the company's and each person's.
-- (the brief §5; docs/sessions/PLAN_MOTH.md §4 and §5 Session 3; docs/design/MOTH_DESIGN.md §2.5 and §4.)
--
-- A typed catalogue BESIDE the nine file categories of 0085, which keep their meaning (the legal one guards Legal
-- files) and their tag dots. A typed tag says what something is: "Character: Mira", "Software: Blender 5.0".
--
-- WHAT THIS ADDS
-- --------------
--   §1  moth_tag_norm(text): the form two labels are compared in (trimmed, NFKC, one space between words, lower).
--   §2  moth_tag_types: a type's name, shape and colour. The company's are every active member's to read and its
--       live admins' to make, change and retire; a person's own are theirs alone, with no admin leg.
--   §3  moth_tags: a label of a type, the company's (live admins make, rename and retire them; none is deleted:
--       a company tag is retired or merged) or one person's (theirs alone; deleted by them). A company tag takes a
--       company type; a personal one a company type or its owner's own. One live tag a label, type, tier and owner.
--   §4  moth_tag_assignments: a tag on a thing. A company assignment (a company tag) is made and removed by those
--       who may change the thing, and seen by everyone who sees it. A personal assignment (the person's own tag,
--       or a company tag used privately) is that person's alone and needs only that they see the thing. So a
--       person's tags never travel with a thing they share.
--   §5  moth_tag_nominations: a person puts their own tag forward for the company, consenting to its label and its
--       type's name, nothing else (no thing it is on, no count). Only a live admin decides; a manager does not.
--   §6  moth_tag_nominate, moth_tag_nomination_withdraw, moth_tag_nomination_decide and moth_tag_merge. Approving
--       makes the company tag (and its type) or names the one that is there, then folds into it every personal
--       tag whose label and type's name are the same in moth_tag_norm's form, whoever's it is: each owner's
--       assignments are repointed and stay that owner's alone. An admin's merge of two company tags repoints
--       every assignment, so a rename or a merge shows everywhere at once.
--   §7  Moth's gate learns a typed tag ('mtag', from 0125's body), and places learn notes and typed tags: two
--       references and the kinds' CHECK on moth_layout_positions, and moth_put_positions (from 0124's body) lets a
--       project's view keep the places of a note or a tag, which belong to no project.
--
-- Nothing here goes on a realtime topic or into the takeout. One transaction, re-runnable, no enum. Suites
-- 127_moth_tag_types.sql, 128_moth_tags.sql, 129_moth_tag_assignments.sql and 130_moth_tag_nominations.sql
-- (new, each with its RLS_TABLES line); the gate's new kind in 113 and 124; the places' in 126.
-- =============================================================================

SET LOCAL lock_timeout = '15s';

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
DECLARE
  v_md5 TEXT;
  v_fn  RECORD;
BEGIN
  IF to_regprocedure('public.moth_notes()') IS NULL OR to_regprocedure('public.note_trash(uuid)') IS NULL THEN
    RAISE EXCEPTION '0126 refused: 0125 must be applied first';
  END IF;
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0126 refused: % does not bypass row security', current_user;
  END IF;
  -- The bodies this restates: the one each was built on, or this file's own on a second run.
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('public._moth_target_eligible(text,uuid,boolean)', '6e73a0aec4791103d0b78e13c0f74a71', 'd698cc503481bb497557ff247b3aab72'),
      ('public.moth_put_positions(uuid,jsonb)', '6c1b30fc636394581ba8398885113411', '3cfc69fd8cbf9383429ed143ec113443')
    ) AS t(sig, was, now_is)
  LOOP
    SELECT md5(replace(prosrc, chr(13), '')) INTO v_md5 FROM pg_proc WHERE oid = v_fn.sig::regprocedure;
    IF v_md5 IS DISTINCT FROM v_fn.was AND v_md5 IS DISTINCT FROM v_fn.now_is THEN
      RAISE EXCEPTION '0126 refused: % is not the body this file was built on (md5 %)', v_fn.sig, v_md5;
    END IF;
  END LOOP;
  -- A function of this file's name already here must be this file's own.
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('public.moth_tag_norm(text)', '3e54bf488d3a981a9fbc550e2e3135b5'),
      ('public.fn_moth_tag_types_pin()', '2d2083c7564cf81ac8c53435b4ed0cfa'),
      ('public.fn_moth_tags_pin()', 'aa2f17f5cf2b805ef5a517fffd33bb1a'),
      ('public.fn_moth_tag_assignments_pin()', 'd5bcf6052c73b84fefb530dc6df8d506'),
      ('rabbit_private.moth_tag_fold(uuid,uuid,uuid)', '2220e13f3135be04110fcba52d3fb394'),
      ('public.moth_tag_nominate(uuid,text)', 'da91fca89f14e7326ca1a55fbdecdc1b'),
      ('public.moth_tag_nomination_withdraw(uuid)', '8cb0f57feda72f7959df5ee385da5ea2'),
      ('public.moth_tag_nomination_decide(uuid,boolean,text)', 'ccbe71185e656b1711f7438ec631a3ec'),
      ('public.moth_tag_merge(uuid,uuid)', '88b59ac16d77f21870115fdf956e3749')
    ) AS t(sig, now_is)
  LOOP
    IF to_regprocedure(v_fn.sig) IS NOT NULL
       AND (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure(v_fn.sig)) IS DISTINCT FROM v_fn.now_is THEN
      RAISE EXCEPTION '0126 refused: % is here and is not this file''s', v_fn.sig;
    END IF;
  END LOOP;
  -- A table of this file's already here must be this file's whole (CREATE TABLE IF NOT EXISTS would pass a draft's).
  IF to_regclass('public.moth_tag_types') IS NOT NULL
     AND (SELECT count(*) FROM pg_constraint WHERE conrelid = to_regclass('public.moth_tag_types') AND contype IN ('c', 'f', 'u', 'p')) <> 8 THEN
    RAISE EXCEPTION '0126 refused: a moth_tag_types table is here that is not this file''s';
  END IF;
  IF to_regclass('public.moth_tags') IS NOT NULL
     AND (SELECT count(*) FROM pg_constraint WHERE conrelid = to_regclass('public.moth_tags') AND contype IN ('c', 'f', 'u', 'p')) <> 9 THEN
    RAISE EXCEPTION '0126 refused: a moth_tags table is here that is not this file''s';
  END IF;
  IF to_regclass('public.moth_tag_assignments') IS NOT NULL
     AND (SELECT count(*) FROM pg_constraint WHERE conrelid = to_regclass('public.moth_tag_assignments') AND contype IN ('c', 'f', 'u', 'p')) <> 17 THEN
    RAISE EXCEPTION '0126 refused: a moth_tag_assignments table is here that is not this file''s';
  END IF;
  IF to_regclass('public.moth_tag_nominations') IS NOT NULL
     AND (SELECT count(*) FROM pg_constraint WHERE conrelid = to_regclass('public.moth_tag_nominations') AND contype IN ('c', 'f', 'u', 'p')) <> 11 THEN
    RAISE EXCEPTION '0126 refused: a moth_tag_nominations table is here that is not this file''s';
  END IF;
  -- The places' table is 0123's, with or without this file's two references.
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.moth_layout_positions'::regclass AND contype IN ('f', 'c')) NOT IN (16, 18) THEN
    RAISE EXCEPTION '0126 refused: moth_layout_positions is not 0123''s';
  END IF;
END $$;

-- §1 The form two labels are compared in ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.moth_tag_norm(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT btrim(lower(regexp_replace(normalize(p, NFKC), '[[:space:]]+', ' ', 'g')))
$$;
REVOKE ALL ON FUNCTION public.moth_tag_norm(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moth_tag_norm(text) TO authenticated, service_role;

-- §2 Types ------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.moth_tag_types (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL DEFAULT public.current_workspace_id() REFERENCES public.workspaces(id) ON DELETE CASCADE,
  tier          TEXT NOT NULL DEFAULT 'personal',
  owner_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  norm          TEXT GENERATED ALWAYS AS (public.moth_tag_norm(name)) STORED,
  shape         TEXT NOT NULL DEFAULT 'circle',
  colour        TEXT NOT NULL DEFAULT 'mist',
  retired_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID,

  CONSTRAINT moth_tag_types_id_workspace_key UNIQUE (id, workspace_id),
  CONSTRAINT moth_tag_types_tier_chk CHECK (
    (tier = 'company' AND owner_id IS NULL) OR (tier = 'personal' AND owner_id IS NOT NULL)),
  CONSTRAINT moth_tag_types_name_chk
    CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 60 AND name !~ '[[:cntrl:]]'),
  CONSTRAINT moth_tag_types_shape_chk CHECK (shape IN ('circle', 'square', 'diamond', 'triangle', 'hexagon', 'star')),
  CONSTRAINT moth_tag_types_colour_chk CHECK (colour IN ('mist', 'amber', 'rose', 'violet', 'sky', 'teal', 'lime', 'sand'))
);
CREATE UNIQUE INDEX IF NOT EXISTS moth_tag_types_norm_key
  ON public.moth_tag_types (workspace_id, tier, owner_id, norm) NULLS NOT DISTINCT WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS moth_tag_types_owner_idx ON public.moth_tag_types (owner_id) WHERE owner_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_moth_tag_types_pin()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_me UUID := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Whose a type is the database says: the caller's company, and the caller for a personal one.
    IF v_me IS NOT NULL THEN
      NEW.workspace_id := public.current_workspace_id();
      NEW.owner_id     := CASE WHEN NEW.tier = 'personal' THEN v_me END;
      NEW.created_by   := v_me;
      NEW.updated_by   := v_me;
      NEW.created_at   := now();
      NEW.updated_at   := now();
    END IF;
    RETURN NEW;
  END IF;
  NEW.id           := OLD.id;
  NEW.workspace_id := OLD.workspace_id;
  NEW.tier         := OLD.tier;
  NEW.owner_id     := OLD.owner_id;
  NEW.created_at   := OLD.created_at;
  NEW.created_by   := OLD.created_by;
  NEW.updated_at   := now();
  NEW.updated_by   := COALESCE(v_me, OLD.updated_by);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_moth_tag_types_pin() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_moth_tag_types_pin ON public.moth_tag_types;
CREATE TRIGGER trg_moth_tag_types_pin BEFORE INSERT OR UPDATE ON public.moth_tag_types
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_tag_types_pin();

ALTER TABLE public.moth_tag_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moth_tag_types FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS moth_tag_types_select ON public.moth_tag_types;
DROP POLICY IF EXISTS moth_tag_types_insert ON public.moth_tag_types;
DROP POLICY IF EXISTS moth_tag_types_update ON public.moth_tag_types;
DROP POLICY IF EXISTS moth_tag_types_delete ON public.moth_tag_types;
-- A company type is every active member's to read; a person's own is theirs alone (no admin leg).
CREATE POLICY moth_tag_types_select ON public.moth_tag_types
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (tier = 'company' OR owner_id = auth.uid())
  );
CREATE POLICY moth_tag_types_insert ON public.moth_tag_types
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND ((tier = 'company' AND public.is_live_workspace_admin(workspace_id)) OR (tier = 'personal' AND owner_id = auth.uid()))
  );
CREATE POLICY moth_tag_types_update ON public.moth_tag_types
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND ((tier = 'company' AND public.is_live_workspace_admin(workspace_id)) OR (tier = 'personal' AND owner_id = auth.uid()))
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND ((tier = 'company' AND public.is_live_workspace_admin(workspace_id)) OR (tier = 'personal' AND owner_id = auth.uid()))
  );
-- A company type is retired, never deleted: someone's own tag may be of it, and a refused delete would say so.
CREATE POLICY moth_tag_types_delete ON public.moth_tag_types
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND tier = 'personal' AND owner_id = auth.uid()
  );
REVOKE ALL ON public.moth_tag_types FROM PUBLIC, anon;
REVOKE ALL ON public.moth_tag_types FROM authenticated;
GRANT SELECT, DELETE ON public.moth_tag_types TO authenticated;
GRANT INSERT (tier, name, shape, colour) ON public.moth_tag_types TO authenticated;
GRANT UPDATE (name, shape, colour, retired_at) ON public.moth_tag_types TO authenticated;
GRANT ALL ON public.moth_tag_types TO service_role;

-- §3 Tags -------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.moth_tags (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL DEFAULT public.current_workspace_id() REFERENCES public.workspaces(id) ON DELETE CASCADE,
  type_id       UUID NOT NULL,
  tier          TEXT NOT NULL DEFAULT 'personal',
  owner_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  norm          TEXT GENERATED ALWAYS AS (public.moth_tag_norm(label)) STORED,
  canonical_id  UUID,
  retired_at    TIMESTAMPTZ,
  revision      BIGINT NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID,

  CONSTRAINT moth_tags_id_workspace_key UNIQUE (id, workspace_id),
  CONSTRAINT moth_tags_type_fk FOREIGN KEY (type_id, workspace_id) REFERENCES public.moth_tag_types (id, workspace_id),
  CONSTRAINT moth_tags_canonical_fk FOREIGN KEY (canonical_id, workspace_id)
    REFERENCES public.moth_tags (id, workspace_id) ON DELETE SET NULL (canonical_id),
  CONSTRAINT moth_tags_tier_chk CHECK (
    (tier = 'company' AND owner_id IS NULL) OR (tier = 'personal' AND owner_id IS NOT NULL)),
  CONSTRAINT moth_tags_label_chk
    CHECK (label = btrim(label) AND char_length(label) BETWEEN 1 AND 80 AND label !~ '[[:cntrl:]]'),
  CONSTRAINT moth_tags_canonical_chk CHECK (canonical_id IS NULL OR canonical_id <> id)
);
CREATE UNIQUE INDEX IF NOT EXISTS moth_tags_norm_key
  ON public.moth_tags (workspace_id, type_id, tier, owner_id, norm) NULLS NOT DISTINCT
  WHERE canonical_id IS NULL AND retired_at IS NULL;
CREATE INDEX IF NOT EXISTS moth_tags_type_idx ON public.moth_tags (type_id);
CREATE INDEX IF NOT EXISTS moth_tags_owner_idx ON public.moth_tags (owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_tags_fold_idx ON public.moth_tags (workspace_id, norm) WHERE canonical_id IS NULL;
CREATE INDEX IF NOT EXISTS moth_tags_canonical_idx ON public.moth_tags (canonical_id) WHERE canonical_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_moth_tags_pin()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_me   UUID := auth.uid();
  v_fold BOOLEAN := COALESCE(current_setting('wilson.moth_tag_fold', true), '') = 'on';
  v_ok   BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_me IS NOT NULL THEN
      NEW.workspace_id := public.current_workspace_id();
      NEW.owner_id     := CASE WHEN NEW.tier = 'personal' THEN v_me END;
      NEW.created_by   := v_me;
      NEW.updated_by   := v_me;
      NEW.created_at   := now();
      NEW.updated_at   := now();
    END IF;
    NEW.revision := 1;
    IF NOT v_fold THEN
      NEW.canonical_id := NULL;
    END IF;
  ELSE
    NEW.id           := OLD.id;
    NEW.workspace_id := OLD.workspace_id;
    NEW.tier         := OLD.tier;
    NEW.owner_id     := OLD.owner_id;
    NEW.created_at   := OLD.created_at;
    NEW.created_by   := OLD.created_by;
    NEW.updated_at   := now();
    NEW.updated_by   := COALESCE(v_me, OLD.updated_by);
    -- Which tag one stands for now is the fold's and the merge's to say (rabbit_private.moth_tag_fold), no one else's.
    IF NOT v_fold THEN
      NEW.canonical_id := OLD.canonical_id;
    END IF;
    NEW.revision := CASE WHEN NEW.label IS DISTINCT FROM OLD.label OR NEW.type_id IS DISTINCT FROM OLD.type_id
                         THEN OLD.revision + 1 ELSE OLD.revision END;
  END IF;
  -- A company tag takes a company type, and a personal one a company type or its owner's own, live either way. A
  -- type the writer may not use is refused in the words of one that is not there, so a refusal tells no one that
  -- someone else's type exists (SEC-11).
  IF TG_OP = 'INSERT' OR NEW.type_id IS DISTINCT FROM OLD.type_id THEN
    SELECT true INTO v_ok
      FROM public.moth_tag_types ty
     WHERE ty.id = NEW.type_id AND ty.workspace_id = NEW.workspace_id AND ty.retired_at IS NULL
       AND (ty.tier = 'company' OR (NEW.tier = 'personal' AND ty.owner_id = NEW.owner_id));
    IF v_ok IS NULL THEN
      RAISE EXCEPTION 'insert or update on table "moth_tags" violates foreign key constraint "moth_tags_type_fk"' USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_moth_tags_pin() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_moth_tags_pin ON public.moth_tags;
CREATE TRIGGER trg_moth_tags_pin BEFORE INSERT OR UPDATE ON public.moth_tags
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_tags_pin();

ALTER TABLE public.moth_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moth_tags FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS moth_tags_select ON public.moth_tags;
DROP POLICY IF EXISTS moth_tags_insert ON public.moth_tags;
DROP POLICY IF EXISTS moth_tags_update ON public.moth_tags;
DROP POLICY IF EXISTS moth_tags_delete ON public.moth_tags;
CREATE POLICY moth_tags_select ON public.moth_tags
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (tier = 'company' OR owner_id = auth.uid())
  );
CREATE POLICY moth_tags_insert ON public.moth_tags
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND ((tier = 'company' AND public.is_live_workspace_admin(workspace_id)) OR (tier = 'personal' AND owner_id = auth.uid()))
  );
CREATE POLICY moth_tags_update ON public.moth_tags
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND ((tier = 'company' AND public.is_live_workspace_admin(workspace_id)) OR (tier = 'personal' AND owner_id = auth.uid()))
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND ((tier = 'company' AND public.is_live_workspace_admin(workspace_id)) OR (tier = 'personal' AND owner_id = auth.uid()))
  );
-- A company tag is retired or merged, never deleted (its assignments are everyone's); a person deletes their own.
CREATE POLICY moth_tags_delete ON public.moth_tags
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND tier = 'personal' AND owner_id = auth.uid()
  );
REVOKE ALL ON public.moth_tags FROM PUBLIC, anon;
REVOKE ALL ON public.moth_tags FROM authenticated;
GRANT SELECT, DELETE ON public.moth_tags TO authenticated;
GRANT INSERT (type_id, tier, label) ON public.moth_tags TO authenticated;
GRANT UPDATE (type_id, label, retired_at) ON public.moth_tags TO authenticated;
GRANT ALL ON public.moth_tags TO service_role;

-- §4 Assignments ------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.moth_tag_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL DEFAULT public.current_workspace_id(),
  tag_id          UUID NOT NULL,
  tier            TEXT NOT NULL DEFAULT 'company',
  owner_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  target_type     TEXT NOT NULL,
  target_id       UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID,
  -- One typed reference per kind, id-only as moth_layout_positions' are, so an assignment goes with its thing.
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
  note_ref        UUID GENERATED ALWAYS AS (CASE WHEN target_type = 'note' THEN target_id END) STORED,

  CONSTRAINT moth_tag_assignments_workspace_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT moth_tag_assignments_tag_fk FOREIGN KEY (tag_id, workspace_id) REFERENCES public.moth_tags (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT moth_tag_assignments_project_ref_fk FOREIGN KEY (project_ref) REFERENCES public.projects (id) ON DELETE CASCADE,
  CONSTRAINT moth_tag_assignments_folder_ref_fk FOREIGN KEY (folder_ref) REFERENCES public.folders (id) ON DELETE CASCADE,
  CONSTRAINT moth_tag_assignments_file_ref_fk FOREIGN KEY (file_ref) REFERENCES public.files (id) ON DELETE CASCADE,
  CONSTRAINT moth_tag_assignments_phase_ref_fk FOREIGN KEY (phase_ref) REFERENCES public.phases (id) ON DELETE CASCADE,
  CONSTRAINT moth_tag_assignments_asset_ref_fk FOREIGN KEY (asset_ref) REFERENCES public.assets (id) ON DELETE CASCADE,
  CONSTRAINT moth_tag_assignments_task_ref_fk FOREIGN KEY (task_ref) REFERENCES public.tasks (id) ON DELETE CASCADE,
  CONSTRAINT moth_tag_assignments_scene_ref_fk FOREIGN KEY (scene_ref) REFERENCES public.scenes (id) ON DELETE CASCADE,
  CONSTRAINT moth_tag_assignments_shot_ref_fk FOREIGN KEY (shot_ref) REFERENCES public.shots (id) ON DELETE CASCADE,
  CONSTRAINT moth_tag_assignments_level_ref_fk FOREIGN KEY (level_ref) REFERENCES public.levels (id) ON DELETE CASCADE,
  CONSTRAINT moth_tag_assignments_experience_ref_fk FOREIGN KEY (experience_ref) REFERENCES public.experiences (id) ON DELETE CASCADE,
  CONSTRAINT moth_tag_assignments_note_ref_fk FOREIGN KEY (note_ref) REFERENCES public.notes (id) ON DELETE CASCADE,
  CONSTRAINT moth_tag_assignments_tier_chk CHECK (
    (tier = 'company' AND owner_id IS NULL) OR (tier = 'personal' AND owner_id IS NOT NULL)),
  CONSTRAINT moth_tag_assignments_type_chk CHECK (target_type IN
    ('project', 'folder', 'file', 'phase', 'asset', 'task', 'scene', 'shot', 'level', 'experience', 'note'))
);
CREATE UNIQUE INDEX IF NOT EXISTS moth_tag_assignments_key
  ON public.moth_tag_assignments (tag_id, target_type, target_id, owner_id) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS moth_tag_assignments_target_idx ON public.moth_tag_assignments (workspace_id, target_type, target_id);
CREATE INDEX IF NOT EXISTS moth_tag_assignments_owner_idx ON public.moth_tag_assignments (owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_tag_assignments_project_ref_idx ON public.moth_tag_assignments (project_ref) WHERE project_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_tag_assignments_folder_ref_idx ON public.moth_tag_assignments (folder_ref) WHERE folder_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_tag_assignments_file_ref_idx ON public.moth_tag_assignments (file_ref) WHERE file_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_tag_assignments_phase_ref_idx ON public.moth_tag_assignments (phase_ref) WHERE phase_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_tag_assignments_asset_ref_idx ON public.moth_tag_assignments (asset_ref) WHERE asset_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_tag_assignments_task_ref_idx ON public.moth_tag_assignments (task_ref) WHERE task_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_tag_assignments_scene_ref_idx ON public.moth_tag_assignments (scene_ref) WHERE scene_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_tag_assignments_shot_ref_idx ON public.moth_tag_assignments (shot_ref) WHERE shot_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_tag_assignments_level_ref_idx ON public.moth_tag_assignments (level_ref) WHERE level_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_tag_assignments_experience_ref_idx ON public.moth_tag_assignments (experience_ref) WHERE experience_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_tag_assignments_note_ref_idx ON public.moth_tag_assignments (note_ref) WHERE note_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_moth_tag_assignments_pin()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_me   UUID := auth.uid();
  v_fold BOOLEAN := COALESCE(current_setting('wilson.moth_tag_fold', true), '') = 'on';
  v_ok   BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Only the fold and the merge move an assignment, and only to another tag; a client holds no UPDATE at all.
    IF NOT v_fold THEN
      RAISE EXCEPTION 'An assignment is removed and made again, never changed.' USING ERRCODE = '42501';
    END IF;
    NEW.id          := OLD.id;
    NEW.workspace_id := OLD.workspace_id;
    NEW.tier        := OLD.tier;
    NEW.owner_id    := OLD.owner_id;
    NEW.target_type := OLD.target_type;
    NEW.target_id   := OLD.target_id;
    NEW.created_at  := OLD.created_at;
    NEW.created_by  := OLD.created_by;
    RETURN NEW;
  END IF;
  IF v_me IS NOT NULL THEN
    NEW.workspace_id := public.current_workspace_id();
    NEW.owner_id     := CASE WHEN NEW.tier = 'personal' THEN v_me END;
    NEW.created_by   := v_me;
    NEW.created_at   := now();
  END IF;
  -- The tag as the writer sees it, live, and of the assignment's tier: a company assignment takes a company tag, a
  -- personal one the writer's own or a company tag. Any other, there or not, in the words of a missing one.
  SELECT true INTO v_ok
    FROM public.moth_tags t
   WHERE t.id = NEW.tag_id AND t.workspace_id = NEW.workspace_id AND t.canonical_id IS NULL AND t.retired_at IS NULL
     AND (t.tier = 'company' OR (NEW.tier = 'personal' AND t.owner_id = NEW.owner_id));
  IF v_ok IS NULL THEN
    RAISE EXCEPTION 'insert or update on table "moth_tag_assignments" violates foreign key constraint "moth_tag_assignments_tag_fk"' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_moth_tag_assignments_pin() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_moth_tag_assignments_pin ON public.moth_tag_assignments;
CREATE TRIGGER trg_moth_tag_assignments_pin BEFORE INSERT OR UPDATE ON public.moth_tag_assignments
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_tag_assignments_pin();

ALTER TABLE public.moth_tag_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moth_tag_assignments FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS moth_tag_assignments_select ON public.moth_tag_assignments;
DROP POLICY IF EXISTS moth_tag_assignments_insert ON public.moth_tag_assignments;
DROP POLICY IF EXISTS moth_tag_assignments_delete ON public.moth_tag_assignments;
-- Seen by whoever sees both the thing (Moth's gate, live) and the tag (its own policy); a personal one only by its
-- owner. Made, for the company, by those who may change the thing; privately, by anyone who sees it.
CREATE POLICY moth_tag_assignments_select ON public.moth_tag_assignments
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (tier = 'company' OR owner_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.moth_tags t
                 WHERE t.id = moth_tag_assignments.tag_id AND t.workspace_id = moth_tag_assignments.workspace_id)
    AND public.moth_can_read_target(target_type, target_id)
  );
CREATE POLICY moth_tag_assignments_insert ON public.moth_tag_assignments
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND ((tier = 'company' AND owner_id IS NULL AND public.moth_can_write_target(target_type, target_id))
         OR (tier = 'personal' AND owner_id = auth.uid() AND public.moth_can_read_target(target_type, target_id)))
  );
CREATE POLICY moth_tag_assignments_delete ON public.moth_tag_assignments
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND ((tier = 'company' AND public.moth_can_write_target(target_type, target_id))
         OR (tier = 'personal' AND owner_id = auth.uid()))
  );
REVOKE ALL ON public.moth_tag_assignments FROM PUBLIC, anon;
REVOKE ALL ON public.moth_tag_assignments FROM authenticated;
GRANT SELECT, DELETE ON public.moth_tag_assignments TO authenticated;
GRANT INSERT (tag_id, tier, target_type, target_id) ON public.moth_tag_assignments TO authenticated;
GRANT ALL ON public.moth_tag_assignments TO service_role;

-- §5 Nominations -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.moth_tag_nominations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  proposer_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tag_id         UUID,
  label          TEXT NOT NULL,
  type_name      TEXT NOT NULL,
  note           TEXT,
  status         TEXT NOT NULL DEFAULT 'open',
  review_note    TEXT,
  decided_by     UUID,
  decided_at     TIMESTAMPTZ,
  result_tag_id  UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT moth_tag_nominations_tag_fk FOREIGN KEY (tag_id, workspace_id)
    REFERENCES public.moth_tags (id, workspace_id) ON DELETE SET NULL (tag_id),
  CONSTRAINT moth_tag_nominations_result_fk FOREIGN KEY (result_tag_id, workspace_id)
    REFERENCES public.moth_tags (id, workspace_id) ON DELETE SET NULL (result_tag_id),
  CONSTRAINT moth_tag_nominations_status_chk CHECK (status IN ('open', 'approved', 'rejected', 'withdrawn')),
  CONSTRAINT moth_tag_nominations_label_chk CHECK (label = btrim(label) AND char_length(label) BETWEEN 1 AND 80),
  CONSTRAINT moth_tag_nominations_type_chk CHECK (type_name = btrim(type_name) AND char_length(type_name) BETWEEN 1 AND 60),
  CONSTRAINT moth_tag_nominations_note_chk CHECK (note IS NULL OR char_length(note) <= 1000),
  CONSTRAINT moth_tag_nominations_review_chk CHECK (review_note IS NULL OR char_length(review_note) <= 1000),
  CONSTRAINT moth_tag_nominations_decided_chk CHECK ((status IN ('approved', 'rejected')) = (decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS moth_tag_nominations_open_key ON public.moth_tag_nominations (tag_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS moth_tag_nominations_queue_idx ON public.moth_tag_nominations (workspace_id, status, created_at);
CREATE INDEX IF NOT EXISTS moth_tag_nominations_proposer_idx ON public.moth_tag_nominations (proposer_id);

ALTER TABLE public.moth_tag_nominations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moth_tag_nominations FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS moth_tag_nominations_select ON public.moth_tag_nominations;
-- The proposer's own, and every one to the company's live admins, who decide. No client writes a row: §6 does.
CREATE POLICY moth_tag_nominations_select ON public.moth_tag_nominations
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (proposer_id = auth.uid() OR public.is_live_workspace_admin(workspace_id))
  );
REVOKE ALL ON public.moth_tag_nominations FROM PUBLIC, anon;
REVOKE ALL ON public.moth_tag_nominations FROM authenticated;
GRANT SELECT ON public.moth_tag_nominations TO authenticated;
GRANT ALL ON public.moth_tag_nominations TO service_role;

-- §6 Putting a tag forward, deciding, and merging --------------------------------------------------------
CREATE OR REPLACE FUNCTION rabbit_private.moth_tag_fold(p_ws uuid, p_into uuid, p_from uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('wilson.moth_tag_fold', 'on', true);
  -- The assignments: one the tag it folds into already has, on the same thing for the same owner, goes; every other
  -- moves, its tier and owner kept, so a person's private tagging stays theirs.
  DELETE FROM public.moth_tag_assignments a
   WHERE a.tag_id = p_from AND a.workspace_id = p_ws
     AND EXISTS (SELECT 1 FROM public.moth_tag_assignments b
                  WHERE b.tag_id = p_into AND b.target_type = a.target_type AND b.target_id = a.target_id
                    AND b.owner_id IS NOT DISTINCT FROM a.owner_id);
  UPDATE public.moth_tag_assignments SET tag_id = p_into WHERE tag_id = p_from AND workspace_id = p_ws;
  -- A place of the folded tag's dot becomes the other's, where that view and owner have none of it yet.
  INSERT INTO public.moth_layout_positions (view_id, workspace_id, target_type, target_id, owner_id, x, y, pinned, is_open, is_focus)
  SELECT pl.view_id, pl.workspace_id, 'mtag', p_into, pl.owner_id, pl.x, pl.y, pl.pinned, pl.is_open, false
    FROM public.moth_layout_positions pl
   WHERE pl.target_type = 'mtag' AND pl.target_id = p_from AND pl.workspace_id = p_ws
     AND NOT EXISTS (SELECT 1 FROM public.moth_layout_positions q
                      WHERE q.view_id = pl.view_id AND q.target_type = 'mtag' AND q.target_id = p_into
                        AND q.owner_id IS NOT DISTINCT FROM pl.owner_id);
  DELETE FROM public.moth_layout_positions WHERE target_type = 'mtag' AND target_id = p_from AND workspace_id = p_ws;
  -- It stands for the other now, and so does anything folded into it before.
  UPDATE public.moth_tags SET canonical_id = p_into WHERE id = p_from AND workspace_id = p_ws;
  UPDATE public.moth_tags SET canonical_id = p_into WHERE canonical_id = p_from AND workspace_id = p_ws;
  PERFORM set_config('wilson.moth_tag_fold', '', true);
END;
$$;
REVOKE ALL ON FUNCTION rabbit_private.moth_tag_fold(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.moth_tag_nominate(p_tag uuid, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws    UUID := public.current_workspace_id();
  v_label TEXT;
  v_type  TEXT;
  v_id    UUID;
BEGIN
  SELECT t.label, ty.name INTO v_label, v_type
    FROM public.moth_tags t
    JOIN public.moth_tag_types ty ON ty.id = t.type_id
   WHERE t.id = p_tag AND t.workspace_id = v_ws AND t.tier = 'personal' AND t.owner_id = auth.uid()
     AND t.canonical_id IS NULL AND t.retired_at IS NULL;
  -- One refusal for every case: not there, not the caller's own, folded or retired, or no active membership.
  IF v_label IS NULL OR auth.uid() IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RAISE EXCEPTION 'That tag is not one you can put forward.' USING ERRCODE = '42501';
  END IF;
  IF p_note IS NOT NULL AND char_length(p_note) > 1000 THEN
    RAISE EXCEPTION 'A note to the admins is 1,000 characters at most.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.moth_tag_nominations n WHERE n.tag_id = p_tag AND n.status = 'open') THEN
    RAISE EXCEPTION 'That tag is put forward already.' USING ERRCODE = '23505';
  END IF;
  -- The proposer consents to these two words and their note, and to nothing else: no thing the tag is on, no count.
  INSERT INTO public.moth_tag_nominations (workspace_id, proposer_id, tag_id, label, type_name, note)
  VALUES (v_ws, auth.uid(), p_tag, v_label, v_type, NULLIF(btrim(p_note), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_tag_nominate(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_tag_nominate(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.moth_tag_nomination_withdraw(p_nomination uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.moth_tag_nominations
     SET status = 'withdrawn', updated_at = now()
   WHERE id = p_nomination AND workspace_id = public.current_workspace_id()
     AND proposer_id = auth.uid() AND status = 'open'
     AND public.has_active_membership(workspace_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That is not an open nomination of yours.' USING ERRCODE = '42501';
  END IF;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_tag_nomination_withdraw(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_tag_nomination_withdraw(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.moth_tag_nomination_decide(p_nomination uuid, p_approve boolean, p_review_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws     UUID := public.current_workspace_id();
  n        RECORD;
  v_type   UUID;
  v_tag    UUID;
  v_shape  TEXT;
  v_colour TEXT;
  v_from   RECORD;
BEGIN
  -- Only a live admin decides: never a manager, and never the token's word alone (is_live_workspace_admin reads the
  -- membership row).
  IF v_ws IS NULL OR NOT public.is_live_workspace_admin(v_ws) THEN
    RAISE EXCEPTION 'Only a workspace admin decides what becomes a company tag.' USING ERRCODE = '42501';
  END IF;
  IF p_approve IS NULL OR (p_review_note IS NOT NULL AND char_length(p_review_note) > 1000) THEN
    RAISE EXCEPTION 'A decision is a yes or a no, with a note of 1,000 characters at most.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO n FROM public.moth_tag_nominations
   WHERE id = p_nomination AND workspace_id = v_ws AND status = 'open'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That nomination is not open.' USING ERRCODE = '42501';
  END IF;
  IF NOT p_approve THEN
    UPDATE public.moth_tag_nominations
       SET status = 'rejected', review_note = NULLIF(btrim(p_review_note), ''), decided_by = auth.uid(),
           decided_at = now(), updated_at = now()
     WHERE id = n.id;
    RETURN NULL;
  END IF;
  -- One fold at a time for a word in this company.
  PERFORM pg_advisory_xact_lock(hashtextextended('moth_tag_fold:' || v_ws::text || ':' || public.moth_tag_norm(n.label), 0));
  -- The company's type of that name, or a new one in the shape and colour of the proposer's, where it is still there.
  SELECT ty.id INTO v_type
    FROM public.moth_tag_types ty
   WHERE ty.workspace_id = v_ws AND ty.tier = 'company' AND ty.norm = public.moth_tag_norm(n.type_name) AND ty.retired_at IS NULL;
  IF v_type IS NULL THEN
    SELECT ty.shape, ty.colour INTO v_shape, v_colour
      FROM public.moth_tags t JOIN public.moth_tag_types ty ON ty.id = t.type_id
     WHERE t.id = n.tag_id;
    INSERT INTO public.moth_tag_types (workspace_id, tier, name, shape, colour)
    VALUES (v_ws, 'company', n.type_name, COALESCE(v_shape, 'circle'), COALESCE(v_colour, 'mist'))
    RETURNING id INTO v_type;
  END IF;
  -- The company's tag of that label and type, or a new one.
  SELECT t.id INTO v_tag
    FROM public.moth_tags t
   WHERE t.workspace_id = v_ws AND t.tier = 'company' AND t.type_id = v_type AND t.norm = public.moth_tag_norm(n.label)
     AND t.canonical_id IS NULL AND t.retired_at IS NULL;
  IF v_tag IS NULL THEN
    INSERT INTO public.moth_tags (workspace_id, type_id, tier, label) VALUES (v_ws, v_type, 'company', n.label)
    RETURNING id INTO v_tag;
  END IF;
  -- Every person's own tag of the same label, of a type of the same name, folds into it: exact matches in
  -- moth_tag_norm's form only, never a guess. Each owner's assignments stay that owner's alone, and nothing of
  -- them is returned to the admin.
  FOR v_from IN
    SELECT t.id
      FROM public.moth_tags t
      JOIN public.moth_tag_types ty ON ty.id = t.type_id
     WHERE t.workspace_id = v_ws AND t.tier = 'personal' AND t.canonical_id IS NULL
       AND t.norm = public.moth_tag_norm(n.label) AND ty.norm = public.moth_tag_norm(n.type_name)
  LOOP
    PERFORM rabbit_private.moth_tag_fold(v_ws, v_tag, v_from.id);
  END LOOP;
  -- This nomination is approved into it, and so is any other open one whose tag has just been folded.
  UPDATE public.moth_tag_nominations
     SET status = 'approved', result_tag_id = v_tag, decided_by = auth.uid(), decided_at = now(), updated_at = now(),
         review_note = CASE WHEN id = n.id THEN NULLIF(btrim(p_review_note), '') ELSE review_note END
   WHERE workspace_id = v_ws AND status = 'open'
     AND (id = n.id OR tag_id IN (SELECT t.id FROM public.moth_tags t WHERE t.canonical_id = v_tag AND t.workspace_id = v_ws));
  RETURN v_tag;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_tag_nomination_decide(uuid, boolean, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_tag_nomination_decide(uuid, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.moth_tag_merge(p_from uuid, p_into uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws UUID := public.current_workspace_id();
BEGIN
  IF v_ws IS NULL OR NOT public.is_live_workspace_admin(v_ws) THEN
    RAISE EXCEPTION 'Only a workspace admin merges company tags.' USING ERRCODE = '42501';
  END IF;
  -- Two merges of one tag at once wait for each other.
  PERFORM 1 FROM public.moth_tags t WHERE t.id IN (p_from, p_into) AND t.workspace_id = v_ws ORDER BY t.id FOR UPDATE;
  IF p_from IS NULL OR p_into IS NULL OR p_from = p_into
     OR (SELECT count(*) FROM public.moth_tags t
          WHERE t.id IN (p_from, p_into) AND t.workspace_id = v_ws AND t.tier = 'company' AND t.canonical_id IS NULL) <> 2
     OR EXISTS (SELECT 1 FROM public.moth_tags t WHERE t.id = p_into AND t.retired_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Two different company tags of this company merge, into one still in use.' USING ERRCODE = '22023';
  END IF;
  PERFORM rabbit_private.moth_tag_fold(v_ws, p_into, p_from);
  UPDATE public.moth_tag_nominations SET result_tag_id = p_into, updated_at = now()
   WHERE result_tag_id = p_from AND workspace_id = v_ws;
  RETURN p_into;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_tag_merge(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_tag_merge(uuid, uuid) TO authenticated;

-- §7 Moth's gate learns a typed tag, and places learn notes and typed tags -----------------------------------
-- Restated from 0125's body. Only the typed tag's arm is new.
CREATE OR REPLACE FUNCTION public._moth_target_eligible(p_kind text, p_id uuid, p_allow_trashed boolean)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws       UUID := public.current_workspace_id();
  v_project  UUID;
  v_deleted  TIMESTAMPTZ;
  v_flag     BOOLEAN;
  v_path     TEXT;
  v_tags     TEXT[];
  v_folder   UUID;
  v_aside    TIMESTAMPTZ;
  v_tier     TEXT;
  v_owner    UUID;
BEGIN
  IF p_id IS NULL OR auth.uid() IS NULL OR v_ws IS NULL OR NOT public.has_active_membership(v_ws) THEN
    RETURN false;
  END IF;

  IF p_kind = 'project' THEN
    v_project := p_id;
  ELSIF p_kind = 'folder' THEN
    SELECT fo.project_id INTO v_project
      FROM public.folders fo
     WHERE fo.id = p_id AND fo.workspace_id = v_ws;
    IF v_project IS NULL OR public.moth_folder_chain_locked(v_ws, p_id) THEN
      RETURN false;
    END IF;
  ELSIF p_kind = 'file' THEN
    SELECT f.project_id, f.deleted_at, f.is_financial, f.storage_path, f.tags, f.folder_id
      INTO v_project, v_deleted, v_flag, v_path, v_tags, v_folder
      FROM public.files f
     WHERE f.id = p_id AND f.workspace_id = v_ws;
    IF v_project IS NULL
       OR (v_deleted IS NOT NULL AND NOT COALESCE(p_allow_trashed, false))
       OR public.moth_file_row_locked(v_ws, v_project, p_id, v_flag, v_path, v_tags, v_folder) THEN
      RETURN false;
    END IF;
  ELSIF p_kind = 'phase' THEN
    -- phases has no workspace_id (0061): the project's own, below, is what says which company it is in.
    -- 0124 (MO2-09): a phase set aside by its bid version (0090) is no target, as every R.A.B.B.I.T. reader
    -- and Moth's own reads leave it out. A trashed row is never also set aside, so the trash flag leaves this be.
    SELECT ph.project_id, ph.deleted_at, ph.set_aside_at INTO v_project, v_deleted, v_aside
      FROM public.phases ph
     WHERE ph.id = p_id;
    IF v_project IS NULL OR v_aside IS NOT NULL OR (v_deleted IS NOT NULL AND NOT COALESCE(p_allow_trashed, false)) THEN
      RETURN false;
    END IF;
  ELSIF p_kind = 'asset' THEN
    SELECT a.project_id, a.deleted_at INTO v_project, v_deleted
      FROM public.assets a
     WHERE a.id = p_id AND a.workspace_id = v_ws;
    IF v_project IS NULL OR (v_deleted IS NOT NULL AND NOT COALESCE(p_allow_trashed, false)) THEN
      RETURN false;
    END IF;
  ELSIF p_kind = 'task' THEN
    -- 0124 (MO2-09): a task set aside by its bid version is no target either.
    SELECT t.project_id, t.deleted_at, t.set_aside_at INTO v_project, v_deleted, v_aside
      FROM public.tasks t
     WHERE t.id = p_id AND t.workspace_id = v_ws;
    IF v_project IS NULL OR v_aside IS NOT NULL OR (v_deleted IS NOT NULL AND NOT COALESCE(p_allow_trashed, false)) THEN
      RETURN false;
    END IF;
  ELSIF p_kind = 'scene' THEN
    SELECT s.project_id INTO v_project FROM public.scenes s WHERE s.id = p_id AND s.workspace_id = v_ws;
    IF v_project IS NULL THEN
      RETURN false;
    END IF;
  ELSIF p_kind = 'shot' THEN
    SELECT sh.project_id INTO v_project FROM public.shots sh WHERE sh.id = p_id AND sh.workspace_id = v_ws;
    IF v_project IS NULL THEN
      RETURN false;
    END IF;
  ELSIF p_kind = 'level' THEN
    SELECT l.project_id INTO v_project FROM public.levels l WHERE l.id = p_id AND l.workspace_id = v_ws;
    IF v_project IS NULL THEN
      RETURN false;
    END IF;
  ELSIF p_kind = 'experience' THEN
    SELECT e.project_id INTO v_project FROM public.experiences e WHERE e.id = p_id AND e.workspace_id = v_ws;
    IF v_project IS NULL THEN
      RETURN false;
    END IF;
  ELSIF p_kind = 'note' THEN
    -- 0125: a workspace note is the company's, not a project's. Its owner's alone while personal (no admin leg),
    -- every active member's once shared, and none in the trash unless a definer asks for one.
    SELECT n.tier, n.owner_id, n.deleted_at INTO v_tier, v_owner, v_deleted
      FROM public.notes n
     WHERE n.id = p_id AND n.workspace_id = v_ws;
    RETURN v_tier IS NOT NULL
       AND (v_deleted IS NULL OR COALESCE(p_allow_trashed, false))
       AND (v_tier <> 'personal' OR v_owner = auth.uid());
  ELSIF p_kind = 'mtag' THEN
    -- 0126: a typed tag is the company's or one person's, and a personal one its owner's alone (no admin leg). A tag
    -- folded into another stands for it no longer.
    SELECT t.tier, t.owner_id INTO v_tier, v_owner
      FROM public.moth_tags t
     WHERE t.id = p_id AND t.workspace_id = v_ws AND t.canonical_id IS NULL;
    RETURN v_tier IS NOT NULL AND (v_tier = 'company' OR v_owner = auth.uid());
  ELSE
    RETURN false;
  END IF;

  -- The personal arm has no admin leg: this is what keeps a personal space out
  -- of every Moth surface for an admin, who reaches it from Files only.
  RETURN EXISTS (
    SELECT 1 FROM public.projects p
     WHERE p.id = v_project
       AND p.workspace_id = v_ws
       AND p.deleted_at IS NULL
       AND public.passes_project_privacy(p.id)
       AND (p.personal_owner_id IS NULL OR p.personal_owner_id = auth.uid()
            -- 0121: her answer. Only inside moth_move_leaver_files, which sets this, and asked of the
            -- person again: no admin reaches a space through Moth's reads.
            OR (COALESCE(current_setting('wilson.moth_leaver_move', true), '') = 'on'
                AND rabbit_private.personal_space_of_a_leaver(p.id)))
  );
END;
$$;

ALTER TABLE public.moth_layout_positions
  ADD COLUMN IF NOT EXISTS note_ref UUID GENERATED ALWAYS AS (CASE WHEN target_type = 'note' THEN target_id END) STORED;
ALTER TABLE public.moth_layout_positions
  ADD COLUMN IF NOT EXISTS mtag_ref UUID GENERATED ALWAYS AS (CASE WHEN target_type = 'mtag' THEN target_id END) STORED;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.moth_layout_positions'::regclass AND conname = 'moth_layout_positions_note_ref_fk') THEN
    ALTER TABLE public.moth_layout_positions ADD CONSTRAINT moth_layout_positions_note_ref_fk
      FOREIGN KEY (note_ref) REFERENCES public.notes (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.moth_layout_positions'::regclass AND conname = 'moth_layout_positions_mtag_ref_fk') THEN
    ALTER TABLE public.moth_layout_positions ADD CONSTRAINT moth_layout_positions_mtag_ref_fk
      FOREIGN KEY (mtag_ref) REFERENCES public.moth_tags (id) ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE public.moth_layout_positions DROP CONSTRAINT IF EXISTS moth_layout_positions_type_chk;
ALTER TABLE public.moth_layout_positions ADD CONSTRAINT moth_layout_positions_type_chk CHECK (target_type IN
  ('project', 'folder', 'file', 'phase', 'asset', 'task', 'scene', 'shot', 'level', 'experience', 'tag', 'note', 'mtag'));
CREATE INDEX IF NOT EXISTS moth_layout_positions_note_ref_idx ON public.moth_layout_positions (note_ref) WHERE note_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_layout_positions_mtag_ref_idx ON public.moth_layout_positions (mtag_ref) WHERE mtag_ref IS NOT NULL;

-- Restated from 0124's body. Only the project view's rule changes: a note and a typed tag belong to no project.
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
  v_one  JSONB;
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
  -- 0124 (MO2-10): a target named twice is one place, the last naming it. Fold first, and only then count a
  -- focus, so one target sent with a focus and then without neither clears the old focus nor counts twice.
  SELECT COALESCE(jsonb_agg(d.v ORDER BY d.n), '[]'::jsonb) INTO v_one
    FROM (
      SELECT DISTINCT ON (e.v ->> 't', (e.v ->> 'id')::uuid, e.v ->> 'tag') e.v, e.n
        FROM jsonb_array_elements(p_places) WITH ORDINALITY AS e(v, n)
       ORDER BY e.v ->> 't', (e.v ->> 'id')::uuid, e.v ->> 'tag', e.n DESC
    ) d;
  IF (SELECT count(*) FROM jsonb_array_elements(v_one) AS e(v) WHERE (e.v ->> 'focus') = 'true') > 1 THEN
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
  -- 0126: a note and a typed tag belong to no project, so a project's view may keep their places too.
  IF a.o_scope = 'project' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_places) AS e(v)
        WHERE e.v ->> 't' NOT IN ('tag', 'note', 'mtag')
          AND rabbit_private.moth_target_project(e.v ->> 't', (e.v ->> 'id')::uuid) IS DISTINCT FROM a.o_project) THEN
    RAISE EXCEPTION 'A project''s view keeps the places of that project''s things only.' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('moth_layout_positions:' || p_view::text || ':' || COALESCE(a.o_owner::text, ''), 0));
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_one) AS e(v) WHERE (e.v ->> 'focus') = 'true') THEN
    UPDATE public.moth_layout_positions SET is_focus = false
     WHERE view_id = p_view AND owner_id IS NOT DISTINCT FROM a.o_owner AND is_focus;
  END IF;
  INSERT INTO public.moth_layout_positions AS p
         (view_id, workspace_id, target_type, target_id, target_tag, owner_id, x, y, pinned, is_open, is_focus)
  SELECT p_view, public.current_workspace_id(), d.t, d.id, d.tag, a.o_owner, d.x, d.y, d.pinned, d.is_open, d.is_focus
    FROM (
      SELECT e.v ->> 't' AS t,
             (e.v ->> 'id')::uuid AS id,
             e.v ->> 'tag' AS tag,
             (e.v ->> 'x')::double precision AS x,
             (e.v ->> 'y')::double precision AS y,
             COALESCE((e.v ->> 'pinned')::boolean, false) AS pinned,
             COALESCE((e.v ->> 'open')::boolean, false) AS is_open,
             COALESCE((e.v ->> 'focus')::boolean, false) AS is_focus
        FROM jsonb_array_elements(v_one) AS e(v)
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

-- §8 Post-conditions ---------------------------------------------------------------
DO $$
DECLARE
  v_fn RECORD;
  v_t  TEXT;
BEGIN
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('public.moth_tag_norm(text)', '3e54bf488d3a981a9fbc550e2e3135b5', false, 'i'),
      ('public.fn_moth_tag_types_pin()', '2d2083c7564cf81ac8c53435b4ed0cfa', false, 'v'),
      ('public.fn_moth_tags_pin()', 'aa2f17f5cf2b805ef5a517fffd33bb1a', false, 'v'),
      ('public.fn_moth_tag_assignments_pin()', 'd5bcf6052c73b84fefb530dc6df8d506', false, 'v'),
      ('rabbit_private.moth_tag_fold(uuid,uuid,uuid)', '2220e13f3135be04110fcba52d3fb394', true, 'v'),
      ('public.moth_tag_nominate(uuid,text)', 'da91fca89f14e7326ca1a55fbdecdc1b', true, 'v'),
      ('public.moth_tag_nomination_withdraw(uuid)', '8cb0f57feda72f7959df5ee385da5ea2', true, 'v'),
      ('public.moth_tag_nomination_decide(uuid,boolean,text)', 'ccbe71185e656b1711f7438ec631a3ec', true, 'v'),
      ('public.moth_tag_merge(uuid,uuid)', '88b59ac16d77f21870115fdf956e3749', true, 'v'),
      ('public._moth_target_eligible(text,uuid,boolean)', 'd698cc503481bb497557ff247b3aab72', true, 's'),
      ('public.moth_put_positions(uuid,jsonb)', '3cfc69fd8cbf9383429ed143ec113443', true, 'v')
    ) AS t(sig, now_is, definer, volatility)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_fn.sig::regprocedure
                      AND md5(replace(prosrc, chr(13), '')) = v_fn.now_is
                      AND prosecdef = v_fn.definer AND provolatile = v_fn.volatility AND proconfig IS NOT NULL) THEN
      RAISE EXCEPTION '0126 post-condition: % is not this file''s, or runs as the wrong role or volatility', v_fn.sig;
    END IF;
  END LOOP;
  -- Every rabbit_private function pins its path to public alone (suite 115 #14).
  IF (SELECT proconfig FROM pg_proc WHERE oid = 'rabbit_private.moth_tag_fold(uuid,uuid,uuid)'::regprocedure) IS DISTINCT FROM ARRAY['search_path=public'] THEN
    RAISE EXCEPTION '0126 post-condition: rabbit_private.moth_tag_fold does not pin its path to public alone';
  END IF;

  -- Who may call what.
  FOR v_fn IN SELECT * FROM (VALUES
      ('public.moth_tag_norm(text)', true),
      ('public.fn_moth_tag_types_pin()', false),
      ('public.fn_moth_tags_pin()', false),
      ('public.fn_moth_tag_assignments_pin()', false),
      ('rabbit_private.moth_tag_fold(uuid,uuid,uuid)', false),
      ('public.moth_tag_nominate(uuid,text)', true),
      ('public.moth_tag_nomination_withdraw(uuid)', true),
      ('public.moth_tag_nomination_decide(uuid,boolean,text)', true),
      ('public.moth_tag_merge(uuid,uuid)', true),
      ('public._moth_target_eligible(text,uuid,boolean)', false),
      ('public.moth_put_positions(uuid,jsonb)', true)
    ) AS t(sig, open)
  LOOP
    IF has_function_privilege('anon', v_fn.sig::regprocedure, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn.sig::regprocedure, 'EXECUTE') IS DISTINCT FROM v_fn.open THEN
      RAISE EXCEPTION '0126 post-condition: % has the wrong grants', v_fn.sig;
    END IF;
  END LOOP;

  -- The four tables: forced row security, their policies by name, no privilege for anon, the client's columns.
  FOREACH v_t IN ARRAY ARRAY['moth_tag_types', 'moth_tags', 'moth_tag_assignments', 'moth_tag_nominations'] LOOP
    IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = ('public.' || v_t)::regclass)
       OR has_table_privilege('anon', 'public.' || v_t, 'SELECT') THEN
      RAISE EXCEPTION '0126 post-condition: % is not forced or is open to anon', v_t;
    END IF;
  END LOOP;
  IF (SELECT string_agg(tablename || '.' || policyname || ':' || cmd, ',' ORDER BY tablename, policyname) FROM pg_policies
       WHERE schemaname = 'public' AND tablename IN ('moth_tag_types', 'moth_tags', 'moth_tag_assignments', 'moth_tag_nominations'))
     IS DISTINCT FROM 'moth_tag_assignments.moth_tag_assignments_delete:DELETE,moth_tag_assignments.moth_tag_assignments_insert:INSERT,moth_tag_assignments.moth_tag_assignments_select:SELECT,'
                      'moth_tag_nominations.moth_tag_nominations_select:SELECT,'
                      'moth_tag_types.moth_tag_types_delete:DELETE,moth_tag_types.moth_tag_types_insert:INSERT,moth_tag_types.moth_tag_types_select:SELECT,moth_tag_types.moth_tag_types_update:UPDATE,'
                      'moth_tags.moth_tags_delete:DELETE,moth_tags.moth_tags_insert:INSERT,moth_tags.moth_tags_select:SELECT,moth_tags.moth_tags_update:UPDATE' THEN
    RAISE EXCEPTION '0126 post-condition: the tag tables'' policies are not this file''s';
  END IF;
  IF has_table_privilege('authenticated', 'public.moth_tag_nominations', 'INSERT')
     OR has_table_privilege('authenticated', 'public.moth_tag_nominations', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.moth_tag_assignments', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.moth_tags', 'canonical_id', 'INSERT')
     OR has_column_privilege('authenticated', 'public.moth_tags', 'canonical_id', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.moth_tags', 'owner_id', 'INSERT')
     OR has_column_privilege('authenticated', 'public.moth_tags', 'tier', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.moth_tag_assignments', 'owner_id', 'INSERT')
     OR has_column_privilege('authenticated', 'public.moth_tag_types', 'owner_id', 'INSERT') THEN
    RAISE EXCEPTION '0126 post-condition: a client may write a column only a definer or a pin writes';
  END IF;
  -- Off every realtime topic.
  IF EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
              WHERE t.tgrelid IN ('public.moth_tag_types'::regclass, 'public.moth_tags'::regclass,
                                  'public.moth_tag_assignments'::regclass, 'public.moth_tag_nominations'::regclass)
                AND p.proname LIKE '%broadcast%') THEN
    RAISE EXCEPTION '0126 post-condition: a tag table is on a realtime topic';
  END IF;
  -- The form: case, width and spaces do not make two labels.
  IF public.moth_tag_norm('  Blender   5.0 ') IS DISTINCT FROM 'blender 5.0'
     OR public.moth_tag_norm('ＭＩＲＡ') IS DISTINCT FROM 'mira' THEN
    RAISE EXCEPTION '0126 post-condition: moth_tag_norm is not this file''s';
  END IF;
  -- The places: two references more, and the kinds' CHECK names them.
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.moth_layout_positions'::regclass AND contype IN ('f', 'c')) <> 18
     OR position('''mtag''' IN (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'moth_layout_positions_type_chk')) = 0 THEN
    RAISE EXCEPTION '0126 post-condition: moth_layout_positions does not take notes and typed tags';
  END IF;

  RAISE NOTICE '0126 OK';
END $$;
