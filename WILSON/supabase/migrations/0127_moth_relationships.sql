-- =============================================================================
-- 0127_moth_relationships.sql — M.O.T.H. Session 3 (MO3): links between things, drawn by hand or typed in their text.
-- (the brief §6.1 and §6.2; docs/sessions/PLAN_MOTH.md §4 "Proposed links" and §5 Session 3; MOTH_DESIGN §4.)
--
-- Tags say what something is; a link says how two things connect ("Mira is the sister of Jonah"). The links WILSON
-- already stores (a task and its items, an asset and where it is used) stay where they are and are read as before
-- (0122); these are the new ones, each stored once.
--
-- WHAT THIS ADDS
-- --------------
--   §1  moth_relationships: one row a link, from one thing to another, with optional words on the line. A link is
--       seen by whoever sees both ends (Moth's gate, live), so a note that links two projects shows each person only
--       the ends they may see, and a link from a person's own note shows only to them. A hand-drawn link ('manual')
--       is made, relabelled and removed by those who may change the thing it starts from, to a thing they see. A
--       typed one ('inline') belongs to the words of a field and comes and goes with them: only §3 writes it.
--   §2  moth_mention_reservations: picking a thing after [[ reserves an opaque key for it, the picker's own, for a
--       day. The text holds [[the words|m:key]] and never the thing's id, so a reader who cannot see the thing reads
--       the words alone, with nothing that points at it.
--   §3  When a description or a notes field is saved (projects, phases, assets, tasks, scenes, shots, levels,
--       experiences and files), a key in it that the writer reserved, for a thing they still see, becomes a typed
--       link of that field, and a typed link whose key has left the text goes. Any writer keeps them true: a form,
--       a table cell, a popup or an import. A key copied from elsewhere links nothing. A writer who cannot see a
--       key's thing leaves its link as it is. A note's body is a Yjs document the server cannot read, so
--       moth_note_mentions_sync does the same from the keys the note's editor sends after it saves. A link never
--       fails a person's write: if one cannot be made, the text is saved and the field's links wait for its next save.
--   §4  moth_mention_reserve(kind, id) for the picker; moth_note_mentions_sync(note, keys) for a note.
--   §5  Reads, each asking the gate of every end it returns: moth_relationships_read() for the graph (at most
--       60,000, and says when cut); moth_item_links(kind, id) for a thing's "Links" and "Mentioned in"; and
--       moth_mention_candidates(query, limit) for the picker, which offers only what the person can see.
--
-- On no realtime topic, in no takeout. One transaction, re-runnable, no enum. Suites 131_moth_relationships.sql
-- and 132_moth_mention_reservations.sql (new, each with its RLS_TABLES line).
-- =============================================================================

SET LOCAL lock_timeout = '15s';

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
DECLARE
  v_fn RECORD;
BEGIN
  IF to_regclass('public.moth_tags') IS NULL OR to_regprocedure('public.moth_notes()') IS NULL THEN
    RAISE EXCEPTION '0127 refused: 0125 and 0126 must be applied first';
  END IF;
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0127 refused: % does not bypass row security', current_user;
  END IF;
  -- The text columns §3 reads.
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public'
         AND ((table_name IN ('projects', 'phases', 'assets', 'files') AND column_name = 'description')
              OR (table_name IN ('tasks', 'scenes', 'shots', 'levels', 'experiences') AND column_name IN ('description', 'notes')))) <> 14 THEN
    RAISE EXCEPTION '0127 refused: a description or notes column it reads is missing';
  END IF;
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('public.fn_moth_relationships_pin()', 'fadd420a58a36df725579ed0780ee1a1'),
      ('rabbit_private.moth_mention_keys(text)', 'aafccce6188514d2f1fb4d8350739914'),
      ('rabbit_private.moth_mentions_apply(uuid,text,uuid,text,text[])', 'c31d2a2f4ba2235ef0d47d842f194a33'),
      ('public.fn_moth_text_mentions()', 'd7abbd7c075bd8c67889463d3bced876'),
      ('public.moth_mention_reserve(text,uuid)', 'd0604d93c1bc1beccc08e1b3042fe803'),
      ('public.moth_note_mentions_sync(uuid,text[])', '12199ae5bc1278a5acac3a4f1520bd79'),
      ('rabbit_private.moth_target_name(text,uuid)', 'db99af414ed349291318744aebbe9755'),
      ('public.moth_relationships_read()', 'ed91c90f3773aebf715b8a184e2c5c99'),
      ('public.moth_item_links(text,uuid)', 'd5a5a57e0dfc7d453170c6c5175222d8'),
      ('public.moth_mention_candidates(text,integer)', '7a344273afc667e07a436208ab2a0a8c')
    ) AS t(sig, now_is)
  LOOP
    IF to_regprocedure(v_fn.sig) IS NOT NULL
       AND (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure(v_fn.sig)) IS DISTINCT FROM v_fn.now_is THEN
      RAISE EXCEPTION '0127 refused: % is here and is not this file''s', v_fn.sig;
    END IF;
  END LOOP;
  IF to_regclass('public.moth_relationships') IS NOT NULL
     AND (SELECT count(*) FROM pg_constraint WHERE conrelid = to_regclass('public.moth_relationships') AND contype IN ('c', 'f', 'p')) <> 30 THEN
    RAISE EXCEPTION '0127 refused: a moth_relationships table is here that is not this file''s';
  END IF;
  IF to_regclass('public.moth_mention_reservations') IS NOT NULL
     AND (SELECT count(*) FROM pg_constraint WHERE conrelid = to_regclass('public.moth_mention_reservations') AND contype IN ('c', 'f', 'p')) <> 4 THEN
    RAISE EXCEPTION '0127 refused: a moth_mention_reservations table is here that is not this file''s';
  END IF;
END $$;

-- §1 Links ------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.moth_relationships (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL DEFAULT public.current_workspace_id(),
  source_type   TEXT NOT NULL,
  source_id     UUID NOT NULL,
  dest_type     TEXT NOT NULL,
  dest_id       UUID NOT NULL,
  label         TEXT,
  origin        TEXT NOT NULL DEFAULT 'manual',
  field         TEXT,
  mention_key   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID,
  -- One typed reference per kind at each end, id-only as moth_layout_positions' are, so a link goes with either end.
  src_project_ref UUID GENERATED ALWAYS AS (CASE WHEN source_type = 'project' THEN source_id END) STORED,
  src_folder_ref UUID GENERATED ALWAYS AS (CASE WHEN source_type = 'folder' THEN source_id END) STORED,
  src_file_ref UUID GENERATED ALWAYS AS (CASE WHEN source_type = 'file' THEN source_id END) STORED,
  src_phase_ref UUID GENERATED ALWAYS AS (CASE WHEN source_type = 'phase' THEN source_id END) STORED,
  src_asset_ref UUID GENERATED ALWAYS AS (CASE WHEN source_type = 'asset' THEN source_id END) STORED,
  src_task_ref UUID GENERATED ALWAYS AS (CASE WHEN source_type = 'task' THEN source_id END) STORED,
  src_scene_ref UUID GENERATED ALWAYS AS (CASE WHEN source_type = 'scene' THEN source_id END) STORED,
  src_shot_ref UUID GENERATED ALWAYS AS (CASE WHEN source_type = 'shot' THEN source_id END) STORED,
  src_level_ref UUID GENERATED ALWAYS AS (CASE WHEN source_type = 'level' THEN source_id END) STORED,
  src_experience_ref UUID GENERATED ALWAYS AS (CASE WHEN source_type = 'experience' THEN source_id END) STORED,
  src_note_ref UUID GENERATED ALWAYS AS (CASE WHEN source_type = 'note' THEN source_id END) STORED,
  dst_project_ref UUID GENERATED ALWAYS AS (CASE WHEN dest_type = 'project' THEN dest_id END) STORED,
  dst_folder_ref UUID GENERATED ALWAYS AS (CASE WHEN dest_type = 'folder' THEN dest_id END) STORED,
  dst_file_ref UUID GENERATED ALWAYS AS (CASE WHEN dest_type = 'file' THEN dest_id END) STORED,
  dst_phase_ref UUID GENERATED ALWAYS AS (CASE WHEN dest_type = 'phase' THEN dest_id END) STORED,
  dst_asset_ref UUID GENERATED ALWAYS AS (CASE WHEN dest_type = 'asset' THEN dest_id END) STORED,
  dst_task_ref UUID GENERATED ALWAYS AS (CASE WHEN dest_type = 'task' THEN dest_id END) STORED,
  dst_scene_ref UUID GENERATED ALWAYS AS (CASE WHEN dest_type = 'scene' THEN dest_id END) STORED,
  dst_shot_ref UUID GENERATED ALWAYS AS (CASE WHEN dest_type = 'shot' THEN dest_id END) STORED,
  dst_level_ref UUID GENERATED ALWAYS AS (CASE WHEN dest_type = 'level' THEN dest_id END) STORED,
  dst_experience_ref UUID GENERATED ALWAYS AS (CASE WHEN dest_type = 'experience' THEN dest_id END) STORED,
  dst_note_ref UUID GENERATED ALWAYS AS (CASE WHEN dest_type = 'note' THEN dest_id END) STORED,

  CONSTRAINT moth_relationships_workspace_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT moth_relationships_src_project_fk FOREIGN KEY (src_project_ref) REFERENCES public.projects (id) ON DELETE CASCADE,
  CONSTRAINT moth_relationships_src_folder_fk FOREIGN KEY (src_folder_ref) REFERENCES public.folders (id) ON DELETE CASCADE,
  CONSTRAINT moth_relationships_src_file_fk FOREIGN KEY (src_file_ref) REFERENCES public.files (id) ON DELETE CASCADE,
  CONSTRAINT moth_relationships_src_phase_fk FOREIGN KEY (src_phase_ref) REFERENCES public.phases (id) ON DELETE CASCADE,
  CONSTRAINT moth_relationships_src_asset_fk FOREIGN KEY (src_asset_ref) REFERENCES public.assets (id) ON DELETE CASCADE,
  CONSTRAINT moth_relationships_src_task_fk FOREIGN KEY (src_task_ref) REFERENCES public.tasks (id) ON DELETE CASCADE,
  CONSTRAINT moth_relationships_src_scene_fk FOREIGN KEY (src_scene_ref) REFERENCES public.scenes (id) ON DELETE CASCADE,
  CONSTRAINT moth_relationships_src_shot_fk FOREIGN KEY (src_shot_ref) REFERENCES public.shots (id) ON DELETE CASCADE,
  CONSTRAINT moth_relationships_src_level_fk FOREIGN KEY (src_level_ref) REFERENCES public.levels (id) ON DELETE CASCADE,
  CONSTRAINT moth_relationships_src_experience_fk FOREIGN KEY (src_experience_ref) REFERENCES public.experiences (id) ON DELETE CASCADE,
  CONSTRAINT moth_relationships_src_note_fk FOREIGN KEY (src_note_ref) REFERENCES public.notes (id) ON DELETE CASCADE,
  CONSTRAINT moth_relationships_dst_project_fk FOREIGN KEY (dst_project_ref) REFERENCES public.projects (id) ON DELETE CASCADE,
  CONSTRAINT moth_relationships_dst_folder_fk FOREIGN KEY (dst_folder_ref) REFERENCES public.folders (id) ON DELETE CASCADE,
  CONSTRAINT moth_relationships_dst_file_fk FOREIGN KEY (dst_file_ref) REFERENCES public.files (id) ON DELETE CASCADE,
  CONSTRAINT moth_relationships_dst_phase_fk FOREIGN KEY (dst_phase_ref) REFERENCES public.phases (id) ON DELETE CASCADE,
  CONSTRAINT moth_relationships_dst_asset_fk FOREIGN KEY (dst_asset_ref) REFERENCES public.assets (id) ON DELETE CASCADE,
  CONSTRAINT moth_relationships_dst_task_fk FOREIGN KEY (dst_task_ref) REFERENCES public.tasks (id) ON DELETE CASCADE,
  CONSTRAINT moth_relationships_dst_scene_fk FOREIGN KEY (dst_scene_ref) REFERENCES public.scenes (id) ON DELETE CASCADE,
  CONSTRAINT moth_relationships_dst_shot_fk FOREIGN KEY (dst_shot_ref) REFERENCES public.shots (id) ON DELETE CASCADE,
  CONSTRAINT moth_relationships_dst_level_fk FOREIGN KEY (dst_level_ref) REFERENCES public.levels (id) ON DELETE CASCADE,
  CONSTRAINT moth_relationships_dst_experience_fk FOREIGN KEY (dst_experience_ref) REFERENCES public.experiences (id) ON DELETE CASCADE,
  CONSTRAINT moth_relationships_dst_note_fk FOREIGN KEY (dst_note_ref) REFERENCES public.notes (id) ON DELETE CASCADE,
  CONSTRAINT moth_relationships_source_type_chk CHECK (source_type IN ('project', 'folder', 'file', 'phase', 'asset', 'task', 'scene', 'shot', 'level', 'experience', 'note')),
  CONSTRAINT moth_relationships_dest_type_chk CHECK (dest_type IN ('project', 'folder', 'file', 'phase', 'asset', 'task', 'scene', 'shot', 'level', 'experience', 'note')),
  CONSTRAINT moth_relationships_origin_chk CHECK (origin IN ('manual', 'inline')),
  -- A hand-drawn link has words of its own, or none; a typed one has the field and the key its words are in.
  CONSTRAINT moth_relationships_shape_chk CHECK (
    (origin = 'manual' AND field IS NULL AND mention_key IS NULL)
    OR (origin = 'inline' AND field IN ('description', 'notes', 'body') AND mention_key ~ '^[0-9a-f]{12}$' AND label IS NULL)),
  CONSTRAINT moth_relationships_label_chk
    CHECK (label IS NULL OR (label = btrim(label) AND char_length(label) BETWEEN 1 AND 80 AND label !~ '[[:cntrl:]]')),
  CONSTRAINT moth_relationships_not_self_chk CHECK (NOT (source_type = dest_type AND source_id = dest_id))
);
CREATE UNIQUE INDEX IF NOT EXISTS moth_relationships_inline_key
  ON public.moth_relationships (source_type, source_id, field, mention_key) WHERE origin = 'inline';
CREATE UNIQUE INDEX IF NOT EXISTS moth_relationships_manual_key
  ON public.moth_relationships (source_type, source_id, dest_type, dest_id) WHERE origin = 'manual';
CREATE INDEX IF NOT EXISTS moth_relationships_dest_idx ON public.moth_relationships (workspace_id, dest_type, dest_id);
CREATE INDEX IF NOT EXISTS moth_relationships_source_idx ON public.moth_relationships (workspace_id, source_type, source_id, origin, field);
CREATE INDEX IF NOT EXISTS moth_relationships_src_project_idx ON public.moth_relationships (src_project_ref) WHERE src_project_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_relationships_src_folder_idx ON public.moth_relationships (src_folder_ref) WHERE src_folder_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_relationships_src_file_idx ON public.moth_relationships (src_file_ref) WHERE src_file_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_relationships_src_phase_idx ON public.moth_relationships (src_phase_ref) WHERE src_phase_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_relationships_src_asset_idx ON public.moth_relationships (src_asset_ref) WHERE src_asset_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_relationships_src_task_idx ON public.moth_relationships (src_task_ref) WHERE src_task_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_relationships_src_scene_idx ON public.moth_relationships (src_scene_ref) WHERE src_scene_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_relationships_src_shot_idx ON public.moth_relationships (src_shot_ref) WHERE src_shot_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_relationships_src_level_idx ON public.moth_relationships (src_level_ref) WHERE src_level_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_relationships_src_experience_idx ON public.moth_relationships (src_experience_ref) WHERE src_experience_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_relationships_src_note_idx ON public.moth_relationships (src_note_ref) WHERE src_note_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_relationships_dst_project_idx ON public.moth_relationships (dst_project_ref) WHERE dst_project_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_relationships_dst_folder_idx ON public.moth_relationships (dst_folder_ref) WHERE dst_folder_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_relationships_dst_file_idx ON public.moth_relationships (dst_file_ref) WHERE dst_file_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_relationships_dst_phase_idx ON public.moth_relationships (dst_phase_ref) WHERE dst_phase_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_relationships_dst_asset_idx ON public.moth_relationships (dst_asset_ref) WHERE dst_asset_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_relationships_dst_task_idx ON public.moth_relationships (dst_task_ref) WHERE dst_task_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_relationships_dst_scene_idx ON public.moth_relationships (dst_scene_ref) WHERE dst_scene_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_relationships_dst_shot_idx ON public.moth_relationships (dst_shot_ref) WHERE dst_shot_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_relationships_dst_level_idx ON public.moth_relationships (dst_level_ref) WHERE dst_level_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_relationships_dst_experience_idx ON public.moth_relationships (dst_experience_ref) WHERE dst_experience_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS moth_relationships_dst_note_idx ON public.moth_relationships (dst_note_ref) WHERE dst_note_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_moth_relationships_pin()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_me    UUID := auth.uid();
  v_apply BOOLEAN := COALESCE(current_setting('wilson.moth_mentions_apply', true), '') = 'on';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT v_apply THEN
      -- A client draws a link by hand; only a field's words make a typed one (rabbit_private.moth_mentions_apply).
      NEW.origin      := 'manual';
      NEW.field       := NULL;
      NEW.mention_key := NULL;
    END IF;
    IF v_me IS NOT NULL THEN
      NEW.workspace_id := public.current_workspace_id();
      NEW.created_by   := v_me;
      NEW.updated_by   := v_me;
    END IF;
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  -- Only a hand-drawn link's words change; what it joins, and how it came, never.
  NEW.id          := OLD.id;
  NEW.workspace_id := OLD.workspace_id;
  NEW.source_type := OLD.source_type;
  NEW.source_id   := OLD.source_id;
  NEW.dest_type   := OLD.dest_type;
  NEW.dest_id     := OLD.dest_id;
  NEW.origin      := OLD.origin;
  NEW.field       := OLD.field;
  NEW.mention_key := OLD.mention_key;
  NEW.created_at  := OLD.created_at;
  NEW.created_by  := OLD.created_by;
  NEW.updated_at  := now();
  NEW.updated_by  := COALESCE(v_me, OLD.updated_by);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_moth_relationships_pin() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_moth_relationships_pin ON public.moth_relationships;
CREATE TRIGGER trg_moth_relationships_pin BEFORE INSERT OR UPDATE ON public.moth_relationships
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_relationships_pin();

ALTER TABLE public.moth_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moth_relationships FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS moth_relationships_select ON public.moth_relationships;
DROP POLICY IF EXISTS moth_relationships_insert ON public.moth_relationships;
DROP POLICY IF EXISTS moth_relationships_update ON public.moth_relationships;
DROP POLICY IF EXISTS moth_relationships_delete ON public.moth_relationships;
-- Seen by whoever sees both ends, through Moth's gate, live: no admin leg into a personal space, no money or Legal.
CREATE POLICY moth_relationships_select ON public.moth_relationships
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.moth_can_read_target(source_type, source_id)
    AND public.moth_can_read_target(dest_type, dest_id)
  );
