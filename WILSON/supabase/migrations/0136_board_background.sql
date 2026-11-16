-- =============================================================================
-- 0136_board_background.sql, M.O.T.H. Session 4 (MO4): a board's background.
--
-- A board is drawn on one of three backgrounds: a dotted grid, nothing, or a grid of lines like graph paper. The
-- background belongs to the board, so everyone who opens it sees the same one, and whoever may change the board may
-- change it. A new board starts on the dotted grid. Changing it is not an element's change: the board's revision
-- (which counts element changes) and its audience generation stay where they are.
--
-- WHAT THIS CHANGES
-- -----------------
--   §1  boards.background: 'dots', 'blank' or 'lines', 'dots' when not named (a constant default: no rewrite of the
--       table, a moment's ACCESS EXCLUSIVE lock), held to the three by boards_background_chk. A client still never
--       writes a board row: the column has no grant beyond 0130's SELECT. boards.background_version: a number that
--       goes up by one with each change of the background (0 on a new board, boards_background_version_chk keeps it
--       at 0 or more). The answer, the channel's message and a read reach a window in no fixed order; each carries
--       the number, and a window keeps the highest, so it never draws an older choice over a newer one.
--   §2  board_set_background(board, background): for a writer of the board through Moth's gate, with 0130's one
--       refusal for a board not found or not writable. An unchanged value writes nothing and says nothing, and
--       answers the row's current version; a change stamps who and when, moves the version by one, and sends one
--       'board' message with the background and its version on the board's database channel (0132), where realtime
--       is present.
--   §3  board_read (restated from 0130's text): the board object gains its background and its version, and nothing
--       else changes.
--   §4  trg_boards_background_version: the version never goes down, whoever writes the row (0130's guard does the
--       same for revision and audience_gen, and is not restated).
--
-- Re-run after any replay of 0130, and re-run 0134 FIRST: 0130's replay restates board_read without the background
-- and also takes back 0134's two reads (the hop through projects), which this file's pre-flight asks for.
--
-- Not in this file: history and the takeout (boards are in neither yet: OUTSTANDING MO4-14).
--
-- One transaction, re-runnable, no enum. Suites 134 and 137.
-- =============================================================================

SET LOCAL lock_timeout = '5s';

-- §0 Pre-flight -----------------------------------------------------------------
DO $$
BEGIN
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0136 refused: % does not bypass row security', current_user;
  END IF;
  -- 0135 is applied: the files' trash guard holds its arm for a batch whose folder is gone.
  IF NOT EXISTS (SELECT 1 FROM pg_proc
                  WHERE oid = to_regprocedure('public.fn_files_folder_trash_guard()')
                    AND prosrc LIKE '%NEW.trash_batch := NULL;%') THEN
    RAISE EXCEPTION '0136 refused: 0135 must be applied first';
  END IF;
  -- 0134 is applied: the board tables' two reads, by name, each hopping through projects.
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('boards', 'board_elements')) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'boards'
                       AND policyname = 'boards_select'
                       AND qual ~ '(FROM|JOIN) \(?(public\.)?projects [a-z_]+')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'board_elements'
                       AND policyname = 'board_elements_select'
                       AND qual ~ '(FROM|JOIN) \(?(public\.)?projects [a-z_]+') THEN
    RAISE EXCEPTION '0136 refused: the board tables'' reads are not 0134''s';
  END IF;
  -- What this file calls (0130, 0132).
  IF to_regprocedure('rabbit_private.board_for(uuid,boolean)') IS NULL
     OR to_regprocedure('public.board_topic(uuid,boolean,integer)') IS NULL
     OR to_regprocedure('rabbit_private.board_realtime_ready()') IS NULL THEN
    RAISE EXCEPTION '0136 refused: the board functions of 0130 and 0132 are missing';
  END IF;
  -- The body this restates, as 0130 left it, or as this file leaves it on a second run.
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.board_read(uuid,jsonb)'::regprocedure)
       NOT IN ('7135d1c611e54603a14bfcb590305e1a', '3042ffac01c8f09ba7c03607d2e25fc0') THEN
    RAISE EXCEPTION '0136 refused: board_read is neither 0130''s nor this file''s';
  END IF;
  -- A second run finds this file's own columns; one of these names without this file's check is not ours.
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.boards'::regclass AND attname = 'background'
              AND NOT attisdropped)
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.boards'::regclass
                      AND conname = 'boards_background_chk' AND contype = 'c') THEN
    RAISE EXCEPTION '0136 refused: a column boards.background exists that this file did not make';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.boards'::regclass AND attname = 'background_version'
              AND NOT attisdropped)
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.boards'::regclass
                      AND conname = 'boards_background_version_chk' AND contype = 'c') THEN
    RAISE EXCEPTION '0136 refused: a column boards.background_version exists that this file did not make';
  END IF;
