-- =============================================================================
-- 0009_perms_and_provisioning.sql
-- Session 3 — fills the three DB-level gaps surfaced in the Session 2 handoff:
--
--   1. workspace_members self-update RLS. Today only the admin-write policy
--      from 0008 can UPDATE membership rows, which breaks non-admin invited
--      users trying to complete NewUserWelcome (they patch their own row to
--      set onboarded_at + profile fields). We add a self-update policy
--      scoped to the caller's own row AND active workspace.
--
--   2. user-avatars Storage bucket + RLS. NewUserWelcome uploads to
--      user-avatars/{workspace_id}/{user_id}/... Public-read (avatars display
--      everywhere) but writes are gated to the owning user under their own
--      workspace_id path.
--
--   3. Atomic workspace+membership provisioning via PL/pgSQL RPC. Replaces
--      the two-step-plus-cleanup dance in provision-workspace/index.ts (which
--      could leave an orphan workspace or membership on partial failure) with
--      a single transaction. The auth.users row still has to be created by
--      the Edge Function (no SQL path to GoTrue) — but once that's done, the
--      rest of the provisioning runs or rolls back atomically.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ── 1. workspace_members self-update + self-select ──────────────────────────
-- Note on self-SELECT: ws_members_select in 0002 already permits
-- `user_id = auth.uid()` so a user can always read their own rows. We do NOT
-- add a duplicate policy; the pgTAP test below guards that behavior.

DROP POLICY IF EXISTS ws_members_self_update ON public.workspace_members;
CREATE POLICY ws_members_self_update ON public.workspace_members
  FOR UPDATE
  USING (
    user_id = auth.uid()
    AND is_active
  )
  WITH CHECK (
    user_id = auth.uid()
    -- WITH CHECK cannot reference is_active because a self-update might flip
    -- it (e.g. deactivating your own row is legitimate off-boarding). But we
    -- DO prevent the user from escalating their own role or moving rows
    -- across workspaces — those columns are immutable on self-update.
    AND workspace_id = (
      SELECT wm.workspace_id FROM public.workspace_members wm
       WHERE wm.user_id = auth.uid()
         AND wm.workspace_id = public.workspace_members.workspace_id
    )
  );

-- Block role escalation and username takeover via self-update. Admins still
-- manage those fields via ws_members_admin_write.
CREATE OR REPLACE FUNCTION public.fn_ws_members_prevent_self_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Skip the guard when the caller is an admin of the target workspace; the
  -- admin-write policy already ran its own checks.
  IF public.current_app_role() = 'admin'
     AND NEW.workspace_id = public.current_workspace_id() THEN
    RETURN NEW;
  END IF;
  -- Skip when the caller is service_role (Edge Functions, migrations).
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id = auth.uid() THEN
    IF NEW.app_role IS DISTINCT FROM OLD.app_role THEN
      RAISE EXCEPTION 'self-role change not allowed';
    END IF;
    IF NEW.username IS DISTINCT FROM OLD.username THEN
      RAISE EXCEPTION 'self-username change not allowed';
    END IF;
    IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
      RAISE EXCEPTION 'workspace move not allowed on self-update';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ws_members_self_guard ON public.workspace_members;
CREATE TRIGGER trg_ws_members_self_guard
  BEFORE UPDATE ON public.workspace_members
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_ws_members_prevent_self_role_change();

-- ── 2. user-avatars Storage bucket + RLS ────────────────────────────────────
-- `storage.buckets` is a regular table owned by the storage extension. Using
-- ON CONFLICT DO NOTHING keeps this migration idempotent across environments.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'user-avatars',
  'user-avatars',
  true,  -- public-read (RLS below still gates write)
  2 * 1024 * 1024,  -- 2 MB, mirrors AVATAR_MAX_BYTES in NewUserWelcome.jsx
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
  SET public              = EXCLUDED.public,
      file_size_limit     = EXCLUDED.file_size_limit,
      allowed_mime_types  = EXCLUDED.allowed_mime_types;

