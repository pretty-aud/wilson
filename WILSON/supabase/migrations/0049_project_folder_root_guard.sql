-- =============================================================================
-- 0049_project_folder_root_guard.sql — Session 35 (the manager half)
--
-- WHY THIS EXISTS
-- ---------------
-- Audrey, 2026-08-05 (NETWORK_STORAGE_DESIGN.md §5a2), verbatim in substance:
--   "admins can set server/drive. managers can set folders within set drive.
--    this stops anyone from breaking it."
-- S34 (0048) built the drive half: workspace_storage.root_path, admin-only.
-- This is the folder half: projects.folder_root — WHO may point it (workspace
-- admin or manager, the 0012/0013 seat) and WHERE it may point (strictly
-- inside the workspace drive).
--
-- Both rules were absent (TPN-NET-015, HIGH):
--   * projects_update admits any caller can_write_project() admits — on an
--     unstaffed project that is EVERY active member, and on a staffed one
--     every member seat. Any of them could repoint folder_root over PostgREST.
--   * No layer checked the value: a project could be pointed at any path,
--     whereupon the desktop builds a folder tree there and uploads write into
--     it. The Express routes gained the same containment this session
--     (folderRootRefusal, main.cjs); per the S34 rule refusals are enforced
--     IN DEPTH, so this guard refuses on its own even for a devtools caller.
--
-- THE SEAT — current_app_role() IN ('admin','manager'), COALESCE'd to FALSE.
-- 🚨 The COALESCE is load-bearing, not tidy (the 0047 lesson, pinned by suite
-- 59's claim-less probe): can_write_project's unstaffed arm ADMITS a caller
-- whose app_role claim is NULL (NULL OR true = true), so such a caller
-- reaches this trigger — and in procedural SQL `IF NOT (NULL = ANY ...)`
-- is IF NULL, which SKIPS the refusal instead of enforcing it.
-- The project seat plays no part, deliberately: where a project's folder sits
-- inside the company drive is workspace storage layout, not project content.
-- Client mirror: canSetProjectFolder (projectRoleMatrix.js).
--
-- THE BOUNDARY — NEW.folder_root must sit strictly inside the workspace's
-- workspace_storage.root_path (mode 'byos'), compared case-folded with a
-- separator boundary (the pathContainment rule: 'C:\foo' cannot claim
-- 'C:\foobar'). No drive configured → no folder to set: "managers set folders
-- WITHIN set drive" has nothing to be within until an admin sets the drive.
-- The path must arrive CANONICAL (backslashes, no trailing separator, no dot
-- segments, no doubled separators, no device namespace) — the client
-- canonicalises (canonicalizeRoot / path.resolve), and non-canonical input is
-- refused rather than repaired, matching 0048's root_canon CHECK.
--
-- What does NOT fire the guard: an UPDATE that leaves folder_root unchanged
-- (IS NOT DISTINCT FROM — adapters echo whole rows, and a member's ordinary
-- edit must not be hostage to a column they cannot touch), and clearing to
-- NULL needs the seat but no boundary (it is a reset to the configured chain).
--
-- Existing rows are untouched: folder_root was NULL on every row of all three
-- environments when this shipped (measured by query, 2026-08-07), and the
-- guard only ever examines a CHANGE.
--
-- Idempotent: safe to re-run.
-- ORDERING: depends on 0048 (workspace_storage) and 0012 (current_app_role).
--   No replay trap: nothing else recreates fn_project_folder_root_guard.
-- pgTAP: 59_project_folder_root.sql (new).
-- =============================================================================

-- ── 1. The guard ─────────────────────────────────────────────────────────────
-- LANGUAGE plpgsql, NOT SECURITY DEFINER — it must run as the caller so its
-- workspace_storage read is scoped by that table's own SELECT policy (an
-- active member of the claimed workspace sees the row; anyone else reads
-- nothing and is refused as "no drive configured").

