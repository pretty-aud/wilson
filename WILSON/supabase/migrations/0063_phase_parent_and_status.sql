-- =============================================================================
-- 0063_phase_parent_and_status.sql — 2026-08-12
--
-- 🚨 THE NEW PHASE DIALOG HAS ALWAYS WRITTEN TWO COLUMNS THAT DO NOT EXIST.
--
-- Audrey, 2026-08-12, creating a phase called "pre pro":
--   [supabase] Could not find the 'parent_phase_id' column of 'phases'
--   in the schema cache
--
-- `public.phases` has looked the same since the RABBIT base schema (0000):
--   id, project_id, name, description, start_date, end_date, sort_order,
--   color, created_at, updated_at  (+ the audit columns added by 0012/0019)
--
-- while TimelineView's phase payload sends:
--   name ✓  description ✓  start_date ✓  end_date ✓
--   parent_phase_id ✗   status ✗
--
-- So creating ANY phase in cloud mode has been impossible. It survived
-- unnoticed because the DESKTOP path stores phases through the generic
-- rabbitSubentityRoutes('phases','phases') JSON route, which has no column
-- schema and therefore accepts both fields silently. The feature works
-- locally and fails only against real Postgres.
--
-- 🚨 POSTGREST NAMES ONLY THE FIRST MISSING COLUMN. Adding parent_phase_id
-- alone would have produced the identical error for `status` on the very next
-- attempt. Both are added here, together, deliberately.
--
-- ── The two decisions, made by Audrey 2026-08-12 ─────────────────────────────
--
-- 1. ON DELETE SET NULL, not CASCADE. Deleting a parent phase leaves its
--    sub-phases alive as TOP-LEVEL phases. Cascade would have silently deleted
--    an entire branch — and every task under it, since tasks cascade from
--    phases — on one wrong click, with no database-level undo.
--
-- 2. `status` is plain TEXT with a default, NOT a CHECK or an enum.
--    This MATCHES ITS NEIGHBOUR: assets.status is `text` with no constraint
--    and no enum (measured on wilson-dev, 2026-08-12). A CHECK here would be
--    stricter than the table it sits beside and would refuse any status the UI
--    adds later until another migration caught up. The nine options remain a
--    DROP-DOWN in the UI — that is where the value set is enforced, and it is
--    unchanged by this migration.
--
-- ⚠️ WHAT THIS DELIBERATELY DOES NOT DO, so nobody assumes it is covered:
--
--   * No deep cycle guard. `CHECK (parent_phase_id <> id)` below stops a phase
--     being its own parent, which is the reachable case from the dropdown. A
--     LONGER cycle (A→B→A) is not prevented at the database level; TimelineView
--     defends against it when flattening the tree. A trigger walking the chain
--     is the real fix if this ever bites.
--   * No cross-project guard. A self-FK cannot see `project_id`, so nothing
--     here stops a phase in project X naming a parent in project Y. The
--     dropdown only offers phases from the current project, so it is not
--     reachable through the UI.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, and the
-- constraint is added only when absent. Safe to re-run.
-- =============================================================================

ALTER TABLE public.phases
  ADD COLUMN IF NOT EXISTS parent_phase_id UUID
    REFERENCES public.phases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'not_started';

COMMENT ON COLUMN public.phases.parent_phase_id IS
  'Optional parent phase — phases form a tree. ON DELETE SET NULL: deleting a '
  'parent promotes its children to top level rather than destroying them.';

COMMENT ON COLUMN public.phases.status IS
  'Phase status. Plain text with a default, matching assets.status. The value '
  'set is enforced by the drop-down in TimelineView, not by the database.';

-- A phase cannot be its own parent. This is the one cycle the dropdown can
-- actually produce, and it is cheap to refuse here.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.phases'::regclass
       AND conname  = 'phases_parent_not_self_chk'
  ) THEN
    ALTER TABLE public.phases
      ADD CONSTRAINT phases_parent_not_self_chk
      CHECK (parent_phase_id IS NULL OR parent_phase_id <> id);
  END IF;
END $$;

-- The tree walk in TimelineView queries children by parent. Partial index:
-- top-level phases (the majority) carry NULL and do not need an entry.
CREATE INDEX IF NOT EXISTS phases_parent_idx
  ON public.phases (parent_phase_id)
  WHERE parent_phase_id IS NOT NULL;

-- 🚨 TELL POSTGREST TO RELOAD. The error Audrey saw was a SCHEMA CACHE miss,
-- not a permission failure: PostgREST answers from a cached picture of the
-- schema and will keep rejecting these columns until it re-reads. Supabase
-- normally reloads on DDL via an event trigger, but this is the one statement
-- that makes the fix take effect immediately rather than whenever that fires.
-- NOTIFY is transactional — it is delivered when this migration commits.
NOTIFY pgrst, 'reload schema';