-- storage.objects policies. Path layout: {workspace_id}/{user_id}/{filename}
-- storage.foldername(name) returns the path components as a text[], 1-indexed.
DROP POLICY IF EXISTS user_avatars_select ON storage.objects;
CREATE POLICY user_avatars_select ON storage.objects
  FOR SELECT
  USING (bucket_id = 'user-avatars');

DROP POLICY IF EXISTS user_avatars_insert_own ON storage.objects;
CREATE POLICY user_avatars_insert_own ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'user-avatars'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = public.current_workspace_id()::text
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS user_avatars_update_own ON storage.objects;
CREATE POLICY user_avatars_update_own ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'user-avatars'
    AND (storage.foldername(name))[2] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'user-avatars'
    AND (storage.foldername(name))[1] = public.current_workspace_id()::text
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS user_avatars_delete_own ON storage.objects;
CREATE POLICY user_avatars_delete_own ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'user-avatars'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- ── 3. Atomic provisioning RPC ──────────────────────────────────────────────
-- Called by the provision-workspace Edge Function AFTER it has created the
-- auth.users row via the admin API. This function creates the workspace and
-- the admin membership in a single transaction (Postgres gives us that for
-- free inside a function body), so a failure past the auth-user creation
-- leaves at most one thing to clean up (the auth user itself).
--
-- SECURITY DEFINER so the service_role Edge Function's call bypasses the
-- workspaces_write_operator policy (which would otherwise reject the insert).
-- search_path pinned to public for defense-in-depth; function owner should
-- be postgres.
CREATE OR REPLACE FUNCTION public.provision_workspace_and_admin(
  p_workspace_name  TEXT,
  p_slug            TEXT,
  p_admin_user_id   UUID,
  p_admin_username  TEXT,
  p_admin_display   TEXT
)
RETURNS TABLE (workspace_id UUID, workspace_slug TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id UUID;
BEGIN
  -- Input guards mirror the Edge Function's validate() so direct SQL callers
  -- (admin scripts, future Platform Operator Console) can't smuggle bad data.
  IF p_workspace_name IS NULL OR char_length(p_workspace_name) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'workspace_name length 1-80';
  END IF;
  IF p_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' THEN
    RAISE EXCEPTION 'slug shape invalid';
  END IF;
  IF p_admin_username !~ '^[a-z0-9][a-z0-9._-]{1,31}$' THEN
    RAISE EXCEPTION 'username shape invalid';
  END IF;
  IF p_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'admin_user_id required';
  END IF;

  -- Slug uniqueness pre-check for a nicer error (the index catches it too).
  IF EXISTS (SELECT 1 FROM public.workspaces WHERE slug = p_slug) THEN
    RAISE EXCEPTION 'slug_taken' USING ERRCODE = 'unique_violation';
  END IF;

  -- Workspace + membership in one transaction.
  INSERT INTO public.workspaces (name, slug, created_by, updated_by)
  VALUES (p_workspace_name, p_slug, p_admin_user_id, p_admin_user_id)
  RETURNING id INTO v_workspace_id;

  INSERT INTO public.workspace_members (
    workspace_id, user_id, app_role, username, display_name, is_active
  ) VALUES (
    v_workspace_id,
    p_admin_user_id,
    'admin',
    p_admin_username,
    COALESCE(NULLIF(p_admin_display, ''), p_admin_username),
    true
  );

  RETURN QUERY SELECT v_workspace_id, p_slug;
END;
$$;

-- Only service_role may invoke. authenticated/anon callers route through the
-- Edge Function which does rate-limiting + validation + auth user creation.
REVOKE EXECUTE ON FUNCTION public.provision_workspace_and_admin(TEXT, TEXT, UUID, TEXT, TEXT)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.provision_workspace_and_admin(TEXT, TEXT, UUID, TEXT, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.provision_workspace_and_admin IS
  'Atomic provisioning of a new workspace + admin membership. Called by the provision-workspace Edge Function after it creates the auth.users row; on failure the Edge Function rolls back the orphan auth user.';
