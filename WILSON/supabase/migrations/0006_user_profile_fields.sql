-- =============================================================================
-- 0006_user_profile_fields.sql
-- Session 2 — profile fields captured by NewUserWelcome.
--
-- These live on workspace_members (not auth.users.user_metadata) because:
--   1. They are per-workspace context: someone may be "she/her, Animator" in
--      one studio and a different title in another.
--   2. Other members of the workspace need to read them for the team UI,
--      which RLS on workspace_members already allows.
--
-- `onboarded_at` is the gate the renderer uses to decide whether to show the
-- welcome wizard on first login. Rows with NULL onboarded_at get routed to
-- the wizard; rows with a value skip it.
-- =============================================================================

ALTER TABLE public.workspace_members
  ADD COLUMN IF NOT EXISTS pronouns     TEXT,
  ADD COLUMN IF NOT EXISTS title        TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url   TEXT,
  ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;

-- Length guards so the welcome form doesn't let users paste novels.
DO $$ BEGIN
  ALTER TABLE public.workspace_members
    ADD CONSTRAINT ws_members_pronouns_chk CHECK (pronouns IS NULL OR char_length(pronouns) <= 40);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.workspace_members
    ADD CONSTRAINT ws_members_title_chk    CHECK (title IS NULL OR char_length(title) <= 80);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Index to power "who hasn't onboarded yet?" admin views (Session 4).
CREATE INDEX IF NOT EXISTS idx_ws_members_pending_onboarding
  ON public.workspace_members (workspace_id)
  WHERE onboarded_at IS NULL AND is_active;