-- A hand-drawn link: from a thing the person may change, to a thing they see.
CREATE POLICY moth_relationships_insert ON public.moth_relationships
  FOR INSERT WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND origin = 'manual'
    AND public.moth_can_write_target(source_type, source_id)
    AND public.moth_can_read_target(dest_type, dest_id)
  );
CREATE POLICY moth_relationships_update ON public.moth_relationships
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND origin = 'manual'
    AND public.moth_can_write_target(source_type, source_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND origin = 'manual'
    AND public.moth_can_write_target(source_type, source_id)
    AND public.moth_can_read_target(dest_type, dest_id)
  );
-- A typed link goes with its words, never on its own; a hand-drawn one by those who may change where it starts.
CREATE POLICY moth_relationships_delete ON public.moth_relationships
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND origin = 'manual'
    AND public.moth_can_write_target(source_type, source_id)
  );
REVOKE ALL ON public.moth_relationships FROM PUBLIC, anon;
REVOKE ALL ON public.moth_relationships FROM authenticated;
GRANT SELECT, DELETE ON public.moth_relationships TO authenticated;
GRANT INSERT (source_type, source_id, dest_type, dest_id, label) ON public.moth_relationships TO authenticated;
GRANT UPDATE (label) ON public.moth_relationships TO authenticated;
GRANT ALL ON public.moth_relationships TO service_role;

