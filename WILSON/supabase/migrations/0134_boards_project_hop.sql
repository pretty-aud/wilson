-- =============================================================================
-- 0134_boards_project_hop.sql — M.O.T.H. Session 4 (MO4): the board tables' reads hop through projects.
--
-- 0107's rule for every project-scoped table a client may read (its scan S2, suite 110): each permissive clause
-- reaches projects, so projects_select's privacy arm stands behind it whatever else the clause asks. 0130's two read
-- policies asked only Moth's folder gate (which asks the project's privacy itself), and suite 110 found them on the
-- applied schema. This file restates both from 0130's text with the hop added, and changes nothing else.
--
-- One transaction, re-runnable, no enum. Suites 110, 134 and 135.
-- =============================================================================

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0134 refused: % does not bypass row security', current_user;
  END IF;
  IF to_regclass('public.sticky_locks') IS NULL THEN
    RAISE EXCEPTION '0134 refused: 0133 must be applied first';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('boards', 'board_elements')) <> 2 THEN
    RAISE EXCEPTION '0134 refused: the board tables do not have 0130''s two policies';
  END IF;
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

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('boards', 'board_elements')
        AND qual ~ '(FROM|JOIN) \(?projects [a-z_]+' AND qual ~ 'moth_can_read_target') <> 2 THEN
    RAISE EXCEPTION '0134 post-condition: the two board reads do not both hop through projects and ask the gate';
  END IF;
END $$;
