-- =============================================================================
-- 0072_private_projects.sql — Demo 2026-09-11: private projects.
--
-- Audrey, 2026-09-11, verbatim: "all databases need to live in the supabase
-- storage at all times. the only thing local storage should be related to
-- is just the media files and asset of the project. … lets also just give
-- users the ability to setup private projects for themselves."
--
-- A PRIVATE project is a cloud project row like any other, visible to its
-- creator (and to a workspace admin — the escape hatch every per-user thing
-- here keeps, 0017 notes aside) and to nobody else. Its media lives on the
-- creator's own computer (files.storage_provider = 'local_server', the
-- desktop's local media root — electron/localMedia.cjs), which is WHY it
-- cannot be shared: the bodies are not reachable from anywhere else. The
-- row-level privacy makes the model honest — a teammate never sees a
-- project whose files they could not open.
--
-- Mechanism: ONE column and ONE policy. projects_select (0020's three
-- conditions, verbatim) gains a fourth arm. Every child table's SELECT
-- policy already hops through `EXISTS (SELECT 1 FROM public.projects p …)`
-- under the caller's RLS (0014's live-parent rule), so files, assets, tasks,
-- scenes, shots, folders and the rest of a private project disappear for
-- everyone else WITHOUT a policy change of their own; the realtime topic
-- gate (0016, SECURITY INVOKER over projects_select) follows the same way.
--
-- created_by is stamped by fn_audit_touch (0001) on every INSERT, so the
-- owner is the inserting caller by construction — no client can name
-- somebody else as the owner of a private project.
--
-- Reserved number: 0072 (DEMO_2026-09-11_PLAN.md §5, "0072 is free").
-- pgTAP: supabase/tests/rls/80_private_projects.sql.
-- =============================================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.projects.is_private IS
  'Demo 2026-09-11: a private project is visible to its creator (created_by) and to workspace admins only; every child row follows through the live-parent hop in its own SELECT policy. Its media is kept on the creator''s computer (files.storage_provider = ''local_server''), which is why it cannot be shared.';

-- The owner's own list is the hot path; keep it cheap without widening the
-- workspace index for everyone.
CREATE INDEX IF NOT EXISTS projects_private_owner_idx
  ON public.projects (workspace_id, created_by)
  WHERE is_private;

-- 0020's projects_select, verbatim, plus the privacy arm.
DROP POLICY IF EXISTS projects_select ON public.projects;
CREATE POLICY projects_select ON public.projects
  FOR SELECT USING (
    deleted_at IS NULL
    AND workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (
      NOT is_private
      OR created_by = auth.uid()
      OR public.current_app_role() = 'admin'
    )
  );

-- ── Post-conditions ─────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'is_private'
  ) THEN
    RAISE EXCEPTION '0072 post-condition failed: projects.is_private is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'projects' AND policyname = 'projects_select'
       AND position('is_private' IN qual) > 0
  ) THEN
    RAISE EXCEPTION '0072 post-condition failed: projects_select does not read is_private';
  END IF;
END $$;
