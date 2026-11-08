-- =============================================================================
-- 0133_sticky_locks.sql — M.O.T.H. Session 4 (MO4): a sticky's soft lock, and the one path that saves its words.
-- (Her ruling, the brief §7.4 and §12: "while someone types in a sticky it shows their name and a soft glow, and
--  nobody else can edit it until they click away. The lock must release on its own if that person disconnects";
--  MOTH_DESIGN §2.5 "sticky_locks"; PLAN_MOTH §5 Session 4, build step 9.)
--
-- A sticky is a markdown file in the board's folder (0130). Its words change only by a new body: an object is never
-- written over (thumbnails.js), so saving a sticky is a fresh object and the file's key moved to it.
--
-- WHAT THIS CHANGES
-- -----------------
--   §1  sticky_locks: one row a sticky being written in: who, which of their windows (a session id the client makes),
--       a fencing number from one sequence (never reused, so a holder whose turn ended can never match a new one),
--       and when it ends by the database's clock (30 seconds unless renewed). Row security forced, no policy, no
--       client grant: only §2's functions read or write it.
--   §2  sticky_claim(element, session): the turn, if nobody else holds a live one (the holder's same window renews
--       it); else who holds it, for the name and the glow. sticky_renew(element, number), sticky_release(element,
--       number): the holder's own. sticky_status(board): the live turns on a board, for a reader. A claim and a
--       release say so on the board's channel (0132), for the glow, and so does each renewal (every 10 seconds or so
--       while the holder types), so the glow lasts as long as the typing; a turn that runs out says nothing.
--   §3  board_sticky_publish(element, number, from, to): the sticky's words saved, only by the holder of the current
--       turn, only over the key it read (else false, as rekey_file_body's compare-and-set), to a fresh key the server
--       admits for the file's own project (file_key_admissible), on Petal's storage or a company's Local Server; a
--       company's own bucket waits ('s3_sticky_off'), as its moves do (0120). The board's channel hears 'body'.
--   §4  rekey_file_body (restated from 0114's body) refuses a sticky's file while it is on its board (one whose file
--       has left the board's folder is edited where it is now). Two paths still reach a sticky's object without the
--       turn, recorded in OUTSTANDING (MO4): a client's storage UPDATE of the object at its key (0115's update arm),
--       and a move between projects whose copy replaces the key at its commit (fn_moth_apply_moves).
--
-- One transaction, re-runnable, no enum. Suite 138_sticky_locks.sql; RLS_TABLES gains sticky_locks; 115 affected.
-- =============================================================================

SET LOCAL lock_timeout = '5s';

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
BEGIN
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0133 refused: % does not bypass row security', current_user;
  END IF;
  IF to_regprocedure('public.board_channels(uuid)') IS NULL THEN
    RAISE EXCEPTION '0133 refused: 0132 must be applied first';
  END IF;
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc
       WHERE oid = 'public.rekey_file_body(uuid,text,text,text,text,boolean)'::regprocedure)
       NOT IN ('96a2b17b088ab21e9158d930ecf2ac35', '784be073aef07c326f7211efbb45de8a') THEN
    RAISE EXCEPTION '0133 refused: rekey_file_body is neither 0114''s nor this file''s';
  END IF;
  IF to_regclass('public.sticky_locks') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.sticky_locks')
                      AND conname = 'sticky_locks_element_fk') THEN
    RAISE EXCEPTION '0133 refused: a table public.sticky_locks exists that this file did not make';
  END IF;
END $$;

-- §1 sticky_locks -----------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.sticky_lock_generation_seq;
REVOKE ALL ON SEQUENCE public.sticky_lock_generation_seq FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.sticky_locks (
  element_id     UUID PRIMARY KEY,
  board_id       UUID NOT NULL,
  workspace_id   UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  holder         UUID NOT NULL,
  holder_session TEXT NOT NULL,
  generation     BIGINT NOT NULL,
  claimed_at     TIMESTAMPTZ NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  CONSTRAINT sticky_locks_element_fk FOREIGN KEY (element_id, board_id)
    REFERENCES public.board_elements (id, board_id) ON DELETE CASCADE,
  CONSTRAINT sticky_locks_session_chk CHECK (holder_session ~ '^[A-Za-z0-9_-]{8,64}$'),
  CONSTRAINT sticky_locks_window_chk CHECK (expires_at > claimed_at)
);
CREATE INDEX IF NOT EXISTS sticky_locks_board_idx ON public.sticky_locks (board_id, expires_at);
ALTER TABLE public.sticky_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sticky_locks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.sticky_locks FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.sticky_locks TO service_role;
COMMENT ON TABLE public.sticky_locks IS
  '0133: one row a sticky being written in: the holder, their window, a fencing number (sticky_lock_generation_seq) and '
  'its end by the database clock. No client grant and no policy: sticky_claim, sticky_renew, sticky_release, '
  'sticky_status and board_sticky_publish are its only readers and writers.';