CREATE OR REPLACE FUNCTION public.fn_project_folder_root_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_root TEXT;
  v_mode TEXT;
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Only a CHANGE is examined. IS NOT DISTINCT FROM, not `=`: a NULL-to-NULL
  -- comparison must count as unchanged, not unknown.
  IF TG_OP = 'UPDATE' AND NEW.folder_root IS NOT DISTINCT FROM OLD.folder_root THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.folder_root IS NULL THEN
    RETURN NEW;
  END IF;

  -- The seat. COALESCE is load-bearing — see header.
  IF NOT COALESCE(public.current_app_role() = ANY (ARRAY['admin','manager']), FALSE) THEN
    RAISE EXCEPTION 'only a workspace admin or manager can set a project folder';
  END IF;

  -- Clearing is a seat-holder's reset to the configured chain; no boundary.
  IF NEW.folder_root IS NULL THEN
    RETURN NEW;
  END IF;

  -- Canonical form (0048 root_canon discipline; the client canonicalises).
  IF NEW.folder_root = '' OR NEW.folder_root <> btrim(NEW.folder_root)
     OR position('/' IN NEW.folder_root) > 0
     OR NEW.folder_root ~ '\\$'
     OR left(NEW.folder_root, 4) IN ('\\?\', '\\.\')
     OR NEW.folder_root ~ '(^|\\)\.{1,2}(\\|$)'
     OR position('\\' IN substring(NEW.folder_root FROM 3)) > 0
  THEN
    RAISE EXCEPTION 'the project folder must be a canonical path — no trailing or doubled separators, no . or .. segments, no forward slashes, no device namespace';
  END IF;

  -- The anchor. COALESCE(NEW.workspace_id, ...) because this BEFORE trigger
  -- fires ahead of trg_projects_populate_workspace (alphabetical order), so
  -- an INSERT may not carry workspace_id yet; the policies later bind the row
  -- to current_workspace_id() anyway, so the coalesced read is the row's
  -- workspace either way.
  SELECT ws.root_path, ws.mode INTO v_root, v_mode
    FROM public.workspace_storage ws
   WHERE ws.workspace_id = COALESCE(NEW.workspace_id, public.current_workspace_id());

  IF v_root IS NULL OR v_mode IS DISTINCT FROM 'byos' THEN
    RAISE EXCEPTION 'no workspace storage drive is configured — an admin sets the drive first (Admin Terminal, Storage)';
  END IF;

  -- Strictly inside: the candidate must extend the drive by a real segment.
  -- left(candidate, len+1) = drive || '\' carries the separator boundary
  -- (a cousin like \\nas\projects2 cannot prefix-match), refuses equality
  -- (too short to produce the trailing separator), and the canonical-form
  -- arm above already refused the dot segments that could escape after a
  -- passing prefix.
  IF lower(left(NEW.folder_root, length(v_root) + 1)) <> lower(v_root) || '\' THEN
    RAISE EXCEPTION 'the project folder must be inside the workspace storage drive (%)', v_root;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_project_folder_root_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_projects_folder_root_guard ON public.projects;
CREATE TRIGGER trg_projects_folder_root_guard
  BEFORE INSERT OR UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_project_folder_root_guard();

COMMENT ON COLUMN public.projects.folder_root IS
  'Where this project''s files live on the customer''s storage (desktop). Guarded by fn_project_folder_root_guard (0049): workspace admin/manager only, strictly inside workspace_storage.root_path (byos). Client mirror: canSetProjectFolder; Express twin: folderRootRefusal (main.cjs).';

-- ── 2. Post-conditions ───────────────────────────────────────────────────────
-- The only check in this change that runs against dev, staging AND prod.

DO $post$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_projects_folder_root_guard'
       AND tgrelid = 'public.projects'::regclass
  ) THEN
    RAISE EXCEPTION '0049 post-condition failed: trg_projects_folder_root_guard is not attached to projects';
  END IF;

  -- The seat must stay NULL-safe (the 0047 lesson) and the boundary must
  -- still read the live store. Check the SPECIFIC seat expression, not a bare
  -- 'COALESCE' — the anchor carries its own COALESCE(NEW.workspace_id, ...),
  -- so a loose match would pass even with the seat COALESCE removed (S35
  -- review). position() rather than a full-text compare so a comment edit
  -- does not trip it.
  IF position('COALESCE(public.current_app_role()' IN pg_get_functiondef('public.fn_project_folder_root_guard()'::regprocedure)) = 0
     OR position('workspace_storage' IN pg_get_functiondef('public.fn_project_folder_root_guard()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '0049 post-condition failed: fn_project_folder_root_guard lost its NULL-safe seat COALESCE or its workspace_storage anchor';
  END IF;

  -- NOT SECURITY DEFINER — the guard's storage read must stay scoped by the
  -- caller's own RLS (0031's precondition for FORCE RLS tables).
  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid = 'public.fn_project_folder_root_guard()'::regprocedure
       AND prosecdef
  ) THEN
    RAISE EXCEPTION '0049 post-condition failed: fn_project_folder_root_guard must not be SECURITY DEFINER';
  END IF;
END
$post$;