-- §2 Reserved keys ------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.moth_mention_reservations (
  mention_key   TEXT PRIMARY KEY,
  workspace_id  UUID NOT NULL,
  created_by    UUID NOT NULL,
  dest_type     TEXT NOT NULL,
  dest_id       UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT moth_mention_reservations_workspace_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT moth_mention_reservations_key_chk CHECK (mention_key ~ '^[0-9a-f]{12}$'),
  CONSTRAINT moth_mention_reservations_dest_type_chk CHECK (dest_type IN ('project', 'folder', 'file', 'phase', 'asset', 'task', 'scene', 'shot', 'level', 'experience', 'note'))
);
CREATE INDEX IF NOT EXISTS moth_mention_reservations_by_idx ON public.moth_mention_reservations (created_by, created_at);
CREATE INDEX IF NOT EXISTS moth_mention_reservations_age_idx ON public.moth_mention_reservations (workspace_id, created_at);
-- No client reads or writes a reservation: moth_mention_reserve makes one and §3 uses it up.
ALTER TABLE public.moth_mention_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moth_mention_reservations FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.moth_mention_reservations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.moth_mention_reservations TO service_role;

-- §3 Typed links follow their words -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rabbit_private.moth_mention_keys(p_text text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  -- [[the words|m:twelve hex digits]]: brackets in bracket expressions, so the pattern needs no escapes.
  SELECT COALESCE(array_agg(DISTINCT m[2] ORDER BY m[2]), ARRAY[]::text[])
    FROM regexp_matches(COALESCE(p_text, ''), '[[][[]([^][|[:cntrl:]]{1,200})[|]m:([0-9a-f]{12})[]][]]', 'g') AS m
$$;
REVOKE ALL ON FUNCTION rabbit_private.moth_mention_keys(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION rabbit_private.moth_mentions_apply(p_ws uuid, p_kind text, p_id uuid, p_field text, p_keys text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_keys TEXT[] := COALESCE(p_keys, ARRAY[]::text[]);
BEGIN
  PERFORM set_config('wilson.moth_mentions_apply', 'on', true);
  -- The field's typed links whose key has left its words go. A hand-drawn link is not the words', and stays.
  DELETE FROM public.moth_relationships r
   WHERE r.workspace_id = p_ws AND r.source_type = p_kind AND r.source_id = p_id
     AND r.origin = 'inline' AND r.field = p_field AND NOT (r.mention_key = ANY (v_keys));
  -- A key the writer reserved in the last day, for a thing they still see, becomes a link of this field, once. A
  -- key in the words that is another person's, or no one's, links nothing: it was copied, or is out of date.
  INSERT INTO public.moth_relationships (workspace_id, source_type, source_id, dest_type, dest_id, origin, field, mention_key)
  SELECT p_ws, p_kind, p_id, mr.dest_type, mr.dest_id, 'inline', p_field, mr.mention_key
    FROM public.moth_mention_reservations mr
   WHERE mr.mention_key = ANY (v_keys) AND mr.workspace_id = p_ws AND mr.created_by = auth.uid()
     AND mr.created_at > now() - interval '1 day'
     AND NOT (mr.dest_type = p_kind AND mr.dest_id = p_id)
     AND public.moth_can_read_target(mr.dest_type, mr.dest_id)
  ON CONFLICT DO NOTHING;
  DELETE FROM public.moth_mention_reservations mr
   WHERE mr.mention_key = ANY (v_keys) AND mr.workspace_id = p_ws AND mr.created_by = auth.uid();
  PERFORM set_config('wilson.moth_mentions_apply', '', true);
END;
$$;
REVOKE ALL ON FUNCTION rabbit_private.moth_mentions_apply(uuid, text, uuid, text, text[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_moth_text_mentions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new   JSONB := to_jsonb(NEW);
  v_old   JSONB := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
  v_kind  TEXT := CASE TG_TABLE_NAME
                    WHEN 'projects' THEN 'project' WHEN 'phases' THEN 'phase' WHEN 'assets' THEN 'asset'
                    WHEN 'tasks' THEN 'task' WHEN 'scenes' THEN 'scene' WHEN 'shots' THEN 'shot'
                    WHEN 'levels' THEN 'level' WHEN 'experiences' THEN 'experience' WHEN 'files' THEN 'file' END;
  v_ws    UUID;
  v_field TEXT;
BEGIN
  IF v_kind IS NULL THEN
    RETURN NULL;
  END IF;
  -- The company: the row's own, or its project's (a phase has no company column).
  v_ws := COALESCE((v_new ->> 'workspace_id')::uuid,
                   (SELECT p.workspace_id FROM public.projects p WHERE p.id = (v_new ->> 'project_id')::uuid));
  IF v_ws IS NULL THEN
    RETURN NULL;
  END IF;
  FOREACH v_field IN ARRAY TG_ARGV LOOP
    CONTINUE WHEN TG_OP = 'UPDATE' AND (v_new -> v_field) IS NOT DISTINCT FROM (v_old -> v_field);
    PERFORM rabbit_private.moth_mentions_apply(v_ws, v_kind, (v_new ->> 'id')::uuid, v_field,
                                               rabbit_private.moth_mention_keys(v_new ->> v_field));
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- A link is never worth a person's write: the words are saved, and this field's links wait for its next save.
  RAISE WARNING 'moth mentions on % %: %', TG_TABLE_NAME, v_new ->> 'id', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_moth_text_mentions() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_projects_moth_mentions ON public.projects;
CREATE TRIGGER trg_projects_moth_mentions AFTER INSERT OR UPDATE OF description ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_text_mentions('description');
DROP TRIGGER IF EXISTS trg_phases_moth_mentions ON public.phases;
CREATE TRIGGER trg_phases_moth_mentions AFTER INSERT OR UPDATE OF description ON public.phases
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_text_mentions('description');
DROP TRIGGER IF EXISTS trg_assets_moth_mentions ON public.assets;
CREATE TRIGGER trg_assets_moth_mentions AFTER INSERT OR UPDATE OF description ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_text_mentions('description');
DROP TRIGGER IF EXISTS trg_files_moth_mentions ON public.files;
CREATE TRIGGER trg_files_moth_mentions AFTER INSERT OR UPDATE OF description ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_text_mentions('description');
DROP TRIGGER IF EXISTS trg_tasks_moth_mentions ON public.tasks;
CREATE TRIGGER trg_tasks_moth_mentions AFTER INSERT OR UPDATE OF description, notes ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_text_mentions('description', 'notes');
DROP TRIGGER IF EXISTS trg_scenes_moth_mentions ON public.scenes;
CREATE TRIGGER trg_scenes_moth_mentions AFTER INSERT OR UPDATE OF description, notes ON public.scenes
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_text_mentions('description', 'notes');
DROP TRIGGER IF EXISTS trg_shots_moth_mentions ON public.shots;
CREATE TRIGGER trg_shots_moth_mentions AFTER INSERT OR UPDATE OF description, notes ON public.shots
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_text_mentions('description', 'notes');
DROP TRIGGER IF EXISTS trg_levels_moth_mentions ON public.levels;
CREATE TRIGGER trg_levels_moth_mentions AFTER INSERT OR UPDATE OF description, notes ON public.levels
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_text_mentions('description', 'notes');
DROP TRIGGER IF EXISTS trg_experiences_moth_mentions ON public.experiences;
CREATE TRIGGER trg_experiences_moth_mentions AFTER INSERT OR UPDATE OF description, notes ON public.experiences
  FOR EACH ROW EXECUTE FUNCTION public.fn_moth_text_mentions('description', 'notes');

-- §4 The picker's key, and a note's typed links -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.moth_mention_reserve(p_dest_type text, p_dest_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws  UUID := public.current_workspace_id();
  v_key TEXT;
BEGIN
  -- One refusal for every case: not there, hidden, money or Legal, someone else's personal space or note.
  IF auth.uid() IS NULL OR v_ws IS NULL OR NOT public.has_active_membership(v_ws)
     OR p_dest_type IS NULL
     OR p_dest_type NOT IN ('project', 'folder', 'file', 'phase', 'asset', 'task', 'scene', 'shot', 'level', 'experience', 'note')
     OR NOT COALESCE(public.moth_can_read_target(p_dest_type, p_dest_id), false) THEN
    RAISE EXCEPTION 'That is not something you can link to.' USING ERRCODE = '42501';
  END IF;
  -- Reservations past their day go, a thousand at a time, as new ones are made.
  DELETE FROM public.moth_mention_reservations mr
   WHERE mr.ctid IN (SELECT x.ctid FROM public.moth_mention_reservations x
                      WHERE x.workspace_id = v_ws AND x.created_at < now() - interval '1 day' LIMIT 1000);
  IF (SELECT count(*) FROM public.moth_mention_reservations mr WHERE mr.created_by = auth.uid()) >= 500 THEN
    RAISE EXCEPTION 'Many links are waiting to be saved; save what you are writing first.' USING ERRCODE = '54000';
  END IF;
  v_key := left(replace(gen_random_uuid()::text, '-', ''), 12);
  INSERT INTO public.moth_mention_reservations (mention_key, workspace_id, created_by, dest_type, dest_id)
  VALUES (v_key, v_ws, auth.uid(), p_dest_type, p_dest_id);
  RETURN v_key;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_mention_reserve(text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_mention_reserve(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.moth_note_mentions_sync(p_note uuid, p_keys text[])
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The keys the note's editor found in the body it has just saved; the server cannot read a Yjs document itself.
  IF NOT COALESCE(public.moth_can_write_target('note', p_note), false) THEN
    RAISE EXCEPTION 'That note is not one you can change.' USING ERRCODE = '42501';
  END IF;
  IF p_keys IS NULL OR cardinality(p_keys) > 2000
     OR EXISTS (SELECT 1 FROM unnest(p_keys) AS k(v) WHERE k.v IS NULL OR k.v !~ '^[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'A note''s links come as a list of at most 2,000 keys.' USING ERRCODE = '22023';
  END IF;
  PERFORM rabbit_private.moth_mentions_apply(public.current_workspace_id(), 'note', p_note, 'body', p_keys);
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_note_mentions_sync(uuid, text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_note_mentions_sync(uuid, text[]) TO authenticated;

-- §5 Reads ------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rabbit_private.moth_target_name(p_kind text, p_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Only ever asked after Moth's gate has said the caller sees the thing.
  SELECT left(CASE p_kind
    WHEN 'project'    THEN (SELECT p.title FROM public.projects p WHERE p.id = p_id)
    WHEN 'folder'     THEN (SELECT COALESCE(NULLIF(fo.label, ''), fo.slug) FROM public.folders fo WHERE fo.id = p_id)
    WHEN 'file'       THEN (SELECT f.name FROM public.files f WHERE f.id = p_id)
    WHEN 'phase'      THEN (SELECT ph.name FROM public.phases ph WHERE ph.id = p_id)
    WHEN 'asset'      THEN (SELECT a.name FROM public.assets a WHERE a.id = p_id)
    WHEN 'task'       THEN (SELECT t.title FROM public.tasks t WHERE t.id = p_id)
    WHEN 'scene'      THEN (SELECT s.name FROM public.scenes s WHERE s.id = p_id)
    WHEN 'shot'       THEN (SELECT sh.name FROM public.shots sh WHERE sh.id = p_id)
    WHEN 'level'      THEN (SELECT l.name FROM public.levels l WHERE l.id = p_id)
    WHEN 'experience' THEN (SELECT e.name FROM public.experiences e WHERE e.id = p_id)
    WHEN 'note'       THEN (SELECT n.title FROM public.notes n WHERE n.id = p_id)
  END, 200)
$$;
REVOKE ALL ON FUNCTION rabbit_private.moth_target_name(text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.moth_relationships_read()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_links JSONB;
  v_n     INT;
BEGIN
  -- Each row through the table's own read policy: both ends seen, through Moth's gate. At most 60,000, and it says so.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'source_kind', r.source_type, 'source_id', r.source_id,
                                               'target_kind', r.dest_type, 'target_id', r.dest_id, 'label', r.label,
                                               'origin', r.origin) ORDER BY r.id), '[]'::jsonb),
         count(*)
    INTO v_links, v_n
    FROM (SELECT x.id, x.source_type, x.source_id, x.dest_type, x.dest_id, x.label, x.origin
            FROM public.moth_relationships x
           WHERE x.workspace_id = public.current_workspace_id()
           ORDER BY x.id
           LIMIT 60001) r;
  IF v_n > 60000 THEN
    v_links := v_links - 60000;
  END IF;
  RETURN jsonb_build_object('links', v_links, 'truncated', v_n > 60000);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_relationships_read() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_relationships_read() TO authenticated;

CREATE OR REPLACE FUNCTION public.moth_item_links(p_kind text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws  UUID := public.current_workspace_id();
  v_out JSONB;
  v_in  JSONB;
BEGIN
  -- Nothing for a thing the caller cannot see, exactly as for one that is not there.
  IF NOT COALESCE(public.moth_can_read_target(p_kind, p_id), false) THEN
    RETURN jsonb_build_object('out', '[]'::jsonb, 'in', '[]'::jsonb);
  END IF;
  -- Its links out, each to a thing the caller sees; a typed one carries its key, so its words can be drawn as a link.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.dest_type, 'target_id', r.dest_id,
                                               'name', rabbit_private.moth_target_name(r.dest_type, r.dest_id),
                                               'project_id', rabbit_private.moth_target_project(r.dest_type, r.dest_id),
                                               'label', r.label, 'origin', r.origin, 'field', r.field, 'key', r.mention_key)
                            ORDER BY r.created_at, r.id), '[]'::jsonb)
    INTO v_out
    FROM (SELECT x.id, x.dest_type, x.dest_id, x.label, x.origin, x.field, x.mention_key, x.created_at
            FROM public.moth_relationships x
           WHERE x.workspace_id = v_ws AND x.source_type = p_kind AND x.source_id = p_id
           ORDER BY x.created_at, x.id
           LIMIT 500 OFFSET 0) r
   WHERE public.moth_can_read_target(r.dest_type, r.dest_id);
  -- What mentions it, or links to it, each from a thing the caller sees ("Mentioned in").
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.source_type, 'target_id', r.source_id,
                                               'name', rabbit_private.moth_target_name(r.source_type, r.source_id),
                                               'project_id', rabbit_private.moth_target_project(r.source_type, r.source_id),
                                               'label', r.label, 'origin', r.origin, 'field', r.field)
                            ORDER BY r.created_at, r.id), '[]'::jsonb)
    INTO v_in
    FROM (SELECT x.id, x.source_type, x.source_id, x.label, x.origin, x.field, x.created_at
            FROM public.moth_relationships x
           WHERE x.workspace_id = v_ws AND x.dest_type = p_kind AND x.dest_id = p_id
           ORDER BY x.created_at, x.id
           LIMIT 500 OFFSET 0) r
   WHERE public.moth_can_read_target(r.source_type, r.source_id);
  RETURN jsonb_build_object('out', v_out, 'in', v_in);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_item_links(text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_item_links(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.moth_mention_candidates(p_query text, p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws  UUID := public.current_workspace_id();
  v_q   TEXT := lower(btrim(COALESCE(p_query, '')));
  v_lim INT := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  v_r   JSONB;
BEGIN
  IF auth.uid() IS NULL OR v_ws IS NULL OR NOT public.has_active_membership(v_ws) OR char_length(v_q) > 120 THEN
    RETURN '[]'::jsonb;
  END IF;
  -- Names that hold the words (no wildcards: position, not LIKE), the newest of each kind first, and then only what
  -- Moth's gate shows the caller: the picker offers nothing they cannot see.
  WITH c AS (
    SELECT * FROM (SELECT 'note'::text AS kind, n.id, n.title AS name, n.updated_at FROM public.notes n
                    WHERE n.workspace_id = v_ws AND n.deleted_at IS NULL AND position(v_q IN lower(n.title)) > 0
                    ORDER BY n.updated_at DESC LIMIT 200) a
    UNION ALL
    SELECT * FROM (SELECT 'project'::text, p.id, p.title, p.updated_at FROM public.projects p
                    WHERE p.workspace_id = v_ws AND p.deleted_at IS NULL AND position(v_q IN lower(p.title)) > 0
                    ORDER BY p.updated_at DESC LIMIT 200) b
    UNION ALL
    SELECT * FROM (SELECT 'file'::text, f.id, f.name, f.updated_at FROM public.files f
                    WHERE f.workspace_id = v_ws AND f.deleted_at IS NULL AND position(v_q IN lower(f.name)) > 0
                    ORDER BY f.updated_at DESC LIMIT 200) c1
    UNION ALL
    SELECT * FROM (SELECT 'phase'::text, ph.id, ph.name, ph.updated_at FROM public.phases ph
                     JOIN public.projects p ON p.id = ph.project_id
                    WHERE p.workspace_id = v_ws AND ph.deleted_at IS NULL AND ph.set_aside_at IS NULL
                      AND position(v_q IN lower(ph.name)) > 0
                    ORDER BY ph.updated_at DESC LIMIT 200) d
    UNION ALL
    SELECT * FROM (SELECT 'asset'::text, a.id, a.name, a.updated_at FROM public.assets a
                    WHERE a.workspace_id = v_ws AND a.deleted_at IS NULL AND position(v_q IN lower(a.name)) > 0
                    ORDER BY a.updated_at DESC LIMIT 200) e
    UNION ALL
    SELECT * FROM (SELECT 'task'::text, t.id, t.title, t.updated_at FROM public.tasks t
                    WHERE t.workspace_id = v_ws AND t.deleted_at IS NULL AND t.set_aside_at IS NULL
                      AND position(v_q IN lower(t.title)) > 0
                    ORDER BY t.updated_at DESC LIMIT 200) f2
    UNION ALL
    SELECT * FROM (SELECT 'scene'::text, s.id, s.name, s.updated_at FROM public.scenes s
                    WHERE s.workspace_id = v_ws AND position(v_q IN lower(s.name)) > 0
                    ORDER BY s.updated_at DESC LIMIT 200) g
    UNION ALL
    SELECT * FROM (SELECT 'shot'::text, sh.id, sh.name, sh.updated_at FROM public.shots sh
                    WHERE sh.workspace_id = v_ws AND position(v_q IN lower(sh.name)) > 0
                    ORDER BY sh.updated_at DESC LIMIT 200) h
    UNION ALL
    SELECT * FROM (SELECT 'level'::text, l.id, l.name, l.updated_at FROM public.levels l
                    WHERE l.workspace_id = v_ws AND position(v_q IN lower(l.name)) > 0
                    ORDER BY l.updated_at DESC LIMIT 200) i
    UNION ALL
    SELECT * FROM (SELECT 'experience'::text, x.id, x.name, x.updated_at FROM public.experiences x
                    WHERE x.workspace_id = v_ws AND position(v_q IN lower(x.name)) > 0
                    ORDER BY x.updated_at DESC LIMIT 200) j
  )
  SELECT COALESCE(jsonb_agg(z.j ORDER BY z.rank, z.updated_at DESC), '[]'::jsonb)
    INTO v_r
    FROM (SELECT jsonb_build_object('kind', g.kind, 'id', g.id, 'name', left(COALESCE(g.name, ''), 200),
                                    'project_id', rabbit_private.moth_target_project(g.kind, g.id)) AS j,
                 g.rank, g.updated_at
            FROM (SELECT c.*, CASE WHEN lower(c.name) = v_q THEN 0 WHEN starts_with(lower(c.name), v_q) THEN 1 ELSE 2 END AS rank
                    FROM c
                   ORDER BY 5, c.updated_at DESC
                  OFFSET 0) g
           WHERE public.moth_can_read_target(g.kind, g.id)
           ORDER BY g.rank, g.updated_at DESC
           LIMIT v_lim) z;
  RETURN v_r;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.moth_mention_candidates(text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moth_mention_candidates(text, integer) TO authenticated;

-- §6 Post-conditions ---------------------------------------------------------------
DO $$
DECLARE
  v_fn RECORD;
BEGIN
  FOR v_fn IN
    SELECT * FROM (VALUES
      ('public.fn_moth_relationships_pin()', 'fadd420a58a36df725579ed0780ee1a1', false),
      ('rabbit_private.moth_mention_keys(text)', 'aafccce6188514d2f1fb4d8350739914', false),
      ('rabbit_private.moth_mentions_apply(uuid,text,uuid,text,text[])', 'c31d2a2f4ba2235ef0d47d842f194a33', true),
      ('public.fn_moth_text_mentions()', 'd7abbd7c075bd8c67889463d3bced876', true),
      ('public.moth_mention_reserve(text,uuid)', 'd0604d93c1bc1beccc08e1b3042fe803', true),
      ('public.moth_note_mentions_sync(uuid,text[])', '12199ae5bc1278a5acac3a4f1520bd79', true),
      ('rabbit_private.moth_target_name(text,uuid)', 'db99af414ed349291318744aebbe9755', true),
      ('public.moth_relationships_read()', 'ed91c90f3773aebf715b8a184e2c5c99', false),
      ('public.moth_item_links(text,uuid)', 'd5a5a57e0dfc7d453170c6c5175222d8', true),
      ('public.moth_mention_candidates(text,integer)', '7a344273afc667e07a436208ab2a0a8c', true)
    ) AS t(sig, now_is, definer)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_fn.sig::regprocedure
                      AND md5(replace(prosrc, chr(13), '')) = v_fn.now_is AND prosecdef = v_fn.definer
                      AND proconfig IS NOT NULL) THEN
      RAISE EXCEPTION '0127 post-condition: % is not this file''s, or runs as the wrong role', v_fn.sig;
    END IF;
  END LOOP;
  -- Every rabbit_private function pins its path to public alone (suite 115 #14).
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'rabbit_private'::regnamespace
               AND proname IN ('moth_mention_keys', 'moth_mentions_apply', 'moth_target_name')
               AND proconfig IS DISTINCT FROM ARRAY['search_path=public']) THEN
    RAISE EXCEPTION '0127 post-condition: a rabbit_private function does not pin its path to public alone';
  END IF;

  FOR v_fn IN SELECT * FROM (VALUES
      ('public.fn_moth_relationships_pin()', false),
      ('rabbit_private.moth_mention_keys(text)', false),
      ('rabbit_private.moth_mentions_apply(uuid,text,uuid,text,text[])', false),
      ('public.fn_moth_text_mentions()', false),
      ('public.moth_mention_reserve(text,uuid)', true),
      ('public.moth_note_mentions_sync(uuid,text[])', true),
      ('rabbit_private.moth_target_name(text,uuid)', false),
      ('public.moth_relationships_read()', true),
      ('public.moth_item_links(text,uuid)', true),
      ('public.moth_mention_candidates(text,integer)', true)
    ) AS t(sig, open)
  LOOP
    IF has_function_privilege('anon', v_fn.sig::regprocedure, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn.sig::regprocedure, 'EXECUTE') IS DISTINCT FROM v_fn.open THEN
      RAISE EXCEPTION '0127 post-condition: % has the wrong grants', v_fn.sig;
    END IF;
  END LOOP;

  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.moth_relationships'::regclass)
     OR NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.moth_mention_reservations'::regclass)
     OR (SELECT string_agg(policyname || ':' || cmd, ',' ORDER BY policyname) FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'moth_relationships')
        IS DISTINCT FROM 'moth_relationships_delete:DELETE,moth_relationships_insert:INSERT,moth_relationships_select:SELECT,moth_relationships_update:UPDATE'
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'moth_mention_reservations')
     OR has_table_privilege('authenticated', 'public.moth_mention_reservations', 'SELECT')
     OR has_table_privilege('anon', 'public.moth_relationships', 'SELECT')
     OR has_column_privilege('authenticated', 'public.moth_relationships', 'origin', 'INSERT')
     OR has_column_privilege('authenticated', 'public.moth_relationships', 'mention_key', 'INSERT')
     OR has_column_privilege('authenticated', 'public.moth_relationships', 'dest_id', 'UPDATE') THEN
    RAISE EXCEPTION '0127 post-condition: the links'' row security or grants are not this file''s';
  END IF;
  -- The nine text triggers, after the write, each on its own columns.
  IF (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_%_moth_mentions'
        AND tgfoid = 'public.fn_moth_text_mentions()'::regprocedure AND tgenabled = 'O') <> 9 THEN
    RAISE EXCEPTION '0127 post-condition: the nine text triggers are not in place';
  END IF;
  -- Off every realtime topic.
  IF EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
              WHERE t.tgrelid IN ('public.moth_relationships'::regclass, 'public.moth_mention_reservations'::regclass)
                AND p.proname LIKE '%broadcast%') THEN
    RAISE EXCEPTION '0127 post-condition: a links table is on a realtime topic';
  END IF;
  -- The token's form: the words, a bar, m: and twelve hex digits.
  IF rabbit_private.moth_mention_keys('see [[Mira|m:0123456789ab]] and [[x|m:0123456789ab]], [[no|m:12]], [[a|b|m:aaaaaaaaaaaa]]')
       IS DISTINCT FROM ARRAY['0123456789ab'] THEN
    RAISE EXCEPTION '0127 post-condition: moth_mention_keys does not read the token as this file says';
  END IF;

  RAISE NOTICE '0127 OK';
END $$;