-- §2 The turn ---------------------------------------------------------------------

-- A sticky the caller may write, with its board, or nothing (one refusal for all).
CREATE OR REPLACE FUNCTION rabbit_private.sticky_for(p_element uuid)
RETURNS public.board_elements
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_e public.board_elements%ROWTYPE;
  v_b public.boards%ROWTYPE;
BEGIN
  SELECT * INTO v_e FROM public.board_elements e
   WHERE e.id = p_element AND e.kind = 'sticky' AND e.workspace_id = public.current_workspace_id();
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_b := rabbit_private.board_for(v_e.board_id, true);
  IF v_b.id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN v_e;
END;
$$;
REVOKE EXECUTE ON FUNCTION rabbit_private.sticky_for(uuid) FROM PUBLIC, anon, authenticated;

-- What the board's channel hears of a turn (nothing where realtime is absent).
CREATE OR REPLACE FUNCTION rabbit_private.sticky_say(p_board uuid, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF rabbit_private.board_realtime_ready() THEN
    PERFORM realtime.send(p_payload || jsonb_build_object('board', p_board), 'sticky',
                          public.board_topic(p_board, false), true);
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION rabbit_private.sticky_say(uuid, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION rabbit_private.sticky_holder_label(p_ws uuid, p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(left(COALESCE(NULLIF(btrim(wm.display_name), ''), wm.username), 80), 'Someone')
    FROM public.workspace_members wm WHERE wm.workspace_id = p_ws AND wm.user_id = p_user;
$$;
REVOKE EXECUTE ON FUNCTION rabbit_private.sticky_holder_label(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sticky_claim(p_element uuid, p_session text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_e   public.board_elements%ROWTYPE := rabbit_private.sticky_for(p_element);
  v_l   public.sticky_locks%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_gen BIGINT;
BEGIN
  IF v_e.id IS NULL THEN
    RAISE EXCEPTION 'sticky not found or not writable' USING ERRCODE = '42501';
  END IF;
  IF p_session IS NULL OR p_session !~ '^[A-Za-z0-9_-]{8,64}$' THEN
    RAISE EXCEPTION 'A window names itself with 8 to 64 letters, digits, - or _.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('moth-sticky:' || v_e.id::text, 0));
  SELECT * INTO v_l FROM public.sticky_locks l WHERE l.element_id = v_e.id FOR UPDATE;
  IF FOUND AND v_l.expires_at > v_now
     AND NOT (v_l.holder = auth.uid() AND v_l.holder_session = p_session) THEN
    RETURN jsonb_build_object('granted', false,
      'holder_label', rabbit_private.sticky_holder_label(v_l.workspace_id, v_l.holder),
      'ends_in_ms', ceil(extract(epoch FROM v_l.expires_at - v_now) * 1000)::bigint);
  END IF;
  IF FOUND AND v_l.expires_at > v_now THEN
    UPDATE public.sticky_locks l SET expires_at = v_now + interval '30 seconds' WHERE l.element_id = v_e.id;
    RETURN jsonb_build_object('granted', true, 'generation', v_l.generation, 'ends_in_ms', 30000);
  END IF;
  v_gen := nextval('public.sticky_lock_generation_seq');
  INSERT INTO public.sticky_locks (element_id, board_id, workspace_id, holder, holder_session, generation, claimed_at, expires_at)
  VALUES (v_e.id, v_e.board_id, v_e.workspace_id, auth.uid(), p_session, v_gen, v_now, v_now + interval '30 seconds')
  ON CONFLICT (element_id) DO UPDATE
    SET holder = EXCLUDED.holder, holder_session = EXCLUDED.holder_session, generation = EXCLUDED.generation,
        claimed_at = EXCLUDED.claimed_at, expires_at = EXCLUDED.expires_at;
  PERFORM rabbit_private.sticky_say(v_e.board_id, jsonb_build_object('op', 'lock', 'element', v_e.id,
    'holder_label', rabbit_private.sticky_holder_label(v_e.workspace_id, auth.uid()), 'ends_in_ms', 30000));
  RETURN jsonb_build_object('granted', true, 'generation', v_gen, 'ends_in_ms', 30000);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sticky_claim(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sticky_claim(uuid, text) TO authenticated;

-- The holder keeps their turn while they type: false once it has ended or passed to someone else.
CREATE OR REPLACE FUNCTION public.sticky_renew(p_element uuid, p_generation bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_e   public.board_elements%ROWTYPE := rabbit_private.sticky_for(p_element);
  v_now TIMESTAMPTZ := clock_timestamp();
  v_n   INTEGER;
BEGIN
  IF v_e.id IS NULL THEN
    RAISE EXCEPTION 'sticky not found or not writable' USING ERRCODE = '42501';
  END IF;
  UPDATE public.sticky_locks l SET expires_at = v_now + interval '30 seconds'
   WHERE l.element_id = v_e.id AND l.holder = auth.uid() AND l.generation = p_generation AND l.expires_at > v_now;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 1 THEN
    PERFORM rabbit_private.sticky_say(v_e.board_id, jsonb_build_object('op', 'renew', 'element', v_e.id,
      'holder_label', rabbit_private.sticky_holder_label(v_e.workspace_id, auth.uid()), 'ends_in_ms', 30000));
  END IF;
  RETURN jsonb_build_object('ok', v_n = 1, 'ends_in_ms', CASE WHEN v_n = 1 THEN 30000 ELSE 0 END);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sticky_renew(uuid, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sticky_renew(uuid, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.sticky_release(p_element uuid, p_generation bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_e public.board_elements%ROWTYPE;
  v_n INTEGER;
BEGIN
  -- A holder who may no longer write still lets go of their own turn.
  SELECT * INTO v_e FROM public.board_elements e
   WHERE e.id = p_element AND e.kind = 'sticky' AND e.workspace_id = public.current_workspace_id();
  IF NOT FOUND OR auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  DELETE FROM public.sticky_locks l
   WHERE l.element_id = v_e.id AND l.holder = auth.uid() AND l.generation = p_generation;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 1 THEN
    PERFORM rabbit_private.sticky_say(v_e.board_id, jsonb_build_object('op', 'unlock', 'element', v_e.id));
  END IF;
  RETURN v_n = 1;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sticky_release(uuid, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sticky_release(uuid, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.sticky_status(p_board uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_b   public.boards%ROWTYPE := rabbit_private.board_for(p_board, false);
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF v_b.id IS NULL THEN
    RAISE EXCEPTION 'board not found' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'element', l.element_id, 'holder_label', rabbit_private.sticky_holder_label(l.workspace_id, l.holder),
      'mine', l.holder = auth.uid(), 'ends_in_ms', ceil(extract(epoch FROM l.expires_at - v_now) * 1000)::bigint)
      ORDER BY l.element_id)
    FROM public.sticky_locks l WHERE l.board_id = v_b.id AND l.expires_at > v_now), '[]'::jsonb);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sticky_status(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sticky_status(uuid) TO authenticated;

-- §3 Saving a sticky's words --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.board_sticky_publish(p_element uuid, p_generation bigint, p_from_path text, p_to_path text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_e   public.board_elements%ROWTYPE := rabbit_private.sticky_for(p_element);
  v_f   public.files%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF v_e.id IS NULL OR v_e.file_id IS NULL THEN
    RAISE EXCEPTION 'sticky not found or not writable' USING ERRCODE = '42501';
  END IF;
  -- The turn first: only its holder, only while it lasts, only under the number it was given.
  PERFORM 1 FROM public.sticky_locks l
    WHERE l.element_id = v_e.id AND l.holder = auth.uid() AND l.generation = p_generation AND l.expires_at > v_now
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sticky_turn_ended' USING ERRCODE = 'P0001',
      DETAIL = 'Someone else is writing in this sticky now, or your turn ended: your words were not saved.';
  END IF;
  SELECT * INTO v_f FROM public.files f WHERE f.id = v_e.file_id FOR UPDATE;
  IF FOUND AND v_f.folder_id IS DISTINCT FROM (SELECT b.folder_id FROM public.boards b WHERE b.id = v_e.board_id) THEN
    RAISE EXCEPTION 'This note has left its board: it is edited where it is now.' USING ERRCODE = '22023';
  END IF;
  IF NOT FOUND OR v_f.deleted_at IS NOT NULL
     OR NOT COALESCE(public.moth_can_read_target('file', v_f.id), false)
     OR NOT COALESCE(public.moth_can_write_target('file', v_f.id), false) THEN
    RAISE EXCEPTION 'sticky not found or not writable' USING ERRCODE = '42501';
  END IF;
  IF v_f.storage_provider::text = 's3' THEN
    RAISE EXCEPTION 's3_sticky_off' USING ERRCODE = 'P0001',
      DETAIL = 'A sticky''s words cannot be saved on the company''s own storage yet.';
  END IF;
  IF v_f.storage_provider::text NOT IN ('supabase', 'local_server') THEN
    RAISE EXCEPTION 'sticky not found or not writable' USING ERRCODE = '42501';
  END IF;
  IF v_f.storage_path IS DISTINCT FROM p_from_path THEN
    RETURN false;
  END IF;
  IF p_to_path IS NULL OR p_to_path = v_f.storage_path
     OR NOT COALESCE(rabbit_private.file_key_admissible(
          v_f.storage_provider::text, p_to_path, v_f.project_id, v_f.id, v_f.folder_id, false), false)
     OR public.file_row_is_money(false, p_to_path) THEN
    RAISE EXCEPTION 'That is not a place this sticky''s words can be kept.' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('wilson.body_rekey', 'file:' || v_f.id::text, true);
  UPDATE public.files f SET storage_path = p_to_path, thumbnail_url = NULL WHERE f.id = v_f.id;
  PERFORM set_config('wilson.body_rekey', '', true);
  UPDATE public.sticky_locks l SET expires_at = v_now + interval '30 seconds' WHERE l.element_id = v_e.id;
  PERFORM rabbit_private.sticky_say(v_e.board_id, jsonb_build_object('op', 'body', 'element', v_e.id));
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.board_sticky_publish(uuid, bigint, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.board_sticky_publish(uuid, bigint, text, text) TO authenticated;

-- §4 rekey_file_body refuses a sticky's file ----------------------------------------
CREATE OR REPLACE FUNCTION public.rekey_file_body(
  p_file uuid, p_from_path text, p_to_path text, p_from_thumb text, p_to_thumb text, p_financial boolean DEFAULT false)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_f         public.files%ROWTYPE;
  v_ws        UUID := public.current_workspace_id();
  v_from      TEXT;
  v_to        TEXT;
  v_financial BOOLEAN;
BEGIN
  SELECT * INTO v_f FROM public.files f WHERE f.id = p_file FOR UPDATE;
  IF NOT FOUND
     OR v_ws IS NULL
     OR v_f.workspace_id IS DISTINCT FROM v_ws
     OR v_f.deleted_at IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM public.projects p
                     WHERE p.id = v_f.project_id AND p.workspace_id = v_ws AND p.deleted_at IS NULL)
     OR NOT COALESCE(public.has_active_membership(v_ws), false)
     OR NOT COALESCE(public.passes_project_privacy(v_f.project_id), false)
     OR NOT COALESCE(public.can_write_project(v_f.project_id), false)
     OR lower(split_part(v_f.storage_path, '/', 2)) <> v_f.project_id::text
     OR (public.rabbit_legal_segment(split_part(v_f.storage_path, '/', 3))
         AND NOT COALESCE(public.can_access_project_legal(v_f.project_id), false))
     OR (NOT public.rabbit_legal_segment(split_part(v_f.storage_path, '/', 3))
         AND public.file_row_is_money(v_f.is_financial, v_f.storage_path)
         AND NOT COALESCE(public.can_access_project_money(v_f.project_id), false)) THEN
    RAISE EXCEPTION 'file not found or not writable' USING ERRCODE = '42501';
  END IF;

  -- 0133: a sticky's words, while it is on its board, are saved by board_sticky_publish alone, under its writer's
  -- turn. A sticky's file that has left its board's folder is edited where it is now.
  IF EXISTS (SELECT 1 FROM public.board_elements e JOIN public.boards b ON b.id = e.board_id
              WHERE e.file_id = p_file AND e.kind = 'sticky' AND b.folder_id = v_f.folder_id) THEN
    RAISE EXCEPTION 'A sticky''s words are saved from its board.' USING ERRCODE = '42501';
  END IF;

  IF v_f.storage_path IS DISTINCT FROM p_from_path OR v_f.thumbnail_url IS DISTINCT FROM p_from_thumb THEN
    RETURN false;
  END IF;

  v_financial := COALESCE(v_f.is_financial, false) OR COALESCE(p_financial, false);
  v_from := split_part(v_f.storage_path, '/', 3);
  v_to := split_part(COALESCE(p_to_path, ''), '/', 3);
  IF p_to_path IS DISTINCT FROM v_f.storage_path THEN
    IF v_f.storage_provider::text = 's3'
       OR split_part(COALESCE(p_to_path, ''), '/', 1) <> split_part(v_f.storage_path, '/', 1)
       OR split_part(COALESCE(p_to_path, ''), '/', 2) <> split_part(v_f.storage_path, '/', 2)
       OR public.rabbit_legal_segment(v_from) IS DISTINCT FROM public.rabbit_legal_segment(v_to)
       OR (public.rabbit_money_segment(v_from) AND NOT public.rabbit_money_segment(v_to))
       OR (public.rabbit_money_segment(v_to) AND NOT public.rabbit_legal_segment(v_to)
           AND NOT public.rabbit_money_segment(v_from) AND NOT COALESCE(p_financial, false))
       OR NOT COALESCE(rabbit_private.file_key_admissible(
            v_f.storage_provider::text, p_to_path, v_f.project_id, p_file, v_f.folder_id, v_financial), false) THEN
      RAISE EXCEPTION 'file not found or not writable' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- Money only grows, into an invoices key, and only for someone with money access.
  IF COALESCE(p_financial, false) AND NOT COALESCE(v_f.is_financial, false)
     AND (lower(v_to) <> 'invoices' OR NOT COALESCE(public.can_access_project_money(v_f.project_id), false)) THEN
    RAISE EXCEPTION 'file not found or not writable' USING ERRCODE = '42501';
  END IF;
  -- And its picture goes with it: a money row names no picture outside the gate.
  IF COALESCE(p_financial, false) AND NOT COALESCE(v_f.is_financial, false)
     AND NOT (p_to_thumb IS NULL OR p_to_thumb = p_to_path || '.jpg') THEN
    RAISE EXCEPTION 'file not found or not writable' USING ERRCODE = '42501';
  END IF;
  IF NOT (p_to_thumb IS NOT DISTINCT FROM v_f.thumbnail_url
          OR p_to_thumb IS NULL
          OR p_to_thumb = p_to_path || '.jpg') THEN
    RAISE EXCEPTION 'file not found or not writable' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('wilson.body_rekey', 'file:' || p_file::text, true);
  UPDATE public.files
     SET storage_path = p_to_path, thumbnail_url = p_to_thumb, is_financial = v_financial
   WHERE id = p_file;
  PERFORM set_config('wilson.body_rekey', '', true);
  RETURN true;
END;
$$;

-- §5 Post-conditions --------------------------------------------------------------
DO $$
BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.sticky_locks'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sticky_locks')
     OR EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'sticky_locks'
                 AND grantee IN ('authenticated', 'anon', 'PUBLIC'))
     OR has_sequence_privilege('authenticated', 'public.sticky_lock_generation_seq', 'USAGE') THEN
    RAISE EXCEPTION '0133 post-condition: a client can reach sticky_locks or its numbers';
  END IF;
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc
       WHERE oid = 'public.rekey_file_body(uuid,text,text,text,text,boolean)'::regprocedure) <> '784be073aef07c326f7211efbb45de8a' THEN
    RAISE EXCEPTION '0133 post-condition: rekey_file_body is not this file''s';
  END IF;
  IF has_function_privilege('authenticated', 'rabbit_private.sticky_for(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.board_sticky_publish(uuid,bigint,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.sticky_claim(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '0133 post-condition: the turn functions'' grants are not as written';
  END IF;
END $$;
