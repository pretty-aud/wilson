-- =============================================================================
-- 0132_board_channels.sql — M.O.T.H. Session 4 (MO4): a board's two live channels.
-- (The brief §7.4; PLAN_MOTH §5 Session 4, "Database" and its MEASURED Realtime constraint; MOTH_DESIGN §1.13.)
--
-- People on one board see each other's cursors and each other's changes as they happen. Two channels a board, so
-- that what a client may say and what only the database says never share one:
--   moth:board:<board>:<epoch>.<gen>       the database's own: each save of elements, as one message a statement.
--                                          A client reads it and never sends on it, so no save can be forged.
--   moth:board-live:<board>:<epoch>.<gen>  cursors and "who's here": a client's broadcast and presence.
-- <epoch> is the project's topic_epoch (0107, moved by 0109 on a privacy flip); <gen> is the board's audience_gen.
--
-- WHAT THIS CHANGES
-- -----------------
--   §1  board_topic(board, live): the topic's name, for the server; board_topic_readable(topic): true only for a
--       board the caller may read through Moth's folder gate, named at its current epoch and generation;
--       board_channels(board): the two names, for a reader.
--   §2  realtime.messages: moth_board_topic_read (broadcast and presence on both, for a reader of the board) and
--       moth_board_live_write (a reader's broadcast and presence on the live channel only). Not restated where the
--       realtime schema is absent (CI's database-only stack), as 0109 does.
--   §3  Each statement that saves or removes a board's elements sends one message to the board's channel, its changed
--       elements in it, at most 50 a message and without a pen's long points or any file's id (a reader whose file
--       this is reads it through board_read); nothing is sent where realtime is absent.
--   §4  The audience moves. A connected client keeps its join until it rejoins or its token refreshes (measured,
--       MO1-01), so a narrowing renames the channels: audience_gen goes up when a board's folder goes to the trash
--       (0131) or to another project (0134), and for every board of a company when one of its members leaves, is
--       removed or has their role changed; a project's epoch already moves on a privacy flip. Each renaming sends
--       AUDIENCE to the old names, so those who may still read join the new ones and nobody talks on the old.
--
-- One transaction, re-runnable, no enum. Suite 137_board_channels.sql (environment-tolerant, as 23 and 112).
-- =============================================================================

SET LOCAL lock_timeout = '5s';

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
BEGIN
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0132 refused: % does not bypass row security', current_user;
  END IF;
  IF to_regprocedure('public.moth_trash_folders(uuid[])') IS NULL THEN
    RAISE EXCEPTION '0132 refused: 0131 must be applied first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'projects'
                  AND column_name = 'topic_epoch') THEN
    RAISE EXCEPTION '0132 refused: projects.topic_epoch (0107) is missing';
  END IF;
END $$;

-- §1 Names ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.board_topic(p_board uuid, p_live boolean, p_gen integer DEFAULT NULL)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN p_live THEN 'moth:board-live:' ELSE 'moth:board:' END || b.id::text || ':'
         || COALESCE(p.topic_epoch, 0)::text || '.' || COALESCE(p_gen, b.audience_gen)::text
    FROM public.boards b JOIN public.projects p ON p.id = b.project_id
   WHERE b.id = p_board;
$$;
REVOKE ALL ON FUNCTION public.board_topic(uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.board_topic(uuid, boolean, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.board_topic_readable(p_topic text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_board UUID;
  v_folder UUID;
  v_name TEXT;
BEGIN
  IF p_topic IS NULL OR split_part(p_topic, ':', 1) <> 'moth'
     OR split_part(p_topic, ':', 2) NOT IN ('board', 'board-live')
     OR split_part(p_topic, ':', 5) <> '' THEN
    RETURN false;
  END IF;
  v_board := public.fn_try_uuid(split_part(p_topic, ':', 3));
  IF v_board IS NULL THEN
    RETURN false;
  END IF;
  SELECT b.folder_id, COALESCE(p.topic_epoch, 0)::text || '.' || b.audience_gen::text INTO v_folder, v_name
    FROM public.boards b JOIN public.projects p ON p.id = b.project_id
   WHERE b.id = v_board AND b.workspace_id = public.current_workspace_id();
  RETURN v_folder IS NOT NULL
     AND split_part(p_topic, ':', 4) = v_name
     AND COALESCE(public.moth_can_read_target('folder', v_folder), false);
END;
$$;
REVOKE ALL ON FUNCTION public.board_topic_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.board_topic_readable(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.board_channels(p_board uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_b public.boards%ROWTYPE := rabbit_private.board_for(p_board, false);
BEGIN
  IF v_b.id IS NULL THEN
    RAISE EXCEPTION 'board not found' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('topic', public.board_topic(v_b.id, false), 'live_topic', public.board_topic(v_b.id, true),
                            'audience_gen', v_b.audience_gen);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.board_channels(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.board_channels(uuid) TO authenticated;

-- §2 The channels' policies ----------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'realtime' AND tablename = 'messages') THEN
    RAISE NOTICE '0132: realtime.messages absent — the board channels'' policies are not made (expected in db-only CI stack)';
    RETURN;
  END IF;
  EXECUTE 'DROP POLICY IF EXISTS moth_board_topic_read ON realtime.messages';
  EXECUTE $pol$
    CREATE POLICY moth_board_topic_read ON realtime.messages
      FOR SELECT TO authenticated
      USING (
        realtime.messages.extension IN ('broadcast', 'presence')
        AND realtime.topic() LIKE 'moth:board%'
        AND public.board_topic_readable(realtime.topic())
      )
  $pol$;
  EXECUTE 'DROP POLICY IF EXISTS moth_board_live_write ON realtime.messages';
  EXECUTE $pol$
    CREATE POLICY moth_board_live_write ON realtime.messages
      FOR INSERT TO authenticated
      WITH CHECK (
        realtime.messages.extension IN ('broadcast', 'presence')
        AND realtime.topic() LIKE 'moth:board-live:%'
        AND public.board_topic_readable(realtime.topic())
      )
  $pol$;
END $$;

-- §3 Element saves, one message a statement ---------------------------------------
-- What a message carries of an element: its placement, style and words; never a file's id (has_file says one is
-- placed), never a pen's points past 4 KB (points_omitted: read it through board_read).
CREATE OR REPLACE FUNCTION rabbit_private.board_element_wire(e public.board_elements)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', e.id, 'kind', e.kind, 'shape', e.shape, 'x', e.x, 'y', e.y, 'w', e.w, 'h', e.h, 'rotation', e.rotation,
    'z', e.z, 'style', e.style, 'body', CASE WHEN e.bytes <= 4096 THEN e.body END,
    'points', CASE WHEN e.bytes <= 4096 THEN e.points END,
    'points_omitted', e.bytes > 4096,
    'has_file', e.kind IN ('sticky', 'media', 'embed'),
    'from_id', e.from_id, 'from_anchor', e.from_anchor, 'to_id', e.to_id, 'to_anchor', e.to_anchor,
    'version', e.version, 'updated_by', e.updated_by);
$$;
REVOKE EXECUTE ON FUNCTION rabbit_private.board_element_wire(public.board_elements) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION rabbit_private.board_realtime_ready()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'realtime' AND p.proname = 'send');
$$;
REVOKE EXECUTE ON FUNCTION rabbit_private.board_realtime_ready() FROM PUBLIC, anon, authenticated;

-- A writer's one message a save (0130's board_put_elements and board_delete_elements call it once, at their end).
CREATE OR REPLACE FUNCTION rabbit_private.board_announce(p_board uuid, p_op text, p_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  IF NOT rabbit_private.board_realtime_ready() OR p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN;
  END IF;
  IF p_op = 'remove' THEN
    FOR r IN
      SELECT g.chunk, jsonb_agg(to_jsonb(g.id) ORDER BY g.id) AS ids
        FROM (SELECT x AS id, (row_number() OVER (ORDER BY x) - 1) / 200 AS chunk FROM unnest(p_ids) x) g
       GROUP BY g.chunk
    LOOP
      PERFORM realtime.send(jsonb_build_object('board', p_board, 'op', 'remove', 'ids', r.ids),
                            'elements', public.board_topic(p_board, false), true);
    END LOOP;
    RETURN;
  END IF;
  FOR r IN
    SELECT g.chunk, jsonb_agg(rabbit_private.board_element_wire(g.e) ORDER BY (g.e).id) AS els
      FROM (SELECT e, (row_number() OVER (ORDER BY e.id) - 1) / 25 AS chunk
              FROM public.board_elements e WHERE e.board_id = p_board AND e.id = ANY (p_ids)) g
     GROUP BY g.chunk
  LOOP
    PERFORM realtime.send(jsonb_build_object('board', p_board, 'op', 'put', 'elements', r.els),
                          'elements', public.board_topic(p_board, false), true);
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION rabbit_private.board_announce(uuid, text, uuid[]) FROM PUBLIC, anon, authenticated;

-- Everything else that changes elements (a key's own action: a placed file gone, a connector's end gone, a board
-- following its folder) says so once a statement; a writer's open batch says it itself.
CREATE OR REPLACE FUNCTION public.fn_board_elements_broadcast()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  IF NOT rabbit_private.board_realtime_ready()
     OR COALESCE(current_setting('wilson.board_batch', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    FOR r IN SELECT c.board_id, array_agg(c.id ORDER BY c.id) AS ids FROM gone c GROUP BY c.board_id LOOP
      -- A board deleted with its elements (its folder purged) has no channel left to tell.
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.boards b WHERE b.id = r.board_id);
      PERFORM rabbit_private.board_announce(r.board_id, 'remove', r.ids);
    END LOOP;
    RETURN NULL;
  END IF;
  FOR r IN SELECT c.board_id, array_agg(c.id ORDER BY c.id) AS ids FROM changed c GROUP BY c.board_id LOOP
    PERFORM rabbit_private.board_announce(r.board_id, 'put', r.ids);
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_board_elements_broadcast() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_board_elements_broadcast_ins ON public.board_elements;
CREATE TRIGGER trg_board_elements_broadcast_ins
  AFTER INSERT ON public.board_elements REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_board_elements_broadcast();
DROP TRIGGER IF EXISTS trg_board_elements_broadcast_upd ON public.board_elements;
CREATE TRIGGER trg_board_elements_broadcast_upd
  AFTER UPDATE ON public.board_elements REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_board_elements_broadcast();
DROP TRIGGER IF EXISTS trg_board_elements_broadcast_del ON public.board_elements;
CREATE TRIGGER trg_board_elements_broadcast_del
  AFTER DELETE ON public.board_elements REFERENCING OLD TABLE AS gone
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_board_elements_broadcast();

-- §4 The audience moves ---------------------------------------------------------
-- A board renamed: AUDIENCE to its old names. Those who may still read rejoin under the new ones (board_channels).
CREATE OR REPLACE FUNCTION public.fn_boards_audience_moved()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT rabbit_private.board_realtime_ready() THEN
    RETURN NULL;
  END IF;
  PERFORM realtime.send(jsonb_build_object('board', OLD.id, 'op', 'audience'), 'AUDIENCE',
                        public.board_topic(OLD.id, false, OLD.audience_gen), true);
  PERFORM realtime.send(jsonb_build_object('board', OLD.id, 'op', 'audience'), 'AUDIENCE',
                        public.board_topic(OLD.id, true, OLD.audience_gen), true);
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_boards_audience_moved() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_boards_audience_moved ON public.boards;
CREATE TRIGGER trg_boards_audience_moved
  AFTER UPDATE OF audience_gen ON public.boards
  FOR EACH ROW WHEN (NEW.audience_gen IS DISTINCT FROM OLD.audience_gen)
  EXECUTE FUNCTION public.fn_boards_audience_moved();

-- A project's epoch moved (a privacy flip, 0109): its boards' old names hear AUDIENCE too. The topic carries the
-- epoch, so the new names need nothing here. The epoch moves inside fn_projects_owner_guard, a BEFORE trigger, and
-- a column trigger fires on the UPDATE's own target list only: so any UPDATE, and the WHEN says whether it moved.
CREATE OR REPLACE FUNCTION public.fn_projects_board_epoch_moved()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b RECORD;
BEGIN
  -- A project put in the trash narrows its boards' audience to nobody: renamed, as any narrowing.
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE public.boards x SET audience_gen = x.audience_gen + 1 WHERE x.project_id = NEW.id;
  END IF;
  IF NOT rabbit_private.board_realtime_ready() OR NEW.topic_epoch IS NOT DISTINCT FROM OLD.topic_epoch THEN
    RETURN NULL;
  END IF;
  FOR b IN SELECT x.id, x.audience_gen FROM public.boards x WHERE x.project_id = NEW.id LOOP
    PERFORM realtime.send(jsonb_build_object('board', b.id, 'op', 'audience'), 'AUDIENCE',
      'moth:board:' || b.id::text || ':' || COALESCE(OLD.topic_epoch, 0)::text || '.' || b.audience_gen::text, true);
    PERFORM realtime.send(jsonb_build_object('board', b.id, 'op', 'audience'), 'AUDIENCE',
      'moth:board-live:' || b.id::text || ':' || COALESCE(OLD.topic_epoch, 0)::text || '.' || b.audience_gen::text, true);
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_projects_board_epoch_moved() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_projects_board_epoch_moved ON public.projects;
CREATE TRIGGER trg_projects_board_epoch_moved
  AFTER UPDATE ON public.projects
  FOR EACH ROW WHEN (NEW.topic_epoch IS DISTINCT FROM OLD.topic_epoch OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at)
  EXECUTE FUNCTION public.fn_projects_board_epoch_moved();

-- A member leaves, is removed or changes role: every board of that company is renamed, because who reads a
-- company's boards may have narrowed (a private project's are its creator's and admins').
CREATE OR REPLACE FUNCTION public.fn_workspace_members_board_audience()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws UUID := COALESCE(OLD.workspace_id, NEW.workspace_id);
BEGIN
  IF TG_OP = 'UPDATE'
     AND NOT ((COALESCE(OLD.is_active, false) AND NOT COALESCE(NEW.is_active, false))
              OR OLD.app_role IS DISTINCT FROM NEW.app_role) THEN
    RETURN NULL;
  END IF;
  UPDATE public.boards b SET audience_gen = b.audience_gen + 1 WHERE b.workspace_id = v_ws;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_workspace_members_board_audience() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_workspace_members_board_audience ON public.workspace_members;
CREATE TRIGGER trg_workspace_members_board_audience
  AFTER UPDATE OF is_active, app_role OR DELETE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.fn_workspace_members_board_audience();

-- §5 Post-conditions ------------------------------------------------------------
DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.board_topic(uuid,boolean,integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.board_topic_readable(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.board_channels(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.board_channels(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0132 post-condition: the channel functions'' grants are not as written';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'realtime' AND tablename = 'messages') THEN
    IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages'
          AND policyname IN ('moth_board_topic_read', 'moth_board_live_write')) <> 2 THEN
      RAISE EXCEPTION '0132 post-condition: the board channels'' two policies are not there';
    END IF;
    -- No policy lets a client send on the database's own channel.
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages' AND cmd IN ('INSERT', 'ALL')
                AND COALESCE(with_check, qual, '') ~ 'moth:board:') THEN
      RAISE EXCEPTION '0132 post-condition: a client may send on a board''s database channel';
    END IF;
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
        ('trg_board_elements_broadcast_ins', 'trg_board_elements_broadcast_upd', 'trg_board_elements_broadcast_del',
         'trg_boards_audience_moved', 'trg_projects_board_epoch_moved', 'trg_workspace_members_board_audience')) <> 6 THEN
    RAISE EXCEPTION '0132 post-condition: the six triggers are not all there';
  END IF;
END $$;