END $$;

-- §1 boards.background and boards.background_version ------------------------------
-- Each added only when it is absent, so a second run never meets a check's name twice, and a database that has one
-- of the two still ends with both.
DO $$
DECLARE
  v_bg  BOOLEAN := EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.boards'::regclass
                            AND attname = 'background' AND NOT attisdropped);
  v_ver BOOLEAN := EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.boards'::regclass
                            AND attname = 'background_version' AND NOT attisdropped);
BEGIN
  IF NOT v_bg AND NOT v_ver THEN
    ALTER TABLE public.boards
      ADD COLUMN background TEXT NOT NULL DEFAULT 'dots'
        CONSTRAINT boards_background_chk CHECK (background IN ('dots', 'blank', 'lines')),
      ADD COLUMN background_version BIGINT NOT NULL DEFAULT 0
        CONSTRAINT boards_background_version_chk CHECK (background_version >= 0);
  ELSIF NOT v_bg THEN
    ALTER TABLE public.boards ADD COLUMN background TEXT NOT NULL DEFAULT 'dots'
      CONSTRAINT boards_background_chk CHECK (background IN ('dots', 'blank', 'lines'));
  ELSIF NOT v_ver THEN
    ALTER TABLE public.boards ADD COLUMN background_version BIGINT NOT NULL DEFAULT 0
      CONSTRAINT boards_background_version_chk CHECK (background_version >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.boards.background IS
  '0136: what the board is drawn on, the same for everyone who opens it: ''dots'' (a dotted grid, a new board''s), '
  '''blank'' or ''lines'' (a grid of lines). Changed only through board_set_background, by a writer of the board; '
  'it moves neither revision nor audience_gen.';
COMMENT ON COLUMN public.boards.background_version IS
  '0136: the order of a board''s background changes, one more with each (0 on a new board). The answer, the '
  'channel''s message and board_read each carry it, so a window keeps the highest and never draws an older choice '
  'over a newer one. Moved by board_set_background; trg_boards_background_version keeps it from going down.';

-- §2 board_set_background -----------------------------------------------------------
-- A board's background, set by a writer of the board. The same value again writes nothing and says nothing; every
-- answer and message carries the background's version.
CREATE OR REPLACE FUNCTION public.board_set_background(p_board uuid, p_background text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_b       public.boards%ROWTYPE := rabbit_private.board_for(p_board, true);
  v_version BIGINT;
BEGIN
  IF v_b.id IS NULL THEN
    RAISE EXCEPTION 'board not found or not writable' USING ERRCODE = '42501';
  END IF;
  IF p_background IS NULL OR p_background NOT IN ('dots', 'blank', 'lines') THEN
    RAISE EXCEPTION 'A board''s background is dotted, blank or lined.' USING ERRCODE = '22023';
  END IF;
  -- In order with the board's other saves, and asked again under the lock, so a trash, a move or a member's
  -- removal this change waited behind is counted.
  PERFORM 1 FROM public.boards b WHERE b.id = v_b.id FOR NO KEY UPDATE;
  v_b := rabbit_private.board_for(p_board, true);
  IF v_b.id IS NULL THEN
    RAISE EXCEPTION 'board not found or not writable' USING ERRCODE = '42501';
  END IF;
  IF v_b.background = p_background THEN
    RETURN jsonb_build_object('board_id', v_b.id, 'background', v_b.background, 'version', v_b.background_version,
                              'changed', false);
  END IF;
  -- Not an element's change: revision and audience_gen stay. The version moves by one, in the same statement.
  UPDATE public.boards b SET background = p_background, background_version = b.background_version + 1,
                             updated_at = now(), updated_by = auth.uid()
   WHERE b.id = v_b.id
  RETURNING b.background_version INTO v_version;
  -- One message on the board's own channel, for everyone on the board (nothing where realtime is absent).
  IF rabbit_private.board_realtime_ready() THEN
    PERFORM realtime.send(jsonb_build_object('board', v_b.id, 'op', 'background', 'background', p_background,
                                             'version', v_version),
                          'board', public.board_topic(v_b.id, false), true);
  END IF;
  RETURN jsonb_build_object('board_id', v_b.id, 'background', p_background, 'version', v_version, 'changed', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.board_set_background(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.board_set_background(uuid, text) TO authenticated;

-- §3 board_read, restated from 0130 with the background ------------------------------
-- The board and a page of its elements in stacking order: at most 2,000 elements and 8 MB of points and words a
-- page; 'next' is where the following page starts (null at the end).
CREATE OR REPLACE FUNCTION public.board_read(p_board uuid, p_after jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_b      public.boards%ROWTYPE := rabbit_private.board_for(p_board, false);
  v_label  TEXT;
  v_az     BIGINT := (p_after ->> 'z')::bigint;
  v_aid    UUID := public.fn_try_uuid(p_after ->> 'id');
  v_els    JSONB[] := '{}';
  v_bytes  BIGINT := 0;
  v_size   BIGINT;
  v_lz     BIGINT;
  v_lid    UUID;
  v_next   JSONB := NULL;
  e        public.board_elements%ROWTYPE;
BEGIN
  IF v_b.id IS NULL THEN
    RAISE EXCEPTION 'board not found' USING ERRCODE = '42501';
  END IF;
  IF p_after IS NOT NULL AND (v_az IS NULL OR v_aid IS NULL) THEN
    RAISE EXCEPTION 'A page starts after an element''s z and id.' USING ERRCODE = '22023';
  END IF;
  SELECT fo.label INTO v_label FROM public.folders fo WHERE fo.id = v_b.folder_id;
  FOR e IN SELECT * FROM public.board_elements x
             WHERE x.board_id = v_b.id AND (v_aid IS NULL OR (x.z, x.id) > (v_az, v_aid))
             ORDER BY x.z, x.id LOOP
    v_size := e.bytes + 256;
    IF cardinality(v_els) > 0 AND (cardinality(v_els) >= 2000 OR v_bytes + v_size > 8388608) THEN
      v_next := jsonb_build_object('z', v_lz, 'id', v_lid);
      EXIT;
    END IF;
    v_els := array_append(v_els, rabbit_private.board_element_json(e));
    v_bytes := v_bytes + v_size;
    v_lz := e.z;
    v_lid := e.id;
  END LOOP;
  RETURN jsonb_build_object(
    'board', jsonb_build_object('id', v_b.id, 'folder_id', v_b.folder_id, 'project_id', v_b.project_id,
                                'title', v_label, 'revision', v_b.revision, 'audience_gen', v_b.audience_gen,
                                'background', v_b.background, 'background_version', v_b.background_version,
                                'can_write', COALESCE(public.moth_can_write_target('folder', v_b.folder_id), false)),
    'elements', to_jsonb(v_els), 'next', v_next, 'truncated', v_next IS NOT NULL);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.board_read(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.board_read(uuid, jsonb) TO authenticated;

-- §4 The version only goes up -----------------------------------------------------
-- 0130's guard keeps a board's revision and its audience generation from going down. This does the same for the
-- background's version, without restating that guard: a window keeps the highest version it has heard, so a lower
-- one would be passed over for as long as that window stays open. It reads nothing but the row, so it runs as its
-- caller; it fires when an UPDATE names the column, which board_set_background's does.
CREATE OR REPLACE FUNCTION public.fn_boards_background_version_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.background_version < OLD.background_version THEN
    RAISE EXCEPTION 'A board''s counts only go up.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_boards_background_version_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_boards_background_version ON public.boards;
CREATE TRIGGER trg_boards_background_version
  BEFORE UPDATE OF background_version ON public.boards
  FOR EACH ROW EXECUTE FUNCTION public.fn_boards_background_version_guard();

-- §5 Post-conditions ------------------------------------------------------------
DO $$
BEGIN
  -- The column: text, required, 'dots' when not named.
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                  WHERE a.attrelid = 'public.boards'::regclass AND a.attname = 'background' AND NOT a.attisdropped
                    AND a.atttypid = 'text'::regtype AND a.attnotnull
                    AND pg_get_expr(d.adbin, d.adrelid) = '''dots''::text') THEN
    RAISE EXCEPTION '0136 post-condition: boards.background is not a required text column that starts on dots';
  END IF;
  -- Its check, validated, on that one column, exactly as Postgres prints it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.conrelid = 'public.boards'::regclass AND c.conname = 'boards_background_chk'
                    AND c.contype = 'c' AND c.convalidated
                    AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a
                                           WHERE a.attrelid = 'public.boards'::regclass
                                             AND a.attname = 'background')]::int2[]
                    AND pg_get_constraintdef(c.oid)
                        = 'CHECK ((background = ANY (ARRAY[''dots''::text, ''blank''::text, ''lines''::text])))') THEN
    RAISE EXCEPTION '0136 post-condition: boards_background_chk does not hold a background to the three';
  END IF;
  -- The version: bigint, required, 0 when not named (printed as 0, or as '0'::bigint should a version keep the
  -- cast), and its check, validated, on that one column, keeping it at 0 or more.
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                  WHERE a.attrelid = 'public.boards'::regclass AND a.attname = 'background_version'
                    AND NOT a.attisdropped AND a.atttypid = 'bigint'::regtype AND a.attnotnull
                    AND pg_get_expr(d.adbin, d.adrelid) IN ('0', '''0''::bigint')) THEN
    RAISE EXCEPTION '0136 post-condition: boards.background_version is not a required bigint that starts at 0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.conrelid = 'public.boards'::regclass AND c.conname = 'boards_background_version_chk'
                    AND c.contype = 'c' AND c.convalidated
                    AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a
                                           WHERE a.attrelid = 'public.boards'::regclass
                                             AND a.attname = 'background_version')]::int2[]
                    AND pg_get_constraintdef(c.oid) = 'CHECK ((background_version >= 0))') THEN
    RAISE EXCEPTION '0136 post-condition: boards_background_version_chk does not keep the version at 0 or more';
  END IF;
  -- The version's guard: on the table, enabled, firing before an UPDATE that names the column, and no client's to
  -- call.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'public.boards'::regclass AND t.tgname = 'trg_boards_background_version'
                    AND NOT t.tgisinternal AND t.tgenabled <> 'D'
                    AND t.tgfoid = 'public.fn_boards_background_version_guard()'::regprocedure
                    AND pg_get_triggerdef(t.oid)
                        ~ 'BEFORE UPDATE OF background_version ON public\.boards FOR EACH ROW')
     OR has_function_privilege('authenticated', 'public.fn_boards_background_version_guard()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_boards_background_version_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION '0136 post-condition: the background version''s guard is not on boards as written';
  END IF;
  -- A client still only reads a board table's rows, the new columns included. The column test names PUBLIC as well
  -- (0130's own test left it out) and covers both tables.
  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
              WHERE table_schema = 'public' AND table_name IN ('boards', 'board_elements')
                AND grantee IN ('authenticated', 'anon', 'PUBLIC') AND privilege_type <> 'SELECT')
     OR EXISTS (SELECT 1 FROM information_schema.column_privileges
                 WHERE table_schema = 'public' AND table_name IN ('boards', 'board_elements')
                   AND grantee IN ('authenticated', 'anon', 'PUBLIC') AND privilege_type <> 'SELECT') THEN
    RAISE EXCEPTION '0136 post-condition: a client may do more than read a board table';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.board_set_background(uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.board_set_background(uuid,text)', 'EXECUTE')
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.board_set_background(uuid,text)'::regprocedure)
     OR NOT has_function_privilege('authenticated', 'public.board_read(uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.board_read(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '0136 post-condition: the board functions'' grants are not as written';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.board_read(uuid,jsonb)'::regprocedure
                  AND prosrc LIKE '%''background'', v_b.background,%'
                  AND prosrc LIKE '%''background_version'', v_b.background_version%')
     OR (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc
          WHERE oid = 'public.board_read(uuid,jsonb)'::regprocedure) <> '3042ffac01c8f09ba7c03607d2e25fc0' THEN
    RAISE EXCEPTION '0136 post-condition: board_read is not this file''s';
  END IF;
  -- The board tables' two reads are as 0134 left them: by name, and each hopping through projects.
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('boards', 'board_elements')) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'boards'
                       AND policyname = 'boards_select'
                       AND qual ~ '(FROM|JOIN) \(?(public\.)?projects [a-z_]+')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'board_elements'
                       AND policyname = 'board_elements_select'
                       AND qual ~ '(FROM|JOIN) \(?(public\.)?projects [a-z_]+') THEN
    RAISE EXCEPTION '0136 post-condition: the board tables'' reads are not 0134''s';
  END IF;
END $$;
