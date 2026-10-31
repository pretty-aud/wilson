-- =============================================================================
-- 0019_task_ui_parity.sql  (Session 8)
--
-- Two pre-existing UI/DB mismatches that the Dashboard would have tripped on
-- (both already reachable from RABBIT's own task views in cloud mode):
--
--   1. tasks.notes — TaskDetailPopup has always offered a Notes textarea and
--      saves it as ctx.updateTask(id, { notes }). The column only existed in
--      local_server JSON bundles; in cloud mode the patch failed with
--      PostgREST PGRST204 (column does not exist). Plain TEXT + LWW-per-field
--      is correct here — Yjs stays exclusive to the Notes feature (locked
--      decision #6; this is a short entity field, not long-form content).
--   2. task_priority 'urgent' — every UI priority list is
--      ['low','medium','high','urgent'] but the 0000 enum said 'critical';
--      saving 'urgent' from the priority dropdown or a Dashboard kanban drag
--      onto the Urgent column raised an invalid-enum error. 'critical' stays
--      in the enum (removal would rewrite the type); nothing writes it.
--
-- Edit-history capture (0012) diffs whole rows via to_jsonb, so tasks.notes
-- is picked up automatically — no capture-trigger change needed.
--
-- Idempotent: safe to re-run. (ADD VALUE IF NOT EXISTS is a no-op when the
-- label exists; PG12+ allows it inside a transaction as long as the new
-- label is not used in the same transaction — it is not.)
-- =============================================================================

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';

ALTER TYPE public.task_priority ADD VALUE IF NOT EXISTS 'urgent';

COMMENT ON COLUMN public.tasks.notes IS
  'Session 8: free-text task notes (LWW per field, like description). Previously local-mode-only; TaskDetailPopup writes it in every mode.';
