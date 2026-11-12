-- =============================================================================
-- 0134_boards_project_hop.sql — M.O.T.H. Session 4 (MO4): the board tables' reads hop through projects.
--
-- 0107's rule for every project-scoped table a client may read (its scan S2, suite 110): each permissive clause
-- reaches projects, so projects_select's privacy arm stands behind it whatever else the clause asks. 0130's two read
-- policies asked only Moth's folder gate (which asks the project's privacy itself), and suite 110 found them on the
-- applied schema. This file restates both from 0130's text with the hop added, and changes nothing else.
--
-- This file is not the one that records a board in moth_history, edit_history or the takeout, though 0130's header
-- names 0134 for it: no file does that yet (OUTSTANDING MO4-14). Nor does any file rename a board's channels when its
-- folder changes project, though 0132's header names 0134 for it: nothing allows that change today.
--
-- Re-run after any replay of 0130 (its policy section restates both reads without the hop).
--
-- One transaction, re-runnable, no enum. Suites 110, 134 and 135.
-- =============================================================================

SET LOCAL lock_timeout = '5s';

-- How Postgres prints a policy (pg_policies.qual). The text is deparsed, not what was written: each clause is in
-- parentheses, a string literal carries its cast ('folder'::text), a subquery runs over several lines, and a table
-- or function is written with its schema only when it is not on the search path (so "projects" here, and
-- "public.projects" from a session without public on its path). Every pattern below is a loose match on a short,
-- telling piece of that text, with the schema optional, and never on the whole clause. The counts are what pin the
-- shape: an OR (which could widen either policy), another gate or another subquery changes one of them.
--   hop:         '(FROM|JOIN) \(?(public\.)?projects [a-z_]+'  a subquery over projects with an alias. Suite 110's S2
--                and 0107 match the same thing without the optional schema; this is no stricter than they are.
--   workspace:   'workspace_id = (public\.)?current_workspace_id\(\)'
--   folder gate: 'moth_can_read_target\(''folder'''  the gate asked of a folder, whatever the cast prints.
--   file gate:   'moth_can_read_target\(''file'''
--   board:       'FROM (public\.)?boards b'  board_elements' subquery over its board.
-- boards_select:         one gate (the folder's), no OR, and one EXISTS with the hop or none without it.
-- board_elements_select: two gates (the board's folder and the file), one OR (a row with no file), the board's
--                        subquery, and two EXISTS with the hop or one without it.
DO $$
DECLARE
  r     RECORD;
  v_hop BOOLEAN;
BEGIN
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0134 refused: % does not bypass row security', current_user;
  END IF;
  IF to_regclass('public.sticky_locks') IS NULL THEN
    RAISE EXCEPTION '0134 refused: 0133 must be applied first';
  END IF;
  -- Exactly the two policies, by name, and nothing else on either table.
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('boards', 'board_elements')) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'boards' AND policyname = 'boards_select')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'board_elements'
                       AND policyname = 'board_elements_select') THEN
    RAISE EXCEPTION '0134 refused: the board tables do not have exactly boards_select and board_elements_select';
  END IF;
  -- Each one still 0130's (no hop) or already this file's (a re-run), and nothing else.
  FOR r IN SELECT tablename, cmd, permissive, roles, qual, with_check FROM pg_policies
            WHERE schemaname = 'public' AND tablename IN ('boards', 'board_elements') LOOP
    v_hop := r.qual ~ '(FROM|JOIN) \(?(public\.)?projects [a-z_]+';
    IF r.cmd <> 'SELECT' OR r.permissive <> 'PERMISSIVE' OR r.roles <> ARRAY['authenticated']::name[]
       OR r.with_check IS NOT NULL OR r.qual IS NULL
       OR r.qual !~ 'workspace_id = (public\.)?current_workspace_id\(\)'
       OR regexp_count(r.qual, 'moth_can_read_target\(''folder''') <> 1
       OR (r.tablename = 'boards'
           AND (regexp_count(r.qual, 'moth_can_read_target') <> 1 OR regexp_count(r.qual, ' OR ') <> 0
                OR regexp_count(r.qual, 'EXISTS') <> CASE WHEN v_hop THEN 1 ELSE 0 END))
       OR (r.tablename = 'board_elements'
           AND (regexp_count(r.qual, 'moth_can_read_target') <> 2 OR regexp_count(r.qual, 'moth_can_read_target\(''file''') <> 1
                OR regexp_count(r.qual, ' OR ') <> 1 OR r.qual !~ 'FROM (public\.)?boards b'
                OR regexp_count(r.qual, 'EXISTS') <> CASE WHEN v_hop THEN 2 ELSE 1 END)) THEN
      RAISE EXCEPTION '0134 refused: the read policy on % is neither 0130''s nor this file''s', r.tablename;
    END IF;
  END LOOP;
END $$;

DROP POLICY IF EXISTS boards_select ON public.boards;
CREATE POLICY boards_select ON public.boards
  FOR SELECT TO authenticated
  USING (workspace_id = public.current_workspace_id()
         AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = boards.project_id)
         AND public.moth_can_read_target('folder', folder_id));

DROP POLICY IF EXISTS board_elements_select ON public.board_elements;
CREATE POLICY board_elements_select ON public.board_elements
  FOR SELECT TO authenticated
  USING (workspace_id = public.current_workspace_id()
         AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = board_elements.project_id)
         AND EXISTS (SELECT 1 FROM public.boards b
                      WHERE b.id = board_elements.board_id
                        AND public.moth_can_read_target('folder', b.folder_id))
         AND (file_id IS NULL OR public.moth_can_read_target('file', file_id)));

-- The same patterns as the pre-flight, with the hop now required of both.
DO $$
DECLARE
  r RECORD;
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('boards', 'board_elements')) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'boards' AND policyname = 'boards_select')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'board_elements'
                       AND policyname = 'board_elements_select') THEN
    RAISE EXCEPTION '0134 post-condition: the board tables do not have exactly boards_select and board_elements_select';
  END IF;
  FOR r IN SELECT tablename, cmd, permissive, roles, qual, with_check FROM pg_policies
            WHERE schemaname = 'public' AND tablename IN ('boards', 'board_elements') LOOP
    IF r.cmd <> 'SELECT' OR r.permissive <> 'PERMISSIVE' OR r.roles <> ARRAY['authenticated']::name[]
       OR r.with_check IS NOT NULL OR r.qual IS NULL
       OR r.qual !~ '(FROM|JOIN) \(?(public\.)?projects [a-z_]+'
       OR r.qual !~ 'workspace_id = (public\.)?current_workspace_id\(\)'
       OR regexp_count(r.qual, 'moth_can_read_target\(''folder''') <> 1
       OR (r.tablename = 'boards'
           AND (regexp_count(r.qual, 'moth_can_read_target') <> 1 OR regexp_count(r.qual, ' OR ') <> 0
                OR regexp_count(r.qual, 'EXISTS') <> 1))
       OR (r.tablename = 'board_elements'
           AND (regexp_count(r.qual, 'moth_can_read_target') <> 2 OR regexp_count(r.qual, 'moth_can_read_target\(''file''') <> 1
                OR regexp_count(r.qual, ' OR ') <> 1 OR r.qual !~ 'FROM (public\.)?boards b'
                OR regexp_count(r.qual, 'EXISTS') <> 2)) THEN
      RAISE EXCEPTION '0134 post-condition: the read policy on % does not hop through projects and ask its gates', r.tablename;
    END IF;
  END LOOP;
END $$;
